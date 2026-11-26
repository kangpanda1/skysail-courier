// The flight model: energy-state flight physics with no graphics in it at all. Airspeed, flight
// path and track are integrated from lift, drag, thrust and weight; attitude (pitch, bank, nose
// heading) hangs off that with the behaviours a pilot feels — static stability, a wing that lets go
// past the stall angle and buffets, prop torque and P-factor yaw, adverse yaw on the ailerons,
// ground effect on final, a taildragger that ground-loops if you are rough or slow-ruddered on the
// roll. Fuel burns by throttle, damage accrues on hard contacts and overspeed. Plain numbers in,
// plain numbers out: nothing here imports a renderer, so the same maths flies the game and poses
// the screenshots.
import { AIRFRAME as A, ENVELOPE as E, SIM, WORLD } from './config.js';

const G = SIM.g;
const WING_AREA = A.wing.area;
const SPAN = A.wing.span;
const CHORD = A.wing.chord;
const INDUCED = 1 / (Math.PI * A.wing.aspect * A.wing.oswald);
const GEAR_HEIGHT = 1.62;      // metres between the surface and the datum when the wheels touch
const FUEL_DENSITY = 0.79;     // kg per litre
const CRATE_MASS = 62;
const BURN_CRUISE = 0.112;     // litres per second at full throttle

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp1 = (v) => clamp(Number.isFinite(v) ? v : 0, -1, 1);
const wrapPi = (a) => (a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a);

/** Standard-atmosphere density ratio at an altitude in metres. */
export function densityRatio(altitude) {
  const h = Math.max(-200, Math.min(9000, altitude));
  const frac = 1 - 2.25577e-5 * h;
  const delta = Math.pow(frac, 5.2559);
  const temp = Math.pow(frac, 0.190284);
  return delta / temp;
}

/** Lift coefficient, including the break: linear to the stall angle, then the wing lets go. */
export function liftCoefficient(alpha) {
  const a = Math.max(-0.6, Math.min(0.6, alpha));
  const sign = a < 0 ? -1 : 1;
  const mag = Math.abs(a);
  if (mag <= A.stallAlpha) return A.clSlope * a;
  const broken = Math.min(1, (mag - A.stallAlpha) / 0.34);
  const held = 1 - (1 - A.sinkAfterStall) * broken;
  const further = Math.max(0, Math.min(1, (mag - A.stallAlpha - 0.34) / 0.5));
  return sign * A.clMax * (held - 0.55 * further);
}

export function stallSpeed(weight, sigma) {
  return Math.sqrt(weight / (0.5 * SIM.rho0 * sigma * WING_AREA * A.clMax));
}

export class FlightModel {
  constructor() {
    this.reset();
  }

  /** Put the aircraft in the air at (x, y, z) on a heading, at cruise, tanks full, airframe clean. */
  place(x, y, z, heading, airspeed = 46, gamma = 0) {
    this.pos = { x, y, z };
    this.v = airspeed;
    this.gamma = gamma;
    this.psi = heading;
    this.alpha = 0.055;
    this.beta = 0;
    this.bank = 0;
    this.throttle = 0.62;
    this.rpm = 0.62;
    this.trim = 0;
    this.flaps = 0;
    this.brakes = 0;
    this.fuel = A.fuelCapacity;
    this.damage = 0;
    this.onGround = false;
    this.gearDown = true;
    this.cargo = 0;
    this.contact = null;
    this.wrecked = false;
    this.buffet = 0;
    this.propAngle = 0;
    this.wheelSpin = 0;
    this.rollRate = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.smooth = { bank: 0, pitch: 0, heading: 0 };
    this.events = [];
  }

  reset() {
    this.place(0, 400, 0, 0, 46, 0);
    this.time = 0;
    this.distance = 0;
    this.bestGrade = null;
  }

