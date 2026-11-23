/* guide.js — 導くのは世界の中の物だけ：次に触る物を一つだけ光らせて小さく弾ませる。約4秒で半透明の指が手本 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  function Guide(world) {
    this.world = world;
    this.target = null;
    this.key = '';
    this.overlays = [];
    this.t = 0;
    this.glowMat = new T.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.glowMatD = this.glowMat.clone(); this.glowMatD.side = T.DoubleSide;
    // 半透明の指
    var g = new T.Group();
    var M = world.mats;
    var body = new T.Mesh(new T.CapsuleGeometry(0.5, 1.6, 8, 16), M.ghost);
    body.position.y = 1.3;
    g.add(body);
    var nailM = M.ghost.clone(); nailM.color = new T.Color(0xffe2e2); nailM.opacity = 0.42;
    var nail = new T.Mesh(new T.SphereGeometry(0.36, 14, 10), nailM);
    nail.scale.set(1, 0.35, 1.25);
    nail.position.set(0, 0.75, 0.32);
    nail.rotation.x = -0.25;
    g.add(nail);
    g.renderOrder = 999;
    body.renderOrder = 999; nail.renderOrder = 1000;
    g.visible = false;
    world.scene.add(g);
    this.finger = g;
    this.fingerMats = [M.ghost, nailM];
    this.demoT = 0;
    this.lastPick = 0;
    this.bounceObj = null;
  }

  Guide.prototype._choose = function () {
    var w = this.world, c = w.course, nd = w.noodles, rig = w.rig, W = w.water, net = w.net;
    var V = T.Vector3;
    if (!c.assembled) {
      var st = c.nextStep();
      if (!st) return null;
      if (st.kind === 'pillar') {
        var hp = c.pillarHead(st.k, new V());
        return { kind: 'pillar', k: st.k, anchor: hp, demo: 'tap', roots: [c.pillars[st.k].group], bounce: c.pillars[st.k].group };
      }
      var tr = c.troughs[st.id];
      if (tr.state === 'held' || tr.state === 'snapped' || tr.state === 'seating') return null;
      var tg = c.attachTarget(st.id);
      var dest = new V(tg.x, tg.y + 0.2, tg.z);
      // 樋の上流の端から、つなぐ口へ
      var a = c.troughCenter(st.id, new V());
      return { kind: 'trough', id: st.id, anchor: a, dest: dest.add(new V(Math.cos(tg.yaw), 0, Math.sin(tg.yaw)).multiplyScalar(tr.L * 0.5)), demo: 'drag', roots: [tr.mesh], bounce: tr.mesh };
    }
    var sum = nd.summary();
    var netRoots = [net.obj.rim, net.obj.handle, net.obj.mesh];
    var bowl = c.bowlPos;
    var inNet = net.contactCountS > 12;
    if (inNet && !net.overBowl) {
      return { kind: 'net', anchor: net.c.clone(), dest: new V(bowl.x, net.c.y + 0.2, bowl.z), demo: 'drag', roots: netRoots, bounce: net.group };
    }
    var d = c.d;
    var offC = K.LS - d.iC, offE = offC + K.LC - c.st.iE;
    if (sum.lead && sum.lead.leadS > offC + K.LC * 0.4) {
      var land = this.landing();
      if (land.distanceTo(net.c) > 0.45) return { kind: 'net', anchor: net.c.clone(), dest: land, demo: 'drag', roots: netRoots, bounce: net.group };
      return null;
    }
    if (rig.mode === 'follow') return null;
    var trayLow = W.trayLevel() < K.WEIR + 0.035 && W.totalInChannels() < 0.05;
    var pit = w.pitcher;
    if (trayLow || pit.state === 'dock') {
      if (rig.mode === 'catch') {
        var hpA = c.pillarHead(2, new V());
        return { kind: 'pillar', k: 2, anchor: hpA, demo: 'tap', roots: [c.pillars[2].group], bounce: c.pillars[2].group };
      }
      var rim = new V(c.TX - K.TRAY_R * 0.7, c.d.yT + K.TRAY_DEPTH, c.TZ + K.TRAY_R * 0.7);
      var pc = new V(); pit.b.body.getWorldPosition(pc); pc.y += 1.0;
      return { kind: 'pitcher', anchor: pc, dest: rim, dest2: rim.clone().add(new V(0, 0.8, 0)), demo: pit.state === 'dock' ? 'up' : 'drag', roots: [pit.b.body], bounce: pit.root };
    }
    if (sum.flowing > 0) return null;
    if (sum.basinRest > 0 && sum.airborne === 0 && !sum.held) {
      var sb0 = this._sleeping();
      if (sb0 && sb0.distanceTo(net.c) > 0.35) return { kind: 'net', anchor: net.c.clone(), dest: sb0, demo: 'drag', roots: netRoots, bounce: net.group };
    }
    if (rig.mode === 'catch') {
      if (sum.airborne > 0) return null;
      var hp2 = c.pillarHead(2, new V());
      return { kind: 'pillar', k: 2, anchor: hp2, demo: 'tap', roots: [c.pillars[2].group], bounce: c.pillars[2].group };
    }
    if (!sum.held && sum.zaru > 0) {
      var zb = nd.pickZaruAny();
      if (zb) {
        var zc = nd.bundleCenter(zb, new V());
        var sp = new V(); c.troughs.S.path.axis(1.0, sp);
        return { kind: 'zaru', b: zb, anchor: zc, dest: sp, demo: 'drag', roots: [zb.mesh.mesh], bounce: zb.mesh.mesh, resetY: true };
      }
    }
    return null;
  };

  // 今の流れで麺が落ちる辺り
  Guide.prototype.landing = function () {
    var w = this.world, c = w.course, d = c.d, W = w.water;
    var v = Math.max(0.6, W.endV) * 0.8;
    var fall = Math.max(0.4, d.eOutY - 0.3);
    var t = Math.sqrt(2 * fall / K.G);
    var dist = v * t;
    var th = c.st.theta;
    var p = new T.Vector3(d.eOutX + Math.cos(th) * dist, 0.3, d.eOutZ + Math.sin(th) * dist);
    return p;
  };
  Guide.prototype._sleeping = function () {
    var nd = this.world.noodles;
    for (var i = 0; i < nd.bundles.length; i++) {
      var b = nd.bundles[i];
      if (b.state === 'sleep') { var c = nd.bundleCenter(b, new T.Vector3()); c.y = 0.3; return c; }
    }
    return null;
  };

  Guide.prototype._setOverlays = function (roots) {
    var self = this;
    this.overlays.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    this.overlays = [];
    if (!roots) return;
    roots.forEach(function (r) {
      r.traverse(function (m) {
        if (!m.isMesh || m.userData.isGlow || m.isInstancedMesh) return;
        var mat = (m.material && m.material.side === T.DoubleSide) ? self.glowMatD : self.glowMat;
        var o = new T.Mesh(m.geometry, mat);
        o.userData.isGlow = true;
        o.renderOrder = 5;
        o.frustumCulled = false;
        self.overlays.push({ mesh: o, parent: m });
      });
    });
    this.overlays = this.overlays.map(function (e) { e.parent.add(e.mesh); return e.mesh; });
  };

  Guide.prototype.update = function (dt) {
    var w = this.world;
    this.t += dt;
    this.lastPick -= dt;
    if (this.lastPick <= 0) {
      this.lastPick = 0.25;
      var nt = this._choose();
      var key = nt ? nt.kind + ':' + (nt.k !== undefined ? nt.k : '') + ':' + (nt.id || '') + ':' + (nt.b ? nt.b.id : '') : '';
      if (key !== this.key) {
        if (this.target && this.target.resetY && this.target.bounce) this.target.bounce.position.y = 0;
        this._setOverlays(nt ? nt.roots : null);
        this.key = key;
        this.demoT = 0;
      }
      this.target = nt;
    }
    var tg = this.target;
    var idle = w.input ? w.input.idleFor() : 0;
    for (var oi = 0; oi < this.overlays.length; oi++) {
      var ov = this.overlays[oi];
      if (ov.parent && ov.geometry !== ov.parent.geometry) ov.geometry = ov.parent.geometry;
    }
    // 光る（ゆっくり脈打つ）
    var pulse = tg ? 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(this.t * 3.4)) : 0;
    if (idle < 0.6) pulse *= 0.5;
    this.glowMat.opacity = pulse; this.glowMatD.opacity = pulse;
    // 小さく弾む
    if (tg && tg.bounce) {
      var ph = this.t % 2.2;
      var bo = ph < 0.5 ? Math.sin(ph / 0.5 * Math.PI) * 0.05 : 0;
      if (tg.resetY) tg.bounce.position.y = bo;
      else tg.bounce.position.y += bo;
    }
    // 半透明の指
    if (tg && idle > 4.0 && w.rig.mode !== 'follow') {
      this.demoT += dt;
      this._finger(tg, this.demoT);
    } else {
      this.demoT = 0;
      this.finger.visible = false;
    }
  };

  Guide.prototype._finger = function (tg, time) {
    var f = this.finger, cam = this.world.rig.cam;
    var per = tg.demo === 'tap' ? 2.0 : 3.0;
    var t = time % per;
    var from = tg.anchor, to = tg.dest || tg.anchor;
    var p = new T.Vector3(), press = 0, op = 0;
    if (tg.demo === 'tap') {
      if (t < 0.5) { op = t / 0.5; press = 0; }
      else if (t < 0.8) { op = 1; press = (t - 0.5) / 0.3; }
      else if (t < 1.1) { op = 1; press = 1 - (t - 0.8) / 0.3; }
      else if (t < 1.5) { op = 1 - (t - 1.1) / 0.4; }
      p.copy(from);
    } else {
      if (t < 0.4) { op = t / 0.4; p.copy(from); }
      else if (t < 0.6) { op = 1; press = (t - 0.4) / 0.2; p.copy(from); }
      else if (t < 2.1) {
        op = 1; press = 1;
        var u = SG.smooth(0.6, 2.1, t);
        if (tg.demo === 'up') { p.copy(from).lerp(tg.dest2 || from, u); }
        else {
          p.copy(from).lerp(to, u);
          p.y += Math.sin(u * Math.PI) * 0.4;
          if (tg.dest2 && u > 0.7) p.lerp(tg.dest2, (u - 0.7) / 0.3);
        }
      } else if (t < 2.4) { op = 1; press = 1 - (t - 2.1) / 0.3; p.copy(tg.demo === 'up' ? (tg.dest2 || from) : (tg.dest2 || to)); }
      else { op = Math.max(0, 1 - (t - 2.4) / 0.4); press = 0; p.copy(tg.demo === 'up' ? (tg.dest2 || from) : (tg.dest2 || to)); }
    }
    var dist = p.distanceTo(cam.position);
    var s = dist * 0.03;
    var toCam = cam.position.clone().sub(p).normalize();
    var axis = toCam.clone().add(new T.Vector3(0, 0.9, 0)).normalize();
    var lift = (1 - press) * 1.0 * s;
    f.position.copy(p).addScaledVector(axis, lift + 0.2 * s);
    f.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
    // 爪をこちらへ
    var side = new T.Vector3().crossVectors(axis, toCam);
    if (side.lengthSq() > 1e-6) {
      var q2 = new T.Quaternion();
      var nailDir = new T.Vector3(0, 0, 1).applyQuaternion(f.quaternion);
      var want = toCam.clone().addScaledVector(axis, -toCam.dot(axis)).normalize();
      var ang = Math.atan2(new T.Vector3().crossVectors(nailDir, want).dot(axis), nailDir.dot(want));
      q2.setFromAxisAngle(axis, ang);
      f.quaternion.premultiply(q2);
    }
    f.scale.setScalar(s * (1 - press * 0.08));
    f.visible = op > 0.01;
    this.fingerMats[0].opacity = 0.36 * op;
    this.fingerMats[1].opacity = 0.4 * op;
  };

  SG.Guide = Guide;
})();
