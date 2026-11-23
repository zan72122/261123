/* kit.js — 卓上の道具：台座・角筒・口枠と格子・切り糸のつまみ・押し棒・濡れ板と角寒天・木盆・片口・さじ */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;
  const K = (G.kit = { proxies: [], blocks: [] });

  // 物ごとに材質を複製（光らせるヒントを一つの物だけに当てるため）
  G.ownMats = function (obj) {
    obj.traverse((o) => {
      if (o.isMesh && o.material && !o.userData.sharedMat) {
        o.material = o.material.clone();
        if (o.material.map) o.material.map = o.material.map; // 共有のまま
      }
    });
    return obj;
  };

  function proxy(geo, kind, ref, parent) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.userData.kind = kind; m.userData.ref = ref;
    m.castShadow = false; m.receiveShadow = false;
    (parent || ref.group || ref).add(m);
    K.proxies.push(m);
    return m;
  }
  K.proxy = proxy;

  const RB = (w, h, d, r, k) => G.geom.roundBox(w, h, d, r, k);
  const mesh = (g, m, x, y, z, cast, recv) => G.geom.mesh(g, m, x, y, z, cast, recv);

  K.build = function (scene) {
    const mats = G.world.mats;
    K.scene = scene;
    buildBase(scene, mats);
    buildTube(scene, mats);
    buildFrame(scene, mats);
    buildRod(scene, mats);
    buildBoard(scene, mats);
    buildTray(scene, mats);
    buildPitcher(scene, mats);
    buildSpoon(scene, mats);
  };

  // ---------------- 台座 ----------------
  function buildBase(scene, mats) {
    const g = new THREE.Group();
    const B = L.BASE;
    const cx = (B.x0 + B.x1) / 2, w = B.x1 - B.x0;
    g.add(mesh(RB(w + 1.4, 1.2, B.hz * 2 + 1.0, 0.3), mats.woodDark, cx, 0.6, 0));
    for (const ux of [B.x0 + 2.4, B.x1 - 2.8]) g.add(mesh(RB(2.2, 6.6, B.hz * 2 - 0.6, 0.25), mats.woodDark, ux, 4.5, 0));
    g.add(mesh(RB(w, 1.0, B.hz * 2 - 0.2, 0.25), mats.woodDark, cx, 8.3, 0));
    for (const s of [-1, 1]) g.add(mesh(RB(w - 2, 2.0, 0.9, 0.25), mats.woodDark, cx, 9.8, s * 3.65));
    scene.add(g);
    K.base = g;
  }

  // ---------------- 角筒（上面に細長い透明窓） ----------------
  function buildTube(scene, mats) {
    const T = L.TUBE;
    const g = new THREE.Group();
    const len = T.x1 - T.x0, cx = (T.x0 + T.x1) / 2;
    const wall = (T.outer - T.inner) / 2; // 0.7
    const hi = T.inner / 2, ho = T.outer / 2;
    const m = mats.woodTube;
    g.add(mesh(RB(len, wall, T.outer, 0.12, 2), m, cx, T.y - hi - wall / 2, 0));
    for (const s of [-1, 1]) g.add(mesh(RB(len, T.inner, wall, 0.12, 2), m, cx, T.y, s * (hi + wall / 2)));
    const ty = T.y + hi + wall / 2;
    const sw = T.slotW / 2;
    g.add(mesh(RB(T.slotX0 - T.x0, wall, T.outer, 0.12, 2), m, (T.x0 + T.slotX0) / 2, ty, 0));
    g.add(mesh(RB(T.x1 - T.slotX1, wall, T.outer, 0.12, 2), m, (T.x1 + T.slotX1) / 2, ty, 0));
    for (const s of [-1, 1]) g.add(mesh(RB(T.slotX1 - T.slotX0, wall, ho - sw, 0.1, 2), m, 0, ty, s * (sw + (ho - sw) / 2)));
    const acr = mesh(new THREE.BoxGeometry(T.slotX1 - T.slotX0, 0.42, T.slotW), mats.acrylic, 0, ty + 0.06, 0, false, false);
    acr.renderOrder = 5;
    g.add(acr);
    // 入口の面取りの枠
    const ci = 2.5, co = 3.1, cr = 3.7, x0 = T.x0, x1 = T.x0 - 0.9;
    const pieceCorners = [
      [x0, ci, -ci], [x0, ci, ci], [x0, cr, cr], [x0, cr, -cr],
      [x1, co, -co], [x1, co, co], [x1, cr, cr], [x1, cr, -cr],
    ];
    const pg = G.geom.hexa(pieceCorners);
    for (let k = 0; k < 4; k++) {
      const gg = pg.clone();
      gg.rotateX(k * Math.PI / 2);
      gg.translate(0, T.y, 0);
      g.add(mesh(gg, m, 0, 0, 0));
    }
    // 出口の溝（口枠が上から差し込まれる）
    for (const s of [-1, 1]) {
      g.add(mesh(RB(1.0, 8.4, 0.85, 0.15), mats.woodDark, 10.45, 12.5, s * 4.075));
      g.add(mesh(RB(0.9, 6.2, 0.6, 0.1), mats.woodDark, 9.6, 12.0, s * 3.5));
    }
    g.add(mesh(RB(0.85, 0.6, 9.0, 0.12), mats.woodDark, 10.4, 8.1, 0));
    // 筒の内側の暗い底面（窓越しの奥行き）
    const inner = mesh(new THREE.BoxGeometry(len, 0.02, T.inner), new THREE.MeshStandardMaterial({ color: 0xcdb48e, roughness: 0.8 }), cx, T.y - hi + 0.01, 0, false, true);
    g.add(inner);
    scene.add(g);
    K.tube = g;
  }

  // ---------------- 口枠・格子・切り糸 ----------------
  function buildFrame(scene, mats) {
    const F = L.FRAME;
    const fr = { group: new THREE.Group(), seat: 0, seatV: 0, seated: false, slider: new THREE.Group(), knobZ: -L.KNOB_Z, tremble: 0 };
    const g = fr.group;
    const xc = (F.x0 + F.x1) / 2, th = F.x1 - F.x0;
    const y = L.TUBE.y, hs = F.size / 2, ho = L.TUBE.inner / 2, bw = hs - ho;
    const wood = mats.woodLight;
    g.add(mesh(RB(th, bw, F.size, 0.12, 2), wood, xc, y + ho + bw / 2, 0));
    g.add(mesh(RB(th, bw, F.size, 0.12, 2), wood, xc, y - ho - bw / 2, 0));
    for (const s of [-1, 1]) g.add(mesh(RB(th, L.TUBE.inner, bw, 0.12, 2), wood, xc, y, s * (ho + bw / 2)));
    const wt = L.WIRE_T;
    for (let k = 1; k < L.GRID_N; k++) {
      const off = (k - L.GRID_N / 2) * L.GRID_PITCH;
      const v = mesh(new THREE.BoxGeometry(wt, L.TUBE.inner, wt), mats.wire, F.x1 - 0.12, y, off);
      v.userData.sharedMat = true; g.add(v);
      const h = mesh(new THREE.BoxGeometry(wt, wt, L.TUBE.inner), mats.wire, F.x1 - 0.12, y + off, 0);
      h.userData.sharedMat = true; g.add(h);
    }
    // 切り糸のレール（口枠の前面、上下）
    const rx = L.CUT_X;
    g.add(mesh(RB(0.5, 0.45, 9.2, 0.12), mats.woodDark, rx, y + hs + 0.22, 0));
    g.add(mesh(RB(0.5, 0.4, 9.2, 0.12), mats.woodDark, rx, y - hs - 0.2, 0));
    // スライダーと木のつまみ
    const sl = fr.slider;
    sl.add(mesh(RB(0.8, 0.6, 1.1, 0.15), mats.woodDark, rx, y + hs + 0.75, 0));
    const knob = mesh(new THREE.SphereGeometry(0.85, 20, 14), mats.woodLight, rx, y + hs + 1.75, 0);
    knob.scale.set(1, 0.85, 1);
    sl.add(knob);
    const wire = mesh(new THREE.CylinderGeometry(0.045, 0.045, F.size, 6), mats.thread, rx, y, 0, true, false);
    sl.add(wire);
    sl.add(mesh(new THREE.SphereGeometry(0.24, 10, 8), mats.woodDark, rx, y - hs - 0.5, 0));
    sl.position.z = fr.knobZ;
    g.add(sl);
    fr.knob = knob; fr.wire = wire;
    G.ownMats(g);
    g.position.y = F.raise;
    scene.add(g);
    // つまみ用の大きめの当たり判定
    fr.knobRef = { group: sl, kind: 'knob' };
    proxy(new THREE.BoxGeometry(2.4, 3.2, 2.8), 'knob', fr.knobRef, sl).position.set(rx + 0.3, y + hs + 1.4, 0);
    // 口枠の当たり判定（最初のタップ）
    proxy(new THREE.BoxGeometry(3.4, F.size + 3, F.size + 2.6), 'frame', fr, g).position.set(xc + 0.5, y + 0.5, 0);
    K.frame = fr;
  }

  K.updateFrame = function (dt) {
    const fr = K.frame;
    if (fr.seating) {
      fr.seatT += dt;
      const t = Math.min(1, fr.seatT / 0.42);
      const e = t < 1 ? 1 - Math.pow(1 - t, 2.4) : 1;
      fr.seat = e;
      if (t >= 1 && !fr.seated) {
        fr.seated = true; fr.seating = false; fr.bounce = 1;
        if (fr.onSeat) fr.onSeat();
      }
    }
    if (fr.bounce > 0) fr.bounce = Math.max(0, fr.bounce - dt * 5);
    const bump = fr.bounce > 0 ? Math.sin(fr.bounce * 18) * 0.06 * fr.bounce : 0;
    fr.group.position.y = (1 - fr.seat) * L.FRAME.raise + bump;
    fr.slider.position.z = fr.knobZ + (fr.hintOff || 0);
    // 切り糸のかすかな震え
    if (fr.tremble > 0) {
      fr.tremble = Math.max(0, fr.tremble - dt * 2.5);
      fr.wire.position.x = L.CUT_X + Math.sin(G.time * 80) * 0.05 * fr.tremble;
    }
  };

  // ---------------- 押し棒 ----------------
  function buildRod(scene, mats) {
    const R = L.ROD;
    const rod = { group: new THREE.Group(), x: 0, state: 'rest' };
    const g = rod.group;
    g.add(mesh(RB(R.headT, R.headS, R.headS, 0.22, 2), mats.woodLight, -R.headT / 2, 0, 0));
    g.add(mesh(RB(R.shaftLen, R.shaftS, R.shaftS, 0.3, 2), mats.woodLight, -R.headT - R.shaftLen / 2, 0, 0));
    const hg = new THREE.CapsuleGeometry(R.handleR, R.handleLen - R.handleR * 2 + 0.6, 6, 16);
    hg.rotateZ(Math.PI / 2);
    g.add(mesh(hg, mats.woodDark, -R.headT - R.shaftLen - R.handleLen / 2 + 0.3, 0, 0));
    G.ownMats(g);
    rod.len = R.headT + R.shaftLen + R.handleLen;
    // 当たり判定：棒全体をやや太く
    proxy(new THREE.BoxGeometry(rod.len + 2, 6.2, 6.2), 'rod', rod, g).position.set(-rod.len / 2, 0, 0);
    scene.add(g);
    // 卓上の棒受け
    const rest = mesh(RB(2.4, 1.55, 3.4, 0.3), mats.woodDark, L.ROD_REST.x - 12, 0.78, L.ROD_REST.z);
    scene.add(rest);
    rod.restPos = new THREE.Vector3(L.ROD_REST.x, L.ROD.headS / 2, L.ROD_REST.z);
    g.position.copy(rod.restPos);
    K.rod = rod;
  }

  // ---------------- 濡れた板と角寒天 ----------------
  function buildBoard(scene, mats) {
    const B = L.BOARD;
    const bm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3 });
    if (mats.board.map) bm.map = mats.board.map;
    const board = mesh(RB(B.x1 - B.x0, B.t, B.z1 - B.z0, 0.3, 2), bm, (B.x0 + B.x1) / 2, B.t / 2, (B.z0 + B.z1) / 2);
    scene.add(board);
    K.board = board;
    L.BLOCK_SPOTS.forEach((sp, i) => {
      const wet = mesh(new THREE.BoxGeometry(L.BLOCK.len + 0.4, 0.02, L.BLOCK.size + 0.4), mats.boardWet.clone(), sp.x, B.t + 0.012, sp.z, false, false);
      wet.renderOrder = 2;
      scene.add(wet);
      const blk = new Block(i, sp, wet);
      scene.add(blk.group);
      K.blocks.push(blk);
    });
  }

  class Block {
    constructor(i, spot, wet) {
      const S = L.BLOCK.size;
      this.i = i; this.spot = spot; this.wet = wet; this.wetT = 0;
      this.kind = 'block';
      this.len0 = L.BLOCK.len; this.Lr = this.len0;
      this.dent = 0; this.squash = 0; this.wob = 0; this.wobV = 0; this.wobZ = 0; this.wobZV = 0;
      this.state = 'board';
      this.group = new THREE.Group();
      const N = 9, NY = 5;
      const geo = new THREE.BoxGeometry(1, 1, 1, N, NY, NY);
      const p = geo.attributes.position;
      this.idx = new Int16Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        this.idx[k * 3] = Math.round((p.getX(k) + 0.5) * N);
        this.idx[k * 3 + 1] = Math.round((p.getY(k) + 0.5) * NY);
        this.idx[k * 3 + 2] = Math.round((p.getZ(k) + 0.5) * NY);
      }
      this.N = N; this.NY = NY;
      this.n0 = Float32Array.from(geo.attributes.normal.array);
      this.geo = geo;
      this.mesh = new THREE.Mesh(geo, G.world.mats.agar.clone());
      this.mesh.castShadow = false; this.mesh.receiveShadow = false;
      this.group.add(this.mesh);
      // 閉じ込められた小さな気泡
      const rng = G.rand;
      this.bubbles = [];
      const nb = 4 + Math.floor(rng() * 5);
      for (let k = 0; k < nb; k++) {
        this.bubbles.push({ d: 1.2 + rng() * (this.len0 - 2), y: (rng() - 0.5) * (S - 1.2), z: (rng() - 0.5) * (S - 1.2), r: 0.05 + rng() * 0.12, rare: false, done: false });
      }
      if (rng() < 0.38) {
        const h = Math.floor(rng() * 16);
        this.bubbles.push({ d: 0.5 + rng() * 0.7, y: L.holeY(h) - L.TUBE.y, z: L.holeZ(h), r: 0.09, rare: true, hole: h, done: false });
      }
      const bg = new THREE.SphereGeometry(1, 10, 8);
      this.bmesh = new THREE.InstancedMesh(bg, G.world.mats.bubble, this.bubbles.length);
      this.bmesh.castShadow = false;
      this.bmesh.userData.sharedMat = true;
      this.group.add(this.bmesh);
      this.home();
      this.updateGeom();
      proxy(new THREE.BoxGeometry(1, S + 1.6, S + 0.7), 'block', this, this.group);
      this.proxyMesh = K.proxies[K.proxies.length - 1];
    }
    homePos() { return new THREE.Vector3(this.spot.x + this.len0 / 2, L.BOARD.t + L.BLOCK.size / 2, this.spot.z); }
    home() { this.group.position.copy(this.homePos()); this.group.rotation.set(0, 0, 0); }
    consumed() { return this.len0 - this.Lr; }
    updateGeom() {
      const S = L.BLOCK.size, Lr = Math.max(0.0, this.Lr);
      const p = this.geo.attributes.position, nrm = this.geo.attributes.normal;
      const visible = Lr > 0.04;
      this.mesh.visible = visible;
      if (this.proxyMesh) { this.proxyMesh.scale.x = Math.max(1, Lr + 2); this.proxyMesh.position.x = -Lr / 2; }
      if (!visible) { this.bmesh.visible = false; return; }
      const r = Math.min(0.42, Lr / 2 - 0.005, S / 2 - 0.01);
      const N = this.N, NY = this.NY;
      const map = (i, n, half) => {
        // 0..n の分割 → 辺に寄せた座標
        if (i === 0) return -half;
        if (i === n) return half;
        if (i === 1) return -half + r;
        if (i === n - 1) return half - r;
        return -half + r + (2 * half - 2 * r) * (i - 1) / (n - 2);
      };
      const hx = Lr / 2, hy = S / 2;
      const sq = this.squash, dent = this.dent;
      const sx = 1 - 0.07 * sq, syz = 1 + 0.035 * sq;
      for (let k = 0; k < p.count; k++) {
        let x = map(this.idx[k * 3], N, hx), y = map(this.idx[k * 3 + 1], NY, hy), z = map(this.idx[k * 3 + 2], NY, hy);
        const ix = Math.max(-hx + r, Math.min(hx - r, x)), iy = Math.max(-hy + r, Math.min(hy - r, y)), iz = Math.max(-hy + r, Math.min(hy - r, z));
        let nx = x - ix, ny = y - iy, nz = z - iz;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl > 1e-6) { nx /= nl; ny /= nl; nz /= nl; x = ix + nx * r; y = iy + ny * r; z = iz + nz * r; }
        else { nx = this.n0[k * 3]; ny = this.n0[k * 3 + 1]; nz = this.n0[k * 3 + 2]; }
        // 原点を前面に：x ∈ [-Lr, 0]
        let X = x - hx;
        // 棒が当たる背面のへこみ
        const back = Math.max(0, 1 - (X + Lr) / 1.6);
        if (dent > 0 && back > 0) {
          const fy = Math.max(0, 1 - Math.pow(y / hy, 4)), fz = Math.max(0, 1 - Math.pow(z / hy, 4));
          X += dent * back * (0.35 + 0.65 * fy * fz);
          y *= 1 + dent * 0.05 * back; z *= 1 + dent * 0.05 * back;
        }
        // ぷるっとした揺れ
        const tt = (X + Lr) / Math.max(1, Lr);
        X += this.wob * (y / hy) * 0.6;
        y += this.wob * Math.sin(tt * Math.PI) * 0.25;
        z += this.wobZ * (y / hy) * 0.4 * (1 - tt);
        p.setXYZ(k, X * sx, y * syz, z * syz);
        nrm.setXYZ(k, nx, ny, nz);
      }
      p.needsUpdate = true; nrm.needsUpdate = true;
      if (!this.geo.boundingSphere) this.geo.computeBoundingSphere();
      this.geo.boundingSphere.center.set(-Lr / 2, 0, 0); this.geo.boundingSphere.radius = Lr / 2 + S;
      // 気泡
      const c = this.consumed();
      const mtx = new THREE.Matrix4();
      let anyVis = false;
      for (let k = 0; k < this.bubbles.length; k++) {
        const b = this.bubbles[k];
        const lx = -(b.d - c);
        if (b.d <= c + 0.05) {
          mtx.makeScale(0, 0, 0);
          if (!b.done) { b.done = true; if (b.rare && K.onRareBubble) K.onRareBubble(b.hole); }
        } else {
          mtx.makeScale(b.r, b.r * 0.85, b.r).setPosition(lx * sx, b.y * syz, b.z * syz);
          anyVis = true;
        }
        this.bmesh.setMatrixAt(k, mtx);
      }
      this.bmesh.instanceMatrix.needsUpdate = true;
      this.bmesh.visible = anyVis;
    }
    update(dt) {
      // 揺れのバネ
      const k = 260, d = 7;
      this.wobV += (-k * this.wob - d * this.wobV) * dt; this.wob += this.wobV * dt;
      this.wobZV += (-k * this.wobZ - d * this.wobZV) * dt; this.wobZ += this.wobZV * dt;
      if (this.state !== 'board') {
        this.wetT = Math.min(1, this.wetT + dt * 1.6);
      }
      this.wet.material.opacity = 0.5 * M.smooth(this.wetT);
      this.wet.visible = this.wetT > 0;
      // 形が変わった時だけ作り直す
      const key = this.Lr.toFixed(3) + '|' + this.dent.toFixed(3) + '|' + this.squash.toFixed(3) + '|' + this.wob.toFixed(3) + '|' + this.wobZ.toFixed(3);
      if (key !== this.geoKey) { this.geoKey = key; this.updateGeom(); }
    }
  }
  K.Block = Block;

  // ---------------- 木盆（手前と奥に丸いくぼみ） ----------------
  function buildTray(scene, mats) {
    const T = L.TRAY;
    const g = new THREE.Group();
    const tm = mats.tray.clone();
    if (tm.map) { tm.map = tm.map.clone(); tm.map.needsUpdate = true; tm.map.repeat.set(0.045, 0.045); }
    const rect = (x0, z0, x1, z1, r) => {
      const s = new THREE.Shape();
      // shape 座標: (x, -z)
      s.moveTo(x0 + r, -z0);
      s.lineTo(x1 - r, -z0); s.quadraticCurveTo(x1, -z0, x1, -z0 - r);
      s.lineTo(x1, -z1 + r); s.quadraticCurveTo(x1, -z1, x1 - r, -z1);
      s.lineTo(x0 + r, -z1); s.quadraticCurveTo(x0, -z1, x0, -z1 + r);
      s.lineTo(x0, -z0 - r); s.quadraticCurveTo(x0, -z0, x0 + r, -z0);
      return s;
    };
    const lower = new THREE.ExtrudeGeometry(rect(T.x0, T.z0, T.x1, T.z1, 2.2), { depth: T.floorY - 0.3, bevelEnabled: false, curveSegments: 6 });
    lower.rotateX(-Math.PI / 2);
    g.add(mesh(lower, tm, 0, 0, 0));
    const top = rect(T.x0 + 0.2, T.z0 + 0.2, T.x1 - 0.2, T.z1 - 0.2, 2.0);
    for (const R of [L.FRONT, L.BACK]) {
      const h = new THREE.Path();
      h.absarc(R.x, -R.z, R.r, 0, Math.PI * 2, true);
      top.holes.push(h);
    }
    const upper = new THREE.ExtrudeGeometry(top, { depth: 0.3, bevelEnabled: false, curveSegments: 40 });
    upper.rotateX(-Math.PI / 2);
    upper.translate(0, T.floorY - 0.3, 0);
    g.add(mesh(upper, tm, 0, 0, 0));
    // 縁
    const rw = T.rimW, rh = T.rimTop;
    g.add(mesh(RB(T.x1 - T.x0, rh, rw, 0.3, 2), tm, (T.x0 + T.x1) / 2, rh / 2, T.z0 + rw / 2));
    g.add(mesh(RB(T.x1 - T.x0, rh, rw, 0.3, 2), tm, (T.x0 + T.x1) / 2, rh / 2, T.z1 - rw / 2));
    g.add(mesh(RB(rw, rh, T.z1 - T.z0, 0.3, 2), tm, T.x0 + rw / 2, rh / 2, (T.z0 + T.z1) / 2));
    g.add(mesh(RB(rw, rh, T.z1 - T.z0, 0.3, 2), tm, T.x1 - rw / 2, rh / 2, (T.z0 + T.z1) / 2));
    scene.add(g);
    K.tray = g;
    // ごま入れの小鉢
    const SD = L.SESAME_DISH;
    const sdm = new THREE.MeshPhysicalMaterial({ color: 0x51606e, roughness: 0.3, clearcoat: 0.7 });
    const dish = mesh(G.geom.smallBowl(2.3, 1.3), sdm, SD.x, T.floorY, SD.z);
    scene.add(dish);
    const sg = G.geom.sesame();
    const n = 70;
    const im = new THREE.InstancedMesh(sg, mats.sesame, n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const rng = G.makeRng(G.seed + 7);
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.283, rr = Math.sqrt(rng()) * 1.45;
      const hgt = 0.38 + (1 - rr / 1.5) * 0.45 + rng() * 0.08;
      v.set(SD.x + Math.cos(a) * rr, T.floorY + hgt, SD.z + Math.sin(a) * rr);
      e.set((rng() - 0.5) * 1.2, rng() * 6.283, (rng() - 0.5) * 1.2); q.setFromEuler(e);
      mtx.compose(v, q, s); im.setMatrixAt(i, mtx);
    }
    im.castShadow = true;
    scene.add(im);
    K.sesameDish = dish;
  }

  // ---------------- 片口 ----------------
  function buildPitcher(scene, mats) {
    const pg = G.geom.pitcher();
    const p = { group: new THREE.Group(), body: new THREE.Group(), kind: 'pitcher', tilt: 0, yaw: 0, lift: 0 };
    const sp = new THREE.MeshPhysicalMaterial({ color: 0x6f4a33, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
    p.body.add(mesh(pg.body, mats.pitcher, 0, 0, 0));
    p.body.add(mesh(pg.spout, sp, 0, 0, 0));
    // 中のつゆ（いつも水平に保つ）
    p.liquid = mesh(new THREE.CircleGeometry(2.55, 28), mats.tsuyu, 0, 0, 0, false, true);
    p.liquid.rotation.x = -Math.PI / 2;
    p.liquid.userData.sharedMat = true;
    p.body.add(p.liquid);
    p.liquidY = 3.6;
    p.group.add(p.body);
    G.ownMats(p.group);
    p.spoutTip = pg.spoutTip.clone();
    p.H = pg.H; p.R = pg.R;
    p.rest = new THREE.Vector3(L.PITCHER.x, L.TRAY.floorY, L.PITCHER.z);
    p.group.position.copy(p.rest);
    p.restYaw = Math.atan2(-(L.FRONT.z - L.PITCHER.z), L.FRONT.x - L.PITCHER.x);
    p.yaw = p.restYaw;
    p.group.rotation.y = p.yaw;
    proxy(new THREE.CylinderGeometry(4.6, 4.6, 7.6, 12), 'pitcher', p, p.group).position.set(0.8, 3.2, 0);
    scene.add(p.group);
    K.pitcher = p;
  }

  // ---------------- 木さじ ----------------
  function buildSpoon(scene, mats) {
    const sg = G.geom.spoon();
    const s = { group: new THREE.Group(), body: new THREE.Group(), kind: 'spoon', tilt: 0, lift: 0 };
    s.body.add(mesh(sg.bowl, mats.woodLight, 0, 0, 0));
    s.body.add(mesh(sg.handle, mats.woodLight, 0, 0, 0));
    s.group.add(s.body);
    G.ownMats(s.group);
    s.restYaw = -0.5;
    s.rest = new THREE.Vector3(L.SPOON.x, L.TRAY.floorY + 0.58, L.SPOON.z);
    s.group.position.copy(s.rest);
    s.group.rotation.y = s.restYaw;
    proxy(new THREE.BoxGeometry(5.2, 3.6, 12.5), 'spoon', s, s.group).position.set(0, 0.6, 3.6);
    scene.add(s.group);
    K.spoon = s;
  }
})();
