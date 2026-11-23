// box.js — 一枚の台紙（底板・背板・左右の側板）、折り筋、爪と穴、小さな効果
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var B = (G.box = {});
  var D90 = Math.PI / 2;

  // ---------- 小さな効果：へこみ・繊維 ----------
  var FX = (G.fx = { dents: [], fibers: [] });
  FX.init = function (scene) {
    var geo = new THREE.CircleGeometry(0.32, 20);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y) / 0.32;
      p.setZ(i, -0.03 * (1 - r * r));
    }
    geo.computeVertexNormals();
    FX.dentGeo = geo;
    FX.fiberGeo = new THREE.BoxGeometry(0.05, 0.015, 0.02);
    FX.scene = scene;
  };
  // 押したところの浅いへこみ（obj に貼る）
  FX.dent = function (obj, worldPoint, worldNormal) {
    var m = new THREE.Mesh(FX.dentGeo, G.mat.dent);
    m.userData.noGlow = true;
    m.receiveShadow = true;
    var lp = obj.worldToLocal(worldPoint.clone());
    var n = worldNormal.clone().transformDirection(new THREE.Matrix4().copy(obj.matrixWorld).invert());
    m.position.copy(lp).addScaledVector(n, 0.004);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.normalize());
    m.scale.setScalar(0.01);
    obj.add(m);
    var d = { mesh: m, s: new G.Spring(0.01, 260, 18), held: true };
    d.s.t = 1;
    FX.dents.push(d);
    return d;
  };
  FX.releaseDents = function () { FX.dents.forEach(function (d) { d.held = false; d.s.t = 0; }); };
  FX.fibers3 = function (p, n) {
    for (var i = 0; i < (n || 3); i++) {
      var m = new THREE.Mesh(FX.fiberGeo, G.mat.fiber);
      m.position.copy(p).add(new THREE.Vector3(G.rr(-0.1, 0.1), G.rr(-0.05, 0.05), G.rr(-0.1, 0.1)));
      m.rotation.set(G.rr(0, 3), G.rr(0, 3), G.rr(0, 3));
      m.castShadow = true;
      FX.scene.add(m);
      FX.fibers.push({ m: m, v: new THREE.Vector3(G.rr(-0.4, 0.4), G.rr(0, 0.6), G.rr(0.1, 0.6)), spin: G.rr(-8, 8), live: true });
      if (G.audio) G.audio.hit('fiber', 0.5, p.x / 10, 0.35 + i * 0.12);
    }
    while (FX.fibers.length > 40) { var f = FX.fibers.shift(); FX.scene.remove(f.m); }
  };
  FX.update = function (dt) {
    for (var i = FX.dents.length - 1; i >= 0; i--) {
      var d = FX.dents[i];
      var s = d.s.step(dt);
      d.mesh.scale.set(Math.max(0.01, s), Math.max(0.01, s), Math.max(0.01, s));
      if (!d.held && s < 0.03 && Math.abs(d.s.v) < 0.05) {
        if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
        FX.dents.splice(i, 1);
      }
    }
    FX.fibers.forEach(function (f) {
      if (!f.live) return;
      f.v.y -= 6 * dt;
      f.v.x *= 0.98; f.v.z *= 0.98;
      f.m.position.addScaledVector(f.v, dt);
      f.m.rotation.x += f.spin * dt; f.m.rotation.z += f.spin * 0.7 * dt;
      if (f.m.position.y < 0.01) { f.m.position.y = 0.008; f.m.rotation.x = 0; f.m.rotation.z = G.rr(-1, 1); f.live = false; }
    });
  };

  // ---------- 蝶番（折り筋を軸に回る板） ----------
  function Hinge(name, pivot, axisSign, panel) {
    this.name = name; this.pivot = pivot; this.sign = axisSign; this.panel = panel;
    this.angle = 0; this.spring = new G.Spring(0, 160, 9);
    this.locked = false; this.dragging = false; this.grab = null;
    this.extraLift = 0;
  }
  Hinge.prototype.apply = function (a) {
    if (this.name === 'B') this.pivot.rotation.x = a;
    else this.pivot.rotation.z = this.sign * a;
  };
  Hinge.prototype.worldAt = function (a, local, out) {
    var keep = this.angle;
    this.apply(a); this.pivot.updateMatrixWorld(true);
    out = (out || new THREE.Vector3()).copy(local);
    this.pivot.localToWorld(out);
    this.apply(keep); this.pivot.updateMatrixWorld(true);
    return out;
  };
  // 自由端の中央（案内用）
  Hinge.prototype.freeEdge = function (out) {
    var p = out || new THREE.Vector3();
    if (this.name === 'B') p.set(0, -K.T / 2, -K.H + 0.5);
    else p.set(this.sign * (K.H - 0.5), -K.T / 2, 0.35);
    this.pivot.localToWorld(p); return p;
  };
  // 折り筋からの距離 r の点（案内の指が動く道）
  Hinge.prototype.pointAt = function (a, r, out) {
    var l = this.name === 'B' ? new THREE.Vector3(0, 0, -r) : new THREE.Vector3(this.sign * r, 0, 0.35);
    return this.worldAt(a, l, out);
  };
  Hinge.prototype.localFromWorld = function (w) { return this.pivot.worldToLocal(w.clone()); };
  Hinge.prototype.update = function (dt) {
    var prev = this.angle;
    if (this.dragging) {
      this.spring.k = 400; this.spring.c = 38;
    } else { this.spring.k = 160; this.spring.c = 7; }
    this.angle = G.clamp(this.spring.step(dt), 0, D90 + 0.03);
    if (this.angle >= D90 + 0.03 && this.spring.v > 0) this.spring.v *= -0.3;
    this.apply(this.angle);
    var w = Math.abs(this.angle - prev) / Math.max(dt, 1e-3);
    this.speed = w;
  };

  B.build = function (scene) {
    var root = new THREE.Group();
    scene.add(root);
    B.root = root;
    var T = K.T, H = K.H, hw = K.W / 2;

    // 底板
    var base = G.card.panel(G.card.rectShape(-hw, -K.FRONT_Z, hw, -K.BACK_Z), { fluteAxis: 'x' });
    base.rotation.x = -D90; base.position.y = T / 2;
    root.add(base);
    B.base = base;
    // 底板の折り筋の帯
    addBand(root, new THREE.Vector3(0, T + 0.002, K.BACK_Z + 0.07), K.W - 0.2, 0.14, 0);
    addBand(root, new THREE.Vector3(hw - 0.07, T + 0.002, 0), K.D - 0.1, 0.14, D90);
    addBand(root, new THREE.Vector3(-hw + 0.07, T + 0.002, 0), K.D - 0.1, 0.14, D90);

    // 折り筋の丸み
    var cB = G.card.crease(K.W, T); cB.position.set(0, T / 2, K.BACK_Z); root.add(cB);
    var cR = G.card.crease(K.D, T); cR.rotation.y = D90; cR.position.set(hw, T / 2, 0); root.add(cR);
    var cL = G.card.crease(K.D, T); cL.rotation.y = D90; cL.position.set(-hw, T / 2, 0); root.add(cL);

    // 側板（右・左）
    B.hinges = {};
    ['R', 'L'].forEach(function (side) {
      var s = side === 'R' ? 1 : -1;
      var pivot = new THREE.Object3D();
      pivot.position.set(s * hw, T, 0);
      root.add(pivot);
      var shape = sideShape(s);
      var panel = G.card.panel(shape, { fluteAxis: 'y' });
      // 形の座標: x = 折り筋からの距離（左は負）、y = -z
      panel.rotation.x = -D90;
      panel.position.y = -T / 2;
      pivot.add(panel);
      // 側板側の折り筋帯
      var band = G.card.band(K.D, 0.14);
      band.rotation.x = -D90; band.rotation.z = D90;
      band.position.set(s * 0.07, 0.003, 0);
      pivot.add(band);
      var h = new Hinge(side, pivot, s, panel);
      h.mats = G.ownMaterials(panel);
      B.hinges[side] = h;
    });

    // 背板
    var bp = new THREE.Object3D();
    bp.position.set(0, T, K.BACK_Z);
    root.add(bp);
    var bpanel = G.card.panel(G.card.rectShape(-hw, 0, hw, H), { fluteAxis: 'x' });
    bpanel.rotation.x = -D90;
    bpanel.position.y = -T / 2;
    bp.add(bpanel);
    var bband = G.card.band(K.W - 0.2, 0.14);
    bband.rotation.x = -D90;
    bband.position.set(0, 0.003, -0.07);
    bp.add(bband);
    var hb = new Hinge('B', bp, 1, bpanel);
    B.hinges.B = hb;
    // 爪（左右）
    B.tabs = {};
    ['R', 'L'].forEach(function (side) {
      var s = side === 'R' ? 1 : -1;
      var tp = new THREE.Object3D();
      // 背板の面内：x = 横, -z = 折り筋からの距離
      tp.position.set(s * hw, -T / 2, -K.TAB_H);
      bp.add(tp);
      var tab = G.card.panel(tabShape(s), { fluteAxis: 'x', inset: 0.06 });
      tab.rotation.x = -D90;
      tp.add(tab);
      B.tabs[side] = { pivot: tp, mesh: tab, flex: new G.Spring(0, 300, 14), locked: false };
    });
    hb.mats = G.ownMaterials(bpanel);
    // 爪も背板と一緒に光る
    Object.keys(B.tabs).forEach(function (k) { hb.mats = hb.mats.concat(G.ownMaterials(B.tabs[k].mesh)); });

    // 初期の並び（ほんの少しだけ毎回ちがう：板が完全には平らでない）
    hb.spring.x = hb.spring.t = hb.angle = G.rr(0.0, 0.04);
    B.hinges.R.spring.x = B.hinges.R.spring.t = B.hinges.R.angle = G.rr(0.0, 0.05);
    B.hinges.L.spring.x = B.hinges.L.spring.t = B.hinges.L.angle = G.rr(0.0, 0.05);
    ['R', 'L', 'B'].forEach(function (k) { B.hinges[k].apply(B.hinges[k].angle); });
    G.shadowAll(root);
    root.traverse(function (o) { if (o.isMesh && o.userData.noGlow && o.geometry && o.geometry.type === 'PlaneGeometry') o.castShadow = false; });
  };

  function addBand(root, pos, len, wid, rotY) {
    var b = G.card.band(len, wid);
    b.rotation.x = -D90; b.rotation.z = rotY;
    b.position.copy(pos);
    root.add(b);
    return b;
  }

  // 側板の形（穴・溝・前窓の切り込み）
  function sideShape(s) {
    var H = K.H, T = K.T;
    var v0 = -K.FRONT_Z, v1 = -K.SIDE_BACK;           // -2.2 .. 2.9
    var g0 = -(K.WIN_Z + K.WIN_TH / 2 + 0.03), g1 = -(K.WIN_Z - K.WIN_TH / 2 - 0.03);
    var u0 = K.WIN_Y0 - T - 0.02;
    var pts = [[0, v0], [H, v0], [H, g0], [u0, g0], [u0, g1], [H, g1], [H, v1], [0, v1]];
    var sh = new THREE.Shape();
    pts.forEach(function (p, i) {
      var x = s * p[0], y = p[1];
      if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
    });
    sh.lineTo(s * pts[0][0], pts[0][1]);
    if (s < 0) { // 鏡映で向きが逆になるので作り直す
      var rev = new THREE.Shape();
      var p2 = pts.slice().reverse();
      p2.forEach(function (p, i) { if (i === 0) rev.moveTo(-p[0], p[1]); else rev.lineTo(-p[0], p[1]); });
      rev.lineTo(-p2[0][0], p2[0][1]);
      sh = rev;
    }
    // 爪の穴
    var hu = K.TAB_H, hv = -K.TAB_Z;
    sh.holes.push(rectHole(s, hu - 0.47, hv - 0.14, hu + 0.47, hv + 0.14));
    // 坂板の溝（高・低）
    [K.SLOT_HI - T, K.SLOT_LO - T].forEach(function (u) {
      sh.holes.push(rectHole(s, u - 0.15, -K.EAR_Z1 - 0.02, u + 0.15, -K.EAR_Z0 + 0.04));
    });
    return sh;
  }
  function rectHole(s, u0, v0, u1, v1) {
    var a = Math.min(s * u0, s * u1), b = Math.max(s * u0, s * u1);
    return G.card.rectPath(a, v0, b, v1);
  }
  // 爪：根元→肩（穴より少し広い）→先細りの先端
  function tabShape(s) {
    var sh = new THREE.Shape();
    var p = [[-0.02, -0.4], [0.24, -0.4], [0.3, -0.49], [0.58, -0.2], [0.62, 0], [0.58, 0.2], [0.3, 0.49], [0.24, 0.4], [-0.02, 0.4]];
    if (s < 0) p = p.map(function (q) { return [-q[0], q[1]]; }).reverse();
    p.forEach(function (q, i) { if (i === 0) sh.moveTo(q[0], q[1]); else sh.lineTo(q[0], q[1]); });
    sh.lineTo(p[0][0], p[0][1]);
    return sh;
  }

  B.isUp = function () { return B.tabs && B.tabs.R.locked && B.tabs.L.locked; };
  B.anyLocked = function () { return B.tabs.R.locked || B.tabs.L.locked; };

  // 爪の世界座標（穴の位置合わせの見た目用）
  B.tabTip = function (side) {
    var t = B.tabs[side];
    var p = new THREE.Vector3((side === 'R' ? 1 : -1) * 0.55, 0, 0);
    t.pivot.localToWorld(p);
    return p;
  };

  B.update = function (dt) {
    var hs = B.hinges;
    ['R', 'L', 'B'].forEach(function (k) { hs[k].update(dt); });
    // 爪のたわみと留まり
    ['R', 'L'].forEach(function (side) {
      var tab = B.tabs[side], h = hs[side];
      if (!tab.locked) {
        var a = Math.min(hs.B.angle, h.angle);
        var near = G.smooth((a - 1.2) / (1.47 - 1.2));
        tab.flex.t = near * 0.3;
        if (hs.B.angle > 1.465 && h.angle > 1.465) lockTab(side);
      }
      var f = tab.flex.step(dt);
      // 肩がたわむ：爪を根元から少し起こす
      tab.pivot.rotation.z = -(side === 'R' ? 1 : -1) * f * 0.5;
      tab.pivot.rotation.y = 0;
      tab.pivot.scale.set(1, 1, 1 - Math.min(0.25, Math.abs(f) * 0.6));
    });
    var sp = Math.max(hs.R.dragging ? hs.R.speed : 0, hs.L.dragging ? hs.L.speed : 0, hs.B.dragging ? hs.B.speed : 0);
    if (G.audio) G.audio.ask('scrape', Math.min(1, sp / 3), Math.min(1, sp / 4));
  };

  function lockTab(side) {
    var tab = B.tabs[side], hs = B.hinges;
    tab.locked = true;
    hs[side].locked = true; hs.B.locked = true;
    hs[side].spring.t = D90; hs.B.spring.t = D90;
    hs[side].dragging = false;
    tab.flex.x = 0.35; tab.flex.t = 0.05; tab.flex.v = -6;   // 少しだけ折り癖が残る
    if (G.audio) { G.audio.hit('click', 0.9, side === 'R' ? 0.5 : -0.5); G.audio.hit('card', 0.5, 0, 0.05); }
    // 断面から繊維が二、三粒
    G.after(0.02, function () {
      var p = B.tabTip(side);
      FX.fibers3(p, 2 + Math.floor(G.rand() * 2));
    });
    hs[side].spring.kick(-0.6);
    if (G.game) G.game.onEvent('tabLocked', side);
  }

  // ---------- 操作（蝶番のドラッグ） ----------
  var sc = new THREE.Vector3();
  B.beginDrag = function (k, hitPoint, px, py) {
    var h = B.hinges[k];
    if (h.locked) { h.spring.kick(-0.25); if (G.audio) G.audio.hit('card', 0.25); return false; }
    h.dragging = true;
    var l = h.localFromWorld(hitPoint);
    // 折り筋の近くを掴んだら自由端寄りに置き換える（指の動きに対して回りやすく）
    if (k === 'B') { if (-l.z < 4) l.z = -4; }
    else { if (Math.abs(l.x) < 4) l.x = h.sign * 4; }
    h.grab = l;
    // 触れただけで指のほうへ少し起きる
    h.spring.t = Math.min(D90, h.angle + 0.16);
    h.grabDz = null;
    if (k === 'B') h.grabDz = (K.BACK_Z - hitPoint.z) - Math.max(3, -l.z) * Math.cos(h.spring.t);
    h.spring.kick(1.2);
    h.lastPx = px; h.lastPy = py;
    if (G.audio) G.audio.hit('card', 0.35, k === 'R' ? 0.6 : k === 'L' ? -0.6 : 0);
    return true;
  };
  B.drag = function (k, px, py) {
    var h = B.hinges[k];
    if (!h.dragging || h.locked) return;
    if (k === 'B') {
      // 背板：指が机の上で折り筋へ近づくほど起きる（上から見ても向きが逆転しない）
      var ray = G.stage.setRay(px, py);
      var p = G.stage.rayPlaneY(ray, K.T + 0.1);
      if (!p) return;
      var r = Math.max(3, -h.grab.z);
      var dz = K.BACK_Z - p.z;
      if (h.grabDz == null) h.grabDz = dz - r * Math.cos(h.spring.t);
      var c = G.clamp((dz - h.grabDz) / r, 0, 1);
      h.spring.t = G.clamp(Math.acos(c), 0, D90);
      return;
    }
    var best = h.spring.t, bc = 1e18, N = 64;
    var cur = h.spring.t;
    var lam = 400;   // 今の角度から離れすぎないように
    for (var i = 0; i <= N; i++) {
      var a = i / N * D90;
      h.worldAt(a, h.grab, sc);
      G.stage.toScreen(sc, sc);
      var dx = sc.x - px, dy = sc.y - py;
      var c = dx * dx + dy * dy + lam * (a - cur) * (a - cur) * 100;
      if (c < bc) { bc = c; best = a; }
    }
    h.spring.t = G.clamp(best, 0, D90);
  };
  B.endDrag = function (k) {
    var h = B.hinges[k];
    if (!h.dragging) return;
    h.dragging = false;
    if (h.locked) return;
    // 立ちかけなら立てる。そうでなければその角度で止まる（ほんの少し戻る）
    if (h.spring.t > 1.3) h.spring.t = D90;
    else h.spring.t = Math.max(0, h.spring.t - 0.02);
    h.spring.kick(-0.4);
    if (G.audio) G.audio.hit('card', 0.25);
  };
})();
