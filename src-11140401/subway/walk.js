// subway/walk.js: where a person can stand and walk underground. No imports (runs in node for the lane's checks).
// The underground is a set of FLOOR rectangles (subway.json, made by lanes/subway/tools/build_data.py), each with a centre (x, y) in map metres, a
// direction a, a length l along it, a width w, and a floor height z0 at its start (u = -l/2) and z1 at its end (u = +l/2): flat floors and stairs alike.
// Several levels lie over each other in plan, so every question is asked with the walker's height.
//   k: 'street' (stair from the sidewalk), 'landing', 'passage', 'hall', 'pstair' (mezzanine to platform), 'platform', 'pit' (track; nobody walks there)
const STEP = 0.42;          // a floor this much above or below the feet is still "the floor I am on"
export class Walk {
  constructor(meta) { this.meta = meta; this.floors = []; this.obst = []; this.cell = 8; this.grid = new Map(); this.ogrid = new Map(); }
  _put(grid, o, x0, y0, x1, y1) { const c = this.cell; for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) { const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(o); } }
  _box(f) { const ca = Math.abs(Math.cos(f.a)), sa = Math.abs(Math.sin(f.a)), hx = (f.l * ca + f.w * sa) / 2, hy = (f.l * sa + f.w * ca) / 2; return [f.x - hx, f.y - hy, f.x + hx, f.y + hy]; }
  addFloor(f) { f.ca = Math.cos(f.a); f.sa = Math.sin(f.a); f.stair = f.z0 !== f.z1; f.walk = f.k !== 'pit'; this.floors.push(f); this._put(this.grid, f, ...this._box(f));
    // the sidewalk just before the top step of a street stair counts as floor (the body's ring reaches back over it; the game takes the walker over there)
    if (f.k === 'street') { const top = f.z0 > f.z1 ? -1 : 1, L = 0.7, d = top * (f.l / 2 + L / 2), z = Math.max(f.z0, f.z1), ap = { x: f.x + f.ca * d, y: f.y + f.sa * d, a: f.a, l: L, w: f.w, z0: z, z1: z, k: 'apron', ca: f.ca, sa: f.sa, stair: false, walk: true }; this.floors.push(ap); this._put(this.grid, ap, ...this._box(ap)); }
    return f; }
  // an upright obstacle (a wall stub, a column, a turnstile body, a bench): the same rectangle form, solid between heights zlo and zhi
  addObstacle(o) { o.ca = Math.cos(o.a || 0); o.sa = Math.sin(o.a || 0); this.obst.push(o); this._put(this.ogrid, o, ...this._box(o)); return o; }
  near(x, y) { return this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)) || EMPTY; }
  // local coordinates of a point in a rect: u along, v across
  static u(f, x, y) { return (x - f.x) * f.ca + (y - f.y) * f.sa; }
  static v(f, x, y) { return -(x - f.x) * f.sa + (y - f.y) * f.ca; }
  static zAt(f, u) { return f.z0 === f.z1 ? f.z0 : f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, u / f.l + 0.5)); }
  // the height of the clear space over a floor at u (Infinity = open to the sky: the uncovered top of a street stair)
  ceilAt(f, u) { const m = this.meta, z = Walk.zAt(f, u);
    if (f.k === 'street') { const d = u + f.l / 2; return d < m.lOpen ? Infinity : Math.min(m.zWalk - m.slab, z + m.hM); }
    if (f.k === 'platform' || f.k === 'pit') return m.zP + m.hP; if (f.k === 'pstair') return m.zM + m.hM; return z + m.hM; }
  // the floor under a walker at (x, y) whose feet are at z: the nearest floor within a step, or null
  floorAt(x, y, z, tol = STEP) { let best = null, bd = tol; for (const f of this.near(x, y)) { if (!f.walk) continue; const u = Walk.u(f, x, y); if (Math.abs(u) > f.l / 2) continue; const v = Walk.v(f, x, y); if (Math.abs(v) > f.w / 2) continue; const d = Math.abs(Walk.zAt(f, u) - z); if (d <= bd) { bd = d; best = f; } } return best; }
  // can the middle of a body stand here? On a floor, not under the solid body of a stair, not in an obstacle
  point(x, y, z) { const f = this.floorAt(x, y, z); if (!f) return null; const zf = Walk.zAt(f, Walk.u(f, x, y));
    for (const g of this.near(x, y)) { if (g === f || !g.stair) continue; const u = Walk.u(g, x, y); if (Math.abs(u) > g.l / 2 || Math.abs(Walk.v(g, x, y)) > g.w / 2) continue; const d = Walk.zAt(g, u) - zf; if (d > STEP && d < 2.0) return null; }
    const os = this.ogrid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)); if (os) for (const o of os) { if (zf > o.zhi || zf + 1.2 < o.zlo) continue; if (Math.abs(Walk.u(o, x, y)) <= o.l / 2 && Math.abs(Walk.v(o, x, y)) <= o.w / 2) return null; }
    return f; }
  // a body of radius r: its middle and eight points round it must all be standable (so it keeps r away from every wall, edge and obstacle)
  free(x, y, z, r) { const f = this.point(x, y, z); if (!f) return null; const zf = Walk.zAt(f, Walk.u(f, x, y)); for (let i = 0; i < 8; i++) if (!this.point(x + RING[i][0] * r, y + RING[i][1] * r, zf)) return null; return f; }
  // walk p = { x, y, z } by (dx, dy): the whole step if it is free, else what slides along the walls; z follows the floor. Returns the floor stood on (or null if p itself is nowhere).
  move(p, dx, dy, r = 0.3) { const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12)); dx /= n; dy /= n; let f = null;
    for (let i = 0; i < n; i++) { f = this.free(p.x + dx, p.y + dy, p.z, r);
      if (f) { p.x += dx; p.y += dy; }
      else { const cur = this.floorAt(p.x, p.y, p.z, STEP * 1.5); if (!cur) return null; let done = false;
        for (const g of cur.a === this._la ? [cur] : [cur, { ca: this._lca || 1, sa: this._lsa || 0 }]) { const du = dx * g.ca + dy * g.sa, dv = -dx * g.sa + dy * g.ca;      // slide along the floor's own axes, then along the last floor's
          for (const [a, b] of Math.abs(du) > Math.abs(dv) ? [[du, 0], [0, dv]] : [[0, dv], [du, 0]]) { if (Math.abs(a) + Math.abs(b) < 1e-5) continue; const sx = a * g.ca - b * g.sa, sy = a * g.sa + b * g.ca, h = this.free(p.x + sx, p.y + sy, p.z, r); if (h) { p.x += sx; p.y += sy; f = h; done = true; break; } }
          if (done) break; }
        if (!done) { f = cur; break; } }
      p.z = Walk.zAt(f, Walk.u(f, p.x, p.y)); this._la = f.a; this._lca = f.ca; this._lsa = f.sa; }
    return f; }
  // is this point in the air of the underground (for the camera): over some floor and under its ceiling
  air(x, y, z) { for (const f of this.near(x, y)) { const u = Walk.u(f, x, y); if (Math.abs(u) > f.l / 2 || Math.abs(Walk.v(f, x, y)) > f.w / 2) continue; const zf = Walk.zAt(f, u); if (z >= zf + 0.12 && z <= this.ceilAt(f, u) - 0.12) return true; } return false; }
  // from a to b (each [x, y, z]): how far along (0..1) the straight line stays in the air; above the street (z > top) everything is air
  sight(a, b, top = 0.4, step = 0.12) { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz), n = Math.max(1, Math.ceil(L / step)); let ok = 0;
    for (let i = 1; i <= n; i++) { const t = i / n, z = a[2] + dz * t; if (z > top || this.air(a[0] + dx * t, a[1] + dy * t, z)) ok = t; else break; } return ok; }
}
const EMPTY = [], RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
