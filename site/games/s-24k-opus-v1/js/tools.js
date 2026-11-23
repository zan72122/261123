/* tools.js — 片口（つゆを注ぐ）と木さじ（白ごまをこぼす）。
   片口は注ぎ口が皿の内側に入ると傾き、最初のひとしずくの後に細い流れが続く。
   さじは皿の上で先から傾き、先の粒から順に転がり出る。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;
  const TL = (G.tools = { drops: [], beads: [] });
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

  TL.init = function (scene) {
    TL.scene = scene;
    // 流れ（細い管を毎フレーム作り直す）
    const RINGS = 18, SIDES = 6;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < RINGS - 1; r++) for (let k = 0; k < SIDES; k++) {
      const a = r * SIDES + k, b = r * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    TL.stream = new THREE.Mesh(g, G.world.mats.drop);
    TL.stream.frustumCulled = false; TL.stream.visible = false; TL.stream.castShadow = false;
    TL.stream.userData = { RINGS, SIDES };
    scene.add(TL.stream);
    // しずく・流れの粒
    TL.dropGeo = new THREE.SphereGeometry(1, 12, 9);
    TL.dropMesh = new THREE.InstancedMesh(TL.dropGeo, G.world.mats.drop, 90);
    TL.dropMesh.count = 0; TL.dropMesh.frustumCulled = false;
    scene.add(TL.dropMesh);
    // さじのごま
    const sp = G.kit.spoon;
    sp.seeds = [];
    sp.seedMesh = new THREE.InstancedMesh(G.dish.seedGeo || (G.dish.seedGeo = G.geom.sesame()), G.world.mats.sesame, 40);
    sp.seedMesh.castShadow = true; sp.seedMesh.frustumCulled = false; sp.seedMesh.userData.sharedMat = true;
    sp.body.add(sp.seedMesh);
    fillSpoon(sp, 22, true);
    const p = G.kit.pitcher;
    p.level = 1; p.pourT = 0; p.firstDrop = false; p.state = 'rest';
    p.pos = p.rest.clone(); p.vel = new THREE.Vector3();
    sp.state = 'rest'; sp.pos = sp.rest.clone(); sp.vel = new THREE.Vector3(); sp.yaw = sp.restYaw;
    p.target = p.rest.clone(); sp.target = sp.rest.clone();
  };

  function fillSpoon(sp, n, instant) {
    const rng = G.rand;
    while (sp.seeds.length < n) {
      const a = rng() * 6.283, r = Math.sqrt(rng()) * 1.05;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 1.3;
      const y = 0.55 * (r * r) / (1.5 * 1.5) - 0.55 + 0.17 + rng() * 0.05 + (1 - r) * 0.08;
      sp.seeds.push({ x, y, z, yaw: rng() * 6.28, p: (rng() - 0.5) * 0.6, thr: 0.32 + 0.5 * M.clamp((z + 2) / 4, 0, 1) + rng() * 0.1, s: instant ? 1 : 0 });
    }
  }
  function updateSpoonSeeds(sp, dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < sp.seeds.length; i++) {
      const s = sp.seeds[i];
      s.s = Math.min(1, s.s + dt * 3);
      e.set(s.p, s.yaw, 0); q.setFromEuler(e); v.set(s.x, s.y, s.z); sc.setScalar(s.s);
      m.compose(v, q, sc); sp.seedMesh.setMatrixAt(i, m);
    }
    sp.seedMesh.count = sp.seeds.length;
    sp.seedMesh.instanceMatrix.needsUpdate = true;
  }

  // 片口・さじが届く皿（手前のくぼみ優先、なければ出口の皿）
  function nearDish(x, z, maxD) {
    let best = null, bd = maxD;
    for (const d of G.dish.list) {
      if (!d.collide) continue;
      const dd = M.dist2(x, z, d.cx, d.cz);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // ---- 片口 ----
  TL.grabPitcher = function () { const p = G.kit.pitcher; p.state = 'held'; p.firstDrop = false; p.pourT = 0; p.reachK = 0; };
  TL.releasePitcher = function () { const p = G.kit.pitcher; p.state = 'returning'; };
  // x,z は指の位置。皿に近づくほど、指が注ぎ口を持つように寄せる
  TL.movePitcher = function (x, z, ox, oz) {
    const p = G.kit.pitcher;
    p.finger = { x, z, ox: ox || 0, oz: oz || 0 };
  };
  function pitcherTarget(p, dt) {
    const f = p.finger;
    if (!f) return;
    const d = nearDish(f.x, f.z, 15);
    p.reachK = M.lerp(p.reachK || 0, d ? 1 : 0, M.damp(3, dt));
    const reach = 5.2;
    const bx = f.x - Math.cos(p.yaw) * reach, bz = f.z + Math.sin(p.yaw) * reach;
    p.target.set(M.lerp(f.x + f.ox, bx, p.reachK), L.TRAY.floorY + 6.6, M.lerp(f.z + f.oz, bz, p.reachK));
  }

  function updatePitcher(dt) {
    const p = G.kit.pitcher;
    const hold = p.state === 'held';
    if (p.state === 'returning') {
      p.target.copy(p.rest);
      if (p.pos.distanceTo(p.rest) < 0.05 && p.tilt < 0.02) { p.state = 'rest'; p.pos.copy(p.rest); if (G.audio) G.audio.wood(G.audio.panOf(p.pos), 0.35, 0.8); }
    }
    if (p.state === 'rest') { p.target.copy(p.rest); }
    if (hold) pitcherTarget(p, dt);
    const k = M.damp(hold ? 14 : 8, dt);
    const prev = tmp2.copy(p.pos);
    p.pos.lerp(p.target, k);
    p.vel.subVectors(p.pos, prev).multiplyScalar(1 / Math.max(dt, 1e-4));
    const d = hold ? nearDish(p.pos.x, p.pos.z, 16) : null;
    let tiltT = 0, yawT = p.state === 'rest' ? p.restYaw : p.yaw;
    let over = false;
    if (d) {
      const dx = d.cx - p.pos.x, dz = d.cz - p.pos.z;
      if (dx * dx + dz * dz > 9) yawT = Math.atan2(-dz, dx);
      // 注ぎ口の水平位置（前のフレームの姿勢で）
      const sw = p.body.localToWorld(tmp.copy(p.spoutTip));
      const ds = M.dist2(sw.x, sw.z, d.cx, d.cz);
      if (ds < L.PLATE.Rin - 1.3) { tiltT = 0.95; over = true; } else if (ds < L.PLATE.R + 2) tiltT = 0.25;
    }
    p.yaw = M.angLerp(p.yaw, yawT, M.damp(6, dt));
    p.tilt = M.lerp(p.tilt, tiltT, M.damp(over ? 2.4 : 5, dt));
    p.group.position.copy(p.pos);
    p.group.rotation.set(0, p.yaw, 0);
    // 注ぎ口の方へ傾ける
    p.body.rotation.set(0, 0, -p.tilt);
    // 中のつゆを水平に
    p.liquid.position.set(0, p.liquidY * (0.45 + 0.55 * p.level), 0);
    p.group.updateMatrixWorld(true);
    p.liquid.getWorldQuaternion(tmpQ);
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const parentQ = new THREE.Quaternion();
    p.body.getWorldQuaternion(parentQ);
    p.liquid.quaternion.copy(parentQ.invert().multiply(want));
    p.liquid.scale.setScalar(Math.max(0.55, 1 - p.tilt * 0.35));
    // 注ぐ
    let rate = 0;
    if (p.tilt > 0.55 && d && p.level > 0.02) {
      const spout = p.body.localToWorld(tmp.copy(p.spoutTip));
      if (!p.firstDrop) {
        p.firstDrop = true; p.pourT = 0;
        spawnDrop(spout, d, true);
      }
      p.pourT += dt;
      if (p.pourT > 0.55) {
        rate = M.clamp((p.tilt - 0.55) / 0.35, 0, 1) * 5.2; // cm^3/s
        if (d.volume >= G.dish.VMAX - 0.5) rate *= 0.08;
        pourStream(spout, d, rate, dt);
        p.level = Math.max(0, p.level - rate * dt / 90);
      }
    } else {
      if (p.tilt < 0.35) p.firstDrop = false;
      TL.stream.visible = false;
    }
    if (p.state === 'rest') p.level = Math.min(1, p.level + dt * 0.02);
    if (G.audio) G.audio.setPour(rate / 5.2);
    p.pouring = rate > 0;
  }

  // 注ぎ口から皿へ落ちる放物線をたどり、着く点を求める
  function trace(spout, dir, d, out) {
    const v0 = 3 + 3 * G.kit.pitcher.tilt;
    let x = spout.x, y = spout.y, z = spout.z, vx = dir.x * v0, vy = -4, vz = dir.z * v0;
    const pts = out.pts; pts.length = 0;
    pts.push(x, y, z);
    const h = 1 / 140;
    for (let s = 0; s < 120; s++) {
      vy -= 980 * h; x += vx * h; y += vy * h; z += vz * h;
      if (s % 3 === 0) pts.push(x, y, z);
      d.toLocal(x, y, z, tmp);
      const r = Math.sqrt(tmp.x * tmp.x + tmp.z * tmp.z);
      if (r < L.PLATE.Rin) {
        const sy = d.surfWet(tmp.x, tmp.z);
        if (tmp.y <= sy) { out.lx = tmp.x; out.lz = tmp.z; out.ly = sy; pts.push(x, y, z); return true; }
      }
      if (y < 0) break;
    }
    return false;
  }
  const TR = { pts: [] };

  function pourStream(spout, d, rate, dt) {
    const p = G.kit.pitcher;
    const dir = tmp2.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const hit = trace(spout, dir, d, TR);
    const st = TL.stream;
    if (!hit) { st.visible = false; return; }
    // 管の形
    const { RINGS, SIDES } = st.userData;
    const pts = TR.pts, np = pts.length / 3;
    const pos = st.geometry.attributes.position.array, nor = st.geometry.attributes.normal.array;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), t = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    for (let r = 0; r < RINGS; r++) {
      const f = r / (RINGS - 1) * (np - 1);
      const i = Math.min(np - 2, Math.floor(f)), u = f - i;
      a.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      b.set(pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
      t.subVectors(b, a).normalize();
      a.lerp(b, u);
      n1.set(0, 1, 0).cross(t); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize();
      n2.crossVectors(t, n1).normalize();
      const rad = (0.055 + 0.07 * Math.sqrt(rate / 5.2)) * (1 - 0.45 * r / RINGS) + Math.sin(G.time * 31 + r * 1.7) * 0.008;
      for (let k = 0; k < SIDES; k++) {
        const ang = k / SIDES * Math.PI * 2;
        const cx = Math.cos(ang), cy = Math.sin(ang);
        const o = (r * SIDES + k) * 3;
        nor[o] = n1.x * cx + n2.x * cy; nor[o + 1] = n1.y * cx + n2.y * cy; nor[o + 2] = n1.z * cx + n2.z * cy;
        pos[o] = a.x + nor[o] * rad; pos[o + 1] = a.y + nor[o + 1] * rad; pos[o + 2] = a.z + nor[o + 2] * rad;
      }
    }
    st.geometry.attributes.position.needsUpdate = true;
    st.geometry.attributes.normal.needsUpdate = true;
    st.visible = true;
    // 皿へ：最初のしずくを押し、流れの筋を作り、たまる
    const vol = rate * dt;
    d.addWater(TR.lx, TR.lz, vol * 0.65);
    d.ripple(TR.lx, TR.lz, 0.05 * rate);
    TL.beadT = (TL.beadT || 0) + dt;
    if (TL.beadT > 0.07) {
      TL.beadT = 0;
      TL.beads.push({ d, x: TR.lx + G.rr(-0.15, 0.15), z: TR.lz + G.rr(-0.15, 0.15), y: TR.ly, vx: 0, vz: 0, vol: vol * 0.35 / Math.max(dt, 1e-3) * 0.07, t: 0 });
    }
    for (const dr of TL.drops) {
      if (dr.state === 'sit' && dr.d === d && M.dist2(dr.lx, dr.lz, TR.lx, TR.lz) < 2.2) dr.push = true;
    }
  }

  // ---- しずく（最初のひとしずく・糸を伝うしずく） ----
  function spawnDrop(pos, d, first) {
    TL.drops.push({ state: 'fall', x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: -10, vz: 0, d, t: 0, r: first ? 0.24 : 0.16, first });
  }
  TL.spawnDrop = spawnDrop;

  function updateDrops(dt) {
    for (let i = TL.drops.length - 1; i >= 0; i--) {
      const dr = TL.drops[i];
      dr.t += dt;
      if (dr.state === 'fall') {
        dr.vy -= 980 * dt; dr.x += dr.vx * dt; dr.y += dr.vy * dt; dr.z += dr.vz * dt;
        const d = dr.d || G.dish.dishAt(dr.x, dr.z, 0);
        if (d) {
          d.toLocal(dr.x, dr.y, dr.z, tmp);
          const r = Math.sqrt(tmp.x * tmp.x + tmp.z * tmp.z);
          if (r < L.PLATE.Rin) {
            const s = d.surf(tmp.x, tmp.z), w = d.waterAt(tmp.x, tmp.z);
            if (tmp.y <= s + w + dr.r * 0.6) {
              dr.d = d; dr.lx = tmp.x; dr.lz = tmp.z;
              if (w > 0.05) { merge(dr, 0.25); TL.drops.splice(i, 1); continue; }
              dr.state = 'sit'; dr.t = 0; dr.ly = s;
              if (G.audio) G.audio.drip(G.audio.panOf(new THREE.Vector3(dr.x, dr.y, dr.z)), 0.6, 0.85);
              continue;
            }
          }
        }
        if (dr.y < G.dish.floorAt(dr.x, dr.z)) { TL.drops.splice(i, 1); }
      } else if (dr.state === 'sit') {
        // 糸の背に丸くのる。流れに押されたら谷へ滑る
        if (dr.push || dr.t > (dr.first ? 2.4 : 0.8)) { dr.state = 'slide'; dr.t = 0; }
      } else if (dr.state === 'slide') {
        const d = dr.d;
        const gr = d.grad(dr.lx, dr.lz);
        const sl = Math.sqrt(gr[0] * gr[0] + gr[1] * gr[1]);
        dr.vx = M.lerp(dr.vx || 0, -gr[0] * 14, M.damp(6, dt)); dr.vz = M.lerp(dr.vz || 0, -gr[1] * 14, M.damp(6, dt));
        dr.lx += dr.vx * dt; dr.lz += dr.vz * dt;
        dr.ly = d.surf(dr.lx, dr.lz);
        const w = d.waterAt(dr.lx, dr.lz);
        if (w > 0.04 || (sl < 0.06 && dr.t > 0.3) || dr.t > 2.5) { merge(dr, 0.3); TL.drops.splice(i, 1); }
      }
    }
    // 流れの筋：着いた所から低い方へ走って、たまりに合流する
    for (let i = TL.beads.length - 1; i >= 0; i--) {
      const b = TL.beads[i];
      b.t += dt;
      const d = b.d;
      const gr = d.grad(b.x, b.z);
      b.vx = M.lerp(b.vx, -gr[0] * 22 + G.rr(-1.5, 1.5), M.damp(9, dt));
      b.vz = M.lerp(b.vz, -gr[1] * 22 + G.rr(-1.5, 1.5), M.damp(9, dt));
      b.x += b.vx * dt; b.z += b.vz * dt;
      const r = Math.sqrt(b.x * b.x + b.z * b.z);
      if (r > L.PLATE.Rin - 0.3) { b.x *= (L.PLATE.Rin - 0.3) / r; b.z *= (L.PLATE.Rin - 0.3) / r; }
      b.y = d.surf(b.x, b.z);
      const w = d.waterAt(b.x, b.z);
      if (w > 0.06 || b.t > 1.4 || (Math.abs(b.vx) + Math.abs(b.vz) < 0.4 && b.t > 0.2)) {
        d.addWater(b.x, b.z, b.vol);
        TL.beads.splice(i, 1);
      }
    }
    // 描画
    const im = TL.dropMesh;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0;
    for (const dr of TL.drops) {
      if (n >= 90) break;
      if (dr.state === 'fall') { v.set(dr.x, dr.y, dr.z); sc.set(dr.r * 0.85, dr.r * 1.25, dr.r * 0.85); }
      else { dr.d.toWorld(dr.lx, dr.ly + dr.r * 0.55, dr.lz, v); const wob = 1 + Math.sin(G.time * 18 + dr.t * 3) * 0.05; sc.set(dr.r * wob, dr.r * 0.62, dr.r / wob); }
      q.identity(); m.compose(v, q, sc); im.setMatrixAt(n++, m);
    }
    for (const b of TL.beads) {
      if (n >= 90) break;
      b.d.toWorld(b.x, b.y + 0.05, b.z, v);
      const sp = Math.min(1, (Math.abs(b.vx) + Math.abs(b.vz)) / 10);
      q.setFromAxisAngle(tmp.set(0, 1, 0), Math.atan2(-b.vz, b.vx) + b.d.rotY);
      sc.set(0.12 + sp * 0.12, 0.07, 0.1);
      m.compose(v, q, sc); im.setMatrixAt(n++, m);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  }
  function merge(dr, vol) {
    const d = dr.d;
    if (!d) return;
    d.addWater(dr.lx, dr.lz, vol);
    d.ripple(dr.lx, dr.lz, 0.3);
  }

  // ---- さじ ----
  TL.grabSpoon = function () { const s = G.kit.spoon; s.state = 'held'; };
  TL.releaseSpoon = function () { const s = G.kit.spoon; s.state = 'returning'; };
  TL.moveSpoon = function (x, z) { const s = G.kit.spoon; s.target.set(x, L.TRAY.floorY + 7.2, z); };

  function updateSpoon(dt) {
    const s = G.kit.spoon;
    const hold = s.state === 'held';
    if (s.state === 'returning') {
      s.target.copy(s.rest);
      if (s.pos.distanceTo(s.rest) < 0.05 && s.tilt < 0.02) {
        s.state = 'rest'; s.pos.copy(s.rest);
        if (G.audio) G.audio.wood(G.audio.panOf(s.pos), 0.25, 1.3);
      }
    }
    if (s.state === 'rest') {
      s.target.copy(s.rest);
      if (s.seeds.length < 12) fillSpoon(s, 22, false);
    }
    const prev = tmp2.copy(s.pos);
    s.pos.lerp(s.target, M.damp(hold ? 14 : 8, dt));
    s.vel.subVectors(s.pos, prev).multiplyScalar(1 / Math.max(dt, 1e-4));
    const d = hold ? nearDish(s.pos.x, s.pos.z, 14) : null;
    let tiltT = 0, yawT = s.state === 'rest' ? s.restYaw : s.yaw;
    if (d) {
      const dx = d.cx - s.pos.x, dz = d.cz - s.pos.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      // 先（-Z）を皿の中心へ向ける
      if (dd > 0.5) yawT = Math.atan2(-dx, -dz);
      if (dd < L.PLATE.Rin - 0.3) tiltT = 1.05;
    }
    s.yaw = M.angLerp(s.yaw, yawT, M.damp(5, dt));
    s.tilt = M.lerp(s.tilt, tiltT, M.damp(tiltT > s.tilt ? 1.3 : 5, dt));
    s.group.position.copy(s.pos);
    s.group.rotation.set(0, s.yaw, 0);
    s.body.rotation.set(-s.tilt * 0.75, 0, 0);
    s.group.updateMatrixWorld(true);
    // 傾いた分だけ先の粒から転がり出る
    for (let i = s.seeds.length - 1; i >= 0; i--) {
      const sd = s.seeds[i];
      if (s.tilt > sd.thr) {
        const w = s.body.localToWorld(tmp.set(sd.x, sd.y + 0.05, sd.z - 0.2));
        const tipDir = tmp2.set(0, 0, -1).applyQuaternion(s.body.getWorldQuaternion(tmpQ));
        G.dish.dropSeed(w.x, w.y, w.z, s.vel.x * 0.4 + tipDir.x * 6 + G.rr(-2, 2), -2 + tipDir.y * 4, s.vel.z * 0.4 + tipDir.z * 6 + G.rr(-2, 2));
        s.seeds.splice(i, 1);
        s.poured = (s.poured || 0) + 1;
        if (G.audio && G.rand() < 0.5) G.audio.tick(G.audio.panOf(w), 0.35);
        break; // 1フレームに一粒ずつ
      }
    }
    updateSpoonSeeds(s, dt);
  }

  TL.update = function (dt) {
    updatePitcher(dt);
    updateSpoon(dt);
    updateDrops(dt);
  };
})();
