/* guide.js — the next thing to touch glows softly and hops a little; after
   about four quiet seconds a translucent fingertip shows the gesture. */
(function () {
  'use strict';
  const U = window.U;
  const G = (U.guide = {});
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  let cur = null; // {obj, path, tap}
  let glowObj = null;
  const glowed = new Map(); // mesh -> original material
  let demo = null;

  G.init = function (scene) {
    G.finger = U.kit.buildFinger();
    G.finger.visible = false;
    scene.add(G.finger);
    U.core.addUpdate(G.update, 90);
    U.core.onAnyDown.push(() => {
      demo = null;
      G.finger.visible = false;
    });
  };

  function unglow() {
    glowed.forEach((orig, mesh) => { mesh.material = orig; });
    glowed.clear();
    if (glowObj && glowObj.userData.vis) glowObj.userData.vis.position.y = 0;
    glowObj = null;
  }
  function glow(obj) {
    if (glowObj === obj) return;
    unglow();
    glowObj = obj;
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.collider || o.isInstancedMesh) return;
      if (o.userData.noodle) return;
      const m = o.material;
      if (!m || !m.emissive) return;
      const c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile;
      glowed.set(o, m);
      o.material = c;
    });
  }

  G.set = function (h) {
    if (!h) {
      if (cur) { cur = null; unglow(); demo = null; G.finger.visible = false; }
      return;
    }
    if (!cur || cur.key !== h.key) demo = null;
    cur = h;
    glow(h.obj || null);
  };

  function pathPoints() {
    if (!cur) return null;
    const p = typeof cur.path === 'function' ? cur.path() : cur.path;
    return p && p.length ? p : null;
  }

  G.update = function (dt, t) {
    const C = U.core;
    const busy = !!C.drag;
    // glow pulse
    const pulse = busy ? 0 : 0.5 + 0.5 * Math.sin(t * 3.2);
    glowed.forEach((orig, mesh) => {
      const m = mesh.material;
      m.emissive.setRGB(0.42 * pulse, 0.3 * pulse, 0.12 * pulse);
      m.emissiveIntensity = 1;
    });
    if (cur && cur.dynGlow) {
      // meshes that rebuild (dough, flour): tint via their own material
      const m = cur.dynGlow.material;
      if (m && m.emissive) m.emissive.setRGB(0.22 * pulse, 0.16 * pulse, 0.06 * pulse);
    }
    if (G.lastDyn && (!cur || G.lastDyn !== cur.dynGlow)) {
      if (G.lastDyn.material && G.lastDyn.material.emissive) G.lastDyn.material.emissive.setRGB(0, 0, 0);
    }
    G.lastDyn = cur ? cur.dynGlow : null;
    // small hop after a moment of stillness
    if (glowObj && glowObj.userData.vis) {
      const idle = C.idle();
      const ph = (t % 1.6) / 1.6;
      glowObj.userData.vis.position.y = !busy && idle > 1.2 && ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) * 0.05 : 0;
    }
    // ghost finger
    const idle = C.idle();
    const pts = pathPoints();
    if (!busy && pts && idle > 4 && C.firstTouchDone !== undefined) {
      if (!demo) demo = { t: 0 };
      runDemo(dt, pts);
    } else {
      G.finger.visible = false;
      if (busy || idle < 4) demo = null;
    }
  };

  function runDemo(dt, pts) {
    demo.t += dt;
    const f = G.finger, mat = f.userData.mat;
    // timeline
    const appear = 0.4, press = 0.25, hold = cur && cur.tap ? 0.15 : 0.05;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const travel = cur && cur.tap ? 0 : U.clamp(len * 0.9, 0.6, 2.2);
    const lift = 0.3, pause = 1.0;
    const T = appear + press + hold + travel + lift + pause;
    let tt = demo.t % T;
    let pos, depth = 0.3, op = 0;
    if (tt < appear) { pos = pts[0]; op = tt / appear; depth = 0.35; }
    else if ((tt -= appear) < press) { pos = pts[0]; op = 1; depth = 0.35 * (1 - U.easeInOut(tt / press)); }
    else if ((tt -= press) < hold) { pos = pts[0]; op = 1; depth = 0; }
    else if ((tt -= hold) < travel) {
      const k = U.easeInOut(tt / travel);
      pos = along(pts, k * len);
      op = 1; depth = 0;
    } else if ((tt -= travel) < lift) { pos = pts[pts.length - 1]; op = 1 - tt / lift; depth = 0.35 * (tt / lift); }
    else { pos = pts[pts.length - 1]; op = 0; }
    // point the fingertip at the spot from the camera side
    const cam = U.core.camera.position;
    const dir = _v.copy(cam).sub(pos).normalize().multiplyScalar(0.55).add(_v2.set(0, 0.45, 0)).normalize();
    f.position.copy(pos).addScaledVector(dir, depth + 0.02);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const sq = depth < 0.02 ? 0.92 : 1;
    // keep the fingertip a similar size on screen whatever the camera distance
    const ds = U.clamp(cam.distanceTo(pos) / 7, 0.7, 3.2);
    f.scale.set(ds / sq, ds * sq, ds / sq);
    f.position.copy(pos).addScaledVector(dir, (depth + 0.02) * ds);
    mat.opacity = 0.45 * op;
    f.visible = op > 0.01;
  }
  function along(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const l = pts[i].distanceTo(pts[i - 1]);
      if (d <= l || i === pts.length - 1) return new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], U.clamp(d / Math.max(l, 1e-4), 0, 1));
      d -= l;
    }
    return pts[pts.length - 1].clone();
  }
})();
