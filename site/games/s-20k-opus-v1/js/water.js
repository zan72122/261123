/* water.js — 水の流れ：受け皿にたまり、堰を越え、樋の形に沿って順に伝わり、水受けへ落ちる */
(function () {
  'use strict';
  var SG = window.SG;
  var K = SG.K;

  var WK = SG.WK = {
    KV: 85,           // 流速の係数
    A_EXP: 0.5,      // 深さの効き
    B_EXP: 1.0,      // 傾きの効き
    TAU0: 0.4, TAU1: 1.0,
    CW: 0.9,         // 堰の係数
    CW_EXP: 1.5,
    POUR_MAX: 0.55,  // L/s
    DROP_GAIN: 0.4,  // 段差で落ちた水の勢い
    AEPS: 1e-5
  };

  function Channel(name, path) {
    this.name = name;
    this.path = path;
    this.n = Math.max(4, Math.ceil(path.L / 0.1));
    this.dx = path.L / this.n;
    var n = this.n;
    this.A = new Float32Array(n);
    this.v = new Float32Array(n);
    this.h = new Float32Array(n);
    this.yb = new Float32Array(n);
    this.vq = new Float32Array(n);   // 見た目用の流速（なめらか）
    this.tmp = new Float32Array(n);
    this.F = new Float32Array(n + 1);
    this.outV = 0; this.outQ = 0; this.outQs = 0;
    this.enabled = false;
    this.joinIdx = 0; this.vin = 0; this.inVol = 0; this.inVolPrev = 0;
  }
  Channel.prototype.updateBed = function () {
    for (var i = 0; i < this.n; i++) this.yb[i] = this.path.y((i + 0.5) * this.dx);
  };
  Channel.prototype.volume = function () {
    var s = 0; for (var i = 0; i < this.n; i++) s += this.A[i];
    return s * this.dx;
  };
  // s での深さ・流速
  Channel.prototype.sample = function (s, out) {
    var x = s / this.dx - 0.5;
    var i = Math.floor(x), f = x - i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= this.n - 1) { i = this.n - 2; f = 1; }
    if (s < 0 || s > this.path.L) { out.h = 0; out.v = 0; return out; }
    out.h = this.h[i] * (1 - f) + this.h[i + 1] * f;
    out.v = this.v[i] * (1 - f) + this.v[i + 1] * f;
    return out;
  };
  // 水を足す（s の位置、v の速さで）
  Channel.prototype.addAt = function (s, vol, vin) {
    var i = SG.clamp(Math.floor(s / this.dx), 0, this.n - 1);
    var dA = vol / this.dx;
    var A0 = this.A[i];
    this.joinIdx = i;
    this.inVol += vol;
    this.vin = this.inVol > 0 ? (this.vin * (this.inVol - vol) + vin * vol) / this.inVol : vin;
    this.A[i] = A0 + dA;
    if (A0 + dA > 0) this.v[i] = (A0 * this.v[i] + dA * vin) / (A0 + dA);
  };

  Channel.prototype.step = function (dt) {
    var n = this.n, A = this.A, v = this.v, h = this.h, yb = this.yb, dx = this.dx, F = this.F, tmp = this.tmp;
    var i;
    var ji = this.joinIdx, hasIn = this.inVolPrev > 0 || this.inVol > 0;
    var vin = this.vin;
    this.inVolPrev = this.inVol; this.inVol = 0;
    for (i = 0; i < n; i++) h[i] = SG.depthFromArea(A[i]);
    // 流速：上流から運ばれた勢い＋その場の傾きでの釣り合いへ
    for (i = 0; i < n; i++) {
      var S;
      if (i === 0) S = (yb[0] + h[0] - yb[1] - h[1]) / dx;
      else if (i === n - 1) S = Math.max((yb[n - 2] + h[n - 2] - yb[n - 1] - h[n - 1]) / dx, (yb[n - 2] - yb[n - 1]) / dx);
      else S = (yb[i - 1] + h[i - 1] - yb[i + 1] - h[i + 1]) / (2 * dx);
      var hh = h[i];
      var veq = 0;
      if (hh > 1e-4) veq = WK.KV * Math.pow(hh, WK.A_EXP) * (S >= 0 ? Math.pow(S, WK.B_EXP) : -Math.pow(-S, WK.B_EXP) * 0.6);
      var vb = v[i];
      var xb = i - vb * dt / dx;
      var adv;
      if (hasIn && i >= ji && xb < ji + 0.5) adv = vin;
      else if (xb <= 0) adv = v[0];
      else if (xb >= n - 1) adv = v[n - 1];
      else { var j = Math.floor(xb), f = xb - j; adv = v[j] * (1 - f) + v[j + 1] * f; }
      if (A[i] < WK.AEPS) { tmp[i] = veq; continue; }
      var tau = WK.TAU0 + WK.TAU1 * hh / (hh + 0.05);
      tmp[i] = adv + (veq - adv) * (1 - Math.exp(-dt / tau));
      if (tmp[i] > 9) tmp[i] = 9;
      if (tmp[i] < -2) tmp[i] = -2;
    }
    for (i = 0; i < n; i++) v[i] = tmp[i];
    // 面の流れ
    F[0] = 0;
    for (i = 1; i < n; i++) {
      var vf = 0.5 * (v[i - 1] + v[i]);
      var Au = vf > 0 ? A[i - 1] : A[i];
      F[i] = Au * vf * dt;
    }
    F[n] = Math.max(0, v[n - 1]) * A[n - 1] * dt;
    // 出すぎないように
    for (i = 0; i < n; i++) {
      var out = Math.max(0, F[i + 1]) + Math.max(0, -F[i]);
      var cap = 0.9 * A[i] * dx;
      if (out > cap && out > 0) {
        var k = cap / out;
        if (F[i + 1] > 0) F[i + 1] *= k;
        if (F[i] < 0) F[i] *= k;
      }
    }
    for (i = 0; i < n; i++) {
      A[i] += (F[i] - F[i + 1]) / dx;
      if (A[i] < 0) A[i] = 0;
    }
    var outVol = F[n];
    this.outV = Math.max(0.05, v[n - 1]);
    return outVol;
  };

  // ---- 全体 ----
  function Water(course) {
    this.course = course;
    var tr = course.troughs;
    this.ch = {
      spout: new Channel('spout', course.spoutPath),
      S: new Channel('S', tr.S.path),
      C: new Channel('C', tr.C.path),
      E: new Channel('E', tr.E.path)
    };
    this.ch.spout.enabled = true;
    this.order = ['spout', 'S', 'C', 'E'];
    this.trayV = 0;
    this.trayArea = Math.PI * K.TRAY_R * K.TRAY_R;
    this.trayFilmV = this.trayArea * 0.012;
    this.trayQ = 0;
    this.pourQ = 0;
    this.basinV = 0;
    var B = course.basin;
    this.basinArea = (2 * B.hx) * (2 * B.hz) - (4 - Math.PI) * B.rc * B.rc;
    this.basinLevel = B.liner;
    this.endQ = 0; this.endQs = 0; this.endV = 0;
    this.joint = { spout: { gap: 0, q: 0, v: 0 }, S: { gap: 0, q: 0, v: 0 }, C: { gap: 0, q: 0, v: 0 } };
    this.time = 0;
    this.spill = 0;
  }

  Water.prototype.trayLevel = function () {
    if (this.trayV < this.trayFilmV) return 0.012 * Math.sqrt(this.trayV / this.trayFilmV);
    return this.trayV / this.trayArea;
  };
  Water.prototype.trayPuddleR = function () {
    if (this.trayV < this.trayFilmV) return K.TRAY_R * Math.sqrt(this.trayV / this.trayFilmV);
    return K.TRAY_R - 0.005;
  };

  // つなぎ目：上の樋の口先が、下の樋のどこに落ちるか
  Water.prototype._links = function () {
    var c = this.course, st = c.st, d = c.d, t = c.troughs;
    var links = [];
    var att = function (id) { return t[id].state === 'attached' || t[id].state === 'seating' || t[id].state === 'snapped'; };
    if (att('S')) links.push({ up: 'spout', down: 'S', s: st.iS });
    if (att('S') && att('C')) links.push({ up: 'S', down: 'C', s: d.iC });
    if (att('C') && att('E')) links.push({ up: 'C', down: 'E', s: st.iE });
    return links;
  };

  Water.prototype.step = function (dtReal) {
    var dt = dtReal * K.TS;
    this.time += dt;
    var c = this.course, t = c.troughs;
    this.ch.S.enabled = t.S.state === 'attached' || t.S.state === 'seating' || t.S.state === 'snapped';
    this.ch.C.enabled = t.C.state === 'attached' || t.C.state === 'seating' || t.C.state === 'snapped';
    this.ch.E.enabled = t.E.state === 'attached' || t.E.state === 'seating' || t.E.state === 'snapped';
    for (var o = 0; o < 4; o++) { var chn = this.ch[this.order[o]]; if (chn.enabled) chn.updateBed(); }
    var links = this._links();
    var linkOf = {};
    for (var l = 0; l < links.length; l++) {
      var lk = links[l];
      var up = this.ch[lk.up].path, dn = this.ch[lk.down].path;
      var gap = up.y(up.L) - dn.y(lk.s) - K.LIPT;
      lk.gap = Math.max(0, gap);
      linkOf[lk.up] = lk;
      this.joint[lk.up].gap = lk.gap;
    }
    var nsub = Math.max(1, Math.ceil(dt / 0.005));
    var h = dt / nsub;
    var endVol = 0, jointVol = { spout: 0, S: 0, C: 0 }, jointV = { spout: 0, S: 0, C: 0 };
    var trayOut = 0;
    for (var k = 0; k < nsub; k++) {
      // 受け皿
      this.trayV += this.pourQ * h;
      var cap = this.trayArea * (K.TRAY_DEPTH - 0.04);
      if (this.trayV > cap) this.trayV = cap;
      var H = this.trayLevel();
      var over = H - K.WEIR;
      var qw = over > 0 ? WK.CW * Math.pow(over, WK.CW_EXP) : 0;
      var vol = Math.min(qw * h, Math.max(0, this.trayV - this.trayArea * K.WEIR));
      this.trayV -= vol;
      trayOut += vol;
      this.ch.spout.addAt(0.02, vol, 0.4);
      // 樋
      for (var oi = 0; oi < 4; oi++) {
        var name = this.order[oi];
        var ch = this.ch[name];
        if (!ch.enabled) continue;
        var outV = ch.step(h);
        var lk2 = linkOf[name];
        if (outV > 0) {
          if (lk2 && this.ch[lk2.down].enabled) {
            var vin = Math.sqrt(ch.outV * ch.outV + 2 * K.G * lk2.gap * WK.DROP_GAIN);
            this.ch[lk2.down].addAt(lk2.s, outV, vin);
            jointVol[name] += outV; jointV[name] = ch.outV;
          } else if (name === 'E' || (!lk2)) {
            if (name === 'E') { endVol += outV; this.endV = ch.outV; }
            else this.spill += outV; // 組み立て途中にこぼれた分（使わない）
          }
        }
      }
    }
    this.trayQ = trayOut / dt;
    this.endQ = endVol / dt;
    this.endQs = SG.damp(this.endQs, this.endQ, 6, dtReal);
    for (var j in jointVol) {
      this.joint[j].q = jointVol[j] / dt;
      this.joint[j].v = jointV[j];
    }
    this.basinV += endVol + (this.spill > 0 ? 0 : 0);
    this.spill = 0;
    var B = c.basin;
    var lvl = B.liner + this.basinV / this.basinArea;
    var maxL = B.liner + 0.3;
    if (lvl > maxL) { lvl = maxL; this.basinV = (maxL - B.liner) * this.basinArea; }
    this.basinLevel = lvl;
    // 見た目用の流速
    for (var o2 = 0; o2 < 4; o2++) {
      var cc = this.ch[this.order[o2]];
      for (var i = 0; i < cc.n; i++) cc.vq[i] = SG.damp(cc.vq[i], cc.v[i], 5, dtReal);
    }
  };

  // 粒の場所から水を調べる：戻り値 {h, v, yb, surf, path, s, ch}
  Water.prototype.channelFor = function (path) {
    for (var o = 0; o < 4; o++) { var c = this.ch[this.order[o]]; if (c.path === path) return c; }
    return null;
  };

  Water.prototype.totalInChannels = function () {
    var s = 0;
    for (var o = 0; o < 4; o++) { var c = this.ch[this.order[o]]; if (c.enabled) s += c.volume(); }
    return s;
  };

  SG.Channel = Channel;
  SG.Water = Water;
})();
