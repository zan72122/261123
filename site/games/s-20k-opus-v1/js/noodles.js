/* noodles.js — そうめん：束ごとの柔らかい何本もの線。載っている面と水への浸かり方で進む */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;
  var MAXP = 12000;
  var RAD = K.NOODLE_R, SEG = K.SEG;
  var HS = 0.042, HT = 32768;

  function Noodles(world) {
    this.world = world;
    this.course = world.course;
    this.water = world.water;
    this.net = world.net;
    this.zaru = world.zaru;
    this.scene = world.scene;
    this.M = world.mats;
    this.pos = new Float32Array(MAXP * 3);
    this.prev = new Float32Array(MAXP * 3);
    this.bef = new Float32Array(MAXP * 3);
    this.inv = new Float32Array(MAXP);
    this.imm = new Float32Array(MAXP);
    this.strandOf = new Int32Array(MAXP).fill(-1);
    this.owner = new Int32Array(MAXP).fill(-1);
    this.csurf = new Uint8Array(MAXP);
    this.cn = new Float32Array(MAXP * 3);
    this.wtr = new Int8Array(MAXP).fill(-1);
    this.ws = new Float32Array(MAXP);
    this.wl = new Float32Array(MAXP);
    this.tdir = new Float32Array(MAXP * 3);
    this.inMed = new Uint8Array(MAXP); // 0 空気 1 樋の水 2 水受けの水 3 つゆ
    this.act = new Uint8Array(MAXP);
    this.free = [{ start: 0, n: MAXP }];
    this.bundles = [];
    this.nextId = 1;
    this.strandCount = 0;
    this.hashCount = new Int32Array(HT + 1);
    this.hashStart = new Int32Array(HT + 1);
    this.hashList = new Int32Array(MAXP);
    this.hashKey = new Int32Array(MAXP);
    this.collidable = new Int32Array(MAXP);
    this.nCollidable = 0;
    this.time = 0;
    this.press = null;
    this.res = { s: 0, u: 0, w: 0, t: 0, nx: 0, ny: 0, nz: 0, tx: 0, ty: 0, tz: 0 };
    this.coilDir = SG.rsign();
    this.coilTight = SG.rr(0.85, 1.15);
    this.tsuyuY = 0.42;
    this.bowlCount = 0;
    this.placedCount = 0;
    // ざるの置き場
    var zp = this.course.zaruPos;
    this.slots = [];
    var ns = 5, a0 = SG.rr(0, Math.PI * 2);
    this.slots.push({ x: zp.x, z: zp.z, b: null, emptyT: 0 });
    for (var i = 0; i < ns; i++) {
      var a = a0 + i * Math.PI * 2 / ns;
      this.slots.push({ x: zp.x + Math.cos(a) * 0.55, z: zp.z + Math.sin(a) * 0.55, b: null, emptyT: 0 });
    }
    for (var s = 0; s < this.slots.length; s++) this.fillSlot(s);
  }

  // ---- 粒の割り当て ----
  Noodles.prototype.alloc = function (n) {
    for (var i = 0; i < this.free.length; i++) {
      var f = this.free[i];
      if (f.n >= n) {
        var s = f.start;
        f.start += n; f.n -= n;
        if (f.n === 0) this.free.splice(i, 1);
        return s;
      }
    }
    return -1;
  };
  Noodles.prototype.release = function (start, n) {
    this.free.push({ start: start, n: n });
    this.free.sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < this.free.length - 1; i++) {
      var a = this.free[i], b = this.free[i + 1];
      if (a.start + a.n === b.start) { a.n += b.n; this.free.splice(i + 1, 1); i--; }
    }
  };

  // ---- ざるに束を載せる（巻き方は遊びごとに少し変わる） ----
  Noodles.prototype.fillSlot = function (si) {
    var slot = this.slots[si];
    var b = this.makeBundle(slot.x, slot.z);
    if (!b) return;
    b.slot = si;
    slot.b = b;
    slot.emptyT = 0;
  };

  Noodles.prototype.makeBundle = function (cx, cz) {
    var R = SG.rand;
    var hasLong = R() < 0.4;
    var nS = 9 + (R() < 0.5 ? 1 : 0);
    var lens = [];
    for (var k = 0; k < nS; k++) lens.push(19 + Math.floor(R() * 5));
    if (hasLong) lens.push(34);
    var total = 0; lens.forEach(function (l) { total += l; });
    var start = this.alloc(total);
    if (start < 0) { this.bakeOldest(); start = this.alloc(total); if (start < 0) return null; }
    var b = {
      id: this.nextId++, start: start, n: total, strands: [], state: 'zaru',
      rest: null, pins: [], pinOff: [], mesh: null, slot: -1,
      sleepT: 0, frozenT: 0, inBowl: 0, inTr: 0, inNet: 0, inBasin: 0, maxDisp: 0,
      leadS: -9, lead: new T.Vector3(), center: new T.Vector3(cx, 0, cz),
      back: SG.rr(0, Math.PI * 2), backT: null, hasLong: hasLong,
      plopT: 0, catchT: 0, followed: false, placedAt: 0, everNet: false, sinceMove: 0
    };
    var dir = this.coilDir * (R() < 0.2 ? -1 : 1);
    var tight = this.coilTight;
    var zp = this.course.zaruPos;
    var P = this.pos, idx = start;
    var bx = Math.cos(b.back), bz = Math.sin(b.back);
    var tipStrands = [Math.floor(R() * nS), Math.floor(R() * nS), Math.floor(R() * nS)];
    for (var s = 0; s < lens.length; s++) {
      var n = lens[s];
      var isLong = hasLong && s === lens.length - 1;
      var sid = this.strandCount++;
      b.strands.push({ start: idx, n: n, long: isLong, sid: sid });
      var rc = (0.1 + 0.15 * ((s * 0.37 + R() * 0.35) % 1)) * tight;
      var y0 = 0.02 + 0.027 * (s % 4);
      var a0 = R() * Math.PI * 2;
      var ox = 0, oz = 0;
      if (isLong) { rc = 0.2 * tight; ox = bx * 0.1; oz = bz * 0.1; y0 = 0.1; }
      for (var j = 0; j < n; j++) {
        var t = j * SEG;
        var a = a0 + dir * t / rc * 0.9;
        var rr = rc * (1 + 0.1 * Math.sin(j * 0.9 + s * 1.7));
        var x = cx + ox + Math.cos(a) * rr, z = cz + oz + Math.sin(a) * rr;
        var y;
        if (isLong && j > n - 11) {
          // 長い一本の後ろは束の外へ垂れる
          var e = (j - (n - 11)) * SEG;
          x = cx + bx * (0.25 + e * 0.8) + Math.cos(a) * 0.03;
          z = cz + bz * (0.25 + e * 0.8) + Math.sin(a) * 0.03;
        }
        var rz = Math.sqrt((x - zp.x) * (x - zp.x) + (z - zp.z) * (z - zp.z));
        y = this.zaru.surfY(rz) + y0 + RAD + 0.01 * Math.sin(j * 0.7);
        var tip = tipStrands.indexOf(s) >= 0 && j >= n - 2;
        if (tip) y = this.zaru.surfY(rz) - 0.03 * (j - n + 3);
        var o = idx * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = z;
        this.strandOf[idx] = sid;
        this.owner[idx] = b.id;
        this.inv[idx] = 1;
        idx++;
      }
    }
    b.tipSet = tipStrands;
    this.relaxRest(b);
    this.makeLinks(b);
    b.rest = new Float32Array(P.subarray(start * 3, (start + total) * 3));
    this.prev.set(b.rest, start * 3);
    b.mesh = new NoodleMesh(this, b);
    this.scene.add(b.mesh.mesh);
    b.mesh.update();
    this.bundles.push(b);
    return b;
  };

  // ざるの上で形を落ち着かせる（重なりをほどく）
  Noodles.prototype.relaxRest = function (b) {
    var P = this.pos, zp = this.course.zaruPos;
    var s0 = b.start, n = b.n;
    for (var it = 0; it < 36; it++) {
      for (var s = 0; s < b.strands.length; s++) this.solveStrand(b.strands[s], 1);
      for (var i = s0; i < s0 + n; i++) {
        var oi = i * 3;
        for (var j = i + 1; j < s0 + n; j++) {
          if (this.strandOf[i] === this.strandOf[j] && j - i <= 2) continue;
          var oj = j * 3;
          var dx = P[oi] - P[oj], dy = P[oi + 1] - P[oj + 1], dz = P[oi + 2] - P[oj + 2];
          var d2 = dx * dx + dy * dy + dz * dz;
          var m = 2 * RAD;
          if (d2 < m * m && d2 > 1e-10) {
            var d = Math.sqrt(d2), c = (m - d) / d * 0.5;
            P[oi] += dx * c; P[oi + 1] += dy * c * 1.4; P[oi + 2] += dz * c;
            P[oj] -= dx * c; P[oj + 1] -= dy * c * 1.4; P[oj + 2] -= dz * c;
          }
        }
        var x = P[oi], z = P[oi + 2];
        var rz = Math.sqrt((x - zp.x) * (x - zp.x) + (z - zp.z) * (z - zp.z));
        var sy = this.zaru.surfY(rz) + RAD;
        var isTip = false;
        for (var q = 0; q < b.strands.length; q++) {
          var st = b.strands[q];
          if (i >= st.start + st.n - 2 && i < st.start + st.n && b.tipSet.indexOf(q) >= 0) isTip = true;
        }
        if (!isTip && P[oi + 1] < sy) P[oi + 1] = sy;
        if (!isTip) P[oi + 1] = SG.lerp(P[oi + 1], sy + 0.03, 0.04);
      }
    }
  };

  // 束の絡み：近くの別の線とゆるくつなぐ（水に浸かるとほどける）
  Noodles.prototype.makeLinks = function (b) {
    var P = this.pos, s0 = b.start, n = b.n;
    var la = [], lb = [], lr = [];
    var deg = new Uint8Array(n);
    var maxD = 0.075;
    for (var i = s0; i < s0 + n; i++) {
      if (deg[i - s0] >= 3) continue;
      var cand = [];
      for (var j = s0; j < s0 + n; j++) {
        if (this.strandOf[j] === this.strandOf[i] || deg[j - s0] >= 3) continue;
        var dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < maxD) cand.push({ j: j, d: d });
      }
      cand.sort(function (a, c) { return a.d - c.d; });
      for (var k = 0; k < cand.length && deg[i - s0] < 3; k++) {
        var jj = cand[k].j;
        if (jj < i) continue;
        la.push(i); lb.push(jj); lr.push(Math.max(cand[k].d, 2 * RAD));
        deg[i - s0]++; deg[jj - s0]++;
      }
    }
    b.la = new Int32Array(la); b.lb = new Int32Array(lb); b.lr = new Float32Array(lr);
    b.life = new Float32Array(la.length);
    for (var q = 0; q < la.length; q++) b.life[q] = SG.rr(0.25, 1.6);
  };
  Noodles.prototype.solveLinks = function (b) {
    var P = this.pos, inv = this.inv, la = b.la, lb = b.lb, lr = b.lr, life = b.life;
    var held = b.state === 'held';
    for (var q = 0; q < la.length; q++) {
      if (life[q] <= 0) continue;
      var i = la[q], j = lb[q];
      var wi = inv[i], wj = inv[j], w = wi + wj;
      if (w === 0) continue;
      var oi = i * 3, oj = j * 3;
      var dx = P[oj] - P[oi], dy = P[oj + 1] - P[oi + 1], dz = P[oj + 2] - P[oi + 2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-7) continue;
      if (!held && d > lr[q] * 4 + 0.08) { life[q] = 0; continue; }
      var c = (d - lr[q]) / d * (held ? 0.8 : 0.45) / w;
      P[oi] += dx * c * wi; P[oi + 1] += dy * c * wi; P[oi + 2] += dz * c * wi;
      P[oj] -= dx * c * wj; P[oj + 1] -= dy * c * wj; P[oj + 2] -= dz * c * wj;
    }
  };
  Noodles.prototype.loosenLinks = function (b, dt) {
    var imm = this.imm, med = this.inMed, la = b.la, lb = b.lb, life = b.life;
    var alive = 0;
    for (var q = 0; q < la.length; q++) {
      if (life[q] <= 0) continue;
      var i = la[q], j = lb[q];
      var m = Math.max(imm[i], imm[j]);
      if (m > 0.3) {
        var fast = (med[i] === 1 || med[j] === 1) ? 1.0 : 0.45;
        life[q] -= dt * m * fast;
      }
      if (life[q] > 0) alive++;
    }
    b.linksAlive = alive;
  };

  Noodles.prototype.solveStrand = function (st, stiff) {
    var P = this.pos, inv = this.inv;
    var a = st.start, n = st.n;
    for (var j = 0; j < n - 1; j++) {
      var i1 = (a + j) * 3, i2 = i1 + 3;
      var w1 = inv[a + j], w2 = inv[a + j + 1], w = w1 + w2;
      if (w === 0) continue;
      var dx = P[i2] - P[i1], dy = P[i2 + 1] - P[i1 + 1], dz = P[i2 + 2] - P[i1 + 2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-7) continue;
      var c = (d - SEG) / d * stiff / w;
      P[i1] += dx * c * w1; P[i1 + 1] += dy * c * w1; P[i1 + 2] += dz * c * w1;
      P[i2] -= dx * c * w2; P[i2 + 1] -= dy * c * w2; P[i2 + 2] -= dz * c * w2;
    }
    // 折れすぎない（ゆるい曲げ）
    var mn = SEG * 1.3;
    for (var j2 = 0; j2 < n - 2; j2++) {
      var k1 = (a + j2) * 3, k2 = k1 + 6;
      var v1 = inv[a + j2], v2 = inv[a + j2 + 2], vv = v1 + v2;
      if (vv === 0) continue;
      var ex = P[k2] - P[k1], ey = P[k2 + 1] - P[k1 + 1], ez = P[k2 + 2] - P[k1 + 2];
      var e = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (e < mn && e > 1e-7) {
        var cc = (e - mn) / e * 0.3 / vv;
        P[k1] += ex * cc * v1; P[k1 + 1] += ey * cc * v1; P[k1 + 2] += ez * cc * v1;
        P[k2] -= ex * cc * v2; P[k2 + 1] -= ey * cc * v2; P[k2 + 2] -= ez * cc * v2;
      }
    }
  };

  // ---- ざるから持つ ----
  Noodles.prototype.pickZaru = function (ray) {
    var best = null, bt = 1e9;
    var v = SG.tmpV[3];
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state !== 'zaru') continue;
      this.bundleCenter(b, v);
      var d = ray.distanceSqToPoint(v);
      if (d < 0.42 * 0.42) {
        var t = v.clone().sub(ray.origin).dot(ray.direction);
        if (t < bt) { bt = t; best = b; }
      }
    }
    return best;
  };
  Noodles.prototype.bundleCenter = function (b, out) {
    var P = this.pos, sx = 0, sy = 0, sz = 0;
    for (var i = b.start; i < b.start + b.n; i += 3) { sx += P[i * 3]; sy += P[i * 3 + 1]; sz += P[i * 3 + 2]; }
    var c = Math.ceil(b.n / 3);
    return out.set(sx / c, sy / c, sz / c);
  };

  Noodles.prototype.holdStart = function (b) {
    var P = this.pos;
    var c = this.bundleCenter(b, new T.Vector3());
    var cand = [];
    for (var i = b.start; i < b.start + b.n; i++) {
      var dx = P[i * 3] - c.x, dy = P[i * 3 + 1] - c.y, dz = P[i * 3 + 2] - c.z;
      cand.push({ i: i, s: Math.sqrt(dx * dx + dz * dz) - dy * 0.6 });
    }
    cand.sort(function (a, b2) { return a.s - b2.s; });
    b.pins = []; b.pinOff = [];
    for (var k = 0; k < 6; k++) {
      var pi = cand[k].i;
      b.pins.push(pi);
      b.pinOff.push(new T.Vector3(P[pi * 3] - c.x, P[pi * 3 + 1] - c.y, P[pi * 3 + 2] - c.z).multiplyScalar(0.5));
      this.inv[pi] = 0;
    }
    b.holdC = c.clone();
    b.state = 'held';
    b.snap = null;
    b.backT = null;
    if (b.slot >= 0) { this.slots[b.slot].b = null; this.slots[b.slot].emptyT = 0; b.slot = -1; }
    SG.events.emit('noodlePick', c);
  };

  // 持っている束を目標へ（ゆっくり、中央から）
  Noodles.prototype.holdMove = function (b, target, upstreamDir) {
    b.holdTarget = target.clone();
    if (upstreamDir) b.backT = Math.atan2(upstreamDir.z, upstreamDir.x); else b.backT = null;
  };

  Noodles.prototype._applyHold = function (b, h) {
    if (!b.holdTarget) return;
    var P = this.pos, Pv = this.prev;
    var c = b.holdC;
    var tx = b.holdTarget.x, ty = b.holdTarget.y, tz = b.holdTarget.z;
    var mx = SG.clamp(tx - c.x, -0.03, 0.03), my = SG.clamp(ty - c.y, -0.022, 0.022), mz = SG.clamp(tz - c.z, -0.03, 0.03);
    c.x += mx; c.y += my; c.z += mz;
    // 後ろを上流へ向ける
    var rot = 0;
    if (b.backT !== null) {
      var dA = SG.wrapAngle(b.backT - b.back);
      rot = SG.clamp(dA, -0.03, 0.03);
      b.back += rot;
    }
    if (rot !== 0) {
      var cr = Math.cos(rot), sr = Math.sin(rot);
      for (var i = b.start; i < b.start + b.n; i++) {
        var o = i * 3;
        var x = P[o] - c.x, z = P[o + 2] - c.z;
        P[o] = c.x + x * cr - z * sr; P[o + 2] = c.z + x * sr + z * cr;
        var px = Pv[o] - c.x, pz = Pv[o + 2] - c.z;
        Pv[o] = c.x + px * cr - pz * sr; Pv[o + 2] = c.z + px * sr + pz * cr;
      }
      for (var q = 0; q < b.pinOff.length; q++) {
        var po = b.pinOff[q], ox = po.x, oz = po.z;
        po.x = ox * cr - oz * sr; po.z = ox * sr + oz * cr;
      }
    }
    for (var k = 0; k < b.pins.length; k++) {
      var pi = b.pins[k] * 3;
      Pv[pi] = P[pi]; Pv[pi + 1] = P[pi + 1]; Pv[pi + 2] = P[pi + 2];
      P[pi] = c.x + b.pinOff[k].x; P[pi + 1] = c.y + b.pinOff[k].y; P[pi + 2] = c.z + b.pinOff[k].z;
    }
  };

  Noodles.prototype.holdEnd = function (b, placed) {
    for (var k = 0; k < b.pins.length; k++) this.inv[b.pins[k]] = 1;
    b.pins = []; b.pinOff = [];
    b.holdTarget = null;
    if (placed) {
      b.state = 'active';
      b.placedAt = this.time;
      b.sleepT = 0;
      this.placedCount++;
      SG.events.emit('noodlePlace', b);
    } else {
      b.state = 'returning';
      b.retT = 0;
      b.retFrom = new Float32Array(this.pos.subarray(b.start * 3, (b.start + b.n) * 3));
      // 元の置き場へ戻す
      var free = -1;
      for (var s = 0; s < this.slots.length; s++) if (!this.slots[s].b) { free = s; break; }
      if (free >= 0) {
        var sl = this.slots[free];
        sl.b = b; b.slot = free;
        // 置き場の中心に合わせて rest をずらす
        var cx = 0, cz = 0;
        for (var i = 0; i < b.n; i++) { cx += b.rest[i * 3]; cz += b.rest[i * 3 + 2]; }
        cx /= b.n; cz /= b.n;
        for (var j = 0; j < b.n; j++) { b.rest[j * 3] += sl.x - cx; b.rest[j * 3 + 2] += sl.z - cz; }
      }
    }
  };

  // ---- 押す ----
  Noodles.prototype.pick = function (ray) {
    var best = null, bd = 0.11 * 0.11, bt = 1e9;
    var v = SG.tmpV[4];
    var P = this.pos;
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state !== 'active' && b.state !== 'sleep') continue;
      for (var j = b.start; j < b.start + b.n; j += 2) {
        v.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
        var d = ray.distanceSqToPoint(v);
        if (d < bd) {
          var t = v.clone().sub(ray.origin).dot(ray.direction);
          if (t < bt + 0.3) { bt = Math.min(t, bt); bd = d; best = { b: b, p: v.clone() }; }
        }
      }
    }
    return best;
  };
  Noodles.prototype.pickZaruAny = function () {
    var zp = this.course.zaruPos, best = null, bd = 1e9;
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state !== 'zaru') continue;
      // 樋に近い側の束から
      var c = this.bundleCenter(b, SG.tmpV[3]);
      var d = Math.abs(c.z - this.course.TZ) + Math.abs(c.x - (this.course.TX + 1.5)) * 0.5;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };
  Noodles.prototype.setPressMove = function (p) {
    if (this.press) { this.press.x = p.x; this.press.z = p.z; }
  };
  Noodles.prototype.setPress = function (p) {
    this.press = p ? { x: p.x, y: p.y, z: p.z, t: 0 } : null;
    if (p) SG.events.emit('noodlePress', p);
  };

  // ---- 1コマ ----
  Noodles.prototype.step = function (dtReal) {
    var dt = dtReal * K.TS;
    this.time += dt;
    var active = [];
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state === 'held' || b.state === 'active') active.push(b);
      else if (b.state === 'returning') this._returnStep(b, dtReal);
    }
    this.water = this.world.water;
    this.paths = this.course.activePaths();
    var act = this.act;
    for (var ai = 0; ai < this.bundles.length; ai++) {
      var ab = this.bundles[ai];
      if (ab.start < 0) continue;
      var on = (ab.state === 'held' || ab.state === 'active') ? 1 : 0;
      for (var aj = ab.start; aj < ab.start + ab.n; aj++) act[aj] = on;
    }
    if (active.length) {
      var nsub = dt > 0.014 ? 3 : 2;
      var h = dt / nsub;
      for (var s = 0; s < nsub; s++) {
        for (var a = 0; a < active.length; a++) if (active[a].state === 'held') this._applyHold(active[a], h);
        this._integrate(active, h);
        for (var it = 0; it < 3; it++) {
          for (var a2 = 0; a2 < active.length; a2++) {
            var bb = active[a2];
            for (var q = 0; q < bb.strands.length; q++) this.solveStrand(bb.strands[q], 1);
            this.solveLinks(bb);
          }
          if (it < 2) this._envAll(active, false, h);
        }
        this._selfCollide(active);
        this._envAll(active, true, h);
      }
      this._stats(active, dtReal);
    }
    if (this.press) { this.press.t += dtReal; }
    // 置き場の補充
    for (var sl = 0; sl < this.slots.length; sl++) {
      var slot = this.slots[sl];
      if (!slot.b) {
        slot.emptyT += dtReal;
        var hidden = this.world.isZaruHidden ? this.world.isZaruHidden() : true;
        var loose = 0;
        for (var lb = 0; lb < this.bundles.length; lb++) { var lst = this.bundles[lb].state; if (lst === 'active' || lst === 'sleep') loose++; }
        var due = (slot.emptyT > 10 && hidden) || slot.emptyT > 45;
        if (due && loose >= 12) { if (this.bakeOldestSleep()) loose--; }
        if (due && loose < 14) this.fillSlot(sl);
      }
    }
    for (var m = 0; m < this.bundles.length; m++) {
      var bm = this.bundles[m];
      if (bm.wob > 0) {
        bm.wob -= dtReal;
        bm.mesh.mesh.position.y = Math.max(0, Math.sin(bm.wob * 30) * 0.03 * bm.wob / 0.3);
        if (bm.wob <= 0) bm.mesh.mesh.position.y = 0;
      }
      if (bm.state === 'held' || bm.state === 'active' || bm.state === 'returning' || bm.dirty) { bm.mesh.update(); bm.dirty = false; }
    }
  };

  Noodles.prototype._returnStep = function (b, dt) {
    b.retT += dt / 0.55;
    var t = SG.smooth(0, 1, b.retT);
    var P = this.pos, Pv = this.prev, o = b.start * 3;
    for (var i = 0; i < b.n * 3; i++) {
      var y = SG.lerp(b.retFrom[i], b.rest[i], t);
      if (i % 3 === 1) y += Math.sin(t * Math.PI) * 0.25;
      P[o + i] = y; Pv[o + i] = y;
    }
    if (b.retT >= 1) {
      P.set(b.rest, o); Pv.set(b.rest, o);
      b.state = 'zaru';
      if (b.slot < 0) {
        for (var s = 0; s < this.slots.length; s++) if (!this.slots[s].b) { this.slots[s].b = b; b.slot = s; break; }
      }
      b.dirty = true;
      SG.events.emit('noodleBack', b);
    }
  };

  Noodles.prototype._integrate = function (active, h) {
    var P = this.pos, Pv = this.prev, inv = this.inv, imm = this.imm;
    var G = K.G;
    var W = this.water;
    var B = this.course.basin, bowl = this.course.bowlPos;
    var lvl = W.basinLevel;
    var pr = this.press;
    var vs = { h: 0, v: 0 };
    var chans = [];
    for (var c = 0; c < this.paths.length; c++) chans.push(W.channelFor(this.paths[c]));
    for (var a = 0; a < active.length; a++) {
      var b = active[a];
      for (var i = b.start; i < b.start + b.n; i++) {
        if (inv[i] === 0) continue;
        var o = i * 3;
        var x = P[o], y = P[o + 1], z = P[o + 2];
        var vx = (x - Pv[o]) * 0.999, vy = (y - Pv[o + 1]) * 0.999, vz = (z - Pv[o + 2]) * 0.999;
        var ax = 0, ay = -G, az = 0;
        var im = 0, kd = 0, wx = 0, wy = 0, wz = 0, med = 0;
        var tri = this.wtr[i];
        if (tri >= 0 && tri < chans.length && chans[tri]) {
          var ch = chans[tri];
          ch.sample(this.ws[i], vs);
          var Rt = K.R;
          var wsurf = -Rt + vs.h;
          im = SG.clamp((wsurf - (this.wl[i] - RAD)) / (2 * RAD), 0, 1);
          if (vs.h < 0.004) im = 0;
          if (im > 0) {
            var to = o;
            wx = this.tdir[to] * vs.v; wy = this.tdir[to + 1] * vs.v; wz = this.tdir[to + 2] * vs.v;
            kd = 12; med = 1;
            ay += Math.abs(vs.v) * 3.2 * im;
          }
        } else {
          var sd = SG.sdRoundRect(x, z, B.cx, B.cz, B.hx, B.hz, B.rc);
          if (sd < 0.05 && y < lvl + RAD && lvl > B.liner + 0.003) {
            im = SG.clamp((lvl - (y - RAD)) / (2 * RAD), 0, 1);
            kd = 6; med = 2;
          } else {
            var dx = x - bowl.x, dz = z - bowl.z;
            if (dx * dx + dz * dz < 0.9 * 0.9 && y < this.tsuyuY + RAD) {
              im = SG.clamp((this.tsuyuY - (y - RAD)) / (2 * RAD), 0, 1);
              kd = 16; med = 3;
            }
          }
        }
        imm[i] = im;
        this.inMed[i] = med;
        ay += G * 0.86 * im;
        if (kd > 0 && im > 0) {
          var f = kd * im;
          ax += f * (wx - vx / h); ay += f * (wy - vy / h); az += f * (wz - vz / h);
        }
        if (pr) {
          var ddx = x - pr.x, ddy = y - pr.y, ddz = z - pr.z;
          var dd = Math.sqrt(ddx * ddx + ddz * ddz);
          if (dd < 0.24 && ddy > -0.15 && ddy < 0.3) {
            var k = (1 - dd / 0.24);
            ay -= 90 * k;
            if (dd > 1e-4) { ax += ddx / dd * 14 * k; az += ddz / dd * 14 * k; }
          }
        }
        Pv[o] = x; Pv[o + 1] = y; Pv[o + 2] = z;
        P[o] = x + vx + ax * h * h;
        P[o + 1] = y + vy + ay * h * h;
        P[o + 2] = z + vz + az * h * h;
        this.bef[o] = P[o]; this.bef[o + 1] = P[o + 1]; this.bef[o + 2] = P[o + 2];
      }
    }
  };

  // ---- 面との当たり ----
  Noodles.prototype._envAll = function (active, final, h) {
    var P = this.pos, Pv = this.prev, inv = this.inv, bef = this.bef;
    var paths = this.paths, res = this.res;
    var B = this.course.basin, bowl = this.course.bowlPos, net = this.net;
    var bowlIn = SG.bowlInnerR;
    for (var a = 0; a < active.length; a++) {
      var b = active[a];
      for (var i = b.start; i < b.start + b.n; i++) {
        if (inv[i] === 0) continue;
        var o = i * 3;
        var surf = 0, nx = 0, ny = 0, nz = 0, mu = 0, svx = 0, svy = 0, svz = 0;
        // 樋
        var found = -1;
        for (var p = 0; p < paths.length; p++) {
          var path = paths[p];
          res.s = -9;
          var type = path.collide(P, o, RAD, res);
          if (res.s >= 0 && res.s <= path.L && found < 0) {
            var inside = type === 1 || (type === 0 && res.w < 0.03 && (res.u * res.u + res.w * res.w) < K.R * K.R);
            if (inside) {
              found = p;
              this.ws[i] = res.s; this.wl[i] = res.w;
              if (type === 1) { this.tdir[o] = res.tx; this.tdir[o + 1] = res.ty; this.tdir[o + 2] = res.tz; }
              else { var fr = SG.tmpV[5]; path.frame(res.s, fr, SG.tmpV[4], SG.tmpV[3]); this.tdir[o] = fr.x; this.tdir[o + 1] = fr.y; this.tdir[o + 2] = fr.z; }
            }
          }
          if (type) {
            surf = 1; nx = res.nx; ny = res.ny; nz = res.nz;
            mu = 0.5;
            if (res.s > path.L - 0.07 && this.imm[i] < 0.7) mu += 0.55;
          }
        }
        this.wtr[i] = found;
        // 網
        var nt = this.inMed[i] === 3 ? 0 : net.collide(P, o, RAD, res);
        if (nt) {
          surf = 2; nx = res.nx; ny = res.ny; nz = res.nz; mu = nt === 1 ? 0.65 : 0.4;
          svx = net.vel.x * h; svy = net.vel.y * h; svz = net.vel.z * h;
        }
        // 水受け
        var x = P[o], y = P[o + 1], z = P[o + 2];
        if (x > B.cx - B.hx - 0.3 && x < B.cx + B.hx + 0.3 && z > B.cz - B.hz - 0.3 && z < B.cz + B.hz + 0.3 && y < B.H + 0.1) {
          var sd = SG.sdRoundRect(x, z, B.cx, B.cz, B.hx, B.hz, B.rc);
          var sw = B.flare * SG.clamp((y - B.floor) / (B.H - B.floor), 0, 1);
          if (sd < sw + 0.02) {
            if (y < B.liner + RAD) { P[o + 1] = B.liner + RAD; surf = 3; nx = 0; ny = 1; nz = 0; mu = 0.45; }
            if (sd > sw - RAD && y < B.H) {
              var gr = SG.sdRoundRectGrad(x, z, B.cx, B.cz, B.hx, B.hz, B.rc, { x: 0, z: 0 });
              var push = sd - (sw - RAD);
              P[o] -= gr.x * push; P[o + 2] -= gr.z * push;
              surf = 3; nx = -gr.x; ny = 0; nz = -gr.z; mu = 0.3;
            }
          } else if (sd < sw + 0.07 && y < B.H + 0.025 + RAD && y > B.H - 0.05) {
            P[o + 1] = B.H + 0.025 + RAD; surf = 3; nx = 0; ny = 1; nz = 0; mu = 0.5;
          }
        }
        // つゆの器
        x = P[o]; y = P[o + 1]; z = P[o + 2];
        var bx = x - bowl.x, bz = z - bowl.z;
        var br2 = bx * bx + bz * bz;
        if (br2 < 1.1 * 1.1 && y < 0.8) {
          var rho = Math.sqrt(br2);
          var rin = bowlIn(Math.max(y, 0.09));
          if (rho < rin + 0.03) {
            if (y < 0.085 + RAD && rho < 0.32) { P[o + 1] = 0.085 + RAD; surf = 4; nx = 0; ny = 1; nz = 0; mu = 0.25; }
            if (rho > rin - RAD && rho > 1e-4) {
              var kk = (rin - RAD) / rho;
              P[o] = bowl.x + bx * kk; P[o + 2] = bowl.z + bz * kk;
              // 少し持ち上げる（斜面）
              P[o + 1] += (rho - (rin - RAD)) * 0.5;
              surf = 4; nx = -bx / rho; ny = 0.5; nz = -bz / rho; mu = 0.2;
            }
          } else if (rho < rin + 0.08 && y < 0.74) {
            var ko = (rin + 0.08 + RAD) / rho;
            P[o] = bowl.x + bx * ko; P[o + 2] = bowl.z + bz * ko;
            surf = 4; nx = bx / rho; ny = 0; nz = bz / rho; mu = 0.3;
          }
          // 縁の輪
          var rrim = 0.92;
          var ex = rho - rrim, ey = y - 0.725;
          var ed = Math.sqrt(ex * ex + ey * ey);
          if (ed < 0.03 + RAD && ed > 1e-5 && rho > 1e-4) {
            var kr = (0.03 + RAD) / ed;
            var nr = rrim + ex * kr;
            P[o] = bowl.x + bx / rho * nr; P[o + 2] = bowl.z + bz / rho * nr; P[o + 1] = 0.725 + ey * kr;
            surf = 4; nx = bx / rho * ex / ed; ny = ey / ed; nz = bz / rho * ex / ed; mu = 0.3;
          }
        }
        // 食卓
        if (P[o + 1] < RAD) { P[o + 1] = RAD; surf = 5; nx = 0; ny = 1; nz = 0; mu = 0.6; }
        this.csurf[i] = surf;
        if (final && surf) {
          // 摩擦（押し戻しの量に比例する止まり）＋ 少しの粘り
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          var pushL = Math.max(0, (P[o] - bef[o]) * nx + (P[o + 1] - bef[o + 1]) * ny + (P[o + 2] - bef[o + 2]) * nz);
          var vx = P[o] - Pv[o] - svx, vy = P[o + 1] - Pv[o + 1] - svy, vz = P[o + 2] - Pv[o + 2] - svz;
          var vn = vx * nx + vy * ny + vz * nz;
          var tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
          var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
          var cut = Math.min(tl, mu * pushL + (0.004 + 0.03 * (1 - this.imm[i])) * tl);
          var kf = tl > 1e-9 ? (tl - cut) / tl : 0;
          tx *= kf; ty *= kf; tz *= kf;
          if (vn < 0) vn = 0;
          Pv[o] = P[o] - (tx + nx * vn) - svx;
          Pv[o + 1] = P[o + 1] - (ty + ny * vn) - svy;
          Pv[o + 2] = P[o + 2] - (tz + nz * vn) - svz;
          this.cn[o] = nx; this.cn[o + 1] = ny; this.cn[o + 2] = nz;
        }
      }
    }
  };

  // ---- 麺どうし ----
  Noodles.prototype._selfCollide = function (active) {
    var P = this.pos, inv = this.inv, Pv = this.prev, imm = this.imm;
    var cnt = this.hashCount, start = this.hashStart, list = this.hashList, key = this.hashKey, col = this.collidable;
    var n = 0;
    for (var bi = 0; bi < this.bundles.length; bi++) {
      var b = this.bundles[bi];
      if (b.state === 'zaru' || b.state === 'returning' || b.state === 'baked') continue;
      for (var i = b.start; i < b.start + b.n; i++) col[n++] = i;
    }
    this.nCollidable = n;
    cnt.fill(0);
    for (var k = 0; k < n; k++) {
      var p = col[k] * 3;
      var hk = hkey(Math.floor(P[p] / HS), Math.floor(P[p + 1] / HS), Math.floor(P[p + 2] / HS));
      key[k] = hk; cnt[hk]++;
    }
    var acc = 0;
    for (var t = 0; t < HT; t++) { start[t] = acc; acc += cnt[t]; }
    start[HT] = acc;
    for (var k2 = 0; k2 < n; k2++) { list[start[key[k2]]++] = col[k2]; }
    for (var t2 = HT; t2 > 0; t2--) start[t2] = start[t2 - 1];
    start[0] = 0;
    var m = 2 * RAD, m2 = m * m;
    var strandOf = this.strandOf, owner = this.owner;
    var self = this;
    for (var a = 0; a < active.length; a++) {
      var ab = active[a];
      for (var i2 = ab.start; i2 < ab.start + ab.n; i2++) {
        var o = i2 * 3;
        var cx = Math.floor(P[o] / HS), cy = Math.floor(P[o + 1] / HS), cz = Math.floor(P[o + 2] / HS);
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
          var hh = hkey(cx + dx, cy + dy, cz + dz);
          for (var q = start[hh]; q < start[hh + 1]; q++) {
            var j = list[q];
            if (j === i2) continue;
            var jActive = inv[j] > 0 && this.act[j] === 1;
            if (jActive && j < i2) continue;
            if (strandOf[j] === strandOf[i2] && Math.abs(j - i2) <= 2) continue;
            var oj = j * 3;
            var ex = P[o] - P[oj], ey = P[o + 1] - P[oj + 1], ez = P[o + 2] - P[oj + 2];
            var d2 = ex * ex + ey * ey + ez * ez;
            if (d2 >= m2 || d2 < 1e-12) continue;
            var d = Math.sqrt(d2);
            var wi = inv[i2], wj = jActive ? inv[j] : 0;
            var w = wi + wj;
            if (w === 0) continue;
            var c = (m - d) / d / w;
            P[o] += ex * c * wi; P[o + 1] += ey * c * wi; P[o + 2] += ez * c * wi;
            P[oj] -= ex * c * wj; P[oj + 1] -= ey * c * wj; P[oj + 2] -= ez * c * wj;
            // 麺どうしの摩擦（重なった束が崩れすぎない）
            var nx = ex / d, ny = ey / d, nz = ez / d;
            var rvx = (P[o] - Pv[o]) - (jActive ? P[oj] - Pv[oj] : 0);
            var rvy = (P[o + 1] - Pv[o + 1]) - (jActive ? P[oj + 1] - Pv[oj + 1] : 0);
            var rvz = (P[o + 2] - Pv[o + 2]) - (jActive ? P[oj + 2] - Pv[oj + 2] : 0);
            var rn = rvx * nx + rvy * ny + rvz * nz;
            var tx = rvx - nx * rn, ty = rvy - ny * rn, tz = rvz - nz * rn;
            var fk = 0.22 * (1 - 0.5 * Math.max(imm[i2], jActive ? imm[j] : 0));
            Pv[o] += tx * fk * wi / w; Pv[o + 1] += ty * fk * wi / w; Pv[o + 2] += tz * fk * wi / w;
            if (wj > 0) { Pv[oj] -= tx * fk * wj / w; Pv[oj + 1] -= ty * fk * wj / w; Pv[oj + 2] -= tz * fk * wj / w; }
            if (!jActive && owner[j] !== owner[i2]) self._wakeOwner(owner[j], d < m * 0.6);
          }
        }
      }
    }
  };
  function hkey(x, y, z) { return (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % HT; }

  Noodles.prototype._isActiveIdx = function (j) {
    var b = this._byId(this.owner[j]);
    return b && (b.state === 'active' || b.state === 'held');
  };
  Noodles.prototype._byId = function (id) {
    if (this._lastB && this._lastB.id === id) return this._lastB;
    for (var i = 0; i < this.bundles.length; i++) if (this.bundles[i].id === id) { this._lastB = this.bundles[i]; return this._lastB; }
    return null;
  };
  Noodles.prototype._wakeOwner = function (id, hard) {
    var b = this._byId(id);
    if (b && b.state === 'sleep' && hard) { b.state = 'active'; b.sleepT = 0; }
  };

  // ---- 束の様子 ----
  Noodles.prototype._stats = function (active, dt) {
    var P = this.pos, Pv = this.prev;
    var c = this.course, st = c.st, d = c.d;
    var offs = [-(K.SPOUT_L - st.iS), 0, K.LS - d.iC, K.LS - d.iC + K.LC - st.iE];
    var pathIdx = {};
    var tr = c.troughs;
    var names = ['spout', 'S', 'C', 'E'];
    var paths = this.paths;
    var map = [];
    for (var p = 0; p < paths.length; p++) {
      var nm = paths[p] === c.spoutPath ? 0 : paths[p] === tr.S.path ? 1 : paths[p] === tr.C.path ? 2 : 3;
      map.push(nm);
    }
    var bowl = c.bowlPos;
    var net = this.net;
    for (var a = 0; a < active.length; a++) {
      var b = active[a];
      if (b.state !== 'active') continue;
      var sumD = 0;
      var md = 0, inTr = 0, inBowl = 0, inNet = 0, inBasin = 0, lead = -9, leadI = -1;
      var plop = false, plopP = null, bplop = false;
      for (var i = b.start; i < b.start + b.n; i++) {
        var o = i * 3;
        var dx = P[o] - Pv[o], dy = P[o + 1] - Pv[o + 1], dz = P[o + 2] - Pv[o + 2];
        var dd = dx * dx + dy * dy + dz * dz;
        if (dd > md) md = dd;
        sumD += Math.sqrt(dd);
        var w = this.wtr[i];
        if (w >= 0) {
          inTr++;
          var gs = offs[map[w]] + this.ws[i];
          if (gs > lead) { lead = gs; leadI = i; }
        }
        var bx = P[o] - bowl.x, bz = P[o + 2] - bowl.z;
        if (bx * bx + bz * bz < 0.9 * 0.9 && P[o + 1] < 0.75) {
          inBowl++;
          if (Pv[o + 1] > this.tsuyuY && P[o + 1] <= this.tsuyuY) { plop = true; plopP = o; }
        }
        if (this.csurf[i] === 2) inNet++;
        if (this.inMed[i] === 2) { inBasin++; if (Pv[o + 1] > this.water.basinLevel && P[o + 1] <= this.water.basinLevel && Math.abs(dy) > 0.004) { bplop = true; plopP = o; } }
      }
      b.maxDisp = Math.sqrt(md);
      b.avgDisp = sumD / b.n;
      this.loosenLinks(b, dt * K.TS);
      b.inTr = inTr; b.inBowl = inBowl; b.inNet = inNet; b.inBasin = inBasin;
      b.leadS = lead;
      if (leadI >= 0) b.lead.set(P[leadI * 3], P[leadI * 3 + 1], P[leadI * 3 + 2]);
      if (inNet > 8 && !b.everNet) { b.everNet = true; SG.events.emit('netCatch', b, net.c); }
      b.plopT -= dt;
      if (plop && b.plopT <= 0) {
        b.plopT = 0.14;
        SG.events.emit('tsuyuPlop', new T.Vector3(P[plopP], this.tsuyuY, P[plopP + 2]), this.bowlCount);
      } else if (bplop && b.plopT <= 0) {
        b.plopT = 0.2;
        SG.events.emit('basinPlop', new T.Vector3(P[plopP], this.water.basinLevel, P[plopP + 2]));
      }
      // 器で静まる → 固まる
      if (inBowl >= b.n * 0.85 && b.avgDisp < 0.0005 && inNet < 3) {
        b.frozenT += dt;
        if (b.frozenT > 1.0) {
          b.state = 'frozen';
          this.bowlCount++;
          for (var k = b.start; k < b.start + b.n; k++) { Pv[k * 3] = P[k * 3]; Pv[k * 3 + 1] = P[k * 3 + 1]; Pv[k * 3 + 2] = P[k * 3 + 2]; }
          b.mesh.update();
          SG.events.emit('bowlSettle', b);
        }
      } else b.frozenT = 0;
      // 水受けなどで静まる → 眠る
      var netNear = net.c.distanceTo(this.bundleCenter(b, SG.tmpV[5])) < 1.1;
      var calm = (b.avgDisp < 0.0004 && b.maxDisp < 0.004) || (inBasin > b.n * 0.4 && b.avgDisp < 0.0016) || (this.time - b.placedAt > 30 && b.avgDisp < 0.004);
      if (inTr === 0 && inNet < 2 && inBowl < b.n * 0.5 && calm && !netNear) {
        b.sleepT += dt;
        if (b.sleepT > 1.6) { b.state = 'sleep'; b.sleepT = 0; }
      } else b.sleepT = 0;
    }
    // 眠っている束：網が近づいたら起こす
    for (var s = 0; s < this.bundles.length; s++) {
      var sb = this.bundles[s];
      if (sb.state !== 'sleep') continue;
      var cc = this.bundleCenter(sb, SG.tmpV[5]);
      var dn = net.c.distanceTo(cc);
      if (dn < 1.0 && (net.held || net.vel.lengthSq() > 0.01)) { sb.state = 'active'; sb.sleepT = 0; }
    }
  };

  // 粒を食う古い束を、見た目だけ残して手放す
  Noodles.prototype.bakeOldest = function () {
    for (var pass = 0; pass < 2; pass++) for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state === 'frozen' || (pass === 1 && b.state === 'sleep')) {
        b.state = 'baked';
        this.release(b.start, b.n);
        b.start = -1;
        return true;
      }
    }
    return false;
  };

  Noodles.prototype.bakeOldestSleep = function () {
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state === 'sleep') { b.state = 'baked'; this.release(b.start, b.n); b.start = -1; return true; }
    }
    return false;
  };

  // まとめて調べる
  Noodles.prototype.summary = function () {
    var s = { flowing: 0, inNet: 0, basinRest: 0, held: null, lead: null, zaru: 0, active: 0, airborne: 0 };
    for (var i = 0; i < this.bundles.length; i++) {
      var b = this.bundles[i];
      if (b.state === 'zaru') s.zaru++;
      if (b.state === 'held') s.held = b;
      if (b.state === 'active') {
        s.active++;
        if (b.inTr > 0) { s.flowing++; if (!s.lead || b.leadS > s.lead.leadS) s.lead = b; }
        if (b.inNet > 10) s.inNet++;
        if (b.inTr === 0 && b.inNet < 5 && b.inBowl < b.n * 0.5) s.airborne++;
      }
      if (b.state === 'sleep') s.basinRest++;
    }
    return s;
  };

  // ---- 描く：束ごとに細い管 ----
  var RS = 5;
  function NoodleMesh(nd, b) {
    this.nd = nd; this.b = b;
    var rings = 0;
    b.strands.forEach(function (s) { rings += (s.n - 1) * 2 + 1; });
    this.rings = rings;
    var nv = rings * RS;
    this.posA = new Float32Array(nv * 3);
    this.norA = new Float32Array(nv * 3);
    var idx = [];
    var base = 0;
    var self = this;
    b.strands.forEach(function (s) {
      var m = (s.n - 1) * 2 + 1;
      for (var r = 0; r < m - 1; r++) {
        for (var k = 0; k < RS; k++) {
          var a = base + r * RS + k, bb = base + r * RS + (k + 1) % RS;
          var c = a + RS, d = bb + RS;
          idx.push(a, bb, c, bb, d, c);
        }
      }
      base += m * RS;
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.posA, 3));
    g.setAttribute('normal', new T.BufferAttribute(this.norA, 3));
    g.setIndex(idx);
    this.geom = g;
    this.mesh = new T.Mesh(g, nd.M.noodle);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pts = new Float32Array(80 * 3);
  }
  NoodleMesh.prototype.update = function () {
    var b = this.b, P = this.nd.pos;
    if (b.start < 0) return;
    var pa = this.posA, na = this.norA, pts = this.pts;
    var vi = 0;
    var rad = K.NOODLE_DRAW_R;
    for (var s = 0; s < b.strands.length; s++) {
      var st = b.strands[s];
      var n = st.n, m = (n - 1) * 2 + 1;
      // 4点で中点を補う
      for (var j = 0; j < n; j++) {
        var o = (st.start + j) * 3;
        pts[j * 6] = P[o]; pts[j * 6 + 1] = P[o + 1]; pts[j * 6 + 2] = P[o + 2];
      }
      for (var j2 = 0; j2 < n - 1; j2++) {
        var i0 = Math.max(0, j2 - 1), i1 = j2, i2 = j2 + 1, i3 = Math.min(n - 1, j2 + 2);
        for (var c = 0; c < 3; c++) {
          pts[j2 * 6 + 3 + c] = (-pts[i0 * 6 + c] + 9 * pts[i1 * 6 + c] + 9 * pts[i2 * 6 + c] - pts[i3 * 6 + c]) / 16;
        }
      }
      // 平行に運ぶ枠
      var px = 0, py = 1, pz = 0;
      for (var r = 0; r < m; r++) {
        var a = Math.max(0, r - 1), bb = Math.min(m - 1, r + 1);
        var tx = pts[bb * 3] - pts[a * 3], ty = pts[bb * 3 + 1] - pts[a * 3 + 1], tz = pts[bb * 3 + 2] - pts[a * 3 + 2];
        var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        if (r === 0) {
          if (Math.abs(ty) > 0.9) { px = 1; py = 0; pz = 0; } else { px = 0; py = 1; pz = 0; }
        }
        var dp = px * tx + py * ty + pz * tz;
        px -= tx * dp; py -= ty * dp; pz -= tz * dp;
        var pl = Math.sqrt(px * px + py * py + pz * pz);
        if (pl < 1e-4) { px = -tz; py = 0; pz = tx; pl = Math.sqrt(px * px + pz * pz) || 1; }
        px /= pl; py /= pl; pz /= pl;
        var qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px;
        var taper = 1;
        if (r < 2) taper = 0.7 + 0.15 * r;
        if (r > m - 3) taper = 0.7 + 0.15 * (m - 1 - r);
        var rr = rad * taper;
        var cx = pts[r * 3], cy = pts[r * 3 + 1], cz = pts[r * 3 + 2];
        for (var k = 0; k < RS; k++) {
          var ang = k * Math.PI * 2 / RS;
          var ca = Math.cos(ang), sa = Math.sin(ang);
          var nx = px * ca + qx * sa, ny = py * ca + qy * sa, nz = pz * ca + qz * sa;
          pa[vi] = cx + nx * rr; pa[vi + 1] = cy + ny * rr; pa[vi + 2] = cz + nz * rr;
          na[vi] = nx; na[vi + 1] = ny; na[vi + 2] = nz;
          vi += 3;
        }
      }
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.normal.needsUpdate = true;
  };

  SG.Noodles = Noodles;
})();
