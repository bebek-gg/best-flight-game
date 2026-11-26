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
  // River carve: a smooth valley along a gently winding line.
  const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
  const riverDist = Math.abs(x - riverCentre);
  const carve = Math.max(0, 1 - riverDist / (WORLD.riverWidth * 2.2));
  h = lerp(h, 2, carve * carve * 0.92);
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

// Water: a flat blue plane for the river strip and a disc for the lake, both
// slightly transparent so the sand bed shows through at the edges.
export function buildWater(scene) {
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x2f7fc4, transparent: true, opacity: 0.82,
  });
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.riverWidth * 1.7, WORLD.size),
    waterMat,
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(WORLD.riverX, 3.2, 0);
  scene.add(river);
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

export function buildVegetation(scene) {
  const rng = mulberry32(WORLD_SEED + 501);
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
  while (placed < treeCount && guard < 4000) {
    guard += 1;
    const x = (rng() * 2 - 1) * (WORLD.half - 60);
    const z = (rng() * 2 - 1) * (WORLD.half - 60);
    const h = terrainHeightAt(x, z);
    if (h < 6 || h > 120) continue;
    // Keep the runway and its approach corridor clear.
    if (Math.abs(x - RUNWAY.x) < 70 && Math.abs(z - RUNWAY.z) < 1050) continue;
    if (nearRing(x, z)) continue;
    const riverCentre = WORLD.riverX + Math.sin(z * 0.0016) * 90;
    if (Math.abs(x - riverCentre) < WORLD.riverWidth) continue;
    const s = 0.7 + rng() * 0.9;
    dummy.position.set(x, h + 2.5 * s, z);
    dummy.scale.setScalar(s);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = h + (5 + 6.5) * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }
  trunks.count = placed;
  crowns.count = placed;
  scene.add(trunks);
  scene.add(crowns);

  // Rocks: grey dodecahedrons, mostly on the high slopes.
  const rockCount = 160;
  const rockGeo = new THREE.DodecahedronGeometry(3.2, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7a72 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  for (let i = 0; i < rockCount; i += 1) {
    const x = (rng() * 2 - 1) * (WORLD.half - 80);
    const z = (rng() * 2 - 1) * (WORLD.half - 80);
    const h = terrainHeightAt(x, z);
    const s = 0.5 + rng() * 1.6;
    dummy.position.set(x, h + 1.2 * s, z);
    dummy.scale.set(s, s * 0.7, s);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  scene.add(rocks);
  return { trees: placed, rocks: rockCount };
}

// --- Clouds ------------------------------------------------------------------
// Puffy low-poly clouds: clusters of white flattened spheres, drifting slowly
// east. Positions are seeded; the drift is a pure function of elapsed time.

export function buildClouds(scene) {
  const rng = mulberry32(WORLD_SEED + 909);
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
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
