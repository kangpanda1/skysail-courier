// Sound, synthesized: the radial's note from throttle and RPM, a supercharger whistle an octave
// above it, wind and slip noise that rises with airspeed, the stall horn, the ring chime, the flare
// of a delivery and the thud of a hard contact. No samples and no files — every voice is an
// oscillator or a generated noise buffer, so the game stays a folder of plain static files. Audio
// starts only on a key the pilot actually pressed, which is what the browser's policy asks for.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.85;
  }

  /** Called from the first real keypress: build the graph and start it. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    this.master = master;

    // engine: two detuned saws through a lowpass, plus a noise bed for the exhaust
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 3;
    this.engineFilter = lp;
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    this.oscB.detune.value = -9;
    this.whine = ctx.createOscillator(); this.whine.type = 'triangle';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.0;
    this.whineGain = whineGain;
    this.oscA.connect(engineGain); this.oscB.connect(engineGain);
    engineGain.connect(lp); lp.connect(master);
    this.whine.connect(whineGain); whineGain.connect(master);
    this.engineGain = engineGain;

    // wind and slip: a looping noise buffer through a bandpass that tracks airspeed
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0;
    noise.connect(bp); bp.connect(windGain); windGain.connect(master);
    this.windGain = windGain;
    this.windFilter = bp;
    noise.start();
    this.oscA.start(); this.oscB.start(); this.whine.start();

    // the stall horn: a steady square wave, gated by the model
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 430;
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    horn.connect(hornGain); hornGain.connect(master);
    horn.start();
    this.hornGain = hornGain;

    this.enabled = true;
    master.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 0.6);
  }

  mute(flag) {
    if (!this.master) return;
    this.master.gain.linearRampToValueAtTime(flag ? 0.0001 : this.volume, this.ctx.currentTime + 0.2);
  }

  /** Every frame: the engine's note, the wind, and the horn. */
  update(model) {
    if (!this.enabled || !model) return;
    const t = this.ctx.currentTime;
    const rpm = clamp(model.rpm, 0, 1.2);
    const base = 46 + rpm * 150;
    this.oscA.frequency.setTargetAtTime(base, t, 0.05);
    this.oscB.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + rpm * 0.3, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(520 + rpm * 1500 + model.throttle * 400, t, 0.08);
    this.whine.frequency.setTargetAtTime(base * 6.2, t, 0.06);
    this.whineGain.gain.setTargetAtTime(0.006 + rpm * 0.03, t, 0.1);
    const speed = clamp((model.v - 20) / 60, 0, 1.4);
    this.windFilter.frequency.setTargetAtTime(320 + speed * 900, t, 0.1);
    this.windGain.gain.setTargetAtTime(0.012 + speed * 0.05 + Math.abs(model.beta || 0) * 0.08, t, 0.1);
    const warning = model.stalled || model.stallMargin < 1.0 ? 0.05 : 0;
    this.hornGain.gain.setTargetAtTime(warning, t, 0.04);
  }

  /** A one-shot: a short envelope on a voiced oscillator or a burst of the noise bed. */
  hit(kind) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const spec = {
      ring: { type: 'triangle', from: 880, to: 1320, gain: 0.16, dur: 0.28 },
      deliver: { type: 'sine', from: 520, to: 780, gain: 0.2, dur: 0.6 },
      touchdown: { type: 'sine', from: 150, to: 90, gain: 0.16, dur: 0.22 },
      crash: { type: 'sawtooth', from: 220, to: 40, gain: 0.34, dur: 0.7 },
      stall: { type: 'square', from: 430, to: 430, gain: 0.1, dur: 0.4 },
      warn: { type: 'square', from: 660, to: 660, gain: 0.07, dur: 0.16 },
      fail: { type: 'sawtooth', from: 300, to: 120, gain: 0.2, dur: 0.9 },
    }[kind];
    if (!spec) return;
    const osc = this.ctx.createOscillator();
    osc.type = spec.type;
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(spec.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + spec.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(spec.gain, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t);
    osc.stop(t + spec.dur + 0.05);
    if (kind === 'crash' || kind === 'touchdown') this.burst(kind === 'crash' ? 0.5 : 0.18, kind === 'crash' ? 260 : 160);
  }

  /** A burst of filtered noise, for a contact with the ground. */
  burst(level, cutoff) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, 0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(lp); lp.connect(gain); gain.connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
  }
}

function noiseBuffer(ctx, seconds = 1.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // a seeded walk rather than Math.random, so the hiss is the same hiss every run
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value += ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.4;
    value = clamp(value * 0.985, -1, 1);
    data[i] = value;
  }
  return buffer;
}
