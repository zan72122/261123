// DRY half of the game: load -> spin -> hang -> sun -> pack -> end.
// Every stage's place() rebuilds the canonical picture from ctx.state (see placeCommon).
import * as THREE from 'three';
import { L, SHOTS } from './layout.js';
import { clamp, lerp, applyShoeState, putShoe, shoePose, flyTo, flyShoe, Carry, placeBag, resetRound } from './common.js';

// ---------------------------------------------------------------------------------------------
// Camera shots (own copies; the garden ones are tuned for a low camera looking up at the sky)
// ---------------------------------------------------------------------------------------------
const SH = {
  load: { box: [-0.02, 0.0, -0.02, 0.6, 0.36, 0.57], yaw: -30, pitch: 44 },
  spin: SHOTS.spin,
  hang: { box: [0.45, 0.15, 0.3, 1.25, 1.2, 0.75], yaw: 96, pitch: 26, fov: 36 },
  sky: { box: [1.25, 0.72, 0.3, 1.25, 1.1, 0.56], yaw: 100, pitch: -20 },
  pack: { box: [1.25, 0.62, 0.30, 1.25, 1.25, 0.88], yaw: 140, pitch: -18 },
  end: { box: [1.25, 0.6, 0.6, 1.25, 1.15, 0.9], yaw: 105, pitch: -6 },
  endIn: { box: [1.25, 0.56, 0.6, 1.25, 1.12, 0.9], yaw: 103, pitch: -5 },
  away: { box: [2.2, 3.2, 0.2, 2.2, 4.4, 1.0], yaw: 110, pitch: -42 },
};

