// WORLD: static back-garden environment (terrace, lawn, house wall, hedges, trees, sky), sun/moon rig, time of day.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from './layout.js';
import { SUN_DIR, EXPOSURE, ENV_INTENSITY } from './lightrig.js';

// ---------------------------------------------------------------- small helpers
function makeRng(seed) {
  let s = (Math.imul(seed + 0x9e3779b9, 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// tileable value-noise octave accumulated into out (W×H), lattice cx×cy
function addNoise(out, W, H, cx, cy, amp, rnd) {
  const g = new Float32Array(cx * cy);
  for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
  const i0 = new Int32Array(W), i1 = new Int32Array(W), wx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = x * cx / W, i = Math.floor(f), t = f - i;
    i0[x] = i % cx; i1[x] = (i + 1) % cx; wx[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < H; y++) {
    const f = y * cy / H, j = Math.floor(f); let t = f - j; t = t * t * (3 - 2 * t);
    const r0 = (j % cy) * cx, r1 = ((j + 1) % cy) * cx, o = y * W;
    for (let x = 0; x < W; x++) {
      const a = g[r0 + i0[x]], b = g[r0 + i1[x]], c = g[r1 + i0[x]], d = g[r1 + i1[x]], w = wx[x];
      const top = a + (b - a) * w;
      out[o + x] += amp * (top + (c + (d - c) * w - top) * t);
    }
  }
}
function heightToNormal(h, W, H, s, out) {
  const xr = new Int32Array(W), xl = new Int32Array(W);
  for (let x = 0; x < W; x++) { xr[x] = (x + 1) % W; xl[x] = (x - 1 + W) % W; }
  for (let y = 0; y < H; y++) {
    const yu = ((y + 1) % H) * W, yd = ((y - 1 + H) % H) * W, o = y * W;
    for (let x = 0; x < W; x++) {
      const nx = -(h[o + xr[x]] - h[o + xl[x]]) * s, ny = -(h[yu + x] - h[yd + x]) * s;
      const inv = 127.5 / Math.sqrt(nx * nx + ny * ny + 1), i = (o + x) << 2;
      out[i] = nx * inv + 127.5; out[i + 1] = ny * inv + 127.5; out[i + 2] = inv + 127.5; out[i + 3] = 255;
    }
  }
}
let ANISO = 4;
function dataTex(data, W, H, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true; return t;
}
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// UVs in meters/tile from world position, plane chosen by dominant normal
function worldUV(geo, tile, ox = 0, oy = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = -p.getZ(i); } else if (az >= ax) { u = p.getX(i); v = p.getY(i); } else { u = p.getZ(i); v = p.getY(i); }
    uv.setXY(i, (u + ox) / tile, (v + oy) / tile);
  }
  return geo;
}
function vcolor(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}
function stripTo(geo, keep) { // keep only listed attributes (for merging)
  for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k);
  return geo.index ? geo.toNonIndexed() : geo;
}
const WPOS_VERT = ['#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'];
function injectWPos(shader) {
  shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace(WPOS_VERT[0], WPOS_VERT[1]);
  shader.fragmentShader = 'varying vec3 vWPos;\n' + shader.fragmentShader;
}

// ---------------------------------------------------------------- procedural textures
function makeConcreteTex(N) {
  const rnd = makeRng(11), P = N * N;
  const mot = new Float32Array(P), brm = new Float32Array(P), fine = new Float32Array(P);
  addNoise(mot, N, N, 9, 9, 0.55, rnd); addNoise(mot, N, N, 31, 31, 0.3, rnd);
  addNoise(brm, N, N, 4, 360, 1.0, rnd);
  addNoise(fine, N, N, 110, 110, 0.5, rnd); addNoise(fine, N, N, 260, 260, 0.8, rnd);
  const h = new Float32Array(P), pit = new Float32Array(P), wn = new Float32Array(P);
  const k = N / 1024;
  let s = 0x2545f491;
  for (let i = 0; i < P; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w = (s >>> 0) / 4294967296 - 0.5; wn[i] = w; h[i] = brm[i] * 0.2 + fine[i] * 0.32 + w * 0.42 + mot[i] * 0.4; }
  const pits = (n, r0, r1, depth) => {
    for (let p = 0; p < n; p++) {
      const cx = Math.floor(rnd() * N), cy = Math.floor(rnd() * N), r = (r0 + rnd() * (r1 - r0)) * k, R = Math.ceil(r + 1), sq = 0.6 + rnd() * 0.8;
      const ir2 = 1 / (r * r), a = sq * sq, b = 1 / a;
      for (let dy = -R; dy <= R; dy++) {
        const row = ((cy + dy + N) % N) * N;
        for (let dx = -R; dx <= R; dx++) {
          const f = 1 - (dx * dx * a + dy * dy * b) * ir2; if (f <= 0) continue;
          const i = row + ((cx + dx + N) % N);
          h[i] -= depth * f; if (f > pit[i]) pit[i] = f;
        }
      }
    }
  };
  pits(Math.round(2200 * k * k), 0.6, 1.4, 0.7); pits(Math.round(140 * k * k), 1.4, 3.0, 1.4); pits(Math.round(14 * k * k), 2.6, 4.5, 1.6);
  const col = new Uint8Array(P * 4), rgh = new Uint8Array(P * 4), nrm = new Uint8Array(P * 4);
  for (let i = 0; i < P; i++) {
    let v = 1 + mot[i] * 0.11 + fine[i] * 0.035 + wn[i] * 0.075 + brm[i] * 0.02 - pit[i] * 0.2;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const sp = (s >>> 0) / 4294967296;
    let wr = 1, wb = 1;
    if (sp < 0.01) { v *= 0.8 + sp * 12; wr = 1.03; wb = 0.95; }          // dark/brown sand grains
    else if (sp < 0.02) v *= 1.06 + (sp - 0.01) * 6;                       // light grains
    const tint = mot[i] * 0.03, o = i * 4;
    col[o] = clamp255(173 * v * (1 + tint) * wr); col[o + 1] = clamp255(167 * v); col[o + 2] = clamp255(155 * v * (1 - tint * 1.3) * wb); col[o + 3] = 255;
    rgh[o + 1] = clamp255(255 * (0.86 + mot[i] * 0.06 - brm[i] * 0.025 + pit[i] * 0.1)); rgh[o + 3] = 255;
  }
  heightToNormal(h, N, N, 0.9 * k, nrm);
  return { map: dataTex(col, N, N, true), roughnessMap: dataTex(rgh, N, N, false), normalMap: dataTex(nrm, N, N, false) };
}

