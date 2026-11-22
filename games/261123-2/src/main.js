// ENGINE: renderer, loop, quality, input, camera rig, hints, save, fallback, texture loading.
import * as THREE from 'three';
import { ASSETS } from './assets.gen.js';
import { create as createAudio } from './audio.js';
import { create as createWorld } from './world.js';
import { create as createLeaves } from './leaves.js';
import { create as createFire } from './fire.js';
import { create as createPotato } from './potato.js';
import { create as createStory } from './story.js';

const SAVE_KEY = 'gf-261123-2';
const TILING = ['ground', 'leaflitter', 'ash', 'bark', 'stone', 'weave', 'potato_skin', 'potato_roast',
  'flesh_yellow', 'flesh_purple', 'flesh_orange'];

const canvas = document.getElementById('c');
let dead = false;
let raf = 0;

function showFallback(why) {
  if (dead) return;
  dead = true;
  try { if (raf) cancelAnimationFrame(raf); } catch (e) {}
  try { document.body.classList.add('nogl'); } catch (e) {}
  if (why) try { console.warn('fallback:', why); } catch (e) {}
}

// ---------------------------------------------------------------- utils
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function makeSoftDot() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
    const r = Math.sqrt(dx * dx + dy * dy);
    let a = Math.exp(-r * r * 3.2) * (1 - smooth(0.6, 1.0, r));
    a = clamp(a, 0, 1);
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeNoiseTex() {
  const S = 256, data = new Uint8Array(S * S * 4);
  const acc = new Float32Array(S * S);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let ch = 0; ch < 4; ch++) {
    seed = 9871 + ch * 7919;
    acc.fill(0);
    let amp = 1, tot = 0;
    for (let P = 4; P <= 64; P *= 2) {
      const grid = new Float32Array(P * P);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd();
      const cell = S / P;
      for (let y = 0; y < S; y++) {
        const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        const r0 = (y0 % P) * P, r1 = ((y0 + 1) % P) * P;
        for (let x = 0; x < S; x++) {
          const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const c0 = x0 % P, c1 = (x0 + 1) % P;
          const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
          const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
          acc[y * S + x] += (a + (b - a) * sy) * amp;
        }
      }
      tot += amp; amp *= 0.5;
    }
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < acc.length; i++) { const v = acc[i] / tot; acc[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = 1 / Math.max(1e-6, mx - mn);
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round((acc[i] - mn) * k * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const normalCanvasCache = new Map(); // image -> Map(strength -> canvas)
const normalTexCache = new Map();    // tex.uuid|strength -> texture
let maxAniso = 4;
function normalFrom(tex, strength = 2) {
  if (!tex) return null;
  const key = tex.uuid + '|' + strength;
  const hit = normalTexCache.get(key);
  if (hit) return hit;
  const img = tex.image;
  let byImg = normalCanvasCache.get(img);
  if (!byImg) { byImg = new Map(); normalCanvasCache.set(img, byImg); }
  let cv = byImg.get(strength);
  if (!cv) {
    cv = document.createElement('canvas');
    const iw = (img && (img.naturalWidth || img.width)) || 1, ih = (img && (img.naturalHeight || img.height)) || 1;
    const sc = Math.min(1, 512 / Math.max(iw, ih));
    const W = Math.max(1, Math.round(iw * sc)), H = Math.max(1, Math.round(ih * sc));
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    try {
      ctx.drawImage(img, 0, 0, W, H);
      const src = ctx.getImageData(0, 0, W, H).data;
      const L = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) L[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
      const wrap = tex.wrapS === THREE.RepeatWrapping;
      const at = (x, y) => {
        if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1); }
        return L[y * W + x];
      };
      const out = ctx.createImageData(W, H), o = out.data;
      const s = strength * (W / 256);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
        const l = at(x - 1, y), r = at(x + 1, y);
        const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
        const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        let nx = -dx * s, ny = dy * s, nz = 1;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv; nz *= inv;
        const i = (y * W + x) * 4;
        o[i] = (nx * 0.5 + 0.5) * 255; o[i + 1] = (ny * 0.5 + 0.5) * 255; o[i + 2] = (nz * 0.5 + 0.5) * 255; o[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    } catch (e) {
      ctx.fillStyle = 'rgb(128,128,255)'; ctx.fillRect(0, 0, W, H);
    }
    byImg.set(strength, cv);
  }
  const nt = new THREE.CanvasTexture(cv);
  nt.colorSpace = THREE.NoColorSpace;
  nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT;
  nt.repeat.copy(tex.repeat); nt.offset.copy(tex.offset);
  nt.center.copy(tex.center); nt.rotation = tex.rotation;
  nt.anisotropy = maxAniso;
  nt.needsUpdate = true;
  normalTexCache.set(key, nt);
  return nt;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(img); } };
    const bad = () => { if (!done) { done = true; resolve(null); } };
    img.onload = ok; img.onerror = bad;
    img.src = url;
    if (img.decode) img.decode().then(ok, () => { if (img.complete && img.naturalWidth) ok(); });
  });
}