const TAU = Math.PI * 2;
const ORDER = ['load', 'spin', 'hang', 'sun', 'pack', 'end'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _tgt = new THREE.Vector3(), _open = new THREE.Vector3(), _cc = new THREE.Vector3(), _mouth = new THREE.Vector3();
const rnd = Math.random;
const smooth01 = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

let crankA = 0;                 // crank angle survives stage changes (the knob stays where it was left)
let spinRattle = 0;             // tiny shake of the whole dryer (decays in update)

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
function setShoeLook(ctx, i, wet, shine) {
  const s = ctx.state.shoes[i];
  if (wet != null) { s.wet = clamp(wet, 0, 1); ctx.shoes[i].setWet(s.wet); }
  if (shine != null) { s.shine = clamp(shine, 0, 1); ctx.shoes[i].setShine(s.shine); }
}
function openingWorld(ctx, out, up = 0) { ctx.spinner.group.updateWorldMatrix(true, false); return ctx.spinner.group.localToWorld(out.set(0, 0.32 + up, 0)); }
function spoutTipWorld(ctx, out) { return ctx.spinner.group.localToWorld(out.set(0, 0.036, 0.222)); }
function shoeWorld(ctx, i, out, lx = 0, ly = 0, lz = 0) { const g = ctx.shoes[i].group; g.updateWorldMatrix(true, false); return g.localToWorld(out.set(lx, ly, lz)); }
function toeWorld(ctx, i, out) { return shoeWorld(ctx, i, out, 0, 0.012, -ctx.shoes[i].LENGTH / 2 + 0.01); }
function heelWorld(ctx, i, out) { return shoeWorld(ctx, i, out, 0, 0.035, ctx.shoes[i].LENGTH / 2 - 0.01); }
function midWorld(ctx, i, out) { return shoeWorld(ctx, i, out, 0, 0.025, 0); }
// world pose of shoe i at `where` (position + quaternion)
function poseWorld(ctx, i, where, outP, outQ) {
  const p = shoePose(ctx, i, where);
  p.parent.updateWorldMatrix(true, false);
  if (outP) outP.copy(p.pos).applyMatrix4(p.parent.matrixWorld);
  if (outQ) p.parent.getWorldQuaternion(outQ).multiply(p.quat);
  return p;
}
function rattleDryer(a) { spinRattle = Math.max(spinRattle, a); }

// drop shoe i into the dryer: first over the opening (world), then straight down into its slot
function dropIntoDryer(ctx, i, d1 = 0.22, d2 = 0.2, arc = 0.06) {
  const g = ctx.shoes[i].group, rig = ctx.rigs[i];
  rig.where = 'fly';
  const via = openingWorld(ctx, new THREE.Vector3(), 0.12);
  const wq = new THREE.Quaternion(); const p = poseWorld(ctx, i, 'spinner', null, wq);
  return flyTo(ctx, g, ctx.scene, via, wq, d1, arc, 'out')
    .then(() => flyTo(ctx, g, p.parent, p.pos, p.quat, d2, 0, 'in'))
    .then(() => { rig.where = 'spinner'; });
}
// a shoe falling from somewhere: drips with wet patches on the ground
function dripFrom(ctx, pos, { quiet = 0.35, patch = true, floorY = 0 } = {}) {
  ctx.fx.drip(pos, { floorY, onLand: (lp) => {
    if (patch) ctx.fx.wetPatch(lp, 0.012 + rnd() * 0.008, { life: 20 });
    if (rnd() < 0.5) ctx.audio.play('dripDry', { gain: quiet, pitch: 0.9 + rnd() * 0.3 });
  } });
}

// One helper for the canonical picture of every dry stage.
function placeCommon(ctx, id) {
  const s = ctx.state, n = ORDER.indexOf(id);
  const garden = n >= 2;
  ctx.world.setTimeOfDay(id === 'pack' || id === 'end' ? 1 : 0);
  // shoe looks
  if (id === 'spin') for (let i = 0; i < 2; i++) s.shoes[i].wet = 1 - 0.65 * s.dry;
  if (id === 'pack' || id === 'end') for (let i = 0; i < 2; i++) { s.shoes[i].wet = 0; s.shoes[i].shine = 1; }
  if (n >= 1) for (let i = 0; i < 2; i++) s.shoes[i].dirt = 'clean';
  applyShoeState(ctx);
  if (id === 'sun') for (let i = 0; i < 2; i++) { ctx.shoes[i].setWet(0.35); ctx.shoes[i].setShine(0); }
  // bag
  const bag = ctx.bag;
  placeBag(ctx, garden);
  if (!garden) { bag.setFill(0); bag.setOpen(0.5); bag.setDusty(1); }
  else if (id === 'hang' || id === 'sun') { bag.setFill(0); bag.setOpen(0.6); bag.setDusty(0.15); }
  else if (id === 'pack') { bag.setFill(s.packed.filter(Boolean).length); bag.setOpen(1); bag.setDusty(0); }
  else { bag.setFill(2); bag.setOpen(0.4); bag.setDusty(0); }
  // clips + hanger
  const hanger = ctx.hanger;
  for (let i = 0; i < 2; i++) {
    const c = hanger.clips[i];
    const on = id === 'hang' ? s.hung[i] : id === 'sun' ? true : id === 'pack' ? !s.packed[i] : false;
    c.setOpen(0); c.setLoad(on ? 1 : 0);
  }
  hanger.sway(id === 'end' ? 0.35 : 0);
  // dryer
  const sp = ctx.spinner;
  sp.setLidOpen(id === 'spin' ? 0 : 1);
  sp.setSpin(0); sp.setWater(id === 'spin' ? (1 - s.dry) * 0.3 : 0); sp.setSpout(0);
  sp.setCrankAngle(crankA);
  sp.group.position.fromArray(L.SPINNER); sp.group.rotation.set(0, 0, 0);
  spinRattle = 0;
  // brush, basin, tap
  const br = ctx.brush;
  if (br.group.parent !== ctx.scene) ctx.scene.add(br.group);
  br.group.position.fromArray(L.BRUSH_PARK); br.group.rotation.set(0, 0.5, 0); br.group.scale.setScalar(1);
  br.setPress(0);
  ctx.basin.setTilt(0); ctx.basin.setPour(0); ctx.sim.tilt = 0; ctx.sim.handleWobble = 0;
  // shoes
  for (let i = 0; i < 2; i++) {
    let w = 'spinner';
    if (id === 'load') w = s.loaded[i] ? 'spinner' : 'basin';
    else if (id === 'hang') w = s.hung[i] ? 'clip' : 'spinner';
    else if (id === 'sun') w = 'clip';
    else if (id === 'pack') w = s.packed[i] ? 'packed' : 'clip';
    else if (id === 'end') w = 'packed';
    putShoe(ctx, i, w);
  }
  stopLoops(ctx);
}
function stopLoops(ctx) {
  ctx.audio.setLoop('spin', 0); ctx.audio.setLoop('spout', 0); ctx.audio.setLoop('night', 0);
}
// the dryer's little shake (used by several stages)
function updateDryer(dt, ctx) {
  if (spinRattle > 0.0005) {
    spinRattle *= Math.exp(-dt * 7);
    const t = ctx.time;
    ctx.spinner.group.rotation.set(Math.sin(t * 61) * spinRattle * 0.6, 0, Math.sin(t * 47 + 1) * spinRattle);
  } else if (spinRattle !== 0) { spinRattle = 0; ctx.spinner.group.rotation.set(0, 0, 0); }
}
function next(ctx) { ctx.flow.next(); }

// =============================================================================================
// 6. load — carry the dripping shoes into the spin dryer
// =============================================================================================
const LD = { grab: null, carry: null, carryI: -1, tap: false, taps: [0, 0], dripT: 0, done: false };
function loadTarget(ctx) { return openingWorld(ctx, _open, 0.06); }
function loadNextShoe(ctx) {
  for (let i = 0; i < 2; i++) if (!ctx.state.loaded[i] && ctx.rigs[i].where === 'basin') return i;
  return -1;
}
function loadHint(ctx) {
  const i = loadNextShoe(ctx);
  if (i < 0 || LD.done) { ctx.hint.clear(); return; }
  const rig = ctx.rigs[i];
  ctx.hint.set({
    target: ctx.shoes[i].group,
    gesture: { type: 'drag', to: () => loadTarget(ctx) },
    wobble: (k, t) => { rig.press = k * (0.55 + 0.45 * Math.sin(t * 7)); },
    cue: () => {
      ctx.audio.play('plip', { gain: 0.35, pitch: 1.1 });
      ctx.basin.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 0.6);
    },
  });
}
function loadShoeIn(ctx, i, fromBasin) {
  const st = ctx.state;
  st.loaded[i] = true; ctx.saveSoon();
  dropIntoDryer(ctx, i, fromBasin ? 0.34 : 0.2, 0.2, fromBasin ? 0.14 : 0.05).then(() => {
    ctx.audio.play('thud', { gain: 0.7, pitch: 1.15 });
    rattleDryer(0.03);
    const sp = shoeWorld(ctx, i, _v, 0, 0.02, -0.08);
    ctx.fx.splash(sp, { count: 7, speed: 0.7, size: 0.6, floorY: L.SPINNER[1] + 0.08 });
    ctx.spinner.setWater(0.15);
    if (st.loaded[0] && st.loaded[1]) finishLoad(ctx);
    else loadHint(ctx);
  });
  ctx.hint.clear();
}
function finishLoad(ctx) {
  if (LD.done) return;
  LD.done = true; ctx.hint.clear();
  ctx.tl.after(0.35, () => {
    ctx.tl.tween(0.9, (k) => ctx.spinner.setLidOpen(1 - k), 'inOut').then(() => {
      ctx.audio.play('clack', { gain: 0.8 });
      rattleDryer(0.02);
      ctx.tl.after(0.45, () => next(ctx));
    });
  });
}
function loadStartCarry(ctx, i, p) {
  const g = ctx.shoes[i].group, rig = ctx.rigs[i];
  rig.where = 'carry';
  LD.carry = new Carry(ctx, { obj: g, getTarget: () => loadTarget(ctx), lift: 0.12 });
  LD.carryI = i;
  LD.carry.begin(p);
  const wp = g.getWorldPosition(_v);
  ctx.fx.splash(wp, { count: 12, speed: 0.9, size: 0.75, floorY: ctx.basin.waterY() });
  ctx.audio.play('splash', { gain: 0.45, pitch: 1.2 });
  ctx.basin.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 1.4);
  ctx.basin.ripple(L.BASIN_SLOTS[i][0] * 0.3, L.BASIN_SLOTS[i][1] + 0.05, 0.8);
  LD.dripT = 0.05;
  ctx.hint.clear();
}
const load = {
  id: 'load', shot: SH.load,
  place(ctx) { placeCommon(ctx, 'load'); },
  enter(ctx) {
    LD.grab = null; LD.carry = null; LD.carryI = -1; LD.tap = false; LD.taps = [0, 0]; LD.done = false;
    if (ctx.state.loaded[0] && ctx.state.loaded[1]) finishLoad(ctx); else loadHint(ctx);
  },
  exit(ctx) {
    if (LD.tap) ctx.sim.tapUp({ isTap: false, cancelled: true });
    LD.tap = false; LD.grab = null; LD.carry = null;
    for (const r of ctx.rigs) r.press = 0;
  },
  onDown(p, ctx) {
    if (ctx.sim.tapDown(p)) { LD.tap = true; return; }
    if (LD.carry || LD.done) return;
    const cand = [];
    for (let i = 0; i < 2; i++) if (!ctx.state.loaded[i] && ctx.rigs[i].where === 'basin') cand.push({ obj: ctx.shoes[i].group, radiusPx: 95, data: i });
    const hit = ctx.pickNearest(p, cand);
    if (hit) {
      const i = hit.data;
      ctx.rigs[i].press = 1;                        // instant: the shoe dips under the finger
      ctx.audio.play('plip', { gain: 0.5, pitch: 0.9 + rnd() * 0.2 });
      ctx.basin.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 0.9);
      LD.grab = { i, x: p.x, y: p.y };
      return;
    }
    // other friendly responses
    openingWorld(ctx, _v, -0.12);
    if (ctx.screenDist(p, _v) < 120) { rattleDryer(0.025); ctx.audio.play('rattle', { gain: 0.35 }); return; }
    const w = ctx.rayPlaneY(p, ctx.basin.waterY());
    if (w && Math.hypot(w.x - L.BASIN[0], w.z - L.BASIN[2]) < 0.25 && ctx.state.water.level > 0.05) {
      ctx.basin.ripple(w.x - L.BASIN[0], w.z - L.BASIN[2], 1);
      ctx.audio.play('plip', { gain: 0.45, pitch: 1.2 + ctx.state.water.level * 0.4 });
    }
  },
  onMove(p, ctx) {
    if (LD.tap) { ctx.sim.tapMove(p); return; }
    if (LD.grab && !LD.carry) {
      if (Math.hypot(p.x - LD.grab.x, p.y - LD.grab.y) > 9) loadStartCarry(ctx, LD.grab.i, p);
      else return;
    }
    if (LD.carry) LD.carry.move(p);
  },
  onUp(p, ctx) {
    if (LD.tap) { LD.tap = false; ctx.sim.tapUp(p); return; }
    const g = LD.grab; LD.grab = null;
    if (LD.carry) {
      const c = LD.carry, i = LD.carryI; LD.carry = null; LD.carryI = -1;
      const ok = c.end(p) && !p.cancelled;
      if (ok) loadShoeIn(ctx, i, false);
      else {
        flyShoe(ctx, i, 'basin', 0.3, 0.05).then(() => {
          ctx.audio.play('splash', { gain: 0.5 });
          ctx.fx.splash(shoeWorld(ctx, i, _v), { count: 10, speed: 0.8, size: 0.7, floorY: ctx.basin.waterY() });
          ctx.basin.ripple(L.BASIN_SLOTS[i][0], L.BASIN_SLOTS[i][1], 1.5);
          loadHint(ctx);
        });
      }
      return;
    }
    if (g && !p.cancelled) {                        // a tap on a floating shoe: it bobbed; the 2nd tap hops it in
      LD.taps[g.i]++;
      if (LD.taps[g.i] >= 2) {
        ctx.rigs[g.i].where = 'fly';
        ctx.fx.splash(shoeWorld(ctx, g.i, _v), { count: 12, speed: 0.9, size: 0.75, floorY: ctx.basin.waterY() });
        ctx.audio.play('splash', { gain: 0.45, pitch: 1.2 });
        loadShoeIn(ctx, g.i, true);
      }
    }
  },
  update(dt, ctx) {
    updateDryer(dt, ctx);
    if (LD.carry) {
      LD.carry.update(dt);
      const i = LD.carryI;
      LD.dripT -= dt;
      if (LD.dripT <= 0) {
        LD.dripT = 0.1 + rnd() * 0.06;
        const dp = shoeWorld(ctx, i, _v, (rnd() - 0.5) * 0.05, -0.002, (rnd() - 0.5) * 0.16);
        const bd = Math.hypot(dp.x - L.BASIN[0], dp.z - L.BASIN[2]);
        const sd = Math.hypot(dp.x - L.SPINNER[0], dp.z - L.SPINNER[2]);
        if (bd < 0.24) {
          const wy = ctx.basin.waterY();
          ctx.fx.drip(dp, { floorY: wy, onLand: (lp) => { ctx.basin.ripple(lp.x - L.BASIN[0], lp.z - L.BASIN[2], 0.5); if (rnd() < 0.3) ctx.audio.play('drip', { gain: 0.3 }); } });
        } else if (sd < 0.13) {
          ctx.fx.drip(dp, { floorY: L.SPINNER[1] + 0.09, onLand: () => { if (rnd() < 0.3) ctx.audio.play('dripDry', { gain: 0.25 }); } });
        } else dripFrom(ctx, dp, { quiet: 0.3 });
      }
    }
  },
};

