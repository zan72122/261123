// Washing props: garden tap (立水栓 + 横水栓), blue poly wash tub with water, shoe brush, laundry soap + dish.
// All textures procedural (2D canvas). See factories at the bottom of each section.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// procedural texture helpers
// ---------------------------------------------------------------------------------------------
function mulberry(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function mkTex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4; t.needsUpdate = true; return t;
}
function periodicNoise(seed, px, py) {
  const r = mulberry(seed); const g = new Float32Array(px * py); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * px + x0], b = g[y0 * px + x1], c = g[y1 * px + x0], d = g[y1 * px + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
// tileable fbm in [0,1] (normalized to min/max)
function fbmField(w, h, seed, bx, by, oct, gain = 0.5) {
  const out = new Float32Array(w * h); let amp = 1;
  for (let o = 0; o < oct; o++) {
    const px = bx << o, py = by << o, n = periodicNoise(seed + o * 131, px, py);
    for (let y = 0; y < h; y++) { const fy = (y / h) * py; for (let x = 0; x < w; x++) out[y * w + x] += amp * n((x / w) * px, fy); }
    amp *= gain;
  }
  let mn = 1e9, mx = -1e9; for (let i = 0; i < out.length; i++) { mn = Math.min(mn, out[i]); mx = Math.max(mx, out[i]); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
}
function heightToNormal(hf, w, h, strength) {
  const c = mkCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = (x + w - 1) % w, xr = (x + 1) % w, yu = (y + h - 1) % h, yd = (y + 1) % h;
    const du = (hf[y * w + xr] - hf[y * w + xl]) * strength, dv = (hf[yu * w + x] - hf[yd * w + x]) * strength;
    const l = Math.hypot(du, dv, 1), i = (y * w + x) * 4;
    d[i] = (-du / l * 0.5 + 0.5) * 255; d[i + 1] = (-dv / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function upscale(c, w, h) { const o = mkCanvas(w, h), g = o.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(c, 0, 0, w, h); return o; }
function fieldToCanvas(f, w, h, fn) {
  const c = mkCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) { const v = fn(f[i], i); d[i * 4] = v[0]; d[i * 4 + 1] = v[1]; d[i * 4 + 2] = v[2]; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
}
// tileable sum-of-sines water normal map (analytic gradient)
function waveNormalCanvas(w, h, seed, n, kx0, kx1, ky0, ky1, strength, pow = 1.3) {
  const r = mulberry(seed), W = [];
  for (let i = 0; i < n; i++) {
    let kx, ky, k;
    do { kx = Math.round(lerp(-kx1, kx1, r())); ky = Math.round(lerp(-ky1, ky1, r())); k = Math.hypot(kx, ky); }
    while (Math.abs(kx) < kx0 && Math.abs(ky) < ky0 || k < 1);
    W.push([kx, ky, r() * TAU, 1 / Math.pow(k, pow)]);
  }
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h); let mx = 0;
  // cos(A+B) = cosA cosB - sinA sinB with per-row / per-column tables
  const cx = new Float32Array(n * w), sx = new Float32Array(n * w), cy = new Float32Array(n * h), sy = new Float32Array(n * h);
  for (let i = 0; i < n; i++) {
    for (let x = 0; x < w; x++) { const a = TAU * W[i][0] * x / w + W[i][2]; cx[i * w + x] = Math.cos(a); sx[i * w + x] = Math.sin(a); }
    for (let y = 0; y < h; y++) { const a = TAU * W[i][1] * y / h; cy[i * h + y] = Math.cos(a); sy[i * h + y] = Math.sin(a); }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const q = W[i], cs = (cx[i * w + x] * cy[i * h + y] - sx[i * w + x] * sy[i * h + y]) * q[3]; a += cs * q[0]; b += cs * q[1]; }
    gx[y * w + x] = a; gy[y * w + x] = b; const m = a * a + b * b; if (m > mx) mx = m;
  }
  mx = Math.sqrt(mx);
  const c = mkCanvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const nx = -gx[i] / mx * strength, ny = gy[i] / mx * strength, l = Math.hypot(nx, ny, 1);
    d[i * 4] = (nx / l * 0.5 + 0.5) * 255; d[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; d[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

const TEX = {}; // module-level cache (shared by all instances)
function texWaterN() { return TEX.wn || (TEX.wn = mkTex(waveNormalCanvas(192, 192, 11, 20, 1, 9, 1, 9, 1.0), false, true)); }
function texStreamN() { return TEX.sn || (TEX.sn = mkTex(waveNormalCanvas(64, 192, 23, 14, 1, 4, 0, 10, 1.4, 1.0), false, true)); }
function texStreak() { // vertical rivulet streaks (alpha), u periodic
  if (TEX.st) return TEX.st;
  const f = fbmField(128, 128, 77, 8, 2, 4, 0.6);
  return (TEX.st = mkTex(fieldToCanvas(f, 128, 128, v => { const a = 255 * (0.35 + 0.65 * smooth(0.3, 0.8, v)); return [a, a, a]; }), false, true));
}
function texCaustic() { // domain-warped cellular network: curvy bright caustic lines
  if (TEX.ca) return TEX.ca;
  const S = 192, C = 5, r = mulberry(5), pts = [];
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push([(i + 0.2 + r() * 0.6) / C, (j + 0.2 + r() * 0.6) / C]);
  const wx = periodicNoise(71, 4, 4), wy = periodicNoise(72, 4, 4);
  const f = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let u = x / S, v = y / S; const du = (wx(u * 4, v * 4) - 0.5) * 0.16, dv = (wy(u * 4, v * 4) - 0.5) * 0.16;
    u = ((u + du) % 1 + 1) % 1; v = ((v + dv) % 1 + 1) % 1;
    const ci = Math.floor(u * C), cj = Math.floor(v * C); let f1 = 9, f2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + C) % C, jj = (cj + dj + C) % C, p = pts[jj * C + ii];
      const ex = u - (p[0] + (ci + di - ii) / C), ey = v - (p[1] + (cj + dj - jj) / C), d = ex * ex + ey * ey;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    f1 = Math.sqrt(f1) * C; f2 = Math.sqrt(f2) * C;
    f[y * S + x] = (f2 - f1) + f1 * 0.12;
  }
  return (TEX.ca = mkTex(fieldToCanvas(f, S, S, v => { const a = 255 * Math.pow(Math.max(0, 1 - v / 0.3), 2.4); return [a, a, a]; }), false, true));
}
// soap foam: color (sRGB), alpha (density field; shader thresholds it), normal (fine bubbles)
function texFoam() {
  if (TEX.fo) return TEX.fo;
  const S = 384, r = mulberry(91), s2 = 192;
  const isl2 = fbmField(s2, s2, 41, 3, 3, 5, 0.62);
  const islD = upscale(fieldToCanvas(isl2, s2, s2, v => [v * 255, v * 255, v * 255]), S, S).getContext('2d').getImageData(0, 0, S, S).data;
  const col = new Float32Array(S * S).fill(236), hf = new Float32Array(S * S).fill(0.5);
  for (let n = 0; n < 7000; n++) { // tiny bubbles: darker pit, bright upper-left rim
    const cx = r() * S, cy = r() * S, rad = 0.45 + Math.pow(r(), 5) * 3.2, k = 0.2 + r() * 0.35, R = Math.ceil(rad + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const px = Math.floor(cx) + dx, py = Math.floor(cy) + dy, d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / rad;
      if (d >= 1.15) continue;
      const i = ((py + S) % S) * S + ((px + S) % S);
      if (d < 0.85) { col[i] = lerp(col[i], 206, k); hf[i] = lerp(hf[i], 0.25, 0.4); }
      else { hf[i] = lerp(hf[i], 0.9, 0.6); if (dx + dy < 0 && rad > 1) col[i] = lerp(col[i], 252, 0.8); }
    }
  }
  const cc = fieldToCanvas(col, S, S, v => [v, v - 1, v - 4]);
  const alpha = fieldToCanvas(hf, S, S, (h, i) => { const a = 255 * clamp(islD[i * 4] / 255 + (h - 0.5) * 0.14, 0, 1); return [a, a, a]; });
  const crown = fieldToCanvas(isl2, s2, s2, (v, i) => { const x = (i % s2) / (s2 / 2) - 1, y = Math.floor(i / s2) / (s2 / 2) - 1, d = Math.hypot(x, y); const a = 255 * clamp((1 - d) * 1.5, 0, 1) * clamp((v - 0.3) * 2.4 + (1 - d) * 0.9 + (r() - 0.5) * 0.6, 0, 1); return [a, a, a]; });
  TEX.fo = { map: mkTex(cc, true, true), alpha: mkTex(alpha, false, true), normal: mkTex(heightToNormal(hf, S, S, 1.1), false, true), crown: mkTex(crown, false, false) };
  return TEX.fo;
}
function texChromeRough() {
  if (TEX.cr) return TEX.cr;
  const S = 256, r = mulberry(13), c = mkCanvas(S, S), g = c.getContext('2d');
  const f = fbmField(64, 64, 3, 4, 4, 3);
  g.drawImage(fieldToCanvas(f, 64, 64, v => { const a = 18 + v * 22; return [a, a, a]; }), 0, 0, S, S);
  for (let i = 0; i < 160; i++) { // dried water spots (rings)
    const x = r() * S, y = r() * S, rad = 1 + r() * 5;
    g.strokeStyle = `rgba(150,150,150,${0.25 + r() * 0.4})`; g.lineWidth = 0.6 + r(); g.beginPath(); g.arc(x, y, rad, 0, TAU); g.stroke();
    g.fillStyle = `rgba(110,110,110,${0.1 + r() * 0.2})`; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  return (TEX.cr = mkTex(c, false, true));
}

// keep explicit envMap in sync with scene.environment (so per-material envMapIntensity works)
function envSync(scene, mats) {
  const env = scene ? scene.environment : null;
  for (const m of mats) if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; }
}

// Water material: specular is NOT scaled by opacity (premultiplied output) + Fresnel opacity.
// opts: color, opacity, roughness, env, normalMap, ns, alphaMap, gate (spec gated by alpha), key, uniforms, head, patch(sh)
function waterMaterial(o = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: o.color !== undefined ? o.color : 0x9aaab0, roughness: o.roughness !== undefined ? o.roughness : 0.05, metalness: 0,
    transparent: true, depthWrite: false, opacity: o.opacity !== undefined ? o.opacity : 0.2,
    ior: 1.333, specularIntensity: 1, envMapIntensity: o.env !== undefined ? o.env : 1.4, side: o.side || THREE.FrontSide,
  });
  if (o.normalMap) { m.normalMap = o.normalMap; m.normalScale.set(o.ns || 0.5, o.ns || 0.5); }
  if (o.alphaMap) m.alphaMap = o.alphaMap;
  m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  const U = Object.assign({ uFres: { value: o.fres !== undefined ? o.fres : 1 }, uGate: { value: o.gate || 0 } }, o.uniforms || {});
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFres; uniform float uGate;\n' + (o.head || ''))
      .replace('#include <opaque_fragment>', `
        float wFr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0) * uFres;
        float wG = mix(1.0, clamp(diffuseColor.a * 3.0, 0.0, 1.0), uGate);
        float wA = clamp(diffuseColor.a + (1.0 - diffuseColor.a) * wFr * 0.85 * wG, 0.0, 1.0);
        gl_FragColor = vec4(totalDiffuse * diffuseColor.a + (outgoingLight - totalDiffuse) * wG, wA);`);
    if (o.patch) o.patch(sh);
  };
  m.customProgramCacheKey = () => 'washwater-' + (o.key || 'base');
  return m;
}

