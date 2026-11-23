/* core.js — renderer, scene, lights, camera rig, picking input, main loop */
(function () {
  'use strict';
  const U = window.U;
  const C = (U.core = {});

  C.updaters = [];
  C.time = 0;
  C.lastInput = 0;
  C.firstTouchDone = false;
  C.onFirstTouch = [];
  C.onAnyDown = [];
  C.onPick = [];

  C.addUpdate = function (fn, order = 0) {
    C.updaters.push({ fn, order });
    C.updaters.sort((a, b) => a.order - b.order);
  };

  C.init = function (container) {
    const renderer = (C.renderer = U.makeRenderer
      ? U.makeRenderer()
      : new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    C.canvas = renderer.domElement;

    const scene = (C.scene = new THREE.Scene());
    scene.background = new THREE.Color(0xd9cfc0);

    const cam = (C.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80));
    scene.add(cam);

    // lights
    const hemi = new THREE.HemisphereLight(0xfff1de, 0x7d6a55, 0.85);
    scene.add(hemi);
    const sun = (C.sun = new THREE.DirectionalLight(0xfff0dc, 2.4));
    sun.position.set(-4.5, 10, 5.5);
    sun.target.position.set(0.3, 0, -0.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -6.5; sc.right = 6.5; sc.top = 5.5; sc.bottom = -5.5;
    sc.near = 1; sc.far = 25;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xdce6ff, 0.45);
    fill.position.set(6, 5, 3);
    scene.add(fill);

    // a moving soft light for reflections that slowly cross metal
    C.glint = new THREE.PointLight(0xfff6e8, 3.0, 9, 2);
    C.glint.position.set(3, 3, 1);
    scene.add(C.glint);

    C.buildEnv();

    C.ray = new THREE.Raycaster();
    C.ndc = new THREE.Vector2();
    C.bindInput();
    C.resize();
    window.addEventListener('resize', C.resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', C.resize);
  };

  C.buildEnv = function () {
    try {
      const pm = new THREE.PMREMGenerator(C.renderer);
      const es = new THREE.Scene();
      const room = new THREE.Mesh(
        new THREE.BoxGeometry(20, 10, 20),
        new THREE.MeshBasicMaterial({ color: 0x8a7a66, side: THREE.BackSide })
      );
      room.position.y = 4;
      es.add(room);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ color: 0xfff8ec }));
      win.position.set(-9.8, 5, 0);
      win.rotation.y = Math.PI / 2;
      es.add(win);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: 0xffeedd }));
      top.position.set(0, 8.9, 0);
      top.rotation.x = Math.PI / 2;
      es.add(top);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x5a4632 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.9;
      es.add(floor);
      const rt = pm.fromScene(es, 0.04);
      C.scene.environment = rt.texture;
      C.scene.environmentIntensity = 0.55;
    } catch (e) {
      /* environment is optional */
    }
  };

  C.resize = function () {
    const w = window.innerWidth, h = window.innerHeight;
    C.W = w;
    C.H = h;
    C.renderer.setSize(w, h, false);
    C.canvas.style.width = w + 'px';
    C.canvas.style.height = h + 'px';
    C.camera.aspect = w / h;
    C.camera.updateProjectionMatrix();
  };

  // ---------------- picking / input ----------------
  C.pickables = [];
  C.addPick = function (p) {
    p.priority = p.priority || 0;
    C.pickables.push(p);
    return p;
  };
  C.removePick = function (p) {
    const i = C.pickables.indexOf(p);
    if (i >= 0) C.pickables.splice(i, 1);
  };

  C.rayAt = function (x, y) {
    C.ndc.set((x / C.W) * 2 - 1, -(y / C.H) * 2 + 1);
    C.ray.setFromCamera(C.ndc, C.camera);
    return C.ray.ray.clone();
  };
  C.planeY = function (ray, y, out) {
    const dy = ray.direction.y;
    if (Math.abs(dy) < 1e-5) return null;
    const t = (y - ray.origin.y) / dy;
    if (t < 0) return null;
    out = out || new THREE.Vector3();
    return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
  };
  // closest point on ray to a world point (for vertical drags)
  C.rayPointDist = function (ray, p) {
    return ray.distanceToPoint(p);
  };
  C.project = function (p, out) {
    const v = (out || new THREE.Vector3()).copy(p).project(C.camera);
    return { x: (v.x * 0.5 + 0.5) * C.W, y: (-v.y * 0.5 + 0.5) * C.H, z: v.z };
  };

  function hitTest(x, y) {
    const ray = C.rayAt(x, y);
    C.ray.ray.copy(ray);
    let best = null;
    for (const p of C.pickables) {
      if (p.enabled && !p.enabled()) continue;
      let d = Infinity, point = null, obj = null;
      if (p.hit) {
        const r = p.hit(ray, x, y);
        if (r) { d = r.dist; point = r.point; obj = r.obj || null; }
      } else if (p.target) {
        const ts = Array.isArray(p.target) ? p.target : [p.target];
        const hits = C.ray.intersectObjects(ts, true);
        if (hits.length) { d = hits[0].distance; point = hits[0].point; obj = hits[0].object; }
      }
      if (d === Infinity) continue;
      // priority dominates; distance breaks ties (scaled)
      const score = -p.priority * 1000 + d;
      if (!best || score < best.score) best = { p, d, point, obj, score };
    }
    return { best, ray };
  }

  C.drag = null;
  C.bindInput = function () {
    const el = C.canvas;
    el.style.touchAction = 'none';
    const evInfo = (e, extra) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return Object.assign({ x, y, ray: C.rayAt(x, y), t: C.time }, extra || {});
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (C.drag) return; // single finger only
      C.lastInput = C.time;
      if (!C.firstTouchDone) {
        C.firstTouchDone = true;
        C.onFirstTouch.forEach((f) => f());
      }
      C.onAnyDown.forEach((f) => f());
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const { best, ray } = hitTest(x, y);
      if (!best) return;
      const info = { x, y, ray, point: best.point, obj: best.obj, t: C.time, x0: x, y0: y };
      const ok = best.p.down ? best.p.down(info) : true;
      if (ok === false) return;
      C.drag = { p: best.p, id: e.pointerId, x0: x, y0: y, t0: C.time, moved: 0, lx: x, ly: y };
      C.onPick.forEach((f) => f(best.p));
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!C.drag || e.pointerId !== C.drag.id) return;
      e.preventDefault();
      C.lastInput = C.time;
      const info = evInfo(e);
      const d = C.drag;
      d.moved = Math.max(d.moved, Math.hypot(info.x - d.x0, info.y - d.y0));
      info.dx = info.x - d.lx;
      info.dy = info.y - d.ly;
      info.x0 = d.x0;
      info.y0 = d.y0;
      d.lx = info.x;
      d.ly = info.y;
      if (d.p.move) d.p.move(info);
    });
    const end = (e) => {
      if (!C.drag || e.pointerId !== C.drag.id) return;
      e.preventDefault();
      C.lastInput = C.time;
      const d = C.drag;
      C.drag = null;
      const info = evInfo(e, { tap: d.moved < 12 && C.time - d.t0 < 0.45, moved: d.moved, x0: d.x0, y0: d.y0 });
      if (d.p.up) d.p.up(info);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  };

  // ---------------- camera rig ----------------
  const Cam = (U.cam = {});
  Cam.shots = {};
  Cam.cur = null;
  Cam.goal = { tx: 0, ty: 0, tz: 0, az: 0, el: 0.9, dist: 10 };
  Cam.lambda = 2.2;
  Cam.name = null;
  Cam.define = function (name, def) {
    Cam.shots[name] = def;
  };
  Cam.set = function (name, opts) {
    if (!Cam.shots[name]) return;
    if (Cam.name !== name) {
      Cam.name = name;
      Cam.since = C.time;
    }
    Cam.lambda = (opts && opts.lambda) || Cam.shots[name].lambda || 2.2;
  };

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function basis(az, el) {
    // camera offset direction from target
    const off = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    _f.copy(off).multiplyScalar(-1);
    _r.crossVectors(_f, UP).normalize();
    _u.crossVectors(_r, _f).normalize();
    return off;
  }
  // fit spheres [{c:Vector3, r}] into view for given az/el
  Cam.fit = function (spheres, az, el, margin) {
    basis(az, el);
    const cam = C.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * (margin || 0.92);
    const tanH = tanV * cam.aspect;
    // center estimate in screen-plane coordinates
    const c0 = new THREE.Vector3();
    spheres.forEach((s) => c0.add(s.c));
    c0.multiplyScalar(1 / spheres.length);
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const s of spheres) {
      _q.copy(s.c).sub(c0);
      const a = _q.dot(_r), b = _q.dot(_u);
      amin = Math.min(amin, a - s.r); amax = Math.max(amax, a + s.r);
      bmin = Math.min(bmin, b - s.r); bmax = Math.max(bmax, b + s.r);
    }
    const c = c0.clone().addScaledVector(_r, (amin + amax) / 2).addScaledVector(_u, (bmin + bmax) / 2);
    let dist = 0.5;
    for (const s of spheres) {
      _q.copy(s.c).sub(c);
      const a = Math.abs(_q.dot(_r)) + s.r, b = Math.abs(_q.dot(_u)) + s.r, d = _q.dot(_f);
      dist = Math.max(dist, a / tanH - d + s.r * 0.3, b / tanV - d + s.r * 0.3);
    }
    return { c, dist };
  };

  Cam.computeGoal = function () {
    const s = Cam.shots[Cam.name];
    if (!s) return;
    const portrait = C.camera.aspect < 1;
    const az = typeof s.az === 'function' ? s.az(portrait) : s.az;
    const el = typeof s.el === 'function' ? s.el(portrait) : s.el;
    let spheres = s.spheres(portrait);
    const f = Cam.fit(spheres, az, el, s.margin);
    const g = Cam.goal;
    g.tx = f.c.x; g.ty = f.c.y; g.tz = f.c.z;
    g.az = az; g.el = el;
    g.dist = Math.max(s.minDist || 0, f.dist);
  };

  Cam.update = function (dt) {
    Cam.computeGoal();
    const g = Cam.goal;
    if (!Cam.cur) Cam.cur = Object.assign({}, g);
    const c = Cam.cur, l = Cam.lambda;
    c.tx = U.damp(c.tx, g.tx, l, dt);
    c.ty = U.damp(c.ty, g.ty, l, dt);
    c.tz = U.damp(c.tz, g.tz, l, dt);
    c.az = U.damp(c.az, g.az, l * 0.9, dt);
    c.el = U.damp(c.el, g.el, l * 0.9, dt);
    c.dist = U.damp(c.dist, g.dist, l, dt);
    const off = basis(c.az, c.el);
    C.camera.position.set(c.tx, c.ty, c.tz).addScaledVector(off, c.dist);
    C.camera.lookAt(c.tx, c.ty, c.tz);
  };
  Cam.snap = function () {
    Cam.computeGoal();
    Cam.cur = Object.assign({}, Cam.goal);
    Cam.update(0);
  };
  Cam.settled = function () {
    if (!Cam.cur) return true;
    const c = Cam.cur, g = Cam.goal;
    return Math.abs(c.dist - g.dist) < 0.05 && Math.abs(c.az - g.az) < 0.02 && Math.abs(c.el - g.el) < 0.02;
  };
  // is a world point currently inside the view (with margin in px)?
  Cam.visible = function (p, m = 20) {
    const s = C.project(p);
    return s.z < 1 && s.x > m && s.x < C.W - m && s.y > m && s.y < C.H - m;
  };

  // ---------------- loop ----------------
  C.start = function () {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      C.step(dt);
      C.renderer.render(C.scene, C.camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  C.step = function (dt) {
    C.time += dt;
    C.dt = dt;
    U.updateTweens(dt);
    for (const u of C.updaters) u.fn(dt, C.time);
    Cam.update(dt);
    // slow glint orbit for metal reflections
    const a = C.time * 0.12;
    C.glint.position.set(3.3 + Math.cos(a) * 2.6, 2.6, -0.9 + Math.sin(a) * 2.6);
  };
  C.idle = function () {
    return C.time - C.lastInput;
  };
})();
