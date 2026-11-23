/* camera.js — 視点：食卓を見渡す・麺と並んで樋を下る・網と落ち口を見渡す。天地はいつも水平 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  function Rig(world) {
    this.world = world;
    this.cam = new T.PerspectiveCamera(40, 1, 0.05, 220);
    this.mode = 'overview';
    this.pos = new T.Vector3(0, 12, 14);
    this.look = new T.Vector3(0, 1, 0);
    this.tPos = new T.Vector3();
    this.tLook = new T.Vector3();
    this.lambda = 2.0;
    this.follow = null;
    this.followSide = 1;
    this.stallT = 0;
    this.lastLead = -9;
    this.first = true;
    this.aspect = 1;
    this.modeT = 0;
  }

  Rig.prototype.resize = function (w, h) {
    this.aspect = w / h;
    this.cam.aspect = this.aspect;
    this.cam.fov = this.aspect < 0.8 ? 46 : 38;
    this.cam.updateProjectionMatrix();
  };

  // 見せたい点がすべて入る位置
  Rig.prototype.fit = function (pts, yaw, pitch, margin, outPos, outLook) {
    var fwd = new T.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    var right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    var up = new T.Vector3().crossVectors(right, fwd).normalize();
    var tanV = Math.tan(this.cam.fov * Math.PI / 360) * margin;
    var tanH = tanV * this.aspect;
    var c = new T.Vector3();
    pts.forEach(function (p) { c.add(p); });
    c.multiplyScalar(1 / pts.length);
    var D = 0;
    for (var it = 0; it < 3; it++) {
      D = 0;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (var i = 0; i < pts.length; i++) {
        var d = pts[i].clone().sub(c);
        var x = d.dot(right), y = d.dot(up), z = d.dot(fwd);
        D = Math.max(D, Math.abs(x) / tanH - z, Math.abs(y) / tanV - z);
      }
      // 画面の中で釣り合うよう中心をずらす
      for (var j = 0; j < pts.length; j++) {
        var e = pts[j].clone().sub(c);
        var depth = D + e.dot(fwd);
        var sx = e.dot(right) / (depth * tanH), sy = e.dot(up) / (depth * tanV);
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      var mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
      c.addScaledVector(right, mx * D * tanH * 0.9).addScaledVector(up, my * D * tanV * 0.9);
    }
    D = 0;
    for (var i2 = 0; i2 < pts.length; i2++) {
      var d2 = pts[i2].clone().sub(c);
      D = Math.max(D, Math.abs(d2.dot(right)) / tanH - d2.dot(fwd), Math.abs(d2.dot(up)) / tanV - d2.dot(fwd));
    }
    outLook.copy(c);
    outPos.copy(c).addScaledVector(fwd, -D);
  };

  Rig.prototype.viewAngles = function (near) {
    var t = SG.smooth(0.62, 1.25, this.aspect);
    var yaw = SG.lerp(near ? 1.25 : 1.42, 0.3, t);
    var pitch = SG.lerp(near ? 0.72 : 0.98, near ? 0.5 : 0.6, t);
    return { yaw: yaw, pitch: pitch };
  };

  Rig.prototype.overviewTarget = function (pos, look) {
    var w = this.world, c = w.course, B = c.basin, V = T.Vector3;
    var pts = [
      new V(c.TX - 1.3, 0, c.TZ - 1.2), new V(c.TX, c.d.yT + 1.4, c.TZ), new V(c.TX - 1.0, c.d.yT + 2.6, c.TZ + 0.4),
      new V(c.pitcherHome.x - 0.7, 0, c.pitcherHome.z + 0.7), new V(c.zaruPos.x, 0.3, c.zaruPos.z + 1.2),
      new V(B.cx + B.hx, 0, B.cz - B.hz), new V(B.cx + B.hx, 0.6, B.cz + B.hz), new V(B.cx - B.hx, 0.6, B.cz - B.hz),
      new V(c.bowlPos.x + 0.9, 0.7, c.bowlPos.z + 0.9), new V(c.bowlPos.x - 0.9, 0, c.bowlPos.z + 0.9),
      new V(0.3, 0, 3.6), new V(-0.5, 0, -2.6), new V(c.d.p2X, c.d.cr2 + 0.4, c.d.p2Z)
    ];
    var a = this.viewAngles(false);
    this.fit(pts, a.yaw, a.pitch, 0.96, pos, look);
  };

  Rig.prototype.catchTarget = function (pos, look) {
    var w = this.world, c = w.course, d = c.d, V = T.Vector3, B = c.basin;
    var dE = new V(Math.cos(c.st.theta), 0, Math.sin(c.st.theta));
    var out = new V(d.eOutX, d.eOutY + 0.4, d.eOutZ);
    var land = new V(d.eOutX, 0.1, d.eOutZ).addScaledVector(dE, 1.0);
    var pts = [
      out, new V(d.eOutX, 0.0, d.eOutZ).addScaledVector(dE, 1.9),
      land.clone().add(new V(0.8, 0, 0.8)), land.clone().add(new V(-0.8, 0, -0.8)),
      new V(c.bowlPos.x + 0.95, 0.75, c.bowlPos.z + 0.95), new V(c.bowlPos.x - 0.95, 0, c.bowlPos.z + 0.95),
      new V(d.p2X, d.cr2 + 0.3, d.p2Z), new V(d.p2X, d.cr2 * 0.5, d.p2Z), new V(d.p2X, 0, d.p2Z),
      w.net.c.clone()
    ];
    var a = this.viewAngles(true);
    this.fit(pts, a.yaw, a.pitch, 0.84, pos, look);
  };

  Rig.prototype.toOverview = function () {
    if (this.mode !== 'overview') { this.mode = 'overview'; this.follow = null; this.modeT = 0; this.lambda = 1.6; SG.events.emit('camMode', 'overview'); }
  };
  Rig.prototype.toCatch = function () {
    if (this.mode !== 'catch') { this.mode = 'catch'; this.follow = null; this.modeT = 0; this.lambda = 1.5; SG.events.emit('camMode', 'catch'); }
  };
  Rig.prototype.startFollow = function (b) {
    this.mode = 'follow'; this.follow = b; this.modeT = 0; this.stallT = 0; this.lastLead = b.leadS;
    this.lambda = 1.3;
    b.followed = true;
    // 見渡していた側から入る
    var c = this.world.course, P = c.troughs.S.path;
    var fr = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
    P.frame(b.leadS > 0 ? Math.min(b.leadS, P.L) : 0, fr[0], fr[1], fr[2]);
    var toCam = this.pos.clone().sub(b.lead);
    this.followSide = toCam.dot(fr[1]) >= 0 ? 1 : -1;
    SG.events.emit('camMode', 'follow');
  };

  Rig.prototype.update = function (dt) {
    var w = this.world, c = w.course;
    this.modeT += dt;
    var nd = w.noodles;
    var sum = nd ? nd.summary() : null;
    // 束が直線の樋の半ばを過ぎたら、樋の縁へ下りる
    if (this.mode === 'overview' && sum && sum.lead && !sum.lead.followed && w.input && w.input.idleFor() > 0.35) {
      if (sum.lead.leadS > K.LS * 0.45 && sum.lead.leadS < K.LS * 0.9) this.startFollow(sum.lead);
    }
    if (this.mode === 'follow') {
      var b = this.follow;
      if (!b || b.state !== 'active') { this.toCatch(); }
      else {
        var lead = b.leadS;
        var d = c.d, st = c.st;
        var offC = K.LS - d.iC, offE = offC + K.LC - st.iE;
        if (lead > offE - 0.9 || b.inTr < 4) { this.toCatch(); }
        else {
          // 止まりかけたら見渡しへ戻る（水を足せるように）
          if (lead - this.lastLead < 0.04) this.stallT += dt; else { this.stallT = 0; this.lastLead = lead; }
          if (this.stallT > 3.0) { this.toOverview(); }
          else this._followTarget(b, lead, offC);
        }
      }
    }
    if (this.mode === 'overview') this.overviewTarget(this.tPos, this.tLook);
    else if (this.mode === 'catch') this.catchTarget(this.tPos, this.tLook);
    if (this.first) { this.pos.copy(this.tPos); this.look.copy(this.tLook); this.first = false; }
    var lam = this.lambda;
    if (this.mode === 'follow') lam = SG.lerp(0.9, 2.6, SG.smooth(0, 1.8, this.modeT));
    else lam = SG.lerp(this.lambda, 2.4, SG.smooth(0, 3, this.modeT));
    SG.dampV3(this.pos, this.tPos, lam, dt);
    SG.dampV3(this.look, this.tLook, lam * 1.3, dt);
    this.cam.position.copy(this.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(this.look);
  };

  Rig.prototype._followTarget = function (b, lead, offC) {
    var c = this.world.course, tr = c.troughs;
    var path, s;
    if (lead < offC) { path = tr.S.path; s = lead; }
    else { path = tr.C.path; s = lead - offC; }
    var Tv = new T.Vector3(), Nv = new T.Vector3(), Bv = new T.Vector3(), A = new T.Vector3();
    var sb = SG.clamp(s - 0.75, 0, path.L);
    path.axis(sb, A); path.frame(sb, Tv, Nv, Bv);
    var side = this.followSide;
    // カーブでは外側へ
    if (path === tr.C.path && Math.abs(c.st.theta) > 0.05) {
      var outS = c.st.theta > 0 ? 1 : -1;
      var k = SG.smooth(0, 0.8, s);
      side = SG.lerp(side, outS, k);
    }
    var off = 0.72;
    this.tPos.copy(A).addScaledVector(Nv, side * off).add(new T.Vector3(0, 0.32, 0));
    var sl = SG.clamp(s + 1.1, 0, path.L + 1.5);
    var L = new T.Vector3();
    if (sl <= path.L) path.axis(sl, L);
    else { path.axis(path.L, L); var t2 = new T.Vector3(); path.frame(path.L, t2, new T.Vector3(), new T.Vector3()); L.addScaledVector(t2, sl - path.L); }
    L.y -= 0.25;
    L.addScaledVector(Nv, -side * 0.1);
    this.tLook.copy(L);
  };

  // 画面上の位置（px）
  Rig.prototype.toScreen = function (p, w, h, out) {
    var v = SG.tmpV[5].copy(p).project(this.cam);
    out.x = (v.x * 0.5 + 0.5) * w; out.y = (1 - (v.y * 0.5 + 0.5)) * h; out.z = v.z;
    return out;
  };

  SG.CameraRig = Rig;
})();
