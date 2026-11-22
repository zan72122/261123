// FX preview: ?view=water|foam|dust|sparkle|stress  (+ previewkit params cam/look/fov/t)
import { startPreview } from './previewkit.js';
import { createFx } from '../fx.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const view = new URLSearchParams(location.search).get('view') || 'water';

startPreview(({ THREE, scene, ctx, camera }) => {
  const fx = createFx(ctx);
  scene.add(fx.group);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.55 });
  let tick = () => {};

  if (view === 'water') {
    fx.wetPatch(V(-0.07, 0, 0.12), 0.06, { life: 1e4 });
    fx.wetPatch(V(0.08, 0, -0.16), 0.045, { life: 1e4, dark: 0.35 });
    fx.wetPatch(V(0.06, 0, 0.22), 0.035, { life: 1e4 });
    let ts = 0, td = 0;
    tick = (dt, t) => {
      ts -= dt; td -= dt;
      if (ts <= 0) {
        ts = 0.45;
        fx.splash(V(-0.05, 0.0, -0.08), { count: 14 });
        fx.splash(V(0.05, 0.0, 0.06), { count: 12, color: 0x3b342c, speed: 1.3 });
      }
      fx.spray(V(-0.16, 0.2, -0.25), V(0.6, 0.5, 0.6), { count: 2 });
      if (td <= 0) { td = 0.3; fx.drip(V(-0.06, 0.3, 0.2), { onLand: (p) => fx.wetPatch(p, 0.012, { life: 20 }) }); }
      fx.update(dt);
    };
  } else if (view === 'foam') {
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.07, 0.09, 4, 0.02), white);
    box.position.set(0, 0.035, -0.11); box.rotation.y = 0.2; box.castShadow = box.receiveShadow = true; scene.add(box);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.1, 48), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.06 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, 0.02, 0.1); water.receiveShadow = true; scene.add(water);
    box.updateMatrixWorld(); water.updateMatrixWorld();
    const cl = [[-0.045, 0.01], [0.02, -0.015], [0.05, 0.02]];
    for (let i = 0; i < 80; i++) { // lather patches on top of the box + a few on the front side
      const c = cl[i % 3], a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * 0.02;
      const u = c[0] + Math.cos(a) * rr, w = Math.max(-0.04, Math.min(0.04, c[1] + Math.sin(a) * rr));
      const p = i % 6 ? V(u, 0.035, w) : V(u, 0.03 - Math.random() * 0.025, 0.045);
      fx.foam.add(box, p, 0.8 + Math.random() * 0.6);
    }
    for (let i = 0; i < 70; i++) { // on the water, in two patches
      const c = i % 2 ? [0.03, 0.02] : [-0.04, -0.03];
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 0.032;
      fx.foam.add(water, V(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, 0), 0.8 + Math.random() * 0.7);
    }
    for (let i = 0; i < 12; i++) fx.bubble(V((Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.12, (Math.random() - 0.5) * 0.3), { life: 1e4 });
    tick = (dt) => fx.update(dt);
  } else if (view === 'dust') {
    let td = 0, tsd = 0;
    tick = (dt) => {
      td -= dt; tsd -= dt;
      if (td <= 0) { td = 0.5; fx.dust(V((Math.random() - 0.5) * 0.2, 0.01, (Math.random() - 0.5) * 0.1), { count: 6 }); }
      if (tsd <= 0) { tsd = 0.7; fx.sand(V(-0.05 + Math.random() * 0.1, 0.12, 0), V(0.3, 1, 0.2), { count: 30 }); }
      fx.update(dt);
    };
  } else if (view === 'sparkle') {
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.08, 0.1, 4, 0.02), white);
    box.position.set(0, 0.04, 0); box.castShadow = box.receiveShadow = true; scene.add(box);
    let ts = 0;
    tick = (dt) => {
      ts -= dt;
      if (ts <= 0) { ts = 0.12; fx.sparkle(V((Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.01, (Math.random() - 0.5) * 0.1), { count: 1, spread: 0.005 }); }
      fx.update(dt);
    };
  } else if (view === 'wet') {
    for (let i = 0; i < 6; i++) fx.wetPatch(V(-0.08 + (i % 2) * 0.16, 0, -0.2 + Math.floor(i / 2) * 0.17), 0.06, { life: 1e4 });
    tick = (dt) => fx.update(dt);
  } else if (view === 'stress') {
    const parent = new THREE.Object3D(); scene.add(parent);
    const p = V(0, 0.1, 0), nd = new THREE.Vector2(0, 0);
    const fx2 = createFx(ctx); fx2.splash(p); fx2.foam.add(parent, p); fx2.bubble(p); fx2.popBubbleAt(nd, 40, camera, 844); fx2.foam.washNear(p, 0.1, 1);
    let err = null;
    try {
      for (let k = 0; k < 1000; k++) {
        fx.splash(p); fx.spray(p, V(1, 1, 0)); fx.drip(p, { onLand() {} }); fx.wetPatch(V(Math.random(), 0, Math.random()), 0.05);
        fx.ring(p, 0.05); fx.foam.add(parent, V(Math.random() * 0.1, 0, 0)); fx.foam.add(null, p, 1); fx.bubble(p);
        fx.dust(p); fx.sand(p, V(0, 1, 0)); fx.sparkle(p, { count: 3 }); fx.popBubbleAt(nd, 40, camera, 844);
        fx.foam.removeFraction(0.01, parent); fx.foam.washNear(p, 0.01, 0.1);
        fx.splash(p, undefined); fx.spray(p, undefined, undefined); fx.drip(p); fx.wetPatch(p); fx.ring(p); fx.dust(p); fx.sand(p); fx.sparkle(p);
        if (k % 10 === 0) fx.update(1 / 30);
      }
      fx.update(0.016);
      const c = {}; fx.group.children.forEach((m) => (c[m.name] = m.count + '/' + m.instanceMatrix.count));
      console.warn('STRESS ok foam=' + fx.foam.count() + ' on=' + fx.foam.countOn(parent) + ' bubbles=' + fx.bubbleCount() + ' ' + JSON.stringify(c));
      fx.setQuality(true); for (let k = 0; k < 1000; k++) { fx.splash(p); fx.foam.add(parent, p); fx.bubble(p); } fx.update(0.016);
      const c2 = {}; fx.group.children.forEach((m) => (c2[m.name] = m.count));
      console.warn('STRESS low foam=' + fx.foam.count() + ' bubbles=' + fx.bubbleCount() + ' ' + JSON.stringify(c2));
      fx.clearAll(); fx.update(0.016);
      console.warn('STRESS cleared foam=' + fx.foam.count() + ' bubbles=' + fx.bubbleCount());
    } catch (e) { err = e; console.error('STRESS FAIL', e && e.stack); }
    tick = (dt) => fx.update(dt);
  }
  return (dt, t) => tick(dt, t);
}, { cam: [0, 0.7, 0.6], look: [0, 0.05, 0], fov: 40 });
