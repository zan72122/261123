// STORY: stage machine wiring everything, hint ladder, discoveries, save/restore.
// sweep -> bury -> light -> fan -> dig -> eat -> finale -> (next round) sweep
export function create(G) {
  const THREE = G.THREE;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const num = (x, d = 0) => { const v = +x; return Number.isFinite(v) ? v : d; };
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const dxz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const inp = G.input;
  const STAGES = ['sweep', 'bury', 'light', 'fan', 'dig', 'eat', 'finale'];
  const dev = !!G.dev;
  const warned = {};
  const warn = (k, e) => { if (dev && !warned[k]) { warned[k] = 1; console.warn('[story] ' + k, e); } };
  const stub = (n) => !G[n] || !!G[n].isStub;

  // ---------------------------------------------------------------- anchors (copied, never held by reference)
  const PILE = V3(0, 0, 0), ZARU = V3(-0.62, 0, 1.22), BASKET = V3(0.62, 0, 1.22), LREST = V3(0.26, 0, 1.40);
  const LAWAY = V3();
  function readAnchors() {
    try {
      const a = G.world && G.world.anchors;
      if (a && !G.world.isStub) {
        if (a.pile && a.pile.isVector3) PILE.copy(a.pile);
        if (a.zaru && a.zaru.isVector3) ZARU.copy(a.zaru);
        if (a.basket && a.basket.isVector3) BASKET.copy(a.basket);
        if (a.lighterRest && a.lighterRest.isVector3) LREST.copy(a.lighterRest);
      }
    } catch (e) { /* keep defaults */ }
    LAWAY.set(LREST.x - PILE.x, 0, LREST.z - PILE.z);
    if (LAWAY.lengthSq() < 1e-6) LAWAY.set(0, 0, 1);
    LAWAY.normalize().multiplyScalar(0.07).add(LREST); LAWAY.y = 0;
  }
  readAnchors();
  // play ellipse (generous; only used to tell "tap on the tree" from "tap on the yard")
  const inYard = (p) => { const x = p.x / 1.45, z = (p.z + 0.25) / 1.85; return x * x + z * z < 1; };

  // ---------------------------------------------------------------- camera shots
  // `bottom` (rig extension): lens-shift fit — the near edge of the fit rectangle sits that fraction of the
  // screen height above the bottom edge, the rectangle fills the width, the rest at the top shows the garden.
  const SHOTS = {
    sweep: { target: [0, 0, -0.2], fit: { w: 2.72, d: 3.66 }, pitch: [57, 52], bottom: [0.035, 0.03] },
    bury: { target: [0, 0.05, 0.52], fit: { w: 1.85, d: 2.35 }, pitch: [48, 44], bottom: [0.06, 0.05] },
    light: { target: [0.1, 0.05, 0.55], fit: { w: 1.45, d: 2.1 }, pitch: [50, 46], bottom: [0.07, 0.05] },
    fan: { target: [0, 0.5, -0.2], fit: { w: 1.4, d: 3.6 }, pitch: [38, 34], bottom: [0.06, 0.05] },
    dig: { target: [-0.2, 0.05, 0.43], fit: { w: 1.6, d: 2.55 }, pitch: [52, 48], bottom: [0.06, 0.05] },
    eat: { target: [-0.62, 0.05, 1.24], fit: { w: 0.56, d: 0.56 }, pitch: [56, 52], bottom: [0.24, 0.14] },
    finale: { target: [0, 0.6, -0.3], fit: { w: 3.2, d: 3.4 }, pitch: [28, 34] },
    // looking up into the maple from under it (rig extension: explicit pos/look)
    sky: { pos: [0.6, 0.9, 0.9], look: [0.3, 3.2, -0.9], fov: 58 },
  };
  function shot(name, sec) {
    try {
      const s = SHOTS[name]; if (!s) return;
      if (name === 'eat') s.target[0] = ZARU.x, s.target[2] = ZARU.z;
      G.rig.shot(s, sec);
    } catch (e) { warn('shot', e); }
  }

  // ---------------------------------------------------------------- tiny timeline (driven by update only)
  let gen = 0;
  const timers = [];
  function after(t, fn) { timers.push({ t: Math.max(0, t), fn, g: gen }); }
  function runTimers(dt) {
    for (let k = 0; k < timers.length; k++) {
      const tm = timers[k];
      if (tm.g !== gen) { timers.splice(k, 1); k--; continue; }
      tm.t -= dt;
      if (tm.t <= 0) {
        timers.splice(k, 1); k--;
        try { tm.fn(); } catch (e) { warn('timer', e); }
      }
    }
  }

  // ---------------------------------------------------------------- hints: halos, ladder, finger
  const haloPos = V3();
  const halos = { s: null, m: null, l: null }, HN = ['s', 'm', 'l'];
  try {
    halos.s = G.hint.halo(haloPos, 0.15);
    halos.m = G.hint.halo(haloPos, 0.27);
    halos.l = G.hint.halo(haloPos, 0.45);
  } catch (e) { warn('halo', e); }
  let leadSize = null;      // 's' | 'm' | 'l' | null (written by the stage every frame)
  let idleT = 0, ladder = 0, calm = 0, fingerOn = false;
  let attK = 0.5, haloK = 0.6;
  function fingerHide() { if (fingerOn) { try { G.hint.finger.hide(); } catch (e) {} fingerOn = false; } }
  function ladderReset() { idleT = 0; ladder = 0; fingerHide(); }
  function progress() { ladderReset(); }
  function updateLadder(dt) {
    if (busy) { attK = 0; haloK = 0; fingerHide(); return; }
    if (calm > 0) { calm -= dt; idleT = 0; attK = 0.5; haloK = 0.6; return; }
    if (inp.down) idleT = 0; else idleT += dt;
    if (ladder < 1 && idleT >= 4) { ladder = 1; try { G.audio.cue(); } catch (e) {} }
    if (ladder < 2 && idleT >= 8) {
      ladder = 2;
      const st = S[stage];
      try {
        const p = st && st.path ? st.path() : null;
        if (p && p.pts && p.pts.length) { G.hint.finger.show(p.pts, p.opts || {}); fingerOn = true; }
      } catch (e) { warn('finger', e); }
    }
    attK = ladder >= 1 ? 1 : 0.5;
    haloK = ladder >= 1 ? 1 : 0.6;
  }
  function applyHalos() {
    const k = busy ? 0 : haloK;
    for (let i = 0; i < 3; i++) { const n = HN[i], h = halos[n]; if (h) h.set(leadSize === n ? k : 0); }
  }

  // ---------------------------------------------------------------- attention helpers
  function att(obj, k) { try { if (obj && typeof obj.setAttention === 'function') obj.setAttention(k); } catch (e) {} }
  const wob = { zaru: 0, basket: 0 };
  let leadBasket = 0, leadZaru = 0;
  function clearAttention() {
    att(G.leaves.rake, 0); att(G.fire.lighter, 0); att(G.fire.uchiwa, 0); att(G.potato.tongs, 0);
    try { G.potato.setAttention(-1, 0); } catch (e) {}
    leadBasket = 0; leadZaru = 0;
  }
  function applyWorldAttention(dt) {
    wob.zaru = Math.max(0, wob.zaru - dt); wob.basket = Math.max(0, wob.basket - dt);
    att(G.world.zaru, Math.max(busy ? 0 : leadZaru, wob.zaru > 0 ? 1 : 0));
    att(G.world.basket, Math.max(busy ? 0 : leadBasket, wob.basket > 0 ? 1 : 0));
  }

  // ---------------------------------------------------------------- sound beds / steam
  let fireAud = 0, emberAud = 0;
  const steams = [];
  function steamAt(target, rate) {
    try { const h = G.fire.steamAt(target, rate); if (h && typeof h.stop === 'function') { steams.push(h); return h; } } catch (e) {}
    return null;
  }
  function stopSteam(h) { if (!h) return null; try { h.stop(); } catch (e) {} const i = steams.indexOf(h); if (i >= 0) steams.splice(i, 1); return null; }
  function stopAllSteam() {
    for (const h of steams) { try { h.stop(); } catch (e) {} }
    steams.length = 0;
    for (let i = 0; i < 3; i++) wholeSteam[i] = null;
    for (let i = 0; i < 6; i++) halfSteam[i] = null;
  }
  const wholeV = [V3(), V3(), V3()], halfV = [V3(), V3(), V3(), V3(), V3(), V3()];
  const wholeSteam = [null, null, null], halfSteam = [null, null, null, null, null, null];
  function trackSteamTargets() {
    const P = G.potato;
    if (typeof P.halfPos !== 'function') return;
    for (let i = 0; i < 3; i++) {
      if (wholeSteam[i]) { P.halfPos(i, 2, wholeV[i]); wholeV[i].y += 0.035; }
      for (let h = 0; h < 2; h++) if (halfSteam[i * 2 + h]) { P.halfPos(i, h, halfV[i * 2 + h]); halfV[i * 2 + h].y += 0.01; }
    }
  }

  // ---------------------------------------------------------------- state
  let stage = 'sweep', round = 1, burn = 0, busy = false, needFresh = false, sT = 0;
  const tmp = V3(), tmp2 = V3(), top = V3();
  let lastTree = -9, lastAsh = -9;

  function canAct() { return !busy && !needFresh; }
  function beatOn() { busy = true; }
  function beatOff() { busy = false; needFresh = inp.down && !inp.justDown; }

  // ---------------------------------------------------------------- discoveries
  function treeTap() {
    try {
      if (!G.world.treeHit || !G.world.treeHit(inp.ray) || inYard(inp.ground)) return false;
      if (G.time.t - lastTree > 0.8) {
        lastTree = G.time.t;
        G.world.shakeTree(1); G.audio.treeShake(); G.leaves.dropLeaves(6, 1.2);
      }
      return true;
    } catch (e) { return false; }
  }
  function pileTap() {
    try {
      if (!G.leaves.pileHit || !G.leaves.pileHit(inp.ray) || dxz(inp.ground, PILE) > 0.75) return false;
      G.leaves.rustlePile(1); G.audio.rustle(0.8); G.audio.pat();
      return true;
    } catch (e) { return false; }
  }
  function emberTap() {
    try {
      if (dxz(inp.ground, PILE) > 0.6) return false;
      top.set(inp.ground.x, Math.max(0.03, pileTop() * 0.8), inp.ground.z);
      G.fire.sparks(top, 8, 1); G.audio.ember(0.8);
      return true;
    } catch (e) { return false; }
  }
  function propTap() {
    try {
      if (G.pxDist(ZARU) < 75 || dxz(inp.ground, ZARU) < 0.3) { wob.zaru = 0.7; G.audio.tok(); return true; }
      if (G.pxDist(BASKET) < 75 || dxz(inp.ground, BASKET) < 0.28) { wob.basket = 0.7; G.audio.tok(); return true; }
    } catch (e) {}
    return false;
  }
  // generic fallback for a justDown nothing else used
  function discover(opts) {
    if (treeTap()) return;
    if (opts.pile && pileTap()) return;
    if (opts.ember && emberTap()) return;
    if (propTap()) return;
    try { G.audio.pat(); } catch (e) {}
  }
  function pileTop() { try { return num(G.leaves.pile && G.leaves.pile.topY, 0.3); } catch (e) { return 0.3; } }

  // ---------------------------------------------------------------- module setup helpers
  function fireOff() {
    try { G.fire.setLevel(0); G.fire.setSmoke(0); G.fire.setWind(0); G.fire.setBaseY(0); } catch (e) {}
    fireAud = 0; emberAud = 0;
  }
  function restLighter() {
    try {
      const L = G.fire.lighter, o = L && L.object3D;
      if (!o || typeof L.hold !== 'function') return;
      L.setFlame(false);
      o.position.set(LREST.x, 0.05, LREST.z);
      L.hold(LAWAY); L.release();
    } catch (e) {}
  }
  function potatoAll(s, roasted) {
    try {
      const cur = G.potato.getState();
      if (!cur || !Array.isArray(cur.p)) return;
      G.potato.setState({ v: 1, round, seed: cur.seed, p: cur.p.map((e) => ({ s, var: e.var, r: roasted ? 1 : 0, b: [2, 2] })) });
    } catch (e) { warn('potatoAll', e); }
  }
  function freshRound() {
    try { G.leaves.reset({ pileStart: 0.10 }); } catch (e) {}
    try { G.leaves.setBurn(0); G.leaves.setEmber(0); } catch (e) {}
    try { G.potato.reset(round); } catch (e) {}
    fireOff(); burn = 0;
  }
  function fullPile(b, ember) {
    try { G.leaves.reset({ pileStart: 1 }); G.leaves.setBurn(b); G.leaves.setEmber(ember); } catch (e) {}
  }
  // put every module into the state the stage starts from (no animations)
  function setupFor(name) {
    stopAllSteam();
    try { G.fire.uchiwa.fan(false, null, 0, 0); } catch (e) {}
    try { G.leaves.sweep(false, null, 0, 0); } catch (e) {}
    restLighter();
    fireOff();
    if (name === 'sweep') { freshRound(); return; }
    try { G.potato.reset(round); } catch (e) {}
    burn = 0;
    if (name === 'bury') { fullPile(0, 0); return; }
    if (name === 'light') { fullPile(0, 0); potatoAll('buried', false); return; }
    if (name === 'fan') {
      fullPile(0, 0); potatoAll('buried', false);
      try { G.fire.ignite(tmp.set(0, 0.08, 0.42)); G.fire.setLevel(0.22); G.fire.setSmoke(0.25); G.fire.setBaseY(pileTop() * 0.75); } catch (e) {}
      fireAud = 0.22;
      return;
    }
    burn = 1;
    fullPile(1, 0.9);
    try { G.fire.setLevel(0.06); G.fire.setSmoke(0.15); G.fire.setBaseY(pileTop() * 0.75); } catch (e) {}
    if (name === 'dig') { potatoAll('buried', true); return; }
    if (name === 'eat') { potatoAll('zaru', true); return; }
    if (name === 'finale') { potatoAll('eaten', true); }
  }

  // ---------------------------------------------------------------- save / restore
  function save() {
    try {
      const d = G.save && G.save.data; if (!d || typeof d !== 'object') return;
      let lv = null, pv = null;
      try { lv = G.leaves.getState() || null; } catch (e) {}
      try { pv = G.potato.getState() || null; } catch (e) {}
      d.story = { v: 1, round, stage, burn, leaves: lv, potato: pv };
      G.save.commit();
    } catch (e) { warn('save', e); }
  }
  const ALLOWED = {
    bury: ['basket', 'held', 'buried'], light: ['buried'], fan: ['buried'],
    dig: ['buried', 'ash', 'tongs', 'zaru'], eat: ['zaru', 'open', 'eaten'],
  };
  function restore() {
    try {
      const s = G.save && G.save.data && G.save.data.story;
      if (!s || typeof s !== 'object' || s.v !== 1) return false;
      const r = Math.floor(num(s.round, 0));
      if (r < 1 || r > 9999 || !STAGES.includes(s.stage)) return false;
      round = r;
      if (s.stage === 'finale') { round = r + 1; setupFor('sweep'); enterStage('sweep', { cut: true }); return true; }
      if (s.stage === 'sweep') {
        setupFor('sweep');
        if (s.leaves && typeof s.leaves === 'object') { try { G.leaves.setState(s.leaves); G.leaves.setBurn(0); G.leaves.setEmber(0); } catch (e) {} }
        enterStage('sweep', { cut: true });
        return true;
      }
      setupFor(s.stage);
      const allowed = ALLOWED[s.stage];
      const pv = s.potato;
      if (pv && typeof pv === 'object' && Array.isArray(pv.p) && pv.p.length === 3 &&
          pv.p.every((e) => e && allowed.includes(e.s)) && Math.floor(num(pv.round, 0)) === round) {
        try { G.potato.setState(pv); } catch (e) {}
        // verify; on anything odd fall back to the stage's own baseline
        let okp = true;
        for (let i = 0; i < 3; i++) if (!allowed.includes(G.potato.state(i))) okp = false;
        if (!okp) setupFor(s.stage);
      }
      if (s.stage === 'fan') {
        burn = clamp(num(s.burn, 0), 0, 0.98);
        try { G.leaves.setBurn(burn); G.leaves.setEmber(smooth(0.25, 0.8, burn)); } catch (e) {}
      }
      enterStage(s.stage, { cut: true });
      return true;
    } catch (e) { warn('restore', e); return false; }
  }

  // ---------------------------------------------------------------- stages
  const S = {};

  // ---- sweep: rake the leaves into the ring
  const sw = { stroked: false, lastAbs: 0, q: 0, tree: false, from: V3(), done: false, work: 0 };
  S.sweep = {
    enter(o) {
      if (o.fresh) freshRound();
      shot('sweep', o.cut ? 0 : (o.glide || 1.6));
      try { G.world.setTimeOfDay(0); G.world.spot(PILE, 1, 1.0); } catch (e) {}
      sw.stroked = false; sw.done = false; sw.tree = false; sw.q = 0; sw.work = 0;
      try { sw.lastAbs = num(G.leaves.absorbedTotal, 0); } catch (e) { sw.lastAbs = 0; }
      sw.from.set(0.6, 0, 0.9);
      if (stub('leaves')) after(2, () => finishSweep());
    },
    update(dt) {
      const L = G.leaves;
      let active = false;
      if (canAct()) {
        if (inp.justDown) { sw.tree = treeTap(); if (!sw.tree) pileTap(); }
        if (!inp.down) sw.tree = false;
        active = inp.down && !sw.tree;
      }
      try { L.sweep(active, inp.ground, inp.vx, inp.vz); } catch (e) {}
      if (active && inp.dragPx > 25) sw.stroked = true;
      if (active && inp.speed > 0.3) sw.work += dt;
      const abs = num(L.absorbedTotal, 0);
      if (abs !== sw.lastAbs) { sw.lastAbs = abs; sw.stroked = true; progress(); }
      // lead
      if (!sw.stroked) {
        try { L.rake.object3D.getWorldPosition(haloPos); haloPos.y = 0; } catch (e) { haloPos.set(0.92, 0, 0.62); }
        leadSize = active ? null : 'm';
        att(L.rake, active ? 0 : attK);
      } else {
        att(L.rake, 0);
        sw.q -= dt;
        if (sw.q <= 0) {
          sw.q = 1.5;
          try { const p = L.hintPath(); if (p && p[0]) sw.from.copy(p[0]); } catch (e) {}
        }
        haloPos.set(sw.from.x, 0, sw.from.z);
        leadSize = inp.down ? null : 'l';
      }
      // assist: a child who has been raking for a long while gets the breeze earlier
      const frac = num(L.pileFraction, 0);
      if (!sw.done && !busy && (frac >= 0.8 || (frac >= 0.55 && sw.work >= 40))) finishSweep();
    },
    path() {
      try { const p = G.leaves.hintPath(); if (p && p.length >= 2) return { pts: p, opts: { speed: 0.8 } }; } catch (e) {}
      return { pts: [V3(0.5, 0, 1.0), V3(0.1, 0, 0.3)] };
    },
    release() { try { G.leaves.sweep(false, null, 0, 0); } catch (e) {} sw.tree = false; },
  };
  function finishSweep() {
    if (sw.done) return;
    sw.done = true;
    beatOn();
    S.sweep.release();
    try { G.leaves.gatherAll(2); G.audio.gust(2.3); } catch (e) {}
    after(2.6, () => {
      // GAG: one last leaf drifts down onto the finished pile
      shot('bury', 2.6);
      let fired = false;
      const g = gen;
      const go = () => {
        if (fired || g !== gen) return; fired = true;
        try { G.audio.chime(0); G.leaves.rustlePile(0.4); } catch (e) {}
        after(0.7, () => enterStage('bury', { glide: 0.8 }));
      };
      try { G.leaves.dropLeafOnPile(go); } catch (e) {}
      after(4.0, go);
    });
  }

  // ---- bury: drag each potato from the basket into the pile (x3)
  const bu = { carry: -1 };
  S.bury = {
    enter(o) {
      shot('bury', o.cut ? 0 : (o.glide || 1.6));
      try { G.world.setTimeOfDay(0.05); G.world.spot(PILE, 1, 0.8); } catch (e) {}
      bu.carry = -1;
      if (stub('potato')) after(1.5, () => enterStage('light'));
      else checkBuried();
    },
    update() {
      const P = G.potato;
      if (bu.carry >= 0) {
        if (inp.down && !busy) {
          P.hold(bu.carry, inp.ground);
          if (dxz(inp.ground, PILE) < 0.5) doBury(bu.carry);
        } else {
          let into = false;
          try { into = dxz(inp.ground, PILE) < 0.8 || (inp.justUp && G.leaves.pileHit(inp.ray)); } catch (e) {}
          if (into && !busy) doBury(bu.carry); else { try { P.dropRaw(bu.carry); } catch (e) {} }
          bu.carry = -1;
        }
      } else if (canAct() && inp.justDown) {
        let i = -1;
        try { i = P.pickRaw(inp.ray); } catch (e) {}
        if (typeof i === 'number' && i >= 0) {
          bu.carry = i; P.hold(i, inp.ground);
          try { G.audio.rummage(); } catch (e) {}
        } else discover({ pile: true });
      }
      // lead
      if (bu.carry >= 0) {
        haloPos.set(PILE.x, Math.min(0.06, pileTop()), PILE.z); leadSize = 'l';
        try { P.setAttention(-1, 0); } catch (e) {}
        leadBasket = 0;
      } else {
        haloPos.set(BASKET.x, 0.04, BASKET.z); leadSize = 'm';
        try { P.setAttention(-1, attK); } catch (e) {}
        leadBasket = attK * 0.6;
      }
    },
    path() { return { pts: [V3(BASKET.x, 0.1, BASKET.z), V3(BASKET.x * 0.5, 0.25, BASKET.z * 0.5), V3(PILE.x, pileTop(), PILE.z)] }; },
    release() { if (bu.carry >= 0) { try { G.potato.dropRaw(bu.carry); } catch (e) {} bu.carry = -1; } },
  };
  function doBury(i) {
    try { G.potato.bury(i); } catch (e) {}
    bu.carry = -1;
    let n = 0; try { n = num(G.potato.buriedCount, 0); } catch (e) {}
    try { G.audio.chime(n); } catch (e) {}
    progress(); save();
    checkBuried();
  }
  function checkBuried() {
    let n = 0; try { n = num(G.potato.buriedCount, 0); } catch (e) {}
    if (n >= 3 && !busy) { beatOn(); after(0.9, () => enterStage('light', { glide: 0.9 })); }
  }

  // ---- light: drag the lighter to the pile
  const li = { carry: false, ret: -1, from: V3(), front: V3(0, 0.08, 0.42) };
  S.light = {
    enter(o) {
      shot('light', o.cut ? 0 : (o.glide || 1.2));
      try { G.world.setTimeOfDay(0.1); G.world.spot(PILE, 1, 0.8); } catch (e) {}
      li.carry = false; li.ret = -1;
      li.front.set(PILE.x, 0.08, PILE.z + 0.42);
      if (stub('fire')) after(1.5, () => enterStage('fan'));
    },
    update(dt) {
      const L = G.fire.lighter;
      if (li.ret >= 0) { // carried back to its rest place
        li.ret += dt;
        const k = ease(li.ret / 0.6);
        tmp.lerpVectors(li.from, LAWAY, k);
        try { L.hold(tmp); } catch (e) {}
        if (li.ret >= 0.6) { li.ret = -1; try { L.release(); } catch (e) {} after(0.15, () => enterStage('fan')); }
        leadSize = null;
        return;
      }
      if (li.carry) {
        if (inp.down && !busy) {
          try { L.hold(inp.ground); } catch (e) {}
          if (dxz(inp.ground, PILE) < 0.85) igniteBeat();
        } else { li.carry = false; try { L.release(); } catch (e) {} }
      } else if (canAct() && inp.justDown) {
        let hit = false;
        try { hit = !!(L.hit && L.hit(inp.ray)) || (L.object3D && G.pxDist(L.object3D.position) < 90); } catch (e) {}
        if (hit) { li.carry = true; try { L.hold(inp.ground); G.audio.tok(); } catch (e) {} }
        else discover({ pile: true });
      }
      if (li.carry) { haloPos.copy(li.front); haloPos.y = 0; leadSize = 'm'; att(L, 0); }
      else {
        try { L.object3D.getWorldPosition(haloPos); haloPos.y = 0; } catch (e) { haloPos.copy(LREST); }
        leadSize = 'm'; att(L, attK);
      }
    },
    path() {
      const L = G.fire.lighter; const p = V3().copy(LREST);
      try { L.object3D.getWorldPosition(p); p.y = 0.02; } catch (e) {}
      return { pts: [p, V3(li.front.x, 0.02, li.front.z + 0.12)] };
    },
    release() { if (li.carry) { li.carry = false; try { G.fire.lighter.release(); } catch (e) {} } li.ret = -1; },
  };
  function igniteBeat() {
    beatOn();
    const L = G.fire.lighter;
    li.carry = false;
    try { L.setFlame(true); G.audio.lighterClick(); } catch (e) {}
    after(0.35, () => {
      try {
        G.fire.ignite(li.front); G.audio.ignite();
        G.fire.setLevel(0.22); G.fire.setSmoke(0.25); G.fire.setBaseY(pileTop() * 0.75);
        G.rig.nudge(0.15);
      } catch (e) {}
      fireAud = 0.22;
    });
    after(1.05, () => {
      try { L.setFlame(false); L.object3D.getWorldPosition(li.from); } catch (e) { li.from.copy(LAWAY); }
      li.from.y = 0;
      li.ret = 0;
    });
  }

  // ---- fan: swipe left-right with the uchiwa
  const fa = { pop: 0, high: 0, cd: 0, acc: 0, done: false, tree: false };
  const bell = (b) => Math.exp(-((b - 0.45) / 0.36) * ((b - 0.45) / 0.36));
  S.fan = {
    enter(o) {
      shot('fan', o.cut ? 0 : (o.glide || 1.6));
      try { G.world.spot(null); G.world.setTimeOfDay(0.15 + 0.45 * burn); } catch (e) {}
      fa.pop = burn >= 0.65 ? 2 : burn >= 0.35 ? 1 : 0; fa.high = 0; fa.cd = 3; fa.acc = 0; fa.done = false; fa.tree = false;
      fireAud = Math.max(fireAud, 0.22);
      // short beat while the camera settles in front of the fire
      if (!o.cut) { beatOn(); after(0.9, beatOff); }
    },
    update(dt) {
      const F = G.fire, U = F.uchiwa, L = G.leaves;
      let act = false;
      if (canAct()) {
        if (inp.justDown) { fa.tree = treeTap(); if (!fa.tree) emberTap(); }
        if (!inp.down) fa.tree = false;
        act = inp.down && !fa.tree;
      }
      let wind = 0;
      try { wind = num(U.fan(act && !fa.done, inp.ground, inp.vx, inp.vz), 0); } catch (e) {}
      if (fa.done) return;
      if (!busy) burn = Math.min(1, burn + dt * (0.016 + 0.11 * wind));
      if (wind > 0.3) idleT = 0;
      const b = bell(burn);
      const base = 0.22 * (1 - 0.6 * smooth(0.75, 1, burn));
      const level = clamp(base + 0.6 * b + 0.2 * wind, 0, 1);
      try {
        F.setWind(wind);
        L.setBurn(burn); L.setEmber(smooth(0.25, 0.8, burn));
        F.setLevel(level); F.setSmoke(0.25 + 0.5 * b + 0.2 * wind);
        F.setBaseY(pileTop() * 0.75);
        G.world.setTimeOfDay(0.15 + 0.45 * burn);
      } catch (e) {}
      fireAud = level;
      top.set(PILE.x, Math.max(0.05, pileTop() * 0.8), PILE.z);
      if (wind > 0.4) {
        fa.acc += dt * 3;
        if (fa.acc >= 1) { fa.acc = 0; try { F.sparks(top, 3 + ((Math.random() * 4) | 0), 1); } catch (e) {} }
      }
      // acorn pops
      if ((fa.pop === 0 && burn >= 0.35) || (fa.pop === 1 && burn >= 0.65)) {
        fa.pop++;
        try {
          if (num(L.acornsInPile, 0) > 0) {
            const p = L.popAcorn();
            if (p) { F.sparks(p, 16, 1.4); G.rig.nudge(0.3); }
          }
        } catch (e) {}
      }
      // gag "kemui!"
      fa.cd = Math.max(0, fa.cd - dt);
      if (wind >= 0.92) fa.high += dt; else fa.high = 0;
      if (fa.high >= 1.6 && fa.cd <= 0) { fa.high = 0; fa.cd = 9; try { F.smokeFace(); } catch (e) {} }
      // lead
      if (inp.down) leadSize = null;
      else { try { U.object3D.getWorldPosition(haloPos); haloPos.y = 0; } catch (e) { haloPos.set(-0.14, 0, 1.45); } leadSize = 'm'; }
      att(U, inp.down ? 0 : attK);
      if (burn >= 1 && !busy) finishFan();
    },
    path() { return { pts: [V3(-0.35, 0.02, 1.05), V3(0.35, 0.02, 1.05), V3(-0.35, 0.02, 1.05), V3(0.35, 0.02, 1.05)], opts: { speed: 1.6 } }; },
    release() { try { G.fire.uchiwa.fan(false, null, 0, 0); } catch (e) {} },
  };
  function finishFan() {
    fa.done = true;
    beatOn();
    try {
      G.potato.roastAll();
      G.fire.setWind(0); G.fire.uchiwa.fan(false, null, 0, 0);
      G.fire.setLevel(0.06); G.fire.setSmoke(0.15);
      G.leaves.setBurn(1); G.leaves.setEmber(0.9);
      G.audio.chime(1);
    } catch (e) {}
    fireAud = 0.06; emberAud = 0.6;
    after(1.4, () => enterStage('dig'));
  }

  // ---- dig: drag each roasted potato from the ash to the zaru (x3)
  const dg = { carry: -1, rv: 1, puffs: 0 };
  S.dig = {
    enter(o) {
      shot('dig', o.cut ? 0 : (o.glide || 1.6));
      try {
        G.world.setTimeOfDay(0.65); G.world.spot(PILE, 0.7, 0.7);
        G.fire.setLevel(0.04); G.fire.setSmoke(0.1); G.leaves.setEmber(0.75);
      } catch (e) {}
      fireAud = 0.04; emberAud = 0.6;
      dg.carry = -1; dg.puffs = 0;
      // potatoes already on the zaru (restore) keep steaming
      for (let i = 0; i < 3; i++) if (G.potato.state(i) === 'zaru' && !wholeSteam[i]) wholeSteam[i] = steamAt(wholeV[i], 0.5);
      let buried = 0;
      for (let i = 0; i < 3; i++) if (G.potato.state(i) === 'buried') buried++;
      if (buried > 0) { beatOn(); dg.rv = 0; } else dg.rv = 1;
      if (stub('potato')) after(2, () => enterStage('eat'));
      checkZaru();
    },
    update(dt) {
      const P = G.potato;
      if (dg.rv < 1) { // reveal the roasted potatoes in the ash
        dg.rv = Math.min(1, dg.rv + dt / 1.0);
        try { P.revealInAsh(dg.rv); } catch (e) {}
        if (dg.puffs === 0 && dg.rv > 0.15 || dg.puffs === 1 && dg.rv > 0.6) {
          dg.puffs++;
          try { G.fire.ashPuff(tmp.set(PILE.x + (dg.puffs === 1 ? -0.12 : 0.14), 0.06, PILE.z + 0.05), 0.8); G.audio.ashPuff(); } catch (e) {}
        }
        if (dg.rv >= 1) beatOff();
      }
      if (dg.carry >= 0) {
        if (inp.down && !busy) {
          try { P.grab(dg.carry, inp.ground); } catch (e) {}
          if (dxz(inp.ground, ZARU) < 0.32) arrive(dg.carry);
        } else {
          let ok = false;
          try { ok = dxz(inp.ground, ZARU) < 0.6 || G.pxDist(ZARU) < 120; } catch (e) {}
          if (ok && !busy) arrive(dg.carry); else { try { P.toAsh(dg.carry); } catch (e) {} }
          dg.carry = -1;
        }
      } else if (canAct() && inp.justDown) {
        let i = -1;
        try { i = P.pickAsh(inp.ray); } catch (e) {}
        if (!(i >= 0) && dxz(inp.ground, PILE) < 0.8) i = nearestAsh(inp.ground);
        if (i >= 0) {
          dg.carry = i;
          try { P.grab(i, inp.ground); G.audio.tongs(); G.world.spot(ZARU, 1, 0.5); } catch (e) {}
        } else if (dxz(inp.ground, PILE) < 0.75) ashPlay(1);
        else discover({});
      } else if (canAct() && inp.down && dg.carry < 0 && inp.speed > 0.6 && dxz(inp.ground, PILE) < 0.75) {
        ashPlay(0.6);
      }
      // lead
      if (dg.carry >= 0) {
        haloPos.set(ZARU.x, 0.02, ZARU.z); leadSize = 'm'; leadZaru = attK;
        try { P.setAttention(-1, 0); } catch (e) {}
        att(P.tongs, 0);
      } else {
        leadZaru = 0;
        const i = nextAsh();
        try { P.setAttention(-1, 0); if (i >= 0) P.setAttention(i, attK); } catch (e) {}
        att(P.tongs, i >= 0 ? attK * 0.6 : 0);
        if (i >= 0) { try { P.halfPos(i, 2, haloPos); } catch (e) {} leadSize = inp.down ? null : 's'; }
        else leadSize = null;
      }
    },
    path() {
      const i = nextAsh(); const p = V3(0, 0.1, 0);
      if (i >= 0) { try { G.potato.halfPos(i, 2, p); } catch (e) {} }
      return { pts: [p, V3((p.x + ZARU.x) / 2, 0.25, (p.z + ZARU.z) / 2), V3(ZARU.x, 0.06, ZARU.z)] };
    },
    release() { if (dg.carry >= 0) { try { G.potato.toAsh(dg.carry); } catch (e) {} dg.carry = -1; } },
  };
  function nextAsh() { for (let i = 0; i < 3; i++) { try { if (G.potato.state(i) === 'ash') return i; } catch (e) {} } return -1; }
  function nearestAsh(p) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < 3; i++) {
      try {
        if (G.potato.state(i) !== 'ash') continue;
        G.potato.halfPos(i, 2, tmp2);
        const d = dxz(tmp2, p); if (d < bd) { bd = d; best = i; }
      } catch (e) {}
    }
    return best;
  }
  function ashPlay(power) {
    if (G.time.t - lastAsh < 0.3) return;
    lastAsh = G.time.t;
    try {
      tmp.set(inp.ground.x, Math.max(0.03, pileTop() * 0.6), inp.ground.z);
      G.fire.ashPuff(tmp, 0.7 * power); G.audio.ashPuff(); G.fire.sparks(tmp, 4, 0.8);
    } catch (e) {}
  }
  function arrive(i) {
    try { G.potato.toZaru(i); } catch (e) {}
    dg.carry = -1;
    let n = 0; try { n = num(G.potato.onZaruCount, 0); } catch (e) {}
    try { G.audio.chime(n); G.world.spot(PILE, 0.7, 0.7); } catch (e) {}
    if (!wholeSteam[i]) wholeSteam[i] = steamAt(wholeV[i], 0.5);
    progress(); save();
    checkZaru();
  }
  function checkZaru() {
    let n = 0; try { n = num(G.potato.onZaruCount, 0); } catch (e) {}
    if (n >= 3 && !busy) { beatOn(); after(1.0, () => enterStage('eat')); }
  }

  // ---- eat: break each potato open, tap the halves to eat (x3)
  const BITES = Math.max(1, Math.floor(num(G.potato.BITES_PER_HALF, 2)));
  const ea = { brk: -1, amt: 0, bites: [0, 0, 0, 0, 0, 0], li: -1, lh: -1 };
  S.eat = {
    enter(o) {
      shot('eat', o.cut ? 0 : (o.glide || 1.8));
      try {
        G.world.setTimeOfDay(0.8); G.world.spot(ZARU, 0.6, 0.6);
        G.fire.setLevel(0); G.fire.setSmoke(0.06); G.leaves.setEmber(0.5);
      } catch (e) {}
      fireAud = 0; emberAud = 0.4;
      ea.brk = -1; ea.amt = 0;
      try {
        const st = G.potato.getState();
        for (let i = 0; i < 3; i++) {
          const e = st && st.p && st.p[i];
          const b = e && Array.isArray(e.b) ? e.b : [BITES, BITES];
          const s = G.potato.state(i);
          for (let h = 0; h < 2; h++) ea.bites[i * 2 + h] = s === 'open' ? clamp(Math.floor(num(b[h], BITES)), 0, BITES) : s === 'eaten' ? 0 : BITES;
          if (s === 'zaru' && !wholeSteam[i]) wholeSteam[i] = steamAt(wholeV[i], 0.5);
          if (s === 'open') for (let h = 0; h < 2; h++) if (ea.bites[i * 2 + h] > 0 && !halfSteam[i * 2 + h]) halfSteam[i * 2 + h] = steamAt(halfV[i * 2 + h], 0.4);
        }
      } catch (e) {}
      if (!o.cut) { beatOn(); after(1.0, beatOff); }
      if (stub('potato')) after(2, () => enterStage('finale'));
      checkEaten();
    },
    update() {
      const P = G.potato;
      if (ea.brk >= 0) {
        if (inp.down && !busy) {
          ea.amt = clamp(inp.dragPx / 70, 0, 1);
          try { P.breakDrag(ea.brk, Math.max(0.06, ea.amt)); } catch (e) {}
          if (ea.amt >= 1) openIt(ea.brk);
        } else {
          if (ea.amt > 0.45 && !busy) openIt(ea.brk);
          else {
            try { P.breakCancel(ea.brk); } catch (e) {}
            if (ea.amt < 0.15) { idleT = Math.max(idleT, 6); ladder = Math.min(ladder, 1); }
          }
          ea.brk = -1;
        }
      } else if (canAct() && inp.justDown) {
        let h = null;
        try { h = P.pickHalf(inp.ray); } catch (e) {}
        if (h && h.i >= 0) biteIt(h.i, h.h);
        else {
          let w = -1;
          try { w = P.pickWhole(inp.ray); } catch (e) {}
          if (w >= 0 && ea.li >= 0) {
            // one at a time: finish the opened potato first (its halves are the lead and ask again)
            try { G.audio.pat(); } catch (e) {}
            idleT = Math.max(idleT, 3.9);
          } else if (w >= 0) {
            ea.brk = w; ea.amt = 0;
            try { P.breakDrag(w, 0.06); G.audio.thud(0.35); } catch (e) {}
          } else discover({});
        }
      }
      // lead: an opened potato with halves left, else the next whole one
      let li = -1, lh = -1, wi = -1;
      for (let i = 0; i < 3 && li < 0; i++) {
        if (P.state(i) !== 'open') continue;
        for (let h = 0; h < 2; h++) if (ea.bites[i * 2 + h] > 0) { li = i; lh = h; break; }
      }
      if (li < 0) for (let i = 0; i < 3; i++) if (P.state(i) === 'zaru') { wi = i; break; }
      ea.li = li; ea.lh = lh;
      try {
        P.setAttention(-1, 0);
        if (li >= 0) { P.setAttention(li, ea.brk >= 0 ? 0 : attK); P.halfPos(li, lh, haloPos); leadSize = inp.down ? null : 's'; }
        else if (wi >= 0) { P.setAttention(wi, ea.brk >= 0 ? 0 : attK); P.halfPos(wi, 2, haloPos); leadSize = inp.down ? null : 's'; }
        else leadSize = null;
      } catch (e) { leadSize = null; }
    },
    path() {
      const p = V3(ZARU.x, 0.05, ZARU.z);
      if (ea.li >= 0) { try { G.potato.halfPos(ea.li, ea.lh, p); } catch (e) {} return { pts: [p], opts: { tap: true } }; }
      for (let i = 0; i < 3; i++) if (G.potato.state(i) === 'zaru') { try { G.potato.halfPos(i, 2, p); } catch (e) {} break; }
      return { pts: [V3(p.x - 0.07, p.y, p.z), V3(p.x + 0.07, p.y, p.z)], opts: { speed: 0.35 } };
    },
    release() { if (ea.brk >= 0) { try { G.potato.breakCancel(ea.brk); } catch (e) {} ea.brk = -1; } },
  };
  function openIt(i) {
    const P = G.potato;
    try { P.breakOpen(i); G.audio.crackOpen(); G.rig.nudge(0.2); } catch (e) {}
    ea.brk = -1;
    wholeSteam[i] = stopSteam(wholeSteam[i]);
    for (let h = 0; h < 2; h++) {
      ea.bites[i * 2 + h] = BITES;
      try { P.halfPos(i, h, halfV[i * 2 + h]); } catch (e) {}
      if (h === 0) { try { G.fire.steamBurst(halfV[i * 2], 1); } catch (e) {} }
      halfSteam[i * 2 + h] = stopSteam(halfSteam[i * 2 + h]);
      const hs = steamAt(halfV[i * 2 + h], 1);
      halfSteam[i * 2 + h] = hs;
      if (hs) after(3, () => { try { hs.setRate(0.4); } catch (e) {} });
    }
    let n = 0; for (let k = 0; k < 3; k++) { const s = P.state(k); if (s === 'open' || s === 'eaten') n++; }
    try { G.audio.chime(2 + n); } catch (e) {}
    progress(); save();
  }
  function biteIt(i, h) {
    let left = 0;
    try { left = num(G.potato.bite(i, h), 0); } catch (e) {}
    ea.bites[i * 2 + h] = left;
    try { G.potato.halfPos(i, h, tmp); G.fire.steamBurst(tmp, 0.35); } catch (e) {}
    if (left <= 0) halfSteam[i * 2 + h] = stopSteam(halfSteam[i * 2 + h]);
    progress(); save();
    checkEaten();
  }
  function checkEaten() {
    let n = 0; try { n = num(G.potato.eatenCount, 0); } catch (e) {}
    if (n >= 3 && !busy) { beatOn(); after(1.2, () => enterStage('finale')); }
  }

  // ---- finale: watch; the wind brings the leaves down again
  S.finale = {
    enter() {
      beatOn();
      stopAllSteam();
      try {
        G.audio.finale(); G.world.setTimeOfDay(1); G.world.spot(null);
        G.leaves.setEmber(0.6); G.fire.setLevel(0); G.fire.setSmoke(0.04);
      } catch (e) {}
      fireAud = 0; emberAud = 0.25;
      shot('finale', 3.0);
      after(3.2, () => {
        try { G.audio.gust(3.5); G.world.shakeTree(1); } catch (e) {}
        shot('sky', 2.2);
      });
      after(5.5, () => {
        round++;
        try { G.potato.reset(round); } catch (e) {}
        fireOff(); burn = 0;
        try { G.leaves.setEmber(0); G.leaves.setBurn(0); } catch (e) {}
        try { G.leaves.reset({ pileStart: 0.10, rain: 4.0 }); } catch (e) {}
        try { G.world.setTimeOfDay(0); } catch (e) {}
        stage = 'sweep'; save(); stage = 'finale';
      });
      after(8.0, () => enterStage('sweep', { glide: 2.6, calm: 3, beat: 2.6 }));
    },
    update() { leadSize = null; },
    path() { return null; },
    release() {},
  };

  // ---------------------------------------------------------------- stage entry
  function enterStage(name, o) {
    o = o || {};
    if (!S[name]) return;
    try { if (S[stage] && S[stage].release) S[stage].release(); } catch (e) {}
    stage = name; sT = 0;
    busy = false; needFresh = inp.down && !inp.justDown;
    ladderReset();
    calm = num(o.calm, 0);
    clearAttention();
    leadSize = null;
    try { S[name].enter(o); } catch (e) { warn('enter ' + name, e); }
    if (o.beat > 0 && !busy) { beatOn(); after(o.beat, beatOff); }
    if (name !== 'finale') save();
  }

  function goto(name) {
    if (!STAGES.includes(name)) return;
    try { if (S[stage] && S[stage].release) S[stage].release(); } catch (e) {}
    gen++; timers.length = 0; busy = false;
    readAnchors();
    setupFor(name);
    enterStage(name, { cut: true });
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    dt = clamp(num(dt, 0), 0, 0.05);
    try {
      sT += dt;
      if (needFresh && !inp.down) needFresh = false;
      if (inp.justDown && !busy) ladderReset();
      runTimers(dt);
      const st = S[stage];
      if (st) st.update(dt);
      updateLadder(dt);
      applyHalos();
      applyWorldAttention(dt);
      trackSteamTargets();
      try { G.audio.fire(fireAud); G.audio.ember(emberAud); } catch (e) {}
    } catch (e) { warn('update', e); }
  }

  // ---------------------------------------------------------------- boot
  try {
    if (!restore()) { round = 1; setupFor('sweep'); enterStage('sweep', { cut: true }); }
  } catch (e) {
    warn('boot', e);
    try { round = 1; setupFor('sweep'); enterStage('sweep', { cut: true }); } catch (e2) {}
  }

  return {
    update, goto,
    get stage() { return stage; },
    get round() { return round; },
  };
}
