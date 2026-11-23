/* fx.js — lightweight 3D particles: flour grains, salt, crumbs, water droplets */
(function () {
  'use strict';
  const U = window.U;
  const F = (U.fx = {});
  const pools = {};
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

  function makePool(name, geom, mat, max) {
    const im = new THREE.InstancedMesh(geom, mat, max);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = name !== 'drop';
    U.core.scene.add(im);
    pools[name] = { im, list: [], max };
  }

  F.init = function () {
    makePool('flour', new THREE.IcosahedronGeometry(0.014, 0), new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.95 }), 500);
    makePool('salt', new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }), 80);
    makePool('crumb', new THREE.IcosahedronGeometry(0.02, 0), new THREE.MeshStandardMaterial({ color: 0xece3cc, roughness: 0.9 }), 200);
    makePool('drop', new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({
      color: 0xdfeaec, roughness: 0.05, transparent: true, opacity: 0.6, depthWrite: false,
    }), 260);
    makePool('soupdrop', new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshStandardMaterial({
      color: 0x9a6232, roughness: 0.05, transparent: true, opacity: 0.75, depthWrite: false,
    }), 80);
    U.core.addUpdate(F.update, 50);
  };

  // spawn a particle. o: {p:Vector3, v:Vector3, life, size, floor: fn(x,z)->y | number, onLand(p), g}
  F.spawn = function (name, o) {
    const pool = pools[name];
    if (!pool) return null;
    if (pool.list.length >= pool.max) pool.list.shift();
    const part = {
      p: o.p.clone(), v: o.v ? o.v.clone() : new THREE.Vector3(), life: o.life || 1.5, t: 0,
      size: o.size || 1, floor: o.floor, onLand: o.onLand, g: o.g == null ? 30 : o.g,
      rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0), stay: o.stay || 0, landed: false, drag: o.drag || 0,
    };
    pool.list.push(part);
    return part;
  };

  F.update = function (dt) {
    for (const name in pools) {
      const pool = pools[name];
      const L = pool.list;
      let k = 0;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        a.t += dt;
        if (!a.landed) {
          a.v.y -= a.g * dt;
          if (a.drag) a.v.multiplyScalar(Math.exp(-a.drag * dt));
          a.p.addScaledVector(a.v, dt);
          if (a.floor != null) {
            const fy = typeof a.floor === 'function' ? a.floor(a.p.x, a.p.z, a) : a.floor;
            if (fy != null && a.p.y <= fy) {
              a.p.y = fy;
              a.landed = true;
              if (a.onLand) a.onLand(a.p, a);
              if (!a.stay) a.t = a.life;
              else a.life = a.t + a.stay;
            }
          }
        }
        if (a.t >= a.life) continue;
        L[k++] = a;
        const fade = a.landed ? U.clamp((a.life - a.t) / 0.4, 0, 1) : 1;
        const s = a.size * fade;
        _q.setFromEuler(a.rot);
        _s.set(s, s, s);
        _m.compose(a.p, _q, _s);
        pool.im.setMatrixAt(k - 1, _m);
      }
      L.length = k;
      pool.im.count = k;
      pool.im.instanceMatrix.needsUpdate = true;
    }
  };

  // splash burst on a liquid surface
  F.splash = function (p, strength, name, floorY) {
    const n = Math.round(3 + strength * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.9) * (0.4 + strength);
      F.spawn(name || 'drop', {
        p: _p.copy(p).add(new THREE.Vector3(Math.cos(a) * 0.04, 0.01, Math.sin(a) * 0.04)),
        v: new THREE.Vector3(Math.cos(a) * sp * 0.6, 0.8 + Math.random() * 1.6 * (0.3 + strength), Math.sin(a) * sp * 0.6),
        life: 1.2, size: 0.6 + Math.random() * 0.7 * (0.5 + strength), floor: floorY, g: 14,
      });
    }
  };
})();
