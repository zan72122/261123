/* dish.js — 小皿。皿の座標で持つ「山の高さ」、そこを流れるつゆ、波紋、ごまの粒。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;

  const N = 40;                 // 高さ場の分割
  const RX = 6.6;               // 高さ場の半幅
  const CS = (RX * 2) / N;      // 1マスの大きさ
  const MAXSEED = 240;
  const VMAX = 30;              // 一皿に入るつゆの量（cm^3）

  const D = (G.dish = { list: [], byId: {}, flying: [], stray: [] });
  D.N = N; D.CS = CS; D.RX = RX; D.VMAX = VMAX;

  const tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const GR = [0, 0];

  class Dish {
    constructor(id, x, y, z, rotY) {
      const mats = G.world.mats;
      this.id = id; this.kind = 'plate';
      this.group = new THREE.Group();
      this.cx = x; this.cz = z; this.by = y; this.rotY = rotY;
      this.tiltX = 0; this.tiltZ = 0; this.tvx = 0; this.tvz = 0; this.lift = 0;
      this.mat = new THREE.Matrix4(); this.inv = new THREE.Matrix4();
      this.prevKey = '';
      this.moved = true; this.collide = false;
      this.place = 'stack';
      this.pieces = [];
      this.pileDirty = false;
      const pg = D.plateGeo || (D.plateGeo = G.geom.plate());
      const gm = mats.plate.clone();
      // 皿ごとに少しだけ釉薬の色を変える
      const hue = G.rr(-0.015, 0.02);
      gm.color.setHSL(0.11 + hue, G.rr(0.05, 0.16), G.rr(0.9, 0.97));
      const glaze = new THREE.Mesh(pg.glaze, gm);
      glaze.castShadow = true; glaze.receiveShadow = true;
      const foot = new THREE.Mesh(pg.foot, mats.plateFoot.clone());
      foot.castShadow = true; foot.receiveShadow = true;
      this.group.add(glaze); this.group.add(foot);
      this.glaze = glaze;
      // 高さ場
      this.base = new Float32Array(N * N);
      this.mask = new Uint8Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const lx = -RX + (i + 0.5) * CS, lz = -RX + (j + 0.5) * CS;
        const r = Math.sqrt(lx * lx + lz * lz);
        this.base[j * N + i] = L.plateBase(Math.min(r, L.PLATE.Rin));
        this.mask[j * N + i] = r < L.PLATE.Rin - CS * 0.5 ? 1 : 0;
      }
      this.pile = new Float32Array(N * N);
      this.owner = new Int32Array(N * N).fill(-1);
      this.W = new Float32Array(N * N);
      this.fR = new Float32Array(N * N); this.fL = new Float32Array(N * N);
      this.fU = new Float32Array(N * N); this.fD = new Float32Array(N * N);
      this.vx = new Float32Array(N * N); this.vz = new Float32Array(N * N);
      this.R = new Float32Array(N * N); this.Rv = new Float32Array(N * N);
      this.volume = 0; this.waterAwake = 0;
      this.buildWaterMesh();
      // ごま
      this.seeds = [];
      this.seedMesh = new THREE.InstancedMesh(D.seedGeo || (D.seedGeo = G.geom.sesame()), mats.sesame, MAXSEED);
      this.seedMesh.count = 0; this.seedMesh.castShadow = true; this.seedMesh.frustumCulled = false;
      this.seedMesh.userData.sharedMat = true;
      this.group.add(this.seedMesh);
      // 当たり判定
      G.kit.proxy(new THREE.CylinderGeometry(L.PLATE.R + 0.9, L.PLATE.R + 0.9, 3.6, 20), 'plate', this, this.group).position.y = 1.4;
      this.updateMatrix(true);
    }

    buildWaterMesh() {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        pos[k * 3] = -RX + (i + 0.5) * CS; pos[k * 3 + 1] = -1; pos[k * 3 + 2] = -RX + (j + 0.5) * CS;
      }
      const idx = [];
      for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      this.quadIdx = idx;
      const ia = new THREE.BufferAttribute(new Uint16Array(idx.length), 1).setUsage(THREE.DynamicDrawUsage);
      g.setIndex(ia);
      g.setDrawRange(0, 0);
      g.computeVertexNormals();
      this.wet = new Uint8Array(N * N);
      const m = new THREE.Mesh(g, G.world.mats.water);
      m.receiveShadow = true; m.castShadow = false;
      m.visible = false;
      m.frustumCulled = false;
      m.userData.sharedMat = true;
      this.waterMesh = m;
      this.group.add(m);
    }

    setPos(x, y, z) { this.cx = x; this.by = y; this.cz = z; }

    updateMatrix(force) {
      const g = this.group;
      g.position.set(this.cx, this.by + this.lift, this.cz);
      g.rotation.set(this.tiltX, this.rotY, this.tiltZ, 'YXZ');
      g.updateMatrix();
      g.updateMatrixWorld(true);
      const key = g.matrixWorld.elements.map((v) => v.toFixed(4)).join(',');
      if (force || key !== this.prevKey) {
        this.prevKey = key;
        this.mat.copy(g.matrixWorld);
        this.inv.copy(this.mat).invert();
        this.moved = true;
      }
    }
    toLocal(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.inv); }
    toWorld(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.mat); }

    cell(lx, lz) {
      const i = Math.floor((lx + RX) / CS), j = Math.floor((lz + RX) / CS);
      if (i < 0 || j < 0 || i >= N || j >= N) return -1;
      return j * N + i;
    }
    // 双線形で値をとる
    sample(arr, lx, lz) {
      let fx = (lx + RX) / CS - 0.5, fz = (lz + RX) / CS - 0.5;
      fx = M.clamp(fx, 0, N - 1.001); fz = M.clamp(fz, 0, N - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const k = j * N + i;
      return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + N] * (1 - tx) + arr[k + N + 1] * tx) * tz;
    }
    surf(lx, lz) {
      const r = Math.sqrt(lx * lx + lz * lz);
      return L.plateBase(Math.min(r, L.PLATE.Rin)) + this.sample(this.pile, lx, lz);
    }
    // ある粒から見た地面（自分のすぐ隣の粒が刻んだ跡は数えない）
    surfFor(lx, lz, cid, idx) {
      let fx = (lx + RX) / CS - 0.5, fz = (lz + RX) / CS - 0.5;
      fx = M.clamp(fx, 0, N - 1.001); fz = M.clamp(fz, 0, N - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const k = j * N + i;
      const P = this.pile, O = this.owner;
      const v = (kk) => { const o = O[kk]; return (o >= 0 && (o >> 10) === cid && Math.abs((o & 1023) - idx) <= 3) ? 0 : P[kk]; };
      const r = Math.sqrt(lx * lx + lz * lz);
      return L.plateBase(Math.min(r, L.PLATE.Rin)) + (v(k) * (1 - tx) + v(k + 1) * tx) * (1 - tz) + (v(k + N) * (1 - tx) + v(k + N + 1) * tx) * tz;
    }
    gradFor(lx, lz, cid, idx) {
      const e = CS * 0.9;
      const ax = this.surfFor(lx + e, lz, cid, idx) - this.surfFor(lx - e, lz, cid, idx);
      const az = this.surfFor(lx, lz + e, cid, idx) - this.surfFor(lx, lz - e, cid, idx);
      GR[0] = ax / (2 * e); GR[1] = az / (2 * e);
      return GR;
    }
    surfWet(lx, lz) { return this.surf(lx, lz) + this.sample(this.W, lx, lz); }
    waterAt(lx, lz) { return this.sample(this.W, lx, lz); }
    grad(lx, lz) {
      const e = CS * 0.9;
      GR[0] = (this.surf(lx + e, lz) - this.surf(lx - e, lz)) / (2 * e);
      GR[1] = (this.surf(lx, lz + e) - this.surf(lx, lz - e)) / (2 * e);
      return GR;
    }
    // 糸の粒の跡を山に刻む（上面の高さで最大値をとる）
    stamp(lx, ly, lz, rad, key) {
      const top = ly + rad * 0.88;
      const rr = rad * 1.0;
      const i0 = Math.floor((lx - rr + RX) / CS), i1 = Math.floor((lx + rr + RX) / CS);
      const j0 = Math.floor((lz - rr + RX) / CS), j1 = Math.floor((lz + rr + RX) / CS);
      for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const cx = -RX + (i + 0.5) * CS, cz = -RX + (j + 0.5) * CS;
        const dx = cx - lx, dz = cz - lz;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr) continue;
        const k = j * N + i;
        const h = top - Math.sqrt(Math.max(0, d2)) * 0.25 - this.base[k];
        if (h > this.pile[k]) { this.pile[k] = h; this.owner[k] = key == null ? -1 : key; }
      }
      this.waterAwake = 2;
    }
    recomputePile() {
      this.pile.fill(0); this.owner.fill(-1);
      const S = G.strands;
      for (const c of S.chains) {
        for (let i = 0; i < c.n; i++) if (c.st[i] === 2 && c.pl[i] === this.id) this.stamp(c.lx[i], c.ly[i], c.lz[i], S.RAD, c.id * 1024 + i);
      }
      this.pileDirty = false;
    }

    // ---- つゆ ----
    addWater(lx, lz, vol) {
      const room = VMAX - this.volume;
      if (room <= 0) return 0;
      vol = Math.min(vol, room);
      let k = this.cell(lx, lz);
      if (k < 0 || !this.mask[k]) {
        // 縁の外なら内側の近いマスへ
        const r = Math.sqrt(lx * lx + lz * lz) || 1;
        const s = (L.PLATE.Rin - 0.6) / r;
        k = this.cell(lx * s, lz * s);
        if (k < 0) return 0;
      }
      this.W[k] += vol / (CS * CS);
      this.volume += vol;
      this.waterAwake = 3;
      return vol;
    }
    ripple(lx, lz, amp) {
      const k = this.cell(lx, lz);
      if (k < 0) return;
      this.Rv[k] -= amp * 6;
      this.waterAwake = 3;
    }
    // 皿のふちをつついた時の揺れ
    tap(lx, lz, strength) {
      const r = Math.sqrt(lx * lx + lz * lz) || 1;
      const nx = lx / r, nz = lz / r;
      // 皿の座標の向きを世界の向きへ
      const cs = Math.cos(this.rotY), sn = Math.sin(this.rotY);
      const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
      this.tvx += -wz * 0.9 * strength; this.tvz += wx * 0.9 * strength;
      // つゆを向こう側へ押す
      for (let k = 0; k < N * N; k++) {
        if (this.W[k] < 0.01) continue;
        this.fR[k] += -nx * 6 * strength * this.W[k] * (nx < 0 ? 1 : 0);
        this.fL[k] += nx * 6 * strength * this.W[k] * (nx > 0 ? 1 : 0);
        this.fU[k] += -nz * 6 * strength * this.W[k] * (nz < 0 ? 1 : 0);
        this.fD[k] += nz * 6 * strength * this.W[k] * (nz > 0 ? 1 : 0);
      }
      for (let a = 0; a < 6; a++) this.ripple(nx * (4.8 - a * 0.2), nz * (4.8 - a * 0.2), 0.35 * strength);
      this.waterAwake = 3;
      // ごまの向きが少し変わる
      for (const s of this.seeds) {
        if (s.state === 'rest' || s.state === 'float') {
          s.yaw += (G.rand() - 0.5) * 0.6 * strength;
          s.vx -= nx * 0.6 * strength * (s.state === 'float' ? 2.5 : 0.3);
          s.vz -= nz * 0.6 * strength * (s.state === 'float' ? 2.5 : 0.3);
          if (s.state === 'rest') { s.state = 'roll'; s.t = 0; }
        }
      }
    }

    waterStep(dt) {
      if (this.waterAwake <= 0 || this.volume <= 0) return;
      const sub = 2, h = dt / sub;
      const W = this.W, base = this.base, pile = this.pile, mask = this.mask;
      const fR = this.fR, fL = this.fL, fU = this.fU, fD = this.fD;
      const C = 980 * CS * 0.55, damp = Math.pow(0.12, h);
      const A = CS * CS;
      let maxMove = 0;
      for (let s = 0; s < sub; s++) {
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (!mask[k]) { fR[k] = fL[k] = fU[k] = fD[k] = 0; continue; }
          const hk = base[k] + pile[k] + W[k];
          const fl = (i > 0 && mask[k - 1]) ? Math.max(0, fL[k] * damp + h * C * (hk - (base[k - 1] + pile[k - 1] + W[k - 1]))) : 0;
          const fr = (i < N - 1 && mask[k + 1]) ? Math.max(0, fR[k] * damp + h * C * (hk - (base[k + 1] + pile[k + 1] + W[k + 1]))) : 0;
          const fd = (j > 0 && mask[k - N]) ? Math.max(0, fD[k] * damp + h * C * (hk - (base[k - N] + pile[k - N] + W[k - N]))) : 0;
          const fu = (j < N - 1 && mask[k + N]) ? Math.max(0, fU[k] * damp + h * C * (hk - (base[k + N] + pile[k + N] + W[k + N]))) : 0;
          const tot = (fl + fr + fd + fu) * h;
          const vol = W[k] * A;
          const kk = tot > vol && tot > 0 ? vol / tot : 1;
          fL[k] = fl * kk; fR[k] = fr * kk; fD[k] = fd * kk; fU[k] = fu * kk;
        }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (!mask[k]) continue;
          const inflow = (i > 0 ? fR[k - 1] : 0) + (i < N - 1 ? fL[k + 1] : 0) + (j > 0 ? fU[k - N] : 0) + (j < N - 1 ? fD[k + N] : 0);
          const outflow = fL[k] + fR[k] + fD[k] + fU[k];
          const dV = h * (inflow - outflow);
          W[k] = Math.max(0, W[k] + dV / A);
          if (Math.abs(dV) > maxMove) maxMove = Math.abs(dV);
        }
      }
      // 流れの速さ（ごまを運ぶ）
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (!mask[k] || W[k] < 0.004) { this.vx[k] = this.vz[k] = 0; continue; }
        const dx = ((i > 0 ? fR[k - 1] : 0) - fL[k] + fR[k] - (i < N - 1 ? fL[k + 1] : 0)) * 0.5;
        const dz = ((j > 0 ? fU[k - N] : 0) - fD[k] + fU[k] - (j < N - 1 ? fD[k + N] : 0)) * 0.5;
        const den = CS * Math.max(W[k], 0.03);
        this.vx[k] = M.clamp(dx / den, -18, 18);
        this.vz[k] = M.clamp(dz / den, -18, 18);
      }
      // 波紋（浅い所の小さな波。乾いた所や山で跳ね返る）
      const R = this.R, Rv = this.Rv;
      const Kw = (9 / CS) * (9 / CS), rd = Math.pow(0.25, dt);
      let rMax = 0;
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if (!mask[k] || W[k] < 0.02) { R[k] = 0; Rv[k] = 0; continue; }
        const nb = (W[k - 1] >= 0.02 ? R[k - 1] : R[k]) + (W[k + 1] >= 0.02 ? R[k + 1] : R[k]) + (W[k - N] >= 0.02 ? R[k - N] : R[k]) + (W[k + N] >= 0.02 ? R[k + N] : R[k]);
        Rv[k] += (nb - 4 * R[k]) * Kw * dt;
        Rv[k] *= rd;
      }
      for (let k = 0; k < N * N; k++) { R[k] += Rv[k] * dt; R[k] *= 0.995; if (Math.abs(R[k]) > rMax) rMax = Math.abs(R[k]); }
      if (maxMove < 1e-5 && rMax < 0.002) this.waterAwake -= dt; else this.waterAwake = 2;
      this.updateWaterMesh();
    }

    updateWaterMesh() {
      const m = this.waterMesh;
      if (this.volume <= 0.01) { m.visible = false; return; }
      m.visible = true;
      const pos = m.geometry.attributes.position.array, col = m.geometry.attributes.color.array;
      const W = this.W, base = this.base, pile = this.pile, R = this.R, wet = this.wet;
      for (let k = 0; k < N * N; k++) {
        const w = W[k];
        let y, cr, cg, cb;
        wet[k] = this.mask[k] && w > 0.012 ? 1 : 0;
        // 乾いた所は地面のすぐ下へ（濡れた所の縁だけが描かれる）
        if (wet[k]) {
          y = base[k] + pile[k] + w + R[k] * 0.6;
          const t = Math.min(1, w / 0.45);
          // 浅い所は琥珀、深い所ほど濃い
          cr = 0.62 - 0.5 * t; cg = 0.38 - 0.31 * t; cb = 0.17 - 0.15 * t;
          if (w < 0.06) { const s = w / 0.06; cr = 0.8 * (1 - s) + cr * s; cg = 0.66 * (1 - s) + cg * s; cb = 0.5 * (1 - s) + cb * s; }
        } else {
          y = base[k] + pile[k] - 0.04;
          cr = 0.78; cg = 0.62; cb = 0.45;
        }
        pos[k * 3 + 1] = y;
        col[k * 3] = cr; col[k * 3 + 1] = cg; col[k * 3 + 2] = cb;
      }
      // 濡れた点を含む三角形だけ描く
      const qi = this.quadIdx, ia = m.geometry.index.array;
      let n = 0;
      for (let t = 0; t < qi.length; t += 3) {
        const a = qi[t], b = qi[t + 1], c = qi[t + 2];
        if (wet[a] | wet[b] | wet[c]) { ia[n++] = a; ia[n++] = b; ia[n++] = c; }
      }
      m.geometry.index.needsUpdate = true;
      m.geometry.setDrawRange(0, n);
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.attributes.color.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }

    // ---- ごま ----
    addSeedLocal(lx, ly, lz, vx, vy, vz, yaw) {
      if (this.seeds.length >= MAXSEED) return;
      this.seeds.push({ x: lx, y: ly, z: lz, vx, vy, vz, state: 'fly', bounce: 0, t: 0, yaw: yaw, pitch: G.rr(-0.3, 0.3), roll: G.rr(-0.2, 0.2), spin: G.rr(-6, 6) });
    }
    seedStep(dt) {
      if (!this.seeds.length) return;
      const g = 980;
      for (const s of this.seeds) {
        s.t += dt;
        if (s.state === 'fly') {
          s.vy -= g * dt;
          s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
          s.yaw += s.spin * dt; s.pitch += s.spin * 0.4 * dt;
          const r = Math.sqrt(s.x * s.x + s.z * s.z);
          if (r > L.PLATE.Rin - 0.15) { const f = (L.PLATE.Rin - 0.15) / r; s.x *= f; s.z *= f; s.vx *= -0.3; s.vz *= -0.3; }
          const ground = this.surf(s.x, s.z), w = this.waterAt(s.x, s.z);
          if (w > 0.04 && s.y < ground + w) {
            s.state = 'float'; s.y = ground + w; s.vx *= 0.3; s.vz *= 0.3; s.vy = 0;
            this.ripple(s.x, s.z, 0.25);
            D.events.push({ type: 'seedWater', dish: this, x: s.x, z: s.z });
          } else if (s.y < ground + 0.05) {
            s.y = ground + 0.05;
            if (s.bounce < 3 && Math.abs(s.vy) > 18) {
              s.vy = -s.vy * 0.36; s.vx = s.vx * 0.55 + G.rr(-6, 6); s.vz = s.vz * 0.55 + G.rr(-6, 6);
              s.bounce++; s.spin *= 0.6;
              D.events.push({ type: 'seedTick', dish: this, x: s.x, z: s.z, v: Math.abs(s.vy) });
            } else { s.state = 'roll'; s.t = 0; s.vy = 0; }
          }
        } else if (s.state === 'roll') {
          const gr = this.grad(s.x, s.z);
          const sl = Math.sqrt(gr[0] * gr[0] + gr[1] * gr[1]);
          s.vx += -gr[0] * 160 * dt; s.vz += -gr[1] * 160 * dt;
          const fr = Math.pow(0.02, dt);
          s.vx *= fr; s.vz *= fr;
          s.x += s.vx * dt; s.z += s.vz * dt;
          const r = Math.sqrt(s.x * s.x + s.z * s.z);
          if (r > L.PLATE.Rin - 0.2) { const f = (L.PLATE.Rin - 0.2) / r; s.x *= f; s.z *= f; }
          s.y = this.surf(s.x, s.z) + 0.05;
          s.yaw += (s.vx * 0.2) * dt;
          // 傾きを地面に合わせる
          s.pitch = M.lerp(s.pitch, Math.atan(gr[1]) * 0.8, 0.2); s.roll = M.lerp(s.roll, -Math.atan(gr[0]) * 0.8, 0.2);
          const sp = Math.abs(s.vx) + Math.abs(s.vz);
          if ((sl < 0.3 && sp < 0.6 && s.t > 0.15) || s.t > 1.6) { s.state = 'rest'; s.vx = s.vz = 0; }
          if (this.waterAt(s.x, s.z) > 0.05) s.state = 'float';
        } else if (s.state === 'rest') {
          const w = this.waterAt(s.x, s.z);
          if (w > 0.05) { s.state = 'float'; s.vx = s.vz = 0; }
          else s.y = this.surf(s.x, s.z) + 0.05;
        } else if (s.state === 'float') {
          const k = this.cell(s.x, s.z);
          const fvx = k >= 0 ? this.vx[k] : 0, fvz = k >= 0 ? this.vz[k] : 0;
          s.vx = M.lerp(s.vx, fvx * 0.85, M.damp(4, dt)); s.vz = M.lerp(s.vz, fvz * 0.85, M.damp(4, dt));
          s.x += s.vx * dt; s.z += s.vz * dt;
          const r = Math.sqrt(s.x * s.x + s.z * s.z);
          if (r > L.PLATE.Rin - 0.25) { const f = (L.PLATE.Rin - 0.25) / r; s.x *= f; s.z *= f; s.vx *= -0.2; s.vz *= -0.2; }
          const w = this.waterAt(s.x, s.z);
          // 山の上に乗り上げそうなら止める
          s.y = this.surf(s.x, s.z) + w - 0.02 + (k >= 0 ? this.R[k] * 0.6 : 0);
          s.yaw += (fvx - fvz) * 0.05 * dt + Math.sin(G.time * 0.7 + s.spin) * 0.08 * dt;
          if (w < 0.025) { s.state = 'rest'; }
        }
      }
      this.updateSeedMesh();
    }
    updateSeedMesh() {
      const im = this.seedMesh;
      const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      const m = tmpM;
      for (let i = 0; i < this.seeds.length; i++) {
        const s = this.seeds[i];
        e.set(s.pitch, s.yaw, s.roll, 'YXZ'); q.setFromEuler(e);
        v.set(s.x, s.y, s.z);
        m.compose(v, q, sc); im.setMatrixAt(i, m);
      }
      im.count = this.seeds.length;
      im.instanceMatrix.needsUpdate = true;
    }

    update(dt) {
      // 盆のくぼみの中での揺れ
      const k = 140, d = 6.5;
      const ax = -k * this.tiltX - d * this.tvx, az = -k * this.tiltZ - d * this.tvz;
      this.tvx += ax * dt; this.tvz += az * dt;
      this.tiltX += this.tvx * dt; this.tiltZ += this.tvz * dt;
      this.updateMatrix(false);
      this.pileT = (this.pileT || 0) + dt;
      if (this.pileDirty && this.pileT > 0.2) { this.pileT = 0; this.recomputePile(); }
      this.waterStep(dt);
      this.seedStep(dt);
    }
  }
  D.Dish = Dish;

  D.add = function (x, y, z, rotY) {
    const id = D.list.length;
    const d = new Dish(id, x, y, z, rotY);
    D.list.push(d); D.byId[id] = d;
    G.world.scene.add(d.group);
    return d;
  };

  D.events = [];

  // 盆・板・卓の高さ（皿の外に落ちた物）
  D.floorAt = function (x, z) {
    const T = L.TRAY;
    if (x > T.x0 + T.rimW && x < T.x1 - T.rimW && z > T.z0 + T.rimW && z < T.z1 - T.rimW) {
      for (const R of [L.FRONT, L.BACK]) if (M.dist2(x, z, R.x, R.z) < R.r) return T.floorY - R.depth;
      return T.floorY;
    }
    if (x > T.x0 && x < T.x1 && z > T.z0 && z < T.z1) return T.rimTop;
    const B = L.BOARD;
    if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) return B.t;
    return 0;
  };

  // 皿の上で、ある世界座標の点にいちばん近い皿（中心からの距離が半径以内）
  D.dishAt = function (x, z, pad) {
    let best = null, bd = 1e9;
    for (const d of D.list) {
      if (!d.collide) continue;
      const dd = M.dist2(x, z, d.cx, d.cz);
      if (dd < L.PLATE.Rin + (pad || 0) && dd < bd) { bd = dd; best = d; }
    }
    return best;
  };

  // さじからこぼれたごま（世界の座標で落ち、皿に入ればその皿のものになる）
  D.dropSeed = function (x, y, z, vx, vy, vz) {
    D.flying.push({ x, y, z, vx, vy, vz, yaw: G.rr(0, 6.28), pitch: G.rr(-0.5, 0.5), spin: G.rr(-8, 8) });
  };
  D.updateFlying = function (dt) {
    const im = D.flyMesh;
    for (let i = D.flying.length - 1; i >= 0; i--) {
      const s = D.flying[i];
      s.vy -= 980 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.yaw += s.spin * dt;
      const d = D.dishAt(s.x, s.z, 0);
      if (d) {
        d.toLocal(s.x, s.y, s.z, tmpV);
        const top = d.surfWet(tmpV.x, tmpV.z) + 1.5;
        if (tmpV.y < top) {
          // 皿の座標へ移す（速さも向きを直す）
          const cs = Math.cos(-d.rotY), sn = Math.sin(-d.rotY);
          d.addSeedLocal(tmpV.x, tmpV.y, tmpV.z, s.vx * cs - s.vz * sn, s.vy, s.vx * sn + s.vz * cs, s.yaw - d.rotY);
          D.flying.splice(i, 1);
          continue;
        }
      }
      const fy = D.floorAt(s.x, s.z);
      if (s.y < fy + 0.05) {
        s.y = fy + 0.05;
        if (Math.abs(s.vy) > 30 && !s.b) { s.vy *= -0.3; s.vx *= 0.5; s.vz *= 0.5; s.b = 1; }
        else { D.stray.push(s); D.flying.splice(i, 1); }
      }
    }
    if (!im) return;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const all = D.flying.concat(D.stray.slice(-120));
    for (const s of all) {
      e.set(s.pitch, s.yaw, 0, 'YXZ'); q.setFromEuler(e); v.set(s.x, s.y, s.z);
      tmpM.compose(v, q, sc); im.setMatrixAt(n++, tmpM);
      if (n >= 200) break;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  };

  D.init = function (scene) {
    D.flyMesh = new THREE.InstancedMesh(D.seedGeo || (D.seedGeo = G.geom.sesame()), G.world.mats.sesame, 200);
    D.flyMesh.count = 0; D.flyMesh.frustumCulled = false; D.flyMesh.castShadow = true;
    scene.add(D.flyMesh);
  };

  D.update = function (dt) {
    for (const d of D.list) d.update(dt);
    D.updateFlying(dt);
  };
})();
