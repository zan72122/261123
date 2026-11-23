// world.js — 描画の土台：レンダラ、カメラ、窓辺の光、木の机、浅い盆、紙粉
(function () {
  'use strict';
  const S = window.S23;
  const W = (S.world = {});

  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  stage.appendChild(renderer.domElement);
  W.renderer = renderer;
  W.canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd8cdbb);
  scene.fog = new THREE.Fog(0xd8cdbb, 160, 420);
  W.scene = scene;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
  camera.position.set(0, 90, 80);
  W.camera = camera;
  W.width = 1; W.height = 1;

  // ---- 光 ----
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x8a6b4a, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 260;
  scene.add(sun); scene.add(sun.target);
  W.sun = sun;
  const fill = new THREE.DirectionalLight(0xe8eeff, 0.45);
  fill.position.set(40, 60, 120);
  scene.add(fill);
  // 窓からの柔らかなはね返り
  const bounce = new THREE.PointLight(0xfff1dc, 900, 260, 1.6);
  bounce.position.set(-30, 70, -40);
  scene.add(bounce);

  // 光はゆっくり机の上を渡る
  W.sunPhase = S.rand() * S.TAU;
  function updateSun(t) {
    const a = W.sunPhase + t * 0.045;
    const az = -0.62 + Math.sin(a) * 0.16;
    const el = 0.92 + Math.sin(a * 0.7 + 1.3) * 0.06;
    const r = 150;
    sun.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r);
    sun.target.position.set(0, 0, 4);
  }

  // ---- 木の机 ----
  const deskMat = new THREE.MeshStandardMaterial({
    map: S.TX.wood(), bumpMap: S.TX.woodBump(), bumpScale: 0.6, roughness: 0.62, metalness: 0.0,
  });
  const deskGeo = new THREE.BoxGeometry(200, 5, 120);
  // 天板の UV を cm 単位に
  {
    const pos = deskGeo.attributes.position, uv = deskGeo.attributes.uv, nrm = deskGeo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ny = Math.abs(nrm.getY(i)), nx = Math.abs(nrm.getX(i));
      if (ny > 0.5) uv.setXY(i, x, z);
      else if (nx > 0.5) uv.setXY(i, z, y);
      else uv.setXY(i, x, y);
    }
  }
  const desk = new THREE.Mesh(deskGeo, deskMat);
  desk.position.set(0, -2.5, -5);
  desk.receiveShadow = true;
  scene.add(desk);
  W.desk = desk;
  S.physics.addStatic({ c: new THREE.Vector3(0, -2.5, -5), h: new THREE.Vector3(100, 2.5, 60), tag: 'desk', mu: 0.5, e: 0.12 });
  // 机の脚の気配（奥の方）
  const legMat = new THREE.MeshStandardMaterial({ color: 0x9a7350, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(6, 70, 6), legMat);
    leg.position.set(sx * 92, -40, -60);
    scene.add(leg);
  }

  // ---- 窓のある壁 ----
  const wallMat = new THREE.MeshStandardMaterial({ map: S.TX.plaster(), roughness: 0.95 });
  const wallZ = -66;
  const winX0 = -70, winX1 = 30, winY0 = 18, winY1 = 120;
  function wallPiece(x0, x1, y0, y1) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + (x0 + x1) / 2, pos.getY(i) + (y0 + y1) / 2);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, wallZ);
    m.receiveShadow = true;
    scene.add(m);
  }
  wallPiece(-260, winX0, -80, 220);
  wallPiece(winX1, 260, -80, 220);
  wallPiece(winX0, winX1, -80, winY0);
  wallPiece(winX0, winX1, winY1, 220);
  // 窓の外の明るさ（光源としての発光面。絵は描かない）
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xfff8ea, fog: false });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(winX1 - winX0, winY1 - winY0), skyMat);
  sky.position.set((winX0 + winX1) / 2, (winY0 + winY1) / 2, wallZ - 6);
  scene.add(sky);
  // 窓枠（立体）
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.55 });
  function frameBar(cx, cy, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(cx, cy, wallZ - 1.5);
    m.castShadow = true;
    scene.add(m);
  }
  frameBar((winX0 + winX1) / 2, winY0 + 1.5, winX1 - winX0 + 6, 3, 5);
  frameBar((winX0 + winX1) / 2, winY1 - 1.5, winX1 - winX0 + 6, 3, 5);
  frameBar(winX0 + 1.5, (winY0 + winY1) / 2, 3, winY1 - winY0, 5);
  frameBar(winX1 - 1.5, (winY0 + winY1) / 2, 3, winY1 - winY0, 5);
  frameBar((winX0 + winX1) / 2, (winY0 + winY1) / 2, 2.2, winY1 - winY0, 4);
  frameBar((winX0 + winX1) / 2, (winY0 + winY1) / 2 + 8, winX1 - winX0, 2.2, 4);
  // 窓台
  const sill = new THREE.Mesh(new THREE.BoxGeometry(winX1 - winX0 + 14, 2.5, 10), frameMat);
  sill.position.set((winX0 + winX1) / 2, winY0 - 1.2, wallZ + 3);
  sill.receiveShadow = true; sill.castShadow = true;
  scene.add(sill);

  // ---- 浅い盆 ----
  const TRAY = (W.TRAY = { x0: -31, x1: 5, z0: 13.6, z1: 29.4, rim: 1.5, base: 0.6, wall: 0.8 });
  const trayMat = new THREE.MeshStandardMaterial({ map: S.TX.woodLight(), roughness: 0.55, color: 0xf6efe4 });
  const trayGroup = new THREE.Group();
  scene.add(trayGroup);
  W.trayParts = [];
  function trayBox(cx, cy, cz, sx, sy, sz) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz;
      if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, x, z); else if (Math.abs(nrm.getX(i)) > 0.5) uv.setXY(i, z, y); else uv.setXY(i, x, y);
    }
    const m = new THREE.Mesh(g, trayMat);
    m.position.set(cx, cy, cz);
    m.castShadow = true; m.receiveShadow = true;
    trayGroup.add(m);
    W.trayParts.push({ cx, cy, cz, sx, sy, sz });
    S.physics.addStatic({ c: new THREE.Vector3(cx, cy, cz), h: new THREE.Vector3(sx / 2, sy / 2, sz / 2), tag: 'tray', mu: 0.5, e: 0.1 });
  }
  {
    const t = TRAY, cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, lx = t.x1 - t.x0, lz = t.z1 - t.z0;
    trayBox(cx, t.base / 2, cz, lx, t.base, lz);
    trayBox(cx, t.rim / 2, t.z0 + t.wall / 2, lx, t.rim, t.wall);
    trayBox(cx, t.rim / 2, t.z1 - t.wall / 2, lx, t.rim, t.wall);
    trayBox(t.x0 + t.wall / 2, t.rim / 2, cz, t.wall, t.rim, lz - 2 * t.wall);
    trayBox(t.x1 - t.wall / 2, t.rim / 2, cz, t.wall, t.rim, lz - 2 * t.wall);
  }

  // ---- 紙粉（ごく少量） ----
  const DUST_N = 90;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_N * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcaa476, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  const dustP = [];
  for (let i = 0; i < DUST_N; i++) { dustP.push({ life: 0, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, floor: 0 }); dustPos[i * 3 + 1] = -100; }
  let dustIdx = 0;
  W.dust = function (p, count, spread, floorY) {
    for (let k = 0; k < count; k++) {
      const d = dustP[dustIdx]; dustIdx = (dustIdx + 1) % DUST_N;
      d.life = 2.5 + S.rand() * 1.5;
      d.x = p.x + (S.rand() - 0.5) * spread; d.y = p.y + (S.rand() - 0.5) * 0.3; d.z = p.z + (S.rand() - 0.5) * spread * 0.4;
      d.vx = (S.rand() - 0.5) * 3; d.vy = S.rand() * 2; d.vz = (S.rand() - 0.5) * 3;
      d.floor = floorY == null ? S.DIM.FLOOR_Y : floorY;
    }
  };
  function updateDust(dt) {
    for (let i = 0; i < DUST_N; i++) {
      const d = dustP[i];
      if (d.life <= 0) { dustPos[i * 3 + 1] = -100; continue; }
      d.life -= dt;
      if (d.y > d.floor + 0.05) {
        d.vy -= 60 * dt; d.vy *= 0.9; d.vx *= 0.94; d.vz *= 0.94; // ひらひら
        d.vx += Math.sin(d.life * 9 + i) * 4 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < d.floor + 0.05) d.y = d.floor + 0.05;
      }
      dustPos[i * 3] = d.x; dustPos[i * 3 + 1] = d.life > 0 ? d.y : -100; dustPos[i * 3 + 2] = d.z;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // ---- カメラの動き ----
  const rig = (W.rig = {
    pos: camera.position.clone(),
    tgt: new THREE.Vector3(0, 0, 0),
    wantPos: camera.position.clone(),
    wantTgt: new THREE.Vector3(0, 0, 0),
    fov: 42, wantFov: 42,
    rate: 2.2,
    hold: false,          // ドラッグ中は動かさない
    pin: null,            // { world, sx, sy } 指の下に物を保つ補正
  });
  // 中心と半径が画面に収まるカメラ位置を求める
  W.frameView = function (center, radius, elevDeg, azimDeg, fov, outPos) {
    const aspect = W.width / W.height;
    const vh = (fov * S.DEG) / 2;
    const hh = Math.atan(Math.tan(vh) * aspect);
    const half = Math.min(vh, hh);
    const dist = radius / Math.sin(half);
    const el = elevDeg * S.DEG, az = azimDeg * S.DEG;
    outPos.set(center.x + Math.sin(az) * Math.cos(el) * dist, center.y + Math.sin(el) * dist, center.z + Math.cos(az) * Math.cos(el) * dist);
    return outPos;
  };
  W.setView = function (pos, tgt, fov, rate) {
    rig.wantPos.copy(pos); rig.wantTgt.copy(tgt);
    if (fov) rig.wantFov = fov;
    rig.rate = rate || 2.2;
  };
  W.snapView = function () { rig.pos.copy(rig.wantPos); rig.tgt.copy(rig.wantTgt); rig.fov = rig.wantFov; };

  const _sp = { x: 0, y: 0, z: 0 }, _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3();
  function updateCamera(dt) {
    if (!rig.hold) {
      const k = 1 - Math.exp(-rig.rate * dt);
      rig.pos.lerp(rig.wantPos, k);
      rig.tgt.lerp(rig.wantTgt, k);
      rig.fov += (rig.wantFov - rig.fov) * k;
    }
    camera.position.copy(rig.pos);
    camera.fov = rig.fov;
    camera.updateProjectionMatrix();
    // 指の下の物が外れないよう、見る点をずらして向きを補正（ねじれは生じない）
    for (let it = 0; it < (rig.pin ? 4 : 1); it++) {
      camera.lookAt(rig.tgt);
      camera.updateMatrixWorld();
      if (!rig.pin) break;
      const p = rig.pin;
      S.toScreen(camera, p.world, W.width, W.height, _sp);
      const ex = _sp.x - p.sx, ey = _sp.y - p.sy;
      if (Math.abs(ex) + Math.abs(ey) < 0.5) break;
      const dT = camera.position.distanceTo(rig.tgt);
      const dL = Math.max(1, camera.position.distanceTo(p.world));
      const wpp = (2 * dT * Math.tan((camera.fov * S.DEG) / 2)) / W.height;
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      const g = 0.9 * (dT / dL) * (dL / dT);
      rig.tgt.addScaledVector(_right, ex * wpp * g).addScaledVector(_up, -ey * wpp * g);
    }
    void _fw;
  }

  function resize() {
    const w = stage.clientWidth || window.innerWidth, h = stage.clientHeight || window.innerHeight;
    W.width = w; W.height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    S.events.emit('resize', w, h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();

  W.time = 0;
  W.update = function (dt) {
    W.time += dt;
    updateSun(W.time);
    updateDust(dt);
    updateCamera(dt);
  };
  W.render = function () {
    renderer.autoClear = true;
    renderer.render(scene, camera);
  };
  W.isPortrait = () => W.height > W.width;
})();
