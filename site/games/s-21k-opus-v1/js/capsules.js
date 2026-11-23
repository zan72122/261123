// capsules.js — 殻（色付きの下半分・透明な上半分）、景品三つ、閉じたカプセル、机の上での転がり
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var V3 = THREE.Vector3, Q = THREE.Quaternion;
  var C = (G.caps = { list: [], shells: [], caps: [], prizes: [] });
  G.pickables = G.pickables || [];
  var R = K.R;

  // ---------- 形 ----------
  function shellGeo() {
    var pts = [], i, n = 18;
    for (i = 0; i <= n; i++) {           // 外側：下の極から赤道へ
      var a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * R), Math.sin(a) * R - 0.02 * (i / n)));
    }
    pts.push(new THREE.Vector2(R - 0.05, -0.02));
    pts.push(new THREE.Vector2(R - 0.05, 0.13));
    pts.push(new THREE.Vector2(R - 0.09, 0.13));
    pts.push(new THREE.Vector2(R - 0.09, -0.01));
    for (i = n; i >= 0; i--) {           // 内側：赤道から下の極へ
      var b = -Math.PI / 2 + (i / n) * (Math.PI / 2);
      var ri = K.RIN + 0.02;
      pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(b) * ri), Math.sin(b) * ri - 0.01));
    }
    return new THREE.LatheGeometry(pts, 40);
  }
  function capGeo() {
    var pts = [], i, n = 18;
    pts.push(new THREE.Vector2(R, -0.03));
    for (i = 0; i <= n; i++) {
      var a = (i / n) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * R), Math.sin(a) * R));
    }
    for (i = n; i >= 0; i--) {
      var b = (i / n) * (Math.PI / 2);
      var ri = R - 0.05;
      pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(b) * ri), Math.sin(b) * ri));
    }
    pts.push(new THREE.Vector2(R - 0.05, -0.03));
    pts.push(new THREE.Vector2(R, -0.03));
    return new THREE.LatheGeometry(pts, 40);
  }
  var GEO = {};
  function buildGeos() {
    GEO.shell = shellGeo();
    GEO.cap = capGeo();
    // 縁の小さな傷（細い弧）
    GEO.scratch = new THREE.TorusGeometry(R + 0.002, 0.004, 3, 10, 0.35);
    GEO.scratchMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  }

  function buildEraser() {
    var s = new THREE.Shape(), w = 0.4, h = 0.24, r = 0.12;
    s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r);
    s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h);
    s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 4, curveSegments: 8 });
    g.translate(0, 0, -0.14);
    g.rotateX(-Math.PI / 2);     // 広い面を下に
    var m = new THREE.Mesh(g, G.mat.rubber);
    var grp = new THREE.Group(); grp.add(m);
    return { obj: grp, he: new V3(0.47, 0.22, 0.31) };
  }
  function buildPacket() {
    var grp = new THREE.Group();
    var s = new THREE.Shape(), w = 0.42, d = 0.29;
    s.moveTo(-w, -d); s.lineTo(w, -d); s.lineTo(w, d); s.lineTo(-w, d); s.lineTo(-w, -d);
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.translate(0, 0, -0.05); g.rotateX(-Math.PI / 2);
    var body = new THREE.Mesh(g, G.mat.paper);
    grp.add(body);
    // 折り返した端（三角のふた）
    var fs = new THREE.Shape();
    fs.moveTo(-w + 0.02, 0); fs.lineTo(w - 0.02, 0); fs.lineTo(0.04, -0.4); fs.lineTo(-0.04, -0.4); fs.lineTo(-w + 0.02, 0);
    var fg = new THREE.ShapeGeometry(fs);
    fg.rotateX(-Math.PI / 2);
    var flapPivot = new THREE.Object3D();
    flapPivot.position.set(0, 0.085, -d + 0.02);
    var flap = new THREE.Mesh(fg, G.mat.paper);
    flap.position.y = 0.002;
    flapPivot.add(flap);
    grp.add(flapPivot);
    // 折り目の筋
    var crease = new THREE.Mesh(new THREE.BoxGeometry(2 * w - 0.06, 0.006, 0.012), new THREE.MeshStandardMaterial({ color: 0xd9cfbb, roughness: 1 }));
    crease.position.set(0, 0.087, -d + 0.03);
    grp.add(crease);
    return { obj: grp, he: new V3(0.45, 0.1, 0.32), flap: flapPivot };
  }
  function buildTop() {
    var pts = [
      [0.001, -0.41], [0.05, -0.37], [0.16, -0.25], [0.3, -0.12], [0.4, -0.04], [0.42, 0.02],
      [0.4, 0.07], [0.3, 0.1], [0.12, 0.12], [0.085, 0.13], [0.08, 0.36], [0.07, 0.4], [0.03, 0.42], [0.001, 0.42]
    ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var g = new THREE.LatheGeometry(pts, 32);
    var m = new THREE.Mesh(g, G.mat.topWood);
    var grp = new THREE.Group(); grp.add(m);
    // 色の帯（塗りの輪）
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.405, 0.022, 6, 32), new THREE.MeshStandardMaterial({ color: 0xc8553d, roughness: 0.5 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.015;
    grp.add(ring);
    var ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.224, 0.016, 6, 28), new THREE.MeshStandardMaterial({ color: 0x3d7a5a, roughness: 0.5 }));
    ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.2;
    grp.add(ring2);
    return { obj: grp, he: new V3(0.42, 0.41, 0.42) };
  }

  // ---------- 景品 ----------
  var THR = { eraser: [2.5, 2.8], packet: [0.8, 1.7], top: [1.5, 2.1] };
  function Prize(kind) {
    this.kind = kind;
    var b = kind === 'eraser' ? buildEraser() : kind === 'packet' ? buildPacket() : buildTop();
    this.obj = b.obj; this.he = b.he; this.flap = b.flap || null;
    G.shadowAll(this.obj);
    this.mats = G.ownMaterials(this.obj);
    this.wq = new Q();            // 世界での向き
    this.state = 'desk';
    this.home = null;             // 入っている殻 or カプセル
    this.rollAcc = 0; this.rollAxis = new V3(1, 0, 0);
    this.thr = G.rr(THR[kind][0], THR[kind][1]);
    this.flipAnim = null;
    this.lag = new V3(); this.lagV = new V3();
    this.flapS = new G.Spring(0.18, 30, 6);
    this.spin = 0; this.spinA = 0; this.tilt = 0;
    this.settleS = null;
    this.trayLocal = null;
  }
  // 容れ物の中心から下向きにどれだけ沈むか
  Prize.prototype.depth = function () {
    var m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.wq));
    var e = m.elements, he = this.he;
    var hx = Math.abs(e[0]) * he.x + Math.abs(e[3]) * he.y + Math.abs(e[6]) * he.z;
    var hy = Math.abs(e[1]) * he.x + Math.abs(e[4]) * he.y + Math.abs(e[7]) * he.z;
    var hz = Math.abs(e[2]) * he.x + Math.abs(e[5]) * he.y + Math.abs(e[8]) * he.z;
    var hr = Math.min(0.78, Math.hypot(hx, hz) * 0.9);
    var ri = K.RIN - 0.01;
    return Math.sqrt(Math.max(0.02, ri * ri - hr * hr)) - hy;
  };
  // 殻の中の置き場（重さで底へ）
  Prize.prototype.placeIn = function (center) {
    var d = this.depth();
    this.obj.position.set(center.x + this.lag.x, center.y - d, center.z + this.lag.z);
    this.obj.quaternion.copy(this.wq);
  };
  // 容れ物が回ったとき（dq: 世界での回転差分）
  Prize.prototype.onRoll = function (dq) {
    if (this.flipAnim) return;
    var w = G.clamp(Math.abs(dq.w), -1, 1);
    var ang = 2 * Math.acos(w);
    if (ang < 1e-5) return;
    var s = Math.sqrt(1 - w * w) || 1;
    var ax = new V3(dq.x / s, dq.y / s, dq.z / s);
    if (dq.w < 0) ax.negate();
    var hor = Math.sqrt(ax.x * ax.x + ax.z * ax.z);
    if (hor < 0.2) return;
    this.rollAcc += ang * hor;
    this.rollAxis.lerp(new V3(ax.x, 0, ax.z).normalize(), 0.5).normalize();
    if (this.rollAcc > this.thr) {
      this.rollAcc = 0;
      this.thr = G.rr(THR[this.kind][0], THR[this.kind][1]);
      this.flip(this.rollAxis.clone());
    }
  };
  Prize.prototype.flip = function (axis) {
    var amt = this.kind === 'packet' && G.rand() < 0.4 ? Math.PI : Math.PI / 2;
    var target = new Q().setFromAxisAngle(axis, amt).multiply(this.wq);
    target = G.snapUpright(target);
    this.flipAnim = { from: this.wq.clone(), to: target, t: 0 };
    var snd = this.kind === 'eraser' ? 'rubber' : this.kind === 'packet' ? 'paper' : 'wood';
    if (G.audio) { G.audio.hit('inner', this.kind === 'eraser' ? 0.8 : 0.5, 0, 0.06); G.audio.hit(snd, 0.3, 0, 0.08); }
  };
  // こまが横倒しか
  Prize.prototype.isSideways = function () {
    var ax = new V3(0, 1, 0).applyQuaternion(this.wq);
    return Math.abs(ax.y) < 0.5;
  };
  Prize.prototype.update = function (dt) {
    if (this.flipAnim) {
      var f = this.flipAnim;
      f.t += dt / 0.16;
      this.wq.slerpQuaternions(f.from, f.to, G.easeInOut(f.t));
      if (f.t >= 1) { this.wq.copy(f.to); this.flipAnim = null; }
    }
    // 容れ物の動きに少し遅れる
    this.lagV.addScaledVector(this.lag, -220 * dt);
    this.lagV.multiplyScalar(Math.exp(-14 * dt));
    this.lag.addScaledVector(this.lagV, dt);
    if (this.lag.length() > 0.12) this.lag.setLength(0.12);
    // 紙包みの折り返しがかすかに戻る
    if (this.flap) {
      var a = this.flapS.step(dt);
      this.flap.rotation.x = -a;
    }
    if (this.state === 'desk' || this.state === 'tray') this.deskUpdate(dt);
    else if (this.state === 'held') {
      G.dampV(this.obj.position, this.tpos, 18, dt);
      this.wq.slerp(this.holdQ, 1 - Math.exp(-10 * dt));
      this.obj.quaternion.copy(this.wq);
    } else if (this.home) {
      var c = this.home.center();
      this.placeIn(c);
    }
  };
  // 机に置いたあとの動き（消しゴム：傾いて広い面へ／こま：払うと回る）
  Prize.prototype.restPose = function () {
    var yaw = this.yaw || 0;
    var qy = new Q().setFromAxisAngle(G.UP, yaw);
    if (this.kind === 'top') {
      var tiltAx = new V3(Math.cos(this.tiltDir || 0), 0, Math.sin(this.tiltDir || 0));
      var q = new Q().setFromAxisAngle(tiltAx, 0.8);
      return { q: q.multiply(qy), y: 0.293 };
    }
    return { q: qy, y: this.kind === 'eraser' ? 0.22 : 0.105 };
  };
  Prize.prototype.floorY = function () {
    if (this.state === 'tray') return K.TRAY_FLOOR + G.parts.tray.sink.x;
    return 0;
  };
  Prize.prototype.deskUpdate = function (dt) {
    var base = this.floorY();
    if (this.state === 'tray' && this.trayLocal) {
      this.obj.position.x = G.parts.tray.x + this.trayLocal.x;
      this.obj.position.z = K.TRAY_Z + this.trayLocal.z;
    }
    var rp = this.restPose();
    if (this.kind === 'top' && this.spin > 0.4) {
      // 回っている間は起き上がり、首を振る
      this.spinA += this.spin * dt;
      this.spin *= Math.exp(-0.8 * dt);
      this.spin -= 1.1 * dt;
      var up = G.clamp(1 - (this.spin - 2) / 10, 0, 1);
      var tilt = G.lerp(0.06, 0.55, up * up);
      this.prec = (this.prec || 0) + dt * (2 + 4 * up);
      var tAx = new V3(Math.cos(this.prec), 0, Math.sin(this.prec));
      var q = new Q().setFromAxisAngle(tAx, tilt).multiply(new Q().setFromAxisAngle(G.UP, this.spinA));
      this.wq.copy(q);
      this.obj.quaternion.copy(q);
      this.obj.position.y = base + G.lerp(0.41, 0.3, up);
      if (this.spinMove) {
        this.obj.position.addScaledVector(this.spinMove, dt);
        this.spinMove.multiplyScalar(Math.exp(-3 * dt));
      }
      if (G.audio) G.audio.ask('whir', Math.min(1, this.spin / 20));
      if (this.spin <= 0.4) {
        this.spin = 0;
        this.tiltDir = this.prec;
        this.yaw = this.spinA;
        this.settleT = 0; this.settleFrom = this.wq.clone(); this.settleFromY = this.obj.position.y;
        if (G.audio) G.audio.hit('wood', 0.5);
      }
      return;
    }
    if (this.settleT != null) {
      // 置いた直後：傾いてから広い面で止まる
      this.settleT += dt;
      var k = G.clamp(this.settleT / (this.kind === 'eraser' ? 0.55 : 0.35), 0, 1);
      var target = rp.q;
      if (this.kind === 'eraser' && this.settleTilt) {
        var wob = Math.sin(k * Math.PI * 2.5) * (1 - k) * 0.12;
        var tilt2 = this.settleTilt * Math.max(0, 1 - G.easeInOut(k * 1.3)) + Math.abs(wob);
        var q2 = new Q().setFromAxisAngle(this.settleAx, tilt2).multiply(rp.q);
        this.wq.copy(q2);
        if (k > 0.75 && !this.settleSnd) { this.settleSnd = true; if (G.audio) G.audio.hit('rubber', 0.5); }
      } else {
        this.wq.slerpQuaternions(this.settleFrom, target, G.easeOut(k));
      }
      this.obj.quaternion.copy(this.wq);
      this.obj.position.y = G.lerp(this.settleFromY, base + rp.y, G.easeOut(Math.min(1, k * 2)));
      if (k >= 1) { this.settleT = null; this.wq.copy(target); }
      return;
    }
    this.wq.copy(rp.q);
    this.obj.quaternion.copy(rp.q);
    this.obj.position.y = base + rp.y;
  };
  Prize.prototype.center = function () { return this.obj.position.clone(); };
  // 机に置く
  Prize.prototype.toDesk = function (p, fromHeight) {
    this.state = 'desk'; this.home = null; this.trayLocal = null;
    this.obj.position.set(p.x, fromHeight != null ? fromHeight : this.obj.position.y, p.z);
    this.yaw = this.yawFromQ();
    this.settleT = 0; this.settleFrom = this.wq.clone(); this.settleFromY = this.obj.position.y;
    this.settleSnd = false;
    if (this.kind === 'eraser') {
      this.settleTilt = G.rr(0.35, 0.5);
      this.settleAx = new V3(G.rr(-1, 1), 0, G.rr(-1, 1)).normalize();
      if (G.audio) G.audio.hit('rubber', 0.6, p.x / 12, 0.08);
    } else if (this.kind === 'packet') {
      this.flapS.x = 0.02; this.flapS.t = G.rr(0.16, 0.26); this.flapS.k = 6; this.flapS.c = 3.2;
      if (G.audio) G.audio.hit('paper', 0.6, p.x / 12, 0.06);
    } else {
      this.tiltDir = G.rr(0, Math.PI * 2);
      if (G.audio) G.audio.hit('wood', 0.6, p.x / 12, 0.07);
    }
    if (G.game) G.game.onEvent('prizeDesk', this);
  };
  Prize.prototype.yawFromQ = function () {
    var f = new V3(1, 0, 0).applyQuaternion(this.wq); f.y = 0;
    if (f.lengthSq() < 1e-4) return this.yaw || 0;
    return Math.atan2(-f.z, f.x);
  };
  Prize.prototype.flick = function (dir) {
    if (this.kind !== 'top') return;
    this.spin = G.rr(16, 22);
    this.spinA = this.yaw || 0;
    this.prec = this.tiltDir || 0;
    this.settleT = null;
    this.spinMove = dir ? dir.clone().multiplyScalar(0.25) : null;
    if (G.audio) G.audio.hit('wood', 0.7);
    if (G.game) G.game.onEvent('topSpin');
  };

  // ---------- 殻 ----------
  function Shell(ci) {
    this.ci = ci;
    this.obj = new THREE.Group();
    var m = new THREE.Mesh(GEO.shell, G.mat.shells[ci]);
    m.castShadow = true; m.receiveShadow = true;
    this.obj.add(m);
    this.mats = G.ownMaterials(this.obj);
    this.state = 'desk'; this.prize = null; this.capsule = null;
    this.hole = -1; this.trayLocal = null;
    this.tilt = new G.Spring(0, 90, 7); this.tiltAx = new V3(1, 0, 0);
    this.yaw = G.rr(0, 6.28);
  }
  Shell.prototype.center = function () { return this.obj.position.clone(); };
  Shell.prototype.baseY = function () {
    if (this.state === 'tray') return K.TRAY_FLOOR + R + G.parts.tray.sink.x;
    return R;
  };
  Shell.prototype.update = function (dt) {
    if (this.state === 'capsule' || this.state === 'anim') return;
    if (this.state === 'held') {
      G.dampV(this.obj.position, this.tpos, 18, dt);
      this.obj.quaternion.setFromAxisAngle(G.UP, this.yaw);
      return;
    }
    // 中身の重みで少し傾く（穴の中で）
    var w = this.prize ? (this.prize.kind === 'eraser' ? 0.15 : this.prize.kind === 'top' ? 0.08 : 0.035) : 0;
    this.tilt.t = w;
    var t = this.tilt.step(dt);
    if (this.state === 'tray' && this.trayLocal) {
      this.obj.position.set(G.parts.tray.x + this.trayLocal.x, this.baseY(), K.TRAY_Z + this.trayLocal.z);
    } else this.obj.position.y = this.baseY();
    this.obj.quaternion.setFromAxisAngle(this.tiltAx, t).multiply(new Q().setFromAxisAngle(G.UP, this.yaw));
  };

  // ---------- 透明なふた ----------
  function Cap() {
    this.obj = new THREE.Group();
    var m = new THREE.Mesh(GEO.cap, G.mat.clear);
    m.renderOrder = 2;
    this.obj.add(m);
    for (var i = 0; i < 3; i++) {
      var s = new THREE.Mesh(GEO.scratch, GEO.scratchMat);
      s.userData.noGlow = true;
      s.rotation.set(G.rr(-0.25, 0.25), G.rr(0, 6.28), G.rr(-0.25, 0.25));
      s.position.y = G.rr(0.08, 0.35);
      s.scale.setScalar(Math.cos(Math.asin(s.position.y / R)));
      s.renderOrder = 3;
      this.obj.add(s);
    }
    this.mats = G.ownMaterials(this.obj);
    this.state = 'desk';
    this.yaw = G.rr(0, 6.28);
  }
  Cap.prototype.center = function () { return this.obj.position.clone().add(new V3(0, 0.4, 0)); };
  Cap.prototype.update = function (dt) {
    if (this.state === 'held') {
      G.dampV(this.obj.position, this.tpos, 18, dt);
      this.obj.quaternion.slerp(new Q().setFromAxisAngle(G.UP, this.yaw), 1 - Math.exp(-10 * dt));
    }
  };

  // ---------- 閉じたカプセル ----------
  function Capsule(shell, cap) {
    this.obj = new THREE.Group();
    this.shell = shell; this.cap = cap; this.prize = shell.prize;
    this.pos = shell.obj.position.clone();
    this.quat = new Q().setFromAxisAngle(G.UP, shell.yaw);
    shell.obj.position.set(0, 0, 0); shell.obj.quaternion.identity();
    cap.obj.position.set(0, 0, 0); cap.obj.quaternion.identity();
    this.obj.add(shell.obj); this.obj.add(cap.obj);
    shell.state = 'capsule'; cap.state = 'capsule'; shell.capsule = this;
    if (this.prize) { this.prize.state = 'inCapsule'; this.prize.home = this; }
    this.vel = new V3();
    this.prevQ = this.quat.clone();
    this.state = 'desk';
    this.hole = -1;
    this.capOff = new V3(); this.capTwist = 0;
    this.mats = shell.mats.concat(cap.mats);
    this.apply();
    C.list.push(this);
  }
  Capsule.prototype.center = function () { return this.pos.clone(); };
  Capsule.prototype.apply = function () {
    this.obj.position.copy(this.pos);
    this.obj.quaternion.copy(this.quat);
    this.cap.obj.position.copy(this.capOff);
    this.cap.obj.rotation.set(0, this.capTwist, 0);
  };
  // 転がす（世界での移動量）
  Capsule.prototype.rollBy = function (dx, dz) {
    var L = Math.hypot(dx, dz);
    if (L < 1e-6) return;
    var ax = new V3(dz / L, 0, -dx / L);
    this.quat.premultiply(new Q().setFromAxisAngle(ax, L / R));
  };
  Capsule.prototype.afterMove = function (dt, accel) {
    // 中の景品へ回転を伝える
    var dq = this.quat.clone().multiply(this.prevQ.clone().invert());
    if (this.prize) {
      this.prize.onRoll(dq);
      if (accel) this.prize.lagV.addScaledVector(accel, -0.004);
    }
    this.prevQ.copy(this.quat);
    this.apply();
  };
  Capsule.prototype.upright = function () { return new Q().setFromAxisAngle(G.UP, this.shell.yaw); };

  C.Capsule = Capsule;
  C.Shell = Shell; C.Cap = Cap; C.Prize = Prize;

  // ---------- 作って並べる ----------
  C.build = function (scene) {
    buildGeos();
    C.scene = scene;
    var order = [0, 1, 2].sort(function () { return G.rand() - 0.5; });
    var holes = G.parts.holes;
    order.forEach(function (ci, i) {
      var s = new Shell(ci);
      s.state = 'hole'; s.hole = i;
      holes[i].item = s;
      s.obj.position.set(holes[i].pos.x, R, holes[i].pos.z);
      s.tiltAx.set(G.rr(-1, 1), 0, G.rr(-1, 1)).normalize();
      scene.add(s.obj);
      C.shells.push(s);
    });
    for (var i = 0; i < 3; i++) {
      var c = new Cap();
      var hp = holes[i].pos;
      c.obj.position.set(hp.x + G.rr(-0.5, 0.5), 0.02, hp.z + 2.35 + G.rr(-0.2, 0.3));
      c.obj.quaternion.setFromAxisAngle(G.UP, c.yaw);
      scene.add(c.obj);
      C.caps.push(c);
    }
    var kinds = ['eraser', 'packet', 'top'].sort(function () { return G.rand() - 0.5; });
    var spots = [[-3.4, 13.1], [0.1, 13.6], [3.5, 13.0]];
    kinds.forEach(function (k, i) {
      var p = new Prize(k);
      p.yaw = G.rr(0, 6.28);
      p.tiltDir = G.rr(0, 6.28);
      if (k === 'packet') { p.flapS.x = p.flapS.t = G.rr(0.1, 0.3); }
      p.state = 'desk';
      p.obj.position.set(spots[i][0] + G.rr(-0.3, 0.3), 0, spots[i][1] + G.rr(-0.3, 0.3));
      scene.add(p.obj);
      C.prizes.push(p);
    });
    registerPicks();
  };

  // ---------- 机の上の転がり ----------
  function deskPhysics(cp, dt) {
    if (cp.state !== 'desk') return;
    var sp = cp.vel.length();
    if (sp < 0.02) { cp.vel.set(0, 0, 0); cp.afterMove(dt); return; }
    var dx = cp.vel.x * dt, dz = cp.vel.z * dt;
    cp.pos.x += dx; cp.pos.z += dz;
    cp.rollBy(dx, dz);
    cp.vel.multiplyScalar(Math.exp(-2.2 * dt));
    collideDesk(cp);
    cp.pos.y = R;
    cp.afterMove(dt);
  }
  function collideDesk(cp) {
    var b = 0.45;
    var bb = G.parts.bounds();
    var lim = [bb.x0 + R, bb.x1 - R, bb.z0 + R, bb.z1 - R];
    if (cp.pos.x < lim[0]) { cp.pos.x = lim[0]; cp.vel.x = Math.abs(cp.vel.x) * b; }
    if (cp.pos.x > lim[1]) { cp.pos.x = lim[1]; cp.vel.x = -Math.abs(cp.vel.x) * b; }
    if (cp.pos.z < lim[2]) { cp.pos.z = lim[2]; cp.vel.z = Math.abs(cp.vel.z) * b; }
    if (cp.pos.z > lim[3]) { cp.pos.z = lim[3]; cp.vel.z = -Math.abs(cp.vel.z) * b; }
    // 箱と受け皿の縁
    var rects = [];
    if (G.box.hinges.R.angle > 0.6 || G.box.hinges.L.angle > 0.6) rects.push([-5.3, 5.3, -3.0, 2.3]);
    var tx = G.parts.tray.x;
    rects.push([tx - K.TRAY_W / 2 - 0.05, tx + K.TRAY_W / 2 + 0.05, K.TRAY_Z - K.TRAY_D / 2 - 0.05, K.TRAY_Z + K.TRAY_D / 2 + 0.05]);
    rects.forEach(function (r, ri) {
      var x0 = r[0] - R, x1 = r[1] + R, z0 = r[2] - R, z1 = r[3] + R;
      var p = cp.pos;
      if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) {
        var d = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
        if (ri === 0 && r[2] < -2) d[2] = 1e9;   // 箱の奥へは押し出さない
        var mi = d.indexOf(Math.min.apply(null, d));
        if (mi === 0) { p.x = x0; cp.vel.x = -Math.abs(cp.vel.x) * b; }
        if (mi === 1) { p.x = x1; cp.vel.x = Math.abs(cp.vel.x) * b; }
        if (mi === 2) { p.z = z0; cp.vel.z = -Math.abs(cp.vel.z) * b; }
        if (mi === 3) { p.z = z1; cp.vel.z = Math.abs(cp.vel.z) * b; }
        if (cp.vel.length() > 0.6 && G.audio) G.audio.hit('card', 0.25);
      }
    });
  }
  function capsuleCollisions() {
    var L = C.list;
    for (var i = 0; i < L.length; i++) {
      for (var j = i + 1; j < L.length; j++) {
        var a = L[i], b = L[j];
        if (!onDesk(a) || !onDesk(b)) continue;
        var dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        if (d > 0 && d < 2 * R) {
          var nx = dx / d, nz = dz / d, push = (2 * R - d) / 2;
          var aF = a.state === 'desk', bF = b.state === 'desk';
          if (aF && bF) { a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push; }
          else if (aF) { a.pos.x -= nx * push * 2; a.pos.z -= nz * push * 2; }
          else if (bF) { b.pos.x += nx * push * 2; b.pos.z += nz * push * 2; }
          var rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
          if (rv < 0) {
            var imp = -rv * 0.8;
            if (aF) { a.vel.x -= nx * imp; a.vel.z -= nz * imp; }
            if (bF) { b.vel.x += nx * imp; b.vel.z += nz * imp; }
            if (G.audio && imp > 0.3) G.audio.hit('shell', Math.min(1, imp / 4), a.pos.x / 12);
          }
        }
      }
    }
  }
  function onDesk(c) { return c.state === 'desk' || c.state === 'held' || c.state === 'hole'; }

  C.update = function (dt) {
    C.prizes.forEach(function (p) { p.update(dt); });
    C.shells.forEach(function (s) { s.update(dt); });
    C.caps.forEach(function (c) { c.update(dt); });
    C.list.forEach(function (cp) {
      if (cp.state === 'held') heldUpdate(cp, dt);
      else if (cp.state === 'desk') deskPhysics(cp, dt);
      else if (cp.state === 'hole') { cp.pos.y = R; cp.afterMove(dt); }
      else if (cp.state === 'opening') openingUpdate(cp, dt);
    });
    capsuleCollisions();
    // 景品は最後に容れ物へ
    C.prizes.forEach(function (p) { if (p.home && p.state !== 'held') p.placeIn(p.home.center()); });
  };

  // ---------- 持つ・置く ----------
  function deskPoint(ray, h) { return G.stage.rayPlaneY(ray, h); }
  function overTray(p) {
    var tx = G.parts.tray.x;
    return p && Math.abs(p.x - tx) < K.TRAY_W / 2 - 0.3 && Math.abs(p.z - K.TRAY_Z) < K.TRAY_D / 2 - 0.2;
  }
  function trayLocalOf(p) {
    var tx = G.parts.tray.x;
    return new V3(G.clamp(p.x - tx, -K.TRAY_W / 2 + R + 0.1, K.TRAY_W / 2 - R - 0.1), 0, G.clamp(p.z - K.TRAY_Z, -K.TRAY_D / 2 + R + 0.1, K.TRAY_D / 2 - R - 0.1));
  }
  function nearestFreeHole(p, maxD) {
    var best = -1, bd = maxD;
    G.parts.holes.forEach(function (h, i) {
      if (h.item) return;
      var d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function leaveHole(it) {
    G.parts.holes.forEach(function (h) { if (h.item === it) h.item = null; });
  }
  // 箱の投入口の上か
  function overBoxTop(ray) {
    if (!G.flow.canAccept()) return null;
    var p = G.stage.rayPlaneY(ray, K.H + 0.4);
    if (!p) return null;
    if (Math.abs(p.x) < K.W / 2 + 0.8 && p.z > -3.4 && p.z < 3.2) return p;
    // 画面上で箱の上部に近いときも受ける
    var s = G.stage.toScreen(new V3(0, K.H + 0.4, 0), new V3());
    var e = G.stage.toScreen(new V3(K.W / 2, K.H + 0.4, 0), new V3());
    var px = G.input.px, py = G.input.py;
    if (Math.abs(px - s.x) < Math.abs(e.x - s.x) * 1.05 && Math.abs(py - s.y) < Math.max(50, Math.abs(e.x - s.x) * 0.5)) {
      return new V3((px - s.x) / Math.max(1, Math.abs(e.x - s.x)) * K.W / 2, K.H + 0.4, 0);
    }
    return null;
  }

  // 閉じたカプセル
  function heldUpdate(cp, dt) {
    var prev = cp.pos.clone();
    if (cp.hover) {
      G.dampV(cp.pos, cp.tpos, 14, dt);
      cp.quat.slerp(cp.upright(), 1 - Math.exp(-6 * dt));
    } else {
      cp.pos.x = G.damp(cp.pos.x, cp.tpos.x, 18, dt);
      cp.pos.z = G.damp(cp.pos.z, cp.tpos.z, 18, dt);
      cp.pos.y = G.damp(cp.pos.y, R, 16, dt);
      collideDesk(cp);
      cp.rollBy(cp.pos.x - prev.x, cp.pos.z - prev.z);
    }
    var v = cp.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
    var acc = v.clone().sub(cp.vel).divideScalar(Math.max(dt, 1e-3));
    cp.vel.lerp(v, 0.5);
    cp.afterMove(dt, acc);
    var sp = Math.hypot(v.x, v.z);
    if (!cp.hover && G.audio) G.audio.ask('scrape', Math.min(0.25, sp / 30), 0.9);
  }
  function capsuleDown(cp, ctx) {
    if (cp.state === 'tray') return openDown(cp, ctx);
    if (cp.state !== 'desk' && cp.state !== 'hole') return false;
    if (cp.state === 'hole') leaveHole(cp);
    cp.state = 'held'; cp.hover = false;
    var p = deskPoint(ctx.ray, R) || cp.pos.clone();
    cp.grabOff = new V3(cp.pos.x - p.x, 0, cp.pos.z - p.z);
    if (cp.grabOff.length() > 0.9) cp.grabOff.setLength(0.9);
    cp.tpos = cp.pos.clone();
    if (G.audio) G.audio.hit('shell', 0.35, cp.pos.x / 12);
    return true;
  }
  function capsuleMove(cp, ctx) {
    if (cp.state === 'opening') return openMove(cp, ctx);
    if (cp.state !== 'held') return;
    var top = overBoxTop(ctx.ray);
    cp.overTray = false;
    if (top) {
      cp.hover = true;
      cp.tpos = new V3(G.clamp(top.x, -2.4, 2.4), K.H + 1.5, K.LANE_Z);
    } else {
      var p = deskPoint(ctx.ray, R);
      if (p && overTray(p)) {
        cp.hover = true; cp.overTray = true;
        var tl = trayLocalOf(p);
        cp.tpos = new V3(G.parts.tray.x + tl.x, K.TRAY_FLOOR + R + 0.6, K.TRAY_Z + tl.z);
      } else {
        cp.hover = false;
        if (p) cp.tpos = new V3(p.x + cp.grabOff.x, R, p.z + cp.grabOff.z);
      }
    }
  }
  function capsuleUp(cp, ctx) {
    if (cp.state === 'opening') return openUp(cp, ctx);
    if (cp.state !== 'held') return;
    if (cp.hover && cp.overTray) {
      cp.hover = false; cp.overTray = false;
      var tl = new V3(cp.pos.x - G.parts.tray.x, 0, cp.pos.z - K.TRAY_Z);
      G.flow.toTray(cp, tl, new V3(0, 0, 0), Math.max(0, cp.pos.y - (K.TRAY_FLOOR + R)));
      return;
    }
    if (cp.hover && G.flow.canAccept()) {
      cp.hover = false;
      G.flow.insert(cp);
      return;
    }
    cp.hover = false;
    var hi = nearestFreeHole(cp.pos, 1.4);
    if (hi >= 0) {
      var h = G.parts.holes[hi];
      h.item = cp; cp.state = 'anim'; cp.hole = hi;
      var from = cp.pos.clone(), q0 = cp.quat.clone(), q1 = cp.upright();
      G.tween(0.25, function (k) {
        cp.pos.lerpVectors(from, new V3(h.pos.x, R + Math.sin(k * Math.PI) * 0.4, h.pos.z), k);
        cp.quat.slerpQuaternions(q0, q1, k);
        cp.afterMove(0.016);
      }, function () { cp.state = 'hole'; if (G.audio) G.audio.hit('card', 0.3); G.audio && G.audio.hit('shell', 0.3, 0, 0.02); });
      return;
    }
    cp.state = 'desk';
    if (cp.vel.length() > 14) cp.vel.setLength(14);
    cp.vel.y = 0;
  }

  // ---------- 開ける（受け皿の上で継ぎ目をずらす） ----------
  function openDown(cp, ctx) {
    cp.state = 'opening';
    G.flow.holdInTray(cp, true);
    var p = deskPoint(ctx.ray, cp.pos.y) || cp.pos.clone();
    cp.openStart = p.clone();
    cp.openD = new V3();
    cp.uprightFrom = cp.quat.clone();
    cp.uprightT = 0;
    if (G.audio) G.audio.hit('shell', 0.3);
    return true;
  }
  function openMove(cp, ctx) {
    var p = deskPoint(ctx.ray, cp.pos.y);
    if (!p) return;
    var d = p.clone().sub(cp.openStart); d.y = 0;
    // 下向きに引いた分も横ずらしとして扱う（画面で下＝手前）
    cp.openD.copy(d);
    if (d.length() > 1.05 && cp.uprightT >= 1) popOpen(cp, ctx);
  }
  function openUp(cp) {
    // 外れる前に離したら元に戻る
    cp.state = 'tray';
    G.flow.holdInTray(cp, false);
    var off = cp.capOff.clone(), tw = cp.capTwist;
    G.tween(0.2, function (k) { cp.capOff.copy(off).multiplyScalar(1 - k); cp.capTwist = tw * (1 - k); cp.apply(); },
      function () { if (G.audio) G.audio.hit('cover', 0.4); }, G.backOut);
  }
  function openingUpdate(cp, dt) {
    if (cp.uprightT < 1) {
      cp.uprightT = Math.min(1, cp.uprightT + dt / 0.18);
      cp.quat.slerpQuaternions(cp.uprightFrom, cp.upright(), G.easeOut(cp.uprightT));
    }
    var d = cp.openD.clone();
    var L = Math.min(d.length(), 1.0);
    // 抵抗：はじめは少ししか動かない
    var mv = L < 0.5 ? L * 0.25 : 0.125 + (L - 0.5) * 0.6;
    if (L > 1e-4) d.setLength(mv); else d.set(0, 0, 0);
    // カプセルの座標でのずれ
    var inv = cp.quat.clone().invert();
    cp.capOff.copy(d.applyQuaternion(inv));
    cp.capOff.y = Math.min(0.12, mv * 0.25);
    cp.capTwist = mv * 0.9;
    cp.afterMove(dt);
    if (G.audio && L > 0.1) G.audio.ask('scrape', Math.min(0.2, L * 0.2), 1.0);
  }
  function popOpen(cp, ctx) {
    var shell = cp.shell, cap = cp.cap, prize = cp.prize;
    var trayLocal = G.flow.trayLocalOf(cp);
    G.flow.removeFromTray(cp);
    var i = C.list.indexOf(cp); if (i >= 0) C.list.splice(i, 1);
    // ふたを外して指に
    var wp = new V3(), wq = new Q();
    cap.obj.getWorldPosition(wp); cap.obj.getWorldQuaternion(wq);
    cp.obj.remove(cap.obj); C.scene.add(cap.obj);
    cap.obj.position.copy(wp); cap.obj.quaternion.copy(wq);
    cap.state = 'held'; cap.tpos = wp.clone().add(new V3(0, 0.9, 0));
    cap.yaw = new THREE.Euler().setFromQuaternion(wq, 'YXZ').y;
    // 殻は受け皿に残る
    var sp = new V3(), sq = new Q();
    shell.obj.getWorldPosition(sp); shell.obj.getWorldQuaternion(sq);
    cp.obj.remove(shell.obj); C.scene.add(shell.obj);
    shell.obj.position.copy(sp); shell.obj.quaternion.copy(sq);
    shell.yaw = new THREE.Euler().setFromQuaternion(cp.upright(), 'YXZ').y;
    shell.state = 'tray'; shell.trayLocal = trayLocal; shell.capsule = null;
    shell.tilt.x = 0.12; shell.tilt.v = 1.5;
    C.scene.remove(cp.obj);
    if (G.audio) G.audio.hit('pop', 0.9, sp.x / 10);
    if (prize) {
      prize.home = shell; prize.state = 'inShell';
      // まれに：横倒しのこまが回りながら受け皿へ下りる
      if (prize.kind === 'top' && prize.isSideways()) {
        shell.prize = null;
        prize.home = null; prize.state = 'anim';
        var from = prize.obj.position.clone();
        var tl = trayLocal.clone();
        tl.x = G.clamp(tl.x + (tl.x > 0 ? -1.4 : 1.4), -K.TRAY_W / 2 + 0.6, K.TRAY_W / 2 - 0.6);
        tl.z = G.clamp(tl.z + 0.5, -K.TRAY_D / 2 + 0.6, K.TRAY_D / 2 - 0.6);
        var q0 = prize.wq.clone(); var spinA = 0;
        G.tween(0.55, function (k) {
          var to = new V3(G.parts.tray.x + tl.x, K.TRAY_FLOOR + 0.41, K.TRAY_Z + tl.z);
          prize.obj.position.lerpVectors(from, to, k);
          prize.obj.position.y += Math.sin(k * Math.PI) * 0.5;
          spinA += 0.5;
          prize.wq.slerpQuaternions(q0, new Q().setFromAxisAngle(G.UP, spinA), G.easeOut(k));
          prize.obj.quaternion.copy(prize.wq);
          if (G.audio) G.audio.ask('whir', 0.8);
        }, function () {
          prize.state = 'tray'; prize.trayLocal = tl;
          prize.spin = 13; prize.spinA = spinA; prize.prec = 0; prize.settleT = null; prize.spinMove = null;
          if (G.audio) G.audio.hit('wood', 0.6);
          if (G.game) G.game.onEvent('rareTop');
        });
      }
    }
    if (G.game) G.game.onEvent('opened', shell);
    ctx.handoff = capPick(cap);
  }

  // ---------- 殻・ふた・景品の持ち運び ----------
  function shellDown(s, ctx) {
    if (s.state === 'capsule' || s.state === 'anim') return false;
    if (s.state === 'hole') leaveHole(s);
    s.state = 'held'; s.trayLocal = null; s.hole = -1;
    s.tpos = s.obj.position.clone().add(new V3(0, 0.7, 0));
    s.grabOff = new V3();
    var p = deskPoint(ctx.ray, R + 0.7);
    if (p) s.grabOff.set(s.obj.position.x - p.x, 0, s.obj.position.z - p.z).clampLength(0, 0.8);
    if (G.audio) G.audio.hit('shell', 0.3, s.obj.position.x / 12);
    return true;
  }
  function shellMove(s, ctx) {
    if (s.state !== 'held') return;
    var p = deskPoint(ctx.ray, R + 0.7);
    if (p) { s.tpos.set(p.x + s.grabOff.x, R + 0.7, p.z + s.grabOff.z); G.parts.clampDesk(s.tpos, 1); }
  }
  function shellUp(s, ctx) {
    if (s.state !== 'held') return;
    var p = s.tpos.clone();
    var hi = nearestFreeHole(p, 1.5);
    var target, after;
    if (hi >= 0) {
      var h = G.parts.holes[hi]; h.item = s;
      target = new V3(h.pos.x, R, h.pos.z);
      after = function () { s.state = 'hole'; s.hole = hi; if (G.audio) G.audio.hit('card', 0.35); };
    } else if (overTray(p)) {
      var tl = trayLocalOf(p);
      target = new V3(G.parts.tray.x + tl.x, K.TRAY_FLOOR + R, K.TRAY_Z + tl.z);
      after = function () { s.state = 'tray'; s.trayLocal = tl; if (G.audio) G.audio.hit('shell', 0.4); };
    } else {
      G.parts.pushOut(p, 1.0);
      target = new V3(p.x, R, p.z);
      after = function () { s.state = 'desk'; if (G.audio) G.audio.hit('shell', 0.4); s.tilt.v = 1.2; };
    }
    s.state = 'anim';
    var from = s.obj.position.clone();
    G.tween(0.18, function (k) { s.obj.position.lerpVectors(from, target, k); }, after, G.easeOut);
  }
  function capDown(c, ctx) {
    if (c.state !== 'desk') return false;
    c.state = 'held';
    c.tpos = c.obj.position.clone().add(new V3(0, 1.3, 0));
    c.grabOff = new V3();
    var p = deskPoint(ctx.ray, 1.3);
    if (p) c.grabOff.set(c.obj.position.x - p.x, 0, c.obj.position.z - p.z).clampLength(0, 0.8);
    if (G.audio) G.audio.hit('shell', 0.25, c.obj.position.x / 12);
    return true;
  }
  function capMove(c, ctx) {
    if (c.state !== 'held') return;
    var p = deskPoint(ctx.ray, 1.3);
    if (p) { c.tpos.set(p.x + (c.grabOff ? c.grabOff.x : 0), 1.3, p.z + (c.grabOff ? c.grabOff.z : 0)); G.parts.clampDesk(c.tpos, 1); }
    // 近くの殻の上に来たら少し寄せる
    var s = nearestOpenShell(c.tpos, 1.6);
    if (s) { var sc = s.center(); c.tpos.x = G.lerp(c.tpos.x, sc.x, 0.5); c.tpos.z = G.lerp(c.tpos.z, sc.z, 0.5); }
  }
  function nearestOpenShell(p, maxD) {
    var best = null, bd = maxD;
    C.shells.forEach(function (s) {
      if (s.state === 'capsule' || s.state === 'held' || s.state === 'anim') return;
      var c = s.obj.position;
      var d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function capUp(c, ctx) {
    if (c.state !== 'held') return;
    var s = nearestOpenShell(c.tpos, 1.7);
    if (s) { coverShell(c, s); return; }
    var p = c.tpos.clone();
    G.parts.pushOut(p, 1.0);
    c.state = 'anim';
    var from = c.obj.position.clone(), to = new V3(p.x, 0.02, p.z);
    G.tween(0.2, function (k) { c.obj.position.lerpVectors(from, to, k); },
      function () { c.state = 'desk'; if (G.audio) G.audio.hit('shell', 0.35, p.x / 12); }, G.easeOut);
  }
  // ふたをかぶせて閉じる
  function coverShell(c, s) {
    c.state = 'anim';
    var prevState = s.state, hole = s.hole, tl = s.trayLocal ? s.trayLocal.clone() : null;
    s.state = 'anim';
    var from = c.obj.position.clone(), q0 = c.obj.quaternion.clone();
    var sc = s.obj.position.clone();
    var qs = new Q().setFromAxisAngle(G.UP, s.yaw);
    G.tween(0.32, function (k) {
      var above = sc.clone().add(new V3(0, 0.6 * (1 - G.smooth(k * 1.4 - 0.4)), 0));
      c.obj.position.lerpVectors(from, above, Math.min(1, k * 1.6));
      var twist = new Q().setFromAxisAngle(G.UP, (1 - k) * 0.6);
      c.obj.quaternion.slerpQuaternions(q0, qs.clone().multiply(twist), Math.min(1, k * 1.5));
      // 殻の傾きは閉じるとき戻す
      s.obj.quaternion.slerp(qs, 0.3);
    }, function () {
      s.state = prevState;
      var cp = new Capsule(s, c);
      cp.pos.copy(sc); cp.quat.copy(qs);
      if (prevState === 'hole') { cp.state = 'hole'; cp.hole = hole; G.parts.holes[hole].item = cp; }
      else if (prevState === 'tray') { G.flow.toTray(cp, tl, new V3(), 0); }
      else cp.state = 'desk';
      cp.prevQ.copy(cp.quat);
      cp.apply();
      C.scene.add(cp.obj);
      if (G.audio) G.audio.hit('cover', 0.9, sc.x / 10);
      if (G.game) G.game.onEvent('closed', cp);
    }, G.easeInOut);
  }
  function prizeDown(p, ctx) {
    if (p.state === 'anim' || p.state === 'inCapsule') return false;
    // こまは払うと回る（短いタップは「払う」として判定）
    p.downT = G.now(); p.downPx = ctx.px; p.downPy = ctx.py; p.moved = false;
    p.pending = true; p.downRay = ctx.ray.clone();
    return true;
  }
  function prizeStartHold(p, ctx) {
    p.pending = false;
    p.fromTray = !!(p.home && p.home.state === 'tray') || p.state === 'tray';
    if (p.home && p.home.prize === p) p.home.prize = null;
    p.home = null; p.trayLocal = null;
    p.state = 'held';
    p.spin = 0; p.settleT = null;
    p.tpos = p.obj.position.clone().add(new V3(0, 0.9, 0));
    var yaw = p.yawFromQ();
    p.holdQ = new Q().setFromAxisAngle(G.UP, yaw);
    if (p.kind === 'top') p.holdQ = new Q().setFromAxisAngle(new V3(1, 0, 0), 0.25).multiply(p.holdQ);
    p.grabOff = new V3();
    var q = deskPoint(ctx.ray, 1.0);
    if (q) p.grabOff.set(p.obj.position.x - q.x, 0, p.obj.position.z - q.z).clampLength(0, 0.5);
    if (G.audio) G.audio.hit(p.kind === 'eraser' ? 'rubber' : p.kind === 'packet' ? 'paper' : 'wood', 0.3);
  }
  function prizeMove(p, ctx) {
    if (p.pending) {
      if (Math.hypot(ctx.px - p.downPx, ctx.py - p.downPy) > 10) prizeStartHold(p, ctx);
      else return;
    }
    if (p.state !== 'held') return;
    var q = deskPoint(ctx.ray, 1.0);
    if (q) { p.tpos.set(q.x + p.grabOff.x, 1.0, q.z + p.grabOff.z); G.parts.clampDesk(p.tpos, 0.6); }
    var s = emptyShellNear(p.tpos, 1.5);
    if (s) { var sc = s.center(); p.tpos.x = G.lerp(p.tpos.x, sc.x, 0.5); p.tpos.z = G.lerp(p.tpos.z, sc.z, 0.5); }
  }
  function emptyShellNear(pos, maxD) {
    var best = null, bd = maxD;
    C.shells.forEach(function (s) {
      if (s.prize || s.state === 'capsule' || s.state === 'held' || s.state === 'anim') return;
      var c = s.obj.position, d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function prizeUp(p, ctx) {
    if (p.pending) {
      p.pending = false;
      // 払う：こまが机（や受け皿）にあるとき
      if (p.kind === 'top' && (p.state === 'desk' || p.state === 'tray')) {
        var dir = new V3(G.rr(-1, 1), 0, G.rr(-1, 1)).normalize();
        p.flick(dir);
      } else if (p.state === 'desk') {
        p.settleT = 0; p.settleFrom = p.wq.clone(); p.settleFromY = p.obj.position.y + 0.15;
        if (p.kind === 'eraser') { p.settleTilt = 0.2; p.settleAx = new V3(1, 0, 0); p.settleSnd = false; }
        if (p.kind === 'packet') { p.flapS.x = 0.0; }
        if (G.audio) G.audio.hit(p.kind === 'eraser' ? 'rubber' : 'paper', 0.3);
      } else if (p.state === 'inShell' && p.home) {
        p.home.tilt.v += 1.0;
        if (G.audio) G.audio.hit('inner', 0.4);
      }
      return;
    }
    if (p.state !== 'held') return;
    p.fromTray = false;
    var s = emptyShellNear(p.tpos, 1.6);
    if (s) {
      p.state = 'anim';
      var from = p.obj.position.clone(), q0 = p.wq.clone();
      var target = G.snapUpright(p.holdQ.clone());
      if (p.kind === 'top' && G.rand() < 0.3) target = new Q().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2).multiply(target);
      G.tween(0.22, function (k) {
        p.wq.slerpQuaternions(q0, target, k);
        var c = s.center();
        var to = c.clone(); to.y -= p.depth();
        p.obj.position.lerpVectors(from, to, G.easeInOut(k));
        p.obj.quaternion.copy(p.wq);
      }, function () {
        p.state = 'inShell'; p.home = s; s.prize = p;
        s.tilt.v += p.kind === 'eraser' ? 1.6 : 0.7;
        s.tiltAx.set(G.rr(-1, 1), 0, G.rr(-1, 1)).normalize();
        if (G.audio) { G.audio.hit('inner', 0.7); G.audio.hit('shell', 0.3, 0, 0.03); }
        if (G.game) G.game.onEvent('prizeIn', p);
      });
      return;
    }
    var pt = p.tpos.clone();
    G.parts.pushOut(pt, 0.7);
    p.wq.copy(p.holdQ);
    if (p.kind === 'top') { p.wq.copy(new Q().setFromAxisAngle(G.UP, p.yawFromQ())); }
    p.toDesk(pt, p.obj.position.y);
  }

  // ---------- 触れる物の登録 ----------
  function meshesOf(obj) { var a = []; obj.traverse(function (o) { if (o.isMesh) a.push(o); }); return a; }
  function capsulePick(cp) {
    return {
      kind: 'capsule', ref: cp, priority: 3,
      meshes: function () { return meshesOf(cp.obj); },
      center: function () { return cp.pos; }, radius: R,
      enabled: function () { return C.list.indexOf(cp) >= 0 && (cp.state === 'desk' || cp.state === 'hole' || cp.state === 'tray'); },
      down: function (ctx) { return capsuleDown(cp, ctx); },
      move: function (ctx) { capsuleMove(cp, ctx); },
      up: function (ctx) { capsuleUp(cp, ctx); }
    };
  }
  function capPick(c) {
    return {
      kind: 'cap', ref: c, priority: 2,
      meshes: function () { return meshesOf(c.obj); },
      center: function () { return c.center(); }, radius: R,
      enabled: function () { return c.state === 'desk'; },
      down: function (ctx) { return capDown(c, ctx); },
      move: function (ctx) { capMove(c, ctx); },
      up: function (ctx) { capUp(c, ctx); }
    };
  }
  C.capPick = capPick;
  C.capsulePick = capsulePick;
  function registerPicks() {
    // カプセルは動的なので、ひとつの入口から探す
    G.pickables.push({
      kind: 'capsules', dynamic: function () { return C.list.map(capsulePick); }
    });
    C.caps.forEach(function (c) { G.pickables.push(capPick(c)); });
    C.shells.forEach(function (s) {
      G.pickables.push({
        kind: 'shell', ref: s, priority: 2,
        meshes: function () { return meshesOf(s.obj); },
        center: function () { return s.obj.position; }, radius: R,
        enabled: function () { return s.state === 'desk' || s.state === 'hole' || s.state === 'tray'; },
        down: function (ctx) { return shellDown(s, ctx); },
        move: function (ctx) { shellMove(s, ctx); },
        up: function (ctx) { shellUp(s, ctx); }
      });
    });
    C.prizes.forEach(function (p) {
      G.pickables.push({
        kind: 'prize', ref: p, priority: 4,
        meshes: function () { return meshesOf(p.obj); },
        center: function () { return p.obj.position; }, radius: 0.6,
        enabled: function () { return p.state === 'desk' || p.state === 'inShell' || p.state === 'tray'; },
        down: function (ctx) { return prizeDown(p, ctx); },
        move: function (ctx) { prizeMove(p, ctx); },
        up: function (ctx) { prizeUp(p, ctx); }
      });
    });
  }
})();
