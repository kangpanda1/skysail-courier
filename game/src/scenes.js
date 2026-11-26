// The posed scenes behind ?shot=name. Each one starts a real run, then flies the game's own physics
// forward with the controllers below — no cheats, no hand-placed meshes, no second code path — until
// the moment worth photographing, and stops there. Because the world is seeded and the step is fixed
// at 1/60, the same name always renders the same frame, and what the screenshot shows is exactly
// what a player would see.
import { autopilotFlyTo } from './controls.js';
import { AIRFRAME, SIM } from './config.js';

const STEP = 1 / 60;
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
const norm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/**
 * Metres between the aircraft and the ground that is coming at it: the surface under the nose, and
 * the surface a short way along the track, credited with the climb still available over that ground.
 */
function clearance(model, world, look = 280) {
  const h = model.heading;
  const fx = Math.sin(h), fz = -Math.cos(h);
  let worst = model.pos.y - world.surfaceAt(model.pos.x, model.pos.z);
  for (const d of [look * 0.45, look]) {
    worst = Math.min(worst, model.pos.y - world.surfaceAt(model.pos.x + fx * d, model.pos.z + fz * d) + d * 0.07);
  }
  return worst;
}

/**
 * Pull up if the ground is close. A staged scene flies a fixed line through terrain it cannot see
 * around the corner of, so its controller keeps this last word; the pilot has the same reflex.
 */
function guard(model, world, cmd, need = 85) {
  const g = clearance(model, world);
  if (g >= need) return false;
  cmd.elevator = clamp(0.45 + (need - g) * 0.006);
  cmd.throttle = Math.max(cmd.throttle, 0.88);
  return true;
}

/**
 * The angle of attack that holds level flight at a given speed: lift has to equal weight, lift is
 * dynamic pressure times wing area times cl, and cl is the slope times alpha. Worked from the same
 * airframe numbers the flight model uses, and capped below the stall, so a controller aimed at it
 * flies the aircraft the model actually describes instead of pulling it into a mush.
 */
export function alphaFor(model, v = model.v) {
  const q = 0.5 * SIM.rho0 * Math.max(12, v) * Math.max(12, v) * AIRFRAME.wing.area;
  return Math.max(0.02, Math.min(AIRFRAME.stallAlpha * 0.86, (model.weight / q) / AIRFRAME.clSlope));
}

/** Step the model forward, steering with `cmdFn`, until `stop` or the budget of seconds runs out. */
function fly(model, cmdFn, seconds, stop) {
  const limit = Math.round(seconds / STEP);
  let events = [];
  for (let i = 0; i < limit; i += 1) {
    const cmd = cmdFn(model, i);
    cmd.trim = 0;
    events = model.step(STEP, cmd) || [];
    if (stop && stop(model, i, events)) break;
  }
  return events;
}

/**
 * The geometry of a landing: which end of the strip to fly into, and where the approach can begin.
 * A bush strip is cut into a hillside, so one end has a wall behind it and the other has the valley.
 * Walking the extended centreline both ways and keeping the end whose glideslope clears the ground
 * for the longest run is what a pilot does by eye before committing to a direction.
 */
export function approachRun(strip, world, options = {}) {
  const glide = options.glide ?? 1 / 8.5;
  const reach = options.reach ?? 2600;
  const a = strip.axes;
  const half = strip.length * 0.5;
  let best = null;
  for (const dir of [1, -1]) {
    const fwd = { fx: a.fx * dir, fz: a.fz * dir, rx: a.rx * dir, rz: a.rz * dir };
    const touchdown = { x: strip.x - fwd.fx * (half - strip.length * 0.28), z: strip.z - fwd.fz * (half - strip.length * 0.28) };
    let clear = 0;
    for (let d = 60; d <= reach; d += 60) {
      const x = touchdown.x - fwd.fx * d, z = touchdown.z - fwd.fz * d;
      if (world.surfaceAt(x, z) + 40 > strip.altitude + 3 + d * glide) break;
      clear = d;
    }
    if (!best || clear > best.clear) best = { dir, fwd, touchdown, clear };
  }
  const distance = Math.max(240, Math.min(best.clear, options.distance ?? 1300));
  const x = best.touchdown.x - best.fwd.fx * distance;
  const z = best.touchdown.z - best.fwd.fz * distance;
  return {
    strip,
    world,
    glide,
    fwd: best.fwd,
    touchdown: best.touchdown,
    heading: Math.atan2(best.fwd.fx, -best.fwd.fz),
    distance,
    clearRun: best.clear,
    start: {
      x, z,
      y: Math.max(strip.altitude + 3 + distance * glide, world.surfaceAt(x, z) + 55),
      heading: Math.atan2(best.fwd.fx, -best.fwd.fz),
    },
  };
}

/**
 * The controller that flies an approach: localiser, glideslope, flare and roll-out. The in-game
 * assist steers with it too, so what the screenshots show is what a player can switch on.
 */
