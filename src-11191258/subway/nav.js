// subway/nav.js: a way through a station for anyone who is not steered by a player (the lane's tests now; riders and police later). No imports.
// findPath(walk, from, to) -> [[x, y, z], ...] or null: A* over 0.6 m steps, each step tested with walk.free (the game's own collision) half way and at its end
// (stairs, columns, railings, stair wells and all). from / to: { x, y, z } with z the height of the feet.
export function findPath(walk, from, to, o = {}) { return search(walk, from, to, o, 0.06) || (o.partial ? null : (o.cell ? null : search(walk, from, to, { ...o, cell: 0.42 }, 0.06)) || search(walk, from, to, o, 0) || (o.cell ? null : search(walk, from, to, { ...o, cell: 0.42 }, 0))); }      // a narrow flight at an angle can fall between the 0.6 m lattice points: try a finer lattice before giving up      // fat first; if he starts or must end in a tight spot, as thin as the walker
// Nov 16: a search in slices. Six officers below cost 15 searches in 80 s on a laptop, 80 ms each on average and 250 ms the worst, each inside ONE frame (out/w8-police.txt).
// findPath.start(walk, from, to, o) gives the same search as findPath(..., { partial: true }) as a generator: each .next() works through SLICE lattice points (60: about 4 ms on a laptop; a lattice point costs about 0.07 ms there) and
// the last one returns the way (or null). heatundernav.js's underStep runs one slice a game step. ?navslice=0: findPath.start is not there and the whole search runs at once, as before.
const SLICE = typeof location !== 'undefined' && /[?&]navslice=0(&|$)/.test(location.search) ? 0 : 60;
// A way that goes nowhere (under 1.5 m: he stands on a narrow flight that lies at an angle to the lattice, so no 0.6 m step from where he is stays clear of its sides; an officer who
// stopped part-way down Port Authority's entrance 135 stood there for good) is looked for again on the finer lattice, thin: as findPath does when it is not asked for a partial way.
const went = (r) => (r && r.length > 1 ? Math.hypot(r[r.length - 1][0] - r[0][0], r[r.length - 1][1] - r[0][1]) + Math.abs(r[r.length - 1][2] - r[0][2]) : 0);
function* startGen(walk, from, to, o) { const a = yield* searchGen(walk, from, to, o, 0.06); if (went(a) >= 1.5) return a; const b = yield* searchGen(walk, from, to, { ...o, cell: 0.42 }, 0); return went(b) > went(a) ? b : a; }
if (SLICE) findPath.start = (walk, from, to, o = {}) => startGen(walk, from, to, { ...o, partial: true, slice: o.slice || ((o.max || 0) > 9000 ? SLICE * 2.5 : SLICE) });      /* a far search (30000 points) in bigger slices: at 60 it took 8 s, and a player walking away along a long platform was never caught up with */
function search(walk, from, to, o, FAT) { const g = searchGen(walk, from, to, o, FAT); let r; while (!(r = g.next()).done); return r.value; }
function* searchGen(walk, from, to, o, FAT) {
  const C = o.cell || 0.6, R = (o.r || 0.3) + FAT /* a little fatter than the walker: two free points 0.3 m apart can have a corner between them, and the walk between them must not clip it */, MAX = o.max || (C < 0.6 ? 80000 : 40000), WH = o.greed || 1.6, LA = walk.a || 0, lc = Math.cos(LA), ls = Math.sin(LA) /* the lattice lies along the station (walk.a): its stairs and turnstile lanes are then straight runs of it */, key = (x, y, z) => Math.round((x * lc + y * ls) / C) + ',' + Math.round((-x * ls + y * lc) / C) + ',' + Math.round(z / 0.6);
  const f0 = walk.floorAt(from.x, from.y, from.z, 0.6); if (!f0) return null;
  const h = (x, y, z) => (Math.hypot(x - to.x, y - to.y) + Math.abs(z - to.z) * 2.2) * WH, DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]].map(([a, b]) => [a * lc - b * ls, a * ls + b * lc]);
  const start = { x: from.x, y: from.y, z: from.z, g: 0, f: h(from.x, from.y, from.z), prev: null }, open = [start], seen = new Map([[key(start.x, start.y, start.z), 0]]), p = { x: 0, y: 0, z: 0 }; let n = 0, best = start;
  const push = (nd) => { let i = open.length; open.push(nd); while (i > 0) { const j = (i - 1) >> 1; if (open[j].f <= nd.f) break; open[i] = open[j]; i = j; } open[i] = nd; };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { let i = 0; for (;;) { let j = 2 * i + 1; if (j >= open.length) break; if (j + 1 < open.length && open[j + 1].f < open[j].f) j++; if (open[j].f >= last.f) break; open[i] = open[j]; i = j; } open[i] = last; } return top; };
  while (open.length && n++ < MAX) { if (o.slice && n % o.slice === 0) yield; const c = pop(); if (c.g > (seen.get(key(c.x, c.y, c.z)) ?? 1e9) + 1e-6) continue;
    if (Math.hypot(c.x - to.x, c.y - to.y) < (o.near || 0.7) && Math.abs(c.z - to.z) < 0.6) { best = c; break; } if (c.f - c.g < best.f - best.g) best = c;
    for (const [dx, dy] of DIRS) { // one step: free half way and at the end, at the height the floor has there (a quarter of the work of walking it; the walker's own slide makes up the rest)
      const mx = c.x + dx * C / 2, my = c.y + dy * C / 2, fm = walk.free(mx, my, c.z, R); if (!fm) continue; const zm = zOf(fm, mx, my); p.x = c.x + dx * C; p.y = c.y + dy * C; const fl = walk.free(p.x, p.y, zm, R); if (!fl) continue; p.z = zOf(fl, p.x, p.y); const d = C;
      const g = c.g + d + Math.abs(p.z - c.z), k = key(p.x, p.y, p.z); if (g >= (seen.get(k) ?? 1e9) - 1e-6) continue; seen.set(k, g); push({ x: p.x, y: p.y, z: p.z, g, f: g + h(p.x, p.y, p.z), prev: c }); } }
  if (Math.hypot(best.x - to.x, best.y - to.y) > (o.near || 0.7) + 0.01 || Math.abs(best.z - to.z) >= 0.6) return o.partial ? trace(best) : null; return trace(best);
  function zOf(f, x, y) { const u = (x - f.x) * f.ca + (y - f.y) * f.sa; return f.z0 === f.z1 ? f.z0 : f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, u / f.l + 0.5)); }
  function trace(nd) { const out = []; for (let q = nd; q; q = q.prev) out.push([q.x, q.y, q.z]); out.reverse(); return out; }
}
