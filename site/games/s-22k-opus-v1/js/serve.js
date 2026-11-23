/* serve.js — serving bowls with tsuyu, a pile-height map so noodles stack,
   fried tofu and green onion rings, turning the bowl, sliding it to the mat. */
(function () {
  'use strict';
  const U = window.U;
  const S = (U.serve = {});
  const L = U.L, SB = L.sb;
  const SG = 40, SC = (SB.Ri * 2) / SG;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const HOME = new THREE.Vector3(L.serve.x, 0, L.serve.z);
  const MAT = new THREE.Vector3(L.mat.x, 0.03, L.mat.z);

  S.bowls = [];
  S.cur = null;
  S.matBowl = null;
  S.negiScale = 1;
  S.st = { ages: 0, negi: 0, served: 0 };

  // ---------------- bowl ----------------
  function makeBowl(variant) {
    const g = U.kit.buildServeBowl(variant);
    const soup = new THREE.Group();
    soup.position.y = SB.soupY;
    g.add(soup);
    const sg = new THREE.RingGeometry(0.001, SB.rs, 48, 10);
    sg.rotateX(-Math.PI / 2);
    const sm = new THREE.Mesh(sg, U.kit.mat.soup);
    sm.renderOrder = 2;
    sm.receiveShadow = true;
    soup.add(sm);
    const b = {
      g, soup, soupMesh: sm, base: sg.attributes.position.array.slice(), variant,
      stack: new Float32Array(SG * SG), ripples: [], angle: 0, soupAngle: 0, soupVel: 0,
      floats: [], items: [], noodles: 0, at: 'home', home: HOME.clone(),
    };
    b.container = U.noodles.defineContainer({
      name: 'bowl' + S.bowls.length,
      obj: g,
      friction: 0.6,
      damp: 0.99,
      sleepEps: 0.0007,
      sleepTime: 0.5,
      collide(nd, i) {
        const P = nd.pos, i3 = i * 3;
        let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
        const r = Math.hypot(x, z);
        const rad = nd.t[i] * 0.5 + 0.003;
        let c = false;
        const lim = SB.Ri - rad - 0.02;
        if (r > lim && y < SB.b + SB.D + 0.05) {
          x *= lim / r; z *= lim / r;
          c = true;
        }
        const rr = Math.min(r, lim);
        const fy = L.sbY(rr) + rad;
        const st = stackAt(b, x, z) + rad * 0.8;
        const fl = Math.max(fy, st);
        if (y < fl) {
          y = fl;
          if (st > fy) { nd.cn[i3] = 0; nd.cn[i3 + 1] = 1; nd.cn[i3 + 2] = 0; }
          else {
            const t = rr / SB.Ri, sl = (SB.D * 2.4 * Math.pow(Math.max(t, 1e-3), 1.4)) / SB.Ri;
            const l = Math.hypot(sl, 1);
            nd.cn[i3] = rr > 1e-4 ? (-x / rr) * sl / l : 0; nd.cn[i3 + 1] = 1 / l; nd.cn[i3 + 2] = rr > 1e-4 ? (-z / rr) * sl / l : 0;
          }
          c = true;
        }
        P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
        return c;
      },
      medium(nd, i, M) {
        const y = nd.pos[i * 3 + 1];
        if (y > SB.soupY) return;
        M.water = 1;
        M.drag = 0.2;
        M.fx = 0; M.fy = 0; M.fz = 0;
        M.gs = 0.35;
        M.hot = 0.02;
      },
      onStep(nd) {
        // first touch of the soup: a ripple and a soft sound
        if (!nd.meta.inSoup) {
          for (let i = 0; i < nd.n; i += 3) {
            if (nd.pos[i * 3 + 1] < SB.soupY && !nd.pin[i]) {
              nd.meta.inSoup = true;
              addRipple(b, nd.pos[i * 3], nd.pos[i * 3 + 2], 0.012, true);
              U.audio.play('plop', 0.3);
              break;
            }
          }
        }
      },
      onSleep(nd) {
        nd.frozen = true;
        writeNoodle(b, nd);
      },
      onEnter(nd) {
        nd.meta.inSoup = false;
        nd.meta.bowl = b;
      },
    });
    S.bowls.push(b);
    U.core.scene.add(g);
    setupBowlPicks(b);
    return b;
  }

  function stackAt(b, x, z) {
    const i = Math.floor((x + SB.Ri) / SC), j = Math.floor((z + SB.Ri) / SC);
    if (i < 0 || j < 0 || i >= SG || j >= SG) return 0;
    return b.stack[j * SG + i];
  }
  S.stackAt = stackAt;
  function writeDisc(b, x, z, rad, h) {
    const i0 = Math.max(0, Math.floor((x - rad + SB.Ri) / SC)), i1 = Math.min(SG - 1, Math.floor((x + rad + SB.Ri) / SC));
    const j0 = Math.max(0, Math.floor((z - rad + SB.Ri) / SC)), j1 = Math.min(SG - 1, Math.floor((z + rad + SB.Ri) / SC));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * SG + i;
        if (b.stack[k] < h) b.stack[k] = h;
      }
  }
  function writeNoodle(b, nd) {
    for (let i = 0; i < nd.n; i++) {
      const x = nd.pos[i * 3], y = nd.pos[i * 3 + 1], z = nd.pos[i * 3 + 2];
      writeDisc(b, x, z, Math.max(SC * 0.5, nd.w[i] * 0.45), y + nd.t[i] * 0.5);
    }
  }

  // ---------------- soup waves ----------------
  function addRipple(b, x, z, a, bowlLocal) {
    // convert from bowl frame to soup frame (soup lags the bowl's turning)
    let lx = x, lz = z;
    if (bowlLocal) {
      const ra = -(b.soupAngle - b.angle);
      const c = Math.cos(ra), s = Math.sin(ra);
      lx = x * c + z * s;
      lz = -x * s + z * c;
    }
    b.ripples.push({ x: lx, z: lz, t: 0, a });
    if (b.ripples.length > 12) b.ripples.shift();
  }
  S.ripple = function (worldP, a) {
    const b = bowlAt(worldP) || S.cur;
    if (!b) return;
    const l = b.soup.worldToLocal(_v3.copy(worldP));
    addRipple(b, l.x, l.z, a, false);
  };
  function waveAt(b, x, z) {
    let y = Math.sin(x * 8 + U.core.time * 1.3) * 0.0015 + Math.sin(z * 9 - U.core.time * 1.1) * 0.0015;
    for (const r of b.ripples) {
      const env = Math.exp(-r.t * 1.4) * r.a;
      if (env < 1e-4) continue;
      const rho = r.t * 0.55;
      const d = Math.hypot(x - r.x, z - r.z);
      const ph = d - rho;
      if (ph > -0.2 && ph < 0.04) y += env * Math.sin(ph * 38) * (1 - Math.abs(ph + 0.08) * 5);
      // reflection from the rim
      const rs = Math.hypot(r.x, r.z);
      const k = rs > 1e-3 ? (2 * SB.rs - rs) / rs : 0;
      const ix = rs > 1e-3 ? r.x * k : SB.rs * 2, iz = rs > 1e-3 ? r.z * k : 0;
      const d2 = Math.hypot(x - ix, z - iz);
      const ph2 = d2 - rho;
      if (ph2 > -0.2 && ph2 < 0.04) y += env * 0.5 * Math.sin(ph2 * 38) * (1 - Math.abs(ph2 + 0.08) * 5);
    }
    return y;
  }
  S.waveAt = waveAt;
  function updateSoup(b, dt) {
    for (const r of b.ripples) r.t += dt;
    for (let i = b.ripples.length - 1; i >= 0; i--) if (b.ripples[i].t > 4) b.ripples.splice(i, 1);
    const pos = b.soupMesh.geometry.attributes.position;
    const a = pos.array, base = b.base;
    for (let i = 0; i < pos.count; i++) a[i * 3 + 1] = waveAt(b, base[i * 3], base[i * 3 + 2]);
    pos.needsUpdate = true;
    b.soupMesh.geometry.computeVertexNormals();
    // the soup follows the bowl's turn a beat later
    b.soupVel += (b.angle - b.soupAngle) * 22 * dt;
    b.soupVel *= Math.exp(-5 * dt);
    b.soupAngle += b.soupVel * dt;
    b.g.rotation.y = b.angle;
    b.soup.rotation.y = b.soupAngle - b.angle;
    // floating toppings drift and bob
    for (const f of b.floats) {
      f.vx *= Math.exp(-1.6 * dt);
      f.vz *= Math.exp(-1.6 * dt);
      let nx = f.m.position.x + f.vx * dt, nz = f.m.position.z + f.vz * dt;
      const r = Math.hypot(nx, nz), lim = SB.rs - f.r - 0.01;
      if (r > lim) {
        nx *= lim / r; nz *= lim / r;
        const nrx = nx / lim, nrz = nz / lim;
        const dot = f.vx * nrx + f.vz * nrz;
        f.vx -= 1.6 * dot * nrx;
        f.vz -= 1.6 * dot * nrz;
      }
      // noodle mound pushes floating pieces off
      const bl = soupToBowl(b, nx, nz);
      if (stackAt(b, bl.x, bl.z) > SB.soupY + 0.01) {
        const k = 0.3;
        f.vx -= (nx / Math.max(r, 1e-3)) * k * dt * 10 * -1;
        f.vz -= (nz / Math.max(r, 1e-3)) * k * dt * 10 * -1;
      }
      f.m.position.x = nx;
      f.m.position.z = nz;
      const w = waveAt(b, nx, nz);
      f.m.position.y = w + 0.003;
      const gx = waveAt(b, nx + 0.03, nz) - w, gz = waveAt(b, nx, nz + 0.03) - w;
      f.m.rotation.x = U.damp(f.m.rotation.x, gz * 18, 8, dt);
      f.m.rotation.z = U.damp(f.m.rotation.z, -gx * 18, 8, dt);
      f.m.rotation.y += f.spin * dt;
      f.spin *= Math.exp(-dt);
      // a double ring may come apart in the waves
      if (f.double) {
        f.dt += dt;
        const amp = Math.abs(w) + Math.hypot(f.vx, f.vz) * 0.02;
        if (f.dt > f.sep || amp > 0.006) splitRing(b, f);
      }
    }
  }
  function soupToBowl(b, x, z) {
    const ra = b.soupAngle - b.angle;
    const c = Math.cos(ra), s = Math.sin(ra);
    return { x: x * c + z * s, z: -x * s + z * c };
  }

  // ---------------- plate & toppings ----------------
  S.init = function (scene) {
    S.mat = U.kit.buildMat();
    S.mat.position.set(L.mat.x, 0, L.mat.z);
    scene.add(S.mat);
    S.plate = U.kit.buildPlate();
    S.plate.position.set(L.plate.x, 0, L.plate.z);
    scene.add(S.plate);
    S.cur = makeBowl(0);
    S.cur.g.position.copy(HOME);
    S.ages = [];
    S.pile = [];
    S.refillPlate();
    setupToppingPicks();
    U.noodles.zones.push({
      container: () => S.cur.container,
      contains: (w) => Math.hypot(w.x - S.cur.g.position.x, w.z - S.cur.g.position.z) < SB.Ri - 0.05 && w.y < SB.b + SB.D + 0.6,
    });
    U.core.addUpdate(S.update, 16);
  };

  S.refillPlate = function () {
    S.ages.forEach((a) => { if (a.parent === S.plate) S.plate.remove(a); });
    S.ages = S.ages.filter((a) => a.parent && a.parent !== S.plate);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(U.kit.ageGeometry(Math.random() * 40), U.kit.mat.age);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.set(-0.08 + k * 0.05, 0.075 + k * 0.045, -0.06 + k * 0.05);
      m.rotation.y = 0.3 - k * 0.5;
      m.scale.setScalar(0.62);
      m.userData.onPlate = true;
      S.plate.add(m);
      S.ages.push(m);
    }
    S.pile.forEach((p) => S.plate.remove(p));
    S.pile = [];
    S.negiScale = U.rand(0.82, 1.22);
    S.negiGeo = U.kit.negiGeometry(0.03 * S.negiScale, false);
    S.negiDbl = U.kit.negiGeometry(0.03 * S.negiScale, true);
    for (let k = 0; k < 34; k++) {
      const m = new THREE.Mesh(S.negiGeo, U.pick(U.kit.mat.negi));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.11;
      m.position.set(0.15 + Math.cos(a) * r, 0.05 + Math.random() * 0.03 + (0.11 - r) * 0.2, 0.08 + Math.sin(a) * r);
      m.rotation.set(U.rand(-0.5, 0.5), Math.random() * 3, U.rand(-0.5, 0.5));
      m.castShadow = true;
      S.plate.add(m);
      S.pile.push(m);
    }
    S.st.ages = 0;
    S.st.negi = 0;
  };

  function bowlAt(p, margin = 0) {
    for (const b of S.bowls) {
      if (b.at === 'gone') continue;
      if (Math.hypot(p.x - b.g.position.x, p.z - b.g.position.z) < SB.Ri + margin) return b;
    }
    return null;
  }
  S.bowlAt = bowlAt;
  S.overBowl = function (p, margin = 0.05) {
    return !!S.cur && Math.hypot(p.x - S.cur.g.position.x, p.z - S.cur.g.position.z) < SB.Ri + margin;
  };
  S.container = () => S.cur.container;
  S.soupYWorld = () => (S.cur ? S.cur.g.position.y + SB.soupY : SB.soupY);

  function setupToppingPicks() {
    const C = U.core;
    // fried tofu
    let ah = null;
    C.addPick({
      priority: 4,
      area: 'bowl',
      hit(ray) {
        let best = null;
        for (const a of S.ages) {
          if (!a.userData.onPlate && !a.userData.inBowl) continue;
          const h = C.ray.intersectObject(a, false);
          if (h.length && (!best || h[0].distance < best.dist)) best = { dist: h[0].distance, point: h[0].point, obj: a };
        }
        return best;
      },
      down(e) {
        const a = e.obj;
        const wp = new THREE.Vector3();
        a.getWorldPosition(wp);
        const from = a.userData.inBowl ? a.userData.inBowl : null;
        C.scene.attach(a);
        a.userData.onPlate = false;
        if (from) {
          from.items = from.items.filter((x) => x !== a);
          a.userData.inBowl = null;
        }
        ah = { a, target: wp.clone().setY(0.95) };
        U.tween(0.15, (t) => a.scale.setScalar(U.lerp(a.scale.x, 1, t)));
        U.audio.play('soft', 0.3);
        return true;
      },
      move(e) {
        if (!ah) return;
        const p = C.planeY(e.ray, 0.95, _v);
        if (p) ah.target.copy(p);
      },
      up() {
        if (!ah) return;
        const a = ah.a;
        const b = bowlAt(a.position, -0.05);
        ah = null;
        if (b) placeAge(b, a);
        else returnAge(a);
      },
    });
    S.ageHold = () => ah;
    // green onion pile
    let nh = null;
    C.addPick({
      priority: 4,
      area: 'bowl',
      hit(ray) {
        const c = _v.set(L.plate.x + 0.15, 0.08, L.plate.z + 0.08);
        if (ray.distanceToPoint(c) < 0.17 && S.pile.length) return { dist: ray.origin.distanceTo(c), point: c.clone() };
        return null;
      },
      down() {
        const n = Math.min(S.pile.length, 6 + ((Math.random() * 3) | 0));
        if (!n) return false;
        const rings = [];
        for (let k = 0; k < n; k++) {
          const src = S.pile.pop();
          S.plate.remove(src);
          const dbl = Math.random() < 0.12;
          const m = makeRing(dbl, src.material);
          src.getWorldPosition(m.position);
          C.scene.add(m);
          rings.push({ m, off: new THREE.Vector3(U.rand(-0.06, 0.06), U.rand(-0.02, 0.02), U.rand(-0.06, 0.06)), dbl });
        }
        nh = { rings, target: new THREE.Vector3(L.plate.x + 0.15, 0.9, L.plate.z + 0.08) };
        U.audio.play('tick', 0.5);
        return true;
      },
      move(e) {
        if (!nh) return;
        const p = C.planeY(e.ray, 0.9, _v);
        if (p) nh.target.copy(p);
      },
      up() {
        if (!nh) return;
        const h = nh;
        nh = null;
        const c = new THREE.Vector3();
        h.rings.forEach((r) => c.add(r.m.position));
        c.multiplyScalar(1 / h.rings.length);
        const b = bowlAt(c, -0.03);
        if (b) dropRings(b, h.rings, c);
        else h.rings.forEach((r) => returnRing(r.m));
      },
    });
    S.negiHold = () => nh;
    S._holds = () => ({ ah, nh });
  }

  function makeRing(dbl, mat) {
    if (!dbl) {
      const m = new THREE.Mesh(S.negiGeo, mat || U.pick(U.kit.mat.negi));
      m.castShadow = true;
      return m;
    }
    const g = new THREE.Group();
    const o = new THREE.Mesh(S.negiDbl.outer, mat || U.kit.mat.negi[0]);
    const i = new THREE.Mesh(S.negiDbl.inner, U.kit.mat.negi[2]);
    o.castShadow = i.castShadow = true;
    g.add(o, i);
    g.userData.inner = i;
    return g;
  }

  function returnAge(a) {
    const from = a.position.clone();
    const q0 = a.quaternion.clone();
    const slot = S.ages.filter((x) => x.userData.onPlate).length;
    const to = S.plate.localToWorld(new THREE.Vector3(-0.08 + slot * 0.05, 0.075 + slot * 0.045, -0.06 + slot * 0.05));
    U.tween(0.4, (t) => {
      a.position.lerpVectors(from, to, U.easeInOut(t));
      a.quaternion.slerp(q0, 0);
      a.scale.setScalar(U.lerp(1, 0.62, t));
    }, () => {
      S.plate.attach(a);
      a.userData.onPlate = true;
      U.audio.play('soft', 0.2);
    });
  }
  function returnRing(m) {
    const from = m.position.clone();
    const to = S.plate.localToWorld(new THREE.Vector3(0.15 + U.rand(-0.08, 0.08), 0.06, 0.08 + U.rand(-0.08, 0.08)));
    U.tween(0.35, (t) => m.position.lerpVectors(from, to, U.easeIn(t)), () => {
      S.plate.attach(m);
      if (m.isMesh) S.pile.push(m);
      U.audio.play('tick', 0.2);
    });
  }

  // ages rest on whatever is under their corners
  function placeAge(b, a) {
    b.g.updateMatrixWorld(true);
    const lp = b.g.worldToLocal(a.position.clone());
    let r = Math.hypot(lp.x, lp.z);
    const lim = SB.rs - 0.1;
    if (r > lim) { lp.x *= lim / r; lp.z *= lim / r; r = lim; }
    const qb = new THREE.Quaternion();
    b.g.getWorldQuaternion(qb);
    const yaw = new THREE.Euler().setFromQuaternion(qb.clone().invert().multiply(a.quaternion), 'YXZ').y;
    const hw = 0.19, hd = 0.16;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const sample = (dx, dz) => {
      const x = lp.x + dx * cs + dz * sn, z = lp.z - dx * sn + dz * cs;
      const rr = Math.hypot(x, z);
      return Math.max(SB.soupY + 0.006, stackAt(b, x, z) + 0.02, L.sbY(Math.min(rr, SB.Ri)) + 0.025);
    };
    const h1 = sample(hw, hd), h2 = sample(-hw, hd), h3 = sample(-hw, -hd), h4 = sample(hw, -hd), h0 = sample(0, 0);
    const sx = ((h1 + h4) - (h2 + h3)) / (4 * hw), sz = ((h1 + h2) - (h3 + h4)) / (4 * hd);
    const cy = Math.max((h1 + h2 + h3 + h4) / 4, h0);
    const tiltX = Math.atan(sz), tiltZ = -Math.atan(sx);
    const targetL = new THREE.Vector3(lp.x, cy, lp.z);
    const qL = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
    const startW = a.position.clone(), q0 = a.quaternion.clone();
    const floating = Math.max(h1, h2, h3, h4) <= SB.soupY + 0.007;
    U.tween(0.32, (t) => {
      const e = U.easeIn(t);
      const tw = b.g.localToWorld(targetL.clone());
      a.position.lerpVectors(startW, tw, e);
      a.quaternion.slerpQuaternions(q0, qb.clone().multiply(qL), e);
    }, () => {
      b.g.attach(a);
      a.position.copy(targetL);
      a.quaternion.copy(qL);
      a.userData.inBowl = b;
      b.items.push(a);
      U.audio.play('soft', 0.7);
      if (cy < SB.soupY + 0.04) addRipple(b, lp.x, lp.z, 0.014, true);
      // little settle wobble
      const r0 = a.rotation.x;
      U.tween(0.4, (t) => { a.rotation.x = r0 + Math.sin(t * Math.PI * 3) * 0.04 * (1 - t); });
      // the tofu becomes a surface for onions
      for (let dz = -hd; dz <= hd; dz += SC * 0.7)
        for (let dx = -hw; dx <= hw; dx += SC * 0.7) {
          const x = lp.x + dx * cs + dz * sn, z = lp.z - dx * sn + dz * cs;
          const y = cy + Math.tan(tiltZ) * -dx * 1 + Math.tan(tiltX) * dz + 0.025;
          writeDisc(b, x, z, SC * 0.5, y);
        }
      a.userData.floating = floating;
      S.st.ages++;
    });
  }

  function dropRings(b, rings, center) {
    b.g.updateMatrixWorld(true);
    const lc = b.g.worldToLocal(center.clone());
    let soupHit = false;
    rings.forEach((r, k) => {
      const m = r.m;
      const lp = b.g.worldToLocal(m.position.clone());
      const rr = Math.hypot(lp.x, lp.z), lim = SB.rs - 0.05;
      if (rr > lim) { lp.x *= lim / rr; lp.z *= lim / rr; }
      const sup = stackAt(b, lp.x, lp.z);
      const onTop = sup > SB.soupY + 0.008;
      const startW = m.position.clone();
      const delay = k * 0.035;
      U.after(delay, () => {
        U.tween(0.28 + Math.random() * 0.08, (t) => {
          const tw = b.g.localToWorld(_v2.set(lp.x, onTop ? sup + 0.006 : SB.soupY + 0.004, lp.z));
          m.position.lerpVectors(startW, tw, U.easeIn(t));
          m.rotation.x += 0.1;
        }, () => {
          if (onTop) {
            // stays where it landed
            b.g.attach(m);
            m.position.set(lp.x, sup + 0.006, lp.z);
            m.rotation.set(U.rand(-0.25, 0.25), Math.random() * 6, U.rand(-0.25, 0.25));
            b.items.push(m);
            writeDisc(b, lp.x, lp.z, 0.02, sup + 0.012);
            U.audio.play('tick', 0.5);
          } else {
            // floats and is pushed away by the ripple
            b.soup.attach(m);
            m.position.y = 0.004;
            m.rotation.set(0, Math.random() * 6, 0);
            const sx = m.position.x, sz = m.position.z;
            const lcs = b.soup.worldToLocal(center.clone());
            let dx = sx - lcs.x, dz = sz - lcs.z;
            const dl = Math.hypot(dx, dz) || 1;
            dx /= dl; dz /= dl;
            const sp = 0.22 + Math.random() * 0.18;
            b.floats.push({ m, vx: dx * sp, vz: dz * sp, r: 0.03 * S.negiScale, spin: U.rand(-1, 1), double: r.dbl, dt: 0, sep: U.rand(1.2, 3.5) });
            if (!soupHit) {
              soupHit = true;
              addRipple(b, lcs.x, lcs.z, 0.012, false);
            }
            U.audio.play('plop', 0.15 + Math.random() * 0.2);
          }
        });
      });
    });
    S.st.negi += rings.length;
    void lc;
  }

  function splitRing(b, f) {
    f.double = false;
    const inner = f.m.userData.inner;
    if (!inner) return;
    const wp = new THREE.Vector3();
    inner.getWorldPosition(wp);
    b.soup.attach(inner);
    inner.position.y = 0.004;
    const a = Math.random() * Math.PI * 2;
    b.floats.push({ m: inner, vx: f.vx + Math.cos(a) * 0.12, vz: f.vz + Math.sin(a) * 0.12, r: 0.02 * S.negiScale, spin: U.rand(-2, 2), double: false, dt: 0, sep: 99 });
    f.vx -= Math.cos(a) * 0.06;
    f.vz -= Math.sin(a) * 0.06;
    U.audio.play('tick', 0.3);
  }

  // ---------------- turning & sliding the bowl ----------------
  function setupBowlPicks(b) {
    const C = U.core;
    let h = null;
    const rimY = SB.b + SB.D;
    C.addPick({
      target: [b.g.userData.rimCol, b.g.userData.bodyCol],
      priority: 3,
      area: 'bowl',
      enabled: () => b.at === 'home' || b.at === 'mat',
      down(e) {
        const p = C.planeY(e.ray, rimY, new THREE.Vector3()) || e.point.clone();
        const ps = C.planeY(e.ray, 0.3, new THREE.Vector3()) || p.clone();
        // the rim turns the bowl; the side of the bowl slides it
        const onRim = e.obj === b.g.userData.rimCol && e.point && e.point.y > rimY - 0.08;
        h = { mode: onRim ? 'turn' : 'undecided', p0: p.clone(), a0: Math.atan2(p.z - b.g.position.z, p.x - b.g.position.x), off: b.g.position.clone().sub(ps).setY(0), dist: 0 };
        U.audio.play('clink', 0.35, 0.3);
        return true;
      },
      move(e) {
        if (!h) return;
        const p = C.planeY(e.ray, rimY, _v);
        if (!p) return;
        if (h.mode === 'undecided') {
          const d = p.clone().sub(h.p0).setY(0);
          if (d.length() > 0.12) {
            h.mode = 'slide';
            h.a0 = Math.atan2(p.z - b.g.position.z, p.x - b.g.position.x);
            if (h.mode === 'slide') b.at = 'sliding';
          }
          return;
        }
        if (h.mode === 'turn' && Math.hypot(p.x - b.g.position.x, p.z - b.g.position.z) > SB.Rrim + 0.32) {
          // pulled away from the rim: now it slides
          const q = C.planeY(e.ray, 0.3, _v2) || p;
          h.off = b.g.position.clone().sub(q).setY(0).multiplyScalar(0.5);
          h.mode = 'slide';
          b.at = 'sliding';
          U.audio.loop('stir', 0);
          return;
        }
        if (h.mode === 'turn') {
          const a = Math.atan2(p.z - b.g.position.z, p.x - b.g.position.x);
          const da = U.wrapAngle(a - h.a0);
          h.a0 = a;
          b.angle -= da;
          h.dist += Math.abs(da);
          U.audio.loop('stir', Math.min(0.08, Math.abs(da) * 2), 900);
        } else if (h.mode === 'slide') {
          const q = C.planeY(e.ray, 0.3, _v2) || p;
          const tx = q.x + h.off.x, tz = q.z + h.off.z;
          b.g.position.x = U.clamp(tx, L.table.x0 + 1, L.table.x1 - 1);
          b.g.position.z = U.clamp(tz, L.table.z0 + 0.8, L.table.z1 - 1);
          // stay clear of the pot
          const pd = Math.hypot(b.g.position.x - L.pot.x, b.g.position.z - L.pot.z), minD = L.pot.R + SB.Rrim + 0.1;
          if (pd < minD) {
            b.g.position.x = L.pot.x + ((b.g.position.x - L.pot.x) / pd) * minD;
            b.g.position.z = L.pot.z + ((b.g.position.z - L.pot.z) / pd) * minD;
          }
          if (Math.random() < 0.2) U.audio.play('slide', 0.4);
        }
      },
      up() {
        if (!h) return;
        U.audio.loop('stir', 0);
        if (h.mode === 'slide') {
          const toMat = b === S.cur && Math.hypot(b.g.position.x - MAT.x, b.g.position.z - MAT.z) < 1.1 && U.noodles.list.some((nd) => nd.container === b.container);
          if (toMat) moveToMat(b);
          else slideTo(b, b === S.cur ? HOME : MAT, b === S.cur ? 'home' : 'mat');
        } else if (h.mode === 'undecided') {
          // tap: little ring of the bowl
          U.audio.play('clink', 0.6, 0.4);
          addRipple(b, 0, 0, 0.008, true);
        }
        h = null;
      },
    });
  }
  function slideTo(b, to, at, done) {
    const from = b.g.position.clone();
    b.at = 'sliding';
    U.audio.play('slide', 0.6);
    U.tween(0.5, (t) => {
      b.g.position.lerpVectors(from, to, U.easeInOut(t));
    }, () => {
      b.at = at;
      if (done) done();
    });
  }
  function moveToMat(b) {
    const old = S.matBowl;
    if (old) {
      // the older bowl is put away to the side
      old.at = 'leaving';
      const f0 = old.g.position.clone();
      U.tween(0.9, (t) => {
        old.g.position.lerpVectors(f0, _v3.set(-7.5, 0, -2.4), U.easeIn(t));
      }, () => {
        old.at = 'gone';
        old.g.visible = false;
      });
    }
    slideTo(b, MAT, 'mat', () => {
      U.audio.play('clink', 0.5, 0.1);
      S.matBowl = b;
      S.st.served++;
      newCurBowl();
      if (S.onMat) S.onMat(b);
    });
  }
  function newCurBowl() {
    const b = makeBowl(S.bowls.length % 2);
    b.g.position.set(6.8, 0, -2.0);
    b.at = 'arriving';
    S.cur = b;
    const from = b.g.position.clone();
    U.tween(1.0, (t) => {
      b.g.position.lerpVectors(from, HOME, U.easeInOut(t));
    }, () => {
      b.at = 'home';
      U.audio.play('clink', 0.4, 0.2);
    });
  }

  S.onPoured = function () {
    S.st.poured = (S.st.poured || 0) + 1;
  };

  S.update = function (dt) {
    for (const b of S.bowls) {
      if (b.at === 'gone') continue;
      updateSoup(b, dt);
    }
    // held toppings follow the finger
    const hs = S._holds ? S._holds() : {};
    if (hs.ah) {
      const a = hs.ah.a;
      a.position.lerp(hs.ah.target, 1 - Math.exp(-16 * dt));
      a.rotation.x = U.damp(a.rotation.x, 0, 8, dt);
      a.rotation.z = U.damp(a.rotation.z, 0, 8, dt);
    }
    if (hs.nh) {
      hs.nh.rings.forEach((r, k) => {
        _v.copy(hs.nh.target).add(r.off);
        r.m.position.lerp(_v, 1 - Math.exp(-(10 + k) * dt));
        r.m.rotation.y += dt * 0.5;
      });
    }
  };

  S.noodlesIn = (b) => U.noodles.list.filter((nd) => nd.container === (b || S.cur).container).length;
})();
