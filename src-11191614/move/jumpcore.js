// move/jumpcore.js: the physics of the on-foot jump. No imports, no drawing: jump.js feeds it the world and reads back where the player is.
// Map metres (x east, y north), z up. The body is an upright cylinder: radius WALL against walls and posts, its centre line against car bodies
// (grown by PAD), feet at z.
//   Walls are the segments in game.statics. A segment is a wall at every height (buildings, shop fronts, the map edge, anything not tagged) unless it
//   has a top: with his feet at or above the top he passes over it, and stands on it when his centre line is within STAND of the line.
//   THE TAG READ HERE (one place, segTop below): seg.low = metres above the segment's own ground, set where the segment is made (the lead's
//   statics.addSeg(ax, ay, bx, by, low)); until the layers say so, jump.js's own probe (jumpworld.js classifySegs) writes the same answer as seg.jt
//   (metres above the map's zero). seg.jt === null: looked at, no top.
//   Head room: env.ceil(x, y) is the underside of the lowest drawn thing over that place (Infinity: open sky). His head (HEAD above the feet) never
//   goes above it: a jump under something is cut short, and he cannot move sideways to where he would not fit.
//   Cars are boxes with a roof line: env.profile(car) gives the top height in slices along the car (measured from the car's own model), full width.
//   Posts and furniture are the game's circles: env.circleTop(o) gives [top, standable]; under the top a circle pushes sideways as it does today.
// A step is cut into pieces of at most 1/60 s and height is integrated exactly, so jump height and reach do not depend on the frame rate.
export const TUNE = {
  g: 18,            // m/s2 (stronger than real gravity: a 1.1 m jump lasts 0.70 s, not 0.95)
  height: 1.1,      // m, feet at the top of a jump
  wall: 0.34,       // m, body radius against walls and posts (the game's own on-foot radius)
  pad: 0.28,        // m, a car body is this much wider and longer for the body's centre line (so legs and arms stay out of the panels)
  padStand: 0.08,   // m, how far past the edge of a car the centre line can be and still stand on it
  stepUp: 0.16,     // m, walked up without a jump (a kerb is 0.15)
  grab: 0.12,       // m, a ledge this much above the feet is still landed on in the air
  stepDown: 0.3,    // m, walked down without falling
  maxStep: 1 / 60,
  airAcc: 9,        // m/s2 of steering in the air
  airMin: 2.2,      // m/s the keys can reach in the air from a standing jump
  vzMin: -30,
  head: 1.86,       // m, the top of his head above his feet, with a finger of air (head bone 1.70 standing, 1.70 at most in the air)
  stand: 0.2,       // m, how far from a low fence's line his centre line can be and still stand on its top
};
const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const _o = { x: 0, y: 0, nx: 0, ny: 0, depth: 0, tag: null }, _q = { lx: 0, ly: 0, top: 0, inside: false, P: null, cz: 0 }, _p = [0, 0];

// where a point is in a car's frame and how high the car is there
export function carQuery(car, P, x, y, pad, out) {
  const c = Math.cos(car.h), s = Math.sin(car.h), dx = x - car.x, dy = y - car.y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  out.lx = lx; out.ly = ly; out.P = P; out.cz = car.z || 0;
  out.inside = lx > P.x0 - pad && lx < P.x1 + pad && Math.abs(ly) < P.hw + pad;
  if (out.inside) { const n = P.n, i = Math.min(n - 1, Math.max(0, Math.floor((lx - P.x0) / (P.x1 - P.x0) * n))); out.i = i; out.top = P.top[i] + out.cz; } else { out.top = 0; out.i = -1; }
  return out;
}
// the nearest place (car frame) where a body with its feet at zt is not inside the car: off a side, off an end, or onto a lower part of the car
export function carExit(q, zt, tol, pad, out, maxTop = Infinity) {      // maxTop: a part of the car higher than this is no place for him (head room)
  const P = q.P, n = P.n, w = (P.x1 - P.x0) / n, lx = q.lx, ly = q.ly, e = 0.004;
  let best = P.hw + pad - Math.abs(ly) + e, bx = lx, by = (ly < 0 ? -1 : 1) * (P.hw + pad + e);
  let d = P.x1 + pad - lx + e; if (d < best) { best = d; bx = P.x1 + pad + e; by = ly; }
  d = lx - (P.x0 - pad) + e; if (d < best) { best = d; bx = P.x0 - pad - e; by = ly; }
  for (let j = q.i + 1; j < n; j++) { const xx = P.x0 + j * w + e; if (xx - lx >= best) break; if (P.top[j] + q.cz - tol <= zt && P.top[j] + q.cz <= maxTop) { best = xx - lx; bx = xx; by = ly; break; } }
  for (let j = q.i - 1; j >= 0; j--) { const xx = P.x0 + (j + 1) * w - e; if (lx - xx >= best) break; if (P.top[j] + q.cz - tol <= zt && P.top[j] + q.cz <= maxTop) { best = lx - xx; bx = xx; by = ly; break; } }
  out[0] = bx; out[1] = by; return best;
}

