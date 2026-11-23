// cord.js — 綿ひも：撚りの見える管の形と、たるんだり机に寝たりするひもの計算
(function () {
  'use strict';
  const S = window.S23, P = S.physics;
  const V3 = THREE.Vector3;
  const CD = (S.cord = {});

  CD.material = function (tint) {
    const m = new THREE.MeshStandardMaterial({
      color: tint || 0xffffff, map: S.TX.cord().clone(), bumpMap: S.TX.cordBump(), bumpScale: 0.5, roughness: 0.95, emissive: 0x000000,
    });
    m.map.needsUpdate = true;
    return m;
  };

  // 折れ線に沿った管。u は長さ(cm)/撚りのピッチ。
  CD.makeTube = function (maxPts, radius, radial, mat, closed) {
    radial = radial || 6;
    const nV = maxPts * (radial + 1);
    const pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const tan = new V3(), nor = new V3(), bin = new V3(), prevN = new V3(0, 1, 0), tmp = new V3();
    const t = {
      mesh, geo, radius, radial, maxPts, pitch: 0.42,
      update(pts, n) {
        n = Math.min(n || pts.length, maxPts);
        let len = 0;
        prevN.set(0, 1, 0);
        for (let i = 0; i < n; i++) {
          const p = pts[i];
          // 接線
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
          tan.copy(b).sub(a);
          if (closed && (i === 0 || i === n - 1)) tan.copy(pts[1]).sub(pts[n - 2]);
          if (tan.lengthSq() < 1e-10) tan.set(1, 0, 0);
          tan.normalize();
          // 平行移動フレーム
          nor.copy(prevN).addScaledVector(tan, -prevN.dot(tan));
          if (nor.lengthSq() < 1e-6) { nor.set(0, 0, 1).addScaledVector(tan, -tan.z); if (nor.lengthSq() < 1e-6) nor.set(1, 0, 0); }
          nor.normalize();
          bin.copy(tan).cross(nor);
          prevN.copy(nor);
          if (i > 0) len += p.distanceTo(pts[i - 1]);
          for (let j = 0; j <= radial; j++) {
            const th = (j / radial) * S.TAU;
            const c = Math.cos(th), s = Math.sin(th);
            tmp.copy(nor).multiplyScalar(c).addScaledVector(bin, s);
            const k = (i * (radial + 1) + j);
            pos[k * 3] = p.x + tmp.x * radius; pos[k * 3 + 1] = p.y + tmp.y * radius; pos[k * 3 + 2] = p.z + tmp.z * radius;
            nrm[k * 3] = tmp.x; nrm[k * 3 + 1] = tmp.y; nrm[k * 3 + 2] = tmp.z;
            uv[k * 2] = len / this.pitch; uv[k * 2 + 1] = j / radial;
          }
        }
        geo.setDrawRange(0, Math.max(0, (n - 1) * radial * 6));
        geo.attributes.position.needsUpdate = true;
        geo.attributes.normal.needsUpdate = true;
        geo.attributes.uv.needsUpdate = true;
      },
    };
    return t;
  };

  // ---- ひもの計算（ベルレ法） ----
  // ひも本体 n 個の点 + 先の輪 m 個の点。点0は引き板に結ばれている。
  CD.Rope = function (n, seg, m, loopR) {
    this.n = n; this.m = m; this.seg = seg;
    this.loopSeg = (S.TAU * loopR) / m;
    this.loopR = loopR;
    this.p = []; this.q = []; this.pin = []; this.tgt = []; this.tw = [];
    for (let i = 0; i < n + m; i++) {
      this.p.push(new V3()); this.q.push(new V3()); this.pin.push(false); this.tgt.push(new V3()); this.tw.push(0);
    }
    this.stiffFrom = n - 5; // 硬い先端
    this.grab = -1; this.grabPos = new V3();
    this.targetK = 0; // 1 で目標の形に従う（滑車に掛かったとき）
    this.collide = true;
  };
  const R = CD.Rope.prototype;
  R.layCoil = function (start, center) {
    // 盆の上で渦を巻いて寝ている
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = t * S.TAU * 1.3 + 1.2, r = 3.4 - t * 1.4;
      const p = this.p[i];
      if (i === 0) p.copy(start);
      else p.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r * 0.8);
      this.q[i].copy(p);
    }
    const last = this.p[n - 1];
    for (let k = 0; k < this.m; k++) {
      const a = (k / this.m) * S.TAU;
      this.p[n + k].set(last.x + 2.2 + Math.cos(a) * this.loopR - this.loopR, center.y, last.z + Math.sin(a) * this.loopR);
      this.q[n + k].copy(this.p[n + k]);
    }
  };
  const _g = new V3(), _n = new V3(), _d = new V3();
  R.step = function (dt, pinPos) {
    const N = this.n + this.m;
    const h = Math.min(dt, 1 / 30) / 2;
    for (let sub = 0; sub < 2; sub++) {
      for (let i = 0; i < N; i++) {
        const p = this.p[i], q = this.q[i];
        _g.copy(p).sub(q).multiplyScalar(0.985);
        q.copy(p);
        p.add(_g);
        p.y -= 980 * h * h;
      }
      for (let it = 0; it < 10; it++) {
        this.p[0].copy(pinPos);
        if (this.grab >= 0) this.p[this.grab].copy(this.grabPos);
        // ひも本体
        for (let i = 0; i < this.n - 1; i++) this.link(i, i + 1, this.seg, i >= this.stiffFrom ? 1 : 0.9);
        // 硬い先端（曲がりにくい）
        for (let i = this.stiffFrom; i < this.n - 2; i++) this.link(i, i + 2, this.seg * 2, 0.6);
        // 輪
        const n = this.n, m = this.m;
        this.link(n - 1, n, this.loopSeg * 0.5, 1);
        for (let k = 0; k < m - 1; k++) this.link(n + k, n + k + 1, this.loopSeg, 1);
        this.link(n + m - 1, n - 1, this.loopSeg * 0.5, 1);
        // 輪が丸く開くよう向かいどうしを少し支える
        for (let k = 0; k < m / 2; k++) this.link(n + k, n + k + Math.floor(m / 2), this.loopR * 1.7, 0.08);
        // 目標の形（滑車に掛かっているとき）
        if (this.targetK > 0) {
          for (let i = 1; i < N; i++) {
            if (i === this.grab) continue;
            const w = this.targetK * (this.tw[i] || 1);
            this.p[i].lerp(this.tgt[i], Math.min(1, w));
          }
        }
        if (this.collide && it % 3 === 2) this.collideAll();
      }
    }
  };
  R.link = function (a, b, len, k) {
    const pa = this.p[a], pb = this.p[b];
    _d.copy(pb).sub(pa);
    const d = _d.length();
    if (d < 1e-6) return;
    const diff = ((d - len) / d) * 0.5 * k;
    const wa = a === 0 || a === this.grab ? 0 : 1, wb = b === 0 || b === this.grab ? 0 : 1;
    const s = wa + wb; if (s === 0) return;
    pa.addScaledVector(_d, (diff * 2 * wa) / s);
    pb.addScaledVector(_d, (-diff * 2 * wb) / s);
  };
  R.collideAll = function () {
    const N = this.n + this.m, r = 0.16;
    for (let i = 1; i < N; i++) {
      const p = this.p[i];
      if (p.y < r) { p.y = r; this.q[i].x = S.lerp(this.q[i].x, p.x, 0.6); this.q[i].z = S.lerp(this.q[i].z, p.z, 0.6); }
      const depth = P.queryStatic(p, r, _n);
      if (depth > 0) {
        p.addScaledVector(_n, depth);
        // 摩擦
        this.q[i].lerp(p, 0.4);
      }
    }
  };
  R.points = function (out) {
    for (let i = 0; i < this.n; i++) out[i] = this.p[i];
    return this.n;
  };
  R.loopPoints = function (out) {
    const n = this.n;
    out[0] = this.p[n - 1];
    for (let k = 0; k < this.m; k++) out[k + 1] = this.p[n + k];
    out[this.m + 1] = this.p[n - 1];
    return this.m + 2;
  };
})();
