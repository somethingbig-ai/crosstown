// streets/carts.js (streets lane, Nov 15 2026; Matt: "halal carts ... the famous ones as parody names at their real corners").
// Halal food carts (the stainless box cart on a trailer hitch: photo-menu band, wrap, LED strip, umbrellas, propane, generator, coolers) and the
// small hot-dog / pretzel pushcart with the blue-and-yellow umbrella. Three NAMED parody carts stand at their real corners (NAMED below); generic
// carts are spread by a seeded rule (mostly Midtown avenue corners). Everything is drawn here: geometry from boxes and cylinders, signage painted
// on a canvas at load (invented names only; the one shipped image is the Arabic word, assets/streets/carts/halal_ar.png).
//   ?carts=0            the part is not built (also ?streets=-carts)          ?cartsold=1   leave furniture.js's little cart prop standing
//   ?cartsgen=0         only the three named carts                             ?cartsteam=0  no steam
// It supersedes furniture.js's `cart` prop at load time (its meshes switched off, its two collision circles switched off); furniture.js is not edited.
// THE QUEUE HOOK (people lane): game.queues gets one entry per cart that has a line:
//   { id, name, x, y, face, pts: [[x, y], ...], n, gap, kind, vendor: { x, y, face } }   (map metres; face = map heading; vendor = where the cook stands, inside)
// Cost: every cart is its own few meshes sharing geometry and material per brand; full model within NEAR m, a 150-triangle stand-in to FAR m, nothing beyond.
import * as THREE from 'three';

const PI = Math.PI, NEAR = 85, FAR = 420, SW = 0.15;
const hsh = (a, b = 0, c = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + 0.5) * 43758.5453; return s - Math.floor(s); };
const lin = (hex) => new THREE.Color(hex);

// ------------------------------------------------------------------------------------------------ geometry builder
const AW = 1024, AH = 512, WHITE = [2, 2, 4, 4];
class GB {
  constructor(aw = AW, ah = AH) { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.k = 0; this.aw = aw; this.ah = ah; this.wu = 3 / aw; this.wv = 1 - 3 / ah; }
  vert(x, y, z, nx, ny, nz, u, v, col) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(col.r, col.g, col.b); return this.k++; }
  // a rectangle seen from the front: centre c, unit right ux, unit up uy, size w x h; rect = [x, y, w, h] in atlas pixels (WHITE = plain colour)
  quad(c, ux, uy, w, h, col, rect = WHITE, two = false) {
    const nx = ux[1] * uy[2] - ux[2] * uy[1], ny = ux[2] * uy[0] - ux[0] * uy[2], nz = ux[0] * uy[1] - ux[1] * uy[0];
    const u0 = rect[0] / this.aw, u1 = (rect[0] + rect[2]) / this.aw, v1 = 1 - rect[1] / this.ah, v0 = 1 - (rect[1] + rect[3]) / this.ah, a = [];
    for (const [sx, sy, u, v] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) a.push(this.vert(c[0] + ux[0] * sx * w / 2 + uy[0] * sy * h / 2, c[1] + ux[1] * sx * w / 2 + uy[1] * sy * h / 2, c[2] + ux[2] * sx * w / 2 + uy[2] * sy * h / 2, nx, ny, nz, u, v, col));
    this.i.push(a[0], a[1], a[2], a[0], a[2], a[3]);
    if (two) { const b = []; for (const [sx, sy, u, v] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) b.push(this.vert(c[0] + ux[0] * sx * w / 2 + uy[0] * sy * h / 2, c[1] + ux[1] * sx * w / 2 + uy[1] * sy * h / 2, c[2] + ux[2] * sx * w / 2 + uy[2] * sy * h / 2, -nx, -ny, -nz, u, v, col)); this.i.push(b[0], b[2], b[1], b[0], b[3], b[2]); }
  }
  // sign on a vertical face: dir '+z' '-z' '+x' '-x'
  sign(c, w, h, dir, rect, col = WHITEC) { const U = { '+z': [1, 0, 0], '-z': [-1, 0, 0], '+x': [0, 0, -1], '-x': [0, 0, 1] }[dir]; this.quad(c, U, [0, 1, 0], w, h, col, rect); }
  box(c, s, col, skip = '') {
    const [x, y, z] = c, [a, b, d] = [s[0] / 2, s[1] / 2, s[2] / 2];
    if (!skip.includes('f')) this.quad([x, y, z + d], [1, 0, 0], [0, 1, 0], s[0], s[1], col);
    if (!skip.includes('b')) this.quad([x, y, z - d], [-1, 0, 0], [0, 1, 0], s[0], s[1], col);
    if (!skip.includes('r')) this.quad([x + a, y, z], [0, 0, -1], [0, 1, 0], s[2], s[1], col);
    if (!skip.includes('l')) this.quad([x - a, y, z], [0, 0, 1], [0, 1, 0], s[2], s[1], col);
    if (!skip.includes('t')) this.quad([x, y + b, z], [1, 0, 0], [0, 0, -1], s[0], s[2], col);
    if (!skip.includes('u')) this.quad([x, y - b, z], [1, 0, 0], [0, 0, 1], s[0], s[2], col);
  }
  cyl(p0, p1, r0, r1, seg, col, cap = true, rect = null) {
    const ax = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), L = ax.length(); ax.normalize();
    const t = Math.abs(ax.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), e1 = new THREE.Vector3().crossVectors(ax, t).normalize(), e2 = new THREE.Vector3().crossVectors(ax, e1);
    const sl = (r0 - r1) / (L || 1), ring = [];
    for (let i = 0; i <= seg; i++) { const a = i / seg * PI * 2, cx = Math.cos(a), sn = Math.sin(a), dx = e1.x * cx + e2.x * sn, dy = e1.y * cx + e2.y * sn, dz = e1.z * cx + e2.z * sn;
      const nn = new THREE.Vector3(dx + ax.x * sl, dy + ax.y * sl, dz + ax.z * sl).normalize();
      const tu = rect ? (rect[0] + rect[2] * i / seg) / this.aw : this.wu; ring.push([this.vert(p0[0] + dx * r0, p0[1] + dy * r0, p0[2] + dz * r0, nn.x, nn.y, nn.z, tu, rect ? 1 - (rect[1] + rect[3]) / this.ah : this.wv, col), this.vert(p1[0] + dx * r1, p1[1] + dy * r1, p1[2] + dz * r1, nn.x, nn.y, nn.z, tu, rect ? 1 - rect[1] / this.ah : this.wv, col)]); }
    for (let i = 0; i < seg; i++) { const a = ring[i], b = ring[i + 1]; this.i.push(a[0], a[1], b[1], a[0], b[1], b[0]); }
    if (cap) for (const [p, r, s] of [[p0, r0, -1], [p1, r1, 1]]) { if (r < 1e-4) continue; const c0 = this.vert(p[0], p[1], p[2], ax.x * s, ax.y * s, ax.z * s, 3 / AW, 1 - 3 / AH, col), f = [];
      for (let i = 0; i <= seg; i++) { const a = i / seg * PI * 2, cx = Math.cos(a), sn = Math.sin(a); f.push(this.vert(p[0] + (e1.x * cx + e2.x * sn) * r, p[1] + (e1.y * cx + e2.y * sn) * r, p[2] + (e1.z * cx + e2.z * sn) * r, ax.x * s, ax.y * s, ax.z * s, 3 / AW, 1 - 3 / AH, col)); }
      for (let i = 0; i < seg; i++) { if (s > 0) this.i.push(c0, f[i + 1], f[i]); else this.i.push(c0, f[i], f[i + 1]); } }
  }
  // a market umbrella: n gores of cloth that sag between the ribs (smooth across a gore, creased at a rib), a scalloped valance, ribs, the pole.
  // o.fine === false: the far stand-in's cut (same outline, a quarter of the triangles, no valance scallops, no ribs)
  umbrella(x, z, yTop, R, cols, o = {}) {
    const n = o.n || 8, drop = o.drop || R * 0.36, val = o.val === undefined ? 0.15 : o.val, y0 = o.y0 || 0, rot = o.rot || 0, pole = o.pole || lin('#c9ccce'), fine = o.fine !== false, NR = fine ? 4 : 2, NA = fine ? 4 : 2, sag = R * 0.085, cn = Math.cos(PI / n), wu = this.wu, wv = this.wv;
    this.cyl([x, y0, z], [x, yTop + 0.06, z], 0.021, 0.021, 6, pole, true); this.cyl([x, yTop + 0.02, z], [x, yTop + 0.13, z], 0.036, 0.008, 6, cols[0], false);
    const S = (i, f, q) => { const a = rot + (i + f) / n * PI * 2, r = R * q * cn / Math.cos((f - 0.5) * 2 * PI / n); return [x + Math.cos(a) * r, yTop - drop * Math.pow(q, 1.25) - sag * Math.sin(PI * f) * q * (0.35 + 0.65 * q), z + Math.sin(a) * r]; };
    const nrm = (i, f, q) => { const e = 0.01, qq = Math.max(q, 0.06), A = S(i, Math.min(1, f + e), qq), B = S(i, Math.max(0, f - e), qq), C = S(i, f, qq + e), D = S(i, f, qq - e), u = [A[0] - B[0], A[1] - B[1], A[2] - B[2]], v = [C[0] - D[0], C[1] - D[1], C[2] - D[2]]; const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0], l = (Math.hypot(nx, ny, nz) || 1) * (ny < 0 ? -1 : 1); return [nx / l, ny / l, nz / l]; };
    const tri = (a, b, c, wx, wy, wz) => { const P = this.p, ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]; if ((uy * vz - uz * vy) * wx + (uz * vx - ux * vz) * wy + (ux * vy - uy * vx) * wz >= 0) this.i.push(a, b, c); else this.i.push(a, c, b); };
    for (let i = 0; i < n; i++) { const col = cols[i % cols.length], under = col.clone().multiplyScalar(0.8), vc = o.trim ? lin(o.trim) : col;
      for (const sd of [1, -1]) { const g = []; for (let a = 0; a <= NA; a++) { g.push([]); for (let r = 0; r <= NR; r++) { const p = S(i, a / NA, r / NR), m = nrm(i, a / NA, r / NR); g[a].push(this.vert(p[0], p[1], p[2], m[0] * sd, m[1] * sd, m[2] * sd, wu, wv, sd > 0 ? col : under)); } }
        for (let a = 0; a < NA; a++) for (let r = 0; r < NR; r++) { if (r > 0) tri(g[a][r], g[a + 1][r], g[a + 1][r + 1], 0, sd, 0); tri(g[a][r], g[a + 1][r + 1], g[a][r + 1], 0, sd, 0); } }
      if (val > 0) { const NV = fine ? 8 : 2; for (const sd of [1, -1]) { const t = [], bt = []; for (let k = 0; k <= NV; k++) { const f = k / NV, p = S(i, f, 1), am = rot + (i + 0.5) / n * PI * 2, ox = Math.cos(am) * sd, oz = Math.sin(am) * sd, d = fine ? val * (0.45 + 0.55 * Math.sqrt(Math.abs(Math.sin(PI * f * 2)))) : val * 0.8;
            t.push(this.vert(p[0], p[1], p[2], ox, 0, oz, wu, wv, sd > 0 ? vc : vc.clone().multiplyScalar(0.8))); bt.push(this.vert(p[0] + ox * sd * 0.012, p[1] - d, p[2] + oz * sd * 0.012, ox, 0, oz, wu, wv, sd > 0 ? vc : vc.clone().multiplyScalar(0.8))); }
          const am = rot + (i + 0.5) / n * PI * 2, ox = Math.cos(am) * sd, oz = Math.sin(am) * sd; for (let k = 0; k < NV; k++) { tri(t[k], t[k + 1], bt[k + 1], ox, 0, oz); tri(t[k], bt[k + 1], bt[k], ox, 0, oz); } } }
      if (fine) { const tp = S(i, 0, 1); this.cyl([x, yTop - 0.025, z], [tp[0], tp[1] - 0.012, tp[2]], 0.007, 0.006, 3, pole, false); } }
  }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i); g.computeBoundingSphere(); return g; }
  get tris() { return this.i.length / 3; }
}
const WHITEC = lin('#ffffff');

