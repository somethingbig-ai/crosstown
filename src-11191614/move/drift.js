// move/drift.js: handbrake drifts for the car the PLAYER drives (driving lane, Nov 16; Matt, #nyc: "The handbrake isn't really realistic. It's hard
// to drift. Drifting should be satisfying and doable."). OFF SWITCH: ?drift=0 (this file is then not fetched and every car is as before);
// game.drift.on = false does the same while the game runs. ?driftfx=0 keeps the driving and leaves out smoke, skid marks and the camera swing.
//
// WHAT WAS WRONG: the handbrake took 5.5 m/s2 off the car and dropped its side grip, but the moment the lever was let go the full grip came back
// (the slide ended within a tenth of a second), the turn rate stayed tied to the front wheels (nothing to catch or hold), and above 30 km/h the
// front wheels steered against the slide by themselves. A slide could be started and never kept.
//
// WHAT IT IS NOW: Space (pad A) with the wheel turned, above 16 km/h, kicks the tail out. From there the car is in a slide until it is straight
// again, lever held or not:
//   - lever held: the car turns as fast as its class allows and scrubs speed sideways (a handbrake turn: a right-angle corner from 50 km/h);
//   - lever let go, wheel kept into the turn, power on: the slide HOLDS, for as long as the player likes (about 35 degrees in an ordinary car,
//     39 in the sports car; less with less stick or less pedal). Most of the speed is kept while the power is on. A dab of the lever adds angle;
//   - wheel straight: the car keeps pointing where it points and its path comes round to that within about a second, on the power or off it
//     (the way out of a corner: let go of the wheel when the nose points down the new street);
//   - wheel against the slide: the nose swings back to the path in about half a second and the car grips again;
//   - no snap the other way and no spin: the angle has a ceiling.
// PER CLASS (cars.js's class of the car, or its size when ?cars=0): LOOSE below. The sports car is the loosest (60 degrees, quick to rotate),
// ordinary cars 50, the SUV and pickup 38, a van 28 and no hold. The truck and the bus are left on the game's own lever (TUNE.minLoose): they step out a
// little there already, and a real slide in a 7 m truck or a 12 m bus put it into the parked row (seen in a browser, Nov 17).
//
// WHERE IT SITS: its line in game.js comes after handling.js's and before cars.js's, so it wraps handling's step and cars.js wraps this: what
// arrives is the per-kind v.spec and cars.js's substitute pedals. While a slide is on, this file moves the car and the step below is not run
// (walls, poles, parked cars and crash damage are still the lead's own code: the step below over no time, as handling.js does it). Outside a
// slide everything goes straight through, to the digit. ONLY the car the player drives with keys or a pad: the same list of exclusions as
// handling.js (traffic, parked and loose cars, the autopilot, wrecks, patrol cars, the ambulance, the fire engine, motorcycles).
// FOR OTHERS: game.drift = { on, TUNE, LOOSE, state(v) -> { on, angle (rad, + = nose left of travel), k (0..1 how hard it slides) } }; v.slip is
// the sideways speed in a slide, as before (the tyre squeal in sfx/ already follows it).
import { fcOf, fcDrive, fcDrag } from './fastcars.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// how loose each class is, 0..1
export const LOOSE = { sport: 1, hatch: 0.86, sedan: 0.8, taxi: 0.78, suv: 0.58, pickup: 0.58, van: 0.4, truck: 0.26, bus: 0.1 };
// vIn: the slide starts above this, m/s. vOut: it ends under this. steerIn: how much wheel the kick needs. aLo, aHi: side grip in a slide, m/s2, under
// vLo and over vHi m/s. stiff: side grip per m/s of side speed before it reaches that (1/s). kick: how fast the lever turns the car, rad/s (loosest
// class). track: how fast the angle goes to the one asked for with the lever off, 1/s (catch: wheel against the slide; ease: a little extra
// straightening with the wheel straight). nat: the angle a held slide sits at with the wheel into the turn and the pedal down, rad (loosest). max, maxLo: the angle's ceiling, loosest and stiffest class. keep0, keepT: the share of the speed a slide
// would scrub that is given back: always, and more with the pedal. hbDec: what the lever takes off along the car, turning / straight. spinK: how
// much pull is lost to wheelspin at a full angle. out: the angle under which the slide is over, rad. resp: how fast the car's turn rate follows, 1/s
// (loosest, stiffest). wet: the share of the slide's side grip a wet road takes (slides run longer and wider in the rain).
export const TUNE = { vIn: 4.5, vOut: 2.4, steerIn: 0.15, aLo: 13, aHi: 9, vLo: 12, vHi: 28, stiff: 6, kick: 2.7, track: 2.6, nat: 0.68, max: 1.05, maxLo: 0.21, keep0: 0.42, keepT: 0.5, hbDec: 1.8, hbDec0: 5.5, spinK: 0.25, spinUp: 0, gripUp: 0.35, out: 0.075, resp: 11, respLo: 3, respOut: 16, wet: 0.2, minLoose: 0.3, ease: 0, catch: 3.6, holdMin: 0.45 };
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: false };
const _TSQ = (() => { try { const q = new URLSearchParams(location.search).get('topspeed'); return q === '0' ? 0 : 1; } catch (e) { return 0; } })();     // the lead's top-speed change of Nov 16 (handling.js has the same line)

