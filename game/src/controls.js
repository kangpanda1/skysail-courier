// The pilot's hands: keyboard (and pointer) state turned into the smooth control inputs the flight
// model wants. Axes are rate-limited so a jab of the key is a roll-in rather than a snap, the
// throttle is a quadrant with an idle detent, flaps and trim accumulate, and the brakes only bite on
// the ground. An autopilot can be plugged in over the top — the screenshot scenes and the "fly it
// home" assist both use it — and every input is readable so the HUD can show what is being commanded.
import { KEYS, ENVELOPE as E } from './config.js';

const RATE = { elevator: 3.4, aileron: 4.6, rudder: 3.8 };
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

export class Controls {
  constructor(target = window) {
    this.keys = new Set();
    this.cmd = { throttle: 0.35, elevator: 0, aileron: 0, rudder: 0, flaps: 0, brakes: 0, trim: 0 };
    this.axes = { elevator: 0, aileron: 0, rudder: 0 };
    this.flapStage = 0;
    this.autopilot = null;          // a function (model, controls) => cmd, used by shots and the assist
    this.hotkeys = {};              // filled by main.js: camera, restart, mission, pause
    this.pointer = { down: false, x: 0, y: 0 };
    this.status = document.getElementById('status');
    if (target === window || target?.addEventListener) {
      target.addEventListener('keydown', (e) => this.onKey(e, true));
      target.addEventListener('keyup', (e) => this.onKey(e, false));
      target.addEventListener('blur', () => this.keys.clear());
    }
  }

  held(codes) { return codes.some((c) => this.keys.has(c)); }

