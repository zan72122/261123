// WASH half of the game: bag -> fill -> dunk -> scrub -> rinse.
// Every stage: place() rebuilds the canonical picture from ctx.state, enter() arms the hint,
// update()/onDown/onMove/onUp drive the interaction. All progress lives in ctx.state.
import * as THREE from 'three';
import { L, SHOTS } from './layout.js';
import { applyShoeState, putShoe, shoePose, flyShoe, flyTo, Carry, placeBag, clamp, lerp, FILL_OK } from './common.js';

// ---------------------------------------------------------------------------------------------
// shared temps / helpers
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _h = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _rc = new THREE.Raycaster(), _ndc = new THREE.Vector2();
const DARK = 0x3b342c, CLEARW = 0xdde6ea;
const rnd = Math.random;

let brushInBasin = false;     // the brush was left at its scrub rest pose (rinse glides it to the park spot)

function viewH(ctx) { const el = ctx.renderer.domElement; return el.clientHeight || innerHeight; }
// world ray through CSS pixel (x, y)
function rayAt(ctx, x, y) {
  const el = ctx.renderer.domElement;
  const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
  _ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
  _rc.setFromCamera(_ndc, ctx.camera);
  return _rc.ray;
}
function rayY(ray, y, out) { _pl.constant = -y; return ray.intersectPlane(_pl, out); }
// water surface height computed from state (valid before the basin has seen setWater this frame)
function waterYs(ctx) { const b = ctx.basin; return b.group.position.y + b.FLOOR_Y + clamp(ctx.state.water.level, 0, 1) * b.DEPTH; }
function shoeCenter(ctx, i, out, up = 0.025) { const g = ctx.shoes[i].group; g.updateWorldMatrix(true, false); return g.localToWorld(out.set(0, up, 0)); }

function setBrush(ctx, pos, yaw, pitch, roll) {
  const g = ctx.brush.group;
  if (g.parent !== ctx.scene) ctx.scene.add(g);
  g.position.copy(pos); g.rotation.set(pitch, yaw, roll, 'YXZ');
}
const PARK = new THREE.Vector3().fromArray(L.BRUSH_PARK);
const PARK_YAW = 0.5;
function parkBrush(ctx) { setBrush(ctx, PARK, PARK_YAW, 0, 0); ctx.brush.setPress(0); brushInBasin = false; }

// little hop of a shoe lying on the ground (instant response to a tap)
function hopShoe(ctx, i, h = 0.02) {
  const rig = ctx.rigs[i];
  if (rig.where !== 'ground' || rig.hop || rig.carried) return;
  const g = ctx.shoes[i].group, p = shoePose(ctx, i, 'ground');
  rig.hop = true;
  ctx.audio.play('hop', { gain: 0.6, pitch: 0.9 + rnd() * 0.3 });
  ctx.fx.dust(_a.copy(p.pos), { count: 3, size: 0.5, speed: 0.2 });
  const roll = (rnd() - 0.5) * 0.3;
  ctx.tl.tween(0.34, (k) => {
    if (rig.where !== 'ground' || rig.carried) return;
    g.position.copy(p.pos); g.position.y += h * 4 * k * (1 - k);
    g.quaternion.copy(p.quat); g.rotateZ(roll * Math.sin(Math.PI * k));
  }, 'linear').then(() => {
    rig.hop = false;
    if (rig.where === 'ground' && !rig.carried) { g.position.copy(p.pos); g.quaternion.copy(p.quat); ctx.fx.dust(_a.copy(p.pos), { count: 2, size: 0.4, speed: 0.12 }); }
  });
}
function pickGroundShoe(ctx, p, radius = 90) {
  const list = [];
  for (let i = 0; i < 2; i++) if (ctx.rigs[i].where === 'ground' && !ctx.rigs[i].carried) list.push({ pos: shoeCenter(ctx, i, new THREE.Vector3()), radiusPx: radius, data: i });
  const e = ctx.pickNearest(p, list);
  return e ? e.data : -1;
}
// a floating shoe bobs when poked
function bobShoe(ctx, i) {
  ctx.rigs[i].press = 1;
  ctx.audio.play('plip', { gain: 0.5, pitch: 0.8 + rnd() * 0.3 });
  ctx.basin.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 0.8);
}
function pickBasinShoe(ctx, p, radius = 80) {
  const list = [];
  for (let i = 0; i < 2; i++) if (ctx.rigs[i].where === 'basin') list.push({ pos: shoeCenter(ctx, i, new THREE.Vector3()), radiusPx: radius, data: i });
  const e = ctx.pickNearest(p, list);
  return e ? e.data : -1;
}
// a tap on the water: plip + ripple where the finger is
function pokeWater(ctx, p) {
  const st = ctx.state;
  if (st.water.level < 0.03) return false;
  const wy = ctx.basin.waterY();
  const hit = rayY(p.ray, wy, _a);
  if (!hit) return false;
  const lx = hit.x - ctx.basin.group.position.x, lz = hit.z - ctx.basin.group.position.z;
  if (Math.hypot(lx, lz) > ctx.basin.INNER_R - 0.01) return false;
  ctx.basin.ripple(lx, lz, 1);
  ctx.audio.play('plip', { gain: 0.6, pitch: 0.7 + st.water.level * 0.7 });
  ctx.fx.splash(hit, { count: 3, speed: 0.6, size: 0.6, color: st.water.murk > 0.3 ? DARK : CLEARW, floorY: wy - 0.002 });
  return true;
}
// a few random foam clumps on top of shoe i (restore after reload)
function seedFoam(ctx, i, n) {
  const shoe = ctx.shoes[i];
  shoe.group.updateWorldMatrix(true, false);
  let tries = 0;
  for (let k = 0; k < n && tries < n * 6; tries++) {
    const lx = (rnd() - 0.5) * 0.07, lz = (rnd() - 0.5) * 0.18;
    const sy = shoe.surfaceY(lx, lz);
    if (sy < 0.0135) continue;
    ctx.fx.foam.add(shoe.group, _a.set(lx, sy + 0.003, lz), 0.8 + rnd() * 0.7);
    k++;
  }
}

