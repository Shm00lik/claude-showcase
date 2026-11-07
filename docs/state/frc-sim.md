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
