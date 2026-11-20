// water/boatphys.js (water lane, Nov 15): a boat that floats on the wave function. No engine, no fluid: six points under the hull each ask the
// water how high it is there; a point under the surface is pushed up (more the deeper it is), with damping against the water's own rise and fall.
// From those six pushes come heave, pitch and roll, so the boat bobs, trims, heels and leaves the water over a wake by itself. Thrust and steering
// act at the stern while it is wet; the hull drags in the water, much more sideways than ahead.
//   initBoat(b, spec)            b gets its state; spec from boats.js (len, beam, draft, mass, float, ...)
//   stepBoat(b, dt, inp, env)    inp { steer -1..1 (+ = left, as the car), throttle 0..1, brake 0..1 }, env { surf(x, y) -> water height (world y),
//                                slope(x, y, o) -> o.sx, o.sy (optional) }
// Frames: map x east, y north, heading h counter-clockwise from east; b.z = height of the hull's waterline point; pitch + = bow up; roll + = starboard down.
// Runs in node (no three.js): tools/sim.mjs of this lane.
const G = 9.81;
export const TUNES = {
  speedboat: { top: 24, acc: 6.2, rev: 0.10, turn: 0.95, latG: 10.5, kl: 3.2, zeta: 0.42, bank: 0.042, lift: 0.62, trim: 0.085 },
  ferry: { top: 9, acc: 0.55, rev: 0.6, turn: 0.16, latG: 1.2, kl: 1.4, zeta: 0.6, bank: -0.004, lift: 0, trim: 0.004 },
  tug: { top: 7, acc: 0.8, rev: 0.6, turn: 0.32, latG: 2, kl: 1.8, zeta: 0.6, bank: -0.006, lift: 0, trim: 0.008 },
  tour: { top: 8, acc: 0.6, rev: 0.6, turn: 0.2, latG: 1.5, kl: 1.5, zeta: 0.6, bank: -0.005, lift: 0, trim: 0.005 },
};
export function initBoat(b, spec, x = 0, y = 0, h = 0) {
  const T = TUNES[spec.kind] || TUNES.speedboat, F = spec.float && spec.float.length >= 3 ? spec.float : [[spec.len * 0.42, 0], [spec.len * 0.2, -spec.beam * 0.3], [spec.len * 0.2, spec.beam * 0.3], [-spec.len * 0.35, -spec.beam * 0.36], [-spec.len * 0.35, spec.beam * 0.36], [-spec.len * 0.45, 0]];
  Object.assign(b, { spec, tune: T, x, y, h, z: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, wh: 0, wp: 0, wr: 0, vf: 0, vl: 0, wet: 1, air: 0, thr: 0, rud: 0, slam: 0, ev: null, fresh: true,
    fp: F.map((p) => ({ x: p[0], z: p[1], last: 0, d: 0 })), rp: Math.hypot(spec.len * 0.26, 0), rr: spec.beam * 0.42 });
  // the stiffness of a point is set so the boat rests at its design waterline; the lever arms give pitch and roll their own periods
  let sx2 = 0, sz2 = 0; for (const p of b.fp) { sx2 += p.x * p.x; sz2 += p.z * p.z; } b.sx2 = sx2; b.sz2 = sz2; return b;
}
const _s = { sx: 0, sy: 0 };
function sub(b, dt, inp, env) {
  const S = b.spec, T = b.tune, n = b.fp.length, c = Math.cos(b.h), s = Math.sin(b.h), draft = Math.max(0.2, S.draft), w0 = Math.sqrt(G / draft);
  const sp = Math.sin(b.pitch), sr = Math.sin(b.roll);
  b.vf = b.vx * c + b.vy * s; b.vl = b.vx * s - b.vy * c;      // ahead, and to starboard
  // ---- the six points
  let fz = 0, tp = 0, tr = 0, wet = 0, sternWet = 0, bowDeep = 0; const q = Math.min(1, Math.abs(b.vf) / T.top), lift = T.lift * q * q;
  for (let i = 0; i < n; i++) { const p = b.fp[i], wx = b.x + c * p.x + s * p.z, wy = b.y + s * p.x - c * p.z, hw = env.surf(wx, wy), hp = b.z - draft + p.x * sp - p.z * sr;
    const vw = b.fresh ? 0 : (hw - p.last) / dt; p.last = hw; const d = hw - hp; p.d = d; if (d <= 0) continue;
    const k = Math.min(d / draft, 2.2), vp = b.vz + b.wp * p.x - b.wr * p.z;
    // the push: static (deeper = more) and, at speed, the water's dynamic lift on a planing hull, the fore body first (the bow comes up, then the boat rides on its after body)
    let f = (G / n) * k * (1 - lift) + (G / n) * lift * 1.15 * Math.min(1, d / (draft * 0.45)) * (p.x < 0 ? 0.78 : 1.55);
    f -= 2 * T.zeta * w0 * (vp - vw) / n * Math.min(1, k * 2);
    if (f < -0.2 * G / n) f = -0.2 * G / n;      // water does not hold a hull down harder than this
    fz += f; tp += f * p.x; tr -= f * p.z; wet += Math.min(1, k); if (p.x < 0) sternWet += Math.min(1, k * 2); else if (d > draft * 1.6) bowDeep += 1; }
  b.fresh = false; wet /= n; const aft = b.fp.filter((p) => p.x < 0).length || 1; sternWet = Math.min(1, sternWet / aft);
  // ---- up and down, pitch, roll
  const was = b.air; if (wet < 0.02) b.air += dt; else { if (was > 0.18 && b.vz < -1.2) { b.slam = Math.min(1, -b.vz / 6); b.ev = { slam: b.slam, air: was }; } b.air = 0; }
  b.vz += (fz - G) * dt; b.z += b.vz * dt;
  const ip = b.sx2 / n * 1.15, ir = b.sz2 / n * 2.2;      // per unit mass; a little more than the points alone so the motion is not nervous
  // thrust below the centre of mass lifts the bow; at speed the bow's own lift is already in the points
  const thr = inp.throttle || 0, brk = inp.brake || 0; let drive = 0;
  if (thr > 0.01) drive = thr; else if (brk > 0.01) drive = b.vf > 1.2 ? -brk * 0.9 : -brk * T.rev;
  b.thr += (drive - b.thr) * Math.min(1, dt * 3.2);
  const push = b.thr * T.acc * (b.thr > 0 ? 1 : 1) * sternWet;
  b.wp += ((tp + push * T.trim * S.len * 2.2) / ip - b.wp * 2.4 * wet) * dt; b.wr += (tr / ir - b.wr * (1.6 + 2.2 * wet)) * dt;
  // ---- ahead, sideways, turning
  let af = push, al = 0;
  const kv = 0.12, ks = (T.acc - kv * T.top) / (T.top * T.top);      // drag that meets full thrust at top speed
  af -= (ks * Math.abs(b.vf) + kv) * b.vf * (0.25 + 0.75 * wet) * (bowDeep ? 2.5 : 1); al -= T.kl * b.vl * wet * (1 - 0.45 * lift);
  // waves push a hull downhill a little (surfing a swell, set back by a crest)
  if (env.slope && wet > 0.1) { env.slope(b.x, b.y, _s); const k = G * 0.55 * wet; b.vx -= _s.sx * k * dt; b.vy -= _s.sy * k * dt; }
  b.rud += ((inp.steer || 0) - b.rud) * Math.min(1, dt * 7);
  const v = Math.abs(b.vf), bite = Math.min(1, (v + 2.2 * Math.abs(b.thr) * sternWet) / 3.2) * (0.15 + 0.85 * sternWet);
  const wmax = Math.min(T.turn, T.latG / Math.max(v, 1)), want = b.rud * wmax * bite * (b.vf < -0.3 ? -1 : 1);
  b.wh += (want - b.wh) * Math.min(1, dt * (wet > 0.05 ? 3.4 : 0.15));
  b.wr += (-b.wh * b.vf * T.bank * 9 / Math.max(S.beam * 0.5, 0.5)) * dt * wet;      // a planing hull leans into its turn (a displacement hull out of it)
  b.vx += (af * c + al * s) * dt; b.vy += (af * s - al * c) * dt;
  // the hull's sideways slide in a turn: its speed follows the bow only as fast as the water grips
  b.h += b.wh * dt; b.x += b.vx * dt; b.y += b.vy * dt;
  b.pitch += b.wp * dt; b.roll += b.wr * dt; if (b.pitch > 0.9) { b.pitch = 0.9; b.wp = Math.min(b.wp, 0); } if (b.pitch < -0.7) { b.pitch = -0.7; b.wp = Math.max(b.wp, 0); }
  if (Math.abs(b.roll) > 0.85) { b.roll = Math.sign(b.roll) * 0.85; b.wr = 0; }
  if (b.air > 0) { b.wp -= b.pitch * 0.6 * dt; b.wr -= b.roll * 1.2 * dt; }      // in the air a boat settles toward level (it is heavy aft; kept gentle)
  b.wet = wet; b.sternWet = sternWet;
}
export function stepBoat(b, dt, inp, env) {
  if (!(dt > 0)) return b;      /* lead, Nov 18: a frame with no time passed (two frames on one clock tick, seen on MacBooks) divided 0 by 0 below; the boat's place became not-a-number and the river's draw threw on every frame after (perf 02:51) */
  b.ev = null; b.slam = Math.max(0, b.slam - dt * 2); const n = Math.max(1, Math.ceil(dt / (1 / 120))); for (let i = 0; i < n; i++) sub(b, dt / n, inp, env); return b;
}
