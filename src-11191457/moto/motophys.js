// moto/motophys.js (gameplay lane): the motorcycle's physics, one function, no imports. Everything else about the bike (model, boarding, rider,
// camera, crash and ragdoll, parked bikes, traffic riders, police) is in moto.js and reaches the physics only through stepBike(s, dt, inp, env).
// The interface is written out in lanes/gameplay/moto-state/NOTES.md so that another physics (e.g. Jolt's MotorcycleController) can be swapped in.
//   inp  { steer -1..1 (+ left), throttle 0..1, brake 0..1, handbrake, rider }
//   env  { resolve(x, y, r, out) -> hit?, out.x/.y/.nx/.ny;  onSidewalk(x, y) }
//   s    the bike's state (the game's Vehicle fields plus lean, stand, down ...), read and written
// How it rides: an arcade single-track model. The keys ask for a LEAN (not a wheel angle); the lean follows on a slightly under-damped spring
// (so it rolls in quickly and comes out of a corner with a little counter-lean), and the turn rate comes from the lean: sideways pull =
// aMax(speed) * lean / leanMax(speed). At walking pace the pull is what the handlebar's full lock gives (v^2 tan(lock) / wheelbase), so it turns
// in under its own length; above that it is capped at what the tyres hold. Both tyres are on the ground by construction: there is no pitch
// freedom at all (no wheelie, no stoppie whatever the throttle or brake); s.pitch is a 1.5 degree squat/dive of the sprung body for the eye.
/* lead, Nov 16 (Matt: 'top speed of the cars and the motorbike is too slow'): with the pedal down the air drag is cut and the top-speed term raised, so a sedan runs out at about 119 km/h (was 77), the sports car 224 (141), the motorbike 198 (130); off the pedal the old drag stands, so lift-off, braking and cornering are as they were. ?topspeed=0 = as it was; off on the public site unless ?topspeed=1. */
import { FC } from '../move/fastcars.js';
const _TSQ = (() => { try { const q = new URLSearchParams(location.search).get('topspeed'); return q === '0' ? 0 : q ? 1 : 1; } catch (e) { return 0; } })();
export const TUNE = {
  top: 62, acc: 12.5, brake: 14.5, rev: 1.4,          // m/s, m/s2 (the sports car: 56, 9.6)
  grip: 12, aLow: 22, aHigh: 11.5, aFast: 9.5,         // sideways pull the tyres hold: below 9 m/s, above 22 m/s, above 45 m/s
  lock: 0.62, leanMax: 0.74,                           // handlebar lock (rad), deepest lean drawn (42 degrees)
  om: 9.5, zeta: 0.68,                                 // the lean spring: rad/s, damping (< 1: a little overshoot = counter-lean out of a corner)
  standLean: 0.19, downLean: 1.31, footLean: 0.045,    // on the side stand; lying on its side; at a stop with a foot down
  wb: 1.44, radius: 0.31, len: 2.08, wid: 0.74,
  throw: 7.0, ram: 4.5,                                // closing speed (m/s) that throws the rider: into something / struck by something moving
};
const cl = (x, a, b) => (x < a ? a : x > b ? b : x), _o = {};
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export function aMax(v) { const T = TUNE, tyre = v < 9 ? T.aLow : v < 22 ? T.aLow + (T.aHigh - T.aLow) * (v - 9) / 13 : v < 45 ? T.aHigh + (T.aFast - T.aHigh) * (v - 22) / 23 : T.aFast; return Math.min(v * v * Math.tan(T.lock) / T.wb, tyre); }
export function leanMax(v) { return Math.min(TUNE.leanMax, Math.atan(aMax(v) / 9.81) * 0.92); }
export function initBike(s) { const d = { lean: 0, leanV: 0, sIn: 0, stand: 0, down: 0, held: null, hit: 0, hitNx: 0, hitNy: 0, zf: s.z || 0, zr: s.z || 0, wheelF: { x: 0, y: 0, z: 0, on: true }, wheelR: { x: 0, y: 0, z: 0, on: true }, vf: 0, vs: 0, yawV: 0, steer: 0, spin: 0, pitch: 0, slip: 0, acc: 0, braking: false }; for (const k in d) if (s[k] === undefined) s[k] = d[k]; return s; }