  get mass() { return 1180 + this.fuel * FUEL_DENSITY + (this.cargo ? CRATE_MASS : 0); }
  get weight() { return this.mass * G; }
  get altitude() { return this.pos.y; }
  /** Body pitch and nose heading: flight path plus the angles of attack and sideslip. */
  get pitch() { return this.gamma + this.alpha; }
  get heading() { return this.psi + this.beta; }
  get airspeedKnots() { return this.v * 1.94384; }
  get compassDeg() { return compass(this.heading); }
  get stallSpeedKt() { return stallSpeed(this.weight, densityRatio(this.altitude)) * 1.94384; }
  /** What the turn coordinator's ball shows: the mismatch between the bank and the turn actually made. */
  get slip() {
    const wanted = Math.tan(this.bank) * G;
    const made = (this.turnRate || 0) * this.v;
    return Math.max(-1, Math.min(1, (this.beta * 2.4 + (wanted - made) / G) * 1.3));
  }
  get verticalSpeed() { return this.v * Math.sin(this.gamma); }
  get loadFactor() {
    const sigma = densityRatio(this.altitude);
    const q = 0.5 * SIM.rho0 * sigma * this.v * this.v * WING_AREA;
    return (q * liftCoefficient(this.alpha) * Math.cos(this.bank)) / this.weight;
  }
  get stallMargin() { return this.v / stallSpeed(this.weight, densityRatio(this.altitude)); }
  get stalled() { return Math.abs(this.alpha) > A.stallAlpha * 1.02; }
  get overspeed() { return this.v > E.vNever; }
  get fuelEmpty() { return this.fuel <= 0.02; }

