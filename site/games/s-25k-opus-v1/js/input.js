// input.js — 指一本のタップとドラッグ。触れた物だけが応える
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var IN = (KK.input = { a: null, pid: null });
  var ray = new T.Raycaster(), ndc = new T.Vector2();
  var hp = new T.Vector3(), plane = new T.Plane(), tmp = new T.Vector3(), tmp2 = new T.Vector3();
  var lastT = 0;

  IN.init = function (canvas) {
    IN.canvas = canvas;
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp, { passive: false });
    canvas.addEventListener('pointercancel', onUp, { passive: false });
    canvas.addEventListener('lostpointercapture', function (e) { if (e.pointerId === IN.pid) onUp(e); });
    ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach(function (n) {
      canvas.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
    });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  };

  function setRay(cx, cy) {
    var r = IN.canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, KK.cam.camera);
  }
  function rayY(y, out) {
    plane.set(tmp.set(0, 1, 0), -y);
    return ray.ray.intersectPlane(plane, out);
  }
  function rayPlane(pt, n, out) {
    plane.setFromNormalAndCoplanarPoint(n, pt);
    return ray.ray.intersectPlane(plane, out);
  }
  function clampBoard(p) {
    p.x = KK.clamp(p.x, -C.BOARD_X + 2, C.BOARD_X - 2);
    p.z = KK.clamp(p.z, -C.BOARD_Z + 2, C.BOARD_Z - 2);
  }

  function pickables() {
    var list = [];
    if (KK.ball.mode !== 'held') list.push(KK.ball.proxy);
    KK.parts.list.forEach(function (p) { for (var i = 0; i < p.pick.length; i++) list.push(p.pick[i]); });
    KK.world.tray.children.forEach(function (m) { m.userData.tray = true; list.push(m); });
    return list;
  }
  function pick() {
    KK.world.scene.updateMatrixWorld();
    var hits = ray.intersectObjects(pickables(), false);
    if (!hits.length) return null;
    // 玉は少し優先
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object.userData.ball && hits[i].distance < hits[0].distance + 4) return hits[i];
    }
    // 見える形に当たったら、その部品の見えない取っ手（つまみ）だけを優先
    var vis = null;
    for (i = 0; i < hits.length; i++) if (hits[i].object.visible) { vis = hits[i]; break; }
    if (vis) {
      var part = vis.object.userData.part;
      if (part) {
        for (i = 0; i < hits.length; i++) {
          var h = hits[i];
          if (!h.object.visible && h.object.userData.part === part && h.distance < vis.distance + 3) {
            h.point = vis.point; return h;
          }
        }
      }
      return vis;
    }
    return hits[0];
  }

  // ───────── 押す ─────────
  function onDown(e) {
    e.preventDefault();
    KK.audio.start();
    if (IN.pid !== null) return;
    setRay(e.clientX, e.clientY);
    var h = pick();
    KK.state.lastTouch = KK.state.time;
    if (KK.guide) KK.guide.touched(!!h);
    if (!h) return;
    KK.state.firstTouch = true;
    IN.pid = e.pointerId;
    try { IN.canvas.setPointerCapture(e.pointerId); } catch (er) { /* なし */ }
    var a = (IN.a = { x0: e.clientX, y0: e.clientY, moved: false, t0: KK.state.time, hit: h.point.clone() });
    lastT = performance.now();
    var ud = h.object.userData;
    if (ud.ball) { startBall(a); return; }
    if (ud.tray) { startTray(a, h); return; }
    var part = ud.part;
    if (!part) { IN.a = null; IN.pid = null; return; }
    a.part = part;
    if (part.state === 'stowed') { startStowed(a, h); return; }
    var zone = ud.zone;
    var local = part.toLocalXZ(h.point.x, h.point.z, {});
    if (zone === 'wheel') { startWheel(a, h); return; }
    if (part.kind === 'straight' && zone === 'body') {
      if (local.x < -part.S / 2 + 3.4) zone = 'knob0';
      else if (local.x > part.S / 2 - 3.4) zone = 'knob1';
    }
    if (zone === 'knob0' || zone === 'knob1' || zone === 'knob') {
      var dof = part.dofs[zone === 'knob1' ? 1 : 0];
      if (!dof.fixed) { startHeight(a, h, dof); return; }
    }
    // 本体
    var nj = KK.track.jointCount(part);
    if (nj === 1 && part.kind !== 'spiral') {
      var pj = part.ports.filter(function (p) { return p.joint; })[0];
      var dj = Math.hypot(h.point.x - pj.wx, h.point.z - pj.wz);
      var size = part.kind === 'straight' ? part.S : part.kind === 'chute' ? part.L : 7;
      if (dj > size * 0.55) { startSwing(a, h, pj); return; }
    }
    startCarry(a, h);
  }

  // ───────── 動かす ─────────
  function onMove(e) {
    if (e.pointerId !== IN.pid || !IN.a) return;
    e.preventDefault();
    var a = IN.a;
    var now = performance.now(), dt = Math.max(1 / 240, (now - lastT) / 1000); lastT = now;
    if (!a.moved && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 6) a.moved = true;
    setRay(e.clientX, e.clientY);
    KK.state.lastTouch = KK.state.time;
    if (a.mode === 'ball') moveBall(a);
    else if (a.mode === 'carry') moveCarry(a);
    else if (a.mode === 'height') moveHeight(a);
    else if (a.mode === 'swing') moveSwing(a);
    else if (a.mode === 'wheel') moveWheel(a, dt, e);
    else if (a.mode === 'tray') moveTray(a);
  }

  // ───────── 離す ─────────
  function onUp(e) {
    KK.audio.start();
    if (e.pointerId !== IN.pid) return;
    var a = IN.a;
    IN.pid = null; IN.a = null;
    KK.state.dragPart = null;
    KK.state.lastTouch = KK.state.time;
    if (!a) return;
    if (a.mode === 'ball') endBall(a);
    else if (a.mode === 'carry') endCarry(a);
    else if (a.mode === 'height') endHeight(a);
    else if (a.mode === 'swing') endSwing(a);
    else if (a.mode === 'wheel') endWheel(a);
    else if (a.mode === 'tray') endTray(a);
  }

  // ═════════ 玉 ═════════
  function startBall(a) {
    a.mode = 'ball';
    KK.ball.pick();
    a.lastHover = KK.ball.pos.clone();
    KK.ball.hold.copy(KK.ball.pos).add(tmp.set(0, 1.2, 0));
  }
  var gu = {};
  function moveBall(a) {
    var B = KK.ball, W = KK.world;
    // まず溝そのものに当てる
    var parts = [];
    KK.parts.list.forEach(function (p) { p.pick.forEach(function (m) { if (m.userData.zone === 'body' || p.kind === 'start') parts.push(m); }); });
    var hits = ray.intersectObjects(parts, false);
    var x, z, found = null;
    if (hits.length) { x = hits[0].point.x; z = hits[0].point.z; }
    else {
      var gp = rayY(0, hp);
      if (!gp) return;
      x = gp.x; z = gp.z;
    }
    found = B.grooveUnder(x, z, gu);
    var hold = B.hold;
    if (found) {
      hold.set(gu.x, gu.y + C.R + 1.1, gu.z);
      a.over = gu.part;
    } else {
      a.over = null;
      if (!hits.length) {
        // 地面上：皿やくぼみの上なら少し上に
        var D = W.L.dimple;
        if (Math.hypot(x - D.x, z - D.z) < D.r + 0.8) hold.set(D.x, D.h + C.R + 1.6, D.z);
        else if (W.inTray(x, z, 0.3)) hold.set(x, W.L.tray.floor + C.R + 2.4, z);
        else {
          var g = W.ground(x, z, {});
          // 皿の縁の外は少し高め
          var y = g.y + C.R + 2.6;
          if (W.stadiumDist && nearTray(x, z)) y = W.L.tray.rimH + C.R + 2.4;
          hold.set(KK.clamp(x, -W.tableInnerX + 2, W.tableInnerX - 2), y, KK.clamp(z, -W.tableInnerZ + 2, W.tableInnerZ - 2));
        }
      } else {
        hold.set(x, hits[0].point.y + C.R + 2.4, z);
      }
    }
    KK.cam.keep(B.pos);
  }
  function nearTray(x, z) {
    var W = KK.world, L = W.L.tray, l = W.trayLocal(x, z, {});
    return W.stadiumDist(l.x, l.z, L.hl, L.hw) < L.hw + 1.5;
  }
  function endBall(a) {
    var B = KK.ball;
    B.release();
    KK.audio.hit('glass', 0.4, B.pan);
    KK.state.runs++;
  }

  // ═════════ 寝かせた部品 ═════════
  function startStowed(a, h) {
    var part = a.part;
    a.mode = 'carry';
    a.fromStow = true;
    part.pressed = true;
    var local = part.toLocalXZ(h.point.x, h.point.z, {});
    if (part.kind === 'straight') {
      // 押したのと反対の端が持ち上がる（裏の差し込み口と影が見える）
      var lift = local.x < 0 ? 1 : 0;
      if (Math.abs(local.x) < 2) lift = 1;
      part.dofs[lift].h = KK.parts.STOW_H + 2.3;
      part.dofs[1 - lift].h = KK.parts.STOW_H - 0.14;
      part.dofs[0].fast = part.dofs[1].fast = true;
      a.liftEnd = lift;
    } else if (part.kind === 'chute' || part.kind === 'corner') {
      part.dofs[0].h = part.dofs[0].hd + 0.9; part.dofs[0].fast = true;
    } else if (part.kind === 'spiral') {
      part.lift = 0.5;
    }
    KK.audio.hit('lift', 0.7, 0);
    beginCarryCommon(a, h);
  }

  // ═════════ 運ぶ ═════════
  function beginCarryCommon(a, h) {
    var part = a.part;
    a.planeY = h.point.y;
    a.off = { x: part.pose.x - h.point.x, z: part.pose.z - h.point.z };
    a.start = { x: part.pose.x, z: part.pose.z, yaw: part.pose.yaw };
    a.baseYaw = part.pose.yaw;
    a.joined = KK.track.jointCount(part) > 0;
    a.broken = !a.joined;
    a.snap = null;
    KK.state.dragPart = part;
  }
  function startCarry(a, h) {
    a.mode = 'carry';
    beginCarryCommon(a, h);
    if (!a.joined) liftUp(a.part);
    KK.audio.hit('lift', 0.5, 0);
  }
  function liftUp(part) {
    part.state = 'carry';
    part.lift = part.kind === 'spiral' ? 1.2 : 1.7;
  }
  function unstow(part, tilt) {
    part.state = 'carry';
    part.pressed = false;
    part.legs = 1;
    if (part.kind === 'straight') {
      var hi = tilt === 0 ? 0 : 1;
      part.dofs[hi].h = 4.6; part.dofs[1 - hi].h = 3.4;
      part.dofs[0].fast = part.dofs[1].fast = false;
    } else if (part.kind === 'chute') { part.dofs[0].h = 4.2; part.dofs[0].fast = false; }
    else if (part.kind === 'corner') part.dofs[0].h = 4;
  }

  function moveCarry(a) {
    var part = a.part;
    if (!a.moved) return;
    var p = rayY(a.planeY, hp);
    if (!p) return;
    var want = { x: p.x + a.off.x, z: p.z + a.off.z, yaw: a.baseYaw };
    clampBoard(want);
    if (a.fromStow && part.pressed) { unstow(part, a.liftEnd); liftUp(part); }
    // 継いだ部品は、まず継ぎ板が抜けてから離れる
    if (!a.broken) {
      var pd = Math.hypot(want.x - a.start.x, want.z - a.start.z);
      if (pd < 2.4) {
        part.pose.x = a.start.x + (want.x - a.start.x) * 0.22;
        part.pose.z = a.start.z + (want.z - a.start.z) * 0.22;
        part.pullOut = pd / 2.4;
        KK.cam.keep(part.group.position);
        return;
      }
      a.broken = true;
      part.pullOut = 0;
      KK.track.unjoinPart(part);
      KK.audio.hit('pull', 1, 0);
      liftUp(part);
    }
    var res = KK.track.findSnap(part, want);
    // 近づいた相手の縁で継ぎ板が揺れる
    part.ports.forEach(function (pt) { pt.near = null; });
    res.near.forEach(function (n) {
      n.p.near = n.q; n.p.nearT = 1 - KK.clamp((n.d - C.SNAP_R) / (C.NEAR_R - C.SNAP_R), 0, 1);
      if (!a.nearOn || KK.state.time - a.nearOn > 0.4) { KK.audio.hit('brush', 0.6, 0); a.nearOn = KK.state.time; }
    });
    if (!res.near.length) a.nearOn = 0;
    var wasSnap = a.snap && a.snap.length;
    a.snap = res.joins.length ? res.joins : null;
    part.pose.x = res.pose.x; part.pose.z = res.pose.z; part.pose.yaw = res.pose.yaw;
    if (a.snap) {
      part.lift = 0;
      // 継ぐ先の高さへ端を寄せて見せる
      a.snap.forEach(function (j) {
        if (!j.p.dof.fixed) j.p.dof.h = KK.clamp(j.q.part.portHeight(j.q, true) - j.p.off, j.p.dof.min, j.p.dof.max);
      });
      if (!wasSnap) KK.audio.hit('brush', 1, 0);
    } else {
      part.lift = part.kind === 'spiral' ? 1.2 : 1.7;
    }
    KK.cam.keep(part.group.position);
  }

  function endCarry(a) {
    var part = a.part;
    part.ports.forEach(function (pt) { pt.near = null; });
    part.pullOut = 0;
    if (a.fromStow && !a.moved) {
      // その場で、少し傾いて支えに載る
      unstow(part, a.liftEnd);
      if (part.kind === 'straight') { part.dofs[a.liftEnd].h = 4.2; part.dofs[1 - a.liftEnd].h = 3.0; }
      part.state = 'active'; part.lift = 0;
      KK.audio.hit('place', 0.8, 0);
      part.settle(0.8);
      return;
    }
    if (!a.broken) {
      // 継ぎ目は抜けなかった
      part.pose.x = a.start.x; part.pose.z = a.start.z;
      part.state = 'active'; part.lift = 0;
      part.settle(0.4);
      KK.audio.hit('place', 0.35, 0);
      return;
    }
    part.state = 'active'; part.lift = 0;
    var done = a.snap ? KK.track.commit(part, a.snap) : [];
    if (done.length) {
      KK.audio.hit('snap', 1, 0);
      part.settle(0.7);
      done.forEach(function (j) { j.q.part.settle(0.4); });
    } else {
      KK.audio.hit('place', 1, 0);
      part.settle(1);
      // 宙に浮いた高さのままにならないよう、端を板に届く高さへ
      part.dofs.forEach(function (d) { if (!d.fixed) d.h = KK.clamp(d.h, d.min, d.max); });
    }
    part.dofs.forEach(function (d) { d.fast = false; });
  }

  // ═════════ 高さ ═════════
  function startHeight(a, h, dof) {
    a.mode = 'height';
    a.dof = dof;
    var cam = KK.cam.camera;
    var fwd = tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0; fwd.normalize().negate();
    a.n = fwd.clone();
    a.pt = h.point.clone();
    a.y0 = h.point.y; a.h0 = dof.h;
    a.limit = false;
    KK.state.dragPart = a.part;
    KK.track.group(dof).forEach(function (d) { d.fast = true; });
    KK.audio.hit('lift', 0.4, 0);
  }
  function moveHeight(a) {
    var p = rayPlane(a.pt, a.n, hp);
    if (!p) return;
    var target = a.h0 + (p.y - a.y0);
    var grp = KK.track.group(a.dof);
    var want = target - a.dof.h;
    var got = KK.track.moveGroup(grp, want);
    var hit = Math.abs(want - got) > 0.35;
    if (hit && !a.limit) {
      // つまみの縁が受けに当たる
      KK.audio.hit('limit', 1, 0);
      grp.forEach(function (d) { d.part.wob.v += 3; d.part.hop.v += want > 0 ? 2.5 : -1.5; });
    }
    a.limit = hit;
    KK.cam.keep(a.part.group.position);
  }
  function endHeight(a) {
    KK.track.group(a.dof).forEach(function (d) { d.fast = false; d.part.settle(0.3); });
    if (a.moved) KK.audio.hit('place', 0.4, 0);
  }

  // ═════════ 継いだ端を軸に回す ═════════
  function startSwing(a, h, pj) {
    a.mode = 'swing';
    a.pj = pj;
    a.pivot = { x: pj.wx, z: pj.wz };
    a.planeY = h.point.y;
    a.a0 = Math.atan2(-(h.point.z - pj.wz), h.point.x - pj.wx);
    a.yaw0 = a.part.pose.yaw;
    a.limit = false;
    KK.state.dragPart = a.part;
    KK.audio.hit('lift', 0.3, 0);
  }
  function moveSwing(a) {
    if (!a.moved) return;
    var p = rayY(a.planeY, hp);
    if (!p) return;
    var ang = Math.atan2(-(p.z - a.pivot.z), p.x - a.pivot.x);
    var yaw = a.yaw0 + KK.wrapAngle(ang - a.a0);
    var r = KK.track.swingYaw(a.part, a.pj, yaw);
    var pose = KK.track.poseAbout(a.part, a.pj, a.pivot, r.yaw);
    a.part.pose.x = pose.x; a.part.pose.z = pose.z; a.part.pose.yaw = pose.yaw;
    if (r.hit && !a.limit) { KK.audio.hit('limit', 0.7, 0); a.part.wob.v += 3; }
    a.limit = r.hit;
    KK.cam.keep(a.part.group.position);
  }
  function endSwing(a) {
    if (a.moved) { KK.audio.hit('place', 0.45, 0); a.part.settle(0.3); }
    else a.part.settle(0.3);
  }

  // ═════════ 羽根車を指で回す ═════════
  function wheelAngle(a) {
    var ch = a.part, yaw = ch.disp.yaw;
    var A = ch.wheelG.getWorldPosition(tmp2);
    var n = tmp.set(Math.sin(yaw), 0, Math.cos(yaw));
    if (Math.abs(ray.ray.direction.dot(n)) < 0.22) return null;
    var p = rayPlane(A, n, hp);
    if (!p) return null;
    var lx = (p.x - A.x) * Math.cos(yaw) - (p.z - A.z) * Math.sin(yaw);
    var ly = p.y - A.y;
    return Math.atan2(lx, -ly);
  }
  function startWheel(a, h) {
    a.mode = 'wheel';
    a.lastAng = wheelAngle(a);
    a.lastX = a.x0;
    a.part.wheel.drag = true;
    KK.state.dragPart = a.part;
  }
  function moveWheel(a, dt, e) {
    var ang = wheelAngle(a);
    var d;
    if (ang !== null && a.lastAng !== null) d = KK.wrapAngle(ang - a.lastAng);
    else d = (e.clientX - a.lastX) * 0.02;
    a.lastAng = ang; a.lastX = e.clientX;
    KK.wheel.drag(a.part, d, dt);
    KK.cam.keep(a.part.group.position);
  }
  function endWheel(a) { a.part.wheel.drag = false; }

  // ═════════ 受け皿 ═════════
  function startTray(a, h) {
    var W = KK.world, L = W.L.tray;
    a.mode = 'tray';
    var l = W.trayLocal(h.point.x, h.point.z, {});
    var d = W.stadiumDist(l.x, l.z, L.hl, L.hw);
    a.rot = d > L.hw - L.rim - 1.6;
    a.planeY = L.floor;
    a.off = { x: W.trayPose.tx - h.point.x, z: W.trayPose.tz - h.point.z };
    a.c = { x: W.trayPose.tx, z: W.trayPose.tz };
    a.a0 = Math.atan2(-(h.point.z - a.c.z), h.point.x - a.c.x);
    a.yaw0 = W.trayPose.tyaw;
    KK.state.dragPart = W.tray;
    KK.audio.hit('lift', 0.35, 0);
  }
  function moveTray(a) {
    if (!a.moved) return;
    var W = KK.world, P = W.trayPose;
    var p = rayY(a.planeY, hp);
    if (!p) return;
    if (a.rot) {
      var ang = Math.atan2(-(p.z - a.c.z), p.x - a.c.x);
      P.tyaw = a.yaw0 + KK.wrapAngle(ang - a.a0);
    } else {
      P.tx = p.x + a.off.x; P.tz = p.z + a.off.z;
    }
    // 枠の内側に収める（向きに応じた張り出し）
    var L = W.L.tray, c = Math.abs(Math.cos(P.tyaw)), sn = Math.abs(Math.sin(P.tyaw));
    var ex = c * L.hw + sn * L.hl, ez = sn * L.hw + c * L.hl;
    var bx = C.BOARD_X - W.FRAME_W - 0.3, bz = C.BOARD_Z - W.FRAME_W - 0.3;
    P.tx = KK.clamp(P.tx, -bx + ex, bx - ex);
    P.tz = KK.clamp(P.tz, -bz + ez, bz - ez);
    KK.cam.keep(W.tray.position);
  }
  function endTray(a) { if (a.moved) KK.audio.hit('place', 0.4, 0); }
})();
