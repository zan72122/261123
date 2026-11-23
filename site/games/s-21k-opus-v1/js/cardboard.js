// cardboard.js — 段ボール板の立体（表紙2枚＋波打つ中芯＋切り口）
(function () {
  'use strict';
  var G = window.G, K = G.K;
  var C = (G.card = {});
  var LINER = 0.032;

  C.rectShape = function (x0, y0, x1, y1) {
    var s = new THREE.Shape();
    s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
    return s;
  };
  C.rectPath = function (x0, y0, x1, y1) {
    var p = new THREE.Path();
    p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0);
    return p;
  };
  C.circlePath = function (cx, cy, r, n) {
    var p = new THREE.Path(); n = n || 28;
    for (var i = 0; i <= n; i++) {
      var a = -i / n * Math.PI * 2;
      if (i === 0) p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return p;
  };

  function signedArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }
  // 輪郭を一定間隔で取り直す（角は残す）
  function resample(pts, step) {
    var out = [];
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var L = a.distanceTo(b);
      var k = Math.max(1, Math.ceil(L / step));
      for (var j = 0; j < k; j++) out.push(new THREE.Vector2().lerpVectors(a, b, j / k));
    }
    return out;
  }
  function cleanPts(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (out.length && out[out.length - 1].distanceTo(p) < 1e-4) continue;
      out.push(p.clone());
    }
    if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-4) out.pop();
    return out;
  }

  // 切り口：中芯の波リボンと奥の暗い壁
  function edgeGeometry(contours, T, pitch, inset, fluteAxis) {
    var pos = [], nor = [], uv = [], idx = [];
    var gpos = [], gidx = [];
    var half = T / 2 - LINER;
    contours.forEach(function (c) {
      var pts = resample(c.pts, pitch / 7);
      var A = signedArea(pts);
      var sign = (c.hole ? -1 : 1) * (A > 0 ? 1 : -1);
      var n = pts.length, base = pos.length / 3, gbase = gpos.length / 3;
      for (var i = 0; i <= n; i++) {
        var p = pts[i % n], pp = pts[(i - 1 + n) % n], pn = pts[(i + 1) % n];
        var dx = pn.x - pp.x, dy = pn.y - pp.y, L = Math.hypot(dx, dy) || 1;
        var mx = -dy / L * sign, my = dx / L * sign;           // 材料側へ向く
        var ph = (fluteAxis === 'y' ? p.y : p.x) / pitch * Math.PI * 2;
        var h = Math.sin(ph) * half * 0.92;
        var ox = p.x + mx * 0.004, oy = p.y + my * 0.004;
        var ix = p.x + mx * inset, iy = p.y + my * inset;
        pos.push(ox, oy, h, ix, iy, h);
        var dh = Math.cos(ph);
        nor.push(-mx * 0.3, -my * 0.3, -dh, -mx * 0.3, -my * 0.3, -dh);
        uv.push(i / n * 6, 0, i / n * 6, 1);
        gpos.push(ix, iy, -half, ix, iy, half);
      }
      for (var k = 0; k < n; k++) {
        var a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        var g = gbase + k * 2;
        gidx.push(g, g + 2, g + 1, g + 1, g + 2, g + 3);
      }
    });
    var med = new THREE.BufferGeometry();
    med.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    med.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    med.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    med.setIndex(idx);
    med.computeVertexNormals();
    var gap = new THREE.BufferGeometry();
    gap.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    gap.setIndex(gidx);
    gap.computeVertexNormals();
    return { med: med, gap: gap };
  }

  // shape は板の面内（x,y）、厚みは z（+z が表）
  C.panel = function (shape, opts) {
    opts = opts || {};
    var T = opts.T || K.T, pitch = opts.pitch || 0.34, inset = opts.inset || 0.11;
    var g = new THREE.Group();
    var ex = new THREE.ExtrudeGeometry(shape, { depth: LINER, bevelEnabled: false, curveSegments: opts.curve || 16 });
    var top = new THREE.Mesh(ex, opts.topMat || G.mat.liner);
    top.position.z = T / 2 - LINER;
    var bot = new THREE.Mesh(ex, opts.botMat || G.mat.linerIn);
    bot.position.z = -T / 2;
    g.add(top); g.add(bot);
    if (!opts.noEdge) {
      var ext = shape.extractPoints(opts.curve || 16);
      var contours = [{ pts: cleanPts(ext.shape), hole: false }];
      ext.holes.forEach(function (h) { contours.push({ pts: cleanPts(h), hole: true }); });
      var eg = edgeGeometry(contours, T, pitch, inset, opts.fluteAxis || 'x');
      var med = new THREE.Mesh(eg.med, G.mat.medium);
      var gap = new THREE.Mesh(eg.gap, G.mat.gap);
      med.castShadow = false; gap.castShadow = false;
      g.add(med); g.add(gap);
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; o.userData.card = true; } });
    top.castShadow = true; bot.castShadow = true;
    return g;
  };

  // 長方形の板（中心原点）
  C.rect = function (w, h, opts) {
    return C.panel(C.rectShape(-w / 2, -h / 2, w / 2, h / 2), opts);
  };

  // 折り筋（押しつぶされた帯＋曲がり）長さ len、x 軸方向
  C.crease = function (len, T) {
    T = T || K.T;
    var g = new THREE.Group();
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(T / 2, T / 2, len, 10, 1, false), G.mat.crease);
    cyl.rotation.z = Math.PI / 2;
    cyl.castShadow = true; cyl.receiveShadow = true;
    g.add(cyl);
    return g;
  };
  // 面に貼る押しつぶし帯（板の表に重ねる薄い帯）
  C.band = function (len, wid) {
    if (!C.bandMat) {
      C.bandMat = G.mat.crease.clone();
      C.bandMat.polygonOffset = true; C.bandMat.polygonOffsetFactor = -2; C.bandMat.polygonOffsetUnits = -2;
      C.bandMat.color.setHex(0xa98a6a);
    }
    var m = new THREE.Mesh(new THREE.PlaneGeometry(len, wid), C.bandMat);
    m.receiveShadow = true;
    m.userData.noGlow = true;
    return m;
  };

  // 曲げた帯（円弧の厚紙）。軸 y（CylinderGeometry と同じ）、半径 r、高さ h、角度 a0..a1
  C.arc = function (r, h, a0, a1, T) {
    T = T || K.T;
    var g = new THREE.Group();
    var len = a1 - a0;
    var outer = new THREE.Mesh(new THREE.CylinderGeometry(r + T / 2, r + T / 2, h, 24, 1, true, a0, len), G.mat.liner);
    var inner = new THREE.Mesh(new THREE.CylinderGeometry(r - T / 2, r - T / 2, h, 24, 1, true, a0, len),
      new THREE.MeshStandardMaterial({ map: G.tex.kraft, color: 0xe8d8c0, roughness: 0.95, side: THREE.BackSide }));
    g.add(outer); g.add(inner);
    // 端の切り口
    [a0, a1].forEach(function (a) {
      var e = new THREE.Mesh(new THREE.BoxGeometry(T, h, 0.02), G.mat.medium);
      e.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      e.rotation.y = a;
      g.add(e);
    });
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.card = true; } });
    return g;
  };
})();
