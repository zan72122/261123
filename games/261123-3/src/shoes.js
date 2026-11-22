// Uwabaki (Japanese ballet-type indoor school shoes), child size 18 cm.
// Local frame: origin = centre of the sole's bottom face; toe -Z, heel +Z, up +Y.
// The upper is a custom lofted annulus between the sole outline and the foot-opening rim.
// Dirt: a low-res Float32 grid (source of truth) uploaded as a tiny R8 texture and
// composited in the shader with a static mud pattern via planar projection from above (local XZ).
import * as THREE from 'three';

const LENGTH = 0.19, WIDTH = 0.076, HZ = LENGTH / 2;
const SOLE_T = 0.012;          // sole thickness
const UP_Y0 = 0.0105;          // upper starts (embedded) inside the sole's top edge
const BASE_INSET = 0.0022;     // upper base inset from sole outline
const THK = 0.0022;            // canvas wall thickness
const INSOLE_Y = 0.0155;
const COLLAR_H = 0.052;
const CAP_RED = new THREE.Color(0xcf3a34);
const zOf = (s) => HZ - s * LENGTH;

// dirt grid
const GX = 40, GZ = 80, X0 = -0.048, X1 = 0.048, Z0 = -0.1, Z1 = 0.1;
const DX = (X1 - X0) / GX, DZ = (Z1 - Z0) / GZ;

// ---------------------------------------------------------------- outline (right shoe; big toe side = -X)
// [s from heel (0) to toe (1), x]
const OUTLINE_CP = [
  [0.000, 0.0010], [0.022, 0.0165], [0.065, 0.0250], [0.14, 0.0283], [0.30, 0.0298], [0.45, 0.0330],
  [0.60, 0.0383], [0.70, 0.0378], [0.80, 0.0335], [0.88, 0.0268], [0.94, 0.0185], [0.977, 0.0085],
  [0.997, -0.0035], [0.994, -0.0125], [0.968, -0.0225], [0.90, -0.0318], [0.80, -0.0362], [0.68, -0.0375],
  [0.55, -0.0338], [0.40, -0.0292], [0.25, -0.0276], [0.13, -0.0280], [0.06, -0.0242], [0.02, -0.0150],
];

function closedSpline(pts3, n) {
  const c = new THREE.CatmullRomCurve3(pts3, true, 'centripetal');
  return c.getSpacedPoints(n).slice(0, n);
}
// polyline helpers (arrays of Vector3, closed)
function polyAt(poly, u) {
  const n = poly.length; let f = ((u % 1) + 1) % 1 * n; const i = Math.floor(f); f -= i;
  const a = poly[i % n], b = poly[(i + 1) % n];
  return new THREE.Vector3().lerpVectors(a, b, f);
}
// param u (0..1) where the polyline crosses plane z on side sign (+1: max x, -1: min x)
function crossU(poly, z, sign) {
  const n = poly.length; let best = null, bx = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) {
      const f = (z - a.z) / (b.z - a.z); const x = a.x + (b.x - a.x) * f;
      if (best === null || (sign > 0 ? x > bx : x < bx)) { best = (i + f) / n; bx = x; }
    }
  }
  return best;
}
function minZU(poly) { let k = 0; for (let i = 1; i < poly.length; i++) if (poly[i].z < poly[k].z) k = i; return k / poly.length; }

function insidePoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
function offsetPoly(poly, d) { // d > 0: outward
  const n = poly.length, out = [];
  // orientation
  let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a.x * b.z - b.x * a.z; }
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    out.push(new THREE.Vector3(poly[i].x + sg * (tz / l) * d, poly[i].y, poly[i].z - sg * (tx / l) * d));
  }
  return out;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function interpTable(tab, s) {
  if (s <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (s <= tab[i][0]) {
    const f = (s - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]); const g = f * f * (3 - 2 * f);
    return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * g;
  }
  return tab[tab.length - 1][1];
}

