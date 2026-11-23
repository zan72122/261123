/* audio.js — Web Audio で合成する台所の音。最初のタッチで開始。 */
(function () {
  'use strict';
  const G = window.G;
  const A = (G.audio = {
    ctx: null, ready: false, master: null, wet: null, noiseBuf: null,
    scrape: null, pour: null, lastDrip: 0,
  });

  function makeNoise(ctx, sec) {
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.15 + w * 0.85; // ごく弱い色づけ
      d[i] = last;
    }
    return b;
  }

  function makeImpulse(ctx, sec, decay) {
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
      }
    }
    return b;
  }

  A.start = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC(); } catch (e) { return; }
    A.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    A.master = ctx.createGain(); A.master.gain.value = 0.85; A.master.connect(comp);
    // 小さな台所の響き
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, 0.9, 3.2);
    A.wet = ctx.createGain(); A.wet.gain.value = 0.16;
    A.wet.connect(conv); conv.connect(A.master);
    A.noiseBuf = makeNoise(ctx, 2.0);
    if (ctx.state === 'suspended') ctx.resume();
    A.ready = true;
    initScrape(); initPour();
  };

  function out(pan) {
    const ctx = A.ctx;
    const g = ctx.createGain();
    let node = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); node = p;
    }
    node.connect(A.master); node.connect(A.wet);
    return g;
  }

  function noiseSrc(loop) {
    const s = A.ctx.createBufferSource();
    s.buffer = A.noiseBuf; s.loop = !!loop;
    if (!loop) { try { s.playbackRate.value = 0.9 + Math.random() * 0.2; } catch (e) { /* noop */ } }
    return s;
  }

  function env(g, t0, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }

  // 木の小さな音（口枠が収まる・皿が盆に触れる）
  A.wood = function (pan, strength, pitch) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const n = noiseSrc(false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 * (pitch || 1); bp.Q.value = 3.5;
    const g1 = ctx.createGain(); env(g1, t, 0.002, 0.5 * s, 0.07);
    n.connect(bp); bp.connect(g1); g1.connect(o);
    n.start(t, Math.random() * 1.5, 0.15);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(680 * (pitch || 1), t);
    osc.frequency.exponentialRampToValueAtTime(420 * (pitch || 1), t + 0.08);
    const g2 = ctx.createGain(); env(g2, t, 0.002, 0.28 * s, 0.11);
    osc.connect(g2); g2.connect(o); osc.start(t); osc.stop(t + 0.16);
    o.gain.value = 1;
  };

  // ぷるっとした接触音（寒天に触れる）
  A.squish = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t); osc.frequency.exponentialRampToValueAtTime(110, t + 0.14);
    const g = ctx.createGain(); env(g, t, 0.006, 0.22 * s, 0.16);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.25);
    const n = noiseSrc(false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g2 = ctx.createGain(); env(g2, t, 0.004, 0.12 * s, 0.09);
    n.connect(lp); lp.connect(g2); g2.connect(o); n.start(t, Math.random(), 0.2);
  };

  // しずくが落ちる音
  A.drip = function (pan, strength, pitch) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const f = (1100 + Math.random() * 500) * (pitch || 1);
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t); osc.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
    const g = ctx.createGain(); env(g, t, 0.001, 0.16 * s, 0.09);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.15);
  };

  // 細かな水しぶき
  A.spray = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const n = noiseSrc(false);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const g = ctx.createGain(); env(g, t, 0.003, 0.08 * s, 0.12);
    n.connect(hp); hp.connect(g); g.connect(o); n.start(t, Math.random(), 0.2);
  };

  // 糸が皿に着く柔らかい音
  A.flop = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const n = noiseSrc(false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); env(g, t, 0.01, 0.13 * s, 0.12);
    n.connect(lp); lp.connect(g); g.connect(o); n.start(t, Math.random(), 0.2);
  };

  // 釉薬の皿のふち
  A.ceramic = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const parts = [2210, 3480, 5260, 7030];
    parts.forEach((f, i) => {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain(); env(g, t, 0.001, (0.09 / (i + 1)) * s, 0.5 / (1 + i * 0.6));
      osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.7);
    });
  };

  // 切り糸がはじく音
  A.pluck = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    const f = 520 + Math.random() * 90;
    osc.frequency.setValueAtTime(f, t); osc.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.2);
    const g = ctx.createGain(); env(g, t, 0.002, 0.12 * s, 0.22);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.3);
    A.squish(pan, 0.35 * s);
  };

  // ごまの粒
  A.tick = function (pan, strength) {
    if (!A.ready) return;
    const ctx = A.ctx, t = ctx.currentTime, s = strength == null ? 1 : strength;
    const o = out(pan);
    const n = noiseSrc(false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200 + Math.random() * 2000; bp.Q.value = 6;
    const g = ctx.createGain(); env(g, t, 0.001, 0.12 * s, 0.025);
    n.connect(bp); bp.connect(g); g.connect(o); n.start(t, Math.random(), 0.05);
  };

  // 棒が筒をこする連続音：速さで音程と大きさが変わる
  function initScrape() {
    const ctx = A.ctx;
    const n = noiseSrc(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 2.2;
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 900; bp2.gain.value = 6; bp2.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    const o = out(-0.25);
    n.connect(bp); bp.connect(bp2); bp2.connect(g); g.connect(o);
    n.start();
    A.scrape = { g, bp, bp2 };
  }
  A.setScrape = function (speed, pan) {
    if (!A.ready || !A.scrape) return;
    const t = A.ctx.currentTime;
    const s = Math.min(1, Math.abs(speed) / 22);
    A.scrape.g.gain.setTargetAtTime(s > 0.02 ? 0.05 + 0.28 * s : 0, t, 0.04);
    A.scrape.bp.frequency.setTargetAtTime(220 + 900 * s, t, 0.05);
    A.scrape.bp2.frequency.setTargetAtTime(600 + 1500 * s, t, 0.05);
  };

  // つゆを注ぐ音
  function initPour() {
    const ctx = A.ctx;
    const n = noiseSrc(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7.3;
    const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
    const o = out(0.2);
    n.connect(bp); bp.connect(g); g.connect(o); n.start();
    A.pour = { g, bp };
  }
  A.setPour = function (rate) {
    if (!A.ready || !A.pour) return;
    const t = A.ctx.currentTime;
    const s = Math.max(0, Math.min(1, rate));
    A.pour.g.gain.setTargetAtTime(0.16 * s, t, 0.06);
    A.pour.bp.frequency.setTargetAtTime(520 + 520 * s, t, 0.1);
  };

  // 画面上の横位置からパンを決める
  A.panOf = function (v3) {
    if (!G.cam || !v3) return 0;
    const p = v3.clone ? v3.clone() : new THREE.Vector3(v3.x, v3.y, v3.z);
    p.project(G.cam.camera);
    return Math.max(-0.9, Math.min(0.9, p.x * 0.8));
  };
})();
