// core.js — 名前空間・寸法・小さな数学道具
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var V3 = THREE.Vector3;

  // 寸法（1 = 約2cm）。箱は x 左右, y 上, z 手前。
  var K = {
    W: 10, D: 4.4, H: 11, T: 0.2,
    R: 0.9, RIN: 0.83,           // カプセル外径・内径
    SIDE_BACK: -2.9,             // 側板の奥端 z
    BACK_Z: -2.2,                // 背板の折り筋 z
    FRONT_Z: 2.2,                // 底板の手前端
    TAB_H: 7.0,                  // 爪の高さ（背板の折り筋から）
    TAB_Z: -2.3,
    SLOT_HI: 10.2, SLOT_LO: 8.4, // 坂板の溝の高さ
    EAR_Z0: -2.0, EAR_Z1: -0.6,  // 耳（溝）の奥行き範囲
    BOARD_Z0: -2.0, BOARD_Z1: 1.8,
    BODY_X: 2.9,                 // 坂板の本体の端
    DISK_Y: 4.0, DISK_R: 2.0, DISK_Z: 0.55, DISK_TH: 1.3, LANE_Z: 0.7, POCKET_R: 1.75, NOTCH_R: 0.95,
    TROUGH_A: 10 * Math.PI / 180,
    QSTEP: 1.85,
    WIN_Z: 2.02, WIN_Y0: 2.75, WIN_Y1: 10.9, WIN_TH: 0.1, WIN_HW: 5.18,
    HANDLE_Z: 2.45, CRANK_R: 1.5,
    LIP_Z: 3.4, LIP_Y: 0.7, CHUTE_Z0: -0.3, CHUTE_Y0: 0.95,   // 取り出し口（床面）
    TRAY_Z: 4.75, TRAY_W: 6.0, TRAY_D: 3.9, TRAY_RIM: 0.4, TRAY_FLOOR: 0.12,
    TRAY_SHIFT: 2.2,
    GRAV: 40,
    DESK_X: 19, DESK_Z0: -15.5, DESK_Z1: 15.5
  };
  K.Y_TOP = K.DISK_Y + K.DISK_R + K.R;   // 盤の上で待つ先頭の中心高さ
  K.BETA = Math.atan((K.SLOT_HI - K.SLOT_LO) / K.W);
  K.EAR_X = 5.18;   // 坂板の耳の先（中心から）
  K.TROUGH_X0 = 1.5; K.TROUGH_X1 = 4.75;
  // 待ち溝に並ぶ中心位置（i: 0 = 盤の上）
  K.queuePos = function (i, side, out) {
    out = out || new THREE.Vector3();
    var d = i * K.QSTEP;
    var x = d * Math.cos(K.TROUGH_A);
    return out.set(side * x, K.Y_TOP + x * Math.tan(K.TROUGH_A), K.LANE_Z);
  };
  K.chuteY = function (z) { // 取り出し口の床の高さ
    var t = (z - K.CHUTE_Z0) / (K.LIP_Z - K.CHUTE_Z0);
    return K.CHUTE_Y0 + (K.LIP_Y - K.CHUTE_Y0) * t;
  };
  G.K = K;

  // 乱数（毎回少し違う並び）
  var seed = (Date.now() ^ 0x5bd1e995) >>> 0;
  G.rand = function () {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return (seed >>> 0) / 4294967296;
  };
  G.rr = function (a, b) { return a + (b - a) * G.rand(); };

  G.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  G.lerp = function (a, b, t) { return a + (b - a) * t; };
  G.smooth = function (t) { t = G.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  G.easeOut = function (t) { t = G.clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  G.easeInOut = function (t) { t = G.clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  G.backOut = function (t) { t = G.clamp(t, 0, 1); var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  G.wrapA = function (a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  G.damp = function (cur, target, lambda, dt) { return G.lerp(cur, target, 1 - Math.exp(-lambda * dt)); };
  G.dampV = function (cur, target, lambda, dt) { return cur.lerp(target, 1 - Math.exp(-lambda * dt)); };

  // ばね（1次元）
  G.Spring = function (v, k, c) { this.x = v; this.v = 0; this.t = v; this.k = k || 120; this.c = c || 12; };
  G.Spring.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = this.k * (this.t - this.x) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  };
  G.Spring.prototype.kick = function (dv) { this.v += dv; };

  // 3次元ばね
  G.Spring3 = function (p, k, c) { this.x = p.clone(); this.v = new V3(); this.t = p.clone(); this.k = k || 120; this.c = c || 14; };
  G.Spring3.prototype.step = function (dt) {
    var n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, a = new V3();
    for (var i = 0; i < n; i++) {
      a.copy(this.t).sub(this.x).multiplyScalar(this.k).addScaledVector(this.v, -this.c);
      this.v.addScaledVector(a, h); this.x.addScaledVector(this.v, h);
    }
    return this.x;
  };

  // 簡単な時間差つき処理
  G.timers = [];
  G.after = function (sec, fn) { G.timers.push({ t: sec, fn: fn }); };
  G.tickTimers = function (dt) {
    for (var i = G.timers.length - 1; i >= 0; i--) {
      var tm = G.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { G.timers.splice(i, 1); try { tm.fn(); } catch (e) { console.error(e); } }
    }
  };

  // 補間アニメ（値の受け渡しは関数で）
  G.tweens = [];
  G.tween = function (dur, onStep, onDone, ease) {
    var tw = { t: 0, d: Math.max(0.001, dur), step: onStep, done: onDone, ease: ease || G.easeInOut, dead: false };
    G.tweens.push(tw); return tw;
  };
  G.tickTweens = function (dt) {
    for (var i = G.tweens.length - 1; i >= 0; i--) {
      var tw = G.tweens[i];
      if (tw.dead) { G.tweens.splice(i, 1); continue; }
      tw.t += dt;
      var k = Math.min(1, tw.t / tw.d);
      try { tw.step(tw.ease(k), k); } catch (e) { console.error(e); }
      if (k >= 1) { G.tweens.splice(i, 1); tw.dead = true; if (tw.done) { try { tw.done(); } catch (e2) { console.error(e2); } } }
    }
  };

  // 便利
  G.v3 = function (x, y, z) { return new V3(x, y, z); };
  G.tmpV = [new V3(), new V3(), new V3(), new V3()];
  G.qFromAxis = function (ax, a) { return new THREE.Quaternion().setFromAxisAngle(ax, a); };
  G.UP = new V3(0, 1, 0);
  G.now = function () { return performance.now() / 1000; };

  // 物体の最も上向きの軸を真上に合わせる補正
  G.snapUpright = function (q) {
    var axes = [new V3(1, 0, 0), new V3(0, 1, 0), new V3(0, 0, 1)];
    var best = null, bd = -2;
    for (var i = 0; i < 3; i++) {
      var w = axes[i].clone().applyQuaternion(q);
      var d = Math.abs(w.y);
      if (d > bd) { bd = d; best = w.y >= 0 ? w : w.negate(); }
    }
    var corr = new THREE.Quaternion().setFromUnitVectors(best.normalize(), G.UP);
    return corr.multiply(q);
  };

  // 子を持つ部品の材質を個別化（光らせるため）
  G.ownMaterials = function (root) {
    var list = [];
    root.traverse(function (o) {
      if (o.isMesh && o.material && !o.userData.noGlow) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map(function (m) { var c = m.clone(); list.push(c); return c; });
        } else { o.material = o.material.clone(); list.push(o.material); }
      }
    });
    return list;
  };

  G.shadowAll = function (root, cast, recv) {
    root.traverse(function (o) { if (o.isMesh) { o.castShadow = cast !== false; o.receiveShadow = recv !== false; } });
  };
})();
