// physics.js — 包みの動きのための小さな剛体計算（球の集まり × 箱・カプセル・ほかの包み）
(function () {
  'use strict';
  const S = window.S23;
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const P = (S.physics = {});
  const bodies = (P.bodies = []);
  const statics = (P.statics = []);
  const capsules = (P.capsules = []);
  const G = -980;
  const H = 1 / 240;
  const ITER = 8;
  let acc = 0;
  P.time = 0;

  // ---- 静的な箱（OBB）。段ボールの板や机、盆など ----
  function Static(o) {
    this.c = (o.c || new V3()).clone();
    this.h = (o.h || new V3(1, 1, 1)).clone();
    this.q = (o.q || new Q()).clone();
    this.qi = this.q.clone().invert();
    this.mu = o.mu != null ? o.mu : 0.6;
    this.e = o.e != null ? o.e : 0.1;
    this.tag = o.tag || '';
    this.owner = o.owner || null;
    this.enabled = o.enabled !== false;
    this.bound = this.h.length();
    this.vel = new V3();
    this.moved = false;
  }
  Static.prototype.set = function (c, q, dt) {
    if (dt) {
      this.vel.copy(c).sub(this.c).multiplyScalar(1 / Math.max(dt, 1e-3));
      if (this.vel.lengthSq() > 0.04 || !this.q.equals(q)) this.moved = true;
    }
    this.c.copy(c); this.q.copy(q); this.qi.copy(q).invert();
  };
  P.addStatic = function (o) { const s = new Static(o); statics.push(s); return s; };

  // ---- 剛体 ----
  let bodyId = 0;
  function Body(o) {
    this.id = ++bodyId;
    this.spheres = o.spheres.map((s) => ({ p: s.p.clone(), r: s.r, e: s.e != null ? s.e : 0.12, w: new V3(), tag: s.tag || '' }));
    this.mass = o.mass || 1;
    this.invMass = 1 / this.mass;
    const sz = o.size || new V3(4, 2, 4);
    this.size = sz.clone();
    const m = this.mass;
    this.I = new V3((m / 12) * (sz.y * sz.y + sz.z * sz.z), (m / 12) * (sz.x * sz.x + sz.z * sz.z), (m / 12) * (sz.x * sz.x + sz.y * sz.y));
    this.invI = new V3(1 / this.I.x, 1 / this.I.y, 1 / this.I.z);
    this.pos = (o.pos || new V3()).clone();
    this.quat = (o.quat || new Q()).clone();
    this.vel = new V3();
    this.ang = new V3();
    this.mu = o.mu != null ? o.mu : 0.55;
    this.rollDamp = o.rollDamp != null ? o.rollDamp : 1.2;
    this.mode = 'dyn'; // 'dyn' | 'kin'
    this.kinVel = new V3();
    this.kinAng = new V3();
    this.react = new V3();       // kin のとき受けた押し返し
    this.reactTorque = new V3();
    this.staticPen = [];         // kin のときの静的物体へのめり込み
    this.sleeping = false;
    this.sleepT = 0;
    this.bound = 0;
    for (const s of this.spheres) this.bound = Math.max(this.bound, s.p.length() + s.r);
    this.tag = o.tag || '';
    this.user = o.user || null;
    this.support = null;      // 下で支えているもの（static か body）
    this.supportT = 0;
    this.touching = [];       // このフレームに触れた相手
    this.onImpact = null;
    this.enabled = true;
    this.lastImpact = 0;
  }
  Body.prototype.updateSpheres = function () {
    for (const s of this.spheres) s.w.copy(s.p).applyQuaternion(this.quat).add(this.pos);
  };
  Body.prototype.wake = function () { this.sleeping = false; this.sleepT = 0; };
  // ワールドの逆慣性を掛ける
  const _iv = new V3(), _qi = new Q(), _kv = new V3();
  Body.prototype.applyInvI = function (v, out) {
    if (this.mode !== 'dyn' || this.sleeping) return out.set(0, 0, 0);
    _qi.copy(this.quat).invert();
    _iv.copy(v).applyQuaternion(_qi);
    _iv.x *= this.invI.x; _iv.y *= this.invI.y; _iv.z *= this.invI.z;
    return out.copy(_iv).applyQuaternion(this.quat);
  };
  Body.prototype.im = function () { return this.mode === 'dyn' && !this.sleeping ? this.invMass : 0; };
  Body.prototype.velAt = function (r, out) {
    if (this.mode === 'kin') {
      // 押す側の速さは控えめに（はじき飛ばさない）
      out.copy(this.kinAng).clampLength(0, 8).cross(r).add(_kv.copy(this.kinVel).clampLength(0, 150));
      return out.clampLength(0, 180);
    }
    if (this.sleeping) return out.set(0, 0, 0);
    return out.copy(this.ang).cross(r).add(this.vel);
  };
  Body.prototype.applyImpulse = function (J, r) {
    if (this.mode === 'kin') {
      this.react.add(J);
      _iv.copy(r).cross(J); this.reactTorque.add(_iv);
      return;
    }
    if (this.sleeping) return;
    this.vel.addScaledVector(J, this.invMass);
    _iv.copy(r).cross(J);
    this.applyInvI(_iv, _iv);
    this.ang.add(_iv);
  };
  P.addBody = function (o) { const b = new Body(o); b.updateSpheres(); bodies.push(b); return b; };
  P.removeBody = function (b) { const i = bodies.indexOf(b); if (i >= 0) bodies.splice(i, 1); };

  // ---- 爪などの動くカプセル ----
  P.addCapsule = function (o) {
    const c = { a: new V3(), b: new V3(), r: o.r || 0.3, va: new V3(), vb: new V3(), tag: o.tag || '', owner: o.owner || null, enabled: true, mu: o.mu != null ? o.mu : 0.9, hits: [] };
    capsules.push(c);
    return c;
  };

  // ---- 接触 ----
  const pool = [];
  let nC = 0;
  function newContact() {
    if (nC >= pool.length) pool.push({ A: null, B: null, S: null, C: null, n: new V3(), p: new V3(), ra: new V3(), rb: new V3(), depth: 0, mu: 0.5, e: 0, jn: 0, ft: new V3(), target: 0, kN: 1, vk: new V3(), sph: null });
    const c = pool[nC++];
    c.A = c.B = c.S = c.C = null; c.jn = 0; c.ft.set(0, 0, 0); c.target = 0; c.vk.set(0, 0, 0);
    return c;
  }

  const _l = new V3(), _cp = new V3(), _d = new V3(), _t = new V3(), _t2 = new V3(), _va = new V3(), _vb = new V3();
  // 球と OBB：めり込み量と法線（OBB から球へ）
  function sphereOBB(center, r, st, outN, outP) {
    _l.copy(center).sub(st.c).applyQuaternion(st.qi);
    const hx = st.h.x, hy = st.h.y, hz = st.h.z;
    const cx = S.clamp(_l.x, -hx, hx), cy = S.clamp(_l.y, -hy, hy), cz = S.clamp(_l.z, -hz, hz);
    let dx = _l.x - cx, dy = _l.y - cy, dz = _l.z - cz;
    let d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r * r) return -1;
    let depth;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      outN.set(dx / d, dy / d, dz / d);
      depth = r - d;
      outP.set(cx, cy, cz);
    } else {
      // 中心が内側：最も浅い面から押し出す
      const px = hx - Math.abs(_l.x), py = hy - Math.abs(_l.y), pz = hz - Math.abs(_l.z);
      if (px < py && px < pz) { outN.set(Math.sign(_l.x) || 1, 0, 0); depth = px + r; outP.set(Math.sign(_l.x) * hx, _l.y, _l.z); }
      else if (py < pz) { outN.set(0, Math.sign(_l.y) || 1, 0); depth = py + r; outP.set(_l.x, Math.sign(_l.y) * hy, _l.z); }
      else { outN.set(0, 0, Math.sign(_l.z) || 1); depth = pz + r; outP.set(_l.x, _l.y, Math.sign(_l.z) * hz); }
    }
    outN.applyQuaternion(st.q);
    outP.applyQuaternion(st.q).add(st.c);
    return depth;
  }
  P.sphereOBB = sphereOBB;

  // 任意の球の、静的物体へのめり込み（爪の当たり判定用）
  const _qn = new V3(), _qp = new V3();
  P.queryStatic = function (center, r, outN, filter) {
    let best = 0;
    outN.set(0, 1, 0);
    for (const st of statics) {
      if (!st.enabled) continue;
      if (filter && !filter(st)) continue;
      if (center.distanceTo(st.c) > st.bound + r) continue;
      const d = sphereOBB(center, r, st, _qn, _qp);
      if (d > best) { best = d; outN.copy(_qn); }
    }
    return best;
  };
  // 任意の球の、包みへのめり込み
  P.queryBodies = function (center, r, cb) {
    for (const b of bodies) {
      if (!b.enabled) continue;
      if (center.distanceTo(b.pos) > b.bound + r) continue;
      for (const s of b.spheres) {
        const rr = s.r + r;
        const d2 = center.distanceToSquared(s.w);
        if (d2 < rr * rr) cb(b, s, rr - Math.sqrt(d2));
      }
    }
  };

  function finishContact(c) {
    // 有効質量
    const A = c.A;
    let k = A.im();
    _t.copy(c.ra).cross(c.n); A.applyInvI(_t, _t2); _t.copy(_t2).cross(c.ra); k += _t.dot(c.n);
    if (c.B) {
      k += c.B.im();
      _t.copy(c.rb).cross(c.n); c.B.applyInvI(_t, _t2); _t.copy(_t2).cross(c.rb); k += _t.dot(c.n);
    }
    c.kN = Math.max(k, 1e-6);
    // 反発の目標
    relVel(c, _va);
    const vn = _va.dot(c.n);
    c.target = vn < -35 ? -c.e * vn : 0;
    c.vn0 = vn;
  }
  function relVel(c, out) {
    c.A.velAt(c.ra, out);
    if (c.B) { c.B.velAt(c.rb, _vb); out.sub(_vb); }
    else out.sub(c.vk);
    return out;
  }

  function detect() {
    nC = 0;
    const nb = bodies.length;
    for (let i = 0; i < nb; i++) {
      const A = bodies[i];
      if (!A.enabled) continue;
      A.touching.length = 0;
      if (A.mode === 'kin') A.staticPen.length = 0;
      // 眠っている包みも、動く爪に触れたら起こす
      if (A.mode === 'dyn' && A.sleeping && !(A.noClawUntil > P.time)) {
        for (const cap of capsules) {
          if (!cap.enabled) continue;
          if (S.closestOnSegment(A.pos, cap.a, cap.b, _cp) >= 0 && A.pos.distanceTo(_cp) > A.bound + cap.r + 0.2) continue;
          let touch = false;
          for (const s of A.spheres) {
            S.closestOnSegment(s.w, cap.a, cap.b, _cp);
            if (s.w.distanceTo(_cp) < s.r + cap.r + 0.02) { touch = true; break; }
          }
          if (touch) { A.wake(); break; }
        }
      }
      const activeA = A.mode === 'kin' || !A.sleeping;
      // 静的物体
      if (activeA) {
        for (const st of statics) {
          if (!st.enabled) continue;
          if (A.pos.distanceTo(st.c) > st.bound + A.bound) continue;
          for (const s of A.spheres) {
            const depth = sphereOBB(s.w, s.r, st, _d, _cp);
            if (depth <= 0) continue;
            if (A.mode === 'kin') {
              A.staticPen.push({ p: s.w.clone().addScaledVector(_d, -s.r), n: _d.clone(), depth, st });
              continue;
            }
            const c = newContact();
            c.A = A; c.S = st; c.n.copy(_d); c.depth = depth;
            c.p.copy(s.w).addScaledVector(_d, -s.r);
            c.ra.copy(c.p).sub(A.pos);
            c.mu = Math.sqrt(A.mu * st.mu);
            c.e = Math.max(s.e, st.e);
            c.vk.copy(st.vel);
            c.sph = s;
            finishContact(c);
          }
        }
        // カプセル
        if (A.mode === 'dyn' && !(A.noClawUntil > P.time)) {
          for (const cap of capsules) {
            if (!cap.enabled) continue;
            for (const s of A.spheres) {
              const t = S.closestOnSegment(s.w, cap.a, cap.b, _cp);
              _d.copy(s.w).sub(_cp);
              const dist = _d.length(), rr = s.r + cap.r;
              if (dist >= rr || dist < 1e-6) continue;
              _d.multiplyScalar(1 / dist);
              if (A.sleeping) A.wake();
              const c = newContact();
              c.A = A; c.C = cap; c.n.copy(_d); c.depth = rr - dist;
              c.p.copy(s.w).addScaledVector(_d, -s.r);
              c.ra.copy(c.p).sub(A.pos);
              c.mu = Math.sqrt(A.mu * cap.mu);
              c.e = 0.05;
              c.vk.copy(cap.va).lerp(cap.vb, t).clampLength(0, 90);
              c.sph = s;
              finishContact(c);
              cap.hits.push({ body: A, n: c.n.clone(), p: c.p.clone(), depth: c.depth, t });
            }
          }
        }
      }
      // 包み同士
      for (let j = i + 1; j < nb; j++) {
        const B = bodies[j];
        if (!B.enabled) continue;
        const activeB = B.mode === 'kin' || !B.sleeping;
        if (!activeA && !activeB) continue;
        if (A.mode === 'kin' && B.mode === 'kin') continue;
        const rr0 = A.bound + B.bound;
        if (A.pos.distanceToSquared(B.pos) > rr0 * rr0) continue;
        // 動いている方を A に
        let X = A, Y = B;
        if (A.mode === 'kin' || (A.sleeping && B.mode === 'dyn' && !B.sleeping)) { X = B; Y = A; }
        let touched = false;
        for (const sa of X.spheres) {
          if (sa.w.distanceTo(Y.pos) > Y.bound + sa.r) continue;
          for (const sb of Y.spheres) {
            const rr = sa.r + sb.r;
            _d.copy(sa.w).sub(sb.w);
            const d2 = _d.lengthSq();
            if (d2 >= rr * rr || d2 < 1e-10) continue;
            const dist = Math.sqrt(d2);
            _d.multiplyScalar(1 / dist);
            const c = newContact();
            c.A = X; c.B = Y; c.n.copy(_d); c.depth = rr - dist;
            c.p.copy(sa.w).addScaledVector(_d, -sa.r);
            c.ra.copy(c.p).sub(X.pos);
            c.rb.copy(c.p).sub(Y.pos);
            c.mu = Math.sqrt(X.mu * Y.mu);
            c.e = Math.max(sa.e, sb.e) * 0.8;
            c.sph = sa;
            // 眠っている相手は強く当たったら起こす
            relVel(c, _va);
            if (Y.sleeping && (Y.mode === 'dyn') && (_va.length() > 6 || X.mode === 'kin')) Y.wake();
            if (X.sleeping && X.mode === 'dyn' && (_va.length() > 6 || Y.mode === 'kin')) X.wake();
            finishContact(c);
            touched = true;
          }
        }
        if (touched) { X.touching.push(Y); Y.touching.push(X); }
      }
    }
  }

  const _J = new V3(), _vt = new V3(), _nf = new V3(), _negJ = new V3();
  function solve() {
    for (let it = 0; it < ITER; it++) {
      for (let k = 0; k < nC; k++) {
        const c = pool[k];
        relVel(c, _va);
        const vn = _va.dot(c.n);
        let dj = (c.target - vn) / c.kN;
        const nj = Math.max(c.jn + dj, 0);
        dj = nj - c.jn; c.jn = nj;
        if (dj !== 0) {
          _J.copy(c.n).multiplyScalar(dj);
          c.A.applyImpulse(_J, c.ra);
          if (c.B) { _negJ.copy(_J).negate(); c.B.applyImpulse(_negJ, c.rb); }
        }
        // 摩擦
        relVel(c, _va);
        const vn2 = _va.dot(c.n);
        _vt.copy(_va).addScaledVector(c.n, -vn2);
        const vtl = _vt.length();
        if (vtl > 1e-5) {
          _nf.copy(_vt).multiplyScalar(-1 / c.kN).add(c.ft);
          const maxF = c.mu * c.jn;
          const fl = _nf.length();
          if (fl > maxF) _nf.multiplyScalar(maxF / fl);
          _J.copy(_nf).sub(c.ft);
          c.ft.copy(_nf);
          c.A.applyImpulse(_J, c.ra);
          if (c.B) { _negJ.copy(_J).negate(); c.B.applyImpulse(_negJ, c.rb); }
        }
      }
    }
  }

  const _w = new Q(), _dq = new Q();
  function integrateQuat(q, w, h) {
    _dq.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0);
    _dq.multiply(q);
    q.x += _dq.x; q.y += _dq.y; q.z += _dq.z; q.w += _dq.w;
    q.normalize();
  }

  function correct() {
    for (let k = 0; k < nC; k++) {
      const c = pool[k];
      const pen = c.depth - 0.015;
      if (pen <= 0) continue;
      const ia = c.A.im(), ib = c.B ? c.B.im() : 0;
      const sum = ia + ib;
      if (sum <= 0) continue;
      const m = Math.min(pen, 0.6) * (c.C ? 0.15 : 0.45) / sum;
      c.A.pos.addScaledVector(c.n, m * ia);
      if (c.B && ib > 0) c.B.pos.addScaledVector(c.n, -m * ib);
    }
  }

  // 静的な物（壁・底・机）は必ず勝つ：最後にめり込みを押し戻す
  const _pn = new V3(), _pp = new V3(), _best = new V3();
  function projectStatics() {
    for (const b of bodies) {
      if (!b.enabled || b.mode !== 'dyn' || b.sleeping) continue;
      for (let it = 0; it < 2; it++) {
        let bd = 0.01;
        b.updateSpheres();
        for (const st of statics) {
          if (!st.enabled) continue;
          if (b.pos.distanceTo(st.c) > st.bound + b.bound) continue;
          for (const s of b.spheres) {
            const d = sphereOBB(s.w, s.r, st, _pn, _pp);
            if (d > bd) { bd = d; _best.copy(_pn); }
          }
        }
        if (bd <= 0.01) break;
        b.pos.addScaledVector(_best, (bd - 0.005) * 0.9);
        const vn = b.vel.dot(_best);
        if (vn < 0) b.vel.addScaledVector(_best, -vn);
      }
    }
  }

  function substep(h) {
    // 速度：重力と減衰
    for (const b of bodies) {
      if (!b.enabled) continue;
      if (b.mode === 'kin') { b.react.set(0, 0, 0); b.reactTorque.set(0, 0, 0); continue; }
      if (b.sleeping) continue;
      b.vel.y += G * h;
      b.vel.multiplyScalar(1 - 0.08 * h);
      b.ang.multiplyScalar(1 - 0.35 * h);
    }
    for (const cap of capsules) cap.hits.length = 0;
    for (const b of bodies) if (b.enabled) b.updateSpheres();
    detect();
    solve();
    // 位置
    for (const b of bodies) {
      if (!b.enabled) continue;
      if (b.mode === 'kin') {
        b.pos.addScaledVector(b.kinVel, h);
        integrateQuat(b.quat, b.kinAng, h);
        continue;
      }
      if (b.sleeping) continue;
      // 速すぎる値は抑える（安定のため）
      const vl = b.vel.length(); if (vl > 520) b.vel.multiplyScalar(520 / vl);
      const al = b.ang.length(); if (al > 28) b.ang.multiplyScalar(28 / al);
      b.pos.addScaledVector(b.vel, h);
      integrateQuat(b.quat, b.ang, h);
    }
    correct();
    projectStatics();
  }

  function postStep(dt) {
    // 支え・転がり抵抗・眠り・衝突音
    for (const b of bodies) {
      if (!b.enabled || b.mode !== 'dyn') continue;
      b.support = null;
    }
    for (let k = 0; k < nC; k++) {
      const c = pool[k];
      const A = c.A;
      if (A.mode === 'dyn' && c.n.y > 0.55) A.support = c.S || c.B || c.C;
      if (c.B && c.B.mode === 'dyn' && c.n.y < -0.55) c.B.support = c.B.support || A;
      if (A.onImpact && c.vn0 < -28 && P.time - A.lastImpact > 0.07) {
        A.lastImpact = P.time;
        A.onImpact(-c.vn0, c);
      }
    }
    for (const b of bodies) {
      if (!b.enabled || b.mode !== 'dyn' || b.sleeping) continue;
      if (b.support) {
        // 転がりの抵抗：ゆっくり止まる
        b.ang.multiplyScalar(Math.exp(-b.rollDamp * dt));
        b.supportT += dt;
      } else b.supportT = 0;
      if (b.vel.lengthSq() < 2.2 * 2.2 && b.ang.lengthSq() < 0.09 && b.support) {
        b.sleepT += dt;
        if (b.sleepT > 0.55) { b.sleeping = true; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); }
      } else b.sleepT = 0;
      // 机から落ちたら拾い上げる（迷子防止）
      if (b.pos.y < -20 || b.pos.y > 70 || Math.abs(b.pos.x) > 105 || Math.abs(b.pos.z + 5) > 70) { b.pos.set(-12, 6, 19); b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); }
    }
    // 動いた静的物体の近くを起こす
    for (const st of statics) {
      if (!st.moved) continue;
      st.moved = false;
      for (const b of bodies) {
        if (b.mode === 'dyn' && b.sleeping && b.pos.distanceTo(st.c) < st.bound + b.bound + 0.5) b.wake();
      }
    }
  }

  P.step = function (dt) {
    acc += Math.min(dt, 0.05);
    let n = 0;
    while (acc >= H && n < 10) {
      substep(H);
      acc -= H; n++;
      P.time += H;
    }
    if (n > 0) postStep(n * H);
    for (const b of bodies) if (b.enabled) b.updateSpheres();
  };
  P.H = H;
})();
