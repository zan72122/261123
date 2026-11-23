// wheel.js — 羽根車の回転、玉との押し合い、余勢、濃い羽根の照り
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var WH = (KK.wheel = {
    I: 1.2,          // 慣性
    MB: 1.4,         // 転がる玉の実効質量
    C0: 0.28,        // 軸の摩擦（一定）
    C1: 0.42,        // 空気など（速さに比例）
    E: 0.05,         // はね返り
    MAXW: 60,        // 物理の上限（rad/s）
    VISW: 19         // 見た目の回転の上限（羽根の向きが目で追える速さ）
  });
  var v3 = new T.Vector3(), n3 = new T.Vector3(), r3 = new T.Vector3(), cam3 = new T.Vector3();

  WH.step = function (ch, dt) {
    var w = ch.wheel;
    if (w.drag) return;
    var om = w.omega;
    var dec = WH.C0 + WH.C1 * Math.abs(om) + 0.012 * om * om;
    if (Math.abs(om) > 3) w.spun = Math.max(w.spun, Math.abs(om));
    var nom = om - Math.sign(om) * dec * dt;
    if (Math.sign(nom) !== Math.sign(om)) nom = 0;
    // 止まりかけに、まれにもう一枚ぶん回る
    if (w.spun > 3 && Math.abs(nom) < 0.9 && Math.abs(om) >= 0.9) {
      if (Math.random() < 0.22) nom = coastOmega(ch, Math.sign(om) || 1);
      w.spun = 0;
    }
    w.omega = nom;
    w.phi += w.omega * dt;
  };
  // 見た目の角度（速すぎる回転は目で追える速さに抑え、遅くなると追いつく）
  WH.visualPhi = function (ch, dt) {
    var w = ch.wheel;
    if (w.vphi == null) w.vphi = w.phi;
    var d = w.phi - w.vphi;
    var lim = WH.VISW * dt;
    if (Math.abs(w.omega) > WH.VISW) w.vphi += Math.sign(w.omega) * lim;
    else w.vphi += KK.clamp(d, -lim * 1.6, lim * 1.6) * (Math.abs(d) > 1e-3 ? 1 : 0) + (Math.abs(d) <= 1e-3 ? d : 0);
    // 大きくずれたら一周ぶんを詰める
    while (w.phi - w.vphi > Math.PI * 2) w.vphi += Math.PI * 2 / 6 * 6;
    while (w.vphi - w.phi > Math.PI * 2) w.vphi -= Math.PI * 2 / 6 * 6;
    return w.vphi;
  };

  // 余勢: 濃い羽根が窓の光をいちばん拾う角度で止まるように
  function coastOmega(ch, sgn) {
    var w = ch.wheel, best = 0.9, bestG = -1;
    for (var k = 0; k <= 10; k++) {
      var d = 0.75 + (k / 10) * 0.75;
      var g = glintAt(ch, w.phi + sgn * d);
      if (g > bestG) { bestG = g; best = d; }
    }
    // おおよそ d だけ進む初速
    var a = WH.C0 + WH.C1 * 0.6;
    return sgn * Math.sqrt(2 * a * best) * 1.08;
  }

  // 濃い羽根の照り具合
  function glintAt(ch, phi) {
    var th = phi + ch.darkIndex * Math.PI / 3;
    // 羽根の面の法線（樋の局所 xy 平面で接線方向）
    n3.set(Math.cos(th), Math.sin(th), 0);
    n3.applyQuaternion(ch.group.quaternion);
    var sun = KK.world.sunDir;
    r3.copy(sun).addScaledVector(n3, -2 * sun.dot(n3));
    // 羽根の位置からカメラへ
    var cam = KK.cam && KK.cam.camera;
    if (!cam) return 0;
    ch.wheelG.getWorldPosition(v3);
    cam3.copy(cam.position).sub(v3).normalize();
    var g1 = Math.max(0, r3.dot(cam3));
    // 裏面も
    n3.negate();
    r3.copy(sun).addScaledVector(n3, -2 * sun.dot(n3));
    var g2 = Math.max(0, r3.dot(cam3));
    return Math.max(g1, g2);
  }

  WH.visual = function (ch) {
    var g = glintAt(ch, ch.wheel.phi);
    ch.darkMat.emissiveIntensity = Math.pow(g, 24) * 0.7 + ch.glow * 0.1;
  };

  // 玉との押し合い。ball: {s, v}。v を書きかえ、s の押し戻しを返す
  WH.contact = function (ch, ball, dt) {
    var w = ch.wheel, L = ch.L, R = C.R;
    var xb = ball.s - L / 2;
    if (Math.abs(xb) > ch.rTip + R + 0.3) { w.touch = 0; return 0; }
    var cy = (-ch.sl * xb / (L / 2) + R) - ch.axleY;
    var push = 0, touching = 0;
    for (var i = 0; i < 6; i++) {
      var th = w.phi + i * Math.PI / 3;
      var ux = Math.sin(th), uy = -Math.cos(th);
      var r = KK.clamp(xb * ux + cy * uy, ch.rHub, ch.rTip);
      var qx = r * ux, qy = r * uy;
      var dx = xb - qx, dy = cy - qy;
      var dist = Math.hypot(dx, dy);
      var lim = R + ch.paddleT / 2;
      if (dist >= lim || dist < 1e-5) continue;
      touching |= 1 << i;
      var nx = dx / dist, ny = dy / dist;
      var k = qx * ny - qy * nx;                 // 腕の長さ × 法線
      var vpn = w.omega * k;                      // 羽根の点の法線方向の速さ
      var vrel = ball.v * nx - vpn;
      var pen = lim - dist;
      if (vrel < 0) {
        var J = -(1 + WH.E) * vrel / (nx * nx / WH.MB + k * k / WH.I);
        ball.v += J * nx / WH.MB;
        w.omega -= J * k / WH.I;
        // 速すぎると羽根の向きが目で追えないので頭打ち
        w.omega = KK.clamp(w.omega, -WH.MAXW, WH.MAXW);
        if (!(w.touch & (1 << i))) {
          var st = KK.clamp(Math.abs(vrel) / 70, 0, 1.2);
          KK.audio.hit('paddle', st, ball.pan || 0);
          ball.paddleHit = (ball.paddleHit || 0) + 1;
        }
      }
      // めり込みを戻す（羽根を回す方を主に）
      if (Math.abs(k) > 0.25) w.phi += KK.clamp(-pen * 0.9 / k, -0.25, 0.25);
      else push += pen * nx;
    }
    w.touch = touching;
    return push;
  };

  // 指で羽根を回す
  WH.drag = function (ch, dphi, dt) {
    var w = ch.wheel;
    w.phi += dphi;
    var om = dphi / Math.max(dt, 1 / 120);
    w.omega = KK.lerp(w.omega, KK.clamp(om, -40, 40), 0.5);
    if (Math.abs(w.omega) > 3) w.spun = Math.max(w.spun, Math.abs(w.omega));
  };
})();
