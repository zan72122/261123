// WORLD — garden, light, tree, stone ring, zaru tray, potato basket, time of day.
import * as THREE from 'three';

// ---------- small deterministic helpers ----------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D value noise (seeded lattice hash), output -1..1
function makeNoise3(seed) {
  const p = new Uint8Array(512);
  const r = mulberry(seed);
  const perm = [];
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = r() * 2 - 1;
  const h = (x, y, z) => val[p[p[p[x & 255] + (y & 255)] + (z & 255)]];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf),
      zf);
  };
}

// smooth vertex normals that ignore uv seams (groups vertices by quantised position)
function smoothNormals(geo) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const idx = geo.index ? geo.index.array : null;
  const key = new Int32Array(n);
  const map = new Map();
  let groups = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 2e4) + '_' + Math.round(pos.getY(i) * 2e4) + '_' + Math.round(pos.getZ(i) * 2e4);
    let g = map.get(k);
    if (g === undefined) { g = groups++; map.set(k, g); }
    key[i] = g;
  }
  const acc = new Float32Array(groups * 3);
  const tri = idx ? idx.length / 3 : n / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    c.sub(b); a.sub(b); c.cross(a); // area weighted face normal
    for (const i of [i0, i1, i2]) { const g = key[i] * 3; acc[g] += c.x; acc[g + 1] += c.y; acc[g + 2] += c.z; }
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = key[i] * 3;
    const l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    nor[i * 3] = acc[g] / l; nor[i * 3 + 1] = acc[g + 1] / l; nor[i * 3 + 2] = acc[g + 2] / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

