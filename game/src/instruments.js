// Steam gauges, drawn: the six-pack the panel texture carries and the compact cluster the HUD keeps
// in the corner. Each gauge is a bezel, a black face, a graduated dial with the coloured arcs a real
// airframe has, and a needle that lags a little so it behaves like an instrument and not like a
// number. Nothing here touches THREE — it draws into any 2D context, which is why the same code
// lights the cockpit panel and the overlay.
import { AIRFRAME as A, ENVELOPE as E, PALETTE } from './config.js';

const TAU = Math.PI * 2;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function bezel(ctx, cx, cy, r, face = PALETTE.gaugeFace) {
  const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.5, r * 0.1, cx, cy, r * 1.12);
  g.addColorStop(0, '#b9c2c9');
  g.addColorStop(0.72, hex(PALETTE.gaugeRing));
  g.addColorStop(1, '#3a4148');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.1, 0, TAU); ctx.fill();
  ctx.fillStyle = hex(face);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
}

function glass(ctx, cx, cy, r) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.6);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.restore();
}

function tick(ctx, cx, cy, r, a, len, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
  ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  ctx.stroke();
}

function arcBand(ctx, cx, cy, r, a0, a1, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
}

function needle(ctx, cx, cy, r, angle, color = '#ff8b3d', length = 0.86, tail = 0.2) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-r * tail, -r * 0.045);
  ctx.lineTo(r * length, -r * 0.018);
  ctx.lineTo(r * length, r * 0.018);
  ctx.lineTo(-r * tail, r * 0.045);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c8ced4';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.075, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2c3136';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.03, 0, TAU); ctx.fill();
}

const label = (ctx, cx, cy, r, text, size = 0.13, color = '#e8ecef', y = 0.42) => {
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.max(6, r * size)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + r * y);
};

/** A dial angle for a value mapped over `from..to`, sweeping `sweep` radians from `start`. */
const dial = (v, from, to, start, sweep) => start + ((v - from) / (to - from)) * sweep;

export function drawAirspeed(ctx, cx, cy, r, model) {
  const start = Math.PI * 0.78, sweep = Math.PI * 1.44;
  bezel(ctx, cx, cy, r);
  const kt = model.v * 1.94384;
  const vs = model.stallSpeedKt, vn = E.vNever * 1.94384;
  arcBand(ctx, cx, cy, r * 0.86, dial(vs, 0, 140, start, sweep), dial(vs * 1.3, 0, 140, start, sweep), '#7fd18a', r * 0.1);
  arcBand(ctx, cx, cy, r * 0.86, dial(vs * 1.3, 0, 140, start, sweep), dial(vn, 0, 140, start, sweep), '#e8ecef', r * 0.07);
  arcBand(ctx, cx, cy, r * 0.86, dial(vn, 0, 140, start, sweep), dial(vn * 1.12, 0, 140, start, sweep), '#ffd24a', r * 0.07);
  tick(ctx, cx, cy, r * 0.92, dial(vn, 0, 140, start, sweep), r * 0.2, 2.5, '#ff5a4a');
  for (let k = 0; k <= 140; k += 10) {
    tick(ctx, cx, cy, r * 0.9, dial(k, 0, 140, start, sweep), k % 20 === 0 ? r * 0.19 : r * 0.1, k % 20 === 0 ? 2 : 1, '#dfe4e8');
    if (k % 20 === 0) label(ctx, cx + Math.cos(dial(k, 0, 140, start, sweep)) * r * 0.62, cy + Math.sin(dial(k, 0, 140, start, sweep)) * r * 0.62, r, String(k), 0.15, '#e8ecef', 0);
  }
  label(ctx, cx, cy, r, 'AIRSPEED', 0.115, '#cfd6db', -0.34);
  label(ctx, cx, cy, r, 'KNOTS', 0.1, '#9aa4ab', -0.2);
  needle(ctx, cx, cy, r, dial(kt, 0, 140, start, sweep) + Math.PI / 2);
  glass(ctx, cx, cy, r);
}

