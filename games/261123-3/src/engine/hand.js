// Procedural "ghost finger" texture: a soft child's right hand, back of the hand toward the viewer,
// index finger extended (fingertip = hot spot). Also a soft ring texture for tap pulses.
import * as THREE from 'three';

const W = 256, H = 384;
const ROT = -0.26;            // hand tilt (finger leans up-left, hand comes from lower right)
const TIP = { x: 74, y: 22 }; // fingertip position on the canvas

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function capsule(g, x0, y0, x1, y1, r0, r1) {
  // tapered capsule from (x0,y0) radius r0 to (x1,y1) radius r1
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.arc(x0, y0, r0, a + Math.PI / 2, a - Math.PI / 2, false);
  g.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2, false);
  g.closePath();
}

function blob(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }

// all shapes in the upright frame: fingertip at (0,0), finger pointing to -y
function shapes() {
  return {
    finger: (g) => capsule(g, 0, 19, 3, 128, 19, 22.5),
    back: (g) => {
      g.beginPath();
      g.moveTo(-24, 122);
      g.bezierCurveTo(-34, 160, -36, 210, -22, 248);
      g.bezierCurveTo(-12, 272, 70, 282, 92, 254);
      g.bezierCurveTo(112, 226, 118, 178, 110, 152);
      g.bezierCurveTo(100, 122, 30, 104, -24, 122);
      g.closePath();
    },
    k1: (g) => blob(g, 40, 132, 23, 21, 0.2),
    k2: (g) => blob(g, 76, 143, 21, 20, 0.35),
    k3: (g) => blob(g, 102, 166, 17, 18, 0.5),
    thumb: (g) => capsule(g, -26, 228, -24, 166, 23, 19),
    wrist: (g) => {
      g.beginPath();
      g.moveTo(-18, 236); g.lineTo(96, 236);
      g.bezierCurveTo(96, 300, 92, 340, 90, 420);
      g.lineTo(-6, 420);
      g.bezierCurveTo(-10, 340, -16, 300, -18, 236);
      g.closePath();
    },
  };
}

function upright(g) { g.translate(TIP.x, TIP.y); g.rotate(ROT); }

