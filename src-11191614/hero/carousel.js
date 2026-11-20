// hero/carousel.js (brooklyn lane, helper carousel, Nov 16): the carousel pavilion on the DUMBO waterfront between the two bridges, and the park round it.
//   The pavilion (city building 2000059, OSM way 223183095, 21.7 m square, 7 m high): a clear box: slim steel mullions, a thin flat roof on four round
//   columns, walls you see straight through. Inside it a 1922-style three-row carousel: a round deck 15 m across, 48 horses on brass poles in three rows
//   and two chariots, a centre drum of mirrors, rounding boards and a striped canopy in cream, red and gold, rows of bulbs. It turns slowly; the two inner
//   rows gallop up and down. At night (world.shared.uNightK.y) the bulbs glow and light the deck, the floor and the paving round the box.
//   The park (OSM "Empire Fulton Ferry", the game's lawn and trees are already there): a paved square round the pavilion, the plank boardwalk west along the
//   water, a paved path in from the south, a gravel path east along the cove, a post-and-cable railing at the water's edge, twelve benches.
// How: all geometry is made here and merged: 5 draw calls (structure and park / glass / carousel / horses, one InstancedMesh / bulbs), three small canvases,
// no file fetched. The generated box of that lot is cut out of the city tiles as dumbolofts.js does it, and the street-floor layer's shop fronts and the
// roof plant on that lot are hidden. The game's solid wall (the footprint) is unchanged: the pavilion is solid, nobody walks in.
// Installs only on a map that has that building. Off: ?carousel=0. window.__carousel = { tris, calls, cut, pruned }.
// The trees that stood in the pavilion, on the paving and on the open lawn are taken out of the city file by tools/dumbo_fix.py (rerun after a rebuild).
import * as THREE from 'three';

const ID = 2000059, G = 0.2, PV = 0.3, FLOOR = 0.34, DECK = 0.70,     /* ground of the park's lawn 0.18; the paving 12 cm over it (6 cm lost to the lawn from the air, hold 1) */
  HALF_DEF = 10.83, ROOF = 7.0;
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const C = { white: [1, 1, 1], steel: lin(0xa9adb0), steelDk: lin(0x5f6468), roof: lin(0xc4c6c3), conc: lin(0x8f8d86), pave: [0.58, 0.58, 0.57], plank: [0.52, 0.5, 0.48], col: lin(0xe6e6e2), wood: lin(0x7a5334), woodDk: lin(0x5a3a22), iron: lin(0x2a2c2e), gravel: lin(0x9a8c70),
  cream: lin(0xf1e4c3), red: lin(0xa8201a), redDk: lin(0x7c1612), gold: lin(0xd9a531), brass: lin(0xe0b040), deck: lin(0x6d4526), rail: lin(0x8d9296), hoof: lin(0x1c1612), saddle: lin(0x4a2412), door: lin(0x3c4043) };
const UVW = [0.75, 0.25], UVS = [0.5, 0.16];     // a white texel of the carousel canvas / of the structure canvas

