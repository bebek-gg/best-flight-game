// Skyward Run — terrain.js
// One clear job: the world itself. A seeded heightmap valley with a river and
// a lake, a flattened runway strip, scattered trees and rocks, drifting
// clouds, and the glowing sky rings. Every placement draws from the seeded
// stream in a fixed order, so the layout is identical on every run.

import * as THREE from 'three';
import { WORLD, RUNWAY, WORLD_SEED, fbm2D, clamp, lerp, mulberry32 } from './config.js';

// Height of the ground at world (x, z), in metres. Pure function of position.
export function terrainHeightAt(x, z) {
  const half = WORLD.half;
  // Rolling hills from fractal noise, rising toward the valley edges.
  const nx = x / 620;
  const nz = z / 620;
  let h = fbm2D(nx + 3.7, nz + 9.1, WORLD_SEED) * WORLD.maxHeight;
  const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
  h += Math.max(0, edge - 0.55) * 260;
  // River carve: a flat-bottomed valley along a gently winding line. The
  // channel floor stays at the waterline for the first ~14 m, then rises
  // linearly to the banks, so the river reads as a narrow channel with
  // visible banks instead of a dry V-valley whose water sits below its bed.
  // Linear banks, not a smoothstep: the smoothstep's mid-slope topped 0.55
  // and turned the whole valley rock-brown; linear keeps the banks grass.
  const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
  const riverDist = Math.abs(x - riverCentre);
  const carveU = clamp((riverDist - 14) / (WORLD.riverWidth * 2.2 - 14), 0, 1);
  const carve = 1 - carveU;
  h = lerp(h, 1.0, carve * 0.98);
  // Lake bowl at the north end of the river.
  const lakeDist = Math.hypot(x - WORLD.riverX, z - WORLD.lakeZ);
  const lakeCarve = Math.max(0, 1 - lakeDist / WORLD.lakeRadius);
  h = lerp(h, 1.5, lakeCarve * lakeCarve);
  // Runway flattening: the strip and a small apron around it are level.
  const rx = Math.abs(x - RUNWAY.x);
  const rz = Math.abs(z - RUNWAY.z);
  const flat = Math.max(0, 1 - rx / (RUNWAY.width * 2.4)) * Math.max(0, 1 - rz / (RUNWAY.length * 0.62));
  h = lerp(h, RUNWAY.height, clamp(flat * 1.4, 0, 1));
  // Approach corridor: a clear, level funnel along the runway axis so final
  // approaches from either end stay above the ground instead of meeting a
  // hillside. It tapers out sideways and with distance from the strip.
  const corridorX = Math.max(0, 1 - rx / (RUNWAY.width * 2.2));
  const corridorZ = Math.max(0, 1 - rz / 1050);
  const corridor = corridorX * corridorZ;
  h = lerp(h, RUNWAY.height, clamp(corridor * 2.2, 0, 1));
  return h;
}

// --- Sampling the rendered mesh -------------------------------------------
// The analytic terrainHeightAt and the mesh disagree by up to a few metres
// on steep ground (the mesh is a 20 m grid, the formula is smooth), which is
// what left trees floating. Vegetation must be planted on the mesh, not the
// formula, so sample the mesh's own triangles: the PlaneGeometry is a
// regular grid, each quad split on the (i,j)-(i+1,j+1) diagonal, and the
// heights come straight from its displaced vertices.
let meshGrid = null; // { heights, step, half, n }

export function sampleMeshHeight(mesh) {
  const pos = mesh.geometry.attributes.position;
  const n = Math.round(Math.sqrt(pos.count));
  const heights = new Float32Array(n * n);
  for (let k = 0; k < n * n; k += 1) heights[k] = pos.getY(k);
  meshGrid = { heights, step: WORLD.size / (n - 1), half: WORLD.half, n };
}

