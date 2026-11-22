// Single-pointer input: one active finger, extra fingers ignored, page gestures suppressed.
import * as THREE from 'three';

// handlers: { down(p), move(p), up(p), firstDown(), anyDown() }; getView() -> { rect: {left,top,width,height} }
export function installInput(canvas, camera, getView, handlers) {
  let active = null; // { id, p, lastT }
  const raycaster = new THREE.Raycaster();
  const opt = { passive: false };
  const pd = (e) => { if (e.cancelable) e.preventDefault(); };

  // --- suppress scroll / zoom / callout / selection / context menu
  document.addEventListener('touchstart', pd, opt);
  document.addEventListener('touchmove', pd, opt);
  document.addEventListener('touchend', (e) => { handlers.anyUp && handlers.anyUp(); pd(e); }, opt);
  for (const n of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick', 'selectstart', 'dragstart']) {
    document.addEventListener(n, pd, opt);
  }
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) pd(e); }, opt);

  function fill(p, e, now) {
    const r = getView().rect;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dtE = Math.max(0.001, (now - p._lastT) / 1000);
    p.dx = x - p.x; p.dy = y - p.y;
    p.moved += Math.hypot(p.dx, p.dy);
    const a = 1 - Math.exp(-dtE / 0.06);
    p.vx += (p.dx / dtE - p.vx) * a;
    p.vy += (p.dy / dtE - p.vy) * a;
    p.speed = Math.hypot(p.vx, p.vy);
    p.x = x; p.y = y;
    p.t = (now - p._t0) / 1000;
    p._lastT = now;
    p.ndc = new THREE.Vector2((x / Math.max(1, r.width)) * 2 - 1, -(y / Math.max(1, r.height)) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(p.ndc, camera);
    p.ray = raycaster.ray.clone();
  }

  function onDown(e) {
    pd(e);
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (active) return; // only one finger
    const now = performance.now();
    const r = getView().rect;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const p = {
      id: e.pointerId, type: e.pointerType,
      x, y, startX: x, startY: y, dx: 0, dy: 0, vx: 0, vy: 0, speed: 0, moved: 0, t: 0,
      isTap: false, cancelled: false, ndc: null, ray: null, _t0: now, _lastT: now,
    };
    fill(p, e, now);
    p.dx = 0; p.dy = 0; p.moved = 0;
    active = { id: e.pointerId, p };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    handlers.down(p);
  }
  function onMove(e) {
    if (!active || e.pointerId !== active.id) return;
    pd(e);
    const now = performance.now();
    fill(active.p, e, now);
    handlers.move(active.p);
  }
  function finish(e, cancelled) {
    if (!active || e.pointerId !== active.id) return;
    const p = active.p;
    active = null;
    const now = performance.now();
    if (!cancelled && Number.isFinite(e.clientX)) fill(p, e, now); else p.t = (now - p._t0) / 1000;
    p.cancelled = !!cancelled;
    p.isTap = !cancelled && p.moved < 14 && p.t < 0.4;
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    handlers.up(p);
  }
  canvas.addEventListener('pointerdown', onDown, opt);
  canvas.addEventListener('pointermove', onMove, opt);
  canvas.addEventListener('pointerup', (e) => { pd(e); finish(e, false); }, opt);
  canvas.addEventListener('pointercancel', (e) => finish(e, true), opt);
  canvas.addEventListener('lostpointercapture', (e) => finish(e, true));
  // safety: pointer released outside / window blur
  window.addEventListener('pointerup', (e) => finish(e, false));
  window.addEventListener('blur', () => { if (active) finish({ pointerId: active.id }, true); });

  return {
    get down() { return !!active; },
    get pointer() { return active ? active.p : null; },
    cancel() { if (active) finish({ pointerId: active.id }, true); },
  };
}
