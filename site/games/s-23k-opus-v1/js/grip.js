// grip.js — 爪が包みに当たる・挟む・持ち上げる・傾く・抜ける。爪先が床や包みに乗るとアームが浮く。
(function () {
  'use strict';
  const S = window.S23, D = S.DIM, P = S.physics, C = S.crane;
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const G = (S.grip = {});
  const st = C.state;
  const arm = C.armParts;
  const _v = new V3(), _n = new V3(), _p = new V3(), _t = new V3(), _a = new V3(), _q = new Q(), _q2 = new Q();
  const blocked = [0, 0];

  function setArmY() {
    const hubY = C.hubRestY() + st.lift + st.ride;
    const peg = C.pegMid(_p);
    const L = Math.max(1.5, peg.y - hubY);
    st.armPos.set(peg.x + Math.sin(st.swing) * L, peg.y - Math.cos(st.swing) * L, D.ARM_Z);
    arm.group.position.copy(st.armPos);
    arm.group.updateMatrixWorld(true);
  }

  // 爪先が下から支えられている分（床・坂・包みの上）
  function rideNeed() {
    let need = 0;
    const gb = C.grip ? C.grip.body : null;
    for (let ci = 0; ci < 2; ci++) {
      const claw = arm.claws[ci];
      // 上から下りてくる間だけ包みの上に乗る。閉じかけた爪は包みを横へ押す
      const fromAbove = st.phi[ci] < -0.5;
      for (const idx of [2, 4, 5]) {
        for (const z of [-1.1, 0, 1.1]) {
          C.clawPoint(claw, idx, z, _p);
          const d = P.queryStatic(_p, 0.36, _n);
          if (d > 0 && _n.y > 0.45) need = Math.max(need, d * _n.y);
          P.queryBodies(_p, 0.36, (b, s, depth) => {
            if (b === gb) return;
            _t.copy(_p).sub(s.w);
            const l = _t.length() || 1;
            if (fromAbove && _t.y / l > 0.55 && b.mode === 'dyn') need = Math.max(need, depth * (_t.y / l) * 0.9);
          });
        }
      }
    }
    // 持っている包みが床に押しつけられている
    if (gb) {
      for (const pen of gb.staticPen) {
        if (pen.n.y < 0.5) continue;
        _t.copy(pen.p).sub(C.grip.gc);
        _a.copy(_t).cross(pen.n);
        if (_a.length() < 0.8) need = Math.max(need, pen.depth * pen.n.y);
      }
    }
    return need;
  }

  // 壁に当たる爪は開ききらない（爪の線のどこも側板の内側を越えない）
  function wallLimit(i, phi) {
    const claw = arm.claws[i];
    const B = S.box;
    const wallUp = i === 0 ? B.left.angle > 1.2 : B.right.angle > 1.2;
    const lim = D.HX - 1.0;
    for (let k = 0; k < 14; k++) {
      claw.piv.rotation.z = i === 0 ? phi : -phi;
      claw.piv.updateMatrixWorld(true);
      let hit = false;
      if (wallUp) {
        for (let idx = 0; idx < claw.line.length; idx++) {
          C.clawPoint(claw, idx, 0, _p);
          if (i === 0 ? _p.x < -lim : _p.x > lim) { hit = true; break; }
        }
      }
      if (!hit) {
        for (const idx of [1, 2, 4, 5]) {
          C.clawPoint(claw, idx, 0, _p);
          const d = P.queryStatic(_p, 0.36, _n);
          if (d > 0.02 && Math.abs(_n.y) < 0.55) { hit = true; break; }
        }
      }
      if (!hit || phi >= D.CLAW_CLOSE) break;
      phi = Math.min(D.CLAW_CLOSE, phi + 0.08);
    }
    return phi;
  }

  G.pre = function (dt) {
    if (st.arm !== 'hung') { st.rLimit = 1; return; }
    const grip = C.grip;
    const phiDes = S.lerp(D.CLAW_OPEN, D.CLAW_CLOSE, st.r);
    if (grip) {
      st.phi[0] = grip.phi[0]; st.phi[1] = grip.phi[1];
      st.rLimit = Math.min(1, grip.r + 0.03);
    } else {
      for (let i = 0; i < 2; i++) {
        let phi = phiDes;
        // 包みに押し返されている爪はそれ以上閉じない
        if (blocked[i] && phi > st.phi[i]) phi = st.phi[i];
        st.phi[i] = wallLimit(i, phi);
      }
      st.rLimit = blocked[0] && blocked[1] ? Math.max(0, st.r) : 1;
    }
    C.applyClaws();
    // 浮き
    const tryRide = Math.max(0, st.ride - 9 * dt);
    st.ride = tryRide;
    setArmY();
    let need = rideNeed();
    if (need > 0) {
      st.ride = tryRide + need;
      setArmY();
      need = rideNeed();
      if (need > 0) { st.ride += need; setArmY(); }
    }
    st.ride = Math.min(st.ride, C.maxLift() + 1.5 - st.lift);
    if (grip) holdPre(grip, dt);
  };

  // ---- 挟んでいる間 ----
  function holdPre(g, dt) {
    const b = g.body;
    const armQ = st.armQuat;
    // 握りの中心（アームに固定）
    g.gc.copy(g.gArm).applyQuaternion(armQ).add(st.armPos);
    // 今の向き
    const qW = _q.copy(armQ).multiply(g.relQ);
    const rcom = _t.copy(g.gLocal).applyQuaternion(qW).negate(); // 握り→重心
    const m = b.mass;
    // 重力のトルク
    const tau = new V3().copy(rcom).cross(_v.set(0, -m * 980, 0));
    // ほかの物に当たった押し返し
    if (g.lastDt > 0) {
      const inv = 0.5 / g.lastDt;
      tau.addScaledVector(b.reactTorque, inv);
      _v.copy(rcom).cross(b.react).multiplyScalar(inv);
      tau.add(_v);
      g.bump = b.react.length() * inv;
    }
    const I = m * (b.size.lengthSq() / 12 + rcom.lengthSq());
    const ax = _a.copy(g.axisArm).applyQuaternion(armQ).normalize();
    const ta = tau.dot(ax);
    const tp = tau.clone().addScaledVector(ax, -ta);
    const tpl = tp.length();
    const holdA = m * 980 * g.holdA, holdP = m * 980 * g.holdP;
    const w = g.w;
    const wa = w.dot(ax);
    const wp = w.clone().addScaledVector(ax, -wa);
    let nwa;
    if (Math.abs(wa) < 0.05 && Math.abs(ta) <= holdA) nwa = 0;
    else {
      const dir = Math.sign(wa) || Math.sign(ta);
      nwa = wa + ((ta - dir * holdA) / I) * dt;
      if (Math.sign(nwa) !== dir && Math.abs(ta) <= holdA) nwa = 0;
    }
    const wpl = wp.length();
    if (wpl < 0.05 && tpl <= holdP) wp.set(0, 0, 0);
    else {
      const dirV = wpl > 1e-4 ? wp.clone().multiplyScalar(1 / wpl) : tp.clone().multiplyScalar(1 / Math.max(tpl, 1e-6));
      wp.addScaledVector(tp, dt / I).addScaledVector(dirV, (-holdP * dt) / I);
      if (wp.dot(dirV) < 0 && tpl <= holdP) wp.set(0, 0, 0);
    }
    w.copy(ax).multiplyScalar(nwa).add(wp).multiplyScalar(Math.exp(-1.6 * dt));
    // 滑り：保てない分がたまると抜ける
    const over = Math.max(0, Math.abs(ta) / holdA - 1) * 0.4 + Math.max(0, tpl / holdP - 1);
    const jerk = Math.abs(st.txAcc) / 980 + Math.abs(st.swingV) * 0.08;
    g.slip += (over * g.slipRate + jerk * g.jerkRate) * dt;
    if (g.cradle) g.slip = Math.max(0, g.slip - dt);
    // 向きを進める
    const wl = w.length();
    if (wl > 1e-5) {
      _q2.setFromAxisAngle(_v.copy(w).multiplyScalar(1 / wl), wl * dt);
      qW.premultiply(_q2);
    }
    // 床や坂にこすれる角：握りを支点に回して逃がす
    for (const pen of b.staticPen) {
      if (pen.depth < 0.02) continue;
      _v.copy(pen.p).sub(g.gc);
      const u = _v.clone().cross(pen.n);
      const ul = u.length();
      if (ul < 0.6) continue;
      u.multiplyScalar(1 / ul);
      const ang = Math.min(0.08, (pen.depth / ul) * 0.7);
      _q2.setFromAxisAngle(u, ang);
      qW.premultiply(_q2);
      const into = w.dot(u);
      if (into < 0) w.addScaledVector(u, -into);
      if (pen.depth > 0.1) S.audio.scrape(0.25);
    }
    qW.normalize();
    g.relQ.copy(armQ).invert().multiply(qW);
    // 目標の姿勢
    g.qT.copy(qW);
    g.pT.copy(g.gLocal).applyQuaternion(qW).negate().add(g.gc);
    const idt = 1 / Math.max(dt, 1e-3);
    b.kinVel.copy(g.pT).sub(b.pos).multiplyScalar(idt);
    _q2.copy(g.qT).multiply(_q.copy(b.quat).invert());
    if (_q2.w < 0) { _q2.x *= -1; _q2.y *= -1; _q2.z *= -1; _q2.w *= -1; }
    const s = Math.sqrt(Math.max(0, 1 - _q2.w * _q2.w));
    const angle = 2 * Math.acos(S.clamp(_q2.w, -1, 1));
    if (s > 1e-5) b.kinAng.set(_q2.x / s, _q2.y / s, _q2.z / s).multiplyScalar(angle * idt);
    else b.kinAng.set(0, 0, 0);
    g.lastDt = dt;
    // しわ：強く引くほど深く
    const press = 0.16 + 0.16 * S.clamp(st.lift / 2, 0, 1) + (st.dEff > D.SLACK + D.PLATE_TRAVEL * g.r ? 0.05 : 0);
    for (const c of g.creases) g.prize.setPinch(c, press);
  }

  function startGrip(body, hl, hr) {
    const prize = body.user;
    const pL = new V3(), pR = new V3(), nL = new V3(), nR = new V3();
    let endHit = false;
    for (const h of hl) { pL.add(h.p); nL.add(h.n); }
    for (const h of hr) { pR.add(h.p); nR.add(h.n); }
    pL.multiplyScalar(1 / hl.length); pR.multiplyScalar(1 / hr.length);
    nL.normalize(); nR.normalize();
    const gc = pL.clone().add(pR).multiplyScalar(0.5);
    const sep = pL.distanceTo(pR);
    // 当たった球に「ひねった端」が含まれるか
    const qi = body.quat.clone().invert();
    const loc = (p) => p.clone().sub(body.pos).applyQuaternion(qi);
    for (const s of body.spheres) {
      if (s.tag !== 'end') continue;
      if (s.w.distanceTo(pL) < s.r + 0.6 || s.w.distanceTo(pR) < s.r + 0.6) endHit = true;
    }
    // 爪先が包みの下へ回り込んで、下から押し上げている（深く挟めた）
    const upL = nL.y, upR = nR.y;
    let tipY = 1e9;
    for (const claw of arm.claws) { C.clawPoint(claw, 5, 0, _p); tipY = Math.min(tipY, _p.y); }
    const hh = prize.half.y;
    const cradle = upL > 0.3 && upR > 0.3 && sep > 1.2 && tipY < body.pos.y - hh * 0.2;
    const armQi = st.armQuat.clone().invert();
    const g = {
      body, prize, gc: gc.clone(),
      gArm: gc.clone().sub(st.armPos).applyQuaternion(armQi),
      gLocal: loc(gc),
      relQ: armQi.clone().multiply(body.quat),
      relQ0: null,
      axisArm: pR.clone().sub(pL).applyQuaternion(armQi).normalize(),
      w: new V3(), sep, endHit, cradle,
      holdA: 0.25 + S.clamp(sep - 2, 0, 4) * 0.12, holdP: S.clamp(sep * 0.22, 0.25, 1.6),
      slip: 0, slipRate: 0.9, jerkRate: 0.25,
      r: st.r, phi: [st.phi[0], st.phi[1]],
      creases: [], pT: body.pos.clone(), qT: body.quat.clone(), lastDt: 0, bump: 0, t: 0,
    };
    if (!isFinite(g.axisArm.x)) g.axisArm.set(1, 0, 0);
    if (endHit) { g.holdA *= 0.35; g.holdP *= 0.3; g.slipRate = 2.2; g.jerkRate = 1.4; }
    if (cradle) { g.holdA *= 3; g.holdP *= 2.5; g.slipRate = 0.15; g.jerkRate = 0.05; }
    g.relQ0 = g.relQ.clone();
    // しわ（爪の幅の向き＝奥行き方向）
    const wz = new V3(0, 0, 1).applyQuaternion(qi);
    g.creases.push(prize.pinch(loc(pL), nL.clone().applyQuaternion(qi), wz, 1.3));
    g.creases.push(prize.pinch(loc(pR), nR.clone().applyQuaternion(qi), wz, 1.3));
    body.mode = 'kin';
    body.wake();
    body.kinVel.set(0, 0, 0); body.kinAng.set(0, 0, 0);
    prize.held = true;
    C.grip = g;
    S.events.emit('grip', prize);
  }

  G.release = function (silent) {
    const g = C.grip;
    if (!g) return;
    const b = g.body;
    b.mode = 'dyn';
    b.pos.copy(g.pT); b.quat.copy(g.qT);
    b.vel.copy(b.kinVel).clampLength(0, 80);
    b.ang.copy(b.kinAng).clampLength(0, 5);
    b.wake();
    b.noClawUntil = P.time + 0.7; // 開いていく爪にはじかれず、まっすぐ落ちる
    g.prize.held = false;
    for (const c of g.creases) g.prize.unpinch(c);
    C.grip = null;
    st.rLimit = 1;
    blocked[0] = blocked[1] = 0;
    if (!silent) S.audio.crinkle(0.3);
    S.events.emit('drop', g.prize);
  };

  G.post = function (dt) {
    if (st.arm !== 'hung') { if (C.grip) G.release(true); return; }
    const g = C.grip;
    if (g) {
      // 姿勢を目標にそろえる
      g.body.pos.copy(g.pT); g.body.quat.copy(g.qT); g.body.updateSpheres();
      g.t += dt;
      const dev = 2 * Math.acos(S.clamp(Math.abs(g.relQ.dot(g.relQ0)), 0, 1));
      if (st.r < g.r - 0.05) { G.why = 'open'; G.release(); }
      else if (g.slip > 1) { G.why = 'slip'; G.release(); S.audio.scrape(0.5); }
      else if (dev > 1.35 && !g.cradle && g.sep < 3.5) { G.why = 'turn'; G.release(); }
      return;
    }
    // 両方の爪が同じ包みを内へ押していたら挟む
    const hl = new Map(), hr = new Map();
    blocked[0] = blocked[1] = 0;
    const collect = (caps, map, sgn, bi) => {
      for (const cap of caps) for (const h of cap.hits) {
        const inward = sgn * h.n.x > 0.18 || h.n.y < -0.6;
        if (!inward || !h.body.user) continue;
        if (!map.has(h.body)) map.set(h.body, []);
        map.get(h.body).push(h);
        if (h.depth > 0.22) blocked[bi] = 1;
      }
    };
    collect(C.caps.L, hl, 1, 0);
    collect(C.caps.R, hr, -1, 1);
    if (!st.held || st.r < 0.04) return;
    const minSep = 0.8;
    for (const [body, l] of hl) {
      const r = hr.get(body);
      if (!r) continue;
      if (body.user.dragged) continue;
      const pa = l[0].p, pb = r[0].p;
      if (pa.distanceTo(pb) < minSep) continue;
      startGrip(body, l, r);
      break;
    }
    if (hl.size + hr.size > 0 && Math.random() < 0.08) S.audio.crinkle(0.15);
  };
  G.isHolding = (prize) => C.grip && C.grip.prize === prize;
})();