export function meshHeightAt(x, z) {
  const g = meshGrid;
  if (!g) return terrainHeightAt(x, z);
  const fx = clamp((x + g.half) / g.step, 0, g.n - 1.001);
  const fz = clamp((z + g.half) / g.step, 0, g.n - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const h00 = g.heights[j * g.n + i];
  const h10 = g.heights[j * g.n + i + 1];
  const h11 = g.heights[(j + 1) * g.n + i + 1];
  const h01 = g.heights[(j + 1) * g.n + i];
  if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
  return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

// The terrain is one big PlaneGeometry, displaced by terrainHeightAt and
// coloured per-vertex: grass green on the flats, rock grey on the steep
// slopes, sand near the water, snow on the highest peaks.
export function buildTerrainMesh(scene) {
  const segments = 128;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x4d8a3f);
  const grassDry = new THREE.Color(0x7fae4e);
  const rock = new THREE.Color(0x8a8578);
  const sand = new THREE.Color(0xc9b078);
  const snow = new THREE.Color(0xe8eef2);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeightAt(x, z);
    pos.setY(i, h);
    // Slope from the height difference to the neighbour in +x.
    const hNext = terrainHeightAt(x + 8, z);
    const slope = Math.abs(hNext - h) / 8;
    if (h < 5) c.copy(sand);
    else if (slope > 0.55) c.copy(rock);
    else if (h > 150) c.copy(snow);
    else {
      c.copy(grass).lerp(grassDry, fbm2D(x / 260 + 11, z / 260 + 5, WORLD_SEED + 77));
    }
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}

// Water: a ribbon of short flat segments following the winding river
// carve, plus a disc for the lake, both slightly transparent so the sandy
// bed shows through at the edges. The ribbon follows the carve's centre
// line, so the water stays in the valley instead of a straight strip the
// river wanders away from.
export function buildWater(scene) {
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x2568a8, transparent: true, opacity: 0.9,
  });
  const segLen = 44;
  const segGeo = new THREE.PlaneGeometry(110, segLen);
  for (let z = -WORLD.half; z <= WORLD.half; z += segLen * 0.9) {
    const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
    const seg = new THREE.Mesh(segGeo, waterMat);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(riverCentre, 3.1, z);
    scene.add(seg);
  }
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD.lakeRadius * 0.94, 40),
    waterMat,
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(WORLD.riverX, 3.2, WORLD.lakeZ);
  scene.add(lake);
}

// The runway: dark asphalt strip, white centre dashes, threshold bars and a
// pair of windsock poles, all sitting on the flattened ground.
export function buildRunway(scene) {
  const group = new THREE.Group();
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length),
    new THREE.MeshLambertMaterial({ color: 0x3a3d42 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(RUNWAY.x, RUNWAY.height + 0.15, RUNWAY.z);
  group.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2f2e8 });
  for (let i = -5; i <= 5; i += 1) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 14), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(RUNWAY.x, RUNWAY.height + 0.3, RUNWAY.z + i * 34);
    group.add(dash);
  }
  // Threshold bars at both ends.
  for (const end of [-1, 1]) {
    for (let k = -2; k <= 2; k += 1) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(3, 16), dashMat);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(RUNWAY.x + k * 5.4, RUNWAY.height + 0.3, RUNWAY.z + end * (RUNWAY.length / 2 - 12));
      group.add(bar);
    }
  }
  // Windsock on a pole beside the strip.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 9, 6),
    new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }),
  );
  pole.position.set(RUNWAY.x + RUNWAY.width / 2 + 8, RUNWAY.height + 4.5, RUNWAY.z - 120);
  group.add(pole);
  const sock = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 5, 8),
    new THREE.MeshLambertMaterial({ color: 0xff7a1a }),
  );
  sock.rotation.z = Math.PI / 2.4;
  sock.position.set(RUNWAY.x + RUNWAY.width / 2 + 10.5, RUNWAY.height + 8.6, RUNWAY.z - 120);
  group.add(sock);
  scene.add(group);
  return group;
}

// --- Vegetation and rocks --------------------------------------------------
// Instanced meshes keep the draw calls low: one cone+cylinder pair per tree
// shape, one dodecahedron per rock, all placed by the seeded stream.

