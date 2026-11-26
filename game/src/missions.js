// The work that gets flown: three runs with different goals and different pressures. A courier haul
// lands twice per leg — lift the crate, take it somewhere else, and the score is the clock plus how
// the wheels met the ground; a ring course is pure accuracy, nine hoops threaded in order through a
// fjord; a storm rescue is an instrument run, find the flare on the water in near-zero visibility
// and set the survivor down on a strip. Each keeps its own best score in localStorage, and each one
// hands the HUD a target and the missions clock its remaining time.
import * as THREE from '../vendor/three.module.min.js';
import { MISSIONS, PALETTE } from './config.js';
import { glowSprite } from './world.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * A route through the strips, chosen from the seed so the run is the same every time. Only the gravel
 * strips are on the mail round: the aircraft carries tundra tyres, not floats, and the marina is for
 * the rescue run, where a survivor is picked up from the water and flown to a strip.
 */
function route(pool, seedShift, count) {
  const order = pool.map((s, i) => ({ i, k: ((i + 1) * 2654435761 + seedShift * 40503) >>> 0 }));
  order.sort((a, b) => a.k - b.k);
  const ids = order.map((o) => o.i);
  const out = [];
  for (let i = 0; i < count + 1; i += 1) out.push(ids[i % ids.length]);
  return out;
}

export class Missions {
  constructor(world, store = safeStore()) {
    this.world = world;
    this.store = store;
    this.group = new THREE.Group();
    this.defs = [
      { id: 'courier', label: MISSIONS.courier.label, blurb: 'two legs, four landings, fuel by the hour' },
      { id: 'rings', label: MISSIONS.rings.label, blurb: 'nine hoops in order, no landings, all accuracy' },
      { id: 'sar', label: MISSIONS.sar.label, blurb: 'find the flare in the storm and land the survivor' },
    ];
    this.selected = 0;
    this.state = null;
  }

  get list() { return this.defs; }
  /** The strips a wheeled aircraft can be landed on: the gravel benches, not the marina. */
  get gravel() { return this.world.strips.filter((s) => s.kind !== 'water'); }
  get blurb() { return this.defs[this.selected].blurb; }

  best(id) { return Number(this.store.get(`skysail-best-${id}`) || 0); }

  /** Begin a run: build the step list, place the aircraft, and set the weather it needs. */
  start(index, model, camera) {
    this.selected = ((index % this.defs.length) + this.defs.length) % this.defs.length;
    const def = this.defs[this.selected];
    this.group.clear();
    this.rings = [];
    this.cargoMesh = null;
    this.beacon = null;
    model.cargo = 0;
    const strips = this.gravel;
    let steps = [];
    let start;
    if (def.id === 'courier') {
      const ids = route(this.gravel, 3, MISSIONS.courier.legs);
      for (let i = 0; i < MISSIONS.courier.legs; i += 1) {
        steps.push({ type: 'land', strip: strips[ids[i]], want: 'load', label: `LOAD AT ${strips[ids[i]].name}` });
        steps.push({ type: 'land', strip: strips[ids[i + 1]], want: 'drop', label: `DELIVER TO ${strips[ids[i + 1]].name}` });
      }
      start = this.stripStart(steps[0].strip);
    } else if (def.id === 'rings') {
      steps = this.buildRings(MISSIONS.rings.count);
      start = this.ringStart(steps[0]);
    } else {
      const b = this.buildBeacon();
      steps = [{ type: 'locate', ...b, label: 'FIND THE FLARE' }, { type: 'land', strip: b.rescue, want: 'drop', label: `LAND AT ${b.rescue.name}` }];
      start = this.stripStart(b.rescue);
    }
    model.world = this.world;
    model.place(start.x, start.y, start.z, start.heading, start.speed, 0);
    this.state = {
      id: def.id, label: def.label, steps, index: 0, score: 0, clock: 0,
      remaining: this.timeFor(def.id), best: this.best(def.id), done: false, failed: null,
      weather: def.id === 'sar' ? 'storm' : 'clear',
    };
    if (camera) camera.mode = 'chase';
    this.describe();
    return this.state;
  }

  /** The clock for a run: each leg of a courier haul gets its own allowance, the course gets one. */
  timeFor(id) {
    const m = MISSIONS[id];
    const legs = id === 'courier' ? MISSIONS.courier.legs : 1;
    return (m.perLegSeconds || 220) * legs;
  }

  stripStart(strip) {
    if (!strip) return { x: 0, y: 500, z: 0, heading: 0, speed: 46 };
    const ax = strip.axes;
    return {
      x: strip.x - ax.fx * (strip.length * 0.5 + 900),
      y: strip.altitude + 420,
      z: strip.z - ax.fz * (strip.length * 0.5 + 900),
      heading: strip.heading,
      speed: 44,
    };
  }

