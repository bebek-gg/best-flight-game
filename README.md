# Skyward Run

[![Make the best flight game](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/bebek-gg/best-flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/bebek-gg/best-flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A complete original 3D flight game that plays offline in a desktop browser from its own files. Chase camera behind a low-poly prop plane over a seeded river valley — hills, a lake, trees, rocks, drifting clouds and a sun in a gradient sky.

## Fly

- **Sortie 1 · Ring Run** — take off from the runway and fly through 5 sky rings.
- **Sortie 2 · Canyon Dash** — low-level river run against the clock; low passes pay extra.
- **Sortie 3 · Homecoming** — land on the runway, gentle and on the centreline.

Fuel burns with throttle, a hard impact ends the sortie, and landings are scored on gentleness and centreline. The HUD shows altitude, speed, heading with a compass strip, throttle, fuel, vertical speed and a live attitude indicator. All sound is synthesised live in WebAudio: engine hum tied to throttle, wind, ring chimes, touchdown thud, crash, and a music toggle (M).

## Controls

W/S or ↑/↓ pitch · A/D or ←/→ bank and turn · Shift throttle up · Ctrl/F throttle down · hold left mouse to steer by pointer · P pause · R restart · M music · Enter start.

## Play

Serve `game/` with any static server and open `index.html`, or run `node serve.ts` from the kit layout. No network requests, no build step. Three.js r160 is vendored under `game/vendor/three.min.js`.

## Hand in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json` with `buildDossier` from `vendor/makefun-game.ts`:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

MIT licensed. Built for the make.fun bounty "Make the best flight game".