export function drawAltimeter(ctx, cx, cy, r, model) {
  const start = -Math.PI / 2, sweep = TAU;
  const ft = model.altitude * 3.28084;
  bezel(ctx, cx, cy, r);
  for (let k = 0; k < 10; k += 1) {
    const a = dial(k, 0, 10, start, sweep) + Math.PI / 2;
    tick(ctx, cx, cy, r * 0.9, a, r * 0.16, k % 5 === 0 ? 2.4 : 1.2, '#dfe4e8');
    label(ctx, cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66, r, String(k), 0.16, '#e8ecef', 0);
  }
  ctx.fillStyle = '#161a1e';
  ctx.fillRect(cx - r * 0.34, cy + r * 0.1, r * 0.68, r * 0.3);
  ctx.strokeStyle = '#8b949c'; ctx.lineWidth = 1;
  ctx.strokeRect(cx - r * 0.34, cy + r * 0.1, r * 0.68, r * 0.3);
  ctx.fillStyle = '#ffe9b8';
  ctx.font = `600 ${r * 0.2}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(ft)).padStart(5, ' '), cx, cy + r * 0.25);
  label(ctx, cx, cy, r, 'ALT', 0.12, '#cfd6db', -0.36);
  label(ctx, cx, cy, r, '100 FT', 0.095, '#9aa4ab', -0.24);
  needle(ctx, cx, cy, r, dial((ft % 1000) / 100, 0, 10, start, sweep) + Math.PI / 2, '#ff8b3d', 0.82);
  needle(ctx, cx, cy, r, dial((ft % 10000) / 1000, 0, 10, start, sweep) + Math.PI / 2, '#f2f5f7', 0.55, 0.12);
  glass(ctx, cx, cy, r);
}

export function drawAttitude(ctx, cx, cy, r, model) {
  bezel(ctx, cx, cy, r);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, TAU); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-model.bank);
  const pitchPx = (model.pitch * 57.3) * (r * 0.028);
  ctx.fillStyle = '#2f6ba8';
  ctx.fillRect(-r * 1.2, -r * 1.6, r * 2.4, r * 1.6 + pitchPx);
  ctx.fillStyle = '#7a5327';
  ctx.fillRect(-r * 1.2, pitchPx, r * 2.4, r * 1.6);
  ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-r, pitchPx); ctx.lineTo(r, pitchPx); ctx.stroke();
  ctx.font = `${r * 0.13}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let p = -30; p <= 30; p += 10) {
    if (p === 0) continue;
    const y = pitchPx - p * (r * 0.028);
    ctx.strokeStyle = 'rgba(255,233,184,0.85)';
    ctx.lineWidth = 1.1;
    const w = p % 20 === 0 ? r * 0.34 : r * 0.2;
    ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
    if (p % 20 === 0) { ctx.fillStyle = 'rgba(255,233,184,0.9)'; ctx.fillText(String(Math.abs(p)), -w - r * 0.11, y); ctx.fillText(String(Math.abs(p)), w + r * 0.11, y); }
  }
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#ffe9b8'; ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, 0); ctx.lineTo(-r * 0.14, 0); ctx.lineTo(-r * 0.06, r * 0.1);
  ctx.moveTo(r * 0.42, 0); ctx.lineTo(r * 0.14, 0); ctx.lineTo(r * 0.06, r * 0.1);
  ctx.stroke();
  ctx.fillStyle = '#ff8b3d';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.045, 0, TAU); ctx.fill();
  ctx.restore();
  for (const a of [-60, -30, 0, 30, 60]) {
    const ang = (-90 + a) * Math.PI / 180;
    tick(ctx, cx, cy, r * 0.95, ang, r * 0.11, a === 0 ? 2.6 : 1.4, a === 0 ? '#ffe9b8' : '#dfe4e8');
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-model.bank);
  ctx.fillStyle = '#ffe9b8';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.98); ctx.lineTo(-r * 0.07, -r * 0.84); ctx.lineTo(r * 0.07, -r * 0.84);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  label(ctx, cx, cy, r, 'ATTITUDE', 0.1, '#9aa4ab', 0.72);
  glass(ctx, cx, cy, r);
}