// the top of a wall segment in metres above the map's zero, or undefined: a wall at every height
let LOW = true, BASE = null;      // (the ground under a point, for seg.low; set by the JumpCore that is running)
export const segTop = (s) => { if (!LOW) return undefined; let t = s.jt; if (t === undefined) { if (s.low > 0) { if (!BASE) return undefined; t = Math.max(BASE(s[0], s[1]), BASE(s[2], s[3]), BASE((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)) + s.low; } else t = null; s.jt = t; } return t === null ? undefined : t; };
// the game's StaticWorld.resolve / raycast for walls only, leaving out the segments whose top (s.jt) his feet (zt, with tol) are over
export function wallResolve(st, x, y, r, zt, tol, out) {
  const c = st.cell; let n = 0; out.x = x; out.y = y; out.nx = 0; out.ny = 0; out.depth = 0;
  const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((y - r) / c), j1 = Math.floor((y + r) / c);
  for (let it = 0; it < 2; it++) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.segs.get(st.key(i, j)); if (!a) continue;
    for (const s of a) { const jt = segTop(s); if (jt !== undefined && zt >= jt - tol) continue;
      const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1e-9; let t = ((out.x - s[0]) * dx + (out.y - s[1]) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      let ex = out.x - (s[0] + dx * t), ey = out.y - (s[1] + dy * t); const d = Math.hypot(ex, ey);
      if (d < r && d > 1e-6) { ex /= d; ey /= d; out.x += ex * (r - d); out.y += ey * (r - d); out.nx = ex; out.ny = ey; if (r - d > out.depth) out.depth = r - d; n++; } } }
  return n;
}
export function wallRay(st, ax, ay, bx, by, zt, tol) {
  const c = st.cell, rx = bx - ax, ry = by - ay, steps = Math.ceil(Math.hypot(rx, ry) / (c * 0.5)) + 1; let best = 1, lk = NaN;
  for (let q = 0; q <= steps; q++) { const k = st.key(Math.floor((ax + rx * q / steps) / c), Math.floor((ay + ry * q / steps) / c)); if (k === lk) continue; lk = k; const a = st.segs.get(k); if (!a) continue;
    for (const s of a) { const jt = segTop(s); if (jt !== undefined && zt >= jt - tol) continue; const sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) continue;
      const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den; if (t >= 0 && t < best && u >= 0 && u <= 1) best = t; } }
  return best;
}
// the highest low-fence top within reach of his centre line that his feet (zt, with tol) are over; -1: none
export function wallTop(st, x, y, reach, zt, tol) {
  const c = st.cell, i0 = Math.floor((x - reach) / c), i1 = Math.floor((x + reach) / c), j0 = Math.floor((y - reach) / c), j1 = Math.floor((y + reach) / c); let best = -1;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.segs.get(st.key(i, j)); if (!a) continue;
    for (const s of a) { const jt = segTop(s); if (jt === undefined || jt <= best || zt < jt - tol) continue; const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1e-9; let t = ((x - s[0]) * dx + (y - s[1]) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) < reach) best = jt; } }
  return best;
}

