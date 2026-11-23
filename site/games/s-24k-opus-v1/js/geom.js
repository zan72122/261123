/* geom.js — 形を作る小さな関数群（角の丸い箱・六面体・回転体の器・匙） */
(function () {
  'use strict';
  const G = window.G;
  const GE = (G.geom = {});

  // 角の丸い箱。辺の近くに分割を寄せてから半径 r で丸める。
  GE.roundBox = function (w, h, d, r, k) {
    k = k || 3;
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const N = 2 * k + 1;
    const g = new THREE.BoxGeometry(w, h, d, N, N, N);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const remap = (v, half) => {
      // 一様な格子位置 → 端に寄せた位置
      const i = Math.round((v / half + 1) / 2 * N);
      if (i <= k) return -half + r * (i / k);
      return half - r * ((N - i) / k);
    };
    const p = new THREE.Vector3(), inner = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.set(remap(pos.getX(i), hw), remap(pos.getY(i), hh), remap(pos.getZ(i), hd));
      inner.set(
        Math.max(-hw + r, Math.min(hw - r, p.x)),
        Math.max(-hh + r, Math.min(hh - r, p.y)),
        Math.max(-hd + r, Math.min(hd - r, p.z))
      );
      n.subVectors(p, inner);
      const len = n.length();
      if (len < 1e-6) n.set(nor.getX(i), nor.getY(i), nor.getZ(i)); else n.multiplyScalar(1 / len);
      p.copy(inner).addScaledVector(n, r);
      pos.setXYZ(i, p.x, p.y, p.z);
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
    return g;
  };

  // 8つの角から六面体（台形の柱など）。順序: 下面 a0..a3, 上面 b0..b3（同じ回り）
  GE.hexa = function (c) {
    const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    const pos = [];
    for (const f of faces) {
      const q = f.map((i) => c[i]);
      pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // 外向きにそろえる
    const ctr = [0, 0, 0];
    for (const v of c) { ctr[0] += v[0] / 8; ctr[1] += v[1] / 8; ctr[2] += v[2] / 8; }
    const P = g.attributes.position, Nn = g.attributes.normal;
    for (let t = 0; t < P.count; t += 3) {
      const mx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3 - ctr[0];
      const my = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3 - ctr[1];
      const mz = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3 - ctr[2];
      if (mx * Nn.getX(t) + my * Nn.getY(t) + mz * Nn.getZ(t) < 0) {
        // 三角形を裏返す
        const x1 = P.getX(t + 1), y1 = P.getY(t + 1), z1 = P.getZ(t + 1);
        P.setXYZ(t + 1, P.getX(t + 2), P.getY(t + 2), P.getZ(t + 2));
        P.setXYZ(t + 2, x1, y1, z1);
      }
    }
    g.computeVertexNormals();
    return g;
  };

  GE.mesh = function (geo, mat, x, y, z, cast, recv) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = cast !== false; m.receiveShadow = recv !== false;
    return m;
  };

  // 小皿（釉薬の面と、素地の高台を分けた回転体）
  GE.plate = function () {
    const P = G.L.PLATE;
    const glaze = [];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const r = (i / steps) * P.Rin;
      glaze.push(new THREE.Vector2(Math.max(r, 0.001), G.L.plateBase(r)));
    }
    glaze.push(new THREE.Vector2(P.Rin + 0.12, P.H + 0.02));
    glaze.push(new THREE.Vector2(P.R - 0.08, P.H + 0.05));
    glaze.push(new THREE.Vector2(P.R + 0.02, P.H - 0.06));
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const r = P.R + 0.02 - (P.R - 3.95) * t;
      const y = (P.H - 0.06) * (1 - t) * (1 - t * 0.25) + 0.42 * t;
      glaze.push(new THREE.Vector2(r, y));
    }
    // 回転体は外向き面が反時計回りになるよう、外側から内側の順に並べ替える
    const gGlaze = new THREE.LatheGeometry(glaze.reverse(), 72);
    const foot = [
      new THREE.Vector2(3.95, 0.42), new THREE.Vector2(3.82, 0.04), new THREE.Vector2(3.7, 0.0),
      new THREE.Vector2(3.3, 0.0), new THREE.Vector2(3.18, 0.08), new THREE.Vector2(3.1, 0.3),
      new THREE.Vector2(0.001, 0.32),
    ];
    const gFoot = new THREE.LatheGeometry(foot.reverse(), 48);
    return { glaze: gGlaze, foot: gFoot };
  };

  // 片口：碗の回転体＋注ぎ口のとい
  GE.pitcher = function () {
    const outer = [];
    const R = 3.5, H = 5.2;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      outer.push(new THREE.Vector2(2.2 + (R - 2.2) * Math.sin(t * Math.PI * 0.5), 0.3 + t * (H - 0.3)));
    }
    const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(2.1, 0), new THREE.Vector2(2.2, 0.3)];
    for (let i = 1; i < outer.length; i++) prof.push(outer[i]);
    prof.push(new THREE.Vector2(R - 0.12, H + 0.06));
    prof.push(new THREE.Vector2(R - 0.28, H - 0.05));
    for (let i = 11; i >= 0; i--) {
      const t = i / 12;
      prof.push(new THREE.Vector2(Math.max(0.001, 1.9 + (R - 0.3 - 1.9) * Math.sin(t * Math.PI * 0.5)), 0.6 + t * (H - 0.7)));
    }
    prof.push(new THREE.Vector2(0.001, 0.6));
    const body = new THREE.LatheGeometry(prof, 48);
    // 注ぎ口（+X 方向へ開いたとい）
    const spout = new THREE.BufferGeometry();
    const NU = 8, NV = 10;
    const pos = [], idx = [];
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      const rr = 1.15 * (1 - 0.45 * u);
      const cx = R - 0.5 + 1.9 * u, cy = H - 0.55 + 0.45 * u * u;
      for (let iv = 0; iv <= NV; iv++) {
        const v = iv / NV * Math.PI;
        pos.push(cx, cy - Math.sin(v) * rr * 0.75, Math.cos(v) * rr);
      }
    }
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
      const a = iu * (NV + 1) + iv, b = a + NV + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    spout.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    spout.setIndex(idx); spout.computeVertexNormals();
    return { body, spout, R, H, spoutTip: new THREE.Vector3(R + 1.4, H - 0.15, 0) };
  };

  // 小さな木さじ：楕円の皿＋柄。さじの先は -Z。
  GE.spoon = function () {
    const prof = [];
    const R = 1.5, D = 0.55;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push(new THREE.Vector2(Math.max(0.001, R * t), D * t * t - D + 0.0));
    }
    prof.push(new THREE.Vector2(R + 0.12, 0.08));
    for (let i = 10; i >= 0; i--) {
      const t = i / 10;
      prof.push(new THREE.Vector2(Math.max(0.001, (R - 0.05) * t), D * t * t - D + 0.12));
    }
    const bowl = new THREE.LatheGeometry(prof, 32);
    bowl.scale(1, 1, 1.35);
    const handle = GE.roundBox(0.55, 0.32, 7.2, 0.14, 2);
    handle.translate(0, 0.1, R * 1.35 + 3.4);
    handle.rotateX(-0.08);
    return { bowl, handle };
  };

  // 小鉢（ごま入れ）
  GE.smallBowl = function (R, H) {
    const prof = [
      new THREE.Vector2(0.001, 0), new THREE.Vector2(R * 0.55, 0), new THREE.Vector2(R * 0.6, 0.2),
      new THREE.Vector2(R * 0.92, H * 0.6), new THREE.Vector2(R, H), new THREE.Vector2(R - 0.15, H + 0.03),
      new THREE.Vector2(R * 0.82, H * 0.62), new THREE.Vector2(R * 0.5, 0.35), new THREE.Vector2(0.001, 0.32),
    ];
    return new THREE.LatheGeometry(prof, 36);
  };

  // ごまの粒（平たい涙形）
  GE.sesame = function () {
    const g = new THREE.SphereGeometry(0.16, 8, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const t = (z / 0.16 + 1) / 2;
      x *= 0.62 * (0.6 + 0.4 * t); y *= 0.32;
      z *= 1.0;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  };
})();