// simple ballistic droplets (instanced, stretched along velocity)
class Drops {
  constructor(parent, max, mat) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.r = new Float32Array(max); this.life = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    parent.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3(); this._o = new THREE.Vector3();
    this.onLand = null;
  }
  spawn(x, y, z, vx, vy, vz, r, life = 2, floorY = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz; this.r[i] = r; this.life[i] = life; this.floor[i] = floorY;
  }
  kill(i) {
    const k = --this.n;
    if (i !== k) { for (let a = 0; a < 3; a++) { this.p[i * 3 + a] = this.p[k * 3 + a]; this.v[i * 3 + a] = this.v[k * 3 + a]; } this.r[i] = this.r[k]; this.life[i] = this.life[k]; this.floor[i] = this.floor[k]; }
  }
  update(dt) {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.n; i++) {
      const j = i * 3; this.v[j + 1] -= 9.8 * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt; this.life[i] -= dt;
      if (this.p[j + 1] < this.floor[i] || this.life[i] <= 0) {
        if (this.onLand && this.life[i] > 0) this.onLand(this.p[j], this.floor[i], this.p[j + 2], this.r[i], this.v[j + 1]);
        this.kill(i); i--; continue;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const j = i * 3; this._d.set(this.v[j], this.v[j + 1], this.v[j + 2]); const sp = this._d.length();
      if (sp > 1e-4) this._d.multiplyScalar(1 / sp); else this._d.set(0, 1, 0);
      this._q.setFromUnitVectors(up, this._d);
      const r = this.r[i]; this._s.set(r, r * (1 + Math.min(4, sp * 0.012 / r)), r);
      this._o.set(this.p[j], this.p[j + 1], this.p[j + 2]);
      this._m.compose(this._o, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Garden tap (立水栓) with cross-handle bib tap and water stream
// ---------------------------------------------------------------------------------------------
function postTextures() {
  if (TEX.post) return TEX.post;
  const W = 128, H = 1024, r = mulberry(7);
  const f = fbmField(W / 2, H / 2, 17, 2, 16, 4, 0.55);
  const c = upscale(fieldToCanvas(f, W / 2, H / 2, v => { const b = 168 + (v - 0.5) * 30; return [b, b * 0.985, b * 0.955]; }), W, H);
  const g = c.getContext('2d');
  { // granite-like speckles (擬石), written straight into the pixels
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < 6000; i++) {
      const x = (r() * W) | 0, y = (r() * H) | 0, t = r(), a = 0.5 + r() * 0.5;
      const c = t < 0.45 ? [52, 50, 48] : t < 0.8 ? [210, 208, 200] : [150, 128, 105];
      const sz = r() < 0.85 ? 1 : 2;
      for (let yy = 0; yy < sz; yy++) for (let xx = 0; xx < sz; xx++) { const k = (((y + yy) % H) * W + ((x + xx) % W)) * 4; for (let q = 0; q < 3; q++) d[k + q] = lerp(d[k + q], c[q], a); }
    }
    g.putImageData(img, 0, 0);
  }
  // vertical water stains below the tap height and darker splash zone near the ground
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y0 = H * (0.06 + r() * 0.12), len = H * (0.15 + r() * 0.45), w = 1 + r() * 4;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, 'rgba(70,66,58,0)'); gr.addColorStop(0.2, `rgba(70,66,58,${0.06 + r() * 0.1})`); gr.addColorStop(1, 'rgba(70,66,58,0)');
    g.fillStyle = gr; g.fillRect(x, y0, w, len);
  }
  const gb = g.createLinearGradient(0, H, 0, H * 0.9); gb.addColorStop(0, 'rgba(62,58,48,0.45)'); gb.addColorStop(1, 'rgba(62,58,48,0)');
  g.fillStyle = gb; g.fillRect(0, H * 0.9, W, H * 0.1);
  const hf = new Float32Array(W * H), d = g.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hf[i] = d[i * 4 + 1] / 255;
  TEX.post = { map: mkTex(c, true, false), bump: mkTex(heightToNormal(hf, W, H, 1.2), false, false) };
  return TEX.post;
}
function boxProjectUV(geo, x0, sx, y0, sy) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay > ax && ay > az) { u = p.getX(i); v = p.getZ(i) + y0 + 0.3; }
    else if (ax > az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, (u - x0) * sx, (v - y0) * sy);
  }
  uv.needsUpdate = true;
}

