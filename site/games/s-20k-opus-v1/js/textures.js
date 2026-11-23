/* textures.js — 手続きで作る素材の模様（木目・竹の筋・金網・ざるの編み目・中敷き） */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;

  function tex(canvas, repeat, srgb) {
    var t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function rgba(r, g, b, a) { return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')'; }

  // 明るい木の天板
  SG.texWood = function () {
    var w = 1024, h = 512;
    var c = SG.makeCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#d9b98c';
    g.fillRect(0, 0, w, h);
    var R = SG.rand;
    // 板の継ぎ目ごとの色むら
    for (var p = 0; p < 4; p++) {
      g.fillStyle = rgba(200 + R() * 30, 160 + R() * 30, 110 + R() * 25, 0.35);
      g.fillRect(0, p * h / 4, w, h / 4);
    }
    // 木目
    for (var i = 0; i < 260; i++) {
      var y0 = R() * h;
      var amp = 2 + R() * 6, fr = 0.002 + R() * 0.006, ph = R() * 10;
      g.strokeStyle = rgba(150 + R() * 40, 105 + R() * 30, 60 + R() * 20, 0.08 + R() * 0.16);
      g.lineWidth = 0.6 + R() * 1.8;
      g.beginPath();
      for (var x = 0; x <= w; x += 8) {
        var y = y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 3.1 + ph * 2) * amp * 0.3;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    // 板の継ぎ目
    g.strokeStyle = 'rgba(120,85,50,0.35)';
    g.lineWidth = 1.5;
    for (var q = 1; q < 4; q++) { g.beginPath(); g.moveTo(0, q * h / 4); g.lineTo(w, q * h / 4); g.stroke(); }
    return tex(c, [1 / 7, 1 / 7]);
  };

  // 竹調の樋：長さ方向（u）に走る細い筋。v は断面方向。
  SG.texBamboo = function () {
    var w = 256, h = 512;
    var c = SG.makeCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#d8d49c';
    g.fillRect(0, 0, w, h);
    var R = SG.rand;
    for (var i = 0; i < 150; i++) {
      var y = R() * h;
      var light = R() < 0.5;
      g.strokeStyle = light ? rgba(245, 240, 196, 0.25 + R() * 0.3) : rgba(165, 160, 92, 0.18 + R() * 0.3);
      g.lineWidth = 0.6 + R() * 1.4;
      g.beginPath();
      g.moveTo(0, y);
      for (var x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 0.4);
      g.stroke();
    }
    // ごくうすい色むら
    for (var k = 0; k < 40; k++) {
      g.fillStyle = rgba(190 + R() * 40, 190 + R() * 30, 120 + R() * 30, 0.06);
      g.fillRect(R() * w, 0, 10 + R() * 40, h);
    }
    return tex(c, [1, 1]);
  };

  // 金網（透け）— alphaMap 用（白が網、黒が穴）
  SG.texMesh = function () {
    var w = 128;
    var c = SG.makeCanvas(w, w), g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    var n = 4;
    for (var i = 0; i <= n; i++) {
      var p = i * w / n;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke();
    }
    var t = tex(c, [14, 14], false);
    return t;
  };

  // ざるの編み目（色）と穴（alpha）
  SG.texWeave = function () {
    var w = 256;
    var c = SG.makeCanvas(w, w), g = c.getContext('2d');
    var a = SG.makeCanvas(w, w), ga = a.getContext('2d');
    g.fillStyle = '#c7b27a'; g.fillRect(0, 0, w, w);
    ga.fillStyle = '#000'; ga.fillRect(0, 0, w, w);
    var n = 8, s = w / n;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var over = (i + j) % 2 === 0;
        var x = i * s, y = j * s;
        var grd = g.createLinearGradient(x, y, over ? x + s : x, over ? y : y + s);
        grd.addColorStop(0, '#b89d62'); grd.addColorStop(0.5, '#e3d29e'); grd.addColorStop(1, '#b4985c');
        g.fillStyle = grd;
        if (over) g.fillRect(x + 1, y + s * 0.18, s - 2, s * 0.64);
        else g.fillRect(x + s * 0.18, y + 1, s * 0.64, s - 2);
        ga.fillStyle = '#fff';
        ga.fillRect(x, y + s * 0.12, s, s * 0.76);
        ga.fillRect(x + s * 0.12, y, s * 0.76, s);
      }
    }
    return { map: tex(c, [6, 6]), alpha: tex(a, [6, 6], false) };
  };

  // 白い中敷き（細かな凹凸）
  SG.texLiner = function () {
    var w = 256;
    var c = SG.makeCanvas(w, w), g = c.getContext('2d');
    g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, w, w);
    var R = SG.rand;
    for (var i = 0; i < 1600; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(205,205,198,0.35)';
      g.beginPath();
      g.arc(R() * w, R() * w, 0.8 + R() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(210,212,205,0.5)';
    g.lineWidth = 1;
    for (var k = 0; k < w; k += 8) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, w); g.stroke();
    }
    return tex(c, [3, 3]);
  };

  // 陶器のうすい斑点
  SG.texGlaze = function (base, speck) {
    var w = 256;
    var c = SG.makeCanvas(w, w), g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, w, w);
    var R = SG.rand;
    for (var i = 0; i < 500; i++) {
      g.fillStyle = speck;
      g.globalAlpha = 0.1 + R() * 0.3;
      g.beginPath(); g.arc(R() * w, R() * w, 0.5 + R() * 1.2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    return tex(c, [2, 1]);
  };

  // 水面のさざ波（normalMap 用、ゆっくり動かす）
  SG.texRippleNormal = function () {
    var w = 128;
    var c = SG.makeCanvas(w, w), g = c.getContext('2d');
    var img = g.createImageData(w, w);
    var d = img.data;
    function hgt(x, y) {
      var v = 0;
      v += Math.sin((x * 2 + y) * Math.PI * 2 / w * 2) * 0.5;
      v += Math.sin((x - y * 3) * Math.PI * 2 / w * 3) * 0.3;
      v += Math.sin((x * 5 + y * 2) * Math.PI * 2 / w) * 0.2;
      return v;
    }
    for (var y = 0; y < w; y++) {
      for (var x = 0; x < w; x++) {
        var dx = hgt(x + 1, y) - hgt(x - 1, y);
        var dy = hgt(x, y + 1) - hgt(x, y - 1);
        var nx = -dx * 0.6, ny = -dy * 0.6, nz = 1;
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var i = (y * w + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255;
        d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, [3, 3], false);
  };
})();