function contact(s, env, rest, fric) {
  const T = TUNE, r = T.wid * 0.5; let hit = 0;
  for (const o of [T.len * 0.3, 0, -T.len * 0.3]) {
    const cx = s.x + Math.cos(s.h) * o, cy = s.y + Math.sin(s.h) * o;
    if (env.resolve(cx, cy, r, _o)) {
      s.x += _o.x - cx; s.y += _o.y - cy; const vn = s.vx * _o.nx + s.vy * _o.ny;
      if (vn < 0) { s.vx -= vn * (1 + rest) * _o.nx; s.vy -= vn * (1 + rest) * _o.ny; const tx = -_o.ny, ty = _o.nx, vt = s.vx * tx + s.vy * ty; s.vx -= vt * fric * tx; s.vy -= vt * fric * ty;
        s.h = wrapPi(s.h + cl((Math.cos(s.h) * _o.ny - Math.sin(s.h) * _o.nx) * o * vn * 0.02, -0.06, 0.06));
        if (-vn > hit) { hit = -vn; s.hitNx = _o.nx; s.hitNy = _o.ny; } }
    }
  }
  if (hit > s.hit) s.hit = hit;
}
function ground(s, env, dt) {
  const T = TUNE, c = Math.cos(s.h), sn = Math.sin(s.h), a = T.wb / 2, F = s.wheelF, R = s.wheelR;
  F.x = s.x + c * a; F.y = s.y + sn * a; R.x = s.x - c * a; R.y = s.y - sn * a;
  const k = Math.min(1, dt * 16), tf = env.onSidewalk(F.x, F.y) ? 0.15 : 0, tr = env.onSidewalk(R.x, R.y) ? 0.15 : 0;
  s.zf += (tf - s.zf) * k; s.zr += (tr - s.zr) * k; F.z = s.zf; R.z = s.zr; F.on = R.on = true; s.z = (s.zf + s.zr) / 2;
}