export function makeHandTexture() {
  const S = shapes();
  const order = ['wrist', 'thumb', 'back', 'k3', 'k2', 'k1', 'finger'];

  // silhouette mask
  const mask = mk(W, H), mg = mask.getContext('2d');
  mg.save(); upright(mg); mg.fillStyle = '#000';
  for (const k of order) { S[k](mg); mg.fill(); }
  mg.restore();

  const skin = mk(W, H), g = skin.getContext('2d');
  // base: warm pale skin, lit from upper left
  g.save(); upright(g);
  const base = g.createLinearGradient(-40, 0, 120, 300);
  base.addColorStop(0, '#f8dccb'); base.addColorStop(0.55, '#f1cdb7'); base.addColorStop(1, '#e2b199');
  g.fillStyle = base;
  // each part: fill + own shading so the parts read as separate rounded forms
  const part = (key, hx, hy, hr, shade = 'rgba(176,104,80,0.22)') => {
    S[key](g); g.fillStyle = base; g.fill();
    g.save(); S[key](g); g.clip();
    const rg = g.createRadialGradient(hx, hy, 2, hx, hy, hr);
    rg.addColorStop(0, 'rgba(255,240,228,0.55)'); rg.addColorStop(0.6, 'rgba(255,236,222,0)');
    rg.addColorStop(1, shade);
    g.fillStyle = rg; g.fillRect(-120, -60, 360, 520);
    g.restore();
    // soft dark rim where this part overlaps what is behind it
    g.save(); S[key](g); g.lineWidth = 3; g.strokeStyle = 'rgba(170,98,76,0.16)'; g.stroke(); g.restore();
  };
  part('wrist', 30, 250, 90);
  part('thumb', -34, 180, 40);
  part('back', 30, 165, 115);
  // a few faint tendons / bones on the back of the hand
  g.save(); S.back(g); g.clip();
  g.strokeStyle = 'rgba(255,245,236,0.10)'; g.lineWidth = 9; g.lineCap = 'round';
  for (const [x0, x1] of [[8, 22], [40, 46], [72, 68]]) { g.beginPath(); g.moveTo(x0, 150); g.quadraticCurveTo((x0 + x1) / 2 + 4, 200, x1, 245); g.stroke(); }
  g.restore();
  part('k3', 98, 160, 22);
  part('k2', 72, 136, 26);
  part('k1', 34, 124, 28);
  // finger: cylindrical shading across its width
  S.finger(g); g.fillStyle = base; g.fill();
  g.save(); S.finger(g); g.clip();
  const cyl = g.createLinearGradient(-22, 0, 25, 0);
  cyl.addColorStop(0, 'rgba(190,118,92,0.30)'); cyl.addColorStop(0.3, 'rgba(255,240,230,0.42)');
  cyl.addColorStop(0.55, 'rgba(255,236,224,0.12)'); cyl.addColorStop(1, 'rgba(170,98,76,0.34)');
  g.fillStyle = cyl; g.fillRect(-40, -10, 90, 160);
  // knuckle creases
  g.strokeStyle = 'rgba(160,92,70,0.30)'; g.lineWidth = 1.6; g.lineCap = 'round';
  for (const [y, wd] of [[62, 11], [67, 8], [100, 12], [105, 9]]) { g.beginPath(); g.moveTo(-wd, y - 1); g.quadraticCurveTo(1, y + 3, wd + 1, y - 1); g.stroke(); }
  g.restore();
  // fingernail
  g.save();
  g.beginPath(); g.moveTo(-11, 32); g.bezierCurveTo(-12, 12, 13, 12, 12, 32); g.bezierCurveTo(12, 41, -11, 42, -11, 32); g.closePath();
  const ng = g.createLinearGradient(-12, 10, 12, 40);
  ng.addColorStop(0, '#fff3ee'); ng.addColorStop(0.5, '#f6d4ca'); ng.addColorStop(1, '#eebfb2');
  g.fillStyle = ng; g.fill();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(176,112,96,0.45)'; g.stroke();
  g.beginPath(); g.ellipse(-4, 22, 3, 6, 0.1, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
  g.restore();
  // curled-finger separations
  g.strokeStyle = 'rgba(150,84,64,0.32)'; g.lineWidth = 2.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(58, 128); g.quadraticCurveTo(57, 145, 62, 158); g.stroke();
  g.beginPath(); g.moveTo(90, 148); g.quadraticCurveTo(88, 162, 92, 176); g.stroke();
  g.beginPath(); g.moveTo(20, 140); g.quadraticCurveTo(18, 128, 22, 118); g.stroke();
  g.restore();

  // inner edge shading (inverted-mask shadow trick, Safari-safe: no ctx.filter)
  const inv = mk(W, H), ig = inv.getContext('2d');
  ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H);
  ig.globalCompositeOperation = 'destination-out'; ig.drawImage(mask, 0, 0);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.shadowColor = 'rgba(150,80,60,0.55)'; g.shadowBlur = 16; g.shadowOffsetX = 2000;
  g.drawImage(inv, -2000, 0);
  g.restore();
  g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-over';

  // final: soft contact shadow halo + skin, wrist fading away
  const out = mk(W, H), og = out.getContext('2d');
  og.save();
  og.shadowColor = 'rgba(70,40,30,0.45)'; og.shadowBlur = 10; og.shadowOffsetY = 3;
  og.drawImage(skin, 0, 0);
  og.restore();
  og.globalCompositeOperation = 'destination-out';
  const fade = og.createLinearGradient(0, H * 0.66, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  og.fillStyle = fade; og.fillRect(0, 0, W, H);
  og.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 1;
  return { tex, aspect: W / H, tipU: TIP.x / W, tipV: 1 - TIP.y / H, canvas: out };
}

export function makeRingTexture() {
  const s = 128, c = mk(s, s), g = c.getContext('2d');
  const rg = g.createRadialGradient(s / 2, s / 2, s * 0.26, s / 2, s / 2, s * 0.5);
  rg.addColorStop(0, 'rgba(255,250,240,0)');
  rg.addColorStop(0.45, 'rgba(255,250,240,0.95)');
  rg.addColorStop(0.7, 'rgba(255,246,232,0.45)');
  rg.addColorStop(1, 'rgba(255,246,232,0)');
  g.fillStyle = rg; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