const MACRO = { x0: -2.8, z0: -2.4, size: 5.6 };
function makeMacroTex(M) {
  const rnd = makeRng(23), P = M * M;
  const v = new Float32Array(P), v2 = new Float32Array(P);
  addNoise(v, M, M, 3, 3, 0.5, rnd); addNoise(v, M, M, 7, 7, 0.3, rnd); addNoise(v, M, M, 15, 15, 0.2, rnd); addNoise(v, M, M, 33, 33, 0.12, rnd); addNoise(v, M, M, 70, 70, 0.07, rnd);
  addNoise(v2, M, M, 5, 5, 0.6, rnd); addNoise(v2, M, M, 11, 11, 0.3, rnd); addNoise(v2, M, M, 26, 26, 0.15, rnd);
  const T = L.TERRACE, out = new Uint8Array(P * 4);
  for (let py = 0; py < M; py++) for (let px = 0; px < M; px++) {
    const i = py * M + px, x = MACRO.x0 + (px + 0.5) / M * MACRO.size, z = MACRO.z0 + (py + 0.5) / M * MACRO.size;
    let m = 1 + v[i] * 0.1;
    const wet = smooth(1.0, 0.3, Math.hypot(x * 0.9, z + 0.12) + v2[i] * 0.45);  // old splash marks around the washing spot
    m *= 1 - 0.06 * wet;
    m *= 1 - 0.1 * Math.exp(-(z - T.minZ) / 0.2) * (0.7 + 0.3 * v2[i]);          // grime at the wall foot
    m *= 1 + 0.05 * smooth(0.25, 0.6, v2[i]);                                    // pale efflorescence clouds
    const de = Math.min(T.maxX - Math.abs(x), T.maxZ - z), ge = Math.exp(-Math.max(de, 0) / 0.07) * (0.6 + 0.4 * v[i] + 0.4);
    let r = m * (1 - 0.07 * ge) * (1 + v[i] * 0.012), g = m * (1 - 0.04 * ge), b = m * (1 - 0.1 * ge) * (1 - v[i] * 0.02);
    const o = i * 4; out[o] = clamp255(r * 127.5); out[o + 1] = clamp255(g * 127.5); out[o + 2] = clamp255(b * 127.5); out[o + 3] = 255;
  }
  const t = dataTex(out, M, M, false); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

function makeNoiseTex(N) { // R,G: cloud/lawn fbm, B: fine fbm — normalised 0..1
  const rnd = makeRng(7), P = N * N, chans = [new Float32Array(P), new Float32Array(P), new Float32Array(P)];
  addNoise(chans[0], N, N, 4, 4, 0.5, rnd); addNoise(chans[0], N, N, 8, 8, 0.27, rnd); addNoise(chans[0], N, N, 16, 16, 0.14, rnd); addNoise(chans[0], N, N, 32, 32, 0.07, rnd); addNoise(chans[0], N, N, 64, 64, 0.035, rnd);
  addNoise(chans[1], N, N, 8, 8, 0.5, rnd); addNoise(chans[1], N, N, 16, 16, 0.25, rnd); addNoise(chans[1], N, N, 32, 32, 0.13, rnd); addNoise(chans[1], N, N, 64, 64, 0.07, rnd);
  addNoise(chans[2], N, N, 16, 16, 0.5, rnd); addNoise(chans[2], N, N, 48, 48, 0.3, rnd); addNoise(chans[2], N, N, 128, 128, 0.2, rnd);
  const out = new Uint8Array(P * 4);
  chans.forEach((c, k) => {
    let lo = 1e9, hi = -1e9; for (let i = 0; i < P; i++) { if (c[i] < lo) lo = c[i]; if (c[i] > hi) hi = c[i]; }
    const s = 255 / (hi - lo); for (let i = 0; i < P; i++) out[i * 4 + k] = (c[i] - lo) * s;
  });
  for (let i = 0; i < P; i++) out[i * 4 + 3] = 255;
  return dataTex(out, N, N, false);
}

function makeGrassTex(S) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), rnd = makeRng(5);
  g.fillStyle = '#465f25'; g.fillRect(0, 0, S, S);
  const pal = [
    ['#2f461b', '#3a5420', '#425f24', '#4c6a28'],
    ['#557530', '#5f7f34', '#6a8a38', '#76923e', '#6f7d3a'],
    ['#839f45', '#90a94c', '#9db456', '#a9b161', '#b3ad6c', '#8c8a55'],
  ];
  const counts = [1400, 1100, 520], widths = [2.2, 1.6, 1.2], lens = [[8, 22], [7, 20], [5, 13]];
  pal.forEach((cols, pass) => {
    g.lineWidth = widths[pass]; g.lineCap = 'round';
    for (const col of cols) {
      g.strokeStyle = col; g.beginPath();
      for (let n = 0; n < counts[pass]; n++) {
        const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = lens[pass][0] + rnd() * (lens[pass][1] - lens[pass][0]);
        const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
        for (const ox of [0, x + dx > S || x + dx < 0 ? -Math.sign(dx) * S : null]) for (const oy of [0, y + dy > S || y + dy < 0 ? -Math.sign(dy) * S : null]) {
          if (ox === null || oy === null) continue;
          g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + dx * 0.5 + dy * 0.15, y + oy + dy * 0.5 - dx * 0.15, x + ox + dx, y + oy + dy);
        }
      }
      g.stroke();
    }
  });
  return canvasTex(c, true);
}

