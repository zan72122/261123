/* kitchen.js — layout constants and 3D model builders for the kitchen kit */
(function () {
  'use strict';
  const U = window.U;
  const K = (U.kit = {});

  // ------------- layout (1 unit = 10 cm, table top y = 0) -------------
  const L = (U.L = {
    table: { x0: -5.8, x1: 5.8, z0: -3.15, z1: 3.3 },
    kb: { x: -2.25, z: 0.78, tilt: -0.085, Rin: 1.1, D: 0.42, bottom: 0.12, Rout: 1.2, lift: 0.05 },
    board: { x: 0.95, z: 0.55, w: 2.7, d: 2.3, top: 0.12 },
    pitcher: { x: -3.3, z: -1.05 },
    salt: { x: -1.95, z: -1.42 },
    pinRest: { x: 0.95, z: -0.47 },
    knifeRestX: 2.1,
    net: { x: -0.08, z: 2.32 },
    pot: { x: 3.35, z: -0.95, R: 0.82, bottom: 0.22, H: 0.78, waterY: 0.74, spoutAz: 0.95, handleAz: 2.45 },
    serve: { x: 1.12, z: -1.9 },
    plate: { x: 2.42, z: -2.32 },
    mat: { x: -0.62, z: -1.95 },
    kataRest: { x: -3.95, z: 2.05 },
  });
  L.kb.Rs = (L.kb.Rin * L.kb.Rin + L.kb.D * L.kb.D) / (2 * L.kb.D);
  L.kb.rimY = L.kb.bottom + L.kb.D;
  // interior surface of the kneading bowl (bowl-local)
  L.kbY = (r) => {
    const k = L.kb;
    r = Math.min(r, k.Rin);
    return k.bottom + k.Rs - Math.sqrt(Math.max(0, k.Rs * k.Rs - r * r));
  };
  L.board.x0 = L.board.x - L.board.w / 2;
  L.board.x1 = L.board.x + L.board.w / 2;
  L.board.z0 = L.board.z - L.board.d / 2;
  L.board.z1 = L.board.z + L.board.d / 2;
  // serving bowl interior (bowl-local)
  L.sb = { Ri: 0.72, b: 0.08, D: 0.47, soupY: 0.36, Rrim: 0.76 };
  L.sbY = (r) => {
    const s = L.sb;
    const t = Math.min(1, Math.abs(r) / s.Ri);
    return s.b + s.D * Math.pow(t, 2.4);
  };
  L.sb.rs = L.sb.Ri * Math.pow((L.sb.soupY - L.sb.b) / L.sb.D, 1 / 2.4);
  // strainer basket (net-local): rim at origin
  L.net.a = 0.34;
  L.net.d = 0.18;
  L.net.Rs = (L.net.a * L.net.a + L.net.d * L.net.d) / (2 * L.net.d);
  L.netY = (r) => {
    const n = L.net;
    r = Math.min(r, n.a);
    return -n.d + (n.Rs - Math.sqrt(Math.max(0, n.Rs * n.Rs - r * r)));
  };

  // ------------- materials -------------
  const M = (K.mat = {});
  K.initMaterials = function () {
    M.tableWood = new THREE.MeshStandardMaterial({
      map: U.woodTexture([150, 104, 66], [96, 62, 36], { repeat: [3, 2], rings: 14, seed: 3 }),
      roughness: 0.62,
    });
    M.boardWood = new THREE.MeshStandardMaterial({
      map: U.woodTexture([226, 200, 160], [196, 164, 118], { repeat: [1, 1], rings: 30, seed: 7 }),
      roughness: 0.7,
    });
    M.lightWood = new THREE.MeshStandardMaterial({
      map: U.woodTexture([214, 180, 132], [176, 136, 90], { repeat: [1, 3], rings: 10, seed: 11, w: 256, h: 256 }),
      roughness: 0.55,
    });
    M.darkWood = new THREE.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.5 });
    M.wall = new THREE.MeshStandardMaterial({ map: U.tileTexture(), roughness: 0.4 });
    M.lacquerOut = new THREE.MeshStandardMaterial({ color: 0x1f1714, roughness: 0.26 });
    M.lacquerIn = new THREE.MeshStandardMaterial({ color: 0x9a2e1b, roughness: 0.3, side: THREE.DoubleSide });
    M.cream = new THREE.MeshStandardMaterial({ color: 0xe9dfca, roughness: 0.3, side: THREE.DoubleSide });
    M.creamRim = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.35 });
    M.blueGlaze = new THREE.MeshStandardMaterial({ color: 0x7895a2, roughness: 0.22, side: THREE.DoubleSide });
    M.white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.25, side: THREE.DoubleSide });
    M.flour = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.95 });
    M.salt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    M.water = new THREE.MeshStandardMaterial({
      color: 0xa9c9d2, roughness: 0.05, transparent: true, opacity: 0.5, depthWrite: false,
    });
    M.steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.9, roughness: 0.26 });
    M.steelDark = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.85, roughness: 0.35 });
    M.potIn = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
    M.iron = new THREE.MeshStandardMaterial({ color: 0x2b2a29, metalness: 0.5, roughness: 0.6 });
    M.netMesh = new THREE.MeshStandardMaterial({
      color: 0xd9d3c6, metalness: 0.6, roughness: 0.4, alphaMap: U.meshTexture(), alphaTest: 0.45,
      side: THREE.DoubleSide,
    });
    M.bamboo = new THREE.MeshStandardMaterial({ color: 0xc7ad6e, roughness: 0.45 });
    M.bowlIn = new THREE.MeshStandardMaterial({ color: 0xf3eee4, roughness: 0.18, side: THREE.DoubleSide });
    M.bowlOutA = new THREE.MeshStandardMaterial({ map: U.bowlPattern(0), roughness: 0.22 });
    M.bowlOutB = new THREE.MeshStandardMaterial({ map: U.bowlPattern(1), roughness: 0.22 });
    M.soup = new THREE.MeshStandardMaterial({
      color: 0x8a5528, roughness: 0.08, transparent: true, opacity: 0.84, depthWrite: false,
    });
    M.mat = new THREE.MeshStandardMaterial({ map: U.matTexture(), roughness: 0.9 });
    M.plate = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.3, side: THREE.DoubleSide });
    M.age = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    M.negi = [
      new THREE.MeshStandardMaterial({ color: 0x5f9c3b, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0x86b95a, roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0xd7e6b6, roughness: 0.5 }),
    ];
    M.dough = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.82 });
    M.doughV = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  };

  // ------------- static environment -------------
  K.buildRoom = function (scene) {
    const t = L.table;
    const table = new THREE.Mesh(new THREE.BoxGeometry(t.x1 - t.x0, 0.35, t.z1 - t.z0), M.tableWood);
    table.position.set((t.x0 + t.x1) / 2, -0.175, (t.z0 + t.z1) / 2);
    table.receiveShadow = true;
    scene.add(table);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), M.wall);
    wall.position.set(0, 3, t.z0);
    wall.receiveShadow = true;
    scene.add(wall);
    // a wooden ledge where the wall meets the table
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(16, 0.12, 0.12), M.darkWood);
    ledge.position.set(0, 0.06, t.z0 + 0.06);
    U.shadow(ledge);
    scene.add(ledge);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6b5843, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3;
    scene.add(floor);
  };

  // ------------- kneading bowl (kone-bachi) -------------
  K.buildKneadBowl = function () {
    const k = L.kb;
    const g = new THREE.Group();
    const outer = [[0.0, 0.0], [0.5, 0.0], [0.56, 0.015], [0.6, 0.05], [0.66, 0.07], [0.85, 0.16], [1.02, 0.3], [1.14, 0.44], [1.2, k.rimY]];
    const om = new THREE.Mesh(U.lathe(outer, 64), M.lacquerOut);
    g.add(om);
    const inner = [];
    for (let i = 0; i <= 28; i++) {
      const r = (i / 28) * k.Rin;
      inner.push([r, L.kbY(r)]);
    }
    const im = new THREE.Mesh(U.lathe(inner, 64), M.lacquerIn);
    g.add(im);
    const rim = new THREE.Mesh(new THREE.TorusGeometry((k.Rin + k.Rout) / 2, (k.Rout - k.Rin) / 2 + 0.005, 10, 72), M.lacquerOut);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = k.rimY;
    g.add(rim);
    U.shadow(g);
    g.userData.inner = im;
    return g;
  };

  // ------------- katakuchi (small lipped bowl) -------------
  function lipDeform(geom, amt, up, yMin, yMax, sharp) {
    const p = geom.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-4) continue;
      const ang = Math.atan2(x, z);
      const w = Math.pow(Math.max(0, Math.cos(ang)), sharp || 10) * U.smooth(yMin, yMax, y);
      const nr = r + amt * w;
      p.setXYZ(i, (x / r) * nr, y + up * w, (z / r) * nr);
    }
    geom.computeVertexNormals();
  }
  K.lipDeform = lipDeform;

  K.buildKatakuchi = function () {
    const g = new THREE.Group(); // origin at the lip contact
    const body = new THREE.Group();
    const prof = [[0, 0], [0.16, 0], [0.18, 0.015], [0.24, 0.08], [0.29, 0.18], [0.31, 0.26], [0.315, 0.28]];
    const bg = U.lathe(prof, 48);
    lipDeform(bg, 0.09, 0.03, 0.14, 0.28, 8);
    const outer = new THREE.Mesh(bg, M.cream);
    body.add(outer);
    const rimG = new THREE.TorusGeometry(0.312, 0.012, 6, 48);
    rimG.rotateX(Math.PI / 2);
    rimG.translate(0, 0.28, 0);
    lipDeform(rimG, 0.09, 0.03, 0.14, 0.3, 8);
    const rim = new THREE.Mesh(rimG, M.creamRim);
    body.add(rim);
    // flour inside
    const fprof = [[0, 0.255], [0.08, 0.25], [0.17, 0.22], [0.24, 0.17], [0.27, 0.12], [0.2, 0.03], [0, 0.03]];
    const flour = new THREE.Mesh(U.lathe(fprof, 32), M.flour);
    body.add(flour);
    body.userData.flour = flour;
    // lip tip at local (0, 0.31, 0.405) -> place body so lip is at group origin
    body.position.set(0, -0.31, -0.4);
    g.add(body);
    U.shadow(g);
    const col = U.collider(new THREE.SphereGeometry(0.42, 12, 8));
    col.position.set(0, -0.15, -0.4);
    g.add(col);
    g.userData = { body, flour, col };
    return g;
  };

  // ------------- water pitcher -------------
  K.buildPitcher = function () {
    const g = new THREE.Group();
    const vis = new THREE.Group();
    g.add(vis);
    const prof = [[0, 0], [0.19, 0], [0.22, 0.02], [0.25, 0.1], [0.265, 0.24], [0.245, 0.38], [0.215, 0.47], [0.215, 0.53], [0.23, 0.56]];
    const bg = U.lathe(prof, 48);
    lipDeform(bg, 0.13, 0.04, 0.4, 0.56, 12);
    const body = new THREE.Mesh(bg, M.blueGlaze);
    vis.add(body);
    const rimG = new THREE.TorusGeometry(0.23, 0.012, 6, 48);
    rimG.rotateX(Math.PI / 2);
    rimG.translate(0, 0.56, 0);
    lipDeform(rimG, 0.13, 0.04, 0.4, 0.6, 12);
    vis.add(new THREE.Mesh(rimG, M.blueGlaze));
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.028, 8, 20, Math.PI * 1.1), M.blueGlaze);
    hd.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.2);
    hd.position.set(0, 0.3, -0.25);
    vis.add(hd);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 32), M.water.clone());
    water.rotation.x = -Math.PI / 2;
    vis.add(water);
    U.shadow(vis);
    water.castShadow = false;
    const col = U.collider(new THREE.CylinderGeometry(0.36, 0.36, 0.7, 12));
    col.position.y = 0.33;
    g.add(col);
    g.userData = { vis, water, col, prof, mouth: new THREE.Vector3(0, 0.56, 0), spout: new THREE.Vector3(0, 0.6, 0.37) };
    return g;
  };
  // inner radius at height y for pitcher profile
  K.profR = function (prof, y) {
    for (let i = 1; i < prof.length; i++) {
      if (y <= prof[i][1]) {
        const a = prof[i - 1], b = prof[i];
        const t = (y - a[1]) / Math.max(1e-6, b[1] - a[1]);
        return a[0] + (b[0] - a[0]) * t;
      }
    }
    return prof[prof.length - 1][0];
  };

  // ------------- salt dish -------------
  K.buildSaltDish = function () {
    const g = new THREE.Group();
    const vis = new THREE.Group();
    g.add(vis);
    const prof = [[0, 0], [0.15, 0], [0.17, 0.015], [0.22, 0.05], [0.25, 0.07], [0.255, 0.075]];
    vis.add(new THREE.Mesh(U.lathe(prof, 40), M.white));
    U.shadow(vis);
    const grains = [];
    const gg = new THREE.BoxGeometry(0.022, 0.022, 0.022);
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(gg, M.salt);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.1;
      m.position.set(Math.cos(a) * r, 0.02 + (0.1 - r) * 0.35 + Math.random() * 0.01, Math.sin(a) * r);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      vis.add(m);
      grains.push(m);
    }
    const col = U.collider(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 12));
    col.position.y = 0.08;
    g.add(col);
    g.userData = { vis, grains, col };
    return g;
  };

  // ------------- rolling pin -------------
  K.buildPin = function (len, r) {
    const g = new THREE.Group();
    const vis = new THREE.Group();
    g.add(vis);
    const prof = [[0, -len / 2], [r * 0.8, -len / 2], [r * 0.97, -len / 2 + 0.015], [r, -len / 2 + 0.04], [r, len / 2 - 0.04], [r * 0.97, len / 2 - 0.015], [r * 0.8, len / 2], [0, len / 2]];
    const m = new THREE.Mesh(U.lathe(prof, 28), M.lightWood);
    m.rotation.z = Math.PI / 2;
    vis.add(m);
    // a subtle mark to make rolling visible
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.004, r * 1.004, 0.012, 28, 1, true), M.darkWood);
    band.rotation.z = Math.PI / 2;
    band.position.x = len * 0.32;
    vis.add(band);
    const band2 = band.clone();
    band2.position.x = -len * 0.32;
    vis.add(band2);
    U.shadow(vis);
    const col = U.collider(new THREE.CylinderGeometry(0.2, 0.2, len + 0.1, 10));
    col.rotation.z = Math.PI / 2;
    g.add(col);
    g.userData = { vis, roll: vis, col };
    return g;
  };

  // ------------- rolling board with pin cradle and knife rail -------------
  K.buildBoard = function () {
    const b = L.board;
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.top, b.d), M.boardWood);
    top.position.set(b.x, b.top / 2, b.z);
    g.add(top);
    // cradle blocks for the pin at the back
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.16), M.lightWood);
      c.position.set(L.pinRest.x + s * 0.48, b.top + 0.03, L.pinRest.z);
      g.add(c);
    }
    // knife rail along the front edge
    const rail = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.04, 0.08, 0.09), M.darkWood);
    rail.position.set(b.x, b.top + 0.04, b.z1 - 0.07);
    g.add(rail);
    U.shadow(g);
    g.userData = { top };
    return g;
  };

  K.buildKnife = function () {
    const g = new THREE.Group(); // origin: blade bottom at the front end
    const vis = new THREE.Group();
    g.add(vis);
    const bladeLen = 1.9, bh = 0.24;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-bladeLen, 0);
    shape.quadraticCurveTo(-bladeLen - 0.05, bh * 0.6, -bladeLen + 0.03, bh);
    shape.lineTo(0, bh);
    shape.lineTo(0, 0);
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    bg.translate(0, 0, -0.006);
    bg.rotateY(-Math.PI / 2); // length along -z
    const blade = new THREE.Mesh(bg, M.steel);
    blade.position.z = -0.08;
    vis.add(blade);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, bladeLen), M.steelDark);
    spine.position.set(0, bh, -0.08 - bladeLen / 2);
    vis.add(spine);
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.16), M.darkWood);
    carriage.position.set(0, bh + 0.02, 0.0);
    vis.add(carriage);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.62, 16), M.lightWood);
    handle.rotation.x = Math.PI / 2 - 0.18;
    handle.position.set(0, bh + 0.08, 0.36);
    vis.add(handle);
    U.shadow(vis);
    // only the handle and its block are for the finger (the blade stays clear of the noodles)
    const col = U.collider(new THREE.BoxGeometry(0.4, 0.42, 0.8));
    col.position.set(0, 0.3, 0.36);
    g.add(col);
    g.userData = { vis, col: [col], bladeLen };
    return g;
  };

  // ------------- strainer net -------------
  K.buildNet = function () {
    const n = L.net;
    const g = new THREE.Group(); // origin: basket rim centre
    const vis = new THREE.Group();
    g.add(vis);
    const prof = [];
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * n.a;
      prof.push([r, L.netY(r)]);
    }
    const basket = new THREE.Mesh(U.lathe(prof, 40), M.netMesh);
    basket.castShadow = true;
    vis.add(basket);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(n.a, 0.014, 8, 48), M.steel);
    rim.rotation.x = Math.PI / 2;
    vis.add(rim);
    const hl = 1.05;
    // the handle rises from the rim so it clears the pot wall
    const ha = 0.5, ca = Math.cos(ha), sa = Math.sin(ha);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, hl, 10), M.bamboo);
    handle.rotation.z = -(Math.PI / 2 - ha);
    handle.position.set(n.a + 0.12 * ca + (hl / 2) * ca, 0.02 + 0.12 * sa + (hl / 2) * sa, 0);
    vis.add(handle);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6), M.steel);
    wire.rotation.z = -(Math.PI / 2 - ha);
    wire.position.set(n.a + 0.07 * ca, 0.01 + 0.07 * sa, 0);
    vis.add(wire);
    U.shadow(vis);
    const col = U.collider(new THREE.CylinderGeometry(n.a + 0.12, n.a * 0.6, n.d + 0.25, 14));
    col.position.y = -n.d / 2 + 0.05;
    g.add(col);
    const col2 = U.collider(new THREE.BoxGeometry(hl, 0.24, 0.26));
    col2.position.set(n.a + 0.12 * ca + (hl / 2) * ca, 0.02 + 0.12 * sa + (hl / 2) * sa, 0);
    col2.rotation.z = ha;
    g.add(col2);
    g.userData = { vis, col: [col, col2], basket };
    return g;
  };

  // ------------- pot on a small stove -------------
  K.buildPot = function () {
    const p = L.pot;
    const g = new THREE.Group(); // origin: pot centre on table
    const stove = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.12, 40), M.iron);
    stove.position.y = 0.06;
    g.add(stove);
    const trivet = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 40), M.iron);
    trivet.rotation.x = Math.PI / 2;
    trivet.position.y = 0.17;
    g.add(trivet);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.05), M.iron);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      arm.position.set(Math.cos(a) * 0.45, 0.18, Math.sin(a) * 0.45);
      arm.rotation.y = -a;
      g.add(arm);
    }
    const R = p.R, H = p.H, by = p.bottom;
    const outer = [[0, by - 0.005], [R + 0.02, by - 0.005], [R + 0.05, by + 0.03], [R + 0.05, by + H], [R + 0.07, by + H + 0.015]];
    const og = U.lathe(outer, 72);
    og.rotateY(-p.spoutAz);
    lipDeform(og, 0.09, 0.025, by + H - 0.12, by + H + 0.02, 14);
    og.rotateY(p.spoutAz);
    const om = new THREE.Mesh(og, M.steel);
    g.add(om);
    const inner = [[R + 0.065, by + H + 0.012], [R, by + H], [R, by + 0.05], [R - 0.04, by + 0.03], [0, by + 0.03]];
    const ig = U.lathe(inner, 72);
    ig.rotateY(-p.spoutAz);
    lipDeform(ig, 0.09, 0.025, by + H - 0.12, by + H + 0.02, 14);
    ig.rotateY(p.spoutAz);
    const im = new THREE.Mesh(ig, M.potIn);
    g.add(im);
    // long handle
    const hd = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.08), M.steelDark);
    stem.position.set(R + 0.18, 0, 0);
    hd.add(stem);
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.9, 14), M.darkWood);
    wood.rotation.z = Math.PI / 2 + 0.12;
    wood.position.set(R + 0.75, 0.05, 0);
    hd.add(wood);
    hd.position.y = by + H - 0.12;
    hd.rotation.y = -(p.handleAz - Math.PI / 2);
    g.add(hd);
    U.shadow(g);
    // water surface (ring geometry for waves)
    const wg = new THREE.RingGeometry(0.001, R - 0.004, 56, 14);
    wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
      color: 0xd5dedc, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false,
    }));
    water.position.y = p.waterY;
    water.renderOrder = 2;
    g.add(water);
    // faint body of water so things under the surface read as submerged
    const vol = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.01, R - 0.05, p.waterY - by - 0.04, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xbfcfcf, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.BackSide }));
    vol.position.y = (p.waterY + by + 0.04) / 2;
    g.add(vol);
    g.userData = { water, inner: im };
    return g;
  };

  // ------------- serving bowl -------------
  K.buildServeBowl = function (variant) {
    const s = L.sb;
    const g = new THREE.Group();
    const outer = [[0, 0.0], [0.3, 0.0], [0.31, 0.04], [0.33, 0.055], [0.45, 0.12], [0.6, 0.28], [0.71, 0.46], [0.755, 0.555]];
    const om = new THREE.Mesh(U.lathe(outer, 64), variant ? M.bowlOutB : M.bowlOutA);
    g.add(om);
    const inner = [];
    for (let i = 0; i <= 24; i++) {
      const r = (i / 24) * s.Ri;
      inner.push([r, L.sbY(r)]);
    }
    inner.push([s.Ri + 0.03, s.b + s.D + 0.01]);
    const im = new THREE.Mesh(U.lathe(inner, 64), M.bowlIn);
    g.add(im);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(s.Ri + 0.025, 0.022, 8, 64), M.bowlIn);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = s.b + s.D + 0.008;
    g.add(rim);
    U.shadow(g);
    const rimCol = U.collider(new THREE.TorusGeometry(s.Ri + 0.02, 0.13, 6, 24));
    rimCol.rotation.x = Math.PI / 2;
    rimCol.position.y = s.b + s.D;
    g.add(rimCol);
    const bodyCol = U.collider(new THREE.CylinderGeometry(0.86, 0.52, 0.52, 16, 1, true));
    bodyCol.position.y = 0.25;
    g.add(bodyCol);
    g.userData = { rimCol, bodyCol, inner: im };
    return g;
  };

  K.buildMat = function () {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.03, 56), M.mat);
    m.position.y = 0.015;
    m.receiveShadow = true;
    return m;
  };

  K.buildPlate = function () {
    const g = new THREE.Group();
    const prof = [[0, 0], [0.22, 0], [0.25, 0.012], [0.33, 0.04], [0.38, 0.06], [0.385, 0.065]];
    g.add(new THREE.Mesh(U.lathe(prof, 48), M.plate));
    U.shadow(g);
    return g;
  };

  // fried tofu (abura-age)
  K.ageGeometry = function (seed) {
    const w = 0.4, h = 0.05, d = 0.34;
    const geo = new THREE.BoxGeometry(w, h, d, 10, 2, 9);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ex = Math.abs(x) / (w / 2), ez = Math.abs(z) / (d / 2);
      const edge = Math.max(ex, ez);
      const puff = (1 - Math.pow(edge, 4)) * (0.5 + U.noise2(x * 18 + seed, z * 18) * 0.6);
      if (y > 0) y = h / 2 * (0.4 + puff * 0.9);
      else y = -h / 2 * (0.5 + puff * 0.5);
      // round corners
      x *= 1 - 0.08 * Math.pow(ez, 6);
      z *= 1 - 0.08 * Math.pow(ex, 6);
      p.setXYZ(i, x, y, z);
      const n = U.noise2(x * 30 + seed * 3, z * 30);
      const dark = U.clamp(0.25 + edge * 0.35 + n * 0.3, 0, 1);
      col[i * 3] = U.lerp(0.86, 0.6, dark);
      col[i * 3 + 1] = U.lerp(0.6, 0.36, dark);
      col[i * 3 + 2] = U.lerp(0.26, 0.12, dark);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  };

  K.negiGeometry = function (ro, double) {
    const h = 0.012;
    const ri = ro * 0.72;
    const make = (a, b) => U.lathe([[b, 0], [a, 0], [a, h], [b, h], [b, 0]], 14);
    const g = make(ro, ri);
    if (!double) return g;
    const inner = make(ri * 0.92, ri * 0.66);
    return { outer: g, inner };
  };

  // translucent fingertip used by the guide
  K.buildFinger = function () {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff7ef, roughness: 0.4, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false,
    });
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 6, 14), mat);
    tip.position.y = 0.25;
    g.add(tip);
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat);
    nail.scale.set(1, 0.3, 1.3);
    nail.position.set(0, 0.1, 0.06);
    g.add(nail);
    g.renderOrder = 50;
    g.traverse((o) => (o.renderOrder = 50));
    g.userData.mat = mat;
    return g;
  };
})();