// =============================================================================================
// 7. spin — turn the crank!
// =============================================================================================
const SP = { held: false, last: null, acc: 0, wc: 0, w: 0, spout: 0, phase: 'spin', t: 0, auto: 0, rattleT: 0, splT: 0, patchT: 0, dripN: 0, dripT: 0, saveT: 0, hinted: false };
function crankCenterW(ctx) { ctx.spinner.crankCenter.updateWorldMatrix(true, false); return ctx.spinner.crankCenter.getWorldPosition(_cc); }
// angle of the finger around the crank axis (same convention as setCrankAngle); null when too close to the axis
function fingerAngle(p, ctx) {
  const c = crankCenterW(ctx);
  const hit = ctx.rayPlaneY(p, c.y + 0.03);
  if (!hit) return null;
  const dx = hit.x - c.x, dz = hit.z - c.z;
  if (dx * dx + dz * dz < 0.02 * 0.02) return null;
  return Math.atan2(-dz, dx);
}
function spinHint(ctx) {
  ctx.hint.set({
    target: ctx.spinner.knob,
    gesture: { type: 'circle', center: () => crankCenterW(ctx), radius: ctx.spinner.CRANK_R },
    wobble: (k, t) => { ctx.spinner.setCrankAngle(crankA + 0.5 * k * Math.sin(t * 7)); },
    cue: () => ctx.audio.play('rattle', { gain: 0.3 }),
  });
}
const spin = {
  id: 'spin', shot: SH.spin,
  place(ctx) { placeCommon(ctx, 'spin'); },
  enter(ctx) {
    Object.assign(SP, { held: false, last: null, acc: 0, wc: 0, w: 0, spout: 0, phase: 'spin', t: 0, auto: 0, rattleT: 0, splT: 0, patchT: 0, dripN: 0, dripT: 0, saveT: 0 });
    if (ctx.state.dry >= 1) { SP.phase = 'stop'; } else spinHint(ctx);
  },
  exit(ctx) {
    SP.held = false; SP.last = null;
    ctx.spinner.setSpin(0); ctx.spinner.setSpout(0);
    stopLoops(ctx);
  },
  onDown(p, ctx) {
    if (SP.phase !== 'spin' && SP.phase !== 'drain') { rattleDryer(0.02); ctx.audio.play('rattle', { gain: 0.3 }); return; }
    const c = crankCenterW(ctx);
    ctx.spinner.knob.getWorldPosition(_v);
    if (ctx.screenDist(p, c) <= 150 || ctx.screenDist(p, _v) <= 110) {
      SP.held = true; SP.last = fingerAngle(p, ctx);
      ctx.audio.play('rattle', { gain: 0.25, pitch: 1.2 });
      rattleDryer(0.01);
    } else { rattleDryer(0.02); ctx.audio.play('rattle', { gain: 0.35 }); }
  },
  onMove(p, ctx) {
    if (!SP.held) return;
    const a = fingerAngle(p, ctx);
    if (a == null) { SP.last = null; return; }
    if (SP.last != null) {
      let d = clamp(wrapA(a - SP.last), -1, 1);
      // the knob slides under the finger while turning (so it ends up exactly following the finger)
      const err = wrapA(a - (crankA + d));
      d += err * Math.min(1, Math.abs(d) * 0.8);
      crankA += d; SP.acc += d;
      ctx.spinner.setCrankAngle(crankA);
    }
    SP.last = a;
  },
  onUp(p, ctx) {
    if (!SP.held) return;
    SP.held = false; SP.last = null;
    if (p.isTap && SP.phase === 'spin') SP.auto = Math.PI * 1.2;    // a tap flicks the crank round by itself
  },
  update(dt, ctx) {
    updateDryer(dt, ctx);
    const st = ctx.state, sp = ctx.spinner, audio = ctx.audio, fx = ctx.fx;
    dt = Math.max(dt, 1e-3);
    if (SP.auto > 0) {           // tap flick: the crank turns ~half a turn by itself
      const d = Math.min(SP.auto, dt * 9);
      SP.auto -= d; crankA += d; SP.acc += d; sp.setCrankAngle(crankA);
    }
    // crank angular speed (smoothed)
    const raw = SP.acc / dt; SP.acc = 0;
    SP.wc += (raw - SP.wc) * (1 - Math.exp(-dt * 10));
    if (!SP.held && SP.auto <= 0) SP.wc *= Math.exp(-dt * 10);
    // basket: inertia + freewheel
    if (SP.phase === 'stop' || SP.phase === 'open') {
      SP.w *= Math.exp(-dt * 1.6);
      SP.w -= Math.sign(SP.w) * Math.min(Math.abs(SP.w), dt * 2.5);
    } else {
      const target = clamp(SP.wc * 5, -42, 42);
      if (Math.abs(target) > Math.abs(SP.w) || Math.sign(target) !== Math.sign(SP.w) && Math.abs(target) > 1) SP.w += (target - SP.w) * (1 - Math.exp(-dt * 3.2));
      else SP.w *= Math.exp(-dt * 0.5);
      SP.w = clamp(SP.w, -42, 42);
      if (Math.abs(SP.w) < 0.02) SP.w = 0;
    }
    sp.setSpin(SP.w);
    const aw = Math.abs(SP.w);
    // water
    const rate = Math.pow(clamp((aw - 6) / 26, 0, 1), 1.3);
    if (SP.phase === 'spin' && rate > 0) {
      st.dry = Math.min(1, st.dry + rate * dt / 5);
      SP.saveT += dt; if (SP.saveT > 1) { SP.saveT = 0; ctx.saveSoon(); }
      ctx.hint.nudge();
    }
    const wet = 1 - st.dry;
    sp.setWater(wet * (0.3 + 0.7 * rate));
    SP.spout += (wet * rate - SP.spout) * (1 - Math.exp(-dt * (wet * rate > SP.spout ? 4 : 2)));
    if (SP.spout < 0.003) SP.spout = 0;
    sp.setSpout(SP.spout);
    audio.setLoop('spin', aw / 42, wet);
    audio.setLoop('spout', SP.spout);
    for (let i = 0; i < 2; i++) { const w = 1 - 0.65 * st.dry; if (Math.abs(st.shoes[i].wet - w) > 0.002) setShoeLook(ctx, i, w, null); }
    // stream landing: splashes + a growing wet patch
    if (SP.spout > 0.05) {
      const land = sp.spoutLanding(_v);
      SP.splT -= dt;
      if (SP.splT <= 0) { SP.splT = 0.07 + 0.1 * (1 - SP.spout); fx.splash(land, { count: 1 + Math.round(SP.spout * 2), speed: 0.55 + SP.spout * 0.5, size: 0.55, spread: 0.7 }); }
      SP.patchT -= dt;
      if (SP.patchT <= 0) { SP.patchT = 0.45; land.z += 0.03; fx.wetPatch(land, 0.03 + 0.045 * st.dry, { life: 90, dark: 0.22, grow: 0.01 }); }
    }
    // fast: the whole thing judders, stray drops from under the lid rim
    if (aw > 34) {
      SP.rattleT -= dt;
      if (SP.rattleT <= 0) {
        SP.rattleT = 0.1 + rnd() * 0.05;
        audio.play('rattle', { gain: 0.45 + rnd() * 0.2, pitch: 0.9 + rnd() * 0.25 });
        ctx.cam.shake(0.002, 0.15);
        rattleDryer(0.012);
        if (wet > 0.04) {
          const a = rnd() * TAU, R = 0.165;
          sp.group.localToWorld(_v.set(Math.cos(a) * R, 0.33, Math.sin(a) * R));
          _v2.set(Math.cos(a) - Math.sin(a) * 0.6, 0.35, Math.sin(a) + Math.cos(a) * 0.6);
          fx.spray(_v, _v2, { count: 2 + rnd() * 2, speed: 1.1, size: 0.7, spread: 0.3 });
        }
      }
    }
    // phases
    if (SP.phase === 'spin' && st.dry >= 1) { SP.phase = 'drain'; SP.t = 0; SP.dripN = 5; SP.dripT = 0.5; ctx.hint.clear(); ctx.saveSoon(); }
    if (SP.phase === 'drain') {
      SP.t += dt;
      SP.dripT -= dt;
      if (SP.dripN > 0 && SP.dripT <= 0) {
        SP.dripN--; SP.dripT = 0.3 + rnd() * 0.3;
        spoutTipWorld(ctx, _v);
        fx.drip(_v, { onLand: (lp) => { ctx.audio.play('dripDry', { gain: 0.45 }); fx.wetPatch(lp, 0.015, { life: 60 }); } });
      }
      if ((!SP.held && SP.t > 0.6) || SP.t > 2.5) { SP.phase = 'stop'; SP.held = false; SP.last = null; }
    }
    if (SP.phase === 'stop' && Math.abs(SP.w) < 0.25) {
      SP.phase = 'open'; SP.w = 0; sp.setSpin(0);
      ctx.tl.after(0.25, () => {
        ctx.audio.play('lidOpen', { gain: 0.8 });
        ctx.tl.tween(0.8, (k) => sp.setLidOpen(k), 'inOut').then(() => {
          for (let i = 0; i < 2; i++) { midWorld(ctx, i, _v); fx.sparkle(_v, { count: 3, spread: 0.04 }); }
          ctx.audio.play('sparkle', { gain: 0.6 });
          ctx.tl.after(0.9, () => next(ctx));
        });
      });
    }
  },
};

