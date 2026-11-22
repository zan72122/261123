// Drying props: hand-crank spin dryer (手回し脱水機), laundry pole on two stands (物干し竿 + 物干し台),
// straight pinch hanger with three spring clothespins (洗濯ばさみ).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from './layout.js';
// smooth-shade an extrusion's sides (caps stay split by their UVs)
function smoothX(g) { const m = mergeVertices(g, 1e-5); m.computeVertexNormals(); g.dispose(); return m; }

const TAU = Math.PI * 2;
const V = (x, y) => new THREE.Vector2(x, y);
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvasTex(w, h, draw, { srgb = true, repeat = null, clamp = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (!clamp) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
function noiseFill(g, w, h, base, amp, seed, blob = 0) {
  const r = rng(seed); const img = g.createImageData(w, h); const d = img.data;
  for (let i = 0; i < w * h; i++) { const v = base + (r() - 0.5) * amp; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < blob; i++) {
    const x = r() * w, y = r() * h, rad = 4 + r() * w * 0.12, a = 0.03 + r() * 0.05;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const c = r() < 0.5 ? '255,255,255' : '0,0,0';
    gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

// ---------- shared textures (built once) ----------
let TX = null;
function textures() {
  if (TX) return TX;
  TX = {};
  // moulded plastic: faint mottling in roughness
  TX.plasticRough = canvasTex(128, 128, (g, w, h) => noiseFill(g, w, h, 225, 40, 7, 40), { srgb: false, repeat: [3, 3] });
  // perforated basket wall tile: one round hole per tile, slight dished rim
  TX.hole = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#f1efe9'; g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(32, 32, 18, 32, 32, 29);
    gr.addColorStop(0, 'rgba(150,148,140,0.55)'); gr.addColorStop(1, 'rgba(150,148,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(32, 32, 20, 0, TAU); g.fill();
  }, { repeat: [56, 11] });
  // basket floor: concentric rings of holes
  TX.floor = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#efede7'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let ring = 0; ring < 6; ring++) {
      const rr = 100 + ring * 27; const n = Math.round(TAU * rr / 26);
      for (let i = 0; i < n; i++) { const a = (i + ring * 0.5) / n * TAU; g.beginPath(); g.arc(256 + Math.cos(a) * rr, 256 + Math.sin(a) * rr, 7.5, 0, TAU); g.fill(); }
    }
  }, { clamp: true });
  // blurred spinning wall: horizontal averaged bands of hole rows
  TX.blur = canvasTex(4, 256, (g, w, h) => {
    const img = g.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) {
      const v = 1 - (y + 0.5) / h; const hy = v * 0.22; // height in basket wall (0 = bottom)
      let a = 1;
      if (hy > 0.02 && hy < 0.20) { const rowPos = (hy - 0.02) / 0.18 * 11; const dy = (rowPos % 1) - 0.5; const rr = 20 / 64; a = dy * dy < rr * rr ? 1 - 2 * Math.sqrt(rr * rr - dy * dy) * 0.92 : 1; }
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = 240; d[i + 1] = 238; d[i + 2] = 232; d[i + 3] = a * 255; }
    }
    g.putImageData(img, 0, 0);
  });
  // water thrown against the clear wall: horizontal flying streaks
  TX.fly = canvasTex(512, 256, (g, w, h) => {
    const r = rng(31);
    for (let i = 0; i < 150; i++) {
      const x = r() * w, y = r() * h, len = 14 + r() * 70, th = 0.7 + r() * 1.4;
      const gr = g.createLinearGradient(x, 0, x + len, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.8, 'rgba(235,245,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + len / 2, y, len / 2, th, 0, 0, TAU); g.fill();
    }
  }, { repeat: [2, 1] });
  // water running down the wall: trails + beads
  TX.run = canvasTex(512, 256, (g, w, h) => {
    const r = rng(77);
    for (let i = 0; i < 60; i++) {
      let x = r() * w; const y0 = r() * h, len = 30 + r() * 140, th = 1.2 + r() * 2.2;
      g.strokeStyle = `rgba(230,240,250,${0.25 + r() * 0.3})`; g.lineWidth = th; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y0);
      for (let s = 0; s < len; s += 6) { x += (r() - 0.5) * 1.5; g.lineTo(x, y0 + s); }
      g.stroke();
      const yb = y0 + len;
      const gr = g.createRadialGradient(x - 1, yb - 1, 0, x, yb, th * 2.2);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(220,235,245,0.6)'); gr.addColorStop(1, 'rgba(120,140,150,0.0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, yb, th * 2.2, 0, TAU); g.fill();
    }
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, rad = 0.8 + r() * 2.6;
      const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(200,215,225,0.45)'); gr.addColorStop(1, 'rgba(90,100,110,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
  }, { repeat: [3, 1] });
  // ripples (puddle normal-ish look via colour map with alpha)
  TX.ripple = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(200,214,222,1)'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, rad = 6 + r() * 40; g.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.25})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.stroke(); }
  }, { repeat: [1, 1] });
  TX.splash = canvasTex(128, 128, (g, w, h) => {
    for (let k = 0; k < 4; k++) { g.strokeStyle = `rgba(240,248,255,${0.7 - k * 0.15})`; g.lineWidth = 3 - k * 0.5; g.beginPath(); g.arc(64, 64, 14 + k * 13, 0, TAU); g.stroke(); }
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 18); gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { clamp: true });
  TX.wet = canvasTex(128, 128, (g, w, h) => {
    const r = rng(9);
    for (let i = 0; i < 18; i++) { const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 12 + r() * 30; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(30,28,25,0.5)'); gr.addColorStop(0.7, 'rgba(30,28,25,0.35)'); gr.addColorStop(1, 'rgba(30,28,25,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  }, { clamp: true });
  // brushed stainless: streaks along the tube length (texture v axis)
  TX.brushed = canvasTex(256, 16, (g, w, h) => {
    const r = rng(13);
    for (let x = 0; x < w; x++) { const v = 150 + (r() - 0.5) * 70 + (r() < 0.04 ? 60 : 0); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
  }, { srgb: false, repeat: [2, 1] });
  // concrete block
  TX.concrete = canvasTex(256, 256, (g, w, h) => {
    noiseFill(g, w, h, 160, 50, 21, 60);
    const r = rng(22);
    for (let i = 0; i < 400; i++) { const x = r() * w, y = r() * h, rad = 0.5 + r() * 1.6; g.fillStyle = `rgba(60,58,54,${0.3 + r() * 0.4})`; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(196,192,184)'; g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
  // painted steel (fine orange-peel)
  TX.paintRough = canvasTex(64, 64, (g, w, h) => noiseFill(g, w, h, 215, 50, 41, 10), { srgb: false, repeat: [4, 8] });
  return TX;
}

function plastic(color, rough = 0.42, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, roughnessMap: textures().plasticRough, ...extra });
}
function stainless(rough = 0.24) {
  return new THREE.MeshStandardMaterial({ color: 0xd6d9dc, metalness: 1, roughness: rough, roughnessMap: textures().brushed, envMapIntensity: 1.6 });
}
// Clear plastic: plain transparency, alpha raised at grazing angles and where reflections are bright.
function clearMat(color, opacity, side, edge = 0.55) {
  const m = new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity, roughness: 0.09, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    envMapIntensity: 2.4, depthWrite: false, side, ior: 1.58,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float fr = 1.0 - abs(dot(normalize(vViewPosition), normal)); fr = fr * fr * fr;
      vec3 sp = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      float sl = max(max(sp.r, sp.g), sp.b);
      diffuseColor.a = clamp(max(diffuseColor.a + fr * ${edge.toFixed(3)}, sl * 0.85), 0.0, 1.0);
    }
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'dryclear' + edge;
  return m;
}
function waterMat(opacity, map = null, color = 0xe2ecf1) {
  return new THREE.MeshStandardMaterial({ color, map, transparent: true, opacity, roughness: 0.04, metalness: 0, envMapIntensity: 2.6, depthWrite: false });
}
// Profiles are written top/inside first; reversed so LatheGeometry's normals and winding face outward.
function lathe(pts, seg = 64, keep = false) { const v = pts.map(p => V(p[0], p[1])); if (!keep) v.reverse(); return new THREE.LatheGeometry(v, seg); }
function mesh(geo, mat, cast = true, recv = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; return m; }
function tube(points, r, segs = 48, radial = 8, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5), segs, r, radial, closed);
}