// merge simple indexed/non-indexed geometries with the same attributes (position, normal, uv, color)
function mergeGeos(list) {
  const names = ['position', 'normal', 'uv', 'color'].filter((nm) => list.every((g) => g.attributes[nm]));
  let vcount = 0, icount = 0;
  for (const g of list) { vcount += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  const arrs = {};
  for (const nm of names) arrs[nm] = new Float32Array(vcount * list[0].attributes[nm].itemSize);
  const index = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    for (const nm of names) { const at = g.attributes[nm]; arrs[nm].set(at.array.subarray(0, c * at.itemSize), vo * at.itemSize); }
    if (g.index) { for (let i = 0; i < g.index.count; i++) index[io++] = g.index.array[i] + vo; }
    else { for (let i = 0; i < c; i++) index[io++] = i + vo; }
    vo += c;
  }
  for (const nm of names) out.setAttribute(nm, new THREE.BufferAttribute(arrs[nm], list[0].attributes[nm].itemSize));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function create(G) {
  const scene = G.scene;
  const U = G.util || {};
  const tex = G.tex || {};
  const normalFrom = (t, s) => { try { return t && U.normalFrom ? U.normalFrom(t, s) : null; } catch (e) { return null; } };
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---------------------------------------------------------------- anchors
  const anchors = {
    pile: new THREE.Vector3(0, 0, 0),
    zaru: new THREE.Vector3(-0.62, 0, 1.22),
    basket: new THREE.Vector3(0.62, 0, 1.22),
    treeBase: new THREE.Vector3(-1.55, 0, -2.30),
    uchiwaRest: new THREE.Vector3(-0.14, 0, 1.45),
    tongsRest: new THREE.Vector3(0.08, 0, 1.40),
    lighterRest: new THREE.Vector3(0.26, 0, 1.40),
    canopy: { center: new THREE.Vector3(-0.3, 3.3, -0.5), rx: 1.7, rz: 1.4 },
  };

  // ---------------------------------------------------------------- time-of-day keys (0, 0.5, 1)
  const KEYS = {
    elev: [47, 27, 13],
    az: [0, -6, -12], // degrees rotation of the sun's compass direction (toward −X / west)
    sunCol: [[1.0, 0.92, 0.80], [1.0, 0.76, 0.50], [1.0, 0.60, 0.42]],
    sunI: [3.4, 3.0, 2.3],
    skyCol: [[0.66, 0.76, 0.95], [0.62, 0.64, 0.82], [0.62, 0.55, 0.72]],
    gndCol: [[0.62, 0.50, 0.36], [0.62, 0.46, 0.32], [0.64, 0.42, 0.30]],
    hemiI: [1.25, 1.12, 1.15],
    envI: [0.65, 0.55, 0.5],
    bg: [[0.74, 0.80, 0.86], [0.86, 0.76, 0.62], [0.88, 0.62, 0.50]],
    fog: [[0.58, 0.55, 0.46], [0.62, 0.52, 0.40], [0.62, 0.46, 0.38]],
    wall: [[0.98, 0.97, 0.94], [0.98, 0.84, 0.66], [0.88, 0.66, 0.54]],
  };
  const tmpC = new THREE.Color();
  function keyNum(arr, k) { return k < 0.5 ? lerp(arr[0], arr[1], k * 2) : lerp(arr[1], arr[2], (k - 0.5) * 2); }
  function keyCol(arr, k, out) {
    const a = k < 0.5 ? arr[0] : arr[1], b = k < 0.5 ? arr[1] : arr[2], t = k < 0.5 ? k * 2 : (k - 0.5) * 2;
    return out.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
  }

  // ---------------------------------------------------------------- sky, fog
  scene.background = new THREE.Color().setRGB(...KEYS.bg[0]);
  scene.fog = new THREE.Fog(new THREE.Color().setRGB(...KEYS.fog[0]), 6.5, 30);

  // ---------------------------------------------------------------- lights
  const sunDir = new THREE.Vector3(-0.55, 0.70, -0.30).normalize();
  const sunAz0 = Math.atan2(sunDir.z, sunDir.x);
  const sun = new THREE.DirectionalLight(0xffffff, KEYS.sunI[0]);
  sun.color.setRGB(...KEYS.sunCol[0]);
  const shadowCenter = new THREE.Vector3(0, 0, -0.45);
  sun.target.position.copy(shadowCenter);
  root.add(sun, sun.target);
  sun.castShadow = !!(G.quality && G.quality.shadows !== false);
  let shadowSize = G.quality && G.quality.low ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, KEYS.hemiI[0]);
  hemi.color.setRGB(...KEYS.skyCol[0]);
  hemi.groundColor.setRGB(...KEYS.gndCol[0]);
  root.add(hemi);

  // fit the ortho shadow camera around the receiver box in light space
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _c = new THREE.Vector3();
  const BOX = [-3.0, 3.0, 0, 4.6, -3.5, 2.6];
  function fitShadow() {
    sun.position.copy(shadowCenter).addScaledVector(sunDir, 14);
    sun.target.position.copy(shadowCenter);
    sun.target.updateMatrixWorld();
    _right.set(0, 1, 0).cross(sunDir).normalize();
    _up.copy(sunDir).cross(_right).normalize();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, d0 = 1e9, d1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _c.set(BOX[i & 1], (i & 2) ? BOX[3] : BOX[2], (i & 4) ? BOX[5] : BOX[4]);
      _c.sub(sun.position);
      const x = _c.dot(_right), y = _c.dot(_up), d = -_c.dot(sunDir);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
    }
    const cam = sun.shadow.camera;
    cam.left = x0 - 0.1; cam.right = x1 + 0.1; cam.bottom = y0 - 0.1; cam.top = y1 + 0.1;
    cam.near = Math.max(0.1, d0 - 4); cam.far = d1 + 1;
    cam.updateProjectionMatrix();
  }
  fitShadow();

  // procedural environment (PMREM of a small sky scene)
  try {
    const envScene = new THREE.Scene();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunD: { value: sunDir.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 sunD;
        void main(){ vec3 d = normalize(vP); float h = d.y;
          vec3 zen = vec3(0.30,0.45,0.85), hor = vec3(1.05,0.95,0.82), gnd = vec3(0.26,0.20,0.14);
          vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor*0.55, gnd, pow(-h, 0.4));
          float s = max(dot(d, sunD), 0.0);
          c += vec3(1.0,0.85,0.6) * (pow(s, 8.0)*0.6 + pow(s, 900.0)*60.0);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
    // a warm "fence/foliage" band low around the horizon behind
    const pm = new THREE.PMREMGenerator(G.renderer);
    const rt = pm.fromScene(envScene, 0.02, 0.1, 50);
    scene.environment = rt.texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = KEYS.envI[0];
    pm.dispose();
    skyMat.dispose();
  } catch (e) { /* environment is optional */ }

  // ---------------------------------------------------------------- ground
  const noiseTex = U.noiseTex || null;
  const GROUND_SIZE = 22;
  let groundMat;
  {
    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    let map = null, nmap = null;
    if (tex.ground) {
      map = tex.ground.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(GROUND_SIZE / 1.5, GROUND_SIZE / 1.5);
      map.needsUpdate = true;
      nmap = normalFrom(map, 2.2);
    }
    groundMat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, roughness: 0.95, metalness: 0, color: 0xffffff });
    if (nmap) groundMat.normalScale.set(0.9, 0.9);
    const gU = { uNoise: { value: noiseTex }, uHasNoise: { value: noiseTex ? 1 : 0 } };
    groundMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, gU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ; uniform sampler2D uNoise; uniform float uHasNoise;')
        .replace('#include <map_fragment>', `
          float gn1 = 0.5, gn2 = 0.5, gn3 = 0.5;
          if (uHasNoise > 0.5) {
            gn1 = texture2D(uNoise, vWXZ * 0.031 + vec2(0.13, 0.71)).r;
            gn2 = texture2D(uNoise, vWXZ * 0.11 + vec2(0.57, 0.21)).r;
            gn3 = texture2D(uNoise, vWXZ * 0.35 + vec2(0.33, 0.92)).r;
          }
          #ifdef USE_MAP
            vec4 gA = texture2D(map, vMapUv);
            vec2 ruv = mat2(0.80, -0.60, 0.60, 0.80) * vMapUv * 0.73 + vec2(0.37, 0.19);
            vec4 gB = texture2D(map, ruv);
            vec4 sampledDiffuseColor = mix(gA, gB, smoothstep(0.38, 0.62, gn2 * 0.7 + gn3 * 0.3));
            diffuseColor *= sampledDiffuseColor;
          #endif
          // large-scale tint / moisture variation
          float gv = gn1 * 0.65 + gn2 * 0.35;
          diffuseColor.rgb *= mix(vec3(0.70, 0.68, 0.66), vec3(1.12, 1.07, 1.0), gv);
          // scorched bare soil inside the stone ring
          float gr = length(vWXZ) + (gn3 - 0.5) * 0.16 + (gn2 - 0.5) * 0.10;
          float sc = 1.0 - smoothstep(0.40, 0.76, gr);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.50, 0.46, 0.43), sc * 0.85);
          // slightly darker damp soil hugging the stones
          float ring = exp(-pow((length(vWXZ) - 0.80) / 0.13, 2.0));
          diffuseColor.rgb *= 1.0 - ring * 0.18;
          // packed earth around the tree base
          float tb = exp(-pow(length(vWXZ - vec2(-1.55, -2.30)) / 0.9, 2.0));
          diffuseColor.rgb *= 1.0 - tb * 0.15;
        `);
    };
    groundMat.customProgramCacheKey = () => 'world-ground-v1';
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    root.add(ground);
  }

  // leaf-litter patches (soft-edged) under the tree and along the far garden edge
  {
    const rnd = mulberry(77);
    const patches = [
      [-1.55, -2.30, 2.3], [-2.6, -2.9, 2.0], [-0.4, -3.4, 1.8],
      [-4.5, -6.6, 3.0], [-1.6, -7.3, 2.6], [1.6, -7.2, 2.8], [4.6, -6.4, 3.0], [-6.4, -4.4, 2.6], [6.4, -4.2, 2.6],
      [3.1, -3.4, 1.6], [-3.6, 0.6, 1.8], [3.7, 0.9, 1.7],
    ];
    const geos = [];
    for (const [x, z, s] of patches) {
      const g = new THREE.PlaneGeometry(s, s * (0.7 + rnd() * 0.3), 1, 1);
      g.rotateX(-Math.PI / 2);
      g.rotateY(rnd() * Math.PI);
      g.translate(x, 0.003 + rnd() * 0.002, z);
      // uv2-ish trick: map repeat comes from a scaled copy; keep uv 0..1 for the soft alpha
      geos.push(g);
    }
    const geo = mergeGeos(geos.map((g) => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }));
    if (tex.leaflitter && U.softDot) {
      const map = tex.leaflitter.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(2.2, 2.2);
      map.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({
        map, alphaMap: U.softDot, transparent: true, depthWrite: false, roughness: 0.9, metalness: 0,
        color: new THREE.Color(0.82, 0.78, 0.72), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.renderOrder = -1;
      root.add(m);
    }
  }

  // sparse scattered single leaves far outside the play area
  if (tex.leaves) {
    const N = 56;
    const rnd = mulberry(4242);
    const g = new THREE.PlaneGeometry(1, 1, 2, 2);
    g.rotateX(-Math.PI / 2);
    { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, (x * x + z * z) * 0.10); } g.computeVertexNormals(); }
    const cell = new Float32Array(N * 2);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
    const mat = new THREE.MeshStandardMaterial({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uv * vec2(1.0/3.0, 0.5) + aCell;\n#endif');
    };
    mat.customProgramCacheKey = () => 'world-litter-v1';
    const im = new THREE.InstancedMesh(g, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0, guard = 0;
    while (n < N && guard++ < 5000) {
      // biased toward the back and the tree
      let x, z;
      if (rnd() < 0.35) { const a = rnd() * Math.PI * 2, r = 0.5 + rnd() * 1.8; x = -1.55 + Math.cos(a) * r; z = -2.3 + Math.sin(a) * r; }
      else { x = (rnd() * 2 - 1) * 6; z = -7.5 + rnd() * 9.5; }
      const ex = x / 1.30, ez = (z - 0.05) / 1.45;
      if (ex * ex + ez * ez < 1.45) continue; // keep the play area clear
      if (Math.hypot(x, z) < 2.0) continue;
      if (Math.hypot(x + 1.55, z + 2.3) < 0.62) continue; // not inside the trunk
      if (Math.hypot(x, z) > 8.0) continue;
      const sz = 0.11 + rnd() * 0.06;
      e.set((rnd() - 0.5) * 0.25, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25);
      q.setFromEuler(e);
      v.set(x, 0.006 + rnd() * 0.004, z);
      s.set(sz, sz, sz);
      m4.compose(v, q, s);
      im.setMatrixAt(n, m4);
      const c = Math.floor(rnd() * 6);
      cell[n * 2] = (c % 3) / 3; cell[n * 2 + 1] = c < 3 ? 0.5 : 0;
      const b = 0.72 + rnd() * 0.22;
      im.setColorAt(n, col.setRGB(b, b * (0.92 + rnd() * 0.08), b * (0.85 + rnd() * 0.1)));
      n++;
    }
    im.count = n;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
  }

  // ---------------------------------------------------------------- backdrop
  let backdropMat = null;
  {
    const R = 8.5, SPAN = THREE.MathUtils.degToRad(172), H = 4.25, Y0 = -0.12;
    const geo = new THREE.CylinderGeometry(R, R, H, 72, 6, true, Math.PI - SPAN / 2, SPAN);
    geo.translate(0, Y0 + H / 2, 0);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const arc = R * SPAN;
    const tileW = 8.1; // metres per photo width (fence ≈ 1.8 m)
    const uSpan = arc / tileW;
    const V0 = 0.104; // crop the gravel band off the bottom of the photo
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, 0.5 + (0.5 - u) * uSpan, V0 + ((y - Y0) / H) * (1 - V0));
    }
    let map = null;
    if (tex.backdrop) {
      map = tex.backdrop.clone();
      map.wrapS = THREE.MirroredRepeatWrapping;
      map.wrapT = THREE.ClampToEdgeWrapping;
      map.needsUpdate = true;
    }
    backdropMat = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, toneMapped: false, color: new THREE.Color().setRGB(...KEYS.wall[0]) });
    const bU = { uHaze: { value: new THREE.Color().setRGB(...KEYS.fog[0]) }, uHazeAll: { value: 0.10 }, uHazeBot: { value: 0.55 } };
    backdropMat.userData.u = bU;
    backdropMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, bU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed,1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY; uniform vec3 uHaze; uniform float uHazeAll; uniform float uHazeBot;')
        .replace('#include <opaque_fragment>', `
          float hz = uHazeAll + (1.0 - smoothstep(-0.05, 0.75, vWY)) * uHazeBot;
          outgoingLight = mix(outgoingLight, uHaze, clamp(hz, 0.0, 1.0));
          #include <opaque_fragment>`);
    };
    backdropMat.customProgramCacheKey = () => 'world-backdrop-v1';
    const wall = new THREE.Mesh(geo, backdropMat);
    wall.name = 'backdrop';
    wall.renderOrder = -2;
    root.add(wall);
  }

  // ---------------------------------------------------------------- tree trunk (+ limbs, merged)
  const TRUNK = { x: -1.55, z: -2.30 };
  const trunkAxis = (y, out) => out.set(TRUNK.x + 0.035 * y + 0.0035 * y * y, y, TRUNK.z + 0.018 * y - 0.001 * y * y);
  const trunkGroup = new THREE.Group();
  trunkGroup.position.set(TRUNK.x, 0, TRUNK.z);
  root.add(trunkGroup);
  const limbs = [
    { y: 2.35, dir: [0.80, 0.42, 0.55], len: 1.35, r0: 0.105, r1: 0.04 },
    { y: 2.95, dir: [0.42, 0.40, 0.85], len: 1.20, r0: 0.09, r1: 0.035 },
    { y: 3.45, dir: [0.92, 0.55, 0.05], len: 1.25, r0: 0.085, r1: 0.03 },
    { y: 3.10, dir: [-0.55, 0.45, 0.65], len: 1.0, r0: 0.08, r1: 0.03 },
  ];
  for (const l of limbs) { const d = new THREE.Vector3(...l.dir).normalize(); l.d = d; l.p0 = trunkAxis(l.y, new THREE.Vector3()); l.p1 = l.p0.clone().addScaledVector(d, l.len); }
  {
    const nz = makeNoise3(9);
    const RS = 40, HS = 64, HT = 7.4, YB = -0.22;
    const geo = new THREE.CylinderGeometry(1, 1, HT, RS, HS, true);
    geo.translate(0, HT / 2 + YB, 0);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const roots = [0.3, 1.5, 2.6, 3.7, 4.9, 5.7];
    const rootA = [0.36, 0.28, 0.40, 0.22, 0.33, 0.25];
    const ax = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i), y = pos.getY(i);
      const th = Math.atan2(pz, px);
      const yy = Math.max(y, 0);
      let r = 0.30 - 0.011 * y;
      r += 0.20 * Math.exp(-yy / 0.30) + 0.10 * Math.exp(-yy / 0.9);
      let ridge = 0;
      for (let k = 0; k < roots.length; k++) {
        let dth = th - roots[k]; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
        ridge += rootA[k] * Math.exp(-(dth * dth) / 0.045);
      }
      r += ridge * Math.exp(-yy / 0.22) + ridge * 0.12 * Math.exp(-yy / 0.8);
      if (y < 0) r += -y * 2.2; // spreads out under the soil
      const bump = nz(Math.cos(th) * 1.6, y * 0.9, Math.sin(th) * 1.6) * 0.035 + nz(Math.cos(th) * 5, y * 3.2, Math.sin(th) * 5) * 0.010;
      r *= 1 + bump;
      trunkAxis(y, ax);
      pos.setXYZ(i, ax.x - TRUNK.x + Math.cos(th) * r, y, ax.z - TRUNK.z + Math.sin(th) * r * 0.94);
      uv.setXY(i, uv.getX(i) * 2, y / 1.15);
      const soil = 1 - sstep(0.02, 0.55, y);
      col[i * 3] = lerp(1, 0.66, soil); col[i * 3 + 1] = lerp(1, 0.58, soil); col[i * 3 + 2] = lerp(1, 0.50, soil);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    smoothNormals(geo);
    const parts = [geo];
    for (const l of limbs) {
      const lg = new THREE.CylinderGeometry(l.r1, l.r0, l.len + 0.25, 14, 8, true);
      const lp = lg.attributes.position, lu = lg.attributes.uv;
      for (let i = 0; i < lp.count; i++) {
        const t = (lp.getY(i) + (l.len + 0.25) / 2) / (l.len + 0.25);
        lp.setX(i, lp.getX(i) + Math.sin(t * 3.1) * 0.03);
        lu.setXY(i, lu.getX(i), lu.getY(i) * (l.len + 0.25) / 1.15 * 3);
      }
      lg.translate(0, (l.len + 0.25) / 2 - 0.25, 0);
      lg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), l.d));
      lg.translate(l.p0.x - TRUNK.x, l.p0.y, l.p0.z - TRUNK.z);
      const lc = new Float32Array(lp.count * 3).fill(1);
      lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
      parts.push(lg);
    }
    const merged = mergeGeos(parts);
    let map = null, nmap = null;
    if (tex.bark) { map = tex.bark.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; nmap = normalFrom(map, 3); }
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, roughness: 0.92, metalness: 0, vertexColors: true, color: new THREE.Color(0.92, 0.9, 0.86) });
    if (nmap) mat.normalScale.set(1.4, 1.4);
    const trunk = new THREE.Mesh(merged, mat);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    trunk.name = 'trunk';
    trunkGroup.add(trunk);
  }

  // ---------------------------------------------------------------- branches (alpha cut-out planes)
  const branches = [];
  const branchBoxes = [];
  {
    const IMG_AR = 1024 / 490;
    let bMat = null, bDepth = null, shadowOnlyMat = null;
    if (tex.branch) {
      bMat = new THREE.MeshStandardMaterial({
        map: tex.branch, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75, metalness: 0,
        emissive: new THREE.Color(0.30, 0.17, 0.08), emissiveMap: tex.branch, // light shining through the leaves
      });
      bDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.branch, alphaTest: 0.4, side: THREE.DoubleSide });
      shadowOnlyMat = new THREE.MeshBasicMaterial({ map: tex.branch, alphaTest: 0.4, side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
    }
    // geometry: pivot at the branch base (right edge, middle), extends toward −X, gently curved
    const makeGeo = (L) => {
      const W = L / IMG_AR;
      const g = new THREE.PlaneGeometry(L, W, 10, 4);
      g.translate(-L / 2, 0.02 * W, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), t = -x / L;
        p.setZ(i, Math.sin(t * Math.PI) * 0.06 * L + (y / W) * (y / W) * 0.12 * W);
      }
      g.computeVertexNormals();
      return g;
    };
    // [limb index, t along limb, extra yaw (deg), length, tilt from horizontal (deg), droop (deg), mirror, shadowOnly]
    const SPEC = [
      [0, 1.00, 8, 2.5, 28, 12, false, false],
      [0, 0.55, -32, 1.8, 40, 6, true, false],
      [1, 1.00, 10, 2.3, 22, 16, false, false],
      [1, 0.65, 48, 1.7, 46, 4, true, false],
      [2, 1.00, -6, 2.6, 30, 10, true, false],
      [2, 0.60, 30, 1.9, 52, -6, false, false],
      [3, 1.00, -10, 2.0, 34, 8, false, false],
      // shadow-only, out of frame: high to the back-left so their dapple falls on the yard
      [-1, 0, 0, 2.6, 8, 0, false, true],
      [-1, 0, 0, 2.4, 14, 0, true, true],
      [-1, 0, 0, 2.2, 10, 0, false, true],
    ];
    const SHADOW_ONLY = [[-3.6, 5.2, -1.3, 40], [-2.6, 5.6, -2.6, 70], [-4.3, 5.0, 0.4, 15]];
    let so = 0;
    const rnd = mulberry(321);
    const tmpV = new THREE.Vector3();
    for (const s of SPEC) {
      const [li, t, yawDeg, L, tiltDeg, droopDeg, mirror, shadowOnly] = s;
      const pivot = new THREE.Group();
      let dirX, dirZ;
      if (shadowOnly) {
        const p = SHADOW_ONLY[so++];
        pivot.position.set(p[0], p[1], p[2]);
        const a = THREE.MathUtils.degToRad(p[3]);
        dirX = Math.cos(a); dirZ = Math.sin(a);
      } else {
        const l = limbs[li];
        tmpV.copy(l.p0).lerp(l.p1, t);
        pivot.position.copy(tmpV);
        const a = Math.atan2(l.d.z, l.d.x) + THREE.MathUtils.degToRad(yawDeg);
        dirX = Math.cos(a); dirZ = Math.sin(a);
      }
      // local −X should point along (dirX, dirZ)
      const yaw = Math.atan2(dirZ, -dirX);
      pivot.rotation.order = 'YZX';
      pivot.rotation.set(-Math.PI / 2 + THREE.MathUtils.degToRad(tiltDeg), yaw, THREE.MathUtils.degToRad(droopDeg));
      const mesh = new THREE.Mesh(makeGeo(L), shadowOnly ? shadowOnlyMat : bMat);
      if (mirror) mesh.scale.y = -1;
      mesh.castShadow = true;
      mesh.receiveShadow = !shadowOnly;
      if (bDepth) mesh.customDepthMaterial = bDepth;
      mesh.visible = !!bMat;
      pivot.add(mesh);
      root.add(pivot);
      branches.push({ pivot, mesh, phase: rnd() * 6.28, f: 0.25 + rnd() * 0.2, amp: 0.025 + rnd() * 0.02, ang: 0, vel: 0, ang2: 0, vel2: 0, shadowOnly, base: pivot.rotation.clone() });
    }
    root.updateMatrixWorld(true);
    for (const b of branches) {
      if (b.shadowOnly) continue;
      b.mesh.geometry.computeBoundingBox();
      const box = b.mesh.geometry.boundingBox.clone().applyMatrix4(b.mesh.matrixWorld).expandByScalar(0.22);
      branchBoxes.push(box);
    }
  }

  // ---------------------------------------------------------------- stone ring (merged)
  {
    const rnd = mulberry(2024);
    const parts = [];
    const N = 11;
    let a = rnd() * 0.3;
    const gaps = [];
    for (let i = 0; i < N; i++) gaps.push(0.7 + rnd() * 0.6);
    const gsum = gaps.reduce((x, y) => x + y, 0);
    for (let i = 0; i < N; i++) {
      const nz = makeNoise3(100 + i);
      const sz = 0.09 + rnd() * 0.06; // half-size
      const sx = sz * (1.05 + rnd() * 0.35), sy = sz * (0.62 + rnd() * 0.22), sz2 = sz * (0.85 + rnd() * 0.25);
      const g = new THREE.SphereGeometry(1, 28, 18);
      const p = g.attributes.position;
      const nf = 1.1 + rnd() * 0.8;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        let d = 1 + nz(x * nf, y * nf, z * nf) * 0.22 + nz(x * 3.1, y * 3.1, z * 3.1) * 0.06 + nz(x * 7, y * 7, z * 7) * 0.015;
        // flattish bottom and slightly flat facets
        let yy = y * d;
        if (yy < -0.55) yy = -0.55 + (yy + 0.55) * 0.3;
        p.setXYZ(k, x * d * sx, yy * sy, z * d * sz2);
      }
      smoothNormals(g);
      const ang = a + (gaps[i] / gsum) * Math.PI;
      a += (gaps[i] / gsum) * Math.PI * 2;
      const rr = 0.80 + (rnd() - 0.5) * 0.05;
      const cx = Math.cos(ang) * rr, cz = Math.sin(ang) * rr;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(cx, sy * (0.25 + rnd() * 0.15), cz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25)),
        new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      // soot on the inner, upper side
      const pp = g.attributes.position, nn = g.attributes.normal;
      const col = new Float32Array(pp.count * 3);
      const tint = 0.85 + rnd() * 0.2, warm = rnd() * 0.06;
      for (let k = 0; k < pp.count; k++) {
        const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k);
        const r = Math.hypot(x, z) || 1;
        const inward = -(nn.getX(k) * x + nn.getZ(k) * z) / r;
        const soot = clamp01(inward * 0.9 + 0.1) * sstep(0.0, 0.08, y) * 0.75 + clamp01((0.83 - r) * 4) * 0.25;
        const dirt = 1 - sstep(0.0, 0.035, y) * 1; // soil stained base
        const v = tint * (1 - soot * 0.72) * (1 - (1 - dirt) * 0) * (0.72 + 0.28 * sstep(0.0, 0.04, y));
        col[k * 3] = v * (1 + warm); col[k * 3 + 1] = v; col[k * 3 + 2] = v * (1 - warm * 0.5);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      // uv: per-stone offset so they don't all look alike
      const uv = g.attributes.uv; const ou = rnd(), ov = rnd();
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.6 + ou, uv.getY(k) * 0.9 + ov);
      parts.push(g);
    }
    const geo = mergeGeos(parts);
    let map = null, nmap = null;
    if (tex.stone) { map = tex.stone.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; nmap = normalFrom(map, 3); }
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, roughness: 0.9, metalness: 0, vertexColors: true, color: new THREE.Color(0.86, 0.84, 0.80) });
    const stones = new THREE.Mesh(geo, mat);
    stones.castShadow = true; stones.receiveShadow = true;
    stones.name = 'stones';
    root.add(stones);
  }

  // ---------------------------------------------------------------- custom lathe (uv by arc length)
  function lathe(profile, segs) {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
    const arc = [0];
    for (let j = 1; j < profile.length; j++) arc[j] = arc[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    return { g, arc, np: profile.length };
  }

  // ---------------------------------------------------------------- zaru tray
  const zaruObj = new THREE.Group();
  zaruObj.position.copy(anchors.zaru);
  root.add(zaruObj);
  const zaruRock = new THREE.Group();
  zaruObj.add(zaruRock);
  {
    const R = 0.27;
    const P = [
      [0.0, -0.001], [0.20, 0.0], [0.262, 0.0], [0.2685, 0.003], [0.2705, 0.012], [0.2700, 0.020], [0.2680, 0.0245],
      [0.2620, 0.0262], [0.2520, 0.0262], [0.2455, 0.0245], [0.2425, 0.020], [0.2395, 0.0135], [0.2340, 0.0095],
      [0.2250, 0.0078], [0.15, 0.0072], [0.0, 0.0070],
    ];
    const { g } = lathe(P, 72);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const RI = R / 0.985;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * RI), 0.5 - pos.getZ(i) / (2 * RI));
    let nmap = null;
    if (tex.zaru) nmap = normalFrom(tex.zaru, 1.6);
    const mat = new THREE.MeshStandardMaterial({ map: tex.zaru || null, normalMap: nmap, roughness: 0.82, metalness: 0, color: new THREE.Color(0.9, 0.88, 0.84) });
    if (nmap) mat.normalScale.set(0.7, 0.7);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'zaru';
    zaruRock.add(m);
  }

  // ---------------------------------------------------------------- basket
  const basketObj = new THREE.Group();
  basketObj.position.copy(anchors.basket);
  root.add(basketObj);
  const basketRock = new THREE.Group();
  basketObj.add(basketRock);
  {
    const P = [
      [0.0, 0.0], [0.13, 0.0], [0.165, 0.003], [0.192, 0.014], [0.214, 0.032], [0.231, 0.058], [0.242, 0.088], [0.2475, 0.112],
      [0.2505, 0.121], [0.2555, 0.127], [0.2550, 0.1335], [0.2490, 0.1375], [0.2410, 0.1360], [0.2365, 0.1300], [0.2360, 0.1220],
      [0.2340, 0.108], [0.2270, 0.082], [0.2150, 0.058], [0.1960, 0.039], [0.1700, 0.026], [0.1350, 0.0205], [0.0, 0.020],
    ];
    const { g, arc, np } = lathe(P, 64);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const innerStart = 13;
    for (let i = 0; i < pos.count; i++) {
      const j = i % np;
      uv.setXY(i, uv.getX(i) * 13, arc[j] / 0.115);
      const y = pos.getY(i);
      let c;
      if (j >= innerStart) c = lerp(0.45, 0.95, sstep(0.02, 0.125, y)); // inner: darker deep down
      else c = lerp(0.62, 1.0, sstep(0.0, 0.05, y));
      col[i * 3] = c; col[i * 3 + 1] = c * 0.97; col[i * 3 + 2] = c * 0.93;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    let map = null, nmap = null;
    if (tex.weave) { map = tex.weave.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; nmap = normalFrom(map, 2.5); }
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, roughness: 0.78, metalness: 0, vertexColors: true, color: new THREE.Color(0.86, 0.80, 0.70), side: THREE.DoubleSide });
    if (nmap) mat.normalScale.set(1.1, 1.1);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.name = 'basket';
    basketRock.add(m);
  }

  // ---------------------------------------------------------------- attention sunbeam
  const spotLight = new THREE.SpotLight(0xffe2b0, 0, 0, 0.3, 1, 2);
  spotLight.castShadow = false;
  root.add(spotLight, spotLight.target);
  let decal = null;
  if (U.softDot) {
    const dm = new THREE.MeshBasicMaterial({ map: U.softDot, color: new THREE.Color(1.0, 0.82, 0.52), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    decal = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), dm);
    decal.position.y = 0.006;
    decal.visible = false;
    decal.renderOrder = 1;
    root.add(decal);
  }
  const spotS = { k: 0, target: 0, radius: 0.9, radiusT: 0.9, pos: new THREE.Vector3(), posT: new THREE.Vector3(), has: false };
  const spotDir = new THREE.Vector3(-0.25, 1, 0.12).normalize();

  // ---------------------------------------------------------------- time of day / state
  let todK = 0, todT = 0;
  let shake = { t: 99, p: 0 };
  const zAtt = { k: 0, kt: 0, ph: 0 }, bAtt = { k: 0, kt: 0, ph: 1.3 };
  let t = 0;
  const trunkSegA = new THREE.Vector3(TRUNK.x, 0, TRUNK.z), trunkSegB = new THREE.Vector3();
  trunkAxis(4, trunkSegB);

  function applyTOD(k) {
    const el = THREE.MathUtils.degToRad(keyNum(KEYS.elev, k));
    const az = sunAz0 + THREE.MathUtils.degToRad(keyNum(KEYS.az, k));
    sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    fitShadow();
    keyCol(KEYS.sunCol, k, sun.color);
    keyCol(KEYS.skyCol, k, hemi.color);
    keyCol(KEYS.gndCol, k, hemi.groundColor);
    if (scene.background && scene.background.isColor) keyCol(KEYS.bg, k, scene.background);
    if (scene.fog) keyCol(KEYS.fog, k, scene.fog.color);
    if (backdropMat) { keyCol(KEYS.wall, k, backdropMat.color); keyCol(KEYS.fog, k, backdropMat.userData.u.uHaze.value); backdropMat.userData.u.uHazeAll.value = 0.10 + k * 0.06; }
    if ('environmentIntensity' in scene) scene.environmentIntensity = keyNum(KEYS.envI, k);
  }
  applyTOD(0);
  let lastAppliedK = 0;

  function setTimeOfDay(k) { todT = clamp01(Number(k) || 0); }

  function spot(pos, strength = 1, radius = 0.9) {
    if (!pos || !(pos.isVector3 || (typeof pos.x === 'number'))) { spotS.target = 0; return; }
    const s = clamp01(Number(strength));
    spotS.target = Number.isFinite(s) ? s : 1;
    spotS.radiusT = THREE.MathUtils.clamp(Number(radius) || 0.9, 0.15, 3);
    spotS.posT.set(Number(pos.x) || 0, 0, Number(pos.z) || 0);
    if (!spotS.has || spotS.k < 0.02) { spotS.pos.copy(spotS.posT); spotS.radius = spotS.radiusT; }
    spotS.has = true;
  }

  function shakeTree(power = 1) {
    const p = THREE.MathUtils.clamp(Number(power) || 1, 0, 2);
    shake.t = 0; shake.p = Math.max(p, shake.t < 0.7 ? shake.p * 0.5 : 0);
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      b.vel += (i % 2 ? 1 : -1) * (0.9 + 0.5 * Math.sin(i * 7.3)) * p;
      b.vel2 += (i % 3 ? -1 : 1) * 0.6 * p;
    }
  }

  function treeHit(ray) {
    if (!ray || !ray.origin || !ray.direction) return false;
    try {
      if (ray.distanceSqToSegment(trunkSegA, trunkSegB) < 0.45 * 0.45) return true;
      for (let i = 0; i < branchBoxes.length; i++) if (ray.intersectsBox(branchBoxes[i])) return true;
    } catch (e) { return false; }
    return false;
  }

  function mkAtt(obj, rock, st, R) {
    return {
      object3D: obj,
      setAttention(k) { st.kt = clamp01(Number(k) || 0); },
      _upd(dt) {
        st.k += (st.kt - st.k) * Math.min(1, dt * 5);
        if (st.k < 0.002 && st.kt === 0) { rock.rotation.set(0, 0, 0); rock.position.y = 0; return; }
        st.ph += dt * Math.PI * 2 * 1.2;
        const ax = Math.sin(st.ph) * 0.045 * st.k, az = Math.sin(st.ph * 0.5 + 0.8) * 0.02 * st.k;
        rock.rotation.set(ax, 0, az);
        rock.position.y = R * (Math.abs(Math.sin(ax)) + Math.abs(Math.sin(az))) * 0.9; // pivot on the rim, never floating
      },
    };
  }
  const zaru = mkAtt(zaruObj, zaruRock, zAtt, 0.27);
  const basket = mkAtt(basketObj, basketRock, bAtt, 0.25);

  const baseSun = { i: KEYS.sunI[0], h: KEYS.hemiI[0] };

  function update(dt) {
    dt = Number(dt);
    if (!(dt > 0)) dt = 0; if (dt > 0.05) dt = 0.05;
    t += dt;

    // quality (live)
    const q = G.quality || {};
    const wantShadow = q.shadows !== false;
    if (sun.castShadow !== wantShadow) sun.castShadow = wantShadow;
    const wantSize = q.low ? 1024 : 2048;
    if (wantSize !== shadowSize) {
      shadowSize = wantSize;
      sun.shadow.mapSize.set(wantSize, wantSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }

    // time of day easing (~2 s)
    if (Math.abs(todK - todT) > 1e-4) todK += (todT - todK) * Math.min(1, dt * 2.2);
    else todK = todT;
    if (Math.abs(todK - lastAppliedK) > 1e-4) { applyTOD(todK); lastAppliedK = todK; }
    baseSun.i = keyNum(KEYS.sunI, todK);
    baseSun.h = keyNum(KEYS.hemiI, todK);

    // attention sunbeam
    spotS.k += (spotS.target - spotS.k) * Math.min(1, dt * 2.5);
    const kk = spotS.k;
    spotS.pos.lerp(spotS.posT, Math.min(1, dt * 3));
    spotS.radius += (spotS.radiusT - spotS.radius) * Math.min(1, dt * 3);
    const dim = 1 - 0.12 * kk;
    sun.intensity = baseSun.i * dim;
    hemi.intensity = baseSun.h * dim;
    const breathe = 0.88 + 0.12 * Math.sin(t * 2.1);
    if (kk > 0.003) {
      spotLight.position.copy(spotS.pos).addScaledVector(spotDir, 4);
      spotLight.target.position.copy(spotS.pos);
      spotLight.target.updateMatrixWorld();
      spotLight.angle = Math.atan((spotS.radius * 1.25) / 4);
      spotLight.penumbra = 1;
      spotLight.intensity = 26 * kk * breathe;
      spotLight.color.copy(sun.color).lerp(tmpC.setRGB(1, 0.86, 0.62), 0.6);
      if (decal) {
        decal.visible = true;
        decal.position.set(spotS.pos.x, 0.006, spotS.pos.z);
        decal.scale.setScalar(spotS.radius * 1.3);
        decal.material.opacity = 0.22 * kk * breathe;
      }
    } else {
      spotLight.intensity = 0;
      if (decal) decal.visible = false;
    }

    // tree shake + sway
    shake.t += dt;
    let lean = 0, lean2 = 0;
    if (shake.t < 1.2) {
      const e = Math.exp(-shake.t * 5.5) * shake.p;
      lean = Math.sin(shake.t * 38) * 0.0045 * e;
      lean2 = Math.sin(shake.t * 29 + 1) * 0.003 * e;
    }
    trunkGroup.rotation.set(lean2, 0, lean);
    const wind = 1 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      // spring for whips
      b.vel += (-90 * b.ang - 5.5 * b.vel) * dt; b.ang += b.vel * dt;
      b.vel2 += (-70 * b.ang2 - 5 * b.vel2) * dt; b.ang2 += b.vel2 * dt;
      if (b.ang > 0.3) b.ang = 0.3; if (b.ang < -0.3) b.ang = -0.3;
      if (b.ang2 > 0.3) b.ang2 = 0.3; if (b.ang2 < -0.3) b.ang2 = -0.3;
      const sw = Math.sin(t * b.f * 6.283 + b.phase) * b.amp * wind;
      const sw2 = Math.sin(t * b.f * 4.1 + b.phase * 1.7) * b.amp * 0.6 * wind;
      b.mesh.rotation.set(sw + b.ang, sw2 * 0.5, sw2 + b.ang2 * 0.6);
    }

    zaru._upd(dt);
    basket._upd(dt);
  }

  return { anchors, setTimeOfDay, spot, shakeTree, treeHit, zaru, basket, update };
}
