// The aircraft: a fabric-covered taildragger built out of primitives so it reads as something
// assembled rather than drawn — a lathe-turned fuselage, a bolt-on cabin greenhouse, a braced high
// wing with flying wires, a radial behind a square cowl, tundra tires on rubber-banded legs, and a
// panel that carries the live instruments as an emissive texture. The returned `parts` are the
// pieces the flight model moves: prop, prop disc, rudder, elevator, wheels and the panel canvas.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE, AIRFRAME } from './config.js';

const REGISTRATION = 'SK-187';

/** A cylinder between two points, for struts and flying wires. */
function strut(from, to, radius, material) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const geo = new THREE.CylinderGeometry(radius, radius, dir.length(), 6);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

/** Text on a transparent plane: the registration on the fuselage side and the wing tops. */
function decal(text, width, height, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = colors.bg || 'rgba(0,0,0,0)';
  if (colors.bg) ctx.fillRect(0, 0, 512, 128);
  ctx.font = 'bold 74px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colors.fg || '#ffffff';
  ctx.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.92 }),
  );
  return mesh;
}

export function buildAircraft(panelCanvas) {
  const group = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: PALETTE.fuselage, roughness: 0.62, metalness: 0.08 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.cowl, roughness: 0.42, metalness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.75 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.95, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fc4d8, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
  });

  // fuselage: a lathe profile from the firewall to the tail post, laid along -Z (nose forward)
  const profile = [
    [0.30, 0.0], [0.64, 0.35], [0.68, 1.15], [0.70, 1.9], [0.72, 2.6],
    [0.66, 3.6], [0.52, 4.8], [0.34, 5.9], [0.18, 6.9], [0.10, 7.4],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fuseGeo = new THREE.LatheGeometry(profile, 14);
  fuseGeo.rotateX(Math.PI / 2);
  fuseGeo.translate(0, 0.28, -3.9);
  const fuselage = new THREE.Mesh(fuseGeo, cream);
  fuselage.castShadow = true;
  group.add(fuselage);

  // belly and cowling: the dark half of the livery, and the engine it wraps
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.6, 3.4, 14, 1, false, Math.PI * 0.72, Math.PI * 0.56), accent);
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, 0.28, -1.9);
  group.add(belly);
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.66, 1.35, 14), dark);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 0.3, -3.35);
  cowl.castShadow = true;
  group.add(cowl);
  for (let i = 0; i < 7; i += 1) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.9), dark);
    const a = -0.5 + i * 0.28;
    flap.position.set(Math.sin(a) * 0.74, 0.3 + Math.cos(a) * 0.74, -3.35);
    flap.rotation.z = -a;
    group.add(flap);
  }
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), steel);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.rotation.z = 0.2;
  exhaust.position.set(0.72, -0.12, -2.9);
  group.add(exhaust);

  // propeller: two blades on a spinner, plus the translucent disc that sells a fast engine
  const prop = new THREE.Group();
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.35, 0.09), new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.2 }));
    blade.position.y = side * 1.24;
    blade.rotation.y = side * 0.22;
    blade.castShadow = true;
    prop.add(blade);
  }
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 12), accent);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.35;
  prop.add(spinner);
  prop.position.set(0, 0.3, -4.05);
  group.add(prop);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.42, 28),
    new THREE.MeshBasicMaterial({ color: 0xd8e2ea, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.position.set(0, 0.3, -4.02);
  group.add(disc);

  // cabin greenhouse: frame, glass and the door the cargo goes through
  const cabin = new THREE.Group();
  const frameMat = accent;
  const glassPanel = new THREE.PlaneGeometry(1.05, 0.86);
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(glassPanel, glass);
    g.rotation.y = side * Math.PI / 2;
    g.position.set(side * 0.63, 0.98, -1.55);
    cabin.add(g);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.09), frameMat);
    bar.position.set(side * 0.64, 0.98, -1.05);
    cabin.add(bar);
  }
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.7), glass);
  windshield.position.set(0, 1.06, -2.28);
  windshield.rotation.x = -0.32;
  cabin.add(windshield);
  const windFrame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, 0.07), frameMat);
  windFrame.position.set(0, 1.06, -2.3);
  cabin.add(windFrame);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.09, 1.5), cream);
  roof.position.set(0, 1.44, -1.6);
  roof.castShadow = true;
  cabin.add(roof);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.6), cream);
  sill.position.set(0, 0.52, -1.55);
  cabin.add(sill);
  group.add(cabin);

  // the panel: the live instruments, drawn into a canvas and used as the emissive map
  const panelTexture = new THREE.CanvasTexture(panelCanvas);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 0.5),
    new THREE.MeshStandardMaterial({
      map: panelTexture, emissive: 0xffffff, emissiveMap: panelTexture, emissiveIntensity: 1.05,
      color: 0x2a2f35, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide,
    }),
  );
  panel.position.set(0, 0.86, -2.36);
  panel.rotation.x = -0.36;
  group.add(panel);
  const yoke = new THREE.Group();
  yoke.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), steel));
  const wheelBar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.028, 6, 14, Math.PI), dark);
  wheelBar.rotation.x = Math.PI / 2;
  wheelBar.position.y = 0.2;
  yoke.add(wheelBar);
  yoke.children[0].position.y = 0.02;
  yoke.position.set(0, 0.62, -2.1);
  yoke.rotation.x = 0.25;
  group.add(yoke);
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.16), dark);
    seat.position.set(side * 0.3, 0.72, -1.1);
    group.add(seat);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.44), accent);
    cushion.position.set(side * 0.3, 0.5, -1.3);
    group.add(cushion);
  }

  // wing: a braced high wing with dihedral, built in two halves so the struts meet it
  const wing = new THREE.Group();
  const halfSpan = AIRFRAME.wing.span / 2;
  const chord = AIRFRAME.wing.chord;
  const dihedral = 0.075;
  const wingSkin = new THREE.MeshStandardMaterial({ color: PALETTE.wing, roughness: 0.6, metalness: 0.06 });
  for (const side of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.BoxGeometry(halfSpan, 0.22, chord), wingSkin);
    half.position.set(side * halfSpan / 2, 0, 0);
    half.rotation.z = side * dihedral;
    half.castShadow = true;
    wing.add(half);
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, halfSpan, 6), accent);
    lead.rotation.z = Math.PI / 2;
    lead.position.set(side * halfSpan / 2, 0, -chord / 2);
    lead.rotation.y = 0;
    wing.add(lead);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.23, chord * 0.92), accent);
    tip.position.set(side * (halfSpan - 0.45), 0.035 * side, -0.05);
    tip.rotation.z = side * dihedral;
    wing.add(tip);
    const mark = decal(REGISTRATION, 2.6, 0.62, { fg: '#20242a' });
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(side * 3.4, 0.13, 0.1);
    wing.add(mark);
  }
  wing.position.set(0, 1.52, -1.15);
  group.add(wing);
  const braceMat = steel;
  for (const side of [-1, 1]) {
    group.add(strut(new THREE.Vector3(side * 0.5, 0.2, -0.75), new THREE.Vector3(side * 3.6, 1.5, -1.05), 0.045, braceMat));
    group.add(strut(new THREE.Vector3(side * 0.5, 0.2, -0.75), new THREE.Vector3(side * 3.6, 1.5, -1.6), 0.045, braceMat));
    group.add(strut(new THREE.Vector3(side * 4.85, 1.34, -1.2), new THREE.Vector3(0, 1.9, 3.1), 0.022, braceMat));
    group.add(strut(new THREE.Vector3(side * 4.85, 1.34, -1.05), new THREE.Vector3(0, 0.5, 3.3), 0.022, braceMat));
  }

  // tail: stabiliser, elevator, fin and rudder, the last two hinged so they move
  const stabilizer = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.16, 1.05), wingSkin);
  stabilizer.position.set(0, 0.62, 3.15);
  stabilizer.rotation.x = 0.03;
  stabilizer.castShadow = true;
  group.add(stabilizer);
  const elevator = new THREE.Group();
  const elevatorSkin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.62), accent);
  elevatorSkin.position.z = 0.32;
  elevator.add(elevatorSkin);
  elevator.position.set(0, 0.62, 3.68);
  group.add(elevator);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 1.35), cream);
  fin.position.set(0, 1.32, 3.3);
  fin.rotation.x = 0.22;
  fin.castShadow = true;
  group.add(fin);
  const rudder = new THREE.Group();
  const rudderSkin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.28, 0.72), accent);
  rudderSkin.position.set(0, 0.06, 0.34);
  rudder.add(rudderSkin);
  rudder.position.set(0, 1.5, 3.9);
  group.add(rudder);
  const tailPost = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6), steel);
  tailPost.rotation.x = Math.PI / 2;
  tailPost.position.set(0, 0.5, 3.4);
  group.add(tailPost);

  // gear: rubber-banded legs, tundra tires, and a small steerable tailwheel
  const wheels = [];
  for (const side of [-1, 1]) {
    const leg = strut(new THREE.Vector3(side * 0.62, 0.02, -2.5), new THREE.Vector3(side * 1.72, -1.28, -1.62), 0.075, steel);
    group.add(leg);
    const brace = strut(new THREE.Vector3(side * 0.5, 0.1, -0.9), new THREE.Vector3(side * 1.72, -1.28, -1.62), 0.05, steel);
    group.add(brace);
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 14), rubber);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.54, 10), accent);
    hub.rotation.z = Math.PI / 2;
    const fairing = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), cream);
    fairing.scale.set(0.5, 1, 1);
    wheel.add(tire, hub, fairing);
    wheel.position.set(side * 1.72, -1.28, -1.62);
    group.add(wheel);
    wheels.push(wheel);
  }
  const tailLeg = strut(new THREE.Vector3(0, 0.32, 3.0), new THREE.Vector3(0, -0.34, 3.75), 0.055, steel);
  group.add(tailLeg);
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 10), rubber);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.34, 3.75);
  group.add(tailWheel);
  wheels.push(tailWheel);

  // livery and cargo: the side registration, and the crate strapped behind the seats
  for (const side of [-1, 1]) {
    const mark = decal('SKYSAIL', 2.4, 0.5, { fg: '#20242a' });
    mark.rotation.y = side * Math.PI / 2;
    mark.position.set(side * 0.71, 0.52, 0.6);
    group.add(mark);
  }
  const crate = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.86), new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9, flatShading: true }));
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.66, 0.09), dark);
  const strap2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.66, 0.9), dark);
  crate.add(box, strap, strap2);
  crate.position.set(0.0, 0.62, 0.55);
  crate.visible = false;
  group.add(crate);

  group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  return { group, parts: { prop, disc, rudder, elevator, wheels, panel, panelTexture, crate, yoke, stabilizer } };
}