// ---------------------------------------------------------------------------------------------
// canonical pictures (SCENES.md table)
// ---------------------------------------------------------------------------------------------
function placeCommon(ctx, id) {
  const st = ctx.state, b = ctx.basin;
  ctx.world.setTimeOfDay(0);
  ctx.spinner.setLidOpen(0);
  b.setTilt(0); b.setPour(0);
  ctx.sim.tilt = 0; ctx.sim.handleWobble = 0;
  for (const n of ['scrub', 'fizz', 'pour']) ctx.audio.setLoop(n, 0);
  if (id === 'scrub' || id === 'rinse') for (let i = 0; i < 2; i++) st.shoes[i].wet = 1;
  if (id === 'rinse') for (let i = 0; i < 2; i++) { st.shoes[i].dirt = 'clean'; st.scrubbed[i] = true; }
  applyShoeState(ctx);
  // bag lying on the terrace
  placeBag(ctx, false);
  ctx.bag.setDusty(1);
  if (id === 'bag') {
    const p = st.pulled;
    ctx.bag.setFill(2 - p); ctx.bag.setOpen(p === 0 ? 0.85 : p === 1 ? 0.75 : 0.5);
  } else { ctx.bag.setFill(0); ctx.bag.setOpen(0.5); }
  for (let i = 0; i < 2; i++) { const r = ctx.rigs[i]; r.hop = false; r.carried = false; }
  // shoes
  for (let i = 0; i < 2; i++) {
    if (id === 'bag') { if (i < st.pulled) putShoe(ctx, i, 'ground'); else putShoe(ctx, i, 'hidden'); }
    else if (id === 'fill') putShoe(ctx, i, 'ground');
    else if (id === 'dunk') putShoe(ctx, i, st.dunked[i] ? 'basin' : 'ground');
    else putShoe(ctx, i, 'basin');
  }
  // brush
  if (id === 'scrub') { brushInBasin = true; }
  else if (!(id === 'rinse' && brushInBasin)) parkBrush(ctx);
  if (id !== 'scrub' && id !== 'rinse') { ctx.brush.setFoam(0); ctx.fx.foam.clear(); }
  ctx.brush.setPress(0);
}

// =============================================================================================
// 1. bag — pull the black shoes out of the dusty bag
// =============================================================================================
const BG = { q: 0, qs: 0, grab: null, popping: false, done: false, dustQ: 0, wob: 0, wobOn: false, peek: -1 };
const PULL_OUT = 0.16;

function setPeek(ctx, i, out) {
  const g = ctx.shoes[i].group, m = ctx.bag.mouth;
  if (g.parent !== m) m.add(g);
  g.visible = true; g.scale.setScalar(1);
  // same as peekPose(ctx, out) from common.js (inlined: no allocation per frame)
  g.position.set(0, -m.position.y + 0.004, -0.035 + out);
  g.quaternion.identity();
}
function heelWorld(ctx, out) {
  if (BG.peek < 0) return null;
  const g = ctx.shoes[BG.peek].group; g.updateWorldMatrix(true, false);
  return g.localToWorld(out.set(0, 0.03, 0.08));
}
function mouthWorld(ctx, out) { ctx.bag.mouth.updateWorldMatrix(true, false); return ctx.bag.mouth.getWorldPosition(out); }
function mouthDir(ctx, out) { ctx.bag.mouth.updateWorldMatrix(true, false); ctx.bag.mouth.getWorldDirection(out); out.y = 0; return out.normalize(); }
function bagCenter(ctx, out) { return out.copy(ctx.bag.group.position).setY(0.03); }

const hintHeel = new THREE.Vector3(), hintDir = new THREE.Vector3();
function bagHint(ctx) {
  if (BG.peek < 0) { ctx.hint.clear(); return; }
  ctx.hint.set({
    target: () => heelWorld(ctx, hintHeel),
    gesture: { type: 'pull', dir: () => mouthDir(ctx, hintDir).multiplyScalar(PULL_OUT) },
    wobble: (k, t) => {
      BG.wob = k * 0.012 * Math.sin(t * 15);
      if (k > 0 && !BG.wobOn) { BG.wobOn = true; ctx.bag.squish(0.18); }
      if (k === 0) BG.wobOn = false;
    },
    cue: () => { ctx.audio.play('puff', { gain: 0.3 }); ctx.fx.dust(mouthWorld(ctx, _e), { count: 2, size: 0.45, speed: 0.12 }); },
  });
}

// the shoe comes out: tumbling arc to its ground slot
function popShoe(ctx) {
  const st = ctx.state, i = BG.peek;
  if (i < 0 || BG.popping) return;
  BG.popping = true; BG.grab = null;
  const g = ctx.shoes[i].group, rig = ctx.rigs[i];
  const m = mouthWorld(ctx, new THREE.Vector3()), dir = mouthDir(ctx, new THREE.Vector3());
  ctx.audio.play('puffBig', { gain: 0.9 });
  ctx.fx.dust(m, { count: 14, size: 1.3, speed: 0.5, life: 1.6 });
  ctx.bag.squish(0.9);
  ctx.scene.attach(g);
  const p = shoePose(ctx, i, 'ground');
  const p0 = g.position.clone(), q0 = g.quaternion.clone();
  const axis = new THREE.Vector3().subVectors(p.pos, p0).setY(0).normalize().cross(new THREE.Vector3(0, -1, 0)).normalize();
  rig.where = 'fly';
  ctx.tl.tween(0.45, (k) => {
    g.position.lerpVectors(p0, p.pos, k); g.position.y += 0.14 * 4 * k * (1 - k);
    g.quaternion.slerpQuaternions(q0, p.quat, k);
    _q.setFromAxisAngle(axis, TAU * k); g.quaternion.premultiply(_q);
  }, 'linear').then(() => {
    g.position.copy(p.pos); g.quaternion.copy(p.quat); rig.where = 'ground';
    ctx.audio.play('hop', { gain: 0.8, pitch: 0.85 });
    ctx.audio.play('thud', { gain: 0.35 });
    ctx.fx.dust(_a.copy(p.pos), { count: 6, size: 0.8, speed: 0.3 });
    ctx.cam.shake(0.0025, 0.25);
  });
  st.pulled = Math.min(2, st.pulled + 1);
  ctx.saveSoon();
  ctx.bag.setFill(2 - st.pulled);
  BG.q = 0; BG.qs = 0;
  if (st.pulled === 1) {
    ctx.cam.goto(SHOTS.bagWide, 0.9);   // make room for the shoes on the ground
    // the second shoe slides into the mouth
    BG.peek = 1; BG.qs = -0.75; setPeek(ctx, 1, BG.qs * PULL_OUT); ctx.rigs[1].where = 'bag';
    ctx.bag.setOpen(0.75);
    ctx.tl.after(0.3, () => { ctx.audio.play('puff', { gain: 0.45 }); ctx.fx.dust(mouthWorld(ctx, _e), { count: 3, size: 0.6, speed: 0.15 }); });
    ctx.tl.after(0.4, () => { BG.popping = false; });
  } else {
    // comic beat: sand pours out, the empty bag flops flat
    BG.peek = -1; BG.done = true; ctx.hint.clear();
    ctx.audio.play('sand', { gain: 0.9 });
    for (let k = 0; k < 3; k++) ctx.tl.after(0.05 + k * 0.18, () => {
      mouthWorld(ctx, _e); _e.y = Math.max(_e.y, 0.02);
      ctx.fx.sand(_e, _d.copy(dir).multiplyScalar(0.6).setY(0.15), { count: 40, speed: 0.6, spread: 0.45 });
    });
    const o0 = 0.75;
    ctx.tl.tween(0.5, (k) => { ctx.bag.setOpen(lerp(o0, 0.5, k)); }, 'inOut');
    ctx.tl.after(0.45 + 0.7, () => ctx.flow.next());
  }
}

