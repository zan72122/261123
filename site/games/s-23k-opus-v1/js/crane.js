// crane.js — 横桟・台車・アーム・ひもの状態と動き。輪を下げた分が引き板→爪→アームへ伝わる。
(function () {
  'use strict';
  const S = window.S23, D = S.DIM, P = S.physics, W = S.world, CP = S.craneParts, CD = S.cord;
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const C = (S.crane = {});
  const scene = W.scene;

  // ---- 部品 ----
  const bar = (C.barParts = CP.makeBar());
  scene.add(bar.group);
  const trolley = (C.trolleyParts = CP.makeTrolley());
  bar.group.add(trolley.group);
  const arm = (C.armParts = CP.makeArm());
  scene.add(arm.group);
  const threadMat = CD.material(0xf4ecdc);
  const tipMat = CD.material(0xc9a77a); // 硬い先端（蝋を引いた色）
  const hangers = [CD.makeTube(10, 0.07, 5, threadMat), CD.makeTube(10, 0.07, 5, threadMat)];
  for (const h of hangers) scene.add(h.mesh);
  const links = [CP.makeThread(0.06, threadMat), CP.makeThread(0.06, threadMat)];
  for (const l of links) scene.add(l);
  // ひも本体と輪
  const ROPE_N = 34, ROPE_SEG = 0.6, LOOP_M = 22;
  const rope = (C.rope = new CD.Rope(ROPE_N, ROPE_SEG, LOOP_M, D.LOOP_R));
  const ropeTube = CD.makeTube(ROPE_N, 0.13, 6, threadMat);
  const loopTube = CD.makeTube(LOOP_M + 2, 0.14, 6, threadMat, true);
  const tipTube = CD.makeTube(7, 0.18, 6, tipMat);
  scene.add(ropeTube.mesh); scene.add(loopTube.mesh); scene.add(tipTube.mesh);
  // 触れやすくする見えない当たり
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const tipProxy = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), proxyMat);
  const loopProxy = new THREE.Mesh(new THREE.CylinderGeometry(D.LOOP_R + 1.3, D.LOOP_R + 1.3, 2.4, 16), proxyMat);
  loopProxy.geometry.rotateX(Math.PI / 2);
  const barProxyL = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 3.2), proxyMat);
  const barProxyR = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 3.2), proxyMat);
  bar.group.add(barProxyL); bar.group.add(barProxyR);
  barProxyL.position.x = -D.BAR_LEN / 2 + 2.6; barProxyR.position.x = D.BAR_LEN / 2 - 2.6;
  const armProxy = new THREE.Mesh(new THREE.BoxGeometry(5, 4.5, 4), proxyMat);
  armProxy.position.y = -1.8;
  arm.group.add(armProxy);
  scene.add(tipProxy); scene.add(loopProxy);
  C.proxies = { tip: tipProxy, loop: loopProxy, barL: barProxyL, barR: barProxyR, arm: armProxy };

  // 爪の当たり（カプセル）
  const capsL = [], capsR = [], capsHub = [];
  const ZS = [-1.25, 0, 1.25];
  for (let k = 0; k < 9; k++) { capsL.push(P.addCapsule({ r: 0.38, tag: 'clawL' })); capsR.push(P.addCapsule({ r: 0.38, tag: 'clawR' })); }
  for (let k = 0; k < 2; k++) capsHub.push(P.addCapsule({ r: 0.55, tag: 'hub' }));
  C.caps = { L: capsL, R: capsR, hub: capsHub };

  // ---- 状態 ----
  const st = (C.state = {
    bar: 'tray', level: null, barPos: new V3(), barQuat: new Q(), barEnd: 1, barSnap: null, barAnim: 0, barFrom: new V3(), barFromQ: new Q(), barTo: new V3(), barToQ: new Q(),
    tx: 10.4, txV: 0, txTarget: 10.4, txAcc: 0,
    arm: 'tray', armPos: new V3(), armQuat: new Q(), armAnim: 0, armFrom: new V3(), armFromQ: new Q(), armSnap: false,
    swing: 0, swingV: 0, lift: 0, ride: 0, r: 0, rLimit: 1, phi: [D.CLAW_OPEN, D.CLAW_OPEN],
    threaded: false, threadK: 0,
    held: false, dEff: 0, dRaw: 0, loopC: new V3(), loopVis: new V3(), grabOff: new V3(), y0: 0, d0: 0,
    sway: { x: 0, z: 0, vx: 0, vz: 0 }, releasing: false,
    wasOverChute: false, tensionLast: 0,
  });
  C.grip = null;
  const TRAY_BAR = new V3(-13, W.TRAY.base + D.BAR_SIZE / 2 + 0.02, 27.75);
  const TRAY_ARM = new V3(-5.2, W.TRAY.base + 2.75, 20.6);
  const TRAY_ARM_Q = new Q().setFromAxisAngle(new V3(0, 0, 1), Math.PI / 2);
  st.barPos.copy(TRAY_BAR);
  st.armPos.copy(TRAY_ARM); st.armQuat.copy(TRAY_ARM_Q);
  C.TRAY_BAR = TRAY_BAR; C.TRAY_ARM = TRAY_ARM;

  // ---- 位置の計算 ----
  const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _q = new Q();
  C.barPlaced = () => st.bar === 'placed';
  C.armHung = () => st.arm === 'hung';
  C.ready = () => st.bar === 'placed' && st.arm === 'hung' && st.threaded;
  C.barY = () => S.box.barY(st.level || 'low');
  // 台車の位置（ワールド）
  C.trolleyWorld = function (out) { return trolley.group.getWorldPosition(out); };
  // 前の滑車の手前の点（ひもが下りはじめる所）
  C.frontPulleyOut = function (out) {
    out.set(0, trolley.yTop + 0.1, trolley.frontZ + 0.75);
    return trolley.group.localToWorld(out);
  };
  C.frontPulleyCenter = function (out) {
    out.set(0, trolley.yTop + 0.1, trolley.frontZ);
    return trolley.group.localToWorld(out);
  };
  C.rearSpool = function (out) { out.set(0, trolley.yTop + 0.45, trolley.rearZ); return trolley.group.localToWorld(out); };
  C.pegMid = function (out) {
    out.set(0, -D.BAR_SIZE / 2 - 0.45, D.ARM_Z - D.BAR_Z);
    return trolley.group.localToWorld(out);
  };
  // 輪が休んでいるときの中心
  C.loopRest = function (out) {
    C.frontPulleyOut(out);
    out.y -= D.LOOP_DROP + D.LOOP_R;
    return out;
  };
  C.hubRestY = () => C.barY() - D.HUB_REST;
  C.maxLift = () => D.HUB_REST - D.HUB_TOP_GAP;
  C.dMax = function () {
    const rest = C.loopRest(_v3).y;
    const byDesk = rest - (D.LOOP_R + 0.35);
    return Math.min(D.SLACK + D.PLATE_TRAVEL + C.maxLift(), byDesk);
  };

  // 爪の角度から局所の点
  C.clawPoint = function (claw, idx, z, out) {
    const p = claw.line[idx];
    out.set(p[0], p[1], z);
    return claw.piv.localToWorld(out);
  };

  // ---- 横桟の操作 ----
  function setBarPose(pos, q) {
    bar.group.position.copy(pos);
    bar.group.quaternion.copy(q);
    bar.group.updateMatrixWorld(true);
  }
  C.barDown = function (endSign) {
    if (st.bar === 'tray' || st.bar === 'placed') {
      if (st.bar === 'placed') { S.box.barLocked = false; S.events.emit('barLifted'); }
      st.bar = 'drag';
      st.barEnd = endSign;
      st.barTo.copy(st.barPos); st.barToQ.copy(st.barQuat);
      st.barSnap = null;
      S.audio.scrape(0.4);
      return true;
    }
    return false;
  };
  const _o = new V3(), _d = new V3(), _hit = new V3(), _sp = { x: 0, y: 0, z: 0 };
  C.barMove = function (sx, sy) {
    const cam = W.camera;
    // くぼみの近くなら吸い寄せる（同じ側の高低二つ）
    let best = null, bd = 70;
    if (S.box.sidesReady()) {
      for (const level of ['low', 'high']) {
        S.box.slotPoint(st.barEnd, level, _v);
        S.toScreen(cam, _v, W.width, W.height, _sp);
        const d = Math.hypot(_sp.x - sx, _sp.y - sy);
        if (d < bd) { bd = d; best = level; }
      }
    }
    st.barSnap = best;
    if (best) {
      S.box.slotPoint(st.barEnd, best, st.barTo);
      st.barTo.x -= st.barEnd * (D.BAR_LEN / 2 - (D.BAR_LEN / 2 - Math.abs(st.barTo.x)));
      st.barTo.x = 0;
      st.barToQ.identity();
    } else {
      S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
      const h = 22.5;
      if (!S.rayPlane(_o, _d, _v2.set(0, 1, 0), _v.set(0, h, 0), _hit)) return;
      _hit.x = S.clamp(_hit.x, -60, 60); _hit.z = S.clamp(_hit.z, -30, 34);
      st.barTo.copy(_hit);
      st.barTo.x -= st.barEnd * (D.BAR_LEN / 2 - 1.4);
      st.barToQ.identity();
    }
  };
  C.barUp = function () {
    if (st.bar !== 'drag') return;
    st.barFrom.copy(st.barPos); st.barFromQ.copy(st.barQuat);
    st.barAnim = 0;
    if (st.barSnap) {
      st.bar = 'placing';
      st.level = st.barSnap;
      S.box.slotPoint(1, st.level, st.barTo); st.barTo.x = 0;
      st.barToQ.identity();
    } else {
      st.bar = 'return';
      st.barTo.copy(TRAY_BAR); st.barToQ.identity();
      if (st.arm === 'hung') { releaseGrip(); st.arm = 'return'; st.armFrom.copy(st.armPos); st.armFromQ.copy(st.armQuat); st.armAnim = 0; }
      unthread();
    }
  };
  function updateBar(dt) {
    if (st.bar === 'drag') {
      st.barPos.lerp(st.barTo, 1 - Math.exp(-14 * dt));
      st.barQuat.slerp(st.barToQ, 1 - Math.exp(-10 * dt));
    } else if (st.bar === 'placing' || st.bar === 'return') {
      st.barAnim = Math.min(1, st.barAnim + dt / (st.bar === 'placing' ? 0.35 : 0.8));
      const t = S.smooth(st.barAnim);
      st.barPos.lerpVectors(st.barFrom, st.barTo, t);
      if (st.bar === 'return') st.barPos.y += Math.sin(t * Math.PI) * 6;
      st.barQuat.slerpQuaternions(st.barFromQ, st.barToQ, t);
      if (st.barAnim >= 1) {
        if (st.bar === 'placing') {
          st.bar = 'placed';
          S.box.barLocked = true;
          S.audio.knock(1);
          for (const s of [-1, 1]) { S.box.slotPoint(s, st.level, _v); W.dust(_v, 3, 1.2, D.FLOOR_Y); }
          S.events.emit('barPlaced', st.level);
        } else {
          st.bar = 'tray'; st.level = null;
          S.audio.thud(0.4, 0.2);
          S.events.emit('barReturned');
        }
      }
    }
    setBarPose(st.barPos, st.barQuat);
  }

  // ---- アームの操作 ----
  C.armDown = function () {
    if (st.arm === 'tray' || st.arm === 'hung') {
      if (st.arm === 'hung') { if (st.held) return false; releaseGrip(); unthread(); }
      st.arm = 'drag';
      st.armSnap = false;
      st.r = 0; st.lift = 0; st.ride = 0;
      S.audio.scrape(0.3);
      return true;
    }
    return false;
  };
  C.armMove = function (sx, sy) {
    const cam = W.camera;
    S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
    let ok = false;
    if (st.bar === 'placed') {
      // 台車の掛け釘の近く
      C.pegMid(_v);
      S.toScreen(cam, _v, W.width, W.height, _sp);
      st.armSnap = Math.hypot(_sp.x - sx, _sp.y - (sy - 25)) < 80;
      ok = S.rayPlane(_o, _d, _v2.set(0, 0, 1), _v3.set(0, 0, D.ARM_Z), _hit);
      if (ok && _hit.y < 3) ok = S.rayPlane(_o, _d, _v2.set(0, 1, 0), _v3.set(0, 9, 0), _hit);
    } else {
      ok = S.rayPlane(_o, _d, _v2.set(0, 1, 0), _v3.set(0, 9, 0), _hit);
    }
    if (!ok) return;
    _hit.x = S.clamp(_hit.x, -55, 55); _hit.z = S.clamp(_hit.z, -28, 34); _hit.y = Math.max(_hit.y, 5);
    st.armDragTo = st.armDragTo || new V3();
    st.armDragTo.copy(_hit);
    st.armDragTo.y += 1.5; // 指は爪の少し下をつまむ
  };
  C.armUp = function () {
    if (st.arm !== 'drag') return;
    st.armFrom.copy(st.armPos); st.armFromQ.copy(st.armQuat); st.armAnim = 0;
    if (st.armSnap && st.bar === 'placed') {
      st.arm = 'hanging';
    } else {
      st.arm = 'return';
    }
  };
  C.pickArmPose = function () { return st.armPos; };

  function trayArmPose() {
    st.armPos.copy(TRAY_ARM); st.armQuat.copy(TRAY_ARM_Q);
    st.phi[0] = st.phi[1] = D.CLAW_CLOSE - 0.05;
  }

  // ---- ひも ----
  function unthread() {
    if (!st.threaded) return;
    st.threaded = false;
    S.events.emit('unthreaded');
  }
  C.tipDown = function () {
    if (st.threaded || st.arm !== 'hung') return false;
    rope.grab = ROPE_N - 3;
    rope.grabPos.copy(rope.p[rope.grab]);
    S.audio.scrape(0.2);
    return true;
  };
  C.tipMove = function (sx, sy) {
    const cam = W.camera;
    S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
    C.frontPulleyCenter(_v);
    // 滑車を含む正面向きの面 → 机より下には行かない
    if (!S.rayPlane(_o, _d, _v2.set(0, 0, 1), _v, _hit) || _hit.y < 0.4) {
      if (!S.rayPlane(_o, _d, _v2.set(0, 1, 0), _v3.set(0, 0.6, 0), _hit)) return;
    }
    S.toScreen(cam, _v, W.width, W.height, _sp);
    st.tipNear = Math.hypot(_sp.x - sx, _sp.y - sy) < 70 || _hit.distanceTo(_v) < 2.6;
    rope.grabPos.copy(_hit);
  };
  C.tipUp = function () {
    rope.grab = -1;
    if (st.tipNear && st.arm === 'hung') {
      st.threaded = true;
      st.threadK = 0;
      // 取り出し口の上から始まるときは、一度離れてから戻った時を「初めて」とする
      st.wasOverChute = st.armPos.x > D.CHUTE_X0 + 0.8;
      S.audio.knock(0.6);
      S.audio.tension(0.3);
      S.events.emit('threaded');
    }
    st.tipNear = false;
  };

  // ---- 輪 ----
  C.loopDown = function (sx, sy) {
    if (!C.ready()) return false;
    const cam = W.camera;
    S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
    if (!S.rayPlane(_o, _d, _v2.set(0, 0, 1), _v.set(0, 0, D.LOOP_Z), _hit)) return false;
    st.held = true;
    st.releasing = false;
    st.grabOff.copy(st.loopVis).sub(_hit); st.grabOff.z = 0;
    st.y0 = _hit.y; st.d0 = st.dEff;
    st.dRaw = st.dEff;
    st.loopC.copy(st.loopVis);
    S.audio.tension(0.15);
    return true;
  };
  C.loopMove = function (sx, sy) {
    if (!st.held) return;
    const cam = W.camera;
    S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
    if (!S.rayPlane(_o, _d, _v2.set(0, 0, 1), _v.set(0, 0, D.LOOP_Z), _hit)) return;
    st.loopC.copy(_hit).add(st.grabOff);
    st.loopC.z = D.LOOP_Z;
    // 台車がついてくる
    const off = bar.group.position.x;
    st.txTarget = S.clamp(st.loopC.x - off, D.TROLLEY_MIN, D.TROLLEY_MAX);
    // 下へ引いた分（小さな上下ぶれはひもの遊びで吸収）
    const dm = C.dMax();
    const raw = S.clamp(st.d0 + (st.y0 - _hit.y), 0, dm);
    st.dRaw = raw;
    const DEAD = 1.0;
    if (raw > st.dEff) st.dEff = raw;
    else if (raw < st.dEff - DEAD) st.dEff = raw + DEAD;
    // 輪は指の下に保つ（届く範囲で）
    st.loopC.x = S.clamp(st.loopC.x, D.TROLLEY_MIN + off - 1.5, D.TROLLEY_MAX + off + 1.5);
    const rest = C.loopRest(_v3).y;
    st.loopC.y = S.clamp(st.loopC.y, rest - dm - 0.2, rest + 2.5);
  };
  C.loopUp = function () {
    if (!st.held) return;
    st.held = false;
    st.releasing = true;
    S.audio.spring();
    S.events.emit('loopReleased');
  };
  // 指で輪をつかんでいるか
  C.loopHeld = () => st.held;
  C.loopWorld = () => st.loopVis;

  // ---- 引き板・爪・アーム ----
  function updateMechanism(dt) {
    const c = D.PLATE_TRAVEL;
    if (st.held) {
      const avail = Math.max(0, st.dEff - D.SLACK);
      const rT = Math.min(st.rLimit, 1, avail / c);
      if (rT > st.r) st.r = S.approach(st.r, rT, 5.5 * dt);
      else if (st.lift <= 0.02 && avail / c < st.r) st.r = S.approach(st.r, Math.max(0, avail / c), 4 * dt);
      st.r = S.clamp(st.r, 0, 1);
      const liftDes = S.clamp(avail - c * st.r, 0, C.maxLift());
      st.lift = S.approach(st.lift, liftDes, (liftDes > st.lift ? 14 : 9) * dt);
    } else {
      // まず爪のばねが開き、続いてアームがゆっくり元の高さへ
      st.r = S.approach(st.r, 0, 6.5 * dt);
      if (st.r < 0.08) st.lift = S.approach(st.lift, 0, 4.2 * dt);
      st.dEff = Math.max(0, Math.min(st.dEff, D.SLACK * 0.4 + c * st.r + st.lift));
      if (st.r <= 0 && st.lift <= 0) { st.dEff = S.approach(st.dEff, 0, 2 * dt); st.releasing = false; }
    }
    // ひもの張り：引くほど高く短く
    const tens = S.clamp((st.dEff - D.SLACK * 0.6) / (c + 2), 0, 1);
    if (st.held && Math.abs(st.dEff - st.tensionLast) > 0.35) { S.audio.tension(tens); st.tensionLast = st.dEff; }
  }

  // 台車と振れ
  function updateTrolley(dt) {
    if (st.bar !== 'placed') { st.txV = 0; }
    else {
      const prevV = st.txV;
      const want = (st.txTarget - st.tx) * 7;
      st.txV = S.clamp(S.damp(st.txV, want, 10, dt), -34, 34);
      st.tx = S.clamp(st.tx + st.txV * dt, D.TROLLEY_MIN, D.TROLLEY_MAX);
      st.txAcc = (st.txV - prevV) / Math.max(dt, 1e-3);
      if (Math.abs(st.txV) > 0.5) S.audio.rub('trolley', S.clamp(Math.abs(st.txV) / 30, 0, 0.6), 1.6);
      else S.audio.rub('trolley', 0, 1.6);
    }
    trolley.group.position.x = st.tx;
    // 滑車が回る
    trolley.marks.rotation.x = -st.dEff / 0.75;
  }

  // アームの姿勢（つられている）
  const _piv = new V3();
  function updateHungArm(dt) {
    const pivY = C.pegMid(_piv).y;
    const hubY = C.hubRestY() + st.lift + st.ride;
    const L = Math.max(1.5, pivY - hubY);
    // 振り子：台車の加速で揺れ、ゆっくり収まる
    for (let k = 0; k < 2; k++) {
      const h = dt / 2;
      const acc = -(980 / L) * Math.sin(st.swing) - (S.clamp(st.txAcc, -400, 400) / L) * Math.cos(st.swing) - 2.4 * st.swingV;
      st.swingV += acc * h;
      st.swing += st.swingV * h;
    }
    st.swing = S.clamp(st.swing, -0.5, 0.5);
    st.armPos.set(_piv.x + Math.sin(st.swing) * L, pivY - Math.cos(st.swing) * L, D.ARM_Z);
    st.armQuat.setFromAxisAngle(_v.set(0, 0, 1), st.swing);
  }

  function updateArm(dt) {
    if (st.arm === 'tray') {
      trayArmPose();
    } else if (st.arm === 'drag') {
      if (st.armDragTo) st.armPos.lerp(st.armDragTo, 1 - Math.exp(-12 * dt));
      st.armQuat.slerp(_q.identity(), 1 - Math.exp(-8 * dt));
      st.phi[0] = S.damp(st.phi[0], D.CLAW_OPEN, 8, dt); st.phi[1] = st.phi[0];
      st.r = 0;
    } else if (st.arm === 'return' || st.arm === 'hanging') {
      st.armAnim = Math.min(1, st.armAnim + dt / (st.arm === 'hanging' ? 0.3 : 0.8));
      const t = S.smooth(st.armAnim);
      if (st.arm === 'hanging') {
        C.pegMid(_v); _v.y = C.hubRestY(); _v.x = C.pegMid(_v2).x; _v.z = D.ARM_Z;
        st.armPos.lerpVectors(st.armFrom, _v, t);
        st.armQuat.slerpQuaternions(st.armFromQ, _q.identity(), t);
      } else {
        st.armPos.lerpVectors(st.armFrom, TRAY_ARM, t);
        st.armPos.y += Math.sin(t * Math.PI) * 5;
        st.armQuat.slerpQuaternions(st.armFromQ, TRAY_ARM_Q, t);
        st.phi[0] = st.phi[1] = S.lerp(st.phi[0], D.CLAW_CLOSE - 0.05, t);
      }
      if (st.armAnim >= 1) {
        if (st.arm === 'hanging') {
          st.arm = 'hung'; st.swing = 0; st.swingV = 0; st.lift = 0; st.ride = 0; st.r = 0;
          S.audio.knock(0.8);
          S.events.emit('armHung');
        } else { st.arm = 'tray'; S.audio.thud(0.35, 0.3); S.events.emit('armReturned'); }
      }
    } else if (st.arm === 'hung') {
      updateHungArm(dt);
    }
    arm.group.position.copy(st.armPos);
    arm.group.quaternion.copy(st.armQuat);
    // 引き板
    arm.plate.position.set(0, S.lerp(-2.1, -0.45, st.arm === 'hung' ? st.r : 0.0), 0);
    if (st.arm !== 'hung') {
      arm.claws[0].piv.rotation.z = st.phi[0];
      arm.claws[1].piv.rotation.z = -st.phi[1];
    }
    arm.group.updateMatrixWorld(true);
  }
  C.applyClaws = function () {
    arm.claws[0].piv.rotation.z = st.phi[0];
    arm.claws[1].piv.rotation.z = -st.phi[1];
    arm.group.updateMatrixWorld(true);
  };

  // 爪のカプセルを今の姿勢に
  const prevCap = new Map();
  function updateCapsules(dt) {
    const on = st.arm === 'hung' || st.arm === 'drag';
    let k = 0;
    for (const [claw, caps] of [[arm.claws[0], capsL], [arm.claws[1], capsR]]) {
      k = 0;
      for (const seg of [[0, 2], [2, 4], [4, 5]]) {
        for (const z of ZS) {
          const cap = caps[k++];
          cap.enabled = on;
          C.clawPoint(claw, seg[0], z, _v);
          C.clawPoint(claw, seg[1], z, _v2);
          const pa = prevCap.get(cap);
          if (pa) {
            cap.va.copy(_v).sub(pa[0]).multiplyScalar(1 / Math.max(dt, 1e-3));
            cap.vb.copy(_v2).sub(pa[1]).multiplyScalar(1 / Math.max(dt, 1e-3));
            const lim = 120;
            if (cap.va.length() > lim) cap.va.setLength(lim);
            if (cap.vb.length() > lim) cap.vb.setLength(lim);
            pa[0].copy(_v); pa[1].copy(_v2);
          } else prevCap.set(cap, [_v.clone(), _v2.clone()]);
          cap.a.copy(_v); cap.b.copy(_v2);
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const cap = capsHub[i];
      cap.enabled = on;
      const z = i ? 1.0 : -1.0;
      cap.a.set(-1.2, -0.6, z); arm.group.localToWorld(cap.a);
      cap.b.set(1.2, -0.6, z); arm.group.localToWorld(cap.b);
      cap.va.set(0, 0, 0); cap.vb.set(0, 0, 0);
    }
  }

  // ---- ひもの形 ----
  const _a = new V3(), _b = new V3(), _c = new V3(), _e = new V3(), _f = new V3();
  const path = [];
  function pushArc(center, r, a0, a1, n, axisX) {
    // x 軸まわり（y,z 平面）の弧
    for (let i = 0; i <= n; i++) {
      const a = S.lerp(a0, a1, i / n);
      path.push(new V3(axisX, center.y + Math.sin(a) * r, center.z + Math.cos(a) * r));
    }
  }
  function threadedTargets(dt) {
    // 引き板 → 後ろの糸車 → 前の滑車 → 下へ → 輪
    path.length = 0;
    const plateTop = _a.set(0, arm.plate.position.y + 0.2, 0);
    arm.group.localToWorld(plateTop);
    const rs = C.rearSpool(_b), fp = C.frontPulleyCenter(_c);
    const x = rs.x;
    // 上り（たるみは弓なり）
    const top = _e.set(plateTop.x, rs.y, rs.z - 0.42);
    const span = top.y - plateTop.y;
    const slack = st.held || st.releasing ? Math.max(0, D.SLACK - st.dEff) : D.SLACK;
    const bow = Math.sqrt(Math.max(0, (3 * span * slack) / 8)) * 0.9;
    const nUp = 10;
    for (let i = 0; i <= nUp; i++) {
      const t = i / nUp;
      const b = Math.sin(t * Math.PI) * bow;
      path.push(new V3(S.lerp(plateTop.x, top.x, t) + Math.sin(t * Math.PI) * st.swing * span * 0.15, S.lerp(plateTop.y, top.y, t), S.lerp(plateTop.z, top.z, t) + b));
    }
    pushArc(rs, 0.42, Math.PI, Math.PI / 2, 4, x);
    // 腕の上を前へ
    const nAlong = 6;
    for (let i = 1; i < nAlong; i++) path.push(new V3(x, rs.y + 0.42, S.lerp(rs.z, fp.z, i / nAlong)));
    pushArc(fp, 0.77, Math.PI / 2, 0, 5, x);
    // 輪へ
    const out = _f.set(x, fp.y, fp.z + 0.77);
    const loopTop = _a.copy(st.loopVis); loopTop.y += D.LOOP_R;
    const dropLen = out.y - loopTop.y;
    const extra = Math.max(0, (D.LOOP_DROP + (st.dEff)) - dropLen); // 遊び
    const nDown = 8;
    for (let i = 1; i <= nDown; i++) {
      const t = i / nDown;
      const b = Math.sin(t * Math.PI) * Math.sqrt(extra * 1.5) * 0.6;
      path.push(new V3(S.lerp(out.x, loopTop.x, t) + b * 0.3, S.lerp(out.y, loopTop.y, t), S.lerp(out.z, loopTop.z, t) + b));
    }
    // 弧長で配る
    const lens = [0];
    for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + path[i].distanceTo(path[i - 1]));
    const total = lens[lens.length - 1];
    let j = 0;
    for (let i = 0; i < ROPE_N; i++) {
      const s = (i / (ROPE_N - 1)) * total;
      while (j < lens.length - 2 && lens[j + 1] < s) j++;
      const t = (s - lens[j]) / Math.max(1e-6, lens[j + 1] - lens[j]);
      rope.tgt[i].lerpVectors(path[j], path[j + 1], S.clamp(t, 0, 1));
      rope.tw[i] = 1;
    }
    // 輪（正面を向いた円。少し傾く）
    const lc = st.loopVis;
    const tilt = st.sway.z * 0.06;
    for (let k = 0; k < LOOP_M; k++) {
      const a = Math.PI / 2 - ((k + 1) / (LOOP_M + 1)) * S.TAU;
      rope.tgt[ROPE_N + k].set(lc.x + Math.cos(a) * D.LOOP_R, lc.y + Math.sin(a) * D.LOOP_R, lc.z + Math.sin(a) * tilt + Math.cos(a) * 0.15);
      rope.tw[ROPE_N + k] = 1;
    }
  }

  // 輪の位置（つかんでいないときは振り子）
  function updateLoop(dt) {
    const rest = C.loopRest(_v);
    const dVis = Math.max(0, st.dEff);
    if (st.held) {
      st.loopVis.copy(st.loopC);
      st.sway.vx = 0; st.sway.vz = 0;
      st.sway.x = st.loopVis.x - rest.x; st.sway.z = 0;
    } else {
      // 減衰する振れ
      const sw = st.sway;
      const k = 14, c = 1.1;
      sw.vx += (-k * sw.x - c * sw.vx - st.txAcc * 0.02) * dt;
      sw.vz += (-k * sw.z - c * sw.vz) * dt;
      sw.x += sw.vx * dt; sw.z += sw.vz * dt;
      st.loopVis.set(rest.x + sw.x, rest.y - dVis, D.LOOP_Z + sw.z);
    }
    loopProxy.position.copy(st.loopVis);
    loopProxy.quaternion.identity();
  }
  C.nudgeLoop = function (vx, vz) { st.sway.vx += vx; st.sway.vz += vz; };

  function updateRope(dt) {
    // 引き板の点
    const pin = _b.set(0, arm.plate.position.y + 0.2, 0);
    arm.group.localToWorld(pin);
    if (st.threaded) {
      st.threadK = Math.min(1, st.threadK + dt * 1.6);
      threadedTargets(dt);
      rope.targetK = S.smooth(st.threadK);
      rope.collide = st.threadK < 1;
    } else {
      rope.targetK = 0;
      rope.collide = true;
    }
    if (rope.targetK >= 1) {
      // 掛かっていれば形はそのまま目標に
      for (let i = 0; i < ROPE_N + LOOP_M; i++) { rope.p[i].copy(rope.tgt[i]); rope.q[i].copy(rope.tgt[i]); }
      rope.p[0].copy(pin);
    } else {
      rope.step(dt, pin);
    }
    const pts = [];
    rope.points(pts);
    ropeTube.update(pts, ROPE_N);
    const lp = [];
    rope.loopPoints(lp);
    loopTube.update(lp, LOOP_M + 2);
    const tp = [];
    for (let i = rope.stiffFrom - 1; i < ROPE_N; i++) tp.push(rope.p[i]);
    tipTube.update(tp, tp.length);
    tipProxy.position.copy(rope.p[ROPE_N - 3]);
    if (!st.threaded) { loopProxy.position.copy(rope.p[ROPE_N + Math.floor(LOOP_M / 2)]); }
  }

  // つりひも
  function updateHangers() {
    const show = st.arm === 'hung' || st.arm === 'hanging';
    for (let i = 0; i < 2; i++) {
      const h = hangers[i];
      h.mesh.visible = show;
      if (!show) continue;
      const peg = trolley.pegs[i];
      const a = _a.set(0, 0, 0.3); peg.localToWorld(a);
      const b = arm.hooks[i].getWorldPosition(_b);
      const len = 5.37;
      const span = a.distanceTo(b);
      const slack = Math.max(0, len - span);
      const sag = Math.sqrt((3 * span * slack) / 8);
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const t = k / 9;
        pts.push(new V3(S.lerp(a.x, b.x, t) + Math.sin(t * Math.PI) * sag * (i ? 0.6 : -0.6), S.lerp(a.y, b.y, t), S.lerp(a.z, b.z, t) + Math.sin(t * Math.PI) * sag * 0.6));
      }
      h.update(pts, 10);
    }
    // 引き板から爪へのつなぎ
    for (let i = 0; i < 2; i++) {
      const claw = arm.claws[i];
      const a = _a.set((i ? 1 : -1) * 1.0, arm.plate.position.y, 0); arm.group.localToWorld(a);
      const b = _b.set(claw.line[1][0] * 0.55, claw.line[1][1] * 0.5, 0); claw.piv.localToWorld(b);
      links[i].userData.set(a, b);
    }
  }

  // ---- 毎フレーム ----
  C.prePhysics = function (dt) {
    updateBar(dt);
    updateTrolley(dt);
    if (st.arm === 'hung') updateMechanism(dt);
    updateArm(dt);
    C.hopUpdate(dt);
    if (S.grip) S.grip.pre(dt);
    C.applyClaws();
    updateCapsules(dt);
    updateLoop(dt);
    // 取り出し口の上へ来た
    if (C.ready() && st.held) {
      const ax = st.armPos.x;
      const over = ax > D.CHUTE_X0 + 0.8;
      if (over && !st.wasOverChute) S.events.emit('overChute');
      st.wasOverChute = over;
    }
  };
  C.postPhysics = function (dt) {
    if (S.grip) S.grip.post(dt);
    updateRope(dt);
    updateHangers();
  };
  function releaseGrip() { if (S.grip) S.grip.release(true); }
  C.releaseGrip = releaseGrip;

  // 盆に入った初めの形
  C.init = function () {
    setBarPose(st.barPos, st.barQuat);
    trayArmPose();
    arm.group.position.copy(st.armPos); arm.group.quaternion.copy(st.armQuat);
    C.applyClaws();
    const pin = new V3(0, -1.2, 0); arm.group.localToWorld(pin);
    rope.layCoil(pin, new V3(0.4, W.TRAY.base + 0.2, 24.0));
    for (let i = 0; i < 40; i++) rope.step(1 / 60, pin);
  };

  // ハイライト
  C.setGlow = function (what, k) {
    const c = 0.2 * k;
    if (what === 'bar') { bar.face.emissive.setRGB(c, c * 0.8, c * 0.45); bar.edge.emissive.setRGB(c * 0.7, c * 0.5, c * 0.3); }
    else if (what === 'arm') { arm.face.emissive.setRGB(c, c * 0.8, c * 0.45); arm.edge.emissive.setRGB(c * 0.7, c * 0.5, c * 0.3); }
    else if (what === 'tip') { tipMat.emissive.setRGB(c * 1.2, c, c * 0.6); }
    else if (what === 'loop') { threadMat.emissive.setRGB(c * 0.9, c * 0.85, c * 0.7); }
    else if (what === 'none') {
      for (const w of ['bar', 'arm', 'tip', 'loop']) C.setGlow(w, 0);
    }
  };
  C.tipWorld = () => rope.p[ROPE_N - 3];
  C.barEndWorld = function (sign, out) {
    out.set(sign * (D.BAR_LEN / 2 - 1.3), 0, 0);
    return bar.group.localToWorld(out);
  };
  // 案内のための小さな弾み
  st.barHop = 0; st.armHop = 0;
  C.hopBar = function (a) { st.barHopV = (st.barHopV || 0) + a * 9; };
  C.hopArm = function (a) { st.armHopV = (st.armHopV || 0) + a * 9; };
  function hopStep(key, dt) {
    const vk = key + 'V';
    st[vk] = (st[vk] || 0) - 60 * dt;
    st[key] += st[vk] * dt;
    if (st[key] < 0) { st[key] = 0; st[vk] = 0; }
    return st[key];
  }
  C.hopUpdate = function (dt) {
    const hb = hopStep('barHop', dt), ha = hopStep('armHop', dt);
    if (st.bar === 'tray' && hb > 0) { bar.group.position.y = st.barPos.y + hb; bar.group.updateMatrixWorld(true); }
    if (st.arm === 'tray' && ha > 0) { arm.group.position.y = st.armPos.y + ha; arm.group.updateMatrixWorld(true); }
  };
  C.loopFree = () => rope.p[ROPE_N + Math.floor(LOOP_M / 2)];
})();
