/* util.js — shared math, noise, procedural textures, tweens */
(function () {
  'use strict';
  const U = (window.U = window.U || {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (e0, e1, x) => {
    const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  U.easeOut = (t) => 1 - Math.pow(1 - U.clamp(t, 0, 1), 3);
  U.easeIn = (t) => Math.pow(U.clamp(t, 0, 1), 2);
  U.easeInOut = (t) => {
    t = U.clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  U.backOut = (t) => {
    t = U.clamp(t, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  U.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  // ---- hash / value noise ----
  U.hash2 = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };
  U.hash3 = (x, y, z) => U.hash2(x + z * 7919, y - z * 104729);
  U.noise2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = U.hash2(xi, yi), b = U.hash2(xi + 1, yi);
    const c = U.hash2(xi, yi + 1), d = U.hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  U.noise3 = (x, y, z) => {
    const zi = Math.floor(z), zf = z - zi;
    const w = zf * zf * (3 - 2 * zf);
    const a = U.noise2(x + zi * 17.3, y - zi * 9.1);
    const b = U.noise2(x + (zi + 1) * 17.3, y - (zi + 1) * 9.1);
    return a + (b - a) * w;
  };
  U.fbm2 = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * U.noise2(x * f, y * f);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  };

  // ---- tweens ----
  const tweens = [];
  U.tween = function (dur, fn, done) {
    const tw = { t: 0, dur: Math.max(0.0001, dur), fn, done, dead: false };
    tweens.push(tw);
    fn(0);
    return tw;
  };
  U.updateTweens = function (dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (tw.dead) { tweens.splice(i, 1); continue; }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) {
        tweens.splice(i, 1);
        if (tw.done) tw.done();
      }
    }
  };
  U.after = (sec, fn) => U.tween(sec, () => {}, fn);

  // ---- procedural canvas textures ----
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  U.canvas = canvas;
  function toTex(c, repeat, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
  U.toTex = toTex;

  // wood grain: base rgb and dark rgb
  U.woodTexture = function (base, dark, opts = {}) {
    const w = opts.w || 512, h = opts.h || 512;
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    const rings = opts.rings || 22;
    const seed = opts.seed || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w, ny = y / h;
        const warp = U.fbm2(nx * 3 + seed, ny * 0.6 + seed * 2, 4) * 2.2;
        const grain = Math.sin((ny * rings + warp) * Math.PI * 2);
        const fine = U.noise2(nx * 300 + seed, ny * 6) * 0.5 + U.noise2(nx * 80, ny * 2 + seed) * 0.5;
        let k = 0.5 + 0.5 * grain;
        k = Math.pow(k, 3) * 0.55 + fine * 0.3;
        k = U.clamp(k, 0, 1);
        const i = (y * w + x) * 4;
        d[i] = base[0] + (dark[0] - base[0]) * k;
        d[i + 1] = base[1] + (dark[1] - base[1]) * k;
        d[i + 2] = base[2] + (dark[2] - base[2]) * k;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTex(c, opts.repeat);
  };

  U.tileTexture = function () {
    const c = canvas(512, 512);
    const g = c.getContext('2d');
    g.fillStyle = '#c9c2b4';
    g.fillRect(0, 0, 512, 512);
    const n = 4, s = 512 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 228 + ((U.hash2(i, j) * 14) | 0);
        g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      }
    }
    return toTex(c, [6, 2]);
  };

  // square mesh for strainer basket (alpha)
  U.meshTexture = function () {
    const c = canvas(256, 256);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const p = (i / n) * 256;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
    }
    const t = toTex(c, [6, 3], false);
    return t;
  };

  // indigo stripes for the serving bowl outside
  U.bowlPattern = function (variant) {
    const c = canvas(512, 256);
    const g = c.getContext('2d');
    g.fillStyle = variant ? '#efe6d6' : '#f1ece2';
    g.fillRect(0, 0, 512, 256);
    const ink = variant ? '#7a3b22' : '#27406b';
    g.strokeStyle = ink;
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 30); g.lineTo(512, 30); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, 44); g.lineTo(512, 44); g.stroke();
    // simple wave band
    g.lineWidth = 3;
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let x = 0; x <= 512; x += 4) {
        const y = 120 + k * 34 + Math.sin((x / 512) * Math.PI * 16 + k) * 10;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 226); g.lineTo(512, 226); g.stroke();
    return toTex(c, [1, 1]);
  };

  // woven straw mat (radial)
  U.matTexture = function () {
    const c = canvas(512, 512);
    const g = c.getContext('2d');
    g.fillStyle = '#b99a62';
    g.fillRect(0, 0, 512, 512);
    for (let r = 8; r < 256; r += 9) {
      g.strokeStyle = r % 18 < 9 ? '#a8864f' : '#c9ac74';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(256, 256, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(90,64,30,0.35)';
    g.lineWidth = 1.5;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      g.beginPath();
      g.moveTo(256, 256);
      g.lineTo(256 + Math.cos(t) * 256, 256 + Math.sin(t) * 256);
      g.stroke();
    }
    return toTex(c);
  };

  // soft radial sprite for steam / glow (lightweight particle look)
  U.softSprite = function () {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  };

  // speckle texture for dough / flour surfaces (subtle)
  U.speckTexture = function (base, speck, density) {
    const c = canvas(256, 256);
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    const n = density || 900;
    for (let i = 0; i < n; i++) {
      const x = U.hash2(i, 3) * 256, y = U.hash2(i, 7) * 256;
      g.fillStyle = speck;
      g.globalAlpha = 0.25 + U.hash2(i, 11) * 0.4;
      g.fillRect(x, y, 1.5, 1.5);
    }
    g.globalAlpha = 1;
    return toTex(c, [3, 3]);
  };

  // ---- geometry helpers ----
  U.lathe = function (pts, seg) {
    const v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    return new THREE.LatheGeometry(v, seg || 48);
  };
  // shadow flags on all meshes in a tree
  U.shadow = function (obj, cast = true, recv = true) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = cast;
        o.receiveShadow = recv;
      }
    });
    return obj;
  };
  // invisible collider mesh for picking
  U.collider = function (geom) {
    const m = new THREE.Mesh(geom, U.colliderMat || (U.colliderMat = new THREE.MeshBasicMaterial({ visible: false })));
    m.userData.collider = true;
    return m;
  };

  U.V3 = () => new THREE.Vector3();
  U.tmpV = [];
  for (let i = 0; i < 16; i++) U.tmpV.push(new THREE.Vector3());
})();
