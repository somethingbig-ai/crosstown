// move/fastcars.js: quicker cars with real top speeds (gameplay lane, Nov 18; player feedback through Matt: "cars are too slow. It takes 3-4 blocks to reach top
// speed and top is only ~60 mph. Make acceleration much punchier and raise top speed for normal cars (sports cars more)").
// OFF SWITCH: ?fastcars=0 = every number as before (game.fastcars.on = false does the same live, except the police chase speeds, which are read once).
//
// WHAT IT IS, for the car the PLAYER drives with keys or a pad (traffic, the autopilot, parked and loose cars are untouched):
//   - the pull is the tyres' up to about 30 mph (aT, m/s2) and the engine's power above it (P, m2/s3: pull = P / speed), so the car leaps off the line and still
//     pulls at 60 mph, where the old formula had almost nothing left;
//   - the top speed is where the air's drag meets the engine (worked out per class from `mph`); there is no cap;
//   - off the pedal the car slows as it did up to 72 km/h and no harder above it (the old lift-off drag would be 1.7 g at 115 mph);
//   - above 30 m/s the car's step is cut into pieces of at most half a metre of travel, so a wall or a parked car is not stepped through (install, below).
// Brakes, steering, grip, weight and the slide are not touched. The three places that push a car along (game.js Vehicle.step, move/handling.js above 50 km/h,
// move/drift.js in a handbrake slide) ask fcOf() / fcDrive() / fcDrag(); moto/motophys.js and combat/heatcore.js read FC.on for one number each.
export const FC = { on: (() => { try { return new URLSearchParams(location.search).get('fastcars') !== '0'; } catch (e) { return true; } })(), sub: 0.5, subV: 30, subMax: 4, n: 0 };
// per class: aT = pull off the line (m/s2), P = power per kg (m2/s3), mph = top speed. Classes are cars.js's; police = a patrol car with the player at the wheel.
export const FAST = {
  sedan:  { aT: 6.6, P: 80, mph: 116 }, taxi: { aT: 6.4, P: 80, mph: 113 }, hatch: { aT: 6.4, P: 78, mph: 111 },
  suv:    { aT: 6.2, P: 76, mph: 110 }, pickup: { aT: 5.8, P: 68, mph: 104 }, van: { aT: 5.6, P: 62, mph: 100 },
  truck:  { aT: 5.2, P: 38, mph: 82 }, bus: { aT: 5.0, P: 36, mph: 74 },
  sport:  { aT: 9.6, P: 140, mph: 172 }, police: { aT: 7.6, P: 104, mph: 142 },
};
const K1 = 0.02;
for (const k in FAST) { const N = FAST[k], top = N.mph * 0.44704; N.top = top; N.k2 = (N.P / top - K1 * top) / (top * top); }
// this car's numbers, or null when the old formulas stand (switch off, nobody or the autopilot at the wheel, a wreck)
export function fcOf(v, inp, g) {
  if (!FC.on || !inp || inp.lock === undefined || v.wreck || v.moto) return null;
  let N = v._fc; if (!N) { let name = v.patrol ? 'police' : v._ck ? v._ck.name : g && g.cars && g.cars.classOf ? g.cars.classOf(v) : v.type; if (v.def && /police|cruiser|patrol/.test(v.def.type || '')) name = 'police'; N = v._fc = FAST[name] || FAST.sedan; }
  return N;
}
// forward pull with the pedal at thr (0..1) at forward speed vf; cars.js's damage (black smoke: less power and top speed) carries through
export function fcDrive(N, v, vf, thr) { const K = v._ck, pw = K ? (K.pow || 1) * (K.topK < 1 ? K.topK * K.topK * K.topK : 1) : 1; return thr * Math.min(N.aT, (N.P * pw) / Math.max(vf, 1)); }
// what slows the car (signed with vf, to be subtracted): on the pedal the air and the tyres; off it, the old lift-off drag up to 20 m/s and only the air's share above
export function fcDrag(N, vf, thr, brk) {
  const av = Math.abs(vf), sg = vf < 0 ? -1 : 1;
  if (thr > 0 && vf > 0) return K1 * vf + N.k2 * vf * vf;
  const m = av < 20 ? av : 20;
  return sg * (0.12 * m + 0.0042 * m * m + K1 * (av - m) + N.k2 * (av * av - m * m)) + (thr === 0 && brk === 0 ? Math.sign(vf) * 0.5 : 0);
}
// the outermost step: a fast car moves in pieces, so that the three circles that keep it out of walls and parked cars cannot step over one
export function install(g, Vehicle) {
  if (!Vehicle || !Vehicle.prototype || g.fastcars) return g.fastcars;
  g.fastcars = FC; FC.FAST = FAST;
  const below = Vehicle.prototype.step;
  Vehicle.prototype.step = function (dt, inp, gg) {
    if (!FC.on || !inp || inp.lock === undefined || !(dt > 0)) return below.call(this, dt, inp, gg);
    const sp = Math.hypot(this.vx, this.vy); if (sp < FC.subV || sp * dt <= FC.sub) return below.call(this, dt, inp, gg);
    const n = Math.min(FC.subMax, Math.ceil((sp * dt) / FC.sub)), h = dt / n; FC.n++;
    for (let i = 0; i < n; i++) below.call(this, h, inp, gg);
  };
  return FC;
}
