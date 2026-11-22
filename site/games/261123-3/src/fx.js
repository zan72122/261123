// FX / particles: water drops, wet patches, ripple rings, soap foam, free bubbles, dust, sand, sparkles.
// All pools are fixed-capacity InstancedMeshes (8 draw calls), zero allocations per frame,
// oldest-first recycling. World space (group stays at identity).
import * as THREE from 'three';
import { SUN_DIR } from './lightrig.js';

const PI = Math.PI;
const EMPTY = {};
const rnd = Math.random;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------- temps (never allocate per frame) ----------
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_Q = new THREE.Quaternion();

// random unit vector in a cone of half-angle `half` around unit `axis` -> out
function coneDir(out, axis, half) {
  const ct = 1 - rnd() * (1 - Math.cos(half));
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const ph = rnd() * 2 * PI;
  if (Math.abs(axis.y) < 0.9) _u.set(0, 1, 0); else _u.set(1, 0, 0);
  _u.cross(axis).normalize();
  _w.copy(axis).cross(_u);
  return out.copy(axis).multiplyScalar(ct).addScaledVector(_u, st * Math.cos(ph)).addScaledVector(_w, st * Math.sin(ph));
}

// ---------- pool: oldest-first allocation ----------
function makePool(cap) {
  return { cap, eff: cap, ptr: 0, stamp: 0, alive: new Uint8Array(cap), birth: new Float64Array(cap) };
}
function alloc(pl) {
  let oldest = -1, ob = Infinity;
  for (let k = 0; k < pl.eff; k++) {
    const i = (pl.ptr + k) % pl.eff;
    if (!pl.alive[i]) { pl.ptr = (i + 1) % pl.eff; pl.alive[i] = 1; pl.birth[i] = ++pl.stamp; return i; }
    if (pl.birth[i] < ob) { ob = pl.birth[i]; oldest = i; }
  }
  pl.alive[oldest] = 1; pl.birth[oldest] = ++pl.stamp; pl.ptr = (oldest + 1) % pl.eff;
  return oldest;
}
function setEff(pl, eff) { pl.eff = Math.max(1, Math.min(pl.cap, eff)); for (let i = pl.eff; i < pl.cap; i++) pl.alive[i] = 0; pl.ptr = 0; }

// ---------- procedural canvas textures ----------
function canvasTex(size, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
function softBlob(g, x, y, r, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
}
// 2x2 atlas of soft noisy dust puffs. rgb = shading noise, a = density
function makeDustTex() {
  return canvasTex(256, (g, S) => {
    const C = S / 2;
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * C, oy = (cell >> 1) * C, cx = ox + C / 2, cy = oy + C / 2;
      g.save(); g.beginPath(); g.rect(ox, oy, C, C); g.clip();
      for (let k = 0; k < 46; k++) {
        const ang = rnd() * 2 * PI, d = Math.pow(rnd(), 0.8) * C * 0.27;
        const r = C * (0.07 + rnd() * 0.17) * (1 - d / (C * 0.45));
        softBlob(g, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, r, 0.10 + rnd() * 0.12);
      }
      g.restore();
    }
    const im = g.getImageData(0, 0, S, S), d = im.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, lx = (x % C) / C - 0.5, ly = (y % C) / C - 0.5;
      const edge = clamp01((0.5 - Math.sqrt(lx * lx + ly * ly)) / 0.12);
      let a = d[i + 3] / 255; a = Math.min(1, a * 1.15) * edge;
      const n = 200 + rnd() * 55;
      d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(im, 0, 0);
  });
}
// 2x2 atlas of irregular wet-stain height fields (a: 1 center -> 0 irregular edge)
function makeWetTex() {
  return canvasTex(256, (g, S) => {
    const C = S / 2;
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * C, oy = (cell >> 1) * C, cx = ox + C / 2, cy = oy + C / 2;
      g.save(); g.beginPath(); g.rect(ox, oy, C, C); g.clip();
      softBlob(g, cx, cy, C * 0.36, 0.9);
      for (let k = 0; k < 16; k++) {
        const ang = rnd() * 2 * PI, dd = rnd() * C * 0.22;
        softBlob(g, cx + Math.cos(ang) * dd, cy + Math.sin(ang) * dd, C * (0.08 + rnd() * 0.12), 0.35 + rnd() * 0.3);
      }
      for (let k = 0; k < 6; k++) { // small satellite splats
        const ang = rnd() * 2 * PI, dd = C * (0.3 + rnd() * 0.1);
        softBlob(g, cx + Math.cos(ang) * dd, cy + Math.sin(ang) * dd, C * (0.02 + rnd() * 0.03), 0.8);
      }
      g.restore();
    }
    const im = g.getImageData(0, 0, S, S), d = im.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, lx = (x % C) / C - 0.5, ly = (y % C) / C - 0.5;
      const edge = clamp01((0.49 - Math.sqrt(lx * lx + ly * ly)) / 0.06);
      const h = Math.min(1, (d[i] / 255) * 1.25) * edge * (0.93 + rnd() * 0.07);
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(h * 255);
    }
    g.putImageData(im, 0, 0);
  });
}

// ---------- geometry helpers ----------
function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += g.attributes.position.count; io += ia.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// A clump of tiny soap bubbles, ~1 unit across, vertex-colour AO in the crevices.
function makeFoamClumpGeo() {
  const S = [ // x, y, z, r, segW, segH
    [0, 0.02, 0, 0.30, 10, 7], [0.30, -0.02, 0.10, 0.21, 9, 6], [-0.26, -0.03, 0.14, 0.19, 9, 6],
    [0.06, -0.04, -0.29, 0.20, 9, 6], [-0.17, 0.12, -0.18, 0.13, 7, 5], [0.20, 0.17, -0.12, 0.11, 7, 5],
    [0.04, 0.05, 0.31, 0.12, 7, 5], [-0.38, 0.06, -0.08, 0.09, 6, 4], [0.40, 0.08, -0.16, 0.08, 6, 4],
    [-0.08, 0.30, 0.10, 0.08, 6, 4],
  ];
  const parts = [];
  for (const [x, y, z, r, sw, sh] of S) {
    const g = new THREE.SphereGeometry(r, sw, sh);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i) + x, vy = p.getY(i) + y, vz = p.getZ(i) + z;
      let occ = 0;
      for (const [x2, y2, z2, r2] of S) {
        if (x2 === x && y2 === y && z2 === z) continue;
        const dd = Math.hypot(vx - x2, vy - y2, vz - z2) - r2;
        occ += clamp01(1 - dd / 0.12) * 0.35;
      }
      const ny = p.getY(i) / r;
      const ao = Math.max(0.5, 1 - occ) * (0.84 + 0.16 * (ny * 0.5 + 0.5));
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = ao;
      p.setXYZ(i, vx, vy, vz);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  }
  const m = mergeGeos(parts); parts.forEach((g) => g.dispose());
  return m;
}

