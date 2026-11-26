// Skyward Run — render.js
// One clear job: what the pilot sees. The WebGL renderer, the sky dome with
// its gradient and sun, the lights, and the chase camera that follows the
// aircraft without ever fighting it. No game logic lives here.

import * as THREE from 'three';
import { WORLD, clamp, lerp } from './config.js';

export function createRenderer(canvas, options) {
  const opts = options || {};
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.antialias !== false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

// Sky: a big inverted sphere with a vertex-coloured gradient (deep blue up
// top, pale horizon), a bright sun disc and a soft haze band. The dome
// follows the camera so the pilot never flies out of it.
export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(4200, 24, 16);
  const colours = new Float32Array(geo.attributes.position.count * 3);
  const top = new THREE.Color(0x2f6fd0);
  const mid = new THREE.Color(0x8ec6ee);
  const horizon = new THREE.Color(0xdfeef7);
  const pos = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = clamp(pos.getY(i) / 4200, -0.08, 1);
    if (t > 0.25) c.copy(mid).lerp(top, (t - 0.25) / 0.75);
    else c.copy(horizon).lerp(mid, (t + 0.08) / 0.33);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  }));
  scene.add(sky);
  // Sun: a glowing disc high in the west, plus a halo sprite made of a
  // plain canvas radial gradient drawn as a data texture (no image file).
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(150, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3c0, fog: false }),
  );
  sun.position.set(-2600, 1500, -3200);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  return sky;
}

export function buildLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(-600, 900, -400);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x5d7a4a, 0.85);
  scene.add(hemi);
  return { sun, hemi };
}

// The chase camera: it trails behind and above the aircraft, easing toward
// its target each frame, and always looks a little ahead of the nose. The
// distance grows slightly with speed, and the field of view widens with it,
// so fast flight feels fast without the camera ever snapping.
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(60, 60, 860);
    this.lookAt = new THREE.Vector3(60, 30, 700);
    this.fov = 62;
  }

  update(aircraft, dt) {
    const speedT = clamp(aircraft.speed / 96, 0, 1);
    const back = 16 + speedT * 10;
    const up = 5.5 + speedT * 2.5;
    const fwd = aircraft.forwardVector();
    // Right vector: perpendicular to forward on the ground plane.
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const targetPos = new THREE.Vector3()
      .copy(aircraft.position)
      .addScaledVector(fwd, -back)
      .addScaledVector(right, -aircraft.roll * 4)
      .add(new THREE.Vector3(0, up, 0));
    const k = 1 - Math.exp(-dt * 5.5);
    this.position.lerp(targetPos, k);
    const targetLook = new THREE.Vector3()
      .copy(aircraft.position)
      .addScaledVector(fwd, 34)
      .add(new THREE.Vector3(0, 1.5, 0));
    this.lookAt.lerp(targetLook, 1 - Math.exp(-dt * 8));
    // The cockpit camera rolls the camera's up vector with the airframe;
    // chase view is always level, so restore the world up here or the
    // horizon stays tilted after switching back from the cockpit.
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    const wantFov = 62 + speedT * 12;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, wantFov, 1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }

  // Snap the camera behind the aircraft at once (used when a sortie starts
  // or a screenshot state is staged, so the first frame is already framed).
  snap(aircraft) {
    const fwd = aircraft.forwardVector();
    this.position.copy(aircraft.position).addScaledVector(fwd, -18).add(new THREE.Vector3(0, 6, 0));
    this.lookAt.copy(aircraft.position).addScaledVector(fwd, 34);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }
}

// The cockpit camera: the pilot's seat, just above the canopy glass, looking
// forward over the nose and the spinning propeller, with the dashboard along
// the bottom of the frame. It banks with the aircraft (the camera's up
// vector rolls with it), so a banked turn reads as a banked turn instead of
// a level view sliding sideways. Fully playable: the flight model, the HUD
// and the controls are identical in either view; only the eye moves.
export class CockpitCamera {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(60, 30, 780);
    this.lookAt = new THREE.Vector3(60, 30, 700);
    this.fov = 68;
  }

  update(aircraft) {
    // The aircraft mesh rotates YXZ (heading, -pitch, -roll); reuse that
    // exact orientation for the eye so the view matches the airframe, with
    // a small 3-degree downward tilt to bring the dashboard into the lower
    // frame. The eye sits INSIDE the fuselage, above the seat and forward
    // of it: the fuselage is front-face culled from inside, so the pilot
    // sees the dashboard and dials as a strip along the bottom, the nose
    // cone ahead, and the world through the nearly clear canopy glass. An
    // eye above the fuselage (the previous version) only ever saw the
    // fuselage top filling the lower half, because the eye sat 0.6 m above
    // a 3.4 m slab. The eye is forward of the wing's leading edge, so the
    // wing stays below the frame.
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-aircraft.pitch - 0.05, aircraft.heading, -aircraft.roll, 'YXZ'),
    );
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const eye = new THREE.Vector3(0, 0.65, -1.0).applyQuaternion(q).add(aircraft.position);
    this.position.copy(eye);
    this.lookAt.copy(eye).addScaledVector(fwd, 60);
    this.camera.position.copy(this.position);
    this.camera.up.copy(up);
    this.camera.lookAt(this.lookAt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Put the eye in place at once (sortie start, screenshot staging).
  snap(aircraft) {
    this.update(aircraft);
  }
}

// Fog softens the far valley so the world reads at depth.
export function buildFog(scene) {
  scene.fog = new THREE.Fog(0xcfe4f2, 700, 3400);
}