// =====================================================================================
// 1. Hand-crank spin dryer
// =====================================================================================
export function createSpinner(ctx) {
  const T = textures();
  const ps = ctx && ctx.quality ? ctx.quality.particleScale || 1 : 1;
  const group = new THREE.Group(); group.name = 'spinner';
  const body = new THREE.Group(); group.add(body);           // vibrates
  const OUTER_R = 0.16, CRANK_R = 0.085;
  const TUB_Y0 = 0.052, TUB_TOP = 0.322;                    // clear tub wall 0.27 tall
  const LID_LOCAL_Y = 0.038;                                  // crank plane above tub rim
  const LID_Y = TUB_TOP + LID_LOCAL_Y;

  const white = plastic(0xeeebe3, 0.38);
  const whiteD = plastic(0xeeebe3, 0.38, { side: THREE.DoubleSide });
  const greyRub = plastic(0x55575a, 0.8);
  const orange = new THREE.MeshPhysicalMaterial({ color: 0xe8661c, roughness: 0.36, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, roughnessMap: T.plasticRough });

  // ---- base skirt + feet ----
  const baseProf = [[0.149, 0.062], [0.151, 0.066], [0.154, 0.0675], [0.166, 0.0682], [0.1695, 0.0675], [0.1718, 0.0655], [0.1728, 0.0625],
    [0.1732, 0.0475], [0.1736, 0.0465], [0.1722, 0.0458], [0.1722, 0.0438], [0.1738, 0.0431], [0.1742, 0.0245], [0.1736, 0.0215], [0.1716, 0.0192], [0.168, 0.0182], [0.0, 0.0182]];
  body.add(mesh(lathe(baseProf, 96), whiteD));
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) / 4 * TAU; const leg = new THREE.Group(); leg.position.set(Math.cos(a) * 0.138, 0, Math.sin(a) * 0.138);
    leg.add(mesh(lathe([[0, 0.0195], [0.0165, 0.0195], [0.0155, 0.012], [0.0145, 0.0054], [0, 0.0054]], 24), white));
    leg.add(mesh(new THREE.CylinderGeometry(0.0135, 0.014, 0.005, 24), greyRub).translateY(0.0029));
    body.add(leg);
  }
  // hold-down grip ears at ±X
  for (const sx of [-1, 1]) {
    const ear = mesh(new RoundedBoxGeometry(0.034, 0.011, 0.075, 3, 0.004), white); ear.position.set(sx * 0.181, 0.0615, 0); body.add(ear);
    const web = mesh(new RoundedBoxGeometry(0.016, 0.03, 0.006, 2, 0.002), white); web.position.set(sx * 0.178, 0.048, 0); body.add(web);
  }
  // drain spout on +Z, moulded with the base, angled slightly down
  const SPOUT_TILT = 0.2;
  const spout = new THREE.Group(); spout.position.set(0, 0.048, 0.168); spout.rotation.x = SPOUT_TILT; body.add(spout);
  const spoutLen = 0.052;
  const spOuter = mesh(lathe([[0.0125, 0], [0.0118, 0.01], [0.0108, spoutLen - 0.004], [0.0112, spoutLen - 0.0015], [0.0102, spoutLen], [0.0078, spoutLen], [0.0074, spoutLen - 0.003], [0.0074, 0.0]], 32, true), whiteD);
  spOuter.rotation.x = Math.PI / 2; spout.add(spOuter);
  const spIn = mesh(new THREE.CircleGeometry(0.0075, 24), new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.7 }), false, false);
  spIn.position.z = 0.012; spout.add(spIn);
  const boss = mesh(new THREE.SphereGeometry(0.019, 24, 12, 0, TAU, 0, Math.PI / 2), white); boss.rotation.x = Math.PI / 2; boss.scale.set(1, 0.5, 1); spout.add(boss);
  const spoutTipLocal = new THREE.Vector3(0, 0, spoutLen); // in spout frame

  // ---- clear tub ----
  const tubProf = [[0.0, TUB_Y0], [0.14, TUB_Y0], [0.148, TUB_Y0 + 0.003], [0.1515, TUB_Y0 + 0.010]];
  for (let y = TUB_Y0 + 0.018; y <= TUB_TOP - 0.012; y += 0.003) {
    const r = 0.1525 + (y - TUB_Y0) / (TUB_TOP - TUB_Y0) * 0.0035 + 0.0026 * Math.exp(-(((y - 0.15) / 0.0035) ** 2)) + 0.0026 * Math.exp(-(((y - 0.268) / 0.0035) ** 2));
    tubProf.push([r, y]);
  }
  tubProf.push([0.1565, TUB_TOP - 0.006], [0.158, TUB_TOP - 0.002], [0.16, TUB_TOP]);
  const tubGeo = lathe(tubProf, 96, true);
  const tint = 0xbcc6ca;
  const tubBack = mesh(tubGeo, clearMat(tint, 0.15, THREE.BackSide, 0.45), false, false); tubBack.renderOrder = 1;
  const tubFront = mesh(tubGeo, clearMat(tint, 0.15, THREE.FrontSide, 0.9), false, false); tubFront.renderOrder = 7;
  body.add(tubBack, tubFront);
  const rim = mesh(new THREE.TorusGeometry(0.1575, 0.0032, 10, 96), clearMat(0xd8dfe1, 0.45, THREE.FrontSide, 0.4), false, false);
  rim.rotation.x = Math.PI / 2; rim.position.y = TUB_TOP - 0.001; rim.renderOrder = 8; body.add(rim);

  // ---- basket (spins) ----
  const basket = new THREE.Group(); basket.name = 'spinBasket'; body.add(basket);
  const BR = 0.135, BY0 = 0.08, BY1 = 0.30;
  const holeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.hole, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.42, roughnessMap: T.plasticRough });
  const wall = mesh(new THREE.CylinderGeometry(BR, BR, 0.18, 96, 1, true), holeMat);
  wall.position.y = BY0 + 0.02 + 0.09; basket.add(wall);
  const bandLow = mesh(new THREE.CylinderGeometry(BR, BR - 0.002, 0.02, 96, 1, true), whiteD); bandLow.position.y = BY0 + 0.01; basket.add(bandLow);
  const bandTop = mesh(new THREE.CylinderGeometry(BR, BR, 0.02, 96, 1, true), whiteD); bandTop.position.y = BY1 - 0.01; basket.add(bandTop);
  const brim = mesh(lathe([[BR - 0.003, BY1 - 0.004], [BR - 0.002, BY1 + 0.003], [BR + 0.001, BY1 + 0.006], [BR + 0.006, BY1 + 0.005], [BR + 0.008, BY1 + 0.001], [BR + 0.007, BY1 - 0.003], [BR, BY1 - 0.006]], 96), whiteD);
  basket.add(brim);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.floor, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45 });
  const floor = mesh(new THREE.CircleGeometry(BR, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = BY0; basket.add(floor);
  basket.add(mesh(lathe([[0, BY0 + 0.03], [0.012, BY0 + 0.029], [0.018, BY0 + 0.022], [0.024, BY0 + 0.006], [0.03, BY0 + 0.001], [0.03, BY0 - 0.004], [0, BY0 - 0.004]], 32), white));
  const ribs = new THREE.Group(); basket.add(ribs);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU; const rb = mesh(new RoundedBoxGeometry(0.006, 0.2, 0.008, 2, 0.002), white);
    rb.position.set(Math.cos(a) * (BR + 0.002), (BY0 + BY1) / 2, Math.sin(a) * (BR + 0.002)); rb.rotation.y = -a; ribs.add(rb);
  }
  // shoe rest frames: sole against the wall, toe down, heel up, on opposite sides
  const slots = [];
  const SLOT_R = 0.127, SLOT_Y = BY0 + 0.095 + 0.006;
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI; const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const s = new THREE.Object3D(); s.name = 'spinSlot' + i;
    s.position.set(d.x * SLOT_R, SLOT_Y, d.z * SLOT_R);
    const Y = d.clone().negate(), Z = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3().crossVectors(Y, Z);
    s.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    basket.add(s); slots.push(s);
  }
  // motion-blur shell (fades in with speed)
  const blurGeo = new THREE.CylinderGeometry(BR + 0.0015, BR + 0.0015, BY1 - BY0, 96, 1, true);
  const blurMatB = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.blur, transparent: true, opacity: 0, roughness: 0.45, depthWrite: false, side: THREE.BackSide });
  const blurMatF = blurMatB.clone(); blurMatF.side = THREE.FrontSide;
  const blurB = mesh(blurGeo, blurMatB, false, true), blurF = mesh(blurGeo, blurMatF, false, true);
  blurB.position.y = blurF.position.y = (BY0 + BY1) / 2; blurB.renderOrder = 3; blurF.renderOrder = 4;
  body.add(blurB, blurF);

  // ---- water ----
  const WR = 0.1505;
  const runGeo = new THREE.CylinderGeometry(WR, WR, TUB_TOP - TUB_Y0 - 0.03, 96, 1, true);
  const flyGeo = new THREE.CylinderGeometry(WR - 0.0005, WR - 0.0005, 0.2, 96, 1, true);
  const mkW = (map, side, ro, geo, y) => { const m = mesh(geo, waterMat(0, map), false, false); m.material.side = side; m.renderOrder = ro; m.position.y = y; body.add(m); return m; };
  const runTexB = T.run, runTexF = T.run.clone(); runTexF.needsUpdate = true;
  const runB = mkW(runTexB, THREE.BackSide, 2, runGeo, (TUB_TOP + TUB_Y0) / 2 - 0.005);
  const runF = mkW(runTexF, THREE.FrontSide, 6, runGeo, (TUB_TOP + TUB_Y0) / 2 - 0.005);
  const flyB = mkW(T.fly, THREE.BackSide, 2, flyGeo, 0.19);
  const flyF = mkW(T.fly, THREE.FrontSide, 6, flyGeo, 0.19);
  const puddle = mesh(new THREE.CircleGeometry(0.151, 64), waterMat(0, T.ripple, 0xc2cdd2), false, false);
  puddle.rotation.x = -Math.PI / 2; puddle.renderOrder = 2; body.add(puddle);
  const meniscus = mesh(new THREE.CylinderGeometry(0.1515, 0.1515, 1, 96, 1, true), waterMat(0, null, 0xb9c8cf), false, false);
  meniscus.renderOrder = 5; body.add(meniscus);
  // flying droplets in the gap between basket and tub
  const NDROP = Math.round(90 * ps);
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0018, 6, 4), waterMat(0.85, null, 0xf0f6fa), NDROP);
  drops.renderOrder = 5; drops.frustumCulled = false; drops.count = 0; body.add(drops);
  const dr = rng(99); const dropState = [];
  for (let i = 0; i < NDROP; i++) dropState.push({ a: dr() * TAU, y: 0.1 + dr() * 0.19, t: dr(), life: 0.05 + dr() * 0.08 });

  // ---- spout stream + landing ----
  const NS = 18, NR = 8;
  const streamGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array((NS + 1) * (NR + 1) * 3);
  streamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const sIdx = []; for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const a = i * (NR + 1) + j, b = a + NR + 1; sIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  streamGeo.setIndex(sIdx);
  const stream = mesh(streamGeo, waterMat(0.72, null, 0xe6eef2), false, false); stream.frustumCulled = false; stream.renderOrder = 9; body.add(stream);
  const splash = mesh(new THREE.PlaneGeometry(0.06, 0.06), waterMat(0, T.splash, 0xf2f7fa), false, false);
  splash.rotation.x = -Math.PI / 2; splash.renderOrder = 9; body.add(splash);
  const wetSpot = mesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshStandardMaterial({ color: 0x1a1814, map: T.wet, transparent: true, opacity: 0, depthWrite: false, roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }), false, false);
  wetSpot.material.map.colorSpace = THREE.SRGBColorSpace;
  wetSpot.rotation.x = -Math.PI / 2; wetSpot.position.y = 0.0015; body.add(wetSpot);
  // stream centre line (local to body)
  const streamPts = [], streamTan = [];
  const landingLocal = new THREE.Vector3();
  {
    spout.updateMatrix();
    const p0 = spoutTipLocal.clone().applyMatrix4(spout.matrix);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(spout.quaternion);
    const v0 = dir.multiplyScalar(0.42);
    const tEnd = (v0.y + Math.sqrt(v0.y * v0.y + 2 * 9.8 * p0.y)) / 9.8;
    for (let i = 0; i <= NS; i++) {
      const t = tEnd * (i / NS) ** 0.85;
      streamPts.push(new THREE.Vector3(p0.x + v0.x * t, p0.y + v0.y * t - 4.9 * t * t, p0.z + v0.z * t));
      streamTan.push(new THREE.Vector3(v0.x, v0.y - 9.8 * t, v0.z).normalize());
    }
    streamPts[NS].y = 0.0005;
    landingLocal.copy(streamPts[NS]);
    splash.position.set(landingLocal.x, 0.002, landingLocal.z);
    wetSpot.position.x = landingLocal.x; wetSpot.position.z = landingLocal.z + 0.02;
  }

  // ---- lid with crank ----
  const lid = new THREE.Group(); lid.name = 'spinLid'; group.add(lid);
  lid.add(mesh(lathe([[0.084, 0.006], [0.0865, 0.0105], [0.0905, 0.0122], [0.118, 0.0128], [0.1195, 0.0142], [0.1235, 0.0142], [0.125, 0.0129], [0.158, 0.0128], [0.1625, 0.0122], [0.1655, 0.0102], [0.1668, 0.0068],
    [0.167, -0.0105], [0.1664, -0.0128], [0.1645, -0.0136], [0.1625, -0.013], [0.1615, -0.01], [0.1615, -0.002], [0.152, 0.0045], [0.092, 0.004], [0.084, 0.002]], 128), whiteD));
  const domeProf = []; for (let i = 0; i <= 12; i++) { const r = 0.087 * i / 12; domeProf.push([r, 0.008 + 0.018 * (1 - (r / 0.087) ** 2)]); }
  const domeGeo = lathe(domeProf, 64);
  const domeB = mesh(domeGeo, clearMat(tint, 0.12, THREE.BackSide, 0.3), false, false); domeB.renderOrder = 7;
  const domeF = mesh(domeGeo, clearMat(tint, 0.10, THREE.FrontSide, 0.6), false, false); domeF.renderOrder = 8;
  lid.add(domeB, domeF);
  {
    const sh = new THREE.Shape(); sh.moveTo(-0.152, 0.011); sh.lineTo(0.152, 0.011);
    sh.quadraticCurveTo(0.158, 0.011, 0.158, 0.016); sh.quadraticCurveTo(0.158, 0.021, 0.15, 0.021);
    sh.bezierCurveTo(0.1, 0.021, 0.07, 0.03, 0.04, 0.031); sh.lineTo(-0.04, 0.031); sh.bezierCurveTo(-0.07, 0.03, -0.1, 0.021, -0.15, 0.021);
    sh.quadraticCurveTo(-0.158, 0.021, -0.158, 0.016); sh.quadraticCurveTo(-0.158, 0.011, -0.152, 0.011);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.034, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 16 });
    bg.translate(0, 0, -0.017); lid.add(mesh(smoothX(bg), white));
  }
  lid.add(mesh(lathe([[0, 0.0338], [0.024, 0.0338], [0.0285, 0.0332], [0.0315, 0.031], [0.0325, 0.028], [0.0325, 0.016]], 48), white));
  // gear visible through the dome
  {
    const sh = new THREE.Shape(); const nT = 24;
    for (let i = 0; i <= nT * 4; i++) { const a = i / (nT * 4) * TAU; const r = (i % 4 < 2) ? 0.034 : 0.0305; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y); }
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.006, 0, TAU, true); sh.holes.push(hole);
    const gg = new THREE.ExtrudeGeometry(sh, { depth: 0.005, bevelEnabled: false }); gg.rotateX(-Math.PI / 2);
    const gear = mesh(gg, plastic(0xdedad2, 0.5)); gear.position.y = 0.006; lid.add(gear);
  }
  // latch tabs over the rim at ±X
  for (const sx of [-1, 1]) {
    const tab = mesh(new RoundedBoxGeometry(0.009, 0.036, 0.032, 2, 0.003), white); tab.position.set(sx * 0.1685, -0.008, 0); lid.add(tab);
    const lip = mesh(new RoundedBoxGeometry(0.012, 0.006, 0.03, 2, 0.002), white); lip.position.set(sx * 0.164, -0.024, 0); lid.add(lip);
  }
  for (const sx of [-1, 1]) { const sc = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 16), plastic(0xb8b8b4, 0.3)); sc.position.set(sx * 0.13, 0.0285, 0); lid.add(sc); }
  const crankCenter = new THREE.Object3D(); crankCenter.name = 'crankCenter'; crankCenter.position.y = LID_LOCAL_Y; lid.add(crankCenter);
  const arm = new THREE.Group(); crankCenter.add(arm);
  {
    const sh = new THREE.Shape(); const r0 = 0.0135, r1 = 0.0112, Lr = CRANK_R;
    sh.absarc(0, 0, r0, Math.PI / 2, Math.PI * 1.5, false);
    sh.lineTo(Lr, -r1); sh.absarc(Lr, 0, r1, -Math.PI / 2, Math.PI / 2, false); sh.lineTo(0, r0);
    const ag = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0018, bevelSize: 0.0018, bevelSegments: 3, curveSegments: 24 });
    ag.translate(0, 0, -0.004); ag.rotateX(-Math.PI / 2);
    arm.add(mesh(smoothX(ag), white));
  }
  const capH = mesh(lathe([[0, 0.0105], [0.009, 0.0105], [0.0125, 0.009], [0.0135, 0.0065], [0.0135, 0.0058]], 32), orange); arm.add(capH);
  const knob = new THREE.Object3D(); knob.name = 'crankKnob'; knob.position.set(CRANK_R, 0.0058 + 0.024, 0); arm.add(knob);
  {
    const kp = [[0, -0.024], [0.0125, -0.024], [0.0155, -0.0225], [0.017, -0.019], [0.0195, -0.016], [0.0208, -0.01], [0.021, 0.006], [0.0205, 0.014], [0.0192, 0.019], [0.0165, 0.0225], [0.011, 0.0245], [0, 0.025]];
    const kg = lathe(kp, 48, true);
    // shallow vertical grip flutes
    const pa = kg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); const r = Math.hypot(x, z); if (r < 0.019 || y > 0.016 || y < -0.017) continue; const a = Math.atan2(z, x); const f = 1 - 0.035 * Math.max(0, Math.cos(a * 16)) ** 4; pa.setX(i, x * f); pa.setZ(i, z * f); }
    kg.computeVertexNormals();
    knob.add(mesh(kg, orange));
    const pin = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.002, 16), plastic(0xd06018, 0.5)); pin.position.y = 0.0252; knob.add(pin);
  }

  // ---- state ----
  let omega = 0, spinAngle = 0, water = 0, spoutF = 0, lidOpen = 0, time = 0, wet = 0;
  const lidClosed = new THREE.Vector3(0, TUB_TOP, 0);
  const lidRest = new THREE.Vector3(0.37, 0.0312, 0.02); const LID_REST_ROT = 0.5;
  function placeLid() {
    const o = lidOpen; const s = smooth(0, 1, o);
    const sx = smooth(0.15, 0.9, o);
    lid.position.set(
      lidClosed.x + (lidRest.x - lidClosed.x) * sx + body.position.x * (1 - s),
      lidClosed.y + (lidRest.y - lidClosed.y) * s + 0.2 * Math.sin(Math.PI * Math.min(1, o * 1.15)) * (1 - 0.3 * s),
      lidClosed.z + (lidRest.z - lidClosed.z) * sx + body.position.z * (1 - s));
    lid.rotation.set(body.rotation.x * (1 - s), LID_REST_ROT * sx, body.rotation.z * (1 - s) - 0.28 * Math.sin(Math.PI * sx));
  }
  placeLid();
  function setLidOpen(o) { lidOpen = Math.min(1, Math.max(0, o)); placeLid(); }
  function setCrankAngle(a) { arm.rotation.y = a; }
  function setSpin(w) { omega = w; }
  function setWater(w) { water = Math.min(1, Math.max(0, w)); }
  function setSpout(f) { spoutF = Math.min(1, Math.max(0, f)); }
  function spoutLanding(out = new THREE.Vector3()) { group.updateWorldMatrix(true, false); return out.copy(landingLocal).applyMatrix4(group.matrixWorld); }

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  function update(dt) {
    time += dt;
    spinAngle = (spinAngle + omega * dt) % (TAU * 1000);
    basket.rotation.y = spinAngle;
    const sp = Math.abs(omega);
    // blur
    const b = smooth(11, 22, sp);
    blurMatB.opacity = blurMatF.opacity = b * 0.97;
    blurB.visible = blurF.visible = b > 0.001;
    wall.visible = b < 0.9; ribs.visible = b < 0.5;
    blurB.rotation.y = blurF.rotation.y = spinAngle;
    // vibration (unbalanced load)
    const k = (sp / 40) ** 2;
    const jitter = 0.0032 * k;
    body.position.set(Math.cos(spinAngle) * jitter + Math.sin(time * 53) * jitter * 0.35, Math.abs(Math.sin(spinAngle)) * jitter * 0.25, Math.sin(spinAngle) * jitter + Math.sin(time * 61.7) * jitter * 0.35);
    body.rotation.set(Math.sin(spinAngle) * 0.014 * k, 0, -Math.cos(spinAngle) * 0.014 * k);
    if (lidOpen < 1) placeLid();
    // water on the wall
    const dir = Math.sign(omega) || 1;
    const flyA = water * smooth(3, 14, sp);
    flyB.material.opacity = flyF.material.opacity = flyA * 0.6;
    flyB.visible = flyF.visible = flyA > 0.003;
    flyB.rotation.y = flyF.rotation.y = flyB.rotation.y + dir * Math.min(sp, 30) * 0.55 * dt;
    runB.material.opacity = runF.material.opacity = water * 0.85;
    runB.visible = runF.visible = water > 0.003;
    T.run.offset.y = (T.run.offset.y + dt * 0.12) % 1; runTexF.offset.y = (runTexF.offset.y + dt * 0.12) % 1; runTexF.offset.x = 0.37;
    runB.rotation.y = runF.rotation.y = runB.rotation.y + dir * Math.min(sp, 30) * 0.04 * dt;
    const depth = 0.012 + 0.018 * water;
    puddle.visible = meniscus.visible = water > 0.003;
    puddle.position.y = TUB_Y0 + depth; puddle.material.opacity = 0.55 * smooth(0, 0.2, water);
    puddle.rotation.z += dir * Math.min(sp, 30) * 0.15 * dt;
    meniscus.scale.y = depth; meniscus.position.y = TUB_Y0 + depth / 2; meniscus.material.opacity = 0.45 * smooth(0, 0.2, water);
    // droplets
    const nd = Math.round(NDROP * water * smooth(4, 14, sp));
    drops.count = nd; drops.visible = nd > 0;
    if (nd > 0) {
      const vt = sp * BR; const stretch = Math.min(10, Math.max(1, vt * 0.016 / 0.0036));
      for (let i = 0; i < nd; i++) {
        const d = dropState[i]; d.t += dt / d.life;
        if (d.t > 1) { d.t -= Math.floor(d.t); d.a = dr() * TAU; d.y = 0.1 + dr() * 0.19; d.life = 0.05 + dr() * 0.08; }
        const a = d.a + spinAngle + dir * d.t * 0.5;
        const r = BR + 0.003 + d.t * (WR - BR - 0.005);
        tmpP.set(Math.cos(a) * r, d.y - d.t * 0.004, Math.sin(a) * r);
        tmpQ.setFromAxisAngle(up, -a);
        tmpS.set(1, 1, stretch * (1 - 0.4 * d.t));
        tmpM.compose(tmpP, tmpQ, tmpS); drops.setMatrixAt(i, tmpM);
      }
      drops.instanceMatrix.needsUpdate = true;
    }
    // spout stream
    const f = spoutF * (0.86 + 0.1 * Math.sin(time * 9.3) + 0.05 * Math.sin(time * 23.1));
    stream.visible = spoutF > 0.01;
    if (stream.visible) {
      const R = 0.0052 * Math.sqrt(f);
      let vi = 0;
      for (let i = 0; i <= NS; i++) {
        const c = streamPts[i], tg = streamTan[i];
        nrm.set(1, 0, 0).cross(tg).normalize(); bin.crossVectors(tg, nrm);
        const s = i / NS;
        const r = R * (1 - 0.35 * s) * (1 + 0.18 * Math.sin(time * 38 - s * 14)) * (i === 0 ? 1.05 : 1);
        for (let j = 0; j <= NR; j++) {
          const a = j / NR * TAU; const ca = Math.cos(a) * r, sa = Math.sin(a) * r * 0.85;
          sPos[vi++] = c.x + nrm.x * ca + bin.x * sa; sPos[vi++] = c.y + nrm.y * ca + bin.y * sa; sPos[vi++] = c.z + nrm.z * ca + bin.z * sa;
        }
      }
      streamGeo.attributes.position.needsUpdate = true; streamGeo.computeVertexNormals();
    }
    splash.visible = spoutF > 0.01;
    splash.material.opacity = 0.55 * f; const ss = 0.7 + 0.3 * ((time * 3) % 1); splash.scale.set(ss, ss, 1); splash.rotation.z = time * 0.7;
    wet = Math.min(1, Math.max(0, wet + (spoutF * 0.5 - 0.02) * dt));
    wetSpot.material.opacity = 0.7 * wet; wetSpot.visible = wet > 0.002;
    const ws = 0.45 + 0.55 * wet; wetSpot.scale.set(ws, ws, 1);
  }
  update(0);
  return { group, OUTER_R, CRANK_R, LID_Y, basket, slots, knob, crankCenter, lid, setLidOpen, setCrankAngle, setSpin, setWater, setSpout, spoutLanding, update };
}