class Buf {
  constructor(def) { this.p = []; this.n = []; this.c = []; this.u = []; this.t = []; this.i = []; this.def = def || [0.5, 0.5]; this.tag = 0; }
  poly(pts, hint, col, uvs) {     // a convex polygon as a fan, turned to face the hint
    const a = pts[0], b = pts[1], d = pts[pts.length - 1];
    let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = this.p.length / 3; for (let k = 0; k < pts.length; k++) { const q = pts[k], uv = uvs ? uvs[k] : this.def; this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.u.push(uv[0], uv[1]); this.t.push(this.tag); }
    for (let k = 1; k + 1 < pts.length; k++) { if (flip) this.i.push(base, base + k + 1, base + k); else this.i.push(base, base + k, base + k + 1); }
  }
  get tris() { return this.i.length / 3; }
  geo(tag) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (tag) g.setAttribute('aTrim', new THREE.Float32BufferAttribute(this.t, 1)); g.setIndex(this.i); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
// a tube along points [x, y, z, rs, rt]: rs = half size along `ref` (made square to the tube), rt = half size along the third axis; 4 sides = a box of those half sizes
function chain(B, pts, sides, col, ref, caps = 'se') {
  const rings = [], n = pts.length, f = sides === 4 ? Math.SQRT2 : 1, a0 = sides === 4 ? Math.PI / 4 : 0;
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const k = ref[0] * dx + ref[1] * dy + ref[2] * dz; let sx = ref[0] - dx * k, sy = ref[1] - dy * k, sz = ref[2] - dz * k; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const tx = dy * sz - dz * sy, ty = dz * sx - dx * sz, tz = dx * sy - dy * sx, ring = [];
    for (let j = 0; j < sides; j++) { const an = a0 + 2 * Math.PI * j / sides, c = Math.cos(an) * f * p[3], s = Math.sin(an) * f * p[4]; ring.push([p[0] + sx * c + tx * s, p[1] + sy * c + ty * s, p[2] + sz * c + tz * s]); }
    rings.push({ ring, d: [dx, dy, dz] }); }
  for (let i = 0; i + 1 < n; i++) { const A = rings[i].ring, D = rings[i + 1].ring, mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2, mz = (pts[i][2] + pts[i + 1][2]) / 2;
    for (let j = 0; j < sides; j++) { const k = (j + 1) % sides, q = [A[j], A[k], D[k], D[j]]; B.poly(q, [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4 - mx, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4 - my, (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 - mz], col); } }
  if (caps.includes('s')) { const d = rings[0].d; B.poly(rings[0].ring, [-d[0], -d[1], -d[2]], col); } if (caps.includes('e')) B.poly(rings[n - 1].ring, rings[n - 1].d, col);
}
const UP = [0, 1, 0], EX = [1, 0, 0], EZ = [0, 0, 1];
// local frame of the group: e east, u up, n north (three.js z = -n)
const bx = (B, e0, e1, u0, u1, n0, n1, col) => chain(B, [[e0, (u0 + u1) / 2, -(n0 + n1) / 2, (u1 - u0) / 2, (n1 - n0) / 2], [e1, (u0 + u1) / 2, -(n0 + n1) / 2, (u1 - u0) / 2, (n1 - n0) / 2]], 4, col, UP);
const post = (B, e, n, u0, u1, he, hn, col, sides = 4, caps = 'e') => chain(B, [[e, u0, -n, he, hn], [e, u1, -n, he, hn]], sides, col, EX, caps);
const flat = (B, e0, e1, n0, n1, u, col, uv) => B.poly([[e0, u, -n0], [e1, u, -n0], [e1, u, -n1], [e0, u, -n1]], UP, col, uv);

// ------------------------------------------------------------------ canvases
function structCanvas() {     // 256 x 768, repeats along u. Top third: boardwalk planks (8 across); middle third: one paving slab; bottom third: white
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 768; const g = cv.getContext('2d'); let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 768);
  for (let i = 0; i < 8; i++) { const v = 118 + rnd() * 34; g.fillStyle = `rgb(${v + 14},${v + 2},${v - 14})`; g.fillRect(i * 32, 0, 32, 256);
    for (let k = 0; k < 26; k++) { const s = (rnd() - 0.5) * 22; g.fillStyle = `rgba(${s > 0 ? 255 : 0},${s > 0 ? 240 : 0},${s > 0 ? 220 : 0},${Math.abs(s) / 110})`; g.fillRect(i * 32 + 2 + rnd() * 26, rnd() * 256, 1 + rnd() * 2, 30 + rnd() * 120); }
    g.fillStyle = 'rgba(30,24,18,0.85)'; g.fillRect(i * 32, 0, 2, 256); }
  g.fillStyle = '#c2beb4'; g.fillRect(0, 256, 256, 256);
  for (let k = 0; k < 1500; k++) { const v = rnd(); g.fillStyle = v < 0.5 ? `rgba(60,58,52,${0.05 + rnd() * 0.10})` : `rgba(255,252,244,${0.05 + rnd() * 0.12})`; g.fillRect(rnd() * 256, 256 + rnd() * 256, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  g.fillStyle = 'rgba(70,68,62,0.8)'; g.fillRect(0, 256, 3, 256); g.fillRect(0, 258, 256, 3); g.fillRect(0, 507, 256, 3);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function carCanvas() {     // 1024 x 512. Upper half: one rounding-board panel (repeats along u). Lower half: left = a drum panel, right = white
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g = cv.getContext('2d'), GOLD = '#d9a531', RED = '#a8201a', CREAM = '#f1e4c3', MIR = '#cfe3ee';
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = CREAM; g.fillRect(0, 0, 1024, 256); g.fillStyle = RED; g.fillRect(0, 0, 1024, 28); g.fillRect(0, 228, 1024, 28); g.fillStyle = GOLD; g.fillRect(0, 28, 1024, 8); g.fillRect(0, 220, 1024, 8);
  for (const x of [0, 992]) { g.fillStyle = GOLD; g.fillRect(x, 36, 32, 184); g.fillStyle = RED; g.fillRect(x + 7, 48, 18, 160); g.fillStyle = MIR; g.beginPath(); g.moveTo(x + 16, 92); g.lineTo(x + 24, 128); g.lineTo(x + 16, 164); g.lineTo(x + 8, 128); g.closePath(); g.fill(); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const sg of [-1, 1]) {     // gold scrollwork either side of the picture, a mirror in a gold ring, a red rosette
    g.strokeStyle = '#c8921f'; g.lineWidth = 9; g.beginPath(); for (let i = 0; i <= 48; i++) { const t = i / 48, a = t * Math.PI * 3.4, r = 50 * (1 - t * 0.82); g[i ? 'lineTo' : 'moveTo'](512 + sg * (248 + r * Math.cos(a)), 132 - r * Math.sin(a)); } g.stroke();
    g.beginPath(); g.moveTo(512 + sg * 298, 132); g.bezierCurveTo(512 + sg * 330, 200, 512 + sg * 400, 60, 512 + sg * 462, 128); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(512 + sg * 170, 72); g.bezierCurveTo(512 + sg * 240, 40, 512 + sg * 360, 56, 512 + sg * 440, 70); g.stroke(); g.beginPath(); g.moveTo(512 + sg * 170, 186); g.bezierCurveTo(512 + sg * 240, 214, 512 + sg * 360, 200, 512 + sg * 440, 188); g.stroke();
    g.fillStyle = GOLD; g.beginPath(); g.ellipse(512 + sg * 392, 128, 36, 46, 0, 0, 7); g.fill(); g.fillStyle = MIR; g.beginPath(); g.ellipse(512 + sg * 392, 128, 27, 37, 0, 0, 7); g.fill();
    g.fillStyle = RED; g.beginPath(); g.arc(512 + sg * 248, 132, 13, 0, 7); g.fill(); }
  g.fillStyle = GOLD; g.beginPath(); g.ellipse(512, 128, 152, 78, 0, 0, 7); g.fill(); g.fillStyle = RED; g.beginPath(); g.ellipse(512, 128, 142, 69, 0, 0, 7); g.fill();
  g.save(); g.beginPath(); g.ellipse(512, 128, 132, 60, 0, 0, 7); g.clip();     // a small landscape: sky, far hills, water, a near bank
  { const sky = g.createLinearGradient(0, 68, 0, 150); sky.addColorStop(0, '#7fb4dc'); sky.addColorStop(1, '#ecdfb8'); g.fillStyle = sky; g.fillRect(360, 60, 310, 140);
    g.fillStyle = '#6f8f6a'; g.beginPath(); g.moveTo(370, 150); g.bezierCurveTo(440, 96, 500, 150, 560, 118); g.bezierCurveTo(600, 100, 640, 140, 660, 150); g.closePath(); g.fill();
    g.fillStyle = '#5b8db3'; g.fillRect(360, 148, 310, 22); g.fillStyle = '#4c7a36'; g.beginPath(); g.moveTo(360, 200); g.lineTo(360, 172); g.bezierCurveTo(450, 152, 560, 184, 670, 164); g.lineTo(670, 200); g.closePath(); g.fill(); } g.restore();
  // drum panel: a red field in a gold frame, an arched mirror above, a cream panel with a gold lozenge below
  g.fillStyle = RED; g.fillRect(0, 256, 512, 256); g.strokeStyle = GOLD; g.lineWidth = 22; g.strokeRect(11, 267, 490, 234);
  g.fillStyle = GOLD; g.beginPath(); g.moveTo(60, 400); g.lineTo(60, 300); g.bezierCurveTo(60, 276, 452, 276, 452, 300); g.lineTo(452, 400); g.closePath(); g.fill();
  { const m = g.createLinearGradient(0, 290, 512, 400); m.addColorStop(0, '#e6f1f6'); m.addColorStop(0.5, '#9fb9c8'); m.addColorStop(1, '#dbe9f0'); g.fillStyle = m; g.beginPath(); g.moveTo(92, 394); g.lineTo(92, 304); g.bezierCurveTo(92, 290, 420, 290, 420, 304); g.lineTo(420, 394); g.closePath(); g.fill(); }
  g.fillStyle = CREAM; g.fillRect(60, 414, 392, 66); g.fillStyle = GOLD; g.beginPath(); g.moveTo(256, 420); g.lineTo(330, 447); g.lineTo(256, 474); g.lineTo(182, 447); g.closePath(); g.fill(); g.fillStyle = RED; g.beginPath(); g.arc(256, 447, 12, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// ------------------------------------------------------------------ the horse: x forward, y up, z to its right (the outside of the carousel); in a gallop, lowest hoof at y 0.28
// aTrim: 0 coat (the instance's colour), 1 the vertex colour as it is (saddle, hooves), 2 the instance's blanket colour, 3 mane and tail (the coat, darkened)
function horseGeo() {
  const B = new Buf(UVW), W = C.white, part = (tag, pts, sides, col, caps) => { B.tag = tag; chain(B, pts, sides, col || W, EZ, caps); };
  part(0, [[-0.70, 1.04, 0, 0.09, 0.10], [-0.48, 1.03, 0, 0.19, 0.22], [0, 0.98, 0, 0.185, 0.215], [0.40, 1.02, 0, 0.18, 0.23], [0.60, 1.10, 0, 0.12, 0.15]], 8, W, 'se');     // rump, barrel, chest
  part(0, [[0.50, 1.10, 0, 0.11, 0.17], [0.74, 1.52, 0, 0.07, 0.10]], 6, W, '');     // neck
  part(0, [[0.70, 1.60, 0, 0.075, 0.10], [0.86, 1.44, 0, 0.07, 0.085], [1.02, 1.26, 0, 0.045, 0.05]], 6, W, 'se');     // head, nose down
  for (const s of [-1, 1]) part(0, [[0.71, 1.64, s * 0.05, 0.025, 0.03], [0.68, 1.77, s * 0.06, 0.004, 0.004]], 4, W, '');     // ears
  part(3, [[0.40, 1.20, 0, 0.03, 0.05], [0.55, 1.48, 0, 0.03, 0.06], [0.64, 1.62, 0, 0.025, 0.04]], 4, W, 'se');     // mane
  part(3, [[-0.66, 1.10, 0, 0.045, 0.045], [-0.84, 1.04, 0, 0.055, 0.06], [-0.92, 0.72, 0, 0.02, 0.03]], 5, W, 'e');     // tail
  const leg = (z, a, b, c, h) => { part(0, [[a[0], a[1], z, 0.07, 0.08], [b[0], b[1], z, 0.045, 0.05], [c[0], c[1], z, 0.035, 0.04]], 5, W, ''); part(1, [[c[0], c[1], z, 0.045, 0.045], [h[0], h[1], z, 0.05, 0.05]], 5, C.hoof, 'e'); };
  leg(0.105, [0.42, 0.95], [0.64, 0.66], [0.52, 0.40], [0.49, 0.32]); leg(-0.105, [0.44, 0.95], [0.70, 0.74], [0.90, 0.56], [0.97, 0.50]);     // fore legs: one tucked, one reaching
  leg(0.105, [-0.44, 0.95], [-0.62, 0.62], [-0.80, 0.36], [-0.86, 0.29]); leg(-0.105, [-0.40, 0.95], [-0.50, 0.60], [-0.66, 0.36], [-0.71, 0.28]);     // hind legs thrown back
  part(2, [[-0.34, 1.01, 0, 0.20, 0.235], [0.24, 1.01, 0, 0.195, 0.24]], 8, W, '');     // the blanket, a band round the barrel
  part(1, [[-0.28, 1.25, 0, 0.15, 0.035], [0.18, 1.245, 0, 0.14, 0.035]], 4, C.saddle, 'se'); part(1, [[-0.30, 1.26, 0, 0.14, 0.03], [-0.27, 1.36, 0, 0.12, 0.02]], 4, C.saddle, 'e');     // saddle and cantle
  return B;
}

// ------------------------------------------------------------------ the carousel (turns about the group's y axis; y = 0 is the ground)
const RP = 7.5, RD = 1.9, NS = 18, ROWS = [[6.75, 1.1, 0], [5.55, 1.0, 0.16], [4.4, 0.9, 0.14]], CHARIOT = [4, 13], POLE_TOP = 4.55;
const ring = (r, y, a) => [r * Math.cos(a), y, -r * Math.sin(a)];
function carouselBufs() {
  const B = new Buf(UVW), L = new Buf([0.5, 0.5]), TAU = Math.PI * 2;
  // deck: top, red rim with a gold edge
  { const top = []; for (let i = 0; i < 36; i++) top.push(ring(RP, DECK, TAU * i / 36)); B.poly(top, UP, C.deck);
    for (let i = 0; i < 36; i++) { const a = TAU * i / 36, b = TAU * (i + 1) / 36, m = (a + b) / 2, out = [Math.cos(m), 0, -Math.sin(m)];
      B.poly([ring(RP, FLOOR + 0.04, a), ring(RP, FLOOR + 0.04, b), ring(RP, DECK - 0.07, b), ring(RP, DECK - 0.07, a)], out, C.red); B.poly([ring(RP + 0.02, DECK - 0.07, a), ring(RP + 0.02, DECK - 0.07, b), ring(RP + 0.02, DECK, b), ring(RP + 0.02, DECK, a)], out, C.gold); } }
  // centre drum: 16 mirrored panels; a red and gold cornice
  for (let i = 0; i < 16; i++) { const a = TAU * i / 16, b = TAU * (i + 1) / 16, m = (a + b) / 2, out = [Math.cos(m), 0, -Math.sin(m)];
    B.poly([ring(RD, DECK, a), ring(RD, DECK, b), ring(RD, 4.05, b), ring(RD, 4.05, a)], out, C.white, [[0.49, 0.02], [0.01, 0.02], [0.01, 0.48], [0.49, 0.48]]);
    B.poly([ring(RD, 4.05, a), ring(RD, 4.05, b), ring(2.3, 4.55, b), ring(2.3, 4.55, a)], [out[0], -0.6, out[2]], i % 2 ? C.red : C.gold);
    chain(B, [[...ring(RD + 0.02, DECK, a), 0.035, 0.035], [...ring(RD + 0.02, 4.05, a), 0.035, 0.035]], 4, C.gold, [Math.cos(a), 0, -Math.sin(a)], ''); }
  // the canopy from below (cream and red sectors), the sweeps, the rounding boards (painted panels outside, plain cream inside), crests at the joints, the striped top
  for (let i = 0; i < NS; i++) { const a = TAU * i / NS, b = TAU * (i + 1) / NS, m = (a + b) / 2, out = [Math.cos(m), 0, -Math.sin(m)], cs = i % 2 ? C.cream : C.red;
    B.poly([ring(2.3, 4.55, a), ring(2.3, 4.55, b), ring(7.62, 4.72, b), ring(7.62, 4.72, a)], [0, -1, 0], i % 2 ? C.cream : lin(0xd8b9a0));
    chain(B, [[...ring(2.25, 4.5, a), 0.05, 0.035], [...ring(7.6, 4.5, a), 0.05, 0.035]], 4, C.gold, UP, '');
    B.poly([ring(7.62, 4.3, a), ring(7.62, 4.3, b), ring(7.8, 5.2, b), ring(7.8, 5.2, a)], out, C.white, [[1, 0.52], [0, 0.52], [0, 0.98], [1, 0.98]]);
    B.poly([ring(7.58, 4.3, a), ring(7.58, 4.3, b), ring(7.76, 5.2, b), ring(7.76, 5.2, a)], [-out[0], 0, -out[2]], C.cream);
    { const o = [Math.cos(a), 0, -Math.sin(a)], t = [-Math.sin(a), 0, -Math.cos(a)], c = ring(7.86, 5.16, a), sh = [], sh2 = []; for (let k = 0; k < 8; k++) { const an = TAU * k / 8 + Math.PI / 8, x = Math.cos(an), y = Math.sin(an); sh.push([c[0] + t[0] * x * 0.3, c[1] + y * 0.36, c[2] + t[2] * x * 0.3]); sh2.push([c[0] + o[0] * 0.02 + t[0] * x * 0.17, c[1] + y * 0.21, c[2] + o[2] * 0.02 + t[2] * x * 0.17]); }
      B.poly(sh, o, C.gold); B.poly(sh2, o, C.red); B.poly(sh.slice().reverse(), [-o[0], 0, -o[2]], C.gold); }
    B.poly([ring(7.8, 5.2, a), ring(7.8, 5.2, b), ring(0.5, 6.2, b), ring(0.5, 6.2, a)], [out[0], 3, out[2]], cs); }
  { const cap = []; for (let i = 0; i < NS; i++) cap.push(ring(0.5, 6.2, TAU * i / NS)); B.poly(cap, UP, C.gold); post(B, 0, 0, 6.2, 6.6, 0.07, 0.07, C.gold, 6); }
  // horses' places: 16 threes and two chariots; a brass pole through each horse
  const slots = [];
  for (let s = 0; s < NS; s++) { const th = TAU * (s + 0.5) / NS;
    if (CHARIOT.includes(s)) {     // a chariot: two red side boards with gold tops along the way round, two cream seats across
      const o = [Math.cos(th), 0, -Math.sin(th)], t = [-Math.sin(th), 0, -Math.cos(th)], at = (r, y, k) => [o[0] * r + t[0] * k, y, o[2] * r + t[2] * k];
      for (const r of [5.0, 6.9]) { chain(B, [[...at(r, DECK + 0.55, -1.05), 0.5, 0.035], [...at(r, DECK + 0.55, 0.75), 0.5, 0.035], [...at(r, DECK + 0.75, 1.15), 0.3, 0.035]], 4, C.red, UP, 'se'); chain(B, [[...at(r, DECK + 1.08, -1.05), 0.035, 0.05], [...at(r, DECK + 1.08, 0.75), 0.035, 0.05]], 4, C.gold, UP, 'se'); }
      for (const k of [-0.7, 0.3]) { chain(B, [[...at(5.0, DECK + 0.48, k), 0.04, 0.22], [...at(6.9, DECK + 0.48, k), 0.04, 0.22]], 4, C.cream, UP, ''); chain(B, [[...at(5.0, DECK + 0.78, k - 0.24), 0.3, 0.03], [...at(6.9, DECK + 0.78, k - 0.24), 0.3, 0.03]], 4, C.cream, UP, ''); }
      continue; }
    ROWS.forEach((R, row) => { slots.push({ th, r: R[0], sc: R[1], amp: R[2], ph: row === 1 ? (s % 2 ? 0 : Math.PI) : (s % 2 ? Math.PI : 0), row, s });
      const pa = th + 0.14 * R[1] / R[0], p0 = ring(R[0], DECK, pa), p1 = ring(R[0], POLE_TOP, pa); chain(B, [[...p0, 0.026, 0.026], [...p1, 0.026, 0.026]], 5, C.brass, EX, ''); }); }
  // bulbs: along the rounding boards top and bottom, under the sweeps, round the drum's cornice and up its edges
  const bulb = (c, r) => { const v = [[c[0] + r, c[1], c[2]], [c[0] - r, c[1], c[2]], [c[0], c[1] + r, c[2]], [c[0], c[1] - r, c[2]], [c[0], c[1], c[2] + r], [c[0], c[1], c[2] - r]];
    for (const f of [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]]) { const q = f.map((k) => v[k]); L.poly(q, [(q[0][0] + q[1][0] + q[2][0]) / 3 - c[0], (q[0][1] + q[1][1] + q[2][1]) / 3 - c[1], (q[0][2] + q[1][2] + q[2][2]) / 3 - c[2]], C.white); } };
  for (let i = 0; i < NS; i++) { const a = TAU * i / NS, da = TAU / NS; for (let k = 0; k < 8; k++) { const an = a + da * (k + 0.5) / 8; bulb(ring(7.68, 4.34, an), 0.05); bulb(ring(7.84, 5.17, an), 0.05); }
    for (let k = 0; k < 7; k++) bulb(ring(2.9 + k * 0.72, 4.43, a), 0.05); }
  for (let i = 0; i < 16; i++) { const a = TAU * i / 16; for (let k = 0; k < 3; k++) bulb(ring(2.34, 4.5, a + TAU * (k + 0.5) / 48), 0.045); for (let k = 0; k < 5; k++) bulb(ring(RD + 0.07, DECK + 0.5 + k * 0.7, a), 0.04); }
  return { B, L, slots };
}

// ------------------------------------------------------------------ pavilion and park (static); H = half the pavilion's side
const RAIL = [[-90, 21.5], [-14.6, 21.5], [-11.9, 26.3], [19.1, 26.3], [19.5, 2.0], [24.3, -3.0], [31.0, -15.6], [36.2, -22.9], [45.2, -31.6], [52.2, -36.5], [59.9, -40.1], [71.0, -44.2]];     // the water's edge, west to east (local metres from the pavilion's centre)
const BENCH = [[-84, 16.6, 0], [-72, 16.6, 0], [-60, 16.6, 0], [-48, 16.6, 0], [-36, 16.6, 0], [-24, 16.6, 0], [-4, 25.3, 0], [4, 25.3, 0], [12, 25.3, 0], [18.5, 6, -Math.PI / 2], [18.5, 11, -Math.PI / 2], [18.5, 16, -Math.PI / 2]];     // [e, n, turn]: turn 0 looks north over the water
function structureBufs(H) {
  const S = new Buf(UVS), GL = new Buf([0.5, 0.5]);
  // paving: the square round the pavilion (1.2 m slabs), the path in from the south, the plank boardwalk west along the water, the gravel path along the cove
  const slabs = (e0, e1, n0, n1, alongN) => { if (alongN) for (let e = e0; e < e1 - 1e-3; e += 1.2) { const f = Math.min(e + 1.2, e1), v1 = 0.335 + 0.33 * (f - e) / 1.2; S.poly([[e, PV, -n0], [f, PV, -n0], [f, PV, -n1], [e, PV, -n1]], UP, C.pave, [[n0 / 1.2, 0.335], [n0 / 1.2, v1], [n1 / 1.2, v1], [n1 / 1.2, 0.335]]); }
    else for (let n = n0; n < n1 - 1e-3; n += 1.2) { const f = Math.min(n + 1.2, n1), v1 = 0.335 + 0.33 * (f - n) / 1.2; flat(S, e0, e1, n, f, PV, C.pave, [[e0 / 1.2, 0.335], [e1 / 1.2, 0.335], [e1 / 1.2, v1], [e0 / 1.2, v1]]); } };
  slabs(-13.5, 19.7, -14.5, 21.8); slabs(-11.6, 19.3, 21.8, 26.5); slabs(-1.8, 1.8, -57, -14.5, true);
  flat(S, -90, -13.5, 17.2, 21.2, PV, C.plank, [[-90 / 1.12, 0.69], [-13.5 / 1.12, 0.69], [-13.5 / 1.12, 0.98], [-90 / 1.12, 0.98]]);
  { const P = RAIL.slice(4), nrm = (i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; };     // the landward side of the rail
    for (let i = 0; i + 1 < P.length; i++) { const na = nrm(i), nb = nrm(i + 1), a = P[i], b = P[i + 1]; S.poly([[a[0] + na[0] * 0.7, G + 0.08, -(a[1] + na[1] * 0.7)], [b[0] + nb[0] * 0.7, G + 0.08, -(b[1] + nb[1] * 0.7)], [b[0] + nb[0] * 3.7, G + 0.08, -(b[1] + nb[1] * 3.7)], [a[0] + na[0] * 3.7, G + 0.08, -(a[1] + na[1] * 3.7)]], UP, C.gravel); } }
  // the railing: posts 2 m apart, a flat top rail, four cables
  for (let i = 0; i + 1 < RAIL.length; i++) { const a = RAIL[i], b = RAIL[i + 1], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]), np = Math.max(1, Math.round(Ln / 2));
    for (let k = 0; k < np + (i === RAIL.length - 2 ? 1 : 0); k++) { const t = k / np; post(S, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, G, G + 1.07, 0.03, 0.03, C.rail, 4, ''); }
    chain(S, [[a[0], G + 1.08, -a[1], 0.015, 0.04], [b[0], G + 1.08, -b[1], 0.015, 0.04]], 4, C.rail, UP, 'se');
    for (const u of [0.24, 0.45, 0.66, 0.87]) chain(S, [[a[0], G + u, -a[1], 0.009, 0.009], [b[0], G + u, -b[1], 0.009, 0.009]], 4, C.steelDk, UP, ''); }
  // benches: three wide wood slats for the seat, two for the back, dark iron ends
  for (const [e, n, turn] of BENCH) { const ax = [Math.cos(turn), Math.sin(turn)], f = [-Math.sin(turn), Math.cos(turn)], at = (k, d, u) => [e + ax[0] * k + f[0] * d, u, -(n + ax[1] * k + f[1] * d)], y = G + 0.07;
    for (const d of [-0.15, 0, 0.15]) chain(S, [[...at(-0.9, d, y + 0.45), 0.02, 0.065], [...at(0.9, d, y + 0.45), 0.02, 0.065]], 4, C.wood, UP, 'se');
    for (const u of [0.62, 0.8]) chain(S, [[...at(-0.9, -0.25, y + u), 0.07, 0.02], [...at(0.9, -0.25, y + u), 0.07, 0.02]], 4, C.wood, UP, 'se');
    for (const k of [-0.8, 0.8]) { chain(S, [[...at(k, -0.22, y + 0.22), 0.22, 0.025], [...at(k, 0.2, y + 0.22), 0.22, 0.025]], 4, C.iron, UP, 'se'); chain(S, [[...at(k, -0.25, y + 0.44), 0.025, 0.02], [...at(k, -0.27, y + 0.9), 0.025, 0.02]], 4, C.iron, [ax[0], 0, -ax[1]], 'e'); } }
  // the pavilion: floor slab, mullions and corner posts, sill and head rails, the roof slab and its soffit, four round columns, a door frame in the south wall
  bx(S, -H - 0.3, H + 0.3, G - 0.1, FLOOR, -H - 0.3, H + 0.3, C.conc);
  bx(S, -H - 0.25, H + 0.25, ROOF - 0.3, ROOF, -H - 0.25, H + 0.25, C.roof); bx(S, -H - 0.3, H + 0.3, ROOF - 0.06, ROOF + 0.04, -H - 0.3, H + 0.3, C.steel);
  const NB = 7, top = ROOF - 0.3;
  for (let k = 0; k <= NB; k++) { const q = -H + 2 * H * k / NB, c = k === 0 || k === NB, he = c ? 0.07 : 0.035, hd = c ? 0.07 : 0.08;
    post(S, q, -H, FLOOR, top, he, hd, C.steel, 4, ''); post(S, q, H, FLOOR, top, he, hd, C.steel, 4, ''); if (!c) { post(S, -H, q, FLOOR, top, hd, he, C.steel, 4, ''); post(S, H, q, FLOOR, top, hd, he, C.steel, 4, ''); } }
  for (const u of [FLOOR + 0.05, top - 0.07]) { const h = 0.06; bx(S, -H, H, u - h, u + h, -H - 0.05, -H + 0.05, C.steel); bx(S, -H, H, u - h, u + h, H - 0.05, H + 0.05, C.steel); bx(S, -H - 0.05, -H + 0.05, u - h, u + h, -H, H, C.steel); bx(S, H - 0.05, H + 0.05, u - h, u + h, -H, H, C.steel); }
  for (const e of [-1, 1]) for (const n of [-1, 1]) post(S, e * (H - 1.6), n * (H - 1.6), FLOOR, top, 0.17, 0.17, C.col, 12, '');
  { const w = H / NB; bx(S, -w, w, FLOOR + 2.5, FLOOR + 2.62, -H - 0.06, -H + 0.06, C.door); post(S, 0, -H, FLOOR, FLOOR + 2.5, 0.04, 0.06, C.door, 4, ''); for (const e of [-w + 0.06, w - 0.06]) post(S, e, -H, FLOOR, FLOOR + 2.5, 0.05, 0.06, C.door, 4, ''); }
  // the glass: one sheet a wall, seen from both sides
  for (const [a, b] of [[[-H, -H], [H, -H]], [[H, -H], [H, H]], [[H, H], [-H, H]], [[-H, H], [-H, -H]]]) GL.poly([[a[0], FLOOR + 0.1, -a[1]], [b[0], FLOOR + 0.1, -b[1]], [b[0], top - 0.1, -b[1]], [a[0], top - 0.1, -a[1]]], [(a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2], C.white);
  return { S, GL };
}

export function install(game) {
  const W = game.world, city = game.city; if (!W || !W.scene || !city || !city.buildings) return null;
  const bld = city.buildings.find((b) => b.id === ID && /carousel/i.test(b.name || '') && b.poly && b.poly.length > 2); if (!bld) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of bld.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const CX = (x0 + x1) / 2, CY = (y0 + y1) / 2, H = Math.min(12, Math.max(9, (x1 - x0 + y1 - y0) / 4)) || HALF_DEF;
  const stats = (window.__carousel = { id: ID, at: [+CX.toFixed(2), +CY.toFixed(2)], half: +H.toFixed(2), tris: {}, calls: 5, cut: 0, pruned: 0 });

  // 1. the generated box of the lot out of the city tiles, in every tile geometry as it appears (dumbolofts.js's way). The baked massing can stand a few metres
  // off the footprint (3.8 m on Washington St), and nothing else is built within 40 m: every tile triangle that rises above 0.6 m within 7 m of the footprint goes.
  const M7 = 7, cutMesh = (mesh) => { const geo = mesh.geometry, ix = geo && geo.index, pos = geo && geo.attributes.position; if (!ix || !pos || geo.userData.carouselCut) return; geo.userData.carouselCut = true;
    if (!geo.boundingSphere) geo.computeBoundingSphere(); mesh.updateMatrixWorld(true); const M = mesh.matrixWorld, bs = geo.boundingSphere, c = bs.center.clone().applyMatrix4(M); if (c.x < x0 - M7 - bs.radius || c.x > x1 + M7 + bs.radius || -c.z < y0 - M7 - bs.radius || -c.z > y1 + M7 + bs.radius) return;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), src = ix.array, out = new src.constructor(src.length); let k = 0;
    for (let i = 0; i < src.length; i += 3) { a.fromBufferAttribute(pos, src[i]).applyMatrix4(M); b.fromBufferAttribute(pos, src[i + 1]).applyMatrix4(M); d.fromBufferAttribute(pos, src[i + 2]).applyMatrix4(M);
      const cx = (a.x + b.x + d.x) / 3, cy = -(a.z + b.z + d.z) / 3, hit = cx > x0 - M7 && cx < x1 + M7 && cy > y0 - M7 && cy < y1 + M7 && Math.max(a.y, b.y, d.y) > 0.6 && Math.max(a.y, b.y, d.y) < 40;
      if (hit) stats.cut++; else { out[k++] = src[i]; out[k++] = src[i + 1]; out[k++] = src[i + 2]; } }
    if (k !== src.length) geo.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1)); };
  let sig = null; const cutAll = () => { const bm = W.buildingMeshes || [], s = (W.tiles ? W.tiles.rev : 0) + ':' + bm.length; if (s === sig) return; sig = s; for (const m of bm) { try { cutMesh(m); } catch (e) {} } };
  cutAll(); const tick = () => { cutAll(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);

  // 2. what other layers put on that lot (shop fronts, signs, awnings, wall dressing, roof plant): their instances inside the footprint (6 m round it) are hidden
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), M6 = 6;
  const prune = () => { W.scene.traverse((o) => { if (!o.isInstancedMesh || o.userData.carouselOwn || o.userData.carouselPruned === o.count || !o.instanceMatrix || o.instanceMatrix.usage === THREE.DynamicDrawUsage) return;     /* a layer that rewrites its places every frame (people, traffic) is left alone */ o.userData.carouselPruned = o.count; o.updateMatrixWorld(); const a = o.instanceMatrix.array, e = o.matrixWorld.elements; let k = 0;
      for (let i = 0; i < o.count; i++) { const px = a[i * 16 + 12], py = a[i * 16 + 13], pz = a[i * 16 + 14], x = e[0] * px + e[4] * py + e[8] * pz + e[12], z = e[2] * px + e[6] * py + e[10] * pz + e[14], y = -z;
        if (x > x0 - M6 && x < x1 + M6 && y > y0 - M6 && y < y1 + M6 && a[i * 16] + a[i * 16 + 5] + a[i * 16 + 10] !== 0) { o.setMatrixAt(i, zero); k++; } }
      if (k) { o.instanceMatrix.needsUpdate = true; stats.pruned += k; (stats.prunedFrom = stats.prunedFrom || {})[o.name || (o.parent && o.parent.name) || '?'] = k; } }); };
  for (const t of [1500, 5000, 12000]) setTimeout(() => { try { prune(); } catch (e) {} }, t); setInterval(() => { try { prune(); } catch (e) {} }, 20000);

