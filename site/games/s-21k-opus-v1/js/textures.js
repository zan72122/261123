// textures.js — 手続き生成の質感（木目・段ボール表紙・紙・ゴム）と材質
(function () {
  'use strict';
  var G = window.G;

  function canvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  var HT = new Float32Array(65536);
  for (var hi = 0; hi < 65536; hi++) HT[hi] = Math.random();
  function hash(x, y) { return HT[(x & 255) | ((y & 255) << 8)]; }
  // 継ぎ目なく繰り返せる値ノイズ（周期 px, py）
  function vnoise(x, y, px, py) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    var a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // u,v は 0..1、fx, fy は整数の基本周波数
  function fbm(u, v, fx, fy, oct) {
    var s = 0, amp = 0.5, f = 1;
    for (var i = 0; i < oct; i++) { s += amp * vnoise(u * fx * f, v * fy * f, fx * f, fy * f); f *= 2; amp *= 0.5; }
    return s;
  }
  function toTex(c, repeat, srgb) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  // 画素ごとに色を決める
  function paint(w, h, fn) {
    var c = canvas(w, h), ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var col = fn(x / w, y / h, x, y), i = (y * w + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  var T = (G.tex = {});

  T.build = function () {
    // 机の木目（明るい楢）
    var wood = paint(512, 512, function (u, v) {
      var warp = fbm(u, v, 3, 18, 4) * 0.9;
      var ring = Math.sin((v * 34 + warp * 6 + fbm(u, v, 2, 2, 3) * 3) * Math.PI);
      var g = 0.5 + 0.5 * ring;
      var streak = fbm(u, v, 60, 3, 3);
      var k = 0.82 + 0.1 * g + 0.1 * streak;
      return [Math.min(255, 205 * k), Math.min(255, 160 * k), Math.min(255, 112 * k)];
    });
    T.desk = toTex(wood, [3, 2]);
    var woodR = paint(256, 256, function (u, v) {
      var s = fbm(u, v, 40, 4, 3);
      var g = 150 + 70 * s; return [g, g, g];
    });
    T.deskRough = toTex(woodR, [3, 2], false);

    // 段ボール表紙（クラフト紙の繊維）
    var kraft = paint(512, 512, function (u, v, x, y) {
      var f = fbm(u, v, 24, 24, 4);
      var fiber = fbm(u, v, 200, 14, 2);
      var speck = hash(x, y) > 0.985 ? -0.12 : 0;
      var k = 0.9 + 0.1 * f + 0.05 * fiber + speck;
      return [196 * k, 150 * k, 102 * k];
    });
    T.kraft = toTex(kraft, [0.14, 0.14]);
    // 表紙のうっすらした凹凸（中芯の山の跡）
    var flute = paint(256, 64, function (u, v) {
      var s = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 24);
      var g = 128 + 30 * s + 20 * (fbm(u, v, 40, 6, 2) - 0.5); return [g, g, g];
    });
    T.kraftBump = toTex(flute, [0.14, 0.56], false);

    // 中芯（波板）の少し明るい紙
    var medium = paint(128, 128, function (u, v) {
      var k = 0.9 + 0.12 * fbm(u, v, 20, 20, 3);
      return [214 * k, 172 * k, 120 * k];
    });
    T.medium = toTex(medium, [2, 2]);

    // 回転盤の縁（貼り合わせた段ボールの層）
    var layers = paint(256, 64, function (u, v) {
      var layer = Math.floor(v * 5), lv = v * 5 - layer;
      var wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 40 + layer * 1.3);
      var inLiner = lv < 0.14 || lv > 0.86;
      var dark = inLiner ? 0.95 : (Math.abs(lv - 0.5 - (wave - 0.5) * 0.6) < 0.08 ? 1.0 : 0.62);
      var k = dark * (0.9 + 0.1 * fbm(u, v, 30, 10, 2));
      return [190 * k, 145 * k, 98 * k];
    });
    T.layers = toTex(layers, [4, 1]);

    // 紙包み（生成りの紙）
    var paper = paint(256, 256, function (u, v) {
      var f = fbm(u, v, 30, 30, 3), fib = fbm(u, v, 120, 8, 2);
      var k = 0.93 + 0.05 * f + 0.03 * fib;
      return [244 * k, 236 * k, 220 * k];
    });
    T.paper = toTex(paper, [1, 1]);

    // 消しゴム（細かい粒）
    var rubber = paint(128, 128, function (u, v, x, y) {
      var k = 0.94 + 0.06 * hash(x, y) + 0.04 * fbm(u, v, 10, 10, 2);
      return [246 * k, 170 * k, 182 * k];
    });
    T.rubber = toTex(rubber, [1, 1]);

    // こまの木
    var top = paint(256, 64, function (u, v) {
      var ring = 0.5 + 0.5 * Math.sin((v * 22 + fbm(u, v, 4, 6, 3) * 2) * Math.PI);
      var k = 0.86 + 0.12 * ring;
      return [222 * k, 180 * k, 128 * k];
    });
    T.topWood = toTex(top, [1, 1]);

    // 受け皿の底など少し灰色がかった厚紙
    var board = paint(256, 256, function (u, v) {
      var k = 0.9 + 0.1 * fbm(u, v, 18, 18, 4);
      return [178 * k, 150 * k, 118 * k];
    });
    T.greyboard = toTex(board, [1, 1]);
  };

  var M = (G.mat = {});
  M.build = function () {
    M.desk = new THREE.MeshStandardMaterial({ map: T.desk, roughnessMap: T.deskRough, roughness: 0.78, metalness: 0 });
    M.liner = new THREE.MeshStandardMaterial({ map: T.kraft, bumpMap: T.kraftBump, bumpScale: 0.6, roughness: 0.92, metalness: 0 });
    M.linerIn = new THREE.MeshStandardMaterial({ map: T.kraft, color: 0xe8d8c0, roughness: 0.95 });
    M.medium = new THREE.MeshStandardMaterial({ map: T.medium, roughness: 0.95, side: THREE.DoubleSide });
    M.gap = new THREE.MeshStandardMaterial({ color: 0x5a3e22, roughness: 1, side: THREE.DoubleSide });
    M.crease = new THREE.MeshStandardMaterial({ map: T.kraft, color: 0xb59575, roughness: 0.97 });
    M.layers = new THREE.MeshStandardMaterial({ map: T.layers, roughness: 0.93 });
    M.paper = new THREE.MeshStandardMaterial({ map: T.paper, roughness: 0.9, side: THREE.DoubleSide });
    M.rubber = new THREE.MeshStandardMaterial({ map: T.rubber, roughness: 0.85 });
    M.topWood = new THREE.MeshStandardMaterial({ map: T.topWood, roughness: 0.55 });
    M.dowel = new THREE.MeshStandardMaterial({ map: T.topWood, color: 0xf2e2c6, roughness: 0.6 });
    M.tray = new THREE.MeshStandardMaterial({ map: T.greyboard, roughness: 0.95 });
    M.clear = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22,
      clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.3
    });
    M.windowPl = new THREE.MeshPhysicalMaterial({
      color: 0xf4fbff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13,
      clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5
    });
    M.windowEdge = new THREE.MeshPhysicalMaterial({ color: 0xdcefff, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });
    M.shells = [
      new THREE.MeshPhysicalMaterial({ color: 0xf6b8c6, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 }), // 桃
      new THREE.MeshPhysicalMaterial({ color: 0xb9e2c4, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 }), // 若草
      new THREE.MeshPhysicalMaterial({ color: 0xb8d6f2, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 })  // 空
    ];
    M.ghost = new THREE.MeshStandardMaterial({ color: 0xfff4ec, roughness: 0.4, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false });
    M.ghostNail = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false });
    M.dent = new THREE.MeshStandardMaterial({ map: T.kraft, color: 0xa88866, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    M.fiber = new THREE.MeshStandardMaterial({ color: 0xcaa57a, roughness: 1 });
    M.occluder = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    M.windowFrame = new THREE.MeshStandardMaterial({ color: 0xf3efe7, roughness: 0.6 });
  };
})();