const classBySize = (def) => { const t = def && def.type; if (LOOSE[t] !== undefined) return t; if (!def) return 'sedan'; return def.len > 9 ? 'bus' : def.len > 6.4 ? 'truck' : def.hgt > 1.9 ? 'van' : def.hgt > 1.6 ? 'suv' : def.hgt < 1.3 ? 'sport' : 'sedan'; };
export function looseOf(g, v) { let c = null; try { c = g && g.cars && g.cars.classOf ? g.cars.classOf(v) : null; } catch (e) {} if (!c || LOOSE[c] === undefined) c = classBySize(v.def); return LOOSE[c] === undefined ? LOOSE.sedan : LOOSE[c]; }
const fresh = () => ({ on: false, st: 0, sig: 0, k: 0, cam: 0, t: 0, n: 0 });

// one step of a car in a slide. D: game.drift; v: the Vehicle; inp: what cars.js (or the game) hands down; below: the step this file wraps.
export function slide(D, v, dt, inp, g, below) {
  const T = D.TUNE, S = v._dr, L = S.L, sp = v.spec, hb = !!inp.handbrake, thr = clamp(inp.throttle || 0, 0, 1), brk = clamp(inp.brake || 0, 0, 1);
  const c = Math.cos(v.h), s = Math.sin(v.h), wet = g.rain && g.rain.wet > 0 ? Math.min(1, g.rain.wet) : 0;     // the progress lane's rain: how wet the road is, 0..1
  let vf = v.vx * c + v.vy * s, vl = -v.vx * s + v.vy * c, r = v.yawV || 0;     // forward, LEFTWARD, yaw rate (left is +)
  const sig0 = Math.atan2(-vl, Math.max(vf, 0.5)), spd0 = Math.hypot(vf, vl);     // the slide's angle: + = nose left of the way the car is going
  const th0 = Math.atan2(v.vy, v.vx);
  // the wheel: a key bites at once and reaches full in about a tenth of a second; a stick is its own hand
  const want = clamp(inp.steer || 0, -1, 1); S.st += (want - S.st) * (1 - Math.exp(-dt * (Math.abs(want) < Math.abs(S.st) ? 18 : 12)));
  const st = S.st, dir = sig0 >= 0 ? 1 : -1, into = Math.max(0, st * dir), against = Math.max(0, -st * dir);
  // ---- along the car: the lead's formulas (game.js Vehicle.step), with the lever's own drag and some pull lost to wheelspin at an angle
  let acc = 0; const tsOn = _TSQ && thr > 0 && vf > 0, tsTop = sp.top * (_TSQ ? 1.15 : 1);
  const fc = fcOf(v, inp, g);     /* gameplay lane, Nov 18: quicker cars (move/fastcars.js; ?fastcars=0) */
  if (thr > 0) acc += (fc ? fcDrive(fc, v, vf, thr) : thr * sp.acc * Math.max(0, 1 - (vf / tsTop) ** 2) * (vf < 8 ? 1.15 : 1)) * (1 - (T.spinK + T.spinUp * clamp((L - 0.8) / 0.2, 0, 1)) * Math.min(1, Math.abs(Math.sin(sig0)) * 1.3));     /* the loosest cars spin their wheels more at an angle: the sports car's power does not carry it wide out of a corner */
  acc -= fc ? fcDrag(fc, vf, thr, brk) : (tsOn ? 0.05 : 0.12) * vf + (tsOn ? 0.0012 : 0.0042) * vf * Math.abs(vf) + (thr === 0 && brk === 0 ? Math.sign(vf) * 0.5 : 0);
  vf = Math.max(0, vf + acc * dt);
  // the brake pedal and the lever slow the car along the way it is GOING, not along the way it points: a braked car in a slide loses its sideways speed with
  // its forward speed (taken off the forward part only, a hard brake left the car crabbing sideways at a right angle to its nose)
  { const dec = (brk > 0 ? 15 * brk : 0) + (hb ? lerp(T.hbDec0, lerp(T.hbDec0, T.hbDec, Math.min(1, L * 1.5)), Math.min(1, Math.abs(st) * 1.5)) : 0);
    if (dec > 0) { const sp0 = Math.hypot(vf, vl); if (sp0 > 1e-6) { const k = Math.max(0, sp0 - dec * dt) / sp0; vf *= k; vl *= k; } acc -= dec; } }
  // ---- across the car: the tyres push against the side speed, up to the slide's grip; part of what that scrubs off is given back
  const aCap = lerp(T.aLo, T.aHi, clamp((spd0 - T.vLo) / (T.vHi - T.vLo), 0, 1)) * lerp(0.8, 1, L) * (1 + T.gripUp * clamp((L - 0.8) / 0.2, 0, 1)) * (1 - T.wet * wet), spd1 = Math.hypot(vf, vl);     /* the loosest class has the tyres to match its speed: its path comes round as tightly as an ordinary car's although it carries more speed through the slide */
  vl += clamp(-vl * (1 - Math.exp(-dt * T.stiff)), -aCap * dt, aCap * dt);
  { const spd2 = Math.hypot(vf, vl), keep = hb ? T.keep0 : T.keep0 + T.keepT * thr; if (spd2 > 0.5 && spd2 < spd1) { const k = (spd2 + (spd1 - spd2) * keep) / spd2; vf *= k; vl *= k; } }
  // how fast the way the car is going has just turned (the turn rate at which the angle would stay as it is)
  const wx = vf * c - vl * s, wy = vf * s + vl * c, om = wrapPi(Math.atan2(wy, wx) - th0) / dt, spd = Math.hypot(vf, vl);
  // ---- the angle the player is asking for
  const max = lerp(T.maxLo, T.max, L), hold = clamp((L - T.holdMin + 0.15) / 0.15, 0, 1);     // the heavy classes cannot hold a slide on the power
  let dsig, settle = false;
  if (hb) {     // the lever: the wheel turns the car, fast; no wheel, the tail drifts back slowly
    dsig = st * T.kick * lerp(0.3, 1, L) * clamp(spd0 / 7, 0.45, 1) + (Math.abs(st) < 0.1 ? -sig0 * 0.8 : 0);
  } else {
    const nat = T.nat * lerp(0.55, 1, L) * hold, tgt = dir * Math.min(max, nat * into * (0.45 + 0.55 * thr));
    // wheel into the turn: the angle is held (the car keeps turning with the slide). Wheel straight: the car keeps pointing where it points and the
    // tyres pull its path round to that (the way out of a corner). Wheel against: the nose is brought back to the path, quickly.
    const w = clamp(into / 0.25, 0, 1), wa = clamp(against / 0.25, 0, 1);
    dsig = lerp(lerp(-om - sig0 * T.ease, -sig0 * T.catch, wa), (tgt - sig0) * T.track, w);
    settle = w < 0.5;     // the lever is off and the wheel is not into the turn: even a heavy car stops turning promptly (it does not go on round past where the player let go)
  }
  // the ceiling: no spin
  if (Math.abs(sig0) > max * 0.85 && dsig * dir > 0) dsig *= clamp((max - Math.abs(sig0)) / (max * 0.15), 0, 1);
  if (Math.abs(sig0) > max) dsig += (dir * max - sig0) * 6;
  r += (om + dsig - r) * (1 - Math.exp(-dt * Math.max(lerp(T.respLo, T.resp, L), settle ? T.respOut : 0)));
  // ---- move
  v.yawV = r; v.h = wrapPi(v.h + r * dt); v.vx = wx; v.vy = wy; v.x += wx * dt; v.y += wy * dt;
  // ---- walls, poles, parked cars, crash damage: the lead's own code (the step below over no time does nothing but that part)
  const vx0 = v.vx, vy0 = v.vy, roll0 = v.roll, pitch0 = v.pitch, z0 = v.z, spin0 = v.spin, hitT0 = v.hitT, steer0 = v.steer;
  below.call(v, 1e-9, NEUTRAL, g);
  if (v.vx !== vx0 || v.vy !== vy0) { const d = Math.hypot(v.vx - vx0, v.vy - vy0); if (d > 0.05) v.yawV *= Math.max(0.3, 1 - d * 0.15); }     // a hit takes spin out of the car too
  v.hitT = Math.max(0, (v.hitT > hitT0 ? v.hitT : hitT0) - dt);
  const c2 = Math.cos(v.h), s2 = Math.sin(v.h); v.vf = v.vx * c2 + v.vy * s2; v.vs = v.vx * s2 - v.vy * c2;
  const sig = Math.atan2(v.vs, Math.max(v.vf, 0.5)), sNow = Math.hypot(v.vx, v.vy);
  // the front wheels as drawn: along the way the car is going, plus the hand
  v.steer = steer0 + (clamp(st * 0.3 - sig * 0.85, -0.62, 0.62) - steer0) * Math.min(1, dt * 16);
  v.acc = acc; v.braking = brk > 0.03 || hb; v.slip = Math.abs(v.vs) * 1.15 + (hb ? 1 : 0);
  v.spin = spin0 + ((hb ? 0.15 : thr > 0.3 ? 1.5 : 1) * v.vf * dt) / v.def.radius;     // locked rears, or spinning up on the power (all four wheels turn as one in this game)
  // ---- the body: the base step's lines (cars.js lays its lean, dive and kerb heave over these)
  const onWalk = g.statics.onSidewalk(v.x, v.y); v.z = z0 + ((onWalk ? 0.15 : 0) - z0) * Math.min(1, dt * 14);
  v.roll = roll0 + (clamp(v.vf * v.yawV * 0.0065 + sig * 0.03, -0.085, 0.085) - roll0) * Math.min(1, dt * 6);
  v.pitch = pitch0 + (clamp(acc * 0.0042, -0.045, 0.045) - pitch0) * Math.min(1, dt * 6);
  S.sig = sig; S.k = clamp((Math.abs(v.vs) - 0.8) / 4.5, 0, 1); S.t += dt;
  // ---- over? straight again with the lever off, or too slow, or going backwards
  if (hb && Math.abs(sig) < T.out) S.calm = (S.calm || 0) + dt; else if (!hb && Math.abs(sig) < T.out) S.calm = (S.calm || 0) + dt * 4; else S.calm = 0;
  if (sNow < T.vOut || v.vf < 0.3 || (!hb && S.calm > 0.2) || (hb && S.calm > 0.6 && Math.abs(st) < 0.1)) { S.on = false; S.calm = 0; S.st = 0; }
}

