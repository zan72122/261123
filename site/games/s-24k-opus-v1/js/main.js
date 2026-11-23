/* main.js — 起動と毎フレームの順番。 */
(function () {
  'use strict';
  const G = window.G;

  // 描画以外の準備（node のテストからも呼べる）
  G.start = function (renderer, w, h, canvas) {
    const scene = G.world.init(renderer);
    G.kit.build(scene);
    G.dish.init(scene);
    G.strands.init(scene);
    G.cam.init(w / h);
    G.game.init();
    G.tools.init(scene);
    G.fx.init(scene);
    G.hint.init(scene);
    if (canvas) G.input.init(canvas);
    G.scene = scene;
    // 最初の視点
    G.game.update(0.016);
    G.cam.snap();
    return scene;
  };

  G.frame = function (dt) {
    dt = Math.min(Math.max(dt, 0), 1 / 20);
    G.time += dt;
    G.world.update(dt, G.time);
    G.game.update(dt);
    G.dish.update(dt);
    G.strands.step(dt);
    G.tools.update(dt);
    G.fx.update(dt);
    G.strands.updateMeshes();
    G.hint.update(dt);
  };

  function boot() {
    const canvas = document.getElementById('c');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = dpr > 1.5 ? 0.5 : 0.75;
    const size = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      if (G.cam.camera) G.cam.resize(w, h);
    };
    size();
    G.start(renderer, window.innerWidth, window.innerHeight, canvas);
    window.addEventListener('resize', size);
    window.addEventListener('orientationchange', () => setTimeout(size, 200));
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      G.frame(dt);
      renderer.render(G.scene, G.cam.camera);
    };
    requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => { last = performance.now(); });
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
