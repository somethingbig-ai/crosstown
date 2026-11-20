// subway/nav.js: a way through a station for anyone who is not steered by a player (the lane's tests now; riders and police later). No imports.
// findPath(walk, from, to) -> [[x, y, z], ...] or null: A* over 0.6 m steps, each step tested with walk.free (the game's own collision) half way and at its end
// (stairs, columns, railings, stair wells and all). from / to: { x, y, z } with z the height of the feet.
export function findPath(walk, from, to, o = {}) { return search(walk, from, to, o, 0.06) || (o.partial ? null : (o.cell ? null : search(walk, from, to, { ...o, cell: 0.42 }, 0.06)) || search(walk, from, to, o, 0) || (o.cell ? null : search(walk, from, to, { ...o, cell: 0.42 }, 0))); }      // a narrow flight at an angle can fall between the 0.6 m lattice points: try a finer lattice before giving up      // fat first; if he starts or must end in a tight spot, as thin as the walker
function search(walk, from, to, o, FAT) {
  const C = o.cell || 0.6, R = (o.r || 0.3) + FAT /* a little fatter than the walker: two free points 0.3 m apart can have a corner between them, and the walk between them must not clip it */, MAX = o.max || (C < 0.6 ? 80000 : 40000), WH = o.greed || 1.6, LA = walk.a || 0, lc = Math.cos(LA), ls = Math.sin(LA) /* the lattice lies along the station (walk.a): its stairs and turnstile lanes are then straight runs of it */, key = (x, y, z) => Math.round((x * lc + y * ls) / C) + ',' + Math.round((-x * ls + y * lc) / C) + ',' + Math.round(z / 0.6);
  const f0 = walk.floorAt(from.x, from.y, from.z, 0.6); if (!f0) return null;
  const h = (x, y, z) => (Math.hypot(x - to.x, y - to.y) + Math.abs(z - to.z) * 2.2) * WH, DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]].map(([a, b]) => [a * lc - b * ls, a * ls + b * lc]);
  const start = { x: from.x, y: from.y, z: from.z, g: 0, f: h(from.x, from.y, from.z), prev: null }, open = [start], seen = new Map([[key(start.x, start.y, start.z), 0]]), p = { x: 0, y: 0, z: 0 }; let n = 0, best = start;
  const push = (nd) => { let i = open.length; open.push(nd); while (i > 0) { const j = (i - 1) >> 1; if (open[j].f <= nd.f) break; open[i] = open[j]; i = j; } open[i] = nd; };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { let i = 0; for (;;) { let j = 2 * i + 1; if (j >= open.length) break; if (j + 1 < open.length && open[j + 1].f < open[j].f) j++; if (open[j].f >= last.f) break; open[i] = open[j]; i = j; } open[i] = last; } return top; };
  while (open.length && n++ < MAX) { const c = pop(); if (c.g > (seen.get(key(c.x, c.y, c.z)) ?? 1e9) + 1e-6) continue;
    if (Math.hypot(c.x - to.x, c.y - to.y) < (o.near || 0.7) && Math.abs(c.z - to.z) < 0.6) { best = c; break; } if (c.f - c.g < best.f - best.g) best = c;
    for (const [dx, dy] of DIRS) { // one step: free half way and at the end, at the height the floor has there (a quarter of the work of walking it; the walker's own slide makes up the rest)
      const mx = c.x + dx * C / 2, my = c.y + dy * C / 2, fm = walk.free(mx, my, c.z, R); if (!fm) continue; const zm = zOf(fm, mx, my); p.x = c.x + dx * C; p.y = c.y + dy * C; const fl = walk.free(p.x, p.y, zm, R); if (!fl) continue; p.z = zOf(fl, p.x, p.y); const d = C;
      const g = c.g + d + Math.abs(p.z - c.z), k = key(p.x, p.y, p.z); if (g >= (seen.get(k) ?? 1e9) - 1e-6) continue; seen.set(k, g); push({ x: p.x, y: p.y, z: p.z, g, f: g + h(p.x, p.y, p.z), prev: c }); } }
  if (Math.hypot(best.x - to.x, best.y - to.y) > (o.near || 0.7) + 0.01 || Math.abs(best.z - to.z) >= 0.6) return o.partial ? trace(best) : null; return trace(best);
  function zOf(f, x, y) { const u = (x - f.x) * f.ca + (y - f.y) * f.sa; return f.z0 === f.z1 ? f.z0 : f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, u / f.l + 0.5)); }
  function trace(nd) { const out = []; for (let q = nd; q; q = q.prev) out.push([q.x, q.y, q.z]); out.reverse(); return out; }
}
