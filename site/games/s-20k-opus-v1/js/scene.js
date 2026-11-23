/* scene.js — 描画の土台：明るい昼の部屋、窓の映り込み、日差しと影、食卓 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;

  SG.initRenderer = function (canvas) {
    var r = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    return r;
  };

  // 窓のある部屋を映り込み用に
  function envScene() {
    var s = new T.Scene();
    var room = new T.Mesh(new T.BoxGeometry(60, 30, 60), new T.MeshBasicMaterial({ color: 0xf1ebe0, side: T.BackSide }));
    room.position.y = 10;
    s.add(room);
    var floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshBasicMaterial({ color: 0xb59a78 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -4.9;
    s.add(floor);
    // 明るい窓（格子つき）
    var win = new T.Group();
    var glass = new T.Mesh(new T.PlaneGeometry(22, 12), new T.MeshBasicMaterial({ color: new T.Color(4.2, 4.1, 3.8) }));
    win.add(glass);
    var frameM = new T.MeshBasicMaterial({ color: 0xd8cfbf });
    for (var i = -1; i <= 1; i++) {
      var bar = new T.Mesh(new T.PlaneGeometry(0.5, 12), frameM);
      bar.position.set(i * 7.3, 0, 0.05); win.add(bar);
    }
    var hb = new T.Mesh(new T.PlaneGeometry(22, 0.5), frameM);
    hb.position.z = 0.05; win.add(hb);
    win.position.set(-6, 12, -29.8);
    s.add(win);
    var side = new T.Mesh(new T.PlaneGeometry(12, 9), new T.MeshBasicMaterial({ color: new T.Color(2.2, 2.2, 2.1) }));
    side.position.set(-29.8, 11, 6); side.rotation.y = Math.PI / 2;
    s.add(side);
    var ceil = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshBasicMaterial({ color: new T.Color(1.4, 1.38, 1.32) }));
    ceil.position.y = 24.8; ceil.rotation.x = Math.PI / 2;
    s.add(ceil);
    return s;
  }

  SG.initScene = function (renderer) {
    var scene = new T.Scene();
    scene.background = new T.Color(0xeee6da);
    var pm = new T.PMREMGenerator(renderer);
    var es = envScene();
    var rt = pm.fromScene(es, 0.03);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.75;
    pm.dispose();

    var hemi = new T.HemisphereLight(0xfff8ee, 0xcbb69a, 0.55);
    scene.add(hemi);
    var sun = new T.DirectionalLight(0xfff1dc, 2.3);
    sun.position.set(-8, 18, 7);
    sun.target.position.set(0.5, 0, 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 9; sc.bottom = -9; sc.near = 2; sc.far = 45;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target);
    var fill = new T.DirectionalLight(0xe8efff, 0.35);
    fill.position.set(8, 6, 10);
    scene.add(fill);

    // 部屋（遠く）
    var floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: 0xb8a07f, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -7.2;
    floor.receiveShadow = true;
    scene.add(floor);
    var wallM = new T.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.95 });
    var back = new T.Mesh(new T.PlaneGeometry(80, 40), wallM);
    back.position.set(0, 8, -16);
    scene.add(back);
    var winGlass = new T.Mesh(new T.PlaneGeometry(14, 9), new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.6, 1.5) }));
    winGlass.position.set(-5, 9, -15.9);
    scene.add(winGlass);
    var fm = new T.MeshStandardMaterial({ color: 0xd9cfbe, roughness: 0.7 });
    [[-5, 13.6, 14.6, 0.4], [-5, 4.4, 14.6, 0.4], [-12.1, 9, 0.4, 9.6], [2.1, 9, 0.4, 9.6], [-5, 9, 0.25, 9]].forEach(function (f) {
      var b = new T.Mesh(new T.BoxGeometry(f[2], f[3], 0.2), fm);
      b.position.set(f[0], f[1], -15.8);
      scene.add(b);
    });
    var sideWall = new T.Mesh(new T.PlaneGeometry(40, 40), wallM);
    sideWall.position.set(-18, 8, 0); sideWall.rotation.y = Math.PI / 2;
    scene.add(sideWall);
    // 脚
    var legM = new T.MeshStandardMaterial({ color: 0xa57b4f, roughness: 0.6 });
    [[-6.9, -4.4], [6.9, -4.4], [-6.9, 4.4], [6.9, 4.4]].forEach(function (p) {
      var l = new T.Mesh(new T.BoxGeometry(0.45, 6.9, 0.45), legM);
      l.position.set(p[0], -3.8, p[1]);
      scene.add(l);
    });
    return { scene: scene, sun: sun };
  };
})();
