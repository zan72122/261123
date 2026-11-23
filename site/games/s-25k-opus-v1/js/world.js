// world.js — 窓の光、縁の丸い作業台、コルク板、支柱、くぼみ、受け皿、脇のフェルト
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C, G = KK.geom;
  var W = (KK.world = {});

  // 配置（奥 = −z、手前 = +z）
  W.L = {
    pillar: { x: -19, z: -15, r: 1.05, h: 22 },
    dimple: { x: -14.5, z: -9.2, r: 2.3, h: 1.5, depth: 0.45, cupR: 1.3 },
    tray: { x: 14.3, z: 4, yaw: 0, hl: 11, hw: 6.5, rim: 0.8, rimH: 1.65, floor: 0.5 },
    mat: { x: -8.5, z: 13.2, w: 30, d: 15, t: 0.28 }
  };

  W.mats = {};

  W.makeMaterials = function () {
    var tx = KK.tex, M = W.mats;
    M.wood = new T.MeshPhysicalMaterial({
      map: tx.wood, bumpMap: tx.woodBump, bumpScale: 0.6, roughness: 0.52, clearcoat: 0.35, clearcoatRoughness: 0.45,
      color: 0xffffff
    });
    M.wood2 = new T.MeshPhysicalMaterial({
      map: tx.wood2, bumpMap: tx.wood2Bump, bumpScale: 0.6, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5
    });
    M.walnut = new T.MeshPhysicalMaterial({
      map: tx.walnut, bumpMap: tx.walnutBump, bumpScale: 0.5, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12
    });
    M.endGrain = new T.MeshStandardMaterial({ color: 0xc89f72, roughness: 0.7 });
    M.metal = new T.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.32, metalness: 0.85 });
    M.table = new T.MeshStandardMaterial({ map: tx.table, bumpMap: tx.tableBump, bumpScale: 0.8, roughness: 0.62 });
    M.cork = new T.MeshStandardMaterial({ map: tx.cork.map, bumpMap: tx.cork.bump, bumpScale: 1.2, roughness: 0.95, color: 0xffffff });
    M.matFelt = new T.MeshPhysicalMaterial({
      map: tx.felt.map, roughness: 1.0, sheen: 1.0, sheenRoughness: 0.75, sheenColor: new T.Color(0xa9c0a4)
    });
    M.pad = new T.MeshPhysicalMaterial({ color: 0x6c5a4c, roughness: 1, sheen: 0.8, sheenRoughness: 0.8, sheenColor: new T.Color(0xa89482) });
    M.wall = new T.MeshStandardMaterial({ map: tx.wall, roughness: 0.95 });
    M.ghost = new T.MeshPhysicalMaterial({
      color: 0xfff0e6, roughness: 0.35, transparent: true, opacity: 0.32, depthWrite: false, clearcoat: 0.6
    });
    // 木目の向きと細かさを形ごとに変えた素材
    M.frame = W.woodVariant(M.wood2, 1 / 22, 1 / 22, 0);
    M.trayWood = W.woodVariant(M.wood, 1 / 16, 1 / 16, 0);
    M.column = W.woodVariant(M.wood, 1, 1.6, Math.PI / 2);
    M.column2 = W.woodVariant(M.wood2, 1, 1.4, Math.PI / 2);
    M.block = W.woodVariant(M.wood2, 1 / 6, 1 / 6, 0);
    // 地の UV が座標そのままなので繰り返しを小さく
    tx.table.repeat.set(1 / 70, 1 / 70); tx.tableBump.repeat.set(1 / 70, 1 / 70);
    tx.cork.map.repeat.set(1 / 14, 1 / 14); tx.cork.bump.repeat.set(1 / 14, 1 / 14);
  };

  W.woodVariant = function (base, rx, ry, rot) {
    var m = base.clone();
    ['map', 'bumpMap'].forEach(function (k) {
      if (!base[k]) return;
      var t = base[k].clone();
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(rx, ry); t.rotation = rot || 0; t.center.set(0.5, 0.5);
      t.needsUpdate = true;
      m[k] = t;
    });
    return m;
  };

  W.init = function (canvas) {
    var scene = (W.scene = new T.Scene());
    scene.background = new T.Color(0x3a2c22);
    W.makeMaterials();

    if (!KK.headless) {
      var r = (W.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFShadowMap;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      r.outputColorSpace = T.SRGBColorSpace;
      buildEnv(r, scene);
    }
    buildLights(scene);
    buildRoom(scene);
    buildTable(scene);
    buildBoard(scene);
    buildPillar(scene);
    buildDimple(scene);
    buildTray(scene);
    buildMat(scene);
  };

  // 窓のある部屋の映り込み（PMREM）
  function buildEnv(renderer, scene) {
    var env = new T.Scene();
    var room = new T.Mesh(new T.BoxGeometry(200, 120, 200), new T.MeshBasicMaterial({ color: 0x5a4636, side: T.BackSide }));
    room.position.y = 40; env.add(room);
    var floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshBasicMaterial({ color: 0x3b2a1e }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -15; env.add(floor);
    // 窓（左手）
    var win = new T.Mesh(new T.PlaneGeometry(70, 50), new T.MeshBasicMaterial({ color: 0xfff3dc }));
    win.position.set(-99, 45, -20); win.rotation.y = Math.PI / 2; env.add(win);
    // 窓の桟
    var barM = new T.MeshBasicMaterial({ color: 0x4a3a2c });
    var b1 = new T.Mesh(new T.PlaneGeometry(2.5, 50), barM); b1.position.set(-98.5, 45, -20); b1.rotation.y = Math.PI / 2; env.add(b1);
    var b2 = new T.Mesh(new T.PlaneGeometry(70, 2.5), barM); b2.position.set(-98.5, 45, -20); b2.rotation.y = Math.PI / 2; env.add(b2);
    // 天井の柔らかい明かり
    var ceil = new T.Mesh(new T.PlaneGeometry(120, 120), new T.MeshBasicMaterial({ color: 0x8a7562 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 99; env.add(ceil);
    var pm = new T.PMREMGenerator(renderer);
    var rt = pm.fromScene(env, 0.035);
    scene.environment = rt.texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  function buildLights(scene) {
    var sun = (W.sun = new T.DirectionalLight(0xfff1dc, 3.1));
    sun.position.set(-66, 44, -22);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    var sh = sun.shadow;
    sh.mapSize.set(2048, 2048);
    var cam = sh.camera;
    cam.left = -48; cam.right = 48; cam.top = 40; cam.bottom = -40; cam.near = 10; cam.far = 170;
    sh.bias = -0.0004; sh.normalBias = 0.03; sh.radius = 2.5;
    scene.add(sun); scene.add(sun.target);
    W.sunDir = new T.Vector3().subVectors(sun.target.position, sun.position).normalize();

    var hemi = new T.HemisphereLight(0xfff2e2, 0x5c4332, 0.55);
    scene.add(hemi);
    // 窓と反対側からのごく弱い返し
    var bounce = new T.DirectionalLight(0xffd8b0, 0.35);
    bounce.position.set(50, 30, 40);
    scene.add(bounce);
  }

  function buildRoom(scene) {
    var M = W.mats;
    var wall = new T.Mesh(new T.PlaneGeometry(420, 200), M.wall);
    wall.position.set(0, 40, -130);
    scene.add(wall);
    var side = new T.Mesh(new T.PlaneGeometry(320, 200), M.wall);
    side.position.set(160, 40, 0); side.rotation.y = -Math.PI / 2;
    scene.add(side);
    var floor = new T.Mesh(new T.PlaneGeometry(500, 500), new T.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -70;
    scene.add(floor);
  }

  function roundedRectShape(w, d, r) {
    var s = new T.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  W.roundedRectShape = roundedRectShape;

  function buildTable(scene) {
    var M = W.mats;
    var top = -C.BOARD_T;
    var w = C.TABLE_X * 2, d = C.TABLE_Z * 2;
    var slabShape = roundedRectShape(w, d, 6);
    var slab = new T.Mesh(new T.ExtrudeGeometry(slabShape, {
      depth: 4.2, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.4, bevelSegments: 5, curveSegments: 8
    }), M.table);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = top - 4.2 - 1.4;
    slab.receiveShadow = true;
    scene.add(slab);
    // 縁の丸い立ち上がり
    var outer = roundedRectShape(w - 1.0, d - 1.0, 5.5);
    var hole = roundedRectShape(w - 4.6, d - 4.6, 4);
    outer.holes.push(hole);
    var lip = new T.Mesh(new T.ExtrudeGeometry(outer, {
      depth: 0.4, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.7, bevelSegments: 5, curveSegments: 8
    }), M.table);
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = top;
    lip.castShadow = true; lip.receiveShadow = true;
    scene.add(lip);
    W.tableTop = top;
    W.tableInnerX = (w - 4.6) / 2 - 1.2;
    W.tableInnerZ = (d - 4.6) / 2 - 1.2;
    // 脚（下に少しだけ見える）
    var legM = M.table;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
      var leg = new T.Mesh(new T.BoxGeometry(6, 64, 6), legM);
      leg.position.set(s[0] * (C.TABLE_X - 8), top - 38, s[1] * (C.TABLE_Z - 8));
      scene.add(leg);
    });
  }

  function buildBoard(scene) {
    var M = W.mats;
    var s = roundedRectShape(C.BOARD_X * 2, C.BOARD_Z * 2, 1.6);
    var board = new T.Mesh(new T.ExtrudeGeometry(s, {
      depth: C.BOARD_T - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 2, curveSegments: 6
    }), M.cork);
    board.rotation.x = -Math.PI / 2;
    board.position.y = -C.BOARD_T + 0.08;
    board.receiveShadow = true;
    scene.add(board);
    // コルクを囲む細い木の枠（玉が板から転げ落ちない）
    var fw = W.FRAME_W, fh = W.FRAME_H;
    var outer = roundedRectShape(C.BOARD_X * 2 + 0.2, C.BOARD_Z * 2 + 0.2, 1.7);
    outer.holes.push(roundedRectShape((C.BOARD_X - fw) * 2, (C.BOARD_Z - fw) * 2, 0.6));
    var frame = new T.Mesh(new T.ExtrudeGeometry(outer, {
      depth: fh + C.BOARD_T - 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.22, bevelSegments: 4, curveSegments: 6
    }), M.frame);
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = -C.BOARD_T + 0.25;
    frame.castShadow = true; frame.receiveShadow = true;
    scene.add(frame);
  }
  W.FRAME_W = 1.2; W.FRAME_H = 0.85;

  function buildPillar(scene) {
    var M = W.mats, P = W.L.pillar;
    var g = new T.Group();
    g.position.set(P.x, 0, P.z);
    var foot = new T.Mesh(G.roundBox(5.4, 1.0, 5.4, 0.8), M.block);
    foot.castShadow = foot.receiveShadow = true; g.add(foot);
    var pad = new T.Mesh(new T.CylinderGeometry(2.4, 2.4, 0.12, 24), M.pad);
    pad.position.y = 0.04; g.add(pad);
    var col = new T.Mesh(new T.CylinderGeometry(P.r, P.r * 1.06, P.h, 28), M.column);
    col.position.y = P.h / 2 + 0.9;
    col.castShadow = col.receiveShadow = true; g.add(col);
    var cap = new T.Mesh(new T.SphereGeometry(P.r * 1.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.wood);
    cap.position.y = P.h + 0.9; cap.castShadow = true; g.add(cap);
    // 目盛りの代わりの浅い溝（木の輪）
    for (var i = 1; i < 6; i++) {
      var ring = new T.Mesh(new T.TorusGeometry(P.r * 1.02, 0.05, 6, 28), M.endGrain);
      ring.rotation.x = Math.PI / 2; ring.position.y = 3 + i * 3.2; g.add(ring);
    }
    scene.add(g);
    W.pillar = g;
  }

  function buildDimple(scene) {
    var M = W.mats, D = W.L.dimple;
    var pts = [];
    var Rc = (D.cupR * D.cupR + D.depth * D.depth) / (2 * D.depth);
    pts.push(new T.Vector2(0.001, D.h - D.depth));
    for (var i = 1; i <= 10; i++) {
      var x = (i / 10) * D.cupR;
      var y = D.h - D.depth + (Rc - Math.sqrt(Rc * Rc - x * x));
      pts.push(new T.Vector2(x, y));
    }
    pts.push(new T.Vector2(D.cupR + 0.15, D.h + 0.02));
    pts.push(new T.Vector2(D.r - 0.25, D.h));
    pts.push(new T.Vector2(D.r - 0.02, D.h - 0.2));
    pts.push(new T.Vector2(D.r, D.h - 0.45));
    pts.push(new T.Vector2(D.r, 0.15));
    pts.push(new T.Vector2(D.r - 0.12, 0));
    pts.push(new T.Vector2(0.001, 0));
    pts.reverse();
    var m = new T.Mesh(new T.LatheGeometry(pts, 32), M.wood2);
    m.position.set(D.x, 0, D.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    W.dimple = m;
    W.dimpleRest = new T.Vector3(D.x, D.h - D.depth + C.R, D.z);
  }

  function buildTray(scene) {
    var M = W.mats, L = W.L.tray;
    var g = (W.tray = new T.Group());
    g.position.set(L.x, 0, L.z); g.rotation.y = L.yaw;
    var outer = G.stadiumShape(L.hl, L.hw);
    var base = new T.Mesh(new T.ExtrudeGeometry(outer, {
      depth: L.floor - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 20
    }), M.trayWood);
    base.rotation.x = -Math.PI / 2; base.position.y = 0.05;
    base.castShadow = base.receiveShadow = true; g.add(base);
    var ring = G.stadiumShape(L.hl, L.hw);
    ring.holes.push(G.stadiumShape(L.hl - L.rim, L.hw - L.rim));
    var rim = new T.Mesh(new T.ExtrudeGeometry(ring, {
      depth: L.rimH - 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 4, curveSegments: 28
    }), M.trayWood);
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.25;
    rim.castShadow = rim.receiveShadow = true; g.add(rim);
    // フェルト面（felt.js が描き込む）
    var felt = new T.Mesh(new T.ShapeGeometry(G.stadiumShape(L.hl - L.rim + 0.05, L.hw - L.rim + 0.05), 24), null);
    felt.rotation.x = -Math.PI / 2; felt.position.y = L.floor + 0.02;
    felt.receiveShadow = true; g.add(felt);
    W.trayFelt = felt;
    scene.add(g);
    W.trayPose = { x: L.x, z: L.z, yaw: L.yaw, tx: L.x, tz: L.z, tyaw: L.yaw };
  }

  function buildMat(scene) {
    var M = W.mats, L = W.L.mat;
    var g = new T.Group();
    g.position.set(L.x, 0, L.z);
    var nx = 60, nz = 30;
    var geo = new T.PlaneGeometry(L.w, L.d, nx, nz);
    geo.rotateX(-Math.PI / 2);
    var top = new T.Mesh(geo, M.matFelt);
    top.position.y = L.t;
    top.receiveShadow = true;
    g.add(top);
    var edge = new T.Mesh(G.roundBox(L.w, L.t, L.d, 0.3), M.matFelt);
    edge.position.y = 0.0; edge.scale.set(0.998, 0.97, 0.995);
    edge.receiveShadow = true;
    g.add(edge);
    scene.add(g);
    W.mat = { group: g, top: top, geo: geo, nx: nx, nz: nz };
  }

  // 地面の高さと種類（受け皿は ball.js で別に扱う）
  W.ground = function (x, z, out) {
    out = out || {};
    var L = W.L.mat;
    if (Math.abs(x - L.x) < L.w / 2 && Math.abs(z - L.z) < L.d / 2) {
      out.y = L.t; out.type = 'mat'; return out;
    }
    var ix = C.BOARD_X - W.FRAME_W, iz = C.BOARD_Z - W.FRAME_W;
    if (Math.abs(x) < ix && Math.abs(z) < iz) { out.y = 0; out.type = 'cork'; return out; }
    if (Math.abs(x) < C.BOARD_X + 0.1 && Math.abs(z) < C.BOARD_Z + 0.1) { out.y = W.FRAME_H; out.type = 'frame'; return out; }
    out.y = -C.BOARD_T; out.type = 'table'; return out;
  };

  // 受け皿の局所座標
  W.trayLocal = function (x, z, out) {
    var P = W.trayPose;
    return KK.invRotXZ(x - P.x, z - P.z, P.yaw, out);
  };
  W.trayWorld = function (lx, lz, out) {
    var P = W.trayPose;
    out = KK.rotXZ(lx, lz, P.yaw, out);
    out.x += P.x; out.z += P.z;
    return out;
  };
  // スタジアム形の中心線からの距離
  W.stadiumDist = function (lx, lz, hl, hw) {
    var c = hl - hw;
    var cz = KK.clamp(lz, -c, c);
    return Math.hypot(lx, lz - cz);
  };
  // 受け皿の内側に入っているか（玉の中心位置で）
  W.inTray = function (x, z, margin) {
    var L = W.L.tray, p = W.trayLocal(x, z, KK._tl || (KK._tl = {}));
    return W.stadiumDist(p.x, p.z, L.hl, L.hw) < L.hw - L.rim - (margin || 0);
  };

  W.update = function (dt) {
    var P = W.trayPose;
    P.x = KK.damp(P.x, P.tx, 16, dt);
    P.z = KK.damp(P.z, P.tz, 16, dt);
    P.yaw = KK.dampAngle(P.yaw, P.tyaw, 16, dt);
    W.tray.position.set(P.x, 0, P.z);
    W.tray.rotation.y = P.yaw;
  };
})();
