// Engine self-check: mock modules + 3 mock stages (drag -> circle -> tap -> wraps).
// URL: ?stage=<id> (start there via a fake save), ?fresh (clear save), ?fixedres (no dynamic res), ?boxes=0 (hide shot boxes)
import * as THREE from 'three';
import { boot } from '../engine/boot.js';
import { addReferenceLights } from '../lightrig.js';
import { SHOTS, L } from '../layout.js';

const SAVE_KEY = 'engine-preview-save';
const q = new URLSearchParams(location.search);
try {
  if (q.has('fresh')) localStorage.removeItem(SAVE_KEY);
  if (q.get('stage')) localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, stage: q.get('stage'), t: Date.now(), state: { v: 1, taps: 0, restoredFrom: q.get('stage') } }));
} catch (e) { /* ignore */ }

const log = (window.__log = []);
const std = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r });

function createModules(ctx) {
  const { scene } = ctx;
  // world
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), std(0x9a9892, 0.92));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.2), std(0xd8d2c4, 0.9));
  wall.position.set(0, 1.5, L.WALL_Z - 0.1); wall.receiveShadow = true; scene.add(wall);
  scene.background = new THREE.Color(0xbfd3e6);
  const { sun } = addReferenceLights(scene);
  const world = {
    setShadowFocus(c, r) {
      sun.target.position.copy(c); sun.position.copy(c).add(new THREE.Vector3(0.55, 0.78, 0.30).normalize().multiplyScalar(6));
      const sc = sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.updateProjectionMatrix();
      log.push('focus ' + c.toArray().map((v) => v.toFixed(2)).join(',') + ' r' + r.toFixed(2));
    },
    setQuality(low) { log.push('world low ' + low); },
  };
  // fx: glints
  const glints = [];
  const gtex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,240,1)'); rg.addColorStop(0.25, 'rgba(255,245,210,0.5)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const fx = {
    sparkle(pos) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.copy(pos); s.userData.t = 0; scene.add(s); glints.push(s);
    },
    setQuality(low) { log.push('fx low ' + low); },
    update(dt) {
      for (let i = glints.length - 1; i >= 0; i--) {
        const s = glints[i]; s.userData.t += dt; const k = s.userData.t / 0.6;
        const a = Math.sin(Math.PI * Math.min(1, k)); s.scale.setScalar(0.03 + 0.03 * a); s.material.opacity = a;
        if (k >= 1) { scene.remove(s); s.material.dispose(); glints.splice(i, 1); }
      }
    },
  };
  const audio = {
    unlock() { log.push('unlock'); }, suspend() { log.push('suspend'); }, resume() { log.push('resume'); },
    play(n) { log.push('play ' + n); },
  };
  // props
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16), std(0xc0392b, 0.5));
  box.castShadow = true; scene.add(box);
  const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.004, 40), std(0x2e86c1, 0.4));
  spot.position.set(0.12, 0.002, -0.12); spot.receiveShadow = true; scene.add(spot);
  const drum = new THREE.Group(); drum.position.fromArray(L.SPINNER); scene.add(drum);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.38, 48), std(0xe8e4da, 0.4));
  body.position.y = 0.19; body.castShadow = body.receiveShadow = true; drum.add(body);
  const crank = new THREE.Group(); crank.position.y = 0.4; drum.add(crank);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.02), std(0x777777, 0.3)); arm.position.x = 0.055; arm.castShadow = true; crank.add(arm);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 16), std(0xd35400, 0.5)); knob.position.set(0.1, 0.025, 0); knob.castShadow = true; crank.add(knob);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.5, 16), std(0x5d8aa8, 0.3));
  pole.rotation.x = Math.PI / 2; pole.position.set(L.POLE.x, L.POLE.y, 0.55); pole.castShadow = true; scene.add(pole);
  const hangBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.24), std(0xf2f0ea, 0.6));
  hangBox.castShadow = true; hangBox.position.set(L.POLE.x, 0.98, 0.49); scene.add(hangBox);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.29, 6), std(0x333333)); string.position.set(L.POLE.x, 1.175, 0.49); scene.add(string);
  // dev: visualize the shot boxes
  if (q.get('boxes') !== '0') {
    for (const k of ['dunk', 'spin', 'hang']) {
      const b = SHOTS[k].box;
      const h = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), 0xffee00);
      scene.add(h);
    }
  }
  Object.assign(ctx, { world, fx, audio, mock: { box, spot, drum, crank, knob, hangBox } });
  return [world, fx];
}

const BOX_START = new THREE.Vector3(-0.28, 0.05, 0.42);

