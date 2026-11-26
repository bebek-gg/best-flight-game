// Skyward Run — aircraft.js
// One clear job: the aeroplane. buildAircraft() assembles a low-poly prop
// plane from boxes, cones and cylinders in one style, and the Aircraft class
// owns the arcade flight model: throttle, pitch, roll, turn, lift, drag,
// fuel burn and the ground. It knows nothing about the DOM or the missions.

import * as THREE from 'three';
import { AIRCRAFT, RUNWAY, clamp, wrapAngle } from './config.js';

const WORLD_EDGE = 1240;

// The plane is built facing -Z (north), nose at -Z, so its forward vector is
// (sin(heading) * -1? no: forward = (-sin(heading), 0, -cos(heading))).
// Orange and white so it reads clearly against green terrain and blue sky.
export function buildAircraft() {
  const group = new THREE.Group();
  const orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f1e8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2e3138 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd8ef });

  // Fuselage: a tapered box, nose forward.
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 6.4), orange);
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 4), white);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.z = -4.0;
  group.add(nose);
  // Canopy: a flattened glass dome on top, ahead of the wing.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), glass);
  canopy.scale.set(0.9, 0.75, 1.5);
  canopy.position.set(0, 0.85, -1.2);
  group.add(canopy);
  // Main wing: long, slightly tapered, with white tips.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.28, 2.0), white);
  wing.position.set(0, -0.15, -0.4);
  group.add(wing);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 2.0), orange);
    tip.position.set(side * 5.45, -0.15, -0.4);
    group.add(tip);
  }
  // Tail: horizontal stabiliser and a vertical fin.
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.22, 1.3), white);
  tailplane.position.set(0, 0.25, 3.0);
  group.add(tailplane);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.0, 1.6), orange);
  fin.position.set(0, 1.05, 3.0);
  group.add(fin);
  // Propeller: a hub and two blades, spinning in the update.
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 8), dark);
  hub.rotation.x = Math.PI / 2;
  prop.add(hub);
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 4.6, 0.12), dark);
    blade.rotation.z = a;
    prop.add(blade);
  }
  prop.position.z = -4.9;
  group.add(prop);
  // Landing gear: two fixed wheels and a tail wheel.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), dark);
    strut.position.set(side * 0.9, -1.1, -1.0);
    group.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.9, -1.65, -1.0);
    group.add(wheel);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 8), dark);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.85, 3.1);
  group.add(tailWheel);

  group.userData.propeller = prop;
  return group;
}

export class Aircraft {
  constructor(mesh, terrainHeightAt) {
    this.mesh = mesh;
    this.terrainHeightAt = terrainHeightAt;
    // Position is the aircraft centre in world metres; y is absolute height.
    this.position = new THREE.Vector3(RUNWAY.x, RUNWAY.height + 1.7, RUNWAY.z);
    this.heading = RUNWAY.heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.throttle = 0;
    this.fuel = 100;
    this.verticalSpeed = 0;
    this.airborne = false;
    this.onGround = true;
    this.propSpin = 0;
    // Vertical speed at the last ground impact, m/s down; the mission reads
    // it to judge how gentle a touchdown was (verticalSpeed is zeroed below).
    this.impactVs = 0;
  }

  resetToRunway() {
    this.position.set(RUNWAY.x, RUNWAY.height + 1.7, RUNWAY.z);
    this.heading = RUNWAY.heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.throttle = 0;
    this.fuel = 100;
    this.verticalSpeed = 0;
    this.airborne = false;
    this.onGround = true;
  }

  // Place the aircraft in the air for sortie 3 (landing) or a screenshot.
  placeInAir(x, y, z, heading, speed) {
    this.position.set(x, y, z);
    this.heading = heading;
    this.pitch = -0.05;
    this.roll = 0;
    this.speed = speed;
    this.throttle = 0.45;
    this.fuel = 100;
    this.verticalSpeed = 0;
    this.airborne = true;
    this.onGround = false;
  }

  forwardVector() {
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  // One simulation step. input: { pitch: -1..1 (pull up positive), roll: -1..1
  // (right positive), throttleDelta: -1..1 }. dt is clamped by the caller.
  // Returns an event object: { touchedDown, crashed, landed } for the frame.
  update(dt, input) {
    const events = { touchedDown: false, crashed: false, landed: false };
    // Throttle moves in steps and stays in 0..1.
    this.throttle = clamp(this.throttle + input.throttleDelta * dt * 0.55, 0, 1);
    // Fuel burns with throttle; empty tanks mean no thrust.
    const burn = (AIRCRAFT.fuelBurnIdle + (AIRCRAFT.fuelBurnFull - AIRCRAFT.fuelBurnIdle) * this.throttle) * dt;
    this.fuel = Math.max(0, this.fuel - burn);
    const thrust = this.fuel > 0 ? this.throttle : 0;

    // Attitude: pitch and roll chase the stick, and roll levels itself when
    // the stick is centred, so the plane never holds a bank forever.
    const pitchTarget = clamp(input.pitch * AIRCRAFT.maxPitch, -AIRCRAFT.maxPitch, AIRCRAFT.maxPitch);
    const rollTarget = clamp(input.roll * AIRCRAFT.maxRoll, -AIRCRAFT.maxRoll, AIRCRAFT.maxRoll);
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 3.2);
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 3.0);

