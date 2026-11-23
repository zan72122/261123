// util.js — 共通の名前空間・寸法・数学ヘルパー
// 単位は cm。机の上面が y=0。
(function () {
  'use strict';
  const S = (window.S23 = window.S23 || {});

  // ---- 寸法（すべて cm） ----
  const T = 0.4; // 段ボールの厚み
  S.DIM = {
    T,
    FLOOR_Y: T,            // 底板上面
    HX: 15,                // 箱の半幅（底板 x∈[-15,15]）
    HZ: 4.5,               // 箱の半奥行（底板 z∈[-4.5,4.5]）
    H: 20,                 // 側板・背板の高さ
    RIM_H: 2.4,            // 正面の低い縁
    CHUTE_X0: 7.0,         // 取り出し口の左端（坂は x∈[7.05,14.55]）
    CHUTE_X1: 14.55,
    DISH_L: 6.0,           // 受け皿の張り出し
    DISH_LIP: 1.2,
    SLOPE_HINGE: 4.4,      // 背板上の坂の折り筋の高さ（底板上面から）
    SLOPE_TIP: 1.4,        // 坂の先の折り返し
    BAR_Z: -1.55,          // 横桟の奥行位置
    BAR_LOW: 12.7,         // 横桟中心の高さ（低）
    BAR_HIGH: 15.2,        // 横桟中心の高さ（高）
    BAR_SIZE: 1.6,         // 横桟の断面
    BAR_LEN: 32.8,
    SLOT_LOW: [11.5, 13.5], // くぼみ（側板上の高さ範囲, 底板上面から）
    SLOT_HIGH: [14.0, 16.0],
    SLOT_BACK: -2.4,       // くぼみの奥（z）
    TROLLEY_MIN: -12.6,
    TROLLEY_MAX: 12.8,
    LOOP_Z: 7.2,           // 輪が垂れる奥行
    ARM_Z: 0.4,            // アームがつるされる奥行（包みの帯の中心）
    HUB_REST: 7.4,         // 横桟中心からアームの中心までの下がり（ひもの長さで決まる）
    HUB_TOP_GAP: 2.5,      // 持ち上げの上限（横桟中心からの距離）
    CLAW_LEN: 6.6,
    CLAW_OPEN: -82 * Math.PI / 180,
    CLAW_CLOSE: 10 * Math.PI / 180,
    CLAW_W: 3.2,
    PIVOT_X: 1.4, PIVOT_Y: -0.7,
    SLACK: 0.9, PLATE_TRAVEL: 1.6,
    LOOP_R: 2.1, LOOP_DROP: 1.6,
  };
  // 坂の長さ（背板の折り筋から正面の縁まで）
  {
    const d = S.DIM;
    d.SLOPE_LEN = Math.hypot(2 * d.HZ, d.SLOPE_HINGE);
    d.SLOPE_ANGLE = Math.atan2(d.SLOPE_HINGE, 2 * d.HZ);
  }

  // ---- 数学 ----
  S.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.smooth = (t) => { t = S.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  S.damp = (cur, target, rate, dt) => S.lerp(cur, target, 1 - Math.exp(-rate * dt));
  S.approach = (cur, target, step) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));
  S.DEG = Math.PI / 180;
  S.TAU = Math.PI * 2;
  S.wrapAngle = (a) => { while (a > Math.PI) a -= S.TAU; while (a < -Math.PI) a += S.TAU; return a; };

  // 起動ごとに少し違う乱数（決定的な再現は不要）
  let seed = (Date.now() ^ 0x5bd1e995) >>> 0;
  S.rand = function () {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  S.randRange = (a, b) => a + (b - a) * S.rand();
  // 固定の疑似乱数（テクスチャ等、毎回同じ見た目にしたいもの用）
  S.hashRand = function (n) {
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  S.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(S.rand() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  // 使い回しの一時ベクトル
  S.tmpV = [];
  for (let i = 0; i < 16; i++) S.tmpV.push(new THREE.Vector3());
  S.tmpQ = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  S.tmpM = [new THREE.Matrix4(), new THREE.Matrix4()];

  S.v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // 線分上の最近点パラメータ
  S.closestOnSegment = function (p, a, b, out) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz;
    let t = l2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
    t = S.clamp(t, 0, 1);
    out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
    return t;
  };

  // 画面座標 → レイ
  S.rayFromScreen = function (camera, sx, sy, w, h, origin, dir) {
    const nx = (sx / w) * 2 - 1, ny = -(sy / h) * 2 + 1;
    origin.setFromMatrixPosition(camera.matrixWorld);
    dir.set(nx, ny, 0.5).unproject(camera).sub(origin).normalize();
  };
  // レイと平面（法線 n, 点 p0）の交点
  S.rayPlane = function (o, d, n, p0, out) {
    const den = d.dot(n);
    if (Math.abs(den) < 1e-6) return false;
    const t = (p0.clone().sub(o)).dot(n) / den;
    if (t < 0) return false;
    out.copy(d).multiplyScalar(t).add(o);
    return true;
  };
  // ワールド点 → 画面座標（px）
  S.toScreen = function (camera, p, w, h, out) {
    const v = S.tmpV[15].copy(p).project(camera);
    out.x = (v.x * 0.5 + 0.5) * w;
    out.y = (-v.y * 0.5 + 0.5) * h;
    out.z = v.z;
    return out;
  };

  // 簡単なイベント
  S.events = {
    map: {},
    on(name, fn) { (this.map[name] = this.map[name] || []).push(fn); },
    emit(name, a, b, c) { const l = this.map[name]; if (l) for (const f of l) f(a, b, c); },
  };
})();