// =====================================================================================
// 2. Laundry pole on two stands (world coordinates)
// =====================================================================================
function makeHookGeo() {
  // U-cradle seen along Z, extruded along Z; pole centre at local (0, 0.031)
  const sh = new THREE.Shape();
  sh.moveTo(-0.028, 0); sh.lineTo(0.028, 0); sh.lineTo(0.028, 0.03);
  sh.quadraticCurveTo(0.028, 0.05, 0.022, 0.05); sh.lineTo(0.0215, 0.05);
  sh.quadraticCurveTo(0.017, 0.05, 0.0165, 0.04);
  sh.absarc(0, 0.031, 0.0158, Math.atan2(0.009, 0.0135), Math.PI - Math.atan2(0.009, 0.0135), true);
  sh.quadraticCurveTo(-0.017, 0.05, -0.0215, 0.05); sh.lineTo(-0.022, 0.05);
  sh.quadraticCurveTo(-0.028, 0.05, -0.028, 0.03); sh.lineTo(-0.028, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -0.013);
  return smoothX(g);
}
export function createPole(ctx) {
  const T = textures();
  const group = new THREE.Group(); group.name = 'laundryPole';
  const P = L.POLE; const R = 0.015;
  const steel = stainless(0.3);
  const len = P.maxZ - P.minZ;
  const poleGeo = new THREE.CylinderGeometry(R, R, len - 0.06, 48, 1, true); poleGeo.rotateX(Math.PI / 2);
  const pole = mesh(poleGeo, steel); pole.position.set(P.x, P.y, (P.minZ + P.maxZ) / 2); group.add(pole);
  const capMat = plastic(0xdfe2e3, 0.38);
  for (const e of [-1, 1]) {
    const cg = lathe([[0, 0.034], [0.006, 0.0335], [0.0125, 0.031], [0.0158, 0.026], [0.0168, 0.018], [0.0168, 0.004], [0.0162, 0.0], [R - 0.0005, 0.0], [R - 0.0005, -0.006]], 40);
    cg.rotateX(e > 0 ? Math.PI / 2 : -Math.PI / 2);
    const cap = mesh(cg, capMat); cap.position.set(P.x, P.y, e > 0 ? P.maxZ - 0.034 : P.minZ + 0.034); group.add(cap);
    const ring = mesh(new THREE.TorusGeometry(R + 0.0006, 0.0011, 8, 40), capMat); ring.position.set(P.x, P.y, e > 0 ? P.maxZ - 0.036 : P.minZ + 0.036); group.add(ring);
  }
  // stands (two-pole T type); pole rests in the front cradle
  const paint = new THREE.MeshStandardMaterial({ color: 0xe6e2d5, roughness: 0.42, metalness: 0.15, roughnessMap: T.paintRough });
  const hookMat = plastic(0xd9d7cf, 0.45);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.concrete, roughness: 0.95, bumpMap: T.concrete, bumpScale: 1.2 });
  const grey = plastic(0x8c8f91, 0.5);
  const hookGeo = makeHookGeo();
  for (const zc of [-0.55, 1.65]) {
    const px = P.x + 0.2;
    const st = new THREE.Group(); st.position.set(px, 0, zc); group.add(st);
    const bg = new RoundedBoxGeometry(0.34, 0.12, 0.34, 3, 0.02);
    const pa = bg.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); const f = 1 - (y + 0.06) / 0.12 * 0.16; pa.setX(i, pa.getX(i) * f); pa.setZ(i, pa.getZ(i) * f); }
    bg.computeVertexNormals();
    const base = mesh(bg, concrete); base.position.y = 0.06; st.add(base);
    const sock = mesh(lathe([[0.0, 0.17], [0.022, 0.17], [0.026, 0.166], [0.026, 0.125], [0.032, 0.122], [0.034, 0.118], [0.034, 0.118], [0, 0.118]], 32), grey); st.add(sock);
    const bolt = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.018, 6), steel); bolt.rotation.z = Math.PI / 2; bolt.position.set(-0.032, 0.15, 0); st.add(bolt);
    const outer = mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.74, 32), paint); outer.position.y = 0.16 + 0.37; st.add(outer);
    const collar = mesh(lathe([[0.0155, 0.935], [0.0215, 0.935], [0.0245, 0.93], [0.0245, 0.9], [0.022, 0.895], [0.0222, 0.9]], 32), grey); st.add(collar);
    const scr = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 10), steel); scr.rotation.z = Math.PI / 2; scr.position.set(-0.034, 0.915, 0); st.add(scr);
    const kn = mesh(new RoundedBoxGeometry(0.008, 0.03, 0.012, 2, 0.003), grey); kn.position.set(-0.046, 0.915, 0); st.add(kn);
    const inner = mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.36, 32), paint); inner.position.y = 0.935 + 0.17; st.add(inner);
    const tee = mesh(new RoundedBoxGeometry(0.05, 0.04, 0.04, 2, 0.006), hookMat); tee.position.y = 1.27; st.add(tee);
    const bar = mesh(new RoundedBoxGeometry(0.5, 0.02, 0.022, 2, 0.004), paint); bar.position.set(0, 1.279, 0); st.add(bar);
    for (const hx of [-0.2, 0.2]) { const h = mesh(hookGeo, hookMat); h.position.set(hx, P.y - 0.031, 0); st.add(h); }
    for (const ex of [-0.25, 0.25]) { const c = mesh(new RoundedBoxGeometry(0.008, 0.024, 0.026, 2, 0.003), hookMat); c.position.set(ex, 1.279, 0); st.add(c); }
  }
  return { group };
}