const bag = {
  id: 'bag', shot: (ctx) => (ctx.state.pulled > 0 ? SHOTS.bagWide : SHOTS.bag),
  place(ctx) {
    placeCommon(ctx, 'bag');
    const st = ctx.state;
    BG.q = 0; BG.qs = 0; BG.grab = null; BG.popping = false; BG.dustQ = 0; BG.wob = 0; BG.wobOn = false;
    BG.done = st.pulled >= 2;
    BG.peek = st.pulled < 2 ? st.pulled : -1;
    if (BG.peek >= 0) { setPeek(ctx, BG.peek, 0); ctx.rigs[BG.peek].where = 'bag'; }
  },
  enter(ctx) {
    if (BG.done) { ctx.tl.after(0.7, () => ctx.flow.next()); return; }
    bagHint(ctx);
  },
  exit(ctx) { BG.grab = null; BG.wob = 0; },
  update(dt, ctx) {
    if (BG.peek >= 0 && !(BG.popping && ctx.rigs[BG.peek].where === 'fly')) {
      BG.qs += (BG.q - BG.qs) * (1 - Math.exp(-dt * 16));
      setPeek(ctx, BG.peek, BG.qs * PULL_OUT + BG.wob);
    }
  },
  onDown(p, ctx) {
    const st = ctx.state;
    if (BG.peek >= 0 && !BG.popping) {
      const e = ctx.pickNearest(p, [{ pos: heelWorld(ctx, new THREE.Vector3()), radiusPx: 120 }, { pos: bagCenter(ctx, new THREE.Vector3()), radiusPx: 130 }]);
      if (e) {
        BG.grab = { x: p.x, y: p.y, q0: BG.q };
        ctx.bag.squish(0.35);
        ctx.audio.play('puff', { gain: 0.55, pitch: 0.95 + rnd() * 0.2 });
        ctx.fx.dust(mouthWorld(ctx, _e), { count: 3, size: 0.55, speed: 0.2 });
        return;
      }
    }
    const i = pickGroundShoe(ctx, p);
    if (i >= 0) { hopShoe(ctx, i); return; }
    if (st.pulled >= 2 && ctx.pickNearest(p, [{ pos: bagCenter(ctx, new THREE.Vector3()), radiusPx: 130 }])) {
      ctx.bag.squish(0.5);
      ctx.audio.play('puff', { gain: 0.5 });
      mouthWorld(ctx, _e); _e.y = Math.max(_e.y, 0.02);
      ctx.fx.dust(_e, { count: 3, size: 0.6, speed: 0.2 });
      ctx.fx.sand(_e, mouthDir(ctx, _d).setY(0.3), { count: 8, speed: 0.4 });
    }
  },
  onMove(p, ctx) {
    const g = BG.grab; if (!g || BG.popping) return;
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    const nq = Math.max(BG.q, g.q0 + d / 130);
    if (nq <= BG.q) return;
    const dq = nq - BG.q; BG.q = Math.min(1, nq);
    ctx.bag.squish(Math.min(0.2, dq * 1.3));
    BG.dustQ += dq;
    if (BG.dustQ > 0.2) {
      BG.dustQ = 0;
      ctx.fx.dust(mouthWorld(ctx, _e), { count: 1, size: 0.45, speed: 0.12 });
      ctx.audio.play('puff', { gain: 0.25, pitch: 1.2 + rnd() * 0.3 });
    }
    if (nq >= 1) popShoe(ctx);
  },
  onUp(p, ctx) {
    const g = BG.grab; BG.grab = null;
    if (!g || BG.popping) return;
    if (p.isTap) {
      BG.q = Math.min(1, BG.q + 0.4);
      ctx.fx.dust(mouthWorld(ctx, _e), { count: 2, size: 0.5, speed: 0.18 });
      if (BG.q >= 1) popShoe(ctx);
    }
  },
};

// =============================================================================================
// 2. fill — turn the tap, fill the basin
// =============================================================================================
const FL = { done: false, tapGrab: false };
const _handleW = new THREE.Vector3();
function handleWorld(ctx) { ctx.faucet.handle.updateWorldMatrix(true, false); return ctx.faucet.handle.getWorldPosition(_handleW); }
function tapHintCfg(ctx) {
  return {
    target: ctx.faucet.handle,
    gesture: { type: 'circle', center: () => handleWorld(ctx), radius: 0.04 },
    wobble: (k, t) => { ctx.sim.handleWobble = k * 0.35 * Math.sin(t * 9); },
    cue: () => {
      ctx.faucet.spoutTip.getWorldPosition(_e);
      const inWater = ctx.state.water.level > 0.02;
      const floorY = inWater ? ctx.basin.waterY() : ctx.basin.FLOOR_Y + 0.002;
      ctx.fx.drip(_e, { floorY, onLand: () => { ctx.audio.play(inWater ? 'drip' : 'dripDry', { gain: 0.5 }); if (inWater) ctx.basin.ripple(0, L.FAUCET[2] + 0.24, 0.6); } });
    },
  };
}
// shared tap/basin/stream touch handling for the stages that show the tap
function tapOrWaterDown(ctx, p, S) {
  if (ctx.sim.tapDown(p)) { S.tapGrab = true; return true; }
  // the stream
  if (ctx.sim.flow > 0.1) {
    const wy = ctx.state.water.level > 0.02 ? ctx.basin.waterY() : ctx.basin.FLOOR_Y;
    _e.set(0, (0.5 + wy) / 2, L.FAUCET[2] + 0.24);
    if (ctx.screenDist(p, _e) < 50) {
      ctx.fx.spray(_e, _d.set(0, 0.2, 1), { count: 6, speed: 0.8, spread: 0.6, floorY: wy });
      ctx.audio.play('plip', { gain: 0.5, pitch: 1.3 });
      return true;
    }
  }
  return false;
}
function releaseTap(ctx, S, p) { if (S.tapGrab) { S.tapGrab = false; if (p) ctx.sim.tapUp(p); else ctx.sim.release(); } }

const fill = {
  id: 'fill', shot: SHOTS.faucet,
  place(ctx) { placeCommon(ctx, 'fill'); FL.done = false; FL.tapGrab = false; },
  enter(ctx) { ctx.hint.set(tapHintCfg(ctx)); },
  exit(ctx) { releaseTap(ctx, FL); ctx.sim.handleWobble = 0; },
  update(dt, ctx) {
    if (FL.done) return;
    const w = ctx.state.water;
    if (ctx.sim.flow > 0.08 && w.level < 0.999) ctx.hint.nudge();
    if (w.level >= FILL_OK) {
      FL.done = true; ctx.hint.clear(); ctx.sim.handleWobble = 0;
      const wy = ctx.basin.waterY();
      ctx.fx.sparkle(_e.set(-0.08, wy + 0.01, 0.06), { count: 2, spread: 0.04 });
      ctx.fx.sparkle(_e.set(0.1, wy + 0.01, -0.05), { count: 2, spread: 0.04 });
      ctx.audio.play('sparkle', { gain: 0.7 });
      ctx.saveSoon();
      ctx.tl.after(0.6, () => ctx.flow.next());
    }
  },
  onDown(p, ctx) {
    if (tapOrWaterDown(ctx, p, FL)) return;
    if (pokeWater(ctx, p)) return;
    // the empty basin: a hollow knock
    if (ctx.pickNearest(p, [{ pos: _e.set(0, 0.06, 0), radiusPx: 140 }])) {
      ctx.audio.play('knock', { gain: 0.35, pitch: 0.8 }); ctx.basin.agitate(0.4);
    }
  },
  onMove(p, ctx) { if (FL.tapGrab) ctx.sim.tapMove(p); },
  onUp(p, ctx) { releaseTap(ctx, FL, p); },
};

