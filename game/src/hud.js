// The heads-up display, drawn over the render on its own canvas: a speed tape and an altitude tape
// that scroll as the aircraft moves, a heading ribbon, the flight-path marker projected from the
// world, the arrow and range to whatever the mission wants next, the warnings that flash when the
// wing lets go or the tank runs dry, the fuel and airframe bars, the landing grade after a contact,
// and the title and help screens. It reads the model and never changes it, so the same overlay is
// correct in a screenshot and in play.
import { AIRFRAME as A, ENVELOPE as E, HUD, PALETTE } from './config.js';
import { drawCluster, lampRow, roundRect } from './instruments.js';

const GOLD = '#ffc76a';
const DIM = 'rgba(255,199,106,0.42)';
const RED = '#ff6a5a';
const GREEN = '#8fe08a';
const INK = 'rgba(10,13,17,0.62)';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0;
    this.flash = 0;
  }

  resize(width, height, pixelRatio) {
    this.w = width; this.h = height;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  /** Everything the overlay needs this frame, gathered by main.js. */
  draw(model, view) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (view.phase === 'title') { this.title(view); return; }
    this.speedTape(model, view);
    this.altTape(model, view);
    this.headingRibbon(model, view);
    this.flightPathMarker(model, view);
    this.targetMarker(model, view);
    this.bars(model, view);
    this.banner(model, view);
    this.warnings(model, view);
    drawCluster(ctx, this.w - 210, this.h - 214, 196, 200, model);
    if (view.contact) this.gradePanel(view.contact);
    if (view.summary) this.summary(view.summary);
    if (view.help) this.help();
    if (view.paused) this.paused();
  }

  tape(ctx, x, y, height, value, unit, perTick, formatter, side) {
    const half = height / 2;
    ctx.save();
    ctx.fillStyle = INK;
    roundRect(ctx, x - 52, y - half, 104, height, 6);
    ctx.fill();
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x - 52, y - half, 104, height);
    ctx.clip();
    ctx.font = HUD.font;
    ctx.textAlign = side === 'left' ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    const span = perTick * (height / 34);
    const start = Math.floor((value - span) / perTick) * perTick;
    for (let v = start; v <= value + span; v += perTick) {
      const dy = y - ((v - value) / span) * (height / 2);
      if (dy < y - half - 4 || dy > y + half + 4) continue;
      const major = Math.round(v / perTick) % 2 === 0;
      ctx.strokeStyle = major ? GOLD : DIM;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x + (side === 'left' ? 34 : -34), dy);
      ctx.lineTo(x + (side === 'left' ? major ? 46 : 42 : major ? -46 : -42), dy);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = GOLD;
        ctx.fillText(formatter(v), x + (side === 'left' ? 28 : -28), dy);
      }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(12,16,20,0.9)';
    roundRect(ctx, x - 46, y - 15, 92, 30, 4);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.font = HUD.fontBig;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatter(value), x, y + 1);
    ctx.font = HUD.fontSmall;
    ctx.fillStyle = DIM;
    ctx.fillText(unit, x, y + 24);
  }

  speedTape(model) {
    const ctx = this.ctx;
    const kt = model.v * 1.94384;
    this.tape(ctx, 92, this.h * 0.5, HUD.tapeSpeed * 2.2, kt, 'KT', 10, (v) => String(Math.round(v)), 'left');
    // the stall and never-exceed marks against the tape
    const vs = model.stallSpeedKt, vn = E.vNever * 1.94384;
    const span = (HUD.tapeSpeed * 2.2 / 34) * 10;
    const mark = (value, color, text) => {
      const dy = this.h * 0.5 - ((value - kt) / span) * (HUD.tapeSpeed * 1.1);
      if (dy < this.h * 0.5 - HUD.tapeSpeed * 1.1 || dy > this.h * 0.5 + HUD.tapeSpeed * 1.1) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(146, dy); ctx.lineTo(162, dy); ctx.stroke();
      ctx.fillStyle = color; ctx.font = HUD.fontSmall; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 166, dy);
    };
    mark(vs, RED, 'VS');
    mark(vs * 1.3, GREEN, 'VO');
    mark(vn, RED, 'VNE');
  }

  altTape(model) {
    const ctx = this.ctx;
    const ft = model.altitude * 3.28084;
    this.tape(ctx, this.w - 92, this.h * 0.5, HUD.tapeAlt * 2.2, ft, 'FT', 100, (v) => String(Math.round(v / 10) * 10), 'right');
    const vs = model.verticalSpeed * 196.85;
    const x = this.w - 168;
    const h = 120;
    ctx.fillStyle = INK;
    roundRect(ctx, x - 16, this.h * 0.5 - h / 2, 32, h, 5);
    ctx.fill();
    ctx.strokeStyle = DIM; ctx.lineWidth = 1; ctx.stroke();
    const y = this.h * 0.5 - Math.max(-1, Math.min(1, vs / 1500)) * (h / 2 - 6);
    ctx.fillStyle = Math.abs(vs) > 900 ? RED : GOLD;
    ctx.beginPath();
    ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + (vs < 0 ? 10 : -10));
    ctx.closePath(); ctx.fill();
    ctx.font = HUD.fontSmall; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM;
    ctx.fillText('V/S', x, this.h * 0.5 + h / 2 + 12);
    ctx.fillStyle = GOLD;
    ctx.fillText(String(Math.round(vs / 10) * 10), x, this.h * 0.5 - h / 2 - 12);
  }

  headingRibbon(model) {
    const ctx = this.ctx;
    const w = 320, h = 34, x = this.w / 2 - w / 2, y = 22;
    ctx.fillStyle = INK;
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = DIM; ctx.lineWidth = 1; ctx.stroke();
    const deg = model.compassDeg;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
    ctx.font = HUD.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = Math.floor((deg - 40) / 5) * 5; d <= deg + 40; d += 5) {
      const px = this.w / 2 + (d - deg) * (w / 80);
      const wrapped = ((d % 360) + 360) % 360;
      const major = wrapped % 10 === 0;
      ctx.strokeStyle = major ? GOLD : DIM;
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(px, y + h - 6);
      ctx.lineTo(px, y + h - (major ? 15 : 10));
      ctx.stroke();
      if (wrapped % 30 === 0) {
        ctx.fillStyle = GOLD;
        const text = wrapped % 90 === 0 ? ['N', 'E', 'S', 'W'][wrapped / 90] : String(wrapped / 10).padStart(2, '0');
        ctx.fillText(text, px, y + 11);
      }
    }
    ctx.restore();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(this.w / 2, y + h - 2); ctx.lineTo(this.w / 2 - 6, y + h + 5); ctx.lineTo(this.w / 2 + 6, y + h + 5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(12,16,20,0.92)';
    roundRect(ctx, this.w / 2 - 34, y - 26, 68, 24, 4);
    ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.font = HUD.font;
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${String(Math.round(deg)).padStart(3, '0')}°`, this.w / 2, y - 13);
  }

  /** The flight-path marker: where the nose is not, but the aircraft is going. */
  flightPathMarker(model, view) {
    if (!view.project) return;
    const p = view.project(model.pos.x + (model.vel?.x ?? 0) * 12, model.pos.y + (model.vel?.y ?? 0) * 12, model.pos.z + (model.vel?.z ?? 0) * 12);
    if (!p) return;
    const ctx = this.ctx;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.moveTo(p.x - 20, p.y); ctx.lineTo(p.x - 8, p.y);
    ctx.moveTo(p.x + 8, p.y); ctx.lineTo(p.x + 20, p.y);
    ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y - 13);
    ctx.stroke();
  }

  /** The next objective: a ring marker if it is on screen, an arrow and a range if it is not. */
  targetMarker(model, view) {
    if (!view.target || !view.project) return;
    const ctx = this.ctx;
    const t = view.target;
    const p = view.project(t.x, t.y, t.z);
    const range = Math.round(Math.hypot(t.x - model.pos.x, t.z - model.pos.z));
    const dx = t.x - model.pos.x, dz = t.z - model.pos.z;
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    const delta = ((bearing - model.compassDeg + 540) % 360) - 180;
    if (p && p.inside) {
      ctx.strokeStyle = t.kind === 'ring' ? GOLD : GREEN;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.stroke();
      ctx.font = HUD.fontSmall; ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${t.label}  ${range} m`, p.x, p.y + 32);
    } else {
      const angle = Math.atan2(delta, 30);
      const cx = this.w / 2 + Math.sin(angle) * 150, cy = this.h * 0.5 - Math.cos(angle) * 90;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(0, -16); ctx.lineTo(11, 8); ctx.lineTo(0, 2); ctx.lineTo(-11, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = HUD.fontSmall; ctx.fillStyle = GOLD;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${t.label} ${range} m`, cx, cy + 14);
    }
    ctx.font = HUD.fontSmall;
    ctx.fillStyle = DIM;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`BRG ${String(Math.round(bearing)).padStart(3, '0')}°  Δ${delta >= 0 ? '+' : ''}${Math.round(delta)}°`, this.w / 2, this.h - 34);
  }

  bars(model) {
    const ctx = this.ctx;
    const x = 24, y = this.h - 96, w = 172;
    const rows = [
      { name: 'FUEL', value: model.fuel / A.fuelCapacity, text: `${model.fuel.toFixed(0)} L`, warn: model.fuel / A.fuelCapacity < 0.15 },
      { name: 'AIRFRAME', value: 1 - model.damage / 100, text: `${Math.round(100 - model.damage)}%`, warn: model.damage > 40 },
      { name: 'THR', value: model.throttle, text: `${Math.round(model.throttle * 100)}%`, warn: false },
    ];
    rows.forEach((row, i) => {
      const yy = y + i * 26;
      ctx.fillStyle = INK;
      roundRect(ctx, x, yy, w, 18, 4);
      ctx.fill();
      ctx.fillStyle = row.warn ? RED : GOLD;
      roundRect(ctx, x + 1, yy + 1, Math.max(2, (w - 2) * Math.max(0, Math.min(1, row.value))), 16, 3);
      ctx.fill();
      ctx.font = HUD.fontSmall;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(10,13,17,0.85)';
      ctx.fillText(row.name, x + 8, yy + 9);
      ctx.fillStyle = row.warn ? RED : DIM;
      ctx.textAlign = 'right';
      ctx.fillText(row.text, x + w - 6, yy + 9);
    });
    lampRow(ctx, x, y - 26, w, 20, model);
  }

  banner(model, view) {
    const ctx = this.ctx;
    const m = view.mission;
    if (!m) return;
    const x = 24, y = 22, w = 300;
    ctx.fillStyle = INK;
    roundRect(ctx, x, y, w, 74, 6);
    ctx.fill();
    ctx.strokeStyle = DIM; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText(m.label, x + 12, y + 16);
    ctx.font = HUD.font;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(m.objective, x + 12, y + 36);
    ctx.fillStyle = DIM;
    ctx.font = HUD.fontSmall;
    ctx.fillText(`LEG ${m.leg}/${m.legs}   SCORE ${m.score}   BEST ${m.best}`, x + 12, y + 54);
    const remain = m.remaining;
    ctx.fillStyle = remain < 30 ? RED : GOLD;
    ctx.font = HUD.fontBig;
    ctx.textAlign = 'right';
    ctx.fillText(formatClock(remain), x + w - 12, y + 44);
    ctx.font = HUD.fontSmall;
    ctx.fillStyle = DIM;
    ctx.fillText('TIME', x + w - 12, y + 62);
    void model;
  }

  warnings(model, view) {
    const ctx = this.ctx;
    this.flash += 0.06;
    const lines = [];
    if (model.stalled) lines.push(['STALL  —  REDUCE PITCH', RED]);
    else if (model.stallMargin < A.stallMargin) lines.push(['STALL AHEAD  —  ADD POWER', '#ffb03a']);
    if (model.overspeed) lines.push(['OVERSPEED  —  THROTTLE BACK', RED]);
    if (view.terrainWarning) lines.push(['PULL UP', RED]);
    if (model.fuel / A.fuelCapacity < 0.08) lines.push(['FUEL DRY  —  FIND A STRIP', RED]);
    if (model.damage > 55) lines.push(['AIRFRAME DAMAGED', '#ffb03a']);
    lines.forEach(([text, color], i) => {
      const blink = i === 0 || Math.sin(this.flash * 3 + i) > -0.2;
      if (!blink) return;
      ctx.font = '600 20px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(10,13,17,0.7)';
      const w = ctx.measureText(text).width + 26;
      roundRect(ctx, this.w / 2 - w / 2, 84 + i * 30, w, 24, 4);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(text, this.w / 2, 96 + i * 30);
    });
  }

  gradePanel(contact) {
    const ctx = this.ctx;
    const good = ['smooth', 'float', 'ditch'].includes(contact.grade);
    const w = 268, h = 118, x = this.w / 2 - w / 2, y = this.h * 0.62;
    ctx.fillStyle = 'rgba(10,13,17,0.86)';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = good ? GREEN : RED;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 22px ui-monospace, Menlo, monospace';
    ctx.fillStyle = good ? GREEN : RED;
    ctx.fillText(contact.grade.toUpperCase(), this.w / 2, y + 26);
    ctx.font = HUD.font;
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.fillText(`sink ${Math.round(contact.sink)} fpm   ${Math.round(contact.speed * 1.94384)} kt   bank ${Math.round(contact.bankDeg)}°`, this.w / 2, y + 54);
    ctx.fillStyle = DIM;
    ctx.font = HUD.fontSmall;
    ctx.fillText(contact.strip ? `on ${contact.strip.toUpperCase()} ${contact.misalign < 0.12 ? 'aligned' : 'off centreline'}` : 'off the strip', this.w / 2, y + 74);
    ctx.fillStyle = good ? GREEN : '#ffb03a';
    ctx.fillText(contact.damage > 0 ? `airframe −${Math.round(contact.damage)}%` : 'no damage', this.w / 2, y + 94);
  }

  summary(summary) {
    const ctx = this.ctx;
    const w = 380, h = 172, x = this.w / 2 - w / 2, y = this.h * 0.22;
    ctx.fillStyle = 'rgba(10,13,17,0.9)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 20px ui-monospace, Menlo, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText(summary.title, this.w / 2, y + 28);
    ctx.font = HUD.font;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    summary.lines.forEach((line, i) => ctx.fillText(line, this.w / 2, y + 62 + i * 20));
    ctx.font = HUD.fontSmall;
    ctx.fillStyle = DIM;
    ctx.fillText('ENTER  fly again      [  ]  change run', this.w / 2, y + h - 18);
  }

  title(view) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,11,16,0.55)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = GOLD;
    ctx.font = '600 46px ui-monospace, Menlo, monospace';
    ctx.fillText('SKYSAIL COURIER', this.w / 2, this.h * 0.28);
    ctx.font = '15px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('FJORD BUSH POST  ·  one engine, no flaps worth the name, five strips', this.w / 2, this.h * 0.28 + 40);
    const runs = view.missions.map((m, i) => `${i + 1}  ${m.label}   ${m.blurb}`);
    ctx.font = HUD.font;
    runs.forEach((line, i) => {
      const selected = i === view.selectedMission;
      ctx.fillStyle = selected ? 'rgba(255,199,106,0.16)' : 'rgba(255,255,255,0.05)';
      roundRect(ctx, this.w / 2 - 260, this.h * 0.46 + i * 38, 520, 32, 5);
      ctx.fill();
      ctx.strokeStyle = selected ? GOLD : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = selected ? GOLD : 'rgba(255,255,255,0.75)';
      ctx.fillText(line, this.w / 2, this.h * 0.46 + i * 38 + 16);
    });
    ctx.font = HUD.fontSmall;
    ctx.fillStyle = DIM;
    ctx.fillText('ENTER  start      R/F throttle      W/S elevator      A/D aileron      Q/E rudder      V flaps      C camera      P assist      /  help', this.w / 2, this.h * 0.46 + 148);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`best: ${view.bestSummary}`, this.w / 2, this.h * 0.46 + 172);
  }

  help() {
    const ctx = this.ctx;
    const w = 420, h = 268, x = this.w / 2 - w / 2, y = this.h / 2 - h / 2;
    ctx.fillStyle = 'rgba(10,13,17,0.92)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 16px ui-monospace, Menlo, monospace';
    ctx.fillStyle = GOLD;
    ctx.fillText('CONTROLS', x + 18, y + 24);
    const rows = [
      ['R / F', 'throttle up / down'],
      ['W / S  or  ↑ / ↓', 'elevator (pull / push)'],
      ['A / D  or  ← / →', 'roll left / right'],
      ['Q / E', 'rudder'],
      ['SPACE', 'wheel brakes (on the ground)'],
      ['V', 'flaps 0 · ⅓ · ⅔ · full'],
      ['T', 'trim reset'],
      ['C', 'chase · cockpit · orbit'],
      ['P', 'assist autopilot on / off'],
      ['O', 'pause'],
      ['[  ]', 'change the run'],
      ['ENTER', 'fly again / restart'],
    ];
    ctx.font = HUD.font;
    rows.forEach(([key, what], i) => {
      ctx.fillStyle = GOLD;
      ctx.fillText(key, x + 18, y + 52 + i * 17);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(what, x + 150, y + 52 + i * 17);
    });
  }

  paused() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,11,16,0.4)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.font = '600 30px ui-monospace, Menlo, monospace';
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', this.w / 2, this.h / 2);
  }
}

const formatClock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
