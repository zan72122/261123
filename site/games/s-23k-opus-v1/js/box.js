// box.js — 一枚につながった段ボールの展開図。折り筋で起きる板、耳と溝の継ぎ目、取り出し口の坂と受け皿
(function () {
  'use strict';
  const S = window.S23, D = S.DIM, CB = S.cardboard, T = D.T, P = S.physics;
  const V3 = THREE.Vector3;
  const BX = (S.box = {});
  const scene = S.world.scene;
  const list = (BX.list = []);
  const P90 = Math.PI / 2;
  const SLOPE_DOWN = P90 + D.SLOPE_ANGLE; // 坂が下りたときの折り角

  // ---- 折り筋で動く板 ----
  function make(o) {
    const h = {
      name: o.name, parent: o.parent || null, angle: o.angle || 0, vel: 0, target: o.angle || 0,
      dragTarget: 0, dragging: false, locked: false, lockAngle: o.lockAngle != null ? o.lockAngle : P90,
      stable: o.stable || [0, P90], min: o.min != null ? o.min : 0, max: o.max != null ? o.max : P90 * 1.04,
      coupled: o.coupled || null, interactive: o.interactive !== false, hop: 0, cols: [], u0: o.u0, u1: o.u1, v0: o.v0 || 0, v1: o.v1,
      speed: 0, joints: [],
    };
    h.pivot = new THREE.Object3D();
    h.pivot.position.set(o.at[0], o.at[1], o.at[2]);
    h.pivot.rotation.y = o.rotY || 0;
    (o.parent ? o.parent.holder : scene).add(h.pivot);
    h.holder = new THREE.Object3D();
    h.pivot.add(h.holder);
    h.cb = CB.makePanel({ u0: o.u0, u1: o.u1, v0: o.v0 || 0, v1: o.v1, step: o.step || 0.5, mask: o.mask, curl: o.curl, curlFrom: o.curlFrom, uvOff: o.uvOff });
    h.holder.add(h.cb.mesh);
    h.cb.mesh.userData.hinged = h;
    h.baseCurl = o.curl || 0;
    if (o.parent && o.crease !== false) {
      h.crease = CB.makeCrease(o.u0, o.u1);
      h.pivot.add(h.crease.mesh);
      h.pivot.add(CB.makeScore(o.u0, o.u1));
    }
    // 当たり判定（内側の面はそのまま、外側へ厚めに）
    const rects = o.rects || (o.noCollide ? [] : [[o.u0, o.u1, o.v0 || 0, o.v1]]);
    for (const r of rects) {
      const st = P.addStatic({ tag: 'panel:' + o.name, owner: h, mu: o.mu || 0.55, e: 0.08 });
      const thick = o.thick || 1.2;
      // 包みが触れる面が裏（-y）の板は、表（+y）側へ厚みを持たせる
      const cy = o.colUp ? -T + thick / 2 : -thick / 2;
      h.cols.push({ st, lc: new V3((r[0] + r[1]) / 2, cy, (r[2] + r[3]) / 2), hh: new V3((r[1] - r[0]) / 2, thick / 2, (r[3] - r[2]) / 2) });
      st.h.copy(h.cols[h.cols.length - 1].hh); st.bound = st.h.length();
    }
    list.push(h);
    BX[o.name] = h;
    return h;
  }

  // ---- 展開図 ----
  const HX = D.HX, HZ = D.HZ, H = D.H;
  // 底板
  const floor = make({ name: 'floor', at: [0, T, 0], u0: -HX, u1: HX, v0: -HZ, v1: HZ, step: 0.5, interactive: false, stable: [0], noCollide: true });
  // 底板は真ん中の帯がほんの少したわんでいる（包みが爪の届く帯へ寄る）
  const SAG = 0.22;
  floor.cb.valley = { v: D.ARM_Z, depth: SAG, w0: D.ARM_Z + HZ, w1: HZ - D.ARM_Z };
  floor.cb.dirty = true;
  {
    const zc = D.ARM_Z;
    for (const [z0, z1] of [[-HZ, zc], [zc, HZ]]) {
      const len = z1 - z0;
      const ang = Math.atan2(SAG, len) * (z0 < zc ? 1 : -1);
      const q = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), ang);
      const c = new V3(0, T - SAG / 2 - 1, (z0 + z1) / 2);
      P.addStatic({ c, h: new V3(HX, 1, len / 2 + 0.05), q, tag: 'panel:floor', mu: 0.55, e: 0.08 });
    }
  }
  // 背板（いちばん大きい板。折り癖で端が少し浮いている）
  const WIN = { u0: -D.CHUTE_X1, u1: -D.CHUTE_X0, v0: D.SLOPE_HINGE, v1: D.SLOPE_HINGE + D.SLOPE_LEN };
  const back = make({
    name: 'back', parent: floor, at: [0, 0, -HZ], rotY: Math.PI, u0: -HX, u1: HX, v1: H, step: 0.4, curl: 0.9, curlFrom: H - 6, angle: 3 * S.DEG,
    mask: (u, v) => !(u > WIN.u0 - 0.02 && u < WIN.u1 + 0.02 && v > WIN.v0 && v < WIN.v1 + 0.02),
    rects: [[-HX, HX, 0, WIN.v0], [WIN.u1, HX, WIN.v0, H], [-HX, WIN.u1, WIN.v1, H], [-HX, WIN.u0, WIN.v0, WIN.v1]],
  });
  // 左右の側板（横桟を受けるくぼみが高低二組）
  function slotMask(front) {
    return (u, v) => {
      const inDepth = front > 0 ? u > D.SLOT_BACK : u < -D.SLOT_BACK;
      if (!inDepth) return true;
      if (v > D.SLOT_LOW[0] && v < D.SLOT_LOW[1]) return false;
      if (v > D.SLOT_HIGH[0] && v < D.SLOT_HIGH[1]) return false;
      return true;
    };
  }
  const left = make({ name: 'left', parent: floor, at: [-HX, 0, 0], rotY: -P90, u0: -HZ, u1: HZ, v1: H, step: 0.5, mask: slotMask(1), curl: 0.35, curlFrom: H - 5 });
  const right = make({ name: 'right', parent: floor, at: [HX, 0, 0], rotY: P90, u0: -HZ, u1: HZ, v1: H, step: 0.5, mask: slotMask(-1), curl: 0.35, curlFrom: H - 5 });
  // 正面の低い縁（取り出し口の前はあけておく）
  const rimCx = (-HX + D.CHUTE_X0) / 2, rimHw = (D.CHUTE_X0 + HX) / 2;
  const rim = make({ name: 'rim', parent: floor, at: [rimCx, 0, HZ], u0: -rimHw, u1: rimHw, v1: D.RIM_H, step: 0.5 });
  // 受け皿（机の上に張り出す舌。平らなまま）
  const dishCx = (D.CHUTE_X0 + HX) / 2, dishHw = (HX - D.CHUTE_X0) / 2;
  const dish = make({ name: 'dish', parent: floor, at: [dishCx, 0, HZ], u0: -dishHw, u1: dishHw, v1: D.DISH_L, step: 0.5, interactive: false, stable: [0], max: 0, thick: 0.4 });
  // 受け皿の縁（二度目の折り）
  const lip = make({ name: 'lip', parent: dish, at: [0, 0, D.DISH_L], u0: -dishHw, u1: dishHw, v1: D.DISH_LIP, step: 0.25 });
  make({ name: 'lipL', parent: dish, at: [-dishHw, 0, 0], rotY: -P90, u0: 0.05, u1: D.DISH_L - 0.05, v1: D.DISH_LIP, step: 0.25, coupled: () => lip.angle, interactive: false });
  make({ name: 'lipR', parent: dish, at: [dishHw, 0, 0], rotY: P90, u0: -D.DISH_L + 0.05, u1: -0.05, v1: D.DISH_LIP, step: 0.25, coupled: () => lip.angle, interactive: false });
  // 坂（背板から切り出した板。一度目の折り）
  const flap = make({
    name: 'flap', parent: back, at: [0, 0, WIN.v0], u0: WIN.u0 + 0.05, u1: WIN.u1 - 0.05, v1: D.SLOPE_LEN - 0.04, step: 0.5,
    stable: [0, SLOPE_DOWN], max: SLOPE_DOWN, lockAngle: SLOPE_DOWN, thick: 1.0, mu: 0.22, colUp: true,
  });
  // 坂の先（受け皿に乗るよう自然に曲がる）
  make({ name: 'tip', parent: flap, at: [0, 0, D.SLOPE_LEN - 0.04], u0: WIN.u0 + 0.05, u1: WIN.u1 - 0.05, v1: D.SLOPE_TIP, step: 0.35, min: -1,
    coupled: () => -D.SLOPE_ANGLE * S.smooth((flap.angle - SLOPE_DOWN + 0.28) / 0.28), interactive: false, thick: 0.6, mu: 0.25, colUp: true });
  // 坂の下をふさぐ三角（坂といっしょに下りる）
  {
    const L = D.SLOPE_LEN - 0.1, ca = Math.cos(D.SLOPE_ANGLE), sa = Math.sin(D.SLOPE_ANGLE);
    const ax = D.SLOPE_HINGE * sa, ay = D.SLOPE_HINGE * ca; // 三つ目の頂点（板の座標）
    // s: 折り筋沿い(0..L)、h: 折り筋から離れる向き(0..ay)。三角形 (0,0)-(L,0)-(ax,ay)
    const tri = (sv, hv) => {
      if (hv < 0 || hv > ay) return false;
      const sMin = (hv / ay) * ax, sMax = L - (hv / ay) * (L - ax);
      return sv > sMin && sv < sMax;
    };
    make({ name: 'gusset', parent: flap, at: [WIN.u1 - 0.05, 0, 0], rotY: P90, u0: -L, u1: 0, v1: ay, step: 0.25,
      mask: (u, v) => tri(-u, v), min: -Math.PI, max: Math.PI,
      coupled: () => S.lerp(178 * S.DEG, P90, S.smooth(flap.angle / SLOPE_DOWN)), interactive: false, noCollide: true, crease: false });
  }

  // 坂の下の三角の当たり（坂が下りているときだけ）。段々の箱で近似し、坂の面より上には出さない
  const gussetCols = [];
  {
    const x = D.CHUTE_X0 - 0.1;
    for (const [z0, z1] of [[-HZ, -1.5], [-1.5, 1.5], [1.5, 3.5]]) {
      const top = T + D.SLOPE_HINGE * (1 - (z1 + HZ) / (2 * HZ)) - 0.15;
      const hgt = top - T;
      gussetCols.push(P.addStatic({ c: new V3(x, T + hgt / 2, (z0 + z1) / 2), h: new V3(0.18, hgt / 2, (z1 - z0) / 2), tag: 'panel:gusset', mu: 0.5, e: 0.08, enabled: false }));
    }
  }

  // ---- 耳と溝 ----
  const joints = (BX.joints = []);
  const slitMat = new THREE.MeshStandardMaterial({ color: 0x3a2612, roughness: 1 });
  function slit(h, u, v, along) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'v' ? 0.18 : 2.7, 0.05, along === 'v' ? 2.7 : 0.18), slitMat);
    m.position.set(u, 0.01, v);
    h.holder.add(m);
    return m;
  }
  function joint(name, tabOn, slotOn, at, rotY, slitU, slitV, slitAlong) {
    const tab = make({ name: name + 'Tab', parent: tabOn, at, rotY, u0: -1.25, u1: 1.25, v1: 1.3, step: 0.25,
      mask: (u, v) => Math.abs(u) < 1.25 * (v < 0.75 ? 1 : 1 - (v - 0.75) * 0.9), interactive: false, noCollide: true, min: -2, max: 2, crease: false });
    const j = { name, tabOn, slotOn, tab, locked: false, bend: 0, bendV: 0, contact: 0 };
    tab.coupled = () => j.bend;
    slit(slotOn, slitU, slitV, slitAlong);
    joints.push(j);
    tabOn.joints.push(j); slotOn.joints.push(j);
    return j;
  }
  const TAB_V = 17.2;
  // 側板の奥の縁に耳、背板の両端に溝
  joint('backL', left, back, [-HZ, 0, TAB_V], -P90, HX - 0.35, TAB_V, 'v');
  joint('backR', right, back, [HZ, 0, TAB_V], P90, -HX + 0.35, TAB_V, 'v');
  // 正面の縁の左端に耳、左の側板の手前に溝
  joint('rimL', rim, left, [-rimHw, 0, 1.75], -P90, HZ - 0.35, 1.75, 'v');

  // ---- 状態 ----
  BX.barLocked = false; // 横桟が掛かっている間は側板を開けない
  BX.isLocked = (h) => h.joints.some((j) => j.locked);
  BX.sidesReady = () => joints[0].locked && joints[1].locked;
  BX.wallsUp = () => joints.every((j) => j.locked);
  BX.slopeReady = () => flap.locked;
  BX.dishReady = () => lip.locked;
  BX.chuteReady = () => flap.locked && lip.locked;
  BX.allFlat = () => [back, left, right, rim].every((h) => h.angle < 0.2);

  function nearestStable(h, bias) {
    let best = h.stable[0], bd = 1e9;
    for (const s of h.stable) {
      const d = Math.abs(s - h.angle - bias);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---- ドラッグ ----
  const _r = new THREE.Matrix4(), _p = new V3();
  BX.canDrag = function (h) {
    if (!h.interactive || h.coupled) return false;
    if (h === flap && back.angle < 80 * S.DEG) return false;
    if (S.game && S.game.allowPanel && !S.game.allowPanel(h)) return false;
    return true;
  };
  BX.beginDrag = function (h, hitWorld, sx, sy) {
    h.dragging = true;
    h.drag = null;
    h.local = h.holder.worldToLocal(hitWorld.clone());
    h.dent = CB.press(h.cb, h.local.x, h.local.z);
    // 触れた瞬間、端がたわんで少し起きる
    const up = h.angle < h.max - 0.2 ? 0.1 : 0;
    h.dragTarget = S.clamp(h.angle + up, h.min, h.max);
    h.lastDrag = h.dragTarget;
    if (sx != null) setupDrag(h, sx, sy);
    S.audio.rub('fold', 0.4, 0.8);
    S.audio.crinkle(0.25);
  };
  // 指の動きを「起こす向き」に投影して角度にする。
  // 触った点が画面上で大きく動く板はその向き、そうでない板（奥の板など）は「上へ引けば起きる」。
  const _sa = { x: 0, y: 0, z: 0 }, _sb = { x: 0, y: 0, z: 0 };
  function screenAt(h, a, out) {
    _r.makeRotationX(-a);
    _p.copy(h.local).applyMatrix4(_r).applyMatrix4(h.pivot.matrixWorld);
    return S.toScreen(S.world.camera, _p, S.world.width, S.world.height, out);
  }
  function setupDrag(h, sx, sy) {
    const W = S.world;
    h.pivot.updateMatrixWorld(true);
    const a0 = h.dragTarget;
    const lo = h.stable[0], hi = h.stable[h.stable.length - 1];
    const goal = a0 < (lo + hi) / 2 ? hi : lo;
    screenAt(h, a0, _sa); screenAt(h, goal, _sb);
    let cx = _sb.x - _sa.x, cy = _sb.y - _sa.y;
    const cl = Math.hypot(cx, cy);
    const md = Math.min(W.width, W.height);
    if (cl > md * 0.12) { cx /= cl; cy /= cl; }
    else { cx = 0; cy = goal > a0 ? -1 : 1; }
    h.drag = { sx, sy, a0, goal, dx: cx, dy: cy, D: S.clamp(cl, md * 0.2, md * 0.42) };
  }
  BX.dragTo = function (h, sx, sy) {
    if (!h.drag) setupDrag(h, sx, sy);
    const g = h.drag;
    const p = ((sx - g.sx) * g.dx + (sy - g.sy) * g.dy) / g.D;
    const want = S.clamp(g.a0 + p * (g.goal - g.a0), h.min, h.max);
    tryUnlock(h, want);
    h.dragTarget = want;
  };
  BX.endDrag = function (h) {
    h.dragging = false;
    CB.releaseAll(h.cb);
    const bias = S.clamp(h.speed * 0.25, -0.4, 0.4);
    h.target = nearestStable(h, bias);
    S.audio.rub('fold', 0, 1);
  };

  // 開くとき：耳が溝から抜ける
  function tryUnlock(h, want) {
    if (!BX.isLocked(h)) {
      if (h === back && flap.angle > 0.15 && want < P90 - 0.05) { flap.locked = false; flap.target = 0; }
      return;
    }
    if (want > h.lockAngle - 0.14) return;
    if (h === flap) { flap.locked = false; return; }
    if ((h === left || h === right) && BX.barLocked) { CB.kick(h.cb, -1.2); return; }
    if (h === back && (flap.angle > 0.15)) { flap.locked = false; flap.target = 0; return; }
    for (const j of h.joints) {
      if (!j.locked) continue;
      if (BX.barLocked && (j.tabOn === left || j.tabOn === right || j.slotOn === left)) { if (j.name !== 'rimL') continue; }
      j.locked = false;
      j.bend = 0.5; j.bendV = 0;
      S.audio.snap(0.6);
      dustAt(j, 3);
    }
    refreshLocks();
  }
  function refreshLocks() {
    for (const h of [back, left, right, rim]) h.locked = BX.isLocked(h);
  }

  const _tw = new V3();
  function dustAt(j, n) {
    j.tab.holder.getWorldPosition(_tw);
    S.world.dust(_tw, n, 1.2, D.FLOOR_Y);
  }

  // ---- 毎フレーム ----
  let rubAmt = 0;
  BX.update = function (dt) {
    rubAmt = 0;
    for (const h of list) {
      const prev = h.angle;
      if (h.coupled) {
        h.angle = h.coupled();
      } else if (h.dragging) {
        let tgt = h.dragTarget;
        if (h.locked) tgt = Math.max(tgt, h.lockAngle - 0.02);
        if (h === back && flap.angle > 0.15) tgt = Math.max(tgt, P90 - 0.02);
        h.angle = S.damp(h.angle, tgt, 16, dt);
        h.vel = (h.angle - prev) / Math.max(dt, 1e-3);
      } else {
        const tgt = h.locked ? h.lockAngle : (h === back && flap.angle > 0.15 ? P90 : h.target);
        // ゆっくり近くの安定した角度へ
        const k = 16, c = 7.2;
        h.vel += (k * (tgt - h.angle) - c * h.vel) * dt;
        h.angle += h.vel * dt;
      }
      h.angle = S.clamp(h.angle, h.min, h.max);
      h.speed = (h.angle - prev) / Math.max(dt, 1e-3);
      h.hop = S.damp(h.hop, 0, 6, dt);
      if (h.baseCurl) {
        const c = h.baseCurl * (1 - S.smooth(h.angle / (P90 * 0.85)));
        if (Math.abs(c - h.cb.curl) > 0.004) { h.cb.curl = c; h.cb.dirty = true; }
      }
      h.holder.rotation.x = -(h.angle + h.hop);
      if (h.crease) CB.setCrease(h.crease, Math.max(1e-4, Math.min(Math.PI, Math.abs(h.angle))));
      CB.deform(h.cb, dt);
      if (!h.coupled) rubAmt = Math.max(rubAmt, Math.abs(h.speed) * 0.9);
    }
    // 坂は下りきったらとまる
    if (!flap.locked && !flap.dragging && flap.angle > SLOPE_DOWN - 0.05 && flap.target === SLOPE_DOWN) lockFlap();
    if (!flap.locked && flap.dragging && flap.angle > SLOPE_DOWN - 0.03) lockFlap();
    if (!lip.locked && lip.angle > P90 - 0.06) { lip.locked = true; lip.lockAngle = P90; S.audio.knock(0.6); CB.kick(lip.cb, 3); S.events.emit('fold', 'lip'); }
    if (lip.locked && lip.dragging && lip.dragTarget < P90 - 0.25) lip.locked = false;
    updateJoints(dt);
    S.audio.rub('fold', S.clamp(rubAmt, 0, 1), 0.9);
    floor.pivot.updateMatrixWorld(true);
    updateColliders(dt);
    const gOn = flap.angle > SLOPE_DOWN - 0.06;
    for (const c of gussetCols) c.enabled = gOn;
  };
  function lockFlap() {
    flap.locked = true;
    S.audio.knock(0.9);
    CB.kick(flap.cb, 4);
    const p = new V3(); flap.holder.localToWorld(p.set((WIN.u0 + WIN.u1) / 2, 0, D.SLOPE_LEN));
    S.world.dust(p, 4, 3, D.FLOOR_Y);
    S.events.emit('fold', 'flap');
  }

  function updateJoints(dt) {
    for (const j of joints) {
      const a = j.tabOn.angle / S.DEG, b = j.slotOn.angle / S.DEG;
      let want = 0;
      if (!j.locked) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (hi > 78 && lo > 50) {
          // 耳の先が相手の板の表を滑って反る
          want = S.smooth((lo - 50) / 36) * 0.95;
          if (Math.abs(j.tabOn.speed) + Math.abs(j.slotOn.speed) > 0.2) S.audio.scrape(0.3);
        }
        j.contact = want;
        if (a >= 87.2 && b >= 87.2) {
          // 溝と高さがそろって、反りが戻る
          j.locked = true;
          j.bendV = -9;
          S.audio.snap(1);
          CB.kick(j.tabOn.cb, 2.2); CB.kick(j.slotOn.cb, -1.6);
          dustAt(j, 5);
          refreshLocks();
          S.events.emit('joint', j);
        }
      }
      if (j.locked) {
        // 戻るときの小さなはね返り
        j.bendV += (-260 * j.bend - 10 * j.bendV) * dt;
        j.bend += j.bendV * dt;
      } else {
        j.bend = S.damp(j.bend, want, 12, dt);
      }
    }
  }

  const _c = new V3(), _q = new THREE.Quaternion(), _sc = new V3();
  function updateColliders(dt) {
    for (const h of list) {
      if (!h.cols.length) continue;
      h.holder.matrixWorld.decompose(_c, _q, _sc);
      for (const col of h.cols) {
        _p.copy(col.lc).applyMatrix4(h.holder.matrixWorld);
        col.st.set(_p, _q, dt);
      }
    }
  }

  // ---- 位置の問い合わせ ----
  // くぼみに収まった横桟の端の位置
  BX.slotPoint = function (side, level, out) {
    const h = side < 0 ? left : right;
    const r = level === 'high' ? D.SLOT_HIGH : D.SLOT_LOW;
    const front = side < 0 ? 1 : -1;
    out.set(front * (D.SLOT_BACK + D.BAR_SIZE / 2 + 0.05), -T / 2, r[0] + D.BAR_SIZE / 2);
    return h.holder.localToWorld(out);
  };
  BX.barY = (level) => (level === 'high' ? D.BAR_HIGH : D.BAR_LOW);
  // 案内用：その板の、触ってほしい点と、起こしたあとの点
  BX.guidePoints = function (h, outA, outB) {
    const u = (h.u0 + h.u1) / 2 + (h === back ? -4 : 0), v = h.v1 * 0.82;
    h.pivot.updateMatrixWorld(true);
    _r.makeRotationX(-h.angle);
    outA.set(u, 0, v).applyMatrix4(_r).applyMatrix4(h.pivot.matrixWorld);
    const goal = h === flap ? SLOPE_DOWN : P90;
    _r.makeRotationX(-goal);
    outB.set(u, 0, v).applyMatrix4(_r).applyMatrix4(h.pivot.matrixWorld);
  };
  // 案内の指が見せる動き（画面座標）：触る点と、引く先
  BX.gesture = function (h) {
    const a = new V3(), b = new V3();
    BX.guidePoints(h, a, b);
    h.pivot.updateMatrixWorld(true);
    const saved = h.local, savedT = h.dragTarget, savedD = h.drag;
    h.local = h.holder.worldToLocal(a.clone());
    h.dragTarget = h.angle;
    const st = S.toScreen(S.world.camera, a, S.world.width, S.world.height, { x: 0, y: 0, z: 0 });
    setupDrag(h, st.x, st.y);
    const g = h.drag;
    const out = { ax: st.x, ay: st.y, bx: st.x + g.dx * g.D * 1.08, by: st.y + g.dy * g.D * 1.08 };
    h.local = saved; h.dragTarget = savedT; h.drag = savedD;
    return out;
  };
  BX.pickMeshes = () => list.filter((h) => h.interactive && !h.coupled).map((h) => h.cb.mesh);
  BX.setGlow = function (h, k) { CB.setGlow(h.cb, k); };
  BX.hopPanel = function (h, amt) { h.hop = amt; };
  BX.SLOPE_DOWN = SLOPE_DOWN;
  BX.WIN = WIN;

  // 中に包みがあれば、開いた板の上にあるか
  BX.isInside = function (p) {
    return p.x > -HX && p.x < HX && p.z > -HZ && p.z < HZ;
  };
  BX.inChute = function (p) { return p.x > D.CHUTE_X0 - 0.3 && p.x < HX && p.z > -HZ - 0.5 && p.z < HZ + D.DISH_L + 1; };
  BX.inDish = function (p) { return p.x > D.CHUTE_X0 - 0.5 && p.x < HX + 0.5 && p.z > HZ - 0.2 && p.z < HZ + D.DISH_L + 0.8; };

  BX.update(0.016);
})();
