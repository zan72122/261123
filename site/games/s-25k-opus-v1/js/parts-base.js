// parts-base.js — 部品の共通部分（姿勢・高さ・入口出口・中心線・継ぎ板）
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;

  var P = (KK.parts = { list: [], byKind: {} });
  var nextId = 1;

  function Part(kind) {
    this.kind = kind;
    this.id = nextId++;
    this.group = new T.Group();
    this.pose = { x: 0, z: 0, yaw: 0 };
    this.disp = { x: 0, z: 0, yaw: 0 };
    this.lift = 0; this.liftD = 0;
    this.dofs = [];
    this.ports = [];
    this.state = 'active';      // 'stowed' | 'active' | 'carry'
    this.pick = [];             // レイ判定の対象
    this.glow = 0; this.glowT = 0;
    this.hop = new KK.Spring(0, 260, 16);   // 置いたときの小さなはね返り
    this.wob = new KK.Spring(0, 320, 7);    // 支柱のたわみ
    this.wp = { pts: [], cum: [], turn: [], len: 0 };
    this.seams = [];            // 中心線上の継ぎ目（s）
    this.surface = 'wood';
    this.inner = C.INNER; this.outer = C.INNER + C.WALL_T;
    this.wallH = C.WALL_H; this.baseT = C.BASE_T;
    this.colliders = [];        // 円柱 {lx,lz,r,top}
    this.mat = KK.world.mats.wood.clone();
    this.mat.emissive = new T.Color(0xffb35c);
    this.mat.emissiveIntensity = 0;
    this.extraGlowMats = [];
    this.lastMove = 0;
    this.moving = 0;            // 表示上の動きの速さ
    KK.world.scene.add(this.group);
  }
  P.Part = Part;

  // DOF（高さの自由度）
  Part.prototype.addDof = function (h, min, max, fixed) {
    var d = { part: this, i: this.dofs.length, h: h, hd: h, min: min, max: max, fixed: !!fixed, free: false };
    this.dofs.push(d);
    return d;
  };
  // 入口・出口。la は局所の向き角、end は中心線のどちらの端か
  Part.prototype.addPort = function (lx, lz, la, dof, off, end) {
    var p = {
      part: this, i: this.ports.length, lx: lx, lz: lz, la: la, dof: dof, off: off || 0, end: end,
      joint: null, wx: 0, wy: 0, wz: 0, wa: 0, flap: null, near: null, nearT: 0
    };
    this.ports.push(p);
    this.makeFlap(p);
    return p;
  };

  Part.prototype.portHeight = function (p, useTarget) {
    return (useTarget ? p.dof.h : p.dof.hd) + p.off;
  };
  // 与えた姿勢での入口の世界座標
  Part.prototype.portAt = function (p, pose, out) {
    out = out || {};
    var r = KK.rotXZ(p.lx, p.lz, pose.yaw, out);
    out.x = pose.x + r.x; out.z = pose.z + r.z;
    out.a = p.la + pose.yaw;
    return out;
  };
  Part.prototype.toWorld = function (lx, ly, lz, out) {
    out = out || new T.Vector3();
    var c = Math.cos(this.disp.yaw), s = Math.sin(this.disp.yaw);
    out.set(this.disp.x + lx * c + lz * s, ly + this.liftD + this.hop.x, this.disp.z - lx * s + lz * c);
    return out;
  };
  Part.prototype.toLocalXZ = function (wx, wz, out) {
    return KK.invRotXZ(wx - this.disp.x, wz - this.disp.z, this.disp.yaw, out);
  };

  // ── 継ぎ板 ──
  Part.prototype.makeFlap = function (p) {
    var pivot = new T.Group();
    var w = this.inner * 2 - 0.3;
    var geo = KK.geom.roundBox(1.7, 0.13, w, 0.08);
    var m = new T.Mesh(geo, this.mat);
    m.position.set(0.85, 0.005, 0);
    m.castShadow = true; m.receiveShadow = true;
    pivot.add(m);
    this.group.add(pivot);
    p.flap = { pivot: pivot, mesh: m, ang: new KK.Spring(-1.2, 200, 13), show: 1, owner: false };
  };

  Part.prototype.updateFlaps = function (dt, t) {
    for (var i = 0; i < this.ports.length; i++) {
      var p = this.ports[i], f = p.flap;
      var h = this.portHeight(p, false);
      f.pivot.position.set(p.lx, h, p.lz);
      f.pivot.rotation.y = p.la;
      var target = -1.25, show = 1;
      if (p.joint) {
        if (p.joint.owner === p) {
          target = 0;
          // 相手と高さが違うあいだは傾けて触れさせる
          var o = p.joint.other(p);
          var dh = o.part.portHeight(o, false) + o.part.liftD - (h + this.liftD);
          target = KK.clamp(Math.atan2(dh, 1.6), -0.6, 0.6);
          // 引き抜き中は浮く
          if (this.pullOut) target += this.pullOut * 0.5;
        } else { target = -1.45; show = 0; }
      } else if (p.near) {
        // 相手の縁に触れて揺れる
        target = 0.12 + Math.sin(t * 34 + this.id) * 0.1 * p.nearT;
      }
      if (this.state === 'stowed') show = 0;
      f.ang.target = target;
      f.ang.step(dt);
      f.show = KK.damp(f.show, show, 12, dt);
      f.pivot.rotation.z = f.ang.x;
      f.mesh.visible = f.show > 0.05;
      f.mesh.scale.set(1, 1, 0.3 + f.show * 0.7);
    }
  };

  // ── 中心線 ──
  // localPath() は [{x,y,z}] を返す（y は絶対高さ）
  Part.prototype.updatePath = function () {
    var lp = this.localPath();
    var wp = this.wp, n = lp.length;
    while (wp.pts.length < n) wp.pts.push(new T.Vector3());
    wp.pts.length = n;
    for (var i = 0; i < n; i++) this.toWorld(lp[i].x, lp[i].y, lp[i].z, wp.pts[i]);
    wp.cum[0] = 0;
    for (i = 1; i < n; i++) wp.cum[i] = wp.cum[i - 1] + wp.pts[i].distanceTo(wp.pts[i - 1]);
    wp.cum.length = n;
    wp.len = wp.cum[n - 1];
    // 水平の曲がり（符号付き曲率、各点）
    wp.turn.length = n;
    for (i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) { wp.turn[i] = 0; continue; }
      var a = wp.pts[i - 1], b = wp.pts[i], c = wp.pts[i + 1];
      var a1 = Math.atan2(-(b.z - a.z), b.x - a.x), a2 = Math.atan2(-(c.z - b.z), c.x - b.x);
      var dl = (Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z)) / 2;
      wp.turn[i] = KK.wrapAngle(a2 - a1) / Math.max(dl, 0.01);
    }
    if (n > 2) { wp.turn[0] = wp.turn[1]; wp.turn[n - 1] = wp.turn[n - 2]; }
    // 入口の世界座標
    for (i = 0; i < this.ports.length; i++) {
      var p = this.ports[i];
      var q = p.end === 0 ? wp.pts[0] : wp.pts[n - 1];
      p.wx = q.x; p.wy = q.y; p.wz = q.z;
      p.wa = p.la + this.disp.yaw;
    }
  };

  // s での位置・接線・曲率
  Part.prototype.seg = function (s) {
    var wp = this.wp, n = wp.pts.length;
    if (s <= 0) return 0;
    if (s >= wp.len) return n - 2;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (wp.cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  };
  Part.prototype.sample = function (s, out) {
    var wp = this.wp, i = this.seg(s);
    var a = wp.pts[i], b = wp.pts[i + 1];
    var L = wp.cum[i + 1] - wp.cum[i];
    var t = L > 1e-6 ? KK.clamp((s - wp.cum[i]) / L, 0, 1) : 0;
    out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
    var inv = L > 1e-6 ? 1 / L : 0;
    out.tx = (b.x - a.x) * inv; out.ty = (b.y - a.y) * inv; out.tz = (b.z - a.z) * inv;
    out.k = wp.turn[i] + (wp.turn[i + 1] - wp.turn[i]) * t;
    return out;
  };

  // xz で最も近い中心線上の点（ball の着地判定用）
  Part.prototype.nearest = function (x, z, out) {
    var wp = this.wp, best = 1e9;
    for (var i = 0; i < wp.pts.length - 1; i++) {
      var a = wp.pts[i], b = wp.pts[i + 1];
      var t = KK.segT(a.x, a.z, b.x, b.z, x, z);
      var px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      var d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        out.d = d; out.s = wp.cum[i] + (wp.cum[i + 1] - wp.cum[i]) * t;
        out.y = a.y + (b.y - a.y) * t; out.x = px; out.z = pz;
        var tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
        // 横（S = Y×T = (tz, −tx)）方向の符号付きずれ
        out.lat = ((x - px) * (tz / l) + (z - pz) * (-tx / l));
      }
    }
    return best;
  };

  // ── 毎フレーム ──
  Part.prototype.baseUpdate = function (dt, t) {
    var lam = this.state === 'carry' ? 18 : 11;
    var ox = this.disp.x, oz = this.disp.z, oy = this.disp.yaw;
    this.disp.x = KK.damp(this.disp.x, this.pose.x, lam, dt);
    this.disp.z = KK.damp(this.disp.z, this.pose.z, lam, dt);
    this.disp.yaw = KK.dampAngle(this.disp.yaw, this.pose.yaw, lam, dt);
    this.moving = (Math.hypot(this.disp.x - ox, this.disp.z - oz) + Math.abs(this.disp.yaw - oy) * 5) / Math.max(dt, 1e-4);
    this.liftD = KK.damp(this.liftD, this.lift, 10, dt);
    for (var i = 0; i < this.dofs.length; i++) {
      var d = this.dofs[i];
      d.hd = KK.damp(d.hd, d.h, d.fast ? 16 : 9, dt);
    }
    this.hop.step(dt); this.wob.step(dt);
    // 置いたときに足のフェルトが沈んで戻る
    this.padSq = KK.damp(this.padSq || 0, 0, 3.5, dt);
    var pl = this.posts || (this.post ? [this.post] : null);
    if (pl) for (var pi = 0; pi < pl.length; pi++) pl[pi].padS = 1 - 0.6 * this.padSq;
    this.group.position.set(this.disp.x, this.liftD + this.hop.x, this.disp.z);
    this.group.rotation.y = this.disp.yaw;
    // 光らせる・小さく弾ませる
    this.glow = KK.damp(this.glow, this.glowT, 4, dt);
    var g = this.glow * (0.55 + 0.45 * Math.sin(t * 3.2));
    this.mat.emissiveIntensity = g * 0.32;
    for (i = 0; i < this.extraGlowMats.length; i++) this.extraGlowMats[i].emissiveIntensity = g * 0.32;
  };

  // 置いたときの手触り（フェルトが沈み、支柱がたわみ、木の端が一度はね返る）
  Part.prototype.settle = function (strength) {
    var s = strength == null ? 1 : strength;
    this.hop.x = Math.min(this.hop.x, 0) ; this.hop.v = 9 * s;
    this.wob.v += 5 * s;
    this.padSq = Math.min(1, (this.padSq || 0) + s);
    if (this.onSettle) this.onSettle(s);
  };

  P.add = function (part) {
    P.list.push(part);
    (P.byKind[part.kind] = P.byKind[part.kind] || []).push(part);
    return part;
  };
  P.active = function () {
    return P.list.filter(function (p) { return p.state !== 'stowed'; });
  };
  P.update = function (dt, t) {
    for (var i = 0; i < P.list.length; i++) {
      var p = P.list[i];
      p.baseUpdate(dt, t);
      p.updateVisual(dt, t);
      p.updatePath();
      p.updateFlaps(dt, t);
    }
  };

  // 共通の取っ手と柱
  P.makeKnob = function (part, mat) {
    var k = new T.Mesh(KK.geom.knob(0.62, 0.7), mat || part.mat);
    k.castShadow = true;
    return k;
  };
  P.proxy = function (part, r, zone) {
    var m = new T.Mesh(new T.SphereGeometry(r, 8, 6), new T.MeshBasicMaterial());
    m.visible = false;
    m.userData = { part: part, zone: zone };
    part.pick.push(m);
    return m;
  };
  P.tag = function (part, mesh, zone) {
    mesh.userData = { part: part, zone: zone };
    part.pick.push(mesh);
    return mesh;
  };

  // 伸び縮みする支え（外筒は板に、内柱がせり出す）
  P.makePost = function (part) {
    var M = KK.world.mats;
    var g = new T.Group();
    var outer = new T.Mesh(new T.CylinderGeometry(0.56, 0.62, 1.9, 18), part.mat);
    outer.position.y = 0.95 + 0.12;
    outer.castShadow = outer.receiveShadow = true;
    var ring = new T.Mesh(new T.TorusGeometry(0.56, 0.08, 6, 18), M.endGrain);
    ring.rotation.x = Math.PI / 2; ring.position.y = 2.02;
    var pad = new T.Mesh(new T.CylinderGeometry(0.82, 0.82, 0.12, 18), M.pad);
    pad.position.y = 0.06;
    var inner = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 1, 14), M.wood2);
    inner.castShadow = true;
    var cradle = new T.Mesh(KK.geom.roundBox(1.5, 0.42, part.outer * 2 + 0.2, 0.16), part.mat);
    cradle.castShadow = cradle.receiveShadow = true;
    g.add(outer); g.add(ring); g.add(pad); g.add(inner); g.add(cradle);
    part.group.add(g);
    return { g: g, outer: outer, inner: inner, cradle: cradle, pad: pad, ring: ring, padS: 1 };
  };
  // top: 受けの上面（溝の底板の下）。legs: 0..1（0 で畳まれる）
  P.setPost = function (post, x, z, top, legs, wob) {
    post.g.position.set(x, 0, z);
    post.g.rotation.x = wob || 0;
    var crB = top - 0.42;                 // 受けの下面
    post.cradle.position.set(0, crB, 0);
    var fullBottom = 1.72;                // 伸び切ったときの内柱の下端（外筒の中）
    var ib = crB - Math.max(0, crB - fullBottom) * legs;
    var len = Math.max(0.05, crB - ib);
    post.inner.scale.y = len;
    post.inner.position.y = ib + len / 2;
    // 外筒は内柱の下にぶら下がり、伸び切ると板に立つ
    var s = 0.35 + 0.65 * legs;
    post.outer.scale.set(1, s, 1);
    var tubeTop = ib + 0.3;
    post.outer.position.y = tubeTop - 0.95 * s;
    post.ring.position.y = tubeTop;
    post.outer.visible = post.ring.visible = legs > 0.04;
    post.pad.visible = legs > 0.85;
    post.pad.scale.set(1 + (1 - post.padS) * 0.25, post.padS, 1 + (1 - post.padS) * 0.25);
    post.pad.position.y = 0.06 * post.padS;
  };
})();
