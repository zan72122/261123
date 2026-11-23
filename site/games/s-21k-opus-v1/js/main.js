// main.js — 起動と毎フレームの順序
(function () {
  'use strict';
  var G = window.G;
  var last = 0, running = false;

  G.start = function () {
    var canvas = document.getElementById('c');
    G.tex.build();
    G.mat.build();
    G.stage.init(canvas);
    var scene = G.stage.scene;
    G.fx.init(scene);
    G.box.build(scene);
    G.parts.build(scene);
    G.caps.build(scene);
    G.guide.init(scene);
    G.input.init(canvas);
    G.game.init();
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  };

  G.step = function (dt) {
    G.guide.pre();
    G.tickTweens(dt);
    G.tickTimers(dt);
    G.box.update(dt);
    G.parts.update(dt);
    G.flow.update(dt);
    G.caps.update(dt);
    G.fx.update(dt);
    G.game.update(dt);
    G.guide.update(dt, G.game.idle);
    if (G.audio) G.audio.frame();
  };

  function loop(now) {
    if (!running) return;
    var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    try { G.step(dt); } catch (e) { console.error(e); }
    G.stage.renderer.render(G.stage.scene, G.stage.camera);
    requestAnimationFrame(loop);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (G.audio && G.audio.ctx) G.audio.ctx.suspend(); }
    else { last = performance.now(); if (G.audio && G.audio.ctx) G.audio.ctx.resume(); }
  });

  if (!window.__NO_AUTOSTART__) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', G.start);
    else G.start();
  }
})();
