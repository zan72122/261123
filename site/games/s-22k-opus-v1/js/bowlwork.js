/* bowlwork.js — katakuchi pour, salt, water pitcher, flour/water field in the
   kneading bowl, rolling clumps that pick up flour, and lifting the dough out. */
(function () {
  'use strict';
  const U = window.U;
  const B = (U.bowl = {});
  const L = U.L, kb = L.kb;
  const NG = 36;
  const CS = (kb.Rin * 2) / NG;
  const CA = CS * CS;
  const VF = 0.15; // flour volume per ball
  const VW = 0.062; // salted water per ball
  const CAP = 0.55; // water a unit of flour can hold
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

  B.F = new Float32Array(NG * NG); // flour depth
  B.W = new Float32Array(NG * NG); // absorbed water depth
  B.P = new Float32Array(NG * NG); // free water depth
  B.dust = new Float32Array(NG * NG); // marks residual dust from the last ball
  const valid = new Uint8Array(NG * NG);
  const cy = new Float32Array(NG * NG);
  const cxz = new Float32Array(NG * NG * 2);

  B.clumps = [];
  B.state = {
    kata: 'full', // full | pouring | away
    flourAdded: 0,
    saltIn: false,
    saltDissolve: 0,
    water: VW,
    gathered: false,
    ready: false,
    lifted: false,
    round: 0,
  };

  // ------------ grid helpers ------------
  const idx = (i, j) => j * NG + i;
  function cellOf(x, z) {
    const i = Math.floor((x + kb.Rin) / CS), j = Math.floor((z + kb.Rin) / CS);
    if (i < 0 || j < 0 || i >= NG || j >= NG) return -1;
    return idx(i, j);
  }
  function sat(c) {
    return B.F[c] > 1e-4 ? U.clamp(B.W[c] / (B.F[c] * CAP), 0, 1) : 0;
  }
  function surf(c) {
    return cy[c] + B.F[c] * (1 - 0.45 * sat(c));
  }
  B.surfaceAt = function (x, z) {
    const c = cellOf(x, z);
    if (c < 0 || !valid[c]) return L.kbY(Math.hypot(x, z));
    return surf(c);
  };
  B.flourTotal = function () {
    let s = 0;
    for (let c = 0; c < NG * NG; c++) s += B.F[c];
    return s * CA;
  };
  // where the loose flour still lies (bowl-local), weighted by amount
  B.flourCentroid = function () {
    let sx = 0, sz = 0, w = 0;
    for (let c = 0; c < NG * NG; c++) {
      const f = B.F[c];
      if (f > 0.003) { sx += cxz[c * 2] * f; sz += cxz[c * 2 + 1] * f; w += f; }
    }
    return w > 0 ? { x: sx / w, z: sz / w, w: w * CA } : null;
  };
  // the loose flour worth rolling to next, seen from (x, z): plenty of it, not too near
  B.flourTarget = function (x, z) {
    let best = -1, bv = 0;
    for (let c = 0; c < NG * NG; c++) {
      const f = B.F[c];
      if (f < 0.003 || !valid[c]) continue;
      const d = Math.hypot(cxz[c * 2] - x, cxz[c * 2 + 1] - z);
      const v = f * Math.pow(d + 0.05, 1.5);
      if (v > bv) { bv = v; best = c; }
    }
    return best < 0 ? null : { x: cxz[best * 2], z: cxz[best * 2 + 1] };
  };
  B.waterInFlour = function () {
    let s = 0;
    for (let c = 0; c < NG * NG; c++) s += B.W[c] + B.P[c];
    return s * CA;
  };

  // ------------ build ------------
  B.init = function (scene) {
    const kit = U.kit;
    const g = (B.g = kit.buildKneadBowl());
    g.position.set(kb.x, kb.lift, kb.z);
    g.rotation.z = kb.tilt;
    scene.add(g);
    g.updateMatrixWorld(true);
    for (let j = 0; j < NG; j++) {
      for (let i = 0; i < NG; i++) {
        const c = idx(i, j);
        const x = -kb.Rin + (i + 0.5) * CS, z = -kb.Rin + (j + 0.5) * CS;
        cxz[c * 2] = x;
        cxz[c * 2 + 1] = z;
        const r = Math.hypot(x, z);
        valid[c] = r < kb.Rin - 0.03 ? 1 : 0;
        cy[c] = L.kbY(r);
      }
    }
    buildFieldMeshes();
    // katakuchi on the rim
    B.kata = kit.buildKatakuchi();
    placeKataOnRim(0.35);
    // pitcher and salt dish
    B.pitcher = kit.buildPitcher();
    B.pitcher.position.set(L.pitcher.x, 0, L.pitcher.z);
    B.pitcher.rotation.y = 0.9;
    scene.add(B.pitcher);
    B.salt = kit.buildSaltDish();
    B.salt.position.set(L.salt.x, 0, L.salt.z);
    scene.add(B.salt);
    // water stream
    B.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.013, 1, 10, 4, true).translate(0, -0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0xcfe3e8, roughness: 0.05, transparent: true, opacity: 0.6, depthWrite: false }));
    B.stream.visible = false;
    scene.add(B.stream);
    B.pitch = { mode: 'home', level: 1, slosh: new THREE.Vector2(), sloshV: new THREE.Vector2(), lastPos: new THREE.Vector3(), shake: 0, grains: [] };
    B.saltSt = { mode: 'home', grainsLeft: B.salt.userData.grains.length };
    updatePitcherWater(0);
    setupPicks();
    U.core.addUpdate(B.update, 10);
  };

  function buildFieldMeshes() {
    const n = NG * NG;
    const mk = (mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const ix = [];
      for (let j = 0; j < NG - 1; j++)
        for (let i = 0; i < NG - 1; i++) {
          const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
          ix.push(a, c, b, b, c, d);
        }
      geo.setIndex(ix);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      return m;
    };
    B.flourMesh = mk(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
    B.flourMesh.receiveShadow = true;
    B.flourMesh.castShadow = true;
    B.g.add(B.flourMesh);
    B.puddleMesh = mk(new THREE.MeshStandardMaterial({
      color: 0xc4dbe0, roughness: 0.04, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    B.puddleMesh.renderOrder = 3;
    B.g.add(B.puddleMesh);
    B.fieldDirty = true;
  }

  function updateFieldMeshes() {
    const fp = B.flourMesh.geometry.attributes.position.array;
    const fc = B.flourMesh.geometry.attributes.color.array;
    const pp = B.puddleMesh.geometry.attributes.position.array;
    const hid = L.kbY(kb.Rin) - 0.06;
    for (let c = 0; c < NG * NG; c++) {
      let x = cxz[c * 2], z = cxz[c * 2 + 1];
      const r = Math.hypot(x, z);
      let y, py;
      if (!valid[c]) {
        const k = (kb.Rin * 0.96) / Math.max(r, 1e-6);
        x *= k; z *= k;
        y = hid; py = hid;
      } else if (B.F[c] < 0.003) {
        y = cy[c] - 0.025;
        py = B.P[c] > 0.002 ? cy[c] + Math.min(0.12, B.P[c]) : y - 0.01;
      } else {
        y = surf(c);
        py = B.P[c] > 0.002 ? y + Math.min(0.12, B.P[c]) : y - 0.012;
      }
      fp[c * 3] = x; fp[c * 3 + 1] = y; fp[c * 3 + 2] = z;
      pp[c * 3] = x; pp[c * 3 + 1] = py; pp[c * 3 + 2] = z;
      const s = valid[c] ? sat(c) : 0;
      const n = U.hash2(c, 5) * 0.03;
      fc[c * 3] = U.lerp(0.965, 0.86, s) - n;
      fc[c * 3 + 1] = U.lerp(0.955, 0.81, s) - n;
      fc[c * 3 + 2] = U.lerp(0.93, 0.66, s) - n;
    }
    for (const m of [B.flourMesh, B.puddleMesh]) {
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
    B.flourMesh.geometry.attributes.color.needsUpdate = true;
  }

  // ------------ katakuchi ------------
  B.kataDir = -2.35; // bowl-local angle of the hanging point
  function placeKataOnRim(tilt) {
    const k = B.kata;
    const ux = Math.cos(B.kataDir), uz = Math.sin(B.kataDir);
    if (k.parent !== B.g) B.g.add(k);
    k.position.set(ux * (kb.Rin + 0.06), kb.rimY + 0.03, uz * (kb.Rin + 0.06));
    k.rotation.set(tilt, Math.atan2(-ux, -uz), 0, 'YXZ');
    k.userData.flour.scale.set(1, 1, 1);
    k.userData.flour.visible = true;
  }
  B.kataPour = function () {
    const st = B.state;
    if (st.kata !== 'full') return;
    st.kata = 'pouring';
    U.audio.play('clink', 0.7);
    const k = B.kata;
    const fl = k.userData.flour;
    // landing spot varies a little every ball
    const off = B.round.mound;
    let poured = 0;
    U.tween(0.7, (t) => { k.rotation.x = U.lerp(0.35, 1.85, U.easeInOut(t)); }, () => {
      U.tween(1.6, (t) => {
        const target = U.easeOut(t);
        const add = (target - poured) * VF;
        poured = target;
        depositFlour(off.x, off.z, add);
        fl.scale.set(1 - target * 0.5, Math.max(0.02, 1 - target), 1 - target * 0.5);
        fl.position.y = -0.03 * target;
        U.audio.loop('flour', 0.12 * (1 - t * 0.6), 2600 + t * 800);
        // visible grains
        k.updateMatrixWorld(true);
        for (let q = 0; q < 4; q++) {
          const lip = k.localToWorld(_v.set(U.rand(-0.08, 0.08), U.rand(-0.02, 0.02), U.rand(-0.02, 0.04)));
          const tgt = B.g.localToWorld(_v2.set(off.x, 0.2, off.z));
          const vel = _v3.copy(tgt).sub(lip).setY(0).multiplyScalar(1.6);
          U.fx.spawn('flour', {
            p: lip, v: vel, life: 1.2, size: U.rand(0.7, 1.4), g: 20,
            floor: (x, z) => {
              const lp = B.g.worldToLocal(_v2.set(x, 0, z));
              return B.g.localToWorld(_v3.set(lp.x, B.surfaceAt(lp.x, lp.z), lp.z)).y;
            },
          });
        }
      }, () => {
        fl.visible = false;
        U.audio.loop('flour', 0);
        U.tween(0.5, (t) => { k.rotation.x = U.lerp(1.85, 0.2, U.easeInOut(t)); }, () => moveKataAway());
      });
    });
  };
  function moveKataAway() {
    const k = B.kata;
    const from = new THREE.Vector3();
    k.getWorldPosition(from);
    const q0 = new THREE.Quaternion();
    k.getWorldQuaternion(q0);
    U.core.scene.attach(k);
    const to = new THREE.Vector3(L.kataRest.x, 0.31, L.kataRest.z);
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.6, 0));
    U.tween(0.8, (t) => {
      const e = U.easeInOut(t);
      k.position.lerpVectors(from, to, e);
      k.position.y += Math.sin(e * Math.PI) * 0.4;
      k.quaternion.slerpQuaternions(q0, q1, e);
    }, () => {
      B.state.kata = 'away';
      U.audio.play('clink', 0.4, 0.3);
    });
  }
  B.resetKata = function (done) {
    const k = B.kata;
    B.state.kata = 'returning';
    k.userData.flour.visible = true;
    k.userData.flour.scale.set(1, 1, 1);
    k.userData.flour.position.y = 0;
    const from = k.position.clone();
    const q0 = k.quaternion.clone();
    // compute the rim pose in world
    const tmp = new THREE.Object3D();
    B.g.add(tmp);
    const ux = Math.cos(B.kataDir), uz = Math.sin(B.kataDir);
    tmp.position.set(ux * (kb.Rin + 0.06), kb.rimY + 0.03, uz * (kb.Rin + 0.06));
    tmp.rotation.set(0.35, Math.atan2(-ux, -uz), 0, 'YXZ');
    tmp.updateMatrixWorld(true);
    const to = new THREE.Vector3(), q1 = new THREE.Quaternion();
    tmp.getWorldPosition(to);
    tmp.getWorldQuaternion(q1);
    B.g.remove(tmp);
    U.tween(0.9, (t) => {
      const e = U.easeInOut(t);
      k.position.lerpVectors(from, to, e);
      k.position.y += Math.sin(e * Math.PI) * 0.35;
      k.quaternion.slerpQuaternions(q0, q1, e);
    }, () => {
      placeKataOnRim(0.35);
      B.state.kata = 'full';
      U.audio.play('clink', 0.5);
      if (done) done();
    });
  };

  function depositFlour(x, z, vol) {
    // spread a fresh pour over a small disc; slumping does the rest
    const rad = 0.18;
    let wsum = 0;
    const cells = [];
    for (let c = 0; c < NG * NG; c++) {
      if (!valid[c]) continue;
      const dx = cxz[c * 2] - x, dz = cxz[c * 2 + 1] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rad * rad * 4) {
        const w = Math.exp(-d2 / (rad * rad));
        cells.push(c, w);
        wsum += w;
      }
    }
    for (let k = 0; k < cells.length; k += 2) B.F[cells[k]] += (vol / CA) * (cells[k + 1] / wsum);
    B.state.flourAdded += vol;
    B.fieldDirty = true;
  }

  // ------------ salt ------------
  function saltNearPitcher() {
    const p = B.pitcher.position, s = B.salt.position;
    return Math.hypot(p.x - s.x, p.z - s.z) < 0.62 && B.pitch.mode === 'home';
  }
  function tipSalt() {
    if (B.state.saltIn || B.saltSt.mode === 'tipping') return;
    B.saltSt.mode = 'tipping';
    const grains = B.salt.userData.grains;
    const pv = B.pitcher.userData.vis;
    U.audio.play('salt', 0.8);
    grains.forEach((gm, i) => {
      U.after(i * 0.025, () => {
        const wp = new THREE.Vector3();
        gm.getWorldPosition(wp);
        pv.attach(gm);
        const from = gm.position.clone();
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.12;
        const to = new THREE.Vector3(Math.cos(a) * r, 0.025, Math.sin(a) * r);
        U.tween(0.45, (t) => {
          gm.position.lerpVectors(from, to, t);
          gm.position.y += Math.sin(t * Math.PI) * 0.12;
        }, () => {
          if (i % 6 === 0) U.audio.play('tick', 0.3);
        });
        B.pitch.grains.push({ m: gm, life: 1, base: to.clone(), ph: Math.random() * 6 });
      });
    });
    U.after(grains.length * 0.025 + 0.5, () => {
      B.state.saltIn = true;
      B.salt.userData.grains = [];
      B.saltSt.mode = 'emptyHeld';
    });
  }

  // ------------ pitcher ------------
  function updatePitcherWater(dt) {
    const pt = B.pitch, ud = B.pitcher.userData;
    const lv = B.state.water / VW;
    const y = 0.03 + lv * 0.42;
    const r = U.kit.profR(ud.prof, y) - 0.012;
    const w = ud.water;
    w.visible = lv > 0.02;
    w.position.set(0, y, 0);
    w.scale.set(r, r, 1);
    // keep the surface level in world, with a little slosh
    B.pitcher.updateMatrixWorld(true);
    const qw = new THREE.Quaternion();
    ud.vis.getWorldQuaternion(qw);
    const lvl = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + pt.slosh.y, 0, pt.slosh.x));
    w.quaternion.copy(qw.invert().multiply(lvl));
  }

  function pitcherPourPose(fingerWorld) {
    // place the pitcher so its spout tip sits over the chosen point inside the bowl
    const lp = B.g.worldToLocal(_v.copy(fingerWorld));
    let r = Math.hypot(lp.x, lp.z);
    const ang = Math.atan2(lp.z, lp.x);
    r = U.clamp(r, 0.25, kb.Rin - 0.1);
    const tipL = _v2.set(Math.cos(ang) * r, kb.rimY + 0.32, Math.sin(ang) * r);
    const tipW = B.g.localToWorld(tipL.clone());
    const dirW = B.g.localToWorld(new THREE.Vector3(Math.cos(ang), kb.rimY, Math.sin(ang))).sub(B.g.localToWorld(new THREE.Vector3(0, kb.rimY, 0))).setY(0).normalize();
    const lv = B.state.water / VW;
    const tilt = 0.75 + (1 - lv) * 0.55;
    const P = B.pitcher;
    // spout faces the bowl centre (-dir)
    P.rotation.set(0, Math.atan2(-dirW.x, -dirW.z), 0, 'YXZ');
    P.rotation.x = tilt;
    P.position.set(0, 0, 0);
    P.updateMatrixWorld(true);
    const sp = P.localToWorld(P.userData.spout.clone());
    P.position.copy(tipW).sub(sp);
    P.updateMatrixWorld(true);
    return { tipW, tilt, local: new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r), ang };
  }

  // ------------ clumps ------------
  function clumpRadius(c) {
    return Math.cbrt((3 * (c.f + c.w) * 0.82) / (4 * Math.PI));
  }
  function newClump(x, z, f, w) {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const base = geo.attributes.position.array.slice();
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const mesh = new THREE.Mesh(geo, U.kit.mat.doughV);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    B.g.add(mesh);
    const c = {
      x, z, f, w, mesh, base, seed: Math.random() * 50, smooth: 0, held: false,
      vx: 0, vz: 0, q: new THREE.Quaternion(), sq: 0, sqv: 0, lastShape: -1, r: 0, travel: 0,
    };
    c.r = clumpRadius(c);
    B.clumps.push(c);
    reshapeClump(c, true);
    U.audio.play('squish', 0.6, 0.2);
    return c;
  }
  function reshapeClump(c, force) {
    const lump = 0.22 * (1 - c.smooth) + 0.03;
    const dryness = U.clamp(1 - (c.w / Math.max(1e-5, c.f)) / 0.45, 0, 1);
    const key = Math.round(lump * 50) + Math.round(dryness * 20) * 100;
    if (!force && key === c.lastShape) return;
    c.lastShape = key;
    const pos = c.mesh.geometry.attributes.position, col = c.mesh.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = c.base[i * 3], y = c.base[i * 3 + 1], z = c.base[i * 3 + 2];
      const n = U.noise3(x * 2.3 + c.seed, y * 2.3, z * 2.3 + c.seed) - 0.5;
      const n2 = U.noise3(x * 6 + c.seed, y * 6 - c.seed, z * 6) - 0.5;
      const k = 1 + n * lump * 1.6 + n2 * lump * 0.6;
      pos.setXYZ(i, x * k, y * k, z * k);
      const fleck = U.clamp(n2 * 3 + 0.2, 0, 1) * (1 - c.smooth) * (0.4 + dryness);
      col.setXYZ(i, U.lerp(0.9, 0.97, fleck), U.lerp(0.86, 0.96, fleck), U.lerp(0.73, 0.92, fleck));
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    c.mesh.geometry.computeVertexNormals();
  }
  function removeClump(c) {
    B.g.remove(c.mesh);
    c.mesh.geometry.dispose();
    const i = B.clumps.indexOf(c);
    if (i >= 0) B.clumps.splice(i, 1);
  }
  function clumpY(c) {
    const r = Math.hypot(c.x, c.z);
    return L.kbY(r) + c.r * 0.82 * (1 - c.sq);
  }

  // gather wet flour around a point into a new clump
  function spawnClumpAt(x, z, rad) {
    let f = 0, w = 0;
    for (let c = 0; c < NG * NG; c++) {
      if (!valid[c]) continue;
      const dx = cxz[c * 2] - x, dz = cxz[c * 2 + 1] - z;
      if (dx * dx + dz * dz > rad * rad) continue;
      const hyd = Math.min(B.F[c], B.W[c] / 0.5);
      if (hyd <= 0) continue;
      const tf = hyd * 0.9;
      const tw = Math.min(B.W[c], tf * 0.5) + B.P[c] * 0.7;
      B.F[c] -= tf;
      B.W[c] = Math.max(0, B.W[c] - Math.min(B.W[c], tf * 0.5));
      B.P[c] *= 0.3;
      f += tf * CA;
      w += tw * CA;
    }
    if (f < 0.0012) return null;
    B.fieldDirty = true;
    return newClump(x, z, f, w);
  }
  function wetAround(x, z, rad) {
    let s = 0;
    for (let c = 0; c < NG * NG; c++) {
      if (!valid[c]) continue;
      const dx = cxz[c * 2] - x, dz = cxz[c * 2 + 1] - z;
      if (dx * dx + dz * dz > rad * rad) continue;
      s += Math.min(B.F[c], B.W[c] / 0.5) * CA;
    }
    return s;
  }

  // a clump rolling over the field picks up what it touches
  function clumpPick(c, dist, dirx, dirz) {
    if (dist <= 0) return;
    const rc = c.r * 0.95 + 0.05;
    const reach = Math.min(1, (dist * 2.0) / rc);
    const rho = c.w / Math.max(1e-5, c.f);
    const total = B.state.flourAdded || VF;
    const share = c.f / total;
    let stick = U.clamp((rho - 0.3) * 3, 0.14, 1);
    if (share > 0.8) stick = Math.max(stick, 0.6) * 2.2;
    let dryTaken = 0, pushed = 0;
    for (let k = 0; k < NG * NG; k++) {
      if (!valid[k] || B.F[k] <= 0 && B.P[k] <= 0) continue;
      const dx = cxz[k * 2] - c.x, dz = cxz[k * 2 + 1] - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rc * rc) continue;
      const fall = 1 - Math.sqrt(d2) / rc;
      const hyd = Math.min(B.F[k], B.W[k] / 0.5);
      const tH = hyd * reach * (0.6 + fall * 0.4);
      const tW = Math.min(B.W[k], tH * 0.5);
      B.F[k] -= tH;
      B.W[k] -= tW;
      c.f += tH * CA;
      c.w += tW * CA;
      const pw = B.P[k] * reach * 0.8;
      B.P[k] -= pw;
      c.w += pw * CA;
      const dry = Math.max(0, B.F[k] - B.W[k] / 0.5);
      const tD = Math.min(dry, dry * reach * stick * 0.4);
      B.F[k] -= tD;
      c.f += tD * CA;
      dryTaken += tD;
      // dry flour that would not stick is pushed to the side
      const left = Math.max(0, B.F[k] - B.W[k] / 0.5);
      if (left > 0.002 && fall > 0.2) {
        const mv = left * reach * 0.35;
        const sx = dx * 1.0 + dirx * c.r * 0.6, sz = dz * 1.0 + dirz * c.r * 0.6;
        const sl = Math.hypot(sx, sz) || 1;
        const tx = c.x + (sx / sl) * (rc + CS), tz = c.z + (sz / sl) * (rc + CS);
        const t = cellOf(tx, tz);
        if (t >= 0 && valid[t]) {
          B.F[k] -= mv;
          B.F[t] += mv;
          pushed += mv;
        }
      }
      if (B.F[k] < 0) B.F[k] = 0;
      if (B.W[k] < 0) B.W[k] = 0;
    }
    if (pushed > 0.004 || dryTaken > 0.004) {
      const wp = B.g.localToWorld(_v.set(c.x, clumpY(c) - c.r * 0.5, c.z));
      if (Math.random() < 0.6) {
        U.fx.spawn('flour', {
          p: wp.add(_v2.set(U.rand(-c.r, c.r) * 0.8, 0, U.rand(-c.r, c.r) * 0.8)),
          v: _v3.set(U.rand(-0.4, 0.4), U.rand(0.2, 0.6), U.rand(-0.4, 0.4)), life: 0.6, size: U.rand(0.6, 1.1), g: 6,
        });
      }
      B.rubLevel = Math.min(1, B.rubLevel + pushed * 2 + dryTaken);
    }
    c.r = clumpRadius(c);
    B.fieldDirty = true;
  }

  // ------------ input ------------
  let hold = null; // {type, clump, ...}
  B.hold = () => hold;

  function bowlLocalFromRay(ray) {
    // intersect a plane through the bowl, then express in bowl-local coordinates
    const wy = kb.lift + 0.32;
    const p = U.core.planeY(ray, wy, new THREE.Vector3());
    if (!p) return null;
    const lp = B.g.worldToLocal(p);
    return lp;
  }

  function setupPicks() {
    const C = U.core;
    // katakuchi
    C.addPick({
      target: B.kata,
      priority: 3,
      enabled: () => B.state.kata === 'full' || B.state.kata === 'away',
      down() {
        if (B.state.kata === 'full') B.kataPour();
        else {
          U.audio.play('clink', 0.4, 0.2);
          wobble(B.kata, 0.08);
        }
        return true;
      },
    });
    // salt dish
    const sp = { home: new THREE.Vector3(L.salt.x, 0, L.salt.z) };
    C.addPick({
      target: B.salt,
      area: 'knead',
      priority: 3,
      enabled: () => B.saltSt.mode !== 'tipping' && B.saltSt.mode !== 'returning',
      down(e) {
        U.audio.play('clink', 0.35, 0.5);
        sp.start = e.point ? e.point.clone() : B.salt.position.clone();
        sp.off = B.salt.position.clone().sub(sp.start).setY(0);
        B.saltSt.mode = B.state.saltIn ? 'emptyHeld' : 'held';
        return true;
      },
      move(e) {
        const p = C.planeY(e.ray, 0.45, _v);
        if (!p) return;
        const tgt = p.add(sp.off);
        if (!B.state.saltIn && B.saltSt.mode === 'held' && Math.hypot(tgt.x - B.pitcher.position.x, tgt.z - B.pitcher.position.z) < 0.62 && B.pitch.mode === 'home') {
          // snap beside the pitcher mouth and tip in
          const pm = B.pitcher.localToWorld(B.pitcher.userData.mouth.clone());
          const dir = _v2.copy(tgt).sub(B.pitcher.position).setY(0).normalize();
          B.salt.position.set(pm.x + dir.x * 0.3, pm.y + 0.06, pm.z + dir.z * 0.3);
          B.salt.rotation.set(0, Math.atan2(dir.x, dir.z), 0, 'YXZ');
          B.salt.rotateX(-0.9);
          tipSalt();
          return;
        }
        if (B.saltSt.mode === 'tipping') return;
        B.salt.position.set(tgt.x, 0.3, tgt.z);
        B.salt.rotation.set(0, 0, 0);
      },
      up() {
        // back to its place
        const from = B.salt.position.clone();
        const q0 = B.salt.quaternion.clone();
        const q1 = new THREE.Quaternion();
        const wait = B.saltSt.mode === 'tipping' ? 1.1 : 0;
        U.after(wait, () => {
          const f2 = B.salt.position.clone();
          B.saltSt.mode = 'returning';
          U.tween(0.5, (t) => {
            const e = U.easeInOut(t);
            B.salt.position.lerpVectors(f2, sp.home, e);
            B.salt.position.y += Math.sin(e * Math.PI) * 0.2;
            B.salt.quaternion.slerpQuaternions(q0, q1, e);
          }, () => {
            B.saltSt.mode = 'home';
            U.audio.play('clink', 0.25, 0.6);
          });
        });
        void from;
      },
    });
    // pitcher
    const pp = { home: new THREE.Vector3(L.pitcher.x, 0, L.pitcher.z) };
    C.addPick({
      target: B.pitcher,
      priority: 3,
      enabled: () => B.pitch.mode === 'home',
      down() {
        B.pitch.mode = 'carry';
        B.pitch.lastPos.copy(B.pitcher.position);
        U.audio.play('clink', 0.35, 0.1);
        return true;
      },
      move(e) {
        const p = C.planeY(e.ray, 0.25, _v);
        if (!p) return;
        B.pitch.finger = p.clone();
      },
      up() {
        B.pitch.finger = null;
        B.pitch.mode = 'returning';
        B.stream.visible = false;
        U.audio.loop('pour', 0);
        const from = B.pitcher.position.clone();
        const q0 = B.pitcher.quaternion.clone();
        const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.9, 0));
        U.tween(0.6, (t) => {
          const e = U.easeInOut(t);
          B.pitcher.position.lerpVectors(from, pp.home, e);
          B.pitcher.position.y += Math.sin(e * Math.PI) * 0.15;
          B.pitcher.quaternion.slerpQuaternions(q0, q1, e);
        }, () => {
          B.pitch.mode = 'home';
          U.audio.play('clink', 0.3, 0.05);
        });
      },
    });
    // bowl interior: clumps, flour, dough
    C.addPick({
      target: [B.g.userData.inner, B.flourMesh],
      priority: 1,
      enabled: () => !B.state.lifted || B.clumps.length > 0 || B.flourTotal() > 0.001,
      down(e) {
        const lp = bowlLocalFromRay(e.ray);
        if (!lp) return false;
        U.audio.play('lacquer', 0.25);
        // ready dough: lift
        if (B.state.ready && B.clumps.length === 1) {
          startLift(e);
          return true;
        }
        let best = null, bd = Infinity;
        for (const c of B.clumps) {
          const d = Math.hypot(c.x - lp.x, c.z - lp.z) - c.r;
          if (d < 0.16 && d < bd) { bd = d; best = c; }
        }
        if (!best && wetAround(lp.x, lp.z, 0.16) > 0.0012) best = spawnClumpAt(lp.x, lp.z, 0.16);
        if (best) {
          hold = { type: 'clump', c: best, tx: lp.x, tz: lp.z };
          best.held = true;
          best.sqv -= 1.2;
          U.audio.play(best.w / Math.max(1e-5, best.f) > 0.3 ? 'squish' : 'pat', 0.5, 0.1);
        } else {
          hold = { type: 'furrow', x: lp.x, z: lp.z };
        }
        return true;
      },
      move(e) {
        if (!hold) return;
        if (hold.type === 'lift') return moveLift(e);
        const lp = bowlLocalFromRay(e.ray);
        if (!lp) return;
        if (hold.type === 'clump') {
          hold.tx = lp.x;
          hold.tz = lp.z;
        } else if (hold.type === 'furrow') {
          furrow(hold.x, hold.z, lp.x, lp.z);
          hold.x = lp.x;
          hold.z = lp.z;
          // reaching wet flour turns the furrow into a clump
          if (wetAround(lp.x, lp.z, 0.12) > 0.0015) {
            const c = spawnClumpAt(lp.x, lp.z, 0.14);
            if (c) {
              hold = { type: 'clump', c, tx: lp.x, tz: lp.z };
              c.held = true;
            }
          }
        }
      },
      up(e) {
        if (!hold) return;
        if (hold.type === 'lift') endLift(e);
        else if (hold.type === 'clump') hold.c.held = false;
        hold = null;
        U.audio.loop('rub', 0);
        U.audio.loop('stir', 0);
      },
    });
  }

  function wobble(obj, amt) {
    const vis = obj.userData.vis || obj;
    const r0 = vis.rotation.z;
    U.tween(0.5, (t) => { vis.rotation.z = r0 + Math.sin(t * Math.PI * 4) * amt * (1 - t); });
  }
  B.wobble = wobble;

  // dragging a finger through dry flour pushes it aside
  function furrow(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const nx = -dz / d, nz = dx / d;
    const rad = 0.09;
    let moved = 0;
    for (let c = 0; c < NG * NG; c++) {
      if (!valid[c] || B.F[c] < 0.002) continue;
      const px = cxz[c * 2] - x1, pz = cxz[c * 2 + 1] - z1;
      if (px * px + pz * pz > rad * rad) continue;
      const dry = Math.max(0, B.F[c] - B.W[c] / 0.5);
      const mv = dry * Math.min(1, d * 6) * 0.5;
      const side = px * nx + pz * nz >= 0 ? 1 : -1;
      const t = cellOf(x1 + nx * side * (rad + CS), z1 + nz * side * (rad + CS));
      if (t >= 0 && valid[t]) {
        B.F[c] -= mv;
        B.F[t] += mv;
        moved += mv;
      }
    }
    if (moved > 0.001) {
      B.fieldDirty = true;
      B.rubLevel = Math.min(1, B.rubLevel + moved * 6);
      if (Math.random() < 0.7) {
        const wp = B.g.localToWorld(_v.set(x1, B.surfaceAt(x1, z1) + 0.02, z1));
        U.fx.spawn('flour', { p: wp, v: _v2.set(nx * U.rand(-0.6, 0.6), U.rand(0.3, 0.8), nz * U.rand(-0.6, 0.6)), life: 0.7, g: 8, size: U.rand(0.6, 1.2) });
      }
    }
  }

  // ------------ lift the dough ------------
  function startLift(e) {
    const c = B.clumps[0];
    const wp = B.g.localToWorld(new THREE.Vector3(c.x, clumpY(c), c.z));
    const fp = U.core.planeY(e.ray, wp.y, new THREE.Vector3()) || wp.clone();
    hold = { type: 'lift', c, start: fp, base: wp, stretch: 0, free: false, finger: fp.clone() };
    c.held = true;
    c.sqv -= 1;
    U.audio.play('squish', 0.5, 0.3);
  }
  function moveLift(e) {
    const h = hold;
    if (!h.free) {
      const fp = U.core.planeY(e.ray, h.base.y, _v);
      if (!fp) return;
      const d = Math.hypot(fp.x - h.start.x, fp.z - h.start.z) + Math.max(0, (h.start.z - fp.z) * 0.2);
      h.stretch = U.clamp(d / 0.75, 0, 1);
      h.dir = (h.dir || new THREE.Vector3()).copy(fp).sub(h.start).setY(0);
      if (h.stretch >= 1) {
        h.free = true;
        U.audio.play('pop', 0.8);
        // leave a little dust where the dough sat (low side) for the next ball
        const c = h.c;
        leaveDust(c.x, c.z, c.r);
        const wp = B.g.localToWorld(new THREE.Vector3(c.x, clumpY(c), c.z));
        U.core.scene.attach(c.mesh);
        c.mesh.position.copy(wp);
        h.ballPos = wp.clone();
        B.state.lifted = true;
      }
    }
    if (h.free) {
      const fp = U.core.planeY(e.ray, kb.rimY + 0.55, _v);
      if (fp) h.finger.copy(fp);
    }
  }
  function endLift() {
    const h = hold;
    const c = h.c;
    c.held = false;
    if (!h.free) {
      h.stretch = 0;
      return;
    }
    const Bd = L.board;
    const tgt = h.finger.clone();
    const onBoard = tgt.x > Bd.x0 + 0.5 && tgt.x < Bd.x1 - 0.5 && tgt.z > Bd.z0 + 0.6 && tgt.z < Bd.z1 - 0.6;
    if (!onBoard) tgt.set(Bd.x - 0.05, 0, Bd.z + 0.1);
    tgt.x = U.clamp(tgt.x, Bd.x0 + 0.7, Bd.x1 - 0.7);
    tgt.z = U.clamp(tgt.z, Bd.z0 + 0.75, Bd.z1 - 0.7);
    const from = c.mesh.position.clone();
    const vol = (c.f + c.w) * 0.82;
    const r = c.r;
    B.state.flying = true;
    U.tween(0.5, (t) => {
      c.mesh.position.lerpVectors(from, _v.set(tgt.x, Bd.top + r * 0.8, tgt.z), t);
      c.mesh.position.y += Math.sin(t * Math.PI) * 0.5;
      c.mesh.scale.setScalar(r);
    }, () => {
      U.audio.play('thud', 0.9);
      U.audio.play('squish', 0.6, 0);
      U.core.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      B.clumps.length = 0;
      B.state.flying = false;
      U.sheet.placeDough(tgt.x, tgt.z, vol);
      // clear field of remaining traces except dust
      for (let k = 0; k < NG * NG; k++) {
        B.F[k] = B.dust[k] > 0 ? B.F[k] : 0;
        B.W[k] = 0;
        B.P[k] = 0;
      }
      B.fieldDirty = true;
    });
    hold = null;
  }
  function leaveDust(x, z, r) {
    B.dust.fill(0);
    let n = 0;
    for (let k = 0; k < NG * NG; k++) {
      if (!valid[k]) continue;
      const dx = cxz[k * 2] - x, dz = cxz[k * 2 + 1] - z;
      const d = Math.hypot(dx, dz);
      if (d < r * 1.1 && d > r * 0.3) { B.dust[k] = 1; n++; }
    }
    if (!n) return;
    const per = 0.0045 / CA / n;
    for (let k = 0; k < NG * NG; k++) if (B.dust[k]) { B.F[k] = per * (0.5 + U.hash2(k, 9)); B.W[k] = 0; }
    B.fieldDirty = true;
  }

  // ------------ per frame ------------
  B.rubLevel = 0;
  let slumpT = 0;
  const gl = new THREE.Vector3();
  B.update = function (dt) {
    const st = B.state;
    // pitcher carry / pour
    const pt = B.pitch;
    if (pt.mode === 'carry' && pt.finger) {
      const f = pt.finger;
      const lp = B.g.worldToLocal(_v.copy(f));
      const inBowl = Math.hypot(lp.x, lp.z) < kb.Rin + 0.2 && st.flourAdded > 0.01;
      if (inBowl && st.water > 0.0005) {
        const pose = pitcherPourPose(f);
        const rate = 0.026 * U.smooth(0.6, 0.9, pose.tilt + 0.15);
        const amt = Math.min(st.water, rate * dt);
        st.water -= amt;
        pourWater(pose, amt);
        B.stream.visible = true;
        const tip = pose.tipW;
        const ly = B.g.localToWorld(_v3.set(pose.local.x * 0.92, B.surfaceAt(pose.local.x * 0.92, pose.local.z * 0.92) + Math.min(0.1, B.P[Math.max(0, cellOf(pose.local.x * 0.92, pose.local.z * 0.92))] || 0), pose.local.z * 0.92));
        const len = Math.max(0.05, tip.y - ly.y);
        B.stream.position.copy(tip);
        B.stream.scale.set(1 + Math.sin(U.core.time * 30) * 0.08, len, 1);
        // cylinder hangs along -y from the tip toward the impact point
        B.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), _v.copy(ly).sub(tip).normalize());
        U.audio.loop('pour', 0.22, 900 + 700 * (st.water / VW), 1.5);
        if (Math.random() < 0.3) U.fx.splash(ly, 0.08, 'drop', ly.y - 0.01);
      } else {
        B.stream.visible = false;
        U.audio.loop('pour', 0);
        const P = B.pitcher;
        const want = new THREE.Vector3(f.x, 0.25, f.z);
        P.position.lerp(want, 1 - Math.exp(-18 * dt));
        P.rotation.set(0, P.rotation.y, 0);
      }
      // slosh and shake (dissolves the salt)
      const mv = _v2.copy(B.pitcher.position).sub(pt.lastPos);
      pt.lastPos.copy(B.pitcher.position);
      pt.shake += mv.length();
      pt.sloshV.x += -mv.x * 30;
      pt.sloshV.y += mv.z * 30;
    }
    pt.sloshV.x += -pt.slosh.x * 60 * dt;
    pt.sloshV.y += -pt.slosh.y * 60 * dt;
    pt.sloshV.multiplyScalar(Math.exp(-3 * dt));
    pt.slosh.addScaledVector(pt.sloshV, dt);
    pt.slosh.x = U.clamp(pt.slosh.x, -0.3, 0.3);
    pt.slosh.y = U.clamp(pt.slosh.y, -0.3, 0.3);
    updatePitcherWater(dt);
    // salt grains dissolve with motion
    if (pt.grains.length) {
      const shake = pt.shake;
      pt.shake = 0;
      const sl = Math.hypot(pt.slosh.x, pt.slosh.y);
      for (let i = pt.grains.length - 1; i >= 0; i--) {
        const g = pt.grains[i];
        g.life -= shake * 1.6 + sl * dt * 3 + dt * 0.01;
        g.ph += dt * (3 + sl * 20);
        g.m.position.set(g.base.x + Math.sin(g.ph) * sl * 0.1, g.base.y, g.base.z + Math.cos(g.ph * 1.3) * sl * 0.1);
        g.m.scale.setScalar(Math.max(0.01, g.life));
        if (g.life <= 0) {
          g.m.parent && g.m.parent.remove(g.m);
          pt.grains.splice(i, 1);
        }
      }
      st.saltDissolve = 1 - pt.grains.length / 36;
    } else pt.shake = 0;

    // field physics
    slumpT += dt;
    if (slumpT > 1 / 30) {
      slumpT = 0;
      fieldStep(1 / 30);
    }

    // clumps
    B.g.updateMatrixWorld();
    gl.set(0, -1, 0).applyQuaternion(B.g.getWorldQuaternion(new THREE.Quaternion()).invert());
    for (const c of B.clumps) {
      if (c === (hold && hold.type === 'lift' && hold.free ? hold.c : null)) continue;
      let mx = 0, mz = 0;
      if (c.held && hold && hold.type === 'clump' && hold.c === c) {
        const dx = hold.tx - c.x, dz = hold.tz - c.z;
        const d = Math.hypot(dx, dz);
        const stepL = Math.min(d, 3.2 * dt + d * 0.15);
        if (d > 1e-4) { mx = (dx / d) * stepL; mz = (dz / d) * stepL; }
        c.vx = mx / Math.max(dt, 1e-3);
        c.vz = mz / Math.max(dt, 1e-3);
      } else {
        // slide down the bowl curve (and the gentle tilt)
        const r = Math.hypot(c.x, c.z);
        const slope = r / Math.sqrt(Math.max(1e-4, kb.Rs * kb.Rs - r * r));
        const gx = r > 1e-4 ? -(c.x / r) * slope : 0, gz = r > 1e-4 ? -(c.z / r) * slope : 0;
        c.vx += (gx * 3 + gl.x * 2.2) * dt;
        c.vz += (gz * 3 + gl.z * 2.2) * dt;
        c.vx *= Math.exp(-4 * dt);
        c.vz *= Math.exp(-4 * dt);
        mx = c.vx * dt;
        mz = c.vz * dt;
      }
      c.x += mx;
      c.z += mz;
      // stay inside: the wall pushes back
      const rr = Math.hypot(c.x, c.z), lim = kb.Rin - c.r * 0.75;
      if (rr > lim) {
        c.x *= lim / rr;
        c.z *= lim / rr;
        c.vx *= -0.3;
        c.vz *= -0.3;
      }
      const d = Math.hypot(mx, mz);
      if (d > 1e-5) {
        clumpPick(c, d, mx / d, mz / d);
        // roll
        const ax = _v.set(mz, 0, -mx).normalize();
        c.q.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, d / Math.max(0.05, c.r)));
        if (c.held) {
          c.travel += d;
          if (st.gathered) c.smooth = Math.min(1, c.smooth + d * 0.1);
          const wet = c.w / Math.max(1e-5, c.f);
          U.audio.loop('stir', Math.min(0.2, d / dt * 0.04), 300 + wet * 400);
        }
      }
      // squash spring
      c.sqv += (-c.sq * 160 - c.sqv * 9) * dt;
      c.sq += c.sqv * dt;
      reshapeClump(c);
      const sr = c.r;
      let sx = sr * (1 + c.sq * 0.5), sy = sr * (1 - c.sq), sz = sx;
      if (hold && hold.type === 'lift' && hold.c === c && !hold.free) {
        const s = hold.stretch;
        sy *= 1 + s * 0.55;
        sx *= 1 - s * 0.16;
        sz *= 1 - s * 0.16;
      }
      c.mesh.scale.set(sx, sy, sz);
      c.mesh.quaternion.copy(c.q);
      c.mesh.position.set(c.x, L.kbY(Math.hypot(c.x, c.z)) + sy * 0.82, c.z);
      if (hold && hold.type === 'lift' && hold.c === c && !hold.free && hold.dir) {
        const lpd = B.g.worldToLocal(_v.copy(hold.base).add(hold.dir)).sub(B.g.worldToLocal(_v2.copy(hold.base)));
        c.mesh.position.x += lpd.x * 0.25;
        c.mesh.position.z += lpd.z * 0.25;
      }
    }
    // free (lifted) dough follows the finger
    if (hold && hold.type === 'lift' && hold.free) {
      const c = hold.c;
      c.mesh.position.lerp(hold.finger, 1 - Math.exp(-14 * dt));
      c.sqv += (-c.sq * 160 - c.sqv * 9) * dt;
      c.sq += c.sqv * dt;
      c.mesh.scale.set(c.r * (1 + c.sq * 0.5), c.r * (1 - c.sq + 0.06), c.r * (1 + c.sq * 0.5));
    }
    // merges
    for (let i = 0; i < B.clumps.length; i++) {
      for (let j = i + 1; j < B.clumps.length; j++) {
        const a = B.clumps[i], b = B.clumps[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < (a.r + b.r) * 0.85) {
          const keep = a.held || (!b.held && a.f >= b.f) ? a : b, gone = keep === a ? b : a;
          keep.f += gone.f;
          keep.w += gone.w;
          keep.r = clumpRadius(keep);
          keep.smooth *= 0.6;
          keep.sqv -= 0.8;
          removeClump(gone);
          U.audio.play('pat', 0.5);
          j = B.clumps.length;
        }
      }
    }
    // gathered?
    if (!st.ready && B.clumps.length === 1 && st.flourAdded > 0.05) {
      const c = B.clumps[0];
      const rest = B.flourTotal();
      if (!st.gathered && rest < 0.075 * st.flourAdded && st.water < VW * 0.25) {
        // the last crumbs join the dough
        st.gathered = true;
        for (let k = 0; k < NG * NG; k++) {
          if (B.dust[k] && st.round > 0) continue;
          c.f += B.F[k] * CA;
          c.w += (B.W[k] + B.P[k]) * CA;
          B.F[k] = 0; B.W[k] = 0; B.P[k] = 0;
        }
        c.r = clumpRadius(c);
        B.fieldDirty = true;
        U.audio.play('pat', 0.7);
      }
      if (st.gathered && c.smooth >= 1) {
        st.ready = true;
        c.smooth = 1;
        reshapeClump(c, true);
        U.audio.play('chime');
      }
    }
    // sounds
    B.rubLevel *= Math.exp(-6 * dt);
    U.audio.loop('rub', B.rubLevel * 0.12, 4200 + B.rubLevel * 1500);
    if (B.fieldDirty) {
      B.fieldDirty = false;
      updateFieldMeshes();
    }
  };

  function pourWater(pose, amt) {
    // water lands slightly inward of the spout
    const x = pose.local.x * 0.92, z = pose.local.z * 0.92;
    let c = cellOf(x, z);
    if (c < 0 || !valid[c]) return;
    // the first water reaches last ball's dust first
    if (B.state.round > 0 && !B.state.dustWet) {
      let dn = 0;
      for (let k = 0; k < NG * NG; k++) if (B.dust[k] && B.F[k] > 0) dn++;
      if (dn) {
        const part = amt * 0.6;
        for (let k = 0; k < NG * NG; k++) if (B.dust[k] && B.F[k] > 0) B.W[k] += part / CA / dn;
        amt -= part;
        B.state.dustAcc = (B.state.dustAcc || 0) + part;
        if (B.state.dustAcc > 0.004) {
          B.state.dustWet = true;
          // a small clump forms there first
          let sx = 0, sz = 0, n = 0;
          for (let k = 0; k < NG * NG; k++) if (B.dust[k]) { sx += cxz[k * 2]; sz += cxz[k * 2 + 1]; n++; }
          if (n) {
            const cl = spawnClumpAt(sx / n, sz / n, 0.3);
            if (cl) cl.sqv -= 1;
          }
          B.dust.fill(0);
        }
      }
    }
    B.P[c] += (amt / CA) * 0.6;
    // neighbours get a bit
    const i = c % NG, j = (c / NG) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NG || jj >= NG) continue;
      const n = idx(ii, jj);
      if (valid[n]) B.P[n] += (amt / CA) * 0.1;
    }
    B.fieldDirty = true;
    if (Math.random() < 0.15) U.audio.play('drip', Math.random(), 0);
  }

  const flowTmp = new Float32Array(NG * NG);
  function fieldStep(dt) {
    let any = false;
    // absorption
    for (let c = 0; c < NG * NG; c++) {
      if (!valid[c]) continue;
      if (B.P[c] > 0) {
        any = true;
        const cap = Math.max(0, B.F[c] * CAP - B.W[c]);
        const a = Math.min(B.P[c], cap * (1 - Math.exp(-5 * dt)));
        B.P[c] -= a;
        B.W[c] += a;
      }
    }
    // free water flows to lower neighbours
    if (any) {
      flowTmp.fill(0);
      for (let j = 0; j < NG; j++) {
        for (let i = 0; i < NG; i++) {
          const c = idx(i, j);
          if (!valid[c] || B.P[c] <= 1e-5) continue;
          const hc = surf(c) + B.P[c];
          let out = 0;
          const nb = [];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= NG || jj >= NG) continue;
            const n = idx(ii, jj);
            if (!valid[n]) continue;
            const dh = hc - (surf(n) + B.P[n]);
            if (dh > 0) { nb.push(n, dh); out += dh; }
          }
          if (!out) continue;
          const mv = Math.min(B.P[c], out * 0.22);
          for (let k = 0; k < nb.length; k += 2) {
            const q = mv * (nb[k + 1] / out);
            flowTmp[nb[k]] += q;
            flowTmp[c] -= q;
          }
        }
      }
      for (let c = 0; c < NG * NG; c++) B.P[c] = Math.max(0, B.P[c] + flowTmp[c]);
    }
    // dry flour slumps when the slope is steep
    const rep = CS * 0.9;
    for (let j = 0; j < NG; j++) {
      for (let i = 0; i < NG; i++) {
        const c = idx(i, j);
        if (!valid[c] || B.F[c] < 0.002) continue;
        const dry = Math.max(0, B.F[c] - B.W[c] / 0.5);
        if (dry < 0.001) continue;
        const hc = surf(c);
        let best = -1, bd = rep;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= NG || jj >= NG) continue;
          const n = idx(ii, jj);
          if (!valid[n]) continue;
          const dh = hc - surf(n);
          if (dh > bd) { bd = dh; best = n; }
        }
        if (best >= 0) {
          const mv = Math.min(dry * 0.5, (bd - rep) * 0.35);
          B.F[c] -= mv;
          B.F[best] += mv;
          B.fieldDirty = true;
        }
      }
    }
    if (any) B.fieldDirty = true;
  }

  // ------------ rounds ------------
  B.round = { mound: { x: 0, z: 0 } };
  B.newRound = function (n) {
    const st = B.state;
    st.round = n;
    st.flourAdded = 0;
    st.saltIn = false;
    st.saltDissolve = 0;
    st.water = VW;
    st.gathered = false;
    st.ready = false;
    st.lifted = false;
    st.dustWet = false;
    st.dustAcc = 0;
    B.round.mound = { x: U.rand(-0.22, 0.12) + (n ? 0.05 : -0.05), z: U.rand(-0.2, 0.15) };
  };
  B.refillSalt = function () {
    const vis = B.salt.userData.vis;
    const gg = new THREE.BoxGeometry(0.022, 0.022, 0.022);
    const grains = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(gg, U.kit.mat.salt);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.1;
      m.position.set(Math.cos(a) * r, 0.02 + (0.1 - r) * 0.35 + Math.random() * 0.01, Math.sin(a) * r);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      m.scale.setScalar(0.01);
      vis.add(m);
      grains.push(m);
      U.after(i * 0.02, () => U.tween(0.3, (t) => m.scale.setScalar(Math.max(0.01, t))));
    }
    B.salt.userData.grains = grains;
  };
  B.refillWater = function () {
    B.state.water = VW;
  };
  B.VW = VW;
  B.VF = VF;
})();
