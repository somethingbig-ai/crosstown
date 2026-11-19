// train.js: the subway train, all made in code (geometry + one canvas texture sheet). See CONTRACT.md.
// buildTrain(THREE, opts) -> { group, length, carLen, width, floorY, doors, setDoors, setLights, setAmbient, setRoute, setStation, walk, seats, stand, dispose, ... }
// (setStation(0..1), new Nov 14: 1 in a lit station, 0 in the tunnel; the inside is a fifth brighter at 1. Optional: without a call it stays at 1.)
// Local frame: +Z = direction of travel, +X = right side looking forward, Y up, y = 0 at TOP OF RAIL, origin at the middle of the train.
// Car 0 is the car at the -Z end; the last car is at the +Z end. Both ends have a cab.
// Everything is UNLIT with baked vertex colours. One per-vertex number (aL) says which light a vertex takes:
//   0 = inside the car (times the interior lamps), 1 = outside (times setAmbient), 2 = glows on its own (badges, signs).
// A second per-vertex set (aN) holds the face's normal and how polished it is, for the shader's reflection of the car in its own steel (see the materials).
// Draw calls for a whole train: shell, door leaves, cab ends, lamps, fixed glass, door glass = 6.
// THE INSIDE (Nov 14, Matt: "way more like the real thing") is drawn after free-licence photos of R142 / R160 cars kept in lanes/subway/refs/car (looked at only):
// one-piece periwinkle benches with a moulded profile, stainless rail "ladders" and a pole at every bench end, a pole in the middle of every doorway, long overhead bars on
// hangers, window frames with round corners, light strips over the card band, a lit line map over each door, a red sign under the ceiling at the car's ends, a dark polished floor.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function rng32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- small geometry builder ----------
let MET = 0;      // how polished the faces now being built are (0 = matt, 1 = a mirror-bright steel tube; below 0 = a clear gloss over a colour, as on the seats and the floor): stored with each vertex's normal, used by the shader's reflection of the car
function mkGeo() { return { p: [], u: [], c: [], l: [], m: [], i: [], n: 0 }; }
function poly(g, pts, nh, uvF, colF, L) {
  const n = pts.length; let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); cx += a[0]; cy += a[1]; cz += a[2]; }
  if (nh && nx * nh[0] + ny * nh[1] + nz * nh[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
  const nl = Math.hypot(nx, ny, nz) || 1, nn = [nx / nl, ny / nl, nz / nl], cc = [cx / n, cy / n, cz / n], base = g.n;
  for (const p of pts) { const uv = uvF(p, cc, nn), col = colF(p, nn, cc); g.p.push(p[0], p[1], p[2]); g.u.push(uv[0], uv[1]); g.c.push(col[0], col[1], col[2]); g.l.push(L); g.m.push(nn[0], nn[1], nn[2], MET); g.n++; }
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
  const base = g.n, hw = w / 2, hh = h / 2, cn = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.p.push(c[0] + r[0] * a * hw + u[0] * b * hh, c[1] + r[1] * a * hw + u[1] * b * hh, c[2] + r[2] * a * hw + u[2] * b * hh);
    const cc = Array.isArray(col[0]) ? col[b > 0 ? 1 : 0] : col; g.u.push((reg.x + (a + 1) / 2 * reg.w) / TW, 1 - (reg.y + (1 - (b + 1) / 2) * reg.h) / TH); g.c.push(cc[0], cc[1], cc[2]); g.l.push(L); g.m.push(cn[0], cn[1], cn[2], MET); g.n++;
  }
  g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
// a round bar between two points (smooth-shaded by colF(p, radial normal))
function tube(g, a, b, r, segs, uvF, colF, L) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; d[0] /= l; d[1] /= l; d[2] /= l;
  let u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]; const vl = Math.hypot(v[0], v[1], v[2]); v = [v[0] / vl, v[1] / vl, v[2] / vl];
  u = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]]; const base = g.n;
  for (let k = 0; k <= segs; k++) { const t = k / segs * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), n = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
    for (const e of [a, b]) { const p = [e[0] + n[0] * r, e[1] + n[1] * r, e[2] + n[2] * r], uv = uvF(p), col = colF(p, n); g.p.push(p[0], p[1], p[2]); g.u.push(uv[0], uv[1]); g.c.push(col[0], col[1], col[2]); g.l.push(L); g.m.push(n[0], n[1], n[2], MET); g.n++; } }
  for (let k = 0; k < segs; k++) { const i = base + 2 * k; g.i.push(i, i + 2, i + 3, i, i + 3, i + 1); }
}
// a four-cornered face with its own uv and colour at every corner; nh = the way it faces
function quadC(g, P, U, C, nh, L, N) { const a = P[0], b = P[1], c = P[2], nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), base = g.n;
  for (let k = 0; k < 4; k++) { const q = N ? N[k] : nh; g.p.push(P[k][0], P[k][1], P[k][2]); g.u.push(U[k][0], U[k][1]); g.c.push(C[k][0], C[k][1], C[k][2]); g.l.push(L); g.m.push(q[0], q[1], q[2], MET); g.n++; }
  if (nx * nh[0] + ny * nh[1] + nz * nh[2] < 0) g.i.push(base, base + 2, base + 1, base, base + 3, base + 2); else g.i.push(base, base + 1, base + 2, base, base + 2, base + 3); }
