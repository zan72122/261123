// Wires modules + stages into the engine. start(stages) is called by main.js (and by dev entries).
import { boot } from './engine/boot.js';
import { L } from './layout.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createFx } from './fx.js';
import { createShoe } from './shoes.js';
import { createBag } from './bag.js';
import { createFaucet, createBasin, createBrush, createSoap } from './washprops.js';
import { createSpinner, createPole, createHanger } from './dryprops.js';
import { defaultState, createSim, presetState, STAGE_ORDER } from './common.js';

const SAVE_KEY = 'gf-261123-3';
if (__DEV__) {            // dev only: ?fresh clears the save, ?stage=<id> starts at that stage with a plausible state
  try {
    const q = new URLSearchParams(location.search), st = q.get('stage');
    if (q.has('fresh')) localStorage.removeItem(SAVE_KEY);
    if (st && STAGE_ORDER.includes(st)) localStorage.setItem(SAVE_KEY, JSON.stringify({ state: presetState(st), stage: st, t: Date.now() }));
  } catch (e) { /* ignore */ }
}

export function start(stages) {
  return boot({
  saveKey: SAVE_KEY,
  defaultState,
  stages,
  // Only what the opening shot (the bag on the terrace) needs is built before the first frame; the rest is
  // built one piece per frame in the background while the child plays (see `later`), and is always
  // complete before the first stage change (boot flushes anything left).
  createModules(ctx) {
    const { scene } = ctx;
    const add = (m) => { if (m.group && !m.group.parent) scene.add(m.group); return m; };
    ctx.audio = createAudio();
    ctx.world = add(createWorld(ctx));
    ctx.fx = add(createFx(ctx));
    ctx.shoes = [add(createShoe(ctx, { side: 'L' })), add(createShoe(ctx, { side: 'R' }))];
    ctx.bag = add(createBag(ctx));
    ctx.basin = add(createBasin(ctx));
    ctx.faucet = ctx.brush = ctx.soap = ctx.spinner = ctx.pole = ctx.hanger = null;
    ctx.rigs = [0, 1].map(() => ({ where: 'hidden', press: 0, kx: 0, kz: 0, slide: 0 }));
    ctx.sim = createSim(ctx);
    ctx.basin.group.position.fromArray(L.BASIN);
    // modules built later are updated through a slot, so the update order stays the same as before
    const slot = (k) => ({ update(dt) { const m = ctx[k]; if (m && m.update) m.update(dt); } });
    // update order: sim first (positions floating shoes, drives water), then props, fx, audio
    return [ctx.sim, ctx.world, ctx.bag, slot('faucet'), ctx.basin, slot('brush'), slot('soap'), slot('spinner'), slot('hanger'), ctx.shoes[0], ctx.shoes[1], ctx.fx, ctx.audio];
  },
  later(ctx) {
    const { scene } = ctx;
    const add = (m) => { if (m.group && !m.group.parent) scene.add(m.group); return m; };
    return [
      () => { ctx.faucet = add(createFaucet(ctx)); ctx.faucet.group.position.fromArray(L.FAUCET); },
      ...ctx.world.later,
      () => { ctx.brush = add(createBrush(ctx)); },
      () => { ctx.soap = add(createSoap(ctx)); ctx.soap.group.position.fromArray(L.SOAP); },
      () => { ctx.spinner = add(createSpinner(ctx)); ctx.spinner.group.position.fromArray(L.SPINNER); },
      () => { ctx.pole = add(createPole(ctx)); },
      () => { ctx.hanger = add(createHanger(ctx)); },
    ];
  },
});
}
