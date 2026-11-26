// Skyward Run — main.js
// One clear job: wiring. The game state machine (start screen, flying,
// paused, crashed, complete), the animation loop, the screens, and the
// ?shot= staging hooks the screenshots use. The flight model, the missions,
// the HUD and the sound each live in their own file.

import * as THREE from 'three';
import { RUNWAY, clamp } from './config.js';
import { FlightAudio } from './audio.js';
import {
  buildTerrainMesh, buildWater, buildRunway, buildVegetation,
  buildClouds, updateClouds, terrainHeightAt, meshHeightAt,
} from './terrain.js';
import { buildAircraft, Aircraft } from './aircraft.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { MissionManager } from './missions.js';
import { createRenderer, buildSky, buildLights, buildFog, ChaseCamera } from './render.js';

// Game states: menu -> flying -> paused -> (done | crashed) -> flying again.
const STATE = { MENU: 'menu', FLYING: 'flying', PAUSED: 'paused', DONE: 'done', CRASHED: 'crashed' };

const canvas = document.getElementById('game-canvas');
const urlParams = new URLSearchParams(window.location.search);
// ?lowfx=1 drops antialiasing: the automated playtest runs on software
// rendering, where AA costs most of the frame rate. Real play is unaffected.
const renderer = createRenderer(canvas, { antialias: urlParams.get('lowfx') !== '1' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 9000);

buildFog(scene);
buildSky(scene);
buildLights(scene);
const terrainMesh = buildTerrainMesh(scene);
buildWater(scene);
buildRunway(scene);
const vegetation = buildVegetation(scene, terrainMesh);
const clouds = buildClouds(scene);

const aircraftMesh = buildAircraft();
scene.add(aircraftMesh);
const aircraft = new Aircraft(aircraftMesh, terrainHeightAt);
const audio = new FlightAudio();
const hud = new Hud(document.getElementById('hud'));
const missions = new MissionManager(scene, audio, hud);
const chase = new ChaseCamera(camera);
const controls = new Controls(canvas);

let state = STATE.MENU;
let elapsed = 0;
let lastNow = performance.now();
let totalScore = 0;
let crashReason = '';
let shotMode = null;

const screens = {
  menu: document.getElementById('screen-menu'),
  pause: document.getElementById('screen-pause'),
  end: document.getElementById('screen-end'),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  document.getElementById('hud').classList.toggle('hidden', name === 'menu');
}

function startSortie(n) {
  aircraft.resetToRunway();
  if (n === 3) {
    // Homecoming starts in the air, on final approach from the north over
    // the level approach corridor, heading south onto the strip.
    aircraft.placeInAir(RUNWAY.x, 150, RUNWAY.z - 1000, Math.PI, 52);
  }
  missions.startSortie(n, aircraft);
  chase.snap(aircraft);
  aircraft.syncMesh(0);
  state = STATE.FLYING;
  showScreen(null);
  hud.showMessage('SORTIE ' + n + ' — ' + missions.def.name, 4);
  audio.ensure();
}

function startGame() {
  totalScore = 0;
  controls.clear();
  startSortie(1);
}

function endSortieScreen() {
  const r = missions.result;
  const title = document.getElementById('end-title');
  const body = document.getElementById('end-body');
  const next = document.getElementById('btn-next');
  if (!r) return;
  if (r.kind === 'complete') {
    totalScore = r.score;
    state = STATE.DONE;
    title.textContent = r.sortie === 3 ? 'WELCOME HOME, PILOT' : 'SORTIE COMPLETE';
    let lines = 'Score: ' + r.score + ' pts';
    if (r.ringsTotal > 0) lines += '   •   Rings ' + r.ringsHit + '/' + r.ringsTotal;
    if (r.timeBonus > 0) lines += '   •   Time bonus +' + r.timeBonus;
    if (r.note) lines += '\n' + r.note;
    if (r.sortie === 3) {
      lines += '\n\nAll three sorties flown. Final score: ' + totalScore + ' pts.';
      next.textContent = 'FLY AGAIN';
    } else {
      lines += '\n\nNext: Sortie ' + (r.sortie + 1) + ' — '
        + (r.sortie + 1 === 2 ? 'Canyon Dash' : 'Homecoming') + '.';
      next.textContent = 'NEXT SORTIE';
    }
    body.textContent = lines;
  } else {
    state = STATE.CRASHED;
    title.textContent = r.kind === 'crashed' ? 'CRASHED' : r.kind === 'timeout' ? 'OUT OF TIME' : 'SORTIE FAILED';
    body.textContent = (r.note || '') + '\nScore so far: ' + r.score + ' pts.';
    next.textContent = 'TRY AGAIN';
  }
  showScreen('end');
  audio.idle();
}

// --- Buttons and keys -------------------------------------------------------

document.getElementById('btn-start').addEventListener('click', () => {
  audio.ensure();
  audio.clickSound();
  startGame();
});
document.getElementById('btn-next').addEventListener('click', () => {
  audio.ensure();
  audio.clickSound();
  const r = missions.result;
  if (r && r.kind === 'complete' && r.sortie < 3) startSortie(r.sortie + 1);
  else startGame();
});
document.getElementById('btn-resume').addEventListener('click', () => {
  audio.ensure();
  togglePause();
});
document.getElementById('btn-restart-pause').addEventListener('click', () => {
  audio.ensure();
  startGame();
});

function togglePause() {
  if (state === STATE.FLYING) {
    state = STATE.PAUSED;
    showScreen('pause');
    audio.idle();
  } else if (state === STATE.PAUSED) {
    state = STATE.FLYING;
    showScreen(null);
    audio.ensure();
  }
}

controls.onPause = () => togglePause();
controls.onRestart = () => {
  if (state === STATE.FLYING || state === STATE.PAUSED || state === STATE.DONE || state === STATE.CRASHED) {
    audio.ensure();
    startGame();
  }
};
controls.onMusic = () => {
  audio.ensure();
  const on = audio.toggleMusic();
  hud.showMessage(on ? 'MUSIC ON' : 'MUSIC OFF', 1.5);
};
controls.onStart = () => {
  if (state === STATE.MENU) {
    audio.ensure();
    startGame();
  } else if (state === STATE.DONE || state === STATE.CRASHED) {
    audio.ensure();
    const r = missions.result;
    if (r && r.kind === 'complete' && r.sortie < 3) startSortie(r.sortie + 1);
    else startGame();
  }
};
controls.onAnyKey = () => audio.ensure();
controls.attach();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- The loop ----------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastNow) / 1000, 0.001, 0.05);
  lastNow = now;
  if (state === STATE.FLYING) {
    elapsed += dt;
    const input = controls.read();
    const events = aircraft.update(dt, input);
    aircraft.syncMesh(elapsed);
    missions.update(dt, aircraft);
    if (events.crashed) {
      missions.crash('You hit the ground at ' + Math.round(aircraft.speed * 1.94) + ' kt.');
      crashReason = missions.result ? missions.result.note : '';
      endSortieScreen();
    } else if (events.touchedDown) {
      missions.onTouchdown(aircraft);
      if (missions.state === 'done') endSortieScreen();
    } else if (missions.state === 'done' || missions.state === 'failed') {
      endSortieScreen();
    }
    audio.update(aircraft.throttle, aircraft.speed, aircraft.airborne);
    hud.update(aircraft, {
      name: missions.def.name,
      objective: missions.objective,
      score: missions.score,
      timeLeft: missions.timeLeft,
      ringsHit: missions.ringsHit,
      ringsTotal: missions.ringsTotal,
      sortie: missions.sortie,
    }, dt);
    updateClouds(clouds, elapsed);
    chase.update(aircraft, dt);
  } else if (state === STATE.MENU) {
    // Idle menu backdrop: slow orbit around the runway so the title screen
    // shows the valley, the strip and the parked aircraft.
    elapsed += dt;
    const a = elapsed * 0.045;
    camera.position.set(RUNWAY.x + Math.sin(a) * 260, 120, RUNWAY.z + Math.cos(a) * 260);
    camera.lookAt(RUNWAY.x, RUNWAY.height + 4, RUNWAY.z);
    updateClouds(clouds, elapsed);
    aircraft.syncMesh(elapsed);
  }
  renderer.render(scene, camera);
}

