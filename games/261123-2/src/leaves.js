// LEAVES — loose leaves, sweeping with the kumade rake, falling leaves, the pile (mound) incl. burning
// to ash, acorns. See CONTRACT.md "LEAVES — G.leaves".
export function create(G) {
  const THREE = G.THREE;
  const scene = G.scene;
  const PI = Math.PI, TAU = PI * 2;

  // ---------------------------------------------------------------- helpers
  const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const damp = (c, t, l, dt) => t + (c - t) * Math.exp(-l * dt);
  const fin = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  const audio = (name, a) => { try { const au = G.audio; if (au && typeof au[name] === 'function') au[name](a); } catch (e) { /* ignore */ } };
  const lowQ = () => !!(G.quality && G.quality.low);
  const shadowsOn = () => !!(G.quality && G.quality.shadows);

  function fallbackTex(rgba) {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
    t.needsUpdate = true; return t;
  }
  function noiseFallback() {
    const n = 64, d = new Uint8Array(n * n * 4);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 255) | 0;
    const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  }
  const TEX = G.tex || {};
  const texLeaves = TEX.leaves || fallbackTex([180, 90, 30, 255]);
  const texAsh = TEX.ash || fallbackTex([170, 168, 162, 255]);
  const texNoise = (G.util && G.util.noiseTex) || noiseFallback();
  let texLitter = null;
  if (TEX.leaflitter) {
    texLitter = TEX.leaflitter.clone();
    texLitter.wrapS = texLitter.wrapT = THREE.RepeatWrapping;
    texLitter.repeat.set(1, 1); texLitter.offset.set(0, 0); texLitter.needsUpdate = true;
  } else texLitter = fallbackTex([160, 110, 50, 255]);
  let litterNormal = null;
  try { if (G.util && G.util.normalFrom && TEX.leaflitter) litterNormal = G.util.normalFrom(texLitter, 2.5); } catch (e) { litterNormal = null; }

  // ---------------------------------------------------------------- layout / anchors
  const ELL = { cx: 0, cz: -0.25, rx: 1.35, rz: 1.75 };
  const ABSORB_R = 0.62;
  const SHELF_R = 0.32;
  const shelf = [new THREE.Vector3(-0.62, 0, 1.22), new THREE.Vector3(0.62, 0, 1.22)];
  const canopy = { c: new THREE.Vector3(-0.3, 3.3, -0.5), rx: 1.7, rz: 1.4 };
  function readAnchors() {
    try {
      const a = G.world && G.world.anchors;
      if (!a || typeof a !== 'object') return;
      const ok = (v) => v && typeof v.x === 'number' && isFinite(v.x) && isFinite(v.z);
      if (ok(a.zaru)) shelf[0].set(a.zaru.x, 0, a.zaru.z);
      if (ok(a.basket)) shelf[1].set(a.basket.x, 0, a.basket.z);
      if (a.canopy && ok(a.canopy.center)) {
        canopy.c.copy(a.canopy.center);
        canopy.rx = fin(a.canopy.rx, 1.7); canopy.rz = fin(a.canopy.rz, 1.4);
      }
    } catch (e) { /* stub world */ }
  }
  readAnchors();

  function validSpot(x, z, minR) {
    const ex = (x - ELL.cx) / ELL.rx, ez = (z - ELL.cz) / ELL.rz;
    if (ex * ex + ez * ez > 0.9) return false;
    if (x * x + z * z < minR * minR) return false;
    for (let k = 0; k < 2; k++) { const dx = x - shelf[k].x, dz = z - shelf[k].z; if (dx * dx + dz * dz < 0.36 * 0.36) return false; }
    if (Math.abs(x) < 0.45 && z > 1.12) return false;
    return true;
  }
  const _spot = { x: 0, z: 0 };
  function randomSpot(minR) {
    for (let k = 0; k < 60; k++) {
      const a = rnd(0, TAU), r = Math.sqrt(Math.random());
      const x = ELL.cx + Math.cos(a) * r * ELL.rx, z = ELL.cz + Math.sin(a) * r * ELL.rz;
      if (validSpot(x, z, minR)) { _spot.x = x; _spot.z = z; return _spot; }
    }
    _spot.x = 0.9; _spot.z = 0.2; return _spot;
  }

  // ---------------------------------------------------------------- leaf material (shared by loose + pile)
  const flipY = texLeaves.flipY !== false;
  const leafUniforms = { uTransl: { value: 0.55 }, uGlow: { value: 0.05 } };
  const LEAF_VERT_PARS = `
attribute float aCell; attribute vec3 aTint; attribute vec3 aCurl; attribute float aBurn;
varying vec3 vTint; varying float vLB; varying vec2 vLuv;`;
  const LEAF_BEGIN = `
vec3 transformed = vec3(position);
transformed.y += aCurl.x*position.x*position.x + aCurl.y*position.z*position.z + aCurl.z*position.x*position.z
  + aBurn*0.9*(position.x*position.x*position.x*position.x*6.0);`;
  const LEAF_UV = `
#include <uv_vertex>
#ifdef USE_MAP
{
  float row = floor(aCell/3.0 + 0.01); float col = aCell - row*3.0;
  vec2 cuv = vMapUv;
  vLuv = cuv;
  #if LEAF_FLIPY == 1
    vMapUv = vec2((col + 0.03 + cuv.x*0.94)/3.0, ((1.0-row) + 0.03 + cuv.y*0.94)*0.5);
  #else
    vMapUv = vec2((col + 0.03 + cuv.x*0.94)/3.0, (row + 0.03 + (1.0-cuv.y)*0.94)*0.5);
  #endif
}
#endif`;
  const leafMat = new THREE.MeshStandardMaterial({
    map: texLeaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78, metalness: 0,
  });
  leafMat.defines = { LEAF_FLIPY: flipY ? 1 : 0 };
  leafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTransl = leafUniforms.uTransl; sh.uniforms.uGlow = leafUniforms.uGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + LEAF_VERT_PARS)
      .replace('#include <uv_vertex>', LEAF_UV)
      .replace('#include <beginnormal_vertex>', `
vec3 objectNormal = normalize(vec3(-(2.0*aCurl.x*position.x + aCurl.z*position.z + aBurn*0.9*24.0*position.x*position.x*position.x), 1.0, -(2.0*aCurl.y*position.z + aCurl.z*position.x)));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`)
      .replace('#include <begin_vertex>', LEAF_BEGIN + '\nvTint = aTint; vLB = aBurn;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint; varying float vLB; varying vec2 vLuv; uniform float uTransl; uniform float uGlow;')
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= vTint;
if (vLB > 0.001) {
  float lum = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11));
  float edge = length((vLuv - 0.5)*vec2(1.0,0.85))*2.0;
  float ce = smoothstep(1.05 - vLB*2.4, 1.25 - vLB*2.4, edge);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03,0.025,0.02), ce);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum*1.15), smoothstep(0.45, 0.8, vLB));
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{ float tr = max(0.0, -dot(normal, directionalLights[0].direction));
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * (tr * uTransl) * vec3(1.0,0.85,0.6); }
#endif
reflectedLight.indirectDiffuse += diffuseColor.rgb * uGlow * vec3(1.0,0.8,0.55);`);
  };
  leafMat.customProgramCacheKey = () => 'leaves-leafmat-v1';

  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texLeaves, alphaTest: 0.5 });
  leafDepth.defines = { LEAF_FLIPY: flipY ? 1 : 0 };
  leafDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + LEAF_VERT_PARS)
      .replace('#include <uv_vertex>', LEAF_UV)
      .replace('#include <begin_vertex>', LEAF_BEGIN);
  };
  leafDepth.customProgramCacheKey = () => 'leaves-leafdepth-v1';

  function makeLeafGeo(cap) {
    const g = new THREE.PlaneGeometry(1, 1, 4, 4);
    g.rotateX(-PI / 2);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3));
    g.setAttribute('aCurl', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('aBurn', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    return g;
  }

  const CELL_W = [0.17, 0.13, 0.13, 0.25, 0.19, 0.13];
  function pickCell() { let r = Math.random(); for (let k = 0; k < 6; k++) { r -= CELL_W[k]; if (r <= 0) return k; } return 3; }
  function makeTint(arr, o, cell) {
    const b = 0.93 + rnd(-0.12, 0.12);
    const h = rnd(-0.06, 0.06);
    let r = b * (1 + h), g = b * (1 - h * 0.6), bl = b * (1 - h * 0.3);
    if (Math.random() < 0.18 || (cell === 3 && Math.random() < 0.3)) { const d = rnd(0.7, 0.92); r *= d * 0.95; g *= d * 0.8; bl *= d * 0.65; }
    arr[o] = r; arr[o + 1] = g; arr[o + 2] = bl;
  }
  function makeCurl(arr, o, cell) {
    const dry = cell === 3 ? 1.5 : 1;
    arr[o] = rnd(0.05, 0.28) * dry; arr[o + 1] = rnd(-0.06, 0.16) * dry; arr[o + 2] = rnd(-0.1, 0.1);
  }

  // ---------------------------------------------------------------- temps
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const HIDE = new THREE.Matrix4().compose(new THREE.Vector3(0, -50, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));

  // ---------------------------------------------------------------- loose leaves
  const LCAP = 340;
  const looseGeo = makeLeafGeo(LCAP);
  const loose = new THREE.InstancedMesh(looseGeo, leafMat, LCAP);
  loose.customDepthMaterial = leafDepth;
  loose.frustumCulled = false; loose.receiveShadow = true; loose.castShadow = shadowsOn();
  loose.name = 'looseLeaves';
  loose.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(loose);
  const lCellA = looseGeo.attributes.aCell, lTintA = looseGeo.attributes.aTint, lCurlA = looseGeo.attributes.aCurl;

  const F32 = (n) => new Float32Array(n);
  const lx = F32(LCAP), ly = F32(LCAP), lz = F32(LCAP), lvx = F32(LCAP), lvy = F32(LCAP), lvz = F32(LCAP);
  const lyaw = F32(LCAP), lpit = F32(LCAP), lrol = F32(LCAP), lspin = F32(LCAP), lpr = F32(LCAP), lrr = F32(LCAP);
  const lrestP = F32(LCAP), lrestR = F32(LCAP), lrestY = F32(LCAP), ls = F32(LCAP), lcup = F32(LCAP);
  const lmode = new Uint8Array(LCAP);
  // flight
  const fT = F32(LCAP), fDur = F32(LCAP), fDel = F32(LCAP), fx0 = F32(LCAP), fy0 = F32(LCAP), fz0 = F32(LCAP);
  const fcx = F32(LCAP), fcy = F32(LCAP), fcz = F32(LCAP), fLx = F32(LCAP), fLz = F32(LCAP);
  const fSw = F32(LCAP), fOm = F32(LCAP), fPh = F32(LCAP), fSdx = F32(LCAP), fSdz = F32(LCAP);
  const fSlot = new Int16Array(LCAP).fill(-1);
  const FREE = 0, REST = 1, MOVE = 2, FALL = 3, ABSORB = 4, GATHER = 5, DROPTOP = 6;
  let looseDirty = false, attrDirty = false;
  for (let i = 0; i < LCAP; i++) loose.setMatrixAt(i, HIDE);

  function writeLeaf(i) {
    const c = Math.cos(lpit[i]) * Math.cos(lrol[i]);
    const s = ls[i];
    let lift = Math.sqrt(Math.max(0, 1 - c * c)) * 0.33 * s;
    if (c < 0) lift += lcup[i] * s * (-c);
    _e.set(lpit[i], lyaw[i], lrol[i], 'YXZ');
    _q.setFromEuler(_e);
    _p.set(lx[i], ly[i] + lift, lz[i]);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    _m.toArray(loose.instanceMatrix.array, i * 16);
    looseDirty = true;
  }
  function hideLeaf(i) { HIDE.toArray(loose.instanceMatrix.array, i * 16); looseDirty = true; }
  function allocLeaf() { for (let i = 0; i < LCAP; i++) if (lmode[i] === FREE) return i; return -1; }
  function freeLeaf(i) { lmode[i] = FREE; fSlot[i] = -1; hideLeaf(i); }
  function initLeafLook(i, cell) {
    if (cell === undefined) cell = pickCell();
    lCellA.array[i] = cell;
    makeTint(lTintA.array, i * 3, cell);
    makeCurl(lCurlA.array, i * 3, cell);
    const cu = lCurlA.array;
    lcup[i] = 0.25 * (Math.abs(cu[i * 3]) + Math.abs(cu[i * 3 + 1]) + Math.abs(cu[i * 3 + 2]));
    ls[i] = 0.20 - Math.pow(Math.random(), 1.6) * 0.06;
    attrDirty = true;
  }
  function placeRest(i, x, z) {
    lx[i] = x; lz[i] = z; lvx[i] = lvy[i] = lvz[i] = 0;
    lrestY[i] = rnd(0.004, 0.022);
    ly[i] = lrestY[i];
    lyaw[i] = rnd(0, TAU);
    const tilt = Math.random() < 0.85 ? rnd(0, 0.12) : rnd(0.12, 0.21);
    const ta = rnd(0, TAU);
    lrestP[i] = Math.cos(ta) * tilt; lrestR[i] = Math.sin(ta) * tilt;
    lpit[i] = lrestP[i] + (Math.random() < 0.12 ? PI : 0); lrol[i] = lrestR[i];
    lspin[i] = lpr[i] = lrr[i] = 0;
    lmode[i] = REST;
    writeLeaf(i);
  }

  // ---------------------------------------------------------------- pile (mound + pile leaves)
  const PCAP = 150;
  const pileGeo = makeLeafGeo(PCAP);
  const pileLeaves = new THREE.InstancedMesh(pileGeo, leafMat, PCAP);
  pileLeaves.customDepthMaterial = leafDepth;
  pileLeaves.frustumCulled = false; pileLeaves.receiveShadow = true; pileLeaves.castShadow = shadowsOn();
  pileLeaves.name = 'pileLeaves';
  scene.add(pileLeaves);
  const pCellA = pileGeo.attributes.aCell, pTintA = pileGeo.attributes.aTint, pCurlA = pileGeo.attributes.aCurl, pBurnA = pileGeo.attributes.aBurn;
  const sTh = F32(PCAP), sT = F32(PCAP), sYaw = F32(PCAP), sTx = F32(PCAP), sTz = F32(PCAP), sS = F32(PCAP), sOff = F32(PCAP);
  const sOrd = F32(PCAP), sHopY = F32(PCAP), sHopV = F32(PCAP), sHopD = F32(PCAP);
  const sBaseTint = F32(PCAP * 3), sBaseCurl = F32(PCAP * 3);
  const sVis = new Uint8Array(PCAP), sKeep = new Uint8Array(PCAP), sUsed = new Uint8Array(PCAP);
  for (let i = 0; i < PCAP; i++) pileLeaves.setMatrixAt(i, HIDE);

  // mound
  const SEG = 40, RINGS = 16, NR = RINGS + 2; // + skirt ring
  const moundPos = new Float32Array(NR * SEG * 3), moundUv = new Float32Array(NR * SEG * 2);
  const moundIdx = [];
  for (let j = 0; j < NR - 1; j++) for (let i = 0; i < SEG; i++) {
    const i1 = (i + 1) % SEG, a = j * SEG + i, b = j * SEG + i1, c = (j + 1) * SEG + i, d = (j + 1) * SEG + i1;
    moundIdx.push(a, b, c, b, d, c);
  }
  const moundGeo = new THREE.BufferGeometry();
  moundGeo.setAttribute('position', new THREE.BufferAttribute(moundPos, 3).setUsage(THREE.DynamicDrawUsage));
  moundGeo.setAttribute('uv', new THREE.BufferAttribute(moundUv, 2).setUsage(THREE.DynamicDrawUsage));
  moundGeo.setIndex(moundIdx);
  const moundU = {
    uBurn: { value: 0 }, uEmber: { value: 0 }, uTime: { value: 0 }, uR: { value: 0.3 },
    uAsh: { value: texAsh }, uNoise: { value: texNoise },
  };
  const moundMat = new THREE.MeshStandardMaterial({ map: texLitter, normalMap: litterNormal || null, roughness: 0.92, metalness: 0 });
  if (litterNormal) moundMat.normalScale = new THREE.Vector2(1.1, 1.1);
  moundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, moundU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLPos; uniform float uBurn; uniform float uEmber; uniform float uTime; uniform float uR;
uniform sampler2D uAsh; uniform sampler2D uNoise;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec2 bp = vLPos.xz;
float br = length(bp) / max(uR, 0.05);
float bn1 = texture2D(uNoise, bp*1.1 + 0.17).r;
float bn2 = texture2D(uNoise, bp*3.7 + 0.53).g;
float bn3 = texture2D(uNoise, bp*9.0 + 0.31).b;
float bChar = smoothstep(0.0, 0.16, uBurn*1.75 - 0.15 - (br*0.75 + bn1*0.45));
float bAsh = smoothstep(0.0, 0.25, uBurn*2.6 - 1.55 - (br*0.55 + bn1*0.4));
vec3 bc = diffuseColor.rgb;
{ float l0 = dot(bc, vec3(0.3,0.59,0.11)); bc = mix(vec3(l0), bc, 0.85) * 0.82;
  bc *= mix(0.5, 1.0, smoothstep(1.0, 0.55, br)) * (0.85 + 0.3*bn1); }
bc = mix(bc, bc*vec3(0.55,0.40,0.28), smoothstep(0.0, 0.55, uBurn)*0.7);
vec3 charC = vec3(0.030,0.026,0.022)*(0.55 + 1.1*bn3);
bc = mix(bc, charC, bChar);
vec3 ashT = mix(texture2D(uAsh, bp*3.1).rgb, texture2D(uAsh, mat2(0.6,-0.8,0.8,0.6)*bp*2.3 + 0.4).rgb, 0.5);
vec3 ashC = mix(vec3(dot(ashT, vec3(0.333))), ashT, 0.2) * vec3(0.74,0.66,0.56) * (0.7 + 0.6*bn2) * (0.75 + 0.5*bn1);
float flake = smoothstep(0.64, 0.74, bn2) * (0.5 + 0.5*bn3);
ashC = mix(ashC, charC*1.3, flake*0.9);
ashC = mix(ashC, vec3(0.05,0.042,0.035)*(0.7+0.6*bn3), smoothstep(0.62, 0.98, br + (bn2-0.5)*0.4)*0.95);
// ember mask: glowing coals show in dark cracks between the ash
float en = texture2D(uNoise, bp*4.6 + vec2(uTime*0.011, -uTime*0.008)).r;
float en2 = texture2D(uNoise, bp*11.0 - vec2(uTime*0.019, uTime*0.015)).g;
float emM = smoothstep(0.68, 0.88, en*0.55 + en2*0.6) * (1.0 - 0.75*smoothstep(0.35, 0.9, br));
emM *= max(bChar, bAsh) * (1.0 - 0.6*flake) * uEmber;
bc = mix(bc, ashC, bAsh);
bc = mix(bc, vec3(0.06,0.02,0.01), clamp(emM*1.3, 0.0, 0.85));
diffuseColor.rgb = bc;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, nonPerturbedNormal, bAsh*0.5));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 1.0, max(bChar*0.6, bAsh));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float br2 = 0.6 + 0.4*sin(uTime*1.3 + en2*9.0 + en*5.0);
  totalEmissiveRadiance += vec3(1.0, 0.27, 0.035) * emM * br2 * 3.0;
}`);
  };
  moundMat.customProgramCacheKey = () => 'leaves-mound-v1';
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.name = 'leafMound';
  mound.receiveShadow = true; mound.castShadow = shadowsOn();
  mound.frustumCulled = false;
  scene.add(mound);

  // pile state
  let total = 210, absorbed = 0, landed = 0, absorbedTotal = 0;
  let fd = 0;          // displayed (eased) fraction for the mound shape
  let burnK = 0, emberK = 0, swell = 0, squash = 0, squashV = 0;
  let curR = 0.22, curH = 0.07, topY = 0.07, bkShape = 0;
  let ph1 = 0, ph2 = 0, ph3 = 0, ph4 = 0, ph5 = 0, ph6 = 0;
  let pileDirty = true, shapeSig = -1;
  function randomizeLumps() { ph1 = rnd(0, TAU); ph2 = rnd(0, TAU); ph3 = rnd(0, TAU); ph4 = rnd(0, TAU); ph5 = rnd(0, TAU); ph6 = rnd(0, TAU); }
  randomizeLumps();
  const rimR = (th) => 1 + 0.05 * Math.sin(3 * th + ph1) + 0.03 * Math.sin(5 * th + ph2) + 0.015 * Math.sin(8 * th + ph3);
  function prof(t) {
    if (t >= 1) return 0;
    const ex = lerp(1.7, 2.4, bkShape), pw = lerp(1.25, 1.7, bkShape);
    return Math.pow(1 - Math.pow(t, ex), pw);
  }
  const lump = (th, t) => 1 + (0.10 * Math.sin(2 * th + ph4 + t * 2.5) * t + 0.07 * Math.sin(4 * th + ph5 - t * 3) * t + 0.05 * Math.cos(t * 5 + ph6)) * (1 - 0.5 * bkShape);
  function surf(th, t, out) {
    const tt = Math.max(0, t);
    const rr = curR * rimR(th) * tt;
    out.x = Math.cos(th) * rr; out.z = Math.sin(th) * rr;
    out.y = tt >= 1 ? 0 : curH * prof(tt) * lump(th, tt);
    return out;
  }
  function heightAt(x, z) {
    if (!mound.visible) return 0;
    const th = Math.atan2(z, x), r = Math.sqrt(x * x + z * z);
    const t = r / Math.max(0.01, curR * rimR(th));
    if (t >= 1) return 0;
    return curH * prof(t) * lump(th, t);
  }
  const ease = (f) => 1 - Math.pow(1 - clamp(f, 0, 1), 1.6);
  function computeShape() {
    const e = ease(fd);
    let R = lerp(0.22, 0.55, e), H = lerp(0.07, 0.42, e);
    bkShape = smooth(0.2, 1, burnK);
    H *= 1 - 0.7 * bkShape; R *= 1 + 0.09 * bkShape;
    H *= 1 - 0.03 * squash + 0.03 * swell; R *= 1 + 0.012 * squash + 0.008 * swell;
    curR = R; curH = H;
  }
  function rebuildMound() {
    let k = 0, ku = 0, maxY = 0;
    for (let j = 0; j < NR; j++) {
      const t = j <= RINGS ? j / RINGS : 1.05;
      for (let i = 0; i < SEG; i++) {
        const th = (i / SEG) * TAU;
        surf(th, t, _a);
        if (j > RINGS) _a.y = -0.012;
        if (_a.y > maxY) maxY = _a.y;
        moundPos[k++] = _a.x; moundPos[k++] = _a.y; moundPos[k++] = _a.z;
        moundUv[ku++] = _a.x / 0.55 + 0.37; moundUv[ku++] = _a.z / 0.55 + 0.11;
      }
    }
    topY = maxY;
    moundGeo.attributes.position.needsUpdate = true; moundGeo.attributes.uv.needsUpdate = true;
    moundGeo.computeVertexNormals();
    moundGeo.computeBoundingSphere();
    moundU.uR.value = curR;
  }

  function slotBurn(i) { return clamp((burnK * 1.5 - 0.35 - sOrd[i] * 0.5) / 0.6, 0, 1); }
  function applyBurnAttrs() {
    const tA = pTintA.array, cA = pCurlA.array, bA = pBurnA.array;
    for (let i = 0; i < PCAP; i++) {
      const b = burnK <= 0 ? 0 : slotBurn(i);
      const o = i * 3;
      let r = sBaseTint[o], g = sBaseTint[o + 1], bl = sBaseTint[o + 2];
      if (b > 0) {
        if (b < 0.35) { const u = b / 0.35; r = lerp(r, 0.42, u); g = lerp(g, 0.24, u); bl = lerp(bl, 0.12, u); }
        else if (b < 0.6) { const u = (b - 0.35) / 0.25; r = lerp(0.42, 0.06, u); g = lerp(0.24, 0.05, u); bl = lerp(0.12, 0.045, u); }
        else { const u = smooth(0.6, 0.85, b); const gr = sKeep[i] ? 0.12 : 0.85; r = lerp(0.06, gr, u); g = lerp(0.05, gr * 0.97, u); bl = lerp(0.045, gr * 0.93, u); }
      }
      tA[o] = r; tA[o + 1] = g; tA[o + 2] = bl;
      cA[o] = sBaseCurl[o] + b * 0.9; cA[o + 1] = sBaseCurl[o + 1] + b * 0.35; cA[o + 2] = sBaseCurl[o + 2];
      bA[i] = b;
    }
    pTintA.needsUpdate = true; pCurlA.needsUpdate = true; pBurnA.needsUpdate = true;
  }

  function seatSlot(i) {
    if (!sVis[i]) { HIDE.toArray(pileLeaves.instanceMatrix.array, i * 16); return; }
    const th = sTh[i], t = sT[i];
    let sc = sS[i];
    if (burnK > 0) {
      const b = slotBurn(i);
      if (sKeep[i]) sc *= lerp(1, 0.5, smooth(0.5, 0.9, b));
      else sc *= b < 0.55 ? 1 - b * 0.2 : lerp(0.89, 0, smooth(0.55, 1, b));
    }
    if (sc < 0.004) { HIDE.toArray(pileLeaves.instanceMatrix.array, i * 16); return; }
    if (t < 1) {
      const tc = Math.max(0.05, t);
      surf(th, tc, _a); surf(th + 0.08, tc, _b); surf(th, Math.min(0.999, tc + 0.03), _c);
      _b.sub(_a); _c.sub(_a);
      _n.crossVectors(_b, _c);
      if (_n.y < 0) _n.negate();
      if (_n.lengthSq() < 1e-12) _n.set(0, 1, 0); else _n.normalize();
      surf(th, t, _a);
    } else {
      surf(th, t, _a); _n.set(0, 1, 0);
    }
    _q2.setFromUnitVectors(UP, _n);
    _e.set(sTx[i], sYaw[i], sTz[i], 'YXZ');
    _q.setFromEuler(_e);
    _q2.multiply(_q);
    _p.copy(_a).addScaledVector(_n, sOff[i] * (1 - 0.6 * bkShape)).addScaledVector(UP, sHopY[i]);
    _s.set(sc, sc, sc);
    _m.compose(_p, _q2, _s);
    _m.toArray(pileLeaves.instanceMatrix.array, i * 16);
  }
  function seatAll() { for (let i = 0; i < PCAP; i++) seatSlot(i); pileLeaves.instanceMatrix.needsUpdate = true; }

  function newSlotGeom(i, top) {
    if (top) { sTh[i] = rnd(0, TAU); sT[i] = rnd(0, 0.08); }
    else {
      sTh[i] = rnd(0, TAU);
      const u = Math.random();
      sT[i] = u < 0.4 ? rnd(0.82, 1.12) : Math.sqrt(Math.random()) * 0.9;
    }
    sYaw[i] = rnd(0, TAU);
    const tl = sT[i] > 0.97 ? 0.12 : 0.5;
    sTx[i] = rnd(-tl, tl); sTz[i] = rnd(-tl, tl);
    if (Math.random() < 0.1) sTx[i] += PI;
    sOff[i] = rnd(0.003, 0.016);
    sOrd[i] = sT[i] * 0.75 + rnd(0, 0.25);
    sHopY[i] = 0; sHopV[i] = 0; sHopD[i] = -1;
  }
  function setSlotLook(i, cell, tint, curl, scale) {
    pCellA.array[i] = cell;
    const o = i * 3;
    if (tint) { sBaseTint[o] = tint[0]; sBaseTint[o + 1] = tint[1]; sBaseTint[o + 2] = tint[2]; }
    else makeTint(sBaseTint, o, cell);
    if (curl) { sBaseCurl[o] = curl[0]; sBaseCurl[o + 1] = curl[1]; sBaseCurl[o + 2] = curl[2]; }
    else makeCurl(sBaseCurl, o, cell);
    sS[i] = scale || rnd(0.13, 0.19);
    pCellA.needsUpdate = true;
  }
  // choose a slot for a new pile leaf. top=true: near the summit
  let slotCursor = 0;
  function reserveSlot(top) {
    let i = -1;
    for (let k = 0; k < PCAP; k++) if (!sUsed[k]) { i = k; break; }
    if (i < 0) { i = (slotCursor++ * 37 + ((Math.random() * 5) | 0)) % PCAP; }
    sUsed[i] = 1; sVis[i] = 0;
    newSlotGeom(i, top);
    seatSlot(i); pileLeaves.instanceMatrix.needsUpdate = true;
    return i;
  }
  const _tint = [1, 1, 1], _curl = [0, 0, 0];
  function landInSlot(i, slot, top) {
    // transfer the loose leaf's look onto the pile slot
    if (slot < 0 || slot >= PCAP) return;
    const o = i * 3;
    _tint[0] = lTintA.array[o]; _tint[1] = lTintA.array[o + 1]; _tint[2] = lTintA.array[o + 2];
    _curl[0] = lCurlA.array[o]; _curl[1] = lCurlA.array[o + 1]; _curl[2] = lCurlA.array[o + 2];
    setSlotLook(slot, lCellA.array[i], _tint, _curl, ls[i]);
    if (top) { sTx[slot] = rnd(-0.12, 0.12); sTz[slot] = rnd(-0.12, 0.12); sYaw[slot] = lyaw[i]; }
    sVis[slot] = 1;
    sHopV[slot] = top ? 0.32 : 0.12; sHopD[slot] = 0; sHopY[slot] = 0.0;
    applyBurnAttrs();
    pileDirty = true;
  }

  // ---------------------------------------------------------------- rake (kumade)
  const RAKE = buildRake();
  const rakeRoot = new THREE.Group(); rakeRoot.name = 'rake';
  const rakeTilt = new THREE.Group();
  const rakeMesh = new THREE.Mesh(RAKE.geo, RAKE.mat);
  rakeMesh.castShadow = true; rakeMesh.receiveShadow = true;
  rakeMesh.position.copy(RAKE.tip).negate();
  rakeTilt.add(rakeMesh); rakeRoot.add(rakeTilt); scene.add(rakeRoot);
  const keyPts = RAKE.keys.map((p) => p.clone().sub(RAKE.tip));
  const SWEEP_PITCH = 0.58;
  // lowest key point height for a given pitch/roll
  const _rq = new THREE.Quaternion(), _re = new THREE.Euler(0, 0, 0, 'XYZ'), _rv = new THREE.Vector3();
  function lowestY(pitch, roll) {
    _re.set(-pitch, 0, roll, 'XYZ'); _rq.setFromEuler(_re);
    let mn = 1e9;
    for (let k = 0; k < keyPts.length; k++) { _rv.copy(keyPts[k]).applyQuaternion(_rq); if (_rv.y < mn) mn = _rv.y; }
    return mn;
  }
  function poleEndY(pitch, roll) { _re.set(-pitch, 0, roll, 'XYZ'); _rq.setFromEuler(_re); _rv.copy(RAKE.end).sub(RAKE.tip).applyQuaternion(_rq); return _rv.y; }
  // solve the lying pitch: pole end resting on the ground like the rest of the rake
  let FLAT_PITCH = 0.0;
  {
    let best = 0, bestErr = 1e9;
    for (let p = -0.4; p <= 0.6; p += 0.002) {
      const others = lowestYExcludingEnd(p, 0.06);
      const err = Math.abs(poleEndY(p, 0.06) - others);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    FLAT_PITCH = best;
  }
  function lowestYExcludingEnd(pitch, roll) {
    _re.set(-pitch, 0, roll, 'XYZ'); _rq.setFromEuler(_re);
    let mn = 1e9;
    for (let k = 0; k < keyPts.length - 1; k++) { _rv.copy(keyPts[k]).applyQuaternion(_rq); if (_rv.y < mn) mn = _rv.y; }
    return mn;
  }
  const rk = {
    x: 0.5, z: 0.55, vx: 0, vz: 0, yaw: 0, pitch: FLAT_PITCH, pv: 0, roll: 0.06, rv: 0,
    active: false, fly: -1, fx: 0, fz: 0, fyaw: 0, tx: 0, tz: 0, attn: 0, hs: 0, dirx: 0, dirz: -1,
    hvx: 0, hvz: 0, inX: 0, inZ: 0, inVx: 0, inVz: 0, gotPoint: false,
  };
  function rakeRest() {
    rk.x = 0.92; rk.z = 0.62; rk.vx = rk.vz = 0;
    rk.yaw = Math.atan2(1, -0.45); rk.pitch = FLAT_PITCH; rk.pv = 0; rk.roll = 0.06; rk.rv = 0;
    rk.active = false; rk.fly = -1; rk.hs = 0;
  }
  rakeRest();
  let rakeYOff = 0;
  function poseRake() {
    const at = rk.attn, tt = clock;
    const wob = Math.sin(tt * TAU * 1.2);
    const pitch = rk.pitch + Math.max(0, wob) * 0.035 * at;
    const roll = rk.roll + wob * 0.07 * at;
    const low = lowestY(pitch, roll);
    rakeYOff = -low + 0.002;
    rakeRoot.position.set(rk.x, heightAt(rk.x, rk.z) + rakeYOff, rk.z);
    rakeRoot.rotation.set(0, rk.yaw, 0);
    rakeTilt.rotation.set(-pitch, 0, roll, 'XYZ');
  }

  // ---------------------------------------------------------------- acorns
  const ACN = 4;
  const acornGeo = buildAcornGeos();
  const nutMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  const nutBurnt = new THREE.MeshStandardMaterial({ color: 0x1a120d, roughness: 0.7, metalness: 0 });
  const capBurnt = new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.95, metalness: 0 });
  const AR = 0.0079;
  const acorns = [];
  for (let k = 0; k < ACN; k++) {
    const root = new THREE.Group(); root.name = 'acorn';
    const body = new THREE.Group();
    const nut = new THREE.Mesh(acornGeo.nut, nutMat), cap = new THREE.Mesh(acornGeo.cap, capMat);
    nut.castShadow = cap.castShadow = shadowsOn(); nut.receiveShadow = cap.receiveShadow = true;
    body.add(nut, cap); body.rotation.x = PI / 2; body.position.set(0, 0, 0);
    nut.position.y = cap.position.y = -0.0125;
    root.add(body); scene.add(root);
    acorns.push({ root, nut, cap, x: 0, z: 0, y: AR, vx: 0, vz: 0, vy: 0, yaw: 0, roll: 0, mode: 0, burnt: false, t: 0, hopEnd: 0 });
  }
  // modes: 0 ground rest, 1 rolling, 2 hopping into pile, 3 in pile (hidden), 4 ballistic (pop)
  let acornsInPile = 0, lastRoll = 0;
  function placeAcorn(a, x, z) {
    a.x = x; a.z = z; a.y = AR; a.vx = a.vz = a.vy = 0; a.yaw = rnd(0, TAU); a.roll = rnd(0, TAU); a.mode = 0;
    setBurnt(a, false); a.root.visible = true; poseAcorn(a);
  }
  function setBurnt(a, b) { a.burnt = b; a.nut.material = b ? nutBurnt : nutMat; a.cap.material = b ? capBurnt : capMat; }
  function poseAcorn(a) {
    a.root.position.set(a.x, a.y, a.z);
    a.root.rotation.set(0, a.yaw, a.roll, 'YXZ');
  }

  // ---------------------------------------------------------------- scatter / reset
  let clusters = [];
  function scatter(n) {
    for (let i = 0; i < LCAP; i++) { lmode[i] = FREE; fSlot[i] = -1; hideLeaf(i); }
    n = clamp(n | 0, 0, LCAP);
    const nc = 10 + ((Math.random() * 4) | 0);
    clusters = [];
    for (let c = 0; c < nc; c++) { const s = randomSpot(0.85); clusters.push({ x: s.x, z: s.z, s: rnd(0.24, 0.42), w: rnd(0.5, 1.5) }); }
    let wsum = 0; for (const c of clusters) wsum += c.w;
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 14 && !ok; tries++) {
        if (Math.random() < 0.36) {
          let r = Math.random() * wsum, c = clusters[0];
          for (const cc of clusters) { r -= cc.w; if (r <= 0) { c = cc; break; } }
          x = c.x + gauss() * c.s; z = c.z + gauss() * c.s * 0.9;
        } else { const s = randomSpot(0.72); x = s.x; z = s.z; }
        ok = validSpot(x, z, 0.72);
        const r = Math.sqrt(x * x + z * z);
        if (ok && r < 0.9 && Math.random() < 0.3) ok = false; // looser ring near the pile
      }
      if (!ok) { const s = randomSpot(0.72); x = s.x; z = s.z; }
      initLeafLook(i);
      placeRest(i, x, z);
    }
    loose.count = LCAP;
    // acorns under clusters
    for (let k = 0; k < ACN; k++) {
      // under a leaf cluster but clear of the stone ring (r >= 1.0)
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        const c = clusters[(k + t) % clusters.length];
        x = c.x + gauss() * c.s * 0.6; z = c.z + gauss() * c.s * 0.6;
        ok = validSpot(x, z, 1.0);
      }
      if (!ok) { const s = randomSpot(1.0); x = s.x; z = s.z; }
      placeAcorn(acorns[k], x, z);
    }
    acornsInPile = 0;
  }
  function fillPile(n) {
    for (let i = 0; i < PCAP; i++) { sUsed[i] = 0; sVis[i] = 0; sKeep[i] = 0; }
    const m = Math.min(PCAP, n | 0);
    for (let k = 0; k < m; k++) {
      const i = k; sUsed[i] = 1; sVis[i] = 1;
      newSlotGeom(i, false);
      setSlotLook(i, pickCell(), null, null, 0);
    }
    // keepers: a dozen flakes that remain on the ash bed
    let kept = 0;
    for (let i = 0; i < PCAP && kept < 12; i++) if (Math.random() < 0.12) { sKeep[i] = 1; kept++; }
    applyBurnAttrs();
    pileDirty = true;
  }
  function snapShape() {
    fd = total > 0 ? clamp(landed / total, 0, 1) : 0;
    swell = 0; squash = 0; squashV = 0;
    computeShape(); rebuildMound(); shapeSig = -1;
    mound.visible = landed > 0 || burnK > 0;
    seatAll();
  }
  const dropCbs = new Array(LCAP).fill(null);   // callback per falling DROPTOP leaf
  const pendingCbs = [];                          // [{t, cb}] fire after the tiny bounce
  function clearFlights() {
    for (let i = 0; i < LCAP; i++) if (lmode[i] >= FALL) { freeLeaf(i); }
    dropCbs.fill(null); pendingCbs.length = 0;
  }

  function reset(opts) {
    try {
      opts = opts || {};
      readAnchors();
      const defCount = lowQ() ? 190 : 300;
      const count = clamp(Math.round(fin(opts.count, defCount)), 0, LCAP + PCAP);
      const pileStart = clamp(fin(opts.pileStart, 0.10), 0, 1);
      clearFlights();
      if (opts.keepPile) {
        const n = opts.count !== undefined ? Math.min(LCAP, count) : 0;
        const keepAc = acornsInPile;
        scatter(n);
        if (keepAc > 0) restoreAcornsInPile(keepAc);
        snapShape();
        return;
      }
      total = Math.max(1, count);
      absorbed = landed = Math.round(total * pileStart);
      const looseN = Math.min(LCAP, total - absorbed);
      burnK = 0; emberK = 0; moundU.uBurn.value = 0; moundU.uEmber.value = 0;
      randomizeLumps();
      // opts.rain = seconds: no loose leaves now; the round's leaves rain down from the canopy instead
      // (they ARE the round's total, so pileFraction = absorbed / (pile start + rained leaves))
      const rain = fin(opts.rain, 0);
      if (rain > 0) total = Math.max(1, absorbed + looseN);
      scatter(rain > 0 ? 0 : looseN);
      fillPile(absorbed);
      rakeRest();
      snapShape();
      if (rain > 0) dropLeaves(looseN, rain);
    } catch (e) { if (G.dev) console.warn('leaves.reset', e); }
  }
  function restoreAcornsInPile(n) {
    acornsInPile = 0;
    for (let k = 0; k < ACN && acornsInPile < n; k++) { acorns[k].mode = 3; acorns[k].root.visible = false; acornsInPile++; }
  }

  // ---------------------------------------------------------------- absorption / flights
  function startAbsorb(i, kind, delay, dur) {
    const slot = reserveSlot(false);
    fSlot[i] = slot;
    lmode[i] = kind;
    fT[i] = 0; fDel[i] = delay || 0; fDur[i] = dur || rnd(0.25, 0.4);
    fx0[i] = lx[i]; fy0[i] = ly[i]; fz0[i] = lz[i];
    if (kind === GATHER) {
      // curving path: control point offset sideways + up
      const dx = -lx[i], dz = -lz[i], L = Math.sqrt(dx * dx + dz * dz) || 1;
      const side = rnd(-0.45, 0.45) * L;
      fcx[i] = lx[i] * 0.5 + (-dz / L) * side; fcz[i] = lz[i] * 0.5 + (dx / L) * side; fcy[i] = rnd(0.25, 0.55);
      lpr[i] = rnd(-9, 9); lrr[i] = rnd(-7, 7); lspin[i] = rnd(-5, 5);
    } else {
      fcx[i] = lx[i] * 0.55; fcz[i] = lz[i] * 0.55; fcy[i] = rnd(0.18, 0.3);
      lpr[i] = rnd(-10, 10); lrr[i] = rnd(-6, 6); lspin[i] = rnd(-6, 6);
    }
    absorbed++;
  }
  function landAbsorb(i) {
    const slot = fSlot[i];
    landInSlot(i, slot, false);
    landed++; absorbedTotal++;
    swell = Math.min(1.5, swell + 0.7);
    freeLeaf(i);
    audio('leafIn', clamp(total > 0 ? absorbed / total : 1, 0, 1));
  }

  // ---------------------------------------------------------------- sweep input
  const sw = { active: false, px: 0, pz: 0, vx: 0, vz: 0, has: false };
  function sweep(active, point, vx, vz) {
    try {
      const a = !!active;
      if (a && point && isFinite(point.x) && isFinite(point.z)) {
        sw.px = clamp(point.x, -2.5, 2.5); sw.pz = clamp(point.z, -2.5, 3.0); sw.has = true;
      }
      sw.vx = clamp(fin(vx), -8, 8); sw.vz = clamp(fin(vz), -8, 8);
      if (a && !sw.has) return;
      if (a && !rk.active) {
        // touch-down: fly the rake to the finger (<=100 ms)
        rk.active = true;
        const tx = sw.px, tz = sw.pz - 0.10;
        const d = Math.hypot(tx - rk.x, tz - rk.z);
        if (d > 0.04) { rk.fly = 0; rk.fx = rk.x; rk.fz = rk.z; rk.fyaw = rk.yaw; if (d > 0.3) audio('tok'); }
        else rk.fly = -1;
        rk.pv -= 2.2; // pressing bob
      } else if (!a && rk.active) {
        rk.active = false; rk.fly = -1;
        rk.rv += (Math.random() < 0.5 ? -1 : 1) * 0.6;
      }
      sw.active = a;
    } catch (e) { /* never throw */ }
  }

  // ---------------------------------------------------------------- pile actions
  function rustlePile(power) {
    try {
      const p = clamp(fin(power, 1), 0, 2);
      for (let i = 0; i < PCAP; i++) if (sVis[i]) {
        sHopD[i] = rnd(0, 0.22);
        sHopV[i] = p * rnd(0.35, 0.85);
      }
      squashV -= 6 * p;
    } catch (e) { /* */ }
  }

  function dropLeafOnPile(cb) {
    try {
      const fn = typeof cb === 'function' ? cb : null;
      const i = allocLeaf();
      if (i < 0) { if (fn) pendingCbs.push({ t: 2.4, cb: fn }); return; }
      initLeafLook(i, Math.random() < 0.5 ? 0 : 5);
      const cy = Math.max(1.5, canopy.c.y || 3.2);
      lx[i] = rnd(-0.35, 0.35); lz[i] = rnd(-0.35, 0.2); ly[i] = cy;
      fx0[i] = lx[i]; fz0[i] = lz[i]; fy0[i] = cy;
      fT[i] = 0; fDel[i] = 0; fDur[i] = 2.2; fOm[i] = rnd(2.6, 3.4); fPh[i] = rnd(0, TAU);
      const a = rnd(0, TAU); fSdx[i] = Math.cos(a); fSdz[i] = Math.sin(a); fSw[i] = rnd(0.16, 0.24);
      lyaw[i] = rnd(0, TAU); lpit[i] = 0; lrol[i] = 0; lspin[i] = rnd(-0.8, 0.8);
      lmode[i] = DROPTOP; dropCbs[i] = fn;
      writeLeaf(i);
    } catch (e) { /* */ }
  }

  function dropLeaves(n, seconds) {
    try {
      n = clamp(Math.round(fin(n, 40)), 0, LCAP);
      const secs = clamp(fin(seconds, 3), 0, 30);
      readAnchors();
      for (let k = 0; k < n; k++) {
        const i = allocLeaf(); if (i < 0) break;
        initLeafLook(i);
        // start in the canopy ellipse
        const a = rnd(0, TAU), r = Math.sqrt(Math.random());
        const sx = canopy.c.x + Math.cos(a) * r * canopy.rx, sz = canopy.c.z + Math.sin(a) * r * canopy.rz;
        const sy = (canopy.c.y || 3.3) + rnd(-0.4, 0.3);
        // landing spot: near below, clamped into the play area
        let land = null;
        for (let t = 0; t < 10; t++) {
          const x = sx * 0.6 + rnd(-0.5, 0.5), z = sz * 0.6 + 0.3 + rnd(-0.5, 0.6);
          if (validSpot(x, z, 0.75)) { land = _spot; _spot.x = x; _spot.z = z; break; }
        }
        if (!land) land = randomSpot(0.75);
        fLx[i] = land.x; fLz[i] = land.z;
        fx0[i] = sx; fz0[i] = sz; fy0[i] = sy;
        lx[i] = sx; lz[i] = sz; ly[i] = sy;
        lrestY[i] = rnd(0.004, 0.022);
        const tilt = rnd(0, 0.12), ta = rnd(0, TAU);
        lrestP[i] = Math.cos(ta) * tilt; lrestR[i] = Math.sin(ta) * tilt;
        fT[i] = 0; fDel[i] = Math.random() * secs; fDur[i] = (sy - lrestY[i]) / rnd(1.2, 1.6);
        fOm[i] = rnd(3.0, 4.4); fPh[i] = rnd(0, TAU); fSw[i] = rnd(0.1, 0.22);
        const sa = rnd(0, TAU); fSdx[i] = Math.cos(sa); fSdz[i] = Math.sin(sa);
        lyaw[i] = rnd(0, TAU); lspin[i] = rnd(-1.5, 1.5);
        lpit[i] = 0; lrol[i] = 0;
        lpr[i] = Math.random() < 0.25 ? rnd(-7, 7) : 0; lrr[i] = rnd(-1.5, 1.5);
        lmode[i] = FALL;
        hideLeaf(i);
      }
    } catch (e) { /* */ }
  }

  function gatherAll(seconds) {
    try {
      const secs = clamp(fin(seconds, 2), 0.2, 30);
      const fly = Math.max(0.35, secs * 0.4), spread = Math.max(0, secs - fly);
      for (let i = 0; i < LCAP; i++) {
        const m = lmode[i];
        if (m === REST || m === MOVE || m === FALL) {
          if (m === FALL) { // pop it into the air where it currently is
            if (fT[i] < fDel[i]) { lx[i] = fLx[i]; lz[i] = fLz[i]; ly[i] = lrestY[i]; }
          }
          // stagger: farther leaves later, plus noise
          const d = Math.sqrt(lx[i] * lx[i] + lz[i] * lz[i]);
          startAbsorb(i, GATHER, clamp(spread * (0.15 + 0.6 * clamp((d - 0.6) / 0.9, 0, 1) + rnd(-0.15, 0.25)), 0, spread), fly * rnd(0.8, 1.2));
        }
      }
      for (const a of acorns) if (a.mode === 0 || a.mode === 1) hopAcornIn(a);
    } catch (e) { /* */ }
  }

  function setBurn(k) {
    const v = clamp(fin(k), 0, 1);
    if (Math.abs(v - burnK) < 1e-5) return;
    burnK = v; moundU.uBurn.value = v;
    applyBurnAttrs(); pileDirty = true;
    mound.visible = landed > 0 || burnK > 0;
  }
  function setEmber(k) { emberK = clamp(fin(k), 0, 1); moundU.uEmber.value = emberK; }

  // acorn helpers
  function hopAcornIn(a) {
    const th = rnd(0, TAU); surf(th, rnd(0, 0.5), _a);
    launchAcorn(a, _a.x, Math.max(AR, _a.y), _a.z, 0.12);
    a.mode = 2;
  }
  function launchAcorn(a, tx, ty, tz, apex) {
    const g = 9.8;
    const h = Math.max(apex, ty - a.y + 0.05);
    const vy0 = Math.sqrt(2 * g * (h));
    const tu = vy0 / g, hd = Math.max(0.001, a.y + h - ty), td = Math.sqrt(2 * hd / g);
    const T = tu + td;
    a.vy = vy0; a.vx = (tx - a.x) / T; a.vz = (tz - a.z) / T; a.t = 0; a.hopEnd = T; a.ty = ty;
  }
  function popAcorn() {
    try {
      let a = null;
      for (const c of acorns) if (c.mode === 3) { a = c; break; }
      if (!a || acornsInPile <= 0) return null;
      acornsInPile = Math.max(0, acornsInPile - 1);
      const th = rnd(0, TAU); surf(th, rnd(0, 0.45), _a);
      a.x = _a.x; a.z = _a.z; a.y = Math.max(AR, _a.y + 0.01);
      const from = new THREE.Vector3(a.x, a.y, a.z);
      let tx = 1, tz = 0;
      for (let t = 0; t < 20; t++) {
        const ang = rnd(-PI * 0.95, PI * 0.95) + PI * 0.5, r = rnd(0.95, 1.15);
        tx = Math.cos(ang) * r; tz = Math.sin(ang) * r;
        if (validSpot(tx, tz, 0.9) || t === 19) break;
      }
      launchAcorn(a, tx, AR, tz, 0.5);
      a.mode = 4; a.root.visible = true; setBurnt(a, true);
      a.spin = rnd(-25, 25);
      poseAcorn(a);
      audio('pop');
      return from;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- update
  let clock = 0, lastShadow = shadowsOn(), patT = 0;
  function update(dt) {
    try {
      dt = clamp(fin(dt, 0.016), 0, 0.05);
      clock += dt;
      moundU.uTime.value = clock;
      const sh = shadowsOn();
      if (sh !== lastShadow) { lastShadow = sh; loose.castShadow = pileLeaves.castShadow = mound.castShadow = sh; for (const a of acorns) a.nut.castShadow = a.cap.castShadow = sh; }
      patT -= dt;
      updateRake(dt);
      updateLoose(dt);
      updateAcorns(dt);
      updatePile(dt);
      if (looseDirty) { loose.instanceMatrix.needsUpdate = true; looseDirty = false; }
      if (attrDirty) { lCellA.needsUpdate = lTintA.needsUpdate = lCurlA.needsUpdate = true; attrDirty = false; }
      for (let k = pendingCbs.length - 1; k >= 0; k--) {
        const pc = pendingCbs[k]; pc.t -= dt;
        if (pc.t <= 0) { pendingCbs.splice(k, 1); try { pc.cb(); } catch (e) { if (G.dev) console.warn(e); } }
      }
    } catch (e) { if (G.dev) console.warn('leaves.update', e); }
  }

  function updateRake(dt) {
    if (rk.active && sw.has) {
      const tx = sw.px, tz = sw.pz - 0.10;
      const px = rk.x, pz = rk.z;
      if (rk.fly >= 0) {
        rk.fly += dt;
        const u = clamp(rk.fly / 0.09, 0, 1), e = 1 - (1 - u) * (1 - u);
        rk.x = lerp(rk.fx, tx, e); rk.z = lerp(rk.fz, tz, e);
        if (u >= 1) { rk.fly = -1; rk.vx = sw.vx; rk.vz = sw.vz; }
      } else {
        const w = 42, ex = Math.exp(-w * dt);
        let d = rk.x - tx, tmp = (rk.vx + w * d) * dt;
        rk.x = tx + (d + tmp) * ex; rk.vx = (rk.vx - w * tmp) * ex;
        d = rk.z - tz; tmp = (rk.vz + w * d) * dt;
        rk.z = tz + (d + tmp) * ex; rk.vz = (rk.vz - w * tmp) * ex;
      }
      if (dt > 0) {
        const hvx = (rk.x - px) / dt, hvz = (rk.z - pz) / dt;
        const k = 1 - Math.exp(-25 * dt);
        rk.hvx += (hvx - rk.hvx) * k; rk.hvz += (hvz - rk.hvz) * k;
      }
      rk.hs = Math.hypot(rk.hvx, rk.hvz);
      if (rk.fly >= 0) rk.hs = 0; // no pushing during the fly-in
      if (rk.hs > 0.05) { rk.dirx = rk.hvx / rk.hs; rk.dirz = rk.hvz / rk.hs; }
      // pose: handle toward the player
      const yawT = Math.atan2(-rk.x * 0.85, 2.7 - rk.z) + clamp(rk.hvx * 0.06, -0.2, 0.2);
      if (rk.fly >= 0) rk.yaw = lerpAngle(rk.fyaw, yawT, clamp(rk.fly / 0.09, 0, 1));
      else rk.yaw = dampAngle(rk.yaw, yawT, 14, dt);
      springPitch(SWEEP_PITCH + clamp(-rk.hvz * 0.03, -0.06, 0.08), 20, 0.45, dt);
      springRoll(clamp(rk.hvx * 0.09, -0.22, 0.22), 16, 0.6, dt);
    } else {
      rk.hs = 0; rk.hvx *= Math.exp(-10 * dt); rk.hvz *= Math.exp(-10 * dt);
      springPitch(FLAT_PITCH, 9, 0.55, dt);
      springRoll(0.06, 8, 0.7, dt);
    }
    if (!isFinite(rk.x) || !isFinite(rk.z)) rakeRest();
    poseRake();
  }
  function springPitch(t, w, z, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let k = 0; k < n; k++) { rk.pv += (w * w * (t - rk.pitch) - 2 * z * w * rk.pv) * h; rk.pitch += rk.pv * h; }
    rk.pitch = clamp(rk.pitch, -0.6, 1.3);
  }
  function springRoll(t, w, z, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let k = 0; k < n; k++) { rk.rv += (w * w * (t - rk.roll) - 2 * z * w * rk.rv) * h; rk.roll += rk.rv * h; }
    rk.roll = clamp(rk.roll, -0.8, 0.8);
  }
  function wrapA(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function dampAngle(c, t, l, dt) { return c + wrapA(t - c) * (1 - Math.exp(-l * dt)); }
  function lerpAngle(a, b, u) { return a + wrapA(b - a) * u; }

  function walls(i, dt) {
    let x = lx[i], z = lz[i];
    const ex = (x - ELL.cx) / ELL.rx, ez = (z - ELL.cz) / ELL.rz, e = ex * ex + ez * ez;
    if (e > 0.9) {
      let nx = ex / ELL.rx, nz = ez / ELL.rz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const vn = lvx[i] * nx + lvz[i] * nz;
      if (vn > 0) { const k = Math.min(1, 12 * dt) * (e > 0.97 ? 1 : 0.5); lvx[i] -= nx * vn * k; lvz[i] -= nz * vn * k; }
      const acc = (e - 0.9) * 18 * dt; lvx[i] -= nx * acc; lvz[i] -= nz * acc;
      if (e > 1) { const s = 1 / Math.sqrt(e); x = ELL.cx + (x - ELL.cx) * s; z = ELL.cz + (z - ELL.cz) * s; }
    }
    for (let k = 0; k < 2; k++) {
      const dx = x - shelf[k].x, dz = z - shelf[k].z, d2 = dx * dx + dz * dz;
      if (d2 < SHELF_R * SHELF_R) {
        const d = Math.sqrt(d2) || 1e-3, nx = dx / d, nz = dz / d;
        const push = (SHELF_R - d) * Math.min(1, 14 * dt);
        x += nx * push; z += nz * push;
        const vn = lvx[i] * nx + lvz[i] * nz; if (vn < 0) { lvx[i] -= nx * vn; lvz[i] -= nz * vn; }
        const dd = Math.hypot(x - shelf[k].x, z - shelf[k].z);
        if (dd < 0.26) { x = shelf[k].x + nx * 0.26; z = shelf[k].z + nz * 0.26; }
      }
    }
    if (Math.abs(x) < 0.45 && z > 1.18) { z -= (z - 1.18) * Math.min(1, 12 * dt); if (lvz[i] > 0) lvz[i] *= 0.5; if (z > 1.3) z = 1.3; }
    lx[i] = x; lz[i] = z;
  }

  function updateLoose(dt) {
    const pushing = rk.active && rk.hs > 0.08;
    let moved = 0;
    const hs = rk.hs, dx0 = rk.dirx, dz0 = rk.dirz, px0 = -dz0, pz0 = dx0;
    const fx = rk.x + dx0 * 0.04, fz = rk.z + dz0 * 0.04;
    const kV = 1 - Math.exp(-22 * dt), kB = 1 - Math.exp(-9 * dt), hopP = 1 - Math.exp(-4.5 * dt);
    const gEff = 9.8 * 0.55;
    for (let i = 0; i < LCAP; i++) {
      const m = lmode[i];
      if (m === FREE) continue;
      if (m === REST || m === MOVE) {
        if (pushing) {
          const dx = lx[i] - fx, dz = lz[i] - fz;
          if (dx * dx + dz * dz < 0.2) {
            const a = dx * dx0 + dz * dz0, b = dx * px0 + dz * pz0, ab = Math.abs(b);
            if (a > -0.11 && a < 0.11 && ab < 0.27) {
              const w = ab < 0.2 ? 1 : 1 - (ab - 0.2) / 0.07;
              const r = Math.sqrt(lx[i] * lx[i] + lz[i] * lz[i]) || 1;
              const f = hs * rnd(0.92, 1.12);
              const tvx = dx0 * f + rnd(-0.18, 0.18) * hs - (lx[i] / r) * 0.25 * hs + px0 * Math.sign(b) * 0.06 * hs;
              const tvz = dz0 * f + rnd(-0.18, 0.18) * hs - (lz[i] / r) * 0.25 * hs + pz0 * Math.sign(b) * 0.06 * hs;
              const kk = kV * w;
              lvx[i] += (tvx - lvx[i]) * kk; lvz[i] += (tvz - lvz[i]) * kk;
              if (a < -0.02) { const pull = (-0.02 - a) * 0.5 * w; lx[i] += dx0 * pull; lz[i] += dz0 * pull; }
              if (ly[i] <= lrestY[i] + 0.002 && Math.random() < hopP * w) {
                lvy[i] = 0.12 + hs * 0.33 * Math.random() + (hs > 2 ? (hs - 2) * 0.7 * Math.random() : 0);
                lvy[i] = Math.min(lvy[i], 1.5);
                lpr[i] = rnd(-1, 1) * (3 + hs * 5); lrr[i] = rnd(-1, 1) * (2 + hs * 3);
              }
              lspin[i] += rnd(-1, 1) * hs * 3 * dt * 10;
              lmode[i] = MOVE; moved++;
            } else if (a >= 0.11 && a < 0.3 && ab < 0.3) {
              const want = hs * 0.55 * (1 - (a - 0.11) / 0.19) * (1 - ab / 0.3);
              const cur = lvx[i] * dx0 + lvz[i] * dz0;
              if (cur < want) {
                const add = (want - cur) * kB; lvx[i] += dx0 * add; lvz[i] += dz0 * add;
                const sp = Math.sign(b) * want * 0.25 * kB; lvx[i] += px0 * sp; lvz[i] += pz0 * sp;
                lmode[i] = MOVE;
              }
            }
          }
        }
        if (lmode[i] === REST) continue;
        // ---- free physics
        const ry = lrestY[i];
        if (ly[i] > ry + 0.0015 || lvy[i] > 0) {
          lvy[i] -= gEff * dt; if (lvy[i] < -0.7) lvy[i] = -0.7;
          const dr = Math.exp(-1.4 * dt); lvx[i] *= dr; lvz[i] *= dr;
          const ph = clock * 9 + i * 1.7;
          lvx[i] += Math.sin(ph) * 0.9 * dt; lvz[i] += Math.cos(ph * 0.83) * 0.9 * dt;
          lpit[i] += lpr[i] * dt; lrol[i] += lrr[i] * dt;
          ly[i] += lvy[i] * dt;
          if (ly[i] <= ry) { ly[i] = ry; lvy[i] = lvy[i] < -0.3 ? -lvy[i] * 0.12 : 0; }
        } else {
          ly[i] = ry; lvy[i] = 0;
          const sp = Math.hypot(lvx[i], lvz[i]);
          if (sp > 0) { const ns = Math.max(0, sp * Math.exp(-5.5 * dt) - 0.45 * dt); const f = ns / sp; lvx[i] *= f; lvz[i] *= f; }
          const tp = Math.round((lpit[i] - lrestP[i]) / PI) * PI + lrestP[i];
          const tr = Math.round((lrol[i] - lrestR[i]) / PI) * PI + lrestR[i];
          lpit[i] = damp(lpit[i], tp, 12, dt); lrol[i] = damp(lrol[i], tr, 12, dt);
          lpr[i] *= Math.exp(-8 * dt); lrr[i] *= Math.exp(-8 * dt);
        }
        lyaw[i] += lspin[i] * dt; lspin[i] *= Math.exp(-3 * dt);
        lx[i] += lvx[i] * dt; lz[i] += lvz[i] * dt;
        walls(i, dt);
        if (!isFinite(lx[i]) || !isFinite(lz[i]) || !isFinite(ly[i])) { const s = randomSpot(0.8); placeRest(i, s.x, s.z); continue; }
        if (lx[i] * lx[i] + lz[i] * lz[i] < ABSORB_R * ABSORB_R) { startAbsorb(i, ABSORB, 0, rnd(0.25, 0.4)); continue; }
        if (ly[i] <= ry + 0.0001 && Math.hypot(lvx[i], lvz[i]) < 0.012 && Math.abs(lspin[i]) < 0.05) {
          const tp = Math.round((lpit[i] - lrestP[i]) / PI) * PI + lrestP[i];
          const tr = Math.round((lrol[i] - lrestR[i]) / PI) * PI + lrestR[i];
          if (Math.abs(lpit[i] - tp) < 0.01 && Math.abs(lrol[i] - tr) < 0.01) { lpit[i] = tp; lrol[i] = tr; lvx[i] = lvz[i] = 0; lmode[i] = REST; }
        }
        writeLeaf(i);
      } else if (m === ABSORB || m === GATHER) {
        fT[i] += dt;
        const tt = fT[i] - fDel[i];
        if (tt < 0) { continue; }
        const u = clamp(tt / Math.max(0.05, fDur[i]), 0, 1);
        const slot = fSlot[i];
        // target: slot surface position (the mound may be growing)
        if (slot >= 0) surf(sTh[slot], sT[slot], _a); else _a.set(0, topY, 0);
        _a.y += 0.01;
        const e = m === GATHER ? u * u * (3 - 2 * u) : u;
        const iu = 1 - e;
        // quadratic bezier p0 -> c -> target, plus an extra hop arc
        const cx = fcx[i], cz = fcz[i], cy = Math.max(fcy[i], _a.y + 0.12);
        lx[i] = iu * iu * fx0[i] + 2 * iu * e * cx + e * e * _a.x;
        lz[i] = iu * iu * fz0[i] + 2 * iu * e * cz + e * e * _a.z;
        ly[i] = iu * iu * fy0[i] + 2 * iu * e * cy + e * e * _a.y;
        lpit[i] += lpr[i] * dt; lrol[i] += lrr[i] * dt; lyaw[i] += lspin[i] * dt;
        if (u >= 1) { landAbsorb(i); continue; }
        writeLeaf(i);
      } else if (m === FALL) {
        fT[i] += dt;
        const tt = fT[i] - fDel[i];
        if (tt < 0) continue;
        const u = clamp(tt / Math.max(0.2, fDur[i]), 0, 1);
        const sway = Math.sin(tt * fOm[i] + fPh[i]) * fSw[i] * (1 - 0.85 * u);
        lx[i] = lerp(fx0[i], fLx[i], u) + fSdx[i] * sway;
        lz[i] = lerp(fz0[i], fLz[i], u) + fSdz[i] * sway;
        ly[i] = lerp(fy0[i], lrestY[i], u) + Math.cos(2 * (tt * fOm[i] + fPh[i])) * 0.025 * (1 - u);
        const rock = Math.cos(tt * fOm[i] + fPh[i]) * 0.75 * (1 - 0.6 * u);
        if (lpr[i] !== 0) lpit[i] += lpr[i] * dt * (1 - u); else lpit[i] = rock * fSdx[i];
        lrol[i] = rock * fSdz[i] + Math.sin(tt * 1.3 + fPh[i]) * 0.2 * (1 - u);
        lyaw[i] += lspin[i] * dt;
        if (u >= 1) {
          ly[i] = lrestY[i];
          lvx[i] = fSdx[i] * Math.cos(tt * fOm[i] + fPh[i]) * fSw[i] * fOm[i] * 0.15;
          lvz[i] = fSdz[i] * Math.cos(tt * fOm[i] + fPh[i]) * fSw[i] * fOm[i] * 0.15;
          lvy[i] = 0; lpr[i] = lrr[i] = 0; lmode[i] = MOVE;
          if (patT <= 0 && Math.random() < 0.35) { audio('pat'); patT = 0.12; }
        }
        writeLeaf(i);
      } else if (m === DROPTOP) {
        fT[i] += dt;
        const tt = fT[i];
        const u = clamp(tt / fDur[i], 0, 1);
        const top = topY + 0.012;
        const sway = Math.sin(tt * fOm[i] + fPh[i]) * fSw[i] * (1 - u) * (1 - u * 0.3);
        const ee = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
        lx[i] = lerp(fx0[i], 0, ee) + fSdx[i] * sway;
        lz[i] = lerp(fz0[i], 0, ee) + fSdz[i] * sway;
        ly[i] = lerp(fy0[i], top, 1 - (1 - u) * (1 - u) * 0.25 - (1 - u) * 0.75);
        const rock = Math.cos(tt * fOm[i] + fPh[i]) * 0.6 * (1 - u);
        lpit[i] = rock * fSdx[i]; lrol[i] = rock * fSdz[i]; lyaw[i] += lspin[i] * dt;
        if (u >= 1) {
          const slot = reserveSlot(true);
          landInSlot(i, slot, true);
          const fn = dropCbs[i]; dropCbs[i] = null;
          freeLeaf(i);
          audio('pat');
          if (fn) pendingCbs.push({ t: 0.3, cb: fn }); // tiny bounce, then the callback
          continue;
        }
        writeLeaf(i);
      }
    }
    if (moved > 0) { audio('rustle', clamp(moved * hs * 0.035 + 0.1, 0, 1)); }
    if (pushing && mound.visible && Math.hypot(rk.x, rk.z) < curR * 0.95 && Math.random() < dt * 3) {
      for (let i = 0; i < PCAP; i++) if (sVis[i] && sHopD[i] < 0 && Math.random() < 0.08) { sHopD[i] = 0; sHopV[i] = rnd(0.15, 0.35); }
      audio('rustle', 0.4);
    }
  }

  function updateAcorns(dt) {
    const pushing = rk.active && rk.hs > 0.08;
    for (const a of acorns) {
      if (a.mode === 3) continue;
      if (a.mode === 0 || a.mode === 1) {
        if (pushing) {
          const dx = a.x - (rk.x + rk.dirx * 0.04), dz = a.z - (rk.z + rk.dirz * 0.04);
          const al = dx * rk.dirx + dz * rk.dirz, b = Math.abs(-dx * rk.dirz + dz * rk.dirx);
          if (al > -0.1 && al < 0.12 && b < 0.26) {
            const k = 1 - Math.exp(-20 * dt);
            a.vx += (rk.dirx * rk.hs * 1.1 - a.x * 0.2 * rk.hs - a.vx) * k;
            a.vz += (rk.dirz * rk.hs * 1.1 - a.z * 0.2 * rk.hs - a.vz) * k;
            if (a.mode === 0 && clock - lastRoll > 0.18) { audio('roll'); lastRoll = clock; }
            a.mode = 1;
          }
        }
        if (a.mode === 1) {
          const f = Math.exp(-1.7 * dt); a.vx *= f; a.vz *= f;
          const sp = Math.hypot(a.vx, a.vz);
          // roll about the long axis
          const sx = Math.cos(a.yaw), sz = -Math.sin(a.yaw);
          const vs = a.vx * sx + a.vz * sz;
          a.roll -= (vs / AR) * dt; a.yaw += vs * dt * 2.5 + sp * dt * 0.8;
          a.x += a.vx * dt; a.z += a.vz * dt;
          // walls (reuse ellipse + shelves)
          const ex = (a.x - ELL.cx) / ELL.rx, ez = (a.z - ELL.cz) / ELL.rz, e = ex * ex + ez * ez;
          if (e > 0.95) { const s = Math.sqrt(0.95 / e); a.x = ELL.cx + (a.x - ELL.cx) * s; a.z = ELL.cz + (a.z - ELL.cz) * s; a.vx *= -0.3; a.vz *= -0.3; }
          for (let k = 0; k < 2; k++) {
            const dx = a.x - shelf[k].x, dz = a.z - shelf[k].z, d = Math.hypot(dx, dz);
            if (d < SHELF_R && d > 1e-4) { a.x = shelf[k].x + dx / d * SHELF_R; a.z = shelf[k].z + dz / d * SHELF_R; a.vx *= 0.3; a.vz *= 0.3; }
          }
          if (sp < 0.01) { a.mode = 0; a.vx = a.vz = 0; }
          if (a.x * a.x + a.z * a.z < ABSORB_R * ABSORB_R) hopAcornIn(a);
          if (!isFinite(a.x) || !isFinite(a.z)) { const s = randomSpot(0.9); placeAcorn(a, s.x, s.z); }
          poseAcorn(a);
        }
      } else if (a.mode === 2 || a.mode === 4) {
        a.t += dt;
        a.vy -= 9.8 * dt;
        a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
        a.roll += (a.spin || 12) * dt; a.yaw += 3 * dt;
        if (a.mode === 2) {
          if (a.t >= a.hopEnd) { a.mode = 3; a.root.visible = false; acornsInPile++; rustleLight(); }
        } else if (a.y <= AR && a.vy < 0) {
          a.y = AR;
          if (a.vy < -0.8) { a.vy = -a.vy * 0.3; a.vx *= 0.5; a.vz *= 0.5; if (clock - lastRoll > 0.1) { audio('roll'); lastRoll = clock; } }
          else { a.vy = 0; a.mode = 1; a.spin = 0; }
        }
        poseAcorn(a);
      }
    }
  }
  function rustleLight() { for (let i = 0; i < PCAP; i++) if (sVis[i] && Math.random() < 0.15) { sHopD[i] = rnd(0, 0.1); sHopV[i] = rnd(0.1, 0.25); } }

  function updatePile(dt) {
    const target = total > 0 ? clamp(landed / total, 0, 1) : 0;
    fd = damp(fd, target, 6, dt);
    if (Math.abs(fd - target) < 1e-4) fd = target;
    swell = damp(swell, 0, 6, dt); if (swell < 1e-3) swell = 0;
    // squash spring
    squashV += (-120 * squash - 9 * squashV) * dt; squash += squashV * dt;
    if (Math.abs(squash) < 1e-4 && Math.abs(squashV) < 1e-3) { squash = 0; squashV = 0; }
    squash = clamp(squash, -1.5, 1.5);
    // hops
    let hopping = false;
    for (let i = 0; i < PCAP; i++) {
      if (sHopD[i] < 0) continue;
      if (sHopD[i] > 0) { sHopD[i] = Math.max(0, sHopD[i] - dt); if (sHopD[i] > 0) { hopping = true; continue; } if (sHopV[i] <= 0) sHopV[i] = 0.2; }
      sHopV[i] -= 9.8 * dt; sHopY[i] += sHopV[i] * dt;
      if (sHopY[i] <= 0 && sHopV[i] < 0) {
        sHopY[i] = 0;
        if (sHopV[i] < -0.6) { sHopV[i] = -sHopV[i] * 0.25; } else { sHopV[i] = 0; sHopD[i] = -1; sYaw[i] += rnd(-0.2, 0.2); }
      }
      hopping = true;
    }
    computeShape();
    const sig = curR * 1000 + curH * 37 + bkShape * 3 + (mound.visible ? 1 : 0);
    if (Math.abs(sig - shapeSig) > 1e-6) { shapeSig = sig; rebuildMound(); pileDirty = true; }
    mound.visible = landed > 0 || burnK > 0;
    if (pileDirty || hopping) { seatAll(); pileDirty = false; }
  }

  // ---------------------------------------------------------------- misc API
  const _sphere = new THREE.Sphere(new THREE.Vector3(), 0.7);
  function pileHit(ray) {
    try {
      if (!ray || !ray.origin || !ray.direction) return false;
      _sphere.center.set(0, Math.max(0.05, topY * 0.5), 0); _sphere.radius = 0.7;
      return ray.intersectsSphere(_sphere);
    } catch (e) { return false; }
  }
  function hintPath() {
    try {
      let best = -1, bestN = -1;
      const idx = [];
      for (let i = 0; i < LCAP; i++) if (lmode[i] === REST || lmode[i] === MOVE) idx.push(i);
      if (idx.length) {
        const step = Math.max(1, Math.floor(idx.length / 70));
        for (let a = 0; a < idx.length; a += step) {
          const i = idx[a]; let n = 0;
          for (let b = 0; b < idx.length; b++) { const j = idx[b]; const dx = lx[j] - lx[i], dz = lz[j] - lz[i]; if (dx * dx + dz * dz < 0.0625) n++; }
          if (n > bestN) { bestN = n; best = i; }
        }
      }
      let from;
      if (best >= 0) {
        // centre of that cluster
        let sx = 0, sz = 0, c = 0;
        for (const j of idx) { const dx = lx[j] - lx[best], dz = lz[j] - lz[best]; if (dx * dx + dz * dz < 0.0625) { sx += lx[j]; sz += lz[j]; c++; } }
        from = new THREE.Vector3(sx / c, 0, sz / c);
      } else from = new THREE.Vector3(0, 0, 1.0);
      const r = Math.hypot(from.x, from.z) || 1;
      const to = new THREE.Vector3(from.x / r * 0.3, 0, from.z / r * 0.3);
      return [from, to];
    } catch (e) { return [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0)]; }
  }
  function getState() {
    return {
      v: 1, total, fraction: total > 0 ? clamp(absorbed / total, 0, 1) : 0, burn: burnK, ember: emberK,
      acornsInPile, absorbedTotal,
    };
  }
  function setState(s) {
    try {
      if (!s || typeof s !== 'object') return;
      readAnchors();
      clearFlights();
      total = clamp(Math.round(fin(s.total, total)), 1, LCAP + PCAP);
      const f = clamp(fin(s.fraction, 0.1), 0, 1);
      absorbed = landed = Math.round(total * f);
      absorbedTotal = Math.max(absorbedTotal, Math.round(fin(s.absorbedTotal, 0)));
      burnK = clamp(fin(s.burn), 0, 1); moundU.uBurn.value = burnK;
      emberK = clamp(fin(s.ember), 0, 1); moundU.uEmber.value = emberK;
      scatter(Math.min(LCAP, total - absorbed));
      fillPile(absorbed);
      restoreAcornsInPile(clamp(Math.round(fin(s.acornsInPile)), 0, ACN));
      rakeRest();
      snapShape();
      poseRake();
      loose.instanceMatrix.needsUpdate = true;
      lCellA.needsUpdate = lTintA.needsUpdate = lCurlA.needsUpdate = true;
    } catch (e) { if (G.dev) console.warn('leaves.setState', e); }
  }

  // ---------------------------------------------------------------- build helpers (rake, acorns)
  function buildRake() {
    const P = [], N = [], UV = [], C = [], I = [];
    const col = new THREE.Color();
    const srgb = (r, g, b) => { col.setRGB(r, g, b, THREE.SRGBColorSpace); return col; };
    const T = new THREE.Vector3(), S = new THREE.Vector3(), Nn = new THREE.Vector3(), O = new THREE.Vector3(), NV = new THREE.Vector3();
    // sweep an elliptic cross-section along pts. sideRef: Vector3 roughly perpendicular to the path.
    function tube(pts, sideRef, ra, rb, seg, colorFn, vLen) {
      const base = P.length / 3;
      let acc = 0;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        const p0 = pts[Math.max(0, k - 1)], p1 = pts[Math.min(pts.length - 1, k + 1)];
        T.subVectors(p1, p0).normalize();
        if (k > 0) acc += p.distanceTo(pts[k - 1]);
        S.copy(sideRef).addScaledVector(T, -sideRef.dot(T)).normalize();
        Nn.crossVectors(T, S).normalize();
        const a = ra(k, pts.length), b = rb(k, pts.length);
        const c = colorFn(k, pts.length, acc);
        for (let j = 0; j <= seg; j++) {
          const ph = (j / seg) * TAU, cs = Math.cos(ph), sn = Math.sin(ph);
          O.copy(p).addScaledVector(S, cs * a).addScaledVector(Nn, sn * b);
          NV.copy(S).multiplyScalar(cs * Math.max(b, 1e-5)).addScaledVector(Nn, sn * Math.max(a, 1e-5)).normalize();
          P.push(O.x, O.y, O.z); N.push(NV.x, NV.y, NV.z); UV.push(j / seg, acc / vLen); C.push(c.r, c.g, c.b);
        }
      }
      for (let k = 0; k < pts.length - 1; k++) for (let j = 0; j < seg; j++) {
        const a = base + k * (seg + 1) + j, b = a + 1, c2 = a + seg + 1, d = c2 + 1;
        I.push(a, c2, b, b, c2, d);
      }
    }
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const keys = [];
    // pole: along +Z from the binding to 1.5 m
    const POLE_L = 1.5, PR = 0.013;
    const polePts = [];
    const nodes = []; for (let z = 0.17; z < POLE_L - 0.05; z += rnd(0.23, 0.27)) nodes.push(z);
    for (let z = -0.035; z <= POLE_L; z += 0.012) polePts.push(V(0, 0, Math.min(z, POLE_L)));
    polePts.push(V(0, 0, POLE_L + 0.0005));
    const nodeD = (z) => { let m = 1; for (const n of nodes) m = Math.min(m, Math.abs(z - n)); return m; };
    tube(polePts, V(1, 0, 0),
      (k, n) => (k === n - 1 ? 0 : PR * (1 - 0.06 * (polePts[k].z / POLE_L)) + (nodeD(polePts[k].z) < 0.006 ? 0.0011 : 0)),
      (k, n) => (k === n - 1 ? 0 : PR * (1 - 0.06 * (polePts[k].z / POLE_L)) + (nodeD(polePts[k].z) < 0.006 ? 0.0011 : 0)),
      12,
      (k) => { const z = polePts[k].z, d = nodeD(z); const v = 1 + 0.05 * Math.sin(z * 7.3); if (d < 0.004) return srgb(0.47, 0.35, 0.2); if (d < 0.012) return srgb(0.66 * v, 0.53 * v, 0.32 * v); return srgb(0.80 * v, 0.68 * v, 0.44 * v); },
      0.35);
    // binding: dark wire coil around the pole end
    const bindPts = []; for (let z = -0.03; z <= 0.07; z += 0.0015) bindPts.push(V(0, 0, z));
    tube(bindPts, V(1, 0, 0), (k) => 0.0148 + 0.0007 * Math.abs(Math.sin(k * 1.9)), (k) => 0.0148 + 0.0007 * Math.abs(Math.sin(k * 1.9)), 12,
      () => srgb(0.16, 0.15, 0.14), 0.1);
    // fan of tines
    const NT = 17, BETA = 0.30, LS = 0.37, RC = 0.034, PHI = 0.53;
    const nf = V(0, Math.cos(BETA), Math.sin(BETA));
    const tb = V(0, 0, 0.05);
    let tipMid = null;
    for (let t = 0; t < NT; t++) {
      const phi = -PHI + (2 * PHI * t) / (NT - 1) + rnd(-0.008, 0.008);
      const dir = V(Math.sin(phi), Math.cos(phi) * Math.sin(BETA), -Math.cos(phi) * Math.cos(BETA)).normalize();
      const side = new THREE.Vector3().crossVectors(nf, dir).normalize();
      const L = LS + rnd(-0.008, 0.008) - Math.abs(phi) * 0.02;
      const pts = [];
      const nS = 12;
      for (let k = 0; k <= nS; k++) { const s = (k / nS) * (L + 0.05); pts.push(tb.clone().addScaledVector(dir, s).addScaledVector(nf, -0.004 * Math.sin(PI * k / nS))); }
      const end = pts[pts.length - 1].clone();
      const cen = end.clone().addScaledVector(nf, -RC);
      const nC = 8, A = 1.45;
      for (let k = 1; k <= nC; k++) { const al = (k / nC) * A; pts.push(cen.clone().addScaledVector(nf, RC * Math.cos(al)).addScaledVector(dir, RC * Math.sin(al))); }
      const tan = dir.clone().multiplyScalar(Math.cos(A)).addScaledVector(nf, -Math.sin(A));
      pts.push(pts[pts.length - 1].clone().addScaledVector(tan, 0.012));
      const v = 1 + rnd(-0.07, 0.07);
      const nAll = pts.length;
      tube(pts, side, (k) => 0.0024 + 0.001 * (k / nAll), () => 0.00085, 6,
        (k, n) => (k > n - 4 ? srgb(0.5 * v, 0.4 * v, 0.27 * v) : srgb(0.82 * v, 0.68 * v, 0.43 * v)), 0.35);
      const tip = pts[pts.length - 1];
      if (t === 0 || t === NT - 1 || t === (NT >> 1)) keys.push(tip.clone());
      if (t === (NT >> 1)) tipMid = tip.clone();
      if (t === 0 || t === NT - 1) keys.push(end.clone().addScaledVector(nf, -0.001));
    }
    // cross brace
    const bracePts = [];
    const SB = 0.2;
    for (let k = 0; k <= 24; k++) {
      const phi = -PHI - 0.02 + ((2 * PHI + 0.04) * k) / 24;
      const dir = V(Math.sin(phi), Math.cos(phi) * Math.sin(BETA), -Math.cos(phi) * Math.cos(BETA));
      bracePts.push(tb.clone().addScaledVector(dir, SB).addScaledVector(nf, 0.0034));
    }
    tube(bracePts, nf, () => 0.0028, () => 0.0028, 8, () => srgb(0.68, 0.55, 0.34), 0.35);
    // wire ties at crossings
    for (let t = 0; t < NT; t += 2) {
      const phi = -PHI + (2 * PHI * t) / (NT - 1);
      const dir = V(Math.sin(phi), Math.cos(phi) * Math.sin(BETA), -Math.cos(phi) * Math.cos(BETA));
      const c = tb.clone().addScaledVector(dir, SB).addScaledVector(nf, 0.002);
      const tg = new THREE.Vector3().crossVectors(nf, dir).normalize();
      tube([c.clone().addScaledVector(tg, -0.003), c.clone().addScaledVector(tg, 0.003)], nf, () => 0.0042, () => 0.0042, 6, () => srgb(0.18, 0.17, 0.16), 0.1);
    }
    keys.push(V(0, -PR, -0.02));       // binding underside
    keys.push(V(0, -PR, 0.7));         // pole middle
    const end = V(0, -PR, POLE_L);
    keys.push(end.clone());           // pole end (must stay last)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I);
    geo.computeBoundingSphere();
    let map = null;
    try {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#ececec'; cx.fillRect(0, 0, 64, 256);
      for (let k = 0; k < 90; k++) {
        const x = Math.random() * 64, w = rnd(0.5, 2), l = Math.random() < 0.5;
        cx.fillStyle = l ? `rgba(255,250,235,${rnd(0.08, 0.25)})` : `rgba(120,95,60,${rnd(0.05, 0.2)})`;
        cx.fillRect(x, 0, w, 256);
      }
      for (let k = 0; k < 40; k++) { cx.fillStyle = `rgba(90,70,40,${rnd(0.05, 0.15)})`; cx.fillRect(Math.random() * 64, Math.random() * 256, rnd(1, 3), rnd(4, 30)); }
      map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
    } catch (e) { map = null; }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.5, metalness: 0 });
    return { geo, mat, tip: tipMid || V(0, -0.05, -0.4), keys, end };
  }

  function buildAcornGeos() {
    const prof = [[0, 0], [0.0009, 0.0004], [0.0024, 0.0017], [0.0046, 0.0045], [0.0064, 0.0085], [0.0075, 0.0125], [0.0079, 0.016], [0.0077, 0.019], [0.0068, 0.0212], [0.0045, 0.0226], [0, 0.023]];
    const nut = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), 18);
    {
      const pos = nut.attributes.position, cols = [];
      const cA = new THREE.Color(), cB = new THREE.Color();
      cA.setRGB(0.36, 0.21, 0.09, THREE.SRGBColorSpace); cB.setRGB(0.62, 0.48, 0.26, THREE.SRGBColorSpace);
      const tip = new THREE.Color(); tip.setRGB(0.2, 0.13, 0.07, THREE.SRGBColorSpace);
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k);
        const c = cA.clone().lerp(cB, smooth(0.0165, 0.0205, y));
        if (y < 0.0012) c.lerp(tip, 0.7);
        const st = 1 + 0.06 * Math.sin(Math.atan2(pos.getZ(k), pos.getX(k)) * 9);
        cols.push(c.r * st, c.g * st, c.b * st);
      }
      nut.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    }
    const cprof = [[0.0081, 0.0158], [0.0089, 0.0172], [0.0093, 0.0195], [0.0088, 0.0222], [0.0068, 0.0243], [0.0035, 0.0254], [0.0011, 0.0258], [0.001, 0.0282], [0.0006, 0.0288], [0, 0.0289]];
    const cap = new THREE.LatheGeometry(cprof.map((p) => new THREE.Vector2(p[0], p[1])), 22);
    {
      const pos = cap.attributes.position, cols = [];
      const c0 = new THREE.Color(); c0.setRGB(0.36, 0.28, 0.18, THREE.SRGBColorSpace);
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const r = Math.hypot(x, z);
        if (r > 0.0015 && y < 0.0255) { const s = 1 + rnd(-0.05, 0.07); pos.setX(k, x * s); pos.setZ(k, z * s); }
        const v = rnd(0.7, 1.15);
        cols.push(c0.r * v, c0.g * v, c0.b * v);
      }
      cap.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      cap.computeVertexNormals();
    }
    return { nut, cap };
  }

  // ---------------------------------------------------------------- init
  reset({});
  poseRake();

  const api = {
    reset, sweep, update,
    rake: {
      object3D: rakeRoot,
      setAttention(k) { rk.attn = clamp(fin(k), 0, 1); },
    },
    get pileFraction() { return total > 0 ? clamp(absorbed / total, 0, 1) : 0; },
    get looseCount() { let n = 0; for (let i = 0; i < LCAP; i++) { const m = lmode[i]; if (m === REST || m === MOVE || m === FALL) n++; } return n; },
    get absorbedTotal() { return absorbedTotal; },
    gatherAll, dropLeaves, dropLeafOnPile, rustlePile,
    pile: {
      get topY() { return mound.visible ? topY : 0; },
      get radius() { return curR; },
    },
    pileHit, setBurn, setEmber,
    get acornsInPile() { return acornsInPile; },
    popAcorn, hintPath, getState, setState,
  };
  return api;
}