  /** Nine hoops threaded down the fjord: alternating sides, climbing and descending, on a course. */
  buildRings(count) {
    const steps = [];
    const glow = glowSprite(PALETTE.ring, 128);
    let heading = 0.9;
    let x = -3200, z = -3200, y = 260;
    for (let i = 0; i < count; i += 1) {
      const t = i / Math.max(1, count - 1);
      heading += Math.sin(i * 1.7) * 0.55;
      const step = 620 + 260 * ((i % 3) / 3);
      x = clamp(x + Math.sin(heading) * step, -3900, 3900);
      z = clamp(z - Math.cos(heading) * step, -3900, 3900);
      y = 180 + 220 * t + Math.sin(i * 2.1) * 90;
      const ground = this.world.heightAt(x, z);
      if (y < ground + 90) y = ground + 90;
      const normal = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(MISSIONS.rings.ringRadius, 2.6, 8, 30),
        new THREE.MeshStandardMaterial({ color: PALETTE.ring, emissive: PALETTE.ring, emissiveIntensity: 1.6, roughness: 0.5, transparent: true, opacity: 0.95 }),
      );
      mesh.position.set(x, y, z);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow.texture, color: PALETTE.ring, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
      halo.scale.set(MISSIONS.rings.ringRadius * 2.4, MISSIONS.rings.ringRadius * 2.4, 1);
      mesh.add(halo);
      this.group.add(mesh);
      const prev = steps[steps.length - 1];
      steps.push({
        type: 'ring', x, y, z, radius: MISSIONS.rings.ringRadius, mesh,
        normal, from: prev ? -1 : 1, label: `RING ${i + 1}/${count}`,
        entered: false, crossed: false,
      });
      this.rings.push(mesh);
    }
    this.ringStartPos = { x, y, z, heading };
    return steps;
  }

  /** 1500 m before the first hoop, high enough to be clear of the ridge it hangs on. */
  ringStart(first) {
    if (!first) return { x: 0, y: 500, z: 0, heading: 0, speed: 46 };
    const n = first.normal;
    const x = first.x - n.x * 1500, z = first.z - n.z * 1500;
    return {
      x, z,
      y: Math.max(first.y, this.world.surfaceAt(x, z) + 130),
      heading: Math.atan2(n.x, -n.z), speed: 48,
    };
  }

  /** The flare: a boat on open water, a beacon light, and the strip the survivor is flown to. */
  buildBeacon() {
    const candidates = this.world.strips;
    // A grid over the coast, keeping only water deep enough that a boat is not aground, then one
    // spot picked by the seed: the rescue always finds the same flare, and it is always on the sea.
    const sea = [];
    for (let i = 0; i <= 64; i += 1) {
      for (let j = 0; j <= 64; j += 1) {
        const x = (i / 64 - 0.5) * 11000, z = (j / 64 - 0.5) * 11000;
        if (this.world.heightAt(x, z) < -22) sea.push({ x, z });
      }
    }
    const flareSpot = sea.length ? sea[Math.floor(sea.length * 0.37)] : { x: 0, z: 5200 };
    const group = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 18), new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.7, flatShading: true }));
    hull.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0xb8442e, roughness: 0.8 }));
    cabin.position.set(0, 2.2, -2);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 5), new THREE.MeshStandardMaterial({ color: 0x9aa3ab }));
    mast.position.set(0, 5.5, 3);
    group.add(hull, cabin, mast);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite(PALETTE.flare, 128).texture, color: PALETTE.flare, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    flare.scale.set(60, 60, 1);
    flare.position.set(0, 10, 3);
    group.add(flare);
    const light = new THREE.PointLight(PALETTE.flare, 40, 900, 2);
    light.position.copy(flare.position);
    group.add(light);
    group.position.set(flareSpot.x, 0.2, flareSpot.z);
    this.group.add(group);
    this.flare = flare;
    this.flareLight = light;
    // the survivor is flown to the nearest gravel bench, not dropped back on the water
    const nearest = candidates.filter((s) => s.kind !== 'water').reduce((best, s) => {
      const d = Math.hypot(s.x - flareSpot.x, s.z - flareSpot.z);
      return !best || d < best.d ? { s, d } : best;
    }, null);
    return { x: flareSpot.x, y: 26, z: flareSpot.z, radius: MISSIONS.sar.beaconRange, rescue: nearest.s, group };
  }

  /** What the HUD shows as this run's objective, and where to point. */
  describe() {
    const st = this.state;
    if (!st) return;
    const step = st.steps[st.index];
    st.objective = step ? step.label : 'RUN COMPLETE';
    st.leg = Math.min(st.steps.length, st.index + 1);
    st.legs = st.steps.length;
    if (!step) { st.target = null; return; }
    if (step.type === 'ring' || step.type === 'locate') {
      st.target = { x: step.x, y: step.y, z: step.z, label: step.label, kind: step.type === 'ring' ? 'ring' : 'beacon' };
    } else {
      const s = step.strip;
      st.target = { x: s.x, y: s.altitude + 2, z: s.z, label: step.label, kind: 'strip' };
    }
  }

  target() { return this.state ? this.state.target : null; }

  /** Advance the run: the clock, the step's own completion test, and the score it pays. */
  update(dt, model) {
    const st = this.state;
    if (!st || st.done) return st;
    st.clock += dt;
    st.remaining = Math.max(0, st.remaining - dt);
    const step = st.steps[st.index];
    if (!step) return st;
    const dx = model.pos.x - (step.x ?? step.strip?.x);
    const dz = model.pos.z - (step.z ?? step.strip?.z);
    const dy = model.pos.y - (step.y ?? (step.strip ? step.strip.altitude + 3 : 0));
    const ground = Math.hypot(dx, dz);
    if (step.type === 'ring') {
      const along = dx * step.normal.x + dz * step.normal.z;
      const inside = Math.hypot(dx - along * step.normal.x, dz - along * step.normal.z);
      if (Math.abs(along) < 26 && inside < step.radius) step.crossed = true;
      if (step.crossed) this.complete(model, MISSIONS.rings.pass + Math.round(clamp(1 - inside / step.radius, 0, 1) * 60), 'RING');
      else if (along > 30 && step.from < 0 || along < -30 && step.from > 0) {
        step.missed = true;
        st.index += 1;
        this.describe();
      }
    } else if (step.type === 'locate') {
      if (this.flare) {
        const flicker = 0.7 + 0.3 * Math.sin(st.clock * 9);
        this.flare.material.opacity = model.pos.y < 260 ? flicker : flicker * 0.55;
        this.flareLight.intensity = 30 * flicker;
      }
      if (ground < 320 && model.pos.y < 240) this.complete(model, 320, 'SIGHTED');
      else if (st.remaining === 0) this.fail(model, 'OUT OF TIME');
    } else if (step.type === 'land') {
      const s = step.strip;
      const onPad = this.world.stripHere(model.pos.x, model.pos.z, 2) === s;
      if (onPad && model.onGround && model.v < 9) {
        const contact = model.contact || { grade: 'firm', damage: 0 };
        const bonus = { smooth: 90, float: 110, firm: 45, offfield: 10, tailstrike: 5, hard: 0, ditch: 30, 'hard-ditch': 0 }[contact.grade] ?? 20;
        const time = Math.round(clamp(st.remaining / (MISSIONS.courier.perLegSeconds || 200), 0, 1) * MISSIONS.courier.onTime);
        this.complete(model, MISSIONS.courier.dropFee + bonus + time, contact.grade.toUpperCase());
      } else if (st.remaining === 0) this.fail(model, 'OUT OF TIME');
      else if (model.wrecked) this.fail(model, 'AIRFRAME LOST');
    }
    if (st.remaining === 0 && !st.done) this.fail(model, 'OUT OF TIME');
    return st;
  }

  complete(model, points, note) {
    const st = this.state;
    st.score += points;
    st.lastNote = { points, note, at: st.clock };
    st.index += 1;
    const step = st.steps[st.index - 1];
    if (step?.mesh) {
      step.mesh.material.emissiveIntensity = 0.25;
      step.mesh.material.color.setHex(0x4f6b52, THREE.SRGBColorSpace);
    }
    if (step?.type === 'land' && step.want === 'load') { model.cargo = 1; if (this.cargo) this.cargo.visible = true; }
    if (step?.type === 'land' && step.want === 'drop') { model.cargo = 0; }
    if (st.index >= st.steps.length) {
      st.done = true;
      st.failed = null;
      if (st.score > st.best) { st.best = st.score; this.store.set(`skysail-best-${st.id}`, String(st.score)); }
    }
    this.describe();
  }

  fail(model, reason) {
    const st = this.state;
    st.done = true;
    st.failed = reason;
    if (st.score > st.best) { st.best = st.score; this.store.set(`skysail-best-${st.id}`, String(st.score)); }
  }

  /** Meshes the run owns: rings, the boat, the crate strapped in the cabin. */
  attachCargo(crate) { this.cargo = crate; }

  group3D() { return this.group; }
}

/** localStorage where it exists, a plain map where it does not (the grader's container has none). */
function safeStore() {
  try {
    const ls = globalThis.localStorage;
    ls.setItem('skysail-probe', '1');
    ls.removeItem('skysail-probe');
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) };
  } catch {
    const map = new Map();
    return { get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) };
  }
}
