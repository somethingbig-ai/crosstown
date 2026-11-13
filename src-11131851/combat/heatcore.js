// combat/heatcore.js (the body of the police; fetched by combat/heat.js on first need, never at load): the law answers the player's crimes, and the player can be hurt and die.
//   HEAT (five steps): crimes seen or heard by people raise it; police answer in proportion (officers on foot, patrol cars by road,
//   heavier units with long guns); it cools one step at a time while no officer has eyes on the player, faster outside the search area.
//   Health: bullets, blasts and being run over hurt; it comes back slowly out of combat; at zero the player falls (the people
//   helper's ragdoll on the player figure), the camera pulls up, the screen fades, and the player wakes outside a clinic.
// One line at the end of Combat.init loads this; everything else is wrapped from here.   ?heat=none  off    ?heatlog=1  numbers in the console
// Sim space is the game's (x east, y north, z up); three.js space is (x, z, -y).
import * as THREE from 'three';
import { clamp, lerp, wrapPi, StaticWorld } from '../geo.js';
import { WEAPONS } from './combat.js';
import { AimRig } from './rig.js';
import { Vehicle } from '../game.js';
import { SCRIPTS, Script } from './scripts.js';

const TH = [0, 1, 3, 7, 12, 18], PMAX = 20;
/* seconds unseen to lose one step, and the search radius, per step */
const COOL = [0, 10, 13, 16, 20, 24], AREA = [0, 40, 52, 64, 76, 90];
/* officers alive at once, and seconds between dispatches, per step */
const FORCE = [0, 2, 4, 6, 8, 10], DISP = [0, 1.5, 7, 6, 5, 4];
const CRIME = { shots: { p: 0.12, min: 1, cap: 3 }, wound: { p: 1 }, kill: { p: 2 }, copHit: { p: 0.2, min: 2 }, copKill: { p: 2, min: 3 }, blast: { p: 3 }, runover: { p: 1.5 }, jack: { p: 1.2, soft: 1 }, crash: { p: 0.55, cap: 3, soft: 1 }, crashHard: { p: 1, cap: 3, soft: 1 }, copRam: { p: 1.2, min: 1, cap: 7 }, reckless: { p: 0.6, cap: 3, soft: 1 } };
/* share of an officer's damage that lands, and how wide he shoots, per step: the first two officers are a warning, the top is a wall */
/* how far they know him from, as a share of 80 m on foot and 60 m from a moving car: at one step a block's run loses them */
const EYE = [1, 0.48, 0.6, 0.78, 1, 1];
const LETH = [0, 0.6, 0.7, 0.85, 1, 1.15], WIDE = [1, 1.15, 1.1, 1.05, 1, 0.92];
/* how officers shoot: error (degrees, one sigma), share of the weapon's damage that reaches the player, burst and pause */
const GUN = { pistol: { sig: 1.7, dm: 0.42, burst: [2, 4], gap: [0.3, 0.45], rest: [0.7, 1.6], band: [8, 17], mag: 15 }, shotgun: { sig: 2.8, dm: 0.3, burst: [1, 1], gap: [1.1, 1.1], rest: [0.5, 1.0], band: [7, 14], mag: 6, pellets: 6 }, rifle: { sig: 1.8, dm: 0.24, burst: [3, 5], gap: [0.1, 0.1], rest: [0.9, 1.8], band: [14, 30], mag: 30 } };
/* how each officer carries himself in the fight, so that no two of a crew look alike (rounds 15-20: 'the same upright two-hand pose on three men'): 0 goes down on one knee between
   bursts and fires from the knee in the open, 1 stands braced and bladed, leaning into the gun, 2 works low and leans out round the end of his cover to fire and back in, 3 kneels on the other knee, turned a little */
const STY = [{ topC: 0.8, topD: 0.5, topO: 0.5, lowC: 0.24, lowD: 0.26, lowO: 0.42, kneel: 1, blade: 0, lean: 0.08, fwd: 0.04 }, { topC: 0.94, topD: 0.97, topO: 0.97, lowC: 0.52, lowD: 0.52, lowO: 0.8, kneel: 0, blade: 0.5, lean: 0, fwd: 0.2 }, { topC: 0.8, topD: 0.84, topO: 0.74, lowC: 0.3, lowD: 0.36, lowO: 0.56, kneel: 0, blade: -0.22, lean: 0.3, fwd: 0.08 }, { topC: 0.86, topD: 0.62, topO: 0.56, lowC: 0.36, lowD: 0.3, lowO: 0.46, kneel: -1, blade: 0.28, lean: 0.14, fwd: 0.1 }];
const D2R = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
const _o = {}, _t = {}, _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const F = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const REAL = (() => { try { return !!document.createElement('canvas').getContext('2d').createImageData(1, 1).data; } catch (e) { return false; } })();
const CLINICS = [['Mercy Walk-In', -196, -214], ['Eastside Urgent Care', 260, 280], ['St. Odile Clinic', -340, 240], ['Fifth Ward Medical', 300, -300], ['Midtown Walk-In', 20, 10]];

