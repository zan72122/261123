/* util.js — 共通の数学・乱数・定数 */
(function () {
  'use strict';
  var SG = (window.SG = window.SG || {});
  var T = THREE;

  // ---- 定数（1 = 10cm） ----
  SG.K = {
    R: 0.40,          // 樋の内半径
    WALL: 0.045,      // 樋の肉厚
    LIPT: 0.012,      // 口の厚み
    LIPLEN: 0.42,     // 口の長さ
    LS: 3.6,          // 直線の樋
    LC: 3.0,          // カーブの樋
    LE: 2.0,          // 末端の短い樋
    SPOUT_L: 0.62,    // 受け皿の短い出口
    SPOUT_LIP: 0.30,
    NOTCH: 0.15,      // 支柱の一段
    G: 70,            // 重力（少しゆっくりの世界）
    TS: 0.66,         // 時間の流れ
    TRAY_R: 1.15,
    TRAY_DEPTH: 0.55,
    WEIR: 0.085,      // 堰の高さ（受け皿の底から）
    E_SLOPE: Math.tan(3.5 * Math.PI / 180),
    P3_OFF: 0.40,     // カーブの口先から末端の支柱まで
    P1_OFF: 0.25,     // カーブの入口から中央の支柱まで
    P2_BACK: 0.15,    // カーブの口の付け根から支柱まで
    NOODLE_R: 0.018,  // 麺の当たり半径
    NOODLE_DRAW_R: 0.015,
    SEG: 0.1          // 麺の節の長さ
  };

  SG.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  SG.lerp = function (a, b, t) { return a + (b - a) * t; };
  SG.smooth = function (e0, e1, x) {
    var t = SG.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  SG.damp = function (a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); };
  SG.dampV3 = function (v, target, lambda, dt) { return v.lerp(target, 1 - Math.exp(-lambda * dt)); };
  SG.wrapAngle = function (a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  // ---- 乱数（遊び始めるたびに少し変わる） ----
  var seed = ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 4294967295)) >>> 0;
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SG.seed = seed;
  SG.rand = mulberry32(seed);
  SG.rr = function (a, b) { return a + (b - a) * SG.rand(); };
  SG.rsign = function () { return SG.rand() < 0.5 ? -1 : 1; };

  // ---- ばね ----
  SG.Spring = function (x, k, c) { this.x = x; this.v = 0; this.k = k; this.c = c; this.target = x; };
  SG.Spring.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / 0.008));
    var h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = this.k * (this.target - this.x) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  };
  SG.Spring.prototype.kick = function (v) { this.v += v; };

  SG.dirFromPsi = function (psi, out) { return (out || new T.Vector3()).set(Math.cos(psi), 0, Math.sin(psi)); };

  // 角丸長方形の符号付き距離（xz）
  SG.sdRoundRect = function (px, pz, cx, cz, hx, hz, r) {
    var qx = Math.abs(px - cx) - (hx - r), qz = Math.abs(pz - cz) - (hz - r);
    var ox = Math.max(qx, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - r;
  };
  SG.sdRoundRectGrad = function (px, pz, cx, cz, hx, hz, r, out) {
    var e = 0.002;
    var gx = SG.sdRoundRect(px + e, pz, cx, cz, hx, hz, r) - SG.sdRoundRect(px - e, pz, cx, cz, hx, hz, r);
    var gz = SG.sdRoundRect(px, pz + e, cx, cz, hx, hz, r) - SG.sdRoundRect(px, pz - e, cx, cz, hx, hz, r);
    var l = Math.sqrt(gx * gx + gz * gz) || 1;
    out.x = gx / l; out.z = gz / l;
    return out;
  };

  SG.makeCanvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  // 小さな値ノイズ（1D）
  SG.noise1 = function (x) {
    var i = Math.floor(x), f = x - i;
    function h(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
    var u = f * f * (3 - 2 * f);
    return SG.lerp(h(i), h(i + 1), u);
  };

  // 角丸長方形の輪郭点列
  SG.roundRectPath = function (cx, cz, hx, hz, r, nCorner) {
    var pts = [];
    var cs = [[cx + hx - r, cz + hz - r, 0], [cx - hx + r, cz + hz - r, Math.PI / 2],
              [cx - hx + r, cz - hz + r, Math.PI], [cx + hx - r, cz - hz + r, Math.PI * 1.5]];
    for (var c = 0; c < 4; c++) {
      for (var i = 0; i <= nCorner; i++) {
        var a = cs[c][2] + (i / nCorner) * Math.PI / 2;
        pts.push({ x: cs[c][0] + Math.cos(a) * r, z: cs[c][1] + Math.sin(a) * r, nx: Math.cos(a), nz: Math.sin(a) });
      }
    }
    return pts;
  };

  // イベント（ゆるい連絡網）
  SG.events = {
    _h: {},
    on: function (n, f) { (this._h[n] = this._h[n] || []).push(f); },
    emit: function (n, a, b, c) {
      var l = this._h[n]; if (!l) return;
      for (var i = 0; i < l.length; i++) l[i](a, b, c);
    }
  };

  SG.tmpV = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
})();
