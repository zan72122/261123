// Shoes + bag preview: ?view=pair|dirty|half|side|top|bag|baghang  (+ previewkit params cam/look/fov/t)
import { startPreview } from './previewkit.js';
import { createShoe } from '../shoes.js';
import { createBag } from '../bag.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'pair';
const CAMS = {
  pair: { cam: [0.02, 0.42, 0.22], look: [0.02, 0.03, 0], fov: 45 },
  dirty: { cam: [0.02, 0.42, 0.22], look: [0.02, 0.03, 0], fov: 45 },
  half: { cam: [0.02, 0.42, 0.22], look: [0.02, 0.03, 0], fov: 45 },
  side: { cam: [0.22, 0.12, 0.18], look: [0, 0.03, 0], fov: 40 },
  top: { cam: [0.0, 0.5, 0.001], look: [0, 0, 0], fov: 30 },
  bag: { cam: [0.32, 0.42, 0.42], look: [0, 0.02, 0.03], fov: 45 },
  baghang: { cam: [0.0, 0.78, 0.62], look: [0, 0.80, 0], fov: 45 },
};

startPreview(({ THREE, scene, ctx }) => {
  const shoes = [];
  const mk = (side) => { const s = createShoe(ctx, { side }); scene.add(s.group); shoes.push(s); return s; };
  let bag = null;
  if (['pair', 'dirty', 'half', 'top'].includes(view)) {
    const L = mk('L'), R = mk('R');
    L.group.position.x = -0.053; R.group.position.x = 0.053;
    if (view === 'pair' || view === 'top') { L.cleanAll(); R.cleanAll(); }
    if (view === 'half') {
      for (const s of [L, R]) {
        // a few brush strokes, several passes each
        // brush calls ~1.7 mm apart (60 fps at 10 cm/s): toe area 4 passes, mid 2 passes, heel 1 pass
        const stroke = (x0, z0, x1, z1, r, passes) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.0017); for (let p = 0; p < passes; p++) for (let k = 0; k <= n; k++) { const t = p & 1 ? 1 - k / n : k / n; s.scrubAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r, 1); } };
        stroke(-0.03, -0.075, 0.03, -0.065, 0.018, 4);
        stroke(-0.03, -0.045, 0.03, -0.04, 0.018, 3);
        stroke(-0.02, -0.01, 0.03, 0.0, 0.016, 2);
        stroke(-0.02, 0.04, 0.02, 0.05, 0.016, 1);
        s.setWet(1);
      }
    }
  } else if (view === 'side') {
    mk('R').cleanAll();
  } else if (view === 'bag') {
    bag = createBag(ctx); scene.add(bag.group);
    bag.setPose('lying'); bag.setFill(2); bag.setDusty(1); bag.setOpen(1);
    const s = mk('R');
    bag.group.updateMatrixWorld(true);
    bag.mouth.add(s.group);
    s.group.position.set(0.0, -0.002, -0.06);
    s.group.rotation.set(0, 0, -Math.PI / 2 + 0.25);
  } else if (view === 'baghang') {
    bag = createBag(ctx); scene.add(bag.group);
    bag.setPose('hanging'); bag.setFill(2); bag.setDusty(0); bag.setOpen(0.55);
    bag.group.position.set(-0.08, 0.98, 0);
    for (const [i, side] of [[0, 'L'], [1, 'R']]) {
      const s = mk(side); s.cleanAll(); s.setShine(0.6);
      bag.mouth.add(s.group);
      s.group.position.set(i ? 0.03 : -0.03, 0.0, -0.08);
      s.group.rotation.set(0, 0, (i ? 1 : -1) * 1.45);
    }
    const h = mk('R'); h.cleanAll(); h.setShine(0.6);
    h.group.position.set(0.12, 0.98, 0);
    h.group.rotation.set(-Math.PI / 2, 0, 0); // heel up, toe down
    h.group.position.y = 0.98 - 0.095; // heel tab near the clip
    // clip marker lines
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.6, roughness: 0.3 }));
    pole.rotation.z = Math.PI / 2; pole.position.set(0.02, 0.99, 0); scene.add(pole);
  }
  return (dt) => { for (const s of shoes) s.update(dt); if (bag) bag.update(dt); };
}, CAMS[view] || CAMS.pair);
