// main.js — 机に部品を広げ、毎フレームを回す
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C, P = KK.parts;

  function stow(part, x, z, yaw) {
    part.state = 'stowed';
    part.pose.x = part.disp.x = x; part.pose.z = part.disp.z = z;
    part.pose.yaw = part.disp.yaw = yaw;
    part.legs = 0; part.legsD = 0;
    if (part.kind === 'straight') part.dofs.forEach(function (d) { d.h = d.hd = P.STOW_H; });
    else if (part.kind === 'chute') { part.dofs[0].h = part.dofs[0].hd = P.STOW_H + part.sl; }
  }

  KK.setup = function (canvas, w, h) {
    KK.buildTextures();
    KK.world.init(canvas);
    KK.felt.init();

    var start = P.add(new P.Start());
    start.updatePath();
    var sp = start.ports[0];
    var corner = P.add(new P.Corner());
    // 出発台の先に坂一本ぶんの空き、その先の低い位置に曲がり角
    corner.pose.x = corner.disp.x = sp.wx + C.SPAN;
    corner.pose.z = corner.disp.z = sp.wz + corner.rc;
    corner.dofs[0].h = corner.dofs[0].hd = 4;

    var ramp1 = P.add(new P.Straight());
    var ramp2 = P.add(new P.Straight({ alt: true }));
    var chute = P.add(new P.Chute());
    var spiral = P.add(new P.Spiral());
    KK.state.ramp1 = ramp1;

    // 脇の部品の並びを遊ぶたびに少しずつ変える
    var j = function (a) { return KK.rand(-a, a); };
    stow(ramp1, -10 + j(0.5), 8.2 + j(0.25), j(0.05));
    var slots = KK.shuffle([{ x: -13.5, z: 12.6 }, { x: -14, z: 17.2 }]);
    stow(ramp2, slots[0].x + j(0.5), slots[0].z + j(0.2), Math.PI + j(0.05));
    stow(chute, slots[1].x + 2 + j(0.6), slots[1].z + j(0.2), (Math.random() < 0.5 ? 0 : Math.PI) + j(0.06));
    stow(spiral, 2.6 + j(0.4), 15.3 + j(0.25), j(0.5));

    KK.ball.init();
    KK.cam.init(w, h);
    KK.input.init(canvas);
    KK.guide.init();
    // 最初の形を整える
    P.update(0.016, 0);
  };

  var last = 0, acc = 0;
  KK.frame = function (dt) {
    var S = KK.state;
    S.time += dt;
    var chutes = P.byKind.chute || [];
    P.update(dt, S.time);
    KK.world.update(dt);
    KK.ball.update(dt);
    var om = 0, pan = 0;
    for (var i = 0; i < chutes.length; i++) {
      KK.wheel.visual(chutes[i]);
      if (Math.abs(chutes[i].wheel.omega) > Math.abs(om)) {
        om = chutes[i].wheel.omega;
        if (KK.cam.camera) { var pp = chutes[i].group.position.clone().project(KK.cam.camera); pan = KK.clamp(pp.x, -1, 1) * 0.7; }
      }
    }
    KK.audio.wheel(om, pan);
    KK.felt.update(dt);
    KK.cam.update(dt);
    KK.guide.update(dt);
  };

  function size(canvas) {
    var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  KK.boot = function () {
    var canvas = document.getElementById('stage');
    var s = size(canvas);
    KK.setup(canvas, s.w, s.h);
    var r = KK.world.renderer;
    r.setSize(s.w, s.h, false);
    function onResize() {
      var z = size(canvas);
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(z.w, z.h, false);
      KK.cam.resize(z.w, z.h);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });
    document.addEventListener('visibilitychange', function () {
      var A = KK.audio;
      if (!A.ctx) return;
      if (document.hidden) A.ctx.suspend(); else A.ctx.resume();
    });
    last = performance.now();
    function loop(now) {
      requestAnimationFrame(loop);
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      KK.frame(dt);
      r.render(KK.world.scene, KK.cam.camera);
    }
    requestAnimationFrame(loop);
  };

  if (!KK.headless && typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', KK.boot);
    else KK.boot();
  }
})();
