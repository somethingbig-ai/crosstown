// move/handling.js: how the car the PLAYER is driving steers and grips (gameplay lane, Nov 15; 19 player reports: "floaty", "turns too sharp when
// slow, too dull when fast", "pivots like a box", "a tap turns too much"). OFF SWITCH: ?handling=0 (this file is then not loaded and the car is the
// live one to the digit); game.handling.on = false does the same while the game runs.
//
// WHERE IT SITS: under the progress lane's cars.js. This file wraps Vehicle.prototype.step first (its line in game.js comes before theirs), cars.js
// wraps this. So what arrives here is what cars.js hands the base step: their per-kind v.spec (top, acc, grip, damage included) and, for a human
// driver of any class but the plain sedan, their SUBSTITUTE input (pedal lag, launch share, brake bite already applied). Their body lean and dive
// overlay, kerb heave, flat tyres, fire and wreck rules are theirs and are not touched: this file leaves v.roll, v.pitch and v.z exactly as the base
// step would compute them, so their overlay sits on the same thing as before.
// NO KIND TABLE HERE. Every per-kind number is worked out from theirs: v.spec.grip against the base sedan's, v._ck.H.lock (their "how much lateral g
// a full key gets"), v._ck.H.turn (their wheel lag, per second) and the model's own wheelbase. Change a class in cars.js and this follows.
// ONLY the car the player drives with keys or a pad runs it. Traffic, parked and loose cars, the autopilot (?demo), wrecks, patrol cars, the
// ambulance and fire engine, and motorcycles go straight to the step below, untouched (lanes/gameplay/handling-state/tools/aicheck.mjs).
//
// THE MODEL: two axles. Each axle's tyres push against that axle's own sideways slip, stiffly up to its grip and no further (past the limit the
// force stays; no cliff). The rear follows the front, so at low speed the car pivots on its rear axle; fronts run out first when pushed; lift or
// brake mid-turn moves weight forward; the handbrake takes most of the rear's grip. Arcade help: a held key asks for as much lock as the front
// tyres can use at that speed, the wheel turns at a hand's rate (a tap is a small correction), the front wheels ease toward a slide of the tail.
// Along the car (pull, brakes, drag, top speed) and walls, poles and parked cars: the lead's own formulas and the lead's own collision code.
import { fcOf, fcDrive, fcDrag } from './fastcars.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// the plain car's numbers (the base sedan); every other kind is these, moved by cars.js's own class numbers in numbers() below.
// aLat: grip above about 70 km/h, m/s2 sideways with all four tyres at the limit. lowK, lowMax: town grip (under 40 km/h) = aLat * lowK, at most lowMax.
// lock: full lock, rad. cs: slip angle at which a tyre reaches its limit, rad. ki: yaw inertia (1 = the weight out at the axles). bal: rear grip over front.
// pw: share of grip full power takes. lt, ltMax: weight moved per m/s2 of braking. hb: rear grip left on the handbrake. assist: how much of the tail's
// slide the front wheels follow. on, on2: seconds for a held key to reach full lock at a crawl / at 100 km/h. bite: the share of the lock that comes at once.
// back: seconds for the wheel to centre when the key is let go. hbG: share of the grip left under the car while the handbrake is on (so a handbrake turn
// goes round instead of scrubbing to a stop). ltUp: extra weight transfer per unit of cars.js lock above 1 (the sports car's tail is a little livelier).
export const TUNE = { aLat: 14, lowK: 1.5, lowMax: 21, lock: 0.63, cs: 0.04, ki: 0.6, bal: 1.12, pw: 0.08, lt: 0.009, ltMax: 0.10, hb: 0.30, assist: 0.80, on: 0.12, on2: 0.20, bite: 0.25, back: 0.035, hbG: 0.8, ltUp: 0.08, rcs: 0.6, scrub: 0, scrubV: 11, townLo: 13.9, townHi: 15.3, townMin: 8, hbV: 8.3, tapOn: 0.25, tap0: 0.3 };
const STEER_KEYS = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'];
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: false };

