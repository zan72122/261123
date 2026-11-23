// core.js — 名前空間・定数・小さな数学道具
(function () {
  'use strict';
  var KK = (window.KK = window.KK || {});
  var T = THREE;

  // 単位はおおむね cm。y が上、+z が手前（カメラ側）、奥は -z。
  KK.C = {
    R: 1.0,               // 玉の半径
    G: 460,               // 重力（少しゆっくりめ）
    ROLL: 5 / 7,          // 転がる球の加速係数
    INNER: 1.35,          // 溝の内側半幅
    WALL_T: 0.55,         // 壁の厚み
    WALL_H: 1.25,         // 壁の高さ（床から）
    BASE_T: 0.75,         // 溝の底板の厚み
    BOARD_X: 25, BOARD_Z: 23, BOARD_T: 0.4,
    TABLE_X: 58, TABLE_Z: 44,
    SPAN: 20,             // まっすぐな坂の支え間の長さ（端から端）
    H_MIN: 2.4, H_MAX: 17.5,
    MAX_DH: 13.0,
    SNAP_R: 1.9, NEAR_R: 4.2, ALIGN_R: 8.0,
    SUBSTEP: 1 / 240
  };

  KK.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  KK.lerp = function (a, b, t) { return a + (b - a) * t; };
  KK.smooth = function (e0, e1, x) {
    var t = KK.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // フレームレートに依存しない追従
  KK.damp = function (cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  };
  KK.wrapAngle = function (a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  KK.dampAngle = function (cur, target, lambda, dt) {
    return cur + KK.wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));
  };
  KK.rand = function (a, b) { return a + Math.random() * (b - a); };
  KK.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  KK.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  // yaw（rotation.y と同じ向き）で局所 xz を回す
  KK.rotXZ = function (lx, lz, yaw, out) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    out = out || { x: 0, z: 0 };
    out.x = lx * c + lz * s;
    out.z = -lx * s + lz * c;
    return out;
  };
  KK.invRotXZ = function (wx, wz, yaw, out) {
    return KK.rotXZ(wx, wz, -yaw, out);
  };
  // 方向角（xz 平面で x 軸から z へ向かう角ではなく、ベクトル(cos,−sin) を yaw と合わせる）
  // dirAngle a → ベクトル (cos a, -sin a)。rotation.y と同じ回り方。
  KK.dirVec = function (a, out) {
    out = out || { x: 0, z: 0 };
    out.x = Math.cos(a); out.z = -Math.sin(a);
    return out;
  };
  KK.vecAngle = function (x, z) { return Math.atan2(-z, x); };

  // 減衰ばね（1 自由度）
  KK.Spring = function (x, k, c) {
    this.x = x || 0; this.v = 0; this.target = this.x;
    this.k = k || 120; this.c = c || 14;
  };
  KK.Spring.prototype.step = function (dt) {
    var a = (this.target - this.x) * this.k - this.v * this.c;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  };
  KK.Spring.prototype.kick = function (v) { this.v += v; };

  // 線分と点（xz）の最近点パラメータ
  KK.segT = function (ax, az, bx, bz, px, pz) {
    var dx = bx - ax, dz = bz - az;
    var L2 = dx * dx + dz * dz;
    if (L2 < 1e-9) return 0;
    return KK.clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  };

  KK.tmpV = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];

  // 共有状態
  KK.state = {
    time: 0,
    firstTouch: false,
    lastTouch: 0,
    interacting: false,
    lowView: 0,
    spiralSeen: false,
    runs: 0
  };
})();
