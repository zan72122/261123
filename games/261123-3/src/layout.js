// World layout constants (meters, Y up). Shared by engine, world and scenes.
// "Front" views look toward -Z (house wall far behind): +X = screen right, +Z = toward the viewer.
// "Garden" views (hang / sun / pack / end) look toward +X: +Z = screen right, hedge + sky behind.
export const L = {
  TERRACE: { minX: -2.6, maxX: 2.6, minZ: -2.2, maxZ: 1.9 },   // concrete pad, top at y=0; lawn beyond
  WALL_Z: -2.2,                                                // house wall plane (faces +Z)
  FAUCET: [0, 0, -0.40],                                       // tap post base; spout tip near (0, 0.52, -0.16), pointing down
  BASIN: [0, 0, 0],                                            // blue plastic basin, outer radius 0.27
  SOAP: [0.39, 0, -0.06],                                      // soap dish on the ground right of the basin
  BAG_START: [-0.56, 0, 0.36],                                 // dirty shoe bag lying on the ground (opening scene)
  BAG_YAW: 0.9,                                                // its mouth points toward +X+Z (screen lower-right)
  GROUND_SLOTS: [[-0.29, 0, 0.50], [-0.17, 0, 0.53]],          // where the two shoes land after being pulled out of the bag
  BRUSH_PARK: [0.37, 0, 0.13],                                 // brush lying on the ground beside the soap (when not in use)
  BASIN_SLOTS: [[-0.052, 0.02], [0.052, 0.02]],                // shoes side by side in the basin (basin-local x,z), toes toward -Z; they float
  SPINNER: [0.55, 0, 0.55],                                    // hand-crank spin dryer, outer radius 0.16
  POLE: { x: 1.25, y: 1.32, minZ: -0.7, maxZ: 1.8 },           // laundry pole along Z
  HANGER_Z: 0.55,                                              // straight pinch hanger hangs from the pole here (bar along Z)
  CLIP_Z: [0.35, 0.49, 0.75],                                  // clip positions along Z: shoe, shoe, bag
  CLIP_Y: 0.98,                                                // height of the clip jaws
};
// Camera shots. The camera director fits `pts` (flat xyz list) if present, else the 8 corners of
// box = [minX,minY,minZ,maxX,maxY,maxZ] (box is always needed: its centre is the shadow focus).
// yaw (deg): 0 looks toward -Z, 90 looks toward +X. pitch (deg): looking DOWN (negative = up).
function ring(cx, y, cz, r, n = 10) { const o = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r); } return o; }
const BASIN_PTS = [...ring(0, 0.13, 0, 0.275), ...ring(0, 0, 0, 0.23, 6)];
export const SHOTS = {
  bag:     { box: [-0.74, 0.0, 0.16, -0.36, 0.08, 0.60], yaw: 0, pitch: 56, margin: 0.1 },      // opening close-up of the bag
  bagWide: { box: [-0.74, 0.0, 0.16, -0.10, 0.08, 0.66], yaw: 0, pitch: 56 },                   // ...widened once a shoe has popped out
  faucet:  { box: [-0.28, 0.0, -0.44, 0.28, 0.66, 0.28], yaw: 0, pitch: 40, margin: 0.06,
             pts: [...BASIN_PTS, -0.06, 0.66, -0.44, 0.06, 0.66, -0.44, -0.06, 0.66, -0.26, 0.06, 0.66, -0.26] },
  rinse:   { box: [-0.28, 0.0, -0.44, 0.28, 0.66, 0.62], yaw: 0, pitch: 40, margin: 0.06,     // like faucet, with room in front for tipping the basin
             pts: [...BASIN_PTS, -0.06, 0.66, -0.44, 0.06, 0.66, -0.44, -0.06, 0.66, -0.26, 0.06, 0.66, -0.26, -0.2, 0, 0.62, 0.2, 0, 0.62] },
  dunk:    { box: [-0.38, 0.0, -0.27, 0.27, 0.16, 0.62], yaw: 0, pitch: 55, margin: 0.06,
             pts: [...BASIN_PTS, -0.36, 0, 0.40, -0.36, 0.05, 0.62, -0.10, 0, 0.64, -0.10, 0.05, 0.42, 0, 0.56, -0.16] },
  scrub:   { box: [-0.105, 0.05, -0.10, 0.155, 0.10, 0.12], yaw: 0, pitch: 64 },
  load:    { box: [-0.30, 0.0, -0.30, 0.75, 0.40, 0.75], yaw: 0, pitch: 52 },
  spin:    { box: [0.34, 0.0, 0.34, 0.76, 0.48, 0.76], yaw: 0, pitch: 52 },
};