export function install(g, Vehicle) {
  if (!Vehicle || !Vehicle.prototype || g.drift) return g.drift;
  const below = Vehicle.prototype.step;
  const D = { on: true, TUNE, LOOSE, below, n: 0, slides: 0, err: null, car: null, fx: null };
  D.state = (v) => { const S = v && v._dr; return S ? { on: S.on, angle: S.on ? S.sig : 0, k: S.on ? S.k : 0, t: S.t } : { on: false, angle: 0, k: 0, t: 0 }; };
  g.drift = D;
  Vehicle.prototype.step = function (dt, inp, gg) {
    const S = this._dr;
    // not the player's own car on keys or a pad (inp.lock is set only by readInput for a human driver; cars.js keeps it set in its substitute): the step below, untouched
    if (!D.on || D.err || !inp || inp.lock === undefined || !gg || !gg.player || this !== gg.player.vehicle || this.moto || this.patrol || this.ems || this.heat || this.drive || this.wreck || !(dt > 0)) { if (S) S.on = false; return below.call(this, dt, inp, gg); }
    if (!S || !S.on) {
      // the kick: the lever, some wheel, and enough speed forward
      if (!inp.handbrake || Math.abs(inp.steer || 0) < D.TUNE.steerIn) return below.call(this, dt, inp, gg);
      const c = Math.cos(this.h), s = Math.sin(this.h), vf = this.vx * c + this.vy * s; if (vf < D.TUNE.vIn) return below.call(this, dt, inp, gg);
      const L0 = looseOf(gg, this); if (L0 < D.TUNE.minLoose) return below.call(this, dt, inp, gg);     /* the bus: its lever is the game's own, as before (in a browser the slide took a 12 m bus 6 m wide into the parked row at 40 km/h, where the old lever got it round clean: Nov 17) */
      const N = this._dr || (this._dr = fresh()); N.on = true; N.t = 0; N.calm = 0; N.st = 0; N.L = L0; N.n++; D.slides++; D.car = this;
    }
    try { slide(D, this, dt, inp, gg, below); D.n++; D.car = this; }
    catch (e) { D.err = String(e && e.stack || e); console.warn('[drift] off after an error: ' + D.err); this._dr.on = false; return below.call(this, dt, inp, gg); }
  };
  // ---- the camera swings a little into the slide: it looks more the way the car is going than the way it points, so the car is seen at its angle
  if (!(g.P && g.P.get('driftfx') === '0') && typeof g.camTarget === 'function') {
    const cam0 = g.camTarget.bind(g); let sw = 0, last = -1;
    g.camTarget = function () { const t = cam0(); try { const v = g.player && g.player.vehicle, S = v && v._dr, want = D.on && S && S.on ? S.sig : 0;
      if (g.frame !== last) { const n = last < 0 ? 1 : clamp(g.frame - last, 1, 6); last = g.frame; sw += (want - sw) * (1 - Math.exp(-n / 60 * (Math.abs(want) > Math.abs(sw) ? 3.5 : 2.2))); if (Math.abs(sw) < 1e-4 && !want) sw = 0; }
      if (sw && v) { t.yaw = wrapPi(t.yaw - sw * 0.42); t.fov += Math.min(1, Math.abs(sw) / 0.6) * 6; t.dist += Math.min(1, Math.abs(sw) / 0.6) * 0.9;     /* a little wider and further back in a slide: room to see where it is heading */ t.auto = Math.max(t.auto || 0, 5.5); } } catch (e) {}
      return t; };
  }
  // ---- smoke and skid marks (browser only; fetched once, after the first frame, so the game's start does not wait on it)
  if (!(g.P && g.P.get('driftfx') === '0') && g.world && g.world.scene && g.world.renderer && typeof window !== 'undefined' && typeof requestAnimationFrame === 'function' && g.world.renderer.getContext)
    import('./driftfx.js').then((m) => { D.fx = m.install(g, D); }).catch((e) => { console.log('[drift] effects not loaded: ' + (e && (e.stack || e.message))); });
  return D;
}
