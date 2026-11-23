// guide.js — 次に触る物を一つだけ光らせて弾ませる。約4秒さわらなければ半透明の指が手本を見せる
(function () {
  'use strict';
  var G = window.G;
  var V3 = THREE.Vector3;
  var U = (G.guide = { hint: null, t: 0, ghostT: -1, applied: null, appliedY: 0 });

  U.init = function (scene) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.6, 8, 18), G.mat.ghost);
    body.position.y = 0.5 + 1.3;
    body.scale.set(1, 1, 0.86);
    g.add(body);
    var nail = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), G.mat.ghostNail);
    nail.scale.set(1, 1.35, 0.35);
    nail.position.set(0, 0.62, 0.38);
    g.add(nail);
    g.visible = false;
    g.renderOrder = 10;
    g.traverse(function (o) { if (o.isMesh) { o.renderOrder = 10; o.castShadow = false; o.receiveShadow = false; } });
    scene.add(g);
    U.finger = g;
  };

  U.targetPick = function () { return U.hint ? U.hint.ref : null; };

  // 前のフレームで足した弾みを戻す（各部品の更新の前に呼ぶ）
  U.pre = function () {
    if (U.applied) { U.applied.position.y -= U.appliedY; U.applied = null; U.appliedY = 0; }
  };

  function setGlow(h, v) {
    if (!h || !h.mats) return;
    h.mats.forEach(function (m) {
      if (!m.emissive) return;
      m.emissive.setRGB(1.0, 0.82, 0.5);
      m.emissiveIntensity = v;
    });
  }

  U.setHint = function (h) {
    if (h && U.hint && h.ref === U.hint.ref) { U.hint.gesture = h.gesture; U.hint.mats = h.mats; U.hint.bounceObj = h.bounceObj; U.hint.kick = h.kick; return; }
    if (U.hint) setGlow(U.hint, 0);
    U.hint = h;
    U.t = 0;
    U.ghostT = -1;
  };

  U.update = function (dt, idle) {
    var h = U.hint;
    U.t += dt;
    if (h) {
      // 光：ゆっくり明滅
      var pulse = 0.5 + 0.5 * Math.sin(U.t * 3.2);
      setGlow(h, 0.06 + 0.16 * pulse);
      // 弾み：一・八秒ごとに小さく二回
      var ph = U.t % 1.8;
      var hop = ph < 0.5 ? Math.abs(Math.sin(ph / 0.5 * Math.PI * 2)) * (ph < 0.25 ? 0.14 : 0.07) : 0;
      if (h.bounceObj && !G.input.down) {
        U.applied = h.bounceObj; U.appliedY = hop;
        h.bounceObj.position.y += hop;
      }
      if (h.kick && ph < dt * 1.01 && !G.input.down) h.kick();
    }
    // 半透明の指
    var f = U.finger;
    if (h && h.gesture && idle > 4.0 && !G.input.down) {
      if (U.ghostT < 0) U.ghostT = 0;
      U.ghostT += dt;
      showFinger(h.gesture, U.ghostT % 3.2);
    } else {
      U.ghostT = -1;
      if (f.visible) { G.mat.ghost.opacity = G.damp(G.mat.ghost.opacity, 0, 12, dt); G.mat.ghostNail.opacity = G.mat.ghost.opacity * 0.8; if (G.mat.ghost.opacity < 0.01) f.visible = false; }
    }
  };

  function pathAt(g, t) {
    if (g.path) return g.path(t);
    var a = g.from(), b = g.to();
    var p = new V3().lerpVectors(a, b, t);
    p.y += Math.sin(t * Math.PI) * (g.arc || 0);
    return p;
  }

  function showFinger(g, t) {
    var f = U.finger;
    f.visible = true;
    var op, press = 0, k;
    if (t < 0.35) { op = t / 0.35; k = 0; }
    else if (t < 0.6) { op = 1; k = 0; press = (t - 0.35) / 0.25; }
    else if (t < 1.95) { op = 1; press = 1; k = G.easeInOut((t - 0.6) / 1.35); }
    else if (t < 2.3) { op = 1 - (t - 1.95) / 0.35; press = 1 - (t - 1.95) / 0.35; k = 1; }
    else { op = 0; k = 1; }
    var tip = pathAt(g, k);
    var cam = G.stage.camera;
    var dist = cam.position.distanceTo(tip);
    var s = dist * 0.026;
    var axis = cam.position.clone().sub(tip).normalize().add(new V3(0, 0.5, 0)).normalize();
    f.quaternion.setFromUnitVectors(new V3(0, 1, 0), axis);
    f.position.copy(tip).addScaledVector(axis, (0.25 - press * 0.22) * s);
    f.scale.set(s, s * (1 - press * 0.06), s);
    G.mat.ghost.opacity = 0.38 * op;
    G.mat.ghostNail.opacity = 0.3 * op;
  }
})();
