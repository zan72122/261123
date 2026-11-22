// Dev preview for the drying props.  ?view=spinner|open|spin|pole|clip|stands  (+ ?omega= &water= &spout= &lid= &crank= &poke=)
import { startPreview } from './previewkit.js';
import { createSpinner, createPole, createHanger } from '../dryprops.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'spinner';
const num = (k, d) => (q.get(k) != null ? Number(q.get(k)) : d);
const CAMS = {
  spinner: { cam: [0, 0.62, 1.0], look: [0, 0.19, 0], fov: 40 },
  open: { cam: [0.17, 0.95, 0.6], look: [0.17, 0.08, 0], fov: 50 },
  spin: { cam: [0, 0.62, 1.0], look: [0, 0.17, 0], fov: 40 },
  pole: { cam: [-1.4, 0.9, 0.55], look: [1.25, 0.85, 0.55], fov: 50 },
  clip: { cam: [1.0, 1.1, 0.3], look: [1.25, 1.06, 0.49], fov: 32 },
  stands: { cam: [-0.4, 1.1, 3.0], look: [1.35, 0.7, 0.4], fov: 45 },
};

startPreview(({ THREE, scene, ctx }) => {
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.6 });
  const ticks = [];
  if (['spinner', 'open', 'spin'].includes(view)) {
    const sp = createSpinner(ctx); scene.add(sp.group);
    for (const s of sp.slots) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.05, 0.19), shoeMat); b.position.y = 0.025; b.castShadow = true; s.add(b); }
    sp.setLidOpen(num('lid', view === 'open' ? 1 : 0));
    sp.setCrankAngle(num('crank', 0.7));
    const omega = num('omega', view === 'spin' ? 30 : 0), water = num('water', view === 'spin' ? 0.8 : 0), spout = num('spout', view === 'spin' ? 0.8 : 0);
    sp.setSpin(omega); sp.setWater(water); sp.setSpout(spout);
    let ang = 0;
    ticks.push((dt) => { if (omega) { ang += omega / 3 * dt; sp.setCrankAngle(ang); } sp.update(dt); });
  } else {
    const pole = createPole(ctx); scene.add(pole.group);
    const hg = createHanger(ctx); scene.add(hg.group);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.19, 0.076), shoeMat); b.position.y = -0.095; b.castShadow = true;
      hg.clips[i].pivot.add(b); hg.clips[i].setLoad(1);
    }
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.29, 0.22), new THREE.MeshStandardMaterial({ color: 0xe8d070, roughness: 0.8 }));
    bag.position.y = -0.145; bag.castShadow = true; hg.clips[2].pivot.add(bag); hg.clips[2].setLoad(0.5);
    if (view === 'clip') { hg.clips[1].pivot.remove(hg.clips[1].pivot.children[0]); hg.clips[1].setLoad(0); hg.clips[1].setOpen(num('open', 0)); }
    if (q.get('poke')) hg.clips[0].poke(num('poke', 0.6), 0);
    hg.sway(num('sway', 0.3));
    ticks.push((dt) => hg.update(dt));
  }
  return (dt, t) => ticks.forEach(f => f(dt, t));
}, CAMS[view] || CAMS.spinner);
