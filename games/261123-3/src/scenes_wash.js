import { SHOTS } from './layout.js';
import { applyShoeState, putShoe, placeBag } from './common.js';
export const washStages = [{
  id: 'bag', shot: SHOTS[new URLSearchParams(location.search).get('shot') || 'dunk'],
  place(ctx) {
    const q = new URLSearchParams(location.search);
    ctx.world.setTimeOfDay(Number(q.get('tod') || 0));
    ctx.state.water.level = 0.8; ctx.state.water.murk = Number(q.get('murk') || 0);
    if (q.get('clean')) { ctx.state.shoes[0].dirt = 'clean'; ctx.state.shoes[1].dirt = 'clean'; }
    applyShoeState(ctx);
    const w = q.get('where') || 'ground';
    placeBag(ctx, w === 'clip' || w === 'packed'); ctx.bag.setOpen(1); ctx.bag.setFill(w === 'packed' ? 2 : 0); ctx.bag.setDusty(w === 'ground' ? 1 : 0);
    putShoe(ctx, 0, w); putShoe(ctx, 1, w);
    ctx.spinner.setLidOpen(Number(q.get('lid') || 0));
    ctx.brush.group.position.set(0.37, 0, 0.13);
  },
}];
