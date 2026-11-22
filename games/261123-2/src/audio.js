// AUDIO — G.audio. Everything synthesised with Web Audio (noise + filters + oscillators + envelopes).
// Warm, soft, never startling. Every method is a silent no-op before unlock() or without Web Audio.
//
// Gain staging (pre-master amplitudes; master 0.8 → gentle compressor → destination):
//   noise buffers are normalised to RMS 0.25; wn()/lpn() return the gain that makes filtered white
//   noise ≈ unit RMS, so noise envelope peaks below are "RMS" values (crest ≈ ×3).
//   beds  ≈ 0.06–0.13 RMS  → −24…−17 dBFS out
//   one-shots ≈ 0.2–0.4 peak → −16…−10 dBFS out;  leafIn ≈ 0.09 peak.
export function create(G) {
  let ctx = null, dead = false, userSusp = false, unlockClock = 0, retryT = 0;
  let master, comp, sfxBus, musBus, bedBus, revIn;
  let WHITE = null, PINK = null, BROWN = null;
  const sfxV = [], bedV = [], grave = [];
  const gates = Object.create(null);
  let finaleV = null;
  const A_MIN = 0.005;

  // continuous beds
  const mkBed = (up, down, hold) => ({ pend: 0, got: false, tgt: 0, lvl: 0, idle: 0, up, down, hold });
  const B = { rustle: mkBed(0.03, 0.04, 0.05), fire: mkBed(0.2, 0.13, 0.08), ember: mkBed(0.3, 0.13, 0.08) };
  let rus = null, fir = null, emb = null;               // bed node sets
  let rgT = 0, crT = 0, tkT = 0, wobT = 0, wob = 1, wobTgt = 1, swWob = 1;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const num = (x, d) => { x = +x; return Number.isFinite(x) ? x : d; };
  const expGap = (rate) => -Math.log(1 - Math.random() * 0.999) / Math.max(rate, 0.01);
  const nowClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const wn = (f, Q) => 1 / (0.25 * Math.sqrt(clamp(f / Math.max(Q, 0.05) / 24000, 0.0016, 1)));
  const lpn = (fc) => 1 / (0.25 * Math.sqrt(clamp(fc * 1.2 / 24000, 0.0016, 1)));
  const PENT = [0, 2, 4, 7, 9];
  const pent = (step) => { step = Math.max(0, Math.round(step)); return 523.25 * Math.pow(2, (12 * Math.floor(step / 5) + PENT[step % 5]) / 12); };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- context / graph ----------
  function makeNoise(kind) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 2), X = Math.floor(sr * 0.05);
    const raw = new Float32Array(len + X);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 0) raw[i] = w;
      else if (kind === 1) {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else { br = 0.97 * br + w * 0.03; raw[i] = br; }
    }
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {           // crossfade the tail into the head → seamless loop
      d[i] = i < X ? raw[i] * (i / X) + raw[len + i] * (1 - i / X) : raw[i];
    }
    let mean = 0; for (let i = 0; i < len; i++) mean += d[i]; mean /= len;
    let ss = 0; for (let i = 0; i < len; i++) { d[i] -= mean; ss += d[i] * d[i]; }
    const k = 0.25 / Math.sqrt(ss / len || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  }

  function makeImpulse() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 1.4);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        lp += (Math.random() * 2 - 1 - lp) * 0.35;              // warm: one-pole lowpassed noise
        d[i] = lp * Math.exp(-t * 3.6) * Math.min(1, t / 0.012);
      }
    }
    return buf;
  }

  function loopSrc(buf) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(ctx.currentTime + 0.01, Math.random() * 1.5);
    return s;
  }
  function biq(type, f, Q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (Q != null) b.Q.value = Q; return b; }
  function g0(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function link(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }

  function build() {
    WHITE = makeNoise(0); PINK = makeNoise(1); BROWN = makeNoise(2);
    master = g0(0.8);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.005; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = g0(1); sfxBus.connect(master);
    bedBus = g0(1); bedBus.connect(master);
    musBus = g0(1); musBus.connect(master);
    try {
      const conv = ctx.createConvolver(); conv.buffer = makeImpulse();
      revIn = g0(0.4); const wet = g0(0.32);
      musBus.connect(revIn); link(revIn, conv, wet, master);
    } catch (e) { revIn = null; }

    // rustle bed: smooth swish layer + grain-modulated crackle layer
    rus = { out: g0(1), swG: g0(0), crG: g0(0), crF: biq('bandpass', 4500, 1.4) };
    link(loopSrc(WHITE), biq('bandpass', 2800, 0.7), rus.swG, rus.out);
    link(loopSrc(WHITE), rus.crF, rus.crG, rus.out);
    rus.out.connect(bedBus);
    // fire bed: brown roar + pink "breath" for small speakers
    fir = { out: g0(1), roarG: g0(0), brG: g0(0) };
    link(loopSrc(BROWN), biq('highpass', 70, 0.7), biq('lowpass', 420, 0.7), fir.roarG, fir.out);
    link(loopSrc(PINK), biq('bandpass', 700, 0.8), fir.brG, fir.out);
    fir.out.connect(bedBus);
    // ember bed: very soft high hiss
    emb = { out: g0(1), hG: g0(0) };
    link(loopSrc(PINK), biq('highpass', 2500, 0.7), emb.hG, emb.out);
    emb.out.connect(bedBus);
  }

  function tryResume() {
    if (!ctx || userSusp) return;
    try { const p = ctx.resume && ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  function silentBlip() {
    try {
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
      s.onended = () => { try { s.disconnect(); } catch (e) {} };
    } catch (e) {}
  }
  // may we make sound right now?
  function live() {
    if (!ctx || dead || userSusp || !master) return false;
    if (ctx.state === 'running') return true;
    return nowClock() - unlockClock < 600;   // just unlocked, resume() still pending: schedule anyway
  }

  // ---------- voices ----------
  function prune(list, now) {
    for (let i = list.length - 1; i >= 0; i--) {
      const v = list[i];
      if (v.end < now) {
        for (const n of v.n) { try { n.disconnect(); } catch (e) {} }
        list[i] = list[list.length - 1]; list.pop();
      }
    }
  }
  function voice(pool, cap) {
    const now = ctx.currentTime;
    prune(pool, now);
    if (pool.length >= cap) return null;
    const v = { n: [], src: [], end: now + 0.05 };
    pool.push(v);
    return v;
  }
  const sfx = () => (live() ? voice(sfxV, 24) : null);
  const T = () => ctx.currentTime + 0.012;
  function gate(key, gap) {
    const now = ctx.currentTime;
    if (gates[key] !== undefined && now - gates[key] < gap) return false;
    gates[key] = now; return true;
  }
  function noise(v, buf, t0, t1, rate) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(t0, Math.random() * (buf.duration - 0.2)); s.stop(t1);
    v.n.push(s); v.src.push(s); v.end = Math.max(v.end, t1 + 0.05);
    return s;
  }
  function osc(v, type, f, t0, t1) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
    o.start(t0); o.stop(t1);
    v.n.push(o); v.src.push(o); v.end = Math.max(v.end, t1 + 0.05);
    return o;
  }
  function filt(v, type, f, Q) { const b = biq(type, f, Q); v.n.push(b); return b; }
  function gain(v, val = 0) { const g = g0(val); v.n.push(g); return g; }
  // attack (linear) → optional hold → exponential release to −60 dB over d
  function env(v, t0, a, peak, d, hold = 0) {
    const g = gain(v, 0), p = g.gain;
    a = Math.max(a, A_MIN); peak = Math.max(peak, 1e-4);
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + a);
    if (hold > 0) p.setValueAtTime(peak, t0 + a + hold);
    const te = t0 + a + hold + Math.max(d, 0.01);
    p.exponentialRampToValueAtTime(peak * 0.001, te);
    p.linearRampToValueAtTime(0, te + 0.01);
    v.end = Math.max(v.end, te + 0.06);
    return g;
  }
  // a stream of tiny non-overlapping grains on a gain param (crunch / crackle texture)
  function grainRun(p, t0, dur, rate, peak) {
    let t = t0;
    p.setValueAtTime(0, t0);
    while (t < t0 + dur) {
      const d = rand(0.006, 0.03), pk = Math.max(1e-4, peak * rand(0.35, 1));
      p.setValueAtTime(1e-4, t);
      p.linearRampToValueAtTime(pk, t + 0.004);
      p.exponentialRampToValueAtTime(1e-4, t + d);
      t += d + expGap(rate);
    }
    p.setValueAtTime(0, t + 0.005);
    return t + 0.01;
  }
  // noise tick through a bandpass
  function tick(v, t, f, Q, amp, d, dest, buf = WHITE) {
    const s = noise(v, buf, t, t + d + 0.04);
    link(s, filt(v, 'bandpass', f, Q), env(v, t, A_MIN, amp * wn(f, Q), d), dest);
  }
  function ping(v, t, f, amp, d, dest, type = 'sine') {
    link(osc(v, type, f, t, t + d + 0.04), env(v, t, A_MIN, amp, d), dest);
  }
  function drop(v, t, f0, f1, dt, amp, d, dest, type = 'sine') {
    const o = osc(v, type, f0, t, t + d + 0.05);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dt);
    link(o, env(v, t, A_MIN, amp, d), dest);
  }
  function bell(v, t, f, amp, d, dest) {                  // soft bell: sine + inharmonic shimmer
    ping(v, t, f, amp, d, dest);
    ping(v, t, f * 2.76, amp * 0.16, d * 0.35, dest);
    ping(v, t, f * 5.4, amp * 0.05, d * 0.15, dest);
  }

  // ---------- beds (driven from update) ----------
  function bedIn(b, k) { k = clamp(num(k, 0), 0, 1); if (k > b.pend) b.pend = k; b.got = true; }
  function bedStep(b, dt) {
    if (b.got) { b.tgt = b.pend; b.idle = 0; } else { b.idle += dt; if (b.idle > b.hold) b.tgt = 0; }
    b.pend = 0; b.got = false;
    const tau = b.tgt > b.lvl ? b.up : b.down;
    b.lvl += (b.tgt - b.lvl) * (1 - Math.exp(-dt / tau));
    if (b.lvl < 1e-4 && b.tgt === 0) b.lvl = 0;
  }
  function setP(p, val, now, tc) {
    if (p._last === undefined) p._last = 0;
    if (Math.abs(p._last - val) < 0.0015 && !(val === 0 && p._last !== 0)) return;
    p._last = val;
    p.setTargetAtTime(val, now, tc);
  }
  function crackle(t, amp) {
    const v = voice(bedV, 14); if (!v) return;
    const f = rand(1000, 5000), Q = rand(2, 7);
    tick(v, t, f, Q, amp, rand(0.008, 0.035), fir.out);
  }
  function snap(t, amp) {
    const v = voice(bedV, 14); if (!v) return;
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) tick(v, t + i * rand(0.012, 0.03), rand(1800, 4200), 3, amp * rand(0.6, 1), 0.012, fir.out);
    tick(v, t, rand(500, 850), 3, amp * 0.8, 0.05, fir.out);
  }
  function emberTick(t, amp) {
    const v = voice(bedV, 14); if (!v) return;
    const f = rand(2600, 5800);
    ping(v, t, f, amp, rand(0.02, 0.07), emb.out);
    if (Math.random() < 0.35) ping(v, t + rand(0.03, 0.07), f * rand(1.25, 1.6), amp * 0.6, 0.04, emb.out);
    if (Math.random() < 0.5) tick(v, t, rand(3000, 6000), 4, amp * 0.6, 0.01, emb.out);
  }

  function runBeds(dt, now) {
    // rustle
    const r = B.rustle.lvl;
    swWob += (rand(0.75, 1.2) - swWob) * Math.min(1, dt * 12);
    setP(rus.swG.gain, 0.7 * r * swWob, now, 0.02);
    if (r > 0.02) {
      if (rgT < now + 0.01) rgT = now + 0.01;
      const p = rus.crG.gain, fp = rus.crF.frequency;
      while (rgT < now + 0.08) {
        const d = rand(0.005, 0.03), pk = Math.max(1e-4, 1.0 * r * rand(0.3, 1.1));
        fp.setValueAtTime(rand(3200, 4200 + 2800 * r), rgT);
        p.setValueAtTime(1e-4, rgT);
        p.linearRampToValueAtTime(pk, rgT + 0.004);
        p.exponentialRampToValueAtTime(1e-4, rgT + d);
        rgT += d + expGap(20 + 70 * r);
      }
    }
    // fire
    const f = B.fire.lvl;
    wobT -= dt; if (wobT <= 0) { wobT = rand(0.25, 0.6); wobTgt = rand(0.6, 1.1); }
    wob += (wobTgt - wob) * Math.min(1, dt * 3);
    setP(fir.roarG.gain, 0.6 * f * wob, now, 0.05);
    setP(fir.brG.gain, 0.5 * f * (0.7 + 0.3 * wob), now, 0.05);
    if (f > 0.02) {
      if (crT < now) crT = now + expGap(2 + 16 * f);
      while (crT < now + 0.06) {
        const amp = 0.065 * Math.pow(f, 0.6) * rand(0.35, 1);
        if (Math.random() < 0.05) snap(crT, amp * 1.5); else crackle(crT, amp);
        crT += expGap(2 + 16 * f);
      }
    } else crT = 0;
    // ember
    const e = B.ember.lvl;
    setP(emb.hG.gain, 0.3 * e, now, 0.08);
    if (e > 0.02) {
      if (tkT < now) tkT = now + expGap(0.8 + 4 * e);
      while (tkT < now + 0.06) { emberTick(tkT, 0.01 + 0.03 * e * rand(0.4, 1)); tkT += expGap(0.8 + 4 * e); }
    } else tkT = 0;
  }

  // ---------- finale ----------
  function stopFinale(now) {
    const v = finaleV; finaleV = null;
    if (!v) return;
    try {
      const p = v.fg.gain;
      p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + 0.05);
    } catch (e) {}
    for (const s of v.src) { try { s.stop(now + 0.07); } catch (e) {} }
    v.end = now + 0.15; grave.push(v);
  }
  function playFinale() {
    const now = ctx.currentTime;
    stopFinale(now);
    const v = { n: [], src: [], end: now + 0.05 };
    const fg = gain(v, 0); v.fg = fg; fg.connect(musBus);
    const t0 = now + 0.1;
    fg.gain.setValueAtTime(0, now); fg.gain.linearRampToValueAtTime(1, t0);
    // melody (beats), gentle ritardando at the end
    const mel = [[76, 1], [79, 1], [81, 1.5], [79, 0.5], [76, 1], [74, 1], [72, 2],
                 [74, 1], [76, 1], [79, 1], [76, 1], [74, 1.5], [72, 0.5], [74, 1], [72, 3]];
    const beatT = []; let pos = 0, t = t0;
    const bt = (p) => 0.45 * (1 + 0.35 * clamp((p - 12) / 6, 0, 1));
    for (let b = 0; b <= 18; b += 0.5) { beatT.push(t); t += bt(b) * 0.5; }
    const at = (beat) => beatT[clamp(Math.round(beat * 2), 0, beatT.length - 1)];
    for (let i = 0; i < mel.length; i++) {
      const [m, len] = mel[i], tt = at(pos), f = mtof(m), last = i === mel.length - 1;
      const pk = last ? 0.12 : 0.105 + rand(-0.01, 0.01);
      const d = last ? 3.2 : 1.5;
      ping(v, tt, f, pk, d, fg);                       // music-box tine
      ping(v, tt, f * 2, pk * 0.2, d * 0.4, fg);
      ping(v, tt, f * 4.01, pk * 0.06, 0.18, fg);      // marimba-ish 4th partial sparkle
      pos += len;
    }
    // warm pad underneath (triangles through a lowpass)
    const lp = filt(v, 'lowpass', 1400, 0.5); lp.connect(fg);
    const chords = [[0, 4, [60, 64, 67, 48]], [4, 4, [57, 60, 64, 45]], [8, 4, [53, 57, 60, 41]],
                    [12, 3, [55, 62, 67, 43]], [15, 3, [60, 64, 67, 48]]];
    for (let c = 0; c < chords.length; c++) {
      const [sb, len, notes] = chords[c], last = c === chords.length - 1;
      const ts = at(sb), te = last ? at(18) + 2.2 : at(sb + len);
      for (let j = 0; j < notes.length; j++) {
        const bass = j === 3, o = osc(v, bass ? 'sine' : 'triangle', mtof(notes[j]) * (1 + rand(-0.002, 0.002)), ts, te + 1.3);
        const g = gain(v, 0), p = g.gain, pk = bass ? 0.035 : 0.026;
        p.setValueAtTime(0, ts); p.linearRampToValueAtTime(pk, ts + 0.7);
        p.setValueAtTime(pk, te); p.exponentialRampToValueAtTime(pk * 0.001, te + 1.2); p.linearRampToValueAtTime(0, te + 1.25);
        link(o, g, lp);
      }
    }
    v.end = Math.max(v.end, at(18) + 4.5);
    finaleV = v;
  }

  // ---------- public API ----------
  const api = {
    unlock() {
      if (dead) return;
      if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { dead = true; return; }
        try { ctx = new AC(); } catch (e) { dead = true; return; }
        try { build(); } catch (e) { dead = true; try { ctx.close(); } catch (e2) {} ctx = null; return; }
      }
      userSusp = false; unlockClock = nowClock();
      tryResume(); silentBlip();
    },
    suspend() {
      if (!ctx) return; userSusp = true;
      try { const p = ctx.suspend && ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    },
    resume() {
      if (!ctx) return; userSusp = false; unlockClock = nowClock(); tryResume();
    },

    rustle(k) { bedIn(B.rustle, k); },
    fire(k) { bedIn(B.fire, k); },
    ember(k) { bedIn(B.ember, k); },

    leafIn(frac) {
      if (!live() || !gate('leaf', 1 / 14)) return;
      const v = voice(sfxV, 24); if (!v) return;
      frac = clamp(num(frac, 0), 0, 1);
      const step = clamp(Math.round(frac * 10) + Math.round(rand(-1, 1)), 0, 10), f = pent(step);
      const t = T(), pk = 0.17 - 0.06 * frac;
      ping(v, t, f, pk, 0.2, musBus);
      ping(v, t, f * 4, pk * 0.12, 0.05, musBus);
    },
    pat() {
      if (!live() || !gate('pat', 0.04)) return;
      const v = sfx(); if (!v) return; const t = T();
      tick(v, t, rand(2000, 3000), 1.2, 0.06, 0.04, sfxBus);
      drop(v, t, 180, 110, 0.05, 0.08, 0.06, sfxBus);
    },
    gust(seconds) {
      if (!live() || !gate('gust', 0.3)) return;
      const v = sfx(); if (!v) return;
      const s = clamp(num(seconds, 2.5), 0.6, 10), t = T();
      const bp = filt(v, 'bandpass', 300, 0.9), f = bp.frequency;
      f.setValueAtTime(300, t); f.exponentialRampToValueAtTime(900, t + 0.45 * s); f.exponentialRampToValueAtTime(400, t + s);
      const g = gain(v, 0), p = g.gain, P = 0.8;
      p.setValueAtTime(0, t); p.linearRampToValueAtTime(P, t + 0.45 * s);
      p.linearRampToValueAtTime(P * 0.6, t + 0.75 * s); p.exponentialRampToValueAtTime(P * 0.001, t + s);
      p.linearRampToValueAtTime(0, t + s + 0.02);
      link(noise(v, PINK, t, t + s + 0.05), bp, g, sfxBus);
      // leafy flutter layer
      const am = gain(v, 0.6), lfo = osc(v, 'sine', rand(5, 8), t, t + s + 0.05), dep = gain(v, 0.4);
      link(lfo, dep); dep.connect(am.gain);
      const lg = gain(v, 0), q = lg.gain, L = 0.045 * wn(5000, 0.8);
      q.setValueAtTime(0, t); q.linearRampToValueAtTime(L, t + 0.55 * s);
      q.exponentialRampToValueAtTime(L * 0.001, t + s); q.linearRampToValueAtTime(0, t + s + 0.02);
      link(noise(v, WHITE, t, t + s + 0.05), filt(v, 'bandpass', 5000, 0.8), am, lg, sfxBus);
      v.end = Math.max(v.end, t + s + 0.1);
    },
    treeShake() {
      if (!live() || !gate('tree', 0.25)) return;
      const v = sfx(); if (!v) return; const t = T();
      const n = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const tt = t + rand(0, 0.5) * (i / n + 0.2), amp = 0.12 * rand(0.5, 1);
        tick(v, tt, rand(1200, 2200), 5, amp, 0.025, sfxBus);
        if (i % 2 === 0) ping(v, tt, rand(320, 480), amp * 0.6, 0.035, sfxBus);
      }
      const am = gain(v, 0.6), lfo = osc(v, 'sine', 14, t, t + 0.7), dep = gain(v, 0.4);
      link(lfo, dep); dep.connect(am.gain);
      link(noise(v, WHITE, t, t + 0.7), filt(v, 'bandpass', 4500, 0.8), am, env(v, t, 0.04, 0.07 * wn(4500, 0.8), 0.5, 0.05), sfxBus);
    },
    roll() {
      if (!live() || !gate('roll', 0.15)) return;
      const v = sfx(); if (!v) return; const t = T();
      const n = 2 + Math.floor(Math.random() * 3); let tt = t;
      for (let i = 0; i < n; i++) {
        const a = 0.1 * (1 - i * 0.18), f = rand(2500, 3500);
        tick(v, tt, f * 1.2, 8, a, 0.015, sfxBus);
        ping(v, tt, f, a * 0.5, 0.02, sfxBus);
        tt += rand(0.04, 0.09);
      }
    },
    thud(k) {
      if (!live() || !gate('thud', 0.05)) return;
      const v = sfx(); if (!v) return; const t = T();
      k = clamp(num(k, 1), 0, 1); if (k <= 0) return;
      const a = Math.sqrt(k);
      drop(v, t, 120, 60, 0.12, 0.35 * a, 0.14, sfxBus);
      drop(v, t, 240, 120, 0.12, 0.08 * a, 0.08, sfxBus, 'triangle');
      const s = noise(v, WHITE, t, t + 0.15), g = gain(v, 0);
      grainRun(g.gain, t, 0.08, 120, 0.06 * a * wn(3000, 0.9));
      link(s, filt(v, 'bandpass', 3000, 0.9), g, sfxBus);
    },
    tok() {
      if (!live() || !gate('tok', 0.05)) return;
      const v = sfx(); if (!v) return; const t = T(), f = rand(700, 900);
      ping(v, t, f, 0.45, 0.07, sfxBus);
      ping(v, t, f * 2.7, 0.06, 0.025, sfxBus);
      tick(v, t, f, 20, 0.05, 0.03, sfxBus);
      tick(v, t, 4500, 1, 0.04, 0.006, sfxBus);
    },
    rummage() {
      if (!live() || !gate('rummage', 0.12)) return;
      const v = sfx(); if (!v) return; const t = T();
      const g = gain(v, 0);
      grainRun(g.gain, t, 0.3, 60, 0.11 * wn(3000, 0.7));
      link(noise(v, WHITE, t, t + 0.4), filt(v, 'bandpass', 3000, 0.7), g, env(v, t, 0.02, 1, 0.12, 0.2), sfxBus);
      drop(v, t + 0.28, 110, 55, 0.1, 0.3, 0.14, sfxBus);
      link(noise(v, BROWN, t + 0.28, t + 0.5), filt(v, 'lowpass', 300, 0.7), env(v, t + 0.28, 0.01, 0.12, 0.1), sfxBus);
    },
    lighterClick() {
      if (!live() || !gate('lighter', 0.12)) return;
      const v = sfx(); if (!v) return; const t = T();
      for (let i = 0; i < 2; i++) {
        const tt = t + i * 0.09, a = i ? 0.8 : 1;
        link(noise(v, WHITE, tt, tt + 0.05), filt(v, 'highpass', 4000, 0.7), env(v, tt, A_MIN, 0.25 * a, 0.012), sfxBus);
        ping(v, tt, 3000 * (i ? 1.04 : 1), 0.05 * a, 0.03, sfxBus);
      }
    },
    ignite() {
      if (!live() || !gate('ignite', 0.2)) return;
      const v = sfx(); if (!v) return; const t = T();
      const lp = filt(v, 'lowpass', 2500, 1);
      lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
      link(noise(v, WHITE, t, t + 0.5), lp, env(v, t, 0.08, 0.065 * lpn(1000), 0.35), sfxBus);
      link(noise(v, BROWN, t, t + 0.5), filt(v, 'lowpass', 500, 0.7), env(v, t, 0.07, 0.3, 0.3), sfxBus);
    },
    fan(k) {
      if (!live() || !gate('fan', 0.06)) return;
      const v = sfx(); if (!v) return; const t = T();
      k = clamp(num(k, 0.5), 0, 1);
      const d = 0.18 + 0.08 * k, bp = filt(v, 'bandpass', 400, 1.2);
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1200, t + d);
      link(noise(v, PINK, t, t + d + 0.15), bp, env(v, t, d * 0.4, (0.04 + 0.1 * k) * 8, d * 0.8), sfxBus);
    },
    pop() {
      if (!live() || !gate('pop', 0.06)) return;
      const v = sfx(); if (!v) return; const t = T();
      drop(v, t, 900, 200, 0.06, 0.28, 0.07, sfxBus);
      tick(v, t, 2500, 1, 0.08, 0.012, sfxBus);
    },
    hiss() {
      if (!live() || !gate('hiss', 0.1)) return;
      const v = sfx(); if (!v) return; const t = T();
      link(noise(v, WHITE, t, t + 0.5), filt(v, 'highpass', 3500, 0.7), filt(v, 'lowpass', 9000, 0.7),
        env(v, t, 0.03, 0.35, 0.37), sfxBus);
    },
    ashPuff() {
      if (!live() || !gate('ash', 0.08)) return;
      const v = sfx(); if (!v) return; const t = T();
      link(noise(v, WHITE, t, t + 0.25), filt(v, 'lowpass', 700, 0.7), env(v, t, 0.015, 0.08 * lpn(700), 0.14), sfxBus);
      link(noise(v, BROWN, t, t + 0.25), filt(v, 'lowpass', 300, 0.7), env(v, t, 0.015, 0.15, 0.12), sfxBus);
    },
    tongs() {
      if (!live() || !gate('tongs', 0.06)) return;
      const v = sfx(); if (!v) return; const t = T(), r = rand(0.97, 1.03);
      ping(v, t, 2100 * r, 0.1, 0.12, sfxBus);
      ping(v, t, 3400 * r, 0.065, 0.1, sfxBus);
      tick(v, t, 5000, 2, 0.03, 0.006, sfxBus);
    },
    crackOpen() {
      if (!live() || !gate('crack', 0.15)) return;
      const v = sfx(); if (!v) return; const t = T();
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) tick(v, t + i * 0.035, rand(3000, 4000), 3, 0.15 * (1 - i * 0.2), 0.015, sfxBus);
      const th = t + 0.06, bp = filt(v, 'bandpass', 1600, 0.6);
      bp.frequency.setValueAtTime(1600, th); bp.frequency.exponentialRampToValueAtTime(900, th + 0.55);
      link(noise(v, PINK, th, th + 0.8), bp, env(v, th, 0.15, 0.6, 0.45, 0.05), sfxBus);
      drop(v, t + 0.08, 220, 140, 0.06, 0.25, 0.12, sfxBus);
    },
    bite() {
      if (!live() || !gate('bite', 0.2)) return;
      const v = sfx(); if (!v) return; const t = T();
      for (let i = 0; i < 2; i++) {
        const tt = t + i * 0.14, gr = gain(v, 0);
        grainRun(gr.gain, tt, 0.08, 90, 1);
        link(noise(v, WHITE, tt, tt + 0.15), filt(v, 'lowpass', 1500, 0.7), filt(v, 'bandpass', 700, 1.5), gr,
          env(v, tt, 0.01, 0.1 * wn(700, 1.5) * 0.7 * (i ? 0.85 : 1), 0.06, 0.02), sfxBus);
      }
    },
    cue() {
      if (!live() || !gate('cue', 0.8)) return;
      const v = sfx(); if (!v) return; const t = T();
      bell(v, t, 659.25, 0.14, 0.9, musBus);
      bell(v, t + 0.22, 880, 0.13, 1.1, musBus);
    },
    chime(n) {
      if (!live() || !gate('chime', 0.12)) return;
      const v = sfx(); if (!v) return; const t = T();
      const s = clamp(Math.round(num(n, 0)), 0, 6);
      for (let i = 0; i < 3; i++) bell(v, t + i * 0.09, pent(s + i * 2), 0.15 - i * 0.015, 0.9 + i * 0.2, musBus);
    },
    finale() {
      if (!live()) return;
      playFinale();
    },

    update(dt) {
      if (!ctx || dead || !master) return;
      dt = clamp(num(dt, 1 / 60), 0, 0.1);
      bedStep(B.rustle, dt); bedStep(B.fire, dt); bedStep(B.ember, dt);
      if (userSusp) return;
      if (ctx.state !== 'running') {
        retryT -= dt;
        if (retryT <= 0) { retryT = 1; tryResume(); }
        return;
      }
      const now = ctx.currentTime;
      runBeds(dt, now);
      prune(sfxV, now); prune(bedV, now); prune(grave, now);
      if (finaleV && finaleV.end < now) { grave.push(finaleV); finaleV = null; }
    },
  };

  // wrap everything: a throwing / missing Web Audio must never break the game
  for (const k of Object.keys(api)) {
    const fn = api[k];
    api[k] = function () {
      try { return fn.apply(api, arguments); } catch (e) { if (G && G.dev) console.warn('audio.' + k, e); }
    };
  }
  return api;
}