// this car's numbers from cars.js's (gl = their H.lock, turn = their H.turn, gr = v.spec.grip over the base sedan's). With ?cars=0 there is no v._ck:
// gl 1, turn 0, and v.spec is game.js's own SPEC line for the kind.
export function numbers(H, v, S) {
  const ck = v._ck && v._ck.H, gl = ck && ck.lock > 0 ? ck.lock : 1, turn = ck && ck.turn > 0 ? ck.turn : 0, gr = clamp((v.spec.grip || H.baseGrip) / H.baseGrip, 0.4, 1.6);
  if (S.k && S.kgl === gl && S.kturn === turn && S.kgr === gr) return S.k;
  const T = H.TUNE, up = Math.max(0, gl - 1), heavy = turn ? 1 / turn : 0, aLat = T.aLat * Math.sqrt(gr * gl);
  S.kgl = gl; S.kturn = turn; S.kgr = gr;
  return (S.k = { aLat, aLow: Math.min(T.lowMax, aLat * T.lowK), lock: T.lock * Math.sqrt(Math.min(1, gl)), cs: T.cs / (1 + up) ** 1.5 + 0.2 * heavy, ki: clamp(T.ki - 0.4 * up + 2.7 * heavy, 0.5, 1),
    bal: T.bal + 0.6 * heavy, pw: T.pw, lt: T.lt + T.ltUp * up, ltMax: T.ltMax + 0.25 * up, hb: T.hb - 0.33 * up + 0.5 * heavy, assist: Math.min(0.9, T.assist + heavy), on: T.on, on2: T.on2, turn });
}