// ------------------------------------------------------------------------------------------------ signage (canvas)
const FONT = (px, w = 900, it = false) => `${it ? 'italic ' : ''}${w} ${px}px Impact, "Arial Black", "Helvetica Neue", "Liberation Sans", Arial, sans-serif`;
const R = { fasciaF: [0, 8, 1024, 144], bodyF: [0, 160, 704, 176], endA: [712, 160, 310, 86], endB: [712, 250, 310, 86], bodyB: [0, 344, 672, 168], post1: [680, 344, 168, 168], post2: [852, 344, 168, 168] };
const MENU = [['CHICKEN', 'OVER RICE', '$9', 'chicken'], ['LAMB', 'OVER RICE', '$10', 'lamb'], ['COMBO', 'OVER RICE', '$10', 'combo'], ['GYRO', 'ON PITA', '$8', 'gyro'], ['FALAFEL', 'OVER RICE', '$8', 'falafel'], ['CHICKEN', 'GYRO', '$8', 'gyro2'], ['KOFTA', 'KEBAB', '$9', 'kebab'], ['FRENCH', 'FRIES', '$5', 'fries'], ['HOT DOG', '', '$4', 'hotdog'], ['PHILLY', 'CHEESE STEAK', '$10', 'philly']];
function rnd(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
// a little food photograph: a foil plate of rice and meat, a pita wrap, fries, a hot dog... painted with enough grain to read as a photo at 3 m
function dish(g, x, y, w, h, kind, seed, bare) {
  const r = rnd(seed + 7); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (!bare) { const bg = g.createLinearGradient(x, y, x, y + h); bg.addColorStop(0, '#2a1508'); bg.addColorStop(1, '#0d0603'); g.fillStyle = bg; g.fillRect(x, y, w, h); }
  const cx = x + w / 2, cy = y + h * 0.54, rx = w * 0.44, ry = h * 0.4;
  const blob = (px, py, s, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(px, py, s * (0.7 + r() * 0.6), s * (0.5 + r() * 0.5), r() * 3, 0, 7); g.fill(); };
  const scatter = (n, cols, s, x0, x1, y0, y1) => { for (let i = 0; i < n; i++) { const a = r() * 7, q = Math.sqrt(r()); const px = cx + Math.cos(a) * q * rx * 0.86, py = cy + Math.sin(a) * q * ry * 0.82; if (px < cx + x0 * rx || px > cx + x1 * rx || py < cy + y0 * ry || py > cy + y1 * ry) continue; blob(px, py, s, cols[Math.floor(r() * cols.length)]); } };
  const drizzle = (col, lw, x0, x1) => { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); for (let i = 0; i <= 9; i++) { const px = cx + (x0 + (x1 - x0) * i / 9) * rx, py = cy + (i % 2 ? 0.42 : -0.38) * ry + (r() - 0.5) * 4; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); };
  const plate = () => { if (bare) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(cx + 3, cy + 4, rx, ry, 0, 0, 7); g.fill(); } g.fillStyle = '#f4f5f6'; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); g.strokeStyle = '#9aa0a6'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#c8ccd0'; g.beginPath(); g.ellipse(cx, cy, rx * 0.9, ry * 0.88, 0, 0, 7); g.fill(); };
  const rice = () => scatter(260, ['#f2c12e', '#f7d351', '#e8a81c', '#fbe07a', '#eeb425'], w * 0.022, -1, 1, -1, 1);
  const salad = () => { scatter(70, ['#7fb53a', '#a5d05a', '#d9ecb0', '#5d9a2b', '#f1f6e2'], w * 0.035, -1, -0.25, -1, 1); scatter(8, ['#d6321f', '#e9503a'], w * 0.04, -1, -0.3, -1, 1); };
  const meat = (cols) => scatter(120, cols, w * 0.036, -0.2, 1, -1, 1);
  const CH = ['#c97a24', '#e0993a', '#a8591a', '#f0b458', '#8a4313'], LB = ['#6b3a1c', '#8a4e25', '#4f2913', '#a0612f', '#3c1e0e'];
  if (kind === 'chicken' || kind === 'lamb' || kind === 'combo' || kind === 'falafel' || kind === 'kebab') { plate(); rice(); salad();
    if (kind === 'falafel') { for (let i = 0; i < 6; i++) { const px = cx + (0.1 + r() * 0.6) * rx, py = cy + (r() - 0.5) * ry * 1.1; g.fillStyle = '#7a4a17'; g.beginPath(); g.arc(px, py, w * 0.075, 0, 7); g.fill(); g.fillStyle = '#a56b28'; g.beginPath(); g.arc(px - 2, py - 2, w * 0.045, 0, 7); g.fill(); } }
    else if (kind === 'kebab') { for (let i = 0; i < 3; i++) { g.save(); g.translate(cx + rx * 0.35, cy + (i - 1) * ry * 0.42); g.rotate(-0.15); g.fillStyle = '#5a2f14'; g.beginPath(); g.roundRect(-rx * 0.5, -h * 0.05, rx, h * 0.1, h * 0.05); g.fill(); g.fillStyle = '#8a5326'; g.fillRect(-rx * 0.4, -h * 0.03, rx * 0.8, h * 0.02); g.restore(); } }
    else { meat(kind === 'chicken' ? CH : kind === 'lamb' ? LB : CH.concat(LB)); }
    drizzle('#fbfbf6', Math.max(2, w * 0.022), -0.75, 0.85); if (seed % 2) drizzle('#c8261a', Math.max(1.5, w * 0.014), -0.2, 0.9); }
  else if (kind === 'gyro' || kind === 'gyro2' || kind === 'philly') { g.save(); g.translate(cx, cy); g.rotate(-0.32);
    g.fillStyle = '#c9cdd1'; g.beginPath(); g.moveTo(-rx * 0.2, -ry * 0.75); g.lineTo(rx * 0.95, -ry * 0.45); g.lineTo(rx * 0.95, ry * 0.55); g.lineTo(-rx * 0.2, ry * 0.8); g.closePath(); g.fill();
    g.fillStyle = kind === 'philly' ? '#d9a55c' : '#e8cf9c'; g.beginPath(); g.ellipse(-rx * 0.1, 0, rx * 0.85, ry * 0.72, 0, 0, 7); g.fill(); g.strokeStyle = '#b98f52'; g.lineWidth = 2; g.stroke();
    for (let i = 0; i < 46; i++) { const px = -rx * 0.75 + r() * rx * 0.8, py = (r() - 0.5) * ry * 1.0; blob(px, py, w * 0.04, (kind === 'gyro' ? LB : CH).concat(['#7fb53a', '#f1f6e2', '#d6321f'])[Math.floor(r() * 8)]); }
    g.strokeStyle = '#fbfbf6'; g.lineWidth = w * 0.02; g.beginPath(); g.moveTo(-rx * 0.8, -ry * 0.2); g.quadraticCurveTo(-rx * 0.4, ry * 0.4, -rx * 0.05, -ry * 0.25); g.stroke(); g.restore(); }
  else if (kind === 'fries') { g.fillStyle = '#c8261a'; g.beginPath(); g.moveTo(cx - rx * 0.5, cy); g.lineTo(cx + rx * 0.5, cy); g.lineTo(cx + rx * 0.38, cy + ry); g.lineTo(cx - rx * 0.38, cy + ry); g.fill();
    for (let i = 0; i < 26; i++) { g.save(); g.translate(cx + (r() - 0.5) * rx * 0.9, cy + 2); g.rotate((r() - 0.5) * 0.7); g.fillStyle = ['#f3c13a', '#e9a923', '#f8d568'][i % 3]; g.fillRect(-w * 0.02, -ry * (0.5 + r() * 0.6), w * 0.04, ry * 1.1); g.restore(); } }
  else if (kind === 'hotdog' || kind === 'pretzel') { if (kind === 'hotdog') { g.save(); g.translate(cx, cy); g.rotate(-0.2); g.fillStyle = '#e2b56b'; g.beginPath(); g.roundRect(-rx * 0.9, -ry * 0.45, rx * 1.8, ry * 0.95, ry * 0.45); g.fill(); g.fillStyle = '#a8401f'; g.beginPath(); g.roundRect(-rx, -ry * 0.28, rx * 2, ry * 0.42, ry * 0.2); g.fill(); g.fillStyle = '#c9603a'; g.fillRect(-rx * 0.9, -ry * 0.24, rx * 1.8, ry * 0.08);
      g.strokeStyle = '#f1c40f'; g.lineWidth = w * 0.03; g.beginPath(); for (let i = 0; i <= 10; i++) { const px = -rx * 0.8 + i * rx * 0.16, py = (i % 2 ? -1 : 1) * ry * 0.1 - ry * 0.08; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); g.restore(); }
    else { g.strokeStyle = '#8a4b14'; g.lineWidth = w * 0.11; g.lineCap = 'round'; g.beginPath(); g.ellipse(cx - rx * 0.3, cy - ry * 0.1, rx * 0.32, ry * 0.42, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(cx + rx * 0.3, cy - ry * 0.1, rx * 0.32, ry * 0.42, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(cx - rx * 0.5, cy + ry * 0.75); g.quadraticCurveTo(cx, cy - ry * 0.3, cx + rx * 0.5, cy + ry * 0.75); g.stroke();
      g.strokeStyle = '#b8742a'; g.lineWidth = w * 0.05; g.beginPath(); g.ellipse(cx - rx * 0.3, cy - ry * 0.13, rx * 0.32, ry * 0.42, 0, 3.4, 5.6); g.stroke(); g.beginPath(); g.ellipse(cx + rx * 0.3, cy - ry * 0.13, rx * 0.32, ry * 0.42, 0, 3.4, 5.6); g.stroke(); g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect(cx + (r() - 0.5) * rx * 1.5, cy + (r() - 0.6) * ry * 1.2, 1.6, 1.6); } }
  // photo grain and a soft highlight
  for (let i = 0; i < (bare ? 0 : w * h / 28); i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)'; g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5); }
  const hl = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.5, 2, cx, cy, rx * 1.3); hl.addColorStop(0, 'rgba(255,255,255,0.16)'); hl.addColorStop(1, 'rgba(0,0,0,0.18)'); if (!bare) { g.fillStyle = hl; g.fillRect(x, y, w, h); } g.restore();
}
function fit(g, txt, x, y, maxW, px, col, o = {}) { let s = px; g.font = FONT(s, o.w || 900, o.it); while (g.measureText(txt).width > maxW && s > 6) { s -= 1; g.font = FONT(s, o.w || 900, o.it); } g.textAlign = o.align || 'center'; g.textBaseline = o.base || 'middle'; if (o.stroke) { g.lineJoin = 'round'; g.lineWidth = o.sw || Math.max(2, s * 0.16); g.strokeStyle = o.stroke; g.strokeText(txt, x, y); } g.fillStyle = col; g.fillText(txt, x, y); return s; }
function roundel(g, ar, cx, cy, rad, ring = '#0a7a34', fill = '#fff', ink = '#0a7a34') { g.fillStyle = ring; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, rad * 0.84, 0, 7); g.fill();
  if (ar) { const w = rad * 1.25, h = w * ar.height / ar.width; const t = document.createElement('canvas'); t.width = Math.ceil(w); t.height = Math.ceil(h); const q = t.getContext('2d'); q.drawImage(ar, 0, 0, t.width, t.height); q.globalCompositeOperation = 'source-in'; q.fillStyle = ink; q.fillRect(0, 0, t.width, t.height); g.drawImage(t, cx - w / 2, cy - h / 2 - rad * 0.12); }
  fit(g, 'HALAL', cx, cy + rad * 0.5, rad * 1.0, rad * 0.3, ink); }
function arInk(g, ar, x, y, h, ink) { if (!ar) return 0; const w = h * ar.width / ar.height, t = document.createElement('canvas'); t.width = Math.ceil(w); t.height = Math.ceil(h); const q = t.getContext('2d'); q.drawImage(ar, 0, 0, t.width, t.height); q.globalCompositeOperation = 'source-in'; q.fillStyle = ink; q.fillRect(0, 0, t.width, t.height); g.drawImage(t, x - w / 2, y - h / 2); return w; }
function grime(g, rect, seed, k = 1) { const r = rnd(seed), [x, y, w, h] = rect; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); for (let i = 0; i < 26 * k; i++) { const px = x + r() * w, len = h * (0.2 + r() * 0.6); const gr = g.createLinearGradient(0, y + h - len, 0, y + h); gr.addColorStop(0, 'rgba(40,30,20,0)'); gr.addColorStop(1, `rgba(40,30,20,${0.05 + r() * 0.1})`); g.fillStyle = gr; g.fillRect(px, y + h - len, 2 + r() * 10, len); }
  const fd = g.createLinearGradient(0, y, 0, y + h); fd.addColorStop(0, 'rgba(255,255,255,0.05)'); fd.addColorStop(1, 'rgba(30,20,10,0.16)'); g.fillStyle = fd; g.fillRect(x, y, w, h); g.restore(); }

function drips(g, rect, seed, k = 1) { const r = rnd(seed + 3), [x, y, w, h] = rect; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); for (let i = 0; i < 18 * k; i++) { const px = x + r() * w, len = h * (0.15 + r() * 0.6), ww = 2 + r() * 7, gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, `rgba(58,40,22,${0.16 + r() * 0.2})`); gr.addColorStop(1, 'rgba(58,40,22,0)'); g.fillStyle = gr; g.fillRect(px, y, ww, len); } for (let i = 0; i < 40 * k; i++) { g.fillStyle = `rgba(40,30,20,${0.05 + r() * 0.1})`; g.beginPath(); g.ellipse(x + r() * w, y + r() * h, 2 + r() * 9, 1 + r() * 4, r() * 3, 0, 7); g.fill(); } g.restore(); }
// brand = { id, name, lines, fbg (fascia), wrap (body), ink, ink2, band, umb: [colours], style }
function paintAtlas(B, ar) {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, AW, AH); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8);
  const hot = B.kind === 'hotdog', seed = B.seed || 1;
  // ---- the photo-menu band over the window
  { const [x, y, w, h] = R.fasciaF; g.fillStyle = B.fbg; g.fillRect(x, y, w, h); const nameW = B.named ? 300 : 0, n = B.named ? 5 : 7, cw = (w - nameW) / n, items = hot ? [['HOT DOG', '', '$4', 'hotdog'], ['PRETZEL', '', '$4', 'pretzel'], ['HOT', 'SAUSAGE', '$6', 'hotdog'], ['FRENCH', 'FRIES', '$5', 'fries'], ['CHICKEN', 'KEBAB', '$7', 'kebab'], ['PRETZEL', '', '$4', 'pretzel'], ['HOT DOG', '', '$4', 'hotdog']] : MENU;
    for (let i = 0; i < n; i++) { const it = items[(i + seed * 3) % items.length], half = B.named && i >= Math.ceil(n / 2) ? nameW : 0, cx0 = x + i * cw + half; if (B.named && i === Math.ceil(n / 2)) { /* name panel sits before this cell */ }
      dish(g, cx0 + 4, y + 3, cw - 8, h * 0.66, it[3], seed * 31 + i, true);
      fit(g, it[0], cx0 + cw * 0.4, y + h * 0.75, cw * 0.72, 19, B.ink, { stroke: B.fstroke }); if (it[1]) fit(g, it[1], cx0 + cw * 0.4, y + h * 0.9, cw * 0.72, 16, B.ink2, { stroke: B.fstroke });
      g.fillStyle = B.price || '#d81e1e'; g.beginPath(); g.arc(cx0 + cw * 0.86, y + h * 0.81, 17, 0, 7); g.fill(); fit(g, it[2], cx0 + cw * 0.86, y + h * 0.82, 30, 18, '#fff'); }
    if (B.named) { const nx = x + Math.ceil(n / 2) * cw; g.fillStyle = B.wrap; g.fillRect(nx, y, nameW, h); g.strokeStyle = B.ink2; g.lineWidth = 4; g.strokeRect(nx + 3, y + 3, nameW - 6, h - 6); B.namePanel(g, nx, y, nameW, h, ar); } }
  // ---- the wrap on the body, service side
  { const [x, y, w, h] = R.bodyF; g.fillStyle = B.wrap; g.fillRect(x, y, w, h);
    if (B.bodyPanel) B.bodyPanel(g, x, y, w, h, ar);
    else if (hot) { g.fillStyle = B.band; g.fillRect(x, y + h * 0.7, w, h * 0.3); dish(g, x + 12, y + 12, 150, 100, 'hotdog', seed); dish(g, x + w - 162, y + 12, 150, 100, 'pretzel', seed + 3); fit(g, 'HOT DOGS', x + w / 2, y + 44, w - 350, 70, B.ink, { stroke: B.fstroke }); fit(g, 'PRETZELS • COLD SODA', x + w / 2, y + 98, w - 350, 36, B.ink2, { stroke: B.fstroke }); fit(g, 'WATER $2    SODA $3    HOT SAUSAGE $6    KNISH $5', x + w / 2, y + h * 0.85, w - 30, 30, '#fff'); }
    else { g.fillStyle = B.band; g.fillRect(x, y + h * 0.68, w, h * 0.32); roundel(g, ar, x + 76, y + h * 0.36, 54, B.ring || '#0a7a34'); roundel(g, ar, x + w - 76, y + h * 0.36, 54, B.ring || '#0a7a34');
      fit(g, B.name, x + w / 2, y + 40, w - 300, 58, B.ink, { stroke: B.fstroke, it: B.it }); fit(g, B.tag || 'HALAL FOOD', x + w / 2, y + 92, w - 300, 40, B.ink2, { stroke: B.fstroke });
      fit(g, 'CHICKEN OVER RICE • GYRO • LAMB OVER RICE • FALAFEL', x + w / 2, y + h * 0.84, w - 24, 34, B.bandInk || '#ffe23a'); }
    grime(g, R.bodyF, seed, hot ? 0.6 : 1.5); if (!hot) drips(g, R.bodyF, seed, 1); }
  // ---- the two end bands
  for (const [k, txt] of [['endA', hot ? 'COLD DRINKS' : 'HALAL FOOD'], ['endB', B.short || B.name]]) { const [x, y, w, h] = R[k]; g.fillStyle = B.fbg; g.fillRect(x, y, w, h); g.strokeStyle = B.ink2; g.lineWidth = 3; g.strokeRect(x + 2, y + 2, w - 4, h - 4); const aw = !hot && k === 'endA' ? arInk(g, ar, x + w - 52, y + h / 2, h * 0.62, B.ink2) : 0; fit(g, txt, x + (w - (aw ? 84 : 0)) / 2, y + h / 2 + 2, w - (aw ? 110 : 24), 50, B.ink, { stroke: B.fstroke }); }
  // ---- the street side of the body
  { const [x, y, w, h] = R.bodyB; g.fillStyle = B.wrap; g.fillRect(x, y, w, h);
    if (B.backPanel) B.backPanel(g, x, y, w, h, ar);
    else if (hot) { fit(g, 'HOT DOGS', x + w / 2, y + h * 0.36, w - 40, 96, B.ink, { stroke: B.fstroke }); fit(g, 'PRETZELS • SODA • WATER', x + w / 2, y + h * 0.78, w - 40, 40, B.ink2, { stroke: B.fstroke }); }
    else { dish(g, x + 10, y + 10, 190, h - 20, 'combo', seed + 9); dish(g, x + w - 200, y + 10, 190, h - 20, 'gyro', seed + 11); g.lineWidth = 3; g.strokeStyle = B.ink2; g.strokeRect(x + 10, y + 10, 190, h - 20); g.strokeRect(x + w - 200, y + 10, 190, h - 20);
      fit(g, 'HALAL', x + w / 2, y + 44, 250, 74, B.ink, { stroke: B.fstroke }); fit(g, 'FOOD', x + w / 2 - 44, y + 108, 150, 60, B.ink2, { stroke: B.fstroke }); arInk(g, ar, x + w / 2 + 78, y + 104, 54, B.ink); fit(g, B.name, x + w / 2, y + h - 20, 250, 24, B.ink2, { stroke: B.fstroke }); }
    grime(g, R.bodyB, seed + 5, 1.8); if (!hot) drips(g, R.bodyB, seed + 9, 1.3); }
  // ---- two sheets taped in the window: the price list and the special
  { const [x, y, w, h] = R.post1; g.fillStyle = '#fbfaf2'; g.fillRect(x, y, w, h); g.fillStyle = B.band; g.fillRect(x, y, w, 30); fit(g, hot ? 'PRICES' : 'MENU', x + w / 2, y + 16, w - 10, 24, '#fff');
    const rows = hot ? [['HOT DOG', '4.00'], ['SAUSAGE', '6.00'], ['PRETZEL', '4.00'], ['KNISH', '5.00'], ['SODA', '3.00'], ['WATER', '2.00']] : [['CHICKEN / RICE', '9.00'], ['LAMB / RICE', '10.00'], ['COMBO / RICE', '10.00'], ['GYRO PITA', '8.00'], ['FALAFEL', '8.00'], ['SODA / WATER', '2.00']];
    rows.forEach((rw, i) => { const yy = y + 46 + i * 21; fit(g, rw[0], x + 8, yy, w * 0.62, 15, '#151515', { align: 'left', w: 700 }); fit(g, rw[1], x + w - 8, yy, w * 0.3, 15, '#b3160f', { align: 'right', w: 700 }); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 8, yy + 10, w - 16, 1); }); }
  { const [x, y, w, h] = R.post2; g.fillStyle = B.fbg; g.fillRect(x, y, w, h); dish(g, x + 6, y + 6, w - 12, h * 0.56, hot ? 'hotdog' : 'combo', seed + 21); g.fillStyle = '#ffe23a'; g.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * PI * 2, rr = i % 2 ? 30 : 22; g.lineTo(x + w - 34 + Math.cos(a) * rr, y + 34 + Math.sin(a) * rr); } g.fill(); fit(g, hot ? '$4' : '$9', x + w - 34, y + 35, 34, 22, '#c2140e');
    fit(g, hot ? '2 HOT DOGS' : 'LUNCH SPECIAL', x + w / 2, y + h * 0.7, w - 12, 24, B.ink, { stroke: B.fstroke }); fit(g, hot ? '+ SODA $9' : 'WITH FREE SODA', x + w / 2, y + h * 0.87, w - 12, 20, B.ink2, { stroke: B.fstroke }); }
  // ---- what glows at night: the menu band, the end bands, the window sheets (dimmer)
  const ev = document.createElement('canvas'); ev.width = AW; ev.height = AH; const e = ev.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, AW, AH);
  for (const [k, a] of [['fasciaF', 1], ['endA', 0.9], ['endB', 0.9], ['post1', 0.35], ['post2', 0.45]]) { const [x, y, w, h] = R[k]; e.globalAlpha = a; e.drawImage(cv, x, y, w, h, x, y, w, h); } e.globalAlpha = 1;
  e.fillStyle = '#fff'; e.fillRect(12, 0, 8, 8);     // the lamp texel (plain white light: the tube under the roof)
  g.fillStyle = '#f4f6ff'; g.fillRect(12, 0, 8, 8);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const em = new THREE.CanvasTexture(ev); em.colorSpace = THREE.SRGBColorSpace; em.anisotropy = 4;
  return { tex, em };
}
const LAMP = [14, 2, 4, 4];

