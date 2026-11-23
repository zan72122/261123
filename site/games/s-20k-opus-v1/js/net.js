/* net.js — 小さな丸い網すくい：置く・持ち上げる・器の縁に預けて傾ける・濡れて滴る */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  function Net(world) {
    this.world = world;
    var M = world.mats;
    var b = SG.buildNet(M);
    this.obj = b;
    this.group = b.group;
    world.scene.add(this.group);
    this.rn = SG.NET_R; this.dn = SG.NET_D;
    var c = world.course;
    this.B = c.basin;
    this.bowl = c.bowlPos;
    // 初めの置き場所：水受けの中、末端の口の少し先
    var d = c.d;
    var ang = c.st.theta;
    this.c = new T.Vector3(d.eOutX + Math.cos(ang) * 0.9 + 0.2, 0, d.eOutZ + Math.sin(ang) * 0.9 + 0.55);
    this.c.y = this.baseline(this.c.x, this.c.z);
    this.cPrev = this.c.clone();
    this.vel = new T.Vector3();
    this.target = this.c.clone();
    this.held = false;
    this.lift = 0;
    this.tilt = 0;
    this.tiltDir = new T.Vector3(1, 0, 0);
    this.q = new T.Quaternion();
    this.qInv = new T.Quaternion();
    this.wet = 0;
    this.drop = 0;      // 網の裏で膨らむ一滴
    this.dropT = 0;
    this.submerged = false;
    this.overBowl = false;
    this.handleYaw = 0;
    // 水玉
    var beadG = new T.SphereGeometry(1, 8, 6);
    this.beads = new T.InstancedMesh(beadG, M.drop, 28);
    this.beadPos = [];
    for (var i = 0; i < 28; i++) {
      var a = SG.rr(0, Math.PI * 2), r = Math.sqrt(SG.rand()) * this.rn * 0.92;
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      this.beadPos.push({ x: x, y: -this.dn * (1 - (r / this.rn) * (r / this.rn)) + 0.006, z: z, th: SG.rand(), s: SG.rr(0.008, 0.016) });
    }
    this.beads.renderOrder = 4;
    this.group.add(this.beads);
    var dg = new T.SphereGeometry(1, 12, 10);
    this.dropMesh = new T.Mesh(dg, M.drop);
    this.dropMesh.renderOrder = 4;
    this.group.add(this.dropMesh);
    this.dropMesh.visible = false;
    this._m = new T.Matrix4();
    this.contactCount = 0;
    this.contactCountS = 0;
  }

  // 置いたときの網の縁の高さ
  Net.prototype.baseline = function (x, z) {
    var B = this.B;
    var sd = SG.sdRoundRect(x, z, B.cx, B.cz, B.hx, B.hz, B.rc);
    var yIn = B.liner + this.dn + 0.012;
    var yClear = B.H + 0.5;
    var yTable = this.dn + 0.016;
    var y;
    if (sd < -0.8) y = yIn;
    else if (sd < -0.1) y = SG.lerp(yIn, yClear, SG.smooth(-0.8, -0.1, sd));
    else if (sd < 0.6) y = yClear;
    else y = SG.lerp(yClear, yTable, SG.smooth(0.6, 1.2, sd));
    // 器の上では縁に預ける
    var dx = x - this.bowl.x, dz = z - this.bowl.z;
    var q = Math.sqrt(dx * dx + dz * dz);
    var yb = 0.725 + 0.05;
    var k = SG.smooth(0.92 + this.rn + 0.35, 0.92 + this.rn - 0.1, q);
    y = SG.lerp(y, yb, k);
    return y;
  };

  // 動ける範囲
  Net.prototype.clampXZ = function (p) {
    var B = this.B;
    var x0 = B.cx - B.hx + 0.15, x1 = B.cx + B.hx - 0.15;
    var z0 = B.cz - B.hz + 0.15, z1 = Math.max(B.cz + B.hz, this.bowl.z + 0.6);
    p.x = SG.clamp(p.x, x0, x1);
    p.z = SG.clamp(p.z, z0, z1);
    // 水受けの外では、器のほうへの通り道だけ
    var sd = SG.sdRoundRect(p.x, p.z, B.cx, B.cz, B.hx, B.hz, B.rc);
    if (sd > -0.15) {
      var dx = p.x - this.bowl.x, dz = p.z - this.bowl.z;
      var q = Math.sqrt(dx * dx + dz * dz);
      var lim = 0.92 + 0.35;
      if (q > lim && p.z > B.cz + B.hz - 0.15) {
        // 器と水受けの間の帯に寄せる
        var bx = SG.clamp(p.x, this.bowl.x - 0.9, this.bowl.x + 0.9);
        p.x = SG.lerp(p.x, bx, 0.6);
      }
    }
    // 器の真ん中までは入らない（縁に預けて傾けるところまで）
    var ex = p.x - this.bowl.x, ez = p.z - this.bowl.z;
    var eq = Math.sqrt(ex * ex + ez * ez);
    var qmin = 0.2;
    if (eq < qmin) {
      if (eq < 1e-4) { ex = this.c.x - this.bowl.x; ez = this.c.z - this.bowl.z; eq = Math.sqrt(ex * ex + ez * ez) || 1; }
      p.x = this.bowl.x + ex / eq * qmin; p.z = this.bowl.z + ez / eq * qmin;
    }
    return p;
  };

  Net.prototype.setTarget = function (p) {
    this.target.x = p.x; this.target.z = p.z;
    this.clampXZ(this.target);
  };

  Net.prototype.update = function (dt, water) {
    this.cPrev.copy(this.c);
    var k = this.held ? 18 : 10;
    this.c.x = SG.damp(this.c.x, this.target.x, k, dt);
    this.c.z = SG.damp(this.c.z, this.target.z, k, dt);
    this.lift = SG.damp(this.lift, this.held ? 0.36 : 0, 6, dt);
    var base = this.baseline(this.c.x, this.c.z);
    // 器の上では縁に預ける
    var dx = this.bowl.x - this.c.x, dz = this.bowl.z - this.c.z;
    var q = Math.sqrt(dx * dx + dz * dz);
    var ov = (0.92 + this.rn) - q;
    this.overBowl = ov > 0.15;
    var liftEff = this.lift * (1 - SG.smooth(0.0, 0.3, ov));
    var yT = base + liftEff;
    this.c.y = SG.damp(this.c.y, yT, 12, dt);
    var tiltT = 0;
    if (ov > 0.32 && q > 1e-3) {
      tiltT = SG.clamp((ov - 0.3) * 1.5, 0, 1.0);
      this.tiltDir.set(dx / q, 0, dz / q);
    }
    this.tilt = SG.damp(this.tilt, tiltT, 7, dt);
    var axis = SG.tmpV[0].set(0, 1, 0).cross(this.tiltDir).normalize();
    if (axis.lengthSq() < 0.5) axis.set(0, 0, 1);
    this.q.setFromAxisAngle(axis, this.tilt);
    this.qInv.copy(this.q).invert();
    this.vel.copy(this.c).sub(this.cPrev).divideScalar(Math.max(dt, 1e-4));
    this.group.position.copy(this.c);
    this.group.quaternion.copy(this.q);
    // 柄はこちら側へ
    this.obj.handle.rotation.y = this.handleYaw;
    // 濡れ・滴
    var bottomY = this.c.y - this.dn * Math.cos(this.tilt);
    var B = this.B;
    var sd = SG.sdRoundRect(this.c.x, this.c.z, B.cx, B.cz, B.hx, B.hz, B.rc);
    this.submerged = sd < -0.1 && water && bottomY < water.basinLevel - 0.005;
    if (this.submerged) this.wet = 1;
    this.surfBelow = sd < 0 ? (water ? water.basinLevel : B.liner) : (q < 0.92 ? 0.42 : 0);
    var hAbove = bottomY - this.surfBelow;
    if (!this.submerged && this.wet > 0.03) {
      this.dropT += dt;
      var grow = 0.02 * (0.4 + this.wet);
      this.drop = Math.min(0.034, this.drop + grow * dt);
      var interval = 0.35 + 0.9 * (1 - this.wet) + hAbove * 0.6;
      if (this.drop >= 0.026 && this.dropT > interval) {
        this.dropT = 0;
        var wp = this.bottomWorld(SG.tmpV[1]);
        SG.events.emit('netDrip', wp.clone(), this.drop, hAbove);
        this.drop = 0.004;
        this.wet = Math.max(0, this.wet - 0.012);
      }
    } else if (this.submerged) {
      this.drop = 0; this.dropT = 0;
    }
    this.wet = Math.max(0, this.wet - dt * 0.004);
    // 見た目
    if (this.drop > 0.004 && !this.submerged) {
      this.dropMesh.visible = true;
      var r = this.drop * 0.5;
      this.dropMesh.scale.set(r, r * 1.25, r);
      this.dropMesh.position.set(0, -this.dn - r * 1.0, 0);
    } else this.dropMesh.visible = false;
    var m = this._m;
    for (var i = 0; i < this.beadPos.length; i++) {
      var bp = this.beadPos[i];
      var s = this.wet > bp.th * 0.9 ? bp.s * SG.smooth(bp.th * 0.9, bp.th * 0.9 + 0.1, this.wet) : 0.0001;
      if (this.submerged) s = 0.0001;
      m.makeScale(s, s * 0.7, s);
      m.setPosition(bp.x, bp.y, bp.z);
      this.beads.setMatrixAt(i, m);
    }
    this.beads.instanceMatrix.needsUpdate = true;
    this.contactCountS = SG.damp(this.contactCountS, this.contactCount, 4, dt);
    this.contactCount = 0;
  };

  Net.prototype.bottomWorld = function (out) {
    out.set(0, -this.dn, 0).applyQuaternion(this.q).add(this.c);
    return out;
  };
  Net.prototype.wetBy = function (amount) { this.wet = Math.min(1, this.wet + amount); };

  // 点が網のどこにあるか（ローカル）
  Net.prototype.toLocal = function (x, y, z, out) {
    out.set(x - this.c.x, y - this.c.y, z - this.c.z).applyQuaternion(this.qInv);
    return out;
  };

  // 麺の粒の当たり（戻り値 0/1 網/2 縁）
  var _l = new T.Vector3(), _n = new T.Vector3();
  Net.prototype.collide = function (P, i, r, res) {
    var dx = P[i] - this.c.x, dy = P[i + 1] - this.c.y, dz = P[i + 2] - this.c.z;
    var R = this.rn + 0.1;
    if (dx * dx + dz * dz > R * R || dy > 0.25 || dy < -0.5) return 0;
    var l = this.toLocal(P[i], P[i + 1], P[i + 2], _l);
    var rho = Math.sqrt(l.x * l.x + l.z * l.z);
    var rn = this.rn, dn = this.dn;
    var type = 0;
    if (rho < rn) {
      var ys = -dn * (1 - (rho / rn) * (rho / rn));
      var slope = 2 * dn * rho / (rn * rn);
      var ca = 1 / Math.sqrt(1 + slope * slope);
      var f = (l.y - ys) * ca;
      var band = (this.tilt > 0.05 || this.overBowl) ? 0.025 : 0.13;
      if (f < r && f > -band) {
        // 法線（ローカル）
        var rx = rho > 1e-5 ? l.x / rho : 0, rz = rho > 1e-5 ? l.z / rho : 0;
        _n.set(-slope * rx * ca, ca, -slope * rz * ca);
        var push = r - f;
        l.x += _n.x * push; l.y += _n.y * push; l.z += _n.z * push;
        type = 1;
      }
    }
    // 縁（輪）
    var rho2 = Math.sqrt(l.x * l.x + l.z * l.z);
    if (rho2 > 1e-5) {
      var qx = l.x / rho2 * rn, qz = l.z / rho2 * rn;
      var ex = l.x - qx, ey = l.y, ez = l.z - qz;
      var dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
      var rr = 0.02 + r;
      if (dd < rr && dd > 1e-6) {
        var k = rr / dd;
        l.x = qx + ex * k; l.y = ey * k; l.z = qz + ez * k;
        _n.set(ex / dd, ey / dd, ez / dd);
        type = 2;
      }
    }
    if (!type) return 0;
    l.applyQuaternion(this.q);
    P[i] = l.x + this.c.x; P[i + 1] = l.y + this.c.y; P[i + 2] = l.z + this.c.z;
    _n.applyQuaternion(this.q);
    res.nx = _n.x; res.ny = _n.y; res.nz = _n.z;
    if (type === 1) this.contactCount++;
    return type;
  };

  // 指が網に触れたか（スクリーンの近さも使う）
  Net.prototype.hitTest = function (ray, extra) {
    var p = SG.tmpV[2];
    var t = (this.c.y - ray.origin.y) / ray.direction.y;
    if (!(t > 0)) return -1;
    p.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    var dx = p.x - this.c.x, dz = p.z - this.c.z;
    var R = this.rn + (extra === undefined ? 0.3 : extra);
    if (dx * dx + dz * dz < R * R) return t;
    // 柄
    var hx = Math.cos(-this.handleYaw), hz = Math.sin(-this.handleYaw);
    var along = dx * hx + dz * hz, lat = -dx * hz + dz * hx;
    if (along > this.rn && along < this.rn + 1.0 && Math.abs(lat) < 0.18 + (extra || 0) * 0.5) return t;
    return -1;
  };

  SG.Net = Net;
})();
