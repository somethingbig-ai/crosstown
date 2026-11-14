// train.js: the subway train, all made in code (geometry + one canvas texture sheet). See CONTRACT.md.
// buildTrain(THREE, opts) -> { group, length, carLen, width, floorY, doors, setDoors, setLights, setAmbient, setRoute, walk, seats, stand, dispose, ... }
// Local frame: +Z = direction of travel, +X = right side looking forward, Y up, y = 0 at TOP OF RAIL, origin at the middle of the train.
// Car 0 is the car at the -Z end; the last car is at the +Z end. Both ends have a cab.
// Everything is UNLIT with baked vertex colours. One per-vertex number (aL) says which light a vertex takes:
//   0 = inside the car (times the interior lamps), 1 = outside (times setAmbient), 2 = glows on its own (badges, signs).
// Draw calls for a whole train: shell, door leaves, cab ends, lamps, fixed glass, door glass = 6.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function rng32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- small geometry builder ----------
function mkGeo() { return { p: [], u: [], c: [], l: [], i: [], n: 0 }; }
function poly(g, pts, nh, uvF, colF, L) {
  const n = pts.length; let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); cx += a[0]; cy += a[1]; cz += a[2]; }
  if (nh && nx * nh[0] + ny * nh[1] + nz * nh[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
  const nl = Math.hypot(nx, ny, nz) || 1, nn = [nx / nl, ny / nl, nz / nl], cc = [cx / n, cy / n, cz / n], base = g.n;
  for (const p of pts) { const uv = uvF(p, cc, nn), col = colF(p, nn, cc); g.p.push(p[0], p[1], p[2]); g.u.push(uv[0], uv[1]); g.c.push(col[0], col[1], col[2]); g.l.push(L); g.n++; }
  for (let k = 1; k < n - 1; k++) g.i.push(base, base + k, base + k + 1);
}
// a flat wall with rectangular holes. plane 'x': points (c, b, a) a = z, b = y; 'z': (a, b, c) a = x, b = y; 'y': (a, c, b) a = x, b = z
function grid(g, plane, c, nh, a0, a1, b0, b1, holes, xa, xb, uvF, colF, L) {
  const cut = (lo, hi, vals) => [...new Set([lo, hi, ...vals].filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).map((v) => +v.toFixed(5)))].sort((p, q) => p - q);
  const A = cut(a0, a1, [...holes.flatMap((h) => [h.a0, h.a1]), ...(xa || [])]), B = cut(b0, b1, [...holes.flatMap((h) => [h.b0, h.b1]), ...(xb || [])]);
  const pt = (a, b) => plane === 'x' ? [c, b, a] : plane === 'z' ? [a, b, c] : [a, c, b];
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
    const ca = (A[i] + A[i + 1]) / 2, cb = (B[j] + B[j + 1]) / 2;
    if (holes.some((h) => ca > h.a0 && ca < h.a1 && cb > h.b0 && cb < h.b1)) continue;
    poly(g, [pt(A[i], B[j]), pt(A[i + 1], B[j]), pt(A[i + 1], B[j + 1]), pt(A[i], B[j + 1])], nh, uvF, colF, L);
  }
}
function box(g, x0, x1, y0, y1, z0, z1, uvF, colF, L, skip = '') {
  const f = (k, pts, n) => { if (!skip.includes(k)) poly(g, pts, n, uvF, colF, L); };
  f('+x', [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]); f('-x', [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]);
  f('+y', [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]); f('-y', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  f('+z', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]); f('-z', [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
}
// cylinder along an axis ('x', 'y' or 'z'); colF(p, radialNormal)
function cyl(g, axis, s0, s1, ca, cb, r, segs, uvF, colF, L, caps = true) {
  const P = (s, k) => { const t = k / segs * Math.PI * 2, a = ca + r * Math.cos(t), b = cb + r * Math.sin(t); return axis === 'x' ? [s, a, b] : axis === 'y' ? [a, s, b] : [a, b, s]; };
  const N = (p) => { const d = axis === 'x' ? [0, p[1] - ca, p[2] - cb] : axis === 'y' ? [p[0] - ca, 0, p[2] - cb] : [p[0] - ca, p[1] - cb, 0]; const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
  for (let k = 0; k < segs; k++) { const m = N(P(s0, k + 0.5)); poly(g, [P(s0, k), P(s0, k + 1), P(s1, k + 1), P(s1, k)], m, uvF, (p) => colF(p, N(p)), L); }
  if (caps) for (const [s, d] of [[s0, -1], [s1, 1]]) { const pts = []; for (let k = 0; k < segs; k++) pts.push(P(s, k)); const n = axis === 'x' ? [d, 0, 0] : axis === 'y' ? [0, d, 0] : [0, 0, d]; poly(g, pts, n, uvF, (p) => colF(p, n), L); }
}
// a flat card with its own picture: centre c, right r and up u (unit vectors as seen by the viewer), size w x h, picture region reg
function card(g, c, r, u, w, h, reg, col, L, TW, TH) {
  const base = g.n, hw = w / 2, hh = h / 2;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.p.push(c[0] + r[0] * a * hw + u[0] * b * hh, c[1] + r[1] * a * hw + u[1] * b * hh, c[2] + r[2] * a * hw + u[2] * b * hh);
    g.u.push((reg.x + (a + 1) / 2 * reg.w) / TW, 1 - (reg.y + (1 - (b + 1) / 2) * reg.h) / TH); g.c.push(col[0], col[1], col[2]); g.l.push(L); g.n++;
  }
  g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function toGeometry(THREE, g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3)); geo.setAttribute('aL', new THREE.Float32BufferAttribute(g.l, 1));
  geo.setIndex(g.n > 65535 ? new THREE.Uint32BufferAttribute(g.i, 1) : new THREE.Uint16BufferAttribute(g.i, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
}

// ---------- the texture sheet ----------
const TW = 2048, TH = 2048;
const BANDS = { EXT: [4, 448], PLAIN: [460, 64], ROOF: [532, 96], UNDER: [636, 96], INTW: [740, 224], FLOOR: [972, 192], CEIL: [1172, 96], SEAT: [1276, 96] };
const REG = { FRONT: { x: 4, y: 1384, w: 608, h: 540 }, BADGE: { x: 624, y: 1384, w: 256, h: 256 }, DEST: { x: 896, y: 1384, w: 640, h: 120 }, WHITE: { x: 1552, y: 1384, w: 64, h: 64 },
  STRIP: { x: 896, y: 1520, w: 1136, h: 120 }, AD0: { x: 624, y: 1656, w: 704, h: 184 }, AD1: { x: 1336, y: 1656, w: 704, h: 184 }, AD2: { x: 624, y: 1852, w: 704, h: 184 }, AD3: { x: 1336, y: 1852, w: 704, h: 184 } };
const band = (k) => { const [y, h] = BANDS[k]; return { v0: 1 - (y + h) / TH, v1: 1 - y / TH, e: 0.75 / h }; };
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function brushed(c, x, y, w, h, n, R, amt = 1) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let k = 0; k < n; k++) { const yy = y + R() * h, x0 = x + R() * w, len = 40 + R() * 420, a = (0.03 + R() * 0.07) * amt; c.fillStyle = R() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; const t = R() < 0.8 ? 1 : 2; c.fillRect(x0, yy, len, t); c.fillRect(x0 - w, yy, len, t); }
  c.restore(); }
function speckle(c, x, y, w, h, n, R, cols) { for (let k = 0; k < n; k++) { c.fillStyle = cols[(R() * cols.length) | 0]; const s = R() < 0.85 ? 1 : 2; c.fillRect(x + R() * w, y + R() * (h - 2), s, s); } }
function lumOf(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return 0.3; const v = parseInt(m[1], 16), f = (x) => Math.pow(x / 255, 2.2); return 0.2126 * f(v >> 16) + 0.7152 * f((v >> 8) & 255) + 0.0722 * f(v & 255); }

function paintBadge(c, r, route) { // OUR badge: a rounded square in the route colour with the letter
  c.clearRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.fillStyle = '#0c0d0f'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
  rr(c, r.x + 8, r.y + 8, r.w - 16, r.h - 16, r.w * 0.2); c.fillStyle = route.color; c.fill();
  c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,0.28)'; rr(c, r.x + 19, r.y + 19, r.w - 38, r.h - 38, r.w * 0.15); c.stroke();
  const label = String(route.label ?? '?').slice(0, 3); c.fillStyle = lumOf(route.color) > 0.42 ? '#111' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 ${Math.round(r.h * (label.length > 1 ? 0.46 : 0.64))}px "Helvetica Neue", Arial, sans-serif`; c.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.04);
}
function paintDest(c, r, route) { // the lit sign on the front: black with amber dot letters
  c.fillStyle = '#060606'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
  const text = String(route.dest || 'LOCAL').toUpperCase().slice(0, 14); c.fillStyle = '#ffb21e'; c.textAlign = 'center'; c.textBaseline = 'middle';
  let px = 88; c.font = `700 ${px}px "DejaVu Sans Mono", "Courier New", monospace`; const tw = c.measureText(text).width; if (tw > r.w - 40) { px = Math.floor(px * (r.w - 40) / tw); c.font = `700 ${px}px "DejaVu Sans Mono", "Courier New", monospace`; }
  c.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 4);
  c.fillStyle = 'rgba(0,0,0,0.42)'; for (let y = r.y; y < r.y + r.h; y += 5) c.fillRect(r.x, y, r.w, 1.6); for (let x = r.x; x < r.x + r.w; x += 5) c.fillRect(x, r.y, 1.6, r.h);
}
const STOPS = ['Harlow St', 'Canal Yard', 'Pike Sq', 'Orchard Row', 'Mercer Hall', 'Vine & 9th', 'Foundry', 'Larkspur', 'Dock End'];
function paintStrip(c, r, route) { // the line map above each door (invented stops)
  c.fillStyle = '#ecebe4'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.fillStyle = '#1b1c1f'; c.fillRect(r.x, r.y, r.w, 9); c.fillRect(r.x, r.y + r.h - 5, r.w, 5);
  paintBadgeMini(c, r.x + 14, r.y + 22, 80, route);
  const x0 = r.x + 150, x1 = r.x + r.w - 60, y = r.y + 48; c.strokeStyle = route.color; c.lineWidth = 12; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 21px "Helvetica Neue", Arial, sans-serif';
  STOPS.forEach((s, k) => { const x = x0 + (x1 - x0) * k / (STOPS.length - 1); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill(); c.lineWidth = 4; c.strokeStyle = '#1b1c1f'; c.stroke(); c.fillStyle = '#1b1c1f'; c.fillText(s, x, y + 38); });
}
function paintBadgeMini(c, x, y, s, route) { rr(c, x, y, s, s, s * 0.2); c.fillStyle = route.color; c.fill(); c.fillStyle = lumOf(route.color) > 0.42 ? '#111' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; const label = String(route.label ?? '?').slice(0, 3); c.font = `800 ${Math.round(s * (label.length > 1 ? 0.46 : 0.66))}px "Helvetica Neue", Arial, sans-serif`; c.fillText(label, x + s / 2, y + s / 2 + s * 0.04); }
function paintAds(c) { // invented ad cards (no real brands)
  const T = (t, x, y, f, col, al = 'left') => { c.font = f; c.fillStyle = col; c.textAlign = al; c.textBaseline = 'middle'; c.fillText(t, x, y); };
  let r = REG.AD0; c.fillStyle = '#14203a'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.fillStyle = '#f2d9a0'; c.beginPath(); c.arc(r.x + 96, r.y + 92, 58, 0, 7); c.fill(); c.fillStyle = '#14203a'; c.beginPath(); c.arc(r.x + 120, r.y + 76, 50, 0, 7); c.fill();
  T('NIGHTOWL COFFEE', r.x + 190, r.y + 70, '800 50px Georgia, serif', '#f6ead0'); T('open until the last train', r.x + 192, r.y + 128, 'italic 32px Georgia, serif', '#c9b78c');
  r = REG.AD1; c.fillStyle = '#0f7f86'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(r.x + 90, r.y + 24); c.lineTo(r.x + 90, r.y + 136); c.lineTo(r.x + 30, r.y + 136); c.closePath(); c.fill(); c.beginPath(); c.moveTo(r.x + 100, r.y + 44); c.lineTo(r.x + 150, r.y + 136); c.lineTo(r.x + 100, r.y + 136); c.closePath(); c.fill(); c.fillRect(r.x + 24, r.y + 146, 136, 10);
  T('LEARN TO SAIL', r.x + 190, r.y + 68, '800 56px "Helvetica Neue", Arial, sans-serif', '#fff'); T('Harbor Point School · weekends', r.x + 192, r.y + 128, '500 30px "Helvetica Neue", Arial, sans-serif', '#c8f0ee');
  r = REG.AD2; c.fillStyle = '#f0b429'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.strokeStyle = '#6a3d0a'; c.lineWidth = 26; c.beginPath(); c.arc(r.x + 96, r.y + 92, 46, 0, 7); c.stroke();
  T('Bagel & Bean Co.', r.x + 180, r.y + 68, '800 56px Georgia, serif', '#3a2206'); T('fresh since this morning', r.x + 182, r.y + 128, '500 32px Georgia, serif', '#6a3d0a');
  r = REG.AD3; c.fillStyle = '#f4f2ea'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.fillStyle = '#c23b22'; c.fillRect(r.x, r.y, 18, r.h);
  T('POEMS UNDERGROUND', r.x + 44, r.y + 36, '800 26px "Helvetica Neue", Arial, sans-serif', '#c23b22'); T('The tunnel hums a single note,', r.x + 44, r.y + 88, 'italic 38px Georgia, serif', '#222'); T('and every stop is a rhyme.', r.x + 44, r.y + 136, 'italic 38px Georgia, serif', '#222');
}

function paintSheet(D, route, seed) {
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH; const c = cv.getContext('2d'); const R = rng32(seed * 7919 + 13);
  c.fillStyle = '#808080'; c.fillRect(0, 0, TW, TH);
  const lin = (y0, y1, stops) => { const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach(([t, col]) => g.addColorStop(t, col)); return g; };
  // EXT: the car side from sill to roof line, one door spacing wide (door at the middle)
  { const [y0, h] = BANDS.EXT, Y = (m) => y0 + (1 - (m - D.SILL) / (D.SH - D.SILL)) * h;
    c.fillStyle = lin(y0, y0 + h, [[0, '#c9cdd1'], [0.5, '#bcc0c5'], [1, '#a4a8ad']]); c.fillRect(0, y0, TW, h); brushed(c, 0, y0, TW, h, 5200, R);
    for (let k = 0; k < 7; k++) { const y = Y(D.F + 0.13 + k * 0.088); c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(0, y - 3, TW, 2); c.fillStyle = 'rgba(40,44,50,0.55)'; c.fillRect(0, y - 1, TW, 3); c.fillStyle = 'rgba(40,44,50,0.16)'; c.fillRect(0, y + 2, TW, 4); }
    const b1 = Y(D.BY1), b0 = Y(D.BY0); c.fillStyle = lin(b1, b0, [[0, '#2a2e34'], [0.35, '#1a1c20'], [1, '#131417']]); c.fillRect(0, b1, TW, b0 - b1);
    c.fillStyle = '#d9dde1'; c.fillRect(0, b1 - 3, TW, 3); c.fillRect(0, b0, TW, 3); c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, b0 + 3, TW, 2);
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, y0 + 10, TW, 2); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(0, y0 + 12, TW, 2);
    const ys = Y(D.F - 0.01); c.fillStyle = 'rgba(30,32,36,0.5)'; c.fillRect(0, ys, TW, y0 + h - ys); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, ys - 2, TW, 2);
    for (let k = 0; k < 4; k++) { const x = k * TW / 4 + (k % 2 ? 0 : 0); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, y0, 2, b1 - y0 - 3); c.fillRect(x, b0 + 5, 2, ys - b0 - 5); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x + 2, y0, 1, b1 - y0 - 3); c.fillRect(x + 2, b0 + 5, 1, ys - b0 - 5);
      for (let y = y0 + 22; y < b1 - 8; y += 14) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x + 8, y, 3, 3); c.fillRect(x - 9, y, 3, 3); } }
    c.fillStyle = lin(y0 + h * 0.62, y0 + h, [[0, 'rgba(60,50,40,0)'], [1, 'rgba(60,50,40,0.30)']]); c.fillRect(0, y0, TW, h);
    for (let k = 0; k < 90; k++) { const x = R() * TW, len = 20 + R() * 90; c.fillStyle = `rgba(50,42,34,${0.03 + R() * 0.07})`; c.fillRect(x, b0 + 6 + R() * 30, 2 + R() * 4, len); } }
  { const [y0, h] = BANDS.PLAIN; c.fillStyle = lin(y0, y0 + h, [[0, '#c4c8cc'], [1, '#b6babf']]); c.fillRect(0, y0, TW, h); brushed(c, 0, y0, TW, h, 800, R); }
  { const [y0, h] = BANDS.ROOF; c.fillStyle = lin(y0, y0 + h, [[0, '#7d8186'], [0.5, '#9a9ea3'], [1, '#7d8186']]); c.fillRect(0, y0, TW, h); brushed(c, 0, y0, TW, h, 500, R, 0.7);
    for (let k = 0; k < 40; k++) { c.fillStyle = 'rgba(0,0,0,0.13)'; c.fillRect(k * TW / 40, y0, 2, h); c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(k * TW / 40 + 2, y0, 2, h); }
    speckle(c, 0, y0, TW, h, 5000, R, ['rgba(0,0,0,0.12)', 'rgba(40,30,20,0.14)']); }
  { const [y0, h] = BANDS.UNDER; c.fillStyle = '#45443f'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 16000, R, ['rgba(0,0,0,0.22)', 'rgba(255,255,255,0.07)', 'rgba(110,70,40,0.2)']);
    for (let k = 0; k < 60; k++) { c.fillStyle = `rgba(${90 + R() * 40 | 0},${55 + R() * 20 | 0},30,${0.05 + R() * 0.1})`; const x = R() * TW, w = 20 + R() * 120; c.fillRect(x, y0 + R() * h, w, 3 + R() * 14); c.fillRect(x - TW, y0 + R() * h, w, 3 + R() * 14); }
    for (let k = 0; k < 16; k++) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(k * TW / 16, y0, 2, h); } }
  // INTW: the inside wall from the floor up to the card band
  { const [y0, h] = BANDS.INTW, Y = (m) => y0 + (1 - m / 1.92) * h;
    c.fillStyle = '#e4e2d8'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 5000, R, ['rgba(0,0,0,0.03)', 'rgba(255,255,255,0.08)']);
    const ym = Y(0.85); c.fillStyle = lin(ym, y0 + h, [[0, '#a9adb0'], [1, '#8b8f92']]); c.fillRect(0, ym, TW, y0 + h - ym); brushed(c, 0, ym, TW, y0 + h - ym, 1300, R, 0.8);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, ym - 1, TW, 2); c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, Y(1.78), TW, 2);
    for (let k = 0; k < 4; k++) { c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(k * TW / 4, y0, 2, h); } }
  { const [y0, h] = BANDS.FLOOR; c.fillStyle = '#343941'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 30000, R, ['rgba(255,255,255,0.16)', 'rgba(0,0,0,0.3)', 'rgba(150,170,200,0.2)', 'rgba(210,190,150,0.14)']);
    for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(0,0,0,${0.04 + R() * 0.06})`; const x = R() * TW; c.beginPath(); c.ellipse(x, y0 + h / 2 + (R() - 0.5) * h * 0.5, 20 + R() * 50, 6 + R() * 12, 0, 0, 7); c.fill(); } }
  { const [y0, h] = BANDS.CEIL; c.fillStyle = '#e9e8e1'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 3000, R, ['rgba(0,0,0,0.03)']);
    for (let k = 0; k < 16; k++) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(k * TW / 16, y0, 2, h); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(k * TW / 16 + 2, y0, 1, h); }
    c.fillStyle = '#d6d5cf'; c.fillRect(0, y0 + h * 0.455, TW, h * 0.09); c.fillStyle = 'rgba(60,64,68,0.55)'; c.fillRect(0, y0 + h * 0.47, TW, 2); c.fillRect(0, y0 + h * 0.5 - 1, TW, 2); c.fillRect(0, y0 + h * 0.53 - 2, TW, 2); }
  // SEAT: four seats across; lower half = the seat (front edge at the bottom), upper half = the backrest
  { const [y0, h] = BANDS.SEAT; c.fillStyle = '#1f6f8f'; c.fillRect(0, y0, TW, h);
    for (let k = 0; k < 16; k++) { const x = k * TW / 16, w = TW / 16; const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.07, 'rgba(0,0,0,0.05)'); g.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g.addColorStop(0.93, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.42)'); c.fillStyle = g; c.fillRect(x, y0, w, h); }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, y0 + h / 2 - 2, TW, 4); c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(0, y0 + h - 10, TW, 6); c.fillRect(0, y0 + 4, TW, 5);
    speckle(c, 0, y0, TW, h, 6000, R, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)']); }
  for (const k in BANDS) { const [y0, h] = BANDS[k]; c.drawImage(cv, 0, y0, TW, 1, 0, y0 - 4, TW, 4); c.drawImage(cv, 0, y0 + h - 1, TW, 1, 0, y0 + h, TW, 4); }
  // FRONT: the whole cab face, painted
  { const r = REG.FRONT, sx = D.hw / 1.525, X = (m) => r.x + (m * sx + D.hw) / D.W * r.w, Y = (m) => r.y + (1 - (m - D.SILL) / (D.TOP - D.SILL)) * r.h, F = D.F;
    const RC = (x0, x1, yb, yt) => [X(x0), Y(yt), X(x1) - X(x0), Y(yb) - Y(yt)];
    c.save(); c.beginPath(); c.rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); c.clip();
    c.fillStyle = lin(r.y, r.y + r.h, [[0, '#c6cace'], [1, '#a9adb2']]); c.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); brushed(c, r.x - 3, r.y, r.w + 6, r.h, 1700, R);
    c.fillStyle = '#17181b'; rr(c, ...RC(-1.41, 1.41, F + 0.76, F + 2.36), 34); c.fill(); c.strokeStyle = '#dfe2e5'; c.lineWidth = 3; rr(c, ...RC(-1.41, 1.41, F + 0.76, F + 2.36), 34); c.stroke();
    for (const [x0, x1] of [[-1.29, -0.50], [-0.27, 0.27], [0.50, 1.29]]) { const q = RC(x0, x1, F + 0.92, F + 1.74); const g = c.createLinearGradient(q[0], q[1], q[0] + q[2] * 0.6, q[1] + q[3]); g.addColorStop(0, '#3d4a57'); g.addColorStop(0.45, '#1c232b'); g.addColorStop(1, '#0d1014'); c.fillStyle = g; rr(c, ...q, 9); c.fill(); c.strokeStyle = '#050506'; c.lineWidth = 4; rr(c, ...q, 9); c.stroke();
      c.save(); rr(c, ...q, 9); c.clip(); c.fillStyle = 'rgba(190,215,235,0.10)'; c.beginPath(); c.moveTo(q[0] + q[2] * 0.15, q[1]); c.lineTo(q[0] + q[2] * 0.5, q[1]); c.lineTo(q[0] + q[2] * 0.2, q[1] + q[3]); c.lineTo(q[0] - q[2] * 0.15, q[1] + q[3]); c.closePath(); c.fill(); c.restore(); }
    c.strokeStyle = '#3b3f45'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(1.2), Y(F + 0.94)); c.lineTo(X(0.72), Y(F + 1.45)); c.stroke(); // wiper
    for (const s of [-1, 1]) { c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(X(0.40 * s) - 1.5, Y(F + 2.0), 3, Y(F - 0.02) - Y(F + 2.0)); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(X(0.40 * s) + 1.5 * s, Y(F + 0.76), 1.5, Y(F - 0.02) - Y(F + 0.76));
      c.fillStyle = '#e6e9ec'; c.fillRect(X(0.50 * s) - 2.5, Y(F + 0.70), 5, Y(F + 0.22) - Y(F + 0.70)); c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(X(0.50 * s) + 2.5, Y(F + 0.70), 2, Y(F + 0.22) - Y(F + 0.70));
      const q = RC(Math.min(0.84 * s, 1.31 * s), Math.max(0.84 * s, 1.31 * s), F + 0.21, F + 0.47); c.fillStyle = '#141416'; rr(c, ...q, 12); c.fill(); c.strokeStyle = '#e1e4e7'; c.lineWidth = 2.5; rr(c, ...q, 12); c.stroke();
      for (const lx of [0.98, 1.17]) { c.fillStyle = '#8f9499'; c.beginPath(); c.ellipse(X(lx * s), Y(F + 0.34), (X(0.088) - X(0)), Y(0) - Y(0.088), 0, 0, 7); c.fill(); } }
    c.fillStyle = '#d5d8db'; c.fillRect(X(0.26) , Y(F + 0.52), X(0.34) - X(0.26), 5); // door handle
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(r.x - 3, Y(F + 0.60), r.w + 6, 2); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(r.x - 3, Y(F + 0.60) + 2, r.w + 6, 2);
    const ya = Y(F - 0.02); c.fillStyle = '#2b2c2f'; c.fillRect(r.x - 3, ya, r.w + 6, r.y + r.h + 3 - ya); for (let k = 0; k < 4; k++) { c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(r.x - 3, ya + 4 + k * 8, r.w + 6, 2); }
    c.fillStyle = lin(r.y + r.h * 0.7, r.y + r.h, [[0, 'rgba(50,42,34,0)'], [1, 'rgba(50,42,34,0.28)']]); c.fillRect(r.x - 3, r.y, r.w + 6, r.h + 3);
    c.restore(); }
  c.fillStyle = '#fff'; c.fillRect(REG.WHITE.x - 4, REG.WHITE.y - 4, REG.WHITE.w + 8, REG.WHITE.h + 8);
  paintAds(c); paintBadge(c, REG.BADGE, route); paintDest(c, REG.DEST, route); paintStrip(c, REG.STRIP, route);
  return { cv, c };
}