export function drawTurn(ctx, cx, cy, r, model) {
  bezel(ctx, cx, cy, r);
  const slip = Math.max(-1, Math.min(1, model.slip || 0));
  ctx.save();
  ctx.translate(cx, cy - r * 0.12);
  ctx.rotate(-model.bank * 0.85);
  ctx.strokeStyle = '#e8ecef'; ctx.lineWidth = r * 0.075;
  ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(r * 0.5, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.28); ctx.stroke();
  ctx.restore();
  for (const side of [-1, 1]) {
    const a = side * 0.52;
    tick(ctx, cx, cy - r * 0.12, r * 0.86, -Math.PI / 2 + a, r * 0.12, 2, '#dfe4e8');
  }
  label(ctx, cx, cy, r, 'TURN', 0.1, '#9aa4ab', -0.62);
  label(ctx, cx, cy, r, 'CO-ORD', 0.085, '#9aa4ab', 0.24);
  ctx.save();
  ctx.translate(cx, cy + r * 0.52);
  ctx.fillStyle = '#1b1f23';
  ctx.strokeStyle = '#8b949c'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, -r * 0.1); ctx.quadraticCurveTo(0, -r * 0.26, r * 0.42, -r * 0.1);
  ctx.lineTo(r * 0.42, r * 0.14); ctx.quadraticCurveTo(0, r * 0.3, -r * 0.42, r * 0.14);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const ball = slip * r * 0.26;
  ctx.fillStyle = slip > 0.6 || slip < -0.6 ? '#ff5a4a' : '#111316';
  ctx.strokeStyle = '#e8ecef'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(ball, r * 0.03, r * 0.09, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#dfe4e8';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(side * r * 0.2, -r * 0.08); ctx.lineTo(side * r * 0.2, r * 0.14); ctx.stroke();
  }
  ctx.restore();
  glass(ctx, cx, cy, r);
}

export function drawVSI(ctx, cx, cy, r, model) {
  const start = -Math.PI / 2, sweep = Math.PI * 1.7;
  bezel(ctx, cx, cy, r);
  const fpm = model.verticalSpeed * 196.85;
  const mapped = Math.max(-20, Math.min(20, fpm / 100));
  for (let k = -20; k <= 20; k += 5) {
    const a = dial(k, -20, 20, start - sweep / 2, sweep) + Math.PI / 2;
    tick(ctx, cx, cy, r * 0.9, a, r * 0.16, k % 10 === 0 ? 2.2 : 1.2, '#dfe4e8');
    if (k % 10 === 0) label(ctx, cx + Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64, r, String(Math.abs(k / 10)), 0.15, '#e8ecef', 0);
  }
  label(ctx, cx, cy, r, 'VSI', 0.11, '#9aa4ab', -0.36);
  label(ctx, cx, cy, r, '1000 FT/MIN', 0.075, '#9aa4ab', 0.44);
  needle(ctx, cx, cy, r, dial(mapped, -20, 20, start - sweep / 2, sweep) + Math.PI / 2);
  glass(ctx, cx, cy, r);
}

export function drawFuel(ctx, cx, cy, r, model) {
  const start = Math.PI * 0.75, sweep = Math.PI * 1.5;
  bezel(ctx, cx, cy, r);
  const frac = model.fuel / A.fuelCapacity;
  for (const [k, text] of [[0, 'E'], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, 'F']]) {
    const a = dial(k, 0, 1, start, sweep) + Math.PI / 2;
    tick(ctx, cx, cy, r * 0.9, a, r * 0.16, 2, '#dfe4e8');
    label(ctx, cx + Math.cos(a) * r * 0.63, cy + Math.sin(a) * r * 0.63, r, text, 0.16, k === 0 ? '#ff5a4a' : '#e8ecef', 0);
  }
  if (frac < 0.15) arcBand(ctx, cx, cy, r * 0.86, start + Math.PI / 2, dial(frac, 0, 1, start, sweep) + Math.PI / 2, '#ff5a4a', r * 0.09);
  label(ctx, cx, cy, r, 'FUEL', 0.12, '#9aa4ab', 0.5);
  needle(ctx, cx, cy, r, dial(frac, 0, 1, start, sweep) + Math.PI / 2);
  glass(ctx, cx, cy, r);
}

