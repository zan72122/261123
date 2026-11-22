// FIRE — flames, smoke, sparks, ash puffs, steam, the fire light; the long lighter and the uchiwa fan.
import * as THREE from 'three';

export function create(G) {
  const scene = G.scene;
  const U = G.util || {};
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
  const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const safe = (fn) => { try { fn(); } catch (e) { /* never throw */ } };
  const audio = (name, ...a) => safe(() => { const au = G.audio; if (au && typeof au[name] === 'function') au[name](...a); });
  const isV3 = (v) => v && v.isVector3;
  const A = (G.world && G.world.anchors) || {};
  const anchor = (k, x, y, z) => (isV3(A[k]) ? A[k].clone() : new THREE.Vector3(x, y, z));
  const PILE = anchor('pile', 0, 0, 0); PILE.y = 0;
  const LIGHTER_REST = anchor('lighterRest', 0.26, 0, 1.40);
  const UCHIWA_REST = anchor('uchiwaRest', -0.14, 0, 1.45);
  const particlesQ = () => clamp((G.quality && G.quality.particles) || 1, 0.25, 1);

  // ---------- textures ----------
  function valueNoise2(w, h, cells, seed) {
    const g = new Float32Array((cells + 1) * (cells + 1));
    let s = seed * 9301 + 49297;
    for (let i = 0; i < g.length; i++) { s = (s * 9301 + 49297) % 233280; g[i] = s / 233280; }
    for (let x = 0; x <= cells; x++) g[cells * (cells + 1) + x] = g[x];
    for (let y = 0; y <= cells; y++) g[y * (cells + 1) + cells] = g[y * (cells + 1)];
    return (u, v) => {
      const x = (u - Math.floor(u)) * cells, y = (v - Math.floor(v)) * cells;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const i0 = yi * (cells + 1) + xi;
      const a = g[i0], b = g[i0 + 1], c = g[i0 + cells + 1], d = g[i0 + cells + 2];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  function canvasTex(size, fill) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); fill(ctx, size);
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }
  // puffy smoke texture: lumpy soft blob, white rgb, alpha mask
  const puffTex = canvasTex(128, (ctx, S) => {
    const img = ctx.createImageData(S, S);
    const n1 = valueNoise2(S, S, 4, 3), n2 = valueNoise2(S, S, 9, 7), n3 = valueNoise2(S, S, 17, 11);
    const blobs = [[0, 0, 0.62], [-0.28, -0.12, 0.42], [0.27, -0.1, 0.44], [0.05, 0.25, 0.42], [-0.15, 0.2, 0.36], [0.2, 0.22, 0.32]];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      let m = 0;
      for (const b of blobs) { const dx = u - b[0], dy = v - b[1]; m += Math.exp(-(dx * dx + dy * dy) / (b[2] * b[2]) * 2.2); }
      const r = Math.sqrt(u * u + v * v);
      const fall = smooth(1.0, 0.45, r);
      const nn = 0.5 * n1(x / S, y / S) + 0.3 * n2(x / S, y / S) + 0.2 * n3(x / S, y / S);
      let a = clamp(m * 0.9, 0, 1) * fall * (0.45 + 0.9 * nn);
      a = clamp(a, 0, 1);
      const i = (y * S + x) * 4;
      const sh = Math.round(235 + 20 * nn);
      img.data[i] = sh; img.data[i + 1] = sh; img.data[i + 2] = sh; img.data[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
  });
  const dotTex = canvasTex(64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
  let noiseTex = U.noiseTex;
  if (!noiseTex) {
    const S = 128, d = new Uint8Array(S * S * 4), n = valueNoise2(S, S, 8, 5), m = valueNoise2(S, S, 16, 9);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = 0.65 * n(x / S, y / S) + 0.35 * m(x / S, y / S), i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
    }
    noiseTex = new THREE.DataTexture(d, S, S); noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.needsUpdate = true;
  }
  const glowTex = U.softDot || dotTex;

  // ---------- state ----------
  let t = 0;
  let levelT = 0, levelE = 0;
  let smokeT = 0, smokeE = 0;
  let windT = 0, windE = 0;
  let baseYT = 0.2, baseY = 0.2;
  const ctr = new THREE.Vector3(PILE.x, 0, PILE.z);
  const ignFrom = new THREE.Vector3();
  let ignP = 1; // 0..1 progress of the ignite glide (1 = done)
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tmpE = new THREE.Euler();

  // ---------- flames ----------
  const NT = 10;
  const flameGeo = new THREE.InstancedBufferGeometry();
  const pg = new THREE.PlaneGeometry(1, 1, 1, 6);
  flameGeo.index = pg.index; flameGeo.setAttribute('position', pg.attributes.position); flameGeo.setAttribute('uv', pg.attributes.uv);
  const fPos = new Float32Array(NT * 3), fPar = new Float32Array(NT * 4);
  const fPosA = new THREE.InstancedBufferAttribute(fPos, 3), fParA = new THREE.InstancedBufferAttribute(fPar, 4);
  fPosA.setUsage(THREE.DynamicDrawUsage); fParA.setUsage(THREE.DynamicDrawUsage);
  flameGeo.setAttribute('iPos', fPosA); flameGeo.setAttribute('iP', fParA);
  flameGeo.instanceCount = 0;
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex }, uLean: { value: new THREE.Vector3() }, uFlutter: { value: 0.05 }, uHot: { value: 0 }, uBright: { value: 0.9 } },
    vertexShader: `
      attribute vec3 iPos; attribute vec4 iP;
      uniform float uTime; uniform vec3 uLean; uniform float uFlutter;
      varying vec2 vUv; varying float vSeed; varying float vAmp;
      void main(){
        vUv = uv; vSeed = iP.z; vAmp = iP.w;
        vec3 tc = cameraPosition - iPos;
        vec3 right = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-5, 0.0, 0.0));
        float y = uv.y;
        vec3 p = iPos + right * (position.x * iP.x) + vec3(0.0, y * iP.y, 0.0);
        float yy = y * y * iP.y;
        p += uLean * yy;
        float fl = sin(uTime * (4.5 + iP.z * 3.0) + iP.z * 20.0) * 0.6 + sin(uTime * (8.7 + iP.z * 2.0) + iP.z * 7.0) * 0.4;
        p += right * fl * uFlutter * yy;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime; uniform float uHot; uniform float uBright;
      varying vec2 vUv; varying float vSeed; varying float vAmp;
      void main(){
        vec2 uv = vUv; float y = uv.y;
        float n1 = texture2D(uNoise, vec2(uv.x * 0.45 + vSeed, y * 0.55 - uTime * 0.75)).r;
        float n2 = texture2D(uNoise, vec2(uv.x * 1.1 - vSeed * 2.0, y * 1.25 - uTime * 1.6)).r;
        float bend = (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.55;
        float x = (uv.x - 0.5) * 2.0 + bend * y * 1.0;
        float w = mix(0.7, 1.0, smoothstep(0.0, 0.22, y)) * pow(clamp(1.0 - y, 0.0, 1.0), 0.85);
        float body = clamp(1.0 - abs(x) / max(w, 1e-3), 0.0, 1.0);
        body = smoothstep(0.0, 0.75, body);
        float n3 = texture2D(uNoise, vec2(uv.x * 1.9 + vSeed * 3.1, y * 1.7 - uTime * 2.3)).r;
        float n4 = texture2D(uNoise, vec2(uv.x * 3.7 + vSeed * 1.7, y * 3.2 - uTime * 3.4)).r;
        float er = (n3 * 0.7 + n4 * 0.3) * (0.15 + 1.1 * y);
        float I = clamp(body * (1.15 - 0.4 * y) - er * 0.85, 0.0, 1.0);
        I *= smoothstep(0.0, 0.2, y + (n2 - 0.5) * 0.12);
        vec3 c = mix(vec3(0.38, 0.03, 0.0), vec3(1.0, 0.27, 0.03), smoothstep(0.04, 0.4, I));
        c = mix(c, vec3(1.0, 0.55, 0.14), smoothstep(0.42, 0.72, I));
        c = mix(c, vec3(1.0, 0.82, 0.5), smoothstep(0.78, 1.0, I));
        float core = exp(-x * x * 6.0) * (1.0 - smoothstep(0.05, 0.4, y)) * smoothstep(0.03, 0.15, y) * body;
        c += vec3(1.0, 0.7, 0.35) * core * (0.12 + 0.35 * uHot);
        float a = smoothstep(0.03, 0.6, I) * vAmp * 0.8;
        gl_FragColor = vec4(c * uBright * (0.85 + 0.3 * uHot), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
  const flames = new THREE.Mesh(flameGeo, flameMat);
  flames.frustumCulled = false; flames.renderOrder = 5;
  scene.add(flames);
  // tongue slots
  const slots = [];
  for (let i = 0; i < NT; i++) {
    let ang, r, th;
    if (i === 0) { ang = Math.PI * 0.5 + 0.1; r = 0.2; th = 0.0; }
    else if (i === 1) { ang = Math.PI * 0.5 - 0.5; r = 0.17; th = 0.06; }
    else { ang = (i / (NT - 1)) * Math.PI * 2 + rnd(-0.3, 0.3); r = i < 4 ? rnd(0.0, 0.1) : rnd(0.1, 0.28); th = 0.12 + (i - 2) / (NT - 2) * 0.55; }
    slots.push({ ang, r, th, w: rnd(0.24, 0.38), h: rnd(0.5, 0.85) * (r < 0.12 ? 1 : 0.8), ph: rnd(0, 100), seed: rnd(0, 1), sp: rnd(0.7, 1.3) });
  }
  // sort: biggest in the centre a bit taller
  slots.forEach((s) => { if (s.r < 0.1) s.h = Math.max(s.h, 0.7); });

  // fire light + glow disc
  const fireLight = new THREE.PointLight(0xff8a3c, 0, 4, 2);
  fireLight.castShadow = false;
  scene.add(fireLight);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff7a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: true });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; glow.renderOrder = 2; glow.visible = false;
  scene.add(glow);

  // ---------- generic particle system ----------
  const pVert = `
    attribute vec3 aPos; attribute vec4 aCol; attribute vec2 aSz; attribute vec3 aStr;
    varying vec2 vUv; varying vec4 vCol;
    void main(){
      vUv = uv; vCol = aCol;
      vec4 mv = viewMatrix * vec4(aPos, 1.0);
      vec2 s = (viewMatrix * vec4(aStr, 0.0)).xy;
      float ls = length(s);
      vec2 up = ls > 1e-5 ? s / ls : vec2(-sin(aSz.y), cos(aSz.y));
      vec2 rt = vec2(up.y, -up.x);
      mv.xy += rt * position.x * aSz.x + up * position.y * (aSz.x + ls);
      gl_Position = projectionMatrix * mv;
    }`;
  const pFrag = `
    uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
    void main(){ vec4 tx = texture2D(map, vUv); float m = tx.r * tx.a; gl_FragColor = vec4(vCol.rgb * mix(1.0, tx.r, 0.3), m * vCol.a); }`;
  function makeSys(cap, tex, additive, order) {
    const geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    geo.index = q.index; geo.setAttribute('position', q.attributes.position); geo.setAttribute('uv', q.attributes.uv);
    const aPos = new Float32Array(cap * 3), aCol = new Float32Array(cap * 4), aSz = new Float32Array(cap * 2), aStr = new Float32Array(cap * 3);
    const attrs = [['aPos', aPos, 3], ['aCol', aCol, 4], ['aSz', aSz, 2], ['aStr', aStr, 3]].map(([n, arr, k]) => {
      const a = new THREE.InstancedBufferAttribute(arr, k); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); return a;
    });
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, vertexShader: pVert, fragmentShader: pFrag,
      transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order;
    scene.add(mesh);
    const S = {
      cap, n: 0, mesh, geo, aPos, aCol, aSz, aStr, attrs,
      P: new Float32Array(cap * 3), V: new Float32Array(cap * 3), X: new Float32Array(cap * 4), // extra per-particle data
      age: new Float32Array(cap), life: new Float32Array(cap), s0: new Float32Array(cap), s1: new Float32Array(cap),
      a0: new Float32Array(cap), rot: new Float32Array(cap), rv: new Float32Array(cap), seed: new Float32Array(cap), kind: new Uint8Array(cap),
      spawn(capScale) {
        const lim = Math.max(1, Math.floor(cap * capScale));
        if (S.n >= lim) return -1;
        const i = S.n++; S.age[i] = 0; S.kind[i] = 0; S.rot[i] = rnd(0, 6.283); S.rv[i] = rnd(-0.4, 0.4); S.seed[i] = Math.random();
        S.X[i * 4] = S.X[i * 4 + 1] = S.X[i * 4 + 2] = S.X[i * 4 + 3] = 0;
        return i;
      },
      kill(i) {
        const j = --S.n; if (i === j) return;
        S.P[i * 3] = S.P[j * 3]; S.P[i * 3 + 1] = S.P[j * 3 + 1]; S.P[i * 3 + 2] = S.P[j * 3 + 2];
        S.V[i * 3] = S.V[j * 3]; S.V[i * 3 + 1] = S.V[j * 3 + 1]; S.V[i * 3 + 2] = S.V[j * 3 + 2];
        for (let k = 0; k < 4; k++) S.X[i * 4 + k] = S.X[j * 4 + k];
        S.age[i] = S.age[j]; S.life[i] = S.life[j]; S.s0[i] = S.s0[j]; S.s1[i] = S.s1[j]; S.a0[i] = S.a0[j];
        S.rot[i] = S.rot[j]; S.rv[i] = S.rv[j]; S.seed[i] = S.seed[j]; S.kind[i] = S.kind[j];
      },
      out(k, x, y, z, size, rot, r, g, b, a, sx = 0, sy = 0, sz = 0) {
        aPos[k * 3] = x; aPos[k * 3 + 1] = y; aPos[k * 3 + 2] = z;
        aSz[k * 2] = size; aSz[k * 2 + 1] = rot;
        aCol[k * 4] = r; aCol[k * 4 + 1] = g; aCol[k * 4 + 2] = b; aCol[k * 4 + 3] = a;
        aStr[k * 3] = sx; aStr[k * 3 + 1] = sy; aStr[k * 3 + 2] = sz;
      },
      flush() {
        geo.instanceCount = S.n; mesh.visible = S.n > 0;
        if (S.n > 0) for (const a of attrs) { a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, S.n * a.itemSize); a.needsUpdate = true; }
      },
    };
    return S;
  }
  const smoke = makeSys(74, puffTex, false, 7);
  const sparksS = makeSys(90, dotTex, true, 8);
  const ash = makeSys(60, puffTex, false, 6);
  const steam = makeSys(60, puffTex, false, 9);

  // ---------- smoke ----------
  let smokeAcc = 0, faceCooldown = 0;
  function emitSmoke(k) {
    const i = smoke.spawn(particlesQ() * (70 / 74));
    if (i < 0) return;
    const r = rnd(0, 0.16 + 0.1 * k), a = rnd(0, 6.283);
    smoke.P[i * 3] = ctr.x + Math.cos(a) * r; smoke.P[i * 3 + 1] = baseY + 0.1 + rnd(0, 0.12) + levelE * 0.2; smoke.P[i * 3 + 2] = ctr.z + Math.sin(a) * r;
    smoke.V[i * 3] = rnd(-0.06, 0.06); smoke.V[i * 3 + 1] = rnd(0.5, 0.9); smoke.V[i * 3 + 2] = rnd(-0.06, 0.06);
    smoke.life[i] = rnd(2.5, 4.0);
    smoke.s0[i] = rnd(0.13, 0.2) * (0.7 + 0.3 * k); smoke.s1[i] = rnd(0.5, 0.75) * (0.55 + 0.45 * k);
    smoke.a0[i] = (0.14 + 0.21 * k) * rnd(0.8, 1.0);
  }
  function updSmoke(dt) {
    const S = smoke;
    const cam = G.camera;
    for (let i = 0; i < S.n; i++) {
      S.age[i] += dt;
      if (S.age[i] >= S.life[i]) { S.kill(i); i--; continue; }
    }
    for (let i = 0; i < S.n; i++) {
      const p = S.age[i] / S.life[i], i3 = i * 3;
      if (S.kind[i] === 1) {
        // smoke-in-the-face puff: X = start pos, V = camera-space offset
        const pr = clamp(p, 0, 1), e = 1 - Math.pow(1 - clamp(pr * 1.35, 0, 1), 2.2);
        tmpV.set(S.V[i3], S.V[i3 + 1], -0.42 + S.V[i3 + 2]);
        if (cam) tmpV.applyMatrix4(cam.matrixWorld); else tmpV.set(0, 1, 3);
        const x = S.X[i * 4] + (tmpV.x - S.X[i * 4]) * e, y = S.X[i * 4 + 1] + (tmpV.y - S.X[i * 4 + 1]) * e, z = S.X[i * 4 + 2] + (tmpV.z - S.X[i * 4 + 2]) * e;
        const size = S.s0[i] + (S.s1[i] - S.s0[i]) * e;
        const a = S.a0[i] * smooth(0.0, 0.25, pr) * (1 - smooth(0.55, 1.0, pr));
        S.rot[i] += S.rv[i] * dt;
        S.out(i, x, y, z, size, S.rot[i], 0.74, 0.75, 0.77, a);
        continue;
      }
      const h = S.P[i3 + 1] - baseY;
      // drift: ambient breeze toward -X, fan wind bends strongly toward -Z with height
      const bend = clamp(h, 0, 2);
      S.V[i3] += (-0.12 - S.V[i3]) * dt * 0.6 + Math.sin(t * 0.7 + S.seed[i] * 9) * 0.05 * dt;
      S.V[i3 + 2] += (-windE * 1.6 * (0.4 + bend) - S.V[i3 + 2]) * dt * (1.2 + windE * 2);
      S.V[i3 + 1] *= Math.exp(-dt * 0.25);
      S.P[i3] += S.V[i3] * dt; S.P[i3 + 1] += S.V[i3 + 1] * dt * (1 - windE * 0.35); S.P[i3 + 2] += S.V[i3 + 2] * dt;
      S.rot[i] += S.rv[i] * dt;
      const ep = 1 - Math.pow(1 - p, 1.6);
      const size = S.s0[i] + (S.s1[i] - S.s0[i]) * ep;
      const a = S.a0[i] * smooth(0, 0.12, p) * (1 - smooth(0.35, 1, p));
      // colour: warm, a little darker low (fire-lit, fresh leaf smoke), bluish pale grey higher
      const warm = (1 - smooth(0, 0.45, p)) * levelE;
      const r = 0.66 + 0.16 * p + 0.1 * warm, g = 0.68 + 0.15 * p + 0.03 * warm, b = 0.73 + 0.13 * p - 0.05 * warm;
      S.out(i, S.P[i3], S.P[i3 + 1], S.P[i3 + 2], size, S.rot[i], r, g, b, a);
    }
    S.flush();
  }
  function smokeFace() {
    if (faceCooldown > 0) return;
    faceCooldown = 1.2;
    audio('hiss');
    for (let k = 0; k < 4; k++) {
      // always allowed (may exceed quality scale a little)
      const i = smoke.spawn(1);
      if (i < 0) break;
      smoke.kind[i] = 1;
      smoke.X[i * 4] = ctr.x + rnd(-0.1, 0.1); smoke.X[i * 4 + 1] = baseY + 0.35 + rnd(0, 0.1); smoke.X[i * 4 + 2] = ctr.z + rnd(-0.05, 0.1);
      smoke.V[i * 3] = (k - 1.5) * 0.09 + rnd(-0.03, 0.03); smoke.V[i * 3 + 1] = rnd(-0.06, 0.06) - 0.02; smoke.V[i * 3 + 2] = k * 0.05;
      smoke.age[i] = -k * 0.09; smoke.life[i] = 1.6 - k * 0.09;
      smoke.s0[i] = 0.25; smoke.s1[i] = rnd(0.75, 0.95);
      smoke.a0[i] = 0.3;
    }
  }

  // ---------- sparks ----------
  let sparkAcc = 0;
  function sparks(pos, n = 10, power = 1) {
    if (!isV3(pos)) return;
    n = clamp(Math.round(n), 0, 40); power = clamp(power, 0.1, 3);
    for (let k = 0; k < n; k++) {
      const i = sparksS.spawn(particlesQ()); if (i < 0) return;
      sparksS.P[i * 3] = pos.x + rnd(-0.05, 0.05); sparksS.P[i * 3 + 1] = pos.y + rnd(0, 0.05); sparksS.P[i * 3 + 2] = pos.z + rnd(-0.05, 0.05);
      const sp = rnd(0.6, 1.0) * power, a = rnd(0, 6.283), sw = rnd(0, 0.45);
      sparksS.V[i * 3] = Math.cos(a) * sw * sp; sparksS.V[i * 3 + 1] = rnd(1.0, 2.2) * sp; sparksS.V[i * 3 + 2] = Math.sin(a) * sw * sp;
      sparksS.life[i] = rnd(0.6, 1.4); sparksS.s0[i] = rnd(0.008, 0.016); sparksS.a0[i] = rnd(0.7, 1);
    }
  }
  function updSparks(dt) {
    const S = sparksS;
    for (let i = 0; i < S.n; i++) { S.age[i] += dt; if (S.age[i] >= S.life[i]) { S.kill(i); i--; } }
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < S.n; i++) {
      const i3 = i * 3, p = S.age[i] / S.life[i], sd = S.seed[i] * 30;
      S.V[i3] = S.V[i3] * drag + Math.sin(t * 9 + sd) * 0.9 * dt - 0.1 * dt;
      S.V[i3 + 2] = S.V[i3 + 2] * drag + Math.cos(t * 8 + sd) * 0.9 * dt - windE * 1.5 * dt;
      S.V[i3 + 1] = S.V[i3 + 1] * drag + 0.15 * dt;
      S.P[i3] += S.V[i3] * dt; S.P[i3 + 1] += S.V[i3 + 1] * dt; S.P[i3 + 2] += S.V[i3 + 2] * dt;
      const a = S.a0[i] * (1 - smooth(0.4, 1, p)) * smooth(0, 0.05, p);
      const cool = p;
      S.out(i, S.P[i3], S.P[i3 + 1], S.P[i3 + 2], S.s0[i] * (1 - 0.4 * p), 0,
        1.0, 0.72 - 0.35 * cool, 0.32 - 0.25 * cool, a,
        S.V[i3] * 0.028, S.V[i3 + 1] * 0.028, S.V[i3 + 2] * 0.028);
    }
    S.flush();
  }

  // ---------- ash puffs ----------
  function ashPuff(pos, power = 1) {
    if (!isV3(pos)) return;
    power = clamp(power, 0.2, 2);
    const n = Math.round(6 + 4 * Math.min(1, power));
    for (let k = 0; k < n; k++) {
      const i = ash.spawn(particlesQ()); if (i < 0) return;
      const a = rnd(0, 6.283), sp = rnd(0.25, 0.7) * power;
      ash.P[i * 3] = pos.x + Math.cos(a) * 0.03; ash.P[i * 3 + 1] = Math.max(0.01, pos.y) + rnd(0, 0.03); ash.P[i * 3 + 2] = pos.z + Math.sin(a) * 0.03;
      ash.V[i * 3] = Math.cos(a) * sp; ash.V[i * 3 + 1] = rnd(0.2, 0.6) * power; ash.V[i * 3 + 2] = Math.sin(a) * sp;
      ash.life[i] = rnd(0.65, 1.0); ash.s0[i] = rnd(0.04, 0.07) * (0.7 + 0.3 * power); ash.s1[i] = ash.s0[i] * rnd(2.2, 3.2); ash.a0[i] = rnd(0.25, 0.4);
    }
  }
  function updAsh(dt) {
    const S = ash;
    for (let i = 0; i < S.n; i++) { S.age[i] += dt; if (S.age[i] >= S.life[i]) { S.kill(i); i--; } }
    const drag = Math.exp(-dt * 4.5);
    for (let i = 0; i < S.n; i++) {
      const i3 = i * 3, p = S.age[i] / S.life[i];
      S.V[i3] *= drag; S.V[i3 + 2] *= drag; S.V[i3 + 1] = S.V[i3 + 1] * drag - 0.25 * dt;
      S.P[i3] += S.V[i3] * dt; S.P[i3 + 1] = Math.max(0.01, S.P[i3 + 1] + S.V[i3 + 1] * dt); S.P[i3 + 2] += S.V[i3 + 2] * dt;
      S.rot[i] += S.rv[i] * dt;
      const size = S.s0[i] + (S.s1[i] - S.s0[i]) * (1 - Math.pow(1 - p, 2));
      const a = S.a0[i] * smooth(0, 0.08, p) * (1 - smooth(0.3, 1, p));
      S.out(i, S.P[i3], S.P[i3 + 1], S.P[i3 + 2], size, S.rot[i], 0.8, 0.79, 0.77, a);
    }
    S.flush();
  }

  // ---------- steam ----------
  const emitters = [];
  const MAX_EMIT = 12;
  function readTarget(tg, out) {
    if (!tg) return false;
    if (tg.isVector3) { out.copy(tg); return true; }
    if (tg.isObject3D) { tg.getWorldPosition(out); return true; }
    return false;
  }
  function spawnSteam(x, y, z, burst, power) {
    const i = steam.spawn(particlesQ()); if (i < 0) return;
    const S = steam, i3 = i * 3;
    if (burst) {
      const a = rnd(0, 6.283), r = rnd(0, 0.05);
      S.P[i3] = x + Math.cos(a) * r; S.P[i3 + 1] = y + rnd(0, 0.03); S.P[i3 + 2] = z + Math.sin(a) * r;
      S.V[i3] = Math.cos(a) * rnd(0.1, 0.3) * power; S.V[i3 + 1] = rnd(0.4, 0.8) * power; S.V[i3 + 2] = Math.sin(a) * rnd(0.1, 0.3) * power;
      S.life[i] = rnd(1.0, 1.5); S.s0[i] = rnd(0.05, 0.09); S.s1[i] = rnd(0.2, 0.32) * Math.min(1.4, power); S.a0[i] = rnd(0.22, 0.32);
      S.kind[i] = 1;
    } else {
      S.P[i3] = x + rnd(-0.025, 0.025); S.P[i3 + 1] = y + rnd(0, 0.01); S.P[i3 + 2] = z + rnd(-0.025, 0.025);
      S.V[i3] = rnd(-0.02, 0.02); S.V[i3 + 1] = rnd(0.25, 0.4); S.V[i3 + 2] = rnd(-0.02, 0.02);
      S.life[i] = rnd(1.2, 2.0); S.s0[i] = rnd(0.025, 0.04); S.s1[i] = rnd(0.09, 0.15); S.a0[i] = rnd(0.24, 0.36);
    }
  }
  function steamAt(target, rate = 1) {
    const h = { target, rate: clamp(+rate || 0, 0, 2), acc: Math.random(), alive: true };
    const api = {
      setRate(k) { h.rate = clamp(+k || 0, 0, 2); },
      stop() { if (!h.alive) return; h.alive = false; const ix = emitters.indexOf(h); if (ix >= 0) emitters.splice(ix, 1); },
    };
    if (emitters.length >= MAX_EMIT) { const old = emitters.shift(); if (old) old.alive = false; }
    emitters.push(h);
    return api;
  }
  function steamBurst(pos, power = 1) {
    if (!isV3(pos)) return;
    power = clamp(power, 0.2, 2);
    const n = Math.round(10 + 6 * Math.min(1, power));
    for (let k = 0; k < n; k++) spawnSteam(pos.x, pos.y, pos.z, true, power);
  }
  function updSteam(dt) {
    for (let e = 0; e < emitters.length; e++) {
      const h = emitters[e];
      if (h.rate <= 0 || !readTarget(h.target, tmpV)) continue;
      h.acc += dt * h.rate * 9;
      let guard = 0;
      while (h.acc >= 1 && guard++ < 4) { h.acc -= 1; spawnSteam(tmpV.x, tmpV.y, tmpV.z, false, 1); }
      if (h.acc > 1) h.acc = 1;
    }
    const S = steam;
    for (let i = 0; i < S.n; i++) { S.age[i] += dt; if (S.age[i] >= S.life[i]) { S.kill(i); i--; } }
    for (let i = 0; i < S.n; i++) {
      const i3 = i * 3, p = S.age[i] / S.life[i], sd = S.seed[i] * 6.283;
      if (S.kind[i] === 1) {
        const dr = Math.exp(-dt * 2.2);
        S.V[i3] *= dr; S.V[i3 + 2] *= dr; S.V[i3 + 1] = S.V[i3 + 1] * dr + 0.12 * dt;
      } else {
        // curling sideways drift
        S.V[i3] += Math.cos(t * 2.3 + sd + p * 4) * 0.12 * dt - 0.02 * dt;
        S.V[i3 + 2] += Math.sin(t * 1.9 + sd * 1.3 + p * 3) * 0.1 * dt;
      }
      S.P[i3] += S.V[i3] * dt; S.P[i3 + 1] += S.V[i3 + 1] * dt; S.P[i3 + 2] += S.V[i3 + 2] * dt;
      const size = S.s0[i] + (S.s1[i] - S.s0[i]) * (1 - Math.pow(1 - p, 1.5));
      const a = S.a0[i] * smooth(0, 0.15, p) * (1 - smooth(0.3, 1, p));
      const st = S.kind[i] === 1 ? 0 : size * (0.6 + 1.6 * p);
      S.out(i, S.P[i3], S.P[i3 + 1], S.P[i3 + 2], size, 0, 0.96, 0.97, 0.98, a, S.V[i3] * st * 2, st, S.V[i3 + 2] * st * 2);
    }
    S.flush();
  }

  // ---------- geometry helpers ----------
  function merge(geos) {
    const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of list) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += c;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return m;
  }

  // ---------- small flame shader (lighter) ----------
  const tinyFlameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uOn; varying vec2 vUv;
      void main(){
        float y = vUv.y; float x = (vUv.x - 0.5) * 2.0;
        x += sin(uTime * 13.0 + y * 4.0) * 0.06 * y;
        float w = sqrt(clamp(y / 0.25, 0.0, 1.0)) * pow(clamp(1.0 - y, 0.0, 1.0), 0.7);
        float b = smoothstep(0.0, 0.7, clamp(1.0 - abs(x) / max(w, 1e-3), 0.0, 1.0));
        vec3 blue = vec3(0.25, 0.45, 1.0), yel = vec3(1.0, 0.72, 0.28), wht = vec3(1.0, 0.92, 0.75);
        vec3 c = mix(blue, yel, smoothstep(0.12, 0.42, y));
        c = mix(c, wht, b * smoothstep(0.25, 0.45, y) * (1.0 - smoothstep(0.55, 0.9, y)) * 0.7);
        float a = b * mix(0.55, 1.0, smoothstep(0.1, 0.35, y)) * uOn * smoothstep(0.0, 0.05, y);
        gl_FragColor = vec4(c * 1.4, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });

  // ---------- lighter ----------
  const lighter = (() => {
    const root = new THREE.Group(); root.name = 'lighter';
    // local frame: long axis along Z, tip toward −Z; trigger hangs down (−Y) when held; origin = mid-length
    const GRIP_BACK = 0.13, GRIP_FRONT = 0.02, TIP_Z = -0.13;
    // grip: lathe profile along the axis, oval cross-section
    const prof = [];
    const L = GRIP_BACK - GRIP_FRONT;
    const radAt = (u) => { // u 0 back .. 1 front
      const back = Math.sqrt(clamp(u / 0.06, 0, 1));
      const neck = 1 - 0.5 * smooth(0.72, 1.0, u);
      const belly = 1 + 0.08 * Math.sin(u * Math.PI);
      return 0.0135 * back * neck * belly * (u > 0.995 ? 0.6 : 1);
    };
    for (let k = 0; k <= 24; k++) { const u = k / 24; prof.push(new THREE.Vector2(Math.max(0.0005, radAt(u)), u * L)); }
    const gripGeo = new THREE.LatheGeometry(prof, 20);
    gripGeo.rotateX(-Math.PI / 2); // lathe Y → −Z
    gripGeo.scale(0.78, 1.18, 1);
    gripGeo.translate(0, 0, GRIP_BACK);
    gripGeo.computeVertexNormals();
    const plastic = new THREE.MeshStandardMaterial({ color: 0x9a2a22, roughness: 0.38, metalness: 0.0 });
    const grip = new THREE.Mesh(gripGeo, plastic);
    // trigger + safety slider + collar (black plastic, merged)
    const trig = new THREE.BoxGeometry(0.008, 0.016, 0.022, 1, 1, 1); trig.translate(0, -0.019, 0.052);
    const trig2 = new THREE.CylinderGeometry(0.004, 0.004, 0.0085, 8); trig2.rotateZ(Math.PI / 2); trig2.translate(0, -0.026, 0.052);
    const slider = new THREE.BoxGeometry(0.007, 0.004, 0.014); slider.translate(0, 0.0165, 0.075);
    const collar = new THREE.CylinderGeometry(0.0062, 0.0075, 0.012, 14); collar.rotateX(Math.PI / 2); collar.translate(0, 0, GRIP_FRONT - 0.001);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5, metalness: 0.0 });
    const dark = new THREE.Mesh(merge([trig, trig2, slider, collar]), darkMat);
    // metal tube + nozzle (lathe)
    const tp = [];
    const TL = GRIP_FRONT - TIP_Z;
    const tubeR = (u) => (u < 0.9 ? 0.0035 : u < 0.92 ? 0.0035 + 0.001 * smooth(0.9, 0.92, u) : 0.0045);
    tp.push(new THREE.Vector2(0.0001, 0));
    for (let k = 0; k <= 30; k++) { const u = k / 30; tp.push(new THREE.Vector2(tubeR(u), u * TL)); }
    tp.push(new THREE.Vector2(0.0028, TL)); tp.push(new THREE.Vector2(0.0024, TL - 0.002));
    const tubeGeo = new THREE.LatheGeometry(tp, 14);
    tubeGeo.rotateX(-Math.PI / 2); tubeGeo.translate(0, 0, GRIP_FRONT);
    tubeGeo.computeVertexNormals();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bbbd, roughness: 0.3, metalness: 1.0 });
    const tube = new THREE.Mesh(tubeGeo, metal);
    for (const m of [grip, dark, tube]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
    scene.add(root);
    // flame (world-space billboard)
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.03), tinyFlameMat);
    flame.geometry.translate(0, 0.012, 0);
    flame.frustumCulled = false; flame.renderOrder = 6; flame.visible = false;
    scene.add(flame);
    const light = new THREE.PointLight(0xffa040, 0, 0.8, 2); scene.add(light);
    const tipLocal = new THREE.Vector3(0, 0, TIP_Z - 0.002);
    const backLocal = new THREE.Vector3(0, 0, GRIP_BACK);
    const REST_Y = 0.0105; // half thickness when lying on its side
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    root.position.set(LIGHTER_REST.x, REST_Y, LIGHTER_REST.z); root.quaternion.copy(restQ);
    const st = { mode: 'rest', att: 0, flame: 0, flameOn: false, target: new THREE.Vector3().copy(root.position), q: restQ.clone(), restYaw: 0, rockPh: 0 };
    const tip = new THREE.Vector3();
    return {
      object3D: root,
      setAttention(k) { st.att = clamp(+k || 0, 0, 1); },
      hold(point) {
        if (!isV3(point)) return;
        const px = clamp(point.x, -2.5, 2.5), pz = clamp(point.z, -2.5, 3);
        // direction toward the pile centre, slightly down
        tmpV.set(ctr.x - px, 0, ctr.z - pz);
        if (tmpV.lengthSq() < 1e-4) tmpV.set(0, 0, -1);
        tmpV.normalize();
        const dir = tmpV2.set(tmpV.x, -0.24, tmpV.z).normalize();
        tmpM.lookAt(tmpV3.set(0, 0, 0), dir, UPV);
        st.q.setFromRotationMatrix(tmpM);
        st.target.set(px + tmpV.x * 0.07, Math.max(0.05, (point.y || 0) + 0.12), pz + tmpV.z * 0.07);
        const first = st.mode !== 'held';
        st.mode = 'held';
        if (first) { // first frame must already move
          root.position.lerp(st.target, 0.3); root.quaternion.slerp(st.q, 0.3);
        }
      },
      release() {
        if (st.mode === 'rest') return;
        st.mode = 'rest';
        // lie flat where it is, keep the heading (yaw)
        tmpV.set(0, 0, -1).applyQuaternion(root.quaternion); tmpV.y = 0;
        if (tmpV.lengthSq() < 1e-4) tmpV.set(0, 0, -1);
        const yaw = Math.atan2(-tmpV.x, -tmpV.z);
        st.q.setFromEuler(tmpE.set(0, yaw, Math.PI / 2, 'YXZ'));
        st.target.set(root.position.x, REST_Y, root.position.z);
      },
      setFlame(on) { st.flameOn = !!on; },
      get tip() { root.updateMatrixWorld(); return root.localToWorld(new THREE.Vector3().copy(tipLocal)); },
      hit(ray) {
        if (!ray || !ray.origin) return false;
        root.updateMatrixWorld();
        root.localToWorld(tmpV.copy(tipLocal)); root.localToWorld(tmpV2.copy(backLocal));
        return ray.distanceSqToSegment(tmpV, tmpV2) < 0.12 * 0.12;
      },
      update(dt) {
        const held = st.mode === 'held';
        const lam = held ? 1 / 0.08 * 1.6 : 9;
        root.position.x = damp(root.position.x, st.target.x, lam, dt);
        root.position.y = damp(root.position.y, st.target.y, held ? lam : 12, dt);
        root.position.z = damp(root.position.z, st.target.z, lam, dt);
        root.quaternion.slerp(st.q, 1 - Math.exp(-(held ? 18 : 10) * dt));
        if (!held && st.att > 0.001 && root.position.distanceTo(st.target) < 0.02) {
          st.rockPh += dt * 1.2 * 6.283;
          tmpQ.setFromAxisAngle(tmpV.set(0, 0, 1), Math.sin(st.rockPh) * 0.22 * st.att);
          root.quaternion.copy(st.q).multiply(tmpQ);
          root.position.y = REST_Y + Math.abs(Math.sin(st.rockPh)) * 0.004 * st.att;
        }
        st.flame = damp(st.flame, st.flameOn ? 1 : 0, st.flameOn ? 25 : 14, dt);
        root.updateMatrixWorld();
        root.localToWorld(tip.copy(tipLocal));
        flame.visible = st.flame > 0.01;
        if (flame.visible) {
          flame.position.copy(tip);
          const cam = G.camera;
          if (cam) { flame.rotation.set(0, Math.atan2(cam.position.x - tip.x, cam.position.z - tip.z), 0); }
          const fl = 1 + Math.sin(t * 23) * 0.04 + Math.sin(t * 37) * 0.03;
          flame.scale.set(st.flame, st.flame * fl, st.flame);
          tinyFlameMat.uniforms.uOn.value = st.flame;
        }
        light.position.copy(tip); light.position.y += 0.02;
        light.intensity = st.flame * 0.25 * (1 + Math.sin(t * 29) * 0.08);
      },
    };
  })();

  // ---------- uchiwa ----------
  const uchiwa = (() => {
    const root = new THREE.Group(); root.name = 'uchiwa';
    const OFF = 0.225; // local origin = middle of the overall length
    const RX = 0.125, RYT = 0.135, RYB = 0.105, CY = 0.28, JY = 0.18;
    // outline points (local, before offset)
    const pts = [];
    const N = 96;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const top = s >= 0;
      const ex = top ? 2.4 : 3.6;
      const x = RX * Math.sign(c) * Math.pow(Math.abs(c), 2 / ex);
      let y = (top ? RYT : RYB) * Math.sign(s) * Math.pow(Math.abs(s), 2 / ex);
      if (!top) y += 0.012 * Math.pow(Math.abs(c), 4); // bottom edge sweeps up slightly into the shoulders
      pts.push(new THREE.Vector2(x, CY + y));
    }
    const shape = new THREE.Shape(pts);
    const faceGeo = new THREE.ShapeGeometry(shape, 24);
    const minY = CY - RYB, maxY = CY + RYT;
    const uvA = faceGeo.attributes.uv, pA = faceGeo.attributes.position;
    for (let k = 0; k < pA.count; k++) uvA.setXY(k, (pA.getX(k) + RX) / (2 * RX), (pA.getY(k) - minY) / (maxY - minY));
    faceGeo.translate(0, -OFF, 0);
    // paper texture
    const paper = canvasTex(512, (ctx, S) => {
      const toC = (x, y) => [((x + RX) / (2 * RX)) * S, (1 - (y - minY) / (maxY - minY)) * S];
      ctx.fillStyle = '#ece6d6'; ctx.fillRect(0, 0, S, S);
      // fibres
      for (let k = 0; k < 900; k++) {
        const x = Math.random() * S, y = Math.random() * S, l = rnd(6, 26), a = rnd(0, 6.283);
        ctx.strokeStyle = Math.random() < 0.55 ? `rgba(255,255,250,${rnd(0.08, 0.22)})` : `rgba(150,128,96,${rnd(0.04, 0.1)})`;
        ctx.lineWidth = rnd(0.5, 1.3);
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
      // soft mottling
      for (let k = 0; k < 60; k++) {
        const x = Math.random() * S, y = Math.random() * S, r = rnd(20, 70);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,252,240' : '200,185,160'},0.07)`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      // indigo wash across the lower third (watercolour-ish, uneven edge)
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      const g = ctx.createLinearGradient(0, S, 0, S * 0.52);
      g.addColorStop(0, 'rgba(40,64,118,0.92)'); g.addColorStop(0.35, 'rgba(62,92,146,0.72)');
      g.addColorStop(0.75, 'rgba(110,140,186,0.28)'); g.addColorStop(1, 'rgba(160,180,210,0)');
      ctx.fillStyle = g; ctx.fillRect(0, S * 0.5, S, S * 0.5);
      for (let k = 0; k < 40; k++) {
        const x = Math.random() * S, y = S * rnd(0.6, 0.78), r = rnd(15, 45);
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
        gg.addColorStop(0, 'rgba(80,108,160,0.22)'); gg.addColorStop(1, 'rgba(80,108,160,0)');
        ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.restore();
      // ribs radiating from the handle junction
      const [jx, jy] = toC(0, JY);
      const NR = 40;
      for (let k = 0; k < NR; k++) {
        const a = Math.PI * (0.03 + 0.94 * (k / (NR - 1)));
        const ex = jx + Math.cos(a) * S * 1.2, ey = jy - Math.sin(a) * S * 1.2;
        ctx.strokeStyle = 'rgba(92,74,50,0.26)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,248,0.16)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(jx + 1.6, jy + 0.5); ctx.lineTo(ex + 1.6, ey + 0.5); ctx.stroke();
      }
      // denser shading where ribs bunch near the junction
      const gj = ctx.createRadialGradient(jx, jy, 0, jx, jy, S * 0.22);
      gj.addColorStop(0, 'rgba(120,96,60,0.35)'); gj.addColorStop(1, 'rgba(120,96,60,0)');
      ctx.fillStyle = gj; ctx.fillRect(0, 0, S, S);
      // edge binding
      ctx.beginPath();
      pts.forEach((p, k) => { const [x, y] = toC(p.x, p.y); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(58,52,58,0.95)'; ctx.lineWidth = 11; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
    });
    paper.colorSpace = THREE.SRGBColorSpace;
    paper.anisotropy = 4;
    const faceMat = new THREE.MeshStandardMaterial({
      map: paper, side: THREE.DoubleSide, roughness: 0.88, metalness: 0,
      emissive: 0xfff2dc, emissiveMap: paper, emissiveIntensity: 0.07,
    });
    const face = new THREE.Mesh(faceGeo, faceMat);
    // bamboo: handle + bow ("window") + a central spine on the back
    const handle = new THREE.CylinderGeometry(0.0058, 0.0064, 0.15, 10); handle.scale(1, 1, 0.72); handle.translate(0, 0.035 + 0.075 - OFF, 0);
    const node = new THREE.TorusGeometry(0.0062, 0.0011, 4, 12); node.rotateX(Math.PI / 2); node.scale(1, 1, 0.72); node.translate(0, 0.09 - OFF, 0);
    const bow = new THREE.TorusGeometry(0.032, 0.0018, 4, 18, Math.PI * 0.82); bow.rotateZ(Math.PI * 0.09); bow.translate(0, JY - OFF - 0.004, -0.0025);
    const spine = new THREE.BoxGeometry(0.003, 0.05, 0.002); spine.translate(0, JY + 0.02 - OFF, -0.0018);
    const bambooMat = new THREE.MeshStandardMaterial({ color: 0xc19a62, roughness: 0.55, metalness: 0 });
    const bamboo = new THREE.Mesh(merge([handle, node, bow, spine]), bambooMat);
    for (const m of [face, bamboo]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }
    scene.add(root);
    const GRIP = new THREE.Vector3(0, 0.07 - OFF, 0); // where the hand holds it
    const REST_Y = 0.008;
    const restQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    root.position.set(UCHIWA_REST.x, REST_Y, UCHIWA_REST.z);
    root.quaternion.copy(restQ);
    const st = { active: false, att: 0, ph: 0, yaw: 0, yawV: 0, roll: 0, rollV: 0, x: 0, wind: 0, lastDx: 0, lastDz: 0, lastFan: -1, prevVx: 0, prevVz: 0, up: 0 };
    const posT = new THREE.Vector3(), qT = new THREE.Quaternion(), qUp = new THREE.Quaternion();
    const segA = new THREE.Vector3(), segB = new THREE.Vector3();
    return {
      object3D: root,
      setAttention(k) { st.att = clamp(+k || 0, 0, 1); },
      fan(active, point, vx, vz) {
        vx = clamp(+vx || 0, -8, 8); vz = clamp(+vz || 0, -8, 8);
        if (!active) { st.active = false; st.prevVx = 0; st.prevVz = 0; return st.wind; }
        const first = !st.active;
        st.active = true;
        if (isV3(point)) st.x = clamp(point.x * 0.6, -0.45, 0.45);
        if (first) { st.yaw = 0; st.yawV = 0; st.roll = 0; st.rollV = 0; }
        // springy follow of lateral velocity
        st.yawT = clamp(-vx * 0.32, -1.0, 1.0);
        st.rollT = clamp(vx * 0.1, -0.3, 0.3);
        const sp = Math.hypot(vx, vz);
        const dv = Math.hypot(vx - st.prevVx, vz - st.prevVz);
        st.prevVx = vx; st.prevVz = vz;
        if (sp > 0.3) st.wind += Math.min(dv, 4) * 0.035;
        if (sp > 0.5) {
          const dx = vx / sp, dz = vz / sp;
          const dot = dx * st.lastDx + dz * st.lastDz;
          if (st.lastDx === 0 && st.lastDz === 0 || dot < -0.2) {
            const k = clamp(sp / 2.2, 0.3, 1);
            st.wind += 0.22 * k + (dot < -0.2 ? 0.08 : 0);
            if (t - st.lastFan >= 0.12) { st.lastFan = t; audio('fan', k); }
            st.lastDx = dx; st.lastDz = dz;
          }
        } else if (sp < 0.15) { st.lastDx = 0; st.lastDz = 0; }
        st.wind = clamp(st.wind, 0, 1);
        if (first) { // first frame must already move
          root.position.y += 0.03;
        }
        return st.wind;
      },
      hit(ray) {
        if (!ray || !ray.origin) return false;
        root.updateMatrixWorld();
        root.localToWorld(segA.set(0, 0.035 - OFF, 0)); root.localToWorld(segB.set(0, CY + 0.06 - OFF, 0));
        return ray.distanceSqToSegment(segA, segB) < 0.14 * 0.14;
      },
      get wind() { return st.wind; },
      update(dt) {
        st.wind = clamp(st.wind * Math.exp(-dt / 0.8), 0, 1);
        if (st.active) {
          // springy flap
          const k = 260, c = 16;
          st.yawV += (k * ((st.yawT || 0) - st.yaw) - c * st.yawV) * dt; st.yaw += st.yawV * dt;
          st.rollV += (k * ((st.rollT || 0) - st.roll) - c * st.rollV) * dt; st.roll += st.rollV * dt;
          st.yaw = clamp(st.yaw, -1.3, 1.3); st.roll = clamp(st.roll, -0.5, 0.5);
          qT.setFromEuler(tmpE.set(-0.22, st.yaw, st.roll, 'YXZ'));
          root.quaternion.slerp(qT, 1 - Math.exp(-30 * dt));
          // centre target (0.22 high), positioned via the grip so it pivots at the hand
          posT.set(st.x, 0.22, 0.95);
          tmpV.copy(GRIP).applyQuaternion(root.quaternion);
          const hand = tmpV2.set(posT.x, posT.y + GRIP.y, posT.z); // hand location
          tmpV3.copy(hand).sub(tmpV);
          root.position.x = damp(root.position.x, tmpV3.x, 30, dt);
          root.position.y = damp(root.position.y, tmpV3.y, 30, dt);
          root.position.z = damp(root.position.z, tmpV3.z, 30, dt);
        } else {
          st.yaw = damp(st.yaw, 0, 6, dt); st.roll = damp(st.roll, 0, 6, dt);
          qT.copy(restQ);
          let ry = REST_Y;
          if (st.att > 0.001) {
            st.ph += dt * 1.2 * 6.283;
            const s = Math.sin(st.ph);
            qUp.setFromEuler(tmpE.set(Math.max(0, s) * 0.12 * st.att, 0, s * 0.1 * st.att));
            qT.multiply(qUp);
            ry += Math.max(0, s) * 0.01 * st.att;
          }
          root.quaternion.slerp(qT, 1 - Math.exp(-10 * dt));
          root.position.x = damp(root.position.x, UCHIWA_REST.x, 8, dt);
          root.position.y = damp(root.position.y, ry, 10, dt);
          root.position.z = damp(root.position.z, UCHIWA_REST.z, 8, dt);
        }
      },
    };
  })();

  // ---------- update ----------
  const lean = flameMat.uniforms.uLean.value;
  function updFlames(dt) {
    let show = levelE;
    if (ignP < 1) {
      ignP = Math.min(1, ignP + dt / 1.5);
      const e = smooth(0, 1, ignP);
      ctr.x = ignFrom.x + (PILE.x - ignFrom.x) * e;
      ctr.z = ignFrom.z + (PILE.z - ignFrom.z) * e;
      show = 0.12 + (levelE - 0.12) * e;
      if (levelT <= 0.001 && ignP >= 1) show = levelE;
    }
    const spread = ignP < 1 ? 0.25 + 0.75 * smooth(0, 1, ignP) : 1;
    const w = windE;
    let n = 0;
    for (let i = 0; i < NT; i++) {
      const s = slots[i];
      const amp = smooth(s.th, s.th + 0.14, show);
      if (amp <= 0.002) continue;
      // at low levels the first tongues sit at the front base; they move in as the fire grows
      const rr = s.r * spread * (0.6 + 0.4 * clamp(show * 1.6, 0, 1));
      const x = ctr.x + Math.cos(s.ang) * rr, z = ctr.z + Math.sin(s.ang) * rr;
      const domeY = baseY * (1 - 0.45 * Math.pow(clamp(rr / 0.34, 0, 1), 2)) - 0.03;
      const fl = 0.78 + 0.22 * Math.sin(t * 3.1 * s.sp + s.ph) * Math.sin(t * 1.7 * s.sp + s.ph * 1.7)
        + 0.12 * Math.sin(t * 7.3 * s.sp + s.ph * 2.3);
      const lvl = 0.3 + 0.7 * clamp(show, 0, 1);
      const h = s.h * lvl * (0.45 + 0.55 * amp) * fl * (1 + 0.35 * w) * (show < 0.25 ? 0.75 : 1);
      const wd = s.w * (0.55 + 0.45 * lvl) * (0.6 + 0.4 * amp);
      fPos[n * 3] = x; fPos[n * 3 + 1] = Math.max(0, domeY); fPos[n * 3 + 2] = z;
      fPar[n * 4] = wd; fPar[n * 4 + 1] = h; fPar[n * 4 + 2] = s.seed; fPar[n * 4 + 3] = amp * (0.75 + 0.25 * fl) * (0.8 + 0.25 * w);
      n++;
    }
    flameGeo.instanceCount = n;
    flames.visible = n > 0;
    if (n > 0) { fPosA.needsUpdate = true; fParA.needsUpdate = true; }
    lean.set(-0.12 + Math.sin(t * 0.6) * 0.05, 0.12 * w, -0.85 * w);
    flameMat.uniforms.uFlutter.value = 0.07 + 0.16 * w;
    flameMat.uniforms.uHot.value = w;
    flameMat.uniforms.uTime.value = t;
    // light + glow
    const flick = 1 + 0.16 * Math.sin(t * 11.3) * Math.sin(t * 7.1 + 1.3) + 0.1 * Math.sin(t * 23.7) + 0.06 * Math.sin(t * 3.3);
    const lv = clamp(show, 0, 1) * (1 + 0.45 * w);
    fireLight.position.set(ctr.x, baseY + 0.25, ctr.z + 0.05);
    fireLight.intensity = lv * 3.2 * flick;
    fireLight.visible = lv > 0.002;
    glow.visible = lv > 0.002;
    glow.position.set(ctr.x, 0.02, ctr.z);
    const gs = 0.5 + 0.5 * clamp(lv, 0, 1.2);
    glow.scale.set(gs, gs, 1);
    glowMat.opacity = clamp(lv, 0, 1.3) * 0.32 * (0.9 + 0.1 * flick);
    return show;
  }

  const api = {
    ignite(pos) {
      if (!isV3(pos)) pos = tmpV.set(PILE.x, baseY, PILE.z + 0.25);
      if (levelE > 0.08 && ignP >= 1) { sparks(tmpV2.set(pos.x, Math.max(pos.y, baseY * 0.6), pos.z), 4, 0.5); return; }
      ignFrom.set(clamp(pos.x, -1, 1), 0, clamp(pos.z, -1, 1.2));
      ctr.x = ignFrom.x; ctr.z = ignFrom.z;
      ignP = 0;
      sparks(tmpV2.set(pos.x, Math.max(pos.y, baseY * 0.6), pos.z), 5, 0.5);
    },
    setLevel(k) { levelT = clamp(+k || 0, 0, 1); },
    setSmoke(k) { smokeT = clamp(+k || 0, 0, 1); },
    setWind(k) { windT = clamp(+k || 0, 0, 1); },
    setBaseY(y) { baseYT = clamp(+y || 0, 0, 0.8); },
    sparks(pos, n = 10, power = 1) { safe(() => sparks(pos, n, power)); },
    ashPuff(pos, power = 1) { safe(() => ashPuff(pos, power)); audio('ashPuff'); },
    steamAt(target, rate = 1) { return steamAt(target, rate); },
    steamBurst(pos, power = 1) { safe(() => steamBurst(pos, power)); },
    smokeFace() { safe(smokeFace); },
    get level() { return levelE; },
    lighter, uchiwa,
    update(dt) {
      dt = clamp(+dt || 0, 0, 0.05);
      t += dt;
      faceCooldown = Math.max(0, faceCooldown - dt);
      levelE = damp(levelE, levelT, 6, dt);
      if (Math.abs(levelE - levelT) < 1e-4) levelE = levelT;
      smokeE = damp(smokeE, smokeT, 3, dt);
      windE = damp(windE, windT, windT > windE ? 10 : 3, dt);
      baseY = damp(baseY, baseYT, 4, dt);
      const show = updFlames(dt);
      // smoke emission
      if (smokeE > 0.01) {
        smokeAcc += dt * (2.5 + 15 * smokeE) * (0.6 + 0.4 * particlesQ());
        let g = 0; while (smokeAcc >= 1 && g++ < 4) { smokeAcc -= 1; emitSmoke(smokeE); }
        if (smokeAcc > 1) smokeAcc = 1;
      }
      // ambient sparks from the fire
      if (show > 0.25) {
        sparkAcc += dt * ((show - 0.2) * 4 + windE * 18);
        let g = 0;
        while (sparkAcc >= 1 && g++ < 4) {
          sparkAcc -= 1;
          const a = rnd(0, 6.283), r = rnd(0, 0.2);
          sparks(tmpV.set(ctr.x + Math.cos(a) * r, baseY + 0.05 + rnd(0, 0.15), ctr.z + Math.sin(a) * r), 1, 0.7 + 0.5 * windE);
        }
        if (sparkAcc > 1) sparkAcc = 1;
      }
      updSmoke(dt); updSparks(dt); updAsh(dt); updSteam(dt);
      lighter.update(dt); uchiwa.update(dt);
    },
  };
  return api;
}