  onKey(event, down) {
    const code = event.code;
    if (down) {
      if (!this.keys.has(code)) this.press(code, event);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
    if (KEYS_THROTTLE.has(code) || KEYS_AXES.has(code) || code === 'Space') event.preventDefault();
  }

  /** One-shot key actions: flaps stages, trim reset, camera, mission, restart, pause, assist. */
  press(code, event) {
    const map = this.hotkeys;
    if (KEYS.flaps.includes(code)) this.flapStage = (this.flapStage + 1) % 4;
    if (KEYS.trimReset.includes(code)) this.cmd.trim = 0;
    if (KEYS.camera.includes(code) && map.camera) map.camera();
    if (KEYS.autopilot.includes(code) && map.autopilot) map.autopilot();
    if (KEYS.pause.includes(code) && map.pause) map.pause();
    if (KEYS.restart.includes(code) && map.restart) map.restart();
    if (KEYS.help.includes(code) && map.help) map.help();
    if (KEYS.missionNext.includes(code) && map.missionNext) map.missionNext(1);
    if (KEYS.missionPrev.includes(code) && map.missionPrev) map.missionPrev(-1);
    void event;
  }

  /** Build this step's inputs from what is held, easing the axes toward the commanded deflection. */
  read(dt, model) {
    const held = (list) => (this.held(list) ? 1 : 0);
    const throttleUp = held(KEYS.throttleUp), throttleDown = held(KEYS.throttleDown);
    const target = clamp(this.cmd.throttle + (throttleUp - throttleDown) * dt * 0.42, 0, 1);
    this.cmd.throttle = Math.abs(target - Math.round(target * 10) / 10) < 0.012 ? Math.round(target * 10) / 10 : target;
    if (this.cmd.throttle < 0.02) this.cmd.throttle = 0;

    const want = {
      elevator: held(KEYS.elevatorUp) - held(KEYS.elevatorDown),
      aileron: held(KEYS.rollRight) - held(KEYS.rollLeft),
      rudder: held(KEYS.rudderRight) - held(KEYS.rudderLeft),
    };
    for (const axis of ['elevator', 'aileron', 'rudder']) {
      const rate = RATE[axis] * dt;
      const delta = clamp(want[axis]) - this.axes[axis];
      this.axes[axis] += Math.abs(delta) < rate ? delta : Math.sign(delta) * rate;
    }
    this.cmd.aileron = this.axes.aileron;
    this.cmd.rudder = this.axes.rudder;
    this.cmd.elevator = this.axes.elevator;
    // trim as a servo tab: hold the stick and the load walks off the arm, so the aircraft stays
    // where it was put without the pilot fighting the elevator the whole leg
    if (Math.abs(this.axes.elevator) > 0.45) {
      const step = Math.sign(this.axes.elevator) * dt * 0.2;
      this.cmd.trim = Math.max(-0.6, Math.min(0.6, this.cmd.trim + step));
      this.axes.elevator -= step;
      this.cmd.elevator = this.axes.elevator;
    } else if (Math.abs(want.elevator) < 0.01) {
      this.cmd.trim *= 1 - Math.min(1, dt * 0.15);
    }
    this.cmd.flaps = this.flapStage / 3;
    this.cmd.brakes = this.held(['Space']) && model && model.onGround ? 1 : 0;

    if (this.autopilot) {
      const auto = this.autopilot(model, this);
      if (auto) {
        for (const key of Object.keys(this.cmd)) this.cmd[key] = auto[key] ?? this.cmd[key];
      }
    }
    return this.cmd;
  }

  /** Trim the elevator out of the stick: a hold on the trim-reset key zeroes it. */
  applyTrim() {
    if (this.held(KEYS.trimReset)) this.cmd.trim = 0;
    return this.cmd.trim;
  }

  announce(text) {
    if (this.status) this.status.textContent = text;
  }
}

const KEYS_THROTTLE = new Set([...KEYS.throttleUp, ...KEYS.throttleDown]);
const KEYS_AXES = new Set([...KEYS.elevatorUp, ...KEYS.elevatorDown, ...KEYS.rollLeft, ...KEYS.rollRight, ...KEYS.rudderLeft, ...KEYS.rudderRight]);

/**
 * A hand that flies for you: hold the strip in sight, keep the speed near the target, and bank to the
 * next waypoint. Used by the screenshot scenes and by the assist key, and it is the same code a
 * player drives — it returns the same cmd shape Controls does.
 */
export function autopilotFlyTo(getWaypoint, options = {}) {
  const speed = options.speed ?? 42;
  const arriveRadius = options.arriveRadius ?? 90;
  return (model) => {
    const wp = getWaypoint();
    const cmd = { throttle: 0.62, elevator: 0, aileron: 0, rudder: 0, flaps: 0, brakes: 0, trim: 0 };
    if (!wp) return cmd;
    const dx = wp.x - model.pos.x, dy = wp.y - model.pos.y, dz = wp.z - model.pos.z;
    const range = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, -dz);
    const trackError = normish(bearing - model.psi);
    const wantBank = clamp(trackError * 1.6, -0.9, 0.9);
    cmd.aileron = clamp((wantBank - model.bank) * 1.5, -1, 1);
    cmd.rudder = clamp(trackError * 0.5 - model.beta * 2.2, -0.5, 0.5);
    const glide = wp.glide ?? 0.055;
    const slope = range > 1 ? dy / range : 0;
    const wantGamma = Math.max(-0.32, Math.min(0.28, Math.atan2(slope - 0.02, 1) + (model.v > speed ? -0.06 : 0.06)));
    cmd.elevator = clamp((wantGamma - model.gamma) * 2.4 - (model.alpha - 0.07) * 2.2, -1, 1);
    const need = Math.max(0.15, Math.min(1, (speed / Math.max(8, model.v)) ** 1.6));
    cmd.throttle = clamp(((model.v < speed ? 0.72 : 0.44) + (need - 0.6) * 0.5 + (wp.power ?? 0)) * (range < arriveRadius ? 0.6 : 1), 0, 1);
    cmd.flaps = wp.flaps ?? 0;
    cmd.brakes = 0;
    return cmd;
  };
}

function normish(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export { E as ENVELOPE_FOR_CONTROLS };
