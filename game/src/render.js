// The stage: the renderer, the scene graph and the per-frame choreography that puts the world, the
// sky, the aircraft and the camera together. It owns the cockpit panel canvas too, and hands the
// instruments their chance to redraw every few frames, so the gauges lit in the cockpit view are the
// same gauges the HUD draws in the corner — the same code, the same numbers.
import * as THREE from '../vendor/three.module.min.js';
import { WORLD } from './config.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { buildAircraft } from './aircraft.js';
import { CameraRig } from './camera.js';
import { drawPanel } from './instruments.js';

export const PANEL_W = 512;
export const PANEL_H = 224;

export class Stage {
  constructor(canvas, seed = WORLD.seed) {
    this.canvas = canvas;
    // ?shot= asks for the drawing buffer to be kept: a screenshot capturer may composite at any
    // moment, and a buffer that is cleared after each frame gives it an empty page to write.
    const holding = /[?&]shot=/.test(globalThis.location?.search ?? '');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: holding });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.6, WORLD.farPlane);
    this.rig = new CameraRig(this.camera);
    this.world = new World(seed);
    this.scene.add(this.world.group);
    this.sky = new Sky(this.scene, seed);
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = PANEL_W;
    this.panelCanvas.height = PANEL_H;
    this.panelCtx = this.panelCanvas.getContext('2d');
    this.aircraft = buildAircraft(this.panelCanvas);
    this.scene.add(this.aircraft.group);
    this.props = new THREE.Group();
    this.scene.add(this.props);
    this.frameIndex = 0;
    this.resize();
    globalThis.addEventListener?.('resize', () => this.resize());
  }

  resize(width, height) {
    const w = width ?? Math.max(1, globalThis.innerWidth ?? 1280);
    const h = height ?? Math.max(1, globalThis.innerHeight ?? 720);
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setWeather(name) {
    const preset = this.sky.setWeather(name);
    this.renderer.toneMappingExposure = preset.exposure;
    return preset;
  }

  /** Screen position of a world point, for the HUD's markers: null when it is behind the eye. */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      inside: v.x >= -0.94 && v.x <= 0.94 && v.y >= -0.94 && v.y <= 0.94,
    };
  }

  /** Put the airframe where the model says, and move the surfaces the pilot commanded. */
  poseAircraft(model, cmd) {
    const g = this.aircraft.group;
    g.position.set(model.pos.x, model.pos.y, model.pos.z);
    this.rig.attitudeQuat(model.attitude, g.quaternion);
    const parts = this.aircraft.parts;
    parts.prop.rotation.z = -model.propAngle;
    const blur = Math.min(0.5, Math.max(0, model.rpm - 0.25) * 0.62);
    parts.disc.material.opacity = model.onGround && model.v < 3 ? 0 : blur;
    parts.disc.rotation.z = model.propAngle * 0.2;
    parts.rudder.rotation.y = (cmd?.rudder ?? 0) * 0.42;
    parts.elevator.rotation.x = -(cmd?.elevator ?? 0) * 0.34;
    for (const wheel of parts.wheels) wheel.rotation.x = -model.wheelSpin;
    parts.crate.visible = !!model.cargo;
    parts.yoke.rotation.z = -(cmd?.aileron ?? 0) * 0.5;
    parts.yoke.rotation.x = 0.25 + (cmd?.elevator ?? 0) * 0.2;
  }

  /** The sun's shadow box follows the aircraft, or the shadow map would cover the whole fjord. */
  followSun(model) {
    const dir = this.sky.sunDirection;
    this.sky.sun.target.position.set(model.pos.x, model.pos.y, model.pos.z);
    this.sky.sun.position.set(model.pos.x + dir.x * 120, model.pos.y + dir.y * 120, model.pos.z + dir.z * 120);
    this.sky.sunTarget.updateMatrixWorld();
  }

  frame(dt, model, cmd, { drawPanelNow = false } = {}) {
    this.frameIndex += 1;
    this.world.update(dt, model.pos);
    this.poseAircraft(model, cmd);
    this.followSun(model);
    this.sky.update(dt, this.camera.position);
    if (drawPanelNow || this.frameIndex % 3 === 0) {
      drawPanel(this.panelCtx, PANEL_W, PANEL_H, model);
      this.aircraft.parts.panelTexture.needsUpdate = true;
    }
    this.rig.update(dt, model, this.world);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
