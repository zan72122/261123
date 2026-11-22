// Quilted yellow-gingham drawstring shoe bag (上履き袋), ~0.22 x 0.29 m.
// A parametric "pillow": two cloth sheets (front/back) joined by a piped seam on three sides,
// open (or drawstring-gathered) at the mouth. Recomputed only when pose/fill/open change.
//
// Poses (group-local frames):
//  'lying'   : flat on the ground, origin = centre of the underside (y = 0 is the ground),
//              long axis along Z, mouth at +Z, front face up (+Y).
//  'hanging' : origin = top of the carry loop (clothespin grip point); body hangs toward -Y,
//              mouth at the top facing +Y, width along X, flat FRONT face toward local +Z
//              (rotate the group about Y to turn the front where you need it).
import * as THREE from 'three';

const W = 0.22, LEN = 0.29, T0 = 0.0135, LOOP_H = 0.07, EDGE_H = 0.006;
const NU = 34, NV = 46;
const NAVY = 0x1d2747;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % per) + per) % per;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed), c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(u, v, per0, oct, seed) { let s = 0, w = 0.5, t = 0, p = per0; for (let o = 0; o < oct; o++) { s += w * vnoise(u * p, v * p, p, seed + o * 17); t += w; w *= 0.5; p *= 2; } return s / t; }

// ---------------------------------------------------------------- textures (one 128 mm tile)
let TEX = null;
function buildTextures() {
  if (TEX) return TEX;
  const S = 512, PX = S / 128; // px per mm
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const img = g.createImageData(S, S); const d = img.data;
  const hgt = new Float32Array(S * S);
  const P = 32 * PX / 1; // quilting line spacing along an axis (32 mm)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // gingham: 8 mm bands
    const bx = Math.floor(x / (8 * PX)) & 1, by = Math.floor(y / (8 * PX)) & 1;
    // soften band edges a little (woven threads)
    const thread = (Math.sin(x * Math.PI * 2 / 2.0) * 0.5 + 0.5) * 0.5 + (Math.sin(y * Math.PI * 2 / 2.0) * 0.5 + 0.5) * 0.5;
    let r, gg, b;
    if (bx && by) { r = 232; gg = 196; b = 58; } else if (bx || by) { r = 244; gg = 222; b = 118; } else { r = 246; gg = 243; b = 232; }
    // diagonal quilting: distance to nearest line of either family
    const d1 = Math.abs((((x + y) % P) + P) % P - P / 2), d2 = Math.abs((((x - y) % P) + P) % P - P / 2);
    const e1 = (P / 2 - d1) / Math.SQRT2, e2 = (P / 2 - d2) / Math.SQRT2; // px from line
    const e = Math.min(e1, e2) / PX; // mm
    const puff = Math.sqrt(Math.min(1, e / 7)); // rises from the stitch groove
    const n = fbm(x / S, y / S, 16, 3, 5);
    const h = puff * 1.0 + (thread - 0.5) * 0.06 + (n - 0.5) * 0.12;
    hgt[y * S + x] = h;
    const ao = 0.72 + 0.28 * puff;
    const stitch = e < 0.35 && (Math.floor((x + y * (e1 < e2 ? 1 : -1)) / (2.2 * PX)) & 1) ? 0.82 : 1;
    const k = ao * stitch * (0.97 + 0.06 * (thread - 0.5) + 0.05 * (n - 0.5));
    const o = (y * S + x) * 4; d[o] = r * k; d[o + 1] = gg * k; d[o + 2] = b * k; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const nd = new Uint8Array(S * S * 4), k = 1.6;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x - 1 + S) % S];
    const hy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    // canvas rows run top->bottom while texture v runs bottom->top (flipY): flip the y slope
    let nx = -hx * k, ny = hy * k, nz = 1; const l = Math.hypot(nx, ny, nz);
    const o = ((S - 1 - y) * S + x) * 4; nd[o] = (nx / l * 0.5 + 0.5) * 255; nd[o + 1] = (ny / l * 0.5 + 0.5) * 255; nd[o + 2] = (nz / l * 0.5 + 0.5) * 255; nd[o + 3] = 255;
  }
  const nrm = new THREE.DataTexture(nd, S, S, THREE.RGBAFormat);
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.minFilter = THREE.LinearMipmapLinearFilter; nrm.magFilter = THREE.LinearFilter; nrm.generateMipmaps = true; nrm.needsUpdate = true;
  // dust blotches
  const DS = 128, dd = new Uint8Array(DS * DS * 4);
  for (let y = 0; y < DS; y++) for (let x = 0; x < DS; x++) {
    const o = (y * DS + x) * 4; const v = fbm(x / DS, y / DS, 4, 5, 77);
    dd[o] = Math.min(255, Math.max(0, (v - 0.5) * 2.2 * 255 + 128)); dd[o + 1] = hash2(x, y, 9) * 255; dd[o + 2] = 0; dd[o + 3] = 255;
  }
  const dust = new THREE.DataTexture(dd, DS, DS, THREE.RGBAFormat);
  dust.wrapS = dust.wrapT = THREE.RepeatWrapping; dust.minFilter = THREE.LinearMipmapLinearFilter; dust.magFilter = THREE.LinearFilter; dust.generateMipmaps = true; dust.needsUpdate = true;
  // navy cotton (cord / tape)
  const cs = 64, cc = document.createElement('canvas'); cc.width = cc.height = cs; const cg = cc.getContext('2d');
  const ci = cg.createImageData(cs, cs);
  for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
    const tw = Math.sin((x + y) * Math.PI * 2 / 8) * 0.5 + 0.5; const kk = 0.8 + 0.3 * tw + (hash2(x, y, 3) - 0.5) * 0.1;
    const o = (y * cs + x) * 4; ci.data[o] = 29 * kk; ci.data[o + 1] = 39 * kk; ci.data[o + 2] = 71 * kk; ci.data[o + 3] = 255;
  }
  cg.putImageData(ci, 0, 0);
  const navy = new THREE.CanvasTexture(cc); navy.colorSpace = THREE.SRGBColorSpace; navy.wrapS = navy.wrapT = THREE.RepeatWrapping;
  TEX = { map, nrm, dust, navy };
  return TEX;
}

