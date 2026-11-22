// Shared game logic used by every stage: persisted state, shoe placement, carrying, and the
// always-running tap/water simulation.
import * as THREE from 'three';
import { L } from './layout.js';

export const TAP_FULL = Math.PI * 1.4;   // handle angle (rad) for a fully open tap
export const TAP_MAX = TAP_FULL * 1.12;
export const LEVEL_K = 0.105;            // water depth (m) at level 1
export const DRAFT = 0.02;               // how deep a floating shoe sits
export const FILL_OK = 0.7;              // water level that counts as "filled"

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;

export function defaultState() {
  return {
    v: 3, loops: 0,
    shoes: [{ dirt: null, wet: 0, shine: 0 }, { dirt: null, wet: 0, shine: 0 }],
    pulled: 0,                    // shoes already out of the bag (0..2)
    tap: 0,                       // tap handle angle (rad); open = |tap| / TAP_FULL
    water: { level: 0, murk: 0, foam: 0 },
    dunked: [false, false],
    scrubbed: [false, false],
    dumped: false, rinse: 0,
    loaded: [false, false],
    dry: 0,
    hung: [false, false],
    packed: [false, false],
  };
}

// Push the persisted look of both shoes (dirt / wet / shine) onto the meshes. Call from place().
export function applyShoeState(ctx) {
  for (let i = 0; i < 2; i++) {
    const s = ctx.state.shoes[i], shoe = ctx.shoes[i];
    if (s.dirt == null) shoe.setDirtFull(); else if (s.dirt === 'clean') shoe.cleanAll(); else shoe.deserialize(s.dirt);
    shoe.setWet(s.wet); shoe.setShine(s.shine);
  }
}

// ---------------------------------------------------------------------------------------------
// Shoe placement. where: 'hidden' | 'ground' | 'basin' | 'spinner' | 'clip' | 'packed'
// ---------------------------------------------------------------------------------------------
// hanging from a clothespin: toe down, top of the shoe faces -X (toward the garden-view camera)
const Q_HANG = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI / 2, 0, 'YXZ'));

function floatY(ctx) {
  const b = ctx.basin, lv = ctx.state.water.level;
  return Math.max(b.FLOOR_Y, b.FLOOR_Y + lv * LEVEL_K - DRAFT);
}

export function shoePose(ctx, i, where) {
  const shoe = ctx.shoes[i];
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  let parent = ctx.scene;
  if (where === 'ground') {
    pos.fromArray(L.GROUND_SLOTS[i]);
    quat.setFromEuler(new THREE.Euler(0, i ? -0.5 : 0.35, 0));
  } else if (where === 'basin') {
    parent = ctx.basin.content;
    pos.set(L.BASIN_SLOTS[i][0], floatY(ctx), L.BASIN_SLOTS[i][1]);
    quat.setFromEuler(new THREE.Euler(0, i ? -0.07 : 0.07, 0));
  } else if (where === 'spinner') {
    parent = ctx.spinner.slots[i];
  } else if (where === 'clip') {
    parent = ctx.hanger.clips[i].pivot;
    quat.copy(Q_HANG);
    const grip = new THREE.Vector3(0, shoe.HEIGHT - 0.006, shoe.LENGTH / 2 - 0.004).applyQuaternion(quat);
    pos.copy(grip).multiplyScalar(-1);            // the clothespin grips the top of the heel collar
  } else if (where === 'packed') {
    const pp = packedPose(ctx, i);
    parent = pp.parent; pos.copy(pp.pos); quat.copy(pp.quat);
  }
  return { parent, pos, quat };
}

// Pose of shoe i inside the HANGING bag: child of bag.mouth, toe down, white heel peeking out of the mouth,
// the shoe's opening facing the bag's front.
export function packedPose(ctx, i) {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
  return { parent: ctx.bag.mouth, pos: new THREE.Vector3(i ? 0.04 : -0.04, 0.024, -0.05), quat };
}

// Pose of a shoe peeking out of the mouth of the LYING bag (heel sticks out ~4.5 cm). out = extra metres pulled out.
export function peekPose(ctx, out = 0) {
  return { parent: ctx.bag.mouth, pos: new THREE.Vector3(0, -ctx.bag.mouth.position.y + 0.004, -0.035 + out), quat: new THREE.Quaternion() };
}

