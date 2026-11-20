// move/campull.js (gameplay lane, Nov 19; a public player's note, Nov 18: "A bus pulled behind my car and blocked all the view").
// The chase camera behind the player's car, motorcycle or bicycle (game.js placeCamera; the bikes go through the same code) already comes in
// front of a WALL. It took no notice of other vehicles: a bus or a truck behind him stood between the camera and the car, or the camera sat
// inside its body. Here the question asked every frame is "does a vehicle HIDE his car from the place the camera is about to take?":
// five sight lines run from that place to his car (its middle and the four corners of its roof) and each is tested in three dimensions
// against the boxes of the vehicles round him (traffic with the buses, the game's own vehicles, parked ones). A pull starts only when the
// middle line and two more are cut for 0.08 s; a vehicle no taller than his own roof + 0.4 m (a sedan beside or behind a sedan) is never a
// blocker: the camera looks over it. So a vehicle that follows behind the camera's place, one that crosses off to a side, or a car alongside
// does not move the camera. While blocked the camera comes in along its line to 0.45 m in front of the blocker (never nearer than 2.2 m, or
// the end of his own long vehicle), rises a little and keeps nearly the chase view's angle, so the horizon stays in the picture. It ends
// when fewer than two lines are cut by the boxes grown 0.5 m (0.15 m to start) for 0.4 s, and eases back out; both ways eased, never set.
// Nothing is changed while nothing blocks: camPull returns null and game.js's numbers are the old ones. ?campull=0 = never called.
// On foot, the scope, the helicopter, the swing and the roof cameras do not come here (the call is made only with player.vehicle set).
export const TUNE = { rise: 0.3, tilt: 0.14, gap: 0.45, floor: 2.2 };     // rise (m) and extra downward tilt (rad) at a full pull; metres kept in front of the blocker; nearest distance
const IN = 0.15, OUT = 0.5, START = 0.08, HOLD = 0.4, RATE_IN = 14, RATE_OUT = 4.5, REACH = 26, TALLER = 0.4;
const _near = [], _c = [], _R = { n: 0, c0: false, f: 1e9, who: null };
// metres along the line (0..L) at which it enters the box of vehicle o grown by m, or -1. ux, uy, uz: the line's unit direction.
function enter(o, m, x, y, z, ux, uy, uz, L) {
  const def = o.def, hl = (def.len || 4.6) / 2 + m, hw = (def.wid || 1.85) / 2 + m, dx = x - o.x, dy = y - o.y;
  if (Math.abs(dx) > L + hl + hw || Math.abs(dy) > L + hl + hw) return -1;
  const c = Math.cos(o.h), s = Math.sin(o.h), ox = dx * c + dy * s, oy = -dx * s + dy * c, vx = ux * c + uy * s, vy = -ux * s + uy * c;
  if (Math.abs(ox) <= hl && Math.abs(oy) <= hw) return -1;     // the line starts inside the grown box (his car touches the bus): nothing sensible to pull to
  let t0 = 0, t1 = L;
  if (Math.abs(vx) < 1e-6) { if (Math.abs(ox) > hl) return -1; } else { let a = (-hl - ox) / vx, b = (hl - ox) / vx; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  if (Math.abs(vy) < 1e-6) { if (Math.abs(oy) > hw) return -1; } else { let a = (-hw - oy) / vy, b = (hw - oy) / vy; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
  if (t0 >= t1) return -1;
  const bot = (o.z || 0) - 0.2, top = (o.z || 0) + (def.hgt || 1.45) + m * 0.6, za = z + uz * t0, zb = z + uz * t1;
  if (Math.min(za, zb) > top || Math.max(za, zb) < bot) return -1;     // the line passes over it or under it
  return t0;
}
// the five sight lines from his car (pts: x, y, z triples; the first is the look-from point) to the camera's place (sx, sy, sz) against the
// candidates grown by m: _R.n lines cut, _R.c0 the middle one, _R.who the vehicle cut nearest his car, _R.f how far out along the camera's own
// line (horizontal metres from the look-from point towards the camera, direction bx, by) the nearest cut lies
function cast(pts, sx, sy, sz, m, bx, by) {
  _R.n = 0; _R.c0 = false; _R.f = 1e9; _R.who = null;
  for (let i = 0; i < 15; i += 3) { const x = pts[i], y = pts[i + 1], z = pts[i + 2], hx = sx - x, hy = sy - y, hz = sz - z, L = Math.hypot(hx, hy, hz); if (!(L > 0.3)) continue;
    let best = -1, who = null; for (const o of _c) { const t = enter(o, m, x, y, z, hx / L, hy / L, hz / L, L); if (t >= 0 && (best < 0 || t < best)) { best = t; who = o; } }
    if (best >= 0) { _R.n++; if (i === 0) _R.c0 = true; const f = (x + hx / L * best - pts[0]) * bx + (y + hy / L * best - pts[1]) * by; if (f < _R.f) { _R.f = f; _R.who = who; } } }
  return _R;
}
const _p = new Float64Array(15);
// g: the game. C: g.cam. bx, by: the horizontal unit direction from the look-from point to the camera. d: the distance the camera is about to
// stand at (after the wall rule). Returns null (nothing in the way and no pull easing out) or { d, up, ahead } (ahead: metres in front of the
// look-from point that the view is aimed at; 2.2 in the game's own chase view).
export function camPull(g, C, bx, by, d, pitch, dt) {
  const own = g.player.vehicle, P = C.pull || (C.pull = { d: undefined, hold: 0, want: 0, seen: 0, free: 0, n: 0, ep: 0, rays: 0, last: null });
  const cp = Math.cos(pitch), sp = Math.sin(pitch), sx = C.tx + bx * d * cp, sy = C.ty + by * d * cp, sz = C.tz + C.h + d * sp;
  if (!(d > 0.5) || !own) { P.d = undefined; return null; }
  const od = own.def || {}, ol = od.len || 4.6, ow = od.wid || 1.85, oz = own.z || 0, ownTop = oz + (od.hgt || 1.45), x = C.tx, y = C.ty, on = P.d !== undefined;
  _c.length = 0;
  const see = (o) => { if (o === own || o.gone || !o.def) return; const top = (o.z || 0) + (o.def.hgt || 1.45); if (top < ownTop + TALLER && top < sz - 0.3) return; _c.push(o); };     // not taller than his own roof and below the camera: looked over
  const T = g.traffic; if (T && T.cars) for (const c of T.cars) { if (Math.abs(c.x - x) > REACH || Math.abs(c.y - y) > REACH) continue; see(c); }
  if (g.vehicles) for (const v of g.vehicles) { if (Math.abs(v.x - x) > REACH || Math.abs(v.y - y) > REACH) continue; see(v); }
  if (g.parked && g.parked.near) for (const s of g.parked.near(x, y, 16, _near)) see(s);
  let blocked = false;
  if (_c.length) { const c = Math.cos(own.h), s = Math.sin(own.h), zr = ownTop - 0.1; _p[0] = x; _p[1] = y; _p[2] = C.tz; let i = 3;
    for (const a of [-0.3, 0.25]) for (const b of [-0.4, 0.4]) { _p[i++] = own.x + c * a * ol - s * b * ow; _p[i++] = own.y + s * a * ol + c * b * ow; _p[i++] = zr; }
    const r = cast(_p, sx, sy, sz, on ? OUT : IN, bx, by); P.rays = r.n; blocked = on ? r.n >= 2 : r.c0 && r.n >= 3;
    if (blocked) { let f = r.f; P.last = r.who; const q = cast(_p, sx, sy, sz, 0.05, bx, by); if (q.n) f = q.f; P.want = Math.max(Math.min(d, Math.max(TUNE.floor, ol * 0.48)), f / cp - TUNE.gap); P.hold = HOLD; P.seen += dt || 0; P.n++; } }
  else P.rays = 0;
  if (!blocked) { P.seen = 0; if (on && P.hold > 0 && dt > 0) P.hold -= dt; else P.want = d; }
  if (!on) { if (!blocked || (dt && P.seen < START)) return null; P.d = dt ? d : P.want; P.free = 0; P.ep++; }     // a pull starts from where the camera stands (a snap: set)
  const want = Math.min(P.want, d); P.d += (want - P.d) * Math.min(1, (dt || 0) * (want < P.d ? RATE_IN : RATE_OUT));
  if (!blocked && P.hold <= 0) { P.free += dt || 0; if (P.d >= d - 0.08 || P.free > 1.2) { P.d = undefined; return null; } } else P.free = 0;     // out again: back to the game's own numbers
  const dd = Math.min(d, P.d), k = Math.max(0, 1 - dd / Math.max(d, 0.01)), up = TUNE.rise * k;
  const A = Math.atan2(C.h + d * sp - 0.1, d * cp + 2.2) + TUNE.tilt * k, ahead = Math.max(0.5, Math.min(9, (C.h + dd * sp + up - 0.1) / Math.tan(A) - dd * cp));     // the chase view's own angle, a little steeper
  return { d: dd, up, ahead };
}