    // Speed: thrust accelerates, drag grows with speed squared, and a small
    // constant term is the rolling resistance. On the ground with the
    // throttle near idle the brakes bite, so a landed plane rolls to a stop.
    const groundBrake = this.onGround && thrust < 0.05 ? 9 : 0;
    const accel = thrust * AIRCRAFT.accelPerThrottle - this.speed * this.speed * AIRCRAFT.drag * 0.02 - 1.2 - groundBrake;
    this.speed = Math.max(0, this.speed + accel * dt);
    // Banking turns the nose; the turn tightens with speed.
    this.heading = wrapAngle(this.heading + Math.sin(this.roll) * AIRCRAFT.turnFromBank * dt * clamp(this.speed / 40, 0.25, 1.4));

    // Vertical speed: the wing lifts once past flying speed. Below it the
    // plane sinks; on the ground it stays planted until rotation speed.
    const groundH = this.terrainHeightAt(this.position.x, this.position.z);
    const clearance = this.position.y - groundH;
    let targetVs = 0;
    if (this.onGround) {
      if (this.speed > AIRCRAFT.minFlySpeed && this.pitch > 0.06) {
        this.onGround = false;
        this.airborne = true;
        targetVs = Math.sin(this.pitch) * this.speed;
      } else {
        targetVs = 0;
      }
    } else {
      const liftSpeed = clamp((this.speed - AIRCRAFT.minFlySpeed) / 30, 0, 1);
      targetVs = Math.sin(this.pitch) * this.speed * liftSpeed
        + (thrust * AIRCRAFT.climbAtFullThrottle - AIRCRAFT.sinkAtIdle) * liftSpeed
        - AIRCRAFT.sinkAtIdle * (1 - liftSpeed) * 0.4;
      // A steep dive keeps its energy; a stall drops the nose.
      if (this.speed < AIRCRAFT.minFlySpeed * 0.8) targetVs -= 4;
    }
    this.verticalSpeed += (targetVs - this.verticalSpeed) * Math.min(1, dt * 2.2);
    const fwd = this.forwardVector();
    this.position.x += fwd.x * this.speed * dt;
    this.position.z += fwd.z * this.speed * dt;
    this.position.y += this.verticalSpeed * dt;

    // World edge: turn the plane gently back toward the valley.
    if (Math.abs(this.position.x) > WORLD_EDGE || Math.abs(this.position.z) > WORLD_EDGE) {
      const toCentre = Math.atan2(-this.position.x, -this.position.z);
      const want = wrapAngle(toCentre - Math.PI);
      this.heading = wrapAngle(this.heading + wrapAngle(want - this.heading) * Math.min(1, dt * 0.8));
    }

    // Ground contact.
    const newGroundH = this.terrainHeightAt(this.position.x, this.position.z);
    const newClearance = this.position.y - newGroundH;
    if (newClearance <= 1.7) {
      this.position.y = newGroundH + 1.7;
      const vsDown = -this.verticalSpeed;
      const onRunway = this.isOverRunway();
      if (this.airborne) {
        events.touchedDown = true;
        this.impactVs = vsDown;
        if (!onRunway && vsDown > AIRCRAFT.hardImpactVs) {
          events.crashed = true;
        } else if (onRunway && vsDown <= AIRCRAFT.gentleVs && this.speed < 55) {
          events.landed = true;
        } else if (vsDown > AIRCRAFT.hardImpactVs) {
          events.crashed = true;
        }
      }
      this.airborne = false;
      this.onGround = true;
      this.verticalSpeed = 0;
    }
    return events;
  }

  isOverRunway() {
    return Math.abs(this.position.x - RUNWAY.x) <= RUNWAY.width / 2 + 4
      && Math.abs(this.position.z - RUNWAY.z) <= RUNWAY.length / 2 + 10;
  }

  // Height above the ground right under the aircraft, in metres.
  altitudeAgl() {
    return Math.max(0, this.position.y - this.terrainHeightAt(this.position.x, this.position.z));
  }

  // Write the simulated state into the visible mesh.
  syncMesh(elapsed) {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = -this.pitch;
    this.mesh.rotation.z = -this.roll;
    this.propSpin += (0.4 + this.throttle * 28 + this.speed * 0.25) * 0.016;
    const prop = this.mesh.userData.propeller;
    if (prop) prop.rotation.z = this.propSpin;
  }
}
