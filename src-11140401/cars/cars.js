// cars.js (progress lane, helper "cars"): the kinds of car drive differently, and damage carries through to a wreck.
// One file, installed by one line at the end of Game.init: `(await import('./cars/cars.js')).install(this)`. Off switch: ?cars=0 (nothing is wrapped).
//
// WHAT IS WRAPPED, all from outside (no other file is edited):
//   Vehicle.prototype.step   the kind's numbers are laid over the base car: see CLASSES. The base car's feel (game.js Vehicle.step and the steering in
//                            readInput) belongs to the gameplay lane and is NOT retuned here: every number below is a multiplier on whatever the base
//                            is (the 'sedan' line of game.js SPEC, read at run time), so it follows when gameplay changes the base. The ordinary car
//                            (class sedan) goes through untouched. Patrol cars (v.patrol) are never touched.
//   game.collideCars         a heavy vehicle loses less speed against another car, a light one a little more.
//   game.nearestCar          a burnt wreck is not offered as a car to take; a stopped bus in traffic is (stand by its front left corner).
//   game.sound.update        engine pitch and tone per kind (the ordinary car keeps the game's own sound).
//   game.step                one pass a step over the cars that are damaged (none: nothing is done).
//   game.combat.crashed / .explode (the gameplay lane's car health, when guns are loaded; found late, by name, and left alone if absent)
//                            crashes can now finish a car that already smokes; the player is thrown out of a car that blows up; the blast shoves loose
//                            cars; the wreck sags on burnt tyres, is crumpled and glassless (through the breakable lane's game.__crash.hit), leaves a
//                            scorch on the road, smokes for a while and is taken away later.
// FOR OTHERS:
//   v.fire (0..1, 0 = not burning), v.wrecked (true for the burnt shell) on any car object (a Vehicle, a traffic car, a parked slot);
//   game.events.on('carfire', (v) => {}) / 'carexplode' (wreck, x, y) / 'carfireout' (v) / 'carwreckgone' (v)   (game.events is made here if nobody made it:
//   on / off / emit); game.cars.fires (the cars burning now), game.cars.extinguish(v) (a fire put out never explodes), game.cars.ignite(v),
//   game.cars.classOf(v) -> the class name, game.cars.numbers() -> measured handling numbers per class.
import * as THREE from 'three';
import { Vehicle } from '../game.js';

