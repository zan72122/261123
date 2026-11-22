// ごしごし！うわばきあらってほそう — entry point. Wires modules + stages into the engine.
import { boot } from './engine/boot.js';
import { L } from './layout.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createFx } from './fx.js';
import { createShoe } from './shoes.js';
import { createBag } from './bag.js';
import { createFaucet, createBasin, createBrush, createSoap } from './washprops.js';
import { createSpinner, createPole, createHanger } from './dryprops.js';
import { defaultState, createSim } from './common.js';
import { washStages } from './scenes_wash.js';
import { dryStages } from './scenes_dry.js';

boot({
  saveKey: 'gf-261123-3',
  defaultState,
  stages: [...washStages, ...dryStages],
  createModules(ctx) {
    const { scene } = ctx;
    ctx.audio = createAudio();
    ctx.world = createWorld(ctx);
    ctx.fx = createFx(ctx);
    ctx.shoes = [createShoe(ctx, { side: 'L' }), createShoe(ctx, { side: 'R' })];
    ctx.bag = createBag(ctx);
    ctx.faucet = createFaucet(ctx);
    ctx.basin = createBasin(ctx);
    ctx.brush = createBrush(ctx);
    ctx.soap = createSoap(ctx);
    ctx.spinner = createSpinner(ctx);
    ctx.pole = createPole(ctx);
    ctx.hanger = createHanger(ctx);
    ctx.rigs = [0, 1].map(() => ({ where: 'hidden', press: 0, kx: 0, kz: 0, slide: 0 }));
    ctx.sim = createSim(ctx);
    for (const m of [ctx.world, ctx.fx, ctx.bag, ctx.faucet, ctx.basin, ctx.brush, ctx.soap, ctx.spinner, ctx.pole, ctx.hanger, ...ctx.shoes]) {
      if (m.group && !m.group.parent) scene.add(m.group);
    }
    ctx.faucet.group.position.fromArray(L.FAUCET);
    ctx.basin.group.position.fromArray(L.BASIN);
    ctx.soap.group.position.fromArray(L.SOAP);
    ctx.spinner.group.position.fromArray(L.SPINNER);
    // update order: sim first (positions floating shoes, drives water), then props, fx, audio
    return [ctx.sim, ctx.world, ctx.bag, ctx.faucet, ctx.basin, ctx.brush, ctx.soap, ctx.spinner, ctx.hanger, ctx.shoes[0], ctx.shoes[1], ctx.fx, ctx.audio];
  },
});
