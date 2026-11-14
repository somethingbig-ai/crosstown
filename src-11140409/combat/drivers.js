// combat/drivers.js: THE WORLD REACTS, the drivers of the traffic (gameplay lane, world helper, Nov 13). Fetched by scare.js once the
// game is playable; off with ?drivers=0 (or ?scare=0). traffic.js is the motion lane's and is NOT edited: the cars stay on its rails
// and under its rules (gaps, lights, junctions, lane changes). From outside, per car, only what it already exposes is used:
//   c.v0            the driver's own cruising speed (0: a hard stop, held; lowered: creeping past; raised: getting away). c.stun is NOT
//                   used: traffic.js reads a stunned car as broken down and sends the cars behind round it through the next lane
//   c.wait          the count behind traffic.js's last resort (see below): kept short of it round a driver we hold
//   (a car that has waited 16 s on a green behind a standing car slips through it: traffic.js's last resort against gridlock. So no
//   driver is held by us for more than 11 s at a stretch, the gunman-in-the-road stop is close enough (5-7 m) that traffic.js itself
//   sees the player as what holds the queue, which it never slips through, and c.wait is kept under 16 s round a held driver.)
//   c.x c.y c.h     after traffic.step a small sideways offset (at most 0.45 m, only as the car rolls, only where the side is free)
// Nothing is stored on the cars (a Map from car to its driver's state: car objects keep their one shape, see the stuck helper's note in
// traffic.js spawn()). The instance's step is wrapped (game.traffic.step): our controls before it, the offset after it. Per driver, one reaction at a time:
//   gunfire         by distance and by whether he is boxed in: the gun ahead of him: brakes hard, stops and stays low (the figure
//                   leans down behind the wheel); the gun beside or behind and the road open: floors it, some with the horn;
//                   standing in a queue or at a light: stays low where he is; far off: slows and creeps
//   a gun aimed     at his car: stops and stays down while it is on him; one in four, if the gunman is not in his way, floors it
//   gunman in the road   stops short (5-7 m, not at his knees) and waits there; no horn
//   a crash ahead   (the player's car hits something hard, or a car goes up) brakes, eases off to the side away from it within his
//                   lane where that side is free, stops short, waits a few seconds (some lean on the horn), then goes on under
//                   traffic's own rules (round it where there is a lane, else waits behind it); cars passing the other way slow
//   wrong-way car   (the player's, coming at his nose) brakes, pulls to the other side of his lane, horn
//   sirens          game.__siren = { x, y } | [{ x, y }, ...] | null (the police helper sets it while a siren sounds), or
//                   game.__world.drivers.siren(x, y) each time: cars within 60 m slow to a crawl and pull to the right of their lane
//   horn            synthesised (two notes through a horn's body), placed by distance and side; also sounds the c.honk combat.js sets
//                   when a driver whose car is shot bolts (nothing played it before)
// Cost: nothing is looked at per frame unless a driver is reacting. Four times a second, and only while the player has a gun out, is at
// the wheel above 4 m/s, or a siren is set, the cars within 45 m are looked at. Events (a shot, a crash) look once at the cars near.
import * as THREE from 'three';
import { clamp, wrapPi } from '../geo.js';

const OFF = 0.45, _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();