// Per class, all relative to the base car (1 = as the base):
//   top, acc, grip  the three numbers of game.js SPEC            brake  how hard the brake pedal bites (base 15 m/s2)
//   lock            how much of the base's steering angle a full key press gets (so lateral g), turn: how fast the wheel follows (per second, 0 = as base)
//   thr             how fast the engine answers the pedal (per second, 0 = at once); launch: the share of its pull a heavy one has from rest (all of it by 12 m/s)
//   roll, pitch     body lean in a corner and dive under brakes, sway: how fast the body follows (per second)
//   k, c, kerb      springs: stiffness, damping and the kick a kerb gives (metres a second); kshake: how much of it reaches the camera
//   bump            how much of a car-to-car collision's speed change this one takes (mass)
//   snd             engine: [pitch, brightness, loudness]
export const CLASSES = {
  sedan:  { plain: true, top: 1, acc: 1, grip: 1, brake: 1, lock: 1, turn: 0, thr: 0, roll: 1, pitch: 1, sway: 6, k: 0, c: 0, kerb: 0, kshake: 0, bump: 1, snd: [1, 1, 1] },
  taxi:   { top: 0.97, acc: 0.97, grip: 0.96, brake: 0.95, lock: 1.0, turn: 0, thr: 0, roll: 1.45, pitch: 1.5, sway: 4.5, k: 55, c: 5.5, kerb: 0.5, kshake: 0.04, bump: 0.97, snd: [0.94, 0.9, 1] },
  hatch:  { top: 0.95, acc: 0.98, grip: 1.02, brake: 1.02, lock: 1.07, turn: 0, thr: 0, roll: 1.1, pitch: 1.15, sway: 7, k: 120, c: 13, kerb: 0.4, kshake: 0.08, bump: 1.1, snd: [1.14, 1.05, 0.95] },
  suv:    { top: 0.95, acc: 0.92, grip: 0.9, brake: 0.9, lock: 0.95, turn: 15, thr: 12, roll: 1.7, pitch: 1.5, sway: 4, k: 60, c: 6, kerb: 0.45, kshake: 0.02, bump: 0.86, snd: [0.86, 0.85, 1.08] },
  pickup: { top: 0.9, acc: 0.86, grip: 0.85, brake: 0.85, lock: 0.92, turn: 12, thr: 9, roll: 1.7, pitch: 1.7, sway: 4, k: 75, c: 6, kerb: 0.6, kshake: 0.05, bump: 0.82, snd: [0.8, 0.8, 1.12] },
  van:    { launch: 0.8, top: 0.9, acc: 0.76, grip: 0.8, brake: 0.78, lock: 0.85, turn: 10, thr: 6, roll: 2.0, pitch: 1.8, sway: 3.4, k: 70, c: 7, kerb: 0.6, kshake: 0.07, bump: 0.74, snd: [0.76, 0.72, 1.15] },
  truck:  { launch: 0.6, top: 0.86, acc: 0.68, grip: 0.74, brake: 0.66, lock: 0.78, turn: 8, thr: 4, roll: 2.2, pitch: 2.0, sway: 2.8, k: 90, c: 8, kerb: 0.7, kshake: 0.12, bump: 0.6, snd: [0.62, 0.6, 1.3] },
  bus:    { launch: 0.5, top: 0.86, acc: 0.64, grip: 0.7, brake: 0.6, lock: 0.72, turn: 5.5, thr: 3, roll: 2.1, pitch: 1.7, sway: 2.4, k: 50, c: 6, kerb: 0.55, kshake: 0.08, bump: 0.5, snd: [0.54, 0.5, 1.4] },
  sport:  { top: 1.4, acc: 1.55, grip: 1.24, brake: 1.2, lock: 1.12, turn: 0, thr: 0, roll: 0.45, pitch: 0.55, sway: 10, k: 240, c: 26, kerb: 0.38, kshake: 0.2, bump: 1.0, snd: [1.38, 1.5, 1.1] },
};
// which class a kind of car belongs to (the streets lane's kinds; anything not listed is sorted by its size)
const KIND_CLASS = {
  sedan: 'sedan', ox_corolla: 'sedan', ox_sedan98: 'sedan', fprius: 'sedan', taxi: 'taxi', ox_cab: 'taxi', taxivan: 'taxi', hatch: 'hatch', ox_hatch: 'hatch', fhatch: 'hatch',
  suv: 'suv', crossover: 'suv', ox_tucson: 'suv', ox_q7: 'suv', ox_duster: 'suv', pickup: 'pickup', fpickup: 'pickup',
  van: 'van', workvan: 'van', ox_sprinter: 'van', ox_ducato: 'van', ox_gvan: 'van', boxtruck: 'truck', stepvan: 'truck', bus: 'bus', sport: 'sport',
};
export function classOfDef(def) {
  const t = def && def.type; if (KIND_CLASS[t]) return KIND_CLASS[t]; if (!def) return 'sedan';
  return def.len > 9 ? 'bus' : def.len > 6.4 ? 'truck' : def.hgt > 1.9 ? 'van' : def.hgt > 1.6 ? 'suv' : def.hgt < 1.3 ? 'sport' : 'sedan';
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _inp = { steer: 0, throttle: 0, brake: 0, handbrake: false, lock: undefined, latLim: 0 };
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export function install(game) {
  if (game.cars && game.cars.__cars) return game.cars;
  const C = (game.cars = { __cars: true, on: true, fires: [], wrecks: [], CLASSES, stats: { fires: 0, blown: 0, gone: 0, crashFires: 0, thrown: 0 } });
  C.classOf = (v) => classOfDef(v && v.def);
  if (game.P && game.P.get('cars') === '0') { C.on = false; return C; }
  // a small event list, made only if nobody made one
  const ev = (game.events ||= { _l: {}, on(n, f) { (this._l[n] ||= []).push(f); return f; }, off(n, f) { const a = this._l[n], i = a ? a.indexOf(f) : -1; if (i >= 0) a.splice(i, 1); }, emit(n, a, b, c) { const l = this._l[n]; if (l) for (let i = 0; i < l.length; i++) { try { l[i](a, b, c); } catch (e) { console.warn('[events] ' + n + ': ' + (e && e.message)); } } } });
  const emit = (n, a, b, c) => { try { if (typeof ev.emit === 'function') ev.emit(n, a, b, c); } catch (e) {} };
  let fails = 0; const fail = (e) => { if (fails++ < 3) console.warn('[cars] ' + String((e && e.stack) || e).slice(0, 400)); };
  const base = new Vehicle({ type: 'sedan' }, 0, 0, 0, 0).spec;      // the base car's numbers, whatever they are today
  const noH = game.P && game.P.get('carhandling') === '0', noD = game.P && game.P.get('cardamage') === '0';

  // ---------------------------------------------------------------- one car's own state
  function adopt(v) {
    const name = C.classOf(v), H = CLASSES[name] || CLASSES.sedan;
    const K = (v._ck = { name, H, spec: { top: base.top * H.top, acc: base.acc * H.acc, grip: base.grip * H.grip }, own: false, br: 0, bp: 0, bz: 0, r: 0, p: 0, h: 0, hv: 0, ks: 0, bz0: 0, lk: 0, th: 0, pow: 1, topK: 1, flats: 0, fr: 0, fp: 0, fz: 0, wr: 0, wp: 0, wt: -1, sink: 0 });
    return K;
  }
  // what the damage does to the engine (never to the steering: players disliked a damaged car pulling to one side, and it was taken out on Nov 12)
  function health(v, K) {
    let pow = 1, top = 1, n = 0, fr = 0, fp = 0, fz = 0; const cb = game.combat, S = cb && cb.cars && cb.cars.get(v);
    if (S && !noD) {
      if ((S.fire && !S.wrecked) || S.wrecked) pow = 0;                         // on fire: the engine is dead, the car rolls to a stop
      else if (S.hp < 200) { pow = 0.8; top = 0.75; }                            // black smoke: down on power and top speed
      if (S.flat) for (const k in S.flat) { const u = S.flat[k], e = u * u * (3 - 2 * u); n++; fr += (k[1] === 'l' ? -1 : 1) * 0.034 * e; fp += (k[0] === 'f' ? -1 : 1) * 0.016 * e; fz -= 0.022 * e; }
      if (n) { top *= n === 1 ? 0.3 : 0.18; if (pow) pow *= Math.max(0.5, 1 - 0.15 * n); }      // a flat tyre: about 40 km/h at most; two or more: a crawl
    }
    K.pow = pow; K.topK = top; K.flats = n; K.fr = fr; K.fp = fp; K.fz = fz;
    K.spec.top = base.top * K.H.top * top; K.spec.acc = base.acc * K.H.acc * (pow || 1); K.spec.grip = base.grip * K.H.grip;
  }

  // ---------------------------------------------------------------- driving
  const step0 = Vehicle.prototype.step;
  Vehicle.prototype.step = function (dt, inp, g) {
    if (!C.on || this.patrol || g.cars !== C) return step0.call(this, dt, inp, g);
    const K = this._ck || adopt(this), H = K.H, human = inp.lock !== undefined, wreck = !!this.wreck;
    if (this.spec !== K.spec && !noH) this.spec = K.spec;
    if (!human && !wreck) { K.own = false; K.lk = 0; K.th = 0; return step0.call(this, dt, inp, g); }      // nobody at the wheel, or the autopilot: the game's own step with the kind's three numbers
    health(this, K);
    // the body's lean, dive and height are the base's own, kept apart; what is drawn is laid over them after the step
    if (K.own) { this.roll = K.br; this.pitch = K.bp; this.z = K.bz; } else { K.own = true; K.r = this.roll; K.p = this.pitch; K.h = 0; K.hv = 0; K.bz0 = this.z; K.ks = 0; }
    let q = inp;
    if (wreck) { q = _inp; q.steer = 0; q.throttle = 0; q.brake = 0; q.handbrake = true; q.lock = undefined; q.latLim = 0; }
    else if ((!H.plain && !noH) || K.pow < 1) {
      q = _inp; q.steer = inp.steer; q.handbrake = inp.handbrake;
      let th = inp.throttle; if (H.thr && !noH) { K.th = th > K.th ? K.th + (th - K.th) * Math.min(1, dt * H.thr) : th; th = K.th; } else K.th = th;
      if (H.launch && !noH && th > 0 && this.vf >= -0.5 && this.vf < 12) th *= H.launch + (1 - H.launch) * Math.max(0, this.vf) / 12;
      q.throttle = K.pow === 0 ? 0 : th;
      if (noH || H.plain) { q.brake = inp.brake; q.lock = inp.lock; q.latLim = inp.latLim; }
      else {
        q.brake = inp.brake * H.brake;
        const want = inp.lock * H.lock; K.lk = H.turn ? K.lk + (want - K.lk) * Math.min(1, dt * H.turn) : want; q.lock = K.lk;
        q.latLim = (inp.latLim || 11) * Math.max(1, H.lock);
      }
    } else K.th = inp.throttle;
    step0.call(this, dt, q, g);
    if (K.flats && Math.abs(this.vf) > K.spec.top) { const k = 1 - Math.min(0.5, 0.9 * dt); this.vx *= k; this.vy *= k; }      // a flat tyre drags the car down to its new top speed
    K.br = this.roll; K.bp = this.pitch; K.bz = this.z;
    if (wreck) { if (K.sink < 1) K.sink = Math.min(1, K.sink + dt * 1.5); this.roll = K.br + K.wr * K.sink; this.pitch = K.bp + K.wp * K.sink; this.z = K.bz - 0.09 * K.sink; return; }
    if (H.plain || noH) { if (K.flats) { this.roll = K.br + K.fr; this.pitch = K.bp + K.fp; this.z = K.bz + K.fz; } return; }
    // a kerb: the base lifts the car onto the sidewalk; the springs answer by kind
    const dz = K.bz - K.bz0; K.bz0 = K.bz; const ks = dz > 0.0015 ? 1 : dz < -0.0015 ? -1 : 0;
    if (ks && ks !== K.ks && H.kerb) { const sp = clamp(Math.abs(this.vf) / 7, 0.25, 1.6); K.hv += ks * H.kerb * sp; if (H.kshake && this === g.player.vehicle) { g.cam.shake = Math.min(1, g.cam.shake + H.kshake * sp); if (sp > 0.6 && g.sound && g.sound.thud && H.kshake > 0.06) g.sound.thud(); } }
    if (ks || Math.abs(dz) < 1e-5) K.ks = ks;
    if (H.k) { const n = dt > 0.012 ? 2 : 1, hh = dt / n; for (let i = 0; i < n; i++) { K.hv += (-H.k * K.h - H.c * K.hv) * hh; K.h += K.hv * hh; } if (Math.abs(K.h) < 1e-4 && Math.abs(K.hv) < 1e-3) K.h = K.hv = 0; }
    const sw = Math.min(1, dt * H.sway);
    K.r += (K.br * H.roll - K.r) * sw; K.p += (K.bp * H.pitch - K.p) * sw;
    this.roll = K.r + K.fr; this.pitch = K.p + K.fp - K.hv * 0.018; this.z = K.bz + K.h + K.fz;
  };

  // mass: how much of a car-to-car blow this one takes
  const collide0 = game.collideCars.bind(game);
  game.collideCars = function (v, dt) {
    const K = v._ck; if (!C.on || noH || !K || K.H.bump === 1 || v.patrol) return collide0(v, dt);
    const vx = v.vx, vy = v.vy; collide0(v, dt); const dx = v.vx - vx, dy = v.vy - vy;
    if (dx * dx + dy * dy > 0.04) { v.vx = vx + dx * K.H.bump; v.vy = vy + dy * K.H.bump; }
  };

  // a wreck is no car to take; a stopped bus is one (the game leaves buses out because their middle is 6 m from the door)
  const near0 = game.nearestCar.bind(game);
  game.nearestCar = function (maxD) {
    let b = near0(maxD); if (!C.on) return b;
    if (b && b.kind === 'veh' && b.v.wreck) { const hid = []; while (b && b.kind === 'veh' && b.v.wreck) { b.v.x += 1e5; hid.push(b.v); b = near0(maxD); } for (const w of hid) w.x -= 1e5; }
    if (!b && game.P.get('bus') !== '0') { const pl = game.player; let bd = 3.2; for (const c of game.traffic.cars) { if (c.type !== 'bus' || c.v > 2.5 || Math.abs(c.x - pl.x) > 12 || Math.abs(c.y - pl.y) > 12) continue;
      const cs = Math.cos(c.h), sn = Math.sin(c.h), f = c.def.len * 0.4, o = c.def.wid * 0.5 + 0.5, d = Math.hypot(c.x + cs * f - sn * o - pl.x, c.y + sn * f + cs * o - pl.y); if (d < bd) { bd = d; b = { kind: 'traffic', c }; } } }
    return b;
  };

  // engine note per kind (audio.js makes one engine for every car: its pitch, filter and level are set again here for kinds other than the ordinary car)
  const snd = game.sound;
  if (snd && typeof snd.update === 'function' && !noH) { const up0 = snd.update.bind(snd); snd.update = function (dt) {
    up0(dt); if (!C.on || !snd.on || !snd.ac || !snd.o1) return; const v = game.player.vehicle, K = v && v._ck; if (!K || (K.H.plain && K.pow === 1)) return;
    try { const now = snd.ac.currentTime, sp = Math.abs(v.vf), top = Math.max(1, v.spec.top / (K.topK || 1)), S = K.H.snd, thr = K.pow === 0 ? 0 : K.th;
      let gi = 1, lo = 0, hi = 0.16 * top; if (sp > hi) { gi = 2; lo = hi; hi = 0.3 * top; if (sp > hi) { gi = 3; lo = hi; hi = 0.46 * top; if (sp > hi) { gi = 4; lo = hi; hi = 0.66 * top; if (sp > hi) { gi = 5; lo = hi; hi = 1.01 * top; } } } }
      const r = clamp((sp - lo) / (hi - lo), 0, 1.2), f = (48 + r * 95 + gi * 4) * S[0], cough = K.pow < 1 && K.pow > 0 && ((game.frame * 7) % 23 < 4) ? 0.45 : 1;
      snd.o1.frequency.setTargetAtTime(f, now, 0.05); snd.o2.frequency.setTargetAtTime(f * 0.502, now, 0.05); snd.elp.frequency.setTargetAtTime((350 + r * 900 + thr * 700) * S[1], now, 0.08);
      snd.eg.gain.setTargetAtTime(K.pow === 0 ? 0 : (0.05 + thr * 0.07 + r * 0.02) * S[2] * cough, now, 0.08); } catch (e) { fail(e); }
  }; }

  // ---------------------------------------------------------------- damage: on top of the gameplay lane's car health (game.combat) and the breakable lane's dents (game.__crash)
  let cb = null, hintEl = null, hintT = 0, under = null;
  const hint = (txt) => { try { if (!hintEl) { hintEl = document.createElement('div'); hintEl.id = 'carhint'; hintEl.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:56;pointer-events:none;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(150,24,10,.82);padding:8px 16px;border-radius:8px;transition:opacity .5s'; document.body.appendChild(hintEl); } hintEl.textContent = txt; hintEl.style.opacity = 1; hintT = 5; } catch (e) {} };
  const kindOf = (v) => (v instanceof Vehicle ? 'veh' : v.circles ? 'parked' : 'traffic');
  const burning = (S) => !!(S && S.fire && !S.fire.dead && !(S.fire.t >= S.fire.life));
  C.ignite = (v) => { if (!cb || !v) return false; const S = cb.carState(v, kindOf(v)); if (S.wrecked || S.fire) return false; S.hp = 0; cb.carHurt(v, S, null); return true; };
  C.extinguish = (v) => { const S = cb && cb.cars.get(v); if (!S || !S.fire) return false; S.fire.dead = true; S.burn = 0; if (!S.wrecked) S.hp = Math.max(S.hp, 1); v.fire = 0; S._cf = 2; emit('carfireout', v); if (S.wrecked) linger(v); return true; };      /* (the dead emitter stays in S.fire, so the gameplay code does not light the car again) */
  const linger = (v) => { try { if (cb && cb.fx && cb.fx.emitter) cb.fx.emitter({ pos: (out) => (game.vehicles.includes(v) ? out.set(v.x, 0.9, -v.y) : null), kind: 'smoke', life: 40, rate: 0.45 }); } catch (e) {} };

  // the scorch a burnt car leaves on the road: a few flat dark discs, made on the first explosion
  let scorch = null, scN = 0;
  function scorchAt(x, y, z) {
    if (!scorch) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'), gr = c.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(8,7,6,0.92)'); gr.addColorStop(0.45, 'rgba(10,9,8,0.7)'); gr.addColorStop(0.8, 'rgba(14,12,10,0.25)'); gr.addColorStop(1, 'rgba(14,12,10,0)'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv), geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2); scorch = [];
      for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); m.visible = false; m.renderOrder = 2; m.name = 'cars_scorch'; m.userData.t = 0; game.world.scene.add(m); scorch.push(m); } }
    const m = scorch[scN++ % scorch.length]; m.position.set(x, z + 0.035, -y); m.scale.set(7.5, 1, 7.5); m.rotation.y = Math.random() * 6.28; m.material.opacity = 1; m.userData.t = 150; m.visible = true;
  }

  function bind(c) {
    cb = c; C.combat = true;
    // crashes: the gameplay code never lets a crash take a car under 130 health, so no crash sets it alight. A car that is already down there
    // (black smoke) and is crashed again now goes: the squares of the closing speeds (m/s) of blows over 6 m/s are added up, and past 260 it lights
    // (one blow at 60 km/h, two at 45, four at 30; a smoking car is down on power, so the bar is low).
    const crashed0 = c.crashed.bind(c);
    c.crashed = function (v, force) {
      const S0 = c.cars.get(v), low = !!S0 && S0.hp <= 131 && S0.hp > 0 && !S0.wrecked && !S0.fire; crashed0(v, force);
      if (low && force >= 6 && !v.patrol) { S0._hard = (S0._hard || 0) + force * force; if (S0._hard > 260) { S0.hp = 0; c.carHurt(v, S0, null); C.stats.crashFires++; } }
    };
    const explode0 = c.explode.bind(c);
    c.explode = function (v, S) {
      const pl = game.player, mine = pl.vehicle === v, h0 = c.health, x = v.x, y = v.y, onWalk = game.statics.onSidewalk(x, y) ? 0.15 : 0;
      explode0(v, S);
      try {
        let w = v.wreck ? v : null; if (!w) for (let i = game.vehicles.length - 1; i >= 0; i--) { const q = game.vehicles[i]; if (q.wreck && Math.abs(q.x - x) < 0.5 && Math.abs(q.y - y) < 0.5) { w = q; break; } }
        if (v !== w) { v.fire = 0; v.wrecked = true; }
        C.stats.blown++;
        if (w) { const K = w._ck || adopt(w); K.wr = (Math.random() - 0.5) * 0.09; K.wp = (Math.random() - 0.5) * 0.05; K.wt = 0.3; K.sink = 0; w.wrecked = true; w.fire = 1; C.wrecks.push(w); w._wage = 0; }
        scorchAt(x, y, onWalk);
        // the blast shoves the loose cars round it (the gameplay code hurts them; people are thrown there too)
        for (const o of game.vehicles) { if (o === w || o.patrol) continue; const dx = o.x - x, dy = o.y - y, d = Math.hypot(dx, dy); if (d > 10 || d < 0.01) continue; const k = 7 * (1 - d / 10) * (o._ck ? o._ck.H.bump : 1); o.vx += (dx / d) * k; o.vy += (dy / d) * k; if (o._ck) o._ck.hv += 1.2 * (1 - d / 10); }
        if (mine && w) under = { w, h0, n: 2 };      // still at the wheel when it went up: see poll()
        emit('carexplode', w || v, x, y);
      } catch (e) { fail(e); }
    };
  }
  const each = (S, v) => {
    if (S.dead) return; const f = burning(S);
    if (f && !S._cf) { S._cf = 1; C.stats.fires++; if (!S.wrecked) { if (v === game.player.vehicle) { S.burn = Math.max(S.burn || 0, 6.5); hint('Engine on fire. Stop and get out (F)'); } S._b0 = Math.max(0.1, S.burn || 0.1); emit('carfire', v); } }
    if (f) { v.fire = S.wrecked ? Math.max(0.05, 1 - S.fire.t / S.fire.life) : 0.3 + 0.7 * clamp(1 - (S.burn || 0) / (S._b0 || 1), 0, 1); C.fires.push(v); }
    else { if (v.fire) v.fire = 0; if (S._cf === 1) { S._cf = 2; emit('carfireout', v); if (S.wrecked) linger(v); } }
    if (S.wrecked && !v.wrecked) v.wrecked = true;
  };
  function poll(dt) {
    if (!cb) { const c = game.combat; if (c && c.cars && typeof c.explode === 'function' && typeof c.crashed === 'function' && typeof c.carHurt === 'function' && typeof c.carState === 'function') bind(c); else return; }
    // the player was at the wheel of a car that blew up. The police code (combat/heatcore.js, loaded on the first crime) throws him out and takes 45 health
    // itself, in its own wrap of explode; where it is not loaded, or did not act, the same is done here a step later (never both: his health is looked at first).
    if (under && --under.n <= 0) { const u = under, pl = game.player; under = null; if (pl.vehicle === u.w) { try { game.exitVehicle(); } catch (e) {} if (typeof cb.hurt === 'function' && typeof cb.health === 'number' && cb.health >= u.h0 - 1) cb.hurt(Math.min(45, Math.max(0, u.h0 - 15))); C.stats.thrown++; } }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0 && hintEl) hintEl.style.opacity = 0; }
    if (C.fires.length) C.fires.length = 0;
    if (cb.cars.size) cb.cars.forEach(each);
    if (scorch) for (const m of scorch) if (m.visible) { m.userData.t -= dt; if (m.userData.t < 20) m.material.opacity = Math.max(0, m.userData.t / 20); if (m.userData.t <= 0) m.visible = false; }
    const W = C.wrecks; if (!W.length) return; const pl = game.player;
    for (let i = W.length - 1; i >= 0; i--) { const w = W[i], K = w._ck; w._wage += dt;
      if (!game.vehicles.includes(w)) { W.splice(i, 1); gone(w, false); continue; }
      // crumpled and glassless: blows laid on through the breakable lane's own call, once the shell has landed
      if (K && K.wt > 0) { K.wt -= dt; if (K.wt <= 0) crumple(w); }
      const d = Math.hypot(w.x - pl.x, w.y - pl.y), busy = pl.vehicle === w || (pl.busy && pl.busy.v === w);
      if (!busy && ((w._wage > 70 && d > 80) || (w._wage > 200 && d > 35) || (W.length > 3 && i === 0 && d > 30))) { const j = game.vehicles.indexOf(w); if (j >= 0) game.vehicles.splice(j, 1); W.splice(i, 1); gone(w, true); } }
  }
  function gone(w, took) { try { const S = cb && cb.cars.get(w); if (S && typeof cb.forget === 'function') cb.forget(w, S); if (took && game.__crash && game.__crash.repair) game.__crash.repair(w); } catch (e) { fail(e); } w.fire = 0; C.stats.gone++; emit('carwreckgone', w); }
  function crumple(w) {
    const cr = game.__crash; if (!cr || !cr.on || typeof cr.hit !== 'function') return; const cs = Math.cos(w.h), sn = Math.sin(w.h), L = w.def.len, Wd = w.def.wid, hg = w.def.hgt, z = (w.z || 0);
    const at = (f, s, up) => _v.set(w.x + cs * f - sn * s, z + up, -(w.y + sn * f + cs * s)), dir = (f, s, up) => _d.set(cs * f - sn * s, up, -(sn * f + cs * s)).normalize();
    try {
      cr.hit(w, at(0, Wd * 0.5, hg * 0.72), dir(0, -1, 0), 9, { depth: 0.11, radius: L * 0.5 });      // each side at window height: the glass goes
      cr.hit(w, at(0, -Wd * 0.5, hg * 0.72), dir(0, 1, 0), 9, { depth: 0.11, radius: L * 0.5 });
      cr.hit(w, at(L * 0.5, 0, hg * 0.7), dir(-1, 0, 0), 9, { depth: 0.14, radius: Wd * 0.6 });
      cr.hit(w, at(-L * 0.5, 0, hg * 0.7), dir(1, 0, 0), 9, { depth: 0.12, radius: Wd * 0.6 });
      cr.hit(w, at(L * 0.3, 0, hg * 0.62), dir(0, 0, -1), 9, { depth: 0.1, radius: 0.9 });      // the hood buckles
    } catch (e) { fail(e); }
  }
  if (!noD) { const gstep = game.step.bind(game); game.step = function (dt) { gstep(dt); if (C.on) { try { poll(dt); } catch (e) { fail(e); } } }; }

  // ---------------------------------------------------------------- the numbers (README): each class driven on an empty flat plane with the game's own step and steering
  C.numbers = (opts = {}) => {
    const DT = 1 / 60, MPH = 2.23694, out = {}, kit = game.kit.cars, rep = { sedan: 'sedan', taxi: 'taxi', hatch: 'hatch', suv: 'suv', pickup: 'pickup', van: 'van', truck: 'boxtruck', bus: 'bus', sport: 'sport' };
    const g2 = Object.create(game); g2.statics = { onSidewalk: () => false, resolve: () => false, onRoadFast: true }; g2.onCrash = () => {}; g2.cam = { shake: 0 }; g2.sound = null;
    const pl = game.player, keep = { v: pl.vehicle, keys: game.keys, ss: game._sSteer, demo: game.demo }; const I = game.input, keepI = Object.assign({}, I);
    const steerRule = (v, key) => {      // the game's own readInput with the key held (so whatever gameplay changes there is what is measured); if it cannot run here, the rule as it stood on Nov 14
      if (!opts.copy) { try { game.keys = key ? new Set([key]) : new Set(); pl.vehicle = v; game.readInput(); if (I.lock !== undefined) return; } catch (e) {} }
      const vf = Math.abs(v.vf || 0), wb = v.def.wheelbase || 2.7, aLat = vf < 9 ? 20 : vf > 20 ? 10.5 : 20 - 9.5 * (vf - 9) / 11; v._sm = clamp((v._sm || 0) + clamp((key ? 1 : 0) - (v._sm || 0), -30 * DT, 20 * DT), 0, 1); I.lock = v._sm * Math.min(0.70, Math.atan(aLat * wb / Math.max(vf * vf, 6))); I.latLim = aLat + 1.5; I.steer = key ? 1 : 0; I.handbrake = false;
    };
    try {
      game.demo = false;
      for (const cn in rep) { const def = kit[rep[cn]]; if (!def) continue; const mk = () => new Vehicle(def, 0, 0, 0, 0), run = (v, thr, brk, key) => { steerRule(v, key); I.throttle = thr; I.brake = brk; I.handbrake = false; v.step(DT, I, g2); };
        const o = (out[cn] = { kind: rep[cn] });
        let v = mk(), t = 0; game._sSteer = 0; while (t < 90 && v.vf < 26.8224) { run(v, 1, 0, null); t += DT; if (v.vf >= 13.4112 && !o.t30) o.t30 = +t.toFixed(2); if (v.vf >= 20.1168 && !o.t45) o.t45 = +t.toFixed(2); } o.t45 = o.t45 || null; o.t60 = v.vf >= 26.8224 ? +t.toFixed(2) : null;
        while (t < 120) { run(v, 1, 0, null); t += DT; } o.topMph = +(v.vf * MPH).toFixed(1);
        const brake = (v0) => { const b = mk(); b.vx = v0; b.vf = v0; game._sSteer = 0; let n = 0; while (b.vf > 0.05 && n++ < 3000) run(b, 0, 1, null); return +b.x.toFixed(1); };
        o.brake30m = brake(13.4112); o.brake45m = brake(20.1168); o.brake60m = brake(26.8224);
        // a corner: 30 mph held, the key held down for 4 s: steady sideways g, how long the car takes to reach 90 % of it, and the lean
        for (const [nm, v0] of [['30', 13.4112], ['45', 20.1168]]) { const c = mk(); c.vx = v0; c.vf = v0; game._sSteer = 0; let peak = 0, tt = 0, t90 = null, roll = 0; const tr = [];
          for (let i = 0; i < 240; i++) { run(c, c.vf < v0 ? 1 : 0, 0, 'KeyA'); tt += DT; const a = Math.abs(c.vf * c.yawV) / 9.81; tr.push(a); roll = Math.max(roll, Math.abs(c.roll)); }
          const st = tr.slice(-60).reduce((s, a) => s + a, 0) / 60; for (let i = 0; i < tr.length; i++) if (tr[i] >= 0.9 * st) { t90 = +((i + 1) * DT).toFixed(2); break; }
          o['latG' + nm] = +st.toFixed(2); o['turnIn' + nm] = t90; o['rollDeg' + nm] = +(roll * 57.2958).toFixed(1); if (nm === '45' && c.vf < v0 * 0.9) o.latG45 = o.turnIn45 = o.rollDeg45 = null; }
        // under brakes from 30 mph: the dive
        { const b = mk(); b.vx = 13.4112; b.vf = 13.4112; let p = 0; for (let i = 0; i < 60; i++) { run(b, 0, 1, null); p = Math.max(p, Math.abs(b.pitch)); } o.diveDeg = +(p * 57.2958).toFixed(1); }
      }
    } finally { pl.vehicle = keep.v; game.keys = keep.keys; game._sSteer = keep.ss; game.demo = keep.demo; Object.assign(I, keepI); I.lock = keepI.lock; }
    return out;
  };
  return C;
}