// ------------------------------------------------------------------------------------------------ the brands
const G = '#0a7a34', RD = '#d81e1e', YL = '#ffd21a';
const GENERIC = [
  { id: 'kings', name: 'KING OF RICE', fbg: '#b3120c', wrap: '#f6c915', ink: '#c2140e', ink2: '#0a6a2e', fstroke: '#fff', band: '#0a6a2e', umb: ['#d81e1e', '#ffd21a'] },
  { id: 'sixth', name: 'MIDTOWN HALAL', fbg: '#0e5c2c', wrap: '#f3f1e6', ink: '#c2140e', ink2: '#0a6a2e', fstroke: '#fff', band: '#c2140e', umb: ['#d81e1e', '#f0a81c', '#2a8a3a', '#1f5fb8'] },
  { id: 'sammy', name: "RAFIQ'S GRILL", tag: 'HALAL GYRO & PLATTERS', fbg: '#101010', wrap: '#c2140e', ink: '#ffd21a', ink2: '#ffffff', fstroke: '#1a0a05', band: '#101010', umb: ['#1f5fb8', '#f3f1e6'] },
  { id: 'nyc', name: 'NEW YORK BEST HALAL', fbg: '#f6c915', wrap: '#14509e', ink: '#ffd21a', ink2: '#ffffff', fstroke: '#0b2444', band: '#c2140e', umb: ['#d81e1e', '#f3f1e6'], price: '#14509e' },
  { id: 'cairo', name: 'PYRAMID HALAL FOOD', fbg: '#c2140e', wrap: '#fff3c4', ink: '#0a6a2e', ink2: '#c2140e', fstroke: '#fff', band: '#0a6a2e', umb: ['#2a8a3a', '#ffd21a'] },
  { id: 'star', name: 'SHAH JAHAN HALAL', tag: 'CHICKEN • LAMB • FALAFEL', fbg: '#5a0f6a', wrap: '#f6c915', ink: '#5a0f6a', ink2: '#c2140e', fstroke: '#fff', band: '#5a0f6a', umb: ['#d81e1e', '#ffd21a', '#1f5fb8', '#2a8a3a', '#f08a1c'] },
];
const HOTDOG = [
  { id: 'hd1', kind: 'hotdog', name: 'HOT DOGS', short: 'HOT DOGS', fbg: '#14509e', wrap: '#f6c915', ink: '#c2140e', ink2: '#14509e', fstroke: '#fff', band: '#14509e', umb: ['#1b4fa8', '#f6c915'] },
  { id: 'hd2', kind: 'hotdog', name: 'HOT DOGS', short: 'PRETZELS', fbg: '#c2140e', wrap: '#fdfbf0', ink: '#c2140e', ink2: '#14509e', fstroke: '#fff', band: '#c2140e', umb: ['#1b4fa8', '#f6c915'] },
];
// The three named parodies. Each echoes the real cart's look (see README: what was checked) with an invented name and an invented mark.
const NAMED = [
  { id: 'fastmeal', named: true, name: 'FAST MEAL', short: 'FAST MEAL', fbg: '#0d3f8a', wrap: '#f4f6f8', ink: '#ffffff', ink2: '#ffd21a', fstroke: '#06204a', band: '#0d3f8a', umb: ['#0d3f8a', '#f4f6f8'], price: '#c2140e', seed: 3,
    namePanel(g, x, y, w, h) { g.fillStyle = '#f4f6f8'; g.fillRect(x + 5, y + 5, w - 10, h - 10); chefHat(g, x + 44, y + h / 2 - 4, 30, '#0d3f8a'); fit(g, 'FAST MEAL', x + w / 2 + 34, y + 52, w - 100, 58, '#0d3f8a', { it: true }); fit(g, 'LAMB OVER RICE • SINCE 2000', x + w / 2 + 30, y + 104, w - 96, 20, '#c2140e'); },
    bodyPanel(g, x, y, w, h, ar) { g.fillStyle = '#0d3f8a'; g.fillRect(x, y + h * 0.72, w, h * 0.28); chefHat(g, x + 84, y + h * 0.36, 52, '#0d3f8a'); fit(g, 'FAST MEAL', x + w / 2 + 20, y + 52, w - 330, 84, '#0d3f8a', { it: true }); fit(g, 'A CHEF COOKS YOUR LUNCH', x + w / 2 + 20, y + 106, w - 330, 28, '#c2140e'); roundel(g, ar, x + w - 76, y + h * 0.36, 52, '#0a7a34'); fit(g, 'MARINATED LAMB • CHICKEN • FALAFEL • MANGO LASSI', x + w / 2, y + h * 0.86, w - 24, 30, '#ffffff'); },
    backPanel(g, x, y, w, h, ar) { chefHat(g, x + 90, y + h / 2, 62, '#0d3f8a'); fit(g, 'FAST MEAL', x + w / 2 + 50, y + 56, w - 220, 96, '#0d3f8a', { it: true }); fit(g, 'HALAL FOOD', x + w / 2 + 10, y + 126, w - 330, 44, '#c2140e'); arInk(g, ar, x + w - 80, y + 124, 50, '#0a7a34'); },
    at: { node: [340.6, 1329.2], q: [4, 6] } },
  { id: 'fadels', named: true, name: "FADEL'S FAMOUS HALAL FOOD", short: "FADEL'S FAMOUS", fbg: '#f6c915', wrap: '#f6c915', ink: '#c2140e', ink2: '#0a6a2e', fstroke: '#ffffff', band: '#0a6a2e', umb: ['#d81e1e', '#ffd21a', '#2a8a3a', '#1f5fb8', '#f08a1c', '#7a2a9a'], seed: 5,
    namePanel(g, x, y, w, h, ar) { fit(g, "FADEL'S", x + w / 2, y + 36, w - 24, 54, '#c2140e', { stroke: '#fff' }); fit(g, 'FAMOUS', x + w / 2, y + 80, w - 90, 38, '#0a6a2e', { stroke: '#fff' }); fit(g, 'HALAL FOOD', x + w / 2 - 24, y + 118, w - 110, 30, '#c2140e', { stroke: '#fff' }); arInk(g, ar, x + w - 44, y + 116, 32, '#0a6a2e'); },
    bodyPanel(g, x, y, w, h, ar) { g.fillStyle = '#c2140e'; g.fillRect(x, y + h * 0.72, w, h * 0.28); roundel(g, ar, x + 70, y + h * 0.36, 52); roundel(g, ar, x + w - 70, y + h * 0.36, 52); fit(g, "FADEL'S FAMOUS", x + w / 2, y + 46, w - 290, 78, '#c2140e', { stroke: '#fff' }); fit(g, 'HALAL FOOD', x + w / 2, y + 102, w - 330, 46, '#0a6a2e', { stroke: '#fff' }); fit(g, 'CHICKEN OVER RICE • LAMB • COMBO • EXTRA WHITE SAUCE', x + w / 2, y + h * 0.86, w - 24, 30, '#ffe23a'); },
    backPanel(g, x, y, w, h, ar) { dish(g, x + 10, y + 10, 170, h - 20, 'combo', 77); dish(g, x + w - 180, y + 10, 170, h - 20, 'chicken', 78); fit(g, "FADEL'S FAMOUS", x + w / 2, y + 46, w - 380, 70, '#c2140e', { stroke: '#fff' }); fit(g, 'HALAL FOOD', x + w / 2 - 34, y + 106, w - 440, 52, '#0a6a2e', { stroke: '#fff' }); arInk(g, ar, x + w / 2 + 112, y + 104, 46, '#c2140e'); fit(g, 'THE LINE IS WORTH IT', x + w / 2, y + h - 18, 280, 22, '#c2140e'); },
    at: { node: [494.8, 1606.0], q: [26, 30] } },
  { id: 'dudes', named: true, name: 'THE YELLOW BAG', short: 'THE YELLOW BAG', fbg: '#ffcf0a', wrap: '#ffcf0a', ink: '#c2140e', ink2: '#1a1a1a', fstroke: '#ffffff', band: '#c2140e', bandInk: '#ffcf0a', umb: ['#ffcf0a'], umbTrim: '#c2140e', seed: 8,
    namePanel(g, x, y, w, h) { dudeMark(g, x + 62, y + h / 2, 50); fit(g, 'THE YELLOW', x + w / 2 + 52, y + 46, w - 136, 46, '#c2140e'); fit(g, 'BAG', x + w / 2 + 52, y + 96, w - 136, 56, '#c2140e'); },
    bodyPanel(g, x, y, w, h) { g.fillStyle = '#c2140e'; g.fillRect(x, y + h * 0.74, w, h * 0.26); dudeMark(g, x + 84, y + h * 0.37, 60); dudeMark(g, x + w - 84, y + h * 0.37, 60); fit(g, 'THE YELLOW BAG', x + w / 2, y + 50, w - 330, 80, '#c2140e'); fit(g, 'SAME CORNER. EVERY NIGHT.', x + w / 2, y + 106, w - 340, 30, '#1a1a1a'); fit(g, 'CHICKEN • GYRO • COMBO PLATTER • WHITE SAUCE • HOT SAUCE', x + w / 2, y + h * 0.87, w - 24, 28, '#ffcf0a'); },
    backPanel(g, x, y, w, h) { dudeMark(g, x + 92, y + h / 2, 72); dudeMark(g, x + w - 92, y + h / 2, 72); fit(g, 'THE YELLOW', x + w / 2, y + 54, w - 380, 70, '#c2140e'); fit(g, 'BAG', x + w / 2, y + 120, w - 420, 70, '#c2140e'); },
    at: { node: [648.3, 1882.4], q: [11, 13] } },
];
function chefHat(g, cx, cy, s, col) { g.fillStyle = col; g.beginPath(); g.arc(cx - s * 0.42, cy - s * 0.25, s * 0.36, 0, 7); g.arc(cx + s * 0.42, cy - s * 0.25, s * 0.36, 0, 7); g.arc(cx, cy - s * 0.45, s * 0.44, 0, 7); g.fill(); g.fillRect(cx - s * 0.5, cy - s * 0.2, s, s * 0.62); g.fillStyle = '#fff'; g.fillRect(cx - s * 0.5, cy + s * 0.2, s, s * 0.06); }
function dudeMark(g, cx, cy, rad) { g.fillStyle = '#c2140e'; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); g.fillStyle = '#ffcf0a'; g.beginPath(); g.arc(cx, cy, rad * 0.86, 0, 7); g.fill(); g.fillStyle = '#c2140e'; g.beginPath(); g.arc(cx, cy, rad * 0.7, 0, 7); g.fill();
  g.fillStyle = '#ffcf0a'; g.beginPath(); g.ellipse(cx, cy + rad * 0.2, rad * 0.46, rad * 0.2, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(cx, cy + rad * 0.1, rad * 0.34, rad * 0.16, 0, PI, 0); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, rad * 0.05); for (const k of [-1, 0, 1]) { g.beginPath(); g.moveTo(cx + k * rad * 0.16, cy - rad * 0.14); g.quadraticCurveTo(cx + k * rad * 0.16 + rad * 0.08, cy - rad * 0.3, cx + k * rad * 0.16, cy - rad * 0.46); g.stroke(); } }

