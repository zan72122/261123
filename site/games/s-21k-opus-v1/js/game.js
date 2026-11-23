// game.js — 触れる物の登録、次に触る物の選び方、視点の演出、窓明かり
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var V3 = THREE.Vector3;
  var Gm = (G.game = { idle: 0, started: false, followDone: false, follow: null, pull: 0, quiet: 0, lightPh: 0 });

  function meshesOf(obj) { var a = []; obj.traverse(function (o) { if (o.isMesh && !o.userData.noGlow) a.push(o); }); return a; }

  Gm.init = function () {
    var B = G.box, P = G.parts;
    // 蝶番
    ['R', 'L', 'B'].forEach(function (k) {
      var h = B.hinges[k];
      var ms = meshesOf(h.pivot);
      G.pickables.push({
        kind: 'hinge', ref: h, priority: 1,
        meshes: function () { return ms; },
        center: function () { return h.freeEdge(); }, radius: 2.4,
        enabled: function () { return !h.locked; },
        down: function (ctx) { return B.beginDrag(k, ctx.hit || h.freeEdge(), ctx.px, ctx.py); },
        move: function (ctx) { B.drag(k, ctx.px, ctx.py); },
        up: function () { B.endDrag(k); }
      });
    });
    // 坂板・回転盤
    [P.board, P.disk].forEach(function (pt) {
      var ms = meshesOf(pt.obj);
      G.pickables.push({
        kind: pt.name, ref: pt, priority: 2,
        meshes: function () { return ms; },
        center: function () { return pt.center(); }, radius: 2.6,
        enabled: function () { return pt.state === 'desk' || (pt === P.board && pt.state === 'installed' && pt.canRemove()); },
        down: function (ctx) {
          if (pt.state === 'installed') { pt.remove(ctx.ray); pt.tpos.copy(pt.obj.position); pt.tquat.copy(pt.obj.quaternion); }
          else pt.beginHold(ctx.ray);
          return true;
        },
        move: function (ctx) { pt.holdMove(ctx.ray, ctx.px, ctx.py); },
        up: function () { pt.endHold(); }
      });
    });
    // ハンドル
    var hd = P.handle, hms = meshesOf(hd.obj);
    G.pickables.push({
      kind: 'handle', ref: hd, priority: 5,
      meshes: function () { return hms; },
      center: function () {
        if (!hd.installed) return hd.center();
        return new V3(Math.sin(hd.angle) * K.CRANK_R, K.DISK_Y + Math.cos(hd.angle) * K.CRANK_R, K.HANDLE_Z + 0.4);
      }, radius: 1.2,
      enabled: function () { return hd.state === 'desk' || hd.state === 'installed'; },
      down: function (ctx) { if (hd.installed) hd.crankDown(ctx.ray); else hd.beginHold(ctx.ray); return true; },
      move: function (ctx) { if (hd.installed) hd.crankMove(ctx.ray); else hd.holdMove(ctx.ray, ctx.px, ctx.py); },
      up: function () { if (hd.installed) hd.crankUp(); else hd.endHold(); }
    });
    // 前窓
    var w = P.win, wms = meshesOf(w.obj);
    G.pickables.push({
      kind: 'window', ref: w, priority: 2,
      meshes: function () { return wms; },
      center: function () { return w.state === 'desk' ? w.center() : new V3(0, w.y + 7.5, K.WIN_Z); }, radius: 2.5,
      enabled: function () { return w.state === 'desk' || w.state === 'installed' || w.state === 'partial'; },
      down: function (ctx) {
        if (w.state === 'installed' || w.state === 'partial') { w.slideDown(ctx.ray); w.mode = 'slide'; }
        else { w.beginHold(ctx.ray); w.mode = 'hold'; }
        return true;
      },
      move: function (ctx) {
        if (w.mode === 'slide') {
          if (w.slideMove(ctx.ray) === 'out') { w.mode = 'hold'; w.popOut(); Gm.onEvent('windowOut'); }
        } else if (w.state === 'held') w.holdMove(ctx.ray, ctx.px, ctx.py);
      },
      up: function () {
        if (w.mode === 'slide') w.slideUp();
        else if (w.popping) w.dropAfterPop = true;
        else if (w.state === 'held') w.endHold();
        w.mode = null;
      }
    });
    // 受け皿
    var tr = P.tray, tms = meshesOf(tr.obj);
    G.pickables.push({
      kind: 'tray', ref: tr, priority: 0,
      meshes: function () { return tms; },
      center: function () { return new V3(tr.x, 0.3, K.TRAY_Z + K.TRAY_D / 2 - 0.2); }, radius: 1.5,
      enabled: function () { return true; },
      down: function (ctx) { P.trayDown(ctx.ray); return true; },
      move: function (ctx) { P.trayMove(ctx.ray); },
      up: function () { P.trayUp(); }
    });
    Gm.cam = { pos: G.stage.camera.position.clone(), target: new V3(0, 0, 0) };
    var first = shotAll();
    Gm.cam.pos.copy(first.pos); Gm.cam.target.copy(first.target);
    applyCam();
  };

  Gm.touched = function () { Gm.idle = 0; Gm.started = true; };

  Gm.onEvent = function (name, data) {
    switch (name) {
      case 'tabLocked':
        if (G.box.isUp()) { Gm.quiet = 1.2; }
        break;
      case 'release':
        if (!Gm.followDone && data) {
          Gm.followDone = true;
          Gm.follow = { cp: data, t: 0, p0: Gm.cam.pos.clone(), t0: Gm.cam.target.clone(), look: data.pos.clone() };
        }
        break;
      case 'settled':
        break;
      case 'prizeDesk':
        Gm.pull = 7; Gm.pullItem = data; Gm.quiet = 6;
        break;
      case 'opened':
        Gm.quiet = 0.8;
        break;
    }
  };

  // ---------- 次に触る物 ----------
  function hintFor(ref, mats, bounceObj, gesture, kick) { return { ref: ref, mats: mats, bounceObj: bounceObj, gesture: gesture, kick: kick }; }
  function hingeHint(h) {
    var path = h.name === 'B'
      ? function (t) { var a = G.lerp(h.angle, Math.PI / 2, t); return new V3(0, K.T + 0.1, K.BACK_Z - (K.H - 1) * Math.cos(a)); }
      : function (t) { return h.pointAt(G.lerp(h.angle, Math.PI / 2, t), K.H - 1, new V3()); };
    return hintFor(h, h.mats, null, { path: path }, function () { if (!h.dragging) h.spring.kick(0.35); });
  }
  function partHint(pt, target, arc) {
    return hintFor(pt, pt.mats, pt.state === 'desk' ? pt.obj : null, {
      from: function () { return pt.center(); }, to: function () { return target.clone(); }, arc: arc || 3
    });
  }
  function closedOutside() {
    return G.caps.list.filter(function (c) { return c.state === 'desk' || c.state === 'hole'; });
  }
  function nextHint() {
    var B = G.box, P = G.parts, C = G.caps, F = G.flow;
    var hs = B.hinges;
    if (!B.tabs.R.locked) {
      if (hs.R.angle < 1.4 && !hs.R.locked) return hingeHint(hs.R);
      return hingeHint(hs.B);
    }
    if (!B.tabs.L.locked) return hingeHint(hs.L);
    if (P.board.state === 'desk' && !P.board.installed) return partHint(P.board, new V3(0, K.H + 1, -0.2), 4);
    if (P.disk.state === 'desk') return partHint(P.disk, new V3(0, 2.5, 2.5), 2);
    if (P.handle.state === 'desk') return partHint(P.handle, new V3(0, K.DISK_Y, K.HANDLE_Z + 0.5), 3);
    if (P.win.state === 'desk' && P.board.installed) return partHint(P.win, new V3(0, K.H + 1.5, K.WIN_Z), 4);
    if (P.win.state === 'partial') return hintFor(P.win, P.win.mats, null, {
      from: function () { return new V3(0, P.win.y + 7, K.WIN_Z); }, to: function () { return new V3(0, K.WIN_Y0 + 7, K.WIN_Z); }
    });
    if (P.board.state === 'desk' && !P.board.installed) return partHint(P.board, new V3(0, K.H + 1, -0.2), 4);
    if (!P.board.installed || P.board.state !== 'installed') return null;
    // 受け皿に閉じたカプセル → 開ける
    var inTray = F.tray.filter(function (c) { return c.settled && !c.held; });
    if (inTray.length) {
      var cp = inTray[0];
      return hintFor(cp, cp.mats, null, {
        from: function () { return cp.pos.clone().add(new V3(0, 0.5, 0)); },
        to: function () { return cp.pos.clone().add(new V3(1.3, 0.6, 0.5)); }, arc: 0.2
      });
    }
    // 受け皿の殻に景品 → 机へ
    var sh = C.shells.filter(function (s) { return s.state === 'tray' && s.prize; })[0];
    if (sh) {
      var pz = sh.prize;
      return hintFor(pz, pz.mats, null, {
        from: function () { return pz.obj.position.clone(); },
        to: function () { return new V3(G.parts.tray.x + (sh.trayLocal.x > 0 ? 4.6 : -4.6), 0.5, K.TRAY_Z + 2.2); }, arc: 1.5
      });
    }
    // 箱に待っている → ハンドル
    if (F.waitingCount() > 0 && P.handle.installed) {
      var hd = P.handle;
      return hintFor(hd, hd.mats, null, {
        path: function (t) {
          var a = hd.angle + t * Math.PI * 2.2;
          return new V3(Math.sin(a) * K.CRANK_R, K.DISK_Y + Math.cos(a) * K.CRANK_R, K.HANDLE_Z + 0.75);
        }
      });
    }
    if (Gm.quiet > 0) return null;
    // 閉じたカプセル → 投入口
    var co = closedOutside();
    if (co.length && F.canAccept()) {
      var c0 = co[0];
      return hintFor(c0, c0.mats, null, {
        from: function () { return c0.pos.clone(); }, to: function () { return new V3(0, K.H + 1.4, K.LANE_Z); }, arc: 3
      });
    }
    // 景品の入った殻 → ふた
    var filled = C.shells.filter(function (s) { return s.prize && s.state !== 'capsule' && s.state !== 'held' && s.state !== 'anim'; })[0];
    var freeCap = C.caps.filter(function (c) { return c.state === 'desk'; });
    if (filled && freeCap.length) {
      var fc = nearest(freeCap, filled.obj.position);
      return hintFor(fc, fc.mats, fc.obj, {
        from: function () { return fc.center(); }, to: function () { return filled.obj.position.clone().add(new V3(0, 0.6, 0)); }, arc: 1.5
      });
    }
    // 空の殻と机の景品 → 入れる
    var empty = C.shells.filter(function (s) { return !s.prize && s.state !== 'capsule' && s.state !== 'held' && s.state !== 'anim'; });
    var loose = C.prizes.filter(function (p) { return p.state === 'desk' && p.spin <= 0; });
    if (empty.length && loose.length) {
      var es = empty.filter(function (s) { return s.state === 'hole'; })[0] || empty[0];
      var lp = nearest(loose, es.obj.position);
      return hintFor(lp, lp.mats, lp.obj, {
        from: function () { return lp.obj.position.clone(); }, to: function () { return es.obj.position.clone().add(new V3(0, 0.3, 0)); }, arc: 1.4
      });
    }
    return null;
  }
  function nearest(list, p) {
    var best = list[0], bd = 1e9;
    list.forEach(function (it) {
      var c = it.obj ? it.obj.position : it.pos;
      var d = c.distanceTo(p);
      if (d < bd) { bd = d; best = it; }
    });
    return best;
  }

  // ---------- 視点 ----------
  var tmp = new V3();
  function boxPoints(out) {
    var B = G.box, hs = B.hinges;
    if (B.isUp()) {
      [-5.3, 5.3].forEach(function (x) { [-3, 2.4].forEach(function (z) { out.push(new V3(x, 0, z), new V3(x, K.H + 0.4, z)); }); });
    } else {
      ['R', 'L'].forEach(function (k) {
        var h = hs[k];
        [-2.2, 2.9].forEach(function (z) { out.push(h.worldAt(h.angle, new V3(h.sign * K.H, 0, -z), new V3())); });
      });
      [-5, 5].forEach(function (x) { out.push(hs.B.worldAt(hs.B.angle, new V3(x, 0, -K.H), new V3())); });
      out.push(new V3(-5, 0, 2.3), new V3(5, 0, 2.3));
    }
  }
  function trayPoints(out) {
    var t = G.parts.tray;
    out.push(new V3(t.x - 3, 0.4, K.TRAY_Z - 2), new V3(t.x + 3, 0.4, K.TRAY_Z - 2), new V3(t.x - 3, 0.4, K.TRAY_Z + 2), new V3(t.x + 3, 0.4, K.TRAY_Z + 2));
  }
  function itemPoints(out) {
    var C = G.caps, P = G.parts;
    C.shells.forEach(function (s) { if (s.state !== 'capsule') out.push(s.obj.position.clone()); });
    C.caps.forEach(function (c) { if (c.state !== 'capsule') out.push(c.obj.position.clone()); });
    C.prizes.forEach(function (p) { if (!p.home) out.push(p.obj.position.clone()); });
    C.list.forEach(function (c) { if (c.state !== 'box') out.push(c.pos.clone()); });
    ['board', 'disk', 'handle', 'win'].forEach(function (k) {
      var pt = P[k];
      if (pt.state === 'desk' || pt.state === 'held') {
        var b = new THREE.Box3().setFromObject(pt.obj);
        out.push(b.min.clone(), b.max.clone());
      }
    });
    var hc = P.holeCard.position;
    out.push(new V3(hc.x - 4.4, 0, hc.z - 1.5), new V3(hc.x + 4.4, 0, hc.z + 1.5));
  }
  function shotAll() {
    var pts = [];
    boxPoints(pts); trayPoints(pts); itemPoints(pts);
    var up = G.box.isUp();
    return G.stage.fit(pts, up ? 0.8 : 0.98, 0, 0.08);
  }
  function trayFocus() {
    var F = G.flow, C = G.caps;
    var items = [];
    F.tray.forEach(function (c) { items.push(c.pos.clone()); });
    C.shells.forEach(function (s) { if (s.state === 'tray' && s.prize) items.push(s.obj.position.clone()); });
    C.prizes.forEach(function (p) { if (p.state === 'held' && p.fromTray) items.push(p.obj.position.clone()); });
    return items;
  }
  function shotOpen(items) {
    var pts = items.slice();
    trayPoints(pts);
    pts.push(new V3(0, 2.8, 2.0));
    if (G.flow.waitingCount() > 0) pts.push(new V3(0, K.DISK_Y + K.CRANK_R + 0.4, K.HANDLE_Z));
    return G.stage.fit(pts, 0.55, 0, 0.1);
  }
  function shotPull() {
    var pts = [];
    boxPoints(pts); trayPoints(pts);
    var C = G.caps;
    C.prizes.forEach(function (p) { if (p.state === 'desk') pts.push(p.obj.position.clone()); });
    C.shells.forEach(function (s) { if (s.state !== 'capsule') pts.push(s.obj.position.clone()); });
    C.caps.forEach(function (c) { if (c.state === 'desk') pts.push(c.obj.position.clone()); });
    return G.stage.fit(pts, 0.62, 0, 0.1);
  }
  function followPose(f, dt) {
    var cp = f.cp;
    f.t += dt;
    var k = G.smooth(f.t / 1.8);
    f.look.lerp(cp.pos, 1 - Math.exp(-8 * dt));
    var pts = [new V3(0, 2.75, 2.2), new V3(0, 1.6, K.LIP_Z), cp.pos.clone()];
    trayPoints(pts);
    var end = G.stage.fit(pts, 0.04, (cp.bias || 0) * 0.12, 0.16);
    var c = f.p0.clone().lerp(end.pos, 0.5).add(new V3(0, 2.2, 2.5));
    var a = f.p0.clone().lerp(c, k), b = c.clone().lerp(end.pos, k);
    var pos = a.lerp(b, k);
    var target = f.t0.clone().lerp(f.look, G.smooth(f.t / 0.7)).lerp(end.target, k * 0.6);
    if ((cp.state === 'tray' && cp.settled) || f.t > 6 || cp.state !== 'tray' && cp.state !== 'box') Gm.follow = null;
    return { pos: pos, target: target };
  }

  function applyCam() {
    var cam = G.stage.camera;
    cam.position.copy(Gm.cam.pos);
    cam.lookAt(Gm.cam.target);
    cam.updateMatrixWorld();
  }

  Gm.update = function (dt) {
    Gm.idle += dt;
    if (Gm.quiet > 0) Gm.quiet -= dt;
    if (Gm.pull > 0) Gm.pull -= dt;
    // 視点
    var want, lam = 2.0;
    var focus = trayFocus();
    if (Gm.follow) { want = followPose(Gm.follow, dt); lam = 30; }
    else if (focus.length) { want = shotOpen(focus); lam = 1.8; }
    else if (Gm.pull > 0) { want = shotPull(); lam = 0.8; }
    else { want = shotAll(); lam = 1.6; }
    if (G.input.down && !Gm.follow) lam *= 0.35;
    G.dampV(Gm.cam.pos, want.pos, lam, dt);
    G.dampV(Gm.cam.target, want.target, lam, dt);
    applyCam();
    // 次に触る物
    var h = null;
    try { h = nextHint(); } catch (e) { console.error(e); }
    G.guide.setHint(h);
    // 窓明かりは静かなときにゆっくり移る
    if (Gm.idle > 5) Gm.lightPh += dt * 0.07;
    G.stage.placeSun(Math.sin(Gm.lightPh) * 1.3);
  };
})();
