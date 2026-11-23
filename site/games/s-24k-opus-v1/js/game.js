/* game.js — 卓上の流れ：口枠を収め、寒天と棒を入れ、押して、切り、皿を手前へ、つゆとごま、次の皿へ。
   物の状態そのものが進み具合を表す（点数・失敗・時間制限はない）。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;
  const GM = (G.game = {
    grab: null, started: false, activeBlock: null, cuts: 0,
    camMode: 'intro', lastPieces: [], stack: [], plating: null, front: null, parks: [null, null, null],
    sincePush: 99, lastRelease: -99, nextAmbient: 6, dripAt: -1, contact: false, sessionOut: 0, platingMoved: false,
    outAtReach: -1,
  });
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const AXIS_O = new THREE.Vector3(0, L.TUBE.y, 0), AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // こすれる音：そのフレームでいちばん速く動いた木の道具の速さ
  let scr = 0;
  const scrape = (v) => { scr = Math.max(scr, Math.abs(v)); };

  GM.init = function () {
    const D = G.dish;
    // 出口の下の小皿（初めの向きは毎回少し違う）
    const d0 = D.add(L.PLATING.x, L.TRAY.floorY, L.PLATING.z, G.rr(0, Math.PI * 2));
    d0.collide = true; d0.place = 'plating';
    GM.plating = d0;
    // 隣に重ねてある空の小皿
    for (let k = 0; k < 3; k++) {
      const d = D.add(L.STACK.x, k * 1.05, L.STACK.z, G.rr(0, Math.PI * 2));
      d.place = 'stack'; d.collide = false;
      GM.stack.push(d);
    }
    const fr = G.kit.frame;
    fr.onSeat = () => {
      const p = V(10.6, 8.6, 0);
      if (G.audio) G.audio.wood(G.audio.panOf(p), 1.0, 1.1);
      G.fx.woodDust(p, 8);
    };
    G.kit.onRareBubble = (h) => G.strands.addBubble(h);
    const rod = G.kit.rod;
    rod.x = 0; rod.dent = 0; rod.target = 0; rod.vel = 0; rod.carryPos = rod.restPos.clone(); rod.state = 'rest';
  };

  // ---------------- 何を触ってよいか ----------------
  GM.pickable = function (kind, ref) {
    switch (kind) {
      case 'frame': return !G.kit.frame.seated && !G.kit.frame.seating;
      case 'knob': return G.kit.frame.seated;
      case 'block': return ref.state === 'board';
      case 'rod': return G.kit.rod.state !== 'inserting' && G.kit.rod.state !== 'returning' && G.kit.rod.state !== 'withdraw';
      case 'plate':
        if (ref.place === 'stack') return GM.stack[GM.stack.length - 1] === ref;
        return true;
      case 'pitcher': return true;
      case 'spoon': return true;
    }
    return false;
  };

  // ---------------- 指が触れた ----------------
  GM.onDown = function (hit) {
    GM.lastInput = G.time;
    if (!hit) return;
    const kind = hit.object.userData.kind, ref = hit.object.userData.ref;
    const p = hit.point.clone();
    if (!GM.started) GM.started = true;
    switch (kind) {
      case 'frame': seatFrame(); return;
      case 'block': grabBlock(ref, p); return;
      case 'rod': grabRod(p); return;
      case 'knob': grabKnob(p); return;
      case 'plate': grabPlate(ref, p); return;
      case 'pitcher': grabPitcher(p); return;
      case 'spoon': grabSpoon(p); return;
    }
  };
  GM.onMove = function () {
    const g = GM.grab;
    if (!g) return;
    if (g.move) g.move();
  };
  GM.onUp = function (isTap) {
    const g = GM.grab;
    GM.grab = null;
    if (g && g.up) g.up(isTap);
  };

  // ---------------- 口枠 ----------------
  function seatFrame() {
    const fr = G.kit.frame;
    if (fr.seated || fr.seating) return;
    fr.seating = true; fr.seatT = 0;
    if (G.audio) G.audio.wood(G.audio.panOf(V(10.4, 16, 0)), 0.35, 1.5);
    GM.camMode = 'kit';
  }

  // ---------------- 角寒天 ----------------
  // 運ぶ物は筒の高さの面で指についてくる（画面で見た入口へそのまま届く）
  const CARRY = new THREE.Plane(new THREE.Vector3(0, 1, 0), -L.TUBE.y);
  function grabBlock(b, p) {
    b.state = 'carry';
    b.carry = b.group.position.clone();
    b.wobV += 4;
    if (G.audio) G.audio.squish(G.audio.panOf(p), 0.4);
    GM.grab = {
      kind: 'block', ref: b,
      move() {
        const hp = G.input.onPlane(CARRY, tmp);
        if (!hp) return;
        b.carry.set(hp.x + L.BLOCK.len / 2, L.TUBE.y, M.clamp(hp.z, -20, 34));
      },
      up() {
        if (b.state === 'carry') { b.state = 'returning'; }
      },
    };
    GM.grab.move();
  }

  function canInsertBlock() {
    const rod = G.kit.rod;
    return G.kit.frame.seated && !GM.activeBlock && rod.state !== 'in' && rod.state !== 'inserting';
  }

  function updateBlocks(dt) {
    for (const b of G.kit.blocks) {
      const g = b.group;
      if (b.state === 'carry') {
        const prev = g.position.clone();
        g.position.lerp(b.carry, M.damp(12, dt));
        const v = g.position.clone().sub(prev).multiplyScalar(1 / Math.max(dt, 1e-3));
        b.wobV += -v.x * 0.012 * dt * 60; b.wobZV += -v.z * 0.012 * dt * 60;
        g.rotation.z = M.lerp(g.rotation.z, M.clamp(-v.x * 0.004, -0.15, 0.15), M.damp(8, dt));
        g.rotation.x = M.lerp(g.rotation.x, M.clamp(v.z * 0.004, -0.15, 0.15), M.damp(8, dt));
        // 筒の入口に近づいたら、道具の形に任せて入る
        const frontX = g.position.x;
        const entry = L.TUBE.x0 - 0.9;
        if (canInsertBlock() && Math.abs(frontX - entry) < 7.5 && Math.abs(g.position.z) < 7 && Math.abs(g.position.y - L.TUBE.y) < 8) {
          b.state = 'inserting'; b.insT = 0; b.insFrom = g.position.clone();
          if (GM.grab && GM.grab.ref === b) GM.grab = null;
        }
      } else if (b.state === 'returning') {
        g.position.lerp(b.homePos(), M.damp(9, dt));
        g.rotation.x = M.lerp(g.rotation.x, 0, M.damp(8, dt)); g.rotation.z = M.lerp(g.rotation.z, 0, M.damp(8, dt));
        if (g.position.distanceTo(b.homePos()) < 0.05) {
          b.state = 'board'; b.home(); b.wobV -= 3; b.wetT = 0;
          if (G.audio) G.audio.squish(G.audio.panOf(g.position), 0.5);
        }
      } else if (b.state === 'inserting') {
        b.insT += dt;
        const ent = V(L.TUBE.x0 - 0.9, L.TUBE.y, 0);
        const t = b.insT;
        if (t < 0.28) {
          const k = M.easeInOut(t / 0.28);
          g.position.lerpVectors(b.insFrom, ent, k);
          g.rotation.x = M.lerp(g.rotation.x, 0, k); g.rotation.z = M.lerp(g.rotation.z, 0, k);
        } else if (t < 0.46) {
          g.position.copy(ent); g.rotation.set(0, 0, 0);
          if (!b.touched) {
            b.touched = true;
            if (G.audio) G.audio.squish(G.audio.panOf(ent), 0.9);
            G.fx.splash(V(ent.x + 0.2, ent.y + 1.5, 0), 6, 22, V(-0.5, 0.3, 0));
          }
          b.squash = Math.sin((t - 0.28) / 0.18 * Math.PI) * 1.0;
        } else {
          const k = M.easeOut((t - 0.46) / 0.75);
          g.position.set(M.lerp(ent.x, L.TUBE.x1, k), L.TUBE.y, 0);
          b.squash = Math.max(0, b.squash - dt * 4);
          scrape(k < 1 ? 14 * (1 - k) : 0);
          if (k >= 1) {
            b.state = 'tube'; GM.activeBlock = b; b.squash = 0; b.wobV += 3;
            G.strands.pressure = 0;
            if (G.audio) G.audio.squish(G.audio.panOf(V(10, 12, 0)), 0.6);
            G.fx.splash(V(L.EXIT_X + 0.2, L.TUBE.y, 0), 8, 16, V(0.6, 0.2, 0));
            bulge(0.25);
          }
        }
      } else if (b.state === 'tube') {
        g.position.set(L.TUBE.x1, L.TUBE.y, 0);
      }
      // ヒントの弾み
      if (b.state === 'board') { g.position.y = b.homePos().y + (G.hint.key === 'block' + b.i ? G.hint.bob : 0); }
      b.update(dt);
    }
  }

  // 出口の格子いっぱいに濡れた四角が膨らむ
  function bulge(a) { GM.bulgeT = Math.max(GM.bulgeT || 0, a); }

  // ---------------- 押し棒 ----------------
  function grabRod(p) {
    const rod = G.kit.rod;
    if (rod.state === 'in') {
      const t0 = G.input.onLine(AXIS_O, AXIS_X);
      const off = rod.x - t0;
      rod.held = true; rod.target = rod.x; rod.grabX = rod.x;
      GM.grab = {
        kind: 'rod',
        move() {
          const t = G.input.onLine(AXIS_O, AXIS_X);
          rod.target = t + off;
        },
        up() { releaseRod(); },
      };
      return;
    }
    // 卓の上：持ち上げて運ぶ（指は棒のまん中あたり）
    rod.state = 'carry';
    if (G.audio) G.audio.wood(G.audio.panOf(p), 0.3, 0.9);
    GM.grab = {
      kind: 'rod',
      move() {
        const hp = G.input.onPlane(CARRY, tmp);
        if (!hp) return;
        rod.carryPos.set(hp.x + rod.len / 2, L.TUBE.y, M.clamp(hp.z, -20, 34));
      },
      up() { if (rod.state === 'carry') rod.state = 'returning'; },
    };
    rod.carryPos.copy(rod.group.position);
    GM.grab.move();
  }

  function releaseRod() {
    const rod = G.kit.rod;
    rod.held = false;
    if (rod.state !== 'in') return;
    if (GM.contact && rod.dent > 0.02) {
      // へこんでいた分だけ、棒がかすかに戻る
      rod.spring = rod.dent * 0.9;
      G.strands.tremble(1.0);
      if (G.audio) G.audio.squish(G.audio.panOf(V(rod.x, 12, 0)), 0.3);
      GM.dripAt = G.time + G.rr(0.6, 1.1);
    }
    rod.target = rod.x - (rod.spring || 0);
    GM.lastRelease = G.time;
  }

  function updateRod(dt) {
    const rod = G.kit.rod;
    const g = rod.group;
    const blk = GM.activeBlock;
    let speed = 0;
    if (rod.state === 'rest') {
      g.position.copy(rod.restPos);
      if (G.hint.key === 'rod') g.position.y += G.hint.bob;
      g.rotation.set(0, 0, 0);
    } else if (rod.state === 'carry' || rod.state === 'returning' || rod.state === 'out') {
      const want = rod.state === 'carry' ? rod.carryPos : rod.restPos;
      const prev = g.position.x;
      g.position.lerp(want, M.damp(rod.state === 'carry' ? 12 : 7, dt));
      g.rotation.z = M.lerp(g.rotation.z, rod.state === 'carry' ? 0.04 : 0, M.damp(6, dt));
      speed = (g.position.x - prev) / Math.max(dt, 1e-3);
      if (rod.state === 'carry' && blk && blk.state === 'tube') {
        // 頭が入口の面取りに近づいたら、自然に収まる
        const hx = g.position.x;
        if (hx > L.TUBE.x0 - 9 && hx < L.TUBE.x0 + 2 && Math.abs(g.position.z) < 6 && Math.abs(g.position.y - L.TUBE.y) < 6) {
          rod.state = 'inserting'; rod.insT = 0; rod.insFrom = g.position.clone();
          if (GM.grab && GM.grab.kind === 'rod') GM.grab = null;
        }
      }
      if (rod.state === 'returning' && g.position.distanceTo(rod.restPos) < 0.06) {
        rod.state = 'rest';
        if (G.audio) G.audio.wood(G.audio.panOf(rod.restPos), 0.5, 0.75);
      }
    } else if (rod.state === 'withdraw') {
      const prev = g.position.x;
      g.position.x -= Math.min(40 * dt, g.position.x - (L.TUBE.x0 - 2.5));
      rod.x = g.position.x;
      speed = (g.position.x - prev) / Math.max(dt, 1e-3);
      if (g.position.x <= L.TUBE.x0 - 2.45) {
        rod.state = 'returning';
        G.fx.woodDust(V(L.TUBE.x0 - 0.8, L.TUBE.y - 2.4, 0), 4);
        if (G.audio) G.audio.wood(G.audio.panOf(g.position), 0.6, 1.0);
      }
    } else if (rod.state === 'inserting') {
      rod.insT += dt;
      const ent = V(L.TUBE.x0 - 1.4, L.TUBE.y, 0);
      if (rod.insT < 0.3) {
        g.position.lerpVectors(rod.insFrom, ent, M.easeInOut(rod.insT / 0.3));
        g.rotation.z = M.lerp(g.rotation.z, 0, 0.3);
      } else {
        const k = M.easeOut((rod.insT - 0.3) / 0.35);
        g.position.set(M.lerp(ent.x, L.ROD_START_X, k), L.TUBE.y, 0);
        g.rotation.set(0, 0, 0);
        if (k >= 1) {
          rod.state = 'in'; rod.x = L.ROD_START_X; rod.target = rod.x; rod.dent = 0;
          if (G.audio) G.audio.wood(G.audio.panOf(ent), 0.8, 0.95);
          G.fx.woodDust(V(L.TUBE.x0 - 0.6, L.TUBE.y - 2.6, 0), 5);
        }
      }
    } else if (rod.state === 'in') {
      const prevX = rod.x;
      const back = blk ? L.TUBE.x1 - blk.Lr : L.ROD_MAX_X;
      let pushed = 0;
      if (rod.spring > 0) {
        // 離した直後のはね返り
        const s = Math.min(rod.spring, dt * 3);
        rod.spring -= s; rod.dent = Math.max(0, rod.dent - s);
      }
      if (rod.held && rod.target > rod.x + 0.001) {
        if (rod.x < back - 0.002) {
          // 遊び：まだ寒天に触れていない
          rod.x = Math.min(back, rod.x + Math.min(rod.target - rod.x, 70 * dt));
          GM.contact = false;
          rod.dent = Math.max(0, rod.dent - dt * 2);
        }
        if (rod.x >= back - 0.002 && blk && blk.Lr > 0.001) {
          if (!GM.contact) {
            GM.contact = true;
            const cp = V(back, L.TUBE.y + 1, 0);
            if (G.audio) G.audio.squish(G.audio.panOf(cp), 0.8);
            G.fx.splash(cp.setY(L.TUBE.y + 2.2), 5, 10, V(0, 0.4, 0));
            bulge(0.3);
          }
          const force = rod.target - rod.x;
          const dentT = M.clamp(force * 0.22, 0, 0.36);
          rod.dent = M.lerp(rod.dent, dentT, M.damp(14, dt));
          const v = M.clamp(force * 3.2, 0, 24);
          const dx = Math.min(v * dt, blk.Lr) * M.clamp(rod.dent / 0.12, 0, 1);
          if (dx > 0) {
            blk.Lr -= dx; pushed = dx;
            G.strands.extrude(dx, dt);
            GM.sessionOut += dx * L.EXTRUDE_RATIO;
            GM.sincePush = 0;
            // 出口の細かな水しぶき
            if (G.rand() < dx * 6) G.fx.splash(V(L.EXIT_X + 0.3, L.holeY((G.rand() * 16) | 0), L.holeZ((G.rand() * 16) | 0)), 1, 14, V(0.8, 0.1, 0));
            if (G.rand() < dx * 3) G.fx.splash(V(L.TUBE.x1 - blk.Lr, L.TUBE.y + 2.3, G.rr(-0.6, 0.6)), 1, 7, V(0, 0.5, 0));
          }
          rod.x = L.TUBE.x1 - blk.Lr + rod.dent;
          if (blk.Lr <= 0.005) {
            blk.Lr = 0; blk.state = 'used'; GM.activeBlock = null; GM.contact = false; rod.dent = 0;
            rod.x = L.ROD_MAX_X;
            if (G.audio) G.audio.wood(G.audio.panOf(V(10, 12, 0)), 0.7, 0.8);
          }
        }
      } else if (rod.held && !blk && rod.target < rod.x && rod.x < rod.grabX - 2.0) {
        // 押し切った後に引くと、棒はするりと抜ける
        rod.state = 'withdraw'; rod.held = false;
        if (GM.grab && GM.grab.kind === 'rod') GM.grab = null;
        if (G.audio) G.audio.wood(G.audio.panOf(g.position), 0.4, 0.9);
      } else if (rod.target < rod.x - 0.001) {
        // 引く：出た分はそのまま
        rod.x = Math.max(rod.target, rod.x - 60 * dt);
        if (GM.contact && rod.x < back - 0.01) { GM.contact = false; G.strands.tremble(0.5); }
        rod.dent = Math.max(0, rod.dent - dt * 3);
        // 入口から抜けた
        if (rod.x < L.TUBE.x0 - 1.2 && rod.held) {
          rod.state = 'carry';
          rod.carryPos.set(rod.x - 2, L.TUBE.y, 0);
          g.position.set(rod.x, L.TUBE.y, 0);
          rod.held = false;
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -L.TUBE.y);
          const off = g.position.clone().sub(G.input.onPlane(plane, tmp2) || g.position);
          GM.grab = {
            kind: 'rod',
            move() { const hp = G.input.onPlane(plane, tmp); if (hp) rod.carryPos.set(hp.x + off.x, L.TUBE.y, hp.z + off.z); },
            up() { if (rod.state === 'carry') rod.state = 'returning'; },
          };
          if (G.audio) G.audio.wood(G.audio.panOf(g.position), 0.6, 1.0);
          G.fx.woodDust(V(L.TUBE.x0 - 0.8, L.TUBE.y - 2.4, 0), 4);
        }
      } else if (!rod.held) {
        rod.dent = Math.max(0, rod.dent - dt * 2.5);
        if (blk && GM.contact) rod.x = L.TUBE.x1 - blk.Lr + rod.dent;
      }
      rod.x = Math.min(rod.x, L.ROD_MAX_X);
      if (rod.state === 'in') {
        g.position.set(rod.x, L.TUBE.y, 0);
        if (G.hint.key === 'rodpush' && !rod.held) g.position.x += G.hint.bob * 0.5;
      }
      speed = (rod.x - prevX) / Math.max(dt, 1e-3);
      G.strands.pressure = rod.dent;
      if (blk) blk.dent = GM.contact ? rod.dent : Math.max(0, blk.dent - dt * 2);
      if (pushed > 0) GM.pushSpeed = M.lerp(GM.pushSpeed || 0, pushed / dt, 0.3);
    }
    scrape(speed * (GM.contact ? 1.6 : 0.8));
    GM.sincePush += dt;
    // 先端の膨らみ
    GM.bulgeT = Math.max(0, (GM.bulgeT || 0) - dt * 0.6);
    const bl = Math.max(GM.bulgeT, rod.state === 'in' && GM.contact ? rod.dent * 0.8 : 0);
    for (let h = 0; h < 16; h++) {
      const c = G.strands.rooted[h];
      const want = c.e < 1.2 ? bl * (1 - c.e / 1.2) + 0.05 : 0;
      c.bulge = M.lerp(c.bulge, want, M.damp(10, dt));
      if (GM.activeBlock && c.e < 0.12 && bl > 0.02) {
        // ほんの少しだけ顔を出す
        c.e = Math.max(c.e, 0.02);
        c.dirty = true;
      }
    }
  }

  // ---------------- 切り糸のつまみ ----------------
  function grabKnob(p) {
    const fr = G.kit.frame;
    const origin = V(L.CUT_X, L.TUBE.y + L.FRAME.size / 2 + 1.7, 0);
    const t0 = G.input.onLine(origin, AXIS_Z);
    const off = fr.knobZ - t0;
    const ready = G.strands.reachedCount() > 0 || G.strands.outLength() > 3;
    if (!ready) {
      // まだ皿に届いていない：つまみが小さく揺れるだけ
      fr.wiggle = 1;
      if (G.audio) G.audio.wood(G.audio.panOf(p), 0.2, 1.8);
      return;
    }
    fr.cutFrom = fr.knobZ;
    GM.grab = {
      kind: 'knob',
      move() {
        const t = G.input.onLine(origin, AXIS_Z);
        fr.knobTarget = M.clamp(t + off, -L.KNOB_Z, L.KNOB_Z);
      },
      up() { fr.knobTarget = undefined; },
    };
    fr.knobTarget = fr.knobZ;
  }

  function updateKnob(dt) {
    const fr = G.kit.frame;
    if (fr.wiggle > 0) {
      fr.wiggle = Math.max(0, fr.wiggle - dt * 3);
      fr.slider.position.x = Math.sin(fr.wiggle * 30) * 0.08 * fr.wiggle;
    } else fr.slider.position.x = 0;
    if (fr.knobTarget === undefined) {
      fr.hintOff = G.hint.key === 'knob' ? -Math.sign(fr.knobZ || -1) * G.hint.bob * 0.8 : 0;
      return;
    }
    fr.hintOff = 0;
    const prev = fr.knobZ;
    const d = fr.knobTarget - fr.knobZ;
    fr.knobZ += M.clamp(d, -26 * dt, 26 * dt);
    const z0 = Math.min(prev, fr.knobZ), z1 = Math.max(prev, fr.knobZ);
    // 列の中心を横切ったら、その列をほどく
    for (let c = 0; c < 4; c++) {
      const cz = L.colZ(c);
      if (cz > z0 && cz <= z1 && Math.abs(fr.knobZ - prev) > 1e-5) {
        const pieces = G.strands.cutColumn(c);
        if (pieces.length) {
          GM.lastPieces = pieces;
          GM.cutHappened = G.time;
          fr.tremble = 1;
          if (G.audio) G.audio.pluck(G.audio.panOf(V(L.CUT_X, L.TUBE.y, cz)), 0.9);
          G.fx.splash(V(L.CUT_X + 0.2, L.TUBE.y, cz), 4, 12, V(0.4, -0.2, 0));
        }
      }
    }
    if (Math.abs(fr.knobZ) >= L.KNOB_Z - 0.01 && Math.sign(fr.knobZ) !== Math.sign(fr.cutFrom || -1) && !fr.endClick) {
      fr.endClick = true;
      GM.cuts++;
      GM.sessionOut = 0; GM.outAtReach = -1; GM.platingMoved = false;
      if (G.audio) G.audio.wood(G.audio.panOf(V(L.CUT_X, 17, fr.knobZ)), 0.6, 1.4);
      fr.cutFrom = fr.knobZ;
    }
    if (Math.abs(fr.knobZ) < L.KNOB_Z - 0.3) fr.endClick = false;
    if (Math.abs(fr.knobZ - prev) > 1e-4) scrape((fr.knobZ - prev) / Math.max(dt, 1e-3) * 0.5);
  }

  // ---------------- 小皿 ----------------
  function slotOf(d) {
    if (GM.plating === d) return 'plating';
    if (GM.front === d) return 'front';
    const i = GM.parks.indexOf(d);
    if (i >= 0) return 'park' + i;
    return null;
  }
  function freeSlot(d) {
    if (GM.plating === d) GM.plating = null;
    if (GM.front === d) GM.front = null;
    const i = GM.parks.indexOf(d);
    if (i >= 0) GM.parks[i] = null;
  }

  function grabPlate(d, p) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.y);
    const off = V(d.cx - p.x, 0, d.cz - p.z);
    const origin = { x: d.cx, z: d.cz, y: d.by, slot: slotOf(d), place: d.place };
    const st = { moved: false, sx: G.input.px, sy: G.input.py };
    GM.grab = {
      kind: 'plate', ref: d,
      move() {
        const dist = Math.hypot(G.input.px - st.sx, G.input.py - st.sy);
        if (!st.moved && dist < 10) return;
        if (!st.moved) {
          st.moved = true;
          if (d.place === 'stack') { GM.stack.pop(); d.collide = true; }
          d.place = 'drag';
          d.dragging = true;
          if (G.audio) G.audio.wood(G.audio.panOf(V(d.cx, d.by, d.cz)), 0.3, 1.6);
        }
        const hp = G.input.onPlane(plane, tmp);
        if (!hp) return;
        d.want = { x: hp.x + off.x, z: hp.z + off.z };
      },
      up(isTap) {
        if (!st.moved) {
          // ふちをつつく
          d.toLocal(p.x, p.y, p.z, tmp2);
          d.tap(tmp2.x, tmp2.z, 1);
          if (G.audio) G.audio.ceramic(G.audio.panOf(p), 0.9);
          if (G.audio && d.volume > 1) G.audio.drip(G.audio.panOf(p), 0.3, 0.7);
          return;
        }
        d.dragging = false;
        dropPlate(d, origin);
      },
    };
  }

  function connected(d) { return G.strands.connectedTo(d.id); }

  // 動かしてよい範囲に収める
  function constrainPlate(d, x, z) {
    const T = L.TRAY, R = L.PLATE.R;
    if (connected(d)) {
      const Z = L.PLATING_ZONE;
      x = M.clamp(x, Z.x0, Z.x1); z = M.clamp(z, Z.z0, Z.z1);
    } else {
      x = M.clamp(x, -12, 62); z = M.clamp(z, -16, 30);
      // 台座・筒の下には入らない
      if (x < T.x0 + R + 0.9 && z > -8 && z < 9 && x > -14) x = Math.max(x, T.x0 + R + 0.9);
    }
    // 他の皿と重ならない
    for (const o of G.dish.list) {
      if (o === d || o.place === 'stack' && o !== GM.stack[GM.stack.length - 1]) continue;
      const dx = x - o.cx, dz = z - o.cz, dd = Math.sqrt(dx * dx + dz * dz), min = R * 2 + 0.2;
      if (dd < min && dd > 1e-4) { x = o.cx + dx / dd * min; z = o.cz + dz / dd * min; }
    }
    return { x, z };
  }

  function inTray(x, z) { const T = L.TRAY, R = L.PLATE.R; return x > T.x0 + R && x < T.x1 - R && z > T.z0 + R - 1 && z < T.z1 - R + 1; }

  function dropPlate(d, origin) {
    const x = d.cx, z = d.cz;
    const Z = L.PLATING_ZONE;
    const cands = [];
    const add = (slot, px, pz, y, ok) => { if (ok) cands.push({ slot, x: px, z: pz, y, dist: M.dist2(x, z, px, pz) }); };
    const con = connected(d);
    // 出口の下：その位置のまま
    if (x >= Z.x0 - 1 && x <= Z.x1 + 1 && z >= Z.z0 - 1 && z <= Z.z1 + 1.5 && (!GM.plating || GM.plating === d)) {
      const c = constrainPlate(d, x, Math.min(z, Z.z1));
      add('plating', M.clamp(c.x, Z.x0, Z.x1), M.clamp(c.z, Z.z0, Z.z1), L.TRAY.floorY, true);
      cands[cands.length - 1].dist = 0;
    }
    if (!con) {
      add('front', L.FRONT.x, L.FRONT.z, L.TRAY.floorY - L.FRONT.depth, !GM.front || GM.front === d);
      L.PARK.forEach((P, i) => add('park' + i, P.x, P.z, P.tray ? L.TRAY.floorY - L.BACK.depth : 0, !GM.parks[i] || GM.parks[i] === d));
    }
    cands.sort((a, b) => a.dist - b.dist);
    let best = cands.length && cands[0].dist < 11 ? cands[0] : null;
    if (!best) {
      // 元の場所へ
      if (origin.place === 'stack') {
        d.place = 'stack'; d.collide = false;
        GM.stack.push(d);
        d.anim = { x: L.STACK.x, z: L.STACK.z, y: (GM.stack.length - 1) * 1.05 };
        return;
      }
      best = { slot: origin.slot, x: origin.x, z: origin.z, y: origin.y };
    }
    freeSlot(d);
    if (best.slot === 'plating') { GM.plating = d; d.place = 'plating'; }
    else if (best.slot === 'front') { GM.front = d; d.place = 'front'; }
    else if (best.slot && best.slot.startsWith('park')) { GM.parks[+best.slot.slice(4)] = d; d.place = 'park'; }
    else { d.place = 'plating'; GM.plating = d; }
    d.anim = { x: best.x, z: best.z, y: best.y };
  }

  function updatePlates(dt) {
    for (const d of G.dish.list) {
      if (d.dragging && d.want) {
        const c = constrainPlate(d, d.want.x, d.want.z);
        const prevX = d.cx;
        d.cx = M.lerp(d.cx, c.x, M.damp(16, dt));
        d.cz = M.lerp(d.cz, c.z, M.damp(16, dt));
        const it = inTray(d.cx, d.cz);
        const lift = connected(d) ? 0.15 : it ? 1.3 : 2.6;
        d.by = M.lerp(d.by, it ? L.TRAY.floorY : 0, M.damp(10, dt));
        d.lift = M.lerp(d.lift, lift, M.damp(10, dt));
        if (Math.abs(d.cx - prevX) > 0.01 && GM.plating === d) GM.platingMoved = true;
        if (it || connected(d)) scrape(Math.abs(d.cx - prevX) / Math.max(dt, 1e-3) * 0.35);
      } else if (d.anim) {
        d.cx = M.lerp(d.cx, d.anim.x, M.damp(10, dt));
        d.cz = M.lerp(d.cz, d.anim.z, M.damp(10, dt));
        d.by = M.lerp(d.by, d.anim.y, M.damp(10, dt));
        d.lift = M.lerp(d.lift, 0, M.damp(9, dt));
        if (M.dist2(d.cx, d.cz, d.anim.x, d.anim.z) < 0.03 && Math.abs(d.by - d.anim.y) < 0.02 && d.lift < 0.02) {
          d.cx = d.anim.x; d.cz = d.anim.z; d.by = d.anim.y; d.lift = 0; d.anim = null;
          // 盆のくぼみに収まる音と、器の小さな揺れ
          if (G.audio) G.audio.wood(G.audio.panOf(V(d.cx, d.by, d.cz)), 0.4, 1.25);
          d.tvx += G.rr(-0.4, 0.4); d.tvz += G.rr(-0.4, 0.4);
          if (d.place !== 'stack') d.collide = true;
        }
      } else if (d.place === 'stack') {
        const k = GM.stack.indexOf(d);
        d.cx = L.STACK.x; d.cz = L.STACK.z; d.by = k * 1.05 + (G.hint.key === 'stack' && k === GM.stack.length - 1 ? G.hint.bob * 0.7 : 0);
      } else if (G.hint.key === 'plate' + d.id) {
        d.lift = G.hint.bob * 0.5;
      } else if (!d.dragging) {
        d.lift = M.lerp(d.lift, 0, M.damp(8, dt));
      }
    }
  }

  // ---------------- 片口・さじ ----------------
  function grabPitcher(p) {
    const P = G.kit.pitcher;
    const y = L.TRAY.floorY + 6.6;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y + 3));
    const hp0 = G.input.onPlane(plane, tmp2) || p;
    const off = V(P.pos.x - hp0.x, 0, P.pos.z - hp0.z);
    G.tools.grabPitcher();
    G.tools.movePitcher(hp0.x, hp0.z, off.x, off.z);
    if (G.audio) G.audio.ceramic(G.audio.panOf(p), 0.3);
    GM.grab = {
      kind: 'pitcher',
      move() {
        const hp = G.input.onPlane(plane, tmp);
        if (!hp) return;
        G.tools.movePitcher(M.clamp(hp.x, 0, 50), M.clamp(hp.z, -14, 30), off.x, off.z);
      },
      up() { G.tools.releasePitcher(); },
    };
  }
  function grabSpoon(p) {
    const S = G.kit.spoon;
    const y = L.TRAY.floorY + 7.2;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hp0 = G.input.onPlane(plane, tmp2) || p;
    const off = V(S.pos.x - hp0.x, 0, S.pos.z - hp0.z);
    G.tools.grabSpoon();
    if (G.audio) G.audio.wood(G.audio.panOf(p), 0.2, 1.7);
    GM.grab = {
      kind: 'spoon',
      move() {
        const hp = G.input.onPlane(plane, tmp);
        if (!hp) return;
        G.tools.moveSpoon(M.clamp(hp.x + off.x, 0, 50), M.clamp(hp.z + off.z, -14, 30));
      },
      up() { G.tools.releaseSpoon(); },
    };
    G.tools.moveSpoon(S.pos.x, S.pos.z);
  }

  // ---------------- 次に触る物（一つだけ） ----------------
  function chooseHint() {
    const H = G.hint, K = G.kit, S = G.strands, rod = K.rod, fr = K.frame;
    const topOf = (o) => o.getWorldPosition(new THREE.Vector3());
    if (!fr.seated) {
      return H.set('frame', fr.group, { from: () => V(10.4, L.TUBE.y + L.FRAME.size / 2 + L.FRAME.raise * (1 - fr.seat) + 0.2, 0) });
    }
    const blk = GM.activeBlock;
    const pd = GM.plating;
    // 手前の皿の仕上げ
    if (GM.front && !GM.front.dragging) {
      const f = GM.front;
      const fc = () => V(f.cx, f.by + 2.5, f.cz);
      if (!f.poured) return H.set('pitcher', K.pitcher.group, { from: () => K.pitcher.pos.clone().add(V(0, 5.5, 0)), to: () => fc().add(V(1.5, 6, 3.5)) });
      if (!f.sesamed) return H.set('spoon', K.spoon.group, { from: () => K.spoon.pos.clone().add(V(0, 0.6, 0)), to: () => fc().add(V(0, 5, 2)) });
      if (!f.sent) return H.set('plate' + f.id, f.group, { from: () => fc(), to: () => V(L.BACK.x, L.TRAY.floorY + 2.5, L.BACK.z) });
    }
    if (rod.state === 'in' && !blk) {
      // 押し切った：棒を抜く
      return H.set('rodpush', rod.group, { from: () => V(rod.x - rod.len + 1.5, L.TUBE.y + 1.6, 0), to: () => V(rod.x - rod.len - 9, L.TUBE.y + 1.6, 0) });
    }
    if (!blk && rod.state !== 'in') {
      const b = K.blocks.find((bb) => bb.state === 'board');
      if (b && rod.state !== 'carry') return H.set('block' + b.i, b.group, { from: () => b.group.position.clone().add(V(-L.BLOCK.len / 2, 2.6, 0)), to: () => V(L.TUBE.x0 - 9, L.TUBE.y + 2.6, 0) });
      if (!b && !pd) { H.clear(); return; }
    }
    if (blk && rod.state !== 'in') {
      return H.set('rod', rod.group, { from: () => rod.group.position.clone().add(V(-rod.len / 2, 1, 0)), to: () => V(L.TUBE.x0 - rod.len / 2 - 2, L.TUBE.y + 1, 0) });
    }
    if (!pd || pd.place !== 'plating') {
      if (GM.front && !GM.front.sent) { H.clear(); return; }
      const top = GM.stack[GM.stack.length - 1];
      const park = GM.parks.find((d) => d && !connected(d));
      if (top) return H.set('stack', top.group, { from: () => V(top.cx, top.by + 2.4, top.cz), to: () => V(L.PLATING.x, L.TRAY.floorY + 2.5, L.PLATING.z) });
      if (park) return H.set('plate' + park.id, park.group, { from: () => V(park.cx, park.by + 2.4, park.cz), to: () => V(L.PLATING.x, L.TRAY.floorY + 2.5, L.PLATING.z) });
      H.clear(); return;
    }
    if (blk && rod.state === 'in') {
      const reached = S.reachedCount();
      const onPlate = pd.pieces.length > 0;
      if (reached === 0 && onPlate && GM.cuts > 0 && GM.sessionOut < 0.5 && !connected(pd)) {
        // 切り分けた皿：手前へ引く
        return H.set('plate' + pd.id, pd.group, { from: () => V(pd.cx, pd.by + 2.4, pd.cz), to: () => V(L.FRONT.x, L.TRAY.floorY + 2.4, L.FRONT.z) });
      }
      if (reached > 0 && GM.outAtReach < 0) GM.outAtReach = GM.sessionOut;
      const since = reached > 0 ? GM.sessionOut - GM.outAtReach : 0;
      if (reached > 0 && since > 7 && !GM.platingMoved) {
        return H.set('plate' + pd.id, pd.group, { from: () => V(pd.cx + 5, pd.by + 2.3, pd.cz + 2), to: () => V(pd.cx + 11, pd.by + 2.3, pd.cz + 2) });
      }
      if (reached > 0 && since > 15) {
        const kz = () => fr.knobZ;
        return H.set('knob', fr.slider, { from: () => V(L.CUT_X, L.TUBE.y + 5.4, kz()), to: () => V(L.CUT_X, L.TUBE.y + 5.4, -Math.sign(kz() || -1) * L.KNOB_Z) });
      }
      return H.set('rodpush', rod.group, { from: () => V(rod.x - rod.len + 1.8, L.TUBE.y + 1.6, 0), to: () => V(rod.x - rod.len + 8, L.TUBE.y + 1.6, 0) });
    }
    if (pd && pd.pieces.length > 0 && !connected(pd)) {
      return H.set('plate' + pd.id, pd.group, { from: () => V(pd.cx, pd.by + 2.4, pd.cz), to: () => V(L.FRONT.x, L.TRAY.floorY + 2.4, L.FRONT.z) });
    }
    H.clear();
  }

  // ---------------- 視点 ----------------
  const pts = [];
  function circle(cx, cy, cz, r, n) { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(V(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r)); } }
  function pieceEnd() {
    const p = GM.lastPieces && GM.lastPieces[GM.lastPieces.length - 1];
    if (!p) return null;
    const i = p.n - 1;
    if (p.isStatic && p.staticPlate >= 0) return G.dish.byId[p.staticPlate].toWorld(p.lx[i], p.ly[i], p.lz[i], new THREE.Vector3());
    return V(p.px[i], p.py[i], p.pz[i]);
  }

  function updateCamera(dt) {
    const C = G.cam, por = C.portrait();
    const K = G.kit, rod = K.rod;
    pts.length = 0;
    let mode = GM.camMode;
    const dragPlate = GM.grab && GM.grab.kind === 'plate' ? GM.grab.ref : null;
    if (!GM.started) mode = 'intro';
    else if (dragPlate && dragPlate.place === 'drag' && !connected(dragPlate) && dragPlate.cz > 6 && dragPlate.cx > 8) mode = 'follow';
    else if (GM.front && !GM.front.anim && !GM.front.dragging) mode = 'close';
    else if (GM.front && GM.front.anim && GM.front.place === 'front') mode = 'follow';
    else if (rod.state === 'in' || rod.state === 'inserting') mode = 'push';
    else mode = 'kit';
    if (mode !== GM.camModeCur) { GM.camModeCur = mode; GM.camSince = 0; }
    GM.camSince = (GM.camSince || 0) + dt;
    let w, speed = 1.6;
    const hk = G.hint.key || '';
    if (mode === 'intro') {
      pts.push(V(-11, 15.5, -3.4), V(-11, 9, 3.4), V(12, 20, -4.5), V(12, 19, 4.5));
      circle(L.PLATING.x, 2.4, L.PLATING.z, 6.6, 6);
      w = por ? C.fitBest(pts, 0.5, 1.1, 0.62, 46, 0.1) : C.fit(pts, 0.16, 0.42, 34, 0.14);
      speed = 1.2;
    } else if (mode === 'kit') {
      pts.push(V(-11, 15.5, -3.4), V(12, 17.5, 3.6), V(12, 9, -3.6));
      if (hk.startsWith('block')) {
        const b = K.blocks.find((bb) => 'block' + bb.i === hk);
        pts.push(V(L.BOARD.x0, 0, L.BOARD.z0), V(L.BOARD.x1, 1, L.BOARD.z1), V(L.BOARD.x0 + 1, 0, L.BOARD.z1), V(L.TUBE.x0 - 17, 12, 0));
        if (b) pts.push(b.group.position.clone().add(V(-L.BLOCK.len, 3, 0)));
      } else if (hk === 'rod' || rod.state === 'carry' || rod.state === 'returning') {
        pts.push(V(rod.restPos.x - rod.len, 1, rod.restPos.z + 2), V(rod.restPos.x + 1, 4, rod.restPos.z + 2), V(L.TUBE.x0 - rod.len, 13, 0));
      } else if (hk === 'stack' || hk.startsWith('plate')) {
        pts.push(V(L.STACK.x - 6, 3, L.STACK.z + 6), V(L.PLATING.x + 6, 2, L.PLATING.z + 6), V(L.BACK.x + 6, 2, L.BACK.z));
      } else {
        pts.push(V(L.BOARD.x0, 0, L.BOARD.z1), V(L.PLATING.x + 7, 2, L.PLATING.z + 7));
      }
      circle(L.PLATING.x, 2.4, L.PLATING.z, 6.6, 6);
      if (GM.grab && GM.grab.kind === 'block') pts.push(GM.grab.ref.group.position.clone());
      w = por ? C.fitBest(pts, -0.2, 1.1, 0.68, 46, 0.06) : C.fitBest(pts, -0.05, 0.3, 0.48, 34, 0.06);
      speed = 1.5;
    } else if (mode === 'push') {
      const hx = rod.group.position.x - rod.len;
      pts.push(V(Math.max(hx, -36), 14, 2), V(-10, 16, -3.4), V(12, 18.5, -4.5), V(12, 18, 4.5));
      const pd = GM.plating;
      if (pd) circle(pd.cx, pd.by + 2.3, pd.cz, 7, 8); else circle(L.PLATING.x, 3.5, L.PLATING.z, 7, 6);
      pts.push(V(L.EXIT_X + 2, 1, 0));
      w = por ? C.fitBest(pts, 0.5, 1.25, 0.56, 46, 0.05) : C.fitBest(pts, 0.0, 0.35, 0.38, 34, 0.05);
      speed = 1.4;
    } else if (mode === 'follow') {
      const d = dragPlate || GM.front;
      circle(d.cx, d.by + 2.4, d.cz, 7.2, 8);
      const e = pieceEnd(); if (e) pts.push(e);
      w = C.fit(pts, por ? 0.12 : 0.22, 0.2, por ? 48 : 36, 0.08);
      speed = 2.6;
    } else if (mode === 'close') {
      const d = GM.front;
      circle(d.cx, d.by + 2.4, d.cz, 6.8, 12);
      const e = pieceEnd(); if (e && GM.camSince < 6) pts.push(e);
      // 片口とさじにも届く
      const P = K.pitcher, S = K.spoon;
      pts.push(P.rest.clone().add(V(0, 5.5, 0)), P.rest.clone().add(V(0, 0, 3.6)), S.rest.clone().add(V(0, 0.5, -1)), S.rest.clone().add(V(-2, 0, 4)));
      if (P.state === 'held') pts.push(P.pos.clone().add(V(0, 6, 0)));
      w = por ? C.fitBest(pts, -0.7, 0.7, 1.0, 46, 0.04) : C.fit(pts, 0.08, 0.88, 36, 0.04);
      speed = GM.camSince < 2.5 ? 1.1 : 1.6;
    }
    C.setWant(w, speed);
    C.update(dt);
  }

  // ---------------- 毎フレーム ----------------
  GM.update = function (dt) {
    scr = 0;
    updateBlocks(dt);
    updateRod(dt);
    updateKnob(dt);
    G.kit.updateFrame(dt);
    updatePlates(dt);
    // 仕上げの記録
    if (GM.front) {
      const f = GM.front;
      if (f.volume > 3) f.poured = true;
      if (f.seeds.length >= 4) f.sesamed = true;
    }
    for (const d of G.dish.list) if (d.place === 'park' && (d.poured || d.sesamed)) d.sent = true;
    // 物の音（落ちた糸、ごまの粒）
    const ev = G.strands.events;
    for (const e of ev) {
      if (e.type === 'land' && G.audio) { const p = V(e.x, e.y, e.z); G.audio.flop(G.audio.panOf(p), Math.min(1, e.v * 3)); if (e.v > 0.2) G.fx.splash(p, 2, 10); }
    }
    ev.length = 0;
    for (const e of G.dish.events) {
      if (!G.audio) break;
      const p = e.dish.toWorld(e.x, 1, e.z, new THREE.Vector3());
      if (e.type === 'seedTick') G.audio.tick(G.audio.panOf(p), Math.min(1, e.v / 60));
      else if (e.type === 'seedWater') G.audio.drip(G.audio.panOf(p), 0.25, 1.6);
    }
    G.dish.events.length = 0;
    // 休んだ後に遅れて落ちる一滴、静かな間のしずく
    if (GM.dripAt > 0 && G.time > GM.dripAt) { GM.dripAt = -1; G.fx.runner(G.strands.hangingPoint()); }
    if (G.time > GM.nextAmbient) {
      GM.nextAmbient = G.time + G.rr(5, 9);
      if (!G.input.down) G.fx.runner(G.strands.hangingPoint());
    }
    if (G.audio) G.audio.setScrape(scr);
    chooseHint();
    updateCamera(dt);
  };
})();