// =============================================================================================
// 8. hang — up onto the clothespins
// =============================================================================================
const HG = { carry: null, i: -1, taps: [0, 0], done: false, pokeT: [0, 0], lastPoke: [0, 0], grabT: 0 };
const _hq = [new THREE.Quaternion(), new THREE.Quaternion()];
function hangTarget(ctx, i) { poseWorld(ctx, i, 'clip', _tgt, null); return _tgt; }
function hangNext(ctx) { for (let i = 0; i < 2; i++) if (!ctx.state.hung[i] && ctx.rigs[i].where === 'spinner') return i; return -1; }
function hangHint(ctx) {
  const i = hangNext(ctx);
  if (i < 0 || HG.done) { ctx.hint.clear(); return; }
  const g = ctx.shoes[i].group, clip = ctx.hanger.clips[i];
  ctx.hint.set({
    target: g,
    gesture: { type: 'drag', to: () => { clip.pivot.getWorldPosition(_v3); _v3.y -= 0.05; return _v3; } },
    wobble: (k, t) => {
      if (ctx.rigs[i].where !== 'spinner') return;
      g.position.set(0, 0, 0.014 * k * Math.abs(Math.sin(t * 9)));
      clip.setOpen(k * (0.5 + 0.5 * Math.sin(t * 6)));
    },
    cue: () => ctx.audio.play('snap', { gain: 0.3 }),
  });
}
function pokeShoe(ctx, i, iz, ix, chain = true) {
  const c = ctx.hanger.clips[i];
  c.poke(ix, iz);
  if (ctx.state.hung[i] && ctx.shoes[i].group.parent === c.pivot && ctx.state.shoes[i].wet > 0.05) {
    for (let k = 0; k < 2; k++) dripFrom(ctx, toeWorld(ctx, i, _v).add(_v2.set(0, -0.01, (rnd() - 0.5) * 0.02)), { quiet: 0.3 });
  }
  if (chain && ctx.state.hung[0] && ctx.state.hung[1]) {
    const o = 1 - i;
    ctx.tl.after(0.22, () => {
      if (ctx.shoes[o].group.parent !== ctx.hanger.clips[o].pivot) return;
      ctx.hanger.clips[o].poke(ix * 0.4, iz * 0.45);
      ctx.audio.play('knock', { gain: 0.45, pitch: 1 + rnd() * 0.2 });
    });
  }
}
function hangShoe(ctx, i, vel) {
  const c = ctx.hanger.clips[i];
  c.setOpen(1);
  ctx.state.hung[i] = true; ctx.saveSoon();
  ctx.hint.clear();
  flyShoe(ctx, i, 'clip', 0.28, 0.02).then(() => {
    ctx.audio.play('snap', { gain: 0.85 });
    c.setOpen(0); c.setLoad(1);
    const vx = vel ? clamp(vel.x * 0.15, -0.25, 0.25) : 0, vz = vel ? clamp(vel.z * 0.15, -0.25, 0.25) : 0;
    c.poke(vx + 0.04, vz + (rnd() - 0.5) * 0.08);
    ctx.hanger.bounce(0.6);
    // drips from the toe over the next seconds
    let n = 4;
    const tick = () => { if (n-- <= 0 || ctx.shoes[i].group.parent !== c.pivot) return; dripFrom(ctx, toeWorld(ctx, i, _v)); ctx.tl.after(0.5 + rnd() * 0.7, tick); };
    ctx.tl.after(0.35, tick);
    if (ctx.state.hung[0] && ctx.state.hung[1]) {
      HG.done = true;
      ctx.tl.after(1.0, () => next(ctx));
    } else hangHint(ctx);
  });
}
function hangBack(ctx, i) {
  ctx.hanger.clips[i].setOpen(0);
  dropIntoDryer(ctx, i, 0.25, 0.18, 0.04).then(() => {
    ctx.audio.play('thud', { gain: 0.6, pitch: 1.1 }); rattleDryer(0.02);
    hangHint(ctx);
  });
}
const hang = {
  id: 'hang', shot: SH.hang,
  place(ctx) { placeCommon(ctx, 'hang'); },
  enter(ctx) {
    HG.carry = null; HG.i = -1; HG.taps = [0, 0]; HG.done = false;
    if (ctx.state.hung[0] && ctx.state.hung[1]) { HG.done = true; ctx.tl.after(1.0, () => next(ctx)); } else hangHint(ctx);
  },
  exit(ctx) {
    HG.carry = null;
    for (let i = 0; i < 2; i++) ctx.hanger.clips[i].setOpen(0);
  },
  onDown(p, ctx) {
    if (HG.carry || HG.done) {
      if (HG.done) this._poke(p, ctx);
      return;
    }
    const cand = [];
    for (let i = 0; i < 2; i++) if (!ctx.state.hung[i] && ctx.rigs[i].where === 'spinner') cand.push({ pos: midWorld(ctx, i, new THREE.Vector3()), radiusPx: 105, data: i });
    const hit = ctx.pickNearest(p, cand);
    if (hit) {
      const i = hit.data, g = ctx.shoes[i].group, clip = ctx.hanger.clips[i];
      g.position.set(0, 0, 0);
      const rig = ctx.rigs[i]; rig.where = 'carry';
      poseWorld(ctx, i, 'clip', null, _hq[i]);
      HG.carry = new Carry(ctx, { obj: g, getTarget: () => hangTarget(ctx, i), lift: 0.05, carryQuat: _hq[i], snapPx: 110 });
      HG.i = i; HG.grabT = 0;
      HG.carry.begin(p);
      clip.setOpen(1);
      ctx.audio.play('unsnap', { gain: 0.35, pitch: 1.2 });
      ctx.audio.play('hop', { gain: 0.5 });
      ctx.fx.splash(shoeWorld(ctx, i, _v, 0, 0.02, 0.05), { count: 4, speed: 0.5, size: 0.5, floorY: 0.09 });
      ctx.hint.clear();
      return;
    }
    if (!this._poke(p, ctx)) { rattleDryer(0.02); ctx.audio.play('rattle', { gain: 0.25 }); }
  },
  _poke(p, ctx) {
    const cand = [];
    for (let i = 0; i < 2; i++) if (ctx.state.hung[i] && ctx.rigs[i].where === 'clip') cand.push({ pos: midWorld(ctx, i, new THREE.Vector3()), radiusPx: 90, data: i });
    const hit = ctx.pickNearest(p, cand);
    if (!hit) return false;
    pokeShoe(ctx, hit.data, (rnd() < 0.5 ? -1 : 1) * 0.35, 0.2);
    ctx.audio.play('hop', { gain: 0.35, pitch: 1.3 });
    HG.lastPoke[hit.data] = ctx.time;
    return true;
  },
  onMove(p, ctx) {
    if (HG.carry) { HG.carry.move(p); return; }
    // swipe across a hung shoe -> it swings
    if (Math.abs(p.vx) > 250) {
      for (let i = 0; i < 2; i++) {
        if (!ctx.state.hung[i] || ctx.rigs[i].where !== 'clip' || ctx.time - HG.lastPoke[i] < 0.5) continue;
        if (ctx.screenDist(p, midWorld(ctx, i, _v)) < 55) { HG.lastPoke[i] = ctx.time; pokeShoe(ctx, i, clamp(p.vx / 1600, -0.6, 0.6), 0.1); ctx.audio.play('hop', { gain: 0.3, pitch: 1.4 }); }
      }
    }
  },
  onUp(p, ctx) {
    if (!HG.carry) return;
    const c = HG.carry, i = HG.i; HG.carry = null; HG.i = -1;
    const vel = c.vel.clone();
    const ok = c.end(p) && !p.cancelled;
    if (ok) { hangShoe(ctx, i, vel); return; }
    if (p.isTap && !p.cancelled && ++HG.taps[i] >= 2) { hangShoe(ctx, i, null); return; }   // taps make progress too
    hangBack(ctx, i);
  },
  update(dt, ctx) {
    updateDryer(dt, ctx);
    if (HG.carry) {
      HG.carry.update(dt);
      // stay inside the tub until the shoe is out over the rim (no clipping through the clear wall)
      const g = ctx.shoes[HG.i].group;
      const top = L.SPINNER[1] + 0.33 + 0.1;
      if (g.position.y < top) {
        const dx = g.position.x - L.SPINNER[0], dz = g.position.z - L.SPINNER[2], r = Math.hypot(dx, dz), lim = 0.1;
        if (r > lim) {
          if (r < 0.3) { g.position.x = L.SPINNER[0] + dx / r * lim; g.position.z = L.SPINNER[2] + dz / r * lim; }
          g.position.y = Math.max(g.position.y, lerp(g.position.y, top, clamp((r - lim) / 0.1, 0, 1)));
        }
      }
      HG.grabT += dt;
    }
  },
};