// =====================================================================================
// 3. Straight pinch hanger with three clothespins (world coordinates)
// =====================================================================================
const PEG_OUT = [[-0.0012, 0], [-0.0032, 0.003], [-0.0045, 0.010], [-0.0062, 0.020], [-0.0074, 0.028], [-0.0078, 0.036], [-0.0082, 0.046], [-0.0096, 0.058], [-0.0107, 0.067], [-0.0105, 0.0725], [-0.0092, 0.075]];
const PEG_IN = [[-0.0062, 0.075], [-0.0049, 0.073], [-0.0041, 0.060], [-0.0029, 0.048], [-0.0016, 0.0405], [-0.0031, 0.0375], [-0.0039, 0.033], [-0.0031, 0.0285], [-0.0014, 0.0265], [-0.0007, 0.020],
  [-0.0002, 0.0165], [-0.0009, 0.014], [-0.0002, 0.0115], [-0.0009, 0.009], [-0.0002, 0.0065], [-0.0009, 0.004], [-0.0002, 0.0015]];
function pegHalfGeo(mirror) {
  const outer = new THREE.SplineCurve(PEG_OUT.map(p => V(p[0], p[1]))).getPoints(48).map(p => [p.x, p.y]);
  const pts = outer.concat(PEG_IN.slice(1)).map(p => V(mirror ? -p[0] : p[0], p[1]));
  if (mirror) pts.reverse();
  const sh = new THREE.Shape(pts);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0007, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -0.006);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i); let w = 0.78 + 0.27 * smooth(0.012, 0.058, y);
    if (y > 0.068) { const t = (y - 0.068) / 0.0085; w *= Math.sqrt(Math.max(0.05, 1 - t * t * 0.75)); }
    pa.setZ(i, pa.getZ(i) * w);
  }
  return smoothX(g);
}
function outerX(y) { for (let i = 1; i < PEG_OUT.length; i++) { const a = PEG_OUT[i - 1], b = PEG_OUT[i]; if (y <= b[1]) { const t = (y - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; } } return PEG_OUT[PEG_OUT.length - 1][0]; }

function makePeg(color) {
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, roughnessMap: textures().plasticRough, sheen: 0.3, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5) });
  const wire = new THREE.MeshStandardMaterial({ color: 0xd2d5d8, metalness: 1, roughness: 0.3 });
  const peg = new THREE.Group();
  const FY = 0.033; // fulcrum (coil) height
  const halves = [];
  for (const side of [-1, 1]) {
    const h = new THREE.Group(); h.position.y = FY; peg.add(h);
    const m = mesh(pegHalfGeo(side > 0), mat, true, true); m.position.y = -FY; h.add(m);
    // grip ridges on the finger tab
    for (const y of [0.054, 0.058, 0.062, 0.066]) {
      const r = mesh(new RoundedBoxGeometry(0.0012, 0.0012, 0.0115, 1, 0.0004), mat, false, false);
      r.position.set(side * (-outerX(y) + 0.0004), y - FY, 0); h.add(r);
    }
    // spring leg pressing on the jaw's outer face
    const sx = side;
    const leg = mesh(tube([[sx * 0.0024, 0, sx * 0.0035], [sx * 0.0052, -0.004, sx * 0.0035], [sx * 0.0068, -0.010, sx * 0.0032], [sx * 0.0060, -0.018, sx * 0.0030], [sx * 0.0050, -0.0225, sx * 0.0025], [sx * 0.0040, -0.0235, sx * 0.002]], 0.00062, 20, 6), wire, false, false);
    h.add(leg);
    halves.push(h);
  }
  // coil
  const coilPts = []; for (let i = 0; i <= 80; i++) { const t = i / 80; const a = t * 5.5 * TAU; coilPts.push([Math.cos(a) * 0.0026, FY + Math.sin(a) * 0.0026, -0.0035 + t * 0.007]); }
  peg.add(mesh(tube(coilPts, 0.00062, 160, 5), wire, false, false));
  // head tab + ring for the link
  const tab = mesh(new RoundedBoxGeometry(0.004, 0.008, 0.006, 2, 0.0015), mat, false, false); tab.position.set(0.0062, 0.0775, 0); peg.add(tab);
  return { peg, halves, mat };
}

