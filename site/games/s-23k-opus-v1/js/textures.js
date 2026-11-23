// textures.js — 手続き的に描く素材の模様（段ボールの面・波目、木目、紙、綿ひもの撚り）
// 写真は使わず、立体モデルの表面の質感だけをキャンバスで作る。
(function () {
  'use strict';
  const S = window.S23;
  const TX = (S.TX = {});

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function toTex(c, repeat, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
  // 値ノイズ（タイル可能）
  function makeNoise(size, cells, seedOff) {
    const g = [];
    for (let i = 0; i < cells * cells; i++) g.push(S.hashRand(i * 1.37 + seedOff));
    return function (x, y) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const i = (a, b) => g[((b % cells) + cells) % cells * cells + (((a % cells) + cells) % cells)];
      const a = i(x0, y0), b = i(x0 + 1, y0), c = i(x0, y0 + 1), d = i(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }

  // ---- 段ボールの面（クラフト紙） ----
  function kraftCanvas(bump) {
    const N = 512;
    const c = canvas(N, N), g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const n1 = makeNoise(N, 8, 3.1), n2 = makeNoise(N, 32, 7.7), n3 = makeNoise(N, 128, 1.9);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = n1(x, y) * 0.5 + n2(x, y) * 0.3 + n3(x, y) * 0.2;
        // うっすらと見える中芯の筋（波目が表に透ける）
        const flute = 0.5 + 0.5 * Math.cos((x / N) * S.TAU * 34);
        const k = (y * N + x) * 4;
        if (bump) {
          const b = 128 + (v - 0.5) * 60 + flute * 22 + (S.hashRand(x * 0.91 + y * 13.3) - 0.5) * 30;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = S.clamp(b, 0, 255);
        } else {
          const t = (v - 0.5) * 26 + flute * 5 + (S.hashRand(x * 1.3 + y * 7.1) - 0.5) * 10;
          img.data[k] = S.clamp(196 + t, 0, 255);
          img.data[k + 1] = S.clamp(158 + t * 0.9, 0, 255);
          img.data[k + 2] = S.clamp(112 + t * 0.7, 0, 255);
        }
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 繊維
    g.globalAlpha = bump ? 0.25 : 0.09;
    for (let i = 0; i < 900; i++) {
      const x = S.hashRand(i * 3.3) * N, y = S.hashRand(i * 5.9) * N;
      const a = S.hashRand(i * 2.1) * Math.PI, l = 4 + S.hashRand(i) * 12;
      g.strokeStyle = S.hashRand(i * 9.1) > 0.5 ? '#5a3c1c' : '#f3dcb5';
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    return c;
  }

  // ---- 切り口の波目（u=辺に沿う, v=厚み方向） ----
  function fluteCanvas() {
    const W = 128, H = 48;
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#5b3d21'; g.fillRect(0, 0, W, H); // 奥の暗がり
    // 中芯の波
    const top = 7, bot = H - 7;
    g.fillStyle = '#b8874f';
    g.beginPath();
    g.moveTo(0, H / 2);
    for (let x = 0; x <= W; x++) {
      const y = H / 2 + Math.sin((x / W) * S.TAU) * (bot - top) * 0.46;
      g.lineTo(x, y - 2.2);
    }
    for (let x = W; x >= 0; x--) {
      const y = H / 2 + Math.sin((x / W) * S.TAU) * (bot - top) * 0.46;
      g.lineTo(x, y + 2.2);
    }
    g.closePath(); g.fill();
    // 波の中の陰影
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(40,20,5,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, top, W, bot - top);
    // ライナー（表裏の紙）
    g.fillStyle = '#c99a62'; g.fillRect(0, 0, W, top);
    g.fillRect(0, bot, W, H - bot);
    g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(0, 0, W, 2); g.fillRect(0, H - 2, W, 2);
    // ざらつき
    for (let i = 0; i < 300; i++) {
      g.fillStyle = S.hashRand(i * 4.7) > 0.5 ? 'rgba(255,230,190,0.18)' : 'rgba(40,25,10,0.18)';
      g.fillRect(S.hashRand(i * 1.1) * W, S.hashRand(i * 2.3) * H, 1.5, 1.5);
    }
    return c;
  }

  // ---- 木の机 ----
  function woodCanvas(bump, light) {
    const W = 1024, H = 512;
    const c = canvas(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const n1 = makeNoise(W, 6, 11.2), n2 = makeNoise(W, 24, 4.4), n3 = makeNoise(W, 96, 8.8);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const warp = n1(x, y * 2) * 38 + n2(x, y * 2) * 6;
        const ring = Math.sin((y + warp) * 0.16 + n1(x * 0.5, y) * 3.0);
        const fine = Math.sin((y + warp * 1.4) * 1.1) * 0.5 + 0.5;
        const v = ring * 0.5 + 0.5;
        const grain = Math.pow(v, 3.0);
        const pore = n3(x, y * 6) > 0.78 ? 1 : 0;
        const k = (y * W + x) * 4;
        if (bump) {
          const b = 150 - grain * 50 - fine * 12 - pore * 40;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = S.clamp(b, 0, 255);
        } else {
          const base = light ? [226, 196, 150] : [196, 150, 100];
          const t = -grain * 34 - fine * 8 - pore * 14 + (n2(x, y) - 0.5) * 20;
          img.data[k] = S.clamp(base[0] + t, 0, 255);
          img.data[k + 1] = S.clamp(base[1] + t * 0.85, 0, 255);
          img.data[k + 2] = S.clamp(base[2] + t * 0.7, 0, 255);
        }
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---- 包み紙（白地の紙繊維。色はマテリアル側で掛ける） ----
  function paperCanvas(bump) {
    const N = 256;
    const c = canvas(N, N), g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const n1 = makeNoise(N, 16, 21.5), n2 = makeNoise(N, 64, 2.2);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = n1(x, y) * 0.6 + n2(x, y) * 0.4;
        const k = (y * N + x) * 4;
        const b = bump ? 128 + (v - 0.5) * 90 : 238 + (v - 0.5) * 22;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = S.clamp(b, 0, 255);
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---- 綿ひもの撚り（u=長さ方向, v=周方向） ----
  function cordCanvas(bump) {
    const W = 64, H = 64;
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = bump ? '#808080' : '#efe6d2';
    g.fillRect(0, 0, W, H);
    // 三本撚り：斜めの帯
    for (let s = 0; s < 3; s++) {
      for (let i = -2; i < 3; i++) {
        const off = (s / 3) * W + i * W;
        const grd = g.createLinearGradient(off, 0, off + W / 3, 0);
        if (bump) {
          grd.addColorStop(0, '#202020'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#202020');
        } else {
          grd.addColorStop(0, '#bdb19a'); grd.addColorStop(0.5, '#fbf5e8'); grd.addColorStop(1, '#bdb19a');
        }
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(off, 0); g.lineTo(off + W / 3, 0); g.lineTo(off + W / 3 + W, H); g.lineTo(off + W, H);
        g.closePath(); g.fill();
      }
    }
    // 毛羽
    for (let i = 0; i < 120; i++) {
      g.fillStyle = bump ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.35)';
      g.fillRect(S.hashRand(i * 3.7) * W, S.hashRand(i * 8.1) * H, 1, 1);
    }
    return c;
  }

  // ---- 漆喰の壁 ----
  function plasterCanvas() {
    const N = 256;
    const c = canvas(N, N), g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const n1 = makeNoise(N, 8, 5.5), n2 = makeNoise(N, 48, 9.9);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = n1(x, y) * 0.5 + n2(x, y) * 0.5;
      const k = (y * N + x) * 4;
      img.data[k] = S.clamp(238 + (v - 0.5) * 16, 0, 255);
      img.data[k + 1] = S.clamp(232 + (v - 0.5) * 16, 0, 255);
      img.data[k + 2] = S.clamp(220 + (v - 0.5) * 16, 0, 255);
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  const cache = {};
  function once(key, fn) { return cache[key] || (cache[key] = fn()); }

  TX.kraft = () => once('kraft', () => toTex(kraftCanvas(false), [1 / 24, 1 / 24]));
  TX.kraftBump = () => once('kraftB', () => toTex(kraftCanvas(true), [1 / 24, 1 / 24], false));
  TX.flute = () => once('flute', () => toTex(fluteCanvas(), [1 / 0.62, 1]));
  TX.wood = () => once('wood', () => toTex(woodCanvas(false, false), [1 / 90, 1 / 45]));
  TX.woodBump = () => once('woodB', () => toTex(woodCanvas(true, false), [1 / 90, 1 / 45], false));
  TX.woodLight = () => once('woodL', () => toTex(woodCanvas(false, true), [1 / 40, 1 / 20]));
  TX.paper = () => once('paper', () => toTex(paperCanvas(false), [1 / 7, 1 / 7]));
  TX.paperBump = () => once('paperB', () => toTex(paperCanvas(true), [1 / 7, 1 / 7], false));
  TX.cord = () => once('cord', () => toTex(cordCanvas(false), [1, 1]));
  TX.cordBump = () => once('cordB', () => toTex(cordCanvas(true), [1, 1], false));
  TX.plaster = () => once('plaster', () => toTex(plasterCanvas(), [1 / 60, 1 / 60]));
})();
