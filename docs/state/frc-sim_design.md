# FRC 2026 LAN Sim — design (contract for all batches)

## Goal / non-goals
- Goal: up to 6 people on one LAN open `http://<host-ip>:3000` in Chrome, pick name/team/alliance,
  and drive a 2026 KitBot around the real 2026 REBUILT field CAD, seeing each other live.
- Non-goals (v1): shooting/intake/game pieces, scoring, match timer, internet play, spectators,
  accounts, persistence, mobile/touch controls.

## Layout and ownership
| Path | Owner batch |
|---|---|
| `public/assets/*.glb`, `*.config.json` | lead (committed, from AdvantageScopeAssets `archive-v1`) |
| `shared/field.js` | **G** geometry |
| `tools/inspect-glb.mjs` (+ debug output under `docs/`) | **G** geometry |
| `server/*.js`, `test/server-*.test.js` | **S** server |
| `public/index.html`, `public/css/*`, `public/js/*` | **C** client |
| `package.json`, `README.md`, `docs/state/*` | lead |

Runtime deps only: `three` (served from `node_modules/three` at `/vendor/three/`, no CDN — LAN may be
offline) and `ws`. No bundler: client uses an import map. Tests use `node:test` only.

## Coordinate frame (shared by server, client, field.js)
- Field frame: meters, **origin at field center**, `+x` toward the **red** alliance wall, `+y` to the left
  when standing at the blue wall looking at red, heading `h` in radians CCW from `+x`.
- Field is 651.22in x 317.677in = **16.541 m x 8.069 m** (`field2026.config.json`).
- Three.js world: Y up. `shared/field.js` exports `toThree(x, y)` → `{x, z}` and the transform needed to
  place `field2026.glb` so its geometry lines up with this frame (G verifies against AprilTag positions in
  `field2026.config.json`, which are already in this frame: e.g. tags 13–16 at x=-8.262 are on the blue wall).

## `shared/field.js` (ES module, imported by server via `../shared/field.js` and by browser via `/shared/field.js`)
```js
export const FIELD = { length: 16.541, width: 8.069 };
export const ROBOT = { length, width, height }; // KitBot incl. bumpers, meters, measured from kitbot2026.glb
// Solid at bumper height (robots collide). Oriented rectangles in field frame.
export const OBSTACLES = [ { name, x, y, len, wid, rot } ];   // len along rot, wid across; rot radians
export const BUMPS = [ { name, x, y, len, wid, rot, height } ];  // drivable ramps, visual height only
export const SPAWNS = { red: [{x,y,h}x3], blue: [{x,y,h}x3] }; // inside each alliance's zone, clear of obstacles
export const FIELD_MODEL = { url: '/assets/field2026.glb', position:[..], rotation:[..], scale };   // three.js
export const ROBOT_MODEL = { url: '/assets/kitbot2026.glb', position:[..], rotation:[..], scale };  // three.js, so robot faces +x of its local frame and sits on y=0
export function toThree(x, y) { return { x, z: -y }; }   // three object.rotation.y = h
```
Perimeter walls are NOT in OBSTACLES; the server clamps against the field rectangle itself.
Bumps (ramps) and the trench openings are drivable — not obstacles. Hubs, tower bases, outpost/corral
structures and trench support posts that sit at bumper height are obstacles.

## Wire protocol (JSON text frames over WebSocket at path `/ws`)
Client → server:
- `{"t":"join","name":string(1..16),"team":int(1..99999),"alliance":"red"|"blue"}`
- `{"t":"input","fwd":number,"turn":number}` — each clamped to [-1,1] server-side; non-finite → 0. Sent
  on change and at least every 100 ms.
- `{"t":"respawn"}`

Server → client:
- `{"t":"welcome","id":string}` after a valid join.
- `{"t":"reject","reason":"alliance_full"|"invalid"}` then close.
- `{"t":"state","time":ms,"robots":[{"id","name","team","alliance","x","y","h"}]}` broadcast at 30 Hz.

