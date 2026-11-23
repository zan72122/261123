// audio.js — Web Audio で合成する音（最初のタッチで鳴り始める）
(function () {
  'use strict';
  var KK = window.KK;

  var A = (KK.audio = {
    ctx: null, ready: false,
    master: null, dry: null, verbSend: null, hollowSend: null,
    roll: null, whir: null, noiseBuf: null
  });

  A.start = function () {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx;
    try { ctx = new AC(); } catch (e) { return; }
    A.ctx = ctx;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    comp.connect(ctx.destination);
    A.master = ctx.createGain(); A.master.gain.value = 0.85; A.master.connect(comp);

    // 部屋の響き（ごく薄く）
    A.room = ctx.createConvolver(); A.room.buffer = impulse(ctx, 0.5, 3.2, 0.0);
    var roomGain = ctx.createGain(); roomGain.gain.value = 0.16;
    A.room.connect(roomGain); roomGain.connect(A.master);
    A.verbSend = ctx.createGain(); A.verbSend.gain.value = 1; A.verbSend.connect(A.room);

    // 螺旋の空洞の響き（短く、少しこもる）
    A.hollow = ctx.createConvolver(); A.hollow.buffer = impulse(ctx, 0.32, 2.2, 0.55);
    var hf = ctx.createBiquadFilter(); hf.type = 'peaking'; hf.frequency.value = 900; hf.Q.value = 2.5; hf.gain.value = 7;
    var hg = ctx.createGain(); hg.gain.value = 0.7;
    A.hollow.connect(hf); hf.connect(hg); hg.connect(A.master);
    A.hollowSend = ctx.createGain(); A.hollowSend.gain.value = 0; A.hollowSend.connect(A.hollow);

    // ノイズ素材
    var len = ctx.sampleRate * 2;
    A.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = A.noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 粗い粒（転がりのざらつき用）
    A.grainBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var g = A.grainBuf.getChannelData(0), hold = 0;
    for (i = 0; i < len; i++) {
      if (Math.random() < 0.02) hold = Math.random() * 2 - 1;
      hold *= 0.995; g[i] = hold + (Math.random() * 2 - 1) * 0.2;
    }

    A.roll = makeRollVoice(ctx);
    A.whir = makeWhirVoice(ctx);
    A.ready = true;
  };

  function impulse(ctx, secs, decay, dark) {
    var n = Math.floor(ctx.sampleRate * secs);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) {
        var x = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
        lp = lp + (x - lp) * (1 - dark * 0.9);
        d[i] = lp;
      }
    }
    return buf;
  }

  function makeRollVoice(ctx) {
    var src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    var grain = ctx.createBufferSource(); grain.buffer = A.grainBuf; grain.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.1;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.5;
    var gbp = ctx.createBiquadFilter(); gbp.type = 'bandpass'; gbp.frequency.value = 400; gbp.Q.value = 0.9;
    var gain = ctx.createGain(); gain.gain.value = 0;
    var ggain = ctx.createGain(); ggain.gain.value = 0;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    src.connect(bp); bp.connect(lp); lp.connect(gain);
    grain.connect(gbp); gbp.connect(ggain);
    gain.connect(pan); ggain.connect(pan);
    pan.connect(A.master); pan.connect(A.verbSend); pan.connect(A.hollowSend);
    src.start(); grain.start();
    // 木目を拾う細かな揺れ（AM）
    var lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 20;
    var lfoG = ctx.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(gain.gain); lfo.start();
    return { bp: bp, lp: lp, gain: gain, ggain: ggain, gbp: gbp, pan: pan, lfo: lfo, lfoG: lfoG, grain: grain };
  }

  function makeWhirVoice(ctx) {
    var src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 3;
    var gain = ctx.createGain(); gain.gain.value = 0;
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 3;
    var lfoG = ctx.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG); lfoG.connect(gain.gain); lfo.start();
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    src.connect(bp); bp.connect(gain); gain.connect(pan); pan.connect(A.master); src.start();
    return { bp: bp, gain: gain, lfo: lfo, lfoG: lfoG, pan: pan };
  }

  function setPan(node, p) {
    if (node.pan) node.pan.setTargetAtTime(KK.clamp(p, -0.9, 0.9), A.ctx.currentTime, 0.05);
  }

  // 転がり音: speed(cm/s), surface: 'wood'|'spiral'|'felt'|'cork'|'table'|'none'
  A.rolling = function (speed, surface, pan) {
    if (!A.ready) return;
    var r = A.roll, t = A.ctx.currentTime;
    var sp = Math.max(0, speed);
    var amp = 0, f = 600, q = 1.1, lpf = 3000, grainAmp = 0, hollow = 0, lfoRate = 10, lfoDepth = 0;
    var s01 = KK.clamp(sp / 110, 0, 1.4);
    if (surface === 'wood' || surface === 'spiral') {
      amp = Math.pow(s01, 0.8) * 0.16;
      f = 420 + sp * 22; lpf = 1800 + sp * 40; q = 1.4;
      grainAmp = s01 * 0.09;
      lfoRate = 6 + sp * 0.55; lfoDepth = amp * 0.5;
      if (surface === 'spiral') hollow = 0.9;
    } else if (surface === 'felt') {
      amp = Math.pow(s01, 1.2) * 0.07;
      f = 260 + sp * 4; lpf = 700; q = 0.7; grainAmp = 0;
    } else if (surface === 'cork') {
      amp = Math.pow(s01, 1.0) * 0.1;
      f = 300 + sp * 8; lpf = 1200; q = 0.9; grainAmp = s01 * 0.06;
      lfoRate = 8 + sp * 0.3; lfoDepth = amp * 0.3;
    } else if (surface === 'table') {
      amp = Math.pow(s01, 0.9) * 0.12;
      f = 360 + sp * 14; lpf = 1600 + sp * 20; q = 1.2; grainAmp = s01 * 0.07;
      lfoRate = 5 + sp * 0.4; lfoDepth = amp * 0.4;
    }
    if (sp < 1.5) { amp = 0; grainAmp = 0; lfoDepth = 0; }
    var tc = surface === 'felt' ? 0.05 : 0.03;
    r.gain.gain.setTargetAtTime(amp, t, tc);
    r.ggain.gain.setTargetAtTime(grainAmp, t, tc);
    r.bp.frequency.setTargetAtTime(Math.min(f, 6000), t, 0.04);
    r.bp.Q.setTargetAtTime(q, t, 0.05);
    r.lp.frequency.setTargetAtTime(Math.min(lpf, 9000), t, 0.04);
    r.gbp.frequency.setTargetAtTime(Math.min(250 + sp * 9, 3000), t, 0.05);
    r.lfo.frequency.setTargetAtTime(Math.min(lfoRate, 90), t, 0.05);
    r.lfoG.gain.setTargetAtTime(lfoDepth, t, 0.05);
    A.hollowSend.gain.setTargetAtTime(hollow, t, 0.08);
    setPan(r.pan, pan || 0);
  };

  A.wheel = function (omega, pan) {
    if (!A.ready) return;
    var w = A.whir, t = A.ctx.currentTime, a = Math.abs(omega);
    var amp = KK.clamp((a - 0.6) / 30, 0, 1) * 0.05;
    w.gain.gain.setTargetAtTime(amp, t, 0.08);
    w.bp.frequency.setTargetAtTime(180 + a * 22, t, 0.1);
    w.lfo.frequency.setTargetAtTime(Math.max(0.5, a * 6 / (Math.PI * 2)), t, 0.1);
    w.lfoG.gain.setTargetAtTime(amp * 0.8, t, 0.1);
    setPan(w.pan, pan || 0);
  };

  // 短い打撃音
  function tok(opt) {
    if (!A.ready) return;
    var ctx = A.ctx, t = ctx.currentTime + (opt.delay || 0);
    var out = ctx.createGain(); out.gain.value = 1;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = KK.clamp(opt.pan || 0, -0.9, 0.9);
    out.connect(pan); pan.connect(A.master); pan.connect(A.verbSend);
    if (opt.hollow) { var hs = ctx.createGain(); hs.gain.value = opt.hollow; pan.connect(hs); hs.connect(A.hollow); }
    var vol = opt.vol;
    var dur = opt.decay * 6;
    if (opt.freq) {
      var o = ctx.createOscillator(); o.type = opt.wave || 'sine';
      o.frequency.setValueAtTime(opt.freq * (opt.sweep || 1.6), t);
      o.frequency.exponentialRampToValueAtTime(opt.freq, t + 0.012);
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(vol, t + 0.002);
      og.gain.exponentialRampToValueAtTime(0.0001, t + opt.decay * 4);
      o.connect(og); og.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
      if (opt.freq2) {
        var o2 = ctx.createOscillator(); o2.type = 'sine';
        o2.frequency.setValueAtTime(opt.freq2, t);
        var og2 = ctx.createGain();
        og2.gain.setValueAtTime(0.0001, t);
        og2.gain.exponentialRampToValueAtTime(vol * (opt.amp2 || 0.5), t + 0.002);
        og2.gain.exponentialRampToValueAtTime(0.0001, t + opt.decay * 2.5);
        o2.connect(og2); og2.connect(out); o2.start(t); o2.stop(t + dur + 0.05);
      }
    }
    if (opt.noise) {
      var n = ctx.createBufferSource(); n.buffer = A.noiseBuf;
      n.playbackRate.value = 0.8 + Math.random() * 0.4;
      var f = ctx.createBiquadFilter(); f.type = opt.ntype || 'bandpass';
      f.frequency.value = opt.nfreq || 2000; f.Q.value = opt.nq || 1.2;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(vol * opt.noise, t + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + (opt.ndecay || opt.decay) * 4);
      n.connect(f); f.connect(ng); ng.connect(out);
      var off = Math.random() * 1.5;
      n.start(t, off); n.stop(t + dur + 0.05);
    }
  }

  // 種類ごとの音
  A.hit = function (kind, strength, pan) {
    if (!A.ready) return;
    var s = KK.clamp(strength == null ? 1 : strength, 0, 1.5);
    var j = 0.92 + Math.random() * 0.16;
    switch (kind) {
      case 'seam':      // 継ぎ目のこつん
        tok({ freq: 1250 * j, freq2: 2900 * j, decay: 0.012, vol: 0.12 * s + 0.02, noise: 0.6, nfreq: 3000, pan: pan }); break;
      case 'spiralSeam':
        tok({ freq: 1050 * j, freq2: 2400 * j, decay: 0.01, vol: 0.05 * s + 0.015, noise: 0.5, nfreq: 2600, pan: pan, hollow: 0.8 }); break;
      case 'woodLand':  // 溝に着地
        tok({ freq: 760 * j, freq2: 1820 * j, decay: 0.02, vol: 0.2 * s + 0.03, noise: 0.7, nfreq: 2400, pan: pan }); break;
      case 'feltLand':
        tok({ freq: 150 * j, decay: 0.03, vol: 0.18 * s + 0.02, noise: 0.5, ntype: 'lowpass', nfreq: 600, nq: 0.5, ndecay: 0.03, pan: pan, sweep: 1.2 }); break;
      case 'corkLand':
        tok({ freq: 260 * j, decay: 0.02, vol: 0.16 * s + 0.02, noise: 0.7, ntype: 'lowpass', nfreq: 1400, nq: 0.6, pan: pan }); break;
      case 'tableLand':
        tok({ freq: 420 * j, freq2: 980 * j, decay: 0.025, vol: 0.18 * s + 0.02, noise: 0.6, nfreq: 1800, pan: pan }); break;
      case 'rim':
        tok({ freq: 620 * j, freq2: 1500 * j, decay: 0.015, vol: 0.14 * s + 0.02, noise: 0.5, nfreq: 2200, pan: pan }); break;
      case 'place':     // 部品を置く（乾いた短い音、一度はね返る）
        tok({ freq: 420 * j, freq2: 1150 * j, decay: 0.022, vol: 0.2 * s + 0.04, noise: 0.8, nfreq: 1700, pan: pan });
        tok({ freq: 480 * j, decay: 0.012, vol: 0.07 * s + 0.01, noise: 0.6, nfreq: 2000, pan: pan, delay: 0.07 }); break;
      case 'snap':      // 継ぎ板が重なる
        tok({ freq: 1500 * j, freq2: 3100 * j, decay: 0.01, vol: 0.16, noise: 0.9, nfreq: 3600, pan: pan });
        tok({ freq: 700 * j, decay: 0.016, vol: 0.1, noise: 0.3, nfreq: 1500, pan: pan, delay: 0.035 }); break;
      case 'brush':     // 継ぎ板が相手の縁に触れる
        tok({ freq: 1900 * j, decay: 0.006, vol: 0.05, noise: 0.8, nfreq: 4200, pan: pan }); break;
      case 'pull':      // 継ぎ板が抜ける
        tok({ freq: 560 * j, freq2: 1300 * j, decay: 0.014, vol: 0.13, noise: 0.6, nfreq: 2000, pan: pan }); break;
      case 'limit':     // つまみの縁が受けに当たる
        tok({ freq: 520 * j, freq2: 1240 * j, decay: 0.016, vol: 0.14, noise: 0.5, nfreq: 1900, pan: pan }); break;
      case 'lift':      // 持ち上げ
        tok({ freq: 340 * j, decay: 0.02, vol: 0.08, noise: 0.5, ntype: 'lowpass', nfreq: 900, pan: pan }); break;
      case 'paddle':    // 羽根に当たる
        tok({ freq: 980 * j, freq2: 2300 * j, decay: 0.012 + s * 0.006, vol: 0.06 + s * 0.12, noise: 0.7, nfreq: 2800, pan: pan }); break;
      case 'glass':     // 玉を拾う・置く
        tok({ freq: 2600 * j, freq2: 4150 * j, amp2: 0.4, decay: 0.03, vol: 0.05 * s + 0.02, pan: pan, sweep: 1.02 }); break;
      case 'dimple':
        tok({ freq: 900 * j, freq2: 2100 * j, decay: 0.018, vol: 0.1 * s + 0.02, noise: 0.4, nfreq: 2400, pan: pan }); break;
      case 'tick':      // 羽根車の軸の小さな音
        tok({ freq: 1600 * j, decay: 0.005, vol: 0.025, noise: 0.5, nfreq: 3800, pan: pan }); break;
    }
  };
})();
