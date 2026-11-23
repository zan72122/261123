/* main.js — 組み上げと毎コマの進行 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  SG.createWorld = function (opt) {
    opt = opt || {};
    var world = { headless: !!opt.headless };
    if (!opt.headless) {
      world.renderer = SG.initRenderer(opt.canvas);
      var sc = SG.initScene(world.renderer);
      world.scene = sc.scene;
    } else {
      world.scene = new T.Scene();
    }
    var M = world.mats = SG.makeMaterials();
    world.scene.add(SG.buildTable(M));
    var c = world.course = new SG.Course(world);
    var basin = SG.buildBasin(M, c.basin);
    world.scene.add(basin.group);
    var bowl = SG.buildBowl(M);
    bowl.group.position.copy(c.bowlPos);
    bowl.group.rotation.y = SG.rr(0, Math.PI * 2);
    world.scene.add(bowl.group);
    var zaru = SG.buildZaru(M);
    zaru.group.position.copy(c.zaruPos);
    world.scene.add(zaru.group);
    world.zaru = zaru;
    world.water = new SG.Water(c);
    world.pitcher = new SG.Pitcher(world);
    world.net = new SG.Net(world);
    world.noodles = new SG.Noodles(world);
    world.fx = new SG.WaterFX(world);
    world.rig = new SG.CameraRig(world);
    world.guide = new SG.Guide(world);
    world.audio = new SG.Audio();
    world.isZaruHidden = function () { return world.rig.mode !== 'overview'; };
    if (!opt.headless) world.input = new SG.Input(world, opt.canvas);
    wireSound(world);
    return world;
  };

  function wireSound(w) {
    var A = w.audio, E = SG.events;
    E.on('firstTouch', function () { A.start(); });
    E.on('pillarRise', function () { A.rise(); });
    E.on('pillarTouch', function () { A.squish(0.6); });
    E.on('notch', function (k, dir) { A.click(dir > 0); A.squish(0.4); });
    E.on('pillarRelease', function () { A.boing(); });
    E.on('troughLift', function () { A.lift(); });
    E.on('troughSnap', function () { A.click(true); });
    E.on('troughSeat', function (id, L) { A.seat(L); A.boing(); });
    E.on('troughDrop', function () { A.tap(); });
    E.on('pitcherDock', function () { A.dock(); });
    E.on('noodlePick', function () { A.pick(); });
    E.on('noodlePlace', function () { A.wet(0.5); });
    E.on('noodlePress', function () { A.press(); });
    E.on('netCatch', function () { A.wet(1); });
    E.on('tsuyuPlop', function (p, fill) { A.plop(fill); });
    E.on('basinPlop', function () { A.basinPlop(); });
    E.on('dripLand', function (kind, h) { A.drip(h, kind === 'basin' || kind === 'tsuyu' || kind === 'tray' || kind === 'trough'); });
    E.on('locked', function () { A.tap(); });
    E.on('netGrab', function () { A.lift(); });
  }

  SG.stepWorld = function (w, dt) {
    if (w.input) w.input.update(dt);
    var cam = w.rig.cam;
    w.course.update(dt, 0);
    w.pitcher.update(dt);
    w.water.pourQ = w.pitcher.pourQ;
    w.water.step(dt);
    w.net.update(dt, w.water);
    w.noodles.step(dt);
    w.fx.update(dt);
    w.rig.update(dt);
    w.guide.update(dt);
    // ずっと鳴る音
    var A = w.audio;
    if (A.ready) {
      var W = w.water;
      var pour = SG.smooth(0.0, SG.WK.POUR_MAX, w.pitcher.pourQ);
      A.setLoop('pour', pour * 0.28, 900 + pour * 900);
      var flow = SG.smooth(0.0, 0.09, Math.max(W.trayQ, W.endQs));
      A.setLoop('flow', flow * 0.07, 2400);
      var fall = SG.smooth(0.0, 0.08, W.endQs);
      var onNet = w.fx.endHit && w.fx.endHit.kind === 'net';
      A.setLoop('fall', fall * (onNet ? 0.12 : 0.2), onNet ? 1500 : 800 + W.basinLevel * 1500);
    }
  };

  SG.boot = function () {
    var canvas = document.getElementById('c');
    var w = SG.createWorld({ canvas: canvas });
    SG.world = w;
    function resize() {
      var W = window.innerWidth, H = window.innerHeight;
      w.renderer.setSize(W, H, false);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      w.rig.resize(W, H);
      w.input.resize(W, H);
      var a = w.rig.viewAngles(false);
      w.net.handleYaw = -(Math.atan2(Math.cos(a.yaw), Math.sin(a.yaw)) + 0.7);
    }
    // iOS でも確実に音を始める
    var unlock = function () { w.audio.start(); };
    document.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('pointerup', unlock);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
    resize();
    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      SG.stepWorld(w, dt);
      w.renderer.render(w.scene, w.rig.cam);
      requestAnimationFrame(frame);
    }
    // 最初の一コマを先に描く
    SG.stepWorld(w, 1 / 60);
    w.renderer.render(w.scene, w.rig.cam);
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', function () {
      if (w.audio.ctx) { if (document.hidden) w.audio.ctx.suspend(); else w.audio.ctx.resume(); }
      last = performance.now();
    });
  };
})();
