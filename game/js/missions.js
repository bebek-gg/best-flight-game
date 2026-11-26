// Skyward Run — missions.js
// One clear job: what the pilot is trying to do. The MissionManager owns the
// three sorties (Ring Run, Canyon Dash, Homecoming), the rings in the sky,
// the clock, the score and the win/lose calls. It asks the aircraft where it
// is and tells the game what happened; it never draws or plays sound itself.

import * as THREE from 'three';
import { MISSIONS, SCORE, RUNWAY, clamp } from './config.js';
import { buildRing, ringPathForSortie } from './terrain.js';

export class MissionManager {
  constructor(scene, audio, hud) {
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
    this.sortie = 1;
    this.score = 0;
    this.timeLeft = 0;
    this.ringsHit = 0;
    this.ringsTotal = 0;
    this.ringMeshes = [];
    this.nextRing = 0;
    this.state = 'idle'; // idle | flying | done | failed
    this.result = null; // { kind: 'complete'|'crashed'|'timeout'|'fuel', ... }
    this.elapsed = 0;
    this.lowPassStreak = 0;
  }

  get def() {
    return this.sortie === 1 ? MISSIONS.sortie1 : this.sortie === 2 ? MISSIONS.sortie2 : MISSIONS.sortie3;
  }

  get objective() {
    return this.def.brief;
  }

  startSortie(n, aircraft) {
    this.clearRings();
    this.sortie = n;
    this.score = n === 1 ? 0 : this.score;
    this.timeLeft = this.def.timeLimit;
    this.ringsHit = 0;
    this.ringsTotal = this.def.rings;
    this.nextRing = 0;
    this.elapsed = 0;
    this.state = 'flying';
    this.result = null;
    this.prevAlongZ = undefined;
    if (this.def.rings > 0) {
      const path = ringPathForSortie(n);
      path.forEach((p, i) => {
        const ring = buildRing(16, i === 0 ? 0xffd24a : 0xffb020);
        ring.position.set(p.x, p.y, p.z);
        ring.userData.index = i;
        ring.userData.centre = new THREE.Vector3(p.x, p.y, p.z);
        this.scene.add(ring);
        this.ringMeshes.push(ring);
      });
    }
    this.hud.showMessage('SORTIE ' + n + ' — ' + this.def.name, 4);
  }

  clearRings() {
    for (const r of this.ringMeshes) this.scene.remove(r);
    this.ringMeshes = [];
  }

