// move/jumpcore.js: the physics of the on-foot jump. No imports, no drawing: jump.js feeds it the world and reads back where the player is.
// Map metres (x east, y north), z up. The body is an upright cylinder: radius WALL against walls and posts, its centre line against car bodies
// (grown by PAD), feet at z.
//   Walls (every segment in game.statics: buildings, fences, tree guards, shop fronts, the map edge) carry no height in the game's data, so they are
//   walls at every height: nothing built from segments can be jumped over or stood on.
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
export function carExit(q, zt, tol, pad, out) {
  const P = q.P, n = P.n, w = (P.x1 - P.x0) / n, lx = q.lx, ly = q.ly, e = 0.004;
  let best = P.hw + pad - Math.abs(ly) + e, bx = lx, by = (ly < 0 ? -1 : 1) * (P.hw + pad + e);
  let d = P.x1 + pad - lx + e; if (d < best) { best = d; bx = P.x1 + pad + e; by = ly; }
  d = lx - (P.x0 - pad) + e; if (d < best) { best = d; bx = P.x0 - pad - e; by = ly; }
  for (let j = q.i + 1; j < n; j++) { const xx = P.x0 + j * w + e; if (xx - lx >= best) break; if (P.top[j] + q.cz - tol <= zt) { best = xx - lx; bx = xx; by = ly; break; } }
  for (let j = q.i - 1; j >= 0; j--) { const xx = P.x0 + (j + 1) * w - e; if (lx - xx >= best) break; if (P.top[j] + q.cz - tol <= zt) { best = lx - xx; bx = xx; by = ly; break; } }
  out[0] = bx; out[1] = by; return best;
}