// =============================================================================================
// 3. dunk — carry each shoe into the water
// =============================================================================================
const DK = { carry: null, ci: -1, tapGrab: false, done: false, wobOn: -1 };
const _slotT = new THREE.Vector3(), _basinC = new THREE.Vector3();
function slotTarget(ctx, i) { return _slotT.set(L.BASIN_SLOTS[i][0], ctx.basin.waterY() + 0.03, L.BASIN_SLOTS[i][1]); }
function nextUndunked(ctx) { for (let i = 0; i < 2; i++) if (!ctx.state.dunked[i]) return i; return -1; }
function dunkHint(ctx) {
  const i = nextUndunked(ctx);
  if (i < 0) { ctx.hint.clear(); return; }
  const g = ctx.shoes[i].group;
  ctx.hint.set({
    target: g,
    gesture: { type: 'drag', to: () => _basinC.set(0, ctx.basin.waterY(), 0.02) },
    wobble: (k, t) => {
      const rig = ctx.rigs[i];
      if (rig.where !== 'ground' || rig.carried || rig.hop) return;
      const p = shoePose(ctx, i, 'ground');
      g.position.copy(p.pos); g.quaternion.copy(p.quat);
      if (k > 0) { g.position.y += 0.006 * k * Math.abs(Math.sin(t * 11)); g.rotateZ(0.12 * k * Math.sin(t * 11)); }
    },
    cue: () => { ctx.audio.play('hop', { gain: 0.3 }); ctx.fx.dust(shoeCenter(ctx, i, _e, 0), { count: 1, size: 0.45, speed: 0.12 }); },
  });
}
function dunkArrive(ctx, i) {
  const st = ctx.state, w = st.water;
  const wy = ctx.basin.waterY();
  const pos = _a.set(L.BASIN_SLOTS[i][0], wy, L.BASIN_SLOTS[i][1]);
  const dark = w.murk > 0.3;
  ctx.audio.play('splashBig', { gain: 0.9 });
  ctx.fx.splash(pos, { count: 22, speed: 1.5, spread: 0.55, color: dark ? DARK : CLEARW, floorY: wy - 0.003 });
  ctx.basin.ripple(pos.x, pos.z, 2); ctx.basin.ripple(pos.x * 0.5, pos.z + 0.04, 1.2);
  ctx.basin.agitate(1.2);
  ctx.cam.shake(0.002, 0.25);
  ctx.rigs[i].press = 1;
  st.dunked[i] = true;
  const shoe = ctx.shoes[i], w0 = st.shoes[i].wet;
  ctx.tl.tween(0.4, (k) => { st.shoes[i].wet = lerp(w0, 1, k); shoe.setWet(st.shoes[i].wet); }, 'out');
  const m0 = w.murk, m1 = Math.min(1, m0 + 0.45);
  ctx.tl.tween(1.2, (k) => { w.murk = Math.max(w.murk, lerp(m0, m1, k)); }, 'out');
  ctx.tl.after(0.5, () => {
    ctx.audio.play('burp', { gain: 0.8 });
    const y = ctx.basin.waterY();
    const bp = _b.set(L.BASIN_SLOTS[i][0] + (i ? 0.03 : -0.03), y, L.BASIN_SLOTS[i][1] - 0.06);
    ctx.fx.ring(bp, 0.05, { color: 0x6b6055 });
    ctx.fx.spray(bp, _d.set(0, 1, 0), { count: 4, speed: 0.55, spread: 0.3, color: DARK, floorY: y - 0.002 });
    ctx.basin.ripple(bp.x, bp.z, 1);
  });
  ctx.saveSoon();
  dunkHint(ctx);
  if (nextUndunked(ctx) < 0 && !DK.done) { DK.done = true; ctx.tl.after(0.9, () => ctx.flow.next()); }
}
const dunk = {
  id: 'dunk', shot: SHOTS.dunk,
  place(ctx) { placeCommon(ctx, 'dunk'); DK.carry = null; DK.ci = -1; DK.tapGrab = false; DK.done = false; },
  enter(ctx) {
    if (nextUndunked(ctx) < 0) { DK.done = true; ctx.tl.after(0.9, () => ctx.flow.next()); return; }
    dunkHint(ctx);
  },
  exit(ctx) {
    releaseTap(ctx, DK);
    if (DK.carry) { DK.carry.end(null); DK.carry = null; }
    if (DK.ci >= 0) ctx.rigs[DK.ci].carried = false;
    DK.ci = -1;
  },
  update(dt, ctx) { if (DK.carry) DK.carry.update(dt); },
  onDown(p, ctx) {
    if (tapOrWaterDown(ctx, p, DK)) return;
    if (DK.carry) return;
    const list = [];
    for (let i = 0; i < 2; i++) if (!ctx.state.dunked[i] && ctx.rigs[i].where === 'ground') list.push({ pos: shoeCenter(ctx, i, new THREE.Vector3()), radiusPx: 95, data: i });
    const e = ctx.pickNearest(p, list);
    if (e) {
      const i = e.data, rig = ctx.rigs[i];
      rig.carried = true; DK.ci = i;
      const pp = shoePose(ctx, i, 'ground');
      ctx.shoes[i].group.position.copy(pp.pos); ctx.shoes[i].group.quaternion.copy(pp.quat);
      DK.carry = new Carry(ctx, { obj: ctx.shoes[i].group, getTarget: () => slotTarget(ctx, i), lift: 0.10 });
      DK.carry.begin(p);
      ctx.audio.play('hop', { gain: 0.6 });
      ctx.fx.dust(_e.copy(pp.pos), { count: 3, size: 0.55, speed: 0.18 });
      return;
    }
    const j = pickBasinShoe(ctx, p);
    if (j >= 0) { bobShoe(ctx, j); return; }
    pokeWater(ctx, p);
  },
  onMove(p, ctx) {
    if (DK.tapGrab) { ctx.sim.tapMove(p); return; }
    if (DK.carry) DK.carry.move(p);
  },
  onUp(p, ctx) {
    if (DK.tapGrab) { releaseTap(ctx, DK, p); return; }
    const c = DK.carry; if (!c) return;
    const i = DK.ci; DK.carry = null; DK.ci = -1;
    const ok = !p.isTap && c.end(p);
    if (p.isTap) c.end(p);
    ctx.rigs[i].carried = false;
    if (ok) {
      ctx.audio.play('whoosh', { gain: 0.25, pitch: 1.4 });
      flyShoe(ctx, i, 'basin', 0.3, 0.05).then(() => dunkArrive(ctx, i));
    } else {
      flyShoe(ctx, i, 'ground', 0.3, 0.06).then(() => {
        ctx.audio.play('hop', { gain: 0.6, pitch: 1.05 });
        ctx.fx.dust(shoeCenter(ctx, i, _e, 0), { count: 3, size: 0.5, speed: 0.15 });
      });
    }
  },
};