// one step of the player's car. v: the Vehicle; inp: what cars.js (or the game) hands the base step; cmd: steering asked for, -1..1 (left is +).
/* lead, Nov 16 (Matt: 'top speed of the cars and the motorbike is too slow'): with the pedal down the air drag is cut and the top-speed term raised, so a sedan runs out at about 119 km/h (was 77), the sports car 224 (141), the motorbike 198 (130); off the pedal the old drag stands, so lift-off, braking and cornering are as they were. ?topspeed=0 = as it was; off on the public site unless ?topspeed=1. */
const _TSQ = (() => { try { const q = new URLSearchParams(location.search).get('topspeed'); return q === '0' ? 0 : q ? 1 : 1; } catch (e) { return 0; } })();
export function drive(H, v, dt, inp, g, cmd, byKey) {
  const S = v._hd || (v._hd = { sm: 0, sw: 0, as: 0, ax: 0, satF: 0, satR: 0, alat: 0, br: 0 });
  const K = numbers(H, v, S), T = H.TUNE, sp = v.spec, wb = v.def.wheelbase || 2.7, a = wb * 0.5;     // axles half a wheelbase either side of the car's origin
  const c = Math.cos(v.h), s = Math.sin(v.h);
  let vf = v.vx * c + v.vy * s, vl = -v.vx * s + v.vy * c, r = v.yawV || 0;     // forward, LEFTWARD, yaw rate (left is +)
  const av = Math.abs(vf), hb = !!inp.handbrake, spd = Math.hypot(vf, vl), aG = lerp(K.aLow, K.aLat, clamp((spd - 11) / 9, 0, 1)) * (hb ? T.hbG : 1), ki = lerp(Math.min(K.ki, 0.38 + 0.25 * (K.ki - 0.55)), K.ki, clamp((av - 8) / 8, 0, 1));     /* town grip and a car eager to rotate under 40 km/h; open-road grip and its full weight in yaw by 72 */
  // ---- along the car: the lead's formulas, unchanged (game.js Vehicle.step)
  let acc = 0;
  const tsOn = _TSQ && inp.throttle > 0 && vf > 0, tsTop = sp.top * (_TSQ ? 1.15 : 1);
  const fc = fcOf(v, inp, g);     /* gameplay lane, Nov 18: quicker cars (move/fastcars.js; ?fastcars=0) */
  if (inp.throttle > 0) acc += vf < -0.5 ? 16 * inp.throttle : fc ? fcDrive(fc, v, vf, inp.throttle) : inp.throttle * sp.acc * Math.max(0, 1 - (vf / tsTop) ** 2) * (vf < 8 ? 1.15 : 1);
  if (inp.brake > 0) { if (vf > 0.6) acc -= 15 * inp.brake; else acc -= inp.brake * sp.acc * 0.6 * Math.max(0, 1 + vf / 11); }
  acc -= fc ? fcDrag(fc, vf, inp.throttle, inp.brake) : (tsOn ? 0.05 : 0.12) * vf + (tsOn ? 0.0012 : 0.0042) * vf * Math.abs(vf) + (inp.throttle === 0 && inp.brake === 0 ? Math.sign(vf) * 0.5 : 0);
  if (hb) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 5.5);
  if (T.scrub && vf > 2) acc -= T.scrub * Math.abs(S.sw) * clamp((T.scrubV - av) / 3, 0, 1);
  vf += acc * dt;
  S.ax += (acc - S.ax) * (1 - Math.exp(-dt * 9));     // what the tyres' loads feel (a little behind the pedal)
  // ---- grip at each axle now
  const shift = clamp(-S.ax * K.lt, -0.12, K.ltMax);     // braking: + (weight forward)
  let capF = 0.5 * aG * (1 + 0.5 * shift), capR = 0.5 * aG * K.bal * (1 - shift);
  if (inp.throttle > 0 && vf > -0.5) { const u = fc ? fcDrive(fc, v, vf, inp.throttle) / fc.aT : inp.throttle * Math.max(0, 1 - (vf / tsTop) ** 2), cut = 1 - 0.5 * K.pw * u * u; capF *= cut; capR *= cut; }
  if (inp.brake > 0 && vf > 0.6) { const b = Math.min(1, inp.brake); capF *= 1 - 0.10 * b; capR *= 1 - 0.10 * b; }
  if (hb) capR *= K.hb;
  // ---- the wheel: a key is a hand turning it; the most it asks for is what the fronts can use at this speed
  const up = lerp(K.on, K.on2, clamp(av / 28, 0, 1));
  if (byKey) { const back = Math.abs(cmd) < Math.abs(S.sm) || cmd * S.sm < 0, rate = back ? 1 / T.back : Math.abs(S.sm) < T.bite ? 16 : (1 - T.bite) / up;     /* the first part of the lock bites at once (no felt delay), the rest at a hand's rate (a tap stays a small correction) */ S.sm += clamp(cmd - S.sm, -rate * dt, rate * dt); }
  else { const want = Math.sign(cmd) * Math.abs(cmd) ** 1.5; S.sm += (want - S.sm) * (1 - Math.exp(-dt * 16)); }     // a stick is its own hand: finer near the middle, hardly any lag
  if (K.turn) S.sw += (S.sm - S.sw) * (1 - Math.exp(-dt * K.turn * 1.6)); else S.sw = S.sm;     // cars.js's wheel lag for the heavy kinds (their H.turn)
  const useLat = 2 * Math.min(capF, 0.5 * aG) * 1.06, full = Math.min(K.lock + 0.05 * (1 - clamp((av - 2.5) / 4, 0, 1)) /* a little more lock at parking pace */, Math.atan(useLat * wb / Math.max(vf * vf, 1)) + (av > 6 ? K.cs * 0.5 : 0));
  // the tail is sliding: ease the front wheels toward the way the rear is really going
  const br = av > 2.5 && vf > 0 ? Math.atan2(vl - r * a, av) : 0, wantAs = Math.abs(br) > 0.035 ? clamp((br - Math.sign(br) * 0.035) * K.assist * (hb ? 0.25 : 1), -0.5, 0.5) : 0;
  S.as += (wantAs - S.as) * (1 - Math.exp(-dt * 14));
  if (!hb && !(cmd * r > 0 && Math.abs(cmd) > 0.3)) capF *= 1 - 0.6 * clamp((Math.abs(br) - 0.2) / 0.4, 0, 1);     // a big slide the player is not feeding: the nose stops pulling the car round, so the rear can bring it back
  const delta = clamp(S.sw * full * (hb ? 1.5 : 1) + S.as, -K.lock * 1.25, K.lock * 1.25);
  // ---- tyres: each axle pushes against its own sideways slip, up to its grip
  const cd = Math.cos(delta), sd = Math.sin(delta);
  const uf = -sd * vf + cd * (vl + r * a), lf = Math.abs(cd * vf + sd * (vl + r * a)), k2 = a * a * ki, mf = 1 + cd * cd / ki, mr = 1 + 1 / ki;
  let jf = -uf * (1 - Math.exp(-dt * (capF / K.cs) * mf / (lf + 1.5))) / mf; const mF = capF * dt; S.satF = Math.abs(jf) / mF; jf = clamp(jf, -mF, mF);
  vf += -sd * jf; vl += cd * jf; r += a * cd * jf / k2;
  const ur = vl - r * a;     // the rear answers what the front has just done (stiffer than the front: the tail follows, it does not wag)
  let jr = -ur * (1 - Math.exp(-dt * (capR / (K.cs * T.rcs)) * mr / (av + 1.5))) / mr; const mR = capR * dt; S.satR = Math.abs(jr) / mR; jr = clamp(jr, -mR, mR);
  vl += jr; r -= a * jr / k2; S.br = br; S.alat = (cd * jf + jr) / dt;
  // ---- move
  v.yawV = r; v.h = wrapPi(v.h + r * dt);
  v.vx = vf * c - vl * s; v.vy = vf * s + vl * c; v.x += v.vx * dt; v.y += v.vy * dt;
  // ---- walls, poles, parked cars, crash damage: the lead's own code (Vehicle.step over no time does nothing but that part)
  const vx0 = v.vx, vy0 = v.vy, roll0 = v.roll, pitch0 = v.pitch, z0 = v.z, spin0 = v.spin, hitT0 = v.hitT;
  H.step0.call(v, 1e-9, NEUTRAL, g);
  if (v.vx !== vx0 || v.vy !== vy0) { const d = Math.hypot(v.vx - vx0, v.vy - vy0); if (d > 0.05) v.yawV *= Math.max(0.3, 1 - d * 0.15); }     // a hit takes spin out of the car too
  v.hitT = Math.max(0, (v.hitT > hitT0 ? v.hitT : hitT0) - dt);
  const c2 = Math.cos(v.h), s2 = Math.sin(v.h); v.vf = v.vx * c2 + v.vy * s2; v.vs = v.vx * s2 - v.vy * c2;
  v.steer = delta; v.acc = acc; v.braking = inp.brake > 0.03 || hb; v.slip = Math.max(Math.abs(uf) * (S.satF >= 1 ? 1.6 : 1), Math.abs(ur) * (S.satR >= 1 ? 1.6 : 1));
  v.spin = spin0 + (v.vf * dt) / v.def.radius;
  // ---- the body: exactly the base step's lines (cars.js lays its lean, dive and kerb heave over these)
  const onWalk = g.statics.onSidewalk(v.x, v.y); v.z = z0 + ((onWalk ? 0.15 : 0) - z0) * Math.min(1, dt * 14);
  v.roll = roll0 + (clamp(v.vf * v.yawV * 0.0065, -0.07, 0.07) - roll0) * Math.min(1, dt * 6);
  v.pitch = pitch0 + (clamp(acc * 0.0042, -0.045, 0.045) - pitch0) * Math.min(1, dt * 6);
}

