// input.js — 指一本のタップとドラッグ。触れた物だけが反応する
(function () {
  'use strict';
  var G = window.G;
  var I = (G.input = { cur: null, id: null, px: 0, py: 0, down: false });
  var rc = new THREE.Raycaster();

  I.init = function (canvas) {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
    // 拡大・スクロール・長押しメニューを止める
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (e) {
      document.addEventListener(e, function (ev) { ev.preventDefault(); }, { passive: false });
    });
    document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  };

  function allPicks() {
    var out = [];
    G.pickables.forEach(function (p) {
      if (p.dynamic) out = out.concat(p.dynamic());
      else out.push(p);
    });
    return out.filter(function (p) { try { return p.enabled(); } catch (e) { return false; } });
  }

  function ctxFor(e) {
    var ray = G.stage.setRay(I.px, I.py).clone();
    return { ray: ray, px: I.px, py: I.py, hit: null, hitObj: null, normal: null, handoff: null };
  }

  function pick(ctx) {
    G.stage.scene.updateMatrixWorld();
    var list = allPicks();
    var meshes = [], owner = [];
    list.forEach(function (p) {
      var ms = p.meshes();
      for (var i = 0; i < ms.length; i++) { meshes.push(ms[i]); owner.push(p); }
    });
    rc.ray.copy(ctx.ray);
    rc.near = 0; rc.far = 400;
    var hits = rc.intersectObjects(meshes, false);
    if (hits.length) {
      var first = hits[0].distance, best = null, bp = -1;
      for (var h = 0; h < hits.length && h < 30; h++) {
        if (hits[h].distance > first + 1.6) break;
        var p = owner[meshes.indexOf(hits[h].object)];
        if (p && p.priority > bp) { bp = p.priority; best = { p: p, hit: hits[h] }; }
      }
      if (best) return best;
    }
    // 外れたときは画面上で近い物（少し大きめの当たり）
    var hint = G.guide && G.guide.targetPick ? G.guide.targetPick() : null;
    var bestD = 1e9, bestP = null, sc = new THREE.Vector3();
    list.forEach(function (p) {
      var c = p.center();
      if (!c) return;
      G.stage.toScreen(c, sc);
      if (sc.z > 1) return;
      var d = Math.hypot(sc.x - ctx.px, sc.y - ctx.py);
      var tol = Math.max(28, (p.radius || 1) * G.stage.pxPerUnit(c) + 22);
      if (hint && hint === p.ref) tol += 34;
      if (d < tol && d - tol * 0.3 < bestD) { bestD = d - tol * 0.3; bestP = p; }
    });
    return bestP ? { p: bestP, hit: null } : null;
  }
  I.pick = pick;

  function setXY(e) {
    var r = G.stage.renderer.domElement.getBoundingClientRect();
    I.px = e.clientX - r.left; I.py = e.clientY - r.top;
  }

  function onDown(e) {
    e.preventDefault();
    if (G.audio) G.audio.init();
    if (I.id !== null) return;          // 二本目の指は無視
    I.id = e.pointerId;
    setXY(e);
    I.down = true;
    if (G.game) G.game.touched();
    var ctx = ctxFor(e);
    var r = pick(ctx);
    if (!r) { I.cur = null; return; }
    if (r.hit) {
      ctx.hit = r.hit.point.clone();
      ctx.hitObj = r.hit.object;
      if (r.hit.face) ctx.normal = r.hit.face.normal.clone().transformDirection(r.hit.object.matrixWorld);
    }
    var ok = false;
    try { ok = r.p.down(ctx); } catch (err) { console.error(err); }
    if (ok) {
      I.cur = r.p;
      if (ctx.handoff) I.cur = ctx.handoff;
      // 段ボールを押したところは浅くへこむ
      if (ctx.hit && ctx.hitObj && ctx.hitObj.userData.card && ctx.normal && ctx.hitObj.parent) {
        G.fx.dent(ctx.hitObj.parent, ctx.hit, ctx.normal);
      }
      if (G.game) G.game.onEvent('grab', r.p);
    } else I.cur = null;
  }
  function onMove(e) {
    if (e.pointerId !== I.id) return;
    e.preventDefault();
    setXY(e);
    if (G.game) G.game.touched();
    if (!I.cur) return;
    var ctx = ctxFor(e);
    try { I.cur.move(ctx); } catch (err) { console.error(err); }
    if (ctx.handoff) I.cur = ctx.handoff;
  }
  function onUp(e) {
    if (G.audio) G.audio.init();
    if (e.pointerId !== I.id) return;
    setXY(e);
    I.id = null; I.down = false;
    G.fx.releaseDents();
    if (G.game) G.game.touched();
    if (!I.cur) return;
    var ctx = ctxFor(e);
    var c = I.cur; I.cur = null;
    try { c.up(ctx); } catch (err) { console.error(err); }
    if (G.game) G.game.onEvent('letgo', c);
  }
})();
