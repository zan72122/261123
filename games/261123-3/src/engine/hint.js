// Hint system: attention light (level 0) -> wobble + cue bursts (level 1) -> ghost finger demo (level 2).
import * as THREE from 'three';
import { ease } from './timeline.js';
import { makeHandTexture, makeRingTexture } from './hand.js';

const GHOST_PX = 104;    // sprite height in CSS px (the visible hand is ~90 px; the wrist fades out)
const GHOST_OPACITY = 0.55;
const BURST_PERIOD = 2.5, BURST_LEN = 0.8;
const GLINT_PERIOD = 2.5;

const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const seg = (u, a, b) => clamp01((u - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);

// vp() -> { w, h } CSS px
export function createHint(ctx, vp, guard) {
  const { scene, camera } = ctx;

  // --- attention light (kept in the scene permanently so the light count never changes => no shader recompiles)
  const spot = new THREE.SpotLight(0xffd6a0, 0, 0, 0.2, 0.9, 2);
  spot.castShadow = false;
  spot.name = 'hintSpot';
  scene.add(spot, spot.target);

  // --- ghost finger + tap ring sprites
  const hand = makeHandTexture();
  const ghostMat = new THREE.SpriteMaterial({ map: hand.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const ghost = new THREE.Sprite(ghostMat);
  ghost.center.set(hand.tipU, hand.tipV);
  ghost.renderOrder = 1001; ghost.visible = false; ghost.frustumCulled = false; ghost.name = 'hintGhost';
  const ringMat = new THREE.SpriteMaterial({ map: makeRingTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const ring = new THREE.Sprite(ringMat);
  ring.renderOrder = 1000; ring.visible = false; ring.frustumCulled = false;
  scene.add(ghost, ring);

  let cfg = null;
  let idle = 0, level = 0, t = 0;
  let lightK = 0;           // fade-in of the attention light
  let glintT = 0, burstT = 0, wobbling = false, burstOn = false;
  let ghostT = 0;
  let ringT = -1; const ringPos = new THREE.Vector3();
  let prevPress = 0;

  const tgt = { obj: null, fn: null, local: new THREE.Vector3(), radius: 0.12 };
  const to = { obj: null, fn: null, local: new THREE.Vector3(), radius: 0.12 };

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3();
  const _cam = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
  const _box = new THREE.Box3(), _q = new THREE.Vector3();

  function bindPoint(slot, src) {
    slot.obj = null; slot.fn = null; slot.radius = 0.12; slot.local.set(0, 0, 0);
    if (!src) return;
    if (typeof src === 'function') { slot.fn = src; return; }
    if (src.isObject3D) {
      slot.obj = src;
      guard(() => {
        src.updateWorldMatrix(true, true);
        _box.setFromObject(src);
        if (!_box.isEmpty()) {
          _box.getCenter(_q); slot.radius = Math.max(0.03, Math.min(0.6, _box.getSize(_v).length() / 2));
          slot.local.copy(src.worldToLocal(_q.clone()));
        }
      }, 'hint.bind');
      return;
    }
    if (src.isVector3) { slot.fn = () => src; }
  }
  function point(slot, out) {
    if (slot.obj) { slot.obj.updateWorldMatrix(true, false); return slot.obj.localToWorld(out.copy(slot.local)); }
    if (slot.fn) {
      let r = null;
      try { r = slot.fn(); } catch (e) { guard(() => { throw e; }, 'hint.target'); }
      if (r && r.isVector3) return out.copy(r);
      if (Array.isArray(r)) return out.fromArray(r);
    }
    return null;
  }
  const callFn = (fn) => (k, tt) => { if (typeof fn === 'function') guard(() => fn(k, tt), 'hint.wobble'); };

  function stopWobble() { if (wobbling && cfg) callFn(cfg.wobble)(0, t); wobbling = false; burstOn = false; }
  function hideGhost() { ghost.visible = false; ghostMat.opacity = 0; ring.visible = false; ringT = -1; ghostT = 0; prevPress = 0; }

  // world size of one CSS pixel at point p
  function worldPerPx(p) {
    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_f);
    const d = Math.max(0.03, _v.copy(p).sub(_cam).dot(_f));
    return (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, vp().h);
  }

  function circlePoint(center, radius, normal, ang, out) {
    const n = _v.copy(normal || _u.set(0, 1, 0)).normalize();
    // stable in-plane basis: e1 = projection of camera-right onto plane
    _r.setFromMatrixColumn(camera.matrixWorld, 0);
    const e1 = _r.addScaledVector(n, -_r.dot(n));
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).addScaledVector(n, -n.x);
    e1.normalize();
    const e2 = _q.crossVectors(n, e1).normalize();
    return out.copy(center).addScaledVector(e1, Math.cos(ang) * radius).addScaledVector(e2, Math.sin(ang) * radius);
  }

  // returns { alpha, press } and writes the fingertip world position into out; null if nothing to show
  function ghostPose(u, out) {
    const g = cfg.gesture || { type: 'tap' };
    const type = g.type || 'tap';
    if (type === 'drag' || type === 'pull') {
      const A = point(tgt, _a); if (!A) return null;
      let B = null;
      if (type === 'drag') { if (g.to) { bindLazy(); B = point(to, _b); } }
      else if (typeof g.dir === 'function' || (g.dir && g.dir.isVector3)) {
        let d = null; try { d = typeof g.dir === 'function' ? g.dir() : g.dir; } catch (e) { d = null; }
        if (d && d.isVector3) B = _b.copy(A).add(d);
      }
      if (!B) B = _b.copy(A);
      const travel = type === 'pull' ? 1.0 : 1.4;
      const t0 = 0.75, t1 = t0 + travel, cyc = t1 + 1.3;
      const uu = u % cyc;
      const k = ease(type === 'pull' ? 'inOut' : 'inOut', seg(uu, t0, t1));
      out.lerpVectors(A, B, k);
      const alpha = smooth(seg(uu, 0, 0.35)) * (1 - smooth(seg(uu, t1 + 0.45, t1 + 0.85)));
      const press = smooth(seg(uu, 0.35, 0.55)) * (1 - smooth(seg(uu, t1 + 0.15, t1 + 0.4)));
      return { alpha, press };
    }
    if (type === 'circle') {
      let c = null; try { c = typeof g.center === 'function' ? g.center() : g.center; } catch (e) { c = null; }
      if (!(c && c.isVector3)) c = point(tgt, _c); else c = _c.copy(c);
      if (!c) return null;
      const turns = 2, dur = 3.2, t0 = 0.75, t1 = t0 + dur, cyc = t1 + 1.3;
      const uu = u % cyc;
      const k = ease('inOut', seg(uu, t0, t1));
      const ang = Math.PI * 0.5 - k * turns * Math.PI * 2; // start at the far side, clockwise seen from above
      circlePoint(c, +g.radius || 0.1, g.normal, ang, out);
      const alpha = smooth(seg(uu, 0, 0.35)) * (1 - smooth(seg(uu, t1 + 0.45, t1 + 0.85)));
      const press = smooth(seg(uu, 0.35, 0.55)) * (1 - smooth(seg(uu, t1 + 0.15, t1 + 0.4)));
      return { alpha, press };
    }
    if (type === 'scrub') {
      let c = null; try { c = typeof g.center === 'function' ? g.center() : g.center; } catch (e) { c = null; }
      if (!(c && c.isVector3)) c = point(tgt, _c); else c = _c.copy(c);
      if (!c) return null;
      const size = +g.size || 0.12, strokes = 6, dur = 2.6, t0 = 0.75, t1 = t0 + dur, cyc = t1 + 1.3;
      const uu = u % cyc;
      const k = seg(uu, t0, t1);
      // horizontal camera-right and ground-forward axes
      _r.setFromMatrixColumn(camera.matrixWorld, 0); _r.y = 0; if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
      _f.set(-_r.z, 0, _r.x); // perpendicular on ground
      const side = Math.sin(k * strokes * Math.PI - Math.PI / 2); // -1..1 zig-zag
      out.copy(c).addScaledVector(_r, side * size * 0.5).addScaledVector(_f, (k - 0.5) * size * 0.6);
      const alpha = smooth(seg(uu, 0, 0.35)) * (1 - smooth(seg(uu, t1 + 0.45, t1 + 0.85)));
      const press = smooth(seg(uu, 0.35, 0.55)) * (1 - smooth(seg(uu, t1 + 0.15, t1 + 0.4)));
      if (k <= 0) out.copy(c).addScaledVector(_r, -size * 0.5).addScaledVector(_f, -size * 0.3);
      return { alpha, press };
    }
    // tap
    const A = point(tgt, out); if (!A) return null;
    const cyc = 2.4, uu = u % cyc;
    const alpha = smooth(seg(uu, 0, 0.35)) * (1 - smooth(seg(uu, 1.15, 1.5)));
    const press = smooth(seg(uu, 0.4, 0.55)) * (1 - smooth(seg(uu, 0.8, 0.98)));
    return { alpha, press };
  }

  let toBound = false;
  function bindLazy() { if (!toBound && cfg && cfg.gesture) { bindPoint(to, cfg.gesture.to); toBound = true; } }

  const hint = {
    get level() { return cfg ? level : -1; },
    get idle() { return idle; },
    active() { return !!cfg; },
    set(o) {
      if (cfg) stopWobble();
      if (!o) { hint.clear(); return; }
      cfg = Object.assign({ delay1: 3.5, delay2: 7.5 }, o);
      if (!cfg.gesture) cfg.gesture = { type: 'tap' };
      bindPoint(tgt, cfg.target);
      toBound = false;
      if (cfg.gesture.type === 'drag') bindLazy();
      idle = 0; level = 0; t = 0; glintT = GLINT_PERIOD * 0.4; burstT = 0;
      hideGhost();
    },
    clear() {
      if (cfg) stopWobble();
      cfg = null; level = 0; idle = 0;
      hideGhost();
      spot.intensity = 0; lightK = 0;
    },
    nudge() {
      if (!cfg) return;
      idle = 0;
      if (level > 0) stopWobble();
      level = 0; hideGhost();
    },
    pointerDown() {
      if (!cfg) return;
      idle = 0;
      if (level > 0) stopWobble();
      level = 0; hideGhost();
    },
    update(dt, pointerDown) {
      if (!cfg) { spot.intensity = 0; ghost.visible = false; ring.visible = false; return; }
      t += dt;
      if (!pointerDown) idle += dt;
      const nl = idle >= cfg.delay2 ? 2 : idle >= cfg.delay1 ? 1 : 0;
      if (nl !== level) {
        if (nl === 0) { stopWobble(); hideGhost(); }
        if (nl >= 1 && level === 0) burstT = BURST_PERIOD; // first burst right away
        if (nl === 2) ghostT = 0;
        if (nl < 2) hideGhost();
        level = nl;
      }
      const P = point(tgt, _c);
      const pos = P ? _b.copy(P) : null;

      // --- attention light
      lightK = Math.min(1, lightK + dt / 0.5);
      if (pos) {
        camera.getWorldPosition(_cam);
        // from above, leaning toward the camera so the lit side is the side we see (also in side views)
        _v.copy(_cam).sub(pos); if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1); _v.normalize().multiplyScalar(0.75);
        _v.y += 0.9; _v.normalize();
        spot.position.copy(pos).addScaledVector(_v, 1.5);
        spot.target.position.copy(pos);
        spot.target.updateMatrixWorld();
        const d = spot.position.distanceTo(pos);
        const r = Math.max(0.07, tgt.radius * 1.25 + 0.04);
        spot.angle = Math.min(0.6, Math.max(0.04, Math.atan(r / d)));
        spot.penumbra = 0.9;
        const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 1.8);
        const base = level === 0 ? 0.7 + 0.4 * pulse : 1.1 + 0.6 * pulse;
        spot.intensity = base * d * d * lightK; // ~constant illuminance on the target
      } else spot.intensity = 0;

      // --- periodic glint
      if (pos && ctx.fx && typeof ctx.fx.sparkle === 'function') {
        glintT += dt;
        if (glintT >= GLINT_PERIOD) { glintT = 0; const gp = pos.clone(); guard(() => ctx.fx.sparkle(gp, { count: 1 }), 'fx.sparkle'); }
      }

      // --- level 1+: wobble bursts + cue
      if (level >= 1 && !pointerDown) {
        burstT += dt;
        if (burstT >= BURST_PERIOD) {
          burstT = 0; burstOn = true;
          if (typeof cfg.cue === 'function') guard(() => cfg.cue(), 'hint.cue');
        }
        if (burstOn) {
          const u = burstT / BURST_LEN;
          if (u >= 1) { burstOn = false; if (wobbling) { callFn(cfg.wobble)(0, t); wobbling = false; } }
          else if (cfg.wobble) { wobbling = true; callFn(cfg.wobble)(Math.max(0.001, Math.sin(Math.PI * u)), t); }
        }
      }

      // --- level 2: ghost finger
      if (level === 2 && !pointerDown && cfg) {
        ghostT += dt;
        const tip = new THREE.Vector3();
        const pose = ghostPose(ghostT, tip);
        if (pose && pose.alpha > 0.001) {
          const wpp = worldPerPx(tip);
          _r.setFromMatrixColumn(camera.matrixWorld, 0);
          _u.setFromMatrixColumn(camera.matrixWorld, 1);
          const lift = 1 - pose.press;
          ghost.position.copy(tip).addScaledVector(_u, lift * 16 * wpp).addScaledVector(_r, lift * 9 * wpp);
          const s = GHOST_PX * wpp * (1 + 0.1 * lift);
          ghost.scale.set(s * hand.aspect, s, 1);
          ghostMat.opacity = GHOST_OPACITY * pose.alpha * (0.85 + 0.15 * pose.press);
          ghost.visible = true;
          if (pose.press > 0.9 && prevPress <= 0.9) { ringT = 0; ringPos.copy(tip); }
          prevPress = pose.press;
        } else { ghost.visible = false; prevPress = pose ? pose.press : 0; }
        if (ringT >= 0) {
          ringT += dt;
          const k = ringT / 0.6;
          if (k >= 1) { ringT = -1; ring.visible = false; }
          else {
            const wpp = worldPerPx(ringPos);
            const px = 22 + 46 * ease('out', k);
            ring.position.copy(ringPos);
            ring.scale.set(px * wpp, px * wpp, 1);
            ringMat.opacity = 0.7 * (1 - k) * (1 - k);
            ring.visible = true;
          }
        }
      }
    },
  };
  return hint;
}
