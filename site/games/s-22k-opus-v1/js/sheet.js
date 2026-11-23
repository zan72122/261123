/* sheet.js — dough on the rolling board as a thickness field: rolling pin moves
   thickness forward, folding stacks a mirrored layer, the knife cuts strips that
   become noodles carrying width, thickness, length and fold. */
(function () {
  'use strict';
  const U = window.U;
  const S = (U.sheet = {});
  const L = U.L, Bd = L.board;
  const CS = 0.04;
  const NX = Math.ceil(Bd.w / CS), NZ = Math.ceil(Bd.d / CS);
  const X0 = Bd.x0, Z0 = Bd.z0, TOP = Bd.top;
  const EPS = 0.004, HMIN = 0.045, C0 = 0.007;
  const ZMIN = -0.3, ZMAX = 1.5;
  const J0 = Math.ceil((ZMIN - Z0) / CS), J1 = Math.floor((ZMAX - Z0) / CS);
  const I0 = 2, I1 = NX - 3;
  const PIN_LEN = 1.25, PIN_R = 0.085;
  const N = NX * NZ;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  S.h0 = new Float32Array(N);
  S.h1 = new Float32Array(N);
  S.hF = new Float32Array(N);
  const recent = new Float32Array(N);
  const tmpA = new Float32Array(N), tmpB = new Float32Array(N);
  S.st = { has: false, folded: false, cuts: 0, cutX: Infinity, zf: 0, jf: 0, fold: null, rolled: 0, spread: 0 };
  const idx = (i, j) => j * NX + i;
  const cx = (i) => X0 + (i + 0.5) * CS;
  const cz = (j) => Z0 + (j + 0.5) * CS;
  S.cellAt = (x, z) => {
    const i = Math.floor((x - X0) / CS), j = Math.floor((z - Z0) / CS);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
    return idx(i, j);
  };
  S.thickAt = (x, z) => {
    const c = S.cellAt(x, z);
    return c < 0 ? 0 : S.h0[c] + S.h1[c];
  };
  S.volume = function () {
    let s = 0;
    for (let c = 0; c < N; c++) s += S.h0[c] + S.h1[c];
    return s * CS * CS;
  };
  S.bounds = function () {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const c = idx(i, j);
        if (S.h0[c] + S.h1[c] > EPS) {
          n++;
          x0 = Math.min(x0, cx(i)); x1 = Math.max(x1, cx(i));
          z0 = Math.min(z0, cz(j)); z1 = Math.max(z1, cz(j));
        }
      }
    if (!n) return null;
    if (S.st.cutX < x1) x1 = S.st.cutX;
    return { x0, x1, z0, z1, n };
  };

  // the real front / back edge of the dough along a line x (ignores stray crumbs)
  S.edgesAt = function (x) {
    const i = U.clamp(Math.floor((x - X0) / CS), 0, NX - 1);
    let zb = null, zf = null, run = 0;
    for (let j = 0; j < NZ; j++) {
      const h = S.h0[idx(i, j)] + S.h1[idx(i, j)];
      run = h > 0.02 ? run + 1 : 0;
      if (run >= 2) { if (zb === null) zb = cz(j - 1); zf = cz(j); }
    }
    return zb === null ? null : { z0: zb, z1: zf };
  };
  // ---------------- meshes ----------------
  function makeGridMesh(nv, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(Math.max(6, (NX - 1) * (NZ - 1) * 12)), 1));
    geo.setDrawRange(0, 0);
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  S.init = function (scene) {
    const kit = U.kit;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, side: THREE.DoubleSide });
    S.mat = mat;
    S.m0 = makeGridMesh(N, mat);
    S.m1 = makeGridMesh(N, mat);
    S.flap = makeGridMesh(N * 2, mat);
    S.roll = makeGridMesh(NX * 10, mat);
    scene.add(S.m0, S.m1, S.flap, S.roll);
    // pin
    S.pin = kit.buildPin(PIN_LEN, PIN_R);
    S.pinSt = { mode: 'rest', x: L.pinRest.x, z: L.pinRest.z, y: TOP + 0.06 + PIN_R, tx: 0, tz: 0, lastRow: -1, level: 0, speed: 0 };
    S.pin.position.set(L.pinRest.x, S.pinSt.y, L.pinRest.z);
    scene.add(S.pin);
    // knife
    S.knife = kit.buildKnife();
    S.kn = { mode: 'rest', x: L.knifeRestX, lift: 0.22, held: false, x0: 0, f0: 0 };
    S.knife.position.set(S.kn.x, TOP + S.kn.lift, Bd.z1 - 0.07);
    scene.add(S.knife);
    S.pokes = [];
    S.dent = null;
    setupPicks();
    U.core.addUpdate(S.update, 12);
    S.dirty = true;
  };

  // smoothed copy of a field; mask(i,j) -> keep
  function blur(src, dst, mask) {
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        let s = 0, w = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
            const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
            const c = idx(ii, jj);
            const v = mask && !mask(ii, jj) ? 0 : src[c];
            s += v * k;
            w += k;
          }
        const c = idx(i, j);
        const own = mask && !mask(i, j) ? 0 : src[c];
        dst[c] = own > EPS ? Math.max(s / w, own * 0.75) : s / w * 0.9;
      }
  }

  // lay out a field: snapped xz, heights, inside flags, triangle list
  const LX = new Float32Array(N), LZ = new Float32Array(N), LH = new Float32Array(N), LS = new Uint8Array(N);
  function layout(hs, cutX) {
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const c = idx(i, j);
        LX[c] = cx(i);
        LZ[c] = cz(j);
        LH[c] = hs[c];
        LS[c] = hs[c] > C0 ? 1 : 0;
      }
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const c = idx(i, j);
        if (LS[c]) continue;
        let sx = 0, sz = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
            const nb = idx(ii, jj);
            if (LS[nb] !== 1) continue;
            const hn = hs[nb] - C0, hv = hs[c] - C0;
            const t = U.clamp(hn / Math.max(1e-6, hn - hv), 0, 1);
            sx += cx(ii) + (cx(i) - cx(ii)) * t;
            sz += cz(jj) + (cz(j) - cz(jj)) * t;
            n++;
          }
        if (n) {
          LX[c] = sx / n;
          LZ[c] = sz / n;
          LS[c] = 2;
          LH[c] = 0;
        }
      }
    if (cutX < Infinity) {
      for (let c = 0; c < N; c++) if (LX[c] > cutX - 0.003) LX[c] = cutX - 0.003;
    }
  }
  function writeIndex(mesh, offset, accept) {
    const ia = mesh.geometry.index.array;
    let k = 0;
    for (let j = 0; j < NZ - 1; j++)
      for (let i = 0; i < NX - 1; i++) {
        const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
        if (!(LS[a] === 1 || LS[b] === 1 || LS[c] === 1 || LS[d] === 1)) continue;
        if (!LS[a] || !LS[b] || !LS[c] || !LS[d]) continue;
        if (accept && !accept(i, j)) continue;
        const o = offset || 0;
        if (k + 6 > ia.length) break;
        ia[k++] = a + o; ia[k++] = c + o; ia[k++] = b + o;
        ia[k++] = b + o; ia[k++] = c + o; ia[k++] = d + o;
      }
    mesh.geometry.setDrawRange(0, k);
    mesh.geometry.index.needsUpdate = true;
    return k;
  }

  function dispOffset(x, z) {
    let d = 0;
    for (const p of S.pokes) {
      const r = Math.hypot(x - p.x, z - p.z);
      const s = p.s;
      d += -p.a * Math.exp(-(r * r) / (s * s)) + p.a * 0.35 * Math.exp(-((r - s * 1.5) * (r - s * 1.5)) / (s * s * 0.5));
    }
    if (S.dent) {
      const dx = Math.abs(x - S.dent.x);
      const a = S.dent.a;
      d += dx < 0.03 ? -a : dx < 0.09 ? a * 0.25 * (1 - (dx - 0.03) / 0.06) : 0;
      S.dentScale = 1;
    }
    return d;
  }

  function fillLayer(mesh, hs, base, dusted, maskFn) {
    const pa = mesh.geometry.attributes.position.array, ca = mesh.geometry.attributes.color.array;
    layout(hs, S.st.cutX);
    for (let c = 0; c < N; c++) {
      const b = base ? base[c] : 0;
      let y;
      if (LS[c] === 1) {
        const off = dispOffset(LX[c], LZ[c]);
        const hh = Math.max(0.004, LH[c] + off * Math.min(1, LH[c] / 0.05));
        y = TOP + b + hh;
      } else if (LS[c] === 2) y = TOP + b + 0.0015;
      else y = TOP - 0.03;
      pa[c * 3] = LX[c];
      pa[c * 3 + 1] = y;
      pa[c * 3 + 2] = LZ[c];
      const n = U.hash2(c, 17) * 0.025;
      const th = U.clamp(LH[c] / 0.3, 0, 1);
      const dust = dusted ? 0.025 : 0;
      ca[c * 3] = 0.93 + dust - n + th * 0.02;
      ca[c * 3 + 1] = 0.9 + dust - n + th * 0.02;
      ca[c * 3 + 2] = 0.8 + dust * 1.6 - n * 1.2 + th * 0.03;
    }
    writeIndex(mesh, 0, maskFn);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  const hs0 = new Float32Array(N), hs1 = new Float32Array(N), hsF = new Float32Array(N), base1 = new Float32Array(N);
  function rebuild() {
    const st = S.st;
    const fd = st.fold;
    if (fd) {
      const jcut = Math.round((fd.zf - Z0) / CS);
      blur(S.h0, hs0, (i, j) => j < jcut);
      fillLayer(S.m0, hs0, null, false);
      buildFlap(fd, jcut);
      S.m1.geometry.setDrawRange(0, 0);
      S.roll.geometry.setDrawRange(0, 0);
    } else {
      writeBulge();
      for (let c = 0; c < N; c++) tmpB[c] = S.h0[c] + S.bulge[c];
      blur(tmpB, hs0);
      fillLayer(S.m0, hs0, null, false);
      S.flap.geometry.setDrawRange(0, 0);
      if (st.folded) {
        blur(S.h1, hs1);
        for (let c = 0; c < N; c++) base1[c] = hs0[c];
        fillLayer(S.m1, hs1, base1, true);
        buildRoll();
      } else {
        S.m1.geometry.setDrawRange(0, 0);
        S.roll.geometry.setDrawRange(0, 0);
      }
    }
  }

  // curled flap while folding (page-curl mapping around a cylinder)
  function curl(s, th, R, out) {
    if (s < th * R) {
      const p = s / R;
      out.u = R * Math.sin(p);
      out.y = R - R * Math.cos(p);
      out.nu = -Math.sin(p);
      out.ny = Math.cos(p);
    } else {
      const e = s - th * R;
      out.u = R * Math.sin(th) + e * Math.cos(th);
      out.y = R - R * Math.cos(th) + e * Math.sin(th);
      out.nu = -Math.sin(th);
      out.ny = Math.cos(th);
    }
    return out;
  }
  const CO = { u: 0, y: 0, nu: 0, ny: 0 };
  function buildFlap(fd, jcut) {
    blur(S.hF, hsF, (i, j) => j >= jcut);
    layout(hsF, Infinity);
    const pa = S.flap.geometry.attributes.position.array, ca = S.flap.geometry.attributes.color.array;
    for (let c = 0; c < N; c++) {
      const s = Math.max(0, LZ[c] - fd.zf);
      curl(s, fd.th, fd.R, CO);
      const h = LS[c] === 1 ? LH[c] : 0.0015;
      const vis = LS[c] ? 1 : 0;
      // under surface
      const k0 = c * 3, k1 = (c + N) * 3;
      pa[k0] = LX[c];
      pa[k0 + 1] = vis ? TOP + CO.y + 0.002 : TOP - 0.05;
      pa[k0 + 2] = fd.zf + CO.u;
      pa[k1] = LX[c];
      pa[k1 + 1] = vis ? TOP + CO.y + CO.ny * h + 0.002 : TOP - 0.05;
      pa[k1 + 2] = fd.zf + CO.u + CO.nu * h;
      const n = U.hash2(c, 17) * 0.025;
      for (const k of [k0, k1]) {
        ca[k] = 0.94 - n; ca[k + 1] = 0.91 - n; ca[k + 2] = 0.82 - n;
      }
    }
    const k = writeIndex(S.flap, 0, (i, j) => j >= jcut - 1);
    // second surface with offset indices
    const ia = S.flap.geometry.index.array;
    let m = k;
    for (let q = 0; q < k && m + 3 <= ia.length; q += 3) {
      ia[m++] = ia[q] + N; ia[m++] = ia[q + 2] + N; ia[m++] = ia[q + 1] + N;
    }
    S.flap.geometry.setDrawRange(0, m);
    S.flap.geometry.index.needsUpdate = true;
    S.flap.geometry.attributes.position.needsUpdate = true;
    S.flap.geometry.attributes.color.needsUpdate = true;
    S.flap.geometry.computeVertexNormals();
  }

  // rounded fold edge where both layers meet
  function buildRoll() {
    const st = S.st;
    const jf = st.jf;
    const AR = 10;
    const pa = S.roll.geometry.attributes.position.array, ca = S.roll.geometry.attributes.color.array;
    const ok = new Uint8Array(NX);
    for (let i = 0; i < NX; i++) {
      const c = idx(i, jf);
      const a = hs0[c], b = hs1[c];
      ok[i] = a > C0 && b > C0 && cx(i) < st.cutX ? 1 : 0;
      const rho = (a + b) / 2;
      for (let k = 0; k < AR; k++) {
        const ph = -Math.PI / 2 + (k / (AR - 1)) * Math.PI;
        const v = (i * AR + k) * 3;
        pa[v] = Math.min(cx(i), st.cutX - 0.003);
        pa[v + 1] = ok[i] ? TOP + rho + rho * Math.sin(ph) : TOP - 0.05;
        pa[v + 2] = st.zf - CS * 0.5 + Math.max(0, rho * Math.cos(ph));
        ca[v] = 0.94; ca[v + 1] = 0.91; ca[v + 2] = 0.82;
      }
    }
    const ia = S.roll.geometry.index.array;
    let m = 0;
    for (let i = 0; i < NX - 1; i++) {
      if (!ok[i] || !ok[i + 1]) continue;
      for (let k = 0; k < AR - 1; k++) {
        const a = i * AR + k, b = (i + 1) * AR + k, c = a + 1, d = b + 1;
        ia[m++] = a; ia[m++] = b; ia[m++] = c;
        ia[m++] = b; ia[m++] = d; ia[m++] = c;
      }
    }
    S.roll.geometry.setDrawRange(0, m);
    S.roll.geometry.index.needsUpdate = true;
    S.roll.geometry.attributes.position.needsUpdate = true;
    S.roll.geometry.computeVertexNormals();
  }

  // ---------------- placing dough ----------------
  S.placeDough = function (x, z, vol) {
    const st = S.st;
    if (st.folded) {
      for (let c = 0; c < N; c++) { S.h0[c] += S.h1[c]; S.h1[c] = 0; }
      st.folded = false;
    }
    st.cutX = Infinity;
    st.cuts = 0;
    st.rolled = 0;
    st.strokes = 0;
    const snap = S.h0.slice();
    const a = 0.6;
    U.tween(0.28, (t) => {
      const k = U.backOut(t);
      const R = 0.45 * (0.72 + 0.28 * k);
      const H = (vol * (a + 1)) / (Math.PI * R * R);
      for (let j = J0; j <= J1; j++)
        for (let i = I0; i <= I1; i++) {
          const r = Math.hypot(cx(i) - x, cz(j) - z);
          const c = idx(i, j);
          S.h0[c] = snap[c] + (r < R ? H * Math.pow(1 - (r * r) / (R * R), a) : 0);
        }
      // normalise volume
      S.dirty = true;
    }, () => {
      st.has = true;
      S.updateSpread();
    });
    st.has = true;
    S.pokes.push({ x, z, a: 0.05, s: 0.2, t: 0, held: false });
  };

  S.updateSpread = function () {
    let v = 0, n = 0;
    for (let c = 0; c < N; c++) {
      const h = S.h0[c] + S.h1[c];
      if (h > EPS) { v += h; n++; }
    }
    const mean = n ? v / n : 0;
    S.st.spread = n ? U.clamp(1 - (mean - 0.062) / (0.26 - 0.062), 0, 1) : 0;
    S.st.has = n > 0;
  };

  // ---------------- rolling ----------------
  function kfac(h) {
    return h > 0.15 ? 0.72 : h > 0.075 ? 0.82 : 0.9;
  }
  // the far end of the dough in a column, walking from row j in direction dir
  function farEdge(i, j, dir) {
    let e = j;
    while (e >= J0 && e <= J1 && S.h0[idx(i, e)] > EPS) e += dir;
    return e;
  }
  // dough pressed out by the pin rides in front of it ("carry", shown as a bulge);
  // each time a cell's worth has gathered, the dough beyond slides outward one cell
  const carry = new Float32Array(NX);
  const TC = new Float32Array(NX);
  S.bulge = new Float32Array(N);
  let carryRow = -1, carryDir = 1;
  function rollRow(j, dir, pinX) {
    if (j < J0 || j > J1) return 0;
    const iL = Math.max(I0, Math.floor((pinX - PIN_LEN / 2 - X0) / CS)), iR = Math.min(I1, Math.floor((pinX + PIN_LEN / 2 - X0) / CS));
    if (dir !== carryDir) dropCarry();
    carryDir = dir;
    // the pin rests on the thicker dough near each spot (a bump holds it up locally)
    const Tc = TC;
    let T = HMIN;
    for (let i = iL; i <= iR; i++) {
      let m = HMIN;
      for (let q = Math.max(iL, i - 3); q <= Math.min(iR, i + 3); q++) {
        const h = S.h0[idx(q, j)];
        if (h > EPS) m = Math.max(m, kfac(h) * h);
      }
      Tc[i] = m;
      T = Math.max(T, m);
    }
    let pressed = 0, side = 0;
    const jb = j + dir;
    for (let i = iL; i <= iR; i++) {
      const c = idx(i, j);
      const h = S.h0[c] + carry[i];
      carry[i] = 0;
      if (h <= Tc[i] + 1e-4) { S.h0[c] = h; continue; }
      const end = Math.min(cx(i) - (pinX - PIN_LEN / 2), pinX + PIN_LEN / 2 - cx(i));
      const p = U.smooth(0, 0.09, end);
      const ex = (h - Tc[i]) * p;
      S.h0[c] = h - ex;
      if (ex <= 0) continue;
      recent[c] += ex;
      pressed += ex;
      carry[i] += ex * 0.56;
      side += ex * 0.44;
    }
    // part of it squeezes out sideways: where the dough's side edge is under the
    // pin, the edge moves outward; where the dough is wider, a ridge forms at the pin end
    if (side > 0) {
      const extend = (e, sg, v) => {
        let guard = 0;
        while (v > 1e-6 && e >= I0 && e <= I1 && guard++ < 8) {
          const put = Math.min(v, Math.max(HMIN, T * 0.9));
          S.h0[idx(e, j)] += put;
          v -= put;
          e += sg;
        }
        if (v > 0) S.h0[idx(U.clamp(e - sg, I0, I1), j)] += v;
      };
      let eL = iL;
      while (eL <= iR && S.h0[idx(eL, j)] <= EPS) eL++;
      let eR = iR;
      while (eR >= iL && S.h0[idx(eR, j)] <= EPS) eR--;
      if (eL <= eR) {
        const ridge = (i0, sg, v) => {
          const w = [0.4, 0.3, 0.2, 0.1];
          for (let q = 0; q < 4; q++) S.h0[idx(U.clamp(i0 + sg * q, I0, I1), j)] += v * w[q];
        };
        // free side edge under the pin: it moves outward. Otherwise the dough
        // beside the pin holds it in, and it mostly goes forward (a low ridge forms)
        if (eL > iL) extend(eL - 1, -1, side * 0.5);
        else { ridge(iL - 1, -1, side * 0.12); carry[iL] += side * 0.38; }
        if (eR < iR) extend(eR + 1, 1, side * 0.5);
        else { ridge(iR + 1, 1, side * 0.12); carry[iR] += side * 0.38; }
      } else {
        carry[U.clamp(Math.round((pinX - X0) / CS), iL, iR)] += side;
      }
    }
    // columns beside the pin keep their carry where it is
    for (let i = I0; i <= I1; i++) {
      if (i >= iL && i <= iR) continue;
      if (carry[i] > 0) {
        S.h0[idx(i, U.clamp(jb, J0, J1))] += carry[i];
        carry[i] = 0;
      }
    }
    if (jb < J0 || jb > J1) { carryRow = U.clamp(j, J0, J1); dropCarry(); return pressed; }
    for (let i = iL; i <= iR; i++) {
      let guard = 0;
      while (carry[i] > 0 && guard++ < 4) {
        const T2 = Math.max(HMIN, Tc[i]);
        if (carry[i] < T2) break;
        const e = farEdge(i, jb, dir);
        if (e < J0 || e > J1) {
          // the column already reaches the board edge: the row widens instead
          widenRow(j, carry[i], T2);
          carry[i] = 0;
          break;
        }
        for (let k = e; k !== jb; k -= dir) S.h0[idx(i, k)] = S.h0[idx(i, k - dir)];
        S.h0[idx(i, jb)] = T2;
        carry[i] -= T2;
      }
    }
    carryRow = jb;
    return pressed;
  }
  function widenRow(j, v, T) {
    let eL = I0;
    while (eL <= I1 && S.h0[idx(eL, j)] <= EPS) eL++;
    let eR = I1;
    while (eR >= I0 && S.h0[idx(eR, j)] <= EPS) eR--;
    if (eL > eR) return;
    for (const [start, sg] of [[eL - 1, -1], [eR + 1, 1]]) {
      let left = v * 0.5, e = start, guard = 0;
      while (left > 1e-6 && e >= I0 && e <= I1 && guard++ < 6) {
        const put = Math.min(left, Math.max(HMIN, T));
        S.h0[idx(e, j)] += put;
        left -= put;
        e += sg;
      }
      if (left > 0) S.h0[idx(U.clamp(e - sg, I0, I1), j)] += left;
    }
  }
  function dropCarry() {
    if (carryRow < 0) return;
    // the bulge settles over a few rows ahead of where the pin stopped
    for (let i = I0; i <= I1; i++) {
      if (carry[i] > 0) {
        const w = [0.5, 0.3, 0.2];
        for (let k = 0; k < 3; k++) {
          const jj = U.clamp(carryRow + carryDir * k, J0, J1);
          S.h0[idx(i, jj)] += carry[i] * w[k];
        }
      }
      carry[i] = 0;
    }
    carryRow = -1;
  }
  S.dropCarry = dropCarry;
  function writeBulge() {
    S.bulge.fill(0);
    if (carryRow < 0) return;
    for (let i = I0; i <= I1; i++) if (carry[i] > 0) S.bulge[idx(i, carryRow)] = carry[i];
  }
  function addTo(i, j, v) {
    i = U.clamp(i, I0, I1);
    j = U.clamp(j, J0, J1);
    S.h0[idx(i, j)] += v;
  }
  function relax() {
    // gentle smoothing inside the dough only
    tmpA.set(S.h0);
    for (let j = J0; j <= J1; j++)
      for (let i = I0; i <= I1; i++) {
        const c = idx(i, j);
        if (tmpA[c] <= EPS) continue;
        let s = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = idx(i + di, j + dj);
          if (tmpA[nb] > EPS) { s += tmpA[nb]; n++; }
        }
        if (n) {
          const avg = s / n;
          const mv = (avg - tmpA[c]) * 0.12;
          S.h0[c] += mv;
          // conserve: take from/give to neighbours equally
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nb = idx(i + di, j + dj);
            if (tmpA[nb] > EPS) S.h0[nb] -= mv / n;
          }
        }
      }
  }

  function sanitize() {
    for (let c = 0; c < N; c++) if (!(S.h0[c] > 0)) S.h0[c] = 0;
  }
  function pinLevelAt(x, z) {
    const j = Math.floor((z - Z0) / CS);
    if (j < 0 || j >= NZ) return 0;
    const iL = Math.max(0, Math.floor((x - PIN_LEN / 2 - X0) / CS)), iR = Math.min(NX - 1, Math.floor((x + PIN_LEN / 2 - X0) / CS));
    let m = 0;
    for (let jj = Math.max(0, j - 1); jj <= Math.min(NZ - 1, j + 1); jj++)
      for (let i = iL; i <= iR; i++) m = Math.max(m, S.h0[idx(i, jj)] + S.h1[idx(i, jj)]);
    return m;
  }

  S.pinBusy = () => S.pinSt.mode === 'held';
  function pinHome() {
    const ps = S.pinSt;
    if (ps.mode === 'rest' || ps.mode === 'returning') return;
    ps.mode = 'returning';
    const from = S.pin.position.clone();
    const to = new THREE.Vector3(L.pinRest.x, TOP + 0.06 + PIN_R, L.pinRest.z);
    U.tween(0.5, (t) => {
      const e = U.easeInOut(t);
      S.pin.position.lerpVectors(from, to, e);
      S.pin.position.y += Math.sin(e * Math.PI) * 0.25;
    }, () => {
      ps.mode = 'rest';
      ps.x = to.x; ps.z = to.z; ps.y = to.y;
      U.audio.play('wood', 0.4, 0.2);
    });
  }
  S.pinHome = pinHome;

  // ---------------- folding ----------------
  function canFold() {
    const st = S.st;
    return st.has && !st.folded && st.cuts === 0 && !st.fold;
  }
  function startFold(p) {
    const e = S.edgesAt(p.x);
    const b = e ? { z0: e.z0, z1: e.z1 } : null;
    if (!b || b.z1 - b.z0 < 0.7) return false;
    if (p.z < b.z0 + (b.z1 - b.z0) * 0.55) return false;
    pinHome();
    S.hF.set(S.h0);
    S.st.fold = { zFront: b.z1 + CS * 0.5, zBack: b.z0 - CS * 0.5, zf: b.z1, th: 0, R: 0.12, finger: p.z, active: true };
    U.audio.play('squish', 0.4, 0.4);
    S.dirty = true;
    return true;
  }
  function moveFold(p) {
    const fd = S.st.fold;
    if (!fd || !fd.active) return;
    const zFinger = U.clamp(p.z, Math.max(Bd.z0 + 0.1, 2 * (fd.zBack + 0.2) - fd.zFront), fd.zFront);
    fd.finger = zFinger;
    let zf = (fd.zFront + zFinger) / 2;
    zf = U.clamp(zf, fd.zBack + 0.2, fd.zFront - 0.08);
    fd.zf = Z0 + Math.round((zf - Z0) / CS) * CS;
    const len = Math.max(0.5, fd.zFront - fd.zBack);
    fd.th = Math.PI * U.clamp((fd.zFront - zFinger) / (len * 0.75), 0, 1);
    S.dirty = true;
  }
  function endFold() {
    const fd = S.st.fold;
    if (!fd) return;
    fd.active = false;
    if (fd.th < Math.PI * 0.35) {
      const th0 = fd.th;
      U.tween(0.35, (t) => { fd.th = th0 * (1 - U.easeOut(t)); S.dirty = true; }, () => {
        S.h0.set(S.hF);
        S.st.fold = null;
        S.dirty = true;
      });
      return;
    }
    const th0 = fd.th, R0 = fd.R;
    // thickness at the fold sets how low it settles
    let hm = 0, n = 0;
    const jf = Math.round((fd.zf - Z0) / CS) - 1;
    for (let i = 0; i < NX; i++) {
      const a = S.hF[idx(i, jf)];
      if (a > EPS) { hm += a; n++; }
    }
    const R1 = Math.max(0.02, (n ? hm / n : 0.05));
    U.tween(0.32, (t) => { fd.th = U.lerp(th0, Math.PI, U.easeOut(t)); S.dirty = true; }, () => {
      U.audio.play('pat', 0.5);
      // the standing round fold sinks under its own weight
      U.tween(0.55, (t) => { fd.R = U.lerp(R0, R1, U.easeInOut(t)); S.dirty = true; }, () => commitFold());
    });
  }
  function commitFold() {
    const fd = S.st.fold;
    const jcut = Math.round((fd.zf - Z0) / CS);
    S.h1.fill(0);
    for (let j = jcut; j < NZ; j++) {
      const jm = 2 * jcut - 1 - j;
      for (let i = 0; i < NX; i++) {
        const c = idx(i, j);
        const v = S.hF[c];
        if (v <= 0) continue;
        if (jm >= 0) S.h1[idx(i, jm)] += v;
        else S.h0[idx(i, 0)] += v;
        S.h0[c] = 0;
      }
    }
    for (let j = 0; j < jcut; j++) for (let i = 0; i < NX; i++) S.h0[idx(i, j)] = S.hF[idx(i, j)];
    S.st.folded = true;
    S.st.zf = fd.zf;
    S.st.jf = jcut - 1;
    S.st.fold = null;
    S.dirty = true;
    U.audio.play('soft', 0.6);
  }

  // ---------------- cutting ----------------
  function stripRows(layer, xa, xb) {
    const rows = [];
    for (let j = 0; j < NZ; j++) {
      let w = 0, v = 0, xs = 0;
      for (let i = 0; i < NX; i++) {
        const c = idx(i, j);
        const h = layer[c];
        if (h <= EPS) continue;
        const l = Math.max(xa, cx(i) - CS / 2), r = Math.min(xb, cx(i) + CS / 2);
        const ov = r - l;
        if (ov <= 0) continue;
        w += ov;
        v += h * ov;
        xs += ((l + r) / 2) * ov;
      }
      rows.push(w > 0.006 ? { w, t: v / w, x: xs / w } : null);
    }
    return rows;
  }
  function rowRange(rows) {
    let a = -1, b = -1;
    rows.forEach((r, j) => {
      if (r) {
        if (a < 0) a = j;
        b = j;
      }
    });
    return a < 0 ? null : [a, b];
  }
  function fillRow(rows, j) {
    if (rows[j]) return rows[j];
    // gap inside a strip: borrow from neighbours (thin)
    for (let d = 1; d < 5; d++) {
      const r = rows[j - d] || rows[j + d];
      if (r) return { w: r.w * 0.6, t: r.t * 0.7, x: r.x };
    }
    return { w: 0.02, t: 0.03, x: 0 };
  }
  // build a noodle from the strip between xa and xb
  function cutStrip(xa, xb) {
    const st = S.st;
    const r0 = stripRows(S.h0, xa, xb), r1 = st.folded ? stripRows(S.h1, xa, xb) : [];
    const g0 = rowRange(r0), g1 = st.folded ? rowRange(r1) : null;
    const made = [];
    const mk = (pts, w, t, fold) => {
      if (pts.length < 2) return;
      // resample when very long
      let P = pts, W = w, T = t, F = fold;
      if (P.length > 72) {
        const k = P.length / 72;
        const P2 = [], W2 = [], T2 = [];
        for (let q = 0; q < 72; q++) {
          const s = Math.min(P.length - 1, Math.round(q * k));
          P2.push(P[s]); W2.push(W[s]); T2.push(T[s]);
        }
        F = F >= 0 ? Math.round(F / k) : -1;
        P = P2; W = W2; T = T2;
      }
      if (P.length === 2) {
        const m = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2, (P[0][2] + P[1][2]) / 2];
        P = [P[0], m, P[1]];
        W = [W[0], W[0], W[1]];
        T = [T[0], T[0], T[1]];
      }
      const nd = U.noodles.create({ points: P, w: W, t: T, fold: F, container: U.noodles.world, tint: st.round || 0, meta: { round: S.round || 0 } });
      nd.sleep = true;
      made.push(nd);
    };
    const xc = (rows, j) => (rows[j] && rows[j].x) || (xa + Math.min(xb, xa + 2) ) / 2;
    if (g0 && g1 && g0[1] >= st.jf - 2 && g1[1] >= st.jf - 2) {
      // folded strip: top layer back end -> fold -> bottom back end
      const pts = [], w = [], t = [];
      const xm = (j) => xc(r0, j);
      for (let j = g1[0]; j <= g1[1]; j++) {
        const a = fillRow(r1, j), b0 = r0[j] ? r0[j].t : 0;
        pts.push([r1[j] ? r1[j].x : xm(j), TOP + b0 + a.t / 2, cz(j)]);
        w.push(a.w); t.push(a.t);
      }
      const ta = fillRow(r1, g1[1]).t, tb = fillRow(r0, g0[1]).t;
      const rho = (ta + tb) / 2;
      const zf = st.zf;
      pts.push([xm(g0[1]), TOP + tb + rho * 0.2, zf + rho * 0.55]);
      w.push((fillRow(r1, g1[1]).w + fillRow(r0, g0[1]).w) / 2);
      t.push(rho);
      const fold = pts.length - 1;
      pts.push([xm(g0[1]), TOP + tb * 0.45, zf - CS * 0.2]);
      w.push(fillRow(r0, g0[1]).w); t.push(tb);
      for (let j = g0[1] - 1; j >= g0[0]; j--) {
        const a = fillRow(r0, j);
        pts.push([r0[j] ? r0[j].x : xm(j), TOP + a.t / 2, cz(j)]);
        w.push(a.w); t.push(a.t);
      }
      mk(pts, w, t, fold);
    } else {
      for (const [rows, g, base] of [[r0, g0, null], [r1, g1, r0]]) {
        if (!g) continue;
        const pts = [], w = [], t = [];
        for (let j = g[0]; j <= g[1]; j++) {
          const a = fillRow(rows, j);
          const b = base && base[j] ? base[j].t : 0;
          pts.push([rows[j] ? rows[j].x : xc(rows, j), TOP + b + a.t / 2, cz(j)]);
          w.push(a.w); t.push(a.t);
        }
        mk(pts, w, t, -1);
      }
    }
    // remove the strip from the sheet
    for (let i = 0; i < NX; i++) {
      if (cx(i) - CS / 2 >= xa - 1e-6) {
        for (let j = 0; j < NZ; j++) { S.h0[idx(i, j)] = 0; S.h1[idx(i, j)] = 0; }
      }
    }
    st.cutX = xa;
    S.dirty = true;
    S.updateSpread();
    return made;
  }
  S.cutStrip = cutStrip;

  function doCut() {
    const kn = S.kn, st = S.st;
    const x = kn.x;
    kn.mode = 'cutting';
    const prev = Math.min(st.cutX, Bd.x1);
    const hasDough = (() => {
      for (let j = 0; j < NZ; j++)
        for (let i = 0; i < NX; i++)
          if (cx(i) + CS / 2 > x && cx(i) - CS / 2 < prev && S.h0[idx(i, j)] + S.h1[idx(i, j)] > EPS) return true;
      return false;
    })();
    const under = S.thickAt(x, (Bd.z0 + Bd.z1) / 2) > EPS || hasDough;
    if (st.cuts === 0 && hasDough) pinHome();
    U.tween(0.15, (t) => { kn.lift = 0.22 * (1 - U.easeIn(t)); }, () => {
      U.audio.play(under ? 'knife' : 'knifeAir', 0.8);
      if (hasDough) {
        S.dent = { x, a: 0.0 };
        U.tween(0.12, (t) => { if (S.dent) S.dent.a = 0.025 * Math.sin(t * Math.PI * 0.5); S.dirty = true; });
      }
      U.after(0.12, () => {
        let made = [];
        if (hasDough) {
          made = cutStrip(x, prev);
          st.cuts++;
          U.audio.play('squish', 0.35, 0.6);
        }
        S.dent = null;
        S.dirty = true;
        // the blade pushes the new piece aside so a thin line of wood shows
        made.forEach((nd) => {
          const p0 = nd.pos.slice();
          U.tween(0.2, (t) => {
            for (let i = 0; i < nd.n; i++) {
              nd.pos[i * 3] = p0[i * 3] + 0.022 * U.easeOut(t);
              nd.prev[i * 3] = nd.pos[i * 3];
            }
            nd.dirty = true;
          });
        });
        U.tween(0.28, (t) => { kn.lift = 0.22 * U.easeOut(t); }, () => {
          kn.mode = 'rest';
        });
        if (S.onCut) S.onCut(made);
      });
    });
  }

  // ---------------- picks ----------------
  function setupPicks() {
    const C = U.core;
    const ps = S.pinSt;
    // rolling pin
    C.addPick({
      target: S.pin,
      priority: 4,
      enabled: () => (ps.mode === 'rest' || ps.mode === 'lying') && !S.st.fold,
      down(e) {
        if (S.st.folded || S.st.cuts > 0 || !S.st.has) {
          U.audio.play('wood', 0.4);
          const r0 = S.pin.userData.vis.rotation.x;
          U.tween(0.4, (t) => { S.pin.userData.vis.rotation.x = r0 + Math.sin(t * Math.PI) * 0.6; });
          return false;
        }
        ps.mode = 'held';
        const p = C.planeY(e.ray, TOP + 0.12, new THREE.Vector3()) || S.pin.position.clone();
        ps.off = new THREE.Vector3(S.pin.position.x - p.x, 0, S.pin.position.z - p.z);
        ps.tx = S.pin.position.x;
        ps.tz = S.pin.position.z;
        ps.x = S.pin.position.x;
        ps.z = S.pin.position.z;
        ps.lastRow = Math.floor((ps.z - Z0) / CS);
        recent.fill(0);
        U.audio.play('wood', 0.5, 0.4);
        return true;
      },
      move(e) {
        const p = C.planeY(e.ray, TOP + 0.12, _v);
        if (!p) return;
        ps.tx = U.clamp(p.x + ps.off.x * 0.6, Bd.x0 + PIN_LEN / 2 - 0.05, Bd.x1 - PIN_LEN / 2 + 0.05);
        ps.tz = U.clamp(p.z + ps.off.z * 0.6, ZMIN + 0.05, ZMAX - 0.05);
      },
      up() {
        dropCarry();
        // lift: the pressed band springs back a touch
        const back = recent.slice();
        let any = false;
        for (let c = 0; c < N; c++) if (back[c] > 0) { any = true; break; }
        if (any) {
          let done = 0;
          const vol0 = S.volume();
          U.tween(0.3, (t) => {
            const k = U.easeOut(t);
            const add = (k - done) * 0.08;
            done = k;
            for (let c = 0; c < N; c++) if (back[c] > 0 && S.h0[c] > EPS) S.h0[c] += back[c] * add;
            S.dirty = true;
          }, () => {
            // keep the amount of dough the same
            const v1 = S.volume();
            if (v1 > 0) { const f = vol0 / v1; for (let c = 0; c < N; c++) S.h0[c] *= f; }
            S.dirty = true;
          });
        }
        if (any) S.st.strokes = (S.st.strokes || 0) + 1;
        relax();
        relax();
        relax();
        sanitize();
        S.updateSpread();
        recent.fill(0);
        U.audio.loop('roll', 0);
        ps.mode = 'lying';
        // once the sheet is wide, the pin goes back to its rest so the edge is free to fold
        if (pinLevelAt(ps.x, ps.z) <= EPS || S.st.spread >= 0.78) pinHome();
      },
    });
    // knife
    const kn = S.kn;
    C.addPick({
      target: S.knife,
      priority: 4,
      enabled: () => kn.mode === 'rest' && !S.st.fold,
      down(e) {
        const p = C.planeY(e.ray, TOP + 0.35, new THREE.Vector3());
        kn.f0 = p ? p.x : kn.x;
        kn.x0 = kn.x;
        kn.mode = 'held';
        kn.moved = 0;
        U.audio.play('wood', 0.35, 0.7);
        return true;
      },
      move(e) {
        const p = C.planeY(e.ray, TOP + 0.35, _v);
        if (!p) return;
        const maxX = Math.min(L.knifeRestX, S.st.cutX - 0.03);
        const nx = U.clamp(kn.x0 + (p.x - kn.f0) * 0.75, Bd.x0 + 0.08, maxX);
        kn.moved += Math.abs(nx - kn.x);
        kn.x = nx;
      },
      up() {
        if (S.st.cutX - kn.x < 0.029) {
          // nothing between the blade and the last cut: a light tap on the board
          kn.mode = 'cutting';
          U.tween(0.12, (t) => { kn.lift = 0.22 * (1 - t * 0.6); }, () => {
            U.audio.play('knifeAir', 0.5);
            U.tween(0.2, (t) => { kn.lift = 0.22 * (0.4 + 0.6 * t); }, () => (kn.mode = 'rest'));
          });
          return;
        }
        doCut();
      },
    });
    // the dough itself (poke / fold / pull the last piece)
    let sh = null;
    C.addPick({
      priority: 2,
      enabled: () => S.st.has && !S.st.fold,
      hit(ray) {
        const p = C.planeY(ray, TOP + 0.05, new THREE.Vector3());
        if (!p) return null;
        if (p.x > S.st.cutX) return null;
        let best = 0;
        for (const [dx, dz] of [[0, 0], [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05], [0.08, 0.08], [-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08]]) best = Math.max(best, S.thickAt(p.x + dx, p.z + dz));
        if (best <= EPS) return null;
        return { dist: p.distanceTo(ray.origin), point: p };
      },
      down(e) {
        const p = e.point;
        const st = S.st;
        // a small last piece can be pulled straight off as one wide noodle
        if (st.cuts > 0) {
          const b = S.bounds();
          if (b && b.x1 - b.x0 < 0.5) {
            const made = cutStrip(Bd.x0 - 0.1, st.cutX);
            st.cuts++;
            if (made.length && S.grabNoodle) {
              S.grabNoodle(made[0], e);
              sh = { type: 'noodle' };
              return true;
            }
          }
        }
        if (canFold() && st.spread > 0.35 && startFold(p)) {
          sh = { type: 'fold' };
          return true;
        }
        const h = S.thickAt(p.x, p.z);
        const poke = { x: p.x, z: p.z, a: Math.min(0.06, h * 0.35 + 0.01), s: 0.09 + Math.min(0.12, h * 0.4), t: 0, held: true };
        S.pokes.push(poke);
        U.audio.play('squish', 0.45, h > 0.15 ? 0 : 0.5);
        sh = { type: 'poke', poke };
        return true;
      },
      move(e) {
        if (!sh) return;
        if (sh.type === 'fold') {
          const p = C.planeY(e.ray, TOP + 0.2, _v);
          if (p) moveFold(p);
        } else if (sh.type === 'noodle' && S.moveNoodle) S.moveNoodle(e);
        else if (sh.type === 'poke') {
          const p = C.planeY(e.ray, TOP + 0.05, _v);
          if (p && Math.hypot(p.x - sh.poke.x, p.z - sh.poke.z) > 0.15) {
            // sliding the finger: pokes follow, like pressing along the dough
            sh.poke.held = false;
            const h = S.thickAt(p.x, p.z);
            if (h > EPS) {
              sh.poke = { x: p.x, z: p.z, a: Math.min(0.06, h * 0.35 + 0.01), s: 0.09 + Math.min(0.12, h * 0.4), t: 0, held: true };
              S.pokes.push(sh.poke);
            }
          }
        }
      },
      up(e) {
        if (!sh) return;
        if (sh.type === 'fold') endFold();
        else if (sh.type === 'noodle' && S.dropNoodle) S.dropNoodle(e);
        else if (sh.type === 'poke') sh.poke.held = false;
        sh = null;
      },
    });
  }

  // ---------------- per frame ----------------
  S.update = function (dt) {
    const ps = S.pinSt, st = S.st;
    // pin
    if (ps.mode === 'held') {
      const ox = ps.x, oz = ps.z;
      ps.x = U.damp(ps.x, ps.tx, 20, dt);
      ps.z = U.damp(ps.z, ps.tz, 20, dt);
      const dz = ps.z - oz;
      // compress every row the pin crosses
      const row = Math.floor((ps.z - Z0) / CS);
      let pressed = 0;
      if (row !== ps.lastRow && !st.folded && st.cuts === 0) {
        const dir = row > ps.lastRow ? 1 : -1;
        for (let j = ps.lastRow + dir; dir > 0 ? j <= row : j >= row; j += dir) pressed += rollRow(j, dir, ps.x);
        ps.lastRow = row;
        if (pressed > 0) {
          sanitize();
          S.dirty = true;
          st.rolled += pressed;
        }
      }
      const lvl = pinLevelAt(ps.x, ps.z);
      ps.level = U.damp(ps.level, lvl, 25, dt);
      ps.y = TOP + ps.level + PIN_R;
      S.pin.position.set(ps.x, ps.y, ps.z);
      S.pin.userData.vis.rotation.x += dz / PIN_R;
      const sp = Math.hypot(ps.x - ox, dz) / dt;
      ps.speed = U.damp(ps.speed, sp, 10, dt);
      const contact = lvl > EPS ? 1 : 0.35;
      const hard = U.clamp(1 - (lvl - 0.045) / 0.3, 0, 1);
      U.audio.loop('roll', Math.min(0.28, ps.speed * 0.12) * contact, 160 + hard * 620 + (lvl <= EPS ? 500 : 0), 1 + hard * 3);
      if (Math.random() < 0.02 && ps.speed > 0.5) S.updateSpread();
    } else if (ps.mode === 'lying') {
      // stays resting on the dough; follows changes of thickness
      const lvl = pinLevelAt(ps.x, ps.z);
      ps.y = U.damp(ps.y, TOP + lvl + PIN_R, 10, dt);
      S.pin.position.y = ps.y;
      if ((st.folded || st.cuts > 0 || st.fold)) pinHome();
    }
    // knife
    const kn = S.kn;
    const ky = TOP + kn.lift + (kn.mode === 'held' ? 0.03 : 0);
    S.knife.position.x = U.damp(S.knife.position.x, kn.x, 30, dt);
    S.knife.position.y = kn.mode === 'held' ? U.damp(S.knife.position.y, ky, 20, dt) : ky;
    // pokes: press, release, small rebound
    for (let i = S.pokes.length - 1; i >= 0; i--) {
      const p = S.pokes[i];
      if (p.held) {
        p.cur = U.damp(p.cur || 0, p.a, 18, dt);
      } else {
        p.t += dt;
        p.cur = (p.a0 == null ? (p.a0 = p.cur || p.a) : p.a0) * Math.exp(-7 * p.t) * Math.cos(15 * p.t);
        if (p.t > 0.8) { S.pokes.splice(i, 1); S.dirty = true; continue; }
      }
      S.dirty = true;
    }
    if (S.pokes.length) {
      // use current amplitude for display
      S.pokes.forEach((p) => { p._a = p.a; p.a = p.cur || 0; });
    }
    if (S.dirty) {
      S.dirty = false;
      rebuild();
    }
    if (S.pokes.length) S.pokes.forEach((p) => { p.a = p._a; });
  };

  S.newRound = function (n) {
    S.round = n;
    S.st.round = n;
    S.kn.x = L.knifeRestX;
    if (S.pinSt.mode !== 'rest') pinHome();
  };
  S.TOP = TOP;
  S.CS = CS;
})();
