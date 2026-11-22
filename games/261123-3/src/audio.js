// Procedural Web Audio for the uwabaki-washing game. No samples, no files.
// createAudio() -> { unlock, suspend, resume, play, setLoop, music, update }
// Every method is wrapped so that a missing / blocked AudioContext silently no-ops.
//
// (Test-only: createAudio({ context: OfflineAudioContext, horizon: seconds }) renders offline.)

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MAX_VOICES = 24;
const RATE_LIMIT = 0.025;

// reverb send per one-shot (default 0.12)
const LEVEL = {
  thud: 0.75, burp: 0.7, hop: 0.6, soapSlip: 0.65, chime: 0.8, dripDry: 2, clack: 1.8, zip: 1.5, snap: 1.4, rattle: 1.3, sparkle: 1.2, whoosh: 1.2,
};

const LOOP_LEVEL = { stream: 0.25, pour: 0.45, spin: 0.45, scrub: 0.35, overflow: 0.4, spout: 0.4, fizz: 0.45 };

const SEND = {
  drip: 0.3, plip: 0.25, pop: 0.2, chime: 0.4, sparkle: 0.45, sparkleBig: 0.5, splashBig: 0.2,
  burp: 0.2, squeak: 0.15, unsnap: 0.15, whoosh: 0.1, sand: 0.08, dripDry: 0.15,
};

