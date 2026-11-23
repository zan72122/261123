// camera.js — 斜め上からの眺めと、螺旋に合わせて机の高さへ降りる眺め
(function () {
  'use strict';
  var KK = window.KK, T = THREE;
  var CM = (KK.cam = {
    low: 0, lowT: 0, lowMode: false,
    pos: new T.Vector3(), look: new T.Vector3(),
    hiPos: new T.Vector3(), hiLook: new T.Vector3(),
    loPos: new T.Vector3(), loLook: new T.Vector3(),
    pan: new T.Vector3(), panT: new T.Vector3(),
    keepPt: null, w: 1, h: 1
  });
  var v = new T.Vector3(), v2 = new T.Vector3();

  CM.init = function (w, h) {
    CM.camera = new T.PerspectiveCamera(42, w / h, 0.5, 700);
    CM.resize(w, h);
    CM.pos.copy(CM.hiPos); CM.look.copy(CM.hiLook);
    CM.loPos.copy(CM.hiPos); CM.loLook.copy(CM.hiLook);
    CM.apply();
  };

  CM.resize = function (w, h) {
    CM.w = w; CM.h = h;
    var cam = CM.camera, asp = w / h;
    cam.aspect = asp;
    CM.portrait = asp < 0.9;
    cam.fov = CM.portrait ? 52 : asp < 1.25 ? 46 : 40;
    cam.updateProjectionMatrix();
    fitHigh();
  };

  // 組み立て板の全体が入る斜め上の位置（要所の点が画面に収まるよう中心と距離を合わせる）
  function fitHigh() {
    var cam = CM.camera;
    var pts = CM.portrait
      ? [[-20.5, 0, -21], [20.5, 0, -21], [-20.5, 0, 21.5], [21, 0, 21.5], [-19, 24, -15], [14.3, 1.6, 15.5], [-21, 0.3, 19]]
      : [[-24, 0, -22], [24, 0, -22], [-24, 0, 22.5], [24, 0, 22.5], [-19, 24, -15], [14.3, 1.6, 15.5]];
    pts = pts.map(function (p) { return new T.Vector3(p[0], p[1], p[2]); });
    var el = (CM.portrait ? 57 : 50) * Math.PI / 180, az = (CM.portrait ? 2 : 6) * Math.PI / 180;
    var dir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    var c = new T.Vector3(0, 2, 1);
    var D = 80, limX = CM.portrait ? 1.12 : 0.95, limY = 0.93;
    var right = new T.Vector3(), upv = new T.Vector3();
    for (var it = 0; it < 30; it++) {
      cam.position.copy(c).addScaledVector(dir, D);
      cam.lookAt(c);
      cam.updateMatrixWorld(true);
      var x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (var i = 0; i < pts.length; i++) {
        v.copy(pts[i]).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      var th = Math.tan(cam.fov * Math.PI / 360);
      right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      upv.set(0, 1, 0).applyQuaternion(cam.quaternion);
      // 中心のずれを戻す
      c.addScaledVector(right, (x0 + x1) / 2 * D * th * cam.aspect * 0.7);
      c.addScaledVector(upv, (y0 + y1) / 2 * D * th * 0.7);
      var m = Math.max((x1 - x0) / 2 / limX, (y1 - y0) / 2 / limY);
      D *= 1 + (m - 1) * 0.6;
    }
    CM.hiPos.copy(c).addScaledVector(dir, D);
    CM.hiLook.copy(c);
    CM.D = D;
  }

  // 低い眺め：机の高さ近くから、螺旋の向こうに羽根車、その先の皿まで
  var fitCam = null, lp = [];
  function lowPose() {
    var sp = (KK.parts.byKind.spiral || [])[0];
    if (!sp) return;
    if (!fitCam) fitCam = CM.camera.clone();
    fitCam.aspect = CM.camera.aspect; fitCam.fov = CM.camera.fov; fitCam.updateProjectionMatrix();
    var sx = sp.disp.x, sz = sp.disp.z;
    var ch = (KK.parts.byKind.chute || [])[0];
    var chOn = ch && ch.state !== 'stowed' && Math.hypot(ch.disp.x - sx, ch.disp.z - sz) < 34;
    var tp = KK.world.trayPose;
    var trOn = Math.hypot(tp.x - sx, tp.z - sz) < 30;
    lp.length = 0;
    lp.push([sx, 0.5, sz], [sx, sp.yTop + 2.5, sz]);
    if (chOn) lp.push([ch.disp.x, ch.dofs[0].hd + 4.5, ch.disp.z], [ch.disp.x, 0, ch.disp.z]);
    if (trOn && !CM.portrait) lp.push([tp.x, 1.5, tp.z]);
    else if (trOn) lp.push([KK.lerp(sx, tp.x, 0.45), 1.5, KK.lerp(sz, tp.z, 0.45)]);
    // 流れの向き（螺旋 → 先）
    var fx = 0, fz = 1;
    var ex = trOn ? tp.x : chOn ? ch.disp.x : sx, ez = trOn ? tp.z : chOn ? ch.disp.z : sz + 1;
    if (chOn && !trOn) { ex = ch.disp.x; ez = ch.disp.z; }
    var fl = Math.hypot(ex - sx, ez - sz);
    if (fl > 1) { fx = (ex - sx) / fl; fz = (ez - sz) / fl; }
    // 流れを横から見る向き（手前側）
    var ox = fz, oz = -fx;
    if (oz < 0) { ox = -ox; oz = -oz; }
    // 螺旋が手前、羽根車が向こうになるよう少し回す
    if (chOn) {
      var bx = sx - ch.disp.x, bz = sz - ch.disp.z, bl = Math.hypot(bx, bz) || 1;
      var cr = ox * (bz / bl) - oz * (bx / bl);
      var rot = cr > 0 ? -0.42 : 0.42;
      var nx = ox * Math.cos(rot) - oz * Math.sin(rot), nz = ox * Math.sin(rot) + oz * Math.cos(rot);
      if (nz > 0.1) { ox = nx; oz = nz; }
    }
    // 中心
    var cx = 0, cz = 0;
    for (var i = 0; i < lp.length; i++) { cx += lp[i][0]; cz += lp[i][2]; }
    cx /= lp.length; cz /= lp.length;
    cx = KK.lerp(cx, sx, 0.3); cz = KK.lerp(cz, sz, 0.3);
    var look = KK.tmpV[0].set(cx, 5.4, cz);
    var D = CM.portrait ? 46 : 30;
    for (var it = 0; it < 8; it++) {
      fitCam.position.set(cx + ox * D, 7.0, cz + oz * D);
      fitCam.lookAt(look);
      fitCam.updateMatrixWorld(true);
      var m = 0;
      for (i = 0; i < lp.length; i++) {
        v.set(lp[i][0], lp[i][1], lp[i][2]).project(fitCam);
        if (v.z > 1) { m = 2; break; }
        m = Math.max(m, Math.abs(v.x) / 0.82, Math.abs(v.y) / 0.8);
      }
      D = KK.clamp(D * (1 + (m - 1) * 0.7), 18, 80);
    }
    CM.loLook.copy(look);
    CM.loPos.set(cx + ox * D, 7.0, cz + oz * D);
  }

  CM.keep = function (pt) { CM.keepPt = pt; };

  CM.update = function (dt) {
    var S = KK.state, B = KK.ball;
    var sp = (KK.parts.byKind.spiral || [])[0];
    var spiralUsable = sp && sp.state === 'active';
    if (B.inSpiral && spiralUsable) CM.lowMode = true;
    if (!spiralUsable) CM.lowMode = false;
    if (B.mode === 'held') CM.lowMode = false;
    // 部品をつかんでいる間は眺めを大きく変えない
    if (!S.dragPart) CM.lowT = CM.lowMode ? 1 : 0;
    var rate = CM.lowT > CM.low ? 0.75 : 0.9;
    CM.low = KK.damp(CM.low, CM.lowT, rate, dt);
    lowPose();
    var k = KK.smooth(0, 1, CM.low);
    v.lerpVectors(CM.hiPos, CM.loPos, k);
    v2.lerpVectors(CM.hiLook, CM.loLook, k);
    // 降りる途中は少し弧を描いて、溝の上をかすめないように
    v.y += Math.sin(k * Math.PI) * 6;
    // つかんだ場所を画面内に保つ
    CM.panT.set(0, 0, 0);
    if (CM.keepPt) {
      var p = KK.tmpV[3].copy(CM.keepPt).project(CM.camera);
      var lim = 0.78;
      var ex = Math.abs(p.x) > lim ? (p.x - Math.sign(p.x) * lim) : 0;
      var ey = Math.abs(p.y) > lim ? (p.y - Math.sign(p.y) * lim) : 0;
      if (ex || ey) {
        var right = KK.tmpV[2].set(1, 0, 0).applyQuaternion(CM.camera.quaternion);
        var upv = KK.tmpV[1].set(0, 1, 0).applyQuaternion(CM.camera.quaternion);
        var dist = CM.camera.position.distanceTo(CM.keepPt);
        var sc = dist * Math.tan(CM.camera.fov * Math.PI / 360);
        CM.panT.copy(CM.pan).addScaledVector(right, ex * sc * CM.camera.aspect * 0.6).addScaledVector(upv, ey * sc * 0.6);
      } else CM.panT.copy(CM.pan);
      CM.panT.clampLength(0, 12);
    }
    CM.keepPt = null;
    CM.pan.lerp(CM.panT, 1 - Math.exp(-(S.dragPart || KK.ball.mode === 'held' ? 2.5 : 0.8) * dt));
    v.add(CM.pan); v2.add(CM.pan);
    // 机の下には潜らない
    v.y = Math.max(v.y, 3.2);
    CM.pos.copy(v); CM.look.copy(v2);
    CM.apply();
  };

  CM.apply = function () {
    CM.camera.position.copy(CM.pos);
    CM.camera.up.set(0, 1, 0);
    CM.camera.lookAt(CM.look);
    CM.camera.updateMatrixWorld(true);
  };
})();