// Hang the bag from clip 2 (garden stages) or lay it on the terrace (wash stages).
export function placeBag(ctx, hanging) {
  const bag = ctx.bag;
  if (hanging) {
    bag.setPose('hanging');
    ctx.hanger.clips[2].pivot.add(bag.group);
    bag.group.position.set(0, 0, 0);
    bag.group.rotation.set(0, -Math.PI / 2, 0);     // flat front toward -X (the garden-view camera)
    ctx.hanger.clips[2].setOpen(0); ctx.hanger.clips[2].setLoad(0.6);
  } else {
    bag.setPose('lying');
    ctx.scene.add(bag.group);
    bag.group.position.fromArray(L.BAG_START);
    bag.group.rotation.set(0, L.BAG_YAW, 0);
    if (ctx.hanger) ctx.hanger.clips[2].setLoad(0);
  }
}

export function putShoe(ctx, i, where) {
  const g = ctx.shoes[i].group, rig = ctx.rigs[i];
  rig.where = where; rig.press = 0; rig.kx = 0; rig.kz = 0; rig.slide = 0;
  g.visible = where !== 'hidden';
  g.scale.setScalar(1);
  if (where === 'hidden') { ctx.scene.add(g); return; }
  const p = shoePose(ctx, i, where);
  p.parent.add(g);
  g.position.copy(p.pos); g.quaternion.copy(p.quat);
}

// Smoothly move obj (keeping its current world transform) into `parent` at local pos/quat, along a little arc.
export function flyTo(ctx, obj, parent, pos, quat, dur = 0.4, arc = 0.08, ease = 'inOut', tl = ctx.tl) {
  parent.attach(obj);
  obj.scale.setScalar(1);
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone();
  return tl.tween(dur, (k) => {
    obj.position.lerpVectors(p0, pos, k);
    obj.position.y += arc * 4 * k * (1 - k);
    obj.quaternion.slerpQuaternions(q0, quat, k);
  }, ease);
}

// Fly shoe i to its canonical pose at `where`; rig.where is 'fly' meanwhile.
export function flyShoe(ctx, i, where, dur = 0.4, arc = 0.08, ease = 'inOut') {
  const p = shoePose(ctx, i, where), rig = ctx.rigs[i];
  rig.where = 'fly';
  return flyTo(ctx, ctx.shoes[i].group, p.parent, p.pos, p.quat, dur, arc, ease).then(() => { rig.where = where; });
}

// ---------------------------------------------------------------------------------------------
// Carry: drag an object from where it is toward a target. It follows the finger on a plane through
// source and target (so reaching the target on screen means reaching it in 3D), lifted in an arc,
// and floats a little above the fingertip so the child can see it.
//   const c = new Carry(ctx, { obj, getTarget: () => Vector3 (world), lift, snapPx, offsetPx });
//   onDown: c.begin(p)   onMove: c.move(p)   update: c.update(dt)   onUp: if (c.end(p)) snap else back
// ---------------------------------------------------------------------------------------------
const _rc = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _pl = new THREE.Plane();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _hit = new THREE.Vector3();

