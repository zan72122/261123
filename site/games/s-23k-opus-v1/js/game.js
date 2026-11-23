// game.js — 流れ（組み立て→遊ぶ→ばらして二周目）、次に触る物の案内、視点、毎フレームの順番
(function () {
  'use strict';
  const S = window.S23, W = S.world, D = S.DIM, B = S.box, C = S.crane, PR = S.prizes, IN = S.input, GD = S.guide;
  const V3 = THREE.Vector3;
  const G = (S.game = {});

  G.mode = 'craft';    // craft | front | low
  G.transition = 0;    // 低い視点へ下りる途中
  G.dishDrops = 0;
  G.playIdle = 0;
  G.allowPanel = () => true;

  // ---- 次に触る物 ----
  function prizeToSuggest() {
    let best = null, bd = 1e9;
    for (const p of PR.list) {
      if (p.held || p.dragged) continue;
      const w = p.where();
      if (w === 'box') continue;
      const d = p.body.pos.distanceTo(new V3(-3, 0, 2)) + (w === 'tray' ? 0 : w === 'dish' ? 4 : 8);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function nextTarget() {
    const j = B.joints;
    if (!B.wallsUp()) {
      if (!j[0].locked) return B.back.angle < 1.45 ? { kind: 'panel', ref: B.back } : { kind: 'panel', ref: B.left };
      if (!j[1].locked) return B.back.angle < 1.45 ? { kind: 'panel', ref: B.back } : { kind: 'panel', ref: B.right };
      if (!j[2].locked) return B.left.angle < 1.45 ? { kind: 'panel', ref: B.left } : { kind: 'panel', ref: B.rim };
    }
    if (!B.slopeReady()) return { kind: 'panel', ref: B.flap };
    if (!B.dishReady()) return { kind: 'panel', ref: B.lip };
    const st = C.state;
    if (st.bar !== 'placed') return st.bar === 'tray' || st.bar === 'drag' ? { kind: 'bar', ref: 'bar' } : null;
    if (st.arm !== 'hung') return st.arm === 'tray' || st.arm === 'drag' ? { kind: 'arm', ref: 'arm' } : null;
    if (!st.threaded) return { kind: 'tip', ref: 'tip' };
    const inBox = PR.list.filter((p) => p.where() === 'box' && !p.dragged).length;
    if (inBox === 0 && !C.grip) {
      const p = prizeToSuggest();
      if (p) return { kind: 'prize', ref: p };
    }
    if (G.dishDrops >= 3 && G.playIdle > 10 && !st.held) return { kind: 'barEnd', ref: 'bar' };
    return { kind: 'loop', ref: 'loop' };
  }

  // ---- 視点 ----
  const _c = new V3(), _p = new V3(), _t = new V3();
  function craftFocus(tg) {
    if (!tg) return [new V3(0, 6, 2), 34];
    if (tg.kind === 'panel') {
      switch (tg.ref.name) {
        case 'back': return [new V3(2, 5, -9), 25];
        case 'left': return [new V3(-15, 5, -3), 21];
        case 'right': return [new V3(15, 5, -3), 21];
        case 'rim': return [new V3(-6, 4, 1), 18];
        default: return [new V3(9, 5, 2), 15];
      }
    }
    switch (tg.kind) {
      case 'bar': return [new V3(-7, 7, 12), 29];
      case 'arm': return [new V3(-2, 8, 8), 23];
      case 'tip': return [new V3(5, 7, 5), 17];
      case 'prize': return [new V3(-9, 3, 13), 27];
      case 'barEnd': return [new V3(0, 7, 3), 30];
    }
    return [new V3(0, 6, 2), 34];
  }
  function craftView(tg) {
    const [c, r] = craftFocus(tg);
    const portrait = W.isPortrait();
    const fov = portrait ? 50 : 40;
    W.frameView(c, r, 52, 6, fov, _p);
    W.setView(_p, c, fov, 1.5);
  }
  function frontView() {
    const portrait = W.isPortrait();
    const fov = portrait ? 52 : 42;
    _c.set(S.clamp(C.state.tx * 0.4, -6, 6), 7, 2);
    W.frameView(_c, 19, 27, 4, fov, _p);
    W.setView(_p, _c, fov, 1.4);
  }
  G.lowCx = 8;
  // 低い視点：正面の低い縁越しにのぞき込む高さ。輪がいつも画面に入るよう、縦画面では正面寄り
  function lowParams() {
    return W.isPortrait()
      ? { az: 13, el: 17, dist: 31, fov: 66, tz: 2.6, ty: 5.2, w: 0.2 }
      : { az: 20, el: 16, dist: 22, fov: 54, tz: 1.6, ty: 4.8, w: 0.4 };
  }
  G.lowAim = (armX) => { const q = lowParams(); return S.clamp(S.lerp(armX, 10.5, q.w), -9, 12.5); };
  function lowView(rate) {
    const q = lowParams();
    const az = q.az * S.DEG, el = q.el * S.DEG;
    _t.set(G.lowCx, q.ty, q.tz);
    _p.set(_t.x + Math.sin(az) * Math.cos(el) * q.dist, _t.y + Math.sin(el) * q.dist, _t.z + Math.cos(az) * Math.cos(el) * q.dist);
    W.setView(_p, _t, q.fov, rate || 1.2);
  }

  // ---- 出来事 ----
  S.events.on('firstTouch', () => GD.firstTouch());
  S.events.on('overChute', () => {
    if (G.mode !== 'front') return;
    G.mode = 'low';
    G.transition = 1;
    G.lowCx = G.lowAim(C.state.armPos.x);
    S.audio.swell();
  });
  S.events.on('barLifted', () => { G.mode = 'craft'; W.rig.pin = null; });
  S.events.on('barPlaced', () => { if (C.ready()) G.mode = 'front'; });
  S.events.on('threaded', () => { G.mode = 'front'; });
  S.events.on('loopReleased', () => { W.rig.pin = null; G.transition = 0; });
  S.events.on('drop', () => { G.playIdle = 0; });

  // 受け皿に届いた包みを数える
  const inDish = new Set();
  function countDish() {
    for (const p of PR.list) {
      const w = p.where();
      if (w === 'dish' && !inDish.has(p) && !p.dragged) { inDish.add(p); G.dishDrops++; }
      else if (w !== 'dish' && inDish.has(p)) inDish.delete(p);
    }
  }

  // ---- 毎フレーム ----
  G.update = function (dt) {
    const st = C.state;
    if (!C.ready() && G.mode !== 'craft') G.mode = 'craft';
    const tg = nextTarget();
    if (!IN.dragging()) GD.setTarget(tg);
    if (IN.dragging() || st.releasing) G.playIdle = 0; else G.playIdle += dt;
    countDish();

    const rig = W.rig;
    const held = st.held;
    if (G.mode === 'craft') {
      rig.pin = null;
      rig.hold = IN.dragging();
      if (!rig.hold) craftView(GD.getTarget());
    } else if (G.mode === 'front') {
      rig.pin = null;
      rig.hold = IN.dragging();
      const cur = GD.getTarget();
      if (!rig.hold) { if (cur && cur.kind === 'prize') craftView(cur); else frontView(); }
    } else if (G.mode === 'low') {
      if (G.transition > 0) {
        // 輪を握ったまま視点がなめらかに下りる：輪は指の下に保つ
        lowView(1.25);
        rig.hold = false;
        if (held) rig.pin = { world: C.loopWorld(), sx: IN.pointer.x, sy: IN.pointer.y };
        else rig.pin = null;
        if (rig.pos.distanceTo(rig.wantPos) < 0.6) { G.transition = 0; rig.pin = null; }
      } else {
        rig.pin = null;
        rig.hold = IN.dragging();
        if (held) {
          // 画面の端へ寄せると視点が横へ流れる
          const ex = IN.pointer.x / W.width;
          let v = 0;
          if (ex < 0.13) v = -(0.13 - ex) / 0.13; else if (ex > 0.87) v = (ex - 0.87) / 0.13;
          if (v) {
            const dx = v * 11 * dt;
            const nx = S.clamp(G.lowCx + dx, -9, 13);
            const real = nx - G.lowCx;
            G.lowCx = nx;
            rig.pos.x += real; rig.tgt.x += real; rig.wantPos.x += real; rig.wantTgt.x += real;
          }
        } else if (!rig.hold) {
          const cur = GD.getTarget();
          if (cur && (cur.kind === 'prize' || cur.kind === 'barEnd') && G.playIdle > 1.2) {
            // 箱が空になったら、盆や受け皿の包みが見える高さへ引く
            craftView(cur);
          } else {
            // 離したら、アームと取り出し口の両方が入るようにゆっくり寄る
            G.lowCx = S.damp(G.lowCx, G.lowAim(st.armPos.x), 0.6, dt);
            lowView(0.9);
          }
        }
      }
    }
  };

  // ---- 起動 ----
  PR.spawnTray();
  C.init();
  craftView(nextTarget());
  W.snapView();
  GD.setTarget(nextTarget());

  let last = performance.now();
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; last = performance.now(); if (running) requestAnimationFrame(frame); });
  function frame(now) {
    if (!running) return;
    const dt = S.clamp((now - last) / 1000, 0, 0.05);
    last = now;
    IN.update(dt);
    G.update(dt);
    B.update(dt);
    C.prePhysics(dt);
    IN.prePhysics(dt);
    S.physics.step(dt);
    C.postPhysics(dt);
    PR.update(dt);
    W.update(dt);
    GD.update(dt, IN.dragging());
    W.render();
    GD.render(W.renderer);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
