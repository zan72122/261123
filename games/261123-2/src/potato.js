// POTATO — sweet potatoes (satsumaimo): raw / roasted / halves / bites, and the fire tongs.
import * as THREE from 'three';

export function create(G) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); };
  const easeIn = (t) => { t = clamp(t, 0, 1); return t * t; };
  const dk = (l, dt) => 1 - Math.exp(-l * dt);
  const fin = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);
  const X = new V3(1, 0, 0), Y = new V3(0, 1, 0), Zax = new V3(0, 0, 1);
  const VARS = ['yellow', 'purple', 'orange'];
  const BITES = 2;
  const STATES = ['basket', 'held', 'buried', 'ash', 'tongs', 'zaru', 'open', 'eaten'];

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const call = (mod, fn, ...a) => { try { const o = G[mod]; if (o && typeof o[fn] === 'function') return o[fn](...a); } catch (e) { /* ignore */ } return undefined; };
  const snd = (fn, ...a) => call('audio', fn, ...a);
  function anchor(name, fx, fy, fz, out) {
    let a = null;
    try { const an = G.world && G.world.anchors; a = an && an[name]; } catch (e) { a = null; }
    if (a && a.isVector3) return out.copy(a);
    return out.set(fx, fy, fz);
  }
  function pileNum(key, fb) {
    try { const p = G.leaves && G.leaves.pile; const v = p && p[key]; if (typeof v === 'number' && isFinite(v)) return v; } catch (e) { /* */ }
    return fb;
  }

  // ---------------------------------------------------------------- textures & materials
  function texRep(name, rx, ry) {
    const t0 = G.tex && G.tex[name];
    if (!t0) return null;
    const t = t0.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true;
    return t;
  }
  function nrm(t, s) { try { return t && G.util && G.util.normalFrom ? G.util.normalFrom(t, s) : null; } catch (e) { return null; } }

  const skinTex = texRep('potato_skin', 2, 1), skinN = nrm(skinTex, 3);
  const roastTex = texRep('potato_roast', 2, 1), roastN = nrm(roastTex, 3.5);

  // skin detail shared by raw + roasted skin: darker ends, longitudinal streaks, little root-eye scars
  const SKIN_FS = (fs) => fs
    .replace('#include <common>', `#include <common>
      float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      {
        vec2 su = vMapUv;
        float ends = smoothstep(0.0, 0.16, su.y) * smoothstep(1.0, 0.8, su.y);
        diffuseColor.rgb *= mix(vec3(0.62, 0.52, 0.5), vec3(1.0), ends);
        float st = sin(su.x * 6.2832 * 3.0 + sin(su.y * 9.0) * 1.3) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.9 + 0.12 * st;
        vec2 g = vec2(su.x * 5.0, su.y * 11.0);
        vec2 cell = floor(g); vec2 fp = fract(g) - 0.5;
        float h = pHash(cell);
        if (h > 0.6) {
          vec2 o = vec2(pHash(cell + 3.1), pHash(cell + 7.7)) - 0.5;
          vec2 d = (fp - o * 0.5) * vec2(0.7, 3.2);
          float eye = 1.0 - smoothstep(0.06, 0.16, length(d));
          float halo = (1.0 - smoothstep(0.12, 0.3, length(d))) * (1.0 - eye);
          diffuseColor.rgb *= 1.0 - 0.55 * eye;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.1, 1.05) + 0.02, halo * 0.35);
        }
      }
      #endif`);
  function makeRawMat() {
    const m = new THREE.MeshStandardMaterial({ map: skinTex, normalMap: skinN, roughness: 0.58, metalness: 0 });
    if (!skinTex) m.color.setRGB(0.42, 0.1, 0.18);
    if (skinN) m.normalScale.set(0.75, 0.75);
    m.onBeforeCompile = (sh) => { sh.fragmentShader = SKIN_FS(sh.fragmentShader); };
    m.customProgramCacheKey = () => 'potato-raw';
    return m;
  }
  const DUST_VS = (vs) => vs
    .replace('#include <common>', '#include <common>\nvarying vec3 vWN;\nvarying vec3 vOP;')
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvOP = position;');
  const DUST_FS = (fs) => fs
    .replace('#include <common>', '#include <common>\nuniform float uDust;\nuniform sampler2D tDustN;\nvarying vec3 vWN;\nvarying vec3 vOP;')
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float n1 = texture2D(tDustN, vOP.xz * 9.0 + vOP.y * 4.0).r;
        float n2 = texture2D(tDustN, vOP.xy * 31.0 + vOP.z * 7.0).g;
        float n = clamp(n1 * 0.75 + n2 * 0.5 - 0.15, 0.0, 1.0);
        float up = smoothstep(-0.25, 0.8, vWN.y);
        float d = clamp(uDust * (0.18 + 0.82 * up) * (0.35 + 0.9 * n), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.47, 0.45, 0.42), smoothstep(0.1, 0.9, d) * 0.85);
      }`);
  const dustNoise = (G.util && G.util.noiseTex) || (() => {
    const d = new Uint8Array(64 * 64 * 4); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 255;
    const t = new THREE.DataTexture(d, 64, 64); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
  })();
  function makeRoastMat() {
    const m = new THREE.MeshStandardMaterial({ map: roastTex, normalMap: roastN, roughness: 0.9, metalness: 0 });
    m.color.setRGB(roastTex ? 0.56 : 0.2, roastTex ? 0.42 : 0.1, roastTex ? 0.40 : 0.08);
    if (roastN) m.normalScale.set(1.1, 1.1);
    const u = { uDust: { value: 0 } };
    m.userData.u = u;
    m.onBeforeCompile = (sh) => { sh.uniforms.uDust = u.uDust; sh.uniforms.tDustN = { value: dustNoise }; sh.vertexShader = DUST_VS(sh.vertexShader); sh.fragmentShader = DUST_FS(SKIN_FS(sh.fragmentShader)); };
    m.customProgramCacheKey = () => 'potato-roast-dust';
    return m;
  }
  function makeFleshMat(v) {
    const t = texRep('flesh_' + v, 1, 1), n = nrm(t, 2.5);
    const m = new THREE.MeshStandardMaterial({ map: t, normalMap: n, roughness: 0.44, metalness: 0 });
    if (!t) m.color.set(v === 'purple' ? 0x7a2a8a : v === 'orange' ? 0xe08a20 : 0xf0c040);
    if (n) m.normalScale.set(0.9, 0.9);
    // gentle warm "inner glow" of hot moist flesh (very slight, reads as subsurface, not as a light)
    m.emissive.set(v === 'purple' ? 0x1a0620 : v === 'orange' ? 0x2a1000 : 0x261800);
    m.emissiveMap = t;
    const ring = v === 'purple' ? '0.62, 0.45, 0.66' : v === 'orange' ? '0.82, 0.58, 0.40' : '0.86, 0.66, 0.40';
    const avg = v === 'purple' ? '0.24, 0.03, 0.36' : v === 'orange' ? '0.88, 0.30, 0.03' : '0.90, 0.48, 0.05';
    const skin = '0.20, 0.07, 0.08';
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRad;\nvarying float vRad;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRad = aRad;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRad;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float fC = 1.0 - smoothstep(0.0, 0.85, vRad);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${avg}), 0.5);
          diffuseColor.rgb *= 0.84 + 0.36 * fC;
          float fR = smoothstep(0.74, 0.86, vRad) * (1.0 - smoothstep(0.90, 0.955, vRad));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(${ring}), fR);
          float fS = smoothstep(0.95, 0.985, vRad);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${skin}), fS);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor * (0.78 + 0.3 * vRad), 0.92, smoothstep(0.95, 0.985, vRad));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance *= (0.4 + 0.9 * fC) * (1.0 - fS);`);
    };
    m.customProgramCacheKey = () => 'potato-flesh-' + v;
    return m;
  }
  const fleshMats = {}; for (const v of VARS) fleshMats[v] = makeFleshMat(v);
  const scrapMat = new THREE.MeshStandardMaterial({ map: roastTex, roughness: 0.95, side: THREE.DoubleSide });
  scrapMat.color.setRGB(0.42, 0.3, 0.28);
  scrapMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.44, 0.22), 0.7);`);
  };
  scrapMat.customProgramCacheKey = () => 'potato-scrap';

  // ---------------------------------------------------------------- shape
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _T = new V3(), _N = new V3(), _B = new V3();
  function makeShape(seed, scale) {
    const r = rng(seed);
    const L = lerp(0.16, 0.22, r()) * scale;
    const R = L / (2 * lerp(2.9, 3.35, r()));
    const bend = (7 + 9 * r()) * PI / 180;
    const phi = r() * TAU;
    const bdir = new V3(0, Math.cos(phi), Math.sin(phi));
    const sag = L * bend / 8 * 4;
    const kS = lerp(0.85, 1.15, r()), pH = lerp(0.5, 0.6, r()), pT = lerp(0.75, 0.95, r()), aH = lerp(2.0, 2.6, r()), aT = lerp(1.5, 1.9, r());
    const ell = lerp(0.05, 0.12, r()), ellA = r() * PI, gph = r() * TAU, gA = lerp(0.012, 0.03, r());
    const lumps = []; const nl = 2 + (r() < 0.6 ? 1 : 0);
    for (let k = 0; k < nl; k++) lumps.push({ t: lerp(0.18, 0.82, r()), th: r() * TAU, a: (r() < 0.5 ? -1 : 1) * lerp(0.05, 0.12, r()), wt: lerp(0.1, 0.22, r()), wa: lerp(0.6, 1.2, r()) });
    const tb = lerp(0.45, 0.55, r());
    const tp = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
    const biteA = [r() * TAU, r() * TAU, r() * TAU], biteB = [r() * TAU, r() * TAU, r() * TAU];
    const nub = lerp(0.09, 0.13, r());
    const S = { L, R, tb, seed };
    S.centre = (t, out) => { t = clamp(t, 0, 1); return out.set((t - 0.5) * L, 0, 0).addScaledVector(bdir, sag * t * (1 - t)); };
    S.tangent = (t, out) => { t = clamp(t, 0, 1); return out.set(L, 0, 0).addScaledVector(bdir, sag * (1 - 2 * t)).normalize(); };
    S.frame = (t, T, N, B) => { S.tangent(t, T); N.copy(Y).addScaledVector(T, -T.y).normalize(); B.crossVectors(T, N); };
    S.r0 = (t) => {
      t = clamp(t, 0, 1);
      const s = Math.pow(t, kS);
      const x = 2 * s - 1;
      // super-ellipse ends: blunt rounded head, longer tapering tail
      const a = x < 0 ? aH : aT, b = x < 0 ? pH : pT;
      let rr = R * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x), a)), b);
      rr = Math.max(rr, R * nub * smooth(0.7, 0.9, t) * (1 - smooth(0.982, 1.0, t)));
      return rr;
    };
    S.radius = (t, th) => {
      t = clamp(t, 0, 1);
      let f = 1 + ell * Math.cos(2 * (th - ellA)) + gA * Math.sin(5 * th + gph) * Math.sin(PI * t);
      for (const l of lumps) {
        let d = Math.abs(((th - l.th) % TAU + TAU) % TAU); if (d > PI) d = TAU - d;
        const dt = (t - l.t) / l.wt, da = d / l.wa;
        f += l.a * Math.exp(-dt * dt - da * da);
      }
      return S.r0(t) * f;
    };
    S.surf = (t, th, out) => {
      t = clamp(t, 0, 1);
      S.frame(t, _T, _N, _B);
      const rr = S.radius(t, th);
      return S.centre(t, out).addScaledVector(_N, rr * Math.cos(th)).addScaledVector(_B, rr * Math.sin(th));
    };
    S.normal = (t, th, out) => {
      const e = 0.002, ea = 0.02;
      S.surf(Math.min(1, t + e), th, _a); S.surf(Math.max(0, t - e), th, _b); _a.sub(_b);
      S.surf(t, th + ea, _c); S.surf(t, th - ea, _d); _c.sub(_d);
      out.crossVectors(_c, _a);
      if (out.lengthSq() < 1e-16) { S.tangent(t, out); if (t < 0.5) out.negate(); return out; }
      return out.normalize();
    };
    const tear = (th) => 0.028 * Math.sin(th + tp[0]) + 0.014 * Math.sin(2 * th + tp[1]) + 0.007 * Math.sin(5 * th + tp[2]) + 0.0035 * Math.sin(11 * th + tp[3]);
    S.tcBreak = (th) => tb + tear(th);
    const biteRim = (th, bp) => {
      const top = 0.5 + 0.5 * Math.cos(th - bp[0]);
      return 0.07 * Math.pow(top, 1.4) + 0.03 * Math.abs(Math.sin(1.5 * th + bp[1])) + 0.006 * Math.sin(5 * th + bp[2]);
    };
    S.tcBiteA = (th) => tb * 0.64 - biteRim(th, biteA);
    S.tcBiteB = (th) => tb + (1 - tb) * 0.36 + biteRim(th, biteB);
    S.biteA = biteA; S.biteB = biteB;
    // sphere chain (local) for stacking
    S.sph = []; S.Rmax = 0;
    for (let k = 0; k < 11; k++) {
      const t = 0.09 + 0.082 * k;
      let m = 0; for (let j = 0; j < 8; j++) m += S.radius(t, j / 8 * TAU); m /= 8;
      S.sph.push({ c: S.centre(t, new V3()), r: m * 0.97 });
      S.Rmax = Math.max(S.Rmax, m);
    }
    return S;
  }

  const SEGS = 24;
  const distBoth = (s) => 0.5 - 0.5 * Math.cos(PI * s);
  const distHead = (s) => 1 - Math.cos(PI * s / 2);
  const distTail = (s) => Math.sin(PI * s / 2);
  function buildSkin(S, tA, tB, rings, dist) {
    const nv = rings * (SEGS + 1);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const idx = [];
    const p = new V3(), n = new V3();
    let vi = 0;
    for (let k = 0; k < rings; k++) {
      const f = dist(k / (rings - 1));
      for (let j = 0; j <= SEGS; j++) {
        const th = (j % SEGS) / SEGS * TAU;
        const t0 = tA(th), t1 = tB(th), t = t0 + (t1 - t0) * f;
        S.surf(t, th, p); S.normal(t, th, n);
        pos[vi * 3] = p.x; pos[vi * 3 + 1] = p.y; pos[vi * 3 + 2] = p.z;
        nor[vi * 3] = n.x; nor[vi * 3 + 1] = n.y; nor[vi * 3 + 2] = n.z;
        uv[vi * 2] = j / SEGS; uv[vi * 2 + 1] = t;
        vi++;
      }
    }
    for (let k = 0; k < rings - 1; k++) for (let j = 0; j < SEGS; j++) {
      const a = k * (SEGS + 1) + j, b = a + SEGS + 1, c = b + 1, d = a + 1;
      idx.push(a, d, b, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // broken / bitten flesh face closing a skin end. side +1: face looks along +tangent, −1: along −tangent.
  function buildFace(S, tc, side, bite, seed) {
    const r = rng(seed);
    const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU, r() * TAU, r() * TAU];
    let tm = 0; for (let j = 0; j < SEGS; j++) tm += tc(j / SEGS * TAU); tm /= SEGS;
    const C = S.centre(tm, new V3()), T = new V3(), N = new V3(), B = new V3();
    S.frame(tm, T, N, B);
    const out = T.clone().multiplyScalar(side);
    const R = S.R;
    const F = [0.14, 0.28, 0.42, 0.56, 0.68, 0.79, 0.88, 0.94, 0.975, 1.0];
    const rims = []; for (let j = 0; j < SEGS; j++) { const th = j / SEGS * TAU; rims.push(S.surf(tc(th), th, new V3())); }
    const uo = r(), vo = r(), ur = r() * TAU, cu = Math.cos(ur), su = Math.sin(ur);
    const noise = (x, y) => 0.5 * Math.sin(x * 380 + ph[0]) * Math.sin(y * 350 + ph[1]) + 0.3 * Math.sin((x + y) * 820 + ph[2]) + 0.2 * Math.sin((x - y) * 1500 + ph[3]) + 0.15 * Math.sin(x * 2300 + ph[4]) * Math.sin(y * 2100);
    const pos = [], uv = [], rad = [], idx = [];
    const p = new V3(), q = new V3();
    const push = (v, f) => {
      q.copy(v).sub(C);
      const x = q.dot(N), y = q.dot(B);
      pos.push(v.x, v.y, v.z); uv.push((x * cu - y * su) / 0.06 + uo, (x * su + y * cu) / 0.06 + vo); rad.push(f);
    };
    const disp = (f, th, x, y) => {
      const nz = noise(x, y);
      if (!bite) {
        const dome = R * 0.16 * (1 - f * f) * (1 + 0.2 * Math.sin(2 * th + ph[5]));
        // torn, fibrous break: a few broad lumps + a shallow crack + fine fluff
        const lump = 0.0032 * Math.sin(x * 140 + ph[1]) * Math.sin(y * 120 + ph[2]) + 0.0018 * Math.sin((x * 0.7 + y) * 260 + ph[3]);
        const crack = -0.0025 * Math.exp(-Math.pow((x * Math.cos(ph[4]) + y * Math.sin(ph[4])) / 0.0025, 2));
        return dome + (lump + crack) * (1 - Math.pow(f, 4)) + nz * 0.0016 * (1 - Math.pow(f, 8));
      }
      const scal = 0.5 + 0.5 * Math.cos(3 * th + ph[5]);
      const bowl = -R * 0.32 * (1 - f * f) * (0.85 + 0.3 * scal);
      const teeth = -0.0012 * Math.sin(PI * f) * Math.sin(2 * th + ph[4]);
      const grooves = -0.0007 * Math.pow(Math.abs(Math.sin((x * Math.cos(ph[3]) + y * Math.sin(ph[3])) * 520)), 3) * (1 - f);
      return bowl + teeth + grooves + nz * 0.0012 * (1 - Math.pow(f, 6));
    };
    // centre
    push(p.copy(C).addScaledVector(out, disp(0, 0, 0, 0)), 0);
    const cIdx = 0;
    const centrePoint = p.clone();
    for (let k = 0; k < F.length; k++) {
      const f = F[k];
      for (let j = 0; j < SEGS; j++) {
        const th = j / SEGS * TAU;
        const rim = rims[j];
        if (f >= 1) { push(rim, 1); continue; }
        const fr = f > 0.96 ? 0.995 : f;
        p.copy(C).lerp(rim, fr);
        q.copy(p).sub(C);
        let d = disp(f, th, q.dot(N), q.dot(B));
        if (f > 0.96) d = bite ? 0.0008 : 0.0024 + Math.max(0, d);
        p.addScaledVector(out, d);
        push(p, f > 0.96 ? 0.97 : f);
      }
    }
    const ring = (k) => 1 + k * SEGS;
    const tri = (a, b, c) => { if (side > 0) idx.push(a, b, c); else idx.push(a, c, b); };
    for (let j = 0; j < SEGS; j++) tri(cIdx, ring(0) + j, ring(0) + (j + 1) % SEGS);
    for (let k = 0; k < F.length - 1; k++) for (let j = 0; j < SEGS; j++) {
      const a0 = ring(k) + j, a1 = ring(k) + (j + 1) % SEGS, b0 = ring(k + 1) + j, b1 = ring(k + 1) + (j + 1) % SEGS;
      tri(a0, b0, b1); tri(a0, b1, a1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { geo: g, centre: centrePoint, normal: out };
  }
  function buildScrapGeo(seed) {
    const r = rng(seed);
    const pos = [], uv = [], idx = [];
    const RS = 4, SG = 12;
    const rimR = []; for (let j = 0; j < SG; j++) rimR.push(lerp(0.6, 1.0, r()));
    const sx = 0.022, sy = 0.016, curl = lerp(0.012, 0.018, r());
    pos.push(0, 0, 0); uv.push(0.5, 0.5);
    for (let k = 1; k <= RS; k++) for (let j = 0; j < SG; j++) {
      const a = j / SG * TAU, f = k / RS * (k === RS ? rimR[j] : lerp(1, rimR[j], k / RS));
      const x = Math.cos(a) * sx * f, y = Math.sin(a) * sy * f;
      const ang = x / curl;
      pos.push(Math.sin(ang) * curl, (1 - Math.cos(ang)) * curl + 0.0015 * Math.sin(y * 300), y);
      uv.push(0.5 + x * 6, 0.5 + y * 6);
    }
    for (let j = 0; j < SG; j++) idx.push(0, 1 + (j + 1) % SG, 1 + j);
    for (let k = 0; k < RS - 1; k++) for (let j = 0; j < SG; j++) {
      const a0 = 1 + k * SG + j, a1 = 1 + k * SG + (j + 1) % SG, b0 = a0 + SG, b1 = a1 + SG;
      idx.push(a0, b1, b0, a0, a1, b1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // lowest y of vertex arrays after rotation q
  const _m4 = new THREE.Matrix4();
  function lowestY(arrs, q) {
    _m4.makeRotationFromQuaternion(q);
    const e = _m4.elements;
    let mn = Infinity;
    for (const a of arrs) for (let i = 0; i < a.length; i += 3) {
      const y = e[1] * a[i] + e[5] * a[i + 1] + e[9] * a[i + 2];
      if (y < mn) mn = y;
    }
    return mn === Infinity ? 0 : mn;
  }

  // ---------------------------------------------------------------- tongs
  const TH = 0.0024, RB = 0.009, ZB = 0.19, LS = 0.385, KINK = 0.006, REST_OPEN = 0.05, WIDE = 0.095;
  function ribbon(pts) {
    const P = [], Nn = [], I = [];
    const n = pts.length;
    const tang = (i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let ty = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(ty, tz) || 1; return [ty / l, tz / l];
    };
    const addTri = (a, b, c) => {
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const dot = cx * Nn[a * 3] + cy * Nn[a * 3 + 1] + cz * Nn[a * 3 + 2];
      if (dot >= 0) I.push(a, b, c); else I.push(a, c, b);
    };
    for (const [fa, fb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const base = P.length / 3;
      for (let i = 0; i < n; i++) {
        const [y, z, w, t] = pts[i]; const [ty, tz] = tang(i); const ny = -tz, nz = ty;
        for (const s of [-1, 1]) {
          if (fa) { P.push(s * w / 2, y + fa * ny * t / 2, z + fa * nz * t / 2); Nn.push(0, fa * ny, fa * nz); }
          else { P.push(fb * w / 2, y + s * ny * t / 2, z + s * nz * t / 2); Nn.push(fb, 0, 0); }
        }
      }
      for (let i = 0; i < n - 1; i++) { const v0 = base + i * 2; addTri(v0, v0 + 2, v0 + 1); addTri(v0 + 1, v0 + 2, v0 + 3); }
    }
    for (const end of [0, n - 1]) {
      const [y, z, w, t] = pts[end]; const [ty, tz] = tang(end); const ny = -tz, nz = ty; const sg = end === 0 ? -1 : 1;
      const base = P.length / 3;
      for (const [sx, sn] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(sx * w / 2, y + sn * ny * t / 2, z + sn * nz * t / 2); Nn.push(0, sg * ty, sg * tz); }
      addTri(base, base + 1, base + 2); addTri(base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setIndex(I);
    return g;
  }
  const tongMat = new THREE.MeshStandardMaterial({ color: 0xb4b2ae, metalness: 1, roughness: 0.38 });
  const tongsObj = new THREE.Group(); tongsObj.name = 'tongs';
  const pivU = new THREE.Group(), pivL = new THREE.Group();
  pivU.position.set(0, RB, ZB); pivL.position.set(0, -RB, ZB);
  {
    const strip = (sg) => {
      const pts = [];
      for (let k = 0; k <= 44; k++) {
        const u = k / 44;
        let y = 0.0035 * Math.sin(PI * u) - KINK * smooth(0.8, 0.96, u);
        if (u > 0.91) y += 0.0006 * Math.sin((u - 0.91) / 0.09 * PI * 7);
        let w = 0.014 + 0.0035 * smooth(0.78, 0.9, u);
        if (u > 0.965) w *= Math.max(0.45, Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.965) / 0.035, 2))));
        pts.push([sg * y, -u * LS, w, TH]);
      }
      return pts;
    };
    const mU = new THREE.Mesh(ribbon(strip(1)), tongMat), mL = new THREE.Mesh(ribbon(strip(-1)), tongMat);
    pivU.add(mU); pivL.add(mL);
    const bp = []; for (let k = 0; k <= 20; k++) { const f = k / 20 * PI; bp.push([-RB * Math.cos(f), ZB + RB * Math.sin(f), 0.014, TH]); }
    const mB = new THREE.Mesh(ribbon(bp), tongMat);
    tongsObj.add(pivU, pivL, mB);
    tongsObj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  G.scene.add(tongsObj);
  const openAngle = (o) => Math.asin(clamp((o / 2 + TH / 2 + KINK - RB) / LS, -0.2, 0.4));
  function setOpen(up, lo) { pivU.rotation.x = openAngle(up); pivL.rotation.x = -openAngle(lo); }
  const restQ = new Q().setFromAxisAngle(Zax, 1.05); // lying on the strip edges: seen from above as a V
  let restYOff = 0.004;
  {
    setOpen(REST_OPEN, REST_OPEN);
    tongsObj.position.set(0, 0, 0); tongsObj.quaternion.copy(restQ); tongsObj.updateMatrixWorld(true);
    const bx = new THREE.Box3().setFromObject(tongsObj, true);
    if (isFinite(bx.min.y)) restYOff = -bx.min.y + 0.0005;
  }
  const gripQ = new Q();
  const _gm = new THREE.Matrix4(), _gb = new V3(), _go = new V3(), _gw = new V3(), _ga = new V3();
  // tongs come from the player's front-right, handle up; jaws open perpendicular to the potato's long axis
  function gripOrient(pq, out) {
    _gb.set(0.58, 0.62, 0.53).normalize();
    _ga.set(1, 0, 0).applyQuaternion(pq);
    _go.crossVectors(_ga, _gb);
    if (_go.lengthSq() < 1e-4) _go.set(0, 1, 0);
    _go.normalize();
    if (_go.y < 0) _go.negate();
    _gw.crossVectors(_go, _gb).normalize();
    _gm.makeBasis(_gw, _go, _gb);
    return out.setFromRotationMatrix(_gm);
  }
  const TIP_LOCAL = new V3(0, 0, ZB - LS * 0.955);
  const T = { mode: 'rest', pi: -1, t: 0, dur: 0.15, p0: new V3(), q0: new Q(), o0: REST_OPEN, open: REST_OPEN, att: 0, attK: 0, gap: 0.05, puffed: false };
  const _tp = new V3(), _tq = new Q(), _tv = new V3();
  function tongsRestPose(outP, outQ) {
    anchor('tongsRest', 0.08, 0, 1.40, outP); outP.y += restYOff;
    outQ.copy(restQ);
  }
  function gripPose(pc, outP, outQ, pq) {
    gripOrient(pq || gripQ, outQ);
    outP.copy(TIP_LOCAL).applyQuaternion(outQ);
    outP.subVectors(pc, outP);
  }
  function tongsStart(mode, dur) {
    T.p0.copy(tongsObj.position); T.q0.copy(tongsObj.quaternion); T.o0 = T.open;
    T.mode = mode; T.t = 0; T.dur = dur;
  }

  // ---------------------------------------------------------------- crumbs
  const CRUMBS = 28;
  const crumbGeo = new THREE.IcosahedronGeometry(0.0032, 0);
  const crumbMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
  const crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, CRUMBS);
  crumbs.frustumCulled = false; crumbs.castShadow = false;
  const cr = []; for (let k = 0; k < CRUMBS; k++) cr.push({ p: new V3(), v: new V3(), life: 0, s: 1, rest: 0 });
  const _cm = new THREE.Matrix4(), _cq = new Q(), _cs = new V3(), _col = new THREE.Color();
  for (let k = 0; k < CRUMBS; k++) { _cm.makeScale(0, 0, 0); crumbs.setMatrixAt(k, _cm); crumbs.setColorAt(k, _col.set(0xffffff)); }
  G.scene.add(crumbs);
  let crumbNext = 0;
  const CRUMB_COL = { yellow: 0xe8b84a, purple: 0x7a2c86, orange: 0xe07b25 };
  function spawnCrumbs(pos, variety, n, floorY) {
    for (let k = 0; k < n; k++) {
      const c = cr[crumbNext]; crumbNext = (crumbNext + 1) % CRUMBS;
      c.p.copy(pos).add(_cs.set((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.03));
      c.v.set((Math.random() - 0.5) * 0.25, Math.random() * 0.25, (Math.random() - 0.3) * 0.25);
      c.life = floorY < -1 ? 0.8 : 2.4 + Math.random(); c.s = 0.6 + Math.random() * 0.9; c.rest = floorY;
      if (floorY >= -1) c.v.multiplyScalar(0.25);
      crumbs.setColorAt(crumbNext === 0 ? CRUMBS - 1 : crumbNext - 1, _col.set(CRUMB_COL[variety] || 0xe8b84a));
    }
    if (crumbs.instanceColor) crumbs.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- scraps
  const scraps = []; // {mesh, anim:{t,dur,p0,p1,q0,q1,on}, old}
  function spawnScrap(from, toPos, seed, animate) {
    const g = buildScrapGeo(seed);
    const m = new THREE.Mesh(g, scrapMat); m.castShadow = true; m.receiveShadow = true;
    const q1 = new Q().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.3, Math.random() * TAU, (Math.random() - 0.5) * 0.3));
    G.scene.add(m);
    const s = { mesh: m, on: !!animate, t: 0, dur: 0.9, p0: from.clone(), p1: toPos.clone(), q0: new Q().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)), q1, old: false, sway: Math.random() * TAU };
    if (animate) { m.position.copy(from); m.quaternion.copy(s.q0); } else { m.position.copy(toPos); m.quaternion.copy(q1); }
    scraps.push(s);
    return s;
  }
  function trimScraps() {
    // keep at most 4 scraps from previous rounds
    for (const s of scraps) s.old = true;
    while (scraps.length > 4) { const s = scraps.shift(); G.scene.remove(s.mesh); s.mesh.geometry.dispose(); }
  }

  // ---------------------------------------------------------------- potatoes
  const rawMats = [makeRawMat(), makeRawMat(), makeRawMat()];
  const roastMats = [makeRoastMat(), makeRoastMat(), makeRoastMat()];
  let pots = [];
  let round = 1, roundSeed = 1, revealK = 0, clock = 0;

  function disposePotato(P) {
    G.scene.remove(P.root); P.geoWhole.dispose();
    for (const H of P.halves) { G.scene.remove(H.g); for (const st of H.stages) { st.skin.geometry.dispose(); st.face.geometry.dispose(); } }
  }

  function buildHalf(P, h) {
    const S = P.S, cb = P.cb;
    const g = new THREE.Group(); g.visible = false;
    const stages = [];
    const defs = h === 0
      ? [[() => 0, S.tcBreak, 16, distHead, S.tcBreak, 1, false], [() => 0, S.tcBiteA, 12, distHead, S.tcBiteA, 1, true]]
      : [[S.tcBreak, () => 1, 16, distTail, S.tcBreak, -1, false], [S.tcBiteB, () => 1, 12, distTail, S.tcBiteB, -1, true]];
    let k = 0;
    for (const [tA, tB, rings, dist, tc, side, bite] of defs) {
      const sg = buildSkin(S, tA, tB, rings, dist);
      const fc = buildFace(S, tc, side, bite, (S.seed * 7 + h * 13 + k * 31) >>> 0);
      sg.translate(-cb.x, -cb.y, -cb.z); fc.geo.translate(-cb.x, -cb.y, -cb.z);
      const skin = new THREE.Mesh(sg, roastMats[P.i]); const face = new THREE.Mesh(fc.geo, fleshMats[P.variety]);
      for (const m of [skin, face]) { m.castShadow = true; m.receiveShadow = true; m.visible = k === 0; g.add(m); }
      // tail point (pole) for picking
      const tail = S.centre(h === 0 ? 0 : 1, new V3()).sub(cb);
      stages.push({ skin, face, centre: fc.centre.clone().sub(cb), nLocal: fc.normal.clone(), verts: [sg.attributes.position.array, fc.geo.attributes.position.array], tail });
      k++;
    }
    G.scene.add(g);
    return { g, stages, st: 0, bites: BITES, pos: new V3(), quat: new Q(), restPos: new V3(), restQuat: new Q(), anim: null, att: 0, attK: 0, done: false };
  }

  function makePotato(i, seed, scale, variety) {
    const S = makeShape(seed, scale);
    const P = { i, S, variety, state: 'basket', roasted: false, big: scale > 1.2 };
    P.cb = S.centre(S.tb, new V3());
    P.geoWhole = buildSkin(S, () => 0, () => 1, 24, distBoth);
    P.whole = new THREE.Mesh(P.geoWhole, rawMats[i]);
    P.whole.castShadow = true; P.whole.receiveShadow = true;
    P.root = new THREE.Group(); P.root.add(P.whole); G.scene.add(P.root);
    P.verts = [P.geoWhole.attributes.position.array];
    P.halves = [buildHalf(P, 0), buildHalf(P, 1)];
    P.pos = new V3(); P.quat = new Q(); P.vel = new V3(); P.prev = new V3();
    P.bPos = new V3(); P.bQuat = new Q(); P.zPos = new V3(); P.zQuat = new Q(); P.aQuat = new Q(); P.ax = 0; P.az = 0;
    P.target = new V3(); P.fly = null; P.gripped = false; P.dust = 0; P.dustT = 0; P.att = 0; P.attK = 0;
    P.brkT = 0; P.brkA = 0; P.carryQ = new Q(); P.rollQ = new Q();
    return P;
  }

  // world-space sphere centres of a placed potato
  function sphW(P, pos, q) { return P.S.sph.map((s) => ({ c: s.c.clone().applyQuaternion(q).add(pos), r: s.r })); }
  function solveY(P, x, z, q, others, floorY) {
    let y = floorY - lowestY(P.verts, q);
    const mine = P.S.sph.map((s) => ({ c: s.c.clone().applyQuaternion(q), r: s.r }));
    for (const O of others) {
      const os = sphW(O, O.bPosLive || O.pos, O.bQuatLive || O.quat);
      for (const a of mine) for (const b of os) {
        const dx = x + a.c.x - b.c.x, dz = z + a.c.z - b.c.z, rr = a.r + b.r;
        const dh2 = dx * dx + dz * dz;
        if (dh2 < rr * rr) y = Math.max(y, b.c.y - a.c.y + Math.sqrt(rr * rr - dh2));
      }
    }
    return y;
  }

  function quatYPR(yaw, pitch, roll, out) {
    out.setFromAxisAngle(Y, yaw);
    _tq.setFromAxisAngle(Zax, pitch); out.multiply(_tq);
    _tq.setFromAxisAngle(X, roll); out.multiply(_tq);
    return out;
  }

  const _bA = new V3(), _zA = new V3();
  function layoutBasket(r) {
    const B = anchor('basket', 0.62, 0, 1.22, _bA);
    const floorY = B.y + 0.02;
    const order = pots.slice().sort((a, b) => b.S.L - a.S.L);
    const spots = [
      [-0.02, 0.058, 0.22, 0.02], [0.02, -0.062, -0.28, -0.02], [0.012, 0.0, 1.18, 0.13],
    ];
    const placed = [];
    order.forEach((P, k) => {
      const s = spots[k];
      const yaw = s[2] + (r() - 0.5) * 0.3, pitch = s[3] * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 0.04, roll = r() * TAU;
      quatYPR(yaw, pitch, roll, P.bQuat);
      const x = B.x + s[0], z = B.z + s[1];
      const y = solveY(P, x, z, P.bQuat, placed, floorY);
      P.bPos.set(x, y, z);
      P.pos.copy(P.bPos); P.quat.copy(P.bQuat);
      placed.push(P);
      P.basketOrder = k;
    });
  }
  // re-stack potatoes still lying in the basket (supporting one may have left)
  function settleBasket(except) {
    const B = anchor('basket', 0.62, 0, 1.22, _bA);
    const floorY = B.y + 0.02;
    const inb = pots.filter((P) => P.state === 'basket' && P !== except && !(P.fly && P.fly.kind !== 'settle')).sort((a, b) => a.bPos.y - b.bPos.y);
    const done = [];
    for (const P of inb) {
      const y = solveY(P, P.bPos.x, P.bPos.z, P.bQuat, done.map((O) => { O.bPosLive = O.bPos; O.bQuatLive = O.bQuat; return O; }), floorY);
      if (y < P.bPos.y - 0.002) {
        P.bPos.y = y;
        startFly(P, 'settle', P.bPos, P.bQuat, 0.22, 0, () => snd('tok'));
      }
      done.push(P);
    }
    for (const O of pots) { O.bPosLive = null; O.bQuatLive = null; }
  }
  function layoutZaru(r) {
    const Zc = anchor('zaru', -0.62, 0, 1.22, _zA);
    const trayY = Zc.y + 0.025;
    const w = pots.map((P) => 2 * P.S.Rmax + 0.014);
    const tot = w.reduce((a, b) => a + b, 0);
    let z = Zc.z - tot / 2;
    pots.forEach((P, k) => {
      const zc = z + w[k] / 2; z += w[k];
      const yaw = (r() - 0.5) * 0.4, roll = r() * TAU;
      quatYPR(yaw, 0, roll, P.zQuat);
      P.zPos.set(Zc.x + (r() - 0.5) * 0.06, trayY - lowestY(P.verts, P.zQuat), zc);
    });
  }
  const ASH_SLOTS = [[-0.17, 0.07, 0.35], [0.165, 0.085, -0.45], [0.0, -0.15, 0.08]];
  function layoutAsh(r) {
    pots.forEach((P, k) => {
      const s = ASH_SLOTS[k];
      P.ax = s[0]; P.az = s[1];
      quatYPR(s[2] + (r() - 0.5) * 0.25, (r() - 0.5) * 0.22, r() * TAU, P.aQuat);
    });
  }
  function ashY(x, z) {
    const top = pileNum('topY', 0.12), rad = Math.max(0.2, pileNum('radius', 0.55));
    const q = Math.hypot(x, z) / rad;
    return top * Math.max(0.3, 1 - 0.35 * q * q);
  }
  function ashPose(P, k, outP) {
    const sy = ashY(P.ax, P.az);
    const R = P.S.Rmax;
    return outP.set(P.ax, sy + lerp(-1.6 * R - 0.02, 0.3 * R, clamp(k, 0, 1)), P.az);
  }
  function trayY() { return anchor('zaru', -0.62, 0, 1.22, _zA).y + 0.025; }

  // ---------------------------------------------------------------- animation helpers
  function startFly(P, kind, toP, toQ, dur, arc, onEnd) {
    P.fly = { kind, t: 0, dur: Math.max(0.05, dur), p0: P.pos.clone(), q0: P.quat.clone(), p1: toP.clone(), q1: toQ.clone(), arc, onEnd };
  }
  function openRest(P, h, st, outP, outQ) {
    const H = P.halves[h], S0 = H.stages[0];
    const s = h === 0 ? 1 : -1;
    _tv.set(s, 0, 0);
    const qa = new Q().setFromUnitVectors(S0.nLocal, _tv);
    const e = 0.72;
    const dx = s * 0.45, dz = 1, dl = Math.hypot(dx, dz);
    const psi = s > 0 ? Math.atan2(-dz / dl, dx / dl) : Math.atan2(dz / dl, -dx / dl);
    outQ.setFromAxisAngle(Y, psi).multiply(_tq.setFromAxisAngle(Zax, s * e)).multiply(qa);
    const stg = H.stages[st] || S0;
    const Zc = anchor('zaru', -0.62, 0, 1.22, _zA);
    const cx = Zc.x + (P.i - 1) * 0.125, cz = Zc.z + 0.135 - Math.abs(P.i - 1) * 0.04;
    outP.set(cx + (h === 0 ? -1 : 1) * (0.024 + P.S.R * 0.4), trayY() - lowestY(stg.verts, outQ), cz);
    return outP;
  }

  // ---------------------------------------------------------------- reset / state
  function reset(rnd = 1, opts = null) {
    try {
      round = Math.max(1, Math.floor(fin(rnd, 1)));
      roundSeed = opts && opts.seed ? (opts.seed >>> 0) : ((Math.random() * 4294967295) >>> 0) || 7;
      for (const P of pots) disposePotato(P);
      trimScraps();
      const r = rng(roundSeed);
      const vars = VARS.slice();
      for (let k = 2; k > 0; k--) { const j = Math.floor(r() * (k + 1)); const t = vars[k]; vars[k] = vars[j]; vars[j] = t; }
      if (opts && Array.isArray(opts.vars) && opts.vars.length === 3 && opts.vars.every((v) => VARS.includes(v))) for (let k = 0; k < 3; k++) vars[k] = opts.vars[k];
      const big = round >= 2 ? Math.floor(r() * 3) % 3 : -1;
      pots = [];
      for (let k = 0; k < 3; k++) {
        const seed = (r() * 4294967295) >>> 0;
        pots.push(makePotato(k, seed, k === big ? 1.5 : 1, vars[k]));
        const c = rawMats[k].color;
        if (skinTex) c.setRGB(0.3 + r() * 0.04, 0.24 + r() * 0.04, 0.27 + r() * 0.04);
        roastMats[k].userData.u.uDust.value = 0;
      }
      layoutBasket(r); layoutZaru(r); layoutAsh(r);
      revealK = 0;
      T.pi = -1; if (T.mode !== 'rest') tongsStart('home', 0.4);
      for (const c of cr) c.life = 0;
      for (const P of pots) applyDisplay(P, 0);
    } catch (e) { if (G.dev) console.error(e); }
  }

  // ---------------------------------------------------------------- picking
  const _pv = new V3(), _pa = new V3(), _pb = new V3(), _s1 = { x: 0, y: 0 }, _s2 = { x: 0, y: 0 }, _sf = { x: 0, y: 0 };
  function scr(v, out) {
    _pv.copy(v).project(G.camera);
    const el = G.renderer && G.renderer.domElement;
    const w = (el && el.clientWidth) || window.innerWidth || 390, h = (el && el.clientHeight) || window.innerHeight || 844;
    out.x = (_pv.x * 0.5 + 0.5) * w; out.y = (-_pv.y * 0.5 + 0.5) * h; out.z = _pv.z;
    return out;
  }
  function fingerPx(ray) {
    ray = ray || (G.input && G.input.ray);
    if (!ray || !ray.origin || !ray.direction) return null;
    _pa.copy(ray.origin).addScaledVector(ray.direction, 1.0);
    scr(_pa, _sf);
    return _sf;
  }
  function segDist(f, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((f.x - a.x) * dx + (f.y - a.y) * dy) / l2 : 0; t = clamp(t, 0, 1);
    return Math.hypot(f.x - (a.x + dx * t), f.y - (a.y + dy * t));
  }
  function potatoPx(P, f) {
    _pa.set(-P.S.L * 0.38, 0, 0).applyQuaternion(P.root.quaternion).add(P.root.position);
    _pb.set(P.S.L * 0.38, 0, 0).applyQuaternion(P.root.quaternion).add(P.root.position);
    scr(_pa, _s1); scr(_pb, _s2);
    return segDist(f, _s1, _s2);
  }
  function pickBy(ray, ok, radius = 72) {
    try {
      const f = fingerPx(ray); if (!f) return -1;
      let best = -1, bd = radius;
      for (const P of pots) {
        if (!ok(P)) continue;
        const d = potatoPx(P, f);
        if (d < bd) { bd = d; best = P.i; }
      }
      return best;
    } catch (e) { return -1; }
  }
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < pots.length;

  // ---------------------------------------------------------------- API actions
  function hold(i, point) {
    if (!valid(i) || !point) return; const P = pots[i];
    if (P.state === 'basket') {
      if (P.fly && P.fly.kind === 'dive') return;
      P.fly = null; P.state = 'held'; P.carryQ.copy(P.quat);
      P.rollQ.copy(P.bQuat);
      settleBasket(P);
    }
    if (P.state !== 'held') return;
    P.target.set(fin(point.x), fin(point.y), fin(point.z)).y += 0.18;
  }
  function dropRaw(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'held') return;
    P.state = 'basket';
    const B = anchor('basket', 0.62, 0, 1.22, _bA);
    const others = pots.filter((O) => O !== P && O.state === 'basket');
    for (const O of others) { O.bPosLive = O.fly ? O.fly.p1 : O.bPos; O.bQuatLive = O.bQuat; }
    P.bPos.y = solveY(P, P.bPos.x, P.bPos.z, P.bQuat, others, B.y + 0.02);
    for (const O of pots) { O.bPosLive = null; O.bQuatLive = null; }
    startFly(P, 'drop', P.bPos, P.bQuat, 0.45, 0.07, () => snd('tok'));
  }
  function bury(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'basket' && P.state !== 'held') return;
    if (P.fly && P.fly.kind === 'dive') return;
    const wasBasket = P.state === 'basket';
    P.state = 'buried';
    if (wasBasket) settleBasket(P);
    const ang = [210, 330, 90][i] * PI / 180;
    const pile = anchor('pile', 0, 0, 0, new V3());
    const top = pileNum('topY', 0.4);
    const sx = pile.x + Math.cos(ang) * 0.16, sz = pile.z + Math.sin(ang) * 0.16;
    const above = new V3(sx, pile.y + top + 0.11, sz);
    const d = new V3(pile.x - sx, 0, pile.z - sz).normalize().multiplyScalar(0.45); d.y = -1; d.normalize();
    const q = new Q().setFromUnitVectors(new V3(-1, 0, 0), d);
    q.multiply(_tq.setFromAxisAngle(X, Math.random() * TAU));
    const depth = Math.max(P.S.L + 0.08, (above.y - pile.y) / Math.max(0.3, -d.y) * 0.9);
    const end = above.clone().addScaledVector(d, depth);
    P.root.visible = true;
    startFly(P, 'toPile', above, q, 0.32, 0.08, () => {
      snd('rummage'); call('leaves', 'rustlePile', 1);
      startFly(P, 'dive', end, q, 0.5, 0, () => { P.hidden = true; });
    });
  }
  function roastAll() {
    for (const P of pots) if (P.state === 'buried') { P.roasted = true; P.whole.material = roastMats[P.i]; }
  }
  function revealInAsh(k) {
    revealK = clamp(fin(k), 0, 1);
    for (const P of pots) {
      if (P.state !== 'buried') continue;
      if (!P.roasted) { P.roasted = true; P.whole.material = roastMats[P.i]; }
      if (revealK > 0) { if (P.fly) P.fly = null; P.hidden = false; P.quat.copy(P.aQuat); ashPose(P, revealK, P.pos); }
      if (revealK > 0.5) P.state = 'ash';
    }
  }
  function grab(i, point) {
    if (!valid(i) || !point) return; const P = pots[i];
    if (P.state === 'ash' && !P.fly) {
      for (const O of pots) if (O !== P && O.state === 'tongs') toAsh(O.i);
      P.state = 'tongs'; P.gripped = false; P.dustT = 0.3;
      P.carryQ.copy(P.quat);
      T.pi = i; T.gap = clamp(P.S.Rmax * 1.75, 0.03, 0.09); T.puffed = false;
      tongsStart('go', 0.15);
    }
    if (P.state !== 'tongs') return;
    P.target.set(fin(point.x), fin(point.y), fin(point.z)).y += 0.22;
  }
  function releaseTongs(i) {
    if (T.pi === i && (T.mode === 'go' || T.mode === 'hold')) { tongsStart('open', 0.12); }
  }
  function toZaru(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'tongs') return;
    P.state = 'zaru'; P.dustT = 0.25;
    startFly(P, 'zaru', P.zPos, P.zQuat, 0.62, 0.09, () => { snd('tok'); releaseTongs(i); });
  }
  function toAsh(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'tongs') return;
    P.state = 'ash'; P.dustT = 1;
    const p = ashPose(P, 1, new V3());
    startFly(P, 'ash', p, P.aQuat, 0.42, 0.06, () => {
      snd('ashPuff'); call('fire', 'ashPuff', P.pos.clone(), 0.5); releaseTongs(i);
    });
  }
  function breakDrag(i, amount) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'zaru' || P.fly) return;
    P.brkT = clamp(fin(amount), 0, 1);
  }
  function breakCancel(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'zaru') return;
    P.brkT = 0;
  }
  const _hp = new V3(), _hq = new Q(), _hp2 = new V3(), _hpv = new V3();
  function breakOpen(i) {
    if (!valid(i)) return; const P = pots[i];
    if (P.state !== 'zaru' || P.fly) return;
    P.state = 'open';
    P.brkT = 0;
    // start from the current hinge pose
    const ax = _pa.set(1, 0, 0).applyQuaternion(P.root.quaternion).clone();
    for (let h = 0; h < 2; h++) {
      const H = P.halves[h];
      hingePose(P, h, Math.max(P.brkA, 0.0), H.pos, H.quat);
      H.g.visible = true; H.st = 0; H.bites = BITES; H.done = false; showStage(H, 0);
      openRest(P, h, 0, H.restPos, H.restQuat);
      const mid = H.pos.clone().lerp(H.restPos, 0.5).addScaledVector(ax, (h === 0 ? -1 : 1) * 0.03); mid.y = Math.max(H.pos.y, H.restPos.y) + 0.05;
      H.anim = { kind: 'open', t: 0, dur: 0.5, p0: H.pos.clone(), pm: mid, q0: H.quat.clone(), p1: H.restPos.clone(), q1: H.restQuat.clone() };
    }
    P.brkA = 0;
    P.root.visible = false;
  }
  function showStage(H, st) { H.stages.forEach((s, k) => { s.skin.visible = s.face.visible = k === st; }); }
  // hinge transform of half h for break amount a (from the displayed root pose)
  function hingePose(P, h, a, outP, outQ) {
    const rq = P.root.quaternion, rp = P.root.position;
    const axisW = _hp2.set(1, 0, 0).applyQuaternion(rq);
    const C = _hp.copy(P.cb).applyQuaternion(rq).add(rp);
    const hinge = _tv.crossVectors(axisW, Y); if (hinge.lengthSq() < 1e-6) hinge.set(0, 0, 1); hinge.normalize();
    const ang = (h === 0 ? 1 : -1) * a * 0.61;
    _tq.setFromAxisAngle(hinge, ang);
    const piv = _hpv.copy(C); piv.y -= P.S.R * 0.85;
    outP.copy(C).sub(piv).applyQuaternion(_tq).add(piv).addScaledVector(axisW, (h === 0 ? -1 : 1) * 0.004 * a);
    outQ.copy(_tq).multiply(rq);
  }
  const _cam = new V3(), _fw = new V3(), _up = new V3();
  function bite(i, h) {
    if (!valid(i) || (h !== 0 && h !== 1)) return 0;
    const P = pots[i]; const H = P.halves[h];
    if (P.state !== 'open' && P.state !== 'eaten') return H.bites;
    if (H.bites <= 0) return 0;
    if (H.anim) return H.bites;
    H.bites--;
    if (P.halves[0].bites <= 0 && P.halves[1].bites <= 0) P.state = 'eaten';
    // target: on the line to the camera, drifting toward the lower centre of the view
    const cam = G.camera; cam.getWorldPosition(_cam);
    const face = H.g.localToWorld(H.stages[H.st].centre.clone());
    const fd = face.distanceTo(_cam);
    const L = face.clone().lerp(_cam, clamp(Math.max(0.55, 1 - 0.5 / Math.max(0.01, fd)), 0, 0.85));
    cam.getWorldDirection(_fw); _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const dist = L.distanceTo(_cam);
    const tanH = Math.tan((cam.fov || 50) * PI / 360);
    const Vp = _cam.clone().addScaledVector(_fw, dist).addScaledVector(_up, -dist * tanH * 0.42);
    const pT = L.lerp(Vp, 0.7);
    const nW = H.stages[0].nLocal.clone().applyQuaternion(H.quat);
    const toCam = _cam.clone().sub(pT).normalize().multiplyScalar(Math.cos(0.6)).addScaledVector(_up, Math.sin(0.6)).normalize();
    const qT = new Q().setFromUnitVectors(nW, toCam).multiply(H.quat);
    H.anim = { kind: 'bite', t: 0, p0: H.pos.clone(), q0: H.quat.clone(), pT: pT.clone().sub(face).add(H.pos), qT, switched: false };
    return H.bites;
  }

  // ---------------------------------------------------------------- update
  const _w = new V3(), _wq = new Q(), _rq = new Q(), _e = new THREE.Euler();
  function applyDisplay(P, t) {
    P.root.position.copy(P.pos);
    P.root.quaternion.copy(P.quat);
    if (P.attK > 0.002 && !P.fly && (P.state === 'basket' || P.state === 'ash' || P.state === 'zaru')) {
      const a = P.attK * 0.075 * Math.sin(t * TAU * 1.2);
      _wq.setFromAxisAngle(X, a); P.root.quaternion.multiply(_wq);
      P.root.position.y += P.attK * 0.002 * Math.abs(Math.sin(t * TAU * 1.2));
    }
  }
  function updatePotato(P, dt, t) {
    // dust
    if (P.state === 'buried' || P.state === 'ash') P.dustT = 1;
    P.dust += (P.dustT - P.dust) * dk(P.dustT < P.dust ? 1.6 : 4, dt);
    roastMats[P.i].userData.u.uDust.value = P.roasted ? P.dust : 0;
    P.attK += (P.att - P.attK) * dk(5, dt);

    if (P.fly) {
      const F = P.fly; F.t += dt;
      const u = clamp(F.t / F.dur, 0, 1);
      const k = F.kind === 'dive' || F.kind === 'settle' ? easeIn(u) : ease(u);
      P.pos.lerpVectors(F.p0, F.p1, k); P.pos.y += Math.sin(PI * u) * F.arc;
      P.quat.slerpQuaternions(F.q0, F.q1, F.kind === 'dive' ? Math.min(1, u * 3) : easeOut(u * 1.15));
      if (u >= 1) { P.fly = null; const cb = F.onEnd; if (cb) cb(); }
    } else if (P.state === 'held' || (P.state === 'tongs' && P.gripped)) {
      P.prev.copy(P.pos);
      P.pos.lerp(P.target, dk(P.state === 'held' ? 16 : 13, dt));
      if (dt > 0) P.vel.subVectors(P.pos, P.prev).divideScalar(dt);
      const vx = clamp(P.vel.x, -3, 3), vz = clamp(P.vel.z, -3, 3);
      // long axis across the view, swinging with the motion
      _e.set(clamp(vz * 0.22, -0.45, 0.45), 0.08, clamp(-vx * 0.25, -0.5, 0.5));
      _rq.setFromEuler(_e);
      // carry orientation: keep current roll around the long axis, level the long axis along X
      const ax = _tv.set(1, 0, 0).applyQuaternion(P.carryQ);
      _wq.setFromUnitVectors(ax, X).multiply(P.carryQ); // levelled
      _rq.multiply(_wq);
      P.quat.slerp(_rq, dk(9, dt));
    } else if (P.state === 'tongs') {
      ashPose(P, Math.max(revealK, 1), P.pos);
    } else if (P.state === 'ash' || (P.state === 'buried' && P.roasted && revealK > 0)) {
      ashPose(P, P.state === 'ash' ? Math.max(revealK, 1) : revealK, P.pos); P.quat.copy(P.aQuat);
    }

    // visibility
    const hiddenBuried = P.state === 'buried' && !P.fly && !(P.roasted && revealK > 0);
    const halvesShown = P.state === 'open' || P.state === 'eaten' || (P.state === 'zaru' && P.brkA > 0.012);
    P.root.visible = !hiddenBuried && !halvesShown && !(P.state === 'open' || P.state === 'eaten');

    // break hinge on the tray
    if (P.state === 'zaru') {
      P.brkA += (P.brkT - P.brkA) * dk(P.brkT > P.brkA ? 22 : 14, dt);
      if (P.brkA < 0.002 && P.brkT === 0) P.brkA = 0;
    }
    applyDisplay(P, t);
    if (P.state === 'zaru' && !P.fly && P.brkA > 0) {
      P.root.position.y += 0.03 * smooth(0, 0.3, P.brkA);
      P.root.updateMatrixWorld();
    }
    if (P.state === 'zaru') {
      const show = P.brkA > 0.012;
      for (let h = 0; h < 2; h++) {
        const H = P.halves[h];
        H.g.visible = show;
        if (show) { showStage(H, 0); hingePose(P, h, P.brkA, H.g.position, H.g.quaternion); }
      }
    }
    if (P.state === 'open' || P.state === 'eaten') for (let h = 0; h < 2; h++) updateHalf(P, P.halves[h], h, dt, t);
  }
  function updateHalf(P, H, h, dt, t) {
    H.attK += ((H.bites > 0 && !H.anim ? H.att : 0) - H.attK) * dk(5, dt);
    const A = H.anim;
    if (A && A.kind === 'open') {
      A.t += dt; const u = clamp(A.t / A.dur, 0, 1), k = easeOut(u);
      // quadratic bezier p0 -> pm -> p1
      const a = 1 - k;
      H.pos.set(0, 0, 0).addScaledVector(A.p0, a * a).addScaledVector(A.pm, 2 * a * k).addScaledVector(A.p1, k * k);
      H.quat.slerpQuaternions(A.q0, A.q1, easeOut(Math.min(1, u * 1.3)));
      if (u >= 1) { H.anim = null; H.pos.copy(A.p1); H.quat.copy(A.q1); snd('tok'); }
    } else if (A && A.kind === 'bite') {
      A.t += dt;
      const R1 = 0.24, HO = 0.16, RT = 0.42;
      if (A.t < R1) {
        const k = easeOut(A.t / R1);
        H.pos.lerpVectors(A.p0, A.pT, k); H.quat.slerpQuaternions(A.q0, A.qT, k);
      } else {
        if (!A.switched) {
          A.switched = true;
          H.pos.copy(A.pT); H.quat.copy(A.qT);
          snd('bite'); try { G.rig && G.rig.nudge && G.rig.nudge(0.08); } catch (e) { /* */ }
          H.g.updateMatrixWorld();
          const fc = H.g.localToWorld(H.stages[H.st].centre.clone());
          spawnCrumbs(fc, P.variety, 6, -10);
          if (H.bites <= 0) {
            H.g.visible = false; H.done = true; H.anim = null;
            const land = new V3(H.restPos.x + (Math.random() - 0.5) * 0.03, trayY() + 0.003, H.restPos.z + (Math.random() - 0.5) * 0.03);
            spawnScrap(fc, land, (P.S.seed + h * 977 + 13) >>> 0, true);
            return;
          }
          H.st = Math.min(H.stages.length - 1, BITES - H.bites);
          showStage(H, H.st);
          openRest(P, h, H.st, H.restPos, _hq); // keep the orientation, new height
          A.p0.copy(H.restPos);
        }
        if (A.t >= R1 + HO) {
          const k = ease((A.t - R1 - HO) / RT);
          H.pos.lerpVectors(A.pT, A.p0, k); H.pos.y += Math.sin(PI * k) * 0.02;
          H.quat.slerpQuaternions(A.qT, A.q0, k);
          if (k >= 1) {
            H.anim = null; H.pos.copy(H.restPos); H.quat.copy(A.q0); snd('tok');
            H.g.updateMatrixWorld();
            spawnCrumbs(H.g.localToWorld(H.stages[H.st].centre.clone()), P.variety, 3, trayY() + 0.003);
          }
        }
      }
    } else if (!H.done) {
      H.pos.copy(H.restPos); H.quat.copy(H.restQuat);
    }
    H.g.visible = !H.done;
    H.g.position.copy(H.pos); H.g.quaternion.copy(H.quat);
    if (H.attK > 0.002 && !H.anim) {
      const s = Math.max(0, Math.sin(t * TAU * 1.2));
      H.g.position.y += H.attK * 0.007 * s * s;
      H.g.quaternion.premultiply(_wq.setFromAxisAngle(X, -H.attK * 0.06 * s));
    }
  }
  function updateTongs(dt, t) {
    T.attK += ((T.mode === 'rest' ? T.att : 0) - T.attK) * dk(5, dt);
    const P = valid(T.pi) ? pots[T.pi] : null;
    if (T.mode === 'go' && P) {
      T.t += dt; const u = clamp(T.t / T.dur, 0, 1), k = easeOut(u);
      gripPose(P.pos, _tp, _tq, P.quat);
      tongsObj.position.lerpVectors(T.p0, _tp, k); tongsObj.position.y += Math.sin(PI * u) * 0.05;
      tongsObj.quaternion.slerpQuaternions(T.q0, _tq, k);
      T.open = u < 0.65 ? lerp(T.o0, WIDE, u / 0.65) : lerp(WIDE, T.gap, (u - 0.65) / 0.35);
      if (u >= 1) {
        T.mode = 'hold'; P.gripped = P.state === 'tongs';
        if (!T.puffed) { T.puffed = true; snd('tongs'); call('fire', 'ashPuff', P.pos.clone(), 0.6); }
      }
    } else if (T.mode === 'hold' && P) {
      gripPose(P.pos, tongsObj.position, tongsObj.quaternion, P.quat);
      T.open = T.gap;
      if (P.state !== 'tongs' && !P.fly) tongsStart('open', 0.12);
    } else if (T.mode === 'open') {
      T.t += dt; const u = clamp(T.t / T.dur, 0, 1);
      T.open = lerp(T.o0, WIDE, easeOut(u));
      if (u >= 1) { if (P) P.gripped = false; tongsStart('back', 0.22); _tv.set(0, 0.07, 0.1); T.p1 = T.p0.clone().add(_tv); }
    } else if (T.mode === 'back') {
      T.t += dt; const u = clamp(T.t / T.dur, 0, 1);
      tongsObj.position.lerpVectors(T.p0, T.p1 || T.p0, easeOut(u));
      if (u >= 1) { T.pi = -1; tongsStart('home', 0.45); }
    } else if (T.mode === 'home' || (T.mode === 'go' && !P) || (T.mode === 'hold' && !P)) {
      if (T.mode !== 'home') tongsStart('home', 0.4);
      T.t += dt; const u = clamp(T.t / T.dur, 0, 1), k = ease(u);
      tongsRestPose(_tp, _tq);
      tongsObj.position.lerpVectors(T.p0, _tp, k); tongsObj.position.y += Math.sin(PI * u) * 0.05;
      tongsObj.quaternion.slerpQuaternions(T.q0, _tq, k);
      T.open = lerp(T.o0, REST_OPEN, k);
      if (u >= 1) { T.mode = 'rest'; snd('tongs'); }
    }
    if (T.mode === 'rest') {
      tongsRestPose(tongsObj.position, tongsObj.quaternion);
      T.open = REST_OPEN;
      if (T.attK > 0.002) {
        const s = Math.sin(t * TAU * 1.2);
        tongsObj.quaternion.multiply(_wq.setFromAxisAngle(Zax, T.attK * 0.05 * s));
        tongsObj.position.y += T.attK * 0.003 * Math.abs(s);
        const click = Math.max(0, Math.sin(t * TAU * 2.4));
        setOpen(REST_OPEN + T.attK * 0.03 * click * click, REST_OPEN);
        return;
      }
    }
    setOpen(T.open, T.open);
  }
  function updateCrumbs(dt) {
    let any = false;
    for (let k = 0; k < CRUMBS; k++) {
      const c = cr[k];
      if (c.life <= 0) { _cm.makeScale(0, 0, 0); crumbs.setMatrixAt(k, _cm); continue; }
      any = true;
      c.life -= dt;
      if (c.p.y > c.rest) { c.v.y -= 4.5 * dt; c.p.addScaledVector(c.v, dt); if (c.p.y <= c.rest) { c.p.y = c.rest; c.v.set(0, 0, 0); } }
      const s = c.s * Math.min(1, c.life * 2);
      _cq.setFromAxisAngle(Y, k * 1.7);
      _cm.compose(c.p, _cq, _cs.set(s, s * 0.7, s));
      crumbs.setMatrixAt(k, _cm);
    }
    crumbs.visible = any;
    crumbs.instanceMatrix.needsUpdate = true;
  }
  function updateScraps(dt) {
    for (const s of scraps) {
      if (!s.on) continue;
      s.t += dt; const u = clamp(s.t / s.dur, 0, 1);
      s.mesh.position.lerpVectors(s.p0, s.p1, u);
      s.mesh.position.y = lerp(s.p0.y, s.p1.y, easeIn(u));
      const sw = Math.sin(u * PI * 3 + s.sway) * 0.03 * (1 - u);
      s.mesh.position.x += sw;
      s.mesh.quaternion.slerpQuaternions(s.q0, s.q1, easeOut(u));
      if (u >= 1) { s.on = false; s.mesh.position.copy(s.p1); s.mesh.quaternion.copy(s.q1); snd('pat'); }
    }
  }
  function update(dt) {
    try {
      dt = clamp(fin(dt, 0.016), 0, 0.05);
      clock += dt;
      const t = clock;
      for (const P of pots) updatePotato(P, dt, t);
      updateTongs(dt, t);
      updateCrumbs(dt);
      updateScraps(dt);
    } catch (e) { if (G.dev) console.error(e); }
  }

  // ---------------------------------------------------------------- save / restore
  function getState() {
    return { v: 1, round, seed: roundSeed, p: pots.map((P) => ({ s: P.state, var: P.variety, r: P.roasted ? 1 : 0, b: [P.halves[0].bites, P.halves[1].bites] })) };
  }
  function setState(s) {
    try {
      if (!s || typeof s !== 'object' || !Array.isArray(s.p) || s.p.length !== 3) return;
      for (const e of s.p) if (!e || !STATES.includes(e.s)) return;
      reset(fin(s.round, 1), { seed: fin(s.seed, 0) >>> 0, vars: s.p.map((e) => e.var) });
      let anyAsh = false;
      s.p.forEach((e, i) => {
        const P = pots[i];
        let st = e.s === 'held' ? 'basket' : e.s === 'tongs' ? 'ash' : e.s;
        P.fly = null;
        if (st !== 'basket') {
          P.roasted = !!e.r || st !== 'buried';
          P.whole.material = P.roasted ? roastMats[i] : rawMats[i];
        }
        P.state = st;
        if (st === 'ash') { anyAsh = true; P.quat.copy(P.aQuat); ashPose(P, 1, P.pos); P.dust = P.dustT = 1; }
        if (st === 'buried') { P.dust = P.dustT = 1; }
        if (st === 'zaru' || st === 'open' || st === 'eaten') { P.pos.copy(P.zPos); P.quat.copy(P.zQuat); P.dust = P.dustT = 0.25; }
        if (st === 'open' || st === 'eaten') {
          const b = Array.isArray(e.b) ? e.b : [BITES, BITES];
          for (let h = 0; h < 2; h++) {
            const H = P.halves[h];
            H.bites = clamp(Math.floor(fin(b[h], BITES)), 0, BITES);
            if (st === 'eaten') H.bites = 0;
            H.st = Math.min(H.stages.length - 1, BITES - H.bites); showStage(H, H.st);
            openRest(P, h, H.st, H.restPos, H.restQuat);
            H.pos.copy(H.restPos); H.quat.copy(H.restQuat); H.anim = null;
            H.done = H.bites <= 0;
            if (H.done) spawnScrap(H.restPos, new V3(H.restPos.x, trayY() + 0.003, H.restPos.z), (P.S.seed + h * 977 + 13) >>> 0, false);
          }
          if (P.halves[0].bites <= 0 && P.halves[1].bites <= 0) P.state = 'eaten';
        }
      });
      // basket stack after some left
      settleBasket(null);
      for (const P of pots) if (P.fly && P.fly.kind === 'settle') { P.pos.copy(P.fly.p1); P.quat.copy(P.fly.q1); P.fly = null; }
      if (anyAsh) revealK = 1;
      for (const P of pots) applyDisplay(P, 0);
    } catch (e) { if (G.dev) console.error(e); }
  }

  // ---------------------------------------------------------------- api
  const api = {
    BITES_PER_HALF: BITES,
    get count() { return 3; },
    reset,
    state(i) { return valid(i) ? pots[i].state : 'basket'; },
    variety(i) { return valid(i) ? pots[i].variety : 'yellow'; },
    setAttention(i, k) {
      k = clamp(fin(k), 0, 1);
      const pickable = (P) => P.state === 'basket' || P.state === 'ash' || P.state === 'zaru' || P.state === 'open';
      for (const P of pots) {
        if (i === -1 ? true : P.i === i) {
          const on = i === -1 ? (pickable(P) ? k : 0) : k;
          P.att = on; for (const H of P.halves) H.att = on;
        }
      }
    },
    pickRaw(ray) { return pickBy(ray, (P) => P.state === 'basket' && !(P.fly && P.fly.kind === 'dive')); },
    hold, dropRaw, bury,
    get buriedCount() { return pots.filter((P) => P.state === 'buried').length; },
    roastAll, revealInAsh,
    pickAsh(ray) { return pickBy(ray, (P) => P.state === 'ash' && !P.fly, 80); },
    grab, toZaru, toAsh,
    get onZaruCount() { return pots.filter((P) => P.state === 'zaru' || P.state === 'open' || P.state === 'eaten').length; },
    tongs: {
      object3D: tongsObj,
      setAttention(k) { T.att = clamp(fin(k), 0, 1); },
    },
    pickWhole(ray) { return pickBy(ray, (P) => P.state === 'zaru' && !P.fly, 80); },
    breakDrag, breakOpen, breakCancel,
    pickHalf(ray) {
      try {
        const f = fingerPx(ray); if (!f) return null;
        let best = null, bd = 80;
        for (const P of pots) {
          if (P.state !== 'open') continue;
          for (let h = 0; h < 2; h++) {
            const H = P.halves[h]; if (H.bites <= 0 || H.anim || H.done) continue;
            H.g.updateMatrixWorld();
            const st = H.stages[H.st];
            scr(H.g.localToWorld(_pa.copy(st.centre)), _s1); scr(H.g.localToWorld(_pb.copy(st.tail)), _s2);
            const d = segDist(f, _s1, _s2);
            if (d < bd) { bd = d; best = { i: P.i, h }; }
          }
        }
        return best;
      } catch (e) { return null; }
    },
    bite,
    halfPos(i, h, out) {
      out = out || new V3();
      if (!valid(i)) return out.set(0, 0, 0);
      const P = pots[i];
      if (h !== 0 && h !== 1) return out.copy(P.root.position);
      const H = P.halves[h];
      if (P.state !== 'open' && P.state !== 'eaten' && !H.g.visible) return out.copy(P.root.position);
      H.g.updateMatrixWorld();
      return H.g.localToWorld(out.copy(H.stages[H.st].centre));
    },
    get eatenCount() { return pots.filter((P) => P.state === 'eaten').length; },
    getState, setState, update,
  };
  reset(1);
  return api;
}
