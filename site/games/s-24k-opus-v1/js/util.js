/* util.js — 共有名前空間・数学ユーティリティ・卓上レイアウト（単位: cm, 卓面 y=0） */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  // ---- 乱数（遊ぶたびに少し違う卓上） ----
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }
  G.seed = (Date.now() ^ ((Math.random() * 1e9) | 0)) >>> 0;
  G.rand = makeRng(G.seed);
  G.makeRng = makeRng;
  G.rr = function (a, b) { return a + (b - a) * G.rand(); };

  // ---- 数学 ----
  const M = (G.M = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smooth: (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); },
    easeOut: (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - (1 - t) * (1 - t) * (1 - t); },
    easeInOut: (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    // フレームレート非依存の減衰補間係数
    damp: (k, dt) => 1 - Math.exp(-k * dt),
    angLerp: (a, b, t) => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    },
    dist2: (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },
  });

  // バネ（臨界減衰に近い2次系）
  G.Spring = class {
    constructor(v, k, d) { this.v = v; this.t = v; this.vel = 0; this.k = k || 120; this.d = d || 14; }
    step(dt) {
      const a = this.k * (this.t - this.v) - this.d * this.vel;
      this.vel += a * dt; this.v += this.vel * dt; return this.v;
    }
    snap(v) { this.v = this.t = v; this.vel = 0; }
  };

  // ---- 卓上レイアウト ----
  const L = (G.L = {});
  L.TUBE = { x0: -10, x1: 10, y: 12, z: 0, inner: 5.0, outer: 6.4, slotX0: -8, slotX1: 8, slotW: 2.2 };
  L.FRAME = { x0: 10.0, x1: 10.8, size: 7.2, raise: 3.6 };
  L.EXIT_X = 10.8;            // 格子の外面
  L.GRID_N = 4;                // 4×4 の穴
  L.GRID_PITCH = 1.25;
  L.WIRE_T = 0.12;
  L.STRAND_W = 1.0;            // 糸の断面の幅
  L.CUT_X = 11.05;             // 切り糸の通る面
  L.KNOB_Z = 4.05;             // つまみの端の位置
  L.BLOCK = { len: 17, size: 4.8 };
  L.EXTRUDE_RATIO = 2.2;       // 寒天1cm押すと糸がどれだけ伸びるか
  L.ROD = { headT: 0.8, headS: 4.7, shaftS: 1.5, shaftLen: 20.5, handleLen: 3.6, handleR: 1.45 };
  L.ROD_START_X = -9.0;        // 差し込んだ直後の棒の頭（前面）
  L.ROD_MAX_X = 10.0;          // 格子の内側
  L.BASE = { x0: -9.5, x1: 5.5, hz: 4.8 };
  L.TRAY = { x0: 5, x1: 45, z0: -11, z1: 27, floorY: 1.2, rimTop: 2.2, rimW: 0.9 };
  L.PLATE = { R: 6.5, Rin: 6.15, H: 2.3, floor: 0.5 };
  L.PLATING = { x: 16.5, z: 0.3 };
  L.PLATING_ZONE = { x0: 12.6, x1: 34.0, z0: -3.6, z1: 6.5 };
  L.FRONT = { x: 26, z: 13, r: 7.2, depth: 0.3 };
  L.BACK = { x: 37, z: -3, r: 7.2, depth: 0.3 };
  L.PITCHER = { x: 33, z: 22 };
  L.SPOON = { x: 14.5, z: 19.5 };
  L.SESAME_DISH = { x: 9.2, z: 14.2 };
  L.BOARD = { x0: -33, x1: -14, z0: 3, z1: 24, t: 1.0 };
  L.BLOCK_SPOTS = [
    { x: -23.5, z: 19.2 },
    { x: -23.5, z: 13.6 },
    { x: -23.5, z: 8.0 },
  ];
  L.ROD_REST = { x: -6.0, z: 28.6 }; // 棒の頭の位置（棒は -X 方向へ寝る）
  L.STACK = { x: -2.5, z: 17.0 };
  L.PARK = [
    { x: 37, z: -3, tray: true },
    { x: 56, z: -3, tray: false },
    { x: 56, z: 13.5, tray: false },
  ];
  L.TABLE = { x0: -48, x1: 72, z0: -24, z1: 36, top: 0 };

  // 穴 h（0..15）の中心。h = j*4 + i, i: z方向の列, j: y方向の段
  L.holeY = (h) => L.TUBE.y + ((h >> 2) - 1.5) * L.GRID_PITCH;
  L.holeZ = (h) => L.TUBE.z + ((h & 3) - 1.5) * L.GRID_PITCH;
  L.colZ = (c) => L.TUBE.z + (c - 1.5) * L.GRID_PITCH;

  // 皿の内側の底の高さ（皿ローカル、半径 r）
  L.plateBase = function (r) {
    const P = L.PLATE;
    if (r < 3.4) return P.floor + 0.05 * (r / 3.4) * (r / 3.4);
    if (r < P.Rin) { const t = (r - 3.4) / (P.Rin - 3.4); return P.floor + 0.05 + (P.H - 0.15 - P.floor - 0.05) * (t * t * (1.6 - 0.6 * t)); }
    return P.H;
  };

  G.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  G.time = 0; // ゲーム内時間（秒）
})();
