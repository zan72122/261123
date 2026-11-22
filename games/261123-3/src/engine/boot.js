// Engine core: renderer, loop, stage flow, input routing, camera director, hints, save/restore.
import * as THREE from 'three';
import { setupRenderer, makeEnvironment } from '../lightrig.js';
import { createTimeline, EASE, ease } from './timeline.js';
import { createCameraDirector } from './camera.js';
import { createHint } from './hint.js';
import { installInput } from './input.js';
import { createSaver } from './save.js';

export { EASE, ease, createTimeline };

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;

function showFallback() {
  try {
    const img = document.getElementById('fallback');
    if (img) img.style.display = 'block';
    const c = document.getElementById('gl');
    if (c) c.style.display = 'none';
  } catch (e) { /* ignore */ }
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export function boot(opts = {}) {
  try {
    return bootInner(opts);
  } catch (e) {
    console.error('[engine] boot failed', e);
    showFallback();
    return null;
  }
}

function bootInner(opts) {
  const canvas = document.getElementById('gl');
  if (!canvas || !hasWebGL()) { showFallback(); return null; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { showFallback(); return null; }

  // --- error reporting: log once per message, keep running
  const seen = new Set();
  function report(e, where) {
    const msg = (where ? where + ': ' : '') + ((e && e.message) || String(e));
    if (seen.has(msg)) return;
    seen.add(msg);
    if (seen.size < 200) console.error('[engine]', msg, e);
  }
  function guard(fn, where) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function' && typeof r.catch === 'function') r.catch((e) => report(e, where));
      return r;
    } catch (e) { report(e, where); return undefined; }
  }
  function call(stage, name, ...args) {
    if (!stage || typeof stage[name] !== 'function') return undefined;
    return guard(() => stage[name](...args), (stage.id || '?') + '.' + name);
  }

  const capPR = Math.min(window.devicePixelRatio || 1, 2);
  let prScale = 1;
  renderer.setPixelRatio(capPR);
  setupRenderer(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfd9dc);
  let engineEnv = null;
  try { engineEnv = makeEnvironment(renderer); scene.environment = engineEnv; } catch (e) { report(e, 'environment'); }
  const camera = new THREE.PerspectiveCamera(45, 1, 0.03, 120);
  scene.add(camera);

  // --- viewport + safe-area probe
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const view = { w: 1, h: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 }, rect: { left: 0, top: 0, width: 1, height: 1 } };
  function measure() {
    const w = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
    const h = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
    let ins = view.insets;
    try {
      const cs = getComputedStyle(probe);
      ins = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    } catch (e) { /* ignore */ }
    let rect = { left: 0, top: 0, width: w, height: h };
    try { const r = canvas.getBoundingClientRect(); if (r.width > 0 && r.height > 0) rect = { left: r.left, top: r.top, width: r.width, height: r.height }; } catch (e) { /* ignore */ }
    return { w, h, ins, rect };
  }
  const vp = () => view;

  // --- context
  const quality = { low: false, particleScale: 1 };
  const ctx = {
    THREE, renderer, scene, camera, canvas, quality,
    time: 0, dt: 0,
    audio: null, fx: null, world: null,
    state: null,
  };
  ctx.tl = createTimeline(guard);
  ctx.gtl = createTimeline(guard);
  ctx.cam = createCameraDirector(ctx, camera, vp, guard);

  const _v = new THREE.Vector3();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  ctx.project = (v3) => {
    _v.copy(v3).applyMatrix4(camera.matrixWorldInverse);
    const behind = _v.z >= -1e-6;
    _v.applyMatrix4(camera.projectionMatrix);
    return { x: (_v.x + 1) / 2 * view.rect.width, y: (1 - _v.y) / 2 * view.rect.height, behind };
  };
  ctx.rayPlane = (p, plane) => {
    if (!p || !p.ray || !plane) return null;
    const out = new THREE.Vector3();
    return p.ray.intersectPlane(plane, out) ? out : null;
  };
  ctx.rayPlaneY = (p, y = 0) => { _plane.set(_plane.normal.set(0, 1, 0), -y); return ctx.rayPlane(p, _plane); };
  ctx.screenDist = (p, v3) => {
    const s = ctx.project(v3);
    return s.behind ? Infinity : Math.hypot(s.x - p.x, s.y - p.y);
  };
  const _w = new THREE.Vector3();
  ctx.pickNearest = (p, entries) => {
    if (!p || !entries) return null;
    let best = null, bestD = Infinity;
    for (const en of entries) {
      if (!en) continue;
      let pos = en.pos;
      if (!pos && en.obj && en.obj.isObject3D) { en.obj.updateWorldMatrix(true, false); pos = en.obj.getWorldPosition(_w); }
      if (!pos) continue;
      const d = ctx.screenDist(p, pos);
      const lim = Math.max(Number.isFinite(en.radiusPx) ? en.radiusPx : 60, 48);
      if (d <= lim && d < bestD) { best = en; bestD = d; }
    }
    if (best) best.dist = bestD;
    return best;
  };

  // --- save / restore
  const stages = Array.isArray(opts.stages) ? opts.stages.filter(Boolean) : [];
  const defaultState = typeof opts.defaultState === 'function' ? opts.defaultState : () => ({ v: 1 });
  const freshState = () => { let s = null; try { s = defaultState(); } catch (e) { report(e, 'defaultState'); } return s && typeof s === 'object' ? s : { v: 1 }; };
  const saver = createSaver(opts.saveKey || 'game-save', () => ctx.state && flow.current ? ({ v: ctx.state.v, stage: flow.current.id, t: Date.now(), state: ctx.state }) : null);
  ctx.saveSoon = () => saver.soon();
  ctx.saveNow = () => saver.now();

  // --- flow
  let pending = null;
  let downOwner = null;
  const flow = {
    current: null, index: -1, stages,
    next() { if (pending) return; pending = { type: 'next' }; },
    goto(id) { pending = { type: 'goto', id }; },
    restart() { pending = { type: 'restart' }; },
  };
  ctx.flow = flow;

  // --- initial pass of view metrics so module factories see a sized renderer
  function applySize(m) {
    view.w = m.w; view.h = m.h; view.insets = m.ins; view.rect = m.rect;
    renderer.setSize(m.w, m.h, false);
    camera.aspect = m.w / m.h; camera.updateProjectionMatrix();
  }
  applySize(measure());

  // --- modules
  let modules = [];
  if (typeof opts.createModules === 'function') {
    const r = opts.createModules(ctx);
    if (Array.isArray(r)) modules = r.filter(Boolean);
  }

  ctx.hint = createHint(ctx, vp, guard);

  function enterStage(i, instant) {
    const prev = flow.current;
    if (prev) call(prev, 'exit', ctx);
    ctx.tl.kill();
    ctx.tl = createTimeline(guard);
    ctx.hint.clear();
    downOwner = null; // a finger that is still down no longer talks to the new stage
    flow.index = i;
    const st = stages[i];
    flow.current = st;
    call(st, 'place', ctx);
    let shot = null;
    try { shot = typeof st.shot === 'function' ? st.shot(ctx) : st.shot; } catch (e) { report(e, st.id + '.shot'); }
    if (shot) guard(() => (instant ? ctx.cam.set(shot) : ctx.cam.goto(shot)), 'cam');
    call(st, 'enter', ctx);
    saver.now();
    grace = 1.5;
  }
  function processFlow() {
    let guardN = 0;
    while (pending && guardN++ < 4) {
      const r = pending; pending = null;
      if (!stages.length) return;
      let i = -1;
      if (r.type === 'next') i = (flow.index + 1) % stages.length;
      else if (r.type === 'restart') { ctx.state = freshState(); i = 0; }
      else if (typeof r.id === 'number') i = r.id >= 0 && r.id < stages.length ? r.id : -1;
      else i = stages.findIndex((s) => s.id === r.id);
      if (i < 0) { report(new Error('unknown stage ' + r.id), 'flow.goto'); continue; }
      enterStage(i, false);
    }
  }

  // --- input routing
  let unlocked = 0;
  const unlock = () => { try { ctx.audio && ctx.audio.unlock && ctx.audio.unlock(); } catch (e) { /* ignore */ } };
  const input = installInput(canvas, camera, () => view, {
    down(p) {
      if (unlocked < 2) { unlocked++; unlock(); }
      ctx.hint.pointerDown();
      downOwner = flow.current;
      call(flow.current, 'onDown', p, ctx);
    },
    move(p) { if (downOwner && downOwner === flow.current) call(flow.current, 'onMove', p, ctx); },
    up(p) {
      if (unlocked < 3) { unlocked = 3; unlock(); } // iOS: touchend is a reliable user activation for audio
      const o = downOwner; downOwner = null;
      if (o && o === flow.current) call(o, 'onUp', p, ctx);
    },
    anyUp() { if (unlocked && unlocked < 3) { unlocked = 3; unlock(); } },
  });
  ctx.input = input;

  // --- start stage (restore or fresh)
  const restored = saver.load(freshState(), stages);
  let startIdx = 0;
  if (restored) { ctx.state = restored.state; startIdx = restored.stageIndex; }
  else ctx.state = freshState();

  // --- dynamic resolution / quality
  const dynEnabled = !(DEV && /[?&]fixedres\b/.test(location.search));
  let ftAvg = 1 / 60, stepT = 0, upT = 0, lowT = 0, grace = 2;
  function setPR() { renderer.setPixelRatio(capPR * prScale); renderer.setSize(view.w, view.h, false); }
  function goLow() {
    if (quality.low) return;
    quality.low = true; quality.particleScale = 0.5;
    if (ctx.fx && ctx.fx.setQuality) guard(() => ctx.fx.setQuality(true), 'fx.setQuality');
    if (ctx.world && ctx.world.setQuality) guard(() => ctx.world.setQuality(true), 'world.setQuality');
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.needsUpdate = true;
  }
  function dynres(realDt) {
    if (!dynEnabled) return;
    if (grace > 0) { grace -= realDt; ftAvg = 1 / 60; stepT = 0; upT = 0; return; }
    const ft = Math.min(realDt, 0.25);
    ftAvg += (ft - ftAvg) * 0.06;
    stepT += realDt;
    if (stepT >= 1) {
      if (ftAvg > 1 / 30 && prScale > 0.55) {
        prScale = Math.max(0.55, prScale - (ftAvg > 1 / 20 ? 0.15 : 0.08)); setPR(); stepT = 0; upT = 0; ftAvg = 1 / 32;
      } else if (ftAvg < 1 / 50 && prScale < 1) {
        upT += stepT; stepT = 0;
        if (upT >= 2) { prScale = Math.min(1, prScale + 0.05); setPR(); upT = 0; }
      } else { stepT = 0; upT = 0; }
    }
    if (prScale <= 0.5501 && ftAvg > 1 / 24 && !quality.low) { lowT += realDt; if (lowT >= 3) goLow(); }
    else lowT = 0;
  }
  ctx.quality.setLow = goLow;

  // --- loop
  let raf = 0, last = 0, hidden = !!document.hidden, lost = false;
  function checkResize() {
    const m = measure();
    if (m.w !== view.w || m.h !== view.h || m.ins.top !== view.insets.top || m.ins.bottom !== view.insets.bottom ||
        m.ins.left !== view.insets.left || m.ins.right !== view.insets.right) {
      applySize(m);
      ctx.cam.refit();
      grace = Math.max(grace, 1);
    }
  }
  let resizeDirty = true;
  const onResize = () => { resizeDirty = true; };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  try { window.visualViewport && window.visualViewport.addEventListener('resize', onResize); } catch (e) { /* ignore */ }
  let resizePoll = 0;

  function frame(now) {
    raf = 0;
    if (hidden || lost) return;
    raf = requestAnimationFrame(frame);
    try {
      const realDt = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
      last = now;
      const dt = Math.min(realDt, 1 / 20);
      // poll size a few times a second too (iOS reports stale sizes right after rotation)
      if (resizeDirty || (resizePoll += realDt) > 0.25) { resizeDirty = false; resizePoll = 0; checkResize(); }
      ctx.time += dt; ctx.dt = dt;
      call(flow.current, 'update', dt, ctx);
      for (let i = 0; i < modules.length; i++) {
        const m = modules[i];
        if (m && typeof m.update === 'function') guard(() => m.update(dt), 'module.update#' + i);
      }
      ctx.tl.update(dt);
      ctx.gtl.update(dt);
      processFlow();
      guard(() => ctx.hint.update(dt, input.down), 'hint');
      guard(() => ctx.cam.update(dt, input.down), 'cam');
      guard(() => renderer.render(scene, camera), 'render');
      dynres(realDt);
      saver.tick();
      window.__ready = true;
    } catch (e) { report(e, 'frame'); }
  }
  function start() {
    if (raf || hidden || lost) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function onHide() {
    if (hidden) return;
    hidden = true; stop();
    input.cancel();
    try { ctx.audio && ctx.audio.suspend && ctx.audio.suspend(); } catch (e) { /* ignore */ }
    saver.now();
  }
  function onShow() {
    if (!hidden) return;
    hidden = false;
    try { ctx.audio && ctx.audio.resume && ctx.audio.resume(); } catch (e) { /* ignore */ }
    grace = Math.max(grace, 1.5);
    resizeDirty = true;
    start();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
  window.addEventListener('pagehide', () => { saver.now(); });
  window.addEventListener('pageshow', () => { if (!document.hidden) onShow(); });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); input.cancel(); }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (engineEnv && scene.environment === engineEnv) {
      try { engineEnv = makeEnvironment(renderer); scene.environment = engineEnv; } catch (e) { report(e, 'environment'); }
    }
    grace = Math.max(grace, 2);
    start();
  }, false);

  window.__game = { ctx };

  // enter the first stage instantly, then run
  if (stages.length) {
    flow.index = -1;
    enterStage(startIdx, true);
  }
  hidden = !!document.hidden;
  start();
  return ctx;
}
