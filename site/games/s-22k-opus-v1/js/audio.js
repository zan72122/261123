/* audio.js — all sounds synthesized with Web Audio, started on first touch */
(function () {
  'use strict';
  const U = window.U;
  const A = (U.audio = {});
  let ctx = null, master = null, noiseBuf = null, verb = null;
  A.ready = false;
  const loops = {};

  A.start = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp);
    comp.connect(ctx.destination);
    // short room reverb
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5;
    }
    verb.buffer = ir;
    const vg = ctx.createGain();
    vg.gain.value = 0.18;
    verb.connect(vg);
    vg.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    if (ctx.state === 'suspended') ctx.resume();
    A.ready = true;
    A.ensureLoops();
  };

  function out(g, wet) {
    g.connect(master);
    if (wet) {
      const s = ctx.createGain();
      s.gain.value = wet;
      g.connect(s);
      s.connect(verb);
    }
  }
  function noiseSrc() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(type, f0, f1, dur, vol, wet, att) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, att || 0.004, vol, dur);
    o.connect(g);
    out(g, wet);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function burst(type, freq, q, dur, vol, wet, att, f1) {
    const t = ctx.currentTime;
    const s = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, att || 0.003, vol, dur);
    s.connect(f);
    f.connect(g);
    out(g, wet);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  // one-shot sounds. p: 0..1 intensity / pitch variation
  A.play = function (name, p = 0.5, q = 0) {
    if (!A.ready) return;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case 'clink': // ceramic touch
        tone('sine', 1900 + q * 400 + r(-60, 60), 1880, 0.35, 0.08 * (0.5 + p), 0.4);
        tone('sine', 3100 + r(-80, 80), 3050, 0.2, 0.03 * (0.5 + p), 0.3);
        break;
      case 'lacquer': // wooden lacquer bowl knock
        tone('sine', 420 + r(-20, 20), 380, 0.18, 0.12 * (0.4 + p), 0.25);
        burst('bandpass', 900, 3, 0.05, 0.05 * p, 0.1);
        break;
      case 'wood': // wood knock
        tone('triangle', 220 + q * 80 + r(-15, 15), 180, 0.12, 0.14 * (0.4 + p), 0.2);
        burst('bandpass', 1400, 4, 0.03, 0.06 * p, 0.1);
        break;
      case 'knife': // blade lands on wood through dough
        burst('bandpass', 2600, 2, 0.05, 0.08 * p, 0.15);
        tone('triangle', 160 + r(-10, 10), 120, 0.14, 0.18 * p, 0.2);
        break;
      case 'knifeAir': // blade on bare board
        burst('highpass', 3500, 1, 0.04, 0.07 * p, 0.2);
        tone('triangle', 250, 190, 0.1, 0.14 * p, 0.25);
        break;
      case 'squish': // wet dough, low and soft
        burst('lowpass', 500 + q * 300, 1.5, 0.16, 0.12 * p, 0.05, 0.02, 180);
        tone('sine', 140 + q * 40, 90, 0.18, 0.06 * p, 0.05, 0.02);
        break;
      case 'pat': // dough pat
        burst('lowpass', 700, 1, 0.09, 0.14 * p, 0.08, 0.005, 250);
        tone('sine', 110, 80, 0.1, 0.08 * p, 0.05);
        break;
      case 'grains': // dry flour scrape tick
        burst('highpass', 5000 + q * 2000, 0.7, 0.05, 0.035 * p, 0.05);
        break;
      case 'salt':
        for (let i = 0; i < 5; i++)
          setTimeout(() => A.ready && burst('bandpass', 6000 + Math.random() * 3000, 6, 0.02, 0.05 * p, 0.2), i * 35 + Math.random() * 30);
        break;
      case 'drip': // drop into liquid; q selects pitch family
        tone('sine', (q ? 1300 : 900) * (0.85 + p * 0.4), (q ? 2100 : 1500) * (0.85 + p * 0.4), 0.09, 0.07, 0.35, 0.002);
        break;
      case 'plop': // small object into soup
        tone('sine', 300 + p * 300, 700 + p * 400, 0.1, 0.09, 0.3);
        burst('lowpass', 900, 1, 0.08, 0.05, 0.1);
        break;
      case 'splash': {
        const v = U.clamp(p, 0.1, 1);
        burst('bandpass', 1200 + v * 1500, 0.8, 0.12 + v * 0.35, 0.09 + v * 0.2, 0.35, 0.005, 500);
        tone('sine', 220, 520, 0.12, 0.05 * v, 0.2);
        break;
      }
      case 'bubble':
        tone('sine', 200 + p * 500, 500 + p * 900, 0.05, 0.03 + q * 0.03, 0.25, 0.002);
        break;
      case 'pop': // dough leaving the bowl
        tone('sine', 180, 420, 0.12, 0.12 * p, 0.2, 0.01);
        burst('lowpass', 1200, 1, 0.06, 0.06 * p, 0.1);
        break;
      case 'thud': // dough lands on board
        tone('sine', 90, 55, 0.25, 0.22 * p, 0.15, 0.004);
        burst('lowpass', 400, 1, 0.12, 0.12 * p, 0.1);
        break;
      case 'tick': // negi ring tiny
        tone('sine', 2400 + r(-300, 300), 2200, 0.04, 0.03 * (0.4 + p), 0.25);
        break;
      case 'soft': // age landing
        burst('lowpass', 600, 1, 0.12, 0.1 * p, 0.15, 0.01, 200);
        break;
      case 'chime': // gentle reward, a small two-note wooden sound
        tone('sine', 660, 660, 0.5, 0.05, 0.5, 0.01);
        setTimeout(() => A.ready && tone('sine', 880, 880, 0.6, 0.045, 0.5, 0.01), 140);
        break;
      case 'slide':
        burst('bandpass', 700, 1.2, 0.3, 0.05 * p, 0.2, 0.05);
        break;
      case 'swish':
        burst('bandpass', 900, 0.7, 0.25, 0.05 * p, 0.15, 0.05, 2400);
        break;
    }
  };

  // ---- continuous loops: {gain, freq, q} smoothly set each frame ----
  function makeLoop(type, freq, q) {
    const s = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(f);
    f.connect(g);
    out(g, 0.15);
    s.start();
    return { f, g, target: 0, freq, q };
  }
  A.ensureLoops = function () {
    if (!ctx || loops.pour) return;
    loops.pour = makeLoop('bandpass', 1400, 1.2); // water stream
    loops.flour = makeLoop('bandpass', 3200, 0.6); // flour falling
    loops.rub = makeLoop('highpass', 4500, 0.5); // dry rubbing
    loops.roll = makeLoop('bandpass', 260, 1.4); // rolling pin
    loops.boil = makeLoop('lowpass', 380, 0.8); // pot simmer bed
    loops.stir = makeLoop('lowpass', 520, 1.0); // wet dough moving
  };
  A.loop = function (name, gain, freq, q) {
    const l = loops[name];
    if (!l) return;
    const t = ctx.currentTime;
    l.g.gain.setTargetAtTime(Math.max(0, gain), t, 0.06);
    if (freq) l.f.frequency.setTargetAtTime(freq, t, 0.08);
    if (q) l.f.Q.setTargetAtTime(q, t, 0.1);
  };

  // ambient bubbling scheduler
  let bubbleT = 0;
  A.boilLevel = 1;
  A.update = function (dt) {
    if (!A.ready) return;
    bubbleT -= dt;
    if (bubbleT <= 0) {
      bubbleT = 0.08 + Math.random() * 0.35;
      A.play('bubble', Math.random(), A.boilLevel * 0.6);
    }
    A.loop('boil', 0.025 * A.boilLevel);
  };
})();
