/* props_items.js — 小道具: 電動ドリル・電池・充電器・絵本・ランプ・空き箱
 * G.Props.makeDrill / poseDrillStanding / makeBattery / makeCharger / makeBook / makeLamp / makeKitBox
 * 依存: THREE（グローバル）。props_world.js には依存しない。テクスチャは canvas 手続き生成・遅延生成してキャッシュ。 */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var P = G.Props = G.Props || {};
  var T = window.THREE;
  var V3 = T.Vector3;
  var PI = Math.PI, TAU = Math.PI * 2;
  var RF = { willReadFrequently: true };
  var GLOW = { r: 1.0 * 0.55, g: 0.72 * 0.55, b: 0.35 * 0.55 };

  /* ---------------- 小さな道具 ---------------- */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function mkTex(c, srgb, repeat) {
    var t = new T.CanvasTexture(c);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    if (repeat) { t.wrapS = T.RepeatWrapping; t.wrapT = T.RepeatWrapping; }
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }
  var CACHE = {};
  function cached(key, fn) { if (!CACHE[key]) CACHE[key] = fn(); return CACHE[key]; }

  function grain(ctx, W, H, amt, seed) {
    var r = rng(seed || 7), img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (r() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  function rrect(x, X, Y, w, h, r) {
    x.beginPath();
    x.moveTo(X + r, Y); x.lineTo(X + w - r, Y); x.quadraticCurveTo(X + w, Y, X + w, Y + r);
    x.lineTo(X + w, Y + h - r); x.quadraticCurveTo(X + w, Y + h, X + w - r, Y + h);
    x.lineTo(X + r, Y + h); x.quadraticCurveTo(X, Y + h, X, Y + h - r);
    x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y); x.closePath();
  }
  function star(x, cx, cy, r, ri, rot) {
    x.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = (rot || 0) - PI / 2 + i * PI / 5, rr = i % 2 ? (ri || r * 0.45) : r;
      if (i === 0) x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
  }

  function std(o) { return new T.MeshStandardMaterial(o); }
  function mesh(geo, mat, cast, recv) {
    var m = new T.Mesh(geo, mat);
    m.castShadow = cast !== false; m.receiveShadow = recv !== false;
    return m;
  }

  /* 個体ごとの発光（setGlow）。emissive の元の値（base）を保持し、base + 暖色×0.55k にする */
  function setupGlow(root) {
    var list = [];
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m || !m.emissive) continue;
        var dup = false;
        for (var j = 0; j < list.length; j++) if (list[j].m === m) { dup = true; break; }
        if (!dup) list.push({ m: m, base: m.emissive.clone() });
      }
    });
    var glow = 0;
    function apply(e) {
      e.m.emissive.setRGB(e.base.r + GLOW.r * glow, e.base.g + GLOW.g * glow, e.base.b + GLOW.b * glow);
    }
    root.userData.setGlow = function (k) {
      glow = clamp(+k || 0, 0, 1);
      for (var i = 0; i < list.length; i++) apply(list[i]);
    };
    return {
      setBase: function (m, r, g, b) {
        for (var i = 0; i < list.length; i++) if (list[i].m === m) { list[i].base.setRGB(r, g, b); apply(list[i]); return; }
      }
    };
  }

  /* ---------------- ジオメトリ生成 ---------------- */
  // 回転体（Y 軸）。pts=[[r,y],...] を y 増加順。mod(phi,y,r) で半径を変調（ローレット・溝）。
  // 同じ点を2つ並べると折れ目（ハードエッジ）になる。
  function revolve(pts, seg, mod, opt) {
    opt = opt || {};
    var n = pts.length, pos = [], uv = [], idx = [];
    var ymin = Infinity, ymax = -Infinity, i, j;
    for (j = 0; j < n; j++) { ymin = Math.min(ymin, pts[j][1]); ymax = Math.max(ymax, pts[j][1]); }
    if (opt.vRange) { ymin = opt.vRange[0]; ymax = opt.vRange[1]; }
    for (i = 0; i <= seg; i++) {
      var u = i / seg, phi = u * TAU, s = Math.sin(phi), c = Math.cos(phi);
      for (j = 0; j < n; j++) {
        var r = pts[j][0], y = pts[j][1];
        if (mod && r > 0) r = mod(phi, y, r, j);
        pos.push(r * s, y, r * c);
        uv.push(u, (y - ymin) / ((ymax - ymin) || 1));
      }
    }
    for (i = 0; i < seg; i++) for (j = 0; j < n - 1; j++) {
      var a = i * n + j, b = (i + 1) * n + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    var nr = g.attributes.normal;
    for (j = 0; j < n; j++) {
      var i0 = j, i1 = seg * n + j;
      if (pts[j][0] === 0) {
        var sy = (j === 0) ? -1 : 1;
        for (i = 0; i <= seg; i++) nr.setXYZ(i * n + j, 0, sy, 0);
        continue;
      }
      var x = nr.getX(i0) + nr.getX(i1), yy = nr.getY(i0) + nr.getY(i1), z = nr.getZ(i0) + nr.getZ(i1);
      var l = Math.sqrt(x * x + yy * yy + z * z) || 1;
      nr.setXYZ(i0, x / l, yy / l, z / l); nr.setXYZ(i1, x / l, yy / l, z / l);
    }
    return g;
  }

  // 断面を並べて張るロフト。stations: {c:V3, w:V3(進行方向), u:V3(断面の横), pts:[[a,b],...]}（b は v=w×u 方向）
  function loft(stations, capStart, capEnd) {
    var S = stations.length, N = stations[0].pts.length, pos = [], uv = [], idx = [], i, j;
    var frames = stations.map(function (st) {
      var w = st.w.clone().normalize(), u = st.u.clone().normalize();
      var v = new V3().crossVectors(w, u).normalize();
      return { c: st.c, u: u, v: v, w: w, pts: st.pts };
    });
    for (i = 0; i < S; i++) {
      var f = frames[i];
      for (j = 0; j <= N; j++) {
        var p = f.pts[j % N];
        pos.push(f.c.x + f.u.x * p[0] + f.v.x * p[1], f.c.y + f.u.y * p[0] + f.v.y * p[1], f.c.z + f.u.z * p[0] + f.v.z * p[1]);
        uv.push(j / N, i / (S - 1));
      }
    }
    var R = N + 1;
    for (i = 0; i < S - 1; i++) for (j = 0; j < N; j++) {
      var a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    function cap(fi, flip) {
      var f = frames[fi], base = pos.length / 3, k;
      pos.push(f.c.x, f.c.y, f.c.z); uv.push(0.5, fi ? 1 : 0);
      for (k = 0; k < N; k++) {
        var p = f.pts[k];
        pos.push(f.c.x + f.u.x * p[0] + f.v.x * p[1], f.c.y + f.u.y * p[0] + f.v.y * p[1], f.c.z + f.u.z * p[0] + f.v.z * p[1]);
        uv.push(0.5, fi ? 1 : 0);
      }
      for (k = 0; k < N; k++) {
        var p0 = base + 1 + k, p1 = base + 1 + ((k + 1) % N);
        if (flip) idx.push(base, p1, p0); else idx.push(base, p0, p1);
      }
    }
    if (capStart) cap(0, true);
    if (capEnd) cap(S - 1, false);
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    var nr = g.attributes.normal;
    for (i = 0; i < S; i++) {
      var i0 = i * R, i1 = i * R + N;
      var x = nr.getX(i0) + nr.getX(i1), y = nr.getY(i0) + nr.getY(i1), z = nr.getZ(i0) + nr.getZ(i1);
      var l = Math.sqrt(x * x + y * y + z * z) || 1;
      nr.setXYZ(i0, x / l, y / l, z / l); nr.setXYZ(i1, x / l, y / l, z / l);
    }
    return g;
  }
  // 超楕円の断面。a=横半幅, bf=+v 側の半奥行き, bb=-v 側, n=角の丸さ(2=楕円, 大きいほど四角)
  function superSect(a, bPos, bNeg, n, N) {
    var out = [], e = 2 / n;
    for (var k = 0; k < N; k++) {
      var t = k / N * TAU, c = Math.cos(t), s = Math.sin(t);
      var x = a * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), e);
      var y = (s < 0 ? bNeg : bPos) * (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), e);
      out.push([x, y]);
    }
    return out;
  }
  // 角丸ボックス（中心原点）。XZ 面の角を半径 r で丸め、上下の縁を b で面取り。
  function roundBoxY(w, h, d, r, b, cs) {
    b = Math.min(b, h * 0.45);
    var W = w - 2 * b, D = d - 2 * b, rr = Math.max(0.0001, Math.min(r, W / 2 - 0.0001, D / 2 - 0.0001));
    var s = new T.Shape(), x0 = -W / 2, z0 = -D / 2;
    s.moveTo(x0 + rr, z0); s.lineTo(x0 + W - rr, z0); s.quadraticCurveTo(x0 + W, z0, x0 + W, z0 + rr);
    s.lineTo(x0 + W, z0 + D - rr); s.quadraticCurveTo(x0 + W, z0 + D, x0 + W - rr, z0 + D);
    s.lineTo(x0 + rr, z0 + D); s.quadraticCurveTo(x0, z0 + D, x0, z0 + D - rr);
    s.lineTo(x0, z0 + rr); s.quadraticCurveTo(x0, z0, x0 + rr, z0);
    var g = new T.ExtrudeGeometry(s, { depth: Math.max(0.0001, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: cs || 4 });
    g.rotateX(PI / 2);
    g.computeBoundingBox();
    var bb = g.boundingBox;
    g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
    return g;
  }
  function flatHex(r, len) {
    var g = new T.CylinderGeometry(r, r, len, 6, 1, false).toNonIndexed();
    g.computeVertexNormals();
    return g;
  }

  /* ---------------- テクスチャ ---------------- */
  var TEAL = '#0a8e97';
  function texHousing() {
    return cached('housing', function () {
      var W = 512, H = 256;
      var c = mkCanvas(W, H), x = c.getContext('2d', RF);
      var b = mkCanvas(W, H), y = b.getContext('2d', RF);
      x.fillStyle = TEAL; x.fillRect(0, 0, W, H);
      grain(x, W, H, 5, 11);
      y.fillStyle = '#808080'; y.fillRect(0, 0, W, H);
      // 合わせ目（クラムシェル）: +X 側と -X 側
      [0.25, 0.75].forEach(function (u) {
        x.fillStyle = 'rgba(0,25,28,0.6)'; x.fillRect(u * W - 1, 0, 1.6, H);
        y.fillStyle = '#5a5a5a'; y.fillRect(u * W - 1, 0, 2, H);
      });
      // 通気スリット（側面 ±Z、後ろ寄り）: housing の y 範囲 0.116..0.192
      var v0 = (0.161 - 0.116) / 0.076, v1 = (0.186 - 0.116) / 0.076;
      var r0 = (1 - v1) * H, r1 = (1 - v0) * H;
      [0, 0.5, 1].forEach(function (uc) {
        for (var k = -3; k <= 3; k++) {
          var cx = (uc + k * 0.017) * W;
          if (cx < -10 || cx > W + 10) continue;
          var len = (r1 - r0) * (1 - Math.abs(k) * 0.07);
          var top = r0 + ((r1 - r0) - len) / 2;
          x.fillStyle = '#071214'; rrect(x, cx - 2.6, top, 5.2, len, 2.6); x.fill();
          x.fillStyle = 'rgba(120,220,225,0.18)'; x.fillRect(cx + 2.6, top + 2, 1, len - 4);
          y.fillStyle = '#000'; rrect(y, cx - 2.6, top, 5.2, len, 2.6); y.fill();
        }
      });
      return { map: mkTex(c, true), bump: mkTex(b, false) };
    });
  }
  function texRubber() {
    return cached('rubber', function () {
      var W = 256, c = mkCanvas(W, W), x = c.getContext('2d', RF), r = rng(5);
      x.fillStyle = '#808080'; x.fillRect(0, 0, W, W);
      for (var i = 0; i < 2600; i++) {
        var px = r() * W, py = r() * W, s = 0.6 + r() * 1.6, v = r() < 0.5 ? 40 : 200;
        x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)';
        x.beginPath(); x.arc(px, py, s, 0, TAU); x.fill();
      }
      grain(x, W, W, 40, 9);
      return mkTex(c, false, true);
    });
  }
  function texFabric() {
    return cached('fabric', function () {
      var W = 256, c = mkCanvas(W, W), x = c.getContext('2d', RF), r = rng(21);
      x.fillStyle = '#efe6d3'; x.fillRect(0, 0, W, W);
      for (var i = 0; i < W; i += 2) {
        var a = 0.05 + r() * 0.07;
        x.fillStyle = 'rgba(120,100,70,' + a + ')'; x.fillRect(0, i, W, 1);
        a = 0.04 + r() * 0.07;
        x.fillStyle = 'rgba(120,100,70,' + a + ')'; x.fillRect(i, 0, 1, W);
      }
      for (i = 0; i < 160; i++) { // 太い糸のむら（スラブ）
        x.fillStyle = 'rgba(255,250,235,0.35)';
        x.fillRect(r() * W, Math.floor(r() * W / 2) * 2, 6 + r() * 24, 1);
      }
      grain(x, W, W, 8, 3);
      return mkTex(c, true, true);
    });
  }
  function texWood() {
    return cached('wood', function () {
      var W = 512, H = 128, c = mkCanvas(W, H), x = c.getContext('2d', RF), r = rng(31);
      x.fillStyle = '#a8703f'; x.fillRect(0, 0, W, H);
      for (var i = 0; i < 70; i++) {
        var y0 = r() * H, amp = 2 + r() * 5, ph = r() * TAU, a = 0.08 + r() * 0.18, dark = r() < 0.6;
        x.strokeStyle = dark ? 'rgba(80,42,15,' + a + ')' : 'rgba(225,170,110,' + a + ')';
        x.lineWidth = 0.8 + r() * 2.2;
        x.beginPath();
        for (var px = 0; px <= W; px += 8) {
          var yy = y0 + Math.sin(px / W * TAU * 2 + ph) * amp + Math.sin(px / 37 + ph) * 0.8;
          if (px === 0) x.moveTo(px, yy); else x.lineTo(px, yy);
        }
        x.stroke();
      }
      grain(x, W, H, 10, 2);
      return mkTex(c, true, true);
    });
  }
  function texPages() {
    return cached('pages', function () {
      var W = 32, H = 4, c = mkCanvas(W, H), x = c.getContext('2d', RF);
      var gr = x.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, '#d9d4c8'); gr.addColorStop(0.12, '#f6f2ea'); gr.addColorStop(0.5, '#fbf8f2');
      gr.addColorStop(0.88, '#f3efe6'); gr.addColorStop(1, '#cfc9bc');
      x.fillStyle = gr; x.fillRect(0, 0, W, H);
      x.fillStyle = '#8f897f'; x.fillRect(0, 0, 1.4, H);
      return mkTex(c, true, true);
    });
  }
  function cardboard(W, H, seed, base) {
    var c = mkCanvas(W, H), x = c.getContext('2d', RF), r = rng(seed);
    x.fillStyle = base || '#b9895a'; x.fillRect(0, 0, W, H);
    for (var i = 0; i < W * H / 60; i++) {
      var px = r() * W, py = r() * H, l = 2 + r() * 7, a = r() * TAU, v = r();
      x.strokeStyle = v < 0.5 ? 'rgba(90,60,30,0.18)' : 'rgba(230,200,160,0.2)';
      x.lineWidth = 0.6;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    grain(x, W, H, 12, seed + 1);
    return { c: c, x: x, r: r };
  }

  /* ---------------- 電動ドリル ---------------- */
  // ローカル: 原点=ビット先端、ビットは -Y 向き（本体は +Y）、グリップは +X。
  var DRILL = {
    slotPos: new V3(0.152, 0.158, 0),   // 電池の装着面（足の下面）
    battH: 0.045,
    bodyCenter: new V3(0.078, 0.166, 0)
  };
  function gripFrame(s) {
    var P0 = [0.0, 0.150], P1 = [0.07, 0.163], P2 = [0.146, 0.190], m = 1 - s;
    var x = m * m * P0[0] + 2 * m * s * P1[0] + s * s * P2[0];
    var y = m * m * P0[1] + 2 * m * s * P1[1] + s * s * P2[1];
    var dx = 2 * m * (P1[0] - P0[0]) + 2 * s * (P2[0] - P1[0]);
    var dy = 2 * m * (P1[1] - P0[1]) + 2 * s * (P2[1] - P1[1]);
    return { c: new V3(x, y, 0), w: new V3(dx, dy, 0).normalize() };
  }
  function keyed(keys, s) {
    for (var i = 0; i < keys.length - 1; i++) {
      if (s <= keys[i + 1][0]) {
        var t = (s - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        t = smooth(t);
        return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * t;
      }
    }
    return keys[keys.length - 1][1];
  }
  var GRIP_F = [[0, 0.040], [0.12, 0.026], [0.32, 0.0195], [0.55, 0.019], [0.75, 0.020], [0.9, 0.024], [1, 0.032]]; // 前(-Y)側
  var GRIP_K = [[0, 0.032], [0.12, 0.027], [0.32, 0.0235], [0.55, 0.0245], [0.75, 0.0245], [0.9, 0.0255], [1, 0.030]]; // 後ろ側
  var GRIP_A = [[0, 0.021], [0.12, 0.0185], [0.32, 0.0165], [0.55, 0.0167], [0.75, 0.0172], [0.9, 0.019], [1, 0.024]]; // 横半幅

  function gripGeo(s0, s1, S, fn) {
    var st = [];
    for (var i = 0; i < S; i++) {
      var s = s0 + (s1 - s0) * i / (S - 1), fr = gripFrame(s);
      var sz = fn(s, i, S);
      // u=+Z, v=w×u（前方 -Y 寄り）。b+ が前、b- が後ろ
      st.push({ c: fr.c.clone().addScaledVector(new V3(fr.w.y, -fr.w.x, 0), sz.off || 0), w: fr.w, u: new V3(0, 0, 1), pts: superSect(sz.a, sz.f, sz.k, 2.6, 36) });
    }
    return loft(st, true, true);
  }

  function makeDrill() {
    var root = new T.Group();
    root.name = 'drill';
    var tex = texHousing();
    var mTeal = std({ color: TEAL, roughness: 0.4, metalness: 0 });
    var mHousing = std({ color: 0xffffff, map: tex.map, bumpMap: tex.bump, bumpScale: 1.5, roughness: 0.4 });
    var mBlack = std({ color: 0x1b1d1f, roughness: 0.48 });
    var mRubber = std({ color: 0x18191a, roughness: 0.86, bumpMap: texRubber(), bumpScale: 1.2 });
    var mGun = std({ color: 0x6a6e74, roughness: 0.32, metalness: 1 });
    var mChuck = std({ color: 0x202224, roughness: 0.42, metalness: 0.2 });
    var mSteel = std({ color: 0xc4c8cc, roughness: 0.25, metalness: 1 });
    var mTrig = std({ color: 0xb01e16, roughness: 0.36 });
    var mGray = std({ color: 0x34383c, roughness: 0.5 });
    var mLed = std({ color: 0xaeb6ba, roughness: 0.12, emissive: 0x000000 });
    texRubber().repeat.set(3, 3);

    // ---- 回転部（チャック＋ビット）
    var spin = new T.Group(); spin.name = 'spin';
    root.add(spin);
    // ビット: プラス先端（ロフト）＋首＋六角軸
    var tipSt = [];
    for (var i = 0; i <= 8; i++) {
      var y = 0.0003 + 0.0112 * i / 8, t = i / 8;
      var R = 0.0007 + 0.0028 * Math.pow(t, 0.8);
      var pts = [];
      for (var k = 0; k < 32; k++) {
        var a = k / 32 * TAU;
        var f = 0.34 + 0.66 * Math.pow(Math.abs(Math.cos(2 * a)), 0.55 + 0.6 * (1 - t));
        if (t > 0.75) f = f + (1 - f) * smooth((t - 0.75) / 0.25);
        pts.push([Math.cos(a) * R * f, Math.sin(a) * R * f]);
      }
      tipSt.push({ c: new V3(0, y, 0), w: new V3(0, 1, 0), u: new V3(1, 0, 0), pts: pts });
    }
    spin.add(mesh(loft(tipSt, true, false), mSteel));
    spin.add(mesh(revolve([[0.0035, 0.0115], [0.0024, 0.0135], [0.0024, 0.0165], [0.0037, 0.0185]], 24), mSteel));
    var hex = mesh(flatHex(0.00367, 0.036), mSteel);
    hex.position.y = 0.0185 + 0.018; spin.add(hex);
    // チャック先端（ガンメタ）
    spin.add(mesh(revolve([[0.0036, 0.0262], [0.0036, 0.0262], [0.0058, 0.0266], [0.0082, 0.029], [0.0102, 0.0335], [0.0118, 0.038], [0.0125, 0.0415]], 48), mGun));
    // スリーブ（縦溝、黒）
    var flutes = 12;
    spin.add(mesh(revolve([[0.0122, 0.0405], [0.0152, 0.0412], [0.0168, 0.0432], [0.0175, 0.048], [0.0178, 0.056], [0.0181, 0.066], [0.0181, 0.0705], [0.0172, 0.0735], [0.016, 0.0745]], flutes * 8, function (phi, y, r) {
      var depth = smooth((y - 0.0425) / 0.004) * smooth((0.072 - y) / 0.004);
      var g = Math.pow(0.5 + 0.5 * Math.cos(phi * flutes), 10);
      return r * (1 - 0.085 * depth * g);
    }), mChuck));
    // 回っているのが見える目印（溝の1本に金属の差し色）
    var mark = mesh(roundBoxY(0.0016, 0.022, 0.0025, 0.0006, 0.0005), mSteel, false, true);
    mark.position.set(Math.sin(PI / flutes) * 0.0176, 0.057, Math.cos(PI / flutes) * 0.0176);
    mark.rotation.y = PI / flutes;
    spin.add(mark);
    // 後ろのカラー（ガンメタ）
    spin.add(mesh(revolve([[0.0158, 0.0745], [0.0182, 0.0752], [0.0188, 0.0775], [0.0188, 0.0825], [0.0176, 0.0845], [0.012, 0.0848]], 48), mGun));

    // ---- 固定部
    // クラッチリング（細かい縦ローレット）
    var ribs = 56;
    root.add(mesh(revolve([[0.0165, 0.0846], [0.0215, 0.0849], [0.0232, 0.0866], [0.0239, 0.0885], [0.0239, 0.0965], [0.0233, 0.0985], [0.0215, 0.0995]], ribs * 3, function (phi, y, r) {
      var d = smooth((y - 0.0878) / 0.0012) * smooth((0.0972 - y) / 0.0012);
      return r * (1 - 0.045 * d * Math.pow(0.5 + 0.5 * Math.cos(phi * ribs), 3));
    }), mBlack));
    // ギアケース（黒）
    root.add(mesh(revolve([[0.0205, 0.0993], [0.0218, 0.1], [0.0222, 0.104], [0.0238, 0.111], [0.0246, 0.1175], [0.0242, 0.1182]], 56), mBlack));
    // モーターハウジング（青緑、スリットつき）
    root.add(mesh(revolve([[0.0236, 0.1165], [0.0255, 0.1172], [0.0268, 0.1195], [0.0278, 0.126], [0.0287, 0.137], [0.0293, 0.15], [0.0296, 0.163], [0.0296, 0.176], [0.0293, 0.185], [0.0286, 0.1905], [0.0276, 0.1918]], 80, null, { vRange: [0.116, 0.192] }), mHousing));
    // 後端キャップ（黒、丸み）
    root.add(mesh(revolve([[0.0262, 0.1905], [0.0276, 0.1912], [0.0283, 0.1935], [0.0281, 0.1965], [0.0271, 0.1995], [0.0247, 0.2025], [0.0205, 0.2048], [0.0145, 0.2062], [0.007, 0.2068], [0, 0.207]], 56), mBlack));
    // 上面の速度切替スライダー
    var sb = mesh(roundBoxY(0.014, 0.004, 0.02, 0.003, 0.0012), mBlack);
    sb.rotation.z = PI / 2; sb.position.set(-0.0292, 0.152, 0); root.add(sb);
    var knob = mesh(roundBoxY(0.007, 0.0045, 0.008, 0.002, 0.0012), mGray);
    knob.rotation.z = PI / 2; knob.position.set(-0.0318, 0.148, 0); root.add(knob);

    // グリップ（樹脂の芯）
    root.add(mesh(gripGeo(0, 1, 20, function (s) {
      return { a: keyed(GRIP_A, s), f: keyed(GRIP_F, s), k: keyed(GRIP_K, s) };
    }), mTeal));
    // ゴムのオーバーモールド（後ろと側面を覆う。前は芯の中に沈む）
    root.add(mesh(gripGeo(0.2, 0.93, 16, function (s) {
      var e = smooth((s - 0.2) / 0.05) * smooth((0.93 - s) / 0.05);
      var o = 0.0018 * e - 0.0012 * (1 - e);
      return { a: keyed(GRIP_A, s) + o, f: keyed(GRIP_F, s) - 0.0085, k: keyed(GRIP_K, s) + o };
    }), mRubber));

    // 首（チャック下〜引き金の上。LED の台）
    (function () {
      var s = new T.Shape();
      s.moveTo(0.006, 0.1075);
      s.lineTo(0.028, 0.1045);
      s.quadraticCurveTo(0.0345, 0.1045, 0.0355, 0.111);
      s.lineTo(0.0385, 0.138);
      s.lineTo(0.006, 0.15);
      s.closePath();
      var g = new T.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.003, bevelSegments: 3, curveSegments: 6 });
      g.translate(0, 0, -0.009);
      root.add(mesh(g, mTeal));
    })();
    // LED 作業灯（-Y 向き）: 横長の透明レンズ（目玉に見えないよう、細長い窓）
    var bez = mesh(roundBoxY(0.0075, 0.0012, 0.017, 0.0034, 0.0004), mGray, false, false);
    bez.position.set(0.0262, 0.1013, 0); root.add(bez);
    var lens = mesh(roundBoxY(0.0052, 0.0012, 0.0145, 0.0024, 0.0005), mLed, false, false);
    lens.position.set(0.0262, 0.1005, 0); root.add(lens);

    // 引き金（押すと +Y へ引き込まれる）
    var trig = (function () {
      var s = new T.Shape();
      s.moveTo(0.0345, 0.1235);
      s.quadraticCurveTo(0.050, 0.1315, 0.0655, 0.1215);
      s.quadraticCurveTo(0.0695, 0.1225, 0.069, 0.127);
      s.lineTo(0.065, 0.147);
      s.lineTo(0.0345, 0.147);
      s.closePath();
      var g = new T.ExtrudeGeometry(s, { depth: 0.0085, bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.0018, bevelSegments: 3, curveSegments: 10 });
      g.translate(0, 0, -0.00425);
      return mesh(g, mTrig);
    })();
    trig.name = 'trigger';
    root.add(trig);
    // 正逆切替ボタン（左右に貫通）
    var fr = new T.Group();
    var cylB = mesh(new T.CylinderGeometry(0.0043, 0.0043, 0.036, 20), mGray);
    fr.add(cylB);
    [-1, 1].forEach(function (sd) {
      var cap = mesh(new T.SphereGeometry(0.0043, 20, 8, 0, TAU, 0, PI / 2), mGray);
      cap.scale.y = 0.6; cap.position.y = sd * 0.018; if (sd < 0) cap.rotation.x = PI;
      fr.add(cap);
    });
    fr.rotation.x = PI / 2; fr.position.set(0.0355, 0.151, 0.0015);
    root.add(fr);

    // 電池受け（グリップ下端の足）
    (function () {
      var s = new T.Shape();
      s.moveTo(0.149, 0.107);
      s.lineTo(0.149, 0.209);
      s.quadraticCurveTo(0.149, 0.212, 0.146, 0.212);
      s.lineTo(0.133, 0.212);
      s.quadraticCurveTo(0.1215, 0.211, 0.1195, 0.199);
      s.lineTo(0.1215, 0.172);
      s.quadraticCurveTo(0.125, 0.150, 0.1315, 0.127);
      s.quadraticCurveTo(0.1365, 0.109, 0.1435, 0.1065);
      s.lineTo(0.1465, 0.1062);
      s.quadraticCurveTo(0.149, 0.1062, 0.149, 0.107);
      var g = new T.ExtrudeGeometry(s, { depth: 0.068, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.003, bevelSegments: 3, curveSegments: 8 });
      g.translate(0, 0, -0.034);
      root.add(mesh(g, mTeal));
      // 足の下の黒い当たり（電池とのすき間の帯）
      var band = mesh(roundBoxY(0.112, 0.004, 0.0745, 0.006, 0.0012), mBlack);
      band.rotation.z = PI / 2; band.position.set(0.1505, 0.1585, 0);
      root.add(band);
    })();

    var slot = new T.Object3D(); slot.name = 'batterySlot';
    slot.position.copy(DRILL.slotPos);
    slot.rotation.z = PI / 2;          // 電池ローカル +Y → ドリル -X、+X → ドリル +Y（後ろ）
    root.add(slot);

    var glow = setupGlow(root);
    var trigBaseY = trig.position.y;
    root.userData.spin = spin;
    root.userData.trigger = trig;
    root.userData.setTrigger = function (k) { trig.position.y = trigBaseY + 0.0085 * clamp(+k || 0, 0, 1); };
    root.userData.setLed = function (k) {
      k = clamp(+k || 0, 0, 1);
      glow.setBase(mLed, 3.2 * k, 3.3 * k, 3.4 * k);
    };
    root.userData.batterySlot = slot;
    root.userData.bodyCenter = DRILL.bodyCenter.clone();
    root.userData.standBottom = new V3(DRILL.slotPos.x + DRILL.battH, DRILL.slotPos.y, 0);
    return root;
  }

  var _q0 = new T.Quaternion().setFromAxisAngle(new V3(0, 0, 1), -PI / 2); // ドリル +X → 下、ドリル -Y → -X
  var _qy = new T.Quaternion(), _v = new V3();
  function poseDrillStanding(drill, point, yaw) {
    _qy.setFromAxisAngle(new V3(0, 1, 0), yaw || 0);
    drill.quaternion.copy(_qy).multiply(_q0);
    var b = (drill.userData.standBottom || new V3(DRILL.slotPos.x + DRILL.battH, DRILL.slotPos.y, 0));
    _v.copy(b).multiply(drill.scale).applyQuaternion(drill.quaternion);
    drill.position.copy(point).sub(_v);
    drill.updateMatrix();
    return drill;
  }

  /* ---------------- 電池 ---------------- */
  // ローカル: 原点=装着面（上面）。本体は -Y 側。長さ X=0.11, 高さ Y=0.045, 幅 Z=0.075。残量 LED は +X 面。
  function makeBattery() {
    var root = new T.Group(); root.name = 'battery';
    var mBody = std({ color: 0x1c1d1f, roughness: 0.5 });
    var mDeck = std({ color: 0x242628, roughness: 0.42 });
    var mTeal = std({ color: TEAL, roughness: 0.4 });
    var mPanel = std({ color: 0x0c0d0e, roughness: 0.18 });
    var mMetal = std({ color: 0xb09060, roughness: 0.35, metalness: 1 });
    var body = mesh(roundBoxY(0.11, 0.033, 0.075, 0.009, 0.0045), mBody);
    body.position.y = -0.0285; root.add(body);
    var rib = mesh(roundBoxY(0.1114, 0.005, 0.0764, 0.0095, 0.0016), mDeck);
    rib.position.y = -0.0315; root.add(rib);
    // 下部の握り段（すこし細い帯）
    var foot = mesh(roundBoxY(0.106, 0.004, 0.071, 0.008, 0.0015), mDeck);
    foot.position.y = -0.0438; root.add(foot);
    // 上面のレールの段
    var deck = mesh(roundBoxY(0.097, 0.0125, 0.056, 0.004, 0.0015), mDeck);
    deck.position.set(-0.004, -0.0083, 0); root.add(deck);
    [-1, 1].forEach(function (sd) {
      var rail = mesh(roundBoxY(0.09, 0.0028, 0.006, 0.001, 0.0008), mBody);
      rail.position.set(-0.006, -0.0014, sd * 0.0215); root.add(rail);
      var groove = mesh(new T.BoxGeometry(0.088, 0.0022, 0.0012), mPanel, false, false);
      groove.position.set(-0.006, -0.0085, sd * 0.0281); root.add(groove);
    });
    // 端子の窓
    for (var i = 0; i < 3; i++) {
      var tw = mesh(new T.BoxGeometry(0.012, 0.0006, 0.0028), mPanel, false, false);
      tw.position.set(-0.035, -0.0018, (i - 1) * 0.008); root.add(tw);
      var tm = mesh(new T.BoxGeometry(0.01, 0.0004, 0.0012), mMetal, false, false);
      tm.position.set(-0.035, -0.0016, (i - 1) * 0.008); root.add(tm);
    }
    // リリースボタン（本体色のアクセント）
    var btn = mesh(roundBoxY(0.011, 0.007, 0.034, 0.003, 0.0018), mTeal);
    btn.position.set(0.0475, -0.0095, 0); root.add(btn);
    // 残量 LED パネル（+X 面）
    var panel = mesh(roundBoxY(0.0016, 0.009, 0.046, 0.0008, 0.0006), mPanel, false, true);
    panel.position.set(0.0553, -0.026, -0.002); root.add(panel);
    var leds = [];
    for (i = 0; i < 3; i++) {
      var m = std({ color: 0x1a221c, roughness: 0.2, emissive: 0x000000 });
      var l = mesh(roundBoxY(0.0012, 0.0035, 0.007, 0.001, 0.0004), m, false, false);
      l.position.set(0.0563, -0.026, -0.016 + i * 0.0105); root.add(l);
      leds.push(m);
    }
    var chk = mesh(new T.CylinderGeometry(0.0028, 0.0028, 0.0016, 16), mDeck, false, false);
    chk.rotation.z = PI / 2; chk.position.set(0.0561, -0.026, 0.0165); root.add(chk);

    var glow = setupGlow(root);
    var level = 3, blink = 0;
    function refresh() {
      for (var i = 0; i < 3; i++) {
        if (level <= 0) {
          if (i === 0) glow.setBase(leds[i], 1.5 * blink, 0.025 * blink, 0.012 * blink);
          else glow.setBase(leds[i], 0, 0, 0);
        } else if (i < level) glow.setBase(leds[i], 0.04, 0.85, 0.16);
        else glow.setBase(leds[i], 0, 0, 0);
      }
    }
    root.userData.setLevel = function (n) { level = clamp(Math.round(+n || 0), 0, 3); refresh(); };
    root.userData.setBlink = function (k) { blink = clamp(+k || 0, 0, 1); refresh(); };
    refresh();
    return root;
  }

  /* ---------------- 充電器 ---------------- */
  // 原点=底面中心。X=0.10, Y=0.05, Z=0.13（+Z が前面、LED あり）。
  function makeCharger() {
    var root = new T.Group(); root.name = 'charger';
    var mBody = std({ color: 0x1e1f21, roughness: 0.55 });
    var mTop = std({ color: 0x27292c, roughness: 0.45 });
    var mDark = std({ color: 0x0b0c0d, roughness: 0.6 });
    var mMetal = std({ color: 0xb8a070, roughness: 0.3, metalness: 1 });
    var mCord = std({ color: 0x151617, roughness: 0.6 });
    var mLed = std({ color: 0x223024, roughness: 0.15, emissive: 0x000000 });
    var base = mesh(roundBoxY(0.10, 0.036, 0.13, 0.012, 0.005), mBody);
    base.position.y = 0.018; root.add(base);
    var floor = mesh(roundBoxY(0.06, 0.002, 0.11, 0.003, 0.0008), mDark, false, true);
    floor.position.set(0, 0.0362, -0.004); root.add(floor);
    [-1, 1].forEach(function (sd) {
      var rail = mesh(roundBoxY(0.017, 0.016, 0.122, 0.004, 0.0025), mTop);
      rail.position.set(sd * 0.0395, 0.042, -0.002); root.add(rail);
      // 側面の通気スリット
      for (var i = 0; i < 6; i++) {
        var v = mesh(roundBoxY(0.002, 0.016, 0.0035, 0.0012, 0.0006), mDark, false, false);
        v.position.set(sd * 0.0496, 0.016, -0.03 + i * 0.012); root.add(v);
      }
    });
    var rear = mesh(roundBoxY(0.064, 0.017, 0.016, 0.004, 0.0025), mTop);
    rear.position.set(0, 0.0425, -0.057); root.add(rear);
    for (var i = 0; i < 3; i++) {
      var c = mesh(new T.BoxGeometry(0.0032, 0.006, 0.006), mMetal, false, false);
      c.position.set((i - 1) * 0.008, 0.041, -0.048); root.add(c);
    }
    // 前面の LED
    var bez = mesh(new T.CylinderGeometry(0.0045, 0.0045, 0.002, 20), mDark, false, false);
    bez.rotation.x = PI / 2; bez.position.set(0.028, 0.022, 0.0648); root.add(bez);
    var led = mesh(new T.SphereGeometry(0.0032, 16, 8, 0, TAU, 0, PI / 2), mLed, false, false);
    led.rotation.x = PI / 2; led.scale.y = 0.5; led.position.set(0.028, 0.022, 0.0655); root.add(led);
    // コード（後ろへ短く）
    var curve = new T.CatmullRomCurve3([new V3(0, 0.014, -0.064), new V3(0, 0.012, -0.085), new V3(0.01, 0.005, -0.11), new V3(0.03, 0.0032, -0.14), new V3(0.06, 0.0032, -0.16)]);
    root.add(mesh(new T.TubeGeometry(curve, 24, 0.0032, 10, false), mCord));
    var relief = mesh(new T.CylinderGeometry(0.0045, 0.006, 0.014, 14), mBody);
    relief.rotation.x = PI / 2; relief.position.set(0, 0.014, -0.069); root.add(relief);

    var slot = new T.Object3D(); slot.name = 'slot';
    slot.position.set(0, 0.05, -0.006);
    // 電池ローカル +X → 前(+Z)、+Y（装着面）→ 下
    slot.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new V3(0, 0, 1), new V3(0, -1, 0), new V3(1, 0, 0)));
    root.add(slot);

    var glow = setupGlow(root);
    root.userData.slot = slot;
    root.userData.setLed = function (color, k) {
      k = clamp(k == null ? 1 : +k, 0, 1);
      if (color === 'green') glow.setBase(mLed, 0.04 * k, 0.9 * k, 0.15 * k);
      else if (color === 'red') glow.setBase(mLed, 1.5 * k, 0.025 * k, 0.01 * k);
      else glow.setBase(mLed, 0, 0, 0);
    };
    return root;
  }

  /* ---------------- 絵本 ---------------- */
  var BOOKS = [
    { t: 0.050, h: 0.240, w: 0.190, bg: '#23306c', bg2: '#3a4f9a', sp: '#1c2757', band: '#f2c94c', draw: drawMoon },
    { t: 0.045, h: 0.200, w: 0.210, bg: '#8fd3f4', bg2: '#d4f0fb', sp: '#d63a2f', band: '#ffffff', draw: drawCar },
    { t: 0.056, h: 0.190, w: 0.170, bg: '#9ccf4f', bg2: '#d7ec9b', sp: '#5f9a2a', band: '#e0352b', draw: drawApple },
    { t: 0.042, h: 0.270, w: 0.180, bg: '#f6b4c6', bg2: '#fde3ea', sp: '#e2789a', band: '#fff3b0', draw: drawTulip },
    { t: 0.060, h: 0.220, w: 0.200, bg: '#bfe3fb', bg2: '#f0f9ff', sp: '#5aa9e6', band: '#ffcf33', draw: drawRainbow },
    { t: 0.048, h: 0.250, w: 0.160, bg: '#2f9ad6', bg2: '#bfe8fb', sp: '#1f6fa8', band: '#ffffff', draw: drawBoat },
    { t: 0.053, h: 0.260, w: 0.150, bg: '#36296a', bg2: '#5a4596', sp: '#2a1f55', band: '#ff5a4a', draw: drawRocket },
    { t: 0.040, h: 0.210, w: 0.180, bg: '#a6e3cc', bg2: '#e4f8ef', sp: '#5cbf9b', band: '#f48fb1', draw: drawCupcake }
  ];
  function bgGrad(x, W, H, a, b) {
    var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, b); g.addColorStop(1, a);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  function drawMoon(x, W, H, d) {
    var g = x.createRadialGradient(W * 0.5, H * 0.38, 10, W * 0.5, H * 0.45, H * 0.8);
    g.addColorStop(0, d.bg2); g.addColorStop(1, d.bg); x.fillStyle = g; x.fillRect(0, 0, W, H);
    var r = rng(4);
    for (var i = 0; i < 26; i++) { x.fillStyle = 'rgba(255,240,190,' + (0.35 + r() * 0.5) + ')'; x.beginPath(); x.arc(r() * W, r() * H, 1 + r() * 1.8, 0, TAU); x.fill(); }
    var L = mkCanvas(W, H), y = L.getContext('2d', RF);
    y.fillStyle = '#ffd95a'; y.beginPath(); y.arc(W * 0.47, H * 0.44, W * 0.27, 0, TAU); y.fill();
    y.globalCompositeOperation = 'destination-out';
    y.beginPath(); y.arc(W * 0.6, H * 0.38, W * 0.24, 0, TAU); y.fill();
    x.save(); x.shadowColor = 'rgba(255,220,120,0.6)'; x.shadowBlur = 18; x.drawImage(L, 0, 0); x.restore();
    x.fillStyle = '#ffe27a';
    [[0.75, 0.62, 0.075], [0.22, 0.2, 0.05], [0.8, 0.2, 0.06], [0.3, 0.78, 0.055], [0.62, 0.85, 0.04]].forEach(function (s) {
      star(x, W * s[0], H * s[1], W * s[2], W * s[2] * 0.45, 0.2); x.fill();
    });
  }
  function drawCar(x, W, H, d) {
    bgGrad(x, W, H, d.bg, d.bg2);
    x.fillStyle = '#ffffff';
    [[0.25, 0.2], [0.72, 0.14]].forEach(function (c) {
      x.beginPath(); x.arc(W * c[0], H * c[1], W * 0.07, 0, TAU); x.arc(W * (c[0] + 0.08), H * (c[1] - 0.02), W * 0.085, 0, TAU); x.arc(W * (c[0] + 0.17), H * c[1], W * 0.06, 0, TAU); x.fill();
    });
    x.fillStyle = '#7cc24a'; x.fillRect(0, H * 0.68, W, H * 0.32);
    x.fillStyle = '#8b8f94'; x.fillRect(0, H * 0.72, W, H * 0.12);
    x.fillStyle = '#f5f5f5'; for (var i = 0; i < 5; i++) x.fillRect(W * (0.05 + i * 0.22), H * 0.775, W * 0.11, H * 0.012);
    // 車
    var cx = W * 0.5, by = H * 0.69;
    x.save(); x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 8; x.shadowOffsetY = 4;
    x.fillStyle = '#e2362b';
    rrect(x, cx - W * 0.36, by - H * 0.17, W * 0.72, H * 0.13, W * 0.06); x.fill();
    x.beginPath();
    x.moveTo(cx - W * 0.22, by - H * 0.165); x.quadraticCurveTo(cx - W * 0.17, by - H * 0.29, cx - W * 0.02, by - H * 0.29);
    x.lineTo(cx + W * 0.08, by - H * 0.29); x.quadraticCurveTo(cx + W * 0.19, by - H * 0.28, cx + W * 0.24, by - H * 0.165); x.closePath(); x.fill();
    x.restore();
    x.fillStyle = '#cdeefc';
    x.beginPath(); x.moveTo(cx - W * 0.17, by - H * 0.175); x.quadraticCurveTo(cx - W * 0.13, by - H * 0.265, cx - W * 0.04, by - H * 0.265); x.lineTo(cx - W * 0.04, by - H * 0.175); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(cx, by - H * 0.175); x.lineTo(cx, by - H * 0.265); x.lineTo(cx + W * 0.07, by - H * 0.265); x.quadraticCurveTo(cx + W * 0.15, by - H * 0.255, cx + W * 0.18, by - H * 0.175); x.closePath(); x.fill();
    x.fillStyle = '#ffe066'; x.beginPath(); x.arc(cx + W * 0.33, by - H * 0.12, W * 0.025, 0, TAU); x.fill();
    [-0.2, 0.2].forEach(function (o) {
      x.fillStyle = '#2b2b2b'; x.beginPath(); x.arc(cx + W * o, by - H * 0.035, W * 0.085, 0, TAU); x.fill();
      x.fillStyle = '#c9cdd2'; x.beginPath(); x.arc(cx + W * o, by - H * 0.035, W * 0.038, 0, TAU); x.fill();
    });
  }
  function drawApple(x, W, H, d) {
    bgGrad(x, W, H, d.bg, d.bg2);
    var r = rng(8); x.fillStyle = 'rgba(255,255,255,0.35)';
    for (var i = 0; i < 18; i++) { x.beginPath(); x.arc(r() * W, r() * H, 3 + r() * 5, 0, TAU); x.fill(); }
    var cx = W * 0.5, cy = H * 0.55, R = W * 0.3;
    x.save(); x.shadowColor = 'rgba(0,0,0,0.25)'; x.shadowBlur = 12; x.shadowOffsetY = 6;
    var g = x.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R * 1.2);
    g.addColorStop(0, '#ff6a55'); g.addColorStop(0.6, '#e0261d'); g.addColorStop(1, '#a8140f');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx - R * 0.42, cy, R * 0.82, 0, TAU); x.arc(cx + R * 0.42, cy, R * 0.82, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(cx, cy + R * 0.15, R * 0.95, R * 0.75, 0, 0, TAU); x.fill();
    x.restore();
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(cx - R * 0.55, cy - R * 0.35, R * 0.14, R * 0.25, -0.5, 0, TAU); x.fill();
    x.strokeStyle = '#6b3f1f'; x.lineWidth = W * 0.03; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx, cy - R * 0.62); x.quadraticCurveTo(cx + R * 0.05, cy - R * 0.9, cx + R * 0.15, cy - R * 1.05); x.stroke();
    x.fillStyle = '#3f9a3a'; x.beginPath(); x.ellipse(cx + R * 0.45, cy - R * 0.95, R * 0.34, R * 0.15, -0.45, 0, TAU); x.fill();
  }
  function drawTulip(x, W, H, d) {
    bgGrad(x, W, H, d.bg, d.bg2);
    x.fillStyle = '#7bbd57'; x.beginPath(); x.ellipse(W * 0.5, H * 1.02, W * 0.8, H * 0.15, 0, 0, TAU); x.fill();
    [[0.28, 0.5, '#e8343f'], [0.52, 0.38, '#ffc22e'], [0.76, 0.52, '#f2557a']].forEach(function (t) {
      var cx = W * t[0], cy = H * t[1], s = W * 0.11;
      x.strokeStyle = '#3d8f3a'; x.lineWidth = W * 0.022;
      x.beginPath(); x.moveTo(cx, cy + s); x.quadraticCurveTo(cx + s * 0.2, H * 0.75, cx, H * 0.95); x.stroke();
      x.fillStyle = '#4ea445';
      x.beginPath(); x.moveTo(cx, H * 0.93); x.quadraticCurveTo(cx - s * 1.6, H * 0.85, cx - s * 0.9, cy + s * 2.3); x.quadraticCurveTo(cx - s * 0.6, H * 0.86, cx, H * 0.93); x.fill();
      x.fillStyle = t[2];
      x.beginPath(); x.moveTo(cx - s, cy - s * 0.6); x.lineTo(cx - s * 0.5, cy - s * 0.1); x.lineTo(cx, cy - s * 0.85); x.lineTo(cx + s * 0.5, cy - s * 0.1); x.lineTo(cx + s, cy - s * 0.6);
      x.quadraticCurveTo(cx + s * 1.1, cy + s * 1.1, cx, cy + s * 1.1); x.quadraticCurveTo(cx - s * 1.1, cy + s * 1.1, cx - s, cy - s * 0.6); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.ellipse(cx - s * 0.45, cy + s * 0.2, s * 0.15, s * 0.45, 0.2, 0, TAU); x.fill();
    });
  }
  function drawRainbow(x, W, H, d) {
    bgGrad(x, W, H, d.bg, d.bg2);
    var cols = ['#e8423b', '#f39a2b', '#f7d532', '#62bb47', '#3a8fd9', '#7a57c8'];
    var cx = W * 0.5, cy = H * 0.66, R = W * 0.42, bw = W * 0.045;
    for (var i = 0; i < cols.length; i++) {
      x.strokeStyle = cols[i]; x.lineWidth = bw + 1;
      x.beginPath(); x.arc(cx, cy, R - i * bw, PI, TAU); x.stroke();
    }
    x.fillStyle = '#ffffff';
    [[0.14, 0.68], [0.86, 0.68]].forEach(function (c) {
      var px = W * c[0], py = H * c[1], s = W * 0.075;
      x.save(); x.shadowColor = 'rgba(80,120,160,0.25)'; x.shadowBlur = 8;
      x.beginPath(); x.arc(px - s, py, s, 0, TAU); x.arc(px, py - s * 0.6, s * 1.2, 0, TAU); x.arc(px + s, py, s, 0, TAU); x.arc(px, py + s * 0.3, s, 0, TAU); x.fill();
      x.restore();
    });
    x.fillStyle = '#ffd23a'; x.beginPath(); x.arc(W * 0.8, H * 0.18, W * 0.08, 0, TAU); x.fill();
  }
  function drawBoat(x, W, H, d) {
    bgGrad(x, W, H * 0.62, '#9fd9f6', '#e8f7fd');
    x.fillStyle = '#ffcf3a'; x.beginPath(); x.arc(W * 0.78, H * 0.16, W * 0.09, 0, TAU); x.fill();
    var g = x.createLinearGradient(0, H * 0.6, 0, H); g.addColorStop(0, '#3aa6dd'); g.addColorStop(1, '#1c6ea8');
    x.fillStyle = g; x.fillRect(0, H * 0.6, W, H * 0.4);
    var cx = W * 0.48, wy = H * 0.64;
    x.fillStyle = '#5b3a24'; x.fillRect(cx - W * 0.012, H * 0.2, W * 0.024, H * 0.42);
    x.save(); x.shadowColor = 'rgba(0,40,80,0.2)'; x.shadowBlur = 6;
    x.fillStyle = '#ffffff';
    x.beginPath(); x.moveTo(cx + W * 0.02, H * 0.22); x.quadraticCurveTo(cx + W * 0.25, H * 0.42, cx + W * 0.3, H * 0.56); x.lineTo(cx + W * 0.02, H * 0.56); x.closePath(); x.fill();
    x.fillStyle = '#ffe2a8';
    x.beginPath(); x.moveTo(cx - W * 0.02, H * 0.28); x.lineTo(cx - W * 0.02, H * 0.56); x.lineTo(cx - W * 0.24, H * 0.56); x.quadraticCurveTo(cx - W * 0.14, H * 0.42, cx - W * 0.02, H * 0.28); x.fill();
    x.restore();
    x.fillStyle = '#e84f3d';
    x.beginPath(); x.moveTo(cx - W * 0.33, H * 0.58); x.lineTo(cx + W * 0.36, H * 0.58); x.quadraticCurveTo(cx + W * 0.26, wy + H * 0.06, cx + W * 0.18, wy + H * 0.06); x.lineTo(cx - W * 0.2, wy + H * 0.06); x.quadraticCurveTo(cx - W * 0.28, wy + H * 0.05, cx - W * 0.33, H * 0.58); x.fill();
    x.fillStyle = '#ffffff'; x.fillRect(cx - W * 0.3, H * 0.595, W * 0.63, H * 0.012);
    x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = W * 0.012; x.lineCap = 'round';
    for (var j = 0; j < 4; j++) {
      var yy = H * (0.76 + j * 0.06);
      x.beginPath();
      for (var k = 0; k <= 20; k++) { var px = W * (k / 20), py = yy + Math.sin(k * 1.4 + j) * H * 0.008; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
    }
  }
  function drawRocket(x, W, H, d) {
    var g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, d.bg); g.addColorStop(1, d.bg2); x.fillStyle = g; x.fillRect(0, 0, W, H);
    var r = rng(13);
    for (var i = 0; i < 22; i++) { x.fillStyle = 'rgba(255,255,230,' + (0.4 + r() * 0.5) + ')'; x.beginPath(); x.arc(r() * W, r() * H, 1 + r() * 1.6, 0, TAU); x.fill(); }
    x.fillStyle = '#ffe27a'; star(x, W * 0.2, H * 0.2, W * 0.06); x.fill(); star(x, W * 0.82, H * 0.32, W * 0.045); x.fill();
    x.fillStyle = '#f2a541'; x.beginPath(); x.arc(W * 0.83, H * 0.8, W * 0.1, 0, TAU); x.fill();
    x.strokeStyle = '#d98a2a'; x.lineWidth = W * 0.02; x.beginPath(); x.ellipse(W * 0.83, H * 0.8, W * 0.17, W * 0.04, -0.3, 0, TAU); x.stroke();
    var cx = W * 0.46, top = H * 0.16, bot = H * 0.7, rw = W * 0.14;
    x.fillStyle = '#ffb02e'; x.beginPath(); x.moveTo(cx - rw * 0.5, bot); x.quadraticCurveTo(cx, bot + H * 0.24, cx + rw * 0.5, bot); x.fill();
    x.fillStyle = '#ffe35c'; x.beginPath(); x.moveTo(cx - rw * 0.28, bot); x.quadraticCurveTo(cx, bot + H * 0.14, cx + rw * 0.28, bot); x.fill();
    x.fillStyle = '#e8463b';
    x.beginPath(); x.moveTo(cx - rw, bot - H * 0.15); x.lineTo(cx - rw * 1.7, bot + H * 0.02); x.lineTo(cx - rw * 0.7, bot - H * 0.02); x.fill();
    x.beginPath(); x.moveTo(cx + rw, bot - H * 0.15); x.lineTo(cx + rw * 1.7, bot + H * 0.02); x.lineTo(cx + rw * 0.7, bot - H * 0.02); x.fill();
    var bg = x.createLinearGradient(cx - rw, 0, cx + rw, 0); bg.addColorStop(0, '#c9ccd6'); bg.addColorStop(0.4, '#ffffff'); bg.addColorStop(1, '#b8bcc8');
    x.fillStyle = bg;
    x.beginPath(); x.moveTo(cx, top); x.quadraticCurveTo(cx + rw * 1.25, top + H * 0.16, cx + rw, bot); x.lineTo(cx - rw, bot); x.quadraticCurveTo(cx - rw * 1.25, top + H * 0.16, cx, top); x.fill();
    x.fillStyle = '#e8463b';
    x.beginPath(); x.moveTo(cx, top); x.quadraticCurveTo(cx + rw * 0.75, top + H * 0.06, cx + rw * 0.95, top + H * 0.12); x.lineTo(cx - rw * 0.95, top + H * 0.12); x.quadraticCurveTo(cx - rw * 0.75, top + H * 0.06, cx, top); x.fill();
    x.fillStyle = '#8a8fa0'; x.beginPath(); x.arc(cx, top + H * 0.25, rw * 0.5, 0, TAU); x.fill();
    x.fillStyle = '#6ec6f0'; x.beginPath(); x.arc(cx, top + H * 0.25, rw * 0.38, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.arc(cx - rw * 0.13, top + H * 0.235, rw * 0.1, 0, TAU); x.fill();
  }
  function drawCupcake(x, W, H, d) {
    bgGrad(x, W, H, d.bg, d.bg2);
    var r = rng(17);
    for (var i = 0; i < 30; i++) { x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.arc(r() * W, r() * H, 2 + r() * 3, 0, TAU); x.fill(); }
    var cx = W * 0.5, wy = H * 0.58, ww = W * 0.27;
    x.save(); x.shadowColor = 'rgba(0,0,0,0.2)'; x.shadowBlur = 10; x.shadowOffsetY = 5;
    x.fillStyle = '#7fc4ef';
    x.beginPath(); x.moveTo(cx - ww, wy); x.lineTo(cx + ww, wy); x.lineTo(cx + ww * 0.72, H * 0.86); x.lineTo(cx - ww * 0.72, H * 0.86); x.closePath(); x.fill();
    x.restore();
    x.strokeStyle = 'rgba(40,110,170,0.45)'; x.lineWidth = 2;
    for (i = -4; i <= 4; i++) { x.beginPath(); x.moveTo(cx + ww * i / 4.4, wy + 2); x.lineTo(cx + ww * 0.72 * i / 4.4, H * 0.86 - 2); x.stroke(); }
    var fc = ['#f7a1c1', '#f9b6cf', '#fbcadd'];
    [[0, 0.56, 1.05, 0.11], [0, 0.47, 0.82, 0.1], [0, 0.39, 0.56, 0.085]].forEach(function (f, k) {
      x.fillStyle = fc[k]; x.beginPath(); x.ellipse(cx, H * f[1], ww * f[2], H * f[3], 0, 0, TAU); x.fill();
    });
    x.fillStyle = '#d92b3a'; x.beginPath(); x.arc(cx, H * 0.29, W * 0.055, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.beginPath(); x.arc(cx - W * 0.018, H * 0.282, W * 0.015, 0, TAU); x.fill();
    x.strokeStyle = '#5a7d2a'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx, H * 0.255); x.quadraticCurveTo(cx + W * 0.03, H * 0.2, cx + W * 0.07, H * 0.19); x.stroke();
    var sc = ['#ffe04a', '#5bc0eb', '#ffffff', '#8ad46a'];
    for (i = 0; i < 16; i++) {
      var a = r() * TAU, rr = Math.sqrt(r());
      x.save(); x.translate(cx + Math.cos(a) * ww * 0.75 * rr, H * 0.47 + Math.sin(a) * H * 0.08 * rr); x.rotate(r() * PI);
      x.fillStyle = sc[i % 4]; rrect(x, -4, -1.5, 8, 3, 1.5); x.fill(); x.restore();
    }
  }
  function texCover(i, d, wFlat) {
    return cached('cover' + i, function () {
      var H = 512, W = Math.round(512 * wFlat / d.h);
      var c = mkCanvas(W, H), x = c.getContext('2d', RF);
      d.draw(x, W, H, d);
      // 印刷物らしい微細なむらと、角の小さな擦れ
      grain(x, W, H, 7, 50 + i);
      var vg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.08)');
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
      return mkTex(c, true);
    });
  }
  function texBack(i, d) {
    return cached('back' + i, function () {
      var W = 192, H = 256, c = mkCanvas(W, H), x = c.getContext('2d', RF);
      bgGrad(x, W, H, d.bg, d.bg2);
      var r = rng(70 + i);
      x.fillStyle = 'rgba(255,255,255,0.28)';
      for (var k = 0; k < 14; k++) { x.beginPath(); x.arc(r() * W, r() * H, 3 + r() * 6, 0, TAU); x.fill(); }
      x.fillStyle = d.band; x.beginPath(); x.arc(W * 0.5, H * 0.5, W * 0.12, 0, TAU); x.fill();
      grain(x, W, H, 6, 90 + i);
      return mkTex(c, true);
    });
  }
  function texSpine(i, d, arcLen) {
    return cached('spine' + i, function () {
      var W = 128, H = 512, c = mkCanvas(W, H), x = c.getContext('2d', RF);
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, d.sp); g.addColorStop(1, d.sp);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = d.band;
      x.fillRect(0, H * 0.07, W, H * 0.035); x.fillRect(0, H * 0.9, W, H * 0.035);
      x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillRect(0, H * 0.115, W, H * 0.008); x.fillRect(0, H * 0.88, W, H * 0.008);
      // 小さな丸印（実寸で真円に見えるよう縦横比を補正）
      var rm = Math.min(d.t * 0.28, 0.012), rx = rm * W / arcLen, ry = rm * H / d.h;
      x.fillStyle = d.band; x.beginPath(); x.ellipse(W / 2, H * 0.24, rx, ry, 0, 0, TAU); x.fill();
      x.fillStyle = d.bg; x.beginPath(); x.ellipse(W / 2, H * 0.24, rx * 0.45, ry * 0.45, 0, 0, TAU); x.fill();
      grain(x, W, H, 6, 30 + i);
      return mkTex(c, true);
    });
  }
  // 書籍ローカル (X=厚み, Y=高さ, Z=幅) の板。z0..z1, 0..h の外形を X 方向に厚み th で押し出し（中心 x=0）。
  function bookSlab(z0, z1, y0, y1, rFore, rSpine, th, bev) {
    // シェイプ座標 sx = -z, sy = y。rotateY(+90°) で sx→-Z, 押し出し→+X
    var s = new T.Shape();
    var xa = -z1 + bev, xb = -z0 - bev, ya = y0 + bev, yb = y1 - bev;
    var rf = rFore, rs = rSpine;
    s.moveTo(xa + rs, ya);
    s.lineTo(xb - rf, ya); s.quadraticCurveTo(xb, ya, xb, ya + rf);
    s.lineTo(xb, yb - rf); s.quadraticCurveTo(xb, yb, xb - rf, yb);
    s.lineTo(xa + rs, yb); s.quadraticCurveTo(xa, yb, xa, yb - rs);
    s.lineTo(xa, ya + rs); s.quadraticCurveTo(xa, ya, xa + rs, ya);
    var g = new T.ExtrudeGeometry(s, { depth: Math.max(0.0002, th - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 5 });
    g.rotateY(PI / 2);
    g.computeBoundingBox();
    g.translate(-(g.boundingBox.min.x + g.boundingBox.max.x) / 2, 0, 0);
    return g;
  }
  function makeBook(i) {
    i = ((Math.floor(+i) || 0) % 8 + 8) % 8;
    var d = BOOKS[i], t = d.t, h = d.h, w = d.w;
    var root = new T.Group(); root.name = 'book' + i;
    var ct = 0.0032, e = Math.min(0.009, t * 0.2);   // 表紙の厚み、背のふくらみ
    var zs = w / 2 - e;                              // 背の始まり
    var arcLen = t * 1.25 + e;
    var mFront = std({ color: 0xffffff, map: texCover(i, d, zs + w / 2), roughness: 0.45 });
    var mBack = std({ color: 0xffffff, map: texBack(i, d), roughness: 0.45 });
    var mSpine = std({ color: 0xffffff, map: texSpine(i, d, arcLen), roughness: 0.45 });
    var ptex = texPages().clone(); ptex.needsUpdate = true;
    var nPages = Math.max(6, Math.round((t - 2 * ct) / 0.0042));
    ptex.repeat.set(nPages, 1);
    var mPages = std({ color: 0xffffff, map: ptex, roughness: 0.82 });

    function remapUV(g, fn) {
      var p = g.attributes.position, uv = g.attributes.uv;
      for (var k = 0; k < p.count; k++) { var r = fn(p.getX(k), p.getY(k), p.getZ(k)); uv.setXY(k, r[0], r[1]); }
      uv.needsUpdate = true;
    }
    // 表紙・裏表紙
    [1, -1].forEach(function (sd) {
      var g = bookSlab(-w / 2, zs + 0.001, 0, h, 0.009, 0.0015, ct, 0.0007);
      remapUV(g, sd > 0 ? function (x, y, z) { return [(zs - z) / (zs + w / 2), y / h]; }
                        : function (x, y, z) { return [(z + w / 2) / (zs + w / 2), y / h]; });
      var m = mesh(g, sd > 0 ? mFront : mBack);
      m.position.x = sd * (t / 2 - ct / 2);
      root.add(m);
    });
    // ページの束（厚い板紙。小口に細い筋）
    var tp = t - 2 * ct + 0.0004;
    var pg = bookSlab(-w / 2 + 0.0022, zs + 0.002, 0.0022, h - 0.0022, 0.0075, 0.0005, tp, 0.0004);
    remapUV(pg, function (x, y, z) { return [(x + tp / 2) / tp, (y + z) * 4]; });
    root.add(mesh(pg, mPages));
    // 背（半楕円の断面を高さ方向に押し出し）
    (function () {
      var s = new T.Shape(), N = 16, k;
      // shape: sx = X, sy = -Z。rotateX(-90°) で sy → -Z, 押し出し → +Y
      s.moveTo(-t / 2, -(zs - 0.003));
      for (k = 0; k <= N; k++) {
        var a = -PI / 2 + PI * k / N;
        s.lineTo(Math.sin(a) * t / 2, -(zs + Math.cos(a) * e));
      }
      s.lineTo(t / 2, -(zs - 0.003));
      s.closePath();
      var g = new T.ExtrudeGeometry(s, { depth: h - 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0004, bevelSegments: 1, curveSegments: 4 });
      g.rotateX(-PI / 2);
      g.translate(0, 0.0006, 0);
      remapUV(g, function (x, y, z) { return [(x + t / 2) / t, y / h]; });
      root.add(mesh(g, mSpine));
    })();

    setupGlow(root);
    root.userData.size = { t: t, h: h, w: w };
    return root;
  }

  /* ---------------- ランプ ---------------- */
  function makeLamp() {
    var root = new T.Group(); root.name = 'lamp';
    var wt = texWood().clone(); wt.needsUpdate = true; wt.repeat.set(1, 1);
    var mWood = std({ color: 0xffffff, map: wt, roughness: 0.55 });
    var mBrass = std({ color: 0xc8a35e, roughness: 0.3, metalness: 1 });
    var mDark = std({ color: 0x2a2523, roughness: 0.5 });
    var ft = texFabric().clone(); ft.needsUpdate = true; ft.repeat.set(6, 2);
    var mShade = std({ color: 0xffffff, map: ft, roughness: 0.92, emissive: 0x000000, emissiveMap: ft });
    var mInner = std({ color: 0xfaf3e6, roughness: 0.95, side: T.BackSide, emissive: 0x000000 });
    var mBulb = std({ color: 0xf4f1ea, roughness: 0.25, emissive: 0x000000 });
    var mFelt = std({ color: 0x3a3530, roughness: 1 });

    root.add(mesh(revolve([[0, 0.0005], [0.06, 0.0005], [0.06, 0.0005], [0.0618, 0.0012], [0.0625, 0.003], [0.0625, 0.0105], [0.0618, 0.0122], [0.06, 0.013], [0.06, 0.013], [0.054, 0.0145], [0.05, 0.018], [0.047, 0.0195], [0.047, 0.0195], [0.03, 0.0205], [0.0125, 0.021], [0, 0.0212]], 56), mWood));
    var felt = mesh(new T.CylinderGeometry(0.057, 0.057, 0.001, 48), mFelt, false, true);
    felt.position.y = 0.0005; root.add(felt);
    // 支柱（真鍮）
    root.add(mesh(revolve([[0.012, 0.0205], [0.0115, 0.026], [0.008, 0.029], [0.0058, 0.032], [0.0052, 0.036], [0.0052, 0.158], [0.0068, 0.161], [0.0068, 0.165], [0.0055, 0.167]], 32), mBrass));
    // ソケット
    root.add(mesh(revolve([[0.0055, 0.166], [0.0115, 0.167], [0.0125, 0.17], [0.0125, 0.189], [0.0105, 0.1915], [0.0085, 0.192]], 32), mDark));
    // 電球
    var bulb = mesh(revolve([[0.0085, 0.191], [0.009, 0.195], [0.0125, 0.2], [0.019, 0.207], [0.0215, 0.215], [0.0205, 0.224], [0.015, 0.231], [0.0075, 0.2345], [0, 0.2352]], 32), mBulb, false, false);
    root.add(bulb);
    // ハープと十字の受け（細い真鍮）
    var harp = new T.CatmullRomCurve3([new V3(-0.0125, 0.172, 0), new V3(-0.028, 0.19, 0), new V3(-0.03, 0.228, 0), new V3(-0.016, 0.249, 0), new V3(0, 0.2535, 0), new V3(0.016, 0.249, 0), new V3(0.03, 0.228, 0), new V3(0.028, 0.19, 0), new V3(0.0125, 0.172, 0)]);
    root.add(mesh(new T.TubeGeometry(harp, 40, 0.0011, 6, false), mBrass, false, true));
    for (var k = 0; k < 3; k++) {
      var a = k / 3 * TAU + PI / 2, sp = mesh(new T.CylinderGeometry(0.0007, 0.0007, 0.052, 5), mBrass, false, false);
      sp.position.set(Math.cos(a) * 0.027, 0.2525, Math.sin(a) * 0.027);
      sp.rotation.set(0, -a, PI / 2);
      root.add(sp);
    }
    var fin = mesh(revolve([[0.004, 0.252], [0.005, 0.254], [0.0045, 0.257], [0.0025, 0.2595], [0, 0.26]], 16), mBrass, false, false);
    root.add(fin);
    // シェード（円錐台・布）。上下の縁に細い巻き
    var shadePts = [[0.0798, 0.126], [0.0802, 0.1275], [0.0796, 0.1295], [0.0775, 0.14], [0.055, 0.252], [0.0545, 0.2538], [0.0538, 0.2552]];
    var shade = mesh(revolve(shadePts, 72), mShade);
    root.add(shade);
    var inner = mesh(revolve(shadePts.map(function (p) { return [p[0] - 0.0009, p[1]]; }), 72), mInner, false, true);
    root.add(inner);

    var light = new T.PointLight(0xffb36b, 0, 1.4, 2);
    light.castShadow = false;
    light.position.set(0, 0.2, 0);
    root.add(light);

    var glow = setupGlow(root);
    var on = 0;
    root.userData.light = light;
    root.userData.setOn = function (k) {
      on = clamp(+k || 0, 0, 1);
      glow.setBase(mShade, 0.85 * on, 0.52 * on, 0.22 * on);
      glow.setBase(mInner, 1.6 * on, 1.05 * on, 0.55 * on);
      glow.setBase(mBulb, 4.0 * on, 3.0 * on, 1.8 * on);
      light.intensity = 0.9 * on;
    };
    return root;
  }

  /* ---------------- 組立キットの空き箱 ---------------- */
  function texKitTop() {
    return cached('kitTop', function () {
      var W = 512, H = 192, cb = cardboard(W, H, 41), x = cb.x;
      // ふたの合わせ目（中央、長手方向）
      x.fillStyle = 'rgba(60,35,15,0.55)'; x.fillRect(0, H / 2 - 1, W, 2);
      x.fillStyle = 'rgba(255,230,190,0.25)'; x.fillRect(0, H / 2 + 1, W, 1);
      // 本棚の線画アイコン（茶色の単色印刷風）
      var cx = W * 0.2, cy = H * 0.755, ih = H * 0.37, iw = ih * 0.66;
      x.save();
      x.strokeStyle = 'rgba(92,55,25,0.85)'; x.lineWidth = 3; x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeRect(cx - iw / 2, cy - ih / 2, iw, ih);
      x.beginPath();
      x.moveTo(cx - iw / 2, cy - ih / 6); x.lineTo(cx + iw / 2, cy - ih / 6);
      x.moveTo(cx - iw / 2, cy + ih / 6); x.lineTo(cx + iw / 2, cy + ih / 6);
      x.stroke();
      x.lineWidth = 2;
      x.beginPath();
      // 上段の本（線）
      var y0 = cy - ih / 2 + 4, y1 = cy - ih / 6 - 2;
      [[-0.36, 0.1], [-0.22, 0.12], [-0.06, 0.09]].forEach(function (b) {
        x.rect(cx + iw * b[0], y0 + (y1 - y0) * 0.25, iw * b[1], (y1 - y0) * 0.75);
      });
      x.moveTo(cx + iw * 0.12, y1); x.lineTo(cx + iw * 0.26, y0 + (y1 - y0) * 0.3); x.lineTo(cx + iw * 0.36, y0 + (y1 - y0) * 0.38); x.lineTo(cx + iw * 0.24, y1);
      // 中段
      y0 = cy - ih / 6 + 4; y1 = cy + ih / 6 - 2;
      [[0.06, 0.12], [0.2, 0.1]].forEach(function (b) { x.rect(cx + iw * b[0], y0 + (y1 - y0) * 0.2, iw * b[1], (y1 - y0) * 0.8); });
      x.stroke();
      x.restore();
      // かすれ
      var r = cb.r;
      for (var i = 0; i < 260; i++) {
        x.fillStyle = 'rgba(185,137,90,' + (0.2 + r() * 0.4) + ')';
        x.fillRect(cx - iw / 2 - 6 + r() * (iw + 12), cy - ih / 2 - 6 + r() * (ih + 12), 1 + r() * 2, 1 + r() * 2);
      }
      // 擦れ跡
      x.fillStyle = 'rgba(80,50,25,0.06)';
      for (i = 0; i < 6; i++) { x.beginPath(); x.ellipse(r() * W, r() * H, 20 + r() * 60, 6 + r() * 12, r() * PI, 0, TAU); x.fill(); }
      return mkTex(cb.c, true);
    });
  }
  function texKitSide() {
    return cached('kitSide', function () {
      var W = 512, H = 64, cb = cardboard(W, H, 43), x = cb.x;
      // 中の段（フルート）がうっすら縦筋に見える
      for (var i = 0; i < W; i += 5) { x.fillStyle = 'rgba(90,60,30,0.07)'; x.fillRect(i, 0, 2, H); }
      // 下端の折り目の影
      x.fillStyle = 'rgba(60,35,15,0.25)'; x.fillRect(0, H - 2, W, 2); x.fillRect(0, 0, W, 1);
      return mkTex(cb.c, true);
    });
  }
  function texKitEnd() {
    return cached('kitEnd', function () {
      var W = 256, H = 64, cb = cardboard(W, H, 47), x = cb.x;
      // 上ぶたのフラップの小口: 段ボールの断面（波形の中しん）
      var band = 9;
      x.fillStyle = '#d2a878'; x.fillRect(0, 0, W, band);
      x.fillStyle = '#7a5530'; x.fillRect(0, 0, W, 1.4); x.fillRect(0, band - 1.4, W, 1.4);
      x.strokeStyle = '#8a6238'; x.lineWidth = 1.1;
      x.beginPath();
      for (var px = 0; px <= W; px += 1) { var yy = band / 2 + Math.sin(px / 4.2 * PI) * (band / 2 - 1.6); if (px) x.lineTo(px, yy); else x.moveTo(px, yy); }
      x.stroke();
      x.fillStyle = 'rgba(40,25,10,0.3)'; x.fillRect(0, band, W, 1.5);
      // 中央の合わせ目
      x.fillStyle = 'rgba(40,25,10,0.5)'; x.fillRect(W / 2 - 1, 0, 2, band);
      for (var i = 0; i < W; i += 5) { x.fillStyle = 'rgba(90,60,30,0.06)'; x.fillRect(i, band, 2, H); }
      x.fillStyle = 'rgba(60,35,15,0.25)'; x.fillRect(0, H - 2, W, 2);
      return mkTex(cb.c, true);
    });
  }
  function texTape() {
    return cached('tape', function () {
      var W = 256, H = 32, c = mkCanvas(W, H), x = c.getContext('2d', RF), r = rng(61);
      x.fillStyle = '#a06c38'; x.fillRect(0, 0, W, H);
      for (var i = 0; i < 400; i++) { x.fillStyle = 'rgba(' + (r() < 0.5 ? '90,55,20' : '230,190,140') + ',0.15)'; x.fillRect(r() * W, r() * H, 4 + r() * 20, 1); }
      x.fillStyle = 'rgba(255,240,210,0.25)'; x.fillRect(0, 1, W, 1); x.fillRect(0, H - 2, W, 1);
      grain(x, W, H, 8, 62);
      return mkTex(c, true, true);
    });
  }
  function makeKitBox() {
    var root = new T.Group(); root.name = 'kitBox';
    var L = 0.80, Hh = 0.07, D = 0.30;
    var mTop = std({ color: 0xffffff, map: texKitTop(), roughness: 0.88 });
    var mSide = std({ color: 0xffffff, map: texKitSide(), roughness: 0.9 });
    var mEnd = std({ color: 0xffffff, map: texKitEnd(), roughness: 0.9 });
    var mBot = std({ color: 0xa97c50, roughness: 0.95 });
    var tt = texTape().clone(); tt.needsUpdate = true; tt.repeat.set(5, 1);
    var mTape = std({ color: 0xffffff, map: tt, roughness: 0.38 });
    var box = mesh(new T.BoxGeometry(L, Hh, D), [mEnd, mEnd, mTop, mBot, mSide, mSide]);
    box.position.y = Hh / 2;
    root.add(box);
    // 縁のわずかな丸み（折り目）を細い丸棒で
    var mEdge = std({ color: 0xb08353, roughness: 0.9 });
    [[1, 1], [1, -1]].forEach(function (s) {
      var e = mesh(new T.CylinderGeometry(0.0022, 0.0022, L - 0.004, 6, 1, true), mEdge, false, true);
      e.rotation.z = PI / 2; e.position.set(0, Hh - 0.0012, s[1] * (D / 2 - 0.0012)); root.add(e);
    });
    // クラフトテープ（上面の合わせ目〜両端の側面へ少し回り込む）
    var tw = 0.05, tth = 0.0006;
    var tTop = mesh(new T.BoxGeometry(L + 0.002, tth, tw), mTape, false, true);
    tTop.position.set(0, Hh + tth / 2, 0); root.add(tTop);
    [-1, 1].forEach(function (sd) {
      var te = mesh(new T.BoxGeometry(tth, 0.045, tw), mTape, false, true);
      te.position.set(sd * (L / 2 + tth / 2 + 0.0002), Hh - 0.0225 + tth, 0); root.add(te);
    });
    setupGlow(root);
    return root;
  }

  /* ---------------- 公開 ---------------- */
  P.makeDrill = makeDrill;
  P.poseDrillStanding = poseDrillStanding;
  P.makeBattery = makeBattery;
  P.makeCharger = makeCharger;
  P.makeBook = makeBook;
  P.makeLamp = makeLamp;
  P.makeKitBox = makeKitBox;
})();
