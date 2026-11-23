// geom.js — 溝の断面を中心線に沿って掃く・丸い取っ手などの形
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var G = (KK.geom = {});

  // 角を丸めた多角形（radii[i] は点 i の丸め半径）
  G.roundPoly = function (pts, radii, seg) {
    seg = seg || 3;
    var out = [], n = pts.length;
    for (var i = 0; i < n; i++) {
      var r = radii[i] || 0;
      var p = pts[i];
      if (r <= 0) { out.push({ a: p[0], b: p[1], smooth: false }); continue; }
      var pp = pts[(i - 1 + n) % n], pn = pts[(i + 1) % n];
      var d1x = pp[0] - p[0], d1y = pp[1] - p[1];
      var d2x = pn[0] - p[0], d2y = pn[1] - p[1];
      var l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
      d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
      var rr = Math.min(r, l1 * 0.45, l2 * 0.45);
      var p1 = [p[0] + d1x * rr, p[1] + d1y * rr];
      var p2 = [p[0] + d2x * rr, p[1] + d2y * rr];
      for (var k = 0; k <= seg; k++) {
        var t = k / seg;
        // 二次ベジェで角をなでる
        var a = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * p[0] + t * t * p2[0];
        var b = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * p[1] + t * t * p2[1];
        out.push({ a: a, b: b, smooth: k > 0 && k < seg, edge: k === 0 || k === seg });
      }
    }
    // 角の端点も丸め区間に接しているので smooth 扱い
    for (i = 0; i < out.length; i++) if (out[i].edge) out[i].smooth = true;
    return out;
  };

  // 溝の断面（+a 側の壁高 hR、−a 側の壁高 hL）
  G.troughProfile = function (opt) {
    opt = opt || {};
    var wi = opt.inner || C.INNER, wt = opt.wallT || C.WALL_T;
    var hR = opt.hR || C.WALL_H, hL = opt.hL || C.WALL_H, bt = opt.baseT || C.BASE_T;
    var W = wi + wt;
    var pts = [
      [W, -bt], [W, hR], [wi, hR], [wi, 0], [-wi, 0], [-wi, hL], [-W, hL], [-W, -bt]
    ];
    var radii = [0.12, 0.2, 0.16, 0.35, 0.35, 0.16, 0.2, 0.12];
    return G.roundPoly(pts, radii, 3);
  };

  // samples: [{x,y,z}] 中心線（局所座標）。frame: 横 S = Y×T（水平）、上 = Y
  G.sweep = function (samples, profile, opt) {
    opt = opt || {};
    var ns = samples.length, np = profile.length;
    var uScale = opt.uScale || 20, vScale = opt.vScale || 8;
    // 各点の接線と横向き
    var Ts = [], Ss = [], cum = [0];
    for (var i = 0; i < ns; i++) {
      var a = samples[Math.max(0, i - 1)], b = samples[Math.min(ns - 1, i + 1)];
      var tx = b.x - a.x, tz = b.z - a.z;
      var l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      Ts.push([tx, tz]);
      // S = Y × T = (tz, 0, -tx)
      Ss.push([tz, -tx]);
      if (i > 0) {
        var p = samples[i - 1], q = samples[i];
        cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
      }
    }
    // 断面の辺法線
    var segN = [], per = [0];
    for (var j = 0; j < np; j++) {
      var p0 = profile[j], p1 = profile[(j + 1) % np];
      var dx = p1.a - p0.a, dy = p1.b - p0.b, dl = Math.hypot(dx, dy) || 1;
      segN.push([dy / dl, -dx / dl]);
      per.push(per[j] + dl);
    }
    var pos = [], nor = [], uv = [], idx = [];
    var vcount = 0;
    for (j = 0; j < np; j++) {
      var j1 = (j + 1) % np;
      var nA = segN[j], nB = segN[j];
      if (profile[j].smooth) { var m = segN[(j - 1 + np) % np]; nA = norm2(nA[0] + m[0], nA[1] + m[1]); }
      if (profile[j1].smooth) { var m2 = segN[j1]; nB = norm2(nB[0] + m2[0], nB[1] + m2[1]); }
      var base = vcount;
      for (i = 0; i < ns; i++) {
        var s = samples[i], S = Ss[i];
        var pa = profile[j], pb = profile[j1];
        pos.push(s.x + S[0] * pa.a, s.y + pa.b, s.z + S[1] * pa.a);
        nor.push(S[0] * nA[0], nA[1], S[1] * nA[0]);
        uv.push(cum[i] / uScale, per[j] / vScale);
        pos.push(s.x + S[0] * pb.a, s.y + pb.b, s.z + S[1] * pb.a);
        nor.push(S[0] * nB[0], nB[1], S[1] * nB[0]);
        uv.push(cum[i] / uScale, per[j + 1] / vScale);
        vcount += 2;
      }
      for (i = 0; i < ns - 1; i++) {
        var A = base + i * 2, B = A + 1, D = A + 2, Cc = A + 3;
        idx.push(A, B, Cc, A, Cc, D);
      }
    }
    // 端の蓋
    if (opt.caps !== false) {
      var contour = profile.map(function (p) { return new T.Vector2(p.a, p.b); });
      var tris = T.ShapeUtils.triangulateShape(contour, []);
      [0, ns - 1].forEach(function (k) {
        var s = samples[k], S = Ss[k], Tt = Ts[k];
        var dir = k === 0 ? -1 : 1;
        var b0 = vcount;
        for (var q = 0; q < np; q++) {
          var pr = profile[q];
          pos.push(s.x + S[0] * pr.a, s.y + pr.b, s.z + S[1] * pr.a);
          nor.push(Tt[0] * dir, 0, Tt[1] * dir);
          uv.push(pr.a / vScale + 0.3, pr.b / vScale);
          vcount++;
        }
        tris.forEach(function (t) {
          // 向きを法線と合わせる
          var i0 = b0 + t[0], i1 = b0 + t[1], i2 = b0 + t[2];
          var ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
          var ux = pos[i1 * 3] - ax, uy = pos[i1 * 3 + 1] - ay, uz = pos[i1 * 3 + 2] - az;
          var vx = pos[i2 * 3] - ax, vy = pos[i2 * 3 + 1] - ay, vz = pos[i2 * 3 + 2] - az;
          var cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
          var dot = cx * Tt[0] * dir + cz * Tt[1] * dir;
          if (dot >= 0) idx.push(i0, i1, i2); else idx.push(i0, i2, i1);
        });
      });
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  function norm2(x, y) { var l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

  // 丸いつまみ（回転体）
  G.knob = function (r, h) {
    var pts = [];
    pts.push(new T.Vector2(0.0001, 0));
    pts.push(new T.Vector2(r * 0.55, 0));
    pts.push(new T.Vector2(r * 0.6, h * 0.12));
    for (var i = 0; i <= 8; i++) {
      var a = (i / 8) * Math.PI * 0.5;
      pts.push(new T.Vector2(r * 0.72 + Math.sin(a) * r * 0.28, h * 0.25 + (1 - Math.cos(a)) * h * 0.2));
    }
    for (i = 0; i <= 8; i++) {
      var b = (i / 8) * Math.PI * 0.5;
      pts.push(new T.Vector2(r * Math.cos(b) * 0.98 + 0.0001, h * 0.45 + Math.sin(b) * h * 0.55));
    }
    return new T.LatheGeometry(pts, 24);
  };

  // 角を丸めた箱
  G.roundBox = function (w, h, d, r) {
    r = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
    var s = new T.Shape();
    var x = -w / 2, z = -d / 2;
    s.moveTo(x + r, z);
    s.lineTo(x + w - r, z); s.quadraticCurveTo(x + w, z, x + w, z + r);
    s.lineTo(x + w, z + d - r); s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
    s.lineTo(x + r, z + d); s.quadraticCurveTo(x, z + d, x, z + d - r);
    s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
    var bev = Math.min(r * 0.6, h * 0.3);
    var g = new T.ExtrudeGeometry(s, { depth: h - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 3, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, bev, 0);
    g.computeVertexNormals();
    return g;
  };

  // 角を丸めた長円（スタジアム形）の輪郭
  G.stadiumShape = function (halfLen, halfW, seg) {
    var s = new T.Shape(), c = halfLen - halfW;
    seg = seg || 20;
    s.moveTo(halfW, -c);
    s.lineTo(halfW, c);
    s.absarc(0, c, halfW, 0, Math.PI, false);
    s.lineTo(-halfW, -c);
    s.absarc(0, -c, halfW, Math.PI, Math.PI * 2, false);
    return s;
  };
})();