function makeLeafTex(S) {
  const cc = mkCanvas(S, S), nc = mkCanvas(S, S), g = cc.getContext('2d'), n = nc.getContext('2d'), rnd = makeRng(31);
  n.fillStyle = 'rgb(128,128,255)'; n.fillRect(0, 0, S, S);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  const R = (a) => S * 0.47 * (0.84 + 0.08 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.04 * Math.sin(8 * a + ph[2]));
  // twigs
  g.strokeStyle = '#3b3222'; g.lineWidth = 2.2;
  for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, r = R(a) * 0.8; g.beginPath(); g.moveTo(S / 2 + (rnd() - 0.5) * 40, S / 2 + (rnd() - 0.5) * 40); g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); g.stroke(); }
  const leaves = [];
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()), r = rr * R(a);
    leaves.push({ x: S / 2 + Math.cos(a) * r, y: S / 2 + Math.sin(a) * r, d: rnd() * 0.7 + (1 - rr) * 0.3 });
  }
  leaves.sort((p, q) => p.d - q.d);
  for (const lf of leaves) {
    const len = 17 + rnd() * 14, wid = len * (0.42 + rnd() * 0.12), rot = rnd() * Math.PI * 2;
    const L_ = 0.16 + lf.d * 0.2 + rnd() * 0.06, hue = 88 + rnd() * 22, sat = 38 + rnd() * 22;
    g.save(); g.translate(lf.x, lf.y); g.rotate(rot);
    g.fillStyle = `hsl(${hue},${sat}%,${(L_ * 100).toFixed(1)}%)`;
    g.beginPath(); g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `hsla(${hue + 4},${sat + 6}%,${((L_ + 0.07) * 100).toFixed(1)}%,0.7)`;
    g.beginPath(); g.ellipse(0, -wid * 0.12, len * 0.42, wid * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `hsla(${hue},30%,${((L_ - 0.06) * 100).toFixed(1)}%,0.8)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
    const t = rnd() * 6.28, s = 0.15 + rnd() * 0.55, nz = Math.sqrt(1 - s * s);
    n.save(); n.translate(lf.x, lf.y); n.rotate(rot);
    n.fillStyle = `rgb(${Math.round((Math.cos(t) * s * 0.5 + 0.5) * 255)},${Math.round((Math.sin(t) * s * 0.5 + 0.5) * 255)},${Math.round((nz * 0.5 + 0.5) * 255)})`;
    n.beginPath(); n.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2); n.fill(); n.restore();
  }
  return { map: canvasTex(cc, true), normalMap: canvasTex(nc, false) };
}

function makeCrownTex(S) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), rnd = makeRng(41);
  const blobs = [];
  for (let i = 0; i < 300; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    const lump = 0.86 + 0.1 * Math.sin(5 * a + 1.3) + 0.06 * Math.sin(9 * a);
    const x = 0.5 + Math.cos(a) * rr * 0.36 * lump, y = 0.47 + Math.sin(a) * rr * 0.36 * lump * 0.95;
    blobs.push({ x: x * S, y: y * S, r: (0.05 + rnd() * 0.07) * S, top: 1 - y, z: rnd() });
  }
  blobs.sort((p, q) => p.z - q.z);
  for (const b of blobs) {
    const l = 14 + b.top * 13 + b.z * 13 + (rnd() < 0.15 ? 8 : 0), h = 78 + rnd() * 30, s = 16 + rnd() * 18;
    const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    gr.addColorStop(0, `hsla(${h},${s}%,${l}%,0.95)`); gr.addColorStop(0.55, `hsla(${h},${s}%,${l}%,0.7)`); gr.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
  }
  const t = canvasTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

function makeSidingTex(W, H) {
  const rnd = makeRng(17), P = W * H, boards = 6, bh = H / boards;
  const n1 = new Float32Array(P), n2 = new Float32Array(P);
  addNoise(n1, W, H, 6, 60, 1, rnd); addNoise(n2, W, H, 4, 6, 1, rnd);
  const joints = []; for (let b = 0; b < boards; b++) joints.push(Math.floor(rnd() * W));
  const h = new Float32Array(P), col = new Uint8Array(P * 4), nrm = new Uint8Array(P * 4);
  for (let y = 0; y < H; y++) {
    const b = Math.floor(y / bh), f = (y - b * bh) / bh; // f 0 at board bottom edge .. 1 at top
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let hh = (1 - f) * 3.0;               // lap profile, thick at the bottom
      if (f < 0.035) hh = 3.0 * (f / 0.035); // rounded drip edge
      const jd = Math.abs(((x - joints[b] + W * 1.5) % W) - W / 2) ;
      const joint = jd > W / 2 - 1.5 ? 1 : 0;
      hh += n1[i] * 0.06 - joint * 0.6;
      h[i] = hh;
      let v = 1 + n1[i] * 0.025 + n2[i] * 0.02 + (rnd() - 0.5) * 0.03;
      v *= 1 - 0.32 * smooth(0.86, 1.0, f);  // shadow under the lap above
      if (f < 0.035) v *= 0.9;
      if (joint) v *= 0.82;
      const o = i * 4; col[o] = clamp255(234 * v); col[o + 1] = clamp255(226 * v); col[o + 2] = clamp255(204 * v); col[o + 3] = 255;
    }
  }
  heightToNormal(h, W, H, 1.2, nrm);
  return { map: dataTex(col, W, H, true), normalMap: dataTex(nrm, W, H, false) };
}

// ---------------------------------------------------------------- sky shader
const SKY_VERT = `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = `
uniform vec3 uZen, uHor, uAnti, uGlow, uSunCol, uCloudLit, uCloudShade, uSunDir, uMoonDir, uGround;
uniform float uGain, uDisc, uStars, uMoon, uCover;
uniform vec2 uDrift;
uniform sampler2D uNoise;
varying vec3 vDir;
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float cloudN(vec2 uv){ return texture2D(uNoise, uv).r * 0.72 + texture2D(uNoise, uv * 3.1 + 0.37).g * 0.28; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 s = normalize(uSunDir);
  float sd = dot(d, s);
  vec2 sh = normalize(s.xz + 1e-5);
  float az = dot(normalize(d.xz + 1e-5), sh) * 0.5 + 0.5;
  vec3 hor = mix(uAnti, uHor, az * az);
  float hp = max(h, 0.0);
  vec3 col = mix(hor, uZen, pow(hp, 0.38));
  col = mix(col, hor * 1.06, exp(-hp * 22.0) * 0.5);
  float sdp = max(sd, 0.0);
  col += uGlow * (pow(sdp, 8.0) * 0.16 + pow(sdp, 48.0) * 0.5 + pow(sdp, 700.0) * 2.5) * (0.5 + 0.5 * exp(-hp * 5.0));
  if (h < 0.0) col = mix(hor * 0.85, uGround, smoothstep(0.0, -0.2, h));
  float cl = 0.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.1) * 0.085 + uDrift;
    float n = cloudN(uv);
    float fade = smoothstep(0.03, 0.25, h);
    cl = smoothstep(uCover, uCover + 0.2, n) * fade;
    float n2 = cloudN(uv + sh * 0.02);
    float lit = clamp(0.6 + (n - n2) * 6.0, 0.0, 1.0);
    float thick = smoothstep(uCover + 0.05, uCover + 0.4, n);
    vec3 cc = mix(uCloudShade, uCloudLit, lit * (1.0 - thick * 0.45));
    cc += uGlow * pow(sdp, 6.0) * (1.0 - thick) * 0.8;
    col = mix(col, cc, cl);
  }
  if (uStars > 0.001 && h > 0.0) {
    vec3 p = d * 230.0; vec3 c = floor(p); float r = hash13(c);
    if (r > 0.993) { vec3 f = fract(p) - 0.5; float st = smoothstep(0.3, 0.0, length(f));
      col += vec3(0.85, 0.9, 1.0) * st * uStars * (1.0 - cl) * smoothstep(0.05, 0.3, h) * (0.5 + 3.0 * (r - 0.993) / 0.007); }
  }
  col += uSunCol * smoothstep(0.99986, 0.99993, sd) * uDisc * (1.0 - cl * 0.9);
  if (uMoon > 0.001) {
    vec3 m = normalize(uMoonDir); float md = dot(d, m);
    float mdisc = smoothstep(0.99974, 0.99981, md);
    float mt = texture2D(uNoise, (d.xz - m.xz) * 25.0).b;
    col = mix(col, vec3(1.0, 0.96, 0.86) * (0.75 + 0.4 * mt) * 1.4, mdisc * uMoon * (1.0 - cl * 0.7));
    col += vec3(0.5, 0.6, 0.85) * (pow(max(md, 0.0), 400.0) * 0.35 + pow(max(md, 0.0), 30.0) * 0.06) * uMoon;
  }
  gl_FragColor = vec4(col * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- time-of-day keyframes
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const MORNING_DIR = V(-0.62, 0.52, 0.25);
const RAW_KEYS = [
  { t: 0.00, sun: SUN_DIR.clone(), light: SUN_DIR.clone(), lc: 0xfff1dc, li: 2.7, hs: 0xbcd7ff, hg: 0x8a7f6c, hi: 0.3, exp: EXPOSURE, env: ENV_INTENSITY,
    zen: 0x134cc2, hor: 0x9cc2ec, anti: 0x6a9ee2, glow: 0xffeacc, sunc: 0xfff4e0, cLit: 0xffffff, cShade: 0xaebdd2, ground: 0x4a5a3a, gain: 1.25, disc: 30, stars: 0, moon: 0, cover: 0.6, fog: 0xbcd0e2 },
  { t: 0.30, sun: V(0.95, 0.21, 0.22), light: V(0.95, 0.22, 0.22), lc: 0xffc78a, li: 2.4, hs: 0xc4c8e0, hg: 0x8a7258, hi: 0.32, exp: 0.86, env: 0.42,
    zen: 0x2458b8, hor: 0xf0c898, anti: 0x86a6d8, glow: 0xffa048, sunc: 0xffd8a0, cLit: 0xffe4c0, cShade: 0x9c9cae, ground: 0x3e4530, gain: 1.2, disc: 26, stars: 0, moon: 0, cover: 0.6, fog: 0xd8c8b0 },
  { t: 0.45, sun: V(0.99, 0.08, 0.10), light: V(0.99, 0.08, 0.10), lc: 0xff8a4c, li: 1.6, hs: 0xb894b4, hg: 0x6e5446, hi: 0.36, exp: 0.95, env: 0.3,
    zen: 0x34509a, hor: 0xff9658, anti: 0xd09cb6, glow: 0xff7a34, sunc: 0xffa060, cLit: 0xffa676, cShade: 0x8c6a86, ground: 0x30302a, gain: 1.15, disc: 18, stars: 0, moon: 0, cover: 0.6, fog: 0xc89a8a },
  { t: 0.52, sun: V(0.98, -0.12, 0.12), light: V(0.6, 0.6, 0.45), lc: 0x9c84c0, li: 0.3, hs: 0x6a70aa, hg: 0x3a3640, hi: 0.45, exp: 1.05, env: 0.18,
    zen: 0x1c2a66, hor: 0xd2867a, anti: 0x5c5c94, glow: 0xff6a4c, sunc: 0x000000, cLit: 0xb87890, cShade: 0x4a4468, ground: 0x1c1c22, gain: 1.0, disc: 0, stars: 0.25, moon: 0.4, cover: 0.62, fog: 0x6a6088 },
  { t: 0.60, sun: V(0.2, -0.95, 0.2), light: V(-0.25, 0.85, 0.45), lc: 0xa8bff4, li: 0.6, hs: 0x5a74ba, hg: 0x2a3040, hi: 0.55, exp: 1.25, env: 0.15,
    zen: 0x0a1534, hor: 0x2a3e74, anti: 0x23366a, glow: 0x000000, sunc: 0x000000, cLit: 0x56669a, cShade: 0x1c2648, ground: 0x0c1018, gain: 1.0, disc: 0, stars: 1, moon: 1, cover: 0.64, fog: 0x1e2c50 },
  { t: 0.74, sun: V(-0.97, -0.15, 0.18), light: V(-0.6, 0.6, 0.35), lc: 0x8e9cd8, li: 0.38, hs: 0x6a70b0, hg: 0x3a3644, hi: 0.45, exp: 1.1, env: 0.16,
    zen: 0x15225c, hor: 0x8c6a9a, anti: 0x2c3c76, glow: 0x80506c, sunc: 0x000000, cLit: 0x8a78a8, cShade: 0x343a68, ground: 0x14141c, gain: 1.0, disc: 0, stars: 0.5, moon: 0.5, cover: 0.62, fog: 0x4a4a78 },
  { t: 0.82, sun: V(-0.98, 0.03, 0.2), light: V(-0.95, 0.13, 0.25), lc: 0xffa48e, li: 1.15, hs: 0xd4a6be, hg: 0x6e5a56, hi: 0.4, exp: 0.95, env: 0.3,
    zen: 0x3a5aac, hor: 0xffb8a0, anti: 0x9aaad8, glow: 0xffa088, sunc: 0xffc0a0, cLit: 0xffcac4, cShade: 0x9a90b2, ground: 0x2a2a28, gain: 1.15, disc: 14, stars: 0, moon: 0.15, cover: 0.6, fog: 0xd8b4b4 },
  { t: 1.00, sun: MORNING_DIR, light: MORNING_DIR, lc: 0xfff6ec, li: 2.6, hs: 0xc4dcff, hg: 0x8a8274, hi: 0.32, exp: 0.82, env: 0.5,
    zen: 0x1550c8, hor: 0xd4e6f8, anti: 0x4f86e0, glow: 0xfff4e4, sunc: 0xfff6ea, cLit: 0xffffff, cShade: 0xb4c2da, ground: 0x4a5a3a, gain: 1.25, disc: 30, stars: 0, moon: 0, cover: 0.6, fog: 0xc4d6ea },
];
RAW_KEYS.push(Object.assign({}, RAW_KEYS[0], { t: 1.25 })); // 1.0..1.25: morning → afternoon (wrap-identical to 0)
const COLOR_KEYS = ['lc', 'hs', 'hg', 'zen', 'hor', 'anti', 'glow', 'sunc', 'cLit', 'cShade', 'ground', 'fog'];
const NUM_KEYS = ['li', 'hi', 'exp', 'env', 'gain', 'disc', 'stars', 'moon', 'cover'];
const KEYS = RAW_KEYS.map((k) => { const o = { t: k.t, sun: k.sun.clone(), light: k.light.clone() }; for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]); for (const n of NUM_KEYS) o[n] = k[n]; return o; });

// ---------------------------------------------------------------- main factory
export function createWorld(ctx) {
  const { renderer, scene } = ctx;
  ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
  const low = !!(ctx.quality && ctx.quality.low);
  const group = new THREE.Group(); group.name = 'world';
  const T = L.TERRACE;
  const uTime = { value: 0 };
  const __t = [[ "start", performance.now()]]; const __mark = (n) => __t.push([n, performance.now()]);
  const noiseTex = makeNoiseTex(256);

  __mark("concrete terrace");
  // --- concrete terrace
  const conc = makeConcreteTex(low ? 512 : 1024);
  const macro = makeMacroTex(256);
  const concMat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: conc.roughnessMap, roughness: 1, metalness: 0 });
  concMat.onBeforeCompile = (sh) => {
    injectWPos(sh);
    sh.uniforms.uMacro = { value: macro };
    sh.fragmentShader = sh.fragmentShader.replace('varying vec3 vWPos;', 'varying vec3 vWPos;\nuniform sampler2D uMacro;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 muv = (vWPos.xz - vec2(${MACRO.x0.toFixed(3)}, ${MACRO.z0.toFixed(3)})) / ${MACRO.size.toFixed(3)};
        vec3 mc = texture2D(uMacro, muv).rgb * 2.0;
        float dj = min(min(abs(vWPos.x - 0.95), abs(vWPos.x + 0.95)), abs(vWPos.z + 1.05));
        float side = step(vWPos.y, -0.003);
        dj = mix(dj, 1.0, side);
        float aa = fwidth(dj) + 1e-5;
        float jw = 0.0042 + (mc.r - 1.0) * 0.012;
        float joint = 1.0 - smoothstep(jw - aa, jw + aa, dj);
        float jedge = 1.0 - smoothstep(0.006, 0.028, dj);
        diffuseColor.rgb *= mc * mix(1.0, 0.94, jedge) * mix(1.0, 0.38, joint) * mix(1.0, 0.9, side);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * mix(0.82, 1.04, clamp(dot(mc, vec3(0.3333)), 0.0, 1.0)), 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.7, jedge * 0.6);
        roughnessFactor = mix(roughnessFactor, 0.95, joint);`);
  };
  concMat.customProgramCacheKey = () => 'world-concrete';
  {
    const w = T.maxX - T.minX, d = T.maxZ - T.minZ, cz = (T.maxZ + T.minZ) / 2, dep = 0.12;
    const top = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, 0, cz);
    const sx1 = new THREE.PlaneGeometry(d, dep).rotateY(Math.PI / 2).translate(T.maxX, -dep / 2, cz);
    const sx0 = new THREE.PlaneGeometry(d, dep).rotateY(-Math.PI / 2).translate(T.minX, -dep / 2, cz);
    const sz = new THREE.PlaneGeometry(w, dep).translate(0, -dep / 2, T.maxZ);
    const geo = mergeGeometries([top, sx1, sx0, sz].map((g) => worldUV(g, 1.5)));
    const m = new THREE.Mesh(geo, concMat); m.receiveShadow = true; m.name = 'terrace'; group.add(m);
  }

  __mark("lawn");
  // --- lawn
  const grassTex = makeGrassTex(512);
  const HEDGE = { px: 6.3, pz: 5.95, nx: -4.9, hx: 1.25 }; // inner (garden-facing) faces of the three hedges
  const lawnMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0 });
  lawnMat.onBeforeCompile = (sh) => {
    injectWPos(sh);
    sh.uniforms.uNoise = { value: noiseTex };
    sh.fragmentShader = sh.fragmentShader.replace('varying vec3 vWPos;', 'varying vec3 vWPos;\nuniform sampler2D uNoise;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float ln1 = texture2D(uNoise, vWPos.xz * 0.075).r, ln2 = texture2D(uNoise, vWPos.xz * 0.23 + 0.37).g;
        vec3 ltint = mix(vec3(0.82, 0.86, 0.66), vec3(1.1, 1.06, 0.9), ln1) * (0.88 + 0.24 * ln2);
        float dh = min(min(${HEDGE.px.toFixed(2)} - vWPos.x, ${HEDGE.pz.toFixed(2)} - vWPos.z), vWPos.x - (${HEDGE.nx.toFixed(2)}));
        float dt = max(max(abs(vWPos.x) - ${T.maxX.toFixed(2)}, vWPos.z - ${T.maxZ.toFixed(2)}), 0.0);
        ltint *= mix(0.5, 1.0, smoothstep(0.0, 0.55, dh)) * mix(0.85, 1.0, smoothstep(0.0, 0.12, dt));
        diffuseColor.rgb *= ltint;`);
  };
  lawnMat.customProgramCacheKey = () => 'world-lawn';
  {
    const x0 = -6.5, x1 = 8, z0 = T.minZ, z1 = 8;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -0.015, (z0 + z1) / 2);
    worldUV(geo, 0.65);
    const m = new THREE.Mesh(geo, lawnMat); m.receiveShadow = true; m.name = 'lawn'; group.add(m);
  }

  __mark("grass tufts (instanced)");
  // --- grass tufts (instanced)
  let grass;
  {
    const rnd = makeRng(91), blades = [];
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + rnd() * 0.8, r = 0.004 + rnd() * 0.012, h = 0.035 + rnd() * 0.045, w = 0.0035 + rnd() * 0.0025;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r, lean = 0.25 + rnd() * 0.45, ox = Math.cos(a) * h * lean, oz = Math.sin(a) * h * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w; // blade width axis
      const P = [[bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [bx - px * 0.7 + ox * 0.35, h * 0.55, bz - pz * 0.7 + oz * 0.35], [bx + px * 0.7 + ox * 0.35, h * 0.55, bz + pz * 0.7 + oz * 0.35], [bx + ox, h, bz + oz]];
      blades.push({ P, tri: [[0, 1, 2], [1, 3, 2], [2, 3, 4]] });
    }
    const pos = [], nor = [], colA = [], hA = [];
    for (const bl of blades) for (const tr of bl.tri) for (const vi of tr) {
      const p = bl.P[vi]; pos.push(...p); const hf = vi < 2 ? 0 : vi < 4 ? 0.55 : 1;
      nor.push(p[0] * 3, 1, p[2] * 3); const c = 0.42 + 0.58 * hf; colA.push(c, c, c * 0.95); hA.push(hf);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nn = new THREE.Float32BufferAttribute(nor, 3); geo.setAttribute('normal', nn); geo.normalizeNormals();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(hA, 1));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'attribute float aH;\nuniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uTime * 1.6 + ip.x * 3.1 + ip.y * 2.3) * 0.6 + sin(uTime * 2.7 + ip.x * 5.3 - ip.y * 1.7) * 0.4;
        transformed.xz += vec2(sw, sw * 0.6) * aH * aH * 0.005;`);
      sh.fragmentShader = sh.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
    mat.customProgramCacheKey = () => 'world-grass';
    // placements
    const pts = [];
    const outside = (x, z) => x > T.maxX + 0.005 || x < T.minX - 0.005 || z > T.maxZ + 0.005;
    const add = (x, z, s) => { if (outside(x, z) && x < HEDGE.px - 0.02 && x > HEDGE.nx + 0.02 && z < HEDGE.pz - 0.02) pts.push([x, z, s]); };
    const fringe = (n, fn) => { for (let i = 0; i < n; i++) { const u = rnd(), d = 0.006 + Math.pow(rnd(), 2.2) * 0.3; fn(u, d, 0.75 + rnd() * 0.6 * (1 - d * 2.5)); } };
    fringe(520, (u, d, s) => add(T.maxX + d, T.minZ + 0.03 + u * (T.maxZ - T.minZ), s));
    fringe(300, (u, d, s) => add(T.minX - d, T.minZ + 0.03 + u * (T.maxZ - T.minZ), s));
    fringe(480, (u, d, s) => add(T.minX + u * (T.maxX - T.minX), T.maxZ + d, s));
    for (let i = 0; i < 1100; i++) add(T.maxX + 0.05 + Math.pow(rnd(), 1.7) * (HEDGE.px - T.maxX - 0.1), T.minZ + 0.05 + rnd() * 6.2, 0.45 + rnd() * 0.35);
    for (let i = 0; i < 160; i++) add(HEDGE.px - 0.03 - Math.pow(rnd(), 2) * 0.25, T.minZ + rnd() * 7.5, 1.0 + rnd() * 0.8);
    for (let i = 0; i < 120; i++) add(T.minX + (rnd() - 0.5) * 6, T.maxZ + 0.1 + rnd() * 3.5, 0.8 + rnd() * 0.4);
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pts[i]; pts[i] = pts[j]; pts[j] = t; }
    grass = new THREE.InstancedMesh(geo, mat, pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const gA = new THREE.Color(0x55742b), gB = new THREE.Color(0x8ea648), gC = new THREE.Color(0x9a9450);
    pts.forEach(([x, z, s], i) => {
      e.set((rnd() - 0.5) * 0.25, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25); q.setFromEuler(e);
      sc.set(s * (0.8 + rnd() * 0.4), s * (0.75 + rnd() * 0.5), s * (0.8 + rnd() * 0.4));
      grass.setMatrixAt(i, m4.compose(p.set(x, -0.015, z), q, sc));
      c.copy(gA).lerp(gB, rnd()); if (rnd() < 0.12) c.lerp(gC, 0.6); c.multiplyScalar(0.85 + rnd() * 0.3);
      grass.setColorAt(i, c);
    });
    grass.userData.full = pts.length;
    grass.receiveShadow = true; grass.castShadow = false; grass.name = 'grass';
    grass.computeBoundingSphere();
    group.add(grass);
  }

  __mark("house wall");
  // --- house wall
  {
    const sid = makeSidingTex(512, 256);
    const x0 = -7, x1 = 7.2, y0 = 0.3, y1 = 3.2, z = L.WALL_Z;
    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 8).translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    const uv = geo.attributes.uv, p = geo.attributes.position, cols = [];
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, p.getX(i) / 1.2, (p.getY(i) - y0) / 0.912);
      const k = 0.86 + 0.14 * smooth(y0, 1.3, p.getY(i)); cols.push(k, k * 0.995, k * 0.985);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.MeshStandardMaterial({ map: sid.map, normalMap: sid.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.78, metalness: 0, vertexColors: true });
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.name = 'houseWall'; group.add(m);
    // foundation band (mortar grey)
    const fgeo = worldUV(new THREE.BoxGeometry(x1 - x0, 0.36, 0.06).translate((x0 + x1) / 2, 0.12, z - 0.005), 1.5, 0.37, 0.21);
    const fmat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, color: 0xd2cec6, roughness: 1, metalness: 0 });
    const fm = new THREE.Mesh(fgeo, fmat); fm.receiveShadow = true; group.add(fm);
    // fixtures: flashing, window frame, downspout (one merged mesh, vertex coloured)
    const keep = ['position', 'normal', 'color'];
    const parts = [];
    const box = (w, h, d, x, y, zz, col) => parts.push(stripTo(vcolor(new THREE.BoxGeometry(w, h, d).translate(x, y, zz), col), keep));
    box(x1 - x0, 0.022, 0.05, (x0 + x1) / 2, 0.3, z + 0.02, 0x8e9092);   // 水切り flashing
    const wx = -1.45, wy0 = 1.45, wy1 = 2.35, ww = 1.2, fr = 0.045, alu = 0xb9b8b2;
    box(ww + fr * 2, fr, 0.07, wx, wy0 - fr / 2, z + 0.03, alu); box(ww + fr * 2, fr, 0.07, wx, wy1 + fr / 2, z + 0.03, alu);
    box(fr, wy1 - wy0, 0.07, wx - ww / 2 - fr / 2, (wy0 + wy1) / 2, z + 0.03, alu); box(fr, wy1 - wy0, 0.07, wx + ww / 2 + fr / 2, (wy0 + wy1) / 2, z + 0.03, alu);
    box(0.03, wy1 - wy0, 0.05, wx, (wy0 + wy1) / 2, z + 0.035, alu);
    box(ww + 0.16, 0.025, 0.11, wx, wy0 - fr - 0.012, z + 0.05, 0xa9a8a2);  // sill
    const dsx = 2.32, dsz = z + 0.075;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(dsx, 3.25, dsz), new THREE.Vector3(dsx, 0.4, dsz), new THREE.Vector3(dsx, 0.2, dsz + 0.03), new THREE.Vector3(dsx, 0.1, dsz + 0.12), new THREE.Vector3(dsx, 0.075, dsz + 0.2)], false, 'centripetal');
    parts.push(stripTo(vcolor(new THREE.TubeGeometry(curve, 40, 0.03, 12, false), 0xd2ccbe), keep));
    for (const y of [0.95, 1.95, 2.95]) box(0.075, 0.03, 0.1, dsx, y, z + 0.05, 0xc9c3b4);
    const fmesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 }));
    fmesh.castShadow = true; fmesh.receiveShadow = true; group.add(fmesh);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wy1 - wy0).translate(wx, (wy0 + wy1) / 2, z + 0.02),
      new THREE.MeshStandardMaterial({ color: 0xc4cacd, roughness: 0.3, metalness: 0.0 }));
    group.add(glass);
  }

  __mark("hedges: dark core boxes + instanced alpha-tested leaf cards");
  // --- hedges: dark core boxes + instanced alpha-tested leaf cards
  {
    const leaf = makeLeafTex(512);
    const th = 0.65;
    const cores = [
      { x0: HEDGE.px, x1: HEDGE.px + th, z0: T.minZ, z1: HEDGE.pz + th, face: [-1, 0, 0], dens: 60, top: 40, H: HEDGE.hx },
      { x0: HEDGE.nx - th, x1: HEDGE.px, z0: HEDGE.pz, z1: HEDGE.pz + th, face: [0, 0, -1], dens: 26, top: 18, H: 1.5 },
      { x0: HEDGE.nx - th, x1: HEDGE.nx, z0: T.minZ, z1: HEDGE.pz, face: [1, 0, 0], dens: 26, top: 18, H: 1.5 },
    ];
    const coreGeos = cores.map((c) => new THREE.BoxGeometry(c.x1 - c.x0, c.H - 0.06, c.z1 - c.z0).translate((c.x0 + c.x1) / 2, (c.H - 0.06) / 2, (c.z0 + c.z1) / 2));
    const coreTex = leaf.map.clone(); coreTex.repeat.set(5, 3); coreTex.needsUpdate = true;
    const coreMat = new THREE.MeshStandardMaterial({ map: coreTex, color: 0x7a8a68, roughness: 0.9, metalness: 0 });
    const coreMesh = new THREE.Mesh(mergeGeometries(coreGeos), coreMat); coreMesh.name = 'hedgeCore'; group.add(coreMesh);
    const rnd = makeRng(57), cards = [];
    const nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of cores) {
      const H = c.H, f = new THREE.Vector3(...c.face), alongX = Math.abs(f.z) > 0.5;
      const len = alongX ? c.x1 - c.x0 : c.z1 - c.z0;
      const nFront = Math.round(len * H * c.dens), nTop = Math.round(len * th * c.top);
      const fx = alongX ? null : (f.x < 0 ? c.x0 : c.x1), fz = alongX ? (f.z < 0 ? c.z0 : c.z1) : null;
      for (let i = 0; i < nFront + nTop; i++) {
        const u = rnd(), isTop = i >= nFront, off = -0.03 + rnd() * 0.1;
        let x, y, z;
        nrm.copy(isTop ? up : f);
        if (isTop) {
          const v = rnd();
          x = alongX ? c.x0 + u * len : c.x0 + v * th; z = alongX ? c.z0 + v * th : c.z0 + u * len; y = H - 0.06 + off;
          const edge = Math.min(v, 1 - v); if (edge < 0.18) { const sideN = alongX ? new THREE.Vector3(0, 0, v < 0.5 ? -1 : 1) : new THREE.Vector3(v < 0.5 ? -1 : 1, 0, 0); nrm.lerp(sideN, (0.18 - edge) / 0.18 * 0.7).normalize(); y -= (0.18 - edge) * 0.4; }
        } else {
          y = 0.08 + rnd() * (H - 0.14);
          if (alongX) { x = c.x0 + u * len; z = fz + f.z * off; } else { z = c.z0 + u * len; x = fx + f.x * off; }
          if (y > H - 0.25) nrm.lerp(up, (y - (H - 0.25)) / 0.25 * 0.6).normalize();
        }
        nrm.x += (rnd() - 0.5) * 0.9; nrm.y += (rnd() - 0.5) * 0.9; nrm.z += (rnd() - 0.5) * 0.9; nrm.normalize();
        cards.push({ p: new THREE.Vector3(x, y, z), n: nrm.clone(), s: 0.26 + rnd() * 0.18, roll: rnd() * Math.PI * 2, depth: off, top: isTop || y > H - 0.3 });
      }
    }
    const cardMat = new THREE.MeshStandardMaterial({ map: leaf.map, normalMap: leaf.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cardMat, cards.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), zf = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(), col = new THREE.Color();
    cards.forEach((cd, i) => {
      q.setFromUnitVectors(zf, cd.n); q2.setFromAxisAngle(zf, cd.roll); q.multiply(q2);
      im.setMatrixAt(i, m4.compose(cd.p, q, sc.set(cd.s, cd.s, cd.s)));
      const k = (0.7 + (cd.depth + 0.03) / 0.1 * 0.35) * (0.85 + rnd() * 0.25);
      col.setRGB(k, k, k); if (cd.top && rnd() < 0.6) col.multiply(new THREE.Color(1.12, 1.15, 0.85));
      im.setColorAt(i, col);
    });
    im.name = 'hedgeLeaves'; im.computeBoundingSphere(); group.add(im);
  }

  __mark("distant tree crowns (soft, out of focus) + neighbour houses");
  // --- distant tree crowns (soft, out of focus) + neighbour houses
  {
    const crownTex = makeCrownTex(512);
    const defs = [
      [10.5, 3.2, -3.6, 5.0, 4.4, 0.95, false], [12.5, 4.2, 5.8, 6.2, 5.6, 0.85, true], [17, 5.0, -8.5, 7, 6.4, 0.8, true],
      [8.4, 2.3, 4.6, 2.6, 2.4, 1.0, false], [-8, 3.4, 2.5, 5.5, 5, 0.9, false], [2.5, 3.6, 10, 6, 5.2, 0.9, true], [-4, 3, 9.5, 4.5, 4, 0.85, false],
      [20, 4.6, 9.5, 6, 5.5, 0.8, false],
    ];
    const ref = new THREE.Vector3(0, 1, 0.5);
    defs.sort((a, b) => Math.hypot(b[0] - ref.x, b[2] - ref.z) - Math.hypot(a[0] - ref.x, a[2] - ref.z));
    const geos = defs.map(([x, y, z, w, h, k, flip]) => {
      const g = new THREE.PlaneGeometry(w, h);
      if (flip) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
      const yaw = Math.atan2(ref.x - x, ref.z - z);
      g.rotateY(yaw).translate(x, y, z);
      const n = new THREE.Vector3(ref.x - x, 0, ref.z - z).normalize().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.66, 0)).normalize();
      const na = g.attributes.normal; for (let i = 0; i < na.count; i++) na.setXYZ(i, n.x, n.y, n.z);
      return vcolor(g, new THREE.Color(k, k, k * 0.95).getHex());
    });
    const crowns = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: crownTex, vertexColors: true, transparent: true, depthWrite: false, roughness: 1, metalness: 0 }));
    crowns.renderOrder = -0.5; crowns.name = 'treeCrowns'; group.add(crowns);

    const keep = ['position', 'normal', 'color'];
    const walls = [], roofs = [];
    const house = (cx, cz, w, d, h, ridge, wallCol, roofCol) => {
      walls.push(stripTo(vcolor(new THREE.BoxGeometry(w, h, d).translate(cx, h / 2, cz), wallCol), keep));
      for (let k = 0; k < 2; k++) walls.push(stripTo(vcolor(new THREE.BoxGeometry(0.05, 1.0, 1.4).translate(cx - w / 2 - 0.02, k ? h * 0.72 : h * 0.3, cz - d * 0.2 + k * d * 0.25), 0x4a525a), keep));
      const ov = 0.45, hw = w / 2 + ov, x0 = cx - hw, x1 = cx + hw, z0 = cz - d / 2 - ov, z1 = cz + d / 2 + ov, y0 = h - 0.15, y1 = h + ridge;
      const pos = [x0, y0, z0, cx, y1, z0, cx, y1, z1, x0, y0, z0, cx, y1, z1, x0, y0, z1, x1, y0, z0, x1, y0, z1, cx, y1, z1, x1, y0, z0, cx, y1, z1, cx, y1, z0,
        x0, y0, z0, x0, y0, z1, x0, y0 - 0.12, z1, x0, y0, z0, x0, y0 - 0.12, z1, x0, y0 - 0.12, z0];
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      roofs.push(vcolor(g, roofCol));
      const gab = new THREE.BufferGeometry(); gab.setAttribute('position', new THREE.Float32BufferAttribute([cx - w / 2, h, cz - d / 2, cx + w / 2, h, cz - d / 2, cx, y1 - 0.1, cz - d / 2, cx + w / 2, h, cz + d / 2, cx - w / 2, h, cz + d / 2, cx, y1 - 0.1, cz + d / 2], 3));
      gab.computeVertexNormals(); walls.push(vcolor(gab, wallCol));
    };
    house(30, -11, 8, 7, 5.6, 1.6, 0xd6cfc0, 0x4c535b);
    house(33, 13, 8, 7, 5.2, 1.4, 0xc9ced0, 0x6a5a50);
    house(-14, -1, 7, 8, 5.4, 1.5, 0xd3cbbd, 0x4c535b);
    const hm = new THREE.Mesh(mergeGeometries(walls), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    const rm = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
    hm.name = 'neighbourHouses'; rm.name = 'neighbourRoofs'; group.add(hm, rm);
  }

  __mark("sky dome");
  // --- sky dome
  const skyU = {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uAnti: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: V(0.94, 0.33, -0.1) },
    uGain: { value: 1 }, uDisc: { value: 1 }, uStars: { value: 0 }, uMoon: { value: 0 }, uCover: { value: 0.6 },
    uDrift: { value: new THREE.Vector2(0.13, 0.41) }, uNoise: { value: noiseTex },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'sky';
  sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  group.add(sky);
  scene.fog = new THREE.Fog(0xbcd0e2, 10, 110);

  __mark("lights");
  // --- lights
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012; sun.shadow.radius = 3;
  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x8a7f6c, 0.3);
  sun.name = 'sun'; hemi.name = 'hemi';
  group.add(sun, sun.target, hemi);

  const sunDir = SUN_DIR.clone();
  const focusC = new THREE.Vector3(0, 0, 0); let focusR = 1.6;
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  function updateShadowCam() {
    const r = focusR, D = Math.max(6, r * 2 + 4), c = sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 0.1; c.far = D + r * 2 + 3;
    c.updateProjectionMatrix();
    bx.crossVectors(UP, sunDir); if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0); bx.normalize(); by.crossVectors(sunDir, bx);
    const texel = (2 * r) / sun.shadow.mapSize.x;
    const px = Math.round(focusC.dot(bx) / texel) * texel, py = Math.round(focusC.dot(by) / texel) * texel, pz = focusC.dot(sunDir);
    tmp.copy(bx).multiplyScalar(px).addScaledVector(by, py).addScaledVector(sunDir, pz);
    sun.target.position.copy(tmp); sun.position.copy(tmp).addScaledVector(sunDir, D);
    sun.target.updateMatrixWorld();
  }

  __mark("time of day");
  // --- time of day
  let tod = 0;
  const sSky = new THREE.Vector3();
  function setTimeOfDay(t) {
    t = Math.min(1.25, Math.max(0, Number(t) || 0)); tod = t;
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1], f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const num = (k) => a[k] + (b[k] - a[k]) * f;
    sunDir.copy(a.light).lerp(b.light, f).normalize();
    sSky.copy(a.sun).lerp(b.sun, f).normalize();
    sun.color.copy(a.lc).lerp(b.lc, f); sun.intensity = num('li');
    hemi.color.copy(a.hs).lerp(b.hs, f); hemi.groundColor.copy(a.hg).lerp(b.hg, f); hemi.intensity = num('hi');
    renderer.toneMappingExposure = num('exp'); scene.environmentIntensity = num('env');
    skyU.uZen.value.copy(a.zen).lerp(b.zen, f); skyU.uHor.value.copy(a.hor).lerp(b.hor, f); skyU.uAnti.value.copy(a.anti).lerp(b.anti, f);
    skyU.uGlow.value.copy(a.glow).lerp(b.glow, f); skyU.uSunCol.value.copy(a.sunc).lerp(b.sunc, f);
    skyU.uCloudLit.value.copy(a.cLit).lerp(b.cLit, f); skyU.uCloudShade.value.copy(a.cShade).lerp(b.cShade, f); skyU.uGround.value.copy(a.ground).lerp(b.ground, f);
    skyU.uSunDir.value.copy(sSky);
    skyU.uGain.value = num('gain'); skyU.uDisc.value = num('disc'); skyU.uStars.value = num('stars'); skyU.uMoon.value = num('moon'); skyU.uCover.value = num('cover');
    scene.fog.color.copy(a.fog).lerp(b.fog, f);
    if (scene.background && scene.background.isColor) scene.background.copy(scene.fog.color);
    updateShadowCam();
  }

  function setShadowFocus(center, radius) {
    if (center) focusC.copy(center);
    if (radius > 0) focusR = radius;
    updateShadowCam();
  }

  function setQuality(lowQ) {
    const s = lowQ ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } updateShadowCam(); }
    grass.count = lowQ ? Math.floor(grass.userData.full * 0.5) : grass.userData.full;
  }

  function update(dt) {
    dt = Math.min(dt || 0, 0.1);
    uTime.value = (uTime.value + dt) % 1000;
    const d = skyU.uDrift.value; d.x = (d.x + dt * 0.0011) % 1; d.y = (d.y + dt * 0.0005) % 1;
  }

  __mark("end"); setTimeOfDay(0);
  if (low) setQuality(true);

  return {
    group,
    setTimeOfDay,
    get timeOfDay() { return tod; },
    set timeOfDay(v) { setTimeOfDay(v); },
    setShadowFocus,
    setQuality,
    sunDir,
    sun, hemi,
    update, _t: __t,
  };
}