function patchDust(mat, U, inside) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDusty; uniform sampler2D uDust;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 dn = texture2D(uDust, vMapUv * 0.37);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), uDusty * 0.4);
          float dm = uDusty * clamp(0.45 + 0.55 * dn.r + (dn.g - 0.5) * 0.25, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.31, 0.25), dm * 0.5);
          diffuseColor.rgb *= 1.0 - uDusty * 0.12;
          ${inside ? 'if (!gl_FrontFacing) diffuseColor.rgb *= 0.42;' : ''}
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, uDusty);');
  };
  mat.customProgramCacheKey = () => 'bagdust' + (inside ? 'i' : '');
}

function gridIndex(rows, cols, flip) {
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = (i + 1) * cols + j, c = (i + 1) * cols + j + 1, d = i * cols + j + 1;
    if (!flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  return idx;
}

export function createBag(ctx) {
  buildTextures();
  const U = { uDusty: { value: 0 }, uDust: { value: TEX.dust } };
  const fabric = new THREE.MeshStandardMaterial({ map: TEX.map, normalMap: TEX.nrm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
  patchDust(fabric, U, true);
  const piping = new THREE.MeshStandardMaterial({ map: TEX.map, roughness: 0.9, metalness: 0 });
  patchDust(piping, U, false);
  const navyMat = new THREE.MeshStandardMaterial({ map: TEX.navy, roughness: 0.88, metalness: 0 });
  patchDust(navyMat, U, false);

  const group = new THREE.Group(); group.name = 'shoeBag';
  const body = new THREE.Group(); group.add(body);
  const mouth = new THREE.Object3D(); mouth.name = 'bagMouth'; body.add(mouth);

  const nVert = (NU + 1) * (NV + 1);
  const mkSheet = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nVert * 3), 3));
    const uv = new Float32Array(nVert * 2);
    for (let iv = 0; iv <= NV; iv++) for (let iu = 0; iu <= NU; iu++) { const k = iv * (NU + 1) + iu; uv[k * 2] = iu / NU * W / 0.128; uv[k * 2 + 1] = iv / NV * LEN / 0.128; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(gridIndex(NV + 1, NU + 1, false));
    const m = new THREE.Mesh(geo, fabric); m.castShadow = true; m.receiveShadow = true; body.add(m);
    return m;
  };
  const front = mkSheet(), back = mkSheet();
  // offset the back sheet's checks a bit, like a separate panel
  { const uv = back.geometry.attributes.uv.array; for (let k = 0; k < uv.length; k += 2) uv[k] = -uv[k] + 0.03; }
  const seamMesh = new THREE.Mesh(new THREE.BufferGeometry(), piping); seamMesh.castShadow = true; seamMesh.receiveShadow = true; body.add(seamMesh);
  const hemF = new THREE.Mesh(new THREE.BufferGeometry(), piping); hemF.castShadow = true; hemF.receiveShadow = true; body.add(hemF);
  const hemB = new THREE.Mesh(new THREE.BufferGeometry(), piping); hemB.castShadow = true; hemB.receiveShadow = true; body.add(hemB);
  const cord = new THREE.Mesh(new THREE.BufferGeometry(), navyMat); cord.castShadow = true; cord.receiveShadow = true; body.add(cord);
  const loop = new THREE.Mesh(new THREE.BufferGeometry(), navyMat); loop.castShadow = true; loop.receiveShadow = true; body.add(loop);
  const knotGeo = new THREE.SphereGeometry(0.0055, 12, 8);
  const knots = [new THREE.Mesh(knotGeo, navyMat), new THREE.Mesh(knotGeo, navyMat)];
  for (const k of knots) { k.scale.set(1, 0.8, 1); k.castShadow = true; body.add(k); }

  const st = { pose: 'lying', fill: 0, open: 0, dusty: 0, dirty: true, sq: 0, sqv: 0 };

  // ---- shape model, bag frame: X across, Y along (0 bottom .. LEN mouth), Z thickness (front +)
  const lumps = (u, v, hanging) => {
    const s1 = Math.min(1, Math.max(0, st.fill)), s2 = Math.min(1, Math.max(0, st.fill - 1));
    const lu = (c) => Math.exp(-Math.pow((u - c) / 0.25, 6));
    let along;
    if (hanging) along = sm(0.3, 0.45, v) * (0.85 + 0.15 * sm(0.8, 0.45, v)); // toe boxes low, heels at the mouth
    else along = sm(0.22, 0.45, v) * (0.85 + 0.15 * sm(0.5, 0.85, v));                          // shoes toward the mouth
    const one = lu(0.5), two = lu(0.29) + lu(0.71);
    return (s1 * (1 - s2) * one + s2 * Math.min(1, two)) * along;
  };
  const shape = (u, v, side, hanging, out) => {
    const eu = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42);
    const evb = Math.pow(Math.sin(Math.min(1, v / 0.13) * Math.PI / 2), 0.55);
    const top = sm(0.72, 1.0, v);
    const gather = (1 - st.open) * 0.5;
    const mouthGap = st.open * 0.03 * Math.pow(Math.sin(Math.PI * u), 0.8) + 0.0025 * eu;
    // width: gathered at the mouth, a bit pulled in when stuffed
    let ws = 1 - gather * sm(0.8, 1.0, v) - st.fill * 0.012 * Math.sin(Math.PI * v);
    if (hanging) ws += st.fill * 0.02 * sm(0.5, 0.0, v);
    let x = (u - 0.5) * W * ws;
    let y = v * LEN;
    if (hanging) y -= st.fill * 0.012 * Math.sin(Math.PI * u) * sm(0.25, 0.0, v); // weight sags the bottom
    const lump = lumps(u, v, hanging);
    const base = T0 * eu * evb;
    const eu2 = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.22);
    let thick = Math.max(base * (1 - top) + mouthGap * top, base + 0.024 * lump * eu2);
    // soft static wrinkles + drawstring pleats
    const wr = 0.0011 * (Math.sin(u * 9.1 + v * 13.7) + 0.6 * Math.sin(u * 17.3 - v * 7.9 + 1.3)) * eu * evb;
    const pleat = (1 - st.open) * 0.0042 * Math.sin(u * Math.PI * 2 * 7.5) * sm(0.78, 1.0, v) * eu;
    const hemRoll = 0.0022 * sm(0.88, 0.95, v) * eu; // drawstring channel
    let z = side * (thick + hemRoll + wr * (side > 0 ? 1 : 0.6)) + pleat;
    // when cinched, the gathered top also crumples along the length a bit
    y -= (1 - st.open) * 0.006 * sm(0.9, 1.0, v) * (0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 7.5));
    return out.set(x, y, z);
  };
  // bag frame -> pose-local
  const toPose = (p, side, u, v, out) => {
    if (st.pose === 'hanging') return out.set(p.x, p.y - LEN - LOOP_H, p.z);
    // lying: underside flat on the ground, front takes all the volume
    const eu = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.42), evb = Math.pow(Math.sin(Math.min(1, v / 0.13) * Math.PI / 2), 0.55);
    const flat = eu * evb;
    let y;
    if (side < 0) y = EDGE_H * (1 - flat) + 0.0006;
    else y = EDGE_H * (1 - flat) + 0.0006 + Math.max(0, p.z) * 2 * (0.25 + 0.75 * flat) + (flat > 0 ? 0 : 0);
    return out.set(p.x, y, p.y - LEN / 2);
  };

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const seamPts = [], hemFP = [], hemBP = [];
  // mouth frame from the analytic shape (kept current by the setters, so it can be read immediately)
  const mA = new THREE.Vector3(), mB = new THREE.Vector3(), mT = new THREE.Vector3();
  const placeMouth = () => {
    const hanging = st.pose === 'hanging';
    shape(0.5, 1, 1, hanging, mT); toPose(mT, 1, 0.5, 1, mA);
    shape(0.5, 1, -1, hanging, mT); toPose(mT, -1, 0.5, 1, mB);
    if (hanging) { mouth.position.set(0, (mA.y + mB.y) / 2 - 0.008, (mA.z + mB.z) / 2); mouth.rotation.set(-Math.PI / 2, 0, 0); }
    else { mouth.position.set(0, (mA.y + mB.y) / 2, Math.max(mA.z, mB.z) - 0.008); mouth.rotation.set(0, 0, 0); }
  };
  const rebuild = () => {
    const hanging = st.pose === 'hanging';
    for (const [m, side] of [[front, 1], [back, -1]]) {
      const pa = m.geometry.attributes.position.array;
      for (let iv = 0; iv <= NV; iv++) for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU, v = iv / NV;
        shape(u, v, side, hanging, tmp);
        // lying: the back sheet keeps its in-plane coords but lies flat
        toPose(side < 0 && !hanging ? tmp : tmp, side, u, v, tmp2);
        const k = (iv * (NU + 1) + iu) * 3; pa[k] = tmp2.x; pa[k + 1] = tmp2.y; pa[k + 2] = tmp2.z;
      }
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.computeVertexNormals();
      // orientation: centre normal must point out of the bag
      const c = ((NV >> 1) * (NU + 1) + (NU >> 1));
      const n = m.geometry.attributes.normal;
      const outward = hanging ? n.getZ(c) * side : n.getY(c) * side;
      if (outward < 0) { m.geometry.setIndex(gridIndex(NV + 1, NU + 1, !m.userData.flip)); m.userData.flip = !m.userData.flip; m.geometry.computeVertexNormals(); }
      m.geometry.computeBoundingSphere();
    }
    // seam along left edge (top->bottom), bottom, right edge (bottom->top): average of both sheets
    const fp = front.geometry.attributes.position.array, bp = back.geometry.attributes.position.array;
    const at = (iu, iv) => { const k = (iv * (NU + 1) + iu) * 3; return new THREE.Vector3((fp[k] + bp[k]) / 2, (fp[k + 1] + bp[k + 1]) / 2, (fp[k + 2] + bp[k + 2]) / 2); };
    seamPts.length = 0;
    for (let iv = NV; iv >= 1; iv--) seamPts.push(at(0, iv));
    seamPts.push(at(0, 0).lerp(at(1, 1), 0.25));
    for (let iu = 1; iu < NU; iu++) seamPts.push(at(iu, 0));
    seamPts.push(at(NU, 0).lerp(at(NU - 1, 1), 0.25));
    for (let iv = 1; iv <= NV; iv++) seamPts.push(at(NU, iv));
    const sc = new THREE.CatmullRomCurve3(seamPts, false, 'centripetal');
    seamMesh.geometry.dispose(); seamMesh.geometry = new THREE.TubeGeometry(sc, 160, 0.0034, 8, false);
    hemFP.length = 0; hemBP.length = 0;
    for (let iu = 0; iu <= NU; iu++) {
      const k = (NV * (NU + 1) + iu) * 3;
      hemFP.push(new THREE.Vector3(fp[k], fp[k + 1], fp[k + 2])); hemBP.push(new THREE.Vector3(bp[k], bp[k + 1], bp[k + 2]));
    }
    hemF.geometry.dispose(); hemF.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemFP), 60, 0.0022, 6, false);
    hemB.geometry.dispose(); hemB.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemBP), 60, 0.0022, 6, false);

    // drawstring tails out of the right-hand end of the channel; carry loop at the top centre (back sheet)
    const corner = at(NU, Math.round(NV * 0.93));
    const loopBase = new THREE.Vector3().fromArray(bp, (NV * (NU + 1) + (NU >> 1)) * 3);
    let tails, loopPts;
    if (hanging) {
      const sw = 0.02 * Math.sin(st.sq);
      tails = [[corner, corner.clone().add(new THREE.Vector3(0.012, -0.004, 0.006)), corner.clone().add(new THREE.Vector3(0.022, -0.03, 0.01)), corner.clone().add(new THREE.Vector3(0.024 + sw, -0.085, 0.012))],
        [corner, corner.clone().add(new THREE.Vector3(0.012, -0.006, -0.004)), corner.clone().add(new THREE.Vector3(0.016, -0.035, -0.006)), corner.clone().add(new THREE.Vector3(0.012 + sw, -0.105, -0.004))]];
      const top = new THREE.Vector3(0, 0, loopBase.z * 0.5);
      loopPts = [loopBase.clone().add(new THREE.Vector3(-0.004, -0.012, 0)), loopBase.clone().add(new THREE.Vector3(-0.006, 0.01, 0)),
        new THREE.Vector3(-0.011, -0.04, top.z), new THREE.Vector3(-0.007, -0.01, top.z), top.clone().add(new THREE.Vector3(0, -0.0012, 0)),
        new THREE.Vector3(0.007, -0.01, top.z), new THREE.Vector3(0.011, -0.04, top.z), loopBase.clone().add(new THREE.Vector3(0.006, 0.01, 0)), loopBase.clone().add(new THREE.Vector3(0.004, -0.012, 0))];
    } else {
      const g = 0.0028;
      tails = [[corner, corner.clone().add(new THREE.Vector3(0.012, -0.004, 0.004)), new THREE.Vector3(corner.x + 0.024, g, corner.z + 0.01), new THREE.Vector3(corner.x + 0.034, g, corner.z + 0.035), new THREE.Vector3(corner.x + 0.026, g, corner.z + 0.06)],
        [corner, corner.clone().add(new THREE.Vector3(0.012, -0.004, -0.004)), new THREE.Vector3(corner.x + 0.026, g, corner.z - 0.008), new THREE.Vector3(corner.x + 0.05, g, corner.z + 0.0), new THREE.Vector3(corner.x + 0.068, g, corner.z + 0.02)]];
      const b = loopBase, gy = 0.0016;
      loopPts = [b.clone().add(new THREE.Vector3(-0.004, 0, -0.012)), new THREE.Vector3(b.x - 0.008, gy + 0.002, b.z + 0.006), new THREE.Vector3(b.x - 0.03, gy, b.z + 0.035),
        new THREE.Vector3(b.x - 0.05, gy, b.z + 0.065), new THREE.Vector3(b.x - 0.038, gy, b.z + 0.074), new THREE.Vector3(b.x - 0.016, gy, b.z + 0.05),
        new THREE.Vector3(b.x - 0.002, gy + 0.002, b.z + 0.012), b.clone().add(new THREE.Vector3(0.004, 0, -0.012))];
    }
    const tg = [];
    tails.forEach((pts, i) => {
      const cv = new THREE.CatmullRomCurve3(pts);
      tg.push(new THREE.TubeGeometry(cv, 40, 0.0023, 7, false));
      knots[i].position.copy(cv.getPoint(1));
    });
    cord.geometry.dispose(); cord.geometry = mergeTubes(tg);
    // carry loop: flat tape (wide along the local side direction)
    loop.geometry.dispose(); loop.geometry = tapeGeometry(new THREE.CatmullRomCurve3(loopPts), hanging ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), 0.0095, 0.0009);

    placeMouth();
    st.dirty = false;
  };

  function mergeTubes(list) {
    let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
    let o = 0, oi = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      const gu = g.attributes.uv.array; for (let k = 0; k < gu.length; k += 2) { uv[o * 2 + k] = gu[k] * 6; uv[o * 2 + k + 1] = gu[k + 1]; }
      const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[oi + k] = gi[k] + o;
      o += g.attributes.position.count; oi += gi.length; g.dispose();
    }
    const r = new THREE.BufferGeometry();
    r.setAttribute('position', new THREE.BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); r.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    r.setIndex(new THREE.BufferAttribute(idx, 1));
    return r;
  }
  function tapeGeometry(curve, upHint, hw, ht) {
    const NS = 64, RS = 10, pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const t = i / NS, p = curve.getPoint(t), tg = curve.getTangent(t);
      const sideV = upHint.clone().addScaledVector(tg, -tg.dot(upHint)).normalize();
      const nn = new THREE.Vector3().crossVectors(sideV, tg).normalize();
      for (let k = 0; k < RS; k++) {
        const a = k / RS * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const sx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.3), sy = Math.sign(sa) * Math.pow(Math.abs(sa), 0.3);
        pos.push(p.x + sideV.x * sx * hw + nn.x * sy * ht, p.y + sideV.y * sx * hw + nn.y * sy * ht, p.z + sideV.z * sx * hw + nn.z * sy * ht);
        const q = new THREE.Vector3().addScaledVector(sideV, ca / hw).addScaledVector(nn, sa / ht).normalize();
        nor.push(q.x, q.y, q.z); uv.push(t * 8, k / RS);
      }
    }
    for (let i = 0; i < NS; i++) for (let k = 0; k < RS; k++) { const k1 = (k + 1) % RS; const a = i * RS + k, b = (i + 1) * RS + k, c = (i + 1) * RS + k1, d = i * RS + k1; idx.push(a, b, d, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // winding vs normals
    const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); let s = 0;
    for (let t = 0; t < ix.length; t += 3) { A.fromArray(p, ix[t] * 3); B.fromArray(p, ix[t + 1] * 3).sub(A); C.fromArray(p, ix[t + 2] * 3).sub(A); B.cross(C); s += B.x * n[ix[t] * 3] + B.y * n[ix[t] * 3 + 1] + B.z * n[ix[t] * 3 + 2]; }
    if (s < 0) for (let t = 0; t < ix.length; t += 3) { const q = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = q; }
    return g;
  }

  const api = {
    group, mouth, SIZE: { w: W, l: LEN },
    setPose(p) { if (p !== 'lying' && p !== 'hanging') return; if (p !== st.pose) { st.pose = p; st.dirty = true; placeMouth(); } },
    setFill(f) { f = Math.min(2, Math.max(0, f)); if (Math.abs(f - st.fill) > 0.002) { st.fill = f; st.dirty = true; placeMouth(); } },
    setOpen(o) { o = Math.min(1, Math.max(0, o)); if (Math.abs(o - st.open) > 0.002) { st.open = o; st.dirty = true; placeMouth(); } },
    setDusty(d) { st.dusty = Math.min(1, Math.max(0, d)); U.uDusty.value = st.dusty; },
    squish(a) { st.sqv -= Math.min(1, Math.max(0, a)) * 9; },
    update(dt) {
      dt = Math.min(dt || 0, 0.05);
      // springy squash (critically under-damped)
      const k = 260, c = 9;
      st.sqv += (-k * st.sq - c * st.sqv) * dt; st.sq += st.sqv * dt;
      if (Math.abs(st.sq) < 1e-4 && Math.abs(st.sqv) < 1e-3) { st.sq = 0; st.sqv = 0; }
      const s = Math.max(-0.4, Math.min(0.4, st.sq));
      if (st.pose === 'lying') body.scale.set(1 - s * 0.35, 1 + s * 1.4, 1 - s * 0.2);
      else body.scale.set(1 - s * 0.4, 1 + s * 0.5, 1 - s * 0.5);
      if (st.dirty) rebuild();
    },
  };
  rebuild();
  return api;
}
