// Camera director: fits shot boxes into the viewport and orbits smoothly between shots.
import * as THREE from 'three';
import { ease } from './timeline.js';

const D2R = Math.PI / 180;

// vp() -> { w, h, insets: {top,right,bottom,left} } in CSS px
export function createCameraDirector(ctx, camera, vp, guard) {
  const cur = { target: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 30, dist: 2, fov: 45 };
  let shot = null;
  let tr = null; // transition { from, shot, t, dur, ease, resolve }
  let breathAmp = 1;
  let shakeAmt = 0, shakeDur = 0, shakeT = 0;
  let time = 0;
  let lastFov = -1, lastAspect = -1;

  const _c = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
  const _p = new THREE.Vector3(), _tmp = new THREE.Vector3();

  function resolveShot(s) {
    if (typeof s === 'function') s = s(ctx);
    if (!s || !Array.isArray(s.box) || s.box.length < 6) return null;
    return s;
  }

  function basis(yawDeg, pitchDeg, f, r, u) {
    const y = yawDeg * D2R, p = pitchDeg * D2R;
    f.set(Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p));
    r.set(Math.cos(y), 0, Math.sin(y));
    u.crossVectors(r, f).normalize();
  }

  function shotFov(s, w, h) { return Number.isFinite(s.fov) ? s.fov : (w < h ? 45 : 36); }

  // Minimum-distance fit with fixed orientation; closed form per axis.
  function fit(s, out = {}) {
    const { w, h, insets } = vp();
    const aspect = w / Math.max(1, h);
    const fov = shotFov(s, w, h);
    const m = Number.isFinite(s.margin) ? s.margin : 0.07;
    const yaw = +s.yaw || 0, pitch = +s.pitch || 0;
    basis(yaw, pitch, _f, _r, _u);
    const tanV = Math.tan(fov * D2R / 2), tanH = tanV * aspect;
    let xl = -1 + 2 * (m + insets.left / w), xr = 1 - 2 * (m + insets.right / w);
    let yb = -1 + 2 * (m + insets.bottom / h), yt = 1 - 2 * (m + insets.top / h);
    if (xr - xl < 0.3) { xl = -0.15; xr = 0.15; }
    if (yt - yb < 0.3) { yb = -0.15; yt = 0.15; }
    const tR = xr * tanH, tL = -xl * tanH, tU = yt * tanV, tD = -yb * tanV;
    const b = s.box, pts = s.pts;       // pts: optional flat [x,y,z, ...] list fitted instead of the box corners
    _c.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    let A = -Infinity, B = Infinity, C = -Infinity, D = Infinity, zmin = Infinity;
    const n = pts ? pts.length / 3 : 8;
    for (let i = 0; i < n; i++) {
      if (pts) _p.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).sub(_c);
      else _p.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]).sub(_c);
      const x = _p.dot(_r), y = _p.dot(_u), z = _p.dot(_f);
      A = Math.max(A, x - tR * z); B = Math.min(B, x + tL * z);
      C = Math.max(C, y - tU * z); D = Math.min(D, y + tD * z);
      zmin = Math.min(zmin, z);
    }
    let cz = Math.min((B - A) / (tL + tR), (D - C) / (tU + tD), zmin - 0.08);
    if (!Number.isFinite(cz)) cz = -1;
    const cx = ((A + tR * cz) + (B - tL * cz)) / 2;
    const cy = ((C + tU * cz) + (D - tD * cz)) / 2;
    const dist = Math.max(0.05, -cz);
    const pos = _tmp.copy(_c).addScaledVector(_r, cx).addScaledVector(_u, cy).addScaledVector(_f, cz);
    out.target = (out.target || new THREE.Vector3()).copy(pos).addScaledVector(_f, dist);
    out.yaw = yaw; out.pitch = pitch; out.dist = dist; out.fov = fov;
    return out;
  }

  function copyParams(dst, src) {
    dst.target.copy(src.target); dst.yaw = src.yaw; dst.pitch = src.pitch; dst.dist = src.dist; dst.fov = src.fov;
  }

  function shadowFocus(s) {
    const b = s.box;
    const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const r = 0.5 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) + 0.4;
    if (ctx.world && typeof ctx.world.setShadowFocus === 'function') guard(() => ctx.world.setShadowFocus(c, r), 'world.setShadowFocus');
  }

  const toParams = { target: new THREE.Vector3() };

  const cam = {
    get shot() { return shot; },
    get busy() { return !!tr; },
    get params() { return cur; },
    fit(s) { s = resolveShot(s); return s ? fit(s) : null; },
    set(s) {
      s = resolveShot(s);
      if (!s) return;
      if (tr) { const r = tr.resolve; tr = null; r(); }
      shot = s;
      copyParams(cur, fit(s, toParams));
      shadowFocus(s);
      apply(0);
    },
    goto(s, dur = 1.3, easeName = 'inOut') {
      s = resolveShot(s);
      if (!s) return Promise.resolve();
      if (!(dur > 0)) { cam.set(s); return Promise.resolve(); }
      if (tr) { const r = tr.resolve; tr = null; r(); } // superseded transitions resolve
      shot = s;
      shadowFocus(s);
      return new Promise((resolve) => {
        const from = { target: cur.target.clone(), yaw: cur.yaw, pitch: cur.pitch, dist: cur.dist, fov: cur.fov };
        tr = { from, shot: s, t: 0, dur, ease: easeName, resolve };
      });
    },
    refit() { if (shot && !tr) copyParams(cur, fit(shot, toParams)); },
    shake(amount = 0.004, dur = 0.35) {
      if (amount >= shakeAmt * (1 - shakeT / Math.max(1e-3, shakeDur))) { shakeAmt = amount; shakeDur = Math.max(0.05, dur); shakeT = 0; }
    },
    update(dt, pointerDown = false) {
      time += dt;
      if (tr) {
        tr.t += dt;
        const k = ease(tr.ease, tr.t / tr.dur);
        const to = fit(tr.shot, toParams);
        const f = tr.from;
        let dy = ((to.yaw - f.yaw) % 360 + 540) % 360 - 180;
        cur.yaw = f.yaw + dy * k;
        cur.pitch = f.pitch + (to.pitch - f.pitch) * k;
        cur.dist = f.dist + (to.dist - f.dist) * k;
        cur.fov = f.fov + (to.fov - f.fov) * k;
        cur.target.lerpVectors(f.target, to.target, k);
        // orbit a bit further out mid-transition when the yaw changes a lot (avoids skimming props)
        cur.dist *= 1 + 0.18 * Math.min(1, Math.abs(dy) / 90) * Math.sin(Math.PI * k);
        if (tr.t >= tr.dur) {
          cur.yaw = to.yaw;
          copyParams(cur, to);
          const r = tr.resolve; tr = null; r();
        }
      }
      breathAmp += ((pointerDown ? 0 : 1) - breathAmp) * Math.min(1, dt * 3);
      apply(dt);
    },
  };

  function apply(dt) {
    const { w, h } = vp();
    const aspect = w / Math.max(1, h);
    basis(cur.yaw, cur.pitch, _f, _r, _u);
    camera.position.copy(cur.target).addScaledVector(_f, -cur.dist);
    // subtle idle breathing (<= 2 mm)
    const b = 0.0015 * breathAmp;
    camera.position.addScaledVector(_r, b * Math.sin(time * 0.37 * 2 * Math.PI * 0.5) * 0.8)
      .addScaledVector(_u, b * Math.sin(time * 0.23 * 2 * Math.PI * 0.5 + 1.3) * 0.6);
    if (shakeAmt > 0) {
      shakeT += dt;
      const e = Math.max(0, 1 - shakeT / shakeDur);
      const a = shakeAmt * e * e;
      const t = time * 60;
      camera.position.addScaledVector(_r, a * (Math.sin(t * 1.13) * 0.6 + Math.sin(t * 2.71) * 0.4))
        .addScaledVector(_u, a * (Math.sin(t * 1.37 + 2) * 0.6 + Math.sin(t * 3.07) * 0.4));
      if (e <= 0) shakeAmt = 0;
    }
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-cur.pitch * D2R, -cur.yaw * D2R, 0);
    camera.near = 0.03; camera.far = 120;
    if (cur.fov !== lastFov || aspect !== lastAspect) {
      camera.fov = cur.fov; camera.aspect = aspect; camera.updateProjectionMatrix();
      lastFov = cur.fov; lastAspect = aspect;
    }
    camera.updateMatrixWorld(true);
  }

  return cam;
}