export function buildVegetation(scene, terrainMesh) {
  const rng = mulberry32(WORLD_SEED + 501);
  if (terrainMesh) sampleMeshHeight(terrainMesh);
  // Keep the sightlines to the sky rings clear: no tree within 45 m of a
  // ring centre on either sortie's path, or a ring hides behind a pine.
  const ringClearings = [...ringPathForSortie(1), ...ringPathForSortie(2)];
  const nearRing = (x, z) => ringClearings.some((r) => Math.hypot(x - r.x, z - r.z) < 45);
  const treeCount = 420;
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1.0, 5, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
  const crownGeo = new THREE.ConeGeometry(4.2, 13, 7);
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2e6b2f });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < treeCount && guard < 20000) {
    guard += 1;
    const x = (rng() * 2 - 1) * (WORLD.half - 60);
    const z = (rng() * 2 - 1) * (WORLD.half - 60);
    const h = terrainHeightAt(x, z);
    if (h < 6 || h > 120) continue;
    // Keep the runway and its approach corridor clear.
    if (Math.abs(x - RUNWAY.x) < 70 && Math.abs(z - RUNWAY.z) < 1050) continue;
    if (nearRing(x, z)) continue;
    const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
    if (Math.abs(x - riverCentre) < WORLD.riverWidth * 1.6) continue;
    // Plant on the rendered mesh, not the formula, and reject ground too
    // steep for a trunk to sit on: on a steep bank one side of the trunk
    // floats while the other buries. Sink the base a little so any small
    // mismatch buries the trunk instead of floating it.
    const mh = meshHeightAt(x, z);
    const slope = Math.max(
      Math.abs(meshHeightAt(x + 6, z) - meshHeightAt(x - 6, z)) / 12,
      Math.abs(meshHeightAt(x, z + 6) - meshHeightAt(x, z - 6)) / 12,
    );
    if (slope > 0.55) continue;
    const s = 0.7 + rng() * 0.9;
    dummy.position.set(x, mh - 0.7 * s + 2.5 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = mh - 0.7 * s + (5 + 6.5) * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  trunks.count = placed;
  crowns.count = placed;
  scene.add(trunks);
  scene.add(crowns);

  // Rocks: grey dodecahedrons, mostly on the high slopes. Planted on the
  // mesh and sunk well in, so they read as half-buried boulders, never as
  // stones floating above a slope.
  const rockCount = 160;
  const rockGeo = new THREE.DodecahedronGeometry(3.2, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7a72 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  let rocksPlaced = 0;
  let rockGuard = 0;
  while (rocksPlaced < rockCount && rockGuard < 4000) {
    rockGuard += 1;
    const x = (rng() * 2 - 1) * (WORLD.half - 80);
    const z = (rng() * 2 - 1) * (WORLD.half - 80);
    // Keep the runway and its approach corridor clear: a boulder on the
    // strip reads as debris on the runway.
    if (Math.abs(x - RUNWAY.x) < 70 && Math.abs(z - RUNWAY.z) < 1050) continue;
    const h = meshHeightAt(x, z);
    const s = 0.5 + rng() * 1.6;
    dummy.position.set(x, h + 0.4 * s, z);
    dummy.scale.set(s, s * 0.7, s);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.updateMatrix();
    rocks.setMatrixAt(rocksPlaced, dummy.matrix);
    rocksPlaced += 1;
  }
  rocks.count = rocksPlaced;
  scene.add(rocks);
  return { trees: placed, rocks: rocksPlaced };
}

// --- Landmarks ---------------------------------------------------------------
// A small town, a bridge over the river and distant mountains. Every
// placement draws from the seeded stream in a fixed order, so the layout is
// identical on every run. The town stays clear of the runway corridor, the
// ring paths and the river; the bridge deck clears the banks; the mountains
// ring the horizon far outside the flyable valley.

const TOWN = { x: 300, z: 100 };
const BRIDGE_Z = 150;

export function buildLandmarks(scene, terrainMesh) {
  const rng = mulberry32(WORLD_SEED + 1207);
  if (terrainMesh) sampleMeshHeight(terrainMesh);
  const group = new THREE.Group();
  group.name = 'landmarks';
  const counts = { houses: 0, mountains: 0 };

  // --- Town: instanced walls and pyramid roofs -----------------------------
  const ringClearings = [...ringPathForSortie(1), ...ringPathForSortie(2)];
  const nearRing = (x, z) => ringClearings.some((r) => Math.hypot(x - r.x, z - r.z) < 45);
  const houseCount = 26;
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const roofGeo = new THREE.ConeGeometry(1, 1, 4);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, houseCount);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, houseCount);
  const wallColours = [0xf2e6c9, 0xb56a4a, 0xf4f1e8, 0xe8d9a0, 0xd9c1a3].map((c) => new THREE.Color(c));
  const roofColours = [0xa34a28, 0x5a6a72, 0x6b4a2b, 0x8a3b2a].map((c) => new THREE.Color(c));
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < houseCount && guard < 4000) {
    guard += 1;
    const x = TOWN.x + (rng() * 2 - 1) * 110;
    const z = TOWN.z + (rng() * 2 - 1) * 90;
    if (Math.abs(x - RUNWAY.x) < 70 && Math.abs(z - RUNWAY.z) < 1050) continue;
    if (nearRing(x, z)) continue;
    const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
    if (Math.abs(x - riverCentre) < WORLD.riverWidth * 1.6) continue;
    const mh = meshHeightAt(x, z);
    if (mh < 6) continue;
    const slope = Math.max(
      Math.abs(meshHeightAt(x + 6, z) - meshHeightAt(x - 6, z)) / 12,
      Math.abs(meshHeightAt(x, z + 6) - meshHeightAt(x, z - 6)) / 12,
    );
    if (slope > 0.55) continue;
    const w = 8 + rng() * 4;
    const h = 5 + rng() * 2;
    const d = 7 + rng() * 3;
    const rot = rng() * Math.PI;
    dummy.position.set(x, mh + h / 2 - 0.3, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    walls.setMatrixAt(placed, dummy.matrix);
    walls.setColorAt(placed, wallColours[Math.floor(rng() * wallColours.length)]);
    const roofH = 3 + rng() * 1.5;
    const roofR = Math.max(w, d) * 0.72;
    dummy.position.set(x, mh + h - 0.3 + roofH / 2, z);
    dummy.scale.set(roofR, roofH, roofR);
    dummy.rotation.set(0, rot + Math.PI / 4, 0);
    dummy.updateMatrix();
    roofs.setMatrixAt(placed, dummy.matrix);
    roofs.setColorAt(placed, roofColours[Math.floor(rng() * roofColours.length)]);
    placed += 1;
  }
  walls.count = placed;
  roofs.count = placed;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  group.add(walls);
  group.add(roofs);
  counts.houses = placed;

  // --- Church: a taller landmark the pilot can spot from the air -----------
  const churchX = TOWN.x + 30;
  const churchZ = TOWN.z - 40;
  const churchH = meshHeightAt(churchX, churchZ);
  const church = new THREE.Group();
  const nave = new THREE.Mesh(
    new THREE.BoxGeometry(10, 13, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2e6c9 }),
  );
  nave.position.y = 6.5;
  church.add(nave);
  const naveRoof = new THREE.Mesh(
    new THREE.ConeGeometry(7.2, 4.5, 4),
    new THREE.MeshLambertMaterial({ color: 0x5a6a72 }),
  );
  naveRoof.position.y = 13 + 2.25;
  naveRoof.rotation.y = Math.PI / 4;
  church.add(naveRoof);
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(4, 18, 4),
    new THREE.MeshLambertMaterial({ color: 0xf4f1e8 }),
  );
  tower.position.set(0, 9, 5.5);
  church.add(tower);
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(2.9, 6, 4),
    new THREE.MeshLambertMaterial({ color: 0x8a3b2a }),
  );
  spire.position.set(0, 18 + 3, 5.5);
  spire.rotation.y = Math.PI / 4;
  church.add(spire);
  church.position.set(churchX, churchH - 0.3, churchZ);
  church.rotation.y = 0.4;
  group.add(church);

  // --- Bridge: a deck across the river with piers and railings -------------
  // Pale concrete, so the deck reads as a bridge against the valley instead
  // of a black bar; the deck sits just above the higher bank.
  const riverCentre = WORLD.riverX + Math.sin(BRIDGE_Z * 0.0016) * 90;
  const bankL = meshHeightAt(riverCentre - 100, BRIDGE_Z);
  const bankR = meshHeightAt(riverCentre + 100, BRIDGE_Z);
  const deckY = Math.max(bankL, bankR) + 2;
  const bridge = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(210, 1.4, 9),
    new THREE.MeshLambertMaterial({ color: 0xb5ada0 }),
  );
  deck.position.set(riverCentre, deckY, BRIDGE_Z);
  bridge.add(deck);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(210, 1.1, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x8a4a2a }),
    );
    rail.position.set(riverCentre, deckY + 1.2, BRIDGE_Z + side * 4.3);
    bridge.add(rail);
  }
  for (const px of [-40, 40]) {
    const pier = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.2, deckY - 1, 8),
      new THREE.MeshLambertMaterial({ color: 0x8f867a }),
    );
    pier.position.set(riverCentre + px, (deckY - 1) / 2 + 1, BRIDGE_Z);
    bridge.add(pier);
  }
  group.add(bridge);

  // --- Mountains: a ring of snow-capped peaks on the horizon ----------------
  // Far outside the flyable valley (radius 2100+), so they never meet the
  // aircraft; the fog hazes them into pale blue silhouettes, which is
  // exactly how distant mountains read. Bases sit below the valley rim.
  const mountainMat = new THREE.MeshLambertMaterial({ color: 0x6a7a8a });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xe8eef2 });
  const peakCount = 10;
  for (let i = 0; i < peakCount; i += 1) {
    const angle = (i / peakCount) * Math.PI * 2 + (rng() - 0.5) * 0.45;
    const radius = 2100 + rng() * 600;
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;
    const height = 550 + rng() * 400;
    const baseR = 320 + rng() * 200;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(baseR, height, 7), mountainMat);
    peak.position.set(px, -60 + height / 2, pz);
    peak.rotation.y = rng() * Math.PI;
    group.add(peak);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(baseR * 0.42, height * 0.32, 7), snowMat);
    cap.position.set(px, -60 + height * 0.84, pz);
    cap.rotation.y = peak.rotation.y;
    group.add(cap);
    counts.mountains += 1;
  }

  scene.add(group);
  return { group, counts };
}