export class JumpCore {
  // env: statics (resolve, raycast, circ, key, cell), base(x, y) -> ground height, cars(x, y, out) -> cars near, profile(car), circleTop(o) -> [top, standable],
  //      roof(x, y) -> null on the street, or { ok, top } on a rooftop (the helicopter lane's roofs: only its parapet rule applies there)
  constructor(env) {
    this.env = env; BASE = env.base; this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0; this.own = false; this.grounded = true; this.sup = null; this.lx = 0; this.ly = 0; this.lh = 0;
    this.dh = 0; this.landV = 0; this.landed = false; this.G = 0; this.v0 = Math.sqrt(2 * TUNE.g * TUNE.height); this.launchSp = 0; this.near = []; this.airT = 0; this.peak = 0; this.z0 = 0;
    this.stats = { jumps: 0, lands: 0, onCar: 0, onThing: 0, onFence: 0, pops: 0, blocked: 0, headCut: 0, headSide: 0 }; this.cut = false;
  }
  take(x, y, z) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.own = true; this.grounded = true; this.sup = null; this.landed = false; this.dh = 0; }
  release() { this.own = false; this.grounded = true; this.sup = null; this.vx = this.vy = this.vz = 0; }
  launch(vx, vy) { this.vx = vx; this.vy = vy; this.vz = this.v0; this.grounded = false; this.sup = null; this.launchSp = Math.hypot(vx, vy); this.airT = 0; this.z0 = this.z; this.peak = this.z; this.stats.jumps++; }
  // wish: { gx, gy: walking velocity wanted on a surface; has: a direction is held; dx, dy: that direction (unit) }
  step(dt, wish) {
    this.landed = false; this.cut = false; this.squeezed = false; this.dh = 0; if (!(dt > 0)) return;
    const n = Math.max(1, Math.ceil(dt / TUNE.maxStep - 1e-6)), h = dt / n; for (let i = 0; i < n && this.own; i++) this.sub(h, wish);
  }
  solidCar(x, y, zt, tol) {       // the first car the body would be inside at (x, y) with feet at zt
    const e = this.env; for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, TUNE.pad, _q); if (q.inside && zt < q.top - tol) return car; } return null;
  }
  sub(h, wish) {
    const e = this.env, T = TUNE, st = e.statics, ox = this.x, oy = this.y, ceil = e.ceil && (!e.headOn || e.headOn()) ? e.ceil : null; let x = ox, y = oy; BASE = e.base; LOW = e.lowOn ? !!e.lowOn() : e.low !== false;
    const roof = e.roof ? e.roof(ox, oy) : null;
    this.near.length = 0; if (!roof) e.cars(ox, oy, this.near);
    // carried by the car he stands on
    if (this.grounded && this.sup && this.sup.car) {
      const car = this.sup.car; if (this.near.indexOf(car) < 0) { this.sup = null; this.grounded = false; this.vz = 0; }
      else { const c = Math.cos(car.h), s = Math.sin(car.h), cx = car.x + c * this.lx - s * this.ly, cy = car.y + s * this.lx + c * this.ly;
        if (Math.hypot(cx - ox, cy - oy) < 1.2 && wallRay(st, ox, oy, cx, cy, this.z, T.stepUp) >= 1 && !(ceil && this.z + T.head > ceil(cx, cy) && ceil(cx, cy) < ceil(ox, oy))) { x = cx; y = cy; this.dh += wrapPi(car.h - this.lh); } }      // (a wall or something overhead in the way: he stays and the car goes from under him)
    }
    const mx = x, my = y;      // (where the car under him has taken him, before his own move)
    // the move he makes himself
    if (this.grounded) { this.vx = wish.gx; this.vy = wish.gy; }
    else if (wish.has) { const tv = Math.max(T.airMin, this.launchSp), ax = wish.dx * tv - this.vx, ay = wish.dy * tv - this.vy, a = Math.hypot(ax, ay), m = T.airAcc * h; if (a > m) { this.vx += ax / a * m; this.vy += ay / a * m; } else { this.vx += ax; this.vy += ay; } }
    x += this.vx * h; y += this.vy * h;
    const zt = this.z; let z = this.z;
    if (!this.grounded) { z += this.vz * h - 0.5 * T.g * h * h; this.vz = Math.max(T.vzMin, this.vz - T.g * h); this.airT += h; }
    const tol = this.grounded ? T.stepUp : T.grab, zw = z < zt ? z : zt;      // (zw: a low wall is a wall as soon as his feet are under its top, also within this step)
    const fit = (top, px, py) => !ceil || top + T.head <= ceil(px, py) + 1e-9;      // a top is only somewhere to stand if he fits under what hangs over it
    let knocked = false, pinned = false;      // (pinned: held where he was between a wall and something else; a low fence he is over then carries him out to his full width)
    if (roof) { const r2 = e.roof(x, y); if (!r2 || !r2.ok || (e.roofSolid && e.roofSolid(x, y) && !e.roofSolid(ox, oy))) { x = ox; y = oy; this.vx = this.vy = 0; } }      // (on a roof: its parapet, and the helicopter standing on it)
    else {
      for (let it = 0; it < 2; it++) {
        // walls
        if (wallResolve(st, x, y, T.wall, zw, tol, _o)) { x = _o.x; y = _o.y; const vn = this.vx * _o.nx + this.vy * _o.ny; if (vn < 0) { this.vx -= vn * _o.nx; this.vy -= vn * _o.ny; } }
        // posts and furniture
        const c = st.cell, i0 = Math.floor((x - 1) / c), i1 = Math.floor((x + 1) / c), j0 = Math.floor((y - 1) / c), j1 = Math.floor((y + 1) / c);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.circ.get(st.key(i, j)); if (!a) continue;
          for (const o of a) { if (!o.on || (o.tag && typeof o.tag === 'object')) continue; let ex = x - o.x, ey = y - o.y; const d = Math.hypot(ex, ey), R = T.wall + o.r; if (d >= R || d < 1e-6) continue;
            { const ct = e.circleTop(o)[0]; if (zt >= ct - tol && (ct > 1e8 || fit(ct, x, y))) continue; }
            ex /= d; ey /= d; x += ex * (R - d); y += ey * (R - d); const vn = this.vx * ex + this.vy * ey; if (vn < 0) { this.vx -= vn * ex; this.vy -= vn * ey; } } }
        // cars
        let moved = false;
        for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, T.pad, _q); if (!q.inside || (zt >= q.top - tol && fit(q.top, x, y))) continue;
          if (zt >= q.top - tol && (x !== mx || y !== my)) { x = mx; y = my; this.vx = this.vy = 0; this.stats.headSide++; moved = true; break; }      // his own step onto a part of the car he has no head room on: not taken
          knocked = true; carExit(q, zt, tol, T.pad, _p, ceil ? ceil(x, y) - T.head + 1e-9 : Infinity); const cs = Math.cos(car.h), sn = Math.sin(car.h), nx2 = car.x + cs * _p[0] - sn * _p[1], ny2 = car.y + sn * _p[0] + cs * _p[1];
          let px = nx2 - x, py = ny2 - y; const pl = Math.hypot(px, py); if (pl > 1e-6) { px /= pl; py /= pl; const vn = this.vx * px + this.vy * py; if (vn < 0) { this.vx -= vn * px; this.vy -= vn * py; } }
          x = nx2; y = ny2; moved = true; }
        if (!moved) break;
      }
      // never through a wall: the walls have the last word, and a path that crosses one is not taken
      if (wallResolve(st, x, y, T.wall, zw, tol, _o)) { x = _o.x; y = _o.y; }
      if (wallRay(st, ox, oy, x, y, zw, tol) < 1 || wallResolve(st, x, y, T.wall - 0.005, zw, tol, _o)) { x = ox; y = oy; this.vx = this.vy = 0; this.stats.blocked++; knocked = false; pinned = true; }
    }
    // head room, sideways: a place where he does not fit under what hangs there, at the height he is at now, is not entered
    // (if he does not fit where he is, something came over him or he walked in under it on the street: he may leave, but not to somewhere lower)
    let U = Infinity;
    // A car that pushed him this step has the last word over that: he is knocked off it and comes down beside it, under whatever is there.
    if (ceil) { U = ceil(x, y); if (zt + T.head > U && (x !== ox || y !== oy)) { const U0 = ceil(ox, oy);
        if (knocked) {      // (off the car altogether: out of its nearer side or end, not onto a lower part of it)
          for (let it = 0; it < 2; it++) for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, T.pad, _q); if (!q.inside) continue; const P = q.P, e2 = 0.004; let best = P.hw + T.pad - Math.abs(q.ly) + e2, bx = q.lx, by = (q.ly < 0 ? -1 : 1) * (P.hw + T.pad + e2), d = P.x1 + T.pad - q.lx + e2; if (d < best) { best = d; bx = P.x1 + T.pad + e2; by = q.ly; } d = q.lx - (P.x0 - T.pad) + e2; if (d < best) { bx = P.x0 - T.pad - e2; by = q.ly; }
            const cs = Math.cos(car.h), sn = Math.sin(car.h), nx2 = car.x + cs * bx - sn * by, ny2 = car.y + sn * bx + cs * by; if (wallRay(st, x, y, nx2, ny2, zw, tol) >= 1) { x = nx2; y = ny2; } }
          U = ceil(x, y); if (z > U - T.head) z = Math.max(e.base(x, y), U - T.head);
          if (wallResolve(st, x, y, T.wall, z, 0, _o)) { x = _o.x; y = _o.y; } if (wallRay(st, ox, oy, x, y, z, 0) < 1 || wallResolve(st, x, y, T.wall - 0.005, z, 0, _o)) { x = ox; y = oy; } U = ceil(x, y); if (this.vz > 0) this.vz = 0; if (this.grounded) { this.grounded = false; this.sup = null; this.airT = 0; this.z0 = z; this.peak = z; } this.stats.knocked = (this.stats.knocked || 0) + 1; }
        else if (U < U0 || zt + T.head <= U0) { x = ox; y = oy; this.vx = this.vy = 0; U = U0; this.stats.headSide++; pinned = true; } } }
    const zf = z < zt ? z : zt;      // (after a knock his feet may be lower than they were)
    // over a low fence he has no room to stand on (a limb over a tree guard): he is put beside it, not left to sink through it
    if (ceil && !roof) { const ft = wallTop(st, x, y, T.stand, zt, tol); if (ft > -1 && !fit(ft, x, y) && wallResolve(st, x, y, T.wall, -1e9, 0, _o) && wallRay(st, x, y, _o.x, _o.y, 1e9, 0) >= 1) { x = _o.x; y = _o.y; U = ceil(x, y); } }
    // what is under him there
    let G = roof ? (e.roof(x, y) || roof).top : e.base(x, y), sup = null, pop = 0;
    if (!roof) {
      for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, T.padStand, _q); if (!q.inside) continue;
        if (zt >= q.top - tol && fit(q.top, x, y)) { if (q.top > G) { G = q.top; sup = { car }; } }
        else if (zf < q.top - tol || !fit(q.top, x, y)) { if (q.top > G) { G = q.top; sup = { car }; } pop = Math.max(pop, q.top); } }
      if (pop > 0) { this.squeezed = true; z = Math.max(z, G); this.stats.pops++; }      // squeezed between a car and a wall: he comes up onto the car, never into it
      { const ft = wallTop(st, x, y, pinned ? T.wall : T.stand, zt, tol); if (ft > G && (pinned || fit(ft, x, y))) { G = ft; sup = { fence: true }; } }      // the top of a low fence or tree guard under him
      const c = st.cell, a = st.circ.get(st.key(Math.floor(x / c), Math.floor(y / c)));      // (a thing to stand on is found in the player's own cell and the eight around only when near an edge: its centre is within reach)
      const look = (a2) => { if (a2) for (const o of a2) { if (!o.on || (o.tag && typeof o.tag === 'object')) continue; const d = Math.hypot(x - o.x, y - o.y); if (d > o.r + 0.1) continue; const ct = e.circleTop(o); if (ct[1] && zt >= ct[0] - tol && ct[0] > G && fit(ct[0], x, y)) { G = ct[0]; sup = { thing: o }; } } };
      look(a); const fx = x / c - Math.floor(x / c), fy = y / c - Math.floor(y / c); if (fx < 0.25 || fx > 0.75 || fy < 0.25 || fy > 0.75) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) look(st.circ.get(st.key(Math.floor(x / c) + i, Math.floor(y / c) + j)));
    }
    this.G = G;
    // head room, upwards: the jump is cut short under what hangs there
    if (U < Infinity) { const zc = U - T.head;
      if (!this.grounded && z > zc && z > zt) { z = Math.max(zt, zc); if (this.vz > 0) { this.vz = 0; this.cut = true; this.stats.headCut++; } } }
    if (this.grounded) { if (G >= z - T.stepDown) { z = G; this.sup = sup; } else { this.grounded = false; this.vz = 0; this.sup = null; this.airT = 0; this.z0 = z; this.peak = z; this.launchSp = Math.hypot(this.vx, this.vy); } }
    else if (z <= G) { this.landV = Math.max(0, -this.vz); z = G; this.vz = 0; this.grounded = true; this.sup = sup; this.landed = true; this.stats.lands++; if (sup && sup.car) this.stats.onCar++; else if (sup && sup.fence) this.stats.onFence++; else if (sup) this.stats.onThing++; }
    if (z > this.peak) this.peak = z;
    this.x = x; this.y = y; this.z = z;
    if (this.grounded && this.sup && this.sup.car) { const car = this.sup.car, c = Math.cos(car.h), s = Math.sin(car.h), dx = x - car.x, dy = y - car.y; this.lx = dx * c + dy * s; this.ly = -dx * s + dy * c; this.lh = car.h; }
    if (this.grounded && !this.sup && !roof) this.own = false;      // back on the street: the game's own walking takes over
    else if (this.grounded && roof) this.own = false;
  }
}

