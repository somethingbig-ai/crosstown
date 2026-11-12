// combat/heat.js: the law answers the player's crimes, and the player can be hurt and die.
//   HEAT (five steps): crimes seen or heard by people raise it; police answer in proportion (officers on foot, patrol cars by road,
//   heavier units with long guns); it cools one step at a time while no officer has eyes on the player, faster outside the search area.
//   Health: bullets, blasts and being run over hurt; it comes back slowly out of combat; at zero the player falls (the people
//   helper's ragdoll on the player figure), the camera pulls up, the screen fades, and the player wakes outside a clinic.
// One line at the end of Combat.init loads this; everything else is wrapped from here.   ?heat=none  off    ?heatlog=1  numbers in the console
// Sim space is the game's (x east, y north, z up); three.js space is (x, z, -y).
import * as THREE from 'three';
import { clamp, lerp, wrapPi } from '../geo.js';
import { WEAPONS } from './combat.js';
import { AimRig } from './rig.js';
import { Vehicle } from '../game.js';
import { SCRIPTS, Script } from './scripts.js';

const TH = [0, 1, 3, 7, 12, 18], PMAX = 20;
/* seconds unseen to lose one step, and the search radius, per step */
const COOL = [0, 10, 13, 16, 20, 24], AREA = [0, 40, 52, 64, 76, 90];
/* officers alive at once, and seconds between dispatches, per step */
const FORCE = [0, 2, 4, 6, 8, 10], DISP = [0, 1.5, 7, 6, 5, 4];
const CRIME = { shots: { p: 0.12, min: 1, cap: 3 }, wound: { p: 1 }, kill: { p: 2 }, copHit: { p: 0.2, min: 2 }, copKill: { p: 2, min: 3 }, blast: { p: 3 }, runover: { p: 1.5 }, jack: { p: 1.2 } };
/* how officers shoot: error (degrees, one sigma), share of the weapon's damage that reaches the player, burst and pause */
const GUN = { pistol: { sig: 1.7, dm: 0.42, burst: [2, 4], gap: [0.3, 0.45], rest: [0.7, 1.6], band: [8, 17], mag: 15 }, shotgun: { sig: 2.8, dm: 0.3, burst: [1, 1], gap: [1.1, 1.1], rest: [0.5, 1.0], band: [7, 14], mag: 6, pellets: 6 }, rifle: { sig: 1.8, dm: 0.24, burst: [3, 5], gap: [0.1, 0.1], rest: [0.9, 1.8], band: [14, 30], mag: 30 } };
const D2R = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
const _o = {}, _t = {}, _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const F = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const REAL = (() => { try { return !!document.createElement('canvas').getContext('2d').createImageData(1, 1).data; } catch (e) { return false; } })();
const CLINICS = [['Mercy Walk-In', -196, -214], ['Eastside Urgent Care', 260, 280], ['St. Odile Clinic', -340, 240], ['Fifth Ward Medical', 300, -300], ['Midtown Walk-In', 20, 10]];

export async function addHeat(game, combat) {
  if (game.P.get('heat') === 'none') return null;
  const H = new Heat(game, combat); H.init();
  try { (await import('./heatscripts.js')).register(game, combat, H, SCRIPTS, Script); } catch (e) { console.log('[heat] scripts not loaded: ' + e.message); }
  console.log('[heat] ready' + (REAL ? '' : ' (no drawing)'));
  return H;
}

// a patrol car: one of the game's own vehicles that drives itself along a list of points until it stops at the scene
class Patrol extends Vehicle {
  step(dt, inp, g) { if (this.drive && !this.wreck && g.player.vehicle !== this) this.heat.driveCar(this, dt); else { this.drive = null; super.step(dt, inp, g); } }
}

export class Heat {
  constructor(game, combat) {
    this.g = game; this.c = combat; this.t = 0; this.pts = 0; this.level = 0; this.seen = false; this.unseenT = 0; this.coolT = 0; this.lkp = { x: 0, y: 0, h: 0 }; this.lastCrimeT = -99; this.lastShotT = -99; this.lastCarHitT = -99;
    this.cops = []; this.cars = []; this.units = 0; this.dispT = 0; this.sightT = 0; this.pending = []; this.sub = null; this.subT = -9; this.inds = []; this.hurtT = 0; this.lastHurtT = -99; this.dead = null; this.fade = 0; this.note = null; this.chal = null; this.pulse = 0;
    this.seed = (20261110 + 7919 * (+game.P.get('heatseed') || 0)) >>> 0; this.log = game.P.has('heatlog'); this.fast = game.P.has('heatfast'); this.pool = []; this.corpses = []; this.god = game.P.has('heatgod'); this.stopD = +game.P.get('heatstop') || 22; this.half = game.P.get('heathalf') !== '0';
    this.stats = { crimes: {}, copShots: 0, copHits: 0, dmgIn: 0, copsDown: 0, deaths: 0, arrests: 0, escapes: 0, maxLevel: 0, arrive: [], levelT: {}, tCov: 0, tOpenLow: 0, tOpenUp: 0, tStill: 0, blocked: 0, contactT: null, pairT: null, pairHp: null };
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  rr(a, b) { return a + (b - a) * this.rnd(); }
  gauss() { return Math.sqrt(-2 * Math.log(1 - this.rnd() * 0.9999)) * Math.cos(6.2832 * this.rnd()); }
  say(s) { if (this.log) console.log('[heat] ' + this.t.toFixed(1) + ' ' + s); }

  init() {
    const g = this.g, c = this.c, self = this;
    /* crimes: firing, hitting people, blasts, running people over, taking an occupied car */
    const shoot0 = c.shoot.bind(c); c.shoot = function (W, am) { shoot0(W, am); self.lastShotT = self.t; self.crime('shots', g.player.x, g.player.y); self.nearMissCops(); };
    const cast0 = c.cast.bind(c); c.cast = function (ox, oy, oz, dx, dy, dz, tmin, tmax) { const h = cast0(ox, oy, oz, dx, dy, dz, tmin, tmax); if (!self.copFire) self.castCops(h, ox, oy, oz, dx, dy, dz, tmin); return h; };
    const hit0 = c.hit.bind(c); c.hit = function (h, W, first) {
      if (h.kind === 'cop') return self.hitCop(h, W, first);
      if (h.kind === 'door') { try { c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(h.nx, 0, -h.ny), 'metal'); if (first) c.snd('impact', 'metal', { dist: 10 }); } catch (e) {} return 'prop'; }
      const r = hit0(h, W, first); if (self.copFire) return r;
      if (r === 'ped') self.crime('wound', h.x, h.y); else if (r === 'kill') self.crime('kill', h.x, h.y); else if (r === 'car') self.lastCarHitT = self.t;
      return r; };
    const ex0 = c.explode.bind(c); c.explode = function (v, S) { self.blast = { x: v.x, y: v.y }; const mine = g.player.vehicle === v; ex0(v, S); if (self.t - self.lastCarHitT < 15) self.crime('blast', v.x, v.y); if (mine) c.hurt(999); self.blast = null; };
    const hurt0 = c.hurt.bind(c); c.hurt = function (n) { if (self.dead || c.dead || self.god) return; hurt0(n); self.onHurt(n, self.src || self.blast); };
    const ph0 = g.onPedHit.bind(g); g.onPedHit = function (p, v) { ph0(p, v); /* (guns v1 hands a bullet to the lead's pedhit as a stand-in car: that is not a running-over) */ if (v === g.player.vehicle && !v.bullet && !self._ph) self.crime('runover', p.x, p.y); };
    const te0 = g.tryEnter.bind(g); g.tryEnter = function () { let n = null; try { n = g.nearestCar(); } catch (e) {} const ok = te0(); if (ok && n && (n.kind === 'traffic' || (n.kind === 'veh' && n.v.patrol))) self.crime('jack', g.player.x, g.player.y); return ok; };
    /* the frame */
    const step0 = g.step.bind(g); g.step = function (dt) { step0(dt); try { self.step(dt); } catch (e) { if (!self._err) { self._err = true; console.log('[heat] step: ' + (e && (e.stack || e.message))); } } };
    const ri0 = g.readInput.bind(g); g.readInput = function () { ri0(); if (self.dead) { const I = g.input; I.mx = I.my = I.steer = I.throttle = 0; I.brake = 0; I.run = false; I.use = false; c.mx = c.my = 0; } };
    const sync0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { try { self.preSync(dt); } catch (e) { self.oops('pre', e); } sync0(dt); try { self.postSync(dt); } catch (e) { self.oops('post', e); } };
    /* gun smoke in a firefight: every round leaves veils that hang for three or four seconds, and with four people firing the street filled with it (capture h9c: the patrol car
       went 'chalk white', officers were 'grey smoke-ghosts', police flashes were hidden). While heat is on, a veil is thinner and shorter-lived the more rounds were fired in the
       last three seconds, and an officer's own is a third of the player's. ?heatsmoke=0 leaves the guns' smoke alone. */
    if (c.fx && typeof c.fx.muzzle === 'function' && typeof c.fx.spawn === 'function' && g.P.get('heatsmoke') !== '0') { const fx = c.fx, mz0 = fx.muzzle, shots = []; fx.muzzle = function (...a) { if (!self.level && !self._copShot) return mz0.apply(fx, a); const now = self.t; while (shots.length && now - shots[0] > 3) shots.shift(); const k = (self._copShot ? 0.3 : 0.6) / (1 + 0.5 * shots.length); /* the player's own veil lies on his line of sight, over the man he is shooting at ('a grey smear covers the officer', round 12) */ shots.push(now); const sp0 = fx.spawn; fx.spawn = function (o) { if (o && o.life > 2 && o.a && o.s1 > 0.4 && !o.add) { o.a *= k; o.life *= 0.45 + 0.55 * k; } return sp0.call(fx, o); }; try { return mz0.apply(fx, a); } finally { fx.spawn = sp0; } }; }
    const place0 = g.placeCamera.bind(g); g.placeCamera = function (dt) { if (self.dead && self.dead.cam) self.deathCam(); else { place0(dt); if (self.flinch > 0.001) { const cam = g.world.camera; cam.rotateZ(self.flinchZ * self.flinch); cam.rotateX(0.03 * self.flinch); cam.updateMatrixWorld(); } } };
    const hud0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { hud0(); try { self.hud(); } catch (e) { self.oops('hud', e); } };
    this.flinch = 0; this.flinchZ = 0;
    if (REAL) { try { this.buildShared(); } catch (e) { console.log('[heat] visuals: ' + e.message); } }
  }
  oops(k, e) { this._errs = this._errs || {}; if (this._errs[k]) return; this._errs[k] = true; console.log('[heat] ' + k + ': ' + (e && (e.stack || e.message))); }

  // ------------------------------------------------------------------ heat
  witnesses(x, y) {
    const g = this.g; for (const k of this.cops) if (k.hp > 0 && Math.hypot(k.x - x, k.y - y) < 90 && k.see) return 2;
    let n = 0; for (const p of g.peds.list) if (p.state !== 'down' && Math.abs(p.x - x) < 45 && Math.abs(p.y - y) < 45) n++;
    const cs = g.crowd && g.crowd.on && g.crowd.sim; if (cs) for (const a of cs.agents) if (!a.gone && Math.abs(a.x - x) < 45 && Math.abs(a.y - y) < 45) { n++; if (n > 2) break; }
    return n > 0 ? 1 : 0;
  }
  crime(kind, x, y) {
    const C = CRIME[kind]; if (!C || this.dead) return; const w = this.witnesses(x, y); this.stats.crimes[kind] = (this.stats.crimes[kind] || 0) + 1; if (!w) return;
    /* officers on the scene know at once; a bystander's call takes a moment */
    if (w === 2 && kind === 'shots') { /* fired in front of them: they answer within a human reaction time */ if (this.t - (this.firedSeenT ?? -99) > 8) for (const k of this.cops) if (k.hp > 0 && k.see) k.fireCd = Math.min(k.fireCd, this.rr(0.22, 0.5)); this.firedSeenT = this.t; }
    if (w === 2 || this.level > 0) this.addHeat(kind, x, y); else if (!this.pending.some((q) => q.kind === kind)) this.pending.push({ kind, x, y, t: kind === 'shots' ? 0.8 : 1.6 });
  }
  addHeat(kind, x, y) {
    const C = CRIME[kind], l0 = this.level; let p = this.pts;
    if (C.cap === undefined || p < C.cap) p = Math.min(C.cap ?? PMAX, p + C.p); if (C.min) p = Math.max(p, C.min); this.pts = Math.min(PMAX, p);
    this.lastCrimeT = this.t; this.coolT = 0; this.onScene = false; this.setLevel();
    if (this.level > l0) { if (l0 === 0) { const pl = this.g.player; this.lkp.x = pl.x; this.lkp.y = pl.y; this.dispT = DISP[1]; this.unseenT = 0; } this.pulse = 1; this.stats.levelT[this.level] = this.stats.levelT[this.level] ?? +this.t.toFixed(1); this.say('HEAT ' + this.level + ' (' + kind + ', ' + this.pts.toFixed(1) + ' pts)');
      if (this.level >= 3 && l0 < 3) this.shout('Shots fired, officers need help! Send everything!', 2); if (this.level === 5) this.shout('All units: suspect is armed. Take the shot.', 2); }
  }
  setLevel() { let l = 0; for (let i = 1; i <= 5; i++) if (this.pts >= TH[i]) l = i; this.level = l; this.stats.maxLevel = Math.max(this.stats.maxLevel, l); }
  clear(why) { if (this.level > 0 || this.pts > 0) this.say('heat cleared: ' + why); this.pts = 0; this.level = 0; this.coolT = 0; this.seen = false; this.pending.length = 0; this.chal = null; for (const k of this.cops) if (k.hp > 0) k.mode = 'leave'; for (const car of this.cars) car.leaveT = 0; }
  los(ax, ay, bx, by) {
    const g = this.g; if (g.statics.raycast(ax, ay, bx, by) < 1) return false;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, tall = (v) => { if (v.def.hgt < 1.9) return false; const ex = v.x - ax, ey = v.y - ay, al = (ex * dx + ey * dy) / L; if (al < 1 || al > L - 1) return false; return Math.abs(ex * dy - ey * dx) / L < v.def.wid * 0.5; };
    for (const v of g.traffic.cars) if (tall(v)) return false; for (const v of g.vehicles) if (tall(v)) return false; return true;
  }
  sight() {
    const g = this.g, pl = g.player; let seen = false;
    for (const k of this.cops) { if (k.hp <= 0) continue; const d = Math.hypot(k.x - pl.x, k.y - pl.y); k.dist = d; k.see = d < 80 && this.los(k.x, k.y, pl.x, pl.y); if (k.see) { seen = true; k.onT += 0.1; if (!k.saw) k.thinkT = Math.min(k.thinkT, 0.12); } else k.onT = 0; k.saw = k.see; }
    for (const car of this.cars) if (car.drive && !car.wreck && Math.hypot(car.x - pl.x, car.y - pl.y) < 60 && this.los(car.x, car.y, pl.x, pl.y)) seen = true;
    if (this.level === 0) seen = false;
    if (seen) { if (!this.seen && this.unseenT > 4) this.shout(this.pick(['There! Suspect in sight!', 'Got eyes on him!', 'Contact! He is right there!']), 1); this.lkp.x = pl.x; this.lkp.y = pl.y; this.lkp.h = pl.vehicle ? pl.vehicle.h : pl.h; this.lkp.t = this.t; this.unseenT = 0; this.coolT = 0; this.onScene = false; }
    else if (this.seen) { this.shout(this.pick(['Lost him! Spread out!', 'No visual. Check the corner!', 'Where did he go? Fan out!']), 1); }
    this.seen = seen;
  }
  pick(a) { return a[Math.floor(this.rnd() * a.length) % a.length]; }
  shout(s, pri = 0) { if (this.t - this.subT < (pri > 1 ? 0.6 : pri ? 1.8 : 3.2)) return; this.sub = { text: s, t: 0 }; this.subT = this.t; if (this.log) this.say('"' + s + '"'); }

