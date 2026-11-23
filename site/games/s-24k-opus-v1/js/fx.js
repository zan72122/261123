/* fx.js — 小さな出来事：寒天から飛ぶ水しぶき、木の粉、糸を伝って落ちるしずく。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;
  const FX = (G.fx = { sp: [], dust: [], runners: [] });
  const MAXS = 140, MAXD = 40;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), tmp = new THREE.Vector3();

  FX.init = function (scene) {
    FX.spMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), G.world.mats.splash, MAXS);
    FX.spMesh.count = 0; FX.spMesh.frustumCulled = false; FX.spMesh.castShadow = false;
    scene.add(FX.spMesh);
    FX.dustMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd8bb8e, roughness: 1 }), MAXD);
    FX.dustMesh.count = 0; FX.dustMesh.frustumCulled = false;
    scene.add(FX.dustMesh);
  };

  // 細かな水しぶき
  FX.splash = function (pos, n, speed, dir) {
    for (let i = 0; i < n && FX.sp.length < MAXS; i++) {
      const a = G.rr(0, 6.283), up = G.rr(0.2, 1);
      const s = speed * G.rr(0.4, 1);
      let vx = Math.cos(a) * s * 0.7, vy = up * s, vz = Math.sin(a) * s * 0.7;
      if (dir) { vx += dir.x * s; vy += dir.y * s; vz += dir.z * s; }
      FX.sp.push({ x: pos.x, y: pos.y, z: pos.z, vx, vy, vz, r: G.rr(0.03, 0.08), t: 0, life: G.rr(0.35, 0.8) });
    }
  };
  // 木がこすれた粉
  FX.woodDust = function (pos, n) {
    for (let i = 0; i < n && FX.dust.length < MAXD; i++) {
      FX.dust.push({ x: pos.x + G.rr(-0.3, 0.3), y: pos.y + G.rr(-0.3, 0.3), z: pos.z + G.rr(-0.5, 0.5), vx: G.rr(-3, 3), vy: G.rr(1, 5), vz: G.rr(-3, 3), s: G.rr(0.04, 0.09), t: 0, life: G.rr(0.6, 1.2), rot: G.rr(0, 6) });
    }
  };

  // 糸を伝うしずく：鎖の上を低い方へ進み、端で落ちるか下の糸へ移る
  FX.runner = function (chain, startIdx) {
    if (FX.runners.length > 6 || !chain) return;
    let i = startIdx;
    if (i == null) {
      // 根元に近い、宙にある粒から
      for (i = chain.n - 1; i > 0; i--) if (chain.st[i] === 1) break;
    }
    FX.runners.push({ c: chain, f: i, t: 0, state: 'run', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: G.rr(0.1, 0.15) });
  };

  function nearestFreeParticle(x, y, z, exclude, maxD) {
    let best = null, bi = -1, bd = maxD * maxD;
    for (const c of G.strands.chains) {
      if (c === exclude || c.isStatic) continue;
      for (let i = 0; i < c.n; i++) {
        if (c.st[i] !== 1) continue;
        const dx = c.px[i] - x, dy = c.py[i] - y, dz = c.pz[i] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd && c.py[i] < y) { bd = d2; best = c; bi = i; }
      }
    }
    return best ? { c: best, i: bi } : null;
  }

  FX.update = function (dt) {
    // しぶき
    let n = 0;
    for (let i = FX.sp.length - 1; i >= 0; i--) {
      const p = FX.sp[i];
      p.t += dt;
      p.vy -= 980 * dt * 0.6;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const fy = G.dish.floorAt(p.x, p.z);
      if (p.t > p.life || p.y < fy) { FX.sp.splice(i, 1); continue; }
    }
    for (const p of FX.sp) {
      const k = 1 - p.t / p.life;
      v.set(p.x, p.y, p.z); sc.setScalar(p.r * (0.5 + 0.5 * k)); q.identity();
      mtx.compose(v, q, sc); FX.spMesh.setMatrixAt(n++, mtx);
    }
    // 糸を伝うしずく
    for (let i = FX.runners.length - 1; i >= 0; i--) {
      const r = FX.runners[i];
      r.t += dt;
      if (r.state === 'run') {
        const c = r.c;
        if (!c || c.isStatic || r.f >= c.n || r.f < 0) { FX.runners.splice(i, 1); continue; }
        const a = Math.floor(r.f), b = Math.min(c.n - 1, a + 1), u = r.f - a;
        r.x = M.lerp(c.px[a], c.px[b], u); r.y = M.lerp(c.py[a], c.py[b], u) - 0.45; r.z = M.lerp(c.pz[a], c.pz[b], u);
        // 低い方の隣へ
        const ya = c.py[Math.max(0, a - 1)], yb = c.py[Math.min(c.n - 1, a + 1)];
        const dirn = ya < yb ? -1 : 1;
        const lowest = (c.py[a] <= ya + 0.02 && c.py[a] <= yb + 0.02);
        r.f += dirn * dt * 3.0;
        if (r.f < 0 || r.f > c.n - 1 || c.st[Math.max(0, Math.min(c.n - 1, Math.round(r.f)))] !== 1 || (lowest && r.t > 0.8)) {
          r.state = 'fall'; r.vx = 0; r.vy = -5; r.vz = 0; r.from = c; r.t = 0;
        }
      } else {
        r.vy -= 980 * dt;
        r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
        // 下の糸へ移る
        if (r.t > 0.05) {
          const hit = nearestFreeParticle(r.x, r.y, r.z, r.from, 0.55);
          if (hit) { r.state = 'run'; r.c = hit.c; r.f = hit.i; r.t = 0; continue; }
        }
        const d = G.dish.dishAt(r.x, r.z, 0);
        if (d) {
          d.toLocal(r.x, r.y, r.z, tmp);
          const s = d.surfWet(tmp.x, tmp.z);
          if (tmp.y <= s + 0.1) {
            d.ripple(tmp.x, tmp.z, 0.35);
            d.addWater(tmp.x, tmp.z, 0.04);
            if (G.audio) G.audio.drip(G.audio.panOf(new THREE.Vector3(r.x, r.y, r.z)), 0.75, d.waterAt(tmp.x, tmp.z) > 0.05 ? 0.8 : 1.15);
            FX.splash(new THREE.Vector3(r.x, r.y + 0.1, r.z), 3, 18);
            FX.runners.splice(i, 1); continue;
          }
        }
        if (r.y < G.dish.floorAt(r.x, r.z)) {
          if (G.audio) G.audio.drip(G.audio.panOf(new THREE.Vector3(r.x, r.y, r.z)), 0.45, 0.7);
          FX.runners.splice(i, 1); continue;
        }
      }
    }
    for (const r of FX.runners) {
      if (n >= MAXS) break;
      v.set(r.x, r.y, r.z);
      const stretch = r.state === 'fall' ? 1.4 : 1 + Math.sin(G.time * 9) * 0.05;
      sc.set(r.r, r.r * stretch, r.r); q.identity();
      mtx.compose(v, q, sc); FX.spMesh.setMatrixAt(n++, mtx);
    }
    FX.spMesh.count = n;
    FX.spMesh.instanceMatrix.needsUpdate = true;
    // 木の粉
    let m = 0;
    for (let i = FX.dust.length - 1; i >= 0; i--) {
      const p = FX.dust[i];
      p.t += dt;
      p.vy -= 400 * dt; p.vx *= 0.96; p.vz *= 0.96;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const fy = G.dish.floorAt(p.x, p.z);
      if (p.y < fy) { p.y = fy; p.vy = 0; p.vx = p.vz = 0; }
      if (p.t > p.life) FX.dust.splice(i, 1);
    }
    for (const p of FX.dust) {
      v.set(p.x, p.y, p.z); sc.setScalar(p.s * Math.min(1, (p.life - p.t) * 3)); q.setFromAxisAngle(tmp.set(0.3, 1, 0.2).normalize(), p.rot);
      mtx.compose(v, q, sc); FX.dustMesh.setMatrixAt(m++, mtx);
    }
    FX.dustMesh.count = m;
    FX.dustMesh.instanceMatrix.needsUpdate = true;
  };
})();
