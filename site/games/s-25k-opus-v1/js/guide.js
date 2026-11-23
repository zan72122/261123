// guide.js — 次に触る物を一つだけ光らせ、小さく弾ませる。約4秒触らなければ半透明の指が手本を見せる
(function () {
  'use strict';
  var KK = window.KK, T = THREE, C = KK.C;
  var GD = (KK.guide = { idle: 0, cur: null, demo: null, demoT: 0, nextDemo: 4.0, bounceT: 0 });
  var v = new T.Vector3(), v2 = new T.Vector3(), ax = new T.Vector3(), up = new T.Vector3(0, 1, 0);

  GD.init = function () {
    var g = (GD.finger = new T.Group());
    var mat = KK.world.mats.ghost;
    var tipR = 0.85, len = 2.6;
    var body = new T.Mesh(new T.CapsuleGeometry(tipR, len, 8, 16), mat);
    body.position.y = len / 2 + tipR;
    g.add(body);
    // 爪のあたりのわずかな光り（同じ半透明の素材を少し平たく）
    var nail = new T.Mesh(new T.SphereGeometry(tipR * 0.62, 14, 10), mat);
    nail.scale.set(1, 1.3, 0.35);
    nail.position.set(0, tipR + 0.55, tipR * 0.72);
    g.add(nail);
    g.visible = false;
    g.renderOrder = 10;
    KK.world.scene.add(g);
    GD.mat = mat;
  };

  // 一回目のタップが空振りでも、次に触る物が弾んで応える
  GD.touched = function (hit) {
    GD.idle = 0;
    GD.nextDemo = 4.0;
    if (GD.demo) { GD.demo = null; GD.finger.visible = false; }
    if (!hit && GD.cur && GD.cur.part) { GD.cur.part.hop.v += 7; GD.cur.part.glow = 1; }
    if (!hit && GD.cur && GD.cur.ball) { GD.ballHop = 1; }
  };

  function freePortOfCourseEnd() {
    // いちばん下流の開いた出口（出発台から辿る）
    var start = (KK.parts.byKind.start || [])[0];
    if (!start) return null;
    var p = start.ports[0], seen = new Set();
    for (var k = 0; k < 12; k++) {
      if (!p.joint) return p;
      var o = p.joint.other(p);
      var part = o.part;
      if (seen.has(part)) return null;
      seen.add(part);
      var nxt = part.ports.filter(function (q) { return q !== o; })[0];
      if (!nxt) return null;
      p = nxt;
    }
    return null;
  }

  function chooseTarget() {
    var B = KK.ball, PS = KK.parts, S = KK.state;
    var start = PS.byKind.start[0];
    var corner = PS.byKind.corner[0];
    // 1. 出発台と曲がり角の間に坂を渡す
    if (!start.ports[0].joint) {
      var cands = (PS.byKind.straight || []).filter(function (p) { return !KK.track.jointCount(p); });
      var r = S.ramp1 && cands.indexOf(S.ramp1) >= 0 ? S.ramp1 : cands[0];
      if (r) {
        var sp = start.ports[0];
        var to = v.set(sp.wx, sp.wy, sp.wz);
        var cA = corner && !corner.ports[0].joint ? corner.ports[0] : null;
        if (cA) to.set((sp.wx + cA.wx) / 2, Math.max(sp.wy, cA.wy) * 0.5 + 2, (sp.wz + cA.wz) / 2);
        else to.set(sp.wx + 10, sp.wy - 2, sp.wz);
        return { part: r, from: r.group.position.clone().add(new T.Vector3(0, 1.5, 0)), to: to.clone() };
      }
    }
    if (B.isMoving() || B.mode === 'held') return null;
    // 2. 玉を出発台の頭へ
    var onHead = B.mode === 'path' && B.part === start && B.s < 2.5;
    if (!onHead && (S.runs < 2 || B.mode !== 'path')) {
      start.sample(1.0, v2);
      var head = new T.Vector3(v2.x, v2.y + C.R + 1, v2.z);
      if (S.runs >= 2) {
        // 慣れてきたら次の部品も
        var nx = nextPart();
        if (nx && S.runs % 2 === 0) return nx;
      }
      return { ball: true, from: B.pos.clone(), to: head };
    }
    var n = nextPart();
    if (n) return n;
    return { part: start, knob: true, from: start.kprox.getWorldPosition(new T.Vector3()), to: start.kprox.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 4, 0)) };
  }

  function nextPart() {
    var PS = KK.parts;
    var order = ['spiral', 'chute', 'straight'];
    var endPort = freePortOfCourseEnd();
    for (var i = 0; i < order.length; i++) {
      var list = PS.byKind[order[i]] || [];
      for (var k = 0; k < list.length; k++) {
        var p = list[k];
        if (p.state !== 'stowed') continue;
        var to;
        if (endPort) {
          var d = KK.dirVec(endPort.wa);
          to = new T.Vector3(endPort.wx + d.x * 4, endPort.wy, endPort.wz + d.z * 4);
        } else to = new T.Vector3(16, 3, 12);
        return { part: p, from: p.group.position.clone().add(new T.Vector3(0, p.kind === 'spiral' ? 6 : 1.5, 0)), to: to };
      }
    }
    return null;
  }

  GD.update = function (dt) {
    var S = KK.state;
    var interacting = !!KK.input.a;
    if (interacting) GD.idle = 0; else GD.idle += dt;
    // 目標を選び直す（指の手本の最中は固定）
    GD.pickT = (GD.pickT || 0) - dt;
    if (!GD.demo && GD.pickT <= 0) {
      GD.cur = chooseTarget();
      GD.pickT = 0.4;
    }
    KK.parts.list.forEach(function (p) { p.glowT = 0; });
    var ballGlow = 0;
    var showGlow = !interacting && GD.idle > 1.2;
    if (GD.cur && showGlow) {
      if (GD.cur.part) GD.cur.part.glowT = 1;
      if (GD.cur.ball) ballGlow = 1;
      // ときどき小さく弾む
      GD.bounceT += dt;
      if (GD.bounceT > 2.4) {
        GD.bounceT = 0;
        if (GD.cur.part && GD.cur.part.state !== 'carry') GD.cur.part.hop.v += 4.5;
        if (GD.cur.ball) GD.ballHop = 1;
      }
    }
    // 玉の光と弾み
    var bm = KK.ball.mat;
    if (!bm.emissive) bm.emissive = new T.Color();
    bm.emissive.setHex(0xffd9a0);
    GD.ballGlow = KK.damp(GD.ballGlow || 0, ballGlow, 4, dt);
    bm.emissiveIntensity = GD.ballGlow * (0.1 + 0.08 * Math.sin(S.time * 3.2));
    if (GD.ballHop) {
      GD.ballHop = Math.max(0, GD.ballHop - dt * 2.2);
      if (KK.ball.mode === 'rest' || (KK.ball.mode === 'path' && !KK.ball.isMoving()) || (KK.ball.mode === 'ground' && !KK.ball.isMoving())) {
        KK.ball.mesh.position.y += Math.sin((1 - GD.ballHop) * Math.PI) * 0.7 * GD.ballHop;
      }
    }
    // 指の手本
    if (!GD.demo && GD.cur && !interacting && GD.idle > GD.nextDemo) {
      GD.demo = { t: 0, from: GD.cur.from.clone(), to: GD.cur.to.clone(), knob: !!GD.cur.knob };
      GD.nextDemo = GD.idle + 7.5;
    }
    if (GD.demo) playDemo(dt);
  };

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function playDemo(dt) {
    var d = GD.demo, f = GD.finger;
    d.t += dt;
    var t = d.t;
    var appear = 0.55, press = 0.3, move = 1.5, lift = 0.6;
    var tip = v, op = 0;
    if (t < appear) {
      var k = t / appear;
      tip.copy(d.from).addScaledVector(up, (1 - ease(k)) * 4);
      op = k;
    } else if (t < appear + press) {
      tip.copy(d.from).addScaledVector(up, -0.25 * Math.sin((t - appear) / press * Math.PI * 0.5));
      op = 1;
    } else if (t < appear + press + move) {
      var k2 = ease((t - appear - press) / move);
      tip.lerpVectors(d.from, d.to, k2).addScaledVector(up, Math.sin(k2 * Math.PI) * (d.knob ? 0 : 1.5) - 0.25);
      op = 1;
    } else if (t < appear + press + move + lift) {
      var k3 = (t - appear - press - move) / lift;
      tip.copy(d.to).addScaledVector(up, ease(k3) * 3);
      op = 1 - k3;
    } else {
      GD.demo = null; f.visible = false; return;
    }
    f.visible = true;
    f.position.copy(tip);
    // 指先が物に触れ、根元はカメラの側へ
    var cam = KK.cam.camera;
    ax.copy(cam.position).sub(tip).normalize().multiplyScalar(0.55).add(v2.set(0, 0.8, 0)).normalize();
    f.quaternion.setFromUnitVectors(up, ax);
    GD.mat.opacity = 0.34 * op;
  }
})();
