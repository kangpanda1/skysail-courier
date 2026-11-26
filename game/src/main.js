// Boot and the game loop: build the stage, the model, the controls, the HUD and the runs, then step
// the world at a fixed 1/60 with an accumulator so the flight model sees the same physics however
// the browser schedules frames. It also answers ?shot=<name>, which stages one of the posed scenes
// in scenes.js, renders a single frame and stops — that is how the screenshots are taken, by the
// game's own code, and it exposes window.skysail so a scenario can be scripted from a console.
import { Stage } from './render.js';
import { FlightModel } from './flight-model.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { Missions } from './missions.js';
import { Audio } from './audio.js';
import { SHOTS, stageShot, approach } from './scenes.js';
import { autopilotFlyTo } from './controls.js';
import { SIM, KEYS } from './config.js';

const sceneCanvas = document.getElementById('scene');
const hudCanvas = document.getElementById('hud');
const stage = new Stage(sceneCanvas);
const model = new FlightModel();
const controls = new Controls(window);
const hud = new Hud(hudCanvas);
const missions = new Missions(stage.world);
const audio = new Audio();

stage.props.add(missions.group);
missions.attachCargo(stage.aircraft.parts.crate);
model.world = stage.world;

const view = { phase: 'title', paused: false, help: false, contact: null, summary: null, terrainWarning: false };
let assist = false;
let contactTimer = 0;

function resize() {
  const w = Math.max(320, globalThis.innerWidth || 1280);
  const h = Math.max(240, globalThis.innerHeight || 720);
  stage.resize(w, h);
  hud.resize(w, h, Math.min(globalThis.devicePixelRatio || 1, 2));
}
resize();
globalThis.addEventListener?.('resize', resize);

/** The title screen flies a slow circuit so the coast is moving behind the menu. */
function titleCircuit() {
  const strip = stage.world.strips[0];
  model.place(strip.x - strip.axes.fx * 1400, strip.altitude + 420, strip.z - strip.axes.fz * 1400, strip.heading + 0.4, 42, 0.02);
  stage.rig.mode = 'orbit';
  stage.setWeather('clear');
}
titleCircuit();

function startRun(index) {
  missions.start(index, model, stage.rig);
  stage.setWeather(missions.state.weather);
  stage.rig.mode = 'chase';
  view.phase = 'fly';
  view.summary = null;
  view.contact = null;
  assist = false;
  controls.autopilot = null;
  controls.flapStage = 0;
  controls.axes.elevator = controls.axes.aileron = controls.axes.rudder = 0;
  controls.announce(`${missions.state.label} started`);
}

function endRun() {
  const st = missions.state;
  view.phase = 'summary';
  view.summary = {
    title: st.failed ? `RUN OVER: ${st.failed}` : 'RUN COMPLETE',
    lines: [
      `${st.label}   score ${st.score}   best ${st.best}`,
      `${st.index} of ${st.steps.length} objectives`,
      st.failed ? 'the fjord keeps the crate this time' : 'the mail is through',
    ],
  };
  audio.hit(st.failed ? 'fail' : 'deliver');
}

function toggleAssist() {
  assist = !assist;
  controls.autopilot = assist ? (m) => {
    const t = missions.target();
    if (!t) return null;
    if (t.kind === 'strip') {
      const strip = stage.world.strips.find((s) => s.x === t.x && s.z === t.z);
      return strip ? approach(strip)(m) : null;
    }
    // a ring or the flare: fly the waypoint, and once it is close, come down to it
    return autopilotFlyTo(() => ({ x: t.x, y: t.y, z: t.z, speed: 46 }), { speed: 46 })(m);
  } : null;
  controls.announce(assist ? 'assist on' : 'assist off');
}

const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
const norm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

controls.hotkeys = {
  camera: () => { stage.rig.next(); },
  autopilot: toggleAssist,
  pause: () => { if (view.phase === 'fly') view.paused = !view.paused; },
  help: () => { view.help = !view.help; },
  restart: () => { if (view.phase === 'title') startRun(missions.selected); else startRun(missions.selected); },
  missionNext: (dir) => { if (view.phase === 'title') missions.selected = (missions.selected + dir + missions.list.length) % missions.list.length; },
  missionPrev: (dir) => { if (view.phase === 'title') missions.selected = (missions.selected - dir + missions.list.length) % missions.list.length; },
};

// the title screen's own keys: 1..3 pick a run, ENTER starts it
globalThis.addEventListener?.('keydown', (event) => {
  audio.unlock();
  if (view.phase === 'title') {
    const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
    if (index >= 0) { missions.selected = index; startRun(index); }
    else if (event.code === 'Enter' || event.code === 'Space') startRun(missions.selected);
  } else if (view.phase === 'summary' && (event.code === 'Enter' || event.code === 'Space')) {
    startRun(missions.selected);
  }
});

