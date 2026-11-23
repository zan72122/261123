/* pitcher.js — 水差し：受け皿の縁に寄せる・注ぎ口を縁に預けて傾ける・戻すと最後の一滴 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  function Pitcher(world) {
    this.world = world;
    var b = SG.buildPitcher(world.mats);
    this.b = b;
    this.root = new T.Group();
    this.tiltN = new T.Group();
    this.root.add(this.tiltN);
    this.tiltN.add(b.group);
    b.group.position.copy(b.spoutTip).multiplyScalar(-1);
    world.scene.add(this.root);
    var c = world.course;
    this.home = c.pitcherHome.clone();
    this.trayC = new T.Vector3(c.TX, 0, c.TZ);
    // 注ぎ口を受け皿へ向けて置く
    var dx = this.trayC.x - this.home.x, dz = this.trayC.z - this.home.z;
    this.homeYaw = Math.atan2(dz, dx) + SG.rr(-0.25, 0.25);
    this.base = this.home.clone();
    this.yaw = this.homeYaw;
    this.alpha = 0; this.alphaT = 0;
    this.state = 'home';
    this.pourQ = 0;
    this.lastDrop = false;
    this.spoutWorld = new T.Vector3();
    this.spoutVel = new T.Vector3();
    this.dock = new T.Vector3();
    this.dockYaw = 0;
    this.wob = new SG.Spring(0, 120, 6);
    this.target = this.home.clone();
    this.liftY = 0;
    this.rootPos = new T.Vector3();
    this._place();
  }

  Pitcher.prototype.spoutFromBase = function (base, yaw, out) {
    var t = this.b.spoutTip;
    return out.set(base.x + Math.cos(yaw) * t.x, base.y + t.y, base.z + Math.sin(yaw) * t.x);
  };

  Pitcher.prototype._place = function () {
    if (this.state === 'dock' || this.state === 'undocking') {
      this.root.position.copy(this.rootPos);
    } else {
      this.spoutFromBase(this.base, this.yaw, this.root.position);
      this.rootPos.copy(this.root.position);
    }
    this.root.rotation.set(0, -this.yaw, 0);
    this.tiltN.rotation.set(0, 0, -(this.alpha + this.wob.x));
    this.root.updateMatrixWorld(true);
    this.spoutWorld.copy(this.root.position);
    var a = this.alpha;
    var dx = Math.cos(this.yaw), dz = Math.sin(this.yaw);
    var sp = 1.6 + 2.2 * SG.smooth(0.5, 1.4, a);
    this.spoutVel.set(dx * Math.cos(a * 0.8) * sp, -Math.sin(a * 0.5) * sp, dz * Math.cos(a * 0.8) * sp);
  };

  Pitcher.prototype.hit = function (ray) {
    var c = SG.tmpV[1];
    this.b.body.getWorldPosition(c);
    c.y += 1.0 * Math.cos(this.alpha);
    var d = ray.distanceSqToPoint(c);
    if (d < 1.05 * 1.05) return c.clone().sub(ray.origin).dot(ray.direction);
    return -1;
  };

  Pitcher.prototype.wobble = function () { this.wob.kick(1.5); };

  Pitcher.prototype.grab = function () {
    if (this.state === 'dock' || this.state === 'undocking') { this.state = 'dock'; this.grabAlpha = this.alpha; return 'dock'; }
    this.state = 'carry';
    this.grabAlpha = this.alpha;
    return 'carry';
  };

  // fp: 指の示す点（受け皿の縁の高さの面上）、upPx: 押し下げた所からの上方向の移動（画面比）
  Pitcher.prototype.drag = function (fp, upFrac) {
    var c = this.world.course;
    var rimY = c.d.yT + K.TRAY_DEPTH + 0.02;
    if (this.state === 'carry') {
      this.target.set(fp.x, 0, fp.z);
      // 受け皿の縁に近いか
      var sp = this.spoutFromBase(this.base, this.yaw, SG.tmpV[2]);
      var dx = sp.x - this.trayC.x, dz = sp.z - this.trayC.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (Math.abs(dist - K.TRAY_R) < 1.25) {
        var ang = Math.atan2(dz, dx);
        // 出口の側は避ける
        if (Math.abs(SG.wrapAngle(ang)) < 0.9) ang = ang > 0 ? 0.9 : -0.9;
        this.dock.set(this.trayC.x + Math.cos(ang) * (K.TRAY_R + 0.01), rimY, this.trayC.z + Math.sin(ang) * (K.TRAY_R + 0.01));
        this.dockYaw = ang + Math.PI;
        this.state = 'dock';
        this.dockFp = fp.clone();
        this.dockUp = upFrac;
        this.alphaT = 0.32;
        SG.events.emit('pitcherDock');
      }
    } else if (this.state === 'dock') {
      this.alphaT = SG.clamp(0.32 + (upFrac - this.dockUp) * 3.4, 0.28, 1.5);
    }
  };

  Pitcher.prototype.release = function () {
    if (this.state === 'dock') { this.state = 'undocking'; this.alphaT = 0; this.undockT = 0; }
    else if (this.state === 'carry') this.state = 'back';
  };

  Pitcher.prototype.update = function (dt) {
    this.wob.step(dt);
    var c = this.world.course;
    var rimY = c.d.yT + K.TRAY_DEPTH + 0.02;
    if (this.state === 'carry') {
      var tb = this.target;
      this.base.x = SG.damp(this.base.x, tb.x - Math.cos(this.yaw) * 0.4, 9, dt);
      this.base.z = SG.damp(this.base.z, tb.z - Math.sin(this.yaw) * 0.4, 9, dt);
      var wantY = Math.max(0.6, rimY - this.b.spoutTip.y + 0.35);
      this.base.y = SG.damp(this.base.y, wantY, 4, dt);
      var dx = this.trayC.x - this.base.x, dz = this.trayC.z - this.base.z;
      this.yaw = SG.damp(this.yaw, this.yaw + SG.wrapAngle(Math.atan2(dz, dx) - this.yaw), 5, dt);
      this.alpha = SG.damp(this.alpha, 0, 6, dt);
    } else if (this.state === 'dock') {
      this.yaw = SG.damp(this.yaw, this.yaw + SG.wrapAngle(this.dockYaw - this.yaw), 8, dt);
      this.alpha = SG.damp(this.alpha, this.alphaT, 5, dt);
      this.dock.y = rimY;
      SG.dampV3(this.rootPos, this.dock, 9, dt);
    } else if (this.state === 'undocking') {
      SG.dampV3(this.rootPos, this.dock, 9, dt);
      this.alpha = SG.damp(this.alpha, 0, 2.6, dt);
      this.dock.y = rimY;
      this.undockT += dt;
      if (this.alpha < 0.05 && this.undockT > 0.8) {
        // 注ぎ口の位置から台へ
        var sp = this.rootPos;
        this.base.set(sp.x - Math.cos(this.yaw) * this.b.spoutTip.x, sp.y - this.b.spoutTip.y, sp.z - Math.sin(this.yaw) * this.b.spoutTip.x);
        this.state = 'back';
      }
    } else if (this.state === 'back') {
      this.base.x = SG.damp(this.base.x, this.home.x, 3.5, dt);
      this.base.z = SG.damp(this.base.z, this.home.z, 3.5, dt);
      var near = Math.abs(this.base.x - this.home.x) + Math.abs(this.base.z - this.home.z);
      this.base.y = SG.damp(this.base.y, near < 0.4 ? 0 : Math.max(0.3, this.base.y), 4, dt);
      this.yaw = SG.damp(this.yaw, this.yaw + SG.wrapAngle(this.homeYaw - this.yaw), 3, dt);
      this.alpha = SG.damp(this.alpha, 0, 5, dt);
      if (near < 0.01 && this.base.y < 0.003) { this.base.y = 0; this.state = 'home'; SG.events.emit('pitcherHome'); }
    }
    var q = K ? SG.WK.POUR_MAX * Math.pow(SG.smooth(0.5, 1.4, this.alpha), 1.2) : 0;
    if (this.state !== 'dock' && this.state !== 'undocking') q = 0;
    if (this.pourQ > 0.004 && q <= 0.004) this.lastDrop = true;
    this.pourQ = q;
    this._place();
  };

  SG.Pitcher = Pitcher;
})();