  // ------------------------------------------------------------------ the fixed step
  step(dt) {
    const g = this.g, pl = g.player, c = this.c; this.t += dt;
    if (this.dead) { this.stepDead(dt); }
    /* ?heatqa=<step>: for looking at it: that much heat at once, a pair a few metres ahead, a car (and at 4+ a heavy unit) from the next block */
    if (!this.qa && g.P.has('heatqa') && this.t > 0.4) { this.qa = true; const L = clamp(+g.P.get('heatqa') || 2, 1, 5); this.pts = TH[L]; this.setLevel(); this.lkp.x = pl.x; this.lkp.y = pl.y; this.lkp.h = pl.h; this.lastCrimeT = this.t; this.firedSeenT = this.t;
      for (let i = 0; i < 2 && g.P.get('heatqp') !== '0'; i++) { const a = pl.h + (i ? -0.16 : 0.13), d = +(g.P.get('heatqd') || 9) + i * 3, k = this.addCop(pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, i && L >= 3 ? 'shotgun' : 'pistol', null, i); k.mode = 'hold'; k.post = { x: k.x, y: k.y }; }
      this.sendCar(false, true); if (L >= 3 && g.P.get('heatq2')) this.q2T = this.t + (+g.P.get('heatq2') || 1.6); if (L >= 4) this.sendCar(true, true); }
    /* ?heatq2=<s>: a second car that many seconds behind the first (films) */
    if (this.q2T && this.t >= this.q2T) { this.q2T = 0; this.seed = (20261110 + 7919 * (+g.P.get('heatseed') || 0)) >>> 0; this.sendCar(false, true); }
    for (let i = this.pending.length - 1; i >= 0; i--) { const q = this.pending[i]; q.t -= dt; if (q.t <= 0) { this.pending.splice(i, 1); this.addHeat(q.kind, q.x, q.y); } }
    this.sightT -= dt; if (this.sightT <= 0) { this.sightT = 0.1; this.sight(); }
    if (this.level > 0 && !this.dead) {
      if (!this.seen) { this.unseenT += dt; const out = Math.hypot(pl.x - this.lkp.x, pl.y - this.lkp.y) > AREA[this.level];
        if (!this.onScene && this.cops.some((k) => k.hp > 0 && Math.hypot(k.x - this.lkp.x, k.y - this.lkp.y) < 14)) this.onScene = true;
        if (this.unseenT > 2 && this.t - this.lastCrimeT > 5 && (out || this.onScene)) this.coolT += dt * (out ? 2 : 1);
        if (this.coolT >= COOL[this.level]) { this.coolT = 0; this.pts = TH[this.level - 1]; this.setLevel(); this.say('cooled to ' + this.level); if (this.level === 0) { this.stats.escapes++; this.note = { title: 'IN THE CLEAR', sub: 'They lost you', t: 0 }; this.clear('escaped'); } } }
      this.dispatch(dt);
    }
    /* drivers do not cruise into a gunfight: those heading for it brake and wait, those already leaving go */
    this.trafT = (this.trafT || 0) - dt; if (this.trafT <= 0 && this.level > 0 && (this.t - this.lastShotT < 10 || this.stats.copShots > (this._cs0 || 0) || this.cars.some((v) => v.out))) { this.trafT = 0.25; this._cs0 = this.stats.copShots; const fx = this.seen ? pl.x : this.lkp.x, fy = this.seen ? pl.y : this.lkp.y;
      for (const q of g.traffic.cars) { const dx = fx - q.x, dy = fy - q.y, d = Math.hypot(dx, dy); if (d > 48) continue; if (d < 9 || dx * Math.cos(q.h) + dy * Math.sin(q.h) > 0.25 * d) q.stun = Math.max(q.stun || 0, 0.45); } }
    for (let i = this.cops.length - 1; i >= 0; i--) { const k = this.cops[i]; if (k.hp > 0) this.stepCop(k, dt); else if (!g.peds.list.includes(k)) { this.cops.splice(i, 1); this.release(k); } }
    for (let i = this.cars.length - 1; i >= 0; i--) this.stepCar(this.cars[i], dt, i);
    /* corpses do not pile up without end */
    { let n = 0; for (let i = this.cops.length - 1; i >= 0; i--) if (this.cops[i].hp <= 0 && ++n > 6) this.cops[i].t = 99; }
    /* health: back slowly out of combat; run over by something moving */
    this.hurtT = Math.max(0, this.hurtT - dt); this.flinch *= Math.exp(-dt * 9); this.pulse = Math.max(0, this.pulse - dt * 0.7);
    if (!this.dead && c.health < 100 && this.t - this.lastHurtT > 7) c.health = Math.min(this.level > 0 ? Math.max(c.health, 60) : 100, c.health + dt * (this.level > 0 ? 3 : 6));
    if (!this.dead && !pl.vehicle && this.t - (this.runT || -9) > 1) { const hitBy = (v, sp) => { if (sp < 3.5) return; const dx = pl.x - v.x, dy = pl.y - v.y, cs = Math.cos(v.h), sn = Math.sin(v.h), f = dx * cs + dy * sn, s = -dx * sn + dy * cs; /* struck by the nose of something moving, not brushed by its side */
        if (f > v.def.len / 2 - 0.7 && f < v.def.len / 2 + 0.45 && Math.abs(s) < v.def.wid / 2) { this.runT = this.t; this.src = { x: v.x, y: v.y }; this.say('run over at ' + sp.toFixed(1) + ' m/s'); c.hurt(Math.min(60, (sp - 2) * 5)); this.src = null; pl.x += -sn * Math.sign(s || 1) * 0.8; pl.y += cs * Math.sign(s || 1) * 0.8; try { g.sound.thud(); } catch (e) {} } };
      for (const v of g.traffic.cars) hitBy(v, v.v); for (const v of this.cars) if (v.drive) hitBy(v, v.vf); }
    if (!this.dead && c.health <= 0) this.die();
    for (let i = this.inds.length - 1; i >= 0; i--) { this.inds[i].t -= dt; if (this.inds[i].t <= 0) this.inds.splice(i, 1); }
    if (this.sub) { this.sub.t += dt; if (this.sub.t > 2.6) this.sub = null; } if (this.note) { this.note.t += dt; if (this.note.t > 4.5) this.note = null; }
    if (this.log && Math.floor(this.t / 5) !== Math.floor((this.t - dt) / 5)) console.log('[heat] ' + this.report());
  }
  report() { const S = this.stats, al = this.cops.filter((k) => k.hp > 0); return 't ' + this.t.toFixed(0) + ' heat ' + this.level + ' (' + this.pts.toFixed(1) + ') ' + (this.level ? (this.seen ? 'SEEN' : 'unseen ' + this.unseenT.toFixed(0) + 's cool ' + this.coolT.toFixed(0) + '/' + COOL[this.level]) : '') + ' hp ' + Math.round(this.c.health) + ' cops ' + al.length + ' (' + al.filter((k) => k.see).length + ' see) cars ' + this.cars.length + ' | cop shots ' + S.copShots + ' hits ' + S.copHits + ' dmg ' + Math.round(S.dmgIn) + ' down ' + S.copsDown + ' deaths ' + S.deaths + ' esc ' + S.escapes + ' arrive ' + S.arrive.join(',') + ' | contact ' + S.contactT + ' cover ' + S.tCov.toFixed(0) + 's still ' + S.tStill.toFixed(0) + 's openLow ' + S.tOpenLow.toFixed(0) + 's openUp ' + S.tOpenUp.toFixed(1) + 's blocked ' + S.blocked; }

