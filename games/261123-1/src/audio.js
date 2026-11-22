/* G.Audio — すべて Web Audio 合成の効果音（サンプル音源なし）
 * unlock / setPaused / drill(on,{load,battery}) / clutch(on) / play(name,{vol,pitch,delay})
 * AudioContext が無い・作れない・拒否されても例外を投げず、静かに何もしない。
 */
(function () {
  'use strict';
  var G = window.G = window.G || {};

  var ctx = null;          // AudioContext
  var failed = false;      // 作成に失敗したら以後なにもしない
  var paused = false;
  var bus = null;          // 全音の合流点
  var noiseBuf = null;     // 共有ホワイトノイズ
  var clutchBuf = null;    // ラチェット音のループ
  var motor = null;        // 連続モーター音のノード群
  var clutchSt = { on: false, src: null, g: null };
  var voices = [];
  var MAX_VOICES = 28, MAX_PER_NAME = 5;
  var listening = false;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ---------------------------------------------------------------- 初期化
  function create() {
    if (ctx || failed) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') { failed = true; return null; }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) {
      try { ctx = new AC(); } catch (e2) { ctx = null; }
    }
    if (!ctx) { failed = true; return null; }
    try {
      buildMaster();
      buildBuffers();
    } catch (e3) {
      try { if (ctx.close) ctx.close(); } catch (e4) { /* ignore */ }
      ctx = null; failed = true; return null;
    }
    addResumeListeners();
    return ctx;
  }

  function buildMaster() {
    bus = ctx.createGain();
    bus.gain.value = 1;
    var hc = ctx.createBiquadFilter();         // 耳に刺さらないよう高域を抑える
    hc.type = 'lowpass'; hc.frequency.value = 8500; hc.Q.value = 0.5;
    var comp = ctx.createDynamicsCompressor(); // リミッター的に
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 12;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    var master = ctx.createGain();
    master.gain.value = 0.8;
    var clip = ctx.createWaveShaper();         // 最終ソフトクリップ（絶対に 1.0 を超えない）
    var n = 2048, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1, ax = Math.abs(x), y;
      y = ax < 0.5 ? ax : 0.5 + 0.47 * Math.tanh((ax - 0.5) / 0.47);
      curve[i] = x < 0 ? -y : y;
    }
    clip.curve = curve;
    bus.connect(hc); hc.connect(comp); comp.connect(master); master.connect(clip);
    clip.connect(ctx.destination);
  }

  function buildBuffers() {
    var sr = ctx.sampleRate, i, k;
    // ノイズ 2 秒
    var len = Math.floor(sr * 2);
    noiseBuf = ctx.createBuffer(1, len, sr);
    var d = noiseBuf.getChannelData(0);
    for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // クラッチ: 約18Hz の硬い機械クリック ×6（少しずつ違う）
    var per = 1 / 18, nClicks = 6;
    var clen = Math.floor(sr * per * nClicks);
    clutchBuf = ctx.createBuffer(1, clen, sr);
    var c = clutchBuf.getChannelData(0), peak = 0;
    for (k = 0; k < nClicks; k++) {
      var off = Math.floor(k * per * sr + (k % 2 ? 0.0015 : 0) * sr);
      var amp = 0.8 + 0.2 * Math.random();
      var fA = 1050 + Math.random() * 160, fB = 380 + Math.random() * 40;
      var dl = Math.floor(sr * 0.045);
      for (i = 0; i < dl && off + i < clen; i++) {
        var t = i / sr;
        var v = (Math.random() * 2 - 1) * Math.exp(-t / 0.0022) * 0.9 +
          Math.sin(2 * Math.PI * fA * t) * Math.exp(-t / 0.010) * 0.45 +
          Math.sin(2 * Math.PI * fB * t) * Math.exp(-t / 0.018) * 0.6 +
          Math.sin(2 * Math.PI * 2500 * t) * Math.exp(-t / 0.004) * 0.25;
        c[off + i] += v * amp;
      }
    }
    for (i = 0; i < clen; i++) peak = Math.max(peak, Math.abs(c[i]));
    if (peak > 0) for (i = 0; i < clen; i++) c[i] /= peak;
  }

  // iOS の interrupted / suspended から、次の操作でそっと復帰
  function addResumeListeners() {
    if (listening) return;
    listening = true;
    var h = function () {
      if (!ctx || paused) return;
      if (ctx.state !== 'running') tryResume();
    };
    try {
      document.addEventListener('pointerdown', h, true);
      document.addEventListener('touchend', h, true);
    } catch (e) { /* ignore */ }
  }

  function tryResume() {
    try {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () { });
    } catch (e) { /* ignore */ }
  }

  function unlock() {
    try {
      if (!create()) return;
      if (!paused && ctx.state !== 'running') tryResume();
      // 無音バッファを 1 回鳴らして iOS を解錠
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination);
      s.onended = function () { try { s.disconnect(); } catch (e) { } };
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  function setPaused(p) {
    try {
      p = !!p;
      paused = p;
      if (!ctx) return;
      if (p) {
        silenceMotor();
        clutchOff();
        try { var q = ctx.suspend(); if (q && q.catch) q.catch(function () { }); } catch (e) { }
      } else {
        tryResume();
      }
    } catch (e) { /* ignore */ }
  }

  function ready() { return !!(ctx && bus && !paused); }

  // ---------------------------------------------------------------- 発音管理
  function Voice(name, t) {
    this.name = name;
    this.out = ctx.createGain();
    this.out.connect(bus);
    this.nodes = [this.out];
    this.srcs = [];
    this.live = 0;
    this.dead = false;
    this.listed = true;
    this.t = t;
  }
  Voice.prototype.node = function (n) { this.nodes.push(n); return n; };
  Voice.prototype.src = function (s, t0, t1, offset) {
    var self = this;
    this.nodes.push(s); this.srcs.push(s); this.live++;
    s.onended = function () { self.live--; if (self.live <= 0) self.free(); };
    if (offset != null) s.start(t0, offset); else s.start(t0);
    s.stop(t1);
    return s;
  };
  Voice.prototype.unlist = function () {
    if (!this.listed) return;
    this.listed = false;
    var i = voices.indexOf(this);
    if (i >= 0) voices.splice(i, 1);
  };
  Voice.prototype.free = function () {
    if (this.dead) return;
    this.dead = true;
    this.unlist();
    for (var i = 0; i < this.nodes.length; i++) {
      try { this.nodes[i].disconnect(); } catch (e) { }
    }
    this.nodes = null; this.srcs = null;
  };
  Voice.prototype.kill = function () {
    this.unlist();
    if (this.dead) return;
    var n = ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(n);
      this.out.gain.setValueAtTime(this.out.gain.value, n);
      this.out.gain.linearRampToValueAtTime(0, n + 0.03);
    } catch (e) { }
    for (var i = 0; i < this.srcs.length; i++) {
      try { this.srcs[i].stop(n + 0.04); } catch (e2) { }
    }
  };

  function makeVoice(name, t) {
    var i, same = 0, oldestSame = null;
    for (i = 0; i < voices.length; i++) {
      if (voices[i].name === name) { same++; if (!oldestSame) oldestSame = voices[i]; }
    }
    if (same >= MAX_PER_NAME && oldestSame) oldestSame.kill();
    if (voices.length >= MAX_VOICES) voices[0].kill();
    var v = new Voice(name, t);
    voices.push(v);
    return v;
  }

  // ---------------------------------------------------------------- 合成の部品
  function gainNode(v, val) { var g = ctx.createGain(); g.gain.value = val; return v ? v.node(g) : g; }
  function filt(v, type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f;
    if (q != null) b.Q.value = q;
    return v ? v.node(b) : b;
  }
  // 立ち上がり a 秒で peak、hold 後に d 秒かけて（約 -60dB まで）減衰
  function envGain(v, t, a, peak, d, hold) {
    var g = gainNode(v, 0), p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold);
    p.setTargetAtTime(0, t + a + (hold || 0), Math.max(0.001, d / 6.9));
    return g;
  }
  function tone(v, o) {
    var t = o.t, a = o.a || 0.002, hold = o.hold || 0, d = o.d;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide || (a + hold + d)));
    if (o.detune) osc.detune.value = o.detune;
    var e = envGain(v, t, a, o.g, d, hold);
    osc.connect(e); e.connect(o.dest || v.out);
    v.src(osc, t, t + a + hold + d + 0.02);
    return osc;
  }
  function noise(v, o) {
    var t = o.t, a = o.a || 0.001, hold = o.hold || 0, d = o.d;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    var last = s;
    var b = filt(v, o.ftype || 'bandpass', o.f || 1000, o.q == null ? 1 : o.q);
    if (o.f1) b.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + (o.glide || (a + hold + d)));
    last.connect(b); last = b;
    if (o.lp) { var l = filt(v, 'lowpass', o.lp, 0.7); last.connect(l); last = l; }
    if (o.hp) { var h = filt(v, 'highpass', o.hp, 0.7); last.connect(h); last = h; }
    var e = envGain(v, t, a, o.g, d, hold);
    last.connect(e); e.connect(o.dest || v.out);
    v.src(s, t, t + a + hold + d + 0.02, Math.random() * 1.5);
    return { src: s, filter: b, env: e };
  }
  // 木の板の鳴り（中空感のある非整数倍音）
  function board(v, t, f, g, d, bright) {
    tone(v, { t: t, f: f, g: g, d: d });
    tone(v, { t: t, f: f * 2.31, g: g * 0.5, d: d * 0.55 });
    tone(v, { t: t, f: f * 3.87, g: g * 0.22 * (bright || 1), d: d * 0.3 });
    noise(v, { t: t, ftype: 'bandpass', f: f * 1.1, q: 9, g: g * 1.6, d: d * 0.8 });
    noise(v, { t: t, ftype: 'bandpass', f: 1600 * (bright || 1), q: 0.9, g: g * 0.55, d: 0.018 });
  }
  // オルゴールの一音
  function mbox(v, t, f, g, d) {
    tone(v, { t: t, f: f, g: g, d: d, a: 0.003 });
    tone(v, { t: t, f: f * 2.0, g: g * 0.2, d: d * 0.45, a: 0.002, detune: 3 });
    tone(v, { t: t, f: f * 4.07, g: g * 0.07, d: d * 0.12, a: 0.001 });
    noise(v, { t: t, ftype: 'bandpass', f: Math.min(7000, f * 3), q: 3, g: g * 0.12, d: 0.012 });
  }

  // ---------------------------------------------------------------- ワンショット
  var SFX = {
    tick: [0.5, function (v, t, p) {
      noise(v, { t: t, f: 2300 * p, q: 4, g: 0.55, d: 0.035 });
      tone(v, { t: t, f: 1500 * p, g: 0.18, d: 0.03 });
      tone(v, { t: t, f: 620 * p, g: 0.12, d: 0.05 });
    }],
    knock: [0.6, function (v, t, p) {
      board(v, t, 190 * p, 0.5, 0.22, 1);
      tone(v, { t: t, f: 95 * p, g: 0.25, d: 0.12 });
    }],
    clack: [0.55, function (v, t, p) {
      board(v, t, 300 * p, 0.5, 0.16, 1.3);
      board(v, t + 0.075, 340 * p, 0.32, 0.14, 1.4);
      tone(v, { t: t, f: 120 * p, g: 0.2, d: 0.1 });
    }],
    creak: [0.45, function (v, t, p) {
      // 擦れの断続（stick-slip）をのこぎり波の低い周期で作り、板の共鳴で色づけ
      var dur = 0.85;
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      var fr = o.frequency;
      fr.setValueAtTime(38 * p, t);
      fr.linearRampToValueAtTime(62 * p, t + 0.25);
      fr.linearRampToValueAtTime(48 * p, t + 0.5);
      fr.linearRampToValueAtTime(70 * p, t + 0.7);
      fr.linearRampToValueAtTime(40 * p, t + dur);
      var b1 = filt(v, 'bandpass', 820 * p, 7), b2 = filt(v, 'bandpass', 1480 * p, 9), b3 = filt(v, 'bandpass', 420 * p, 5);
      var g = gainNode(v, 0), gp = g.gain;
      gp.setValueAtTime(0, t);
      gp.linearRampToValueAtTime(0.9, t + 0.12);
      gp.linearRampToValueAtTime(0.6, t + 0.45);
      gp.linearRampToValueAtTime(1.0, t + 0.65);
      gp.linearRampToValueAtTime(0, t + dur);
      o.connect(b1); o.connect(b2); o.connect(b3);
      var m1 = gainNode(v, 1), m2 = gainNode(v, 0.6), m3 = gainNode(v, 0.7);
      b1.connect(m1); b2.connect(m2); b3.connect(m3);
      m1.connect(g); m2.connect(g); m3.connect(g);
      g.connect(v.out);
      v.src(o, t, t + dur + 0.02);
    }],
    thud: [0.85, function (v, t, p) {
      tone(v, { t: t, f: 78 * p, f1: 42 * p, glide: 0.25, g: 0.9, d: 0.42, a: 0.003 });
      tone(v, { t: t, f: 128 * p, f1: 90 * p, glide: 0.15, g: 0.4, d: 0.2 });
      noise(v, { t: t, ftype: 'lowpass', f: 380 * p, q: 0.8, g: 0.9, d: 0.16 });
      board(v, t + 0.004, 230 * p, 0.22, 0.13, 0.8);
    }],
    scrape: [0.5, function (v, t, p) {
      var dur = 0.8;
      var n1 = noise(v, { t: t, ftype: 'bandpass', f: 720 * p, f1: 480 * p, glide: dur, q: 1.6, g: 0.55, a: 0.06, hold: dur - 0.25, d: 0.2 });
      noise(v, { t: t, ftype: 'lowpass', f: 180 * p, q: 0.7, g: 0.6, a: 0.06, hold: dur - 0.25, d: 0.2 });
      // ずずー のガタつき（不規則な振幅のゆらぎ）
      var j = gainNode(v, 0.65);
      n1.env.disconnect(); n1.env.connect(j); j.connect(v.out);
      var l1 = ctx.createOscillator(); l1.type = 'square'; l1.frequency.value = 23 * p;
      var l1g = gainNode(v, 0.22); l1.connect(l1g); l1g.connect(j.gain);
      var l2 = ctx.createOscillator(); l2.type = 'triangle'; l2.frequency.value = 6.3;
      var l2g = gainNode(v, 0.2); l2.connect(l2g); l2g.connect(j.gain);
      v.src(l1, t, t + dur + 0.05); v.src(l2, t, t + dur + 0.05);
    }],
    seat: [0.6, function (v, t, p) {
      tone(v, { t: t, f: 160 * p, f1: 85 * p, glide: 0.06, g: 0.6, d: 0.09, a: 0.002 });
      noise(v, { t: t, f: 850 * p, q: 2, g: 0.45, d: 0.045 });
      tone(v, { t: t + 0.012, f: 3150 * p, g: 0.07, d: 0.07 });
      tone(v, { t: t + 0.012, f: 4720 * p, g: 0.045, d: 0.05 });
      noise(v, { t: t + 0.012, ftype: 'highpass', f: 4200, q: 0.7, g: 0.08, d: 0.012 });
    }],
    tumble: [0.75, function (v, t, p) {
      var k = 1 / Math.max(0.5, p);
      noise(v, { t: t, ftype: 'lowpass', f: 950 * p, q: 0.9, g: 0.85, d: 0.13 * k, a: 0.002 });
      tone(v, { t: t, f: 135 * p, f1: 70 * p, glide: 0.1, g: 0.55, d: 0.14 * k });
      noise(v, { t: t, ftype: 'bandpass', f: 2600 * p, q: 0.8, g: 0.12, d: 0.06 });
      board(v, t + 0.003, 330 * p, 0.12, 0.08, 1);
    }],
    bookIn: [0.55, function (v, t, p) {
      noise(v, { t: t, ftype: 'bandpass', f: 2400 * p, f1: 3600 * p, q: 1.2, g: 0.16, a: 0.03, hold: 0.06, d: 0.12 });
      board(v, t + 0.08, 250 * p, 0.32, 0.14, 1);
      tone(v, { t: t + 0.08, f: 110 * p, g: 0.25, d: 0.1 });
      noise(v, { t: t + 0.13, ftype: 'bandpass', f: 3200 * p, f1: 1800 * p, q: 1.0, g: 0.2, a: 0.02, hold: 0.04, d: 0.16 });
    }],
    wiggle: [0.45, function (v, t, p) {
      noise(v, { t: t, ftype: 'bandpass', f: 1700 * p, q: 1.5, g: 0.3, a: 0.015, d: 0.06 });
      noise(v, { t: t + 0.09, ftype: 'bandpass', f: 1450 * p, q: 1.5, g: 0.25, a: 0.015, d: 0.06 });
      board(v, t + 0.02, 380 * p, 0.08, 0.06, 1.2);
    }],
    click: [0.6, function (v, t, p) {
      // カ・チッ（ラッチの二段）
      noise(v, { t: t, ftype: 'bandpass', f: 2000 * p, q: 3, g: 0.35, d: 0.02 });
      noise(v, { t: t + 0.022, ftype: 'highpass', f: 2800 * p, q: 0.8, g: 0.9, d: 0.012 });
      noise(v, { t: t + 0.022, ftype: 'bandpass', f: 2300 * p, q: 12, g: 1.1, d: 0.04 });
      tone(v, { t: t + 0.022, f: 1450 * p, g: 0.22, d: 0.035 });
      tone(v, { t: t + 0.022, f: 320 * p, g: 0.25, d: 0.05 });
    }],
    eject: [0.55, function (v, t, p) {
      noise(v, { t: t, ftype: 'bandpass', f: 2600 * p, q: 6, g: 0.7, d: 0.03 });
      tone(v, { t: t, f: 260 * p, g: 0.25, d: 0.06 });
      noise(v, { t: t + 0.035, ftype: 'bandpass', f: 3300 * p, q: 5, g: 0.45, d: 0.025 });
      noise(v, { t: t + 0.06, ftype: 'bandpass', f: 1900 * p, q: 5, g: 0.4, d: 0.04 });
      tone(v, { t: t + 0.06, f: 900 * p, g: 0.1, d: 0.05 });
    }],
    lamp: [0.5, function (v, t, p) {
      noise(v, { t: t, ftype: 'highpass', f: 3500 * p, q: 0.7, g: 0.7, d: 0.008 });
      noise(v, { t: t, ftype: 'bandpass', f: 2500 * p, q: 10, g: 0.8, d: 0.028 });
      tone(v, { t: t, f: 700 * p, g: 0.12, d: 0.03 });
      noise(v, { t: t + 0.014, ftype: 'bandpass', f: 4200 * p, q: 6, g: 0.25, d: 0.012 });
    }],
    rev: [0.5, function (v, t, p) {
      var dur = 0.36;
      var f = 165 * p;
      var lp = filt(v, 'lowpass', 2200, 0.9);
      var g = gainNode(v, 0), gp = g.gain;
      gp.setValueAtTime(0, t);
      gp.linearRampToValueAtTime(0.2, t + 0.05);
      gp.setValueAtTime(0.2, t + 0.14);
      gp.linearRampToValueAtTime(0, t + dur);
      lp.connect(g); g.connect(v.out);
      var specs = [['sawtooth', 1, 0.55], ['square', 2.003, 0.16], ['sine', 5.2, 0.12]];
      for (var i = 0; i < specs.length; i++) {
        var o = ctx.createOscillator(); o.type = specs[i][0];
        var m = specs[i][1], fr = o.frequency;
        fr.setValueAtTime(f * 0.3 * m, t);
        fr.exponentialRampToValueAtTime(f * m, t + 0.09);
        fr.setValueAtTime(f * m, t + 0.14);
        fr.exponentialRampToValueAtTime(f * 0.35 * m, t + dur);
        var og = gainNode(v, specs[i][2]); o.connect(og); og.connect(lp);
        v.src(o, t, t + dur + 0.02);
      }
      noise(v, { t: t, ftype: 'bandpass', f: 1800, f1: 3800, glide: 0.09, q: 1, g: 0.05, a: 0.06, hold: 0.08, d: 0.2 });
    }],
    ping: [0.38, function (v, t, p) {
      var f = 784 * p;
      tone(v, { t: t, f: f, g: 0.5, d: 1.4, a: 0.006 });
      tone(v, { t: t, f: f * 2.0, g: 0.12, d: 0.7, a: 0.004, detune: 4 });
      tone(v, { t: t, f: f * 2.76, g: 0.05, d: 0.35, a: 0.003 });
    }],
    sparkle: [0.3, function (v, t, p) {
      var ns = [1318.5, 1568, 2093];
      for (var i = 0; i < ns.length; i++) {
        tone(v, { t: t + i * 0.075, f: ns[i] * p, g: 0.45 - i * 0.06, d: 0.55, a: 0.003 });
        tone(v, { t: t + i * 0.075, f: ns[i] * p * 2.98, g: 0.05, d: 0.15, a: 0.002 });
      }
    }],
    chord: [0.35, function (v, t, p) {
      var ns = [72, 76, 79, 84, 88]; // C5 E5 G5 C6 E6
      for (var i = 0; i < ns.length; i++) mbox(v, t + i * 0.12, mtof(ns[i]) * p, 0.4, 1.1);
      var tf = t + ns.length * 0.12 + 0.06;
      mbox(v, tf, mtof(79) * p, 0.25, 1.0);
      mbox(v, tf, mtof(84) * p, 0.3, 1.0);
      mbox(v, tf, mtof(91) * p, 0.18, 0.9);
    }],
    lullaby: [0.36, function (v, t, p) {
      // オリジナル: 3拍子 8小節、ハ長調、ゆっくり（最後にリタルダンド）
      var mel = [
        [76, 2], [74, 1], [72, 2], [67, 1], [69, 1], [72, 1], [77, 1], [76, 3],
        [74, 2], [76, 1], [77, 1], [76, 1], [74, 1], [67, 1], [71, 1], [74, 1], [72, 3]
      ];
      var bass = [48, 45, 41, 48, 43, 50, 43, 48];
      var fifth = [55, 52, 48, 55, 50, 57, 50, 55];
      var beat = 0.3, tt = t, b = 0, i;
      var beatTime = [];
      for (i = 0; i <= 24; i++) {
        beatTime.push(tt);
        var slow = i >= 18 ? 1 + (i - 18) * 0.09 : 1;
        tt += beat * slow;
      }
      for (i = 0; i < mel.length; i++) {
        var st = beatTime[b];
        var last = i === mel.length - 1;
        mbox(v, st, mtof(mel[i][0]) * p, 0.36, last ? 2.0 : 1.2 + mel[i][1] * 0.25);
        b += mel[i][1];
      }
      for (i = 0; i < 8; i++) {
        var bt = beatTime[i * 3];
        mbox(v, bt, mtof(bass[i]) * p, 0.2, 1.6);
        mbox(v, beatTime[i * 3 + 1] + 0.02, mtof(fifth[i]) * p, 0.09, 0.8);
      }
      var fin = beatTime[21];
      mbox(v, fin + 0.05, mtof(64) * p, 0.1, 2.0);
      mbox(v, fin + 0.1, mtof(67) * p, 0.09, 2.0);
    }],
    whoosh: [0.4, function (v, t, p) {
      noise(v, { t: t, ftype: 'bandpass', f: 380 * p, f1: 1700 * p, glide: 0.18, q: 1.3, g: 0.5, a: 0.14, d: 0.22 });
      noise(v, { t: t + 0.05, ftype: 'bandpass', f: 900 * p, f1: 2600 * p, glide: 0.2, q: 2, g: 0.15, a: 0.1, d: 0.18 });
    }]
  };

  function play(name, opts) {
    try {
      if (!ready()) return;
      var def = Object.prototype.hasOwnProperty.call(SFX, name) ? SFX[name] : null;
      if (!def) return;
      opts = opts || {};
      var vol = clamp(num(opts.vol, 1), 0, 2);
      var pitch = clamp(num(opts.pitch, 1), 0.25, 4);
      var delay = clamp(num(opts.delay, 0), 0, 30);
      if (vol <= 0.001) return;
      var t = ctx.currentTime + 0.005 + delay;
      var v = makeVoice(name, t);
      v.out.gain.value = def[0] * vol;
      def[1](v, t, pitch);
      if (v.live <= 0) v.free();
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- 電動ドリル（連続）
  var F0 = 168; // 空回しの基音
  function buildMotor() {
    var m = {};
    var t = ctx.currentTime;
    m.out = gainNode(null, 0); m.out.connect(bus);
    m.am = gainNode(null, 1); m.am.connect(m.out);
    m.lp = filt(null, 'lowpass', 2400, 0.9); m.lp.connect(m.am);
    m.pk = filt(null, 'peaking', 950, 1.2); m.pk.gain.value = 4; m.pk.connect(m.lp);
    m.mix = gainNode(null, 1); m.mix.connect(m.pk);
    m.oscs = [];
    function osc(type, mul, g) {
      var o = ctx.createOscillator(); o.type = type; o.frequency.value = F0 * 0.25 * mul;
      var og = gainNode(null, g); o.connect(og); og.connect(m.mix);
      o.start(t); m.oscs.push({ o: o, mul: mul, g: og });
      return og;
    }
    osc('sawtooth', 1, 0.5);
    osc('square', 2.003, 0.14);
    m.subG = osc('triangle', 0.5, 0.1);
    osc('sine', 5.2, 0.06);  // ギアの高いうなり
    // ギアの「シャー」
    m.nz = ctx.createBufferSource(); m.nz.buffer = noiseBuf; m.nz.loop = true;
    m.hbp = filt(null, 'bandpass', 3600, 0.9);
    m.hiss = gainNode(null, 0);
    m.nz.connect(m.hbp); m.hbp.connect(m.hiss); m.hiss.connect(m.out);
    // 木に食い込むざらつき
    m.gbp = filt(null, 'bandpass', 280, 0.8);
    m.grit = gainNode(null, 0);
    m.gritAm = gainNode(null, 0.5);
    m.nz.connect(m.gbp); m.gbp.connect(m.grit); m.grit.connect(m.gritAm); m.gritAm.connect(m.out);
    m.nz.start(t);
    // 低い唸りのチョップ（負荷で増える）
    m.chop = ctx.createOscillator(); m.chop.type = 'triangle'; m.chop.frequency.value = 31;
    m.chopToGrit = gainNode(null, 0.5); m.chop.connect(m.chopToGrit); m.chopToGrit.connect(m.gritAm.gain);
    m.chopToAm = gainNode(null, 0); m.chop.connect(m.chopToAm); m.chopToAm.connect(m.am.gain);
    m.chop.start(t);
    // 回転むら
    m.wob = ctx.createOscillator(); m.wob.type = 'sine'; m.wob.frequency.value = 6.7;
    m.wobG = gainNode(null, 7);
    m.wob.connect(m.wobG);
    m.wob2 = ctx.createOscillator(); m.wob2.type = 'sine'; m.wob2.frequency.value = 0.83;
    m.wob2G = gainNode(null, 10);
    m.wob2.connect(m.wob2G);
    // 電池切れのよろよろ
    m.stut = ctx.createOscillator(); m.stut.type = 'sine'; m.stut.frequency.value = 3.4;
    m.stutCents = gainNode(null, 0);
    m.stutAm = gainNode(null, 0);
    m.stut.connect(m.stutCents); m.stut.connect(m.stutAm); m.stutAm.connect(m.am.gain);
    for (var i = 0; i < m.oscs.length; i++) {
      m.wobG.connect(m.oscs[i].o.detune);
      m.wob2G.connect(m.oscs[i].o.detune);
      m.stutCents.connect(m.oscs[i].o.detune);
    }
    m.wob.start(t); m.wob2.start(t); m.stut.start(t);
    m.bs = 1; m.lastMs = nowMs(); m.prev = null; m.on = false;
    return m;
  }

  function setT(param, v, t, tau) { param.setTargetAtTime(v, t, tau); }

  function silenceMotor() {
    if (!motor || !ctx) return;
    try {
      var n = ctx.currentTime;
      var ps = [motor.out.gain, motor.hiss.gain, motor.grit.gain];
      for (var i = 0; i < ps.length; i++) {
        ps[i].cancelScheduledValues(n); ps[i].setValueAtTime(0, n);
      }
      for (var k = 0; k < motor.oscs.length; k++) {
        var f = motor.oscs[k].o.frequency;
        f.cancelScheduledValues(n); f.setValueAtTime(F0 * 0.25 * motor.oscs[k].mul, n);
      }
      motor.prev = null; motor.on = false;
    } catch (e) { }
  }

  function drill(on, opts) {
    try {
      if (!ready()) return;
      on = !!on;
      if (!motor) { if (!on) return; motor = buildMotor(); }
      opts = opts || {};
      var load = clamp(num(opts.load, 0), 0, 1);
      var bat = clamp(num(opts.battery, 1), 0, 1);
      var m = motor;
      var ms = nowMs(), dt = clamp((ms - m.lastMs) / 1000, 0, 0.25);
      m.lastMs = ms;
      // 電池はゆっくり落ちる（うぃ…ぃ…ん）、交換したらすぐ戻る
      if (bat < m.bs) m.bs += (bat - m.bs) * (1 - Math.exp(-dt / 0.45));
      else m.bs += (bat - m.bs) * (1 - Math.exp(-dt / 0.05));
      var bs = m.bs;
      var pw = Math.pow(clamp(bs / 0.6, 0, 1), 0.8);
      var run = on && bs > 0.035;
      var lo = run ? 1 - pw : 0;

      var freq = run ? F0 * (1 - 0.38 * load) * (0.28 + 0.72 * pw) : F0 * 0.25;
      var level = run ? 0.17 * (0.3 + 0.7 * pw) * (1 + 0.15 * load) : 0;
      var cut = (2400 - 950 * load) * (0.5 + 0.5 * pw);
      var hiss = run ? 0.03 * pw * pw * (1 - 0.45 * load) : 0;
      var grit = run ? 0.11 * load * pw : 0;
      var sub = 0.1 + 0.35 * load;
      var stc = 300 * lo * lo;
      var sta = 0.4 * lo * lo;
      var chop = 0.28 * load * (run ? 1 : 0);

      var cur = [freq, level, cut, hiss, grit, sub, stc, sta, chop];
      var prev = m.prev, changed = !prev || run !== m.on;
      if (!changed) {
        for (var i = 0; i < cur.length; i++) {
          var a = cur[i], b = prev[i];
          if (Math.abs(a - b) > Math.max(1e-4, Math.abs(b) * 0.01)) { changed = true; break; }
        }
      }
      if (!changed) return;
      var starting = run && !m.on;
      m.on = run; m.prev = cur;
      var n = ctx.currentTime;
      var tf = run ? (starting ? 0.04 : 0.06) : 0.075;   // 回り出し約0.12秒 / 惰性停止約0.2秒
      var tg = run ? 0.03 : 0.055;
      if (starting) {
        for (var s = 0; s < m.oscs.length; s++) {
          var fp = m.oscs[s].o.frequency;
          fp.cancelScheduledValues(n);
          fp.setValueAtTime(Math.max(F0 * 0.2 * m.oscs[s].mul, fp.value), n);
        }
      }
      for (var k = 0; k < m.oscs.length; k++) setT(m.oscs[k].o.frequency, freq * m.oscs[k].mul, n, tf);
      setT(m.out.gain, level, n, tg);
      setT(m.lp.frequency, Math.max(300, cut), n, 0.08);
      setT(m.pk.frequency, freq * 5.6, n, tf);
      setT(m.hiss.gain, hiss, n, tg);
      setT(m.hbp.frequency, 1800 + 1900 * (freq / F0), n, tf);
      setT(m.grit.gain, grit, n, 0.06);
      setT(m.subG.gain, sub, n, 0.08);
      setT(m.stutCents.gain, stc, n, 0.1);
      setT(m.stutAm.gain, sta, n, 0.1);
      setT(m.chopToAm.gain, chop, n, 0.08);
      setT(m.chop.frequency, Math.max(12, freq * 0.2), n, 0.08);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- クラッチ
  function clutchOff() {
    if (!clutchSt.on) return;
    clutchSt.on = false;
    try {
      var n = ctx.currentTime, g = clutchSt.g, s = clutchSt.src;
      g.gain.cancelScheduledValues(n);
      g.gain.setValueAtTime(g.gain.value, n);
      g.gain.setTargetAtTime(0, n, 0.012);
      s.stop(n + 0.1);
    } catch (e) { }
    clutchSt.src = null; clutchSt.g = null;
  }

  function clutch(on) {
    try {
      on = !!on;
      if (!on) { if (ctx) clutchOff(); return; }
      if (!ready() || clutchSt.on) return;
      var n = ctx.currentTime;
      var s = ctx.createBufferSource();
      s.buffer = clutchBuf; s.loop = true;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, n);
      g.gain.linearRampToValueAtTime(0.42, n + 0.008);
      s.connect(lp); lp.connect(g); g.connect(bus);
      s.onended = function () {
        try { s.disconnect(); lp.disconnect(); g.disconnect(); } catch (e) { }
      };
      s.start(n);
      clutchSt.on = true; clutchSt.src = s; clutchSt.g = g;
    } catch (e) { /* ignore */ }
  }

  G.Audio = { unlock: unlock, setPaused: setPaused, drill: drill, clutch: clutch, play: play };
})();
