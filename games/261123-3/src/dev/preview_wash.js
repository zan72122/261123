// Dev preview for washprops: ?view=fill|clear|murk|tilt|tools|drip|overflow  (+ previewkit cam/look/fov/t)
import { startPreview } from './previewkit.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createFaucet, createBasin, createBrush, createSoap } from '../washprops.js';

const view = new URLSearchParams(location.search).get('view') || 'fill';
const CAMS = {
  fill: { cam: [0, 1.25, 1.25], look: [0, 0.25, -0.1] },
  clear: { cam: [0.02, 0.62, 0.33], look: [0.02, 0.05, 0.0] },
  murk: { cam: [0.02, 0.62, 0.33], look: [0.02, 0.05, 0.0] },
  tilt: { cam: [0.1, 0.9, 1.3], look: [0, 0.05, 0.2] },
  tools: { cam: [0.44, 0.4, 0.6], look: [0.38, 0.03, 0.1], fov: 40 },
  drip: { cam: [0.1, 0.62, 0.35], look: [0, 0.4, -0.16] },
  overflow: { cam: [0.2, 0.55, 0.75], look: [0, 0.06, 0] },
};

startPreview(({ THREE, scene, ctx }) => {
  const t0 = performance.now();
  const faucet = createFaucet(ctx); faucet.group.position.set(0, 0, -0.40); scene.add(faucet.group);
  const t1 = performance.now();
  const basin = createBasin(ctx); scene.add(basin.group);
  const t2 = performance.now();
  const brush = createBrush(ctx);
  const t3 = performance.now();
  const soap = createSoap(ctx);
  const t4 = performance.now();
  if (new URLSearchParams(location.search).has('timing')) console.warn('washprops build ms', (performance.now() - t0).toFixed(1), 'faucet', (t1 - t0).toFixed(1), 'basin', (t2 - t1).toFixed(1), 'brush', (t3 - t2).toFixed(1), 'soap', (t4 - t3).toFixed(1));
  soap.group.position.set(0.39, 0, -0.06); scene.add(soap.group);
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xefede6, roughness: 0.7 });
  const shoes = [];
  const mkShoe = () => { const m = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.05, 0.19, 3, 0.012), shoeMat); m.castShadow = m.receiveShadow = true; return m; };
  let level = 0, murk = 0, foam = 0, flow = 0, tilt = 0, pour = 0, over = 0;
  if (view === 'fill') { level = 0.5; flow = 1; }
  if (view === 'clear') { level = 0.8; }
  if (view === 'murk') { level = 0.8; murk = 1; foam = 0.6; }
  if (view === 'tilt') { level = 0.5; murk = 1; tilt = 0.7; pour = 1; }
  if (view === 'drip') { level = 0.6; flow = 0.06; }
  if (view === 'overflow') { level = 1; over = 1; flow = 1; }
  if (view === 'tools') { level = 0.6; murk = 0.7; foam = 0.5; }
  if (['clear', 'murk', 'tools'].includes(view)) {
    for (const x of [-0.052, 0.052]) { const s = mkShoe(); s.position.set(x, basin.FLOOR_Y + level * 0.105, 0.02); s.rotation.z = x * 0.6; basin.content.add(s); shoes.push(s); }
  }
  if (view === 'tools') {
    const s = mkShoe(); s.position.set(0.36, 0.025, 0.14); s.rotation.y = 1.35; scene.add(s);
    brush.group.position.set(0.37, 0.012, 0.268); brush.group.rotation.set(0.45, Math.PI - 0.15, 0); scene.add(brush.group);
    brush.setFoam(0.6);
  }
  basin.setWater(level, murk, foam); basin.setTilt(tilt); basin.setPour(pour); basin.setOverflow(over);
  if (view === 'clear') { basin.ripple(0.03, -0.12, 1); }
  let ripT = 0;
  faucet.onDrop = (p) => { const l = basin.group.worldToLocal(p.clone()); basin.ripple(l.x, l.z, 0.6); };
  return (dt, t) => {
    faucet.setHandleAngle(t * 0.0 + 0.6);
    faucet.setFlow(flow, basin.waterY());
    basin.setWater(level, murk, foam);
    if (flow > 0.12) { basin.agitate(0.5 * flow); ripT -= dt; if (ripT <= 0) { ripT = 0.35; basin.ripple(0, -0.16, 0.8); } }
    if (view === 'clear' || view === 'murk') { ripT -= dt; if (ripT <= 0) { ripT = 1.3; basin.ripple(0.052, 0.1, 0.8); } }
    shoes.forEach((s, i) => { s.position.y = basin.FLOOR_Y + level * 0.105 + 0.004 * Math.sin(t * 1.3 + i); });
    faucet.update(dt); basin.update(dt); brush.update(dt); soap.update(dt);
  };
}, Object.assign({ fov: 40 }, CAMS[view] || CAMS.fill));
