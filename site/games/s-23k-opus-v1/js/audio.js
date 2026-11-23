// audio.js — Web Audio だけで合成する音。最初のタッチで鳴らし始める。
(function () {
  'use strict';
  const S = window.S23;
  const A = (S.audio = {});
  let ctx = null, master = null, wet = null, noiseBuf = null, brownBuf = null;
  const loops = {};
  let lastTick = {};

  function makeNoise(seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5;
    }
    return b;
  }

  A.start = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);
    // 部屋のひびき（ごく短い）
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(0.5);
    wet = ctx.createGain(); wet.gain.value = 0.16;
    wet.connect(conv); conv.connect(master);
    noiseBuf = makeNoise(2.5, false);
    brownBuf = makeNoise(4, true);
    // 窓辺の静かな部屋の気配
    const room = ctx.createBufferSource();
    room.buffer = brownBuf; room.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const rg = ctx.createGain(); rg.gain.value = 0.018;
    room.connect(lp); lp.connect(rg); rg.connect(master);
    room.start();
  };
  A.ready = () => !!ctx;
  A.now = () => (ctx ? ctx.currentTime : 0);

  function out(node, wetAmt) {
    node.connect(master);
    if (wetAmt) { const g = ctx.createGain(); g.gain.value = wetAmt; node.connect(g); g.connect(wet); }
  }
  function env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  function noiseShot(t0, dur, type, freq, q, peak, attack, wetAmt) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    env(g, t0, attack || 0.002, peak, dur);
    src.connect(f); f.connect(g); out(g, wetAmt);
    src.start(t0, Math.random() * 1.5, dur + 0.1);
  }
  function tone(t0, type, f0, f1, dur, peak, wetAmt) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain(); env(g, t0, 0.003, peak, dur);
    o.connect(g); out(g, wetAmt);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function throttle(key, minGap) {
    const t = performance.now();
    if (lastTick[key] && t - lastTick[key] < minGap) return false;
    lastTick[key] = t; return true;
  }

  // 厚紙がゆっくり擦れる低い音（連続）。amount 0..1
  A.rub = function (id, amount, pitch) {
    if (!ctx) return;
    let L = loops[id];
    if (!L) {
      const src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.value = 420;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(hp); hp.connect(bp); bp.connect(g); out(g, 0.3);
      src.start();
      L = loops[id] = { g, bp };
    }
    const t = ctx.currentTime;
    const a = S.clamp(amount, 0, 1);
    L.g.gain.setTargetAtTime(a * a * 0.55, t, 0.06);
    L.bp.frequency.setTargetAtTime(260 + (pitch || 1) * 260 + a * 200, t, 0.08);
  };

  // 耳が溝に戻る短い乾いた音
  A.snap = function (strength) {
    if (!ctx || !throttle('snap', 60)) return;
    const t = ctx.currentTime + 0.005, s = S.clamp(strength || 1, 0.2, 1.5);
    noiseShot(t, 0.03, 'highpass', 2400, 0.7, 0.5 * s, 0.001, 0.25);
    noiseShot(t + 0.004, 0.06, 'bandpass', 900, 2.5, 0.35 * s, 0.001, 0.2);
    tone(t, 'triangle', 210, 120, 0.07, 0.25 * s, 0.1);
  };

  // ひも：張るほど高く短く
  A.tension = function (tens) {
    if (!ctx || !throttle('tension', 45)) return;
    const t = ctx.currentTime + 0.002, k = S.clamp(tens, 0, 1);
    const f = 240 + k * 820;
    const d = 0.16 - k * 0.12;
    tone(t, 'triangle', f, f * 0.985, d, 0.06 + k * 0.05, 0.15);
    noiseShot(t, d * 0.6, 'bandpass', f * 2.2, 6, 0.03, 0.001, 0);
  };

  // 包みが当たる・落ちる
  A.thud = function (strength, bright) {
    if (!ctx || !throttle('thud', 35)) return;
    const t = ctx.currentTime + 0.003, s = S.clamp(strength, 0.05, 1.2);
    noiseShot(t, 0.05 + s * 0.05, 'lowpass', 700 + (bright || 0) * 1600, 0.8, 0.55 * s, 0.002, 0.3);
    tone(t, 'sine', 150 + (bright || 0) * 90, 70, 0.09, 0.35 * s, 0.1);
  };
  // 筒が転がる「とん」
  A.rollTap = function (strength) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.002, s = S.clamp(strength, 0.05, 1);
    noiseShot(t, 0.03, 'bandpass', 520, 3, 0.25 * s, 0.001, 0.15);
    tone(t, 'sine', 260, 190, 0.04, 0.12 * s, 0);
  };
  // 紙のしわ
  A.crinkle = function (strength) {
    if (!ctx || !throttle('crinkle', 90)) return;
    const s = S.clamp(strength, 0.1, 1);
    const n = 3 + Math.floor(s * 5);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + 0.003 + Math.random() * 0.12 * s;
      noiseShot(t, 0.012 + Math.random() * 0.02, 'bandpass', 2500 + Math.random() * 3500, 3, 0.12 * s, 0.001, 0.1);
    }
  };
  // 爪のばね
  A.spring = function () {
    if (!ctx || !throttle('spring', 150)) return;
    const t = ctx.currentTime + 0.003;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
    const lg = ctx.createGain(); lg.gain.value = 30;
    lfo.connect(lg); lg.connect(o.frequency);
    const g = ctx.createGain(); env(g, t, 0.004, 0.07, 0.28);
    o.connect(g); out(g, 0.3);
    o.start(t); lfo.start(t); o.stop(t + 0.35); lfo.stop(t + 0.35);
  };
  // 小さなこすれ（坂を滑る・耳が表を滑る）
  A.scrape = function (strength) {
    if (!ctx || !throttle('scrape', 70)) return;
    const t = ctx.currentTime + 0.003, s = S.clamp(strength, 0.05, 1);
    noiseShot(t, 0.08 + s * 0.08, 'bandpass', 700 + s * 500, 1.4, 0.2 * s, 0.02, 0.2);
  };
  // 掛ける・はめる（コトッ）
  A.knock = function (strength) {
    if (!ctx || !throttle('knock', 60)) return;
    const t = ctx.currentTime + 0.003, s = S.clamp(strength || 1, 0.1, 1.2);
    tone(t, 'sine', 330, 180, 0.08, 0.3 * s, 0.2);
    noiseShot(t, 0.04, 'bandpass', 1300, 2, 0.25 * s, 0.001, 0.2);
  };
  // 視点が下りるときのかすかな空気
  A.swell = function () {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource(); src.buffer = brownBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
    f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(900, t + 1.2); f.frequency.linearRampToValueAtTime(240, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 1.0); g.gain.linearRampToValueAtTime(0.0001, t + 2.5);
    src.connect(f); f.connect(g); out(g, 0.5);
    src.start(t, 0, 2.6);
  };
})();