// =============================================================================================
// 4. scrub — the heart of the game
// =============================================================================================
const SCRUB_R = 0.027;       // bristle footprint radius (m)
const SCRUB_STEP = 0.003;    // sub-step length along a stroke (m); a full step = strength 1
const SCRUB_K = 1.0;         // overall strength multiplier (tuning)
const FOAM_STEP = 0.02;      // one lather clump per this much stroke on a shoe
const FOAM_MAX = 110;        // per shoe
const LIFT_PX = 26;          // bristle contact sits this far above the fingertip

const SC = {
  held: false, mode: 'rest', glide: 0, wait: 0, done: false,
  pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0,
  fPos: new THREE.Vector3(), fYaw: 0, fPitch: 0, fRoll: 0,
  contact: new THREE.Vector3(), lastC: new THREE.Vector3(), hasLast: false,
  on: -1, lx: 0, lz: 0, pOn: -1, plx: 0, plz: 0,
  acc: [0, 0], speed: 0, dist: 0, vx: 0, vz: 0, svx: 0,
  bubT: 0, ripT: 0, saveT: 0, hintT: 0, half: [false, false], foamF: 0, wob: 0, dirty: false,
  hintPt: new THREE.Vector3(), hasHint: false,
};
function restPose(ctx, out) {
  out.pos.set(0.134, waterYs(ctx) - 0.006, 0.032);
  out.yaw = 1.22; out.pitch = -0.2; out.roll = 0.05;
  return out;
}
const _rest = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 };
function inShoe(shoe, lx, lz) { return Math.abs(lx) < 0.046 && Math.abs(lz) < 0.098 && shoe.surfaceY(lx, lz) > 0.0135; }
// bristle contact under the (lifted) fingertip; fills SC.contact / SC.on / SC.lx / SC.lz
function contactAt(ctx, p) {
  const ray = rayAt(ctx, p.x, p.y - LIFT_PX);
  const wy = ctx.basin.waterY();
  const hit = rayY(ray, wy + 0.035, _a);
  if (!hit) return false;
  const bx = ctx.basin.group.position.x, bz = ctx.basin.group.position.z;
  let rx = hit.x - bx, rz = hit.z - bz; const r = Math.hypot(rx, rz), R = ctx.basin.INNER_R - 0.02;
  if (r > R) { hit.x = bx + rx * R / r; hit.z = bz + rz * R / r; }
  SC.on = -1;
  for (let i = 0; i < 2; i++) {
    const shoe = ctx.shoes[i]; if (ctx.rigs[i].where !== 'basin') continue;
    shoe.group.updateWorldMatrix(true, false);
    const lo = shoe.group.worldToLocal(_b.copy(hit));
    if (!inShoe(shoe, lo.x, lo.z)) continue;
    // refine: intersect again at the real surface height there (less parallax)
    const sy = shoe.surfaceY(lo.x, lo.z);
    const wsy = shoe.group.localToWorld(_c.set(lo.x, sy, lo.z)).y;
    const h2 = rayY(ray, wsy, _d);
    if (h2 && Math.hypot(h2.x - bx, h2.z - bz) <= R) {
      const lo2 = shoe.group.worldToLocal(_b.copy(h2));
      if (inShoe(shoe, lo2.x, lo2.z)) { hit.copy(h2); lo.copy(lo2); }
    }
    SC.on = i; SC.lx = lo.x; SC.lz = lo.z;
    break;
  }
  SC.contact.copy(hit);
  return true;
}
function brushTargetPose(ctx, out) {
  out.pos.copy(SC.contact);
  if (SC.on >= 0) {
    const shoe = ctx.shoes[SC.on];
    out.pos.y = shoe.group.localToWorld(_e.set(SC.lx, shoe.surfaceY(SC.lx, SC.lz), SC.lz)).y - 0.0015;
  } else out.pos.y = ctx.basin.waterY() - 0.005;
  out.yaw = 0.4 + clamp(SC.contact.x * 2, -0.3, 0.3) + SC.svx;   // right-hand grip: handle toward the viewer, a bit to the right
  out.pitch = -0.12; out.roll = clamp(-SC.svx * 0.5, -0.1, 0.1);
  return out;
}
const _tgt = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 };
function applyBrush(ctx) { setBrush(ctx, SC.pos, SC.yaw, SC.pitch, SC.roll); }
function scrubHintPoint(ctx) {
  let best = -1, bl = -1;
  for (let i = 0; i < 2; i++) if (!ctx.state.scrubbed[i]) { const l = ctx.shoes[i].dirtLeft(); if (l > bl) { bl = l; best = i; } }
  SC.hasHint = false;
  if (best < 0) return;
  const shoe = ctx.shoes[best];
  const lp = shoe.dirtiestPoint(_h);
  if (!lp) return;
  shoe.group.updateWorldMatrix(true, false);
  shoe.group.localToWorld(SC.hintPt.copy(lp));
  SC.hintPt.z += 0.02;           // finger sits below the bristles on screen
  SC.hasHint = true;
}
function scrubHint(ctx) {
  scrubHintPoint(ctx);
  ctx.hint.set({
    target: () => (SC.hasHint ? SC.hintPt : null),
    gesture: { type: 'scrub', center: () => (SC.hasHint ? SC.hintPt : null), size: 0.07 },
    wobble: (k) => { SC.wob = k; },
    cue: () => { ctx.audio.play('hop', { pitch: 1.8, gain: 0.25 }); ctx.audio.play('hop', { pitch: 1.9, gain: 0.22, delay: 0.13 }); },
  });
}
function saveDirt(ctx) {
  const st = ctx.state;
  for (let i = 0; i < 2; i++) if (!st.scrubbed[i]) st.shoes[i].dirt = ctx.shoes[i].dirtLeft() > 0.999 ? null : ctx.shoes[i].serialize();
  ctx.saveSoon(); SC.dirty = false;
}
function markWorld(ctx, i, out) {
  const shoe = ctx.shoes[i], lz = -0.035;
  return shoe.group.localToWorld(out.set(0, shoe.surfaceY(0, lz) + 0.004, lz));
}
function scrubDone(ctx) {
  SC.done = true; ctx.hint.clear();
  if (SC.held) { SC.held = false; ctx.brush.setPress(0); }
  SC.mode = 'left'; SC.wait = 0.35;
  saveDirt(ctx);
  ctx.tl.after(0.35 + 0.5 + 1.0, () => ctx.flow.next());
}
// scrub shoe i along a segment in its local frame
function scrubStroke(ctx, i, x0, z0, x1, z1, d, dx, dz) {
  const st = ctx.state, shoe = ctx.shoes[i], fx = ctx.fx;
  const n = clamp(Math.ceil(d / SCRUB_STEP), 1, 28);
  const s = Math.min(1, (d / n) / SCRUB_STEP) * SCRUB_K;
  let rem = 0;
  for (let k = 1; k <= n; k++) { const u = k / n; rem += shoe.scrubAt(lerp(x0, x1, u), lerp(z0, z1, u), SCRUB_R, s); }
  if (rem > 0) { st.water.murk = Math.min(1, st.water.murk + rem * 0.3); SC.dirty = true; }
  st.water.foam = Math.min(0.7, st.water.foam + d * 0.12);
  // lather
  SC.acc[i] += d;
  if (SC.acc[i] >= FOAM_STEP) {
    SC.acc[i] = 0;
    if (fx.foam.countOn(shoe.group) < FOAM_MAX) {
      const n2 = 2 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < n2; k++) {
        const jx = x1 + (rnd() - 0.5) * 0.016, jz = z1 + (rnd() - 0.5) * 0.02;
        const sy = shoe.surfaceY(jx, jz);
        if (sy < 0.0135) continue;
        fx.foam.add(shoe.group, _e.set(jx, sy + 0.003, jz), 1.0 + rnd() * 0.6);
      }
    }
  }
  SC.foamF = Math.min(1, SC.foamF + d * 5);
  ctx.brush.setFoam(SC.foamF);
  // the shoe dips and gets nudged along the stroke
  const rig = ctx.rigs[i];
  rig.press = 1;
  rig.kx = clamp(rig.kx + dx * 0.25, -0.008, 0.008); rig.kz = clamp(rig.kz + dz * 0.25, -0.008, 0.008);
  // milestones
  const left = shoe.dirtLeft();
  if (!SC.half[i] && left < 0.5) {
    SC.half[i] = true;
    fx.sparkle(markWorld(ctx, i, _e), { count: 1, size: 1.2, spread: 0.008 });
    ctx.audio.play('sparkle', { gain: 0.45 });
  }
  if (!st.scrubbed[i] && left < 0.12) {
    shoe.cleanAll();
    st.scrubbed[i] = true; st.shoes[i].dirt = 'clean';
    for (let k = 0; k < 3; k++) fx.sparkle(shoe.group.localToWorld(_e.set((rnd() - 0.5) * 0.04, 0.045, (k - 1) * 0.06)), { count: 1, size: 1.1, spread: 0.01 });
    ctx.audio.play('sparkle', { gain: 0.8 });
    ctx.saveSoon();
    if (st.scrubbed[0] && st.scrubbed[1]) scrubDone(ctx);
    else scrubHint(ctx);
  }
}