  /** One fixed step. `cmd` is { throttle, elevator, aileron, rudder, flaps, brakes, trim }. */
  step(dt, cmd) {
    this.time += dt;
    this.events.length = 0;
    if (this.wrecked) { this.wreckedFall(dt); return this.events; }
    const sigma = densityRatio(this.altitude);
    const auth = Math.max(0.18, Math.min(1.15, (0.5 * SIM.rho0 * sigma * this.v * this.v * WING_AREA) / (this.weight * 0.95)));
    this.controlAuthority = auth;

    // commanded attitudes, with trim and the engine's asymmetric habits
    this.throttle += (cmd.throttle - this.throttle) * Math.min(1, dt * 2.6);
    this.rpm += (this.throttle * (this.fuelEmpty ? 0.18 : 1) - this.rpm) * Math.min(1, dt * 3.4);
    this.flaps += (cmd.flaps - this.flaps) * Math.min(1, dt * 1.2);
    this.brakes = cmd.brakes;
    this.trim = Math.max(-0.6, Math.min(0.6, this.trim + cmd.trim * dt));

    const aileron = clamp1(cmd.aileron);
    const elevator = clamp1(cmd.elevator);
    const rudder = clamp1(cmd.rudder);
    this.rollRate = E.rollRate * aileron * auth;
    this.bank = wrapPi(this.bank + this.rollRate * dt);

    // adverse yaw and prop torque: the ailerons and the throttle move the nose as well as the wings
    const pFactor = 0.26 * this.rpm * Math.cos(this.pitch) * (1 - Math.min(1, Math.abs(this.bank) / 1.2) * 0.35);
    const propwalk = -0.14 * this.rpm * aileron;                 // propwalk roll, felt as a rudder kick
    const adverse = -0.34 * aileron;                             // the ailerons drag the nose the wrong way
    this.yawRate = (E.yawRate * rudder + pFactor + adverse) * auth;
    this.beta = clamp(this.beta + this.yawRate * dt * 0.5 + propwalk * dt * 0.4 - 2.6 * this.beta * auth * dt, -0.55, 0.55);

    // aerodynamics
    const cl = liftCoefficient(this.alpha);
    const broken = Math.abs(this.alpha) > A.stallAlpha;
    const q = 0.5 * SIM.rho0 * sigma * this.v * this.v;
    const dynamic = q * WING_AREA;
    const groundEffect = this.groundEffectFactor();
    const lift = dynamic * cl * (1 + groundEffect * 0.32) * Math.cos(this.bank);
    const drag = dynamic * (A.cd0 + cl * cl * INDUCED * (1 - groundEffect * 0.28)
      + A.cdFlap * this.flaps + (this.gearDown ? A.gearDrag : 0)
      + (broken ? 0.18 : 0) + 1.1 * this.beta * this.beta);
    const thrust = this.thrustAvailable();

    // energy: thrust against drag, and the component of weight along the path
    const along = (thrust * Math.cos(this.beta) - drag) / this.mass - G * Math.sin(this.gamma);
    this.v = clamp(this.v + along * dt, 4, E.vNever * 1.16);
    if (this.onGround) {
      this.groundRoll(dt, cmd);
      return this.events;
    }

    // path: lift carries us around the curve, bank turns us, sideslip skids a little
    this.turnRate = (lift * Math.sin(this.bank) + dynamic * 1.05 * this.beta) / (this.mass * Math.max(9, this.v * Math.cos(this.gamma)));
    this.gamma = clamp(this.gamma + ((lift - this.weight * Math.cos(this.gamma)) / (this.mass * Math.max(9, this.v))) * dt, -1.35, 1.1);
    this.psi = wrapPi(this.psi + this.turnRate * dt);

    // pitch: elevator demand against static stability, and the nose dropping away in a stall
    const stab = broken
      ? -1.6 * Math.sign(this.alpha) * Math.min(1, (Math.abs(this.alpha) - A.stallAlpha) / 0.18)
      : -0.9 * (this.alpha - 0.035);
    this.pitchRate = E.pitchRate * clamp(elevator - this.trim + stab * 0.45, -1, 1) * auth;
    this.alpha = clamp(this.alpha + this.pitchRate * dt, -0.5, 0.62);
    // the wing needs a certain angle of attack at this speed and load, so relax toward it — slowly
    // once it has broken, which is why a stall has to be recovered rather than trimmed out
    const needed = Math.asin(clamp((this.weight * Math.cos(this.gamma)) / Math.max(1, dynamic * A.clMax * 0.98), -1, 1));
    this.alpha = clamp(this.alpha + (needed - this.alpha) * Math.min(1, dt * (broken ? 0.12 : 0.6)), -0.5, 0.62);

    // buffet, warnings and fuel
    this.buffet += ((broken ? Math.min(1, (Math.abs(this.alpha) - A.stallAlpha) / 0.22) : 0) - this.buffet) * Math.min(1, dt * 6);
    if (broken && !this.wasBroken) this.events.push('stall');
    this.wasBroken = broken;
    if (this.stallMargin < A.stallMargin && !broken && !this.onGround && !this.wasNearStall) this.events.push('warn-stall');
    this.wasNearStall = this.stallMargin < A.stallMargin;
    this.burnFuel(dt);
    if (this.overspeed && !this.wasOverspeed) this.events.push('warn-overspeed');
    this.wasOverspeed = this.overspeed;
    this.damage += (this.overspeed ? dt * 2.6 : 0);

    // where it ends up
    const forward = Math.cos(this.gamma);
    this.vel = { x: this.v * forward * Math.sin(this.psi), y: this.v * Math.sin(this.gamma), z: -this.v * forward * Math.cos(this.psi) };
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.distance += this.v * dt;
    this.propAngle += this.rpm * 46 * dt;
    this.wheelSpin += (this.v / 0.62) * dt;
    this.checkSurface(cmd);
    return this.events;
  }

  thrustAvailable() {
    const sigma = densityRatio(this.altitude);
    const static_ = A.thrustMax * this.throttle * Math.pow(sigma, 0.62);
    const decay = 1 - 0.5 * Math.min(1, this.v / E.vNever);
    const health = 1 - Math.min(0.6, this.damage / 100 * 0.6) - (this.fuelEmpty ? 0.85 : 0);
    return Math.max(0, static_ * decay * health);
  }

