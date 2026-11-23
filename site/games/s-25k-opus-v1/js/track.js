// track.js — 継ぎ目、高さの連動、近づいたときの向きそろえと吸い付き
(function () {
  'use strict';
  var KK = window.KK, C = KK.C;
  var TR = (KK.track = { joints: [] });

  function Joint(a, b, owner) {
    this.a = a; this.b = b; this.owner = owner || a;
    a.joint = this; b.joint = this;
  }
  Joint.prototype.other = function (p) { return p === this.a ? this.b : this.a; };
  TR.Joint = Joint;

  TR.join = function (a, b, owner) {
    if (a.joint) TR.unjoin(a.joint);
    if (b.joint) TR.unjoin(b.joint);
    var j = new Joint(a, b, owner);
    TR.joints.push(j);
    j.owner.flap.ang.v += 6;   // 重なった木の端が一度だけはね返る
    return j;
  };
  TR.unjoin = function (j) {
    if (!j) return;
    if (j.a.joint === j) j.a.joint = null;
    if (j.b.joint === j) j.b.joint = null;
    var i = TR.joints.indexOf(j);
    if (i >= 0) TR.joints.splice(i, 1);
  };
  TR.unjoinPart = function (part) {
    var n = 0;
    part.ports.forEach(function (p) { if (p.joint) { TR.unjoin(p.joint); n++; } });
    return n;
  };
  TR.jointCount = function (part) {
    var n = 0;
    part.ports.forEach(function (p) { if (p.joint) n++; });
    return n;
  };

  // ── 高さの連動（継いだ場所を共有する端は一緒に動く） ──
  TR.group = function (dof) {
    var set = [dof], seen = new Set([dof]);
    for (var k = 0; k < set.length; k++) {
      var d = set[k];
      var ports = d.part.ports;
      for (var i = 0; i < ports.length; i++) {
        var p = ports[i];
        if (p.dof !== d || !p.joint) continue;
        var o = p.joint.other(p);
        if (!seen.has(o.dof)) { seen.add(o.dof); set.push(o.dof); }
      }
    }
    return set;
  };
  TR.range = function (group) {
    var lo = -1e9, hi = 1e9, inG = new Set(group);
    for (var i = 0; i < group.length; i++) {
      var d = group[i];
      if (d.fixed) { lo = Math.max(lo, 0); hi = Math.min(hi, 0); continue; }
      lo = Math.max(lo, d.min - d.h); hi = Math.min(hi, d.max - d.h);
      if (d.part.kind === 'straight') {
        var od = d.part.dofs[1 - d.i];
        if (!inG.has(od)) {
          lo = Math.max(lo, od.h - C.MAX_DH - d.h);
          hi = Math.min(hi, od.h + C.MAX_DH - d.h);
        }
      }
    }
    return [lo, hi];
  };
  // 群を delta だけ動かす（はみ出したら止める）。実際に動いた量を返す
  TR.moveGroup = function (group, delta) {
    var r = TR.range(group);
    var d = KK.clamp(delta, Math.min(r[0], 0), Math.max(r[1], 0));
    for (var i = 0; i < group.length; i++) if (!group[i].fixed) group[i].h += d;
    return d;
  };

  // ── 近づいたときの吸い付き ──
  var tA = {}, tB = {}, tC = {};
  function freeTargets(part) {
    var out = [];
    var list = KK.parts.list;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === part || o.state !== 'active') continue;
      for (var k = 0; k < o.ports.length; k++) if (!o.ports[k].joint) out.push(o.ports[k]);
    }
    return out;
  }
  function targetPose(q) {
    var o = q.part;
    return { x: q.wx, z: q.wz, a: q.wa };
  }

  // pose: 指が求める姿勢。戻り値 {pose, joins, near, w}
  TR.findSnap = function (part, pose) {
    var res = { pose: { x: pose.x, z: pose.z, yaw: pose.yaw }, joins: [], near: [], w: 0 };
    var targets = freeTargets(part);
    var best = null, bestD = C.ALIGN_R;
    for (var i = 0; i < part.ports.length; i++) {
      var p = part.ports[i];
      if (p.joint) continue;
      var pp = part.portAt(p, pose, tA);
      for (var k = 0; k < targets.length; k++) {
        var q = targets[k];
        var d = Math.hypot(pp.x - q.wx, pp.z - q.wz);
        // 向きの差が大きすぎるもの（真横から）は少し遠く扱う
        var yawAl = q.wa + Math.PI - p.la;
        var dy = Math.abs(KK.wrapAngle(yawAl - pose.yaw));
        var eff = d + dy * 1.2;
        if (eff < bestD) { bestD = eff; best = { p: p, q: q, d: d, yawAl: yawAl }; }
      }
    }
    if (!best) return res;
    var p0 = best.p, q0 = best.q, d0 = best.d;
    var w = 1 - KK.smooth(C.SNAP_R, C.ALIGN_R, d0);
    res.w = w;
    var newYaw = pose.yaw + KK.wrapAngle(best.yawAl - pose.yaw) * w;
    // p の位置を軸に回す
    var pp0 = part.portAt(p0, pose, tA);
    var cx = pose.x - pp0.x, cz = pose.z - pp0.z;
    var r = KK.rotXZ(cx, cz, newYaw - pose.yaw, tB);
    var np = { x: pp0.x + r.x, z: pp0.z + r.z, yaw: newYaw };
    if (d0 < C.SNAP_R) {
      np.yaw = best.yawAl;
      var pn = part.portAt(p0, np, tC);
      np.x += q0.wx - pn.x; np.z += q0.wz - pn.z;
      res.joins.push({ p: p0, q: q0 });
      // もう一方の端も届いていれば一緒に継ぐ
      var used = [q0];
      for (i = 0; i < part.ports.length; i++) {
        var p2 = part.ports[i];
        if (p2 === p0 || p2.joint) continue;
        var pp2 = part.portAt(p2, np, tA);
        for (k = 0; k < targets.length; k++) {
          var q2 = targets[k];
          if (used.indexOf(q2) >= 0 || q2.part === q0.part && false) continue;
          var d2 = Math.hypot(pp2.x - q2.wx, pp2.z - q2.wz);
          var da = Math.abs(KK.wrapAngle(pp2.a - (q2.wa + Math.PI)));
          if (d2 < C.SNAP_R * 1.25 && da < 0.5) { res.joins.push({ p: p2, q: q2 }); used.push(q2); break; }
        }
      }
    } else if (d0 < C.NEAR_R) {
      res.near.push({ p: p0, q: q0, d: d0 });
    }
    res.pose = np;
    return res;
  };

  // 継いだときの高さ合わせができるか、した結果の高さ
  TR.commit = function (part, joins) {
    var done = [];
    var assigned = new Set();
    for (var i = 0; i < joins.length; i++) {
      var p = joins[i].p, q = joins[i].q;
      var qh = q.part.portHeight(q, true);
      var ok = false;
      if (!p.dof.fixed && !assigned.has(p.dof)) {
        var t = qh - p.off;
        var lo = p.dof.min, hi = p.dof.max;
        if (part.kind === 'straight') {
          var od = part.dofs[1 - p.dof.i];
          if (assigned.has(od)) { lo = Math.max(lo, od.h - C.MAX_DH); hi = Math.min(hi, od.h + C.MAX_DH); }
        }
        if (t >= lo - 1e-3 && t <= hi + 1e-3) {
          p.dof.h = KK.clamp(t, p.dof.min, p.dof.max);
          assigned.add(p.dof); ok = true;
        }
      }
      if (!ok) {
        // 相手の側の高さを合わせる
        var grp = TR.group(q.dof);
        if (grp.indexOf(p.dof) < 0) {
          var delta = part.portHeight(p, true) - qh;
          var r = TR.range(grp);
          if (delta >= r[0] - 1e-3 && delta <= r[1] + 1e-3) {
            TR.moveGroup(grp, delta); ok = true;
          }
        }
      }
      if (ok) { TR.join(p, q, p); done.push(joins[i]); }
    }
    // 両端を継いだまっすぐな坂の傾きが大きすぎたら、後の継ぎ目を外す
    if (part.kind === 'straight' && Math.abs(part.dofs[0].h - part.dofs[1].h) > C.MAX_DH + 0.01) {
      var last = done.pop();
      if (last) TR.unjoin(last.p.joint);
      var d0 = part.dofs[0], d1 = part.dofs[1];
      if (d1.h > d0.h) d1.h = d0.h + C.MAX_DH; else d1.h = d0.h - C.MAX_DH;
    }
    return done;
  };

  // 継いだ端を軸に回す：ずれ角の許容
  TR.SWING_MAX = 0.75;
  TR.swingYaw = function (part, pj, yaw) {
    var o = pj.joint.other(pj);
    var want = o.wa + Math.PI - pj.la;
    var dev = KK.clamp(KK.wrapAngle(yaw - want), -TR.SWING_MAX, TR.SWING_MAX);
    return { yaw: want + dev, hit: Math.abs(KK.wrapAngle(yaw - want)) > TR.SWING_MAX };
  };
  // 継いだ端が pivot に留まるような中心
  TR.poseAbout = function (part, pj, pivot, yaw) {
    var r = KK.rotXZ(pj.lx, pj.lz, yaw, tA);
    return { x: pivot.x - r.x, z: pivot.z - r.z, yaw: yaw };
  };
})();
