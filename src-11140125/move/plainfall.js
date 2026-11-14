// move/plainfall.js (gameplay/people, Nov 13): the plain fall of a struck person who gets NO ragdoll, held by the walls.
// When pedhit.js does not take a struck person (the car that hit him is not the one the player sits in: a police car, a car the player
// jumped out of or shoved, a wreck; or ?pedhit=0; or a figure pedhit cannot use), traffic.js (the game's own pedestrians) and crowd/sim.js
// (the street crowd) put him 'down' with 90 % of the car's speed and slid him `x += vx * dt` with no test at all: 4 m at 60 km/h, 7 m at
// 100, through a wall, a shop front, a fence or a parked car. He is drawn tipped over about his feet, head towards his heading h, so
// he is a line on the ground from (x, y) to (x, y) + 1.75 m * (cos h, sin h): the head could lie through a wall too.
// plainSlide(game, p, dt) replaces that one move in both files (the decay of vx, vy and the growth of p.fall stay where they are):
//   - the feet point's move is swept against the collision lines (game.statics: building walls, shop fronts, fences, tree guards, the map
//     edge): it stops at the first line it meets, on the side it came from, a body's half width off it, and keeps half its speed ALONG
//     the line; posts and trees push it aside as they push a running pedestrian (statics.resolve); a move that cannot be made safe is
//     not made;
//   - cars that stand (parked cars, traffic and the player's cars under 0.5 m/s) are boxes he stops against;
//   - the way he lies: if the line from his feet to his head would cross a collision line or reach into a standing car, he is turned
//     about his feet to the nearest heading that is clear (looked for once at the hit, where the slide will end, while he is still
//     upright, and checked again as he goes down); a move to a place where he could not lie in any direction is not made.
// A person at rest costs two compares a step. No three.js, no state but p.pf on the person. Used by: traffic.js, crowd/sim.js.
const R = 0.3, LEN = 1.75, TIP = 0.12, _o = {}, _h = { t: 2, s: null }, _cars = [], _near = [];

// the first collision line the move (ax, ay) -> (bx, by) crosses: _h.t in [0, 1], _h.s the line; false if none
function first(st, ax, ay, bx, by) {
  const c = st.cell || 16, rx = bx - ax, ry = by - ay; let best = 2, bs = null;
  const i0 = Math.floor(Math.min(ax, bx) / c), i1 = Math.floor(Math.max(ax, bx) / c), j0 = Math.floor(Math.min(ay, by) / c), j1 = Math.floor(Math.max(ay, by) / c);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.segs.get(st.key(i, j)); if (!a) continue;
    for (const s of a) { const sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue;
      const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den; if (t >= 0 && t <= 1 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) { best = t; bs = s; } } }
  _h.t = best; _h.s = bs; return bs !== null;
}
// the cars standing near (x, y)
function standing(g, x, y) {
  _cars.length = 0; const add = (e) => { if (e && e.def && !e.gone && Math.abs(e.x - x) < 9 && Math.abs(e.y - y) < 9) _cars.push(e); };
  if (g.vehicles) for (const e of g.vehicles) if (Math.abs(e.vx || 0) + Math.abs(e.vy || 0) < 0.5) add(e);
  if (g.traffic && g.traffic.cars) for (const e of g.traffic.cars) if (Math.abs(e.v || 0) < 0.5) add(e);
  if (g.parked && g.parked.near) for (const e of g.parked.near(x, y, 9, _near)) add(e);
}
// is (x, y) inside car e's box grown by m?
function inBox(e, x, y, m) { const dx = x - e.x, dy = y - e.y, c = Math.cos(e.h), s = Math.sin(e.h); return Math.abs(dx * c + dy * s) < e.def.len / 2 + m && Math.abs(-dx * s + dy * c) < e.def.wid / 2 + m; }
function inCars(x, y, m) { for (const e of _cars) if (inBox(e, x, y, m)) return e; return null; }
// may he lie from (x, y) towards h with his head `reach` metres off?
function clear(st, x, y, h, reach, noCars) {
  const c = Math.cos(h), s = Math.sin(h); if (first(st, x, y, x + c * (reach + TIP), y + s * (reach + TIP))) return false;
  if (!noCars) for (let k = 1; k <= 4; k++) if (inCars(x + c * reach * k / 4, y + s * reach * k / 4, 0.1)) return false;
  return true;
}
// the nearest heading to p.h that is clear at (x, y): at his full length if there is one, else at `reach`; p.h is left alone if none is
function turn(st, p, x, y, full, reach, noCars) {
  for (const L of full > reach + 0.01 ? [full, reach] : [full]) { if (clear(st, x, y, p.h, L, noCars)) return true;
    for (let k = 1; k <= 16; k++) for (const sg of [1, -1]) { const h = p.h + sg * k * 0.2; if (clear(st, x, y, h, L, noCars)) { p.h = h; return true; } } }
  return false;
}