export async function addHeat(game, combat) {
  if (game.P.get('heat') === 'none' || game.P.get('heat') === '0') return null;
  const H = new Heat(game, combat); H.init();
  if (game.P.has('script')) try { (await import('./heatscripts.js')).register(game, combat, H, SCRIPTS, Script); } catch (e) { console.log('[heat] scripts not loaded: ' + e.message); }
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
    this.seed = (20261110 + 7919 * (+game.P.get('heatseed') || 0)) >>> 0; this.log = game.P.has('heatlog'); this.fast = game.P.has('heatfast'); this.pool = []; this.corpses = []; this.god = game.P.has('heatgod'); this.stopD = +game.P.get('heatstop') || 22; this.half = game.P.get('heathalf') !== '0'; /* how far the nose swings across the lane as a car brakes into the scene: 1 = broadside (the crew fights from behind the car), about 0.3 = nose toward him at an angle, both doors open, each man behind his own door */ this.swingK = game.P.has('heatswing') ? +game.P.get('heatswing') : 1;
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
      if (h.kind === 'door') { try { c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(h.nx, 0, -h.ny), 'metal'); /* and the round leaves its hole in the panel */ if (c.fx.decal) c.fx.decal('metal', _v.set(h.x + h.nx * 0.03, h.z, -(h.y + h.ny * 0.03)), _v2.set(h.nx, 0, -h.ny), 0.09 + Math.random() * 0.07); if (first) c.snd('impact', 'metal', { dist: 10 }); } catch (e) {} return 'prop'; }
      const r = hit0(h, W, first); if (self.copFire) return r;
      if (r === 'ped') self.crime('wound', h.x, h.y); else if (r === 'kill') self.crime('kill', h.x, h.y); else if (r === 'car') self.lastCarHitT = self.t;
      return r; };
    const ex0 = c.explode.bind(c); c.explode = function (v, S) { self.blast = { x: v.x, y: v.y }; const mine = g.player.vehicle === v, h0 = c.health; ex0(v, S); if (self.t - self.lastCarHitT < 15) self.crime('blast', v.x, v.y); if (mine) { if (h0 > 55) { if (c.health < 12) c.health = 12; } else c.hurt(999); } self.blast = null; };
    const hurt0 = c.hurt.bind(c); c.hurt = function (n) { if (self.dead || c.dead || self.god) return; hurt0(n); self.onHurt(n, self.src || self.blast); };
    const ph0 = g.onPedHit.bind(g); g.onPedHit = function (p, v) { ph0(p, v); /* (guns v1 hands a bullet to the lead's pedhit as a stand-in car: that is not a running-over) */ if (v === g.player.vehicle && !v.bullet && !self._ph) self.crime('runover', p.x, p.y); };
    const te0 = g.tryEnter.bind(g); g.tryEnter = function () { let n = null; try { n = g.nearestCar(); } catch (e) {} const ok = te0(); if (ok && n && (n.kind === 'traffic' || (n.kind === 'veh' && n.v.patrol))) self.crime('jack', g.player.x, g.player.y); return ok; };
    if (typeof g.onCrash === 'function') { const cr0 = g.onCrash.bind(g); g.onCrash = function (v, f) { cr0(v, f); try { self.onCrash(v, f); } catch (e) { self.oops('crash', e); } }; }
    /* what hides a man from an officer, and what the way round goes by: buildings only. The game's own set also holds low fences and tree guards: those stop feet and wheels (walkTo steps round them) but hide nobody */
    this.wall = new StaticWorld(); try { for (const b of g.city.buildings) if (b.minh < 2.5) { this.wall.addPoly(b.poly); for (const h of b.holes || []) this.wall.addPoly(h); } } catch (e) { this.wall = g.statics; this.oops('wall', e); }
    /* the frame */
    /* no 'F Get in' prompt over a man who is down or in cuffs (rounds 21-24: 'a Get in prompt still floating over the corpse') */
    if (typeof g.nearestCar === 'function') { const nc0 = g.nearestCar.bind(g); g.nearestCar = function (...a) { if (self.dead && !self.dead.woke) return null; return nc0(...a); }; }
    const step0 = g.step.bind(g); g.step = function (dt) { step0(dt); try { self.step(dt); } catch (e) { if (!self._err) { self._err = true; console.log('[heat] step: ' + (e && (e.stack || e.message))); } } };
    const ri0 = g.readInput.bind(g); g.readInput = function () { ri0(); if (self.dead) { const I = g.input; I.mx = I.my = I.steer = I.throttle = 0; I.brake = 0; I.run = false; I.use = false; c.mx = c.my = 0; } };
    const sync0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { try { self.preSync(dt); } catch (e) { self.oops('pre', e); } sync0(dt); try { self.postSync(dt); } catch (e) { self.oops('post', e); } };
    /* gun smoke in a firefight: every round leaves veils that hang for three or four seconds, and with four people firing the street filled with it (capture h9c: the patrol car
       went 'chalk white', officers were 'grey smoke-ghosts', police flashes were hidden). While heat is on, a veil is thinner and shorter-lived the more rounds were fired in the
       last three seconds, and an officer's own is a third of the player's. ?heatsmoke=0 leaves the guns' smoke alone. */
    if (c.fx && typeof c.fx.muzzle === 'function' && typeof c.fx.spawn === 'function' && g.P.get('heatsmoke') !== '0') { const fx = c.fx, mz0 = fx.muzzle, shots = []; fx.muzzle = function (...a) { if (!self.level && !self._copShot) return mz0.apply(fx, a); const now = self.t; while (shots.length && now - shots[0] > 3) shots.shift(); const k = (self._copShot ? 0.3 : 0.6) / (1 + 0.5 * shots.length); /* the player's own veil lies on his line of sight, over the man he is shooting at ('a grey smear covers the officer', round 12) */ shots.push(now); const sp0 = fx.spawn; fx.spawn = function (o) { if (o && o.life > 2 && o.a && o.s1 > 0.4 && !o.add) { o.a *= k; o.life *= 0.45 + 0.55 * k; } return sp0.call(fx, o); }; try { return mz0.apply(fx, a); } finally { fx.spawn = sp0; } }; }
    const place0 = g.placeCamera.bind(g); g.placeCamera = function (dt) { if (self.dead && self.dead.cam) self.deathCam(); else { place0(dt); if (self.flinch > 0.001) { const cam = g.world.camera; cam.rotateZ(self.flinchZ * 1.5 * self.flinch); cam.rotateX(0.04 * self.flinch); cam.translateZ(0.09 * self.flinch); cam.translateY(-0.035 * self.flinch); cam.updateMatrixWorld(); } } };
    const hud0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { hud0(); try { self.hud(); } catch (e) { self.oops('hud', e); } };
    this.flinch = 0; this.flinchZ = 0;
    if (REAL) { try { this.buildShared(); } catch (e) { console.log('[heat] visuals: ' + e.message); } }
  }
  /* a crash the game reports for the player's car: into a patrol car, into a car with a driver, or anything at all in front of an officer */
  onCrash(v, f) {
    const g = this.g, pl = g.player; if (v !== pl.vehicle || this.dead || this.t - (this.crashT || -9) < 1.5 || !(f > 4)) return;
    const reach = (o) => Math.hypot(o.x - v.x, o.y - v.y) < (v.def.len + o.def.len) * 0.5 + 0.9;
    for (const o of this.cars) if (o !== v && !o.wreck && !o.left && reach(o)) { /* who was driving at whom: his speed toward the patrol car as it was BEFORE the contact (the game has already bounced him off when it reports the crash), against the patrol car's toward him */ const dx = o.x - v.x, dy = o.y - v.y, d = Math.hypot(dx, dy) || 1, P0 = this.pv0 || [v.vx, v.vy], mine = (P0[0] * dx + P0[1] * dy) / d, his = o.drive ? -(Math.cos(o.h) * dx + Math.sin(o.h) * dy) / d * (o.vf || 0) : 0; if (!(o.drive && this.t - (o.drive.hitT || -9) < 1.2) && mine > 3 && mine > his) { this.crashT = this.t; this.crime('copRam', v.x, v.y, 2); } return; }
    let hit = false; if (f > 7.5) for (const o of g.traffic.cars) if (Math.abs(o.x - v.x) < 9 && Math.abs(o.y - v.y) < 9 && reach(o)) { hit = true; break; }
    if (hit) { this.crashT = this.t; this.crime(f > 13 ? 'crashHard' : 'crash', v.x, v.y, 1); return; }
    if (this.cops.some((k) => k.hp > 0 && k.see && k.dist < 45)) { this.crashT = this.t; this.crime('reckless', v.x, v.y, 2); }
  }
  /* how far an officer knows the player from: a third of it once he has changed cars (or left his car) out of their sight */
  /* just lost a driver: for nine seconds they go on the way he was going */
  guess() { const lk = this.lkp; return !this.seen && this.unseenT < 9 && !!this.g.player.vehicle && Math.hypot(lk.vx || 0, lk.vy || 0) > 5; }
  eyeR(r) { return (this.swapK ? 0.32 : 1) * r * EYE[this.level]; }
  oops(k, e) { this._errs = this._errs || {}; if (this._errs[k]) return; this._errs[k] = true; console.log('[heat] ' + k + ': ' + (e && (e.stack || e.message))); }

  // ------------------------------------------------------------------ heat
  witnesses(x, y) {
    const g = this.g; for (const k of this.cops) if (k.hp > 0 && Math.hypot(k.x - x, k.y - y) < 90 && k.see) return 2;
    let n = 0; for (const p of g.peds.list) if (p.state !== 'down' && Math.abs(p.x - x) < 45 && Math.abs(p.y - y) < 45) n++;
    const cs = g.crowd && g.crowd.on && g.crowd.sim; if (cs) for (const a of cs.agents) if (!a.gone && Math.abs(a.x - x) < 45 && Math.abs(a.y - y) < 45) { n++; if (n > 2) break; }
    return n > 0 ? 1 : 0;
  }
  crime(kind, x, y, wMin = 0) {
    const C = CRIME[kind]; if (!C || this.dead) return; if (!C.soft) this.violT = this.t; if (kind === 'jack') this.jackP = this.t; const w = Math.max(wMin, this.witnesses(x, y)); this.stats.crimes[kind] = (this.stats.crimes[kind] || 0) + 1; if (!w) return;
    /* officers on the scene know at once; a bystander's call takes a moment */
    if (w === 2 && kind === 'shots') { /* fired in front of them: they answer within a human reaction time */ if (this.t - (this.firedSeenT ?? -99) > 8) for (const k of this.cops) if (k.hp > 0 && k.see) k.fireCd = Math.min(k.fireCd, this.rr(0.22, 0.5)); this.firedSeenT = this.t; }
    if (w === 2 || this.level > 0) this.addHeat(kind, x, y); else if (!this.pending.some((q) => q.kind === kind)) this.pending.push({ kind, x, y, t: kind === 'shots' ? 0.8 : 1.6 });
  }
  addHeat(kind, x, y) {
    const C = CRIME[kind], l0 = this.level; let p = this.pts;
    if (C.cap === undefined || p < C.cap) p = Math.min(C.cap ?? PMAX, p + C.p); if (C.min) p = Math.max(p, C.min); this.pts = Math.min(PMAX, p);
    this.lastCrimeT = this.t; this.coolT = 0; this.onScene = false; this.setLevel();
    if (this.level > l0) { if (l0 === 0) { const pl = this.g.player; this.lkp.x = pl.x; this.lkp.y = pl.y; this.dispT = DISP[1]; this.unseenT = 0; this.swapK = false; this.seenVeh = pl.vehicle || null; } this.pulse = 1; this.stats.levelT[this.level] = this.stats.levelT[this.level] ?? +this.t.toFixed(1); this.say('HEAT ' + this.level + ' (' + kind + ', ' + this.pts.toFixed(1) + ' pts)');
      if (this.level >= 3 && l0 < 3) this.shout('Shots fired, officers need help! Send everything!', 2); if (this.level === 5) this.shout('All units: suspect is armed. Take the shot.', 2); }
  }
  setLevel() { let l = 0; for (let i = 1; i <= 5; i++) if (this.pts >= TH[i]) l = i; this.level = l; this.stats.maxLevel = Math.max(this.stats.maxLevel, l); }
  clear(why) { if (this.level > 0 || this.pts > 0) this.say('heat cleared: ' + why); this.pts = 0; this.level = 0; this.coolT = 0; this.seen = false; this.pending.length = 0; this.chal = null; for (const k of this.cops) if (k.hp > 0) k.mode = 'leave'; for (const car of this.cars) car.leaveT = 0; }
  los(ax, ay, bx, by) {
    const g = this.g; if (this.wall.raycast(ax, ay, bx, by) < 1) return false;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, tall = (v) => { if (v.def.hgt < 1.9) return false; const ex = v.x - ax, ey = v.y - ay, al = (ex * dx + ey * dy) / L; if (al < 1 || al > L - 1) return false; return Math.abs(ex * dy - ey * dx) / L < v.def.wid * 0.5; };
    for (const v of g.traffic.cars) if (tall(v)) return false; for (const v of g.vehicles) if (tall(v)) return false; return true;
  }
  sight() {
    const g = this.g, pl = g.player; let seen = false; const hl = g.heli, up = !!(hl && hl.piloted && hl.f && hl.f.pos && hl.f.pos.y > 22) /* in the air above the roofs nobody on the street has him */;
    for (const k of this.cops) { if (k.hp <= 0) continue; const d = Math.hypot(k.x - pl.x, k.y - pl.y); k.dist = d; k.see = !up && d < this.eyeR(80) * (k.saw ? 1.2 : 1) && this.los(k.x, k.y, pl.x, pl.y); if (k.see) { seen = true; k.onT += 0.1; if (!k.saw) k.thinkT = Math.min(k.thinkT, 0.12); } else k.onT = 0; k.saw = k.see; }
    for (const car of this.cars) if (!up && car.drive && !car.wreck && Math.hypot(car.x - pl.x, car.y - pl.y) < this.eyeR(pl.vehicle ? 95 : 60) && this.los(car.x, car.y, pl.x, pl.y)) seen = true;
    if (this.level === 0) seen = false;
    if (seen) { if (!this.seen && this.unseenT > 4) this.shout(this.pick(['There! Suspect in sight!', 'Got eyes on him!', 'Contact! He is right there!']), 1); this.lkp.x = pl.x; this.lkp.y = pl.y; this.lkp.h = pl.vehicle ? pl.vehicle.h : pl.h; this.lkp.t = this.t; this.lkp.vx = pl.vehicle ? pl.vehicle.vx : 0; this.lkp.vy = pl.vehicle ? pl.vehicle.vy : 0; this.unseenT = 0; this.coolT = 0; this.onScene = false; this.swapK = false; this.seenVeh = pl.vehicle || null;
      /* driving on the sidewalk at speed in front of them */ const pv = pl.vehicle; if (pv && this.t - (this.reckT || -9) > 6 && Math.hypot(pv.vx, pv.vy) > 9 && g.statics.onSidewalk(pv.x, pv.y)) { this.reckT = this.t; this.crime('reckless', pv.x, pv.y, 2); } }
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
    this.idle = !this.level && !this.cops.length && !this.cars.length && !this.dead && !this.pending.length && c.health >= 100 && !this.sub && !this.note && !this.inds.length && this.hurtT <= 0 && this.flinch < 0.002 && this.pulse <= 0 && !(this.fade > 0);
    if (this.idle) { if (this.pts > 0) this.pts = Math.max(0, this.pts - dt * 0.04); return; }
    if (!this.level && this.pts > 0) this.pts = Math.max(0, this.pts - dt * 0.04);
    /* a car taken from its driver is the car they look for */ if (this.jackP !== undefined && pl.vehicle && !pl.busy) { if (this.t - this.jackP < 12) this.seenVeh = pl.vehicle; this.jackP = undefined; }
    if (this.level > 0 && !this.seen && !this.swapK && !pl.busy && this.jackP === undefined && this.unseenT > 1.5 && (pl.vehicle || null) !== (this.seenVeh || null) && !(pl.vehicle && pl.vehicle.patrol)) { this.swapK = true; this.coolT += COOL[this.level] * 0.5; this.say('changed ride unseen'); }
    for (let i = this.pending.length - 1; i >= 0; i--) { const q = this.pending[i]; q.t -= dt; if (q.t <= 0) { this.pending.splice(i, 1); this.addHeat(q.kind, q.x, q.y); } }
    { const pv = pl.vehicle; /* his car's speed at the last step, before whatever it hits next (see onCrash) */ this.pv0 = pv ? [pv.vx, pv.vy] : null; }
    { const pv = pl.vehicle, T = this.trail || (this.trail = []); if (!pv) T.length = 0; else if (!T.length || Math.hypot(pv.x - T[T.length - 1][0], pv.y - T[T.length - 1][1]) > 6) { T.push([pv.x, pv.y]); if (T.length > 18) T.shift(); } }
    this.rsT = (this.rsT || 0) + dt; if (this.rsT >= 0.3) { this.realSp = this.rsX === undefined ? 9 : Math.hypot(pl.x - this.rsX, pl.y - this.rsY) / this.rsT; this.rsX = pl.x; this.rsY = pl.y; this.rsT = 0; }
    { const pv = pl.vehicle; this.slowT = pv && Math.hypot(pv.vx, pv.vy) < 4 ? (this.slowT || 0) + dt : 0; }
    this.sightT -= dt; if (this.sightT <= 0) { this.sightT = 0.1; this.sight(); }
    if (this.level > 0 && !this.dead) {
      if (!this.seen && this.guess()) { const B = g.bounds, lk = this.lkp; lk.x = clamp(lk.x + lk.vx * dt, -B.x + 30, B.x - 30); lk.y = clamp(lk.y + lk.vy * dt, -B.y + 30, B.y - 30); }
      if (!this.seen) { this.unseenT += dt; const out = Math.hypot(pl.x - this.lkp.x, pl.y - this.lkp.y) > AREA[this.level];
        if (!this.onScene && this.cops.some((k) => k.hp > 0 && Math.hypot(k.x - this.lkp.x, k.y - this.lkp.y) < 14)) this.onScene = true;
        if (this.unseenT > 2 && this.t - this.lastCrimeT > 5) this.coolT += dt * (out ? [0, 2, 2, 1.6, 1.3, 1.2][this.level] : this.onScene ? 1 : this.unseenT > 10 && !(Math.hypot(pl.x - this.lkp.x, pl.y - this.lkp.y) < 12 && this.t - this.lastCrimeT < 45 && (this.cops.some((k) => k.hp > 0 && k.mode !== 'leave') || this.cars.some((v) => v.drive && !v.away && !v.left))) ? 0.6 : 0);
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
    this.hurtT = Math.max(0, this.hurtT - dt); this.flinch *= Math.exp(-dt * 5.5); this.vgT = Math.max(0, (this.vgT || 0) - dt / 0.55); this.pulse = Math.max(0, this.pulse - dt * 0.7);
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
    this.dispT += dt; const L = this.level, g0 = this.g; const pv0 = g0.player.vehicle, hunt = pv0 && Math.hypot(pv0.vx, pv0.vy) > 6 && !this.cars.some((v) => v.drive && !v.left && Math.hypot(v.x - pv0.x, v.y - pv0.y) < 100); if (this.dispT < DISP[L] * (this.fast || hunt ? 0.5 : 1)) return;
    const alive = this.cops.filter((k) => k.hp > 0 && k.mode !== 'leave').length, crew = this.cars.reduce((n, v) => n + (v.drive && !v.left && !v.wreck ? (v.heavy ? 3 : 2) : 0), 0);
    if (alive + crew >= FORCE[L]) return; this.dispT = 0;
    const cars = this.cars.filter((v) => !v.wreck && !v.left).length, wantCars = [0, 0, 1, 2, 4, 6][L], foot = this.cops.some((k) => k.hp > 0 && !k.car);
    if (cars < wantCars && alive + crew + 2 <= FORCE[L]) { const heavy = L >= 4 && this.cars.filter((v) => v.heavy && !v.wreck).length < L - 3; if (this.sendCar(heavy, this.fast ? 2 : 0)) return; }
    if ((L < 3 || !foot || cars >= wantCars) && g0.P.get('heatfoot') !== '0') this.sendFoot();
  }
  sendFoot() {
    const g = this.g, pl = g.player, st = g.statics; let best = null, cf = null; try { const m = g.world.camera.matrixWorld.elements, l = Math.hypot(m[8], m[10]); if (l > 0.2) cf = [-m[8] / l, m[10] / l]; } catch (e) {}
    for (let k = 0; k < 40 && !best; k++) { const a = this.rnd() * 6.283, d = this.fast ? this.rr(20, 32) : k < 22 ? this.rr(32, 58) : this.rr(55, 95), x = this.lkp.x + Math.cos(a) * d, y = this.lkp.y + Math.sin(a) * d; if (Math.abs(x) > g.bounds.x - 8 || Math.abs(y) > g.bounds.y - 8) continue; if (!st.onSidewalk(x, y) || st.resolve(x, y, 0.5, _o) > 0) continue; if (this.wall.raycast(pl.x, pl.y, x, y) >= 1 && Math.hypot(x - pl.x, y - pl.y) < 130) { /* in the open: only well outside what the camera shows */ const dp = Math.hypot(x - pl.x, y - pl.y); if (dp < 40 || !cf || (cf[0] * (x - pl.x) + cf[1] * (y - pl.y)) / dp > 0.2) continue; } if (!this.pathNodes(x, y, this.lkp.x, this.lkp.y) && this.wall.raycast(x, y, this.lkp.x, this.lkp.y) < 1) continue; best = { x, y }; }
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
    if (e0 === ne.e) { const sT = dir0 > 0 ? ne.s : e0.len - ne.s, li = lane(e0, dir0), b = sT > s0 - 4 ? Math.max(s0 + 2, sT) : e0.len - 1; for (let s = s0; s < b; s += 7) { R.lanePos(e0, dir0, li, s, _t); pts.push([_t.x, _t.y]); } R.lanePos(e0, dir0, li, b, _t); pts.push([_t.x, _t.y]); return pts.length > 1 ? pts : null; }
    best.segs.forEach((sg, i) => { if (sg.e === ne.e) return; const li = lane(sg.e, sg.dir), a = i === 0 ? s0 : 7, b = sg.e.len - 7; for (let s = a; s < b; s += 7) { R.lanePos(sg.e, sg.dir, li, s, _t); pts.push([_t.x, _t.y]); } R.lanePos(sg.e, sg.dir, li, Math.max(a, b), _t); pts.push([_t.x, _t.y]); });
    /* the last block: from that corner toward the place itself, either way along it */
    { const e = ne.e, dir = best.node === e.a ? 1 : -1, sT = dir > 0 ? ne.s : e.len - ne.s, ln = dir > 0 ? e.line : e.rev, off = e.oneway ? 0 : e.lw * 0.5; for (let s = 6; s < sT + 0.1; s += 6) { ln.at(s, _t); pts.push([_t.x + _t.ty * off, _t.y - _t.tx * off]); } ln.at(sT, _t); pts.push([_t.x + _t.ty * off, _t.y - _t.tx * off]); }
    return pts.length > 1 ? pts : null;
  }
  /* at the top two steps, with the player driving in their sight: one car at a time is sent to stop across the street ahead of him */
  sendCar(heavy, near) {
    const pl = this.g.player, pv = pl.vehicle, sp = pv ? Math.hypot(pv.vx, pv.vy) : 0, B = this.g.bounds; let goal = null;
    if (this.level >= 4 && pv && sp > 7 && this.seen && !this.cars.some((q) => q.goal && q.drive && !q.away)) { const ga = clamp(sp * 9, 95, 170); goal = { x: clamp(pl.x + pv.vx / sp * ga, -B.x + 30, B.x - 30), y: clamp(pl.y + pv.vy / sp * ga, -B.y + 30, B.y - 30), h: 0 }; }
    if (!goal && pv && sp > 6 && (this.tailN = (this.tailN || 0) + 1) % 2 === 1 && this.sendTail(heavy)) return true;
    if (!goal && pv && sp > 6 && (this.seen || this.unseenT < 4)) { /* he is driving: the next car comes out of a side street ahead of him, not from behind where it would never catch up */ const lk = this.lkp; this.lkp = { x: clamp(pl.x + pv.vx * 6, -B.x + 30, B.x - 30), y: clamp(pl.y + pv.vy * 6, -B.y + 30, B.y - 30), h: 0 }; this._clr = 35; try { if (this.sendCar0(heavy, 1)) return true; } finally { this.lkp = lk; this._clr = 0; } }
    if (!goal) return this.sendCar0(heavy, near);
    const lk = this.lkp, n0 = this.cars.length; this.lkp = goal; this._clr = Math.max(60, Math.hypot(goal.x - pl.x, goal.y - pl.y) * 0.6); this._hid = true; let ok = false; try { ok = this.sendCar0(heavy, 1); } finally { this.lkp = lk; this._clr = 0; this._hid = false; }
    if (ok && this.cars.length > n0) { this.cars[this.cars.length - 1].goal = goal; this.say('that one stops across the street ahead'); } return ok || this.sendCar0(heavy, near);
  }
  /* a patrol car on his tail: put on the line he has driven (kept every 6 m), 60-90 m back, only where the camera is not looking */
  sendTail(heavy) {
    const g = this.g, pl = g.player, T = this.trail || []; if (T.length < 11 || !(this.seen || this.unseenT < 4)) { this.say('no tail car: ' + (T.length < 11 ? 'he has not driven far enough' : 'he is not in sight')); return false; } let why = [0, 0, 0, 0]; let cf = null; try { const m = g.world.camera.matrixWorld.elements, l = Math.hypot(m[8], m[10]); if (l > 0.2) cf = [-m[8] / l, m[10] / l]; } catch (e) {}
    for (let j = T.length - 9; j >= Math.max(0, T.length - 17); j--) { const p = T[j], q = T[j + 1], dp = Math.hypot(p[0] - pl.x, p[1] - pl.y); if (dp < 45) { why[0]++; continue; } if (cf && (cf[0] * (p[0] - pl.x) + cf[1] * (p[1] - pl.y)) / dp > 0.15) { why[1]++; continue; }
      if (g.traffic.cars.some((o) => Math.hypot(o.x - p[0], o.y - p[1]) < 8) || g.vehicles.some((o) => Math.hypot(o.x - p[0], o.y - p[1]) < (o.patrol || Math.hypot(o.vx || 0, o.vy || 0) > 1 ? 9 : 2.6))) { why[2]++; continue; } if (g.statics.resolve(p[0], p[1], 0.8, _o) > 0) { why[3]++; continue; }
      const type = heavy ? 'suv' : 'sedan', def = g.kit.cars[type] || g.kit.cars.sedan, v = new Patrol(def, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), heavy ? 0x0b0d12 : 0x0d0d0f), pts = T.slice(j).map((c) => [c[0], c[1]]); pts.push([pl.x, pl.y]);
      Object.assign(v, { heat: this, patrol: true, heavy, drive: { pts, i: 1, blockT: 0, off: 0, ghost: 0, t0: this.t, d0: dp }, vf: 12, crew: [], doorK: 0, id: ++this.units, sideSgn: this.rnd() < 0.5 ? 1 : -1 });
      g.vehicles.push(v); this.cars.push(v); if (REAL) this.dressCar(v); this.say('dispatch: ' + (heavy ? 'heavy unit' : 'patrol car') + ' ' + v.id + ' on his tail, ' + Math.round(dp) + ' m back'); return true; }
    this.say('no tail car: places too near ' + why[0] + ', in the picture ' + why[1] + ', a car there ' + why[2] + ', something solid there ' + why[3]); return false;
  }
  /* a car that is on its way learns where he is now: a new way there from where it is */
  reroute(v) {
    const R = this.g.roads, lc = R.locate(v.x, v.y, v.h, 30); if (!lc) return false; if ((lc.s < 11 || lc.s > lc.e.len - 11) && lc.e.len > 30 && v.drive.pts.length - v.drive.i > 2) { v.drive.rT = 0.35; return false; } const e = lc.e, dir = lc.dir, s0 = Math.min(e.len - 1, lc.s + 7), p = this.routeTo(v.x, v.y, e, dir, s0);
    if (!p || p.length < 2 || p.length > 140) return false; v.drive.pts = p; v.drive.i = 0; v.drive.rN = (v.drive.rN || 0) + 1; return true;
  }
  sendCar0(heavy, near) {
    const g = this.g, R = g.roads, pl = g.player, cand = [];
    for (const e of R.edges) { if (e.out || e.len < 40) continue; e.line.at(e.len / 2, _t); const d = Math.hypot(_t.x - this.lkp.x, _t.y - this.lkp.y); if (near === 2 ? d < 85 || d > 150 : near ? d < 40 || d > 130 : d < 120 || d > 240) continue; if (Math.abs(_t.x) > g.bounds.x - 20 || Math.abs(_t.y) > g.bounds.y - 20) continue; if (!near && this.wall.raycast(pl.x, pl.y, _t.x, _t.y) >= 1) continue; if (this._clr && Math.hypot(_t.x - pl.x, _t.y - pl.y) < this._clr) continue; cand.push(e); }
    let nh = 0; if (this._hid) { const hid = [], vis = []; for (const e of cand) { e.line.at(e.len / 2, _t); (this.wall.raycast(pl.x, pl.y, _t.x, _t.y) < 1 ? hid : vis).push(e); } cand.length = 0; cand.push(...hid, ...vis); nh = hid.length; }
    for (let k = 0; k < (this._clr ? 12 : 6) && cand.length; k++) {
      const e = nh > 0 && k < 5 ? cand.splice(Math.floor(this.rnd() * nh--), 1)[0] : cand.splice(nh + Math.floor(this.rnd() * (cand.length - nh)), 1)[0]; let best = null; if (!e) continue;
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
    const g = this.g, D = v.drive, pl = g.player, plv = pl.vehicle, plSp = plv ? Math.hypot(plv.vx, plv.vy) : 0, G0 = v.goal || this.lkp, dPl = Math.hypot(pl.x - v.x, pl.y - v.y);
    /* the chase: he is driving and they have him */ const moving = !v.goal && !!plv && ((this.seen && (plSp > 4 || (this.slowT || 0) < 2.5)) || this.guess()), ram = this.seen && plSp > 4 && moving && this.level >= 3 && dPl < 32 && this.los(v.x, v.y, pl.x, pl.y);
    if (!v.goal && !D.stop) { D.rT = (D.rT || 0) - dt; const E = D.pts[D.pts.length - 1]; if (D.rT <= 0 && (Math.hypot(E[0] - this.lkp.x, E[1] - this.lkp.y) > 28 || (moving && D.i >= D.pts.length - 1))) { D.rT = 1.3; this.reroute(v); } }
    const P = D.pts;
    while (D.i < P.length - 1 && Math.hypot(P[D.i][0] - v.x, P[D.i][1] - v.y) < 6.5) D.i++;
    const tx = P[D.i][0], ty = P[D.i][1], cs = Math.cos(v.h), sn = Math.sin(v.h); let wx = tx, wy = ty;
    if (D.off) { const j = Math.max(1, D.i), sx = P[j][0] - P[j - 1][0], sy = P[j][1] - P[j - 1][1], sl = Math.hypot(sx, sy) || 1; wx += (-sy / sl) * D.off; wy += (sx / sl) * D.off; }
    D.dirT = (D.dirT || 0) - dt; if (D.dirT <= 0) { D.dirT = 0.1; D.dir = 0; if (moving && !D.stop) { /* only down a clear run of roadway: no kerb, sidewalk or square between them (in the browser the straight line crossed parked rows and street furniture, and both cars sat there) */ const road = (x1, y1) => { const dx = x1 - v.x, dy = y1 - v.y, d = Math.hypot(dx, dy), n = Math.ceil(d / 5); for (let q = 1; q < n; q++) if (g.statics.onSidewalk(v.x + dx * q / n, v.y + dy * q / n)) return false; return true; }; if (this.seen && dPl < 120 && this.los(v.x, v.y, pl.x, pl.y) && road(pl.x, pl.y)) D.dir = 1; else { const dG = Math.hypot(G0.x - v.x, G0.y - v.y); if (dG < 140 && dG > 10 && this.wall.raycast(v.x, v.y, G0.x, G0.y) >= 1 && road(G0.x, G0.y)) D.dir = 2; } } }
    const direct = D.dir > 0 && moving && !D.stop; if (direct) { if (D.dir === 1) { wx = pl.x; wy = pl.y; } else { wx = G0.x; wy = G0.y; } }
    if (ram) { wx = pl.x + plv.vx * 0.35; wy = pl.y + plv.vy * 0.35; }
    const dh = wrapPi(Math.atan2(wy - v.y, wx - v.x) - v.h), dScene = Math.hypot(G0.x - v.x, G0.y - v.y), last = D.i >= P.length - 1 && Math.hypot(tx - v.x, ty - v.y) < 9;
    /* speed: quick on the straight, down for the corner ahead, down to nothing behind whatever is in the way */
    let turn = Math.abs(dh); if (!direct && D.i + 2 < P.length) turn = Math.max(turn, Math.abs(wrapPi(Math.atan2(P[D.i + 2][1] - P[D.i + 1][1], P[D.i + 2][0] - P[D.i + 1][0]) - v.h)) * 0.8);
    let want = lerp(Math.max(this.level >= 3 ? 22 : 18, moving ? Math.min(31, plSp + 2.5) : 0), 6.5, clamp(turn / 0.7, 0, 1)), gap = 99; if (ram) want = Math.max(want, Math.min(24, plSp + 5)); const look = 7 + v.vf * 1.3;
    const test = (ox, oy, rad) => { const dx = ox - v.x, dy = oy - v.y, f = dx * cs + dy * sn; if (f < 1 || f > look + rad) return; if (Math.abs(-dx * sn + dy * cs) > 1.3 + rad * 0.5) return; gap = Math.min(gap, f - v.def.len / 2 - rad); };
    if (D.ghost > 0) D.ghost -= dt; else for (const o of g.traffic.cars) { if (Math.abs(o.x - v.x) > 40 || Math.abs(o.y - v.y) > 40) continue; test(o.x, o.y, o.def.len * 0.42); }
    /* never through another patrol car or a standing car, seen or not; the player's car only when they mean to hit it */ for (const o of g.vehicles) if (o !== v && !(ram && o === plv)) test(o.x, o.y, o.def.len * 0.42); if (!pl.vehicle) test(pl.x, pl.y, 0.6);
    if (ram && dPl < (v.def.len + plv.def.len) * 0.5 + 0.2 && this.t - (D.hitT || -9) > 0.8) { D.hitT = this.t; v.vf *= 0.55; }
    if (gap < 99) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 7 * (gap - 1.5))));
    /* stuck behind something: pull out round it; if that fails too, push through */
    if (v.vf < 1.2 && gap < 5) { D.blockT += dt; if (D.blockT > 0.9 && !D.off) { D.off = v.sideSgn * 3.3; D.offT = 5; } if (D.blockT > 0.8 && (dPl > 95 || !this.los(pl.x, pl.y, v.x, v.y))) { D.ghost = 2.5; D.blockT = 0; } if (D.blockT > 3.2) { D.blockT = 0; /* through it only where he cannot see it happen; in his sight the crew gets out here and comes on foot */ if (dPl > 95 || !this.los(pl.x, pl.y, v.x, v.y)) D.ghost = 2.5; else if (dScene < 80 && !moving) D.stop = D.jam = true; else D.off = -(D.off || v.sideSgn * 3.3), D.offT = 4; } } else D.blockT = Math.max(0, D.blockT - dt * 0.5);
    if (D.off) { D.offT -= dt; if (D.offT <= 0) D.off = 0; }
    /* at the scene: brake, and swing the nose across the lane */
    const arrive = moving || (!v.goal && plv && plSp > 6 && this.unseenT < 20) ? false : (dScene < this.stopD && this.los(v.x, v.y, G0.x, G0.y)) || dScene < Math.min(16, this.stopD) || last
      /* a car coming up on one that has already stopped at the scene stops a length short of it, beside it, not behind or in it */
      || (dScene < this.stopD + 14 && this.cars.some((o) => o !== v && !o.drive && o.out && !o.wreck && Math.hypot(o.x - v.x, o.y - v.y) < 10.5 && (o.x - v.x) * cs + (o.y - v.y) * sn > 0));
    if (arrive && !D.stop) { D.stop = true; this.stats.arrive.push(+(this.t - D.t0).toFixed(1)); this.say((v.heavy ? 'heavy unit ' : 'car ') + v.id + ' on scene after ' + (this.t - D.t0).toFixed(1) + ' s (' + Math.round(D.d0) + ' m out)'); }
    if (D.stop) want = 0;
    const acc = clamp(want - v.vf, -(D.stop ? 13 : 9) * dt, 4.2 * dt); v.vf = Math.max(0, v.vf + acc); v.braking = acc < -0.05 || v.vf < 0.3;
    const maxYaw = Math.min(v.vf / 4.6, 7.5 / Math.max(v.vf, 1)); let yaw = clamp(dh * 3.2, -maxYaw, maxYaw); if (D.stop && v.vf > 0.6) yaw = v.sideSgn * Math.min(1.7, 0.5 + v.vf / 3.5) * this.swingK; /* the nose swings across the lane as it brakes */
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
    if (v.away) { if (D.stop && v.vf < 0.25) { v.vf = 0; v.vx = v.vy = 0; v.drive = null; } return; }
    if (D.stop && v.vf < 0.25) { v.vf = 0; v.vx = v.vy = 0; v.drive = null; v.parkedT = this.t; this.dismount(v); }
    else if (this.t - D.t0 > (moving || D.rN ? 160 : 75)) { v.drive = null; v.vf = 0; v.vx = v.vy = 0; this.dismount(v); }
  }
  dismount(v) {
    const g = this.g, cs = Math.cos(v.h), sn = Math.sin(v.h), w = Math.min(v.def.wid, 2.0) / 2, n = v.heavy ? 3 : 2; v.doorT = 0; v.out = true;
    /* in front of a gun the man on the gun's side does not get out on that side: he comes across the seat and out after his partner, further back along the car, so both are behind it from the first frame (rounds 10-14: 'kneels on the player's side of the car, fully exposed') */
    const pl0 = g.player, hot0 = this.level >= 2 && this.c.slot !== 'unarmed', pdx = pl0.x - v.x, pdy = pl0.y - v.y, pd = Math.hypot(pdx, pdy) || 1, pside = (-sn * pdx + cs * pdy) / pd;
    for (let i = 0; i < n; i++) { const side0 = i % 2 ? -1 : 1, over = hot0 && !g.P.has('heatnear') && side0 * pside > 0.3, side = over ? -side0 : side0, f = over ? (i < 2 ? -0.8 : -1.7) : i < 2 ? 0.1 /* was 0.55: 17 cm behind the open door, and a kneeling man's thighs came through the panel (rounds 25, 26) */ : -0.75, x = v.x + cs * f - sn * side * (w + 0.62), y = v.y + sn * f + cs * side * (w + 0.62);
      const kind = v.heavy ? (i === 1 ? 'shotgun' : 'rifle') : this.level >= 3 && i === 1 ? 'shotgun' : 'pistol', k = this.addCop(x, y, kind, v, i); if (!k) continue;
      k.h = v.h; k.post = { x, y }; k.cover = { car: v, side, door: i < 2 && !v.heavy && !over };
      /* and behind it they go to its ends, where one fires over the bonnet or the boot with head, shoulders and gun showing: at the far door a man is a head over the roof ('officers are specks', rounds 15, 16) */
      if (hot0 && side * pside < -0.3 && i < 2) { const lx = (over ? -1 : 1) * (v.def.len / 2 - 0.5), ly = side * (w + 0.5); k.after = { x: v.x + lx * cs - ly * sn, y: v.y + lx * sn + ly * cs }; } k.mode = 'hold'; k.up = 1; v.crew.push(k);
      /* out of the seat with the kit's get-out motion: carried from the seat to the door as the body unfolds (the far side is the mirror of it) */
      let st = [0.1, 0.38, 0.3]; try { st = g.seatOf(v, k.who || 'player'); } catch (e) {} const dur = (k.vis && k.vis.acts && k.vis.acts.getout && k.vis.dur && k.vis.dur.getout) || 1.25, sf = st[0] + (i < 2 ? 0 : -0.95);
      k.get = { t: over ? -0.5 - 0.1 * i : -0.12 * i, dur, side, x0: v.x + cs * sf - sn * side * st[1], y0: v.y + sn * sf + cs * side * st[1], z0: (v.z || 0) + st[2], x1: x, y1: y, anim: !!(k.vis && k.vis.acts && k.vis.acts.getout) }; k.x = k.get.x0; k.y = k.get.y0; k.z = k.get.z0; }
    this.shout(this.pick(this.level >= 2 && this.c.slot !== 'unarmed' ? ['Gun! He has a gun! Cover!', 'Out of the car! Cover!', 'Shots fired! Get behind the doors!'] : ['POLICE! Do not move!', 'Out of the car! Cover!', 'Police! Get on the ground!']), 1);
  }
  stepCar(v, dt, i) {
    const g = this.g, pl = g.player; if (!g.vehicles.includes(v)) { if (v.wreck || v.left) { this.cars.splice(i, 1); this.undressCar(v); return; } g.vehicles.push(v); }
    if (v.out) v.doorK = Math.min(1, v.doorK + dt / 0.4);
    if (v.wreck) { v.drive = null; return; }
    if (v.away) { const d = Math.hypot(v.x - pl.x, v.y - pl.y); if (pl.vehicle === v) { v.away = false; v.goal = null; v.drive = null; v.stolen = true; return; } if (!v.drive || d > 170 || (d > 55 && !this.los(pl.x, pl.y, v.x, v.y)) || this.t - v.drive.t0 > 70) { v.left = true; v.drive = null; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); } return; }
    if (pl.vehicle === v) { v.stolen = true; v.drive = null; return; }
    /* left far behind by a driver: the car and its crew are gone from the street (new ones come from ahead of him) */
    if (this.level > 0 && v.drive && !v.goal && !v.away && !v.stolen && pl.vehicle && Math.hypot(pl.vehicle.vx, pl.vehicle.vy) > 6 && this.t - v.drive.t0 > 4 && Math.hypot(v.x - pl.x, v.y - pl.y) > 170 && !this.los(pl.x, pl.y, v.x, v.y)) { v.left = true; v.drive = null; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); this.say('unit ' + v.id + ' outrun'); return; }
    if (this.level > 0 && !v.drive && !v.stolen) { const d = Math.hypot(v.x - pl.x, v.y - pl.y); if (d > 260 || (d > (pl.vehicle ? 110 : 150) && Math.hypot(v.x - this.lkp.x, v.y - this.lkp.y) > (pl.vehicle ? 90 : 150) && !this.los(pl.x, pl.y, v.x, v.y))) { for (const k of v.crew) if (k.hp > 0) { k.hp = 0; k.gone = true; this.release(k); } this.cops = this.cops.filter((k) => !k.gone); v.left = true; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); this.say('unit ' + v.id + ' left behind'); return; } }
    if (this.level === 0 && !v.drive) { v.leaveT = (v.leaveT || 0) + dt; const crew = v.crew.filter((k) => k.hp > 0), d = Math.hypot(v.x - pl.x, v.y - pl.y);
      /* the crew is back (or gone): shut the doors, and when nobody is looking the car is gone */
      if (!crew.length || v.leaveT > 25) { v.doorK = Math.max(0, v.doorK - dt / 0.3); v.out = false;
        if (v.doorK <= 0 && !v.away && !v.stolen && !v.triedAway && v.leaveT > 2.5) { v.triedAway = true; const B = g.bounds, far = { x: clamp(v.x + Math.cos(v.h) * 240, -B.x + 30, B.x - 30), y: clamp(v.y + Math.sin(v.h) * 240, -B.y + 30, B.y - 30), h: 0 }, lk = this.lkp; v.drive = { pts: [[v.x, v.y], [v.x + Math.cos(v.h) * 5, v.y + Math.sin(v.h) * 5]], i: 1, blockT: 0, off: 0, ghost: 0, t0: this.t, d0: 0 }; this.lkp = far; let ok = false; try { ok = this.reroute(v); } catch (e) {} this.lkp = lk; if (ok) { v.away = true; v.goal = far; v.vf = 0; this.say('unit ' + v.id + ' drives off'); return; } v.drive = null; }
 if ((d > 70 && !this.los(pl.x, pl.y, v.x, v.y)) || d > 160 || v.leaveT > 90) { v.left = true; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); } } }
  }

  // ------------------------------------------------------------------ officers
  addCop(x, y, kind, car, i) {
    const g = this.g, k = { x, y, h: 0, z: 0, hp: 100, state: 'walk', kind: 'cop', gunK: kind, G: GUN[kind], W: WEAPONS[kind], car, post: null, mode: 'move', up: 1, aim: 0, fireCd: this.rr(0.4, 1.0), burst: 0, mag: g.P.has('heatmag') ? Math.max(1, +g.P.get('heatmag') | 0) /* a capture in which a magazine runs dry */ : GUN[kind].mag, relT: 0, speed: 0, see: false, dist: 99, onT: 0, supp: 0, thinkT: this.rr(0.2, 0.8), scale: 1, tall: 1.06, id: i, t: 0, fall: 0, vx: 0, vy: 0, phase: 0, back: 0, rise: 0, heavy: !!(car && car.heavy) || kind === 'rifle', bornT: this.t, flankT: this.rr(3, 8), n: this.cops.length };
    g.statics.resolve(x, y, 0.34, _o); k.x = _o.x; k.y = _o.y; k.h = Math.atan2(this.lkp.y - y, this.lkp.x - x);
    /* each his own man: a way of fighting nobody else alive has, cap or bare head, height, build, hair */
    { const used = this.cops.filter((q) => q.hp > 0).map((q) => q.sty), P = g.P; let s = (this.cops.length + (this.units || 0)) % 4; for (let j = 0; j < 4 && used.includes(s); j++) s = (s + 1) % 4; k.sty = P.has('heatsty') ? +P.get('heatsty') % 4 : s; k.capOn = k.n % 3 !== 1; k.tall = 1.04 + 0.022 * ((k.n * 7 + (this.units || 0)) % 4); /* kit people 4-10 % over their own height: at 1.0 one read as 'child-sized with an oversized head' (rounds 25, 26) */ k.wide = 0.95 + 0.045 * ((k.n * 5 + 1) % 4); k.hair = (k.n * 3 + (this.units || 0)) % 4; }
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
    if (Math.hypot(pl.x - k.x, pl.y - k.y) > 140 && Math.hypot(this.lkp.x - k.x, this.lkp.y - k.y) > 140) { k.mode = 'leave'; return; }
    const tx = this.seen ? pl.x : this.lkp.x, ty = this.seen ? pl.y : this.lkp.y, d = Math.hypot(tx - k.x, ty - k.y), ang = Math.atan2(k.y - ty, k.x - tx);
    if (!this.seen && this.unseenT > 3) {
      /* searching: to where he was last seen, then on in the way he was heading and round about */
      if (k.mode !== 'search' || Math.hypot(k.post.x - k.x, k.post.y - k.y) < 2.5) { const a = this.lkp.h + this.rr(-1.3, 1.3), r = k.mode === 'search' ? this.rr(8, AREA[L] * 0.5) : this.rr(0, 5) + k.n * 2; k.post = { x: this.lkp.x + Math.cos(a) * r, y: this.lkp.y + Math.sin(a) * r }; k.cover = null; k.mode = 'search'; k.path = null; }
      return; }
    if (k.mode === 'move' && k.cover && k.post && this.unseenT < 6 && Math.hypot(k.post.x - k.x, k.post.y - k.y) > 1.2) return;
    if (!k.see && d > 12) { if (k.mode !== 'move' || !k.post || Math.hypot(k.post.x - tx, k.post.y - ty) > 14) { k.post = { x: tx + Math.cos(ang + this.rr(-0.5, 0.5)) * 8, y: ty + Math.sin(ang + this.rr(-0.5, 0.5)) * 8 }; k.cover = null; k.mode = 'move'; k.path = null; } return; }
    /* one step of heat and no challenge made yet: close in to shouting distance first, at a run, whatever he holds (they used to stop behind the first car, as far off as 44 m, and wait there for good) */
    if (L === 1 && !this.chal && k.see && d > 21) { if (k.mode !== 'move' || k.cover || !k.post || Math.hypot(k.post.x - tx, k.post.y - ty) > 20) this.go(k, null, tx + Math.cos(ang) * (15 + 3 * (k.n % 2)), ty + Math.sin(ang) * (15 + 3 * (k.n % 2))); return; }
    /* in the fight: from cover whenever there is some; close up by bounds from one car to the next; one of a pair works round the side */
    const hot = this.hot(), far = d > G.band[1] + (L === 1 ? -4 : 0), near = d < 5, mate = this.cops.find((q) => q !== k && q.hp > 0 && q.car === k.car && q.mode === 'move'), at = k.post ? Math.hypot(k.post.x - k.x, k.post.y - k.y) : 0;
    if (k.mode === 'move' && k.post && at < 1.2) k.mode = 'hold';
    if (k.mode === 'hold' && k.see) { k.flankT -= k.thinkT; }
    if (hot && k.see && !(k.mode === 'move' && k.cover && this.covered(k))) {
      /* nothing between him and the gun: the nearest thing that will stop a bullet, now */
      if (!k.cover || !this.covered(k)) { let cv = this.coverNear(k.x, k.y, k.cover ? 10 : 18, k); /* at one step: no cover that takes him out of shouting distance again */ if (cv && L === 1 && Math.hypot(cv.x - tx, cv.y - ty) > Math.max(d + 3, 24)) cv = null; if (cv) { const dc = Math.hypot(cv.x - k.x, cv.y - k.y); /* a long way to it and a mate already running: kneel and cover him, then go */ if (dc > 5 && this.cops.some((q) => q !== k && q.hp > 0 && q.mode === 'move' && q.see && Math.hypot(q.x - k.x, q.y - k.y) < 30)) { k.over = true; return; } k.over = false; if (dc > 0.7) { this.go(k, cv); if (this.rnd() < 0.3) this.shout(this.pick(['Cover! Get to cover!', 'Get behind the car!', 'Take cover!']), 0); return; } k.cover = cv.cover; k.post = { x: cv.x, y: cv.y }; } else if (k.cover && !k.cover.door) k.cover = null; }
    }
    if (k.mode === 'move' && at >= 1.2 && k.see && (k.cover || !hot || at < 12)) return;
    /* nothing to shoot at from here (his own cover hides him): another car with a line to him, or failing that a place in the open, low */
    if (hot && k.mode === 'hold' && (k.blockN || 0) >= 2 && this.t - (k.blockedT || -9) < 2) { k.blockN = 0; const cv = this.coverNear(k.x, k.y, 24, k, true); if (cv) { this.go(k, cv); this.shout(this.pick(['No shot! Moving!', 'I have no angle, shifting!']), 0); return; }
      let best = null, bd = 1e9; for (let i = 0; i < 10; i++) { const a2 = ang + (i % 2 ? 1 : -1) * (0.35 + 0.3 * (i >> 1)), r = clamp(d, G.band[0] + 2, G.band[1]), px = tx + Math.cos(a2) * r, py = ty + Math.sin(a2) * r, dd = Math.hypot(px - k.x, py - k.y); if (dd < bd && this.wall.raycast(k.x, k.y, px, py) >= 1 && !(g.statics.resolve(px, py, 0.4, _o) > 0) && this.clearFrom(px, py)) { bd = dd; best = [px, py]; } }
      if (best) { this.go(k, null, best[0], best[1]); this.shout(this.pick(['Going round the side!', 'I will take the far side!']), 0); return; } }
    if ((far && !mate) || k.mode === 'search' || (k.mode === 'move' && !k.cover && hot)) { const step = Math.min(d - G.band[0], this.rr(7, 11)), px = k.x - Math.cos(ang) * step, py = k.y - Math.sin(ang) * step; let cv = this.coverNear(px, py, 8, k); if (cv && Math.hypot(cv.x - tx, cv.y - ty) > d - 2) cv = null; if (!cv && this.t < (k.holdT || 0)) return;
      /* no car to run to: stay down and shoot from here unless he is out of reach, and then only one of them moves at a time */
      if (cv || !hot || (!k.cover && d > G.band[1] + 7 && !this.cops.some((q) => q !== k && q.hp > 0 && q.mode === 'move' && q.see))) { this.go(k, cv, px, py); if (this.rnd() < 0.5) this.shout(this.pick(['Moving up!', 'Cover me, I am moving!', 'Push up! Push up!']), 0); } else { k.flankT -= 1.5; if (k.mode !== 'hold') { k.mode = 'hold'; k.post = { x: k.x, y: k.y }; } }
      return; }
    if (k.flankT <= 0 && L >= 2 && !near && k.mode === 'hold') { k.flankT = this.rr(9, 15); const side = k.n % 2 ? 1 : -1, a2 = ang + side * this.rr(0.9, 1.3), r = clamp(d * 0.85, G.band[0], G.band[1]), px = tx + Math.cos(a2) * r, py = ty + Math.sin(a2) * r;
      if (this.wall.raycast(k.x, k.y, px, py) >= 1) { const cv = this.coverNear(px, py, 9, k); if (cv || !k.cover) { this.go(k, cv, px, py); this.shout(this.pick(['Going round the side!', 'Flanking left, keep him busy!', 'I will take the far side!']), 0); } } return; }
  }
  canFire(k) {
    const c = this.c, L = this.level, pl = this.g.player; if (L < 1) return false;
    /* at the first two steps nobody fires on a man who has done no violence lately and is in a car or has empty hands: they want him out of the car, or in cuffs */ if (L <= 2 && (pl.vehicle || c.slot === 'unarmed') && this.t - (this.violT ?? -99) > (pl.vehicle ? 25 : 5)) return false;
    if (L >= 2) return true;
    /* one step of heat: a challenge first. Fire only on someone armed who has had his warning, or who has just fired */
    if (this.t - (this.firedSeenT ?? -99) < 8) return true;
    return !!this.chal && this.t - this.chal.t0 > 4.2 && c.slot !== 'unarmed';
  }
  stepCop(k, dt) {
    const g = this.g, pl = g.player, c = this.c, G = k.G; k.t += dt; k.supp = Math.max(0, k.supp - dt);
    if (k.stag) { const sg = k.stag; sg.t += dt; if (sg.t < 0.3 && !k.get) { const sv = 1.5 * (1 - sg.t / 0.3); g.statics.resolve(k.x + sg.dx * sv * dt, k.y + sg.dy * sv * dt, 0.32, _o); k.x = _o.x; k.y = _o.y; } if (sg.t < 0.7) k.aim = Math.min(k.aim, 0.12); if (sg.t > sg.dur) k.stag = null; }
    if (k.get) { const q = k.get; q.t += dt; const m = sm((q.t / q.dur - 0.1) / 0.6); k.x = lerp(q.x0, q.x1, m); k.y = lerp(q.y0, q.y1, m); k.z = lerp(q.z0, g.statics.onSidewalk(q.x1, q.y1) ? 0.15 : 0, m); k.h = q.h ?? (q.h = k.car ? k.car.h : k.h); k.speed = 0; k.aim = 0; k.up = 1; /* in front of a gun nobody finishes the clip's standing up straight: out at three quarters of it, already going low, gun coming up (rounds 7 and 8: 'bolt upright, arms at sides, while being shot') */ const hotOut = this.level >= 2 && this.c.slot !== 'unarmed'; if (q.t >= q.dur * (hotOut ? 0.72 : 1)) { k.get = null; k.outT = this.t; if (k.after) { if (hotOut && k.car && !k.car.wreck) { k.post = k.after; k.cover = { car: k.car, any: true }; k.mode = 'move'; k.path = null; } k.after = null; } k.fireCd = hotOut ? this.rr(0.12, 0.4) : this.rr(0.25, 0.7); k.thinkT = 0.03 + 0.15 * (k.id || 0); if (hotOut) { k.up = 0.7; k.aim = 0.45; } } return; }
    k.thinkT -= dt; if (k.thinkT <= 0) this.think(k);
    /* shot at in the open: a quick step to the side (toward cover if there is some) and keep firing */
    if (k.supp > 0.5 && !k.cover && k.mode === 'hold' && k.see && this.t - (k.dodgeT || -9) > 1.6) { k.dodgeT = this.t; const a = Math.atan2(pl.y - k.y, pl.x - k.x) + (this.rnd() < 0.5 ? 1 : -1) * Math.PI / 2, r = this.rr(2.2, 3.6), px = k.x + Math.cos(a) * r, py = k.y + Math.sin(a) * r, cv = this.coverNear(k.x, k.y, 14, k);
      /* a car within reach: behind it. Nothing: stay down and shoot back (a side step in the open only gets him shot while not shooting) */
      if (cv) this.go(k, cv, px, py); }
    /* the challenge, and the arrest of someone unarmed who stands still for it */
    if (this.level <= 2 && this.level > 0 && k.see && (k.dist < 26 || k.onT > 4) && !this.chal) { this.chal = { t0: this.t }; this.shout(c.slot !== 'unarmed' ? 'POLICE! Drop the weapon! Drop it NOW!' : 'POLICE! Stay where you are! Hands!', 2); }
    if (this.level <= 2 && this.level > 0 && this.chal && !this.dead && (pl.vehicle ? this.t - (this.violT ?? -99) > 25 : c.slot === 'unarmed') && k.see && this.t - this.lastShotT > 5) { if (pl.vehicle ? k.dist < 3.6 && Math.hypot(pl.vehicle.vx, pl.vehicle.vy) < 1 : k.dist < 2.6 && Math.min(pl.speed, this.realSp ?? 9) < 0.6) { this.arrest(); return; } if (k.dist > 2 && (k.mode === 'hold' || !k.post || Math.hypot(k.post.x - pl.x, k.post.y - pl.y) > 1.5)) { k.post = { x: pl.x, y: pl.y }; k.cover = null; k.mode = 'move'; k.path = null; } }
    if (k.mode === 'move' && !k.cover && k.see && k.dist < 48 && this.t - this.lastShotT < 1.2 && this.t > (k.holdT || 0) + 3 && this.hot() && this.canFire(k)
      /* not a man just out of a car that he can be behind in two seconds: he keeps going round it (rounds 10-12: 'kneels in the open in front of his own car, on the player's side') */
      && !(k.car && !k.car.wreck && this.t - (k.outT ?? -99) < 5 && Math.hypot(k.x - k.car.x, k.y - k.car.y) < 5.5)) { k.mode = 'hold'; k.post = { x: k.x, y: k.y }; k.holdT = this.t + this.rr(1.8, 2.8); k.fireCd = Math.min(k.fireCd, this.rr(0.2, 0.4)); k.aim = Math.max(k.aim, 0.5); }
    let sp = 0;
    if (k.mode === 'leave') { const car = k.car && !k.car.wreck && !k.car.stolen && !k.car.away ? k.car : null, tx = car ? car.x : k.x + Math.cos(k.h) * 30, ty = car ? car.y : k.y + Math.sin(k.h) * 30; if (!k.post || !k.leaving) { k.leaving = true; k.post = car ? { x: k.x + (car.x - k.x) * 0.75, y: k.y + (car.y - k.y) * 0.75 } : { x: tx, y: ty }; if (!car) k.h += Math.PI; }
      const d = Math.hypot(pl.x - k.x, pl.y - k.y); if ((car && Math.hypot(car.x - k.x, car.y - k.y) < 2.4) || (!car && ((d > 45 && !this.los(pl.x, pl.y, k.x, k.y)) || d > 110 || this.t - k.bornT > 400))) { k.hp = 0; k.gone = true; const i = this.cops.indexOf(k); if (i >= 0) this.cops.splice(i, 1); this.release(k); return; }
      sp = this.walkTo(k, car ? car.x : k.post.x, car ? car.y : k.post.y, 1.5, dt, 1.2); k.aim = Math.max(0, k.aim - dt * 3); k.up = Math.min(1, k.up + dt * 3); k.speed = sp; return; }
    if (this.dead && !this.dead.arrest && !this.dead.woke && k.see && !k.closing) { k.closing = true; const d = k.dist || 9, r = Math.max(0, d - 3.2 - (k.n % 3) * 0.9); k.post = { x: k.x + (pl.x - k.x) / (d || 1) * r, y: k.y + (pl.y - k.y) / (d || 1) * r }; k.cover = null; k.mode = 'move'; k.path = null; if (k.n % 2 === 0) this.shout(this.pick(['Suspect down. Moving up on him.', 'He is down! Cover me.', 'Hold fire! Hold fire! He is down.']), 2); }
    const fire = k.see && this.canFire(k) && !this.dead, at = k.post ? Math.hypot(k.post.x - k.x, k.post.y - k.y) : 0;
    /* a man just hit does not walk on in the same breath: he takes it where he stands (he was seen gliding to the car on his knee, rounds 21, 24) */
    const stg = !!k.stag && k.stag.t < k.stag.dur - 0.4;
    if (stg) { /* stands or kneels where he is */ } else if ((k.mode === 'move' || k.mode === 'search') && k.post && at > 0.6) { const arr = (this.level <= 2 && this.chal && (c.slot === 'unarmed' || (pl.vehicle && this.t - (this.violT ?? -99) > 25))) || (k.closing && !!this.dead), /* a man who got out on the gun's side goes round his car facing the gun, weapon up, at a quick sidestep: he was seen sprinting for it with his back to the shooter (rounds 21-24: 'kneels in open road with his back to the armed player') */ fromCar = k.see && this.hot() && k.car && !k.car.wreck && this.t - (k.outT ?? -99) < 6 && Math.hypot(k.x - k.car.x, k.y - k.car.y) < 6, run = arr ? (at > 6 ? 4.2 : 2) : fromCar ? 1.85 : k.mode === 'search' ? (at > 14 && this.t - this.lastCrimeT < 40 ? 4.4 : 2.7) : k.dodge ? 2.9 : at > 3.5 || !k.see ? 4.4 : 2.7, x0 = k.x, y0 = k.y; sp = this.walkTo(k, k.post.x, k.post.y, this.level === 1 && run > 3 ? run * 0.86 : run, dt, 0.5); /* the speed the legs show is the ground really covered */ sp = Math.min(sp, Math.hypot(k.x - x0, k.y - y0) / dt + 0.4); }
    else if (k.mode === 'move') { k.mode = 'hold'; k.dodge = false; }
    /* face: where one is going, or the target once it matters */
    const facing = sp > 1.9 ? null : this.seen || this.unseenT < 6 ? Math.atan2((this.seen ? pl.y : this.lkp.y) - k.y, (this.seen ? pl.x : this.lkp.x) - k.x) : null;
    if (facing !== null) k.h += clamp(wrapPi(facing - k.h), -dt * 7, dt * 7);
    k.aim = clamp(k.aim + ((fire || (k.see && this.level >= 1)) && sp < 1.9 && k.relT <= 0 ? dt / 0.3 : -dt / 0.35), 0, 1);
    /* behind cover one stays low between bursts, under fire, and while the magazine is changed */
    const hotN = this.hot(), mvLow = sp > 0.5 && (k.see || this.seen) && hotN, inCov = k.cover && k.mode === 'hold', low = (inCov || (hotN && k.mode === 'hold')) && (k.burst <= 0 && k.fireCd > 0.35 || k.supp > 0 || k.relT > 0 || !k.see);
    /* how upright: behind a car one fires over the bonnet or boot, half up; in the open one kneels between bursts; on the move in his sights one runs bent low */
    /* at an open door he STANDS, braced behind its frame, and only dips between bursts: a kneel is for the bonnet or the boot (rounds 27, 28: the man low in his own doorway 'sits slumped in the door sill like a dropped prop') */
    const S = STY[k.sty || 0], nd = (k._nd = !g.P.has('heatdoorlow') && this.nearDoor(k)), top = nd ? 0.97 : inCov && k.cover.any ? S.topC : inCov && k.cover.door ? S.topD : hotN && k.mode === 'hold' && !inCov && !k.cover ? S.topO : 1; let tgt = nd ? (mvLow ? 0.82 : low ? 0.76 + 0.05 * (k.n % 3) : top) : mvLow ? 0.5 : low ? (!inCov ? S.lowO : k.cover.door ? S.lowD : S.lowC) : top;
    /* hit and still alive: bent over it, or down on a knee (a leg hit, or badly hurt), for most of a second before he is back on the gun */
    if (k.stag && k.stag.t < k.stag.dur - 0.3) tgt = Math.min(tgt, k.stag.knee && !nd ? 0.3 : nd ? 0.7 : 0.62);
    k.up += clamp(tgt - k.up, -dt * 4.5, dt * 3.2);
    if (k.relT > 0) { k.relT -= dt; if (k.relT <= 0) k.mag = G.mag; }
    k.fireCd -= dt; k.back *= Math.exp(-dt * 9); k.rise *= Math.exp(-dt * 7);
    if (fire && k.relT <= 0 && k.fireCd <= 0 && k.aim > 0.9 && k.up > top - 0.12 && sp < 1.9) {
      if (k.mag <= 0) { k.relT = 2.1; k.burst = 0; (this.marks ||= []).push([this._drawN || 0, 'reload', k.n, 0]); if (this.rnd() < 0.5) this.shout(this.pick(['Reloading!', 'Changing mag, cover me!']), 0); }
      else { if (k.burst <= 0) k.burst = Math.round(this.rr(G.burst[0], G.burst[1] + 0.49)); if (this.copShoot(k) === false) return; k.burst--; k.mag--; k.fireCd = k.burst > 0 ? this.rr(G.gap[0], G.gap[1]) : this.rr(G.rest[0], G.rest[1]) * (this.level >= 4 ? 0.75 : 1); }
    }
    k.speed = sp;
    /* the numbers: seconds in his sights behind something, in the open low, in the open upright and moving */
    if (k.see && this.hot()) { const S = this.stats; if (S.contactT === null) S.contactT = +this.t.toFixed(1); if (k.cover && this.covered(k) && sp < 0.5) S.tCov += dt; else if (sp > 0.5) { if (k.up > 0.66) S.tOpenUp += dt; else S.tOpenLow += dt; } else S.tStill += dt; }
    /* nobody stands in an open door: he is kept half a metre off its panel and its free edge, on the side he is on ('door clips through the officer', rounds 25, 26) */
    if (!k.get) for (const v2 of this.cars) { if (v2.wreck || (v2.doorK || 0) < 0.3 || Math.abs(v2.x - k.x) > 5 || Math.abs(v2.y - k.y) > 5) continue; for (const side of [1, -1]) { const s = this.doorSeg(v2, side), sx = s[2] - s[0], sy = s[3] - s[1], u = clamp(((k.x - s[0]) * sx + (k.y - s[1]) * sy) / (sx * sx + sy * sy || 1), 0, 1), px = s[0] + sx * u, py = s[1] + sy * u, ex = k.x - px, ey = k.y - py, d = Math.hypot(ex, ey), R0 = 0.5; if (d >= R0) continue; if (d > 0.02) { k.x = px + (ex / d) * R0; k.y = py + (ey / d) * R0; } else { const l = Math.hypot(sx, sy) || 1; k.x = px - (sy / l) * R0; k.y = py + (sx / l) * R0; } } }
    /* run down by the player's car */
    const v = pl.vehicle; if (v) { const vs = Math.hypot(v.vx, v.vy); if (vs > 4) { const dx = k.x - v.x, dy = k.y - v.y, cs = Math.cos(v.h), sn = Math.sin(v.h); if (Math.abs(dx * cs + dy * sn) < v.def.len / 2 + 0.3 && Math.abs(-dx * sn + dy * cs) < v.def.wid / 2 + 0.25) this.downCop(k, { x: k.x, y: k.y, z: 0.7, dx: v.vx / vs, dy: v.vy / vs, dz: 0.3, part: 'legs' }, 3); } }
  }
  // walk or run toward a point: round the corner by the streets when a wall is in the way; out of cars; not through each other
  walkTo(k, tx, ty, sp, dt, stop) {
    const g = this.g, st = g.statics; let gx = tx, gy = ty;
    if (this.wall.raycast(k.x, k.y, tx, ty) < 1) { k.pathT = (k.pathT || 0) - dt; if (!k.path || k.pathT <= 0) { k.pathT = 2.5; k.path = this.pathNodes(k.x, k.y, tx, ty); }
      const P = k.path; if (P && P.length) { while (P.length > 1 && (Math.hypot(P[0][0] - k.x, P[0][1] - k.y) < 5 || this.wall.raycast(k.x, k.y, P[1][0], P[1][1]) >= 1)) P.shift(); gx = P[0][0]; gy = P[0][1]; } } else k.path = null;
    /* a car in the way (his own patrol car, a parked one): round the nearer end of it, not into its side */
    { const D0 = Math.hypot(gx - k.x, gy - k.y); if (D0 > 1.2) { let blk = null; const tryV = (v) => { if (blk || Math.abs(v.x - k.x) > 9 || Math.abs(v.y - k.y) > 9 || (v.drive && v.vf > 1)) return; if (this.segBox(v, k.x, k.y, gx, gy, 0.22)) blk = v; };
        for (const v of g.vehicles) tryV(v); if (!blk) for (const v of g.parked.near(k.x, k.y, 7, (this._pk4 ||= []))) tryV(v);
        if (blk) { const cs = Math.cos(blk.h), sn = Math.sin(blk.h), hl = blk.def.len / 2 + 0.62, hw = Math.min(blk.def.wid, 2.1) / 2 + 0.62; let bc = null, bd = 1e9;
          for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) { const cx = blk.x + lx * cs - ly * sn, cy = blk.y + lx * sn + ly * cs, d1 = Math.hypot(cx - k.x, cy - k.y); if (d1 < 0.35) continue; if (this.segBox(blk, k.x, k.y, cx, cy, 0.2)) continue; if (st.resolve(cx, cy, 0.3, _o) > 0.3) continue; const dd = d1 + Math.hypot(gx - cx, gy - cy) + (this.segBox(blk, cx, cy, gx, gy, 0.2) ? 3 : 0); if (dd < bd) { bd = dd; bc = [cx, cy]; } }
          if (bc) { gx = bc[0]; gy = bc[1]; } } } }
    /* a low fence or a tree guard in the way (it stops feet, not eyes): round the end of it */
    if (this.t < (k.skT || 0)) { gx = k.x + Math.cos(k.skA) * 2; gy = k.y + Math.sin(k.skA) * 2; }
    else if (this.t - (k.skL || 0) > 0.14) { k.skL = this.t; const dx0 = gx - k.x, dy0 = gy - k.y, d0 = Math.hypot(dx0, dy0); if (d0 > 0.8) { const lk = Math.min(d0, 2.2), a0 = Math.atan2(dy0, dx0); if (st.raycast(k.x, k.y, k.x + Math.cos(a0) * lk, k.y + Math.sin(a0) * lk) < 1) for (const da of [0.7, -0.7, 1.25, -1.25, 1.8, -1.8]) { const a = a0 + da * (k.n % 2 ? 1 : -1); if (st.raycast(k.x, k.y, k.x + Math.cos(a) * 2.4, k.y + Math.sin(a) * 2.4) >= 1) { k.skA = a; k.skT = this.t + 0.7; gx = k.x + Math.cos(a) * 2; gy = k.y + Math.sin(a) * 2; break; } } } }
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
    for (let i = 0; i < n; i++) { const p = N[i].p, d0 = Math.hypot(p[0] - x0, p[1] - y0), d1 = Math.hypot(p[0] - x1, p[1] - y1); if (d0 < 130 && this.wall.raycast(x0, y0, p[0], p[1]) >= 1) { dist[i] = d0; any = true; } if (d1 < 130 && this.wall.raycast(x1, y1, p[0], p[1]) >= 1) { goal[i] = d1; anyG = true; } }
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
    const sig = G.sig * WIDE[this.level] * Math.pow(clamp(15 / Math.max(L, 3), 0.45, 1.5), 0.6) * (1.18 - 0.07 * this.level) * (1 + 1.9 * Math.exp(-k.onT / 1.7)) /* the first rounds go wide for longer (was 1 + 1.0 over 0.9 s): at 7-10 m a crew just out of its car put him down in two and a half seconds, before a fight could be had (captures h21b, h23k) */ * (pl.speed > 3 || (inCar && Math.abs(pl.vehicle.vf) > 6) ? 1.7 : pl.speed > 1 ? 1.25 : 1) * (k.supp > 0 ? 1.6 : 1) * D2R;
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
    this._copShot = true; try { c.fx.muzzle(mz, _v3.set(ex / L, ez / L, -ey / L), k.gunK, cam.position);
      /* seen from the front and from 10-20 m the guns' three-frame flash is a dot that most stills miss ('police fire is close to invisible', rounds 17-20): a short bright bloom at the bore that lasts five frames (?heatflash=0 off) */
      if (c.fx.spawn && g.P.get('heatflash') !== '0') { const fs = k.gunK === 'pistol' ? 1 : 1.5; c.fx.spawn({ x: mz.x + ex / L * 0.08, y: mz.y + ez / L * 0.08, z: mz.z - ey / L * 0.08, life: 0.085, s0: 0.34 * fs, s1: 0.16 * fs, r: 1, g: 0.78, b: 0.36, a: 0.95, add: true, fade: 1 }); c.fx.spawn({ x: mz.x, y: mz.y, z: mz.z, life: 0.05, s0: 0.14 * fs, s1: 0.1 * fs, r: 1, g: 0.97, b: 0.85, a: 1, add: true }); } } catch (e2) {} this._copShot = false;
    c.snd('shot', k.gunK, { dist: Math.hypot(ex, ey), pan }); k.back = 1; k.rise = 1; (this.marks ||= []).push([this._drawN || 0, 'shot', k.n, hitP > 0 ? 1 : 0]); if (this.t - (this.scareT || -9) > 0.7) { this.scareT = this.t; try { c.scare(k.x, k.y, 45, 2); c.scare(pl.x, pl.y, 40, 2); } catch (e2) {} }
    if (hitP > 0) { this.stats.copHits++; this.src = { x: k.x, y: k.y }; c.hurt(W.dmg * G.dm * LETH[this.level] * hitP * (0.85 + 0.3 * this.rnd()) * (g.P.has('heatdm') ? +g.P.get('heatdm') || 1 : 1) /* ?heatdm=<x>: for a capture that must reach the player's death inside its eight seconds */); this.src = null; }
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
  /* is he at an open door of a patrol car (within 1.25 m of its panel)? */
  nearDoor(k) { for (const v of this.cars) { if (v.wreck || v.heavy || (v.doorK || 0) < 0.5 || Math.abs(v.x - k.x) > 4.5 || Math.abs(v.y - k.y) > 4.5) continue; for (const side of [1, -1]) { const s = this.doorSeg(v, side), sx = s[2] - s[0], sy = s[3] - s[1], u = clamp(((k.x - s[0]) * sx + (k.y - s[1]) * sy) / (sx * sx + sy * sy || 1), 0, 1); if (Math.hypot(k.x - s[0] - sx * u, k.y - s[1] - sy * u) < 1.25) return { v, side, s }; } } return null; }
  doorSeg(v, side) { const cs = Math.cos(v.h), sn = Math.sin(v.h), w = Math.min(v.def.wid, 2.0) / 2, hx = 1.02, a = 1.15 * v.doorK * side, x0 = v.x + cs * hx - sn * side * w, y0 = v.y + sn * hx + cs * side * w, dx = -Math.cos(a), dy = Math.sin(a) * 1; const lx = dx * 1.05, ly = dy * 1.05; return [x0, y0, x0 + lx * cs - ly * sn, y0 + lx * sn + ly * cs]; }
  nearMissCops() { const g = this.g, C = g.cam, pl = g.player, fx = Math.cos(C.yaw), fy = Math.sin(C.yaw); for (const k of this.cops) { if (k.hp <= 0) continue; const dx = k.x - pl.x, dy = k.y - pl.y, f = dx * fx + dy * fy; if (f > 0 && Math.abs(-dx * fy + dy * fx) < 1.6) k.supp = Math.max(k.supp, 0.9); } }
  hitCop(h, W, first) {
    const c = this.c, k = h.obj, pl = this.g.player, dmg = W.dmg * (h.part === 'head' ? 4 : h.part === 'legs' ? 0.7 : 1) * (h.part === 'body' ? (k.heavy ? 0.6 : 0.85) : 1); k.hp -= dmg; k.supp = 1.4; k.thinkT = Math.min(k.thinkT, 0.1);
    try { c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(h.nx * 0.6 + h.dx * 0.5, h.dz * 0.5, -(h.ny * 0.6 + h.dy * 0.5)), 'flesh', { power: h.part === 'head' ? 1.3 : 1 }); if (first) c.snd('impact', 'flesh', { dist: Math.hypot(h.x - pl.x, h.y - pl.y), pan: 0 }); } catch (e) {}
    c.stats.hits.cop = (c.stats.hits.cop || 0) + 1; this.lkp.x = pl.x; this.lkp.y = pl.y;
    if (k.hp <= 0) { (this.marks ||= []).push([this._drawN || 0, 'down', k.n, 0]); this.downCop(k, h, W.force || 1); c.kills++; return 'kill'; }
    this.lastCopHitT = this.t; this.crime('copHit', k.x, k.y); try { if (c.bodies && k.vis) c.bodies.wound(k, 'ped', h); } catch (e) {}
    /* hit and still standing: he is knocked back a step, the trunk thrown back and round, the gun off the line, and he does not fire for half a second (rounds 13, 14: 'no stagger', 'poses stiff and held') */
    { const l = Math.hypot(h.dx, h.dy) || 1; const old = k.stag, legs = h.part === 'legs', knee = (legs || k.hp < 45) && !(k.car && (k.car.doorK || 0) > 0.5 && Math.hypot(k.x - k.car.x, k.y - k.car.y) < 2.6) /* not down on a knee in his own doorway: 'sits slumped in the door sill like a dropped prop' (round 28) */; k.stag = { t: old && old.t > 0.12 && old.t < old.dur - 0.2 ? 0.12 : 0, dur: knee ? 1.5 : 1.2, knee, dx: h.dx / l, dy: h.dy / l, side: (h.dx / l) * -Math.sin(k.h) + (h.dy / l) * Math.cos(k.h) > 0 ? 1 : -1, head: h.part === 'head', legs, hz: clamp((h.z ?? 1.2) - (k.z || 0), 0.5, 1.45) }; k.fireCd = Math.max(k.fireCd || 0, knee ? 1.25 : 0.95); k.burst = 0; (this.marks ||= []).push([this._drawN || 0, 'stag' + (knee ? '-knee' : ''), k.n, Math.round(k.hp)]); } return 'ped';
  }
  downCop(k, h, force) {
    const g = this.g, c = this.c; if (k.hp <= -9000) return; k.hp = -9999; this.stats.copsDown++; this.addHeat('copKill', k.x, k.y); this.say('officer down (' + k.gunK + '), ' + this.cops.filter((q) => q.hp > 0).length + ' left, player hp ' + Math.round(c.health));
    this.shout(this.pick(['Officer down! Officer down!', 'Man down! We need backup now!', 'He hit ' + (k.n % 2 ? 'Reyes' : 'Kowalski') + '! Officer down!']), 2);
    /* an officer shot beside his car goes down along it or away from it, not in under the sill (round 8: 'dead officers clip under the car sill'): the part of the blow that points into the car's side is turned round */
    try { for (const v of this.cars) { const cs = Math.cos(v.h), sn = Math.sin(v.h), dx = k.x - v.x, dy = k.y - v.y, f = dx * cs + dy * sn, sd = -dx * sn + dy * cs, hw = Math.min(v.def.wid, 2.1) / 2; if (Math.abs(f) > v.def.len / 2 + 0.4 || Math.abs(sd) > hw + 1.3 || Math.abs(sd) < hw * 0.5) continue; const nx = -sn * Math.sign(sd), ny = cs * Math.sign(sd), into = -(h.dx * nx + h.dy * ny); if (into > 0) { h = Object.assign({}, h); h.dx += nx * into * 1.6; h.dy += ny * into * 1.6; const l = Math.hypot(h.dx, h.dy) || 1; h.dx /= l; h.dy /= l; } break; } } catch (e) {}
    /* and a man shot at an open door goes down away from its panel, not back in under its glass (round 27 capture: 'the dead man falls back in under the open door'): the part of the blow that points at the door is turned round and he is given a push clear of it */
    try { const nd = this.nearDoor(k); if (nd) { const s = nd.s, sx = s[2] - s[0], sy = s[3] - s[1], l = Math.hypot(sx, sy) || 1; let nx = -sy / l, ny = sx / l; if ((k.x - s[0]) * nx + (k.y - s[1]) * ny < 0) { nx = -nx; ny = -ny; } /* the way out of the wedge between door and car is back along the car and away from its side */ const v = nd.v, sd = nd.side, cs = Math.cos(v.h), sn = Math.sin(v.h); const fw = (k.x - v.x) * cs + (k.y - v.y) * sn < 0.9 ? -0.5 : 0.5 /* ahead of the door: forward and out */; h = Object.assign({}, h); h.dx = cs * fw - sn * sd * 0.86; h.dy = sn * fw + cs * sd * 0.86; force = Math.min(force, 1.0); } } catch (e) {}
    let ok = false; k.speed = k.speed || 0; if (k.vis) { /* he falls from the pose he is in (kneeling, bent over a wound, gun up), moving as he was: the skeleton used to be put back on its idle clip first and he 'snapped to a rigid upright pose ... tipped over like a board' (rounds 25, 26). The arms thrown out that the reset once cured came from the mixer writing only some of the bones between the two poses the doll measures its starting speeds from; so the mixer is kept off the skeleton for those two readings and the body's own speed is given by moving the whole figure between them. ?heatsnap = the old way */
      const mx = k.vis.mixer, keep = !!(c.bodies && k.rig && mx && !k.get && !g.P.has('heatsnap')), sp0 = k.speed; if (k.rig && !keep) { try { k.rig.stanceOff(); } catch (e) {} }
      try { if (c.bodies && !keep) { const ts = mx ? mx.timeScale : 1; this.cleanPose(k.vis, false); if (mx) mx.timeScale = ts; }
        if (keep) { const o = k.vis.object, D = 1 / 30, wx = clamp(k.wx || 0, -5, 5) * D, wy = clamp(k.wy || 0, -5, 5) * D; let n = 0; k.speed = 0; mx.update = function () { if (n++ === 0) { o.position.x -= wx; o.position.z += wy; } else if (n === 2) { o.position.x += wx; o.position.z -= wy; } return this; }; }
        try { ok = !!(c.bodies && c.bodies.kill(k, 'ped', h, Math.max(force, 1.3))); } finally { if (keep) { delete mx.update; k.speed = sp0; } } /* the fifth of a second in which a shot man's legs still carry him is run at once: he was seen standing dead, arms at his sides, for five frames after the round that killed him (capture h21b, frames 180-196) */ if (ok && !g.P.has('heatnopre')) { const dl = k.body && k.body.doll; if (dl && dl.step) for (let i = 0; i < 9; i++) dl.step(1 / 60); } } catch (e) { ok = false; } if (!ok) ok = this.viaPedhit(k, h, force); }
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
    const g = this.g, c = this.c, pl = g.player; this.stats.dmgIn += n; this.lastHurtT = this.t; this.hurtT = Math.min(1, this.hurtT + 0.45 + n / 60); this.flinch = Math.min(1.4, this.flinch + 0.6 + n / 40); this.vgT = 1; this.flinchZ = (this.rnd() < 0.5 ? -1 : 1) * 0.035;
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
    const g = this.g, pl = g.player; if (this.dead) return; if (pl.vehicle) { const v = pl.vehicle; pl.vehicle = null; pl.busy = null; g.cam.mode = 'foot'; pl.vis.object.visible = true; pl.x = v.x - Math.sin(v.h) * (v.def.wid / 2 + 0.7); pl.y = v.y + Math.cos(v.h) * (v.def.wid / 2 + 0.7); v.vx = v.vy = 0; } this.stats.arrests++; this.say('arrested'); this.shout('On the ground. You are done for today.', 2);
    this.dead = { t: 0.9, cam: false, x: pl.x, y: pl.y, yaw: g.cam.yaw, p: null, hips: null, level: this.level, arrest: true }; this.c.dead = true;
  }
  stepDead(dt) {
    const g = this.g, c = this.c, pl = g.player, D = this.dead; D.t += dt;
    if (D.p) { pl.x = D.p.x; pl.y = D.p.y; D.p.t = Math.min(D.p.t, 4); }
    this.fade = D.woke ? Math.max(0, this.fade - dt / 1.0) : clamp((D.t - 2.0) / 0.9, 0, 1);
    if (!D.woke && D.t > 3.1) {
      /* wake outside the nearest clinic (or leave the precinct); the bill is a tenth of the cash on hand; the guns stay, half of the spare rounds do not */
      D.woke = true; this.sub = null /* no bark from the fight he lost over the wake-up card */; if (D.p) { D.p.state = 'gone'; const i = g.peds.list.indexOf(D.p); if (i >= 0) g.peds.list.splice(i, 1); const vis = pl.vis; vis.object.visible = true; vis.used = true; if (D.hips) D.hips.b.position.copy(D.hips.p); if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.stopAllAction(); } vis.cur = null; D.p = null; }
      let best = null; for (const q of CLINICS) { const d = Math.hypot(q[1] - D.x, q[2] - D.y); if (!best || d < best.d) best = { q, d }; }
      const P = this.sidewalkNear(best.q[1], best.q[2]); pl.x = P.x; pl.y = P.y; pl.h = P.h; g.focus.x = pl.x; g.focus.y = pl.y; pl.speed = 0;
      /* THE HOOK: game.onBust({ kind: 'arrest' | 'down', level, place }) may take cash and return the amount it took (shown on the card). Nothing is taken here: no cash, no guns, no rounds. */
      let fee = 0; try { if (typeof g.onBust === 'function') fee = +g.onBust({ kind: D.arrest ? 'arrest' : 'down', level: D.level, place: best.q[0] }) || 0; } catch (e) { this.oops('bust', e); }
      if (c.slot !== 'unarmed') c.setSlot('unarmed'); c.health = 100; c.dead = false; this.clear(D.arrest ? 'arrested' : 'player down');
      for (const k of this.cops.slice()) { if (k.hp > 0) { k.hp = 0; k.gone = true; this.release(k); } } this.cops = this.cops.filter((k) => !k.gone); for (const v of this.cars) { v.left = true; const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); }
      g.cam.yaw = pl.h; g.cam.pitch = 0.14; try { g.playerAnim('idle'); g.snapCamera(); } catch (e) {} D.cam = false;
      this.note = { title: D.arrest ? 'BOOKED AND RELEASED' : 'PATCHED UP', sub: (D.arrest ? 'Let go with a warning' : best.q[0]) + (fee ? '  ·  −$' + fee.toLocaleString('en-US') : '') + '  ·  heat cleared', t: 0 };
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
    if (REAL && this._fig === undefined) { this._fig = null; /* the scanned officer file is asked for ONLY with ?heatfig=scan (it is not on the public build and must not be requested there: no fetch, no 404) */ this._figDone = true; }
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
  navyOf(m, D) {
    let n = this.navy.get(m); if (n) return n; n = m.clone(); const nm = m.name || '', P = this.g.P, VS = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHeatP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vHeatP = position;'); };
    if (/^(top|pants|bottom|dress|skirt|jacket)_/.test(nm)) { n.color.set(0xffffff); n.roughness = Math.max(n.roughness, 0.72); n.metalness = 0;
      /* two-tone, split at the belt line of the figure's own bind pose (three of the kit's four people wear ONE garment from collar to ankle: that was the 'flat blue jumpsuit'): a blue shirt over
         near-black navy trousers; and cloth that folds: a height made in the shader from the bind-pose position (rings at the elbows and knees, a fan at the crotch, a stack at the ankles, blousing over
         the belt, long soft drapes and armpit pulls on the shirt) tilts the normal, darkens the valleys and roughens them. ?heatfold=<gain> (0 = flat as before) */
      const waist = D ? (/^(pants|bottom)_/.test(nm) ? 9 : D.waist) : 1, U = { uHD: { value: new THREE.Vector4(waist, D ? D.knee : 0.52, P.has('heatfold') ? +P.get('heatfold') : 1, 0) /* 1.7 read as 'glossy uniform' (round 31) */ }, uHE: { value: D ? D.elb.clone() : new THREE.Vector3(0.02, 1.24, 0.36) } };
      n.onBeforeCompile = (sh) => { VS(sh); Object.assign(sh.uniforms, U);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uHD; uniform vec3 uHE; varying vec3 vHeatP; float heatH = 0.0;
float heatFold(vec3 p, float lg, float arm) {
  float n = sin(p.x * 31.0 + sin(p.y * 23.0) * 1.7) * sin(p.z * 37.0 + p.y * 13.0), h = 0.0, sz = p.z < 0.0 ? -1.0 : 1.0;
  vec3 e = vec3(uHE.x, uHE.y, uHE.z * sz); float de = length(p - e);
  h += arm * sin(de * 105.0 + n * 1.5) * exp(-de * de / 0.011) * 0.0034;
  h += arm * sin(dot(p - e, vec3(0.0, 0.75, -0.66 * sz)) * 38.0 + atan(p.x, p.y - e.y) * 2.0 + n) * 0.0012;
  float dk = p.y - uHD.y; h += lg * sin(dk * 88.0 + n * 1.7 + p.x * 14.0) * exp(-dk * dk / 0.016) * 0.0034;
  float dc = p.y - (uHD.x - 0.17); h += lg * sin(p.y * 62.0 + abs(p.z) * 74.0 + n * 1.2) * exp(-dc * dc / 0.012) * 0.003;
  h += lg * sin(p.y * 105.0 + n * 2.2) * (1.0 - smoothstep(0.1, 0.34, p.y)) * 0.003;
  float tr = (1.0 - lg) * (1.0 - arm), dw = p.y - (uHD.x + 0.075);
  h += tr * sin(p.y * 118.0 + sin(atan(p.z, p.x) * 5.0) * 2.2 + n) * exp(-dw * dw / 0.005) * 0.003;
  h += tr * sin(atan(p.z, p.x - 0.02) * 8.0 + p.y * 7.0 + n * 0.9) * 0.0011;
  float ds = p.y - (uHE.y + 0.2); h += tr * sin((p.y - abs(p.z) * 1.3) * 70.0 + n) * smoothstep(0.1, 0.19, abs(p.z)) * exp(-ds * ds / 0.02) * 0.0026;
  /* creases all over the cloth: two crossing families of sharp ridges */
  float w1 = sin(p.y * 46.0 + p.x * 21.0 + 2.3 * sin(p.z * 33.0 + p.y * 9.0)), w2 = sin(p.y * 27.0 - abs(p.z) * 38.0 + 1.9 * sin(p.x * 41.0 + p.y * 5.0));
  h += 0.0021 * (pow(1.0 - abs(w1), 2.0) - 0.33) + 0.0017 * (pow(1.0 - abs(w2), 2.0) - 0.33);
  return h * uHD.z; }`).replace('#include <map_fragment>', `#include <map_fragment>
 { float cl = min(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), 0.45), arm = smoothstep(0.2, 0.26, abs(vHeatP.z)), lg = (1.0 - smoothstep(uHD.x - 0.012, uHD.x + 0.012, vHeatP.y)) * (uHD.x > 5.0 ? 1.0 : 1.0 - arm);
   heatH = heatFold(vHeatP, lg, arm); diffuseColor.rgb = mix(vec3(0.04, 0.058, 0.104) * (0.6 + 1.1 * cl), vec3(0.011, 0.015, 0.034) * (0.65 + 1.4 * cl), lg) * clamp(1.0 + 60.0 * heatH, 0.6, 1.4); }`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor - 22.0 * heatH, 0.55, 1.0);').replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
 { vec3 hsx = dFdx(-vViewPosition), hsy = dFdy(-vViewPosition), hr1 = cross(hsy, normal), hr2 = cross(normal, hsx); float hdet = dot(hsx, hr1); vec2 hdh = vec2(dFdx(heatH), dFdy(heatH)); normal = normalize(abs(hdet) * normal - sign(hdet) * (hdh.x * hr1 + hdh.y * hr2)); }`); }; n.customProgramCacheKey = () => 'heat-navy5'; if ('envMapIntensity' in n) n.envMapIntensity = (n.envMapIntensity ?? 1) * 0.4; }
    else if (/^shoes_/.test(nm)) { /* black boots with a little polish */ n.color.multiplyScalar(0.11); n.roughness = 0.42; n.metalness = 0; }
    else if (/^skin_/.test(nm) && !P.has('heatskin')) { /* 'paper-white hands', 'waxy face' (rounds 25-28): the brightest skin (the hands of some of the kit's people are far lighter than their faces) is brought down to the face's tone; skin is matt with no sky in it,
         its roughness and tone are broken up in small patches, and it goes warmer and redder where it turns away from the eye (what light through skin does at the edge of a cheek or an ear) */
      n.roughness = Math.max(n.roughness ?? 0.6, 0.86); n.metalness = 0; if ('envMapIntensity' in n) n.envMapIntensity = (n.envMapIntensity ?? 1) * 0.3; if ('sheen' in n) n.sheen = 0; if ('clearcoat' in n) n.clearcoat = 0; if ('specularIntensity' in n) n.specularIntensity = 0.3;
      const ob = m.onBeforeCompile, key = m.customProgramCacheKey ? String(m.customProgramCacheKey()) : ''; n.onBeforeCompile = (sh, r) => { if (ob) ob(sh, r); VS(sh);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHeatP;').replace('#include <map_fragment>', '#include <map_fragment>\n { float sl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb *= mix(1.0, 0.36 / max(sl, 0.001), smoothstep(0.3, 0.55, sl)); diffuseColor.rgb *= vec3(0.9, 0.84, 0.8); float sm1 = sin(vHeatP.y * 83.0 + sin(vHeatP.z * 67.0) * 2.0) * sin(vHeatP.x * 71.0 + vHeatP.y * 29.0); diffuseColor.rgb *= vec3(1.0) + vec3(0.02, 0.05, 0.06) * sm1; }')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor + 0.1 * sin(vHeatP.y * 310.0 + sin(vHeatP.x * 270.0) * 2.0) * sin(vHeatP.z * 290.0 + vHeatP.y * 130.0), 0.6, 1.0);')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n { float hfr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2); diffuseColor.rgb *= mix(vec3(1.0), vec3(1.3, 0.84, 0.7), hfr * 0.75); }'); }; n.customProgramCacheKey = () => 'heat-skin2' + key; }
    this.navy.set(m, n); return n;
  }
  dressCop(k) {
    const g = this.g, c = this.c, kinds = g.kit.pedKinds ? g.kit.pedKinds() : []; if (!g.kit.people || !kinds.length) return;
    const fig = this._fig, who = fig ? fig.name : kinds[(k.n + this.units) % kinds.length]; let P = null; const i = this.pool.findIndex((q) => q.who === who); if (i >= 0) P = this.pool.splice(i, 1)[0];
    if (!P) { const vis = fig ? this.figPerson() : g.kit.person(who); if (!vis) return; let kitM = null; if (!fig) { let D = null; try { D = this.dimsOf(vis, who); } catch (e) { this.oops('dims', e); } vis.object.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => this.navyOf(m, D)) : this.navyOf(o.material, D); }); if (g.P.get('heatkit') !== '0') { try { kitM = this.kitMesh(vis, who); } catch (e) { kitM = null; this.oops('kit', e); } } vis.kitM = kitM; }
      const rig = new AimRig(vis, who); let cap = null; if (!kitM) { try { cap = new (this._Cap)(this.kitG || g.world.scene, this.capP(vis)); } catch (e) { cap = null; } }
      /* the vest of the heavier units: a dark plate carried on the chest */
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.37), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.85 })); vest.castShadow = true; vest.visible = false; (this.kitG || g.world.scene).add(vest);
      const belt = new THREE.Group(), dk = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6 }), ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.055, 14, 1, true), dk); ring.scale.set(0.155, 1, 0.19); ring.material.side = THREE.DoubleSide; if (!fig) belt.add(ring); /* the scanned figure has its belt in its texture: only the holster and pouches stand off it */
      for (const [x, z, sx, sy, sz] of [[0.02, 0.2, 0.09, 0.16, 0.05], [0.1, -0.16, 0.05, 0.08, 0.06], [-0.12, 0.13, 0.05, 0.09, 0.07], [0.15, 0, 0.03, 0.05, 0.06]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), dk); m.position.set(x, -sy / 2 + 0.03, z); belt.add(m); }
      try { const one = this.mergeStatic(belt); if (one) { one.castShadow = false; belt.clear(); belt.add(one); } } catch (e) { this.oops('merge', e); } belt.visible = false; if (!kitM) (this.kitG || g.world.scene).add(belt);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.068, 0.056), new THREE.MeshStandardMaterial({ color: 0xd9b24a, roughness: 0.35, metalness: 0.6, emissive: 0x4a3608 })); badge.visible = false; if (!kitM) (this.kitG || g.world.scene).add(badge);
      const hb = vis.object.getObjectByName(who + '_hips'); vis.hips0 = hb ? hb.position.clone() : null; vis.hipsB = hb;
      /* how tall this one of the kit's people stands, and a head 6 % smaller under the cap ('child-sized with an oversized head', rounds 25, 26) */
      if (!fig) { try { vis.object.updateMatrixWorld(true); vis.ht0 = new THREE.Box3().setFromObject(vis.object).max.y - vis.object.position.y; const hd = vis.object.getObjectByName(who + '_head'); if (hd && !g.P.has('heathead')) hd.scale.multiplyScalar(0.94) /* 0.89 was tried in rounds 31, 32: still 'oversized head', no gain */; } catch (e) { vis.ht0 = 0; } } g.world.scene.add(vis.object); P = { vis, rig: rig.ok ? rig : null, cap, vest, guns: {}, who, belt: kitM ? null : belt, badge: kitM ? null : badge }; }
    const vis = P.vis; k._posed = false; k._dtA = 0; k.vis = vis; k.rig = P.rig; k.capO = P.cap; k.vestO = P.vest; k.beltO = P.belt; k.badgeO = P.badge; k.guns = P.guns; k.who = who; vis.name = who; vis.object.visible = true; if (!vis.scan && vis.ht0 > 1.3 && vis.ht0 < 2.2) k.tall = clamp((1.8 + 0.025 * ((k.n * 7 + (this.units || 0)) % 4)) / vis.ht0, 0.96, 1.24); /* every officer 1.80-1.88 m whoever of the kit's people he is (a flat 4-10 % left the short ones short) */ if (vis.scan) { k.tall = 0.93 + 0.02 * ((k.n * 7 + (this.units || 0)) % 4); /* the scan stands 1.88 m: 1.75-1.86 m here */ if (vis.hairU) { const hc = [[1, 1, 1, 0], [0.5, 0.36, 0.26, 1], [0.2, 0.2, 0.23, 1], [1.05, 0.82, 0.5, 1]][k.hair || 0]; vis.hairU.value.set(hc[0], hc[1], hc[2], hc[3]); } } vis.used = true; vis._fit = vis._fit || null;
    if (vis.hipsB && vis.hips0) vis.hipsB.position.copy(vis.hips0); if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.stopAllAction(); } vis.cur = null; vis.object.rotation.set(0, k.h, 0); vis.object.scale.setScalar(1);
    let gun = k.guns[k.gunK]; if (!gun) { try { gun = c.build(k.gunK); } catch (e) { gun = null; } if (gun) { /* an officer's gun has no moving parts to show: all its pieces drawn as one */ try { const one = this.mergeStatic(gun); if (one) { const G2 = new THREE.Group(); G2.userData = gun.userData; G2.add(one); gun = G2; } } catch (e) { this.oops('merge', e); }
        /* a service gun is black: the long guns' pale furniture read as a 'white forearm tube', a 'white megaphone-like prop' in an officer's hands (rounds 23, 27) */
        if (!g.P.has('heatgunpale')) { const dk = (mm) => { const q = mm.clone(), l = q.color.r * 0.3 + q.color.g * 0.59 + q.color.b * 0.11; if (l > 0.16) q.color.multiplyScalar(0.16 / l); q.roughness = Math.max(q.roughness ?? 0.5, 0.5); return q; }; gun.traverse((m) => { if (m.isMesh && m.material) m.material = Array.isArray(m.material) ? m.material.map(dk) : dk(m.material); }); }
        gun.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }); (this.kitG || g.world.scene).add(gun); k.guns[k.gunK] = gun; } }
    for (const n in k.guns) k.guns[n].visible = false; k.gun = gun || null;
  }
  figPerson() {
    const F = this._fig, o = F.clone(F.src); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); let skel = null; const parts = []; o.traverse((c) => { if (c.isSkinnedMesh) parts.push(c); });
    for (const c of parts) { if (!skel) skel = c.skeleton; else if (c.skeleton.bones.length === skel.bones.length) c.bind(skel, c.bindMatrix); } o.updateMatrixWorld(true);
    /* one scan, several men: each officer's hair in his own colour (grey as scanned, dark brown, black, sandy): what is grey and above the chin is hair */
    const hairU = { value: new THREE.Vector4(1, 1, 1, 0) }; for (const c of parts) { const m0 = c.material; if (!m0 || Array.isArray(m0) || !m0.map) continue; const m = (c.material = m0.clone()); m.onBeforeCompile = (sh) => { sh.uniforms.uHair = hairU; sh.vertexShader = 'varying float vHy;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHy = position.y;'); sh.fragmentShader = 'varying float vHy; uniform vec4 uHair;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n { float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)); float hr = uHair.a * smoothstep(1.685, 1.71, vHy) * (1.0 - smoothstep(0.2, 0.36, (mx - mn) / max(mx, 0.02))); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.333))) * uHair.rgb, hr); }'); }; m.customProgramCacheKey = () => 'heat-hair1'; }
    for (const c of parts) { c.castShadow = true; try { c.computeBoundingSphere(); c.boundingSphere.radius = c.boundingSphere.radius * 1.6 + 0.9; c.frustumCulled = true; } catch (e) { c.frustumCulled = false; } }
    const mixer = new THREE.AnimationMixer(o), acts = {}, dur = {}, CS = (this.g.kit && this.g.kit.clipSpeed) || {}, kk = F.tall / 1.78;
    for (const a of F.anims) { const key = a.name.toLowerCase(); acts[key] = mixer.clipAction(a); dur[key] = a.duration; if (key === 'getin' || key === 'getout') { acts[key].setLoop(THREE.LoopOnce, 1); acts[key].clampWhenFinished = true; } }
    const walks = []; for (const w of ['walk', 'walkbrisk']) if (acts[w]) walks.push({ name: w, speed: (CS[w] || 1.45) * kk });
    return { object: o, mixer, acts, dur, cur: null, walks, runSpeed: (CS.run || 5) * kk, name: F.name, scan: true, hairU };
  }
  /* the cap: fitted to the scan's head (0.20 m wide, crown 0.19 m over the head bone), darker than before; the kit's people keep theirs. ?heatcap=0 bare-headed, ?heatcapr / heatcapy / heatcapx to try a fit */
  capP(vis) { const P = this.g.P, sc = !!(vis && vis.scan); return new URLSearchParams('cap=' + (P.get('heatcap') === '0' ? '0' : '1') + '&capc=' + (sc ? '0a0f1d' : '0d1630') + '&capy=' + (P.get('heatcapy') || (sc ? 0.1 : 0.082)) + '&capr=' + (P.get('heatcapr') || (sc ? 0.101 : 0.1)) + '&capx=' + (P.get('heatcapx') || (sc ? 0.027 : 0.012))); }
  /* THE UNIFORM AS AN OBJECT ON THE KIT'S PEOPLE (ninth shift; rounds 27, 28: 'flat blue jumpsuit with no badge, belt, radio or cloth folds'). The old belt ring and badge box
     were drawn, but INSIDE the figure's jacket (a fixed radius round the hips bone), so no critic ever saw them. This one is measured off each figure's own surface in its bind
     pose and skinned to its skeleton with the weights of the body under each piece, so it bends, kneels, gets out of the car and falls with him, in one draw: duty belt with
     buckle, holster and grip, magazine pouches, cuff case, radio; collar; shoulder patches; a shoulder microphone with its cord to the radio; shield, name bar, pocket flaps;
     POLICE across the back; a peaked cap with band, strap, visor and cap badge. All invented and generic: no force's marks. ?heatkit=0 = the old cap, ring and box. */
  dimsOf(vis, who) {
    const D0 = (this._dims ||= {})[who]; if (D0) return D0; let p0 = null; vis.object.traverse((o) => { if (o.isSkinnedMesh && !p0) p0 = o; }); if (!p0) return null;
    const sk = p0.skeleton, bInv = new THREE.Matrix4().copy(p0.bindMatrix).invert(), bi = (n) => sk.bones.findIndex((b) => b.name === who + '_' + n);
    const bp = (n) => { const i = bi(n); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(sk.boneInverses[i]).invert().premultiply(bInv)); };
    const D = { hips: bp('hips'), neck: bp('neck'), head: bp('head'), shin: bp('shin_L'), armL: bp('upper_arm_L'), foreL: bp('forearm_L'), armR: bp('upper_arm_R'), foreR: bp('forearm_R'), headI: bi('head') };
    if (!D.hips || !D.neck) return null; D.waist = D.hips.y + 0.05; D.knee = D.shin ? D.shin.y : 0.52; D.elb = D.foreL ? new THREE.Vector3(D.foreL.x, D.foreL.y, Math.abs(D.foreL.z)) : new THREE.Vector3(0.02, 1.24, 0.36); this._dims[who] = D; return D;
  }
  kitTex() {
    if (this._kitTex !== undefined) return this._kitTex; this._kitTex = null; if (typeof document === 'undefined') return null;
    try { const c = document.createElement('canvas'); c.width = 256; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 80); x.fillStyle = '#0a1024'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#e9e9e4'; x.font = '900 50px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', 128, 34, 236);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this._kitTex = t; } catch (e) { this._kitTex = null; } return this._kitTex;
  }
  kitMat() {
    if (this._kitMat) return this._kitMat; const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, map: this.kitTex() }); m.name = 'heat_kit';
    /* one material for cloth, leather and metal: a per-vertex 'shine' (0 cloth, 0.3 leather, 0.6 the visor, 0.9 metal) */
    m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float hm; varying float vHm;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vHm = hm;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHm;').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.9, 0.24, vHm);').replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = smoothstep(0.7, 0.9, vHm);'); };
    m.customProgramCacheKey = () => 'heat-kit1'; this._kitMat = m; return m;
  }
  kitMesh(vis, who) {
    const parts = []; vis.object.traverse((o) => { if (o.isSkinnedMesh) parts.push(o); }); const D = this.dimsOf(vis, who); if (!parts.length || !D) return null; const p0 = parts[0];
    let G = (this._kitGeo ||= {})[who];
    if (!G) {
      const V3 = THREE.Vector3, TAU = Math.PI * 2, UPv = new V3(0, 1, 0), lerp = (a, b, t) => a + (b - a) * t;
      /* the body in its bind pose: cloth 1, skin 2, hair 3 */
      const BX = [], BT = [], BS = []; for (const p of parts) { const nm = (p.material && p.material.name) || '', ty = /^(top|pants|bottom|dress|skirt|jacket)_/.test(nm) ? 1 : /^skin_/.test(nm) ? 2 : /^hair_/.test(nm) ? 3 : 0; if (!ty) continue; const a = p.geometry.attributes.position; for (let i = 0; i < a.count; i++) { BX.push(a.getX(i), a.getY(i), a.getZ(i)); BT.push(ty); BS.push(p, i); } }
      const N = BT.length; if (N < 200) return null;
      /* the trunk's outline at a height: the largest radius in each of 24 directions round the slice's middle (arms left out by |z|) */
      const NA = 24, rings = new Map();
      const ring = (y, zm = 0.21) => { const key = Math.round(y * 200) + ':' + zm; let r = rings.get(key); if (r) return r; let x0 = 1e9, x1 = -1e9; const sel = [];
        for (let i = 0; i < N; i++) { if (BT[i] === 3) continue; if (Math.abs(BX[i * 3 + 1] - y) > 0.03 || Math.abs(BX[i * 3 + 2]) > zm) continue; sel.push(i); x0 = Math.min(x0, BX[i * 3]); x1 = Math.max(x1, BX[i * 3]); }
        const cx = sel.length ? (x0 + x1) / 2 : 0; let R = new Float32Array(NA);
        for (const i of sel) { const X = BX[i * 3] - cx, Z = BX[i * 3 + 2], j = Math.round((Math.atan2(Z, X) / TAU) * NA + NA) % NA; R[j] = Math.max(R[j], Math.hypot(X, Z)); }
        for (let pass = 0; pass < NA; pass++) { const Q = R.slice(); let any = false; for (let j = 0; j < NA; j++) if (!R[j]) { const a = R[(j + NA - 1) % NA], b = R[(j + 1) % NA]; if (a || b) { Q[j] = a && b ? (a + b) / 2 : Math.max(a, b); any = true; } } R = Q; if (!any) break; }
        { const Q = R.slice(); for (let j = 0; j < NA; j++) Q[j] = Math.max(R[j], (R[(j + NA - 1) % NA] + R[(j + 1) % NA]) / 2) || 0.14; R = Q; }
        r = { cx, y, rad: (a) => { const f = (((a / TAU) % 1) + 1) % 1 * NA, j = Math.floor(f) % NA, w = f - Math.floor(f); return R[j] * (1 - w) + R[(j + 1) % NA] * w; }, at: (a, off = 0, yy = y) => { const q = r.rad(a) + off; return new V3(cx + q * Math.cos(a), yy, q * Math.sin(a)); } }; rings.set(key, r); return r; };
      const angZ = (R, z) => { let a = 0; for (let i = 0; i < 5; i++) a = Math.asin(clamp(z / Math.max(0.05, R.rad(a)), -0.98, 0.98)); return a; };
      const V = [], C = [], HM = [], UV = [], IX = [], AN = []; let anchor = null, bone = -1;
      const vtx = (p, c, hm = 0, u = 0.5, v = 0.06) => { V.push(p.x, p.y, p.z); C.push(c[0], c[1], c[2]); HM.push(hm); UV.push(u, v); const a = anchor || p; AN.push(a.x, a.y, a.z, bone); return V.length / 3 - 1; };
      const quad = (a, b, c, d) => IX.push(a, b, c, a, c, d);
      const grid = (nu, nv, f) => { const base = V.length / 3; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) f(i / nu, j / nv, i, j); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = base + j * (nu + 1) + i; quad(q, q + 1, q + nu + 2, q + nu + 1); } };
      const box = (c, ex, ey, ez, col, hm = 0) => { for (const [n, u, w] of [[ex, ey, ez], [ey, ez, ex], [ez, ex, ey]]) for (const s of [1, -1]) { const b = V.length / 3; for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) vtx(new V3().copy(c).addScaledVector(n, s).addScaledVector(u, su).addScaledVector(w, sw), col, hm); quad(b, b + 1, b + 2, b + 3); } };
      /* a box standing off the trunk: hr out, ht along the trunk, hv up and down */
      const rb = (R, y, a, off, hr, ht, hv, col, hm = 0) => { const n = new V3(Math.cos(a), 0, Math.sin(a)), t = new V3(-Math.sin(a), 0, Math.cos(a)); anchor = R.at(a, 0, y); box(R.at(a, off + hr, y), n.multiplyScalar(hr), new V3(0, hv, 0), t.multiplyScalar(ht), col, hm); anchor = null; };
      const shield = (P, n, t, up, s, col, hm) => { const pts = [[-0.022, 0.03], [0, 0.036], [0.022, 0.03], [0.024, 0], [0.014, -0.024], [0, -0.034], [-0.014, -0.024], [-0.024, 0]]; anchor = P.clone(); const b = V.length / 3; vtx(new V3().copy(P).addScaledVector(n, 0.011), col, hm);
        for (const [x, y] of pts) vtx(new V3().copy(P).addScaledVector(t, x * s).addScaledVector(up, y * s).addScaledVector(n, 0.006), col, hm); for (const [x, y] of pts) vtx(new V3().copy(P).addScaledVector(t, x * s * 1.06).addScaledVector(up, y * s * 1.06).addScaledVector(n, -0.004), col, hm * 0.9);
        for (let i = 0; i < 8; i++) { IX.push(b, b + 1 + i, b + 1 + ((i + 1) % 8)); quad(b + 1 + i, b + 1 + ((i + 1) % 8), b + 9 + ((i + 1) % 8), b + 9 + i); } anchor = null; };
      const LEA = [0.011, 0.011, 0.012], GOLD = [0.92, 0.66, 0.2], SILV = [0.78, 0.79, 0.82], SHIRT = [0.062, 0.1, 0.2], NAVY = [0.012, 0.017, 0.04], BLK = [0.02, 0.02, 0.022];
      const yB = D.waist, RB = ring(yB, 0.24), neck = D.neck;
      /* duty belt */
      { const rows = [[-0.031, 0.002], [-0.028, 0.014], [0.028, 0.014], [0.031, 0.002]]; grid(32, 3, (u, v, i, j) => { const p = RB.at(u * TAU, rows[j][1]); p.y = yB + rows[j][0]; vtx(p, LEA, 0.32); }); }
      rb(RB, yB, 0, 0.014, 0.004, 0.017, 0.015, [0.42, 0.42, 0.45], 0.8);
      rb(RB, yB - 0.075, 1.5, 0.014, 0.022, 0.036, 0.085, LEA, 0.34); rb(RB, yB + 0.036, 1.5, 0.02, 0.012, 0.022, 0.03, [0.035, 0.035, 0.038], 0.25);
      for (const a of [-0.5, -0.83]) rb(RB, yB - 0.008, a, 0.014, 0.015, 0.021, 0.046, LEA, 0.34);
      rb(RB, yB - 0.004, 2.55, 0.014, 0.015, 0.033, 0.037, LEA, 0.34); rb(RB, yB - 0.02, -2.5, 0.014, 0.013, 0.03, 0.05, LEA, 0.34);
      rb(RB, yB - 0.004, -1.55, 0.014, 0.019, 0.031, 0.056, LEA, 0.34); rb(RB, yB + 0.072, -1.55, 0.018, 0.014, 0.024, 0.026, [0.03, 0.03, 0.033], 0.2); rb(RB, yB + 0.118, -1.63, 0.022, 0.005, 0.005, 0.024, BLK, 0.2);
      /* collar: a stand and the fold over it, open at the throat */
      { const yN = neck.y, RA = ring(yN - 0.005, 0.1), RT = ring(yN + 0.03, 0.085), a0 = 0.5, pt = (u) => Math.max(0, 1 - Math.min(u, 1 - u) * 7);
        grid(20, 1, (u, v) => { const a = lerp(a0, TAU - a0, u); vtx(v ? RT.at(a, 0.011, yN + 0.032) : RA.at(a, 0.008, yN - 0.014), SHIRT, 0.05); });
        grid(20, 1, (u, v) => { const a = lerp(a0, TAU - a0, u); vtx(v ? RA.at(a, 0.03 + 0.012 * pt(u), yN + 0.002 - 0.028 * pt(u)) : RT.at(a, 0.012, yN + 0.033), [0.07, 0.112, 0.22], 0.05); }); }
      /* shoulder patches */
      for (const [S, E] of [[D.armL, D.foreL], [D.armR, D.foreR]]) { if (!S || !E) continue; const ax = new V3().subVectors(E, S), L = ax.length(); ax.normalize(); const o = new V3().copy(UPv).addScaledVector(ax, -UPv.dot(ax)).normalize(), f = new V3().crossVectors(o, ax).normalize(), t0 = 0.36 * L, sg = Math.sign(S.z) || 1; let rm = 0;
        for (let i = 0; i < N; i++) { if (BT[i] === 3 || BX[i * 3 + 2] * sg < 0.15) continue; const dx = BX[i * 3] - S.x, dy = BX[i * 3 + 1] - S.y, dz = BX[i * 3 + 2] - S.z, s = dx * ax.x + dy * ax.y + dz * ax.z; if (Math.abs(s - t0) > 0.05) continue; const ex = dx - ax.x * s, ey = dy - ax.y * s, ez = dz - ax.z * s, r = Math.hypot(ex, ey, ez); if (r > 0.02 && r < 0.11 && (ex * o.x + ey * o.y + ez * o.z) / r > 0.3) rm = Math.max(rm, r); }
        rm = (rm || 0.055) + 0.004; grid(4, 4, (u, v, i, j) => { const w = (v - 0.5) * 1.05 * (1 - 0.5 * u * u), p = new V3().copy(S).addScaledVector(ax, t0 + (u - 0.5) * 0.08).addScaledVector(o, Math.cos(w) * rm).addScaledVector(f, Math.sin(w) * rm), edge = i === 0 || j === 0 || i === 4 || j === 4, mid = i === 2 && j === 2; vtx(p, edge ? [0.5, 0.4, 0.15] : mid ? [0.5, 0.5, 0.54] : [0.02, 0.032, 0.09], edge ? 0.45 : mid ? 0.4 : 0.05); }); }
      /* peaked cap, on the head bone alone */
      if (D.head && D.headI >= 0) { let top = -1e9; for (let i = 0; i < N; i++) if (BT[i] === 2 && BX[i * 3 + 1] > D.head.y) top = Math.max(top, BX[i * 3 + 1]);
        if (top > D.head.y + 0.08) { let x0 = 1e9, x1 = -1e9, zm = 0; for (let i = 0; i < N; i++) { const Y = BX[i * 3 + 1]; if (BT[i] === 1 || Y < top - 0.095 || Y > top - 0.03) continue; x0 = Math.min(x0, BX[i * 3]); x1 = Math.max(x1, BX[i * 3]); zm = Math.max(zm, Math.abs(BX[i * 3 + 2])); }
          const cx = (x0 + x1) / 2, rx = Math.min(0.128, (x1 - x0) / 2 + 0.007), rz = Math.min(0.108, zm + 0.007), hp = (a, s, y) => new V3(cx + rx * s * Math.cos(a), y, rz * s * Math.sin(a)); bone = D.headI; const CAPC = [0.014, 0.019, 0.042];
          const rows = [[1, -0.074, BLK, 0.36, 0], [1, -0.04, BLK, 0.36, 0], [1.03, -0.038, CAPC, 0.04, 0], [1.21, 0.004, CAPC, 0.04, 1], [0.8, 0.024, CAPC, 0.04, 0.7], [0, 0.03, CAPC, 0.04, 0.4]];
          grid(24, 5, (u, v, i, j) => { const a = u * TAU, r = rows[j]; vtx(hp(a, r[0], top + r[1] + 0.022 * r[4] * Math.cos(a)), r[2], r[3]); });
          grid(10, 1, (u, v) => { const a = lerp(-0.95, 0.95, u); vtx(hp(a, 1.02, top - (v ? 0.05 : 0.062)), GOLD, 0.9); });
          grid(12, 2, (u, v) => { const a = lerp(-1.12, 1.12, u), e = Math.max(0, Math.cos(a * 1.4)); vtx(hp(a, 1 + 0.52 * e * v, top - 0.068 - 0.032 * e * v * v), BLK, 0.62); });
          shield(hp(0, 1.125, top - 0.012), new V3(0.95, -0.3, 0).normalize(), new V3(0, 0, 1), new V3(0.3, 0.95, 0).normalize(), 0.62, GOLD, 0.9); bone = -1; } }
      const nBase = IX.length;
      /* chest: left out under the heavier units' vest */
      { const yM = neck.y - 0.075, RM = ring(yM, 0.2), aM = angZ(RM, -0.1); rb(RM, yM, aM, 0.003, 0.014, 0.02, 0.033, BLK, 0.3); rb(RM, yM + 0.008, aM, 0.031, 0.0012, 0.012, 0.012, [0.13, 0.13, 0.14], 0.5);
        grid(12, 1, (u, v) => { const y = lerp(yM - 0.03, yB + 0.09, u), R = ring(y, 0.2), a = lerp(aM, -1.5, u * u * (3 - 2 * u)) + 0.035 * Math.sin(u * 30), p = R.at(a, 0.006); p.z += (v - 0.5) * 0.009; p.x += (v - 0.5) * 0.004; vtx(p, BLK, 0.25); });
        const yK = neck.y - 0.17; if (this.kitTex()) grid(8, 2, (u, v) => { const y = yK + 0.036 - 0.072 * v; vtx(ring(y, 0.2).at(Math.PI + 0.6 - 1.2 * u, 0.004), [1, 1, 1], 0.02, 1 - u /* it read mirrored on a dead man's back (rounds 31, 32) */, 1 - 0.8 * v); });
        const yC = neck.y - 0.2, RC = ring(yC, 0.2), aB = angZ(RC, -0.085); shield(RC.at(aB, 0.003), new V3(Math.cos(aB), 0, Math.sin(aB)), new V3(-Math.sin(aB), 0, Math.cos(aB)), UPv, 1.2, GOLD, 0.9);
        const aN = angZ(RC, 0.085); rb(RC, yC + 0.012, aN, 0.003, 0.003, 0.029, 0.0065, SILV, 0.9);
        for (const sg of [-1, 1]) { const yP = yC - 0.052, a1 = angZ(RC, sg * 0.03), a2 = angZ(RC, sg * 0.14); grid(4, 2, (u, v, i, j) => { const y = yP + 0.02 - 0.04 * v - (j === 2 ? 0.012 * (1 - Math.abs(u - 0.5) * 2) : 0); vtx(ring(y, 0.2).at(lerp(a1, a2, u), 0.003 + 0.004 * v), [0.045, 0.074, 0.15], 0.04); }); rb(RC, yP - 0.012, (a1 + a2) / 2, 0.007, 0.002, 0.005, 0.005, SILV, 0.8); } }
      /* each piece moves with the body under it: the skin weights of the nearest body vertex */
      const nV = V.length / 3, SI = new Uint16Array(nV * 4), SW = new Float32Array(nV * 4), memo = new Map();
      for (let i = 0; i < nV; i++) { const b = AN[i * 4 + 3]; if (b >= 0) { SI[i * 4] = b; SW[i * 4] = 1; continue; } const ax = AN[i * 4], ay = AN[i * 4 + 1], az = AN[i * 4 + 2], key = ax.toFixed(3) + ',' + ay.toFixed(3) + ',' + az.toFixed(3); let j = memo.get(key);
        if (j === undefined) { let bd = 1e9; j = 0; for (let q = 0; q < N; q++) { if (BT[q] === 3) continue; const dx = BX[q * 3] - ax, dy = BX[q * 3 + 1] - ay, dz = BX[q * 3 + 2] - az, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; j = q; } } memo.set(key, j); }
        const pa = BS[j * 2].geometry.attributes, vi = BS[j * 2 + 1], si = pa.skinIndex, sw = pa.skinWeight; SI[i * 4] = si.getX(vi); SI[i * 4 + 1] = si.getY(vi); SI[i * 4 + 2] = si.getZ(vi); SI[i * 4 + 3] = si.getW(vi); SW[i * 4] = sw.getX(vi); SW[i * 4 + 1] = sw.getY(vi); SW[i * 4 + 2] = sw.getZ(vi); SW[i * 4 + 3] = sw.getW(vi); }
      const full = new THREE.BufferGeometry(); full.setAttribute('position', new THREE.Float32BufferAttribute(V, 3)); full.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); full.setAttribute('hm', new THREE.Float32BufferAttribute(HM, 1)); full.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      full.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); full.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4)); full.setIndex(IX); full.computeVertexNormals(); full.boundingSphere = new THREE.Sphere(new V3(0, 0.9, 0), 2.6);
      const heavy = new THREE.BufferGeometry(); for (const n in full.attributes) heavy.setAttribute(n, full.attributes[n]); heavy.setIndex(full.index); heavy.setDrawRange(0, nBase); heavy.boundingSphere = full.boundingSphere;
      G = this._kitGeo[who] = { full, heavy, tris: IX.length / 3 };
    }
    const kit = new THREE.SkinnedMesh(G.full, this.kitMat()); kit.name = 'heat_kit'; kit.position.copy(p0.position); kit.quaternion.copy(p0.quaternion); kit.scale.copy(p0.scale); (p0.parent || vis.object).add(kit); kit.bind(p0.skeleton, p0.bindMatrix); kit.castShadow = true; kit.receiveShadow = true; kit.frustumCulled = true; kit.userData.heatG = G; return kit;
  }
  /* every mesh under root (all of one material) as a single mesh in root's frame; null if they do not share a material or the attributes do not match */
  mergeStatic(root) {
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), list = []; let mat = null, bad = false; root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return; if (Array.isArray(o.material) || (mat && o.material !== mat)) bad = true; mat = mat || o.material; list.push(o); });
    if (bad || list.length < 2) return null; const names = ['position', 'normal', 'color', 'uv'].filter((n) => list.every((o) => o.geometry.attributes[n] && o.geometry.attributes[n].itemSize === list[0].geometry.attributes[n].itemSize)); if (!names.includes('position')) return null;
    const arr = {}; for (const n of names) arr[n] = []; const m4 = new THREE.Matrix4();
    for (const o of list) { const ge = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); m4.multiplyMatrices(inv, o.matrixWorld); if (!m4.elements.every(Number.isFinite)) { ge.dispose(); return null; } ge.boundingBox = null; ge.boundingSphere = null; ge.applyMatrix4(m4); for (const n of names) { const a = ge.attributes[n]; for (let i = 0; i < a.count * a.itemSize; i++) arr[n].push(a.array[i]); } ge.dispose(); }
    for (let i = 0; i < arr.position.length; i++) if (!Number.isFinite(arr.position[i])) return null;
    const out = new THREE.BufferGeometry(); for (const n of names) out.setAttribute(n, new THREE.Float32BufferAttribute(arr[n], list[0].geometry.attributes[n].itemSize)); const me = new THREE.Mesh(out, mat); me.castShadow = true; me.receiveShadow = true; return me;
  }
  anim(k, name, rate) { const v = k.vis; if (!v.mixer) return; if (!v.acts[name]) name = v.acts.idle ? 'idle' : null; if (!name) return; if (v.cur !== name) { if (v.cur && v.acts[v.cur]) v.acts[v.cur].fadeOut(0.18); v.acts[name].reset().fadeIn(0.18).play(); v.cur = name; } v.mixer.timeScale = rate; }
  preSync(dt) {
    if (!REAL || this.idle) return; if (this._Cap === undefined) { this._Cap = null; import('./dress.js').then((m) => { this._Cap = m.Cap; }).catch(() => {}); }
    if (this._fig === undefined) { this._fig = null; /* the scanned officer figure did no better than the kit's people in a like-for-like blind test (rounds 21-24) and carries a 'needs a look before public use' tag: it is only loaded when asked for with ?heatfig=scan; nothing is fetched otherwise */ this._figDone = true; }
    /* blood on the ground: the people code's pool is a lit, glossy 0.13 red; in full sun under the film pass it came out 'magenta paint-splat', 'pink blot' (rounds 13, 14). A third of that, less gloss, almost no sky in it (?heatblood=0 leaves it) */
    { const B = this.c.bodies; if (B && !this.g.P.has('heatblood')) { const fx = (me) => { const m = me && me.material; if (!m || m._heatBlood || !m.uniforms || !m.uniforms.uH || !m.onBeforeCompile) return; m._heatBlood = true; const ob = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { ob(sh, r); sh.fragmentShader = sh.fragmentShader.replace('vec3(0.13, 0.004, 0.004)', 'vec3(0.042, 0.002, 0.002)').replace('vec3(0.055, 0.002, 0.002)', 'vec3(0.018, 0.001, 0.001)'); }; m.customProgramCacheKey = () => 'bloodpool3-heat'; m.envMapIntensity = 0.08; m.roughness = 0.42; m.needsUpdate = true; };
        try { for (const q of B.pools || []) fx(q.me); for (const sp of (B.drops && B.drops.spots) || []) if (sp) fx(sp.me); } catch (e) { this.oops('blood', e); } } }
    const kit = this.g.kit, CS = (kit && kit.clipSpeed) || {};
    const dt0 = dt; this._drawN = (this._drawN || 0) + 1; for (const k of this.cops) { dt = dt0; const v = k.vis; if (!v || k.hp <= 0) continue; if (dt0 > 1e-4) { const a = Math.min(1, dt0 * 12); k.wx = (k.wx || 0) + ((k.x - (k.lx0 ?? k.x)) / dt0 - (k.wx || 0)) * a; k.wy = (k.wy || 0) + ((k.y - (k.ly0 ?? k.y)) / dt0 - (k.wy || 0)) * a; k.lx0 = k.x; k.ly0 = k.y; } const o = v.object, sp = k.speed || 0, tall = (kit.tall && kit.tall[k.who]) || 1, wk = (v.walks || []).find((w) => w.name === 'walkbrisk') || (v.walks || [])[0] || { name: 'walk', speed: 1.45 };
      /* beyond 16 m from the camera an officer's clip and aim pose are worked out every second frame (the figure itself still moves every frame); ?heathalf=0 off */
      { const cp = this.g.world.camera.position, far = this.half && !k.get && Math.hypot(k.x - cp.x, -k.y - cp.z) > 16; k._skip = far && ((this._drawN + k.n) & 1) === 1 && k._posed; if (k._skip) { k._dtA = (k._dtA || 0) + dt; const dx = k.x - o.position.x, dy = k.z - o.position.y, dz = -k.y - o.position.z; o.position.set(k.x, k.z, -k.y); o.rotation.set(0, k.h, 0);
          for (const q of [k.gun, k.capO && k.capO.group, k.vestO, k.beltO, k.badgeO]) if (q && q.visible) { q.position.x += dx; q.position.y += dy; q.position.z += dz; } continue; } dt = dt + (k._dtA || 0); k._dtA = 0; k._posed = true; }
      k.spA = (k.spA ?? sp) + (sp - (k.spA ?? sp)) * Math.min(1, dt * 10); const s = k.spA, jog = v.acts.jog ? (CS.jog || 2.62) * tall : 0;
      if (k.get) { if (k.get.anim) { this.anim(k, 'getout', 1); if (k.get.t < 0.02) v.acts.getout.time = 0; } else this.anim(k, 'idle', 1); }
      else if (s > (jog ? 3.5 : 3.0)) this.anim(k, 'run', clamp(s / (v.runSpeed || 4.02), 0.8, 1.3)); else if (jog && s > 2.05) this.anim(k, 'jog', clamp(s / jog, 0.8, 1.35)); else if (s > 0.25) this.anim(k, wk.name, clamp(s / wk.speed, 0.5, 1.3)); else this.anim(k, 'idle', 1);
      if (k.rig) { try { k.rig.stanceOff(); } catch (e) {} } o.position.set(k.x, k.z, -k.y); o.rotation.set(0, k.h, 0); { const wd = k.wide || 1; o.scale.set(k.tall * (1 + (wd - 1) * 0.6), k.tall, (k.get && k.get.side < 0 ? -k.tall : k.tall) * wd); } if (v.mixer) v.mixer.update(dt); o.updateMatrixWorld(true); }
  }
  postSync(dt) {
    if (!REAL || this.idle) return; const g = this.g, pl = g.player;
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
      /* the cap's code loads a moment after the first officers can be made */ if (!k.capO && !vis.kitM && this._Cap && k.hp > 0) { try { k.capO = new (this._Cap)(this.kitG || g.world.scene, this.capP(vis)); } catch (e) { this._Cap = null; } } if (k.hp <= 0) { if (k.capO) k.capO.update(k.rig, vis.object.visible && k.capOn !== false); if (k.vestO) k.vestO.visible = false; if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; continue; } if (k._skip) continue; try { this.poseCop(k, tx, ty, tz, dt); } catch (e) { this.oops('pose', e); }
      /* small kit is not drawn far off, and a far officer's gun casts no shadow */
      if (vis.kitM) { const gq = k.heavy ? vis.kitM.userData.heatG.heavy : vis.kitM.userData.heatG.full; if (vis.kitM.geometry !== gq) vis.kitM.geometry = gq; }
      { const d = Math.hypot(k.x - camP.x, -k.y - camP.z); if (d > 24) { if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; } if (k.gun && k.gun.userData.heatSh !== !k._shFar) { k.gun.userData.heatSh = !k._shFar; k.gun.traverse((m) => { if (m.isMesh) m.castShadow = !k._shFar; }); } } }
  }
  /* the player gives himself up: both hands to the back of the head (the guns helper's rig, posed after its own pass) */
  handsUp(w) {
    const rig = this.c.rig, pl = this.g.player; if (!rig || !rig.ok || w <= 0) return; const hx = Math.cos(pl.h), hz = -Math.sin(pl.h), rx = Math.sin(pl.h), rz = Math.cos(pl.h), hd = rig.pos('head', new THREE.Vector3()), fw = new THREE.Vector3(hx, 0, hz), rt = new THREE.Vector3(rx, 0, rz);
    for (const s of [1, -1]) { const side = s > 0 ? 'R' : 'L', wr = new THREE.Vector3().copy(hd).addScaledVector(rt, s * 0.13).addScaledVector(fw, -0.1).addScaledVector(UP, 0.06), pole = new THREE.Vector3().copy(rt).multiplyScalar(s).addScaledVector(UP, 0.25).addScaledVector(fw, -0.1);
      rig.arm(side, wr, pole, w); rig.handDir(side, _v.copy(rt).multiplyScalar(-s).addScaledVector(UP, 0.2).normalize(), _v2.copy(fw), w); rig.curl(side, 0.3 * w); }
  }
  poseCop(k, tx, ty, tz, dt) {
    const rig = k.rig, gun = k.gun, vis = k.vis; if (k.get) { if (gun) gun.visible = false; if (k.capO) k.capO.update(rig, k.capOn !== false); if (k.vestO) k.vestO.visible = false; if (k.beltO) k.beltO.visible = false; if (k.badgeO) k.badgeO.visible = false; return; } if (!rig) { if (gun) { gun.visible = true; gun.position.set(k.x + Math.cos(k.h) * 0.4, k.z + 1.25, -(k.y + Math.sin(k.h) * 0.4)); gun.rotation.set(0, k.h, 0); } return; }
    const sgE = k.stag ? (k.stag.t < 0.12 ? k.stag.t / 0.12 : k.stag.t < 0.62 ? 1 : sm(clamp((k.stag.dur - k.stag.t) / (k.stag.dur - 0.62), 0, 1))) : 0, sgF = k.stag ? k.stag.dx * Math.cos(k.h) + k.stag.dy * Math.sin(k.h) : 0;
    const a = sm(k.aim), long = k.gunK !== 'pistol', hx = Math.cos(k.h), hz = -Math.sin(k.h), low = Math.min(1, 1 - k.up + sgE * 0.08), st = 1 - clamp((k.spA || 0) / 0.8, 0, 1);
    /* his own way of standing in the fight (STY): how far out of cover he is, which way out is (away from the middle of the car he is behind), one knee down when he is low, the reload */
    const S = STY[k.sty || 0], bx = Math.sin(k.h), bz = Math.cos(k.h), ex = clamp((k.up - 0.35) / 0.4, 0, 1), rl = k.relT > 0 ? sm(Math.min(1, (2.1 - k.relT) / 0.25)) * sm(Math.min(1, k.relT / 0.3)) : 0;
    let sgn = k.n % 2 ? 1 : -1; if (k.cover && k.cover.car) sgn = (k.x - k.cover.car.x) * bx - (k.y - k.cover.car.y) * bz > 0 ? 1 : -1;
    const kneeS = k.stag && k.stag.knee && !k._nd ? sgE : 0, kn = Math.max(S.kneel && !k._nd ? sm((low - 0.3) / 0.2) : 0, kneeS * sm((low - 0.3) / 0.2)) * st, ln = S.lean * sgn * ex * a * st * (1 - sgE), bl = S.blade * a * (long ? 0.3 : 1) * 0.7 * (1 - sgE);
    /* low behind cover: hips down over planted feet, one foot back, trunk forward; on a knee the hips come down to knee height, the back foot goes well back on its toes and that knee meets the ground */
    if (rig.legs) { rig.hold('foot_L'); rig.hold('foot_R'); }
    if (rig.legs && (low > 0.02 || a > 0.02)) { const drop = 0.035 * a + 0.44 * low + kn * Math.max(0, 0.42 + 0.1 * low - 0.44 * low), fF = (0.08 + 0.1 * low) * st + 0.14 * kn, fB = (0.1 + 0.22 * low) * st + 0.24 * kn, flip = S.kneel < 0 && !kneeS;
      _v2.set(hx * fF + bx * 0.05 * kn * (flip ? 1 : -1), 0, hz * fF + bz * 0.05 * kn * (flip ? 1 : -1)); _v3.set(-hx * fB, 0, -hz * fB);
      rig.stanceLegs(_v.set(-hx * 0.05 * low + bx * ln, -drop * (k.tall || 1), -hz * 0.05 * low + bz * ln), flip ? _v3 : _v2, flip ? _v2 : _v3, _v4.set(hx, 0, hz)); if (kn > 0.05) rig.nudge(flip ? 'foot_L' : 'foot_R', _v4.set(bx, 0, bz), -0.95 * kn); }
    if (rig.legs) { rig.held('foot_L'); rig.held('foot_R'); }
    const neck0 = rig.pos('neck', _v); F.set(tx - neck0.x, tz - neck0.y, -ty - neck0.z); if (F.lengthSq() < 0.01) F.set(hx, 0, hz); F.normalize(); F.y = clamp(F.y, -0.5, 0.5); F.normalize();
    const yaw = Math.atan2(-F.z, F.x), ap = Math.asin(F.y), tw = clamp(wrapPi(yaw - k.h), -1.45, 1.45); R.set(Math.sin(yaw), 0, Math.cos(yaw));
    rig.twist(tw * Math.max(a, 0.25) - (long ? 0.46 * a : 0) - bl, 0, R);
    rig.twist(0, (ap * 0.5 - 0.11) * a - 0.34 * low * (1 - 0.35 * kn) - S.fwd * a + Math.min(0.16, k.back * 0.1) - 0.1 * rl, R); if (Math.abs(ln) > 0.005) rig.nudge('spine', _v4.set(hx, 0, hz), ln * 0.85);
    /* hit: the trunk is thrown back and round by the blow, then he folds over the place (0.3 s on) while the knee goes */
    if (sgE > 0) { const fold = sm(clamp((k.stag.t - 0.22) / 0.3, 0, 1)); rig.twist(k.stag.side * 0.55 * sgE, (-sgF * 0.5 * (1 - fold) - 0.38 * fold) * sgE, R); rig.nudge('head', R, (-sgF * (k.stag.head ? 0.5 : 0.25) * (1 - fold) - 0.3 * fold) * sgE); }
    /* the head stays on the man they are after: running, reloading, behind cover */
    rig.face(clamp(tw + (long ? -0.1 : 0), -1.15, 1.15), (ap * 0.8 + 0.06 + 0.3 * low) * (1 - rl) - 0.42 * rl, R, Math.max(a, low, k.see && !sgE ? 0.85 : 0) * 0.9); if (long) rig.nudge('head', F, 0.16 * a);
    if (k.capO) k.capO.update(rig, k.capOn !== false);
    if (k.vestO) { const b = rig.B.chest2 || rig.B.chest; k.vestO.visible = !!(k.heavy && b); if (k.vestO.visible) { const up = rig.pos('neck', _v2).sub(b.getWorldPosition(_v3)).normalize(), fw = _v4.set(Math.cos(k.h + tw * a), 0, -Math.sin(k.h + tw * a)); fw.addScaledVector(up, -fw.dot(up)).normalize(); const rt = _v.crossVectors(fw, up); k.vestO.quaternion.setFromRotationMatrix(_m.makeBasis(fw, up, rt)); k.vestO.position.copy(_v3).addScaledVector(up, 0.02).addScaledVector(fw, 0.015); } }
    { const b = rig.B.chest2 || rig.B.chest, on = !!(b && rig.B.hips && k.beltO); if (k.beltO) k.beltO.visible = on; if (k.badgeO) k.badgeO.visible = on && !k.heavy && !vis.scan;
      if (on) { const cp = b.getWorldPosition(_v3), up = rig.pos('neck', _v2).sub(cp).normalize(), fw = _v4.set(Math.cos(k.h + tw * a), 0, -Math.sin(k.h + tw * a)); fw.addScaledVector(up, -fw.dot(up)).normalize(); const rt = _v.crossVectors(fw, up); _q.setFromRotationMatrix(_m.makeBasis(fw, up, rt));
        k.badgeO.quaternion.copy(_q); k.badgeO.position.copy(cp).addScaledVector(fw, 0.128).addScaledVector(up, 0.075).addScaledVector(rt, -0.085);
        const hp = rig.pos('hips', _v2); k.beltO.position.set(hp.x, hp.y + (vis.scan ? 0.005 : 0.075), hp.z); k.beltO.quaternion.setFromAxisAngle(UP, k.h + tw * a * 0.3); } }
    if (!gun) return; const U_ = gun.userData, neck = rig.pos('neck', new THREE.Vector3());
    R.crossVectors(F, UP).normalize(); U.crossVectors(R, F).normalize();
    const aimPos = new THREE.Vector3().copy(neck); if (!long) aimPos.addScaledVector(R, 0.09).addScaledVector(U, 0.03).addScaledVector(F, 0.52); else if (U_.stock) { rig.pos('upper_arm_R', aimPos); aimPos.addScaledVector(R, -0.04 - U_.stock.z).addScaledVector(U, -0.015 - U_.stock.y).addScaledVector(F, 0.07 - U_.stock.x); } else aimPos.addScaledVector(R, 0.14).addScaledVector(U, -0.11).addScaledVector(F, 0.24);
    const qAim = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(F, U, R)), bf = new THREE.Vector3(hx, 0, hz), br = new THREE.Vector3(Math.sin(k.h), 0, Math.cos(k.h)), cPos = new THREE.Vector3(), cQ = new THREE.Quaternion();
    if (long) { const hips = rig.pos('hips', _v2); /* low or on a knee the carried gun comes up and level: at the standing carry its muzzle went through his leg into the road (round 27) */ cPos.copy(hips).addScaledVector(br, 0.19).addScaledVector(UP, 0.2 + 0.2 * low).addScaledVector(bf, 0.2); const cf = new THREE.Vector3().copy(bf).multiplyScalar(0.74).addScaledVector(br, -0.42).addScaledVector(UP, -0.52 * (1 - 0.95 * low)).normalize(), cr = new THREE.Vector3().crossVectors(cf, UP).normalize(), cu = new THREE.Vector3().crossVectors(cr, cf); cQ.setFromRotationMatrix(_m.makeBasis(cf, cu, cr)); }
    else { const hf = new THREE.Vector3(), hn = new THREE.Vector3(), wp = rig.handFrame('R', hf, hn), gx0 = new THREE.Vector3().copy(hf).applyAxisAngle(hn, 0.26), gy0 = new THREE.Vector3().crossVectors(hn, gx0).normalize(); cQ.setFromRotationMatrix(_m.makeBasis(gx0, gy0, hn)); cPos.copy(wp).addScaledVector(hf, 0.082).addScaledVector(hn, -0.028); }
    gun.visible = true; gun.position.copy(cPos).lerp(aimPos, a); gun.quaternion.copy(cQ).slerp(qAim, a);
    /* changing the magazine: the gun comes back in front of the chest, muzzle up, the eyes go down to it; the left hand goes to the belt for the new one and brings it up to the grip */
    if (rl > 0) { gun.position.lerp(_v2.copy(neck).addScaledVector(F, 0.3).addScaledVector(U, -0.2).addScaledVector(R, 0.08), rl); gun.quaternion.slerp(_q.setFromAxisAngle(R, long ? 0.45 : 0.8).multiply(qAim), rl); }
    /* each round kicks: the gun back into the hands and the muzzle up, the arms take it over three or four frames (it was a 5 cm twitch gone in one: 'no recoil', round 13) */
    gun.position.addScaledVector(_v2.set(1, 0, 0).applyQuaternion(gun.quaternion), -0.085 * k.back).addScaledVector(U, 0.05 * k.rise); gun.rotateZ(0.36 * k.rise * (long ? 0.3 : 1)); gun.updateMatrixWorld(true);
    const gx = new THREE.Vector3(1, 0, 0).applyQuaternion(gun.quaternion), gy = new THREE.Vector3(0, 1, 0).applyQuaternion(gun.quaternion), gz = new THREE.Vector3(0, 0, 1).applyQuaternion(gun.quaternion);
    const wR = long ? 1 : Math.max(a, rl), fR = new THREE.Vector3().copy(gx).multiplyScalar(0.965).addScaledVector(gy, -0.26).normalize(), wristR = new THREE.Vector3().copy(gun.position).addScaledVector(fR, -0.082).addScaledVector(gz, 0.028);
    rig.arm('R', wristR, _v.copy(UP).multiplyScalar(-0.9).addScaledVector(R, long ? 0.6 : 0.22).addScaledVector(F, -0.2), wR); rig.handDir('R', fR, gz, wR); rig.curl('R', 1, true);
    const sup = new THREE.Vector3().copy(U_.support); if (long && U_.stock && k.gunK !== 'shotgun') sup.x = Math.min(sup.x, U_.stock.x + 0.47); sup.applyMatrix4(gun.matrixWorld);
    let fL, nL; if (long) { fL = new THREE.Vector3().copy(gx).multiplyScalar(0.8).addScaledVector(gz, 0.55).addScaledVector(gy, 0.12).normalize(); nL = new THREE.Vector3().copy(gy).multiplyScalar(0.85).addScaledVector(gz, 0.5).normalize(); } else { fL = new THREE.Vector3().copy(gx).multiplyScalar(0.72).addScaledVector(gy, -0.6).addScaledVector(gz, 0.2).normalize(); nL = new THREE.Vector3().copy(gz).multiplyScalar(0.9).addScaledVector(gy, 0.35).normalize(); }
    const wristL = new THREE.Vector3().copy(sup).addScaledVector(fL, -0.075).addScaledVector(nL, -0.03), wL = long ? 1 : Math.max(a, rl);
    if (rl > 0) { /* to the pouch on the left hip and back up under the grip */ const u = (2.1 - k.relT) / 2.1, toBelt = sm(clamp((u - 0.1) / 0.14, 0, 1)) * (1 - sm(clamp((u - 0.42) / 0.16, 0, 1))), hp = rig.pos('hips', _v2); _v3.copy(hp).addScaledVector(br, -0.2).addScaledVector(UP, 0.04).addScaledVector(bf, 0.07); _v4.copy(gun.position).addScaledVector(gy, -0.13).addScaledVector(gx, -0.03); wristL.lerp(_v4, rl * (long ? 0.4 : 1)).lerp(_v3, toBelt * rl); }
    rig.arm('L', wristL, _v.copy(UP).multiplyScalar(-0.95).addScaledVector(R, long ? -0.3 : -0.12).addScaledVector(F, -0.1), wL); rig.handDir('L', fL, nL, wL * (1 - 0.6 * rl)); rig.curl('L', (long ? 1 : 0.8) * wL);
    /* hit: the left hand comes off the gun to the place (chest, gut, thigh) and stays there while he is bent over it */
    if (sgE > 0.02 && k.stag) { const hp = rig.pos('hips', _v2), cb = rig.B.chest2 || rig.B.chest, hz2 = k.stag.hz, wp = _v3; if (k.stag.legs || !cb) wp.copy(rig.pos('thigh_' + (k.stag.side > 0 ? 'R' : 'L'), _v4)).addScaledVector(UP, -0.16).addScaledVector(bf, 0.1); else { cb.getWorldPosition(wp); wp.lerp(hp, clamp((1.3 - hz2) / 0.4, 0, 0.8)).addScaledVector(bf, 0.15).addScaledVector(br, k.stag.side * 0.05); }
      const w2 = sm(clamp((k.stag.t - 0.08) / 0.2, 0, 1)) * sgE; rig.arm('L', wp, _v.copy(UP).multiplyScalar(-0.7).addScaledVector(br, -0.7), w2); rig.handDir('L', _v4.copy(br).addScaledVector(UP, 0.25).normalize(), _v2.copy(bf).multiplyScalar(-1), w2 * 0.8); rig.curl('L', 0.25); }
  }

  // ------------------------------------------------------------------ HUD: heat, health, where it hurts from, the map, the words
  hud() {
    const g = this.g, H = g.hud, c = H.ctx, k = H.k, W = H.w / k, Ht = 1080, pl = g.player, cb = this.c; if (!c || this.idle) return;
    c.setTransform(k, 0, 0, k, 0, 0); c.shadowBlur = 0; c.globalAlpha = 1; const fly = g.fly && g.fly.on, AMB = '#ffb82e', RED = '#ff5340';
    /* hurt: a red breath at the edges, deeper when badly hurt; arcs toward what hit */
    const hp = clamp(cb.health, 0, 100), lowK = hp < 35 && !this.dead ? (0.25 + 0.2 * Math.sin(this.t * 5)) * (1 - hp / 35) : 0, vg = Math.max(this.hurtT * 0.3, lowK);
    if (this.level > 0 && !fly) c.clearRect(0, 0, 640, 128);
    if ((this.level > 0 || (this.dead && !this.dead.woke)) && !fly) c.clearRect(W / 2 - 480, Ht - 160, 960, 110);
    if (this.hurtT > 0.05 && !fly) for (const q of this.inds) { const rel = wrapPi(q.a - g.cam.yaw), sa = -Math.PI / 2 - rel, ux = Math.cos(sa), uy = Math.sin(sa), al = clamp((q.t - 0.85) / 0.45, 0, 1) * 0.062 /* was 0.1, then 0.035 ('no vignette', rounds 19, 20): over a white sky it read as 'a pink wash over the whole frame' (rounds 15, 16); the bar at the edge says where it came from */, ex2 = W / 2 + ux * W * 0.62, ey2 = Ht / 2 + uy * Ht * 0.72, gr = c.createRadialGradient(ex2, ey2, 0, ex2, ey2, Ht * 0.36); if (al <= 0) continue; gr.addColorStop(0, 'rgba(190,10,6,' + al.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(190,10,6,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, Ht); }
    /* each hit: the edges of the picture go dark red all round and clear again in half a second ('no vignette or flinch', rounds 19, 20, 25): an ellipse that leaves the middle 70 % of the picture untouched */
    if ((this.vgT || 0) > 0.02 && !fly && !g.P.has('heatvg')) { const e = this.vgT, al = 0.6 * e * (2 - e); c.save(); c.translate(W / 2, Ht / 2); c.scale(W / Ht, 1); const gr = c.createRadialGradient(0, 0, Ht * 0.36, 0, 0, Ht * 0.7); gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(0.55, 'rgba(120,2,0,' + (al * 0.42).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(96,0,0,' + al.toFixed(3) + ')'); c.fillStyle = gr; c.fillRect(-Ht / 2, -Ht / 2, Ht, Ht); c.restore(); }
    if (vg > 0.01 && !fly) { const gr = c.createRadialGradient(W / 2, Ht / 2, Ht * 0.72, W / 2, Ht / 2, Ht * 1.05); gr.addColorStop(0, 'rgba(110,0,0,0)'); gr.addColorStop(1, 'rgba(120,4,2,' + Math.min(0.6, vg * 0.7).toFixed(3) + ')'); /* further out, darker, weaker: at 0.62 of the height and 0.85 it lay over a third of the picture as 'a pink wash' (rounds 15, 16) */ c.fillStyle = gr; c.fillRect(0, 0, W, Ht); }
    /* where the fire comes from: a short red bar out at the edge of the screen, on an ellipse 44 px inside it (it sat on a 200 px circle round the centre and read as 'a red arc floating over the skyline', rounds 12-14) */
    for (const q of this.inds) { const rel = wrapPi(q.a - g.cam.yaw), sa = -Math.PI / 2 - rel, al = clamp(q.t / 0.5, 0, 1) * clamp((Math.abs(rel) - 0.5) / 0.25, 0, 1) /* not for a shooter who is in the picture anyway: at the top edge over the skyline the bar was still 'a red marker floating in the sky' (rounds 17, 18); it shows for fire from the sides and from behind */, rx = W / 2 - 44, ry = Ht / 2 - 44, hw = 0.13 * (Ht / 2) / Math.hypot(Math.cos(sa) * ry, Math.sin(sa) * rx) * 1.0, P = (a, kx) => [W / 2 + Math.cos(a) * rx * kx, Ht / 2 + Math.sin(a) * ry * kx], path = () => { c.beginPath(); for (let n = 0; n <= 12; n++) { const pt = P(sa - hw + 2 * hw * n / 12, 1); if (n) c.lineTo(pt[0], pt[1]); else c.moveTo(pt[0], pt[1]); } };
      c.globalAlpha = al; c.lineCap = 'round'; c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 12; path(); c.stroke(); c.strokeStyle = RED; c.lineWidth = 7; path(); c.stroke();
      { const t0 = P(sa, 1.04), t1 = P(sa - hw * 0.3, 1.008), t2 = P(sa + hw * 0.3, 1.008); c.fillStyle = RED; c.beginPath(); c.moveTo(t0[0], t0[1]); c.lineTo(t1[0], t1[1]); c.lineTo(t2[0], t2[1]); c.closePath(); c.fill(); } c.globalAlpha = 1; c.lineCap = 'butt'; }
    if (!fly) {
      /* health, bottom left above the street name: ten blocks */
      if (hp < 100 || this.level > 0 || this.dead) { const x = 36, y = Ht - (pl.vehicle ? 132 : 78) - 50, low = hp < 35; H.panel(x, y, 232, 40); c.fillStyle = low ? RED : AMB; c.fillRect(x, y, 5, 40); H.text('BODY', x + 22, y + 26, 12, 'rgba(255,255,255,0.72)', 'left', 700, 2);
        for (let i = 0; i < 10; i++) { const f = i === 0 && hp > 0 && !this.dead ? 1 : clamp(hp / 10 - i, 0, 1); c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(x + 78 + i * 14.4, y + 14, 11.4, 13); if (f > 0) { c.fillStyle = low ? RED : this.hurtT > 0.3 ? '#fff' : '#f2f2ee'; c.fillRect(x + 78 + i * 14.4, y + 14, 11.4 * f, 13); } } }
      /* heat, top right beside the cash: five rising bars; red while they have eyes on you, amber and draining while they search */
      if (this.level > 0 || this.pulse > 0) { const x = W - 216 - 12 - 262, y = 34, L = this.level, seen = this.seen, col = seen ? RED : AMB, pu = this.pulse; H.panel(x, y, 262, 52); c.fillStyle = col; c.fillRect(x, y, 5, 52);
        H.text('HEAT', x + 20, y + 22, 12, 'rgba(255,255,255,0.72)', 'left', 700, 2.5); H.text(L ? (seen ? (L >= 3 ? 'UNITS ON YOU' : 'EYES ON YOU') : this.swapK ? 'COLD TRAIL' : 'SEARCHING') : 'CLEAR', x + 20, y + 40, 12, L ? col : 'rgba(255,255,255,0.7)', 'left', 800, 1.5);
        for (let i = 0; i < 5; i++) { const bh = 14 + i * 5.5, bx = x + 162 + i * 18, by = y + 44 - bh, on = i < L, blink = on && seen && Math.floor(this.t * 4) % 2 === 0 && i === L - 1; c.fillStyle = on ? (blink ? '#fff' : col) : 'rgba(255,255,255,0.16)'; c.beginPath(); c.moveTo(bx + 4, by - (on ? pu * 4 : 0)); c.lineTo(bx + 14, by - (on ? pu * 4 : 0)); c.lineTo(bx + 10, y + 44); c.lineTo(bx, y + 44); c.closePath(); c.fill(); }
        if (L && !seen) { const u = clamp(this.coolT / COOL[L], 0, 1); c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 20, y + 46, 120, 3); c.fillStyle = AMB; c.fillRect(x + 20, y + 46, 120 * (1 - u), 3); } }
      this.hudMap(H, c, W, Ht);
      /* what the officers shout */
      if (this.sub && !this.dead) { const a = clamp(Math.min(this.sub.t * 5, (2.6 - this.sub.t) * 2), 0, 1); c.globalAlpha = a; c.font = '600 21px "Helvetica Neue", Helvetica, Arial, sans-serif'; const tw = c.measureText(this.sub.text).width + 86; /* above the guns' key row, which it used to cover */ H.panel(W / 2 - tw / 2, Ht - 256, tw, 38, 5); c.fillStyle = '#7fb2ff'; c.fillRect(W / 2 - tw / 2, Ht - 256, 4, 38); H.text('PD', W / 2 - tw / 2 + 16, Ht - 231, 12, '#7fb2ff', 'left', 800, 1.5); H.text(this.sub.text, W / 2 + 18, Ht - 230, 21, '#fff', 'center', 600); c.globalAlpha = 1; }
    }
    /* down: the picture goes dark, our own words */
    const D = this.dead; if (D && !D.woke && !D.arrest && D.t > 0.7) { const a = clamp((D.t - 0.7) / 0.4, 0, 1); c.globalAlpha = a; c.fillStyle = 'rgba(8,9,10,0.8)'; c.fillRect(0, Ht * 0.38, W, 150); H.text('LIGHTS OUT', W / 2, Ht * 0.38 + 78, 64, '#ff4a3d', 'center', 800, 14); H.text('You went down at heat ' + D.level, W / 2, Ht * 0.38 + 124, 22, '#fff', 'center', 600, 2); c.globalAlpha = 1; }
    if (D && D.arrest && !D.woke) { c.globalAlpha = clamp((D.t - 0.9) / 0.5, 0, 1); c.fillStyle = 'rgba(8,9,10,0.55)'; c.fillRect(0, Ht * 0.38, W, 132); H.text('IN CUFFS', W / 2, Ht * 0.38 + 76, 64, '#7fb2ff', 'center', 800, 14); H.text(this.level >= 1 && D.fromCar ? 'Out of the car' : 'You gave yourself up', W / 2, Ht * 0.38 + 112, 22, '#fff', 'center', 600, 2); c.globalAlpha = 1; }
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