export class Carry {
  constructor(ctx, o) {
    this.ctx = ctx;
    this.o = Object.assign({ lift: 0.07, snapPx: 100, offsetPx: 30 }, o);
    this.active = false;
    this.S = new THREE.Vector3(); this.T = new THREE.Vector3();
    this.want = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.prev = new THREE.Vector3();
    this.q0 = new THREE.Quaternion(); this.blend = 0; this.k = 0; this.px = 0; this.py = 0;
  }
  begin(p) {
    const { ctx, o } = this;
    ctx.scene.attach(o.obj);
    this.S.copy(o.obj.position); this.T.copy(o.getTarget());
    this.want.copy(this.S); this.prev.copy(this.S); this.vel.set(0, 0, 0);
    this.q0.copy(o.obj.quaternion);
    this.blend = 0; this.k = 0; this.active = true;
    this.move(p);
  }
  _ray(p) {
    const el = this.ctx.renderer.domElement;
    const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
    _ndc.set((p.x / w) * 2 - 1, -((p.y - this.o.offsetPx) / h) * 2 + 1);
    _rc.setFromCamera(_ndc, this.ctx.camera);
    return _rc.ray;
  }
  move(p) {
    if (!this.active) return;
    this.px = p.x; this.py = p.y;
    this.T.copy(this.o.getTarget());
    const cam = this.ctx.camera;
    _a.subVectors(this.T, this.S);
    const len = _a.length() || 1e-6; _a.multiplyScalar(1 / len);
    // plane through S and T, turned to face the camera as much as possible
    _b.set(1, 0, 0).applyQuaternion(cam.quaternion); _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 0.2) { _b.set(0, 1, 0).applyQuaternion(cam.quaternion); _n.crossVectors(_a, _b); }
    _n.normalize();
    _pl.setFromNormalAndCoplanarPoint(_n, this.S);
    const hit = this._ray(p).intersectPlane(_pl, _hit);
    if (!hit) return;
    // keep it within a sane distance of the S–T segment (fingers wander)
    _b.subVectors(hit, this.S);
    const along = clamp(_b.dot(_a), -0.15 * len, 1.1 * len);
    this.k = clamp(along / len, 0, 1);
    _b.addScaledVector(_a, -_b.dot(_a));          // lateral part
    const lat = _b.length(), maxLat = 0.6 * len + 0.1;
    if (lat > maxLat) _b.multiplyScalar(maxLat / lat);
    this.want.copy(this.S).addScaledVector(_a, along).add(_b);
    this.want.y += this.o.lift * Math.sin(Math.PI * this.k);
    this.want.y = Math.max(this.want.y, Math.min(this.S.y, this.T.y) + 0.01);
  }
  update(dt) {
    if (!this.active) return;
    const obj = this.o.obj;
    this.blend = Math.min(1, this.blend + dt / 0.14);
    const f = 1 - Math.exp(-dt * 24);
    obj.position.lerp(this.want, f);
    // lazy pendulum-like tilt from motion
    this.vel.subVectors(obj.position, this.prev).multiplyScalar(1 / Math.max(dt, 1e-3));
    this.prev.copy(obj.position);
    if (this.o.tilt !== false) {
      const cam = this.ctx.camera;
      _a.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const side = clamp(this.vel.dot(_a) * 0.5, -0.5, 0.5);
      _b.set(0, 0, 1).applyQuaternion(cam.quaternion); _b.y = 0; _b.normalize();
      const tq = _tq.setFromAxisAngle(_b, -side);
      _tq2.copy(this.o.carryQuat || this.q0).premultiply(tq);
      obj.quaternion.slerp(_tq2, 1 - Math.exp(-dt * 10));
    }
  }
  // true = close enough / far enough along: snap to the target. false = go back.
  end(p) {
    if (!this.active) return false;
    this.active = false;
    if (p && !p.cancelled) { this.px = p.x; this.py = p.y; }
    const s = this.ctx.project(this.T);
    const d = Math.hypot(s.x - this.px, s.y - (this.py - this.o.offsetPx));
    return d < this.o.snapPx || this.k > 0.5;
  }
  progress() { return this.k; }
}
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion();