export function plainSlide(g, p, dt) {
  const st = g.statics, fall = p.fall || 0; let vx = p.vx || 0, vy = p.vy || 0; const sp = Math.hypot(vx, vy), moving = sp >= 0.05;
  if (!moving) { p.vx = p.vy = 0; if (p.pf === 2 || fall < 0.25) return; }       // at rest (or held by a ragdoll, which keeps fall at 0): nothing to do
  if (!st || !st.segs) { p.x += vx * dt; p.y += vy * dt; return; }
  const full = LEN * (p.scale || 1); standing(g, p.x, p.y);
  if (moving) {
    const ox = p.x, oy = p.y, ml = sp * dt, ux = vx / sp, uy = vy / sp; let nx = ox + vx * dt, ny = oy + vy * dt;
    // the walls: stop a half width short of the first line met, keep half the speed along it
    if (first(st, ox, oy, nx + ux * R, ny + uy * R)) { const s = _h.s, d = Math.max(0, _h.t * (ml + R) - R), L = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1e-9, tx = (s[2] - s[0]) / L, ty = (s[3] - s[1]) / L, vt = (vx * tx + vy * ty) * 0.5;
      nx = ox + ux * d; ny = oy + uy * d; vx = tx * vt; vy = ty * vt; }
    // posts, trees, corners: pushed clear as a walking person is
    if (st.resolve(nx, ny, R, _o, false) > 0) { nx = _o.x; ny = _o.y; if (_o.nx || _o.ny) { const vn = vx * _o.nx + vy * _o.ny; if (vn < 0) { vx -= vn * _o.nx; vy -= vn * _o.ny; } } }
    // standing cars: he stops against the box
    let e = inCars(nx, ny, R);
    if (e) { if (inBox(e, ox, oy, R)) { const dx = nx - e.x, dy = ny - e.y, c = Math.cos(e.h), s = Math.sin(e.h), f = dx * c + dy * s, w = -dx * s + dy * c, pf = e.def.len / 2 + R - Math.abs(f), pw = e.def.wid / 2 + R - Math.abs(w);
        if (pf < pw) { const q = (Math.sign(f) || 1) * pf; nx += c * q; ny += s * q; } else { const q = (Math.sign(w) || 1) * pw; nx -= s * q; ny += c * q; } }      // he stood against it at the hit: out through the nearer face
      else { let lo = 0, hi = 1; for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (inCars(ox + (nx - ox) * m, oy + (ny - oy) * m, R)) hi = m; else lo = m; } nx = ox + (nx - ox) * lo; ny = oy + (ny - oy) * lo; }
      vx = vy = 0; }
    // the place he has been given must be reachable in a straight line from where he was: else he stays
    if (first(st, ox, oy, nx, ny)) { nx = ox; ny = oy; vx = vy = 0; }
    // and he must be able to lie there (turned if need be): else he stays, where he could
    if (nx !== ox || ny !== oy) { const h0 = p.h, r1 = full * Math.sin(1.5 * Math.min(1, fall + dt * 4)); if (!clear(st, nx, ny, p.h, r1) && !turn(st, p, nx, ny, full, r1)) { p.h = h0; nx = ox; ny = oy; vx = vy = 0; } }
    p.x = nx; p.y = ny; p.vx = vx; p.vy = vy;
    // once, at the hit: where will the slide end, and can he lie there? (he is turned now, while he still stands)
    if (!p.pf) { p.pf = 1; const D = sp / 3.5; let ex = nx + ux * D, ey = ny + uy * D; if (first(st, nx, ny, ex + ux * R, ey + uy * R)) { const d = Math.max(0, _h.t * (D + R) - R); ex = nx + ux * d; ey = ny + uy * d; }
      for (let k = 0; k < 6 && inCars(ex, ey, R); k++) { ex -= ux * D / 6; ey -= uy * D / 6; }
      if (!clear(st, ex, ey, p.h, full)) { const h0 = p.h; if (turn(st, p, ex, ey, full, full) && !clear(st, nx, ny, p.h, LEN * (p.scale || 1) * Math.sin(1.5 * fall))) p.h = h0; } }
  }
  // the way he lies now
  const reach = full * Math.sin(1.5 * Math.min(1, fall + dt * 4));
  if (!clear(st, p.x, p.y, p.h, reach) && !turn(st, p, p.x, p.y, full, reach)) turn(st, p, p.x, p.y, full, reach, true);      // a nook with no room among the cars: clear of the walls at least
  if (!moving && fall >= 1) p.pf = 2; else if (p.pf === 2) p.pf = 1;
}