// a car's roof line when its model cannot be measured: from its length, width and height alone
export function genericProfile(def) {
  const n = 24, L = def.len || 4.6, H = def.hgt || 1.45, top = new Float32Array(n), box = H > 1.9;
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n;      // 0 = tail, 1 = nose
    top[i] = box ? (u > 0.86 ? H * 0.62 : H) : u < 0.04 || u > 0.97 ? H * 0.38 : u < 0.2 ? H * 0.68 : u < 0.3 ? H * (0.68 + 0.32 * (u - 0.2) / 0.1) : u < 0.6 ? H : u < 0.74 ? H * (1 - 0.36 * (u - 0.6) / 0.14) : H * 0.64; }
  return { x0: -L / 2, x1: L / 2, hw: (def.wid || 1.85) / 2 * 0.94, n, top, from: 'generic' };
}
// the roof line from a model's vertices (car frame: x forward, y up, z right): the highest point in each of n slices, mirrors left out
export function measureProfile(arrays, def, n = 24) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const a of arrays) for (let i = 0; i < a.length; i += 3) { const x = a[i], z = a[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!(x1 - x0 > 1.5) || !(z1 - z0 > 0.8)) return null;
  const hw = Math.min((z1 - z0) / 2 * 0.94, def && def.wid ? def.wid / 2 : 9), zc = (z0 + z1) / 2, top = new Float32Array(n), w = (x1 - x0) / n;
  for (const a of arrays) for (let i = 0; i < a.length; i += 3) { if (Math.abs(a[i + 2] - zc) > hw * 0.85) continue; const k = Math.min(n - 1, Math.max(0, Math.floor((a[i] - x0) / w))); if (a[i + 1] > top[k]) top[k] = a[i + 1]; }
  for (let k = 0; k < n; k++) if (!(top[k] > 0.05)) top[k] = Math.max(top[Math.max(0, k - 1)] || 0, top[Math.min(n - 1, k + 1)] || 0, 0.3);
  for (let k = 1; k < n - 1; k++) if (top[k] < Math.min(top[k - 1], top[k + 1]) - 0.5) top[k] = Math.min(top[k - 1], top[k + 1]);      // (a one-slice gap in the model is not a pit)
  return { x0, x1, hw, n, top, from: 'model' };
}