// ---------------------------------------------------------------- shared shape data (built once)
let SHAPE = null;
function buildShape() {
  if (SHAPE) return SHAPE;
  const ND = 480;
  let sole = closedSpline(OUTLINE_CP.map(([s, x]) => new THREE.Vector3(x, 0, zOf(s))), ND);
  // normalise to exact length / width
  let mnx = 1, mxx = -1, mnz = 1, mxz = -1;
  for (const p of sole) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
  const sx = WIDTH / (mxx - mnx), sz = LENGTH / (mxz - mnz), cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2;
  sole = sole.map((p) => new THREE.Vector3((p.x - cx) * sx, 0, (p.z - cz) * sz));
  const base = offsetPoly(sole, -BASE_INSET);
  // side x of base outline at s
  const sideX = (s, sg) => polyAt(base, crossU(base, zOf(s), sg)).x;
  const RIM_F = [[0.062, 0], [0.068, 0.42], [0.082, 0.74], [0.105, 0.93], [0.14, 1], [0.25, 1], [0.36, 1], [0.46, 1],
    [0.505, 0.985], [0.535, 0.9], [0.556, 0.72], [0.571, 0.42], [0.578, 0]];
  const RIM_H = [[0.06, COLLAR_H], [0.10, 0.0515], [0.18, 0.0492], [0.30, 0.0458], [0.42, 0.0428], [0.50, 0.0412], [0.58, 0.0402]];
  const INSET = (s) => interpTable([[0.06, 0.0034], [0.2, 0.0040], [0.5, 0.0046]], s);
  const rimPt = (s, f, sg) => {
    const sc = Math.min(Math.max(s, 0.1), 0.52); // measure width where it is meaningful
    const xo = sideX(sc, 1), xi = sideX(sc, -1);
    const xs = sideX(Math.min(Math.max(s, 0.07), 0.6), sg);
    const mid = (xo + xi) / 2;
    const half = Math.abs(xs - mid) - INSET(s);
    return new THREE.Vector3(mid + sg * f * half, interpTable(RIM_H, s), zOf(s));
  };
  const rimCP = [];
  for (let i = 0; i < RIM_F.length; i++) rimCP.push(rimPt(RIM_F[i][0], RIM_F[i][1], 1));
  for (let i = RIM_F.length - 2; i >= 1; i--) rimCP.push(rimPt(RIM_F[i][0], RIM_F[i][1], -1));
  const rim = closedSpline(rimCP, ND);
  // anchors (outline param -> rim param)
  const aO = [0, crossU(base, zOf(0.15), 1), crossU(base, zOf(0.44), 1), minZU(base), crossU(base, zOf(0.44), -1), crossU(base, zOf(0.15), -1), 1];
  const aR = [0, crossU(rim, zOf(0.15), 1), crossU(rim, zOf(0.44), 1), minZU(rim), crossU(rim, zOf(0.44), -1), crossU(rim, zOf(0.15), -1), 1];
  const mapU = (u) => {
    for (let k = 0; k < 6; k++) if (u <= aO[k + 1]) {
      let f = (u - aO[k]) / (aO[k + 1] - aO[k]);
      return aR[k] + f * (aR[k + 1] - aR[k]);
    }
    return u;
  };
  // rim arc length per rim param (for stitch dashes)
  const rimArc = new Float32Array(ND + 1); for (let i = 1; i <= ND; i++) rimArc[i] = rimArc[i - 1] + rim[i - 1].distanceTo(rim[i % ND]);
  const baseArc = new Float32Array(ND + 1); for (let i = 1; i <= ND; i++) baseArc[i] = baseArc[i - 1] + base[i - 1].distanceTo(base[i % ND]);
  const arcAt = (arr, u) => { let f = (((u % 1) + 1) % 1) * ND; const i = Math.floor(f); f -= i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
  // toe cap edge: z < CAP.z0 + CAP.k*(x-CAP.xc)^2
  const xm = (sideX(0.78, 1) + sideX(0.78, -1)) / 2;
  const CAP = { z0: zOf(0.785), k: 9.5, xc: xm };
  const MARK = { x: (sideX(0.68, 1) + sideX(0.68, -1)) / 2 - 0.001, z: zOf(0.682), size: 0.019 };
  SHAPE = { ND, sole, base, rim, mapU, rimArc, baseArc, arcAt, CAP, MARK };
  return SHAPE;
}

// surface point of the upper: u (0..1 around outline), t (0 base .. 1 rim)
function evalUpper(S, u, t, out) {
  const B = polyAt(S.base, u), R = polyAt(S.rim, S.mapU(u));
  const dx = R.x - B.x, dz = R.z - B.z, D = Math.hypot(dx, dz) || 1e-6;
  const H = R.y - UP_Y0;
  const w = smooth(0.013, 0.05, D);
  let ex = 0.30 + (1 - 0.30) * w, ey = 1 + (0.10 - 1) * w; const el = Math.hypot(ex, ey); ex /= el; ey /= el;
  const a = H * (0.45 + 0.32 * w), b = (H * 0.45) * (1 - w) + (D * 0.55) * w;
  const p1r = 0, p1y = UP_Y0 + a, p2r = D - ex * b, p2y = R.y - ey * b;
  const it = 1 - t;
  const r = 3 * it * it * t * p1r + 3 * it * t * t * p2r + t * t * t * D;
  const y = it * it * it * UP_Y0 + 3 * it * it * t * p1y + 3 * it * t * t * p2y + t * t * t * R.y;
  return out.set(B.x + dx / D * r, y, B.z + dz / D * r);
}

// ---------------------------------------------------------------- geometry builders
function gridIndex(rows, cols, cyclic, flip) {
  const idx = [];
  const cc = cyclic ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cc; j++) {
    const j1 = (j + 1) % cols;
    const a = i * cols + j, b = (i + 1) * cols + j, c = (i + 1) * cols + j1, d = i * cols + j1;
    if (!flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  return idx;
}
// normals for a (rows x cols) grid, cyclic in cols. returns Float32Array and orientation sign info
function gridNormals(P, rows, cols, sign) {
  const N = new Float32Array(rows * cols * 3);
  const g = (i, j, k) => P[((i * cols) + ((j + cols) % cols)) * 3 + k];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(rows - 1, i + 1);
    const tx = g(i1, j, 0) - g(i0, j, 0), ty = g(i1, j, 1) - g(i0, j, 1), tz = g(i1, j, 2) - g(i0, j, 2);
    const ux = g(i, j + 1, 0) - g(i, j - 1, 0), uy = g(i, j + 1, 1) - g(i, j - 1, 1), uz = g(i, j + 1, 2) - g(i, j - 1, 2);
    let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
    const l = Math.hypot(nx, ny, nz) || 1; const o = (i * cols + j) * 3;
    N[o] = sign * nx / l; N[o + 1] = sign * ny / l; N[o + 2] = sign * nz / l;
  }
  return N;
}

function buildUpper(S, low) {
  const NC = low ? 132 : 176, NR = low ? 30 : 42; // NR even
  const rows = NR + 1, cols = NC;
  const P = new Float32Array(rows * cols * 3), RIM = new Float32Array(rows * cols * 2), UV = new Float32Array(rows * cols * 2);
  const v = new THREE.Vector3();
  for (let j = 0; j < cols; j++) {
    const u = j / cols;
    for (let i = 0; i < rows; i++) { evalUpper(S, u, i / NR, v); const o = (i * cols + j) * 3; P[o] = v.x; P[o + 1] = v.y; P[o + 2] = v.z; }
    // distance to rim along the column
    let acc = 0; const ru = S.arcAt(S.rimArc, S.mapU(u)), bu = S.arcAt(S.baseArc, u);
    for (let i = rows - 1; i >= 0; i--) {
      if (i < rows - 1) { const a = (i * cols + j) * 3, b = ((i + 1) * cols + j) * 3; acc += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
      RIM[(i * cols + j) * 2] = acc; RIM[(i * cols + j) * 2 + 1] = ru;
      UV[(i * cols + j) * 2] = bu / 0.016; UV[(i * cols + j) * 2 + 1] = acc / 0.016;
    }
  }
  // orientation: at outer side (max x) mid row, normal should point +x
  let jx = 0; for (let j = 0; j < cols; j++) if (P[((NR >> 1) * cols + j) * 3] > P[((NR >> 1) * cols + jx) * 3]) jx = j;
  let Nn = gridNormals(P, rows, cols, 1);
  const sign = Nn[((NR >> 1) * cols + jx) * 3] > 0 ? 1 : -1;
  Nn = gridNormals(P, rows, cols, sign);
  // toe cap: rubber stands 0.6 mm proud of the canvas
  const C = S.CAP;
  for (let k = 0; k < rows * cols; k++) {
    const x = P[k * 3], z = P[k * 3 + 2], y = P[k * 3 + 1];
    const ze = C.z0 + C.k * (x - C.xc) * (x - C.xc);
    const m = smooth(ze + 0.0012, ze - 0.0012, z) * smooth(UP_Y0 + 0.0005, UP_Y0 + 0.004, y);
    P[k * 3] += Nn[k * 3] * 0.0006 * m; P[k * 3 + 1] += Nn[k * 3 + 1] * 0.0006 * m; P[k * 3 + 2] += Nn[k * 3 + 2] * 0.0006 * m;
  }
  Nn = gridNormals(P, rows, cols, sign);
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.BufferAttribute(P, 3));
  outer.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  outer.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  outer.setAttribute('aRim', new THREE.BufferAttribute(RIM, 2));
  outer.setIndex(gridIndex(rows, cols, true, sign < 0));

  // inner lining (coarser): offset inward
  const ir = (NR >> 1) + 1, ic = cols >> 1;
  const IP = new Float32Array(ir * ic * 3), IN = new Float32Array(ir * ic * 3), IR = new Float32Array(ir * ic * 2), IUV = new Float32Array(ir * ic * 2);
  for (let i = 0; i < ir; i++) for (let j = 0; j < ic; j++) {
    const s = ((i * 2) * cols + j * 2), d = i * ic + j;
    for (let k = 0; k < 3; k++) { IP[d * 3 + k] = P[s * 3 + k] - Nn[s * 3 + k] * THK; IN[d * 3 + k] = -Nn[s * 3 + k]; }
    IR[d * 2] = RIM[s * 2]; IR[d * 2 + 1] = RIM[s * 2 + 1]; IUV[d * 2] = UV[s * 2]; IUV[d * 2 + 1] = UV[s * 2 + 1];
  }
  // lift bottom row of lining a bit so it meets the insole
  const inner = new THREE.BufferGeometry();
  inner.setAttribute('position', new THREE.BufferAttribute(IP, 3));
  inner.setAttribute('normal', new THREE.BufferAttribute(IN, 3));
  inner.setAttribute('uv', new THREE.BufferAttribute(IUV, 2));
  inner.setAttribute('aRim', new THREE.BufferAttribute(IR, 2));
  inner.setIndex(gridIndex(ir, ic, true, sign > 0));

  // binding tube along the rim
  const TS = low ? 6 : 9, bp = [], bn = [], buv = [], brim = [];
  for (let j = 0; j < cols; j++) {
    const o = (NR * cols + j) * 3, o2 = ((NR - 1) * cols + j) * 3;
    const n = new THREE.Vector3(Nn[o], Nn[o + 1], Nn[o + 2]);
    const td = new THREE.Vector3(P[o] - P[o2], P[o + 1] - P[o2 + 1], P[o + 2] - P[o2 + 2]).normalize();
    td.addScaledVector(n, -td.dot(n)).normalize();
    const c = new THREE.Vector3(P[o], P[o + 1], P[o + 2]).addScaledVector(n, -THK * 0.5).addScaledVector(td, -0.0003);
    const rN = THK * 0.5 + 0.00075, rT = 0.0017;
    for (let k = 0; k < TS; k++) {
      const a = k / TS * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      bp.push(c.x + n.x * ca * rN + td.x * sa * rT, c.y + n.y * ca * rN + td.y * sa * rT, c.z + n.z * ca * rN + td.z * sa * rT);
      const nn = new THREE.Vector3().addScaledVector(n, ca / rN).addScaledVector(td, sa / rT).normalize();
      bn.push(nn.x, nn.y, nn.z); buv.push(RIM[(NR * cols + j) * 2 + 1] / 0.016, k / TS); brim.push(0.001, RIM[(NR * cols + j) * 2 + 1]);
    }
  }
  // tube grid: rows = cols(ring index along rim), cols = TS (cyclic); also cyclic along rim
  const tidx = [];
  for (let j = 0; j < cols; j++) for (let k = 0; k < TS; k++) {
    const j1 = (j + 1) % cols, k1 = (k + 1) % TS;
    const a = j * TS + k, b = j1 * TS + k, c = j1 * TS + k1, d = j * TS + k1;
    tidx.push(a, b, d, b, c, d);
  }
  const bind = new THREE.BufferGeometry();
  bind.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bind.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  bind.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bind.setAttribute('aRim', new THREE.Float32BufferAttribute(brim, 2));
  bind.setIndex(tidx); fixWinding(bind);
  return { outer, inner, bind, P, rows, cols };
}

// make every triangle's winding agree with its vertex normals
function fixWinding(geo) {
  const p = geo.attributes.position.array, n = geo.attributes.normal.array, ix = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let pos = 0, neg = 0;
  for (let t = 0; t < ix.length; t += 3) {
    a.fromArray(p, ix[t] * 3); b.fromArray(p, ix[t + 1] * 3); c.fromArray(p, ix[t + 2] * 3);
    b.sub(a); c.sub(a); b.cross(c);
    const d = b.x * n[ix[t] * 3] + b.y * n[ix[t] * 3 + 1] + b.z * n[ix[t] * 3 + 2];
    if (d >= 0) pos++; else neg++;
  }
  if (neg > pos) for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
}

function buildSole(S, low) {
  const NC = low ? 132 : 176;
  const ring = [];
  for (let j = 0; j < NC; j++) ring.push(polyAt(S.sole, j / NC));
  // profile: [inset, y]
  const prof = [];
  const rb = 0.0026, rt = 0.0032;
  for (let k = 0; k <= 4; k++) { const a = k / 4 * Math.PI / 2; prof.push([rb * (1 - Math.sin(a)), rb * (1 - Math.cos(a))]); }
  prof.push([0, SOLE_T * 0.5]);
  for (let k = 0; k <= 5; k++) { const a = k / 5 * Math.PI / 2; prof.push([rt * (1 - Math.cos(a)), SOLE_T - rt + rt * Math.sin(a)]); }
  prof.push([0.008, SOLE_T]);
  const rings = prof.map(([o]) => offsetPoly(ring, -o));
  const pos = [];
  for (let i = 0; i < prof.length; i++) for (let j = 0; j < NC; j++) pos.push(rings[i][j].x, prof[i][1], rings[i][j].z);
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setIndex(gridIndex(prof.length, NC, true, false));
  side.computeVertexNormals();
  // make normals outward-consistent
  const nrm = side.attributes.normal;
  let jx = 0; for (let j = 0; j < NC; j++) if (ring[j].x > ring[jx].x) jx = j;
  if (nrm.getX(5 * NC + jx) < 0) { side.setIndex(gridIndex(prof.length, NC, true, true)); side.computeVertexNormals(); }
  const uvs = []; for (let k = 0; k < pos.length; k += 3) uvs.push(pos[k] / 0.016, pos[k + 2] / 0.016);
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // bottom cap (tread)
  const r0 = rings[0];
  const tri = THREE.ShapeUtils.triangulateShape(r0.map((p) => new THREE.Vector2(p.x, p.z)), []);
  const bpos = [], bn = [], buv = [];
  for (const p of r0) { bpos.push(p.x, 0, p.z); bn.push(0, -1, 0); buv.push(p.x / 0.1 + 0.5, p.z / 0.1 + 0.5); }
  const bidx = []; for (const t of tri) bidx.push(t[0], t[1], t[2]);
  const bottom = new THREE.BufferGeometry();
  bottom.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  bottom.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  bottom.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bottom.setIndex(bidx); fixWinding(bottom);
  // top cap under the insole
  const rl = rings[rings.length - 1];
  const tpos = [], tn = [], tuv = [];
  for (const p of rl) { tpos.push(p.x, SOLE_T, p.z); tn.push(0, 1, 0); tuv.push(p.x / 0.016, p.z / 0.016); }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  top.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  top.setIndex(bidx.slice()); fixWinding(top);
  return { side, bottom, top };
}

function buildInsole(S) {
  const NCI = 120, ring = [];
  for (let j = 0; j < NCI; j++) ring.push(polyAt(S.base, j / NCI));
  const r1 = offsetPoly(ring, -(THK + 0.0004)), r2 = offsetPoly(ring, -(THK + 0.0040));
  const tri = THREE.ShapeUtils.triangulateShape(r2.map((p) => new THREE.Vector2(p.x, p.z)), []);
  const pos = [], idx = [];
  for (const p of r2) pos.push(p.x, INSOLE_Y, p.z);
  for (const p of r1) pos.push(p.x, INSOLE_Y + 0.0022, p.z); // slightly cupped edge
  for (const t of tri) idx.push(t[0], t[1], t[2]);
  for (let j = 0; j < NCI; j++) { const j1 = (j + 1) % NCI; idx.push(j, NCI + j, j1, NCI + j, NCI + j1, j1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = []; for (let k = 0; k < pos.length; k += 3) uv.push(pos[k] / 0.016, pos[k + 2] / 0.016);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // ensure up
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; } g.computeVertexNormals(); }
  return g;
}

function rimAtZ(S, z, sg) { const u = crossU(S.rim, z, sg); return u == null ? null : polyAt(S.rim, u); }

function buildBand(S, low) {
  const NA = low ? 36 : 52, NZ = low ? 12 : 18;
  const za = zOf(0.40), zb = zOf(0.516);
  const pos = [], uv = [];
  for (let i = 0; i <= NZ; i++) {
    const z = za + (zb - za) * i / NZ;
    const rp = rimAtZ(S, z, 1), rm = rimAtZ(S, z, -1);
    const xc = (rp.x + rm.x) / 2, A = (rp.x - rm.x) / 2 + 0.0017;
    const yr = (rp.y + rm.y) / 2, yc = yr - 0.0012, B = 0.0052;
    const bmax = Math.PI / 2 + 0.55;
    for (let k = 0; k <= NA; k++) {
      const beta = (k / NA * 2 - 1) * bmax;
      let x, y;
      if (Math.abs(beta) <= Math.PI / 2) { x = xc + A * Math.sin(beta); y = yc + B * Math.cos(beta); }
      else { const e = Math.abs(beta) - Math.PI / 2; x = xc + Math.sign(beta) * (A + e * 0.0012); y = yc - e * 0.0075; }
      pos.push(x, y, z); uv.push(x / 0.016, z / 0.016);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(gridIndex(NZ + 1, NA + 1, false, false)); g.computeVertexNormals();
  if (g.attributes.normal.getY((NZ >> 1) * (NA + 1) + (NA >> 1)) < 0) { g.setIndex(gridIndex(NZ + 1, NA + 1, false, true)); g.computeVertexNormals(); }
  return g;
}

function buildTab(S) {
  const r = S.rim[0]; const z0 = r.z, y0 = r.y, x0 = r.x;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x0, y0 - 0.0075, z0 - 0.0027), new THREE.Vector3(x0, y0 + 0.000, z0 - 0.0024),
    new THREE.Vector3(x0, y0 + 0.0045, z0 - 0.0002), new THREE.Vector3(x0, y0 + 0.0058, z0 + 0.0028),
    new THREE.Vector3(x0, y0 + 0.0035, z0 + 0.0052), new THREE.Vector3(x0, y0 - 0.002, z0 + 0.0050),
    new THREE.Vector3(x0, y0 - 0.009, z0 + 0.0056)]);
  const NS = 28, RS = 10, hw = 0.0045, ht = 0.0009, pos = [], nrm = [], uv = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, p = curve.getPoint(t), tg = curve.getTangent(t);
    const side = new THREE.Vector3(1, 0, 0), nn = new THREE.Vector3().crossVectors(tg, side).normalize();
    for (let k = 0; k < RS; k++) {
      const a = k / RS * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const sx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.35), sy = Math.sign(sa) * Math.pow(Math.abs(sa), 0.35);
      pos.push(p.x + side.x * sx * hw, p.y + nn.y * sy * ht, p.z + nn.z * sy * ht);
      const q = new THREE.Vector3().addScaledVector(side, ca / hw).addScaledVector(nn, sa / ht).normalize();
      nrm.push(q.x, q.y, q.z); uv.push(t * 2, k / RS);
    }
  }
  const idx = [];
  for (let i = 0; i < NS; i++) for (let k = 0; k < RS; k++) { const k1 = (k + 1) % RS; const a = i * RS + k, b = (i + 1) * RS + k, c = (i + 1) * RS + k1, d = i * RS + k1; idx.push(a, b, d, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); fixWinding(g);
  return g;
}

