/* camera.js — 透視カメラ。見せたい点の集まりが画面に収まる距離を求め、なめらかに移る。 */
(function () {
  'use strict';
  const G = window.G;
  const M = G.M;
  const C = (G.cam = {});

  C.init = function (aspect) {
    C.camera = new THREE.PerspectiveCamera(36, aspect, 0.5, 900);
    C.aspect = aspect;
    C.cur = { tx: 4, ty: 6, tz: 6, yaw: 0.05, pitch: 0.5, dist: 150, fov: 36 };
    C.want = Object.assign({}, C.cur);
    C.speed = 2.2;
    C.apply();
  };

  C.resize = function (w, h) {
    C.aspect = w / h;
    C.camera.aspect = C.aspect;
    C.camera.updateProjectionMatrix();
  };

  C.portrait = function () { return C.aspect < 0.85; };

  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), rel = new THREE.Vector3();
  function basis(yaw, pitch) {
    // カメラは target + dir*dist にいる
    const cp = Math.cos(pitch);
    fwd.set(-cp * Math.sin(yaw), -Math.sin(pitch), -cp * Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(right, fwd);
  }

  // points: THREE.Vector3 の配列。margin: 画面の端から空ける割合
  C.fit = function (points, yaw, pitch, fov, margin, out) {
    basis(yaw, pitch);
    const aspect = C.aspect;
    const tv = Math.tan(fov * Math.PI / 360);
    const tanV = tv * (1 - margin);
    const tanH = tv * aspect * (1 - margin * (aspect < 1 ? 0.7 : 1));
    // 中心：点の右・上の範囲の中心（奥行きは平均）
    let minR = 1e9, maxR = -1e9, minU = 1e9, maxU = -1e9, sx = 0, sy = 0, sz = 0;
    for (const p of points) { sx += p.x; sy += p.y; sz += p.z; }
    const cx = sx / points.length, cy = sy / points.length, cz = sz / points.length;
    for (const p of points) {
      rel.set(p.x - cx, p.y - cy, p.z - cz);
      const r = rel.dot(right), u = rel.dot(up);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    }
    const offR = (minR + maxR) / 2, offU = (minU + maxU) / 2;
    const tx = cx + right.x * offR + up.x * offU, ty = cy + right.y * offR + up.y * offU, tz = cz + right.z * offR + up.z * offU;
    let dist = 10;
    for (const p of points) {
      rel.set(p.x - tx, p.y - ty, p.z - tz);
      const r = rel.dot(right), u = rel.dot(up), z = rel.dot(fwd);
      dist = Math.max(dist, Math.abs(r) / tanH - z, Math.abs(u) / tanV - z);
    }
    out = out || {};
    out.tx = tx; out.ty = ty; out.tz = tz; out.yaw = yaw; out.pitch = pitch; out.dist = dist; out.fov = fov;
    return out;
  };

  // 向きの候補の中から、点がいちばん大きく映る向きを選ぶ（今の向きから大きく外れないよう少し重みをつける）
  C.fitBest = function (points, yawA, yawB, pitch, fov, margin) {
    let best = null;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const yaw = yawA + (yawB - yawA) * i / (n - 1);
      const f = C.fit(points, yaw, pitch, fov, margin, {});
      f.score = f.dist * (1 + Math.abs(yaw - C.want.yaw) * 0.08);
      if (!best || f.score < best.score) best = f;
    }
    return best;
  };

  C.setWant = function (w, speed) {
    Object.assign(C.want, w);
    if (speed) C.speed = speed;
  };

  C.update = function (dt) {
    const k = M.damp(C.speed, dt);
    const c = C.cur, w = C.want;
    c.tx = M.lerp(c.tx, w.tx, k); c.ty = M.lerp(c.ty, w.ty, k); c.tz = M.lerp(c.tz, w.tz, k);
    c.yaw = M.angLerp(c.yaw, w.yaw, k); c.pitch = M.lerp(c.pitch, w.pitch, k);
    c.dist = M.lerp(c.dist, w.dist, k); c.fov = M.lerp(c.fov, w.fov, k);
    C.apply();
  };

  C.apply = function () {
    const c = C.cur;
    const cp = Math.cos(c.pitch);
    C.camera.position.set(c.tx + cp * Math.sin(c.yaw) * c.dist, c.ty + Math.sin(c.pitch) * c.dist, c.tz + cp * Math.cos(c.yaw) * c.dist);
    C.camera.lookAt(c.tx, c.ty, c.tz);
    if (Math.abs(C.camera.fov - c.fov) > 0.01) { C.camera.fov = c.fov; C.camera.updateProjectionMatrix(); }
    C.camera.updateMatrixWorld();
  };

  C.snap = function () { Object.assign(C.cur, C.want); C.apply(); };
})();
