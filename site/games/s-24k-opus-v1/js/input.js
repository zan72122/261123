/* input.js — 指一本のタップとドラッグ。触れた物だけが反応する。 */
(function () {
  'use strict';
  const G = window.G;
  const I = (G.input = { down: false, id: null, ndc: new THREE.Vector2(), startNdc: new THREE.Vector2(), px: 0, py: 0, sx: 0, sy: 0, t0: 0, lastTouch: 0 });
  const ray = new THREE.Raycaster();
  const v = new THREE.Vector3();

  I.init = function (el) {
    I.el = el;
    const opt = { passive: false };
    el.addEventListener('pointerdown', onDown, opt);
    window.addEventListener('pointermove', onMove, opt);
    window.addEventListener('pointerup', onUp, opt);
    window.addEventListener('pointercancel', onUp, opt);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => e.preventDefault(), opt);
    el.addEventListener('touchmove', (e) => e.preventDefault(), opt);
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opt);
    // iOS では指を離した時の方が音を始めやすい
    window.addEventListener('touchend', () => { if (G.audio) G.audio.start(); }, { passive: true });
  };

  function setNdc(e) {
    const r = I.el.getBoundingClientRect();
    I.px = e.clientX; I.py = e.clientY;
    I.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  I.ray = function (ndc) {
    ray.setFromCamera(ndc || I.ndc, G.cam.camera);
    return ray.ray;
  };

  // 当たり判定（ゲームが今触れてよいとした物だけ）
  I.pick = function (ndc) {
    ray.setFromCamera(ndc || I.ndc, G.cam.camera);
    const list = G.kit.proxies.filter((p) => p.parent && isVisible(p) && G.game.pickable(p.userData.kind, p.userData.ref));
    const hits = ray.intersectObjects(list, false);
    if (!hits.length) return null;
    // 小さな物を優先：つまみ > 片口・さじ > 皿 > その他
    const pri = { knob: 5, frame: 4, pitcher: 3, spoon: 3, block: 2, rod: 2, plate: 1 };
    hits.sort((a, b) => (pri[b.object.userData.kind] || 0) - (pri[a.object.userData.kind] || 0) || a.distance - b.distance);
    return hits[0];
  };
  function isVisible(o) {
    while (o) { if (o.visible === false && !o.isMesh) return false; o = o.parent; }
    return true;
  }

  // 光線と平面
  I.onPlane = function (plane, out, ndc) {
    const r = I.ray(ndc);
    return r.intersectPlane(plane, out || new THREE.Vector3());
  };
  // 光線と直線（直線上で最も近い点のパラメータ）
  I.onLine = function (origin, dir, ndc) {
    const r = I.ray(ndc);
    // 2直線の最近点
    const w0 = v.subVectors(origin, r.origin);
    const a = dir.dot(dir), b = dir.dot(r.direction), c = r.direction.dot(r.direction);
    const d = dir.dot(w0), e = r.direction.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-6) return 0;
    return (b * e - c * d) / den;
  };

  function onDown(e) {
    e.preventDefault();
    if (G.audio) G.audio.start();
    if (I.down) return; // 指一本だけ
    I.down = true; I.id = e.pointerId;
    setNdc(e);
    I.startNdc.copy(I.ndc); I.sx = I.px; I.sy = I.py; I.t0 = G.time;
    I.lastTouch = G.time;
    try { I.el.setPointerCapture && I.el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    const hit = I.pick();
    G.game.onDown(hit);
  }
  function onMove(e) {
    if (!I.down || e.pointerId !== I.id) return;
    e.preventDefault();
    setNdc(e);
    I.lastTouch = G.time;
    G.game.onMove();
  }
  function onUp(e) {
    if (G.audio) G.audio.start();
    if (!I.down || e.pointerId !== I.id) return;
    setNdc(e);
    I.down = false; I.id = null;
    I.lastTouch = G.time;
    const moved = Math.hypot(I.px - I.sx, I.py - I.sy);
    G.game.onUp(moved < 12 && G.time - I.t0 < 0.45);
  }

  // テストや手本用：画面上の点で疑似操作
  I.simDown = function (ndc) { I.down = true; I.id = -1; I.ndc.copy(ndc); I.startNdc.copy(ndc); I.t0 = G.time; I.sx = I.px = ndc.x * 500; I.sy = I.py = -ndc.y * 500; G.game.onDown(I.pick()); };
  I.simMove = function (ndc) { I.ndc.copy(ndc); I.px = ndc.x * 500; I.py = -ndc.y * 500; G.game.onMove(); };
  I.simUp = function () { I.down = false; I.id = null; G.game.onUp(Math.hypot(I.px - I.sx, I.py - I.sy) < 12 && G.time - I.t0 < 0.45); };
})();
