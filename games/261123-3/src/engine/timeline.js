// Game-time timeline: tweens and timers advanced by the engine loop (so they pause with the page).
export const EASE = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outBounce: (k) => {
    const n = 7.5625, d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
};

export function ease(name, k) {
  const f = typeof name === 'function' ? name : (EASE[name] || EASE.inOut);
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return f(k);
}

// guard(fn, where) runs fn in try/catch (engine error reporter).
export function createTimeline(guard = (fn) => fn()) {
  let items = [];
  let gen = 0;
  let time = 0;
  const num = (v) => (Number.isFinite(+v) ? Math.max(0, +v) : 0);
  const tl = {
    get time() { return time; },
    get alive() { return items.length; },
    tween(dur, fn, easeName = 'inOut') {
      return new Promise((res) => {
        items.push({ kind: 0, t0: time, dur: num(dur), fn, ease: easeName, res });
      });
    },
    after(sec, fn) {
      const it = { kind: 1, at: time + num(sec), fn };
      items.push(it);
      return { cancel() { it.dead = true; } };
    },
    every(sec, fn) {
      const period = Math.max(1 / 120, num(sec));
      const it = { kind: 2, at: time + period, period, fn };
      items.push(it);
      return { cancel() { it.dead = true; } };
    },
    kill() { items = []; gen++; },
    update(dt) {
      time += dt;
      const g = gen;
      const list = items;
      items = [];
      const keep = [];
      for (let i = 0; i < list.length; i++) {
        if (gen !== g) break;
        const it = list[i];
        if (it.dead) continue;
        if (it.kind === 0) {
          const k = it.dur > 0 ? Math.min(1, (time - it.t0) / it.dur) : 1;
          if (typeof it.fn === 'function') guard(() => it.fn(ease(it.ease, k)), 'tween');
          if (gen !== g) break;
          if (k >= 1) it.res(); else keep.push(it);
        } else if (it.kind === 1) {
          if (time >= it.at) { if (typeof it.fn === 'function') guard(() => it.fn(), 'after'); }
          else keep.push(it);
        } else {
          if (time >= it.at) {
            it.at += it.period;
            if (it.at < time) it.at = time + it.period; // never spiral after a stall
            if (typeof it.fn === 'function') guard(() => it.fn(), 'every');
          }
          if (!it.dead) keep.push(it);
        }
      }
      if (gen === g) items = keep.concat(items);
    },
  };
  return tl;
}
