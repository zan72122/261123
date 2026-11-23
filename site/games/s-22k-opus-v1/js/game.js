/* game.js — wires everything together: camera shots, which area is in focus,
   the next-thing hint, and moving on to the next ball of dough. */
(function () {
  'use strict';
  const U = window.U;
  const Gm = (U.game = { round: 0, area: 'overview' });
  const L = U.L;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  Gm.init = function () {
    const C = U.core;
    C.init(document.getElementById('app'));
    U.kit.initMaterials();
    U.kit.buildRoom(C.scene);
    U.fx.init();
    U.noodles.initWorld(C.scene);
    U.bowl.init(C.scene);
    U.sheet.init(C.scene);
    U.pot.init(C.scene);
    U.serve.init(C.scene);
    U.guide.init(C.scene);
    defineShots();
    C.onFirstTouch.push(() => U.audio.start());
    C.onAnyDown.push(() => U.audio.start());
    C.addUpdate((dt) => U.audio.update(dt), 80);
    C.addUpdate((dt) => U.noodles.update(dt), 20);
    C.addUpdate(Gm.update, 85);
    U.serve.onMat = () => Gm.nextRound();
    U.bowl.newRound(0);
    U.sheet.newRound(0);
    // focus follows what the child touches
    C.onPick.push((p) => {
      if (p === U.pot.netPick && U.pot.netInPot()) { Gm.area = 'pot'; return; }
      if (p.area) Gm.focus(p.area);
    });
    tagAreas();
    U.cam.set('overview');
    U.cam.snap();
    Gm.lastDough = false;
    Gm.lastPour = 0;
  };

  // which area each pickable belongs to (by order of registration)
  function tagAreas() {
    for (const p of U.core.pickables) {
      if (p.area) continue;
      const pt = guessPoint(p);
      p.area = pt ? areaOf(pt) : 'board';
    }
  }
  function guessPoint(p) {
    if (p.target) {
      const t = Array.isArray(p.target) ? p.target[0] : p.target;
      if (t && t.getWorldPosition) return t.getWorldPosition(new THREE.Vector3());
    }
    return null;
  }
  function areaOf(p) {
    const cands = [
      ['knead', V(L.kb.x, 0, L.kb.z - 0.6)],
      ['board', V(L.board.x, 0, L.board.z + 0.3)],
      ['pot', V(L.pot.x, 0, L.pot.z)],
      ['bowl', V(L.serve.x, 0, L.serve.z - 0.3)],
      ['bowl', V(L.mat.x, 0, L.mat.z)],
    ];
    let best = 'board', bd = Infinity;
    for (const [a, c] of cands) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  Gm.focus = function (a) {
    if (!a) return;
    if (a === 'pot') a = U.noodles.inContainer('pot').length ? 'potside' : 'board';
    Gm.area = a;
  };

  function defineShots() {
    const cam = U.cam;
    const S = (x, y, z, r) => ({ c: V(x, y, z), r });
    const kb = S(L.kb.x, 0.35, L.kb.z, 1.25);
    const pitcher = S(L.pitcher.x, 0.4, L.pitcher.z, 0.45);
    const salt = S(L.salt.x, 0.1, L.salt.z, 0.35);
    const board = S(L.board.x, 0.2, L.board.z + 0.1, 1.35);
    const knife = S(L.board.x + 0.7, 0.3, L.board.z1 + 0.55, 0.3);
    const net = S(L.net.x + 0.4, 0.2, L.net.z, 0.55);
    const pot = S(L.pot.x, 0.6, L.pot.z, 1.0);
    const serve = S(L.serve.x, 0.3, L.serve.z, 0.85);
    const plate = S(L.plate.x, 0.1, L.plate.z, 0.42);
    const mat = S(L.mat.x, 0.25, L.mat.z, 0.9);
    cam.define('overview', { az: (pt) => (pt ? -0.45 : 0), el: (pt) => (pt ? 1.05 : 0.93), spheres: () => [kb, pitcher, board, pot, serve, plate, mat, knife] });
    cam.define('knead', {
      az: 0, el: 0.98,
      spheres: (portrait) => (portrait ? [kb, pitcher, salt, S(L.kb.x + 0.6, 0.1, L.kb.z + 1.0, 0.3)] : [kb, pitcher, salt, board, S(L.kataRest.x, 0.2, L.kataRest.z, 0.3)]),
    });
    cam.define('board', {
      az: 0, el: 1.0,
      spheres: (portrait) => (portrait ? [board, knife, net] : [board, knife, net, pot, S(L.board.x0 - 0.3, 0.2, L.board.z, 0.3)]),
    });
    cam.define('pot', {
      az: 0.78, el: 0.42, margin: 0.98, minDist: 2.4,
      spheres: () => [S(L.pot.x, L.pot.waterY, L.pot.z, 0.92)],
      lambda: 1.6,
    });
    cam.define('serve', {
      az: (pt) => (pt ? 1.1 : 0.42), el: 0.66,
      spheres: () => [S(L.pot.x, 0.6, L.pot.z, 0.95), S(U.serve.cur.g.position.x, 0.35, U.serve.cur.g.position.z, 0.85)],
      lambda: 1.8,
    });
    cam.define('potside', {
      az: 0.25, el: 0.85,
      spheres: () => [pot, board, serve],
    });
    cam.define('bowl', {
      az: (pt) => (pt ? -0.8 : 0), el: (pt) => (pt ? 0.95 : 0.86),
      spheres: () => {
        const list = [S(U.serve.cur.g.position.x, 0.35, U.serve.cur.g.position.z, 0.85), plate];
        if (U.serve.matBowl && U.serve.matBowl.at !== 'gone') list.push(S(U.serve.matBowl.g.position.x, 0.3, U.serve.matBowl.g.position.z, 0.85));
        else list.push(mat);
        return list;
      },
    });
  }

  // ---------------- hints ----------------
  function wp(obj, dy = 0) {
    const v = obj.getWorldPosition(new THREE.Vector3());
    v.y += dy;
    return v;
  }
  function hint() {
    const B = U.bowl, bs = B.state, Sh = U.sheet, ss = Sh.st, P = U.pot, ps = P.st, Sv = U.serve;
    const N = U.noodles;
    const kbC = B.g.localToWorld(V(0, 0.4, 0));
    if (bs.kata === 'full' && bs.flourAdded < 0.01) return { key: 'kata', obj: B.kata, tap: true, path: () => [wp(B.kata.userData.col)] };
    if (bs.flourAdded > 0.05 && !bs.lifted) {
      if (!bs.saltIn && B.saltSt.mode === 'home')
        return { key: 'salt', obj: B.salt, path: () => [wp(B.salt, 0.08), B.pitcher.localToWorld(B.pitcher.userData.mouth.clone()).add(V(0.25, 0.05, 0.1))] };
      if (bs.water > B.VW * 0.25 && B.pitch.mode === 'home')
        return {
          key: 'pitcher', obj: B.pitcher,
          path: () => {
            const a = wp(B.pitcher, 0.3);
            const c = B.g.localToWorld(V(-0.2, 0.5, -0.1));
            return [a, c, c.clone().add(V(0.25, 0, 0.12)), c.clone().add(V(-0.1, 0, 0.25))];
          },
        };
      if (!bs.ready) {
        let tgt = kbC.clone();
        const big = B.clumps.slice().sort((a, b) => b.f - a.f)[0];
        if (big) tgt = B.g.localToWorld(V(big.x, 0.35, big.z));
        // roll the dough toward the flour that is still loose
        const ft = big ? B.flourTarget(big.x, big.z) : null;
        const far = ft ? B.g.localToWorld(V(ft.x, 0.35, ft.z)) : tgt.clone().add(V(0.35, 0, 0.1));
        return {
          key: 'mix', obj: big ? big.mesh : null, dynGlow: big ? null : B.flourMesh,
          path: () => [tgt, far, tgt.clone().lerp(far, 0.3), far.clone().add(V(0.12, 0, -0.1))],
        };
      }
      const c = B.clumps[0];
      if (c) return { key: 'lift', obj: c.mesh, path: () => [wp(c.mesh, 0.1), V(L.board.x - 0.1, 0.9, L.board.z + 0.1)] };
    }
    // board
    const carrying = P.carrying();
    const boardNoodles = N.list.filter((nd) => nd.container === N.world && nd.grab < 0);
    if (ss.has && !ss.folded && ss.cuts === 0 && !ss.fold) {
      const b = Sh.bounds();
      if (b && ss.spread < 0.8 && !(ss.strokes >= 9 && ss.spread > 0.4)) {
        return {
          key: 'pin', obj: Sh.pin,
          path: () => {
            const p = wp(Sh.pin, 0.05);
            const mx = (b.x0 + b.x1) / 2;
            return [p, V(mx, 0.2, b.z0 + 0.1), V(mx, 0.2, b.z1 - 0.05), V(mx, 0.2, b.z0 + 0.2)];
          },
        };
      }
      if (b) {
        // find a line across the dough where it is long enough to fold
        let best = null;
        for (let x = b.x0 + 0.2; x <= b.x1 - 0.2; x += 0.1) {
          const e = Sh.edgesAt(x);
          if (e && (!best || e.z1 - e.z0 > best.z1 - best.z0)) best = { x, z0: e.z0, z1: e.z1 };
        }
        if (best) return { key: 'fold', obj: null, dynGlow: Sh.m0, path: () => [V(best.x, 0.17, best.z1 - 0.06), V(best.x, 0.22, best.z0 + (best.z1 - best.z0) * 0.3)] };
      }
    }
    // cooked noodles waiting in the pot
    const potN = N.inContainer('pot');
    const cooked = potN.length ? potN.reduce((s, nd) => s + nd.cook[(nd.n / 2) | 0], 0) / potN.length : 0;
    if (!carrying && boardNoodles.length && ps.net !== 'pour') {
      const nd = boardNoodles[boardNoodles.length - 1];
      return {
        key: 'noodle' + nd.id, obj: null,
        path: () => {
          const a = nd.worldPoint(0, new THREE.Vector3());
          const t = P.netInPot() ? V(L.pot.x, 1.2, L.pot.z) : wp(P.net, 0.25);
          return [a, a.clone().add(V(0, 0.4, 0)), t];
        },
      };
    }
    const netN = N.inContainer('net');
    // a fairly full bowl: toppings, then on to the mat (leftovers can wait in the pot)
    const inBowl0 = Sv.noodlesIn();
    if (inBowl0 >= 6 && ps.net !== 'pour' && !carrying && !netN.length) {
      const age = Sv.ages.find((a) => a.userData.onPlate);
      if (age && Sv.st.ages === 0) return { key: 'age', obj: age, path: () => [wp(age, 0.05), wp(Sv.cur.g, 0.6)] };
      if (Sv.pile.length && Sv.st.negi === 0) return { key: 'negi', obj: null, path: () => [Sv.plate.localToWorld(V(0.15, 0.08, 0.08)), wp(Sv.cur.g, 0.6).add(V(-0.25, 0, 0.1))] };
      if (inBowl0 >= 8 && Sv.cur.at === 'home' && !(ss.has && !ss.folded && ss.cuts === 0))
        return { key: 'mat', obj: Sv.cur.g, path: () => { const c = wp(Sv.cur.g); const tc = U.core.camera.position.clone().sub(c).setY(0).normalize().multiplyScalar(0.62); return [c.clone().add(tc).setY(0.3), V(L.mat.x, 0.3, L.mat.z).add(tc)]; } };
    }
    if (netN.length && (ps.net === 'home' || ps.net === 'returning'))
      return { key: 'net2pot', obj: P.net, path: () => [wp(P.net, 0.1), V(L.pot.x, 1.1, L.pot.z)] };
    if (netN.length && ps.net === 'carry')
      return { key: 'carry', obj: P.net, path: () => [wp(P.net), ps.fromPot ? wp(Sv.cur.g, 0.8) : V(L.pot.x, 1.1, L.pot.z)] };
    if (potN.length && cooked > 0.45 && (ps.net === 'hang' || ps.net === 'home'))
      return {
        key: 'scoop', obj: P.net,
        path: () => [wp(P.net, 0.05), V(L.pot.x - 0.2, L.pot.waterY, L.pot.z + 0.1), V(L.pot.x + 0.2, L.pot.waterY, L.pot.z - 0.1), wp(Sv.cur.g, 0.8)],
      };
    if (ss.has && (ss.folded || ss.cuts > 0) && Sh.kn.mode === 'rest')
      return { key: 'knife', obj: Sh.knife, path: () => { const p = wp(Sh.knife, 0.35).add(V(0, 0, 0.55)); return [p, p.clone().add(V(-0.12, 0, 0))]; } };
    const inBowl = Sv.noodlesIn();
    if (inBowl && ps.net !== 'pour') {
      const age = Sv.ages.find((a) => a.userData.onPlate);
      if (age && Sv.st.ages === 0) return { key: 'age', obj: age, path: () => [wp(age, 0.05), wp(Sv.cur.g, 0.6)] };
      if (Sv.pile.length && Sv.st.negi === 0) return { key: 'negi', obj: null, path: () => [Sv.plate.localToWorld(V(0.15, 0.08, 0.08)), wp(Sv.cur.g, 0.6).add(V(-0.25, 0, 0.1))] };
      if (potN.length === 0 && !ss.has && !boardNoodles.length && !netN.length && Sv.cur.at === 'home')
        return { key: 'mat', obj: Sv.cur.g, path: () => { const c = wp(Sv.cur.g); const tc = U.core.camera.position.clone().sub(c).setY(0).normalize().multiplyScalar(0.62); return [c.clone().add(tc).setY(0.3), V(L.mat.x, 0.3, L.mat.z).add(tc)]; } };
    }
    if (potN.length && cooked > 0.45 && ps.net === 'dunk') return null;
    if (bs.kata === 'full') return { key: 'kata', obj: B.kata, tap: true, path: () => [wp(B.kata.userData.col)] };
    return null;
  }
  Gm.hint = hint;

  // ---------------- per frame ----------------
  let hintT = 0;
  Gm.update = function (dt) {
    const C = U.core;
    // events that move the focus
    const hasDough = U.sheet.st.has;
    if (hasDough && !Gm.lastDough && U.bowl.state.lifted) Gm.focus('board');
    Gm.lastDough = hasDough;
    const ps = U.pot.st;
    if (Gm.prevNet === 'pour' && ps.net !== 'pour') Gm.focus('bowl');
    Gm.prevNet = ps.net;
    if (!C.firstTouchDone) Gm.area = 'overview';
    else if (Gm.area === 'overview') Gm.area = 'knead';
    // camera
    const want = U.pot.camWant() || Gm.area;
    if (U.cam.name !== want) U.cam.set(want);
    // hints (recomputed a few times a second)
    hintT -= dt;
    if (hintT <= 0) {
      hintT = 0.25;
      const h = C.drag ? null : hint();
      U.guide.set(h);
      // if the hinted thing is out of view for a while, bring it into view
      if (h && C.idle() > 5 && h.path) {
        const pts = typeof h.path === 'function' ? h.path() : h.path;
        if (pts && pts[0] && !U.cam.visible(pts[0], 30)) Gm.focus(areaOf(pts[0]));
      }
    }
  };

  Gm.nextRound = function () {
    Gm.round++;
    const n = Gm.round;
    U.bowl.newRound(n);
    U.bowl.refillSalt();
    U.bowl.refillWater();
    U.bowl.resetKata();
    U.sheet.newRound(n);
    U.serve.refillPlate();
    U.audio.play('chime');
    U.after(0.6, () => Gm.focus('knead'));
  };

  window.addEventListener('DOMContentLoaded', () => {
    Gm.init();
    U.core.start();
  });
})();
