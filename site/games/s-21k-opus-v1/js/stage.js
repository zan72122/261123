// stage.js — レンダラ・机・窓明かり・環境光・カメラの枠取り
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var S = (G.stage = {});

  S.init = function (canvas) {
    var r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    S.renderer = r;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e2d6);
    scene.fog = new THREE.Fog(0xe9e2d6, 110, 230);
    S.scene = scene;

    var cam = new THREE.PerspectiveCamera(42, 1, 0.3, 300);
    cam.position.set(0, 30, 30); cam.lookAt(0, 0, 0);
    S.camera = cam;

    buildEnv();
    buildLights();
    buildDesk();
    S.resize();
    window.addEventListener('resize', S.resize);
    window.addEventListener('orientationchange', function () { setTimeout(S.resize, 200); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', S.resize);
  };

  S.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    if (window.visualViewport) { w = Math.round(window.visualViewport.width) || w; h = Math.round(window.visualViewport.height) || h; }
    S.w = w; S.h = h;
    S.renderer.setSize(w, h, false);
    S.renderer.domElement.style.width = w + 'px';
    S.renderer.domElement.style.height = h + 'px';
    S.camera.aspect = w / h;
    S.camera.fov = w < h ? 54 : 40;
    S.camera.updateProjectionMatrix();
    S.portrait = w < h;
  };

  // 映り込み用の部屋（窓が明るい）
  function buildEnv() {
    var env = new THREE.Scene();
    var room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40),
      new THREE.MeshBasicMaterial({ color: 0x8a7f72, side: THREE.BackSide }));
    env.add(room);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x6b5238 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -9.9; env.add(floor);
    var win = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    win.position.set(-6, 3, -19.8); env.add(win);
    var win2 = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6e4 }));
    win2.position.set(-19.8, 3, -4); win2.rotation.y = Math.PI / 2; env.add(win2);
    var ceil = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xc8c2b8 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 9.9; env.add(ceil);
    try {
      var pm = new THREE.PMREMGenerator(S.renderer);
      S.scene.environment = pm.fromScene(env, 0.03).texture;
      S.scene.environmentIntensity = 0.55;
      pm.dispose();
    } catch (e) { /* 環境マップなしでも描ける */ }
  }

  function buildLights() {
    var hemi = new THREE.HemisphereLight(0xe6eeff, 0x8f6c48, 0.55);
    S.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 110;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    S.scene.add(sun); S.scene.add(sun.target);
    S.sun = sun;
    S.sunAz = -0.62; S.sunEl = 0.78; S.sunAzBase = -0.62;
    // 窓枠（見えないが影だけ落とす）
    var frame = new THREE.Group();
    var bars = [[0, 0, 0.7, 46], [-12, 0, 0.7, 46], [12, 0, 0.7, 46], [0, 6, 46, 0.6], [0, -9, 46, 0.6]];
    bars.forEach(function (b) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(b[2], b[3], 0.5), G.mat.occluder);
      m.position.set(b[0], b[1], 0); m.castShadow = true; m.receiveShadow = false;
      frame.add(m);
    });
    S.scene.add(frame);
    S.winFrame = frame;
    S.placeSun(0);
    var fill = new THREE.DirectionalLight(0xdfe6ff, 0.35);
    fill.position.set(18, 14, 26); S.scene.add(fill);
  }

  // 窓明かりの向き（d: ゆっくり移る量）
  S.placeSun = function (drift) {
    var az = S.sunAzBase + drift * 0.16, el = S.sunEl - drift * 0.05;
    var dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    S.sunDir = dir;
    S.sun.position.copy(dir).multiplyScalar(60);
    S.sun.target.position.set(0, 0, 0);
    S.winFrame.position.copy(dir).multiplyScalar(24);
    S.winFrame.lookAt(0, 0, 0);
  };

  function buildDesk() {
    var desk = new THREE.Mesh(new THREE.BoxGeometry(110, 3, 80), [
      G.mat.desk, G.mat.desk, G.mat.desk, G.mat.desk, G.mat.desk, G.mat.desk
    ]);
    desk.position.set(0, -1.5, -6);
    desk.receiveShadow = true;
    S.scene.add(desk);
    S.desk = desk;
    var wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.95 }));
    wall.position.set(0, 30, -46); wall.receiveShadow = true;
    S.scene.add(wall);
  }

  // ---------- カメラの枠取り ----------
  var tmpCam = new THREE.PerspectiveCamera();
  // points を画面内に収めるカメラ位置を求める
  S.fit = function (points, elev, azim, margin, minDist, maxDist) {
    var dir = new THREE.Vector3(Math.sin(azim) * Math.cos(elev), Math.sin(elev), Math.cos(azim) * Math.cos(elev));
    var box = new THREE.Box3();
    points.forEach(function (p) { box.expandByPoint(p); });
    var c = box.getCenter(new THREE.Vector3());
    var d = box.getSize(new THREE.Vector3()).length() * 1.2 + 4;
    tmpCam.fov = S.camera.fov; tmpCam.aspect = S.camera.aspect; tmpCam.near = 0.1; tmpCam.far = 500;
    tmpCam.updateProjectionMatrix();
    var m = margin == null ? 0.12 : margin;
    var p = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    for (var it = 0; it < 7; it++) {
      tmpCam.position.copy(c).addScaledVector(dir, d);
      tmpCam.lookAt(c); tmpCam.updateMatrixWorld();
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (var i = 0; i < points.length; i++) {
        p.copy(points[i]).project(tmpCam);
        if (p.z > 1) { p.x *= 3; p.y *= 3; }
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      var hh = d * Math.tan(THREE.MathUtils.degToRad(tmpCam.fov / 2)), hw = hh * tmpCam.aspect;
      right.setFromMatrixColumn(tmpCam.matrixWorld, 0);
      up.setFromMatrixColumn(tmpCam.matrixWorld, 1);
      c.addScaledVector(right, cx * hw * 0.9).addScaledVector(up, cy * hh * 0.9);
      var ex = (maxX - minX) / 2 / (1 - m), ey = (maxY - minY) / 2 / (1 - m);
      var f = G.clamp(Math.max(ex, ey), 0.4, 2.5);
      d *= G.lerp(1, f, 0.85);
    }
    if (minDist) d = Math.max(d, minDist);
    if (maxDist) d = Math.min(d, maxDist);
    return { pos: c.clone().addScaledVector(dir, d), target: c, dist: d };
  };

  // 画面座標（px）へ
  S.toScreen = function (v, out) {
    out = out || new THREE.Vector3();
    out.copy(v).project(S.camera);
    return out.set((out.x + 1) / 2 * S.w, (1 - out.y) / 2 * S.h, out.z);
  };
  S.ray = new THREE.Raycaster();
  S.setRay = function (px, py) {
    S.ray.setFromCamera(new THREE.Vector2(px / S.w * 2 - 1, -(py / S.h) * 2 + 1), S.camera);
    return S.ray.ray;
  };
  // 光線と水平面 y=h
  S.rayPlaneY = function (ray, h, out) {
    var dy = ray.direction.y;
    if (Math.abs(dy) < 1e-5) return null;
    var t = (h - ray.origin.y) / dy;
    if (t < 0) return null;
    return (out || new THREE.Vector3()).copy(ray.origin).addScaledVector(ray.direction, t);
  };
  S.rayPlaneZ = function (ray, z, out) {
    var dz = ray.direction.z;
    if (Math.abs(dz) < 1e-5) return null;
    var t = (z - ray.origin.z) / dz;
    if (t < 0) return null;
    return (out || new THREE.Vector3()).copy(ray.origin).addScaledVector(ray.direction, t);
  };
  // 画面上の1単位あたりの画素（ある点の近く）
  S.pxPerUnit = function (p) {
    var d = S.camera.position.distanceTo(p);
    var hh = d * Math.tan(THREE.MathUtils.degToRad(S.camera.fov / 2));
    return S.h / (2 * hh);
  };
})();