// --- Clouds ------------------------------------------------------------------
// Puffy low-poly clouds: clusters of white flattened spheres, drifting slowly
// east. Unlit white, so they read as bright clouds against the sky instead
// of dark smudges: Lambert shading left their shaded sides almost black.
// Positions are seeded; the drift is a pure function of elapsed time.
export function buildClouds(scene) {
  const rng = mulberry32(WORLD_SEED + 909);
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const clouds = [];
  for (let i = 0; i < 26; i += 1) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rng() * 4);
    for (let p = 0; p < puffs; p += 1) {
      const puff = new THREE.Mesh(geo, mat);
      const s = 9 + rng() * 16;
      puff.scale.set(s, s * 0.45, s * 0.8);
      puff.position.set((rng() - 0.5) * 34, (rng() - 0.5) * 6, (rng() - 0.5) * 20);
      cloud.add(puff);
    }
    cloud.position.set(
      (rng() * 2 - 1) * (WORLD.half - 100),
      190 + rng() * 130,
      (rng() * 2 - 1) * (WORLD.half - 100),
    );
    group.add(cloud);
    clouds.push({ group: cloud, speed: 1.5 + rng() * 2.5, baseX: cloud.position.x });
  }
  scene.add(group);
  return clouds;
}

export function updateClouds(clouds, elapsed) {
  for (const c of clouds) {
    let x = c.baseX + elapsed * c.speed;
    if (x > WORLD.half + 120) x -= (WORLD.size + 240);
    c.group.position.x = x;
  }
}

