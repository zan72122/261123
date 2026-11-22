/* G.Engine — renderer, loop, input, camera, tween, particles, save. */
(function () {
  'use strict';

  var G = window.G = window.G || {};
  var THREE = window.THREE;

  var SAVE_KEY = 'gf-261123-1';
  var MAX_DT = 1 / 20;
  var DPR_MAX = 2;
  // fill-rate budget: big iPads at DPR 2 would shade ~5.7M px per frame
  var PIX_MAX = 3.2e6;

  var E = {
    renderer: null, scene: null, camera: null, canvas: null,
    low: false
  };
  G.Engine = E;

  // ---------------------------------------------------------------- utils
  var errCount = 0;
  function report(err) {
    // real bugs only; capped so a broken callback cannot flood the console
    if (errCount < 3) {
      errCount++;
      try { console.error(err); } catch (e) { /* ignore */ }
    }
    E.lastError = err;
  }
  function safe(fn, a, b, c) {
    try { return fn(a, b, c); } catch (err) { report(err); }
    return undefined;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function toV3(v, out) {
    out = out || new THREE.Vector3();
    if (!v) return out.set(0, 0, 0);
    if (v.isVector3) return out.copy(v);
    if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0);
    return out.set(+v.x || 0, +v.y || 0, +v.z || 0);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------- ease
  var ease = {
    linear: function (t) { return t; },
    in: function (t) { return t * t; },
    out: function (t) { return 1 - (1 - t) * (1 - t); },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outBounce: function (t) {
      var n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
      if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
      t -= 2.625 / d1; return n1 * t * t + 0.984375;
    },
    outElastic: function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    }
  };
  E.ease = ease;
  function getEase(e, def) {
    if (typeof e === 'function') return e;
    if (typeof e === 'string' && ease[e]) return ease[e];
    return def || ease.inOut;
  }

  // ---------------------------------------------------------------- clock
  var clock = 0;          // engine seconds (paused while hidden)
  var lastInput = 0;
  E.time = function () { return clock; };
  E.idle = function () { return Math.max(0, clock - lastInput); };

  // ---------------------------------------------------------------- tween
  var tweens = [];
  function Tween() {}
  function addTween(tw) {
    // overwrite: same target + same keys -> stop those keys in older tweens
    if (tw.target && tw.keys.length) {
      for (var i = 0; i < tweens.length; i++) {
        var o = tweens[i];
        if (o.dead || o.target !== tw.target || !o.keys.length) continue;
        var kept = [];
        for (var k = 0; k < o.keys.length; k++) {
          if (tw.keys.indexOf(o.keys[k]) < 0) kept.push(o.keys[k]);
        }
        if (kept.length !== o.keys.length) {
          o.keys = kept;
          if (!kept.length) o.dead = true;
        }
      }
    }
    tweens.push(tw);
    return { cancel: function () { tw.dead = true; } };
  }

  E.tween = function (target, toProps, dur, opts) {
    opts = opts || {};
    var tw = new Tween();
    tw.target = target;
    tw.to = {};
    tw.from = {};
    tw.keys = [];
    if (target && toProps) {
      for (var k in toProps) {
        if (Object.prototype.hasOwnProperty.call(toProps, k) && typeof toProps[k] === 'number' && isFinite(toProps[k])) {
          tw.keys.push(k);
          tw.to[k] = toProps[k];
        }
      }
    }
    tw.dur = Math.max(0, +dur || 0);
    tw.delay = Math.max(0, +opts.delay || 0);
    tw.ease = getEase(opts.ease, ease.inOut);
    tw.onUpdate = opts.onUpdate || null;
    tw.onDone = opts.onDone || null;
    tw.elapsed = 0;
    tw.started = false;
    tw.dead = false;
    tw.apply = null;
    return addTween(tw);
  };

  E.tweenQuat = function (obj, toQuat, dur, opts) {
    opts = opts || {};
    var q = obj && obj.isQuaternion ? obj : (obj && obj.quaternion);
    if (!q || !toQuat) return { cancel: function () {} };
    var tw = new Tween();
    var from = new THREE.Quaternion();
    var to = new THREE.Quaternion().copy(toQuat);
    tw.target = q;
    tw.keys = ['x', 'y', 'z', 'w'];
    tw.to = {}; tw.from = {};
    tw.dur = Math.max(0, +dur || 0);
    tw.delay = Math.max(0, +opts.delay || 0);
    tw.ease = getEase(opts.ease, ease.inOut);
    tw.onUpdate = opts.onUpdate || null;
    tw.onDone = opts.onDone || null;
    tw.elapsed = 0; tw.started = false; tw.dead = false;
    tw.start = function () { from.copy(q); };
    tw.apply = function (k) { q.slerpQuaternions(from, to, k); };
    return addTween(tw);
  };

  E.killTweens = function (target) {
    if (!target) return;
    for (var i = 0; i < tweens.length; i++) {
      var t = tweens[i];
      if (t.target === target || (target.quaternion && t.target === target.quaternion)) t.dead = true;
    }
  };

  E.after = function (sec, fn) {
    var tw = new Tween();
    tw.target = null; tw.keys = []; tw.to = {}; tw.from = {};
    tw.dur = 0; tw.delay = Math.max(0, +sec || 0);
    tw.ease = ease.linear; tw.onUpdate = null; tw.onDone = fn || null;
    tw.elapsed = 0; tw.started = false; tw.dead = false; tw.apply = null;
    return addTween(tw);
  };

  function updateTweens(dt) {
    var n = tweens.length; // tweens added during callbacks run next frame
    for (var i = 0; i < n; i++) {
      var tw = tweens[i];
      if (tw.dead) continue;
      var step = dt;
      if (tw.delay > 0) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        step = Math.min(-tw.delay, dt); // leftover time after the delay
        tw.delay = 0;
      }
      if (!tw.started) {
        tw.started = true;
        if (tw.start) safe(tw.start);
        else {
          for (var a = 0; a < tw.keys.length; a++) {
            var v = tw.target[tw.keys[a]];
            tw.from[tw.keys[a]] = typeof v === 'number' ? v : 0;
          }
        }
      }
      tw.elapsed += step;
      var p = tw.dur > 0 ? clamp(tw.elapsed / tw.dur, 0, 1) : 1;
      var k = tw.ease(p);
      if (tw.apply) {
        if (tw.keys.length) safe(tw.apply, k);
      } else {
        for (var b = 0; b < tw.keys.length; b++) {
          var key = tw.keys[b];
          tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
        }
      }
      if (tw.onUpdate) safe(tw.onUpdate, k, p);
      if (p >= 1) {
        tw.dead = true;
        if (tw.onDone) safe(tw.onDone);
      }
    }
    // compact
    var w = 0;
    for (var j = 0; j < tweens.length; j++) {
      if (!tweens[j].dead) tweens[w++] = tweens[j];
    }
    tweens.length = w;
  }

  // ---------------------------------------------------------------- camera
  var shotDesc = null;     // shot object or function
  var cam = {
    curT: null, curOff: null, curDist: 4, curFov: 32,
    fromT: null, fromDir: null, fromDist: 4, fromFov: 32,
    toT: null, toDir: null, toDist: 4, toFov: 32,
    dur: 0, el: 0, ease: ease.inOut, active: false
  };
  var shakeS = { amp: 0, dur: 0, el: 0, seed: 0 };
  var _v1, _v2, _v3, _dirTmp;

  function aspect() {
    return viewW / Math.max(1, viewH);
  }
  E.aspect = aspect;

  function fitDist(radius, fov, asp) {
    var vh = THREE.MathUtils.degToRad(fov) / 2;
    var hh = Math.atan(Math.tan(vh) * asp);
    var half = Math.min(vh, hh);
    return Math.max(0.05, radius / Math.max(1e-4, Math.sin(half)));
  }

  function evalShot() {
    var s = shotDesc;
    if (typeof s === 'function') s = safe(s, aspect());
    if (!s) return null;
    var fov = typeof s.fov === 'number' ? s.fov : 32;
    var r = typeof s.radius === 'number' ? s.radius : 1;
    var t = toV3(s.target || [0, 0, 0], new THREE.Vector3());
    var d = toV3(s.dir || [0, 0.3, 1], new THREE.Vector3());
    if (d.lengthSq() < 1e-10) d.set(0, 0, 1);
    d.normalize();
    return { t: t, dir: d, dist: fitDist(r, fov, aspect()), fov: fov };
  }

  function retargetShot(dur, easeFn) {
    var s = evalShot();
    if (!s) return;
    cam.toT = s.t; cam.toDir = s.dir; cam.toDist = s.dist; cam.toFov = s.fov;
    if (!cam.curT || dur <= 0) {
      cam.curT = s.t.clone();
      cam.curOff = s.dir.clone().multiplyScalar(s.dist);
      cam.curFov = s.fov;
      cam.active = false;
      applyCamera();
      return;
    }
    if (dur !== undefined) {
      cam.fromT = cam.curT.clone();
      cam.fromDist = cam.curOff.length();
      cam.fromDir = cam.curOff.clone().divideScalar(Math.max(1e-6, cam.fromDist));
      cam.fromFov = cam.curFov;
      cam.dur = dur; cam.el = 0; cam.ease = easeFn || ease.inOut; cam.active = true;
    }
  }

  E.setShot = function (shotOrFn, dur, opts) {
    if (!shotOrFn) return;
    shotDesc = shotOrFn;
    if (dur === undefined || dur === null) dur = 1.2;
    retargetShot(Math.max(0, +dur || 0), getEase(opts && opts.ease, ease.inOut));
  };

  // on resize: refit destination; mid-move keeps going from where it is
  function refitShot() {
    if (!shotDesc) return;
    if (cam.active) {
      var s = evalShot();
      if (s) { cam.toT = s.t; cam.toDir = s.dir; cam.toDist = s.dist; cam.toFov = s.fov; }
    } else {
      retargetShot(0);
    }
  }

  E.shake = function (amount, dur) {
    shakeS.amp = clamp(amount === undefined ? 0.5 : +amount || 0, 0, 2);
    shakeS.dur = Math.max(0.05, dur === undefined ? 0.35 : +dur || 0.35);
    shakeS.el = 0;
    shakeS.seed = Math.random() * 100;
  };

  function updateCamera(dt) {
    if (!cam.curT) return;
    if (cam.active) {
      cam.el += dt;
      var p = cam.dur > 0 ? clamp(cam.el / cam.dur, 0, 1) : 1;
      var k = cam.ease(p);
      cam.curT.lerpVectors(cam.fromT, cam.toT, k);
      _dirTmp.lerpVectors(cam.fromDir, cam.toDir, k);
      if (_dirTmp.lengthSq() < 1e-6) _dirTmp.copy(cam.toDir);
      _dirTmp.normalize();
      var dist = cam.fromDist + (cam.toDist - cam.fromDist) * k;
      cam.curOff.copy(_dirTmp).multiplyScalar(dist);
      cam.curFov = cam.fromFov + (cam.toFov - cam.fromFov) * k;
      if (p >= 1) cam.active = false;
    }
    applyCamera(dt);
  }

  function applyCamera(dt) {
    var c = E.camera;
    if (!c || !cam.curT) return;
    c.position.copy(cam.curT).add(cam.curOff);
    _v1.copy(cam.curT);
    if (shakeS.amp > 0) {
      shakeS.el += dt || 0;
      var q = shakeS.el / shakeS.dur;
      if (q >= 1) { shakeS.amp = 0; }
      else {
        var decay = (1 - q) * (1 - q);
        var a = shakeS.amp * decay * cam.curOff.length() * 0.012;
        var tt = shakeS.el * 38 + shakeS.seed;
        _v1.x += a * (Math.sin(tt * 1.0) + 0.5 * Math.sin(tt * 2.3 + 1.1));
        _v1.y += a * (Math.sin(tt * 1.3 + 2.0) + 0.5 * Math.sin(tt * 2.9 + 0.3));
        _v1.z += a * 0.5 * Math.sin(tt * 1.7 + 4.0);
      }
    }
    c.lookAt(_v1);
    if (Math.abs(c.fov - cam.curFov) > 1e-4 || c.aspect !== aspect()) {
      c.fov = cam.curFov;
      c.aspect = aspect();
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- view / resize
  var viewW = 1, viewH = 1;
  var resScale = 1;
  var onResizeCb = null;
  var resizeTimers = [];

  function measure() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1;
    var h = window.innerHeight || document.documentElement.clientHeight || 1;
    return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
  }

  function applyPixelRatio() {
    if (!E.renderer) return;
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    var px = viewW * viewH * dpr * dpr;
    if (px > PIX_MAX) dpr = Math.max(1, dpr * Math.sqrt(PIX_MAX / px));
    E.renderer.setPixelRatio(dpr * resScale);
    E.renderer.setSize(viewW, viewH, false);
  }

  function doResize(force) {
    var m = measure();
    if (!force && m[0] === viewW && m[1] === viewH) return;
    viewW = m[0]; viewH = m[1];
    applyPixelRatio();
    if (E.camera) {
      E.camera.aspect = aspect();
      E.camera.updateProjectionMatrix();
    }
    refitShot();
    if (onResizeCb) safe(onResizeCb, aspect());
  }

  function scheduleResize() {
    doResize(false);
    for (var i = 0; i < resizeTimers.length; i++) clearTimeout(resizeTimers[i]);
    resizeTimers = [
      setTimeout(function () { doResize(false); }, 120),
      setTimeout(function () { doResize(false); }, 350),
      setTimeout(function () { doResize(false); }, 800)
    ];
  }

  // ---------------------------------------------------------------- quality
  var qListeners = [];
  E.onQuality = function (fn) { if (typeof fn === 'function') qListeners.push(fn); };
  var q = { warm: 1.0, acc: 0, n: 0, win: 0, bad: 0, good: 0 };
  function resetQuality() { q.warm = 1.0; q.acc = 0; q.n = 0; q.win = 0; q.bad = 0; q.good = 0; }
  function setScale(s) {
    s = clamp(s, 0.6, 1);
    if (Math.abs(s - resScale) < 1e-3) return;
    resScale = s;
    applyPixelRatio();
    var low = resScale < 0.75;
    if (low !== E.low) {
      E.low = low;
      for (var i = 0; i < qListeners.length; i++) safe(qListeners[i], low);
    }
  }
  function measureQuality(rawDt) {
    if (q.warm > 0) { q.warm -= rawDt; return; }
    if (rawDt > 0.5) return; // hitch / tab switch, ignore
    q.acc += rawDt; q.n++; q.win += rawDt;
    if (q.win < 1) return;
    var avg = q.acc / Math.max(1, q.n);
    q.acc = 0; q.n = 0; q.win = 0;
    if (avg > 0.038) {
      q.good = 0; q.bad++;
      if (q.bad >= 2) { q.bad = 0; setScale(resScale * 0.85); }
    } else if (avg < 0.022) {
      q.bad = 0; q.good++;
      if (q.good >= 4 && resScale < 1) { q.good = 0; setScale(resScale / 0.85 > 0.97 ? 1 : resScale / 0.85); }
    } else {
      q.bad = 0; q.good = 0;
    }
  }

  // ---------------------------------------------------------------- input
  var handlers = null;
  var ptr = null; // active pointer state
  var raycaster = null;
  E.onPointer = function (h) { handlers = h || null; };

  function makeP(e, kind) {
    var rect = E.canvas.getBoundingClientRect();
    var x = e ? e.clientX - rect.left : (ptr ? ptr.x : 0);
    var y = e ? e.clientY - rect.top : (ptr ? ptr.y : 0);
    var w = rect.width || viewW, h = rect.height || viewH;
    var ndc = { x: (x / w) * 2 - 1, y: -(y / h) * 2 + 1 };
    var ray = new THREE.Ray();
    if (E.camera) {
      E.camera.updateMatrixWorld();
      raycaster.setFromCamera(_ndcV.set(ndc.x, ndc.y), E.camera);
      ray.copy(raycaster.ray);
    }
    if (ptr) {
      ptr.x = x; ptr.y = y;
      var d = Math.sqrt((x - ptr.downX) * (x - ptr.downX) + (y - ptr.downY) * (y - ptr.downY));
      if (d > ptr.moved) ptr.moved = d;
    }
    return {
      x: x, y: y, ndc: ndc, ray: ray, t: clock,
      downX: ptr ? ptr.downX : x, downY: ptr ? ptr.downY : y,
      moved: ptr ? ptr.moved : 0,
      held: ptr ? Math.max(0, clock - ptr.downT) : 0,
      cancelled: kind === 'cancel',
      pointerType: e && e.pointerType ? e.pointerType : (ptr ? ptr.type : 'touch')
    };
  }
  var _ndcV = null;

  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    lastInput = clock;
    if (ptr) return; // only the first finger
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var rect = E.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    ptr = { id: e.pointerId, downX: x, downY: y, x: x, y: y, moved: 0, downT: clock, type: e.pointerType };
    try { E.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = makeP(e, 'down');
    if (handlers && handlers.down) safe(handlers.down, p);
  }
  function onMove(e) {
    lastInput = clock;
    if (!ptr || e.pointerId !== ptr.id) return;
    var p = makeP(e, 'move');
    if (handlers && handlers.move) safe(handlers.move, p);
  }
  function onUp(e) {
    lastInput = clock;
    if (!ptr || e.pointerId !== ptr.id) return;
    var p = makeP(e, 'up');
    var id = ptr.id;
    ptr = null;
    try { if (E.canvas.hasPointerCapture(id)) E.canvas.releasePointerCapture(id); } catch (err) { /* ignore */ }
    if (handlers && handlers.up) safe(handlers.up, p);
    unlockAudio();
  }
  function onCancel(e) {
    if (!ptr || (e && e.pointerId !== undefined && e.pointerId !== ptr.id)) return;
    cancelPointer();
  }
  function cancelPointer() {
    if (!ptr) return;
    var p = makeP(null, 'cancel');
    var id = ptr.id;
    ptr = null;
    lastInput = clock;
    try { if (E.canvas.hasPointerCapture(id)) E.canvas.releasePointerCapture(id); } catch (err) { /* ignore */ }
    if (handlers && handlers.up) safe(handlers.up, p);
  }
  function unlockAudio() {
    // safety net for iOS: audio unlock also from a touchend/pointerup gesture
    if (G.Audio && typeof G.Audio.unlock === 'function') safe(G.Audio.unlock);
  }
  function prevent(e) { if (e.cancelable) e.preventDefault(); }

  function bindInput(cv) {
    cv.addEventListener('pointerdown', onDown, { passive: false });
    cv.addEventListener('pointermove', onMove, { passive: true });
    cv.addEventListener('pointerup', onUp, { passive: true });
    cv.addEventListener('pointercancel', onCancel, { passive: true });
    cv.addEventListener('lostpointercapture', onCancel, { passive: true });
    var opt = { passive: false };
    document.addEventListener('touchstart', prevent, opt);
    document.addEventListener('touchmove', prevent, opt);
    document.addEventListener('touchend', function (e) { prevent(e); unlockAudio(); }, opt);
    document.addEventListener('gesturestart', prevent, opt);
    document.addEventListener('gesturechange', prevent, opt);
    document.addEventListener('gestureend', prevent, opt);
    document.addEventListener('contextmenu', prevent, opt);
    document.addEventListener('dblclick', prevent, opt);
    document.addEventListener('selectstart', prevent, opt);
    document.addEventListener('wheel', prevent, opt);
    window.addEventListener('blur', cancelPointer);
  }

  // ---------------------------------------------------------------- pick / project
  var _pv = null, _pc = null;
  function isShown(o) {
    while (o) {
      if (o.visible === false) return false;
      o = o.parent;
    }
    return true;
  }
  E.project = function (v3) {
    var c = E.camera;
    if (!c) return { x: 0, y: 0, behind: true };
    _pv.copy(v3).project(c);
    // behind the camera: z > 1 after projection
    return { x: (_pv.x + 1) * 0.5 * viewW, y: (1 - _pv.y) * 0.5 * viewH, behind: _pv.z > 1 || _pv.z < -1 };
  };
  E.pick = function (cands, p) {
    var c = E.camera;
    if (!c || !cands || !p) return null;
    var best = null, bestD = Infinity;
    var pxPerUnit = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2));
    for (var i = 0; i < cands.length; i++) {
      var cd = cands[i];
      if (!cd || !cd.obj || !isShown(cd.obj)) continue;
      cd.obj.updateWorldMatrix(true, false);
      if (cd.offset) _pc.copy(cd.offset).applyMatrix4(cd.obj.matrixWorld);
      else _pc.setFromMatrixPosition(cd.obj.matrixWorld);
      // depth along view direction
      _pv.copy(_pc).applyMatrix4(c.matrixWorldInverse);
      var depth = -_pv.z;
      if (depth <= c.near) continue;
      _pv.copy(_pc).project(c);
      var sx = (_pv.x + 1) * 0.5 * viewW, sy = (1 - _pv.y) * 0.5 * viewH;
      var rPx = (cd.r || 0) * pxPerUnit / depth;
      var dx = sx - p.x, dy = sy - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rPx + 30 && d < bestD) { bestD = d; best = cd; }
    }
    return best;
  };
  E.rayPlane = function (ray, normal, point, out) {
    if (!ray) return null;
    var n = toV3(normal, new THREE.Vector3());
    if (n.lengthSq() < 1e-12) return null;
    n.normalize();
    var pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, toV3(point, new THREE.Vector3()));
    return ray.intersectPlane(pl, out || new THREE.Vector3());
  };

  // ---------------------------------------------------------------- particles
  var P = { emit: function () {}, release: function () {}, clear: function () {}, update: function () {} };
  E.particles = P;

  function makeCanvas(size, draw) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    var tx = new THREE.CanvasTexture(cv);
    tx.needsUpdate = true;
    return tx;
  }

  function shavingGeometry() {
    var N = 12, R0 = 0.0028, W = 0.0045, turns = 1.55;
    var pos = [], uv = [], idx = [];
    for (var i = 0; i <= N; i++) {
      var s = i / N;
      var th = -Math.PI / 2 + s * turns * Math.PI;
      var r = R0 * (1 - 0.5 * s);
      var x = r * Math.cos(th), y = R0 + r * Math.sin(th);
      var hw = W * 0.5 * (0.75 + 0.25 * Math.sin(s * Math.PI));
      pos.push(x, y, -hw, x, y, hw);
      uv.push(s, 0, s, 1);
    }
    for (var j = 0; j < N; j++) {
      var a = j * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  function makePointsPool(cap, tex, blending, color) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(cap * 3);
    var size = new Float32Array(cap);
    var alpha = new Float32Array(cap);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uColor: { value: new THREE.Color(color) },
        uScale: { value: 500 }
      },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aAlpha;',
        'uniform float uScale;',
        'varying float vAlpha;',
        'void main() {',
        '  vAlpha = aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.01, -mv.z) : 0.0;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uTex;',
        'uniform vec3 uColor;',
        'varying float vAlpha;',
        'void main() {',
        '  vec4 t = texture2D(uTex, gl_PointCoord);',
        '  gl_FragColor = vec4(uColor * t.rgb, t.a * vAlpha);',
        '  if (gl_FragColor.a < 0.003) discard;',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: blending
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    var items = [];
    for (var i = 0; i < cap; i++) items.push({ alive: false });
    return { pts: pts, geo: geo, mat: mat, pos: pos, size: size, alpha: alpha, items: items, cap: cap, live: 0 };
  }

  function initParticles(scene) {
    var LIM = { fly: 120, land: 260, dust: 40, sparkle: 60 };
    function lim(k) { return E.low ? Math.floor(LIM[k] / 2) : LIM[k]; }

    // --- shavings (InstancedMesh)
    var CAP = LIM.fly + LIM.land;
    var sGeo = shavingGeometry();
    var sMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0, side: THREE.DoubleSide
    });
    var mesh = new THREE.InstancedMesh(sGeo, sMat, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    var zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    var col = new THREE.Color();
    var woods = [0xd8b178, 0xe3c38e, 0xcda166, 0xe9cfa0, 0xc4955a];
    var S = [];
    for (var i = 0; i < CAP; i++) {
      mesh.setMatrixAt(i, zeroM);
      col.set(woods[i % woods.length]);
      col.offsetHSL(0, 0, rand(-0.03, 0.03));
      mesh.setColorAt(i, col);
      S.push({
        st: 0, p: new THREE.Vector3(), v: new THREE.Vector3(),
        e: new THREE.Euler(), w: new THREE.Vector3(), q: new THREE.Quaternion(),
        sc: 1, floorY: 0, t: 0, landT: 0
      });
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    var landedQ = [];   // slot indices, oldest first
    var flying = 0;
    var dirty = true;
    var _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
    var _up = new THREE.Vector3(0, 1, 0);

    function freeSlot(i) {
      var s = S[i];
      if (s.st === 1) flying--;
      if (s.st >= 2) { var k = landedQ.indexOf(i); if (k >= 0) landedQ.splice(k, 1); }
      s.st = 0;
      mesh.setMatrixAt(i, zeroM);
      dirty = true;
    }
    function takeSlot() {
      for (var i = 0; i < CAP; i++) if (S[i].st === 0) return i;
      if (landedQ.length) { var j = landedQ[0]; freeSlot(j); return j; }
      return -1;
    }
    function writeM(i) {
      var s = S[i];
      _s.setScalar(s.sc);
      _m.compose(s.p, s.q, _s);
      mesh.setMatrixAt(i, _m);
      dirty = true;
    }
    function launch(s, pos, dirV, speed, floorY) {
      s.st = 1; flying++;
      s.p.copy(pos);
      var d = _s.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1));
      if (dirV) d.multiplyScalar(0.6).add(dirV);
      d.normalize().multiplyScalar(speed * rand(0.45, 1.15));
      s.v.copy(d);
      s.e.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      s.w.set(rand(-18, 18), rand(-18, 18), rand(-18, 18));
      s.floorY = floorY;
      s.t = 0;
      s.q.setFromEuler(s.e);
    }
    var _pos = new THREE.Vector3(), _dir = new THREE.Vector3();

    function emitShaving(pos, o) {
      var n = Math.max(0, Math.round(o.count === undefined ? 6 : +o.count || 0));
      var room = Math.max(0, lim('fly') - flying);
      n = Math.min(n, room);
      var speed = o.speed === undefined ? 0.6 : +o.speed || 0;
      var floorY = o.floorY === undefined ? 0 : +o.floorY || 0;
      var dirV = o.dir ? toV3(o.dir, _dir).normalize() : null;
      var scale = o.scale === undefined ? 1 : +o.scale || 1;
      for (var k = 0; k < n; k++) {
        var i = takeSlot();
        if (i < 0) return;
        var s = S[i];
        s.sc = scale * rand(0.7, 1.35);
        launch(s, pos, dirV, speed, floorY);
        writeM(i);
      }
    }

    function updShavings(dt) {
      var landLim = lim('land');
      for (var i = 0; i < CAP; i++) {
        var s = S[i];
        if (s.st === 1) {
          s.t += dt;
          s.v.y -= 6.5 * dt;
          var drag = Math.max(0, 1 - 1.8 * dt);
          s.v.x *= drag; s.v.z *= drag;
          if (s.v.y < -1.6) s.v.y = -1.6; // light flakes: terminal velocity
          s.p.addScaledVector(s.v, dt);
          s.e.x += s.w.x * dt; s.e.y += s.w.y * dt; s.e.z += s.w.z * dt;
          s.q.setFromEuler(s.e);
          if (s.p.y <= s.floorY && s.v.y < 0) {
            s.p.y = s.floorY + 0.0003;
            s.st = 2; flying--;
            s.landT = 0;
            s.v.set(s.v.x * 0.35, 0, s.v.z * 0.35);
            // rest pose: lying on its side, random yaw, small tilt
            _e.set(rand(-0.25, 0.25), rand(0, 6.28), rand(-0.25, 0.25));
            if (Math.random() < 0.5) { _e.x += Math.PI / 2; s.p.y += 0.0022 * s.sc; }
            s.q.setFromEuler(_e);
            landedQ.push(i);
          } else if (s.t > 12) {
            freeSlot(i);
            continue;
          }
          writeM(i);
        } else if (s.st === 2) {
          s.landT += dt;
          var f = Math.max(0, 1 - 7 * dt);
          s.v.multiplyScalar(f);
          s.p.addScaledVector(s.v, dt);
          if (s.landT > 0.6 || s.v.lengthSq() < 1e-6) s.st = 3;
          writeM(i);
        }
      }
      while (landedQ.length > landLim) freeSlot(landedQ[0]);
      if (dirty) { mesh.instanceMatrix.needsUpdate = true; dirty = false; }
    }

    function release(center, radius, newFloorY) {
      var c = toV3(center, new THREE.Vector3());
      var r = radius === undefined ? 1 : +radius || 0;
      var fy = newFloorY === undefined ? 0 : +newFloorY || 0;
      var list = landedQ.slice();
      for (var k = 0; k < list.length; k++) {
        var i = list[k], s = S[i];
        if (s.p.distanceTo(c) > r) continue;
        var qi = landedQ.indexOf(i);
        if (qi >= 0) landedQ.splice(qi, 1);
        s.st = 0;
        _pos.copy(s.p);
        launch(s, _pos, _up, rand(0.15, 0.5), fy);
        writeM(i);
      }
    }

    // --- dust & sparkle (Points)
    var dustTex = makeCanvas(64, function (g, n) {
      var gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(0.7, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    });
    var sparkTex = makeCanvas(64, function (g, n) {
      var h = n / 2;
      var gr = g.createRadialGradient(h, h, 0, h, h, h);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
      // four soft rays
      g.globalCompositeOperation = 'lighter';
      for (var a = 0; a < 2; a++) {
        g.save(); g.translate(h, h); g.rotate(a * Math.PI / 2);
        var lg = g.createLinearGradient(-h, 0, h, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, 'rgba(255,255,255,0.8)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg; g.fillRect(-h, -1.2, n, 2.4);
        g.restore();
      }
    });
    var dust = makePointsPool(LIM.dust, dustTex, THREE.NormalBlending, 0xe2d6c2);
    var spark = makePointsPool(LIM.sparkle, sparkTex, THREE.AdditiveBlending, 0xfff0c8);
    dust.pts.renderOrder = 6;
    spark.pts.renderOrder = 7;
    scene.add(dust.pts);
    scene.add(spark.pts);

    function poolTake(pool, limit) {
      if (pool.live >= limit) return null;
      for (var i = 0; i < pool.cap; i++) {
        if (!pool.items[i].alive) { pool.live++; pool.items[i].alive = true; pool.items[i].i = i; return pool.items[i]; }
      }
      return null;
    }
    function emitDust(pos, o) {
      var n = Math.round(o.count === undefined ? 8 : +o.count || 0);
      var size = o.size === undefined ? 0.07 : +o.size || 0.07;
      for (var k = 0; k < n; k++) {
        var it = poolTake(dust, lim('dust'));
        if (!it) break;
        var a = rand(0, Math.PI * 2), sp = rand(0.08, 0.3) * (size / 0.07);
        it.p = new THREE.Vector3().copy(pos).add(_s.set(rand(-1, 1), rand(0, 0.5), rand(-1, 1)).multiplyScalar(size * 0.3));
        it.v = new THREE.Vector3(Math.cos(a) * sp, rand(0.03, 0.14), Math.sin(a) * sp);
        it.t = 0; it.life = rand(1.1, 1.9);
        it.s0 = size * rand(0.6, 1.1); it.s1 = it.s0 * rand(2.2, 3.2);
        it.a = rand(0.28, 0.45);
      }
    }
    function emitSparkle(pos, o) {
      var n = Math.round(o.count === undefined ? 8 : +o.count || 0);
      var size = o.size === undefined ? 0.035 : +o.size || 0.035;
      for (var k = 0; k < n; k++) {
        var it = poolTake(spark, lim('sparkle'));
        if (!it) break;
        var d = _s.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize();
        it.p = new THREE.Vector3().copy(pos).addScaledVector(d, size * rand(0.2, 1.2));
        it.v = d.clone().multiplyScalar(rand(0.05, 0.25) * (size / 0.035));
        it.v.y += 0.05;
        it.t = -rand(0, 0.25); it.life = rand(0.5, 0.95);
        it.s0 = size * rand(0.6, 1.3);
        it.ph = rand(0, 6.28); it.fr = rand(14, 26);
        it.a = 1;
      }
    }
    function updPool(pool, dt, fn) {
      // nothing alive now or last frame: buffers already hold zero alpha
      if (pool.live === 0 && !pool.wasLive) return;
      pool.wasLive = pool.live > 0;
      for (var i = 0; i < pool.cap; i++) {
        var it = pool.items[i];
        if (!it.alive) { pool.alpha[i] = 0; continue; }
        it.t += dt;
        if (it.t >= it.life) { it.alive = false; pool.live--; pool.alpha[i] = 0; continue; }
        fn(it, i, dt);
        pool.pos[i * 3] = it.p.x; pool.pos[i * 3 + 1] = it.p.y; pool.pos[i * 3 + 2] = it.p.z;
      }
      pool.geo.attributes.position.needsUpdate = true;
      pool.geo.attributes.aSize.needsUpdate = true;
      pool.geo.attributes.aAlpha.needsUpdate = true;
    }
    var _db = new THREE.Vector2();
    function updPoints(dt) {
      var c = E.camera, r = E.renderer;
      var h = r ? r.getDrawingBufferSize(_db).y : viewH;
      var sc = h / (2 * Math.tan(THREE.MathUtils.degToRad(c ? c.fov : 32) / 2));
      dust.mat.uniforms.uScale.value = sc;
      spark.mat.uniforms.uScale.value = sc;
      updPool(dust, dt, function (it, i, d) {
        var k = it.t / it.life;
        var drag = Math.max(0, 1 - 1.6 * d);
        it.v.x *= drag; it.v.z *= drag; it.v.y *= Math.max(0, 1 - 0.8 * d);
        it.p.addScaledVector(it.v, d);
        dust.size[i] = it.s0 + (it.s1 - it.s0) * (1 - (1 - k) * (1 - k));
        var fin = Math.min(1, it.t / 0.15);
        dust.alpha[i] = it.a * fin * (1 - k) * (1 - k);
      });
      updPool(spark, dt, function (it, i, d) {
        if (it.t < 0) { spark.alpha[i] = 0; return; }
        var k = it.t / it.life;
        it.p.addScaledVector(it.v, d);
        it.v.multiplyScalar(Math.max(0, 1 - 2.5 * d));
        var tw = 0.65 + 0.35 * Math.sin(it.ph + it.t * it.fr);
        var env = Math.sin(Math.PI * Math.min(1, k * 1.0));
        spark.size[i] = it.s0 * (0.6 + 0.6 * env);
        spark.alpha[i] = Math.max(0.0001, env * tw);
      });
    }

    P.emit = function (kind, pos, opts) {
      opts = opts || {};
      var p = toV3(pos, new THREE.Vector3());
      if (kind === 'shaving') emitShaving(p, opts);
      else if (kind === 'dust') emitDust(p, opts);
      else if (kind === 'sparkle') emitSparkle(p, opts);
    };
    P.release = release;
    P.clear = function () {
      for (var i = 0; i < CAP; i++) if (S[i].st !== 0) freeSlot(i);
      landedQ.length = 0; flying = 0;
      [dust, spark].forEach(function (pool) {
        for (var j = 0; j < pool.cap; j++) { pool.items[j].alive = false; pool.alpha[j] = 0; }
        pool.live = 0;
        pool.wasLive = false;
        pool.geo.attributes.aAlpha.needsUpdate = true;
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    P.update = function (dt) {
      updShavings(dt);
      updPoints(dt);
    };
    P.mesh = mesh;
  }

  // ---------------------------------------------------------------- save
  var save = (function () {
    var pending = null, timer = 0, lastWrite = -1e9;
    function write() {
      timer = 0;
      if (pending === null) return;
      try { window.localStorage.setItem(SAVE_KEY, pending); } catch (e) { /* ignore */ }
      pending = null;
      lastWrite = Date.now();
    }
    function parse(str) {
      if (typeof str !== 'string') return null;
      try {
        var o = JSON.parse(str);
        if (o && typeof o === 'object' && !Array.isArray(o) &&
            Object.getPrototypeOf(o) === Object.prototype) return o;
      } catch (e) { /* ignore */ }
      return null;
    }
    return {
      load: function () {
        try {
          if (pending !== null) return parse(pending);
          return parse(window.localStorage.getItem(SAVE_KEY));
        } catch (e) { return null; }
      },
      store: function (obj) {
        try {
          pending = JSON.stringify(obj);
          if (typeof pending !== 'string') { pending = null; return; }
        } catch (e) { pending = null; return; }
        if (timer) return;
        var wait = Math.max(0, 500 - (Date.now() - lastWrite));
        try { timer = setTimeout(write, wait); } catch (e) { write(); }
      },
      clear: function () {
        pending = null;
        if (timer) { clearTimeout(timer); timer = 0; }
        try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      },
      flush: function () {
        if (timer) { clearTimeout(timer); timer = 0; }
        write();
      }
    };
  })();
  E.save = save;

  // ---------------------------------------------------------------- shadow cache
  // The shadow pass is ~2/3 of all draw calls. Re-render the shadow map only
  // when a shadow caster or a shadow-casting light actually changed.
  var shRefs = [], shVals = new Float64Array(64 * 34), shN = 0, shDirty = true;
  function shGrow(n) {
    if (n * 34 <= shVals.length) return;
    var nv = new Float64Array(Math.max(n * 34, shVals.length * 2));
    nv.set(shVals);
    shVals = nv;
  }
  // writes one record (ref + up to 33 numbers); returns true when it differs
  function shRec(ref, a, b, extra) {
    var i = shN++;
    shGrow(shN);
    var o = i * 34, diff = shRefs[i] !== ref, k;
    shRefs[i] = ref;
    var ea = a.elements;
    for (k = 0; k < 16; k++) { if (shVals[o + k] !== ea[k]) { diff = true; shVals[o + k] = ea[k]; } }
    if (b) {
      var eb = b.elements;
      for (k = 0; k < 16; k++) { if (shVals[o + 16 + k] !== eb[k]) { diff = true; shVals[o + 16 + k] = eb[k]; } }
    }
    if (shVals[o + 32] !== extra) { diff = true; shVals[o + 32] = extra; }
    return diff;
  }
  var shChanged = false;
  function shVisit(o) {
    if (!o.castShadow) return;
    if (o.isMesh || o.isPoints || o.isLine) {
      var m = o.material, mv = 1;
      if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) if (m[i] && m[i].visible === false) mv += 2 << i; }
      else if (m && m.visible === false) mv = 0;
      if (shRec(o, o.matrixWorld, null, o.geometry ? o.geometry.id * 64 + mv : mv)) shChanged = true;
    } else if (o.isLight && o.shadow) {
      var sh = o.shadow;
      if (shRec(o, o.matrixWorld, o.target ? o.target.matrixWorld : null, sh.mapSize.x * 8192 + sh.mapSize.y)) shChanged = true;
      if (shRec(sh, sh.camera.projectionMatrix, null, sh.bias * 1e6 + sh.normalBias)) shChanged = true;
    }
  }
  function shadowNeedsUpdate(scene) {
    shN = 0; shChanged = shDirty; shDirty = false;
    var prevLen = shRefs.length;
    scene.traverseVisible(shVisit);
    if (shN !== prevLen) { shChanged = true; shRefs.length = shN; }
    return shChanged;
  }
  E.invalidateShadows = function () { shDirty = true; };

  function renderFrame() {
    var r = E.renderer, s = E.scene;
    // world matrices once here (render() skips it: matrixWorldAutoUpdate = false)
    s.updateMatrixWorld();
    if (r.shadowMap.enabled && !r.shadowMap.autoUpdate && shadowNeedsUpdate(s)) r.shadowMap.needsUpdate = true;
    r.render(s, E.camera);
  }

  // upload textures and compile shaders up front, so the first time a prop
  // appears (or the room darkens) does not stall a frame on iOS
  E.prewarm = function () {
    var r = E.renderer, s = E.scene;
    if (!r || !s) return;
    var seen = new Set();
    var KEYS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'lightMap', 'displacementMap'];
    s.traverse(function (o) {
      var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m || seen.has(m)) continue;
        seen.add(m);
        for (var k = 0; k < KEYS.length; k++) {
          var t = m[KEYS[k]];
          if (t && t.isTexture && !seen.has(t)) { seen.add(t); safe(function (tx) { r.initTexture(tx); }, t); }
        }
        if (m.uniforms) {
          for (var u in m.uniforms) {
            var v = m.uniforms[u] && m.uniforms[u].value;
            if (v && v.isTexture && !seen.has(v)) { seen.add(v); safe(function (tx) { r.initTexture(tx); }, v); }
          }
        }
      }
    });
    if (E.camera) safe(function () { r.compile(s, E.camera); });
  };

  // ---------------------------------------------------------------- loop
  var onFrameCb = null;
  var rafId = 0, lastNow = null, running = false, ctxLost = false;

  function frame(now) {
    rafId = 0;
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (lastNow === null) lastNow = now;
    var raw = (now - lastNow) / 1000;
    lastNow = now;
    if (!(raw >= 0)) raw = 0;
    var dt = Math.min(raw, MAX_DT);
    clock += dt;
    doResize(false);
    measureQuality(raw);
    if (onFrameCb) safe(onFrameCb, dt, clock);
    try { updateTweens(dt); } catch (err) { report(err); }
    try { updateCamera(dt); } catch (err) { report(err); }
    try { P.update(dt); } catch (err) { report(err); }
    if (!ctxLost) {
      try { renderFrame(); } catch (err) { report(err); }
    }
  }
  function start() {
    if (running) return;
    running = true;
    lastNow = null;
    resetQuality();
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function onVisibility() {
    var hidden = document.visibilityState === 'hidden' || document.hidden;
    if (G.Audio && typeof G.Audio.setPaused === 'function') safe(G.Audio.setPaused, !!hidden);
    if (hidden) {
      cancelPointer();
      save.flush();
      stop();
    } else {
      start();
      scheduleResize();
    }
  }

  // ---------------------------------------------------------------- fallback
  function showFallback() {
    var img = document.getElementById('fallback');
    if (img) img.hidden = false;
    var cv = document.getElementById('c');
    if (cv) cv.style.display = 'none';
  }

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return false;
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- init
  var inited = false;
  E.init = function (opts) {
    if (inited) return !!E.renderer;
    inited = true;
    opts = opts || {};
    onFrameCb = typeof opts.onFrame === 'function' ? opts.onFrame : null;
    onResizeCb = typeof opts.onResize === 'function' ? opts.onResize : null;

    if (!THREE || !webglAvailable()) { showFallback(); return false; }

    var cv = document.getElementById('c');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'c';
      cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;';
      document.body.insertBefore(cv, document.body.firstChild);
    }
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: cv, antialias: true, alpha: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: false
      });
    } catch (e) {
      showFallback();
      return false;
    }
    if (!renderer || !renderer.getContext()) { showFallback(); return false; }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;   // see renderFrame / shadow cache
    renderer.shadowMap.needsUpdate = true;
    renderer.setClearColor(0xe9e2d6, 1);

    E.renderer = renderer;
    E.canvas = cv;
    E.scene = new THREE.Scene();
    E.scene.matrixWorldAutoUpdate = false;   // updated once per frame in renderFrame
    E.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
    E.camera.position.set(0, 1, 3);

    _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3(); _v3 = new THREE.Vector3();
    _dirTmp = new THREE.Vector3();
    _pv = new THREE.Vector3(); _pc = new THREE.Vector3();
    _ndcV = new THREE.Vector2();
    raycaster = new THREE.Raycaster();

    var m = measure();
    viewW = m[0]; viewH = m[1];
    applyPixelRatio();
    E.camera.aspect = aspect();
    E.camera.updateProjectionMatrix();

    cv.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      ctxLost = true;
    }, false);
    cv.addEventListener('webglcontextrestored', function () {
      ctxLost = false;
      shDirty = true;
      applyPixelRatio();
    }, false);

    bindInput(cv);
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', scheduleResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', function () { save.flush(); });

    initParticles(E.scene);

    if (document.visibilityState !== 'hidden') start();
    return true;
  };
})();
