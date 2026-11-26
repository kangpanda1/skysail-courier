// The sky over the fjord: a gradient dome with a sun that blooms toward the horizon, a directional
// key light and hemisphere fill matched to it, a drifting field of soft cloud banks, fog tuned to
// the weather, and rain that follows the aircraft. Two presets — the low late sun of the courier
// runs and the flat grey of the storm rescue — and everything else reads their numbers from config.
import * as THREE from '../vendor/three.module.min.js';
import { SKY, PALETTE, WORLD } from './config.js';
import { hash3 } from './rng.js';

const PRESETS = {
  clear: { ...SKY.sunWarm, top: PALETTE.skyWarmTop, low: PALETTE.skyWarmLow, sunColor: PALETTE.sunWarm, cloudColor: 0xfbeadd, cloudBase: 620, cloudSpread: 520, rain: false },
  storm: { ...SKY.sunStorm, top: PALETTE.skyStormTop, low: PALETTE.skyStormLow, sunColor: PALETTE.sunStorm, cloudColor: 0x7f8a92, cloudBase: 180, cloudSpread: 300, rain: true },
};

export class Sky {
  constructor(scene, seed = WORLD.seed) {
    this.scene = scene;
    this.seed = seed;
    this.time = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildDome();
    this.buildLights();
    this.buildClouds();
    this.buildRain();
    this.setWeather('clear');
  }

  /** Unit vector to the sun for the current preset, and the direction light travels. */
  get sunDirection() { return this._sunDir; }

  buildDome() {
    const geo = new THREE.SphereGeometry(SKY.radius, 32, 18);
    this.domeUniforms = {
      uTop: { value: new THREE.Color(PALETTE.skyWarmTop) },
      uLow: { value: new THREE.Color(PALETTE.skyWarmLow) },
      uSunColor: { value: new THREE.Color(PALETTE.sunWarm) },
      uSunDir: { value: new THREE.Vector3(0, 0.4, -1) },
      uHaze: { value: 0.34 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.domeUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop, uLow, uSunColor, uSunDir;
        uniform float uHaze;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float up = clamp(d.y, 0.0, 1.0);
          vec3 sky = mix(uLow, uTop, pow(up, 0.55));
          sky = mix(sky, uLow, smoothstep(0.06, -0.25, d.y));
          float sun = max(dot(d, normalize(uSunDir)), 0.0);
          sky += uSunColor * (pow(sun, 220.0) * 1.6 + pow(sun, 14.0) * uHaze + pow(sun, 3.2) * uHaze * 0.28);
          gl_FragColor = vec4(sky, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: PALETTE.sunWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
    }));
    glow.scale.set(2400, 2400, 1);
    this.sunGlow = glow;
    this.group.add(glow);
  }

  buildLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const c = this.sun.shadow.camera;
    c.near = 4; c.far = 260; c.left = -70; c.right = 70; c.top = 70; c.bottom = -70;
    this.sun.shadow.bias = -0.0012;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x40484f, 1);
    this.scene.add(this.sun, this.hemi);
  }

  /** Soft cloud banks: each is a cluster of billboard puffs at a fixed seeded altitude. */
  buildClouds() {
    const puff = puffTextures();
    this.clouds = [];
    const group = new THREE.Group();
    for (let i = 0; i < SKY.cloudCount; i += 1) {
      const bank = new THREE.Group();
      const bx = (hash3(i, 1, 2, this.seed) - 0.5) * WORLD.size * 1.6;
      const bz = (hash3(i, 3, 4, this.seed) - 0.5) * WORLD.size * 1.6;
      const scale = 0.7 + hash3(i, 5, 6, this.seed) * 1.9;
      bank.position.set(bx, 0, bz);
      for (let p = 0; p < SKY.cloudPuff; p += 1) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: puff[p % puff.length], transparent: true, depthWrite: false, opacity: 0.9, fog: true, color: 0xffffff,
        }));
        const a = hash3(i, p, 9, this.seed);
        const b = hash3(i, p, 11, this.seed + 3);
        sp.position.set((a - 0.5) * 420 * scale, (b - 0.5) * 70 * scale, (hash3(i, p, 13, this.seed + 7) - 0.5) * 380 * scale);
        const s = (240 + 320 * hash3(i, p, 17, this.seed + 11)) * scale;
        sp.scale.set(s, s * 0.52, 1);
        bank.add(sp);
      }
      bank.userData.drift = 3 + hash3(i, 19, 23, this.seed) * 6;
      this.clouds.push(bank);
      group.add(bank);
    }
    this.cloudGroup = group;
    this.group.add(group);
  }

  /** Rain as slanted line segments in a box that follows the aircraft, wrapped as it falls. */
  buildRain() {
    const n = SKY.rainDrops;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 6);
    for (let i = 0; i < n; i += 1) {
      const x = (hash3(i, 1, 1, this.seed + 51) - 0.5) * 320;
      const y = hash3(i, 2, 2, this.seed + 52) * 160;
      const z = (hash3(i, 3, 3, this.seed + 53) - 0.5) * 320;
      positions[i * 6] = x; positions[i * 6 + 1] = y; positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x + 1.4; positions[i * 6 + 4] = y - 7.5; positions[i * 6 + 5] = z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc6d6de, transparent: true, opacity: 0.42, fog: true }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);
  }

  setWeather(name) {
    const p = PRESETS[name] || PRESETS.clear;
    this.weather = p;
    const elev = p.elevation, az = p.azimuth;
    const dir = new THREE.Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), -Math.cos(elev) * Math.cos(az)).normalize();
    this._sunDir = dir;
    this.domeUniforms.uTop.value.setHex(p.top, THREE.SRGBColorSpace);
    this.domeUniforms.uLow.value.setHex(p.low, THREE.SRGBColorSpace);
    this.domeUniforms.uSunColor.value.setHex(p.sunColor, THREE.SRGBColorSpace);
    this.domeUniforms.uSunDir.value.copy(dir);
    this.domeUniforms.uHaze.value = name === 'storm' ? 0.5 : 0.34;
    this.sunGlow.material.color.setHex(p.sunColor, THREE.SRGBColorSpace);
    this.sunGlow.position.copy(dir).multiplyScalar(SKY.radius * 0.82);
    this.sunGlow.visible = name !== 'storm';
    this.sun.color.setHex(p.sunColor, THREE.SRGBColorSpace);
    this.sun.intensity = p.intensity;
    this.hemi.intensity = p.ambient;
    this.hemi.color.setHex(name === 'storm' ? 0x6d7a83 : 0xbfd4e6, THREE.SRGBColorSpace);
    for (const bank of this.clouds) {
      const i = this.clouds.indexOf(bank);
      bank.position.y = p.cloudBase + (hash3(i, 29, 31, this.seed) - 0.5) * p.cloudSpread;
      for (const sp of bank.children) {
        sp.material.color.setHex(p.cloudColor, THREE.SRGBColorSpace);
        sp.material.opacity = name === 'storm' ? 0.96 : 0.86;
      }
    }
    this.rain.visible = p.rain;
    this.scene.fog = new THREE.Fog(new THREE.Color(p.fogColor), p.fogNear, p.fogFar);
    this.exposure = p.exposure;
    return p;
  }

  update(dt, cameraPosition) {
    this.time += dt;
    this.group.position.copy(cameraPosition);
    const p = this.weather;
    for (const bank of this.clouds) {
      bank.position.x += bank.userData.drift * dt * 0.6;
      if (bank.position.x > WORLD.size * 0.9) bank.position.x -= WORLD.size * 1.8;
    }
    if (this.rain.visible) {
      this.rain.position.set(cameraPosition.x, 0, cameraPosition.z);
      const arr = this.rain.geometry.attributes.position.array;
      const fall = 128 * dt;
      const base = this.rain.position.y;
      const top = cameraPosition.y + 90;
      for (let i = 0; i < arr.length; i += 6) {
        arr[i + 1] -= fall; arr[i + 4] -= fall;
        if (arr[i + 1] < -70) {
          const lift = 160;
          arr[i + 1] += lift; arr[i + 4] += lift;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.y = Math.min(cameraPosition.y + 40, top);
      void base;
    }
    void p;
  }
}

/** A radial halo for the sun, drawn once. */
function haloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,246,214,0.9)');
  g.addColorStop(0.4, 'rgba(255,226,170,0.28)');
  g.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Four lumpy puff sprites so a bank does not read as four identical circles. */
function puffTextures() {
  const size = 256;
  const out = [];
  for (let k = 0; k < 4; k += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'blur(6px)';
    for (let b = 0; b < 7; b += 1) {
      const a = (b / 7) * Math.PI * 2 + k;
      const r = size * (0.12 + 0.06 * ((b + k) % 3));
      const cx = size / 2 + Math.cos(a) * size * 0.19 * (1 + 0.2 * ((b % 2) ? 1 : -1));
      const cy = size * 0.56 + Math.sin(a) * size * 0.1;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.55, 'rgba(250,250,255,0.55)');
      g.addColorStop(1, 'rgba(240,244,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'none';
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    out.push(t);
  }
  return out;
}