function handleEvents(events) {
  for (const e of events) {
    if (e === 'touchdown' || e === 'crash') { contactTimer = 6; view.contact = model.contact; audio.hit(e === 'crash' ? 'crash' : 'touchdown'); }
    else if (e === 'stall') audio.hit('stall');
    else if (e === 'warn-stall' || e === 'warn-overspeed') audio.hit('warn');
    else if (e === 'destroyed' || e === 'wreck-settled') { if (view.phase === 'fly') { missions.fail(model, model.wrecked ? 'AIRFRAME LOST' : 'DOWN'); } }
    else if (e === 'stopped') contactTimer = Math.max(contactTimer, 2);
  }
  if (contactTimer > 0) contactTimer -= SIM.step;
  if (contactTimer <= 0) view.contact = null;
}

/** One physics step, whatever the phase: the title circuit is flown by the same model. */
function step(dt) {
  const cmd = controls.read(dt, model);
  if (view.phase === 'title') {
    const strip = stage.world.strips[0];
    const t = { throttle: 0.6, elevator: 0, aileron: 0, rudder: 0, flaps: 0, brakes: 0, trim: 0 };
    const dx = strip.x - model.pos.x, dz = strip.z - model.pos.z;
    const bearing = Math.atan2(dx, -dz);
    t.aileron = clamp((norm(bearing - model.psi) * 1.4 - model.bank) * 1.2);
    t.elevator = clamp((0.02 - model.gamma) * 2 - (model.alpha - 0.08) * 2);
    handleEvents(model.step(dt, t));
    return;
  }
  if (view.paused) return;
  handleEvents(model.step(dt, cmd));
  const st = missions.update(dt, model);
  if (st && st.done && view.phase === 'fly') endRun();
  view.terrainWarning = !model.onGround && model.pos.y - stage.world.surfaceAt(model.pos.x, model.pos.z) < 55 && model.verticalSpeed < -4;
}

function drawHud(dt) {
  const st = missions.state;
  hud.draw(model, {
    phase: view.phase,
    paused: view.paused,
    help: view.help,
    contact: view.contact,
    summary: view.summary,
    terrainWarning: view.terrainWarning,
    mission: st && !st.done ? {
      label: st.label, objective: st.objective, leg: st.leg, legs: st.legs,
      score: st.score, best: st.best, remaining: st.remaining ?? MISSION_TIME(st),
    } : null,
    target: st && !st.done ? st.target : null,
    project: (x, y, z) => stage.project(x, y, z),
    missions: missions.list,
    selectedMission: missions.selected,
    bestSummary: missions.list.map((d) => `${d.label} ${missions.best(d.id)}`).join('   ·   '),
  });
  void dt;
}

const MISSION_TIME = (st) => (st.steps.length - st.index) * 180;

let last = performance.now();
let accumulator = 0;

function loop(now) {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  accumulator += elapsed;
  while (accumulator >= SIM.step) { step(SIM.step); accumulator -= SIM.step; }
  stage.frame(elapsed, model, controls.cmd);
  audio.update(model);
  drawHud(elapsed);
  globalThis.requestAnimationFrame(loop);
}

/**
 * ?shot=<name>: stage one posed scene, then hold it on screen. The scene is frozen — nothing steps
 * the flight model — but the frame has to keep being drawn: a WebGL back buffer is not kept after
 * compositing, so a page that renders once and stops hands a screenshot capturer an empty surface.
 */
function shotMode(name) {
  resize();
  const ctx = { stage, model, missions, controls, hud };
  const info = stageShot(name, ctx);
  model.world = stage.world;
  const st = missions.state;
  const paint = () => {
    stage.frame(0, model, controls.cmd, { drawPanelNow: true });
    hud.draw(model, {
      phase: 'fly', paused: false, help: false, contact: info.contact, summary: null, terrainWarning: false,
      mission: st ? { label: st.label, objective: st.objective, leg: st.leg, legs: st.legs, score: st.score, best: st.best, remaining: st.remaining ?? 120 } : null,
      target: st ? st.target : null,
      project: (x, y, z) => stage.project(x, y, z),
      missions: missions.list, selectedMission: missions.selected, bestSummary: '',
    });
  };
  paint();                       // the frame exists before anything is scheduled
  const hold = () => { paint(); globalThis.requestAnimationFrame(hold); };
  globalThis.requestAnimationFrame(hold);
  document.title = `SHOT READY ${info.name}`;
  document.body.dataset.shot = info.name;
  document.body.dataset.ready = '1';
  return info;
}

const params = new URLSearchParams(globalThis.location?.search ?? '');
const shotName = params.get('shot');
globalThis.skysail = { stage, model, missions, controls, hud, audio, view, step, SHOTS, shotMode, startRun, KEYS };

if (shotName && SHOTS[shotName]) {
  shotMode(shotName);
} else {
  globalThis.requestAnimationFrame(loop);
}
document.body.dataset.loaded = '1';
