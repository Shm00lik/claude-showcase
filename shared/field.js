// Field geometry shared by server (sim) and client (render). Field frame: meters, origin at field center,
// +x toward red wall, +y left when facing red from blue, heading h CCW from +x.
// All numbers derived with tools/inspect-glb.mjs from public/assets/{field2026,kitbot2026}.glb
// (see docs/geometry-debug.svg to eyeball them against the occupancy slice and AprilTags).

export const FIELD = { length: 16.541, width: 8.069 }; // field2026.config.json: 651.22in x 317.677in

// KitBot incl. bumpers: bbox of all kitbot2026.glb meshes (= the three bumper meshes). glTF z (fore-aft)
// -0.118..0.716 = 0.834, x (side) +-0.419 = 0.838, y (up) -0.052 (wheel tread bottom) .. 0.457 = 0.509.
export const ROBOT = { length: 0.834, width: 0.838, height: 0.509 };

// Solid at bumper height (0.08-0.30 m slice of the field GLB, then per-node bboxes for exact edges). Bump ramps
// and the trench lanes are drivable and NOT listed. Oriented rects: len along rot, wid across. All rot 0.
export const OBSTACLES = [
  // Hub Side Panel / Hub Base: x[3.054,4.236] y[-0.597,0.597]
  { name: 'red_hub', x: 3.645, y: 0, len: 1.182, wid: 1.194, rot: 0 },
  { name: 'blue_hub', x: -3.645, y: 0, len: 1.182, wid: 1.194, rot: 0 },
  // Trench Side/Inside/Outside Skirt (0.48-0.50 m tall plates) + riser posts between each bump and trench lane:
  // x[3.048,4.242] y[2.456,2.756]. The trench lane itself (|y| 2.756..4.03) is open under the arm (0.565 m clear).
  { name: 'red_trench_skirt_left', x: 3.645, y: 2.606, len: 1.194, wid: 0.3, rot: 0 },
  { name: 'red_trench_skirt_right', x: 3.645, y: -2.606, len: 1.194, wid: 0.3, rot: 0 },
  { name: 'blue_trench_skirt_left', x: -3.645, y: 2.606, len: 1.194, wid: 0.3, rot: 0 },
  { name: 'blue_trench_skirt_right', x: -3.645, y: -2.606, len: 1.194, wid: 0.3, rot: 0 },
  // Tower Base Bottom (x[7.126,8.2705 wall] y[-0.206,0.784]) with uprights at x 7.16-7.25. One solid block
  // (the sim robots do not climb). Field is 180-degree symmetric, so blue = (-x,-y).
  { name: 'red_tower', x: 7.698, y: 0.289, len: 1.145, wid: 0.99, rot: 0 },
  { name: 'blue_tower', x: -7.698, y: -0.289, len: 1.145, wid: 0.99, rot: 0 },
  // Outposts and depots add nothing inside the perimeter at bumper height: outpost panels are flush with the
  // wall (x=+-8.27) and the depot border is only 0.029 m tall floor tube.
];

// Drivable bumps. Footprint rect (len along x = slope direction, wid along y) and peak height (m). Profile
// (`inspect-glb.mjs field profile`): symmetric TRIANGLE along len, 0 at both ends rising linearly to `height`
// at the center line (slope ~15.5 deg), constant along wid.
export const BUMPS = [
  // Bump Plastic x[3.05,4.24], y from hub edge 0.597 to skirt 2.456, peak 0.165 at x=3.645.
  { name: 'red_bump_left', x: 3.645, y: 1.5265, len: 1.19, wid: 1.859, rot: 0, height: 0.165 },
  { name: 'red_bump_right', x: 3.645, y: -1.5265, len: 1.19, wid: 1.859, rot: 0, height: 0.165 },
  { name: 'blue_bump_left', x: -3.645, y: 1.5265, len: 1.19, wid: 1.859, rot: 0, height: 0.165 },
  { name: 'blue_bump_right', x: -3.645, y: -1.5265, len: 1.19, wid: 1.859, rot: 0, height: 0.165 },
];

// 3 per alliance in the alliance zone (|x| > 4.25), facing field center, clear of obstacles
// (tower is at |x| > 7.12, |y| < 0.8).
export const SPAWNS = {
  red: [{ x: 6.0, y: -2.5, h: Math.PI }, { x: 6.0, y: 0, h: Math.PI }, { x: 6.0, y: 2.5, h: Math.PI }],
  blue: [{ x: -6.0, y: 2.5, h: 0 }, { x: -6.0, y: 0, h: 0 }, { x: -6.0, y: -2.5, h: 0 }],
};

// three.js is Y-up: field (x, y, up) -> three (x, up, -y). The CAD's raw glTF has x = +blue side: bump/skirt
// plastic with base colour (0,0,1) is at glTF x>0 and red (1,0,0) at x<0 (`inspect-glb.mjs field colors`), i.e. the
// CAD (and AdvantageScope's config frame) is 180 degrees from our frame (+x toward RED). So rotate the model
// 180 deg about Y: (x, z) -> (-x, -z); blue then sits at -x. Obstacles/bumps/tower below are 180-degree symmetric.
export const FIELD_MODEL = { url: '/assets/field2026.glb', position: [0, 0, 0], rotation: [0, Math.PI, 0], scale: 1 };

// KitBot glTF: forward = +z, left = +x, up = +y (AdvantageScope config x+90, z+90 => forward = glTF z).
// rotation.y = +pi/2 sends z -> three +x and x -> three -z (left); box center z = 0.299 -> x offset -0.299;
// wheel bottom y = -0.052 -> y offset +0.052. Put it in a group at toThree(x, y) with group.rotation.y = h.
export const ROBOT_MODEL = { url: '/assets/kitbot2026.glb', position: [-0.299, 0.052, 0], rotation: [0, Math.PI / 2, 0], scale: 1 };

// Field -> three.js world. Heading: group.rotation.y = h.
export function toThree(x, y) { return { x, z: -y }; }

// ---- FUEL (v2) ----
export const FUEL = { radius: 0.075, pool: 100, capacity: 8 }; // 5.91 in ball; 100 balls total; 8 per robot
// 10x10 grid, 0.3 m spacing, centred on (0,0) (neutral zone)
export const FUEL_START = Array.from({ length: 100 }, (_, i) => ({ x: ((i % 10) - 4.5) * 0.3, y: (Math.floor(i / 10) - 4.5) * 0.3 }));
// Measured with `node tools/inspect-glb.mjs field find Hub`: "Hub Funnel Side" (the opening's wall) spans y +-0.533 (flats of the
// hexagon) and x +-0.613 about the hub centre (corners; 0.613*cos30 = 0.531) and tops out at h = 1.829 m. So top = rim height,
// radius = inscribed (flat-to-centre) radius of the hexagonal opening.
export const HUBS = [
  { alliance: 'red', x: 3.645, y: 0, top: 1.829, radius: 0.531 },
  { alliance: 'blue', x: -3.645, y: 0, top: 1.829, radius: 0.531 },
];
// Launch point in the robot frame (x fwd, z up), fixed pitch. speed solves z(d)=top for d = 2.5 - x = 2.3 m horizontal:
// v^2 = g d^2 / (2 cos^2(a) (z + d tan a - top)); the ball is descending there (apex at t=0.55 s, crossing at 0.75 s).
export const SHOOTER = { x: 0.2, z: 0.55, angle: 1.05, speed: 6.195 };
