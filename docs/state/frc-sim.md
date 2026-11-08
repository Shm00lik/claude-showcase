# State: FRC 2026 LAN sim

## Agreed scope
Multiplayer LAN-only website (Chrome) to drive a simple 2026 FRC robot (KitBot) on the real 2026 REBUILT
field CAD. Driving only. Git repo with worktrees/commits, README, visual examples. Design: `frc-sim_design.md`.

## Decided for you - overrule if you disagree
1. **Field and robot models are the AdvantageScope exports of FIRST's official 2026 CAD** (`Field3d_2026FRCFieldV2`,
   `Robot_2026FRCKitBotV2`, release `archive-v1` of Mechanical-Advantage/AdvantageScopeAssets), committed as GLBs.
   Why: web-ready glTF of the real CAD; converting raw Onshape/STEP in-browser is not feasible.
   Alternative: export from FIRST's Onshape document ourselves.
2. **GLBs (~39 MB) are committed to git**, so the sim works on an offline LAN. Alternative: a fetch-assets script.
3. **The robot is the 2026 KitBot** (FIRST's official kit robot that year). Alternative: a hand-built generic drivetrain.
4. **Server-authoritative 2D physics, no client prediction.** On a LAN, latency is a few ms. Alternative: client prediction.
5. **Max 6 drivers (3v3), no spectators.** Alternative: unlimited spectators.
6. **Runtime deps: `three` and `ws` only**, three served locally. Alternative: CDN three.
7. **Bumps are drivable with visual-only tilt; trench openings drivable.** Alternative: 3D physics engine.

8. **Host header must be an IP literal or `localhost`** (DNS-rebinding guard); opening by hostname (`mypc.local`) is refused. Alternative: allow-list hostnames.
9. **Names reject all control/format characters** (`\p{Cc}\p{Cf}\p{Cs}`), which also rejects ZWJ emoji sequences. Alternative: allow ZWJ.
10. **Front of the robot follows the AdvantageScope KitBot config**, although the CAD mesh named "Front Bumper" ends up at the rear. Alternative: flip ROBOT_MODEL yaw by π.

## Plan (status)
- [x] Design review (independent, Opus): READY AFTER FIXES → 13 findings applied to the design doc
- [x] G: field geometry (`shared/field.js`), branch `feat/geometry` → merged f7f3263
- [x] G1 fix: field CAD was 180° off (found in live test) → `fix/field-rotation` merged 3a4d268
- [x] S: server, branch `feat/server`; review READY AFTER FIXES (H1 crash on 13th socket, M1 untested guards, L1-L3) → fixed, narrow re-review READY
- [x] C: client, branch `feat/client`; live test found join crash (C1), chrome floor (C2); review READY AFTER FIXES (R1-R5) → fixed, lead-verified
- [x] Merged to `main` (e19e3e6), gates green
- [x] Visual examples (`docs/images/`), README

## Validation evidence
- `npm test` on main e19e3e6: 34 tests, 34 pass, 0 fail.
- Live run on main in Chrome (built-in browser, 1280x720): 6 robots (1 keyboard driver + 5 scripted ws clients) joined 3v3, driving/turning/collision with hub confirmed via server state (`W` from x=6,h=π → x=4.65; `A` → h 3.14→4.72; stopped at red hub edge x≈4.24+0.42).
- From the LAN IP: `GET http://192.168.1.44:3000/` 200; KitBot GLB 200 `model/gltf-binary` 21,270,876 B; Host `evil.example` → 403; `/../package.json` → 404.
- Not verified: frame rate (the browser pane was hidden, which throttles rAF to ~1 Hz; the 16-18 fps HUD reading is not meaningful); real gamepad; two physical machines on a LAN.

## v2: FUEL collect + shoot (requested 2026-11-08)
Owner asked: "add collecting and shooting balls at the target" and a gameplay video. Design: v2 section of
`frc-sim_design.md`. Classified big (wire contract + sim); scaled: lead wrote the design addendum from the existing
contract, one review per batch, acceptance live before close.

### Decided for you - overrule if you disagree
11. **Auto-intake on the front bumper, hold Space to shoot (4 balls/s), capacity 8.** Alternative: intake button.
12. **Fixed shooter (no aiming of pitch/speed); sweet spot 2.5 m from the hub, shown as a ring.** Alternative: variable speed by distance (auto-aim).
13. **100 FUEL on the field, starting as a grid in the neutral zone; scored FUEL exits the hub back toward the centre after 1 s.** Alternative: the real REBUILT layout (depots, outposts, ~400 fuel).
14. **Any ball entering a hub scores for that hub's alliance (no own-goal rules), score never resets while the server runs.** Alternative: match timer with reset.
15. **No hub active/inactive shifts.**

### Plan (status)
- [x] S2 server (`feat/fuel-server`), C2 client (`feat/fuel-client`) in parallel worktrees
- [x] Review (Opus) of the merged diff: READY AFTER FIXES (F1 MEDIUM balls stuck in towers; F3-F5 low) -> fixed, narrow re-review READY
- [x] Merged via `feat/fuel` integration branch, gates green, live acceptance with recorder
- [x] Gameplay video (`docs/media/gameplay.mp4`, `.gif`), recorder `tools/record-gameplay.mjs`, README

### Validation evidence (v2)
- `npm test` on feat/fuel: 48/48, run 4 times back to back, all green. The S2 implementer saw two unexplained
  9-failure runs; not reproduced (likely load from the lead's concurrent Chrome recording on the same machine).
- Reviewer ran a 36,000-step random sim (6 robots, 100 balls): held invariant holds, no NaN, no escapes,
  0.34 ms/step, ~2.4 KB snapshots; shooter scores from 2.0-2.9 m.
- Live: 60 s recording, 1 Chrome player (CDP keys) + 5 ws bots, ~56 fps in Chrome at 1280x720: red 72, blue 66.

### Follow-ups
- N1 (LOW): `server/sim.js` perimeter extension of obstacles for balls assumes rot 0; add `rot === 0 &&` if a
  rotated wall-touching obstacle is ever added.
- Not verified: gamepad shoot buttons (no controller), two physical machines.
