// The fjord: one analytic height function (fractal land, ridged walls, carved channels, and a flat
// bench cut for every airstrip) plus the meshes built from it — a flat-shaded terrain mesh with a
// high-resolution detail patch that follows the aircraft, depth-tinted water with travelling waves,
// seeded stands of trees and scree, and the strips themselves with their pads, markings, edge
// lights, hangars and town. Nothing here reads the clock or randomness: the same seed is the same
// coast, frame after frame and screenshot after screenshot.
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, PALETTE, STRIPS } from './config.js';
import { fbm, ridge, noise2, sequence } from './rng.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Terrain palette, resolved once: colorFor runs on every vertex of a 90k-vertex mesh.
const UNDERWATER = new THREE.Color(PALETTE.rock);
const SAND = new THREE.Color(PALETTE.sand);
const GRASS = new THREE.Color(PALETTE.grass);
const GRASS_DARK = new THREE.Color(PALETTE.grassDark);
const ROCK = new THREE.Color(PALETTE.rock);
const SNOW = new THREE.Color(PALETTE.snow);

/** Where a strip lies in the ground plane: forward and right unit vectors in (x east, z south). */
function stripAxes(heading) {
  return { fx: Math.sin(heading), fz: -Math.cos(heading), rx: Math.cos(heading), rz: Math.sin(heading) };
}

/**
 * Natural ground height before any strip is cut. Four fields multiply: a continent mask (where there
 * is land at all), a ridged peak field (how high it goes), a rare carved channel field (the fjords,
 * which cut land below sea level so the sea floods them), and an edge fade to open ocean. Tuned with
 * tools/tune-terrain.mjs so about a third of the map is water and the strips sit on real benches.
 */
function naturalHeight(x, z, seed) {
  const d = Math.hypot(x, z) / (WORLD.size * 0.5);
  const edge = 1 - smoothstep(0.78, 1.12, d);                    // the map fades to open sea
  const cont = smoothstep(0.36, 0.53, fbm(x, z, seed, 5, 0.5, 2.03, 1 / 1150));
  const land = cont * (0.3 + 0.7 * edge);
  const peaks = 30 + ridge(x, z, seed + 991, 4, 1 / 1650) * WORLD.relief;
  const channel = 1 - smoothstep(0.31, 0.43, noise2(x, z, seed + 77, 1 / 2500));
  const shelf = smoothstep(0.66, 0.92, noise2(x, z, seed + 313, 1 / 780)) * 18;
  const high = land * peaks;
  const cut = channel * (high * 0.9 + 200) + (1 - land) * 130 + (1 - edge) * 220;
  return high - cut + shelf * land;
}

/** Median-ish natural height across a strip's rectangle: the bench it is cut or filled to. */
function stripAltitude(strip, seed) {
  const ax = stripAxes(strip.heading);
  const samples = [];
  for (let i = 0; i <= 6; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      const along = (i / 6 - 0.5) * strip.length;
      const across = j * strip.width * 0.5;
      samples.push(naturalHeight(strip.x + along * ax.fx + across * ax.rx, strip.z + along * ax.fz + across * ax.rz, seed));
    }
  }
  samples.sort((a, b) => a - b);
  if (strip.kind === 'water') return 0;              // pontoons sit on the water, not on a bench
  return Math.min(300, Math.max(14, samples[Math.floor(samples.length / 2)] + 3));
}

export class World {
  constructor(seed = WORLD.seed) {
    this.seed = seed;
    this.strips = STRIPS.map((s) => ({ ...s, altitude: stripAltitude(s, seed), axes: stripAxes(s.heading) }));
    this.group = new THREE.Group();
    this.detailOrigin = { x: NaN, z: NaN };
    this.time = 0;
    this.waterUniforms = { uTime: { value: 0 } };
    this.buildTerrain();
    this.buildWater();
    this.buildScatter();
    this.buildStrips();
  }

