/* game.js — G.Game: お話・操作・世界の中の手がかり・カメラ構図・保存
 * 依存: THREE, G.Engine, G.Props, G.Audio（SPEC.md / GAME.md の契約）。クラシックスクリプト。 */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var THREE = window.THREE;
  var PI = Math.PI, TAU = Math.PI * 2;
  var E = null, P = null, D = null;
  var scene = null, camera = null;

  // ------------------------------------------------------------------ utils
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function sm(dt, tau) { return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau); }
  function sstep(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function V(x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); }
  function Q() { return new THREE.Quaternion(); }
  var AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);
  function qa(axis, ang, out) { return (out || Q()).setFromAxisAngle(axis, ang); }
  var errN = 0;
  function report(e) { if (errN < 3) { errN++; try { console.error(e); } catch (x) { /* ignore */ } } }
  function snd(n, o) { try { if (G.Audio) G.Audio.play(n, o || {}); } catch (e) { /* ignore */ } }
  function has(o, f) { return !!(o && o.userData && typeof o.userData[f] === 'function'); }
  function vw() { return (E.canvas && E.canvas.clientWidth) || window.innerWidth || 1; }
  function vh() { return (E.canvas && E.canvas.clientHeight) || window.innerHeight || 1; }
  function minDim() { return Math.min(vw(), vh()); }
  function easeIn(k) { return k * k; }
  function easeOut(k) { return 1 - (1 - k) * (1 - k); }
  function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function linear(k) { return k; }
  function wpos(o, out) { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); }
  function proj(v) { var p = E.project(v); return p; }
  function pxDist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  var _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _q1 = Q(), _q2 = Q();

  // ------------------------------------------------------------------ state
  var STAGES = ['tower', 'boards', 'screwsA', 'flip', 'screwsB', 'stand', 'books', 'lamp', 'end'];
  function freshS() {
    return { v: 1, stage: 'tower', boards: 0, screws: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      battery: 'old', books: [], lampPlaced: false, lampOn: false };
  }
  var S = freshS();
  function si(st) { return STAGES.indexOf(st || S.stage); }
  function copyInto(dst, src) {
    dst.v = 1; dst.stage = src.stage; dst.boards = src.boards; dst.screws = src.screws.slice();
    dst.battery = src.battery; dst.books = src.books.slice(); dst.lampPlaced = src.lampPlaced; dst.lampOn = src.lampOn;
  }
  function validate(o) {
    var s = freshS();
    if (!o || typeof o !== 'object') return s;
    if (STAGES.indexOf(o.stage) >= 0) s.stage = o.stage;
    var ix = si(s.stage);
    s.boards = clamp(Math.round(+o.boards || 0), 0, 4);
    if (Array.isArray(o.screws) && o.screws.length === 12) {
      for (var i = 0; i < 12; i++) { var d = +o.screws[i]; s.screws[i] = isFinite(d) ? clamp(d, 0, 1) : 0; }
    }
    if (o.battery === 'old' || o.battery === 'dead' || o.battery === 'new') s.battery = o.battery;
    if (Array.isArray(o.books)) {
      for (var b = 0; b < o.books.length && s.books.length < 8; b++) {
        var id = Math.round(+o.books[b]);
        if (id >= 0 && id < 8 && s.books.indexOf(id) < 0) s.books.push(id);
      }
    }
    s.lampPlaced = !!o.lampPlaced; s.lampOn = !!o.lampOn && s.lampPlaced;
    // consistency
    var j;
    if (ix <= 1) { for (j = 0; j < 12; j++) s.screws[j] = 0; s.battery = 'old'; }
    if (ix === 0) s.boards = 0;
    if (ix === 1 && s.boards >= 4) { s.stage = 'screwsA'; ix = 2; }
    if (ix >= 2) s.boards = 4;
    if (ix <= 3) { for (j = 6; j < 12; j++) s.screws[j] = 0; s.battery = 'old'; }
    if (ix >= 3) for (j = 0; j < 6; j++) s.screws[j] = 1;
    if (ix === 2 && allDone(s.screws, 0)) { s.stage = 'flip'; ix = 3; }
    if (ix >= 5) { for (j = 6; j < 12; j++) s.screws[j] = 1; if (s.battery !== 'new') s.battery = 'new'; }
    if (ix === 4 && allDone(s.screws, 6)) { s.stage = 'stand'; ix = 5; if (s.battery !== 'new') s.battery = 'new'; }
    if (ix < 6) s.books = [];
    if (ix === 6 && s.books.length >= 8) { s.stage = 'lamp'; ix = 7; }
    if (ix >= 7 && s.books.length < 8) { s.stage = 'books'; ix = 6; }
    if (ix < 7) { s.lampPlaced = false; s.lampOn = false; }
    if (ix === 7 && s.lampOn) { s.stage = 'end'; ix = 8; }
    if (ix === 8 && !s.lampPlaced) { s.stage = 'lamp'; ix = 7; s.lampOn = false; }
    return s;
  }
  function allDone(arr, from) { for (var i = from; i < from + 6; i++) if (arr[i] < 1) return false; return true; }
  function doneCount() { var n = 0; for (var i = 0; i < 12; i++) if (S.screws[i] >= 1) n++; return n; }
  function save() { try { var o = {}; copyInto(o, S); E.save.store(o); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ world
  var W = {};
  var busy = false, busyGuard = null;
  var FR_POS = V(-0.04, 0.236, -0.20);
  var Q_L1 = qa(AZ, PI / 2);
  var Q_L2 = qa(AX, PI).multiply(Q_L1);
  var Q_ST = qa(AZ, -PI / 2).multiply(Q_L2.clone());
  var PIVOT = V(-0.04, 0.006, -0.20);
  var ST_POS = V(0.19, 0.006, -0.20);
  var FIN_POS = V(0.85, 0, -1.11);
  var MAT_Y = 0.006;
  var DRILL_MAT = V(0.08, MAT_Y, 0.10), DRILL_MAT_YAW = 0.35;
  var DRILL_CORNER = V(-0.80, MAT_Y, 0.22), DRILL_CORNER_YAW = 0.4;
  var CHARGER_POS = V(0.17, MAT_Y, 0.30);        // GAME.md の (0.12,-0.48) から移動（本棚のすべる道をあける）
  var KIT_POS = V(0.10, 0, -1.219);
  var LAMP_FLOOR = V(1.40, 0, -1.02);
  var LAMP_TOP = V(0.85, 0.72, -1.11);
  var TOWER_C = V(0.85, 0, -0.45);

  var fr = { phase: 'flat', flip: 0, stand: 0, slide: 0, nudge: 0, standWob: 0 };
  var shear = { amp: 0, t: 9 };
  var wob = [{ a: 0, t: 9 }, { a: 0, t: 9 }, { a: 0, t: 9 }];
  var boardSt = ['pile', 'pile', 'pile'];    // pile|placed|carry|anim
  var sideASt = 'mat';
  var pileLocal = [];                         // frame-local pile poses
  var sideAMatLocal = null;
  var screwHomeLocal = [];                    // side-local pos of seated screw
  var screwSpin = [];                         // extra visual spin

  function buildWorld() {
    D = P.DIM;
    W.lights = P.makeLights(scene, { low: !!E.low });
    W.room = P.makeRoom(); scene.add(W.room);
    W.mat = P.makeMat(); W.mat.position.set(D.mat.x, 0, D.mat.z); scene.add(W.mat);

    W.frame = new THREE.Group(); W.frame.name = 'frame'; scene.add(W.frame);
    var parts = P.makeShelfParts();
    W.sideA = parts.sideA; W.sideB = parts.sideB; W.boards = parts.boards; W.screws = parts.screws;
    W.frame.add(W.sideA); W.frame.add(W.sideB);
    for (var i = 0; i < 3; i++) W.frame.add(W.boards[i]);
    for (var s = 0; s < 12; s++) {
      var sc = W.screws[s], side = s < 6 ? W.sideA : W.sideB;
      side.add(sc);
      screwHomeLocal[s] = sc.userData.home.pos.clone().sub(side.userData.home.pos);
      screwSpin[s] = 0;
    }
    W.sideB.position.copy(W.sideB.userData.home.pos); W.sideB.quaternion.copy(W.sideB.userData.home.quat);

    // loose poses (frame is at L1 while these are used)
    var qInv = Q_L1.clone().invert();
    var pileW = [V(-0.42, MAT_Y + 0.010, 0.205), V(-0.405, MAT_Y + 0.030, 0.19), V(-0.43, MAT_Y + 0.050, 0.21)];
    var pileYaw = [0.03, -0.05, 0.07];
    for (var b = 0; b < 3; b++) {
      var qw = qa(AY, pileYaw[b]).multiply(W.boards[b].userData.home.quat);
      pileLocal[b] = { pos: pileW[b].clone().sub(FR_POS).applyQuaternion(qInv), quat: qInv.clone().multiply(qw) };
    }
    sideAMatLocal = { pos: V(-0.40, MAT_Y + 0.010, -0.55).sub(FR_POS).applyQuaternion(qInv), quat: W.sideA.userData.home.quat.clone() };

    W.drill = P.makeDrill(); scene.add(W.drill);
    W.bat1 = P.makeBattery(); W.bat2 = P.makeBattery();
    W.charger = P.makeCharger(); W.charger.position.copy(CHARGER_POS); W.charger.rotation.y = -0.35; scene.add(W.charger);

    W.books = [];
    for (var k = 0; k < 8; k++) { var bk = P.makeBook(k); W.books.push(bk); scene.add(bk); }
    W.lamp = P.makeLamp(); scene.add(W.lamp);
    W.box = P.makeKitBox(); scene.add(W.box);
    W.box.position.copy(KIT_POS); W.box.quaternion.copy(qa(AX, 80 * PI / 180));
    W.box.position.y = 0.150;

    W.haloF = P.makeHalo({ billboard: false }); scene.add(W.haloF); W.haloF.userData.setStrength(0);
    W.haloB = P.makeHalo({ billboard: true }); scene.add(W.haloB); W.haloB.userData.setStrength(0);
    W.ghost = P.makeGhostHand(); scene.add(W.ghost); W.ghost.userData.setOpacity(0);
    W.led = P.makeLedSpot(); scene.add(W.led); W.led.userData.setStrength(0);

    W.towerAnchor = new THREE.Object3D(); W.towerAnchor.position.set(TOWER_C.x, 0.18, TOWER_C.z); scene.add(W.towerAnchor);
    W.frameAnchor = new THREE.Object3D(); W.frame.add(W.frameAnchor); W.frameAnchor.position.set(0, 0.36, 0);
    W.shelfAnchor = W.frameAnchor;

    setupBooks();
  }

  // ------------------------------------------------------------------ frame pose
  function frameApply() {
    var f = W.frame;
    if (fr.phase === 'final' || fr.phase === 'slide') {
      var s = fr.phase === 'final' ? 1 : fr.slide;
      f.position.lerpVectors(ST_POS, FIN_POS, s);
      f.quaternion.copy(Q_ST);
    } else if (fr.phase === 'stand') {
      var ph = fr.stand + fr.nudge + fr.standWob;
      qa(AZ, -ph, _q1);
      f.quaternion.copy(_q1).multiply(Q_L2);
      _v1.copy(FR_POS).sub(PIVOT).applyQuaternion(_q1);
      f.position.copy(PIVOT).add(_v1);
    } else {
      var th = fr.flip + fr.nudge;
      qa(AX, -th, _q1);
      f.quaternion.copy(_q1).multiply(Q_L1);
      var ext = 0.23 * Math.abs(Math.cos(th)) + 0.12 * Math.abs(Math.sin(th));
      f.position.copy(FR_POS); f.position.y += (ext - 0.23);
    }
  }
  function frameTopSide() { return si() >= 4 ? W.sideB : W.sideA; }

  function shearAngle() {
    if (shear.amp <= 0) return 0;
    var t = shear.t;
    return shear.amp * Math.exp(-2.6 * t) * Math.sin(TAU * 1.9 * t);
  }

  function updFrameParts(dt) {
    shear.t += dt;
    var sh = shearAngle();
    var bFixed = si() < 4;   // B at the bottom (L1) => boards pivot at B
    var px = bFixed ? -0.21 : 0.21;
    for (var j = 0; j < 3; j++) {
      var b = W.boards[j];
      if (boardSt[j] === 'placed') {
        var w = wob[j]; w.t += dt;
        var a = sh + (w.a > 0 ? w.a * Math.exp(-3.5 * w.t) * Math.sin(TAU * 2.4 * w.t) : 0);
        var by = D.boardY[j];
        b.position.set(px - px * Math.cos(a), by - px * Math.sin(a), 0);
        b.quaternion.copy(qa(AZ, a, _q1));
      } else if (boardSt[j] === 'pile') {
        b.position.copy(pileLocal[j].pos); b.quaternion.copy(pileLocal[j].quat);
      }
    }
    if (sideASt === 'placed') {
      var hp = W.sideA.userData.home.pos;
      if (bFixed) W.sideA.position.set(hp.x - 0.42 * (1 - Math.cos(sh)), hp.y + 0.42 * Math.sin(sh), hp.z);
      else W.sideA.position.copy(hp);
      W.sideA.quaternion.copy(W.sideA.userData.home.quat);
    } else if (sideASt === 'mat') {
      W.sideA.position.copy(sideAMatLocal.pos); W.sideA.quaternion.copy(sideAMatLocal.quat);
    }
    var hb = W.sideB.userData.home.pos;
    if (!bFixed) W.sideB.position.set(hb.x + 0.42 * (1 - Math.cos(sh)), hb.y - 0.42 * Math.sin(sh), hb.z);
    else W.sideB.position.copy(hb);
  }

  function screwApply(i) {
    var sc = W.screws[i], d = S.screws[i];
    sc.position.copy(screwHomeLocal[i]).addScaledVector(sc.userData.axisOut, D.screwRaise * (1 - d));
    sc.quaternion.copy(sc.userData.home.quat).multiply(qa(AY, -(d * 8 * TAU) - screwSpin[i], _q2));
  }
  function screwRootW(i, out) {
    var side = i < 6 ? W.sideA : W.sideB;
    side.updateWorldMatrix(true, false);
    return out.copy(screwHomeLocal[i]).applyMatrix4(side.matrixWorld);
  }

  // ------------------------------------------------------------------ timers / anims / fx
  var timers = [];
  function later(sec, fn) { var t = { t: sec, fn: fn, dead: false }; timers.push(t); return t; }
  function updTimers(dt) {
    var n = timers.length;
    for (var i = 0; i < n; i++) {
      var t = timers[i];
      if (t.dead) continue;
      t.t -= dt;
      if (t.t <= 0) { t.dead = true; try { t.fn(); } catch (e) { report(e); } }
    }
    var w = 0;
    for (var j = 0; j < timers.length; j++) if (!timers[j].dead) timers[w++] = timers[j];
    timers.length = w;
  }

  var anims = [];
  // generic per-frame animation: fn(k, eased) ; done()
  function anim(dur, fn, done, ease, key) {
    if (key) stopAnim(key);
    var a = { el: 0, dur: Math.max(0.001, dur), fn: fn, done: done, ease: ease || easeInOut, key: key || null, dead: false };
    anims.push(a);
    return a;
  }
  function stopAnim(key) { for (var i = 0; i < anims.length; i++) if (anims[i].key === key) anims[i].dead = true; }
  function updAnims(dt) {
    var n = anims.length;
    for (var i = 0; i < n; i++) {
      var a = anims[i];
      if (a.dead) continue;
      a.el += dt;
      var k = clamp(a.el / a.dur, 0, 1);
      try { a.fn(k, a.ease(k)); } catch (e) { report(e); a.dead = true; }
      if (k >= 1 && !a.dead) { a.dead = true; if (a.done) { try { a.done(); } catch (e2) { report(e2); } } }
    }
    var w = 0;
    for (var j = 0; j < anims.length; j++) if (!anims[j].dead) anims[w++] = anims[j];
    anims.length = w;
  }
  // travel: move obj (in its parent space) from its pose now to target pose (fn(outPos,outQuat) or static)
  function travel(obj, toFn, dur, arc, done, ease) {
    var fp = obj.position.clone(), fq = obj.quaternion.clone(), tp = V(), tq = Q(), up = V();
    return anim(dur, function (k, e) {
      toFn(tp, tq);
      obj.position.lerpVectors(fp, tp, e);
      if (arc) {
        parentUp(obj, up);
        obj.position.addScaledVector(up, arc * 4 * k * (1 - k));
      }
      obj.quaternion.slerpQuaternions(fq, tq, e);
    }, done, ease || easeInOut, obj.uuid);
  }
  function parentUp(obj, out) {
    out.set(0, 1, 0);
    if (obj.parent && obj.parent !== scene) {
      obj.parent.getWorldQuaternion(_q2);
      out.applyQuaternion(_q2.invert());
    }
    return out;
  }
  function staticPose(p, q) { return function (op, oq) { op.copy(p); oq.copy(q); }; }

  // fx: visual offsets added after all systems, removed before next frame
  var fxs = [];
  function addFx(obj, type, amp, dur) {
    for (var i = 0; i < fxs.length; i++) if (fxs[i].obj === obj && fxs[i].type === type) { fxs[i].t = 0; fxs[i].amp = amp; fxs[i].dur = dur; return; }
    fxs.push({ obj: obj, type: type, amp: amp, dur: dur, t: 0, dp: V(), dq: Q(), on: false });
  }
  function fxUndo() {
    for (var i = 0; i < fxs.length; i++) {
      var f = fxs[i];
      if (!f.on) continue;
      f.obj.position.sub(f.dp);
      f.obj.quaternion.multiply(_q1.copy(f.dq).invert());
      f.on = false;
    }
    var w = 0;
    for (var j = 0; j < fxs.length; j++) if (fxs[j].t < fxs[j].dur) fxs[w++] = fxs[j];
    fxs.length = w;
  }
  function fxApply(dt) {
    for (var i = 0; i < fxs.length; i++) {
      var f = fxs[i];
      f.t += dt;
      var k = clamp(f.t / f.dur, 0, 1);
      f.dp.set(0, 0, 0); f.dq.identity();
      if (f.type === 'hop') {
        parentUp(f.obj, f.dp).multiplyScalar(f.amp * Math.sin(PI * k));
      } else if (f.type === 'nod') {
        qa(AX, f.amp * Math.sin(TAU * 3 * k) * (1 - k), f.dq);
      } else if (f.type === 'jitter') {
        f.dp.set((Math.random() - 0.5) * f.amp, (Math.random() - 0.5) * f.amp, (Math.random() - 0.5) * f.amp);
      } else if (f.type === 'tilt') {
        qa(AZ, f.amp * Math.sin(PI * k), f.dq);
      }
      f.obj.position.add(f.dp);
      f.obj.quaternion.multiply(f.dq);
      f.on = true;
    }
  }

  function setBusy(b, maxSec) {
    busy = !!b;
    if (busyGuard) { busyGuard.dead = true; busyGuard = null; }
    if (busy) busyGuard = later(maxSec || 6, function () { busy = false; busyGuard = null; });
  }

  // ------------------------------------------------------------------ batteries / charger
  function placeBatteries() {
    var dr = W.drill.userData.batterySlot, ch = W.charger.userData.slot;
    var inDrill = S.battery === 'new' ? W.bat2 : W.bat1;
    var inCh = S.battery === 'new' ? W.bat1 : W.bat2;
    dr.add(inDrill); inDrill.position.set(0, 0, 0); inDrill.quaternion.identity();
    ch.add(inCh); inCh.position.set(0, 0, 0); inCh.quaternion.identity();
    inDrill.userData.setLevel(S.battery === 'new' ? 3 : (S.battery === 'dead' ? 0 : 1));
    inDrill.userData.setBlink(0);
    inCh.userData.setLevel(S.battery === 'new' ? 0 : 3);
    inCh.userData.setBlink(0);
  }
  function chargerLed(t) {
    if (S.battery === 'new') W.charger.userData.setLed('red', 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 2.2)));
    else W.charger.userData.setLed('green', 1);
  }
  function spareBattery() { return S.battery === 'new' ? null : W.bat2; }

  // ------------------------------------------------------------------ drill
  var dr = {
    mode: 'static', screw: -1, tau: 0.035, finger: V(), yawC: 0, qc: Q(), arrived: false,
    burst: 0, pressT: 0, releasePending: false, rev: 0, spinV: 0, power: 1, dying: null,
    seatedNow: false, clutchOn: false, shavT: 0, weak: false, spinning: false, lastSeat: -1
  };
  var _dp = V(), _dq = Q(), _ds = { p: V(), q: Q() };
  function drillStandPose(point, yaw, op, oq) {
    var d = W.drill;
    _v4.copy(d.position); _q2.copy(d.quaternion);
    P.poseDrillStanding(d, point, yaw);
    op.copy(d.position); oq.copy(d.quaternion);
    d.position.copy(_v4); d.quaternion.copy(_q2);
  }
  function curScrew() {
    var base = si() >= 4 ? 6 : 0;
    for (var i = base; i < base + 6; i++) if (S.screws[i] < 1) return i;
    return -1;
  }
  function restPose(op, oq) {
    var ix = si();
    if (ix === 2 || ix === 4) {
      var top = frameTopSide();
      var c = curScrew();
      if (c < 0) c = (ix === 4 ? 11 : 5);
      var ys = D.boardY[(c % 6) >> 1];
      var ry = ys > 0.30 ? ys - 0.13 : ys + 0.13;   // shelf-space Y of the rest point
      var yawFlip = ys > 0.30 ? 1 : 0;
      var sideX = c < 6 ? D.sideX + D.T / 2 : -(D.sideX + D.T / 2);
      var hp = top.userData.home.pos;
      _v3.set(sideX - hp.x, ry - hp.y, 0);
      top.updateWorldMatrix(true, false);
      _v3.applyMatrix4(top.matrixWorld);
      // bit away from the screw: screw world x vs rest world x
      screwRootW(c, _v2);
      var yaw = _v2.x > _v3.x ? PI : 0;
      void yawFlip;
      drillStandPose(_v3, yaw + 0.0001, op, oq);
    } else if (ix >= 5) {
      drillStandPose(DRILL_CORNER, DRILL_CORNER_YAW, op, oq);
    } else {
      drillStandPose(DRILL_MAT, DRILL_MAT_YAW, op, oq);
    }
  }
  function drillToRest(dur, arc, done) {
    dr.mode = 'travel'; dr.screw = -1;
    travel(W.drill, restPose, dur, arc, function () { dr.mode = 'rest'; if (done) done(); }, easeInOut);
  }
  function computeCarryYaw() {
    // grip (+X) toward the camera-right and toward the camera
    camera.getWorldDirection(_v1); _v1.y = 0; if (_v1.lengthSq() < 1e-6) _v1.set(0, 0, -1); _v1.normalize();
    _v2.set(-_v1.z, 0, _v1.x);               // right
    _v3.copy(_v2).multiplyScalar(0.75).addScaledVector(_v1, -0.65).normalize();
    dr.yawC = Math.atan2(-_v3.z, _v3.x);
    dr.qc.copy(qa(AY, dr.yawC, _q1));
  }
  function screwHeadW(i, out) { return wpos(W.screws[i], out); }
  function fingerForTip(tipW, out) { return out.copy(W.drill.userData.bodyCenter).applyQuaternion(dr.qc).add(tipW); }

  // ------------------------------------------------------------------ books
  var bookSt = [];     // per book: {mode:'tower'|'floor'|'shelf'|'carry'|'anim', wig:0..}
  var towerOrder = [];  // level -> id (0 = bottom)
  var floorSlotOf = []; // id -> slot descriptor
  var BASE = [
    { x: 0.72, z: -0.14, yaw: 0.15, up: 1 }, { x: 1.00, z: -0.17, yaw: -0.22, up: -1 }, { x: 1.27, z: -0.12, yaw: 0.08, up: 1 },
    { x: 0.60, z: 0.21, yaw: -0.12, up: 1 }, { x: 0.88, z: 0.23, yaw: 0.28, up: 1 }, { x: 1.16, z: 0.19, yaw: -0.05, up: -1 }
  ];
  var TOPS = [{ on: [3, 4], x: 0.745, z: 0.225, yaw: 0.10 }, { on: [0, 1], x: 0.865, z: -0.155, yaw: -0.08 }];
  var slotOwner = {};  // 'b3' -> book id
  function setupBooks() {
    var ids = [0, 1, 2, 3, 4, 5, 6, 7];
    ids.sort(function (a, b) {
      var sa = W.books[a].userData.size, sb = W.books[b].userData.size;
      return sb.h * sb.w - sa.h * sa.w;
    });
    towerOrder = ids;
    // level -> floor slot
    var map = { 7: 'b0', 6: 'b1', 5: 'b3', 4: 'b4', 3: 'b5', 0: 'b2', 2: 't0', 1: 't1' };
    for (var L = 0; L < 8; L++) {
      var id = towerOrder[L];
      floorSlotOf[id] = map[L];
      slotOwner[map[L]] = id;
      bookSt[id] = { mode: 'tower', wig: 9, wigA: 0 };
    }
  }
  function bsz(id) { return W.books[id].userData.size; }
  function centerToOrigin(id, c, q, out) { return out.set(0, bsz(id).h / 2, 0).applyQuaternion(q).negate().add(c); }
  function bookOnFloor(id) { var m = bookSt[id].mode; return m === 'floor'; }
  var _fc = V(), _eul = new THREE.Euler();
  function floorPose(id, op, oq) {
    var sl = floorSlotOf[id], z = bsz(id);
    if (sl.charAt(0) === 'b') {
      var b = BASE[+sl.charAt(1)];
      qa(AY, PI / 2 + b.yaw, oq).multiply(qa(AZ, b.up * PI / 2, _q2));
      _fc.set(b.x, z.t / 2, b.z);
      centerToOrigin(id, _fc, oq, op);
      return;
    }
    var tp = TOPS[+sl.charAt(1)];
    var sA = slotOwner['b' + tp.on[0]], sB = slotOwner['b' + tp.on[1]];
    var hasA = bookOnFloor(sA), hasB = bookOnFloor(sB);
    var tA = bsz(sA).t, tB = bsz(sB).t;
    var xA = BASE[tp.on[0]].x, xB = BASE[tp.on[1]].x;
    var alpha = 0, cy = z.t / 2, cx = tp.x;
    if (hasA && hasB) {
      alpha = Math.atan2(tB - tA, xB - xA);
      cy = (tA + tB) / 2 + z.t / 2 / Math.cos(alpha) + 0.002;
    } else if (hasA || hasB) {
      var tS = hasA ? tA : tB, sg = hasA ? -1 : 1;
      alpha = -sg * Math.asin(clamp(tS / (z.h * 0.8), 0, 0.5));
      cy = tS / 2 + z.t / 2 + 0.003;
      cx = tp.x + sg * 0.03;
    }
    qa(AZ, alpha, oq).multiply(qa(AY, tp.yaw, _q2)).multiply(qa(AZ, PI / 2, _q1));
    _fc.set(cx, cy, tp.z);
    centerToOrigin(id, _fc, oq, op);
  }
  function towerPose(L, t, op, oq, amp) {
    var y = 0;
    for (var i = 0; i < L; i++) y += bsz(towerOrder[i]).t;
    var id = towerOrder[L], z = bsz(id);
    var H = 0.38;
    var f = Math.pow((y + z.t / 2) / H, 1.6);
    var sx = amp * f * Math.sin(1.25 * t - L * 0.38);
    var sz = amp * 0.6 * f * Math.sin(0.93 * t + 1.0 - L * 0.31);
    var yaw = 0.22 * Math.sin(L * 1.9 + 0.4) + PI / 2;
    qa(AY, yaw, oq).multiply(qa(AZ, PI / 2, _q2));
    _q1.setFromEuler(_eul.set(sz * 1.6, 0, -sx * 1.6));
    oq.premultiply(_q1);
    _fc.set(TOWER_C.x + 0.012 * Math.sin(L * 2.3) + sx, y + z.t / 2, TOWER_C.z + 0.010 * Math.cos(L * 1.7) + sz);
    centerToOrigin(id, _fc, oq, op);
  }
  function slotPose(rank, id, op, oq) {
    var row = rank < 4 ? 0 : 1, start = row * 4;
    var x = FIN_POS.x - 0.21 + 0.003;
    for (var r = start; r < rank; r++) x += bsz(S.books[r]).t + 0.003;
    var z = bsz(id);
    oq.identity();
    op.set(x + z.t / 2, row === 0 ? 0.0605 : 0.3805, FIN_POS.z + 0.12 - z.w / 2 - 0.008);
  }
  function nextSlotCenter(out) {
    var rank = S.books.length, row = rank < 4 ? 0 : 1, start = row * 4;
    var x = FIN_POS.x - 0.21 + 0.003;
    for (var r = start; r < rank; r++) x += bsz(S.books[r]).t + 0.003;
    return out.set(x + 0.025, (row === 0 ? 0.06 : 0.38), FIN_POS.z + 0.02);
  }
  function bookCenterW(id, out) {
    var b = W.books[id];
    return out.set(0, bsz(id).h / 2, 0).applyQuaternion(b.quaternion).add(b.position);
  }

  var tower = { t: 0, boost: 0, tease: 0, falling: false };

  function updBooks(dt) {
    var ix = si();
    if (ix === 0 && !tower.falling) {
      tower.t += dt;
      tower.boost *= Math.exp(-1.4 * dt);
      var amp = Math.min(0.03, 0.009 + 0.0012 * tower.t) + tower.boost;
      for (var L = 0; L < 8; L++) {
        var id = towerOrder[L];
        if (bookSt[id].mode !== 'tower') continue;
        towerPose(L, tower.t, W.books[id].position, W.books[id].quaternion, amp);
      }
    }
    for (var i = 0; i < 8; i++) {
      var st = bookSt[i], b = W.books[i];
      if (st.mode === 'floor') {
        floorPose(i, _v1, _q1);
        var k = sm(dt, 0.07);
        b.position.lerp(_v1, k); b.quaternion.slerp(_q1, k);
      } else if (st.mode === 'shelf') {
        var rank = S.books.indexOf(i);
        if (rank < 0) continue;
        slotPose(rank, i, b.position, b.quaternion);
        st.wig += dt;
        if (st.wig < 0.4) {
          var a = st.wigA * Math.sin(PI * st.wig / 0.4);
          // tip forward around the bottom front edge
          var z = bsz(i);
          _v2.set(b.position.x, b.position.y, b.position.z + z.w / 2);
          qa(AX, a, _q2);
          _v3.copy(b.position).sub(_v2).applyQuaternion(_q2);
          b.position.copy(_v2).add(_v3);
          b.quaternion.premultiply(_q2);
        }
      }
    }
  }
  function wiggleBook(id, amp, delay) {
    later(delay || 0, function () { if (bookSt[id].mode === 'shelf') { bookSt[id].wig = 0; bookSt[id].wigA = amp; } });
  }

  // ------------------------------------------------------------------ apply state
  var mood = { k: 0, last: -1 };
  function setMood(k) {
    mood.k = k;
    var q = Math.round(k * 50) / 50;
    if (q === mood.last) return;
    mood.last = q;
    try { W.lights.setMood(q); } catch (e) { report(e); }
    try { if (has(W.room, 'setMood')) W.room.userData.setMood(q); } catch (e2) { report(e2); }
  }
  var lampK = 0;

  function applyState() {
    var ix = si();
    anims.length = 0; timers.length = 0; fxs.length = 0;
    busy = false; busyGuard = null; press = null; carry = null;
    dr.dying = null; dr.burst = 0; dr.releasePending = false; dr.rev = 0; dr.spinV = 0; dr.spinning = false; dr.weak = false;
    dr.power = 1; dr.clutchOn = false; dr.screw = -1;
    try { G.Audio.clutch(false); } catch (e) { /* ignore */ }
    shear.amp = 0; shear.t = 9;
    for (var j = 0; j < 3; j++) { wob[j].a = 0; wob[j].t = 9; }
    fr.nudge = 0; fr.standWob = 0;
    if (ix <= 3) { fr.phase = 'flat'; fr.flip = 0; }
    else if (ix <= 5) { fr.phase = 'flat'; fr.flip = PI; }
    else { fr.phase = 'final'; fr.slide = 1; fr.stand = PI / 2; }
    frameApply();
    // boards & sides
    for (j = 0; j < 3; j++) {
      var placed = ix >= 2 || (ix === 1 && S.boards > (2 - j));
      boardSt[j] = placed ? 'placed' : 'pile';
    }
    sideASt = (ix >= 2 || S.boards >= 4) ? 'placed' : 'mat';
    for (var s = 0; s < 12; s++) {
      screwSpin[s] = 0;
      screwApply(s);
      W.screws[s].visible = s < 6 || ix >= 4;
    }
    updFrameParts(0);
    W.frame.updateMatrixWorld(true);
    // batteries & drill
    placeBatteries();
    restPose(W.drill.position, W.drill.quaternion);
    dr.mode = 'rest';
    W.drill.userData.setTrigger(0); W.drill.userData.setLed(0);
    // books
    for (var b = 0; b < 8; b++) {
      var st = bookSt[b]; st.wig = 9;
      if (ix === 0) st.mode = 'tower';
      else st.mode = S.books.indexOf(b) >= 0 ? 'shelf' : 'floor';
    }
    tower.t = 0; tower.boost = 0; tower.tease = 0; tower.falling = false;
    for (b = 0; b < 8; b++) {
      if (bookSt[b].mode === 'floor') floorPose(b, W.books[b].position, W.books[b].quaternion);
    }
    updBooks(0);
    // lamp
    if (S.lampPlaced) W.lamp.position.copy(LAMP_TOP); else W.lamp.position.copy(LAMP_FLOOR);
    W.lamp.quaternion.copy(qa(AY, 0.4, _q1));
    lampK = S.lampOn ? 1 : 0;
    W.lamp.userData.setOn(lampK);
    setMood(ix === 8 ? (S.lampOn ? 1 : 0.55) : 0);
    // particles: restore some shavings on the current top side
    try { E.particles.clear(); } catch (e3) { /* ignore */ }
    if (ix === 2 || ix === 4) {
      var base = ix === 4 ? 6 : 0;
      for (s = base; s < base + 6; s++) {
        var n = Math.round(S.screws[s] * 7);
        if (n > 0) { screwRootW(s, _v1); _v1.y += 0.004; E.particles.emit('shaving', _v1, { count: n, speed: 0.12, floorY: _v1.y - 0.004, dir: [0, 1, 0] }); }
      }
    }
    // glows off
    for (var g = 0; g < glowables.length; g++) setGlowK(glowables[g], 0);
    hintKey = ''; hintT = 0;
    W.ghost.userData.setOpacity(0); W.haloF.userData.setStrength(0); W.haloB.userData.setStrength(0);
  }

  // ------------------------------------------------------------------ camera shots
  function screwFocus(out) {
    var c = curScrew();
    var top = si() >= 4 ? 4 : 2;
    out.set(-0.40, 0.47, -0.20);
    if (c >= 0) { screwRootW(c, _v1); out.lerp(_v1, 0.3); }
    void top;
    return out;
  }
  var SHOTS = {
    tower: function (a) {
      return a < 1 ? { target: [0.70, 0.19, -0.36], dir: [0.25, 0.5, 1], radius: 0.36 }
        : { target: [0.42, 0.16, -0.30], dir: [0.15, 0.5, 1], radius: 0.42 };
    },
    boards: function (a) {
      return a < 1 ? { target: [-0.36, 0.06, -0.12], dir: [0.02, 1.3, 1], radius: 0.60 }
        : { target: [-0.33, 0.06, -0.14], dir: [0.02, 1.15, 1], radius: 0.55 };
    },
    screws: function (a) {
      var f = screwFocus(V());
      return a < 1 ? { target: [f.x, f.y + 0.05, f.z], dir: [0.95, 1.75, 0.45], radius: 0.30 }
        : { target: [f.x, f.y + 0.05, f.z], dir: [0.05, 1.35, 1], radius: 0.30 };
    },
    battery: function (a) {
      return a < 1 ? { target: [-0.20, 0.30, 0.02], dir: [0.35, 1.5, 1], radius: 0.50 }
        : { target: [-0.22, 0.28, 0.0], dir: [0.1, 1.2, 1], radius: 0.45 };
    },
    flip: function (a) {
      return a < 1 ? { target: [-0.40, 0.22, -0.18], dir: [0.12, 0.55, 1], radius: 0.48 }
        : { target: [-0.40, 0.22, -0.18], dir: [0.1, 0.5, 1], radius: 0.42 };
    },
    stand: function (a) {
      return a < 1 ? { target: [-0.14, 0.34, -0.20], dir: [0.06, 0.32, 1], radius: 0.62 }
        : { target: [-0.14, 0.34, -0.20], dir: [0.05, 0.3, 1], radius: 0.50 };
    },
    books: function (a) {
      return a < 1 ? { target: [0.90, 0.24, -0.42], dir: [0.0, 0.95, 1], radius: 0.70 }
        : { target: [0.92, 0.26, -0.48], dir: [0.0, 0.8, 1], radius: 0.62 };
    },
    lamp: function (a) {
      return a < 1 ? { target: [1.06, 0.34, -0.80], dir: [0.0, 0.6, 1], radius: 0.55 }
        : { target: [1.06, 0.34, -0.80], dir: [0.0, 0.55, 1], radius: 0.48 };
    },
    end: function (a) {
      return a < 1 ? { target: [0.72, 0.40, -0.95], dir: [0.05, 0.42, 1], radius: 0.72 }
        : { target: [0.72, 0.40, -0.95], dir: [0.05, 0.4, 1], radius: 0.62 };
    }
  };
  function shotFor(st) {
    if (st === 'screwsA' || st === 'screwsB') return S.battery === 'dead' ? SHOTS.battery : SHOTS.screws;
    return SHOTS[st] || SHOTS.boards;
  }
  function goShot(dur) { E.setShot(shotFor(S.stage), dur === undefined ? 1.2 : dur); }

  // ------------------------------------------------------------------ glow / hint director
  var glowables = [];
  var glowVal = new Map();
  function setGlowK(o, k) {
    if (!has(o, 'setGlow')) return;
    var prev = glowVal.get(o);
    if (prev !== undefined && Math.abs(prev - k) < 0.004) return;
    glowVal.set(o, k);
    o.userData.setGlow(k);
  }
  var hintKey = '', hintT = 0, hintNudgeT = 0, hintPinged = false, hintLevel = 0;

  function curHint() {
    if (busy) return null;
    var ix = si(), h = { key: S.stage, actors: [], gmul: 1, halo: null, from: null, to: null, toScr: null, kind: 'drag', nudge: null };
    var i;
    if (ix === 0) {
      if (tower.falling) return null;
      for (i = 0; i < 8; i++) h.actors.push(W.books[i]);
      h.gmul = 0.55; h.kind = 'tap';
      h.from = V(TOWER_C.x, 0.2, TOWER_C.z); h.to = null;
      h.nudge = function () { tower.boost = Math.max(tower.boost, 0.012); };
      return h;
    }
    if (ix === 1) {
      if (carry) return null;
      if (S.boards < 3) {
        var j = 2 - S.boards, b = W.boards[j];
        h.key = 'boards' + S.boards;
        h.actors = [b];
        h.from = wpos(b, V());
        _v1.copy(b.userData.home.pos); W.frame.localToWorld(_v1);
        h.to = _v1.clone();
        h.halo = { pos: V(_v1.x, MAT_Y + 0.0205, -0.20), sx: 0.035, sz: 0.16, bill: false };
        h.nudge = function () { addFx(b, 'hop', 0.025, 0.35); snd('tick', { vol: 0.25 }); };
      } else {
        h.key = 'boards3';
        h.actors = [W.sideA];
        h.from = wpos(W.sideA, V());
        _v1.copy(W.sideA.userData.home.pos); W.frame.localToWorld(_v1);
        h.to = _v1.clone();
        h.halo = { pos: V(-0.40, 0.447, -0.20), sx: 0.40, sz: 0.15, bill: false };
        h.nudge = function () { addFx(W.sideA, 'hop', 0.02, 0.35); };
      }
      return h;
    }
    if (ix === 2 || ix === 4) {
      if (dr.dying) return null;
      if (S.battery === 'dead') {
        var sp = spareBattery();
        if (!sp || carry) return null;
        h.key = 'battery';
        h.actors = [sp];
        h.from = wpos(sp, V()); h.from.y += 0.01;
        h.to = wpos(W.drill.userData.batterySlot, V());
        h.halo = { pos: h.to.clone(), sx: 0.07, sz: 0.07, bill: true };
        h.nudge = function () { addFx(sp, 'hop', 0.02, 0.3); };
        return h;
      }
      var c = curScrew();
      if (c < 0 || dr.mode !== 'rest' || press) return null;
      h.key = S.stage + c;
      h.actors = [W.drill];
      h.kind = 'hold';
      h.from = V().copy(W.drill.userData.bodyCenter); W.drill.localToWorld(h.from);
      screwHeadW(c, _v1);
      if (!dr.qcSet) { computeCarryYaw(); dr.qcSet = true; }
      h.to = fingerForTip(_v1, V());
      screwRootW(c, _v2);
      h.halo = { pos: V(_v2.x, _v2.y + 0.001, _v2.z), sx: 0.03, sz: 0.03, bill: false };
      h.nudge = function () { addFx(W.screws[c], 'nod', 0.25, 0.5); addFx(W.drill, 'hop', 0.015, 0.3); };
      return h;
    }
    if (ix === 3) {
      if (flip.drag) return null;
      h.actors = [W.sideA];
      h.from = V(-0.40, 0.40, -0.10);
      h.toScr = { dx: 0, dy: -0.5 };
      h.halo = { pos: V(-0.40, 0.468, -0.085), sx: 0.36, sz: 0.025, bill: false };
      h.nudge = function () { rockFrame(0.09); };
      return h;
    }
    if (ix === 5) {
      if (stand.drag) return null;
      h.actors = [W.sideB];
      h.from = V(-0.66, 0.40, -0.10);
      h.toScr = { dx: 0, dy: -0.45 };
      h.halo = { pos: V(-0.74, 0.30, -0.08), sx: 0.12, sz: 0.12, bill: true };
      h.nudge = function () { rockFrame(0.07); };
      return h;
    }
    if (ix === 6) {
      if (carry) return null;
      var id = chooseBook();
      if (id < 0) return null;
      h.key = 'books' + S.books.length + ':' + id;
      h.actors = [W.books[id]];
      h.from = bookCenterW(id, V());
      h.to = nextSlotCenter(V()); h.to.y += 0.10;
      var sc = nextSlotCenter(V());
      h.halo = { pos: V(sc.x, sc.y + 0.002, sc.z - 0.02), sx: 0.04, sz: 0.09, bill: false };
      h.nudge = function () { addFx(W.books[id], 'hop', 0.02, 0.3); };
      return h;
    }
    if (ix === 7) {
      if (carry) return null;
      if (!S.lampPlaced) {
        h.key = 'lamp0';
        h.actors = [W.lamp];
        h.from = V(LAMP_FLOOR.x, 0.14, LAMP_FLOOR.z);
        h.to = V(LAMP_TOP.x, LAMP_TOP.y + 0.14, LAMP_TOP.z);
        h.halo = { pos: V(LAMP_TOP.x, LAMP_TOP.y + 0.002, LAMP_TOP.z), sx: 0.11, sz: 0.11, bill: false };
      } else {
        h.key = 'lamp1';
        h.actors = [W.lamp]; h.kind = 'tap';
        h.from = V(LAMP_TOP.x, LAMP_TOP.y + 0.16, LAMP_TOP.z);
      }
      h.nudge = function () { addFx(W.lamp, 'hop', 0.015, 0.3); };
      return h;
    }
    if (ix === 8) {
      h.key = 'end';
      h.actors = [W.box]; h.kind = 'tap';
      h.from = V(KIT_POS.x, 0.16, KIT_POS.z + 0.05);
      h.delay = 12;
      h.nudge = function () { addFx(W.box, 'hop', 0.01, 0.3); };
      return h;
    }
    return null;
  }

  var curH = null;
  function cueScreen(h, out) {
    var f = proj(h.from);
    out.from = { x: f.x, y: f.y };
    out.to = null;
    if (h.to) { var t = proj(h.to); out.to = { x: t.x, y: t.y }; }
    else if (h.toScr) out.to = { x: f.x + h.toScr.dx * minDim(), y: f.y + h.toScr.dy * minDim() };
    out.kind = h.kind;
    return out;
  }
  function screenToWorld(x, y, refW, out) {
    camera.getWorldDirection(_v1);
    var depth = _v2.copy(refW).sub(camera.position).dot(_v1);
    out.set((x / vw()) * 2 - 1, -(y / vh()) * 2 + 1, 0.5).unproject(camera);
    out.sub(camera.position).normalize();
    var cosA = out.dot(_v1);
    return out.multiplyScalar(depth / Math.max(0.05, cosA)).add(camera.position);
  }

  function updHint(dt) {
    var h = curHint();
    curH = h;
    var key = h ? h.key : '';
    if (key !== hintKey) { hintKey = key; hintT = 0; hintNudgeT = 0; hintPinged = false; }
    hintT += dt;
    var idle = E.idle();
    var age = Math.min(idle, hintT);
    var actorSet = h ? h.actors : [];
    if (h && h.delay) {
      age = idle - h.delay;
      if (age < 0) { actorSet = []; h = null; }
    }
    var t = E.time();
    var level = age >= 12 ? 3 : age >= 8 ? 2 : age >= 4 ? 1 : 0;
    if (!h) level = -1;
    hintLevel = level;
    // glow
    var k = 0;
    if (h) {
      if (level < 2) k = 0.25 + 0.45 * (0.5 - 0.5 * Math.cos(TAU * t / 1.4));
      else k = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(TAU * t / 0.8));
    }
    for (var i = 0; i < glowables.length; i++) {
      var o = glowables[i];
      setGlowK(o, actorSet.indexOf(o) >= 0 ? k * (h ? h.gmul : 1) : 0);
    }
    // charger LED pulse when the spare battery is the actor
    if (h && h.key === 'battery') W.charger.userData.setLed('green', 0.4 + 0.6 * k);
    else chargerLed(t);
    // halo
    var hf = W.haloF, hb = W.haloB;
    if (h && h.halo) {
      var hal = h.halo, mul = level >= 2 ? 1.35 : 1;
      var hk = (0.45 + 0.55 * k);
      if (hal.bill) {
        hb.position.copy(hal.pos); hb.scale.set(hal.sx * mul, hal.sx * mul, 1); hb.userData.setStrength(hk);
        hf.userData.setStrength(0);
      } else {
        hf.position.copy(hal.pos); hf.scale.set(hal.sx * mul, 1, hal.sz * mul); hf.userData.setStrength(hk);
        hb.userData.setStrength(0);
      }
    } else { hf.userData.setStrength(0); hb.userData.setStrength(0); }
    // nudge
    if (h && level >= 1) {
      if (!hintPinged) { hintPinged = true; snd('ping', { vol: 0.6 }); }
      hintNudgeT -= dt;
      if (hintNudgeT <= 0) { hintNudgeT = 2; if (h.nudge) { try { h.nudge(); } catch (e) { report(e); } } }
    }
    // ghost hand
    updGhost(h, level, age);
  }

  var _cue = {};
  var _gw = V();
  function updGhost(h, level, age) {
    var gh = W.ghost;
    if (!h || level < 3 || press) { gh.userData.setOpacity(0); return; }
    cueScreen(h, _cue);
    var gt = (age - 12) % 3.5, x = _cue.from.x, y = _cue.from.y, op = 0, sc = 1;
    if (h.kind === 'tap' || !_cue.to) {
      op = gt < 0.3 ? gt / 0.3 : gt > 2.4 ? Math.max(0, 1 - (gt - 2.4) / 0.4) : 1;
      if ((gt > 0.6 && gt < 0.8) || (gt > 1.2 && gt < 1.4)) sc = 0.86;
    } else {
      var tx = _cue.to.x, ty = _cue.to.y;
      if (gt < 0.35) { op = gt / 0.35; }
      else if (gt < 0.6) { op = 1; sc = 0.86; }
      else if (gt < 1.9) {
        op = 1; sc = 0.86;
        var k = easeInOut((gt - 0.6) / 1.3);
        x = lerp(x, tx, k); y = lerp(y, ty, k) - Math.sin(PI * k) * 0.08 * minDim();
      } else if (gt < 2.7) {
        op = 1; x = tx; y = ty; sc = h.kind === 'hold' ? 0.86 + 0.04 * Math.sin((gt - 1.9) * 20) : 0.86;
      } else { x = tx; y = ty; op = Math.max(0, 1 - (gt - 2.7) / 0.35); }
    }
    screenToWorld(x, y, h.from, _gw);
    gh.position.copy(_gw);
    camera.getWorldDirection(_v1);
    var depth = _v2.copy(_gw).sub(camera.position).dot(_v1);
    var worldH = 0.15 * 2 * depth * Math.tan(camera.fov * PI / 360) * (vh() / Math.max(1, minDim())) * (minDim() / vh());
    gh.scale.setScalar(sc * worldH / 0.16);
    gh.userData.setOpacity(op);
  }

  // ------------------------------------------------------------------ carry (shared drag-to-place)
  var carry = null;   // {obj, space, target(world), hover, snap, pose(k, worldPt), place(fly), back(), base(out)}
  var press = null;
  var _fw = V();
  function planeHit(p, hover, out) {
    _v1.copy(camera.position).sub(hover).normalize();
    return E.rayPlane(p.ray, _v1, hover, out);
  }
  function startCarry(c, p) {
    carry = c;
    c.cur = c.base(V());
    c.finger = c.cur.clone();
    c.k = 0;
    planeHit(p, c.hover, c.finger) || c.finger.copy(c.cur);
    c.finger.y = Math.max(c.finger.y, c.minY || 0);
    c.snapped = false;
    snd('tick', { vol: 0.5, pitch: 1.1 });
  }
  function carryMove(p) {
    if (!carry || carry.snapped) return;
    if (planeHit(p, carry.hover, _fw)) { carry.finger.copy(_fw); carry.finger.y = Math.max(carry.finger.y, carry.minY || 0); }
  }
  function updCarry(dt) {
    if (!carry || carry.snapped) return;
    var c = carry;
    c.cur.lerp(c.finger, sm(dt, 0.04));
    var bp = proj(c.cur), tp = proj(c.target);
    var d = c.distFn ? c.distFn(bp) : pxDist(bp, tp);
    c.k += (clamp(1 - (d - c.snap) / 240, 0, 1) - c.k) * sm(dt, 0.06);
    c.pose(c.k, c.cur);
    if (d <= c.snap) { c.snapped = true; var cc = c; carry = null; cc.place(false); }
  }
  function carryUp(p) {
    if (!carry) return;
    var c = carry; carry = null;
    if (c.snapped) return;
    if (p.moved < 12 && !p.cancelled) { snd('whoosh', { vol: 0.6 }); c.place(true); }
    else c.back();
  }

  // ------------------------------------------------------------------ stages: tower
  function towerDown(p) {
    if (tower.falling || busy) return;
    var hit = E.pick([{ id: 'tower', obj: W.towerAnchor, r: 0.35 }], p);
    if (hit || tower.tease >= 1) { collapseTower(); return; }
    tower.tease++;
    tower.boost = 0.035;
    snd('creak', { vol: 0.8 });
  }
  function collapseTower() {
    tower.falling = true;
    setBusy(true, 5);
    snd('creak', { vol: 0.6, pitch: 1.2 });
    E.shake(0.4, 0.5);
    var tops = 7;
    for (var L = tops; L >= 1; L--) (function (L) {
      var id = towerOrder[L];
      later((tops - L) * 0.05, function () {
        bookSt[id].mode = 'anim';
        var b = W.books[id], tp = V(), tq = Q();
        var dur = 0.55 + (L % 3) * 0.07;
        travel(b, function (op, oq) { floorPose(id, tp, tq); op.copy(tp); oq.copy(tq); }, dur, 0.12 + L * 0.025, function () {
          bookSt[id].mode = 'floor';
          var z = bsz(id);
          snd('tumble', { vol: 0.7, pitch: clamp(1.35 - (z.h * z.w - 0.03) * 8, 0.75, 1.4) });
          addFx(b, 'hop', 0.012, 0.18);
          if (L % 2 === 0) E.particles.emit('dust', bookCenterW(id, V()), { count: 4, size: 0.06 });
        }, linear);
      });
    })(L);
    // the bottom book: stands up on its edge, waits, then falls flat (ぱたん)
    var id0 = towerOrder[0];
    later(0.45, function () {
      bookSt[id0].mode = 'anim';
      var b = W.books[id0], z = bsz(id0);
      var fp = V(), fq = Q(); floorPose(id0, fp, fq);
      // derive the upright pose that falls onto (fp,fq): pivot at the bottom back edge
      var yawQ = Q().copy(fq).multiply(qa(AZ, -PI / 2, Q()));         // = Ry(yaw')
      var axis = V(0, 0, 1).applyQuaternion(yawQ);
      var fall = qa(axis, PI / 2, Q());
      // pivot (world) = flat origin + fq*(-t/2,0,0)
      var pivot = V(-z.t / 2, 0, 0).applyQuaternion(fq).add(fp);
      var invFall = fall.clone().invert();
      var up = V().copy(fp).sub(pivot).applyQuaternion(invFall).add(pivot);
      var uq = Q().copy(invFall).multiply(fq);
      travel(b, staticPose(up, uq), 0.5, 0.05, function () {
        snd('tumble', { vol: 0.5, pitch: 1.25 });
        addFx(b, 'tilt', 0.08, 0.5);
        later(0.55, function () {
          var bp0 = b.position.clone(), bq0 = b.quaternion.clone();
          anim(0.32, function (k, e) {
            var a = e * PI / 2;
            qa(axis, a, _q1);
            b.position.copy(bp0).sub(pivot).applyQuaternion(_q1).add(pivot);
            b.quaternion.copy(_q1).multiply(bq0);
          }, function () {
            bookSt[id0].mode = 'floor';
            snd('tumble', { vol: 0.9, pitch: 1.45 });
            E.particles.emit('dust', bookCenterW(id0, V()), { count: 6, size: 0.07 });
            E.shake(0.2, 0.25);
            later(1.0, function () {
              S.stage = 'boards'; S.boards = 0; save();
              goShot(1.6);
              later(1.6, function () { setBusy(false); });
            });
          }, easeIn, b.uuid);
        });
      }, easeOut);
    });
  }

  // ------------------------------------------------------------------ stages: boards
  function boardsDown(p) {
    if (busy) return;
    var cands = [];
    var next = S.boards < 3 ? 2 - S.boards : -1;
    for (var j = 0; j < 3; j++) {
      if (boardSt[j] === 'pile') cands.push({ id: 'pile', obj: W.boards[j], r: 0.14 });
      else if (boardSt[j] === 'placed') cands.push({ id: 'b' + j, obj: W.boards[j], r: 0.09 });
    }
    cands.push({ id: 'sideA', obj: W.sideA, r: 0.2 });
    cands.push({ id: 'drill', obj: W.drill, r: 0.1, offset: W.drill.userData.bodyCenter });
    cands.push({ id: 'charger', obj: W.charger, r: 0.07 });
    var hit = E.pick(cands, p);
    if (!hit) return;
    if (hit.id === 'pile' && next >= 0) { grabBoard(next, p); return; }
    if (hit.id === 'sideA' && S.boards === 3) { grabSideA(p); return; }
    if (hit.id === 'sideA' || hit.id === 'pile') { addFx(hit.obj, 'hop', 0.008, 0.2); snd('tick', { vol: 0.5 }); return; }
    if (hit.id.charAt(0) === 'b') { var w = wob[+hit.id.charAt(1)]; w.a = 0.06; w.t = 0; snd('tick', { vol: 0.6, pitch: 0.9 }); return; }
    if (hit.id === 'drill') { drillRev(); return; }
    if (hit.id === 'charger') { addFx(W.charger, 'hop', 0.006, 0.18); snd('tick', { vol: 0.5, pitch: 1.3 }); }
  }
  function frameLocalOf(w, out) { return W.frame.worldToLocal(out.copy(w)); }
  function grabBoard(j, p) {
    var b = W.boards[j];
    boardSt[j] = 'carry';
    var tw = V().copy(b.userData.home.pos); W.frame.localToWorld(tw);
    var lyingQ = pileLocal[j].quat.clone(), homeQ = b.userData.home.quat.clone();
    startCarry({
      obj: b, target: tw, hover: V(tw.x, tw.y + 0.05, tw.z + 0.06), snap: 70, minY: MAT_Y + 0.03,
      base: function (o) { return wpos(b, o); },
      pose: function (k, w) {
        frameLocalOf(w, b.position);
        b.quaternion.slerpQuaternions(lyingQ, homeQ, sstep(k));
      },
      place: function (fly) {
        setBusy(true, 3);
        boardSt[j] = 'anim';
        travel(b, staticPose(b.userData.home.pos, homeQ), fly ? 0.55 : 0.15, fly ? 0.12 : 0, function () {
          boardSt[j] = 'placed'; wob[j].a = 0.07; wob[j].t = 0;
          snd('knock', { vol: 0.9, pitch: 1 + (j - 1) * 0.06 });
          E.particles.emit('dust', V(tw.x, MAT_Y + 0.03, tw.z), { count: 3, size: 0.04 });
          S.boards++; save();
          setBusy(false);
        }, fly ? easeInOut : easeOut);
      },
      back: function () {
        boardSt[j] = 'anim';
        travel(b, staticPose(pileLocal[j].pos, lyingQ), 0.35, 0.03, function () { boardSt[j] = 'pile'; }, easeInOut);
      }
    }, p);
  }
  function grabSideA(p) {
    var s = W.sideA;
    sideASt = 'carry';
    var hp = s.userData.home.pos.clone();
    var tw = hp.clone(); W.frame.localToWorld(tw);
    startCarry({
      obj: s, target: tw, hover: V(tw.x, tw.y + 0.06, tw.z + 0.05), snap: 70, minY: 0.06,
      base: function (o) { return wpos(s, o); },
      pose: function (k, w) { frameLocalOf(w, s.position); s.quaternion.copy(s.userData.home.quat); },
      place: function (fly) {
        setBusy(true, 4);
        sideASt = 'anim';
        travel(s, staticPose(hp, s.userData.home.quat), fly ? 0.6 : 0.18, fly ? 0.15 : 0, function () {
          sideASt = 'placed';
          for (var j = 0; j < 3; j++) wob[j].a = 0;
          snd('clack', { vol: 1 });
          E.particles.emit('dust', V(-0.40, 0.45, -0.08), { count: 5, size: 0.06 });
          E.shake(0.15, 0.2);
          S.boards = 4;
          later(0.35, function () { snd('sparkle'); E.particles.emit('sparkle', V(-0.40, 0.48, -0.20), { count: 14, size: 0.05 }); });
          later(1.1, function () {
            S.stage = 'screwsA'; save();
            dr.qcSet = false;
            drillToRest(0.7, 0.18, null);
            goShot(1.4);
            later(1.45, function () { setBusy(false); });
          });
        }, fly ? easeInOut : easeOut);
      },
      back: function () {
        sideASt = 'anim';
        travel(s, staticPose(sideAMatLocal.pos, sideAMatLocal.quat), 0.4, 0.04, function () { sideASt = 'mat'; }, easeInOut);
      }
    }, p);
  }

  // ------------------------------------------------------------------ drill helpers (all stages)
  function drillRev() {
    if (dr.mode !== 'rest' && dr.mode !== 'static') return;
    dr.rev = 0.45;
    snd('rev', { vol: S.battery === 'dead' ? 0.3 : 0.8, pitch: S.battery === 'dead' ? 0.6 : 1 });
    addFx(W.drill, 'hop', 0.012, 0.25);
  }

  // ------------------------------------------------------------------ stages: screws
  function topRange() { return si() >= 4 ? [6, 12] : [0, 6]; }
  function screwsDown(p) {
    if (busy || dr.dying) return;
    var r = topRange(), cands = [];
    var sp = spareBattery();
    if (S.battery === 'dead' && sp) cands.push({ id: 'bat', obj: sp, r: 0.07 });
    if (dr.mode === 'rest') cands.push({ id: 'drill', obj: W.drill, r: 0.12, offset: W.drill.userData.bodyCenter });
    for (var i = r[0]; i < r[1]; i++) if (S.screws[i] < 1) cands.push({ id: 's' + i, obj: W.screws[i], r: 0.045 });
    if (S.battery !== 'dead' || true) cands.push({ id: 'charger', obj: W.charger, r: 0.06 });
    var hit = E.pick(cands, p);
    if (hit && hit.id === 'bat') { grabBattery(p); return; }
    if (hit && hit.id === 'charger') { addFx(W.charger, 'hop', 0.006, 0.18); snd('tick', { vol: 0.5, pitch: 1.3 }); return; }
    if (hit && hit.id === 'drill') {
      computeCarryYaw();
      dr.mode = 'carry'; dr.tau = 0.04;
      planeHit(p, drillHover(), dr.finger) || dr.finger.copy(W.drill.position);
      press = { kind: 'drill', p: p, t: 0, tapDrill: true };
      snd('tick', { vol: 0.5 });
      return;
    }
    if (hit && hit.id.charAt(0) === 's' && dr.mode === 'rest') {
      computeCarryYaw();
      attachTo(+hit.id.slice(1), true);
      press = { kind: 'drill', p: p, t: 0 };
      snd('whoosh', { vol: 0.35, pitch: 1.4 });
      return;
    }
    // the frame: shear wobble
    var fh = E.pick([{ id: 'frame', obj: W.frameAnchor, r: 0.3 }, { id: 'top', obj: frameTopSide(), r: 0.25 }], p);
    if (fh) {
      var a0 = r[0], n = 0;
      for (var j = a0; j < a0 + 6; j++) if (S.screws[j] >= 1) n++;
      var amp = (si() >= 4 ? 0.012 : 0.05) * (1 - n / 6);
      if (amp > 0.0005) { shear.amp = amp; shear.t = 0; snd('creak', { vol: 0.4 + amp * 10, pitch: 1.1 }); }
      else snd('tick', { vol: 0.6, pitch: 0.8 });
    }
  }
  function drillHover() {
    var c = curScrew();
    if (c < 0) return W.drill.position.clone();
    screwHeadW(c, _v1);
    return fingerForTip(_v1, V());
  }
  function attachTo(i, fly) {
    dr.mode = 'attach'; dr.screw = i; dr.tau = fly ? 0.05 : 0.018; dr.arrived = false;
    dr.burst = 0; dr.releasePending = false; dr.seatedNow = S.screws[i] >= 1;
    if (!fly) snd('tick', { vol: 0.8, pitch: 1.5 });
  }
  function screwsMove(p) {
    if (!press || press.kind !== 'drill') return;
    press.p = p;
    if (dr.mode === 'carry') { planeHit(p, drillHover(), _fw) && dr.finger.copy(_fw); }
    else if (dr.mode === 'attach' && dr.arrived) {
      screwHeadW(dr.screw, _v1); fingerForTip(_v1, _v2);
      var sp = proj(_v2);
      if (pxDist(sp, p) > 120) {   // dragged far away: let go of the screw
        dr.mode = 'carry'; dr.screw = -1; dr.tau = 0.04;
        planeHit(p, drillHover(), _fw) && dr.finger.copy(_fw);
      }
    }
  }
  function screwsUp(p) {
    if (!press || press.kind !== 'drill') { press = null; return; }
    var pr = press; press = null;
    if (dr.mode === 'carry') {
      if (pr.tapDrill && p.moved < 12 && p.held < 0.45) {
        drillToRest(0.15, 0, function () { drillRev(); });
      } else drillToRest(0.35, 0.04, null);
      return;
    }
    if (dr.mode === 'attach') {
      if (p.held < 0.3 && S.battery !== 'dead' && S.screws[dr.screw] < 1) dr.burst = 0.3;
      dr.releasePending = true;
    }
  }
  function releaseDrill() {
    dr.releasePending = false; dr.burst = 0;
    var r = topRange(), all = true;
    for (var i = r[0]; i < r[1]; i++) if (S.screws[i] < 1) all = false;
    save();
    if (all) { finishScrews(); return; }
    drillToRest(0.35, 0.05, null);
    E.setShot(shotFor(S.stage), 0.5);
  }
  function finishScrews() {
    setBusy(true, 8);
    dr.mode = 'travel';
    later(0.25, function () { snd('chord'); E.particles.emit('sparkle', V(-0.40, 0.5, -0.20), { count: 18, size: 0.06 }); });
    var wasA = si() === 2;
    later(0.6, function () {
      S.stage = wasA ? 'flip' : 'stand'; save();
      drillToRest(0.8, 0.2, null);
      goShot(1.4);
      later(1.45, function () { setBusy(false); });
    });
  }

  function updDrill(dt, t) {
    var d = W.drill, ud = d.userData;
    var spinning = false, weak = false, clutch = false, load = 0;
    var pressing = !!(press && press.kind === 'drill');
    if (dr.mode === 'carry') {
      _v1.copy(ud.bodyCenter).applyQuaternion(dr.qc);
      _v2.copy(dr.finger).sub(_v1);
      d.position.lerp(_v2, sm(dt, dr.tau));
      d.quaternion.slerp(dr.qc, sm(dt, 0.06));
      // snap the bit tip onto an unfinished screw (46px)
      var tipS = proj(d.position), r = topRange(), best = -1, bd = 46;
      for (var i = r[0]; i < r[1]; i++) {
        if (S.screws[i] >= 1 || !W.screws[i].visible) continue;
        var dd = pxDist(tipS, proj(screwHeadW(i, _v3)));
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) attachTo(best, false);
    } else if (dr.mode === 'attach') {
      var i2 = dr.screw;
      screwHeadW(i2, _v1);
      d.position.lerp(_v1, sm(dt, dr.tau));
      d.quaternion.slerp(dr.qc, sm(dt, 0.04));
      if (!dr.arrived && d.position.distanceTo(_v1) < 0.006) { dr.arrived = true; if (dr.tau > 0.03) snd('tick', { vol: 0.8, pitch: 1.5 }); }
      var want = dr.arrived && (pressing || dr.burst > 0);
      if (dr.burst > 0) dr.burst -= dt;
      if (want && S.battery === 'dead' && !dr.dying) { weak = pressing; }
      else if (want || dr.dying) {
        var dcur = S.screws[i2];
        if (dcur < 1) {
          var rate = dt / 1.5 * (dr.dying ? dr.power : 1);
          var cap = dr.dying ? 0.62 : 1;
          if (dcur < cap) {
            S.screws[i2] = Math.min(cap, dcur + rate);
            spinning = dr.power > 0.08;
            load = 0.35 + 0.65 * S.screws[i2];
            screwApply(i2);
            // shavings
            dr.shavT -= dt;
            if (dr.shavT <= 0 && spinning) {
              dr.shavT = 0.08;
              screwRootW(i2, _v3); _v3.y += 0.003;
              E.particles.emit('shaving', _v3, { count: E.low ? 1 : 1 + (Math.random() < 0.5 ? 1 : 0), speed: 0.22, floorY: _v3.y - 0.003, dir: [0, 1, 0] });
            }
          } else if (dr.dying) { spinning = dr.power > 0.08; load = 0.5; }
          // battery dies: 9th screw past half, old battery
          if (!dr.dying && S.battery === 'old' && si() === 4 && doneCount() >= 8 && S.screws[i2] > 0.5) startDying();
          if (S.screws[i2] >= 1) {
            snd('seat', { vol: 1 });
            screwRootW(i2, _v3); _v3.y += 0.01;
            E.particles.emit('sparkle', _v3, { count: 8, size: 0.03 });
            snd('sparkle', { vol: 0.5, delay: 0.05 });
            dr.seatedNow = true;
          }
        } else if (pressing) { clutch = true; }
      }
      if (dr.releasePending && dr.burst <= 0 && !dr.dying) releaseDrill();
    } else if (dr.mode === 'rest') {
      restPose(d.position, d.quaternion);
    }
    // dying
    if (dr.dying) {
      dr.dying.t += dt;
      dr.power = Math.max(0, 1 - easeIn(dr.dying.t / 1.2));
      if (dr.dying.t >= 1.2) finishDying();
    }
    // rev (tap)
    if (dr.rev > 0) dr.rev -= dt;
    var revOn = dr.rev > 0;
    var targetV = spinning ? 46 * Math.max(0.15, dr.power) : (revOn && S.battery !== 'dead' ? 46 : (weak || (revOn && S.battery === 'dead') ? 6 : 0));
    dr.spinV += (targetV - dr.spinV) * sm(dt, targetV > dr.spinV ? 0.07 : 0.25);
    if (dr.spinV > 0.05) ud.spin.rotation.y -= dr.spinV * dt;
    ud.setTrigger(spinning || weak || revOn || clutch ? 1 : (pressing && dr.mode === 'attach' ? 0.6 : 0));
    var led = spinning ? dr.power : (revOn && S.battery !== 'dead' ? 1 : 0);
    if (dr.dying) led *= (Math.random() < 0.3 ? 0.2 : 1);
    if (clutch) led = 1;
    ud.setLed(led);
    // LED spot on the wood
    if (led > 0.02 && dr.mode === 'attach' && dr.screw >= 0) {
      screwRootW(dr.screw, _v3);
      W.led.position.set(_v3.x, _v3.y + 0.0015, _v3.z);
      W.led.scale.setScalar(0.05);
      W.led.userData.setStrength(led);
    } else W.led.userData.setStrength(0);
    // clutch
    if (clutch !== dr.clutchOn) { dr.clutchOn = clutch; try { G.Audio.clutch(clutch); } catch (e) { /* ignore */ } }
    if (clutch) addFx(d, 'jitter', 0.0022, 0.06);
    // battery blink when dead
    if (S.battery === 'dead') {
      var bt = W.bat1;
      bt.userData.setBlink((weak ? 0.6 : 0.3) + (weak ? 0.4 : 0.7) * (Math.sin(t * (weak ? 14 : 6)) > 0 ? 1 : 0));
    }
    dr.spinning = spinning; dr.weak = weak;
    // motor sound
    var on = spinning || weak || (dr.dying && dr.power > 0.03);
    try { G.Audio.drill(on, { load: load, battery: S.battery === 'dead' ? 0.15 : (dr.dying ? dr.power : 1) }); } catch (e2) { /* ignore */ }
  }

  function startDying() {
    dr.dying = { t: 0 };
    dr.power = 1;
  }
  function finishDying() {
    dr.dying = null; dr.power = 1;
    S.battery = 'dead';
    W.bat1.userData.setLevel(0); W.bat1.userData.setBlink(1);
    press = null;            // the finger is ignored until it lifts
    dr.releasePending = false; dr.burst = 0;
    save();
    setBusy(true, 3);
    drillToRest(0.5, 0.05, null);
    later(0.4, function () { E.setShot(SHOTS.battery, 1.2); });
    later(1.65, function () { setBusy(false); });
  }

  // battery swap
  function grabBattery(p) {
    var b = spareBattery();
    if (!b) return;
    scene.attach(b);
    var slot = W.drill.userData.batterySlot;
    var tw = wpos(slot, V());
    var startPos = b.position.clone(), startQ = b.quaternion.clone();
    startCarry({
      obj: b, target: tw, hover: V(tw.x, tw.y + 0.03, tw.z + 0.05), snap: 70, minY: 0.05,
      base: function (o) { return o.copy(b.position); },
      pose: function (k, w) {
        b.position.copy(w);
        slot.getWorldQuaternion(_q1);
        b.quaternion.slerpQuaternions(startQ, _q1, sstep(k));
      },
      place: function (fly) { swapBattery(fly); },
      back: function () {
        travel(b, function (op, oq) {
          W.charger.userData.slot.getWorldPosition(op); W.charger.userData.slot.getWorldQuaternion(oq);
        }, 0.35, 0.04, function () { W.charger.userData.slot.attach(b); b.position.set(0, 0, 0); b.quaternion.identity(); }, easeInOut);
        void startPos;
      }
    }, p);
  }
  function swapBattery(fly) {
    setBusy(true, 6);
    var nb = W.bat2, ob = W.bat1, slot = W.drill.userData.batterySlot;
    // first, the new battery comes close (just under the slot)
    var near = function (op, oq) {
      slot.getWorldQuaternion(oq); slot.getWorldPosition(op);
      _v1.set(0, -0.05, 0).applyQuaternion(oq); op.add(_v1); op.z += 0.06;
    };
    travel(nb, near, fly ? 0.5 : 0.18, fly ? 0.12 : 0, function () {
      // old battery ejects onto the mat
      scene.attach(ob);
      snd('eject', { vol: 0.9 });
      var land = V(); top3(land);
      var lq = qa(AY, 0.6, Q()).multiply(qa(AX, PI, Q()));
      travel(ob, staticPose(land, lq), 0.4, 0.08, function () { snd('knock', { vol: 0.4, pitch: 1.4 }); }, linear);
      later(0.18, function () {
        travel(nb, function (op, oq) { slot.getWorldPosition(op); slot.getWorldQuaternion(oq); }, 0.16, 0, function () {
          slot.attach(nb); nb.position.set(0, 0, 0); nb.quaternion.identity();
          nb.userData.setLevel(3); nb.userData.setBlink(0);
          snd('click', { vol: 1 });
          S.battery = 'new'; save();
          later(0.25, function () { snd('rev', { vol: 0.9 }); dr.rev = 0.5; addFx(W.drill, 'hop', 0.02, 0.3); E.particles.emit('sparkle', wpos(W.drill, V()).add(V(0, 0.15, 0)), { count: 10, size: 0.04 }); });
          // old battery slides into the charger
          later(0.7, function () {
            travel(ob, function (op, oq) { W.charger.userData.slot.getWorldPosition(op); W.charger.userData.slot.getWorldQuaternion(oq); }, 0.7, 0.05, function () {
              W.charger.userData.slot.attach(ob); ob.position.set(0, 0, 0); ob.quaternion.identity();
              ob.userData.setLevel(0); ob.userData.setBlink(0);
              snd('click', { vol: 0.6, pitch: 0.9 });
              later(0.3, function () { goShot(1.2); later(1.25, function () { setBusy(false); }); });
            }, easeInOut);
          });
        }, easeOut);
      });
    }, fly ? easeInOut : easeOut);
  }
  function top3(out) {
    // where the ejected battery lands: on the mat in front of the frame
    return out.set(-0.22, MAT_Y + 0.045, 0.02);
  }

  // ------------------------------------------------------------------ stages: flip
  var flip = { drag: false, target: 0, auto: false, released: false, showB: false };
  function rockFrame(a) {
    anim(0.5, function (k) { fr.nudge = a * Math.sin(PI * k); }, function () { fr.nudge = 0; snd('tick', { vol: 0.4, pitch: 0.8 }); }, linear, 'rock');
  }
  function flipDown(p) {
    if (busy) return;
    var hit = E.pick([{ id: 'f', obj: W.frameAnchor, r: 0.36 }, { id: 'a', obj: W.sideA, r: 0.25 }], p);
    if (!hit) {
      var dh = E.pick([{ id: 'drill', obj: W.drill, r: 0.1, offset: W.drill.userData.bodyCenter }], p);
      if (dh) drillRev();
      return;
    }
    stopAnim('rock'); fr.nudge = 0;
    flip.drag = true; flip.target = fr.flip;
    press = { kind: 'flip', p: p };
    snd('creak', { vol: 0.5 });
  }
  function flipMove(p) {
    if (!flip.drag) return;
    var dx = p.x - p.downX, dy = p.y - p.downY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    flip.target = clamp(dist / (0.45 * minDim()) * PI, 0, PI);
  }
  function flipUp(p) {
    if (!flip.drag) return;
    flip.drag = false; press = null;
    if (p.moved < 12 && !p.cancelled) { setBusy(true, 4); later(0.25, function () { flipCommit(0.95); }); return; }
    if (fr.flip >= PI / 3) flipCommit(0.6);
    else {
      setBusy(true, 2);
      var from = fr.flip;
      anim(0.3, function (k, e) { fr.flip = from * (1 - e); }, function () { fr.flip = 0; snd('thud', { vol: 0.35 }); setBusy(false); }, easeIn, 'flip');
    }
  }
  function updFlip(dt) {
    if (si() !== 3) return;
    if (flip.drag) {
      fr.flip += (flip.target - fr.flip) * sm(dt, 0.07);
      if (fr.flip > 0.05) showBScrews();
    }
  }
  function showBScrews() { for (var s = 6; s < 12; s++) W.screws[s].visible = true; }
  function flipCommit(dur) {
    setBusy(true, 5);
    showBScrews();
    var from = fr.flip;
    E.particles.release(V(-0.40, 0.46, -0.20), 0.9, MAT_Y);
    anim(dur * (1 - from / PI) + 0.2, function (k, e) { fr.flip = from + (PI - from) * e; }, function () {
      fr.flip = PI;
      snd('thud', { vol: 1 });
      E.shake(0.5, 0.4);
      for (var i = 0; i < 5; i++) E.particles.emit('dust', V(-0.76 + i * 0.18, MAT_Y + 0.01, -0.06 - (i % 2) * 0.28), { count: 3, size: 0.06 });
      later(0.6, function () {
        S.stage = 'screwsB'; save();
        dr.qcSet = false;
        drillToRest(0.6, 0.18, null);
        goShot(1.3);
        later(1.35, function () { setBusy(false); });
      });
    }, easeIn, 'flip');
  }

  // ------------------------------------------------------------------ stages: stand
  var stand = { drag: false, target: 0 };
  function standDown(p) {
    if (busy) return;
    var hit = E.pick([{ id: 'f', obj: W.frameAnchor, r: 0.4 }, { id: 'b', obj: W.sideB, r: 0.3 }], p);
    if (!hit) {
      var dh = E.pick([{ id: 'drill', obj: W.drill, r: 0.1, offset: W.drill.userData.bodyCenter }], p);
      if (dh) drillRev();
      return;
    }
    stopAnim('rock'); fr.nudge = 0;
    fr.phase = 'stand'; fr.stand = 0; fr.flip = PI;
    stand.drag = true; stand.target = 0;
    press = { kind: 'stand' };
    snd('creak', { vol: 0.6, pitch: 0.8 });
  }
  function standMove(p) {
    if (!stand.drag) return;
    var dx = p.x - p.downX, dy = p.y - p.downY;
    stand.target = clamp(Math.sqrt(dx * dx + dy * dy) / (0.40 * minDim()) * PI / 2, 0, PI / 2);
  }
  function standUp(p) {
    if (!stand.drag) return;
    stand.drag = false; press = null;
    if (p.moved < 12 && !p.cancelled) { setBusy(true, 6); later(0.25, function () { standCommit(1.0); }); return; }
    if (fr.stand >= 35 * PI / 180) standCommit(0.6);
    else {
      setBusy(true, 2);
      var from = fr.stand;
      anim(0.35, function (k, e) { fr.stand = from * (1 - e); }, function () { fr.stand = 0; fr.phase = 'flat'; snd('thud', { vol: 0.4 }); setBusy(false); }, easeIn, 'stand');
    }
  }
  function updStand(dt) {
    if (si() !== 5) return;
    if (stand.drag) fr.stand += (stand.target - fr.stand) * sm(dt, 0.15);
  }
  function standCommit(dur) {
    setBusy(true, 7);
    fr.phase = 'stand';
    var from = fr.stand;
    anim(dur * (1 - from / (PI / 2)) + 0.25, function (k, e) { fr.stand = from + (PI / 2 - from) * e; }, function () {
      fr.stand = PI / 2;
      snd('thud', { vol: 1 });
      E.shake(0.45, 0.4);
      E.particles.emit('dust', V(0.0, 0.02, -0.2), { count: 4, size: 0.06 });
      E.particles.emit('dust', V(0.38, 0.02, -0.2), { count: 4, size: 0.06 });
      anim(1.0, function (k) { fr.standWob = -0.035 * Math.exp(-4 * k) * Math.sin(TAU * 2.2 * k); }, function () { fr.standWob = 0; }, linear, 'standwob');
      later(1.0, function () {
        fr.phase = 'slide'; fr.slide = 0;
        snd('scrape', { vol: 0.9 });
        goShot(1.6);
        anim(1.2, function (k, e) { fr.slide = e; }, function () {
          fr.phase = 'final'; fr.slide = 1;
          snd('knock', { vol: 0.5, pitch: 0.7 });
          S.stage = 'books'; save();
          later(0.4, function () { setBusy(false); });
        }, easeInOut, 'slide');
      });
    }, easeIn, 'stand');
  }

  // ------------------------------------------------------------------ stages: books
  function chooseBook() {
    var best = -1, bs = 1e9;
    for (var i = 0; i < 8; i++) {
      if (bookSt[i].mode !== 'floor') continue;
      var sl = floorSlotOf[i];
      var c = bookCenterW(i, _v1);
      var score = Math.hypot(c.x - FIN_POS.x, c.z - FIN_POS.z) - (sl.charAt(0) === 't' ? 2 : 0);
      if (score < bs) { bs = score; best = i; }
    }
    return best;
  }
  function shelfBoxDist(sp) {
    // screen distance from point to the shelf's projected bounding rectangle
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < 8; i++) {
      _v3.set(FIN_POS.x + (i & 1 ? 0.23 : -0.23), (i & 2) ? 0.72 : 0, FIN_POS.z + (i & 4 ? 0.12 : -0.12));
      var p = proj(_v3);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    var dx = Math.max(x0 - sp.x, 0, sp.x - x1), dy = Math.max(y0 - sp.y, 0, sp.y - y1);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function booksDown(p) {
    if (busy) return;
    var cands = [];
    for (var i = 0; i < 8; i++) {
      var m = bookSt[i].mode;
      if (m === 'floor') cands.push({ id: 'f' + i, obj: W.books[i], r: 0.09, offset: V(0, bsz(i).h / 2, 0) });
      else if (m === 'shelf') cands.push({ id: 's' + i, obj: W.books[i], r: 0.05, offset: V(0, bsz(i).h / 2, 0) });
    }
    cands.push({ id: 'shelf', obj: W.frameAnchor, r: 0.2 });
    if (si() >= 7) cands.push({ id: 'lamp', obj: W.lamp, r: 0.09, offset: V(0, 0.14, 0) });
    cands.push({ id: 'drill', obj: W.drill, r: 0.1, offset: W.drill.userData.bodyCenter });
    if (si() === 8) cands.push({ id: 'box', obj: W.box, r: 0.2 });
    var hit = E.pick(cands, p);
    if (!hit) return;
    var id = +hit.id.slice(1);
    if (hit.id.charAt(0) === 'f' && si() === 6) { grabBook(id, p); return; }
    if (hit.id.charAt(0) === 'f') { addFx(W.books[id], 'hop', 0.01, 0.2); snd('wiggle', { vol: 0.6 }); return; }
    if (hit.id.charAt(0) === 's') { wiggleBook(id, 0.14, 0); snd('wiggle', { vol: 0.8 }); return; }
    if (hit.id === 'shelf') { snd('tick', { vol: 0.7, pitch: 0.7 }); return; }
    if (hit.id === 'drill') { drillRev(); return; }
    if (hit.id === 'lamp') { lampDown(p); return; }
    if (hit.id === 'box') { restart(); }
  }
  function grabBook(id, p) {
    var b = W.books[id], z = bsz(id);
    bookSt[id].mode = 'carry';
    var tgtC = nextSlotCenter(V()); tgtC.y += z.h / 2;
    var startQ = b.quaternion.clone(), standQ = Q();
    startCarry({
      obj: b, target: tgtC, hover: V(tgtC.x, tgtC.y + 0.02, tgtC.z + 0.16), snap: 80, minY: z.t / 2 + 0.03,
      base: function (o) { return bookCenterW(id, o); },
      distFn: function (sp) { return shelfBoxDist(sp); },
      pose: function (k, w) {
        b.quaternion.slerpQuaternions(startQ, standQ, sstep(k));
        centerToOrigin(id, w, b.quaternion, b.position);
      },
      place: function (fly) {
        setBusy(true, 4);
        bookSt[id].mode = 'anim';
        var rank = S.books.length;
        S.books.push(id);
        var tp = V(), tq = Q();
        slotPose(rank, id, tp, tq);
        var pre = tp.clone(); pre.z += 0.10;
        var go = function () {
          travel(b, staticPose(tp, tq), 0.18, 0, function () {
            bookSt[id].mode = 'shelf';
            snd('bookIn', { vol: 0.9, pitch: clamp(1.3 - (z.h - 0.19) * 3, 0.8, 1.3) });
            E.particles.emit('sparkle', V(tp.x, tp.y + z.h, tp.z + z.w / 2), { count: 5, size: 0.03 });
            save();
            var n = S.books.length;
            if (n === 4 || n === 8) {
              var row = n === 4 ? 0 : 4;
              for (var r = 0; r < 4; r++) (function (r) {
                wiggleBook(S.books[row + r], 0.1, 0.25 + r * 0.13);
                later(0.25 + r * 0.13, function () { snd('tick', { vol: 0.6, pitch: 1 + r * 0.08 }); });
              })(r);
            }
            if (n >= 8) {
              later(1.0, function () { snd('chord'); });
              later(1.6, function () { S.stage = 'lamp'; save(); goShot(1.4); later(1.45, function () { setBusy(false); }); });
            } else later(0.15, function () { setBusy(false); });
          }, easeOut);
        };
        travel(b, staticPose(pre, tq), fly ? 0.6 : 0.2, fly ? 0.15 : 0.02, go, fly ? easeInOut : easeOut);
      },
      back: function () {
        bookSt[id].mode = 'anim';
        travel(b, function (op, oq) { floorPose(id, op, oq); }, 0.4, 0.05, function () { bookSt[id].mode = 'floor'; snd('tumble', { vol: 0.3, pitch: 1.3 }); }, easeInOut);
      }
    }, p);
  }

  // ------------------------------------------------------------------ stages: lamp / end
  var lampSt = 'floor';
  function lampDown(p) {
    if (busy) return;
    if (!S.lampPlaced) {
      if (si() !== 7) return;
      lampSt = 'carry';
      var l = W.lamp, tw = LAMP_TOP.clone();
      startCarry({
        obj: l, target: tw, hover: V(tw.x, tw.y + 0.03, tw.z + 0.12), snap: 70, minY: 0.03,
        base: function (o) { return o.copy(l.position); },
        pose: function (k, w) { l.position.copy(w); },
        place: function (fly) {
          setBusy(true, 3);
          travel(l, staticPose(LAMP_TOP, l.quaternion.clone()), fly ? 0.6 : 0.18, fly ? 0.2 : 0, function () {
            snd('knock', { vol: 0.5, pitch: 1.2 });
            S.lampPlaced = true; save();
            later(0.2, function () { setBusy(false); });
          }, fly ? easeInOut : easeOut);
        },
        back: function () { travel(l, staticPose(LAMP_FLOOR, l.quaternion.clone()), 0.4, 0.04, null, easeInOut); }
      }, p);
      return;
    }
    // switch
    var on = !S.lampOn;
    S.lampOn = on;
    snd('lamp', { vol: 0.9 });
    var k0 = lampK;
    anim(0.4, function (k, e) { lampK = lerp(k0, on ? 1 : 0, e); W.lamp.userData.setOn(lampK); }, null, easeOut, 'lampOn');
    if (si() === 7) {
      S.stage = 'end'; save();
      setBusy(true, 3);
      var m0 = mood.k;
      anim(5, function (k, e) { setMood(lerp(m0, 1, e)); }, null, easeInOut, 'mood');
      later(0.5, function () { snd('lullaby', { vol: 0.8 }); });
      E.setShot(SHOTS.end, 5);
      later(1.5, function () { setBusy(false); });
    } else {
      var m1 = mood.k;
      anim(1.5, function (k, e) { setMood(lerp(m1, on ? 1 : 0.55, e)); }, null, easeInOut, 'mood');
      save();
    }
  }
  function lampStageDown(p) {
    var hit = E.pick([{ id: 'lamp', obj: W.lamp, r: 0.1, offset: V(0, 0.13, 0) }], p);
    if (hit) { lampDown(p); return; }
    booksDown(p);
  }
  var fading = false;
  function restart() {
    if (fading) return;
    fading = true;
    setBusy(true, 4);
    snd('whoosh', { vol: 0.5 });
    var cv = E.canvas;
    try { cv.style.transition = 'opacity 0.5s ease'; cv.style.opacity = '0'; } catch (e) { /* ignore */ }
    later(0.55, function () {
      try { E.save.clear(); } catch (e) { /* ignore */ }
      copyInto(S, freshS());
      applyState();
      goShot(0);
      try { cv.style.opacity = '1'; } catch (e2) { /* ignore */ }
      fading = false;
    });
  }

  // ------------------------------------------------------------------ input dispatch
  var evq = [];
  function onDown(p) {
    var ix = si();
    if (ix === 0) towerDown(p);
    else if (ix === 1) boardsDown(p);
    else if (ix === 2 || ix === 4) screwsDown(p);
    else if (ix === 3) flipDown(p);
    else if (ix === 5) standDown(p);
    else if (ix === 6) booksDown(p);
    else if (ix === 7) lampStageDown(p);
    else if (ix === 8) booksDown(p);
    if (carry && !press) press = { kind: 'carry' };
  }
  function onMove(p) {
    if (carry) { carryMove(p); return; }
    var ix = si();
    if (ix === 2 || ix === 4) screwsMove(p);
    else if (ix === 3) flipMove(p);
    else if (ix === 5) standMove(p);
  }
  function onUp(p) {
    if (carry) { carryUp(p); press = null; return; }
    if (press && press.kind === 'carry') { press = null; return; }
    var ix = si();
    if (ix === 2 || ix === 4) screwsUp(p);
    else if (ix === 3) flipUp(p);
    else if (ix === 5) standUp(p);
    press = null;
  }

  // ------------------------------------------------------------------ frame loop
  function onFrame(dt, t) {
    fxUndo();
    // pointer events (processed here so poses are free of visual offsets)
    if (evq.length) {
      var q = evq; evq = [];
      for (var i = 0; i < q.length; i++) {
        var ev = q[i];
        try {
          if (ev[0] === 'down') onDown(ev[1]);
          else if (ev[0] === 'move') onMove(ev[1]);
          else onUp(ev[1]);
        } catch (e) { report(e); }
      }
    }
    updTimers(dt);
    updAnims(dt);
    updFlip(dt);
    updStand(dt);
    frameApply();
    updFrameParts(dt);
    W.frame.updateMatrixWorld(true);
    updCarry(dt);
    updBooks(dt);
    updDrill(dt, t);
    updHint(dt);
    fxApply(dt);
  }

  function boot() {
    if (!G.Engine || !G.Props || !THREE) return;
    E = G.Engine; P = G.Props;
    var ok = E.init({ onFrame: function (dt, t) { onFrame(dt, t); }, onResize: function () { /* shots are functions */ } });
    if (!ok) return;
    scene = E.scene; camera = E.camera;
    P.init(E.renderer);
    buildWorld();
    glowables = [W.sideA, W.sideB, W.boards[0], W.boards[1], W.boards[2], W.drill, W.bat1, W.bat2, W.lamp, W.box].concat(W.books).concat(W.screws);
    var loaded = null;
    try { loaded = E.save.load(); } catch (e) { loaded = null; }
    copyInto(S, validate(loaded));
    applyState();
    goShot(0);
    E.onPointer({
      down: function (p) { try { if (G.Audio) G.Audio.unlock(); } catch (e) { /* ignore */ } W.ghost.userData.setOpacity(0); evq.push(['down', p]); },
      move: function (p) { if (evq.length && evq[evq.length - 1][0] === 'move') evq[evq.length - 1] = ['move', p]; else evq.push(['move', p]); },
      up: function (p) { evq.push(['up', p]); }
    });
    E.onQuality(function () { /* particles already halve themselves in low mode */ });
  }

  G.Game = {
    state: S,
    cuePoint: function () {
      if (!curH || busy) return null;
      return cueScreen(curH, {});
    },
    isBusy: function () { return busy || !!carry || !!dr.dying || dr.mode === 'travel'; },
    hintLevel: function () { return hintLevel; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
