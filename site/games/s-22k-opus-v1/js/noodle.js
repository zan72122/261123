/* noodle.js — each noodle is a chain of particles that remembers its width,
   thickness and fold, simulated inside a "container" (board, net, pot, bowl). */
(function () {
  'use strict';
  const U = window.U;
  const N = (U.noodles = { list: [], zones: [], containers: {} });

  const H = 1 / 60;
  const ITER = 6;
  let acc = 0;
  let nextId = 1;

  // ---------- material: gloss follows the per-vertex "cook" value ----------
  N.material = null;
  function makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float cook;\nvarying float vCook;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCook = cook;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCook;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.26, vCook);');
    };
    return m;
  }

  // octagon cross-section (normalised), with normals
  const OCT = [[1, 0.45], [0.55, 1], [-0.55, 1], [-1, 0.45], [-1, -0.45], [-0.55, -1], [0.55, -1], [1, -0.45]];
  const OCTN = OCT.map(([x, y]) => {
    const nx = x * (Math.abs(x) > 0.9 ? 1 : 0.35), ny = y * (Math.abs(y) > 0.9 ? 1 : 0.35);
    const l = Math.hypot(nx, ny);
    return [nx / l, ny / l];
  });

  // ---------- containers ----------
  const G = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  N.gravity = 40;
  N.defineContainer = function (c) {
    c.gscale = c.gscale || 1;
    N.containers[c.name] = c;
    return c;
  };
  function gravityLocal(c, out) {
    c.obj.getWorldQuaternion(_q);
    _q.invert();
    return out.set(0, -N.gravity * c.gscale, 0).applyQuaternion(_q);
  }

  // basket collision in net-local space (rim at origin). Works on arrays.
  // returns 1 if contact, writing normal to nrm
  N.basketCollide = function (p, q, rad, nrm) {
    const n = U.L.net;
    let contact = 0;
    const sy = n.Rs - n.d; // sphere centre y
    if (p[1] < 0.015) {
      const dx = p[0], dy = p[1] - sy, dz = p[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      let inside;
      if (q[1] >= 0.015) inside = Math.hypot(q[0], q[2]) < n.a;
      else {
        const qx = q[0], qy = q[1] - sy, qz = q[2];
        inside = qx * qx + qy * qy + qz * qz <= n.Rs * n.Rs;
      }
      if (inside && d > n.Rs - rad) {
        const k = (n.Rs - rad) / d;
        p[0] = dx * k; p[1] = sy + dy * k; p[2] = dz * k;
        nrm[0] = -dx / d; nrm[1] = -dy / d; nrm[2] = -dz / d;
        contact = 1;
      } else if (!inside && d < n.Rs + rad) {
        const k = (n.Rs + rad) / d;
        p[0] = dx * k; p[1] = sy + dy * k; p[2] = dz * k;
        nrm[0] = dx / d; nrm[1] = dy / d; nrm[2] = dz / d;
        contact = 1;
      }
    }
    // rim wire
    const rr = Math.hypot(p[0], p[2]) || 1e-6;
    const cx = (p[0] / rr) * n.a, cz = (p[2] / rr) * n.a;
    const ex = p[0] - cx, ey = p[1], ez = p[2] - cz;
    const ed = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-6;
    const lim = rad + 0.016;
    if (ed < lim) {
      const k = lim / ed;
      p[0] = cx + ex * k; p[1] = ey * k; p[2] = cz + ez * k;
      nrm[0] = ex / ed; nrm[1] = ey / ed; nrm[2] = ez / ed;
      contact = 1;
    }
    return contact;
  };
  // is a net-local point inside the basket volume?
  N.inBasket = function (x, y, z) {
    const n = U.L.net;
    if (y > 0.03) return false;
    const sy = n.Rs - n.d;
    return x * x + (y - sy) * (y - sy) + z * z < n.Rs * n.Rs && Math.hypot(x, z) < n.a;
  };

  // ---------- Noodle ----------
  class Noodle {
    constructor(o) {
      this.id = nextId++;
      const pts = o.points;
      const n = (this.n = pts.length);
      this.pos = new Float32Array(n * 3);
      this.prev = new Float32Array(n * 3);
      this.w = new Float32Array(n);
      this.t = new Float32Array(n);
      this.cook = new Float32Array(n);
      this.pin = new Uint8Array(n);
      this.pinPos = new Float32Array(n * 3);
      this.contact = new Uint8Array(n);
      this.cn = new Float32Array(n * 3);
      let L = 0;
      for (let i = 0; i < n; i++) {
        this.pos.set(pts[i], i * 3);
        this.prev.set(pts[i], i * 3);
        this.w[i] = o.w[i];
        this.t[i] = o.t[i];
        if (i > 0) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      }
      this.length = L;
      this.seg = L / Math.max(1, n - 1);
      this.fold = o.fold == null ? -1 : o.fold;
      let wm = 0, tm = 0;
      for (let i = 0; i < n; i++) { wm += this.w[i]; tm += this.t[i]; }
      this.wMean = wm / n;
      this.tMean = tm / n;
      // bending stiffness: wider and thicker noodles resist bending
      this.kb = U.clamp(0.02 + (this.wMean / 0.22) * 0.5 * (this.tMean / 0.05), 0.02, 0.6);
      this.grab = -1;
      this.grabT = new THREE.Vector3();
      this.sleep = false;
      this.still = 0;
      this.frozen = false;
      this.shield = 0;
      this.age = 0;
      this.side0 = null;
      this.tint = o.tint || 0;
      this.meta = o.meta || {};
      this.container = null;
      this.buildMesh();
      N.list.push(this);
      if (o.container) this.setContainer(o.container, true);
    }

    buildMesh() {
      const n = this.n;
      const vc = n * 8 + 2;
      const g = new THREE.BufferGeometry();
      this.aPos = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
      this.aNor = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
      this.aCol = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
      this.aCook = new THREE.BufferAttribute(new Float32Array(vc), 1);
      [this.aPos, this.aNor, this.aCol, this.aCook].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('position', this.aPos);
      g.setAttribute('normal', this.aNor);
      g.setAttribute('color', this.aCol);
      g.setAttribute('cook', this.aCook);
      const idx = [];
      for (let i = 0; i < n - 1; i++) {
        for (let k = 0; k < 8; k++) {
          const a = i * 8 + k, b = i * 8 + ((k + 1) % 8), c = (i + 1) * 8 + k, d = (i + 1) * 8 + ((k + 1) % 8);
          idx.push(a, b, c, b, d, c);
        }
      }
      const c0 = n * 8, c1 = n * 8 + 1;
      for (let k = 0; k < 8; k++) {
        idx.push(c0, (k + 1) % 8, k);
        idx.push(c1, (n - 1) * 8 + k, (n - 1) * 8 + ((k + 1) % 8));
      }
      g.setIndex(idx);
      if (!N.material) N.material = makeMaterial();
      const m = (this.mesh = new THREE.Mesh(g, N.material));
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData.noodle = this;
      this.dirty = true;
    }

    setContainer(c, keepLocal) {
      const old = this.container;
      if (old && !keepLocal && old !== c) {
        old.obj.updateMatrixWorld(true);
        c.obj.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        for (const arr of [this.pos, this.prev, this.pinPos]) {
          for (let i = 0; i < this.n; i++) {
            v.fromArray(arr, i * 3);
            old.obj.localToWorld(v);
            c.obj.worldToLocal(v);
            v.toArray(arr, i * 3);
          }
        }
        if (this.side0) {
          // rotate the reference side vector into the new frame
          const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
          old.obj.getWorldQuaternion(qa);
          c.obj.getWorldQuaternion(qb);
          this.side0.applyQuaternion(qa).applyQuaternion(qb.invert());
        }
      }
      this.container = c;
      c.obj.add(this.mesh);
      this.wake();
      this.frozen = false;
      if (c.onEnter) c.onEnter(this);
    }

    wake() {
      this.sleep = false;
      this.still = 0;
    }

    worldPoint(i, out) {
      out = out || new THREE.Vector3();
      out.fromArray(this.pos, i * 3);
      return this.container.obj.localToWorld(out);
    }
    centroidLocal(out) {
      out = out || new THREE.Vector3();
      out.set(0, 0, 0);
      for (let i = 0; i < this.n; i++) {
        out.x += this.pos[i * 3]; out.y += this.pos[i * 3 + 1]; out.z += this.pos[i * 3 + 2];
      }
      return out.multiplyScalar(1 / this.n);
    }
    centroidWorld(out) {
      return this.container.obj.localToWorld(this.centroidLocal(out));
    }

    step(h) {
      const c = this.container;
      const n = this.n, P = this.pos, Q = this.prev;
      gravityLocal(c, G);
      const h2 = h * h;
      const med = c.medium ? MED : null;
      let maxMove = 0;
      this.age += h;
      if (this.shield > 0) this.shield -= h;
      for (let i = 0; i < n; i++) {
        if (this.pin[i]) continue;
        const i3 = i * 3;
        let vx = P[i3] - Q[i3], vy = P[i3 + 1] - Q[i3 + 1], vz = P[i3 + 2] - Q[i3 + 2];
        let damp = c.damp == null ? 0.995 : c.damp;
        let gs = 1;
        if (med) {
          MED.water = 0;
          c.medium(this, i, MED);
          if (MED.water > 0) {
            const k = MED.drag * (this.shield > 0 ? 0.25 : 1);
            vx += (MED.fx * h - vx) * k;
            vy += (MED.fy * h - vy) * k;
            vz += (MED.fz * h - vz) * k;
            gs = MED.gs;
            if (MED.hot) this.cook[i] = Math.min(1, this.cook[i] + h * MED.hot);
          }
        }
        Q[i3] = P[i3]; Q[i3 + 1] = P[i3 + 1]; Q[i3 + 2] = P[i3 + 2];
        P[i3] += vx * damp + G.x * h2 * gs;
        P[i3 + 1] += vy * damp + G.y * h2 * gs;
        P[i3 + 2] += vz * damp + G.z * h2 * gs;
      }
      const seg = this.seg;
      // crease angle at the fold relaxes as the noodle cooks
      let foldRest = 0;
      if (this.fold >= 1 && this.fold < n - 1) {
        const ck = this.cook[this.fold];
        const ang = 1.25 * (1 - 0.75 * ck);
        foldRest = 2 * seg * Math.cos(ang / 2);
      }
      for (let it = 0; it < ITER; it++) {
        // stretch
        for (let i = 0; i < n - 1; i++) constrain(P, this.pin, i, i + 1, seg, 1);
        // bend (distance between i-1 and i+1)
        for (let i = 1; i < n - 1; i++) {
          if (i === this.fold) constrain(P, this.pin, i - 1, i + 1, foldRest, 0.25, true);
          else constrain(P, this.pin, i - 1, i + 1, seg * 1.998, this.kb, false, true);
        }
        // pins & grab
        for (let i = 0; i < n; i++) {
          if (this.pin[i]) {
            P[i * 3] = this.pinPos[i * 3]; P[i * 3 + 1] = this.pinPos[i * 3 + 1]; P[i * 3 + 2] = this.pinPos[i * 3 + 2];
          }
        }
        if (this.grab >= 0) {
          const g3 = this.grab * 3;
          P[g3] += (this.grabT.x - P[g3]) * 0.6;
          P[g3 + 1] += (this.grabT.y - P[g3 + 1]) * 0.6;
          P[g3 + 2] += (this.grabT.z - P[g3 + 2]) * 0.6;
        }
        // collisions
        if (it % 2 === 1 || it === ITER - 1) {
          for (let i = 0; i < n; i++) {
            if (this.pin[i]) continue;
            this.contact[i] = c.collide(this, i) ? 1 : 0;
          }
        }
      }
      // friction & motion measure
      const fr = c.friction == null ? 0.5 : c.friction;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        if (this.contact[i] && !this.pin[i] && i !== this.grab) {
          Q[i3] = U.lerp(Q[i3], P[i3], fr);
          Q[i3 + 2] = U.lerp(Q[i3 + 2], P[i3 + 2], fr);
          if (c.frictionY) Q[i3 + 1] = U.lerp(Q[i3 + 1], P[i3 + 1], fr);
        }
        const m = Math.abs(P[i3] - Q[i3]) + Math.abs(P[i3 + 1] - Q[i3 + 1]) + Math.abs(P[i3 + 2] - Q[i3 + 2]);
        if (m > maxMove) maxMove = m;
      }
      this.dirty = true;
      if (c.onStep) c.onStep(this, maxMove, h);
      if (this.grab < 0 && !this.pin.some((v) => v) && maxMove < (c.sleepEps || 0.0006)) {
        this.still += h;
        if (this.still > (c.sleepTime || 0.6) && c.canSleep !== false) {
          this.sleep = true;
          if (c.onSleep) c.onSleep(this);
        }
      } else this.still = 0;
    }

    updateMesh() {
      if (!this.dirty) return;
      this.dirty = false;
      const n = this.n, P = this.pos;
      const pa = this.aPos.array, na = this.aNor.array, ca = this.aCol.array, ka = this.aCook.array;
      const T = _T, S = _S, Uv = _Uv, tmp = _tmp;
      // reference side vector
      if (!this.side0) {
        T.set(P[3] - P[0], P[4] - P[1], P[5] - P[2]).normalize();
        this.side0 = new THREE.Vector3().crossVectors(T, UPV);
        if (this.side0.lengthSq() < 1e-6) this.side0.set(1, 0, 0);
        this.side0.normalize();
      }
      S.copy(this.side0);
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        T.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
        if (T.lengthSq() < 1e-10) T.set(0, 0, 1);
        T.normalize();
        // transport previous side
        S.addScaledVector(T, -S.dot(T));
        if (this.contact[i]) {
          tmp.fromArray(this.cn, i * 3);
          if (tmp.lengthSq() > 0.5) {
            Uv.crossVectors(T, tmp);
            if (Uv.lengthSq() > 1e-4) {
              Uv.normalize();
              if (Uv.dot(S) < 0) Uv.negate();
              S.lerp(Uv, 0.5);
            }
          }
        }
        if (S.lengthSq() < 1e-8) S.crossVectors(T, UPV);
        S.normalize();
        if (i === 0) this.side0.copy(S);
        Uv.crossVectors(T, S).normalize();
        const hw = this.w[i] * 0.5, ht = this.t[i] * 0.5;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const ck = this.cook[i];
        const cr = U.lerp(0.95, 0.985, ck) - this.tint * 0.02, cg = U.lerp(0.93, 0.94, ck) - this.tint * 0.02, cb = U.lerp(0.86, 0.79, ck);
        for (let k = 0; k < 8; k++) {
          const o = OCT[k], on = OCTN[k];
          const vi = (i * 8 + k) * 3;
          pa[vi] = x + S.x * o[0] * hw + Uv.x * o[1] * ht;
          pa[vi + 1] = y + S.y * o[0] * hw + Uv.y * o[1] * ht;
          pa[vi + 2] = z + S.z * o[0] * hw + Uv.z * o[1] * ht;
          na[vi] = S.x * on[0] + Uv.x * on[1];
          na[vi + 1] = S.y * on[0] + Uv.y * on[1];
          na[vi + 2] = S.z * on[0] + Uv.z * on[1];
          ca[vi] = cr; ca[vi + 1] = cg; ca[vi + 2] = cb;
          ka[i * 8 + k] = ck;
        }
        if (i === 0 || i === n - 1) {
          const ci = (n * 8 + (i === 0 ? 0 : 1)) * 3;
          const s = i === 0 ? -1 : 1;
          pa[ci] = x + T.x * 0.004 * s; pa[ci + 1] = y + T.y * 0.004 * s; pa[ci + 2] = z + T.z * 0.004 * s;
          na[ci] = T.x * s; na[ci + 1] = T.y * s; na[ci + 2] = T.z * s;
          ca[ci] = cr; ca[ci + 1] = cg; ca[ci + 2] = cb;
          ka[n * 8 + (i === 0 ? 0 : 1)] = ck;
        }
      }
      this.aPos.needsUpdate = true;
      this.aNor.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aCook.needsUpdate = true;
    }

    dispose() {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      const i = N.list.indexOf(this);
      if (i >= 0) N.list.splice(i, 1);
    }
  }
  N.Noodle = Noodle;
  const _T = new THREE.Vector3(), _S = new THREE.Vector3(), _Uv = new THREE.Vector3(), _tmp = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  const MED = { water: 0, fx: 0, fy: 0, fz: 0, drag: 0, gs: 1, hot: 0 };

  // distance constraint. bendMode: when true only pushes apart if closer than rest (and pulls if farther)
  function constrain(P, pin, a, b, rest, k, both, onlyPush) {
    const a3 = a * 3, b3 = b * 3;
    const dx = P[b3] - P[a3], dy = P[b3 + 1] - P[a3 + 1], dz = P[b3 + 2] - P[a3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    if (onlyPush && d >= rest) return;
    const diff = ((d - rest) / d) * k;
    const pa = pin[a] ? 0 : 1, pb = pin[b] ? 0 : 1;
    const s = pa + pb;
    if (!s) return;
    const fa = (pa / s) * diff, fb = (pb / s) * diff;
    P[a3] += dx * fa; P[a3 + 1] += dy * fa; P[a3 + 2] += dz * fa;
    P[b3] -= dx * fb; P[b3 + 1] -= dy * fb; P[b3 + 2] -= dz * fb;
  }

  N.create = function (o) {
    return new Noodle(o);
  };

  // ---------- world container (board & table) ----------
  N.initWorld = function (scene) {
    const B = U.L.board;
    N.world = N.defineContainer({
      name: 'world',
      obj: scene,
      friction: 0.85,
      collide(nd, i) {
        const P = nd.pos, i3 = i * 3;
        const x = P[i3], z = P[i3 + 2];
        const onBoard = x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1;
        const gy = onBoard ? B.top : 0;
        const r = nd.t[i] * 0.5;
        if (P[i3 + 1] < gy + r) {
          // if sinking from above the board edge, stay on the board
          P[i3 + 1] = gy + r;
          nd.cn[i3] = 0; nd.cn[i3 + 1] = 1; nd.cn[i3 + 2] = 0;
          return true;
        }
        return false;
      },
      onStep(nd) {
        // falling into a zone (pot, bowl, net)
        if (nd.grab >= 0) return;
        const m = (nd.n / 2) | 0;
        const v = _tmp.fromArray(nd.pos, m * 3);
        for (const zn of N.zones) {
          if (zn.enabled && !zn.enabled()) continue;
          if (zn.contains(v, nd)) {
            nd.setContainer(zn.container());
            if (zn.onCapture) zn.onCapture(nd);
            return;
          }
        }
      },
    });
  };

  // ---------- picking ----------
  const _w = new THREE.Vector3();
  N.pick = function (ray, filter) {
    let best = null;
    for (const nd of N.list) {
      if (filter && !filter(nd)) continue;
      const obj = nd.container.obj;
      for (let i = 0; i < nd.n; i++) {
        _w.fromArray(nd.pos, i * 3);
        obj.localToWorld(_w);
        const d = ray.distanceToPoint(_w);
        const lim = Math.max(0.09, nd.w[i] * 0.6);
        if (d < lim) {
          const along = _w.clone().sub(ray.origin).dot(ray.direction);
          const score = along + d * 4;
          if (!best || score < best.score) best = { nd, i, dist: along, point: _w.clone(), score };
        }
      }
    }
    return best;
  };

  // ---------- update ----------
  N.update = function (dt) {
    acc += dt;
    let steps = 0;
    while (acc >= H && steps < 3) {
      acc -= H;
      steps++;
      for (let k = N.list.length - 1; k >= 0; k--) {
        const nd = N.list[k];
        if (nd && !nd.sleep && !nd.frozen && nd.container) nd.step(H);
      }
    }
    if (steps === 3) acc = 0;
    // safety: anything that slipped out of the world comes back to the board
    N.safeT = (N.safeT || 0) + dt;
    if (N.safeT > 1) {
      N.safeT = 0;
      for (const nd of N.list) {
        const c = nd.centroidWorld(_tmp);
        if (c.y < -0.4 || !isFinite(c.y)) {
          const B = U.L.board;
          nd.setContainer(N.world);
          const ox = B.x - c.x, oz = B.z - c.z;
          for (let i = 0; i < nd.n; i++) {
            nd.pos[i * 3] += isFinite(ox) ? ox : 0;
            nd.pos[i * 3 + 1] = B.top + 0.3;
            nd.pos[i * 3 + 2] += isFinite(oz) ? oz : 0;
            nd.prev[i * 3] = nd.pos[i * 3]; nd.prev[i * 3 + 1] = nd.pos[i * 3 + 1]; nd.prev[i * 3 + 2] = nd.pos[i * 3 + 2];
          }
          nd.wake();
        }
      }
    }
    for (const nd of N.list) nd.updateMesh();
  };

  N.inContainer = function (name) {
    return N.list.filter((nd) => nd.container && nd.container.name === name);
  };
})();