// --- Screenshot staging ------------------------------------------------------
// ?shot=cover|ring|low|land stages a frozen, framed moment for screenshots:
// the game starts the right sortie, places the aircraft, snaps the camera,
// renders one settled frame and stops the simulation. The game itself is
// untouched for normal play; these hooks only run with the query present.

function stageShot(mode) {
  shotMode = mode;
  if (mode === 'cover') {
    startSortie(1);
    aircraft.throttle = 0.85;
    aircraft.speed = 34;
    aircraft.position.set(RUNWAY.x, RUNWAY.height + 6, RUNWAY.z + 130);
    aircraft.pitch = 0.12;
    chase.snap(aircraft);
  } else if (mode === 'ring') {
    startSortie(1);
    // Ring 1 sits over the runway corridor, which is kept clear of trees,
    // so the ring reads cleanly from the approach with nothing in the way.
    const centre = { x: 60, y: 70, z: 420 };
    aircraft.position.set(centre.x + 6, centre.y + 10, centre.z + 95);
    aircraft.heading = 0;
    aircraft.pitch = 0.06;
    aircraft.speed = 58;
    aircraft.throttle = 0.7;
    aircraft.airborne = true;
    aircraft.onGround = false;
    chase.snap(aircraft);
  } else if (mode === 'low') {
    startSortie(2);
    // Low over the river in the wide southern valley (the channel at z=500
    // is x≈-95), looking north down the run: the winding river and its
    // banks ahead, the first canyon ring dead ahead, green hills both sides.
    aircraft.position.set(-140, 55, 500);
    aircraft.heading = 0;
    aircraft.pitch = 0.02;
    aircraft.speed = 72;
    aircraft.throttle = 0.8;
    aircraft.airborne = true;
    aircraft.onGround = false;
    chase.snap(aircraft);
  } else if (mode === 'land') {
    startSortie(3);
    aircraft.position.set(RUNWAY.x + 12, 50, RUNWAY.z - 300);
    aircraft.heading = Math.PI;
    aircraft.pitch = -0.04;
    aircraft.speed = 46;
    aircraft.throttle = 0.35;
    aircraft.airborne = true;
    aircraft.onGround = false;
    chase.snap(aircraft);
  }
  aircraft.syncMesh(0);
  hud.update(aircraft, {
    name: missions.def.name,
    objective: missions.objective,
    score: missions.score,
    timeLeft: missions.timeLeft,
    ringsHit: missions.ringsHit,
    ringsTotal: missions.ringsTotal,
    sortie: missions.sortie,
  }, 0);
  renderer.render(scene, camera);
  // Freeze: stop the animation loop from advancing the world.
  state = STATE.PAUSED;
}

// --- Debug hooks for the playtest -------------------------------------------
// window.__skyward is a test-only handle: the automated playtest drives the
// game through it and reads state back. It changes nothing for a player.

window.__skyward = {
  state: () => state,
  aircraft,
  missions,
  hud,
  audio,
  controls,
  terrainHeightAt,
  meshHeightAt,
  terrainMesh,
  vegetation,
  startGame,
  startSortie,
  togglePause,
  setAircraft(x, y, z, heading, speed, throttle) {
    aircraft.position.set(x, y, z);
    aircraft.heading = heading;
    aircraft.speed = speed;
    aircraft.throttle = throttle;
    aircraft.airborne = true;
    aircraft.onGround = false;
    aircraft.verticalSpeed = 0;
    chase.snap(aircraft);
    aircraft.syncMesh(0);
  },
  crashReason: () => crashReason,
};

// --- Boot --------------------------------------------------------------------

showScreen('menu');
const params = urlParams;
if (params.get('shot')) {
  audio.ensure = () => false;
  stageShot(params.get('shot'));
  // Keep rendering the frozen frame so the screenshot is stable.
  renderer.render(scene, camera);
} else {
  requestAnimationFrame(frame);
}