// standard billboard / flat-quad instanced shader pieces (aP: 4 params, aC: colour)
const BB_VERT = `
attribute vec4 aP; attribute vec3 aC;
varying vec4 vP; varying vec3 vC; varying vec2 vUv; varying vec2 vQ; varying vec2 vSun;
uniform vec3 uSun;
void main(){
  vUv = uv; vP = aP; vC = aC;
  vec4 c = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
  float s = length(instanceMatrix[0].xyz);
  float cr = cos(aP.y), sr = sin(aP.y);
  vec2 o = vec2(position.x*cr - position.y*sr, position.x*sr + position.y*cr);
  vQ = o * 2.0;
  vSun = normalize((viewMatrix * vec4(uSun, 0.0)).xy + vec2(1e-4));
  vec4 mv = viewMatrix * c;
  mv.xy += o * s;
  mv.z += s * 0.35; // pull toward camera a little: fewer hard intersections with the ground
  gl_Position = projectionMatrix * mv;
}`;
const FLAT_VERT = `
attribute vec4 aP; attribute vec3 aC;
varying vec4 vP; varying vec3 vC; varying vec2 vUv;
void main(){ vUv = uv; vP = aP; vC = aC;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;

function instanced(geo, mat, cap, withParams) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.count = 0;
  if (withParams) {
    const aP = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aP.setUsage(THREE.DynamicDrawUsage);
    const aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); aC.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', aP); geo.setAttribute('aC', aC);
  }
  return mesh;
}
function flatQuad() { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return g; }

export function createFx(ctx) {
  const group = new THREE.Group();
  group.name = 'fx';
  let low = !!(ctx && ctx.quality && ctx.quality.low);
  let emit = low ? 0.5 : 1;
  let time = 0;
  const sunU = { value: SUN_DIR.clone() };
  const timeU = { value: 0 };

  // =====================================================================================
  // WATER DROPLETS (splash / spray / drip / micro pop droplets)
  // =====================================================================================
  const DROP_CAP = 420;
  const dPool = makePool(DROP_CAP);
  const dPos = new Float32Array(DROP_CAP * 3), dVel = new Float32Array(DROP_CAP * 3);
  const dR = new Float32Array(DROP_CAP), dLife = new Float32Array(DROP_CAP), dFloor = new Float32Array(DROP_CAP);
  const dOp = new Float32Array(DROP_CAP), dCol = new Float32Array(DROP_CAP * 3), dDot = new Uint8Array(DROP_CAP);
  const dLand = new Array(DROP_CAP).fill(null);
  const dropGeo = new THREE.SphereGeometry(1, 10, 7);
  const aOp = new THREE.InstancedBufferAttribute(new Float32Array(DROP_CAP), 1); aOp.setUsage(THREE.DynamicDrawUsage);
  dropGeo.setAttribute('aOp', aOp);
  const dropMat = new THREE.MeshStandardMaterial({ color: 0x8c979e, roughness: 0.2, metalness: 0, transparent: true, depthWrite: false, premultipliedAlpha: true, envMapIntensity: 1.2 });
  dropMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOp; varying float vOp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOp;')
      .replace('#include <opaque_fragment>', `
        // water bead: see-through core, dark refractive rim, sharp sun glint + sky reflection
        float frn = 1.0 - saturate(dot(normal, geometryViewDir));
        float rim = smoothstep(0.45, 0.95, frn);
        float aa = clamp(vOp + (1.0 - vOp) * rim * 0.75, 0.0, 1.0);
        vec3 body = totalDiffuse * mix(0.9, 0.3, rim * (1.0 - vOp));
        vec3 spc = reflectedLight.directSpecular * 2.0 + reflectedLight.indirectSpecular * 0.55;
        gl_FragColor = vec4(body * aa + spc, min(1.0, aa + dot(spc, vec3(0.3))));`)
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, DROP_CAP);
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.setColorAt(0, _c.set(0xffffff)); drops.instanceColor.setUsage(THREE.DynamicDrawUsage);
  drops.frustumCulled = false; drops.count = 0; drops.renderOrder = 3; drops.name = 'fx-drops';
  group.add(drops);

  function spawnDrop(x, y, z, vx, vy, vz, r, color, floorY, life, dot) {
    const i = alloc(dPool);
    dPos[i * 3] = x; dPos[i * 3 + 1] = y; dPos[i * 3 + 2] = z;
    dVel[i * 3] = vx; dVel[i * 3 + 1] = vy; dVel[i * 3 + 2] = vz;
    dR[i] = r; dLife[i] = life; dFloor[i] = floorY; dDot[i] = dot ? 1 : 0; dLand[i] = null;
    _c.set(color == null ? 0xffffff : color);
    dCol[i * 3] = _c.r; dCol[i * 3 + 1] = _c.g; dCol[i * 3 + 2] = _c.b;
    const lum = 0.3 * _c.r + 0.6 * _c.g + 0.1 * _c.b;
    dOp[i] = 0.1 + 0.5 * clamp01(1 - lum * 2.5); // dirty water: less transparent
    return i;
  }
  const dropRadius = (size) => (0.002 + 0.0025 * rnd() * rnd()) * size;

  function splash(pos, opts) {
    const o = opts || EMPTY;
    const n = Math.max(1, Math.round((o.count == null ? 14 : o.count) * emit));
    const speed = o.speed == null ? 1.6 : o.speed, spread = o.spread == null ? 0.6 : o.spread;
    const size = o.size == null ? 1 : o.size, floorY = o.floorY == null ? 0 : o.floorY;
    if (o.dir) _a.copy(o.dir).normalize(); else _a.copy(UP);
    if (!(_a.lengthSq() > 0)) _a.copy(UP);
    const half = Math.max(0.04, spread * PI * 0.5);
    for (let k = 0; k < n; k++) {
      coneDir(_v, _a, half);
      const sp = speed * (0.4 + 0.7 * rnd());
      spawnDrop(pos.x + (rnd() - 0.5) * 0.012, pos.y + rnd() * 0.004, pos.z + (rnd() - 0.5) * 0.012,
        _v.x * sp, _v.y * sp, _v.z * sp, dropRadius(size), o.color, floorY, 4, true);
    }
  }
  function spray(pos, dir, opts) {
    const o = opts || EMPTY;
    let n = (o.count == null ? 2 : o.count) * emit;
    n = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
    const speed = o.speed == null ? 2 : o.speed, spread = o.spread == null ? 0.25 : o.spread;
    const size = o.size == null ? 1 : o.size, floorY = o.floorY == null ? 0 : o.floorY;
    if (dir) _a.copy(dir).normalize(); else _a.copy(UP);
    if (!(_a.lengthSq() > 0)) _a.copy(UP);
    const half = Math.max(0.01, spread * PI * 0.5);
    for (let k = 0; k < n; k++) {
      coneDir(_v, _a, half);
      const sp = speed * (0.75 + 0.4 * rnd());
      spawnDrop(pos.x, pos.y, pos.z, _v.x * sp, _v.y * sp, _v.z * sp, dropRadius(size), o.color, floorY, 4, true);
    }
  }
  function drip(pos, opts) {
    const o = opts || EMPTY;
    const size = o.size == null ? 1 : o.size;
    const i = spawnDrop(pos.x, pos.y, pos.z, 0, -0.05, 0, (0.0033 + 0.0008 * rnd()) * size, o.color,
      o.floorY == null ? 0 : o.floorY, 6, true);
    dLand[i] = typeof o.onLand === 'function' ? o.onLand : null;
  }

  // =====================================================================================
  // RINGS (ripples on water + tiny landing spots)
  // =====================================================================================
  const RING_CAP = 80;
  const rPool = makePool(RING_CAP);
  const rPos = new Float32Array(RING_CAP * 3), rSize = new Float32Array(RING_CAP), rAge = new Float32Array(RING_CAP);
  const rLife = new Float32Array(RING_CAP), rFill = new Float32Array(RING_CAP), rCol = new Float32Array(RING_CAP * 3);
  const rAlpha = new Float32Array(RING_CAP), rRot = new Float32Array(RING_CAP);
  const ringMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: FLAT_VERT,
    fragmentShader: `varying vec4 vP; varying vec3 vC; varying vec2 vUv;
      void main(){ vec2 q = vUv*2.0-1.0; float r = length(q);
        float wob = 1.0 + 0.04*sin(atan(q.y,q.x)*5.0 + vP.y*6.0);
        float rr = r*wob;
        float ring = exp(-pow((rr-0.78)/max(vP.z,0.015), 2.0));
        float inner = exp(-pow((rr-0.55)/max(vP.z*1.6,0.02), 2.0))*0.35;
        float fill = vP.w * (1.0 - smoothstep(0.0, 0.8, rr));
        if (vP.w > 0.0) { ring *= 0.25; inner = 0.0; }
        float a = (ring + inner + fill) * vP.x * (1.0 - smoothstep(0.92, 1.0, r));
        gl_FragColor = vec4(vC, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const rings = instanced(flatQuad(), ringMat, RING_CAP, true);
  rings.renderOrder = 2; rings.name = 'fx-rings'; group.add(rings);
  function spawnRing(x, y, z, size, life, fill, color, alpha) {
    const i = alloc(rPool);
    rPos[i * 3] = x; rPos[i * 3 + 1] = y; rPos[i * 3 + 2] = z;
    rSize[i] = size; rAge[i] = 0; rLife[i] = life; rFill[i] = fill; rAlpha[i] = alpha; rRot[i] = rnd() * 2 * PI;
    _c.set(color == null ? 0xe6eef5 : color);
    rCol[i * 3] = _c.r; rCol[i * 3 + 1] = _c.g; rCol[i * 3 + 2] = _c.b;
  }
  function ring(pos, size, opts) {
    const o = opts || EMPTY;
    spawnRing(pos.x, pos.y + 0.0008, pos.z, size == null ? 0.06 : size, o.life == null ? 0.9 : o.life, 0, o.color, 0.6);
  }

  // =====================================================================================
  // WET PATCHES (multiplicative darkening decals)
  // =====================================================================================
  const WET_CAP = 28;
  const wPool = makePool(WET_CAP);
  const wPos = new Float32Array(WET_CAP * 3), wR = new Float32Array(WET_CAP), wAge = new Float32Array(WET_CAP);
  const wLife = new Float32Array(WET_CAP), wGrow = new Float32Array(WET_CAP), wDark = new Float32Array(WET_CAP);
  const wRot = new Float32Array(WET_CAP), wVar = new Float32Array(WET_CAP);
  const wetMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    uniforms: { map: { value: makeWetTex() } },
    vertexShader: FLAT_VERT,
    fragmentShader: `uniform sampler2D map; varying vec4 vP; varying vec3 vC; varying vec2 vUv;
      void main(){ float vz = floor(vP.z + 0.5); vec2 cell = vec2(mod(vz, 2.0), floor(vz * 0.5 + 0.25));
        float h = texture2D(map, (vUv + cell) * 0.5).a;
        float t = vP.y * 0.8;                       // drying: threshold rises, patch shrinks irregularly
        float m = smoothstep(t, t + 0.28, h) * vP.x;
        vec3 k = vec3(1.0) - m * vP.w * vec3(1.0, 1.02, 1.06);
        gl_FragColor = vec4(k, 1.0); }`,
  });
  const wets = instanced(flatQuad(), wetMat, WET_CAP, true);
  wets.renderOrder = 1; wets.name = 'fx-wet'; group.add(wets);
  function wetPatch(pos, radius, opts) {
    const o = opts || EMPTY;
    const r = radius == null ? 0.05 : radius;
    const life = o.life == null ? 30 : o.life, dark = o.dark == null ? 0.45 : o.dark;
    // merge into an existing patch whose centre is close
    for (let i = 0; i < wPool.eff; i++) {
      if (!wPool.alive[i]) continue;
      const dx = wPos[i * 3] - pos.x, dz = wPos[i * 3 + 2] - pos.z, d = Math.sqrt(dx * dx + dz * dz);
      const cur = wR[i] + wGrow[i] * Math.min(wAge[i], 1);
      if (Math.abs(wPos[i * 3 + 1] - pos.y) < 0.02 && d < cur * 0.45 && r < cur * 1.6) {
        wR[i] = Math.max(cur, d + r * 0.8); wGrow[i] = o.grow || 0; wAge[i] = 0;
        wLife[i] = Math.max(life, wLife[i] - wAge[i]); wDark[i] = Math.max(wDark[i], dark);
        return;
      }
    }
    const i = alloc(wPool);
    wPos[i * 3] = pos.x; wPos[i * 3 + 1] = pos.y + 0.001; wPos[i * 3 + 2] = pos.z;
    wR[i] = r; wAge[i] = 0; wLife[i] = Math.max(0.1, life); wGrow[i] = o.grow || 0; wDark[i] = dark;
    wRot[i] = rnd() * 2 * PI; wVar[i] = Math.floor(rnd() * 4);
  }

  // =====================================================================================
  // FOAM (persistent lather clumps attached to parents)
  // =====================================================================================
  const FOAM_CAP = 320, FOAM_STORE = 384;
  let foamEff = low ? 160 : FOAM_CAP;
  const fState = new Uint8Array(FOAM_STORE); // 0 free, 1 live, 2 dying
  const fPar = new Array(FOAM_STORE).fill(null);
  const fLoc = new Float32Array(FOAM_STORE * 3), fQ = new Float32Array(FOAM_STORE * 4);
  const fScale = new Float32Array(FOAM_STORE), fAge = new Float32Array(FOAM_STORE), fDie = new Float32Array(FOAM_STORE);
  const fBirth = new Float64Array(FOAM_STORE), fWorld = new Float32Array(FOAM_STORE * 3), fTone = new Float32Array(FOAM_STORE);
  let fStamp = 0, fLive = 0, fPtr = 0;
  const foamGeo = makeFoamClumpGeo();
  const foamMat = new THREE.MeshStandardMaterial({
    color: 0xf2f0ea, roughness: 0.16, metalness: 0, vertexColors: true,
    emissive: 0x6a6965, envMapIntensity: 1.25,
  });
  const foamMesh = new THREE.InstancedMesh(foamGeo, foamMat, FOAM_STORE);
  foamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  foamMesh.setColorAt(0, _c.set(0xffffff)); foamMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  foamMesh.frustumCulled = false; foamMesh.count = 0; foamMesh.receiveShadow = true; foamMesh.castShadow = false;
  foamMesh.name = 'fx-foam'; group.add(foamMesh);
  const uniqPar = [];

  function foamKill(i, fast) { if (fState[i] === 1) { fState[i] = 2; fDie[i] = 0; fLive--; if (fast) fDie[i] = 0.2; } }
  function foamAdd(parent, localPos, size) {
    const s = size == null ? 1 : size;
    if (fLive >= foamEff) { // oldest quietly shrinks away
      let o = -1, ob = Infinity;
      for (let i = 0; i < FOAM_STORE; i++) if (fState[i] === 1 && fBirth[i] < ob) { ob = fBirth[i]; o = i; }
      if (o >= 0) foamKill(o);
    }
    let slot = -1;
    for (let k = 0; k < FOAM_STORE; k++) { const i = (fPtr + k) % FOAM_STORE; if (fState[i] === 0) { slot = i; break; } }
    if (slot < 0) { // all storage used by dying blobs: reuse the most-shrunk one
      let best = -1, bd = -1;
      for (let i = 0; i < FOAM_STORE; i++) if (fState[i] === 2 && fDie[i] > bd) { bd = fDie[i]; best = i; }
      slot = best < 0 ? 0 : best;
      if (fState[slot] === 1) fLive--;
    }
    fPtr = (slot + 1) % FOAM_STORE;
    fState[slot] = 1; fLive++;
    fPar[slot] = parent || null;
    fLoc[slot * 3] = localPos ? localPos.x : 0; fLoc[slot * 3 + 1] = localPos ? localPos.y : 0; fLoc[slot * 3 + 2] = localPos ? localPos.z : 0;
    _e.set(rnd() * 2 * PI, rnd() * 2 * PI, rnd() * 2 * PI); _q.setFromEuler(_e);
    fQ[slot * 4] = _q.x; fQ[slot * 4 + 1] = _q.y; fQ[slot * 4 + 2] = _q.z; fQ[slot * 4 + 3] = _q.w;
    fScale[slot] = (0.0065 + 0.0075 * rnd()) * s;
    fAge[slot] = 0; fDie[slot] = 0; fBirth[slot] = ++fStamp; fTone[slot] = 0.9 + 0.1 * rnd();
    // provisional world position (for washNear before first update)
    if (parent && parent.matrixWorld) { _p.set(fLoc[slot * 3], fLoc[slot * 3 + 1], fLoc[slot * 3 + 2]).applyMatrix4(parent.matrixWorld); }
    else _p.set(fLoc[slot * 3], fLoc[slot * 3 + 1], fLoc[slot * 3 + 2]);
    fWorld[slot * 3] = _p.x; fWorld[slot * 3 + 1] = _p.y; fWorld[slot * 3 + 2] = _p.z;
  }
  const foam = {
    add: foamAdd,
    count: () => fLive,
    countOn(parent) { let n = 0; for (let i = 0; i < FOAM_STORE; i++) if (fState[i] === 1 && fPar[i] === (parent || null)) n++; return n; },
    removeFraction(f, parent) {
      const p = clamp01(f || 0);
      for (let i = 0; i < FOAM_STORE; i++) if (fState[i] === 1 && (parent == null || fPar[i] === parent) && rnd() < p) foamKill(i);
    },
    washNear(wp, radius, amount) {
      if (!wp) return;
      const r = radius == null ? 0.05 : radius, a = amount == null ? 1 : amount, r2 = r * r;
      for (let i = 0; i < FOAM_STORE; i++) {
        if (fState[i] !== 1) continue;
        const dx = fWorld[i * 3] - wp.x, dy = fWorld[i * 3 + 1] - wp.y, dz = fWorld[i * 3 + 2] - wp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2 && rnd() < a * (1 - 0.5 * d2 / r2)) foamKill(i);
      }
    },
    clear() { for (let i = 0; i < FOAM_STORE; i++) { fState[i] = 0; fPar[i] = null; } fLive = 0; foamMesh.count = 0; },
  };

  // =====================================================================================
  // FREE SOAP BUBBLES
  // =====================================================================================
  const BUB_CAP = 40;
  const bPool = makePool(BUB_CAP);
  const bPos = new Float32Array(BUB_CAP * 3), bVel = new Float32Array(BUB_CAP * 3), bR = new Float32Array(BUB_CAP);
  const bAge = new Float32Array(BUB_CAP), bLife = new Float32Array(BUB_CAP), bPh = new Float32Array(BUB_CAP);
  const bubMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: true,
    uniforms: { uSun: sunU, uTime: timeU },
    vertexShader: BB_VERT,
    fragmentShader: `uniform float uTime; varying vec4 vP; varying vec3 vC; varying vec2 vUv; varying vec2 vQ; varying vec2 vSun;
      void main(){ vec2 q = vQ; float r = length(q); if (r > 1.0) discard;
        float nz = sqrt(max(0.0, 1.0 - r*r));
        float fr = pow(1.0 - nz, 2.6);
        float th = vP.z*6.2832 + q.y*2.6 + q.x*1.3 + uTime*0.7 + r*2.4 + sin(q.x*5.0+uTime)*0.4;
        vec3 irid = 0.5 + 0.5*cos(th + vec3(0.0, 2.1, 4.2));
        vec3 sky = mix(vec3(0.62,0.60,0.56), vec3(0.80,0.88,1.0), smoothstep(-0.5, 0.3, q.y));
        vec3 col = sky * mix(vec3(1.0), irid*1.35, 0.7);
        float a = fr*0.75 + 0.035;
        a *= 1.0 - smoothstep(0.93, 1.0, r);
        vec2 h1 = q - vSun*0.52; float s1 = exp(-dot(h1,h1)*70.0);
        vec2 h2 = q + vSun*0.6;  float s2 = exp(-dot(h2,h2)*180.0)*0.4;
        vec2 h3 = q - vSun*0.36 - vec2(-vSun.y, vSun.x)*0.18; float s3 = exp(-dot(h3,h3)*260.0)*0.5;
        float sp = s1 + s2 + s3;
        col += vec3(1.0,0.97,0.9) * sp * 2.2;
        a = max(a, min(sp, 1.0));
        gl_FragColor = vec4(col, a * vP.x);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const bubs = instanced(new THREE.PlaneGeometry(1, 1), bubMat, BUB_CAP, true);
  bubs.renderOrder = 5; bubs.name = 'fx-bubbles'; group.add(bubs);
  let bubLive = 0;
  function bubble(pos, opts) {
    const o = opts || EMPTY;
    const i = alloc(bPool);
    bPos[i * 3] = pos.x; bPos[i * 3 + 1] = pos.y; bPos[i * 3 + 2] = pos.z;
    if (o.vel) { bVel[i * 3] = o.vel.x; bVel[i * 3 + 1] = o.vel.y; bVel[i * 3 + 2] = o.vel.z; }
    else { bVel[i * 3] = (rnd() - 0.5) * 0.06; bVel[i * 3 + 1] = 0.05 + rnd() * 0.05; bVel[i * 3 + 2] = (rnd() - 0.5) * 0.06; }
    bR[i] = (0.006 + 0.014 * rnd() * rnd()) * (o.size == null ? 1 : o.size);
    bAge[i] = 0; bLife[i] = (o.life == null ? 6 : o.life) * (0.8 + 0.4 * rnd()); bPh[i] = rnd();
  }
  function popBurst(i) {
    const x = bPos[i * 3], y = bPos[i * 3 + 1], z = bPos[i * 3 + 2], r = bR[i];
    const n = low ? 4 : 8;
    for (let k = 0; k < n; k++) {
      coneDir(_v, UP, PI);
      const sp = 0.25 + rnd() * 0.45;
      spawnDrop(x + _v.x * r, y + _v.y * r, z + _v.z * r, _v.x * sp, _v.y * sp, _v.z * sp, 0.0007 + 0.0006 * rnd(), 0xffffff, -10, 0.25 + rnd() * 0.2, false);
    }
    spawnSparkle(x + r * 0.3, y + r * 0.3, z, r * 2.2, 0.25);
    bPool.alive[i] = 0;
  }
  function popBubbleAt(ndc, radiusPx, camera, viewportH) {
    if (!ndc || !camera) return null;
    const H = viewportH || 800, W = H * (camera.aspect || 1), R = radiusPx == null ? 40 : radiusPx;
    let best = -1, bd = Infinity;
    for (let i = 0; i < bPool.eff; i++) {
      if (!bPool.alive[i]) continue;
      _p.set(bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]).project(camera);
      if (_p.z > 1 || _p.z < -1) continue;
      const dx = (_p.x - ndc.x) * 0.5 * W, dy = (_p.y - ndc.y) * 0.5 * H, d = Math.sqrt(dx * dx + dy * dy);
      if (d < R && d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const out = new THREE.Vector3(bPos[best * 3], bPos[best * 3 + 1], bPos[best * 3 + 2]);
    popBurst(best);
    return out;
  }

  // =====================================================================================
  // DUST PUFFS
  // =====================================================================================
  const DUST_CAP = 120;
  const uPool = makePool(DUST_CAP);
  const uPos = new Float32Array(DUST_CAP * 3), uVel = new Float32Array(DUST_CAP * 3), uR0 = new Float32Array(DUST_CAP);
  const uAge = new Float32Array(DUST_CAP), uLife = new Float32Array(DUST_CAP), uRot = new Float32Array(DUST_CAP);
  const uSpin = new Float32Array(DUST_CAP), uVar = new Float32Array(DUST_CAP), uCol = new Float32Array(DUST_CAP * 3), uA = new Float32Array(DUST_CAP);
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: true,
    uniforms: { uSun: sunU, map: { value: makeDustTex() }, uLight: { value: new THREE.Vector3(1.75, 1.7, 1.62) } },
    vertexShader: BB_VERT,
    fragmentShader: `uniform sampler2D map; uniform vec3 uLight; varying vec4 vP; varying vec3 vC; varying vec2 vUv; varying vec2 vQ; varying vec2 vSun;
      void main(){ float vz = floor(vP.z + 0.5); vec2 cell = vec2(mod(vz, 2.0), floor(vz * 0.5 + 0.25));
        vec4 tx = texture2D(map, (vUv + cell) * 0.5);
        float lit = 0.72 + 0.4 * clamp(dot(vQ, vSun) * 0.7 + 0.45, 0.0, 1.0);
        vec3 col = vC * uLight * lit * (0.92 + 0.4 * (tx.r - 0.9));
        gl_FragColor = vec4(col, tx.a * vP.x);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dusts = instanced(new THREE.PlaneGeometry(1, 1), dustMat, DUST_CAP, true);
  dusts.renderOrder = 4; dusts.name = 'fx-dust'; group.add(dusts);
  function dust(pos, opts) {
    const o = opts || EMPTY;
    const n = Math.max(1, Math.round((o.count == null ? 6 : o.count) * emit));
    const size = o.size == null ? 1 : o.size, speed = o.speed == null ? 0.35 : o.speed, life = o.life == null ? 1.2 : o.life;
    _c.set(o.color == null ? 0x8a7f72 : o.color);
    for (let k = 0; k < n; k++) {
      const i = alloc(uPool);
      coneDir(_v, UP, PI * 0.45);
      const sp = speed * (0.3 + 0.7 * rnd());
      const r0 = 0.04 * size * (0.6 + 0.6 * rnd());
      uPos[i * 3] = pos.x + (rnd() - 0.5) * 0.03 * size; uPos[i * 3 + 1] = Math.max(pos.y, 0) + r0 * 0.4; uPos[i * 3 + 2] = pos.z + (rnd() - 0.5) * 0.03 * size;
      uVel[i * 3] = _v.x * sp; uVel[i * 3 + 1] = _v.y * sp * 0.5 + 0.03; uVel[i * 3 + 2] = _v.z * sp;
      uR0[i] = r0; uAge[i] = 0; uLife[i] = life * (0.7 + 0.6 * rnd()); uRot[i] = rnd() * 2 * PI; uSpin[i] = (rnd() - 0.5) * 0.8;
      uVar[i] = Math.floor(rnd() * 4); uA[i] = 0.6 + 0.3 * rnd();
      const t = 0.92 + 0.16 * rnd();
      uCol[i * 3] = _c.r * t; uCol[i * 3 + 1] = _c.g * t; uCol[i * 3 + 2] = _c.b * t;
    }
  }

  // =====================================================================================
  // SAND GRAINS
  // =====================================================================================
  const SAND_CAP = 360;
  const sPool = makePool(SAND_CAP);
  const sPos = new Float32Array(SAND_CAP * 3), sVel = new Float32Array(SAND_CAP * 3), sR = new Float32Array(SAND_CAP);
  const sFloor = new Float32Array(SAND_CAP), sRest = new Float32Array(SAND_CAP), sBounce = new Uint8Array(SAND_CAP);
  const sQ = new Float32Array(SAND_CAP * 4), sCol = new Float32Array(SAND_CAP * 3);
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true });
  const sandMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), sandMat, SAND_CAP);
  sandMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sandMesh.setColorAt(0, _c.set(0xffffff)); sandMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  sandMesh.frustumCulled = false; sandMesh.count = 0; sandMesh.name = 'fx-sand'; group.add(sandMesh);
  const SAND_COLS = [0xb8a588, 0x9c8c74, 0xcdbd9e, 0x857868, 0xaea492, 0xc2ad8a, 0x6e645a];
  function sand(pos, dir, opts) {
    const o = opts || EMPTY;
    const n = Math.max(1, Math.round((o.count == null ? 30 : o.count) * emit));
    const speed = o.speed == null ? 0.8 : o.speed, spread = o.spread == null ? 0.5 : o.spread, floorY = o.floorY == null ? 0 : o.floorY;
    if (dir) _a.copy(dir).normalize(); else _a.copy(UP);
    if (!(_a.lengthSq() > 0)) _a.copy(UP);
    for (let k = 0; k < n; k++) {
      const i = alloc(sPool);
      coneDir(_v, _a, Math.max(0.02, spread * PI * 0.5));
      const sp = speed * (0.3 + 0.8 * rnd());
      sPos[i * 3] = pos.x + (rnd() - 0.5) * 0.01; sPos[i * 3 + 1] = pos.y; sPos[i * 3 + 2] = pos.z + (rnd() - 0.5) * 0.01;
      sVel[i * 3] = _v.x * sp; sVel[i * 3 + 1] = _v.y * sp; sVel[i * 3 + 2] = _v.z * sp;
      sR[i] = 0.0006 + 0.0011 * rnd() * rnd(); sFloor[i] = floorY; sRest[i] = -1; sBounce[i] = 0;
      _e.set(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3); _q.setFromEuler(_e);
      sQ[i * 4] = _q.x; sQ[i * 4 + 1] = _q.y; sQ[i * 4 + 2] = _q.z; sQ[i * 4 + 3] = _q.w;
      _c.set(SAND_COLS[(rnd() * SAND_COLS.length) | 0]);
      sCol[i * 3] = _c.r; sCol[i * 3 + 1] = _c.g; sCol[i * 3 + 2] = _c.b;
    }
  }

  // =====================================================================================
  // SPARKLES (additive 4-point sun glints)
  // =====================================================================================
  const SPK_CAP = 48;
  const kPool = makePool(SPK_CAP);
  const kPos = new Float32Array(SPK_CAP * 3), kS = new Float32Array(SPK_CAP), kAge = new Float32Array(SPK_CAP);
  const kLife = new Float32Array(SPK_CAP), kRot = new Float32Array(SPK_CAP);
  const spkMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
    uniforms: { uSun: sunU },
    vertexShader: BB_VERT,
    fragmentShader: `varying vec4 vP; varying vec3 vC; varying vec2 vUv; varying vec2 vQ; varying vec2 vSun;
      void main(){ vec2 q = vUv*2.0-1.0; float r2 = dot(q,q); float r = sqrt(r2);
        float core = exp(-r2*90.0)*1.6 + exp(-r2*14.0)*0.22;
        float rays = exp(-abs(q.x)*55.0)*exp(-q.y*q.y*2.5) + exp(-abs(q.y)*55.0)*exp(-q.x*q.x*2.5);
        vec2 d = vec2(q.x+q.y, q.x-q.y)*0.7071;
        float rays2 = (exp(-abs(d.x)*80.0)*exp(-d.y*d.y*9.0) + exp(-abs(d.y)*80.0)*exp(-d.x*d.x*9.0))*0.35;
        float I = (core + (rays + rays2) * (1.0 - smoothstep(0.5, 1.0, r))) * vP.x;
        vec3 col = vec3(1.0, 0.96, 0.86) * I;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const spks = instanced(new THREE.PlaneGeometry(1, 1), spkMat, SPK_CAP, true);
  spks.renderOrder = 6; spks.name = 'fx-sparkle'; group.add(spks);
  function spawnSparkle(x, y, z, s, life) {
    const i = alloc(kPool);
    kPos[i * 3] = x; kPos[i * 3 + 1] = y; kPos[i * 3 + 2] = z;
    kS[i] = s; kAge[i] = 0; kLife[i] = life; kRot[i] = (rnd() - 0.5) * 0.5;
  }
  function sparkle(pos, opts) {
    const o = opts || EMPTY;
    const n = Math.max(1, Math.round((o.count == null ? 1 : o.count) * (low && (o.count || 1) > 1 ? 0.5 : 1)));
    const size = o.size == null ? 1 : o.size, sp = o.spread == null ? 0.03 : o.spread;
    for (let k = 0; k < n; k++) {
      spawnSparkle(pos.x + (rnd() - 0.5) * 2 * sp, pos.y + (rnd() - 0.5) * 2 * sp, pos.z + (rnd() - 0.5) * 2 * sp,
        0.03 * size * (0.7 + 0.6 * rnd()), 0.45 + 0.2 * rnd());
    }
  }

  // =====================================================================================
  // UPDATE
  // =====================================================================================
  function writeP(attr, n, a, b, c, d) { const ar = attr.array; ar[n * 4] = a; ar[n * 4 + 1] = b; ar[n * 4 + 2] = c; ar[n * 4 + 3] = d; }
  function writeC(attr, n, r, g, b) { const ar = attr.array; ar[n * 3] = r; ar[n * 3 + 1] = g; ar[n * 3 + 2] = b; }
  function flush(mesh, n) {
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const g = mesh.geometry;
    if (g.attributes.aP) { g.attributes.aP.needsUpdate = true; g.attributes.aC.needsUpdate = true; }
    if (g.attributes.aOp) g.attributes.aOp.needsUpdate = true;
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    time += dt; timeU.value = time;

    // ---- droplets ----
    let n = 0;
    const drag = Math.max(0, 1 - 0.35 * dt);
    for (let i = 0; i < dPool.eff; i++) {
      if (!dPool.alive[i]) continue;
      const j = i * 3;
      dLife[i] -= dt;
      dVel[j + 1] -= 9.8 * dt;
      dVel[j] *= drag; dVel[j + 1] *= drag; dVel[j + 2] *= drag;
      dPos[j] += dVel[j] * dt; dPos[j + 1] += dVel[j + 1] * dt; dPos[j + 2] += dVel[j + 2] * dt;
      if (dPos[j + 1] <= dFloor[i] && dVel[j + 1] < 0) {
        dPool.alive[i] = 0;
        if (dDot[i]) {
          // tiny short-lived wet spot (dark fill + faint glint ring)
          _c.setRGB(dCol[j] * 0.22, dCol[j + 1] * 0.22, dCol[j + 2] * 0.22);
          spawnRing(dPos[j], dFloor[i] + 0.0015, dPos[j + 2], dR[i] * (dLand[i] ? 7 : 5.5), dLand[i] ? 0.5 : 0.3, 0.7, _c, 0.45);
        }
        if (dLand[i]) { const cb = dLand[i]; dLand[i] = null; try { cb(new THREE.Vector3(dPos[j], dFloor[i], dPos[j + 2])); } catch (e) { /* ignore */ } }
        continue;
      }
      if (dLife[i] <= 0) { dPool.alive[i] = 0; dLand[i] = null; continue; }
      const sp = Math.sqrt(dVel[j] * dVel[j] + dVel[j + 1] * dVel[j + 1] + dVel[j + 2] * dVel[j + 2]);
      let r = dR[i]; if (dLife[i] < 0.12) r *= dLife[i] / 0.12;
      if (sp > 0.05) { _v.set(dVel[j] / sp, dVel[j + 1] / sp, dVel[j + 2] / sp); _q.setFromUnitVectors(UP, _v); }
      else _q.copy(ZERO_Q);
      const el = 1 + Math.min(sp * 0.22, 1.1);
      _s.set(r / Math.sqrt(el), r * el, r / Math.sqrt(el));
      _p.set(dPos[j], dPos[j + 1], dPos[j + 2]);
      _m.compose(_p, _q, _s); drops.setMatrixAt(n, _m);
      const ic = drops.instanceColor.array; ic[n * 3] = dCol[j]; ic[n * 3 + 1] = dCol[j + 1]; ic[n * 3 + 2] = dCol[j + 2];
      aOp.array[n] = dOp[i];
      n++;
    }
    flush(drops, n);

    // ---- rings ----
    n = 0;
    for (let i = 0; i < rPool.eff; i++) {
      if (!rPool.alive[i]) continue;
      rAge[i] += dt;
      const t = rAge[i] / rLife[i];
      if (t >= 1) { rPool.alive[i] = 0; continue; }
      const e = 1 - (1 - t) * (1 - t);
      const sc = rSize[i] * (0.25 + 0.75 * e);
      _p.set(rPos[i * 3], rPos[i * 3 + 1], rPos[i * 3 + 2]);
      _q.setFromAxisAngle(UP, rRot[i]); _s.set(sc, 1, sc);
      _m.compose(_p, _q, _s); rings.setMatrixAt(n, _m);
      const a = rAlpha[i] * (1 - t) * (1 - t) * Math.min(1, t * 12);
      writeP(rings.geometry.attributes.aP, n, a, rRot[i], 0.07 * (1 - 0.5 * t), rFill[i] * (1 - t));
      writeC(rings.geometry.attributes.aC, n, rCol[i * 3], rCol[i * 3 + 1], rCol[i * 3 + 2]);
      n++;
    }
    flush(rings, n);

    // ---- wet patches ----
    n = 0;
    for (let i = 0; i < wPool.eff; i++) {
      if (!wPool.alive[i]) continue;
      wAge[i] += dt;
      const L = wLife[i];
      if (wAge[i] >= L) { wPool.alive[i] = 0; continue; }
      const dry = clamp01((wAge[i] - L * 0.3) / (L * 0.7));
      const fade = 1 - clamp01((wAge[i] - L * 0.85) / (L * 0.15));
      const r = wR[i] + wGrow[i] * Math.min(wAge[i], 1);
      const appear = Math.min(1, wAge[i] * 8);
      _p.set(wPos[i * 3], wPos[i * 3 + 1], wPos[i * 3 + 2]);
      _q.setFromAxisAngle(UP, wRot[i]); _s.set(r * 2.2, 1, r * 2.2);
      _m.compose(_p, _q, _s); wets.setMatrixAt(n, _m);
      writeP(wets.geometry.attributes.aP, n, appear * fade, dry * dry * (3 - 2 * dry), wVar[i], wDark[i]);
      n++;
    }
    flush(wets, n);

    // ---- foam ----
    uniqPar.length = 0;
    n = 0;
    for (let i = 0; i < FOAM_STORE; i++) {
      const st = fState[i];
      if (!st) continue;
      fAge[i] += dt;
      let k;
      if (st === 2) {
        fDie[i] += dt;
        const t = fDie[i] / 0.45;
        if (t >= 1) { fState[i] = 0; fPar[i] = null; continue; }
        k = 1 - t * t;
      } else {
        const t = fAge[i] / 0.16;
        k = t >= 1 ? 1 : t * (1.25 - 0.25 * t) * (1 + 0.15 * Math.sin(t * PI));
      }
      const par = fPar[i];
      if (par && uniqPar.indexOf(par) < 0) { uniqPar.push(par); par.updateWorldMatrix(true, false); }
      _p.set(fLoc[i * 3], fLoc[i * 3 + 1], fLoc[i * 3 + 2]);
      _q.set(fQ[i * 4], fQ[i * 4 + 1], fQ[i * 4 + 2], fQ[i * 4 + 3]);
      const sc = fScale[i] * k; _s.set(sc, sc * 0.72, sc);
      _m.compose(_p, _q, _s);
      if (par) _m.premultiply(par.matrixWorld);
      const me = _m.elements; fWorld[i * 3] = me[12]; fWorld[i * 3 + 1] = me[13]; fWorld[i * 3 + 2] = me[14];
      if (par) { // undo parent scale so lather keeps its real size
        const sx = Math.hypot(me[0], me[1], me[2]) / sc || 1;
        if (Math.abs(sx - 1) > 0.02) { const f = 1 / sx; for (let e = 0; e < 12; e++) if (e % 4 !== 3) me[e] *= f; }
      }
      foamMesh.setMatrixAt(n, _m);
      const ic = foamMesh.instanceColor.array; ic[n * 3] = ic[n * 3 + 1] = ic[n * 3 + 2] = fTone[i];
      n++;
    }
    flush(foamMesh, n);

    // ---- bubbles ----
    n = 0; bubLive = 0;
    for (let i = 0; i < bPool.eff; i++) {
      if (!bPool.alive[i]) continue;
      bAge[i] += dt;
      if (bAge[i] >= bLife[i]) { popBurst(i); continue; }
      const j = i * 3, ph = bPh[i] * 6.28 + bAge[i];
      bVel[j] += Math.sin(ph * 1.3) * 0.02 * dt; bVel[j + 2] += Math.cos(ph * 1.1) * 0.02 * dt;
      bVel[j + 1] += (0.06 - bVel[j + 1]) * 0.3 * dt;
      const dr = Math.max(0, 1 - 0.4 * dt); bVel[j] *= dr; bVel[j + 2] *= dr;
      bPos[j] += bVel[j] * dt; bPos[j + 1] += bVel[j + 1] * dt; bPos[j + 2] += bVel[j + 2] * dt;
      const k = Math.min(1, bAge[i] / 0.25);
      const d = bR[i] * 2 * (0.6 + 0.4 * k) * (1 + 0.03 * Math.sin(ph * 7));
      _p.set(bPos[j] + Math.sin(ph * 2.1) * 0.004, bPos[j + 1], bPos[j + 2] + Math.cos(ph * 1.7) * 0.004);
      _s.set(d, d, d); _m.compose(_p, ZERO_Q, _s); bubs.setMatrixAt(n, _m);
      writeP(bubs.geometry.attributes.aP, n, k, 0, bPh[i] + bAge[i] * 0.05, 0);
      n++; bubLive++;
    }
    flush(bubs, n);

    // ---- dust ----
    n = 0;
    for (let i = 0; i < uPool.eff; i++) {
      if (!uPool.alive[i]) continue;
      uAge[i] += dt;
      const t = uAge[i] / uLife[i];
      if (t >= 1) { uPool.alive[i] = 0; continue; }
      const j = i * 3, dr = Math.max(0, 1 - 2.8 * dt);
      uVel[j] *= dr; uVel[j + 2] *= dr; uVel[j + 1] = uVel[j + 1] * dr + 0.05 * dt;
      uPos[j] += uVel[j] * dt; uPos[j + 1] += uVel[j + 1] * dt; uPos[j + 2] += uVel[j + 2] * dt;
      uRot[i] += uSpin[i] * dt;
      const d = uR0[i] * 2 * (0.55 + 1.3 * Math.sqrt(t));
      _p.set(uPos[j], uPos[j + 1], uPos[j + 2]); _s.set(d, d, d);
      _m.compose(_p, ZERO_Q, _s); dusts.setMatrixAt(n, _m);
      const a = uA[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.5);
      writeP(dusts.geometry.attributes.aP, n, a, uRot[i], uVar[i], 0);
      writeC(dusts.geometry.attributes.aC, n, uCol[j], uCol[j + 1], uCol[j + 2]);
      n++;
    }
    flush(dusts, n);

    // ---- sand ----
    n = 0;
    for (let i = 0; i < sPool.eff; i++) {
      if (!sPool.alive[i]) continue;
      const j = i * 3;
      let sc = sR[i];
      if (sRest[i] < 0) {
        sVel[j + 1] -= 9.8 * dt;
        sPos[j] += sVel[j] * dt; sPos[j + 1] += sVel[j + 1] * dt; sPos[j + 2] += sVel[j + 2] * dt;
        const fl = sFloor[i] + sR[i] * 0.6;
        if (sPos[j + 1] <= fl && sVel[j + 1] < 0) {
          sPos[j + 1] = fl;
          if (!sBounce[i] && sVel[j + 1] < -0.4) { sBounce[i] = 1; sVel[j + 1] *= -0.3; sVel[j] *= 0.45; sVel[j + 2] *= 0.45; }
          else sRest[i] = 0;
        }
      } else {
        sRest[i] += dt;
        if (sRest[i] > 21) { sPool.alive[i] = 0; continue; }
        if (sRest[i] > 20) sc *= 21 - sRest[i];
      }
      _p.set(sPos[j], sPos[j + 1], sPos[j + 2]);
      _q.set(sQ[i * 4], sQ[i * 4 + 1], sQ[i * 4 + 2], sQ[i * 4 + 3]); _s.set(sc, sc * 0.7, sc * 0.85);
      _m.compose(_p, _q, _s); sandMesh.setMatrixAt(n, _m);
      const ic = sandMesh.instanceColor.array; ic[n * 3] = sCol[j]; ic[n * 3 + 1] = sCol[j + 1]; ic[n * 3 + 2] = sCol[j + 2];
      n++;
    }
    flush(sandMesh, n);

    // ---- sparkles ----
    n = 0;
    for (let i = 0; i < kPool.eff; i++) {
      if (!kPool.alive[i]) continue;
      kAge[i] += dt;
      const t = kAge[i] / kLife[i];
      if (t >= 1) { kPool.alive[i] = 0; continue; }
      const env = Math.pow(Math.sin(PI * t), 1.6);
      const tw = 0.8 + 0.2 * Math.sin(kAge[i] * 40 + i);
      const d = kS[i] * (0.5 + 0.6 * env);
      _p.set(kPos[i * 3], kPos[i * 3 + 1], kPos[i * 3 + 2]); _s.set(d, d, d);
      _m.compose(_p, ZERO_Q, _s); spks.setMatrixAt(n, _m);
      writeP(spks.geometry.attributes.aP, n, env * tw, kRot[i] + t * 0.6, 0, 0);
      n++;
    }
    flush(spks, n);
  }

  function setQuality(isLow) {
    low = !!isLow; emit = low ? 0.5 : 1;
    const h = low ? 0.5 : 1;
    setEff(dPool, DROP_CAP * h); setEff(rPool, RING_CAP * h); setEff(wPool, WET_CAP * h);
    setEff(bPool, BUB_CAP * h); setEff(uPool, DUST_CAP * h); setEff(sPool, SAND_CAP * h); setEff(kPool, SPK_CAP * h);
    foamEff = low ? FOAM_CAP / 2 : FOAM_CAP;
    let excess = fLive - foamEff;
    for (let i = 0; i < FOAM_STORE && excess > 0; i++) if (fState[i] === 1) { foamKill(i); excess--; }
  }
  function clearAll() {
    for (const pl of [dPool, rPool, wPool, bPool, uPool, sPool, kPool]) pl.alive.fill(0);
    dLand.fill(null);
    foam.clear();
    for (const m of [drops, rings, wets, bubs, dusts, sandMesh, spks]) m.count = 0;
  }
  if (low) setQuality(true);

  return {
    group,
    splash, spray, drip, wetPatch, ring,
    foam,
    bubble, popBubbleAt, bubbleCount: () => { let c = 0; for (let i = 0; i < bPool.eff; i++) c += bPool.alive[i]; return c; },
    dust, sand, sparkle,
    setQuality, clearAll, update,
  };
}
