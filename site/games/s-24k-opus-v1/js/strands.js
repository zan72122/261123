/* strands.js — 格子の各穴から送り出される寒天の糸。
   糸は粒の鎖（先端が 0 番）。押し出した距離だけ e が伸び、出口近くの粒は道具に従って動き、
   外へ出た粒は重さで垂れ、皿や山に触れるとその皿の座標で落ち着く。 */
(function () {
  'use strict';
  const G = window.G;
  const L = G.L, M = G.M;

  const SEG = 0.7;           // 粒の間隔（cm）
  const RAD = 0.5;           // 糸の半分の太さ
  const U_KIN = 0.45;        // 出口からこの長さまでは格子に支えられている
  const MAXP = 150;
  const GRAV = 980;
  const ITER = 8;

  const S = (G.strands = {
    SEG, RAD, MAXP,
    chains: [], rooted: new Array(16).fill(null),
    pressure: 0, lastDe: 0, extrudeV: 0, totalOut: 0,
    landCount: 0, lastLandSound: 0, events: [],
    holeGain: new Float32Array(16),
  });

  class Chain {
    constructor(hole, rooted) {
      this.hole = hole; this.rooted = rooted;
      this.n = 0; this.e = 0;
      this.px = new Float32Array(MAXP); this.py = new Float32Array(MAXP); this.pz = new Float32Array(MAXP);
      this.qx = new Float32Array(MAXP); this.qy = new Float32Array(MAXP); this.qz = new Float32Array(MAXP);
      this.lx = new Float32Array(MAXP); this.ly = new Float32Array(MAXP); this.lz = new Float32Array(MAXP);
      this.sx = new Float32Array(MAXP); this.sz = new Float32Array(MAXP); this.slide = new Float32Array(MAXP);
      this.st = new Uint8Array(MAXP);   // 0:出口で支えられる 1:自由 2:落ち着いた 3:滑っている
      this.pl = new Int8Array(MAXP);    // 皿の番号（-1 は盆や卓）
      this.bubble = -1;
      this.bulge = 0;
      this.mesh = null;
      this.isStatic = false; this.staticPlate = -2; this.calm = 0;
      this.dirty = true;
      this.id = Chain.next++;
      this.fresh = 0;
    }
    u(i) { return this.e - i * SEG; }
  }
  Chain.next = 1;
  S.Chain = Chain;

  const tmpV = new THREE.Vector3();

  S.init = function (scene) {
    S.scene = scene;
    for (let h = 0; h < 16; h++) {
      S.holeGain[h] = 1 + (G.rand() - 0.5) * 0.05 + (((h >> 2) === 1 || (h >> 2) === 2) && ((h & 3) === 1 || (h & 3) === 2) ? 0.015 : 0);
      newRooted(h);
    }
  };

  function newRooted(h) {
    const c = new Chain(h, true);
    c.n = 1; c.e = 0;
    const ex = L.EXIT_X, ey = L.holeY(h), ez = L.holeZ(h);
    c.px[0] = c.qx[0] = ex - 0.01; c.py[0] = c.qy[0] = ey; c.pz[0] = c.qz[0] = ez;
    c.st[0] = 0; c.pl[0] = -1;
    c.mesh = G.strandMesh.create(c);
    S.chains.push(c);
    S.rooted[h] = c;
    return c;
  }

  // ---- 押し出し：実際に寒天を押した距離 dx（cm, 寒天側）を受け取る ----
  S.extrude = function (dx, dt) {
    const de = dx * L.EXTRUDE_RATIO;
    S.lastDe = de;
    S.extrudeV = dt > 0 ? de / dt : 0;
    if (de <= 0) return;
    S.totalOut += de;
    for (let h = 0; h < 16; h++) {
      const c = S.rooted[h];
      c.e += de * S.holeGain[h];
      c.fresh = 0.4;
      // 根元側に粒を足す（最後の粒の u が 0 以下になるまで）
      while (c.e - (c.n - 1) * SEG > 0 && c.n < MAXP) {
        const i = c.n;
        const u = c.e - i * SEG;
        const ex = L.EXIT_X + u, ey = L.holeY(h), ez = L.holeZ(h);
        c.px[i] = c.qx[i] = ex; c.py[i] = c.qy[i] = ey; c.pz[i] = c.qz[i] = ez;
        c.st[i] = 0; c.pl[i] = -1; c.slide[i] = 0;
        c.n++;
      }
      if (c.n >= MAXP - 2) splitLong(c);
      c.dirty = true;
    }
  };

  // ---- 切り糸がある列を横切った ----
  S.cutColumn = function (col) {
    const out = [];
    for (let h = 0; h < 16; h++) {
      if ((h & 3) !== col) continue;
      const c = S.rooted[h];
      // 出口の外にある粒の数
      let m = 0;
      while (m < c.n && c.e - m * SEG > 0.03) m++;
      if (m === 0) continue;
      const piece = splitAt(c, m, true);
      if (piece) out.push(piece);
    }
    return out;
  };

  // c の [0..m-1] を切り離して新しい鎖にする。c は [m..n-1] になる。
  function splitAt(c, m, fromCut) {
    if (m <= 0 || m >= c.n + 1) return null;
    const p = new Chain(-1, false);
    const keepTail = fromCut ? 0 : 1; // 長すぎて分ける時は継ぎ目の粒を共有
    const pn = Math.min(m + keepTail, c.n);
    for (let i = 0; i < pn; i++) copyP(c, i, p, i);
    p.n = pn;
    for (let i = 0; i < pn; i++) {
      if (p.st[i] === 0) { p.st[i] = 1; p.qx[i] = p.px[i]; p.qy[i] = p.py[i]; p.qz[i] = p.pz[i]; }
    }
    if (fromCut && pn >= 1) {
      // 切り口を切り糸の面にそろえる
      const i = pn - 1;
      const u = c.e - i * SEG;
      if (u > 0.3 && c.st[i] !== 2) { p.px[i] = Math.max(L.CUT_X, p.px[i] - (u - 0.25)); }
    }
    if (c.bubble >= 0 && c.bubble < m) { p.bubble = c.bubble; c.bubble = -1; } else if (c.bubble >= m) c.bubble -= m;
    // 残り
    const rest = c.n - m;
    for (let i = 0; i < rest; i++) copyP(c, i + m, c, i);
    c.n = Math.max(rest, 0);
    c.e -= m * SEG;
    if (c.n === 0) {
      c.n = 1; c.e = 0;
      c.px[0] = c.qx[0] = L.EXIT_X - 0.01; c.py[0] = c.qy[0] = L.holeY(c.hole); c.pz[0] = c.qz[0] = L.holeZ(c.hole);
      c.st[0] = 0;
    }
    // 見た目の糸の形は切り離した方が持っていく
    p.mesh = c.mesh; p.mesh.userData.chain = p;
    c.mesh = G.strandMesh.create(c);
    p.dirty = c.dirty = true;
    S.chains.push(p);
    return p;
  }

  function copyP(a, i, b, j) {
    b.px[j] = a.px[i]; b.py[j] = a.py[i]; b.pz[j] = a.pz[i];
    b.qx[j] = a.qx[i]; b.qy[j] = a.qy[i]; b.qz[j] = a.qz[i];
    b.lx[j] = a.lx[i]; b.ly[j] = a.ly[i]; b.lz[j] = a.lz[i];
    b.sx[j] = a.sx[i]; b.sz[j] = a.sz[i]; b.slide[j] = a.slide[i];
    b.st[j] = a.st[i]; b.pl[j] = a.pl[i];
  }

  // 押し続けて鎖が長くなりすぎたら、皿に落ち着いた所で静かに分ける
  function splitLong(c) {
    for (let i = Math.min(c.n - 40, 90); i > 4; i--) {
      if (c.st[i] === 2 && c.st[i - 1] === 2) { splitAt(c, i, false); return; }
    }
  }

  // ---- 気泡：まれに一本の糸の先近くに残る ----
  S.addBubble = function (hole) {
    const c = S.rooted[hole];
    if (!c) return;
    let i = c.n - 1;
    while (i > 0 && c.e - i * SEG < 0.2) i--;
    c.bubble = Math.max(0, i);
  };

  // ---- 棒を離した時の小さな震え ----
  S.tremble = function (amt) {
    for (let h = 0; h < 16; h++) {
      const c = S.rooted[h];
      for (let i = 0; i < c.n; i++) {
        if (c.st[i] !== 1) continue;
        const u = c.e - i * SEG;
        const k = amt * Math.min(1, u / 4) * (0.7 + 0.6 * G.rand());
        c.qy[i] -= k * 0.012; c.qx[i] += k * 0.006;
      }
      c.dirty = true;
    }
  };

  // ---- 皿・床との当たり ----
  function landTest(c, i) {
    const x = c.px[i], y = c.py[i], z = c.pz[i];
    const dishes = G.dish.list;
    for (let k = 0; k < dishes.length; k++) {
      const d = dishes[k];
      if (!d.collide) continue;
      const dx = x - d.cx, dz = z - d.cz;
      if (dx * dx + dz * dz > (L.PLATE.R + 1) * (L.PLATE.R + 1)) continue;
      d.toLocal(x, y, z, tmpV);
      const r = Math.sqrt(tmpV.x * tmpV.x + tmpV.z * tmpV.z);
      if (r > L.PLATE.R + RAD * 0.6) continue;
      const surf = r < L.PLATE.Rin ? d.surfFor(tmpV.x, tmpV.z, c.id, i) : L.PLATE.H + 0.05;
      if (tmpV.y < surf + RAD) {
        land(c, i, d, tmpV.x, surf + RAD, tmpV.z, r);
        return true;
      }
      return false;
    }
    const fy = G.dish.floorAt(x, z);
    if (y < fy + RAD) {
      c.st[i] = 3; c.pl[i] = -1; c.slide[i] = 0;
      c.lx[i] = x; c.ly[i] = fy + RAD; c.lz[i] = z;
      c.sx[i] = (c.px[i] - c.qx[i]) * 0.3; c.sz[i] = (c.pz[i] - c.qz[i]) * 0.3;
      c.py[i] = c.qy[i] = fy + RAD;
      return true;
    }
    return false;
  }

  function land(c, i, d, lx, ly, lz) {
    c.st[i] = 3; c.pl[i] = d.id; c.slide[i] = 0;
    c.lx[i] = lx; c.ly[i] = ly; c.lz[i] = lz;
    // 着いた時の勢い（皿の座標での水平の速さ）を少しだけ残す
    const vx = c.px[i] - c.qx[i], vz = c.pz[i] - c.qz[i], vy = c.py[i] - c.qy[i];
    const cs = Math.cos(-d.rotY), sn = Math.sin(-d.rotY);
    c.sx[i] = (vx * cs - vz * sn) * 0.35; c.sz[i] = (vx * sn + vz * cs) * 0.35;
    S.landCount++;
    if (vy < -0.06 && G.time - S.lastLandSound > 0.09) {
      S.lastLandSound = G.time;
      S.events.push({ type: 'land', x: c.px[i], y: c.py[i], z: c.pz[i], v: -vy, dish: d });
    }
  }

  // 滑っている粒を進め、止まったら山に刻む
  function slideStep(c, i, h) {
    c.slide[i] += h;
    const id = c.pl[i];
    if (id < 0) {
      c.lx[i] += c.sx[i]; c.lz[i] += c.sz[i];
      c.sx[i] *= 0.6; c.sz[i] *= 0.6;
      if (c.slide[i] > 0.12) c.st[i] = 2;
      c.px[i] = c.qx[i] = c.lx[i]; c.py[i] = c.qy[i] = c.ly[i]; c.pz[i] = c.qz[i] = c.lz[i];
      return;
    }
    const d = G.dish.byId[id];
    const gr = d.gradFor(c.lx[i], c.lz[i], c.id, i);
    const slope = Math.sqrt(gr[0] * gr[0] + gr[1] * gr[1]);
    let mx = c.sx[i], mz = c.sz[i];
    if (slope > 0.42 && c.slide[i] < 1.0) {
      const sp = Math.min(12, 8 * (slope - 0.3)) * h;
      mx -= gr[0] / slope * sp; mz -= gr[1] / slope * sp;
    }
    c.sx[i] *= 0.55; c.sz[i] *= 0.55;
    let nx = c.lx[i] + mx, nz = c.lz[i] + mz;
    const r = Math.sqrt(nx * nx + nz * nz);
    const lim = L.PLATE.Rin - RAD * 0.8;
    if (r > lim) { nx *= lim / r; nz *= lim / r; }
    c.lx[i] = nx; c.lz[i] = nz;
    c.ly[i] = d.surfFor(nx, nz, c.id, i) + RAD;
    const moving = Math.abs(mx) + Math.abs(mz) > 0.004;
    if ((!moving && c.slide[i] > 0.05) || c.slide[i] > 1.1) {
      c.st[i] = 2;
      d.stamp(c.lx[i], c.ly[i], c.lz[i], RAD, c.id * 1024 + i);
    }
    d.toWorld(c.lx[i], c.ly[i], c.lz[i], tmpV);
    c.px[i] = c.qx[i] = tmpV.x; c.py[i] = c.qy[i] = tmpV.y; c.pz[i] = c.qz[i] = tmpV.z;
  }

  function unsettle(c, i) {
    const id = c.pl[i];
    c.st[i] = 1;
    c.qx[i] = c.px[i]; c.qy[i] = c.py[i]; c.qz[i] = c.pz[i];
    if (id >= 0 && G.dish.byId[id]) G.dish.byId[id].pileDirty = true;
  }

  // ---- 自由な粒同士が重ならないように（束の見た目） ----
  const HASH = new Map();
  const CELL = 1.0;
  function hashKey(x, y, z) { return ((Math.floor(x / CELL) + 512) * 1048576) + ((Math.floor(y / CELL) + 512) * 1024) + (Math.floor(z / CELL) + 512); }
  function repel() {
    HASH.clear();
    const list = S.chains;
    for (let ci = 0; ci < list.length; ci++) {
      const c = list[ci];
      if (c.isStatic) continue;
      for (let i = 0; i < c.n; i++) {
        if (c.st[i] !== 1) continue;
        const k = hashKey(c.px[i], c.py[i], c.pz[i]);
        let a = HASH.get(k);
        if (!a) { a = []; HASH.set(k, a); }
        a.push(ci, i);
      }
    }
    const minD = 2 * RAD * 0.92, minD2 = minD * minD;
    for (let ci = 0; ci < list.length; ci++) {
      const c = list[ci];
      if (c.isStatic) continue;
      for (let i = 0; i < c.n; i++) {
        if (c.st[i] !== 1) continue;
        const x = c.px[i], y = c.py[i], z = c.pz[i];
        const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), gz = Math.floor(z / CELL);
        for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -1; az <= 1; az++) {
          const a = HASH.get(((gx + ax + 512) * 1048576) + ((gy + ay + 512) * 1024) + (gz + az + 512));
          if (!a) continue;
          for (let t = 0; t < a.length; t += 2) {
            const cj = a[t], j = a[t + 1];
            if (cj < ci || (cj === ci && j <= i + 2)) continue;
            const o = list[cj];
            const dx = o.px[j] - c.px[i], dy = o.py[j] - c.py[i], dz = o.pz[j] - c.pz[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= minD2 || d2 < 1e-8) continue;
            const d = Math.sqrt(d2), f = (minD - d) / d * 0.25;
            c.px[i] -= dx * f; c.py[i] -= dy * f; c.pz[i] -= dz * f;
            o.px[j] += dx * f; o.py[j] += dy * f; o.pz[j] += dz * f;
          }
        }
      }
    }
  }

  // ---- 1フレーム ----
  S.step = function (dt) {
    dt = Math.min(dt, 1 / 30);
    const NS = 3, h = dt / NS, h2 = h * h;
    const de = S.lastDe;
    S.lastDe = 0;
    const dishes = G.dish.list;
    for (let s = 0; s < NS; s++) {
      for (let ci = 0; ci < S.chains.length; ci++) {
        const c = S.chains[ci];
        if (c.isStatic) continue;
        const rooted = c.rooted;
        const hy = rooted ? L.holeY(c.hole) : 0, hz = rooted ? L.holeZ(c.hole) : 0;
        const subE = rooted ? c.e - de * S.holeGain[c.hole] * (NS - 1 - s) / NS : 0;
        const vstep = rooted ? de * S.holeGain[c.hole] / NS : 0;
        let moving = false;
        for (let i = 0; i < c.n; i++) {
          const st = c.st[i];
          if (st === 0) {
            const u = subE - i * SEG;
            if (u >= U_KIN) {
              c.st[i] = 1; // 外に出て自由になる
              c.qx[i] = c.px[i] - vstep * 0.92; c.qy[i] = c.py[i]; c.qz[i] = c.pz[i];
            } else {
              c.px[i] = L.EXIT_X + u; c.py[i] = hy; c.pz[i] = hz;
              c.qx[i] = c.px[i] - vstep; c.qy[i] = hy; c.qz[i] = hz;
            }
          } else if (st === 1) {
            const vx = (c.px[i] - c.qx[i]) * 0.985, vy = (c.py[i] - c.qy[i]) * 0.985, vz = (c.pz[i] - c.qz[i]) * 0.985;
            c.qx[i] = c.px[i]; c.qy[i] = c.py[i]; c.qz[i] = c.pz[i];
            c.px[i] += vx; c.py[i] += vy - GRAV * h2; c.pz[i] += vz;
            moving = true;
          } else if (st === 2) {
            const id = c.pl[i];
            if (id >= 0) {
              const d = G.dish.byId[id];
              if (d.moved) { d.toWorld(c.lx[i], c.ly[i], c.lz[i], tmpV); c.px[i] = c.qx[i] = tmpV.x; c.py[i] = c.qy[i] = tmpV.y; c.pz[i] = c.qz[i] = tmpV.z; moving = true; }
            }
          } else if (st === 3) {
            slideStep(c, i, h);
            moving = true;
          }
        }
        // はがれ：自由な粒が皿の上の粒から大きく離れたら、皿からはがれる
        for (let i = 0; i + 1 < c.n; i++) {
          const a = c.st[i], b = c.st[i + 1];
          if ((a === 2 || a === 3) && b === 1 || (b === 2 || b === 3) && a === 1) {
            const dx = c.px[i + 1] - c.px[i], dy = c.py[i + 1] - c.py[i], dz = c.pz[i + 1] - c.pz[i];
            if (dx * dx + dy * dy + dz * dz > SEG * SEG * 3.2) unsettle(c, a === 1 ? i + 1 : i);
          }
        }
        if (moving || c.fresh > 0) c.dirty = true;
      }
      // 拘束
      for (let it = 0; it < ITER; it++) {
        for (let ci = 0; ci < S.chains.length; ci++) {
          const c = S.chains[ci];
          if (c.isStatic) continue;
          solveChain(c, it);
        }
      }
      repel();
      // 当たり
      for (let ci = 0; ci < S.chains.length; ci++) {
        const c = S.chains[ci];
        if (c.isStatic) continue;
        for (let i = 0; i < c.n; i++) {
          if (c.st[i] !== 1) continue;
          // 格子の面・筒の下には入らない
          if (c.px[i] < L.EXIT_X + 0.35 && c.py[i] > 7.6 && c.py[i] < 16.4 && Math.abs(c.pz[i]) < 4.6) c.px[i] = L.EXIT_X + 0.35;
          landTest(c, i);
        }
      }
    }
    for (let k = 0; k < dishes.length; k++) dishes[k].moved = false;
    // 落ち着いた切れ端は皿の一部になる
    for (let ci = S.chains.length - 1; ci >= 0; ci--) {
      const c = S.chains[ci];
      c.fresh = Math.max(0, c.fresh - dt);
      if (c.rooted || c.isStatic) continue;
      let all = true, plate = -9, same = true, cnt = 0, onPlate = new Map();
      for (let i = 0; i < c.n; i++) {
        if (c.st[i] !== 2) { all = false; break; }
        const p = c.pl[i];
        onPlate.set(p, (onPlate.get(p) || 0) + 1);
      }
      if (!all) { c.calm = 0; continue; }
      c.calm += dt;
      if (c.calm < 0.6) continue;
      for (const [p, n] of onPlate) { if (n > cnt) { cnt = n; plate = p; } }
      if (onPlate.size > 1) same = false;
      makeStatic(c, plate, same);
    }
  };

  function solveChain(c, it) {
    const n = c.n;
    const kB = 0.09;
    // 根元から先へ：まっすぐ続こうとする（短い先端は張り、長くなると重さでおじぎ）
    if (c.rooted) {
      for (let i = n - 3; i >= 0; i--) {
        if (c.st[i] !== 1) continue;
        const a = i + 1, b = i + 2;
        let tx = c.px[a] - c.px[b], ty = c.py[a] - c.py[b], tz = c.pz[a] - c.pz[b];
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        const k = kB * (c.st[a] === 0 ? 2.4 : 1);
        tx = c.px[a] + tx / tl * SEG; ty = c.py[a] + ty / tl * SEG; tz = c.pz[a] + tz / tl * SEG;
        c.px[i] += (tx - c.px[i]) * k; c.py[i] += (ty - c.py[i]) * k; c.pz[i] += (tz - c.pz[i]) * k;
      }
    } else {
      for (let i = 1; i + 1 < n; i++) {
        if (c.st[i] !== 1) continue;
        const mx = (c.px[i - 1] + c.px[i + 1]) * 0.5, my = (c.py[i - 1] + c.py[i + 1]) * 0.5, mz = (c.pz[i - 1] + c.pz[i + 1]) * 0.5;
        c.px[i] += (mx - c.px[i]) * 0.05; c.py[i] += (my - c.py[i]) * 0.05; c.pz[i] += (mz - c.pz[i]) * 0.05;
      }
    }
    // 長さ
    const dir = it & 1;
    for (let k = 0; k + 1 < n; k++) {
      const i = dir ? k : n - 2 - k, j = i + 1;
      const wi = c.st[i] === 1 ? 1 : 0, wj = c.st[j] === 1 ? 1 : 0;
      const ws = wi + wj;
      if (ws === 0) continue;
      const dx = c.px[j] - c.px[i], dy = c.py[j] - c.py[i], dz = c.pz[j] - c.pz[i];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-6) continue;
      const f = (d - SEG) / d / ws;
      if (wi) { c.px[i] += dx * f; c.py[i] += dy * f; c.pz[i] += dz * f; }
      if (wj) { c.px[j] -= dx * f; c.py[j] -= dy * f; c.pz[j] -= dz * f; }
    }
  }

  function makeStatic(c, plate, same) {
    c.isStatic = true; c.staticPlate = plate;
    if (plate >= 0) {
      const d = G.dish.byId[plate];
      // 皿以外に乗った粒も皿の座標にそろえる
      for (let i = 0; i < c.n; i++) {
        if (c.pl[i] !== plate) {
          d.toLocal(c.px[i], c.py[i], c.pz[i], tmpV);
          c.lx[i] = tmpV.x; c.ly[i] = tmpV.y; c.lz[i] = tmpV.z; c.pl[i] = plate;
        }
      }
      d.pieces.push(c);
      G.strandMesh.attachToDish(c, d);
    } else {
      G.strandMesh.build(c);
    }
    c.dirty = false;
  }

  // 皿に落ち着いた切れ端を軽く揺らした後、もう一度落ち着かせる（皿の揺れ）
  S.nudgeDish = function () { /* 皿ごと揺れるので形はそのまま */ };

  // 描画の更新
  S.updateMeshes = function () {
    for (let ci = 0; ci < S.chains.length; ci++) {
      const c = S.chains[ci];
      if (c.isStatic || !c.dirty) continue;
      G.strandMesh.build(c);
      c.dirty = false;
    }
  };

  // ある皿に乗っている（根元とつながった）粒があるか
  S.connectedTo = function (dishId) {
    for (let h = 0; h < 16; h++) {
      const c = S.rooted[h];
      for (let i = 0; i < c.n; i++) if ((c.st[i] === 2 || c.st[i] === 3) && c.pl[i] === dishId) return true;
    }
    return false;
  };
  // 出口から出ている長さ（最大）
  S.outLength = function () {
    let m = 0;
    for (let h = 0; h < 16; h++) m = Math.max(m, S.rooted[h].e);
    return m;
  };
  // 皿に届いた糸の数
  S.reachedCount = function () {
    let n = 0;
    for (let h = 0; h < 16; h++) {
      const c = S.rooted[h];
      for (let i = 0; i < c.n; i++) if (c.st[i] === 2 || c.st[i] === 3) { n++; break; }
    }
    return n;
  };
  // 宙に垂れている粒（しずくが伝う場所）
  S.hangingPoint = function () {
    const cands = [];
    for (let ci = 0; ci < S.chains.length; ci++) {
      const c = S.chains[ci];
      if (c.isStatic) continue;
      let cnt = 0;
      for (let i = 0; i < c.n; i++) if (c.st[i] === 1) cnt++;
      if (cnt > 6) cands.push(c);
    }
    if (!cands.length) return null;
    return cands[Math.floor(G.rand() * cands.length)];
  };
})();