// A narrow body moves up to a metre a step at top speed: the step is cut into pieces of at most 0.3 m (under the body's 0.37 m half width), so it
// can never be carried across a wall line between two looks at it.
export function stepBike(s, dt, inp, env) {
  const n = Math.max(1, Math.min(8, Math.ceil(Math.hypot(s.vx, s.vy) * dt / 0.3))); let hit = 0, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) { one(s, dt / n, inp, env); if (s.hit > hit) { hit = s.hit; nx = s.hitNx; ny = s.hitNy; } }
  s.hit = hit; if (hit > 0) { s.hitNx = nx; s.hitNy = ny; } return s;
}
function one(s, dt, inp, env) {
  const T = TUNE; s.hit = 0;
  if (s.down) {                                          // on its side, sliding to a stop
    const sp = Math.hypot(s.vx, s.vy), dec = 5.6 * dt; if (sp > dec) { const k = (sp - dec) / sp; s.vx *= k; s.vy *= k; } else { s.vx = s.vy = 0; }
    s.yawV *= Math.exp(-(sp < 0.5 ? 7 : 1.5) * dt); s.h = wrapPi(s.h + s.yawV * dt);
    s.lean += (s.down * T.downLean - s.lean) * Math.min(1, dt * 7.5); s.leanV = 0; s.sIn = 0;
    s.steer += (s.down * 0.45 - s.steer) * Math.min(1, dt * 5); s.pitch *= 1 - Math.min(1, dt * 6);
    s.x += s.vx * dt; s.y += s.vy * dt; contact(s, env, 0.2, 0.25);
    const c = Math.cos(s.h), sn = Math.sin(s.h); s.vf = s.vx * c + s.vy * sn; s.vs = s.vx * sn - s.vy * c; s.spin += s.vf * dt / T.radius * 0.3; s.slip = 0; s.acc = 0; s.braking = false;
    ground(s, env, dt); return s;
  }
  if (!inp.rider) {                                      // nobody on it: on its stand, or held upright by whoever is getting on (s.held = lean, set by moto.js)
    const sp = Math.hypot(s.vx, s.vy), dec = 7 * dt; if (sp > dec) { const k = (sp - dec) / sp; s.vx *= k; s.vy *= k; } else { s.vx = s.vy = 0; }
    s.yawV *= Math.exp(-8 * dt); s.h = wrapPi(s.h + s.yawV * dt);
    const want = s.held !== null && s.held !== undefined ? s.held : s.stand * T.standLean; s.lean += (want - s.lean) * Math.min(1, dt * 12); s.leanV = 0; s.sIn = 0;
    s.steer += ((s.stand > 0.5 ? 0.42 : 0) * (s.held !== null && s.held !== undefined ? 0 : 1) - s.steer) * Math.min(1, dt * 5); s.pitch *= 1 - Math.min(1, dt * 6);
    if (sp > 0) { s.x += s.vx * dt; s.y += s.vy * dt; contact(s, env, 0.15, 0.2); }
    const c = Math.cos(s.h), sn = Math.sin(s.h); s.vf = s.vx * c + s.vy * sn; s.vs = s.vx * sn - s.vy * c; s.spin += s.vf * dt / T.radius; s.slip = 0; s.acc = 0; s.braking = false;
    ground(s, env, dt); return s;
  }
  const c = Math.cos(s.h), sn = Math.sin(s.h); let vf = s.vx * c + s.vy * sn, vs = s.vx * sn - s.vy * c;      // forward, rightward
  // ---- along: throttle, brakes, drag. Quick off the line.
  let acc = 0; const thr = cl(inp.throttle || 0, 0, 1), brk = cl(inp.brake || 0, 0, 1);
  const tsOn = _TSQ && thr > 0 && vf > 0, tsTop = T.top * (_TSQ ? (FC.on ? 1.42 : 1.16) : 1);     /* gameplay lane, Nov 18 (move/fastcars.js): the bike runs out at about 137 mph instead of 119; ?fastcars=0 */
  if (thr > 0) acc += vf < -0.3 ? 10 * thr : thr * T.acc * Math.max(0, 1 - (vf / tsTop) ** 2) * (vf < 10 ? 1.22 : 1);
  if (brk > 0) { if (vf > 0.5) acc -= T.brake * brk; else acc -= brk * 3.2 * Math.max(0, 1 + vf / T.rev); }      // at a standstill the brake paddles it backwards at walking pace
  acc -= (tsOn ? 0.04 : 0.10) * vf + (tsOn ? 0.001 : 0.0036) * vf * Math.abs(vf) + (thr === 0 && brk === 0 ? Math.sign(vf) * Math.min(0.9, Math.abs(vf) / dt) : 0);
  if (inp.handbrake) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 6);
  vf += acc * dt; s.acc = acc; s.braking = brk > 0.03 || !!inp.handbrake;
  // ---- the lean the keys ask for, and the lean it has
  const want = cl(inp.steer || 0, -1, 1);
  // A tap asks for a small lean. A held key still reaches full lock.
  const rise = inp.gentleSteer ? 2.5 : 8;
  const rate = Math.abs(want) < Math.abs(s.sIn) || want * s.sIn < 0 ? 11 : rise;
  s.sIn += cl(want - s.sIn, -rate * dt, rate * dt);
  const v = Math.abs(vf), am = aMax(v), lm = leanMax(v), slow = cl(1 - v / 1.2, 0, 1);
  const leanT = s.sIn * lm * (inp.handbrake ? 1.08 : 1) + T.footLean * slow;
  s.leanV += ((leanT - s.lean) * T.om * T.om - 2 * T.zeta * T.om * s.leanV) * dt; s.lean += s.leanV * dt; s.lean = cl(s.lean, -1.0, 1.0);
  // ---- the turn that lean makes
  const k = lm > 0.02 ? cl((s.lean - T.footLean * slow) / lm, -1.15, 1.15) : s.sIn, aLat = am * k;
  let yaw = v > 0.25 ? aLat / (vf >= 0 ? Math.max(v, 0.6) : -Math.max(v, 0.6)) : 0; const ymax = Math.max(v, 0.6) * Math.tan(T.lock) / T.wb; yaw = cl(yaw, -ymax, ymax); if (inp.handbrake) yaw *= 1.35;
  s.yawV += (yaw - s.yawV) * Math.min(1, dt * 18); s.h = wrapPi(s.h + s.yawV * dt);
  // the fork: what the turn needs, a touch of counter-steer as it rolls in, and the bars turned by hand at a standstill
  const fork = cl(Math.atan(T.wb * s.yawV / Math.max(v, 1.5)) * (vf >= 0 ? 1 : -1) - 0.045 * s.leanV * cl(v / 10, 0, 1) + s.sIn * 0.5 * slow, -T.lock, T.lock); s.steer += (fork - s.steer) * Math.min(1, dt * 14);
  // ---- tyres: sideways speed bleeds off with grip; the handbrake locks the rear and lets it step out
  let grip = T.grip * (inp.handbrake ? 0.24 : 1); const lim = (v < 9 ? T.aLow : T.aHigh) + 2; if (Math.abs(aLat) > lim) grip *= cl(lim / Math.abs(aLat), 0.5, 1);
  vs *= Math.exp(-grip * dt); s.slip = Math.abs(vs);
  s.vx = vf * c + vs * sn; s.vy = vf * sn - vs * c; s.x += s.vx * dt; s.y += s.vy * dt;
  contact(s, env, 0.12, 0.1);
  { const c2 = Math.cos(s.h), s2 = Math.sin(s.h); s.vf = s.vx * c2 + s.vy * s2; s.vs = s.vx * s2 - s.vy * c2; }
  s.spin += s.vf * dt / T.radius;
  s.pitch += (cl(-acc * 0.0019, -0.027, 0.027) - s.pitch) * Math.min(1, dt * 7);
  ground(s, env, dt); return s;
}
