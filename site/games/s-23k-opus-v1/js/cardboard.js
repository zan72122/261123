// cardboard.js — 段ボール板の立体（表裏の面＋切り口の波目）と、たわみ・へこみの変形、折り筋
(function () {
  'use strict';
  const S = window.S23;
  const CB = (S.cardboard = {});
  const T = S.DIM.T;

  function faceMat() {
    return new THREE.MeshStandardMaterial({
      map: S.TX.kraft(), bumpMap: S.TX.kraftBump(), bumpScale: 0.35,
      roughness: 0.86, metalness: 0, color: 0xffffff, emissive: 0x000000,
    });
  }
  function edgeMat() {
    return new THREE.MeshStandardMaterial({ map: S.TX.flute(), roughness: 0.92, metalness: 0, emissive: 0x000000 });
  }
  CB.faceMat = faceMat;
  CB.edgeMat = edgeMat;
  CB.creaseMat = new THREE.MeshStandardMaterial({ color: 0x9c7446, roughness: 0.9 });

  // 板：局所座標で u=折り筋方向(x), v=折り筋から外向き(z)。表は y=0、裏は y=-T。
  // mask(u,v) が true のセルだけを紙として残す（くぼみ・切り欠き用）
  CB.makePanel = function (o) {
    const u0 = o.u0, u1 = o.u1, v0 = o.v0 || 0, v1 = o.v1;
    const step = o.step || 1;
    const nu = Math.max(1, Math.round((u1 - u0) / step)), nv = Math.max(1, Math.round((v1 - v0) / step));
    const du = (u1 - u0) / nu, dv = (v1 - v0) / nv;
    const mask = o.mask || (() => true);
    const inside = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) inside.push(mask(u0 + (i + 0.5) * du, v0 + (j + 0.5) * dv));
    const isIn = (i, j) => i >= 0 && j >= 0 && i < nu && j < nv && inside[j * nu + i];

    const pos = [], uv = [], idxFace = [], idxEdge = [];
    const baseUV = []; // 各頂点の (u,v) 板上の位置
    const gridN = (nu + 1) * (nv + 1);
    // 表（y=0）
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = u0 + i * du, v = v0 + j * dv;
      pos.push(u, 0, v); uv.push(u + (o.uvOff || 0), v); baseUV.push(u, v, 0);
    }
    // 裏（y=-T）
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = u0 + i * du, v = v0 + j * dv;
      pos.push(u, -T, v); uv.push(u + 7.3, v + 3.1); baseUV.push(u, v, -T);
    }
    const g = (i, j) => j * (nu + 1) + i;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (!isIn(i, j)) continue;
      const a = g(i, j), b = g(i + 1, j), c = g(i + 1, j + 1), d = g(i, j + 1);
      idxFace.push(a, d, c, a, c, b); // 表（+y 向き）
      idxFace.push(gridN + a, gridN + b, gridN + c, gridN + a, gridN + c, gridN + d); // 裏
    }
    // 切り口：内側セルと外側の境目に壁を立てる
    function wall(ax, az, bx, bz, nx, nz) {
      const s = pos.length / 3;
      const along = Math.abs(bx - ax) > Math.abs(bz - az);
      const ua = along ? ax : az, ub = along ? bx : bz;
      pos.push(ax, 0, az, bx, 0, bz, bx, -T, bz, ax, -T, az);
      uv.push(ua, 1, ub, 1, ub, 0, ua, 0);
      baseUV.push(ax, az, 0, bx, bz, 0, bx, bz, -T, ax, az, -T);
      // 外向きの面になるよう巻き順を選ぶ
      const ex = bx - ax, ez = bz - az;
      // 面法線 = (b-a) × (down)
      const cx = -ez * -T * 0 + 0, cz = 0; // placeholder
      const crossX = ez * (-T) * -1, crossZ = -ex * (-T) * -1; // (e × (0,-T,0)) の x,z
      const sgn = (crossX * nx + crossZ * nz) > 0 ? 1 : -1;
      if (sgn > 0) idxEdge.push(s, s + 1, s + 2, s, s + 2, s + 3);
      else idxEdge.push(s, s + 2, s + 1, s, s + 3, s + 2);
      void cx; void cz;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (!isIn(i, j)) continue;
      const ua = u0 + i * du, ub = ua + du, va = v0 + j * dv, vb = va + dv;
      if (!isIn(i - 1, j)) wall(ua, va, ua, vb, -1, 0);
      if (!isIn(i + 1, j)) wall(ub, va, ub, vb, 1, 0);
      if (!isIn(i, j - 1)) wall(ua, va, ub, va, 0, -1);
      if (!isIn(i, j + 1)) wall(ua, vb, ub, vb, 0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idxFace.concat(idxEdge));
    geo.addGroup(0, idxFace.length, 0);
    geo.addGroup(idxFace.length, idxEdge.length, 1);
    geo.computeVertexNormals();
    const fm = faceMat(), em = edgeMat();
    const mesh = new THREE.Mesh(geo, [fm, em]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const panel = {
      mesh, geo, fm, em, base: new Float32Array(baseUV), u0, u1, v0, v1,
      // 変形のパラメータ
      curl: o.curl || 0, curlFrom: o.curlFrom != null ? o.curlFrom : v1 - 4,
      dents: [], bounce: 0, bounceV: 0, wobble: 0, dirty: true, lastSig: '',
    };
    return panel;
  };

  // 変形：表面の法線方向（局所 y）へのずれ
  CB.deform = function (p, dt) {
    // はね返りのばね
    if (Math.abs(p.bounce) > 1e-4 || Math.abs(p.bounceV) > 1e-4) {
      const k = 260, c = 9;
      p.bounceV += (-k * p.bounce - c * p.bounceV) * dt;
      p.bounce += p.bounceV * dt;
      p.dirty = true;
    }
    for (let i = p.dents.length - 1; i >= 0; i--) {
      const d = p.dents[i];
      // 押した位置からへこみが広がる
      d.r = S.damp(d.r, d.rMax, 6, dt);
      if (d.release) { d.depth = S.damp(d.depth, 0, 5, dt); if (d.depth < 0.005) p.dents.splice(i, 1); }
      else d.depth = S.damp(d.depth, d.target, 10, dt);
      p.dirty = true;
    }
    if (!p.dirty) return;
    p.dirty = false;
    const posA = p.geo.attributes.position, arr = posA.array, base = p.base;
    const span = p.v1 - p.v0;
    for (let i = 0, n = posA.count; i < n; i++) {
      const u = base[i * 3], v = base[i * 3 + 1], y0 = base[i * 3 + 2];
      let d = 0;
      if (p.curl) { const t = S.clamp((v - p.curlFrom) / (p.v1 - p.curlFrom), 0, 1); d += p.curl * t * t; }
      if (p.bounce) { const t = (v - p.v0) / span; d += p.bounce * t * t; }
      if (p.valley) { const vl = p.valley, w = v < vl.v ? vl.w0 : vl.w1, t = Math.min(1, Math.abs(v - vl.v) / w); d -= vl.depth * (1 - t * t); }
      for (const dn of p.dents) {
        const du = u - dn.u, dv = v - dn.v;
        const r2 = (du * du + dv * dv) / (dn.r * dn.r);
        if (r2 < 9) d -= dn.depth * Math.exp(-r2);
      }
      arr[i * 3] = u;
      arr[i * 3 + 1] = y0 + d;
      arr[i * 3 + 2] = v;
    }
    posA.needsUpdate = true;
    p.geo.computeVertexNormals();
    p.geo.computeBoundingSphere();
  };
  CB.press = function (p, u, v) {
    const d = { u, v, r: 0.6, rMax: 3.2, depth: 0, target: 0.32, release: false };
    p.dents.push(d);
    if (p.dents.length > 4) p.dents.shift();
    return d;
  };
  CB.releaseAll = function (p) { for (const d of p.dents) d.release = true; };
  CB.kick = function (p, amount) { p.bounceV += amount; p.dirty = true; };

  // 折り筋の外側を埋める扇形（板の角度に合わせて開く）
  CB.makeCrease = function (u0, u1) {
    const seg = 6;
    const nV = (seg + 2) * 2;
    const pos = new Float32Array(nV * 3);
    const idx = [];
    // 頂点 0..seg: 端 u0 の弧、seg+1: u0 の中心。同様に u1 側。
    const A = 0, B = seg + 2;
    for (let k = 0; k < seg; k++) {
      // 曲面
      idx.push(A + k, A + k + 1, B + k + 1, A + k, B + k + 1, B + k);
      // 両端のふた
      idx.push(A + seg + 1, A + k + 1, A + k);
      idx.push(B + seg + 1, B + k, B + k + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, CB.creaseMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const c = { mesh, geo, seg, u0, u1, last: -1 };
    CB.setCrease(c, 0.0001);
    return c;
  };
  CB.setCrease = function (c, theta) {
    if (Math.abs(theta - c.last) < 1e-4) return;
    c.last = theta;
    const pos = c.geo.attributes.position.array, seg = c.seg;
    for (let side = 0; side < 2; side++) {
      const off = side * (seg + 2) * 3, u = side ? c.u1 : c.u0;
      for (let k = 0; k <= seg; k++) {
        const phi = (k / seg) * theta;
        pos[off + k * 3] = u;
        pos[off + k * 3 + 1] = -Math.cos(phi) * T;
        pos[off + k * 3 + 2] = Math.sin(phi) * T;
      }
      pos[off + (seg + 1) * 3] = u; pos[off + (seg + 1) * 3 + 1] = 0; pos[off + (seg + 1) * 3 + 2] = 0;
    }
    c.geo.attributes.position.needsUpdate = true;
    c.geo.computeVertexNormals();
    c.geo.computeBoundingSphere();
  };

  // 押し筋（表に見える浅い溝）
  CB.makeScore = function (u0, u1) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(u1 - u0, 0.03, 0.16), CB.creaseMat);
    m.position.set((u0 + u1) / 2, 0.005, 0);
    m.receiveShadow = true;
    return m;
  };

  // 小さな耳（差し込みのタブ）
  CB.makeTab = function (w, l) {
    const p = CB.makePanel({ u0: -w / 2, u1: w / 2, v0: 0, v1: l, step: 0.25, mask: (u, v) => {
      // 先を丸めた形
      const t = v / l; return Math.abs(u) < (w / 2) * (t < 0.6 ? 1 : 1 - (t - 0.6) * 1.1);
    } });
    return p;
  };

  // ハイライト（光らせる）
  CB.setGlow = function (p, k) {
    const c = 0.16 * k;
    p.fm.emissive.setRGB(c * 1.0, c * 0.82, c * 0.45);
    p.em.emissive.setRGB(c * 0.8, c * 0.6, c * 0.3);
  };
})();