class Drivers {
  constructor(game, combat, S) {
    this.g = game; this.c = combat; this.S = S; this.T = game.traffic; this.on = true; this.t = 0; this.act = []; this.M = new Map(); this.aimed = new WeakMap(); this.pollT = 0; this.sweepT = 0; this.scene = null; this.heldT = -99; this.waitT = 0; this.seedN = 77123; this.voices = 0; this.lowN = 0; this.sirens = []; this.sirenT = -9; this.ms = 0;
    this.stats = { duck: 0, bolt: 0, halt: 0, stop: 0, slow: 0, aside: 0, siren: 0, horn: 0, swerve: 0 };
    const T = this.T, self = this, step0 = T.step;
    T.step = function (dt, t) { if (self.on && (self.act.length || self.pollT <= 0)) { try { self.pre(dt); } catch (e) { self.err(e); } } else { self.t += dt; self.pollT -= dt; } const r = step0.call(this, dt, t); if (self.on && self.act.length) { try { self.post(dt); } catch (e) { self.err(e); } } return r; };
    S.listeners.push((ev) => { if (this.on) this.event(ev); });
    // a driver who stays low is drawn leaning down behind the wheel (the lead's FigureBatch is wrapped, as combat.js does for a driver who was shot)
    for (const fb of game.drivers || []) { if (!fb || !fb.add || !fb.meshes) continue; const add0 = fb.add.bind(fb); fb.add = function (x, y, z, h) { const n = fb.n; add0(x, y, z, h); if (self.lowN > 0 && fb.n > n) { try { self.lean(fb, n, x, y, z, h); } catch (e) {} } }; }
  }
  rnd() { this.seedN = (this.seedN * 1664525 + 1013904223) >>> 0; return this.seedN / 4294967296; }
  err(e) { if (!this._err) { this._err = true; console.log('[drivers] ' + (e && (e.stack || e.message))); } }
  frame() {}
  // the police helper's hook: a siren sounding at (x, y) now (call it while it sounds, a few times a second is enough)
  siren(x, y) { this.sirens.push({ x, y }); this.sirenT = this.t; if (this.sirens.length > 6) this.sirens.shift(); }
  // can this driver be told anything? (not one combat.js has shot, set alight or sent bolting)
  free(c) { if (c.dead || c.dbl) return false; const Q = this.c.cars && this.c.cars.get(c); return !(Q && (Q.drvDead || Q.fire || Q.fled || Q.hp <= 0)); }
  rec(c, mode, t, o) {
    let R = this.M.get(c); if (!R) { this.M.set(c, (R = { off: 0, offW: 0, yaw: 0, base: c.v0, baseE: c.e, low: 0, lowW: 0, stand: 0 })); this.act.push(c); }
    R.mode = mode; R.t = t; R.age = 0; R.delay = 0; if (!(R.stand > 11)) R.stand = 0; R.ev = null; R.stopped = false; R.cap = 0; R.offW = 0; R.lowW = 0; R.hornAt = -1; R.hornS = 0; if (o) Object.assign(R, o); this.stats[mode] = (this.stats[mode] || 0) + 1; return R;
  }
  // nothing ahead of him in his lane for a few car lengths, and he is rolling: he can get away
  open(c) {
    if (c.v < 1.2) return false; const fx = Math.cos(c.h), fy = Math.sin(c.h);
    for (const o of this.T.cars) { if (o === c) continue; const dx = o.x - c.x, dy = o.y - c.y; if (dx > 22 || dx < -22 || dy > 22 || dy < -22) continue; const f = dx * fx + dy * fy; if (f > 0 && f < 14 + c.def.len && Math.abs(-dx * fy + dy * fx) < 1.7) return false; }
    for (const o of this.g.vehicles) { const dx = o.x - c.x, dy = o.y - c.y, f = dx * fx + dy * fy; if (f > 0 && f < 18 + c.def.len && Math.abs(-dx * fy + dy * fx) < 2.2) return false; }
    return true;
  }
  // is the side of his lane free to ease into (sg +1 left, -1 right)? no car alongside in the next lane, no parked car close on that side
  sideFree(c, sg) {
    const fx = Math.cos(c.h), fy = Math.sin(c.h), hl = c.def.len / 2, hw = c.def.wid / 2;
    const hit = (o, pad) => { const dx = o.x - c.x, dy = o.y - c.y; if (dx > 12 || dx < -12 || dy > 12 || dy < -12) return false; const f = dx * fx + dy * fy, s = (-dx * fy + dy * fx) * sg; return Math.abs(f) < hl + o.def.len / 2 + 2.5 && s > 0.4 && s < hw + o.def.wid / 2 + OFF + pad; };
    for (const o of this.T.cars) if (o !== c && hit(o, 0.75)) return false;
    for (const o of this.g.vehicles) if (hit(o, 0.75)) return false;
    try { for (const o of this.g.parked.near(c.x, c.y, 9, (this._pk ||= []))) if (hit(o, 0.3)) return false; } catch (e) {}
    return true;
  }
  // ---------------------------------------------------------------- things that happen once (from scare.js)
  event(ev) {
    const T = this.T, rnd = () => this.rnd(), k = ev.kind, x = ev.x, y = ev.y;
    if (k === 'shot' || k === 'boom') {
      const R0 = k === 'boom' ? 55 : 42, bx = ev.ex ?? x, by = ev.ey ?? y;
      for (const c of T.cars) { const dx = x - c.x, dy = y - c.y; if (dx > R0 || dx < -R0 || dy > R0 || dy < -R0) continue; const d = Math.hypot(dx, dy); if (d > R0 || !this.free(c)) continue;
        const Q = this.c.cars && this.c.cars.get(c); if (Q && Q.fled) continue; const R = this.M.get(c);
        if (R && (R.mode === 'duck' || R.mode === 'bolt' || R.mode === 'halt' || R.mode === 'stop')) { if (R.mode === 'duck') R.t = Math.max(R.t, 2.5 + rnd() * 2); continue; }
        const fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx, delay = 0.15 + rnd() * 0.5 + d / 343;
        if (k === 'boom') { const ex = bx - c.x, ey = by - c.y, ef = ex * fx + ey * fy, es = -ex * fy + ey * fx; if (ef > 3 && ef < 50 && Math.abs(es) < 7) { this.rec(c, 'stop', 3 + rnd() * 3, { delay, ev: { x: bx, y: by }, D0: 10 + rnd() * 5, side: Math.abs(es) < 0.5 ? 0 : es > 0 ? -1 : 1, lowW: 1 }); continue; } }
        if (d > 30 && k === 'shot' && rnd() < 0.55) { if (!R) this.rec(c, 'slow', 3 + rnd() * 3, { delay, cap: 3.5 + rnd() * 2 }); continue; }
        const ahead = f > 2 && Math.abs(s) < 9, open = this.open(c);
        if (ahead && f < 30 && !(f < 7 && open)) this.rec(c, 'duck', 3 + rnd() * 4, { delay, lowW: 1 });      // the gun is in front of him: he does not drive at it
        else if (open && rnd() < 0.78) { this.rec(c, 'bolt', 6 + rnd() * 4, { delay, vb: clamp(c.v0 * (1.35 + rnd() * 0.2), 12, 15.5), hornAt: rnd() < 0.3 ? delay + 0.2 : -1, hornS: 0.5 + rnd() * 0.7 }); }
        else this.rec(c, 'duck', 2.5 + rnd() * 4, { delay, lowW: 1 });
      }
    } else if (k === 'crash') {
      const pv = ev.v; this.scene = { x, y, v: pv, t: this.t };      // those who come upon it in the next seconds see it too (poll)
      for (const c of T.cars) { const dx = x - c.x, dy = y - c.y; if (dx > 48 || dx < -48 || dy > 48 || dy < -48 || !this.free(c)) continue; const R = this.M.get(c); if (R && R.mode !== 'slow' && R.mode !== 'ease') continue;
        const d = Math.hypot(dx, dy), fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
        if (d < 4.2) { if (!R) this.rec(c, 'slow', 2.5, { cap: 2, hornAt: 0.35 + rnd() * 0.4, hornS: 0.6 + rnd() * 0.8 }); continue; }      // the one that was hit: the horn
        if (f > 3 && f < 46 && Math.abs(s) < 4.6 && !c.junction) { this.rec(c, 'stop', 1.8 + rnd() * 2.6, { delay: 0.2 + rnd() * 0.45, ev: pv && this.g.vehicles.includes(pv) ? pv : { x, y }, D0: 6.5 + rnd() * 3.5, side: Math.abs(s) < 0.45 ? 0 : s > 0 ? -1 : 1, hornAt: rnd() < 0.15 ? 0.5 : rnd() < 0.4 ? -2 : -1, hornS: 0.7 + rnd() * 0.6 }); }
        else if (d < 24 && !R) this.rec(c, 'slow', 3 + rnd() * 3, { delay: 0.3 + rnd() * 0.6, cap: 3 + rnd() * 2 });      // passing it: slows to look
      }
    } else if (k === 'pedhit' || k === 'onwalk') {
      for (const c of T.cars) { const dx = x - c.x, dy = y - c.y; if (dx > 18 || dx < -18 || dy > 18 || dy < -18 || this.M.get(c) || !this.free(c)) continue; this.rec(c, 'slow', 2.5 + rnd() * 2.5, { delay: 0.3 + rnd() * 0.5, cap: 2.5 + rnd() * 2 }); }
    }
  }
  // ---------------------------------------------------------------- things that go on (four times a second, only while they can)
  poll() {
    const g = this.g, c = this.c, pl = g.player, T = this.T, rnd = () => this.rnd(), armed = !!(c.armedFoot && c.armedFoot()), pv = pl.vehicle, psp = pv && pv.vx !== undefined ? Math.hypot(pv.vx, pv.vy) : 0;
    let S = this.t - this.sirenT < 0.8 ? this.sirens : null; { const q = g.__siren; if (q) S = Array.isArray(q) ? q : [q]; else if (!S && this.sirens.length) this.sirens.length = 0; }
    const SC = this.scene && this.t - this.scene.t < 9 && this.t - this.scene.t > 0.5 ? this.scene : null; if (!SC) this.scene = null;
    if (!armed && !(psp > 4) && !S && !SC) return false;
    const aim = armed && !!(c.inp && c.inp.aim), yaw = g.cam ? g.cam.yaw : pl.h, ax = Math.cos(yaw), ay = Math.sin(yaw), onRoad = armed && !g.statics.onSidewalk(pl.x, pl.y);
    for (const car of T.cars) {
      const dx = pl.x - car.x, dy = pl.y - car.y;
      if (S) { let near = false; for (const q of S) if (q && Math.abs(q.x - car.x) < 60 && Math.abs(q.y - car.y) < 60) near = true; if (near && this.free(car)) { const R = this.M.get(car); if (!R || R.mode === 'slow' || R.mode === 'ease') this.rec(car, 'siren', 1.2, { cap: 3.2 + rnd(), side: -1 }); else if (R.mode === 'siren') R.t = 1.2; } }
      if (SC && !this.M.get(car) && !car.junction) { const ex = SC.x - car.x, ey = SC.y - car.y; if (ex < 46 && ex > -46 && ey < 46 && ey > -46) { const cx = Math.cos(car.h), cy = Math.sin(car.h), ef = ex * cx + ey * cy, es = -ex * cy + ey * cx; if (ef > 8 && ef < 44 && Math.abs(es) < 4.6 && this.free(car)) this.rec(car, 'stop', 1.5 + rnd() * 2.5, { delay: 0.1 + rnd() * 0.3, ev: SC.v && g.vehicles.includes(SC.v) ? SC.v : { x: SC.x, y: SC.y }, D0: 6.5 + rnd() * 3.5, side: Math.abs(es) < 0.45 ? 0 : es > 0 ? -1 : 1, hornAt: rnd() < 0.3 ? -2 : -1 }); } }
      if (dx > 45 || dx < -45 || dy > 45 || dy < -45) continue;
      const fx = Math.cos(car.h), fy = Math.sin(car.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx, R = this.M.get(car);
      if (car.honk > 0) { this.horn(car, Math.min(1.6, car.honk)); car.honk = 0; }      // combat.js's own (a driver whose car was shot)
      if (armed) {
        if (!this.free(car)) continue; const d = Math.hypot(dx, dy), inPath = onRoad && f > 0 && f < 26 && Math.abs(s) < 2.1;
        if (aim && d < 30 && d > 0.5 && (-dx * ax - dy * ay) / d > (d < 8 ? 0.85 : 0.955)) {
          if (R && (R.mode === 'halt' || R.mode === 'bolt')) { if (R.mode === 'halt') R.t = Math.max(R.t, 1.5); continue; }
          if (R && R.mode === 'duck') { R.t = Math.max(R.t, 1.5); continue; }
          if (g.statics.raycast && g.statics.raycast(pl.x, pl.y, car.x, car.y) < 1) continue;
          let am = this.aimed.get(car); if (am && am.t > this.t) continue;      /* was held long enough: he has gone on */
          if (!am || this.t - am.t > 25) this.aimed.set(car, (am = { u: rnd(), t: this.t }));
          if (am.u < 0.25 && !inPath && this.open(car)) this.rec(car, 'bolt', 6 + rnd() * 3, { delay: 0.25 + rnd() * 0.5, vb: clamp(car.v0 * 1.45, 12, 15.5) });
          else this.rec(car, 'halt', 1.5, { delay: 0.2 + rnd() * 0.45, lowW: 1 });
        } else if (inPath) {
          if (R && R.mode === 'stop' && R.ev === pl) R.t = Math.max(R.t, 1); else if (!R || R.mode === 'slow' || R.mode === 'ease') this.rec(car, 'stop', 1, { ev: pl, D0: 5 + rnd() * 2, side: 0, standoff: true });
        }
      } else if (psp > 4 && f > 3 && Math.abs(s) < 2.4 && !car.junction) {
        // the player's car coming at his nose, against his way
        if (Math.cos(pv.h - car.h) < -0.6 && -(pv.vx * fx + pv.vy * fy) > 3 && f < 12 + psp * 2.2 && this.free(car)) {
          if (R && R.mode === 'aside') R.t = 0.7; else if (!R || R.mode === 'slow' || R.mode === 'ease') this.rec(car, 'aside', 0.7, { delay: 0.1 + rnd() * 0.25, side: Math.abs(s) < 0.3 ? -1 : s > 0 ? -1 : 1, hornAt: 0.25 + rnd() * 0.3, hornS: 0.8 + rnd() * 0.9 });
        }
      }
    }
    return true;
  }
  // ---------------------------------------------------------------- before traffic's own step: what each reacting driver does with the pedals
  pre(dt) {
    const t0 = performance.now(), A = this.act, T = this.T; this.t += dt;
    this.pollT -= dt; if (this.pollT <= 0) { this.pollT = 0.25; this.poll(); }
    if ((this.sweepT -= dt) <= 0) { this.sweepT = 2; for (let i = A.length - 1; i >= 0; i--) if (!T.cars.includes(A[i])) { this.M.delete(A[i]); A.splice(i, 1); } }
    let low = 0, held = false;
    for (let i = A.length - 1; i >= 0; i--) {
      const c = A[i], R = this.M.get(c); if (!R || c.dead) { this.M.delete(c); A.splice(i, 1); continue; }
      if (!this.free(c)) { this.M.delete(c); A.splice(i, 1); continue; }      // combat.js has him now (shot, burning): hands off, nothing put back
      if (R.delay > 0) { R.delay -= dt; if (R.low > 0) low++; continue; }
      if (c.e !== R.baseE && !c.junction) { R.base = (c.e.ave ? 11.5 : 8) * (0.9 + (c.id % 20) / 100); R.baseE = c.e; }      // a new block since it began (traffic.js gave him a new cruising speed there)
      R.age += dt; let end = false, v0 = R.base; const base = R.base;
      if (R.hornAt >= 0 && R.age >= R.hornAt) { R.hornAt = -1; this.horn(c, R.hornS || 0.8); }
      // what his right foot does is said through c.v0, his own cruising speed (0: a hard stop, held; traffic.js brakes at its 9 m/s2)
      switch (R.mode) {
        case 'duck': case 'halt': v0 = 0; held = true; R.stand += dt; R.t -= dt; if (R.t <= 0 || R.stand > 11) { if (R.stand > 11) this.aimed.set(c, { u: 1, t: this.t + 30 }); R.mode = 'slow'; R.t = 2 + this.rnd() * 2; R.cap = 4 + this.rnd() * 2; R.lowW = 0; } break;
        case 'bolt': v0 = R.vb; if (!c.brake && c.stun <= 0 && c.v > 0.5 && c.v < R.vb) c.v += 3.2 * dt; R.t -= dt; if (R.t <= 0) end = true; break;
        case 'slow': case 'siren': v0 = Math.min(base, R.cap); R.t -= dt; if (R.mode === 'siren') R.offW = c.junction ? 0 : R.side * OFF * 0.9; if (R.t <= 0) end = true; break;
        case 'aside': v0 = 0; R.offW = c.junction ? 0 : R.side * OFF; R.t -= dt; if (R.t <= 0) { R.mode = 'slow'; R.t = 1.5; R.cap = 3; R.offW = 0; } break;
        case 'stop': { const ev = R.ev, dx = ev.x - c.x, dy = ev.y - c.y, fx = Math.cos(c.h), fy = Math.sin(c.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
          if (f < -1 || Math.abs(s) > 7 || R.age > 25 && !R.standoff || (R.standoff && !(this.c.armedFoot && this.c.armedFoot())) || (ev.vx !== undefined && R.age > 1.5 && Math.hypot(ev.vx, ev.vy) > 4)) { end = true; break; }
          if (R.stopped) { v0 = 0; held = true; R.stand += dt; R.t -= dt; if (R.t <= 0 || (R.stand > 11 && !R.standoff)) { end = true; if (R.hornAt === -2) this.horn(c, 0.17, 2); } }
          else { const gap = f - c.def.len / 2 - R.D0; v0 = Math.min(base, Math.sqrt(2 * 4 * Math.max(0, gap))); R.offW = !c.junction && R.side && f < 26 ? R.side * OFF : 0; if (c.v < 0.25 && (gap < 4 || R.age > 6)) R.stopped = true; }
          break; }
        case 'ease': R.offW = 0; if (Math.abs(R.off) < 0.01 || (R.age > 20 && c.v < 0.1)) { c.v0 = base; this.M.delete(c); A.splice(i, 1); continue; } break;
      }
      if (end) { v0 = base; R.mode = 'ease'; R.age = 0; R.offW = 0; R.lowW = 0; }
      c.v0 = v0;
      if (R.offW && ((R.sideT = (R.sideT || 0) - dt) <= 0)) { R.sideT = 0.3; R.sideOk = this.sideFree(c, R.offW > 0 ? 1 : -1); if (R.sideOk && !R.swerved) { R.swerved = true; this.stats.swerve++; } } if (R.offW && !R.sideOk) R.offW = 0;
      R.low = clamp(R.low + (R.lowW > R.low ? dt * 4 : -dt * 2.2), 0, 1); if (R.low > 0) low++;
    }
    // a queue that waits behind a driver we hold must not take traffic.js's last resort (slipping through the car in front after 16 s on a
    // green): while one is held, and a few seconds after, the waiting count of the cars round him is kept short of it
    if (held) this.heldT = this.t; if (this.t - this.heldT < 6 && (this.waitT -= dt) <= 0) { this.waitT = 0.5; for (const c of A) { const R = this.M.get(c); if (!R || !(R.stand > 0)) continue; for (const o of T.cars) if (o.wait > 9 && Math.abs(o.x - c.x) < 70 && Math.abs(o.y - c.y) < 70) o.wait = 9; } }
    this.lowN = low; this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // after traffic's own step: the sideways ease, only as the car rolls (a car does not slide sideways standing still)
  post(dt) {
    for (const c of this.act) { const R = this.M.get(c); if (!R || (!R.off && !R.offW && !R.yaw)) continue;
      const ds = c.v * dt, d = clamp(R.offW - R.off, -0.2 * ds, 0.2 * ds); R.off += d; R.yaw += ((ds > 1e-4 ? d / ds : 0) - R.yaw) * Math.min(1, dt * 7); if (Math.abs(R.yaw) < 1e-4 && !d) R.yaw = 0;
      const sn = Math.sin(c.h), cs = Math.cos(c.h); c.x += -sn * R.off; c.y += cs * R.off; c.h += R.yaw; }
  }
  // the driver of a car that stays low: leaned down over the wheel (found by where the game draws him, as combat.js finds a shot driver)
  lean(fb, n, x, y, z, h) {
    let R = null; for (const c of this.act) { const q = this.M.get(c); if (!q || !(q.low > 0)) continue; if (Math.abs(c.x - x) < 2.6 && Math.abs(c.y - y) < 2.6 && Math.abs(wrapPi(c.h - h)) < 0.02) { R = q; break; } } if (!R) return;
    const e = R.low * R.low * (3 - 2 * R.low), hy = (this.g.kit.driveHips && this.g.kit.driveHips[fb.who]) || 0.5;
    _q.setFromEuler(_e.set(0, h, 0)); _q2.setFromEuler(_e.set(0, 0, -0.62 * e, 'XYZ')); _q.multiply(_q2);
    _v2.set(0, hy, 0).applyQuaternion(_q); _m.compose(_v3.set(x, z + hy - 0.07 * e, -y).sub(_v2), _q, _v4);
    for (const im of fb.meshes) im.setMatrixAt(n, _m);
  }
  // a car horn: two notes a major third apart through a small horn's body; taps = 2: two short taps
  horn(c, secs, taps = 1) {
    this.stats.horn++; const g = this.g, s = g.sound;
    if (!s || !s.on || !s.ac || !s.out || g.capture || s.ac.state !== 'running' || this.voices >= 3) return;
    try {
      const cam = g.world.camera, dx = c.x - cam.position.x, dz = -c.y - cam.position.z, d = Math.hypot(dx, dz); if (d > 120) return;
      const a = s.ac, t = a.currentTime, big = c.def && c.def.len > 6, f0 = (big ? 300 : c.type === 'taxi' ? 430 : 390) * (0.94 + ((c.id || 0) % 13) / 100);
      const o1 = a.createOscillator(), o2 = a.createOscillator(), mix = a.createGain(), hp = a.createBiquadFilter(), pk = a.createBiquadFilter(), lp = a.createBiquadFilter(), gain = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = f0; o2.frequency.value = f0 * 1.26; mix.gain.value = 0.5; hp.type = 'highpass'; hp.frequency.value = 260; pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 1.1; pk.gain.value = 8; lp.type = 'lowpass'; lp.frequency.value = clamp(5200 - d * 32, 1400, 5200);
      const vol = 0.2 * clamp(1 / (1 + d / 14), 0.05, 1), G = gain.gain; G.value = 0;
      const len = taps > 1 ? secs : clamp(secs, 0.15, 2), gapS = 0.11; let te = t;
      for (let k = 0; k < taps; k++) { const t1 = t + k * (len + gapS); G.setValueAtTime(0, t1); G.linearRampToValueAtTime(vol, t1 + 0.018); G.setValueAtTime(vol, t1 + len - 0.03); G.linearRampToValueAtTime(0, t1 + len + 0.04); te = t1 + len + 0.05; }
      if (pan.pan) { const e = cam.matrixWorld.elements; pan.pan.value = clamp((dx * e[0] + dz * e[2]) / (d || 1), -0.85, 0.85); }
      o1.connect(mix); o2.connect(mix); mix.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect((s.bus && s.bus.sirens) || s.out);     /* progress lane: the Sirens and horns slider (settings menu) */ o1.start(t); o2.start(t); o1.stop(te + 0.05); o2.stop(te + 0.05);
      this.voices++; o1.onended = () => { this.voices--; try { pan.disconnect(); } catch (e) {} };
    } catch (e) { this.err(e); }
  }
  census() { const o = { act: this.act.length, low: this.lowN, ms: +this.ms.toFixed(4) }; for (const c of this.act) { const R = this.M.get(c); if (R) o[R.mode] = (o[R.mode] || 0) + 1; } return o; }
}

export function install(game, combat, S) {
  if (!game || !game.traffic || !S || S.drivers) return S && S.drivers; if (game.P && game.P.get('drivers') === '0') return null;
  const D = new Drivers(game, combat, S); console.log('[drivers] drivers react: on'); return D;
}