Server validates every message (shape, types, lengths); malformed → ignored (or `reject/invalid` for join).
Messages > 1 KB dropped (`maxPayload`); binary frames ignored.
- Max 3 robots per alliance: join → `reject alliance_full`. (`reject` reasons: `alliance_full` | `invalid`.)
- Lifecycle: messages before `join` ignored; repeat `join` ignored. Disconnect removes the robot.
  Server pings every 2 s, terminates after 2 missed pongs (kills ghost robots from dead Wi-Fi peers).
- Abuse limits (LAN peer): max 12 open sockets (extra closed), socket not joined within 5 s closed,
  >60 msgs/s closed, `respawn` at most 1/s, skip broadcast to a socket with `bufferedAmount` > 64 KB.
- Server zeroes a robot's input if no `input` arrived for 300 ms (lost keyup / hidden tab).
- `join.name`: trimmed, 1..16 code points, no control chars; `team` must be `Number.isInteger` in range.
- `state.time`: server monotonic ms. `id`: opaque string. List includes the receiver's own robot.
- Respawn when no spawn of the alliance is free → ignored.

## LAN-only
- Server listens on `0.0.0.0:${PORT||3000}`.
- Every HTTP request and WS upgrade from a non-private address gets 403 / is destroyed. Allowed:
  `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`,
  `fe80::/10`, and IPv4-mapped IPv6 forms of the IPv4 ranges (`::ffff:192.168.1.5`).
- Source address = `req.socket.remoteAddress` only (never `X-Forwarded-For`); strip `::ffff:`, check with `net.BlockList`.
- WS upgrade: path must be `/ws`, and the `Origin` header's host must equal the `Host` header (blocks
  internet pages a LAN user visits from opening a socket); else destroy.
- On start, print every LAN IPv4 URL (`os.networkInterfaces()`).

## Static serving
`/` → `public/`, `/shared/` → `shared/`, `/vendor/three/` → `node_modules/three/`. Resolved path must stay
inside its root (else 404). MIME: `.html`, `.js` → `text/javascript`, `.css`, `.json`, `.glb` → `model/gltf-binary`, `.svg`, `.png`.

## Simulation (server-authoritative, `server/sim.js`, pure functions, unit-testable)
- 60 Hz fixed step. Differential (tank) drive, arcade input: target v = fwd·3.8 m/s, target ω = turn·5 rad/s;
  slew-limited (accel 8 m/s², angular accel 25 rad/s²).
- Order per step: integrate → robot–robot → obstacles → perimeter clamp (static constraints run last and win).
- Robot = oriented rectangle (`ROBOT.length` x `ROBOT.width`). Collision via SAT (OBB vs OBB):
  robot vs OBSTACLES → push robot out along min-translation axis, zero the velocity component into it;
  robot vs robot → split the push 50/50; robot vs perimeter → clamp so all 4 corners are inside.
- Respawn → next free SPAWN of its alliance (free = no robot overlapping).

## Client (`public/`)
- Join screen (name, team number, alliance, "Drive!") → game view; reject reasons shown on the join screen.
- Loads both GLBs once with GLTFLoader; merges field meshes by material after load to cut draw calls
  (field has ~2900 meshes). Robot model cloned per robot; bumpers recolored red/blue by alliance; floating
  label "team · name" above each robot.
- Renders interpolated state (~100 ms buffer). Own robot: show the server pose (no prediction in v1).
- Visual height/tilt: computed analytically from `BUMPS` (no raycasts) so robots ride over bumps (visual only).
- Assets: progress bar while loading; "Drive!" disabled until loaded; load error shown on the join screen.
- On socket close: back to join screen, form prefilled, "Disconnected" shown. No auto-rejoin.
- On `blur` / `visibilitychange` hidden: clear inputs and send `fwd:0, turn:0`.
- Interpolation: render at (latest server time − 100 ms) using a receipt-time offset.
- Names rendered only via `textContent`/canvas, never `innerHTML`.
- Controls: WASD / arrows (arcade), Chrome Gamepad API (left stick Y fwd, right stick X turn), `R` respawn,
  `C` cycle camera: chase → driver-station view (from own alliance wall) → top-down.
- HUD: connection status, player list with alliance colors, controls help.
- Lights/shadows: hemisphere + directional; no heavy post-processing.
