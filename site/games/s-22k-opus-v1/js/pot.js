/* pot.js — boiling pot (water surface, bubbles, steam), the strainer net and its
   states, carrying noodles from the board, and pouring them into the bowl. */
(function () {
  'use strict';
  const U = window.U;
  const P = (U.pot = {});
  const L = U.L, PT = L.pot, NL = L.net;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4();
  const arr3 = [0, 0, 0], arrQ = [0, 0, 0], nrm = [0, 0, 0];

  P.ripples = [];
  P.st = { net: 'home', everPot: false, wet: 0, dripT: 0, dripN: 0, pourQ: [], active: null, feedDelay: 0, released: false, fromPot: false };

  P.init = function (scene) {
    const kit = U.kit;
    const g = (P.g = kit.buildPot());
    g.position.set(PT.x, 0, PT.z);
    scene.add(g);
    P.water = g.userData.water;
    const wp = P.water.geometry.attributes.position;
    P.wBase = wp.array.slice();
    // bubbles
    P.bub = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({
      color: 0xf2f7f7, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false,
    }), 70);
    P.bub.count = 0;
    P.bub.frustumCulled = false;
    g.add(P.bub);
    P.bubbles = [];
    buildSteam();
    // net
    P.net = kit.buildNet();
    P.netHome();
    scene.add(P.net);
    P.netVel = new THREE.Vector3();
    P.netLast = P.net.position.clone();
    defineContainers();
    setupPicks();
    U.core.addUpdate(P.update, 15);
  };

  // ---------------- steam (soft points with per-point alpha) ----------------
  function buildSteam() {
    const n = 46;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: U.softSprite() }, scale: { value: 300 }, fade: { value: 1 } },
      vertexShader: 'attribute float alpha; attribute float size; varying float vA; uniform float scale;\n' +
        'void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; uniform float fade; varying float vA;\n' +
        'void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(0.97), c.a * vA * fade); }',
      transparent: true, depthWrite: false,
    });
    P.steam = new THREE.Points(geo, mat);
    P.steam.frustumCulled = false;
    P.steam.renderOrder = 5;
    P.g.add(P.steam);
    P.steamP = [];
    for (let i = 0; i < n; i++) P.steamP.push({ t: Math.random() * 3, life: 2.5 + Math.random() * 1.5, x: 0, y: 0, z: 0, vx: 0, vz: 0 });
  }
  function updateSteam(dt) {
    const pa = P.steam.geometry.attributes.position.array, aa = P.steam.geometry.attributes.alpha.array, sa = P.steam.geometry.attributes.size.array;
    P.steamP.forEach((s, i) => {
      s.t += dt;
      if (s.t > s.life) {
        s.t = 0;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (PT.R - 0.15);
        s.x = Math.cos(a) * r; s.z = Math.sin(a) * r; s.y = PT.waterY + 0.03;
        s.vx = U.rand(-0.05, 0.05); s.vz = U.rand(-0.05, 0.05);
      }
      const k = s.t / s.life;
      s.x += (s.vx + Math.sin(U.core.time * 0.7 + i) * 0.03) * dt;
      s.z += s.vz * dt;
      s.y += (0.32 + k * 0.2) * dt;
      pa[i * 3] = s.x; pa[i * 3 + 1] = s.y; pa[i * 3 + 2] = s.z;
      aa[i] = Math.sin(k * Math.PI) * 0.32;
      sa[i] = 0.25 + k * 0.55;
    });
    P.steam.geometry.attributes.position.needsUpdate = true;
    P.steam.geometry.attributes.alpha.needsUpdate = true;
    P.steam.geometry.attributes.size.needsUpdate = true;
    P.steam.material.uniforms.scale.value = U.core.H * 0.9;
    // keep steam light when looking closely
    const want = U.cam.name === 'pot' ? 0.45 : 1;
    P.steam.material.uniforms.fade.value = U.damp(P.steam.material.uniforms.fade.value, want, 2, dt);
  }

  // ---------------- water surface ----------------
  P.addRipple = function (lx, lz, amp) {
    P.ripples.push({ x: lx, z: lz, t: 0, a: amp });
    if (P.ripples.length > 14) P.ripples.shift();
  };
  function updateWater(dt) {
    const pos = P.water.geometry.attributes.position;
    const a = pos.array, b = P.wBase;
    const T = U.core.time;
    for (const r of P.ripples) r.t += dt;
    for (let i = P.ripples.length - 1; i >= 0; i--) if (P.ripples[i].t > 2.5) P.ripples.splice(i, 1);
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3], z = b[i * 3 + 2];
      let y = Math.sin(x * 9 + T * 2.1) * 0.003 + Math.sin(z * 11 - T * 1.7) * 0.003;
      // simmer bumps on the bubbling side
      y += Math.max(0, x) * 0.006 * Math.sin(x * 23 + z * 17 + T * 6);
      for (const r of P.ripples) {
        const d = Math.hypot(x - r.x, z - r.z);
        const ph = d - r.t * 0.9;
        if (ph > -0.25 && ph < 0.05) y += r.a * Math.exp(-r.t * 1.6) * Math.sin(ph * 40) * (1 - Math.abs(ph + 0.1) * 4);
      }
      a[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
    P.water.geometry.computeVertexNormals();
  }
  function updateBubbles(dt) {
    if (Math.random() < dt * 22 && P.bubbles.length < 70) {
      const a = U.rand(-0.9, 0.9), r = U.rand(0.1, PT.R - 0.12);
      P.bubbles.push({ x: Math.cos(a) * r * 0.9 + 0.12, z: Math.sin(a) * r, y: PT.bottom + 0.05, s: U.rand(0.008, 0.016), v: U.rand(0.5, 0.9), ph: Math.random() * 6 });
    }
    const m = _m;
    let k = 0;
    for (let i = P.bubbles.length - 1; i >= 0; i--) {
      const bb = P.bubbles[i];
      bb.y += bb.v * dt;
      bb.s += dt * 0.01;
      bb.ph += dt * 9;
      if (bb.y >= PT.waterY - 0.005) {
        if (Math.random() < 0.35) P.addRipple(bb.x, bb.z, 0.006);
        P.bubbles.splice(i, 1);
        continue;
      }
    }
    for (const bb of P.bubbles) {
      m.makeScale(bb.s, bb.s, bb.s);
      m.setPosition(bb.x + Math.sin(bb.ph) * 0.01, bb.y, bb.z + Math.cos(bb.ph) * 0.01);
      P.bub.setMatrixAt(k++, m);
    }
    P.bub.count = k;
    P.bub.instanceMatrix.needsUpdate = true;
  }

  // ---------------- net poses ----------------
  P.netHome = function () {
    P.net.position.copy(HOME);
    P.net.rotation.set(0, HOME_YAW, HOME_TILT);
    P.st.net = 'home';
  };
  const HOME = new THREE.Vector3(L.net.x, 0.17, L.net.z);
  const HOME_TILT = -0.42;
  const HOME_YAW = Math.PI + 0.25; // handle toward the kneading bowl side
  // the net hangs on the rim on the side facing the serving bowl, so lifting it
  // out toward the bowl is a drag outward
  const hangAz = Math.atan2(L.serve.x - PT.x, L.serve.z - PT.z);
  function hangPose(out) {
    const r = PT.R - NL.a - 0.05;
    out.pos = new THREE.Vector3(PT.x + Math.sin(hangAz) * r, PT.waterY + 0.17, PT.z + Math.cos(hangAz) * r);
    out.yaw = Math.atan2(-Math.cos(hangAz), Math.sin(hangAz));
    return out;
  }
  // yaw so the handle (+x local) points outward from the pot centre
  function yawOutward(x, z) {
    const dx = x - PT.x, dz = z - PT.z;
    return Math.atan2(-dz, dx);
  }
  // tilt the basket so the handle rises toward the rim
  function dunkTilt() {
    const net = P.net;
    const rn = Math.hypot(net.position.x - PT.x, net.position.z - PT.z);
    const xc = Math.max(0.2, PT.R - rn);
    const need = (PT.bottom + PT.H + 0.03 - net.position.y) / xc;
    return 0 * need;
  }
  function netInPot() {
    return P.st.net === 'hang' || P.st.net === 'dunk' || P.st.net === 'rising' || P.st.net === 'hold';
  }
  P.netInPot = netInPot;

  // ---------------- containers & zones ----------------
  const potToNet = new THREE.Matrix4(), netToPot = new THREE.Matrix4();
  function defineContainers() {
    const N = U.noodles;
    P.netC = N.defineContainer({
      name: 'net',
      obj: P.net,
      friction: 0.75,
      damp: 0.985,
      collide(nd, i) {
        const i3 = i * 3;
        arr3[0] = nd.pos[i3]; arr3[1] = nd.pos[i3 + 1]; arr3[2] = nd.pos[i3 + 2];
        arrQ[0] = nd.prev[i3]; arrQ[1] = nd.prev[i3 + 1]; arrQ[2] = nd.prev[i3 + 2];
        let c = N.basketCollide(arr3, arrQ, nd.t[i] * 0.5 + 0.004, nrm);
        if (c) {
          nd.pos[i3] = arr3[0]; nd.pos[i3 + 1] = arr3[1]; nd.pos[i3 + 2] = arr3[2];
          nd.cn[i3] = nrm[0]; nd.cn[i3 + 1] = nrm[1]; nd.cn[i3 + 2] = nrm[2];
        }
        // the table under the net, in the net's (possibly tipped) frame
        const e = P.net.matrixWorld.elements;
        const yw = e[1] * nd.pos[i3] + e[5] * nd.pos[i3 + 1] + e[9] * nd.pos[i3 + 2] + e[13];
        const fl = nd.t[i] * 0.5;
        if (yw < fl) {
          const ux = e[1], uy = e[5], uz = e[9];
          const k = fl - yw;
          nd.pos[i3] += ux * k; nd.pos[i3 + 1] += uy * k; nd.pos[i3 + 2] += uz * k;
          nd.cn[i3] = ux; nd.cn[i3 + 1] = uy; nd.cn[i3 + 2] = uz;
          c = 1;
        }
        return c;
      },
      onEnter(nd) { nd.meta.netT = 0; },
      onStep(nd, mv, hh) {
        // a noodle laid over the basket slides in as it settles
        nd.meta.netT = (nd.meta.netT || 0) + hh;
        if (nd.meta.netT > 1.2) return;
        const k = 0.03 * (1 - nd.meta.netT / 1.2);
        for (let i = 0; i < nd.n; i++) {
          if (nd.pin[i] || i === nd.grab) continue;
          const x = nd.pos[i * 3], z = nd.pos[i * 3 + 2];
          const r = Math.hypot(x, z);
          if (r > NL.a * 0.7) {
            nd.pos[i * 3] -= (x / r) * k * (r - NL.a * 0.7);
            nd.pos[i * 3 + 2] -= (z / r) * k * (r - NL.a * 0.7);
          }
        }
      },
    });
    P.potC = N.defineContainer({
      name: 'pot',
      obj: P.g,
      friction: 0.3,
      damp: 0.99,
      canSleep: false,
      collide(nd, i) {
        const i3 = i * 3;
        const r = nd.t[i] * 0.5 + 0.004;
        let c = false;
        let x = nd.pos[i3], y = nd.pos[i3 + 1], z = nd.pos[i3 + 2];
        if (y < PT.bottom + 0.035 + r) {
          y = PT.bottom + 0.035 + r;
          nd.cn[i3] = 0; nd.cn[i3 + 1] = 1; nd.cn[i3 + 2] = 0;
          c = true;
        }
        const rr = Math.hypot(x, z), lim = PT.R - r - 0.01;
        if (rr > lim && y < PT.bottom + PT.H) {
          x *= lim / rr; z *= lim / rr;
          nd.cn[i3] = -x / lim; nd.cn[i3 + 1] = 0; nd.cn[i3 + 2] = -z / lim;
          c = true;
        }
        nd.pos[i3] = x; nd.pos[i3 + 1] = y; nd.pos[i3 + 2] = z;
        if (netInPot()) {
          _v.set(x, y, z).applyMatrix4(potToNet);
          _v2.set(nd.prev[i3], nd.prev[i3 + 1], nd.prev[i3 + 2]).applyMatrix4(potToNet);
          arr3[0] = _v.x; arr3[1] = _v.y; arr3[2] = _v.z;
          arrQ[0] = _v2.x; arrQ[1] = _v2.y; arrQ[2] = _v2.z;
          if (N.basketCollide(arr3, arrQ, r, nrm)) {
            _v.set(arr3[0], arr3[1], arr3[2]).applyMatrix4(netToPot);
            nd.pos[i3] = _v.x; nd.pos[i3 + 1] = _v.y; nd.pos[i3 + 2] = _v.z;
            _v3.set(nrm[0], nrm[1], nrm[2]).transformDirection(netToPot);
            nd.cn[i3] = _v3.x; nd.cn[i3 + 1] = _v3.y; nd.cn[i3 + 2] = _v3.z;
            c = true;
          }
        }
        return c;
      },
      onStep(nd, mv, hh) {
        if (!(nd.meta.scoop > 0)) return;
        nd.meta.scoop -= hh;
        // pull the scooped noodle over the basket while the net comes up
        const c = P.g.worldToLocal(_v2.copy(P.net.position));
        for (let i = 0; i < nd.n; i++) {
          const i3 = i * 3;
          const dx = c.x - nd.pos[i3], dz = c.z - nd.pos[i3 + 2];
          const d = Math.hypot(dx, dz);
          if (d > NL.a * 0.55) {
            const k = Math.min(0.12, (d - NL.a * 0.55) * 0.5);
            nd.pos[i3] += (dx / d) * k;
            nd.pos[i3 + 2] += (dz / d) * k;
          }
          if (nd.pos[i3 + 1] < c.y + 0.02 && d > NL.a * 0.8) nd.pos[i3 + 1] += 0.01;
        }
      },
      medium(nd, i, M) {
        const i3 = i * 3;
        const x = nd.pos[i3], y = nd.pos[i3 + 1], z = nd.pos[i3 + 2];
        if (y > PT.waterY) return;
        M.water = 1;
        M.drag = 0.1;
        M.hot = 0.2;
        const r = Math.hypot(x, z) || 1e-4;
        const sw = (P.st.net === 'dunk' ? 0.12 : 0.26) * U.clamp(r / PT.R, 0, 1) + 0.03;
        let fx = (-z / r) * sw, fz = (x / r) * sw;
        // rising water on the bubbling side, spreading out at the top
        const sx = x - 0.3, sz = z;
        const ds = sx * sx + sz * sz;
        let fy = 0.28 * Math.exp(-ds / 0.12) - 0.05;
        const depth = PT.waterY - y;
        fy += (depth - 0.06) * 3.0;
        if (depth < 0.15) { fx += (sx / Math.sqrt(ds + 0.01)) * 0.08; fz += (sz / Math.sqrt(ds + 0.01)) * 0.08; }
        // wake of the moving net
        if (P.st.net === 'dunk') {
          _v.set(x, y, z).add(P.g.position);
          const d = _v.distanceTo(P.net.position);
          if (d < 1.1) {
            const k = Math.max(0, 1 - d / 0.6) * 0.7;
            fx += P.netVel.x * k; fy += P.netVel.y * k * 0.5; fz += P.netVel.z * k;
            const sp = Math.hypot(P.netVel.x, P.netVel.z);
            // a slow net gathers the water (and floating noodles) over itself
            const hx = P.net.position.x - _v.x, hz = P.net.position.z - _v.z, hd = Math.hypot(hx, hz) || 1;
            const reach = NL.a + 0.65;
            if (sp < 1.3 && hd < reach && hd > NL.a * 0.25) {
              const g = 1.3 * (1 - hd / reach) * (1 - sp / 1.3) + 0.15;
              fx += (hx / hd) * g;
              fz += (hz / hd) * g;
            }
            if (sp > 1.4) {
              // quick sweeps push floating noodles away
              const ox = _v.x - P.net.position.x, oz = _v.z - P.net.position.z, ol = Math.hypot(ox, oz) || 1;
              fx += (ox / ol) * (sp - 1.4) * 1.2;
              fz += (oz / ol) * (sp - 1.4) * 1.2;
            }
          }
        }
        M.fx = fx; M.fy = fy; M.fz = fz;
        M.gs = 0.004;
      },
    });
    // zones: dropping noodles into the net or the pot
    N.zones.push({
      enabled: () => !netInPot() && P.st.net !== 'pour',
      container: () => P.netC,
      contains(w, nd) {
        // enough of the noodle has come down over the basket
        P.net.updateMatrixWorld();
        let k = 0;
        for (let i = 0; i < nd.n; i++) {
          const l = P.net.worldToLocal(nd.worldPoint(i, _v3));
          if (Math.hypot(l.x, l.z) < NL.a * 1.05 && l.y > -NL.d - 0.05 && l.y < 0.45) k++;
        }
        return k >= Math.max(2, nd.n * 0.22);
      },
      onCapture() { U.audio.play('soft', 0.35); },
    });
    N.zones.push({
      container: () => P.potC,
      contains(w) {
        return Math.hypot(w.x - PT.x, w.z - PT.z) < PT.R - 0.05 && w.y < PT.bottom + PT.H + 0.6;
      },
      onCapture(nd) { onEnterWater(nd, 0); },
    });
  }

  function onEnterWater(nd, order) {
    nd.shield = order * 0.55;
    const c = nd.centroidWorld(_v);
    const l = P.g.worldToLocal(c.clone());
    P.addRipple(l.x, l.z, 0.02);
  }

  // ---------------- carrying noodles from the board ----------------
  let carry = null;
  function grabNoodle(nd, e) {
    if (nd.container !== U.noodles.world) nd.setContainer(U.noodles.world);
    // choose the particle under the finger
    let best = 0, bd = Infinity;
    for (let i = 0; i < nd.n; i++) {
      nd.worldPoint(i, _v);
      const d = e.ray.distanceToPoint(_v);
      if (d < bd) { bd = d; best = i; }
    }
    nd.grab = best;
    nd.wake();
    const p0 = nd.worldPoint(best, new THREE.Vector3());
    nd.grabT.copy(p0);
    // lifted high enough that the noodle hangs free from the fingertip
    carry = { nd, h: U.clamp(U.sheet.TOP + 0.3 + nd.length * 0.55, U.sheet.TOP + 0.45, 1.6), drop: null };
    U.audio.play('squish', 0.3, 0.7);
    return true;
  }
  function moveNoodle(e) {
    if (!carry || carry.drop) return;
    const p = U.core.planeY(e.ray, carry.h, _v);
    if (!p) return;
    carry.nd.grabT.copy(p);
    carry.nd.wake();
  }
  // where is the child dropping it? (net, pot or bowl under the finger)
  function dropTarget(ray) {
    const C = U.core;
    if (!netInPot() && P.st.net !== 'pour') {
      const c = P.net.getWorldPosition(new THREE.Vector3());
      if (ray.distanceToPoint(c) < NL.a + 0.15) return { c: P.netC, to: c.clone() };
    }
    const pp = C.planeY(ray, PT.bottom + PT.H, new THREE.Vector3());
    if (pp && Math.hypot(pp.x - PT.x, pp.z - PT.z) < PT.R + 0.05) {
      const d = Math.hypot(pp.x - PT.x, pp.z - PT.z), lim = PT.R - 0.3;
      if (d > lim) { pp.x = PT.x + ((pp.x - PT.x) / d) * lim; pp.z = PT.z + ((pp.z - PT.z) / d) * lim; }
      return { c: P.potC, to: pp, water: true };
    }
    const bp = C.planeY(ray, L.sb.b + L.sb.D, new THREE.Vector3());
    const sv = U.serve.cur;
    if (bp && sv && Math.hypot(bp.x - sv.g.position.x, bp.z - sv.g.position.z) < L.sb.Ri + 0.05) {
      return { c: sv.container, to: bp };
    }
    return null;
  }
  function dropNoodle(e) {
    if (!carry) return;
    const tg = e && e.ray ? dropTarget(e.ray) : null;
    const nd = carry.nd;
    if (tg) {
      tg.to.y = nd.grabT.y;
      carry.drop = { t: 0, from: nd.grabT.clone(), tg };
      return;
    }
    nd.grab = -1;
    nd.wake();
    carry = null;
  }
  function updateDrop(dt) {
    if (!carry || !carry.drop) return;
    const d = carry.drop, nd = carry.nd;
    d.t += dt;
    const k = U.easeInOut(Math.min(1, d.t / 0.16));
    nd.grabT.lerpVectors(d.from, d.tg.to, k);
    nd.wake();
    if (d.t >= 0.16) {
      nd.grab = -1;
      nd.setContainer(d.tg.c);
      if (d.tg.water) onEnterWater(nd, 0);
      else U.audio.play('soft', 0.35);
      carry = null;
    }
  }
  P.carrying = () => carry;
  P.grabNoodle = grabNoodle;

  // ---------------- picks ----------------
  function setupPicks() {
    const C = U.core;
    U.sheet.grabNoodle = grabNoodle;
    U.sheet.moveNoodle = moveNoodle;
    U.sheet.dropNoodle = dropNoodle;
    // noodles lying on the board / table / in the net
    C.addPick({
      priority: 5,
      hit(ray) {
        const r = U.noodles.pick(ray, (nd) => nd.container === U.noodles.world);
        return r ? { dist: r.dist, point: r.point, obj: r } : null;
      },
      down(e) {
        const r = e.obj;
        if (!r) return false;
        if (r.nd.container === P.netC) r.nd.setContainer(U.noodles.world);
        return grabNoodle(r.nd, e);
      },
      move: moveNoodle,
      up: dropNoodle,
    });
    // the net
    P.netPick = C.addPick({
      target: P.net,
      priority: 4,
      enabled: () => ['home', 'hang', 'returning'].includes(P.st.net) || (P.st.net === 'pour' && P.st.released),
      down(e) {
        const st = P.st;
        st.released = false;
        st.finger = null;
        if (st.net === 'pour') {
          return true;
        }
        if (st.net === 'hang') {
          // held up first: moving inward (or waiting) sinks it, moving out lifts it out
          st.net = 'hold';
          st.holdT = 0;
          st.holdR0 = Math.hypot(P.net.position.x - PT.x, P.net.position.z - PT.z);
          U.audio.play('clink', 0.25, 0.9);
        } else {
          st.net = 'carry';
          st.fromPot = false;
          U.audio.play('clink', 0.3, 0.8);
        }
        st.netGrab = e.point ? e.point.clone().sub(P.net.position) : new THREE.Vector3();
        st.netGrab.y = 0;
        return true;
      },
      move(e) {
        P.st.finger = { ray: e.ray };
      },
      up() {
        const st = P.st;
        st.finger = null;
        if (st.net === 'dunk' || st.net === 'hold') {
          riseToHang();
        } else if (st.net === 'carry') {
          if (Math.hypot(P.net.position.x - PT.x, P.net.position.z - PT.z) < PT.R) riseToHang();
          else goHome();
        } else if (st.net === 'pour') {
          st.released = true;
        }
      },
    });
  }

  function riseToHang() {
    const st = P.st;
    // noodles floating mostly over the net are drawn in as the water drains through
    P.net.updateMatrixWorld(true);
    for (const nd of U.noodles.inContainer('pot')) {
      let k = 0;
      for (let i = 0; i < nd.n; i++) {
        const l = P.net.worldToLocal(nd.worldPoint(i, _v));
        if (Math.hypot(l.x, l.z) < NL.a + 0.3 && l.y > -0.06 && l.y < 0.3) k++;
      }
      nd.meta.scoop = k >= nd.n * 0.25 ? 0.6 : 0;
    }
    st.net = 'rising';
    const from = P.net.position.clone();
    const hp = hangPose({});
    const q0 = P.net.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hp.yaw, 0));
    const mid = from.clone();
    mid.y = hp.pos.y + 0.05;
    // straight up first (lifting what floats above it), then over to the rim
    U.tween(0.4, (t) => {
      P.net.position.lerpVectors(from, mid, U.easeOut(t));
    }, () => {
      U.tween(0.45, (t) => {
        const e = U.easeInOut(t);
        P.net.position.lerpVectors(mid, hp.pos, e);
        P.net.quaternion.slerpQuaternions(q0, q1, e);
      }, () => {
        st.net = 'hang';
        U.audio.play('clink', 0.3, 0.9);
      });
    });
  }
  function goHome() {
    const st = P.st;
    st.net = 'returning';
    const from = P.net.position.clone();
    const q0 = P.net.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, HOME_YAW, HOME_TILT));
    U.tween(0.7, (t) => {
      const e = U.easeInOut(t);
      P.net.position.lerpVectors(from, HOME, e);
      P.net.position.y += Math.sin(e * Math.PI) * 0.3;
      P.net.quaternion.slerpQuaternions(q0, q1, e);
    }, () => {
      st.net = 'home';
      U.audio.play('clink', 0.25, 0.85);
    });
  }
  P.goHome = goHome;

  // move noodles caught in the basket from the pot to the net
  function catchInBasket() {
    P.net.updateMatrixWorld(true);
    const list = U.noodles.inContainer('pot');
    let caught = 0;
    for (const nd of list) {
      let inside = 0;
      for (let i = 0; i < nd.n; i++) {
        nd.worldPoint(i, _v);
        P.net.worldToLocal(_v);
        if (U.noodles.inBasket(_v.x, _v.y, _v.z) || (Math.hypot(_v.x, _v.z) < NL.a && _v.y > -NL.d && _v.y < 0.12)) inside++;
      }
      if (inside >= nd.n * 0.35) {
        nd.setContainer(P.netC);
        caught++;
      }
    }
    return caught;
  }
  function releaseIntoWater() {
    const list = U.noodles.inContainer('net').slice();
    list.sort((a, b) => b.centroidLocal(_v).y - a.centroidLocal(_v2).y);
    list.forEach((nd, k) => {
      nd.setContainer(P.potC);
      onEnterWater(nd, k);
    });
    return list.length;
  }

  // ---------------- pouring into the bowl ----------------
  function startPour() {
    const st = P.st;
    st.pourQ = U.noodles.inContainer('net').slice().sort((a, b) => b.centroidLocal(_v).y - a.centroidLocal(_v2).y);
    st.active = null;
    st.feedDelay = 0;
  }
  // a point along a spiral inside the basket, s = distance back from the lip (net-local)
  function chainPoint(s, out) {
    const r = Math.max(0.06, NL.a * 0.88 - s * 0.05);
    const ang = Math.PI + s / Math.max(0.12, r) * 0.9;
    out.set(Math.cos(ang) * r, L.netY(r) + 0.03, Math.sin(ang) * r);
    return out;
  }
  function feed(dt) {
    const st = P.st;
    const bowlC = U.serve.container();
    if (!st.active) {
      st.feedDelay -= dt;
      if (st.feedDelay > 0 || !st.pourQ.length) return;
      const nd = st.pourQ.shift();
      if (nd.container !== P.netC) return;
      // the end nearer the lip leaves first
      chainPoint(0, _v);
      const d0 = Math.hypot(nd.pos[0] - _v.x, nd.pos[2] - _v.z), d1 = Math.hypot(nd.pos[(nd.n - 1) * 3] - _v.x, nd.pos[(nd.n - 1) * 3 + 2] - _v.z);
      const order = [];
      for (let i = 0; i < nd.n; i++) order.push(d0 <= d1 ? i : nd.n - 1 - i);
      const start = [];
      for (let i = 0; i < nd.n; i++) start.push(nd.worldPoint(i, new THREE.Vector3()));
      nd.setContainer(bowlC);
      for (let i = 0; i < nd.n; i++) nd.pin[i] = 1;
      st.active = { nd, order, f: 0, t: 0, start };
      U.audio.play('swish', 0.3);
    }
    const a = st.active, nd = a.nd;
    a.t += dt;
    const sp = 1.1 + Math.min(1.5, Math.hypot(P.netVel.x, P.netVel.z) * 0.6);
    const fPrev = a.f;
    a.f = Math.min(nd.n, a.f + (sp * dt) / Math.max(0.01, nd.seg));
    const blend = U.clamp(a.t / 0.25, 0, 1);
    P.net.updateMatrixWorld(true);
    bowlC.obj.updateMatrixWorld(true);
    for (let k = 0; k < nd.n; k++) {
      const i = a.order[k];
      if (k < Math.floor(a.f)) {
        if (nd.pin[i]) {
          nd.pin[i] = 0;
          // keep the net's motion so the noodle lays out along the drag
          const i3 = i * 3;
          _v.copy(P.netVel).multiplyScalar(1 / 60 * 0.6);
          const qd = _q.setFromRotationMatrix(_m.extractRotation(bowlC.obj.matrixWorld)).invert();
          _v.applyQuaternion(qd);
          nd.prev[i3] = nd.pos[i3] - _v.x;
          nd.prev[i3 + 1] = nd.pos[i3 + 1] - _v.y + 0.004;
          nd.prev[i3 + 2] = nd.pos[i3 + 2] - _v.z;
        }
        continue;
      }
      const s = (k - a.f) * nd.seg;
      chainPoint(Math.max(0, s), _v);
      P.net.localToWorld(_v);
      if (blend < 1) _v.lerpVectors(a.start[i], _v, blend);
      bowlC.obj.worldToLocal(_v);
      nd.pinPos[i * 3] = _v.x; nd.pinPos[i * 3 + 1] = _v.y; nd.pinPos[i * 3 + 2] = _v.z;
      if (blend < 1 || k >= Math.floor(fPrev)) { nd.pos[i * 3] = _v.x; nd.pos[i * 3 + 1] = _v.y; nd.pos[i * 3 + 2] = _v.z; }
    }
    nd.wake();
    if (a.f >= nd.n) {
      for (let i = 0; i < nd.n; i++) nd.pin[i] = 0;
      st.active = null;
      st.feedDelay = 0.15;
      if (U.serve.onPoured) U.serve.onPoured(nd);
    }
  }
  const _q = new THREE.Quaternion();
  P.pouring = () => P.st.net === 'pour';

  // ---------------- per frame ----------------
  P.update = function (dt) {
    const st = P.st;
    const C = U.core;
    const net = P.net;
    updateDrop(dt);
    // compute net motion
    if (st.finger) {
      const ray = st.finger.ray;
      if (st.net === 'carry') {
        const p = C.planeY(ray, 1.25, _v);
        if (p) {
          const tx = p.x - st.netGrab.x * 0.5, tz = p.z - st.netGrab.z * 0.5;
          net.position.x = U.damp(net.position.x, tx, 14, dt);
          net.position.z = U.damp(net.position.z, tz, 14, dt);
          net.position.y = U.damp(net.position.y, 1.25, 10, dt);
          net.rotation.set(0, U.damp(net.rotation.y, st.fromPot ? -0.2 : 0.4, 6, dt), U.clamp(-P.netVel.x * 0.05, -0.2, 0.2));
          // where the finger points at the pot rim / bowl rim height
          const pPot = C.planeY(ray, PT.bottom + PT.H, _v2) || p;
          const potHit = Math.hypot(p.x - PT.x, p.z - PT.z) < PT.R * 0.85 || Math.hypot(pPot.x - PT.x, pPot.z - PT.z) < PT.R * 0.85;
          const pB = C.planeY(ray, L.sb.b + L.sb.D, _v3) || p;
          const bowlHit = U.serve.overBowl(p, 0.25) || U.serve.overBowl(pB, 0.2);
          // over the pot: hook onto the rim and dunk
          if (potHit && !st.fromPot) {
            st.net = 'dunk';
            st.everPot = true;
            if (U.game) U.game.area = 'pot';
            U.audio.play('clink', 0.4, 0.9);
          } else if (bowlHit && U.noodles.inContainer('net').length) {
            st.net = 'pour';
            st.released = false;
            startPour();
          }
          if (st.fromPot && Math.hypot(p.x - PT.x, p.z - PT.z) > PT.R + 0.6) st.fromPot = false;
        }
      } else if (st.net === 'hold') {
        const p = C.planeY(ray, PT.waterY + 0.17, _v);
        st.holdT += dt;
        if (p) {
          const dx = p.x - PT.x, dz = p.z - PT.z, d = Math.hypot(dx, dz);
          if (d > PT.R + 0.25) {
            catchInBasket();
            st.net = 'carry';
            st.fromPot = true;
            st.wet = 3;
            st.dripN = 0;
          } else if (d < st.holdR0 - 0.12 && P.netVel.length() < 1.3) {
            st.net = 'dunk';
            U.audio.play('swish', 0.4);
          } else {
            const lim = PT.R - NL.a - 0.03, k = d > lim ? lim / d : 1;
            net.position.x = U.damp(net.position.x, PT.x + dx * k, 10, dt);
            net.position.z = U.damp(net.position.z, PT.z + dz * k, 10, dt);
          }
        }
      } else if (st.net === 'dunk') {
        const p = C.planeY(ray, PT.waterY, _v);
        if (p) {
          const dx = p.x - PT.x, dz = p.z - PT.z, d = Math.hypot(dx, dz);
          if (d > PT.R + 0.4) {
            // lifting out of the pot
            catchInBasket();
            st.net = 'carry';
            st.fromPot = true;
            st.wet = 3;
            st.dripN = 0;
            U.audio.play('splash', U.clamp(P.netVel.length() * 0.3, 0.2, 0.8));
            const l = P.g.worldToLocal(net.position.clone());
            P.addRipple(l.x, l.z, 0.03);
            U.fx.splash(_v2.set(net.position.x, PT.waterY, net.position.z), 0.5, 'drop', PT.waterY);
          } else {
            const lim = PT.R - NL.a - 0.03;
            const k = d > lim ? lim / d : 1;
            const tx = PT.x + dx * k, tz = PT.z + dz * k;
            net.position.x = U.damp(net.position.x, tx, 10, dt);
            net.position.z = U.damp(net.position.z, tz, 10, dt);
            net.position.y = U.damp(net.position.y, PT.waterY - 0.17, 6, dt);
            net.rotation.set(0, yawOutward(net.position.x, net.position.z), dunkTilt());
          }
        }
      } else if (st.net === 'pour') {
        const p = C.planeY(ray, L.sb.b + L.sb.D + 0.55, _v);
        if (p) {
          net.position.x = U.damp(net.position.x, p.x, 12, dt);
          net.position.z = U.damp(net.position.z, p.z, 12, dt);
          net.position.y = U.damp(net.position.y, p.y, 8, dt);
          if (!U.serve.overBowl(p, 0.3) && !st.active) {
            st.net = 'carry';
          }
        }
      }
    } else if (st.net === 'hold') {
      st.holdT += dt;
      if (st.holdT > 0.45) { st.net = 'dunk'; U.audio.play('swish', 0.4); }
    } else if (st.net === 'dunk') {
      // finger still down but not moved yet: sink in place
      net.position.y = U.damp(net.position.y, PT.waterY - 0.17, 6, dt);
      net.rotation.set(0, yawOutward(net.position.x, net.position.z), dunkTilt());
    }
    if (st.net === 'dunk' && U.noodles.inContainer('net').length && net.position.y < PT.waterY - 0.04) releaseIntoWater();
    // pour: tilt and pay out noodles
    if (st.net === 'pour') {
      const tilt = 0.95;
      net.rotation.set(0, U.damp(net.rotation.y, 0, 5, dt), U.damp(net.rotation.z, tilt, 6, dt));
      if (net.rotation.z > 0.5) feed(dt);
      if (st.released && !st.active && !st.pourQ.length) {
        net.rotation.z = U.damp(net.rotation.z, 0, 6, dt);
        st.released = false;
        if (U.noodles.inContainer('pot').length) riseToHangFromAfar();
        else goHome();
      }
    }
    // velocity & splashes
    P.netVel.copy(net.position).sub(P.netLast).multiplyScalar(1 / Math.max(dt, 1e-3));
    const wasUnder = P.netLast.y < PT.waterY && Math.hypot(P.netLast.x - PT.x, P.netLast.z - PT.z) < PT.R;
    const isUnder = net.position.y < PT.waterY && Math.hypot(net.position.x - PT.x, net.position.z - PT.z) < PT.R;
    if (wasUnder !== isUnder) {
      const sp = U.clamp(P.netVel.length() * 0.35, 0.1, 1);
      U.audio.play('splash', sp);
      U.fx.splash(_v.set(net.position.x, PT.waterY, net.position.z), sp, 'drop', PT.waterY - 0.02);
      const l = P.g.worldToLocal(net.position.clone());
      P.addRipple(l.x, l.z, 0.012 + sp * 0.03);
      if (!isUnder) { st.wet = 3; st.dripN = 0; }
    } else if (isUnder && P.netVel.length() > 1.2 && Math.random() < 0.2) {
      const l = P.g.worldToLocal(net.position.clone());
      P.addRipple(l.x + U.rand(-0.2, 0.2), l.z + U.rand(-0.2, 0.2), 0.01);
    }
    P.netLast.copy(net.position);
    if (P.netVel.lengthSq() > 0.01) U.noodles.inContainer('net').forEach((nd) => nd.wake());
    // drips from a wet net
    if (st.wet > 0 && !isUnder) {
      st.wet -= dt;
      st.dripT -= dt;
      if (st.dripT <= 0) {
        st.dripT = 0.12 + (3 - st.wet) * 0.12;
        st.dripN++;
        const n = st.dripN;
        net.updateMatrixWorld(true);
        const bp = net.localToWorld(_v.set(U.rand(-0.1, 0.1), -NL.d, U.rand(-0.1, 0.1)));
        U.fx.spawn('drop', {
          p: bp, v: _v2.set(0, -0.2, 0), life: 3, size: 0.6, g: 20,
          floor: (x, z) => dripFloor(x, z),
          onLand: (p) => {
            if (Math.hypot(p.x - PT.x, p.z - PT.z) < PT.R) {
              const l = P.g.worldToLocal(p.clone());
              P.addRipple(l.x, l.z, 0.008);
              U.audio.play('drip', 0.35 + (n % 5) * 0.08, 0);
            } else if (U.serve.overBowl(p)) {
              U.serve.ripple(p, 0.01);
              U.audio.play('drip', 0.3 + (n % 4) * 0.1, 1);
            }
          },
        });
      }
    }
    // matrices for pot <-> net collision
    P.g.updateMatrixWorld();
    net.updateMatrixWorld();
    potToNet.copy(net.matrixWorld).invert().multiply(P.g.matrixWorld);
    netToPot.copy(potToNet).invert();
    updateWater(dt);
    updateBubbles(dt);
    updateSteam(dt);
    // cooking noodles in the pot: tiny ripples where they float
    const pn = U.noodles.inContainer('pot');
    U.audio.boilLevel = 1;
    if (pn.length && Math.random() < 0.04) {
      const nd = U.pick(pn);
      P.addRipple(nd.pos[0], nd.pos[2], 0.004);
    }
  };
  function dripFloor(x, z) {
    if (Math.hypot(x - PT.x, z - PT.z) < PT.R) return PT.waterY;
    if (U.serve.overBowl(_v3.set(x, 0, z))) return U.serve.soupYWorld();
    return 0;
  }
  function riseToHangFromAfar() {
    const st = P.st;
    st.net = 'rising';
    const from = P.net.position.clone();
    const hp = hangPose({});
    const q0 = P.net.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hp.yaw, 0));
    U.tween(0.8, (t) => {
      const e = U.easeInOut(t);
      P.net.position.lerpVectors(from, hp.pos, e);
      P.net.position.y += Math.sin(e * Math.PI) * 0.3;
      P.net.quaternion.slerpQuaternions(q0, q1, e);
    }, () => {
      st.net = 'hang';
    });
  }

  // camera wish from the pot side
  P.camWant = function () {
    const s = P.st.net;
    if (s === 'dunk' || s === 'rising' || s === 'hold') return 'pot';
    if ((s === 'carry' && P.st.fromPot) || s === 'pour') return 'serve';
    return null;
  };
})();
