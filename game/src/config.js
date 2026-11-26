// Every tunable number and colour of Skysail Courier in one place: the airframe's dimensions and
// envelope, the fjord's size and palette, the sky and fog of each weather preset, the mission
// budgets and the key bindings. Nothing here imports anything, so any module can read it and a
// change to the feel of the flight model is a change to one line.
// Units: metres, kilograms, seconds, radians (angles in code), degrees only where a gauge shows them.

export const AIRFRAME = {
  mass: 1180,          // basic weight, kg (a taildragger bush plane with the pilot aboard)
  wing: { span: 10.2, chord: 1.62, area: 16.5, aspect: 6.3, oswald: 0.74 },
  stallAlpha: 0.25,    // 14.3 deg — beyond this the wing lets go
  clSlope: 5.4,        // per radian
  clMax: 1.32,
  cd0: 0.028,
  cdFlap: 0.014,       // extra drag with flaps down
  gearDrag: 0.019,     // extra drag with the gear down (it stays down: this is a bush plane)
  sinkAfterStall: 0.62,// lift kept at 90 deg of attack, so a stall is a controlled descent
  thrustMax: 4300,     // N at sea level, full throttle
  propEfficiency: 0.72,
  powerExponent: 1.55, // fuel burn vs throttle
  fuelCapacity: 96,    // litres: about twenty minutes of bush-work, so a detour is a decision
  stallMargin: 1.08,   // how far above Vs the warning horn starts
  gearCollapseKmh: 78, // vertical speed on hard ground that bends the gear
  crushKmh: 96,        // impact speed that finishes the airframe
};

export const ENVELOPE = {
  vMin: 18,            // m/s indicated floor for the gauge
  vNever: 92,          // Vne, m/s
  serviceCeiling: 3400,
  pitchLimit: 0.95,    // rad, ~54 deg
  rollRate: 2.5,       // rad/s at full aileron, authority-scaled
  pitchRate: 1.15,     // rad/s at full elevator
  yawRate: 0.62,       // rad/s at full rudder
  trimRate: 0.22,
};

export const WORLD = {
  size: 12000,         // the fjord is size metres across, centred on the origin
  gridSegments: 300,   // terrain mesh resolution: 40 m quads over the far field
  detailSpan: 1700,    // metres around the plane re-cut finer, so approaches read as real ground
  detailSeg: 84,       // the patch is detailSeg^2 quads: ~20 m cells
  relief: 700,         // metres of highest peak above sea level
  waterLevel: 0,
  seed: 20261126,      // fixed: the same coast every flight, and every screenshot
  treeCount: 9000,
  rockCount: 1500,
  waveScale: 0.0085,   // swell spatial frequency, 1/m (wavelength ~740 m)
  farPlane: 46000,
};

// Airstrips: name, position (metres, x east / z south of centre), heading (rad, 0 = north),
// length and width of the pad, and what it carries. Gravel and water strips, no pavement.
export const STRIPS = [
  { id: 'vik', name: 'VIK HAMLET',   x: -3000, z:  -300, heading: 0.90, length: 430, width: 26, kind: 'gravel', town: true },
  { id: 'aur', name: 'AURN POINT',   x: -3900, z:  3000, heading: 2.10, length: 360, width: 24, kind: 'gravel' },
  { id: 'brk', name: 'BRAEK FLATS',  x:   900, z:  4200, heading: 3.95, length: 480, width: 28, kind: 'gravel', town: true },
  { id: 'knl', name: 'KENNEL REACH', x:  3300, z: -1200, heading: 5.05, length: 380, width: 24, kind: 'gravel' },
  { id: 'slt', name: 'SALT MARINA',  x:  4200, z:   300, heading: 0.55, length: 560, width: 34, kind: 'water' },
];

export const PALETTE = {
  skyWarmTop: 0x1f4a7a, skyWarmLow: 0xffcf9a, sunWarm: 0xfff0cf,
  skyStormTop: 0x2b3743, skyStormLow: 0x6d7a83, sunStorm: 0xb9c4cb,
  waterDeep: 0x11304a, waterShallow: 0x1f6d86, waterSpec: 0xdfefff,
  sand: 0xc9b489, grass: 0x4d7a45, grassDark: 0x33582f, rock: 0x6a6f75,
  snow: 0xe9f1f6, forest: 0x2c5236, trunk: 0x4a3524,
  fuselage: 0xd7dce2, accent: 0xe8622a, cowl: 0x3b4249, wing: 0xd7dce2,
  panel: 0x1b1f24, gaugeFace: 0x101418, gaugeRing: 0x8b949c, glow: 0xffd27a,
  hud: 0xffc76a, hudDim: 'rgba(255,199,106,0.45)', hudWarn: 0xff5a4a, hudOk: 0x86e08a,
  ring: 0xffb347, flare: 0xff6a3d, crate: 0xb9885a, runwayLight: 0xfff0b0,
};

export const SKY = {
  radius: 24000,
  cloudCount: 46,
  cloudPuff: 5,
  sunWarm: { elevation: 0.18, azimuth: 0.62, intensity: 3.1, ambient: 0.85, fogNear: 1400, fogFar: 15000, fogColor: 0xcfd9e2, exposure: 1.06 },
  sunStorm: { elevation: 0.10, azimuth: 2.4, intensity: 0.95, ambient: 1.5, fogNear: 140, fogFar: 2600, fogColor: 0x5b666e, exposure: 0.92 },
  rainDrops: 5200,
};

export const MISSIONS = {
  courier: { label: 'COURIER HAUL', legs: 2, timeBonusPerLeg: 150, dropFee: 40, onTime: 90, perLegSeconds: 250, rings: false },
  rings:   { label: 'RING COURSE',  count: 9, ringRadius: 46, pass: 120, miss: 0, perLegSeconds: 260 },
  sar:     { label: 'STORM RESCUE', perLegSeconds: 300, beaconRange: 2600, score: 900, weather: 'storm' },
};

export const CAMERA = {
  chase: { distance: 13.5, height: 3.4, lookAhead: 2.6, lag: 7.5, fov: 62, fovBySpeed: 8 },
  cockpit: { offset: [0, 0.86, -0.35], lag: 26 },
  orbit: { distance: 22, height: 7, fov: 55 },
  terrainClearance: 3.2,
};

export const HUD = {
  tapeSpeed: 118, tapeAlt: 118, tickEvery: 20, smallTick: 10,
  font: '13px ui-monospace, Menlo, Consolas, monospace',
  fontBig: '600 22px ui-monospace, Menlo, Consolas, monospace',
  fontSmall: '11px ui-monospace, Menlo, Consolas, monospace',
  panelWidth: 214,
};

export const KEYS = {
  throttleUp: ['KeyR', 'ShiftLeft'], throttleDown: ['KeyF', 'ControlLeft'],
  elevatorUp: ['ArrowUp', 'KeyW'], elevatorDown: ['ArrowDown', 'KeyS'],
  rollLeft: ['ArrowLeft', 'KeyA'], rollRight: ['ArrowRight', 'KeyD'],
  rudderLeft: ['KeyQ'], rudderRight: ['KeyE'],
  flaps: ['KeyV'], trimReset: ['KeyT'], camera: ['KeyC'],
  autopilot: ['KeyP'], pause: ['KeyO'], missionNext: ['BracketRight'], missionPrev: ['BracketLeft'],
  restart: ['Enter'], help: ['Slash', 'KeyH'],
};

export const SIM = { step: 1 / 60, g: 9.81, rho0: 1.225, temperatureLapse: 0.0065, pressureExponent: 0.190284 };