const stageDrag = {
  id: 'A', shot: SHOTS.dunk,
  place(ctx) { const { box } = ctx.mock; box.position.copy(BOX_START); box.rotation.set(0, 0.3, 0); },
  enter(ctx) {
    const { box, spot } = ctx.mock;
    this.grab = null; this.done = false;
    ctx.hint.set({
      target: box,
      gesture: { type: 'drag', to: () => spot.position.clone().setY(0.05) },
      wobble: (k, t) => { box.rotation.z = 0.22 * k * Math.sin(t * 28); box.position.y = 0.05 + 0.02 * k; },
      cue: () => ctx.audio.play('tock'),
    });
  },
  onDown(p, ctx) {
    if (this.done) return;
    const hit = ctx.pickNearest(p, [{ obj: ctx.mock.box, radiusPx: 70, data: 'box' }]);
    if (hit) { this.grab = { off: ctx.rayPlaneY(p, 0.05).sub(ctx.mock.box.position) }; log.push('grab ' + hit.dist.toFixed(0)); }
  },
  onMove(p, ctx) {
    if (!this.grab) return;
    const hp = ctx.rayPlaneY(p, 0.05); if (!hp) return;
    ctx.mock.box.position.copy(hp.sub(this.grab.off)).setY(0.08);
    ctx.hint.nudge();
  },
  onUp(p, ctx) {
    if (!this.grab) return;
    this.grab = null;
    const { box, spot } = ctx.mock;
    box.position.y = 0.05;
    const d = Math.hypot(box.position.x - spot.position.x, box.position.z - spot.position.z);
    log.push('drop ' + d.toFixed(3) + (p.cancelled ? ' cancelled' : ''));
    if (d < 0.12) {
      this.done = true; ctx.hint.clear();
      const from = box.position.clone();
      ctx.tl.tween(0.3, (k) => box.position.lerpVectors(from, spot.position.clone().setY(0.054), k), 'outBack')
        .then(() => ctx.tl.after(0.5, () => ctx.flow.next()));
    }
  },
  exit() { log.push('exit A'); },
};

const stageCircle = {
  id: 'B', shot: SHOTS.spin,
  place(ctx) { ctx.mock.crank.rotation.y = 0; },
  enter(ctx) {
    this.acc = 0; this.prevA = null; this.done = false;
    const c = new THREE.Vector3(L.SPINNER[0], 0.43, L.SPINNER[2]);
    this.center = c;
    ctx.hint.set({
      target: ctx.mock.knob,
      gesture: { type: 'circle', center: () => c, radius: 0.1 },
      wobble: (k, t) => { ctx.mock.crank.rotation.y = 0.25 * k * Math.sin(t * 20); },
    });
  },
  onDown(p) { this.prevA = null; },
  onMove(p, ctx) {
    if (this.done) return;
    const s = ctx.project(this.center);
    const a = Math.atan2(p.y - s.y, p.x - s.x);
    if (this.prevA != null && Math.hypot(p.x - s.x, p.y - s.y) > 15) {
      let d = a - this.prevA; d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.acc += Math.abs(d);
      ctx.mock.crank.rotation.y -= d;
      ctx.hint.nudge();
      if (this.acc > Math.PI * 4) { this.done = true; ctx.hint.clear(); ctx.state.spun = true; ctx.saveSoon(); ctx.tl.after(0.6, () => ctx.flow.next()); }
    }
    this.prevA = a;
  },
};

const stageTap = {
  id: 'C', shot: SHOTS.hang,
  place(ctx) { ctx.mock.hangBox.position.set(L.POLE.x, 0.98, 0.49); ctx.mock.hangBox.rotation.set(0, 0, 0); },
  enter(ctx) {
    const b = ctx.mock.hangBox;
    ctx.hint.set({ target: b, gesture: { type: 'tap' }, wobble: (k, t) => { b.rotation.x = 0.2 * k * Math.sin(t * 18); } });
  },
  onUp(p, ctx) {
    if (!p.isTap) return;
    const b = ctx.mock.hangBox;
    if (!ctx.pickNearest(p, [{ obj: b, radiusPx: 80 }])) return;
    ctx.hint.clear(); ctx.state.taps++; ctx.saveSoon();
    ctx.tl.tween(0.5, (k) => { b.position.y = 0.98 + Math.sin(Math.PI * k) * 0.1; }, 'linear').then(() => log.push('KILLED TWEEN RESOLVED (bug)'));
    ctx.flow.next(); ctx.flow.next(); // re-entrancy check: these coalesce into one (and happen at end of frame)
  },
};

boot({
  createModules,
  stages: [stageDrag, stageCircle, stageTap],
  defaultState: () => ({ v: 1, taps: 0 }),
  saveKey: SAVE_KEY,
});
