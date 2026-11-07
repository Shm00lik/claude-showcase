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

## Plan
- [ ] Design review (independent)
- [ ] G: field geometry (`shared/field.js`) — worktree `.worktrees/geometry`, branch `feat/geometry`
- [ ] S: server + tests — `.worktrees/server`, `feat/server`
- [ ] C: client — `.worktrees/client`, `feat/client`
- [ ] Reviews per batch, fix rounds
- [ ] Merge into `main` (--no-ff), gates: `npm test`, live 2-client browser check
- [ ] Visual examples (screenshots in `docs/images/`), README

## Validation evidence
(filled as work lands)