  burnFuel(dt) {
    if (this.fuel <= 0) return;
    const rate = BURN_CRUISE * Math.pow(Math.max(0.05, this.throttle), 1.6) + 0.006;
    this.fuel = Math.max(0, this.fuel - rate * dt);
    if (this.fuel === 0) this.events.push('fuel-out');
  }

  /** How much ground effect there is at this height above the surface, 0 in the air, 1 on the deck. */
  groundEffectFactor() {
    const surface = this.surfaceHere();
    const above = this.pos.y - GEAR_HEIGHT - surface;
    if (above < 0 || above > SPAN * 0.8) return 0;
    return 1 - above / (SPAN * 0.8);
  }

  /** The ground or water under the aircraft, from the world's own height function. */
  surfaceHere() {
    const w = this.world;
    if (!w) return 0;
    return w.surfaceAt(this.pos.x, this.pos.z);
  }

  /** Touchdown, ditching, a tail strike or a hillside: what the surface does to us this step. */
  checkSurface(cmd) {
    const surface = this.surfaceHere();
    const deck = surface + GEAR_HEIGHT;
    if (this.pos.y > deck) { if (this.onGround) { this.onGround = false; this.events.push('airborne'); } return; }
    if (!this.onGround) this.touchdown(surface, cmd);
    this.pos.y = deck;                                   // the wheels hold us on the surface
    this.onGround = true;
    // follow the ground along the heading, so a strip cut into a hillside has a gradient
    const ahead = this.world ? this.world.surfaceAt(this.pos.x + Math.sin(this.psi) * 14, this.pos.z - Math.cos(this.psi) * 14) : surface;
    const behind = this.world ? this.world.surfaceAt(this.pos.x - Math.sin(this.psi) * 14, this.pos.z + Math.cos(this.psi) * 14) : surface;
    const grade = Math.atan2(ahead - behind, 28);
    this.gamma += (grade - this.gamma) * Math.min(1, 8 * (1 / 60));
    this.alpha = Math.max(-0.1, Math.min(0.35, this.pitch - this.gamma + 0.02));
  }

  /** The moment of contact: graded on vertical speed, alignment, speed and bank, as a landing is. */
  touchdown(surface, cmd) {
    const vv = this.v * Math.sin(this.gamma);              // m/s, negative is a descent
    const strip = this.world ? this.world.stripHere(this.pos.x, this.pos.z, 6) : null;
    const onWater = surface <= WORLD.waterLevel + 0.2;
    const misalign = strip ? Math.abs(normAngle(this.psi - strip.heading)) : 0;
    const bankDeg = Math.abs(this.bank) * 57.3;
    const sink = -vv * 3.28084;                              // feet per minute
    let grade = 'smooth';
    let damage = 0;
    if (onWater) {
      grade = sink < 260 && bankDeg < 12 ? 'ditch' : 'hard-ditch';
      damage = grade === 'ditch' ? 6 : 34;
    } else if (sink > 900 || this.v > 74 || bankDeg > 26) {
      grade = 'hard';
      damage = 22 + Math.min(46, (sink - 900) / 26) + Math.max(0, bankDeg - 26) * 1.4;
    } else if (sink > 380 || bankDeg > 13 || misalign > 0.2) {
      grade = 'firm';
      damage = 5 + (sink - 380) / 90;
    } else if (sink < 90 && this.stallMargin > 1.35) {
      grade = 'float';
    }
    if (this.alpha > A.stallAlpha * 1.4 && sink > 200) { damage += 18; grade = 'tailstrike'; }   // nose up, dropped
    if (!strip && grade !== 'ditch') { damage += 14; grade = 'offfield'; }
    this.damage = Math.min(100, this.damage + damage);
    this.contact = { grade, sink, speed: this.v, bankDeg, misalign, strip: strip ? strip.id : null, damage };
    this.events.push(damage > 45 ? 'crash' : 'touchdown');
    if (this.damage >= 100) { this.wrecked = true; this.events.push('destroyed'); }
    // a taildragger that arrives fast, crooked or with no rudder on it swings off the strip
    const noRudder = Math.abs(cmd.rudder || 0) < 0.12 ? 1 : 0;
    this.groundLoop = (this.v > 24 ? 0.55 * noRudder : 0) + (misalign > 0.26 ? 0.5 : 0) + (sink > 700 ? 0.35 : 0);
  }