// --- Sky rings ---------------------------------------------------------------
// A ring is a glowing torus the aircraft flies through. The ring knows its
// centre and radius so the mission code can test a pass.

export function buildRing(radius, colour) {
  const group = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 1.6, 12, 40),
    new THREE.MeshBasicMaterial({ color: colour || 0xffb020 }),
  );
  group.add(torus);
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.55, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
  );
  group.add(inner);
  // A small beacon light above the ring so it is easy to spot from afar.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd24a }),
  );
  beacon.position.y = radius + 7;
  group.add(beacon);
  group.userData.radius = radius;
  return group;
}

// Ring flight paths, one per sortie. Centres are fixed in the world.
export function ringPathForSortie(sortieId) {
  if (sortieId === 1) {
    // Gentle climb north from the runway, over the river valley.
    return [
      { x: 60, y: 70, z: 420 },
      { x: -40, y: 95, z: 60 },
      { x: -160, y: 110, z: -280 },
      { x: -120, y: 130, z: -620 },
      { x: -160, y: 150, z: -880 },
    ];
  }
  // Sortie 2: low canyon run, hugging the river.
  return [
    { x: -140, y: 42, z: 300 },
    { x: -200, y: 38, z: -40 },
    { x: -110, y: 45, z: -380 },
    { x: -220, y: 40, z: -640 },
    { x: -150, y: 48, z: -900 },
    { x: -160, y: 55, z: -1080 },
  ];
}