export function drawRpm(ctx, cx, cy, r, model) {
  const start = Math.PI * 0.72, sweep = Math.PI * 1.56;
  bezel(ctx, cx, cy, r);
  const rpm = model.rpm * 2300;
  arcBand(ctx, cx, cy, r * 0.86, dial(900, 0, 2600, start, sweep) + Math.PI / 2, dial(2100, 0, 2600, start, sweep) + Math.PI / 2, '#7fd18a', r * 0.09);
  arcBand(ctx, cx, cy, r * 0.86, dial(2100, 0, 2600, start, sweep) + Math.PI / 2, dial(2400, 0, 2600, start, sweep) + Math.PI / 2, '#ffd24a', r * 0.09);
  arcBand(ctx, cx, cy, r * 0.86, dial(2400, 0, 2600, start, sweep) + Math.PI / 2, dial(2600, 0, 2600, start, sweep) + Math.PI / 2, '#ff5a4a', r * 0.09);
  for (let k = 0; k <= 26; k += 2) {
    const a = dial(k * 100, 0, 2600, start, sweep) + Math.PI / 2;
    tick(ctx, cx, cy, r * 0.9, a, r * 0.15, 1.8, '#dfe4e8');
    label(ctx, cx + Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64, r, String(k), 0.14, '#e8ecef', 0);
  }
  label(ctx, cx, cy, r, 'RPM x100', 0.1, '#9aa4ab', 0.5);
  needle(ctx, cx, cy, r, dial(rpm, 0, 2600, start, sweep) + Math.PI / 2);
  glass(ctx, cx, cy, r);
}

const LAMPS = [
  { key: 'stall', text: 'STALL', color: () => '#ff5a4a' },
  { key: 'overspeed', text: 'OVERSPD', color: () => '#ff5a4a' },
  { key: 'fuel', text: 'LOW FUEL', color: () => '#ffb03a' },
  { key: 'damage', text: 'AIRFRAME', color: () => '#ffb03a' },
];

export function lampRow(ctx, x, y, w, h, model) {
  const on = {
    stall: model.stalled || model.stallMargin < A.stallMargin,
    overspeed: model.overspeed,
    fuel: model.fuel / A.fuelCapacity < 0.15,
    damage: model.damage > 25,
  };
  const lampW = w / LAMPS.length;
  for (let i = 0; i < LAMPS.length; i += 1) {
    const lamp = LAMPS[i];
    const lit = on[lamp.key];
    ctx.fillStyle = lit ? lamp.color() : '#20252a';
    ctx.strokeStyle = '#5b646c';
    ctx.lineWidth = 1;
    roundRect(ctx, x + i * lampW + 2, y, lampW - 4, h, 3);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = lit ? '#12161a' : '#7f8992';
    ctx.font = `600 ${Math.min(h * 0.42, 11)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lamp.text, x + i * lampW + lampW / 2, y + h / 2);
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The cockpit panel: four gauges across the top, three below, and the lamp row under them. */
export function drawPanel(ctx, width, height, model) {
  ctx.clearRect(0, 0, width, height);
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#23282d');
  g.addColorStop(1, '#141719');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  const r = height * 0.19;
  const top = height * 0.26, bottom = height * 0.7;
  drawAirspeed(ctx, width * 0.17, top, r, model);
  drawAttitude(ctx, width * 0.39, top, r, model);
  drawAltimeter(ctx, width * 0.61, top, r, model);
  drawTurn(ctx, width * 0.83, top, r, model);
  drawVSI(ctx, width * 0.2, bottom, r * 0.86, model);
  drawFuel(ctx, width * 0.42, bottom, r * 0.86, model);
  drawRpm(ctx, width * 0.64, bottom, r * 0.86, model);
  ctx.fillStyle = '#e8ecef';
  ctx.font = `600 ${height * 0.075}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SKYSAIL  SK-187', width * 0.86, bottom - r * 0.2);
  ctx.fillStyle = '#9aa4ab';
  ctx.font = `${height * 0.055}px ui-monospace, Menlo, monospace`;
  ctx.fillText(`${Math.round(model.loadFactor * 10) / 10} G`, width * 0.86, bottom + r * 0.25);
  lampRow(ctx, width * 0.06, height * 0.9, width * 0.88, height * 0.09, model);
}

/** The small cluster the HUD keeps in the corner while flying in chase view. */
export function drawCluster(ctx, x, y, width, height, model) {
  const r = height * 0.24;
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = 'rgba(14,17,20,0.82)';
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,122,0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawAttitude(ctx, x + width * 0.25, y + height * 0.3, r, model);
  drawAirspeed(ctx, x + width * 0.75, y + height * 0.3, r, model);
  drawAltimeter(ctx, x + width * 0.25, y + height * 0.74, r, model);
  drawTurn(ctx, x + width * 0.75, y + height * 0.74, r, model);
  ctx.restore();
}