// ---------- the train ----------
export function buildTrain(THREE, opts = {}) {
  const cars = Math.max(1, Math.round(opts.cars ?? 4)), div = opts.div === 'A' ? 'A' : 'B', seed = opts.seed ?? 1;
  let route = { label: 'F', color: '#f36a1c', dest: '', ...(opts.route || {}) };
  const carLen = div === 'A' ? 15.6 : 18.4, W = div === 'A' ? 2.68 : 3.05, nd = div === 'A' ? 3 : 4;
  const F = 1.12, SILL = 0.95, SH = F + 2.03, RISE = 0.47, TOP = SH + RISE, WT = 0.07, hw = W / 2, xi = hw - WT, Lb = carLen / 2 - 0.25, Li = Lb - WT;
  const DW = 1.27, DH = 1.90, LEAFW = 0.645, SLIDE = 0.64, WY0 = F + 0.85, WY1 = F + 1.70, BY0 = F + 0.78, BY1 = F + 1.80, sp = carLen / nd;
  const CEIL = F + 2.10, CARD_Y = F + 1.92, SLANT = 0.28, SEAT_D = 0.46, SEAT_H = 0.43, SEATW = 0.45;
  const D = { F, SILL, SH, TOP, BY0, BY1, hw, W };
  const doorZ = []; for (let k = 0; k < nd; k++) doorZ.push((k + 0.5) * sp - carLen / 2);
  const lastEdge = doorZ[nd - 1] + DW / 2, zp = lastEdge + 0.10; // zp: the cab wall inside an end car
  const truckZ = +(carLen * 0.365).toFixed(2);
  const carZ = (i) => (i - (cars - 1) / 2) * carLen, length = cars * carLen;

  // windows (z ranges in the car's own frame; the same on both sides)
  const wins = []; const winW = sp - DW - 2 * 0.66 - 0.2;
  for (let k = 0; k < nd - 1; k++) { const zc = (doorZ[k] + doorZ[k + 1]) / 2; wins.push([zc - winW / 2, zc + winW / 2]); }
  wins.push([Lb - 0.75, Lb - 0.2], [-Lb + 0.2, -Lb + 0.75]);
  const sideHoles = [...doorZ.map((z) => ({ a0: z - DW / 2, a1: z + DW / 2, b0: F, b1: F + DH })), ...wins.map(([a, b]) => ({ a0: a, a1: b, b0: WY0, b1: WY1 }))];
  // benches (per side): [z0, z1, endPanelAtZ0, endPanelAtZ1]
  const benches = [];
  for (let k = 0; k < nd - 1; k++) { const n = Math.floor((sp - DW - 0.30) / SEATW), zc = (doorZ[k] + doorZ[k + 1]) / 2; benches.push({ z0: zc - n * SEATW / 2, z1: zc + n * SEATW / 2, n, p0: true, p1: true, end: 0 }); }
  { const n = Math.floor((Li - 0.02 - (lastEdge + 0.15)) / SEATW); if (n > 0) { benches.push({ z0: lastEdge + 0.15, z1: lastEdge + 0.15 + n * SEATW, n, p0: true, p1: false, end: 1 }); benches.push({ z0: -(lastEdge + 0.15 + n * SEATW), z1: -(lastEdge + 0.15), n, p0: false, p1: true, end: -1 }); } }

  // ----- uv and colour helpers -----
  const bEXT = band('EXT'), bPLAIN = band('PLAIN'), bROOF = band('ROOF'), bUNDER = band('UNDER'), bINTW = band('INTW'), bFLOOR = band('FLOOR'), bCEIL = band('CEIL'), bSEAT = band('SEAT');
  const bandUV = (b, uF, tF) => (p, cc, n) => [uF(p, cc, n), b.v0 + (b.v1 - b.v0) * clamp(tF(p, cc, n), b.e, 1 - b.e)];
  const uvWhite = () => [(REG.WHITE.x + 32) / TW, 1 - (REG.WHITE.y + 32) / TH];
  const uvExt = bandUV(bEXT, (p) => (p[2] + carLen / 2) / sp, (p) => (p[1] - SILL) / (SH - SILL));
  const uvPlain = bandUV(bPLAIN, (p, cc, n) => (Math.abs(n[2]) > 0.7 ? p[0] : p[2]) / 18, (p) => (p[1] - F) / 2.6 + 0.02);
  const uvPlainTop = bandUV(bPLAIN, (p) => p[2] / 18, (p) => (p[0] + hw) / W);
  const uvUnder = bandUV(bUNDER, (p) => (p[0] * 0.05 + p[2] * 0.06), (p, cc, n) => Math.abs(n[1]) > 0.7 ? (p[0] + 1.6) / 3.2 : p[1] / 1.0);
  const uvIntW = bandUV(bINTW, (p) => (p[2] + carLen / 2) / sp, (p) => (p[1] - F) / 1.92);
  const uvIntEnd = bandUV(bINTW, (p) => p[0] / sp + 0.125, (p) => (p[1] - F) / 1.92);
  const uvCeil = bandUV(bCEIL, (p) => p[2] / 19.2, (p) => (p[0] + xi) / (2 * xi));
  const uvFloor = bandUV(bFLOOR, (p) => p[2] / 20, (p) => (p[0] + xi) / (2 * xi));
  const mul = (b, s) => [b[0] * s, b[1] * s, b[2] * s];
  const extC = (b = [1, 1, 1]) => (p, n) => mul(b, n[1] > 0.6 ? 1.0 : n[1] < -0.6 ? 0.26 : 0.70 + 0.28 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1));
  const undC = (b = [1, 1, 1]) => (p, n) => mul(b, n[1] > 0.6 ? 0.50 : n[1] < -0.6 ? 0.14 : 0.24 + 0.24 * clamp(p[1] / SILL, 0, 1));
  const intS = (y) => 0.58 + 0.42 * Math.pow(clamp((y - F) / 2.1, 0, 1), 0.65);
  const intC = (b = [1, 1, 1]) => (p) => mul(b, intS(p[1]));
  const flat = (b) => () => b;
  const STEEL = [0.92, 0.94, 0.96], RUBBER = [0.035, 0.035, 0.04], WARM = [1.0, 0.985, 0.95];
  const sheen = (b, lo = 0.42, hi = 1.25) => (p, n) => { const d = Math.max(0, n[0] * 0.55 + n[1] * 0.55 + n[2] * 0.63), k = lo + (hi - lo) * d * d; return mul(b, k * (n[1] === 0 ? intS(p[1]) * 0.25 + 0.75 : 1)); };

  // ================= the car shell (outside and inside, one geometry, one instance per car) =================
  const g = mkGeo();
  for (const s of [-1, 1]) {
    // side walls: outer skin, inner skin, and the edges of every opening
    grid(g, 'x', s * hw, [s, 0, 0], -Lb, Lb, SILL, SH, sideHoles, null, null, uvExt, extC(), 1);
    grid(g, 'x', s * xi, [-s, 0, 0], -Li, Li, F, CARD_Y, sideHoles, [...wins.flatMap(([a, b]) => [a - 0.04, b + 0.04]), ...doorZ.flatMap((z) => [z - DW / 2 - 0.06, z + DW / 2 + 0.06])], [F + 0.10, F + 0.43, WY0 - 0.04, WY1 + 0.04], uvIntW,
      (p, n, cc) => { const k = intS(p[1]) * (p[1] < F + 0.01 ? 0.6 : 1);
        if (cc[1] > WY0 - 0.04 && cc[1] < WY1 + 0.04 && wins.some(([a, b]) => cc[2] > a - 0.04 && cc[2] < b + 0.04)) return mul([0.20, 0.21, 0.22], k);
        if (doorZ.some((z) => Math.abs(cc[2] - z) < DW / 2 + 0.06)) return mul([0.62, 0.64, 0.66], k);
        return mul(cc[1] < F + 0.10 ? [0.45, 0.45, 0.46] : WARM, k); }, 0);
    for (const h of sideHoles) { const door = h.b0 === F, col = door ? flat(mul(STEEL, 0.42)) : flat(RUBBER), x0 = s * xi, x1 = s * hw, L = door ? 1 : 0;
      poly(g, [[x0, h.b1, h.a0], [x1, h.b1, h.a0], [x1, h.b1, h.a1], [x0, h.b1, h.a1]], [0, -1, 0], uvWhite, col, L);
      poly(g, [[x0, h.b0, h.a0], [x1, h.b0, h.a0], [x1, h.b1, h.a0], [x0, h.b1, h.a0]], [0, 0, 1], uvWhite, col, L);
      poly(g, [[x0, h.b0, h.a1], [x1, h.b0, h.a1], [x1, h.b1, h.a1], [x0, h.b1, h.a1]], [0, 0, -1], uvWhite, col, L);
      if (!door) poly(g, [[x0, h.b0, h.a0], [x1, h.b0, h.a0], [x1, h.b0, h.a1], [x0, h.b0, h.a1]], [0, 1, 0], uvWhite, flat(mul(STEEL, 0.55)), L);
      else { // threshold plate: ribbed steel with a yellow edge
        poly(g, [[s * (xi - 0.10), F + 0.004, h.a0], [s * (hw - 0.03), F + 0.004, h.a0], [s * (hw - 0.03), F + 0.004, h.a1], [s * (xi - 0.10), F + 0.004, h.a1]], [0, 1, 0], uvPlainTop, flat(mul(STEEL, 0.78)), 0);
        poly(g, [[s * (hw - 0.03), F + 0.004, h.a0], [s * hw, F + 0.004, h.a0], [s * hw, F + 0.004, h.a1], [s * (hw - 0.03), F + 0.004, h.a1]], [0, 1, 0], uvWhite, flat([0.85, 0.62, 0.05]), 1);
        poly(g, [[s * (xi - 0.16), F + 0.003, h.a0], [s * (xi - 0.10), F + 0.003, h.a0], [s * (xi - 0.10), F + 0.003, h.a1], [s * (xi - 0.16), F + 0.003, h.a1]], [0, 1, 0], uvWhite, flat([0.80, 0.58, 0.05]), 0); } }
    // the slanted card band above the windows, with ad cards and a line map over each door
    const sx0 = s * xi, sx1 = s * (xi - SLANT), up = [-s * SLANT, CEIL - CARD_Y, 0], ul = Math.hypot(up[0], up[1]); up[0] /= ul; up[1] /= ul; const rt = [0, 0, s];
    poly(g, [[sx0, CARD_Y, -Li], [sx1, CEIL, -Li], [sx1, CEIL, Li], [sx0, CARD_Y, Li]], [-s, -1, 0], uvCeil, flat(mul(WARM, 0.90)), 0);
    const mid = [s * (xi - SLANT / 2) - s * 0.006 * (CEIL - CARD_Y) / ul, (CARD_Y + CEIL) / 2 - 0.006 * SLANT / ul, 0];
    doorZ.forEach((z) => card(g, [mid[0], mid[1], z], rt, up, 1.22, 0.13, REG.STRIP, [1.05, 1.05, 1.05], 0, TW, TH));
    let ak = seed + (s > 0 ? 2 : 0);
    for (let k = 0; k < nd - 1; k++) { const zc = (doorZ[k] + doorZ[k + 1]) / 2, room = sp - 1.5, n = Math.max(1, Math.floor(room / 1.0)), stepz = room / n;
      for (let j = 0; j < n; j++) card(g, [mid[0], mid[1], zc + (j - (n - 1) / 2) * stepz], rt, up, 0.92, 0.24, REG['AD' + (ak++ % 4)], [1.0, 1.0, 1.0], 0, TW, TH); }
    // lit route badges outside, by the doors
    doorZ.forEach((z, k) => { if (k % 2 === (s > 0 ? 0 : 1) || nd < 4) card(g, [s * (hw + 0.008), F + 1.30, z + (DW / 2 + 0.33)], [0, 0, -s], [0, 1, 0], 0.30, 0.30, REG.BADGE, [1.5, 1.5, 1.5], 2, TW, TH); });
    // benches
    for (const b of benches) {
      const xa = Math.min(s * (xi - SEAT_D), s * xi), xb = Math.max(s * (xi - SEAT_D), s * xi), uSeat = (p) => (p[2] - b.z0) / (SEATW * 16);
      box(g, xa, xb, F + SEAT_H - 0.07, F + SEAT_H, b.z0, b.z1, bandUV(bSEAT, uSeat, (p, cc, n) => n[1] > 0.5 ? 0.04 + 0.44 * Math.abs(p[0] - s * (xi - SEAT_D)) / SEAT_D : 0.03), (p, n) => mul([1, 1, 1], n[1] > 0.5 ? 0.95 : n[1] < -0.5 ? 0.2 : 0.62), 0, s > 0 ? '+x' : '-x');
      const kx = s * (xi - SEAT_D + 0.07); poly(g, [[kx, F, b.z0], [kx, F + SEAT_H - 0.07, b.z0], [kx, F + SEAT_H - 0.07, b.z1], [kx, F, b.z1]], [-s, 0, 0], uvPlain, (p) => mul(STEEL, p[1] > F + 0.2 ? 0.22 : 0.34), 0);
      const bx0 = s * (xi - 0.10), bx1 = s * (xi - 0.035); // backrest, leaning a little
      poly(g, [[bx0, F + SEAT_H, b.z0], [bx1, F + 0.86, b.z0], [bx1, F + 0.86, b.z1], [bx0, F + SEAT_H, b.z1]], [-s, 0.1, 0], bandUV(bSEAT, uSeat, (p) => 0.54 + 0.44 * (p[1] - F - SEAT_H) / 0.43), (p) => mul([1, 1, 1], 0.74 + 0.22 * (p[1] - F - SEAT_H) / 0.43), 0);
      poly(g, [[bx1, F + 0.86, b.z0], [s * xi, F + 0.86, b.z0], [s * xi, F + 0.86, b.z1], [bx1, F + 0.86, b.z1]], [0, 1, 0], uvWhite, flat([0.10, 0.30, 0.40]), 0);
      for (const [has, z, dir] of [[b.p0, b.z0, -1], [b.p1, b.z1, 1]]) {
        const px = s * (xi - SEAT_D - 0.01);
        if (has) { const z0 = Math.min(z, z + dir * 0.03), z1 = Math.max(z, z + dir * 0.03); box(g, Math.min(px, s * xi), Math.max(px, s * xi), F, F + 1.12, z0, z1, uvPlain, (p, n) => mul(STEEL, intS(p[1]) * (Math.abs(n[2]) > 0.5 ? 0.86 : 0.6)), 0, (s > 0 ? '+x' : '-x') + '-y');
          cyl(g, 'y', F, CEIL, px, z + dir * 0.015, 0.019, 8, uvWhite, sheen(STEEL), 0, false); }
        else { poly(g, [[s * (xi - SEAT_D), F, z], [s * xi, F, z], [s * xi, F + SEAT_H, z], [s * (xi - SEAT_D), F + SEAT_H, z]], [0, 0, dir], uvWhite, flat(mul(STEEL, 0.3)), 0); }
      }
      // overhead grab bar with hangers
      const gx = s * (xi - SEAT_D - 0.01), gy = F + 1.86; cyl(g, 'z', b.z0 - (b.p0 ? 0.015 : 0), b.z1 + (b.p1 ? 0.015 : 0), gx, gy, 0.016, 8, uvWhite, sheen(STEEL), 0, false);
      const nh = Math.max(1, Math.round((b.z1 - b.z0) / 1.4)); for (let j = 0; j < nh; j++) { const z = b.z0 + (j + 0.5) * (b.z1 - b.z0) / nh; cyl(g, 'y', gy, CEIL, gx, z, 0.011, 6, uvWhite, sheen(STEEL), 0, false); }
    }
  }
  // floor (darker under the benches), ceiling with two long light strips
  grid(g, 'y', F, [0, 1, 0], -xi, xi, -Li, Li, [], [-(xi - SEAT_D + 0.07), -(xi - SEAT_D - 0.12), xi - SEAT_D - 0.12, xi - SEAT_D + 0.07], doorZ.flatMap((z) => [z - DW / 2 - 0.12, z - DW / 2, z + DW / 2, z + DW / 2 + 0.12]), uvFloor,
    (p) => { const ax = Math.abs(p[0]); let k = ax > xi - SEAT_D + 0.06 ? 0.36 : ax > xi - SEAT_D - 0.11 ? 0.66 : 0.80; if (ax > xi - SEAT_D + 0.06 && doorZ.some((z) => Math.abs(p[2] - z) <= DW / 2 + 0.001)) k = 0.80; return [k, k, k * 1.02]; }, 0);
  const LX0 = 0.50, LX1 = 0.68, cx = xi - SLANT;
  for (const [a, b, lamp] of [[-cx, -LX1, 0], [-LX1, -LX0, 1], [-LX0, LX0, 0], [LX0, LX1, 1], [LX1, cx, 0]]) {
    const y = lamp ? CEIL - 0.012 : CEIL;
    poly(g, [[a, y, -Li], [b, y, -Li], [b, y, Li], [a, y, Li]], [0, -1, 0], lamp ? uvWhite : uvCeil, lamp ? flat([2.1, 2.08, 1.95]) : (p) => mul(WARM, 0.90 + 0.10 * (1 - Math.min(1, Math.abs(Math.abs(p[0]) - 0.59) / 0.6))), 0);
    if (lamp) for (const x of [a, b]) poly(g, [[x, CEIL, -Li], [x, y, -Li], [x, y, Li], [x, CEIL, Li]], [x === a ? -1 : 1, 0, 0], uvWhite, flat([1.5, 1.48, 1.4]), 0);
  }
  // roof, underframe, end walls with a door
  const NA = 12, arc = (k) => { const a = k / NA * Math.PI; return [hw * Math.cos(a), SH + RISE * Math.sin(a)]; };
  for (let k = 0; k < NA; k++) { const a = arc(k), b = arc(k + 1), am = (k + 0.5) / NA * Math.PI, n = [Math.cos(am) * RISE, Math.sin(am) * hw, 0];
    poly(g, [[a[0], a[1], -Lb], [b[0], b[1], -Lb], [b[0], b[1], Lb], [a[0], a[1], Lb]], n, bandUV(bROOF, (p) => p[2] / 16, (p) => Math.acos(clamp(p[0] / hw, -1, 1)) / Math.PI), (p) => { const k2 = 0.66 + 0.34 * clamp((p[1] - SH) / RISE, 0, 1); return [k2, k2, k2]; }, 1); }
  for (const zc of [-carLen / 4, carLen / 4]) box(g, -0.78, 0.78, TOP - 0.10, TOP + 0.09, zc - 1.5, zc + 1.5, bandUV(bROOF, (p) => p[2] / 16, (p) => (p[0] + 0.78) / 1.56), (p, n) => mul([0.9, 0.9, 0.9], n[1] > 0.5 ? 0.95 : 0.6), 1, '-y');
  poly(g, [[-hw, SILL, -Lb], [hw, SILL, -Lb], [hw, SILL, Lb], [-hw, SILL, Lb]], [0, -1, 0], uvUnder, flat([0.14, 0.14, 0.14]), 1);
  const ED = 0.36, endHole = [{ a0: -ED, a1: ED, b0: F, b1: F + DH }], endWin = [{ a0: -0.21, a1: 0.21, b0: F + 0.95, b1: F + 1.66 }];
  for (const e of [-1, 1]) {
    grid(g, 'z', e * Lb, [0, 0, e], -hw, hw, SILL, SH, endHole, null, null, uvPlain, extC([0.8, 0.8, 0.8]), 1);
    const cap = []; for (let k = 0; k <= NA; k++) { const a = arc(k); cap.push([a[0], a[1], e * Lb]); } poly(g, cap, [0, 0, e], uvPlain, extC([0.8, 0.8, 0.8]), 1);
    grid(g, 'z', e * Li, [0, 0, -e], -xi, xi, F, CARD_Y, endHole, null, null, uvIntEnd, intC(WARM), 0);
    poly(g, [[-xi, CARD_Y, e * Li], [xi, CARD_Y, e * Li], [cx, CEIL, e * Li], [-cx, CEIL, e * Li]], [0, 0, -e], uvCeil, flat(mul(WARM, 0.93)), 0);
    const zd = e * (Lb - 0.03), zi = e * (Lb - 0.055); // the end door (fixed shut) with a window
    grid(g, 'z', zd, [0, 0, e], -ED, ED, F, F + DH, endWin, null, null, uvPlain, extC([0.72, 0.72, 0.72]), 1);
    grid(g, 'z', zi, [0, 0, -e], -ED, ED, F, F + DH, endWin, null, null, uvPlain, intC(mul(STEEL, 0.82)), 0);
    poly(g, [[0.25, F + 1.0, zi - e * 0.004], [0.31, F + 1.0, zi - e * 0.004], [0.31, F + 1.14, zi - e * 0.004], [0.25, F + 1.14, zi - e * 0.004]], [0, 0, -e], uvWhite, flat([0.25, 0.25, 0.27]), 0);
    for (const sx of [-1, 1]) { poly(g, [[sx * ED, F, e * Li], [sx * ED, F + DH, e * Li], [sx * ED, F + DH, e * Lb], [sx * ED, F, e * Lb]], [-sx, 0, 0], uvWhite, flat(mul(STEEL, 0.4)), 0); }
    poly(g, [[-ED, F + DH, e * Li], [ED, F + DH, e * Li], [ED, F + DH, e * Lb], [-ED, F + DH, e * Lb]], [0, -1, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
    poly(g, [[-ED, F, e * Li], [ED, F, e * Li], [ED, F, e * Lb], [-ED, F, e * Lb]], [0, 1, 0], uvPlainTop, flat(mul(STEEL, 0.6)), 0);
    // coupler and the bits between cars
    box(g, -0.09, 0.09, 0.50, 0.68, Math.min(e * (Lb - 0.6), e * (carLen / 2 - 0.12)), Math.max(e * (Lb - 0.6), e * (carLen / 2 - 0.12)), uvUnder, undC([1.1, 1.1, 1.1]), 1);
    box(g, -0.16, 0.16, 0.44, 0.74, Math.min(e * (carLen / 2 - 0.14), e * carLen / 2), Math.max(e * (carLen / 2 - 0.14), e * carLen / 2), uvUnder, undC([1.3, 1.3, 1.3]), 1);
    for (const sx of [-1, 1]) cyl(g, 'z', Math.min(e * Lb, e * carLen / 2), Math.max(e * Lb, e * carLen / 2), sx * 0.75, SILL + 0.08, 0.03, 6, uvWhite, undC([0.5, 0.5, 0.5]), 1, false); // hoses
    // trucks
    const tz = e * truckZ, tc = undC([1.15, 1.12, 1.08]);
    for (const az of [tz - 1.04, tz + 1.04]) {
      cyl(g, 'x', -0.72, 0.72, 0.43, az, 0.075, 8, uvUnder, undC([0.8, 0.8, 0.8]), 1, false);
      for (const sx of [-1, 1]) { const xa = sx * 0.7175, xb = sx * 0.85;
        cyl(g, 'x', Math.min(xa, xb), Math.max(xa, xb), 0.43, az, 0.43, 18, uvWhite, (p, n) => Math.abs(n[0]) > 0.5 ? (Math.hypot(p[1] - 0.43, p[2] - az) > 0.2 ? [0.13, 0.12, 0.11] : [0.2, 0.19, 0.18]) : [0.42, 0.43, 0.45], 1);
        cyl(g, 'x', Math.min(xa, sx * 0.69), Math.max(xa, sx * 0.69), 0.43, az, 0.458, 18, uvWhite, () => [0.16, 0.15, 0.14], 1);
        box(g, Math.min(sx * 0.86, sx * 1.08), Math.max(sx * 0.86, sx * 1.08), 0.31, 0.57, az - 0.17, az + 0.17, uvUnder, undC([1.5, 1.45, 1.4]), 1); } // journal box
      box(g, -0.42, 0.42, 0.20, 0.68, Math.min(az, az + (az < tz ? 0.62 : -0.62)) + (az < tz ? 0.1 : 0), Math.max(az, az + (az < tz ? 0.62 : -0.62)) - (az < tz ? 0 : 0.1), uvUnder, undC([0.95, 0.92, 0.9]), 1); // motor
    }
    for (const sx of [-1, 1]) {
      box(g, Math.min(sx * 0.90, sx * 1.04), Math.max(sx * 0.90, sx * 1.04), 0.50, 0.72, tz - 1.50, tz + 1.50, uvUnder, tc, 1); // side frame
      box(g, Math.min(sx * 0.88, sx * 1.08), Math.max(sx * 0.88, sx * 1.08), 0.40, 0.86, tz - 0.34, tz + 0.34, uvUnder, undC([0.9, 0.9, 0.9]), 1); // spring nest
      for (const dz of [-0.2, 0, 0.2]) cyl(g, 'y', 0.42, 0.84, sx * 1.10, tz + dz, 0.06, 6, uvWhite, undC([0.75, 0.72, 0.68]), 1, false);
      box(g, Math.min(sx * 1.08, sx * 1.36), Math.max(sx * 1.08, sx * 1.36), 0.20, 0.30, tz - 0.45, tz + 0.45, uvWhite, undC([0.75, 0.52, 0.30]), 1); // shoe beam
      box(g, Math.min(sx * 1.30, sx * 1.46), Math.max(sx * 1.30, sx * 1.46), 0.12, 0.17, tz - 0.14, tz + 0.14, uvWhite, undC([0.9, 0.9, 0.95]), 1); // contact shoe
    }
    box(g, -1.04, 1.04, 0.56, 0.90, tz - 0.24, tz + 0.24, uvUnder, tc, 1); // bolster
  }
  box(g, -0.32, 0.32, 0.78, SILL, -Lb + 0.3, Lb - 0.3, uvUnder, undC(), 1, '+y'); // centre sill
  { const R = rng32(seed * 31 + 5); for (const sx of [-1, 1]) { let z = -truckZ + 2.0; const zEnd = truckZ - 2.0; while (z < zEnd - 0.7) { const len = Math.min(zEnd - z, 0.8 + R() * 1.7), y0 = 0.24 + R() * 0.22, x0 = 0.36 + R() * 0.1, x1 = hw - 0.08 - R() * 0.18, tint = 0.8 + R() * 0.6;
    box(g, Math.min(sx * x0, sx * x1), Math.max(sx * x0, sx * x1), y0, SILL - 0.02, z, z + len, uvUnder, undC([tint, tint, tint * 0.98]), 1, '+y');
    if (R() < 0.6) { const xo = sx * (x1 + 0.006); poly(g, [[xo, y0 + 0.08, z + 0.1], [xo, SILL - 0.1, z + 0.1], [xo, SILL - 0.1, z + len - 0.1], [xo, y0 + 0.08, z + len - 0.1]], [sx, 0, 0], uvUnder, undC([tint * 1.5, tint * 1.5, tint * 1.5]), 1); }
    z += len + 0.12 + R() * 0.5; } } }

  // ================= door leaf (one instance per leaf) =================
  const gl = mkGeo(), LW2 = LEAFW / 2, lwin = [{ a0: -0.195, a1: 0.195, b0: F + 0.90, b1: F + 1.66 }];
  grid(gl, 'x', 0.015, [1, 0, 0], -LW2, LW2, F, F + DH, lwin, [-LW2 + 0.022, LW2 - 0.022], [BY0, BY1, F + 0.05], bandUV(bPLAIN, (p) => p[2] / 18 + 0.3, (p) => (p[1] - F) / 2.0),
    (p, n, cc) => Math.abs(cc[2]) > LW2 - 0.022 ? RUBBER : cc[1] > BY0 && cc[1] < BY1 ? [0.055, 0.058, 0.064] : mul([0.97, 0.97, 0.97], cc[1] < F + 0.05 ? 0.5 : 0.70 + 0.28 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1)), 1);
  grid(gl, 'x', -0.015, [-1, 0, 0], -LW2, LW2, F, F + DH, lwin, [-LW2 + 0.022, LW2 - 0.022], [F + 0.12], bandUV(bPLAIN, (p) => p[2] / 18 + 0.6, (p) => (p[1] - F) / 2.0),
    (p, n, cc) => Math.abs(cc[2]) > LW2 - 0.022 ? RUBBER : mul(STEEL, intS(p[1]) * (cc[1] < F + 0.12 ? 0.6 : 0.9)), 0);
  { const h = lwin[0]; for (const [pts, n] of [[[[-0.015, h.b1, h.a0], [0.015, h.b1, h.a0], [0.015, h.b1, h.a1], [-0.015, h.b1, h.a1]], [0, -1, 0]], [[[-0.015, h.b0, h.a0], [0.015, h.b0, h.a0], [0.015, h.b0, h.a1], [-0.015, h.b0, h.a1]], [0, 1, 0]],
      [[[-0.015, h.b0, h.a0], [0.015, h.b0, h.a0], [0.015, h.b1, h.a0], [-0.015, h.b1, h.a0]], [0, 0, 1]], [[[-0.015, h.b0, h.a1], [0.015, h.b0, h.a1], [0.015, h.b1, h.a1], [-0.015, h.b1, h.a1]], [0, 0, -1]]]) poly(gl, pts, n, uvWhite, flat(RUBBER), 0);
    for (const z of [-LW2, LW2]) poly(gl, [[-0.015, F, z], [0.015, F, z], [0.015, F + DH, z], [-0.015, F + DH, z]], [0, 0, Math.sign(z)], uvWhite, flat(RUBBER), 0); }

  // ================= cab end (built for the +Z end of a car; two instances) =================
  const gc = mkGeo(), CZ = Lb + 0.12, INS = 0.055;
  { const outline = [[-hw, SILL], [hw, SILL]]; for (let k = 0; k <= NA; k++) outline.push(arc(k)); // closed loop, counter-clockwise seen from +Z
    const cyc = (SILL + TOP) / 2, ins = outline.map(([x, y]) => [x * (1 - INS / hw), cyc + (y - cyc) * (1 - INS / ((TOP - SILL) / 2))]);
    const uvF = (p) => [(REG.FRONT.x + clamp((p[0] + hw) / W, 0, 1) * REG.FRONT.w) / TW, 1 - (REG.FRONT.y + (1 - clamp((p[1] - SILL) / (TOP - SILL), 0, 1)) * REG.FRONT.h) / TH];
    for (let k = 0; k < outline.length; k++) { const a = outline[k], b = outline[(k + 1) % outline.length], a2 = ins[k], b2 = ins[(k + 1) % outline.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - cyc;
      poly(gc, [[a[0], a[1], Lb], [b[0], b[1], Lb], [b2[0], b2[1], CZ], [a2[0], a2[1], CZ]], [mx, my, 0.5], uvPlain, (p, n) => mul(STEEL, n[1] > 0.5 ? 0.98 : n[1] < -0.5 ? 0.3 : 0.6 + 0.3 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1)), 1); }
    poly(gc, ins.map(([x, y]) => [x, y, CZ]), [0, 0, 1], uvF, (p) => { const k = 0.74 + 0.26 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1); return [k, k, k]; }, 1);
    const sx = hw / 1.525; card(gc, [-0.52 * sx, F + 1.955, CZ + 0.006], [1, 0, 0], [0, 1, 0], 0.235 * sx, 0.235 * sx, REG.BADGE, [1.7, 1.7, 1.7], 2, TW, TH);
    card(gc, [0.16 * sx, F + 1.955, CZ + 0.006], [1, 0, 0], [0, 1, 0], 0.98 * sx, 0.184 * sx, REG.DEST, [1.9, 1.9, 1.9], 2, TW, TH);
    box(gc, -1.22 * sx, 1.22 * sx, 0.26, 0.42, Lb - 0.25, Lb + 0.04, uvUnder, undC([0.6, 0.6, 0.62]), 1); // pilot bar
    for (const s2 of [-1, 1]) box(gc, Math.min(s2 * 0.95 * sx, s2 * 1.05 * sx), Math.max(s2 * 0.95 * sx, s2 * 1.05 * sx), 0.44, SILL, Lb - 0.2, Lb, uvUnder, undC([0.9, 0.9, 0.9]), 1);
    // the cab wall seen from inside the car, with its door
    const cabHole = [{ a0: -ED, a1: ED, b0: F, b1: F + DH }];
    grid(gc, 'z', zp, [0, 0, -1], -xi, xi, F, CARD_Y, cabHole, null, null, uvIntEnd, intC(WARM), 0);
    poly(gc, [[-xi, CARD_Y, zp], [xi, CARD_Y, zp], [cx, CEIL, zp], [-cx, CEIL, zp]], [0, 0, -1], uvCeil, flat(mul(WARM, 0.93)), 0);
    grid(gc, 'z', zp + 0.025, [0, 0, -1], -ED, ED, F, F + DH, [{ a0: -0.17, a1: 0.17, b0: F + 1.10, b1: F + 1.62 }], null, null, uvPlain, intC(mul(STEEL, 0.82)), 0);
    poly(gc, [[-0.17, F + 1.10, zp + 0.03], [0.17, F + 1.10, zp + 0.03], [0.17, F + 1.62, zp + 0.03], [-0.17, F + 1.62, zp + 0.03]], [0, 0, -1], uvWhite, (p) => p[1] > F + 1.3 ? [0.05, 0.06, 0.07] : [0.02, 0.02, 0.025], 0);
    poly(gc, [[0.24, F + 1.0, zp + 0.02], [0.30, F + 1.0, zp + 0.02], [0.30, F + 1.14, zp + 0.02], [0.24, F + 1.14, zp + 0.02]], [0, 0, -1], uvWhite, flat([0.25, 0.25, 0.27]), 0);
    for (const s2 of [-1, 1]) poly(gc, [[s2 * ED, F, zp], [s2 * ED, F + DH, zp], [s2 * ED, F + DH, zp + 0.025], [s2 * ED, F, zp + 0.025]], [-s2, 0, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
    poly(gc, [[-ED, F + DH, zp], [ED, F + DH, zp], [ED, F + DH, zp + 0.025], [-ED, F + DH, zp + 0.025]], [0, -1, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
  }

  // ================= materials =================
  const sheet = paintSheet(D, route, seed);
  const tex = new THREE.CanvasTexture(sheet.cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const uni = { uAmb: { value: 1 }, uInt: { value: 1 } };
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, fog: false });
  mat.onBeforeCompile = (sh) => { sh.uniforms.uAmb = uni.uAmb; sh.uniforms.uInt = uni.uInt;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aL;\nuniform float uAmb;\nuniform float uInt;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= aL < 0.5 ? uInt : ( aL < 1.5 ? uAmb : 1.0 );'); };
  mat.customProgramCacheKey = () => 'subway-train-v1';
  const glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.02, 0.026), transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

  // ================= meshes =================
  const group = new THREE.Group(); group.name = 'subway-train';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), P = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  const shellGeo = toGeometry(THREE, g), leafGeo = toGeometry(THREE, gl), cabGeo = toGeometry(THREE, gc);
  const shell = new THREE.InstancedMesh(shellGeo, mat, cars); shell.name = 'train-shell';
  for (let i = 0; i < cars; i++) shell.setMatrixAt(i, M.makeTranslation(0, 0, carZ(i)));
  const cab = new THREE.InstancedMesh(cabGeo, mat, 2); cab.name = 'train-cab';
  cab.setMatrixAt(0, M.makeTranslation(0, 0, carZ(cars - 1))); cab.setMatrixAt(1, M.compose(P.set(0, 0, carZ(0)), QY, S1));
  // door leaves
  const doors = [], leafInfo = [];
  for (let i = 0; i < cars; i++) for (let k = 0; k < nd; k++) for (const side of [-1, 1]) { const z = carZ(i) + doorZ[k]; doors.push({ car: i, side, z, w: DW }); for (const dir of [-1, 1]) leafInfo.push({ side, z, dir }); }
  const leaves = new THREE.InstancedMesh(leafGeo, mat, leafInfo.length); leaves.name = 'train-doors';
  const doorF = { '-1': 0, '1': 0 };
  function placeLeaves(side) { for (let n = 0; n < leafInfo.length; n++) { const L = leafInfo[n]; if (side && L.side !== side) continue; const f = doorF[L.side];
    P.set(L.side * (hw - 0.035), 0, L.z + L.dir * (LW2 + f * SLIDE)); M.compose(P, L.side > 0 ? Q.identity() : QY, S1); leaves.setMatrixAt(n, M); } leaves.instanceMatrix.needsUpdate = true; }
  placeLeaves(0);
  // glass: one fixed sheet mesh for the whole train, and one pane per leaf that rides on the leaf's own matrix
  const gg = { p: [], i: [], n: 0 }, gq = (pts) => { const b = gg.n; for (const p of pts) { gg.p.push(p[0], p[1], p[2]); gg.n++; } gg.i.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  for (let i = 0; i < cars; i++) { const z0 = carZ(i); for (const s of [-1, 1]) for (const [a, b] of wins) { const x = s * (hw - 0.03); gq([[x, WY0, z0 + a], [x, WY0, z0 + b], [x, WY1, z0 + b], [x, WY1, z0 + a]]); }
    for (const e of [-1, 1]) { const z = z0 + e * (Lb - 0.042), h = endWin[0]; gq([[h.a0, h.b0, z], [h.a1, h.b0, z], [h.a1, h.b1, z], [h.a0, h.b1, z]]); } }
  const glassGeo = new THREE.BufferGeometry(); glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(gg.p, 3)); glassGeo.setIndex(gg.i);
  const glass = new THREE.Mesh(glassGeo, glassMat); glass.name = 'train-glass'; glass.renderOrder = 2;
  const lg = lwin[0], leafGlassGeo = new THREE.BufferGeometry(); leafGlassGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, lg.b0, lg.a0, 0, lg.b0, lg.a1, 0, lg.b1, lg.a1, 0, lg.b1, lg.a0], 3)); leafGlassGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const leafGlass = new THREE.InstancedMesh(leafGlassGeo, glassMat, leafInfo.length); leafGlass.name = 'train-door-glass'; leafGlass.instanceMatrix = leaves.instanceMatrix; leafGlass.renderOrder = 2;
  // lamps: 2 white + 2 red at each end, coloured per instance
  const lampGeo = new THREE.CircleGeometry(0.072, 16), lamps = new THREE.InstancedMesh(lampGeo, lampMat, 8), lampInfo = []; lamps.name = 'train-lamps';
  { const sx = hw / 1.525; let n = 0; for (const e of [1, -1]) for (const [lx, kind] of [[-1.17, 'tail'], [-0.98, 'head'], [0.98, 'head'], [1.17, 'tail']]) {
    P.set(lx * sx * e, F + 0.34, e * (length / 2 - 0.25 + 0.12 + 0.006)); M.compose(P, e > 0 ? Q.identity() : QY, S1.set(sx, 1, 1)); S1.set(1, 1, 1); lamps.setMatrixAt(n++, M); lampInfo.push({ e, kind }); } }
  const LC = new THREE.Color();
  let lightState = { front: 1, interior: 1 };
  function applyLights() { const f = lightState.front; lampInfo.forEach((L, n) => { const on = f !== 0 && (L.kind === 'head' ? L.e === f : L.e === -f);
    if (!on) LC.setRGB(0.05, 0.05, 0.055); else if (L.kind === 'head') LC.setRGB(3.2, 3.1, 2.8); else LC.setRGB(2.8, 0.10, 0.06); lamps.setColorAt(n, LC); }); lamps.instanceColor.needsUpdate = true;
    uni.uInt.value = 0.035 + 0.965 * clamp(lightState.interior, 0, 1); }
  applyLights();
  for (const m of [shell, cab, leaves, lamps, glass, leafGlass]) { m.frustumCulled = true; m.matrixAutoUpdate = false; group.add(m); }
  for (const m of [shell, cab, leaves, lamps, leafGlass]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }

  // ================= where people can be =================
  const walk = [], seats = [], stand = [], doorways = [];
  for (let i = 0; i < cars; i++) { const z0 = carZ(i), cabLo = i === 0, cabHi = i === cars - 1, ax = xi - SEAT_D - 0.06;
    walk.push({ car: i, x0: -ax, x1: ax, z0: z0 + (cabLo ? -zp + 0.08 : -Li + 0.08), z1: z0 + (cabHi ? zp - 0.08 : Li - 0.08) });
    for (let k = 0; k < nd; k++) for (const s of [-1, 1]) doorways.push({ car: i, side: s, x0: Math.min(s * ax, s * (xi - 0.02)), x1: Math.max(s * ax, s * (xi - 0.02)), z0: z0 + doorZ[k] - DW / 2 + 0.05, z1: z0 + doorZ[k] + DW / 2 - 0.05 });
    for (const b of benches) { if ((b.end === 1 && cabHi) || (b.end === -1 && cabLo)) continue;
      for (const s of [-1, 1]) { for (let j = 0; j < b.n; j++) seats.push({ car: i, x: s * (xi - 0.26), z: z0 + b.z0 + (j + 0.5) * SEATW, face: -s });
        if (b.p0) stand.push({ car: i, x: s * (xi - SEAT_D - 0.20), z: z0 + b.z0 - 0.22 }); if (b.p1) stand.push({ car: i, x: s * (xi - SEAT_D - 0.20), z: z0 + b.z1 + 0.22 }); } } }

  function setDoors(side, f) { f = clamp(+f || 0, 0, 1); if (side === 0 || side === -1) doorF['-1'] = f; if (side === 0 || side === 1) doorF['1'] = f; placeLeaves(side); }
  function setLights(o = {}) { if (o.front !== undefined) lightState.front = Math.sign(o.front); if (o.interior !== undefined) lightState.interior = +o.interior; applyLights(); }
  function setAmbient(v) { uni.uAmb.value = Math.max(0, +v); }
  function setRoute(r = {}) { route = { ...route, ...r }; paintBadge(sheet.c, REG.BADGE, route); paintDest(sheet.c, REG.DEST, route); paintStrip(sheet.c, REG.STRIP, route); tex.needsUpdate = true; }
  function dispose() { group.removeFromParent(); for (const x of [shellGeo, leafGeo, cabGeo, glassGeo, leafGlassGeo, lampGeo, mat, glassMat, lampMat, tex]) x.dispose(); for (const m of [shell, cab, leaves, lamps, leafGlass]) m.dispose(); }

  return { group, length, carLen, width: W, floorY: F, doors, setDoors, setLights, setAmbient, setRoute, walk, seats, stand, dispose,
    // extras
    height: TOP + 0.09, cars, div, doorways, doorHeight: DH, ceilingY: CEIL, cabWallZ: zp, truckZ, meshes: { shell, cab, leaves, lamps, glass, leafGlass }, texture: tex,
    get route() { return { ...route }; }, get doorState() { return { left: doorF['-1'], right: doorF['1'] }; } };
}