function mirrorGeo(g) {
  const m = g.clone();
  const p = m.attributes.position.array; for (let i = 0; i < p.length; i += 3) p[i] = -p[i];
  if (m.attributes.normal) { const n = m.attributes.normal.array; for (let i = 0; i < n.length; i += 3) n[i] = -n[i]; }
  const ix = m.index.array; for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
  return m;
}

// ---------------------------------------------------------------- procedural textures
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, per, seed) { // tileable value noise, x,y in lattice units
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % per) + per) % per;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed), c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(u, v, per0, oct, seed) { let s = 0, w = 0.5, t = 0, p = per0; for (let o = 0; o < oct; o++) { s += w * vnoise(u * p, v * p, p, seed + o * 17); t += w; w *= 0.5; p *= 2; } return s / t; }

let TEX = null;
function buildTextures() {
  if (TEX) return TEX;
  // mud pattern: R crust mottling, G sand specks, B reveal threshold, A fine mottling
  const MS = 256, md = new Uint8Array(MS * MS * 4);
  for (let y = 0; y < MS; y++) for (let x = 0; x < MS; x++) {
    const u = x / MS, v = y / MS, o = (y * MS + x) * 4;
    const warp = fbm(u, v, 3, 3, 91) - 0.5;
    let r = fbm(u + warp * 0.08, v - warp * 0.07, 7, 5, 7); r = Math.min(1, Math.max(0, (r - 0.5) * 1.9 + 0.5));
    // fine cracks in dried crust
    const cr = Math.abs(fbm(u, v, 10, 3, 33) - 0.5); const crack = (cr < 0.009 && r > 0.5) ? 1 : 0;
    let g = 0; const hh = hash2(x, y, 5); if (hh > 0.985) g = 0.55 + 0.45 * hash2(x, y, 6); else if (hh > 0.965) g = 0.22;
    const b = fbm(u, v, 9, 4, 51);
    const a = fbm(u, v, 24, 3, 71);
    md[o] = (crack ? r * 0.6 : r) * 255; md[o + 1] = g * 255; md[o + 2] = Math.min(1, Math.max(0, (b - 0.5) * 1.9 + 0.5)) * 255; md[o + 3] = a * 255;
  }
  const mud = new THREE.DataTexture(md, MS, MS, THREE.RGBAFormat);
  mud.wrapS = mud.wrapT = THREE.RepeatWrapping; mud.magFilter = THREE.LinearFilter; mud.minFilter = THREE.LinearMipmapLinearFilter; mud.generateMipmaps = true; mud.needsUpdate = true;

  // canvas weave normal map (plain weave + slubs)
  const WS = 128, hgt = new Float32Array(WS * WS);
  for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) {
    const cx = (x % 4) / 4, cy = (y % 4) / 4, tx = Math.floor(x / 4), ty = Math.floor(y / 4);
    const over = ((tx + ty) & 1) ? 1 : 0;
    const warp = Math.sin(cx * Math.PI), weft = Math.sin(cy * Math.PI);
    let h = over ? warp * 0.7 + weft * 0.3 : weft * 0.7 + warp * 0.3;
    h += (fbm(x / WS, y / WS, 8, 3, 13) - 0.5) * 1.2 + (vnoise(x / WS * 64, y / 4, 64, 3) - 0.5) * 0.3;
    hgt[y * WS + x] = h;
  }
  const wn = normalFromHeight(hgt, WS, 1.2);
  const weave = new THREE.DataTexture(wn, WS, WS, THREE.RGBAFormat);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.minFilter = THREE.LinearMipmapLinearFilter; weave.magFilter = THREE.LinearFilter; weave.generateMipmaps = true; weave.needsUpdate = true;

  // tread: grooves across the sole (covers 0.1 m per tile), plus heel diamond hint
  const TS = 256, th = new Float32Array(TS * TS), tc = new Uint8Array(TS * TS * 4);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const u = x / TS, v = y / TS;
    const f = (v * 26 + 0.22 * Math.sin(u * Math.PI * 2 * 3)) % 1;
    const groove = smooth(0.0, 0.12, f) * smooth(0.5, 0.38, f);
    const h = 1 - groove;
    th[y * TS + x] = h;
    const n = fbm(u, v, 8, 3, 29);
    const o = (y * TS + x) * 4; tc[o] = groove * 255; tc[o + 1] = n * 255; tc[o + 2] = 0; tc[o + 3] = 255;
  }
  const tread = new THREE.DataTexture(normalFromHeight(th, TS, 2.5), TS, TS, THREE.RGBAFormat);
  tread.wrapS = tread.wrapT = THREE.RepeatWrapping; tread.minFilter = THREE.LinearMipmapLinearFilter; tread.magFilter = THREE.LinearFilter; tread.generateMipmaps = true; tread.needsUpdate = true;
  const treadAux = new THREE.DataTexture(tc, TS, TS, THREE.RGBAFormat);
  treadAux.wrapS = treadAux.wrapT = THREE.RepeatWrapping; treadAux.minFilter = THREE.LinearMipmapLinearFilter; treadAux.magFilter = THREE.LinearFilter; treadAux.generateMipmaps = true; treadAux.needsUpdate = true;

  TEX = { mud, weave, tread, treadAux, markL: drawMark('L'), markR: drawMark('R') };
  return TEX;
}
function normalFromHeight(h, S, k) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S];
    const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    let nx = -hx * k * 0.5, ny = -hy * k * 0.5, nz = 1; const l = Math.hypot(nx, ny, nz);
    const o = (y * S + x) * 4; out[o] = (nx / l * 0.5 + 0.5) * 255; out[o + 1] = (ny / l * 0.5 + 0.5) * 255; out[o + 2] = (nz / l * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  return out;
}