// =============================================================================================
// 9. sun — automatic time-lapse
// =============================================================================================
const SU = { t: 0, ev: 0 };
const sun = {
  id: 'sun', shot: SH.hang,
  place(ctx) { placeCommon(ctx, 'sun'); },
  enter(ctx) {
    SU.t = 0; SU.ev = 0;
    ctx.hint.clear();
    ctx.cam.goto(SH.sky, 4.0, 'inOut');
    ctx.hanger.sway(0.7);
  },
  exit(ctx) { stopLoops(ctx); },
  onDown(p, ctx) {
    const cand = [];
    for (let i = 0; i < 2; i++) cand.push({ pos: midWorld(ctx, i, new THREE.Vector3()), radiusPx: 100, data: i });
    const hit = ctx.pickNearest(p, cand);
    if (hit) { pokeShoe(ctx, hit.data, (rnd() < 0.5 ? -1 : 1) * 0.35, 0.15); ctx.audio.play('hop', { gain: 0.3, pitch: 1.3 }); }
    else { ctx.hanger.bounce(0.3); ctx.audio.play('knock', { gain: 0.25 }); }
  },
  update(dt, ctx) {
    const T = (SU.t += dt), w = ctx.world, hanger = ctx.hanger, fx = ctx.fx, audio = ctx.audio;
    // time of day
    let tod;
    if (T < 4.5) tod = 0.45 * smooth01(T / 4.5) * 0.6 + 0.45 * (T / 4.5) * 0.4;
    else if (T < 6.3) tod = lerp(0.45, 0.62, smooth01((T - 4.5) / 1.8));
    else tod = lerp(0.62, 1.0, smooth01((T - 6.3) / 2.7));
    w.setTimeOfDay(tod);
    // shoes dry, then shine
    const k1 = seg(T, 0.3, 4.5), k3 = seg(T, 7.0, 9.0);
    for (let i = 0; i < 2; i++) { ctx.shoes[i].setWet(0.35 * (1 - k1)); ctx.shoes[i].setShine(0.35 * smooth01(k1) + 0.65 * smooth01(k3)); }
    ctx.bag.setDusty(0.15 * (1 - k1));
    hanger.sway(T < 4.5 ? 0.7 : T < 6.3 ? 0.25 : 0.45);
    // night ambience
    const night = smooth01(seg(T, 4.4, 5.2)) * (1 - smooth01(seg(T, 5.9, 6.9)));
    audio.setLoop('night', night);
    // events
    const ev = (n, at) => SU.ev < n && T >= at;
    if (ev(1, 0.4)) { SU.ev = 1; dripFrom(ctx, toeWorld(ctx, 0, _v)); }
    if (ev(2, 1.2)) { SU.ev = 2; dripFrom(ctx, toeWorld(ctx, 1, _v)); }
    if (ev(3, 2.2)) { SU.ev = 3; dripFrom(ctx, toeWorld(ctx, 0, _v)); }
    if (ev(4, 3.0)) { SU.ev = 4; audio.play('chime', { gain: 0.5 }); }
    if (ev(5, 6.4)) { SU.ev = 5; ctx.cam.goto(SH.pack, 2.6, 'inOut'); }
    if (ev(6, 7.6)) { SU.ev = 6; audio.music('morning'); }
    if (ev(7, 9.0)) {
      SU.ev = 7;
      for (let i = 0; i < 2; i++) { midWorld(ctx, i, _v); fx.sparkle(_v, { count: 6, spread: 0.06, size: 1.3 }); setShoeLook(ctx, i, 0, 1); }
      audio.play('sparkleBig', { gain: 0.8 });
      ctx.saveSoon();
      ctx.tl.after(1.1, () => next(ctx));
    }
  },
};

