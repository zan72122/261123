/* waterfx.js — 水の見た目：樋の水面、受け皿の水、落ちる水柱、しずく、泡、残った水玉、波紋 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  var _a = new T.Vector3(), _T = new T.Vector3(), _N = new T.Vector3(), _B = new T.Vector3();

  // ---- 樋の水面 ----
  var CROSS = [-1, -0.6, -0.2, 0.2, 0.6, 1];
  function TroughWater(ch, mat, scene) {
    this.ch = ch;
    var nr = ch.n + 1, nc = CROSS.length;
    this.nr = nr; this.nc = nc;
    this.pos = new Float32Array(nr * nc * 3);
    this.uv = new Float32Array(nr * nc * 2);
    var idx = [];
    for (var r = 0; r < nr - 1; r++) for (var c = 0; c < nc - 1; c++) {
      var a = r * nc + c, b = a + 1, d = a + nc, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(this.uv, 2));
    g.setIndex(idx);
    this.geom = g;
    this.mesh = new T.Mesh(g, mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.phase = new Float32Array(nr);
    this.flow = 0;
  }
  TroughWater.prototype.update = function (dt, t) {
    var ch = this.ch, path = ch.path;
    if (!ch.enabled) { this.mesh.visible = false; return; }
    var any = false;
    for (var i = 0; i < ch.n; i++) if (ch.h[i] > 0.0015) { any = true; break; }
    this.mesh.visible = any;
    if (!any) return;
    var nr = this.nr, nc = this.nc, P = this.pos, U = this.uv;
    var R = K.R;
    var vavg = 0, cnt = 0;
    for (var r = 0; r < nr; r++) {
      var s = SG.clamp(r * ch.dx, 0, path.L);
      var hi = Math.min(ch.n - 1, r), lo = Math.max(0, r - 1);
      var h = 0.5 * (ch.h[lo] + ch.h[hi]);
      if (r === 0) h = ch.h[0] * 0.8;
      if (r === nr - 1) h = ch.h[ch.n - 1];
      var v = 0.5 * (ch.vq[lo] + ch.vq[hi]);
      if (h > 0.002) { vavg += v; cnt++; }
      this.phase[r] += v * dt * 9;
      path.axis(s, _a); path.frame(s, _T, _N, _B);
      var hw = SG.surfWidth(R, h) * 0.5 * 0.985;
      var wob = h > 0.004 ? Math.sin(s * 23 - this.phase[r]) * 0.0025 * SG.clamp(v, 0, 2) : 0;
      var ww = -R + h + 0.002 + wob;
      for (var c = 0; c < nc; c++) {
        var u = CROSS[c] * hw;
        var o = (r * nc + c) * 3;
        var cw = ww - (1 - CROSS[c] * CROSS[c]) * 0.0015;
        P[o] = _a.x + _N.x * u + _B.x * cw;
        P[o + 1] = _a.y + _N.y * u + _B.y * cw;
        P[o + 2] = _a.z + _N.z * u + _B.z * cw;
        var uo = (r * nc + c) * 2;
        U[uo] = CROSS[c] * 0.4;
        U[uo + 1] = s * 1.2 - this.flow;
      }
    }
    if (cnt) this.flow += (vavg / cnt) * dt * 1.2;
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.uv.needsUpdate = true;
    this.geom.computeVertexNormals();
  };

  // ---- 落ちる水（水柱・水膜） ----
  var SIDES = 8;
  function Stream(scene, mat, maxN) {
    this.max = maxN || 70;
    this.parts = [];
    var nv = this.max * SIDES;
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(this.nor, 3));
    g.setIndex([]);
    this.geom = g;
    this.mesh = new T.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.seq = 0;
    this.lastEmit = false;
  }
  // a: 横の半幅、b: 厚みの半分、side: 横の向き
  Stream.prototype.emit = function (p, v, a, b, side) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({ p: p.clone(), v: v.clone(), a: a, b: b, sx: side ? side.x : 1, sz: side ? side.z : 0, seq: this.seq, alive: true, age: 0 });
    this.seq++;
    this.lastEmit = true;
  };
  Stream.prototype.gap = function () { if (this.lastEmit) { this.seq += 2; this.lastEmit = false; } };
  // hit(p) → true なら消える
  Stream.prototype.update = function (dt, hit, onHit) {
    var G = K.G;
    for (var i = 0; i < this.parts.length; i++) {
      var q = this.parts[i];
      if (!q.alive) continue;
      q.v.y -= G * dt;
      q.p.addScaledVector(q.v, dt);
      q.age += dt;
      var hr = hit(q);
      if (hr) { q.alive = false; if (onHit) onHit(q, hr); }
      if (q.age > 3) q.alive = false;
    }
    while (this.parts.length && !this.parts[0].alive) this.parts.shift();
    this._build();
  };
  Stream.prototype._build = function () {
    var P = this.pos, N = this.nor, idx = [];
    var ps = this.parts;
    var n = Math.min(ps.length, this.max);
    for (var i = 0; i < n; i++) {
      var q = ps[i];
      var prev = ps[Math.max(0, i - 1)], next = ps[Math.min(n - 1, i + 1)];
      var tx = next.p.x - prev.p.x, ty = next.p.y - prev.p.y, tz = next.p.z - prev.p.z;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // 横の向き：水平な side を接線に直交させる
      var sx = q.sx, sy = 0, sz = q.sz;
      var d = sx * tx + sy * ty + sz * tz;
      sx -= tx * d; sy -= ty * d; sz -= tz * d;
      var sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      var bx = ty * sz - tz * sy, by = tz * sx - tx * sz, bz = tx * sy - ty * sx;
      var shrink = q.alive ? 1 : 0;
      var aa = q.a * shrink, bb = q.b * shrink;
      for (var k = 0; k < SIDES; k++) {
        var ang = k / SIDES * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        var o = (i * SIDES + k) * 3;
        P[o] = q.p.x + sx * ca * aa + bx * sa * bb;
        P[o + 1] = q.p.y + sy * ca * aa + by * sa * bb;
        P[o + 2] = q.p.z + sz * ca * aa + bz * sa * bb;
        var nx = sx * ca * bb + bx * sa * aa, ny = sy * ca * bb + by * sa * aa, nz = sz * ca * bb + bz * sa * aa;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        N[o] = nx / nl; N[o + 1] = ny / nl; N[o + 2] = nz / nl;
      }
      if (i < n - 1 && ps[i + 1].seq === q.seq + 1 && q.alive && ps[i + 1].alive) {
        for (var k2 = 0; k2 < SIDES; k2++) {
          var a0 = i * SIDES + k2, a1 = i * SIDES + (k2 + 1) % SIDES;
          var b0 = a0 + SIDES, b1 = a1 + SIDES;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
    }
    this.geom.setIndex(idx);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.normal.needsUpdate = true;
    this.mesh.visible = idx.length > 0;
  };

  // ---- 波紋の面 ----
  function Ripple(scene, mat, opt) {
    this.opt = opt;
    var nx = opt.nx, nz = opt.nz;
    this.nx = nx; this.nz = nz;
    this.h = new Float32Array(nx * nz);
    this.h0 = new Float32Array(nx * nz);
    this.mask = new Uint8Array(nx * nz);
    this.x0 = opt.x0; this.z0 = opt.z0; this.w = opt.w; this.d = opt.d;
    this.dx = opt.w / (nx - 1); this.dz = opt.d / (nz - 1);
    var g = new T.PlaneGeometry(opt.w, opt.d, nx - 1, nz - 1);
    g.rotateX(-Math.PI / 2);
    this.geom = g;
    this.base = new Float32Array(g.getAttribute('position').array);
    this.mesh = new T.Mesh(g, mat);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.acc = 0;
    this.level = 0;
    this.energy = 0;
  }
  Ripple.prototype.setShape = function (inside, project) { this.inside = inside; this.project = project; };
  Ripple.prototype.impulse = function (x, z, amp, rad) {
    rad = rad || 0.12;
    var ci = (x - this.x0) / this.dx, cj = (z - this.z0) / this.dz;
    var ri = Math.ceil(rad / this.dx) + 1;
    for (var j = Math.max(1, Math.floor(cj) - ri); j <= Math.min(this.nz - 2, Math.floor(cj) + ri); j++) {
      for (var i = Math.max(1, Math.floor(ci) - ri); i <= Math.min(this.nx - 2, Math.floor(ci) + ri); i++) {
        var px = this.x0 + i * this.dx, pz = this.z0 + j * this.dz;
        var r = Math.sqrt((px - x) * (px - x) + (pz - z) * (pz - z));
        if (r < rad) this.h[j * this.nx + i] -= amp * (0.5 + 0.5 * Math.cos(Math.PI * r / rad));
      }
    }
    this.energy = 1;
  };
  Ripple.prototype.step = function (dt, level, c, damp) {
    this.level = level;
    this.acc += dt;
    var nx = this.nx, nz = this.nz, h = this.h, h0 = this.h0;
    var step = 1 / 60;
    var k = (c * step / this.dx) * (c * step / this.dx);
    if (k > 0.45) k = 0.45;
    var guard = 0;
    while (this.acc >= step && guard++ < 3) {
      this.acc -= step;
      for (var j = 1; j < nz - 1; j++) {
        for (var i = 1; i < nx - 1; i++) {
          var o = j * nx + i;
          var hc = h[o];
          var l = this.mask[o - 1] ? h[o - 1] : hc, r = this.mask[o + 1] ? h[o + 1] : hc;
          var u = this.mask[o - nx] ? h[o - nx] : hc, d = this.mask[o + nx] ? h[o + nx] : hc;
          var nv = (2 * hc - h0[o] + k * (l + r + u + d - 4 * hc)) * damp;
          h0[o] = nv;
        }
      }
      var t = this.h; this.h = this.h0; this.h0 = t; h = this.h; h0 = this.h0;
      this.energy *= 0.995;
    }
  };
  Ripple.prototype.build = function () {
    var pa = this.geom.getAttribute('position'), A = pa.array, base = this.base;
    var nx = this.nx, nz = this.nz;
    var cx = this.x0 + this.w / 2, cz = this.z0 + this.d / 2;
    var q = { x: 0, z: 0 };
    var reshape = this.lastLevel === undefined || Math.abs(this.level - this.lastLevel) > 0.003;
    if (reshape) this.lastLevel = this.level;
    for (var j = 0; j < nz; j++) {
      for (var i = 0; i < nx; i++) {
        var o = j * nx + i;
        if (reshape) {
          var x = base[o * 3] + cx, z = base[o * 3 + 2] + cz;
          q.x = x; q.z = z;
          var inside = this.inside(x, z, this.level);
          this.mask[o] = inside ? 1 : 0;
          if (!inside) this.project(q, this.level);
          A[o * 3] = q.x; A[o * 3 + 2] = q.z;
        }
        A[o * 3 + 1] = this.level + (this.mask[o] ? this.h[o] : 0);
      }
    }
    pa.needsUpdate = true;
    this.geom.computeVertexNormals();
  };

  // ---- 全体 ----
  function WaterFX(world) {
    this.world = world;
    var M = world.mats, scene = world.scene;
    this.scene = scene;
    var W = world.water, c = world.course;
    this.tw = [];
    for (var i = 0; i < W.order.length; i++) this.tw.push(new TroughWater(W.ch[W.order[i]], M.waterSurf, scene));
    this.pour = new Stream(scene, M.water, 70);
    this.endS = new Stream(scene, M.water, 60);
    this.below = new Stream(scene, M.water, 40);
    this.sheets = { spout: new Stream(scene, M.water, 20), S: new Stream(scene, M.water, 20), C: new Stream(scene, M.water, 24) };
    // しずく
    this.dropMax = 260;
    this.drops = [];
    this.dropMesh = new T.InstancedMesh(new T.SphereGeometry(1, 8, 6), M.drop, this.dropMax);
    this.dropMesh.frustumCulled = false;
    this.dropMesh.renderOrder = 4;
    scene.add(this.dropMesh);
    // 泡
    this.bubMax = 90;
    this.bubs = [];
    this.bubMesh = new T.InstancedMesh(new T.SphereGeometry(1, 8, 6), M.bubble, this.bubMax);
    this.bubMesh.frustumCulled = false;
    this.bubMesh.renderOrder = 3;
    scene.add(this.bubMesh);
    this.bubT = 0;
    // 残った水玉
    this.beadMax = 40;
    this.beads = [];
    this.beadMesh = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), M.drop, this.beadMax);
    this.beadMesh.frustumCulled = false;
    this.beadMesh.renderOrder = 3;
    scene.add(this.beadMesh);
    this.wet = {};
    for (var w = 0; w < W.order.length; w++) this.wet[W.order[w]] = new Uint8Array(W.ch[W.order[w]].n);
    // 波紋：水受け
    var B = c.basin;
    var bw = 2 * (B.hx + B.flare) + 0.1, bd = 2 * (B.hz + B.flare) + 0.1;
    this.basinR = new Ripple(scene, M.waterSurf, { nx: 40, nz: 58, x0: B.cx - bw / 2, z0: B.cz - bd / 2, w: bw, d: bd });
    var self = this;
    this.basinR.setShape(function (x, z, lvl) {
      var sw = B.flare * SG.clamp((lvl - B.floor) / (B.H - B.floor), 0, 1) - 0.01;
      return SG.sdRoundRect(x, z, B.cx, B.cz, B.hx, B.hz, B.rc) < sw;
    }, function (q, lvl) {
      var sw = B.flare * SG.clamp((lvl - B.floor) / (B.H - B.floor), 0, 1) - 0.012;
      for (var it = 0; it < 3; it++) {
        var sd = SG.sdRoundRect(q.x, q.z, B.cx, B.cz, B.hx, B.hz, B.rc) - sw;
        if (sd <= 0) break;
        var g = SG.sdRoundRectGrad(q.x, q.z, B.cx, B.cz, B.hx, B.hz, B.rc, { x: 0, z: 0 });
        q.x -= g.x * sd; q.z -= g.z * sd;
      }
    });
    // 波紋：つゆ
    var bp = c.bowlPos;
    this.bowlR = new Ripple(scene, M.tsuyu, { nx: 26, nz: 26, x0: bp.x - 0.95, z0: bp.z - 0.95, w: 1.9, d: 1.9 });
    this.bowlR.setShape(function (x, z, lvl) {
      var r = SG.bowlInnerR(lvl) - 0.008;
      var dx = x - bp.x, dz = z - bp.z;
      return dx * dx + dz * dz < r * r;
    }, function (q, lvl) {
      var r = SG.bowlInnerR(lvl) - 0.01;
      var dx = q.x - bp.x, dz = q.z - bp.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
      q.x = bp.x + dx / l * r; q.z = bp.z + dz / l * r;
    });
    this.tsuyuLevel = 0.42;
    this._m = new T.Matrix4();
    this._q = new T.Quaternion();
    this.time = 0;
    this.trayWater = c.tray.water;
    // 出来事
    SG.events.on('netDrip', function (p, size, hAbove) { self.spawnDrop(p, new T.Vector3(0, -0.2, 0), size * 0.45, 'drip', hAbove); });
    SG.events.on('tsuyuPlop', function (p) { self.bowlR.impulse(p.x, p.z, 0.012, 0.16); self.splash(p, 3, 0.8); });
    SG.events.on('basinPlop', function (p) { self.basinR.impulse(p.x, p.z, 0.008, 0.15); });
    SG.events.on('noodlePress', function (p) { for (var k = 0; k < 5; k++) self.spawnDrop(p.clone().add(new T.Vector3(SG.rr(-0.1, 0.1), 0.02, SG.rr(-0.1, 0.1))), new T.Vector3(SG.rr(-0.6, 0.6), SG.rr(1.0, 2.2), SG.rr(-0.6, 0.6)), SG.rr(0.008, 0.016), 'squeeze'); });
  }

  WaterFX.prototype.spawnDrop = function (p, v, r, kind, h0) {
    if (this.drops.length >= this.dropMax) this.drops.shift();
    this.drops.push({ p: p.clone(), v: v.clone(), r: r, kind: kind || 'splash', y0: p.y, alive: true });
  };
  WaterFX.prototype.splash = function (p, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = SG.rr(0, Math.PI * 2), s = SG.rr(0.3, 1) * spd;
      this.spawnDrop(new T.Vector3(p.x, p.y + 0.01, p.z), new T.Vector3(Math.cos(a) * s, SG.rr(0.8, 1.8) * spd, Math.sin(a) * s), SG.rr(0.006, 0.014), 'splash');
    }
  };

  // 落ちる物が何に当たるか
  WaterFX.prototype._hitScene = function (p, net, passNet) {
    var c = this.world.course, W = this.world.water, B = c.basin, bp = c.bowlPos;
    var sd = SG.sdRoundRect(p.x, p.z, B.cx, B.cz, B.hx, B.hz, B.rc);
    if (sd < 0.02) {
      var lvl = W.basinLevel;
      if (p.y < Math.max(lvl, B.liner + 0.005)) return { kind: lvl > B.liner + 0.004 ? 'basin' : 'liner', y: Math.max(lvl, B.liner) };
    }
    var dx = p.x - bp.x, dz = p.z - bp.z;
    if (dx * dx + dz * dz < 0.88 * 0.88 && p.y < this.tsuyuLevel) return { kind: 'tsuyu', y: this.tsuyuLevel };
    if (p.y < 0.005) return { kind: 'table', y: 0 };
    if (net && !passNet) {
      var l = net.toLocal(p.x, p.y, p.z, SG.tmpV[0]);
      var rho = Math.sqrt(l.x * l.x + l.z * l.z);
      if (rho < net.rn) {
        var ys = -net.dn * (1 - (rho / net.rn) * (rho / net.rn));
        if (l.y < ys && l.y > ys - 0.08) return { kind: 'net', y: p.y };
      }
    }
    return null;
  };

  WaterFX.prototype.update = function (dt) {
    var dts = dt * K.TS;
    this.time += dt;
    var world = this.world, W = world.water, c = world.course, net = world.net;
    var self = this;
    for (var i = 0; i < this.tw.length; i++) this.tw[i].update(dt, this.time);
    // 受け皿の水
    var tr = this.trayWater;
    var lvl = W.trayLevel(), pr = W.trayPuddleR();
    tr.visible = W.trayV > 0.0005;
    tr.scale.set(Math.max(0.01, pr), Math.max(0.002, lvl), Math.max(0.01, pr));
    // 水差しの水柱
    var pit = world.pitcher;
    if (pit && pit.pourQ > 0.004) {
      var sp = pit.spoutWorld, sv = pit.spoutVel;
      var rr = Math.sqrt(pit.pourQ / (Math.PI * 4.5)) * 0.85 + 0.004;
      this.pour.emit(sp, sv, rr, rr, new T.Vector3(sv.z, 0, -sv.x).normalize());
    } else if (pit && pit.lastDrop) {
      pit.lastDrop = false;
      this.spawnDrop(pit.spoutWorld, pit.spoutVel.clone().multiplyScalar(0.3), 0.018, 'last', 0);
      this.pour.gap();
    } else this.pour.gap();
    var trayY = c.d.yT;
    this.pour.update(dts, function (q) {
      var dx = q.p.x - c.TX, dz = q.p.z - c.TZ;
      if (dx * dx + dz * dz < K.TRAY_R * K.TRAY_R && q.p.y < trayY + Math.max(lvl, 0.004)) return { kind: 'tray' };
      return self._hitScene(q.p, null, true);
    }, function (q, hr) {
      if (SG.rand() < 0.35) self.splash(q.p, 1, 0.6);
    });
    // つなぎ目の段差から落ちる水膜
    var links = W._links();
    var names = ['spout', 'S', 'C'];
    for (var n = 0; n < names.length; n++) {
      var nm = names[n], st = this.sheets[nm];
      var jn = W.joint[nm];
      var lk = null;
      for (var l = 0; l < links.length; l++) if (links[l].up === nm) lk = links[l];
      var ch = W.ch[nm];
      if (lk && jn.gap > 0.015 && jn.q > 0.002 && ch.enabled) {
        var path = ch.path;
        var hE = ch.h[ch.n - 1];
        path.axis(path.L, _a); path.frame(path.L, _T, _N, _B);
        var p = _a.clone().addScaledVector(_B, -K.R + hE * 0.5 + K.LIPT);
        var v = _T.clone().multiplyScalar(Math.max(0.3, ch.v[ch.n - 1]));
        st.emit(p, v, SG.surfWidth(K.R, hE) * 0.42, Math.max(0.004, hE * 0.25), _N);
      } else st.gap();
      var down = lk ? W.ch[lk.down] : null;
      st.update(dts, function (q) {
        if (!down) return self._hitScene(q.p, null, true);
        var loc = {};
        down.path.locate(q.p.x, q.p.y, q.p.z, loc);
        var sh = {};
        down.sample(loc.s, sh);
        if (loc.w < -K.R + sh.h + 0.004) return { kind: 'trough' };
        return self._hitScene(q.p, null, true);
      }, function (q, hr) { if (hr.kind === 'trough' && SG.rand() < 0.25) self.splash(q.p, 1, 0.4); });
    }
    // 末端から水受けへ
    var E = W.ch.E;
    var endQ = W.endQs;
    if (E.enabled && W.endQ > 0.0015) {
      var hE2 = E.h[E.n - 1];
      E.path.axis(E.path.L, _a); E.path.frame(E.path.L, _T, _N, _B);
      var p2 = _a.clone().addScaledVector(_B, -K.R + hE2 * 0.5 + K.LIPT);
      var v2 = _T.clone().multiplyScalar(Math.max(0.3, W.endV));
      this.endS.emit(p2, v2, SG.surfWidth(K.R, hE2) * 0.4, Math.max(0.005, hE2 * 0.28), _N);
    } else this.endS.gap();
    this.endHit = null;
    this.endS.update(dts, function (q) { return self._hitScene(q.p, net, false); }, function (q, hr) {
      if (hr.kind === 'net') {
        net.wetBy(0.03);
        // 網を通り抜けて真下へ
        if (SG.rand() < 0.5) self.below.emit(q.p, new T.Vector3(q.v.x * 0.15, q.v.y * 0.6, q.v.z * 0.15), q.a * 0.6, q.b, new T.Vector3(q.sx, 0, q.sz));
        if (SG.rand() < 0.3) self.spawnDrop(q.p, new T.Vector3(SG.rr(-0.3, 0.3), -0.5, SG.rr(-0.3, 0.3)), SG.rr(0.008, 0.014), 'splash');
        self.endHit = { kind: 'net', p: q.p.clone() };
      } else {
        self._impact(hr, q.p, 0.006);
        self.endHit = { kind: hr.kind, p: q.p.clone(), fall: q.p.y };
      }
    });
    this.below.gap();
    this.below.update(dts, function (q) { return self._hitScene(q.p, null, true); }, function (q, hr) { self._impact(hr, q.p, 0.004); });
    // しずく
    var G = K.G;
    for (var di = 0; di < this.drops.length; di++) {
      var d = this.drops[di];
      if (!d.alive) continue;
      d.v.y -= G * dts;
      d.p.addScaledVector(d.v, dts);
      var hr2 = this._hitScene(d.p, d.kind === 'drip' || d.kind === 'last' ? null : null, true);
      if (!hr2) {
        // 樋の水に落ちた
        var ps = c.activePaths();
        for (var pi = 0; pi < ps.length && !hr2; pi++) {
          if (!ps[pi].inBox(d.p.x, d.p.y, d.p.z)) continue;
          var loc2 = {};
          ps[pi].locate(d.p.x, d.p.y, d.p.z, loc2);
          if (loc2.s > 0 && loc2.s < ps[pi].L && loc2.w < -K.R + 0.03 && Math.abs(loc2.u) < K.R) hr2 = { kind: 'trough' };
        }
        // 受け皿
        var tdx = d.p.x - c.TX, tdz = d.p.z - c.TZ;
        if (!hr2 && tdx * tdx + tdz * tdz < K.TRAY_R * K.TRAY_R && d.p.y < trayY + Math.max(lvl, 0.004) && d.p.y > trayY - 0.1) hr2 = { kind: 'tray' };
      }
      if (hr2) {
        d.alive = false;
        if (d.kind === 'drip' || d.kind === 'last') {
          SG.events.emit('dripLand', hr2.kind, Math.max(0, d.y0 - d.p.y), d.p.clone());
          this._impact(hr2, d.p, 0.004);
          if (hr2.kind !== 'table') this.splash(d.p, 2, 0.5);
        } else if (d.kind === 'splash' && hr2.kind === 'basin' && SG.rand() < 0.3) {
          this.basinR.impulse(d.p.x, d.p.z, 0.0015, 0.06);
        }
      }
    }
    this.drops = this.drops.filter(function (x) { return x.alive; });
    var m = this._m;
    for (var k = 0; k < this.dropMax; k++) {
      var dd = this.drops[k];
      if (dd) {
        var sy = dd.r * (1 + SG.clamp(-dd.v.y * 0.05, 0, 0.6));
        m.makeScale(dd.r, sy, dd.r); m.setPosition(dd.p.x, dd.p.y, dd.p.z);
      } else m.makeScale(0, 0, 0);
      this.dropMesh.setMatrixAt(k, m);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
    // 泡と水玉
    this._bubbles(dts, links);
    this._beads(dts, links);
    // 波紋
    var bl = W.basinLevel;
    var B = c.basin;
    this.basinR.mesh.visible = bl > B.liner + 0.002;
    this.basinR.step(dt, bl + 0.001, 2.6, 0.988);
    this.basinR.build();
    var tl = this.tsuyuLevel = 0.42 + Math.min(0.06, world.noodles ? world.noodles.bowlCount * 0.003 : 0);
    if (world.noodles) world.noodles.tsuyuY = tl;
    this.bowlR.step(dt, tl, 1.6, 0.992);
    this.bowlR.build();
    // 流れ落ちる所で小さく波立つ
    if (this.endHit && this.endHit.kind === 'basin' && SG.rand() < 0.5) this.basinR.impulse(this.endHit.p.x, this.endHit.p.z, 0.003 * SG.clamp(W.endQ * 20, 0.2, 1.5), 0.1);
  };

  WaterFX.prototype._impact = function (hr, p, amp) {
    if (hr.kind === 'basin') this.basinR.impulse(p.x, p.z, amp, 0.1);
    else if (hr.kind === 'tsuyu') this.bowlR.impulse(p.x, p.z, amp * 0.8, 0.1);
  };

  // 流れに浮く小さな泡：一定の間隔で生まれ、流速で進むので間隔が流れの速さを映す
  WaterFX.prototype._bubbles = function (dt, links) {
    var W = this.world.water;
    this.bubT += dt;
    var sp = W.ch.spout;
    if (this.bubT > 0.42) {
      this.bubT = 0;
      if (sp.h[sp.n - 1] > 0.01 && W.trayQ > 0.01 && this.bubs.length < this.bubMax) {
        this.bubs.push({ ch: 'spout', s: sp.path.L * 0.6, u: SG.rr(-0.3, 0.3), r: SG.rr(0.012, 0.022), life: SG.rr(6, 14) });
      }
    }
    var linkOf = {};
    for (var l = 0; l < links.length; l++) linkOf[links[l].up] = links[l];
    var vs = { h: 0, v: 0 };
    var m = this._m;
    for (var i = 0; i < this.bubs.length; i++) {
      var b = this.bubs[i];
      var ch = W.ch[b.ch];
      ch.sample(b.s, vs);
      b.life -= dt;
      if (vs.h < 0.006) b.life -= dt * 4;
      b.s += vs.v * 1.02 * dt;
      if (b.s > ch.path.L) {
        var lk = linkOf[b.ch];
        if (lk) { b.ch = lk.down; b.s = lk.s + 0.02; b.u *= 0.8; }
        else b.life = 0;
      }
      b.vis = vs.h;
    }
    this.bubs = this.bubs.filter(function (b) { return b.life > 0; });
    for (var k = 0; k < this.bubMax; k++) {
      var bb = this.bubs[k];
      if (bb) {
        var ch2 = W.ch[bb.ch], path = ch2.path;
        path.axis(bb.s, _a); path.frame(bb.s, _T, _N, _B);
        var hw = SG.surfWidth(K.R, bb.vis) * 0.5 * 0.8;
        var u = bb.u * hw;
        var w = -K.R + bb.vis + 0.003;
        var r = bb.r * SG.clamp(bb.vis * 25, 0.3, 1) * SG.clamp(bb.life, 0, 1);
        m.makeScale(r, r * 0.5, r);
        m.setPosition(_a.x + _N.x * u + _B.x * w, _a.y + _N.y * u + _B.y * w, _a.z + _N.z * u + _B.z * w);
      } else m.makeScale(0, 0, 0);
      this.bubMesh.setMatrixAt(k, m);
    }
    this.bubMesh.instanceMatrix.needsUpdate = true;
  };

  // 乾いた樋に残る水玉。組みかえで低くなった側へ転がる
  WaterFX.prototype._beads = function (dt, links) {
    var W = this.world.water;
    var order = W.order;
    for (var o = 0; o < order.length; o++) {
      var nm = order[o], ch = W.ch[nm], wet = this.wet[nm];
      if (!ch.enabled) continue;
      for (var i = 0; i < ch.n; i++) {
        var h = ch.h[i];
        if (h > 0.012) wet[i] = 1;
        else if (wet[i] && h < 0.0015) {
          wet[i] = 0;
          if (SG.rand() < 0.07 && this.beads.length < this.beadMax) {
            this.beads.push({ ch: nm, s: (i + SG.rand()) * ch.dx, u: SG.rr(-0.12, 0.12), r: SG.rr(0.012, 0.024), v: 0, th: SG.rr(0.03, 0.11), alive: true, wob: SG.rand() * 6 });
          }
        }
      }
    }
    var vs = { h: 0, v: 0 };
    var G = K.G;
    for (var b = 0; b < this.beads.length; b++) {
      var bd = this.beads[b];
      var c2 = W.ch[bd.ch];
      if (!c2.enabled) { bd.alive = false; continue; }
      c2.sample(bd.s, vs);
      if (vs.h > 0.006) { bd.alive = false; continue; }
      var slope = -c2.path.g;
      if (slope > bd.th || Math.abs(bd.v) > 0.02) {
        bd.v += G * 0.35 * (slope - bd.th * 0.6) * dt;
        bd.v *= Math.exp(-1.2 * dt);
        if (bd.v < 0) bd.v = 0;
        bd.s += bd.v * dt;
        bd.u *= Math.exp(-0.8 * dt);
      }
      if (bd.s > c2.path.L) {
        bd.alive = false;
        c2.path.bottom(c2.path.L, _a);
        this.spawnDrop(_a.clone().add(new T.Vector3(0, 0.03, 0)), new T.Vector3(0, 0, 0), bd.r * 0.8, 'drip', 0);
      }
    }
    this.beads = this.beads.filter(function (x) { return x.alive; });
    var m = this._m;
    for (var k = 0; k < this.beadMax; k++) {
      var bb = this.beads[k];
      if (bb) {
        var path = W.ch[bb.ch].path;
        path.axis(bb.s, _a); path.frame(bb.s, _T, _N, _B);
        var u = bb.u, w = -Math.sqrt(Math.max(0, K.R * K.R - u * u)) + bb.r * 0.55;
        var st = 1 + Math.min(0.5, bb.v * 0.6);
        m.makeScale(bb.r * st, bb.r * 0.6, bb.r);
        m.setPosition(_a.x + _N.x * u + _B.x * w, _a.y + _N.y * u + _B.y * w, _a.z + _N.z * u + _B.z * w);
      } else m.makeScale(0, 0, 0);
      this.beadMesh.setMatrixAt(k, m);
    }
    this.beadMesh.instanceMatrix.needsUpdate = true;
  };

  SG.WaterFX = WaterFX;
})();