// felt-pen marks (canvas, sRGB): L = strawberry, R = star
function drawMark(side) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.lineJoin = g.lineCap = 'round';
  let seed = side === 'L' ? 3 : 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const wob = (pts, amp) => pts.map(([x, y], i) => [x + Math.sin(i * 1.7 + seed) * amp + (rnd() - 0.5) * amp, y + Math.cos(i * 2.3 + seed) * amp + (rnd() - 0.5) * amp]);
  const path = (pts, close) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); if (close) g.closePath(); };
  const marker = (pts, col, w, fill, fillCol) => {
    if (fill) { // scribbly fill
      g.save(); path(pts, true); g.clip();
      g.strokeStyle = fillCol; g.lineWidth = 7; g.globalAlpha = 0.88;
      for (let y = -10; y < S + 10; y += 5) { g.beginPath(); g.moveTo(0, y + rnd() * 2); g.lineTo(S, y + 26 + rnd() * 3); g.stroke(); }
      g.restore();
    }
    g.globalAlpha = 0.95; g.strokeStyle = col; g.lineWidth = w; path(pts, true); g.stroke(); g.globalAlpha = 1;
  };
  if (side === 'L') {
    const body = [];
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2; const ca = Math.cos(a), sa = Math.sin(a);
      // strawberry: wide top, pointed bottom
      const r = 40 * (1 - 0.18 * sa) ; const x = 64 + ca * r * (0.95 - 0.35 * Math.max(0, sa)), y = 62 + sa * r * 1.0 + (sa > 0 ? sa * sa * 10 : 0);
      body.push([x, y]);
    }
    marker(wob(body, 1.6), '#c8262a', 5.5, true, '#e3383a');
    // seeds
    g.fillStyle = '#f6e27a';
    for (let i = 0; i < 11; i++) { const x = 40 + (i * 37 % 48), y = 48 + ((i * 53) % 44); g.beginPath(); g.ellipse(x + rnd() * 3, y + rnd() * 3, 2.2, 3.2, 0.3, 0, Math.PI * 2); g.fill(); }
    // leaves
    const leaf = [];
    for (let i = 0; i < 10; i++) { const a = Math.PI + i / 9 * Math.PI; const r = i % 2 ? 9 : 22; leaf.push([64 + Math.cos(a) * r * 1.15, 30 + Math.sin(a) * r * 0.45 + 6]); }
    marker(wob(leaf, 1.2), '#257a33', 4.5, true, '#36a046');
    g.strokeStyle = '#257a33'; g.lineWidth = 4.5; g.beginPath(); g.moveTo(64, 28); g.quadraticCurveTo(66, 16, 72, 10); g.stroke();
  } else {
    const st = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i / 10 * Math.PI * 2; const r = i % 2 ? 23 : 54; st.push([64 + Math.cos(a) * r, 68 + Math.sin(a) * r]); }
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = st[i], b = st[(i + 1) % 10]; for (let k = 0; k < 4; k++) pts.push([a[0] + (b[0] - a[0]) * k / 4, a[1] + (b[1] - a[1]) * k / 4]); }
    marker(wob(pts, 1.4), '#ec7a1c', 6, true, '#ffd23a');
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- material patch
const GLSL_HEAD = /* glsl */`
uniform sampler2D uDirt; uniform sampler2D uMud; uniform sampler2D uMark; uniform sampler2D uAux;
uniform float uAvg, uWet, uShine;
uniform vec3 uCapCol;
uniform vec4 uCap;   // z0, k, xc
uniform vec4 uMarkP; // cx, cz, size
uniform vec4 uBox;   // X0, Z0, 1/(X1-X0), 1/(Z1-Z0)
varying vec3 vLP; varying vec3 vLN; varying vec2 vRim;
`;
const GLSL_ALBEDO = /* glsl */`
vec3 lp = vLP; vec3 ln = normalize(vLN);
float myH = 0.0; vec3 myEmis = vec3(0.0); float myRough = 0.9;
vec3 white = vec3(0.86, 0.846, 0.80);
vec3 canvasC = white * mix(vec3(1.0), vec3(0.74, 0.78, 0.84), uWet);
canvasC = mix(canvasC, vec3(0.905, 0.90, 0.88), uShine * (1.0 - uWet));
float canvasR = mix(0.9, 0.52, uWet);
vec3 clean = canvasC; float cleanR = canvasR; float capM = 0.0; float sideW = smoothstep(0.75, 0.2, abs(ln.y));
#if defined(PART_UPPER) || defined(PART_INNER)
  float rd = vRim.x; float fw = fwidth(rd) + 0.00008;
  float bindM = 1.0 - smoothstep(0.0040, 0.0040 + fw, rd);
  float st = 1.0 - smoothstep(0.00022, 0.00022 + fw, abs(rd - 0.0027));
  float ph = fract(vRim.y / 0.0025); st *= smoothstep(0.08, 0.22, ph) * smoothstep(0.78, 0.64, ph);
  clean = mix(clean, clean * 1.03, bindM);
  myH += bindM * 0.00022 - st * 0.00018;
  clean *= 1.0 - st * 0.16;
  #ifdef PART_INNER
    clean *= vec3(0.93, 0.925, 0.91);
  #endif
#endif
#ifdef PART_UPPER
  float ze = uCap.x + uCap.y * (lp.x - uCap.z) * (lp.x - uCap.z);
  float fz = fwidth(lp.z) + 0.00012;
  capM = smoothstep(ze + fz, ze - fz, lp.z);
  // stitch line on canvas just behind the cap edge
  float ce = abs(lp.z - (ze + 0.0021)); float fc = fwidth(lp.z) + 0.00008;
  float cph = fract((lp.x + lp.y * 0.8) / 0.0025);
  float cst = (1.0 - smoothstep(0.00022, 0.00022 + fc, ce)) * smoothstep(0.08, 0.22, cph) * smoothstep(0.78, 0.64, cph) * (1.0 - bindM);
  clean *= 1.0 - cst * 0.16; myH -= cst * 0.00018;
  // felt-pen mark (planar from above)
  vec2 muv = vec2((lp.x - uMarkP.x) / uMarkP.z + 0.5, 0.5 - (lp.z - uMarkP.y) / uMarkP.z);
  if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) {
    vec4 mk = texture2D(uMark, muv);
    float ma = mk.a * smoothstep(0.35, 0.6, ln.y) * (1.0 - capM);
    clean = mix(clean, mk.rgb * mix(1.0, 0.8, uWet), ma);
    cleanR = mix(cleanR, cleanR * 0.85, ma);
  }
  vec3 rub = uCapCol * mix(1.0, 0.9, uWet);
  clean = mix(clean, rub, capM);
  cleanR = mix(cleanR, mix(0.34, 0.12, uWet), capM);
  myH += capM * 0.0004;
  myEmis = canvasC * vec3(1.0, 0.96, 0.88) * 0.075 * uShine * (1.0 - capM);
#endif
#ifdef PART_BAND
  float rib = sin(lp.z * 6.2831 / 0.0016);
  float rf = 1.0 - smoothstep(0.0003, 0.0009, fwidth(lp.z));
  clean = canvasC * vec3(0.985, 0.985, 0.975) * (1.0 - 0.10 * rf * (0.5 - 0.5 * rib));
  cleanR = mix(0.62, 0.42, uWet);
  myH += rib * 0.00016 * rf;
  myEmis = canvasC * vec3(1.0, 0.96, 0.88) * 0.06 * uShine;
#endif
#ifdef PART_BIND
  clean = canvasC * 1.02; cleanR = mix(0.8, 0.5, uWet);
  myEmis = canvasC * vec3(1.0, 0.96, 0.88) * 0.06 * uShine;
#endif
#ifdef PART_INSOLE
  clean = vec3(0.56, 0.53, 0.46) * mix(vec3(1.0), vec3(0.72, 0.74, 0.76), uWet);
  cleanR = mix(0.85, 0.5, uWet);
  sideW = 0.0;
#endif
#ifdef PART_SOLE
  vec3 rubW = vec3(0.80, 0.775, 0.71) * mix(1.0, 0.92, uWet);
  float ly = smoothstep(0.0083, 0.0086, lp.y) * smoothstep(0.0099, 0.0096, lp.y) * smoothstep(0.8, 0.5, abs(ln.y));
  clean = mix(rubW, uCapCol, ly);
  cleanR = mix(0.5, 0.2, uWet);
  sideW = 1.0;
#endif
#ifdef PART_TREAD
  vec4 ta = texture2D(uAux, vMapUv);
  clean = vec3(0.68, 0.66, 0.60) * (1.0 - ta.r * 0.25);
  float grime = 0.35 + 0.65 * uAvg;
  clean = mix(clean, vec3(0.16, 0.13, 0.10), clamp(ta.r * 0.9 * grime + (ta.g - 0.3) * 0.5 * grime, 0.0, 1.0));
  cleanR = mix(0.75, 0.4, uWet);
  sideW = 1.0;
#endif
// ---- dirt
vec2 duv = vec2((lp.x - uBox.x) * uBox.z, (lp.z - uBox.y) * uBox.w);
float dAmt = texture2D(uDirt, duv).r;
dAmt = mix(dAmt, min(dAmt, uAvg * 1.15 + 0.03), sideW);
vec4 mudT = texture2D(uMud, lp.xz * 9.0);
vec4 mudS = texture2D(uMud, vec2(lp.x + lp.z, lp.y * 1.4) * 9.0 + 0.37);
vec4 mud = mix(mudS, mudT, smoothstep(0.25, 0.75, abs(ln.y)));
float thr = mud.b;
// thick crust patches (break up last) + a translucent smeared film (fades gradually)
float dA = smoothstep(thr * 0.5 + 0.33, thr * 0.5 + 0.5, dAmt);
float film = smoothstep(0.0, 0.85, dAmt) * 0.88;
float crust = smoothstep(0.42, 0.82, mud.r);
vec3 mc = mix(vec3(0.024, 0.017, 0.011), vec3(0.085, 0.070, 0.052), crust);
mc *= 0.75 + 0.5 * mud.a;
mc = mix(mc, vec3(0.28, 0.225, 0.155), mud.g * (0.35 + 0.65 * crust));
float mr = mix(0.6, 0.97, crust); mr = mix(mr, mr * 0.5, uWet);
vec3 filmC = mix(vec3(0.22, 0.19, 0.15), vec3(0.05, 0.038, 0.028), smoothstep(0.15, 0.8, dAmt)) * (0.8 + 0.4 * mud.a);
clean = mix(clean, filmC, film);
cleanR = mix(cleanR, max(cleanR, 0.8), film);
vec3 alb = mix(clean, mc, dA);
myRough = mix(cleanR, mr, dA);
myH += dA * (crust * 0.00045 + mud.g * 0.00012);
myEmis *= (1.0 - dA) * (1.0 - film);
diffuseColor.rgb = alb;
`;
const GLSL_BUMP = /* glsl */`
{
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float hx = dFdx(myH), hy = dFdy(myH);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;

function makeMat(part, U, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: opts.side || THREE.FrontSide });
  if (opts.normalMap) { m.normalMap = opts.normalMap; m.normalScale = new THREE.Vector2(opts.ns || 0.3, opts.ns || 0.3); }
  m.defines = { ['PART_' + part]: '' };
  if (part === 'TREAD') m.map = TEX.treadAux; // forces vUv
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN; varying vec2 vRim;\n#ifdef HAS_RIM\nattribute vec2 aRim;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal;\n#ifdef HAS_RIM\nvRim = aRim;\n#else\nvRim = vec2(1.0);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_HEAD)
      .replace('#include <map_fragment>', GLSL_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = myRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GLSL_BUMP)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += myEmis;');
  };
  if (opts.rim) m.defines.HAS_RIM = '';
  m.customProgramCacheKey = () => 'uwabaki_' + part + (opts.rim ? 'r' : '');
  return m;
}

// ---------------------------------------------------------------- per-side shared geometry cache
const GEO = {};
function getGeometry(side, low) {
  const key = side + (low ? 'l' : 'h');
  if (GEO[key]) return GEO[key];
  const S = buildShape();
  const baseKey = 'R' + (low ? 'l' : 'h');
  if (!GEO[baseKey]) {
    const up = buildUpper(S, low), so = buildSole(S, low);
    const g = { outer: up.outer, inner: up.inner, bind: up.bind, sole: so.side, tread: so.bottom, soleTop: so.top,
      insole: buildInsole(S), band: buildBand(S, low), tab: buildTab(S) };
    // height map for surfaceY
    g.hm = buildHeightMap(S, g);
    GEO[baseKey] = g;
  }
  if (side === 'R') return GEO[baseKey];
  const R = GEO[baseKey], L = {};
  for (const k of Object.keys(R)) if (R[k].isBufferGeometry) L[k] = mirrorGeo(R[k]);
  // mirror height map in x
  const hm = new Float32Array(GX * GZ);
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) hm[iz * GX + ix] = R.hm[iz * GX + (GX - 1 - ix)];
  L.hm = hm;
  GEO[key] = L;
  return L;
}
function buildHeightMap(S, g) {
  const hm = new Float32Array(GX * GZ).fill(-1);
  const rast = (geo) => {
    const p = geo.attributes.position.array;
    for (let k = 0; k < p.length; k += 3) {
      const ix = Math.floor((p[k] - X0) / DX), iz = Math.floor((p[k + 2] - Z0) / DZ);
      if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ) continue;
      const o = iz * GX + ix; if (p[k + 1] > hm[o]) hm[o] = p[k + 1];
    }
  };
  rast(g.outer);
  const band = new Float32Array(GX * GZ).fill(-1);
  { const p = g.band.attributes.position.array; for (let k = 0; k < p.length; k += 3) { const ix = Math.floor((p[k] - X0) / DX), iz = Math.floor((p[k + 2] - Z0) / DZ); if (ix >= 0 && iz >= 0 && ix < GX && iz < GZ) band[iz * GX + ix] = Math.max(band[iz * GX + ix], p[k + 1]); } }
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
    const x = X0 + (ix + 0.5) * DX, z = Z0 + (iz + 0.5) * DZ, o = iz * GX + ix;
    if (!insidePoly(S.sole, x, z)) { hm[o] = SOLE_T; continue; }
    if (insidePoly(S.rim, x, z)) hm[o] = band[o] > 0 ? band[o] : INSOLE_Y + 0.001;
  }
  for (let pass = 0; pass < 4; pass++) for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
    const o = iz * GX + ix; if (hm[o] >= 0) continue;
    let m = -1; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const jx = ix + dx, jz = iz + dz; if (jx >= 0 && jz >= 0 && jx < GX && jz < GZ) m = Math.max(m, hm[jz * GX + jx]); }
    if (m >= 0) hm[o] = m;
  }
  for (let o = 0; o < hm.length; o++) if (hm[o] < 0) hm[o] = SOLE_T;
  return hm;
}

let WEIGHT = null; // per-cell weight: inside the top silhouette
function getWeights() {
  if (WEIGHT) return WEIGHT;
  const S = buildShape(); const wR = new Float32Array(GX * GZ); let sum = 0;
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
    let c = 0; // 2x2 supersample
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if (insidePoly(S.sole, X0 + (ix + 0.25 + a * 0.5) * DX, Z0 + (iz + 0.25 + b * 0.5) * DZ)) c++;
    wR[iz * GX + ix] = c / 4; sum += c / 4;
  }
  const wL = new Float32Array(GX * GZ);
  for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) wL[iz * GX + ix] = wR[iz * GX + (GX - 1 - ix)];
  WEIGHT = { R: wR, L: wL, sum };
  return WEIGHT;
}

// ---------------------------------------------------------------- factory
export function createShoe(ctx, { side = 'R' } = {}) {
  const low = !!(ctx && ctx.quality && ctx.quality.low);
  const S = buildShape(); buildTextures();
  const G = getGeometry(side, low);
  const sg = side === 'L' ? -1 : 1;
  const W = getWeights()[side], WSUM = getWeights().sum;

  const dirt = new Float32Array(GX * GZ).fill(1);
  const dData = new Uint8Array(GX * GZ).fill(255);
  const dTex = new THREE.DataTexture(dData, GX, GZ, THREE.RedFormat, THREE.UnsignedByteType);
  dTex.magFilter = dTex.minFilter = THREE.LinearFilter; dTex.wrapS = dTex.wrapT = THREE.ClampToEdgeWrapping; dTex.needsUpdate = true;
  let texDirty = false, left = 1;

  const U = {
    uDirt: { value: dTex }, uMud: { value: TEX.mud }, uMark: { value: side === 'L' ? TEX.markL : TEX.markR }, uAux: { value: TEX.treadAux },
    uAvg: { value: 1 }, uWet: { value: 0 }, uShine: { value: 0 },
    uCapCol: { value: CAP_RED.clone().convertSRGBToLinear() },
    uCap: { value: new THREE.Vector4(S.CAP.z0, S.CAP.k, sg * S.CAP.xc, 0) },
    uMarkP: { value: new THREE.Vector4(sg * S.MARK.x, S.MARK.z, S.MARK.size, 0) },
    uBox: { value: new THREE.Vector4(X0, Z0, 1 / (X1 - X0), 1 / (Z1 - Z0)) },
  };
  // the CanvasTexture colour space conversion: three decodes sRGB textures itself, nothing to do here
  const T = TEX;
  const mats = {
    outer: makeMat('UPPER', U, { normalMap: T.weave, ns: 0.28, rim: true }),
    inner: makeMat('INNER', U, { normalMap: T.weave, ns: 0.25, rim: true }),
    bind: makeMat('BIND', U, { normalMap: T.weave, ns: 0.2 }),
    band: makeMat('BAND', U, { side: THREE.DoubleSide }),
    tab: makeMat('BIND', U, { normalMap: T.weave, ns: 0.2 }),
    insole: makeMat('INSOLE', U, { normalMap: T.weave, ns: 0.2 }),
    sole: makeMat('SOLE', U),
    soleTop: makeMat('SOLE', U),
    tread: makeMat('TREAD', U, { normalMap: T.tread, ns: 0.9 }),
  };
  const group = new THREE.Group(); group.name = 'shoe' + side;
  const add = (geo, mat, cast, recv) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; group.add(m); return m; };
  add(G.outer, mats.outer, true, true);
  add(G.inner, mats.inner, false, true);
  add(G.bind, mats.bind, true, true);
  add(G.band, mats.band, true, true);
  add(G.tab, mats.tab, true, true);
  add(G.insole, mats.insole, false, true);
  add(G.sole, mats.sole, true, true);
  add(G.soleTop, mats.soleTop, false, true);
  add(G.tread, mats.tread, true, true);

  const recompute = () => { let s = 0; for (let k = 0; k < dirt.length; k++) s += dirt[k] * W[k]; left = s / WSUM; U.uAvg.value = left; texDirty = true; };
  const fill = (v) => { dirt.fill(v); recompute(); };

  const api = {
    group, side, LENGTH, WIDTH, HEIGHT: COLLAR_H,
    setDirtFull() { fill(1); },
    cleanAll() { fill(0); },
    scrubAt(x, z, radius, strength) {
      const r = Math.max(0.002, radius), st = Math.min(1, Math.max(0, strength));
      if (st <= 0) return 0;
      const ix0 = Math.max(0, Math.floor((x - r - X0) / DX)), ix1 = Math.min(GX - 1, Math.floor((x + r - X0) / DX));
      const iz0 = Math.max(0, Math.floor((z - r - Z0) / DZ)), iz1 = Math.min(GZ - 1, Math.floor((z + r - Z0) / DZ));
      let rem = 0, any = false; const r2 = r * r;
      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = Z0 + (iz + 0.5) * DZ - z;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = X0 + (ix + 0.5) * DX - x, d2 = (cx * cx + cz * cz) / r2;
          if (d2 >= 1) continue;
          const o = iz * GX + ix, d = dirt[o]; if (d <= 0) continue;
          const f = (1 - d2) * (1 - d2);
          // crusty dirt resists a little more at first
          const take = Math.min(d, st * f * (0.035 + 0.035 * (1 - d)));
          dirt[o] = d - take; rem += take * W[o]; any = true;
        }
      }
      if (any) { left = Math.max(0, left - rem / WSUM); U.uAvg.value = left; texDirty = true; }
      return rem / WSUM;
    },
    dirtLeft() { return left; },
    dirtiestPoint(out) {
      let best = -1, bi = -1, mx = 0;
      for (let iz = 0; iz < GZ; iz++) for (let ix = 0; ix < GX; ix++) {
        const o = iz * GX + ix; if (W[o] < 0.5) continue;
        if (dirt[o] > mx) mx = dirt[o];
        let s = 0;
        for (let dz = -3; dz <= 3; dz++) { const jz = iz + dz; if (jz < 0 || jz >= GZ) continue; for (let dx = -3; dx <= 3; dx++) { const jx = ix + dx; if (jx < 0 || jx >= GX) continue; s += dirt[jz * GX + jx] * W[jz * GX + jx]; } }
        if (s > best) { best = s; bi = o; }
      }
      if (mx < 0.04 || bi < 0) return null;
      const x = X0 + ((bi % GX) + 0.5) * DX, z = Z0 + (Math.floor(bi / GX) + 0.5) * DZ;
      return (out || new THREE.Vector3()).set(x, api.surfaceY(x, z), z);
    },
    surfaceY(x, z) {
      const fx = (x - X0) / DX - 0.5, fz = (z - Z0) / DZ - 0.5;
      if (fx < -0.5 || fz < -0.5 || fx > GX - 0.5 || fz > GZ - 0.5) return SOLE_T;
      const ix = Math.max(0, Math.min(GX - 2, Math.floor(fx))), iz = Math.max(0, Math.min(GZ - 2, Math.floor(fz)));
      const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz)), h = G.hm;
      const a = h[iz * GX + ix], b = h[iz * GX + ix + 1], c = h[(iz + 1) * GX + ix], d = h[(iz + 1) * GX + ix + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    },
    setWet(w) { U.uWet.value = Math.min(1, Math.max(0, w)); },
    setShine(s) { U.uShine.value = Math.min(1, Math.max(0, s)); },
    serialize() {
      // 4-bit quantised, two cells per byte, base64
      const b = new Uint8Array(GX * GZ / 2);
      for (let k = 0; k < b.length; k++) b[k] = (Math.round(dirt[2 * k] * 15) << 4) | Math.round(dirt[2 * k + 1] * 15);
      let s = ''; for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]);
      return 'u1' + btoa(s);
    },
    deserialize(str) {
      try {
        if (typeof str !== 'string' || str.slice(0, 2) !== 'u1') throw 0;
        const s = atob(str.slice(2)); if (s.length !== GX * GZ / 2) throw 0;
        for (let k = 0; k < s.length; k++) { const v = s.charCodeAt(k); dirt[2 * k] = (v >> 4) / 15; dirt[2 * k + 1] = (v & 15) / 15; }
        recompute();
      } catch (e) { api.setDirtFull(); }
    },
    update() {
      if (texDirty) {
        for (let k = 0; k < dirt.length; k++) dData[k] = dirt[k] * 255 + 0.5;
        dTex.needsUpdate = true; texDirty = false;
      }
    },
  };
  // grid stored in the shoe's own (unmirrored) local frame, so L/R both use true local x
  api.setDirtFull();
  api.update(0);
  return api;
}