  /**
   * Ground height at (x, z): the natural coast, then each strip's river valley cut into it, then the
   * flat bench the strip itself sits on. The valley is what makes a hill strip flyable: the floor
   * slopes gently away from the threshold, so an approach down the dale has sky in front of it, and
   * the walls that rise on either side are what makes it read as a fjord on screen.
   */
  heightAt(x, z) {
    let h = naturalHeight(x, z, this.seed);
    for (let i = 0; i < this.strips.length; i += 1) {
      const s = this.strips[i];
      const dx = x - s.x, dz = z - s.z;
      const signed = dx * s.axes.fx + dz * s.axes.fz;
      const across = Math.abs(dx * s.axes.rx + dz * s.axes.rz);
      const half = s.length * 0.5;
      const back = Math.max(0, -signed - half);      // metres down the valley behind the threshold
      const over = Math.max(0, signed - half);       // metres up the dale past the far end
      if (back < 2200 || over < 800) {
        const floor = s.altitude - 6 - back * 0.022 + over * 0.055;
        const wall = smoothstep(s.width * 0.5 + 58, s.width * 0.5 + 250, across);
        const ends = Math.max(1 - smoothstep(1500, 2200, back), 1 - smoothstep(420, 800, over));
        h = mix(h, floor, (1 - wall) * ends * 0.94);
      }
    }
    for (let i = 0; i < this.strips.length; i += 1) {
      const s = this.strips[i];
      const dx = x - s.x, dz = z - s.z;
      const along = Math.abs(dx * s.axes.fx + dz * s.axes.fz) / (s.length * 0.5 + 46);
      const across = Math.abs(dx * s.axes.rx + dz * s.axes.rz) / (s.width * 0.5 + 74);
      const d = Math.max(along, across);
      if (d < 1) h = mix(h, s.altitude, 1 - smoothstep(0.42, 1, d));
    }
    return h;
  }

  /** Which strip the point is on or over, if any: the landing grader and the HUD need it. */
  stripHere(x, z, margin = 0) {
    for (let i = 0; i < this.strips.length; i += 1) {
      const s = this.strips[i];
      const dx = x - s.x, dz = z - s.z;
      const along = Math.abs(dx * s.axes.fx + dz * s.axes.fz) - (s.length * 0.5 + margin);
      const across = Math.abs(dx * s.axes.rx + dz * s.axes.rz) - (s.width * 0.5 + margin);
      if (along <= 0 && across <= 0) return s;
    }
    return null;
  }

  /** Surface height the aircraft sees: water for a flooded channel, else ground. */
  surfaceAt(x, z) {
    const h = this.heightAt(x, z);
    return h > WORLD.waterLevel ? h : WORLD.waterLevel;
  }

