// combat/heatundernav.js (gameplay u1, Nov 15) = the subway lane's police-nav.js of Nov 14, unchanged below this line: how an officer walks a station. Pure (no imports, runs in node: tools/police-sim.mjs); police.js fetches it
// only when officers first go after the player near a stair. Everything is asked of walk.js (the station's own floors, walls, stair wells, columns).
//   s = one officer's walking state: { p: { x, y, z } feet, path, pi, pg (the goal the path was found for), pathT, h (heading) }
//   underStep(walk, findPath, s, goal, sp, dt, B) walks him one step of dt at sp m/s toward goal { x, y, z } along a way found by nav.js
//   (refound when the goal has moved, at most B.n ways a game step over all officers); returns the metres really covered.
export const R = 0.3;
export const zOn = (f, x, y) => { const u = (x - f.x) * f.ca + (y - f.y) * f.sa; return f.z0 === f.z1 ? f.z0 : f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, u / f.l + 0.5)); };
// the height of the tread under (x, y) on a stair (what is drawn; walk.js keeps the feet on the ramp), as subway.js does for the player
export const treadZ = (meta, f, x, y) => { if (!f.stair) return zOn(f, x, y); const u = (x - f.x) * f.ca + (y - f.y) * f.sa, n = f.n || Math.max(1, Math.round(Math.abs(f.z0 - f.z1) / meta.rise)), dn = f.z0 > f.z1 ? 1 : -1, d = Math.min(f.l - 1e-6, Math.max(0, dn * u + f.l / 2)), i = Math.floor(d / (f.l / n)); return Math.max(f.z0, f.z1) - (i + 1) * Math.abs(f.z0 - f.z1) / n; };
// can a body walk the straight line from p to w = [x, y, z] over flat floor? (free every 8 cm: a stair's side is an 8 cm strip, and a coarser test steps over it.
// Never across a stair: a flight is walked point by point, as the lane's own follower does)
export function straight(walk, p, w) {
  const dx = w[0] - p.x, dy = w[1] - p.y, d = Math.hypot(dx, dy); if (Math.abs(w[2] - p.z) > 0.25 + d * 0.75) return false; const n = Math.max(1, Math.ceil(d / 0.08)); let z = p.z;
  for (let i = 1; i <= n; i++) { const x = p.x + dx * i / n, y = p.y + dy * i / n, f = walk.free(x, y, z, R); if (!f || f.stair) return false; z = zOn(f, x, y); }
  return Math.abs(z - w[2]) < 0.5;
}
// walk.js asks whether a body can stand somewhere by testing its middle and eight points round it; a stair's solid side is an 8 cm strip, which fits between
// those points, so a way can be found that hugs a flight closer than a body is wide and then cannot be walked (the body jams at the foot of the flight).
// strict(walk) is the same Walk (same floors, same answers, its own move) whose free() also keeps the whole circle of the body off every stair side: the
// officers' ways are found and walked with it. walk.js itself is not touched.
const STRICT = new WeakMap();
export function strict(walk) { let w = STRICT.get(walk); if (w) return w; w = Object.create(walk); const C = walk.cell;
  w.free = function (x, y, z, r) { const f = walk.free(x, y, z, r); if (!f) return null; const zf = zOn(f, x, y), i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const os = walk.ogrid.get(i * 100003 + j); if (!os) continue; for (const o of os) { if (!o.side || zf > o.zhi || zf + 1.2 < o.zlo) continue; const dx = x - o.x, dy = y - o.y, u = Math.abs(dx * o.ca + dy * o.sa) - o.l / 2, v = Math.abs(-dx * o.sa + dy * o.ca) - o.w / 2; if (Math.hypot(Math.max(u, 0), Math.max(v, 0)) < r - 0.03) return null; } }
    return f; };
  STRICT.set(walk, w); return w; }