function placeholderImage() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 4;
  const c = cv.getContext('2d'); c.fillStyle = '#6b5a48'; c.fillRect(0, 0, 4, 4);
  return cv;
}

async function loadTextures(renderer) {
  const tex = {};
  const names = Object.keys(ASSETS);
  const imgs = await Promise.all(names.map((n) => loadImage(ASSETS[n])));
  names.forEach((n, i) => {
    const t = new THREE.Texture(imgs[i] || placeholderImage());
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = maxAniso;
    if (TILING.includes(n)) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    else { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    t.name = n;
    t.needsUpdate = true;
    tex[n] = t;
  });
  return tex;
}

function safeModule(name) {
  const noop = () => undefined;
  return new Proxy({ isStub: true, failed: true, update: noop }, { get(t, k) { return k in t ? t[k] : noop; } });
}

// ---------------------------------------------------------------- boot
async function boot() {
  // ---- quality
  const qs = location.search || '';
  const hc = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory;
  const startLow = /[?&]low\b/.test(qs) || hc <= 2 || (hc <= 4 && mem !== undefined && mem <= 4);
  const quality = { low: startLow, particles: startLow ? 0.5 : 1, shadows: !startLow };

  // ---- renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  } catch (e) { showFallback(e); return; }
  if (!renderer.getContext()) { showFallback('no context'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x2a211a, 1);
  maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy() || 1);

  let lostTimer = 0, lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); lost = true;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => { if (lost) showFallback('context lost'); }, 2000);
  }, false);
  canvas.addEventListener('webglcontextrestored', () => { lost = false; clearTimeout(lostTimer); }, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
  camera.position.set(0, 2.2, 3.2);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  let W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  let resScale = 1;
  const baseRatio = () => Math.min(dpr, quality.low ? 1.5 : 2);
  const applyRatio = () => { renderer.setPixelRatio(baseRatio() * resScale); renderer.setSize(W, H, false); };
  camera.aspect = W / H; camera.updateProjectionMatrix();
  applyRatio();

  // ---- G
  const G = {
    THREE, renderer, scene, camera,
    dev: !!__DEV__,
    quality,
    time: { t: 0, dt: 0 },
    tex: {},
    util: { normalFrom, softDot: null, noiseTex: null, rand, damp, clamp, lerp, smooth },
  };
  window.G = G;
  G.util.softDot = makeSoftDot();
  G.util.noiseTex = makeNoiseTex();
  G.tex = await loadTextures(renderer);

  // ---- save
  let saveData = {};
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) saveData = p; }
  } catch (e) { saveData = {}; }
  let saveLast = 0, saveTimer = 0;
  const saveFlush = () => {
    clearTimeout(saveTimer); saveTimer = 0;
    saveLast = performance.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save.data || {})); } catch (e) {}
  };
  G.save = {
    data: saveData,
    commit() {
      try {
        if (saveTimer) return;
        const wait = 400 - (performance.now() - saveLast);
        if (wait <= 0) saveFlush(); else saveTimer = setTimeout(saveFlush, wait);
      } catch (e) {}
    },
  };
  const savePending = () => { if (saveTimer) saveFlush(); };

  // ---- input
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const input = {
    down: false, justDown: false, justUp: false,
    x: 0, y: 0, px: W / 2, py: H / 2,
    ray: raycaster.ray, ground: new THREE.Vector3(),
    vx: 0, vz: 0, speed: 0, dragPx: 0, heldFor: 0, idle: 0,
  };
  G.input = input;
  const Q = 8, qType = new Int8Array(Q), qX = new Float32Array(Q), qY = new Float32Array(Q);
  let qHead = 0, qLen = 0;
  const qPush = (type, x, y) => {
    if (qLen >= Q) return;
    const i = (qHead + qLen) % Q; qType[i] = type; qX[i] = x; qY[i] = y; qLen++;
  };
  let activeId = null, curX = W / 2, curY = H / 2, activity = false, moveAcc = 0, unlocked = false;
  const prevGround = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  const endPointer = (e) => {
    if (activeId === null || (e && e.pointerId !== activeId)) return;
    activeId = null; activity = true;
    if (e && e.clientX !== undefined && e.type !== 'lostpointercapture') { curX = e.clientX; curY = e.clientY; }
    qPush(0, curX, curY);
  };
  canvas.addEventListener('pointerdown', (e) => {
    activity = true;
    if (!unlocked) { unlocked = true; try { G.audio && G.audio.unlock && G.audio.unlock(); } catch (er) {} }
    else { try { G.audio && G.audio.unlock && G.audio.unlock(); } catch (er) {} }
    if (activeId !== null) return;
    activeId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    curX = e.clientX; curY = e.clientY;
    qPush(1, curX, curY);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    activity = true;
    moveAcc += Math.hypot(e.clientX - curX, e.clientY - curY);
    curX = e.clientX; curY = e.clientY;
  });
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  const pd = (e) => { if (e.cancelable) e.preventDefault(); };
  document.addEventListener('touchstart', pd, { passive: false });
  document.addEventListener('touchmove', pd, { passive: false });
  document.addEventListener('touchend', pd, { passive: false });
  for (const n of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick', 'selectstart']) {
    document.addEventListener(n, pd, { passive: false });
  }
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) pd(e); }, { passive: false });

  function clampGround(v) {
    v.y = 0;
    const r = Math.hypot(v.x, v.z);
    if (r > 6) { v.x *= 6 / r; v.z *= 6 / r; }
    return v;
  }
  function rayPlaneY(y, out) {
    out = out || new THREE.Vector3();
    const o = input.ray.origin, d = input.ray.direction;
    if (d.y < -1e-4 && o.y > y) {
      const t = (y - o.y) / d.y;
      out.copy(d).multiplyScalar(t).add(o);
    } else if (d.y > 1e-4 && o.y < y) {
      const t = (y - o.y) / d.y;
      out.copy(d).multiplyScalar(t).add(o);
    } else {
      out.copy(d).multiplyScalar(30).add(o);
    }
    out.y = y;
    const r = Math.hypot(out.x, out.z);
    if (r > 6) { out.x *= 6 / r; out.z *= 6 / r; }
    return out;
  }
  G.rayPlaneY = rayPlaneY;

  function updateRay() {
    ndc.set(clamp(input.px / W * 2 - 1, -1, 1), clamp(-(input.py / H * 2 - 1), -1, 1));
    input.x = ndc.x; input.y = ndc.y;
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    rayPlaneY(0, input.ground);
    clampGround(input.ground);
  }

  function inputFrame(dt) {
    input.justDown = false; input.justUp = false;
    if (activity) { input.idle = 0; activity = false; } else input.idle += dt;
    let processed = false;
    if (qLen > 0) {
      const i = qHead; qHead = (qHead + 1) % Q; qLen--;
      input.px = qX[i]; input.py = qY[i];
      processed = true;
      if (qType[i] === 1) {
        input.down = true; input.justDown = true; input.dragPx = 0; input.heldFor = 0; moveAcc = 0;
        updateRay();
        prevGround.copy(input.ground);
        input.vx = input.vz = input.speed = 0;
        return;
      }
      input.down = false; input.justUp = true;
    }
    if (input.down) {
      if (!processed) { input.px = curX; input.py = curY; }
      input.heldFor += dt;
      input.dragPx += moveAcc; moveAcc = 0;
      updateRay();
      if (dt > 0) {
        const rvx = (input.ground.x - prevGround.x) / dt, rvz = (input.ground.z - prevGround.z) / dt;
        input.vx = damp(input.vx, rvx, 16.7, dt); input.vz = damp(input.vz, rvz, 16.7, dt);
      }
      prevGround.copy(input.ground);
      input.speed = Math.hypot(input.vx, input.vz);
    } else {
      if (input.justUp) { input.dragPx += moveAcc; updateRay(); }
      moveAcc = 0;
      input.vx = input.vz = input.speed = 0;
    }
  }

  const hits = [];
  G.pick = (obj) => {
    try {
      if (!obj) return null;
      hits.length = 0;
      if (Array.isArray(obj)) raycaster.intersectObjects(obj, true, hits);
      else raycaster.intersectObject(obj, true, hits);
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.object && h.object.visible !== false) return { object: h.object, point: h.point, distance: h.distance };
      }
    } catch (e) {}
    return null;
  };
  const projV = new THREE.Vector3();
  G.toScreen = (v, out) => {
    out = out || { x: 0, y: 0 };
    projV.copy(v).project(camera);
    if (projV.z > 1) { out.x = -1e5; out.y = -1e5; return out; }
    out.x = (projV.x + 1) * 0.5 * W; out.y = (1 - projV.y) * 0.5 * H;
    return out;
  };
  const scr = { x: 0, y: 0 };
  G.pxDist = (v) => { G.toScreen(v, scr); return Math.hypot(scr.x - input.px, scr.y - input.py); };

  // ---- camera rig
  const rig = (() => {
    const pos = new THREE.Vector3().copy(camera.position), tgt = new THREE.Vector3(0, 0, 0);
    let fov = 50;
    const fromPos = new THREE.Vector3(), fromTgt = new THREE.Vector3(), toPos = new THREE.Vector3(), toTgt = new THREE.Vector3();
    let fromFov = 50, toFov = 50, tt = 1, dur = 0, spec = null;
    let shake = 0;
    const f = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3(), dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3();
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const look = new THREE.Vector3();
    const fx = new Float32Array(5), fy = new Float32Array(5), fz = new Float32Array(5);
    let solvedShift = 0, shift = 0, fromShift = 0, toShift = 0, appliedShift = NaN, applied9 = NaN;

    function solve(s, outPos, outTgt) {
      if (Array.isArray(s.pos) && Array.isArray(s.look)) { // explicit camera (e.g. looking up into the tree)
        outPos.set(+s.pos[0] || 0, +s.pos[1] || 0, +s.pos[2] || 0);
        outTgt.set(+s.look[0] || 0, +s.look[1] || 0, +s.look[2] || 0);
        solvedShift = 0;
        return clamp(+s.fov || 50, 15, 100);
      }
      const t = s.target || [0, 0, 0];
      outTgt.set(+t[0] || 0, +t[1] || 0, +t[2] || 0);
      const fit = s.fit || { w: 2.5, d: 2.5 };
      const fw = Math.max(0.1, +fit.w || 2.5), fd = Math.max(0.1, +fit.d || 2.5);
      const aspect = W / H;
      let pitch = s.pitch === undefined ? 45 : s.pitch;
      if (Array.isArray(pitch)) pitch = aspect < 1 ? pitch[0] : pitch[pitch.length - 1];
      pitch = clamp(+pitch || 45, 3, 89) * Math.PI / 180;
      const yaw = (+s.yaw || 0) * Math.PI / 180;
      const fv = clamp(+s.fov || 50, 15, 100);
      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      f.copy(dir).negate();
      r.crossVectors(f, up).normalize();
      u.crossVectors(r, f);
      const tanV = Math.tan(fv * Math.PI / 360) * 0.94, tanH = tanV * aspect;
      corners[0].set(outTgt.x - fw / 2, 0, outTgt.z - fd / 2);
      corners[1].set(outTgt.x + fw / 2, 0, outTgt.z - fd / 2);
      corners[2].set(outTgt.x - fw / 2, 0, outTgt.z + fd / 2);
      corners[3].set(outTgt.x + fw / 2, 0, outTgt.z + fd / 2);
      corners[4].set(outTgt.x, outTgt.y + 0.2, outTgt.z);
      let dist = 0.6;
      solvedShift = 0;
      const bottom = s.bottom === undefined ? null : (Array.isArray(s.bottom) ? (aspect < 1 ? s.bottom[0] : s.bottom[s.bottom.length - 1]) : s.bottom);
      if (bottom === null || !isFinite(+bottom)) {
        for (let i = 0; i < 5; i++) {
          P.copy(corners[i]).sub(outTgt);
          const z0 = P.dot(f), x = Math.abs(P.dot(r)), y = Math.abs(P.dot(u));
          dist = Math.max(dist, x / tanH - z0, y / tanV - z0, 0.25 - z0);
        }
      } else {
        // lens-shift fit: the rectangle fills the width and its near edge sits `bottom` (fraction of the
        // screen height) above the bottom edge; the space left at the top shows the garden/tree.
        const lo = -1 + 2 * clamp(+bottom, 0, 0.45), hi = 0.97;
        const tv = tanV / 0.94;
        for (let i = 0; i < 5; i++) { P.copy(corners[i]).sub(outTgt); fz[i] = P.dot(f); fx[i] = Math.abs(P.dot(r)); fy[i] = P.dot(u); }
        let dmin = 0.3, dmax = 80;
        for (let i = 0; i < 5; i++) dmin = Math.max(dmin, 0.25 - fz[i]);
        const ok = (d) => {
          let ymn = 1e9, ymx = -1e9;
          for (let i = 0; i < 5; i++) {
            const dep = d + fz[i];
            if (fx[i] / (dep * tanH) > 1) return false;
            const ny = fy[i] / (dep * tv);
            if (ny < ymn) ymn = ny; if (ny > ymx) ymx = ny;
          }
          if (ymx - ymn > hi - lo) return false;
          solvedShift = lo - ymn;
          return true;
        };
        if (!ok(dmin)) { for (let k = 0; k < 40; k++) { const m = (dmin + dmax) / 2; if (ok(m)) dmax = m; else dmin = m; } ok(dmax); dist = dmax; }
        else dist = dmin;
      }
      outPos.copy(dir).multiplyScalar(dist).add(outTgt);
      return fv;
    }

    function shot(s, seconds = 1.6) {
      try {
        if (!s) return;
        spec = s; api.current = s;
        fromPos.copy(pos); fromTgt.copy(tgt); fromFov = fov; fromShift = shift;
        toFov = solve(s, toPos, toTgt); toShift = solvedShift;
        dur = Math.max(0, +seconds || 0);
        tt = 0;
        if (dur <= 0.001) { tt = 1; pos.copy(toPos); tgt.copy(toTgt); fov = toFov; shift = toShift; }
      } catch (e) {}
    }
    function refit() {
      if (!spec) return;
      toFov = solve(spec, toPos, toTgt); toShift = solvedShift;
      if (tt >= 1) { pos.copy(toPos); tgt.copy(toTgt); fov = toFov; shift = toShift; }
    }
    function nudge(a) { shake = clamp(shake + clamp(+a || 0, 0, 1), 0, 1.5); }
    function update(dt, t) {
      if (tt < 1) {
        tt = Math.min(1, tt + dt / Math.max(1e-3, dur));
        const k = smoother(tt);
        pos.lerpVectors(fromPos, toPos, k);
        tgt.lerpVectors(fromTgt, toTgt, k);
        fov = lerp(fromFov, toFov, k);
        shift = lerp(fromShift, toShift, k);
      }
      shake *= Math.exp(-5 * dt);
      const sa = shake * 0.012;
      camera.position.set(
        pos.x + 0.003 * Math.sin(t * 0.41 * 6.283) + sa * (Math.sin(t * 37.1) + 0.5 * Math.sin(t * 61.3)),
        pos.y + 0.002 * Math.sin(t * 0.29 * 6.283 + 1.3) + sa * (Math.sin(t * 43.7 + 1) + 0.5 * Math.sin(t * 71.9)),
        pos.z + 0.002 * Math.sin(t * 0.23 * 6.283 + 2.1) + sa * 0.5 * Math.sin(t * 29.3 + 2));
      look.copy(tgt);
      camera.lookAt(look);
      if (Math.abs(camera.fov - fov) > 1e-4 || camera.aspect !== W / H || shift !== appliedShift || camera.projectionMatrix.elements[9] !== applied9) {
        camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix();
        // vertical lens shift (NDC units): moves the picture up/down without tilting the camera
        if (shift !== 0) { camera.projectionMatrix.elements[9] -= shift; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert(); }
        appliedShift = shift; applied9 = camera.projectionMatrix.elements[9];
      }
      camera.updateMatrixWorld();
    }
    const api = { shot, nudge, refit, update, current: null };
    return api;
  })();
  G.rig = rig;
  rig.shot({ target: [0, 0.1, 0.3], fit: { w: 2.6, d: 3.0 }, pitch: 46 }, 0);

  // ---- hints
  const hint = (() => {
    const halos = [];
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    haloGeo.rotateX(-Math.PI / 2);
    const hv = new THREE.Vector3();
    function halo(target, radius = 0.5) {
      const mat = new THREE.MeshBasicMaterial({
        map: G.util.softDot, color: new THREE.Color(1.0, 0.82, 0.55), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
      });
      const mesh = new THREE.Mesh(haloGeo, mat);
      mesh.renderOrder = 900; mesh.frustumCulled = false; mesh.visible = false;
      const smat = new THREE.SpriteMaterial({
        map: G.util.softDot, color: new THREE.Color(1.0, 0.86, 0.62), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
      });
      const spr = new THREE.Sprite(smat);
      spr.renderOrder = 901; spr.frustumCulled = false; spr.visible = false;
      scene.add(mesh); scene.add(spr);
      const h = { target, radius: Math.max(0.05, +radius || 0.5), k: 0, goal: 0, mesh, spr, mat, smat, phase: Math.random() * 6 };
      const api = {
        set(k) { h.goal = clamp(+k || 0, 0, 1); return api; },
        dispose() {
          const i = halos.indexOf(h); if (i >= 0) halos.splice(i, 1);
          scene.remove(mesh); scene.remove(spr); mat.dispose(); smat.dispose();
        },
      };
      halos.push(h);
      return api;
    }

    // finger
    const skin = new THREE.Color(0xd79a78);
    const fmat = new THREE.MeshStandardMaterial({
      color: skin, roughness: 0.55, metalness: 0, transparent: true, opacity: 0,
      depthTest: true, depthWrite: true, emissive: new THREE.Color(0x3a1c12), fog: false,
    });
    const nmat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xf3d2c4), roughness: 0.25, metalness: 0, transparent: true, opacity: 0,
      depthTest: true, depthWrite: false, emissive: new THREE.Color(0x4a3029), fog: false,
    });
    const LEN = 0.078, RAD = 0.0092;
    const capG = new THREE.CapsuleGeometry(RAD, LEN - 2 * RAD, 8, 18);
    capG.translate(0, LEN / 2, 0);
    // slightly flatten the pad side & taper the tip a touch
    {
      const p = capG.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), tip = 1 - smooth(0, LEN * 0.55, y);
        const kn = Math.exp(-Math.pow((y - LEN * 0.42) / 0.006, 2)) + Math.exp(-Math.pow((y - LEN * 0.74) / 0.007, 2));
        const s = (1 - 0.12 * tip) * (1 + 0.07 * kn) * (0.94 + 0.12 * smooth(0, LEN, y));
        p.setX(i, p.getX(i) * s);
        p.setZ(i, p.getZ(i) * (p.getZ(i) < 0 ? 0.86 * s : s));
      }
      capG.computeVertexNormals();
    }
    const finger = new THREE.Group();
    const fMesh = new THREE.Mesh(capG, fmat); fMesh.renderOrder = 1000;
    const nailG = new THREE.SphereGeometry(1, 16, 10);
    const nMesh = new THREE.Mesh(nailG, nmat); nMesh.renderOrder = 1001;
    nMesh.scale.set(RAD * 0.72, RAD * 0.95, RAD * 0.22);
    nMesh.position.set(0, RAD * 1.15, RAD * 0.86);
    finger.add(fMesh); finger.add(nMesh);
    // the rest of a pointing hand (curled fingers, thumb, back of hand, wrist) so it reads as a hand, not a blob.
    // the hand is drawn last, on a cleared depth buffer, so its own parts occlude each other (no double blending).
    fMesh.onBeforeRender = (r) => { r.clearDepth(); };
    {
      const part = (geo, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, fmat); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
        m.renderOrder = 1002; m.frustumCulled = false; finger.add(m); return m;
      };
      const sph = new THREE.SphereGeometry(1, 20, 14);
      const cap = new THREE.CapsuleGeometry(1, 2.6, 6, 14);
      part(sph, 0.021, LEN + 0.030, -0.010, 0.036, 0.034, 0.021);            // back of the hand
      for (let k = 0; k < 3; k++) part(sph, 0.014 + k * 0.0165, LEN + 0.004 - k * 0.003, -0.010, 0.0098 - k * 0.0006, 0.0125, 0.0115); // curled knuckles
      part(cap, -0.012, LEN + 0.012, -0.016, 0.0088, 0.0088, 0.0088, 0.25, 0, 0.55); // thumb tucked alongside
      part(new THREE.CylinderGeometry(0.75, 0.86, 1, 18), 0.023, LEN + 0.082, -0.011, 0.031, 0.062, 0.019); // wrist
    }
    finger.visible = false; finger.frustumCulled = false;
    fMesh.frustumCulled = false; nMesh.frustumCulled = false;
    scene.add(finger);

    const MAXP = 24;
    const pts = []; for (let i = 0; i < MAXP; i++) pts.push(new THREE.Vector3());
    const cum = new Float32Array(MAXP);
    let nP = 0, total = 0, fLoop = true, fSpeed = 0.9, fTap = false, fOn = false, fT = 0, fAlpha = 0, fHide = false;
    const fp = new THREE.Vector3(), xA = new THREE.Vector3(), yA = new THREE.Vector3(), zA = new THREE.Vector3();
    const mtx = new THREE.Matrix4(), toCam = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0);

    function show(points, opts) {
      try {
        if (!points || !points.length) return;
        const o = opts || {};
        nP = 0;
        for (let i = 0; i < points.length && nP < MAXP; i++) {
          const q = points[i]; if (!q) continue;
          pts[nP].set(+q.x || 0, +q.y || 0, +q.z || 0); nP++;
        }
        if (!nP) return;
        total = 0; cum[0] = 0;
        for (let i = 1; i < nP; i++) { total += pts[i].distanceTo(pts[i - 1]); cum[i] = total; }
        fLoop = o.loop !== false; fSpeed = clamp(+o.speed || 0.9, 0.1, 5); fTap = !!o.tap || nP < 2 || total < 0.01;
        if (!fOn || fHide) { fT = 0; }
        fOn = true; fHide = false;
      } catch (e) {}
    }
    function hide() { if (fOn) fHide = true; }
    function pathAt(s, out) {
      if (nP < 2) return out.copy(pts[0]);
      s = clamp(s, 0, total);
      let i = 1; while (i < nP - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1];
      const k = seg > 1e-6 ? (s - cum[i - 1]) / seg : 0;
      return out.lerpVectors(pts[i - 1], pts[i], k);
    }

    function updateFinger(dt, t) {
      if (!fOn) { finger.visible = false; return; }
      fT += dt;
      // timeline -> position on path, lift (0 = touching, 1 = hovering), alpha
      let lift = 1, alpha = 0, s = 0;
      if (fTap) {
        const IN = 0.35, P = 0.75;
        const c = fT - IN;
        if (c < 0) { alpha = smooth(0, IN, fT); lift = 1; }
        else {
          const n = Math.floor(c / P), ph = (c - n * P) / P;
          alpha = 1;
          lift = ph < 0.3 ? 1 - smooth(0, 0.3, ph) : ph < 0.45 ? 0 : smooth(0.45, 0.8, ph);
          if (!fLoop && n >= 2) { alpha = 1 - smooth(0, 0.3, c - 2 * P); if (c - 2 * P > 0.3) fOn = false; }
        }
        pathAt(0, fp);
      } else {
        const IN = 0.4, PRESS = 0.3, GL = Math.max(0.3, total / fSpeed), HOLD = 0.15, LIFT = 0.35, GAP = 0.7;
        const CY = IN + PRESS + GL + HOLD + LIFT + GAP;
        let c = fT;
        if (fLoop) c = fT % CY; else if (fT > CY) { fOn = false; finger.visible = false; return; }
        if (c < IN) { alpha = smooth(0, IN, c); lift = 1; s = 0; }
        else if (c < IN + PRESS) { alpha = 1; lift = 1 - smooth(0, PRESS, c - IN); s = 0; }
        else if (c < IN + PRESS + GL) { alpha = 1; lift = 0; s = smooth(0, 1, (c - IN - PRESS) / GL) * total; }
        else if (c < IN + PRESS + GL + HOLD) { alpha = 1; lift = 0; s = total; }
        else if (c < IN + PRESS + GL + HOLD + LIFT) { const k = (c - IN - PRESS - GL - HOLD) / LIFT; lift = smooth(0, 1, k); alpha = 1 - smooth(0.2, 1, k); s = total; }
        else { alpha = 0; lift = 1; s = total; }
        pathAt(s, fp);
      }
      if (fHide) { fAlpha = Math.max(0, fAlpha - dt / 0.2); if (fAlpha <= 0) { fOn = false; fHide = false; finger.visible = false; return; } }
      else fAlpha = damp(fAlpha, alpha, 30, dt);
      const a = fAlpha * Math.min(1, alpha + (fHide ? 1 : 0));
      // scale to ~10 % of screen height
      const dist = Math.max(0.2, camera.position.distanceTo(fp));
      const sc = 0.058 * 2 * dist * Math.tan(camera.fov * Math.PI / 360) / LEN;
      // orientation: axis from tip toward the player's hand (toward camera, up ~50 deg), slight lean to the right
      toCam.copy(camera.position).sub(fp); toCam.y = 0;
      if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1);
      toCam.normalize();
      xA.crossVectors(worldUp, toCam).normalize(); // screen-right
      yA.copy(toCam).multiplyScalar(Math.cos(0.36)).addScaledVector(worldUp, Math.sin(0.36)).addScaledVector(xA, 0.42).normalize();
      zA.copy(worldUp).addScaledVector(yA, -worldUp.dot(yA)).normalize(); // nail side faces up
      xA.crossVectors(yA, zA).normalize();
      mtx.makeBasis(xA, yA, zA);
      finger.quaternion.setFromRotationMatrix(mtx);
      finger.scale.setScalar(sc);
      const press = 1 - lift;
      finger.position.copy(fp);
      finger.position.y += lift * 0.035 * sc + 0.002 - press * 0.0015 * sc;
      // tiny idle drift so it feels alive
      finger.position.x += Math.sin(t * 2.1) * 0.0015 * sc;
      fmat.opacity = 0.7 * a; nmat.opacity = 0.6 * a;
      finger.visible = a > 0.003;
    }

    function update(dt, t) {
      for (let i = 0; i < halos.length; i++) {
        const h = halos[i];
        h.k = damp(h.k, h.goal, 3.5, dt);
        const tg = h.target;
        let y = 0, above = 0;
        if (tg && tg.isObject3D) {
          tg.getWorldPosition(hv); above = hv.y; y = 0;
        } else if (tg && tg.isVector3) { hv.copy(tg); y = tg.y; above = tg.y; }
        else hv.set(0, 0, 0);
        const pulse = 0.66 + 0.34 * Math.sin((t * 1.2 + h.phase) * 6.2832);
        const op = 0.5 * h.k * pulse;
        h.mesh.visible = op > 0.002;
        h.mesh.position.set(hv.x, y + 0.012, hv.z);
        const sz = h.radius * 2.6 * (0.97 + 0.03 * pulse);
        h.mesh.scale.set(sz, 1, sz);
        h.mat.opacity = op;
        const showSpr = above > 0.08;
        h.spr.visible = showSpr && op > 0.002;
        if (showSpr) {
          h.spr.position.copy(hv);
          h.spr.scale.setScalar(h.radius * 2.2);
          h.smat.opacity = op * 0.18;
        }
      }
      updateFinger(dt, t);
    }
    return { halo, finger: { show, hide }, update };
  })();
  G.hint = { halo: hint.halo, finger: hint.finger };

  // ---- modules
  const creators = [['audio', createAudio], ['world', createWorld], ['leaves', createLeaves], ['fire', createFire], ['potato', createPotato], ['story', createStory]];
  for (const [n] of creators) G[n] = safeModule(n);
  for (const [n, fn] of creators) {
    try { G[n] = fn(G) || safeModule(n); } catch (e) { console.error('[engine] create ' + n + ' failed:', e); G[n] = safeModule(n); }
  }

  // ---- dev helpers
  if (G.world.isStub) {
    const gt = G.tex.ground.clone(); gt.repeat.set(20, 20); gt.needsUpdate = true;
    const gmat = new THREE.MeshStandardMaterial({ map: gt, normalMap: normalFrom(gt, 2), roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), gmat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new THREE.HemisphereLight(0xdfe4ea, 0x5e4c3a, 0.9));
    const sun = new THREE.DirectionalLight(0xffe0b8, 2.6);
    sun.position.set(-0.55, 0.70, -0.30).normalize().multiplyScalar(10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -3.5; sc.right = 3.5; sc.top = 3.5; sc.bottom = -3.5; sc.near = 1; sc.far = 25;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    scene.background = new THREE.Color(0xb7bfc4);
    scene.fog = new THREE.Fog(0xb7bfc4, 9, 26);
    rig.shot({ target: [0, 0.1, 0.3], fit: { w: 2.6, d: 3.0 }, pitch: 46 }, 0);
  } else if (G.story.isStub) {
    rig.shot({ target: [0, 0.1, 0.3], fit: { w: 2.6, d: 3.0 }, pitch: 46 }, 0);
  }
  if (G.story.isStub) {
    const real = __DEV_MODULES__;
    try { if (real.includes('leaves')) G.leaves.reset?.({}); } catch (e) { console.error(e); }
    try { if (real.includes('potato')) G.potato.reset?.(1); } catch (e) { console.error(e); }
  }

  // ---- resize
  const onResize = () => {
    const nw = Math.max(1, window.innerWidth), nh = Math.max(1, window.innerHeight);
    if (nw === W && nh === H) return;
    W = nw; H = nh;
    applyRatio();
    camera.aspect = W / H; camera.updateProjectionMatrix();
    rig.refit();
  };
  const lateResize = () => { onResize(); setTimeout(onResize, 120); setTimeout(onResize, 500); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', lateResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  // ---- quality adaption
  let ftAvg = 16, slowT = 0, fastT = 0, warm = 0;
  function goLow() {
    if (quality.low && !quality.shadows) return;
    quality.low = true; quality.particles = 0.5; quality.shadows = false;
    renderer.shadowMap.enabled = false;
    scene.traverse((o) => {
      const m = o.material; if (!m) return;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true; else m.needsUpdate = true;
    });
    applyRatio();
  }
  if (quality.low) renderer.shadowMap.enabled = false;
  function adapt(rawMs, dt) {
    warm += dt;
    if (warm < 2 || rawMs > 250) return;
    ftAvg += (rawMs - ftAvg) * 0.08;
    if (ftAvg > 36) {
      slowT += dt; fastT = 0;
      if (slowT > 1.5) {
        slowT = 0;
        if (resScale > 0.601) { resScale = Math.max(0.6, resScale - 0.1); applyRatio(); }
        else if (!quality.low || quality.shadows) goLow();
      }
    } else if (ftAvg < 22) {
      fastT += dt; slowT = 0;
      if (fastT > 4) { fastT = 0; if (resScale < 1) { resScale = Math.min(1, resScale + 0.1); applyRatio(); } }
    } else { slowT = Math.max(0, slowT - dt); fastT = 0; }
  }

  // ---- loop
  const order = ['story', 'world', 'leaves', 'fire', 'potato', 'audio'];
  const failed = {};
  let last = -1, paused = false, firstFrame = true;
  function frame(now) {
    raf = 0;
    if (dead || paused) return;
    raf = requestAnimationFrame(frame);
    const rawMs = last < 0 ? 16 : now - last;
    last = now;
    const dt = clamp(rawMs / 1000, 0, 0.05);
    G.time.dt = dt; G.time.t += dt;
    adapt(rawMs, dt);
    inputFrame(dt);
    for (let i = 0; i < order.length; i++) {
      const n = order[i], m = G[n];
      if (!m || typeof m.update !== 'function') continue;
      try { m.update(dt); } catch (e) { if (!failed[n]) { failed[n] = 1; console.error('[engine] ' + n + '.update threw:', e); } }
    }
    try { rig.update(dt, G.time.t); } catch (e) { if (!failed.rig) { failed.rig = 1; console.error(e); } }
    try { hint.update(dt, G.time.t); } catch (e) { if (!failed.hint) { failed.hint = 1; console.error(e); } }
    if (!lost) {
      try { renderer.render(scene, camera); } catch (e) { if (!failed.render) { failed.render = 1; console.error(e); } }
      if (firstFrame) { firstFrame = false; canvas.classList.add('on'); }
    }
  }
  if (G.dev || /[?&]step\b/.test(location.search)) {
    // self-check helper (dev builds or ?step): run n full update ticks without rendering (fast-forward slow headless runs)
    G.devStep = (n = 1, sdt = 1 / 30) => {
      const dt = clamp(+sdt || 1 / 30, 0, 0.05);
      for (let k = 0; k < (n | 0); k++) {
        G.time.dt = dt; G.time.t += dt;
        inputFrame(dt);
        for (let i = 0; i < order.length; i++) {
          const m = G[order[i]];
          if (!m || typeof m.update !== 'function') continue;
          try { m.update(dt); } catch (e) { console.error('[devStep] ' + order[i], e); }
        }
        rig.update(dt, G.time.t); hint.update(dt, G.time.t);
      }
      return G.story && G.story.stage;
    };
  }
  function pause() {
    if (paused) return;
    paused = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (activeId !== null) { activeId = null; qPush(0, curX, curY); }
    try { G.audio.suspend(); } catch (e) {}
    savePending();
  }
  function resume() {
    if (!paused || document.hidden || dead) return;
    paused = false; last = -1;
    try { G.audio.resume(); } catch (e) {}
    if (!raf) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
  window.addEventListener('pagehide', () => { pause(); try { saveFlush(); } catch (e) {} });
  window.addEventListener('pageshow', () => { resume(); });
  window.addEventListener('blur', savePending);

  if (document.hidden) paused = true; else raf = requestAnimationFrame(frame);
}

boot().catch((e) => { try { console.error('[engine] fatal', e); } catch (er) {} showFallback(e); });