  slopeAt(x, z) {
    const e = 9;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  /** What a vertex of the terrain is painted: seabed, beach, meadow, scree, snow, by height and steepness. */
  colorFor(h, slope, x, z, out) {
    const band = noise2(x, z, this.seed + 4242, 1 / 260);
    if (h < -2) return out.copy(UNDERWATER).multiplyScalar(0.6 + 0.5 * band);
    if (h < 5) return out.copy(SAND);
    const snow = smoothstep(430, 560, h);
    const rock = Math.min(1, smoothstep(0.42, 0.95, slope) + smoothstep(300, 430, h) * 0.8);
    out.copy(GRASS).lerp(GRASS_DARK, band).lerp(ROCK, rock);
    if (snow > 0) out.lerp(SNOW, snow);
    return out.multiplyScalar(0.9 + 0.18 * band);
  }

  buildTerrain() {
    const seg = WORLD.gridSegments;
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, seg, seg);
    // Heights are written to the plane's local Z, so the mesh is yawed flat: local (x, y) maps to
    // world (x, -z) and local z becomes world up. Every sampler below relies on that mapping.
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const row = seg + 1;
    // Heights first, into a grid: the slope of a vertex is then just its neighbours' difference,
    // which is four analytic evaluations saved per vertex on a 90k-vertex mesh.
    const hs = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      hs[i] = this.heightAt(pos.getX(i), -pos.getY(i));
      pos.setZ(i, hs[i]);
    }
    const cell = WORLD.size / seg;
    for (let j = 0; j <= seg; j += 1) {
      for (let i = 0; i <= seg; i += 1) {
        const k = j * row + i;
        const lft = hs[j * row + Math.max(0, i - 1)], rgt = hs[j * row + Math.min(seg, i + 1)];
        const up = hs[Math.max(0, j - 1) * row + i], dn = hs[Math.min(seg, j + 1) * row + i];
        const slope = Math.hypot(rgt - lft, dn - up) / (2 * cell);
        this.colorFor(hs[k], slope, pos.getX(k), -pos.getY(k), c);
        colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.94, metalness: 0 }));
    this.terrain.rotation.x = -Math.PI / 2;
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);

    // A finer patch, rebuilt as the aircraft moves, so a final approach has real ground under it.
    const dSeg = 84, extent = WORLD.detailSpan;
    this.detailGeo = new THREE.PlaneGeometry(extent, extent, dSeg, dSeg);
    this.detailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.detailGeo.attributes.position.count * 3), 3));
    this.detailGeo.computeVertexNormals();
    this.detail = new THREE.Mesh(this.detailGeo, this.terrain.material);
    this.detail.rotation.x = -Math.PI / 2;
    this.detail.receiveShadow = true;
    this.detail.visible = false;
    this.group.add(this.detail);
    this.detailExtent = extent;
  }

  /** Move the detail patch under (x, z) and re-cut it: analytic height inside, the coarse mesh at the rim. */
  updateDetail(x, z) {
    const ox = Math.round(x / 300) * 300, oz = Math.round(z / 300) * 300;
    if (ox === this.detailOrigin.x && oz === this.detailOrigin.z) return;
    this.detailOrigin = { x: ox, z: oz };
    const pos = this.detailGeo.attributes.position;
    const col = this.detailGeo.attributes.color;
    const c = new THREE.Color();
    const cell = WORLD.size / WORLD.gridSegments;
    const half = this.detailExtent * 0.5;
    const dSeg = WORLD.detailSeg;
    const row = dSeg + 1;
    const precise = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      precise[i] = this.heightAt(ox + pos.getX(i), oz - pos.getY(i));
    }
    const dCell = this.detailExtent / dSeg;
    for (let i = 0; i < pos.count; i += 1) {
      const wx = ox + pos.getX(i), wz = oz - pos.getY(i);
      const gi = i % row, gj = Math.floor(i / row);
      const slope = Math.hypot(
        precise[gj * row + Math.min(dSeg, gi + 1)] - precise[gj * row + Math.max(0, gi - 1)],
        precise[Math.min(dSeg, gj + 1) * row + gi] - precise[Math.max(0, gj - 1) * row + gi],
      ) / (2 * dCell);
      const h = precise[i];
      // Blend the outer rim toward the coarse mesh, so the patch has no seam where it ends.
      const rim = Math.max(Math.abs(wx - ox), Math.abs(wz - oz)) / half;
      let hh = h;
      if (rim > 0.55) {
        const gx = Math.round(wx / cell) * cell, gz = Math.round(wz / cell) * cell;
        const coarse = mix(
          this.heightAt(gx, gz),
          this.heightAt(gx + Math.sign(wx - gx) * cell, gz + Math.sign(wz - gz) * cell),
          0.5,
        );
        hh = mix(h, coarse, smoothstep(0.55, 1, rim) * 0.7);
      }
      pos.setZ(i, hh + 0.06);
      this.colorFor(h, slope, wx, wz, c);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.detailGeo.computeVertexNormals();
    this.detail.position.set(ox, 0, oz);
    this.detail.visible = true;
  }

  buildWater() {
    const size = WORLD.size * 1.6;
    const geo = new THREE.PlaneGeometry(size, size, 220, 220);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = -pos.getY(i);
      const depth = Math.max(0, -this.heightAt(x, z));
      const shallow = 1 - smoothstep(2, 46, depth);
      c.setHex(PALETTE.waterDeep, THREE.SRGBColorSpace).lerp(new THREE.Color(PALETTE.waterShallow), shallow);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.09, metalness: 0.28, transparent: true, opacity: 0.93, flatShading: false,
    });
    // Three's vertex order is beginnormal -> defaultnormal -> begin_vertex, so the wave normal is
    // computed where the default normal would go and the displacement where the vertex would go.
    // Both share the same three sine trains, and dh/dx, dh/dz are their exact derivatives.
    const k = WORLD.waveScale;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n#define WAVE_K ' + k.toFixed(5) + '\n' + shader.vertexShader
        .replace('#include <beginnormal_vertex>', `
          vec3 objectNormal = normalize(vec3(
            -(cos(position.x * WAVE_K + uTime * 1.1) * 0.55 * WAVE_K
              + cos((position.x + position.z) * WAVE_K * 0.6 + uTime * 0.5) * 0.8 * WAVE_K * 0.6),
            1.0,
            -(cos(position.z * WAVE_K * 1.7 - uTime * 0.8) * 0.35 * WAVE_K * 1.7
              + cos((position.x + position.z) * WAVE_K * 0.6 + uTime * 0.5) * 0.8 * WAVE_K * 0.6)));
        `)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          transformed.y += sin(position.x * WAVE_K + uTime * 1.1) * 0.55
                         + sin(position.z * WAVE_K * 1.7 - uTime * 0.8) * 0.35
                         + sin((position.x + position.z) * WAVE_K * 0.6 + uTime * 0.5) * 0.8;
        `);
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WORLD.waterLevel + 0.4;
    this.water.receiveShadow = true;
    this.group.add(this.water);
  }

  /** Trees and scree, placed by the seeded sequence and only where the ground allows it. */
  buildScatter() {
    const rnd = sequence(this.seed, WORLD.treeCount * 2);
    const trees = [], rocks = [];
    for (let i = 0; i < WORLD.treeCount * 2 && trees.length < WORLD.treeCount; i += 1) {
      const x = (rnd[i * 3] - 0.5) * WORLD.size * 0.98;
      const z = (rnd[i * 3 + 1] - 0.5) * WORLD.size * 0.98;
      const h = this.heightAt(x, z);
      if (h < 6 || h > 340 || this.slopeAt(x, z) > 0.55) continue;
      if (this.stripHere(x, z, 60)) continue;
      trees.push({ x, y: h, z, s: 0.7 + rnd[i * 3 + 2] * 0.9 });
    }
    for (let i = 0; i < WORLD.rockCount * 2 && rocks.length < WORLD.rockCount; i += 1) {
      const x = (rnd[(i + WORLD.treeCount * 2) * 3 % rnd.length] - 0.5) * WORLD.size * 0.98;
      const z = (rnd[(i + WORLD.treeCount * 2) * 3 + 1 % rnd.length] - 0.5) * WORLD.size * 0.98;
      const h = this.heightAt(x, z);
      if (h < -4 || this.slopeAt(x, z) < 0.3) continue;
      rocks.push({ x, y: h, z, s: 1.4 + rnd[i * 3 + 2] * 5 });
    }
    this.group.add(this.instancedConifer(trees));
    this.group.add(this.instancedRock(rocks));
  }

  instancedConifer(list) {
    const trunkGeo = new THREE.CylinderGeometry(0.42, 0.62, 3.4, 5);
    const crownGeo = new THREE.ConeGeometry(2.5, 9.2, 6);
    crownGeo.translate(0, 6.2, 0);
    const group = new THREE.Group();
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9, flatShading: true }), list.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: PALETTE.forest, roughness: 0.86, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < list.length; i += 1) {
      const t = list[i];
      e.set(0, hashAngle(t.x, t.z), 0);
      q.setFromEuler(e);
      v.set(t.x, t.y - 0.4, t.z);
      s.set(t.s, t.s * (0.8 + 0.4 * ((i % 7) / 7)), t.s);
      m.compose(v, q, s);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      col.setHex(PALETTE.forest, THREE.SRGBColorSpace).multiplyScalar(0.72 + 0.5 * ((i % 11) / 11));
      crowns.setColorAt(i, col);
    }
    trunks.castShadow = false; crowns.castShadow = false;
    group.add(trunks, crowns);
    return group;
  }

  instancedRock(list) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE.rock, roughness: 0.95, flatShading: true }), Math.max(1, list.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      e.set(r.x * 0.01, r.z * 0.013, r.x * 0.007);
      q.setFromEuler(e);
      v.set(r.x, r.y - r.s * 0.3, r.z);
      s.set(r.s, r.s * 0.7, r.s * 1.2);
      m.compose(v, q, s);
      mesh.setMatrixAt(i, m);
    }
    return mesh;
  }

  buildStrips() {
    this.stripMeshes = [];
    for (const s of this.strips) this.stripMeshes.push(this.buildStrip(s));
  }

  buildStrip(s) {
    const group = new THREE.Group();
    group.position.set(s.x, s.altitude, s.z);
    group.rotation.y = -s.heading;   // model faces -Z, so a yaw of -heading points it along the strip
    const padMat = new THREE.MeshStandardMaterial({
      map: padTexture(s), color: s.kind === 'water' ? 0x14303f : 0xffffff, roughness: s.kind === 'water' ? 0.4 : 0.95, metalness: 0,
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.length), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.12;
    pad.receiveShadow = true;
    group.add(pad);
    if (s.kind === 'water') {
      const dock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 34), new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9 }));
      dock.position.set(s.width * 0.42, 0.6, -s.length * 0.35);
      group.add(dock);
    } else {
      // a bench cut into the hill: two retaining walls at the downhill end
      const wall = new THREE.MeshStandardMaterial({ color: PALETTE.rock, roughness: 1, flatShading: true });
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, s.length * 0.5), wall);
        w.position.set(side * (s.width * 0.5 + 0.8), -1.2, s.length * 0.25);
        group.add(w);
      }
    }
    this.stripLights(group, s);
    if (s.town) this.hangarAndTown(group, s);
    else this.beaconMast(group, s);
    return { strip: s, group };
  }

  /** The edge lights and threshold bars that make a strip read as a strip from the air. */
  stripLights(group, s) {
    const count = Math.floor(s.length / 34) * 2 + 8;
    const geo = new THREE.BoxGeometry(0.7, 0.9, 0.7);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
      color: PALETTE.runwayLight, emissive: PALETTE.runwayLight, emissiveIntensity: 2.4, roughness: 0.5,
    }), count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let k = 0; k <= 6; k += 1) {
      const z = (k / 6 - 0.5) * s.length;
      for (const side of [-1, 1]) {
        if (i >= count) break;
        m.makeTranslation(side * s.width * 0.5, 0.5, z);
        mesh.setMatrixAt(i++, m);
      }
    }
    for (const z of [-s.length * 0.5 + 3, s.length * 0.5 - 3]) {
      for (let k = -2; k <= 2 && i < count; k += 1) {
        m.makeTranslation(k * (s.width * 0.22), 0.5, z);
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.count = i;
    group.add(mesh);
    this.lightGlow = this.lightGlow || glowSprite(PALETTE.runwayLight, 64);
    for (let k = 0; k <= 6; k += 1) {
      const z = (k / 6 - 0.5) * s.length;
      for (const side of [-1, 1]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.lightGlow.texture, color: PALETTE.runwayLight, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        sp.position.set(side * s.width * 0.5, 0.9, z);
        sp.scale.set(4.2, 4.2, 1);
        group.add(sp);
      }
    }
  }

  hangarAndTown(group, s) {
    const roof = new THREE.MeshStandardMaterial({ color: 0x8c3f2e, roughness: 0.8, flatShading: true });
    const wall = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9, flatShading: true });
    const hangar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 22), wall);
    body.position.y = 3.5;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.2, 18, 10, 1, false, 0, Math.PI), roof);
    top.rotation.z = Math.PI / 2;
    top.position.y = 7;
    hangar.add(body, top);
    hangar.position.set(-s.width * 0.9, 0, -s.length * 0.3);
    hangar.castShadow = true;
    group.add(hangar);
    for (let i = 0; i < 7; i += 1) {
      const h = 4 + ((i * 37) % 5);
      const house = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(6 + (i % 3) * 2, h, 6 + (i % 2) * 3), i % 2 ? wall : new THREE.MeshStandardMaterial({ color: 0x9fb0a8, roughness: 0.9, flatShading: true }));
      box.position.y = h * 0.5;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3.4, 4), roof);
      cap.position.y = h + 1.6;
      cap.rotation.y = Math.PI / 4;
      house.add(box, cap);
      house.position.set(-s.width * 1.3 - (i % 3) * 12, 0, -s.length * 0.15 + i * 13);
      house.rotation.y = ((i * 61) % 40 - 20) * 0.01;
      group.add(house);
    }
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 9, 6), new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 1 }));
    stack.position.set(-s.width * 0.9, 11, -s.length * 0.3 + 6);
    group.add(stack);
  }

  beaconMast(group, s) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, 26, 6), new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.7, metalness: 0.4 }));
    mast.position.set(s.width * 0.8, 13, s.length * 0.32);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 3 }));
    lamp.position.set(s.width * 0.8, 26.4, s.length * 0.32);
    group.add(mast, lamp);
    const windsock = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.4, 8, 1, true), new THREE.MeshStandardMaterial({ color: PALETTE.accent, side: THREE.DoubleSide, roughness: 0.8 }));
    windsock.rotation.z = -Math.PI / 2.4;
    windsock.position.set(s.width * 0.62, 7.4, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7.6, 5), new THREE.MeshStandardMaterial({ color: 0x8b949c }));
    pole.position.set(s.width * 0.62, 3.8, 0);
    group.add(pole, windsock);
  }

  /** Called every frame: drift the waves and keep the detail patch under the aircraft. */
  update(dt, position) {
    this.time += dt;
    this.waterUniforms.uTime.value = this.time;
    this.updateDetail(position.x, position.z);
  }
}

const hashAngle = (x, z) => (Math.sin(x * 0.031 + z * 0.057) * 0.5 + 0.5) * Math.PI * 2;

/** A soft round glow, drawn once into a canvas and reused by every lamp and flare. */
export function glowSprite(color, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.75)');
  g.addColorStop(1, 'rgba(255,220,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, color };
}

/** The painted pad: threshold bars, a centreline, the strip number and the edges, per strip. */
function padTexture(s) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = s.kind === 'water' ? '#12303c' : '#5b5a52';
  ctx.fillRect(0, 0, 128, 512);
  if (s.kind !== 'water') {
    ctx.fillStyle = 'rgba(120,116,104,0.55)';
    for (let i = 0; i < 900; i += 1) {
      const x = (i * 61) % 128, y = (i * 211) % 512;
      ctx.fillRect(x, y, 3 + (i % 4), 2 + (i % 3));
    }
  }
  ctx.fillStyle = '#e8e6dc';
  for (const y of [26, 486]) {
    for (let k = 0; k < 5; k += 1) ctx.fillRect(14 + k * 22, y - 12, 12, 24);
  }
  for (let y = 60; y < 460; y += 44) ctx.fillRect(60, y, 8, 24);
  ctx.strokeStyle = 'rgba(232,230,220,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 18, 116, 476);
  ctx.save();
  ctx.translate(64, 150);
  ctx.fillStyle = '#e8e6dc';
  ctx.font = 'bold 54px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(stripNumber(s.heading), 0, 0);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Runway number: the magnetic heading of the pad, rounded to ten degrees, from this end. */
export function stripNumber(heading) {
  const deg = ((heading * 180 / Math.PI) % 360 + 360) % 360;
  return String(Math.max(1, Math.round(deg / 10))).padStart(2, '0');
}
