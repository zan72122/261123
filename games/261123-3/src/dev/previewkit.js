// Dev-only preview harness for looking at one module in the standard light.
// Usage (in src/dev/preview_xxx.js):
//   import { startPreview } from './previewkit.js';
//   startPreview(({ THREE, scene, ctx }) => { ...add objects...; return (dt, t) => { ...per-frame... }; },
//                { cam: [x,y,z], look: [x,y,z], fov: 40, ground: true });
// URL params override the camera: ?cam=0.5,0.6,0.8&look=0,0.05,0&fov=35   and ?t=1.5 freezes time for stills.
import * as THREE from 'three';
import { setupRenderer, makeEnvironment, addReferenceLights } from '../lightrig.js';

export function startPreview(setup, opts = {}) {
  const q = new URLSearchParams(location.search);
  const v3 = (s, d) => (s ? s.split(',').map(Number) : d);
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  setupRenderer(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd3e6);
  scene.environment = makeEnvironment(renderer);
  addReferenceLights(scene);
  const camera = new THREE.PerspectiveCamera(Number(q.get('fov')) || opts.fov || 40, 1, 0.02, 200);
  camera.position.fromArray(v3(q.get('cam'), opts.cam || [0.5, 0.6, 0.9]));
  const look = new THREE.Vector3().fromArray(v3(q.get('look'), opts.look || [0, 0.05, 0]));
  camera.lookAt(look);
  if (opts.ground !== false) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x9a9892, roughness: 0.92 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  }
  const ctx = { THREE, renderer, scene, camera, quality: { low: false, particleScale: 1 }, time: 0 };
  const tick = setup({ THREE, scene, camera, renderer, ctx }) || (() => {});
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  const freeze = q.get('t') != null ? Number(q.get('t')) : null;
  let last = performance.now(), t = 0;
  if (freeze != null) { // advance simulation deterministically to t, then render stills
    const step = 1 / 60; while (t < freeze) { t += step; ctx.time = t; tick(step, t); }
  }
  (function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (freeze == null) { t += dt; ctx.time = t; tick(dt, t); }
    renderer.render(scene, camera);
    window.__ready = true;
    requestAnimationFrame(loop);
  })(last);
  window.__preview = { scene, camera, renderer, ctx, THREE };
}
