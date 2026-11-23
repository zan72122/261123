/* trough.js — 半円の樋の形（中心線・断面）、立体の組み上げ、当たり判定 */
(function () {
  'use strict';
  var SG = window.SG;
  var T = THREE;
  var K = SG.K;

  // 樋の中心線：底の内側の線。水平方向は直線または円弧、高さは一次。
  function TroughPath(L, lipLen, R, wall, lipT) {
    this.L = L;
    this.lipLen = lipLen;
    this.R = R || K.R;
    this.wall = wall || K.WALL;
    this.lipT = lipT || K.LIPT;
    this.x0 = 0; this.z0 = 0; this.psi0 = 0; this.theta = 0;
    this.y0 = 0; this.g = 0;
    this.version = 0;
    this.box = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  }
  TroughPath.prototype.set = function (x0, z0, psi0, theta, y0, g) {
    this.x0 = x0; this.z0 = z0; this.psi0 = psi0; this.theta = theta; this.y0 = y0; this.g = g;
    this.version++;
    this._bounds();
    return this;
  };
  TroughPath.prototype.copyFrom = function (o) {
    return this.set(o.x0, o.z0, o.psi0, o.theta, o.y0, o.g);
  };
  TroughPath.prototype.isCurve = function () { return Math.abs(this.theta) > 1e-4; };
  TroughPath.prototype.psi = function (s) { return this.psi0 + this.theta * s / this.L; };
  TroughPath.prototype.y = function (s) { return this.y0 + this.g * s; };
  TroughPath.prototype.posXZ = function (s, out) {
    if (!this.isCurve()) {
      out.x = this.x0 + Math.cos(this.psi0) * s;
      out.z = this.z0 + Math.sin(this.psi0) * s;
    } else {
      var rho = this.L / this.theta, p = this.psi(s);
      out.x = this.x0 + rho * (Math.sin(p) - Math.sin(this.psi0));
      out.z = this.z0 - rho * (Math.cos(p) - Math.cos(this.psi0));
    }
    return out;
  };
  TroughPath.prototype.bottom = function (s, out) {
    this.posXZ(s, out);
    out.y = this.y(s);
    return out;
  };
  // 接線 T、横 N（水平）、上 B
  TroughPath.prototype.frame = function (s, Tv, Nv, Bv) {
    var p = this.psi(s), c = Math.cos(p), sn = Math.sin(p);
    var inv = 1 / Math.sqrt(1 + this.g * this.g);
    Tv.set(c * inv, this.g * inv, sn * inv);
    Nv.set(sn, 0, -c);
    Bv.crossVectors(Tv, Nv);
  };
  TroughPath.prototype.axis = function (s, out) {
    this.bottom(s, out);
    var p = this.psi(s), c = Math.cos(p), sn = Math.sin(p);
    var inv = 1 / Math.sqrt(1 + this.g * this.g);
    // B = T x N
    var tx = c * inv, ty = this.g * inv, tz = sn * inv;
    var nx = sn, nz = -c;
    var bx = ty * nz - tz * 0, by = tz * nx - tx * nz, bz = tx * 0 - ty * nx;
    out.x += bx * this.R; out.y += by * this.R; out.z += bz * this.R;
    return out;
  };
  // 点の位置 → s, u（横）, w（軸からの上下）
  var _a = new T.Vector3(), _T = new T.Vector3(), _N = new T.Vector3(), _B = new T.Vector3();
  TroughPath.prototype.locate = function (px, py, pz, out) {
    var s;
    if (!this.isCurve()) {
      s = (px - this.x0) * Math.cos(this.psi0) + (pz - this.z0) * Math.sin(this.psi0);
    } else {
      var rho = this.L / this.theta;
      var cx = this.x0 - rho * Math.sin(this.psi0);
      var cz = this.z0 + rho * Math.cos(this.psi0);
      var sp = (px - cx) / rho, cp = -(pz - cz) / rho;
      var ps = Math.atan2(sp, cp);
      var dp = SG.wrapAngle(ps - this.psi0);
      s = dp * this.L / this.theta;
    }
    this.axis(s, _a);
    this.frame(s, _T, _N, _B);
    var dx = px - _a.x, dy = py - _a.y, dz = pz - _a.z;
    out.s = s;
    out.u = dx * _N.x + dy * _N.y + dz * _N.z;
    out.w = dx * _B.x + dy * _B.y + dz * _B.z;
    out.t = dx * _T.x + dy * _T.y + dz * _T.z;
    return out;
  };
  TroughPath.prototype.wallAt = function (s) {
    return s > this.L - this.lipLen ? this.lipT : this.wall;
  };
  TroughPath.prototype._bounds = function () {
    var b = this.box, p = { x: 0, z: 0 };
    b.x0 = b.z0 = b.y0 = 1e9; b.x1 = b.z1 = b.y1 = -1e9;
    for (var i = 0; i <= 8; i++) {
      var s = this.L * i / 8;
      this.posXZ(s, p);
      var y = this.y(s);
      if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x;
      if (p.z < b.z0) b.z0 = p.z; if (p.z > b.z1) b.z1 = p.z;
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
    }
    var m = this.R + this.wall + 0.12;
    b.x0 -= m; b.x1 += m; b.z0 -= m; b.z1 += m; b.y0 -= 0.12; b.y1 += this.R * 2 + 0.1;
  };
  TroughPath.prototype.inBox = function (x, y, z) {
    var b = this.box;
    return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;
  };

  // 当たり：pos は Float32Array、i は粒の先頭。結果を res に。
  // 戻り値 0 なし / 1 内側 / 2 外側 / 3 縁
  var _loc = { s: 0, u: 0, w: 0, t: 0 };
  TroughPath.prototype.collide = function (P, i, r, res) {
    var px = P[i], py = P[i + 1], pz = P[i + 2];
    if (!this.inBox(px, py, pz)) return 0;
    var L = this.locate(px, py, pz, _loc);
    var s = L.s;
    if (s < 0 || s > this.L) return 0;
    var R = this.R, wt = this.wallAt(s);
    var u = L.u, w = L.w, nu = 0, nw = 0, type = 0, du = u, dw = w;
    res.s = s; res.u = u; res.w = w;
    if (w <= 0) {
      var d = Math.sqrt(u * u + w * w);
      if (d < 1e-6) return 0;
      if (d >= R - r && d <= R + wt * 0.5) {
        var k = (R - r) / d; du = u * k; dw = w * k;
        nu = -u / d; nw = -w / d; type = 1;
      } else if (d > R + wt * 0.5 && d < R + wt + r) {
        var k2 = (R + wt + r) / d; du = u * k2; dw = w * k2;
        nu = u / d; nw = w / d; type = 2;
      } else return 0;
    } else {
      var sg = u >= 0 ? 1 : -1;
      var cu = sg * (R + wt * 0.5), cr = wt * 0.5 + r;
      var eu = u - cu, ew = w;
      var dd = Math.sqrt(eu * eu + ew * ew);
      if (dd >= cr || dd < 1e-6) return 0;
      du = cu + eu / dd * cr; dw = ew / dd * cr;
      nu = eu / dd; nw = ew / dd; type = 3;
    }
    this.axis(s, _a);
    this.frame(s, _T, _N, _B);
    var t = L.t;
    P[i] = _a.x + _N.x * du + _B.x * dw + _T.x * t;
    P[i + 1] = _a.y + _N.y * du + _B.y * dw + _T.y * t;
    P[i + 2] = _a.z + _N.z * du + _B.z * dw + _T.z * t;
    res.nx = _N.x * nu + _B.x * nw; res.ny = _N.y * nu + _B.y * nw; res.nz = _N.z * nu + _B.z * nw;
    res.tx = _T.x; res.ty = _T.y; res.tz = _T.z;
    res.w = dw; res.u = du;
    return type;
  };

  SG.TroughPath = TroughPath;

  // ---- 立体の組み上げ ----
  // opts: { nArc, lipLen, R, wall, lipT, ds, caps }
  function profileRuns(R, wt, nArc) {
    var runs = [[], [], [], []], k, ph;
    for (k = 0; k <= nArc; k++) {
      ph = -Math.PI / 2 + Math.PI * k / nArc;
      runs[0].push({ u: R * Math.sin(ph), w: -R * Math.cos(ph), nu: -Math.sin(ph), nw: Math.cos(ph), v: 0.05 + 0.4 * k / nArc });
    }
    runs[1].push({ u: R, w: 0, nu: 0, nw: 1, v: 0.46 }, { u: R + wt, w: 0, nu: 0, nw: 1, v: 0.5 });
    for (k = 0; k <= nArc; k++) {
      ph = Math.PI / 2 - Math.PI * k / nArc;
      runs[2].push({ u: (R + wt) * Math.sin(ph), w: -(R + wt) * Math.cos(ph), nu: Math.sin(ph), nw: -Math.cos(ph), v: 0.52 + 0.43 * k / nArc });
    }
    runs[3].push({ u: -(R + wt), w: 0, nu: 0, nw: 1, v: 0.96 }, { u: -R, w: 0, nu: 0, nw: 1, v: 1.0 });
    return runs;
  }

  function sampleS(path, ds) {
    var L = path.L, out = [], n = Math.max(2, Math.ceil(L / ds));
    for (var i = 0; i <= n; i++) out.push(L * i / n);
    if (path.lipLen > 0) {
      var a = L - path.lipLen;
      out.push(a - 0.012, a + 0.012);
      out.sort(function (x, y) { return x - y; });
    }
    return out;
  }

  // 形（行列なし、ワールドの中心線から直接）
  SG.buildTroughGeometry = function (path, opts) {
    opts = opts || {};
    var nArc = opts.nArc || 12;
    var R = path.R;
    var ss = sampleS(path, opts.ds || (path.isCurve() ? 0.08 : 0.14));
    var pos = [], nor = [], uv = [], idx = [];
    var Tv = new T.Vector3(), Nv = new T.Vector3(), Bv = new T.Vector3(), A = new T.Vector3();
    var runsTemplate = profileRuns(R, path.wall, nArc);
    var runsLip = profileRuns(R, path.lipT, nArc);
    var runBase = [];
    var nS = ss.length;
    for (var r = 0; r < runsTemplate.length; r++) {
      runBase.push(pos.length / 3);
      var cnt = runsTemplate[r].length;
      for (var j = 0; j < nS; j++) {
        var s = ss[j];
        var wt = path.wallAt(s);
        var run = (wt === path.wall ? runsTemplate : runsLip)[r];
        path.axis(s, A); path.frame(s, Tv, Nv, Bv);
        for (var k = 0; k < cnt; k++) {
          var q = run[k];
          pos.push(A.x + Nv.x * q.u + Bv.x * q.w, A.y + Nv.y * q.u + Bv.y * q.w, A.z + Nv.z * q.u + Bv.z * q.w);
          nor.push(Nv.x * q.nu + Bv.x * q.nw, Nv.y * q.nu + Bv.y * q.nw, Nv.z * q.nu + Bv.z * q.nw);
          uv.push(s * 0.9, q.v);
        }
      }
      for (var j2 = 0; j2 < nS - 1; j2++) {
        for (var k2 = 0; k2 < cnt - 1; k2++) {
          var a = runBase[r] + j2 * cnt + k2, b = a + 1, c = a + cnt, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    // 端の面
    if (opts.caps !== false) {
      var ends = [0, path.L];
      for (var e = 0; e < 2; e++) {
        var s2 = ends[e], wt2 = path.wallAt(s2);
        path.axis(s2, A); path.frame(s2, Tv, Nv, Bv);
        var sgn = e === 0 ? -1 : 1;
        var base = pos.length / 3;
        for (var k3 = 0; k3 <= nArc; k3++) {
          var ph = -Math.PI / 2 + Math.PI * k3 / nArc;
          for (var m = 0; m < 2; m++) {
            var rr = m === 0 ? R : R + wt2;
            var u = rr * Math.sin(ph), w = -rr * Math.cos(ph);
            pos.push(A.x + Nv.x * u + Bv.x * w, A.y + Nv.y * u + Bv.y * w, A.z + Nv.z * u + Bv.z * w);
            nor.push(Tv.x * sgn, Tv.y * sgn, Tv.z * sgn);
            uv.push(s2 * 0.9, 0.5);
          }
        }
        for (var k4 = 0; k4 < nArc; k4++) {
          var a2 = base + k4 * 2;
          idx.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2);
        }
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };

  // 同じ数の頂点で形だけ更新（組みかえ中の毎コマ）
  SG.updateTroughGeometry = function (geom, path, opts) {
    var fresh = SG.buildTroughGeometry(path, opts);
    var a = geom.getAttribute('position');
    var b = fresh.getAttribute('position');
    if (!a || a.count !== b.count) {
      geom.setAttribute('position', b);
      geom.setAttribute('normal', fresh.getAttribute('normal'));
      geom.setAttribute('uv', fresh.getAttribute('uv'));
      geom.setIndex(fresh.getIndex());
    } else {
      a.array.set(b.array); a.needsUpdate = true;
      var na = geom.getAttribute('normal');
      na.array.set(fresh.getAttribute('normal').array); na.needsUpdate = true;
    }
    geom.computeBoundingSphere();
    fresh.dispose();
  };

  // 半円の断面積（深さ h）
  SG.segArea = function (R, h) {
    if (h <= 0) return 0;
    if (h >= R) return Math.PI * R * R / 2;
    var d = R - h;
    return R * R * Math.acos(d / R) - d * Math.sqrt(2 * R * h - h * h);
  };
  // 面積 → 深さ（表で引く）
  var areaTab = null, AT_N = 400;
  SG.depthFromArea = function (A) {
    var R = K.R;
    if (!areaTab) {
      areaTab = new Float32Array(AT_N + 1);
      for (var i = 0; i <= AT_N; i++) areaTab[i] = SG.segArea(R, R * i / AT_N);
    }
    if (A <= 0) return 0;
    if (A >= areaTab[AT_N]) return R + (A - areaTab[AT_N]) / (2 * R);
    var lo = 0, hi = AT_N;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (areaTab[mid] < A) lo = mid; else hi = mid; }
    var f = (A - areaTab[lo]) / (areaTab[hi] - areaTab[lo]);
    return R * (lo + f) / AT_N;
  };
  SG.surfWidth = function (R, h) {
    if (h <= 0) return 0;
    if (h >= R) return 2 * R;
    var d = R - h;
    return 2 * Math.sqrt(R * R - d * d);
  };
})();