  // 3. what is drawn
  const grp = new THREE.Group(); grp.name = 'hero:carousel'; grp.position.set(CX, 0, -CY);
  const night = W.shared && W.shared.uNightK, uGlow = { value: 0 }, uDay = { value: 0.4 }, uFill = { value: 0.35 }, uT = { value: 0 };
  const { S, GL } = structureBufs(H), { B, L, slots } = carouselBufs(), HB = horseGeo();
  const mStruct = new THREE.MeshStandardMaterial({ vertexColors: true, map: structCanvas(), roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mStruct.onBeforeCompile = (sh) => { sh.uniforms.uCarGlow = uGlow; sh.uniforms.uCarDay = uDay; sh.vertexShader = 'varying vec3 vCarP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCarP = position;');
    sh.fragmentShader = 'varying vec3 vCarP;\nuniform float uCarGlow;\nuniform float uCarDay;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.52) * uCarGlow * (1.0 - smoothstep(7.0, 19.0, length(vCarP.xz))) * step(vCarP.y, 6.9)\n\t\t+ diffuseColor.rgb * uCarDay * step(abs(vCarP.x), 11.3) * step(abs(vCarP.z), 11.3) * smoothstep(2.5, 6.0, vCarP.y) * step(vCarP.y, 6.9);     /* by day the soffit and the heads of the columns are lit by the bright floor: without it the ceiling was near black (hold 1) */'); };
  const struct = new THREE.Mesh(S.geo(), mStruct); struct.name = 'carousel_structure'; struct.castShadow = true; struct.receiveShadow = true;
  const mGlass = new THREE.MeshStandardMaterial({ color: 0xd7e8e6, transparent: true, opacity: 0.16, roughness: 0.06, metalness: 0, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true });     /* one pass: a two-sided see-through sheet is otherwise drawn twice (7 calls counted in hold 1) */
  const glass = new THREE.Mesh(GL.geo(), mGlass); glass.name = 'carousel_glass'; glass.renderOrder = 3;
  const lift = (m) => { m.onBeforeCompile = (sh) => { sh.uniforms.uCarFill = uFill; sh.fragmentShader = 'uniform float uCarFill;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uCarFill;'); }; return m; };
  const rotor = new THREE.Group(); rotor.name = 'carousel_rotor';
  const car = new THREE.Mesh(B.geo(), lift(new THREE.MeshStandardMaterial({ vertexColors: true, map: carCanvas(), roughness: 0.5, metalness: 0 }))); car.name = 'carousel_ride'; car.receiveShadow = true;
  const mBulb = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), bulbs = new THREE.Mesh(L.geo(), mBulb); bulbs.name = 'carousel_bulbs';
  // the horses: one InstancedMesh; coat, blanket and gallop are per-instance attributes read in the shader (nothing is rewritten per frame)
  const hg = HB.geo(true), n = slots.length, coat = new Float32Array(n * 3), blanket = new Float32Array(n * 3), jump = new Float32Array(n * 2);
  const COATS = [0xe9e4d8, 0xe9e4d8, 0xd9c08c, 0xa86a2c, 0x5e2c14, 0x8a8d92, 0x17171a, 0xc9c5bb], BLANKETS = [0xa8201a, 0x1f47a0, 0x1f7a44, 0xd9a531, 0x6a2a8c, 0x12808a];
  const mHorse = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  mHorse.onBeforeCompile = (sh) => { sh.uniforms.uCarFill = uFill; sh.uniforms.uCarT = uT;
    sh.vertexShader = 'attribute float aTrim;\nattribute vec3 aCoat;\nattribute vec3 aBlanket;\nattribute vec2 aJump;\nuniform float uCarT;\n' + sh.vertexShader
      .replace('#include <color_vertex>', '#include <color_vertex>\n\tvColor.rgb = aTrim < 0.5 ? aCoat : aTrim < 1.5 ? color.rgb : aTrim < 2.5 ? aBlanket : aCoat * 0.3 + vec3(0.05, 0.035, 0.02);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.y += aJump.y * sin(uCarT + aJump.x);');
    sh.fragmentShader = 'uniform float uCarFill;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uCarFill;'); };
  const horses = new THREE.InstancedMesh(hg, mHorse, n); horses.name = 'carousel_horses'; horses.receiveShadow = true;
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    slots.forEach((s, i) => { e.set(0, s.th + Math.PI / 2, 0); q.setFromEuler(e); v.set(s.r * Math.cos(s.th), s.row === 0 ? DECK - 0.27 * s.sc : DECK + 0.03, -s.r * Math.sin(s.th)); sc.setScalar(s.sc); m.compose(v, q, sc); horses.setMatrixAt(i, m);
      col.set(COATS[(s.s * 3 + s.row * 5 + (s.s * s.row) % 3) % COATS.length]); coat.set([col.r, col.g, col.b], i * 3); col.set(BLANKETS[(s.s + s.row * 2) % BLANKETS.length]); blanket.set([col.r, col.g, col.b], i * 3); jump.set([s.ph, s.amp], i * 2); });
    hg.setAttribute('aCoat', new THREE.InstancedBufferAttribute(coat, 3)); hg.setAttribute('aBlanket', new THREE.InstancedBufferAttribute(blanket, 3)); hg.setAttribute('aJump', new THREE.InstancedBufferAttribute(jump, 2));
    horses.instanceMatrix.needsUpdate = true; horses.computeBoundingSphere(); horses.computeBoundingBox(); }
  rotor.add(car, horses, bulbs); grp.add(struct, rotor, glass); grp.traverse((o) => { o.userData.carouselOwn = true; }); W.scene.add(grp);
  // the turn, the gallop and the lights: set as the structure is drawn (nothing runs while it is out of view)
  struct.onBeforeRender = () => { const t = performance.now() / 1000, k = night ? Math.max(0, Math.min(1, night.value.y)) : 0; rotor.rotation.y = (t * 0.2) % (Math.PI * 2); uT.value = t * 1.9;
    uGlow.value = 0.6 * k; uDay.value = 0.42 * (W.sun ? Math.min(1, W.sun.intensity / 8) : 1) * (1 - k); uFill.value = 0.35 * (W.sun ? Math.min(1, W.sun.intensity / 8) : 1) * (1 - k) + 0.85 * k; const b = 0.95 + 3.4 * k; mBulb.color.setRGB(b, b * 0.86, b * 0.55); };
  stats.tris = { structure: S.tris, glass: GL.tris, ride: B.tris, bulbs: L.tris, horse: HB.tris, horses: HB.tris * n, total: S.tris + GL.tris + B.tris + L.tris + HB.tris * n }; stats.horses = n; stats.group = grp;
  game.carousel = stats; console.log('[carousel] in at ' + stats.at.join(',') + ': ' + n + ' horses, triangles ' + JSON.stringify(stats.tris) + ', 5 draw calls');
  return grp;
}