  // Called every frame while flying. Returns nothing; the outcome lands in
  // this.state / this.result, which the game loop reads.
  update(dt, aircraft) {
    if (this.state !== 'flying') return;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.fail('timeout', 'Out of time.');
      return;
    }
    if (aircraft.fuel <= 0 && !aircraft.onGround) {
      // Out of fuel in the air: the engine is dead; the pilot must glide in.
      this.hud.showMessage('FUEL EMPTY — GLIDE TO THE RUNWAY', 2);
    }
    if (aircraft.fuel <= 0 && aircraft.onGround) {
      // Down with dry tanks: only a runway stop in sortie 3 still counts.
      if (!(this.sortie === 3 && aircraft.isOverRunway())) {
        this.fail('fuel', 'Out of fuel — down in the valley.');
        return;
      }
    }
    this.checkRings(aircraft);
    this.checkLandingRoll(aircraft);
  }

  checkRings(aircraft) {
    if (this.nextRing >= this.ringMeshes.length) return;
    const ring = this.ringMeshes[this.nextRing];
    const centre = ring.userData.centre;
    const radius = ring.userData.radius;
    const toRing = new THREE.Vector3().subVectors(aircraft.position, centre);
    // The aircraft passes the ring when it crosses the ring plane close to
    // the centre: distance in the ring plane under the radius, and the
    // along-axis distance small. Rings face along the flight path (north),
    // so the plane test is on Z plus a small Y allowance.
    const along = Math.abs(toRing.z);
    const radial = Math.hypot(toRing.x, toRing.y);
    const prevAlong = this.prevAlongZ;
    this.prevAlongZ = toRing.z;
    const crossed = prevAlong !== undefined && Math.sign(prevAlong) !== Math.sign(toRing.z);
    if (crossed && along < 14 && radial < radius) {
      this.ringPassed(aircraft, ring);
    } else if (crossed && along < 14 && radial < radius + 26) {
      // Brushed the edge: no score, but the pilot knows they were close.
      this.hud.showMessage('CLOSE — THROUGH THE MIDDLE NEXT TIME', 1.6);
      this.nextRing += 1;
      this.markRingPassed(ring, false);
    }
  }

  ringPassed(aircraft, ring) {
    this.ringsHit += 1;
    this.nextRing += 1;
    let gained = SCORE.ring;
    if (this.sortie === 2 && aircraft.altitudeAgl() < 45) {
      gained += SCORE.ringLowBonus;
      this.hud.showMessage('RING ' + this.ringsHit + '/' + this.ringsTotal + ' — LOW PASS BONUS +150', 2);
    } else {
      this.hud.showMessage('RING ' + this.ringsHit + '/' + this.ringsTotal + ' +500', 2);
    }
    this.score += gained;
    this.audio.ringChime();
    this.markRingPassed(ring, true);
    if (this.ringsHit >= this.ringsTotal) {
      this.completeSortie('All rings flown.');
    }
  }

  markRingPassed(ring, clean) {
    ring.children.forEach((child) => {
      if (child.material && child.material.color) {
        child.material = child.material.clone();
        child.material.color.setHex(clean ? 0x37c978 : 0x8a8578);
      }
    });
  }

  // A landing counts when the aircraft rolls to a stop on the runway, or when
  // the flight model reports a gentle touchdown there.
  checkLandingRoll(aircraft) {
    if (this.sortie !== 3) return;
    if (aircraft.onGround && aircraft.isOverRunway() && aircraft.speed < 6) {
      this.completeSortie('Wheels down on the centreline.');
    }
  }

  // A touchdown on the runway ends sortie 3, as long as it was not a crash:
  // the flight model already calls a crash above the hard-impact speed.
  // The greased bonus is only for a truly gentle arrival.
  onTouchdown(aircraft) {
    if (this.state !== 'flying') return;
    if (this.sortie === 3 && aircraft.isOverRunway()) {
      const vs = aircraft.impactVs || 0;
      let gained = SCORE.landingBase;
      let notes = 'LANDED +' + SCORE.landingBase;
      const centreErr = Math.abs(aircraft.position.x - RUNWAY.x);
      if (centreErr < 6) {
        gained += SCORE.landingCentreBonus;
        notes += '  CENTRELINE +' + SCORE.landingCentreBonus;
      }
      if (vs < 1.6) {
        gained += SCORE.landingGentleBonus;
        notes += '  GREASED +' + SCORE.landingGentleBonus;
      }
      this.score += gained;
      this.audio.touchdownThud();
      this.completeSortie(notes);
    } else if (aircraft.isOverRunway()) {
      this.audio.touchdownThud();
      this.hud.showMessage('DOWN ON THE RUNWAY — ROLL TO A STOP', 2.5);
    }
  }

  completeSortie(note) {
    if (this.state !== 'flying') return;
    this.state = 'done';
    let timeBonus = 0;
    if (this.sortie === 2) {
      const under = Math.max(0, MISSIONS.sortie2.parTime - this.elapsed);
      timeBonus = Math.round(under * SCORE.timeBonusPerSecond);
      this.score += timeBonus;
    }
    this.result = {
      kind: 'complete',
      sortie: this.sortie,
      score: this.score,
      timeBonus,
      note: note || '',
      ringsHit: this.ringsHit,
      ringsTotal: this.ringsTotal,
    };
  }

  fail(kind, note) {
    if (this.state !== 'flying') return;
    this.state = 'failed';
    this.result = {
      kind,
      sortie: this.sortie,
      score: this.score,
      note: note || '',
      ringsHit: this.ringsHit,
      ringsTotal: this.ringsTotal,
    };
  }

  crash(reason) {
    if (this.state !== 'flying') return;
    this.audio.crashSound();
    this.fail('crashed', reason || 'You hit the ground.');
  }
}
