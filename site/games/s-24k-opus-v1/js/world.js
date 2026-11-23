/* world.js — レンダラ・光・窓辺の部屋・作業台。材質の共通定義もここ。 */
(function () {
  'use strict';
  const G = window.G;
  const W = (G.world = {});

  function canvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    if (!c || !c.getContext) return null;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    return { c, ctx };
  }
  G.canvas = canvas;

  // 木目のテクスチャ（材質の色むら。形は全て立体モデルで作る）
  function woodTexture(seed, base, dark, rings) {
    const cv = canvas(512, 512);
    if (!cv) return null;
    const { c, ctx } = cv;
    const rng = G.makeRng(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, 512, 512);
    const img = ctx.getImageData(0, 0, 512, 512);
    const d = img.data;
    const ph = [];
    for (let k = 0; k < 6; k++) ph.push([rng() * 6.28, 0.5 + rng() * 2.5, rng() * 0.6]);
    const bc = hexRgb(base), dc = hexRgb(dark);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        let w = y / 512 * rings;
        for (let k = 0; k < ph.length; k++) w += Math.sin(x / 512 * 6.283 * ph[k][1] + ph[k][0] + y * 0.004) * ph[k][2];
        let g = 0.5 + 0.5 * Math.sin(w * 6.283);
        g = Math.pow(g, 3.0);
        const fine = (rng() - 0.5) * 0.08;
        const t = Math.max(0, Math.min(1, g * 0.55 + fine + 0.05));
        const i = (y * 512 + x) * 4;
        d[i] = bc[0] + (dc[0] - bc[0]) * t;
        d[i + 1] = bc[1] + (dc[1] - bc[1]) * t;
        d[i + 2] = bc[2] + (dc[2] - bc[2]) * t;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }
  function hexRgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // 釉薬のむら（皿）
  function glazeTexture(seed) {
    const cv = canvas(256, 256);
    if (!cv) return null;
    const { c, ctx } = cv;
    const rng = G.makeRng(seed);
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = rng() * 256, y = rng() * 256, r = 2 + rng() * 14;
      ctx.fillStyle = 'rgba(' + (200 + rng() * 30 | 0) + ',' + (205 + rng() * 25 | 0) + ',' + (200 + rng() * 25 | 0) + ',' + (0.05 + rng() * 0.08) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    // 呉須の細い筋（皿の向きが見えるように一か所だけ）
    ctx.strokeStyle = 'rgba(70,98,140,0.55)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(10, 200); ctx.bezierCurveTo(70, 186, 130, 214, 246, 196); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(70,98,140,0.35)';
    ctx.beginPath(); ctx.moveTo(20, 214); ctx.bezierCurveTo(90, 204, 160, 226, 240, 212); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  W.init = function (renderer) {
    const scene = (W.scene = new THREE.Scene());
    scene.background = new THREE.Color(0xe9e2d6);
    W.renderer = renderer;

    // ---- 材質 ----
    const mats = (W.mats = {});
    const texTable = woodTexture(11, '#b88d5e', '#7d5634', 22);
    const texLight = woodTexture(23, '#d9b98a', '#a57f52', 30);
    const texBoard = woodTexture(37, '#c9a273', '#8e6a43', 18);
    const texDark = woodTexture(41, '#9a6d43', '#5b3c22', 26);
    W.tex = { table: texTable, light: texLight, board: texBoard, dark: texDark, glaze: glazeTexture(5) };
    const wood = (tex, color, rough, rep) => {
      const m = new THREE.MeshStandardMaterial({ color: color, roughness: rough, metalness: 0 });
      if (tex) { m.map = tex.clone(); m.map.needsUpdate = true; if (rep) m.map.repeat.set(rep[0], rep[1]); }
      return m;
    };
    mats.table = wood(texTable, 0xffffff, 0.78, [3, 2]);
    mats.woodLight = wood(texLight, 0xffffff, 0.66, [1, 1]);
    mats.woodTube = wood(texLight, 0xf3e6cf, 0.62, [1, 0.4]);
    mats.woodDark = wood(texDark, 0xffffff, 0.6, [1, 1]);
    mats.tray = wood(texDark, 0xe8d2b8, 0.55, [2, 2]);
    mats.board = wood(texBoard, 0xffffff, 0.5, [1, 1]);
    mats.boardWet = new THREE.MeshPhysicalMaterial({ color: 0xa88562, roughness: 0.18, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12, transparent: true, opacity: 0.0, depthWrite: false });
    mats.wire = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.22, metalness: 0.95 });
    mats.thread = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35, metalness: 0.3 });
    mats.acrylic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: THREE.DoubleSide });
    mats.agar = new THREE.MeshPhysicalMaterial({
      color: 0xf6ecd2, roughness: 0.1, metalness: 0, transmission: 1, thickness: 2.5, ior: 1.34,
      attenuationColor: new THREE.Color(0xe3b567), attenuationDistance: 7.5, clearcoat: 0.5, clearcoatRoughness: 0.08,
      specularIntensity: 1, envMapIntensity: 1.1,
    });
    mats.strand = new THREE.MeshPhysicalMaterial({
      color: 0xf8f0da, roughness: 0.09, metalness: 0, transmission: 1, thickness: 0.9, ior: 1.34,
      attenuationColor: new THREE.Color(0xe8c17a), attenuationDistance: 3.2, clearcoat: 0.6, clearcoatRoughness: 0.06,
      specularIntensity: 1, envMapIntensity: 1.15,
    });
    mats.bubble = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 1.0, envMapIntensity: 2.2 });
    mats.plate = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.24, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.1 });
    if (W.tex.glaze) mats.plate.map = W.tex.glaze;
    mats.plateFoot = new THREE.MeshStandardMaterial({ color: 0xc9ab86, roughness: 0.92, metalness: 0 });
    mats.pitcher = new THREE.MeshPhysicalMaterial({ color: 0x6f4a33, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15 });
    mats.pitcherIn = new THREE.MeshPhysicalMaterial({ color: 0xd9cdb6, roughness: 0.28, clearcoat: 0.6 });
    mats.tsuyu = new THREE.MeshPhysicalMaterial({ color: 0x3b1f0e, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1 });
    mats.water = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 });
    mats.drop = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transmission: 1, thickness: 0.4, ior: 1.33, attenuationColor: new THREE.Color(0x5a2c0f), attenuationDistance: 0.35 });
    mats.splash = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transmission: 1, thickness: 0.2, ior: 1.33 });
    mats.sesame = new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.55, metalness: 0 });
    mats.wall = new THREE.MeshStandardMaterial({ color: 0xefe7da, roughness: 0.95 });
    mats.windowFrame = new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.6 });
    mats.sky = new THREE.MeshBasicMaterial({ vertexColors: true });
    mats.felt = new THREE.MeshStandardMaterial({ color: 0x8d6d4f, roughness: 1 });
    mats.ghost = new THREE.MeshStandardMaterial({ color: 0xfff6ee, roughness: 0.6, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false });

    // ---- 光 ----
    W.sunDir = new THREE.Vector3(0.8, -0.75, 0.2).normalize();
    const sun = (W.sun = new THREE.DirectionalLight(0xfff1dc, 2.6));
    sun.position.copy(W.sunDir).multiplyScalar(-160).add(new THREE.Vector3(10, 0, 4));
    sun.target.position.set(10, 0, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 52; sc.bottom = -52; sc.near = 40; sc.far = 320;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target);
    W.hemi = new THREE.HemisphereLight(0xfff8ec, 0x8a6a4a, 0.95);
    scene.add(W.hemi);
    const fill = (W.fill = new THREE.DirectionalLight(0xe6eeff, 0.35));
    fill.position.set(60, 50, 120); scene.add(fill);

    buildRoom(scene);
    buildEnv(renderer, scene);
    return scene;
  };

  function buildRoom(scene) {
    const mats = W.mats;
    const T = G.L.TABLE;
    // 低い作業台
    const top = new THREE.Mesh(new THREE.BoxGeometry(T.x1 - T.x0, 3.2, T.z1 - T.z0), mats.table);
    top.position.set((T.x0 + T.x1) / 2, -1.6, (T.z0 + T.z1) / 2);
    top.receiveShadow = true; top.castShadow = true;
    scene.add(top);
    // 天板の縁の面取り
    const edge = new THREE.Mesh(new THREE.BoxGeometry(T.x1 - T.x0 + 0.4, 0.6, 0.8), mats.woodDark);
    edge.position.set((T.x0 + T.x1) / 2, -0.4, T.z1 + 0.2); edge.receiveShadow = true;
    scene.add(edge);
    // 脚
    for (const sx of [T.x0 + 6, T.x1 - 6]) for (const sz of [T.z0 + 6, T.z1 - 6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(6, 36, 6), mats.woodDark);
      leg.position.set(sx, -21, sz); leg.castShadow = true; scene.add(leg);
    }
    // 床
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0xcbb69a, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -39; floor.receiveShadow = true; scene.add(floor);

    // 後ろの壁と窓
    const wallZ = -46;
    const winX0 = -78, winX1 = 18, winY0 = 18, winY1 = 96;
    const wallMat = mats.wall;
    const addWall = (x0, x1, y0, y1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 4), wallMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, wallZ - 2); m.receiveShadow = true; scene.add(m);
    };
    addWall(-300, winX0, -40, 200); addWall(winX1, 300, -40, 200);
    addWall(winX0, winX1, -40, winY0); addWall(winX0, winX1, winY1, 200);
    // 窓の外：明るい空の面（光源として振る舞う）
    const skyG = new THREE.PlaneGeometry(winX1 - winX0 + 20, winY1 - winY0 + 20, 1, 8);
    const col = [];
    const pos = skyG.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) / (winY1 - winY0 + 20)) + 0.5;
      const c = new THREE.Color().setRGB(1.6 - 0.25 * t, 1.62 - 0.12 * t, 1.55 + 0.1 * t);
      col.push(c.r, c.g, c.b);
    }
    skyG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sky = new THREE.Mesh(skyG, mats.sky);
    sky.position.set((winX0 + winX1) / 2, (winY0 + winY1) / 2, wallZ - 30);
    scene.add(sky);
    // 窓枠と桟
    const frameBar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.windowFrame);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    };
    const cx = (winX0 + winX1) / 2;
    frameBar(winX1 - winX0 + 4, 3, 6, cx, winY0 - 1.5, wallZ + 1);   // 窓台
    frameBar(winX1 - winX0 + 4, 2.4, 5, cx, winY1 + 1.2, wallZ);
    frameBar(2.4, winY1 - winY0, 5, winX0 - 1.2, (winY0 + winY1) / 2, wallZ);
    frameBar(2.4, winY1 - winY0, 5, winX1 + 1.2, (winY0 + winY1) / 2, wallZ);
    frameBar(1.6, winY1 - winY0, 3, cx, (winY0 + winY1) / 2, wallZ - 1);
    frameBar(winX1 - winX0, 1.4, 3, cx, winY0 + (winY1 - winY0) * 0.52, wallZ - 1);
    // ガラス
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winX1 - winX0, winY1 - winY0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.02, depthWrite: false }));
    glass.position.set(cx, (winY0 + winY1) / 2, wallZ - 1.2); scene.add(glass);
    // 窓台の上の小さな素焼きの鉢（無銘の台所の小物）
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.5, 5, 24), new THREE.MeshStandardMaterial({ color: 0xb8794f, roughness: 0.9 }));
    pot.position.set(-58, winY0 + 2.5, wallZ + 2); pot.castShadow = true; scene.add(pot);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }));
    soil.position.set(-58, winY0 + 4.8, wallZ + 2); scene.add(soil);
    for (let i = 0; i < 6; i++) {
      const lf = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5d8a4a, roughness: 0.7 }));
      const a = i / 6 * 6.283;
      lf.scale.set(1, 0.35, 2.2);
      lf.position.set(-58 + Math.cos(a) * 1.8, winY0 + 7 + (i % 2) * 1.2, wallZ + 2 + Math.sin(a) * 1.8);
      lf.rotation.y = -a; lf.rotation.x = 0.5;
      lf.castShadow = true; scene.add(lf);
    }
  }

  // 反射用の環境（窓の光の映り込み）
  function buildEnv(renderer, scene) {
    if (!renderer || !renderer.isWebGLRenderer) return;
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(400, 220, 400), new THREE.MeshBasicMaterial({ color: 0xb9ab98, side: THREE.BackSide }));
    room.position.y = 60; env.add(room);
    const floorE = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x7a5d43 }));
    floorE.rotation.x = -Math.PI / 2; floorE.position.y = -40; env.add(floorE);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(150, 100), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.6, 8) }));
    win.position.set(-50, 70, -190); env.add(win);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 100, 2), new THREE.MeshBasicMaterial({ color: 0x9f9588 }));
    bar.position.set(-50, 70, -188); env.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(150, 3, 2), new THREE.MeshBasicMaterial({ color: 0x9f9588 }));
    bar2.position.set(-50, 72, -188); env.add(bar2);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.45) }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(20, 168, 0); env.add(ceil);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.3, 2.1) }));
    side.rotation.y = Math.PI / 2; side.position.set(-198, 60, 40); env.add(side);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.03);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.75;
    pm.dispose();
  }

  // 窓の光のかすかな揺れ（濡れた面の光が揺れる）
  W.update = function (dt, t) {
    const s = Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.91 + 1.3) * 0.3 + Math.sin(t * 2.3) * 0.1;
    W.sun.intensity = 2.6 + s * 0.08;
    const d = W.sunDir;
    W.sun.position.set(-d.x * 160 + 10 + s * 0.8, -d.y * 160, -d.z * 160 + 4 + Math.sin(t * 0.21) * 1.2);
    if (W.scene.environment) W.scene.environmentRotation && W.scene.environmentRotation.set(0, Math.sin(t * 0.13) * 0.03, 0);
  };
})();
