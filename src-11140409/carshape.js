// carshape.js: the side outline of every car kind, for anything that has to touch a car's real shape rather than its box (gameplay/people,
// Nov 14, Matt: "a struck person who lands on the car ... then sinks half into the car body, passing through it"). No dependencies.
// Each outline is read from the game's own car models (assets/streets/vehicles/vehicles.glb, the middle 70 % of the width, ladder racks and
// roof boxes left out because only some cars wear them) by lanes/gameplay/people-state/fall/tools/profile.mjs and straightened to a few
// pieces within 3 cm: [metres ahead of the car's centre, metres above the road], from the front bumper over the bonnet, the windscreen, the
// roof and the tail to the back bumper. The shape is that outline, solid down to the road, as wide as the car's box (def.wid).
//   shapeOf(def)                         -> { x: Float32Array, y: Float32Array, n, xf, xb, top, W }   (cached per def; unknown kinds borrow the
//                                           nearest known outline, stretched to their length and height)
//   topAt(shape, f)                      -> height of the outline at f metres ahead of the centre (-1 beyond the bumpers)
//   pushOut(shape, f, y, r, f0, y0, out) -> a ball of radius r at (f, y) in the car's frame, which stood at (f0, y0) a moment ago: if it is
//                                           in or touching the outline, out.f / out.y is where it belongs (on the side it came from when it
//                                           has crossed the outline in this move, else the nearest way out), out.nf / out.ny the outward normal
//                                           there; returns how far it was moved (0 = not touching)
export const LINES = {
  sedan: [[2.44, 0.45], [2.42, 0.74], [2.27, 0.85], [1.1, 0.99], [0.28, 1.4], [-0.32, 1.45], [-0.99, 1.41], [-1.75, 1.1], [-2.31, 1.03], [-2.41, 0.92], [-2.43, 0.45]],
  taxi: [[2.42, 0.45], [2.39, 0.79], [2.29, 0.89], [1.99, 0.97], [1.19, 1.07], [0.38, 1.56], [-0.07, 1.59], [-0.12, 1.79], [-0.37, 1.79], [-0.47, 1.61], [-1.08, 1.61], [-2.03, 1.54], [-2.23, 1.3], [-2.39, 0.98], [-2.41, 0.45]],
  taxivan: [[2.27, 0.45], [2.24, 0.77], [2.1, 0.96], [1.63, 1.1], [0.97, 1.75], [0.54, 1.86], [0.12, 1.86], [0.03, 2.02], [-0.21, 2.02], [-0.3, 1.85], [-2.15, 1.82], [-2.24, 1.62], [-2.26, 0.45]],
  suv: [[2.49, 0.45], [2.47, 0.81], [2.31, 1], [0.97, 1.2], [0.24, 1.69], [0.04, 1.81], [-1.72, 1.81], [-1.78, 1.72], [-2.09, 1.68], [-2.24, 1.52], [-2.45, 1.12], [-2.48, 0.45]],
  crossover: [[2.3, 0.45], [2.27, 0.79], [2.13, 0.96], [0.94, 1.12], [0.22, 1.58], [0.03, 1.69], [-1.59, 1.69], [-1.64, 1.6], [-1.92, 1.57], [-2.07, 1.42], [-2.26, 1.05], [-2.28, 0.45]],
  hatch: [[2.15, 0.45], [2.12, 0.74], [1.99, 0.88], [1.05, 1.02], [0.34, 1.47], [-0.78, 1.52], [-1.81, 1.45], [-1.98, 1.22], [-2.12, 0.93], [-2.14, 0.45]],
  sport: [[2.26, 0.45], [2.24, 0.63], [2.1, 0.74], [0.91, 0.91], [0.11, 1.21], [-0.37, 1.25], [-0.84, 1.21], [-2.17, 0.94], [-2.27, 0.81], [-2.29, 0.45]],
  pickup: [[2.89, 0.45], [2.86, 0.99], [2.8, 1.1], [2.68, 1.17], [1.16, 1.31], [0.49, 1.82], [-0.18, 1.87], [-0.91, 1.81], [-0.97, 1.76], [-1.1, 1.45], [-1.22, 1.4], [-2.8, 1.4], [-2.86, 1.32], [-2.95, 0.45]],
  van: [[3.04, 0.45], [3.01, 0.91], [2.95, 1.02], [2.82, 1.15], [2.37, 1.32], [2.31, 1.4], [1.8, 2.45], [1.67, 2.58], [1.29, 2.69], [-1.33, 2.7], [-2.98, 2.67], [-3.08, 0.45]],
  workvan: [[2.74, 0.45], [2.72, 0.91], [2.6, 1.11], [2.08, 1.35], [1.56, 2.04], [1.05, 2.14], [-2.69, 2.11], [-2.78, 0.45]],
  boxtruck: [[3.84, 0.45], [3.8, 1.13], [3.72, 1.28], [3.48, 1.42], [3.08, 2.15], [2.92, 2.25], [2.76, 2.3], [1.85, 2.29], [1.79, 3.42], [-3.84, 3.42], [-3.88, 0.45]],      // (the 10 cm gap between cab and box is closed)
  stepvan: [[3.54, 0.45], [3.51, 1.2], [3.43, 1.4], [3.2, 1.55], [3.13, 1.68], [2.83, 2.82], [2.6, 2.99], [-3.51, 2.99], [-3.59, 0.57], [-3.7, 0.45]],
  bus: [[6.01, 0.45], [5.95, 3.02], [2.82, 3.05], [2.69, 3.14], [1.31, 3.14], [1.19, 3.05], [-1.7, 3.05], [-1.82, 3.2], [-4.58, 3.2], [-4.7, 3.05], [-5.96, 3.04], [-6.02, 0.45]],
};
const cache = new WeakMap(), byType = new Map();
function build(line, sx, sy, wid) {
  const n = line.length + 2, x = new Float32Array(n), y = new Float32Array(n); x[0] = line[0][0] * sx; y[0] = 0; for (let i = 0; i < line.length; i++) { x[i + 1] = line[i][0] * sx; y[i + 1] = line[i][1] * sy; } x[n - 1] = line[line.length - 1][0] * sx; y[n - 1] = 0;
  let top = 0; for (let i = 0; i < n; i++) top = Math.max(top, y[i]);
  return { x, y, n, xf: x[0], xb: x[n - 1], top, W: wid / 2 };
}
export function shapeOf(def) {
  if (!def) def = { type: 'sedan', len: 4.8, wid: 1.9, hgt: 1.45 };
  let s = cache.get(def); if (s) return s;
  const len = def.len || 4.6, hgt = def.hgt || 1.4, wid = def.wid || 1.9; let line = LINES[def.type], sx = 1, sy = 1;
  if (line) { const l0 = line[0][0] - line[line.length - 1][0]; if (Math.abs(len / l0 - 1) > 0.06) sx = len / l0; }      // a known kind: its outline as modelled (the game's box is a few centimetres shorter: mirrors and bumpers)
  else { let best = 'sedan', bd = 1e9; for (const k in LINES) { const L = LINES[k], l0 = L[0][0] - L[L.length - 1][0]; let h0 = 0; for (const p of L) h0 = Math.max(h0, p[1]); const d = Math.abs(Math.log((hgt / len) / (h0 / l0))) + 0.3 * Math.abs(Math.log(len / l0)); if (d < bd) { bd = d; best = k; } }
    line = LINES[best]; let h0 = 0; for (const p of line) h0 = Math.max(h0, p[1]); sx = len / (line[0][0] - line[line.length - 1][0]); sy = hgt / h0; }
  s = build(line, sx, sy, wid); cache.set(def, s); return s;
}
export function shapeOfType(type) { let s = byType.get(type); if (!s) { const L = LINES[type] || LINES.sedan; let h = 0; for (const p of L) h = Math.max(h, p[1]); byType.set(type, (s = build(L, 1, 1, 1.9))); } return s; }
export function topAt(S, f) {
  if (f > S.xf || f < S.xb) return -1; const x = S.x, y = S.y;
  for (let i = 1; i < S.n - 2; i++) if (f >= x[i + 1]) { const d = x[i] - x[i + 1]; return d > 1e-6 ? y[i] + (y[i + 1] - y[i]) * (x[i] - f) / d : Math.max(y[i], y[i + 1]); }
  return y[S.n - 2];
}
export function pushOut(S, f, y, r, f0, y0, out) {
  if (f > S.xf + r || f < S.xb - r || y > S.top + r) return 0;
  const X = S.x, Y = S.y, n = S.n, t = topAt(S, f), inside = t >= 0 && y < t;
  // the nearest place on the outline
  let bd = 1e9, bx = 0, by = 0, bi = 0;
  for (let i = 0; i < n - 1; i++) { const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], L2 = dx * dx + dy * dy || 1e-12; let u = ((f - X[i]) * dx + (y - Y[i]) * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; const cx = X[i] + dx * u, cy = Y[i] + dy * u, d = (f - cx) * (f - cx) + (y - cy) * (y - cy); if (d < bd) { bd = d; bx = cx; by = cy; bi = i; } }
  bd = Math.sqrt(bd);
  if (!inside) { if (bd >= r) return 0; if (bd < 1e-6) { const dx = X[bi + 1] - X[bi], dy = Y[bi + 1] - Y[bi], L = Math.hypot(dx, dy) || 1; out.nf = dy / L; out.ny = -dx / L; } else { out.nf = (f - bx) / bd; out.ny = (y - by) / bd; }
    out.f = bx + out.nf * r; out.y = by + out.ny * r; return r - bd; }
  // inside: if it stood outside a moment ago, it goes back to the piece of the outline it came through
  const t0 = topAt(S, f0);
  if (t0 < 0 || y0 >= t0) { const rx = f - f0, ry = y - y0; let bt = 2, bk = -1;
    for (let i = 0; i < n - 1; i++) { const sx = X[i + 1] - X[i], sy = Y[i + 1] - Y[i], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue; const tt = ((X[i] - f0) * sy - (Y[i] - y0) * sx) / den, u = ((X[i] - f0) * ry - (Y[i] - y0) * rx) / den; if (tt >= 0 && tt <= 1 && u >= -1e-6 && u <= 1 + 1e-6 && tt < bt) { bt = tt; bk = i; } }
    if (bk >= 0) { const dx = X[bk + 1] - X[bk], dy = Y[bk + 1] - Y[bk], L = Math.hypot(dx, dy) || 1, nf = dy / L, ny = -dx / L;
      // onto that piece's own line, at the place nearest to where the ball is now (so it may slide along the panel within the move)
      let u = ((f - X[bk]) * dx + (y - Y[bk]) * dy) / (L * L); u = u < 0 ? 0 : u > 1 ? 1 : u; const cx = X[bk] + dx * u, cy = Y[bk] + dy * u;
      out.nf = nf; out.ny = ny; out.f = cx + nf * r; out.y = cy + ny * r; return Math.hypot(out.f - f, out.y - y); } }
  // a point low down that was inside a moment ago too (under the car, between the wheels): out by the nearer bumper, never up through the bonnet
  if (y < 0.45) { const fr = S.xf - f < f - S.xb; out.nf = fr ? 1 : -1; out.ny = 0; out.f = fr ? S.xf + r : S.xb - r; out.y = y; return fr ? S.xf + r - f : f - (S.xb - r); }
  // else the nearest way out
  if (bd < 1e-6) { const dx = X[bi + 1] - X[bi], dy = Y[bi + 1] - Y[bi], L = Math.hypot(dx, dy) || 1; out.nf = dy / L; out.ny = -dx / L; } else { out.nf = (bx - f) / bd; out.ny = (by - y) / bd; }
  out.f = bx + out.nf * r; out.y = by + out.ny * r; return bd + r;
}