const scrub = {
  id: 'scrub', shot: SHOTS.scrub,
  place(ctx) {
    placeCommon(ctx, 'scrub');
    const st = ctx.state;
    SC.held = false; SC.mode = 'rest'; SC.done = false; SC.hasLast = false; SC.on = -1; SC.speed = 0; SC.dist = 0; SC.svx = 0;
    SC.acc[0] = SC.acc[1] = 0; SC.bubT = 0; SC.ripT = 0; SC.saveT = 0; SC.hintT = 0; SC.wob = 0; SC.dirty = false;
    let prog = 0;
    for (let i = 0; i < 2; i++) {
      const left = ctx.shoes[i].dirtLeft();
      SC.half[i] = left < 0.5; prog = Math.max(prog, 1 - left);
      // restored half-way: put some lather back
      if (left < 0.9 && ctx.fx.foam.countOn(ctx.shoes[i].group) < 8) seedFoam(ctx, i, Math.round((1 - left) * 70));
    }
    SC.foamF = prog > 0.05 ? 1 : 0;
    ctx.brush.setFoam(SC.foamF);
    restPose(ctx, _rest);
    SC.pos.copy(_rest.pos); SC.yaw = _rest.yaw; SC.pitch = _rest.pitch; SC.roll = _rest.roll;
    applyBrush(ctx);
  },
  enter(ctx) {
    const st = ctx.state;
    if (st.scrubbed[0] && st.scrubbed[1]) { SC.done = true; ctx.tl.after(1.0, () => ctx.flow.next()); return; }
    scrubHint(ctx);
  },
  exit(ctx) {
    if (SC.dirty) saveDirt(ctx);
    SC.held = false; SC.on = -1;
    ctx.brush.setPress(0);
    ctx.audio.setLoop('scrub', 0); ctx.audio.setLoop('fizz', 0);
    brushInBasin = true;
  },
  update(dt, ctx) {
    const fx = ctx.fx;
    // finger speed along the strokes (m/s), smoothed
    const inst = SC.dist / Math.max(dt, 1e-3); SC.dist = 0;
    SC.speed += (inst - SC.speed) * (1 - Math.exp(-dt * 9));
    const vxi = SC.vx / Math.max(dt, 1e-3); SC.vx = 0; SC.vz = 0;
    SC.svx += (clamp(vxi * 0.5, -0.3, 0.3) - SC.svx) * (1 - Math.exp(-dt * 6));
    const onShoe = SC.held && SC.on >= 0;
    ctx.audio.setLoop('scrub', onShoe ? clamp(SC.speed / 0.35, 0, 1) : 0, 0.8);
    ctx.audio.setLoop('fizz', clamp(fx.foam.count() / 200, 0, 1));
    // free soap bubbles from energetic scrubbing
    if (onShoe && SC.speed > 0.15) {
      SC.bubT -= dt * clamp(SC.speed / 0.35, 0.4, 2);
      if (SC.bubT <= 0) {
        SC.bubT = 0.25 + rnd() * 0.25;
        fx.bubble(_e.copy(SC.contact).setY(SC.pos.y + 0.012), { size: 0.7 + rnd() * 0.7 });
      }
    }
    // ripples now and then while brushing
    if (SC.held) {
      SC.ripT -= dt;
      if (SC.ripT <= 0 && SC.speed > 0.05) {
        SC.ripT = 0.28 + rnd() * 0.15;
        ctx.basin.ripple(SC.contact.x - ctx.basin.group.position.x, SC.contact.z - ctx.basin.group.position.z, SC.on >= 0 ? 0.45 : 0.9);
        ctx.basin.agitate(0.3);
      }
      SC.saveT += dt;
      if (SC.saveT > 1 && SC.dirty) { SC.saveT = 0; saveDirt(ctx); }
    }
    // brush pose
    if (SC.mode === 'glide' || SC.mode === 'held') {
      brushTargetPose(ctx, _tgt);
      let k = 1;
      if (SC.mode === 'glide') { SC.glide += dt / 0.1; k = SC.glide >= 1 ? 1 : 1 - Math.pow(1 - SC.glide, 3); if (SC.glide >= 1) SC.mode = 'held'; }
      SC.pos.lerpVectors(SC.fPos, _tgt.pos, k);
      SC.yaw = lerp(SC.fYaw, _tgt.yaw, k); SC.pitch = lerp(SC.fPitch, _tgt.pitch, k); SC.roll = lerp(SC.fRoll, _tgt.roll, k);
      if (SC.mode === 'held') { SC.fPos.copy(SC.pos); SC.fYaw = SC.yaw; SC.fPitch = SC.pitch; SC.fRoll = SC.roll; }
    } else if (SC.mode === 'left') {
      SC.wait -= dt;
      // left where it was: gently follow the bobbing water/shoe height
      if (SC.wait <= 0) { SC.mode = 'return'; SC.glide = 0; SC.fPos.copy(SC.pos); SC.fYaw = SC.yaw; SC.fPitch = SC.pitch; SC.fRoll = SC.roll; }
    } else if (SC.mode === 'return') {
      SC.glide += dt / 0.5;
      const k = SC.glide >= 1 ? 1 : (SC.glide < 0.5 ? 4 * SC.glide ** 3 : 1 - Math.pow(-2 * SC.glide + 2, 3) / 2);
      restPose(ctx, _rest);
      SC.pos.lerpVectors(SC.fPos, _rest.pos, k); SC.pos.y += 0.02 * Math.sin(Math.PI * k);
      SC.yaw = lerp(SC.fYaw, _rest.yaw, k); SC.pitch = lerp(SC.fPitch, _rest.pitch, k); SC.roll = lerp(SC.fRoll, _rest.roll, k);
      if (SC.glide >= 1) SC.mode = 'rest';
    } else {
      restPose(ctx, _rest);
      SC.pos.copy(_rest.pos); SC.yaw = _rest.yaw; SC.pitch = _rest.pitch; SC.roll = _rest.roll;
      if (SC.wob > 0) {       // hint: a tiny scrubbing wiggle
        const t = ctx.time;
        SC.pos.x += 0.005 * SC.wob * Math.sin(t * 24); SC.pos.z += 0.003 * SC.wob * Math.cos(t * 24);
        SC.yaw += 0.05 * SC.wob * Math.sin(t * 24);
      }
    }
    applyBrush(ctx);
    // refresh the hint target now and then (dirtiestPoint is not free)
    if (!SC.done && !SC.held) { SC.hintT -= dt; if (SC.hintT <= 0) { SC.hintT = 0.6; scrubHintPoint(ctx); } }
  },
  onDown(p, ctx) {
    if (p.ndc && ctx.fx.popBubbleAt(p.ndc, 44, ctx.camera, viewH(ctx))) { ctx.audio.play('pop', { gain: 0.7, pitch: 0.9 + rnd() * 0.4 }); return; }
    if (SC.done) { pokeWater(ctx, p); return; }
    if (!contactAt(ctx, p)) return;
    SC.held = true; SC.mode = 'glide'; SC.glide = 0; SC.hasLast = true;
    SC.lastC.copy(SC.contact); SC.pOn = SC.on; SC.plx = SC.lx; SC.plz = SC.lz;
    SC.fPos.copy(SC.pos); SC.fYaw = SC.yaw; SC.fPitch = SC.pitch; SC.fRoll = SC.roll;
    ctx.brush.setPress(1);
    // instant answer: bristles touch (tick) + a ripple
    ctx.audio.play('hop', { pitch: 1.8, gain: 0.3 });
    ctx.basin.ripple(SC.contact.x - ctx.basin.group.position.x, SC.contact.z - ctx.basin.group.position.z, 0.7);
    if (SC.on >= 0) ctx.rigs[SC.on].press = 1;
    SC.ripT = 0.2; SC.saveT = 0;
  },
  onMove(p, ctx) {
    if (!SC.held) return;
    if (!contactAt(ctx, p)) return;
    const dx = SC.contact.x - SC.lastC.x, dz = SC.contact.z - SC.lastC.z, d = Math.hypot(dx, dz);
    SC.dist += d; SC.vx += dx; SC.vz += dz;
    if (SC.on >= 0 && d > 1e-5) {
      const same = SC.pOn === SC.on;
      scrubStroke(ctx, SC.on, same ? SC.plx : SC.lx, same ? SC.plz : SC.lz, SC.lx, SC.lz, d, dx, dz);
    } else if (SC.on < 0 && d > 0.004) {
      ctx.basin.agitate(0.5);
    }
    SC.lastC.copy(SC.contact); SC.pOn = SC.on; SC.plx = SC.lx; SC.plz = SC.lz;
  },
  onUp(p, ctx) {
    if (!SC.held) return;
    SC.held = false; SC.on = -1;
    ctx.brush.setPress(0);
    if (!SC.done) { SC.mode = 'left'; SC.wait = 1.2; }
    if (SC.dirty) saveDirt(ctx);
  },
};

