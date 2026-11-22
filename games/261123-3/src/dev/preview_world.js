// Dev preview for the WORLD module: own boot (only world lights), stand-in props for scale.
// URL: ?cam=x,y,z&look=x,y,z&fov=50&tod=0.3&t=seconds
import * as THREE from 'three';
import { setupRenderer, makeEnvironment } from '../lightrig.js';
import { createWorld } from '../world.js';
import { L } from '../layout.js';

const q = new URLSearchParams(location.search);
const v3 = (s, d) => (s ? s.split(',').map(Number) : d);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
setupRenderer(renderer);
const scene = new THREE.Scene();
scene.environment = makeEnvironment(renderer);
const camera = new THREE.PerspectiveCamera(Number(q.get('fov')) || 40, 1, 0.02, 200);
camera.position.fromArray(v3(q.get('cam'), [0, 1.1, 1.0]));
camera.lookAt(new THREE.Vector3().fromArray(v3(q.get('look'), [0, 0, -0.1])));
const low = q.get('low') === '1';
const ctx = { renderer, scene, camera, quality: { low, particleScale: 1 }, time: 0 };

const t0 = performance.now();
const world = createWorld(ctx);
const ms = performance.now() - t0;
scene.add(world.group);
world.setTimeOfDay(Number(q.get('tod')) || 0);
if (q.get('focus')) world.setShadowFocus(new THREE.Vector3(...v3(q.get('focus'))), Number(q.get('fr')) || 1.6);

// stand-in props
const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
add(new THREE.BoxGeometry(0.08, 0.07, 0.19), white, L.GROUND_SLOTS[0][0], 0.035, L.GROUND_SLOTS[0][2]);
add(new THREE.CylinderGeometry(0.27, 0.24, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x2f6fc0, roughness: 0.35 }), 0, 0.1, 0);
const grey = new THREE.MeshStandardMaterial({ color: 0x9a9ea2, roughness: 0.35, metalness: 0.7 });
const pole = add(new THREE.CylinderGeometry(0.016, 0.016, L.POLE.maxZ - L.POLE.minZ, 16), grey, L.POLE.x, L.POLE.y, (L.POLE.minZ + L.POLE.maxZ) / 2);
pole.rotation.x = Math.PI / 2;
for (const z of [L.POLE.minZ + 0.1, L.POLE.maxZ - 0.1]) add(new THREE.CylinderGeometry(0.02, 0.025, L.POLE.y + 0.1, 12), grey, L.POLE.x, (L.POLE.y + 0.1) / 2, z);
for (const z of L.CLIP_Z.slice(0, 2)) add(new THREE.BoxGeometry(0.07, 0.19, 0.08), white, L.POLE.x, L.CLIP_Y - 0.1, z);

const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
let tris = 0;
let last = performance.now(), frames = 0;
(function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  world.update(dt);
  renderer.render(scene, camera);
  if (++frames === 2) { tris = renderer.info.render.triangles; console.warn(`world build ${ms.toFixed(0)} ms, tris ${tris}, calls ${renderer.info.render.calls}`); }
  window.__ready = true;
  requestAnimationFrame(loop);
})(last);
window.__preview = { scene, camera, renderer, ctx, world, THREE };
