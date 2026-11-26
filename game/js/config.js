// Skyward Run — config.js
// One clear job: every constant, the seeded random generator and the small
// maths helpers the rest of the game shares. Nothing here touches the DOM or
// the renderer, so the world layout is identical on every run.

export const WORLD_SEED = 20261126;

// World size in metres. The flyable valley is a square; the runway sits near
// its southern edge and the rings run north up the river valley.
export const WORLD = {
  size: 2600,
  half: 1300,
  // Terrain height range (metres above sea level).
  minHeight: 0,
  maxHeight: 190,
  // River runs north-south, slightly west of centre, and widens into a lake.
  riverX: -160,
  riverWidth: 55,
  lakeZ: -950,
  lakeRadius: 230,
};

// Runway: a flat strip the aircraft starts on, heading north (+Z is north in
// this world is -Z; see RUNWAY below).
export const RUNWAY = {
  // Centre of the runway strip, in world metres.
  x: 60,
  z: 780,
  length: 420,
  width: 34,
  // Heading the aircraft faces at the start, radians. 0 = north (-Z).
  heading: 0,
  // The strip is flattened to this height.
  height: 24,
};

export const AIRCRAFT = {
  // Arcade flight model, metres / seconds / degrees.
  maxSpeed: 96,
  minFlySpeed: 26,
  cruiseSpeed: 62,
  accelPerThrottle: 34,
  drag: 0.055,
  pitchRate: 0.85,
  rollRate: 1.9,
  // Bank angle turns the nose; degrees of heading per second per radian bank.
  turnFromBank: 0.62,
  maxPitch: 0.6,
  maxRoll: 1.15,
  // Climb and sink rates the model aims for.
  climbAtFullThrottle: 11,
  sinkAtIdle: 6.5,
  // Fuel: percent per second at full throttle, scaled by throttle.
  fuelBurnFull: 0.55,
  fuelBurnIdle: 0.10,
  fuelStart: 100,
  // Damage: a touchdown harder than this vertical speed (m/s down) is a crash.
  hardImpactVs: 7.5,
  // Touchdown slower than this (m/s down) on the runway counts as a landing.
  gentleVs: 3.2,
};

export const MISSIONS = {
  sortie1: {
    id: 1,
    name: 'Ring Run',
    brief: 'Take off from the strip and fly through all 5 sky rings.',
    rings: 5,
    timeLimit: 240,
    fuelStart: 100,
  },
  sortie2: {
    id: 2,
    name: 'Canyon Dash',
    brief: 'Low-level run down the river canyon. Beat the clock, stay low.',
    rings: 6,
    timeLimit: 95,
    fuelStart: 100,
    // Bonus points per second under the par time.
    parTime: 75,
  },
  sortie3: {
    id: 3,
    name: 'Homecoming',
    brief: 'Bring her home. Land on the runway, gentle and on the centreline.',
    rings: 0,
    timeLimit: 300,
    fuelStart: 100,
  },
};

export const SCORE = {
  ring: 500,
  ringLowBonus: 150,
  landingBase: 1000,
  landingCentreBonus: 400,
  landingGentleBonus: 300,
  timeBonusPerSecond: 12,
};

// --- Seeded random ---------------------------------------------------------
// mulberry32: small, fast, deterministic. Every world feature draws from one
// stream in a fixed order, so the layout never changes between runs.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A deterministic 2D value-noise field from integer lattice points. The hash
// is pure arithmetic on the coordinates, so the terrain is a pure function of
// (x, z) and the seed, with no stored table at all.
export function latticeHash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = latticeHash(ix, iz, seed);
  const b = latticeHash(ix + 1, iz, seed);
  const c = latticeHash(ix, iz + 1, seed);
  const d = latticeHash(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

// Fractal brownian motion over the value noise: four octaves, each half the
// amplitude of the last. Returns 0..1.
export function fbm2D(x, z, seed) {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o += 1) {
    total += amp * valueNoise2D(x * freq, z * freq, seed + o * 131);
    amp *= 0.5;
    freq *= 2.03;
  }
  return total;
}

// --- Small maths helpers ---------------------------------------------------

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function radToDeg(r) {
  return (r * 180) / Math.PI;
}

// Wrap an angle to [-PI, PI).
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Compass heading in degrees, 0 = north, 90 = east, from a heading angle
// where 0 points north (-Z) and positive turns east.
export function headingDegrees(heading) {
  let d = radToDeg(heading) % 360;
  if (d < 0) d += 360;
  return d;
}

const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(degrees) {
  const idx = Math.round(degrees / 22.5) % 16;
  return COMPASS_POINTS[idx];
}

// Format a number with a fixed width for the HUD, e.g. padNumber(7, 3) = "007".
export function padNumber(v, width) {
  const s = String(Math.max(0, Math.round(v)));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}