export function approach(run, options = {}) {
  const { strip, fwd, touchdown, glide } = run;
  const flareAt = options.flareAt ?? 70;            // metres before the point the flare starts
  const speed = options.speed ?? 36;          // metres per second over the threshold
  const speedFactor = options.speedFactor ?? 1.06;
  const goalY = strip.altitude + 2.2;
  return (model) => {
    const dx = model.pos.x - touchdown.x, dz = model.pos.z - touchdown.z;
    const along = dx * fwd.fx + dz * fwd.fz;        // negative until the point
    const across = dx * fwd.rx + dz * fwd.rz;
    const remain = Math.max(0, -along);
    const cmd = { throttle: 0.5, elevator: 0, aileron: 0, rudder: 0, flaps: 0, brakes: 0, trim: 0 };
    if (model.onGround) {
      cmd.throttle = 0.06;
      cmd.brakes = 1;
      cmd.rudder = clamp(-across * 0.08 - model.beta * 3.4, -1, 1);
      cmd.elevator = clamp(-0.22 - model.alpha * 1.6);
      cmd.flaps = 1;
      return cmd;
    }
    const desiredY = goalY + remain * glide;
    const heightError = model.pos.y - desiredY;
    const wantGamma = clamp(-glide * 1.12 - heightError * 0.0026, -0.17, 0.06);
    const flare = remain < flareAt ? (1 - remain / flareAt) * 0.085 : 0;
    const trackError = norm(run.heading + Math.atan2(clamp(across, -400, 400) * 0.0016, 1) - model.psi);
    const wantBank = clamp(trackError * 2.1 + across * 0.004, -0.7, 0.7);
    cmd.aileron = clamp((wantBank - model.bank) * 2.2);
    cmd.rudder = clamp(-model.beta * 3.2 - cmd.aileron * 0.25, -0.7, 0.7);
    cmd.elevator = clamp((wantGamma + flare - model.gamma) * 2.6 - (model.alpha - alphaFor(model, speed)) * 2.4);
    cmd.throttle = clamp(0.4 + (speed * speedFactor - model.v) * 0.045 + (model.gamma < -0.02 ? 0.05 : 0), 0.1, 0.85);
    cmd.flaps = remain < 900 ? 1 : 0.4;
    // the valley walls, but not the strip: a glideslope passes 6 m over the bench by design, so the
    // guard is only for the far part of the approach and only for ground that is actually close
    if (remain > 520) guard(model, run.world, cmd, 45);
    return cmd;
  };
}

/** On the ground after the wheels: keep steering and braking until she is stopped. */
function rollOut(model, run, seconds = 4) {
  fly(model, approach(run), seconds, (m) => m.onGround && m.v < 1.6);
}

/**
 * The hoop to photograph: of the early ones on the course, the one with the most ground clearance
 * along the line the aircraft will fly in on. Hoops hang off ridges by 90 m, which is fine to fly
 * through with a pilot's eye on the terrain and not fine for a staged frame.
 */
function pickRing(steps, world) {
  let best = null;
  for (let i = 1; i < Math.min(steps.length, 6); i += 1) {
    const ring = steps[i];
    const n = ring.normal;
    let clearance = Infinity;
    // a fan across the line the aircraft flies in on, not just the centreline
    for (let d = 0; d <= 420; d += 140) {
      for (const side of [-70, 0, 70]) {
        const x = ring.x - n.x * d + n.z * side, z = ring.z - n.z * d - n.x * side;
        clearance = Math.min(clearance, ring.y - world.surfaceAt(x, z));
      }
    }
    if (!best || clearance > best.clearance) best = { ring, clearance, index: i };
  }
  return best;
}

/**
 * A bearing the aircraft can come in on to reach a flare on the water: the whole line, sampled every
 * 100 metres, has to be sea. A flare moored in a fjord head has one or two such lines, and flying
 * the wrong one puts a low instrument approach into a hillside, which is what these samples check.
 */
function seaApproach(world, x, z, distance) {
  // surfaceAt clamps to the waterline, so whether a point is water has to be asked of the ground
  // height itself: anything above -6 metres is a bank, a beach or a hill, not a line to fly in on.
  const line = (a, d) => {
    let deepest = 0;
    for (let k = 0; k <= d; k += 80) {
      const h = world.heightAt(x + Math.sin(a) * k, z - Math.cos(a) * k);
      if (h > -6) return null;
      deepest = Math.max(deepest, -h);
    }
    return deepest;
  };
  for (const d of [distance, distance * 0.7, distance * 0.45]) {
    let best = null;
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      const deepest = line(a, d);
      if (deepest !== null && (!best || deepest > best.deepest)) best = { a, deepest };
    }
    if (best) return { x: x + Math.sin(best.a) * d, z: z - Math.cos(best.a) * d, heading: best.a + Math.PI, deepest: best.deepest, distance: d };
  }
  return { x: x - distance, z, heading: Math.PI / 2, deepest: 0, distance };
}

/** Let the run's own scoring see what just happened, so the HUD shows a real objective state. */
function score(ctx, seconds = 1.5) {
  const limit = Math.round(seconds / STEP);
  for (let i = 0; i < limit; i += 1) ctx.missions.update(STEP, ctx.model);
}

