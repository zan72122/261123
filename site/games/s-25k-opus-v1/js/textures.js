// textures.js — 木目・コルク・フェルト・玉の筋を手続き的に描く
(function () {
  'use strict';
  var KK = window.KK, T = THREE;

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 整数ハッシュによる値ノイズ
  function hash(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
    var c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // 横方向にラップする値ノイズ（周期 px）
  function vnoiseWrap(x, y, s, px) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
    var a = hash(x0, yi, s), b = hash(x1, yi, s);
    var c = hash(x0, yi + 1, s), d = hash(x1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) {
    var t = 0, amp = 0.5, f = 1;
    for (var i = 0; i < oct; i++) { t += vnoise(x * f, y * f, s + i * 17) * amp; f *= 2; amp *= 0.5; }
    return t;
  }
  KK.noise = { hash: hash, vnoise: vnoise, fbm: fbm };

  function texFrom(canvas, srgb, repeat) {
    var t = new T.CanvasTexture(canvas);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }

  // 木目: u が繊維方向。base/dark は [r,g,b]
  function woodCanvas(w, h, seed, base, dark, opts) {
    opts = opts || {};
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var img = g.createImageData(w, h), d = img.data;
    var bump = makeCanvas(w, h), gb = bump.getContext('2d');
    var bimg = gb.createImageData(w, h), bd = bimg.data;
    var rings = opts.rings || 9, warp = opts.warp || 2.4;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var nx = x / w, ny = y / h;
        var n1 = fbm(nx * 3, ny * 2, seed, 4);
        var n2 = vnoise(nx * 40, ny * 3, seed + 5);
        var ring = Math.sin((ny * rings + n1 * warp + Math.sin(nx * 6.28 * 0.5 + seed) * 0.3) * Math.PI * 2);
        var line = Math.pow(Math.abs(ring), 7);
        var pores = vnoise(nx * 220, ny * 18, seed + 9);
        var t = 0.18 + line * 0.55 + (n2 - 0.5) * 0.12 + (pores > 0.82 ? 0.12 : 0);
        t = KK.clamp(t, 0, 1);
        var i = (y * w + x) * 4;
        d[i] = base[0] + (dark[0] - base[0]) * t;
        d[i + 1] = base[1] + (dark[1] - base[1]) * t;
        d[i + 2] = base[2] + (dark[2] - base[2]) * t;
        d[i + 3] = 255;
        var b = 160 - line * 50 - (pores > 0.82 ? 30 : 0) + n2 * 20;
        bd[i] = bd[i + 1] = bd[i + 2] = b; bd[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    gb.putImageData(bimg, 0, 0);
    return { color: c, bump: bump };
  }

  KK.tex = {};

  KK.buildTextures = function () {
    var tx = KK.tex;
    var s = Math.floor(Math.random() * 1000);
    // 部品の明るい木（ブナ風）
    var light = woodCanvas(512, 128, 11 + s, [222, 190, 146], [176, 128, 80], { rings: 7 });
    tx.wood = texFrom(light.color, true);
    tx.woodBump = texFrom(light.bump, false);
    // 少し色違い
    var light2 = woodCanvas(512, 128, 37 + s, [214, 178, 132], [160, 112, 66], { rings: 11 });
    tx.wood2 = texFrom(light2.color, true);
    tx.wood2Bump = texFrom(light2.bump, false);
    // 濃い羽根用（クルミ風）
    var dark = woodCanvas(256, 64, 71 + s, [120, 76, 44], [58, 33, 18], { rings: 6, warp: 3 });
    tx.walnut = texFrom(dark.color, true);
    tx.walnutBump = texFrom(dark.bump, false);
    // 作業台（厚い板）
    var tab = woodCanvas(1024, 512, 5 + s, [178, 128, 82], [118, 74, 40], { rings: 16, warp: 3.5 });
    // 板の継ぎ目を描く
    var tg = tab.color.getContext('2d');
    tg.strokeStyle = 'rgba(60,36,18,0.55)'; tg.lineWidth = 2;
    for (var k = 1; k < 4; k++) {
      tg.beginPath(); tg.moveTo(0, k * 128); tg.lineTo(1024, k * 128); tg.stroke();
    }
    var tbg = tab.bump.getContext('2d');
    tbg.strokeStyle = 'rgb(60,60,60)'; tbg.lineWidth = 3;
    for (k = 1; k < 4; k++) {
      tbg.beginPath(); tbg.moveTo(0, k * 128); tbg.lineTo(1024, k * 128); tbg.stroke();
    }
    tx.table = texFrom(tab.color, true, [2, 2]);
    tx.tableBump = texFrom(tab.bump, false, [2, 2]);

    tx.cork = corkTex(s);
    tx.felt = feltTex([86, 104, 84], 3 + s);     // 脇の敷きフェルト（深い緑）
    tx.ballStripe = ballTex();
    tx.wall = wallTex();
  };

  function corkTex(seed) {
    var w = 512, h = 512;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var img = g.createImageData(w, h), d = img.data;
    var b = makeCanvas(w, h), gb = b.getContext('2d');
    var bimg = gb.createImageData(w, h), bd = bimg.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var n = vnoiseWrapCork(x, y, seed);
        var i = (y * w + x) * 4;
        var t = n;
        d[i] = 196 - t * 70; d[i + 1] = 152 - t * 62; d[i + 2] = 106 - t * 50; d[i + 3] = 255;
        bd[i] = bd[i + 1] = bd[i + 2] = 200 - t * 120; bd[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0); gb.putImageData(bimg, 0, 0);
    return { map: texFrom(c, true, [5, 5]), bump: texFrom(b, false, [5, 5]) };
  }
  function vnoiseWrapCork(x, y, seed) {
    // 粒の大きさを混ぜたコルク
    var a = vnoiseWrap(x / 3.1, y / 3.1, seed, 512 / 3.1 | 0);
    var b = vnoiseWrap(x / 9, y / 9, seed + 3, 512 / 9 | 0);
    var c = vnoiseWrap(x / 1.4, y / 1.4, seed + 7, 512 / 1.4 | 0);
    var v = a * 0.45 + b * 0.35 + c * 0.2;
    if (a > 0.86) v += 0.25;
    if (c < 0.08) v += 0.3;
    return KK.clamp(v, 0, 1);
  }

  // フェルト（細かい毛羽）
  function feltTex(col, seed) {
    var w = 256, h = 256;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var img = g.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var n = vnoiseWrap(x / 1.2, y / 1.2, seed, 213) * 0.5 + vnoiseWrap(x / 6, y / 6, seed + 4, 42) * 0.5;
        var i = (y * w + x) * 4;
        var k = 0.82 + n * 0.3;
        d[i] = col[0] * k; d[i + 1] = col[1] * k; d[i + 2] = col[2] * k; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { map: texFrom(c, true, [4, 4]), canvas: c };
  }
  KK.feltBaseFill = function (g, w, h, col, seed) {
    var img = g.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var n = vnoise(x / 1.3, y / 1.3, seed) * 0.45 + vnoise(x / 7, y / 7, seed + 4) * 0.35 + vnoise(x / 30, y / 30, seed + 8) * 0.2;
        var i = (y * w + x) * 4;
        var k = 0.84 + n * 0.28;
        d[i] = col[0] * k; d[i + 1] = col[1] * k; d[i + 2] = col[2] * k; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  };

  // 玉: 乳白色のガラスに細い青の筋（赤道の帯）
  function ballTex() {
    var w = 1024, h = 512;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var img = g.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      var lat = (0.5 - (y + 0.5) / h) * Math.PI;
      var band = Math.abs(lat);
      var core = KK.smooth(0.075, 0.045, band);      // 筋の芯
      var halo = KK.smooth(0.16, 0.05, band) * 0.25; // ガラスに滲む青
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var n = vnoise(x / 40, y / 40, 3) * 0.03;
        var wob = vnoise(x / 18, 1, 9) * 0.012;
        var c2 = KK.smooth(0.075 + wob, 0.045 + wob, band);
        var k = Math.max(c2, core * 0.9);
        var r = 244 - n * 255, gg = 241 - n * 255, b = 232 - n * 200;
        // 青
        r = r + (38 - r) * k + (150 - r) * halo * (1 - k);
        gg = gg + (96 - gg) * k + (190 - gg) * halo * (1 - k);
        b = b + (196 - b) * k + (232 - b) * halo * (1 - k);
        d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  function wallTex() {
    var w = 256, h = 256;
    var c = makeCanvas(w, h), g = c.getContext('2d');
    var img = g.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var n = fbm(x / 64, y / 64, 21, 4);
        var i = (y * w + x) * 4;
        d[i] = 206 + n * 30; d[i + 1] = 190 + n * 28; d[i + 2] = 168 + n * 24; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return texFrom(c, true, [3, 2]);
  }
})();