export function install(g, Vehicle) {
  if (!Vehicle || !Vehicle.prototype || g.handling) return g.handling;
  let baseGrip = 8.5; try { baseGrip = new Vehicle({ type: 'sedan' }, 0, 0, 0, 0).spec.grip || 8.5; } catch (e) {}
  const H = { on: true, TUNE, numbers: (v) => numbers(H, v, v._hd || (v._hd = { sm: 0, sw: 0, as: 0, ax: 0, satF: 0, satR: 0, alat: 0, br: 0 })), step0: Vehicle.prototype.step, baseGrip, n: 0, err: null };
  g.handling = H;
  Vehicle.prototype.step = function (dt, inp, gg) {
    // not the player's own car on keys or a pad (inp.lock is set only by readInput for a human driver; cars.js keeps it set in its substitute): the step below, untouched
    if (!H.on || H.err || !inp || inp.lock === undefined || !gg || !gg.player || this !== gg.player.vehicle || this.moto || this.patrol || this.ems || this.heat || this.drive || this.wreck || !(dt > 0)) { const S = this._hd; if (S) { S.sm = 0; S.sw = 0; S.as = 0; } return H.step0.call(this, dt, inp, gg); }
    // TOWN BLEND (Nov 15 evening): under about 50 km/h the car is the LIVE car, step for step (the new model needs 4.9 m across for a right-angle corner against live's 2.1 and failed the street-corner test);
    // the new model takes over above townHi (55 km/h) and hands back under townLo (50). A handbrake turn begun in the new model stays in it until the lever is let go (r3).
    { const T = H.TUNE, S = this._hd || (this._hd = { sm: 0, sw: 0, as: 0, ax: 0, satF: 0, satR: 0, alat: 0, br: 0 }), sp = Math.hypot(this.vx, this.vy), was = S.town !== false;
      const hbOn = !!inp.handbrake; S.town = T.townHi > 0 ? (was ? !(sp >= T.townHi || (hbOn && sp > T.hbV)) : !hbOn && (sp < T.townMin || (sp < T.townLo && Math.abs(S.sm) < 0.25))) : false;     /* the handbrake above 30 km/h goes to the new model (the turn goes round); a wheel held over keeps the new model down to 29 km/h (no jump in turn rate when braking in a bend) */
      if (S.town) { S.sm = 0; S.sw = 0; S.as = 0;
        // SOFT TAP (r4, town only, keys only): the live car's lock is scaled by how long the steering key has been held, tap0 at once, full by tapOn seconds; a held key reaches the same lock,
        // the same turn rate and the same circle. Let go, the count runs down twice as fast, so feathering a key in a corner keeps most of the lock. tapOn 0 = off = r3.
        if (T.tapOn > 0) { const K = gg.keys, sg = K ? ((K.has('KeyA') || K.has('ArrowLeft')) ? 1 : 0) - ((K.has('KeyD') || K.has('ArrowRight')) ? 1 : 0) : 0;
          if (sg !== 0) { S.th = sg === S.tg ? (S.th || 0) + dt : dt; S.tg = sg; } else S.th = Math.max(0, (S.th || 0) - 2 * dt);
          const f = sg !== 0 || S.th > 0 ? T.tap0 + (1 - T.tap0) * Math.min(1, S.th / T.tapOn) : 1;
          if (f < 1 && (sg !== 0 || Math.abs(inp.steer || 0) < 1e-6)) { const lk = inp.lock; inp.lock = lk * f; try { return H.step0.call(this, dt, inp, gg); } finally { inp.lock = lk; } } }
        return H.step0.call(this, dt, inp, gg); }
      if (was) { const k = numbers(H, this, S), f = clamp((this.steer || 0) / Math.max(0.02, Math.min(k.lock, Math.atan(k.aLat * (this.def.wheelbase || 2.7) / Math.max(sp * sp, 1)))), -1, 1); S.sm = f; S.sw = f; S.ax = this.acc || 0; } }
    try { const K = gg.keys; let byKey = false; if (K) for (const k of STEER_KEYS) if (K.has(k)) byKey = true; if (!byKey && Math.abs(inp.steer) < 1e-6) byKey = true;
      drive(H, this, dt, inp, gg, clamp(inp.steer || 0, -1, 1), byKey); H.n++; }
    catch (e) { H.err = String(e && e.stack || e); console.warn('[handling] off after an error: ' + H.err); return H.step0.call(this, dt, inp, gg); }
  };
  return H;
}
