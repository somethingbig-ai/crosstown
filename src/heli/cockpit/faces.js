// faces.js: everything PRINTED in the cockpit, drawn once at load into one 4096 x 2048 picture: the dial faces, the needles and
// cards that move over them, the painted panel with its radio faceplates and legends, the overhead and pedestal legends, placards,
// and the chart on the kneeboard. Invented names only. Sizes are generous (a 80 mm dial is 448 px) so a close look stays sharp;
// mip-maps and anisotropy keep it clean from the seat.
import { SCALES, angleOf, AI_SPAN } from './scales.js';
import { PANEL, DIALS, UNITS, SWITCHES, CWP_CELLS, STACK_U } from './layout.js';
import { rng } from './geo.js';

const F = '"DIN Alternate","Helvetica Neue",Helvetica,Arial,sans-serif', FC = '"DIN Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
const INK = '#e9e5d8', GREEN = '#2fa34a', YEL = '#e7c41c', RED = '#d2261d', FACE = '#0c0c0d';
const D2R = Math.PI / 180;
const pol = (cx, cy, r, a) => [cx + r * Math.sin(a * D2R), cy - r * Math.cos(a * D2R)];

class Pen {
  constructor(x, S) { this.x = x; this.S = S; this.c = S / 2; }
  bg(col = FACE) { const x = this.x, S = this.S; x.fillStyle = col; x.fillRect(0, 0, S, S); const g = x.createRadialGradient(S * 0.5, S * 0.42, S * 0.05, S * 0.5, S * 0.5, S * 0.56); g.addColorStop(0, 'rgba(255,255,255,0.045)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S); return this; }
  tick(a, r0, r1, w, col = INK) { const x = this.x, c = this.c, p = pol(c, c, r0 * c, a), q = pol(c, c, r1 * c, a); x.strokeStyle = col; x.lineWidth = w * c; x.lineCap = 'butt'; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke(); return this; }
  arc(a0, a1, r, w, col) { const x = this.x, c = this.c; x.strokeStyle = col; x.lineWidth = w * c; x.lineCap = 'butt'; x.beginPath(); x.arc(c, c, r * c, (a0 - 90) * D2R, (a1 - 90) * D2R); x.stroke(); return this; }
  text(s, px, py, size, col = INK, weight = 700, font = F, align = 'center') { const x = this.x, S = this.S; x.fillStyle = col; x.font = `${weight} ${Math.round(size * S)}px ${font}`; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(s, px * S, py * S); return this; }
  at(s, a, r, size, col = INK, weight = 700, font = F) { const p = pol(0.5, 0.5, r / 2, a); return this.text(s, p[0], p[1], size, col, weight, font); }
  // the ticks of a scale table: every `minor`, longer every `mid`, longest and labelled every `major`
  scale(tb, o) {
    const v0 = o.from ?? tb[0][0], v1 = o.to ?? tb[tb.length - 1][0], n = Math.round((v1 - v0) / o.minor), R = o.r ?? 0.94;
    for (let i = 0; i <= n; i++) {
      const v = v0 + i * o.minor, a = angleOf(tb, v), isMaj = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6, isMid = o.mid && Math.abs(v / o.mid - Math.round(v / o.mid)) < 1e-6;
      this.tick(a, R - (isMaj ? 0.16 : isMid ? 0.12 : 0.075), R, isMaj ? 0.028 : isMid ? 0.02 : 0.013);
      if (isMaj && o.label !== false && (o.labelEvery === undefined || Math.abs(v / o.labelEvery - Math.round(v / o.labelEvery)) < 1e-6)) { const t = o.fmt ? o.fmt(v) : String(v); if (t !== '') this.at(t, a, R - (o.labelIn ?? 0.31), o.size ?? 0.105); }
    }
    return this;
  }
  band(tb, v0, v1, col, r = 0.955, w = 0.045) { return this.arc(angleOf(tb, v0), angleOf(tb, v1), r, w, col); }
  line(tb, v, col, r0 = 0.80, r1 = 0.99, w = 0.03) { return this.tick(angleOf(tb, v), r0, r1, w, col); }
}

// ---------------------------------------------------------------- the dial faces
const FACES = {
  asi(p) {
    const tb = SCALES.asi; p.bg().band(tb, 20, 155, GREEN).scale(tb, { from: 20, minor: 5, mid: 10, major: 20, size: 0.115 }).line(tb, 155, RED);
    p.text('AIRSPEED', 0.5, 0.36, 0.062, INK, 600).text('KNOTS', 0.5, 0.655, 0.062, INK, 600).text('0', ...pol(0.5, 0.5, 0.335, 0), 0.085, INK, 700);
  },
  alt(p) {
    p.bg(); const x = p.x, S = p.S, c = p.c;
    // the low-altitude flag (striped sector shown below 10,000 ft) at the bottom, and the pressure window at the right
    x.save(); x.beginPath(); x.moveTo(c, c); x.arc(c, c, 0.5 * c, 60 * D2R, 120 * D2R); x.closePath(); x.clip(); x.fillStyle = '#1a1a1b'; x.fillRect(0, 0, S, S); x.strokeStyle = INK; x.lineWidth = 0.022 * S; for (let i = -6; i < 12; i++) { x.beginPath(); x.moveTo(c - 0.4 * c + i * 0.075 * S, c + 0.55 * c); x.lineTo(c - 0.4 * c + i * 0.075 * S + 0.2 * S, c); x.stroke(); } x.restore();
    const tb = [[0, 0], [10, 360]];
    for (let i = 0; i < 50; i++) { const a = i * 7.2, maj = i % 5 === 0; p.tick(a, 0.94 - (maj ? 0.15 : 0.08), 0.94, maj ? 0.028 : 0.013); }
    for (let i = 0; i < 10; i++) p.at(String(i), i * 36, 0.62, 0.15);
    x.fillStyle = '#050505'; x.fillRect(0.64 * S, 0.445 * S, 0.17 * S, 0.11 * S); x.strokeStyle = '#3a3a3a'; x.lineWidth = 2; x.strokeRect(0.64 * S, 0.445 * S, 0.17 * S, 0.11 * S);
    p.text('29.9', 0.725, 0.503, 0.062, INK, 600).text('IN. HG', 0.725, 0.59, 0.036, INK, 500);
    p.text('ALT', 0.5, 0.30, 0.07, INK, 600).text('100', 0.415, 0.215, 0.05, INK, 600).text('FEET', 0.585, 0.215, 0.05, INK, 600).text('CALIBRATED TO 20,000 FT', 0.5, 0.385, 0.03, INK, 500);
  },
  vsi(p) {
    const tb = SCALES.vsi; p.bg();
    for (let v = -1000; v <= 1000; v += 100) p.tick(angleOf(tb, v), 0.94 - (v % 500 === 0 ? 0.16 : 0.08), 0.94, v % 500 === 0 ? 0.028 : 0.013);
    for (const s of [-1, 1]) for (const v of [1500, 2000, 2500, 3000]) p.tick(angleOf(tb, s * v), 0.94 - (v % 1000 === 0 ? 0.16 : 0.1), 0.94, v % 1000 === 0 ? 0.028 : 0.016);
    p.at('0', 270, 0.62, 0.15); for (const s of [-1, 1]) { p.at('.5', angleOf(tb, s * 500), 0.62, 0.105).at('1', angleOf(tb, s * 1000), 0.62, 0.14).at('2', angleOf(tb, s * 2000), 0.62, 0.14).at('3', angleOf(tb, s * 3000), 0.62, 0.14); }
    p.text('UP', 0.30, 0.375, 0.062, INK, 600).text('DN', 0.30, 0.625, 0.062, INK, 600).text('VERTICAL SPEED', 0.6, 0.43, 0.043, INK, 600).text('1000 FT PER MIN', 0.6, 0.57, 0.04, INK, 600);
  },
  tach(p) {
    const tb = SCALES.tach; p.bg();
    p.band(tb, 0, 85, RED, 0.965, 0.03).band(tb, 85, 95, YEL, 0.965, 0.03).band(tb, 95, 103, GREEN, 0.965, 0.03).band(tb, 103, 104.5, RED, 0.955, 0.05);       // rotor (outer)
    p.scale(tb, { minor: 2, mid: 10, major: 20, size: 0.105, r: 0.935, labelIn: 0.3 });
    p.band(tb, 67, 100, GREEN, 0.53, 0.03).band(tb, 100, 102, YEL, 0.53, 0.03).line(tb, 102, RED, 0.50, 0.58, 0.03);        // turbine (inner)
    p.text('ROTOR', 0.5, 0.685, 0.05, INK, 600).text('TURBINE', 0.5, 0.74, 0.05, INK, 600).text('% RPM', 0.5, 0.82, 0.058, INK, 700).text('R', 0.385, 0.865, 0.05, INK, 700).text('T', 0.615, 0.865, 0.05, INK, 700);
  },
  hsi(p) {      // the fixed ring behind the turning card
    p.bg(); for (let a = 0; a < 360; a += 45) { const x = p.x, c = p.c, q = pol(c, c, 0.975 * c, a), l = pol(c, c, 0.875 * c, a - 3.2), r = pol(c, c, 0.875 * c, a + 3.2); x.fillStyle = INK; x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(r[0], r[1]); const t = pol(c, c, 0.975 * c, a - 3.2), u = pol(c, c, 0.975 * c, a + 3.2); x.lineTo(u[0], u[1]); x.lineTo(t[0], t[1]); x.closePath(); if (a % 90) { x.beginPath(); x.moveTo(q[0], q[1]); x.lineTo(l[0], l[1]); x.lineTo(r[0], r[1]); x.closePath(); } x.fill(); }
  },
  tq(p) { const tb = SCALES.tq; p.bg().band(tb, 0, 94, GREEN).band(tb, 94, 100, YEL).scale(tb, { minor: 5, mid: 10, major: 20, size: 0.12 }).line(tb, 100, RED); p.text('TORQUE', 0.5, 0.67, 0.075, INK, 600).text('%', 0.5, 0.78, 0.085, INK, 700); },
  tot(p) { const tb = SCALES.tot; p.bg().band(tb, 3, 7.75, GREEN).band(tb, 7.75, 8.45, YEL).scale(tb, { minor: 0.5, major: 1, labelEvery: 2, size: 0.125 }).line(tb, 8.45, RED); p.text('T.O.T.', 0.5, 0.66, 0.075, INK, 600).text('°C x 100', 0.5, 0.77, 0.062, INK, 600); },
  fuel(p) { const tb = SCALES.fuel; p.bg().band(tb, 0, 10, YEL).scale(tb, { minor: 5, mid: 25, major: 50, label: false }); p.at('0', -120, 0.60, 0.13).at('½', 0, 0.60, 0.14).at('F', 120, 0.60, 0.13).at('¼', -60, 0.62, 0.1).at('¾', 60, 0.62, 0.1); p.text('FUEL', 0.5, 0.66, 0.085, INK, 600).text('QTY', 0.5, 0.775, 0.065, INK, 600); },
  oilp(p) { const tb = SCALES.oilp; p.bg().band(tb, 0, 1.3, RED).band(tb, 1.3, 3, YEL).band(tb, 3, 6, GREEN).scale(tb, { minor: 0.5, major: 1, labelEvery: 2, size: 0.125 }).line(tb, 8, RED); p.text('OIL', 0.5, 0.64, 0.075, INK, 600).text('PRESS', 0.5, 0.73, 0.062, INK, 600).text('BAR', 0.5, 0.815, 0.055, INK, 600); },
  oilt(p) { const tb = SCALES.oilt; p.bg().band(tb, 0, 115, GREEN).scale(tb, { minor: 10, major: 50, size: 0.115 }).line(tb, 115, RED); p.text('OIL', 0.5, 0.64, 0.075, INK, 600).text('TEMP', 0.5, 0.73, 0.062, INK, 600).text('°C', 0.5, 0.815, 0.06, INK, 600); },
  volt(p) { const tb = SCALES.volt; p.bg().band(tb, 26, 29, GREEN).scale(tb, { minor: 1, major: 4, size: 0.12 }).line(tb, 31.5, RED); p.text('VOLTS', 0.5, 0.67, 0.075, INK, 600).text('DC', 0.5, 0.775, 0.065, INK, 600); },
  oat(p) { const tb = SCALES.oat; p.bg().scale(tb, { minor: 5, mid: 10, major: 20, size: 0.115 }); p.text('O.A.T.', 0.5, 0.67, 0.075, INK, 600).text('°C', 0.5, 0.78, 0.07, INK, 600); },
  clock(p) { p.bg(); for (let i = 0; i < 60; i++) p.tick(i * 6, 0.94 - (i % 5 ? 0.06 : 0.15), 0.94, i % 5 ? 0.012 : 0.03); for (let i = 1; i <= 12; i++) p.at(String(i), i * 30, 0.60, i % 3 ? 0.1 : 0.14); p.text('QUARTZ', 0.5, 0.36, 0.05, INK, 500); },
};
function hsiCard(p) {      // the turning compass card, with the course arrow painted on it (course 040) and a heading bug at 075
  const x = p.x, S = p.S, c = p.c; x.clearRect(0, 0, S, S); x.fillStyle = '#0d0d0e'; x.beginPath(); x.arc(c, c, 0.985 * c, 0, 7); x.fill();
  for (let a = 0; a < 360; a += 5) p.tick(a, 0.98 - (a % 10 ? 0.07 : 0.13), 0.98, a % 10 ? 0.012 : 0.02);
  const L = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let a = 0; a < 360; a += 30) { const t = L[a] || String(a / 10), q = pol(c, c, 0.72 * c, a); x.save(); x.translate(q[0], q[1]); x.rotate(a * D2R); x.fillStyle = INK; x.font = `700 ${Math.round((L[a] ? 0.16 : 0.13) * c)}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, 0, 0); x.restore(); }
  // heading bug
  x.save(); x.translate(c, c); x.rotate(75 * D2R); x.fillStyle = '#ff7a1a'; x.fillRect(-0.075 * c, -0.985 * c, 0.15 * c, 0.07 * c); x.fillStyle = '#0d0d0e'; x.beginPath(); x.moveTo(-0.03 * c, -0.99 * c); x.lineTo(0.03 * c, -0.99 * c); x.lineTo(0, -0.93 * c); x.fill(); x.restore();
  // course arrow, deviation bar a dot to the left, dots
  x.save(); x.translate(c, c); x.rotate(40 * D2R); x.strokeStyle = YEL; x.fillStyle = YEL; x.lineWidth = 0.035 * c; x.beginPath(); x.moveTo(0, -0.60 * c); x.lineTo(0, -0.34 * c); x.moveTo(0, 0.34 * c); x.lineTo(0, 0.60 * c); x.stroke(); x.beginPath(); x.moveTo(0, -0.62 * c); x.lineTo(-0.07 * c, -0.50 * c); x.lineTo(0.07 * c, -0.50 * c); x.fill();
  x.beginPath(); x.moveTo(-0.09 * c, -0.30 * c); x.lineTo(-0.09 * c, 0.30 * c); x.stroke(); x.fillStyle = INK; for (const d of [-0.36, -0.18, 0.18, 0.36]) { x.beginPath(); x.arc(d * c, 0, 0.022 * c, 0, 7); x.fill(); } x.restore();
}
function hsiOver(p) {      // fixed over the card: the lubber line and the little aircraft
  const x = p.x, S = p.S, c = p.c; x.clearRect(0, 0, S, S); x.fillStyle = '#ff7a1a'; x.beginPath(); x.moveTo(c, 0.14 * c); x.lineTo(c - 0.06 * c, 0.01 * c); x.lineTo(c + 0.06 * c, 0.01 * c); x.fill();
  x.strokeStyle = '#ff7a1a'; x.lineWidth = 0.035 * c; x.lineCap = 'round'; x.beginPath(); x.moveTo(c, c - 0.2 * c); x.lineTo(c, c + 0.18 * c); x.moveTo(c - 0.15 * c, c - 0.03 * c); x.lineTo(c + 0.15 * c, c - 0.03 * c); x.moveTo(c - 0.06 * c, c + 0.14 * c); x.lineTo(c + 0.06 * c, c + 0.14 * c); x.stroke();
}
function aiBall(p) {       // the attitude ball unrolled: sky above, earth below, a ladder every 5 degrees. 1 degree = 0.4 / AI_SPAN of the tile.
  const x = p.x, S = p.S, k = 0.4 / AI_SPAN * S; let g = x.createLinearGradient(0, 0, 0, S / 2); g.addColorStop(0, '#1c5fae'); g.addColorStop(1, '#3f8fd6'); x.fillStyle = g; x.fillRect(0, 0, S, S / 2);
  g = x.createLinearGradient(0, S / 2, 0, S); g.addColorStop(0, '#7b4f27'); g.addColorStop(1, '#4e2f14'); x.fillStyle = g; x.fillRect(0, S / 2, S, S / 2);
  x.strokeStyle = '#f4f1e6'; x.fillStyle = '#f4f1e6'; x.lineWidth = 0.008 * S; x.beginPath(); x.moveTo(0, S / 2); x.lineTo(S, S / 2); x.stroke(); x.lineWidth = 0.0055 * S;
  for (let d = -40; d <= 40; d += 5) { if (!d) continue; const y = S / 2 - d * k, w = (d % 10 ? 0.035 : 0.075) * S; x.beginPath(); x.moveTo(S / 2 - w, y); x.lineTo(S / 2 + w, y); x.stroke(); if (d % 10 === 0) { x.font = `700 ${Math.round(0.034 * S)}px ${F}`; x.textBaseline = 'middle'; x.textAlign = 'right'; x.fillText(String(Math.abs(d)), S / 2 - w - 0.012 * S, y); x.textAlign = 'left'; x.fillText(String(Math.abs(d)), S / 2 + w + 0.012 * S, y); } }
}
export const AI_WIN = 0.70;     // the attitude window's radius as a share of the face radius
function aiOver(p) {       // fixed over the ball: the mask, the bank scale, the little aircraft, and the slip tube
  const x = p.x, S = p.S, c = p.c; x.clearRect(0, 0, S, S); x.fillStyle = FACE; x.beginPath(); x.arc(c, c, c, 0, 7); x.arc(c, c, AI_WIN * c, 0, 7, true); x.fill('evenodd');
  for (const a of [-60, -30, -20, -10, 10, 20, 30, 60]) p.tick(a, AI_WIN + 0.02, AI_WIN + (Math.abs(a) % 30 ? 0.10 : 0.17), Math.abs(a) % 30 ? 0.016 : 0.028);
  x.fillStyle = INK; x.beginPath(); let q = pol(c, c, (AI_WIN + 0.02) * c, 0); x.moveTo(q[0], q[1]); q = pol(c, c, (AI_WIN + 0.17) * c, -5); x.lineTo(q[0], q[1]); q = pol(c, c, (AI_WIN + 0.17) * c, 5); x.lineTo(q[0], q[1]); x.fill();
  // the little aircraft: two orange bars and a dot
  x.fillStyle = '#ff8a1f'; x.strokeStyle = '#1a0d00'; x.lineWidth = 0.008 * c; for (const s of [-1, 1]) { x.beginPath(); x.rect(c + s * 0.17 * c - (s < 0 ? 0.27 * c : 0), c - 0.022 * c, 0.27 * c, 0.044 * c); x.fill(); x.stroke(); x.beginPath(); x.rect(c + s * 0.17 * c - 0.022 * c, c - 0.022 * c, 0.044 * c, 0.09 * c); x.fill(); x.stroke(); } x.beginPath(); x.arc(c, c, 0.03 * c, 0, 7); x.fill(); x.stroke();
  // slip tube along the bottom of the ring: pale liquid, two index lines
  x.strokeStyle = '#d8d6c4'; x.lineWidth = 0.15 * c; x.lineCap = 'round'; x.beginPath(); x.arc(c, c, 0.855 * c, (180 - 26 - 90) * D2R, (180 + 26 - 90) * D2R); x.stroke();
  x.strokeStyle = '#f5f3e4'; x.lineWidth = 0.05 * c; x.beginPath(); x.arc(c, c, 0.885 * c, (180 - 24 - 90) * D2R, (180 + 24 - 90) * D2R); x.stroke();
  for (const a of [176.2, 183.8]) p.tick(a, 0.78, 0.93, 0.012, '#0c0c0d');
}
// needles: square tiles, the pivot at the centre, pointing up at angle 0
const NEEDLES = {
  n_long(x, S) { const c = S / 2; hand(x, c, 0.86, 0.045, 0.012, '#f2efe4'); hand(x, c, -0.30, 0.07, 0.07, '#18181a'); hub(x, c, 0.13); },
  n_small(x, S) { const c = S / 2; hand(x, c, 0.82, 0.06, 0.014, '#f2efe4'); hand(x, c, -0.28, 0.085, 0.085, '#18181a'); hub(x, c, 0.16); },
  n_alt100(x, S) { const c = S / 2; hand(x, c, 0.90, 0.04, 0.008, '#f2efe4'); hand(x, c, -0.22, 0.05, 0.05, '#18181a'); hub(x, c, 0.10); },
  n_alt1k(x, S) { const c = S / 2; x.fillStyle = '#f2efe4'; x.beginPath(); x.moveTo(c - 0.03 * c, c); x.lineTo(c - 0.075 * c, c - 0.40 * c); x.lineTo(c, c - 0.58 * c); x.lineTo(c + 0.075 * c, c - 0.40 * c); x.lineTo(c + 0.03 * c, c); x.fill(); hub(x, c, 0.085); },
  n_alt10k(x, S) { const c = S / 2; x.strokeStyle = '#f2efe4'; x.lineWidth = 0.02 * c; x.beginPath(); x.moveTo(c, c); x.lineTo(c, c - 0.80 * c); x.stroke(); x.fillStyle = '#f2efe4'; x.beginPath(); x.moveTo(c, c - 0.80 * c); x.lineTo(c - 0.065 * c, c - 0.955 * c); x.lineTo(c + 0.065 * c, c - 0.955 * c); x.fill(); },
  n_tachR(x, S) { const c = S / 2; hand(x, c, 0.88, 0.05, 0.012, '#f2efe4'); hand(x, c, -0.26, 0.07, 0.07, '#18181a'); badge(x, c, 0.50, 'R'); hub(x, c, 0.12); },
  n_tachT(x, S) { const c = S / 2; hand(x, c, 0.60, 0.06, 0.02, '#f2efe4'); badge(x, c, 0.36, 'T'); hub(x, c, 0.09); },
  n_clockH(x, S) { const c = S / 2; hand(x, c, 0.50, 0.08, 0.05, '#f2efe4'); },
  n_clockM(x, S) { const c = S / 2; hand(x, c, 0.80, 0.06, 0.03, '#f2efe4'); hub(x, c, 0.10); },
  n_clockS(x, S) { const c = S / 2; hand(x, c, 0.86, 0.02, 0.012, '#e0452c'); hand(x, c, -0.22, 0.02, 0.02, '#e0452c'); x.fillStyle = '#e0452c'; x.beginPath(); x.arc(c, c, 0.045 * c, 0, 7); x.fill(); },
  n_roll(x, S) { const c = S / 2; x.fillStyle = '#ff8a1f'; x.beginPath(); x.moveTo(c, c - 0.985 * c); x.lineTo(c - 0.085 * c, c - 0.82 * c); x.lineTo(c + 0.085 * c, c - 0.82 * c); x.fill(); },
  n_ball(x, S) { const c = S / 2, g = x.createRadialGradient(c * 0.8, c * 0.7, c * 0.05, c, c, c * 0.92); g.addColorStop(0, '#5a5a5c'); g.addColorStop(0.35, '#151516'); g.addColorStop(1, '#050505'); x.fillStyle = g; x.beginPath(); x.arc(c, c, c * 0.92, 0, 7); x.fill(); },
};
function hand(x, c, len, w0, w1, col) { x.fillStyle = col; x.beginPath(); x.moveTo(c - w0 * c / 2, c); x.lineTo(c - w1 * c / 2, c - len * c * 0.93); x.lineTo(c, c - len * c); x.lineTo(c + w1 * c / 2, c - len * c * 0.93); x.lineTo(c + w0 * c / 2, c); x.fill(); }
function hub(x, c, r) { const g = x.createRadialGradient(c - r * c * 0.3, c - r * c * 0.35, 0, c, c, r * c); g.addColorStop(0, '#4a4a4c'); g.addColorStop(0.5, '#1b1b1d'); g.addColorStop(1, '#0a0a0b'); x.fillStyle = g; x.beginPath(); x.arc(c, c, r * c, 0, 7); x.fill(); }
function badge(x, c, r, ch) { x.fillStyle = '#f2efe4'; x.beginPath(); x.arc(c, c - r * c, 0.085 * c, 0, 7); x.fill(); x.fillStyle = '#0c0c0d'; x.font = `800 ${Math.round(0.13 * c)}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, c, c - r * c + 0.008 * c); }

// ---------------------------------------------------------------- the painted panel (one picture for the whole face)
// px per metre and the mapping from panel (u, v) to the tile
export const PANEL_PX = 3900;        // the panel has a picture of its own (4056 x 1638), so its lettering stays sharp close up
function panelFace(x, W, H) {
  const R = rng(77), U = (u) => (u + PANEL.w / 2) * PANEL_PX, V = (v) => (PANEL.top - v) * PANEL_PX, K = PANEL_PX;
  // paint: a dark warm grey crackle finish, a little uneven, lighter rub marks where hands go
  x.fillStyle = '#17181a'; x.fillRect(0, 0, W, H);
  const q = K / 1968;
  for (let i = 0; i < 90000; i++) { const g = 14 + R() * 26 | 0; x.fillStyle = `rgba(${g},${g + 1},${g + 3},${0.22 + R() * 0.3})`; x.fillRect(R() * W, R() * H, 1 + R() * 3.4, 1 + R() * 3.4); }
  for (let i = 0; i < 46; i++) { const px = R() * W, py = R() * H, r = (30 + R() * 130) * q, g = x.createRadialGradient(px, py, 0, px, py, r); const d = R() < 0.5; g.addColorStop(0, d ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.035)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
  // fine scratches
  x.lineCap = 'round'; for (let i = 0; i < 420; i++) { const px = R() * W, py = R() * H, a = R() * 6.28, l = (6 + R() * 60) * q; x.strokeStyle = `rgba(190,190,185,${0.03 + R() * 0.1})`; x.lineWidth = 0.7 + R() * 1.2; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  const label = (s, u, v, mm = 2.6, col = INK, w = 600, font = F) => { x.fillStyle = col; x.font = `${w} ${Math.round(mm * 1.5 / 1000 * K)}px ${font}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, U(u), V(v)); };
  const plate = (u, v, w, h, col = '#151617', r = 0.003, edge = 'rgba(255,255,255,0.10)') => { x.fillStyle = col; rr(x, U(u - w / 2), V(v + h / 2), w * K, h * K, r * K); x.fill(); x.strokeStyle = edge; x.lineWidth = 1.5 * q; x.stroke(); };
  const screw = (u, v, mm = 2.2) => { const cx = U(u), cy = V(v), r = mm / 1000 * K; const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r); g.addColorStop(0, '#8d8f90'); g.addColorStop(0.7, '#4c4e50'); g.addColorStop(1, '#1b1c1d'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); const a = R() * 3.14; x.strokeStyle = '#0c0c0c'; x.lineWidth = r * 0.3; x.beginPath(); x.moveTo(cx - Math.cos(a) * r * 0.7, cy - Math.sin(a) * r * 0.7); x.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7); x.stroke(); x.beginPath(); x.moveTo(cx + Math.sin(a) * r * 0.7, cy - Math.cos(a) * r * 0.7); x.lineTo(cx - Math.sin(a) * r * 0.7, cy + Math.cos(a) * r * 0.7); x.stroke(); };
  // shadow rings where each instrument sits (the bezels cover most of it; what shows reads as the gap round the case)
  for (const d of DIALS) { x.fillStyle = '#0a0a0a'; x.beginPath(); x.arc(U(d.u), V(d.v), (d.r + 0.004) * K, 0, 7); x.fill(); }
  // sub-panel outlines (the panel is made of plates screwed to a frame)
  x.strokeStyle = 'rgba(0,0,0,0.75)'; x.lineWidth = 2.5 * q; for (const [u0, v0, u1, v1] of [[0.165, 0.207, 0.517, -0.03], [-0.517, 0.207, -0.172, -0.03], [-0.168, 0.207, 0.161, -0.03]]) { x.strokeRect(U(u0), V(v0), (u1 - u0) * K, (v0 - v1) * K); x.strokeStyle = 'rgba(255,255,255,0.05)'; x.strokeRect(U(u0) + 2 * q, V(v0) + 2 * q, (u1 - u0) * K, (v0 - v1) * K); x.strokeStyle = 'rgba(0,0,0,0.75)'; }
  for (const [u, v] of [[0.172, 0.200], [0.510, 0.200], [0.172, -0.023], [0.510, -0.023], [0.365, 0.203], [0.365, -0.025], [-0.510, 0.200], [-0.179, 0.200], [-0.510, -0.023], [-0.179, -0.023], [-0.34, 0.203], [-0.34, -0.025], [-0.118, -0.20], [0.108, -0.20], [-0.118, -0.108], [0.108, -0.108]]) screw(u, v);
  // legends by the dials
  label('ENGINE', -0.298, 0.200, 2.4, '#bdb9aa'); label('FLIGHT INSTRUMENTS', 0.315, 0.2035, 2.0, '#8f8c80');
  // switch row legends
  for (const s of SWITCHES) { label(s.label, s.u, s.v + 0.0182, 2.5, INK, 600, FC); label('ON', s.u, s.v + 0.0112, 1.5, '#a9a696', 500); x.fillStyle = '#0b0b0b'; x.beginPath(); x.arc(U(s.u), V(s.v), 0.0052 * K, 0, 7); x.fill(); label('OFF', s.u, s.v - 0.0125, 1.5, '#a9a696', 500); }
  // radio stack faceplates
  const u0 = STACK_U;
  { const g = UNITS.gps; plate(g.u, g.v, g.w, g.h, '#131415'); plate(g.screen.u, g.screen.v, g.screen.w + 0.006, g.screen.h + 0.006, '#050505', 0.002); label('SKYLANE 430', g.u + 0.066, g.v + 0.044, 2.2, '#c8c5b6'); label('GPS · NAV · COM', g.u + 0.066, g.v + 0.0385, 1.5, '#8f8c80', 500);
    const keys = ['CDI', 'OBS', 'MSG', 'FPL', 'PROC']; keys.forEach((s, i) => { const ku = g.screen.u - 0.046 + i * 0.023, kv = g.v - 0.0475; x.fillStyle = '#2d2f31'; rr(x, U(ku - 0.009), V(kv + 0.0032), 0.018 * K, 0.0064 * K, 2 * q); x.fill(); label(s, ku, kv, 1.6, '#deddd0'); });
    ['RNG', 'D→', 'MENU', 'CLR', 'ENT'].forEach((s, i) => { const ku = g.u + 0.046 + (i % 2) * 0.034, kv = g.v + 0.022 - Math.floor(i / 2) * 0.017; x.fillStyle = '#2d2f31'; rr(x, U(ku - 0.012), V(kv + 0.005), 0.024 * K, 0.010 * K, 3 * q); x.fill(); label(s, ku, kv, 1.9, '#deddd0'); });
    label('PUSH CRSR', g.u + 0.074, g.v - 0.047, 1.4, '#a9a696', 500); }
  { const g = UNITS.com; plate(g.u, g.v, g.w, g.h, '#131415'); plate(g.screen.u, g.screen.v, g.screen.w + 0.005, g.screen.h + 0.005, '#060403', 0.0015); label('COM 1', g.u - 0.094, g.v + 0.014, 1.8, '#c8c5b6'); label('VC-200', g.u - 0.092, g.v - 0.014, 1.5, '#8f8c80', 500); label('ACTIVE', g.screen.u - 0.03, g.v - 0.0135, 1.5, '#a9a696', 500); label('STANDBY', g.screen.u + 0.03, g.v - 0.0135, 1.5, '#a9a696', 500); label('OFF  VOL', g.u + 0.058, g.v - 0.016, 1.4, '#a9a696', 500); label('PULL 25K', g.u + 0.088, g.v - 0.016, 1.4, '#a9a696', 500); x.fillStyle = '#2d2f31'; rr(x, U(g.u + 0.0445), V(g.v + 0.018), 0.012 * K, 0.008 * K, 2 * q); x.fill(); label('↔', g.u + 0.0505, g.v + 0.0138, 2.2, '#deddd0'); }
  { const g = UNITS.xpdr; plate(g.u, g.v, g.w, g.h, '#131415'); plate(g.screen.u, g.screen.v, g.screen.w + 0.005, g.screen.h + 0.005, '#060403', 0.0015); label('XPDR', g.u - 0.092, g.v + 0.0165, 1.5, '#c8c5b6'); label('XT-70', g.u - 0.092, g.v - 0.015, 1.5, '#8f8c80', 500);
    ['IDT', 'VFR', '0', '1', '2', '3', '4', '5', '6', '7'].forEach((s, i) => { const ku = g.u + 0.028 + (i % 5) * 0.0155, kv = g.v + 0.008 - Math.floor(i / 5) * 0.015; x.fillStyle = '#2d2f31'; rr(x, U(ku - 0.006), V(kv + 0.005), 0.012 * K, 0.010 * K, 2 * q); x.fill(); label(s, ku, kv, 1.7, '#deddd0'); }); }
  { const g = UNITS.audio; plate(g.u, g.v, g.w, g.h, '#131415'); label('AUDIO', g.u - 0.092, g.v + 0.010, 1.6, '#c8c5b6'); ['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR', 'ICS', 'SPKR', 'PAX'].forEach((s, i) => { const ku = g.u - 0.064 + i * 0.0205, kv = g.v + 0.002; x.fillStyle = i === 0 || i === 5 ? '#3c5a34' : '#2d2f31'; rr(x, U(ku - 0.0082), V(kv + 0.0055), 0.0164 * K, 0.011 * K, 2 * q); x.fill(); label(s, ku, kv, 1.5, '#deddd0'); }); label('PILOT          COPILOT          VOX', g.u - 0.01, g.v - 0.0122, 1.2, '#a9a696', 500); }
  { const g = UNITS.sw; plate(g.u, g.v, g.w, g.h, '#1b1c1e', 0.003); }
  // CWP surround
  { const g = UNITS.cwp; plate(g.u, g.v, g.w + 0.008, g.h + 0.008, '#0b0b0c', 0.003); }
  // placards
  const placard = (u, v, w, h, lines, bg = '#d8d4c2', fg = '#161616', mm = 2.0) => { x.fillStyle = bg; rr(x, U(u - w / 2), V(v + h / 2), w * K, h * K, 2 * q); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = q; x.stroke(); lines.forEach((s, i) => label(s, u, v + (lines.length - 1) * mm * 0.00058 - i * mm * 0.00116, mm * 0.82, fg, 700, FC)); };
  placard(0.330, -0.0075, 0.150, 0.013, ['OPERATE IN COMPLIANCE WITH THE FLIGHT MANUAL'], '#0c0d0e', '#d9d6c8', 2.3);
  placard(0.468, -0.006, 0.074, 0.028, ['VNE 155 KT', '-3 KT / 1000 FT'], '#b3251c', '#f1eee2', 3.4);
  placard(0.200, -0.008, 0.050, 0.022, ['CTA 07', 'CROSSTOWN'], '#d8d4c2', '#161616', 3.4);
  placard(-0.468, 0.158, 0.066, 0.026, ['HOURS', '2 4 1 7 . 3'], '#0b0b0c', '#e9e5d8', 3.6);
  placard(-0.468, 0.118, 0.072, 0.014, ['ELT  ARM · ON · TEST'], '#0c0d0e', '#d9d6c8', 2.4);
  placard(-0.468, 0.070, 0.074, 0.036, ['NO SMOKING', 'FASTEN', 'SEAT BELTS'], '#d8d4c2', '#161616', 3.4);
  for (const s of SWITCHES) if (s.v < -0.1) { /* drawn above with the rest */ }
  // wear: bright nicks along plate edges and round the knobs, finger shine near the radios
  for (let i = 0; i < 900; i++) { const px = R() * W, py = R() * H; x.fillStyle = `rgba(150,150,146,${0.1 + R() * 0.3})`; x.fillRect(px, py, (0.8 + R() * 2.2) * q * 0.7, (0.8 + R() * 1.4) * q * 0.7); }
}
function rr(x, px, py, w, h, r) { x.beginPath(); x.moveTo(px + r, py); x.lineTo(px + w - r, py); x.arcTo(px + w, py, px + w, py + r, r); x.lineTo(px + w, py + h - r); x.arcTo(px + w, py + h, px + w - r, py + h, r); x.lineTo(px + r, py + h); x.arcTo(px, py + h, px, py + h - r, r); x.lineTo(px, py + r); x.arcTo(px, py, px + r, py, r); x.closePath(); }

// overhead panel legend (looked up at: the top of the picture is AFT, the right is the pilot's right). Breakers 6 across in 8 rows
// on the aft part, switches in two rows of five forward: the same grid cabin.js builds the breakers and switches on.
function overheadFace(x, W, H) {
  const R = rng(5); x.fillStyle = '#1d1e20'; x.fillRect(0, 0, W, H); for (let i = 0; i < 9000; i++) { const g = 26 + R() * 22 | 0; x.fillStyle = `rgba(${g},${g + 1},${g + 2},${0.2 + R() * 0.3})`; x.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
  const t = (s, px, py, size, col = INK, w = 600) => { x.fillStyle = col; x.font = `${w} ${size}px ${FC}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, px, py); };
  const names = ['BATT', 'GEN', 'START', 'IGN', 'FUEL P', 'FUEL Q', 'ENG IND', 'TQ IND', 'NR IND', 'HORN', 'WARN', 'HYD', 'COM 1', 'COM 2', 'GPS', 'XPDR', 'ICS', 'AUDIO', 'ALT ENC', 'HSI', 'GYRO', 'TURN', 'PITOT', 'OAT', 'NAV LT', 'A-COL', 'STROBE', 'LDG LT', 'TAXI LT', 'INST LT', 'CAB LT', 'MAP LT', 'HEAT', 'DEMIST', 'WIPER', 'FLOATS', 'CARGO', 'HOIST', 'MIRROR', 'SPARE', 'SPARE', 'UTIL 1', 'UTIL 2', 'USB', 'BUS 1', 'BUS 2', 'ESS', 'AVIONIC'];
  const amps = ['5', '10', '3', '5', '7.5', '2', '1', '25', '15'];
  x.strokeStyle = 'rgba(233,229,216,0.7)'; x.lineWidth = 2; x.strokeRect(W * 0.03, H * 0.035, W * 0.94, H * 0.615); t('CIRCUIT BREAKERS', W * 0.5, H * 0.018, 17, INK, 700);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) { const px = W * (0.115 + c * 0.154), py = H * (0.075 + r * 0.073); x.fillStyle = '#080808'; x.beginPath(); x.arc(px, py, 13, 0, 7); x.fill(); t(names[r * 6 + c], px, py + 25, 15); t(amps[(r * 5 + c * 3) % amps.length], px + 26, py - 2, 12, '#a9a696', 500); }
  const sw = ['FUEL PUMP', 'EMER LT', 'PITOT HT', 'ANTI-COL', 'POSITION', 'LDG LT', 'CABIN LT', 'INSTR LT', 'DEMIST', 'HEATING'];
  x.strokeRect(W * 0.03, H * 0.675, W * 0.94, H * 0.30); t('ELECTRICAL', W * 0.5, H * 0.662, 17, INK, 700);
  sw.forEach((s, i) => { const px = W * (0.14 + (i % 5) * 0.18), py = H * (0.74 + Math.floor(i / 5) * 0.13); x.fillStyle = '#080808'; x.beginPath(); x.arc(px, py, 12, 0, 7); x.fill(); t(s, px, py + 30, 14); t('ON', px, py - 26, 12, '#a9a696', 500); });
  for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(160,160,155,${0.1 + R() * 0.25})`; x.fillRect(R() * W, R() * H, 1 + R() * 2.5, 1 + R() * 1.5); }
}
// pedestal top legend (between the seats): fuel flow / rotor brake / shut-off quadrants forward, trims and lights aft
function pedestalFace(x, W, H) {
  const R = rng(9); x.fillStyle = '#242628'; x.fillRect(0, 0, W, H); for (let i = 0; i < 7000; i++) { const g = 30 + R() * 24 | 0; x.fillStyle = `rgba(${g},${g + 1},${g + 2},${0.2 + R() * 0.3})`; x.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
  const t = (s, px, py, size, col = INK, w = 600) => { x.fillStyle = col; x.font = `${w} ${size}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, px, py); };
  // top of the tile = forward. Three lever slots.
  const slots = [['ROTOR', 'BRAKE', RED], ['FUEL', 'FLOW', YEL], ['FUEL', 'SHUT-OFF', RED]];
  slots.forEach((s, i) => { const px = W * (0.22 + i * 0.28); x.fillStyle = '#050505'; rr(x, px - 9, H * 0.07, 18, H * 0.30, 8); x.fill(); t(s[0], px, H * 0.392, 12, INK, 600); t(s[1], px, H * 0.408, 12, INK, 600); x.fillStyle = s[2]; x.fillRect(px - 22, H * 0.42, 44, 4); t(i === 1 ? 'FLIGHT' : i === 0 ? 'OFF' : 'OPEN', px + 30, H * 0.085, 9.5, INK, 500); t(i === 1 ? 'IDLE' : i === 0 ? 'ON' : 'CLOSED', px + 31, H * 0.355, 9.5, INK, 500); });
  x.strokeStyle = 'rgba(233,229,216,0.6)'; x.lineWidth = 2; x.strokeRect(W * 0.06, H * 0.47, W * 0.88, H * 0.22); t('TRIM', W * 0.5, H * 0.49, 12, INK, 600); t('FWD', W * 0.5, H * 0.535, 9.5); t('AFT', W * 0.5, H * 0.655, 9.5); t('L', W * 0.30, H * 0.595, 9.5); t('R', W * 0.70, H * 0.595, 9.5);
  x.strokeRect(W * 0.06, H * 0.72, W * 0.88, H * 0.24); ['HYD', 'ISOL', 'SAS', 'FORCE TRIM'].forEach((s, i) => { const px = W * (0.2 + (i % 2) * 0.6), py = H * (0.79 + Math.floor(i / 2) * 0.10); x.fillStyle = '#0b0b0b'; x.beginPath(); x.arc(px, py, 12, 0, 7); x.fill(); t(s, px, py + 26, 10.5); });
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(165,165,160,${0.1 + R() * 0.3})`; x.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 1.5); }
  // boot scuffs along the sides
  for (let i = 0; i < 30; i++) { x.strokeStyle = `rgba(150,150,146,${0.05 + R() * 0.1})`; x.lineWidth = 1 + R() * 2; const px = R() < 0.5 ? R() * W * 0.1 : W - R() * W * 0.1, py = R() * H; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 20, py + 10 + R() * 60); x.stroke(); }
}
// the chart on the kneeboard: an invented helicopter route chart of a river city (drawn, not copied from any real chart)
function chartFace(x, W, H) {
  const R = rng(31); x.fillStyle = '#efe9d6'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#a9cfe6'; x.beginPath(); x.moveTo(0, 0); x.lineTo(W * 0.2, 0); x.bezierCurveTo(W * 0.26, H * 0.3, W * 0.12, H * 0.6, W * 0.22, H); x.lineTo(0, H); x.fill(); x.beginPath(); x.moveTo(W, 0); x.lineTo(W * 0.78, 0); x.bezierCurveTo(W * 0.7, H * 0.35, W * 0.86, H * 0.7, W * 0.74, H); x.lineTo(W, H); x.fill();
  x.fillStyle = '#f3e6a8'; x.beginPath(); x.moveTo(W * 0.24, H * 0.02); x.lineTo(W * 0.74, H * 0.02); x.lineTo(W * 0.80, H * 0.6); x.lineTo(W * 0.70, H * 0.98); x.lineTo(W * 0.26, H * 0.98); x.lineTo(W * 0.18, H * 0.5); x.fill();
  x.strokeStyle = 'rgba(120,110,80,0.5)'; x.lineWidth = 1; for (let i = 0; i < 26; i++) { const y = H * (0.04 + i * 0.036); x.beginPath(); x.moveTo(W * 0.22, y + 8); x.lineTo(W * 0.77, y - 8); x.stroke(); } for (let i = 0; i < 9; i++) { const px = W * (0.27 + i * 0.055); x.beginPath(); x.moveTo(px, H * 0.03); x.lineTo(px + 22, H * 0.97); x.stroke(); }
  x.fillStyle = '#b9d7a0'; x.fillRect(W * 0.40, H * 0.16, W * 0.14, H * 0.22);
  x.strokeStyle = '#2c4fa3'; x.lineWidth = 5; x.setLineDash([16, 9]); x.beginPath(); x.moveTo(W * 0.12, H * 0.02); x.bezierCurveTo(W * 0.2, H * 0.35, W * 0.08, H * 0.6, W * 0.16, H * 0.98); x.stroke(); x.beginPath(); x.moveTo(W * 0.86, H * 0.02); x.bezierCurveTo(W * 0.78, H * 0.4, W * 0.92, H * 0.7, W * 0.82, H * 0.98); x.stroke(); x.setLineDash([]);
  x.strokeStyle = '#b02a7e'; x.lineWidth = 3; for (const r of [0.20, 0.33]) { x.beginPath(); x.arc(W * 0.9, H * 0.25, W * r, 0, 7); x.stroke(); }
  const t = (s, px, py, size, col = '#1d2f66', w = 700, rot = 0) => { x.save(); x.translate(px, py); x.rotate(rot); x.fillStyle = col; x.font = `${w} ${size}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, 0, 0); x.restore(); };
  t('WEST RIVER ROUTE', W * 0.115, H * 0.42, 15, '#2c4fa3', 700, -1.5); t('EAST RIVER ROUTE', W * 0.875, H * 0.62, 15, '#2c4fa3', 700, 1.5); t('HELICOPTER ROUTE CHART', W * 0.5, H * 0.045, 22, '#111'); t('NOT FOR NAVIGATION', W * 0.5, H * 0.955, 15, '#a01818');
  for (const [px, py, s] of [[0.33, 0.72, 'H  W 30TH'], [0.66, 0.50, 'H  E 34TH'], [0.42, 0.93, 'H  DOWNTOWN'], [0.47, 0.27, 'PARK']]) { x.strokeStyle = '#111'; x.lineWidth = 2; x.beginPath(); x.arc(W * px - 46, H * py, 9, 0, 7); x.stroke(); t(s, W * px + 6, H * py, 13, '#111', 600); }
  for (const [px, py, s] of [[0.5, 0.6, '1500'], [0.3, 0.2, '2000'], [0.62, 0.8, '1100']]) t(s, W * px, H * py, 20, '#7a3d9a', 800);
  // fold lines, a coffee ring, pencil marks
  x.strokeStyle = 'rgba(80,70,50,0.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
  x.strokeStyle = 'rgba(110,70,30,0.22)'; x.lineWidth = 5; x.beginPath(); x.arc(W * 0.72, H * 0.16, 44, 0.4, 5.9); x.stroke();
  x.strokeStyle = 'rgba(40,40,40,0.55)'; x.lineWidth = 2; x.beginPath(); x.moveTo(W * 0.35, H * 0.71); x.lineTo(W * 0.52, H * 0.44); x.lineTo(W * 0.64, H * 0.5); x.stroke();
  for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(90,80,60,${R() * 0.07})`; x.fillRect(R() * W, R() * H, 2 + R() * 5, 2 + R() * 5); }
}
// small placards used around the cabin
const PLACARDS = {
  exit(x, W, H) { x.fillStyle = '#b3251c'; x.fillRect(0, 0, W, H); x.fillStyle = '#f3efe2'; x.font = `800 ${H * 0.36}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('EMERGENCY EXIT', W / 2, H * 0.3); x.font = `600 ${H * 0.2}px ${F}`; x.fillText('PULL HANDLE · PUSH DOOR OUT', W / 2, H * 0.72); },
  ext(x, W, H) { x.fillStyle = '#c9c5b4'; x.fillRect(0, 0, W, H); x.fillStyle = '#b3251c'; x.fillRect(0, 0, W, H * 0.24); x.fillStyle = '#f3efe2'; x.font = `800 ${H * 0.15}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('FIRE EXTINGUISHER', W / 2, H * 0.125); x.fillStyle = '#161616'; x.font = `600 ${H * 0.085}px ${F}`; ['HALON 1211 · 1.2 KG', '1  PULL PIN', '2  AIM AT BASE OF FIRE', '3  SQUEEZE LEVER', 'INSPECT MONTHLY'].forEach((s, i) => x.fillText(s, W / 2, H * (0.36 + i * 0.13))); },
  door(x, W, H) { x.fillStyle = '#16181a'; x.fillRect(0, 0, W, H); x.fillStyle = '#e9e5d8'; x.font = `700 ${H * 0.3}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('OPEN ◄    ► CLOSED', W / 2, H * 0.32); x.font = `500 ${H * 0.2}px ${F}`; x.fillText('DO NOT OPEN IN FLIGHT ABOVE 60 KT', W / 2, H * 0.74); },
  belt(x, W, H) { x.fillStyle = '#d8d4c2'; x.fillRect(0, 0, W, H); x.fillStyle = '#161616'; x.font = `700 ${H * 0.26}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MAX LOAD 110 KG', W / 2, H * 0.3); x.font = `500 ${H * 0.2}px ${F}`; x.fillText('TSO C22 · INSP 03/26', W / 2, H * 0.72); },
  compass(x, W, H) { x.fillStyle = '#080808'; x.fillRect(0, 0, W, H); x.fillStyle = '#e9e5d8'; x.textAlign = 'center'; x.textBaseline = 'middle'; const L = { 0: 'N', 3: '3', 6: '6', 9: 'E', 12: '12', 15: '15', 18: 'S', 21: '21', 24: '24', 27: 'W', 30: '30', 33: '33' }; for (let i = 0; i < 72; i++) { const px = (1 - (i + 0.5) / 72) * W;      /* headings grow to the LEFT, as on a real card */ x.fillRect(px - 1, H * (i % 2 ? 0.62 : 0.5), 2, H * (i % 2 ? 0.2 : 0.32)); if (i % 6 === 0) { x.font = `700 ${H * 0.34}px ${F}`; x.fillText(L[i / 2] || '', px, H * 0.26); } } },
};

// ---------------------------------------------------------------- the atlas
export function buildAtlas(mk, W = 4096, H = 2048) {
  const cv = mk(W, H), x = cv.getContext('2d'), tiles = {}; let cx = 0, cy = 0, rowH = 0; const PAD = 6;
  const alloc = (name, w, h) => { if (cx + w > W) { cx = 0; cy += rowH + PAD; rowH = 0; } if (cy + h > H) throw new Error('cockpit atlas is full at ' + name); const t = { x: cx, y: cy, w, h, u0: cx / W, u1: (cx + w) / W, v0: 1 - (cy + h) / H, v1: 1 - cy / H }; tiles[name] = t; cx += w + PAD; rowH = Math.max(rowH, h); return t; };
  const draw = (name, w, h, fn) => { const t = alloc(name, w, h); x.save(); x.beginPath(); x.rect(t.x, t.y, w, h); x.clip(); x.translate(t.x, t.y); fn(x, w, h); x.restore(); return t; };
  const BIG = 440, SM = 312, ND = 250;
  // no two makers print alike and no two dials age alike: each face gets its own ink tone (yellowed, cold, greyed), a fade, and its own scuffs
  const AGE = { asi: ['#f4e6c0', 0.05], alt: ['#ffffff', 0.0], vsi: ['#efe2bd', 0.07], tach: ['#e8f0f4', 0.02], hsi: ['#ffffff', 0.03], tq: ['#eef2f4', 0.0], tot: ['#f3e2b4', 0.08], fuel: ['#f6ecd0', 0.04], oilp: ['#e9eef2', 0.02], oilt: ['#f1e0b0', 0.09], volt: ['#ffffff', 0.05], oat: ['#f0e6c8', 0.06], clock: ['#fff6e0', 0.02] };
  const age = (id, c, S) => { const a = AGE[id]; if (!a) return; const R = rng(id.length * 131 + id.charCodeAt(0) * 7 + id.charCodeAt(1)); c.globalCompositeOperation = 'multiply'; c.fillStyle = a[0]; c.fillRect(0, 0, S, S); c.globalCompositeOperation = 'source-over'; c.fillStyle = `rgba(150,146,136,${a[1]})`; c.fillRect(0, 0, S, S);
    c.lineCap = 'round'; for (let i = 0; i < 14; i++) { const r = (0.3 + R() * 0.6) * S / 2, a0 = R() * 6.28; c.strokeStyle = `rgba(210,208,198,${0.03 + R() * 0.05})`; c.lineWidth = 0.6 + R(); c.beginPath(); c.arc(S / 2, S / 2, r, a0, a0 + 0.1 + R() * 0.5); c.stroke(); }
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(200,198,188,${R() * 0.1})`; c.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); } };
  for (const id of ['asi', 'alt', 'vsi', 'tach', 'hsi']) draw(id, BIG, BIG, (c, S) => { FACES[id](new Pen(c, S)); age(id, c, S); });
  draw('hsiCard', BIG, BIG, (c, S) => hsiCard(new Pen(c, S))); draw('hsiOver', BIG, BIG, (c, S) => hsiOver(new Pen(c, S))); draw('aiOver', BIG, BIG, (c, S) => aiOver(new Pen(c, S))); draw('aiBall', 500, 500, (c, S) => aiBall(new Pen(c, S)));
  for (const id of ['tq', 'tot', 'fuel', 'oilp', 'oilt', 'volt', 'oat', 'clock']) draw(id, SM, SM, (c, S) => { FACES[id](new Pen(c, S)); age(id, c, S); });
  // (the order packs the picture: six needles finish the second row, the tall pictures share the third, the rest go in the fourth)
  const nd = Object.keys(NEEDLES), needle = (id) => draw(id, id === 'n_ball' ? 64 : ND, id === 'n_ball' ? 64 : ND, (c, S) => { c.clearRect(0, 0, S, S); NEEDLES[id](c, S); });
  nd.slice(0, 6).forEach(needle);
  draw('pedestal', 300, 900, pedestalFace);
  draw('chart', 560, 760, chartFace);
  draw('overhead', 520, 900, overheadFace);
  nd.slice(6).forEach(needle);
  draw('exit', 560, 150, PLACARDS.exit); draw('ext', 240, 240, PLACARDS.ext); draw('door', 420, 100, PLACARDS.door); draw('belt', 260, 90, PLACARDS.belt); draw('compass', 720, 80, PLACARDS.compass);
  draw('white', 16, 16, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
  return { canvas: cv, tiles, W, H };
}
export function buildPanelPicture(mk) { const W = Math.round(PANEL.w * PANEL_PX), H = Math.round(PANEL.h * PANEL_PX), cv = mk(W, H); panelFace(cv.getContext('2d'), W, H); return cv; }