function fan(g, apex, pts, nh, uvF, colF, L) { for (let k = 0; k < pts.length - 1; k++) poly(g, [apex, pts[k], pts[k + 1]], nh, uvF, colF, L); }
// the outline of a rectangle with round corners, as [a, b] points; and a flat ring between two such outlines on the plane x = const (a = z, b = y)
function rrect(ca, cb, ha, hb, r, n) { const o = []; r = Math.max(0.001, Math.min(r, ha, hb)); for (const [sa, sb, t0] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) for (let k = 0; k <= n; k++) { const t = (t0 + k / n) * Math.PI / 2; o.push([ca + sa * (ha - r) + r * Math.cos(t), cb + sb * (hb - r) + r * Math.sin(t)]); } return o; }
function ringP(g, pt, O, I, nh, uvF, colF, L) { const n = O.length; for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; poly(g, [pt(O[k]), pt(O[k2]), pt(I[k2]), pt(I[k])], nh, uvF, colF, L); } }
function ringX(g, x, O, I, nh, uvF, colF, L) { ringP(g, (q) => [x, q[1], q[0]], O, I, nh, uvF, colF, L); }
function toGeometry(THREE, g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3)); geo.setAttribute('aL', new THREE.Float32BufferAttribute(g.l, 1)); geo.setAttribute('aN', new THREE.Float32BufferAttribute(g.m, 4));
  geo.setIndex(g.n > 65535 ? new THREE.Uint32BufferAttribute(g.i, 1) : new THREE.Uint16BufferAttribute(g.i, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
}

// ---------- the texture sheet ----------
const TW = 2048, TH = 2048;
const BANDS = {}; { let y = 0; for (const [k, h, pad] of [['EXT', 352, 8], ['PLAIN', 40, 8], ['ROOF', 40, 8], ['UNDER', 40, 8], ['FLOOR', 128, 28], ['SEAT', 112, 28], ['INTW', 240, 28], ['CEIL', 96, 28]]) { y += pad; BANDS[k] = [y, h, pad]; y += h + pad; } }
// (each band has its own colours carried `pad` pixels past its edges: the small mip levels of a band seen at a flat angle must not pick up its neighbour. 1336 px in all.)
const REG = { FRONT: { x: 4, y: 1384, w: 608, h: 540 }, BADGE: { x: 624, y: 1384, w: 256, h: 256 }, DEST: { x: 896, y: 1384, w: 640, h: 120 }, WHITE: { x: 1552, y: 1384, w: 64, h: 64 }, ISIGN: { x: 1640, y: 1388, w: 392, h: 112 },
  STRIP: { x: 896, y: 1520, w: 1136, h: 120 }, AD0: { x: 624, y: 1656, w: 704, h: 184 }, AD1: { x: 1336, y: 1656, w: 704, h: 184 }, AD2: { x: 624, y: 1852, w: 704, h: 184 }, AD3: { x: 1336, y: 1852, w: 704, h: 184 }, TREAD: { x: 8, y: 1936, w: 600, h: 100 } };
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
function paintStrip(c, r, route) { // the lit line map over each door: a black board, the line in the route's colour, a lamp for every stop (invented stops; our own look)
  c.fillStyle = '#17181b'; c.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); rr(c, r.x + 5, r.y + 5, r.w - 10, r.h - 10, 9); c.fillStyle = '#050506'; c.fill();
  paintBadgeMini(c, r.x + 24, r.y + 24, 72, route);
  const x0 = r.x + 150, x1 = r.x + r.w - 190, y = r.y + 42, NEXT = 3; c.strokeStyle = route.color; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  STOPS.forEach((s, k) => { const x = x0 + (x1 - x0) * k / (STOPS.length - 1), on = k >= NEXT, nx = k === NEXT;
    if (on) { const g = c.createRadialGradient(x, y, 2, x, y, nx ? 24 : 17); g.addColorStop(0, nx ? 'rgba(120,255,140,0.75)' : 'rgba(255,190,60,0.6)'); g.addColorStop(1, 'rgba(255,170,30,0)'); c.fillStyle = g; c.fillRect(x - 26, y - 26, 52, 52); }
    c.fillStyle = !on ? '#4a3d18' : nx ? '#b6ffbe' : '#ffc23a'; c.beginPath(); c.arc(x, y, nx ? 10 : 8, 0, 7); c.fill();
    c.font = (nx ? '700' : '500') + ' 19px "Helvetica Neue", Arial, sans-serif'; c.fillStyle = !on ? '#77797d' : nx ? '#ffffff' : '#d5d7da'; c.fillText(s, x, y + 38); });
  c.textAlign = 'left'; c.font = '700 17px "Helvetica Neue", Arial, sans-serif'; c.fillStyle = '#ff5a3c'; c.fillText('NEXT STOP', x1 + 44, r.y + 36); c.font = '700 24px "Helvetica Neue", Arial, sans-serif'; c.fillStyle = '#ffc23a'; c.fillText(STOPS[NEXT], x1 + 44, r.y + 70);
}
function paintISign(c, r, route) { // the sign under the ceiling at the car's ends: red lamps on black
  c.fillStyle = '#050505'; c.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); const label = String(route.label ?? '?').slice(0, 3), text = String(route.dest || 'LOCAL').toUpperCase().slice(0, 12);
  c.textBaseline = 'middle'; c.textAlign = 'center'; c.strokeStyle = '#ff3a22'; c.lineWidth = 5; c.beginPath(); c.arc(r.x + 58, r.y + r.h / 2, 30, 0, 7); c.stroke(); c.fillStyle = '#ff3a22'; c.font = '700 38px "DejaVu Sans Mono", "Courier New", monospace'; c.fillText(label, r.x + 58, r.y + r.h / 2 + 3);
  let px = 46; c.font = `700 ${px}px "DejaVu Sans Mono", "Courier New", monospace`; const tw = c.measureText(text).width; if (tw > r.w - 130) { px = Math.floor(px * (r.w - 130) / tw); c.font = `700 ${px}px "DejaVu Sans Mono", "Courier New", monospace`; } c.fillText(text, r.x + 100 + (r.w - 110) / 2, r.y + r.h / 2 + 3);
  c.fillStyle = 'rgba(0,0,0,0.45)'; for (let y = r.y; y < r.y + r.h; y += 4) c.fillRect(r.x, y, r.w, 1.3); for (let x = r.x; x < r.x + r.w; x += 4) c.fillRect(x, r.y, 1.3, r.h);
}
function paintBadgeMini(c, x, y, s, route) { rr(c, x, y, s, s, s * 0.2); c.fillStyle = route.color; c.fill(); c.fillStyle = lumOf(route.color) > 0.42 ? '#111' : '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; const label = String(route.label ?? '?').slice(0, 3); c.font = `800 ${Math.round(s * (label.length > 1 ? 0.46 : 0.66))}px "Helvetica Neue", Arial, sans-serif`; c.fillText(label, x + s / 2, y + s / 2 + s * 0.04); }
const ADS = []; for (const y of [REG.AD0.y, REG.AD2.y]) for (const j of [0, 1, 2]) ADS.push({ x: 624 + j * 472 + 3, y, w: 466, h: 184 });      // six cards, 28 by 11 inches like the real ones
function paintAds(c) { // eight invented advert cards (no real brands), each with a picture panel, a headline and small print, in a thin frame
  const A = [['#14203a', '#f6ead0', '#f2d9a0', 'NIGHTOWL COFFEE', 'open until the last train', 'Georgia, serif'], ['#0f7f86', '#ffffff', '#c8f0ee', 'LEARN TO SAIL', 'Harbor Point School', '"Helvetica Neue", Arial, sans-serif'], ['#f0b429', '#3a2206', '#6a3d0a', 'Bagel & Bean Co.', 'fresh since this morning', 'Georgia, serif'], ['#f4f2ea', '#222222', '#c23b22', 'POEMS UNDERGROUND', 'every stop is a rhyme', 'Georgia, serif'],
    ['#7a1f3d', '#ffe9d6', '#ffb38a', 'Dr. Zee Skin Care', 'walk in, glow out', '"Helvetica Neue", Arial, sans-serif'], ['#e9eef5', '#17325e', '#3d7bd9', 'CITY NIGHT COLLEGE', 'classes start monthly', '"Helvetica Neue", Arial, sans-serif'], ['#1d1d1f', '#ffd400', '#ffffff', 'BOLT MOVERS', 'we carry the city', '"Helvetica Neue", Arial, sans-serif'], ['#2f6b3a', '#f3f7e8', '#cfe6a8', 'Greenway Market', 'open 7 days', 'Georgia, serif']];
  const R = rng32(4711);
  ADS.forEach((r, k) => { const [bg, fg, ac, head, sub, font] = A[[0, 1, 2, 3, 5, 7][k]]; c.save(); c.beginPath(); c.rect(r.x - 3, r.y - 2, r.w + 6, r.h + 4); c.clip(); c.fillStyle = bg; c.fillRect(r.x - 3, r.y - 2, r.w + 6, r.h + 4);
    const pw = r.w * 0.36, g = c.createLinearGradient(r.x, r.y, r.x + pw, r.y + r.h); g.addColorStop(0, ac); g.addColorStop(1, fg); c.fillStyle = g; c.fillRect(r.x + 8, r.y + 10, pw, r.h - 20);      // the "picture"
    { const X0 = r.x + 8, Y0 = r.y + 10, PH = r.h - 20; c.save(); c.beginPath(); c.rect(X0, Y0, pw, PH); c.clip(); const kind = k % 3;
      if (kind === 0) { const g2 = c.createLinearGradient(0, Y0, 0, Y0 + PH); g2.addColorStop(0, '#20254a'); g2.addColorStop(0.55, '#b0566a'); g2.addColorStop(0.8, '#f0a060'); g2.addColorStop(1, '#f6d28a'); c.fillStyle = g2; c.fillRect(X0, Y0, pw, PH);      /* a skyline at dusk */
        let x = X0 - 4; while (x < X0 + pw) { const w = 8 + R() * 18, hh = PH * (0.25 + R() * 0.55); c.fillStyle = `rgb(${18 + R() * 20 | 0},${20 + R() * 18 | 0},${34 + R() * 22 | 0})`; c.fillRect(x, Y0 + PH - hh, w, hh); for (let yy = Y0 + PH - hh + 4; yy < Y0 + PH - 3; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (R() < 0.35) { c.fillStyle = R() < 0.8 ? 'rgba(255,214,130,0.9)' : 'rgba(200,230,255,0.8)'; c.fillRect(xx, yy, 2, 2.5); } x += w + R() * 3; } }
      else if (kind === 1) { const g2 = c.createLinearGradient(0, Y0, 0, Y0 + PH); g2.addColorStop(0, '#7fc4e8'); g2.addColorStop(0.5, '#d8eef6'); g2.addColorStop(0.52, '#1d6f8c'); g2.addColorStop(1, '#0c3a52'); c.fillStyle = g2; c.fillRect(X0, Y0, pw, PH);      /* a boat on the water */
        for (let j = 0; j < 60; j++) { c.fillStyle = `rgba(255,255,255,${0.08 + R() * 0.25})`; c.fillRect(X0 + R() * pw, Y0 + PH * (0.55 + R() * 0.45), 4 + R() * 16, 1); } const bx = X0 + pw * 0.55, by = Y0 + PH * 0.56; c.fillStyle = '#f8f8f4'; c.beginPath(); c.moveTo(bx, by - PH * 0.42); c.lineTo(bx + pw * 0.2, by - 4); c.lineTo(bx, by - 4); c.fill(); c.fillStyle = '#e8d8c0'; c.beginPath(); c.moveTo(bx - 3, by - PH * 0.34); c.lineTo(bx - 3, by - 4); c.lineTo(bx - pw * 0.13, by - 4); c.fill(); c.fillStyle = '#7a2e22'; c.beginPath(); c.moveTo(bx - pw * 0.17, by - 2); c.lineTo(bx + pw * 0.22, by - 2); c.lineTo(bx + pw * 0.16, by + 7); c.lineTo(bx - pw * 0.12, by + 7); c.fill();
        c.fillStyle = 'rgba(255,250,220,0.9)'; c.beginPath(); c.arc(X0 + pw * 0.2, Y0 + PH * 0.2, 9, 0, 7); c.fill(); }
      else { const g2 = c.createRadialGradient(X0 + pw * 0.4, Y0 + PH * 0.4, 4, X0 + pw * 0.5, Y0 + PH * 0.5, pw * 0.8); g2.addColorStop(0, '#8a5a34'); g2.addColorStop(1, '#2a160c'); c.fillStyle = g2; c.fillRect(X0, Y0, pw, PH);      /* something to eat on a table */
        const cx2 = X0 + pw * 0.5, cy2 = Y0 + PH * 0.55; c.fillStyle = '#f2ede2'; c.beginPath(); c.ellipse(cx2, cy2 + 6, pw * 0.42, PH * 0.30, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(0,0,0,0.18)'; c.beginPath(); c.ellipse(cx2 + 3, cy2 + 9, pw * 0.30, PH * 0.20, 0, 0, 7); c.fill();
        const g3 = c.createRadialGradient(cx2 - 8, cy2 - 8, 3, cx2, cy2, pw * 0.3); g3.addColorStop(0, '#f0c078'); g3.addColorStop(0.6, '#c8873a'); g3.addColorStop(1, '#8a5420'); c.fillStyle = g3; c.beginPath(); c.ellipse(cx2, cy2, pw * 0.28, PH * 0.24, 0, 0, 7); c.fill(); c.fillStyle = '#5a3414'; c.beginPath(); c.ellipse(cx2, cy2 - 1, pw * 0.08, PH * 0.06, 0, 0, 7); c.fill(); for (let j = 0; j < 50; j++) { c.fillStyle = R() < 0.5 ? 'rgba(250,240,210,0.8)' : 'rgba(40,24,10,0.7)'; const a2 = R() * 6.28, rr2 = 0.4 + R() * 0.55; c.fillRect(cx2 + Math.cos(a2) * pw * 0.26 * rr2, cy2 + Math.sin(a2) * PH * 0.22 * rr2, 1.6, 1.2); } }
      for (let j = 0; j < 900; j++) { c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; c.fillRect(X0 + R() * pw, Y0 + R() * PH, 1.5, 1.5); } c.restore(); } c.fillStyle = bg; c.fillRect(r.x + 8 + pw, r.y, r.w, r.h);
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = fg; let px = 36; c.font = `800 ${px}px ${font}`; const room = r.w - pw - 30, tw = c.measureText(head).width; if (tw > room) { px = Math.floor(px * room / tw); c.font = `800 ${px}px ${font}`; } c.fillText(head, r.x + pw + 20, r.y + 46);
    c.fillStyle = ac; c.font = `italic 500 17px ${font}`; c.fillText(sub, r.x + pw + 20, r.y + 78); c.globalAlpha = 0.55; c.fillStyle = fg; for (let j = 0; j < 9; j++) c.fillRect(r.x + pw + 20, r.y + 98 + j * 5.2, room * (0.62 - 0.11 * (j % 3)), 1.6); c.globalAlpha = 1;
    c.fillStyle = ac; rr(c, r.x + r.w - 64, r.y + r.h - 44, 50, 30, 6); c.fill(); { const g2 = c.createLinearGradient(0, r.y, 0, r.y + r.h); g2.addColorStop(0, 'rgba(255,255,255,0.16)'); g2.addColorStop(0.35, 'rgba(255,255,255,0.02)'); g2.addColorStop(1, 'rgba(0,0,0,0.10)'); c.fillStyle = g2; c.fillRect(r.x - 3, r.y - 2, r.w + 6, r.h + 4); const g4 = c.createLinearGradient(r.x + r.w * 0.5, r.y, r.x + r.w * 0.8, r.y + r.h); g4.addColorStop(0, 'rgba(255,255,255,0)'); g4.addColorStop(0.45, 'rgba(255,255,255,0.20)'); g4.addColorStop(0.6, 'rgba(255,255,255,0.03)'); g4.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g4; c.fillRect(r.x - 3, r.y - 2, r.w + 6, r.h + 4); } c.restore();
    c.strokeStyle = '#3a3d42'; c.lineWidth = 4; c.strokeRect(r.x - 1.5, r.y + 1.5, r.w + 3, r.h - 3); });
}

// Nov 17: every train painted its whole 2048 x 2048 sheet (brushed steel, speckle, floor, seats, adverts: 30 to 45 ms), two to four trains a station, on the frames in which he steps onto the
// stair. Only the route badge, the destination, the strip and the inside sign differ from train to train (and setRoute repaints just those). The sheet without them is painted once for each
// kind of car and copied (a few ms); the trains of a kind then share one pattern of speckle, which nobody can tell. ?subsheet=0 = every train its own, as it was.
const BASES = new Map(), SHARE = !(typeof location !== 'undefined' && /[?&]subsheet=0(&|$)/.test(location.search));
function paintSheet(D, route, seed) {
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH; const c = cv.getContext('2d'); const key = SHARE ? JSON.stringify(D) : null; let base = SHARE ? BASES.get(key) : null;      /* (D is the car's measures: one key for each kind of car) */
  if (!base) { base = paintBase(D, SHARE ? 7 : seed).cv; if (SHARE) BASES.set(key, base); }
  c.drawImage(base, 0, 0); paintBadge(c, REG.BADGE, route); paintDest(c, REG.DEST, route); paintStrip(c, REG.STRIP, route); paintISign(c, REG.ISIGN, route);
  return { cv, c };
}
function paintBase(D, seed) {
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
  // FLOOR: dark speckled sheet, polished: the ceiling lights lie on it as broad broken streaks down the aisle (v runs across the car)
  { const [y0, h] = BANDS.FLOOR; c.fillStyle = '#2f2b27'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 30000, R, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.4)', 'rgba(170,160,150,0.10)', 'rgba(210,180,140,0.09)', 'rgba(120,130,150,0.09)', 'rgba(0,0,0,0.3)']);
    for (let k = 0; k < 70; k++) { c.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,110,100'},${0.04 + R() * 0.07})`; const x = R() * TW; c.beginPath(); c.ellipse(x, y0 + h / 2 + (R() - 0.5) * h * 0.7, 14 + R() * 40, 3 + R() * 8, 0, 0, 7); c.fill(); }
    { const g = c.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(0.2, 'rgba(0,0,0,0.12)'); g.addColorStop(0.36, 'rgba(150,140,128,0.0)'); g.addColorStop(0.5, 'rgba(150,140,128,0.02)'); g.addColorStop(0.64, 'rgba(150,140,128,0.0)'); g.addColorStop(0.8, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.30)'); c.fillStyle = g; c.fillRect(0, y0, TW, h); }
    for (let k = 0; k < 420; k++) { const x = R() * TW, yy = y0 + h * (0.5 + (R() - 0.5) * 0.9), w = 6 + R() * 46; c.fillStyle = `rgba(${R() < 0.5 ? '190,180,165' : '0,0,0'},${0.03 + R() * 0.06})`; c.fillRect(x, yy, w, 1); }
    for (let k = 0; k < 46; k++) { const x = R() * TW, yy = y0 + h * (0.5 + (R() - 0.5) * 0.8), r = 1.5 + R() * 2.5; c.fillStyle = `rgba(${R() < 0.6 ? '8,8,8' : '120,112,100'},${0.25 + R() * 0.3})`; c.beginPath(); c.ellipse(x, yy, r * 1.6, r * 0.5, 0, 0, 7); c.fill(); } }
  // SEAT: sixteen seat widths across; top row = the top of the backrest, down the back, the crease, the pan, the front lip (the moulded profile unrolled)
  { const [y0, h] = BANDS.SEAT; c.fillStyle = '#6274a4'; c.fillRect(0, y0, TW, h);      // car look 2: hard moulded plastic: one flat colour (the shape and the gloss are the geometry's and the shader's), a darker crease, a seam between seats, and years of scuffs
    const soft = (f, hw2, rgb, a) => { const g = c.createLinearGradient(0, y0 + (f - hw2) * h, 0, y0 + (f + hw2) * h); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.fillRect(0, y0 + (f - hw2) * h, TW, 2 * hw2 * h); };
    soft(0.53, 0.05, '20,24,60', 0.26); soft(0.97, 0.05, '20,24,60', 0.30);
    for (let k = 0; k <= 16; k++) { const x = k * TW / 16; const g = c.createLinearGradient(x - 9, 0, x + 9, 0); g.addColorStop(0, 'rgba(16,20,50,0)'); g.addColorStop(0.5, 'rgba(16,20,50,0.0)'); g.addColorStop(1, 'rgba(16,20,50,0)'); c.fillStyle = g; c.fillRect(x - 9, y0, 18, h); c.fillStyle = 'rgba(10,12,30,0.16)'; c.fillRect(x - 1, y0, 1.5, h); }
    for (let k = 0; k < 520; k++) { const pan = R() < 0.65, fy = pan ? 0.60 + R() * 0.30 : 0.10 + R() * 0.38, x = R() * TW, w = 3 + R() * 16; c.fillStyle = `rgba(${R() < 0.6 ? '225,230,245' : '20,24,50'},${0.02 + R() * 0.05})`; c.save(); c.translate(x, y0 + fy * h); c.rotate((R() - 0.5) * 1.6); c.fillRect(-w / 2, 0, w, 1); c.restore(); }
    for (let k = 0; k < 40; k++) { const x = R() * TW, yy = y0 + (0.58 + R() * 0.3) * h, r = 6 + R() * 16, g = c.createRadialGradient(x, yy, 0, x, yy, r); g.addColorStop(0, 'rgba(30,34,60,0.10)'); g.addColorStop(1, 'rgba(30,34,60,0)'); c.fillStyle = g; c.fillRect(x - r, yy - r, 2 * r, 2 * r); }
    speckle(c, 0, y0, TW, h, 3000, R, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.05)']); }
  // INTW: the inside wall from the floor up to the card band: satin grey panels; the texture is one door spacing wide with the door in the middle, so the piers
  // between door and window come at fixed places: a framed poster on each (an invented map, an invented notice)
  { const [y0, h] = BANDS.INTW, Y = (m) => y0 + (1 - m / 1.92) * h, U = (m) => m / D.sp * TW;
    c.fillStyle = lin(y0, y0 + h, [[0, '#c9cccf'], [0.55, '#c1c5c8'], [1, '#a9adb1']]); c.fillRect(0, y0, TW, h); brushed(c, 0, y0, TW, h, 5200, R, 0.5);
    // brushed steel takes the car's lights as soft upright streaks and a bright band high on the wall
    for (let k = 0; k < 150; k++) { const x = R() * TW, w = 8 + R() * 70, a = 0.02 + R() * 0.05, lt = R() < 0.6, g = c.createLinearGradient(x - w, 0, x + w, 0), rgb = lt ? '255,255,255' : '40,46,56'; g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.fillRect(x - w, y0, 2 * w, h); }
    { const g = c.createLinearGradient(0, Y(1.92), 0, Y(1.45)); g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, Y(1.92), TW, Y(1.45) - Y(1.92)); const g2 = c.createLinearGradient(0, Y(1.35), 0, Y(0.6)); g2.addColorStop(0, 'rgba(30,36,48,0)'); g2.addColorStop(0.5, 'rgba(30,36,48,0.16)'); g2.addColorStop(1, 'rgba(30,36,48,0)'); c.fillStyle = g2; c.fillRect(0, Y(1.35), TW, Y(0.6) - Y(1.35)); }
    c.fillStyle = 'rgba(40,42,46,0.30)'; c.fillRect(0, Y(0.10), TW, y0 + h - Y(0.10)); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, Y(0.10) - 1, TW, 2);
    for (const sd of [-1, 1]) { const xd = TW / 2 + sd * U(D.DW / 2 + 0.06), xc = TW / 2 + sd * U(D.DW / 2 + 0.06 + D.pier / 2), xw = TW / 2 + sd * U(D.DW / 2 + 0.06 + D.pier);
      for (const x of [xd, xw]) { c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(x - 1, y0, 2, h); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 1, y0, 1, h); }
      const pw = U(Math.min(0.52, D.pier - 0.10)), px = xc - pw / 2, py = Y(1.66), ph = Y(0.90) - py;
      c.fillStyle = '#eef0f1'; c.fillRect(px - 4, py - 4, pw + 8, ph + 8); c.strokeStyle = 'rgba(60,64,70,0.8)'; c.lineWidth = 1; c.strokeRect(px - 4.5, py - 4.5, pw + 9, ph + 9); c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
      if (sd < 0) { c.fillStyle = '#e8e2cf'; c.fillRect(px, py, pw, ph); c.fillStyle = '#a9c8dd'; c.beginPath(); c.moveTo(px, py + ph * 0.55); c.bezierCurveTo(px + pw * 0.3, py + ph * 0.45, px + pw * 0.25, py + ph * 0.9, px + pw * 0.5, py + ph); c.lineTo(px, py + ph); c.fill(); c.beginPath(); c.moveTo(px + pw, py + ph * 0.1); c.bezierCurveTo(px + pw * 0.7, py + ph * 0.3, px + pw * 0.85, py + ph * 0.6, px + pw * 0.7, py + ph); c.lineTo(px + pw, py + ph); c.fill();
        const cols = ['#d8372f', '#1f8a4c', '#2456b8', '#f36a1c', '#f2c21a', '#a23ea8', '#7a7d80']; c.lineWidth = 2; c.lineJoin = 'round'; for (let k = 0; k < 7; k++) { c.strokeStyle = cols[k]; c.beginPath(); let x = px + pw * (0.2 + R() * 0.6), y = py + 4; c.moveTo(x, y); while (y < py + ph - 4) { y += 4 + R() * 9; x = Math.max(px + 3, Math.min(px + pw - 3, x + (R() - 0.5) * 16)); c.lineTo(x, y); if (R() < 0.3) { c.lineTo(x, (y += 5)); } } c.stroke(); }
        for (let k = 0; k < 150; k++) { const x = px + 3 + R() * (pw - 6), y = py + 10 + R() * (ph - 14); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 1.5, 0, 7); c.fill(); c.strokeStyle = '#222'; c.lineWidth = 0.7; c.stroke(); if (R() < 0.6) { c.fillStyle = 'rgba(30,30,34,0.75)'; c.fillRect(x + 2.5, y - 0.5, 3 + R() * 7, 1); } }
        c.fillStyle = '#17181b'; c.fillRect(px, py, pw, 9); c.fillStyle = '#fff'; c.font = '800 6px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('CITY RAIL MAP', px + 3, py + 5);
        c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(px + 2, py + ph - 26, pw * 0.42, 24); c.strokeStyle = '#555'; c.lineWidth = 0.6; c.strokeRect(px + 2, py + ph - 26, pw * 0.42, 24); for (let k = 0; k < 5; k++) { c.fillStyle = ['#d8372f', '#1f8a4c', '#2456b8', '#f36a1c', '#a23ea8'][k]; c.fillRect(px + 4, py + ph - 23 + k * 4.3, 5, 2); c.fillStyle = 'rgba(30,30,34,0.7)'; c.fillRect(px + 11, py + ph - 22.6 + k * 4.3, pw * 0.26, 1); } }
      else { c.fillStyle = '#f1f0ea'; c.fillRect(px, py, pw, ph); c.fillStyle = '#2b4a78'; c.fillRect(px, py, pw, 15); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '800 9px "Helvetica Neue", Arial, sans-serif'; c.fillText('RIDE WITH CARE', xc, py + 8); c.fillStyle = '#9fb3c4'; c.fillRect(px + 5, py + 20, pw - 10, 18); c.fillStyle = 'rgba(40,44,52,0.7)'; for (let k = 0; k < 22; k++) c.fillRect(px + 6, py + 43 + k * 3.4, pw - 12 - (k % 4) * 6, 1.1); c.fillStyle = '#c23b22'; c.fillRect(px + 6, py + ph - 16, pw * 0.4, 9); }
      { const g = c.createLinearGradient(px, py, px + pw, py + ph * 0.7); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.22)'); g.addColorStop(0.62, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(px, py, pw, ph); }
      c.restore();
      // a small black instruction label with a red square, by the door
      const lx = xd + sd * U(0.07) - (sd < 0 ? U(0.11) : 0), ly = Y(1.36); c.fillStyle = '#121315'; c.fillRect(lx, ly, U(0.11), Y(1.27) - ly); c.fillStyle = '#d8372f'; c.fillRect(lx + 2, ly + 2, 5, 5); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(lx + 9, ly + 3, U(0.11) - 12, 1.5); c.fillRect(lx + 2, ly + 9, U(0.11) - 5, 1.2); }
    c.fillStyle = 'rgba(0,0,0,0.10)'; c.fillRect(0, Y(1.80), TW, 2);
    // car look 2: every panel takes the light a little differently; screws down the seams; scuffs and shoe marks low down, hand grime by the doors
    { const xs = [0]; for (const sd of [-1, 1]) xs.push(TW / 2 + sd * U(D.DW / 2 + 0.06), TW / 2 + sd * U(D.DW / 2 + 0.06 + D.pier)); xs.push(TW); xs.sort((p, q) => p - q);
      for (let k = 0; k < xs.length - 1; k++) { const a = (R() - 0.5) * 0.09; c.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(20,24,32,${-a})`; c.fillRect(xs[k], y0, xs[k + 1] - xs[k], h); }
      for (const x of xs.slice(1, -1)) for (let m = 0.16; m < 1.9; m += 0.19) { c.fillStyle = 'rgba(24,26,30,0.7)'; c.beginPath(); c.arc(x + 6, Y(m), 2.5, 0, 7); c.fill(); c.fillStyle = 'rgba(150,154,160,0.9)'; c.beginPath(); c.arc(x + 6, Y(m), 1.6, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x + 4.6, Y(m) - 1.9, 1.5, 1.5); }
      for (const m of [0.15, 1.77]) for (let x = 6; x < TW; x += U(0.115)) { if (Math.abs(x - TW / 2) < U(D.DW / 2 + 0.07)) continue; c.fillStyle = 'rgba(24,26,30,0.7)'; c.beginPath(); c.arc(x, Y(m), 2.5, 0, 7); c.fill(); c.fillStyle = 'rgba(150,154,160,0.9)'; c.beginPath(); c.arc(x, Y(m), 1.6, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x - 1.4, Y(m) - 1.9, 1.5, 1.5); }
      { const ww = U((D.sp - D.DW - 2 * (D.pier + 0.11)) / 2 + 0.13); for (const x of [ww, TW - ww]) { c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillRect(x - 1, y0, 2, h); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 1, y0, 1, h); } c.fillStyle = 'rgba(0,0,0,0.32)'; c.fillRect(0, Y(1.82), TW, 2); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(0, Y(1.82) + 2, TW, 1.5); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, Y(0.78), TW, 2); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, Y(0.78) + 2, TW, 1.5); }
      for (let k = 0; k < 260; k++) { const x = R() * TW, m = R() * R() * 0.5, w = 4 + R() * 30; c.fillStyle = `rgba(${R() < 0.7 ? '25,24,22' : '235,235,235'},${0.04 + R() * 0.10})`; c.save(); c.translate(x, Y(m)); c.rotate((R() - 0.5) * 0.5); c.fillRect(-w / 2, 0, w, 1 + R() * 1.6); c.restore(); }
      { const g = c.createLinearGradient(0, Y(0.32), 0, Y(0)); g.addColorStop(0, 'rgba(38,34,28,0)'); g.addColorStop(1, 'rgba(38,34,28,0.34)'); c.fillStyle = g; c.fillRect(0, Y(0.32), TW, Y(0) - Y(0.32)); }
      for (const sd of [-1, 1]) for (let k = 0; k < 26; k++) { const x = TW / 2 + sd * U(D.DW / 2 + 0.08 + R() * 0.16), y = Y(0.95 + R() * 0.6), r = 5 + R() * 13, g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(46,42,36,0.085)'); g.addColorStop(1, 'rgba(46,42,36,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); } }
    // the door leaf's inside face (drawn in the door's hole in this picture: one leaf wide, at the middle): brushed steel, a rubbed band at hand height, scuffs at the foot, a notice under the window
    { const xl = TW / 2 - U(0.3225), wl = U(0.645), xm = TW / 2; c.save(); c.beginPath(); c.rect(TW / 2 - U(D.DW / 2 + 0.05), y0, U(D.DW + 0.10), h); c.clip();
      c.fillStyle = lin(y0, y0 + h, [[0, '#c6c9cc'], [0.6, '#bcc0c4'], [1, '#a2a6aa']]); c.fillRect(TW / 2 - U(D.DW / 2 + 0.05), y0, U(D.DW + 0.10), h); brushed(c, TW / 2 - U(D.DW / 2 + 0.05), y0, U(D.DW + 0.10), h, 700, R, 0.4);
      for (let k = 0; k < 40; k++) { const x = xl + R() * wl, w = 5 + R() * 26, a = 0.03 + R() * 0.05, g = c.createLinearGradient(x - w, 0, x + w, 0), rgb = R() < 0.55 ? '255,255,255' : '40,46,56'; g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.fillRect(x - w, y0, 2 * w, h); }
      { const g = c.createLinearGradient(0, Y(1.25), 0, Y(0.95)); g.addColorStop(0, 'rgba(60,56,50,0)'); g.addColorStop(0.5, 'rgba(60,56,50,0.10)'); g.addColorStop(1, 'rgba(60,56,50,0)'); c.fillStyle = g; c.fillRect(xl, Y(1.25), wl, Y(0.95) - Y(1.25)); }
      for (let k = 0; k < 70; k++) { const x = xl + R() * wl, m = R() * R() * 0.45, w = 4 + R() * 22; c.fillStyle = `rgba(${R() < 0.75 ? '25,24,22' : '240,240,240'},${0.05 + R() * 0.12})`; c.save(); c.translate(x, Y(m)); c.rotate((R() - 0.5) * 0.7); c.fillRect(-w / 2, 0, w, 1 + R() * 1.5); c.restore(); }
      { const g = c.createLinearGradient(0, Y(0.26), 0, Y(0)); g.addColorStop(0, 'rgba(38,34,28,0)'); g.addColorStop(1, 'rgba(38,34,28,0.36)'); c.fillStyle = g; c.fillRect(xl, Y(0.26), wl, Y(0) - Y(0.26)); }
      c.fillStyle = 'rgba(30,34,40,0.10)'; c.fillRect(xl + 6, Y(0.27), wl - 12, Y(0.03) - Y(0.27)); c.strokeStyle = 'rgba(20,22,26,0.5)'; c.lineWidth = 1; c.strokeRect(xl + 6.5, Y(0.27) + 0.5, wl - 13, Y(0.03) - Y(0.27) - 1); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(xl + 6, Y(0.27) + 1.5, wl - 12, 1); for (let x = xl + 14; x < xl + wl - 10; x += 28) for (const m of [0.245, 0.055]) { c.fillStyle = 'rgba(24,26,30,0.7)'; c.beginPath(); c.arc(x, Y(m), 2, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x - 1.2, Y(m) - 1.6, 1.2, 1.2); }
      const nw = U(0.30), nx = xm - nw / 2, ny = Y(0.745), nh = Y(0.60) - ny; c.fillStyle = '#16171a'; rr(c, nx, ny, nw, nh, 3); c.fill(); c.fillStyle = '#d8372f'; c.beginPath(); c.arc(nx + nh / 2, ny + nh / 2, nh * 0.30, 0, 7); c.fill(); c.fillStyle = '#16171a'; c.fillRect(nx + nh * 0.26, ny + nh / 2 - 1, nh * 0.48, 2);
      c.fillStyle = '#f2f2f0'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '800 8px "Helvetica Neue", Arial, sans-serif'; c.fillText('DO NOT LEAN', nx + nh + 1, ny + nh * 0.34); c.font = '700 7px "Helvetica Neue", Arial, sans-serif'; c.fillText('ON THE DOORS', nx + nh + 1, ny + nh * 0.70);
      c.restore(); } }
  // CEIL: flat grey panels with seams across, and down the middle the air channel with its two long slots (v runs across the car)
  { const [y0, h] = BANDS.CEIL; c.fillStyle = '#dcdedd'; c.fillRect(0, y0, TW, h); speckle(c, 0, y0, TW, h, 2500, R, ['rgba(0,0,0,0.03)']);
    c.fillStyle = '#d3d5d6'; c.fillRect(0, y0 + h * 0.39, TW, h * 0.22);
    for (let k = 0; k < 16; k++) { c.fillStyle = 'rgba(0,0,0,0.20)'; c.fillRect(k * TW / 16, y0, 2, h); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(k * TW / 16 + 2, y0, 1, h); }
    
    }
  for (const k in BANDS) { const [y0, h, pad] = BANDS[k]; c.drawImage(cv, 0, y0, TW, 1, 0, y0 - pad, TW, pad); c.drawImage(cv, 0, y0 + h - 1, TW, 1, 0, y0 + h, TW, pad); }
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
  { const r = REG.TREAD, Rt = rng32(977); c.save(); c.beginPath(); c.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); c.clip(); c.fillStyle = '#a58a34'; c.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);      // the yellow strip at the doors: a worn tread of small domes
    for (let y = r.y + 5; y < r.y + r.h; y += 11) for (let x = r.x + 5 + ((y - r.y) % 22 > 10 ? 5.5 : 0); x < r.x + r.w; x += 11) { c.fillStyle = 'rgba(60,40,5,0.45)'; c.beginPath(); c.arc(x + 1, y + 1.2, 3.4, 0, 7); c.fill(); c.fillStyle = 'rgba(235,200,80,0.9)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); c.fillStyle = 'rgba(255,240,170,0.55)'; c.beginPath(); c.arc(x - 0.8, y - 0.9, 1.2, 0, 7); c.fill(); }
    for (let k = 0; k < 160; k++) { const x = r.x + Rt() * r.w, y = r.y + Rt() * r.h, w = 5 + Rt() * 40; c.fillStyle = `rgba(30,24,14,${0.08 + Rt() * 0.22})`; c.save(); c.translate(x, y); c.rotate((Rt() - 0.5) * 1.2); c.fillRect(-w / 2, 0, w, 1 + Rt() * 3); c.restore(); }
    for (let k = 0; k < 26; k++) { const x = r.x + Rt() * r.w, y = r.y + Rt() * r.h, q = 8 + Rt() * 30, g = c.createRadialGradient(x, y, 0, x, y, q); g.addColorStop(0, 'rgba(35,28,16,0.34)'); g.addColorStop(1, 'rgba(35,28,16,0)'); c.fillStyle = g; c.fillRect(x - q, y - q, 2 * q, 2 * q); }
    { const g = c.createLinearGradient(0, r.y, 0, r.y + r.h); g.addColorStop(0, 'rgba(30,24,14,0.38)'); g.addColorStop(0.25, 'rgba(30,24,14,0.05)'); g.addColorStop(0.8, 'rgba(30,24,14,0.10)'); g.addColorStop(1, 'rgba(30,24,14,0.45)'); c.fillStyle = g; c.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); } c.restore(); }
  paintAds(c);
  return { cv, c };
}

// ---------- the train ----------
export function buildTrain(THREE, opts = {}) {
  const cars = Math.max(1, Math.round(opts.cars ?? 4)), div = opts.div === 'A' ? 'A' : 'B', seed = opts.seed ?? 1;
  let route = { label: 'F', color: '#f36a1c', dest: '', ...(opts.route || {}) };
  const carLen = div === 'A' ? 15.6 : 18.4, W = div === 'A' ? 2.68 : 3.05, nd = div === 'A' ? 3 : 4;
  const F = 1.12, SILL = 0.95, SH = F + 2.03, RISE = 0.47, TOP = SH + RISE, WT = 0.07, hw = W / 2, xi = hw - WT, Lb = carLen / 2 - 0.25, Li = Lb - WT;
  const DW = 1.27, DH = 1.90, LEAFW = 0.645, SLIDE = 0.64, WY0 = F + 0.85, WY1 = F + 1.70, BY0 = F + 0.78, BY1 = F + 1.80, sp = carLen / nd;
  const CEIL = F + 2.10, CARD_Y = F + 1.92, SLANT = 0.28, SEAT_D = 0.46, SEAT_H = 0.43, SEATW = 0.45, GX = xi - SEAT_D - 0.01, GY = F + 1.90;
  const D = { F, SILL, SH, TOP, BY0, BY1, hw, W };
  const doorZ = []; for (let k = 0; k < nd; k++) doorZ.push((k + 0.5) * sp - carLen / 2);
  const lastEdge = doorZ[nd - 1] + DW / 2, zp = lastEdge + 0.10; // zp: the cab wall inside an end car
  const truckZ = +(carLen * 0.365).toFixed(2);
  const carZ = (i) => (i - (cars - 1) / 2) * carLen, length = cars * carLen;

  // windows (z ranges in the car's own frame; the same on both sides)
  const wins = []; const winW = sp - DW - 2 * 0.66 - 0.2;
  for (let k = 0; k < nd - 1; k++) { const zc = (doorZ[k] + doorZ[k + 1]) / 2; wins.push([zc - winW / 2, zc + winW / 2]); }
  wins.push([Lb - 0.75, Lb - 0.2], [-Lb + 0.2, -Lb + 0.75]); D.sp = sp; D.DW = DW; D.pier = (sp - DW - winW) / 2 - 0.11;
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
  const uvIntW = bandUV(bINTW, (p) => (p[2] + carLen / 2) / sp, (p) => (p[1] - F) / 1.92), uvIntWm = bandUV(bINTW, (p) => -(p[2] + carLen / 2) / sp, (p) => (p[1] - F) / 1.92);      // (the -x wall reads the picture the other way round, so its notices are not mirror writing)
  const uvIntEnd = bandUV(bINTW, (p) => p[0] / sp, (p) => (p[1] - F) / 1.92);
  const uvCeil = bandUV(bCEIL, (p) => p[2] / 19.2, (p) => (p[0] + xi) / (2 * xi));
  const uvFloor = bandUV(bFLOOR, (p) => p[2] / 20, (p) => (p[0] + xi) / (2 * xi));
  const mul = (b, s) => [b[0] * s, b[1] * s, b[2] * s];
  const extC = (b = [1, 1, 1]) => (p, n) => mul(b, n[1] > 0.6 ? 1.0 : n[1] < -0.6 ? 0.26 : 0.70 + 0.28 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1));
  const undC = (b = [1, 1, 1]) => (p, n) => mul(b, n[1] > 0.6 ? 0.50 : n[1] < -0.6 ? 0.14 : 0.24 + 0.24 * clamp(p[1] / SILL, 0, 1));
  const intS = (y) => 0.42 + 0.86 * Math.pow(clamp((y - F) / 1.9, 0, 1), 1.1);      // the light comes from the two strips at the top of the walls: bright up there, falling off down to the floor
  // Car look 2 (Nov 17): the inside light is BAKED from the two light strips as they are: each strip is a long lamp facing down (three sample lines across its width); a face takes
  // light by its angle and distance in the car's cross-section, the benches cast their shadow on the wall and the floor under them, and what bounces round the car is a flat
  // term (more on faces that look down: the ceiling is lit by the floor and the seats). Corners are a little darker (floor to wall, wall to card band).
  const LXa = xi - SLANT - 0.25, LXb = xi - SLANT - 0.03, LY = CEIL - 0.03;
  const segHit = (ax, ay, bx, by, c0, c1, d0, d1) => { const r = (bx - ax) * (d1 - c1) - (by - ay) * (d0 - c0); if (Math.abs(r) < 1e-9) return false; const t = ((c0 - ax) * (d1 - c1) - (c1 - ay) * (d0 - c0)) / r, u = ((c0 - ax) * (by - ay) - (c1 - ay) * (bx - ax)) / r; return t > 0.001 && t < 0.999 && u > 0 && u < 1; };
  const inBench = (z) => { let k = 0; for (const b of benches) k = Math.max(k, clamp(Math.min(z - b.z0, b.z1 - z) / 0.12 + 0.5, 0, 1)); return k; };
  const irr = (p, n, noOcc) => { let e = 0; const px = p[0] + n[0] * 0.015, py = p[1] + n[1] * 0.015, bk = noOcc ? 0 : inBench(p[2]), nz = Math.abs(n[2]) * 0.5;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const lx = s * (LXa + (k + 0.5) / 3 * (LXb - LXa)), dx = lx - px, dy = LY - py, d = Math.max(0.10, Math.hypot(dx, dy)), ux = dx / d, uy = dy / d, cs = Math.max(0, n[0] * ux + n[1] * uy) + nz; if (cs <= 0) continue; let v = 1;
      if (bk > 0) for (const q of [-1, 1]) if (segHit(px, py, lx, LY, q * (xi - 0.47), F + 0.44, q * (xi - 0.09), F + 0.43) || segHit(px, py, lx, LY, q * (xi - 0.09), F + 0.43, q * (xi - 0.004), F + 0.90)) { v = 1 - bk; break; }
      e += cs * Math.max(0.12, 0.25 + 0.75 * uy) / d * v; }
    const under = bk * (Math.abs(px) > xi - 0.46 && py < F + 0.40 ? 1 : 0), ax = xi - Math.abs(px), ay = py - F;
    let ao = Math.abs(n[1]) > 0.7 ? (n[1] > 0 ? 1 - 0.30 * Math.exp(-Math.max(0, ax) / 0.09) : 1) : 1 - 0.30 * Math.exp(-Math.max(0, ay) / 0.07);
    if (bk > 0) { if (n[1] > 0.7 && ax > 0.46 && ay < 0.05) ao *= 1 - 0.42 * bk * Math.exp(-(ax - 0.47) / 0.24); else if (Math.abs(n[0]) > 0.7 && ay > 0.9 && ax < 0.05) ao *= 1 - 0.32 * bk * Math.exp(-(ay - 0.905) / 0.09); }
    return Math.min(1.62, 1.15 * ao * (e / 3 + (0.30 + 0.30 * clamp(-n[1], 0, 1)) * (1 - 0.62 * under))); };
  const intC = (b = [1, 1, 1]) => (p, n) => mul(b, irr(p, n || [0, 0, 1]));
  const flat = (b) => () => b;
  const STEEL = [0.92, 0.94, 0.96], RUBBER = [0.035, 0.035, 0.04], WARM = [1.0, 1.0, 0.985], SEATC = [0.19, 0.26, 0.40];
  const sheen = (b) => (p) => mul(b, 0.56 * (0.80 + 0.20 * clamp((p[1] - F) / 1.9, 0, 1)));      // polished tube: the shader's reflection gives it its bright streak and dark flanks (MET = 1)
  // the bench's moulded profile: [distance from the wall, height over the floor], from the top of the backrest down to under the front lip
  const PROF = [[0, 0.905], [0.035, 0.90], [0.06, 0.87], [0.085, 0.78], [0.105, 0.62], [0.13, 0.50], [0.17, 0.435], [0.24, 0.425], [0.33, 0.432], [0.41, 0.447], [0.455, 0.452], [0.475, 0.43], [0.473, 0.36], [0.45, 0.325]], PF = [0], PK = [], PN = [], DIP = [0, 0, 0.006, 0.009, 0.009, 0.007, 0.012, 0.016, 0.016, 0.011, 0, 0, 0, 0];
  for (let i = 1; i < PROF.length; i++) PF.push(PF[i - 1] + Math.hypot(PROF[i][0] - PROF[i - 1][0], PROF[i][1] - PROF[i - 1][1])); { const t = PF[PF.length - 1]; for (let i = 0; i < PF.length; i++) PF[i] /= t; }
  for (let i = 0; i < PROF.length; i++) { const a = PROF[Math.max(0, i - 1)], b = PROF[Math.min(PROF.length - 1, i + 1)], dd = b[0] - a[0], dh = b[1] - a[1], l = Math.hypot(dd, dh) || 1; PK.push(0.44 + 0.42 * clamp(0.7 * dd / l - 0.3 * dh / l + 0.3, 0, 1)); PN.push([-dh / l, dd / l]); }

  // ================= the car shell (outside and inside, one geometry, one instance per car) =================
  const g = mkGeo();
  for (const s of [-1, 1]) { MET = 0;
    // side walls: outer skin, inner skin, and the edges of every opening
    grid(g, 'x', s * hw, [s, 0, 0], -Lb, Lb, SILL, SH, sideHoles, null, null, uvExt, extC(), 1);
    MET = 0.74; grid(g, 'x', s * xi, [-s, 0, 0], -Li, Li, F, CARD_Y, sideHoles, [...doorZ.flatMap((z) => [z - DW / 2 - 0.06, z + DW / 2 + 0.06]), ...benches.flatMap((b) => [b.z0 - 0.06, b.z0 + 0.06, b.z1 - 0.06, b.z1 + 0.06])], [F + 0.035, F + 0.10, F + 0.25, F + 0.50, F + 0.70, F + 0.92, F + 1.02, F + 1.15, F + 1.30, F + 1.45, F + 1.58, F + 1.80], s > 0 ? uvIntW : uvIntWm,
      (p, n, cc) => { const k = irr(p, n);
        if (doorZ.some((z) => Math.abs(cc[2] - z) < DW / 2 + 0.06)) return mul([0.50, 0.515, 0.53], k);
        return mul([0.60, 0.60, 0.595], k); }, 0); MET = 0;
    // window frames: a moulded steel surround with round corners and a black gasket inside it (the hole in the wall behind is square), the same gasket outside, a bar across
    for (const [a, b] of wins) { MET = 0.9; const zc = (a + b) / 2, yc = (WY0 + WY1) / 2, ha = (b - a) / 2, hb = (WY1 - WY0) / 2, rs = Math.min(0.085, ha * 0.45);
      const O = rrect(zc, yc, ha + 0.075, hb + 0.075, rs + 0.055, 8), Mr = rrect(zc, yc, ha + 0.035, hb + 0.035, rs + 0.02, 8), I = rrect(zc, yc, ha - 0.035, hb - 0.035, rs - 0.02, 8), I2 = rrect(zc, yc, ha - 0.062, hb - 0.062, rs - 0.04, 8), OE = rrect(zc, yc, ha + 0.03, hb + 0.03, 0.06, 8);
      ringX(g, s * (xi - 0.014), O, Mr, [-s, 0, 0], uvWhite, (p) => { const v = (p[1] - yc) / (hb + 0.1), u = (p[2] - zc) / (ha + 0.1); return mul(STEEL, 0.66 + 0.0 * (u + v)); }, 0);      // the polished surround: bright where it faces the lights
      ringP(g, (q) => [s * (xi - 0.014 + (q[2] || 0)), q[1], q[0]], Mr, I.map((q) => [q[0], q[1], 0.03]), [-s, 0, 0], uvWhite, (p) => { const v = (p[1] - yc) / hb; return mul(STEEL, v > 0.3 ? 0.42 : v < -0.3 ? 0.85 : 0.62); }, 0);      /* the cove down to the glass: its top in shade, its sill lit */
      MET = 0; ringX(g, s * (xi + 0.016), I, I2, [-s, 0, 0], uvWhite, flat(RUBBER), 0);
      ringX(g, s * (hw + 0.004), OE, I2, [s, 0, 0], uvWhite, flat([0.03, 0.03, 0.034]), 1);
      if (b - a > 1) { MET = 0.9; const ym = WY0 + 0.64 * (WY1 - WY0); box(g, Math.min(s * (xi + 0.012), s * (hw - 0.034)), Math.max(s * (xi + 0.012), s * (hw - 0.034)), ym - 0.017, ym + 0.017, a + 0.05, b - 0.05, uvWhite, (p, n) => mul(STEEL, n[1] > 0.5 ? 0.9 : n[1] < -0.5 ? 0.35 : 0.62), 0, '+z-z'); } MET = 0; }
    for (const h of sideHoles) { const door = h.b0 === F, col = door ? flat(mul(STEEL, 0.42)) : flat(RUBBER), x0 = s * xi, x1 = s * hw, L = door ? 1 : 0;
      poly(g, [[x0, h.b1, h.a0], [x1, h.b1, h.a0], [x1, h.b1, h.a1], [x0, h.b1, h.a1]], [0, -1, 0], uvWhite, col, L);
      poly(g, [[x0, h.b0, h.a0], [x1, h.b0, h.a0], [x1, h.b1, h.a0], [x0, h.b1, h.a0]], [0, 0, 1], uvWhite, col, L);
      poly(g, [[x0, h.b0, h.a1], [x1, h.b0, h.a1], [x1, h.b1, h.a1], [x0, h.b1, h.a1]], [0, 0, -1], uvWhite, col, L);
      if (!door) poly(g, [[x0, h.b0, h.a0], [x1, h.b0, h.a0], [x1, h.b0, h.a1], [x0, h.b0, h.a1]], [0, 1, 0], uvWhite, flat(mul(STEEL, 0.55)), L);
      else { // threshold plate: ribbed steel with a yellow edge
        poly(g, [[s * (xi - 0.10), F + 0.004, h.a0], [s * (hw - 0.03), F + 0.004, h.a0], [s * (hw - 0.03), F + 0.004, h.a1], [s * (xi - 0.10), F + 0.004, h.a1]], [0, 1, 0], uvPlainTop, (p) => mul(STEEL, 0.36 * irr(p, [0, 1, 0], true)), 0);
        poly(g, [[s * (hw - 0.03), F + 0.004, h.a0], [s * hw, F + 0.004, h.a0], [s * hw, F + 0.004, h.a1], [s * (hw - 0.03), F + 0.004, h.a1]], [0, 1, 0], uvWhite, flat([0.85, 0.62, 0.05]), 1);
        poly(g, [[s * (xi - 0.16), F + 0.003, h.a0], [s * (xi - 0.10), F + 0.003, h.a0], [s * (xi - 0.10), F + 0.003, h.a1], [s * (xi - 0.16), F + 0.003, h.a1]], [0, 1, 0], uvPlainTop, (p) => mul(STEEL, 0.30 * irr(p, [0, 1, 0], true)), 0); } }      /* (car look 2, live round 1: the yellow strip inside the car is gone, critics: 'a doormat, which does not exist in a real car') */
    // the slanted card band above the windows, with ad cards and a line map over each door
    const sx0 = s * xi, sx1 = s * (xi - SLANT), up = [-s * SLANT, CEIL - CARD_Y, 0], ul = Math.hypot(up[0], up[1]); up[0] /= ul; up[1] /= ul; const rt = [0, 0, s];
    poly(g, [[sx0, CARD_Y, -Li], [sx1, CEIL, -Li], [sx1, CEIL, Li], [sx0, CARD_Y, Li]], [-s, -1, 0], uvCeil, flat(mul([1.0, 0.985, 0.95], 0.50)), 0);
    MET = 0.9; for (const t of [0.045, 0.955]) { const xa = sx0 + (sx1 - sx0) * t, ya = CARD_Y + (CEIL - CARD_Y) * t; box(g, Math.min(xa - s * 0.012, xa - s * 0.002), Math.max(xa - s * 0.012, xa - s * 0.002), ya - 0.011, ya + 0.011, -Li, Li, uvWhite, (p, n) => mul(STEEL, n[1] < -0.5 ? 0.45 : 0.85), 0, '+z-z' + (s > 0 ? '+x' : '-x')); } MET = 0;
    const mid = [s * (xi - SLANT / 2) - s * 0.006 * (CEIL - CARD_Y) / ul, (CARD_Y + CEIL) / 2 - 0.006 * SLANT / ul, 0];
    doorZ.forEach((z) => card(g, [mid[0], mid[1], z], rt, up, 1.22, 0.13, REG.STRIP, [0.95, 0.95, 0.95], 2, TW, TH));
    let ak = seed + (s > 0 ? 2 : 0);      // the cards fill the band edge to edge between the line maps, right under the light strip
    for (let k = 0; k < nd - 1; k++) { const zc = (doorZ[k] + doorZ[k + 1]) / 2, room = sp - 1.26, n = Math.max(1, Math.round(room / 0.72)), stepz = room / n;
      for (let j = 0; j < n; j++) card(g, [mid[0], mid[1], zc + (j - (n - 1) / 2) * stepz], rt, up, stepz - 0.012, 0.285, ADS[(ak += 5) % 6], [[0.80, 0.79, 0.77], [1.75, 1.72, 1.66]], 0, TW, TH); }
    for (const e of [-1, 1]) { const room = Li - lastEdge - 0.06; if (room > 0.8) for (const j of [-1, 1]) card(g, [mid[0], mid[1], e * (lastEdge + 0.04 + room / 2) + j * room / 4], rt, up, room / 2 - 0.012, 0.285, ADS[(ak += 5) % 6], [[0.80, 0.79, 0.77], [1.75, 1.72, 1.66]], 0, TW, TH); }
    // lit route badges outside, by the doors
    doorZ.forEach((z, k) => { if (k % 2 === (s > 0 ? 0 : 1) || nd < 4) card(g, [s * (hw + 0.008), F + 1.30, z + (DW / 2 + 0.33)], [0, 0, -s], [0, 1, 0], 0.30, 0.30, REG.BADGE, [1.5, 1.5, 1.5], 2, TW, TH); });
    // benches: one moulded piece, open underneath; at every end by a door a pole up to the overhead bar and a "ladder" of slanted rails back to the wall
    const X = (d) => s * (xi - d), SK = (i) => { const k = 0.50 * irr([X(PROF[i][0]), F + PROF[i][1], 0], [-s * PN[i][0], PN[i][1], 0], true); return [k, k, k]; }, sv = (f) => bSEAT.v0 + (bSEAT.v1 - bSEAT.v0) * clamp(1 - f, bSEAT.e, 1 - bSEAT.e);
    const hanger = (z, r) => { const P0 = [s * GX, GY], P1 = [s * (GX - 0.01), GY + 0.13], P2 = [s * (LXa - 0.07), GY + 0.10], P3 = [s * (LXa - 0.07), CEIL], bz = (t) => { const u = 1 - t; return [u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0], u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1], z]; }; for (let k = 0; k < 6; k++) tube(g, bz(k / 6), bz((k + 1) / 6), r * 0.8, 6, uvWhite, sheen(STEEL), 0); };      // bar to ceiling, bent
    for (const b of benches) { MET = -0.2; const uS = (z) => (z - b.z0) / (SEATW * 16);
      // every seat is a shallow scoop between low ridges: two strips a seat (ridge, middle, ridge); the normals lean more than the shape does, so the gloss shows the scoops
      for (let j = 0; j < b.n; j++) for (const hf of [0, 1]) { const za = b.z0 + (j + hf / 2) * SEATW, zb = b.z0 + (j + (hf + 1) / 2) * SEATW, ma = hf, mb = 1 - hf, ta = hf ? 0 : 0.10, tb = hf ? -0.10 : 0;
        const pt = (i, z, m) => [X(PROF[i][0] - PN[i][0] * DIP[i] * m), F + PROF[i][1] - PN[i][1] * DIP[i] * m, z], nm = (i, t) => [-s * PN[i][0], PN[i][1], DIP[i] ? t : 0];
        for (let i = 0; i < PROF.length - 1; i++) { if (!DIP[i] && !DIP[i + 1]) continue; const c0 = SK(i), c1 = SK(i + 1);
          quadC(g, [pt(i, za, ma), pt(i + 1, za, ma), pt(i + 1, zb, mb), pt(i, zb, mb)], [[uS(za), sv(PF[i])], [uS(za), sv(PF[i + 1])], [uS(zb), sv(PF[i + 1])], [uS(zb), sv(PF[i])]], [c0, c1, c1, c0], [s * (PROF[i + 1][1] - PROF[i][1]), PROF[i + 1][0] - PROF[i][0], 0], 0, [nm(i, ta), nm(i + 1, ta), nm(i + 1, tb), nm(i, tb)]); } }
      for (let i = 0; i < PROF.length - 1; i++) { if (DIP[i] || DIP[i + 1]) continue; const c0 = SK(i), c1 = SK(i + 1), P0 = [X(PROF[i][0]), F + PROF[i][1]], P1 = [X(PROF[i + 1][0]), F + PROF[i + 1][1]], n0 = [-s * PN[i][0], PN[i][1], 0], n1 = [-s * PN[i + 1][0], PN[i + 1][1], 0];
        quadC(g, [[P0[0], P0[1], b.z0], [P1[0], P1[1], b.z0], [P1[0], P1[1], b.z1], [P0[0], P0[1], b.z1]], [[uS(b.z0), sv(PF[i])], [uS(b.z0), sv(PF[i + 1])], [uS(b.z1), sv(PF[i + 1])], [uS(b.z1), sv(PF[i])]], [c0, c1, c1, c0], [s * (PROF[i + 1][1] - PROF[i][1]), PROF[i + 1][0] - PROF[i][0], 0], 0, [n0, n1, n1, n0]); }
      MET = 0; const kx = X(0.07), yb = F + 0.325;      // the bench hangs off the wall: under it only shadow, and the dark wall
      poly(g, [[kx, F, b.z0], [kx, yb, b.z0], [kx, yb, b.z1], [kx, F, b.z1]], [-s, 0, 0], uvPlain, (p) => mul(STEEL, p[1] > F + 0.2 ? 0.010 : 0.022), 0);
      poly(g, [[X(0.45), yb, b.z0], [kx, yb, b.z0], [kx, yb, b.z1], [X(0.45), yb, b.z1]], [0, -1, 0], uvWhite, (p) => mul(SEATC, Math.abs(p[0]) < xi - 0.3 ? 0.30 : 0.12), 0);
      for (const [has, z, dir] of [[b.p0, b.z0, -1], [b.p1, b.z1, 1]]) {
        fan(g, [X(0.13), yb, z], PROF.slice(5).map(([d, h]) => [X(d), F + h, z]), [0, 0, dir], uvWhite, (p) => mul(SEATC, 0.95 * irr(p, [0, 0, dir], true)), 0);
        fan(g, [X(0), yb, z], [...PROF.slice(0, 6).map(([d, h]) => [X(d), F + h, z]), [X(0.13), yb, z]], [0, 0, dir], uvWhite, (p) => mul(SEATC, 0.95 * irr(p, [0, 0, dir], true)), 0);
        poly(g, [[kx, F, z], [X(0), F, z], [X(0), yb, z], [kx, yb, z]], [0, 0, dir], uvWhite, flat(mul(STEEL, 0.06)), 0);
        if (!has) continue; MET = 0.82; const zl = z + dir * 0.035;
        tube(g, [s * GX, F, zl], [s * GX, GY, zl], 0.028, 8, uvWhite, sheen(STEEL), 0); hanger(zl, 0.024);
        for (let i = 0; i < 5; i++) tube(g, [X(0.012), F + 0.50 + i * 0.125, zl], [s * GX, F + 0.535 + i * 0.125, zl], 0.018, 6, uvWhite, sheen(STEEL), 0);
        { const bz = (t) => { const a = (1 - t) * (1 - t), b2 = 2 * t * (1 - t), c2 = t * t; return [X(a * 0.012 + b2 * 0.42 + c2 * (xi - GX)), F + a * 1.14 + b2 * 1.20 + c2 * 1.74, zl]; }; for (let k = 0; k < 5; k++) tube(g, bz(k / 5), bz((k + 1) / 5), 0.023, 6, uvWhite, sheen(STEEL), 0); } MET = 0;      // the sweep from the wall up to the pole
      }
    }
    // the overhead bar runs the whole car on hangers
    { MET = 0.82; const z0 = -Li + 0.25, z1 = Li - 0.25, nh = Math.round((z1 - z0) / 1.15); tube(g, [s * GX, GY, z0], [s * GX, GY, z1], 0.024, 8, uvWhite, sheen(STEEL), 0);
      for (let j = 0; j < nh; j++) hanger(z0 + (j + 0.5) * (z1 - z0) / nh, 0.020); }
    // the doorways: a steel post each side and a header, standing proud of the wall (the leaves sit back in them)
    MET = 0.85; for (const z of doorZ) { for (const e of [-1, 1]) { const za = z + e * (DW / 2 + 0.005), zb = z + e * (DW / 2 + 0.075); box(g, Math.min(X(0), X(0.035)), Math.max(X(0), X(0.035)), F, F + DH + 0.018, Math.min(za, zb), Math.max(za, zb), uvPlain, (p, n) => mul(STEEL, (Math.abs(n[0]) > 0.5 ? 0.70 : n[2] * e < 0 ? 0.42 : 0.55) * irr(p, [-s, 0, 0], true)), 0, '-y' + (s > 0 ? '+x' : '-x')); }
      box(g, Math.min(X(0), X(0.035)), Math.max(X(0), X(0.035)), F + DH + 0.004, F + DH + 0.018, z - DW / 2 - 0.005, z + DW / 2 + 0.005, uvPlain, (p, n) => mul(STEEL, n[1] < -0.5 ? 0.32 : 0.9), 0, '+y+z-z' + (s > 0 ? '+x' : '-x')); }
  }
  // a pole in the middle of every doorway
  MET = 0.82; for (const z of doorZ) { tube(g, [0, F, z], [0, CEIL, z], 0.028, 8, uvWhite, sheen(STEEL), 0); cyl(g, 'y', F, F + 0.022, 0, z, 0.075, 12, uvWhite, (p, n) => mul(STEEL, n[1] > 0.5 ? 0.55 : 0.35), 0); cyl(g, 'y', F + 0.022, F + 0.05, 0, z, 0.043, 10, uvWhite, (p, n) => mul(STEEL, n[1] > 0.5 ? 0.6 : 0.4), 0); cyl(g, 'y', CEIL - 0.03, CEIL, 0, z, 0.06, 12, uvWhite, (p, n) => mul(STEEL, 0.38), 0); }
  MET = -0.095;
  // floor (darker under the benches), ceiling: grey panels, a light strip along each edge right over the card band
  { const fx = []; for (const q of [0.04, 0.12, 0.25, SEAT_D - 0.14, SEAT_D - 0.05, SEAT_D + 0.03, SEAT_D + 0.12, SEAT_D + 0.26, 0.95, 1.2]) fx.push(xi - q, -(xi - q)); fx.push(0);
    grid(g, 'y', F, [0, 1, 0], -xi, xi, -Li, Li, [], fx, [...doorZ.flatMap((z) => [z - DW / 2 - 0.12, z - DW / 2, z + DW / 2, z + DW / 2 + 0.12]), ...benches.flatMap((b) => [b.z0 - 0.07, b.z0 + 0.07, b.z1 - 0.07, b.z1 + 0.07])], uvFloor,
      (p, n) => { const k = 0.80 * irr(p, [0, 1, 0]); return [k, k, k * 1.02]; }, 0); }
  // where a pole stands on the floor: a soft dark ring (the floor's own colour at its rim)
  { const aoAt = (x, z, r) => { const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI * 2; pts.push([x + r * Math.cos(t), F + 0.0025, z - r * Math.sin(t)]); } fan(g, [x, F + 0.0025, z], pts, [0, 1, 0], uvFloor, (p) => { const d = Math.hypot(p[0] - x, p[2] - z) / r, k = 0.80 * irr(p, [0, 1, 0]) * (0.30 + 0.70 * d * d); return [k, k, k * 1.02]; }, 0); };
    for (const z of doorZ) aoAt(0, z, 0.20);
    for (const b of benches) for (const s of [-1, 1]) { if (b.p0) aoAt(s * GX, b.z0 - 0.035, 0.17); if (b.p1) aoAt(s * GX, b.z1 + 0.035, 0.17); } }
  MET = 0; const cx = xi - SLANT, LX0 = cx - 0.25, LX1 = cx - 0.03, ceilK = (p) => mul([1.0, 0.99, 0.965], 0.30 * irr(p, [0, -1, 0], true) * (0.62 + 0.38 * Math.pow(Math.abs(p[0]) / LXa, 1.5)) + 0.16 * Math.exp(-Math.max(0, LXa - Math.abs(p[0])) / 0.09));
  { const yc = CEIL + 0.045, cw = 0.30;      // the air channel down the middle, set up into the ceiling, with two long slots each side
    for (const x of [-cw, cw]) poly(g, [[x, CEIL, -Li], [x, yc, -Li], [x, yc, Li], [x, CEIL, Li]], [x < 0 ? 1 : -1, 0, 0], uvWhite, flat([0.10, 0.10, 0.105]), 0);
    poly(g, [[-cw, yc, -Li], [cw, yc, -Li], [cw, yc, Li], [-cw, yc, Li]], [0, -1, 0], uvCeil, flat(mul(WARM, 0.20)), 0);
    { const ns = Math.round(2 * Li / 1.22), sl = 2 * Li / ns; for (const x of [-0.19, 0.19]) for (const o of [-0.022, 0.022]) for (let k = 0; k < ns; k++) for (let j = 0; j < 9; j++) { const za = -Li + k * sl + 0.07, zb = -Li + (k + 1) * sl - 0.07, z0 = za + (zb - za) * j / 9 + 0.012, z1 = za + (zb - za) * (j + 1) / 9 - 0.012; poly(g, [[x + o - 0.007, yc - 0.003, z0], [x + o + 0.007, yc - 0.003, z0], [x + o + 0.007, yc - 0.003, z1], [x + o - 0.007, yc - 0.003, z1]], [0, -1, 0], uvWhite, flat([0.022, 0.022, 0.026]), 0); } }
    // the panels each side, in strips so the baked light can fall off across them
    for (const s of [-1, 1]) { const xs = [cw, 0.45, 0.62, 0.78, LX0 - 0.05, LX0]; for (let k = 0; k < xs.length - 1; k++) poly(g, [[s * xs[k], CEIL, -Li], [s * xs[k + 1], CEIL, -Li], [s * xs[k + 1], CEIL, Li], [s * xs[k], CEIL, Li]], [0, -1, 0], uvCeil, ceilK, 0);
      poly(g, [[s * LX1, CEIL, -Li], [s * cx, CEIL, -Li], [s * cx, CEIL, Li], [s * LX1, CEIL, Li]], [0, -1, 0], uvWhite, flat([0.50, 0.50, 0.51]), 0);
      // the light: a housing with a lens that stands a little proud, in fixtures 1.22 m long with a dark joint between them; brightest down its middle
      poly(g, [[s * LX0, CEIL, -Li], [s * LX1, CEIL, -Li], [s * LX1, CEIL, Li], [s * LX0, CEIL, Li]], [0, -1, 0], uvWhite, flat([0.20, 0.20, 0.21]), 0);
      const nf = Math.round(2 * Li / 1.22), fl = 2 * Li / nf, LP = [[LX0 + 0.010, CEIL - 0.004, 2.7], [LX0 + 0.060, CEIL - 0.030, 5.4], [LX1 - 0.060, CEIL - 0.030, 5.4], [LX1 - 0.010, CEIL - 0.004, 2.7]];
      for (let k = 0; k < nf; k++) { const z0 = -Li + k * fl + 0.034, z1 = -Li + (k + 1) * fl - 0.034;
        for (let j = 0; j < 3; j++) { const A = LP[j], B = LP[j + 1], ca = [A[2], A[2] * 0.975, A[2] * 0.90], cb = [B[2], B[2] * 0.975, B[2] * 0.90]; quadC(g, [[s * A[0], A[1], z0], [s * B[0], B[1], z0], [s * B[0], B[1], z1], [s * A[0], A[1], z1]], [uvWhite(), uvWhite(), uvWhite(), uvWhite()], [ca, cb, cb, ca], [0, -1, 0], 0); }
        for (const z of [z0, z1]) poly(g, [[s * LP[0][0], LP[0][1], z], [s * LP[1][0], LP[1][1], z], [s * LP[2][0], LP[2][1], z], [s * LP[3][0], LP[3][1], z]], [0, 0, z === z0 ? -1 : 1], uvWhite, flat([1.6, 1.55, 1.45]), 0); } } }
  // roof, underframe, end walls with a door
  const NA = 12, arc = (k) => { const a = k / NA * Math.PI; return [hw * Math.cos(a), SH + RISE * Math.sin(a)]; };
  for (let k = 0; k < NA; k++) { const a = arc(k), b = arc(k + 1), am = (k + 0.5) / NA * Math.PI, n = [Math.cos(am) * RISE, Math.sin(am) * hw, 0];
    poly(g, [[a[0], a[1], -Lb], [b[0], b[1], -Lb], [b[0], b[1], Lb], [a[0], a[1], Lb]], n, bandUV(bROOF, (p) => p[2] / 16, (p) => Math.acos(clamp(p[0] / hw, -1, 1)) / Math.PI), (p) => { const k2 = 0.66 + 0.34 * clamp((p[1] - SH) / RISE, 0, 1); return [k2, k2, k2]; }, 1); }
  for (const zc of [-carLen / 4, carLen / 4]) box(g, -0.78, 0.78, TOP - 0.10, TOP + 0.09, zc - 1.5, zc + 1.5, bandUV(bROOF, (p) => p[2] / 16, (p) => (p[0] + 0.78) / 1.56), (p, n) => mul([0.9, 0.9, 0.9], n[1] > 0.5 ? 0.95 : 0.6), 1, '-y');
  poly(g, [[-hw, SILL, -Lb], [hw, SILL, -Lb], [hw, SILL, Lb], [-hw, SILL, Lb]], [0, -1, 0], uvUnder, flat([0.14, 0.14, 0.14]), 1);
  const ED = 0.36, endHole = [{ a0: -ED, a1: ED, b0: F, b1: F + DH }], endWin = [{ a0: -0.21, a1: 0.21, b0: F + 0.80, b1: F + 1.74 }];
  for (const e of [-1, 1]) {
    grid(g, 'z', e * Lb, [0, 0, e], -hw, hw, SILL, SH, endHole, null, null, uvPlain, extC([0.8, 0.8, 0.8]), 1);
    const cap = []; for (let k = 0; k <= NA; k++) { const a = arc(k); cap.push([a[0], a[1], e * Lb]); } poly(g, cap, [0, 0, e], uvPlain, extC([0.8, 0.8, 0.8]), 1);
    MET = 0.3; grid(g, 'z', e * Li, [0, 0, -e], -xi, xi, F, CARD_Y, endHole, null, [F + 0.1, F + 0.5, F + 1.0, F + 1.5], uvIntEnd, intC(mul(WARM, 0.62)), 0); MET = 0;
    poly(g, [[-xi, CARD_Y, e * Li], [xi, CARD_Y, e * Li], [cx, CEIL, e * Li], [-cx, CEIL, e * Li]], [0, 0, -e], uvCeil, flat(mul(WARM, 0.60)), 0);
    const zd = e * (Lb - 0.03), zi = e * (Lb - 0.055); // the end door (fixed shut) with a window
    grid(g, 'z', zd, [0, 0, e], -ED, ED, F, F + DH, endWin, null, null, uvPlain, extC([0.72, 0.72, 0.72]), 1);
    MET = 0.35; grid(g, 'z', zi, [0, 0, -e], -ED, ED, F, F + DH, endWin, null, null, uvPlain, intC(mul(STEEL, 0.60)), 0); MET = 0;
    for (const sx of [-1, 1]) { poly(g, [[sx * ED, F, e * Li], [sx * ED, F + DH, e * Li], [sx * ED, F + DH, e * Lb], [sx * ED, F, e * Lb]], [-sx, 0, 0], uvWhite, flat(mul(STEEL, 0.4)), 0); }
    poly(g, [[-ED, F + DH, e * Li], [ED, F + DH, e * Li], [ED, F + DH, e * Lb], [-ED, F + DH, e * Lb]], [0, -1, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
    poly(g, [[-ED, F, e * Li], [ED, F, e * Li], [ED, F, e * Lb], [-ED, F, e * Lb]], [0, 1, 0], uvPlainTop, flat(mul(STEEL, 0.6)), 0);
    { const zs = e * (Li - 0.12); box(g, -(cx - 0.02), cx - 0.02, CEIL - 0.27, CEIL, Math.min(zs, e * Li), Math.max(zs, e * Li), uvWhite, (p, n) => n[1] < -0.5 ? [0.015, 0.015, 0.018] : [0.03, 0.03, 0.035], 0, '+y'); card(g, [0, CEIL - 0.135, zs - e * 0.004], [-e, 0, 0], [0, 1, 0], 0.86, 0.245, REG.ISIGN, [2.6, 2.6, 2.6], 2, TW, TH);      // the sign across the end, under the ceiling
      const pz = (q) => [q[0], q[1], e * (Li - 0.012)], wy = F + 1.26; for (const sx of [-1, 1]) { const O = rrect(sx * 0.93, wy, 0.33, 0.47, 0.13, 4), I = rrect(sx * 0.93, wy, 0.25, 0.39, 0.09, 4), I2 = rrect(sx * 0.93, wy, 0.23, 0.37, 0.08, 4);      // a window each side of the end door (dark: the next car is not seen through these)
        MET = 0.9; ringP(g, pz, O, I, [0, 0, -e], uvWhite, flat(mul(STEEL, 0.9)), 0); MET = 0; ringP(g, pz, I, I2, [0, 0, -e], uvWhite, flat(RUBBER), 0); poly(g, I2.map(pz), [0, 0, -e], uvWhite, (p) => { const k = 0.018 + 0.03 * clamp((p[1] - wy + 0.37) / 0.74, 0, 1); return [k, k * 1.1, k * 1.25]; }, 0); }
      const dO = rrect(0, (endWin[0].b0 + endWin[0].b1) / 2, 0.235, (endWin[0].b1 - endWin[0].b0) / 2 + 0.025, 0.06, 4), dI = rrect(0, (endWin[0].b0 + endWin[0].b1) / 2, 0.175, (endWin[0].b1 - endWin[0].b0) / 2 - 0.035, 0.09, 4); ringP(g, (q) => [q[0], q[1], zi - e * 0.006], dO, dI, [0, 0, -e], uvWhite, flat(RUBBER), 0);
      MET = 1; tube(g, [0.27, F + 0.92, zi - e * 0.03], [0.27, F + 1.22, zi - e * 0.03], 0.012, 8, uvWhite, sheen(STEEL), 0); MET = 0; }
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
  const gl = mkGeo(), LW2 = LEAFW / 2, lwin = [{ a0: -0.2, a1: 0.2, b0: F + 0.82, b1: F + 1.77 }];
  grid(gl, 'x', 0.015, [1, 0, 0], -LW2, LW2, F, F + DH, lwin, [-LW2 + 0.022, LW2 - 0.022], [BY0, BY1, F + 0.05], bandUV(bPLAIN, (p) => p[2] / 18 + 0.3, (p) => (p[1] - F) / 2.0),
    (p, n, cc) => Math.abs(cc[2]) > LW2 - 0.022 ? RUBBER : cc[1] > BY0 && cc[1] < BY1 ? [0.055, 0.058, 0.064] : mul([0.97, 0.97, 0.97], cc[1] < F + 0.05 ? 0.5 : 0.70 + 0.28 * clamp((p[1] - SILL) / (TOP - SILL), 0, 1)), 1);
  MET = 0.7; grid(gl, 'x', -0.015, [-1, 0, 0], -LW2, LW2, F, F + DH, lwin, [-LW2 + 0.022, LW2 - 0.022], [F + 0.12, F + 0.45, F + 0.80, F + 1.15, F + 1.50], bandUV(bINTW, (p) => 0.5 + p[2] / sp, (p) => (p[1] - F) / 1.92),
    (p, n, cc) => Math.abs(cc[2]) > LW2 - 0.022 ? RUBBER : mul(STEEL, irr([xi - 0.03, p[1], 1e6], [-1, 0, 0], true) * 0.62), 0); MET = 0;
  { const h = lwin[0]; for (const [pts, n] of [[[[-0.015, h.b1, h.a0], [0.015, h.b1, h.a0], [0.015, h.b1, h.a1], [-0.015, h.b1, h.a1]], [0, -1, 0]], [[[-0.015, h.b0, h.a0], [0.015, h.b0, h.a0], [0.015, h.b0, h.a1], [-0.015, h.b0, h.a1]], [0, 1, 0]],
      [[[-0.015, h.b0, h.a0], [0.015, h.b0, h.a0], [0.015, h.b1, h.a0], [-0.015, h.b1, h.a0]], [0, 0, 1]], [[[-0.015, h.b0, h.a1], [0.015, h.b0, h.a1], [0.015, h.b1, h.a1], [-0.015, h.b1, h.a1]], [0, 0, -1]]]) poly(gl, pts, n, uvWhite, flat(RUBBER), 0);
    for (const z of [-LW2, LW2]) poly(gl, [[-0.015, F, z], [0.015, F, z], [0.015, F + DH, z], [-0.015, F + DH, z]], [0, 0, Math.sign(z)], uvWhite, flat(RUBBER), 0); }
  { const h = lwin[0], yc = (h.b0 + h.b1) / 2, hb = (h.b1 - h.b0) / 2, O = rrect(0, yc, 0.2 + 0.02, hb + 0.02, 0.05, 4), I2 = rrect(0, yc, 0.2 - 0.04, hb - 0.04, 0.085, 4);      // the leaf's window: round corners, a black gasket on both faces
    ringX(gl, 0.019, O, I2, [1, 0, 0], uvWhite, flat(RUBBER), 1); ringX(gl, -0.019, O, I2, [-1, 0, 0], uvWhite, flat([0.05, 0.05, 0.055]), 0); }

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
    grid(gc, 'z', zp, [0, 0, -1], -xi, xi, F, CARD_Y, cabHole, null, [F + 0.1, F + 0.5, F + 1.0, F + 1.5], uvIntEnd, intC(mul(WARM, 0.62)), 0);
    poly(gc, [[-xi, CARD_Y, zp], [xi, CARD_Y, zp], [cx, CEIL, zp], [-cx, CEIL, zp]], [0, 0, -1], uvCeil, flat(mul(WARM, 0.60)), 0);
    grid(gc, 'z', zp + 0.025, [0, 0, -1], -ED, ED, F, F + DH, [{ a0: -0.17, a1: 0.17, b0: F + 1.10, b1: F + 1.62 }], null, null, uvPlain, intC(mul(STEEL, 0.55)), 0);
    poly(gc, [[-0.17, F + 1.10, zp + 0.03], [0.17, F + 1.10, zp + 0.03], [0.17, F + 1.62, zp + 0.03], [-0.17, F + 1.62, zp + 0.03]], [0, 0, -1], uvWhite, (p) => p[1] > F + 1.3 ? [0.035, 0.042, 0.05] : [0.012, 0.012, 0.016], 0);
    { const zf = zp + 0.024, O = rrect(0, F + 1.36, 0.205, 0.295, 0.05, 4), I = rrect(0, F + 1.36, 0.165, 0.255, 0.035, 4); ringP(gc, (q) => [q[0], q[1], zf], O, I, [0, 0, -1], uvWhite, flat(RUBBER), 0);
      for (const sx of [-1, 1]) poly(gc, [[sx * (ED - 0.012), F, zf], [sx * ED, F, zf], [sx * ED, F + DH, zf], [sx * (ED - 0.012), F + DH, zf]], [0, 0, -1], uvWhite, flat(RUBBER), 0);
      poly(gc, [[-ED, F + DH - 0.012, zf], [ED, F + DH - 0.012, zf], [ED, F + DH, zf], [-ED, F + DH, zf]], [0, 0, -1], uvWhite, flat(RUBBER), 0);
      MET = 0.5; poly(gc, [[-ED + 0.012, F + 0.01, zf], [ED - 0.012, F + 0.01, zf], [ED - 0.012, F + 0.26, zf], [-ED + 0.012, F + 0.26, zf]], [0, 0, -1], uvPlain, (p) => mul(STEEL, 0.40 * irr(p, [0, 0, -1], true)), 0);
      MET = 0.82; tube(gc, [-0.27, F + 0.95, zp - 0.03], [-0.27, F + 1.20, zp - 0.03], 0.013, 8, uvWhite, sheen(STEEL), 0); for (const y of [F + 0.95, F + 1.20]) tube(gc, [-0.27, y, zp - 0.03], [-0.27, y, zp + 0.02], 0.011, 6, uvWhite, sheen(STEEL), 0); MET = 0;
      const [by0, bh] = BANDS.INTW, YY = (m) => by0 + (1 - m / 1.92) * bh, UU = (m) => m / sp * TW, pw = UU(Math.min(0.52, D.pier - 0.10));
      for (const sd of [-1, 1]) { const xc = TW / 2 + sd * UU(DW / 2 + 0.06 + D.pier / 2); card(gc, [-sd * 0.92, F + 1.28, zp - 0.004], [-1, 0, 0], [0, 1, 0], Math.min(0.52, D.pier - 0.10) + 0.03, 0.80, { x: xc - pw / 2 - 5, y: YY(1.66) - 5, w: pw + 10, h: YY(0.90) - YY(1.66) + 10 }, [0.85, 0.85, 0.85], 0, TW, TH); } }
    poly(gc, [[0.24, F + 1.0, zp + 0.02], [0.30, F + 1.0, zp + 0.02], [0.30, F + 1.14, zp + 0.02], [0.24, F + 1.14, zp + 0.02]], [0, 0, -1], uvWhite, flat([0.25, 0.25, 0.27]), 0);
    for (const s2 of [-1, 1]) poly(gc, [[s2 * ED, F, zp], [s2 * ED, F + DH, zp], [s2 * ED, F + DH, zp + 0.025], [s2 * ED, F, zp + 0.025]], [-s2, 0, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
    poly(gc, [[-ED, F + DH, zp], [ED, F + DH, zp], [ED, F + DH, zp + 0.025], [-ED, F + DH, zp + 0.025]], [0, -1, 0], uvWhite, flat(mul(STEEL, 0.4)), 0);
    box(gc, -(cx - 0.02), cx - 0.02, CEIL - 0.27, CEIL, zp - 0.12, zp, uvWhite, (p, n) => n[1] < -0.5 ? [0.015, 0.015, 0.018] : [0.03, 0.03, 0.035], 0, '+y'); card(gc, [0, CEIL - 0.135, zp - 0.124], [-1, 0, 0], [0, 1, 0], 0.86, 0.245, REG.ISIGN, [2.6, 2.6, 2.6], 2, TW, TH);
  }

  // ================= materials =================
  const sheet = paintSheet(D, route, seed);
  const tex = new THREE.CanvasTexture(sheet.cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const uni = { uAmb: { value: 1 }, uInt: { value: 1 }, uSpill: { value: 1 } };
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, fog: false });
  // The shader: the three lights (inside / outside / own glow) as before, and for polished faces (aN.w, inside only) a cheap reflection of the car in itself. The car is a long
  // box, so what a face mirrors is found by following the reflected ray in the car's CROSS-SECTION from the face's own place: up to the ceiling (grey, or one of the two light
  // strips), across to a wall (bench, dark windows, bright upper wall) or down to the floor. Poles get their bright streak and dark flanks from it, the steel walls a soft band of
  // light, the floor the long streaks of the two light strips, the seats a glint. aN.w > 0: steel (the reflection replaces the colour; duller steel blurs it); < 0: a clear gloss added on top.
  // carEnv( place in the train's frame, direction, blur ): what a polished face mirrors. Car look 2: the wall it finds is no longer one grey band: the windows and the door
  // windows of the far side are dark panes in bright steel (found from where along the car the ray lands), so the steel carries soft dark shapes that slide as he moves.
  const ENV = 'vec3 carEnv( vec3 p, vec3 d, float blur ) { float HX = ' + (xi).toFixed(3) + '; float Y0 = ' + (F).toFixed(3) + '; float Y1 = ' + (CEIL).toFixed(3) + '; float LA = ' + (LX0).toFixed(3) + '; float LB = ' + (LX1).toFixed(3) + ';\n'
    + ' float tx = d.x > 0.0 ? ( HX - p.x ) / max( d.x, 1e-4 ) : ( - HX - p.x ) / min( d.x, -1e-4 ); float ty = d.y > 0.0 ? ( Y1 - p.y ) / max( d.y, 1e-4 ) : ( Y0 - p.y ) / min( d.y, -1e-4 );\n'
    + ' if ( ty < tx ) { float x = abs( p.x + d.x * ty ); if ( d.y <= 0.0 ) return vec3( x > ' + (xi - SEAT_D).toFixed(3) + ' ? 0.03 : 0.07 ); float w = 0.03 + blur + 1.2 * fwidth( x ); float s = smoothstep( LA - w, LA + w, x ) * ( 1.0 - smoothstep( LB - w, LB + w, x ) ); return mix( vec3( 0.30 ), vec3( 3.6, 3.5, 3.3 ), s * ( LB - LA ) / ( LB - LA + w ) ); }\n'
    + ' float y = p.y + d.y * tx - Y0; float b = blur * 1.3; vec3 e = mix( vec3( 0.04 ), vec3( 0.16, 0.21, 0.34 ), smoothstep( 0.30 - b, 0.50 + b, y ) );\n'
    + ' float z = p.z + d.z * tx + ' + ((cars % 2) * carLen / 2).toFixed(3) + '; float SP = ' + sp.toFixed(4) + '; float CL = ' + carLen.toFixed(3) + '; float m = mod( z, SP ); float zw = min( m, SP - m ); float zd = abs( m - SP * 0.5 ); float c = mod( z, CL ); float ze = min( c, CL - c ); float bw = 0.05 + b;\n'
    + ' float win = ( 1.0 - smoothstep( ' + (winW / 2).toFixed(3) + ' - bw, ' + (winW / 2).toFixed(3) + ' + bw, zw ) ) * smoothstep( SP * 0.5 - bw, SP * 0.5 + bw, ze ) * smoothstep( 0.85 - bw, 0.85 + bw, y ) * ( 1.0 - smoothstep( 1.70 - bw, 1.70 + bw, y ) );\n'
    + ' float dwn = ( 1.0 - smoothstep( 0.19 - bw, 0.19 + bw, abs( zd - 0.3225 ) ) ) * smoothstep( 0.82 - bw, 0.82 + bw, y ) * ( 1.0 - smoothstep( 1.77 - bw, 1.77 + bw, y ) );\n'
    + ' vec3 band = mix( vec3( 0.44 + 0.28 * smoothstep( 0.9, 1.9, y ) ), vec3( 0.04, 0.05, 0.06 ) + 0.20 * uSpill, max( win, dwn ) ); e = mix( e, band, smoothstep( 0.86 - b, 0.96 + b, y ) ); e = mix( e, vec3( 0.85, 0.83, 0.78 ), smoothstep( 1.84 - b, 1.94 + b, y ) ); return e; }';
  mat.onBeforeCompile = (sh) => { sh.uniforms.uAmb = uni.uAmb; sh.uniforms.uInt = uni.uInt; sh.uniforms.uSpill = uni.uSpill;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aL;\nattribute vec4 aN;\nuniform float uAmb;\nuniform float uInt;\nuniform float uSpill;\nvarying vec3 vRN;\nvarying vec3 vRV;\nvarying float vMet;\nvarying float vLi;\nvarying vec3 vLP;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= aL < 0.5 ? uInt * ( 0.80 + 0.20 * uSpill ) : ( aL < 1.5 ? uAmb : 1.0 );')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp = vec4( transformed, 1.0 ); mat3 nm = mat3( 1.0 );\n#ifdef USE_INSTANCING\n wp = instanceMatrix * wp; nm = mat3( instanceMatrix );\n#endif\n vLP = wp.xyz; wp = modelMatrix * wp; vRN = nm * aN.xyz; vRV = transpose( mat3( modelMatrix ) ) * ( wp.xyz - cameraPosition ); vMet = aL < 0.5 ? aN.w : 0.0; vLi = uInt * ( 0.80 + 0.20 * uSpill ); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSpill;\nvarying vec3 vRN;\nvarying vec3 vRV;\nvarying float vMet;\nvarying float vLi;\nvarying vec3 vLP;\n'
        + ENV)
      .replace('#include <color_fragment>', '#include <color_fragment>\nif ( abs( vMet ) > 0.004 ) { vec3 rn = normalize( vRN ); if ( vMet > 0.25 && vMet < 0.78 ) { rn.z += 0.03 * sin( vLP.z * 8.7 ) + 0.012 * sin( vLP.z * 23.0 ); rn.y += 0.012 * sin( vLP.z * 5.3 + 1.7 ); rn.x += 0.02 * sin( vLP.x * 6.1 ) * abs( rn.z ); rn = normalize( rn ); } vec3 r = reflect( normalize( vRV ), rn ); vec3 e = carEnv( vLP, r, vMet > 0.0 ? ( 1.0 - vMet ) * 0.45 : ( vMet < -0.1 ? 0.07 : 0.30 ) );\n if ( vMet > 0.0 ) diffuseColor.rgb *= mix( vec3( 1.0 ), e, vMet ); else { float cf = clamp( dot( - normalize( vRV ), normalize( vRN ) ), 0.0, 1.0 ); float gl = 0.22 + 2.4 * pow( 1.0 - cf, 3.0 ); if ( vMet < -0.1 ) { e = vec3( 0.30 ) + 1.6 * max( e - 1.0, 0.0 ); gl = 0.30 + 2.6 * pow( 1.0 - cf, 2.5 ); vec2 l2 = normalize( vec2( ( vLP.x > 0.0 ? ' + ((LX0 + LX1) / 2).toFixed(3) + ' : ' + (-(LX0 + LX1) / 2).toFixed(3) + ' ) - vLP.x, ' + CEIL.toFixed(3) + ' - vLP.y ) ); vec2 v2 = normalize( - vRV.xy + vec2( 1e-4 ) ); float sps = pow( max( dot( normalize( rn.xy + vec2( 1e-4 ) ), normalize( l2 + v2 ) ), 0.0 ), 110.0 ) * length( rn.xy ); diffuseColor.rgb += vec3( 1.0, 0.98, 0.95 ) * sps * 0.38 * vLi; } else { gl *= 0.50 + 0.50 * ( 0.5 + 0.5 * sin( vLP.z * 3.1 + 1.6 * sin( vLP.x * 5.0 ) ) ) * ( 0.6 + 0.4 * sin( vLP.x * 9.3 + vLP.z * 1.7 ) ); } diffuseColor.rgb += ( - vMet ) * e * vLi * gl; }\n if ( abs( vMet - 0.82 ) < 0.012 ) { vec3 tn = normalize( vRN ); vec3 tv = normalize( - vRV ); float ct = abs( dot( tv, tn ) ); diffuseColor.rgb *= mix( 0.30, 1.0, smoothstep( 0.05, 0.75, ct ) );\n  if ( abs( tn.y ) < 0.6 ) { vec2 n2 = normalize( tn.xz ); vec2 v2 = normalize( tv.xz ); diffuseColor.rgb *= mix( 0.42, 1.0, abs( n2.x ) ); float sp2 = 0.0; for ( int k = 0; k < 2; k ++ ) { vec2 l2 = normalize( vec2( ( k == 0 ? ' + ((LX0 + LX1) / 2).toFixed(3) + ' : ' + (-(LX0 + LX1) / 2).toFixed(3) + ' ) - vLP.x, 0.35 * ( tv.z > 0.0 ? 1.0 : -1.0 ) ) ); sp2 += pow( max( dot( n2, normalize( l2 + v2 ) ), 0.0 ), 48.0 ); } diffuseColor.rgb += vec3( 1.0, 0.98, 0.94 ) * sp2 * 0.85 * vLi * ( 0.45 + 0.55 * smoothstep( ' + F.toFixed(3) + ', ' + CEIL.toFixed(3) + ', vLP.y ) ); } } }\nif ( vMet < 0.0 && vMet > -0.1 && vLP.y < ' + (F + 0.006).toFixed(3) + ' ) { vec2 q = vLP.xz * 290.0; float fw = max( fwidth( q.x ), fwidth( q.y ) ); vec2 ce = floor( q ); float h = fract( sin( dot( ce, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); float h2 = fract( h * 91.7 ); float fd = clamp( 1.7 - fw, 0.0, 1.0 ); vec3 fl = vec3( 0.36, 0.345, 0.32 ) * ( 0.45 + h2 ) * vLi * clamp( vColor.g * 1.1, 0.0, 1.2 ); diffuseColor.rgb = mix( diffuseColor.rgb + 0.05 * fl, mix( diffuseColor.rgb, fl, step( 0.95, h ) ) * ( 1.0 - 0.55 * step( h, 0.06 ) ), fd ); }'); };
  mat.customProgramCacheKey = () => 'subway-train-v16-' + div + (cars % 2);
  const glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.02, 0.026), transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, fog: false });
  // Car look 2: seen from inside, the glass mirrors the car (the two light strips, the bright upper wall, the dark floor) the way a real car window does against the dark of the
  // tunnel: the same carEnv as the steel, at the strength glass has (a few per cent head on, more at a flat angle), added over the dark tint. Seen from outside: as it was.
  glassMat.onBeforeCompile = (sh) => { sh.uniforms.uInt = uni.uInt; sh.uniforms.uSpill = uni.uSpill;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRV;\nvarying vec3 vLP;\nvarying float vEnd;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n wp = instanceMatrix * wp;\n#endif\n vLP = wp.xyz; vEnd = abs( wp.x ) < 0.6 ? 1.0 : 0.0; wp = modelMatrix * wp; vRV = transpose( mat3( modelMatrix ) ) * ( wp.xyz - cameraPosition ); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uInt;\nuniform float uSpill;\nvarying vec3 vRV;\nvarying vec3 vLP;\nvarying float vEnd;\n' + ENV)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec3 v = normalize( vRV ); float sx = vLP.x > 0.0 ? 1.0 : -1.0; float c = vEnd > 0.5 ? abs( v.z ) : v.x * sx;\n if ( c > 0.0 ) { vec3 r = vEnd > 0.5 ? vec3( v.x, v.y, - v.z ) : vec3( - v.x, v.y, v.z ); vec3 p = vEnd > 0.5 ? vLP : vec3( vLP.x - sx * 0.05, vLP.y, vLP.z ); float fr = 0.10 + 0.60 * pow( 1.0 - c, 4.0 ); vec3 e = carEnv( p, r, 0.05 ); vec2 g = vec2( vEnd > 0.5 ? vLP.x : vLP.z, vLP.y ) * 5.5; vec2 ce = floor( g ); float h = fract( sin( dot( ce, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); float an = h * 6.283; vec2 lp = fract( g ) - 0.5; float dl = abs( lp.x * cos( an ) + lp.y * sin( an ) ); float sc = step( 0.66, h ) * ( 1.0 - smoothstep( 0.004, 0.012 + fwidth( dl ), dl ) ) * smoothstep( 0.5, 0.3, length( lp ) ) * smoothstep( 0.2, 0.9, 0.5 + 0.5 * sin( g.x * 0.9 + 2.0 * sin( g.y * 0.7 ) ) );\n diffuseColor.rgb += ( e * fr + vec3( 0.014 + 0.035 * sc ) ) * uInt * ( 0.80 + 0.20 * uSpill ) / max( opacity, 0.05 ) * vec3( 0.92, 1.0, 0.98 ); } }'); };
  glassMat.customProgramCacheKey = () => 'subway-train-glass-v4-' + div + (cars % 2);
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
  function setStation(f) { uni.uSpill.value = clamp(+f || 0, 0, 1); }      // 1 = standing in a lit station (its light comes in through the windows), 0 = in the dark of the tunnel
  function setRoute(r = {}) { route = { ...route, ...r }; paintBadge(sheet.c, REG.BADGE, route); paintDest(sheet.c, REG.DEST, route); paintStrip(sheet.c, REG.STRIP, route); paintISign(sheet.c, REG.ISIGN, route); tex.needsUpdate = true; }
  function dispose() { group.removeFromParent(); for (const x of [shellGeo, leafGeo, cabGeo, glassGeo, leafGlassGeo, lampGeo, mat, glassMat, lampMat, tex]) x.dispose(); for (const m of [shell, cab, leaves, lamps, leafGlass]) m.dispose(); }

  return { group, length, carLen, width: W, floorY: F, doors, setDoors, setLights, setAmbient, setRoute, setStation, walk, seats, stand, dispose,
    // extras
    height: TOP + 0.09, cars, div, doorways, doorHeight: DH, ceilingY: CEIL, cabWallZ: zp, truckZ, meshes: { shell, cab, leaves, lamps, glass, leafGlass }, texture: tex,
    get route() { return { ...route }; }, get doorState() { return { left: doorF['-1'], right: doorF['1'] }; } };
}
