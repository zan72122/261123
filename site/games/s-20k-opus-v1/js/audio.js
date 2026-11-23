/* audio.js — Web Audio で合成する音。最初のタッチで鳴り始める */
(function () {
  'use strict';
  var SG = window.SG;

  function Audio() {
    this.ctx = null;
    this.ready = false;
    this.loops = {};
  }

  Audio.prototype.start = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = this.ctx = new AC();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);
    // 白いノイズ
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // ずっと鳴る音：注ぐ音、樋を流れる音、水受けに落ちる音
    this.loops.pour = this._loop(1400, 1.2, 'bandpass');
    this.loops.flow = this._loop(2600, 0.9, 'bandpass', true);
    this.loops.fall = this._loop(900, 0.8, 'lowpass');
    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume();
  };

  Audio.prototype._loop = function (freq, q, type, lfo) {
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    if (lfo) {
      var o = ctx.createOscillator(); o.frequency.value = 5.3;
      var og = ctx.createGain(); og.gain.value = 0;
      o.connect(og); og.connect(g.gain);
      o.start();
      this._lfoG = og;
    }
    src.start();
    return { f: f, g: g, cur: 0 };
  };
  Audio.prototype.setLoop = function (name, level, freq) {
    if (!this.ready) return;
    var l = this.loops[name];
    var t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(level, t, 0.08);
    if (freq) l.f.frequency.setTargetAtTime(freq, t, 0.1);
    if (name === 'flow' && this._lfoG) this._lfoG.gain.setTargetAtTime(level * 0.35, t, 0.1);
  };

  Audio.prototype._env = function (g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  };
  Audio.prototype._noiseBurst = function (t, type, freq, q, peak, dec, a) {
    var ctx = this.ctx;
    var s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, t, a || 0.002, peak, dec);
    s.start(t, Math.random() * 1.5); s.stop(t + (a || 0.002) + dec + 0.05);
    return f;
  };
  Audio.prototype._tone = function (t, type, f0, f1, peak, dec, a) {
    var ctx = this.ctx;
    var o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (a || 0.003) + dec);
    var g = ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, t, a || 0.003, peak, dec);
    o.start(t); o.stop(t + (a || 0.003) + dec + 0.05);
  };

  // 樋が座る乾いた音：長い樋ほど低く短く
  Audio.prototype.seat = function (len) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var f = 880 / Math.pow(Math.max(0.6, len), 0.55);
    var dec = 0.16 / Math.pow(Math.max(0.6, len), 0.45);
    this._tone(t, 'triangle', f, f * 0.82, 0.32, dec);
    this._tone(t, 'sine', f * 2.3, f * 2.0, 0.08, dec * 0.6);
    this._noiseBurst(t, 'bandpass', f * 3, 2.5, 0.18, 0.03);
  };
  // 支柱の段（カチ）
  Audio.prototype.click = function (up) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._noiseBurst(t, 'highpass', up ? 3800 : 3000, 1.2, 0.22, 0.018);
    this._tone(t, 'square', up ? 1900 : 1500, up ? 1700 : 1300, 0.04, 0.02);
  };
  // 滑り止めがへこむ
  Audio.prototype.squish = function (k) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'sine', 180, 95, 0.12 * (k || 1), 0.09, 0.01);
    this._noiseBurst(t, 'lowpass', 600, 0.7, 0.05 * (k || 1), 0.06, 0.01);
  };
  // 鞍のはね返り
  Audio.prototype.boing = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'sine', 420, 360, 0.08, 0.12, 0.004);
  };
  // 支柱が起き上がる
  Audio.prototype.rise = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'sine', 260, 520, 0.1, 0.28, 0.03);
    this._noiseBurst(t + 0.25, 'bandpass', 1300, 2, 0.12, 0.05);
    this._tone(t + 0.25, 'triangle', 700, 600, 0.15, 0.08);
  };
  // しずくの着水：落ちた高さで音の高さが変わる
  Audio.prototype.drip = function (fallH, onWater) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var base = 1400 - SG.clamp(fallH, 0, 3) * 220;
    if (onWater) {
      this._tone(t, 'sine', base * 0.55, base * 1.25, 0.12 + SG.clamp(fallH, 0, 2) * 0.03, 0.07, 0.002);
    } else {
      this._noiseBurst(t, 'bandpass', base * 1.5, 3, 0.06, 0.03);
    }
  };
  // つゆを打つ音（たまった量でわずかに高く）
  Audio.prototype.plop = function (fill) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var f = 300 + SG.clamp(fill, 0, 30) * 9;
    this._tone(t, 'sine', f, f * 2.1, 0.2, 0.09, 0.004);
    this._noiseBurst(t, 'lowpass', 1200, 0.8, 0.07, 0.07);
  };
  Audio.prototype.basinPlop = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'sine', 380, 700, 0.07, 0.07, 0.004);
  };
  // 網に麺が掛かる（湿った音）
  Audio.prototype.wet = function (k) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._noiseBurst(t, 'lowpass', 900, 0.9, 0.14 * (k || 1), 0.08, 0.004);
    this._tone(t, 'sine', 240, 160, 0.05 * (k || 1), 0.06);
  };
  // 麺をつまむ・押す
  Audio.prototype.pick = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._noiseBurst(t, 'bandpass', 1800, 1.5, 0.06, 0.06, 0.01);
    this._tone(t, 'sine', 520, 760, 0.04, 0.08, 0.01);
  };
  Audio.prototype.press = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._noiseBurst(t, 'bandpass', 1100, 1.2, 0.08, 0.1, 0.01);
  };
  // まだ使えない物にさわった（やさしく揺れる）
  Audio.prototype.tap = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'sine', 660, 620, 0.06, 0.08);
  };
  Audio.prototype.lift = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'triangle', 500, 640, 0.05, 0.07, 0.01);
  };
  Audio.prototype.dock = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._tone(t, 'triangle', 1500, 1350, 0.1, 0.07);
    this._tone(t, 'sine', 3100, 2900, 0.03, 0.12);
  };

  SG.Audio = Audio;
})();
