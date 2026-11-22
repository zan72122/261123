/* props_world.js — room, lights, environment, work mat, shelf boards & screws, hint lights, ghost hand.
   Contract: SPEC 4章 (G.Props). Classic script, ES2020, global THREE (r160). */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var P = G.Props = G.Props || {};

  var DIM = {
    W: 0.46, H: 0.72, D: 0.24, T: 0.02,
    sideX: 0.22, boardLen: 0.42,
    boardY: [0.05, 0.37, 0.71],
    screwZ: 0.07, screwLen: 0.045, screwRaise: 0.030,
    screwHeadD: 0.016, screwShaftD: 0.006,
    wallZ: -1.25, wallH: 2.7, baseboardH: 0.08,
    mat: { x: -0.40, z: -0.15, w: 1.30, d: 1.10, h: 0.006 }
  };
  P.DIM = DIM;

  // ------------------------------------------------------------------ utils
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var NT = new Float32Array(65536);
  (function () { var r = rng(9137); for (var i = 0; i < 65536; i++) NT[i] = r(); })();
  function vn(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    var a = NT[(y0 << 8) | x0], b = NT[(y0 << 8) | x1], c = NT[(y1 << 8) | x0], d = NT[(y1 << 8) | x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function vnP(x, y, p) { // periodic with period p cells (p<=256)
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    var a = NT[(y0 << 8) | x0], b = NT[(y0 << 8) | x1], c = NT[(y1 << 8) | x0], d = NT[(y1 << 8) | x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function smooth(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }
  function c255(x) { return x < 0 ? 0 : x > 255 ? 255 : x; }

  var ANISO = 4;
  function texFrom(cv, srgb, repeat) {
    var t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = ANISO;
    t.needsUpdate = true;
    return t;
  }

  // Glow helper (★). Collect standard materials of an object; add warm emissive.
  var GLOW = new THREE.Color(1.0, 0.72, 0.35);
  function addGlow(obj) {
    var mats = [];
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      var arr = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < arr.length; i++) {
        var m = arr[i];
        if (m && m.isMeshStandardMaterial && mats.indexOf(m) < 0) { mats.push(m); m.userData.emBase = m.emissive.clone(); }
      }
    });
    obj.userData.setGlow = function (k) {
      k = clamp(k || 0, 0, 1);
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        m.emissive.copy(m.userData.emBase);
        if (k > 0) { m.emissive.r += GLOW.r * 0.55 * k; m.emissive.g += GLOW.g * 0.55 * k; m.emissive.b += GLOW.b * 0.55 * k; }
      }
    };
  }
  function shadowAll(obj, cast, recv) {
    obj.traverse(function (o) { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = recv; } });
  }

  // ------------------------------------------------------------------ textures
  // Pine glulam face/edge: canvas X = along grain. 1024 x 512 = 0.75m x 0.375m
  var WOOD_LU = 0.75, WOOD_LV = 0.375, END_LU = 0.25, END_LV = 0.0625;

  function genWoodFace(seed) {
    var W = 1024, H = 512, R = rng(seed);
    var ca = canvas(W, H), cd = canvas(W, H);
    var xa = ctx2d(ca), xd = ctx2d(cd);
    var A = xa.createImageData(W, H), D = xd.createImageData(W, H);
    var a = A.data, d = D.data;
    function makeSeg(h) {
      var t = R(), warm = R();
      var base = [238 - t * 14 - warm * 6, 214 - t * 20 - warm * 10, 170 - t * 26 - warm * 14];
      var knot = null;
      if (R() < 0.16) {
        var kr = 4 + R() * 5;
        knot = { x: 120 + R() * 780, y: kr + 4 + R() * Math.max(1, h - 2 * kr - 8), r: kr, w: 1.2 + R() * 1.2, s2: Math.pow(kr * 3.0, 2) };
      }
      return {
        base: base, flat: R() < 0.7, s: 5 + R() * 6, c: h * 0.5 + (R() - 0.5) * h * 1.8,
        h0: 12 + R() * 70, slope: (R() - 0.5) * 0.05, ph0: R() * 10, lwK: 0.16 + R() * 0.14, n: R() * 200, knot: knot
      };
    }
    var lams = [], y = 0;
    while (y < H) {
      var h = Math.round(50 + R() * 32); if (H - y - h < 44) h = H - y;
      var nj = R() < 0.55 ? 1 : 2, joints = [], x0 = R() * W;
      for (var j = 0; j < nj; j++) joints.push({ x: (x0 + j * W / nj + (R() - 0.5) * 160 + W) % W, seg: makeSeg(h) });
      lams.push({ y0: y, h: h, joints: joints, amp: 5 + R() * 2, pitch: 5 + R() * 1.5 });
      y += h;
    }
    var li = 0;
    var jx = [0, 0], slopeF;
    for (y = 0; y < H; y++) {
      while (y >= lams[li].y0 + lams[li].h) li++;
      var L = lams[li], yl = y - L.y0;
      var tz = (yl / L.pitch) % 1, tri = Math.abs(tz * 2 - 1) * 2 - 1, off = L.amp * tri;
      slopeF = Math.sqrt(1 + Math.pow(L.amp * 4 / L.pitch, 2));
      var nj2 = L.joints.length;
      for (j = 0; j < nj2; j++) jx[j] = L.joints[j].x + off;
      var seam = yl === 0 ? 0.72 : (yl === 1 || yl === L.h - 1) ? 0.92 : 1;
      for (var x = 0; x < W; x++) {
        var best = 0, bd = 1e9, near = 1e9;
        for (j = 0; j < nj2; j++) {
          var dd = x - jx[j]; dd = ((dd % W) + W) % W;
          if (dd < bd) { bd = dd; best = j; }
          var nd = Math.min(dd, W - dd); if (nd < near) near = nd;
        }
        var S = L.joints[best].seg, xl = ((x - L.joints[best].x) % W + W) % W;
        if (xl > W - 4 * L.amp) xl -= W;
        var warp = vn(xl * 0.0035 + S.n, yl * 0.03 + S.n) - 0.5;
        var ph;
        if (S.flat) {
          var dy = yl - S.c, hh = S.h0 + S.slope * xl + warp * 9;
          ph = Math.sqrt(dy * dy + hh * hh) / S.s;
        } else {
          ph = (yl + warp * 5 + xl * S.slope * 0.12) / S.s;
        }
        ph += S.ph0 + (vn(xl * 0.02 + 7, yl * 0.15 + S.n) - 0.5) * 0.3;
        var kin = 0, kd = 0;
        if (S.knot) {
          var K = S.knot, kx = xl - K.x, ky = (yl - K.y) * 1.2, kd2 = kx * kx * 0.2 + ky * ky;
          if (kd2 < K.s2 * 4) {
            ph += K.w * Math.exp(-kd2 / K.s2);
            kd = Math.sqrt(kd2);
            kin = 1 - smooth(K.r * 0.85, K.r * 1.15, kd);
          }
        }
        var f = ph - Math.floor(ph);
        var lw = smooth(0.55, 0.88, f) * (1 - smooth(0.9, 0.99, f));
        var cv = (vn(xl * 0.004 + 50, yl * 0.02 + S.n) - 0.5) * 0.1;
        var st = vn(xl * 0.06 + S.n, yl * 0.8);
        var fine = 1 + (R() - 0.5) * 0.025 + (st - 0.5) * 0.05 + cv * 0.7;
        var k = S.lwK * lw;
        var r = S.base[0] * (1 - k * 0.7) * fine, g = S.base[1] * (1 - k * 1.05) * fine, b = S.base[2] * (1 - k * 1.45) * fine;
        if (kin > 0) {
          var kf = (kd / 1.6) % 1, kr2 = 0.82 + 0.18 * Math.abs(kf * 2 - 1);
          var rim = 1 - 0.4 * smooth(K.r * 0.5, K.r * 0.95, kd);
          r += (176 * kr2 * rim - r) * kin * 0.85; g += (128 * kr2 * rim - g) * kin * 0.85; b += (80 * kr2 * rim - b) * kin * 0.85;
        }
        var jl = near / slopeF; var jdark = jl < 0.6 ? 0.8 : jl < 1.2 ? 0.93 : 1;
        var m = seam * jdark;
        var o = (y * W + x) * 4;
        a[o] = c255(r * m); a[o + 1] = c255(g * m); a[o + 2] = c255(b * m); a[o + 3] = 255;
        var bump = 0.58 + lw * 0.1 + (st - 0.5) * 0.08 + kin * 0.04;
        if (seam < 1) bump = seam < 0.7 ? 0.15 : 0.4;
        if (jdark < 1) bump = Math.min(bump, jdark < 0.7 ? 0.25 : 0.45);
        var rough = 0.66 - lw * 0.1 + (st - 0.5) * 0.06 - kin * 0.14;
        d[o] = c255(bump * 255); d[o + 1] = c255(rough * 255); d[o + 2] = 0; d[o + 3] = 255;
      }
    }
    xa.putImageData(A, 0, 0); xd.putImageData(D, 0, 0);
    return { map: ca, data: cd };
  }

  // End grain: 1024 x 256 = 0.25 x 0.0625 m
  function genEndGrain(seed) {
    var W = 1024, H = 256, R = rng(seed);
    var ca = canvas(W, H), cd = canvas(W, H);
    var xa = ctx2d(ca), xd = ctx2d(cd);
    var A = xa.createImageData(W, H), D = xd.createImageData(W, H);
    var a = A.data, d = D.data;
    var lams = [], x = 0;
    while (x < W) {
      var w = Math.round(150 + R() * 80); if (W - x - w < 120) w = W - x;
      var t = R();
      lams.push({
        x0: x, w: w, cx: x + w * (0.15 + R() * 0.7), cy: R() < 0.5 ? -(40 + R() * 320) : H + 40 + R() * 320,
        s: 12 + R() * 14, ph0: R() * 5, base: [214 - t * 20, 174 - t * 26, 122 - t * 30], n: R() * 100
      });
      x += w;
    }
    var col = new Int16Array(W), li = 0;
    for (x = 0; x < W; x++) { while (x >= lams[li].x0 + lams[li].w) li++; col[x] = li; }
    for (var y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var L = lams[col[x]], dx = x - L.cx, dy = y - L.cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var ph = dist / L.s + L.ph0 + (vn(x * 0.02 + L.n, y * 0.02) - 0.5) * 0.6;
        var f = ph - Math.floor(ph);
        var lw = smooth(0.5, 0.85, f) * (1 - smooth(0.88, 0.99, f));
        var pore = 0.9 + R() * 0.12;
        var ray = vn(Math.atan2(dy, dx) * 180, dist * 0.02) > 0.82 ? 0.95 : 1;
        var m = pore * ray * (1 + (vn(x * 0.01, y * 0.03 + L.n) - 0.5) * 0.12);
        var xl = x - L.x0;
        if (xl < 2 || xl > L.w - 2) m *= (xl < 1 || xl > L.w - 1) ? 0.6 : 0.82;
        var k = 0.32 * lw;
        var o = (y * W + x) * 4;
        a[o] = c255(L.base[0] * (1 - k * 0.8) * m); a[o + 1] = c255(L.base[1] * (1 - k * 1.15) * m); a[o + 2] = c255(L.base[2] * (1 - k * 1.5) * m); a[o + 3] = 255;
        d[o] = c255((0.5 + lw * 0.1 + (pore - 0.96) * 2) * 255); d[o + 1] = c255((0.78 - lw * 0.06) * 255); d[o + 2] = 0; d[o + 3] = 255;
      }
    }
    xa.putImageData(A, 0, 0); xd.putImageData(D, 0, 0);
    return { map: ca, data: cd };
  }

  // Oak floor: 2048 (along plank) x 1024 (across) = 2.4m x 1.2m, 12 planks of 0.10m
  var FLOOR_LU = 2.4, FLOOR_LV = 1.2;
  function genFloor(seed) {
    var W = 2048, H = 1024, ROWS = 12, R = rng(seed);
    var ca = canvas(W, H), cd = canvas(W, H);
    var xa = ctx2d(ca), xd = ctx2d(cd);
    var A = xa.createImageData(W, H), D = xd.createImageData(W, H);
    var a = A.data, d = D.data;
    var rows = [];
    for (var ri = 0; ri < ROWS; ri++) {
      var y0 = Math.round(ri * H / ROWS), y1 = Math.round((ri + 1) * H / ROWS);
      var start = R() * W, joints = [], acc = 0;
      while (true) {
        var len = 520 + R() * 900;
        if (acc + len > W - 380) { len = W - acc; }
        joints.push({ x: (start + acc) % W, len: len, seg: null });
        acc += len; if (acc >= W - 0.5) break;
      }
      for (var j = 0; j < joints.length; j++) {
        var t = R(), grey = 0.2 + R() * 0.25, hue = (R() - 0.5) * 8;
        var base = [176 - t * 42 + hue, 136 - t * 34, 98 - t * 26 - hue * 0.6];
        base = [base[0] + (150 - base[0]) * grey, base[1] + (132 - base[1]) * grey, base[2] + (112 - base[2]) * grey];
        joints[j].seg = {
          base: base, flat: R() < 0.6, s: 7 + R() * 9, c: (y1 - y0) * (0.5 + (R() - 0.5) * 1.8), h0: 10 + R() * 60,
          slope: (R() - 0.5) * 0.04, ph0: R() * 10, n: R() * 200, rough: 0.36 + R() * 0.1, lwK: 0.08 + R() * 0.1
        };
      }
      rows.push({ y0: y0, h: y1 - y0, joints: joints });
    }
    var segI = new Int16Array(W), segX = new Float32Array(W);
    for (ri = 0; ri < ROWS; ri++) {
      var RW = rows[ri], J = RW.joints;
      for (var x = 0; x < W; x++) {
        var bi = 0, bd = 1e9;
        for (j = 0; j < J.length; j++) { var dd = ((x - J[j].x) % W + W) % W; if (dd < bd) { bd = dd; bi = j; } }
        segI[x] = bi; segX[x] = bd;
      }
      for (var y = RW.y0; y < RW.y0 + RW.h; y++) {
        var yl = y - RW.y0 + 0.5, ey = Math.min(yl, RW.h - yl);
        for (x = 0; x < W; x++) {
          var Jt = J[segI[x]], S = Jt.seg, xl = segX[x] + 0.5;
          var warp = vn(xl * 0.003 + S.n, yl * 0.025 + S.n) - 0.5, ph;
          if (S.flat) { var dy = yl - S.c, hh = S.h0 + S.slope * xl + warp * 22; ph = Math.sqrt(dy * dy + hh * hh) / S.s; }
          else ph = (yl + warp * 9) / S.s;
          var pv = vn(xl * 0.11 + S.n, yl * 1.2);
          ph += S.ph0 + (pv - 0.5) * 0.25;
          var f = ph - Math.floor(ph);
          var lw = smooth(0.5, 0.85, f) * (1 - smooth(0.88, 1.0, f));
          var pore = smooth(0.66, 0.84, pv);
          var cv = warp * 0.1;
          var e = Math.min(ey, xl, Jt.len - xl);
          var m = (1 - S.lwK * lw - pore * 0.12 + cv * 0.8) * (1 + (R() - 0.5) * 0.03);
          var bump = 0.62 + lw * 0.05 - pore * 0.08, rough = S.rough + pore * 0.06;
          if (e < 0.8) { m *= 0.45; bump = 0.1; rough = 0.75; }
          else if (e < 1.8) { m *= 0.84; bump = 0.42; rough = S.rough + 0.08; }
          var o = (y * W + x) * 4;
          a[o] = c255(S.base[0] * m); a[o + 1] = c255(S.base[1] * m * (1 - lw * 0.04)); a[o + 2] = c255(S.base[2] * m * (1 - lw * 0.08)); a[o + 3] = 255;
          d[o] = c255(bump * 255); d[o + 1] = c255(rough * 255); d[o + 2] = 0; d[o + 3] = 255;
        }
      }
    }
    xa.putImageData(A, 0, 0); xd.putImageData(D, 0, 0);
    return { map: ca, data: cd };
  }

  // Plaster wall: 512 periodic, 0.8m tile
  function genPlaster() {
    var N = 512, R = rng(77);
    var ca = canvas(N, N), cd = canvas(N, N);
    var xa = ctx2d(ca), xd = ctx2d(cd);
    var A = xa.createImageData(N, N), D = xd.createImageData(N, N);
    var a = A.data, d = D.data;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var lo = vnP(x * 4 / N, y * 4 / N, 4), mid = vnP(x * 24 / N + 0.3, y * 24 / N, 24), hi = vnP(x * 96 / N, y * 96 / N + 0.7, 96), vh = vnP(x * 200 / N, y * 200 / N, 200);
      var m = 1 + (lo - 0.5) * 0.035 + (mid - 0.5) * 0.02 + (R() - 0.5) * 0.012;
      var o = (y * N + x) * 4;
      a[o] = c255(222 * m); a[o + 1] = c255(217 * m); a[o + 2] = c255(208 * m); a[o + 3] = 255;
      var bump = 0.5 + (mid - 0.5) * 0.35 + (hi - 0.5) * 0.35 + (vh - 0.5) * 0.25;
      d[o] = c255(bump * 255); d[o + 1] = c255((0.88 + (hi - 0.5) * 0.06) * 255); d[o + 2] = 0; d[o + 3] = 255;
    }
    xa.putImageData(A, 0, 0); xd.putImageData(D, 0, 0);
    return { map: ca, data: cd };
  }

  // Felt mat top: 1024x1024 covering whole mat (1.30 x 1.10)
  function genFelt() {
    var N = 1024, R = rng(4242);
    var ca = canvas(N, N), cd = canvas(N, N);
    var xa = ctx2d(ca), xd = ctx2d(cd);
    var A = xa.createImageData(N, N), D = xd.createImageData(N, N);
    var a = A.data, d = D.data;
    var bx = 12, by = 14; // binding width in px (~15mm)
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var o = (y * N + x) * 4;
      var ex = Math.min(x, N - 1 - x), ey = Math.min(y, N - 1 - y);
      var inB = ex < bx || ey < by;
      var rr = R(), n2 = 0.5, n3 = 0.5, n1 = 0.5 + (R() - 0.5) * 0.6;
      if (!(ex < bx || ey < by)) { n2 = vn(x * 0.05 + 20, y * 0.05); n3 = vn(x * 0.008, y * 0.008 + 40); }
      if (!inB) {
        var m = 0.9 + (n1 - 0.5) * 0.12 + (n2 - 0.5) * 0.035 + (n3 - 0.5) * 0.03 + (rr - 0.5) * 0.11;
        a[o] = c255(118 * m); a[o + 1] = c255(121 * m); a[o + 2] = c255(124 * m); a[o + 3] = 255;
        d[o] = c255((0.5 + (n1 - 0.5) * 0.5 + (rr - 0.5) * 0.35) * 255); d[o + 1] = 245;
      } else {
        // woven binding tape: fine diagonal weave
        var wv = ((x + y) % 4 < 2 ? 1 : 0.9) * ((x - y + 1024) % 6 < 3 ? 1 : 0.94);
        var edge = Math.min(ex, ey) < 1.5 ? 0.8 : 1;
        var m2 = (0.95 + (rr - 0.5) * 0.06) * wv * edge;
        a[o] = c255(66 * m2); a[o + 1] = c255(68 * m2); a[o + 2] = c255(72 * m2); a[o + 3] = 255;
        d[o] = c255((0.62 + (wv - 0.95) * 0.8) * 255); d[o + 1] = 225;
      }
      d[o + 2] = 0; d[o + 3] = 255;
    }
    xa.putImageData(A, 0, 0); xd.putImageData(D, 0, 0);
    // fibres
    for (var i = 0; i < 3500; i++) {
      var fx = bx + 2 + R() * (N - 2 * bx - 4), fy = by + 2 + R() * (N - 2 * by - 4), ang = R() * Math.PI * 2, ln = 3 + R() * 7;
      xa.strokeStyle = R() < 0.5 ? 'rgba(170,172,176,0.10)' : 'rgba(60,62,66,0.10)';
      xa.lineWidth = 0.7;
      xa.beginPath(); xa.moveTo(fx, fy);
      xa.quadraticCurveTo(fx + Math.cos(ang + 0.6) * ln * 0.5, fy + Math.sin(ang + 0.6) * ln * 0.5, fx + Math.cos(ang) * ln, fy + Math.sin(ang) * ln);
      xa.stroke();
    }
    // overlock stitches along the inner edge of the binding
    function stitch(ctx, col, w) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      var s;
      for (s = by + 4; s < N - by - 4; s += 6) { ctx.moveTo(bx - 4, s); ctx.lineTo(bx + 3, s + 3); ctx.moveTo(N - bx + 4, s); ctx.lineTo(N - bx - 3, s + 3); }
      for (s = bx + 4; s < N - bx - 4; s += 6) { ctx.moveTo(s, by - 4); ctx.lineTo(s + 3, by + 3); ctx.moveTo(s, N - by + 4); ctx.lineTo(s + 3, N - by - 3); }
      ctx.stroke();
    }
    stitch(xa, 'rgba(150,152,156,0.75)', 1.2);
    stitch(xd, 'rgba(210,0,0,1)', 1.2);
    return { map: ca, data: cd };
  }

  // Countersunk pilot-hole decal (albedo+alpha, normal)
  var HOLE_SIZE = 0.022, HOLE_R = 0.0088, PILOT_R = 0.0016;
  function genHoleDecal() {
    var N = 128, c = N / 2, R = rng(31);
    var ca = canvas(N, N), cn = canvas(N, N);
    var xa = ctx2d(ca), xn = ctx2d(cn);
    var A = xa.createImageData(N, N), Nn = xn.createImageData(N, N);
    var a = A.data, nn = Nn.data;
    var ro = HOLE_R / HOLE_SIZE * N, rp = PILOT_R / HOLE_SIZE * N, sa = Math.sin(0.85), cs = Math.cos(0.85);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.sqrt(dx * dx + dy * dy), o = (y * N + x) * 4;
      var alpha = 1 - smooth(ro - 0.6, ro + 1.2, r);
      var t = clamp((r - rp) / (ro - rp), 0, 1);
      var fib = 0.92 + R() * 0.1 + (vn(Math.atan2(dy, dx) * 20, r * 0.5) - 0.5) * 0.12;
      var cr = 188, cg = 146, cb = 98, m = (0.38 + 0.62 * Math.pow(t, 0.8)) * fib;
      m *= 1 - 0.35 * smooth(ro - 3.5, ro - 0.5, r) * (1 - smooth(ro - 0.5, ro + 0.8, r));
      if (r < rp + 0.8) { var hh = smooth(rp - 1.2, rp + 0.8, r); cr = 34 + 120 * hh; cg = 24 + 90 * hh; cb = 16 + 60 * hh; m = 1; }
            a[o] = c255(cr * m); a[o + 1] = c255(cg * m); a[o + 2] = c255(cb * m); a[o + 3] = c255(alpha * 255);
      var nx = 0, ny = 0, nz = 1;
      if (r > rp && r < ro) { nx = -dx / r * sa; ny = dy / r * sa; nz = cs; }
      nn[o] = c255((nx * 0.5 + 0.5) * 255); nn[o + 1] = c255((ny * 0.5 + 0.5) * 255); nn[o + 2] = c255((nz * 0.5 + 0.5) * 255); nn[o + 3] = 255;
    }
    xa.putImageData(A, 0, 0); xn.putImageData(Nn, 0, 0);
    return { map: ca, normal: cn };
  }
  // Dado groove decal: 256 x 32 covering 0.24 x 0.026
  var GROOVE_H = 0.026;
  function genGrooveDecal() {
    var W = 256, H = 32, R = rng(5);
    var ca = canvas(W, H), x = ctx2d(ca), A = x.createImageData(W, H), a = A.data;
    var e1 = (GROOVE_H / 2 - 0.01) / GROOVE_H * H, e2 = H - e1;
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
      var yc = yy + 0.5, o = (yy * W + xx) * 4, al = 0;
      var dl = Math.min(Math.abs(yc - e1), Math.abs(yc - e2));
      if (yc > e1 && yc < e2) al = 0.07;
      al = Math.max(al, 0.8 * (1 - smooth(0.4, 1.4, dl)));
      var edgeFade = smooth(0, 4, Math.min(xx, W - 1 - xx));
      a[o] = 70; a[o + 1] = 48; a[o + 2] = 28; a[o + 3] = c255(al * edgeFade * (0.9 + R() * 0.2) * 255);
    }
    x.putImageData(A, 0, 0);
    return ca;
  }

  // Window light patch mask (green channel used by alphaMap)
  function genWindowMask() {
    var N = 256, c = canvas(N, N), x = ctx2d(c);
    var buf = new Float32Array(N * N), tmp = new Float32Array(N * N), i, j, k;
    var m = 34, mul = 9, w = N - 2 * m, hw = Math.round((w - mul) / 2);
    function rect(x0, y0, ww, hh) { for (var yy = y0; yy < y0 + hh; yy++) for (var xx = x0; xx < x0 + ww; xx++) buf[yy * N + xx] = 1; }
    rect(m, m, hw, hw); rect(m + hw + mul, m, hw, hw); rect(m, m + hw + mul, hw, hw); rect(m + hw + mul, m + hw + mul, hw, hw);
    function blur(src, dst, rad, horiz) {
      var div = 2 * rad + 1;
      for (var a2 = 0; a2 < N; a2++) {
        var s2 = 0;
        for (k = -rad; k <= rad; k++) { var q = clamp(k, 0, N - 1); s2 += horiz ? src[a2 * N + q] : src[q * N + a2]; }
        for (var b2 = 0; b2 < N; b2++) {
          if (horiz) dst[a2 * N + b2] = s2 / div; else dst[b2 * N + a2] = s2 / div;
          var add = clamp(b2 + rad + 1, 0, N - 1), rem = clamp(b2 - rad, 0, N - 1);
          s2 += horiz ? (src[a2 * N + add] - src[a2 * N + rem]) : (src[add * N + a2] - src[rem * N + a2]);
        }
      }
    }
    for (j = 0; j < 3; j++) { blur(buf, tmp, 4, true); blur(tmp, buf, 4, false); }
    var img = x.createImageData(N, N), d = img.data;
    for (i = 0; i < N * N; i++) {
      var px = i % N, py = (i / N) | 0, ed = Math.min(px, py, N - 1 - px, N - 1 - py);
      var v = buf[i] * smooth(0, 10, ed) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function genRadial(N, fn) {
    var c = canvas(N, N), x = ctx2d(c), img = x.createImageData(N, N), d = img.data, h = N / 2;
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      var dx = (xx + 0.5 - h) / h, dy = (yy + 0.5 - h) / h, r = Math.sqrt(dx * dx + dy * dy), o = (yy * N + xx) * 4;
      var v = r >= 1 ? 0 : fn(r);
      d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = c255(v * 255);
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function genHand() {
    var W = 256, H = 512, c = canvas(W, H), x = ctx2d(c);
    var s = canvas(W, H), sx = ctx2d(s);
    // silhouette (back of a right hand, index finger up, others gently curled)
    sx.fillStyle = '#fff'; sx.strokeStyle = '#fff'; sx.lineCap = 'round'; sx.lineJoin = 'round';
    function cap(x0, y0, x1, y1, w) { sx.lineWidth = w; sx.beginPath(); sx.moveTo(x0, y0); sx.lineTo(x1, y1); sx.stroke(); }
    function circ(cx, cy, r) { sx.beginPath(); sx.arc(cx, cy, r, 0, Math.PI * 2); sx.fill(); }
    cap(100, 52, 112, 230, 48);        // index finger (tip at ~ (100,28))
    sx.beginPath();                     // back of hand / fist
    sx.moveTo(84, 236); sx.quadraticCurveTo(86, 200, 120, 196);
    sx.quadraticCurveTo(175, 196, 214, 222); sx.quadraticCurveTo(236, 250, 228, 300);
    sx.quadraticCurveTo(220, 360, 196, 392); sx.lineTo(118, 400);
    sx.quadraticCurveTo(80, 360, 78, 300); sx.closePath(); sx.fill();
    circ(162, 218, 29); circ(196, 236, 26); circ(220, 262, 22); // curled finger knuckles
    cap(96, 330, 136, 268, 40);        // thumb tucked across
    sx.beginPath();                     // wrist
    sx.moveTo(116, 380); sx.lineTo(200, 376); sx.lineTo(210, H); sx.lineTo(108, H); sx.closePath(); sx.fill();
    // fade the wrist out
    sx.globalCompositeOperation = 'destination-out';
    var gr = sx.createLinearGradient(0, 390, 0, 500); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    sx.fillStyle = gr; sx.fillRect(0, 380, W, H - 380);
    sx.globalCompositeOperation = 'source-over';
    // soft dark rim (reads on light wood), then warm-white body
    x.save(); x.shadowColor = 'rgba(70,45,30,0.55)'; x.shadowBlur = 14; x.drawImage(s, 0, 0); x.restore();
    x.globalCompositeOperation = 'source-in';
    var body = x.createLinearGradient(60, 30, 220, 420);
    body.addColorStop(0, '#fffaf4'); body.addColorStop(0.55, '#fbe9dc'); body.addColorStop(1, '#f1d6c4');
    x.fillStyle = body; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
    // rim halo outside silhouette
    var rim = canvas(W, H), rx = ctx2d(rim);
    rx.shadowColor = 'rgba(80,52,36,0.7)'; rx.shadowBlur = 9; rx.drawImage(s, 0, 0);
    rx.globalCompositeOperation = 'destination-out'; rx.shadowBlur = 0; rx.drawImage(s, 0, 0);
    x.globalCompositeOperation = 'destination-over'; x.drawImage(rim, 0, 0); x.globalCompositeOperation = 'source-over';
    // subtle details: nail, knuckle shading
    x.save();
    x.beginPath(); x.ellipse(101, 46, 13, 17, -0.07, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,0.55)'; x.fill();
    x.strokeStyle = 'rgba(190,140,120,0.25)'; x.lineWidth = 1.5; x.stroke();
    x.strokeStyle = 'rgba(180,130,110,0.18)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(94, 128); x.quadraticCurveTo(105, 124, 116, 128); x.stroke();
    x.beginPath(); x.moveTo(140, 236); x.quadraticCurveTo(150, 246, 146, 258); x.stroke();
    x.beginPath(); x.moveTo(176, 250); x.quadraticCurveTo(186, 262, 182, 272); x.stroke();
    x.restore();
    return { canvas: c, tipX: 100, tipY: 28, W: W, H: H };
  }

  // ------------------------------------------------------------------ geometry
  // Rounded box with per-face material + UV callbacks. faceFn(n, s, p) -> {mat, u, v}
  function roundedBox(size, r, seg, faceFn) {
    var hs = [size[0] / 2, size[1] / 2, size[2] / 2];
    var pos = [], nor = [], uv = [], byMat = {}, vcount = 0;
    function axisList(h) {
      var a = [], i;
      for (i = 0; i <= seg; i++) a.push(-h + r - r * Math.cos(i / seg * Math.PI / 2));
      for (i = seg; i >= 0; i--) a.push(h - r + r * Math.cos(i / seg * Math.PI / 2));
      return a;
    }
    for (var n = 0; n < 3; n++) for (var si = 0; si < 2; si++) {
      var s = si ? -1 : 1, a = (n + 1) % 3, b = (n + 2) % 3;
      var La = axisList(hs[a]), Lb = axisList(hs[b]), na = La.length, nb = Lb.length;
      var mat = 0, base = vcount;
      for (var i = 0; i < na; i++) for (var j = 0; j < nb; j++) {
        var p = [0, 0, 0]; p[n] = s * hs[n]; p[a] = La[i]; p[b] = Lb[j];
        var cc = [clamp(p[0], -hs[0] + r, hs[0] - r), clamp(p[1], -hs[1] + r, hs[1] - r), clamp(p[2], -hs[2] + r, hs[2] - r)];
        var dx = p[0] - cc[0], dy = p[1] - cc[1], dz = p[2] - cc[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var nx, ny, nz;
        if (l < 1e-9) { nx = n === 0 ? s : 0; ny = n === 1 ? s : 0; nz = n === 2 ? s : 0; pos.push(p[0], p[1], p[2]); }
        else { nx = dx / l; ny = dy / l; nz = dz / l; pos.push(cc[0] + nx * r, cc[1] + ny * r, cc[2] + nz * r); }
        nor.push(nx, ny, nz);
        var f = faceFn(n, s, p); mat = f.mat; uv.push(f.u, f.v);
        vcount++;
      }
      var list = byMat[mat] || (byMat[mat] = []);
      for (i = 0; i < na - 1; i++) for (j = 0; j < nb - 1; j++) {
        var v00 = base + i * nb + j, v10 = v00 + nb, v01 = v00 + 1, v11 = v10 + 1;
        if (s > 0) list.push(v00, v10, v11, v00, v11, v01); else list.push(v00, v11, v10, v00, v01, v11);
      }
    }
    var g = new THREE.BufferGeometry(), idx = [], keys = Object.keys(byMat).sort();
    for (var k = 0; k < keys.length; k++) { var L2 = byMat[keys[k]]; g.addGroup(idx.length, L2.length, +keys[k]); Array.prototype.push.apply(idx, L2); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }

  function mergeGeos(list) { // [{geo, mat}] -> non-indexed geometry with position/normal and groups
    var pos = [], nor = [], g = new THREE.BufferGeometry(), start = 0;
    list.sort(function (a, b) { return a.mat - b.mat; });
    var cur = -1, gs = 0;
    for (var i = 0; i < list.length; i++) {
      var ge = list[i].geo.index ? list[i].geo.toNonIndexed() : list[i].geo;
      var p = ge.attributes.position.array, n = ge.attributes.normal.array;
      if (list[i].mat !== cur) { if (cur >= 0) g.addGroup(gs, start - gs, cur); cur = list[i].mat; gs = start; }
      for (var j = 0; j < p.length; j++) { pos.push(p[j]); nor.push(n[j]); }
      start += p.length / 3;
    }
    g.addGroup(gs, start - gs, cur);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }

  function buildScrewGeo() {
    var segs = 20, TWO = Math.PI * 2;
    var top = 0.0003, headR = DIM.screwHeadD / 2, coneBot = -0.0055, rShank = 0.0026;
    // head: lathe (bottom to top)
    var lp = [new THREE.Vector2(rShank, coneBot), new THREE.Vector2(headR + 0.0001, -0.0006), new THREE.Vector2(headR + 0.0001, 0.0000), new THREE.Vector2(headR - 0.0002, top)];
    var lathe = new THREE.LatheGeometry(lp, segs);
    // top cap with phillips cross hole
    var w = 0.00072, Lc = 0.0043;
    function cross(path) {
      var pts = [[w, w], [Lc, w], [Lc, -w], [w, -w], [w, -Lc], [-w, -Lc], [-w, -w], [-Lc, -w], [-Lc, w], [-w, w], [-w, Lc], [w, Lc]];
      path.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]); path.closePath();
      return path;
    }
    var sh = new THREE.Shape(); sh.absarc(0, 0, headR - 0.0002, 0, TWO, false);
    sh.holes.push(cross(new THREE.Path()));
    var capG = new THREE.ShapeGeometry(sh, 24); capG.rotateX(-Math.PI / 2); capG.translate(0, top, 0);
    // recess (rendered back-side)
    var depth = 0.0034;
    var rec = new THREE.ExtrudeGeometry(cross(new THREE.Shape()), { depth: depth, bevelEnabled: false });
    rec.rotateX(Math.PI / 2); rec.translate(0, top, 0);
    var rp = rec.attributes.position;
    for (var i = 0; i < rp.count; i++) { var t = (top - rp.getY(i)) / depth, sc = 1 - 0.62 * t; rp.setX(i, rp.getX(i) * sc); rp.setZ(i, rp.getZ(i) * sc); }
    rec.deleteAttribute('normal'); rec.computeVertexNormals();
    // threaded shaft: helical surface r(phi,y)
    var p = 0.0026, yTop = coneBot, yEnd = -DIM.screwLen, rows = 112, root = 0.0019, crest = 0.0031;
    var pos = [], idx = [];
    for (var j = 0; j <= rows; j++) {
      var y = yTop + (yEnd - yTop) * j / rows;
      var amt = smooth(-0.0085, -0.0105, y), taper = clamp((y - yEnd) / 0.0085, 0, 1);
      taper = Math.pow(taper, 0.85);
      for (var k = 0; k <= segs; k++) {
        var ph = k / segs * TWO, f = (-y / p + k / segs) % 1; if (f < 0) f += 1;
        var tri = 1 - Math.abs(2 * f - 1); tri = tri * tri * (3 - 2 * tri);
        var prof = root + (crest - root) * tri;
        var r = (rShank + (prof - rShank) * amt) * taper;
        if (j === rows) r = 0;
        pos.push(Math.cos(ph) * r, y, Math.sin(ph) * r);
      }
    }
    for (j = 0; j < rows; j++) for (k = 0; k < segs; k++) {
      var aI = j * (segs + 1) + k, bI = aI + 1, cI = aI + segs + 1, dI = cI + 1;
      idx.push(aI, bI, cI, bI, dI, cI);
    }
    var shaft = new THREE.BufferGeometry();
    shaft.setIndex(idx); shaft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shaft.computeVertexNormals();
    var na = shaft.attributes.normal;
    for (j = 0; j <= rows; j++) { // weld seam normals
      var i0 = j * (segs + 1), i1 = i0 + segs;
      var nx = na.getX(i0) + na.getX(i1), ny = na.getY(i0) + na.getY(i1), nz = na.getZ(i0) + na.getZ(i1), l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      na.setXYZ(i0, nx / l, ny / l, nz / l); na.setXYZ(i1, nx / l, ny / l, nz / l);
    }
    var g = mergeGeos([{ geo: lathe, mat: 0 }, { geo: capG, mat: 0 }, { geo: shaft, mat: 0 }, { geo: rec, mat: 1 }]);
    g.computeBoundingSphere();
    lathe.dispose(); capG.dispose(); rec.dispose(); shaft.dispose();
    return g;
  }

  // ------------------------------------------------------------------ shared state
  var S = null; // shared textures/materials, built in init
  function ensure() { if (!S) throw new Error('G.Props.init(renderer) must be called first'); }

  function buildEnvScene(eve) {
    var sc = new THREE.Scene();
    function bm(r, g, b) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.BackSide }); }
    var mats = eve ? [
      bm(0.10, 0.125, 0.16), bm(0.11, 0.135, 0.17), bm(0.13, 0.155, 0.195), bm(0.05, 0.045, 0.045), bm(0.09, 0.115, 0.15), bm(0.12, 0.145, 0.185)
    ] : [
      bm(0.42, 0.38, 0.32), bm(0.46, 0.41, 0.35), bm(0.6, 0.58, 0.55), bm(0.12, 0.08, 0.05), bm(0.40, 0.37, 0.32), bm(0.55, 0.52, 0.47)
    ];
    var box = new THREE.Mesh(new THREE.BoxGeometry(7, 2.9, 6), mats); box.position.set(0, 1.05, 0.5); sc.add(box);
    function quad(w, h, col, x, y, z, ry, rx) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0, 'YXZ'); sc.add(m); return m;
    }
    if (!eve) {
      quad(2.0, 1.5, new THREE.Color(9, 8.6, 8.0), -3.45, 1.4, 1.4, Math.PI / 2);   // sunny window, left-front
      quad(1.0, 1.3, new THREE.Color(2.6, 2.8, 3.2), 0.6, 1.4, 3.7, Math.PI);       // second window behind camera (sky)
      quad(1.6, 1.2, new THREE.Color(1.5, 1.15, 0.8), 1.0, -0.43, -0.6, 0, -Math.PI / 2); // sun patch on floor
      quad(1.2, 0.9, new THREE.Color(0.06, 0.05, 0.045), 3.45, 0.2, -0.5, -Math.PI / 2); // dark furniture right
      quad(1.5, 1.0, new THREE.Color(0.08, 0.065, 0.05), -1.2, 0.1, 3.45, Math.PI);    // sofa behind
      quad(3.0, 0.25, new THREE.Color(4.0, 3.9, 3.7), 0, 2.48, 0.2, 0, Math.PI / 2);   // ceiling light strip
    } else {
      quad(2.0, 1.5, new THREE.Color(1.5, 0.75, 0.42), -3.45, 1.3, 1.4, Math.PI / 2);
      quad(1.0, 1.3, new THREE.Color(0.35, 0.4, 0.7), 0.6, 1.4, 3.7, Math.PI);
      quad(0.5, 0.5, new THREE.Color(2.2, 1.5, 0.8), 0.6, 1.6, -2.4, 0);           // lamp-lit area
    }
    return sc;
  }
  function disposeScene(sc) {
    sc.traverse(function (o) { if (o.isMesh) { o.geometry.dispose(); var m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(function (x) { x.dispose(); }); } });
  }

  P.init = function (renderer) {
    if (S) return { envMap: S.envDay };
    try { ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1); } catch (e) { ANISO = 1; }
    S = {};
    var wf = genWoodFace(1234), we = genEndGrain(99), fl = genFloor(2024), pl = genPlaster(), fe = genFelt();
    S.woodMap = texFrom(wf.map, true, true); S.woodData = texFrom(wf.data, false, true);
    S.endMap = texFrom(we.map, true, true); S.endData = texFrom(we.data, false, true);
    S.floorMap = texFrom(fl.map, true, true); S.floorData = texFrom(fl.data, false, true);
    S.wallMap = texFrom(pl.map, true, true); S.wallData = texFrom(pl.data, false, true);
    S.feltMap = texFrom(fe.map, true, false); S.feltData = texFrom(fe.data, false, false);
    var hd = genHoleDecal();
    S.holeMap = texFrom(hd.map, true, false); S.holeNormal = texFrom(hd.normal, false, false);
    S.grooveMap = texFrom(genGrooveDecal(), true, false);
    S.windowMask = texFrom(genWindowMask(), false, false); S.windowMask.channel = 1;
    S.haloTex = texFrom(genRadial(128, function (r) { var a = 1 - r; return Math.pow(a, 2.2) * 0.75 + Math.exp(-r * r * 18) * 0.25; }), true, false);
    S.ledTex = texFrom(genRadial(128, function (r) { return (1 - smooth(0.35, 1.0, r)) * 0.8 + Math.exp(-r * r * 10) * 0.2; }), true, false);
    S.hand = genHand(); S.handTex = texFrom(S.hand.canvas, true, false);

    S.woodFace = new THREE.MeshStandardMaterial({ map: S.woodMap, roughnessMap: S.woodData, bumpMap: S.woodData, bumpScale: 1.2, roughness: 1, metalness: 0 });
    S.woodEnd = new THREE.MeshStandardMaterial({ map: S.endMap, roughnessMap: S.endData, bumpMap: S.endData, bumpScale: 1.5, roughness: 1, metalness: 0 });
    S.holeMat = new THREE.MeshStandardMaterial({ map: S.holeMap, normalMap: S.holeNormal, transparent: true, depthWrite: false, roughness: 0.85 });
    S.grooveMat = new THREE.MeshStandardMaterial({ map: S.grooveMap, transparent: true, depthWrite: false, roughness: 0.9 });
    S.zinc = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.65, 0.69), metalness: 1.0, roughness: 0.24 });
    S.zincRecess = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.44, 0.47), metalness: 0.85, roughness: 0.45, side: THREE.BackSide });
    S.screwGeo = buildScrewGeo();

    var pm = new THREE.PMREMGenerator(renderer);
    var e0 = buildEnvScene(false), e1 = buildEnvScene(true);
    S.envDay = pm.fromScene(e0, 0.03).texture;
    S.envEve = pm.fromScene(e1, 0.03).texture;
    pm.dispose(); disposeScene(e0); disposeScene(e1);
    return { envMap: S.envDay };
  };

  // ------------------------------------------------------------------ lights
  var SHADOW_BOX = { x0: -1.6, x1: 1.7, y0: 0, y1: 1.1, z0: -1.3, z1: 1.0 };
  function fitShadow(sun) {
    var m = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0));
    m.setPosition(sun.position);
    var inv = m.clone().invert(), v = new THREE.Vector3();
    var mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9, B = SHADOW_BOX;
    for (var i = 0; i < 8; i++) {
      v.set(i & 1 ? B.x1 : B.x0, i & 2 ? B.y1 : B.y0, i & 4 ? B.z1 : B.z0).applyMatrix4(inv);
      mnx = Math.min(mnx, v.x); mxx = Math.max(mxx, v.x); mny = Math.min(mny, v.y); mxy = Math.max(mxy, v.y); mnz = Math.min(mnz, v.z); mxz = Math.max(mxz, v.z);
    }
    var c = sun.shadow.camera;
    c.left = mnx - 0.05; c.right = mxx + 0.05; c.bottom = mny - 0.05; c.top = mxy + 0.05;
    c.near = Math.max(0.05, -mxz - 0.3); c.far = -mnz + 0.3;
    c.updateProjectionMatrix();
  }

  P.makeLights = function (scene, opts) {
    ensure();
    var low = !!(opts && opts.low);
    var target = new THREE.Object3D(); target.position.set(0.05, 0, -0.2); scene.add(target);
    var sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.target = target;
    sun.castShadow = true;
    sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = low ? 0.006 : 0.004;
    scene.add(sun);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x886650, 0.3);
    scene.add(hemi);
    scene.environment = S.envDay;

    var DAY = { dir: new THREE.Vector3(-1.6, 2.05, 1.55), sun: new THREE.Color(1.0, 0.92, 0.82), si: 3.6, sky: new THREE.Color(1.0, 0.97, 0.93), gnd: new THREE.Color(0.55, 0.42, 0.32), hi: 0.3, env: 1.0 };
    var EVE = { dir: new THREE.Vector3(-2.3, 1.15, 1.2), sun: new THREE.Color(1.0, 0.6, 0.34), si: 0.7, sky: new THREE.Color(0.5, 0.62, 0.86), gnd: new THREE.Color(0.26, 0.25, 0.26), hi: 0.55, env: 1.0 };
    var curK = -1, tmpV = new THREE.Vector3();
    function setMood(k) {
      k = clamp(+k || 0, 0, 1);
      tmpV.copy(DAY.dir).lerp(EVE.dir, k).normalize().multiplyScalar(4);
      sun.position.copy(target.position).add(tmpV);
      sun.color.copy(DAY.sun).lerp(EVE.sun, k);
      sun.intensity = DAY.si + (EVE.si - DAY.si) * k;
      hemi.color.copy(DAY.sky).lerp(EVE.sky, k);
      hemi.groundColor.copy(DAY.gnd).lerp(EVE.gnd, k);
      hemi.intensity = DAY.hi + (EVE.hi - DAY.hi) * k;
      // environment: cross over at k=0.5 with matched brightness
      var useEve = k >= 0.5, f;
      if (!useEve) f = 1 - 0.55 * (k / 0.5); else f = 1.35 - 0.35 * ((k - 0.5) / 0.5);
      scene.environment = useEve ? S.envEve : S.envDay;
      scene.traverse(function (o) {
        if (!o.isMesh) return;
        var arr = Array.isArray(o.material) ? o.material : [o.material];
        for (var i = 0; i < arr.length; i++) {
          var m = arr[i]; if (!m || !m.isMeshStandardMaterial) continue;
          if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
          m.envMapIntensity = m.userData.envBase * f;
        }
      });
      if (k !== curK) { sun.updateMatrixWorld(); target.updateMatrixWorld(); fitShadow(sun); }
      curK = k;
    }
    setMood(0);
    return { setMood: setMood, sun: sun, hemi: hemi };
  };

  // ------------------------------------------------------------------ room
  var SUN_DIR = new THREE.Vector3(1.6, -2.05, -1.55).normalize();
  P.makeRoom = function () {
    ensure();
    var room = new THREE.Group(); room.name = 'room';
    // floor
    var fg = new THREE.PlaneGeometry(9, 6.5, 1, 1); fg.rotateX(-Math.PI / 2); fg.translate(0, 0, 1.9);
    function floorUV(g) {
      var p = g.attributes.position, uv = [];
      for (var i = 0; i < p.count; i++) uv.push(p.getZ(i) / FLOOR_LU + 0.37, p.getX(i) / FLOOR_LV + 0.21);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    floorUV(fg);
    var floorMat = new THREE.MeshStandardMaterial({ map: S.floorMap, roughnessMap: S.floorData, bumpMap: S.floorData, bumpScale: 1.5, roughness: 1, metalness: 0 });
    var floor = new THREE.Mesh(fg, floorMat); floor.receiveShadow = true; floor.name = 'floor'; room.add(floor);
    // wall
    var wg = new THREE.PlaneGeometry(9, DIM.wallH, 1, 1); wg.translate(0, DIM.wallH / 2, DIM.wallZ);
    var wp = wg.attributes.position, wuv = [];
    for (var i = 0; i < wp.count; i++) wuv.push(wp.getX(i) / 0.8, wp.getY(i) / 0.8);
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    var wallMat = new THREE.MeshStandardMaterial({ map: S.wallMap, roughnessMap: S.wallData, bumpMap: S.wallData, bumpScale: 0.6, roughness: 1, metalness: 0 });
    var wall = new THREE.Mesh(wg, wallMat); wall.receiveShadow = true; wall.name = 'wall'; room.add(wall);
    // baseboard (profile in depth/height, extruded along X)
    var bh = DIM.baseboardH, bd = 0.012, sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(bd, 0); sh.lineTo(bd, bh - 0.004); sh.lineTo(bd - 0.0025, bh - 0.0005); sh.lineTo(bd - 0.004, bh); sh.lineTo(0, bh); sh.closePath();
    var bg = new THREE.ExtrudeGeometry(sh, { depth: 9, bevelEnabled: false });
    bg.rotateY(-Math.PI / 2); bg.translate(4.5, 0, DIM.wallZ);
    bg.deleteAttribute('uv');
    var bbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.85, 0.82, THREE.SRGBColorSpace), roughness: 0.42, metalness: 0 });
    var bb = new THREE.Mesh(bg, bbMat); bb.castShadow = true; bb.receiveShadow = true; bb.name = 'baseboard'; room.add(bb);

    // sunlight patch: window projected along the sun direction (affine → exact per-vertex UV)
    var C = new THREE.Vector3(1.05, 0, -0.86), U = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 1, 0)).normalize(), V = new THREE.Vector3().crossVectors(U, SUN_DIR).normalize();
    var winW = 0.95, winH = 1.15, tmp = new THREE.Vector3();
    function patchUV(g) {
      var p = g.attributes.position, uv1 = [];
      for (var i = 0; i < p.count; i++) {
        tmp.set(p.getX(i), p.getY(i), p.getZ(i)).sub(C);
        uv1.push(tmp.dot(U) / winW + 0.5, tmp.dot(V) / winH + 0.5);
      }
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    }
    var patchMats = [];
    function patchMesh(g, map, cosF) {
      patchUV(g);
      // Lambert lit by the sun only (ambient/hemisphere removed) → extra direct sunlight that respects shadows
      var m = new THREE.MeshLambertMaterial({ map: map || null, color: 0xffffff, alphaMap: S.windowMask, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      m.onBeforeCompile = function (sh) {
        var chunk = THREE.ShaderChunk.lights_fragment_begin
          .replace('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );', 'vec3 irradiance = vec3( 0.0 );')
          .replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', '');
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
      };
      m.customProgramCacheKey = function () { return 'sunPatch'; };
      m.userData.cosF = cosF; patchMats.push(m);
      var me = new THREE.Mesh(g, m); me.renderOrder = 1; me.receiveShadow = true; room.add(me); return me;
    }
    var pf = new THREE.PlaneGeometry(3.4, 2.2); pf.rotateX(-Math.PI / 2); pf.translate(1.1, 0.0004, -0.15);
    floorUV(pf);
    patchMesh(pf, S.floorMap, 1);
    var pw = new THREE.PlaneGeometry(3.4, 2.0); pw.translate(1.1, 1.0, DIM.wallZ + 0.0004);
    patchMesh(pw, null, 1);
    var pb = new THREE.PlaneGeometry(3.4, bh - 0.004); pb.translate(1.1, (bh - 0.004) / 2, DIM.wallZ + bd + 0.0004);
    patchMesh(pb, null, 1);
    var cWarm = new THREE.Color(1.0, 0.95, 0.86), cOr = new THREE.Color(1.0, 0.62, 0.36), cTmp = new THREE.Color();
    room.userData.setMood = function (k) {
      k = clamp(+k || 0, 0, 1);
      var s = (1 - smooth(0.25, 1.0, k)) * 1.1;
      cTmp.copy(cWarm).lerp(cOr, smooth(0, 0.7, k));
      for (var i = 0; i < patchMats.length; i++) {
        var m = patchMats[i];
        m.color.copy(cTmp).multiplyScalar(s * (m.map ? 1.0 : 0.6));
        m.visible = s > 0.001;
      }
    };
    room.userData.setMood(0);
    return room;
  };

  // ------------------------------------------------------------------ mat
  P.makeMat = function () {
    ensure();
    var M = DIM.mat;
    var g = roundedBox([M.w, M.h, M.d], 0.0022, 2, function (n, s, p) {
      if (n === 1) return { mat: 0, u: p[0] / M.w + 0.5, v: (s > 0 ? -p[2] : p[2]) / M.d + 0.5 };
      return { mat: 1, u: 0, v: 0 };
    });
    var top = new THREE.MeshStandardMaterial({ map: S.feltMap, roughnessMap: S.feltData, bumpMap: S.feltData, bumpScale: 1.0, roughness: 1, metalness: 0 });
    var side = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.26, 0.27, 0.285, THREE.SRGBColorSpace), roughness: 0.92, metalness: 0 });
    var me = new THREE.Mesh(g, [top, side]); me.position.y = M.h / 2;
    me.castShadow = true; me.receiveShadow = true;
    var grp = new THREE.Group(); grp.name = 'mat'; grp.add(me);
    return grp;
  };

  // ------------------------------------------------------------------ shelf parts
  var partSeed = 1;
  function makeBoard(size, gA, tA, wA, name) {
    var R = rng(9000 + (partSeed++) * 131);
    var off = { fu: [R(), R()], fv: [R(), R()], eu: [R(), R()], ev: [R(), R()], nu: [R(), R()], nv: [R() * 0.6, R() * 0.6] };
    var g = roundedBox(size, 0.0016, 3, function (n, s, p) {
      var si = s > 0 ? 0 : 1;
      if (n === tA) return { mat: 0, u: p[gA] / WOOD_LU + off.fu[si], v: p[wA] / WOOD_LV + off.fv[si] };
      if (n === wA) return { mat: 0, u: p[gA] / WOOD_LU + off.eu[si], v: p[tA] / WOOD_LV + off.ev[si] };
      return { mat: 1, u: p[wA] / END_LU + off.nu[si], v: p[tA] / END_LV + 0.2 + off.nv[si] };
    });
    var mesh = new THREE.Mesh(g, [S.woodFace.clone(), S.woodEnd.clone()]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name + '_wood';
    var grp = new THREE.Group(); grp.name = name; grp.add(mesh);
    return grp;
  }
  function decalQuads(list, w, h) { // list of {pos:[x,y,z], ry}
    var pos = [], nor = [], uv = [], idx = [], v = new THREE.Vector3(), nrm = new THREE.Vector3();
    list.forEach(function (q, qi) {
      var m = new THREE.Matrix4().makeRotationY(q.ry); m.setPosition(q.pos[0], q.pos[1], q.pos[2]);
      var cs = [[-w / 2, -h / 2, 0, 0], [w / 2, -h / 2, 1, 0], [w / 2, h / 2, 1, 1], [-w / 2, h / 2, 0, 1]];
      nrm.set(0, 0, 1).applyMatrix4(new THREE.Matrix4().makeRotationY(q.ry));
      cs.forEach(function (c) { v.set(c[0], c[1], 0).applyMatrix4(m); pos.push(v.x, v.y, v.z); nor.push(nrm.x, nrm.y, nrm.z); uv.push(c[2], c[3]); });
      var b = qi * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    var g = new THREE.BufferGeometry(); g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }
  function makeSide(sign, name) {
    var grp = makeBoard([DIM.T, DIM.H, DIM.D], 1, 0, 2, name);
    var ox = sign * (DIM.T / 2 + 0.00012), ix = -sign * (DIM.T / 2 + 0.00012);
    var holes = [], grooves = [];
    for (var i = 0; i < 3; i++) {
      var y = DIM.boardY[i] - DIM.H / 2;
      holes.push({ pos: [ox, y, DIM.screwZ], ry: sign * Math.PI / 2 }, { pos: [ox, y, -DIM.screwZ], ry: sign * Math.PI / 2 });
      grooves.push({ pos: [ix, y, 0], ry: -sign * Math.PI / 2 });
    }
    var hm = new THREE.Mesh(decalQuads(holes, HOLE_SIZE, HOLE_SIZE), S.holeMat.clone()); hm.receiveShadow = true; hm.renderOrder = 1; hm.name = name + '_holes';
    var gm = new THREE.Mesh(decalQuads(grooves, DIM.D, GROOVE_H), S.grooveMat.clone()); gm.receiveShadow = true; gm.renderOrder = 1; gm.name = name + '_grooves';
    grp.add(hm); grp.add(gm);
    grp.userData.home = { pos: new THREE.Vector3(sign * DIM.sideX, DIM.H / 2, 0), quat: new THREE.Quaternion() };
    addGlow(grp);
    return grp;
  }

  P.makeShelfParts = function () {
    ensure();
    var sideA = makeSide(1, 'sideA'), sideB = makeSide(-1, 'sideB');
    var boards = [];
    for (var i = 0; i < 3; i++) {
      // +3mm each end: the board sits in the side's dado (hides light leaks through the rounded edges)
      var b = makeBoard([DIM.boardLen + 0.006, DIM.T, DIM.D], 0, 1, 2, 'board' + i);
      b.userData.home = { pos: new THREE.Vector3(0, DIM.boardY[i], 0), quat: new THREE.Quaternion() };
      addGlow(b); boards.push(b);
    }
    var screws = [], qA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), qB = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    for (var s = 0; s < 12; s++) {
      var side = s < 6 ? 1 : -1, j = s % 6, y = DIM.boardY[j >> 1], z = (j & 1) ? -DIM.screwZ : DIM.screwZ;
      var m = new THREE.Mesh(S.screwGeo, [S.zinc.clone(), S.zincRecess.clone()]);
      m.castShadow = true; m.receiveShadow = true; m.name = 'screw' + s + '_mesh';
      m.rotation.y = (s * 1.37) % (Math.PI * 2); // vary the cross orientation
      var sg = new THREE.Group(); sg.name = 'screw' + s; sg.add(m);
      sg.userData.home = { pos: new THREE.Vector3(side * (DIM.sideX + DIM.T / 2), y, z), quat: (side > 0 ? qA : qB).clone() };
      sg.userData.axisOut = new THREE.Vector3(side, 0, 0);
      addGlow(sg); screws.push(sg);
    }
    return { sideA: sideA, sideB: sideB, boards: boards, screws: screws };
  };

  // ------------------------------------------------------------------ hint lights & hand
  P.makeHalo = function (opts) {
    ensure();
    var bill = !!(opts && opts.billboard), grp = new THREE.Group(), col = new THREE.Color(1.0, 0.86, 0.6), base = 0.7, obj, mat;
    if (bill) {
      mat = new THREE.SpriteMaterial({ map: S.haloTex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: base });
      obj = new THREE.Sprite(mat); obj.scale.set(2, 2, 1);
    } else {
      var g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
      mat = new THREE.MeshBasicMaterial({ map: S.haloTex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: base, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      obj = new THREE.Mesh(g, mat);
    }
    obj.renderOrder = 5; grp.add(obj); grp.name = 'halo';
    grp.userData.setStrength = function (k) { k = clamp(+k || 0, 0, 1); mat.opacity = base * k; obj.visible = k > 0.001; };
    return grp;
  };

  P.makeLedSpot = function () {
    ensure();
    var g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({ map: S.ledTex, color: new THREE.Color(0.85, 0.93, 1.0), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var m = new THREE.Mesh(g, mat); m.renderOrder = 5;
    var grp = new THREE.Group(); grp.name = 'ledSpot'; grp.add(m);
    grp.userData.setStrength = function (k) { k = clamp(+k || 0, 0, 1); mat.opacity = 0.45 * k; m.visible = k > 0.001; };
    return grp;
  };

  P.makeGhostHand = function () {
    ensure();
    var h = S.hand;
    var mat = new THREE.SpriteMaterial({ map: S.handTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0.92 });
    var sp = new THREE.Sprite(mat);
    sp.center.set(h.tipX / h.W, 1 - h.tipY / h.H);
    var hgt = 0.17 * h.H / (440 - h.tipY); // fingertip to visible wrist ≈ 0.17 m
    sp.scale.set(hgt * h.W / h.H, hgt, 1);
    sp.renderOrder = 999;
    var grp = new THREE.Group(); grp.name = 'ghostHand'; grp.renderOrder = 999; grp.add(sp);
    grp.userData.sprite = sp;
    grp.userData.setOpacity = function (k) { k = clamp(+k || 0, 0, 1); mat.opacity = 0.92 * k; sp.visible = k > 0.001; };
    return grp;
  };
})();
