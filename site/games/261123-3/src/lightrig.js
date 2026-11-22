// Shared look: renderer settings + the reference "sunny afternoon" light rig.
// Used by dev previews AND as the baseline that world.js must match at time-of-day 0.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.55, 0.78, 0.30).normalize(); // direction TO the sun (afternoon)

export const EXPOSURE = 0.82;      // keep whites (the shoes!) below clipping
export const ENV_INTENSITY = 0.5;  // scene.environmentIntensity

export function setupRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// Small procedural outdoor environment (blue sky above, bright horizon, warm ground bounce, sun blob)
// rendered through PMREM for image-based lighting / reflections.
export function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sunDir: { value: SUN_DIR.clone() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
      void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 zen = vec3(0.20,0.42,0.86), hor = vec3(0.78,0.88,1.0), gnd = vec3(0.42,0.40,0.36);
        vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor*0.8, gnd, pow(-h, 0.35));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += vec3(1.0,0.93,0.8) * (pow(s, 600.0)*40.0 + pow(s, 12.0)*0.5);
        gl_FragColor = vec4(c*1.15, 1.0); }`,
  });
  s.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose(); geo.dispose(); mat.dispose();
  return rt.texture;
}

// Reference lights for previews (world.js builds its own, matching these numbers at time-of-day 0).
export function addReferenceLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
  sun.position.copy(SUN_DIR).multiplyScalar(6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera; c.left = -1.6; c.right = 1.6; c.top = 1.6; c.bottom = -1.6; c.near = 0.5; c.far = 14;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012; sun.shadow.radius = 3;
  const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x8a7f6c, 0.3);
  scene.environmentIntensity = ENV_INTENSITY;
  scene.add(sun, sun.target, hemi);
  return { sun, hemi };
}
