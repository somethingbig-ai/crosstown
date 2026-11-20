// park/testdata.js (park lane): ?parkdata=test = a MADE-UP park in the data's format (SCHEMA.md), inside the real outline from city.json, for
// working on the layer before / without the lidar data: rolling hills, a round pond with a bridge over its north bay, a drive, a path, trees,
// lamps and benches. Nothing here is the real Central Park.
import { CELL, N, STEP } from './terrain.js';
const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
export function make(game) {
  const pk = (game.city.parks || []).filter((p) => p.name === 'Central Park').sort((a, b) => b.ext.length - a.ext.length)[0]; if (!pk) return null;
  const outline = pk.ext, top = Math.min(3000, game.city.meta.play ? game.city.meta.play[3] + 150 : 3000);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9; for (const p of outline) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); }
  const pond = { x: 1010, y: 2330, r: 46, level: -3.2 };
  const edge = (x, y) => { let d = 1e9; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); d = Math.min(d, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return d; };
  const height = (x, y) => { const e = Math.min(1, edge(x, y) / 60), dp = Math.hypot(x - pond.x, y - pond.y); let h = (4.5 * Math.sin(x / 47) * Math.cos(y / 61) + 2.2 * Math.sin(x / 19 + y / 23) + 7 * Math.exp(-((x - 800) ** 2 + (y - 2480) ** 2) / 1800)) * e * e * (3 - 2 * e);
    const k = Math.max(0, Math.min(1, (dp - pond.r) / 30)); h = h * k + (pond.level + 0.2) * (1 - k) * e; return dp < pond.r ? pond.level : h; };
  const chunks = []; for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(top / CELL); j++) chunks.push({ id: i + '_' + j, i, j });
  const ring = []; for (let k = 0; k < 48; k++) { const a = k / 48 * 6.283; ring.push([pond.x + Math.cos(a) * pond.r, pond.y + Math.sin(a) * pond.r]); }
  const water = { id: 'w1', kind: 'water', name: 'Test Pond', ring, level: pond.level };
  const drive = { id: 'p1', kind: 'drive', w: 11, name: 'Test Drive', pts: [] }; for (let k = 0; k <= 60; k++) drive.pts.push([620 + k * 14, 2480 + 90 * Math.sin(k / 7) + k * 3]);
  const path = { id: 'p2', kind: 'path', w: 3.6, pts: [[1150, 2190], [1100, 2260], [1066, 2300], [1040, 2372], [985, 2392], [930, 2420], [860, 2440], [800, 2478], [740, 2440], [640, 2400]] };
  const bridge = { id: 'b1', kind: 'bridge', name: 'Gapstow Bridge', line: [[1022, 2378], [997, 2372]], w: 6.5, over: 'water' }; ring.splice(0, ring.length, ...ring.map((p) => p)); water.ring = ring.concat(); { const bay = []; for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; bay.push([1010 + Math.cos(a) * 16, 2385 + Math.sin(a) * 14]); } water.bay = bay; }
  const bay = { id: 'w2', kind: 'water', name: 'Test Bay', ring: water.bay, level: pond.level }; delete water.bay;
  const height2 = (x, y) => (Math.hypot(x - 1010, y - 2385) < 15 ? pond.level : height(x, y));
  const inC = (c, x, y) => x >= c.i * CELL && x < c.i * CELL + CELL && y >= c.j * CELL && y < c.j * CELL + CELL, touch = (c, pts) => { let a = 1e9, b = 1e9, d = -1e9, e = -1e9; for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[0]); e = Math.max(e, p[1]); } return d >= c.i * CELL && a <= c.i * CELL + CELL && e >= c.j * CELL && b <= c.j * CELL + CELL; };
  const pip = game.terrain.owns;
  return { index: { version: 0, cell: CELL, outline, chunks, species: ['plane', 'elm', 'oak'], test: true },
    chunk: async (c) => { const cm = new Int16Array(N * N); for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) cm[r * N + q] = Math.round(height2(c.i * CELL + q * STEP, c.j * CELL + r * STEP) * 100);
      const tr = []; for (let k = 0; k < 700; k++) { const x = c.i * CELL + hash(k, c.i + 3) * CELL, y = c.j * CELL + hash(c.j + 5, k) * CELL; if (!pip(x, y) || Math.hypot(x - pond.x, y - pond.y) < pond.r + 3 || Math.hypot(x - 1010, y - 2385) < 18 || hash(Math.floor(x / 60), Math.floor(y / 60)) < 0.45) continue; tr.push(x, y, 9 + 16 * hash(x, y), 3 + 5 * hash(y, x), k % 3, hash(x * 3, y * 7) < 0.45 ? 0 : 0.8); }
      const props = []; for (let k = 0; k + 1 < path.pts.length; k++) { const a = path.pts[k], b = path.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), h = Math.atan2(b[1] - a[1], b[0] - a[0]); for (let s = 5; s < L; s += 22) { const x = a[0] + (b[0] - a[0]) * s / L - Math.sin(h) * 2.6, y = a[1] + (b[1] - a[1]) * s / L + Math.cos(h) * 2.6; if (inC(c, x, y)) { props.push({ kind: 'lamp', x, y, h }); props.push({ kind: 'bench', x: x + Math.cos(h) * 4, y: y + Math.sin(h) * 4, h: h - Math.PI / 2 }); props.push({ kind: 'bin', x: x + Math.cos(h) * 6.5, y: y + Math.sin(h) * 6.5, h }); } } }
      return { data: { areas: [water, bay].filter((a) => touch(c, a.ring)).concat([{ id: 'r1', kind: 'rock', ring: [[780, 2460], [822, 2466], [826, 2500], [790, 2504]] }, { id: 'wd1', kind: 'wood', ring: [[640, 2300], [900, 2300], [900, 2420], [640, 2420]] }].filter((a) => touch(c, a.ring))), paths: [drive, path].filter((p) => touch(c, p.pts)), structures: [bridge].filter((s) => touch(c, s.line)), props }, cm, trees: new Float32Array(tr).buffer }; } };
}
