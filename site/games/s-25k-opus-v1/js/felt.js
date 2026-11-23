// felt.js — 受け皿の毛足の跡、浮いて戻る繊維、脇のフェルトの沈み
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var F = (KK.felt = { dirty: false, fibers: [] });
  var COL = [182, 96, 74];

  F.init = function () {
    var W = KK.world, L = W.L.tray;
    F.hw = L.hw - L.rim + 0.05; F.hl = L.hl - L.rim + 0.05;
    F.W = 512; F.H = Math.round(512 * F.hl / F.hw / 8) * 8;
    var c = (F.canvas = document.createElement('canvas'));
    c.width = F.W; c.height = F.H;
    F.g = c.getContext('2d');
    KK.feltBaseFill(F.g, F.W, F.H, COL, 77);
    // 毛並みの方向を少しだけ
    F.g.globalAlpha = 0.06;
    for (var i = 0; i < 900; i++) {
      var x = Math.random() * F.W, y = Math.random() * F.H, a = Math.random() * Math.PI * 2, l = 2 + Math.random() * 5;
      F.g.strokeStyle = Math.random() < 0.5 ? '#fff2e8' : '#3a120a';
      F.g.lineWidth = 0.8;
      F.g.beginPath(); F.g.moveTo(x, y); F.g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); F.g.stroke();
    }
    F.g.globalAlpha = 1;
    var tex = (F.tex = new T.CanvasTexture(c));
    tex.colorSpace = T.SRGBColorSpace;
    tex.repeat.set(1 / (2 * F.hw), 1 / (2 * F.hl));
    tex.offset.set(0.5, 0.5);
    tex.anisotropy = 8;
    var bump = (F.bump = new T.CanvasTexture(c));
    bump.repeat.copy(tex.repeat); bump.offset.copy(tex.offset);
    F.mat = new T.MeshPhysicalMaterial({
      map: tex, bumpMap: bump, bumpScale: 1.6, roughness: 1, sheen: 1, sheenRoughness: 0.6,
      sheenColor: new T.Color(0xf0b8a4)
    });
    W.trayFelt.material = F.mat;
    initFibers();
    initMat();
  };

  function toC(lx, lz) {
    return { x: (lx / (2 * F.hw) + 0.5) * F.W, y: (0.5 + lz / (2 * F.hl)) * F.H };
  }
  F.sx = function () { return F.W / (2 * F.hw); };

  // 着地: 毛が外へ倒れる
  F.landing = function (lx, lz, dx, dz, strength) {
    var g = F.g, p = toC(lx, lz), k = F.sx();
    var s = KK.clamp(strength, 0.2, 1.4);
    var n = 26 + Math.floor(s * 18);
    var dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    var ba = Math.atan2(dz, dx);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      var bias = 0.65 + 0.55 * Math.max(0, Math.cos(a - ba));
      var r0 = (0.25 + Math.random() * 0.15) * k;
      var r1 = r0 + (0.35 + Math.random() * 0.55) * s * bias * k;
      var ca = Math.cos(a), sa = Math.sin(a);
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,226,206,' + (0.16 + 0.12 * s) + ')';
      g.lineWidth = 0.9 + Math.random() * 0.8;
      g.beginPath(); g.moveTo(p.x + ca * r0, p.y + sa * r0); g.lineTo(p.x + ca * r1, p.y + sa * r1); g.stroke();
      g.strokeStyle = 'rgba(70,22,12,' + (0.12 + 0.1 * s) + ')';
      g.lineWidth = 0.7;
      var o = 1.1;
      g.beginPath(); g.moveTo(p.x + ca * r0 - sa * o, p.y + sa * r0 + ca * o); g.lineTo(p.x + ca * r1 - sa * o, p.y + sa * r1 + ca * o); g.stroke();
    }
    var gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 0.5 * k);
    gr.addColorStop(0, 'rgba(60,18,10,0.22)'); gr.addColorStop(1, 'rgba(60,18,10,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, 0.5 * k, 0, Math.PI * 2); g.fill();
    F.dirty = true;
  };
  // 転がった向きに毛が寝る
  F.trail = function (lx, lz, dx, dz, speed) {
    var g = F.g, p = toC(lx, lz), k = F.sx();
    var dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    var a = KK.clamp(speed / 120, 0.03, 0.14);
    for (var side = -1; side <= 1; side += 2) {
      var ox = -dz * side * 0.45 * k, oy = dx * side * 0.45 * k;
      g.strokeStyle = 'rgba(255,230,212,' + a + ')';
      g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(p.x + ox - dx * 0.25 * k, p.y + oy - dz * 0.25 * k); g.lineTo(p.x + ox + dx * 0.25 * k, p.y + oy + dz * 0.25 * k); g.stroke();
    }
    g.strokeStyle = 'rgba(80,26,14,' + a * 0.8 + ')';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(p.x - dx * 0.25 * k, p.y - dz * 0.25 * k); g.lineTo(p.x + dx * 0.25 * k, p.y + dz * 0.25 * k); g.stroke();
    F.dirty = true;
  };
  // 止まったところのくぼみ
  F.dent = function (lx, lz) {
    var g = F.g, p = toC(lx, lz), k = F.sx();
    var r = 0.75 * k;
    var gr = g.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    gr.addColorStop(0, 'rgba(40,10,6,0.42)');
    gr.addColorStop(0.65, 'rgba(60,18,10,0.2)');
    gr.addColorStop(0.85, 'rgba(255,224,206,0.16)');
    gr.addColorStop(1, 'rgba(255,224,206,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    F.dirty = true;
  };

  // ── 浮いて戻る繊維 ──
  function initFibers() {
    var geo = new T.CylinderGeometry(0.018, 0.018, 0.32, 4);
    for (var i = 0; i < 16; i++) {
      var m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: 0xe8a890, roughness: 1, transparent: true, opacity: 0 }));
      m.visible = false;
      KK.world.scene.add(m);
      F.fibers.push({ m: m, life: 0, p: new T.Vector3(), v: new T.Vector3(), spin: new T.Vector3(), floor: 0 });
    }
  }
  F.puff = function (x, y, z, n) {
    var count = 0;
    for (var i = 0; i < F.fibers.length && count < n; i++) {
      var f = F.fibers[i];
      if (f.life > 0) continue;
      f.life = 1.6 + Math.random() * 1.2;
      f.p.set(x + KK.rand(-0.5, 0.5), y + 0.1, z + KK.rand(-0.5, 0.5));
      f.v.set(KK.rand(-1.2, 1.2), KK.rand(1.6, 3.2), KK.rand(-1.2, 1.2));
      f.spin.set(KK.rand(-3, 3), KK.rand(-3, 3), KK.rand(-3, 3));
      f.floor = y;
      f.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      f.m.visible = true;
      count++;
    }
  };
  function updateFibers(dt) {
    for (var i = 0; i < F.fibers.length; i++) {
      var f = F.fibers[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      // ふわっと浮いて、ゆっくり戻る
      f.v.y -= 2.2 * dt;
      f.v.multiplyScalar(Math.exp(-2.4 * dt));
      f.v.y = Math.max(f.v.y, -0.9);
      f.p.addScaledVector(f.v, dt);
      if (f.p.y < f.floor + 0.03) { f.p.y = f.floor + 0.03; f.v.set(0, 0, 0); f.life = Math.min(f.life, 0.6); }
      f.m.position.copy(f.p);
      f.m.rotation.x += f.spin.x * dt; f.m.rotation.y += f.spin.y * dt; f.m.rotation.z += f.spin.z * dt;
      f.m.material.opacity = KK.clamp(f.life * 1.5, 0, 0.9);
      if (f.life <= 0) f.m.visible = false;
    }
  }

  // ── 脇の敷きフェルトの沈み ──
  function initMat() {
    var M = KK.world.mat, L = KK.world.L.mat;
    var pos = M.geo.attributes.position;
    F.matN = pos.count;
    F.matDent = new Float32Array(pos.count);
    F.matTarget = new Float32Array(pos.count);
    F.matBase = new Float32Array(pos.count * 2);
    for (var i = 0; i < pos.count; i++) {
      F.matBase[i * 2] = pos.getX(i) + L.x;
      F.matBase[i * 2 + 1] = pos.getZ(i) + L.z;
    }
    F.matDirty = 0;
  }
  var tl = {};
  function rectDent(part, wx, wz, hx, hz, depth) {
    var l = part.toLocalXZ(wx, wz, tl);
    var ex = Math.abs(l.x) - hx, ez = Math.abs(l.z) - hz;
    var e = Math.max(ex, ez);
    if (e > 0.7) return 0;
    return depth * KK.smooth(0.7, -0.25, e);
  }
  function circDent(part, wx, wz, cx, cz, r, depth) {
    var l = part.toLocalXZ(wx, wz, tl);
    var e = Math.hypot(l.x - cx, l.z - cz) - r;
    if (e > 0.6) return 0;
    return depth * KK.smooth(0.6, -0.2, e);
  }
  function updateMat(dt) {
    var L = KK.world.L.mat;
    var parts = KK.parts.list;
    var any = false;
    // 対象になる部品
    var on = [];
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j];
      if (Math.abs(p.disp.x - L.x) > L.w / 2 + 12 || Math.abs(p.disp.z - L.z) > L.d / 2 + 12) continue;
      if (p.liftD > 1.2 && p.state === 'carry') continue;
      on.push(p);
    }
    for (var i = 0; i < F.matN; i++) {
      var x = F.matBase[i * 2], z = F.matBase[i * 2 + 1], t = 0;
      for (j = 0; j < on.length; j++) {
        var q = on[j], d = 0;
        if (q.state === 'stowed' || (q.state === 'carry' && q.liftD < 0.6)) {
          var press = q.pressed ? 0.22 : 0;
          if (q.kind === 'straight') d = rectDent(q, x, z, q.S / 2 + 0.3, q.outer, 0.12 + press);
          else if (q.kind === 'chute') d = rectDent(q, x, z, q.L / 2, q.outer, 0.12 + press);
          else if (q.kind === 'spiral') d = circDent(q, x, z, 0, 0, 3.1, 0.12 + press);
          else if (q.kind === 'corner') d = circDent(q, x, z, q.postP.x, q.postP.z, 4, 0.1);
        } else if (q.posts || q.post) {
          var list = q.posts || [q.post];
          for (var k = 0; k < list.length; k++) {
            var pg = list[k].g;
            if (!pg.visible) continue;
            d = Math.max(d, circDent(q, x, z, pg.position.x, pg.position.z, 0.75, 0.1));
          }
        }
        if (d > t) t = d;
      }
      F.matTarget[i] = t;
      var cur = F.matDent[i];
      var nv = t > cur ? KK.damp(cur, t, 14, dt) : KK.damp(cur, t, 0.9, dt);
      if (Math.abs(nv - cur) > 1e-4) any = true;
      F.matDent[i] = nv;
    }
    if (any) {
      var pos = KK.world.mat.geo.attributes.position;
      for (i = 0; i < F.matN; i++) pos.setY(i, -F.matDent[i]);
      pos.needsUpdate = true;
      F.matDirty++;
      if (F.matDirty % 3 === 0) KK.world.mat.geo.computeVertexNormals();
    }
  }

  var trailAcc = 0;
  F.update = function (dt) {
    updateFibers(dt);
    updateMat(dt);
    trailAcc += dt;
    if (F.dirty && trailAcc > 0.05) {
      F.tex.needsUpdate = true; F.bump.needsUpdate = true;
      F.dirty = false; trailAcc = 0;
    }
  };
})();
