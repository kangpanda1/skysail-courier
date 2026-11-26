// The camera: three rigs the pilot cycles through — a chase view that trails the aircraft on a
// spring and never fights the stick, a cockpit view welded to the airframe so the panel and the
// runway line up, and a slow orbit for the title screen. All of them keep the horizon readable by
// blending the aircraft's roll into the world's up vector, lift themselves clear of the terrain so a
// low pass does not put the camera in a hillside, and shake only when the airframe does.
import * as THREE from '../vendor/three.module.min.js';
import { CAMERA, ENVELOPE as E } from './config.js';

const MODES = ['chase', 'cockpit', 'orbit'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.position = new THREE.Vector3(0, 300, 60);
    this.target = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.eye = new THREE.Vector3();
    this.shake = new THREE.Vector3();
    this.fov = CAMERA.chase.fov;
    this.orbitAngle = 0.6;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.tmp = new THREE.Vector3();
  }

  get modeName() { return this.mode; }

  next() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    if (this.mode === 'orbit') this.orbitAngle = Math.atan2(this.position.x, this.position.z);
    return this.mode;
  }

  /** The aircraft's attitude as a quaternion: yaw about world up, then pitch, then bank. */
  attitudeQuat(attitude, out = this.quat) {
    this.euler.set(attitude.pitch, -attitude.heading, attitude.bank, 'YXZ');
    return out.setFromEuler(this.euler);
  }

  update(dt, model, world) {
    const q = this.attitudeQuat(model.attitude);
    const pos = this.tmp.set(model.pos.x, model.pos.y, model.pos.z);
    const speedFactor = Math.min(1, Math.max(0, (model.v - 24) / (E.vNever - 24)));
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.16;
      const r = CAMERA.orbit.distance, h = CAMERA.orbit.height;
      const want = new THREE.Vector3(pos.x + Math.sin(this.orbitAngle) * r, pos.y + h, pos.z - Math.cos(this.orbitAngle) * r);
      this.follow(want, dt, 3.5);
      this.target.lerp(pos, Math.min(1, dt * 6));
      this.blendUp(0.35);
      this.fov += (CAMERA.orbit.fov - this.fov) * Math.min(1, dt * 3);
    } else if (this.mode === 'cockpit') {
      const off = CAMERA.cockpit.offset;
      const eye = new THREE.Vector3(off[0], off[1], off[2]).applyQuaternion(q).add(pos);
      this.position.copy(eye);
      this.quat.copy(q);
      this.blendUp(1, true);
      this.fov += (CAMERA.chase.fov + 8 + speedFactor * 10 - this.fov) * Math.min(1, dt * 4);
      this.applyShake(dt, model, 0.5);
      this.camera.position.copy(this.position);
      this.camera.quaternion.copy(this.quat);
      this.camera.up.set(0, 1, 0).applyQuaternion(this.quat);
      this.camera.fov = this.fov;
      return;
    } else {
      const behind = new THREE.Vector3(0, CAMERA.chase.height, CAMERA.chase.distance).applyQuaternion(q).add(pos);
      this.follow(behind, dt, CAMERA.chase.lag);
      const lead = new THREE.Vector3(model.vel ? model.vel.x : 0, model.vel ? model.vel.y : 0, model.vel ? model.vel.z : 0)
        .multiplyScalar(0.55).add(pos);
      lead.y += 1.2;
      this.target.lerp(lead, Math.min(1, dt * 5.5));
      this.blendUp(0.55);
      this.fov += (CAMERA.chase.fov + speedFactor * CAMERA.chase.fovBySpeed - this.fov) * Math.min(1, dt * 3);
      this.applyShake(dt, model, 1);
      this.quat.copy(this.lookQuat());
    }
    this.clearance(world);
    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(this.quat);
    this.camera.up.copy(this.up);
    this.camera.fov = this.fov;
  }

  follow(want, dt, rate) {
    const t = Math.min(1, dt * rate);
    this.position.lerp(want, t);
  }

  /** Keep the horizon level-ish: mostly world up, part aircraft roll, so a turn never spins the view. */
  blendUp(amount, locked = false) {
    const aircraftUp = this.tmp.set(0, 1, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).lerp(aircraftUp, locked ? 1 : amount).normalize();
  }

  lookQuat() {
    const m = new THREE.Matrix4().lookAt(this.position, this.target, this.up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  /** Refuse to put the eye inside a hill: lift the chase camera over the surface it is looking from. */
  clearance(world) {
    if (!world || this.mode === 'cockpit') return;
    const surface = world.surfaceAt(this.position.x, this.position.z);
    const floor = surface + CAMERA.terrainClearance;
    if (this.position.y < floor) this.position.y = floor;
  }

  applyShake(dt, model, scale) {
    const want = (model.buffet || 0) * 0.34 + Math.min(0.5, model.damage / 220) + (model.wrecked ? 0.8 : 0);
    this.shakeAmount = want * scale;
    const t = model.time * 34;
    this.shake.set(Math.sin(t * 1.7) * 0.5, Math.sin(t * 2.3) * 0.5, Math.cos(t * 1.1) * 0.5)
      .multiplyScalar(this.shakeAmount * 0.6);
    this.position.add(this.shake);
    void dt;
  }
}