  // ------------------------------------------------------------------ dispatch
  dispatch(dt) {
    this.dispT += dt; const L = this.level, g0 = this.g; if (this.dispT < DISP[L] * (this.fast ? 0.5 : 1)) return;
    const alive = this.cops.filter((k) => k.hp > 0 && k.mode !== 'leave').length, crew = this.cars.reduce((n, v) => n + (v.drive && !v.left && !v.wreck ? (v.heavy ? 3 : 2) : 0), 0);
    if (alive + crew >= FORCE[L]) return; this.dispT = 0;
    const cars = this.cars.filter((v) => !v.wreck && !v.left).length, wantCars = [0, 0, 1, 2, 4, 6][L], foot = this.cops.some((k) => k.hp > 0 && !k.car);
    if (cars < wantCars && alive + crew + 2 <= FORCE[L]) { const heavy = L >= 4 && this.cars.filter((v) => v.heavy && !v.wreck).length < L - 3; if (this.sendCar(heavy, this.fast ? 2 : 0)) return; }
    if ((L < 3 || !foot || cars >= wantCars) && g0.P.get('heatfoot') !== '0') this.sendFoot();
  }
  sendFoot() {
    const g = this.g, pl = g.player, st = g.statics; let best = null;
    for (let k = 0; k < 40 && !best; k++) { const a = this.rnd() * 6.283, d = this.fast ? this.rr(20, 32) : this.rr(32, 58), x = this.lkp.x + Math.cos(a) * d, y = this.lkp.y + Math.sin(a) * d; if (Math.abs(x) > g.bounds.x - 8 || Math.abs(y) > g.bounds.y - 8) continue; if (!st.onSidewalk(x, y) || st.resolve(x, y, 0.5, _o) > 0) continue; if (k < 30 && st.raycast(pl.x, pl.y, x, y) >= 1) continue; if (!this.pathNodes(x, y, this.lkp.x, this.lkp.y) && st.raycast(x, y, this.lkp.x, this.lkp.y) < 1) continue; best = { x, y }; }
    if (!best) return false; this.units++;
    const n = 2; for (let i = 0; i < n; i++) this.addCop(best.x + i * 0.9, best.y + (i % 2) * 0.8, this.level >= 4 && i === 0 ? 'rifle' : this.level >= 3 && i === 1 ? 'shotgun' : 'pistol', null, i);
    this.say('dispatch: ' + n + ' on foot from ' + Math.round(Math.hypot(best.x - pl.x, best.y - pl.y)) + ' m'); return true;
  }
  // the way there by road: from a block out of sight, along the lane graph, onto the block where the player was last seen
  routeTo(x0, y0, e0, dir0, s0) {
    const R = this.g.roads, ne = R.nearestEdge(this.lkp.x, this.lkp.y, 90); if (!ne) return null; const pts = [];
    const lane = (e, dir) => Math.max(0, Math.min(R.laneCount(e, dir) - 1, Math.floor(R.laneCount(e, dir) / 2)));
    let best = null; for (const node of [ne.e.a, ne.e.b]) { if (R.endNode(e0, dir0) === node) { best = { segs: [{ e: e0, dir: dir0 }], node, len: 0 }; break; } const r = R.route(e0, dir0, node); if (!r) continue; let len = 0; for (const s of r) len += s.e.len; if (!best || len < best.len) best = { segs: r, node, len }; }
    if (!best) return null;
    best.segs.forEach((sg, i) => { if (sg.e === ne.e) return; const li = lane(sg.e, sg.dir), a = i === 0 ? s0 : 7, b = sg.e.len - 7; for (let s = a; s < b; s += 7) { R.lanePos(sg.e, sg.dir, li, s, _t); pts.push([_t.x, _t.y]); } R.lanePos(sg.e, sg.dir, li, Math.max(a, b), _t); pts.push([_t.x, _t.y]); });
    /* the last block: from that corner toward the place itself, either way along it */
    { const e = ne.e, dir = best.node === e.a ? 1 : -1, sT = dir > 0 ? ne.s : e.len - ne.s, ln = dir > 0 ? e.line : e.rev, off = e.oneway ? 0 : e.lw * 0.5; for (let s = 6; s < sT + 0.1; s += 6) { ln.at(s, _t); pts.push([_t.x + _t.ty * off, _t.y - _t.tx * off]); } ln.at(sT, _t); pts.push([_t.x + _t.ty * off, _t.y - _t.tx * off]); }
    return pts.length > 1 ? pts : null;
  }
  sendCar(heavy, near) {
    const g = this.g, R = g.roads, pl = g.player, cand = [];
    for (const e of R.edges) { if (e.out || e.len < 40) continue; e.line.at(e.len / 2, _t); const d = Math.hypot(_t.x - this.lkp.x, _t.y - this.lkp.y); if (near === 2 ? d < 85 || d > 150 : near ? d < 40 || d > 130 : d < 120 || d > 240) continue; if (Math.abs(_t.x) > g.bounds.x - 20 || Math.abs(_t.y) > g.bounds.y - 20) continue; if (!near && g.statics.raycast(pl.x, pl.y, _t.x, _t.y) >= 1) continue; cand.push(e); }
    for (let k = 0; k < 6 && cand.length; k++) {
      const e = cand.splice(Math.floor(this.rnd() * cand.length), 1)[0]; let best = null;
      for (const dir of e.oneway ? [1] : [1, -1]) { R.lanePos(e, dir, 0, e.len / 2, _t); const p = this.routeTo(_t.x, _t.y, e, dir, e.len / 2); if (p && (!best || p.length < best.p.length)) best = { p, x: p[0][0], y: p[0][1], h: Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) }; }
      if (!best || best.p.length > 90) continue; if (g.traffic.cars.some((q) => Math.hypot(q.x - best.x, q.y - best.y) < 9)) continue; if (this.cars.some((q) => Math.hypot(q.x - best.x, q.y - best.y) < 14)) continue;
      const type = heavy ? 'suv' : 'sedan', def = g.kit.cars[type] || g.kit.cars.sedan, v = new Patrol(def, best.x, best.y, best.h, heavy ? 0x0b0d12 : 0x0d0d0f);
      Object.assign(v, { heat: this, patrol: true, heavy, drive: { pts: best.p, i: 1, blockT: 0, off: 0, ghost: 0, t0: this.t, d0: Math.hypot(best.x - this.lkp.x, best.y - this.lkp.y) }, vf: 9, crew: [], doorK: 0, id: ++this.units, sideSgn: this.rnd() < 0.5 ? 1 : -1 });
      g.vehicles.push(v); this.cars.push(v); if (REAL) this.dressCar(v);
      this.say('dispatch: ' + (heavy ? 'heavy unit' : 'patrol car') + ' ' + v.id + ' from ' + Math.round(v.drive.d0) + ' m, ' + best.p.length + ' points'); return true;
    }
    return false;
  }
  driveCar(v, dt) {
    const g = this.g, D = v.drive, P = D.pts, pl = g.player;
    while (D.i < P.length - 1 && Math.hypot(P[D.i][0] - v.x, P[D.i][1] - v.y) < 6.5) D.i++;
    const tx = P[D.i][0], ty = P[D.i][1], cs = Math.cos(v.h), sn = Math.sin(v.h); let wx = tx, wy = ty;
    if (D.off) { const j = Math.max(1, D.i), sx = P[j][0] - P[j - 1][0], sy = P[j][1] - P[j - 1][1], sl = Math.hypot(sx, sy) || 1; wx += (-sy / sl) * D.off; wy += (sx / sl) * D.off; }
    const dh = wrapPi(Math.atan2(wy - v.y, wx - v.x) - v.h), dScene = Math.hypot(this.lkp.x - v.x, this.lkp.y - v.y), last = D.i >= P.length - 1 && Math.hypot(tx - v.x, ty - v.y) < 9;
    /* speed: quick on the straight, down for the corner ahead, down to nothing behind whatever is in the way */
    let turn = Math.abs(dh); if (D.i + 2 < P.length) turn = Math.max(turn, Math.abs(wrapPi(Math.atan2(P[D.i + 2][1] - P[D.i + 1][1], P[D.i + 2][0] - P[D.i + 1][0]) - v.h)) * 0.8);
    let want = lerp(this.level >= 3 ? 21 : 18, 6.5, clamp(turn / 0.7, 0, 1)), gap = 99; const look = 7 + v.vf * 1.3;
    const test = (ox, oy, rad) => { const dx = ox - v.x, dy = oy - v.y, f = dx * cs + dy * sn; if (f < 1 || f > look + rad) return; if (Math.abs(-dx * sn + dy * cs) > 1.3 + rad * 0.5) return; gap = Math.min(gap, f - v.def.len / 2 - rad); };
    if (D.ghost > 0) D.ghost -= dt; else { for (const o of g.traffic.cars) { if (Math.abs(o.x - v.x) > 40 || Math.abs(o.y - v.y) > 40) continue; test(o.x, o.y, o.def.len * 0.42); } for (const o of g.vehicles) if (o !== v) test(o.x, o.y, o.def.len * 0.42); if (!pl.vehicle) test(pl.x, pl.y, 0.6); }
    if (gap < 99) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 7 * (gap - 1.5))));
    /* stuck behind something: pull out round it; if that fails too, push through */
    if (v.vf < 1.2 && gap < 5) { D.blockT += dt; if (D.blockT > 0.9 && !D.off) { D.off = v.sideSgn * 3.3; D.offT = 5; } if (D.blockT > 3.2) { D.ghost = 2.5; D.blockT = 0; } } else D.blockT = Math.max(0, D.blockT - dt * 0.5);
    if (D.off) { D.offT -= dt; if (D.offT <= 0) D.off = 0; }
    /* at the scene: brake, and swing the nose across the lane */
    const arrive = (dScene < this.stopD && this.los(v.x, v.y, this.lkp.x, this.lkp.y)) || dScene < Math.min(16, this.stopD) || last
      /* a car coming up on one that has already stopped at the scene stops a length short of it, beside it, not behind or in it */
      || (dScene < this.stopD + 14 && this.cars.some((o) => o !== v && !o.drive && o.out && !o.wreck && Math.hypot(o.x - v.x, o.y - v.y) < 10.5 && (o.x - v.x) * cs + (o.y - v.y) * sn > 0));
    if (arrive && !D.stop) { D.stop = true; this.stats.arrive.push(+(this.t - D.t0).toFixed(1)); this.say((v.heavy ? 'heavy unit ' : 'car ') + v.id + ' on scene after ' + (this.t - D.t0).toFixed(1) + ' s (' + Math.round(D.d0) + ' m out)'); }
    if (D.stop) want = 0;
    const acc = clamp(want - v.vf, -(D.stop ? 13 : 9) * dt, 4.2 * dt); v.vf = Math.max(0, v.vf + acc); v.braking = acc < -0.05 || v.vf < 0.3;
    const maxYaw = Math.min(v.vf / 4.6, 7.5 / Math.max(v.vf, 1)); let yaw = clamp(dh * 3.2, -maxYaw, maxYaw); if (D.stop && v.vf > 0.6) yaw = v.sideSgn * Math.min(1.7, 0.5 + v.vf / 3.5); /* the nose swings across the lane as it brakes */
    v.yawV = yaw; v.h = wrapPi(v.h + yaw * dt); v.steer = clamp(Math.atan(yaw * v.def.wheelbase / Math.max(v.vf, 2)), -0.6, 0.6);
    const x0 = v.x, y0 = v.y, h0 = v.h - yaw * dt;
    v.vx = Math.cos(v.h) * v.vf; v.vy = Math.sin(v.h) * v.vf; v.x += v.vx * dt; v.y += v.vy * dt; v.spin += (v.vf * dt) / v.def.radius;
    if (D.stop) { const c2 = Math.cos(v.h), s2 = Math.sin(v.h), hl = v.def.len / 2 + 0.25, hw = Math.min(v.def.wid, 2.1) / 2; let bump = false;
      for (const o of g.parked.near(v.x, v.y, 8, (this._pk3 ||= []))) { const oc = Math.cos(o.h), os = Math.sin(o.h), ol = o.def.len / 2 + 0.15, ow = Math.min(o.def.wid, 2.1) / 2 + 0.15; for (const [lx, ly] of [[hl, hw], [hl, -hw], [hl, 0], [0, hw], [0, -hw], [-hl, hw], [-hl, -hw]]) { const px = v.x + c2 * lx - s2 * ly - o.x, py = v.y + s2 * lx + c2 * ly - o.y; if (Math.abs(px * oc + py * os) < ol && Math.abs(-px * os + py * oc) < ow) { bump = true; break; } } if (bump) break; }
      /* nor into another patrol car (round 7/8 capture: the second car stopped inside the first and its crew was never seen) */
      if (!bump) for (const o of this.cars) { if (o === v || o.wreck) continue; const oc = Math.cos(o.h), os = Math.sin(o.h), ol = o.def.len / 2 + 0.5, ow = Math.min(o.def.wid, 2.1) / 2 + 0.5; for (const [lx, ly] of [[hl, hw], [hl, -hw], [hl, 0], [0, hw], [0, -hw], [-hl, hw], [-hl, -hw], [-hl, 0]]) { const px = v.x + c2 * lx - s2 * ly - o.x, py = v.y + s2 * lx + c2 * ly - o.y; if (Math.abs(px * oc + py * os) < ol && Math.abs(-px * os + py * oc) < ow) { bump = true; break; } } if (bump) break; }
      if (bump) { v.x = x0; v.y = y0; v.h = h0; v.vf = 0; v.vx = v.vy = 0; } }
    if (g.statics.resolve(v.x, v.y, 1.0, _o, D.ghost > 0)) { v.x = _o.x; v.y = _o.y; if (_o.depth > 0.05) v.vf *= 0.9; }
    v.roll += (clamp(-v.vf * yaw * 0.006, -0.06, 0.06) - v.roll) * Math.min(1, dt * 6); v.pitch += (clamp(-acc / dt * 0.004, -0.04, 0.045) - v.pitch) * Math.min(1, dt * 6); v.z = 0;
    if (D.stop && v.vf < 0.25) { v.vf = 0; v.vx = v.vy = 0; v.drive = null; v.parkedT = this.t; this.dismount(v); }
    else if (this.t - D.t0 > 75) { v.drive = null; v.vf = 0; v.vx = v.vy = 0; this.dismount(v); }
  }
  dismount(v) {
    const g = this.g, cs = Math.cos(v.h), sn = Math.sin(v.h), w = Math.min(v.def.wid, 2.0) / 2, n = v.heavy ? 3 : 2; v.doorT = 0; v.out = true;
    for (let i = 0; i < n; i++) { const side = i % 2 ? -1 : 1, f = i < 2 ? 0.55 : -0.75, x = v.x + cs * f - sn * side * (w + 0.62), y = v.y + sn * f + cs * side * (w + 0.62);
      const kind = v.heavy ? (i === 1 ? 'shotgun' : 'rifle') : this.level >= 3 && i === 1 ? 'shotgun' : 'pistol', k = this.addCop(x, y, kind, v, i); if (!k) continue;
      k.h = v.h; k.post = { x, y }; k.cover = { car: v, side, door: i < 2 && !v.heavy }; k.mode = 'hold'; k.up = 1; v.crew.push(k);
      /* out of the seat with the kit's get-out motion: carried from the seat to the door as the body unfolds (the far side is the mirror of it) */
      let st = [0.1, 0.38, 0.3]; try { st = g.seatOf(v, k.who || 'player'); } catch (e) {} const dur = (k.vis && k.vis.acts && k.vis.acts.getout && k.vis.dur && k.vis.dur.getout) || 1.25, sf = st[0] + (i < 2 ? 0 : -0.95);
      k.get = { t: -0.12 * i, dur, side, x0: v.x + cs * sf - sn * side * st[1], y0: v.y + sn * sf + cs * side * st[1], z0: (v.z || 0) + st[2], x1: x, y1: y, anim: !!(k.vis && k.vis.acts && k.vis.acts.getout) }; k.x = k.get.x0; k.y = k.get.y0; k.z = k.get.z0; }
    this.shout(this.pick(this.level >= 2 && this.c.slot !== 'unarmed' ? ['Gun! He has a gun! Cover!', 'Out of the car! Cover!', 'Shots fired! Get behind the doors!'] : ['POLICE! Do not move!', 'Out of the car! Cover!', 'Police! Get on the ground!']), 1);
  }
  stepCar(v, dt, i) {
    const g = this.g, pl = g.player; if (!g.vehicles.includes(v)) { if (v.wreck || v.left) { this.cars.splice(i, 1); this.undressCar(v); return; } g.vehicles.push(v); }
    if (v.out) v.doorK = Math.min(1, v.doorK + dt / 0.4);
    if (v.wreck) { v.drive = null; return; }
    if (pl.vehicle === v) { v.stolen = true; v.drive = null; return; }
    if (this.level === 0 && !v.drive) { v.leaveT = (v.leaveT || 0) + dt; const crew = v.crew.filter((k) => k.hp > 0), d = Math.hypot(v.x - pl.x, v.y - pl.y);
      /* the crew is back (or gone): shut the doors, and when nobody is looking the car is gone */
      if (!crew.length || v.leaveT > 25) { v.doorK = Math.max(0, v.doorK - dt / 0.3); v.out = false; if ((d > 70 && !this.los(pl.x, pl.y, v.x, v.y)) || d > 160 || v.leaveT > 90) { v.left = true; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); } } }
  }

  // ------------------------------------------------------------------ officers
  addCop(x, y, kind, car, i) {
    const g = this.g, k = { x, y, h: 0, z: 0, hp: 100, state: 'walk', kind: 'cop', gunK: kind, G: GUN[kind], W: WEAPONS[kind], car, post: null, mode: 'move', up: 1, aim: 0, fireCd: this.rr(0.4, 1.0), burst: 0, mag: GUN[kind].mag, relT: 0, speed: 0, see: false, dist: 99, onT: 0, supp: 0, thinkT: this.rr(0.2, 0.8), scale: 1, tall: 1.06, id: i, t: 0, fall: 0, vx: 0, vy: 0, phase: 0, back: 0, rise: 0, heavy: !!(car && car.heavy) || kind === 'rifle', bornT: this.t, flankT: this.rr(3, 8), n: this.cops.length };
    g.statics.resolve(x, y, 0.34, _o); k.x = _o.x; k.y = _o.y; k.h = Math.atan2(this.lkp.y - y, this.lkp.x - x);
    if (REAL) { try { this.dressCop(k); } catch (e) { this.oops('cop', e); } }
    this.cops.push(k); return k;
  }
  release(k) { if (k.vis) { k.vis.object.visible = false; if (k.capO) k.capO.group.visible = false; if (k.gun) k.gun.visible = false; if (k.vestO) k.vestO.visible = false; if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; this.pool.push({ vis: k.vis, rig: k.rig, cap: k.capO || null, vest: k.vestO, guns: k.guns, who: k.who, belt: k.beltO, badge: k.badgeO }); k.vis = null; } }
  /* does the line a -> b cross this car's body (seen from above)? */
  segBox(v, ax, ay, bx, by, pad) {
    const cs = Math.cos(v.h), sn = Math.sin(v.h), hx = v.def.len / 2 + pad, hy = Math.min(v.def.wid, 2.1) / 2 + pad, tl = (x, y) => [(x - v.x) * cs + (y - v.y) * sn, -(x - v.x) * sn + (y - v.y) * cs], A = tl(ax, ay), B = tl(bx, by); let t0 = 0, t1 = 1;
    for (const [a, d, h] of [[A[0], B[0] - A[0], hx], [A[1], B[1] - A[1], hy]]) { if (Math.abs(d) < 1e-9) { if (Math.abs(a) > h) return false; continue; } let u0 = (-h - a) / d, u1 = (h - a) / d; if (u0 > u1) { const q = u0; u0 = u1; u1 = q; } t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return false; }
    return true;
  }
  /* who they are hiding from */
  threat() { return this.seen || !this.level ? this.g.player : this.lkp; }
  /* is this officer's cover still between him (or the place he is going to) and the gun? */
  covered(k) {
    const cv = k.cover; if (!cv || !cv.car) return false; const T = this.threat(), px = k.post ? k.post.x : k.x, py = k.post ? k.post.y : k.y; if (this.segBox(cv.car, T.x, T.y, px, py, 0)) return true;
    if (cv.door && cv.car.doorK > 0.5 && ((T.x - cv.car.x) * Math.cos(cv.car.h) + (T.y - cv.car.y) * Math.sin(cv.car.h)) > 0.6 * Math.hypot(T.x - cv.car.x, T.y - cv.car.y)) { const s = this.doorSeg(cv.car, cv.side), d1 = (s[2] - s[0]) * (T.y - s[1]) - (s[3] - s[1]) * (T.x - s[0]), d2 = (s[2] - s[0]) * (py - s[1]) - (s[3] - s[1]) * (px - s[0]), d3 = (px - T.x) * (s[1] - T.y) - (py - T.y) * (s[0] - T.x), d4 = (px - T.x) * (s[3] - T.y) - (py - T.y) * (s[2] - T.x); if (d1 * d2 < 0 && d3 * d4 < 0) return true; }
    return false;
  }
  /* somewhere out of the line of fire within r of (x, y): behind a car, at the end of it one can fire over (bonnet or boot), the car
     between oneself and the gun; not a place a mate already has */
  coverNear(x, y, r, k, clear) {
    const g = this.g, pl = g.player, T = this.threat(); let best = null, bs = 1e9;
    const one = (v) => { if ((v.wreck && v.z > 0.5) || v === pl.vehicle) return; if (Math.hypot(v.x - x, v.y - y) > r + 3.5) return; const dT = Math.hypot(v.x - T.x, v.y - T.y); if (dT < 5.5) return;
      const cs = Math.cos(v.h), sn = Math.sin(v.h), hl = v.def.len / 2, hw = Math.min(v.def.wid, 2.1) / 2, tall = 0; if (v.def.hgt >= 1.9) return; /* a van hides the suspect from him too: no use */
      for (const [lx, ly] of [[hl - 0.5, hw + 0.5], [-(hl - 0.5), hw + 0.5], [hl - 0.5, -(hw + 0.5)], [-(hl - 0.5), -(hw + 0.5)], [hl + 0.55, 0.3], [-(hl + 0.55), -0.3]]) {
        let px = v.x + lx * cs - ly * sn, py = v.y + lx * sn + ly * cs; const d = Math.hypot(px - x, py - y); if (d > r) continue; if (!this.segBox(v, T.x, T.y, px, py, -0.05)) continue; /* a place to fight from: he must be in view from it */ if (!this.los(px, py, T.x, T.y)) continue;
        if (g.statics.resolve(px, py, 0.3, _o) > 0) { if (Math.hypot(_o.x - px, _o.y - py) > 0.35) continue; px = _o.x; py = _o.y; }
        if (clear && (Math.hypot(px - k.x, py - k.y) < 1.5 || !this.clearFrom(px, py))) continue;
        let sc = d + tall; for (const q of this.cops) if (q !== k && q.hp > 0 && q.post && Math.hypot(q.post.x - px, q.post.y - py) < 1.2) sc += 40;
        if (sc < bs) { bs = sc; best = { x: px, y: py, cover: { car: v, any: true } }; } } };
    for (const v of g.parked.near(x, y, r + 4, (this._pk ||= []))) one(v); for (const v of g.vehicles) if (Math.hypot(v.vx || 0, v.vy || 0) < 0.5 && !v.drive) one(v);
    return bs < 30 ? best : null;
  }
  /* they expect to be shot at: the heat is past the first step, or he has a gun out */
  hot() { return this.level >= 2 || (this.level === 1 && this.c.slot !== 'unarmed'); }
  go(k, cv, px, py) { k.post = cv ? { x: cv.x, y: cv.y } : { x: px, y: py }; k.cover = cv ? cv.cover : null; k.mode = 'move'; k.path = null; k.dodge = false; }
  think(k) {
    const g = this.g, pl = g.player, L = this.level, G = k.G; k.thinkT = this.rr(0.6, 1.1); if (k.get) return;
    if (L === 0) { k.mode = 'leave'; return; }
    const tx = this.seen ? pl.x : this.lkp.x, ty = this.seen ? pl.y : this.lkp.y, d = Math.hypot(tx - k.x, ty - k.y), ang = Math.atan2(k.y - ty, k.x - tx);
    if (!this.seen && this.unseenT > 3) {
      /* searching: to where he was last seen, then on in the way he was heading and round about */
      if (k.mode !== 'search' || Math.hypot(k.post.x - k.x, k.post.y - k.y) < 2.5) { const a = this.lkp.h + this.rr(-1.3, 1.3), r = k.mode === 'search' ? this.rr(8, AREA[L] * 0.5) : this.rr(0, 5) + k.n * 2; k.post = { x: this.lkp.x + Math.cos(a) * r, y: this.lkp.y + Math.sin(a) * r }; k.cover = null; k.mode = 'search'; k.path = null; }
      return; }
    if (k.mode === 'move' && k.cover && k.post && this.unseenT < 6 && Math.hypot(k.post.x - k.x, k.post.y - k.y) > 1.2) return;
    if (!k.see && d > 12) { if (k.mode !== 'move' || !k.post || Math.hypot(k.post.x - tx, k.post.y - ty) > 14) { k.post = { x: tx + Math.cos(ang + this.rr(-0.5, 0.5)) * 8, y: ty + Math.sin(ang + this.rr(-0.5, 0.5)) * 8 }; k.cover = null; k.mode = 'move'; k.path = null; } return; }
    /* in the fight: from cover whenever there is some; close up by bounds from one car to the next; one of a pair works round the side */
    const hot = this.hot(), far = d > G.band[1] + (L === 1 ? -4 : 0), near = d < 5, mate = this.cops.find((q) => q !== k && q.hp > 0 && q.car === k.car && q.mode === 'move'), at = k.post ? Math.hypot(k.post.x - k.x, k.post.y - k.y) : 0;
    if (k.mode === 'move' && k.post && at < 1.2) k.mode = 'hold';
    if (k.mode === 'hold' && k.see) { k.flankT -= k.thinkT; }
    if (hot && k.see && !(k.mode === 'move' && k.cover && this.covered(k))) {
      /* nothing between him and the gun: the nearest thing that will stop a bullet, now */
      if (!k.cover || !this.covered(k)) { const cv = this.coverNear(k.x, k.y, k.cover ? 10 : 18, k); if (cv) { const dc = Math.hypot(cv.x - k.x, cv.y - k.y); /* a long way to it and a mate already running: kneel and cover him, then go */ if (dc > 5 && this.cops.some((q) => q !== k && q.hp > 0 && q.mode === 'move' && q.see && Math.hypot(q.x - k.x, q.y - k.y) < 30)) { k.over = true; return; } k.over = false; if (dc > 0.7) { this.go(k, cv); if (this.rnd() < 0.3) this.shout(this.pick(['Cover! Get to cover!', 'Get behind the car!', 'Take cover!']), 0); return; } k.cover = cv.cover; k.post = { x: cv.x, y: cv.y }; } else if (k.cover && !k.cover.door) k.cover = null; }
    }
    if (k.mode === 'move' && at >= 1.2 && k.see && (k.cover || !hot || at < 12)) return;
    /* nothing to shoot at from here (his own cover hides him): another car with a line to him, or failing that a place in the open, low */
    if (hot && k.mode === 'hold' && (k.blockN || 0) >= 2 && this.t - (k.blockedT || -9) < 2) { k.blockN = 0; const cv = this.coverNear(k.x, k.y, 24, k, true); if (cv) { this.go(k, cv); this.shout(this.pick(['No shot! Moving!', 'I have no angle, shifting!']), 0); return; }
      let best = null, bd = 1e9; for (let i = 0; i < 10; i++) { const a2 = ang + (i % 2 ? 1 : -1) * (0.35 + 0.3 * (i >> 1)), r = clamp(d, G.band[0] + 2, G.band[1]), px = tx + Math.cos(a2) * r, py = ty + Math.sin(a2) * r, dd = Math.hypot(px - k.x, py - k.y); if (dd < bd && g.statics.raycast(k.x, k.y, px, py) >= 1 && !(g.statics.resolve(px, py, 0.4, _o) > 0) && this.clearFrom(px, py)) { bd = dd; best = [px, py]; } }
      if (best) { this.go(k, null, best[0], best[1]); this.shout(this.pick(['Going round the side!', 'I will take the far side!']), 0); return; } }
    if ((far && !mate) || k.mode === 'search' || (k.mode === 'move' && !k.cover && hot)) { const step = Math.min(d - G.band[0], this.rr(7, 11)), px = k.x - Math.cos(ang) * step, py = k.y - Math.sin(ang) * step; let cv = this.coverNear(px, py, 8, k); if (cv && Math.hypot(cv.x - tx, cv.y - ty) > d - 2) cv = null; if (!cv && this.t < (k.holdT || 0)) return;
      /* no car to run to: stay down and shoot from here unless he is out of reach, and then only one of them moves at a time */
      if (cv || !hot || (!k.cover && d > G.band[1] + 7 && !this.cops.some((q) => q !== k && q.hp > 0 && q.mode === 'move' && q.see))) { this.go(k, cv, px, py); if (this.rnd() < 0.5) this.shout(this.pick(['Moving up!', 'Cover me, I am moving!', 'Push up! Push up!']), 0); } else { k.flankT -= 1.5; if (k.mode !== 'hold') { k.mode = 'hold'; k.post = { x: k.x, y: k.y }; } }
      return; }
    if (k.flankT <= 0 && L >= 2 && !near && k.mode === 'hold') { k.flankT = this.rr(9, 15); const side = k.n % 2 ? 1 : -1, a2 = ang + side * this.rr(0.9, 1.3), r = clamp(d * 0.85, G.band[0], G.band[1]), px = tx + Math.cos(a2) * r, py = ty + Math.sin(a2) * r;
      if (g.statics.raycast(k.x, k.y, px, py) >= 1) { const cv = this.coverNear(px, py, 9, k); if (cv || !k.cover) { this.go(k, cv, px, py); this.shout(this.pick(['Going round the side!', 'Flanking left, keep him busy!', 'I will take the far side!']), 0); } } return; }
  }
  canFire(k) {
    const c = this.c, L = this.level; if (L >= 2) return true; if (L < 1) return false;
    /* one step of heat: a challenge first. Fire only on someone armed who has had his warning, or who has just fired */
    if (this.t - (this.firedSeenT ?? -99) < 8) return true;
    return !!this.chal && this.t - this.chal.t0 > 4.2 && c.slot !== 'unarmed';
  }
  stepCop(k, dt) {
    const g = this.g, pl = g.player, c = this.c, G = k.G; k.t += dt; k.supp = Math.max(0, k.supp - dt);
    if (k.get) { const q = k.get; q.t += dt; const m = sm((q.t / q.dur - 0.1) / 0.6); k.x = lerp(q.x0, q.x1, m); k.y = lerp(q.y0, q.y1, m); k.z = lerp(q.z0, g.statics.onSidewalk(q.x1, q.y1) ? 0.15 : 0, m); k.h = q.h ?? (q.h = k.car ? k.car.h : k.h); k.speed = 0; k.aim = 0; k.up = 1; /* in front of a gun nobody finishes the clip's standing up straight: out at three quarters of it, already going low, gun coming up (rounds 7 and 8: 'bolt upright, arms at sides, while being shot') */ const hotOut = this.level >= 2 && this.c.slot !== 'unarmed'; if (q.t >= q.dur * (hotOut ? 0.72 : 1)) { k.get = null; k.outT = this.t; k.fireCd = hotOut ? this.rr(0.12, 0.4) : this.rr(0.25, 0.7); k.thinkT = 0.03 + 0.15 * (k.id || 0); if (hotOut) { k.up = 0.7; k.aim = 0.45; } } return; }
    k.thinkT -= dt; if (k.thinkT <= 0) this.think(k);
    /* shot at in the open: a quick step to the side (toward cover if there is some) and keep firing */
    if (k.supp > 0.5 && !k.cover && k.mode === 'hold' && k.see && this.t - (k.dodgeT || -9) > 1.6) { k.dodgeT = this.t; const a = Math.atan2(pl.y - k.y, pl.x - k.x) + (this.rnd() < 0.5 ? 1 : -1) * Math.PI / 2, r = this.rr(2.2, 3.6), px = k.x + Math.cos(a) * r, py = k.y + Math.sin(a) * r, cv = this.coverNear(k.x, k.y, 14, k);
      /* a car within reach: behind it. Nothing: stay down and shoot back (a side step in the open only gets him shot while not shooting) */
      if (cv) this.go(k, cv, px, py); }
    /* the challenge, and the arrest of someone unarmed who stands still for it */
    if (this.level === 1 && k.see && k.dist < 26 && !this.chal) { this.chal = { t0: this.t }; this.shout(c.slot !== 'unarmed' ? 'POLICE! Drop the weapon! Drop it NOW!' : 'POLICE! Stay where you are! Hands!', 2); }
    if (this.level === 1 && this.chal && !this.dead && c.slot === 'unarmed' && !pl.vehicle && k.see) { if (k.dist < 2.2 && pl.speed < 0.6) { this.arrest(); return; } if (k.dist > 2 && (k.mode === 'hold' || !k.post || Math.hypot(k.post.x - pl.x, k.post.y - pl.y) > 1.5)) { k.post = { x: pl.x, y: pl.y }; k.cover = null; k.mode = 'move'; k.path = null; } }
    if (k.mode === 'move' && !k.cover && k.see && k.dist < 48 && this.t - this.lastShotT < 1.2 && this.t > (k.holdT || 0) + 3 && this.hot() && this.canFire(k)
      /* not a man just out of a car that he can be behind in two seconds: he keeps going round it (rounds 10-12: 'kneels in the open in front of his own car, on the player's side') */
      && !(k.car && !k.car.wreck && this.t - (k.outT ?? -99) < 5 && Math.hypot(k.x - k.car.x, k.y - k.car.y) < 5.5)) { k.mode = 'hold'; k.post = { x: k.x, y: k.y }; k.holdT = this.t + this.rr(1.8, 2.8); k.fireCd = Math.min(k.fireCd, this.rr(0.2, 0.4)); k.aim = Math.max(k.aim, 0.5); }
    let sp = 0;
    if (k.mode === 'leave') { const car = k.car && !k.car.wreck && !k.car.stolen ? k.car : null, tx = car ? car.x : k.x + Math.cos(k.h) * 30, ty = car ? car.y : k.y + Math.sin(k.h) * 30; if (!k.post || !k.leaving) { k.leaving = true; k.post = car ? { x: k.x + (car.x - k.x) * 0.75, y: k.y + (car.y - k.y) * 0.75 } : { x: tx, y: ty }; if (!car) k.h += Math.PI; }
      const d = Math.hypot(pl.x - k.x, pl.y - k.y); if ((car && Math.hypot(car.x - k.x, car.y - k.y) < 2.4) || (!car && ((d > 45 && !this.los(pl.x, pl.y, k.x, k.y)) || d > 110 || this.t - k.bornT > 400))) { k.hp = 0; k.gone = true; const i = this.cops.indexOf(k); if (i >= 0) this.cops.splice(i, 1); this.release(k); return; }
      sp = this.walkTo(k, car ? car.x : k.post.x, car ? car.y : k.post.y, 1.5, dt, 1.2); k.aim = Math.max(0, k.aim - dt * 3); k.up = Math.min(1, k.up + dt * 3); k.speed = sp; return; }
    if (this.dead && !this.dead.arrest && !this.dead.woke && k.see && !k.closing) { k.closing = true; const d = k.dist || 9, r = Math.max(0, d - 3.2 - (k.n % 3) * 0.9); k.post = { x: k.x + (pl.x - k.x) / (d || 1) * r, y: k.y + (pl.y - k.y) / (d || 1) * r }; k.cover = null; k.mode = 'move'; k.path = null; if (k.n % 2 === 0) this.shout(this.pick(['Suspect down. Moving up on him.', 'He is down! Cover me.', 'Hold fire! Hold fire! He is down.']), 2); }
    const fire = k.see && this.canFire(k) && !this.dead, at = k.post ? Math.hypot(k.post.x - k.x, k.post.y - k.y) : 0;
    if ((k.mode === 'move' || k.mode === 'search') && k.post && at > 0.6) { const arr = (this.level === 1 && this.chal && c.slot === 'unarmed') || (k.closing && !!this.dead), run = arr ? 1.7 : k.mode === 'search' ? 2.7 : k.dodge ? 2.9 : at > 3.5 || !k.see ? 4.4 : 2.7, x0 = k.x, y0 = k.y; sp = this.walkTo(k, k.post.x, k.post.y, run, dt, 0.5); /* the speed the legs show is the ground really covered */ sp = Math.min(sp, Math.hypot(k.x - x0, k.y - y0) / dt + 0.4); }
    else if (k.mode === 'move') { k.mode = 'hold'; k.dodge = false; }
    /* face: where one is going, or the target once it matters */
    const facing = sp > 1.9 ? null : this.seen || this.unseenT < 6 ? Math.atan2((this.seen ? pl.y : this.lkp.y) - k.y, (this.seen ? pl.x : this.lkp.x) - k.x) : null;
    if (facing !== null) k.h += clamp(wrapPi(facing - k.h), -dt * 7, dt * 7);
    k.aim = clamp(k.aim + ((fire || (k.see && this.level >= 1)) && sp < 1.9 && k.relT <= 0 ? dt / 0.3 : -dt / 0.35), 0, 1);
    /* behind cover one stays low between bursts, under fire, and while the magazine is changed */
    const hotN = this.hot(), mvLow = sp > 0.5 && (k.see || this.seen) && hotN, inCov = k.cover && k.mode === 'hold', low = (inCov || (hotN && k.mode === 'hold')) && (k.burst <= 0 && k.fireCd > 0.35 || k.supp > 0 || k.relT > 0 || !k.see);
    /* how upright: behind a car one fires over the bonnet or boot, half up; in the open one kneels between bursts; on the move in his sights one runs bent low */
    const top = inCov && k.cover.any ? 0.8 : inCov && k.cover.door ? 0.92 : hotN && k.mode === 'hold' && !inCov && !k.cover ? 0.62 : 1, tgt = mvLow ? 0.5 : low ? (!inCov ? 0.55 : k.cover.door ? 0.34 : 0.3) : top; k.up += clamp(tgt - k.up, -dt * 4.5, dt * 4.5);
    if (k.relT > 0) { k.relT -= dt; if (k.relT <= 0) k.mag = G.mag; }
    k.fireCd -= dt; k.back *= Math.exp(-dt * 14); k.rise *= Math.exp(-dt * 10);
    if (fire && k.relT <= 0 && k.fireCd <= 0 && k.aim > 0.9 && k.up > top - 0.12 && sp < 1.9) {
      if (k.mag <= 0) { k.relT = 2.1; k.burst = 0; if (this.rnd() < 0.5) this.shout(this.pick(['Reloading!', 'Changing mag, cover me!']), 0); }
      else { if (k.burst <= 0) k.burst = Math.round(this.rr(G.burst[0], G.burst[1] + 0.49)); if (this.copShoot(k) === false) return; k.burst--; k.mag--; k.fireCd = k.burst > 0 ? this.rr(G.gap[0], G.gap[1]) : this.rr(G.rest[0], G.rest[1]) * (this.level >= 4 ? 0.75 : 1); }
    }
    k.speed = sp;
    /* the numbers: seconds in his sights behind something, in the open low, in the open upright and moving */
    if (k.see && this.hot()) { const S = this.stats; if (S.contactT === null) S.contactT = +this.t.toFixed(1); if (k.cover && this.covered(k) && sp < 0.5) S.tCov += dt; else if (sp > 0.5) { if (k.up > 0.66) S.tOpenUp += dt; else S.tOpenLow += dt; } else S.tStill += dt; }
    /* run down by the player's car */
    const v = pl.vehicle; if (v) { const vs = Math.hypot(v.vx, v.vy); if (vs > 4) { const dx = k.x - v.x, dy = k.y - v.y, cs = Math.cos(v.h), sn = Math.sin(v.h); if (Math.abs(dx * cs + dy * sn) < v.def.len / 2 + 0.3 && Math.abs(-dx * sn + dy * cs) < v.def.wid / 2 + 0.25) this.downCop(k, { x: k.x, y: k.y, z: 0.7, dx: v.vx / vs, dy: v.vy / vs, dz: 0.3, part: 'legs' }, 3); } }
  }
  // walk or run toward a point: round the corner by the streets when a wall is in the way; out of cars; not through each other
  walkTo(k, tx, ty, sp, dt, stop) {
    const g = this.g, st = g.statics; let gx = tx, gy = ty;
    if (st.raycast(k.x, k.y, tx, ty) < 1) { k.pathT = (k.pathT || 0) - dt; if (!k.path || k.pathT <= 0) { k.pathT = 2.5; k.path = this.pathNodes(k.x, k.y, tx, ty); }
      const P = k.path; if (P && P.length) { while (P.length > 1 && (Math.hypot(P[0][0] - k.x, P[0][1] - k.y) < 5 || st.raycast(k.x, k.y, P[1][0], P[1][1]) >= 1)) P.shift(); gx = P[0][0]; gy = P[0][1]; } } else k.path = null;
    /* a car in the way (his own patrol car, a parked one): round the nearer end of it, not into its side */
    { const D0 = Math.hypot(gx - k.x, gy - k.y); if (D0 > 1.2) { let blk = null; const tryV = (v) => { if (blk || Math.abs(v.x - k.x) > 9 || Math.abs(v.y - k.y) > 9 || (v.drive && v.vf > 1)) return; if (this.segBox(v, k.x, k.y, gx, gy, 0.22)) blk = v; };
        for (const v of g.vehicles) tryV(v); if (!blk) for (const v of g.parked.near(k.x, k.y, 7, (this._pk4 ||= []))) tryV(v);
        if (blk) { const cs = Math.cos(blk.h), sn = Math.sin(blk.h), hl = blk.def.len / 2 + 0.62, hw = Math.min(blk.def.wid, 2.1) / 2 + 0.62; let bc = null, bd = 1e9;
          for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) { const cx = blk.x + lx * cs - ly * sn, cy = blk.y + lx * sn + ly * cs, d1 = Math.hypot(cx - k.x, cy - k.y); if (d1 < 0.35) continue; if (this.segBox(blk, k.x, k.y, cx, cy, 0.2)) continue; if (st.resolve(cx, cy, 0.3, _o) > 0.3) continue; const dd = d1 + Math.hypot(gx - cx, gy - cy) + (this.segBox(blk, cx, cy, gx, gy, 0.2) ? 3 : 0); if (dd < bd) { bd = dd; bc = [cx, cy]; } }
          if (bc) { gx = bc[0]; gy = bc[1]; } } } }
    const dx = gx - k.x, dy = gy - k.y, d = Math.hypot(dx, dy); if (d < stop && gx === tx) return 0;
    const a = Math.atan2(dy, dx); if (!k.see || sp > 1.9) k.h += clamp(wrapPi(a - k.h), -dt * 9, dt * 9);
    const s = Math.min(sp, d / dt); st.resolve(k.x + (dx / (d || 1)) * s * dt, k.y + (dy / (d || 1)) * s * dt, 0.32, _o); k.x = _o.x; k.y = _o.y;
    const box = (v, pad) => { const cs = Math.cos(v.h), sn = Math.sin(v.h), ex = k.x - v.x, ey = k.y - v.y, lx = ex * cs + ey * sn, ly = -ex * sn + ey * cs, hx = v.def.len / 2 + pad, hy = v.def.wid * 0.45 + pad; if (Math.abs(lx) < hx && Math.abs(ly) < hy) { let nx = lx, ny = ly; if (hx - Math.abs(lx) < hy - Math.abs(ly)) nx = Math.sign(lx || 1) * hx; else ny = Math.sign(ly || 1) * hy; k.x = v.x + nx * cs - ny * sn; k.y = v.y + nx * sn + ny * cs; } };
    for (const v of g.parked.near(k.x, k.y, 6, (this._pk2 ||= []))) box(v, 0.3); for (const v of g.vehicles) if (Math.abs(v.x - k.x) < 8 && Math.abs(v.y - k.y) < 8) box(v, 0.3); for (const v of g.traffic.cars) if (Math.abs(v.x - k.x) < 8 && Math.abs(v.y - k.y) < 8) box(v, 0.35);
    for (const q of this.cops) if (q !== k && q.hp > 0) { const ex = k.x - q.x, ey = k.y - q.y, dd = Math.hypot(ex, ey); if (dd < 0.7 && dd > 1e-3) { k.x += (ex / dd) * (0.7 - dd) * 0.5; k.y += (ey / dd) * (0.7 - dd) * 0.5; } }
    k.z = st.onSidewalk(k.x, k.y) ? 0.15 : 0;
    /* not getting anywhere: a step to one side and try again; after three of those, fight from here */
    if (this.t - (k.stT || 0) > 0.8) { if (k.stT && this.t - k.stT < 1.2 && Math.hypot(k.x - k.stX, k.y - k.stY) < 0.45) { k.stN = (k.stN || 0) + 1; if (k.stN >= 3) { k.stN = 0; k.post = { x: k.x, y: k.y }; k.cover = null; k.mode = 'hold'; k.path = null; } else { const sgn = k.stN % 2 ? 1 : -1; st.resolve(k.x - (dy / (d || 1)) * sgn * 0.9, k.y + (dx / (d || 1)) * sgn * 0.9, 0.32, _o); k.x = _o.x; k.y = _o.y; k.path = null; } } else if (Math.hypot(k.x - (k.stX ?? 1e9), k.y - (k.stY ?? 1e9)) > 2) k.stN = 0; k.stT = this.t; k.stX = k.x; k.stY = k.y; }
    return s;
  }
  /* the way on foot when a wall is between: junction to junction along the streets (either way along a one-way street), from a
     junction one can see to a junction that can see the place */
  pathNodes(x0, y0, x1, y1) {
    const R = this.g.roads, st = this.g.statics, N = R.nodes, n = N.length, dist = new Float64Array(n).fill(1e18), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), goal = new Float64Array(n).fill(-1);
    let any = false, anyG = false;
    for (let i = 0; i < n; i++) { const p = N[i].p, d0 = Math.hypot(p[0] - x0, p[1] - y0), d1 = Math.hypot(p[0] - x1, p[1] - y1); if (d0 < 130 && st.raycast(x0, y0, p[0], p[1]) >= 1) { dist[i] = d0; any = true; } if (d1 < 130 && st.raycast(x1, y1, p[0], p[1]) >= 1) { goal[i] = d1; anyG = true; } }
    if (!any || !anyG) return null; let end = -1, bestD = 1e18;
    for (;;) { let u = -1, bd = 1e18; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; } if (u < 0 || bd >= bestD) break; done[u] = 1; if (goal[u] >= 0 && bd + goal[u] < bestD) { bestD = bd + goal[u]; end = u; }
      for (const ei of N[u].e) { const e = R.edges[ei], w = e.a === u ? e.b : e.a, nd = bd + e.len; if (nd < dist[w]) { dist[w] = nd; prev[w] = u; } } }
    if (end < 0) return null; const out = [[x1, y1]]; for (let u = end; u >= 0; u = prev[u]) out.unshift([N[u].p[0], N[u].p[1]]); return out;
  }

  // ------------------------------------------------------------------ shooting, both ways
  /* can a round from (ox, oy, oz) reach the height tz of the player? (a car within arm's reach of the muzzle is the cover being fired over) */
  lineClear(ox, oy, oz, tz) { const c = this.c, pl = this.g.player, ex = pl.x - ox, ey = pl.y - oy, dz = tz - oz, l = Math.hypot(ex, ey, dz) || 1; this.copFire = true; let h; try { h = c.cast(ox, oy, oz, ex / l, ey / l, dz / l, 0.4, l); for (let q = 0; q < 3 && h.kind === 'car' && h.t < 4.5; q++) h = c.cast(ox, oy, oz, ex / l, ey / l, dz / l, h.t + 0.3, l); } finally { this.copFire = false; } return h.t >= l - 0.4; }
  clearFrom(x, y) { const pl = this.g.player, pz = this.g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0, z = (this.g.statics.onSidewalk(x, y) ? 0.15 : 0) + 1.3; return this.lineClear(x, y, z, pz + 1.2) || this.lineClear(x, y, z, pz + 1.6); }
  muzzleOf(k, out) { if (k.gun && k.gun.visible && k.vis && k.vis.object.visible) { k.gun.updateMatrixWorld(true); out.copy(k.gun.userData.muzzle).applyMatrix4(k.gun.matrixWorld); if (Math.abs(out.x - k.x) < 1.5 && Math.abs(-out.z - k.y) < 1.5) return out; } const a = k.h; return out.set(k.x + Math.cos(a) * 0.55, k.z + 0.55 + 0.9 * k.up, -(k.y + Math.sin(a) * 0.55)); }
  copShoot(k) {
    const g = this.g, c = this.c, pl = g.player, G = k.G, W = k.W, mz = this.muzzleOf(k, new THREE.Vector3()), ox = mz.x, oy = -mz.z, oz = mz.y;
    const pz = (g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0), inCar = !!pl.vehicle, ex = pl.x - ox, ey = pl.y - oy; let tz = pz + (inCar ? 0.95 : 1.2), ez = tz - oz, L = Math.hypot(ex, ey, ez) || 1;
    /* what can be seen of him: the chest, or over a car only the head and shoulders; nothing at all means work round instead */
    if (!inCar) { const clear = (z) => { const dz = z - oz, l = Math.hypot(ex, ey, dz) || 1; this.copFire = true; let h; try { h = c.cast(ox, oy, oz, ex / l, ey / l, dz / l, 0.4, l); for (let q = 0; q < 3 && h.kind === 'car' && h.t < 4.5; q++) h = c.cast(ox, oy, oz, ex / l, ey / l, dz / l, h.t + 0.3, l); } finally { this.copFire = false; } return h.t >= l - 0.4; };
      if (!clear(tz)) { if (clear(pz + 1.6)) { tz = pz + 1.6; ez = tz - oz; L = Math.hypot(ex, ey, ez) || 1; k.high = true; } else { k.flankT -= 2.5; k.burst = 0; k.fireCd = this.rr(0.5, 1.0); k.blockedT = this.t; k.blockN = (k.blockN || 0) + 1; this.stats.blocked++; return false; } } else k.high = false; }
    /* how well: worse on the first rounds, on a moving target, under fire; better as the heat rises */
    const sig = G.sig * Math.pow(clamp(15 / Math.max(L, 3), 0.45, 1.5), 0.6) * (1.18 - 0.07 * this.level) * (1 + 1.0 * Math.exp(-k.onT / 0.9)) * (pl.speed > 3 || (inCar && Math.abs(pl.vehicle.vf) > 6) ? 1.7 : pl.speed > 1 ? 1.25 : 1) * (k.supp > 0 ? 1.6 : 1) * D2R;
    const n = G.pellets || 1; let hitP = 0; this.stats.copShots++; k.blockN = 0;
    const cam = g.world.camera, pan = clamp(Math.sin(wrapPi(Math.atan2(k.y - pl.y, k.x - pl.x) - g.cam.yaw)) * -0.8, -1, 1);
    for (let i = 0; i < n; i++) {
      let a = Math.atan2(ey, ex) + this.gauss() * sig, e = Math.asin(clamp(ez / L, -1, 1)) + this.gauss() * sig * (k.high ? 0.45 : 0.75);
      /* a round that is going wide often goes low: it strikes the ground a few steps short of him, where he can see it */
      if (!inCar && Math.abs(wrapPi(a - Math.atan2(ey, ex))) * L > 0.45 && this.rnd() < 0.6) { const sh = this.rr(1.2, 4.5), lat = this.rr(-1.6, 1.6), gx = pl.x - (ex / L) * sh - (ey / L) * lat, gy = pl.y - (ey / L) * sh + (ex / L) * lat, gl = Math.hypot(gx - ox, gy - oy); a = Math.atan2(gy - oy, gx - ox); e = Math.atan2(pz - oz, gl); }
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(a) * Math.cos(e), dz = Math.sin(e);
      /* the player's own body first (a cylinder, as everyone is), then whatever else the bullet meets on the way */
      let tp = -1; if (!inCar) { const rx = ox - pl.x, ry = oy - pl.y, A = dx * dx + dy * dy, B = rx * dx + ry * dy, Cc = rx * rx + ry * ry - 0.27 * 0.27, disc = B * B - A * Cc; if (disc >= 0 && A > 1e-9) { const t = (-B - Math.sqrt(disc)) / A, z = oz + dz * t - pz; if (t > 0 && z > 0 && z < 1.78) tp = t; } }
      /* (a car within arm's reach of the muzzle is the cover being fired over, not in the way) */
      this.copFire = true; let h; try { h = c.cast(ox, oy, oz, dx, dy, dz, 0.4, W.range); for (let q = 0; q < 3 && h.kind === 'car' && h.t < 4.5; q++) h = c.cast(ox, oy, oz, dx, dy, dz, h.t + 0.3, W.range); } finally { this.copFire = false; }
      if (tp > 0 && tp < h.t) { hitP++; const P = _v.set(ox + dx * tp, oz + dz * tp, -(oy + dy * tp)); try { c.fx.impact(P, _v2.set(-dx, -dz, dy), 'flesh', { power: 0.8 }); this.copTracer(mz, P); } catch (e2) {} }
      else { h.dx = dx; h.dy = dy; h.dz = dz; this.copFire = true; try { c.hit(h, W, i === 0); if (i < 3) this.copTracer(mz, _v.set(h.x, h.z, -h.y)); } catch (e2) {} finally { this.copFire = false; }
        if (inCar && h.kind === 'car' && h.obj === pl.vehicle && h.part === 'glass' && this.rnd() < 0.55) hitP += 0.6;
        /* a near miss is heard */
        if (!inCar && i === 0) { const B = (pl.x - ox) * dx + (pl.y - oy) * dy; if (B > 0 && B < h.t + 0.5 && Math.hypot(ox + dx * B - pl.x, oy + dy * B - pl.y) < 1.3) c.snd('whiz', { pan }); } }
    }
    this._copShot = true; try { c.fx.muzzle(mz, _v3.set(ex / L, ez / L, -ey / L), k.gunK, cam.position); } catch (e2) {} this._copShot = false;
    c.snd('shot', k.gunK, { dist: Math.hypot(ex, ey), pan }); k.back = 1; k.rise = 1; if (this.t - (this.scareT || -9) > 0.7) { this.scareT = this.t; try { c.scare(k.x, k.y, 45, 2); c.scare(pl.x, pl.y, 40, 2); } catch (e2) {} }
    if (hitP > 0) { this.stats.copHits++; this.src = { x: k.x, y: k.y }; c.hurt(W.dmg * G.dm * hitP * (0.85 + 0.3 * this.rnd())); this.src = null; }
  }
  /* a police round on its way: slower and thicker than the player's own tracer so that it is seen coming */
  copTracer(from, to) {
    const fx = this.c.fx; if (!fx || !fx.spawn) return; _v4.subVectors(to, from); const L = _v4.length(); if (L < 3) return; _v4.multiplyScalar(1 / L); const len = Math.min(1.15, L * 0.12), st = 0.8, sp = 95;
    fx.spawn({ add: true, x: from.x + _v4.x * st, y: from.y + _v4.y * st, z: from.z + _v4.z * st, vx: _v4.x * sp, vy: _v4.y * sp, vz: _v4.z * sp, life: Math.max(0.03, (L - st - len) / sp), s0: 0.034, r: 6.5, g: 3.6, b: 1.2, a: 0.7, frame: 8, len, fade: 0 });
  }
  castCops(H, ox, oy, oz, dx, dy, dz, tmin) {
    const A = dx * dx + dy * dy; if (A < 1e-9) return;
    for (const k of this.cops) { if (k.hp <= 0) continue; const rx = ox - k.x, ry = oy - k.y, B = rx * dx + ry * dy; if (-B / A < -1 || -B / A > H.t + 1) continue; const r = 0.24, Cc = rx * rx + ry * ry - r * r, disc = B * B - A * Cc; if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / A; if (t < tmin || t >= H.t) continue; const hgt = 1.0 + 0.76 * k.up, z = oz + dz * t - k.z; if (z < 0 || z > hgt) continue;
      if (z > hgt - 0.27) { const tm = -B / A, cz = oz + dz * tm - k.z - (hgt - 0.12), d2 = Cc + r * r - B * B / A + cz * cz; if (d2 > 0.15 * 0.15) continue; }
      H.t = t; H.kind = 'cop'; H.x = ox + dx * t; H.y = oy + dy * t; H.z = oz + dz * t; H.nx = (rx + dx * t) / r; H.ny = (ry + dy * t) / r; H.nz = 0; H.obj = k; H.part = z > hgt - 0.27 ? 'head' : z < hgt * 0.5 ? 'legs' : 'body'; H.dx = dx; H.dy = dy; H.dz = dz; }
    /* an open patrol-car door stops a bullet below the glass */
    for (const v of this.cars) { if (v.heavy || v.doorK < 0.5 || Math.abs(v.x - ox) > H.t + 6 || Math.abs(v.y - oy) > H.t + 6) continue; for (const side of [1, -1]) { const s = this.doorSeg(v, side), sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx; if (Math.abs(den) < 1e-9) continue; const t = ((s[0] - ox) * sy - (s[1] - oy) * sx) / den, u = ((s[0] - ox) * dy - (s[1] - oy) * dx) / den; if (u < 0 || u > 1 || t < tmin || t >= H.t) continue; const z = oz + dz * t; if (z < 0.3 || z > 1.02) continue;
      let nx = sy, ny = -sx; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; } H.t = t; H.kind = 'door'; H.x = ox + dx * t; H.y = oy + dy * t; H.z = z; H.nx = nx; H.ny = ny; H.nz = 0; H.obj = v; H.part = 'metal'; } }
  }
  /* the open front door of a patrol car, as a line on the map: hinge to free edge */
  doorSeg(v, side) { const cs = Math.cos(v.h), sn = Math.sin(v.h), w = Math.min(v.def.wid, 2.0) / 2, hx = 1.02, a = 1.15 * v.doorK * side, x0 = v.x + cs * hx - sn * side * w, y0 = v.y + sn * hx + cs * side * w, dx = -Math.cos(a), dy = Math.sin(a) * 1; const lx = dx * 1.05, ly = dy * 1.05; return [x0, y0, x0 + lx * cs - ly * sn, y0 + lx * sn + ly * cs]; }
  nearMissCops() { const g = this.g, C = g.cam, pl = g.player, fx = Math.cos(C.yaw), fy = Math.sin(C.yaw); for (const k of this.cops) { if (k.hp <= 0) continue; const dx = k.x - pl.x, dy = k.y - pl.y, f = dx * fx + dy * fy; if (f > 0 && Math.abs(-dx * fy + dy * fx) < 1.6) k.supp = Math.max(k.supp, 0.9); } }
  hitCop(h, W, first) {
    const c = this.c, k = h.obj, pl = this.g.player, dmg = W.dmg * (h.part === 'head' ? 4 : h.part === 'legs' ? 0.7 : 1) * (h.part === 'body' ? (k.heavy ? 0.6 : 0.85) : 1); k.hp -= dmg; k.supp = 1.4; k.thinkT = Math.min(k.thinkT, 0.1);
    try { c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(h.nx * 0.6 + h.dx * 0.5, h.dz * 0.5, -(h.ny * 0.6 + h.dy * 0.5)), 'flesh', { power: h.part === 'head' ? 1.3 : 1 }); if (first) c.snd('impact', 'flesh', { dist: Math.hypot(h.x - pl.x, h.y - pl.y), pan: 0 }); } catch (e) {}
    c.stats.hits.cop = (c.stats.hits.cop || 0) + 1; this.lkp.x = pl.x; this.lkp.y = pl.y;
    if (k.hp <= 0) { this.downCop(k, h, W.force || 1); c.kills++; return 'kill'; }
    this.crime('copHit', k.x, k.y); try { if (c.bodies && k.vis) c.bodies.wound(k, 'ped', h); } catch (e) {} return 'ped';
  }
  downCop(k, h, force) {
    const g = this.g, c = this.c; if (k.hp <= -9000) return; k.hp = -9999; this.stats.copsDown++; this.addHeat('copKill', k.x, k.y); this.say('officer down (' + k.gunK + '), ' + this.cops.filter((q) => q.hp > 0).length + ' left, player hp ' + Math.round(c.health));
    this.shout(this.pick(['Officer down! Officer down!', 'Man down! We need backup now!', 'He hit ' + (k.n % 2 ? 'Reyes' : 'Kowalski') + '! Officer down!']), 2);
    /* an officer shot beside his car goes down along it or away from it, not in under the sill (round 8: 'dead officers clip under the car sill'): the part of the blow that points into the car's side is turned round */
    try { for (const v of this.cars) { const cs = Math.cos(v.h), sn = Math.sin(v.h), dx = k.x - v.x, dy = k.y - v.y, f = dx * cs + dy * sn, sd = -dx * sn + dy * cs, hw = Math.min(v.def.wid, 2.1) / 2; if (Math.abs(f) > v.def.len / 2 + 0.4 || Math.abs(sd) > hw + 1.3 || Math.abs(sd) < hw * 0.5) continue; const nx = -sn * Math.sign(sd), ny = cs * Math.sign(sd), into = -(h.dx * nx + h.dy * ny); if (into > 0) { h = Object.assign({}, h); h.dx += nx * into * 1.6; h.dy += ny * into * 1.6; const l = Math.hypot(h.dx, h.dy) || 1; h.dx /= l; h.dy /= l; } break; } } catch (e) {}
    let ok = false; k.speed = k.speed || 0; if (k.vis) { if (k.rig) { try { k.rig.stanceOff(); } catch (e) {} } try { if (c.bodies) { const ts = k.vis.mixer ? k.vis.mixer.timeScale : 1; this.cleanPose(k.vis, false); if (k.vis.mixer) k.vis.mixer.timeScale = ts; } ok = !!(c.bodies && c.bodies.kill(k, 'ped', h, force)); } catch (e) { ok = false; } if (!ok) ok = this.viaPedhit(k, h, force); }
    if (k.gun) { try { k.gun.visible = false; const d = k.gun.clone(true); d.visible = true; c.fx.loosen(d, _v.set(h.dx * 1.2, 1.2, -h.dy * 1.2)); } catch (e) {} }
    k.state = 'down'; k.t = 0; if (ok) g.peds.list.push(k); else { const i = this.cops.indexOf(k); if (i >= 0) this.cops.splice(i, 1); this.release(k); }
  }

  /* Before the lane's own ragdoll takes a figure whose arms were placed by the aim rig: put the whole skeleton back on its clip. The mixer writes a bone only
     when its own value for it has changed, so the rig's arm pose stayed on some bones and not others between the two poses the ragdoll measures its starting
     speeds from: the arms were thrown up and out (the 'T-pose' deaths). With no clip playing at all (a figure that never walked) the same from the rest pose. */
  cleanPose(vis, stand) {
    const mx = vis && vis.mixer; if (!mx) return; let nm = vis.cur, a = nm && vis.acts[nm]; if (stand && (!a || nm === 'drive' || nm === 'getin' || nm === 'getout')) { nm = vis.acts.idle ? 'idle' : ((vis.walks || [])[0] || {}).name; a = nm && vis.acts[nm]; }
    if (!a) return; const t = a.time || 0; mx.stopAllAction(); a.reset().setEffectiveWeight(1).play(); a.time = t; vis.cur = nm; mx.update(0); vis.object.updateMatrixWorld(true);
  }
  /* where the lane's own people code is not loaded (guns v1 in the lead's game): the fall is the lead's pedhit ragdoll, which takes anyone with a skinned figure.
     On foot the bullet goes in the way guns v1 hands its own kills over (combat.pedhit); from the player's car it is a real running-over. */
  viaPedhit(p, h, force) {
    const g = this.g, c = this.c, PH = g.__pedhit, pl = g.player; if (!PH || !PH.on || !p.vis || !p.vis.object) return false;
    const last0 = PH.list[PH.list.length - 1], st = p.state; p.state = 'down'; p.t = 0; p.fall = 0; p.vx = 0; p.vy = 0; let ok = false; this._ph = true;
    try { if (pl.vehicle) { g.onPedHit(p, pl.vehicle); ok = PH.list.length > 0 && PH.list[PH.list.length - 1] !== last0; } else if (typeof c.pedhit === 'function') ok = !!c.pedhit(p, h, force); } catch (e) { this.oops('pedhit', e); } finally { this._ph = false; }
    if (!ok) p.state = st; return ok;
  }

  // ------------------------------------------------------------------ the player: hurt, down, back
  onHurt(n, src) {
    const g = this.g, c = this.c, pl = g.player; this.stats.dmgIn += n; this.lastHurtT = this.t; this.hurtT = Math.min(1, this.hurtT + 0.45 + n / 60); this.flinch = Math.min(1.4, this.flinch + 0.5 + n / 40); this.flinchZ = (this.rnd() < 0.5 ? -1 : 1) * 0.035;
    if (src) { const ia = Math.atan2(src.y - pl.y, src.x - pl.x), old = this.inds.find((q) => Math.abs(wrapPi(q.a - ia)) < 0.7); if (old) { old.a = ia; old.t = 1.3; } else this.inds.push({ a: ia, t: 1.3 }); if (this.inds.length > 3) this.inds.shift(); this.lastSrc = { x: src.x, y: src.y }; }
    c.camShake = Math.min(1, (c.camShake || 0) + 0.5); g.cam.shake = Math.min(1, g.cam.shake + 0.35); c.snd('impact', 'flesh', { dist: 0, pan: 0 }); this.grunt();
  }
  /* a short breathy grunt and a body thump, made here from noise and a falling tone (no sample) */
  grunt() {
    const s = this.g.sound; if (!s || !s.on || !s.ac || !s.out || this.g.capture) return;
    try { const a = s.ac, t = a.currentTime, o = a.createOscillator(), g1 = a.createGain(), f = a.createBiquadFilter(); o.type = 'sawtooth'; const f0 = 150 + Math.random() * 40; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.16); f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 1.4;
      g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.16, t + 0.015); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(f); f.connect(g1); g1.connect(s.out); o.start(t); o.stop(t + 0.22);
      const th = a.createOscillator(), g2 = a.createGain(); th.frequency.setValueAtTime(95, t); th.frequency.exponentialRampToValueAtTime(42, t + 0.12); g2.gain.setValueAtTime(0.32, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15); th.connect(g2); g2.connect(s.out); th.start(t); th.stop(t + 0.16); } catch (e) {}
  }
  die() {
    const g = this.g, c = this.c, pl = g.player; this.stats.deaths++; this.say('player down at heat ' + this.level + ', ' + this.t.toFixed(1) + ' s');
    if (pl.vehicle) { const v = pl.vehicle; pl.vehicle = null; pl.busy = null; g.cam.mode = 'foot'; pl.vis.object.visible = true; pl.x = v.x - Math.sin(v.h) * (v.def.wid / 2 + 0.7); pl.y = v.y + Math.cos(v.h) * (v.def.wid / 2 + 0.7); v.vx = v.vy = 0; }
    pl.busy = null; c.dead = true; c.inp.fire = c.inp.aim = false; if (c.rel) c.rel = null; /* no RELOADING tag over a dead man (capture h9c) */ if (c.rig) { try { c.rig.stanceOff(); c.rig.curl('R', 0); c.rig.curl('L', 0); } catch (e) {} }
    const s = this.lastSrc || { x: pl.x - Math.cos(pl.h), y: pl.y - Math.sin(pl.h) }, dx = pl.x - s.x, dy = pl.y - s.y, dl = Math.hypot(dx, dy) || 1;
    const D = (this.dead = { t: 0, cam: true, x: pl.x, y: pl.y, yaw: g.cam.yaw, p: null, hips: null, level: this.level, arrest: false });
    const vis = pl.vis; if (vis && vis.mixer && (c.bodies || g.__pedhit)) { try { const hb = vis.object.getObjectByName((vis.name || 'player') + '_hips'); D.hips = hb ? { b: hb, p: hb.position.clone() } : null;
      if (c.bodies) { this.say('death pose: clip ' + vis.cur); this.cleanPose(vis, true); vis.object.position.set(pl.x, g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0, -pl.y); vis.object.rotation.set(0, pl.h, 0); vis.object.updateMatrixWorld(true); }
      const p = { vis, x: pl.x, y: pl.y, h: pl.h, state: 'walk', speed: pl.speed || 0, kind: 'player', hp: 0, scale: 1, fall: 0, vx: 0, vy: 0, t: 0, phase: 0, isPlayer: true };
      const hit = { x: pl.x, y: pl.y, z: 1.2, dx: dx / dl, dy: dy / dl, dz: 0, part: 'body' };
      if (c.bodies && c.bodies.kill(p, 'ped', hit, 1.5 /* over 1.8 the people code throws a body with no standing phase: at 2.0 he went over like a plank (rounds 7, 8); at 1.1 he stood dead for most of a second: so 1.5, and the quarter second in which the legs still carry is run at once, so that the knees go as he is hit */)) { D.p = p; g.peds.list.push(p); try { const dl = p.body && p.body.doll; if (dl && !g.P.has('heatnopre')) for (let i = 0; i < 13; i++) dl.step(1 / 60); } catch (e) { this.oops('die', e); } } else if (this.viaPedhit(p, hit, 1.1)) D.p = p; } catch (e) { this.oops('die', e); } }
    for (const k of this.cops) k.burst = 0;
  }
  arrest() {
    const g = this.g, pl = g.player; if (this.dead) return; this.stats.arrests++; this.say('arrested'); this.shout('On the ground. You are done for today.', 2);
    this.dead = { t: 1.4, cam: false, x: pl.x, y: pl.y, yaw: g.cam.yaw, p: null, hips: null, level: this.level, arrest: true }; this.c.dead = true;
  }
  stepDead(dt) {
    const g = this.g, c = this.c, pl = g.player, D = this.dead; D.t += dt;
    if (D.p) { pl.x = D.p.x; pl.y = D.p.y; D.p.t = Math.min(D.p.t, 4); }
    this.fade = D.woke ? Math.max(0, this.fade - dt / 1.3) : clamp((D.t - 2.6) / 1.1, 0, 1);
    if (!D.woke && D.t > 4.4) {
      /* wake outside the nearest clinic (or leave the precinct); the bill is a tenth of the cash on hand; the guns stay, half of the spare rounds do not */
      D.woke = true; if (D.p) { D.p.state = 'gone'; const i = g.peds.list.indexOf(D.p); if (i >= 0) g.peds.list.splice(i, 1); const vis = pl.vis; vis.object.visible = true; vis.used = true; if (D.hips) D.hips.b.position.copy(D.hips.p); if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.stopAllAction(); } vis.cur = null; D.p = null; }
      let best = null; for (const q of CLINICS) { const d = Math.hypot(q[1] - D.x, q[2] - D.y); if (!best || d < best.d) best = { q, d }; }
      const P = this.sidewalkNear(best.q[1], best.q[2]); pl.x = P.x; pl.y = P.y; pl.h = P.h; g.focus.x = pl.x; g.focus.y = pl.y; pl.speed = 0;
      const fee = D.arrest ? clamp(Math.round(g.cash * 0.2 / 5) * 5, 0, 1500) : clamp(Math.round(g.cash * 0.1 / 5) * 5, 0, 800); g.cash -= fee;
      for (const kd in c.ammo) { const am = c.ammo[kd]; if (D.arrest) { am.reserve = 0; am.mag = kd === 'pistol' ? am.mag : 0; } else am.reserve = Math.ceil(am.reserve / 2); }
      if (c.slot !== 'unarmed') c.setSlot('unarmed'); c.health = 100; c.dead = false; this.clear(D.arrest ? 'arrested' : 'player down');
      for (const k of this.cops.slice()) { if (k.hp > 0) { k.hp = 0; k.gone = true; this.release(k); } } this.cops = this.cops.filter((k) => !k.gone); for (const v of this.cars) { v.left = true; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); }
      g.cam.yaw = pl.h; g.cam.pitch = 0.14; try { g.playerAnim('idle'); g.snapCamera(); } catch (e) {} D.cam = false;
      this.note = { title: D.arrest ? 'BOOKED AND RELEASED' : 'PATCHED UP', sub: (D.arrest ? 'Fine and bail' : best.q[0]) + (fee ? '  ·  −$' + fee.toLocaleString('en-US') : '') + (D.arrest ? '  ·  long guns kept by the precinct' : '  ·  half your spare rounds are gone'), t: 0 };
      this.say('woke at ' + best.q[0] + ', fee ' + fee);
    }
    if (D.woke && this.fade <= 0) this.dead = null;
  }
  sidewalkNear(x, y) { const st = this.g.statics; for (let r = 0; r < 90; r += 3) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (st.onSidewalk(px, py) && !(st.resolve(px, py, 0.6, _o) > 0)) { const ne = this.g.roads.nearestEdge(px, py, 60); return { x: px, y: py, h: ne ? Math.atan2(ne.y - py, ne.x - px) : 0 }; } } return { x, y, h: 0 }; }
  deathCam() {
    const g = this.g, D = this.dead, cam = g.world.camera, pl = g.player, u = sm(D.t / 3.6), a = D.yaw + Math.PI + u * 0.5, d = 3.2 + u * 5.5, hz = 1.6 + u * 8.5;
    cam.position.set(pl.x + Math.cos(a) * d, hz, -(pl.y + Math.sin(a) * d)); cam.lookAt(pl.x, 0.5, -pl.y); if (Math.abs(cam.fov - 50) > 0.01) { cam.fov = 50; cam.updateProjectionMatrix(); } cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ what is drawn (never reached in the node sim)
  buildShared() {
    const g = this.g, sc = g.world.scene; this.grp = new THREE.Group(); this.grp.name = 'heat'; sc.add(this.grp);
    /* the officers' small kit (gun, cap, belt, badge, vest) is one group that the ambient-occlusion pass leaves out: about twenty draws an officer saved there */
    this.kitG = new THREE.Group(); this.kitG.name = 'heat_kit'; sc.add(this.kitG);
    { const gt = g.world.gtao, kg = this.kitG; if (gt && gt.renderOverride && !gt._heatKit) { gt._heatKit = true; const ro = gt.renderOverride.bind(gt); gt.renderOverride = function (...a) { const v = kg.visible; kg.visible = false; try { return ro(...a); } finally { kg.visible = v; } }; } }
    /* lights that add to the picture ride with the gun effects (those are kept out of the ambient-occlusion pass) */
    this.glow = new THREE.Group(); (this.c.fx && this.c.fx.group ? this.c.fx.group : sc).add(this.glow);
    const disc = document.createElement('canvas'); disc.width = disc.height = 128; { const x = disc.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
    this.discTex = new THREE.CanvasTexture(disc);
    /* our own markings: a white door with a navy band and a made-up name */
    const door = (no) => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const x = cv.getContext('2d'); x.fillStyle = '#e9ebee'; x.fillRect(0, 0, 256, 160); x.fillStyle = '#14254a'; x.fillRect(0, 96, 256, 22); x.fillStyle = '#d8a21c'; x.fillRect(0, 120, 256, 5); x.fillStyle = '#14254a'; x.font = '800 30px "Helvetica Neue", Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.fillText('CITY PATROL', 128, 56); x.font = '700 20px "Helvetica Neue", Helvetica, Arial, sans-serif'; x.fillText('UNIT ' + no, 128, 84); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    this.doorTex = door; this.matBar = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.4, metalness: 0.3 }); this.matWhite = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.32, metalness: 0.2 });
    this.navy = new Map();
    /* the patrol car's look and its siren live in a file of their own (heatcar.js); the code below is what is used if that does not load */
    import('./heatcar.js').then((m) => { this.look = new m.CarLook(this); }).catch((e) => { console.log('[heat] heatcar.js not loaded: ' + e.message); });
  }
  dressCar(v) {
    if (this.look) { try { this.look.dress(v); v.look = true; return; } catch (e) { this.oops('look', e); } }
    const D = (v.dress = { g: new THREE.Group(), lamps: [], glows: [], doors: [] }), hgt = v.def.hgt, w = Math.min(v.def.wid, 2.0), heavy = v.heavy;
    const box = (sx, sy, sz, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = true; D.g.add(m); return m; };
    /* the bar across the roof: a dark foot, a clear middle, a red and a blue half that really flash */
    const by = hgt + 0.045, bx = heavy ? -0.1 : -0.25; box(0.26, 0.05, w * 0.62, this.matBar, bx, by - 0.035, 0); box(0.2, 0.07, 0.16, this.matWhite, bx, by + 0.02, 0);
    for (const s of [1, -1]) { const mat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }), m = box(0.22, 0.085, w * 0.25, mat, bx, by + 0.022, s * w * 0.19); m.castShadow = false; D.lamps.push({ m, mat, red: s > 0 });
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.discTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); gm.rotation.x = -Math.PI / 2; gm.renderOrder = 5; gm.frustumCulled = false; this.glow.add(gm);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.discTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); halo.frustumCulled = false; this.glow.add(halo); D.glows.push({ gm, halo, red: s > 0, s }); }
    /* white front doors with the markings: they sit on the body until the crew gets out, then swing open and are cover */
    if (!heavy) { const tex = this.doorTex(v.id), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.34, metalness: 0.2 }), dh = 0.62, dl = 1.05;
      for (const s of [1, -1]) { const piv = new THREE.Group(); piv.position.set(1.02, 0.36 + dh / 2, -s * (w / 2 + 0.012)); const m = new THREE.Mesh(new THREE.BoxGeometry(dl, dh, 0.035), [this.matWhite, this.matWhite, this.matWhite, this.matWhite, s > 0 ? this.matWhite : mat, s > 0 ? mat : this.matWhite]); m.position.set(-dl / 2, 0, 0); m.castShadow = true; piv.add(m); D.g.add(piv); D.doors.push({ piv, s }); } }
    else { for (const s of [1, -1]) { const m = box(1.9, 0.16, 0.02, this.matWhite, 0, 0.86, -s * (w / 2 + 0.012)); m.castShadow = false; } }
    this.grp.add(D.g);
  }
  undressCar(v) { if (v.look) { try { this.look.undress(v); } catch (e) { this.oops('look', e); } v.look = false; return; } const D = v.dress; if (!D) return; this.grp.remove(D.g); for (const q of D.glows) { this.glow.remove(q.gm); this.glow.remove(q.halo); q.gm.material.dispose(); q.halo.material.dispose(); } for (const q of D.lamps) q.mat.dispose(); v.dress = null; }
  drawCar(v, dt) {
    if (v.look) { try { this.look.draw(v, dt); } catch (e) { this.oops('look', e); } return; }
    const D = v.dress; if (!D) return; _e.set(v.roll || 0, v.h, v.pitch || 0, 'YZX'); D.g.quaternion.setFromEuler(_e); D.g.position.set(v.x, v.z || 0, -v.y); D.g.visible = !(v.wreck && v.z > 0.5);
    const on = !v.wreck && !v.stolen && (this.level > 0 || v.drive), ph = (this.t * 2.3 + v.id * 0.37) % 1, fl = (a) => (ph > a && ph < a + 0.11) || (ph > a + 0.17 && ph < a + 0.28);
    for (const q of D.lamps) { const lit = on && fl(q.red ? 0.02 : 0.52); if (lit) q.mat.color.setRGB(q.red ? 7 : 0.5, q.red ? 0.25 : 1.4, q.red ? 0.2 : 9); else q.mat.color.setRGB(q.red ? 0.16 : 0.02, 0.02, q.red ? 0.02 : 0.2); }
    for (const q of D.glows) { const lit = on && fl(q.red ? 0.02 : 0.52), k = lit ? 1 : 0; q.gm.visible = q.halo.visible = lit; if (!lit) continue; const cs = Math.cos(v.h), sn = Math.sin(v.h), lx = v.x - sn * q.s * -0.4, ly = v.y + cs * q.s * -0.4;
      q.gm.position.set(lx, (this.g.statics.onSidewalk(lx, ly) ? 0.15 : 0) + 0.03, -ly); q.gm.scale.setScalar(13); q.gm.material.color.setRGB(q.red ? 0.5 * k : 0.03, 0.03 * k, q.red ? 0.03 : 0.6 * k);
      q.halo.position.set(lx, (v.z || 0) + v.def.hgt + 0.1, -ly); q.halo.scale.setScalar(1.5); q.halo.material.color.setRGB(q.red ? 1.6 : 0.1, 0.12, q.red ? 0.1 : 2.0); }
    for (const d of D.doors) d.piv.rotation.y = -d.s * 1.15 * sm(v.doorK);
  }
  navyOf(m) {
    let n = this.navy.get(m); if (n) return n; n = m.clone(); const nm = m.name || '';
    if (/^(top|pants|bottom|dress|skirt|jacket)_/.test(nm)) { n.color.set(0xffffff); n.roughness = Math.max(n.roughness, 0.72); n.metalness = 0;
      n.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n { float cl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = vec3(0.012, 0.02, 0.056) * (0.6 + 1.6 * cl); }'); }; n.customProgramCacheKey = () => 'heat-navy3'; /* twice as light as before: at 0.006 the uniform read as 'flat black' with no belt or badge to be seen against it (rounds 9, 10) */ }
    else if (/^shoes_/.test(nm)) { n.color.multiplyScalar(0.25); }
    this.navy.set(m, n); return n;
  }
  dressCop(k) {
    const g = this.g, c = this.c, kinds = g.kit.pedKinds ? g.kit.pedKinds() : []; if (!g.kit.people || !kinds.length) return;
    const who = kinds[(k.n + this.units) % kinds.length]; let P = null; const i = this.pool.findIndex((q) => q.who === who); if (i >= 0) P = this.pool.splice(i, 1)[0];
    if (!P) { const vis = g.kit.person(who); if (!vis) return; vis.object.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => this.navyOf(m)) : this.navyOf(o.material); });
      const rig = new AimRig(vis, who); let cap = null; try { cap = new (this._Cap)(this.kitG || g.world.scene, new URLSearchParams('cap=1&capc=0d1630&capy=0.09' /* 12 mm higher than the player's: the bill sat across the eyes ('faceless', 'a black blob for a head') */)); } catch (e) { cap = null; }
      /* the vest of the heavier units: a dark plate carried on the chest */
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.37), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.85 })); vest.castShadow = true; vest.visible = false; (this.kitG || g.world.scene).add(vest);
      const belt = new THREE.Group(), dk = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6 }), ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.055, 14, 1, true), dk); ring.scale.set(0.155, 1, 0.19); ring.material.side = THREE.DoubleSide; belt.add(ring);
      for (const [x, z, sx, sy, sz] of [[0.02, 0.2, 0.09, 0.16, 0.05], [0.1, -0.16, 0.05, 0.08, 0.06], [-0.12, 0.13, 0.05, 0.09, 0.07], [0.15, 0, 0.03, 0.05, 0.06]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), dk); m.position.set(x, -sy / 2 + 0.03, z); belt.add(m); }
      try { const one = this.mergeStatic(belt); if (one) { one.castShadow = false; belt.clear(); belt.add(one); } } catch (e) { this.oops('merge', e); } belt.visible = false; (this.kitG || g.world.scene).add(belt);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.068, 0.056), new THREE.MeshStandardMaterial({ color: 0xd9b24a, roughness: 0.35, metalness: 0.6, emissive: 0x4a3608 })); badge.visible = false; (this.kitG || g.world.scene).add(badge);
      const hb = vis.object.getObjectByName(who + '_hips'); vis.hips0 = hb ? hb.position.clone() : null; vis.hipsB = hb; g.world.scene.add(vis.object); P = { vis, rig: rig.ok ? rig : null, cap, vest, guns: {}, who, belt, badge }; }
    const vis = P.vis; k._posed = false; k._dtA = 0; k.vis = vis; k.rig = P.rig; k.capO = P.cap; k.vestO = P.vest; k.beltO = P.belt; k.badgeO = P.badge; k.guns = P.guns; k.who = who; vis.name = who; vis.object.visible = true; vis.used = true; vis._fit = vis._fit || null;
    if (vis.hipsB && vis.hips0) vis.hipsB.position.copy(vis.hips0); if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.stopAllAction(); } vis.cur = null; vis.object.rotation.set(0, k.h, 0); vis.object.scale.setScalar(1);
    let gun = k.guns[k.gunK]; if (!gun) { try { gun = c.build(k.gunK); } catch (e) { gun = null; } if (gun) { /* an officer's gun has no moving parts to show: all its pieces drawn as one */ try { const one = this.mergeStatic(gun); if (one) { const G2 = new THREE.Group(); G2.userData = gun.userData; G2.add(one); gun = G2; } } catch (e) { this.oops('merge', e); }
        gun.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }); (this.kitG || g.world.scene).add(gun); k.guns[k.gunK] = gun; } }
    for (const n in k.guns) k.guns[n].visible = false; k.gun = gun || null;
  }
  /* every mesh under root (all of one material) as a single mesh in root's frame; null if they do not share a material or the attributes do not match */
  mergeStatic(root) {
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), list = []; let mat = null, bad = false; root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return; if (Array.isArray(o.material) || (mat && o.material !== mat)) bad = true; mat = mat || o.material; list.push(o); });
    if (bad || list.length < 2) return null; const names = ['position', 'normal', 'color', 'uv'].filter((n) => list.every((o) => o.geometry.attributes[n] && o.geometry.attributes[n].itemSize === list[0].geometry.attributes[n].itemSize)); if (!names.includes('position')) return null;
    const arr = {}; for (const n of names) arr[n] = []; const m4 = new THREE.Matrix4();
    for (const o of list) { const ge = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); m4.multiplyMatrices(inv, o.matrixWorld); ge.applyMatrix4(m4); for (const n of names) { const a = ge.attributes[n]; for (let i = 0; i < a.count * a.itemSize; i++) arr[n].push(a.array[i]); } ge.dispose(); }
    const out = new THREE.BufferGeometry(); for (const n of names) out.setAttribute(n, new THREE.Float32BufferAttribute(arr[n], list[0].geometry.attributes[n].itemSize)); const me = new THREE.Mesh(out, mat); me.castShadow = true; me.receiveShadow = true; return me;
  }
  anim(k, name, rate) { const v = k.vis; if (!v.mixer) return; if (!v.acts[name]) name = v.acts.idle ? 'idle' : null; if (!name) return; if (v.cur !== name) { if (v.cur && v.acts[v.cur]) v.acts[v.cur].fadeOut(0.18); v.acts[name].reset().fadeIn(0.18).play(); v.cur = name; } v.mixer.timeScale = rate; }
  preSync(dt) {
    if (!REAL) return; if (this._Cap === undefined) { this._Cap = null; import('./dress.js').then((m) => { this._Cap = m.Cap; }).catch(() => {}); }
    const kit = this.g.kit, CS = (kit && kit.clipSpeed) || {};
    const dt0 = dt; this._drawN = (this._drawN || 0) + 1; for (const k of this.cops) { dt = dt0; const v = k.vis; if (!v || k.hp <= 0) continue; const o = v.object, sp = k.speed || 0, tall = (kit.tall && kit.tall[k.who]) || 1, wk = (v.walks || []).find((w) => w.name === 'walkbrisk') || (v.walks || [])[0] || { name: 'walk', speed: 1.45 };
      /* beyond 16 m from the camera an officer's clip and aim pose are worked out every second frame (the figure itself still moves every frame); ?heathalf=0 off */
      { const cp = this.g.world.camera.position, far = this.half && !k.get && Math.hypot(k.x - cp.x, -k.y - cp.z) > 16; k._skip = far && ((this._drawN + k.n) & 1) === 1 && k._posed; if (k._skip) { k._dtA = (k._dtA || 0) + dt; const dx = k.x - o.position.x, dy = k.z - o.position.y, dz = -k.y - o.position.z; o.position.set(k.x, k.z, -k.y); o.rotation.set(0, k.h, 0);
          for (const q of [k.gun, k.capO && k.capO.group, k.vestO, k.beltO, k.badgeO]) if (q && q.visible) { q.position.x += dx; q.position.y += dy; q.position.z += dz; } continue; } dt = dt + (k._dtA || 0); k._dtA = 0; k._posed = true; }
      k.spA = (k.spA ?? sp) + (sp - (k.spA ?? sp)) * Math.min(1, dt * 10); const s = k.spA, jog = v.acts.jog ? (CS.jog || 2.62) * tall : 0;
      if (k.get) { if (k.get.anim) { this.anim(k, 'getout', 1); if (k.get.t < 0.02) v.acts.getout.time = 0; } else this.anim(k, 'idle', 1); }
      else if (s > (jog ? 3.5 : 3.0)) this.anim(k, 'run', clamp(s / (v.runSpeed || 4.02), 0.8, 1.3)); else if (jog && s > 2.05) this.anim(k, 'jog', clamp(s / jog, 0.8, 1.35)); else if (s > 0.25) this.anim(k, wk.name, clamp(s / wk.speed, 0.5, 1.3)); else this.anim(k, 'idle', 1);
      if (k.rig) { try { k.rig.stanceOff(); } catch (e) {} } o.position.set(k.x, k.z, -k.y); o.rotation.set(0, k.h, 0); o.scale.set(k.tall, k.tall, k.get && k.get.side < 0 ? -k.tall : k.tall); if (v.mixer) v.mixer.update(dt); o.updateMatrixWorld(true); }
  }
  postSync(dt) {
    if (!REAL) return; const g = this.g, pl = g.player;
    /* braking hard into the scene with the nose swinging: pale smoke off the tyres */
    for (const v of this.cars) { if (!v.drive || !v.drive.stop || v.vf < 2.5) continue; v.smokeT = (v.smokeT || 0) - dt; if (v.smokeT > 0) continue; v.smokeT = 0.035; const fx = this.c.fx; if (!fx || !fx.spawn) break; const cs = Math.cos(v.h), sn = Math.sin(v.h), d = fx.day ?? 1, wb = (v.def.wheelbase || 2.8) / 2, hw = Math.min(v.def.wid, 2.0) / 2 - 0.15;
      for (const [lx, ly] of [[-wb, hw], [-wb, -hw], [wb, hw], [wb, -hw]]) { if (Math.random() < 0.35) continue; const x = v.x + cs * lx - sn * ly, y = v.y + sn * lx + cs * ly; fx.spawn({ x, y: 0.12, z: -y, vx: v.vx * 0.25 + (Math.random() - 0.5) * 0.8, vy: 0.5 + Math.random() * 0.5, vz: -v.vy * 0.25 + (Math.random() - 0.5) * 0.8, life: 1.3 + Math.random() * 1.2, s0: 0.3, s1: 1.3 + Math.random() * 0.8, r: 0.62 * d, g: 0.62 * d, b: 0.64 * d, a: 0.13 * clamp(v.vf / 8, 0.3, 1), frame: Math.floor(Math.random() * 4), drag: 1.6, rotv: (Math.random() - 0.5) * 1.2, fin: 0.12 }); } }
    for (const v of this.cars) this.drawCar(v, dt); if (this.look && this.look.frame) { try { this.look.frame(dt); } catch (e) { this.oops('look', e); } }
    if (this.dead && this.dead.arrest && !this.dead.woke) { try { this.handsUp(clamp((this.dead.t - 1.4) / 0.5, 0, 1)); } catch (e) { this.oops('hands', e); } }
    const tz = (g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0) + (pl.vehicle ? 0.95 : 1.25), tx = this.seen || this.level === 0 ? pl.x : this.lkp.x, ty = this.seen || this.level === 0 ? pl.y : this.lkp.y;
    const camP = g.world.camera.position;
    /* shadows for the four officers nearest the camera only */
    { const ds = []; for (const k of this.cops) if (k.vis && k.hp > 0) ds.push(Math.hypot(k.x - camP.x, -k.y - camP.z)); ds.sort((x, y) => x - y); this._shR = ds.length > 4 ? Math.min(26, ds[3] + 0.01) : 26; }
    for (const k of this.cops) { const vis = k.vis; if (!vis) continue;
      /* an officer's shadow is drawn only near the camera (measured: the shadows of ten officers cost about 1 fps of 43) */
      { const far = Math.hypot(k.x - camP.x, -k.y - camP.z) > this._shR; if (k._shFar !== far) { k._shFar = far; vis.object.traverse((o) => { if (!o.isMesh) return; if (o.userData.heatCs === undefined) o.userData.heatCs = o.castShadow; o.castShadow = !far && o.userData.heatCs; }); } }
      /* the cap's code loads a moment after the first officers can be made */ if (!k.capO && this._Cap && k.hp > 0) { try { k.capO = new (this._Cap)(this.kitG || g.world.scene, new URLSearchParams('cap=1&capc=0d1630&capy=0.09' /* 12 mm higher than the player's: the bill sat across the eyes ('faceless', 'a black blob for a head') */)); } catch (e) { this._Cap = null; } } if (k.hp <= 0) { if (k.capO) k.capO.update(k.rig, vis.object.visible); if (k.vestO) k.vestO.visible = false; if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; continue; } if (k._skip) continue; try { this.poseCop(k, tx, ty, tz, dt); } catch (e) { this.oops('pose', e); }
      /* small kit is not drawn far off, and a far officer's gun casts no shadow */
      { const d = Math.hypot(k.x - camP.x, -k.y - camP.z); if (d > 24) { if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; } if (k.gun && k.gun.userData.heatSh !== !k._shFar) { k.gun.userData.heatSh = !k._shFar; k.gun.traverse((m) => { if (m.isMesh) m.castShadow = !k._shFar; }); } } }
  }
  /* the player gives himself up: both hands to the back of the head (the guns helper's rig, posed after its own pass) */
  handsUp(w) {
    const rig = this.c.rig, pl = this.g.player; if (!rig || !rig.ok || w <= 0) return; const hx = Math.cos(pl.h), hz = -Math.sin(pl.h), rx = Math.sin(pl.h), rz = Math.cos(pl.h), hd = rig.pos('head', new THREE.Vector3()), fw = new THREE.Vector3(hx, 0, hz), rt = new THREE.Vector3(rx, 0, rz);
    for (const s of [1, -1]) { const side = s > 0 ? 'R' : 'L', wr = new THREE.Vector3().copy(hd).addScaledVector(rt, s * 0.13).addScaledVector(fw, -0.1).addScaledVector(UP, 0.06), pole = new THREE.Vector3().copy(rt).multiplyScalar(s).addScaledVector(UP, 0.25).addScaledVector(fw, -0.1);
      rig.arm(side, wr, pole, w); rig.handDir(side, _v.copy(rt).multiplyScalar(-s).addScaledVector(UP, 0.2).normalize(), _v2.copy(fw), w); rig.curl(side, 0.3 * w); }
  }
  poseCop(k, tx, ty, tz, dt) {
    const rig = k.rig, gun = k.gun, vis = k.vis; if (k.get) { if (gun) gun.visible = false; if (k.capO) k.capO.update(rig, true); if (k.vestO) k.vestO.visible = false; if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; return; } if (!rig) { if (gun) { gun.visible = true; gun.position.set(k.x + Math.cos(k.h) * 0.4, k.z + 1.25, -(k.y + Math.sin(k.h) * 0.4)); gun.rotation.set(0, k.h, 0); } return; }
    const a = sm(k.aim), long = k.gunK !== 'pistol', hx = Math.cos(k.h), hz = -Math.sin(k.h), low = 1 - k.up, st = 1 - clamp((k.spA || 0) / 0.8, 0, 1);
    /* low behind cover: hips down over planted feet, one foot back, trunk forward */
    if (rig.legs && (low > 0.02 || a > 0.02)) rig.stanceLegs(_v.set(-hx * 0.05 * low, -(0.035 * a + 0.44 * low), -hz * 0.05 * low), _v2.set(hx * (0.08 + 0.1 * low) * st, 0, hz * (0.08 + 0.1 * low) * st), _v3.set(-hx * (0.1 + 0.22 * low) * st, 0, -hz * (0.1 + 0.22 * low) * st), _v4.set(hx, 0, hz));
    const neck0 = rig.pos('neck', _v); F.set(tx - neck0.x, tz - neck0.y, -ty - neck0.z); if (F.lengthSq() < 0.01) F.set(hx, 0, hz); F.normalize(); F.y = clamp(F.y, -0.5, 0.5); F.normalize();
    const yaw = Math.atan2(-F.z, F.x), ap = Math.asin(F.y), tw = clamp(wrapPi(yaw - k.h), -1.45, 1.45); R.set(Math.sin(yaw), 0, Math.cos(yaw));
    rig.twist(tw * Math.max(a, 0.25) - (long ? 0.46 * a : 0), 0, R);
    rig.twist(0, (ap * 0.5 - 0.11) * a - 0.34 * low + Math.min(0.1, k.back * 0.05), R); rig.face(tw + (long ? -0.1 : 0), ap * 0.8 + 0.06 + 0.3 * low, R, Math.max(a, low) * 0.9); if (long) rig.nudge('head', F, 0.16 * a);
    if (k.capO) k.capO.update(rig, true);
    if (k.vestO) { const b = rig.B.chest2 || rig.B.chest; k.vestO.visible = !!(k.heavy && b); if (k.vestO.visible) { const up = rig.pos('neck', _v2).sub(b.getWorldPosition(_v3)).normalize(), fw = _v4.set(Math.cos(k.h + tw * a), 0, -Math.sin(k.h + tw * a)); fw.addScaledVector(up, -fw.dot(up)).normalize(); const rt = _v.crossVectors(fw, up); k.vestO.quaternion.setFromRotationMatrix(_m.makeBasis(fw, up, rt)); k.vestO.position.copy(_v3).addScaledVector(up, 0.02).addScaledVector(fw, 0.015); } }
    { const b = rig.B.chest2 || rig.B.chest, on = !!(b && rig.B.hips && k.beltO); if (k.beltO) k.beltO.visible = on; if (k.badgeO) k.badgeO.visible = on && !k.heavy;
      if (on) { const cp = b.getWorldPosition(_v3), up = rig.pos('neck', _v2).sub(cp).normalize(), fw = _v4.set(Math.cos(k.h + tw * a), 0, -Math.sin(k.h + tw * a)); fw.addScaledVector(up, -fw.dot(up)).normalize(); const rt = _v.crossVectors(fw, up); _q.setFromRotationMatrix(_m.makeBasis(fw, up, rt));
        k.badgeO.quaternion.copy(_q); k.badgeO.position.copy(cp).addScaledVector(fw, 0.128).addScaledVector(up, 0.075).addScaledVector(rt, -0.085);
        const hp = rig.pos('hips', _v2); k.beltO.position.set(hp.x, hp.y + 0.075, hp.z); k.beltO.quaternion.setFromAxisAngle(UP, k.h + tw * a * 0.3); } }
    if (!gun) return; const U_ = gun.userData, neck = rig.pos('neck', new THREE.Vector3());
    R.crossVectors(F, UP).normalize(); U.crossVectors(R, F).normalize();
    const aimPos = new THREE.Vector3().copy(neck); if (!long) aimPos.addScaledVector(R, 0.09).addScaledVector(U, 0.03).addScaledVector(F, 0.52); else if (U_.stock) { rig.pos('upper_arm_R', aimPos); aimPos.addScaledVector(R, -0.04 - U_.stock.z).addScaledVector(U, -0.015 - U_.stock.y).addScaledVector(F, 0.07 - U_.stock.x); } else aimPos.addScaledVector(R, 0.14).addScaledVector(U, -0.11).addScaledVector(F, 0.24);
    const qAim = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(F, U, R)), bf = new THREE.Vector3(hx, 0, hz), br = new THREE.Vector3(Math.sin(k.h), 0, Math.cos(k.h)), cPos = new THREE.Vector3(), cQ = new THREE.Quaternion();
    if (long) { const hips = rig.pos('hips', _v2); cPos.copy(hips).addScaledVector(br, 0.19).addScaledVector(UP, 0.2).addScaledVector(bf, 0.2); const cf = new THREE.Vector3().copy(bf).multiplyScalar(0.74).addScaledVector(br, -0.42).addScaledVector(UP, -0.52).normalize(), cr = new THREE.Vector3().crossVectors(cf, UP).normalize(), cu = new THREE.Vector3().crossVectors(cr, cf); cQ.setFromRotationMatrix(_m.makeBasis(cf, cu, cr)); }
    else { const hf = new THREE.Vector3(), hn = new THREE.Vector3(), wp = rig.handFrame('R', hf, hn), gx0 = new THREE.Vector3().copy(hf).applyAxisAngle(hn, 0.26), gy0 = new THREE.Vector3().crossVectors(hn, gx0).normalize(); cQ.setFromRotationMatrix(_m.makeBasis(gx0, gy0, hn)); cPos.copy(wp).addScaledVector(hf, 0.082).addScaledVector(hn, -0.028); }
    gun.visible = true; gun.position.copy(cPos).lerp(aimPos, a); gun.quaternion.copy(cQ).slerp(qAim, a);
    gun.position.addScaledVector(_v2.set(1, 0, 0).applyQuaternion(gun.quaternion), -0.05 * k.back).addScaledVector(U, 0.03 * k.rise); gun.rotateZ(0.22 * k.rise * (long ? 0.3 : 1)); gun.updateMatrixWorld(true);
    const gx = new THREE.Vector3(1, 0, 0).applyQuaternion(gun.quaternion), gy = new THREE.Vector3(0, 1, 0).applyQuaternion(gun.quaternion), gz = new THREE.Vector3(0, 0, 1).applyQuaternion(gun.quaternion);
    const wR = long ? 1 : a, fR = new THREE.Vector3().copy(gx).multiplyScalar(0.965).addScaledVector(gy, -0.26).normalize(), wristR = new THREE.Vector3().copy(gun.position).addScaledVector(fR, -0.082).addScaledVector(gz, 0.028);
    rig.arm('R', wristR, _v.copy(UP).multiplyScalar(-0.9).addScaledVector(R, long ? 0.6 : 0.22).addScaledVector(F, -0.2), wR); rig.handDir('R', fR, gz, wR); rig.curl('R', 1, true);
    const sup = new THREE.Vector3().copy(U_.support); if (long && U_.stock && k.gunK !== 'shotgun') sup.x = Math.min(sup.x, U_.stock.x + 0.47); sup.applyMatrix4(gun.matrixWorld);
    let fL, nL; if (long) { fL = new THREE.Vector3().copy(gx).multiplyScalar(0.8).addScaledVector(gz, 0.55).addScaledVector(gy, 0.12).normalize(); nL = new THREE.Vector3().copy(gy).multiplyScalar(0.85).addScaledVector(gz, 0.5).normalize(); } else { fL = new THREE.Vector3().copy(gx).multiplyScalar(0.72).addScaledVector(gy, -0.6).addScaledVector(gz, 0.2).normalize(); nL = new THREE.Vector3().copy(gz).multiplyScalar(0.9).addScaledVector(gy, 0.35).normalize(); }
    const wristL = new THREE.Vector3().copy(sup).addScaledVector(fL, -0.075).addScaledVector(nL, -0.03), wL = long ? 1 : a;
    rig.arm('L', wristL, _v.copy(UP).multiplyScalar(-0.95).addScaledVector(R, long ? -0.3 : -0.12).addScaledVector(F, -0.1), wL); rig.handDir('L', fL, nL, wL); rig.curl('L', (long ? 1 : 0.8) * wL);
  }

  // ------------------------------------------------------------------ HUD: heat, health, where it hurts from, the map, the words
  hud() {
    const g = this.g, H = g.hud, c = H.ctx, k = H.k, W = H.w / k, Ht = 1080, pl = g.player, cb = this.c; if (!c) return;
    c.setTransform(k, 0, 0, k, 0, 0); c.shadowBlur = 0; c.globalAlpha = 1; const fly = g.fly && g.fly.on, AMB = '#ffb82e', RED = '#ff5340';
    /* hurt: a red breath at the edges, deeper when badly hurt; arcs toward what hit */
    const hp = clamp(cb.health, 0, 100), lowK = hp < 35 && !this.dead ? (0.25 + 0.2 * Math.sin(this.t * 5)) * (1 - hp / 35) : 0, vg = Math.max(this.hurtT * 0.3, lowK);
    if (this.level > 0 && !fly) c.clearRect(0, 0, 640, 128);
    if ((this.level > 0 || (this.dead && !this.dead.woke)) && !fly) c.clearRect(W / 2 - 480, Ht - 160, 960, 110);
    if (this.hurtT > 0.05 && !fly) for (const q of this.inds) { const rel = wrapPi(q.a - g.cam.yaw), sa = -Math.PI / 2 - rel, ux = Math.cos(sa), uy = Math.sin(sa), al = clamp((q.t - 0.85) / 0.45, 0, 1) * 0.1, ex2 = W / 2 + ux * W * 0.62, ey2 = Ht / 2 + uy * Ht * 0.72, gr = c.createRadialGradient(ex2, ey2, 0, ex2, ey2, Ht * 0.36); if (al <= 0) continue; gr.addColorStop(0, 'rgba(190,10,6,' + al.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(190,10,6,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, Ht); }
    if (vg > 0.01 && !fly) { const gr = c.createRadialGradient(W / 2, Ht / 2, Ht * 0.62, W / 2, Ht / 2, Ht * 1.02); gr.addColorStop(0, 'rgba(150,0,0,0)'); gr.addColorStop(1, 'rgba(165,8,4,' + Math.min(0.85, vg).toFixed(3) + ')'); c.fillStyle = gr; c.fillRect(0, 0, W, Ht); }
    for (const q of this.inds) { const rel = wrapPi(q.a - g.cam.yaw), sa = -Math.PI / 2 - rel, al = clamp(q.t / 0.5, 0, 1); c.globalAlpha = al; c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 10; c.lineCap = 'round'; c.beginPath(); c.arc(W / 2, Ht / 2, 200, sa - 0.2, sa + 0.2); c.stroke(); c.strokeStyle = RED; c.lineWidth = 6; c.beginPath(); c.arc(W / 2, Ht / 2, 200, sa - 0.2, sa + 0.2); c.stroke();
      c.fillStyle = RED; c.beginPath(); c.moveTo(W / 2 + Math.cos(sa) * 224, Ht / 2 + Math.sin(sa) * 224); c.lineTo(W / 2 + Math.cos(sa - 0.05) * 208, Ht / 2 + Math.sin(sa - 0.05) * 208); c.lineTo(W / 2 + Math.cos(sa + 0.05) * 208, Ht / 2 + Math.sin(sa + 0.05) * 208); c.closePath(); c.fill(); c.globalAlpha = 1; c.lineCap = 'butt'; }
    if (!fly) {
      /* health, bottom left above the street name: ten blocks */
      { const x = 36, y = Ht - (pl.vehicle ? 132 : 78) - 50, low = hp < 35; H.panel(x, y, 232, 40); c.fillStyle = low ? RED : AMB; c.fillRect(x, y, 5, 40); H.text('BODY', x + 22, y + 26, 12, 'rgba(255,255,255,0.72)', 'left', 700, 2);
        for (let i = 0; i < 10; i++) { const f = i === 0 && hp > 0 && !this.dead ? 1 : clamp(hp / 10 - i, 0, 1); c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(x + 78 + i * 14.4, y + 14, 11.4, 13); if (f > 0) { c.fillStyle = low ? RED : this.hurtT > 0.3 ? '#fff' : '#f2f2ee'; c.fillRect(x + 78 + i * 14.4, y + 14, 11.4 * f, 13); } } }
      /* heat, top right beside the cash: five rising bars; red while they have eyes on you, amber and draining while they search */
      if (this.level > 0 || this.pulse > 0) { const x = W - 216 - 12 - 262, y = 34, L = this.level, seen = this.seen, col = seen ? RED : AMB, pu = this.pulse; H.panel(x, y, 262, 52); c.fillStyle = col; c.fillRect(x, y, 5, 52);
        H.text('HEAT', x + 20, y + 22, 12, 'rgba(255,255,255,0.72)', 'left', 700, 2.5); H.text(L ? (seen ? (L >= 3 ? 'UNITS ON YOU' : 'EYES ON YOU') : 'SEARCHING') : 'CLEAR', x + 20, y + 40, 12, L ? col : 'rgba(255,255,255,0.7)', 'left', 800, 1.5);
        for (let i = 0; i < 5; i++) { const bh = 14 + i * 5.5, bx = x + 162 + i * 18, by = y + 44 - bh, on = i < L, blink = on && seen && Math.floor(this.t * 4) % 2 === 0 && i === L - 1; c.fillStyle = on ? (blink ? '#fff' : col) : 'rgba(255,255,255,0.16)'; c.beginPath(); c.moveTo(bx + 4, by - (on ? pu * 4 : 0)); c.lineTo(bx + 14, by - (on ? pu * 4 : 0)); c.lineTo(bx + 10, y + 44); c.lineTo(bx, y + 44); c.closePath(); c.fill(); }
        if (L && !seen) { const u = clamp(this.coolT / COOL[L], 0, 1); c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 20, y + 46, 120, 3); c.fillStyle = AMB; c.fillRect(x + 20, y + 46, 120 * (1 - u), 3); } }
      this.hudMap(H, c, W, Ht);
      /* what the officers shout */
      if (this.sub && !this.dead) { const a = clamp(Math.min(this.sub.t * 5, (2.6 - this.sub.t) * 2), 0, 1); c.globalAlpha = a; c.font = '600 21px "Helvetica Neue", Helvetica, Arial, sans-serif'; const tw = c.measureText(this.sub.text).width + 86; H.panel(W / 2 - tw / 2, Ht - 196, tw, 38, 5); c.fillStyle = '#7fb2ff'; c.fillRect(W / 2 - tw / 2, Ht - 196, 4, 38); H.text('PD', W / 2 - tw / 2 + 16, Ht - 171, 12, '#7fb2ff', 'left', 800, 1.5); H.text(this.sub.text, W / 2 + 18, Ht - 170, 21, '#fff', 'center', 600); c.globalAlpha = 1; }
    }
    /* down: the picture goes dark, our own words */
    const D = this.dead; if (D && !D.woke && !D.arrest && D.t > 0.7) { const a = clamp((D.t - 0.7) / 0.4, 0, 1); c.globalAlpha = a; c.fillStyle = 'rgba(8,9,10,0.8)'; c.fillRect(0, Ht * 0.38, W, 150); H.text('LIGHTS OUT', W / 2, Ht * 0.38 + 78, 64, '#ff4a3d', 'center', 800, 14); H.text('You went down at heat ' + D.level, W / 2, Ht * 0.38 + 124, 22, '#fff', 'center', 600, 2); c.globalAlpha = 1; }
    if (D && D.arrest && !D.woke) { c.globalAlpha = clamp((D.t - 1.4) / 0.6, 0, 1); c.fillStyle = 'rgba(8,9,10,0.55)'; c.fillRect(0, Ht * 0.38, W, 132); H.text('IN CUFFS', W / 2, Ht * 0.38 + 76, 64, '#7fb2ff', 'center', 800, 14); H.text('You gave yourself up', W / 2, Ht * 0.38 + 112, 22, '#fff', 'center', 600, 2); c.globalAlpha = 1; }
    if (this.fade > 0.001) { c.fillStyle = 'rgba(0,0,0,' + this.fade.toFixed(3) + ')'; c.fillRect(0, 0, W, Ht); }
    if (this.note && !(D && !D.woke)) { const b = this.note, a = clamp(Math.min(b.t * 2.5, (4.5 - b.t) * 2), 0, 1); c.globalAlpha = a; c.fillStyle = 'rgba(8,9,10,0.62)'; c.fillRect(0, Ht * 0.3, W, 118); H.text(b.title, W / 2, Ht * 0.3 + 62, 50, AMB, 'center', 800, 9); H.text(b.sub, W / 2, Ht * 0.3 + 98, 22, '#fff', 'center', 600, 1.5); c.globalAlpha = 1; }
  }
  hudMap(H, c, W, Ht) {
    const g = this.g, pl = g.player, Rm = H.mapR, cx = W - 36 - Rm, cy = Ht - 36 - Rm, zoom = 1.25, yaw = g.cam.yaw; if (!this.level && !this.cops.length && !this.cars.length) return;
    c.save(); c.beginPath(); c.arc(cx, cy, Rm - 1, 0, 7); c.clip(); c.translate(cx, cy); c.rotate(yaw - Math.PI / 2); c.scale(zoom, zoom);
    const P = (x, y) => [x - pl.x, -(y - pl.y)];
    if (this.level > 0) { const q = P(this.lkp.x, this.lkp.y), r = AREA[this.level], seen = this.seen; c.fillStyle = seen ? 'rgba(255,83,64,0.16)' : 'rgba(255,184,46,0.15)'; c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.fill(); c.strokeStyle = seen ? 'rgba(255,83,64,0.9)' : 'rgba(255,184,46,0.9)'; c.lineWidth = 1.6; c.setLineDash(seen ? [] : [5, 4]); c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.stroke(); c.setLineDash([]);
      if (!seen) { c.strokeStyle = '#ffb82e'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(q[0] - 4, q[1] - 4); c.lineTo(q[0] + 4, q[1] + 4); c.moveTo(q[0] + 4, q[1] - 4); c.lineTo(q[0] - 4, q[1] + 4); c.stroke(); } }
    const bl = Math.floor(this.t * 3) % 2 === 0;
    for (const v of this.cars) { if (v.wreck || v.left) continue; const q = P(v.x, v.y); c.save(); c.translate(q[0], q[1]); c.rotate(-v.h); c.fillStyle = '#0b0c0e'; c.fillRect(-4.2, -2.6, 8.4, 5.2); c.fillStyle = this.level && bl ? '#ff4a3a' : '#5aa0ff'; c.fillRect(-3.2, -1.7, 6.4, 3.4); c.restore(); }
    for (const k of this.cops) { if (k.hp <= 0) continue; const q = P(k.x, k.y); c.fillStyle = '#0b0c0e'; c.beginPath(); c.arc(q[0], q[1], 4.6, 0, 7); c.fill(); c.fillStyle = k.see ? '#ff6a5a' : '#6fb0ff'; c.beginPath(); c.arc(q[0], q[1], 3.4, 0, 7); c.fill(); }
    c.restore();
  }
}
