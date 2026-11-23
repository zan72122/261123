// parts-kinds.js — まっすぐな坂・曲がり角・螺旋・羽根車の樋・出発台
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C, G = KK.geom, P = KK.parts, Part = P.Part;
  var STOW_H = 0.28 + 0.42 + C.BASE_T - 0.1; // 寝かせたときの溝の床の高さ
  var KNOB_Q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(-0.7071, 0, 0.7071));

  function inherit(Ctor) {
    Ctor.prototype = Object.create(Part.prototype);
    Ctor.prototype.constructor = Ctor;
  }
  function shadowAll(o) {
    o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }
  function socket(part) {
    var M = KK.world.mats;
    var g = new T.Group();
    var col = new T.Mesh(new T.CylinderGeometry(0.62, 0.62, 0.42, 20, 1, true), part.mat);
    col.position.y = -0.21; col.castShadow = true;
    var hole = new T.Mesh(new T.CircleGeometry(0.62, 20), new T.MeshStandardMaterial({ color: 0x2c1c10, roughness: 1 }));
    hole.rotation.x = Math.PI / 2; hole.position.y = -0.4;
    var rim = new T.Mesh(new T.TorusGeometry(0.5, 0.11, 6, 20), M.endGrain);
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.41;
    g.add(col); g.add(hole); g.add(rim);
    part.group.add(g);
    return g;
  }

  // ────────── まっすぐな坂 ──────────
  function Straight(o) {
    Part.call(this, 'straight');
    var S = (this.S = C.SPAN);
    this.mat.map = (o && o.alt) ? KK.tex.wood2 : KK.tex.wood;
    this.mat.bumpMap = (o && o.alt) ? KK.tex.wood2Bump : KK.tex.woodBump;
    var d0 = this.addDof(4, C.H_MIN, C.H_MAX), d1 = this.addDof(4, C.H_MIN, C.H_MAX);
    this.addPort(-S / 2, 0, Math.PI, d0, 0, 0);
    this.addPort(S / 2, 0, 0, d1, 0, 1);
    var geo = G.sweep([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], G.troughProfile(), { uScale: 1, vScale: 9 });
    this.trough = new T.Mesh(geo, this.mat);
    this.trough.castShadow = this.trough.receiveShadow = true;
    this.group.add(this.trough);
    P.tag(this, this.trough, 'body');
    this.postX = S / 2 - 1.6;
    this.posts = [P.makePost(this), P.makePost(this)];
    this.sockets = [socket(this), socket(this)];
    this.knobs = [P.makeKnob(this), P.makeKnob(this)];
    this.kprox = [];
    for (var i = 0; i < 2; i++) {
      this.knobs[i].rotation.x = Math.PI / 2;
      this.group.add(this.knobs[i]);
      var pr = P.proxy(this, 2.0, 'knob' + i);
      this.group.add(pr); this.kprox.push(pr);
    }
    this.legs = 1; this.legsD = 1;
    this.pressEnd = -1;
  }
  inherit(Straight);
  Straight.prototype.localPath = function () {
    var S = this.S;
    return [{ x: -S / 2, y: this.dofs[0].hd, z: 0 }, { x: S / 2, y: this.dofs[1].hd, z: 0 }];
  };
  Straight.prototype.floorAt = function (lx) {
    var t = (lx + this.S / 2) / this.S;
    return this.dofs[0].hd + (this.dofs[1].hd - this.dofs[0].hd) * t;
  };
  Straight.prototype.updateVisual = function (dt) {
    var S = this.S, h0 = this.dofs[0].hd, h1 = this.dofs[1].hd;
    var dy = h1 - h0, len = Math.hypot(S, dy), ang = Math.atan2(dy, S);
    this.trough.position.set(-S / 2, h0, 0);
    this.trough.rotation.z = ang;
    this.trough.scale.set(len, 1, 1);
    this.legsD = KK.damp(this.legsD, this.legs, 7, dt);
    var cb = C.BASE_T / Math.cos(ang);
    for (var i = 0; i < 2; i++) {
      var x = i === 0 ? -this.postX : this.postX;
      var fl = this.floorAt(x);
      var top = fl - cb - 0.02;
      P.setPost(this.posts[i], x, 0, top, this.legsD, this.wob.x * 0.02 * (i ? 1 : -1));
      this.posts[i].g.visible = this.legsD > 0.03;
      this.posts[i].cradle.scale.set(1, KK.clamp(this.legsD * 1.5, 0.01, 1), 1);
      this.sockets[i].position.set(x, fl - cb, 0);
      this.sockets[i].rotation.z = ang;
      var k = this.knobs[i];
      k.position.set(x + (i ? 0.55 : -0.55), fl - cb * 0.55, this.outer + 0.02);
      this.kprox[i].position.set(x + (i ? 0.6 : -0.6), fl, this.outer * 0.5);
    }
  };

  // ────────── 曲がり角 ──────────
  function Corner() {
    Part.call(this, 'corner');
    var rc = (this.rc = 5);
    var d = this.addDof(4, C.H_MIN, 16);
    this.addPort(0, -rc, Math.PI, d, 0, 0);
    this.addPort(rc, 0, -Math.PI / 2, d, 0, 1);
    this.arc = [];
    var N = 18;
    for (var i = 0; i <= N; i++) {
      var th = (i / N) * Math.PI / 2;
      this.arc.push({ x: rc * Math.sin(th), y: 0, z: -rc * Math.cos(th) });
    }
    this.wallH = 1.95;
    var geo = G.sweep(this.arc, G.troughProfile({ hR: 1.95, hL: 1.15 }), { uScale: 16, vScale: 9 });
    this.body = new T.Mesh(geo, this.mat);
    this.body.castShadow = this.body.receiveShadow = true;
    this.group.add(this.body);
    P.tag(this, this.body, 'body');
    this.post = P.makePost(this);
    this.socket = socket(this);
    this.knob = P.makeKnob(this);
    this.group.add(this.knob);
    this.kprox = P.proxy(this, 2.0, 'knob');
    this.group.add(this.kprox);
    this.postP = { x: rc * Math.sin(Math.PI / 4), z: -rc * Math.cos(Math.PI / 4) };
    this.legs = 1; this.legsD = 1;
  }
  inherit(Corner);
  Corner.prototype.localPath = function () {
    var h = this.dofs[0].hd;
    return this.arc.map(function (p) { return { x: p.x, y: h, z: p.z }; });
  };
  Corner.prototype.updateVisual = function (dt) {
    var h = this.dofs[0].hd;
    this.body.position.y = h;
    this.legsD = KK.damp(this.legsD, this.legs, 7, dt);
    var pp = this.postP, top = h - C.BASE_T - 0.02;
    P.setPost(this.post, pp.x, pp.z, top, this.legsD, this.wob.x * 0.02);
    this.post.g.rotation.y = -Math.PI / 4;
    this.post.g.visible = this.legsD > 0.03;
    this.socket.position.set(pp.x, top + 0.02, pp.z);
    // つまみは柱の内側（角の中心向き）
    var kx = pp.x * 0.86, kz = pp.z * 0.86;
    this.knob.position.set(kx, top - 0.32, kz);
    this.knob.quaternion.copy(KNOB_Q);
    this.kprox.position.set(pp.x * 0.7, top, pp.z * 0.7);
  };

  // ────────── 羽根車つきの短い樋 ──────────
  function Chute() {
    Part.call(this, 'chute');
    var L = (this.L = 12), sl = (this.sl = 0.4);
    var d = this.addDof(4, 2.5, 15);
    this.addPort(-L / 2, 0, Math.PI, d, sl, 0);
    this.addPort(L / 2, 0, 0, d, -sl, 1);
    var M = KK.world.mats;
    var geo = G.sweep([{ x: -L / 2, y: sl, z: 0 }, { x: L / 2, y: -sl, z: 0 }], G.troughProfile(), { uScale: 14, vScale: 9 });
    this.body = new T.Mesh(geo, this.mat);
    this.body.castShadow = this.body.receiveShadow = true;
    this.group.add(this.body);
    P.tag(this, this.body, 'body');
    // 軸受け
    this.axleY = 3.0; this.rHub = 0.45; this.rTip = 1.55; this.paddleT = 0.14;
    var up = (this.uprights = new T.Group());
    var zs = this.inner + C.WALL_T / 2;
    for (var s = -1; s <= 1; s += 2) {
      var b = new T.Mesh(G.roundBox(1.3, this.axleY + 0.9 - C.WALL_H, 0.32, 0.12), this.mat);
      b.position.set(0, C.WALL_H, s * zs);
      up.add(b);
      var cap = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 0.2, 14), M.endGrain);
      cap.rotation.x = Math.PI / 2; cap.position.set(0, this.axleY, s * (zs + 0.24));
      up.add(cap);
    }
    var axle = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, zs * 2 + 0.6, 10), M.metal);
    axle.rotation.x = Math.PI / 2; axle.position.y = this.axleY;
    up.add(axle);
    shadowAll(up);
    this.group.add(up);
    // 羽根車
    var wg = (this.wheelG = new T.Group());
    var hub = new T.Mesh(new T.CylinderGeometry(this.rHub, this.rHub, this.inner * 2 - 0.4, 18), M.wood2);
    hub.rotation.x = Math.PI / 2;
    wg.add(hub);
    this.paddleMat = this.mat;
    this.darkMat = M.walnut.clone();
    this.darkMat.emissive = new T.Color(0xffe2b0);
    this.darkMat.emissiveIntensity = 0;
    this.paddles = [];
    var plen = this.rTip - this.rHub + 0.1;
    var pw = this.inner * 2 - 0.42;
    this.darkIndex = Math.floor(Math.random() * 6);
    for (var i = 0; i < 6; i++) {
      var pg = new T.Group();
      pg.rotation.z = i * Math.PI / 3;
      var pm = new T.Mesh(G.roundBox(this.paddleT, plen, pw, 0.05), i === this.darkIndex ? this.darkMat : this.mat);
      pm.position.y = -this.rHub + 0.05 - plen;
      pg.add(pm);
      wg.add(pg);
      this.paddles.push(pm);
    }
    shadowAll(wg);
    wg.position.y = this.axleY;
    this.group.add(wg);
    P.tag(this, hub, 'wheel');
    for (i = 0; i < 6; i++) P.tag(this, this.paddles[i], 'wheel');
    // 支え
    this.post = P.makePost(this);
    this.socket = socket(this);
    this.knob = P.makeKnob(this);
    this.knob.rotation.x = Math.PI / 2;
    this.group.add(this.knob);
    this.kprox = P.proxy(this, 2.0, 'knob');
    this.group.add(this.kprox);
    this.postX = -3.4;
    this.wheel = { phi: KK.rand(0, Math.PI * 2), omega: 0, lastTick: 0, coast: null, spun: 0 };
    this.legs = 1; this.legsD = 1;
  }
  inherit(Chute);
  Chute.prototype.localPath = function () {
    var h = this.dofs[0].hd, L = this.L, sl = this.sl;
    return [{ x: -L / 2, y: h + sl, z: 0 }, { x: L / 2, y: h - sl, z: 0 }];
  };
  Chute.prototype.updateVisual = function (dt) {
    var h = this.dofs[0].hd;
    this.body.position.y = h;
    this.uprights.position.y = h;
    this.wheelG.position.y = h + this.axleY;
    this.wheelG.rotation.z = KK.wheel.visualPhi(this, dt);
    this.legsD = KK.damp(this.legsD, this.legs, 7, dt);
    var x = this.postX, fl = h - this.sl * (x / (this.L / 2)), top = fl - C.BASE_T - 0.02;
    P.setPost(this.post, x, 0, top, this.legsD, this.wob.x * 0.02);
    this.post.g.visible = this.legsD > 0.03;
    this.socket.position.set(x, top + 0.02, 0);
    this.knob.position.set(x - 0.55, top + 0.35 * 0.0 - 0.25, this.outer + 0.02);
    this.kprox.position.set(x - 0.6, fl, this.outer * 0.5);
  };

  // ────────── 螺旋 ──────────
  function Spiral() {
    Part.call(this, 'spiral');
    var rc = (this.rc = 4.2), lead = (this.lead = 2.0);
    this.yTop = 10; this.yBot = 3;
    var d = this.addDof(0, 0, 0, true);
    this.addPort(-lead, rc, Math.PI, d, this.yTop, 0);
    this.addPort(lead, rc, 0, d, this.yBot, 1);
    this.surface = 'spiral';
    this.wallH = 1.75;
    // 中心線
    var pts = [], N = 72, helixLen = 2 * Math.PI * rc, total = lead * 2 + helixLen;
    var drop = this.yTop - this.yBot;
    var self = this;
    function yAt(s) { return self.yTop - drop * (s / total); }
    pts.push({ x: -lead, y: yAt(0), z: rc });
    for (var i = 0; i <= N; i++) {
      var ph = -Math.PI / 2 + (i / N) * Math.PI * 2;
      var s = lead + (i / N) * helixLen;
      pts.push({ x: rc * Math.cos(ph), y: yAt(s), z: -rc * Math.sin(ph) });
    }
    pts.push({ x: lead, y: yAt(total), z: rc });
    // 継ぎ目（45° ごと）
    for (i = 0; i <= 8; i++) this.seams.push(lead + helixLen * (i / 8));
    this.lp = pts;
    var geo = G.sweep(pts, G.troughProfile({ hL: 1.75, hR: 1.15 }), { uScale: 12, vScale: 9 });
    this.body = new T.Mesh(geo, this.mat);
    this.body.castShadow = this.body.receiveShadow = true;
    this.group.add(this.body);
    P.tag(this, this.body, 'body');
    // 継ぎ目の細い線（木口）
    var M = KK.world.mats;
    for (i = 1; i < 8; i++) {
      var ph2 = -Math.PI / 2 + (i / 8) * Math.PI * 2;
      var y2 = yAt(lead + helixLen * (i / 8));
      var seam = new T.Mesh(new T.BoxGeometry(0.05, C.BASE_T + 0.2, (this.inner + C.WALL_T) * 2 + 0.02), M.endGrain);
      seam.position.set(rc * Math.cos(ph2), y2 - C.BASE_T / 2 + 0.05, -rc * Math.sin(ph2));
      seam.rotation.y = ph2;
      this.group.add(seam);
    }
    // 柱
    var colR = (this.colR = 1.7), colH = this.yTop + 2.6;
    var col = new T.Mesh(new T.CylinderGeometry(colR, colR * 1.04, colH, 32), KK.world.mats.column2);
    col.position.y = colH / 2 + 0.5;
    P.tag(this, col, 'body');
    this.group.add(col);
    var capm = new T.Mesh(new T.SphereGeometry(colR * 1.02, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mat);
    capm.position.y = colH + 0.5; this.group.add(capm);
    var base = new T.Mesh(G.roundBox(6.4, 0.6, 6.4, 1.8), KK.world.mats.block);
    this.group.add(base);
    P.tag(this, base, 'body');
    var pad = new T.Mesh(new T.CylinderGeometry(2.8, 2.8, 0.1, 24), M.pad);
    pad.position.y = 0.03; this.group.add(pad);
    // 腕（柱と溝をつなぐ）
    for (i = 0; i < 5; i++) {
      var ph3 = -Math.PI / 2 + (i / 4) * Math.PI * 2 - 0.0001;
      var y3 = yAt(lead + helixLen * (i / 4)) - C.BASE_T - 0.25;
      var arm = new T.Mesh(G.roundBox(rc - colR - 0.6, 0.5, 0.7, 0.15), this.mat);
      var rr = (colR + rc - this.inner - C.WALL_T) / 2 + 0.1;
      arm.position.set(rr * Math.cos(ph3), y3, -rr * Math.sin(ph3));
      arm.rotation.y = ph3;
      this.group.add(arm);
    }
    shadowAll(this.group);
    this.colliders.push({ lx: 0, lz: 0, r: colR, top: colH + 0.5 });
  }
  inherit(Spiral);
  Spiral.prototype.localPath = function () { return this.lp; };
  Spiral.prototype.updateVisual = function () {};

  // ────────── 出発台（奥の支柱に載る） ──────────
  function Start() {
    Part.call(this, 'start');
    var pl = KK.world.L.pillar;
    this.pose.x = this.disp.x = pl.x; this.pose.z = this.disp.z = pl.z;
    this.x0 = 1.35; this.x1 = 8.3; this.back = 0.45;
    var d = this.addDof(12, 6, pl.h - 2);
    this.addPort(this.x1, 0, 0, d, 0, 1);
    this.closedStart = true;
    var geo = G.sweep([{ x: this.x0, y: this.back, z: 0 }, { x: this.x1, y: 0, z: 0 }], G.troughProfile(), { uScale: 14, vScale: 9 });
    this.body = new T.Mesh(geo, this.mat);
    this.body.castShadow = this.body.receiveShadow = true;
    this.group.add(this.body);
    P.tag(this, this.body, 'knob');
    var wall = new T.Mesh(G.roundBox(0.55, C.WALL_H + C.BASE_T + 0.1, this.outer * 2, 0.18), this.mat);
    wall.castShadow = true;
    this.wall = wall; this.group.add(wall);
    P.tag(this, wall, 'knob');
    // 支柱を抱える輪と腕
    var M = KK.world.mats;
    var ring = new T.Mesh(new T.CylinderGeometry(pl.r + 0.55, pl.r + 0.55, 1.5, 28, 1, true), this.mat);
    var ringIn = new T.Mesh(new T.CylinderGeometry(pl.r + 0.05, pl.r + 0.05, 1.5, 28, 1, true), M.endGrain);
    ringIn.material = M.endGrain;
    var ringTop = new T.Mesh(new T.RingGeometry(pl.r + 0.05, pl.r + 0.55, 28), this.mat);
    ringTop.rotation.x = -Math.PI / 2; ringTop.position.y = 0.75;
    var ringBot = ringTop.clone(); ringBot.rotation.x = Math.PI / 2; ringBot.position.y = -0.75;
    var rg = (this.ringG = new T.Group());
    rg.add(ring); rg.add(ringIn); rg.add(ringTop); rg.add(ringBot);
    var arm = new T.Mesh(G.roundBox(this.x0 + 3.2 - pl.r, 0.8, 1.4, 0.25), this.mat);
    arm.position.set((pl.r + this.x0 + 3.2) / 2 + 0.1, 0.2, 0);
    rg.add(arm);
    shadowAll(rg);
    this.group.add(rg);
    P.tag(this, ring, 'knob'); P.tag(this, arm, 'knob');
    this.knob = P.makeKnob(this);
    this.knob.rotation.x = Math.PI / 2;
    this.group.add(this.knob);
    this.kprox = P.proxy(this, 2.2, 'knob');
    this.group.add(this.kprox);
    this.legs = 1;
  }
  inherit(Start);
  Start.prototype.localPath = function () {
    var h = this.dofs[0].hd;
    return [{ x: this.x0 + 0.3, y: h + this.back * (1 - 0.3 / (this.x1 - this.x0)), z: 0 }, { x: this.x1, y: h, z: 0 }];
  };
  Start.prototype.updateVisual = function () {
    var h = this.dofs[0].hd;
    this.body.position.y = h;
    this.wall.position.set(this.x0 - 0.05, h + this.back - C.BASE_T - 0.02, 0);
    this.ringG.position.y = h - 1.25;
    this.ringG.rotation.y = this.wob.x * 0.01;
    this.knob.position.set(0, h - 1.25, KK.world.L.pillar.r + 0.55);
    this.kprox.position.set(0.5, h - 0.8, 1.2);
  };

  P.Straight = Straight; P.Corner = Corner; P.Chute = Chute; P.Spiral = Spiral; P.Start = Start;
  P.STOW_H = STOW_H;
})();
