// audio.js — Web Audio で合成する音（最初のタッチで開始）
(function () {
  'use strict';
  var G = window.G;
  var A = (G.audio = { ctx: null, ok: false });
  var noiseBuf = null, master = null;
  var loops = {};
  var lastHit = {};

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A.ctx = new AC(); } catch (e) { return; }
    var c = A.ctx;
    master = c.createGain(); master.gain.value = 0.8;
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(c.destination);
    var len = c.sampleRate * 2;
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    var d = noiseBuf.getChannelData(0), b0 = 0, b1 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + w * 0.15; b1 = 0.6 * b1 + w * 0.4;
      d[i] = (b0 + b1 + w * 0.25) * 0.5;
    }
    A.ok = true;
    // 連続音：段ボールの擦れ
    loops.scrape = mkNoiseLoop(420, 1.4);
    // 連続音：軸の擦れ（回す速さで音程）
    loops.crankN = mkNoiseLoop(600, 3.5);
    var o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 110;
    var of = c.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 900;
    var og = c.createGain(); og.gain.value = 0;
    o.connect(of); of.connect(og); og.connect(master); o.start();
    loops.crankO = { osc: o, gain: og, filter: of };
    // こまの回る音
    loops.whir = mkNoiseLoop(1400, 6);
    if (c.state === 'suspended') c.resume();
  };

  function mkNoiseLoop(freq, q) {
    var c = A.ctx;
    var src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { src: src, filter: f, gain: g, level: 0 };
  }
  function setLoop(L, level, freq) {
    if (!A.ok || !L) return;
    var t = A.ctx.currentTime;
    L.gain.gain.setTargetAtTime(level, t, 0.04);
    if (freq) L.filter.frequency.setTargetAtTime(freq, t, 0.05);
  }

  // 段ボールの低い擦れ（0..1）
  A.scrape = function (level, pitch) { setLoop(loops.scrape, Math.min(0.35, level * 0.35), 260 + (pitch || 0) * 400); };
  // 回す速さ（rad/s）
  A.crank = function (speed) {
    if (!A.ok) return;
    var s = Math.min(1, Math.abs(speed) / 9);
    setLoop(loops.crankN, s * 0.22, 380 + s * 1300);
    var t = A.ctx.currentTime;
    loops.crankO.gain.gain.setTargetAtTime(s * 0.05, t, 0.05);
    loops.crankO.osc.frequency.setTargetAtTime(70 + s * 190, t, 0.06);
    loops.crankO.filter.frequency.setTargetAtTime(400 + s * 1400, t, 0.06);
  };
  A.whir = function (level) { setLoop(loops.whir, Math.min(0.12, level * 0.12), 900 + level * 900); };

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function noiseHit(t, freq, q, peak, dec, pan, type) {
    var c = A.ctx;
    var s = c.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    var f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = c.createGain();
    var p = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(f); f.connect(g);
    if (p) { p.pan.value = G.clamp(pan || 0, -1, 1); g.connect(p); p.connect(master); } else g.connect(master);
    env(g, t, 0.002, peak, dec);
    s.start(t, Math.random() * 1.5, a2(dec));
  }
  function a2(d) { return d + 0.1; }
  function toneHit(t, freq, peak, dec, type, slide, pan) {
    var c = A.ctx;
    var o = c.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dec);
    var g = c.createGain();
    var p = c.createStereoPanner ? c.createStereoPanner() : null;
    o.connect(g);
    if (p) { p.pan.value = G.clamp(pan || 0, -1, 1); g.connect(p); p.connect(master); } else g.connect(master);
    env(g, t, 0.002, peak, dec);
    o.start(t); o.stop(t + dec + 0.05);
  }

  // 一発音。kind: shell / inner / card / click / fiber / pop / thud / paper / wood / slot / cover
  A.hit = function (kind, strength, pan, delay) {
    if (!A.ok) return;
    var now = A.ctx.currentTime;
    var key = kind;
    if (lastHit[key] && now - lastHit[key] < 0.025 && !delay) return; // 重なり過ぎを防ぐ
    lastHit[key] = now;
    var s = G.clamp(strength == null ? 0.6 : strength, 0.05, 1.2);
    var t = now + (delay || 0);
    var r = 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'shell': // 殻同士の軽い打音
        toneHit(t, 2300 * r, 0.10 * s, 0.05, 'sine', 0.8, pan);
        toneHit(t, 3900 * r, 0.04 * s, 0.03, 'sine', 0.9, pan);
        noiseHit(t, 3500 * r, 2, 0.08 * s, 0.03, pan);
        break;
      case 'inner': // 景品が内壁を打つ（少しこもる）
        toneHit(t, 900 * r, 0.06 * s, 0.05, 'triangle', 0.7, pan);
        noiseHit(t, 1500 * r, 3, 0.05 * s, 0.04, pan);
        break;
      case 'card': // 段ボールの低い当たり
        noiseHit(t, 260 * r, 1.2, 0.35 * s, 0.09, pan, 'lowpass');
        toneHit(t, 95 * r, 0.12 * s, 0.08, 'sine', 0.7, pan);
        break;
      case 'click': // 爪が通る
        noiseHit(t, 2400 * r, 4, 0.2 * s, 0.025, pan);
        toneHit(t, 1250 * r, 0.06 * s, 0.03, 'square', 0.6, pan);
        noiseHit(t + 0.03, 500, 1.5, 0.15 * s, 0.07, pan, 'lowpass');
        break;
      case 'fiber':
        noiseHit(t, 5200 * r, 6, 0.03 * s, 0.012, pan);
        break;
      case 'pop': // 殻が外れる
        noiseHit(t, 1800 * r, 1.5, 0.16 * s, 0.05, pan);
        toneHit(t, 620 * r, 0.08 * s, 0.07, 'sine', 1.6, pan);
        break;
      case 'cover': // ふたがはまる
        toneHit(t, 1700 * r, 0.08 * s, 0.04, 'sine', 0.7, pan);
        noiseHit(t + 0.02, 2800 * r, 3, 0.1 * s, 0.03, pan);
        break;
      case 'thud': // 受け皿に落ちる
        noiseHit(t, 180 * r, 1, 0.4 * s, 0.13, pan, 'lowpass');
        toneHit(t, 70 * r, 0.2 * s, 0.12, 'sine', 0.6, pan);
        break;
      case 'paper':
        noiseHit(t, 3000 * r, 0.8, 0.07 * s, 0.09, pan);
        noiseHit(t + 0.05, 4200 * r, 1, 0.04 * s, 0.06, pan);
        break;
      case 'wood':
        toneHit(t, 760 * r, 0.12 * s, 0.07, 'triangle', 0.85, pan);
        noiseHit(t, 1200 * r, 2, 0.08 * s, 0.04, pan);
        break;
      case 'rubber':
        toneHit(t, 230 * r, 0.12 * s, 0.06, 'sine', 0.7, pan);
        noiseHit(t, 700 * r, 1, 0.08 * s, 0.04, pan, 'lowpass');
        break;
      case 'slot': // 板が溝に沈む
        noiseHit(t, 700 * r, 1.5, 0.22 * s, 0.08, pan);
        noiseHit(t + 0.06, 320, 1, 0.2 * s, 0.1, pan, 'lowpass');
        break;
      case 'tick': // 盤の縁で殻が揺れる
        toneHit(t, 1900 * r, 0.035 * s, 0.025, 'sine', 0.8, pan);
        break;
    }
  };

  // 連続音は毎フレームの要求の最大値で鳴らす
  A.want = { scrape: 0, pitch: 0, crank: 0, whir: 0 };
  A.ask = function (k, v, pitch) {
    if (v > A.want[k]) { A.want[k] = v; if (k === 'scrape' && pitch != null) A.want.pitch = pitch; }
  };
  A.frame = function () {
    var w = A.want;
    A.scrape(w.scrape, w.pitch);
    A.crank(w.crank);
    A.whir(w.whir);
    w.scrape = 0; w.pitch = 0; w.crank = 0; w.whir = 0;
  };

  A.stopAll = function () {
    if (!A.ok) return;
    setLoop(loops.scrape, 0); setLoop(loops.crankN, 0); setLoop(loops.whir, 0);
    loops.crankO.gain.gain.setTargetAtTime(0, A.ctx.currentTime, 0.05);
  };
})();