export class JumpCore {
  // env: statics (resolve, raycast, circ, key, cell), base(x, y) -> ground height, cars(x, y, out) -> cars near, profile(car), circleTop(o) -> [top, standable],
  //      roof(x, y) -> null on the street, or { ok, top } on a rooftop (the helicopter lane's roofs: only its parapet rule applies there)
  constructor(env) {
    this.env = env; this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0; this.own = false; this.grounded = true; this.sup = null; this.lx = 0; this.ly = 0; this.lh = 0;
    this.dh = 0; this.landV = 0; this.landed = false; this.G = 0; this.v0 = Math.sqrt(2 * TUNE.g * TUNE.height); this.launchSp = 0; this.near = []; this.airT = 0; this.peak = 0; this.z0 = 0;
    this.stats = { jumps: 0, lands: 0, onCar: 0, onThing: 0, pops: 0, blocked: 0 };
  }
  take(x, y, z) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.own = true; this.grounded = true; this.sup = null; this.landed = false; this.dh = 0; }
  release() { this.own = false; this.grounded = true; this.sup = null; this.vx = this.vy = this.vz = 0; }
  launch(vx, vy) { this.vx = vx; this.vy = vy; this.vz = this.v0; this.grounded = false; this.sup = null; this.launchSp = Math.hypot(vx, vy); this.airT = 0; this.z0 = this.z; this.peak = this.z; this.stats.jumps++; }
  // wish: { gx, gy: walking velocity wanted on a surface; has: a direction is held; dx, dy: that direction (unit) }
  step(dt, wish) {
    this.landed = false; this.dh = 0; if (!(dt > 0)) return;
    const n = Math.max(1, Math.ceil(dt / TUNE.maxStep - 1e-6)), h = dt / n; for (let i = 0; i < n && this.own; i++) this.sub(h, wish);
  }
  solidCar(x, y, zt, tol) {       // the first car the body would be inside at (x, y) with feet at zt
    const e = this.env; for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, TUNE.pad, _q); if (q.inside && zt < q.top - tol) return car; } return null;
  }
  sub(h, wish) {
    const e = this.env, T = TUNE, st = e.statics, ox = this.x, oy = this.y; let x = ox, y = oy;
    const roof = e.roof ? e.roof(ox, oy) : null;
    this.near.length = 0; if (!roof) e.cars(ox, oy, this.near);
    // carried by the car he stands on
    if (this.grounded && this.sup && this.sup.car) {
      const car = this.sup.car; if (this.near.indexOf(car) < 0) { this.sup = null; this.grounded = false; this.vz = 0; }
      else { const c = Math.cos(car.h), s = Math.sin(car.h), cx = car.x + c * this.lx - s * this.ly, cy = car.y + s * this.lx + c * this.ly;
        if (Math.hypot(cx - ox, cy - oy) < 1.2 && st.raycast(ox, oy, cx, cy) >= 1) { x = cx; y = cy; this.dh += wrapPi(car.h - this.lh); } }      // (a wall in the way: he stays and the car goes from under him)
    }
    // the move he makes himself
    if (this.grounded) { this.vx = wish.gx; this.vy = wish.gy; }
    else if (wish.has) { const tv = Math.max(T.airMin, this.launchSp), ax = wish.dx * tv - this.vx, ay = wish.dy * tv - this.vy, a = Math.hypot(ax, ay), m = T.airAcc * h; if (a > m) { this.vx += ax / a * m; this.vy += ay / a * m; } else { this.vx += ax; this.vy += ay; } }
    x += this.vx * h; y += this.vy * h;
    const zt = this.z; let z = this.z;
    if (!this.grounded) { z += this.vz * h - 0.5 * T.g * h * h; this.vz = Math.max(T.vzMin, this.vz - T.g * h); this.airT += h; }
    const tol = this.grounded ? T.stepUp : T.grab;
    if (roof) { const r2 = e.roof(x, y); if (!r2 || !r2.ok) { x = ox; y = oy; this.vx = this.vy = 0; } }
    else {
      for (let it = 0; it < 2; it++) {
        // walls
        if (st.resolve(x, y, T.wall, _o, true)) { x = _o.x; y = _o.y; const vn = this.vx * _o.nx + this.vy * _o.ny; if (vn < 0) { this.vx -= vn * _o.nx; this.vy -= vn * _o.ny; } }
        // posts and furniture
        const c = st.cell, i0 = Math.floor((x - 1) / c), i1 = Math.floor((x + 1) / c), j0 = Math.floor((y - 1) / c), j1 = Math.floor((y + 1) / c);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = st.circ.get(st.key(i, j)); if (!a) continue;
          for (const o of a) { if (!o.on || (o.tag && typeof o.tag === 'object')) continue; let ex = x - o.x, ey = y - o.y; const d = Math.hypot(ex, ey), R = T.wall + o.r; if (d >= R || d < 1e-6) continue;
            if (zt >= e.circleTop(o)[0] - tol) continue;
            ex /= d; ey /= d; x += ex * (R - d); y += ey * (R - d); const vn = this.vx * ex + this.vy * ey; if (vn < 0) { this.vx -= vn * ex; this.vy -= vn * ey; } } }
        // cars
        let moved = false;
        for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, T.pad, _q); if (!q.inside || zt >= q.top - tol) continue;
          carExit(q, zt, tol, T.pad, _p); const cs = Math.cos(car.h), sn = Math.sin(car.h), nx2 = car.x + cs * _p[0] - sn * _p[1], ny2 = car.y + sn * _p[0] + cs * _p[1];
          let px = nx2 - x, py = ny2 - y; const pl = Math.hypot(px, py); if (pl > 1e-6) { px /= pl; py /= pl; const vn = this.vx * px + this.vy * py; if (vn < 0) { this.vx -= vn * px; this.vy -= vn * py; } }
          x = nx2; y = ny2; moved = true; }
        if (!moved) break;
      }
      // never through a wall: the walls have the last word, and a path that crosses one is not taken
      if (st.resolve(x, y, T.wall, _o, true)) { x = _o.x; y = _o.y; }
      if (st.raycast(ox, oy, x, y) < 1 || st.resolve(x, y, T.wall - 0.005, _o, true)) { x = ox; y = oy; this.vx = this.vy = 0; this.stats.blocked++; }
    }
    // what is under him there
    let G = roof ? (e.roof(x, y) || roof).top : e.base(x, y), sup = null, pop = 0;
    if (!roof) {
      for (const car of this.near) { const q = carQuery(car, e.profile(car), x, y, T.padStand, _q); if (!q.inside) continue;
        if (zt >= q.top - tol) { if (q.top > G) { G = q.top; sup = { car }; } }
        else { if (q.top > G) { G = q.top; sup = { car }; } pop = Math.max(pop, q.top); } }
      if (pop > 0) { z = Math.max(z, G); this.stats.pops++; }      // squeezed between a car and a wall: he comes up onto the car, never into it
      const c = st.cell, a = st.circ.get(st.key(Math.floor(x / c), Math.floor(y / c)));      // (a thing to stand on is found in the player's own cell and the eight around only when near an edge: its centre is within reach)
      const look = (a2) => { if (a2) for (const o of a2) { if (!o.on || (o.tag && typeof o.tag === 'object')) continue; const d = Math.hypot(x - o.x, y - o.y); if (d > o.r + 0.1) continue; const ct = e.circleTop(o); if (ct[1] && zt >= ct[0] - tol && ct[0] > G) { G = ct[0]; sup = { thing: o }; } } };
      look(a); const fx = x / c - Math.floor(x / c), fy = y / c - Math.floor(y / c); if (fx < 0.25 || fx > 0.75 || fy < 0.25 || fy > 0.75) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) look(st.circ.get(st.key(Math.floor(x / c) + i, Math.floor(y / c) + j)));
    }
    this.G = G;
    if (this.grounded) { if (G >= z - T.stepDown) { z = G; this.sup = sup; } else { this.grounded = false; this.vz = 0; this.sup = null; this.airT = 0; this.z0 = z; this.peak = z; this.launchSp = Math.hypot(this.vx, this.vy); } }
    else if (z <= G) { this.landV = Math.max(0, -this.vz); z = G; this.vz = 0; this.grounded = true; this.sup = sup; this.landed = true; this.stats.lands++; if (sup && sup.car) this.stats.onCar++; else if (sup) this.stats.onThing++; }
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