// ---------------------------------------------------------------- surface grain (one small tiling picture, four grains in four channels; raw bytes, no canvas, so the alpha channel is data)
// r: moulded-plastic stipple, g: woven fabric, b: leather / vinyl grain, a: brushed streaks. Values are heights 0..255 about 128.
export function buildGrain(N = 256) {
  const d = new Uint8Array(N * N * 4), R = rng(123);
  const noise = (cell) => { const n = Math.ceil(N / cell), g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = R(); return (px, py) => { const fx = px / cell, fy = py / cell, ix = Math.floor(fx) % n, iy = Math.floor(fy) % n, jx = (ix + 1) % n, jy = (iy + 1) % n, tx = fx - Math.floor(fx), ty = fy - Math.floor(fy), sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); return (g[iy * n + ix] * (1 - sx) + g[iy * n + jx] * sx) * (1 - sy) + (g[jy * n + ix] * (1 - sx) + g[jy * n + jx] * sx) * sy; }; };
  const n2 = noise(2), n4 = noise(4), n8 = noise(8), n32 = noise(32), n16 = noise(16);
  // leather: cells (worley-like) with creases between
  const pts = []; for (let i = 0; i < 150; i++) pts.push([R() * N, R() * N]);
  const cell = (px, py) => { let a = 1e9, b = 1e9; for (const p of pts) { let dx = Math.abs(px - p[0]), dy = Math.abs(py - p[1]); if (dx > N / 2) dx = N - dx; if (dy > N / 2) dy = N - dy; const q = dx * dx + dy * dy; if (q < a) { b = a; a = q; } else if (q < b) b = q; } return Math.sqrt(b) - Math.sqrt(a); };
  const streak = new Float32Array(N); for (let i = 0; i < N; i++) streak[i] = R();
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const o = (py * N + px) * 4;
    d[o] = 255 * Math.min(1, Math.max(0, 0.5 + (n2(px, py) - 0.5) * 0.9 + (n4(px, py) - 0.5) * 0.5));
    const wx = Math.sin(px / N * Math.PI * 2 * 32), wy = Math.sin(py / N * Math.PI * 2 * 32), over = (Math.floor(px / (N / 64)) + Math.floor(py / (N / 64))) % 2;
    d[o + 1] = 255 * Math.min(1, Math.max(0, 0.5 + (over ? wx * wx - 0.5 : wy * wy - 0.5) * 0.7 + (n2(px, py) - 0.5) * 0.35));
    d[o + 2] = 255 * Math.min(1, Math.max(0, Math.min(1, cell(px, py) / 7) * 0.75 + 0.15 + (n4(px, py) - 0.5) * 0.25));
    d[o + 3] = 255 * Math.min(1, Math.max(0, 0.5 + (streak[py] - 0.5) * 0.6 + (n32(px, py * 8) - 0.5) * 0.5 + (n16(px * 0.3, py * 4) - 0.5) * 0.3));
  }
  return { data: d, size: N };
}
// dust and fingerprints for the glass over the dials and screens (grey = how much the film of dust scatters)
export function buildDust(mk, N = 512) {
  const cv = mk(N, N), x = cv.getContext('2d'), R = rng(404); x.fillStyle = '#060606'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 5200; i++) { const a = R() * 0.5; x.fillStyle = `rgba(255,255,255,${a * a})`; x.fillRect(R() * N, R() * N, 1 + R() * 1.6, 1 + R() * 1.6); }
  for (let i = 0; i < 30; i++) { const px = R() * N, py = R() * N, r = 20 + R() * 70, g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,255,255,${0.02 + R() * 0.05})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r); }
  // fingerprints: little stacks of arcs
  for (let i = 0; i < 9; i++) { const px = R() * N, py = R() * N, rot = R() * 6.28; x.save(); x.translate(px, py); x.rotate(rot); x.scale(1, 1.35); for (let k = 2; k < 15; k++) { x.strokeStyle = `rgba(255,255,255,${0.035 + R() * 0.05})`; x.lineWidth = 1.1; x.beginPath(); x.arc(0, k * 0.6, k * 1.7, Math.PI * (1.05 + R() * 0.1), Math.PI * (1.95 - R() * 0.1)); x.stroke(); } x.restore(); }
  // wipe streaks
  for (let i = 0; i < 14; i++) { const py = R() * N; x.strokeStyle = `rgba(255,255,255,${0.012 + R() * 0.02})`; x.lineWidth = 3 + R() * 12; x.beginPath(); x.moveTo(-10, py); x.bezierCurveTo(N * 0.3, py + (R() - 0.5) * 60, N * 0.7, py + (R() - 0.5) * 60, N + 10, py + (R() - 0.5) * 80); x.stroke(); }
  return cv;
}
