/* strandmesh.js — 粒の鎖から、角の丸い四角断面の糸を掃引して作る。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L;

  const SUB = 2;                 // 粒の間を何分割するか
  const RING = 12;               // 断面の点の数（角ごとに3点）
  const MAXP = 150;
  const MAXR = (MAXP - 1) * SUB + 1;
  const CAPV = (RING + 1) * 2;
  const NV = CAPV + MAXR * RING;

  const SM = (G.strandMesh = { all: [] });

  // 断面（角の丸い正方形）
  const half = L.STRAND_W / 2, rc = 0.2;
  const SEC = [];
  for (let k = 0; k < 4; k++) {
    const cx = (k === 0 || k === 3) ? half - rc : -(half - rc);
    const cy = (k < 2) ? half - rc : -(half - rc);
    const a0 = k * Math.PI / 2;
    for (let j = 0; j < 3; j++) {
      const a = a0 + j * Math.PI / 4;
      const nx = Math.cos(a), ny = Math.sin(a);
      SEC.push([cx + nx * rc, cy + ny * rc, nx, ny]);
    }
  }

  let sharedIndex = null;
  function buildIndex() {
    const idx = [];
    // 先端のふた（0..RING）と根元のふた（RING+1..）
    for (let c = 0; c < 2; c++) {
      const base = c * (RING + 1);
      for (let k = 0; k < RING; k++) {
        const a = base + 1 + k, b = base + 1 + (k + 1) % RING;
        if (c === 0) idx.push(base, b, a); else idx.push(base, a, b);
      }
    }
    for (let r = 0; r < MAXR - 1; r++) {
      const a0 = CAPV + r * RING, b0 = a0 + RING;
      for (let k = 0; k < RING; k++) {
        const k1 = (k + 1) % RING;
        idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
      }
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }

  SM.create = function (chain) {
    if (!sharedIndex) sharedIndex = buildIndex();
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(sharedIndex);
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, G.world.mats.strand);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.userData.chain = chain;
    m.userData.sharedMat = true;
    G.strands.scene.add(m);
    // 気泡
    const b = new THREE.Mesh(SM.bubbleGeo || (SM.bubbleGeo = new THREE.SphereGeometry(0.11, 10, 8)), G.world.mats.bubble);
    b.visible = false; b.castShadow = false; b.userData.sharedMat = true;
    m.add(b);
    m.userData.bubble = b;
    SM.all.push(m);
    return m;
  };

  // 作業用
  const P = [], T = [], Nn = [], B = [];
  for (let i = 0; i < MAXR; i++) { P.push(new THREE.Vector3()); T.push(new THREE.Vector3()); Nn.push(new THREE.Vector3()); B.push(new THREE.Vector3()); }
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  function samplePath(c, useLocal) {
    const n = c.n;
    const X = useLocal ? c.lx : c.px, Y = useLocal ? c.ly : c.py, Z = useLocal ? c.lz : c.pz;
    let r = 0;
    if (n === 1) {
      P[0].set(X[0], Y[0], Z[0]);
      P[1].set(X[0] - 0.02, Y[0], Z[0]);
      return 2;
    }
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB, t2 = t * t, t3 = t2 * t;
        const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, cc = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
        P[r].set(
          a * X[i0] + b * X[i] + cc * X[i2] + d * X[i3],
          a * Y[i0] + b * Y[i] + cc * Y[i2] + d * Y[i3],
          a * Z[i0] + b * Z[i] + cc * Z[i2] + d * Z[i3]
        );
        r++;
      }
    }
    P[r].set(X[n - 1], Y[n - 1], Z[n - 1]); r++;
    return r;
  }

  // 根元（最後の点）から先へ平行移動で枠を運ぶ
  function frames(R, rooted) {
    for (let i = 0; i < R; i++) {
      if (i === 0) T[i].subVectors(P[0], P[1]);
      else if (i === R - 1) T[i].subVectors(P[R - 2], P[R - 1]);
      else T[i].subVectors(P[i - 1], P[i + 1]);
      if (T[i].lengthSq() < 1e-10) T[i].set(1, 0, 0);
      T[i].normalize();
    }
    // 根元の枠：上向きを基準に
    const e = R - 1;
    tmp.set(0, 1, 0);
    if (Math.abs(T[e].dot(tmp)) > 0.95) tmp.set(0, 0, 1);
    B[e].crossVectors(T[e], tmp).normalize();
    Nn[e].crossVectors(B[e], T[e]).normalize();
    for (let i = e - 1; i >= 0; i--) {
      // 前の枠を T[i] に合わせて回す
      tmp2.crossVectors(T[i + 1], T[i]);
      const s = tmp2.length();
      Nn[i].copy(Nn[i + 1]);
      if (s > 1e-6) {
        tmp2.multiplyScalar(1 / s);
        const ang = Math.atan2(s, T[i + 1].dot(T[i]));
        Nn[i].applyAxisAngle(tmp2, ang);
      }
      // 直交化
      Nn[i].addScaledVector(T[i], -Nn[i].dot(T[i])).normalize();
      B[i].crossVectors(T[i], Nn[i]);
    }
  }

  SM.build = function (c, useLocal) {
    const m = c.mesh;
    if (!m) return;
    const g = m.geometry;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const R = samplePath(c, useLocal);
    frames(R, c.rooted);
    let o = CAPV * 3;
    for (let r = 0; r < R; r++) {
      const p = P[r], nn = Nn[r], bb = B[r];
      for (let k = 0; k < RING; k++) {
        const s = SEC[k];
        pos[o] = p.x + nn.x * s[1] + bb.x * s[0];
        pos[o + 1] = p.y + nn.y * s[1] + bb.y * s[0];
        pos[o + 2] = p.z + nn.z * s[1] + bb.z * s[0];
        nor[o] = nn.x * s[3] + bb.x * s[2];
        nor[o + 1] = nn.y * s[3] + bb.y * s[2];
        nor[o + 2] = nn.z * s[3] + bb.z * s[2];
        o += 3;
      }
    }
    // ふた：先端（r=0）と根元（r=R-1）
    const bulge = c.rooted ? c.bulge : 0;
    for (let cap = 0; cap < 2; cap++) {
      const r = cap === 0 ? 0 : R - 1;
      const t = T[r];
      const sg = cap === 0 ? 1 : -1;
      let oc = cap * (RING + 1) * 3;
      const p = P[r];
      pos[oc] = p.x + t.x * sg * bulge; pos[oc + 1] = p.y + t.y * sg * bulge; pos[oc + 2] = p.z + t.z * sg * bulge;
      nor[oc] = t.x * sg; nor[oc + 1] = t.y * sg; nor[oc + 2] = t.z * sg;
      oc += 3;
      const ro = (CAPV + r * RING) * 3;
      for (let k = 0; k < RING; k++) {
        pos[oc] = pos[ro + k * 3]; pos[oc + 1] = pos[ro + k * 3 + 1]; pos[oc + 2] = pos[ro + k * 3 + 2];
        // 縁は側面と先の面の間の向き
        const w = bulge > 0.05 && cap === 0 ? 0.55 : 0.0;
        nor[oc] = t.x * sg * (1 - w) + nor[ro + k * 3] * w;
        nor[oc + 1] = t.y * sg * (1 - w) + nor[ro + k * 3 + 1] * w;
        nor[oc + 2] = t.z * sg * (1 - w) + nor[ro + k * 3 + 2] * w;
        oc += 3;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.setDrawRange(0, RING * 6 + (R - 1) * RING * 6);
    // 見えない長さ（出口の内側だけ）の時は隠す
    m.visible = !(c.rooted && c.e < 0.02);
    // 気泡の位置
    const bub = m.userData.bubble;
    if (bub) {
      if (c.bubble >= 0 && c.bubble < c.n) {
        const r = Math.min(R - 1, c.bubble * SUB);
        bub.visible = true;
        bub.position.copy(P[r]).addScaledVector(Nn[r], 0.12).addScaledVector(B[r], 0.08);
      } else bub.visible = false;
    }
    if (!g.boundingSphere) g.boundingSphere = new THREE.Sphere();
    g.boundingSphere.center.copy(P[Math.floor(R / 2)]);
    g.boundingSphere.radius = R * 0.4 + 2;
  };

  // 皿の座標で形を固定し、皿の子にする
  SM.attachToDish = function (c, dish) {
    const m = c.mesh;
    SM.build(c, true);
    if (m.parent) m.parent.remove(m);
    dish.group.add(m);
    m.frustumCulled = true;
  };
})();