// =============================================================================================
// 10. pack — tug the white shoes off, into the bag
// =============================================================================================
const PK = { grab: null, carry: null, i: -1, taps: [0, 0], done: false, lean: 0 };
const _pq = [new THREE.Quaternion(), new THREE.Quaternion()];
function packTarget(ctx, i) { poseWorld(ctx, i, 'packed', _mouth, null); _mouth.y += 0.09; return _mouth; }
function packNext(ctx) { for (let i = 0; i < 2; i++) if (!ctx.state.packed[i] && ctx.rigs[i].where === 'clip') return i; return -1; }
function packHint(ctx) {
  const i = packNext(ctx);
  if (i < 0 || PK.done) { ctx.hint.clear(); return; }
  const c = ctx.hanger.clips[i];
  ctx.hint.set({
    target: ctx.shoes[i].group,
    gesture: { type: 'drag', to: () => packTarget(ctx, i) },
    wobble: (k, t) => { if (k > 0) c.vz += Math.sin(t * 5.5) * k * 0.5 * ctx.dt; },
    cue: () => { ctx.audio.play('sparkle', { gain: 0.3 }); ctx.fx.sparkle(midWorld(ctx, i, _v), { count: 1 }); },
  });
}
function packCount(ctx) { return ctx.state.packed.filter(Boolean).length; }
function packShoe(ctx, i) {
  ctx.state.packed[i] = true; ctx.saveSoon();
  ctx.hint.clear();
  ctx.bag.setOpen(1); ctx.bag.setFill(Math.max(packCount(ctx) - 0.3, 0));
  flyShoe(ctx, i, 'packed', 0.32, 0.05, 'in').then(() => {
    const n = packCount(ctx);
    ctx.audio.play('thud', { gain: 0.65, pitch: 1.2 });
    ctx.bag.squish(0.8); ctx.bag.setFill(n);
    ctx.hanger.clips[2].poke(0.05, (i ? 0.25 : -0.25));
    ctx.hanger.bounce(0.4);
    ctx.fx.sparkle(heelWorld(ctx, i, _v), { count: 2 });
    ctx.audio.play('sparkle', { gain: 0.45 });
    if (n >= 2) {
      PK.done = true;
      ctx.tl.after(0.5, () => {
        ctx.audio.play('zip', { gain: 0.8 });
        ctx.tl.tween(0.6, (k) => ctx.bag.setOpen(1 - 0.6 * k), 'inOut').then(() => {
          ctx.bag.squish(0.3);
          ctx.tl.after(0.6, () => next(ctx));
        });
      });
    } else packHint(ctx);
  });
}
function unclip(ctx, i, p) {
  const c = ctx.hanger.clips[i], g = ctx.shoes[i].group;
  ctx.audio.play('unsnap', { gain: 0.85 });
  c.setOpen(1); c.setLoad(0);
  ctx.tl.after(0.3, () => c.setOpen(0));
  ctx.hanger.bounce(1);
  c.poke(-0.08, -c.swingZ * 0.8);        // recoil
  ctx.rigs[i].where = 'carry';
  poseWorld(ctx, i, 'clip', null, _pq[i]);
  PK.carry = new Carry(ctx, { obj: g, getTarget: () => packTarget(ctx, i), lift: 0.04, carryQuat: _pq[i], snapPx: 110 });
  PK.i = i;
  PK.carry.begin(p);
  ctx.fx.sparkle(heelWorld(ctx, i, _v), { count: 1 });
}
const pack = {
  id: 'pack', shot: SH.pack,
  place(ctx) { placeCommon(ctx, 'pack'); },
  enter(ctx) {
    PK.grab = null; PK.carry = null; PK.i = -1; PK.taps = [0, 0]; PK.done = false;
    if (packCount(ctx) >= 2) { PK.done = true; ctx.tl.after(0.6, () => next(ctx)); } else packHint(ctx);
  },
  exit(ctx) { PK.grab = null; PK.carry = null; },
  onDown(p, ctx) {
    if (PK.carry || PK.done) { if (PK.done) { ctx.bag.squish(0.3); ctx.hanger.clips[2].poke(0, 0.1); ctx.audio.play('puff', { gain: 0.3 }); } return; }
    const cand = [];
    for (let i = 0; i < 2; i++) if (!ctx.state.packed[i] && ctx.rigs[i].where === 'clip') cand.push({ pos: midWorld(ctx, i, new THREE.Vector3()), radiusPx: 100, data: i });
    const hit = ctx.pickNearest(p, cand);
    if (hit) {
      PK.grab = { i: hit.data, x: p.x, y: p.y, px: p.x };
      ctx.hanger.bounce(0.25);
      ctx.audio.play('squeak', { gain: 0.25, pitch: 1.4 });
      return;
    }
    // the bag: a friendly squish
    ctx.bag.mouth.getWorldPosition(_v); _v.y -= 0.1;
    if (ctx.screenDist(p, _v) < 130) { ctx.bag.squish(0.4); ctx.hanger.clips[2].poke(0.05, 0.12); ctx.audio.play('puff', { gain: 0.35 }); }
  },
  onMove(p, ctx) {
    if (PK.carry) { PK.carry.move(p); return; }
    const g = PK.grab; if (!g) return;
    g.px = p.x; g.py = p.y;
    if (Math.hypot(p.x - g.x, p.y - g.y) > 60) { PK.grab = null; unclip(ctx, g.i, p); }
  },
  onUp(p, ctx) {
    if (PK.carry) {
      const c = PK.carry, i = PK.i; PK.carry = null; PK.i = -1;
      const ok = c.end(p) && !p.cancelled;
      if (ok) packShoe(ctx, i);
      else {
        const clip = ctx.hanger.clips[i];
        clip.setOpen(1);
        flyShoe(ctx, i, 'clip', 0.3, 0.03).then(() => { ctx.audio.play('snap', { gain: 0.8 }); clip.setOpen(0); clip.setLoad(1); clip.poke(0.05, 0); ctx.hanger.bounce(0.4); packHint(ctx); });
      }
      return;
    }
    const g = PK.grab; PK.grab = null;
    if (g && !p.cancelled) {          // tap: it swings + sparkle; the 2nd tap tugs it off into the bag by itself
      const c = ctx.hanger.clips[g.i];
      c.poke(0.1, (rnd() < 0.5 ? -1 : 1) * 0.3);
      ctx.fx.sparkle(midWorld(ctx, g.i, _v), { count: 2 });
      ctx.audio.play('sparkle', { gain: 0.35 });
      if (++PK.taps[g.i] >= 2) {
        ctx.audio.play('unsnap', { gain: 0.85 });
        c.setOpen(1); c.setLoad(0); ctx.hanger.bounce(1);
        ctx.tl.after(0.3, () => c.setOpen(0));
        packShoe(ctx, g.i);
      }
    }
  },
  update(dt, ctx) {
    const g = PK.grab;
    if (g) {                          // the pinned shoe leans toward the finger
      const c = ctx.hanger.clips[g.i];
      const lean = clamp(((g.px ?? g.x) - g.x) / 60, -1, 1) * 0.25;
      c.swingZ += (lean - c.swingZ) * (1 - Math.exp(-dt * 12)); c.vz *= Math.exp(-dt * 10);
      const up = clamp(((g.py ?? g.y) - g.y) / 60, -1, 1) * 0.15;
      c.swingX += (-up - c.swingX) * (1 - Math.exp(-dt * 12)); c.vx *= Math.exp(-dt * 10);
    }
    if (PK.carry) PK.carry.update(dt);
  },
};