// ---------------------------------------------------------------------------------------------
// Sim: the tap and the basin water never stop being simulated, whatever stage is showing.
// The tap handle state is the child's: it stays how they left it (even if the basin overflows).
// ---------------------------------------------------------------------------------------------
export function createSim(ctx) {
  const st = () => ctx.state;
  let flow = 0, over = 0, dripT = 0, rippleT = 0, grab = null, squeakAcc = 0, tapTween = null;
  const hv = new THREE.Vector3(), tip = new THREE.Vector3();
  const sim = {
    flow: 0, overflow: 0,
    tilt: 0,                         // current basin tilt (rad), set by the rinse stage
    tapEnabled: true,
    handleWobble: 0,                 // visual-only extra handle angle (hint wobble)
    open() { return clamp(Math.abs(st().tap) / TAP_FULL, 0, 1); },
    // --- tap handle interaction: call from stages that show the tap. Returns true if it took the pointer.
    tapDown(p) {
      if (!sim.tapEnabled) return false;
      ctx.faucet.handle.getWorldPosition(hv);
      if (ctx.screenDist(p, hv) > 74) return false;
      const s = ctx.project(hv);
      grab = { cx: s.x, cy: s.y, lx: p.x, ly: p.y, turned: 0 };
      if (tapTween) { tapTween.dead = true; tapTween = null; }
      ctx.audio.play('squeak', { gain: 0.35, pitch: 1.1 });
      return true;
    },
    tapMove(p) {
      if (!grab) return false;
      // angle swept around the handle centre on screen (radius clamped so a wobbly straight drag still turns it)
      const ax = grab.lx - grab.cx, ay = grab.ly - grab.cy, bx = p.x - grab.cx, by = p.y - grab.cy;
      const r2 = Math.max(26 * 26, (ax * ax + ay * ay + bx * bx + by * by) / 2);
      let d = -(ax * by - ay * bx) / r2;            // screen y is down: counter-clockwise on screen = positive
      d = clamp(d, -0.6, 0.6);
      grab.lx = p.x; grab.ly = p.y; grab.turned += Math.abs(d);
      turn(d);
      return true;
    },
    tapUp(p) {
      if (!grab) return false;
      const g = grab; grab = null;
      if (p.isTap || g.turned < 0.12) {             // a simple tap: the handle spins by itself (open <-> closed)
        const from = st().tap, to = sim.open() < 0.4 ? TAP_FULL * 0.8 * (from < 0 ? -1 : 1) : 0;
        const tw = { dead: false }; tapTween = tw;
        ctx.gtl.tween(0.55, (k) => { if (tw.dead) return; const prev = st().tap; st().tap = lerp(from, to, k); squeak(Math.abs(st().tap - prev)); }, 'inOut');
      }
      ctx.saveSoon();
      return true;
    },
    grabbing() { return !!grab; },
    release() { grab = null; },      // drop a held handle without side effects (stage exit)
    update(dt) {
      const s = st(), w = s.water, basin = ctx.basin, faucet = ctx.faucet, audio = ctx.audio;
      if (!faucet) return;   // still being built (opening stage only: the tap is shut and the basin empty there)
      const open = sim.open();
      const target = open < 0.03 ? 0 : Math.pow(open, 0.6);
      flow += (target - flow) * (1 - Math.exp(-dt * 6));
      if (flow < 0.004) flow = 0;
      sim.flow = flow;
      faucet.setHandleAngle(s.tap + sim.handleWobble);
      const tilted = sim.tilt > 0.05;
      const landY = w.level > 0.01 ? basin.waterY() : basin.FLOOR_Y + 0.002;
      faucet.setFlow(flow, landY);
      // filling / mixing / overflow
      if (flow > 0 && !tilted) {
        const old = w.level;
        w.level = Math.min(1, w.level + flow * 0.2 * dt);
        if (w.level > old && w.level > 0.02) { const r = Math.max(old, 0.02) / w.level; w.murk *= r; }
      }
      const overT = (w.level >= 0.999 && flow > 0.02) ? flow : 0;
      over += (overT - over) * (1 - Math.exp(-dt * 3));
      if (over < 0.01) over = 0;
      sim.overflow = over;
      if (over > 0) { const k = Math.exp(-over * 0.012 * dt); w.murk *= k; }   // overflow only dilutes slowly: dirty water stays dirty until it is tipped out
      if (flow > 0.05) w.foam *= Math.exp(-flow * 0.25 * dt);
      w.murk = clamp(w.murk, 0, 1); w.foam = clamp(w.foam, 0, 1);
      basin.setWater(w.level, w.murk, w.foam);
      basin.setOverflow(over);
      // stream landing: ripples, little splashes
      if (flow > 0.08 && w.level > 0.01 && !tilted) {
        rippleT -= dt;
        if (rippleT <= 0) { rippleT = 0.22 + Math.random() * 0.15; basin.ripple(0, L.FAUCET[2] + 0.24, 0.35 + flow * 0.5); }
        if (basin.agitate) basin.agitate(flow * 0.6);
      }
      // a barely-open tap drips
      if (open > 0.005 && flow < 0.14) {
        dripT -= dt;
        if (dripT <= 0) {
          dripT = 0.7 + Math.random() * 0.5;
          faucet.spoutTip.getWorldPosition(tip);
          const inWater = w.level > 0.02;
          ctx.fx.drip(tip, { floorY: landY, onLand: () => { audio.play(inWater ? 'drip' : 'dripDry', { gain: 0.5 }); if (inWater) basin.ripple(0, L.FAUCET[2] + 0.24, 0.5); } });
        }
      }
      audio.setLoop('stream', flow, w.level);
      audio.setLoop('overflow', over);
      // floating shoes
      const t = ctx.time, fy = floatY(ctx), calm = clamp(w.level * 5, 0, 1);
      for (let i = 0; i < 2; i++) {
        const rig = ctx.rigs[i]; if (rig.where !== 'basin') continue;
        const g = ctx.shoes[i].group;
        rig.kx *= Math.exp(-dt * 7); rig.kz *= Math.exp(-dt * 7); rig.press *= Math.exp(-dt * 9);
        const bob = Math.sin(t * 1.9 + i * 2.1) * 0.0022 * calm;
        const y = Math.max(basin.FLOOR_Y, fy + bob - rig.press * 0.011 * calm);
        g.position.set(L.BASIN_SLOTS[i][0] + rig.kx, y, L.BASIN_SLOTS[i][1] + rig.kz + rig.slide);
        g.rotation.set(Math.sin(t * 1.3 + i) * 0.02 * calm + rig.kz * 2, (i ? -0.07 : 0.07) + rig.kx * 1.5, Math.sin(t * 1.6 + i * 1.7) * 0.025 * calm - rig.kx * 3);
      }
    },
  };
  function squeak(d) {
    squeakAcc += d;
    if (squeakAcc > 0.7) { squeakAcc = 0; ctx.audio.play('squeak', { gain: 0.3, pitch: 0.9 + Math.random() * 0.3 }); }
  }
  function turn(d) {
    const s = st();
    s.tap = clamp(s.tap + d, -TAP_MAX, TAP_MAX);
    squeak(Math.abs(d));
  }
  return sim;
}

