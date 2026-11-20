// move/weight.js: the ordinary car gets WEIGHT (driving lane, Nov 17; CHIEF 15:10: "yours, the whole car feel ... 138 deg/s at 2.07 g at 30 km/h is far too much grip
// and yaw, so bring it toward real numbers (~0.8-0.9 g for a sedan) with weight transfer and less snap on the sports car"; players: "driving feels too floaty, no weight",
// "car fishtails in back while turning"). OFF SWITCH: ?weight=0 (this file is then not fetched and every car is as before); game.weight.on = false does the same live.
//
// WHAT WAS WRONG: a held key asked for as much wheel as 2 g of sideways grip would carry (20 m/s2 under 32 km/h), and the car simply had that grip, silently. A sedan
// pivoted at 138 degrees a second at 30 km/h. Nothing about it said "a ton and a half of car": no limit, no sound, no speed lost.
//
// WHAT IT IS NOW, for the car the PLAYER drives with keys or a pad, outside a handbrake slide (move/drift.js keeps those):
//   - GRIP like a car's: about 0.88 g for the ordinary sedan, a little more for the sports car, less for a van or a truck (worked out from cars.js's own class numbers,
//     as handling.js does). The wheel a held key gets is what that grip carries at the car's speed. At parking pace the full lock and the tight circle are unchanged.
//   - ASKING FOR MORE THAN THE TYRES HAVE costs speed: the fronts scrub (TUNE.scrub), so a car thrown at a corner too fast runs a little wide, slows, and then turns in,
//     instead of pivoting. The handbrake is the way to turn a fast corner tight, and it still is.
//   - YOU HEAR AND SEE THE LIMIT: v.slip (what the squeal, the smoke and the skid marks follow) rises as the sideways g nears the tyres' limit and when the fronts scrub.
//   - ABOVE 50 km/h (handling.js's model): the same grip (its TUNE.aLat, lowK, lowMax), and less of the weight thrown forward when the driver lifts or brakes in a bend
//     (ltUp, ltMax): the sports car's tail steps out a little instead of snapping.
// WHERE IT SITS: its line in game.js comes after drift.js's and before cars.js's: it wraps drift's step, cars.js wraps this. It changes the wheel angle and the grip limit
// handed down (inp.lock, inp.latLim) for one step and puts them back; it never moves the car itself except to take the scrubbed speed off. Traffic, parked and loose cars,
// the autopilot, wrecks, patrol cars, the ambulance, the fire engine and motorcycles go straight through, untouched.
// FOR OTHERS: game.weight = { on, TUNE, gOf(v) -> the car's grip in m/s2, state(v) -> { lat (sideways g now), limit (g), scrub (0..1) } }.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;

// g: the ordinary sedan's sideways grip, m/s2. gMin, gMax: the least and the most any class gets. hb: how much more wheel the lever allows (the game's own 1.5).
// scrub: speed taken off, m/s2, by a wheel held hard over well above vC (the speed a street corner is taken at, m/s; full by vC + vBand). townV: above this speed (m/s)
// the scrub fades to `fast` of itself and the pedal is no longer cut. holdUp: how fast a held wheel builds the scrub, 1/s. cut: the share of the pedal a full scrub takes in town.
// sq0, sq1: the share of the limit at which the tyres start to be heard and at which they squeal fully. sqMax: v.slip at a full squeal; sqScrub: more of it while scrubbing.
// wet: the share of the grip a wet road takes (town speeds; handling.js's model above 50 km/h is not changed for rain).
// lean, leanMax: extra body roll per m/s2 of sideways load, rad, and its most.
// hA, hLowK, hLowMax, hLtUp, hLtMax, hLt: handling.js's numbers while this is on (its own are put back when it is switched off).
export const TUNE = { g: 8.6, gMin: 6.2, gMax: 10.6, hb: 1.5, scrub: 5.0, vC: 6.9, vBand: 2.5, townV: 14.5, fast: 0.25, holdUp: 5, cut: 0.9, sq0: 0.74, sq1: 1.04, sqMax: 3.4, sqScrub: 2.4, lean: 0.0055, leanMax: 0.055, wet: 0.2, hA: 9.0, hLowK: 1.0, hLowMax: 9.6, hLtUp: 0.02, hLtMax: 0.04, hLt: 0.005 };
const H_KEYS = { aLat: 'hA', lowK: 'hLowK', lowMax: 'hLowMax', ltUp: 'hLtUp', ltMax: 'hLtMax', lt: 'hLt' };