// =============================================================================================
// 5. rinse — tip out the black water, rinse with the tap
// =============================================================================================
const RS = {
  grab: null, tapGrab: false, tilt: 0, auto: false, autoT: 0, tok: 0, taps: 0, wob: 0,
  done: false, hintMode: '', splT: 0, wetT: 0, wetN: 0, ripT: 0, bubT: 0, poured: false,
};
const _rim = new THREE.Vector3(), _pdir = new THREE.Vector3(0, -0.02, 0.15), _land = new THREE.Vector3();
function needTip(ctx) { const s = ctx.state; return !s.dumped && s.water.murk > 0.25 && s.water.level > 0.05; }
function waterClean(ctx) { const s = ctx.state; return s.dumped || s.water.murk < 0.25; }
function rinseHint(ctx) {
  let mode = 'none';
  if (!RS.done) mode = needTip(ctx) ? 'tip' : (waterClean(ctx) ? 'tap' : 'none');
  if (mode === RS.hintMode) return;
  RS.hintMode = mode;
  if (mode === 'tip') {
    ctx.hint.set({
      target: () => _rim.set(ctx.basin.group.position.x, ctx.basin.RIM_Y, ctx.basin.group.position.z + ctx.basin.OUTER_R),
      gesture: { type: 'pull', dir: _pdir },
      wobble: (k, t) => { RS.wob = k * 0.052 * (0.5 + 0.5 * Math.sin(t * 7)); },
      cue: () => ctx.audio.play('slosh', { gain: 0.55 }),
    });
  } else if (mode === 'tap') ctx.hint.set(tapHintCfg(ctx));
  else ctx.hint.clear();
}
function rockBack(ctx) {
  const t0 = RS.tilt, tok = ++RS.tok;
  ctx.audio.play('clatter', { gain: 0.6 });
  if (ctx.state.water.level > 0.05) ctx.audio.play('slosh', { gain: 0.6 });
  ctx.tl.tween(0.5, (k) => { if (tok === RS.tok) RS.tilt = t0 * (1 - k); }, 'outBounce');
}
function rinseFinish(ctx) {
  RS.done = true; ctx.hint.clear(); RS.hintMode = 'none';
  const st = ctx.state;
  st.rinse = 1; st.water.foam = 0;
  ctx.fx.foam.clear();
  for (let i = 0; i < 2; i++) ctx.fx.sparkle(shoeCenter(ctx, i, _e, 0.05), { count: 3, spread: 0.05 });
  ctx.audio.play('sparkle', { gain: 0.9 });
  ctx.saveSoon();
  ctx.tl.after(0.9, () => ctx.flow.next());
}
const rinse = {
  id: 'rinse', shot: SHOTS.rinse,
  place(ctx) {
    placeCommon(ctx, 'rinse');
    const st = ctx.state;
    RS.grab = null; RS.tapGrab = false; RS.tilt = 0; RS.auto = false; RS.tok++; RS.taps = 0; RS.wob = 0;
    RS.done = false; RS.hintMode = ''; RS.splT = 0; RS.wetT = 0; RS.wetN = 0; RS.ripT = 0; RS.bubT = 0; RS.poured = false;
    if (st.rinse < 1) for (let i = 0; i < 2; i++) if (ctx.fx.foam.countOn(ctx.shoes[i].group) < 10) seedFoam(ctx, i, 50);
    ctx.brush.setFoam(st.rinse < 1 ? 0.7 : 0);
  },
  enter(ctx) {
    if (brushInBasin) {
      const g = ctx.brush.group;
      ctx.brush.setPress(0);
      flyTo(ctx, g, ctx.scene, PARK, _q2.setFromEuler(new THREE.Euler(0, PARK_YAW, 0, 'YXZ')).clone(), 0.8, 0.1).then(() => { brushInBasin = false; ctx.audio.play('clack', { gain: 0.3, pitch: 0.8 }); });
    }
    if (ctx.state.rinse >= 1) { rinseFinish(ctx); return; }
    rinseHint(ctx);
  },
  exit(ctx) {
    releaseTap(ctx, RS);
    RS.grab = null; RS.auto = false; RS.tok++; RS.tilt = 0;
    ctx.basin.setTilt(0); ctx.basin.setPour(0); ctx.sim.tilt = 0; ctx.sim.handleWobble = 0;
    for (let i = 0; i < 2; i++) ctx.rigs[i].slide = 0;
    ctx.audio.setLoop('pour', 0); ctx.audio.setLoop('fizz', 0);
    if (brushInBasin) parkBrush(ctx);
  },
  update(dt, ctx) {
    const st = ctx.state, w = st.water, b = ctx.basin, fx = ctx.fx;
    // auto tip after a plain tap
    if (RS.auto) {
      RS.autoT += dt;
      const u = RS.autoT;
      RS.tilt = u < 0.25 ? 0.8 * Math.sin(u / 0.25 * Math.PI / 2) : u < 0.6 ? 0.8 : u < 0.9 ? 0.8 * (1 - (u - 0.6) / 0.3) : 0;
      if (u >= 0.9) {
        RS.auto = false; RS.tilt = 0;
        ctx.audio.play('clatter', { gain: 0.55 });
        if (RS.taps >= 3 && w.level < 0.25 && !st.dumped) w.level = 0.01;
      }
    }
    const tilt = RS.tilt + (RS.grab || RS.auto ? 0 : RS.wob);
    b.setTilt(tilt); ctx.sim.tilt = tilt;
    for (let i = 0; i < 2; i++) ctx.rigs[i].slide = RS.tilt * 0.05;
    // pouring
    if (RS.tilt > 0.3 && w.level > 0.02) {
      const rate = clamp((RS.tilt - 0.3) / 0.55, 0, 1);
      w.level = Math.max(0, w.level - rate * 0.45 * dt * (RS.auto ? 1.7 : 1));
      b.setPour(rate);
      ctx.audio.setLoop('pour', rate);
      b.pourLanding(_land);
      const col = w.murk > 0.3 ? DARK : CLEARW;
      RS.splT -= dt;
      if (RS.splT <= 0) { RS.splT = 0.1; fx.splash(_land, { count: 3, speed: 0.9 * (0.5 + rate), spread: 0.5, size: 1.2, color: col }); }
      RS.wetT -= dt;
      if (RS.wetT <= 0) {
        RS.wetT = 0.3; RS.wetN++;
        const off = Math.min(0.25, RS.wetN * 0.02);
        fx.wetPatch(_e.set(_land.x + (rnd() - 0.5) * 0.06, 0, _land.z + off), 0.06 + Math.min(0.08, RS.wetN * 0.006), { life: 45, grow: 0.04, dark: 0.55 });
      }
      if (rnd() < dt * 4) ctx.cam.shake(0.0012 * rate, 0.15);
      RS.poured = true;
    } else { b.setPour(0); ctx.audio.setLoop('pour', 0); }
    if (!st.dumped && w.level <= 0.02 && RS.poured) {
      st.dumped = true; w.murk = 0; w.level = 0; w.foam = 0;
      b.setPour(0); ctx.audio.setLoop('pour', 0);
      ctx.saveSoon();
    }
    // rinsing
    if (!RS.done) {
      if (waterClean(ctx) && ctx.sim.flow > 0.1) {
        const f = ctx.sim.flow;
        st.rinse = Math.min(1, st.rinse + f * dt / 3.2);
        fx.foam.removeFraction(f * dt * 0.7);
        w.foam *= Math.exp(-f * dt * 0.8);
        ctx.brush.setFoam(0.7 * (1 - st.rinse));
        RS.ripT -= dt;
        if (RS.ripT <= 0) { RS.ripT = 0.35 + rnd() * 0.2; const i = rnd() < 0.5 ? 0 : 1; b.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 0.5); ctx.rigs[i].press = Math.max(ctx.rigs[i].press, 0.4); }
        RS.bubT -= dt;
        if (RS.bubT <= 0 && fx.foam.count() > 5) { RS.bubT = 0.5 + rnd() * 0.4; fx.bubble(shoeCenter(ctx, rnd() < 0.5 ? 0 : 1, _e, 0.05), { size: 0.8 }); }
        ctx.hint.nudge();
        if (st.rinse >= 1) rinseFinish(ctx);
        else ctx.saveSoon();
      }
    }
    ctx.audio.setLoop('fizz', clamp(fx.foam.count() / 200, 0, 1));
    rinseHint(ctx);
  },
  onDown(p, ctx) {
    if (tapOrWaterDown(ctx, p, RS)) return;
    const near = ctx.pickNearest(p, [{ pos: _e.set(ctx.basin.group.position.x, 0.065, ctx.basin.group.position.z), radiusPx: 140 }]);
    if (needTip(ctx) && !RS.auto && near) {
      RS.grab = { x: p.x, y: p.y, t0: RS.tilt }; RS.tok++;
      ctx.audio.play('slosh', { gain: 0.45 }); ctx.basin.agitate(0.7);
      return;
    }
    const j = pickBasinShoe(ctx, p);
    if (j >= 0 && ctx.state.water.level > 0.05) { bobShoe(ctx, j); return; }
    if (pokeWater(ctx, p)) return;
    if (near) { ctx.audio.play('knock', { gain: 0.35, pitch: 0.8 }); ctx.basin.agitate(0.4); }
  },
  onMove(p, ctx) {
    if (RS.tapGrab) { ctx.sim.tapMove(p); return; }
    const g = RS.grab; if (!g) return;
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    RS.tilt = Math.max(0, Math.min(0.85, g.t0 + clamp(d / 170, 0, 1) * 0.85));
  },
  onUp(p, ctx) {
    if (RS.tapGrab) { releaseTap(ctx, RS, p); return; }
    const g = RS.grab; if (!g) return;
    RS.grab = null;
    if (p.isTap && needTip(ctx)) { RS.auto = true; RS.autoT = 0; RS.taps++; RS.tok++; ctx.audio.play('slosh', { gain: 0.6 }); }
    else rockBack(ctx);
  },
};

export const washStages = [bag, fill, dunk, scrub, rinse];
