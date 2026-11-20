// water/field.js (water lane, Nov 15): WHERE THE WATER IS, as a picture: metres to the nearest shore for every 4.6 m cell of the rivers' box (+ in the
// water, - on land), made once at load from city.water's polygons minus the far banks' land (assets/bank/*.bin ring outlines). No imports: the same
// file runs as a worker (the 2048 x 2048 distance transform takes a second or two; the page does not wait on it) and in node (lanes/water/tools).
const N = 2048, CELL = 4.65;
// ---- where the water is: city.water polygons, minus the land of the far banks (assets/bank/*.bin ring outlines)
export function readBankRings(buf) {
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x314b4e42) return []; const n = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))), base = 8 + n;
  const sec = (k) => { const [off, cnt, typ] = head.sec[k]; return typ === 'u8' ? new Uint8Array(buf, base + off, cnt) : typ === 'u16' ? new Uint16Array(buf, base + off, cnt) : new Uint32Array(buf, base + off, cnt); };
  const rn = sec('ring_n'), xy = sec('ring_xy'), out = []; let o = 0;
  for (let r = 0; r < rn.length; r++) { const P = []; for (let i = 0; i < rn[r]; i++) P.push([head.box[0] + xy[(o + i) * 2] * head.unit, head.box[1] + xy[(o + i) * 2 + 1] * head.unit]); o += rn[r]; out.push(P); }
  return out;
}
// even-odd scanline fill of polygons into a byte mask (1 = inside), box = [x0, y0, x1, y1], n x n cells, row 0 = y0
function fill(mask, n, box, polys, val) {
  const sx = n / (box[2] - box[0]), sy = n / (box[3] - box[1]);
  for (const P of polys) { const rows = new Array(n); let lo = n, hi = -1;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const ax = (P[i][0] - box[0]) * sx, ay = (P[i][1] - box[1]) * sy, bx = (P[j][0] - box[0]) * sx, by = (P[j][1] - box[1]) * sy; if (ay === by) continue;
      const r0 = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)), r1 = Math.min(n - 1, Math.floor(Math.max(ay, by) - 0.5));
      for (let r = r0; r <= r1; r++) { const yc = r + 0.5; if ((ay > yc) === (by > yc)) continue; (rows[r] || (rows[r] = [])).push(ax + (yc - ay) / (by - ay) * (bx - ax)); if (r < lo) lo = r; if (r > hi) hi = r; } }
    for (let r = lo; r <= hi; r++) { const X = rows[r]; if (!X) continue; X.sort((a, b) => a - b); for (let k = 0; k + 1 < X.length; k += 2) { const c0 = Math.max(0, Math.ceil(X[k] - 0.5)), c1 = Math.min(n - 1, Math.floor(X[k + 1] - 0.5)); for (let c = c0; c <= c1; c++) mask[r * n + c] = val; } } }
}
// exact squared distance to the nearest cell where f is 0 (Felzenszwalb and Huttenlocher), in cells
function edt(f, n) {
  const INF = 1e20, d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1), g = new Float32Array(n);
  const one = (off, step) => { for (let i = 0; i < n; i++) g[i] = f[off + i * step]; let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) { let s; do { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0); k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + g[p]; } for (let i = 0; i < n; i++) f[off + i * step] = d[i]; };
  for (let c = 0; c < n; c++) one(c, n); for (let r = 0; r < n; r++) one(r * n, 1);
}
// the field: metres to the shore, + in the water, - on land; clamped to +-RANGE and packed into a byte
export const RANGE = 48;
export function buildField(waters, rings, n) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const w of waters) for (const p of w.poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const s = Math.max(x1 - x0, y1 - y0); if (!n) n = Math.min(4096, Math.max(N, Math.ceil(s / CELL / 256) * 256));      /* (helper maps, Nov 16) a bigger map gets a bigger picture, so a cell stays about 4.6 m: the uptown map's box is 12.4 km (6.0 m a cell at 2048, now 2816) */
  const box = [x0, y0, x0 + s, y0 + s], cell = s / n, mask = new Uint8Array(n * n);
  fill(mask, n, box, waters.map((w) => w.poly), 1); if (rings && rings.length) fill(mask, n, box, rings, 0);
  // the open ends (the box's own sides where a river goes on) are not shores: the cells outside the box count as water where the last row is water (done by clamping at lookup)
  const a = new Float32Array(n * n), b = new Float32Array(n * n); for (let i = 0; i < n * n; i++) { a[i] = mask[i] ? 1e20 : 0; b[i] = mask[i] ? 0 : 1e20; }
  edt(a, n); edt(b, n); const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) { const d = mask[i] ? Math.sqrt(a[i]) - 0.5 : -(Math.sqrt(b[i]) - 0.5); out[i] = Math.max(0, Math.min(255, Math.round((d * cell / RANGE * 0.5 + 0.5) * 255))); }
  return { box, n, cell, data: out, mask };
}
// metres to the shore at a map point (+ in water), read from the field with the same smoothing the shader has. Outside the box: the nearest cell.
export function shoreDist(F, x, y) {
  const n = F.n, fx = Math.max(0, Math.min(n - 1.001, (x - F.box[0]) / F.cell - 0.5)), fy = Math.max(0, Math.min(n - 1.001, (y - F.box[1]) / F.cell - 0.5)), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, D = F.data;
  const a = D[j * n + i], b = D[j * n + i + 1], c = D[(j + 1) * n + i], d = D[(j + 1) * n + i + 1];
  return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) / 255 * 2 * RANGE - RANGE;
}


// as a worker: { waters: [{ poly }], rings } in, the field out (its arrays handed over, not copied)
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = (ev) => { const t = performance.now(), F = buildField(ev.data.waters, ev.data.rings, ev.data.n || 0); F.ms = Math.round(performance.now() - t); self.postMessage(F, [F.data.buffer, F.mask.buffer]); };