export const SHOTS = {
  cover: {
    weather: 'clear', camera: 'chase', mission: 'rings',
    blurb: 'chase view, wings banked, the third hoop of the ring course dead ahead over the coast',
    run(ctx) {
      const { model, missions, stage } = ctx;
      missions.start(1, model, stage.rig);
      const picked = pickRing(missions.state.steps, stage.world);
      const ring = picked.ring;
      // the run is on this hoop, not on the first one: the HUD's target arrow has to point at it
      missions.state.index = picked.index;
      missions.describe();
      const n = ring.normal;
      const x = ring.x - n.x * 300, z = ring.z - n.z * 300;
      model.place(x, Math.max(ring.y + 26, stage.world.surfaceAt(x, z) + 120), z, Math.atan2(n.x, -n.z), 46, 0);
      fly(model, (m) => {
        const cmd = { throttle: 0.78, elevator: 0, aileron: 0, rudder: 0, flaps: 0, brakes: 0, trim: 0 };
        cmd.elevator = clamp((0.012 - m.gamma) * 2.2 - (m.alpha - alphaFor(m, 46)) * 2.4);
        cmd.aileron = clamp((0.2 - m.bank) * 1.8);
        cmd.rudder = clamp(-m.beta * 3 + 0.14);
        guard(m, stage.world, cmd, 95);
        return cmd;
      }, 9, (m) => Math.hypot(m.pos.x - ring.x, m.pos.z - ring.z) < 115);
      score(ctx, 0.4);
    },
  },
  cockpit: {
    weather: 'clear', camera: 'cockpit', mission: 'courier',
    blurb: 'short final into a gravel strip from the seat: lit six-pack in frame, the strip and its lights ahead',
    run(ctx) {
      const { model, missions, stage } = ctx;
      missions.start(0, model, stage.rig);
      const strip = missions.state.steps[0].strip;
      const run = approachRun(strip, stage.world, { distance: 900 });
      model.place(run.start.x, run.start.y, run.start.z, run.start.heading, 37, -0.1);
      fly(model, approach(run), 45, (m) => {
        const dx = m.pos.x - run.touchdown.x, dz = m.pos.z - run.touchdown.z;
        const along = dx * run.fwd.fx + dz * run.fwd.fz;
        return m.onGround || along > -95;
      });
      score(ctx, 0.3);
    },
  },
  storm: {
    weather: 'storm', camera: 'chase', mission: 'sar',
    blurb: 'instrument flying in the storm: rain, fog at 2.6 km, the attitude indicator level, the flare closing',
    run(ctx) {
      const { model, missions, stage } = ctx;
      missions.start(2, model, stage.rig);
      const beacon = missions.state.steps[0];
      const from = seaApproach(stage.world, beacon.x, beacon.z, 520);
      model.place(from.x, Math.min(118, 46 + from.deepest * 0.15), from.z, from.heading, 36, -0.02);
      fly(model, (m) => {
        const cmd = autopilotFlyTo(() => ({ x: beacon.x, y: 58, z: beacon.z, speed: 36 }), { speed: 36 })(m);
        cmd.elevator = clamp((-0.03 - m.gamma) * 2.4 - (m.alpha - alphaFor(m, 36)) * 2.2);
        cmd.throttle = 0.68;
        cmd.aileron = clamp((0.1 - m.bank) * 1.4);
        guard(m, stage.world, cmd, 45);
        return cmd;
      }, 22, (m) => Math.hypot(m.pos.x - beacon.x, m.pos.z - beacon.z) < 200);
    },
  },
  delivery: {
    weather: 'clear', camera: 'chase', mission: 'courier',
    blurb: 'the wheels on the gravel, the grade panel up, the crate delivered, peaks behind the strip',
    run(ctx) {
      const { model, missions, stage } = ctx;
      missions.start(0, model, stage.rig);
      const step = missions.state.steps[1] || missions.state.steps[0];
      const strip = step.strip;
      // the load is already aboard and the run is on its drop: the HUD reads DELIVER TO <this strip>
      missions.state.index = missions.state.steps.indexOf(step);
      model.cargo = 1;
      if (missions.cargo) missions.cargo.visible = true;
      missions.describe();
      const run = approachRun(strip, stage.world, { distance: 820 });
      model.place(run.start.x, run.start.y, run.start.z, run.start.heading, 38, -0.1);
      fly(model, approach(run), 45, (m) => m.onGround);
      rollOut(model, run, 5);
      score(ctx, 1.2);
    },
  },
};

/** Stage the named scene and leave the frame ready to be photographed. */
export function stageShot(name, ctx) {
  const shot = SHOTS[name] || SHOTS.cover;
  ctx.stage.setWeather(shot.weather);
  shot.run(ctx);
  ctx.stage.rig.mode = shot.camera;
  // settle the camera on its spring so the frame is composed, not mid-swing
  for (let i = 0; i < 120; i += 1) ctx.stage.rig.update(STEP, ctx.model, ctx.stage.world);
  return { name: SHOTS[name] ? name : 'cover', shot, contact: ctx.model.contact };
}