export function createHanger(ctx) {
  const group = new THREE.Group(); group.name = 'pinchHanger';
  const P = L.POLE; const HZ = L.HANGER_Z;
  const BAR_Y = 1.12, BAR_R = 0.0062, BAR_LEN = 0.55;
  const steel = stainless(0.2);
  const plasticPale = plastic(0xe4e6e3, 0.4);
  const WIRE_R = 0.0028;
  const contactY = P.y + 0.015 + WIRE_R;
  // rock root: at the hook/pole contact; everything hangs from it
  const rock = new THREE.Group(); rock.position.set(P.x, contactY, HZ); group.add(rock);
  const hang = new THREE.Group(); hang.position.set(-P.x, -contactY, -HZ); rock.add(hang); // hang uses world coords
  // hook
  const ar = 0.015 + WIRE_R; const hp = [];
  hp.push([P.x, BAR_Y + 0.02, HZ], [P.x, BAR_Y + 0.08, HZ], [P.x, P.y - 0.045, HZ], [P.x - 0.004, P.y - 0.028, HZ], [P.x - ar * 0.93, P.y - 0.008, HZ]);
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.92 - i / 10 * 0.95); hp.push([P.x + Math.cos(a) * ar, P.y + Math.sin(a) * ar, HZ]); }
  hp.push([P.x + ar * 0.95, P.y - 0.009, HZ], [P.x + ar * 0.78, P.y - 0.016, HZ]);
  hang.add(mesh(tube(hp, WIRE_R, 90, 10), steel));
  const tip = mesh(new THREE.SphereGeometry(WIRE_R * 1.15, 12, 8), steel); tip.position.fromArray(hp[hp.length - 1]); hang.add(tip);
  // swivel ferrule + centre block
  const fer = mesh(lathe([[0, 0.022], [0.0045, 0.022], [0.0055, 0.018], [0.0055, 0.004], [0.0075, 0.0], [0, 0]], 24), plasticPale); fer.position.set(P.x, BAR_Y + 0.008, HZ); hang.add(fer);
  const blk = mesh(new RoundedBoxGeometry(0.02, 0.022, 0.05, 3, 0.006), plasticPale); blk.position.set(P.x, BAR_Y + 0.001, HZ); hang.add(blk);
  // bar
  const barG = new THREE.CylinderGeometry(BAR_R, BAR_R, BAR_LEN - 0.02, 32, 1, true); barG.rotateX(Math.PI / 2);
  const bar = mesh(barG, steel); bar.position.set(P.x, BAR_Y, HZ); hang.add(bar);
  for (const e of [-1, 1]) {
    const cg = lathe([[0, 0.018], [0.004, 0.0178], [0.0072, 0.015], [0.0082, 0.01], [0.0082, 0.0], [BAR_R, 0], [BAR_R, -0.004]], 24); cg.rotateX(e > 0 ? Math.PI / 2 : -Math.PI / 2);
    const cap = mesh(cg, plasticPale); cap.position.set(P.x, BAR_Y, HZ + e * (BAR_LEN / 2 - 0.018)); hang.add(cap);
  }
  // clips
  const COLORS = [0xf4a9b8, 0xa6e0c6, 0xdde9f3];
  const G = 9.81;
  const LINK_TO_GRIP = BAR_Y - L.CLIP_Y; // 0.14
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xd2d5d8, metalness: 1, roughness: 0.28 });
  const clips = [];
  L.CLIP_Z.forEach((cz, i) => {
    const swing = new THREE.Group(); swing.position.set(P.x, BAR_Y, cz); hang.add(swing);
    const loop = mesh(new THREE.TorusGeometry(0.0095, 0.0013, 8, 28), wireMat, false, false); swing.add(loop);
    const stem = mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.058, 8), wireMat, false, false); stem.position.y = -0.0095 - 0.029; swing.add(stem);
    const eye = mesh(new THREE.TorusGeometry(0.0038, 0.0011, 8, 20), wireMat, false, false); eye.rotation.y = Math.PI / 2; eye.position.set(0.003, -0.0095 - 0.058 - 0.0025, 0); swing.add(eye);
    const { peg, halves } = makePeg(COLORS[i]);
    peg.position.y = -LINK_TO_GRIP - 0.010; swing.add(peg);
    const pivot = new THREE.Object3D(); pivot.name = 'clipPivot' + i; pivot.position.y = -LINK_TO_GRIP; swing.add(pivot);
    const c = {
      pivot, swingX: 0, swingZ: 0, vx: 0, vz: 0, load: 0, open: 0,
      setOpen(o) { c.open = Math.min(1, Math.max(0, o)); const a = 0.3 * c.open; halves[0].rotation.z = -a; halves[1].rotation.z = a; },
      setLoad(m) { c.load = Math.min(1, Math.max(0, m)); },
      poke(ix, iz) { const Le = 0.14 + 0.07 * c.load; c.vx += ix / Le; c.vz += iz / Le; },
      _swing: swing, _phase: i * 1.7,
    };
    clips.push(c);
  });
  // hanger dynamics
  let swayAmt = 0, time = 0, bounceY = 0, bounceV = 0, rockX = 0, rockXv = 0, rockZ = 0, rockZv = 0;
  function sway(a) { swayAmt = Math.min(1, Math.max(0, a)); }
  function bounce(a) { bounceV -= 0.2 * a; rockXv += (Math.random() - 0.5) * 0.3 * a; clips.forEach(c => { c.vz += (Math.random() - 0.5) * 0.4 * a; c.vx += (Math.random() - 0.5) * 0.3 * a; }); }
  function update(dt) {
    time += dt;
    const n = Math.max(1, Math.ceil(dt / 0.004)); const h = dt / n;
    // static tilt from loads (COM shifts along Z) -> bar tilts about X
    let mom = 0, mass = 1; clips.forEach((c, i) => { mom += c.load * (L.CLIP_Z[i] - HZ); mass += c.load * 0.6; });
    const tiltTarget = Math.max(-0.05, Math.min(0.05, mom / mass * 0.22));
    for (let s = 0; s < n; s++) {
      const tt = time - dt + h * s;
      const bx = swayAmt * (0.35 * Math.sin(tt * 0.9) + 0.25 * Math.sin(tt * 2.3 + 1) + 0.12 * Math.sin(tt * 5.1));
      const bz = swayAmt * (0.25 * Math.sin(tt * 0.7 + 2) + 0.15 * Math.sin(tt * 1.9));
      // bounce spring (~4 Hz, light damping)
      bounceV += (-((TAU * 4) ** 2) * bounceY - 2 * 0.12 * TAU * 4 * bounceV) * h; bounceY += bounceV * h;
      // hanger rocks on its hook (pendulum ~0.2 m)
      const wr2 = G / 0.2;
      let sumAx = 0, sumAz = 0;
      clips.forEach(c => {
        const Le = 0.14 + 0.07 * c.load; const w2 = G / Le; const w = Math.sqrt(w2); const zeta = 0.085 - 0.012 * c.load;
        const ax = -w2 * c.swingX - 2 * zeta * w * c.vx + bx * 0.9 + Math.sin(tt * 3.1 + c._phase) * swayAmt * 0.25;
        const az = -w2 * c.swingZ - 2 * zeta * w * c.vz + bz * 0.9 + Math.sin(tt * 2.7 + c._phase * 1.3) * swayAmt * 0.2;
        c.vx += ax * h; c.vz += az * h; c.swingX += c.vx * h; c.swingZ += c.vz * h;
        sumAx += ax * (0.3 + c.load); sumAz += az * (0.3 + c.load);
      });
      rockXv += (-wr2 * (rockX) - 2 * 0.12 * Math.sqrt(wr2) * rockXv + bx * 0.25 - sumAx * 0.012) * h; rockX += rockXv * h;
      rockZv += (-wr2 * (rockZ - tiltTarget) - 2 * 0.3 * Math.sqrt(wr2) * rockZv + bz * 0.08 - sumAz * 0.004) * h; rockZ += rockZv * h;
    }
    clips.forEach(c => {
      c.swingX = Math.max(-1.1, Math.min(1.1, c.swingX)); c.swingZ = Math.max(-1.1, Math.min(1.1, c.swingZ));
      // keep the pendulum referenced to world vertical while the hanger rocks
      c._swing.rotation.set(-c.swingZ - rockZ, 0, c.swingX - rockX);
    });
    rock.rotation.set(rockZ, 0, rockX);
    rock.position.y = contactY + Math.min(0.004, bounceY);
  }
  update(0);
  return { group, clips, sway, bounce, update };
}
