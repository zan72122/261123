/* props.js — 食卓の道具の立体：素材、支柱、受け皿、水差し、ざる、網すくい、水受け、つゆの器、食卓 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  SG.makeMaterials = function () {
    var m = {};
    var bamboo = SG.texBamboo();
    m.bamboo = new T.MeshStandardMaterial({ color: 0xffffff, map: bamboo, roughness: 0.62, metalness: 0, side: T.DoubleSide });
    m.bambooRigid = m.bamboo.clone();
    m.plastic = new T.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45, metalness: 0 });
    m.plasticDark = new T.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.4 });
    m.rubber = new T.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.95 });
    m.saddle = new T.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.5, side: T.DoubleSide });
    m.acrylic = new T.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.08, ior: 1.49,
      transparent: false, side: T.DoubleSide, envMapIntensity: 1.0, specularIntensity: 1, depthWrite: false
    });
    m.water = new T.MeshPhysicalMaterial({
      color: 0xd6eef4, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42,
      envMapIntensity: 1.4, depthWrite: false, side: T.DoubleSide
    });
    m.waterRipple = SG.texRippleNormal();
    m.waterSurf = m.water.clone();
    m.waterSurf.normalMap = m.waterRipple;
    m.waterSurf.normalScale = new T.Vector2(0.12, 0.12);
    m.drop = new T.MeshPhysicalMaterial({ color: 0xeaf6fa, roughness: 0.02, transparent: true, opacity: 0.6, envMapIntensity: 1.6, depthWrite: false });
    m.bubble = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });
    m.tsuyu = new T.MeshPhysicalMaterial({ color: 0x5a2f10, roughness: 0.05, transparent: true, opacity: 0.72, envMapIntensity: 1.2, depthWrite: false });
    m.tsuyu.normalMap = m.waterRipple;
    m.tsuyu.normalScale = new T.Vector2(0.06, 0.06);
    m.noodle = new T.MeshPhysicalMaterial({ color: 0xf8f3e6, roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: new T.Color(0xffffff) });
    m.steel = new T.MeshStandardMaterial({ color: 0xd2d6da, roughness: 0.28, metalness: 0.9 });
    var meshTex = SG.texMesh();
    m.netMesh = new T.MeshStandardMaterial({
      color: 0xc9ced2, roughness: 0.35, metalness: 0.85, alphaMap: meshTex, transparent: true,
      side: T.DoubleSide, depthWrite: false
    });
    m.netMesh.alphaMap.repeat.set(14, 14);
    m.woodGrip = new T.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.6 });
    var weave = SG.texWeave();
    m.zaru = new T.MeshStandardMaterial({ map: weave.map, alphaMap: weave.alpha, alphaTest: 0.45, roughness: 0.75, side: T.DoubleSide });
    m.zaruRim = new T.MeshStandardMaterial({ color: 0xcdb57c, roughness: 0.7 });
    m.plate = new T.MeshPhysicalMaterial({ color: 0xf6f4ef, roughness: 0.25, clearcoat: 0.6 });
    m.pitcher = new T.MeshPhysicalMaterial({ color: 0xdfe9e2, map: SG.texGlaze('#e4ede7', '#9fb4a8'), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    m.basin = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, side: T.DoubleSide });
    m.liner = new T.MeshStandardMaterial({ map: SG.texLiner(), roughness: 0.85 });
    m.bowl = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.6, side: T.DoubleSide });
    m.wood = new T.MeshStandardMaterial({ map: SG.texWood(), roughness: 0.55 });
    m.ghost = new T.MeshStandardMaterial({ color: 0xffeee6, roughness: 0.6, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false });
    return m;
  };

  function shadowAll(o, cast, recv) {
    o.traverse(function (c) { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = recv; } });
  }
  SG.shadowAll = shadowAll;

  // ---- 支柱（丸い台座・滑り止め・三段の筒・鞍） ----
  SG.buildPillar = function (M) {
    var P = {};
    var g = new T.Group();
    var basePts = [
      new T.Vector2(0.0, 0.035), new T.Vector2(0.06, 0.037), new T.Vector2(0.105, 0.05),
      new T.Vector2(0.14, 0.058), new T.Vector2(0.25, 0.056), new T.Vector2(0.285, 0.045),
      new T.Vector2(0.3, 0.02), new T.Vector2(0.3, 0.0)
    ];
    var base = new T.Mesh(new T.LatheGeometry(basePts, 40), M.plasticDark);
    g.add(base);
    var pivot = new T.Group();
    pivot.position.y = 0.04;
    g.add(pivot);
    var rubber = new T.Mesh(new T.CylinderGeometry(0.082, 0.09, 0.06, 24), M.rubber);
    rubber.position.y = 0.03;
    pivot.add(rubber);
    var col = new T.Group();
    col.position.y = 0.06;
    pivot.add(col);
    var radii = [0.07, 0.058, 0.047], tubes = [], collars = [];
    for (var i = 0; i < 3; i++) {
      var tg = new T.CylinderGeometry(radii[i], radii[i], 1.0, 22, 1, false);
      tg.translate(0, 0.5, 0);
      var tm = new T.Mesh(tg, M.plastic);
      col.add(tm); tubes.push(tm);
      if (i < 2) {
        var cm = new T.Mesh(new T.TorusGeometry(radii[i] - 0.002, 0.011, 8, 22), M.plasticDark);
        cm.rotation.x = Math.PI / 2;
        tm.add(cm); cm.position.y = 0.995;
        collars.push(cm);
      }
    }
    var head = new T.Group();
    col.add(head);
    var stem = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.07, 18), M.plasticDark);
    stem.position.y = 0.035;
    head.add(stem);
    var saddleYaw = new T.Group();
    saddleYaw.position.y = 0.07;
    head.add(saddleYaw);
    var sp = new SG.TroughPath(0.44, 0, K.R + K.WALL + 0.004, 0.035, 0.035);
    sp.set(-0.22, 0, 0, 0, 0, 0);
    var sg = SG.buildTroughGeometry(sp, { nArc: 10, ds: 0.11 });
    var saddle = new T.Mesh(sg, M.saddle);
    // 鞍の内底が y=0 にくるよう：中心線は内底。鞍の底の外側は -0.035
    saddle.position.y = 0.035;
    saddleYaw.add(saddle);
    P.group = g; P.pivot = pivot; P.rubber = rubber; P.col = col; P.tubes = tubes;
    P.head = head; P.saddleYaw = saddleYaw; P.saddle = saddle; P.base = base;
    // 柱の長さ（台座上から鞍の内底まで）
    P.HEAD_H = 0.07 + 0.035 + 0.06 + 0.04;
    P.setExt = function (ext) {
      var e = Math.max(1.02, ext);
      tubes[0].position.y = 0;
      tubes[2].position.y = e - 1.0;
      tubes[1].position.y = (e - 1.0) * 0.5;
      head.position.y = e;
    };
    P.setExt(1.05);
    shadowAll(g, true, true);
    return P;
  };

  // ---- 透明な受け皿と短い出口 ----
  SG.buildTray = function (M) {
    var g = new T.Group();
    var R = K.TRAY_R, D = K.TRAY_DEPTH, th = 0.035;
    var gapHalf = Math.asin((K.R + K.WALL) / R);
    var wallPts = [
      new T.Vector2(R - 0.05, 0.0), new T.Vector2(R, 0.04), new T.Vector2(R, D),
      new T.Vector2(R + th * 0.5, D + 0.014), new T.Vector2(R + th, D), new T.Vector2(R + th, 0.02),
      new T.Vector2(R - 0.03, -th)
    ];
    // LatheGeometry: phi=π/2 が +x
    var wall = new T.Mesh(new T.LatheGeometry(wallPts, 64, Math.PI / 2 + gapHalf, Math.PI * 2 - gapHalf * 2), M.acrylic);
    g.add(wall);
    var floorPts = [new T.Vector2(0, -th), new T.Vector2(R - 0.03, -th), new T.Vector2(R - 0.05, 0.0), new T.Vector2(0, 0.0)];
    var floor = new T.Mesh(new T.LatheGeometry(floorPts, 64), M.acrylic);
    g.add(floor);
    // 支柱の頭に載る受け台
    var mount = new T.Mesh(new T.CylinderGeometry(0.28, 0.2, 0.06, 24), M.plasticDark);
    mount.position.y = -th - 0.03;
    g.add(mount);
    // 堰の板：出口の半円の下をふさぐ
    var axisY = K.WEIR + K.R;
    var gw = K.R + K.WALL;
    var shp = new T.Shape();
    shp.moveTo(-gw, 0); shp.lineTo(gw, 0); shp.lineTo(gw, axisY);
    shp.lineTo(K.R, axisY);
    for (var i = 0; i <= 16; i++) {
      var a = Math.PI * i / 16;
      shp.lineTo(Math.cos(a) * K.R, axisY - Math.sin(a) * K.R);
    }
    shp.lineTo(-gw, axisY); shp.lineTo(-gw, 0);
    var weirG = new T.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: false, curveSegments: 4 });
    weirG.rotateY(Math.PI / 2);
    var weir = new T.Mesh(weirG, M.acrylic);
    weir.position.set(Math.cos(gapHalf) * R - 0.04, 0, 0);
    g.add(weir);
    // 短い出口（受け皿に付いたまま）：受け皿ローカルの中心線
    var sp = new SG.TroughPath(K.SPOUT_L, K.SPOUT_LIP);
    sp.set(Math.cos(gapHalf) * R - 0.04, 0, 0, 0, K.WEIR, -0.06);
    var spout = new T.Mesh(SG.buildTroughGeometry(sp, { nArc: 12 }), M.acrylic);
    g.add(spout);
    // フック（出口の下で樋の先を受ける）
    var hook = new T.Mesh(new T.TorusGeometry(K.R + K.WALL + 0.01, 0.012, 6, 20, Math.PI), M.acrylic);
    hook.rotation.y = Math.PI / 2;
    hook.rotation.z = Math.PI;
    hook.position.set(sp.x0 + K.SPOUT_L - 0.05, K.WEIR - 0.06 * (K.SPOUT_L - 0.05) + K.R, 0);
    g.add(hook);
    // 水
    var waterG = new T.CylinderGeometry(1, 1, 1, 48, 1, false);
    waterG.translate(0, 0.5, 0);
    var water = new T.Mesh(waterG, M.water);
    water.renderOrder = 2;
    g.add(water);
    shadowAll(g, false, true);
    mount.castShadow = true;
    return { group: g, spoutLocal: sp, water: water, gapHalf: gapHalf, wall: wall, floor: floor };
  };

  // ---- 水差し ----
  SG.buildPitcher = function (M) {
    var g = new T.Group();
    var outer = [[0.0, 0.0], [0.4, 0.0], [0.47, 0.04], [0.56, 0.35], [0.6, 0.75], [0.56, 1.15], [0.5, 1.5], [0.51, 1.8], [0.55, 1.97]];
    var inner = [[0.53, 1.98], [0.485, 1.8], [0.475, 1.5], [0.535, 1.15], [0.575, 0.75], [0.535, 0.35], [0.45, 0.07], [0.0, 0.06]];
    var pts = [];
    outer.forEach(function (p) { pts.push(new T.Vector2(p[0], p[1])); });
    inner.forEach(function (p) { pts.push(new T.Vector2(p[0], p[1])); });
    var geo = new T.LatheGeometry(pts, 56);
    var pa = geo.getAttribute('position');
    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      var r = Math.sqrt(x * x + z * z);
      if (r < 1e-4) continue;
      var phi = Math.atan2(x, z); // +x は π/2
      var dphi = SG.wrapAngle(phi - Math.PI / 2);
      var f = Math.pow(SG.smooth(1.45, 1.98, y), 2) * Math.exp(-(dphi * dphi) / (0.34 * 0.34));
      var nr = r + f * 0.3;
      var lift = f * 0.06;
      // 注ぎ口のすぼまり
      var pinch = Math.pow(SG.smooth(1.5, 1.98, y), 2) * Math.exp(-((Math.abs(dphi) - 0.5) * (Math.abs(dphi) - 0.5)) / 0.05) * 0.05;
      nr -= pinch;
      pa.setXYZ(i, x / r * nr, y + lift, z / r * nr);
    }
    geo.computeVertexNormals();
    var body = new T.Mesh(geo, M.pitcher);
    g.add(body);
    var curve = new T.CatmullRomCurve3([
      new T.Vector3(-0.5, 1.72, 0), new T.Vector3(-0.82, 1.62, 0), new T.Vector3(-0.92, 1.2, 0),
      new T.Vector3(-0.8, 0.72, 0), new T.Vector3(-0.55, 0.5, 0)
    ]);
    var handle = new T.Mesh(new T.TubeGeometry(curve, 30, 0.055, 10, false), M.pitcher);
    g.add(handle);
    shadowAll(g, true, true);
    return { group: g, spoutTip: new T.Vector3(0.84, 2.03, 0), body: body };
  };

  // ---- ざる（皿の上） ----
  SG.buildZaru = function (M) {
    var g = new T.Group();
    var plate = new T.Mesh(new T.LatheGeometry([
      new T.Vector2(0, 0.012), new T.Vector2(1.05, 0.02), new T.Vector2(1.2, 0.07), new T.Vector2(1.24, 0.075),
      new T.Vector2(1.22, 0.04), new T.Vector2(1.0, 0.0), new T.Vector2(0, 0.0)
    ], 48), M.plate);
    g.add(plate);
    var bowlPts = [];
    for (var i = 0; i <= 10; i++) {
      var t = i / 10;
      bowlPts.push(new T.Vector2(t * 0.98, 0.07 + Math.pow(t, 2.2) * 0.24));
    }
    var bowl = new T.Mesh(new T.LatheGeometry(bowlPts, 56), M.zaru);
    g.add(bowl);
    var rim = new T.Mesh(new T.TorusGeometry(0.98, 0.028, 8, 56), M.zaruRim);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.31;
    g.add(rim);
    var foot = new T.Mesh(new T.TorusGeometry(0.45, 0.022, 6, 40), M.zaruRim);
    foot.rotation.x = Math.PI / 2; foot.position.y = 0.05;
    g.add(foot);
    shadowAll(g, true, true);
    return {
      group: g, bowl: bowl,
      surfY: function (r) { var t = SG.clamp(r / 0.98, 0, 1); return 0.07 + Math.pow(t, 2.2) * 0.24; }
    };
  };

  // ---- 小さな丸い網すくい ----
  SG.NET_R = 0.5;
  SG.NET_D = 0.16;
  SG.buildNet = function (M) {
    var g = new T.Group();
    var rn = SG.NET_R, dn = SG.NET_D;
    var nr = 12, np = 48, pos = [], uv = [], idx = [];
    for (var i = 0; i <= nr; i++) {
      var rho = rn * i / nr;
      for (var j = 0; j <= np; j++) {
        var a = Math.PI * 2 * j / np;
        var x = Math.cos(a) * rho, z = Math.sin(a) * rho;
        pos.push(x, -dn * (1 - (rho / rn) * (rho / rn)), z);
        uv.push(x / (2 * rn) + 0.5, z / (2 * rn) + 0.5);
      }
    }
    for (var i2 = 0; i2 < nr; i2++) {
      for (var j2 = 0; j2 < np; j2++) {
        var a2 = i2 * (np + 1) + j2, b = a2 + 1, c = a2 + np + 1, d = c + 1;
        idx.push(a2, c, b, b, c, d);
      }
    }
    var mg = new T.BufferGeometry();
    mg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    mg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    mg.setIndex(idx);
    mg.computeVertexNormals();
    var mesh = new T.Mesh(mg, M.netMesh);
    mesh.renderOrder = 3;
    g.add(mesh);
    var rim = new T.Mesh(new T.TorusGeometry(rn, 0.02, 10, 64), M.steel);
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    var handle = new T.Group();
    g.add(handle);
    var rod = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.55, 10), M.steel);
    rod.rotation.z = Math.PI / 2;
    rod.position.x = rn + 0.26;
    handle.add(rod);
    var grip = new T.Mesh(new T.CapsuleGeometry(0.042, 0.42, 6, 12), M.woodGrip);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = rn + 0.72;
    handle.add(grip);
    handle.rotation.z = 0.42;
    shadowAll(g, true, false);
    mesh.castShadow = false;
    return { group: g, mesh: mesh, rim: rim, handle: handle };
  };

  // ---- 浅くて広い水受け（角丸のバット）と白い中敷き ----
  SG.buildBasin = function (M, B) {
    var g = new T.Group();
    var path = SG.roundRectPath(B.cx, B.cz, B.hx, B.hz, B.rc, 8);
    var H = B.H;
    var prof = [
      { o: 0.0, y: B.floor, c: 0 }, { o: B.flare, y: H, c: 0 }, { o: B.flare + 0.02, y: H + 0.022, c: 1 },
      { o: B.flare + 0.045, y: H, c: 1 }, { o: B.flare + 0.04, y: H - 0.03, c: 0 }, { o: 0.05, y: 0.0, c: 0 }
    ];
    var cIn = new T.Color(0xd2e6e8), cRim = new T.Color(0x2c4a72);
    var pos = [], col = [], idx = [];
    var np = path.length;
    for (var i = 0; i < np; i++) {
      var p = path[i];
      for (var k = 0; k < prof.length; k++) {
        var q = prof[k];
        pos.push(p.x + p.nx * q.o, q.y, p.z + p.nz * q.o);
        var cc = q.c ? cRim : cIn;
        col.push(cc.r, cc.g, cc.b);
      }
    }
    var nk = prof.length;
    for (var i2 = 0; i2 < np; i2++) {
      var i3 = (i2 + 1) % np;
      for (var k2 = 0; k2 < nk - 1; k2++) {
        var a = i2 * nk + k2, b = a + 1, c = i3 * nk + k2, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    var wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    wg.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    wg.setIndex(idx);
    wg.computeVertexNormals();
    var walls = new T.Mesh(wg, M.basin);
    g.add(walls);
    function rrShape(inset) {
      var s = new T.Shape();
      var pp = SG.roundRectPath(0, 0, B.hx - inset, B.hz - inset, Math.max(0.05, B.rc - inset), 8);
      s.moveTo(pp[0].x, -pp[0].z);
      for (var j = 1; j < pp.length; j++) s.lineTo(pp[j].x, -pp[j].z);
      return s;
    }
    var fg = new T.ShapeGeometry(rrShape(0), 8);
    fg.rotateX(-Math.PI / 2);
    var fc = [];
    for (var f = 0; f < fg.getAttribute('position').count; f++) fc.push(cIn.r, cIn.g, cIn.b);
    fg.setAttribute('color', new T.Float32BufferAttribute(fc, 3));
    var floor = new T.Mesh(fg, M.basin);
    floor.position.set(B.cx, B.floor, B.cz);
    g.add(floor);
    var lg = new T.ShapeGeometry(rrShape(0.06), 8);
    lg.rotateX(-Math.PI / 2);
    var la = lg.getAttribute('position'), luv = lg.getAttribute('uv');
    for (var u = 0; u < la.count; u++) luv.setXY(u, la.getX(u) * 0.35, la.getZ(u) * 0.35);
    var liner = new T.Mesh(lg, M.liner);
    liner.position.set(B.cx, B.liner, B.cz);
    g.add(liner);
    shadowAll(g, true, true);
    liner.castShadow = false;
    return { group: g };
  };

  // ---- 口の広いつゆの器 ----
  SG.BOWL_IN = [[0.0, 0.085], [0.3, 0.09], [0.5, 0.15], [0.66, 0.27], [0.78, 0.42], [0.86, 0.58], [0.9, 0.7]];
  SG.bowlInnerR = function (y) {
    var a = SG.BOWL_IN;
    if (y <= a[0][1]) return 0;
    if (y >= a[a.length - 1][1]) return a[a.length - 1][0];
    for (var i = 1; i < a.length; i++) {
      if (y <= a[i][1]) {
        var t = (y - a[i - 1][1]) / (a[i][1] - a[i - 1][1]);
        return SG.lerp(a[i - 1][0], a[i][0], t);
      }
    }
    return a[a.length - 1][0];
  };
  SG.buildBowl = function (M) {
    var g = new T.Group();
    var inner = SG.BOWL_IN;
    var outer = [[0.94, 0.71], [0.9, 0.55], [0.8, 0.36], [0.62, 0.16], [0.42, 0.06], [0.4, 0.0], [0.34, 0.0], [0.33, 0.03], [0.0, 0.03]];
    var pts = [], cols = [];
    var cIn = new T.Color(0xf3ecdc), cOut = new T.Color(0x3f5d86), cRim = new T.Color(0x8a6b4a);
    inner.forEach(function (p) { pts.push(new T.Vector2(p[0], p[1])); cols.push(cIn); });
    pts.push(new T.Vector2(0.92, 0.725)); cols.push(cRim);
    outer.forEach(function (p, i) { pts.push(new T.Vector2(p[0], p[1])); cols.push(i < 7 ? cOut : cIn); });
    var segs = 64;
    var geo = new T.LatheGeometry(pts, segs);
    var cnt = geo.getAttribute('position').count;
    var colArr = new Float32Array(cnt * 3);
    // LatheGeometry の並び：phi ごとに点列
    for (var i = 0; i <= segs; i++) {
      for (var j = 0; j < pts.length; j++) {
        var c = cols[j], o = (i * pts.length + j) * 3;
        colArr[o] = c.r; colArr[o + 1] = c.g; colArr[o + 2] = c.b;
      }
    }
    geo.setAttribute('color', new T.BufferAttribute(colArr, 3));
    var body = new T.Mesh(geo, M.bowl);
    g.add(body);
    shadowAll(g, true, true);
    return { group: g };
  };

  // ---- 食卓 ----
  SG.buildTable = function (M) {
    var s = new T.Shape();
    var w = 7.5, d = 5.0, r = 0.35;
    s.moveTo(-w + r, -d); s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r);
    s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d);
    s.lineTo(-w + r, d); s.quadraticCurveTo(-w, d, -w, d - r);
    s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d);
    var geo = new T.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 6 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, -0.04, 0);
    var top = new T.Mesh(geo, M.wood);
    top.receiveShadow = true;
    return top;
  };
})();