// is a flight of stairs within a stride of p (on it, at its head or foot, beside it)? There the way is walked point by point, exactly as nav.js found it
export function byStair(walk, p) { for (const f of walk.near(p.x, p.y)) { if (!f.stair) continue; const u = (p.x - f.x) * f.ca + (p.y - f.y) * f.sa, v = -(p.x - f.x) * f.sa + (p.y - f.y) * f.ca; if (Math.abs(u) < f.l / 2 + 1.6 && Math.abs(v) < f.w / 2 + 1.2 && p.z > Math.min(f.z0, f.z1) - 0.5 && p.z < Math.max(f.z0, f.z1) + 0.5) return true; } return false; }
export function underStep(walk, findPath, s, goal, sp, dt, B) {
  const p = s.p; s.pathT = (s.pathT || 0) - dt;
  const moved0 = s.pg ? Math.hypot(goal.x - s.pg.x, goal.y - s.pg.y) + Math.abs(goal.z - s.pg.z) * 2 : 1e9, end = !s.path || s.pi >= s.path.length;
  if ((!s.path || (s.pathT <= 0 && (moved0 > 1.2 || (end && s.short) || s.redo)) || (end && moved0 > 1.2 && s.pathT <= 0.5)) && (!B || B.n > 0)) {      // (a way a second per officer at most, sooner only when he has walked the one he had to its end)
    if (B) B.n--; const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let path = null; try { path = findPath(walk, p, goal, { max: s.far ? 30000 : 9000, partial: true }); } catch (e) { path = null; }
    if (B) { B.paths = (B.paths || 0) + 1; B.ms = (B.ms || 0) + (typeof performance !== 'undefined' ? performance.now() - t0 : 0); }
    s.redo = false; s.pg = { x: goal.x, y: goal.y, z: goal.z }; s.pathT = 1.0 + ((s.id || 0) % 4) * 0.1;
    if (path && path.length) { const l = path[path.length - 1]; s.short = Math.hypot(l[0] - goal.x, l[1] - goal.y) > 0.9 || Math.abs(l[2] - goal.z) > 0.6; /* a way that stops short (search ran out): look further next time */ s.far = s.short; s.path = path; s.pi = 1; s.laT = 0; if (s.short) s.pathT = 1.5; }
    else { s.path = []; s.pi = 0; s.short = true; s.pathT = 1.5; }
  }
  if (!s.path) return 0;
  // the farthest of the next few way points that can be walked to in a straight line (the way is found on a 0.6 m grid: this takes its corners off)
  const f0 = walk.floorAt(p.x, p.y, p.z, 0.6), tight = byStair(walk, p);
  s.laT = (s.laT || 0) - dt; if (s.laT <= 0 && s.pi < s.path.length && f0 && !tight) { s.laT = 0.15; for (let j = Math.min(s.path.length - 1, s.pi + 7); j > s.pi; j--) if (straight(walk, p, s.path[j])) { s.pi = j; break; } }
  // a way point is reached at 0.4 m on the flat; on a stair, and for the points that lead onto one or off its end, at 0.12 m (a flight's sides are solid: a body
  // that turns for the next point before it is clear of the last step walks into the side for good)
  while (s.pi < s.path.length) { const w = s.path[s.pi]; if (Math.hypot(w[0] - p.x, w[1] - p.y) < (tight ? 0.12 : 0.4) && Math.abs(w[2] - p.z) < 0.8) s.pi++; else break; }
  let tx, ty; if (s.pi < s.path.length) { tx = s.path[s.pi][0]; ty = s.path[s.pi][1]; } else if (!s.short && Math.abs(goal.z - p.z) < 0.6 && Math.hypot(goal.x - p.x, goal.y - p.y) < 1.6) { tx = goal.x; ty = goal.y; } else return 0;
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d < 0.02) return 0;
  const step = Math.min(d, sp * (f0 && f0.stair ? 0.68 : 1) * dt), x0 = p.x, y0 = p.y;
  let f = walk.move(p, dx / d * step, dy / d * step, R), m = Math.hypot(p.x - x0, p.y - y0);
  // on a stair and the next point of the way is off its side (nav.js tests a step half way and at its end; a body cannot leave a flight over its side until it is
  // within a step of the foot): on along the flight, toward the end that is at the height the way goes to
  if (m < step * 0.25 && f0 && f0.stair) { const tz = s.pi < s.path.length ? s.path[s.pi][2] : goal.z, sg = (tz - p.z) * (f0.z1 - f0.z0) > 0 ? 1 : -1; f = walk.move(p, f0.ca * sg * step, f0.sa * sg * step, R) || f; m = Math.hypot(p.x - x0, p.y - y0); }
  if (f) s.f = f; if (m > 1e-4) s.h = Math.atan2(p.y - y0, p.x - x0);
  // not getting on (a corner cut too fine, another officer): the way is found afresh from here
  if (m < step * 0.25) { s.still = (s.still || 0) + dt; if (s.still > 0.35) { s.still = 0; s.redo = true; s.pathT = Math.min(s.pathT, 0); if (s.pi < s.path.length - 1) s.pi++; } } else s.still = 0;
  return m;
}
