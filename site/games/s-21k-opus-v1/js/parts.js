// parts.js — 坂板・回転盤（盤受けと待ち溝つき）・ハンドル・前窓・受け皿・丸穴の台紙
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var P = (G.parts = {});
  var D90 = Math.PI / 2;
  var V3 = THREE.Vector3, Q = THREE.Quaternion;

  // ---------- 机の上で動かせる部品の共通 ----------
  function Part(name, obj) {
    this.name = name; this.obj = obj;
    this.state = 'desk';
    this.tpos = obj.position.clone(); this.tquat = obj.quaternion.clone();
    this.deskQuat = obj.quaternion.clone();
    this.restY = obj.position.y;
    this.holdY = 1.2;
    this.radius = 3;
    this.preview = false;
    this.grabOff = new V3();
    this.mats = G.ownMaterials(obj);
    this.bounce = 0;
  }
  Part.prototype.screenOf = function (p) { return G.stage.toScreen(p, new V3()); };
  Part.prototype.beginHold = function (ray) {
    this.state = 'held';
    var dp = G.stage.rayPlaneY(ray, this.holdY) || this.obj.position.clone();
    this.grabOff.set(this.obj.position.x - dp.x, 0, this.obj.position.z - dp.z);
    if (this.grabOff.length() > this.radius * 0.8) this.grabOff.setLength(this.radius * 0.8);
    this.tquat.copy(this.deskQuat);
    if (G.audio) G.audio.hit('card', 0.3, this.obj.position.x / 12);
  };
  Part.prototype.holdMove = function (ray, px, py) {
    var dp = G.stage.rayPlaneY(ray, this.holdY);
    var prev = this.preview;
    this.preview = !!(this.canInstall && this.canInstall() && this.nearTarget && this.nearTarget(px, py, ray));
    if (this.preview) {
      var pv = this.previewPose(px, py, ray);
      this.tpos.copy(pv.pos); this.tquat.copy(pv.quat);
      if (!prev && G.audio) G.audio.hit('card', 0.2);
    } else if (dp) {
      this.tpos.set(dp.x + this.grabOff.x, this.holdY + (this.restY > 0 ? this.restY : 0), dp.z + this.grabOff.z);
      clampDesk(this.tpos, this.radius);
      this.tquat.copy(this.deskQuat);
    }
  };
  Part.prototype.endHold = function () {
    if (this.preview) { this.preview = false; this.install(); return; }
    // 机に置く（箱や受け皿の上は避ける）
    var p = this.tpos.clone();
    pushOut(p, this.radius);
    p.y = this.restY;
    this.state = 'anim';
    var self = this, from = this.obj.position.clone(), q0 = this.obj.quaternion.clone();
    G.tween(0.22, function (k) {
      self.obj.position.lerpVectors(from, p, k);
      self.obj.quaternion.slerpQuaternions(q0, self.deskQuat, k);
    }, function () {
      self.state = 'desk'; self.tpos.copy(p); self.tquat.copy(self.deskQuat);
      if (G.audio) G.audio.hit('card', 0.45, p.x / 12);
    }, G.easeOut);
  };
  Part.prototype.update = function (dt) {
    if (this.state === 'held') {
      G.dampV(this.obj.position, this.tpos, 16, dt);
      this.obj.quaternion.slerp(this.tquat, 1 - Math.exp(-14 * dt));
    }
  };
  Part.prototype.center = function () {
    var b = new THREE.Box3().setFromObject(this.obj);
    return b.getCenter(new V3());
  };
  P.Part = Part;

  // 机の範囲（箱が立ったあとは、画面から外れにくい手前寄りの範囲）
  P.bounds = function () {
    if (G.box.isUp()) return { x0: -10.5, x1: 10.5, z0: -5, z1: 14.5 };
    return { x0: -K.DESK_X, x1: K.DESK_X, z0: K.DESK_Z0, z1: K.DESK_Z1 };
  };
  function clampDesk(p, r) {
    var b = P.bounds();
    p.x = G.clamp(p.x, b.x0 + r * 0.5, b.x1 - r * 0.5);
    p.z = G.clamp(p.z, b.z0 + r * 0.5, b.z1 - r * 0.3);
  }
  // 箱と受け皿の上には置かない
  function pushOut(p, r) {
    clampDesk(p, r);
    var rects = [];
    if (G.box.anyLocked() || G.box.hinges.R.angle > 0.5 || G.box.hinges.L.angle > 0.5) rects.push([-5.6, 5.6, -3.2, 2.6]);
    var tx = P.tray ? P.tray.x : 0;
    rects.push([tx - 3.2, tx + 3.2, 2.6, 6.9]);
    for (var i = 0; i < rects.length; i++) {
      var R = rects[i], m = r * 0.6;
      if (p.x > R[0] - m && p.x < R[1] + m && p.z > R[2] - m && p.z < R[3] + m) {
        var dl = p.x - (R[0] - m), dr = (R[1] + m) - p.x, db = p.z - (R[2] - m), df = (R[3] + m) - p.z;
        var mn = Math.min(dl, dr, db, df);
        if (i === 0 && mn === db) mn = Math.min(dl, dr);   // 箱の奥には置かない（見えなくなる）
        if (mn === dl) p.x = R[0] - m; else if (mn === dr) p.x = R[1] + m;
        else if (mn === db) p.z = R[2] - m; else p.z = R[3] + m;
      }
    }
    clampDesk(p, r);
  }
  P.pushOut = pushOut;
  P.clampDesk = clampDesk;

  function scrDist(px, py, wp) {
    var s = G.stage.toScreen(wp, new V3());
    return Math.hypot(s.x - px, s.y - py);
  }
  function snapPx() { return Math.max(70, Math.min(G.stage.w, G.stage.h) * 0.2); }

  // ---------- 坂板 ----------
  function buildBoard() {
    var g = new THREE.Group();
    var bx = K.BODY_X, ex = K.EAR_X;
    var z0 = K.BOARD_Z0, z1 = K.BOARD_Z1, e0 = K.EAR_Z0, e1 = K.EAR_Z1;
    // 形の y = -z
    var pts = [[-bx, -z1], [bx, -z1], [bx, -e1], [ex, -e1], [ex, -e0], [-ex, -e0], [-ex, -e1], [-bx, -e1]];
    var sh = new THREE.Shape();
    pts.forEach(function (p, i) { if (i === 0) sh.moveTo(p[0], p[1]); else sh.lineTo(p[0], p[1]); });
    sh.lineTo(pts[0][0], pts[0][1]);
    var panel = G.card.panel(sh, { fluteAxis: 'x' });
    panel.rotation.x = -D90;
    g.add(panel);
    // 手前と奥の折り上げた縁
    [[z1 - 0.1, 1], [z0 + 0.1, -1]].forEach(function (zz) {
      var lip = G.card.rect(2 * bx, 0.4, { inset: 0.06 });
      lip.position.set(0, 0.3, zz[0]);
      g.add(lip);
      var cr = G.card.crease(2 * bx, K.T); cr.position.set(0, 0.05, zz[0]); g.add(cr);
    });
    // 高い側の小さな止め（落ちないように）
    G.shadowAll(g);
    return g;
  }

  // ---------- 回転盤（盤受け・待ち溝・取り出し口つき） ----------
  function buildDiskUnit() {
    var g = new THREE.Group();
    var T = K.T;
    var unit = new THREE.Group(); g.add(unit);
    // 奥の壁
    var back = G.card.rect(9.6, 7.1, {}); back.position.set(0, 0.2 + 7.1 / 2, -0.4); unit.add(back);
    // 待ち溝（左右）
    var ta = K.TROUGH_A, tan = Math.tan(ta);
    [1, -1].forEach(function (s) {
      var x0 = K.TROUGH_X0, x1 = K.TROUGH_X1 + 0.1;
      var len = (x1 - x0) / Math.cos(ta);
      var xm = s * (x0 + x1) / 2;
      var topAt = function (x) { return K.Y_TOP + Math.abs(x) * tan - K.R / Math.cos(ta); };
      var fg = new THREE.Group();
      var floor = G.card.rect(len, 2.15, { inset: 0.07 });
      floor.rotation.x = -D90;
      fg.add(floor);
      fg.position.set(xm, topAt(xm) - T / 2, (K.CHUTE_Z0 + 1.85) / 2);
      fg.rotation.z = s * ta;
      unit.add(fg);
      var lip = G.card.rect(len, 0.55, { inset: 0.06 });
      lip.position.set(xm, topAt(xm) + 0.2, 1.75);
      lip.rotation.z = s * ta;
      unit.add(lip);
      // 外側の頬板
      var ch = topAt(x1) - 0.2;
      var cheek = G.card.rect(2.25, ch, { inset: 0.06 });
      cheek.rotation.y = D90;
      cheek.position.set(s * (x1 + 0.05), 0.2 + ch / 2, (K.CHUTE_Z0 + 1.85) / 2 - 0.05);
      unit.add(cheek);
      // 盤の横を囲う帯
      var a0 = Math.PI - 150 * Math.PI / 180, a1 = Math.PI - 50 * Math.PI / 180;
      if (s < 0) { a0 = Math.PI + 50 * Math.PI / 180; a1 = Math.PI + 150 * Math.PI / 180; }
      var arc = G.card.arc(K.POCKET_R + K.NOTCH_R + 0.12, 2.15, a0, a1, T * 0.8);
      arc.rotation.x = D90;
      arc.position.set(0, K.DISK_Y, (K.CHUTE_Z0 + 1.85) / 2);
      unit.add(arc);
    });
    // 取り出し口の床と囲い
    var cz0 = K.CHUTE_Z0, cz1 = K.LIP_Z;
    var clen = Math.hypot(cz1 - cz0, K.CHUTE_Y0 - K.LIP_Y);
    var slope = Math.atan2(K.CHUTE_Y0 - K.LIP_Y, cz1 - cz0);
    var cf = new THREE.Group();
    var cfloor = G.card.rect(2.2, clen, { inset: 0.06 });
    cfloor.rotation.x = -D90;
    cf.add(cfloor);
    cf.position.set(0, (K.CHUTE_Y0 + K.LIP_Y) / 2 - T / 2, (cz0 + cz1) / 2);
    cf.rotation.x = slope;
    unit.add(cf);
    [1, -1].forEach(function (s) {
      var w = G.card.rect(clen, 1.0, { inset: 0.05 });
      w.rotation.y = D90;
      var wg = new THREE.Group(); wg.add(w);
      wg.position.set(s * 1.2, (K.CHUTE_Y0 + K.LIP_Y) / 2 + 0.4, (cz0 + cz1) / 2);
      wg.rotation.x = slope;
      unit.add(wg);
    });
    // 脚（取り出し口の床を支える）
    var leg = G.card.rect(2.2, 0.75, { inset: 0.05 }); leg.position.set(0, 0.2 + 0.36, cz0 + 0.1); unit.add(leg);
    // 前の板（取り出し口の穴）
    var fs = G.card.rectShape(-4.8, 0.2, 4.8, K.WIN_Y0);
    fs.holes.push(G.card.rectPath(-1.15, 0.62, 1.15, 2.62));
    var front = G.card.panel(fs, { fluteAxis: 'x' });
    front.position.z = 1.85;
    unit.add(front);
    // ひさし
    var vis = G.card.rect(3.1, 0.45, { inset: 0.06 });
    vis.rotation.x = -D90 + 0.14;
    vis.position.set(0, 2.69, 2.17);
    unit.add(vis);
    var vcr = G.card.crease(3.1, K.T); vcr.position.set(0, 2.66, 1.95); unit.add(vcr);
    // 軸受け
    var axle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16), G.mat.dowel);
    axle.rotation.x = D90; axle.position.set(0, K.DISK_Y, -0.2); unit.add(axle);

    // 盤（くぼみ一つ、貼り合わせた段ボール）
    var spin = new THREE.Group();
    spin.position.set(0, K.DISK_Y, K.DISK_Z);
    g.add(spin);
    var dshape = diskShape();
    var dg = new THREE.ExtrudeGeometry(dshape, { depth: K.DISK_TH, bevelEnabled: false, curveSegments: 48 });
    dg.translate(0, 0, -K.DISK_TH / 2);
    var disk = new THREE.Mesh(dg, [G.mat.liner, G.mat.layers]);
    spin.add(disk);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.22, 20), G.mat.dowel);
    hub.rotation.x = D90; hub.position.z = K.DISK_TH / 2 + 0.1;
    spin.add(hub);
    var sock = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12), G.mat.gap);
    sock.rotation.x = D90; sock.position.z = K.DISK_TH / 2 + 0.22;
    spin.add(sock);
    G.shadowAll(g);
    g.userData.spin = spin;
    return g;
  }
  function diskShape() {
    var R = K.DISK_R, c = K.POCKET_R, r = K.NOTCH_R;
    // 円と切り欠きの交点
    var y = (R * R - r * r + c * c) / (2 * c), x = Math.sqrt(Math.max(0, R * R - y * y));
    var a0 = Math.atan2(y, -x), a1 = Math.atan2(y, x) + Math.PI * 2;
    var sh = new THREE.Shape(), n = 72, i;
    for (i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * i / n;
      if (i === 0) sh.moveTo(Math.cos(a) * R, Math.sin(a) * R); else sh.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    var b0 = Math.atan2(y - c, x), b1 = Math.atan2(y - c, -x) - Math.PI * 2;
    var m = 24;
    for (i = 1; i < m; i++) {
      var b = b0 + (b1 - b0) * i / m;
      sh.lineTo(Math.cos(b) * r, c + Math.sin(b) * r);
    }
    sh.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
    return sh;
  }

  // ---------- ハンドル ----------
  function buildHandle() {
    var g = new THREE.Group();
    var crank = new THREE.Group(); g.add(crank);
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.2, 14), G.mat.dowel);
    shaft.rotation.x = D90; shaft.position.z = -0.55;
    crank.add(shaft);
    // 腕：貼り合わせの段ボール
    var as = new THREE.Shape();
    var w = 0.32, L = K.CRANK_R;
    as.moveTo(-w, 0);
    as.absarc(0, 0, w, Math.PI, Math.PI * 2, false);
    as.lineTo(w, L);
    as.absarc(0, L, w, 0, Math.PI, false);
    as.lineTo(-w, 0);
    var arm = G.card.panel(as, { fluteAxis: 'y', inset: 0.06, T: 0.24 });
    crank.add(arm);
    var knob = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.62, 18), G.mat.topWood);
    knob.rotation.x = D90; knob.position.set(0, L, 0.42);
    crank.add(knob);
    var cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, D90), G.mat.topWood);
    cap.rotation.x = D90; cap.position.set(0, L, 0.73);
    crank.add(cap);
    G.shadowAll(g);
    g.userData.crank = crank;
    return g;
  }

  // ---------- 前窓（下に軸を通す切り込み） ----------
  function buildWindow() {
    var g = new THREE.Group();
    var hw = K.WIN_HW, h = K.WIN_Y1 - K.WIN_Y0, sw = 0.34, sy = K.DISK_Y - K.WIN_Y0;
    var sh = new THREE.Shape();
    sh.moveTo(-hw, 0); sh.lineTo(-sw, 0); sh.lineTo(-sw, sy);
    sh.absarc(0, sy, sw, Math.PI, 0, true);
    sh.lineTo(sw, 0); sh.lineTo(hw, 0); sh.lineTo(hw, h); sh.lineTo(-hw, h); sh.lineTo(-hw, 0);
    var geo = new THREE.ExtrudeGeometry(sh, { depth: K.WIN_TH, bevelEnabled: false, curveSegments: 12 });
    var m = new THREE.Mesh(geo, [G.mat.windowPl, G.mat.windowEdge]);
    m.renderOrder = 3;
    m.castShadow = false; m.receiveShadow = false;
    g.add(m);
    return g;
  }

  // ---------- 受け皿 ----------
  function buildTray() {
    var g = new THREE.Group();
    var inner = new THREE.Group(); g.add(inner);
    var w = K.TRAY_W, d = K.TRAY_D, t = K.TRAY_FLOOR, rim = K.TRAY_RIM;
    var opt = { T: t, inset: 0.05, topMat: G.mat.tray, botMat: G.mat.tray, pitch: 0.22 };
    var floor = G.card.rect(w, d, opt);
    floor.rotation.x = -D90; floor.position.y = t / 2;
    inner.add(floor);
    var tilt = 0.32; // 浅く外へ開いた縁
    [[0, d / 2, 0, w], [0, -d / 2, Math.PI, w], [w / 2, 0, D90, d], [-w / 2, 0, -D90, d]].forEach(function (e) {
      var pg = new THREE.Group();
      pg.position.set(e[0], t, e[1]);
      pg.rotation.y = e[2];
      var r = G.card.rect(e[3], rim, opt);
      var rg = new THREE.Group(); rg.add(r);
      r.position.y = rim / 2;
      rg.rotation.x = tilt;
      pg.add(rg);
      var cr = G.card.crease(e[3], t); cr.position.y = 0; pg.add(cr);
      inner.add(pg);
    });
    G.shadowAll(g);
    g.userData.inner = inner;
    return g;
  }

  // ---------- 丸穴の台紙（切り抜きの残り） ----------
  function buildHoleCard() {
    var g = new THREE.Group();
    var sh = G.card.rectShape(-4.4, -1.5, 4.4, 1.5);
    P.holeXs = [-2.8, 0, 2.8];
    P.holeXs.forEach(function (x) { sh.holes.push(G.card.circlePath(x, 0, 0.62, 30)); });
    // 回転盤を抜いた跡の弧（端に半分）
    var p = G.card.panel(sh, { fluteAxis: 'x' });
    p.rotation.x = -D90; p.position.y = K.T / 2;
    g.add(p);
    G.shadowAll(g);
    return g;
  }

  // ---------- まとめて作る ----------
  P.build = function (scene) {
    // 坂板
    var bo = buildBoard();
    bo.position.set(-11 + G.rr(-0.3, 0.3), K.T / 2, 8.4 + G.rr(-0.2, 0.2));
    bo.rotation.y = G.rr(-0.06, 0.06);
    scene.add(bo);
    var board = new Part('board', bo);
    board.deskQuat.copy(bo.quaternion);
    board.restY = K.T / 2; board.holdY = 1.4; board.radius = 5;
    board.highSide = 1;
    P.board = board;
    setupBoard(board);

    // 回転盤
    var du = buildDiskUnit();
    du.position.set(11 + G.rr(-0.3, 0.3), -0.2, -7.6);
    du.rotation.y = G.rr(-0.05, 0.05);
    scene.add(du);
    var disk = new Part('disk', du);
    disk.deskQuat.copy(du.quaternion);
    disk.restY = -0.2; disk.holdY = 0.6; disk.radius = 5;
    disk.spin = du.userData.spin;
    disk.angle = 0;
    P.disk = disk;
    setupDisk(disk);
    disk.setAngle(G.rr(1.2, 2.0));

    // ハンドル
    var ha = buildHandle();
    var bas = new THREE.Matrix4().makeBasis(new V3(0, 1, 0), new V3(0, 0, 1), new V3(1, 0, 0));
    ha.quaternion.setFromRotationMatrix(bas);
    ha.quaternion.premultiply(new Q().setFromAxisAngle(G.UP, G.rr(-0.3, 0.3)));
    ha.position.set(9.2 + G.rr(-0.3, 0.3), 0.32, -5.2);
    scene.add(ha);
    var handle = new Part('handle', ha);
    handle.deskQuat.copy(ha.quaternion);
    handle.restY = 0.32; handle.holdY = 1.0; handle.radius = 1.6;
    handle.crank = ha.userData.crank;
    handle.angle = 0; handle.vel = 0;
    P.handle = handle;
    setupHandle(handle);

    // 前窓
    var wi = buildWindow();
    wi.rotation.x = -D90;
    wi.position.set(-11 + G.rr(-0.2, 0.2), 0.01, -3.8);
    scene.add(wi);
    var win = new Part('window', wi);
    win.deskQuat.copy(wi.quaternion);
    win.restY = 0.01; win.holdY = 1.0; win.radius = 5.5;
    P.win = win;
    setupWindow(win);

    // 受け皿
    var tr = buildTray();
    tr.position.set(0, 0, K.TRAY_Z);
    scene.add(tr);
    P.tray = { obj: tr, inner: tr.userData.inner, x: 0, tx: 0, sink: new G.Spring(0, 260, 9), mats: G.ownMaterials(tr), dragging: false };

    // 丸穴の台紙
    var hc = buildHoleCard();
    hc.position.set(-1.2, 0, 8.7);
    hc.rotation.y = G.rr(-0.04, 0.04);
    scene.add(hc);
    P.holeCard = hc;
    hc.updateMatrixWorld(true);
    P.holes = P.holeXs.map(function (x) {
      var w = new V3(x, 0, 0); hc.localToWorld(w);
      return { pos: w, item: null };
    });
  };

  // ---------- 坂板の振る舞い ----------
  function setupBoard(b) {
    b.installed = false;
    b.canInstall = function () { return G.box.isUp() && !b.installed && P.win.state !== 'installed' && P.win.state !== 'partial'; };
    b.nearTarget = function (px, py) {
      var c = new V3(0, K.H * 0.85, -0.2);
      var s = G.stage.toScreen(c, new V3());
      var e = G.stage.toScreen(new V3(K.W / 2, K.H * 0.85, -0.2), new V3());
      var r = Math.max(snapPx(), Math.abs(e.x - s.x) * 1.1);
      if (Math.hypot(px - s.x, py - s.y) < r) {
        b.highSide = px < s.x ? -1 : 1;
        return true;
      }
      return false;
    };
    b.finalPose = function (hs) {
      var q = new Q().setFromAxisAngle(new V3(0, 0, 1), hs * K.BETA);
      return { pos: new V3(0, (K.SLOT_HI + K.SLOT_LO) / 2, 0), quat: q };
    };
    // 高い耳を溝に入れ、反対の端を持ち上げた姿勢（rot は回転量）
    b.poseAboutTip = function (hs, rot) {
      var f = b.finalPose(hs);
      var tipL = new V3(hs * K.EAR_X, 0, 0);
      var tipW = tipL.clone().applyQuaternion(f.quat).add(f.pos);
      var q = new Q().setFromAxisAngle(new V3(0, 0, 1), rot);
      var c = tipW.clone().sub(tipL.clone().applyQuaternion(q));
      return { pos: c, quat: q };
    };
    b.previewPose = function () {
      var p = b.poseAboutTip(b.highSide, -b.highSide * 0.16);
      p.pos.y += 1.3;
      return p;
    };
    b.install = function () {
      var hs = b.highSide;
      b.state = 'anim';
      var from = b.obj.position.clone(), q0 = b.obj.quaternion.clone();
      var A = b.poseAboutTip(hs, -hs * 0.16);
      // 1) 先端が合う
      G.tween(0.28, function (k) {
        b.obj.position.lerpVectors(from, A.pos, k);
        b.obj.quaternion.slerpQuaternions(q0, A.quat, k);
      }, function () {
        if (G.audio) G.audio.hit('slot', 0.5, hs * 0.6);
        // 2) 反対の耳が下がって根元が沈む
        G.tween(0.42, function (k) {
          var rot = G.lerp(-hs * 0.16, hs * K.BETA, k);
          var p = b.poseAboutTip(hs, rot);
          b.obj.position.copy(p.pos); b.obj.quaternion.copy(p.quat);
        }, function () {
          var f = b.finalPose(hs);
          b.obj.position.copy(f.pos); b.obj.quaternion.copy(f.quat);
          b.state = 'installed'; b.installed = true;
          b.slopeSide = -hs; // 低い側
          if (G.audio) { G.audio.hit('slot', 0.8, -hs * 0.6); G.audio.hit('card', 0.5, -hs * 0.6, 0.04); }
          G.game.onEvent('boardIn', hs);
        }, function (t) { return t * t * (2.2 - 1.2 * t); });
      }, G.easeOut);
    };
    b.canRemove = function () {
      return b.installed && (P.win.state === 'desk' || P.win.state === 'held' || P.win.state === 'anim') && G.flow.boxEmpty();
    };
    b.remove = function (ray) {
      b.installed = false; b.slopeSide = 0;
      b.state = 'held';
      b.grabOff.set(0, 0, 0);
      b.tquat.copy(b.obj.quaternion);
      if (G.audio) G.audio.hit('slot', 0.6);
      G.game.onEvent('boardOut');
    };
    // 抜いている最中は傾いたまま持ち上がり、箱から出たら平らに
    var baseMove = b.holdMove;
    b.holdMove = function (ray, px, py) {
      baseMove.call(b, ray, px, py);
      if (!b.preview && b.tpos.z < 3.5 && Math.abs(b.tpos.x) < 6 && G.box.isUp()) {
        b.tpos.y = Math.max(b.tpos.y, K.H + 1.2);
      }
    };
  }

  // ---------- 回転盤の振る舞い ----------
  function setupDisk(d) {
    d.installed = false;
    d.canInstall = function () { return G.box.isUp() && !d.installed && P.win.state !== 'installed' && P.win.state !== 'partial'; };
    d.nearTarget = function (px, py) {
      return scrDist(px, py, new V3(0, 3.2, 1.5)) < Math.max(snapPx(), 0.12 * G.stage.w + 40);
    };
    d.previewPose = function () { return { pos: new V3(0, 0.35, 5.2), quat: new Q() }; };
    d.install = function () {
      d.state = 'anim';
      var from = d.obj.position.clone(), q0 = d.obj.quaternion.clone();
      var A = new V3(0, 0.3, 3.6);
      G.tween(0.25, function (k) {
        d.obj.position.lerpVectors(from, A, k);
        d.obj.quaternion.slerpQuaternions(q0, new Q(), k);
      }, function () {
        if (G.audio) G.audio.hit('card', 0.4);
        G.tween(0.5, function (k) {
          d.obj.position.set(0, k < 0.8 ? 0.3 : G.lerp(0.3, 0, (k - 0.8) / 0.2), G.lerp(3.6, 0, Math.min(1, k / 0.8)));
          G.audio && G.audio.ask('scrape', 0.6, 0.2);
        }, function () {
          d.obj.position.set(0, 0, 0); d.obj.quaternion.identity();
          d.state = 'installed'; d.installed = true;
          if (G.audio) { G.audio.hit('card', 0.8); G.audio.hit('slot', 0.4, 0, 0.03); }
          G.game.onEvent('diskIn');
        }, G.easeInOut);
      }, G.easeOut);
    };
    d.setAngle = function (a) { d.angle = a; d.spin.rotation.z = -a; };
  }

  // ---------- ハンドルの振る舞い ----------
  function setupHandle(h) {
    h.installed = false;
    h.canInstall = function () { return P.disk.installed && !h.installed; };
    h.nearTarget = function (px, py) { return scrDist(px, py, new V3(0, K.DISK_Y, K.HANDLE_Z)) < snapPx(); };
    h.previewPose = function () { return { pos: new V3(0, K.DISK_Y, K.HANDLE_Z + 1.8), quat: new Q() }; };
    h.install = function () {
      h.state = 'anim';
      var from = h.obj.position.clone(), q0 = h.obj.quaternion.clone();
      var A = new V3(0, K.DISK_Y, K.HANDLE_Z + 1.1);
      G.tween(0.25, function (k) {
        h.obj.position.lerpVectors(from, A, k);
        h.obj.quaternion.slerpQuaternions(q0, new Q(), k);
      }, function () {
        if (G.audio) G.audio.hit('wood', 0.4);
        G.tween(0.3, function (k) {
          h.obj.position.set(0, K.DISK_Y, G.lerp(K.HANDLE_Z + 1.1, K.HANDLE_Z, k));
        }, function () {
          h.obj.position.set(0, K.DISK_Y, K.HANDLE_Z);
          h.state = 'installed'; h.installed = true;
          h.angle = P.disk.angle;
          h.crank.rotation.z = -h.angle;
          if (G.audio) { G.audio.hit('wood', 0.8); G.audio.hit('card', 0.3, 0, 0.03); }
          G.game.onEvent('handleIn');
        }, function (t) { return t * t; });
      }, G.easeOut);
    };
    // 回す
    h.crankDown = function (ray) {
      var p = G.stage.rayPlaneZ(ray, K.HANDLE_Z + 0.3);
      h.cranking = true;
      h.lastA = p ? Math.atan2(p.x, p.y - K.DISK_Y) : null;
      h.lastT = G.now();
      if (G.audio) G.audio.hit('wood', 0.25);
    };
    h.crankMove = function (ray) {
      var p = G.stage.rayPlaneZ(ray, K.HANDLE_Z + 0.3);
      if (!p) return;
      var dx = p.x, dy = p.y - K.DISK_Y;
      if (Math.hypot(dx, dy) < 0.35) return;
      var a = Math.atan2(dx, dy);  // 上から時計回り
      if (h.lastA == null) { h.lastA = a; return; }
      var da = G.wrapA(a - h.lastA);
      h.lastA = a;
      h.pending = (h.pending || 0) + da;
    };
    h.crankUp = function () { h.cranking = false; h.pending = 0; };
    h.updateCrank = function (dt) {
      if (!h.installed) return;
      var target = h.pending || 0;
      h.pending = 0;
      var step = G.clamp(target, -0.6, 0.6);
      var prev = h.angle;
      h.angle += step;
      var v = (h.angle - prev) / Math.max(dt, 1e-3);
      h.vel = G.damp(h.vel, v, 12, dt);
      if (!h.cranking) h.vel = G.damp(h.vel, 0, 10, dt);
      h.crank.rotation.z = -h.angle;
      P.disk.setAngle(h.angle);
      if (G.audio) G.audio.ask('crank', Math.abs(h.vel));
    };
  }

  // ---------- 前窓の振る舞い ----------
  function setupWindow(w) {
    w.y = K.WIN_Y0;
    w.canInstall = function () { return G.box.isUp() && P.handle.installed; };
    w.nearTarget = function (px, py) {
      return scrDist(px, py, new V3(0, K.H + 1.5, K.WIN_Z)) < Math.max(snapPx(), G.stage.w * 0.22);
    };
    w.upPos = function (y) { return new V3(0, y, K.WIN_Z - K.WIN_TH / 2); };
    w.previewPose = function () { return { pos: w.upPos(K.H + 1.4), quat: new Q() }; };
    w.install = function () {
      w.state = 'anim';
      var from = w.obj.position.clone(), q0 = w.obj.quaternion.clone();
      G.tween(0.25, function (k) {
        w.obj.position.lerpVectors(from, w.upPos(K.H + 0.4), k);
        w.obj.quaternion.slerpQuaternions(q0, new Q(), k);
      }, function () {
        if (G.audio) G.audio.hit('slot', 0.35);
        G.tween(0.65, function (k) {
          w.obj.position.copy(w.upPos(G.lerp(K.H + 0.4, K.WIN_Y0, k)));
          G.audio.ask('scrape', 0.35, 0.8);
        }, function () {
          w.y = K.WIN_Y0;
          w.obj.position.copy(w.upPos(K.WIN_Y0));
          w.state = 'installed';
          if (G.audio) { G.audio.hit('card', 0.5); G.audio.hit('shell', 0.3, 0, 0.02); }
          G.game.onEvent('windowIn');
        }, function (t) { return t * t; });
      }, G.easeOut);
    };
    // 溝に沿って引き上げる
    w.slideDown = function (ray) {
      var p = G.stage.rayPlaneZ(ray, K.WIN_Z);
      w.slideOff = p ? p.y - w.y : 2;
      w.state = 'partial';
      w.sliding = true;
      if (G.audio) G.audio.hit('card', 0.25);
    };
    w.slideMove = function (ray) {
      var p = G.stage.rayPlaneZ(ray, K.WIN_Z);
      if (!p) return 'stay';
      var ny = G.clamp(p.y - w.slideOff, K.WIN_Y0, K.H + 1.0);
      var dy = Math.abs(ny - w.y);
      w.y = ny;
      w.obj.position.copy(w.upPos(w.y));
      if (G.audio) G.audio.ask('scrape', Math.min(1, dy * 6), 0.8);
      if (w.y >= K.WIN_Y0 + 3.2) return 'out';
      return 'stay';
    };
    // 溝から抜ける（指はそのまま持ち続ける）
    w.popOut = function () {
      w.sliding = false; w.state = 'anim'; w.popping = true; w.dropAfterPop = false;
      var y0 = w.y;
      G.tween(0.32, function (k) {
        w.y = G.lerp(y0, K.H + 0.7, k);
        w.obj.position.copy(w.upPos(w.y));
        G.audio && G.audio.ask('scrape', 0.4, 0.8);
      }, function () {
        w.popping = false; w.state = 'held';
        w.grabOff.set(0, 0, 0); w.tpos.copy(w.obj.position); w.tquat.copy(w.obj.quaternion);
        if (G.audio) G.audio.hit('card', 0.3);
        if (w.dropAfterPop) { w.dropAfterPop = false; w.tpos.set(0, w.restY, K.FRONT_Z + 6); w.endHold(); }
      }, G.easeOut);
    };
    w.slideUp = function () {
      w.sliding = false;
      if (w.y <= K.WIN_Y0 + 0.25) {
        w.y = K.WIN_Y0; w.obj.position.copy(w.upPos(w.y)); w.state = 'installed';
        if (G.audio) G.audio.hit('card', 0.3);
      } else w.state = 'partial';
    };
  }

  // ---------- 受け皿 ----------
  P.trayDown = function (ray) {
    var t = P.tray;
    var p = G.stage.rayPlaneY(ray, 0.4);
    t.dragging = true;
    t.off = p ? t.x - p.x : 0;
    if (G.audio) G.audio.hit('card', 0.3);
  };
  P.trayMove = function (ray) {
    var t = P.tray;
    var p = G.stage.rayPlaneY(ray, 0.4);
    if (!p) return;
    t.tx = G.clamp(p.x + t.off, -K.TRAY_SHIFT, K.TRAY_SHIFT);
  };
  P.trayUp = function () { P.tray.dragging = false; };

  P.update = function (dt) {
    ['board', 'disk', 'handle', 'win'].forEach(function (k) { P[k].update(dt); });
    P.handle.updateCrank(dt);
    var t = P.tray;
    var prevX = t.x;
    t.x = G.damp(t.x, t.tx, 14, dt);
    if (G.audio && t.dragging) G.audio.ask('scrape', Math.min(1, Math.abs(t.x - prevX) / Math.max(dt, 1e-3) / 6), 0.1);
    var s = t.sink.step(dt);
    t.obj.position.set(t.x, 0, K.TRAY_Z);
    t.inner.position.y = s;
  };
})();
