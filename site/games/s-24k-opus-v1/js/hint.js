/* hint.js — 次に触る物を一つだけ、ほんのり光らせて小さく弾ませる。
   4秒ほど触れなければ、半透明の指が手本を見せる。 */
(function () {
  'use strict';
  const G = window.G;
  const M = G.M;
  const H = (G.hint = { obj: null, key: '', demo: null, bob: 0, glow: 0, mats: [], fingerT: 0, showing: false });
  const GLOW = new THREE.Color(0xffd9a0);

  H.init = function (scene) {
    const g = new THREE.Group();
    const mat = G.world.mats.ghost;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.6, 6, 14), mat);
    body.position.y = 1.8;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), mat);
    tip.position.y = 0.5;
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
    nail.scale.set(1, 0.35, 1.3); nail.position.set(0, 0.85, 0.32); nail.rotation.x = -0.35;
    g.add(body); g.add(tip); g.add(nail);
    g.traverse((o) => { o.renderOrder = 50; o.castShadow = false; });
    g.visible = false;
    scene.add(g);
    H.finger = g;
    H.fingerMats = [mat, nail.material];
  };

  function restore() {
    for (const m of H.mats) { m.emissive.copy(m.userData.emi0); m.emissiveIntensity = m.userData.emiI0; }
    H.mats = [];
  }

  // obj: 光らせる Object3D。demo: { from: ()=>Vector3, to: ()=>Vector3|null }
  H.set = function (key, obj, demo) {
    if (key === H.key) { H.demo = demo; return; }
    restore();
    H.key = key; H.obj = obj; H.demo = demo; H.t = 0;
    H.fingerT = 0;
    if (obj) {
      obj.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.emissive || o.userData.sharedMat) return;
        const m = o.material;
        if (m.visible === false) return;
        if (!m.userData.emi0) { m.userData.emi0 = m.emissive.clone(); m.userData.emiI0 = m.emissiveIntensity; }
        H.mats.push(m);
      });
    }
  };
  H.clear = function () { H.set('', null, null); };

  H.update = function (dt) {
    H.t = (H.t || 0) + dt;
    const idle = G.time - G.input.lastTouch;
    const busy = G.input.down;
    // ゆっくり脈打つ光
    const p = 0.5 + 0.5 * Math.sin(H.t * 3.2);
    const on = H.obj && !busy ? 1 : 0;
    H.glow = M.lerp(H.glow, on, M.damp(5, dt));
    for (const m of H.mats) {
      m.emissive.copy(m.userData.emi0).lerp(GLOW, H.glow * (0.18 + 0.22 * p));
      m.emissiveIntensity = 1;
    }
    // 2秒ごとに小さく弾む
    const ph = (H.t % 2.2) / 2.2;
    H.bob = on && ph < 0.22 ? Math.sin(ph / 0.22 * Math.PI) * 0.45 : 0;
    // 手本の指
    const show = H.demo && !busy && idle > 4;
    if (!show) { H.finger.visible = false; H.fingerT = 0; H.showing = false; return; }
    H.showing = true;
    H.fingerT += dt;
    const T = 3.0, t = H.fingerT % T;
    const from = H.demo.from(), to = H.demo.to ? H.demo.to() : null;
    if (!from) { H.finger.visible = false; return; }
    let pos = from.clone(), press = 0, alpha = 0;
    if (to) {
      if (t < 0.4) { alpha = t / 0.4; press = 0; }
      else if (t < 0.7) { alpha = 1; press = (t - 0.4) / 0.3; }
      else if (t < 2.1) { alpha = 1; press = 1; pos.lerp(to, M.easeInOut((t - 0.7) / 1.4)); }
      else if (t < 2.5) { alpha = 1 - (t - 2.1) / 0.4; press = 1 - (t - 2.1) / 0.4; pos.copy(to); }
      else { alpha = 0; }
    } else {
      // 軽く二度つつく
      alpha = t < 0.3 ? t / 0.3 : t > 2.2 ? Math.max(0, 1 - (t - 2.2) / 0.3) : 1;
      const tt = t - 0.5;
      press = tt > 0 && tt < 1.4 ? Math.max(0, Math.sin((tt / 0.7) * Math.PI)) : 0;
    }
    const cam = G.cam.camera;
    const dist = cam.position.distanceTo(pos);
    const s = dist * 0.034;
    // 指はカメラ側の上から差し出す
    const toCam = cam.position.clone().sub(pos).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const axis = toCam.multiplyScalar(0.75).add(camUp.multiplyScalar(0.65)).normalize();
    H.finger.position.copy(pos).addScaledVector(axis, (1 - press) * s * 1.6 + s * 0.15);
    H.finger.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    H.finger.scale.setScalar(s);
    H.finger.visible = alpha > 0.01;
    H.fingerMats[0].opacity = 0.42 * alpha;
    H.fingerMats[1].opacity = 0.32 * alpha;
  };
})();
