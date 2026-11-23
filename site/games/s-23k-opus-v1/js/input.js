// input.js — 指一本のタップとドラッグ。触れた物だけが反応する（画面のどこでも反応はしない）。
(function () {
  'use strict';
  const S = window.S23, W = S.world, D = S.DIM, C = S.crane;
  const V3 = THREE.Vector3;
  const IN = (S.input = {});
  const canvas = W.canvas;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let active = null;
  let firstDone = false;
  IN.pointer = { x: 0, y: 0, down: false };
  IN.dragging = () => !!active;
  IN.activeKind = () => (active ? active.h.kind : null);
  IN.activeRef = () => (active ? active.ref : null);

  const handlers = [];
  IN.add = (h) => handlers.push(h);

  // ---- 板 ----
  IN.add({
    kind: 'panel',
    meshes: () => S.box.pickMeshes(),
    down(hit, sx, sy) {
      const h = hit.object.userData.hinged;
      if (!h || !S.box.canDrag(h)) return null;
      S.box.beginDrag(h, hit.point, sx, sy);
      return h;
    },
    move(ref, sx, sy) { S.box.dragTo(ref, sx, sy); },
    up(ref) { S.box.endDrag(ref); },
  });

  // ---- 包み ----
  const _o = new V3(), _d = new V3(), _p = new V3(), _n = new V3();
  function groundAt(x, z) {
    if (S.box.isInside(_p.set(x, 0, z))) return D.FLOOR_Y;
    if (S.box.inDish(_p.set(x, 0, z))) return D.FLOOR_Y;
    const t = W.TRAY;
    if (x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1) return t.base;
    return 0;
  }
  function wallsUp() { return S.box.back.angle > 1.0 || S.box.rim.angle > 1.0; }
  function hoverHeight(x, z) {
    if (S.box.isInside(_p.set(x, 0, z))) return wallsUp() ? 5.6 : 2.8;
    if (S.box.inDish(_p.set(x, 0, z))) return S.box.lip.angle > 1 ? 3.6 : 2.8;
    return 3.0;
  }
  IN.add({
    kind: 'prize',
    meshes: () => S.prizes.meshes(),
    down(hit) {
      const pr = hit.object.userData.prize;
      if (!pr || pr.held) return null;
      const b = pr.body;
      b.mode = 'kin'; b.wake();
      b.kinVel.set(0, 0, 0); b.kinAng.set(0, 0, 0);
      pr.dragged = true;
      pr.dragT = b.pos.clone();
      pr.dragZ = b.pos.z;
      pr.dragH = b.pos.y - groundAt(b.pos.x, b.pos.z) + 1.5;
      pr.dragGround = null;
      S.audio.crinkle(0.35);
      return pr;
    },
    move(pr, sx, sy) {
      const cam = W.camera;
      S.rayFromScreen(cam, sx, sy, W.width, W.height, _o, _d);
      const b = pr.body;
      const low = _d.y > -0.42;
      if (!low) {
        // 上から：指の下の地面を探し、その上に浮かせる（離すとそこへ落ちる）
        let gy = pr.dragGround != null ? pr.dragGround : 0;
        for (let k = 0; k < 3; k++) {
          if (!S.rayPlane(_o, _d, _n.set(0, 1, 0), _p.set(0, gy, 0), pr.dragT)) return;
          gy = groundAt(pr.dragT.x, pr.dragT.z);
        }
        pr.dragGround = gy;
        if (S.box.isInside(pr.dragT)) pr.dragT.z = S.clamp(pr.dragT.z, D.ARM_Z - 1.4, D.ARM_Z + 1.4);
        const hh = hoverHeight(pr.dragT.x, pr.dragT.z);
        pr.dragH = S.damp(pr.dragH, hh, 9, 1 / 60);
        pr.dragT.y = gy + pr.dragH;
      } else {
        // 低い視点：正面向きの面を動かす。縁より上へ持ち上げると箱の中へ
        if (!S.rayPlane(_o, _d, _n.set(0, 0, 1), _p.set(0, 0, pr.dragZ), pr.dragT)) return;
        const overBox = Math.abs(pr.dragT.x) < D.HX - 1 && pr.dragT.y > D.RIM_H + 1.6;
        if (overBox) pr.dragZ = S.damp(pr.dragZ, D.ARM_Z, 6, 1 / 60);
        pr.dragT.z = pr.dragZ;
      }
      pr.dragT.x = S.clamp(pr.dragT.x, -60, 60);
      pr.dragT.z = S.clamp(pr.dragT.z, -30, 34);
      const g = groundAt(pr.dragT.x, pr.dragT.z);
      pr.dragT.y = Math.max(pr.dragT.y, g + pr.half.y + 0.25);
      if (S.box.isInside(pr.dragT) && wallsUp()) pr.dragT.x = S.clamp(pr.dragT.x, -D.HX + pr.half.x * 0.6, D.HX - pr.half.x * 0.6);
    },
    update(pr, dt) {
      const b = pr.body;
      b.kinVel.copy(pr.dragT).sub(b.pos).multiplyScalar(12).clampLength(0, 220);
      b.kinAng.set(0, 0, 0);
    },
    up(pr) {
      const b = pr.body;
      b.mode = 'dyn';
      b.vel.copy(b.kinVel).multiplyScalar(0.25).clampLength(0, 40);
      b.ang.set(0, 0, 0);
      b.wake();
      pr.dragged = false;
      S.events.emit('prizePlaced', pr);
    },
  });

  // ---- 横桟 ----
  IN.add({
    kind: 'bar',
    meshes: () => {
      const st = C.state;
      if (st.bar === 'tray') return C.barParts.meshes.concat([C.proxies.barL, C.proxies.barR]);
      if (st.bar === 'placed') return [C.proxies.barL, C.proxies.barR];
      return [];
    },
    down(hit) {
      const st = C.state;
      if (st.bar === 'placed' && (st.held || C.grip)) return null;
      const lp = C.barParts.group.worldToLocal(hit.point.clone());
      const sign = lp.x < 0 ? -1 : 1;
      return C.barDown(sign) ? 'bar' : null;
    },
    move(ref, sx, sy) { C.barMove(sx, sy); },
    up() { C.barUp(); },
  });

  // ---- アーム ----
  IN.add({
    kind: 'arm',
    meshes: () => {
      const st = C.state;
      if (st.arm === 'tray' || (st.arm === 'hung' && !st.threaded && !st.held && !C.grip && st.lift < 0.3)) {
        const out = [C.proxies.arm];
        C.armParts.group.traverse((o) => { if (o.isMesh && o !== C.proxies.arm) out.push(o); });
        return out;
      }
      return [];
    },
    down() { return C.armDown() ? 'arm' : null; },
    move(ref, sx, sy) { C.armMove(sx, sy); },
    up() { C.armUp(); },
  });

  // ---- ひもの硬い先端 ----
  IN.add({
    kind: 'tip',
    meshes: () => (C.state.arm === 'hung' && !C.state.threaded ? [C.proxies.tip] : []),
    down() { return C.tipDown() ? 'tip' : null; },
    move(ref, sx, sy) { C.tipMove(sx, sy); },
    up() { C.tipUp(); },
  });

  // ---- 輪 ----
  IN.add({
    kind: 'loop',
    meshes: () => (C.ready() ? [C.proxies.loop] : []),
    down(hit, sx, sy) { return C.loopDown(sx, sy) ? 'loop' : null; },
    move(ref, sx, sy) { C.loopMove(sx, sy); },
    update(ref, dt) { C.loopMove(IN.pointer.x, IN.pointer.y); },
    up() { C.loopUp(); },
    priority: 1,
  });

  // ---- 当たりを探す ----
  function tryPick(sx, sy) {
    ndc.set((sx / W.width) * 2 - 1, -(sy / W.height) * 2 + 1);
    ray.setFromCamera(ndc, W.camera);
    const all = [], owner = new Map();
    for (const h of handlers) {
      const ms = h.meshes();
      for (const m of ms) { all.push(m); owner.set(m, h); }
    }
    const hits = ray.intersectObjects(all, false);
    // 輪は少し優先（細いので）
    hits.sort((a, b) => (a.distance - (owner.get(a.object).priority || 0) * 3) - (b.distance - (owner.get(b.object).priority || 0) * 3));
    for (const hit of hits) {
      const h = owner.get(hit.object);
      const ref = h.down(hit, sx, sy);
      if (ref) return { h, ref };
    }
    return null;
  }
  function pick(sx, sy) {
    let r = tryPick(sx, sy);
    if (r) return r;
    // 小さな子の指：近くを少し探す
    for (const rad of [16, 30]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * S.TAU;
        r = tryPick(sx + Math.cos(a) * rad, sy + Math.sin(a) * rad);
        if (r) return r;
      }
    }
    return null;
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.audio.start();
    const p = pos(e);
    IN.pointer.x = p.x; IN.pointer.y = p.y;
    if (!firstDone) { firstDone = true; S.events.emit('firstTouch'); }
    if (active) return;
    S.guide.touched();
    const r = pick(p.x, p.y);
    if (r) {
      active = { h: r.h, ref: r.ref, id: e.pointerId };
      IN.pointer.down = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      S.events.emit('grab', r.h.kind, r.ref);
    }
  }, { passive: false });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    const p = pos(e);
    IN.pointer.x = p.x; IN.pointer.y = p.y;
    active.h.move(active.ref, p.x, p.y);
  }, { passive: false });
  function end(e) {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    active = null;
    IN.pointer.down = false;
    a.h.up(a.ref);
    S.guide.touched();
    S.events.emit('release', a.h.kind, a.ref);
  }
  canvas.addEventListener('pointerup', (e) => { S.audio.start(); end(e); });
  // iOS では指を離した時でないと音が始まらないことがある
  canvas.addEventListener('touchend', () => S.audio.start(), { passive: true });
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  IN.update = function (dt) {
    if (!active || active.h.kind === 'prize') return;
    if (active.h.update) active.h.update(active.ref, dt);
  };
  // 包みのドラッグは物理の前に毎フレーム更新
  IN.prePhysics = function (dt) {
    if (active && active.h.kind === 'prize') active.h.update(active.ref, dt);
  };
})();