export function createFaucet(ctx) {
  const scene = ctx.scene, low = ctx.quality && ctx.quality.low;
  const group = new THREE.Group(); group.name = 'faucet';
  const mats = [];
  // --- post ---
  const pt = postTextures();
  const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pt.map, normalMap: pt.bump, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.86, metalness: 0 });
  const postGeo = new RoundedBoxGeometry(0.07, 0.6, 0.07, 3, 0.0035); postGeo.translate(0, 0.3, 0);
  boxProjectUV(postGeo, -0.035, 1 / 0.07, 0, 1 / 0.62);
  const post = new THREE.Mesh(postGeo, stone); post.castShadow = post.receiveShadow = true; group.add(post);
  const capGeo = new RoundedBoxGeometry(0.08, 0.022, 0.08, 3, 0.005); capGeo.translate(0, 0.609, 0);
  boxProjectUV(capGeo, -0.04, 1 / 0.08, 0, 1 / 0.62);
  const cap = new THREE.Mesh(capGeo, stone); cap.castShadow = cap.receiveShadow = true; group.add(cap);
  // mortar collar at the ground
  const collarGeo = new RoundedBoxGeometry(0.084, 0.012, 0.084, 2, 0.004); collarGeo.translate(0, 0.002, 0);
  const collar = new THREE.Mesh(collarGeo, new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.95 })); collar.receiveShadow = true; group.add(collar);

  // --- chrome tap ---
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd2d5d9, metalness: 1, roughness: 1, roughnessMap: texChromeRough(), envMapIntensity: 1.25 });
  chrome.onBeforeCompile = (sh) => { // fake surroundings in reflections: darker ground / horizon clutter -> contrasty chrome
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( RE_IndirectSpecular )
      { vec3 rW = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
        float az = atan(rW.z, rW.x);
        float k = mix(0.16, 1.0, smoothstep(-0.02, 0.32, rW.y + 0.05 * sin(az * 5.0)));
        k *= 1.0 - 0.35 * smoothstep(0.0, 0.12, rW.y) * (1.0 - smoothstep(0.12, 0.3, rW.y)) * (0.5 + 0.5 * sin(az * 3.0 + 1.0));
        radiance *= k; }
      #endif`);
  };
  chrome.customProgramCacheKey = () => 'wash-chrome';
  chrome.roughnessMap.repeat.set(3, 3);
  mats.push(chrome);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const RS = low ? 20 : 32;
  const Y = 0.565;
  add(new THREE.CylinderGeometry(0.017, 0.0175, 0.005, RS), chrome, 0, Y, 0.0375, Math.PI / 2);                // flange 座金
  add(new THREE.CylinderGeometry(0.0098, 0.0098, 0.02, RS), chrome, 0, Y, 0.049, Math.PI / 2);                  // nipple
  add(new THREE.CylinderGeometry(0.0128, 0.0128, 0.011, 6), chrome, 0, Y, 0.0625, Math.PI / 2, 0, Math.PI / 6); // hex
  add(new THREE.CylinderGeometry(0.0112, 0.0112, 0.09, RS), chrome, 0, Y, 0.107, Math.PI / 2);                  // body
  const bul = add(new THREE.SphereGeometry(0.0155, RS, 20), chrome, 0, Y, 0.100); bul.scale.set(1, 0.92, 1.2);   // valve chamber
  add(new THREE.CylinderGeometry(0.0135, 0.0135, 0.009, 6), chrome, 0, 0.5845, 0.100, 0, Math.PI / 6);          // bonnet nut
  add(new THREE.CylinderGeometry(0.0125, 0.0135, 0.002, 6), chrome, 0, 0.5795, 0.100, 0, Math.PI / 6);
  add(new THREE.CylinderGeometry(0.0082, 0.0088, 0.012, RS), chrome, 0, 0.595, 0.100);                          // gland
  add(new THREE.CylinderGeometry(0.003, 0.003, 0.008, 12), chrome, 0, 0.603, 0.100);                            // spindle
  // spout tube
  const sp = [];
  for (let i = 0; i <= 8; i++) sp.push(new THREE.Vector3(0, Y, lerp(0.14, 0.21, i / 8)));
  for (let i = 1; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; sp.push(new THREE.Vector3(0, 0.535 + Math.cos(a) * 0.03, 0.21 + Math.sin(a) * 0.03)); }
  for (let i = 1; i <= 3; i++) sp.push(new THREE.Vector3(0, lerp(0.535, 0.527, i / 3), 0.24));
  const spoutGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp, false, 'catmullrom', 0), 64, 0.0088, RS, false);
  add(spoutGeo, chrome, 0, 0, 0);
  // hose-thread nozzle
  const noz = [[0.0, 0.0], [0.0062, 0.0], [0.0088, 0.0003], [0.0094, 0.001], [0.0094, 0.0025], [0.0086, 0.003], [0.0086, 0.0035], [0.0095, 0.004], [0.0095, 0.0055], [0.0086, 0.006], [0.0086, 0.0066], [0.0094, 0.007], [0.0094, 0.0085], [0.0089, 0.009]].map(a => new THREE.Vector2(a[0], a[1]));
  add(new THREE.LatheGeometry(noz, RS), chrome, 0, 0.52, 0.24);
  const bore = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.6, side: THREE.BackSide });
  add(new THREE.CylinderGeometry(0.0058, 0.0058, 0.012, 16, 1, true), bore, 0, 0.526, 0.24);
  add(new THREE.TorusGeometry(0.0072, 0.0011, 8, 28), new THREE.MeshStandardMaterial({ color: 0xcfcbbf, roughness: 0.9 }), 0, 0.5204, 0.24, Math.PI / 2); // limescale

  // --- cross handle (十字ハンドル) ---
  const handle = new THREE.Group(); handle.position.set(0, 0.6045, 0.100); group.add(handle);
  const hub = [[0, 0], [0.006, 0], [0.0088, 0.0008], [0.0102, 0.0032], [0.0106, 0.006], [0.0101, 0.009], [0.0088, 0.0108], [0.0068, 0.0118], [0, 0.0119]].map(a => new THREE.Vector2(a[0], a[1]));
  add(new THREE.LatheGeometry(hub, RS), chrome, 0, 0, 0, 0, 0, 0, handle);
  const armP = [[0, 0.004], [0.0052, 0.004], [0.0051, 0.01], [0.0043, 0.017], [0.0037, 0.023], [0.0041, 0.0268], [0.0047, 0.0292], [0.0044, 0.0312], [0.0032, 0.0322], [0.0015, 0.0326], [0, 0.0327]].map(a => new THREE.Vector2(a[0], a[1]));
  const armGeo = new THREE.LatheGeometry(armP, 20); armGeo.scale(1, 1, 0.78); armGeo.rotateZ(-Math.PI / 2);
  for (let i = 0; i < 4; i++) add(armGeo, chrome, 0, 0.0058, 0, 0, i * Math.PI / 2 + Math.PI / 4, 0, handle);
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x1f5cc4, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  add(new THREE.CylinderGeometry(0.0058, 0.006, 0.0014, RS), blue, 0, 0.0122, 0, 0, 0, 0, handle);
  add(new THREE.TorusGeometry(0.0061, 0.0006, 6, RS), chrome, 0, 0.0122, 0, Math.PI / 2, 0, 0, handle);

  const spoutTip = new THREE.Object3D(); spoutTip.position.set(0, 0.52, 0.24); group.add(spoutTip);

  // --- water stream ---
  const NR = low ? 10 : 14, NL = low ? 40 : 64;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array((NR + 1) * (NL + 1) * 3), sUV = new Float32Array((NR + 1) * (NL + 1) * 2), sIdx = [];
  for (let i = 0; i < NL; i++) for (let j = 0; j < NR; j++) { const a = i * (NR + 1) + j, b = a + NR + 1; sIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); sGeo.setAttribute('uv', new THREE.BufferAttribute(sUV, 2)); sGeo.setIndex(sIdx);
  sGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(sPos.length), 3));
  const sN = texStreamN().clone(); sN.needsUpdate = true; sN.repeat.set(1, 1);
  const streamMat = waterMaterial({ color: 0x4c5c64, opacity: 0.07, roughness: 0.02, env: 1.5, normalMap: sN, ns: 0.9, key: 'stream', fres: 0.8 });
  mats.push(streamMat);
  const stream = new THREE.Mesh(sGeo, streamMat); stream.frustumCulled = false; stream.renderOrder = 4; stream.visible = false; group.add(stream);
  // impact foam crown
  const ft = texFoam();
  const crownGroup = new THREE.Group(); crownGroup.visible = false; group.add(crownGroup);
  const crownMats = [];
  for (let k = 0; k < 2; k++) {
    const a = ft.crown.clone(); a.needsUpdate = true; a.center.set(0.5, 0.5); if (k) a.repeat.set(-1, 1);
    const cm = ft.map.clone(); cm.needsUpdate = true; cm.repeat.set(0.12, 0.12);
    const m = new THREE.MeshStandardMaterial({ color: 0xe6eef5, emissive: 0x3a4046, map: cm, alphaMap: a, transparent: true, depthWrite: false, roughness: 0.35, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    crownMats.push(m);
    const d = new THREE.Mesh(new THREE.CircleGeometry(1, 32), m); d.rotation.x = -Math.PI / 2; d.position.y = 0.0008 + k * 0.0004; d.renderOrder = 5; crownGroup.add(d);
  }
  // drops
  const dropMat = waterMaterial({ color: 0xa0b0b8, opacity: 0.28, roughness: 0.03, env: 2.4, key: 'drop' }); mats.push(dropMat);
  const drops = new Drops(group, Math.round(160 * ((ctx.quality && ctx.quality.particleScale) || 1)), dropMat);
  // own material instance: sharing one between an InstancedMesh and a plain Mesh makes three re-derive the program on every draw
  const hangMat = waterMaterial({ color: 0xa0b0b8, opacity: 0.28, roughness: 0.03, env: 2.4, key: 'drop' }); mats.push(hangMat);
  const hang = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hangMat); hang.visible = false; hang.renderOrder = 4; group.add(hang);

  let flow = 0, landLocal = 0, time = 0, hangR = 0, dripAcc = 0, splashAcc = 0, handleAngle = 0;
  const api = { group, handle, spoutTip, onDrop: null };
  const _w = new THREE.Vector3();
  drops.onLand = (x, y, z, r, vy) => {
    if (r > 0.0012 && y > 0.001) for (let k = 0; k < 2; k++) { const a = Math.random() * TAU, s = 0.15 + Math.random() * 0.25; drops.spawn(x, y + 0.002, z, Math.cos(a) * s * 0.6, s, Math.sin(a) * s * 0.6, r * 0.35, 0.5, y); }
    if (api.onDrop && r > 0.0012) { _w.set(x, y, z); group.localToWorld(_w); api.onDrop(_w, r); }
  };
  api.setHandleAngle = (rad) => { handleAngle = rad; handle.rotation.y = rad; };
  api.setFlow = (f, landY) => {
    flow = clamp(f || 0, 0, 1);
    if (landY !== undefined) { group.updateWorldMatrix(true, false); _w.set(0, landY, 0.24); group.worldToLocal(_w); landLocal = Math.min(_w.y, 0.515); }
  };
  const TIP_Y = 0.52, TIP_Z = 0.24;
  function buildStream(len, r0, v0, breakTaper) {
    const tw = time;
    for (let i = 0; i <= NL; i++) {
      const t = i / NL, h = t * len;
      const vv = Math.sqrt(v0 * v0 + 2 * 9.8 * h);
      let r = r0 * Math.sqrt(v0 / vv);
      r *= 1 + 0.07 * Math.sin(h * 95 - tw * 31) * smooth(0.0, 0.08, h) + 0.04 * Math.sin(h * 211 - tw * 47);
      if (breakTaper) { const e = smooth(0.55, 1, t); r *= (1 - e * 0.85) * (1 + 0.45 * e * Math.sin(h * 600 - tw * 60)); }
      if (i === 0) r *= 1.05;
      const wob = 0.0022 * smooth(0.02, 0.45, h) * (1 + flow);
      const ox = wob * Math.sin(h * 17 - tw * 9.3) + 0.6 * wob * Math.sin(h * 41 - tw * 15.1);
      const oz = wob * 0.7 * Math.cos(h * 13 - tw * 7.7) + 0.4 * wob * Math.sin(h * 37 - tw * 12.3);
      const tws = h * 26 + tw * 1.7;
      const y = TIP_Y + 0.004 - h;
      for (let j = 0; j <= NR; j++) {
        const a = (j / NR) * TAU, ell = 1 + 0.12 * Math.cos(2 * (a - tws));
        const k = (i * (NR + 1) + j) * 3;
        sPos[k] = Math.cos(a) * r * ell + ox; sPos[k + 1] = y; sPos[k + 2] = TIP_Z + Math.sin(a) * r * ell + oz;
        const q = (i * (NR + 1) + j) * 2; sUV[q] = j / NR; sUV[q + 1] = h * 7;
      }
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.uv.needsUpdate = true; sGeo.computeVertexNormals();
  }
  api.update = (dt) => {
    time += dt; envSync(scene, mats);
    const f = flow, fall = TIP_Y - landLocal;
    sN.offset.y -= dt * (2.2 + f * 2.5) * 7 / 7;
    stream.visible = false; crownGroup.visible = false; hang.visible = false;
    if (f >= 0.02 && f < 0.045) {           // slow drip: a drop swells at the outlet and lets go
      hangR += dt * (0.0012 + f * 0.05);
      if (hangR > 0.0029) { drops.spawn(0, TIP_Y - hangR, TIP_Z, 0, -0.05, 0, hangR * 0.92, 3, landLocal); hangR = 0.0006; }
      hang.visible = true; hang.position.set(0, TIP_Y - hangR * 0.75, TIP_Z); hang.scale.set(hangR, hangR * 1.15, hangR);
    } else if (f >= 0.045) {
      const r0 = 0.0072 * Math.pow(f, 0.62), v0 = 0.25 + f * 1.1;
      const full = f >= 0.12;
      const len = full ? fall : Math.min(fall, 0.025 + (f - 0.045) / 0.075 * 0.22);
      buildStream(len, r0, v0, !full);
      stream.visible = true;
      if (!full) {
        dripAcc += dt * (10 + f * 160);
        while (dripAcc > 1) { dripAcc -= 1; const vv = Math.sqrt(v0 * v0 + 2 * 9.8 * len); drops.spawn((Math.random() - 0.5) * 0.001, TIP_Y - len, TIP_Z + (Math.random() - 0.5) * 0.001, 0, -vv, 0, r0 * (1.1 + Math.random() * 0.6), 3, landLocal); }
      } else {
        // impact crown + splash
        crownGroup.visible = true; crownGroup.position.set(0, landLocal, TIP_Z);
        const R = 0.016 + 0.024 * f;
        crownGroup.children[0].scale.setScalar(R); crownGroup.children[1].scale.setScalar(R * 0.75);
        crownMats[0].alphaMap.rotation = time * 1.7; crownMats[1].alphaMap.rotation = -time * 2.3;
                crownMats[0].opacity = 0.85 * smooth(0.1, 0.5, f); crownMats[1].opacity = smooth(0.1, 0.5, f);
        const rb = r0 * Math.sqrt(v0 / Math.sqrt(v0 * v0 + 2 * 9.8 * fall));
        splashAcc += dt * 40 * f * ((ctx.quality && ctx.quality.particleScale) || 1);
        while (splashAcc > 1) {
          splashAcc -= 1; const a = Math.random() * TAU, s = 0.25 + Math.random() * 0.45 * f;
          drops.spawn(Math.cos(a) * rb * 1.5, landLocal + 0.002, TIP_Z + Math.sin(a) * rb * 1.5, Math.cos(a) * s * 0.5, s, Math.sin(a) * s * 0.5, 0.0006 + Math.random() * 0.0012, 1, landLocal - 0.0005);
        }
      }
    }
    drops.update(dt);
  };
  api.update(0);
  return api;
}

// ---------------------------------------------------------------------------------------------
// 2. Blue polyethylene wash tub with water
// ---------------------------------------------------------------------------------------------
const B = { OUTER_R: 0.27, INNER_R: 0.25, FLOOR_R: 0.21, FLOOR_Y: 0.008, RIM_Y: 0.13, DEPTH: 0.105, TOP: 0.1215, PIVOT_Z: 0.208 };
function innerR(y) { // inner wall radius at local height y (water edge)
  y = clamp(y, B.FLOOR_Y, B.TOP);
  return (y < 0.016 ? lerp(0.2055, 0.2125, (y - B.FLOOR_Y) / (0.016 - B.FLOOR_Y)) : 0.2125 + (y - 0.016) * (0.037 / 0.104)) - 0.0006;
}
function basinTextures() {
  if (TEX.basin) return TEX.basin;
  const W = 512, H = 256, r = mulberry(29);
  const f = fbmField(W / 2, H / 2, 61, 8, 4, 3);
  const rc = upscale(fieldToCanvas(f, W / 2, H / 2, v => { const a = 70 + v * 22; return [a, a, a]; }), W, H); // roughness ~0.3
  const g = rc.getContext('2d');
  const cc = upscale(fieldToCanvas(f, W / 2, H / 2, v => { const a = 244 + (v - 0.5) * 14; return [a, a, a]; }), W, H); // colour modulation (×basin colour)
  const c2 = cc.getContext('2d');
  for (let i = 0; i < 900; i++) { // fine scratches & scuffs
    const x = r() * W, y = r() * H, len = 3 + r() * 26, a = (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI / 2);
    g.strokeStyle = `rgba(190,190,190,${0.25 + r() * 0.5})`; g.lineWidth = 0.5 + r() * 0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    if (r() < 0.35) { c2.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.25})`; c2.lineWidth = 0.6; c2.beginPath(); c2.moveTo(x, y); c2.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c2.stroke(); }
  }
  for (let i = 0; i < 40; i++) { // dull rubbed patches
    const x = r() * W, y = r() * H, rad = 6 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(160,160,160,0.35)'); gr.addColorStop(1, 'rgba(160,160,160,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  TEX.basin = { rough: mkTex(rc, false, true), color: mkTex(cc, true, true) };
  return TEX.basin;
}

export function createBasin(ctx) {
  const scene = ctx.scene, low = ctx.quality && ctx.quality.low, pscale = (ctx.quality && ctx.quality.particleScale) || 1;
  const group = new THREE.Group(); group.name = 'basin';
  const pivot = new THREE.Group(); pivot.position.set(0, 0, B.PIVOT_Z); group.add(pivot);
  const body = new THREE.Group(); body.position.set(0, 0, -B.PIVOT_Z); pivot.add(body);
  const content = new THREE.Group(); content.name = 'basinContent'; body.add(content);
  const mats = [];

  // ---- tub shell (lathe) ----
  const prof = [
    [0, 0.0046], [0.06, 0.0046], [0.12, 0.0044], [0.18, 0.0041], [0.193, 0.0036], [0.1975, 0.0018], [0.2005, 0.0003], [0.204, 0], [0.207, 0.0003], [0.2092, 0.0017], [0.2108, 0.0045],
    [0.2118, 0.008], [0.2155, 0.02], [0.226, 0.046], [0.238, 0.075], [0.2455, 0.096], [0.2505, 0.108], [0.2525, 0.1135],
    [0.2555, 0.1163], [0.2605, 0.1168], [0.2652, 0.1178], [0.2685, 0.1198], [0.2699, 0.1228], [0.2697, 0.1258], [0.2678, 0.1284], [0.2645, 0.1298], [0.2605, 0.1301], [0.2565, 0.1294], [0.2532, 0.1276], [0.2512, 0.1251],
    [0.2499, 0.1215], [0.2492, 0.119], [0.2445, 0.105], [0.236, 0.081], [0.225, 0.051], [0.2155, 0.0225], [0.2126, 0.016], [0.2112, 0.0124], [0.2088, 0.0099], [0.2052, 0.0085], [0.2, 0.008],
    [0.176, 0.008], [0.1735, 0.0092], [0.171, 0.0093], [0.1685, 0.008], [0.126, 0.008], [0.1238, 0.009], [0.1215, 0.009], [0.1193, 0.008], [0.072, 0.008], [0.0702, 0.0087], [0.0684, 0.0087], [0.0666, 0.008],
    [0.008, 0.008], [0.0052, 0.0084], [0.003, 0.0091], [0, 0.0093],
  ];
  const lPts = prof.map(a => new THREE.Vector2(a[0], a[1]));
  const SEG = low ? 72 : 128;
  const shellGeo = new THREE.LatheGeometry(lPts, SEG);
  { // arc-length v + dust vertex colours
    const n = lPts.length, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + lPts[i].distanceTo(lPts[i - 1]));
    const uv = shellGeo.attributes.uv, pos = shellGeo.attributes.position, col = new Float32Array(pos.count * 3);
    const rr = mulberry(8);
    for (let i = 0; i < pos.count; i++) {
      const j = i % n; uv.setY(i, cum[j] / cum[n - 1] * 2.0); uv.setX(i, uv.getX(i) * 5);
      const y = pos.getY(i), rad = Math.hypot(pos.getX(i), pos.getZ(i));
      const outside = j < 18; let d = outside ? smooth(0.05, 0.0, y) * 0.22 : 0;
      if (j > 36) d = 0.02 * rr(); // inner floor: barely dusty
      col[i * 3] = 1 - d * 0.7; col[i * 3 + 1] = 1 - d * 0.8; col[i * 3 + 2] = 1 - d;
      void rad;
    }
    shellGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const bt = basinTextures();
  const basinU = { uPlane: { value: new THREE.Vector4(0, 1, 0, -1) }, uWater: { value: 0 }, uMurk: { value: 0 }, uTime: { value: 0 }, uCaus: { value: texCaustic() } };
  const plastic = new THREE.MeshPhysicalMaterial({
    color: 0x4da7e0, map: bt.color, roughness: 1, roughnessMap: bt.rough, metalness: 0, vertexColors: true,
    clearcoat: 0.25, clearcoatRoughness: 0.35, emissive: 0x08263a, envMapIntensity: 1.0, sheen: 0.0,
  });
  mats.push(plastic);
  plastic.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, basinU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLP; varying vec3 vLN; uniform vec4 uPlane; uniform float uWater, uMurk, uTime; uniform sampler2D uCaus;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      {
        float wd = uPlane.w - dot(uPlane.xyz, vLP);
        float rr = length(vLP.xz);
        float inner = (vLN.y > 0.5 && vLP.y < 0.02) || dot(vLN.xz, vLP.xz) < 0.0 ? 1.0 : 0.0;
        inner *= step(rr, 0.2508) * step(0.0035, vLP.y);
        if (uWater > 0.5 && inner > 0.5 && wd > 0.0) {
          vec3 absorb = mix(vec3(5.0, 1.5, 1.1), vec3(60.0, 64.0, 70.0), uMurk);
          vec3 tr = exp(-absorb * (wd * 1.6 + 0.004));
          vec2 cp = vLP.xz * 5.5;
          float c1 = texture2D(uCaus, cp + vec2(uTime * 0.031, uTime * 0.017)).r;
          float c2 = texture2D(uCaus, cp * 1.37 + vec2(0.37, 0.11) + vec2(-uTime * 0.023, uTime * 0.029)).r;
          float cs = (c1 * c2 * 2.4 + (c1 + c2) * 0.22) * (1.0 - uMurk) * smoothstep(0.0, 0.012, wd);
          reflectedLight.directDiffuse *= tr * (0.7 + cs);
          reflectedLight.indirectDiffuse *= tr * 0.92;
          reflectedLight.directSpecular *= tr * 0.25;
          reflectedLight.indirectSpecular *= tr * 0.3;
          totalEmissiveRadiance *= tr;
        } else if (uWater > 0.5 && inner > 0.5 && wd > -0.004) {
          // wet film just above the waterline
          reflectedLight.directDiffuse *= 0.85;
        }
      }`);
  };
  plastic.customProgramCacheKey = () => 'wash-basin';
  const shell = new THREE.Mesh(shellGeo, plastic); shell.castShadow = true; shell.receiveShadow = true; body.add(shell);

  // ---- water surface (world-horizontal plane clipped to the tub interior; rebuilt on level/tilt change) ----
  const NZ = low ? 26 : 38, NX = low ? 20 : 30;
  const wGeo = new THREE.BufferGeometry();
  const wPos = new Float32Array(NZ * NX * 3), wNor = new Float32Array(NZ * NX * 3), wUV = new Float32Array(NZ * NX * 2), wEdge = new Float32Array(NZ * NX);
  const wIdx = []; for (let i = 0; i < NZ - 1; i++) for (let j = 0; j < NX - 1; j++) { const a = i * NX + j, b = a + NX; wIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3)); wGeo.setAttribute('normal', new THREE.BufferAttribute(wNor, 3));
  wGeo.setAttribute('uv', new THREE.BufferAttribute(wUV, 2)); wGeo.setAttribute('aEdge', new THREE.BufferAttribute(wEdge, 1)); wGeo.setIndex(wIdx);
  const MAXR = 8;
  const rip = []; for (let i = 0; i < MAXR; i++) rip.push(new THREE.Vector4(0, 0, 99, 0));
  const wU = { uTime: { value: 0 }, uRip: { value: rip }, uAg: { value: 0 }, uMurkW: { value: 0 } };
  const waterMat = waterMaterial({
    color: 0x1b4a52, opacity: 0.2, roughness: 0.03, env: 1.7, normalMap: texWaterN(), ns: 0.3, key: 'basinwater', fres: 0.6, uniforms: wU,
    head: `uniform float uTime, uAg, uMurkW; uniform vec4 uRip[${MAXR}]; varying float vEdge;`,
    patch: (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float ce = 1.0 - smoothstep(0.0, 0.006, vEdge);
          diffuseColor.rgb *= 1.0 - ce * 0.55;
          diffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, 0.6), ce * 0.75);`)
        .replace('#include <normal_fragment_maps>', `
          vec2 wp = vNormalMapUv;
          vec2 g1 = texture2D(normalMap, wp * 3.4 + vec2(uTime * 0.021, uTime * 0.013)).xy * 2.0 - 1.0;
          vec2 g2 = texture2D(normalMap, wp * vec2(-5.3, 4.7) + vec2(-uTime * 0.017, uTime * 0.027)).xy * 2.0 - 1.0;
          vec2 g3 = texture2D(normalMap, wp * 13.0 + vec2(uTime * 0.09, -uTime * 0.07)).xy * 2.0 - 1.0;
          vec2 gg = (g1 + g2 * 0.8) * normalScale.x + g3 * (0.04 + uAg * 0.25) * (1.0 - uMurkW * 0.5);
          for (int k = 0; k < ${MAXR}; k++) {
            vec4 R = uRip[k];
            if (R.z < 4.0) {
              vec2 dv = wp - R.xy; float d = length(dv) + 1e-5;
              float fr = R.z * 0.20;
              float x = d - fr;
              float env = exp(-x * x / (0.00012 + R.z * 0.0009)) * R.w * exp(-R.z * 1.1) * smoothstep(0.0, 0.02, fr + 0.004);
              gg += dv / d * cos(x * 260.0) * env * 0.7;
            }
          }
          vec3 mapN = normalize(vec3(gg, 1.0));
          normal = normalize(tbn * mapN);`);
    },
  });
  mats.push(waterMat);
  const water = new THREE.Mesh(wGeo, waterMat); water.renderOrder = 2; water.frustumCulled = false; water.visible = false; water.receiveShadow = false; body.add(water);

  // foam / soap scum on the surface
  const ft = texFoam();
  const fU = { uTime: { value: 0 }, uFoam: { value: 0 } };
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xe6e5df, map: ft.map, alphaMap: ft.alpha, normalMap: ft.normal, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, depthWrite: false, roughness: 0.42, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  foamMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
    const uvx = 'vec2 fuv = vec2(cos(uTime*0.03)*vMapUv.x - sin(uTime*0.03)*vMapUv.y, sin(uTime*0.03)*vMapUv.x + cos(uTime*0.03)*vMapUv.y) * 4.2 + vec2(uTime*0.004, uTime*0.003);';
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime, uFoam; varying float vEdge;')
      .replace('#include <map_fragment>', `${uvx}\n diffuseColor *= texture2D(map, fuv);`)
      .replace('#include <alphamap_fragment>', `
        float fa = texture2D(alphaMap, fuv).g;
        float fb = texture2D(alphaMap, fuv * 0.37 + 0.31).g;
        float dens = fa * 0.75 + fb * 0.35 + (1.0 - smoothstep(0.0, 0.035, vEdge)) * 0.25;
        float T = mix(1.2, 0.3, uFoam);
        float body = smoothstep(T - 0.02, T + 0.09, dens);
        diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(T + 0.02, T + 0.2, dens));
        diffuseColor.a *= (smoothstep(T - 0.12, T + 0.02, dens) * 0.45 + body * 0.5) * smoothstep(0.0, 0.002, vEdge);`)
      .replace('#include <normal_fragment_maps>', `vec3 mapN = texture2D(normalMap, fuv).xyz * 2.0 - 1.0; mapN.xy *= normalScale; normal = normalize(tbn * mapN);`);
  };
  foamMat.customProgramCacheKey = () => 'wash-foam';
  mats.push(foamMat);
  const foam = new THREE.Mesh(wGeo, foamMat); foam.renderOrder = 3; foam.frustumCulled = false; foam.visible = false; body.add(foam);

  // ---- overflow film on the outside wall ----
  const ofProf = [];
  for (let i = 25; i >= 10; i--) { const p = prof[i], nr = p[0] + 0.0014; if (i <= 18 || p[1] < 0.1265) ofProf.push(new THREE.Vector2(nr, p[1] + (i === 25 ? 0.001 : 0))); }
  ofProf.reverse();
  const ofGeo = new THREE.LatheGeometry(ofProf, SEG);
  { const uv = ofGeo.attributes.uv, n = ofProf.length; for (let i = 0; i < uv.count; i++) { uv.setX(i, uv.getX(i) * 9); uv.setY(i, (i % n) / (n - 1) * 1.5); } }
  const ofN = texStreamN().clone(); ofN.needsUpdate = true; const ofA = texStreak().clone(); ofA.needsUpdate = true;
  const ofMat = waterMaterial({ color: 0x6f8890, opacity: 0.5, roughness: 0.04, env: 1.3, normalMap: ofN, ns: 0.45, alphaMap: ofA, gate: 1, key: 'overflow' });
  mats.push(ofMat);
  const overflowMesh = new THREE.Mesh(ofGeo, ofMat); overflowMesh.visible = false; overflowMesh.renderOrder = 2; body.add(overflowMesh);
  // wet ground (ring around the tub and puddle under the pour)
  const wetMat = new THREE.MeshPhysicalMaterial({ color: 0x1c1a17, roughness: 0.2, transparent: true, opacity: 0, depthWrite: false, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mats.push(wetMat);
  const wetA = fbmField(96, 96, 5, 4, 4, 3);
  const wetTex = mkTex(fieldToCanvas(wetA, 96, 96, (v, i) => { const x = (i % 96) / 48 - 1, y = Math.floor(i / 96) / 48 - 1, d = Math.hypot(x, y); const a = 255 * clamp((0.75 - d) * 7 + (v - 0.5) * 4, 0, 1); return [a, a, a]; }), false, false);
  wetMat.alphaMap = wetTex;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.36, 72, 1), wetMat.clone()); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0006; ring.visible = false; group.add(ring);
  ring.material.alphaMap = null; mats.push(ring.material);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 48), wetMat); puddle.rotation.x = -Math.PI / 2; puddle.visible = false; group.add(puddle);

  // ---- pour sheet over the front rim ----
  const PR = 12, PL = low ? 30 : 44;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array((PR + 1) * PL * 3), pUV = new Float32Array((PR + 1) * PL * 2), pIdx = [];
  for (let i = 0; i < PL - 1; i++) for (let j = 0; j < PR; j++) { const a = i * (PR + 1) + j, b = a + PR + 1; pIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('uv', new THREE.BufferAttribute(pUV, 2)); pGeo.setIndex(pIdx);
  pGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pPos.length), 3));
  const pN = texStreamN().clone(); pN.needsUpdate = true; pN.repeat.set(2, 1);
  const pourMat = waterMaterial({ color: 0x8090a0, opacity: 0.3, roughness: 0.05, env: 1.9, normalMap: pN, ns: 0.8, key: 'pour', side: THREE.DoubleSide });
  mats.push(pourMat);
  const pourMesh = new THREE.Mesh(pGeo, pourMat); pourMesh.visible = false; pourMesh.frustumCulled = false; pourMesh.renderOrder = 4; group.add(pourMesh);
  const splashFoamMat = new THREE.MeshStandardMaterial({ color: 0xe0dfd8, map: ft.map, alphaMap: ft.crown.clone(), transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  splashFoamMat.alphaMap.needsUpdate = true; splashFoamMat.alphaMap.center.set(0.5, 0.5);
  const splashFoam = new THREE.Mesh(new THREE.CircleGeometry(1, 32), splashFoamMat); splashFoam.rotation.x = -Math.PI / 2; splashFoam.position.y = 0.001; splashFoam.visible = false; splashFoam.renderOrder = 5; group.add(splashFoam);
  const dropMat = waterMaterial({ color: 0x9aaab2, opacity: 0.3, roughness: 0.04, env: 2.2, key: 'bdrop' }); mats.push(dropMat);
  const drops = new Drops(group, Math.round(220 * pscale), dropMat);

  // ---- state ----
  let level = 0, murk = 0, foamAmt = 0, tilt = 0, pour = 0, overflow = 0, time = 0, agit = 0, dirty = true, hasWater = false;
  let wetRing = 0, wetPuddle = 0, puddleR = 0.05, splashAcc = 0;
  const landing = new THREE.Vector3(0, 0, 0.5);
  const cMurk = new THREE.Color(0x2e261d), cClear = new THREE.Color(0x1b4a52), tmpC = new THREE.Color();

  function rebuild() {
    dirty = false;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const hc = B.FLOOR_Y + level * B.DEPTH, D = Math.min(c * hc, c * B.TOP - s * innerR(B.TOP));
    basinU.uPlane.value.set(0, c, -s, D);
    if (level <= 0.0005) { hasWater = false; water.visible = foam.visible = false; basinU.uWater.value = 0; return; }
    const yOf = z => (D + s * z) / c;
    const g = z => { const rw = innerR(yOf(z)); return rw * rw - z * z; };
    const bis = (a, b) => { for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if ((g(m) > 0) === (g(b) > 0)) b = m; else a = m; } return (a + b) / 2; };
    let zlo = bis(-0.28, 0), zhi = bis(0.28, 0);
    if (s > 1e-5) { zlo = Math.max(zlo, (c * B.FLOOR_Y - D) / s); zhi = Math.min(zhi, (c * B.TOP - D) / s); }
    if (zhi - zlo < 0.002) { hasWater = false; water.visible = foam.visible = false; basinU.uWater.value = 0; return; }
    hasWater = true; basinU.uWater.value = 1;
    for (let i = 0; i < NZ; i++) {
      const u = i / (NZ - 1), z = zlo + (zhi - zlo) * (0.5 - 0.5 * Math.cos(Math.PI * u)), y = yOf(z), w = Math.sqrt(Math.max(0, g(z)));
      for (let j = 0; j < NX; j++) {
        const x = -w * Math.cos(Math.PI * j / (NX - 1)), k = i * NX + j;
        wPos[k * 3] = x; wPos[k * 3 + 1] = y; wPos[k * 3 + 2] = z;
        wNor[k * 3] = 0; wNor[k * 3 + 1] = c; wNor[k * 3 + 2] = -s;
        wUV[k * 2] = x; wUV[k * 2 + 1] = -z;
        wEdge[k] = Math.max(0, Math.min(w - Math.abs(x), z - zlo, zhi - z));
      }
    }
    wGeo.attributes.position.needsUpdate = true; wGeo.attributes.normal.needsUpdate = true; wGeo.attributes.uv.needsUpdate = true; wGeo.attributes.aEdge.needsUpdate = true;
    wGeo.computeBoundingSphere();
  }
  const toRoot = (x, y, z, out) => { // body-local -> group-local (tilt about the front bottom edge)
    const c = Math.cos(tilt), s = Math.sin(tilt), rz = z - B.PIVOT_Z;
    return out.set(x, y * c - rz * s, y * s + rz * c + B.PIVOT_Z);
  };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _T = new THREE.Vector3(), _N = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
  const pts = []; for (let i = 0; i < 80; i++) pts.push(new THREE.Vector3());
  function buildPour() {
    const rate = pour;
    // path: across the rim, then ballistic to the ground
    let n = 0;
    toRoot(0, B.FLOOR_Y + level * B.DEPTH, 0.226, pts[n++]);
    toRoot(0, 0.1265, 0.2505, pts[n++]);
    toRoot(0, 0.1325, 0.2605, pts[n++]);
    toRoot(0, 0.1295, 0.268, pts[n++]);
    toRoot(0, 0.1228, 0.2715, pts[n++]);
    const p0 = pts[n - 1].clone(), dir = pts[n - 1].clone().sub(pts[n - 3]).normalize();
    const sp = 0.32 + 0.45 * rate, vx = dir.z * sp, vy = dir.y * sp;
    for (let k = 1; k < 70 && n < 80; k++) {
      const t = k * 0.012, y = p0.y + vy * t - 4.9 * t * t, z = p0.z + vx * t;
      if (y <= 0) { const tt = (vy + Math.sqrt(vy * vy + 19.6 * p0.y)) / 9.8; pts[n++].set(0, 0, p0.z + vx * tt); break; }
      pts[n++].set(0, y, z);
    }
    landing.copy(pts[n - 1]);
    // resample by arc length into PL rings
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[n - 1];
    let seg = 0;
    const W0 = 0.04 + 0.07 * rate, T0 = 0.003 + 0.005 * rate;
    for (let i = 0; i < PL; i++) {
      const L = (i / (PL - 1)) * total;
      while (seg < n - 2 && cum[seg + 1] < L) seg++;
      const f = (L - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      _a.lerpVectors(pts[seg], pts[seg + 1], f);
      _T.subVectors(pts[seg + 1], pts[seg]).normalize();
      _N.crossVectors(_T, _X).normalize();
      const t = L / total, over = smooth(0, 0.12, t);
      const W = W0 * (1 - 0.55 * t) * (0.75 + 0.25 * over) * (1 + 0.06 * Math.sin(L * 60 - time * 18));
      const Th = T0 * (0.6 + 1.6 * t) * (1 + 0.15 * Math.sin(L * 90 - time * 25));
      const wx = 0.002 * t * Math.sin(L * 25 - time * 9);
      for (let j = 0; j <= PR; j++) {
        const a = (j / PR) * TAU, k = (i * (PR + 1) + j);
        const ca = Math.cos(a), sa = Math.sin(a);
        const lip = i < 5 ? 0.5 : 1; // thin sheet hugging the rim
        _b.copy(_a).addScaledVector(_X, ca * W * 0.5 + wx).addScaledVector(_N, sa * Th * 0.5 * lip);
        if (i < 5) _b.addScaledVector(_N, Th * 0.35);
        pPos[k * 3] = _b.x; pPos[k * 3 + 1] = _b.y; pPos[k * 3 + 2] = _b.z;
        pUV[k * 2] = j / PR; pUV[k * 2 + 1] = L * 5;
      }
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.uv.needsUpdate = true; pGeo.computeVertexNormals(); pGeo.computeBoundingSphere();
  }

  const api = {
    group, content, OUTER_R: B.OUTER_R, INNER_R: B.INNER_R, FLOOR_R: B.FLOOR_R, FLOOR_Y: B.FLOOR_Y, RIM_Y: B.RIM_Y, DEPTH: B.DEPTH,
  };
  api.setWater = (l, m, f) => {
    l = clamp(l || 0, 0, 1); m = clamp(m || 0, 0, 1); f = clamp(f || 0, 0, 1);
    if (l !== level) { level = l; dirty = true; }
    murk = m; foamAmt = f;
  };
  api.waterY = () => { group.updateWorldMatrix(true, false); _c.set(0, B.FLOOR_Y + level * B.DEPTH, 0); return group.localToWorld(_c).y; };
  let ripI = 0;
  api.ripple = (x, z, strength = 1) => {
    let k = -1; for (let i = 0; i < MAXR; i++) if (rip[i].z > 4) { k = i; break; }
    if (k < 0) { k = ripI; ripI = (ripI + 1) % MAXR; }
    rip[k].set(x, -z, 0, clamp(strength, 0, 2));
    agit = Math.min(1.5, agit + 0.15 * strength);
  };
  api.agitate = (a) => { agit = Math.min(1.5, Math.max(agit, a)); };
  api.setTilt = (rad) => { rad = clamp(rad || 0, 0, 1.2); if (rad !== tilt) { tilt = rad; pivot.rotation.x = rad; dirty = true; } };
  api.setPour = (r) => { pour = clamp(r || 0, 0, 1); };
  api.pourLanding = (out = new THREE.Vector3()) => { group.updateWorldMatrix(true, false); if (pour <= 0.01) buildPour(); return out.copy(landing).applyMatrix4(group.matrixWorld); };
  api.setOverflow = (r) => { overflow = clamp(r || 0, 0, 1); };

  api.update = (dt) => {
    time += dt; envSync(scene, mats);
    if (dirty) rebuild();
    for (let i = 0; i < MAXR; i++) if (rip[i].z < 9) rip[i].z += dt;
    agit = Math.max(0, agit - dt * 0.8);
    wU.uTime.value = time; wU.uAg.value = agit; wU.uMurkW.value = murk; basinU.uTime.value = time; basinU.uMurk.value = murk; fU.uTime.value = time; fU.uFoam.value = foamAmt;
    // water look: clear -> inky
    const mk = Math.pow(murk, 0.65);
    tmpC.copy(cClear).lerp(cMurk, smooth(0, 0.6, murk));
    waterMat.color.copy(tmpC);
    waterMat.opacity = lerp(0.2, 0.975, mk); waterMat.envMapIntensity = lerp(1.7, 1.3, murk);
    waterMat.roughness = lerp(0.025, 0.14, murk);
    waterMat.normalScale.setScalar((0.13 + Math.min(agit, 1) * 0.12 + pour * 0.2) * (1 - murk * 0.3));
    water.visible = hasWater;
    foam.visible = hasWater && foamAmt > 0.01;
    foamMat.color.setRGB(lerp(0.9, 0.5, murk), lerp(0.9, 0.48, murk), lerp(0.87, 0.43, murk));
    // pour
    const mcol = tmpC;
    if (pour > 0.01) {
      buildPour(); pourMesh.visible = true;
      pourMat.color.copy(mcol).lerp(new THREE.Color(0x8c9ca4), 1 - smooth(0, 0.6, murk));
      pourMat.opacity = lerp(0.22, 0.93, mk) * (0.75 + 0.25 * pour); pourMat.envMapIntensity = lerp(1.9, 0.9, murk);
      pN.offset.y -= dt * 4.5;
      // splash
      splashAcc += dt * 70 * pour * pscale;
      while (splashAcc > 1) {
        splashAcc -= 1; const a = Math.random() * TAU, s = 0.25 + Math.random() * 0.6 * pour;
        drops.spawn(landing.x + (Math.random() - 0.5) * 0.05 * pour, 0.003, landing.z, Math.cos(a) * s * 0.55, s * (0.6 + Math.random() * 0.6), Math.sin(a) * s * 0.55 + 0.1, 0.0012 + Math.random() * 0.0025 * pour, 1.2, 0);
      }
      dropMat.color.copy(pourMat.color); dropMat.opacity = Math.max(0.3, pourMat.opacity * 0.85);
      splashFoam.visible = true; splashFoam.position.set(landing.x, 0.0012, landing.z); splashFoam.scale.setScalar(0.03 + 0.05 * pour);
      splashFoamMat.alphaMap.rotation = time * 1.3; splashFoamMat.opacity = 0.85 * pour;
      splashFoamMat.color.setRGB(lerp(0.9, 0.35, mk), lerp(0.9, 0.32, mk), lerp(0.88, 0.28, mk));
      wetPuddle = Math.min(1, wetPuddle + dt * 0.6 * pour); puddleR = Math.min(0.32, puddleR + dt * 0.05 * pour);
    } else { pourMesh.visible = false; splashFoam.visible = false; }
    if (wetPuddle > 0.002) {
      wetPuddle = Math.max(0, wetPuddle - dt * 0.004);
      puddle.visible = true; puddle.position.set(landing.x, 0.0007, landing.z + puddleR * 0.25); puddle.scale.set(puddleR * 1.35, puddleR, 1);
      wetMat.opacity = 0.7 * smooth(0, 0.3, wetPuddle);
      wetMat.color.setRGB(lerp(0.11, 0.07, mk), lerp(0.105, 0.06, mk), lerp(0.1, 0.05, mk));
    } else puddle.visible = false;
    // overflow
    if (overflow > 0.01) {
      overflowMesh.visible = true; ofMat.opacity = 0.12 + 0.3 * overflow; ofN.offset.y += dt * 2.0; ofA.offset.y += dt * 0.9;
      ofMat.color.copy(mcol).lerp(new THREE.Color(0x7d8f98), 1 - smooth(0, 0.6, murk));
      wetRing = Math.min(1, wetRing + dt * 0.8 * overflow);
    } else overflowMesh.visible = false;
    if (wetRing > 0.002) { wetRing = Math.max(0, wetRing - dt * 0.004); ring.visible = true; ring.material.opacity = 0.26 * smooth(0, 0.4, wetRing); ring.scale.setScalar(0.92 + 0.12 * wetRing); } else ring.visible = false;
    drops.update(dt);
  };
  api.update(0);
  return api;
}

// ---------------------------------------------------------------------------------------------
// 3. Shoe brush (シューズブラシ)
// ---------------------------------------------------------------------------------------------
export function createBrush(ctx) {
  const scene = ctx.scene, low = ctx.quality && ctx.quality.low;
  const group = new THREE.Group(); group.name = 'brush';
  const mats = [];
  const top = new THREE.Group(); group.add(top); // head + handle (moves down a little when pressed)
  const white = new THREE.MeshPhysicalMaterial({ color: 0xedebe4, roughness: 0.38, clearcoat: 0.15, clearcoatRoughness: 0.4 }); mats.push(white);
  const ROOT_Y = 0.0215, BL = 0.022;
  const headGeo = new RoundedBoxGeometry(0.036, 0.0125, 0.056, 4, 0.0042); headGeo.translate(0, ROOT_Y + 0.0058, 0);
  const head = new THREE.Mesh(headGeo, white); head.castShadow = head.receiveShadow = true; top.add(head);
  // handle: flat extrude with a hanging hole, tilted up toward +Z
  const hw = (z) => lerp(0.0095, 0.0078, smooth(0.02, 0.05, z)) + (0.0122 - 0.0078) * smooth(0.05, 0.10, z);
  const shp = new THREE.Shape();
  const Z0 = 0.012, ZE = 0.112, NS = 26;
  shp.moveTo(hw(Z0), Z0);
  for (let i = 1; i <= NS; i++) { const z = lerp(Z0, ZE, i / NS); shp.lineTo(hw(z), z); }
  shp.absarc(0, ZE, hw(ZE), 0, Math.PI, false);
  for (let i = NS; i >= 0; i--) { const z = lerp(Z0, ZE, i / NS); shp.lineTo(-hw(z), z); }
  shp.closePath();
  const hole = new THREE.Path(); hole.absellipse(0, 0.1115, 0.0045, 0.0052, 0, TAU, true); shp.holes.push(hole);
  const hGeo = new THREE.ExtrudeGeometry(shp, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.0022, bevelSegments: 4, curveSegments: 28 });
  hGeo.rotateX(Math.PI / 2); // shape y -> +z, extrude -> -y
  const HTOP = ROOT_Y + 0.0118;
  hGeo.translate(0, HTOP - 0.0022, 0);
  const handleG = new THREE.Group(); handleG.position.set(0, HTOP - 0.003, 0.016); handleG.rotation.x = -0.2; top.add(handleG);
  hGeo.translate(0, -(HTOP - 0.003), -0.016);
  const handle = new THREE.Mesh(hGeo, white); handle.castShadow = handle.receiveShadow = true; handleG.add(handle);
  // pale-green soft grip inset
  const gw = (z) => hw(z) - 0.0024;
  const gs = new THREE.Shape(); const G0 = 0.04, G1 = 0.094;
  gs.moveTo(gw(G0), G0); for (let i = 1; i <= 16; i++) { const z = lerp(G0, G1, i / 16); gs.lineTo(gw(z), z); }
  gs.absarc(0, G1, gw(G1), 0, Math.PI, false);
  for (let i = 16; i >= 0; i--) { const z = lerp(G0, G1, i / 16); gs.lineTo(-gw(z), z); }
  gs.absarc(0, G0, gw(G0), Math.PI, TAU, false);
  const gGeo = new THREE.ExtrudeGeometry(gs, { depth: 0.0006, bevelEnabled: true, bevelThickness: 0.0007, bevelSize: 0.0007, bevelSegments: 3, curveSegments: 20 });
  gGeo.rotateX(Math.PI / 2); gGeo.translate(0, HTOP + 0.0012 - (HTOP - 0.003), -0.016);
  const rib = mkCanvas(8, 64), rg = rib.getContext('2d');
  for (let y = 0; y < 64; y++) { const v = 128 + 110 * Math.sin(y / 64 * TAU); rg.fillStyle = `rgb(${v},${v},${v})`; rg.fillRect(0, y, 8, 1); }
  const ribTex = mkTex(rib, false, true); ribTex.repeat.set(200, 280);
  const grip = new THREE.MeshPhysicalMaterial({ color: 0x9fd4b4, roughness: 0.62, bumpMap: ribTex, bumpScale: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xd8f0e0) });
  mats.push(grip);
  const gripM = new THREE.Mesh(gGeo, grip); gripM.castShadow = true; gripM.receiveShadow = true; handleG.add(gripM);

  // bristles: tufts of instanced nylon fibres
  const nylon = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.42 }); mats.push(nylon);
  const rnd = mulberry(77);
  const tufts = [];
  const COLS = 5, ROWS = 8;
  for (let rI = 0; rI < ROWS; rI++) for (let cI = 0; cI < COLS; cI++) {
    const stag = (rI % 2) * 0.5 - 0.25;
    const x = (cI - (COLS - 1) / 2 + stag * 0.6) * 0.0062, z = (rI - (ROWS - 1) / 2) * 0.0064;
    if (Math.abs(x) > 0.0145) continue;
    tufts.push([x, z]);
  }
  const FPT = low ? 14 : 24, fibres = [];
  for (const t of tufts) for (let k = 0; k < FPT; k++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * 0.0021;
    fibres.push({ x: t[0] + Math.cos(a) * rr, z: t[1] + Math.sin(a) * rr, ox: Math.cos(a) * rr / 0.0021, oz: Math.sin(a) * rr / 0.0021, jx: (rnd() - 0.5) * 0.09, jz: (rnd() - 0.5) * 0.09, l: 0.96 + rnd() * 0.06, tx: t[0], tz: t[1] });
  }
  const fGeo = new THREE.CylinderGeometry(0.00021, 0.00027, 1, 5, 1, false); fGeo.translate(0, -0.5, 0);
  const fib = new THREE.InstancedMesh(fGeo, nylon, fibres.length); fib.castShadow = true; fib.receiveShadow = true; group.add(fib);
  { const col = new THREE.Color(); for (let i = 0; i < fibres.length; i++) { const v = 0.93 + rnd() * 0.07; fib.setColorAt(i, col.setRGB(v, v, v * 0.985)); } }
  const coreGeo = new THREE.CylinderGeometry(0.0013, 0.0016, 1, 10, 1, false); coreGeo.translate(0, -0.5, 0);
  const cores = new THREE.InstancedMesh(coreGeo, nylon, tufts.length); cores.receiveShadow = true; group.add(cores);
  { const white = new THREE.Color(1, 1, 1); for (let i = 0; i < tufts.length; i++) cores.setColorAt(i, white); } // same program variant as the fibres
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  let press = -1, foamF = -1;
  function layBristles(p) {
    const drop = 0.0065 * p; top.position.y = -drop;
    const root = ROOT_Y - drop, spl = 0.12 + 0.9 * p;
    for (let i = 0; i < fibres.length; i++) {
      const f = fibres[i];
      // outward splay from tuft centre and from head centre when pressed
      _d.set(f.ox * spl * 0.9 + f.jx + f.tx * 30 * p, -1, f.oz * spl * 0.9 + f.jz + f.tz * 16 * p).normalize();
      const L = root / -_d.y * f.l;
      _q.setFromUnitVectors(DOWN, _d); _p.set(f.x, root + 0.0004, f.z); _s.set(1, L, 1);
      _m.compose(_p, _q, _s); fib.setMatrixAt(i, _m);
    }
    fib.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < tufts.length; i++) { _q.identity(); _p.set(tufts[i][0], root + 0.0004, tufts[i][1]); _s.set(1 + p * 0.4, root * 0.85, 1 + p * 0.4); _m.compose(_p, _q, _s); cores.setMatrixAt(i, _m); }
    cores.instanceMatrix.needsUpdate = true;
  }
  // soap lather blobs
  const ft = texFoam();
  const foamMat = new THREE.MeshPhysicalMaterial({ color: 0xefeee9, roughness: 0.32, normalMap: ft.normal, normalScale: new THREE.Vector2(1.2, 1.2), sheen: 0.5, sheenColor: new THREE.Color(0xffffff), envMapIntensity: 1.1 });
  ft.normal.repeat.set(1, 1); mats.push(foamMat);
  const NF = low ? 60 : 110;
  const blobs = [];
  const NCL = Math.round(NF / 7);
  for (let c = 0; c < NCL; c++) {
    const side = rnd(); let x, y, z;
    if (side < 0.5) { x = (rnd() - 0.5) * 0.03; z = (rnd() - 0.5) * 0.05; y = rnd() * 0.01; }                    // among the bristle tips
    else if (side < 0.85) { const a = rnd() * TAU; x = Math.cos(a) * 0.018; z = Math.sin(a) * 0.028; y = 0.003 + rnd() * 0.016; } // around the tuft field
    else { x = (rnd() - 0.5) * 0.03; z = (rnd() - 0.5) * 0.04 - 0.005; y = ROOT_Y + 0.0122; }                  // on the head
    const th = rnd(), big = 0.0022 + rnd() * 0.0028;
    for (let k = 0; k < 7; k++) {
      const rr = big * (k === 0 ? 1 : 0.25 + rnd() * 0.55), a = rnd() * TAU, d = k === 0 ? 0 : big * (0.8 + rnd() * 0.7);
      blobs.push({ x: x + Math.cos(a) * d, y: y + (rnd() - 0.3) * big * 0.6, z: z + Math.sin(a) * d, r: rr, th: Math.min(0.99, th + k * 0.02), sq: 0.7 + rnd() * 0.3 });
    }
  }
  blobs.sort((a, b) => a.th - b.th);
  const foamI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), foamMat, blobs.length); foamI.count = 0; group.add(foamI);
  function layFoam(f) {
    let n = 0;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i]; const vis = smooth(b.th * 0.92, b.th * 0.92 + 0.08, f); if (vis <= 0) continue;
      const r = b.r * vis * (0.6 + 0.4 * f);
      _q.identity(); _p.set(b.x, b.y, b.z); _s.set(r, r * b.sq, r); _m.compose(_p, _q, _s); foamI.setMatrixAt(n++, _m);
    }
    foamI.count = n; foamI.instanceMatrix.needsUpdate = true;
  }
  const api = { group, LENGTH: 0.15 };
  api.setPress = (p) => { p = clamp(p || 0, 0, 1); if (Math.abs(p - press) > 1e-4) { press = p; layBristles(p); } };
  api.setFoam = (f) => { f = clamp(f || 0, 0, 1); if (Math.abs(f - foamF) > 1e-4) { foamF = f; layFoam(f); } };
  api.update = () => { envSync(scene, mats); };
  api.setPress(0); api.setFoam(0); api.update(0);
  return api;
}

// ---------------------------------------------------------------------------------------------
// 4. Laundry soap bar in a ribbed soap dish
// ---------------------------------------------------------------------------------------------
function soapTextures() {
  if (TEX.soap) return TEX.soap;
  const S = 256, r = mulberry(55);
  const f = fbmField(S / 2, S / 2, 9, 4, 4, 4);
  const col = upscale(fieldToCanvas(f, S / 2, S / 2, v => [150 + v * 26, 200 + v * 18, 132 + v * 20]), S, S);
  const g = col.getContext('2d');
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(250,255,240,${r() * 0.15})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
  // bump: embossed blank oval (raised rim, slightly sunken panel), soft from wear; blank border
  const bc = mkCanvas(S, S), bg = bc.getContext('2d');
  bg.fillStyle = 'rgb(128,128,128)'; bg.fillRect(0, 0, S, S);
  bg.save(); bg.translate(S / 2, S / 2); bg.scale(1, 0.62);
  for (let k = 8; k >= 1; k--) { bg.strokeStyle = `rgba(255,255,255,${0.12})`; bg.lineWidth = k * 1.6; bg.beginPath(); bg.arc(0, 0, S * 0.3, 0, TAU); bg.stroke(); }
  bg.fillStyle = 'rgba(100,100,100,0.6)'; bg.beginPath(); bg.arc(0, 0, S * 0.27, 0, TAU); bg.fill();
  bg.restore();
  const bd = bg.getImageData(0, 0, S, S).data, hf = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hf[i] = bd[i * 4] / 255 + (r() - 0.5) * 0.015;
  // roughness: wet glossy patches
  const rf = fbmField(64, 64, 33, 3, 3, 3);
  const rc = upscale(fieldToCanvas(rf, 64, 64, v => { const a = 255 * lerp(0.22, 0.6, smooth(0.35, 0.7, v)); return [a, a, a]; }), S, S);
  TEX.soap = { map: mkTex(col, true, false), normal: mkTex(heightToNormal(hf, S, S, 4.0), false, false), rough: mkTex(rc, false, false) };
  return TEX.soap;
}
function roundRectPath(hx, hz, r, seg) {
  const out = [], C = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]];
  for (const c of C) for (let i = 0; i <= seg; i++) { const a = c[2] + (i / seg) * Math.PI / 2; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
  return out;
}
function sweepGeo(path, prof) {
  const n = path.length, m = prof.length, pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const p = path[i], q = prof[j], k = i * m + j;
    pos[k * 3] = p[0] + p[2] * q[0]; pos[k * 3 + 1] = q[1]; pos[k * 3 + 2] = p[1] + p[3] * q[0];
    uv[k * 2] = i / n; uv[k * 2 + 1] = j / (m - 1);
  }
  for (let i = 0; i < n; i++) { const i2 = (i + 1) % n; for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = i2 * m + j; idx.push(a, a + 1, b, b, a + 1, b + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function createSoap(ctx) {
  const scene = ctx.scene;
  const group = new THREE.Group(); group.name = 'soap';
  const mats = [];
  // dish
  const dishMat = new THREE.MeshPhysicalMaterial({ color: 0xeeede6, roughness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.3, side: THREE.DoubleSide }); mats.push(dishMat);
  const HX = 0.061, HZ = 0.042, CR = 0.02;
  const path = roundRectPath(HX, HZ, CR, 10);
  const dprof = [[-0.0065, 0.0034], [-0.0042, 0.0046], [-0.0024, 0.008], [-0.0012, 0.013], [-0.0002, 0.018], [0.0012, 0.0212], [0.0032, 0.0226], [0.0054, 0.0224], [0.007, 0.0208], [0.0074, 0.018], [0.0062, 0.011], [0.0048, 0.004], [0.004, 0.0012], [0.0028, 0], [-0.004, 0]];
  const dish = new THREE.Mesh(sweepGeo(path, dprof), dishMat); dish.castShadow = true; dish.receiveShadow = true; group.add(dish);
  const fShape = new THREE.Shape(); { const fp = roundRectPath(HX - 0.0062, HZ - 0.0062, CR - 0.0062, 8); fShape.moveTo(fp[0][0], fp[0][1]); for (let i = 1; i < fp.length; i++) fShape.lineTo(fp[i][0], fp[i][1]); }
  const floorGeo = new THREE.ShapeGeometry(fShape); floorGeo.rotateX(Math.PI / 2); floorGeo.translate(0, 0.0034, 0);
  const floor = new THREE.Mesh(floorGeo, dishMat); floor.receiveShadow = true; group.add(floor);
  const bottom = new THREE.Mesh(floorGeo.clone().translate(0, -0.0032, 0), dishMat); group.add(bottom);
  // ribs
  const ribGeo = new THREE.CapsuleGeometry(0.0021, 0.06, 4, 10); ribGeo.rotateX(Math.PI / 2);
  const ribMat = dishMat.clone(); mats.push(ribMat); // instanced: separate material so the dish's program isn't re-derived per draw
  const NRIB = 9, ribs = new THREE.InstancedMesh(ribGeo, ribMat, NRIB); ribs.castShadow = true; ribs.receiveShadow = true;
  { const m = new THREE.Matrix4(); for (let i = 0; i < NRIB; i++) { m.makeTranslation((i - (NRIB - 1) / 2) * 0.0118, 0.0047, 0); ribs.setMatrixAt(i, m); } }
  group.add(ribs);
  // a little soapy water in the dish
  const ft = texFoam();
  const pShape = new THREE.Shape(); { const fp = roundRectPath(HX - 0.0085, HZ - 0.0085, CR - 0.0085, 8); pShape.moveTo(fp[0][0], fp[0][1]); for (let i = 1; i < fp.length; i++) pShape.lineTo(fp[i][0], fp[i][1]); }
  const pGeo = new THREE.ShapeGeometry(pShape); pGeo.rotateX(-Math.PI / 2); pGeo.translate(0, 0.0058, 0);
  { const uv = pGeo.attributes.uv, p = pGeo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 3 + 0.2, p.getZ(i) * 3 + 0.4); }
  const pud = waterMaterial({ color: 0xc8d6c0, opacity: 0.3, roughness: 0.04, env: 1.6, normalMap: texWaterN(), ns: 0.15, alphaMap: ft.alpha, key: 'dishwater' });
  mats.push(pud);
  const puddle = new THREE.Mesh(pGeo, pud); puddle.renderOrder = 2; group.add(puddle);

  // bar
  const st = soapTextures();
  const BW = 0.09, BH = 0.03, BD = 0.055;
  const barGeo = new RoundedBoxGeometry(BW, BH, BD, 6, 0.0095);
  { // worn: pillow top, thinner at one end; planar top UVs (sides pushed into the blank border)
    const p = barGeo.attributes.position, n = barGeo.attributes.normal, uv = barGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let u = x / BW + 0.5, v = 0.5 - z / BD;
      if (n.getY(i) < 0.85) { u = 0.5 + (u - 0.5) * 1.6; v = 0.5 + (v - 0.5) * 1.6; }
      uv.setXY(i, u, v);
      if (y > 0) {
        const bx = 1 - Math.pow(x / (BW / 2), 2), bz = 1 - Math.pow(z / (BD / 2), 2);
        let ny = y + 0.0018 * Math.max(0, bx) * Math.max(0, bz);
        ny -= 0.0022 * (x / BW + 0.5) * (y / (BH / 2));
        p.setY(i, ny);
      }
    }
    barGeo.computeVertexNormals();
  }
  const soapMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: st.map, normalMap: st.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, roughnessMap: st.rough,
    clearcoat: 0.55, clearcoatRoughness: 0.22, emissive: 0x16301a, emissiveIntensity: 0.6, sheen: 0.25, sheenColor: new THREE.Color(0xd9f2cf),
  });
  mats.push(soapMat);
  const bar = new THREE.Mesh(barGeo, soapMat); bar.castShadow = true; bar.receiveShadow = true;
  bar.position.set(0.001, 0.0068 + BH / 2, 0.001); bar.rotation.y = 0.06; group.add(bar);
  const api = { group, bar, update: () => envSync(scene, mats) };
  api.update(0);
  return api;
}