// =============================================================================================
// 11. end — gentle ending; tapping the bag restarts the game
// =============================================================================================
const EN = { t: 0, sparkT: 0, hinted: false, leaving: false };
function restart(ctx) {
  if (EN.leaving) return;
  EN.leaving = true;
  ctx.hint.clear();
  ctx.audio.play('whoosh', { gain: 0.9 });
  ctx.audio.music('stop');
  ctx.bag.squish(0.6); ctx.hanger.clips[2].poke(0.1, 0.2);
  ctx.cam.goto(SH.away, 1.5, 'inOut');
  ctx.tl.tween(1.5, (k) => ctx.world.setTimeOfDay(1 + 0.25 * k), 'inOut').then(() => {
    resetRound(ctx);
    // undo what the dry half set up (the bag stage's place() builds the rest of the opening picture)
    for (let i = 0; i < 3; i++) { ctx.hanger.clips[i].setOpen(0); ctx.hanger.clips[i].setLoad(0); }
    ctx.hanger.sway(0);
    ctx.spinner.setLidOpen(0); ctx.spinner.setSpin(0); ctx.spinner.setWater(0); ctx.spinner.setSpout(0);
    stopLoops(ctx);
    ctx.world.setTimeOfDay(0);
    ctx.saveSoon();
    if (ctx.flow.stages.some((s) => s.id === 'bag')) ctx.flow.goto('bag'); else ctx.flow.goto(0);
  });
}
const end = {
  id: 'end', shot: SH.end,
  place(ctx) { placeCommon(ctx, 'end'); },
  enter(ctx) {
    EN.t = 0; EN.sparkT = 1.2; EN.hinted = false; EN.leaving = false;
    ctx.audio.music('finale');
    ctx.cam.goto(SH.endIn, 9, 'inOut');
  },
  exit(ctx) { stopLoops(ctx); ctx.hanger.sway(0); },
  onDown(p, ctx) {
    if (EN.leaving) return;
    ctx.bag.mouth.getWorldPosition(_v); _v.y -= 0.1;
    const near = ctx.screenDist(p, _v) < 150;
    if (!near) {                     // the heels / anywhere: a little swing
      ctx.hanger.clips[2].poke(0.04, 0.08); ctx.audio.play('puff', { gain: 0.2 });
      return;
    }
    if (EN.t >= 3) { restart(ctx); return; }
    ctx.bag.squish(0.4); ctx.hanger.clips[2].poke(0.06, (rnd() < 0.5 ? -1 : 1) * 0.25); ctx.audio.play('puff', { gain: 0.35 });
  },
  update(dt, ctx) {
    EN.t += dt;
    if (EN.leaving) return;
    EN.sparkT -= dt;
    if (EN.sparkT <= 0) {
      EN.sparkT = 1.3 + rnd() * 1.2;
      ctx.fx.sparkle(heelWorld(ctx, rnd() < 0.5 ? 0 : 1, _v), { count: 1, size: 0.8 });
    }
    if (!EN.hinted && EN.t >= 8) {
      EN.hinted = true;
      const c = ctx.hanger.clips[2];
      ctx.hint.set({
        target: ctx.bag.group,
        gesture: { type: 'tap' },
        wobble: (k, t) => { if (k > 0) c.vz += Math.sin(t * 5) * k * 0.6 * ctx.dt; },
        cue: () => ctx.audio.play('puff', { gain: 0.25 }),
        delay1: 0.5, delay2: 4,
      });
    }
  },
};

export const dryStages = [load, spin, hang, sun, pack, end];