// Start a brand-new round (the shoes come home black again).
export function resetRound(ctx) {
  const loops = (ctx.state.loops || 0) + 1;
  const fresh = defaultState();
  for (const k of Object.keys(ctx.state)) delete ctx.state[k];
  Object.assign(ctx.state, fresh, { loops });
  ctx.fx.clearAll();
  ctx.basin.setTilt(0); ctx.basin.setPour(0);
  applyShoeState(ctx);
}

// Dev/test helper: the state as it is when stage `id` begins (everything before it done the usual way).
export const STAGE_ORDER = ['bag', 'fill', 'dunk', 'scrub', 'rinse', 'load', 'spin', 'hang', 'sun', 'pack', 'end'];
export function presetState(id) {
  const s = defaultState(), n = STAGE_ORDER.indexOf(id);
  if (n > 0) s.pulled = 2;
  if (n > 1) s.water.level = 0.75;
  if (n > 2) { s.dunked = [true, true]; s.water.murk = 0.9; s.shoes[0].wet = s.shoes[1].wet = 1; }
  if (n > 3) { s.scrubbed = [true, true]; s.shoes[0].dirt = s.shoes[1].dirt = 'clean'; s.water.murk = 1; s.water.foam = 0.6; }
  if (n > 4) { s.dumped = true; s.rinse = 1; s.water.murk = 0; s.water.foam = 0; s.water.level = 0.8; }
  if (n > 5) s.loaded = [true, true];
  if (n > 6) { s.dry = 1; s.shoes[0].wet = s.shoes[1].wet = 0.35; }
  if (n > 7) s.hung = [true, true];
  if (n > 8) { s.shoes[0].wet = s.shoes[1].wet = 0; s.shoes[0].shine = s.shoes[1].shine = 1; }
  if (n > 9) s.packed = [true, true];
  return s;
}