// ------------------------------------------------------------------------------------------------ the models
const MW = 256, MR = { hand1: [0, 8, 128, 96], hand2: [128, 8, 128, 96], onion: [0, 108, 96, 96], water: [96, 108, 160, 64], card: [96, 176, 96, 76], tips: [196, 176, 56, 40] };
function paintMess() { const cv = document.createElement('canvas'); cv.width = cv.height = MW; const g = cv.getContext('2d'), r = rnd(77); g.fillStyle = '#fff'; g.fillRect(0, 0, MW, MW);
  const HF = (px) => `700 ${px}px "Marker Felt", "Bradley Hand", "Comic Sans MS", "Segoe Print", cursive`, hand = (t, x, y, px, col, rot) => { g.save(); g.translate(x, y); g.rotate(rot); g.font = HF(px); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(t, 0, 0); g.restore(); };
  const tape = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(214,200,150,0.9)'; g.fillRect(-12, -5, 24, 10); g.restore(); };
  { const [x, y, w, h] = MR.hand1; g.fillStyle = '#b89462'; g.fillRect(x, y, w, h); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(90,60,30,0.08)'; g.fillRect(x, y + r() * h, w, 1); } hand('WATER $1', x + w / 2, y + 20, 24, '#111', -0.04); hand('SODA $2', x + w / 2 - 4, y + 48, 25, '#111', 0.03); hand('SNAPPLE $3', x + w / 2 + 2, y + 76, 20, '#a3140e', -0.02); tape(x + 10, y + 4, -0.5); tape(x + w - 10, y + 4, 0.5); }
  { const [x, y, w, h] = MR.hand2; g.fillStyle = '#f3f1e7'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(x + 1, y + 1, w - 2, h - 2); hand('CASH', x + w / 2, y + 24, 34, '#b3140e', -0.03); hand('ONLY!', x + w / 2 + 3, y + 54, 30, '#b3140e', 0.02); hand('no $50 $100 bills', x + w / 2, y + 82, 14, '#111', -0.01); tape(x + w / 2, y + 4, 0.05); }
  { const [x, y, w, h] = MR.onion; g.fillStyle = '#a34a26'; g.fillRect(x, y, w, h); for (let i = 0; i < 60; i++) { g.fillStyle = ['#c9793f', '#d99a5a', '#b5612f', '#8f3b20'][i % 4]; g.beginPath(); g.ellipse(x + r() * w, y + r() * h, 7 + r() * 5, 6 + r() * 4, r() * 3, 0, 7); g.fill(); } g.strokeStyle = 'rgba(120,20,12,0.75)'; g.lineWidth = 1; for (let i = -h; i < w + h; i += 6) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + h, y + h); g.moveTo(x + i + h, y); g.lineTo(x + i, y + h); g.stroke(); } g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#f1e9d2'; g.fillRect(x + 30, y + 34, 38, 24); hand('ONIONS', x + 49, y + 42, 9, '#7a1a10', 0); hand('50 LB', x + 49, y + 52, 8, '#7a1a10', 0); g.restore(); }
  { const [x, y, w, h] = MR.water; g.fillStyle = '#c4d9e8'; g.fillRect(x, y, w, h); for (let i = 0; i < 8; i++) { const bx = x + 2 + i * 20; const gr = g.createLinearGradient(bx, 0, bx + 18, 0); gr.addColorStop(0, '#9fbfd6'); gr.addColorStop(0.35, '#f2f8fc'); gr.addColorStop(1, '#a9c6da'); g.fillStyle = gr; g.fillRect(bx, y + 9, 18, h - 11); g.fillStyle = '#2a6fc0'; g.fillRect(bx + 4, y + 2, 10, 7); g.fillStyle = '#1e5aa8'; g.fillRect(bx, y + 26, 18, 16); g.fillStyle = '#fff'; g.fillRect(bx + 3, y + 32, 12, 3); } g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y + 14, w, 5); }
  { const [x, y, w, h] = MR.card; g.fillStyle = '#a9824f'; g.fillRect(x, y, w, h); for (let i = 0; i < w; i += 3) { g.fillStyle = 'rgba(70,45,20,0.07)'; g.fillRect(x + i, y, 1, h); } g.fillStyle = 'rgba(205,190,150,0.85)'; g.fillRect(x, y + h / 2 - 5, w, 10); g.fillStyle = '#4a3016'; g.font = '700 9px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('FOIL PANS 7 IN', x + 8, y + 14); g.fillText('QTY 500', x + 8, y + h - 12); }
  { const [x, y, w, h] = MR.tips; g.fillStyle = '#f6f6f0'; g.fillRect(x, y, w, h); hand('TIPS', x + w / 2, y + 14, 16, '#111', -0.05); hand('thank you', x + w / 2, y + 30, 9, '#a3140e', 0.02); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const CL = 2.9, CW = 1.45, FLOOR = 0.44, DECK = 1.16, ROOF = 2.26;     // length, width, floor height, counter height, roof underside (m): a 10 ft x 5 ft cart
function halalCart(B) {
  const P = new GB(), S = new GB(), Mz = new GB(MW, MW), h = CL / 2, w = CW / 2, st = lin('#c3c7c9'), stD = lin('#8d9194'), dk = lin('#17181a'), blk = lin('#0c0c0d'), rub = lin('#101011');
  const U = (B.umb || ['#d81e1e', '#ffd21a']).map(lin);
  // chassis, wheels, jack, hitch
  S.box([0, FLOOR - 0.05, 0], [CL, 0.1, CW - 0.06], lin('#2a2b2d'));
  for (const sg of [-1, 1]) { const z = sg * w, zo = z + sg * 0.087; P.cyl([-0.15, 0.24, z - 0.085], [-0.15, 0.24, z + 0.085], 0.24, 0.24, 28, rub); S.cyl([-0.15, 0.24, zo], [-0.15, 0.24, zo + sg * 0.012], 0.15, 0.132, 18, lin('#b9bdbf')); P.cyl([-0.15, 0.24, zo + sg * 0.012], [-0.15, 0.24, zo + sg * 0.035], 0.05, 0.04, 10, lin('#3a3b3d'));
    for (let k = 0; k < 5; k++) { const a = k / 5 * PI * 2; P.box([-0.15 + Math.cos(a) * 0.095, 0.24 + Math.sin(a) * 0.095, zo + sg * 0.014], [0.022, 0.022, 0.012], lin('#6b6e70')); }
    S.box([-0.15, 0.502, z + sg * 0.03], [0.62, 0.022, 0.2], stD); for (const dx of [-0.31, 0.31]) S.box([-0.15 + dx, 0.455, z + sg * 0.03], [0.022, 0.1, 0.2], stD);     // the mudguard: under the wrap, over the tyre
    for (const [rx, rc] of [[h - 0.1, '#e8891c'], [-h + 0.1, '#c2140e']]) P.box([rx, 0.47, z + sg * 0.004], [0.1, 0.035, 0.008], lin(rc)); }     // side reflectors
  for (const sg of [-1, 1]) S.cyl([h - 0.02, FLOOR - 0.06, sg * 0.52], [h + 0.98, FLOOR - 0.06, sg * 0.05], 0.042, 0.042, 4, dk); S.box([h + 0.34, FLOOR - 0.03, 0], [0.4, 0.03, 0.62], dk); S.box([h + 1.06, FLOOR - 0.04, 0], [0.22, 0.09, 0.09], lin('#8d9194')); S.cyl([h + 1.16, FLOOR - 0.04, 0], [h + 1.16, FLOOR + 0.06, 0], 0.03, 0.03, 8, lin('#9a9ea1'));     // the A-frame tongue and the coupler
  for (const sg of [-1, 1]) { P.cyl([-h - 0.001, 0.56, sg * 0.56], [-h - 0.03, 0.56, sg * 0.56], 0.05, 0.05, 12, lin('#b3120c')); P.cyl([-h - 0.001, 0.56, sg * 0.44], [-h - 0.025, 0.56, sg * 0.44], 0.035, 0.035, 10, lin('#e8891c')); } P.box([-h - 0.012, 0.52, 0], [0.008, 0.16, 0.32], lin('#e9ebe2')); P.box([-h - 0.018, 0.52, 0], [0.004, 0.09, 0.26], lin('#27408a'));     // tail lamps and a plate
  S.cyl([h + 0.82, 0.03, 0], [h + 0.82, 0.7, 0], 0.028, 0.028, 6, lin('#9a9ea1')); P.cyl([h + 0.82, 0.07, -0.03], [h + 0.82, 0.07, 0.03], 0.07, 0.07, 8, rub); S.box([h + 0.82, 0.72, 0.05], [0.04, 0.04, 0.14], dk);
  for (const x of [-h + 0.12, h - 0.12]) for (const z of [-w + 0.1, w - 0.1]) S.cyl([x, 0.01, z], [x, FLOOR - 0.1, z], 0.022, 0.022, 5, lin('#6b6e70'));
  // lower body: stainless, with the wrap on both long sides
  S.box([0, (FLOOR + DECK) / 2, 0], [CL, DECK - FLOOR, CW], st, 'tu'); P.sign([0, (FLOOR + DECK) / 2 + 0.005, w + 0.006], CL - 0.16, DECK - FLOOR - 0.1, '+z', R.bodyF); P.sign([0, (FLOOR + DECK) / 2 + 0.005, -w - 0.006], CL - 0.16, DECK - FLOOR - 0.1, '-z', R.bodyB);
  for (const x of [-h, h]) for (const z of [-w, w]) S.box([x, (FLOOR + DECK) / 2, z], [0.05, DECK - FLOOR + 0.02, 0.05], stD);
  S.box([0, DECK, 0], [CL + 0.02, 0.035, CW + 0.02], st);                                         // the counter deck
  S.box([0.05, DECK - 0.02, w + 0.14], [CL - 0.5, 0.03, 0.28], st); for (const x of [-1.0, 1.1]) S.box([x, DECK - 0.12, w + 0.12], [0.03, 0.2, 0.22], stD);     // the serving shelf and its brackets
  // posts, back wall, end walls, roof
  for (const x of [-h + 0.03, h - 0.03]) for (const z of [-w + 0.03, w - 0.03]) S.box([x, (DECK + ROOF) / 2, z], [0.06, ROOF - DECK, 0.06], st);
  S.box([-0.2, (DECK + ROOF) / 2, w - 0.03], [0.045, ROOF - DECK, 0.045], st); S.box([0.85, (DECK + ROOF) / 2, w - 0.03], [0.045, ROOF - DECK, 0.045], st);
  S.box([0, (DECK + ROOF) / 2, -w + 0.02], [CL - 0.06, ROOF - DECK, 0.03], st); P.box([0, (DECK + ROOF) / 2, -w + 0.045], [CL - 0.12, ROOF - DECK, 0.004], lin('#7d8387'), 'blrtu'); for (const yy of [DECK + 0.52, DECK + 0.8]) S.box([-0.5, yy, -w + 0.14], [1.7, 0.02, 0.18], stD);
  S.box([-h + 0.02, (DECK + ROOF) / 2, 0], [0.03, ROOF - DECK, CW - 0.1], st);                    // the door end (solid), the door drawn on it
  S.box([-h - 0.005, 1.12, -0.12], [0.02, 1.36, 0.62], lin('#d0d3d5')); S.box([-h - 0.02, 1.2, 0.1], [0.03, 0.12, 0.03], dk); P.box([-h - 0.017, 1.72, -0.12], [0.004, 0.34, 0.4], lin('#1c2429'));
  for (const yy of [0.62, 1.7]) S.box([-h - 0.02, yy, -0.42], [0.03, 0.1, 0.04], stD);
  S.box([h - 0.02, DECK + 0.3, 0], [0.03, 0.6, CW - 0.1], st); P.box([h - 0.02, DECK + 0.3 + 0.45, 0], [0.012, 0.3, CW - 0.14], lin('#27323a'));     // the hitch end: half wall, dark glass over
  S.box([0, ROOF + 0.04, 0], [CL + 0.16, 0.08, CW + 0.16], st); S.box([0.35, ROOF + 0.2, -0.1], [0.62, 0.24, 0.5], stD); S.cyl([0.35, ROOF + 0.32, -0.1], [0.35, ROOF + 0.5, -0.1], 0.1, 0.1, 8, stD); S.cyl([0.35, ROOF + 0.5, -0.1], [0.35, ROOF + 0.56, -0.1], 0.17, 0.12, 8, st);
  // the photo-menu band (leaning out a little, as the lit boxes do) and the end bands
  { const fh = 0.41, y = ROOF - fh / 2 + 0.1; P.quad([0, y, w + 0.1], [1, 0, 0], [0, Math.cos(0.14), Math.sin(0.14)], CL + 0.1, fh, WHITEC, R.fasciaF); S.box([0, y, w + 0.06], [CL + 0.1, fh, 0.06], stD, 'f');
    P.sign([h + 0.085, y, 0], CW, fh - 0.04, '+x', R.endA); P.sign([-h - 0.085, y, 0], CW, fh - 0.04, '-x', R.endB); S.box([0, y, -w - 0.03], [CL + 0.1, fh - 0.04, 0.05], stD); P.sign([0, y, -w - 0.058], CL + 0.1, fh - 0.04, '-z', R.fasciaF);
    for (const yy of [DECK + 0.02, DECK + 0.74]) S.box([0, yy, -w - 0.008], [CL - 0.04, 0.03, 0.02], stD); for (const x of [-0.72, 0.72]) S.box([x, (DECK + ROOF) / 2 - 0.1, -w - 0.006], [0.025, ROOF - DECK - 0.3, 0.015], stD);
    // the street side above the counter: the special and the price list as posters, the louvred vent between them, a hand-written sign
    P.sign([1.08, DECK + 0.4, -w - 0.022], 0.6, 0.6, '-z', R.post2); P.sign([-1.08, DECK + 0.4, -w - 0.022], 0.6, 0.6, '-z', R.post1); S.box([0, DECK + 0.42, -w - 0.01], [0.74, 0.46, 0.03], stD); for (let k = 0; k < 7; k++) P.quad([0, DECK + 0.25 + k * 0.058, -w - 0.03], [-1, 0, 0], [0, 0.8, -0.6], 0.66, 0.04, k % 2 ? lin('#2a2c2e') : lin('#3c3f42'));
    Mz.quad([0.42, DECK + 0.13, -w - 0.03], [-0.998, 0.06, 0], [0.06, 0.998, 0], 0.3, 0.225, WHITEC, MR.hand2); }
  P.box([0.325, ROOF - 0.385, w + 0.0], [1.0, 0.15, 0.07], lin('#101011'));     // the LED sign's case: hung in the top of the open window, under the umbrellas' rims
  // the window: taped sheets on glass at both ends, open in the middle; the tube lamp under the roof; inside
  P.sign([-1.02, DECK + 0.4, w - 0.02], 0.62, 0.62, '+z', R.post1); P.sign([1.14, DECK + 0.4, w - 0.02], 0.5, 0.5, '+z', R.post2);
  P.box([-0.82, DECK + 0.36, w - 0.035], [1.16, 0.7, 0.01], lin('#2b363d'), 'b'); P.box([1.14, DECK + 0.36, w - 0.035], [0.52, 0.7, 0.01], lin('#2b363d'), 'b');
  P.quad([0.1, ROOF - 0.03, 0.2], [1, 0, 0], [0, 0, 1], 2.2, 0.09, WHITEC, LAMP); P.quad([0.1, ROOF - 0.08, w - 0.12], [1, 0, 0], [0, -0.5, 0.86], 2.3, 0.05, WHITEC, LAMP);
  S.box([0.32, DECK + 0.06, -0.12], [1.0, 0.1, 0.62], lin('#3a3b3d')); P.box([0.32, DECK + 0.115, -0.12], [0.94, 0.012, 0.56], lin('#1a1a1b'));     // the griddle
  { const r = rnd(B.seed || 4); for (let i = 0; i < 28; i++) { const cc = [['#c97a24', '#e0993a', '#a8591a'], ['#6b3a1c', '#8a4e25', '#4f2913'], ['#e9dcc0', '#d9c79e', '#f2ead6']][i < 12 ? 0 : i < 22 ? 1 : 2]; const bx = i < 12 ? -0.02 : i < 22 ? 0.36 : 0.66; P.box([bx + (r() - 0.5) * 0.26, DECK + 0.13 + r() * 0.03, -0.12 + (r() - 0.5) * 0.38], [0.05 + r() * 0.05, 0.025 + r() * 0.03, 0.05 + r() * 0.05], lin(cc[i % 3])); } }
  for (const [x, c] of [[-0.62, '#f2c12e'], [-1.0, '#e8e2cf']]) { S.box([x, DECK + 0.07, -0.2], [0.34, 0.12, 0.5], st); P.box([x, DECK + 0.135, -0.2], [0.3, 0.012, 0.46], lin(c)); }     // rice and pita pans
  P.cyl([1.12, DECK + 0.05, -0.36], [1.12, DECK + 0.56, -0.36], 0.11, 0.07, 9, lin('#7a4520')); S.cyl([1.12, DECK, -0.36], [1.12, DECK + 0.66, -0.36], 0.012, 0.012, 4, st); S.box([1.12, DECK + 0.33, -0.56], [0.3, 0.6, 0.04], stD);     // the gyro spit and its burner
  S.box([0.32, ROOF - 0.2, -0.2], [1.2, 0.26, 0.7], stD, 'u');     // the hood
  // on the shelf: squeeze bottles (white sauce, red sauce), napkins, foil trays, the drink row on the sill
  { const y = DECK + 0.0, z = w + 0.17; let x = -0.52; for (const c of ['#f4f1e6', '#f4f1e6', '#c2140e', '#c2140e', '#f4f1e6', '#b8d43a']) { P.cyl([x, y, z], [x, y + 0.17, z], 0.033, 0.03, 7, lin(c)); P.cyl([x, y + 0.17, z], [x, y + 0.235, z], 0.022, 0.005, 6, lin(c === '#c2140e' ? '#e03a2a' : '#fbfaf4'), false); x += 0.085; }
    P.box([0.22, y + 0.07, z - 0.02], [0.16, 0.14, 0.13], lin('#17181a')); P.box([0.22, y + 0.145, z - 0.02], [0.1, 0.012, 0.09], lin('#f6f6f2')); for (let k = 0; k < 3; k++) S.cyl([0.5, y + k * 0.045, z], [0.5, y + 0.04 + k * 0.045, z], 0.1, 0.11, 10, lin('#e3e6e8')); P.box([0.78, y + 0.06, z - 0.01], [0.2, 0.12, 0.14], lin('#f8f8f4'));
    const cans = ['#c2140e', '#1b4fa8', '#1e8a3a', '#f08a1c', '#c2140e', '#e8e8e8', '#1b4fa8', '#7a2a9a', '#f6c915', '#c2140e', '#1e8a3a', '#e8e8e8']; cans.slice(0, 7).forEach((c, i) => { const cx = -1.36 + i * 0.076; P.cyl([cx, DECK + 0.02, w - 0.09], [cx, DECK + 0.14, w - 0.09], 0.032, 0.032, 6, lin(c)); S.cyl([cx, DECK + 0.14, w - 0.09], [cx, DECK + 0.146, w - 0.09], 0.03, 0.026, 6, lin('#d5d8da')); });
    for (let i = 0; i < 26; i++) { const cx = -0.8 + i * 0.085; if (cx > -0.05 && cx < 0.62) continue; P.cyl([cx, DECK + 0.02, w - 0.09], [cx, DECK + 0.2, w - 0.09], 0.031, 0.031, 6, lin('#cfe6f5')); P.cyl([cx, DECK + 0.2, w - 0.09], [cx, DECK + 0.24, w - 0.09], 0.016, 0.014, 5, lin(i % 2 ? '#1b4fa8' : '#f4f6f8')); } }
  // propane on the tongue, strapped; the generator and a fuel can on the ground at the hitch; coolers and drink cases at the door end; the trash bin
  for (const z of [-0.2, 0.2]) { P.cyl([h + 0.34, FLOOR, z], [h + 0.34, FLOOR + 0.46, z], 0.155, 0.155, 12, lin('#e6e7e4')); P.cyl([h + 0.34, FLOOR + 0.46, z], [h + 0.34, FLOOR + 0.53, z], 0.155, 0.07, 12, lin('#e0e1de'), false); P.cyl([h + 0.34, FLOOR + 0.52, z], [h + 0.34, FLOOR + 0.64, z], 0.1, 0.1, 8, lin('#d9dad6'), false); S.cyl([h + 0.34, FLOOR + 0.53, z], [h + 0.34, FLOOR + 0.6, z], 0.03, 0.03, 6, lin('#b08d3a')); }
  P.box([h + 0.34, FLOOR + 0.3, 0], [0.34, 0.035, 0.74], lin('#141415'));
  { const gx = h + 0.62, gz = -0.62; P.box([gx, 0.27, gz], [0.5, 0.36, 0.4], lin('#c2140e')); P.box([gx, 0.49, gz], [0.42, 0.1, 0.34], lin('#131314')); P.box([gx + 0.255, 0.27, gz], [0.01, 0.24, 0.3], lin('#1a1a1b')); for (const dx of [-0.26, 0.26]) for (const dz of [-0.21, 0.21]) P.cyl([gx + dx, 0.02, gz + dz], [gx + dx, 0.56, gz + dz], 0.014, 0.014, 4, blk, false); for (const dz of [-0.21, 0.21]) P.cyl([gx - 0.26, 0.56, gz + dz], [gx + 0.26, 0.56, gz + dz], 0.014, 0.014, 4, blk, false);
    P.box([gx - 0.5, 0.17, gz + 0.02], [0.17, 0.34, 0.3], lin('#b5150f')); P.cyl([gx - 0.5, 0.34, gz - 0.06], [gx - 0.5, 0.39, gz - 0.06], 0.03, 0.03, 6, lin('#f6c915')); }
  { const cx = -h - 0.42; P.box([cx, 0.2, 0.36], [0.62, 0.36, 0.4], lin('#1b4fa8')); P.box([cx, 0.405, 0.36], [0.64, 0.05, 0.42], lin('#f1f1ee')); P.box([cx + 0.02, 0.61, 0.36], [0.56, 0.32, 0.36], lin('#c2140e')); P.box([cx + 0.02, 0.79, 0.36], [0.58, 0.045, 0.38], lin('#f1f1ee'));
    const tb = (c, sz, rect, top) => { const [x, y, z] = c, [a, b, d] = [sz[0] / 2, sz[1] / 2, sz[2] / 2]; Mz.quad([x, y, z + d], [1, 0, 0], [0, 1, 0], sz[0], sz[1], WHITEC, rect); Mz.quad([x, y, z - d], [-1, 0, 0], [0, 1, 0], sz[0], sz[1], WHITEC, rect); Mz.quad([x + a, y, z], [0, 0, -1], [0, 1, 0], sz[2], sz[1], WHITEC, rect); Mz.quad([x - a, y, z], [0, 0, 1], [0, 1, 0], sz[2], sz[1], WHITEC, rect); Mz.quad([x, y + b, z], [1, 0, 0], [0, 0, -1], sz[0], sz[2], top || WHITEC, top ? WHITE : rect); };
    for (let k = 0; k < 4; k++) tb([cx + 0.03 * (k % 2), 0.1 + k * 0.2, -0.22], [0.4, 0.195, 0.27], MR.water); for (let k = 0; k < 2; k++) tb([cx - 0.02, 0.11 + k * 0.22, -0.56], [0.42, 0.215, 0.3], MR.card, k ? lin('#b08a57') : null);
    const sack = (x, y, z) => { Mz.cyl([x - 0.17, y, z], [x + 0.17, y, z], 0.125, 0.125, 10, WHITEC, false, MR.onion); Mz.cyl([x - 0.24, y, z], [x - 0.17, y, z], 0.03, 0.125, 10, lin('#9a4424'), true); Mz.cyl([x + 0.17, y, z], [x + 0.25, y + 0.03, z], 0.125, 0.025, 10, lin('#9a4424'), true); }; sack(cx - 0.02, 0.44 + 0.115, -0.56); sack(cx + 0.04, 0.815 + 0.115, 0.36); }
  Mz.quad([-0.47, DECK + 0.5, w - 0.012], [0.998, 0.06, 0], [-0.06, 0.998, 0], 0.32, 0.24, WHITEC, MR.hand1); Mz.quad([1.14, 0.93, w + 0.012], [0.999, -0.05, 0], [0.05, 0.999, 0], 0.28, 0.21, WHITEC, MR.hand2);     // hand-written signs, taped on
  Mz.cyl([0.36, DECK, w + 0.22], [0.36, DECK + 0.115, w + 0.22], 0.036, 0.046, 12, WHITEC, false, [MR.tips[0], MR.tips[1], MR.tips[2] * 2, MR.tips[3]]); Mz.box([0.36, DECK + 0.112, w + 0.22], [0.055, 0.012, 0.035], lin('#7da06a'));     // the tip cup
  P.cyl([h + 0.5, 0.5, -0.5], [h - 0.03, FLOOR + 0.1, -0.42], 0.011, 0.011, 4, lin('#d8a516'), false); P.cyl([h + 0.9, 0.3, -0.72], [h + 0.98, 0.3, -0.72], 0.022, 0.022, 6, lin('#3a3b3d'));     // the generator's yellow lead into the cart, its exhaust
  { const tx = h + 0.2, tz = w + 0.62, r = rnd((B.seed || 4) + 50); P.cyl([tx, 0, tz], [tx, 0.78, tz], 0.21, 0.25, 22, lin('#69727a')); for (const yy of [0.22, 0.5]) { const rr = 0.212 + yy * 0.051; P.cyl([tx, yy, tz], [tx, yy + 0.028, tz], rr, rr + 0.002, 22, lin('#58616a'), false); }
    P.cyl([tx, 0.64, tz], [tx, 0.795, tz], 0.258, 0.266, 22, lin('#1d1e21'), false); P.cyl([tx, 0.795, tz], [tx, 0.81, tz], 0.266, 0.232, 22, lin('#2a2b2f'), false); P.cyl([tx, 0.74, tz], [tx, 0.765, tz], 0.236, 0.236, 22, lin('#17181a'));     // the black bag folded over the rim, the can nearly full
    for (let k = 0; k < 9; k++) { const a = r() * 7, q = r() * 0.15; P.box([tx + Math.cos(a) * q, 0.775 + r() * 0.035, tz + Math.sin(a) * q], [0.07 + r() * 0.09, 0.02 + r() * 0.05, 0.06 + r() * 0.08], lin(['#e9e6dc', '#cfd3d6', '#f4f1e6', '#b98f58', '#d81e1e', '#e3e6e8', '#3a6fb8'][k % 7])); } }
  // umbrellas clamped at the two service-side corners
  const one = B.oneUmb; P.umbrella(one ? 0 : -h + 0.18, w + 0.12, 3.02, 1.22, U, { rot: 0.2, y0: DECK - 0.5, trim: B.umbTrim }); if (!one) P.umbrella(h - 0.18, w + 0.12, 2.94, 1.18, U.length > 2 ? U.slice(1).concat(U[0]) : U, { rot: 0.5, y0: DECK - 0.5, trim: B.umbTrim });
  // steel streak uv: metres
  for (let i = 0; i < S.p.length / 3; i++) { const nx = Math.abs(S.n[i * 3]), ny = Math.abs(S.n[i * 3 + 1]); S.u[i * 2] = (nx > 0.7 ? S.p[i * 3 + 2] : S.p[i * 3]) * 1.4; S.u[i * 2 + 1] = (ny > 0.7 ? S.p[i * 3 + 2] : S.p[i * 3 + 1]) * 1.4; }
  // the far stand-in
  const F = new GB(); F.box([0, (FLOOR + ROOF) / 2 + 0.06, 0], [CL, ROOF - FLOOR + 0.12, CW], lin('#a9adaf'), 'u'); F.sign([0, (FLOOR + DECK) / 2, w + 0.01], CL - 0.16, DECK - FLOOR - 0.1, '+z', R.bodyF); F.sign([0, (FLOOR + DECK) / 2, -w - 0.01], CL - 0.16, DECK - FLOOR - 0.1, '-z', R.bodyB); F.sign([0, ROOF - 0.1, w + 0.1], CL + 0.1, 0.41, '+z', R.fasciaF); F.box([0, DECK + 0.4, w - 0.1], [CL - 0.2, 0.62, 0.02], lin('#2a2f33'), 'blrtu'); F.box([-0.15, 0.24, 0], [0.48, 0.48, CW + 0.17], lin('#141414'), 'tu');
  F.sign([1.08, DECK + 0.4, -w - 0.022], 0.6, 0.6, '-z', R.post2); F.sign([-1.08, DECK + 0.4, -w - 0.022], 0.6, 0.6, '-z', R.post1); F.box([0, DECK + 0.42, -w - 0.01], [0.74, 0.46, 0.03], lin('#55595c'), 'f'); F.sign([0, ROOF - 0.105, -w - 0.058], CL + 0.1, 0.37, '-z', R.fasciaF); F.sign([h + 0.085, ROOF - 0.105, 0], CW, 0.37, '+x', R.endA); F.sign([-h - 0.085, ROOF - 0.105, 0], CW, 0.37, '-x', R.endB);
  F.box([h + 0.34, FLOOR + 0.3, 0], [0.3, 0.66, 0.7], lin('#e6e7e4'), 'u'); F.box([h + 0.62, 0.3, -0.62], [0.5, 0.52, 0.4], lin('#a5120c'), 'u'); F.box([-h - 0.42, 0.42, 0.36], [0.62, 0.8, 0.4], lin('#7a3a5a'), 'u'); F.box([-h - 0.42, 0.42, -0.36], [0.42, 0.84, 0.6], lin('#b9c3c4'), 'u'); F.cyl([h + 0.2, 0, w + 0.62], [h + 0.2, 0.8, w + 0.62], 0.21, 0.26, 8, lin('#4a5056'));
  F.umbrella(one ? 0 : -h + 0.18, w + 0.12, 3.02, 1.22, U, { rot: 0.2, y0: DECK - 0.5, fine: false, trim: B.umbTrim }); if (!one) F.umbrella(h - 0.18, w + 0.12, 2.94, 1.18, U.length > 2 ? U.slice(1).concat(U[0]) : U, { rot: 0.5, y0: DECK - 0.5, fine: false, trim: B.umbTrim });
  return { paint: P.build(), steel: S.build(), mess: Mz.build(), far: F.build(), tris: P.tris + S.tris + Mz.tris, farTris: F.tris, led: { c: [0.325, ROOF - 0.385, w + 0.037], w: 0.96, h: 0.115 }, steam: [[0.32, DECK + 0.25, -0.1], [0.35, ROOF + 0.58, -0.1]], solid: [[-1.1, 0, 0.75], [-0.37, 0, 0.75], [0.37, 0, 0.75], [1.1, 0, 0.75], [1.95, 0, 0.5], [-1.9, 0, 0.55]],
    foot: [-2.3, 2.6, -0.8, 1.15], serve: [0.1, w + 0.62], vendor: [0.2, 0.32], lineY: w + 0.62 };
}
// the pushcart: 1.5 m of stainless on two spoked wheels, hinged lids, a pretzel case, the striped umbrella through the middle
function hotdogCart(B) {
  const P = new GB(), S = new GB(), st = lin('#c6cacc'), stD = lin('#8d9194'), rub = lin('#101011'), U = B.umb.map(lin), L = 1.55, W = 0.76, w = W / 2, h = L / 2, y0 = 0.36, y1 = 0.98;
  S.box([0, (y0 + y1) / 2, 0], [L, y1 - y0, W], st, 'u'); S.box([0, y1 + 0.012, 0], [L + 0.06, 0.025, W + 0.06], st); for (const x of [-0.42, 0.1]) { S.box([x, y1 + 0.04, 0], [0.4, 0.03, 0.5], stD); S.box([x, y1 + 0.07, 0.14], [0.08, 0.03, 0.03], lin('#17181a')); }
  P.sign([0.1, (y0 + y1) / 2 + 0.06, w + 0.005], 1.16, 0.29, '+z', R.bodyF); P.sign([0, (y0 + y1) / 2 + 0.06, -w - 0.005], 1.2, 0.3, '-z', R.bodyB); P.sign([h + 0.005, (y0 + y1) / 2 + 0.1, 0], 0.6, 0.6 * 86 / 310, '+x', R.endA);
  for (const x of [-0.5, 0.02, 0.5]) S.box([x, (y0 + y1) / 2, w + 0.004], [0.012, y1 - y0 - 0.04, 0.008], stD); S.box([0, y0 + 0.03, 0], [L + 0.02, 0.05, W + 0.02], stD);
  S.box([-h + 0.2, y1 + 0.24, -0.02], [0.4, 0.46, W - 0.1], st); S.box([-h + 0.2, y1 + 0.48, -0.02], [0.44, 0.02, W - 0.06], st); ['#c2140e', '#c2140e', '#1b4fa8', '#e8e8e8', '#1e8a3a', '#f08a1c', '#c2140e', '#1b4fa8'].forEach((c, i) => { const cz = -0.3 + (i % 4) * 0.075, cx = -h + 0.12 + Math.floor(i / 4) * 0.08; P.cyl([cx, y1 + 0.49, cz], [cx, y1 + 0.61, cz], 0.032, 0.032, 6, lin(c)); }); for (let i = 0; i < 4; i++) P.cyl([-h + 0.3, y1 + 0.49, -0.26 + i * 0.09], [-h + 0.3, y1 + 0.69, -0.26 + i * 0.09], 0.031, 0.027, 6, lin('#cfe6f5'));
  S.cyl([0.1, y1 + 0.03, -0.05], [0.1, y1 + 0.06, -0.05], 0.2, 0.2, 14, stD); for (let i = 0; i < 5; i++) P.cyl([0.02 + i * 0.04, y1 + 0.1, -0.16], [0.02 + i * 0.04, y1 + 0.16, 0.06], 0.035, 0.035, 6, lin(i % 2 ? '#a86a24' : '#c08535'));
  for (const z of [-w - 0.05, w + 0.05]) { P.cyl([-0.38, 0.3, z - 0.025], [-0.38, 0.3, z + 0.025], 0.3, 0.3, 16, rub); P.cyl([-0.38, 0.3, z - 0.03], [-0.38, 0.3, z + 0.03], 0.235, 0.235, 12, lin('#d8dadc')); S.cyl([-0.38, 0.3, z - 0.04], [-0.38, 0.3, z + 0.04], 0.05, 0.05, 6, stD); }
  P.cyl([0.55, 0.06, 0], [0.55, 0.06, 0.05], 0.06, 0.06, 8, rub); S.cyl([0.55, 0.06, 0.025], [0.55, y0, 0.025], 0.018, 0.018, 5, stD); S.cyl([h + 0.25, y1 - 0.08, -w + 0.05], [h + 0.25, y1 - 0.08, w - 0.05], 0.016, 0.016, 5, st); for (const z of [-w + 0.05, w - 0.05]) S.cyl([h, y1 - 0.08, z], [h + 0.25, y1 - 0.08, z], 0.016, 0.016, 5, st);
  // the pretzel case, mustard and ketchup, napkins, a cooler beside
  P.box([0.5, y1 + 0.2, 0], [0.42, 0.34, 0.4], lin('#dfe9ee'), 'u'); S.box([0.5, y1 + 0.375, 0], [0.44, 0.02, 0.42], st); P.sign([0.5, y1 + 0.2, 0.203], 0.38, 0.3, '+z', R.post2); P.sign([0.5, y1 + 0.2, -0.203], 0.38, 0.3, '-z', R.post1);
  let x = -0.2; for (const c of ['#f1c40f', '#c2140e', '#f4f1e6']) { P.cyl([x, y1 + 0.025, w - 0.1], [x, y1 + 0.2, w - 0.1], 0.033, 0.03, 7, lin(c)); P.cyl([x, y1 + 0.2, w - 0.1], [x, y1 + 0.26, w - 0.1], 0.02, 0.005, 6, lin(c), false); x += 0.085; }
  P.box([-0.62, y1 + 0.085, w - 0.12], [0.16, 0.12, 0.13], lin('#17181a')); P.box([-h - 0.38, 0.2, 0.05], [0.56, 0.36, 0.38], lin('#1b4fa8')); P.box([-h - 0.38, 0.4, 0.05], [0.58, 0.05, 0.4], lin('#f1f1ee'));
  P.umbrella(0.02, 0, 2.38, 1.02, U, { rot: 0.39, y0: y1, drop: 0.3 });
  for (let i = 0; i < S.p.length / 3; i++) { const nx = Math.abs(S.n[i * 3]), ny = Math.abs(S.n[i * 3 + 1]); S.u[i * 2] = (nx > 0.7 ? S.p[i * 3 + 2] : S.p[i * 3]) * 1.4; S.u[i * 2 + 1] = (ny > 0.7 ? S.p[i * 3 + 2] : S.p[i * 3 + 1]) * 1.4; }
  const F = new GB(); F.box([0, (y0 + y1) / 2, 0], [L, y1 - y0, W], lin('#a9adaf'), 'u'); F.sign([0, (y0 + y1) / 2, w + 0.01], L - 0.08, y1 - y0 - 0.06, '+z', R.bodyF); F.sign([0, (y0 + y1) / 2, -w - 0.01], L - 0.08, y1 - y0 - 0.06, '-z', R.bodyB); F.umbrella(0.02, 0, 2.38, 1.02, U, { rot: 0.39, y0: y1, drop: 0.3, fine: false });
  return { paint: P.build(), steel: S.build(), far: F.build(), tris: P.tris + S.tris, farTris: F.tris, led: null, steam: [[-0.42, y1 + 0.08, 0]], solid: [[-0.38, 0, 0.5], [0.38, 0, 0.5]], foot: [-1.45, 1.15, -0.5, 0.9], serve: [0, w + 0.55], vendor: [0, -w - 0.45], lineY: w + 0.55 };
}

// ------------------------------------------------------------------------------------------------ the part
export async function add(game, ctx) {
  const P = game.P || new URLSearchParams(location.search); if (P.get('carts') === '0') return { report: { off: true } };
  const city = game.city, world = game.world, statics = game.statics, roads = game.roads, N = city.nodes, E = city.edges, meta = city.meta;
  const group = new THREE.Group(); group.name = 'st_carts';
  let ar = null; try { ar = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = ctx.A + 'carts/halal_ar.png'; }); } catch (e) { console.log('[carts] halal_ar.png not loaded: the Arabic word is left off'); }

  // ---- the old little cart of furniture.js goes: meshes off, its two circles off
  const fu = ctx.parts && ctx.parts.furniture, old = { carts: 0, meshes: 0, circles: 0 };
  if (fu && fu.kinds && fu.kinds.cart && P.get('cartsold') !== '1') {
    for (const m of fu.meshes || []) { const k = String(m.userData.kind || '').replace(/^st_/, ''); if (k === 'cart' || k === 'umbrellaV1' || k === 'umbrellaV2') { m.userData.off = true; m.visible = false; if (m.parent) m.parent.remove(m); old.meshes++; } }
    for (const it of fu.kinds.cart.list) { old.carts++; const dx = Math.cos(it[3]) * 0.4, dy = Math.sin(it[3]) * 0.4; for (const s of [-1, 1]) { const x = it[0] + dx * s, y = it[1] + dy * s, a = statics.circ.get(statics.key(Math.floor(x / statics.cell), Math.floor(y / statics.cell))); if (a) for (const c of a) if (c.on && c.tag === 'furniture' && Math.abs(c.r - 0.5) < 1e-6 && Math.hypot(c.x - x, c.y - y) < 0.02) { c.on = false; old.circles++; } } }
  }

  // ---- helpers on the map
  const play = meta.play || [-meta.px, -meta.py, meta.px, meta.py], inPlay = (x, y) => x > play[0] + 4 && x < play[2] - 4 && y > play[1] + 4 && y < play[3] - 4;
  const circlesNear = (x, y, rad) => { const out = [], c = statics.cell; for (let i = Math.floor((x - rad) / c); i <= Math.floor((x + rad) / c); i++) for (let j = Math.floor((y - rad) / c); j <= Math.floor((y + rad) / c); j++) { const a = statics.circ.get(statics.key(i, j)); if (a) for (const o of a) if (o.on && Math.hypot(o.x - x, o.y - y) < rad + o.r) out.push(o); } return out; };
  const inLane = (x, y, r) => !!(roads && roads.inLane && roads.inLane(x, y, r));
  const edgeDir = (e, i) => { const p = e.pts, a = e.a === i ? p[0] : p[p.length - 1], b = e.a === i ? p[1] : p[p.length - 2], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  // subway gratings (the ground layer's list, where it is built by now): no cart stands on one
  const grG = new Map(), grK = (x, y) => Math.floor(x / 8) * 100003 + Math.floor(y / 8); { const gp = ctx.parts && ctx.parts.ground, ls = gp ? [gp.grates].concat(Object.values(gp.sets || {}).map((r) => r && r.grates)) : []; for (const a of ls) for (const g of a || []) { const k = grK(g[0], g[1]); let b = grG.get(k); if (!b) grG.set(k, (b = [])); b.push(g); } }
  const onGrate = (x, y, ax, l, f) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const b = grG.get(grK(x + i * 8, y + j * 8)); if (b) for (const g of b) { const u = (g[0] - x) * ax[0] + (g[1] - y) * ax[1], v = (g[0] - x) * l[0] + (g[1] - y) * l[1]; if (u > f[0] - 0.5 && u < f[1] + 0.5 && v > -1.4 && v < 1.4) return true; } } return false; };
  // gratings are not asked at seating time (they are known only for areas the ground layer has built): a cart is never seated on the kerb of a street with a subway
  // line under it (the only kerbs the ground layer puts a grating on), so the result is the same whenever an area is built. onGrate is kept for the audit.
  const SUBWAY = /^(Broadway|6th Avenue|Avenue of the Americas|7th Avenue|8th Avenue|Park Avenue South|Park Avenue|Lexington Avenue)$/;
  const BC = 16, bseg = new Map(); for (const b of city.buildings) { if ((b.minh || 0) >= 2.5) continue; for (const poly of [b.poly].concat(b.holes || [])) for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], sg = [p[0], p[1], q[0], q[1]];
    for (let ci = Math.floor(Math.min(p[0], q[0]) / BC); ci <= Math.floor(Math.max(p[0], q[0]) / BC); ci++) for (let cj = Math.floor(Math.min(p[1], q[1]) / BC); cj <= Math.floor(Math.max(p[1], q[1]) / BC); cj++) { const k = ci * 100003 + cj; let a = bseg.get(k); if (!a) bseg.set(k, (a = [])); a.push(sg); } } }
  const bray = (ax, ay, bx, by) => { let best = 1; const rx = bx - ax, ry = by - ay, steps = Math.ceil(Math.hypot(rx, ry) / (BC * 0.5)) + 1, seen = new Set();
    for (let q = 0; q <= steps; q++) { const ci = Math.floor((ax + rx * q / steps) / BC), cj = Math.floor((ay + ry * q / steps) / BC); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const k = (ci + di) * 100003 + cj + dj; if (seen.has(k)) continue; seen.add(k); const a = bseg.get(k); if (!a) continue;
      for (const sg of a) { const sx = sg[2] - sg[0], sy = sg[3] - sg[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) continue; const t = ((sg[0] - ax) * sy - (sg[1] - ay) * sx) / den, u = ((sg[0] - ax) * ry - (sg[1] - ay) * rx) / den; if (t >= 0 && t < best && u >= 0 && u <= 1) best = t; } } }
    return best; };
  const ray = (ax, ay, bx, by) => Math.min(bray(ax, ay, bx, by), statics.raycast(ax, ay, bx, by));
  const dSeg = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1e-9))); return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t); };
  const ents = ((game.subway && game.subway.data && game.subway.data.entrances) || []).filter((e) => e && !e.off && isFinite(e.x) && isFinite(e.y)).map((e) => ({ a: [e.x, e.y], b: e.foot && isFinite(e.foot[0]) ? e.foot : [e.x, e.y], w: (e.w || 1.5) / 2 }));
  const entDist = (pts) => { let m = 99; for (const e of ents) { if (Math.abs(e.a[0] - pts[0][0]) > 30 || Math.abs(e.a[1] - pts[0][1]) > 30) continue; for (const p of pts) m = Math.min(m, dSeg(p[0], p[1], e.a, e.b) - e.w); } return m; };
  const doorList = [].concat((game.interiors && Array.isArray(game.interiors.doors) && game.interiors.doors) || []).filter((d) => d && isFinite(d.x) && isFinite(d.y));
  const doorDist = (x, y) => { let m = 99; for (const d of doorList) { const q = Math.hypot(d.x - x, d.y - y); if (q < m) m = q; } return m; };
  const bigNodes = N.map((n, i) => ({ n, i })).filter((o) => o.n.e.length >= 3);
  // how far the cart's nearest end is past the far edge of the nearest corner's crosswalk (taken as 4.5 m beyond the cross street's kerb line); 10 ft is the city's rule
  const cornerGap = (x, y, ax, l, f) => { let m = 99; for (const o of bigNodes) { const rx = o.n.p[0] - x, ry = o.n.p[1] - y; if (Math.abs(rx) > 70 || Math.abs(ry) > 70) continue; const u = rx * ax[0] + ry * ax[1], v = rx * l[0] + ry * l[1]; if (Math.abs(v) > 45) continue; m = Math.min(m, (u > 0 ? u - f[1] : -u + f[0]) - crossHalfL(o.i, ax) - 4.5); } return m; };
  const placed = [];     // every cart: { x, y, h, d: [dx, dy] along the kerb away from the corner, l: [lx, ly] kerb -> buildings, model, brand }
  // put a cart on the sidewalk of edge direction d from node n, on side s (+1 = right of d), about D metres from the node; null if it does not fit
  const seat = (n, d, s, D, M, strict = true) => {
    const l = [d[1] * s, -d[0] * s], bx = n.p[0] + d[0] * D, by = n.p[1] + d[1] * D; let t0 = -1;
    for (let t = 1.5; t < 26; t += 0.25) { if (statics.onSidewalk(bx + l[0] * t, by + l[1] * t) && statics.onSidewalk(bx + l[0] * (t + 1.4), by + l[1] * (t + 1.4))) { t0 = t; break; } } if (t0 < 0) return null;
    for (let k = 0; k < 6 && statics.onSidewalk(bx + l[0] * (t0 - 0.05), by + l[1] * (t0 - 0.05)); k++) t0 -= 0.05;
    const half = (M.foot[3] > 1 ? CW : 0.76) / 2, t = t0 + 0.36 + half, x = bx + l[0] * t, y = by + l[1] * t, hd = Math.atan2(l[0], -l[1]), ax = [Math.cos(hd), Math.sin(hd)];     // local +x on the map; local +z = l
    if (!inPlay(x, y)) return null;
    const loc = (u, v) => [x + ax[0] * u + l[0] * v, y + ax[1] * u + l[1] * v], f = M.foot;
    for (const [u, v] of [[f[0], -half], [f[1], -half], [f[0], half + 0.5], [f[1], half + 0.5], [0, half + 1.6]]) { const q = loc(u, v); if (!statics.onSidewalk(q[0], q[1])) return null; }
    for (const [u, v, r] of M.solid) { const q = loc(u, 0); if (inLane(q[0], q[1], r + 0.2)) return null; }
    for (const o of circlesNear(x, y, 4.5)) { const u = (o.x - x) * ax[0] + (o.y - y) * ax[1], v = (o.x - x) * l[0] + (o.y - y) * l[1]; if (u > f[0] - o.r && u < f[1] + o.r && v > f[2] - o.r && v < f[3] + (strict ? 1.0 : 0.3) + o.r) return null; }
    let wall = 9; for (const u of [f[0] * 0.6, 0, f[1] * 0.6]) { const q = loc(u, 0); wall = Math.min(wall, ray(q[0], q[1], q[0] + l[0] * 9, q[1] + l[1] * 9) * 9); } if (wall < half + (strict ? 2.5 : 1.8)) return null;     // a walking lane is left between the cart and the building line (the outlines of city.buildings, so an area not yet built is not blind)
    if (ray(x, y, x - l[0] * 3, y - l[1] * 3) < 1) return null; for (const sg of [-1, 1]) if (ray(x, y, x + ax[0] * sg * 3.4, y + ax[1] * sg * 3.4) < 1) return null;     // a stair wall, a kiosk, a fence beside it
    const fp = [[x, y], loc(f[0], -half), loc(f[1], -half), loc(f[0], half + 0.5), loc(f[1], half + 0.5)]; if (entDist(fp) < (strict ? 3.05 : 1.5)) return null;     // 10 ft from a subway stair
    if (doorDist(x, y) < (strict ? 6.1 : 3)) return null;     // 20 ft from a door (the doors the game knows)
    if (cornerGap(x, y, ax, l, f) < (strict ? 3.05 : 1.0)) return null;     // 10 ft past the crosswalk, of this corner and of any other
    for (const q of placed) if (Math.hypot(q.x - x, q.y - y) < 42) return null;
    return { x, y, h: hd, d: [d[0], d[1]], l, ax, wall, kerb: half + 0.36, M, fp };
  };
  // the line: from the serving spot back along the sidewalk, parallel to the kerb, away from the corner unless that way is shut
  const lineOf = (c, want, gap) => {
    const M = c.M, sv = [c.x + c.ax[0] * M.serve[0] + c.l[0] * M.serve[1], c.y + c.ax[1] * M.serve[0] + c.l[1] * M.serve[1]], face = Math.atan2(-c.l[1], -c.l[0]); let best = null;
    const okPt = (x, y) => statics.onSidewalk(x, y) && !inLane(x, y, 0.3) && !circlesNear(x, y, 0.32).length && entDist([[x, y]]) > 0.6;
    for (const off of [0, 0.45, 0.9, -0.3, 1.4]) for (const sg of [1, -1]) { if (c.wall - (M.serve[1] + off) < 1.2) continue;
      const dir = [c.d[0] * sg, c.d[1] * sg], p1 = off ? [sv[0] + dir[0] * 0.8 + c.l[0] * off, sv[1] + dir[1] * 0.8 + c.l[1] * off] : sv, pre = off ? Math.hypot(p1[0] - sv[0], p1[1] - sv[1]) : 0; let len = 0;
      for (let s = 0.3; s <= want * gap + 0.3; s += 0.3) { const x = p1[0] + dir[0] * s, y = p1[1] + dir[1] * s; if (!okPt(x, y)) break; len = s; }
      if (len > 0 && ray(sv[0], sv[1], p1[0] + dir[0] * len, p1[1] + dir[1] * len) < 1) continue;
      const n = Math.min(want, Math.floor((len + pre) / gap) + 1), sc = n - (sg < 0 ? 0.5 : 0) - Math.abs(off) * 0.2; if (!best || sc > best.sc) best = { sc, n, pts: off ? [sv, p1, [p1[0] + dir[0] * len, p1[1] + dir[1] * len]] : [sv, [sv[0] + dir[0] * len, sv[1] + dir[1] * len]] };
      if (n >= want && sg > 0) break; }
    const r2 = (v) => +v.toFixed(2); if (!best) best = { n: 1, pts: [sv, sv] };
    return { x: r2(sv[0]), y: r2(sv[1]), face: +face.toFixed(4), pts: best.pts.map((p) => [r2(p[0]), r2(p[1])]), n: best.n, gap };
  };

  // ---- models, materials
  // stainless: quilted (diamond-pressed) sheet, brushed, with drips and dull patches; the bump is the quilting; it mirrors the scene's environment map
  const SQ = 256, steelMaps = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = SQ; const g = cv.getContext('2d'), bv = document.createElement('canvas'); bv.width = bv.height = SQ; const bg = bv.getContext('2d'), im = g.createImageData(SQ, SQ), bm = bg.createImageData(SQ, SQ), r = rnd(11);
    for (let y = 0; y < SQ; y++) for (let x = 0; x < SQ; x++) { const fu = ((x + y) / 16) % 1, fv = (((x - y) / 16) % 1 + 1) % 1, p = Math.sin(PI * fu) * Math.sin(PI * fv), hgt = Math.pow(p, 0.6), k = (y * SQ + x) * 4, v = 196 + hgt * 26; im.data[k] = v; im.data[k + 1] = v + 2; im.data[k + 2] = v + 4; im.data[k + 3] = 255; bm.data[k] = bm.data[k + 1] = bm.data[k + 2] = hgt * 255; bm.data[k + 3] = 255; }
    g.putImageData(im, 0, 0); bg.putImageData(bm, 0, 0);
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,64,68'},${0.03 + r() * 0.06})`; g.fillRect(r() * SQ, r() * SQ, 30 + r() * 120, 1); }
    for (let i = 0; i < 46; i++) { const x = r() * SQ, y = r() * SQ, len = 30 + r() * 110, gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, `rgba(74,56,34,${0.1 + r() * 0.16})`); gr.addColorStop(1, 'rgba(74,56,34,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 6, len); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${r() < 0.4 ? '250,250,250' : '50,52,56'},${0.05 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * SQ, r() * SQ, 8 + r() * 26, 6 + r() * 18, r() * 3, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; const b = new THREE.CanvasTexture(bv); b.wrapS = b.wrapT = THREE.RepeatWrapping; b.anisotropy = 4; return { t, b }; })(), steelTex = steelMaps.t;
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: steelTex, bumpMap: steelMaps.b, bumpScale: 0.55, metalness: 0.8, roughness: 0.4, envMapIntensity: P.has('cartsenv') ? +P.get('cartsenv') : 1.5 });
  const messMat = new THREE.MeshStandardMaterial({ map: paintMess(), vertexColors: true, roughness: 0.78, metalness: 0 }); messMat.name = 'cart_mess'; steelMat.name = 'cart_steel';
  const ledTex = (() => { const sm = document.createElement('canvas'); sm.width = 512; sm.height = 12; const q = sm.getContext('2d'); q.fillStyle = '#000'; q.fillRect(0, 0, 512, 12); q.fillStyle = '#fff'; q.font = 'bold 12px "Arial Narrow", Arial, sans-serif'; q.textBaseline = 'middle'; q.fillText('OPEN  ***  HALAL FOOD  ***  CHICKEN OVER RICE  ***  GYRO  ***  LAMB OVER RICE  ***  FALAFEL  ***', 2, 6.5);
    const d = q.getImageData(0, 0, 512, 12).data, cv = document.createElement('canvas'); cv.width = 2048; cv.height = 48; const g = cv.getContext('2d'); g.fillStyle = '#0a0606'; g.fillRect(0, 0, 2048, 48);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 512; x++) { const on = d[(y * 512 + x) * 4] > 110; g.fillStyle = on ? '#ff3a1c' : '#2a0c08'; g.beginPath(); g.arc(x * 4 + 2, y * 4 + 2, on ? 1.7 : 1.2, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(0.106, 1); t.anisotropy = 4; return t; })();
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: false }); ledMat.name = 'cart_led';
  const steamOn = P.get('cartsteam') !== '0';
  const steamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: world.shared.uTime || { value: 0 }, uLum: { value: 1 } },
    vertexShader: `attribute vec3 aPuff; uniform float uTime; varying vec2 vC; varying vec3 vA;
      void main() { float t = fract(uTime * aPuff.z + aPuff.x), up = (1.0 - exp(-2.4 * t)) / 0.91, w = uTime * 0.7 + aPuff.x * 40.0;
        vec3 o = position + vec3(sin(w + t * 3.1) * 0.1 * t + 0.55 * t * t + 0.12 * sin(uTime * 0.23 + aPuff.x * 9.0) * t, up * aPuff.y, cos(w * 0.8 + t * 2.3) * 0.1 * t + 0.2 * t * t);
        vec4 mv = modelViewMatrix * vec4(o, 1.0); float s = mix(0.07, 0.52, sqrt(t)); mv.xy += uv * s; vC = uv; vA = vec3(smoothstep(0.0, 0.08, t) * (1.0 - t) * (1.0 - t) * (1.0 - smoothstep(40.0, 60.0, -mv.z)), aPuff.x * 61.0, t); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uLum; uniform float uTime; varying vec2 vC; varying vec3 vA;
      float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float ns(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() { float r = dot(vC, vC); vec2 q = vC * 1.6 + vec2(vA.y, vA.y * 1.7 - uTime * 0.35); float n = ns(q) * 0.62 + ns(q * 2.3 + 4.0) * 0.38; float a = exp(-r * 2.6) * smoothstep(0.22, 0.74, n + (1.0 - r) * 0.34) * vA.x * 0.34; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.93, 0.94, 0.96) * uLum, a); }` });
  const steamGeo = (srcs, n) => { const p = [], u = [], a = [], ix = []; let k = 0; srcs.forEach((s, si) => { for (let i = 0; i < n; i++) { const ph = (i + hsh(si, i, 3) * 0.7) / n, rise = 1.3 + hsh(i, si, 5) * 1.1, sp = 0.2 + hsh(i, si, 9) * 0.07; for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { p.push(s[0], s[1], s[2]); u.push(c[0], c[1]); a.push(ph, rise, sp); } ix.push(k, k + 1, k + 2, k, k + 2, k + 3); k += 4; } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setAttribute('aPuff', new THREE.Float32BufferAttribute(a, 3)); g.setIndex(ix); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 3.5); return g; };
  const paintMats = [], brands = {};
  const brand = (B) => { if (brands[B.id]) return brands[B.id]; const M = B.kind === 'hotdog' ? hotdogCart(B) : halalCart(B), A = paintAtlas(B, ar);
    const mat = new THREE.MeshStandardMaterial({ map: A.tex, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.FrontSide, emissive: new THREE.Color(1, 1, 1), emissiveMap: A.em, emissiveIntensity: 0 }); mat.name = 'cart_' + B.id; paintMats.push(mat);
    M.mat = mat; M.steamGeo = steamOn ? steamGeo(M.steam, B.kind === 'hotdog' ? 8 : 16) : null;
    if (M.led) { const g = new THREE.PlaneGeometry(M.led.w, M.led.h); g.translate(M.led.c[0], M.led.c[1], M.led.c[2]); M.ledGeo = g; }
    return (brands[B.id] = M); };

  // ---- where they stand
  const gd = (meta.grid_deg || 28.9) * PI / 180, av = [Math.sin(gd), Math.cos(gd)];     // the avenues' direction (uptown)
  const items = [], queues = [], counts = {}, setOf = (x, y) => { for (const s of meta.sets || []) if (x >= s.play[0] && x <= s.play[2] && y >= s.play[1] && y <= s.play[3]) return s.set; return 'map'; };
  const stand = (B, c, qn, kind) => { const M = c.M; c.brand = B; placed.push(c);
    for (const [u, v, r] of M.solid) statics.addCircle(c.x + c.ax[0] * u, c.y + c.ax[1] * u, r, 'cart');
    const id = B.id + (B.named ? '' : '_' + items.length), it = { id, B, M, x: c.x, z: -c.y, c, state: -1 }; items.push(it); const sk = setOf(c.x, c.y); counts[sk] = counts[sk] || { halal: 0, hotdog: 0, named: 0 }; counts[sk][B.named ? 'named' : kind]++;
    const q = lineOf(c, Math.max(1, qn), 0.6), vd = [c.x + c.ax[0] * M.vendor[0] + c.l[0] * M.vendor[1], c.y + c.ax[1] * M.vendor[0] + c.l[1] * M.vendor[1]];
    it.queue = Object.assign({ id, name: B.name }, q, { n: qn ? q.n : 0, kind, vendor: { x: +vd[0].toFixed(2), y: +vd[1].toFixed(2), face: +(M.vendor[1] < 0 && kind === 'hotdog' ? Math.atan2(c.l[1], c.l[0]) : Math.atan2(c.l[1], c.l[0])).toFixed(4) } }); queues.push(it.queue); return it; };
  const nodeNear = (p) => { let b = -1, bd = 60; N.forEach((n, i) => { const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]); if (d < bd) { bd = d; b = i; } }); return b; };
  function arms(i) { return N[i].e.map((k) => ({ e: E[k], d: edgeDir(E[k], i) })); }
  const crossHalf = (i, d) => { let w = 9; for (const a of arms(i)) if (Math.abs(a.d[0] * d[0] + a.d[1] * d[1]) < 0.5) w = Math.max(w, a.e.width || 9); return w / 2; };
  const crossHalfL = crossHalf; const failed = [];
  // the three named carts: NAMED[k].at.spot = { arm: 'N' 'S' 'E' 'W' (which way from the node the cart sits, in the grid's own compass), side: 'E' 'W' 'N' 'S' (which sidewalk), D }
  const comp = { N: av, S: [-av[0], -av[1]], E: [av[1], -av[0]], W: [-av[1], av[0]] };
  const SPOT = { fastmeal: { arm: 'W', side: 'S', D: 19 }, fadels: { arm: 'W', side: 'S', D: 19 }, dudes: { arm: 'W', side: 'S', D: 19 } };
  for (const B of NAMED) { const i = nodeNear(B.at.node); if (i < 0) continue; const sp = SPOT[B.id], want = comp[sp.arm], sd = comp[sp.side], M = brand(B); let c = null;
    const a = arms(i).sort((p, q) => (q.d[0] * want[0] + q.d[1] * want[1]) - (p.d[0] * want[0] + p.d[1] * want[1]))[0]; if (!a) continue; const s = (a.d[1] * sd[0] - a.d[0] * sd[1]) > 0 ? 1 : -1;
    for (const strict of [true, false]) { for (let k = 0; k < (strict ? 30 : 16) && !c; k++) c = seat(N[i], a.d, s, crossHalf(i, a.d) + (strict ? 10.2 : 8.2) + k * 0.75, M, strict); if (c) break; }     /* as near the corner as the rules let a cart stand; second pass: nearer a pole, a narrower walking lane, rather than be missing */
    if (!c) { failed.push(B.id); continue; } stand(B, c, Math.round((B.at.q[0] + B.at.q[1]) / 2), 'halal').strictSeat = true; }
  // generic carts by a seeded rule: an avenue corner's chance = the avenue's own share x how Midtown the street is
  if (P.get('cartsgen') !== '0') {
    const AK = 1.7, AVE = { '6th Avenue': 0.5, 'Broadway': 0.46, '7th Avenue': 0.42, 'Lexington Avenue': 0.36, '5th Avenue': 0.32, '3rd Avenue': 0.3, 'Park Avenue': 0.28, 'Madison Avenue': 0.28, '8th Avenue': 0.32, 'Park Avenue South': 0.22, '2nd Avenue': 0.16, '9th Avenue': 0.13, '1st Avenue': 0.1, '10th Avenue': 0.07, 'Amsterdam Avenue': 0.08, 'Columbus Avenue': 0.1, 'Central Park West': 0.16, '11th Avenue': 0.03 };
    const stNo = (x, y) => 45 + ((x * av[0] + y * av[1]) - 1328.3) / 79.1, mid = (s) => (s >= 40 && s <= 57.5 ? 1 : s >= 33.5 && s < 40 ? 0.7 : s > 57.5 && s <= 60 ? 0.7 : s >= 22.5 && s < 33.5 ? 0.4 : s < 22.5 ? 0.28 : 0.22);
    const pip = (x, y, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    const parks = (city.parks || []).map((p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.ext) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { p, x0, y0, x1, y1, big: (x1 - x0) * (y1 - y0) > 5000 }; }).filter((p) => p.big);
    const parkDir = (n) => { for (const k of parks) { if (n.p[0] < k.x0 - 45 || n.p[0] > k.x1 + 45 || n.p[1] < k.y0 - 45 || n.p[1] > k.y1 + 45) continue; for (let a = 0; a < 8; a++) { const dx = Math.cos(a * PI / 4 + 0.39), dy = Math.sin(a * PI / 4 + 0.39); if (pip(n.p[0] + dx * 30, n.p[1] + dy * 30, k.p.ext)) return [dx, dy]; } } return null; };
    N.forEach((n, i) => { if (!n.sig || !inPlay(n.p[0], n.p[1])) return; const A = arms(i), aa = A.filter((a) => a.e.ave && AVE[a.e.name]), ss = A.filter((a) => !a.e.ave && (a.e.width || 0) < 30 && a.e.len > 30); if (!aa.length || !ss.length || A.length < 3) return;
      const r = hsh(n.p[0], n.p[1], 41), pk = parkDir(n), p = AK * Math.max(...aa.map((a) => AVE[a.e.name])) * mid(stNo(n.p[0], n.p[1])) + (pk ? 0.3 : 0); if (r >= p) return;
      const hot = hsh(n.p[0], n.p[1], 42) < (pk ? 0.75 : 0.2), B = hot ? HOTDOG[Math.floor(hsh(n.p[0], n.p[1], 43) * HOTDOG.length)] : GENERIC[Math.floor(hsh(n.p[0], n.p[1], 44) * GENERIC.length)], M = brand(B);
      // which arm of the corner and which sidewalk: by the hash, the park side first when a park is there; the first seat that fits is taken
      const opts = []; for (const a of aa.concat(ss)) for (const s of [1, -1]) { const l = [a.d[1] * s, -a.d[0] * s], q = [a.d[0] + l[0], a.d[1] + l[1]]; opts.push({ a, s, k: hsh(n.p[0] + a.d[0] * 7 + s, n.p[1] + a.d[1] * 7, 45) + (a.e.ave ? 0 : 0.18) - (pk ? 0.8 * (q[0] * pk[0] + q[1] * pk[1]) : 0) }); } opts.sort((u, v) => u.k - v.k);
      let c = null; for (const o of opts) { if (SUBWAY.test(o.a.e.name || '')) continue; const D0 = crossHalf(i, o.a.d) + (hot ? 10 : 13); for (let k = 0; k < 6 && !c; k++) c = seat(n, o.a.d, o.s, D0 + k * 2.4, M); if (c) break; } if (!c) return;
      stand(B, c, hot ? Math.floor(hsh(n.p[0], n.p[1], 46) * 2.2) : Math.floor(hsh(n.p[0], n.p[1], 46) * 3.99), hot ? 'hotdog' : 'halal'); });
  }

  // ---- meshes: one small set per cart (shared geometry and material per brand), shown by distance
  const mk = (geo, mat, it, cast) => { const m = new THREE.Mesh(geo, mat); m.position.set(it.x, SW, it.z); m.rotation.y = it.c.h; m.updateMatrix(); m.updateMatrixWorld(true); m.matrixAutoUpdate = false; m.castShadow = !!cast; m.receiveShadow = !!cast; m.visible = false; group.add(m); return m; };
  let tris = 0;
  for (const it of items) { const M = it.M; it.near = [mk(M.paint, M.mat, it, true), mk(M.steel, steelMat, it, true)]; if (M.ledGeo) { const l = mk(M.ledGeo, ledMat, it, false); it.near.push(l); } if (M.mess && M.mess.index.count) it.near.push(mk(M.mess, messMat, it, true));
    it.steam = M.steamGeo ? mk(M.steamGeo, steamMat, it, false) : null; if (it.steam) it.steam.renderOrder = 6; it.far = mk(M.far, M.mat, it, true); tris += M.tris; }
  world.scene.add(group);
  const prev = world.scene.onBeforeRender; let lastLamp = -1;
  world.scene.onBeforeRender = function (renderer, scene, camera, rt) {
    if (prev) prev.call(this, renderer, scene, camera, rt);
    if (!camera.isPerspectiveCamera || !group.visible) return; const p = camera.position, over = !!scene.overrideMaterial;
    for (const it of items) { const d = Math.hypot(p.x - it.x, p.z - it.z), st = d < NEAR ? 0 : d < FAR ? 1 : 2;
      if (st !== it.state) { it.state = st; for (const m of it.near) m.visible = st === 0; it.far.visible = st === 1; }
      if (it.steam) it.steam.visible = st === 0 && d < 60 && !over; }
    const nt = game.night, lamp = nt && nt.active ? (nt.lampOn || 0) : 0;
    if (lamp !== lastLamp) { lastLamp = lamp; for (const m of paintMats) m.emissiveIntensity = 0.05 + 0.5 * lamp; const k = 1.6 + 1.2 * lamp; ledMat.color.setRGB(k, k, k); steamMat.uniforms.uLum.value = 1 - 0.8 * (nt && nt.active ? nt.n || 0 : 0); }
    ledTex.offset.x = (performance.now() * 0.00005) % 1;
  };
  game.queues = (game.queues || []).concat(queues.filter((q) => q.n > 0));
  game.carts = { group, items, queues, counts, failed, old };
  // ?cartsdump=1 (the lane's own check: the frame tools read no console): the numbers as built, written on a board 400 m up over the origin, facing south
  if (P.get('cartsdump') === '1') { const cv = document.createElement('canvas'); cv.width = cv.height = 2048; const g = cv.getContext('2d'); g.fillStyle = '#20242a'; g.fillRect(0, 0, 2048, 2048); g.fillStyle = '#e8e8e8'; g.font = '25px monospace'; g.textBaseline = 'top';
    const L = ['counts ' + JSON.stringify(counts), 'failed ' + JSON.stringify(failed) + ' old ' + JSON.stringify(old) + ' carts ' + items.length + ' queues ' + queues.filter((q) => q.n > 0).length + ' tris ' + tris];
    const wr = (t) => { for (let i = 0; i < t.length; i += 132) L.push(t.slice(i, i + 132)); };
    for (const it of items) if (it.B.named) wr(JSON.stringify(it.queue) + ' cart ' + JSON.stringify([+it.c.x.toFixed(2), +it.c.y.toFixed(2), +it.c.h.toFixed(4), +it.c.wall.toFixed(1)]));
    const seen = {}; for (const it of items) { const k = it.B.id; if (it.B.named || seen[k]) continue; seen[k] = 1; wr(k + ' ' + JSON.stringify([+it.c.x.toFixed(1), +it.c.y.toFixed(1), +it.c.h.toFixed(3), it.queue.n, +it.c.d[0].toFixed(2), +it.c.d[1].toFixed(2), +it.c.l[0].toFixed(2), +it.c.l[1].toFixed(2)])); }
    wr('all ' + items.map((it) => it.B.id.slice(0, 2) + Math.round(it.c.x) + ',' + Math.round(it.c.y)).join(' '));
    L.forEach((t, i) => g.fillText(t, 14, 10 + i * 31)); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; const bd = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, fog: false })); bd.position.set(0, 400, 0); group.add(bd); }
  const audit = (tag) => { const A = { carts: items.length, offSidewalk: 0, inLane: 0, wallMin: 99, stairMin: 99, doorMin: 99, cornerMin: 99, onSubwayKerb: 0, onGrate: 0, gratesKnown: 0, lineOffSidewalk: 0 }; grG.clear(); { const gp = ctx.parts && ctx.parts.ground, ls = gp ? [gp.grates].concat(Object.values(gp.sets || {}).map((r) => r && r.grates)) : []; for (const a of ls) for (const g of a || []) { A.gratesKnown++; const k = grK(g[0], g[1]); let bb = grG.get(k); if (!bb) grG.set(k, (bb = [])); bb.push(g); } }
    for (const it of items) { const c = it.c, f = c.M.foot, half = c.kerb - 0.36, loc = (u, v) => [c.x + c.ax[0] * u + c.l[0] * v, c.y + c.ax[1] * u + c.l[1] * v]; if ([[f[0], -half], [f[1], -half], [f[0], half], [f[1], half]].some(([u, v]) => { const q = loc(u, v); return !statics.onSidewalk(q[0], q[1]); })) A.offSidewalk++;
      if (c.M.solid.some(([u, v, r]) => { const q = loc(u, 0); return inLane(q[0], q[1], r); })) A.inLane++; A.wallMin = Math.min(A.wallMin, bray(c.x, c.y, c.x + c.l[0] * 9, c.y + c.l[1] * 9) * 9 - half); A.stairMin = Math.min(A.stairMin, entDist(c.fp)); A.doorMin = Math.min(A.doorMin, doorDist(c.x, c.y)); A.cornerMin = Math.min(A.cornerMin, cornerGap(c.x, c.y, c.ax, c.l, f));
      if (onGrate(c.x, c.y, c.ax, c.l, f)) A.onGrate++; if (it.queue.n > 0 && it.queue.pts.some((p) => !statics.onSidewalk(p[0], p[1]))) A.lineOffSidewalk++; }
    for (const k of ['wallMin', 'stairMin', 'doorMin', 'cornerMin']) A[k] = +A[k].toFixed(2); A.stairs = ents.length; A.doors = doorList.length; A.buildingSegCells = bseg.size; console.log('[game] carts audit ' + tag + ' ' + JSON.stringify(A)); return A; };
  console.log('[game] carts built: city ' + ((P.get('city') || (window.__CFG && window.__CFG.city) || 'city.json')) + ' areas ' + ((meta.sets || []).map((q) => q.set).join(',') || 'one') + ' counts ' + JSON.stringify(counts) + ' failed ' + JSON.stringify(failed) + ' old ' + JSON.stringify(old) + ' queues ' + queues.filter((q) => q.n > 0).length + ' ktris ' + Math.round(tris / 1000));
  for (const it of items) if (it.B.named) console.log('[game] carts named ' + JSON.stringify(it.queue) + ' cart ' + JSON.stringify([+it.c.x.toFixed(2), +it.c.y.toFixed(2), +it.c.h.toFixed(4), +it.c.wall.toFixed(1)]));
  game.carts.audit = audit('at load'); { let last = game.carts.audit.gratesKnown, n = 0; const iv = setInterval(() => { try { const gp = ctx.parts && ctx.parts.ground; let k = gp ? (gp.grates || []).length : 0; if (gp) for (const r of Object.values(gp.sets || {})) k += r && r.grates ? r.grates.length : 0; if (k !== last) { last = k; game.carts.audit = audit('after an area was built late'); } } catch (e) { /* the audit is a log only */ } if (++n > 240) clearInterval(iv); }, 5000); }
  return { group, items, queues, report: { instances: items.length, ktris: Math.round(tris / 1000), counts, failed, old, queues: game.queues.length } };
}
