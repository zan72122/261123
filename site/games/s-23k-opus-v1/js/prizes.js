// prizes.js — 無地の包み：平たい四角い包み、両端をひねった短い筒、折り返しが片側に寄った小袋
// 形・しわ・折れ跡・物理の体をまとめて持つ。
(function () {
  'use strict';
  const S = window.S23, P = S.physics, W = S.world;
  const V3 = THREE.Vector3;
  const PR = (S.prizes = {});
  const list = (PR.list = []);

  const COLORS = [0xe9a798, 0xa9d6c3, 0xf1d68c, 0xaac8e7, 0xcbb4de, 0xf2c3a1, 0xf4b9c6, 0xbfd99a];

  function paperMat(color) {
    return new THREE.MeshStandardMaterial({
      color, map: S.TX.paper(), bumpMap: S.TX.paperBump(), bumpScale: 0.25,
      roughness: 0.72, metalness: 0, emissive: 0x000000,
    });
  }
  function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

  // ---- 形 ----
  function flatGeometry(a, h, b) {
    const g = new THREE.BoxGeometry(a, h, b, 18, 4, 18);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = Math.abs(x) / (a / 2), nz = Math.abs(z) / (b / 2), ny = Math.abs(y) / (h / 2);
      const m = Math.max(nx, nz);
      y *= 1 - 0.22 * Math.pow(m, 5);        // 端ほど薄く（柔らかな包み）
      const r = 1 - 0.035 * ny * ny;          // 角を丸める
      x *= r; z *= r;
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  function tubeGeometry(len, R) {
    const NA = 64, NR = 28;
    const half = len / 2;
    const pos = [], uv = [], idx = [];
    function radius(s, th) {
      const as = Math.abs(s);
      let r;
      if (as < 1.9) r = R;
      else if (as < 2.5) r = 0.32 + (R - 0.32) * (0.5 + 0.5 * Math.cos(((as - 1.9) / 0.6) * Math.PI));
      else if (as < 2.75) r = 0.32;
      else r = 0.32 + 0.4 * S.smooth((as - 2.75) / (half - 2.75));
      if (as > 1.95) {
        // ひねりのひだ
        const tw = Math.sign(s) * (as - 1.95) * 2.4;
        r *= 1 + 0.2 * S.smooth((as - 1.95) / 0.5) * Math.sin(7 * th + tw);
      }
      return r;
    }
    for (let i = 0; i <= NA; i++) {
      const s = -half + (i / NA) * len;
      for (let j = 0; j <= NR; j++) {
        const th = (j / NR) * S.TAU;
        const r = radius(s, th);
        pos.push(s, Math.cos(th) * r, Math.sin(th) * r);
        uv.push(s, th * R);
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    // 端のふた（ひだの奥）
    for (const side of [0, NA]) {
      const cIdx = pos.length / 3;
      const s = -half + (side / NA) * len;
      pos.push(s * 0.985, 0, 0); uv.push(s, 0);
      for (let j = 0; j < NR; j++) {
        const a = side * (NR + 1) + j;
        if (side === 0) idx.push(cIdx, a, a + 1); else idx.push(cIdx, a + 1, a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function bagGeometry(a, h, b) {
    const g = new THREE.BoxGeometry(a, h, b, 16, 6, 14);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = x / (a / 2), nz = z / (b / 2), ny = y / (h / 2);
      // ふくらんだ袋：縁ほど薄い
      const edge = Math.max(Math.abs(nx), Math.abs(nz));
      y *= 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - Math.pow(edge, 4)));
      const r = 1 - 0.06 * ny * ny;
      x *= r; z *= r * (1 - 0.03 * Math.abs(nx));
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---- 種類ごとの組み立て ----
  function buildFlat(color) {
    const a = 6.2, h = 1.2, b = 6.0;
    const mat = paperMat(color);
    const group = new THREE.Group();
    const geo = flatGeometry(a, h, b);
    const main = shadowed(new THREE.Mesh(geo, mat));
    group.add(main);
    // 両端の封の三角
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-b / 2 + 0.25, h / 2 - 0.12); sh.lineTo(b / 2 - 0.25, h / 2 - 0.12); sh.lineTo(0, -h / 2 + 0.25); sh.closePath();
      const tg = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false });
      const tm = shadowed(new THREE.Mesh(tg, mat));
      tm.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      tm.position.set(sx * (a / 2 * 0.965 + 0.01), 0, 0);
      group.add(tm);
    }
    // 片側の折り返し（上面の端に紙が一枚重なる）
    const fold = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, b * 0.94, 4, 1, 8), mat));
    fold.position.set(-a / 2 + 0.95, h / 2 - 0.02, 0);
    fold.rotation.z = -0.05;
    group.add(fold);
    const roll = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, b * 0.94, 8), mat));
    roll.rotation.x = Math.PI / 2;
    roll.position.set(-a / 2 + 1.6, h / 2 + 0.03, 0);
    group.add(roll);
    const spheres = [];
    for (const x of [-2.45, -0.82, 0.82, 2.45]) for (const z of [-2.3, -0.77, 0.77, 2.3]) spheres.push({ p: new V3(x, 0, z), r: 0.6 });
    for (const z of [-2.2, 0, 2.2]) spheres.push({ p: new V3(-a / 2 + 1.0, h / 2 + 0.05, z), r: 0.3, tag: 'fold' });
    return { kind: 'flat', group, main, geo, mat, spheres, mass: 30, size: new V3(a, h, b), mu: 0.5, rollDamp: 3.5, half: new V3(a / 2, h / 2, b / 2) };
  }
  function buildTube(color) {
    const len = 7.1, R = 1.0;
    const mat = paperMat(color);
    const group = new THREE.Group();
    const geo = tubeGeometry(len, R);
    const main = shadowed(new THREE.Mesh(geo, mat));
    group.add(main);
    // 巻き終わりの紙の重なり
    const seam = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 0.9), mat));
    seam.position.set(0, R * 0.985, 0.15);
    seam.rotation.x = 0.12;
    group.add(seam);
    const spheres = [];
    for (const x of [-1.6, -0.53, 0.53, 1.6]) spheres.push({ p: new V3(x, 0, 0), r: R });
    for (const sx of [-1, 1]) {
      spheres.push({ p: new V3(sx * 2.6, 0, 0), r: 0.36, e: 0.55, tag: 'end' });
      spheres.push({ p: new V3(sx * 3.2, 0, 0), r: 0.42, e: 0.55, tag: 'end' });
    }
    return { kind: 'tube', group, main, geo, mat, spheres, mass: 24, size: new V3(len, 2 * R, 2 * R), mu: 0.45, rollDamp: 0.7, half: new V3(len / 2, R, R) };
  }
  function buildBag(color) {
    const a = 5.0, h = 1.6, b = 4.2;
    const com = 0.45; // 折り返しの側が重い
    const mat = paperMat(color);
    const group = new THREE.Group();
    const geo = bagGeometry(a, h, b);
    geo.translate(-com, 0, 0);
    const main = shadowed(new THREE.Mesh(geo, mat));
    group.add(main);
    // 口を折り返した部分（片側に寄っている）
    const fg = new THREE.BoxGeometry(1.6, 0.16, b * 0.96, 6, 1, 8);
    {
      const pos = fg.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - 0.08 * Math.pow((pos.getX(i) + 0.8) / 1.6, 2));
      fg.computeVertexNormals();
    }
    const fold = shadowed(new THREE.Mesh(fg, mat));
    fold.position.set(a / 2 - 0.85 - com, h * 0.34, 0);
    fold.rotation.z = 0.12;
    group.add(fold);
    const roll = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, b * 0.96, 10), mat));
    roll.rotation.x = Math.PI / 2;
    roll.position.set(a / 2 - 0.12 - com, h * 0.12, 0);
    group.add(roll);
    const spheres = [];
    for (const x of [-1.7, 0, 1.7]) for (const z of [-1.4, 0, 1.4]) spheres.push({ p: new V3(x - com, 0, z), r: 0.72 });
    for (const z of [-1.3, 0, 1.3]) spheres.push({ p: new V3(1.65 - com, 0.55, z), r: 0.42, tag: 'fold' });
    return { kind: 'bag', group, main, geo, mat, spheres, mass: 22, size: new V3(a, h, b), mu: 0.55, rollDamp: 3.5, half: new V3(a / 2, h / 2, b / 2) };
  }

  // ---- 包み ----
  function Prize(kind, color, pos, quat) {
    const d = kind === 'flat' ? buildFlat(color) : kind === 'tube' ? buildTube(color) : buildBag(color);
    Object.assign(this, d);
    this.base = Float32Array.from(this.geo.attributes.position.array);
    this.creases = [];
    this.dirty = false;
    W.scene.add(this.group);
    this.body = P.addBody({ spheres: this.spheres, mass: this.mass, size: this.size, pos, quat, mu: this.mu, rollDamp: this.rollDamp, tag: 'prize', user: this });
    this.group.traverse((o) => { if (o.isMesh) o.userData.prize = this; });
    this.held = false;
    this.dragged = false;
    this.rollAcc = 0;
    this.glow = 0;
    const self = this;
    this.body.onImpact = function (v, c) {
      const s = S.clamp(v / 260, 0, 1);
      const end = c.sph && c.sph.tag === 'end';
      S.audio.thud(s * (self.kind === 'tube' ? 0.8 : 1), end ? 0.8 : self.kind === 'flat' ? 0.15 : 0.35);
      if (s > 0.25) S.audio.crinkle(s * 0.5);
    };
    list.push(this);
  }
  Prize.prototype.sync = function (dt) {
    const b = this.body;
    this.group.position.copy(b.pos);
    this.group.quaternion.copy(b.quat);
    // 筒が転がる音：回転が遅くなると間があく
    if (this.kind === 'tube' && b.mode === 'dyn' && !b.sleeping && b.support) {
      const axis = S.tmpV[0].set(1, 0, 0).applyQuaternion(b.quat);
      const spin = Math.abs(b.ang.dot(axis));
      this.rollAcc += spin * dt;
      if (this.rollAcc > 0.9) { this.rollAcc = 0; S.audio.rollTap(S.clamp(spin / 12, 0.1, 0.8)); }
    }
    // しわの戻り
    for (let i = this.creases.length - 1; i >= 0; i--) {
      const c = this.creases[i];
      if (!c.live) {
        const goal = c.perm;
        if (Math.abs(c.depth - goal) > 0.002) { c.depth = S.damp(c.depth, goal, 2.2, dt); c.wr = S.damp(c.wr, c.perm > 0 ? 0.25 : 0, 2, dt); this.dirty = true; }
      }
    }
    if (this.dirty) this.deform();
  };
  // しわ：触れた爪の幅に合わせて寄る
  Prize.prototype.deform = function () {
    this.dirty = false;
    const pos = this.geo.attributes.position, arr = pos.array, base = this.base;
    for (let i = 0, n = pos.count; i < n; i++) {
      let x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      for (const c of this.creases) {
        if (c.depth < 0.002) continue;
        const dx = x - c.p.x, dy = y - c.p.y, dz = z - c.p.z;
        // 爪の幅の方向（w）には広く、ほかの方向には狭く
        const along = dx * c.w.x + dy * c.w.y + dz * c.w.z;
        const d2 = dx * dx + dy * dy + dz * dz - along * along;
        const fa = Math.exp(-(along * along) / (c.width * c.width)), fd = Math.exp(-d2 / (c.r * c.r));
        const f = fa * fd;
        if (f < 0.003) continue;
        const wav = 1 + c.wr * Math.sin(along * 7.5 + c.ph);
        const push = c.depth * f * wav;
        x += c.n.x * push; y += c.n.y * push; z += c.n.z * push;
      }
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  };
  // 爪に挟まれた：局所座標の点 p、内向き n、爪の幅方向 w
  Prize.prototype.pinch = function (p, n, w, width) {
    let c = null;
    for (const k of this.creases) if (k.p.distanceTo(p) < 0.9) { c = k; break; }
    if (c) {
      // 同じ場所を再び挟むと、そこからしわが寄る
      c.count++;
      c.p.lerp(p, 0.5); c.n.copy(n); c.w.copy(w);
      c.wr = Math.min(0.9, 0.45 + c.count * 0.18);
    } else {
      c = { p: p.clone(), n: n.clone(), w: w.clone(), width: width || 1.3, r: 0.75, depth: 0, perm: 0, live: true, count: 1, wr: 0.35, ph: S.rand() * 6 };
      this.creases.push(c);
      if (this.creases.length > 8) this.creases.shift();
    }
    c.live = true;
    S.audio.crinkle(0.45 + c.count * 0.1);
    return c;
  };
  Prize.prototype.setPinch = function (c, depth) {
    if (Math.abs(c.depth - depth) > 0.003) { c.depth = depth; this.dirty = true; }
  };
  Prize.prototype.unpinch = function (c) {
    c.live = false;
    c.perm = Math.min(0.13, Math.max(c.perm, 0.035 + c.count * 0.025));
    this.dirty = true;
  };
  Prize.prototype.setGlow = function (k) {
    if (Math.abs(k - this.glow) < 0.01) return;
    this.glow = k;
    const c = 0.22 * k;
    this.mat.emissive.setRGB(c, c * 0.92, c * 0.75);
  };
  Prize.prototype.where = function () {
    const p = this.body.pos;
    if (S.box.inDish(p) && p.y < 4) return 'dish';
    if (S.box.isInside(p)) return 'box';
    const t = W.TRAY;
    if (p.x > t.x0 && p.x < t.x1 && p.z > t.z0 && p.z < t.z1 && p.y < 5) return 'tray';
    return 'desk';
  };
  PR.Prize = Prize;

  // ---- 初めの盆：向きや並びを毎回少し変える ----
  PR.spawnTray = function () {
    const kinds = S.shuffle(['flat', 'tube', 'bag', 'flat', 'tube', 'bag']);
    const colors = S.shuffle(COLORS.slice());
    const slots = [];
    for (const z of [17.1, 23.3]) for (const x of [-26.4, -18.9, -11.4]) slots.push([x, z]);
    const baseY = W.TRAY.base;
    kinds.forEach((k, i) => {
      const [sx, sz] = slots[i];
      const yaw = (k === 'tube' ? (S.rand() < 0.5 ? 0 : Math.PI / 2) : 0) + S.randRange(-0.22, 0.22) + (k === 'bag' && S.rand() < 0.5 ? Math.PI : 0);
      const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw);
      const hh = k === 'flat' ? 0.6 : k === 'tube' ? 1.0 : 0.8;
      const p = new V3(sx + S.randRange(-0.35, 0.35), baseY + hh + 0.06, sz + S.randRange(-0.3, 0.3));
      new Prize(k, colors[i], p, q);
    });
  };

  PR.update = function (dt) {
    for (const p of list) p.sync(dt);
  };
  PR.meshes = function () {
    const out = [];
    for (const p of list) p.group.traverse((o) => { if (o.isMesh) out.push(o); });
    return out;
  };
  PR.count = function (where) { return list.filter((p) => p.where() === where).length; };
})();