export function install(g, Vehicle) {
  if (!Vehicle || !Vehicle.prototype || g.weight) return g.weight;
  const below = Vehicle.prototype.step;
  let baseGrip = 8.5; try { baseGrip = new Vehicle({ type: 'sedan' }, 0, 0, 0, 0).spec.grip || 8.5; } catch (e) {}
  const W = { on: true, TUNE, n: 0, err: null, hSaved: null };
  // this car's grip: the sedan's, moved by cars.js's own class numbers (v.spec.grip against the sedan's, and their "how much lateral g a full key gets")
  W.gOf = (v) => { const ck = v._ck && v._ck.H, gl = ck && ck.lock > 0 ? ck.lock : 1, gr = clamp(((v.spec && v.spec.grip) || baseGrip) / baseGrip, 0.4, 1.6); return clamp(W.TUNE.g * Math.sqrt(gr * gl), W.TUNE.gMin, W.TUNE.gMax); };
  W.state = (v) => { const S = v && v._wt; return S ? { lat: +(S.lat / 9.81).toFixed(2), limit: +(S.lim / 9.81).toFixed(2), scrub: +S.k.toFixed(2) } : { lat: 0, limit: 0, scrub: 0 }; };
  // handling.js's model above 50 km/h: the same grip, a calmer tail. Its own numbers are kept and put back when this is switched off.
  W.tuneHandling = (on) => { const H = g.handling; if (!H || !H.TUNE) return false; if (on && !W.hSaved) { W.hSaved = {}; for (const k in H_KEYS) { W.hSaved[k] = H.TUNE[k]; H.TUNE[k] = W.TUNE[H_KEYS[k]]; } } else if (!on && W.hSaved) { for (const k in H_KEYS) H.TUNE[k] = W.hSaved[k]; W.hSaved = null; } else return true;
    try { for (const v of g.vehicles || []) if (v._hd) v._hd.k = null; } catch (e) {} return true; };     /* handling.js caches a car's numbers: drop the caches so the change is taken */
  W.tuneHandling(true);
  g.weight = W;
  Vehicle.prototype.step = function (dt, inp, gg) {
    if (W.on !== !!W.hSaved && g.handling) W.tuneHandling(W.on);
    // not the player's own car on keys or a pad, or in a handbrake slide (drift.js's): the step below, untouched
    if (!W.on || W.err || !inp || inp.lock === undefined || !gg || !gg.player || this !== gg.player.vehicle || this.moto || this.patrol || this.ems || this.heat || this.drive || this.wreck || !(dt > 0) || (this._dr && this._dr.on)) { const S0 = this._wt; if (S0 && S0.lean) { this.roll -= S0.lean; S0.lean = 0; } if (S0) { S0.sq = 0; this._wtQ = 0; } return below.call(this, dt, inp, gg); }
    try {
      const T = W.TUNE, S = this._wt || (this._wt = { lat: 0, lim: 0, k: 0, sq: 0, lean: 0 }), wb = this.def.wheelbase || 2.7, vf = this.vf || 0, av = Math.abs(vf), wet = gg.rain && gg.rain.wet > 0 ? Math.min(1, gg.rain.wet) : 0, aW = W.gOf(this) * (1 - T.wet * wet);     /* a wet road (the progress lane's rain) holds less */
      // the wheel a key may ask for is what the tyres carry at this speed (the lever allows more, as in the game's own steering)
      const lockW = Math.atan(aW * wb / Math.max(av * av, 6)) * (inp.handbrake ? T.hb : 1), lock0 = inp.lock, lat0 = inp.latLim, req = Math.abs(lock0);
      if (req > lockW) inp.lock = Math.sign(lock0) * lockW;
      inp.latLim = aW + 1.5;
      // SCRUB: a wheel HELD hard over above the speed a street corner can be taken at (vC) drags speed off the front tyres, more the further over that speed, and in town
      // takes the pedal with it: a foot kept down through a corner does not push the car wide, the car comes down to a speed it can turn at. A tap of the wheel does
      // nothing (the hold builds over a fifth of a second), a part-turned stick little; on the open road (handling.js's model) it is a light drag only.
      const st = Math.abs(inp.steer || 0), full = st * st * (req > lockW ? 1 : 0); S.k += (full - S.k) * (1 - Math.exp(-dt * (full > S.k ? T.holdUp : 10)));
      const over = clamp((av - T.vC) / T.vBand, 0, 1) * lerp(1, T.fast, clamp((av - T.townV) / 4, 0, 1)), k = vf > 0 && !inp.handbrake ? S.k * over : 0;
      const thr0 = inp.throttle; if (k > 0.02 && thr0 > 0) inp.throttle = thr0 * (1 - T.cut * k * (1 - clamp((av - T.townV) / 3, 0, 1)));
      this.roll -= S.lean;     // our share of the lean comes off before the step below works on its own (cars.js keeps and restores the base's roll around the step)
      let r; try { r = below.call(this, dt, inp, gg); } finally { inp.lock = lock0; inp.latLim = lat0; inp.throttle = thr0; }
      if (this._dr && this._dr.on) { S.k = 0; S.lean = 0; S.sq = 0; this._wtQ = 0; return r; }     // the lever has just started a slide: drift.js's from here
      if (k > 0.02) { const sp = Math.hypot(this.vx, this.vy), dec = T.scrub * k * clamp(((this.spec && this.spec.acc) || 6.2) / 6.2, 0.6, 1); /* a weak engine (the van, the truck) is not asked to pull against a full scrub */ if (sp > 0.5) { const q = Math.max(0, sp - dec * dt) / sp; this.vx *= q; this.vy *= q; this.vf *= q; this.vs *= q; } }
      // heard and seen: the sideways g against the limit, and the scrub
      const lat = Math.abs((this.vf || 0) * (this.yawV || 0)), want = clamp((lat / aW - T.sq0) / (T.sq1 - T.sq0), 0, 1) * T.sqMax + Math.min(1, k * 1.6) * T.sqScrub;
      S.sq += (want - S.sq) * (1 - Math.exp(-dt * (want > S.sq ? 9 : 5))); this._wtQ = S.sq > (this.slip || 0) ? S.sq : 0;     /* _wtQ: the part of v.slip that is ours, for driftfx.js: a squeal, not smoke */ if (S.sq > (this.slip || 0)) this.slip = S.sq;
      // the body leans out of the corner with the sideways load, more than the base's small lean (a blind judge: "no visible body roll")
      S.lean += (clamp((this.vf || 0) * (this.yawV || 0) * T.lean, -T.leanMax, T.leanMax) - S.lean) * Math.min(1, dt * 5); this.roll += S.lean;
      S.lat = lat; S.lim = aW; W.n++; return r;
    } catch (e) { W.err = String(e && e.stack || e); console.warn('[weight] off after an error: ' + W.err); return below.call(this, dt, inp, gg); }
  };
  return W;
}
