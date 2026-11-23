// crane_parts.js — クレーンの部品の形：横桟（断面に波目の見える角筒）、台車と滑車、二本爪のアーム
(function () {
  'use strict';
  const S = window.S23, D = S.DIM, CB = S.cardboard, T = D.T;
  const V3 = THREE.Vector3;
  const CP = (S.craneParts = {});

  // 厚紙の板（いちばん薄い軸が厚み。広い面はクラフト紙、ほかの面は切り口の波目）
  CP.slab = function (sx, sy, sz, mats) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const dims = [sx, sy, sz];
    const thin = dims.indexOf(Math.min(sx, sy, sz));
    const pos = g.attributes.position, uv = g.attributes.uv;
    const axes = [0, 1, 2];
    g.clearGroups();
    for (let f = 0; f < 6; f++) {
      const nAxis = Math.floor(f / 2);
      const inPlane = axes.filter((a) => a !== nAxis);
      const isBig = nAxis === thin;
      g.addGroup(f * 6, 6, isBig ? 0 : 1);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const c = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        if (isBig) uv.setXY(i, c[inPlane[0]] + 3.7, c[inPlane[1]] + 1.3);
        else {
          const along = inPlane[0] === thin ? inPlane[1] : inPlane[0];
          uv.setXY(i, c[along], (c[thin] + dims[thin] / 2) / dims[thin]);
        }
      }
    }
    const m = new THREE.Mesh(g, mats || [CP.face, CP.edge]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  CP.face = CB.faceMat();
  CP.edge = CB.edgeMat();

  // 折れ線を太らせた輪郭（爪の形）
  function stripShape(pts, hw) {
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const w = typeof hw === 'function' ? hw(i / (pts.length - 1)) : hw;
      L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      R.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    const sh = new THREE.Shape();
    sh.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < L.length; i++) sh.lineTo(L[i][0], L[i][1]);
    // 先は丸く
    const e = pts[pts.length - 1];
    sh.quadraticCurveTo(e[0] + (L[L.length - 1][0] - e[0]) * 0 + 0.25, e[1] + 0.02, R[R.length - 1][0], R[R.length - 1][1]);
    for (let i = R.length - 2; i >= 0; i--) sh.lineTo(R[i][0], R[i][1]);
    sh.closePath();
    return sh;
  }
  const extrudeEdge = new THREE.MeshStandardMaterial({ map: S.TX.flute().clone(), roughness: 0.92 });
  extrudeEdge.map.repeat.set(1 / 0.62, 1 / T);
  extrudeEdge.map.needsUpdate = true;

  // ---- 横桟 ----
  CP.makeBar = function () {
    const L = D.BAR_LEN, s = D.BAR_SIZE;
    const g = new THREE.Group();
    const face = CB.faceMat(), edge = CB.edgeMat();
    const mats = [face, edge];
    const top = CP.slab(L, T, s, mats); top.position.y = s / 2 - T / 2; g.add(top);
    const bot = CP.slab(L, T, s, mats); bot.position.y = -s / 2 + T / 2; g.add(bot);
    const fr = CP.slab(L, s - 2 * T, T, mats); fr.position.z = s / 2 - T / 2; g.add(fr);
    const bk = CP.slab(L, s - 2 * T, T, mats); bk.position.z = -s / 2 + T / 2; g.add(bk);
    // 押し筋（角の折り目）
    for (const [y, z] of [[s / 2, s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [-s / 2, -s / 2]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.5, T * 0.5, L, 6), CB.creaseMat);
      c.rotation.z = Math.PI / 2; c.position.set(0, y - Math.sign(y) * T * 0.5, z - Math.sign(z) * T * 0.5);
      g.add(c);
    }
    const bar = { group: g, face, edge, meshes: [top, bot, fr, bk] };
    return bar;
  };

  // ---- 台車と滑車 ----
  CP.makeTrolley = function () {
    const g = new THREE.Group();
    const s = D.BAR_SIZE;
    const face = CB.faceMat(), edge = CB.edgeMat();
    const mats = [face, edge];
    const w = 3.4;
    const top = CP.slab(w, T, s + 1.2, mats); top.position.set(0, s / 2 + T / 2, 0); g.add(top);
    const chF = CP.slab(w, s + 0.9, T, mats); chF.position.set(0, -0.25, s / 2 + T / 2 + 0.05); g.add(chF);
    const chB = CP.slab(w, s + 0.9, T, mats); chB.position.set(0, -0.25, -s / 2 - T / 2 - 0.05); g.add(chB);
    // 掛け釘（アームのつりひもを掛ける）
    const pegMat = new THREE.MeshStandardMaterial({ color: 0xb8875a, roughness: 0.8 });
    const pegs = [];
    for (const sx of [-1, 1]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.9, 8), pegMat);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(sx * 1.15, -s / 2 - 0.45, s / 2 + T + 0.45);
      peg.castShadow = true;
      g.add(peg); pegs.push(peg);
    }
    // 前へ張り出す腕
    const z0 = s / 2, z1 = D.LOOP_Z - D.BAR_Z - 1.35;
    const brk = CP.slab(2.0, T, z1 - z0, mats); brk.position.set(0, s / 2 + T / 2, (z0 + z1) / 2); g.add(brk);
    // 後ろの小さな糸車（ひもが上へ曲がる）
    const spoolMat = new THREE.MeshStandardMaterial({ color: 0xd9b88e, roughness: 0.75, map: S.TX.kraft() });
    const yTop = s / 2 + T;
    const rearZ = D.ARM_Z - D.BAR_Z + 0.4;
    const rear = new THREE.Group();
    rear.position.set(0, yTop + 0.45, rearZ);
    const rs = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 14), spoolMat); rs.rotation.z = Math.PI / 2; rear.add(rs);
    for (const sx of [-1, 1]) {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 16), spoolMat); fl.rotation.z = Math.PI / 2; fl.position.x = sx * 0.62; rear.add(fl);
      const ch = CP.slab(T, 1.1, 1.1, mats); ch.position.set(sx * 0.9, -0.2, 0); rear.add(ch);
    }
    rear.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(rear);
    // 前の滑車（広い溝）
    const front = new THREE.Group();
    const frontZ = D.LOOP_Z - D.BAR_Z - 0.75;
    front.position.set(0, yTop + 0.1, frontZ);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.7, 20), spoolMat); hub.rotation.z = Math.PI / 2; front.add(hub);
    const flanges = [];
    for (const sx of [-1, 1]) {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.16, 24), spoolMat); fl.rotation.z = Math.PI / 2; fl.position.x = sx * 0.93; front.add(fl);
      flanges.push(fl);
      const ch = CP.slab(T, 1.0, 1.8, mats); ch.position.set(sx * 1.2, 0.05, -0.65); front.add(ch);
    }
    // 回っているのが見えるよう、溝の底に小さな切り欠き
    const notchMat = new THREE.MeshStandardMaterial({ color: 0x7b5634, roughness: 0.9 });
    const marks = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const n = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.18), notchMat);
      const a = (k / 4) * S.TAU;
      n.position.set(0, Math.cos(a) * 0.76, Math.sin(a) * 0.76); n.rotation.x = -a;
      marks.add(n);
    }
    front.add(marks);
    front.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(front);
    return { group: g, face, edge, pegs, rear, front, marks, frontZ, rearZ, yTop };
  };

  // ---- 二本爪のアーム ----
  // 爪の中心線（局所：下向き -y、外向き -x。右の爪は左右反転）
  CP.CLAW_LINE = [[0, 0], [-0.9, -2.0], [-1.3, -3.6], [-0.9, -5.2], [0, -6.6], [0.55, -6.55]];
  CP.makeArm = function () {
    const g = new THREE.Group();
    const face = CB.faceMat(), edge = CB.edgeMat();
    const mats = [face, edge];
    // 底の開いた箱
    const top = CP.slab(3.0, T, 3.4, mats); top.position.y = 0.7 - T / 2; g.add(top);
    const fr = CP.slab(3.0, 1.4, T, mats); fr.position.set(0, 0, 1.5); g.add(fr);
    const bk = CP.slab(3.0, 1.4, T, mats); bk.position.set(0, 0, -1.5); g.add(bk);
    for (const sx of [-1, 1]) { const sd = CP.slab(T, 1.0, 2.6, mats); sd.position.set(sx * 1.3, 0.1, 0); g.add(sd); }
    // 上端の留め具
    const stopMat = new THREE.MeshStandardMaterial({ color: 0x8e6740, roughness: 0.9 });
    const stop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 0.5), stopMat); stop.position.set(0, 0.32, 0); g.add(stop);
    // つりひもの輪を通す穴の補強
    const hooks = [];
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 12), stopMat);
      h.position.set(sx * 1.15, 0.78, 0); g.add(h); hooks.push(h);
    }
    // 引き板
    const plate = CP.slab(2.2, 0.35, 2.5, mats);
    g.add(plate);
    // 爪
    const claws = [];
    for (const side of [-1, 1]) {
      const piv = new THREE.Object3D();
      piv.position.set(side * D.PIVOT_X, D.PIVOT_Y, 0);
      g.add(piv);
      // 左の爪 (side=-1) はそのまま、右の爪は x を反転
      const line = CP.CLAW_LINE.map((p) => [side < 0 ? p[0] : -p[0], p[1]]);
      const sh = stripShape(line, (t) => 0.46 - t * 0.14);
      const eg = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 4 });
      const plates = [];
      for (const z of [-D.CLAW_W / 2, D.CLAW_W / 2 - T]) {
        const m = new THREE.Mesh(eg, [face, extrudeEdge]);
        m.position.z = z;
        m.castShadow = true; m.receiveShadow = true;
        piv.add(m); plates.push(m);
      }
      // 爪先の板と中ほどの渡し
      const tip = line[4], hook = line[5], knee = line[2];
      const pad = CP.slab(0.55, 0.45, D.CLAW_W, mats);
      pad.position.set((tip[0] + hook[0]) / 2, (tip[1] + hook[1]) / 2, 0);
      pad.rotation.z = Math.atan2(hook[1] - tip[1], hook[0] - tip[0]);
      piv.add(pad);
      const brace = CP.slab(0.5, 0.5, D.CLAW_W - 2 * T, mats);
      brace.position.set(knee[0] * 0.9, knee[1], 0);
      piv.add(brace);
      const brace2 = CP.slab(0.45, 0.45, D.CLAW_W - 2 * T, mats);
      brace2.position.set(line[1][0] * 0.8, line[1][1] + 0.3, 0);
      piv.add(brace2);
      claws.push({ side, piv, line, plates, pad });
    }
    return { group: g, face, edge, plate, claws, hooks };
  };

  // 2点を結ぶ細いひも（短いつなぎ用）
  CP.makeThread = function (radius, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), mat);
    m.castShadow = true;
    const up = new V3(0, 1, 0), d = new V3();
    m.userData.set = function (a, b) {
      d.copy(b).sub(a);
      const l = d.length();
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.set(1, Math.max(l, 1e-3), 1);
      if (l > 1e-5) m.quaternion.setFromUnitVectors(up, d.multiplyScalar(1 / l));
    };
    return m;
  };
})();