export function createAudio(options = {}) {
  const offline = !!options.context;
  const HORIZON = options.horizon || 0.12;
  let ctx = null, failed = false, unlocked = false, hiddenWanted = false, susTok = 0;
  let dry, revIn, fade, buf = {};
  let voices = [];
  const lastPlay = Object.create(null);
  const loops = Object.create(null);
  const lastSet = new WeakMap();
  let curMusic = null;

  // ------------------------------------------------------------------ setup
  function init() {
    if (ctx) return true;
    if (failed) return false;
    try {
      if (offline) ctx = options.context;
      else {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { failed = true; return false; }
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
      }
      const sr = ctx.sampleRate;
      buf.white = mkNoise('white', 3, sr);
      buf.pink = mkNoise('pink', 5, sr);
      buf.brown = mkNoise('brown', 5, sr);

      dry = ctx.createGain();
      revIn = ctx.createGain();
      const conv = ctx.createConvolver();
      conv.buffer = mkIR(sr);
      const revOut = gain(0.55);
      const pre = gain(0.8); // master gain
      const soft = bq('lowpass', 15000, 0.5);
      const comp = ctx.createDynamicsCompressor();
      setC(comp, -16, 12, 3, 0.004, 0.25);
      const lim = ctx.createDynamicsCompressor();
      setC(lim, -4, 0, 20, 0.001, 0.1);
      fade = gain(1);
      dry.connect(pre);
      chain(revIn, conv, revOut, pre);
      chain(pre, soft, comp, lim, fade, ctx.destination);
    } catch (e) {
      failed = true; ctx = null; return false;
    }
    return true;
  }
  function setC(c, th, knee, ratio, att, rel) {
    c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = att; c.release.value = rel;
  }
  function mkNoise(kind, secs, sr) {
    const n = Math.floor(sr * secs), xf = 2048;
    const b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const x = new Float32Array(n + xf);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n + xf; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') x[i] = w;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; x[i] = last; }
      }
      // seamless loop: crossfade the tail into the start
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = x[i];
      for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = x[i] * k + x[n + i] * (1 - k); }
      let pk = 0, mean = 0;
      for (let i = 0; i < n; i++) mean += d[i];
      mean /= n;
      for (let i = 0; i < n; i++) { d[i] -= mean; const a = Math.abs(d[i]); if (a > pk) pk = a; }
      const s = 0.95 / (pk || 1);
      for (let i = 0; i < n; i++) d[i] *= s;
    }
    return b;
  }
  function mkIR(sr) {
    // short outdoor-ish space: a near house wall + soft diffuse tail
    const len = Math.floor(sr * 1.3), b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      const pre = Math.floor(sr * 0.006);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const a = 0.2 + 0.72 * Math.min(1, t / 0.9);
        lp += (1 - a) * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t / 0.26);
      }
      const er = [0.011 + ch * 0.003, 0.019 + ch * 0.002, 0.031 - ch * 0.004];
      er.forEach((e, k) => { const i = Math.floor(e * sr); if (i < len) d[i] += (ch ? -1 : 1) * (0.5 - k * 0.12); });
    }
    return b;
  }

  // ---------------------------------------------------------------- helpers
  function gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function bq(type, f, Q) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f;
    if (Q != null) b.Q.value = Q;
    return b;
  }
  function chain() { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function nsrc(kind = 'white', rate = 1) {
    const s = ctx.createBufferSource(); s.buffer = buf[kind]; s.loop = true; s.playbackRate.value = rate; return s;
  }
  function startN(s, t) { s.start(t, Math.random() * (s.buffer.duration - 0.2)); }
  function env(p, t0, a, peak, d) {
    p.setValueAtTime(0, t0); p.linearRampToValueAtTime(peak, t0 + a); p.setTargetAtTime(0, t0 + a, d / 5);
    return t0 + a + d;
  }
  const running = () => !!ctx && (offline || ctx.state === 'running');

  // ---------------------------------------------------------------- voices
  function mkV(t, g, pan, send) {
    const out = gain(g);
    let tail = out, pn = null, sg = null;
    if (pan && ctx.createStereoPanner) { pn = ctx.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); out.connect(pn); tail = pn; }
    tail.connect(dry);
    if (send > 0) { sg = gain(send); tail.connect(sg); sg.connect(revIn); }
    const v = {
      t, out, end: t, last: null,
      track(src, t1) { src.stop(t1); if (t1 >= v.end) { v.end = t1; v.last = src; } return src; },
      finish() {
        voices.push(v.end);
        if (v.last) v.last.onended = () => { try { out.disconnect(); if (pn) pn.disconnect(); if (sg) sg.disconnect(); } catch (e) { /* */ } };
      },
    };
    return v;
  }
  function burst(v, t0, o) {
    const s = nsrc(o.kind || 'white', o.rate || 1);
    const f = bq(o.type || 'bandpass', o.f, o.Q == null ? 1 : o.Q);
    const end = t0 + o.a + o.d;
    if (o.f1) { f.frequency.setValueAtTime(o.f, t0); f.frequency.exponentialRampToValueAtTime(o.f1, end); }
    const g = gain(0); env(g.gain, t0, o.a, o.peak, o.d);
    chain(s, f, g, o.dest || v.out);
    startN(s, t0); v.track(s, end + 0.03);
    return f;
  }
  function tone(v, t0, o) {
    const s = ctx.createOscillator(); s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.f, t0);
    if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.glide || o.a + o.d));
    const g = gain(0); const end = env(g.gain, t0, o.a, o.peak, o.d);
    let n = chain(s, g);
    if (o.lp) n = chain(n, bq('lowpass', o.lp, 0.7));
    n.connect(o.dest || v.out);
    s.start(t0); v.track(s, end + 0.03);
    return s;
  }
  function lfo(v, t0, t1, hz, depth, param) {
    const o = ctx.createOscillator(); o.frequency.value = hz;
    chain(o, gain(depth), param);
    o.start(t0); v.track(o, t1);
  }
  // many tiny noise clicks through one source + one gain (sorted, non-overlapping)
  function grains(v, list, o) {
    list.sort((a, b) => a[0] - b[0]);
    const s = nsrc(o.kind || 'white');
    const f = bq(o.type || 'bandpass', o.f, o.Q == null ? 1 : o.Q);
    const g = gain(0);
    chain(s, f, g, o.dest || v.out);
    let last = 0;
    const t0 = list.length ? list[0][0] : v.t;
    for (let i = 0; i < list.length; i++) {
      const tt = Math.max(list[i][0], last), de = list[i][2] || o.dec || 0.004;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(list[i][1], tt + o.att);
      g.gain.linearRampToValueAtTime(0, tt + o.att + de);
      last = tt + o.att + de;
    }
    startN(s, t0); v.track(s, Math.max(last, t0) + 0.03);
    return f;
  }
  function bubble(v, t, f, peak, d = 0.06) {
    tone(v, t, { f, f1: f * rnd(1.6, 2.3), glide: 0.035, a: 0.0015, peak, d });
  }

  const HIGH = [2093, 2349.3, 2637, 3136, 3520, 4186, 4698.6, 5274];

  // -------------------------------------------------------------- recipes
  const R = {
    puff(v, t, p) {
      burst(v, t, { type: 'lowpass', f: 1500 * p, f1: 280 * p, Q: 0.6, a: 0.012, peak: 0.6, d: 0.36, kind: 'pink' });
      burst(v, t + 0.01, { f: 700 * p, Q: 0.7, a: 0.04, peak: 0.22, d: 0.42 });
      tone(v, t, { f: 120 * p, f1: 55 * p, glide: 0.08, a: 0.004, peak: 0.2, d: 0.12 });
    },
    puffBig(v, t, p) {
      burst(v, t, { type: 'lowpass', f: 1100 * p, f1: 200 * p, Q: 0.6, a: 0.02, peak: 0.85, d: 0.7, kind: 'pink' });
      burst(v, t + 0.02, { f: 500 * p, Q: 0.6, a: 0.06, peak: 0.3, d: 0.8 });
      burst(v, t, { type: 'highpass', f: 2500, a: 0.01, peak: 0.06, d: 0.15 });
      tone(v, t, { f: 85 * p, f1: 40 * p, glide: 0.12, a: 0.005, peak: 0.38, d: 0.22 });
    },
    sand(v, t, p) {
      const a = [], b = [];
      const n = 55 + ((Math.random() * 20) | 0);
      for (let i = 0; i < n; i++) {
        const tt = t + 0.65 * Math.pow(Math.random(), 1.5);
        a.push([tt, rnd(0.08, 0.4) * (1 - (tt - t) / 0.75), rnd(0.002, 0.006)]);
      }
      for (let i = 0; i < 16; i++) {
        const tt = t + 0.5 * Math.pow(Math.random(), 1.4);
        b.push([tt, rnd(0.08, 0.22) * (1 - (tt - t) / 0.6), rnd(0.004, 0.008)]);
      }
      grains(v, a, { f: 4200 * p, Q: 0.6, att: 0.0004 });
      grains(v, b, { f: 1800 * p, Q: 1.2, att: 0.0006 });
      burst(v, t, { type: 'highpass', f: 5000, a: 0.06, peak: 0.035, d: 0.55 });
    },
    hop(v, t, p) {
      tone(v, t, { f: 220 * p, f1: 120 * p, glide: 0.03, a: 0.002, peak: 0.45, d: 0.07 });
      burst(v, t, { f: 1500 * p, Q: 1.2, a: 0.001, peak: 0.25, d: 0.025 });
      burst(v, t, { type: 'lowpass', f: 400, a: 0.002, peak: 0.15, d: 0.04, kind: 'pink' });
    },
    thud(v, t, p) {
      tone(v, t, { f: 125 * p, f1: 55 * p, glide: 0.07, a: 0.003, peak: 0.55, d: 0.2 });
      burst(v, t, { type: 'lowpass', f: 600 * p, Q: 0.7, a: 0.003, peak: 0.4, d: 0.14, kind: 'pink' });
      burst(v, t, { f: 380 * p, Q: 4, a: 0.002, peak: 0.35, d: 0.09 });
    },
    squeak(v, t, p) {
      const f = 900 * p * rnd(0.92, 1.08), dur = rnd(0.16, 0.24), end = t + dur + 0.05;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f * 0.82, t);
      o.frequency.linearRampToValueAtTime(f * 1.12, t + dur * 0.45);
      o.frequency.linearRampToValueAtTime(f * 0.97, t + dur);
      const rate = rnd(24, 34);
      lfo(v, t, end, rate, f * 0.03, o.frequency);
      const am = gain(0.75); lfo(v, t, end, rate, 0.25, am.gain);
      const g = gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.linearRampToValueAtTime(0.13, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
      chain(o, am, bq('lowpass', 2800, 0.7), g, v.out);
      o.start(t); v.track(o, end);
      burst(v, t, { f: 2400, Q: 2, a: 0.005, peak: 0.04, d: 0.1 });
    },
    drip(v, t, p) {
      const f = rnd(750, 1050) * p;
      tone(v, t, { f, f1: f * rnd(1.9, 2.5), glide: 0.045, a: 0.0015, peak: 0.38, d: 0.1 });
      burst(v, t, { type: 'highpass', f: 3500, a: 0.0005, peak: 0.06, d: 0.008 });
      if (Math.random() < 0.6) bubble(v, t + rnd(0.06, 0.09), f * 1.6, 0.06, 0.05);
    },
    dripDry(v, t, p) {
      burst(v, t, { f: 2000 * p, Q: 2.5, a: 0.0005, peak: 0.35, d: 0.02 });
      tone(v, t, { f: 1300 * p, f1: 800 * p, glide: 0.02, a: 0.0008, peak: 0.06, d: 0.03 });
      burst(v, t, { type: 'lowpass', f: 500, a: 0.001, peak: 0.12, d: 0.025 });
    },
    plip(v, t, p) {
      const f = 560 * p;
      tone(v, t, { f, f1: f * 1.7, glide: 0.035, a: 0.002, peak: 0.28, d: 0.085 });
      tone(v, t + 0.035, { f: f * 1.25, f1: f * 2, glide: 0.025, a: 0.001, peak: 0.07, d: 0.05 });
      burst(v, t, { type: 'lowpass', f: 900, a: 0.002, peak: 0.07, d: 0.03, kind: 'pink' });
    },
    splash(v, t, p) {
      burst(v, t, { f: 1500 * p, f1: 2600 * p, Q: 0.6, a: 0.006, peak: 0.5, d: 0.32 });
      burst(v, t + 0.004, { type: 'highpass', f: 3500, a: 0.004, peak: 0.18, d: 0.2 });
      burst(v, t, { type: 'lowpass', f: 500 * p, a: 0.004, peak: 0.3, d: 0.12, kind: 'pink' });
      const nb = 3 + ((Math.random() * 2) | 0);
      for (let i = 0; i < nb; i++) bubble(v, t + rnd(0.06, 0.32), rnd(600, 1300) * p, rnd(0.05, 0.12));
      const g = [];
      for (let i = 0; i < 12; i++) { const tt = t + rnd(0.08, 0.45); g.push([tt, rnd(0.05, 0.2) * (1 - (tt - t) / 0.55), rnd(0.002, 0.005)]); }
      grains(v, g, { type: 'highpass', f: 3000, att: 0.0005 });
    },
    splashBig(v, t, p) {
      burst(v, t, { type: 'lowpass', f: 750 * p, f1: 250 * p, Q: 0.8, a: 0.008, peak: 0.75, d: 0.38, kind: 'pink' });
      tone(v, t, { f: 140 * p, f1: 60 * p, glide: 0.12, a: 0.005, peak: 0.4, d: 0.2 });
      burst(v, t + 0.01, { f: 2400 * p, f1: 1600 * p, Q: 0.5, a: 0.02, peak: 0.38, d: 0.5 });
      burst(v, t + 0.01, { type: 'highpass', f: 4000, a: 0.01, peak: 0.12, d: 0.3 });
      const g = [];
      for (let i = 0; i < 30; i++) { const tt = t + 0.1 + 0.6 * Math.pow(Math.random(), 1.3); g.push([tt, rnd(0.05, 0.22) * (1 - (tt - t) / 0.8), rnd(0.002, 0.006)]); }
      grains(v, g, { type: 'highpass', f: 2800, att: 0.0005 });
      for (let i = 0; i < 10; i++) { const tt = t + 0.25 + 0.85 * Math.pow(Math.random(), 1.4); bubble(v, tt, rnd(350, 1100) * p, rnd(0.05, 0.14) * (1 - (tt - t) / 1.4), rnd(0.05, 0.1)); }
    },
    burp(v, t, p) {
      const f = 135 * p;
      tone(v, t, { type: 'triangle', f, f1: f * 1.9, glide: 0.1, a: 0.008, peak: 0.5, d: 0.13, lp: 700 });
      tone(v, t, { f, f1: f * 1.9, glide: 0.1, a: 0.008, peak: 0.3, d: 0.13 });
      tone(v, t + 0.11, { type: 'triangle', f: f * 1.4, f1: f * 3, glide: 0.08, a: 0.005, peak: 0.42, d: 0.15, lp: 900 });
      burst(v, t + 0.1, { type: 'lowpass', f: 600, a: 0.005, peak: 0.12, d: 0.12, kind: 'pink' });
      bubble(v, t + rnd(0.22, 0.28), rnd(650, 800) * p, 0.07);
      if (Math.random() < 0.6) bubble(v, t + rnd(0.3, 0.38), rnd(800, 1000) * p, 0.05);
    },
    pop(v, t, p) {
      const f = rnd(1700, 2400) * p;
      tone(v, t, { f, f1: f * 1.4, glide: 0.012, a: 0.0005, peak: 0.2, d: 0.035 });
      burst(v, t, { type: 'highpass', f: 4500, a: 0.0003, peak: 0.22, d: 0.006 });
    },
    slosh(v, t, p) {
      const s = nsrc('pink'); const f = bq('bandpass', 400 * p, 1.1);
      const fr = f.frequency;
      fr.setValueAtTime(380 * p, t); fr.linearRampToValueAtTime(1100 * p, t + 0.16); fr.linearRampToValueAtTime(450 * p, t + 0.36);
      fr.linearRampToValueAtTime(950 * p, t + 0.52); fr.linearRampToValueAtTime(320 * p, t + 0.8);
      const g = gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.08); g.gain.linearRampToValueAtTime(0.35, t + 0.4);
      g.gain.linearRampToValueAtTime(0.42, t + 0.5); g.gain.setTargetAtTime(0, t + 0.55, 0.1);
      chain(s, f, g, v.out); startN(s, t); v.track(s, t + 1.1);
      burst(v, t, { type: 'lowpass', f: 280, a: 0.06, peak: 0.3, d: 0.6, kind: 'pink' });
      burst(v, t + 0.05, { type: 'highpass', f: 3000, a: 0.05, peak: 0.05, d: 0.5 });
      bubble(v, t + rnd(0.15, 0.3), rnd(400, 600) * p, 0.08, 0.07);
      bubble(v, t + rnd(0.4, 0.6), rnd(450, 700) * p, 0.06, 0.07);
    },
    clatter(v, t, p) {
      const T = [0, 0.15, 0.26, 0.33, 0.37], A = [1, 0.75, 0.55, 0.35, 0.2];
      for (let i = 0; i < T.length; i++) {
        const tt = t + T[i] * rnd(0.92, 1.08), a = A[i], q = p * rnd(0.96, 1.04);
        burst(v, tt, { f: 720 * q, Q: 5, a: 0.001, peak: 0.55 * a, d: 0.06 });
        tone(v, tt, { f: 240 * q, f1: 190 * q, glide: 0.03, a: 0.001, peak: 0.28 * a, d: 0.07 });
        burst(v, tt, { type: 'highpass', f: 3200, a: 0.0005, peak: 0.12 * a, d: 0.008 });
      }
    },
    clack(v, t, p) {
      const click = (tt, a) => {
        burst(v, tt, { f: 2600 * p, Q: 3, a: 0.0005, peak: 0.4 * a, d: 0.02 });
        tone(v, tt, { f: 1700 * p, a: 0.0005, peak: 0.1 * a, d: 0.03 });
        burst(v, tt, { f: 650 * p, Q: 4, a: 0.001, peak: 0.25 * a, d: 0.045 });
      };
      click(t, 0.55); click(t + rnd(0.04, 0.055), 1);
    },
    lidOpen(v, t, p) {
      tone(v, t, { f: 360 * p, f1: 820 * p, glide: 0.025, a: 0.001, peak: 0.32, d: 0.06 });
      burst(v, t, { f: 2200 * p, Q: 2, a: 0.0005, peak: 0.25, d: 0.012 });
      burst(v, t, { f: 700 * p, Q: 4, a: 0.001, peak: 0.18, d: 0.05 });
    },
    snap(v, t, p) {
      burst(v, t, { f: 3300 * p, Q: 1.5, a: 0.0004, peak: 0.55, d: 0.014 });
      burst(v, t + 0.007, { f: 3000 * p, Q: 1.5, a: 0.0004, peak: 0.3, d: 0.01 });
      tone(v, t, { f: 2100 * p, a: 0.0005, peak: 0.12, d: 0.06 });
      tone(v, t, { f: 3350 * p, a: 0.0005, peak: 0.06, d: 0.035 });
      burst(v, t, { f: 950 * p, Q: 5, a: 0.001, peak: 0.22, d: 0.035 });
    },
    unsnap(v, t, p) {
      burst(v, t, { f: 2500 * p, Q: 1.5, a: 0.0005, peak: 0.3, d: 0.012 });
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(480 * p, t); o.frequency.exponentialRampToValueAtTime(400 * p, t + 0.3);
      lfo(v, t, t + 0.4, 10, 10 * p, o.frequency);
      const g = gain(0); env(g.gain, t, 0.002, 0.13, 0.32);
      chain(o, bq('lowpass', 1800, 0.7), g, v.out);
      o.start(t); v.track(o, t + 0.4);
      tone(v, t, { f: 1290 * p, a: 0.001, peak: 0.03, d: 0.08 });
    },
    knock(v, t, p) {
      tone(v, t, { f: 300 * p, f1: 210 * p, glide: 0.04, a: 0.001, peak: 0.45, d: 0.085 });
      burst(v, t, { f: 1100 * p, Q: 2.5, a: 0.0005, peak: 0.3, d: 0.03 });
      tone(v, t, { f: 140 * p, a: 0.002, peak: 0.18, d: 0.06 });
      burst(v, t + 0.022, { f: 1100 * p, Q: 2.5, a: 0.0005, peak: 0.1, d: 0.02 });
    },
    sparkle(v, t, p) {
      const n = Math.random() < 0.5 ? 2 : 3;
      let idx = (Math.random() * 4) | 0, tt = t;
      for (let k = 0; k < n; k++) {
        const f = HIGH[Math.min(idx, HIGH.length - 1)] * p;
        tone(v, tt, { f, a: 0.002, peak: 0.07 * (1 - k * 0.15), d: 0.7 });
        if (f * 2.76 < 15000) tone(v, tt, { f: f * 2.76, a: 0.001, peak: 0.02, d: 0.22 });
        idx += 1 + ((Math.random() * 2) | 0); tt += rnd(0.04, 0.07);
      }
    },
    sparkleBig(v, t, p) {
      const H2 = [1568, 1760, 2093, 2349.3, 2637, 3136, 3520, 4186, 4698.6];
      const seq = [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 8];
      for (let k = 0; k < seq.length; k++) {
        const tt = t + k * 0.085 + rnd(0, 0.015), f = H2[seq[k]] * p;
        const pk = 0.06 * (k < 4 ? 0.5 + k * 0.12 : 1) * (1 - k / 26);
        tone(v, tt, { f, a: 0.002, peak: pk, d: 0.8 });
        if (f * 2.76 < 15000) tone(v, tt, { f: f * 2.76, a: 0.001, peak: pk * 0.25, d: 0.2 });
      }
      burst(v, t, { type: 'highpass', f: 7000, a: 0.5, peak: 0.025, d: 1.3 });
      tone(v, t, { f: 523.25 * p, a: 0.3, peak: 0.04, d: 1.6 });
      tone(v, t, { f: 784 * p, a: 0.35, peak: 0.03, d: 1.5 });
    },
    whoosh(v, t, p) {
      const s = nsrc('pink'); const f = bq('bandpass', 350 * p, 0.9);
      f.frequency.setValueAtTime(350 * p, t); f.frequency.exponentialRampToValueAtTime(1400 * p, t + 0.24);
      f.frequency.exponentialRampToValueAtTime(500 * p, t + 0.55);
      const g = gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.22); g.gain.setTargetAtTime(0, t + 0.26, 0.09);
      chain(s, f, g, v.out); startN(s, t); v.track(s, t + 0.8);
    },
    zip(v, t, p) {
      const dur = 0.22 * rnd(0.9, 1.1), list = [];
      for (let tt = t; tt < t + dur;) {
        const k = (tt - t) / dur;
        list.push([tt, rnd(0.2, 0.32) * (0.7 + 0.5 * k) * (k > 0.85 ? (1 - k) / 0.15 : 1), 0.005]);
        tt += (0.013 - 0.007 * k) * rnd(0.85, 1.15);
      }
      const f = grains(v, list, { f: 1500 * p, Q: 1.4, att: 0.001 });
      f.frequency.setValueAtTime(1500 * p, t); f.frequency.linearRampToValueAtTime(2900 * p, t + dur);
      burst(v, t, { f: 1600 * p, f1: 2600 * p, Q: 0.8, a: 0.03, peak: 0.1, d: 0.2 });
    },
    soapSlip(v, t, p) {
      const f0 = 650 * p, end = t + 0.36;
      const mk = (type, pk) => {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.7, t + 0.12);
        o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.22);
        lfo(v, t, end, 32, 35 * p, o.frequency);
        const g = gain(0);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.015);
        g.gain.linearRampToValueAtTime(pk * 0.8, t + 0.14); g.gain.setTargetAtTime(0, t + 0.17, 0.03);
        chain(o, g, v.out); o.start(t); v.track(o, end);
      };
      mk('sine', 0.17); mk('triangle', 0.04);
      burst(v, t, { f: 2800, Q: 0.8, a: 0.02, peak: 0.1, d: 0.22 });
    },
    chime(v, t, p) {
      const f = pick([1046.5, 1174.7, 1318.5, 1568, 1760]) * p;
      const P = [[1, 0.11, 2.8], [1.0032, 0.05, 2.3], [2.756, 0.045, 0.9], [5.404, 0.02, 0.35], [8.933, 0.01, 0.15]];
      const strike = (tt, a) => {
        burst(v, tt, { type: 'highpass', f: 5000, a: 0.0005, peak: 0.07 * a, d: 0.012 });
        for (const [r, pk, d] of P) if (f * r < 15000) tone(v, tt, { f: f * r, a: 0.002, peak: pk * a, d: d * (0.6 + 0.4 * a) });
      };
      strike(t, 1);
      if (Math.random() < 0.7) strike(t + rnd(0.12, 0.25), 0.45);
    },
    rattle(v, t, p) {
      const T = [0, rnd(0.012, 0.02), rnd(0.03, 0.045)], A = [1, 0.7, 0.45];
      for (let i = 0; i < 3; i++) {
        const tt = t + T[i];
        burst(v, tt, { f: 1300 * p * rnd(0.9, 1.1), Q: 4, a: 0.0005, peak: 0.32 * A[i], d: 0.022 });
        burst(v, tt, { type: 'highpass', f: 3500, a: 0.0003, peak: 0.08 * A[i], d: 0.006 });
      }
      tone(v, t, { f: 150 * p, f1: 100 * p, glide: 0.03, a: 0.002, peak: 0.22, d: 0.05 });
    },
  };

  function fire(name, t, o) {
    const fn = R[name];
    if (!fn) return;
    const now = ctx.currentTime;
    if (voices.length >= MAX_VOICES) {
      voices = voices.filter((e) => e > now);
      if (voices.length >= MAX_VOICES) return;
    }
    const p = clamp((o && o.pitch > 0 ? o.pitch : 1) * rnd(0.95, 1.05), 0.25, 4);
    const g = (o && o.gain != null ? Math.max(0, o.gain) : 1) * (LEVEL[name] || 1);
    const v = mkV(t, g, o && o.pan, SEND[name] != null ? SEND[name] : 0.12);
    fn(v, t, p);
    v.finish();
  }

  // ----------------------------------------------------------------- loops
  function sp(param, val, tc = 0.025) {
    const l = lastSet.get(param);
    if (l !== undefined && Math.abs(l - val) < 1e-4 * Math.max(1, Math.abs(val))) return;
    lastSet.set(param, val);
    param.setTargetAtTime(val, ctx.currentTime, tc);
  }
  function lnoise(L, kind, rate = 1) {
    const s = nsrc(kind, rate * rnd(0.97, 1.03)); startN(s, ctx.currentTime); L.srcs.push(s); return s;
  }
  // gain node 1 + slow random modulations (list of [hz, depth])
  function trem(L, mods) {
    const g = gain(1);
    for (const [hz, depth] of mods) {
      const s = nsrc('white', hz / ctx.sampleRate); startN(s, ctx.currentTime); L.srcs.push(s);
      let n = s;
      if (hz >= 1) n = chain(s, bq('lowpass', hz, 0.5));
      chain(n, gain(depth), g.gain);
    }
    return g;
  }
  function spiker(L, ins) {
    const g = gain(0); g.connect(L.out);
    const k = { g, last: 0, hit(t, amp, att, dec) {
      t = Math.max(t, k.last);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + att); g.gain.linearRampToValueAtTime(0, t + att + dec);
      k.last = t + att + dec;
    } };
    for (const n of ins) n.connect(g);
    return k;
  }
  function gen(L, rate, emit, periodic) { L.gens.push({ cursor: 0, rate, emit, periodic: !!periodic }); }
  const egap = (r) => Math.max(0.002, -Math.log(1 - Math.random()) / r);

  const B = {
    ambience(L) {
      const lp = bq('lowpass', 650, 0.5), hp = bq('highpass', 90, 0.5);
      const g = gain(0);
      chain(lnoise(L, 'pink'), lp, hp, trem(L, [[0.07, 0.45], [0.19, 0.3]]), g, L.out);
      const g2 = gain(0);
      chain(lnoise(L, 'white'), bq('bandpass', 5000, 0.5), trem(L, [[0.4, 0.7], [2.5, 0.35]]), g2, L.out);
      L.set = (v) => { sp(g.gain, v * 0.06, 0.3); sp(g2.gain, v * 0.006, 0.3); };
    },
    stream(L) {
      const W = lnoise(L, 'white');
      const bpS = bq('bandpass', 2400, 0.8), gS = gain(0);
      chain(W, bpS, trem(L, [[35, 0.6], [7, 0.3]]), gS, L.out);
      const gH = gain(0), trH = trem(L, [[20, 0.5]]);
      chain(W, bq('bandpass', 480, 7), trH); chain(W, bq('bandpass', 1150, 7), trH); chain(trH, gH, L.out);
      const bpF = bq('bandpass', 300, 10), bpF2 = bq('bandpass', 600, 12), trF = trem(L, [[9, 0.5], [3, 0.3]]), gF = gain(0);
      chain(W, bpF, trF); chain(W, bpF2, gain(0.5), trF); chain(trF, gF, L.out);
      const gB = gain(0);
      chain(lnoise(L, 'pink'), bq('lowpass', 320, 0.7), gB, L.out);
      const sOf = (f) => sstep(0.08, 0.35, f) * (0.45 + 0.55 * f);
      L.set = (f, b) => {
        const s = sOf(f);
        sp(bpS.frequency, 2600 - 1300 * b);
        sp(gS.gain, s * (0.32 - 0.14 * b));
        sp(gH.gain, s * (1 - b) * (1 - b) * 1.6);
        const fc = 260 + 640 * Math.pow(b, 0.8);
        sp(bpF.frequency, fc, 0.08); sp(bpF2.frequency, fc * 2.03, 0.08);
        sp(gF.gain, s * sstep(0.02, 0.25, b) * 2.6);
        sp(gB.gain, s * (0.12 + 0.3 * b));
      };
      gen(L, () => { const f = L.v; return f > 0.005 && f < 0.35 ? (3 + 22 * f) * (1 - sstep(0.15, 0.35, f)) : 0; }, (t) => {
        if (L.p < 0.04) fire('dripDry', t, { gain: 0.5, pitch: 0.7 * rnd(0.85, 1.2) });
        else fire('drip', t, { gain: 0.5, pitch: (1.1 - 0.4 * L.p) * rnd(0.85, 1.15) });
      });
      gen(L, () => sOf(L.v) * L.p * 5, (t) => fire('plip', t, { gain: 0.15 * sOf(L.v), pitch: rnd(0.6, 1.1) }));
    },
    overflow(L) {
      const W = lnoise(L, 'white');
      const g1 = gain(0), g2 = gain(0), g3 = gain(0);
      chain(W, bq('bandpass', 1300, 0.7), trem(L, [[18, 0.6], [4, 0.3]]), g1, L.out);
      chain(W, bq('highpass', 3800, 0.7), trem(L, [[9, 0.5]]), g2, L.out);
      chain(lnoise(L, 'pink'), bq('lowpass', 450, 0.7), g3, L.out);
      L.set = (r) => { sp(g1.gain, r * 0.22); sp(g2.gain, r * 0.06); sp(g3.gain, r * 0.25); };
      gen(L, () => 5 * L.v, (t) => fire('dripDry', t, { gain: 0.3, pitch: rnd(0.8, 1.3) }));
    },
    scrub(L) {
      const W = lnoise(L, 'white');
      const bpD = bq('bandpass', 1200, 1.1), gD = gain(0);
      chain(W, bpD, trem(L, [[60, 0.5], [13, 0.3]]), gD, L.out);
      const gBody = gain(0);
      chain(W, bq('bandpass', 350, 1.5), gBody, L.out);
      const gSo = gain(0);
      chain(W, bq('highpass', 3000, 0.7), bq('lowpass', 9000, 0.7), trem(L, [[30, 0.4]]), gSo, L.out);
      const crk = spiker(L, [chain(W, bq('highpass', 5000, 0.7))]);
      L.set = (s, soap) => {
        sp(bpD.frequency, 900 + 1400 * s);
        sp(gD.gain, Math.pow(s, 1.3) * 0.55 * (1 - 0.7 * soap));
        sp(gBody.gain, s * 0.35 * (1 - 0.5 * soap));
        sp(gSo.gain, s * soap * 0.25);
      };
      gen(L, () => L.p * (L.v > 0.02 ? 5 + 60 * L.v : 0), (t) => crk.hit(t, rnd(0.05, 0.15) * L.p, 0.0004, rnd(0.002, 0.005)));
    },
    fizz(L) {
      const W = lnoise(L, 'white'), g1 = gain(0);
      chain(W, bq('highpass', 4500, 0.7), bq('lowpass', 11000, 0.7), trem(L, [[14, 0.7], [3, 0.4]]), g1, L.out);
      const k1 = spiker(L, [chain(W, bq('bandpass', 6500, 1))]);
      const k2 = spiker(L, [chain(W, bq('bandpass', 3000, 7))]);
      L.set = (a) => sp(g1.gain, a * 0.05);
      gen(L, () => (L.v > 0.01 ? 15 + 110 * L.v : 0), (t) => k1.hit(t, rnd(0.03, 0.12) * Math.sqrt(L.v), 0.0004, rnd(0.002, 0.006)));
      gen(L, () => (L.v > 0.01 ? 2 + 12 * L.v : 0), (t) => k2.hit(t, rnd(0.15, 0.45) * Math.sqrt(L.v), 0.0005, 0.01));
    },
    pour(L) {
      const g1 = gain(0), g2 = gain(0), g3 = gain(0);
      chain(lnoise(L, 'pink'), bq('lowpass', 1400, 0.6), trem(L, [[5, 0.5], [17, 0.35]]), g1, L.out);
      chain(lnoise(L, 'white'), bq('highpass', 2400, 0.7), trem(L, [[11, 0.5]]), g2, L.out);
      chain(lnoise(L, 'brown'), bq('lowpass', 200, 0.7), trem(L, [[3, 0.4]]), g3, L.out);
      L.set = (r) => { sp(g1.gain, r * 0.55); sp(g2.gain, r * 0.12); sp(g3.gain, r * 0.6); };
    },
    spin(L) {
      const now = ctx.currentTime;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 45;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 90;
      const lp = bq('lowpass', 300, 3), wob = gain(1), gW = gain(0);
      chain(o1, gain(0.6), lp); chain(o2, gain(0.25), lp);
      chain(lp, trem(L, [[30, 0.4], [11, 0.3]]), gW, wob);
      o1.start(now); o2.start(now); L.srcs.push(o1, o2);
      const W = lnoise(L, 'white');
      const bpA = bq('bandpass', 300, 1.4), gA = gain(0);
      chain(W, bpA, gA, wob);
      const gWet = gain(0);
      chain(W, bq('bandpass', 2200, 0.7), trem(L, [[45, 0.8], [12, 0.4]]), gWet, wob);
      wob.connect(L.out);
      const lf = ctx.createOscillator(); lf.frequency.value = 1; const lfG = gain(0);
      chain(lf, lfG, wob.gain); lf.start(now); L.srcs.push(lf);
      const tick = spiker(L, [chain(W, bq('bandpass', 2600, 4)), chain(W, bq('bandpass', 1000, 6), gain(0.8))]);
      L.set = (v, wet) => {
        const f = 42 + 120 * v;
        sp(o1.frequency, f); sp(o2.frequency, f * 2.013);
        sp(lp.frequency, 250 + 2600 * Math.pow(v, 1.2));
        sp(gW.gain, sstep(0, 0.15, v) * (0.1 + 0.1 * v));
        sp(gA.gain, Math.pow(v, 1.5) * 0.5);
        sp(gWet.gain, wet * v * 0.35);
        sp(lf.frequency, 0.4 + 7 * v); sp(lfG.gain, 0.25 * sstep(0, 0.2, v));
      };
      gen(L, () => (L.v > 0.01 ? 2 + 20 * L.v : 0), (t) => tick.hit(t, 0.5 * (1 - 0.65 * L.v) * rnd(0.8, 1.1), 0.0008, 0.014), true);
    },
    spout(L) {
      const W = lnoise(L, 'white'), g1 = gain(0), g2 = gain(0), tr = trem(L, [[28, 0.6], [6, 0.4]]);
      chain(W, bq('bandpass', 3000, 1.1), tr); chain(tr, g1, L.out);
      chain(W, bq('bandpass', 1000, 1), trem(L, [[15, 0.5]]), g2, L.out);
      L.set = (f) => { const s = sstep(0.06, 0.3, f) * f; sp(g1.gain, s * 0.2); sp(g2.gain, s * 0.07); };
      gen(L, () => { const f = L.v; return f > 0.005 && f < 0.3 ? (2 + 15 * f) * (1 - sstep(0.12, 0.3, f)) : 0; },
        (t) => fire('dripDry', t, { gain: 0.4, pitch: rnd(0.85, 1.25) }));
    },
    night(L) {
      const g = gain(0), g2 = gain(0);
      chain(lnoise(L, 'brown'), bq('lowpass', 280, 0.5), trem(L, [[0.05, 0.5], [0.13, 0.3]]), g, L.out);
      chain(lnoise(L, 'pink'), bq('bandpass', 1200, 0.5), g2, L.out);
      L.set = (v) => { sp(g.gain, v * 0.03, 0.3); sp(g2.gain, v * 0.003, 0.3); };
      gen(L, () => (L.v > 0.01 ? 1 / 11 : 0), (t) => {
        const f = pick([196, 220, 261.6, 293.7, 329.6]);
        const o = ctx.createOscillator(); o.frequency.value = f;
        const o2 = ctx.createOscillator(); o2.frequency.value = f * 2.003;
        const ge = gain(0), lp = bq('lowpass', 900, 0.5);
        ge.gain.setValueAtTime(0, t); ge.gain.linearRampToValueAtTime(0.02 * L.v, t + 2.5); ge.gain.setTargetAtTime(0, t + 2.5, 1.2);
        chain(o, ge); chain(o2, gain(0.3), ge); chain(ge, lp, L.out);
        o.start(t); o2.start(t); o.stop(t + 8); o2.stop(t + 8);
      });
      L.sendAmt = 0.7;
    },
  };

  function getLoop(name) {
    let L = loops[name];
    if (L) return L;
    if (!B[name]) return null;
    L = { name, out: gain(LOOP_LEVEL[name] || 1), srcs: [], gens: [], v: 0, p: 0, lastOn: ctx.currentTime, set: () => {}, sendAmt: 0.1 };
    B[name](L);
    L.out.connect(dry);
    if (L.sendAmt > 0) { L.send = gain(L.sendAmt); L.out.connect(L.send); L.send.connect(revIn); }
    loops[name] = L;
    return L;
  }
  function killLoop(L) {
    const now = ctx.currentTime;
    L.out.gain.setTargetAtTime(0, now, 0.02);
    for (const s of L.srcs) { try { s.stop(now + 0.2); } catch (e) { /* */ } }
    if (L.srcs[0]) L.srcs[0].onended = () => { try { L.out.disconnect(); } catch (e) { /* */ } };
    delete loops[L.name];
  }
  function tickLoops() {
    const now = ctx.currentTime, start = now + 0.03, until = now + HORIZON;
    for (const k in loops) {
      const L = loops[k];
      if (!offline && L.v <= 0.0005 && now - L.lastOn > 2.5) { killLoop(L); continue; }
      for (const g of L.gens) {
        const r = g.rate();
        if (!(r > 0.05)) { g.cursor = 0; continue; }
        if (g.cursor < start || g.cursor > start + HORIZON + 2 / r) g.cursor = start + (g.periodic ? 0 : egap(r) * 0.5);
        let n = 0;
        while (g.cursor < until && n++ < 400) {
          g.emit(g.cursor);
          g.cursor += g.periodic ? (1 / r) * rnd(0.92, 1.08) : egap(r);
        }
      }
    }
  }

  // ----------------------------------------------------------------- music
  function mbox(M, t, f, vel) {
    const dl = 2.2 * Math.pow(523 / f, 0.3);
    const P = [[1, 1, dl], [2, 0.18, dl * 0.3], [3, 0.05, 0.25], [4.07, 0.07, 0.16]];
    for (const [r, pk, d] of P) {
      if (f * r > 15000) continue;
      const o = ctx.createOscillator(); o.frequency.value = f * r;
      const g = gain(0); env(g.gain, t, 0.004, pk * vel, d);
      chain(o, g, M.bus); o.start(t); o.stop(t + d + 0.1); M.srcs.push(o);
    }
    const s = nsrc('white'); const g = gain(0); env(g.gain, t, 0.0005, 0.05 * vel, 0.008);
    chain(s, bq('highpass', 6000, 0.7), g, M.bus); startN(s, t); s.stop(t + 0.05); M.srcs.push(s);
  }
  function mbass(M, t, f, vel) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g = gain(0); env(g.gain, t, 0.01, vel, 2.8);
    const g2 = gain(0); env(g2.gain, t, 0.008, vel * 0.22, 0.8);
    chain(o, g, M.bus); chain(o2, bq('lowpass', 700, 0.7), g2, M.bus);
    o.start(t); o2.start(t); o.stop(t + 3); o2.stop(t + 1); M.srcs.push(o, o2);
  }
  function music(name) {
    const now = ctx.currentTime;
    if (curMusic) {
      const M = curMusic; curMusic = null;
      M.bus.gain.cancelScheduledValues(now);
      M.bus.gain.setTargetAtTime(0, now, 0.12);
      for (const s of M.srcs) { try { s.stop(now + 0.7); } catch (e) { /* */ } }
    }
    if (name !== 'finale' && name !== 'morning') return;
    const bus = gain(0.55); bus.connect(dry);
    const sg = gain(0.4); bus.connect(sg); sg.connect(revIn);
    const M = { bus, srcs: [] };
    curMusic = M;
    const t0 = now + 0.06;
    const hum = () => rnd(-0.008, 0.008);
    if (name === 'morning') {
      mbox(M, t0, mtof(76), 0.15); mbox(M, t0 + 0.24, mtof(79), 0.16); mbox(M, t0 + 0.48, mtof(84), 0.17);
      mbass(M, t0, mtof(60), 0.08); mbass(M, t0 + 0.48, mtof(67), 0.05);
      return;
    }
    const q = 0.52;
    const mel = [
      [0, 67, 0.13], [1, 76, 0.15], [2, 74, 0.13],
      [3, 72, 0.14], [4, 74, 0.13], [5, 76, 0.15],
      [6, 79, 0.17], [8, 76, 0.14],
      [9, 74, 0.14], [10, 72, 0.13], [11, 69, 0.12],
      [12, 67, 0.12], [13, 69, 0.12], [14, 74, 0.13],
      [15, 72, 0.16], [16, 76, 0.07], [16.5, 79, 0.06], [17, 84, 0.06],
    ];
    const bass = [
      [0, 48, 0.1], [2, 55, 0.05], [3, 45, 0.1], [5, 52, 0.05], [6, 41, 0.11], [8, 48, 0.05],
      [9, 50, 0.1], [11, 57, 0.05], [12, 43, 0.1], [14, 50, 0.05], [15, 48, 0.12], [15, 55, 0.06], [16, 60, 0.05],
    ];
    for (const [b, m, v] of mel) mbox(M, t0 + b * q + hum(), mtof(m), v);
    for (const [b, m, v] of bass) mbass(M, t0 + b * q + hum(), mtof(m), v);
  }

  // ------------------------------------------------------------------- API
  function silentKick() {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { /* */ }
  }
  function fadeTo(v, tc) {
    const now = ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.setTargetAtTime(v, now, tc);
  }
  function tryResume() {
    try {
      if (offline || ctx.state === 'running') return;
      const pr = ctx.resume && ctx.resume();
      if (pr && pr.then) pr.then(() => { try { fadeTo(1, 0.03); } catch (e) { /* */ } }, () => {});
    } catch (e) { /* */ }
  }

  return {
    unlock() {
      try {
        if (!init()) return;
        unlocked = true;
        if (hiddenWanted) return;
        if (!offline && ctx.state !== 'running') { silentKick(); tryResume(); }
        fadeTo(1, 0.03);
      } catch (e) { /* */ }
    },
    suspend() {
      try {
        hiddenWanted = true;
        if (!ctx || offline) return;
        const tok = ++susTok;
        if (ctx.state !== 'running') { const pr = ctx.suspend(); if (pr && pr.catch) pr.catch(() => {}); return; }
        fadeTo(0, 0.012);
        const o = ctx.createOscillator(), g = gain(0);
        chain(o, g, ctx.destination);
        o.onended = () => {
          try { g.disconnect(); if (tok === susTok && hiddenWanted) { const pr = ctx.suspend(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) { /* */ }
        };
        o.start(); o.stop(ctx.currentTime + 0.08);
      } catch (e) { /* */ }
    },
    resume() {
      try {
        hiddenWanted = false; susTok++;
        if (!ctx || !unlocked) return;
        tryResume();
        fadeTo(1, 0.03);
      } catch (e) { /* */ }
    },
    play(name, opts) {
      try {
        if (!running() || !R[name]) return;
        const t = ctx.currentTime + 0.005 + Math.max(0, (opts && opts.delay) || 0);
        const lp = lastPlay[name];
        if (lp !== undefined && Math.abs(t - lp) < RATE_LIMIT) return;
        lastPlay[name] = t;
        fire(name, t, opts || {});
      } catch (e) { /* */ }
    },
    setLoop(name, value, param) {
      try {
        if (!running()) return;
        const v = clamp(+value || 0, 0, 1), p = clamp(+param || 0, 0, 1);
        if (!loops[name] && v <= 0.0005) return;
        const L = getLoop(name);
        if (!L) return;
        L.v = v; L.p = p;
        if (v > 0.0005) L.lastOn = ctx.currentTime;
        L.set(v, p);
      } catch (e) { /* */ }
    },
    music(name) {
      try { if (running()) music(name); } catch (e) { /* */ }
    },
    update(dt) { // eslint-disable-line no-unused-vars
      try { if (running()) tickLoops(); } catch (e) { /* */ }
    },
  };
}
