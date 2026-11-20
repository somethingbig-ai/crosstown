// bus/stops.js (bus lane, stops+sound helper, Nov 15): what stands on the street for the buses. makeStops(game, stops) and makeLanes(game, runs)
// as CONTRACT.md has them; loaded by bus.js (?busstops=0, ?buslanes=0 leave them out).
//   THE POLE at every stop: a tall green post with a round blue "lollipop" disc (our own bus pictogram) over a blue panel: the routes that stop
//     here as bullets in their colours, the stop's name, which way the buses go. Our own design: no transit agency's marks or name anywhere;
//     Select routes carry our "+SELECT" tag.
//   THE SHELTER where the stop wants one and there is room (sidewalk deep enough, no wall, tree, lamp, hydrant or signal in the way): steel posts,
//     glass back and roof, a bench, an end panel with an invented advert (lit at night), the stop's name on the roof edge, a light strip under the roof.
//   TICKET MACHINES, a pair by the kerb, at Select stops (our own design; "pay before you board").
//   Solid to the player and to cars as the game's street furniture is (game.statics.addCircle(x, y, r, 'furniture')); S.footprints lists every
//     circle we stand on, for anyone who places things after us.
//   Drawing: FOUR instanced meshes (poles, shelters, shelter glass, machines), one material for the three opaque ones. Only the stops round the
//     camera are in them: update() does nothing at all until the camera has moved 6 m, then refills the instance lists (a few dozen matrices).
//     The words on a sign are drawn into a small sheet (12 signs) only for the stops within 45 m; further off a sign shows a plain face.
//   THE RED LANE (makeLanes): the kerb-side lane of the Select lines' blocks, one static mesh just above the road (drawn under the road's own
//     white lines and letters, which stay on top), worn where the wheels run, "BUS ONLY" once a block where the road does not letter it already.
// Switches: ?busshelter=0 no shelters   ?bustvm=0 no ticket machines   ?bussolid=0 nothing solid.   Test hooks: S.stats, S.footprints, L.stats.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const SW = 0.15, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const C = (hex) => new THREE.Color(hex);
const ROUTE_COLS = ['#0a7f8c', '#7a3fa0', '#c2571a', '#2b7a3d', '#b0306a', '#3b5fc0', '#8a6d1f', '#4d5b6e', '#a03a2c', '#1f6f9c'];
const routeCol = (r) => { let h = 7; for (let i = 0; i < r.length; i++) if (r[i] !== '+') h = (h * 31 + r.charCodeAt(i)) >>> 0; return ROUTE_COLS[h % ROUTE_COLS.length]; };
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// ---------------------------------------------------------------------------------------------- geometry
class GB {
  constructor(alpha) { this.p = []; this.n = []; this.c = []; this.uv = []; this.k = []; this.alpha = !!alpha; }
  // a, b, c, d: bottom-left, bottom-right, top-right, top-left as seen from the lit side. uv: null (plain colour) or [u0, v0, u1, v1]
  quad(a, b, c, d, col, uv, mode = 0, emit = 0, al = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const t = uv || WHITE, P = [a, b, c, a, c, d], T = t.length === 8 ? [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]], [t[0], t[1]], [t[4], t[5]], [t[6], t[7]]] : [[t[0], t[1]], [t[2], t[1]], [t[2], t[3]], [t[0], t[1]], [t[2], t[3]], [t[0], t[3]]];      // 8 numbers: a uv for each corner (a turned strip)
    for (let i = 0; i < 6; i++) { this.p.push(P[i][0], P[i][1], P[i][2]); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); if (this.alpha) this.c.push(al); this.uv.push(T[i][0], T[i][1]); this.k.push(mode, emit); }
  }
  box(cx, cy, cz, sx, sy, sz, col, emit = 0, skip = '') {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, q = (a, b, c, d) => this.quad(a, b, c, d, col, null, 0, emit);
    if (!skip.includes('z+')) q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); if (!skip.includes('z-')) q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    if (!skip.includes('x+')) q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); if (!skip.includes('x-')) q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!skip.includes('y+')) q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); if (!skip.includes('y-')) q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }
  cyl(x, z, y0, y1, r0, r1, sides, col) {
    for (let i = 0; i < sides; i++) { const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([x + c1 * r0, y0, z + s1 * r0], [x + c0 * r0, y0, z + s0 * r0], [x + c0 * r1, y1, z + s0 * r1], [x + c1 * r1, y1, z + s1 * r1], col, null); }
  }
  build() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, this.alpha ? 4 : 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 2)); g.tris = this.p.length / 9; return g;
  }
}
// ---------------------------------------------------------------------------------------------- the sheets (canvas)
const AW = 1024, AH = 1024, WHITE = [2 / AW, 1 - 6 / AH, 6 / AW, 1 - 2 / AH];
const rect = (x, y, w, h) => [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH];
const R_DISC = [0, 16, 256, 256], R_PANEL = [256, 16, 256, 384], R_NAME = [512, 16, 256, 48], R_MAP = [512, 80, 128, 192], R_TVM = [640, 80, 128, 256], R_TVMS = [768, 80, 64, 256], R_AD = [0, 416, 192, 288], R_RULE = [832, 80, 128, 192];
const CW = 256, CH = 432, NCOL = 4, NROW = 3, NW = CW * NCOL, NH = CH * NROW;
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function fit(c, txt, x, y, maxW, px, weight = 700) { let s = px; do { c.font = weight + ' ' + s + 'px ' + FONT; s -= 1; } while (c.measureText(txt).width > maxW && s > 7); c.fillText(txt, x, y); }
function busIcon(c, cx, cy, s, body, cut) {      // our pictogram: a bus seen from the front
  c.fillStyle = body; rr(c, cx - 0.56 * s, cy - 0.7 * s, 1.12 * s, 1.26 * s, 0.16 * s); c.fill(); c.fillRect(cx - 0.44 * s, cy + 0.5 * s, 0.2 * s, 0.22 * s); c.fillRect(cx + 0.24 * s, cy + 0.5 * s, 0.2 * s, 0.22 * s);
  c.fillRect(cx - 0.7 * s, cy - 0.34 * s, 0.1 * s, 0.3 * s); c.fillRect(cx + 0.6 * s, cy - 0.34 * s, 0.1 * s, 0.3 * s);
  c.fillStyle = cut; rr(c, cx - 0.44 * s, cy - 0.4 * s, 0.88 * s, 0.5 * s, 0.05 * s); c.fill(); rr(c, cx - 0.3 * s, cy - 0.6 * s, 0.6 * s, 0.11 * s, 0.04 * s); c.fill();
  c.beginPath(); c.arc(cx - 0.33 * s, cy + 0.3 * s, 0.085 * s, 0, 7); c.arc(cx + 0.33 * s, cy + 0.3 * s, 0.085 * s, 0, 7); c.fill();
}
function selectTag(c, x, y, h) {      // our "+SELECT" tag: red plus on blue, slanted end
  const w = h * 3.5; c.fillStyle = '#12306b'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w - h * 0.35, y + h); c.lineTo(x, y + h); c.closePath(); c.fill();
  c.fillStyle = '#e03a2f'; c.fillRect(x, y, h, h); c.fillStyle = '#fff'; c.fillRect(x + h * 0.42, y + h * 0.18, h * 0.16, h * 0.64); c.fillRect(x + h * 0.18, y + h * 0.42, h * 0.64, h * 0.16);
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = 'italic 800 ' + Math.round(h * 0.66) + 'px ' + FONT; c.fillText('SELECT', x + h * 1.16, y + h * 0.54); return w;
}
function drawPanel(c, x, y, st) {      // 256 x 384: one stop's sign (st null: the plain face seen from afar)
  c.save(); c.translate(x, y); c.fillStyle = '#17437f'; c.fillRect(0, 0, 256, 384); c.strokeStyle = '#e9eef5'; c.lineWidth = 5; rr(c, 7, 7, 242, 370, 14); c.stroke();
  const routes = st ? st.routes.slice(0, 6) : ['', '', ''], n = routes.length, cols = n > 4 ? 3 : n > 1 ? 2 : 1, bw = cols === 3 ? 72 : cols === 2 ? 106 : 150, bh = n > 4 ? 46 : 56, gap = 8, rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) { const r = routes[i], col = i % cols, row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), x0 = 128 - (inRow * bw + (inRow - 1) * gap) / 2 + col * (bw + gap), y0 = 22 + row * (bh + gap), sel = r.endsWith('+');
    c.fillStyle = st ? routeCol(r) : '#5d7da8'; rr(c, x0, y0, bw, bh, 9); c.fill(); if (!st) continue;
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; fit(c, r.replace('+', ''), x0 + bw / 2, y0 + (sel ? bh * 0.36 : bh * 0.54), bw - 10, sel ? bh * 0.5 : bh * 0.62, 800);
    if (sel) { const th = bh * 0.3; selectTag(c, x0 + (bw - th * 3.5) / 2, y0 + bh * 0.64, th); } }
  const yN = 22 + rows * (bh + gap) + 6; c.fillStyle = '#e9eef5'; c.fillRect(22, yN, 212, 3);
  if (st) { const parts = String(st.name).split(/\s*\/\s*/); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; const avail = 384 - yN - 96, lh = Math.min(50, avail / Math.max(1, parts.length));
    parts.slice(0, 3).forEach((p, i) => fit(c, p, 128, yN + 14 + lh * (i + 0.5), 216, lh * 0.74, 700));
    c.fillStyle = '#ffd24a'; rr(c, 22, 302, 212, 34, 6); c.fill(); c.fillStyle = '#10233f'; fit(c, st.dirText, 128, 320, 200, 21, 800);
    c.fillStyle = '#cfdcf0'; fit(c, 'CITY TRANSIT  ·  stop ' + String(1000 + st.i * 7).slice(-4), 128, 356, 210, 13, 600);
  } else { c.fillStyle = '#c9d6ea'; c.fillRect(48, yN + 30, 160, 16); c.fillRect(70, yN + 62, 116, 16); c.fillStyle = '#ffd24a'; rr(c, 22, 302, 212, 34, 6); c.fill(); }
  c.restore();
}
function drawName(c, x, y, st) {      // 256 x 48: the roof edge
  c.save(); c.translate(x, y); c.fillStyle = '#1a4a8c'; c.fillRect(0, 0, 256, 48); busIcon(c, 22, 25, 15, '#fff', '#1a4a8c');
  if (st) { c.fillStyle = '#f2f4f6'; c.textAlign = 'left'; c.textBaseline = 'middle'; fit(c, st.name.replace(/\s*\/\s*/, ' & '), 50, 25, 198, 27, 700); } else { c.fillStyle = '#c3d0e4'; c.fillRect(56, 18, 150, 12); }
  c.restore();
}
const ADS = [
  (c) => { const g = c.createLinearGradient(0, 0, 0, 288); g.addColorStop(0, '#ff7a1a'); g.addColorStop(1, '#e3242b'); c.fillStyle = g; c.fillRect(0, 0, 192, 288); c.fillStyle = '#ffe9a8'; for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(20 + (i * 53) % 160, 250 - (i * 37) % 200, 3 + (i % 4) * 2, 0, 7); c.fill(); }
    c.fillStyle = '#18b7a5'; rr(c, 66, 96, 60, 130, 10); c.fill(); c.fillStyle = '#eafffb'; c.fillRect(66, 132, 60, 44); c.fillStyle = '#0c6e63'; c.font = '800 15px ' + FONT; c.textAlign = 'center'; c.fillText('FIZZ', 96, 152); c.fillText('POP', 96, 168); c.fillStyle = '#cfd6d8'; c.fillRect(74, 86, 44, 12);
    c.fillStyle = '#fff'; c.font = 'italic 900 34px ' + FONT; c.fillText('FIZZPOP', 96, 50); c.font = '700 14px ' + FONT; c.fillText('zero sugar. all noise.', 96, 262); },
  (c) => { c.fillStyle = '#14182b'; c.fillRect(0, 0, 192, 288); c.fillStyle = '#f6e7b0'; c.beginPath(); c.arc(140, 64, 30, 0, 7); c.fill(); c.fillStyle = '#14182b'; c.beginPath(); c.arc(128, 56, 27, 0, 7); c.fill();
    c.fillStyle = '#f3efe6'; rr(c, 58, 136, 70, 62, 8); c.fill(); c.strokeStyle = '#f3efe6'; c.lineWidth = 7; c.beginPath(); c.arc(134, 164, 16, -1.2, 1.2); c.stroke(); c.fillStyle = '#6a4124'; c.fillRect(64, 142, 58, 10);
    c.fillStyle = '#f6e7b0'; c.textAlign = 'center'; c.font = '800 27px Georgia, serif'; c.fillText('NIGHT OWL', 96, 232); c.font = '600 13px ' + FONT; c.fillStyle = '#c9c2ad'; c.fillText('coffee · open till the last bus', 96, 258); },
  (c) => { const g = c.createLinearGradient(0, 0, 192, 288); g.addColorStop(0, '#2a1a6e'); g.addColorStop(1, '#0fa3d6'); c.fillStyle = g; c.fillRect(0, 0, 192, 288); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(96, 130, 28 + i * 18, 12 + i * 8, -0.5, 0, 7); c.stroke(); }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(96, 130, 13, 0, 7); c.fill(); c.textAlign = 'center'; c.font = '900 32px ' + FONT; c.fillText('ORBITEL', 96, 52); c.font = '700 14px ' + FONT; c.fillText('more bars than Midtown', 96, 240); c.font = '600 11px ' + FONT; c.fillText('unlimited everything* · *almost', 96, 262); },
  (c) => { c.fillStyle = '#f1ead9'; c.fillRect(0, 0, 192, 288); c.fillStyle = '#1c1c1c'; c.textAlign = 'center'; c.font = '900 23px Georgia, serif'; c.fillText('The Daily Borough', 96, 44); c.fillRect(16, 56, 160, 3); c.fillRect(16, 62, 160, 1);
    c.fillStyle = '#8a8272'; for (let r = 0; r < 9; r++) { c.fillRect(16, 150 + r * 9, 74, 4); c.fillRect(102, 150 + r * 9, 74, 4); } c.fillStyle = '#b9433a'; c.fillRect(16, 76, 160, 60); c.fillStyle = '#fff'; c.font = '800 17px ' + FONT; c.fillText('PIGEON ELECTED', 96, 102); c.fillText('TO COMMUNITY BOARD', 96, 124);
    c.fillStyle = '#1c1c1c'; c.font = 'italic 700 14px Georgia, serif'; c.fillText('news you can fold', 96, 262); },
];
function makeStatic() {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const c = cv.getContext('2d'); c.clearRect(0, 0, AW, AH); c.fillStyle = '#fff'; c.fillRect(0, 0, 8, 8);
  // the disc: blue, white ring, our bus
  { const [x, y, w] = R_DISC, cx = x + w / 2, cy = y + w / 2; c.fillStyle = '#17437f'; c.beginPath(); c.arc(cx, cy, 124, 0, 7); c.fill(); c.strokeStyle = '#f2f5f9'; c.lineWidth = 12; c.beginPath(); c.arc(cx, cy, 108, 0, 7); c.stroke(); busIcon(c, cx, cy - 4, 62, '#f2f5f9', '#17437f'); }
  drawPanel(c, R_PANEL[0], R_PANEL[1], null); drawName(c, R_NAME[0], R_NAME[1], null);
  { const [x, y] = R_MAP; c.fillStyle = '#eef0ea'; c.fillRect(x, y, 128, 192); c.fillStyle = '#17437f'; c.fillRect(x, y, 128, 22); c.fillStyle = '#fff'; c.font = '700 11px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BUS MAP · CITY TRANSIT', x + 64, y + 12);
    c.strokeStyle = '#c9cdc2'; c.lineWidth = 1; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(x + 10 + i * 14, y + 30); c.lineTo(x + 2 + i * 14, y + 184); c.stroke(); c.beginPath(); c.moveTo(x + 4, y + 36 + i * 17); c.lineTo(x + 124, y + 30 + i * 17); c.stroke(); }
    ROUTE_COLS.slice(0, 6).forEach((col, i) => { c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); if (i % 2) { c.moveTo(x + 6, y + 50 + i * 22); c.lineTo(x + 122, y + 44 + i * 22); } else { c.moveTo(x + 24 + i * 16, y + 30); c.lineTo(x + 14 + i * 16, y + 186); } c.stroke(); }); c.fillStyle = '#d23'; c.beginPath(); c.arc(x + 58, y + 110, 5, 0, 7); c.fill(); }
  { const [x, y] = R_TVM; c.fillStyle = '#a4abb0'; c.fillRect(x, y, 128, 256); c.fillStyle = '#7d848a'; c.fillRect(x + 6, y + 46, 116, 2); c.fillRect(x + 6, y + 216, 116, 2); c.fillStyle = '#17437f'; c.fillRect(x, y, 128, 40); c.fillStyle = '#fff'; selectTag(c, x + 14, y + 8, 24); c.fillStyle = '#0d1420'; rr(c, x + 16, y + 52, 96, 66, 5); c.fill(); c.fillStyle = '#7fd1ff'; c.fillRect(x + 22, y + 58, 84, 54);
    c.fillStyle = '#0d2540'; c.font = '700 10px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PAY BEFORE', x + 64, y + 74); c.fillText('YOU BOARD', x + 64, y + 86); c.font = '600 8px ' + FONT; c.fillText('press to start', x + 64, y + 101);
    c.fillStyle = '#f3c63a'; c.beginPath(); c.arc(x + 34, y + 142, 11, 0, 7); c.fill(); c.fillStyle = '#9aa3ad'; rr(c, x + 58, y + 132, 52, 8, 2); c.fill(); rr(c, x + 58, y + 148, 52, 6, 2); c.fill(); c.fillStyle = '#11161d'; rr(c, x + 20, y + 176, 88, 30, 4); c.fill(); c.fillStyle = '#2a3038'; c.font = '700 8px ' + FONT; c.fillText('TICKET', x + 64, y + 169);
    c.fillStyle = '#3a4149'; c.font = '700 8px ' + FONT; c.fillText('CITY TRANSIT', x + 64, y + 236); }
  { const [x, y] = R_TVMS; c.fillStyle = '#a4abb0'; c.fillRect(x, y, 64, 256); c.fillStyle = '#17437f'; c.fillRect(x, y, 64, 40); c.fillStyle = '#6d747a'; for (let i = 0; i < 6; i++) c.fillRect(x + 12, y + 190 + i * 8, 40, 3); }
  { const [x, y] = R_RULE; c.fillStyle = '#f4f4ef'; c.fillRect(x, y, 128, 192); c.fillStyle = '#17437f'; c.fillRect(x, y, 128, 26); c.fillStyle = '#fff'; c.font = '700 11px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NEXT BUSES', x + 64, y + 14);
    c.fillStyle = '#6b7280'; for (let i = 0; i < 12; i++) { c.fillRect(x + 12, y + 40 + i * 12, 30, 4); c.fillRect(x + 50, y + 40 + i * 12, 44 + (i * 13) % 22, 4); } }
  ADS.forEach((f, i) => { c.save(); c.translate(R_AD[0] + i * R_AD[2], R_AD[1]); c.beginPath(); c.rect(0, 0, 192, 288); c.clip(); c.textBaseline = 'middle'; try { f(c); } catch (e) {} c.restore(); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
function dirText(game, h) {      // which way the buses go, by the island's own grid
  const gd = ((game.city && game.city.meta && game.city.meta.grid_deg) || 28.9) * Math.PI / 180, ux = Math.sin(gd), uy = Math.cos(gd), d = Math.cos(h) * ux + Math.sin(h) * uy, e = Math.cos(h) * uy - Math.sin(h) * ux;
  return d > 0.7 ? 'UPTOWN' : d < -0.7 ? 'DOWNTOWN' : e > 0 ? 'CROSSTOWN · EAST' : 'CROSSTOWN · WEST';
}
// ---------------------------------------------------------------------------------------------- the material
function patch(m, shared, U, bake) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U); if (bake) Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aK; attribute vec4 aCell; uniform vec2 uCellSize; uniform vec4 uGenP; uniform vec4 uGenN; uniform vec4 uAd; varying vec2 vUvN; varying vec2 vUvG; varying vec3 vKf; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 bP = vec4(transformed, 1.0); vec3 bN = normal;
        #ifdef USE_INSTANCING
          bP = instanceMatrix * bP; bN = mat3(instanceMatrix) * bN;
        #endif
        bP = modelMatrix * bP; vWPos = bP.xyz; vWN = normalize(mat3(modelMatrix) * bN);
        vKf = vec3(aK.x, aK.y, aK.x > 3.5 ? 0.0 : aCell.z);
        vec2 loc = aK.x < 2.5 ? vec2(uv.x, (48.0 + uv.y * 384.0) / 432.0) : vec2(uv.x, uv.y * 48.0 / 432.0);
        vUvN = aCell.xy + loc * uCellSize;
        vUvG = aK.x > 3.5 ? vec2(uAd.x + (aCell.w + uv.x) * uAd.z, uAd.y + uv.y * uAd.w) : (aK.x < 2.5 ? uGenP.xy + uv * uGenP.zw : uGenN.xy + uv * uGenN.zw); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tNear; uniform float uBusNight; varying vec2 vUvN; varying vec2 vUvG; varying vec3 vKf; varying vec3 vWPos; varying vec3 vWN;
      ${bake ? 'uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;' : ''}`)
      .replace('#include <map_fragment>', `{ vec4 bTex = vKf.x > 1.5 ? (vKf.z > 0.5 ? texture2D(tNear, vUvN) : texture2D(map, vUvG)) : texture2D(map, vMapUv); diffuseColor *= bTex; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * vKf.y * uBusNight * 1.5;`)
      .replace('#include <aomap_fragment>', bake ? `bakeN = normalize(vWN); bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeV.r *= 0.5 + 0.5 * bakeN.y;` + BAKE_LIGHT_GLSL : '#include <aomap_fragment>');
  };
  m.customProgramCacheKey = () => 'busstop3' + (bake ? 'b' : '');
  return m;
}
// ---------------------------------------------------------------------------------------------- the models. Local frame: +X along the traffic
// passing the stop, +Y up, +Z away from the roadway (the building side); the origin on the sidewalk.
function buildPole() {
  const b = new GB(), green = C('#1f4634'), dk = C('#12325f'), wh = C('#ffffff'), steel = C('#8d949a');
  b.cyl(0, 0, 0, 0.1, 0.07, 0.05, 8, green); b.cyl(0, 0, 0.1, 3.62, 0.042, 0.042, 8, green); b.quad([-0.032, 3.62, 0.032], [0.032, 3.62, 0.032], [0.032, 3.62, -0.032], [-0.032, 3.62, -0.032], green, null);
  // the panel (0.5 x 0.75) and the disc (0.62) over it, across the sidewalk so both ways along the street read them; they hang on the sidewalk side of the post, clear of the buses' mirrors
  const zc = 0.3, y0 = 2.16, y1 = 2.91, hw = 0.25, t = 0.014, yd = 3.25, rd = 0.31;
  b.box(0, (y0 + y1) / 2, zc, t * 2 - 0.004, y1 - y0, hw * 2, dk);
  b.quad([t, y0, zc + hw], [t, y0, zc - hw], [t, y1, zc - hw], [t, y1, zc + hw], wh, [0, 0, 1, 1], 2); b.quad([-t, y0, zc - hw], [-t, y0, zc + hw], [-t, y1, zc + hw], [-t, y1, zc - hw], wh, [0, 0, 1, 1], 2);
  const d = rect(...R_DISC); b.quad([t, yd - rd, zc + rd], [t, yd - rd, zc - rd], [t, yd + rd, zc - rd], [t, yd + rd, zc + rd], wh, d, 1); b.quad([-t, yd - rd, zc - rd], [-t, yd - rd, zc + rd], [-t, yd + rd, zc + rd], [-t, yd + rd, zc - rd], wh, d, 1);
  for (const y of [2.3, 2.78, 3.25]) b.box(0, y, 0.05, 0.05, 0.035, 0.11, steel);      // the clamps
  return b.build();
}
const SH = { len: 4.4, zb: 0.62, zf: -0.78, h: 2.42 };
function buildShelter() {
  const b = new GB(), gl = new GB(true), steel = C('#a9afb3'), dark = C('#3a4046'), wood = C('#2b2f33'), wh = C('#ffffff'), lamp = C('#fff3d6'), tint = C('#9db5ad'), frost = C('#e3ebe8');
  const L = SH.len / 2, zb = SH.zb, zf = SH.zf, H = SH.h, px = [-L + 0.05, -0.74, 0.74, L - 0.09];
  for (const x of px) { b.box(x, H / 2, zb, 0.12, H, 0.12, steel); b.box(x, 0.012, zb, 0.2, 0.024, 0.2, dark); }
  b.box(L - 0.09, H / 2, zf + 0.3, 0.09, H, 0.09, steel); b.box(L - 0.09, 0.012, zf + 0.3, 0.2, 0.024, 0.2, dark);
  b.box(-0.04, 2.22, zb, SH.len - 0.1, 0.06, 0.06, steel); b.box(-0.04, 0.14, zb, SH.len - 0.1, 0.05, 0.05, steel);
  // roof: a steel frame, frosted glass in it, a light strip under the back rail, the name on the roadway edge
  const ry = H + 0.05, rz0 = zf, rz1 = zb + 0.14, rzc = (rz0 + rz1) / 2, rd = rz1 - rz0;
  b.box(0, ry, rz0, SH.len + 0.1, 0.1, 0.07, steel); b.box(0, ry, rz1, SH.len + 0.1, 0.1, 0.07, steel); for (const x of [-L - 0.02, -1.48, -0.74, 0, 0.74, 1.48, L + 0.02]) b.box(x, ry, rzc, 0.05, 0.1, rd, steel);
  b.box(-0.04, H - 0.035, zb - 0.12, SH.len - 0.5, 0.03, 0.09, lamp, 0.8);
  { const sx = -L + 0.05, z0 = zb - 0.62, z1 = zb - 0.3, y0 = 0.34, y1 = 2.19, e = 0.032, DOWN = [1, 0, 1, 1, 0, 1, 0, 0];      // the stop's name on an upright blue strip at the upstream end, read from the top down, a face each way
    b.box(sx, (y0 + y1) / 2, (z0 + z1) / 2, e * 2 - 0.006, y1 - y0 + 0.04, z1 - z0 + 0.04, steel);
    b.quad([sx + e, y0, z1], [sx + e, y0, z0], [sx + e, y1, z0], [sx + e, y1, z1], wh, DOWN, 3, 0.12); b.quad([sx - e, y0, z0], [sx - e, y0, z1], [sx - e, y1, z1], [sx - e, y1, z0], wh, DOWN, 3, 0.12); }
  gl.quad([-L, ry + 0.02, rz1], [L, ry + 0.02, rz1], [L, ry + 0.02, rz0], [-L, ry + 0.02, rz0], frost, null, 0, 0, 0.8);
  // the glass back, three bays, and a short end screen upstream
  for (let i = 0; i < 3; i++) gl.quad([px[i] + 0.05, 0.17, zb], [px[i + 1] - 0.05, 0.17, zb], [px[i + 1] - 0.05, 2.19, zb], [px[i] + 0.05, 2.19, zb], tint, null, 0, 0, 0.34);
  gl.quad([-L + 0.05, 0.17, zb - 0.05], [-L + 0.05, 0.17, zb - 0.6], [-L + 0.05, 2.19, zb - 0.6], [-L + 0.05, 2.19, zb - 0.05], tint, null, 0, 0, 0.34); b.box(-L + 0.05, 2.22, zb - 0.32, 0.05, 0.05, 0.6, steel); b.box(-L + 0.05, 1.2, zb - 0.62, 0.05, 2.1, 0.05, steel);
  // a map and a timetable card on the glass
  const mp = rect(...R_MAP), ru = rect(...R_RULE); b.quad([0.95, 1.05, zb - 0.012], [-0.05 + 0.4, 1.05, zb - 0.012], [0.35, 1.87, zb - 0.012], [0.95, 1.87, zb - 0.012], wh, mp, 1, 0.08);
  b.quad([-0.9, 1.25, zb - 0.012], [-1.36, 1.25, zb - 0.012], [-1.36, 1.87, zb - 0.012], [-0.9, 1.87, zb - 0.012], wh, ru, 1, 0.08);
  // the bench: perforated steel seat on two legs, armrests between places
  b.box(-0.6, 0.47, zb - 0.3, 2.3, 0.045, 0.36, wood); b.box(-0.6, 0.62, zb - 0.1, 2.3, 0.22, 0.03, wood); for (const x of [-1.55, 0.35]) b.box(x, 0.23, zb - 0.3, 0.06, 0.46, 0.3, dark); for (const x of [-1.75, -0.98, -0.22, 0.55]) b.box(x, 0.58, zb - 0.3, 0.035, 0.16, 0.34, dark);
  // the advert panel at the downstream end, across the sidewalk: a lit box, a poster each side
  const ax = L - 0.09, az0 = zf + 0.36, az1 = zb - 0.06, ay0 = 0.32, ay1 = 2.2, at = 0.085;
  b.box(ax, (ay0 + ay1) / 2, (az0 + az1) / 2, at * 2 - 0.01, ay1 - ay0, az1 - az0, steel); b.box(ax, ay0 / 2, (az0 + az1) / 2, 0.07, ay0, 0.5, dark);
  const m = 0.07; b.quad([ax - at, ay0 + m, az0 + m], [ax - at, ay0 + m, az1 - m], [ax - at, ay1 - m, az1 - m], [ax - at, ay1 - m, az0 + m], wh, [0, 0, 1, 1], 4, 0.2);
  b.quad([ax + at, ay0 + m, az1 - m], [ax + at, ay0 + m, az0 + m], [ax + at, ay1 - m, az0 + m], [ax + at, ay1 - m, az1 - m], wh, [0, 0, 1, 1], 4, 0.2);
  return { solid: b.build(), glass: gl.build() };
}
function buildMachines() {      // a pair, 0.95 m apart along the kerb, fronts to the sidewalk (+Z)
  const b = new GB(), body = C('#9aa1a6'), cap = C('#17437f'), wh = C('#ffffff'), f = rect(...R_TVM), s = rect(...R_TVMS);
  for (const x of [-0.475, 0.475]) { const w = 0.56, d = 0.44, h = 1.62;
    b.box(x, 0.03, 0, w + 0.06, 0.06, d + 0.06, C('#22272e')); b.box(x, h / 2 + 0.06, 0, w, h, d, body, 0, 'z+');
    b.quad([x - w / 2, 0.06, d / 2], [x + w / 2, 0.06, d / 2], [x + w / 2, 0.06 + h, d / 2], [x - w / 2, 0.06 + h, d / 2], wh, f, 1, 0.03);
    b.quad([x - w / 2 - 0.001, 0.06, -d / 2], [x - w / 2 - 0.001, 0.06, d / 2], [x - w / 2 - 0.001, 0.06 + h, d / 2], [x - w / 2 - 0.001, 0.06 + h, -d / 2], wh, s, 1); b.quad([x + w / 2 + 0.001, 0.06, d / 2], [x + w / 2 + 0.001, 0.06, -d / 2], [x + w / 2 + 0.001, 0.06 + h, -d / 2], [x + w / 2 + 0.001, 0.06 + h, d / 2], wh, s, 1);
    b.box(x, h + 0.1, 0.03, w + 0.05, 0.08, d + 0.1, cap); b.box(x, h + 0.2, -0.05, 0.3, 0.12, 0.2, cap, 0); b.box(x, h + 0.2, 0.052, 0.24, 0.08, 0.004, C('#bfe8ff'), 0.5); }
  return b.build();
}
// ---------------------------------------------------------------------------------------------- makeStops
export async function makeStops(game, stops) {
  const g = game, world = g.world, shared = world.shared || {}, statics = g.statics, P = g.P, opt = (k, d) => (P && P.get && P.get(k) !== null && P.get(k) !== undefined ? P.get(k) : d);
  const SOLID = opt('bussolid', '1') !== '0', WANT_SH = opt('busshelter', '1') !== '0', WANT_TVM = opt('bustvm', '1') !== '0';
  const S = { stats: { stops: 0, skipped: 0, moved: 0, stairsKnown: 0, shelters: 0, noRoom: 0, machines: 0, circles: 0, rebuilds: 0, signDraws: 0, ms: 0 }, footprints: [], list: [] };
  const t0 = performance.now();
  // what already stands on the sidewalks (the city's own lists): trees, lamps, hydrants, signals, bins, meters, news boxes
  const PR = { tree: 0.85, light: 0.4, hydrant: 0.45, signal: 0.5, bin: 0.4, meter: 0.25, newsbox: 0.45 }, pg = new Map(), pk = (i, j) => i * 100003 + j;
  const padd = (x, y, r) => { const k = pk(Math.floor(x / 8), Math.floor(y / 8)); let a = pg.get(k); if (!a) pg.set(k, (a = [])); a.push(x, y, r); };
  try { const props = (g.city && g.city.props) || {}; for (const kind in PR) for (const p of props[kind] || []) padd(p[0], p[1], PR[kind]); } catch (e) {}
  try { for (const e of (g.subway && g.subway.data && g.subway.data.entrances) || []) if (e && !e.off && Number.isFinite(e.x) && Number.isFinite(e.y)) { padd(e.x, e.y, 2.6); S.stats.stairsKnown++; } } catch (e) {}      // subway stairs, when the subway is there before us
  // a pole asked for inside a tree pit or on a hydrant or lamp is drawn a step along the kerb (the stop itself, where the bus halts, stays)
  const poleFree = (x, y) => { const i0 = Math.floor((x - 3) / 8), i1 = Math.floor((x + 3) / 8), j0 = Math.floor((y - 3) / 8), j1 = Math.floor((y + 3) / 8); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const q = pg.get(pk(i, j)); if (!q) continue; for (let k = 0; k < q.length; k += 3) if (Math.hypot(q[k] - x, q[k + 1] - y) < q[k + 2] * 0.75 + 0.14) return false; } return true; };
  // is the box (centre cx, cy; half-length a along t; half-depth d across) clear of them
  const boxFree = (cx, cy, tx, ty, a, d) => { const i0 = Math.floor((cx - a - 2) / 8), i1 = Math.floor((cx + a + 2) / 8), j0 = Math.floor((cy - a - 2) / 8), j1 = Math.floor((cy + a + 2) / 8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const q = pg.get(pk(i, j)); if (!q) continue; for (let k = 0; k < q.length; k += 3) { const dx = q[k] - cx, dy = q[k + 1] - cy, al = Math.abs(dx * tx + dy * ty), ac = Math.abs(dx * ty - dy * tx); if (al < a + q[k + 2] && ac < d + q[k + 2]) return false; } } return true; };
  const onSw = (x, y) => !statics || !statics.onSidewalk || statics.onSidewalk(x, y), noWall = (ax, ay, bx, by) => !statics || !statics.raycast || statics.raycast(ax, ay, bx, by) >= 1;
  const solid = (x, y, r) => { S.footprints.push({ x, y, r }); if (SOLID && statics && statics.addCircle) { statics.addCircle(x, y, r, 'furniture'); S.stats.circles++; } };
  for (const s of stops) {
    if (!s || !s.kerb || !Number.isFinite(s.x) || !Number.isFinite(s.y)) { S.stats.skipped++; continue; }
    const h = s.h, tx = Math.cos(h), ty = Math.sin(h), nx = Math.sin(h), ny = -Math.cos(h);      // t: the way the traffic goes; n: from the kerb into the sidewalk
    let px = s.x, py = s.y; if (!poleFree(px, py)) for (const a of [0.9, -0.9, 1.6, -1.6]) { const qx = s.x + tx * a, qy = s.y + ty * a; if (poleFree(qx, qy) && onSw(qx, qy)) { px = qx; py = qy; S.stats.moved++; break; } }
    const it = { s, x: px, y: py, h, sh: null, tvm: null, cell: -1, dirText: dirText(g, h), ad: (s.i * 7 + 3) % ADS.length }; S.list.push(it); S.stats.stops++;
    padd(px, py, 0.3); solid(px, py, 0.07);
  }
  // shelters (upstream of the pole, beside where the bus stands) and machines (downstream of it), each only where there is room
  for (const it of S.list) {
    const s = it.s, h = it.h, tx = Math.cos(h), ty = Math.sin(h), nx = Math.sin(h), ny = -Math.cos(h), kx = s.x - nx * 0.55, ky = s.y - ny * 0.55;      // the kerb line beside the pole
    if (s.shelter && WANT_SH) { let ok = false;
      for (const a of [-3.3, -5.6, -8.0]) { const cx = kx + tx * a + nx * 1.45, cy = ky + ty * a + ny * 1.45; let fine = boxFree(cx, cy, tx, ty, SH.len / 2 + 0.25, 0.95);
        for (const al of [-2.3, 0, 2.3]) { if (!fine) break; const ex = kx + tx * (a + al), ey = ky + ty * (a + al); fine = onSw(ex + nx * 0.6, ey + ny * 0.6) && onSw(ex + nx * 2.2, ey + ny * 2.2) && onSw(ex + nx * 3.7, ey + ny * 3.7) && noWall(ex + nx * 0.4, ey + ny * 0.4, ex + nx * 3.9, ey + ny * 3.9); }
        if (!fine) continue; it.sh = { x: cx, y: cy }; ok = true; padd(cx, cy, 1.2); padd(cx + tx * 1.6, cy + ty * 1.6, 1.2); padd(cx - tx * 1.6, cy - ty * 1.6, 1.2);
        for (const w of [-2.1, -1.05, 0, 1.05, 2.1]) solid(cx + tx * w + nx * SH.zb, cy + ty * w + ny * SH.zb, 0.3); solid(cx + tx * 2.1 + nx * 0.05, cy + ty * 2.1 + ny * 0.05, 0.3); break; }
      if (ok) S.stats.shelters++; else S.stats.noRoom++; }
    if (s.sel && WANT_TVM) for (const a of [2.6, 4.2, 6.0]) { const cx = kx + tx * a + nx * 0.62, cy = ky + ty * a + ny * 0.62; if (!boxFree(cx, cy, tx, ty, 0.95, 0.4) || !onSw(cx + tx * 0.8, cy + ty * 0.8) || !onSw(cx - tx * 0.8, cy - ty * 0.8) || !onSw(cx + nx * 1.6, cy + ny * 1.6)) continue;
      it.tvm = { x: cx, y: cy }; padd(cx, cy, 1.0); solid(cx + tx * 0.475, cy + ty * 0.475, 0.33); solid(cx - tx * 0.475, cy - ty * 0.475, 0.33); S.stats.machines++; break; }
  }
  // ---- drawing
  const tStatic = makeStatic(), ncv = document.createElement('canvas'); ncv.width = NW; ncv.height = NH; const nctx = ncv.getContext('2d'); nctx.fillStyle = '#17437f'; nctx.fillRect(0, 0, NW, NH);
  const tNear = new THREE.CanvasTexture(ncv); tNear.colorSpace = THREE.SRGBColorSpace; tNear.anisotropy = 8; tNear.generateMipmaps = true; tNear.minFilter = THREE.LinearMipmapLinearFilter;
  const gp = rect(...R_PANEL), gn = rect(...R_NAME), ad = rect(...R_AD);
  const U = { tNear: { value: tNear }, uBusNight: { value: 0 }, uCellSize: { value: new THREE.Vector2(CW / NW, CH / NH) }, uGenP: { value: new THREE.Vector4(gp[0], gp[1], gp[2] - gp[0], gp[3] - gp[1]) }, uGenN: { value: new THREE.Vector4(gn[0], gn[1], gn[2] - gn[0], gn[3] - gn[1]) }, uAd: { value: new THREE.Vector4(ad[0], ad[1], ad[2] - ad[0], ad[3] - ad[1]) } };
  const bake = !!(shared.tLight && shared.tLight.value && shared.uHalf);
  const mat = patch(new THREE.MeshStandardMaterial({ map: tStatic, vertexColors: true, roughness: 0.55, metalness: 0.0, alphaTest: 0.5 }), shared, U, bake);
  const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const group = new THREE.Group(); group.name = 'bus_stops'; const shelter = buildShelter();
  const CAPS = { pole: 96, sh: 48, tvm: 24 };
  const mk = (geo, material, cap, shadow) => { const m = new THREE.InstancedMesh(geo, material, cap); m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = true; m.matrixAutoUpdate = false;
    m.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); return m; };
  const mPole = mk(buildPole(), mat, CAPS.pole, true), mSh = mk(shelter.solid, mat, CAPS.sh, true), mGl = mk(shelter.glass, glassMat, CAPS.sh, false), mTvm = mk(buildMachines(), mat, CAPS.tvm, true); mGl.renderOrder = 4;
  world.scene.add(group); S.group = group; S.tris = { pole: mPole.geometry.tris, shelter: mSh.geometry.tris, glass: mGl.geometry.tris, machines: mTvm.geometry.tris };
  // a grid of the stops
  const GC = 128, grid = new Map(); for (const it of S.list) { const k = pk(Math.floor(it.x / GC), Math.floor(it.y / GC)); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(it); }
  const cells = new Array(NCOL * NROW).fill(null), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), YAX = new THREE.Vector3(0, 1, 0), near = [];
  const FAR = { pole: 230, sh: 260, tvm: 170, text: 45 }; let lx = 1e9, ly = 1e9;
  const put = (m, i, x, y, h, cell) => { Q.setFromAxisAngle(YAX, h); V.set(x, SW, -y); M.compose(V, Q, ONE); m.setMatrixAt(i, M); const a = m.geometry.attributes.aCell.array; a[i * 4] = cell.u; a[i * 4 + 1] = cell.v; a[i * 4 + 2] = cell.on; a[i * 4 + 3] = cell.ad; };
  const cu = { u: 0, v: 0, on: 0, ad: 0 };
  function rebuild(cx, cy) {
    S.stats.rebuilds++; near.length = 0; const R = FAR.sh, i0 = Math.floor((cx - R) / GC), i1 = Math.floor((cx + R) / GC), j0 = Math.floor((cy - R) / GC), j1 = Math.floor((cy + R) / GC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = grid.get(pk(i, j)); if (a) for (const it of a) { it.d = Math.hypot(it.x - cx, it.y - cy); if (it.d < R) near.push(it); } }
    near.sort((a, b) => a.d - b.d);
    // the words: the nearest signs keep or take a place on the small sheet
    let drew = false; const want = []; for (const it of near) { if (it.d > FAR.text + (it.cell >= 0 ? 8 : 0) || want.length >= cells.length) break; want.push(it); }
    for (let k = 0; k < cells.length; k++) { const it = cells[k]; if (it && !want.includes(it)) { it.cell = -1; cells[k] = null; } }
    for (const it of want) if (it.cell < 0) { const k = cells.indexOf(null); if (k < 0) break; cells[k] = it; it.cell = k; const x = (k % NCOL) * CW, y = Math.floor(k / NCOL) * CH; drawPanel(nctx, x, y, { routes: it.s.routes || [], name: it.s.name || '', dirText: it.dirText, i: it.s.i || 0 }); drawName(nctx, x, y + 384, { name: it.s.name || '' }); drew = true; S.stats.signDraws++; }
    if (drew) tNear.needsUpdate = true;
    let np = 0, ns = 0, nt = 0;
    for (const it of near) {
      if (it.cell >= 0) { cu.u = (it.cell % NCOL) * CW / NW; cu.v = 1 - (Math.floor(it.cell / NCOL) + 1) * CH / NH; cu.on = 1; } else { cu.u = cu.v = cu.on = 0; } cu.ad = it.ad;
      if (it.d < FAR.pole && np < CAPS.pole) put(mPole, np++, it.x, it.y, it.h, cu);
      if (it.sh && ns < CAPS.sh) { put(mSh, ns, it.sh.x, it.sh.y, it.h, cu); put(mGl, ns, it.sh.x, it.sh.y, it.h, cu); ns++; }
      if (it.tvm && it.d < FAR.tvm && nt < CAPS.tvm) put(mTvm, nt++, it.tvm.x, it.tvm.y, it.h, cu);
    }
    for (const [m, n] of [[mPole, np], [mSh, ns], [mGl, ns], [mTvm, nt]]) { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aCell.needsUpdate = true; } }
    S.stats.drawn = { poles: np, shelters: ns, machines: nt, draws: (np ? 1 : 0) + (ns ? 2 : 0) + (nt ? 1 : 0), tris: np * S.tris.pole + ns * (S.tris.shelter + S.tris.glass) + nt * S.tris.machines };
  }
  S.update = (camX, camY) => {
    const N = g.night, n = N && typeof N.n === 'number' ? N.n : N && typeof N.night === 'number' ? N.night : 0; if (U.uBusNight.value !== n) U.uBusNight.value = n;
    const dx = camX - lx, dy = camY - ly; if (dx * dx + dy * dy < 36) return; lx = camX; ly = camY; rebuild(camX, camY);
  };
  S.dispose = () => { world.scene.remove(group); tStatic.dispose(); tNear.dispose(); for (const m of [mPole, mSh, mGl, mTvm]) m.geometry.dispose(); mat.dispose(); glassMat.dispose(); };
  S.stats.ms = +(performance.now() - t0).toFixed(1);
  console.log('[bus] stops: ' + S.stats.stops + ' poles, ' + S.stats.shelters + ' shelters (' + S.stats.noRoom + ' wanted one, no room), ' + S.stats.machines + ' ticket machine pairs, ' + S.stats.circles + ' solid circles, ' + S.stats.ms + ' ms' + (S.stats.skipped ? '; ' + S.stats.skipped + ' stops with no kerb left out' : ''));
  return S;
}
// ---------------------------------------------------------------------------------------------- makeLanes: the red bus lane
const NOISE = /* glsl */`
  float bh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float bn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(bh(i), bh(i+vec2(1,0)), f.x), mix(bh(i+vec2(0,1)), bh(i+vec2(1,1)), f.x), f.y); }
  float bf(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*bn(p); p = p*2.03+17.1; a *= .5; } return s / 0.9375; }`;
function letterTex() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const c = cv.getContext('2d'); c.clearRect(0, 0, 512, 256); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  ['BUS', 'ONLY'].forEach((w, i) => { c.save(); c.translate(i * 256 + 128, 128); c.font = '800 100px ' + FONT; const m = c.measureText(w).width; c.scale(228 / m, 2.9); c.fillText(w, 0, 4); c.restore(); });
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
export async function makeLanes(game, runs) {
  const g = game, R = g.roads, world = g.world, shared = world.shared || {}, L = { stats: { blocks: 0, metres: 0, letters: 0, quads: 0, skipped: 0, ms: 0 }, letters: [], own: [] }, t0 = performance.now();
  const pos = [], uv = [], aL = [], seen = new Set(), p = {}, q = {};
  const rnd = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const quad = (A, B, Cc, D, uvs, l) => { const Pp = [A, B, Cc, A, Cc, D], T = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]], Ll = [l[0], l[1], l[2], l[0], l[2], l[3]]; for (let i = 0; i < 6; i++) { pos.push(Pp[i][0], 0.014, -Pp[i][1]); uv.push(T[i][0], T[i][1]); aL.push(Ll[i][0], Ll[i][1], Ll[i][2], Ll[i][3]); } L.stats.quads++; };
  for (const run of runs || []) for (const sq of run.seq || []) {
    const e = sq.e, dir = sq.dir, ei = R.edges ? R.edges.indexOf(e) : 0, key = ei + ':' + dir; if (seen.has(key)) continue; seen.add(key);
    const n = R.laneCount(e, dir); if (n < 2 || e.shared) { L.stats.skipped++; continue; }
    const n0 = R.nodes[R.startNode(e, dir)], n1 = R.nodes[R.endNode(e, dir)], len = e.len, s0 = (n0 && n0.e.length >= 3 ? n0.r : 0) + 5.2;
    let s1 = len - ((n1 && n1.e.length >= 3 ? n1.r : 0) + 5.2); if (R.stopS && n1 && n1.e.length >= 3) { const ss = R.stopS(e, dir); if (Number.isFinite(ss)) s1 = Math.min(s1, ss - 0.4); }
    if (s1 - s0 < 10) { L.stats.skipped++; continue; }
    const hw = e.lw / 2 - 0.2, seed = 0.25 + 0.6 * rnd(ei, dir), steps = Math.max(1, Math.ceil((s1 - s0) / 6));
    for (let k = 0; k < steps; k++) { const a = s0 + (s1 - s0) * k / steps, b = s0 + (s1 - s0) * (k + 1) / steps; R.lanePos(e, dir, n - 1, a, p); R.lanePos(e, dir, n - 1, b, q);
      const ax = Math.sin(p.h), ay = -Math.cos(p.h), bx = Math.sin(q.h), by = -Math.cos(q.h), da = Math.min(a - s0, s1 - a), db = Math.min(b - s0, s1 - b);
      quad([p.x - ax * hw, p.y - ay * hw], [p.x + ax * hw, p.y + ay * hw], [q.x + bx * hw, q.y + by * hw], [q.x - bx * hw, q.y - by * hw], [[0, 0], [0, 0], [0, 0], [0, 0]], [[da, -hw, seed, 0], [da, hw, seed, 0], [db, hw, seed, 0], [db, -hw, seed, 0]]); }
    L.stats.blocks++; L.stats.metres += s1 - s0;
    // BUS ONLY, read in the direction of travel, once a block; the wide two-way crosstown streets are lettered by the road itself (streets/ground.js)
    if (!(!e.oneway && e.lanes >= 4) && s1 - s0 > 34) { const sc = s0 + Math.min(26, (s1 - s0) * 0.4); ['BUS', 'ONLY'].forEach((w, i) => { const c0 = sc + i * 5.6, a = c0 - 1.8, b = c0 + 1.8, lw2 = Math.min(1.05, hw - 0.25); R.lanePos(e, dir, n - 1, a, p); R.lanePos(e, dir, n - 1, b, q);
      const ax = Math.sin(p.h), ay = -Math.cos(p.h), u0 = i * 0.5 + 0.02, u1 = i * 0.5 + 0.48;
      if (!i) L.letters.push({ x: p.x, y: p.y, h: p.h });
      quad([p.x - ax * lw2, p.y - ay * lw2], [p.x + ax * lw2, p.y + ay * lw2], [q.x + ax * lw2, q.y + ay * lw2], [q.x - ax * lw2, q.y - ay * lw2], [[u0, 0.02], [u1, 0.02], [u1, 0.98], [u0, 0.98]], [[9, -lw2, seed, 1], [9, lw2, seed, 1], [9, lw2, seed, 1], [9, -lw2, seed, 1]]); }); L.stats.letters++; }
    else if (!e.oneway && e.lanes >= 4 && s1 - s0 > 60) { R.lanePos(e, dir, n - 1, s0 + 26, p); L.own.push({ x: p.x, y: p.y, h: p.h }); }
  }
  if (!pos.length) { L.stats.ms = +(performance.now() - t0).toFixed(1); console.log('[bus] lanes: nothing to paint'); return L; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('aL', new THREE.Float32BufferAttribute(aL, 4));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const bake = !!(shared.tLight && shared.tLight.value && shared.uHalf), tex = letterTex();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (sh) => {
    if (bake) Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec4 aL; varying vec4 vL; varying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vL = aL; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vL; varying vec3 vWPos; ${NOISE} ${bake ? 'uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;' : ''}`)
      .replace('#include <map_fragment>', `{
        vec2 w = vWPos.xz; float px = max(fwidth(w.x), fwidth(w.y));
        float n1 = bf(w * 0.33 + vL.z * 31.0), n2 = bf(w * 2.7 + 5.0), n3 = bn(w * 38.0), fine = 1.0 - smoothstep(0.03, 0.12, px);
        float track = exp(-pow((abs(vL.y) - 0.93) / 0.34, 2.0));                                  // where the wheels run
        float wear = clamp(0.06 + 0.5 * vL.z * n1 * n1 + track * (0.16 + 0.34 * vL.z) * (0.5 + n1), 0.0, 0.9);
        float th = 1.06 - 0.66 * wear, cov = 1.0 - smoothstep(th - 0.025, th + 0.025, n2 * 0.75 + 0.25 * mix(0.5, n3, fine));     // the paint is ground off in patches
        if (vL.w < 0.5) {
          float edge = smoothstep(0.0, 0.02 + 0.02 * n3, vL.x - 0.03 * n2);                 // the ends are ragged
          vec3 red = vec3(0.082, 0.020, 0.016) * (0.8 + 0.45 * n1);                              // a worn brick red about as dark as the road beside it (the road's own red, streets/ground.js kind 3, x 0.24: at full strength it read salmon in the game's sun)
          red = mix(red, vec3(dot(red, vec3(0.33))) * vec3(1.15, 0.95, 0.95), 0.18 + 0.3 * wear);       // sun-bleached and dusty where it is worn
          red = mix(red, vec3(0.045, 0.042, 0.04), 0.42 * track * (0.3 + n2));                     // tyre grime
          red *= 0.9 + 0.2 * mix(0.5, n3, fine);
          diffuseColor = vec4(red, cov * edge);
        } else {
          float sh = smoothstep(0.35, 0.65, texture2D(map, vMapUv).a);
          float lcov = 1.0 - smoothstep(th - 0.2, th, n2 * 0.75 + 0.25 * mix(0.5, n3, fine)) * 0.85;
          diffuseColor = vec4(vec3(0.50, 0.50, 0.48) * (0.85 + 0.25 * n1), sh * lcov);
        } }`)
      .replace('#include <aomap_fragment>', bake ? 'bakeN = vec3(0.0, 1.0, 0.0); bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb;' + BAKE_LIGHT_GLSL : '#include <aomap_fragment>');
  };
  mat.customProgramCacheKey = () => 'buslane4' + (bake ? 'b' : '');
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'bus_lanes'; mesh.renderOrder = 1.5; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; world.scene.add(mesh);
  L.mesh = mesh; L.stats.tris = pos.length / 9; L.stats.metres = Math.round(L.stats.metres); L.stats.ms = +(performance.now() - t0).toFixed(1); L.dispose = () => { world.scene.remove(mesh); geo.dispose(); mat.dispose(); tex.dispose(); };
  console.log('[bus] lanes: ' + L.stats.blocks + ' blocks, ' + L.stats.metres + ' m of red lane, ' + L.stats.letters + ' BUS ONLY, ' + L.stats.tris + ' triangles, ' + L.stats.ms + ' ms');
  return L;
}