  /** The roll out: brakes, rudder steering, a taildragger's tendency to swing, and stopping clear. */
  groundRoll(dt, cmd) {
    const surface = this.surfaceHere();
    this.pos.y = surface + GEAR_HEIGHT;
    const mu = 0.045 + (this.brakes > 0.1 ? 0.32 * this.brakes : 0) + (this.contact && this.contact.grade === 'offfield' ? 0.2 : 0);
    const decel = mu * G + this.dragAcceleration();
    this.v = Math.max(0, this.v - decel * dt);
    const steer = E.yawRate * 0.55 * (cmd.rudder || 0) * Math.min(1, 7 / Math.max(1.2, this.v)) * (this.damage > 60 ? 0.4 : 1);
    this.psi += steer * dt;
    if (this.groundLoop > 0 && this.v > 9) {
      this.psi += this.groundLoop * 0.5 * dt * (this.v / 20);
      this.damage += this.groundLoop * dt * 6;
      if (this.damage >= 100) { this.wrecked = true; this.events.push('destroyed'); }
    }
    this.alpha += (0.06 - this.alpha) * Math.min(1, dt * 3);
    this.gamma *= 1 - Math.min(1, dt * 6);
    this.beta *= 1 - Math.min(1, dt * 6);
    this.bank *= 1 - Math.min(1, dt * 4);
    this.vel = { x: this.v * Math.sin(this.psi), y: 0, z: -this.v * Math.cos(this.psi) };
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.distance += this.v * dt;
    this.wheelSpin += (this.v / 0.62) * dt;
    this.propAngle += this.rpm * 46 * dt;
    if (this.v < 0.6 && !this.stopped) { this.stopped = true; this.events.push('stopped'); }
    if (this.v > 0.6) this.stopped = false;
  }

  dragAcceleration() {
    const sigma = densityRatio(this.altitude);
    const q = 0.5 * SIM.rho0 * sigma * this.v * this.v;
    return (q * WING_AREA * (A.cd0 + A.gearDrag + A.cdFlap * this.flaps)) / this.mass;
  }

  /** No more airframe: fall out of the sky and stop on the ground. */
  wreckedFall(dt) {
    this.v = Math.max(18, this.v - 12 * dt);
    this.gamma = Math.max(-1.1, this.gamma - 0.9 * dt);
    this.bank += 2.2 * dt;
    this.alpha += 0.4 * dt;
    this.pos.x += this.v * Math.cos(this.gamma) * Math.sin(this.psi) * dt;
    this.pos.y += this.v * Math.sin(this.gamma) * dt;
    this.pos.z += -this.v * Math.cos(this.gamma) * Math.cos(this.psi) * dt;
    this.propAngle += this.rpm * 20 * dt;
    if (this.pos.y <= this.surfaceHere() + 0.6) {
      this.pos.y = this.surfaceHere() + 0.6;
      this.v = 0;
      this.events.push('wreck-settled');
    }
  }

  /** Attitude as a quaternion-ish triple, for the camera and the mesh to share. */
  get attitude() {
    return { pitch: this.pitch, bank: this.bank, heading: this.heading };
  }
}

/** An angle wrapped to (-pi, pi]. */
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Compass heading in degrees, 0..360, north = 0. */
export function compass(heading) {
  return ((heading * 180 / Math.PI) % 360 + 360) % 360;
}
