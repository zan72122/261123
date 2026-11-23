/* course.js — 水路の組み立て：支柱の高さ、差し込みの深さ、カーブの向き、組み上がる手順 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;
  var N = K.NOTCH;
  var MIN_G = -Math.tan(0.6 * Math.PI / 180);

  function Course(world) {
    var M = world.mats;
    this.world = world;
    this.group = new T.Group();
    world.scene.add(this.group);

    this.TX = -5.5; this.TZ = -0.9;
    this.base = { p0: 2.10, p1: 1.85, p2: 1.65 };
    this.st = {
      n0: 5, n1: 5, n2: 5, drop: 0,
      iS: 0.25, iE: 0.2,
      theta: SG.rsign() * SG.rr(0.3, 0.44),
      CinX: null, CinZ: null,
      att: { S: false, C: false, E: false }
    };
    this.version = 0;

    // 受け皿
    this.tray = SG.buildTray(M);
    this.group.add(this.tray.group);
    this.spoutX0Local = this.tray.spoutLocal.x0;
    this.spoutPath = new SG.TroughPath(K.SPOUT_L, K.SPOUT_LIP);

    // 位置の基準（名目値）
    var spoutTip = this.TX + this.spoutX0Local + K.SPOUT_L;
    this.nomCinX = spoutTip - 0.25 + K.LS - 0.25;
    this.P1X = this.nomCinX + K.P1_OFF;

    // 水受け（名目の形から決める）
    var p3x = this.nomCinX + K.LC + K.P3_OFF;
    var xn = p3x + 0.42;
    this.basin = { cx: xn + 1.7, cz: this.TZ, hx: 1.7, hz: 2.6, rc: 0.7, H: 0.6, floor: 0.055, liner: 0.068, flare: 0.12 };
    this.bowlPos = new T.Vector3(xn + 1.25, 0, this.TZ + 2.6 + 1.25);
    this.zaruPos = new T.Vector3(-4.4, 0, 2.3);
    this.pitcherHome = new T.Vector3(-6.45, 0, 1.3);

    // 支柱 P0（受け皿）、P1、P2、P3
    this.pillars = [];
    for (var k = 0; k < 4; k++) {
      var P = SG.buildPillar(M);
      P.k = k;
      P.state = k === 0 ? 'up' : 'lying';
      P.ang = new SG.Spring(k === 0 ? 0 : 1.5, 70, 7);   // 0=立つ 1.5≒寝る
      P.extS = new SG.Spring(1.05, 260, 16);
      P.yawS = new SG.Spring(0, 90, 6);
      P.squish = 0; P.squishV = 0; P.press = 0;
      P.lieYaw = -Math.PI / 2 + SG.rr(-0.14, 0.14);
      P.bx = 0; P.bz = 0;
      P.hv = 0; // 支える高さ（ゆっくり追う）
      this.group.add(P.group);
      this.pillars.push(P);
    }
    this.pillars[0].saddle.visible = false;
    this.pillars[0].hv = this.base.p0 + this.st.n0 * N;
    this.pillars[1].hv = this.base.p1 + this.st.n1 * N;
    this.pillars[2].hv = this.base.p2 + this.st.n2 * N;
    this.pillars[3].hv = 0; // 落差の量（段数×NOTCH）

    // 樋
    this.troughs = {};
    var defs = { S: K.LS, C: K.LC, E: K.LE };
    for (var id in defs) {
      var tr = {
        id: id, L: defs[id],
        path: new SG.TroughPath(defs[id], K.LIPLEN),
        rigid: new SG.TroughPath(defs[id], K.LIPLEN),
        state: 'lying', hover: 0, hoverV: 0,
        pose: { x: 0, y: K.WALL, z: 0, yaw: 0 },
        lie: { x: 0, y: K.WALL, z: 0, yaw: 0 },
        lastKey: '', lift: 0
      };
      tr.rigid.set(0, 0, 0, id === 'C' ? this.st.theta : 0, 0, 0);
      tr.rigidGeom = SG.buildTroughGeometry(tr.rigid, {});
      tr.worldGeom = null;
      tr.mesh = new T.Mesh(tr.rigidGeom, M.bamboo);
      tr.mesh.castShadow = true; tr.mesh.receiveShadow = true;
      tr.mesh.userData.trough = id;
      this.group.add(tr.mesh);
      this.troughs[id] = tr;
    }
    var yawJ = function () { return SG.rr(-0.1, 0.1); };
    var S = this.troughs.S, C = this.troughs.C, E = this.troughs.E;
    S.lie.yaw = yawJ();
    S.lie.x = -2.35 - Math.cos(S.lie.yaw) * K.LS / 2; S.lie.z = 0.5 - Math.sin(S.lie.yaw) * K.LS / 2;
    C.lie.yaw = -this.st.theta * 0.5 + yawJ();
    C.lie.x = -0.35; C.lie.z = 1.35 - Math.sin(C.lie.yaw + this.st.theta * 0.5) * K.LC * 0.5;
    E.lie.yaw = 0.2 + yawJ();
    E.lie.x = 0.35; E.lie.z = 3.0 - Math.sin(E.lie.yaw) * K.LE * 0.5;
    for (id in this.troughs) {
      var t2 = this.troughs[id];
      t2.pose.x = t2.lie.x; t2.pose.y = t2.lie.y; t2.pose.z = t2.lie.z; t2.pose.yaw = t2.lie.yaw;
    }

    this.d = {}; // 導かれた形
    this.derive(this.st, this.d, true);
    this.applyAll(0, true);
    this.pillars[0].extS.x = this.pillars[0].targetExt;
    for (var kk = 0; kk < 4; kk++) this.pillars[kk].yawS.x = 0;
    this.assembled = false;
    this.anim = []; // 小さな動き
  }

  Course.prototype.trayBottom = function () { return this.pillars[0].hv; };

  // 状態から形を導く（hv は今の見た目の高さ）。useHv=false なら段の目標値から。
  Course.prototype.derive = function (st, d, useHv) {
    var P = this.pillars;
    var yT = useHv ? P[0].hv : this.base.p0 + st.n0 * N;
    var h1 = useHv ? P[1].hv : this.base.p1 + st.n1 * N;
    var h2 = useHv ? P[2].hv : this.base.p2 + st.n2 * N;
    var dropH = useHv ? P[3].hv : st.drop * N;
    d.yT = yT; d.h1 = h1; d.h2 = h2; d.dropH = dropH;
    // 出口
    d.spX0 = this.TX + this.spoutX0Local; d.spZ0 = this.TZ;
    d.spY0 = yT + K.WEIR; d.spG = -0.06;
    d.tipX = d.spX0 + K.SPOUT_L;
    d.ybTip = d.spY0 + d.spG * K.SPOUT_L;
    // 直線
    d.sX0 = d.tipX - st.iS; d.sZ0 = this.TZ;
    var sEnd = d.sX0 + K.LS;
    var CinX = st.CinX !== null ? st.CinX : sEnd - 0.25;
    var CinZ = this.TZ;
    d.CinX = CinX; d.CinZ = CinZ;
    d.iC = sEnd - CinX;
    // カーブ
    d.sP1 = this.P1X - CinX;
    d.sP2 = K.LC - K.LIPLEN - K.P2_BACK;
    d.gC = (h2 - h1) / (d.sP2 - d.sP1);
    d.cY0 = h1 - d.gC * d.sP1;
    var yCiC = d.cY0 + d.gC * d.iC;
    var yEndS = (st.att.C ? yCiC : h1 - K.WALL - 0.004) + K.LIPT;
    var yAtTip = d.ybTip - K.LIPT;
    d.gS = (yEndS - yAtTip) / (K.LS - st.iS);
    d.sY0 = yAtTip - d.gS * st.iS;
    // カーブの口先
    var th = st.theta;
    var rho = Math.abs(th) > 1e-4 ? K.LC / th : 0;
    var tipX, tipZ;
    function cPos(s, o) {
      if (Math.abs(th) <= 1e-4) { o.x = CinX + s; o.z = CinZ; }
      else { var p = th * s / K.LC; o.x = CinX + rho * Math.sin(p); o.z = CinZ - rho * (Math.cos(p) - 1); }
      return o;
    }
    var q = { x: 0, z: 0 };
    cPos(K.LC, q); tipX = q.x; tipZ = q.z;
    d.cTipX = tipX; d.cTipZ = tipZ;
    d.yCtip = d.cY0 + d.gC * K.LC;
    cPos(d.sP2, q); d.p2X = q.x; d.p2Z = q.z; d.p2Yaw = th * d.sP2 / K.LC;
    var dEx = Math.cos(th), dEz = Math.sin(th);
    d.psiE = th;
    d.p3X = tipX + dEx * K.P3_OFF; d.p3Z = tipZ + dEz * K.P3_OFF;
    d.hE3max = d.yCtip - K.LIPT - K.E_SLOPE * K.P3_OFF;
    d.hE3 = d.hE3max - dropH;
    d.eX0 = tipX - dEx * st.iE; d.eZ0 = tipZ - dEz * st.iE;
    d.eY0 = d.hE3 + K.E_SLOPE * (st.iE + K.P3_OFF);
    d.eOutX = d.eX0 + dEx * K.LE; d.eOutZ = d.eZ0 + dEz * K.LE;
    d.eOutY = d.eY0 - K.E_SLOPE * K.LE;
    d.gap = (d.yCtip - K.LIPT) - (d.eY0 - K.E_SLOPE * st.iE);
    // 支柱の受け
    d.cr0 = yT - 0.095 - 0.07; // P0 は受け台の下
    d.cr1 = h1 - K.WALL - 0.004;
    d.cr2 = h2 - K.WALL - 0.004;
    d.cr3 = d.hE3 - K.WALL - 0.004;
    return d;
  };

  Course.prototype.valid = function (st) {
    var d = this.derive(st, {}, false);
    if (d.gS > MIN_G || d.gC > MIN_G) return false;
    if (d.gS < -0.3 || d.gC < -0.3) return false;
    if (st.iS < 0.05 || st.iS > K.SPOUT_LIP - 0.02) return false;
    if (st.att.C && (d.iC < 0.05 || d.iC > K.LIPLEN - 0.02)) return false;
    if (st.iE < 0.05 || st.iE > K.LIPLEN - 0.02) return false;
    var B = this.basin;
    var sd2 = SG.sdRoundRect(d.p2X, d.p2Z, B.cx, B.cz, B.hx, B.hz, B.rc);
    var sd3 = SG.sdRoundRect(d.p3X, d.p3Z, B.cx, B.cz, B.hx, B.hz, B.rc);
    var sdE = SG.sdRoundRect(d.eOutX, d.eOutZ, B.cx, B.cz, B.hx, B.hz, B.rc);
    if (sd2 < 0.36 || sd3 < 0.36) return false;
    if (st.att.C && sdE > -0.3) return false;
    var exts = [d.cr0 - 0.205 + 0.105, d.cr1 - 0.205, d.cr2 - 0.205, d.cr3 - 0.205];
    for (var i = 0; i < 4; i++) if (exts[i] < 1.05 || exts[i] > 2.95) return false;
    if (st.n0 < 0 || st.n1 < 0 || st.n2 < 0 || st.n0 > 9 || st.n1 > 9 || st.n2 > 9) return false;
    if (st.drop < 0 || st.drop > 4) return false;
    return true;
  };

  Course.prototype.cloneSt = function () {
    var s = this.st;
    return { n0: s.n0, n1: s.n1, n2: s.n2, drop: s.drop, iS: s.iS, iE: s.iE, theta: s.theta, CinX: s.CinX, CinZ: s.CinZ, att: { S: s.att.S, C: s.att.C, E: s.att.E } };
  };
  Course.prototype.tryChange = function (f) {
    var s = this.cloneSt();
    f(s);
    if (!this.valid(s)) return false;
    this.st = s;
    return true;
  };

  // ---- 形の反映 ----
  Course.prototype.applyAll = function (dt, force) {
    var d = this.derive(this.st, this.d, true);
    var st = this.st;
    // 受け皿
    this.tray.group.position.set(this.TX, d.yT, this.TZ);
    this.spoutPath.set(d.spX0, d.spZ0, 0, 0, d.spY0, d.spG);
    // 支柱の置き場所
    var P = this.pillars;
    P[0].bx = this.TX; P[0].bz = this.TZ;
    P[1].bx = this.P1X; P[1].bz = this.TZ;
    P[2].bx = d.p2X; P[2].bz = d.p2Z;
    P[3].bx = d.p3X; P[3].bz = d.p3Z;
    var crs = [d.cr0, d.cr1, d.cr2, d.cr3];
    var yaws = [0, 0, d.p2Yaw, d.psiE];
    for (var k = 0; k < 4; k++) {
      var p = P[k];
      p.targetExt = k === 0 ? crs[0] - 0.10 : crs[k] - p.HEAD_H;
      p.targetYaw = yaws[k];
    }
    // 樋
    var S = this.troughs.S, C = this.troughs.C, E = this.troughs.E;
    if (st.att.S || S.state === 'snapped' || S.state === 'seating') {
      var gS = d.gS, y0S = d.sY0;
      if (S.state !== 'attached') { var pv = st.iS; gS += S.hover / (K.LS - pv); y0S = (d.sY0 + d.gS * pv) - gS * pv; }
      S.path.set(d.sX0, d.sZ0, 0, 0, y0S, gS);
    }
    if (st.att.C || C.state === 'snapped' || C.state === 'seating') {
      var gC = d.gC, y0C = d.cY0;
      if (C.state !== 'attached') { var pv2 = d.iC; gC += C.hover / (K.LC - pv2); y0C = (d.cY0 + d.gC * pv2) - gC * pv2; }
      C.path.set(d.CinX, d.CinZ, 0, st.theta, y0C, gC);
    }
    if (st.att.E || E.state === 'snapped' || E.state === 'seating') {
      var gE = -K.E_SLOPE, y0E = d.eY0;
      if (E.state !== 'attached') { var pv3 = st.iE; gE += E.hover / (K.LE - pv3); y0E = (d.eY0 + (-K.E_SLOPE) * pv3) - gE * pv3; }
      E.path.set(d.eX0, d.eZ0, d.psiE, 0, y0E, gE);
    }
    for (var id in this.troughs) this._updateTroughMesh(this.troughs[id]);
  };

  Course.prototype._updateTroughMesh = function (tr) {
    var worldMode = tr.state === 'attached' || tr.state === 'snapped' || tr.state === 'seating';
    if (worldMode) {
      var p = tr.path;
      var key = [p.x0, p.z0, p.psi0, p.theta, p.y0, p.g].map(function (v) { return v.toFixed(4); }).join(',');
      if (!tr.worldGeom) { tr.worldGeom = SG.buildTroughGeometry(p, {}); tr.lastKey = key; }
      else if (key !== tr.lastKey) { SG.updateTroughGeometry(tr.worldGeom, p, {}); tr.lastKey = key; this.version++; }
      if (tr.mesh.geometry !== tr.worldGeom) tr.mesh.geometry = tr.worldGeom;
      tr.mesh.position.set(0, tr.lift, 0);
      tr.mesh.rotation.set(0, 0, 0);
    } else {
      if (tr.mesh.geometry !== tr.rigidGeom) tr.mesh.geometry = tr.rigidGeom;
      tr.mesh.position.set(tr.pose.x, tr.pose.y, tr.pose.z);
      tr.mesh.rotation.set(0, -tr.pose.yaw, 0);
    }
  };

  // 付ける先（xz と高さ）
  Course.prototype.attachTarget = function (id) {
    var d = this.d;
    if (id === 'S') return { x: d.tipX, y: d.ybTip, z: this.TZ, yaw: 0, ready: this.pillars[1].state === 'up' };
    if (id === 'C') return { x: d.sX0 + K.LS, y: d.sY0 + d.gS * K.LS, z: this.TZ, yaw: 0, ready: this.st.att.S && this.troughs.S.state === 'attached' && this.pillars[2].state === 'up' };
    if (id === 'E') return { x: d.cTipX, y: d.yCtip, z: d.cTipZ, yaw: d.psiE, ready: this.st.att.C && this.troughs.C.state === 'attached' && this.pillars[3].state === 'up' };
    return null;
  };

  // ---- 支柱：触れる・起こす・伸び縮み ----
  Course.prototype.tapPillar = function (k, camYaw) {
    var p = this.pillars[k];
    if (p.state === 'lying') {
      p.state = 'up';
      p.ang.target = 0;
      p.ang.kick(-1.2);
      p.yawS.x = camYaw - p.targetYaw; // 一度こちらを向く
      p.yawS.target = 0;
      p.riseT = 0;
      SG.events.emit('pillarRise', k);
      return true;
    }
    p.squishV += 6;
    p.yawS.kick(2.0);
    SG.events.emit('pillarTouch', k);
    return false;
  };

  // dy（ワールドの高さ方向の指の移動）を段に変える。戻り値：段が動いたか
  Course.prototype.pillarPush = function (k, accum) {
    var p = this.pillars[k];
    if (p.state !== 'up') return { moved: 0, accum: accum };
    var thr = N * 0.65;
    var moved = 0;
    var self = this;
    while (Math.abs(accum) > thr) {
      var dir = accum > 0 ? 1 : -1;
      var ok = this.tryChange(function (s) {
        if (k === 0) s.n0 += dir;
        else if (k === 1) s.n1 += dir;
        else if (k === 2) {
          s.n2 += dir;
        } else s.drop -= dir; // 下げると落差が増える
      });
      if (!ok) { accum = dir * thr; break; }
      accum -= dir * N;
      moved += dir;
      SG.events.emit('notch', k, dir);
    }
    // 押した分だけ根元の滑り止めがへこむ
    p.press = SG.clamp(-accum / thr, 0, 1);
    return { moved: moved, accum: accum };
  };
  Course.prototype.pillarRelease = function (k) {
    var p = this.pillars[k];
    p.press = 0;
    p.extS.kick(0.55); // 鞍が一度だけ小さくはね返る
    SG.events.emit('pillarRelease', k);
  };

  // ---- 樋：持つ・近づける・差し込む・載せる ----
  Course.prototype.troughGrab = function (id, hit) {
    var tr = this.troughs[id];
    var st = this.st;
    tr.grab = { x: hit.x, y: hit.y, z: hit.z };
    if (tr.state === 'attached') {
      tr.adj = { iS: st.iS, iE: st.iE, theta: st.theta, sx: hit.x, sz: hit.z };
      tr.lift = 0.04;
      SG.events.emit('troughLift', id);
      return 'adjust';
    }
    if (tr.state === 'lying' || tr.state === 'returning') {
      // どこを持ったか（樋の長さ方向）
      var loc = {};
      var rp = tr.rigid;
      var dx = hit.x - tr.pose.x, dz = hit.z - tr.pose.z;
      var c = Math.cos(tr.pose.yaw), s = Math.sin(tr.pose.yaw);
      var lx = dx * c + dz * s, lz = -dx * s + dz * c;
      rp.locate(lx, 0, lz, loc);
      tr.grabS = SG.clamp(loc.s, 0.2, tr.L - 0.2);
      tr.state = 'held';
      SG.events.emit('troughLift', id);
      return 'carry';
    }
    return null;
  };

  // fp: 指の示すワールド点（水平面 y=planeY 上）
  Course.prototype.troughMove = function (id, fp, dt) {
    var tr = this.troughs[id];
    var st = this.st;
    var tgt = this.attachTarget(id);
    if (tr.state === 'attached' && tr.adj) {
      var a = tr.adj;
      if (id === 'S') {
        var ds = (fp.x - a.sx);
        this.tryChange(function (s) { s.iS = SG.clamp(a.iS - ds, 0.05, K.SPOUT_LIP - 0.02); });
      } else if (id === 'E') {
        var dEx = Math.cos(st.theta), dEz = Math.sin(st.theta);
        var de = (fp.x - a.sx) * dEx + (fp.z - a.sz) * dEz;
        this.tryChange(function (s) { s.iE = SG.clamp(a.iE - de, 0.05, K.LIPLEN - 0.02); });
      } else if (id === 'C') {
        var vx = fp.x - this.d.CinX, vz = fp.z - this.d.CinZ;
        var phi = Math.atan2(vz, Math.max(0.5, vx));
        var want = SG.clamp(phi * 2, -0.62, 0.62);
        var cur = st.theta;
        // 少しずつ近づけ、だめな所で止まる
        var stepN = 8;
        for (var i = 1; i <= stepN; i++) {
          var th = cur + (want - cur) * i / stepN;
          if (!this.tryChange(function (s) { s.theta = th; })) break;
        }
      }
      return;
    }
    if (tr.state === 'held') {
      var yawT = tgt ? tgt.yaw : tr.pose.yaw;
      tr.pose.yaw = SG.damp(tr.pose.yaw, yawT, 6, dt);
      var hy = tgt ? tgt.y + 0.3 : 1.2;
      tr.pose.y = SG.damp(tr.pose.y, hy, 7, dt);
      var c = Math.cos(tr.pose.yaw), s2 = Math.sin(tr.pose.yaw);
      // 持った点が指の下に
      var gx = tr.grabS, gz = 0;
      if (id === 'C') { var lp = {}; tr.rigid.posXZ(tr.grabS, lp); gx = lp.x; gz = lp.z; }
      var wx = gx * c - gz * s2, wz = gx * s2 + gz * c;
      tr.pose.x = fp.x - wx; tr.pose.z = fp.z - wz;
      if (tgt && tgt.ready) {
        var ddx = tr.pose.x - tgt.x, ddz = tr.pose.z - tgt.z;
        if (ddx * ddx + ddz * ddz < 1.6 * 1.6) {
          tr.state = 'snapped';
          tr.hover = 0.32;
          tr.snapFp = { x: fp.x, z: fp.z };
          tr.snapBase = id === 'S' ? st.iS : (id === 'C' ? 0.25 : st.iE);
          if (id === 'C') this.st.CinX = this.d.sX0 + K.LS - 0.25;
          if (id === 'C') this.st.CinZ = this.TZ;
          this._setAtt(id, true, true);
          SG.events.emit('troughSnap', id);
        }
      }
      return;
    }
    if (tr.state === 'snapped') {
      var dirx = Math.cos(tgt.yaw), dirz = Math.sin(tgt.yaw);
      var along = (fp.x - tr.snapFp.x) * dirx + (fp.z - tr.snapFp.z) * dirz;
      var lat = -(fp.x - tr.snapFp.x) * dirz + (fp.z - tr.snapFp.z) * dirx;
      var far = Math.abs(along) > 1.9 || Math.abs(lat) > 1.9;
      if (far) {
        // 外して、また持つ
        this._setAtt(id, false, true);
        if (id === 'C') { this.st.CinX = null; this.st.CinZ = null; }
        tr.state = 'held';
        SG.events.emit('troughUnsnap', id);
        return;
      }
      var ins = SG.clamp(tr.snapBase - along, 0.06, (id === 'S' ? K.SPOUT_LIP : K.LIPLEN) - 0.03);
      var self = this;
      if (id === 'S') this.tryChange(function (s) { s.iS = ins; });
      else if (id === 'E') this.tryChange(function (s) { s.iE = ins; });
      else if (id === 'C') this.tryChange(function (s) { s.CinX = self.d.sX0 + K.LS - ins; });
      // 指が支柱へ寄るほど低く
      tr.hover = SG.damp(tr.hover, 0.22, 3, dt);
    }
  };

  Course.prototype._setAtt = function (id, v, soft) {
    var s = this.cloneSt();
    s.att[id] = v;
    this.st = s;
  };

  Course.prototype.troughRelease = function (id) {
    var tr = this.troughs[id];
    if (tr.state === 'attached') {
      tr.lift = 0;
      tr.adj = null;
      SG.events.emit('troughSeat', id, tr.L);
      var pk = id === 'S' ? 1 : (id === 'C' ? 2 : 3);
      this.pillars[pk].squishV += 4;
      return;
    }
    if (tr.state === 'snapped') {
      tr.state = 'seating';
      tr.hoverV = 0;
      return;
    }
    if (tr.state === 'held') {
      tr.state = 'returning';
      SG.events.emit('troughDrop', id);
    }
  };

  // ---- 毎コマ ----
  Course.prototype.update = function (dt, camYaw) {
    var st = this.st;
    var P = this.pillars;
    // 支える高さ：目標へ
    var tgt = [this.base.p0 + st.n0 * N, this.base.p1 + st.n1 * N, this.base.p2 + st.n2 * N, st.drop * N];
    var moving = false;
    for (var k = 0; k < 4; k++) {
      var nv = SG.damp(P[k].hv, tgt[k], 14, dt);
      if (Math.abs(nv - tgt[k]) < 1e-4) nv = tgt[k];
      if (nv !== P[k].hv) moving = true;
      P[k].hv = nv;
    }
    // 樋の載る動き
    for (var id in this.troughs) {
      var tr = this.troughs[id];
      if (tr.state === 'seating') {
        tr.hoverV -= 9.0 * dt;
        tr.hover += tr.hoverV * dt;
        if (tr.hover <= 0) {
          tr.hover = 0; tr.state = 'attached';
          var pk = id === 'S' ? 1 : (id === 'C' ? 2 : 3);
          P[pk].squishV += 7;
          P[pk].extS.kick(-0.5);
          SG.events.emit('troughSeat', id, tr.L);
          if (id === 'C') this.troughs.S.lastKey = '';
          this._checkAssembled();
        }
      } else if (tr.state === 'returning') {
        var l = tr.lie, p = tr.pose;
        p.x = SG.damp(p.x, l.x, 5, dt); p.z = SG.damp(p.z, l.z, 5, dt);
        p.y = SG.damp(p.y, l.y, 5, dt); p.yaw = SG.damp(p.yaw, l.yaw, 5, dt);
        if (Math.abs(p.x - l.x) + Math.abs(p.z - l.z) + Math.abs(p.y - l.y) < 0.01) {
          p.x = l.x; p.y = l.y; p.z = l.z; p.yaw = l.yaw;
          tr.state = 'lying';
          SG.events.emit('troughSeat', id, tr.L * 0.6);
        }
      }
    }
    this.applyAll(dt);
    // 支柱の見た目
    for (var k2 = 0; k2 < 4; k2++) {
      var pl = P[k2];
      pl.group.position.set(pl.bx, 0, pl.bz);
      var up = pl.state === 'up';
      pl.ang.step(dt);
      if (up && pl.ang.x < 0) { pl.ang.x = -pl.ang.x * 0.3; pl.ang.v = -pl.ang.v * 0.3; }
      var ext = up ? pl.targetExt : 1.05;
      pl.extS.target = ext;
      pl.extS.step(dt);
      // 寝ている間は短く、起きながら伸びる
      var rise = SG.clamp(1 - pl.ang.x / 1.5, 0, 1);
      var e = up ? SG.lerp(1.05, pl.extS.x, SG.smooth(0.4, 1, rise)) : 1.05;
      pl.setExt(e);
      // 寝る向き
      pl.group.rotation.y = 0;
      var lieA = Math.min(pl.ang.x, 1.52);
      var lyaw = pl.lieYaw;
      pl.pivot.rotation.set(0, 0, 0);
      pl.pivot.rotation.order = 'YXZ';
      pl.pivot.rotation.y = -lyaw + Math.PI / 2;
      pl.pivot.rotation.x = lieA;
      // 鞍の向き（ワールドの yaw を打ち消す）
      pl.yawS.step(dt);
      pl.saddleYaw.rotation.y = -(pl.targetYaw + pl.yawS.x) - pl.pivot.rotation.y;
      if (!up) pl.saddleYaw.rotation.y = 0;
      // 滑り止めのへこみ
      pl.squishV -= pl.squish * 160 * dt;
      pl.squishV *= Math.exp(-10 * dt);
      pl.squish += pl.squishV * dt;
      var sq = SG.clamp(Math.max(pl.squish * 0.05, pl.press * 0.6), -0.2, 0.7);
      pl.rubber.scale.set(1 + sq * 0.25, 1 - sq * 0.45, 1 + sq * 0.25);
      pl.col.position.y = 0.06 - sq * 0.027;
      pl.pivot.position.y = 0.04 + (1 - Math.cos(lieA)) * 0.035;
    }
    return moving;
  };

  Course.prototype._checkAssembled = function () {
    var t = this.troughs;
    if (!this.assembled && t.S.state === 'attached' && t.C.state === 'attached' && t.E.state === 'attached') {
      this.assembled = true;
      SG.events.emit('assembled');
    }
  };

  // 次の組み立て手順
  Course.prototype.nextStep = function () {
    var P = this.pillars, t = this.troughs;
    if (P[1].state !== 'up') return { kind: 'pillar', k: 1 };
    if (t.S.state !== 'attached') return { kind: 'trough', id: 'S' };
    if (P[2].state !== 'up') return { kind: 'pillar', k: 2 };
    if (t.C.state !== 'attached') return { kind: 'trough', id: 'C' };
    if (P[3].state !== 'up') return { kind: 'pillar', k: 3 };
    if (t.E.state !== 'attached') return { kind: 'trough', id: 'E' };
    return null;
  };

  // 物の代表点（導きの光や手本の指のため）
  Course.prototype.pillarHead = function (k, out) {
    var p = this.pillars[k];
    p.head.updateWorldMatrix(true, false);
    return p.head.getWorldPosition(out);
  };
  Course.prototype.troughCenter = function (id, out) {
    var tr = this.troughs[id];
    if (tr.state === 'attached' || tr.state === 'snapped' || tr.state === 'seating') {
      tr.path.axis(tr.L * 0.5, out);
      return out;
    }
    var q = {};
    tr.rigid.posXZ(tr.L * 0.5, q);
    var c = Math.cos(tr.pose.yaw), s = Math.sin(tr.pose.yaw);
    out.set(tr.pose.x + q.x * c - q.z * s, tr.pose.y + K.R * 0.5, tr.pose.z + q.x * s + q.z * c);
    return out;
  };

  // 物理用：今つながっている水路
  Course.prototype.activePaths = function () {
    var out = [this.spoutPath];
    var t = this.troughs;
    if (t.S.state === 'attached' || t.S.state === 'seating' || t.S.state === 'snapped') out.push(t.S.path);
    if (t.C.state === 'attached' || t.C.state === 'seating' || t.C.state === 'snapped') out.push(t.C.path);
    if (t.E.state === 'attached' || t.E.state === 'seating' || t.E.state === 'snapped') out.push(t.E.path);
    return out;
  };

  SG.Course = Course;
})();
