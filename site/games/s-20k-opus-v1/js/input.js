/* input.js — 指一本のタップとドラッグ。触れた物だけが応える（何もない所は反応しない） */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  function Input(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.ray = new T.Ray();
    this.rc = new T.Raycaster();
    this.ndc = new T.Vector2();
    this.active = null; // 今の操作
    this.pid = null;
    this.lastTouch = -1e9;
    this.now = 0;
    this.w = 1; this.h = 1;
    var self = this;
    canvas.addEventListener('pointerdown', function (e) { self._down(e); });
    window.addEventListener('pointermove', function (e) { self._move(e); });
    window.addEventListener('pointerup', function (e) { self._up(e); });
    window.addEventListener('pointercancel', function (e) { self._up(e); });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  }

  Input.prototype.idleFor = function () { return this.active ? 0 : this.now - this.lastTouch; };
  Input.prototype.resize = function (w, h) { this.w = w; this.h = h; };

  Input.prototype._setRay = function (x, y) {
    var r = this.canvas.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.rc.setFromCamera(this.ndc, this.world.rig.cam);
    this.ray.copy(this.rc.ray);
    return this.ray;
  };
  Input.prototype._plane = function (y, out) {
    var r = this.ray;
    if (Math.abs(r.direction.y) < 1e-4) return null;
    var t = (y - r.origin.y) / r.direction.y;
    if (t < 0) return null;
    return out.copy(r.direction).multiplyScalar(t).add(r.origin);
  };
  // 画面上で、ある点の近くか（px）
  Input.prototype._nearScreen = function (p, x, y, px) {
    var s = this.world.rig.toScreen(p, this.w, this.h, { x: 0, y: 0, z: 0 });
    var r = this.canvas.getBoundingClientRect();
    var dx = s.x - (x - r.left), dy = s.y - (y - r.top);
    return s.z < 1 && dx * dx + dy * dy < px * px;
  };

  Input.prototype._down = function (e) {
    if (this.pid !== null) return;
    e.preventDefault();
    SG.events.emit('firstTouch');
    this.lastTouch = this.now;
    var w = this.world;
    this._setRay(e.clientX, e.clientY);
    var hit = this._pick(e.clientX, e.clientY);
    if (!hit) return;
    this.pid = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    this.active = hit;
    hit.x0 = e.clientX; hit.y0 = e.clientY; hit.t0 = this.now; hit.moved = 0;
    this._begin(hit);
  };

  Input.prototype._move = function (e) {
    if (this.pid === null || e.pointerId !== this.pid || !this.active) return;
    this.lastTouch = this.now;
    var a = this.active;
    a.moved = Math.max(a.moved, Math.abs(e.clientX - a.x0) + Math.abs(e.clientY - a.y0));
    a.x = e.clientX; a.y = e.clientY;
    this._setRay(e.clientX, e.clientY);
    this._drag(a, e.clientX, e.clientY);
  };

  Input.prototype._up = function (e) {
    if (this.pid === null || e.pointerId !== this.pid) return;
    var a = this.active;
    this.pid = null; this.active = null;
    this.lastTouch = this.now;
    if (a) this._end(a);
  };

  // ---- 何に触れたか ----
  Input.prototype._pick = function (x, y) {
    var w = this.world, c = w.course, ray = this.ray;
    var cands = [];
    // 網
    var tn = w.net.hitTest(ray, 0.12);
    if (tn >= 0) cands.push({ kind: 'net', t: tn - 0.3 });
    // 水差し
    var tp = w.pitcher.hit(ray);
    if (tp >= 0) cands.push({ kind: 'pitcher', t: tp });
    // ざるの束
    var zb = w.noodles.pickZaru(ray);
    if (zb) { var zc = w.noodles.bundleCenter(zb, new T.Vector3()); cands.push({ kind: 'zaru', b: zb, t: zc.sub(ray.origin).dot(ray.direction) }); }
    var following = w.rig.mode === 'follow';
    // 支柱と樋（立体に当てる）。麺と一緒に下っている間は、網と麺だけ
    var objs = [];
    if (!following) {
    c.pillars.forEach(function (p) { objs.push(p.group); });
    for (var id in c.troughs) objs.push(c.troughs[id].mesh);
    objs.push(c.tray.group);
    var hits = this.rc.intersectObjects(objs, true);
    if (hits.length) {
      var h0 = hits[0];
      var o = h0.object, found = null;
      while (o && !found) {
        for (var k = 0; k < c.pillars.length; k++) if (c.pillars[k].group === o) found = { kind: 'pillar', k: k };
        if (o.userData && o.userData.trough) found = { kind: 'trough', id: o.userData.trough };
        if (o === c.tray.group) found = { kind: 'pillar', k: 0 };
        o = o.parent;
      }
      if (found) { found.t = h0.distance; found.point = h0.point.clone(); cands.push(found); }
    }
    }
    // 麺（樋や網の中）を押す
    var np = w.noodles.pick(ray);
    if (np) cands.push({ kind: 'press', p: np.p, b: np.b, t: np.p.distanceTo(ray.origin) + 0.15 });
    if (cands.length) {
      cands.sort(function (a, b) { return a.t - b.t; });
      if (cands[0].kind === 'zaru' && !cands[0].b) return null;
      return cands[0];
    }
    // 直接当たらないときだけ、近さで拾う（網・細い柱・導いている物）
    var tn2 = w.net.hitTest(ray, 0.4);
    if (tn2 >= 0) cands.push({ kind: 'net', t: tn2 });
    for (var k2 = 0; k2 < c.pillars.length && !following; k2++) {
      var hp = c.pillarHead(k2, new T.Vector3());
      var mid = new T.Vector3(c.pillars[k2].bx, hp.y * 0.5, c.pillars[k2].bz);
      var lying = c.pillars[k2].state === 'lying';
      if (this._nearScreen(lying ? hp : mid, x, y, 34) || this._nearScreen(hp, x, y, 30)) {
        cands.push({ kind: 'pillar', k: k2, t: hp.distanceTo(ray.origin) + 0.5 });
      }
    }
    // 導いている物の近く（ひろめの受け入れ）
    var g = w.guide && w.guide.target;
    if (g && following && g.kind !== 'net') g = null;
    if (g && g.anchor && this._nearScreen(g.anchor, x, y, 64)) {
      var gc = { kind: g.kind, k: g.k, id: g.id, b: g.b, t: 1e6 };
      if (g.kind === 'zaru' && !g.b) gc.b = w.noodles.pickZaruAny();
      cands.push(gc);
    }
    if (!cands.length) return null;
    cands.sort(function (a, b) { return a.t - b.t; });
    var best = cands[0];
    if (best.kind === 'zaru' && !best.b) return null;
    return best;
  };

  // ---- 始め ----
  Input.prototype._begin = function (a) {
    var w = this.world, c = w.course, nd = w.noodles;
    var ready = c.assembled;
    if (a.kind === 'net') {
      w.net.held = true;
      SG.events.emit('netGrab');
    } else if (a.kind === 'pitcher') {
      if (!ready) { w.pitcher.wobble(); SG.events.emit('locked', 'pitcher'); a.kind = 'none'; return; }
      a.mode = w.pitcher.grab();
      SG.events.emit('pitcherGrab');
    } else if (a.kind === 'zaru') {
      if (!ready) { a.b.mesh.mesh.position.y = 0.04; a.b.wob = 0.3; SG.events.emit('locked', 'zaru'); a.kind = 'none'; return; }
      nd.holdStart(a.b);
      a.snapped = false;
    } else if (a.kind === 'pillar') {
      var p = c.pillars[a.k];
      if (p.state === 'lying') { a.mode = 'tap'; }
      else {
        a.mode = 'push';
        a.accum = 0;
        var hp = c.pillarHead(a.k, new T.Vector3());
        var dist = hp.distanceTo(w.rig.cam.position);
        a.scale = 2 * dist * Math.tan(w.rig.cam.fov * Math.PI / 360) / this.h;
        if (w.rig.mode !== 'overview') w.rig.toOverview();
        c.pillars[a.k].squishV += 2;
        SG.events.emit('pillarTouch', a.k);
      }
    } else if (a.kind === 'trough') {
      var tr = c.troughs[a.id];
      var pt = a.point || c.troughCenter(a.id, new T.Vector3());
      a.mode = c.troughGrab(a.id, pt);
      if (w.rig.mode !== 'overview' && (a.mode === 'adjust')) w.rig.toOverview();
      a.planeY = pt.y;
      if (a.mode === 'carry') {
        var tg = c.attachTarget(a.id);
        a.planeY = tg ? tg.y + 0.3 : 1.0;
      }
    } else if (a.kind === 'press') {
      nd.setPress(a.p);
      a.planeY = a.p.y;
    }
  };

  // ---- ドラッグ ----
  Input.prototype._drag = function (a, x, y) {
    var w = this.world, c = w.course, nd = w.noodles;
    var fp = new T.Vector3();
    if (a.kind === 'net') {
      var net = w.net;
      if (this._plane(net.c.y, fp)) net.setTarget(fp);
    } else if (a.kind === 'pitcher') {
      var rimY = c.d.yT + K.TRAY_DEPTH;
      if (this._plane(rimY, fp)) w.pitcher.drag(fp, (a.y0 - y) / this.h);
    } else if (a.kind === 'zaru') {
      var b = a.b;
      if (b.state !== 'held') return;
      var carryY = c.d.yT + 0.55;
      if (!this._plane(carryY, fp)) return;
      // 樋の上に来たら、上流の水面へ寄せる
      var best = null, bd = 1.15;
      var paths = c.activePaths();
      for (var i = 1; i < paths.length; i++) {
        var P = paths[i];
        var loc = {};
        P.locate(fp.x, P.y(P.L * 0.5) + 0.3, fp.z, loc);
        if (loc.s < 0.25 || loc.s > P.L - 0.3) continue;
        var ax = new T.Vector3();
        P.axis(loc.s, ax);
        var dxz = Math.sqrt((ax.x - fp.x) * (ax.x - fp.x) + (ax.z - fp.z) * (ax.z - fp.z));
        if (dxz < bd) { bd = dxz; best = { P: P, s: loc.s, ax: ax }; }
      }
      if (best) {
        var Tv = new T.Vector3(), Nv = new T.Vector3(), Bv = new T.Vector3();
        best.P.frame(best.s, Tv, Nv, Bv);
        var tgt = best.ax.clone(); tgt.y += 0.1;
        // 指が下りてくるまでは少し上で待つ
        nd.holdMove(b, tgt, Tv.clone().negate());
        a.snapped = true;
      } else {
        fp.y = carryY;
        nd.holdMove(b, fp, null);
        a.snapped = false;
      }
    } else if (a.kind === 'pillar') {
      if (a.mode === 'push') {
        var dy = (a.lastY !== undefined ? a.lastY : a.y0) - y;
        a.lastY = y;
        a.accum += dy * a.scale * 0.28;
        var r = c.pillarPush(a.k, a.accum);
        a.accum = r.accum;
      }
    } else if (a.kind === 'trough') {
      if (this._plane(a.planeY, fp)) c.troughMove(a.id, fp, 1 / 60);
      var tr2 = c.troughs[a.id];
      if (tr2.state === 'held') { var tg2 = c.attachTarget(a.id); a.planeY = tg2 ? tg2.y + 0.3 : 1.0; }
    } else if (a.kind === 'press') {
      if (this._plane(a.planeY, fp)) nd.setPressMove(fp);
    }
  };

  // 押さえたまま動かさなくても、運ぶ物は毎コマ目標へ
  Input.prototype.update = function (dt) {
    this.now += dt;
    var a = this.active;
    if (!a) return;
    if (a.kind === 'trough' && a.x !== undefined) {
      this._setRay(a.x, a.y);
      var fp = new T.Vector3();
      if (this._plane(a.planeY, fp)) this.world.course.troughMove(a.id, fp, dt);
    }
  };

  // ---- 終わり ----
  Input.prototype._end = function (a) {
    var w = this.world, c = w.course, nd = w.noodles;
    if (a.kind === 'net') { w.net.held = false; SG.events.emit('netRelease'); }
    else if (a.kind === 'pitcher') { w.pitcher.release(); }
    else if (a.kind === 'zaru') {
      if (a.b.state === 'held') nd.holdEnd(a.b, !!a.snapped);
    } else if (a.kind === 'pillar') {
      if (a.mode === 'tap') {
        var camYaw = Math.atan2(w.rig.cam.position.z - c.pillars[a.k].bz, w.rig.cam.position.x - c.pillars[a.k].bx);
        c.tapPillar(a.k, camYaw);
      } else {
        c.pillarRelease(a.k);
      }
    } else if (a.kind === 'trough') {
      c.troughRelease(a.id);
    } else if (a.kind === 'press') {
      nd.setPress(null);
    }
  };

  SG.Input = Input;
})();
