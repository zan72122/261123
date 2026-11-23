// guide.js — 次に触る物を一つだけ光らせ、小さく弾ませる。約4秒触らなければ半透明の指が手本を見せる。
(function () {
  'use strict';
  const S = window.S23, W = S.world, D = S.DIM;
  const V3 = THREE.Vector3;
  const GD = (S.guide = {});

  let target = null;     // { kind, ref }
  let idle = 0;
  let t = 0, hopT = 0;
  let demoT = 0;
  GD.idle = () => idle;

  // ---- 半透明の指（立体） ----
  const oScene = new THREE.Scene();
  const oCam = new THREE.OrthographicCamera(0, 1, 0, -1, -500, 500);
  oScene.add(new THREE.HemisphereLight(0xffffff, 0xd8c8b0, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-0.4, 1, 1); oScene.add(dl);
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xfff6ee, roughness: 0.55, transparent: true, opacity: 0.0, depthWrite: false });
  const nailMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.0, depthWrite: false });
  const finger = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1, 3.6, 8, 16), fingerMat);
  body.position.y = -2.8; // 先が原点
  finger.add(body);
  const nail = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), nailMat);
  nail.scale.set(1, 1.25, 0.35);
  nail.position.set(0, -1.25, 0.78);
  finger.add(nail);
  oScene.add(finger);
  finger.visible = false;
  function resize() {
    oCam.left = 0; oCam.right = W.width; oCam.top = 0; oCam.bottom = -W.height;
    oCam.updateProjectionMatrix();
  }
  S.events.on('resize', resize);
  resize();
  const fingerScale = () => Math.max(9, Math.min(W.width, W.height) * 0.032);

  GD.setTarget = function (tg) {
    const same = target && tg && target.kind === tg.kind && target.ref === tg.ref;
    if (!same) {
      clearGlow();
      target = tg;
      demoT = 0;
    }
  };
  GD.getTarget = () => target;
  GD.touched = function () { idle = 0; demoT = 0; finger.visible = false; };
  GD.firstTouch = function () {
    // 最初のタップ：次の物が大きく弾む
    hopT = 2.2;
    doHop(2.2);
    idle = 3.2; // すぐに指の手本も
  };

  function clearGlow() {
    if (!target) return;
    applyGlow(0);
  }
  function applyGlow(k) {
    if (!target) return;
    const r = target.ref;
    switch (target.kind) {
      case 'panel': S.box.setGlow(r, k); break;
      case 'prize': r.setGlow(k); break;
      case 'bar': S.crane.setGlow('bar', k); break;
      case 'arm': S.crane.setGlow('arm', k); break;
      case 'tip': S.crane.setGlow('tip', k); break;
      case 'loop': S.crane.setGlow('loop', k); break;
      case 'barEnd': S.crane.setGlow('bar', k); break;
    }
  }
  function doHop(strength) {
    if (!target) return;
    const r = target.ref, s = strength || 1;
    switch (target.kind) {
      case 'panel': S.box.hopPanel(r, (r.angle > 1.2 ? -0.05 : 0.07) * s); break;
      case 'prize': {
        const b = r.body;
        if (b.mode === 'dyn' && !r.held) { b.wake(); b.vel.y += 38 * Math.min(s, 1.4); b.ang.x += (S.rand() - 0.5) * 2; }
        break;
      }
      case 'tip': { const p = S.crane.rope.p; for (let i = S.crane.rope.n - 5; i < S.crane.rope.n; i++) p[i].y += 0.35 * s; break; }
      case 'loop': S.crane.nudgeLoop(9 * s, 4 * s); break;
      case 'bar': case 'barEnd': S.crane.hopBar && S.crane.hopBar(0.5 * s); break;
      case 'arm': S.crane.hopArm && S.crane.hopArm(0.5 * s); break;
    }
  }

  // 手本の道筋（ワールド座標の点列）
  const _a = new V3(), _b = new V3();
  function demoPath() {
    if (!target) return null;
    const r = target.ref, C = S.crane;
    switch (target.kind) {
      case 'panel': { const gs = S.box.gesture(r); return { screen: [[gs.ax, gs.ay], [gs.bx, gs.by]] }; }
      case 'prize': return [r.body.pos.clone(), new V3(S.clamp(r.body.pos.x * 0.2 - 5, -11, -1.5), 2, D.ARM_Z)];
      case 'bar': {
        const p = C.barEndWorld(-1, new V3());
        const q = S.box.slotPoint(-1, 'high', new V3());
        return [p, q];
      }
      case 'barEnd': { const p = C.barEndWorld(-1, new V3()); return [p, p.clone().add(new V3(0, 8, 4))]; }
      case 'arm': return [C.state.armPos.clone(), C.pegMid(new V3()).add(new V3(0, -1, 0))];
      case 'tip': return [C.tipWorld().clone(), C.frontPulleyCenter(new V3())];
      case 'loop': {
        const l = C.loopWorld().clone(); l.y -= D.LOOP_R * 0.7;
        const dir = C.state.tx > 4 ? -1 : 1;
        return [l, l.clone().add(new V3(0, -3.2, 0)), l.clone().add(new V3(dir * 7, -3.2, 0))];
      }
    }
    return null;
  }

  const sp = { x: 0, y: 0, z: 0 };
  function placeFinger(path, u, press) {
    // path を u(0..1) でたどる（ワールドの点列か、画面の点列）
    if (path.screen) {
      const q = path.screen, n = q.length - 1;
      const f = S.clamp(u, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(f)), t = f - i;
      sp.x = S.lerp(q[i][0], q[i + 1][0], t); sp.y = S.lerp(q[i][1], q[i + 1][1], t);
    } else {
      const n = path.length - 1;
      const f = S.clamp(u, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(f));
      const p = _a.lerpVectors(path[i], path[i + 1], f - i);
      S.toScreen(W.camera, p, W.width, W.height, sp);
    }
    const s = fingerScale() * (1 + (1 - press) * 0.18);
    finger.scale.setScalar(s);
    finger.position.set(sp.x + (1 - press) * s * 0.4, -sp.y - (1 - press) * s * 0.5, 0);
    finger.rotation.set(0.5, -0.25, 0.42);
  }

  GD.update = function (dt, interacting) {
    t += dt;
    if (interacting) idle = 0; else idle += dt;
    if (!target) { finger.visible = false; return; }
    // 光る
    const k = 0.55 + 0.45 * Math.sin(t * 3.6);
    applyGlow(interacting ? 0.2 : k);
    // 小さく弾む
    hopT -= dt;
    if (hopT <= 0 && !interacting) { hopT = 2.4; doHop(1); }
    // 指の手本
    if (idle > 4 && !interacting) {
      const path = demoPath();
      if (!path) { finger.visible = false; return; }
      demoT += dt;
      const cyc = 2.8, tt = demoT % cyc;
      let u, press, op;
      if (tt < 0.45) { u = 0; press = S.smooth(tt / 0.45); op = S.smooth(tt / 0.3); }
      else if (tt < 2.0) { u = S.smooth((tt - 0.45) / 1.55); press = 1; op = 1; }
      else if (tt < 2.4) { u = 1; press = 1 - S.smooth((tt - 2.0) / 0.4); op = 1 - S.smooth((tt - 2.1) / 0.3); }
      else { u = 1; press = 0; op = 0; }
      finger.visible = true;
      fingerMat.opacity = 0.42 * op; nailMat.opacity = 0.3 * op;
      placeFinger(path, u, press);
    } else {
      finger.visible = false;
      demoT = 0;
    }
  };
  GD.render = function (renderer) {
    if (!finger.visible) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(oScene, oCam);
    renderer.autoClear = true;
  };
})();
