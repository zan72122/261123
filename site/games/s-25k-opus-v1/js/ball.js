// ball.js — 乳白色のガラス玉。溝の中心線を転がり、縁を離れて飛び、皿やコルクで落ち着く
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var R = C.R;
  var W_ = null;
  var B = (KK.ball = {
    mode: 'rest', pos: new T.Vector3(), vel: new T.Vector3(),
    part: null, s: 0, v: 0, lat: 0, hop: 0, hopV: 0,
    surf: 'dimple', trayL: { x: 0, z: 0 }, q: new T.Quaternion(),
    hold: new T.Vector3(), holdV: new T.Vector3(),
    speed: 0, pan: 0, stillT: 0, dented: false, trailAcc: 0,
    lastLand: 0, inSpiral: false, everSpiral: false, airT: 0, paddleHit: 0,
    run: 0
  });
  var smp = {}, tq = new T.Quaternion(), ax = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  var gnd = {}, tl = {}, tw = {}, twn = {};

  B.init = function () {
    W_ = KK.world;
    var mat = new T.MeshPhysicalMaterial({
      map: KK.tex.ballStripe, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.03,
      sheen: 0.25, sheenColor: new T.Color(0xdfe8ff), sheenRoughness: 0.4, ior: 1.5, specularIntensity: 1.0
    });
    var m = (B.mesh = new T.Mesh(new T.SphereGeometry(R, 48, 32), mat));
    m.castShadow = true; m.receiveShadow = true;
    KK.world.scene.add(m);
    B.mat = mat;
    // 持つための大きめの当たり
    var pr = (B.proxy = new T.Mesh(new T.SphereGeometry(2.7, 10, 8), new T.MeshBasicMaterial()));
    pr.visible = false; pr.userData = { ball: true };
    KK.world.scene.add(pr);
    // 筋が転がりの向きと交わるよう、少し傾けた向きで始める
    B.q.setFromEuler(new T.Euler(KK.rand(0.5, 1.0), KK.rand(0, 6.28), KK.rand(-0.4, 0.4)));
    B.toDimple(true);
  };

  B.toDimple = function (quiet) {
    B.mode = 'rest'; B.surf = 'dimple';
    B.pos.copy(KK.world.dimpleRest);
    B.vel.set(0, 0, 0); B.part = null;
    if (!quiet) KK.audio.hit('dimple', 0.6, B.pan);
  };

  B.isMoving = function () {
    if (B.mode === 'held') return false;
    if (B.mode === 'air') return true;
    if (B.mode === 'path') return Math.abs(B.v) > 0.8;
    if (B.mode === 'ground') return B.vel.lengthSq() > 0.5;
    return false;
  };

  B.pick = function () {
    B.mode = 'held';
    B.part = null;
    B.hold.copy(B.pos);
    B.holdV.set(0, 0, 0);
    B.inSpiral = false;
    KK.audio.hit('glass', 0.8, B.pan);
  };
  B.release = function () {
    B.mode = 'air';
    B.vel.copy(B.holdV).multiplyScalar(0.15);
    B.vel.y = Math.min(B.vel.y, 0);
    B.airT = 0;
    B.run++;
  };

  // ── 部品の溝を調べる（螺旋の重なりに備えて高さも見る） ──
  function scan(x, y, z, out) {
    var list = KK.parts.list, best = null, bestScore = 1e9;
    for (var i = 0; i < list.length; i++) {
      var p = list[i], wp = p.wp, n = wp.pts.length;
      if (n < 2) continue;
      // 端より外（開いた出口の先）は溝ではない
      var e1 = wp.pts[n - 1], e0 = wp.pts[n - 2], s0p = wp.pts[0], s1p = wp.pts[1];
      var tx1 = e1.x - e0.x, tz1 = e1.z - e0.z, l1 = Math.hypot(tx1, tz1) || 1;
      var b1 = ((x - e1.x) * tx1 + (z - e1.z) * tz1) / l1 > 0.02;
      var tx0 = s0p.x - s1p.x, tz0 = s0p.z - s1p.z, l0 = Math.hypot(tx0, tz0) || 1;
      var b0 = ((x - s0p.x) * tx0 + (z - s0p.z) * tz0) / l0 > 0.02;
      for (var k = 0; k < n - 1; k++) {
        var a = wp.pts[k], b = wp.pts[k + 1];
        var ddx = b.x - a.x, ddz = b.z - a.z;
        var t = KK.segT(a.x, a.z, b.x, b.z, x, z);
        var ss = wp.cum[k] + (wp.cum[k + 1] - wp.cum[k]) * t;
        if ((b1 && ss > wp.len - 2.2) || (b0 && ss < 2.2)) continue;
        var px = a.x + ddx * t, pz = a.z + ddz * t;
        var d = Math.hypot(x - px, z - pz);
        if (d > p.outer + R + 0.3) continue;
        var fy = a.y + (b.y - a.y) * t;
        var rel = (y - R) - fy;
        if (rel < -(p.baseT + R + 0.4) || rel > p.wallH + 2.5) continue;
        var score = Math.abs(rel - 0.2) + d * 0.3;
        if (score < bestScore) {
          bestScore = score;
          var tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
          best = out;
          out.part = p; out.d = d; out.rel = rel; out.fy = fy;
          out.s = wp.cum[k] + (wp.cum[k + 1] - wp.cum[k]) * t;
          out.lat = (x - px) * (tz / l) + (z - pz) * (-tx / l);
          out.sx = tz / l; out.sz = -tx / l;
        }
      }
    }
    return best;
  }
  B.scan = scan;
  var sc = {};

  // 溝の上に置くための位置（持っているとき）
  B.grooveUnder = function (x, z, out) {
    var list = KK.parts.list, best = null, bestScore = 1e9, o = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.state === 'carry') continue;
      var d = p.nearest(x, z, o);
      if (d > 2.6) continue;
      var score = d - o.y * 0.05;
      if (score < bestScore) {
        bestScore = score; best = p;
        out.part = p; out.x = o.x; out.z = o.z; out.y = o.y; out.s = o.s; out.d = d;
      }
    }
    return best ? out : null;
  };

  function enterPath(part, s, v, lat) {
    B.mode = 'path'; B.part = part; B.s = KK.clamp(s, 0, part.wp.len); B.v = v;
    B.lat = KK.clamp(lat, -0.3, 0.3);
    if (part.kind === 'spiral') markSpiral();
  }
  function markSpiral() {
    B.inSpiral = true;
    if (!B.everSpiral) { B.everSpiral = true; KK.state.spiralSeen = true; }
  }

  function launch(dirSign) {
    var p = B.part;
    pathPos(B.pos);
    p.sample(B.s, smp);
    B.mode = 'air';
    B.vel.set(smp.tx * B.v, smp.ty * B.v, smp.tz * B.v);
    B.airT = 0;
    B.part = null; B.inSpiral = false;
  }

  // ── 中心線の上 ──
  function stepPath(dt) {
    var p = B.part;
    if (!p || p.wp.pts.length < 2) { B.mode = 'air'; return; }
    // 運ばれている部品が速く動くと、玉は支えを離れる
    if (p.state === 'carry' && p.moving > 70) { launch(); B.vel.y += 20; return; }
    p.sample(B.s, smp);
    var ga = -C.G * smp.ty * C.ROLL;
    var mu = 5.5;
    var av = Math.abs(B.v);
    if (av < 0.5 && Math.abs(ga) < mu * 1.2) { B.v = 0; }
    else {
      var a = ga - Math.sign(B.v) * mu - 0.0011 * B.v * av;
      var nv = B.v + a * dt;
      if (av > 0 && Math.sign(nv) !== Math.sign(B.v) && Math.abs(ga) < mu) nv = 0;
      B.v = nv;
    }
    if (p.kind === 'chute') B.s += KK.wheel.contact(p, B, dt);
    var s0 = B.s;
    B.s += B.v * dt;
    // 継ぎ目（螺旋の木口）
    if (p.seams.length) {
      for (var i = 0; i < p.seams.length; i++) {
        var sm = p.seams[i];
        if ((s0 - sm) * (B.s - sm) < 0) KK.audio.hit('spiralSeam', KK.clamp(av / 90, 0.1, 1), B.pan);
      }
    }
    // 曲がり角では外縁へ少し寄る
    var latT = KK.clamp(-smp.k * B.v * B.v * 0.0024, -0.32, 0.32);
    B.lat = KK.damp(B.lat, latT, 10, dt);
    B.hopV -= 900 * dt; B.hop += B.hopV * dt;
    if (B.hop < 0) { B.hop = 0; B.hopV = 0; }
    // 端
    var len = p.wp.len;
    if (B.s < 0 || B.s > len) {
      var end = B.s < 0 ? 0 : 1;
      var over = end === 0 ? -B.s : B.s - len;
      if (end === 0 && p.closedStart) {
        B.s = 0;
        if (Math.abs(B.v) > 6) KK.audio.hit('seam', Math.abs(B.v) / 120, B.pan);
        B.v = Math.abs(B.v) * 0.25;
        return;
      }
      var port = null;
      for (i = 0; i < p.ports.length; i++) if (p.ports[i].end === end) port = p.ports[i];
      if (port && port.joint) {
        var o = port.joint.other(port), op = o.part;
        var sp = Math.abs(B.v) * 0.972;
        if (o.end === 0) { B.s = over; B.v = sp; } else { B.s = op.wp.len - over; B.v = -sp; }
        B.part = op;
        B.hopV = 4 + sp * 0.03;
        KK.audio.hit('seam', KK.clamp(sp / 100, 0.15, 1.2), B.pan);
        if (op.kind === 'spiral') markSpiral(); else B.inSpiral = false;
        return;
      }
      // 開いた出口: その向きと速さで縁を離れる
      B.s = end === 0 ? 0 : len;
      launch();
      return;
    }
  }

  function pathPos(out) {
    var p = B.part;
    p.sample(B.s, smp);
    var nx = -smp.tx * smp.ty, ny = 1 - smp.ty * smp.ty, nz = -smp.tz * smp.ty;
    var nl = Math.hypot(nx, ny, nz) || 1;
    var hl = Math.hypot(smp.tx, smp.tz) || 1;
    var sx = smp.tz / hl, sz = -smp.tx / hl;
    out.set(smp.x + nx / nl * R + sx * B.lat, smp.y + ny / nl * R + B.hop, smp.z + nz / nl * R + sz * B.lat);
    return out;
  }

  // ── 宙 ──
  function stepAir(dt) {
    var prevY = B.pos.y;
    B.vel.y -= C.G * dt;
    B.pos.addScaledVector(B.vel, dt);
    B.airT += dt;
    var x = B.pos.x, y = B.pos.y, z = B.pos.z;
    // 溝
    var h = scan(x, y, z, sc);
    if (h) {
      var p = h.part;
      var prevRel = (prevY - R) - h.fy;
      if (h.d < p.inner + 0.3) {
        if (h.rel <= 0.02 && prevRel > -0.9) {
          // 着地
          p.sample(h.s, smp);
          var along = B.vel.x * smp.tx + B.vel.y * smp.ty + B.vel.z * smp.tz;
          var impact = -(B.vel.y - along * smp.ty);
          enterPath(p, h.s, along, h.lat);
          B.hopV = Math.min(impact * 0.06, 9);
          if (impact > 6 && KK.state.time - B.lastLand > 0.05) {
            KK.audio.hit(p.surface === 'spiral' ? 'woodLand' : 'woodLand', KK.clamp(impact / 160, 0.1, 1.2), B.pan);
            B.lastLand = KK.state.time;
            p.wob.v += impact * 0.02;
          }
          return;
        }
      } else if (h.d < p.outer + R) {
        var sx = h.sx, sz = h.sz, side = h.lat >= 0 ? 1 : -1;
        if (h.rel <= p.wallH && prevRel > p.wallH - 0.05) {
          // 壁の上に当たる
          B.pos.y = h.fy + p.wallH + R;
          B.vel.y = Math.abs(B.vel.y) * 0.3;
          var inward = h.d < (p.inner + p.outer) / 2 + 0.2;
          var dir = inward ? -side : side;
          B.vel.x += sx * dir * 26; B.vel.z += sz * dir * 26;
          if (KK.state.time - B.lastLand > 0.05) { KK.audio.hit('rim', 0.6, B.pan); B.lastLand = KK.state.time; }
        } else if (h.rel < p.wallH && h.rel > -(p.baseT + R)) {
          // 横から当たる
          var vl = (B.vel.x * sx + B.vel.z * sz) * side;
          if (vl < 0) {
            B.vel.x -= 1.4 * vl * sx * side; B.vel.z -= 1.4 * vl * sz * side;
            if (-vl > 10) KK.audio.hit('rim', KK.clamp(-vl / 120, 0.1, 1), B.pan);
          }
          var push = p.outer + R - h.d;
          B.pos.x += sx * side * push; B.pos.z += sz * side * push;
        }
      }
    }
    collideColumns(true);
    collideTrayRim(true, prevY);
    // 受け皿
    var L = KK.world.L.tray, floorY = L.floor + 0.02;
    if (KK.world.inTray(B.pos.x, B.pos.z, R * 0.6) && B.pos.y - R < floorY && prevY - R > floorY - 1.0) {
      landTray(floorY);
      return;
    }
    // くぼみ
    var D = KK.world.L.dimple;
    var dd = Math.hypot(B.pos.x - D.x, B.pos.z - D.z);
    if (dd < D.cupR && B.pos.y < KK.world.dimpleRest.y + 0.3) { B.toDimple(); return; }
    if (dd < D.r + R * 0.3 && B.pos.y - R < D.h && prevY - R >= D.h - 0.05) {
      // くぼみの台の縁
      B.pos.y = D.h + R; B.vel.y = Math.abs(B.vel.y) * 0.3;
      var ux = (B.pos.x - D.x) / (dd || 1), uz = (B.pos.z - D.z) / (dd || 1);
      if (dd < D.cupR + 0.5) { B.vel.x -= ux * 20; B.vel.z -= uz * 20; } else { B.vel.x += ux * 20; B.vel.z += uz * 20; }
    }
    // 地面
    KK.world.ground(B.pos.x, B.pos.z, gnd);
    if (B.pos.y - R < gnd.y) {
      var imp = -B.vel.y;
      B.pos.y = gnd.y + R;
      var e = gnd.type === 'cork' ? 0.26 : gnd.type === 'table' || gnd.type === 'frame' ? 0.34 : 0.1;
      if (gnd.type === 'frame') {
        // 枠の上に落ちたら内側へ転がす
        var fxx = C.BOARD_X - W_.FRAME_W / 2, fzz = C.BOARD_Z - W_.FRAME_W / 2;
        if (Math.abs(B.pos.x) > fxx - 0.6) B.vel.x = -Math.sign(B.pos.x) * Math.max(14, Math.abs(B.vel.x) * 0.4);
        if (Math.abs(B.pos.z) > fzz - 0.6) B.vel.z = -Math.sign(B.pos.z) * Math.max(14, Math.abs(B.vel.z) * 0.4);
        B.pos.y = gnd.y + R; B.vel.y = Math.max(imp * 0.3, 12);
        if (imp > 5) KK.audio.hit('rim', KK.clamp(imp / 160, 0.1, 1), B.pan);
        return;
      }
      B.vel.y = imp * e;
      B.vel.x *= 0.9; B.vel.z *= 0.9;
      if (imp > 5 && KK.state.time - B.lastLand > 0.05) {
        KK.audio.hit(gnd.type === 'cork' ? 'corkLand' : gnd.type === 'table' ? 'tableLand' : 'feltLand', KK.clamp(imp / 160, 0.1, 1.2), B.pan);
        B.lastLand = KK.state.time;
      }
      if (B.vel.y < 16) { B.vel.y = 0; B.mode = 'ground'; B.surf = gnd.type; B.stillT = 0; B.dented = false; }
    }
  }

  function landTray(floorY) {
    var imp = -B.vel.y;
    B.pos.y = floorY + R;
    var hs = Math.hypot(B.vel.x, B.vel.z);
    KK.world.trayLocal(B.pos.x, B.pos.z, tl);
    if (imp > 8) {
      // 着地点から毛が外へ倒れる
      var dl = KK.invRotXZ(B.vel.x, B.vel.z, KK.world.trayPose.yaw, tw);
      KK.felt.landing(tl.x, tl.z, dl.x, dl.z, imp / 110 + hs / 220);
      KK.felt.puff(B.pos.x, floorY, B.pos.z, 2 + Math.floor(Math.random() * 3));
      if (KK.state.time - B.lastLand > 0.05) KK.audio.hit('feltLand', KK.clamp(imp / 140, 0.15, 1.2), B.pan);
      B.lastLand = KK.state.time;
    }
    B.vel.y = imp * 0.1;
    B.vel.x *= 0.9; B.vel.z *= 0.9;
    B.landAt = { x: B.pos.x, z: B.pos.z };
    if (B.vel.y < 14) {
      B.vel.y = 0; B.mode = 'ground'; B.surf = 'tray'; B.stillT = 0; B.dented = false;
      B.trayL.x = tl.x; B.trayL.z = tl.z;
    }
  }

  // 柱など
  function collideColumns(air) {
    var cols = colCache;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (B.pos.y - R > c.top) continue;
      var dx = B.pos.x - c.x, dz = B.pos.z - c.z, d = Math.hypot(dx, dz);
      var lim = c.r + R;
      if (d < lim && d > 1e-4) {
        var nx = dx / d, nz = dz / d;
        B.pos.x = c.x + nx * lim; B.pos.z = c.z + nz * lim;
        var vn = B.vel.x * nx + B.vel.z * nz;
        if (vn < 0) {
          B.vel.x -= 1.45 * vn * nx; B.vel.z -= 1.45 * vn * nz;
          if (-vn > 8) KK.audio.hit('rim', KK.clamp(-vn / 120, 0.1, 1), B.pan);
        }
      }
    }
  }
  var colCache = [];
  function colliders() {
    colCache.length = 0;
    var Lp = KK.world.L.pillar;
    colCache.push({ x: Lp.x, z: Lp.z, r: Lp.r, top: Lp.h + 1 });
    colCache.push({ x: Lp.x, z: Lp.z, r: 2.7, top: 1.0 });
    var D = KK.world.L.dimple;
    if (B.mode === 'ground') colCache.push({ x: D.x, z: D.z, r: D.r, top: D.h });
    var list = KK.parts.list;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      for (var k = 0; k < p.colliders.length; k++) {
        var c = p.colliders[k];
        var w = p.toWorld(c.lx, 0, c.lz, KK.tmpV[0]);
        colCache.push({ x: w.x, z: w.z, r: c.r, top: c.top + p.liftD });
      }
      if (p.kind === 'spiral') {
        var b = p.toWorld(0, 0, 0, KK.tmpV[1]);
        colCache.push({ x: b.x, z: b.z, r: 3.2, top: 0.6 + p.liftD });
      }
    }
    return colCache;
  }

  // 受け皿の縁
  function collideTrayRim(air, prevY) {
    var L = KK.world.L.tray, W = KK.world;
    var top = L.rimH;
    if (B.pos.y - R > top + 0.1) return;
    W.trayLocal(B.pos.x, B.pos.z, tl);
    var c = L.hl - L.hw;
    var cz = KK.clamp(tl.z, -c, c);
    var dx = tl.x, dz = tl.z - cz, d = Math.hypot(dx, dz) || 1e-4;
    var rin = L.hw - L.rim, rout = L.hw;
    var nx = dx / d, nz = dz / d;  // 局所の外向き
    var wn = KK.rotXZ(nx, nz, W.trayPose.yaw, twn);
    var vn = B.vel.x * wn.x + B.vel.z * wn.z;
    if (air && prevY - R >= top - 0.05 && d > rin - R * 0.4 && d < rout + R * 0.4) {
      // 縁の上
      B.pos.y = top + R;
      B.vel.y = Math.abs(B.vel.y) * 0.3;
      var dir = d < (rin + rout) / 2 ? -1 : 1;
      B.vel.x += wn.x * dir * 24; B.vel.z += wn.z * dir * 24;
      if (KK.state.time - B.lastLand > 0.05) { KK.audio.hit('rim', 0.7, B.pan); B.lastLand = KK.state.time; }
      return;
    }
    if (d < rin + R && d > rin - R * 0.5 && B.pos.y - R < top) {
      // 内側から壁へ
      if (d > rin - R) {
        var pen = d - (rin - R);
        var p = W.trayWorld(tl.x - nx * pen, tl.z - nz * pen, tw);
        if (d >= rin - R) { B.pos.x = p.x; B.pos.z = p.z; }
        if (vn > 0) {
          B.vel.x -= 1.35 * vn * wn.x; B.vel.z -= 1.35 * vn * wn.z;
          if (vn > 8) KK.audio.hit('rim', KK.clamp(vn / 110, 0.1, 1), B.pan);
        }
      }
    } else if (d >= rin + R * 0.5 && d < rout + R && B.pos.y - R < top - 0.15) {
      // 外側から
      var pen2 = rout + R - d;
      var p2 = W.trayWorld(tl.x + nx * pen2, tl.z + nz * pen2, tw);
      B.pos.x = p2.x; B.pos.z = p2.z;
      if (vn < 0) {
        B.vel.x -= 1.35 * vn * wn.x; B.vel.z -= 1.35 * vn * wn.z;
        if (-vn > 8) KK.audio.hit('rim', KK.clamp(-vn / 110, 0.1, 1), B.pan);
      }
    }
  }

  // ── 面の上を転がる ──
  function stepGround(dt) {
    var W = KK.world, L = W.L.tray;
    var sp = Math.hypot(B.vel.x, B.vel.z);
    var dec;
    if (B.surf === 'tray') dec = 68 + 1.29 * sp;
    else if (B.surf === 'mat') dec = 102 + 1.1 * sp;
    else if (B.surf === 'cork') dec = 34 + 0.46 * sp;
    else dec = 20 + 0.28 * sp;
    if (sp > 0) {
      var ns = Math.max(0, sp - dec * dt);
      if (ns < 0.6) ns = 0;
      B.vel.x *= ns / sp; B.vel.z *= ns / sp;
    }
    B.pos.x += B.vel.x * dt; B.pos.z += B.vel.z * dt;
    // 受け皿の毛並みに跡
    if (B.surf === 'tray' && sp > 6) {
      B.trailAcc += sp * dt;
      if (B.trailAcc > 0.55) {
        B.trailAcc = 0;
        W.trayLocal(B.pos.x, B.pos.z, tl);
        var dl = KK.invRotXZ(B.vel.x, B.vel.z, W.trayPose.yaw, tw);
        KK.felt.trail(tl.x, tl.z, dl.x, dl.z, sp);
      }
    }
    collideColumns(false);
    collideTrayRim(false, B.pos.y);
    // 面の切り替わり
    if (B.surf === 'tray') {
      if (!W.inTray(B.pos.x, B.pos.z, -0.2)) {
        // 皿から出た（縁を越えるほど速いとき）
        B.mode = 'air'; B.vel.y = 10;
      } else B.pos.y = L.floor + 0.02 + R;
    } else {
      W.ground(B.pos.x, B.pos.z, gnd);
      if (gnd.type === 'frame' && B.surf !== 'frame') {
        // 枠に乗り上げない（上の枠の処理で戻す）
        gnd.y = B.surf === 'table' ? -C.BOARD_T : B.surf === 'mat' ? W.L.mat.t : 0; gnd.type = B.surf;
      }
      if (gnd.y < B.pos.y - R - 0.05) { B.mode = 'air'; B.airT = 0; return; }
      B.pos.y = gnd.y + R;
      if (gnd.type !== B.surf) B.surf = gnd.type;
      // くぼみに転がり込む
      var D = W.L.dimple;
      if (Math.hypot(B.pos.x - D.x, B.pos.z - D.z) < D.r + R && sp < 30) { /* 台に当たって止まる */ }
    }
    // コルクの枠
    if (B.surf === 'cork' || B.surf === 'mat') {
      var fx = C.BOARD_X - W.FRAME_W - R, fz = C.BOARD_Z - W.FRAME_W - R;
      if (Math.abs(B.pos.x) > fx) { B.pos.x = Math.sign(B.pos.x) * fx; if (B.vel.x * B.pos.x > 0) { if (Math.abs(B.vel.x) > 8) KK.audio.hit('rim', KK.clamp(Math.abs(B.vel.x) / 110, 0.1, 1), B.pan); B.vel.x *= -0.45; } }
      if (Math.abs(B.pos.z) > fz) { B.pos.z = Math.sign(B.pos.z) * fz; if (B.vel.z * B.pos.z > 0) { if (Math.abs(B.vel.z) > 8) KK.audio.hit('rim', KK.clamp(Math.abs(B.vel.z) / 110, 0.1, 1), B.pan); B.vel.z *= -0.45; } }
    }
    // 作業台の縁
    var ix = W.tableInnerX, iz = W.tableInnerZ;
    if (Math.abs(B.pos.x) > ix - R) { B.pos.x = Math.sign(B.pos.x) * (ix - R); B.vel.x *= -0.4; KK.audio.hit('tableLand', 0.3, B.pan); }
    if (Math.abs(B.pos.z) > iz - R) { B.pos.z = Math.sign(B.pos.z) * (iz - R); B.vel.z *= -0.4; KK.audio.hit('tableLand', 0.3, B.pan); }
    // 部品の横腹
    var h = scan(B.pos.x, B.pos.y, B.pos.z, sc);
    if (h && h.d > h.part.inner && h.d < h.part.outer + R && h.rel < h.part.wallH && h.rel > -(h.part.baseT + R)) {
      var side = h.lat >= 0 ? 1 : -1;
      var vl = (B.vel.x * h.sx + B.vel.z * h.sz) * side;
      if (vl < 0) { B.vel.x -= 1.4 * vl * h.sx * side; B.vel.z -= 1.4 * vl * h.sz * side; }
      var push = h.part.outer + R - h.d;
      B.pos.x += h.sx * side * push; B.pos.z += h.sz * side * push;
    }
    // 止まる
    if (sp < 0.01) {
      B.stillT += dt;
      if (B.surf === 'tray' && !B.dented && B.stillT > 0.15) {
        W.trayLocal(B.pos.x, B.pos.z, tl);
        KK.felt.dent(tl.x, tl.z);
        B.dented = true;
      }
    } else B.stillT = 0;
    if (B.surf === 'tray') { W.trayLocal(B.pos.x, B.pos.z, tl); B.trayL.x = tl.x; B.trayL.z = tl.z; }
  }

  // ── 毎フレーム ──
  var prevPos = new T.Vector3(), vproj = new T.Vector3();
  B.update = function (dt) {
    prevPos.copy(B.pos);
    colliders();
    // 皿が動いたら一緒に
    if (B.mode === 'ground' && B.surf === 'tray') {
      var w = KK.world.trayWorld(B.trayL.x, B.trayL.z, tw);
      B.pos.x = w.x; B.pos.z = w.z;
    }
    var chutes = KK.parts.byKind.chute || [];
    if (B.mode === 'held' || B.mode === 'rest') {
      var nw = Math.max(1, Math.ceil(dt / C.SUBSTEP));
      for (var iw = 0; iw < nw; iw++) for (var jw = 0; jw < chutes.length; jw++) KK.wheel.step(chutes[jw], dt / nw);
    }
    if (B.mode === 'held') {
      var k = 1 - Math.exp(-22 * dt);
      var ox = B.pos.x, oy = B.pos.y, oz = B.pos.z;
      B.pos.lerp(B.hold, k);
      B.holdV.set((B.pos.x - ox) / dt, (B.pos.y - oy) / dt, (B.pos.z - oz) / dt);
    } else if (B.mode === 'rest') {
      B.pos.lerp(KK.world.dimpleRest, 1 - Math.exp(-14 * dt));
    } else {
      var n = Math.max(1, Math.ceil(dt / C.SUBSTEP));
      var h = dt / n;
      for (var i = 0; i < n; i++) {
        for (var jc = 0; jc < chutes.length; jc++) KK.wheel.step(chutes[jc], h);
        if (B.mode === 'path') stepPath(h);
        else if (B.mode === 'air') stepAir(h);
        else if (B.mode === 'ground') stepGround(h);
        if (B.mode === 'held' || B.mode === 'rest') {
          for (var ir = i + 1; ir < n; ir++) for (jc = 0; jc < chutes.length; jc++) KK.wheel.step(chutes[jc], h);
          break;
        }
      }
      if (B.mode === 'path') pathPos(B.pos);
    }
    // 転がりに合わせた回転（進んだ距離ぶん）
    var dx = B.pos.x - prevPos.x, dy = B.pos.y - prevPos.y, dz = B.pos.z - prevPos.z;
    var dist = Math.hypot(dx, dz);
    if (B.mode === 'held') {
      // 指の中で少しだけ回る
      if (dist > 1e-4) { ax.set(dz, 0, -dx).normalize(); tq.setFromAxisAngle(ax, dist / R * 0.35); B.q.premultiply(tq); }
    } else if (B.mode !== 'air' && dist > 1e-5) {
      ax.set(dz, 0, -dx).normalize();
      var dd = Math.hypot(dist, B.mode === 'path' ? dy : 0);
      tq.setFromAxisAngle(ax, dd / R);
      B.q.premultiply(tq);
    } else if (B.mode === 'air') {
      // 宙では回転を保つ
      if (B.spinAxis) { tq.setFromAxisAngle(B.spinAxis, B.spinRate * dt); B.q.premultiply(tq); }
    }
    if (B.mode !== 'air') {
      if (dist > 1e-5) {
        B.spinAxis = B.spinAxis || new T.Vector3();
        B.spinAxis.set(dz, 0, -dx).normalize();
        B.spinRate = Math.hypot(dist, B.mode === 'path' ? dy : 0) / R / dt;
      } else B.spinRate = 0;
    }
    B.q.normalize();
    B.mesh.position.copy(B.pos);
    B.mesh.quaternion.copy(B.q);
    B.proxy.position.copy(B.pos);
    B.speed = Math.hypot(dx, dy, dz) / Math.max(dt, 1e-4);
    // 定位
    var cam = KK.cam && KK.cam.camera;
    if (cam) { vproj.copy(B.pos).project(cam); B.pan = KK.clamp(vproj.x, -1, 1) * 0.8; }
    // 転がる音
    var surf = 'none';
    if (B.mode === 'path') surf = B.part ? B.part.surface : 'wood';
    else if (B.mode === 'ground') surf = B.surf === 'tray' || B.surf === 'mat' ? 'felt' : B.surf;
    var spd = B.mode === 'path' ? Math.abs(B.v) : B.mode === 'ground' ? Math.hypot(B.vel.x, B.vel.z) : 0;
    KK.audio.rolling(spd, surf, B.pan);
  };
})();
