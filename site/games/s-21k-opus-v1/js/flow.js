// flow.js — 箱の中の流れ：投入口→坂板→待ち溝→盤のくぼみ→取り出し口→受け皿
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var V3 = THREE.Vector3, Q = THREE.Quaternion;
  var F = (G.flow = { box: [], queue: [], pocket: null, tray: [], released: 0 });
  var R = K.R, D2R = Math.PI / 180;

  F.canAccept = function () {
    var P = G.parts;
    return G.box.isUp() && P.board.installed && P.disk.installed;
  };
  F.boxEmpty = function () { return F.box.length === 0 && !F.pocket; };

  // 坂板の上面（中心線からカプセル中心まで）
  function boardY(x) {
    var hs = G.parts.board.highSide;
    var mid = (K.SLOT_HI + K.SLOT_LO) / 2;
    var tb = Math.tan(K.BETA);
    return mid + x * hs * tb + (K.T / 2 + R) / Math.cos(K.BETA);
  }

  // 投入
  F.insert = function (cp) {
    cp.state = 'box'; cp.phase = 'drop';
    cp.vel.set(0, 0, 0);
    cp.pos.x = G.clamp(cp.pos.x, -2.3, 2.3);
    F.box.push(cp);
    if (G.audio) G.audio.hit('card', 0.2);
    if (G.game) G.game.onEvent('inserted', cp);
  };

  function slotTarget(i, side) {
    var blocked = F.pocket && F.pocket.pos.distanceTo(K.queuePos(0, side)) < 1.75;
    return K.queuePos(i + (blocked ? 1 : 0), side);
  }

  // 盤のくぼみの位置
  function pocketPos(a, out) {
    return (out || new V3()).set(Math.sin(a) * K.POCKET_R, K.DISK_Y + Math.cos(a) * K.POCKET_R, K.LANE_Z);
  }

  var lastDisk = 0, tickAcc = 0;
  F.update = function (dt) {
    var P = G.parts;
    var side = P.board.slopeSide || 1;
    var a = P.disk.angle || 0;
    var da = a - lastDisk; lastDisk = a;

    for (var i = F.box.length - 1; i >= 0; i--) {
      var cp = F.box[i];
      var prev = cp.pos.clone();
      switch (cp.phase) {
        case 'drop': {
          cp.vel.y -= K.GRAV * dt;
          cp.pos.y += cp.vel.y * dt;
          cp.pos.z = G.damp(cp.pos.z, K.LANE_Z, 6, dt);
          var by = boardY(cp.pos.x);
          if (cp.pos.y <= by) {
            cp.pos.y = by;
            var imp = Math.abs(cp.vel.y);
            cp.vel.set(side * 0.4, 0, 0);
            cp.phase = 'board';
            if (G.audio) { G.audio.hit('card', Math.min(1, imp / 12), cp.pos.x / 6); G.audio.hit('shell', Math.min(1, imp / 14), cp.pos.x / 6); G.audio.hit('inner', 0.5, 0, 0.05); }
            if (cp.prize) cp.prize.lagV.y -= 0.5;
          }
          break;
        }
        case 'board': {
          var acc = K.GRAV * Math.sin(K.BETA) * 0.55;
          cp.vel.x += side * acc * dt;
          cp.vel.x *= Math.exp(-0.4 * dt);
          cp.pos.x += cp.vel.x * dt;
          cp.pos.y = boardY(cp.pos.x);
          cp.pos.z = G.damp(cp.pos.z, K.LANE_Z, 5, dt);
          cp.rollBy(cp.pos.x - prev.x, 0);
          if (G.audio) G.audio.ask('scrape', Math.min(0.3, Math.abs(cp.vel.x) / 20), 0.5);
          if (side * cp.pos.x > K.BODY_X - 0.15) {
            cp.phase = 'fall';
            cp.qi = F.queue.length;
            F.queue.push(cp);
            cp.fallFrom = cp.pos.clone();
            cp.fallT = 0;
          }
          break;
        }
        case 'fall': {
          cp.fallT += dt / 0.36;
          var tgt = slotTarget(F.queue.indexOf(cp), side);
          var k = Math.min(1, cp.fallT);
          cp.pos.x = G.lerp(cp.fallFrom.x, tgt.x, G.easeOut(k));
          cp.pos.y = G.lerp(cp.fallFrom.y, tgt.y, k * k);
          cp.pos.z = G.lerp(cp.fallFrom.z, tgt.z, k);
          cp.rollBy(cp.pos.x - prev.x, 0);
          if (k >= 1) {
            cp.phase = 'queue';
            cp.spring = new G.Spring3(cp.pos, 110, 7);
            cp.spring.v.set(-side * 1.5, -2.5, 0);
            if (G.audio) { G.audio.hit('card', 0.5, cp.pos.x / 6); G.audio.hit('shell', 0.5, cp.pos.x / 6, 0.01); G.audio.hit('inner', 0.4, 0, 0.06); }
            // 前にいる殻に当たって揺らす
            var qi = F.queue.indexOf(cp);
            if (qi > 0) { var fr = F.queue[qi - 1]; if (fr.spring) fr.spring.v.x += -side * 1.5; G.audio && G.audio.hit('shell', 0.6, 0, 0.04); }
          }
          break;
        }
        case 'queue': {
          var qi2 = F.queue.indexOf(cp);
          var t2 = slotTarget(qi2, side);
          cp.spring.t.copy(t2);
          cp.spring.step(dt);
          cp.pos.copy(cp.spring.x);
          cp.rollBy(cp.pos.x - prev.x, 0);
          var sp = cp.spring.v.length();
          if (cp.wasMoving && sp < 0.4) { if (G.audio) G.audio.hit('shell', 0.25, cp.pos.x / 6); }
          cp.wasMoving = sp > 1.0;
          // 盤の縁にのっている先頭は、回ると少し揺れる
          if (qi2 === 0 && Math.abs(da) > 0 && cp.pos.distanceTo(K.queuePos(0, side)) < 0.3) {
            cp.quat.premultiply(new Q().setFromAxisAngle(new V3(0, 0, 1), da * 0.35));
            cp.spring.v.x += da * 6;
          }
          // くぼみに座る
          if (qi2 === 0 && !F.pocket && Math.abs(G.wrapA(a)) < 0.28 && cp.pos.distanceTo(K.queuePos(0, side)) < 0.4) {
            seat(cp, side);
          }
          break;
        }
        case 'pocket': {
          if (cp.seatT < 1) {
            cp.seatT = Math.min(1, cp.seatT + dt / 0.12);
            var pp = pocketPos(a);
            cp.pos.lerpVectors(cp.seatFrom, pp, G.easeInOut(cp.seatT));
            if (cp.seatT >= 1 && G.audio) { G.audio.hit('shell', 0.55); G.audio.hit('card', 0.3, 0, 0.01); G.audio.hit('inner', 0.45, 0, 0.07); }
          } else {
            pocketPos(a, cp.pos);
          }
          cp.quat.premultiply(new Q().setFromAxisAngle(new V3(0, 0, 1), -da));
          var am = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          if (cp.seatT >= 1 && am > 155 * D2R && am < 205 * D2R) release(cp, da / Math.max(dt, 1e-3));
          break;
        }
        case 'chute': {
          if (cp.pos.y > K.chuteY(cp.pos.z) + R + 0.01) {
            cp.vel.y -= K.GRAV * dt;
            cp.pos.y += cp.vel.y * dt;
            var cy = K.chuteY(cp.pos.z) + R;
            if (cp.pos.y <= cy) {
              cp.pos.y = cy; cp.vel.y = 0;
              if (G.audio) { G.audio.hit('card', 0.5); G.audio.hit('shell', 0.4, 0, 0.01); }
            }
          } else {
            cp.vel.z += K.GRAV * 0.12 * dt;
            cp.pos.y = K.chuteY(cp.pos.z) + R;
          }
          cp.pos.z += cp.vel.z * dt;
          cp.vel.x *= Math.exp(-3 * dt);
          cp.pos.x = G.clamp(cp.pos.x + cp.vel.x * dt, -0.25, 0.25);
          cp.rollBy(cp.pos.x - prev.x, cp.pos.z - prev.z);
          if (cp.pos.z >= K.LIP_Z) {
            cp.phase = 'air';
            cp.vel.z = Math.max(cp.vel.z, 2.6);
            cp.vel.y = -0.3;
          }
          break;
        }
        case 'air': {
          cp.vel.y -= K.GRAV * dt;
          cp.pos.addScaledVector(cp.vel, dt);
          cp.rollBy(cp.pos.x - prev.x, cp.pos.z - prev.z);
          var floor = K.TRAY_FLOOR + R + P.tray.sink.x;
          if (cp.pos.y <= floor) {
            F.box.splice(i, 1);
            var tl = new V3(cp.pos.x - P.tray.x, 0, cp.pos.z - K.TRAY_Z);
            var v = new V3(cp.vel.x + cp.bias * 0.5, 0, cp.vel.z * 0.6);
            F.toTray(cp, tl, v, 0, true);
            continue;
          }
          break;
        }
      }
      cp.afterMove(dt);
    }
    // 盤の縁の打音（中に殻があるほど多い）
    if (Math.abs(da) > 0) {
      tickAcc += Math.abs(da) * (F.queue.length + (F.pocket ? 1 : 0));
      if (tickAcc > 0.9) { tickAcc = 0; if (G.audio && (F.queue.length || F.pocket)) G.audio.hit('tick', 0.5 + 0.2 * F.queue.length); }
    }
    trayUpdate(dt);
  };

  function seat(cp, side) {
    var i = F.queue.indexOf(cp);
    if (i >= 0) F.queue.splice(i, 1);
    cp.phase = 'pocket'; cp.seatT = 0; cp.seatFrom = cp.pos.clone();
    cp.entrySide = side;
    cp.bias = -side;  // 最後に当たった内壁の向き
    F.pocket = cp;
    // 後ろの殻が詰まって揺れる
    F.queue.forEach(function (q, j) {
      if (q.spring) { q.spring.v.x += -side * (2.2 - j * 0.6); }
      if (G.audio) G.audio.hit('shell', 0.35, 0, 0.05 + j * 0.07);
    });
    if (G.game) G.game.onEvent('seated', cp);
  }
  function release(cp, w) {
    F.pocket = null;
    cp.phase = 'chute';
    cp.vel.set(G.clamp(-w * 0.05, -0.5, 0.5), -0.5, 0.6);
    F.released++;
    if (G.audio) G.audio.hit('shell', 0.4);
    if (G.game) G.game.onEvent('release', cp);
  }

  // ---------- 受け皿の中 ----------
  F.toTray = function (cp, local, vel, dropH, fromBox) {
    if (F.box.indexOf(cp) >= 0) F.box.splice(F.box.indexOf(cp), 1);
    cp.state = 'tray';
    cp.tl = local.clone(); cp.tl.y = 0;
    cp.tv = vel ? vel.clone() : new V3(); cp.tv.y = 0;
    cp.ty = dropH || 0; cp.tvy = 0;
    cp.bounce = new G.Spring(0, 320, 10);
    cp.curve = fromBox ? 0.9 : 0;
    if (!fromBox) cp.bias = cp.bias || 0;
    cp.spinW = fromBox ? 7 * (cp.bias || 1) : 0;
    cp.settled = false; cp.settleT = 0;
    cp.held = false;
    if (F.tray.indexOf(cp) < 0) F.tray.push(cp);
    if ((dropH || 0) < 0.05) land(cp, fromBox ? 1 : 0.3);
  };
  function land(cp, s) {
    var t = G.parts.tray;
    t.sink.v -= 1.6 * s;
    G.after(0.07, function () { cp.bounce.v += 2.2 * s; });
    if (G.audio) {
      G.audio.hit('thud', 0.8 * s + 0.2, cp.tl.x / 4);
      G.audio.hit('shell', 0.6 * s + 0.2, cp.tl.x / 4, 0.01);
      if (cp.prize) G.audio.hit('inner', 0.7 * s + 0.2, cp.tl.x / 4, 0.09);
    }
    if (cp.prize) cp.prize.lagV.y -= 1;
    if (G.game) G.game.onEvent('landed', cp);
  }
  F.holdInTray = function (cp, f) { cp.held = f; };
  F.removeFromTray = function (cp) { var i = F.tray.indexOf(cp); if (i >= 0) F.tray.splice(i, 1); };
  F.trayLocalOf = function (cp) { return cp.tl ? cp.tl.clone() : new V3(); };

  function trayUpdate(dt) {
    var P = G.parts, tr = P.tray;
    var hx = K.TRAY_W / 2 - R - 0.12, hz = K.TRAY_D / 2 - R - 0.12;
    var statics = [];
    G.caps.shells.forEach(function (s) { if (s.state === 'tray' && s.trayLocal) statics.push(s.trayLocal); });
    F.tray.forEach(function (cp) {
      if (cp.held) {
        cp.pos.set(tr.x + cp.tl.x, K.TRAY_FLOOR + R + tr.sink.x, K.TRAY_Z + cp.tl.z);
        return;
      }
      var prev = cp.tl.clone();
      // 落ちてくる途中
      if (cp.ty > 0) {
        cp.tvy -= K.GRAV * dt; cp.ty += cp.tvy * dt;
        if (cp.ty <= 0) { cp.ty = 0; var sp = Math.abs(cp.tvy); cp.tvy = 0; land(cp, Math.min(1, sp / 6)); }
      }
      // 横回転が残っていると曲がる
      if (cp.curve > 0) {
        cp.tv.x += (cp.bias || 0) * 2.4 * cp.curve * dt;
        cp.curve = Math.max(0, cp.curve - dt * 1.1);
      }
      cp.tl.addScaledVector(cp.tv, dt);
      cp.tv.multiplyScalar(Math.exp(-1.9 * dt));
      var hit = 0;
      if (cp.tl.x > hx) { cp.tl.x = hx; cp.tv.x = -Math.abs(cp.tv.x) * 0.45; hit = Math.abs(cp.tv.x); cp.curve *= 0.3; }
      if (cp.tl.x < -hx) { cp.tl.x = -hx; cp.tv.x = Math.abs(cp.tv.x) * 0.45; hit = Math.abs(cp.tv.x); cp.curve *= 0.3; }
      if (cp.tl.z > hz) { cp.tl.z = hz; cp.tv.z = -Math.abs(cp.tv.z) * 0.4; hit = Math.max(hit, Math.abs(cp.tv.z)); }
      if (cp.tl.z < -hz) { cp.tl.z = -hz; cp.tv.z = Math.abs(cp.tv.z) * 0.4; hit = Math.max(hit, Math.abs(cp.tv.z)); }
      if (hit > 0.15) {
        tr.sink.v -= 0.15 * hit;
        if (G.audio) { G.audio.hit('card', Math.min(1, hit / 2), cp.tl.x / 4); G.audio.hit('shell', Math.min(0.6, hit / 3), cp.tl.x / 4, 0.01); }
      }
      // 他の殻と
      F.tray.forEach(function (o) {
        if (o === cp) return;
        var d = cp.tl.distanceTo(o.tl);
        if (d > 0 && d < 2 * R) {
          var n = cp.tl.clone().sub(o.tl).divideScalar(d);
          var push = (2 * R - d) / 2;
          cp.tl.addScaledVector(n, push);
          if (!o.held) o.tl.addScaledVector(n, -push);
          var rv = cp.tv.clone().sub(o.tv).dot(n);
          if (rv < 0) {
            cp.tv.addScaledVector(n, -rv * 0.8);
            if (!o.held) o.tv.addScaledVector(n, rv * 0.8);
            if (G.audio && -rv > 0.3) G.audio.hit('shell', Math.min(1, -rv / 3));
            o.settled = false;
          }
        }
      });
      statics.forEach(function (sl) {
        var d = Math.hypot(cp.tl.x - sl.x, cp.tl.z - sl.z);
        if (d > 0 && d < 2 * R) {
          var n = new V3(cp.tl.x - sl.x, 0, cp.tl.z - sl.z).divideScalar(d);
          cp.tl.addScaledVector(n, 2 * R - d);
          var rv = cp.tv.dot(n);
          if (rv < 0) { cp.tv.addScaledVector(n, -rv * 1.5); if (G.audio && -rv > 0.3) G.audio.hit('shell', Math.min(1, -rv / 3)); }
        }
      });
      var by = cp.bounce.step(dt);
      cp.pos.set(tr.x + cp.tl.x, K.TRAY_FLOOR + R + tr.sink.x + cp.ty + Math.max(0, by * 0.08), K.TRAY_Z + cp.tl.z);
      var dx = cp.tl.x - prev.x, dz = cp.tl.z - prev.z;
      cp.rollBy(dx, dz);
      // 継ぎ目が斜めに回る
      if (Math.abs(cp.spinW) > 0.05) {
        var ax = new V3(0.45 * (cp.bias || 1), 1, 0.3).normalize();
        cp.quat.premultiply(new Q().setFromAxisAngle(ax, cp.spinW * dt));
        cp.spinW *= Math.exp(-2.2 * dt);
      }
      var speed = cp.tv.length();
      if (G.audio && speed > 0.2) G.audio.ask('scrape', Math.min(0.2, speed / 12), 0.7);
      // 止まったら最後に少しだけ傾く
      if (speed < 0.06 && Math.abs(cp.spinW) < 0.3 && cp.ty === 0) {
        cp.settleT = Math.min(1, cp.settleT + dt / 0.8);
        if (!cp.restQ) cp.restQ = cp.upright().multiply(new Q().setFromAxisAngle(new V3(1, 0, 0.3).normalize(), G.rr(0.08, 0.16)));
        cp.quat.slerp(cp.restQ, 0.03 + cp.settleT * 0.05);
        if (!cp.settled && cp.settleT >= 1) {
          cp.settled = true;
          if (G.audio) G.audio.hit('inner', 0.2);
          if (G.game) G.game.onEvent('settled', cp);
        }
      } else { cp.settleT = 0; cp.restQ = null; }
      cp.afterMove(dt);
    });
  }

  // 箱の中に残る殻の数（案内用）
  F.waitingCount = function () { return F.box.filter(function (c) { return c.phase !== 'chute' && c.phase !== 'air'; }).length; };
})();
