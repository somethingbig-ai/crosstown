// move/jump.js: the player jumps on foot. Space (controller A) on foot: a short crouch, a jump of 1.1 m at the feet that carries forward at the pace he
// was moving, a landing that gives at the knees. He can land and walk on kerbs, car bonnets, boots and roofs, hydrants and low furniture, and steps or
// drops off again; cars, walls and posts stay solid in the air (jumpcore.js has the rules). In a car Space is still the handbrake.
// The game's own code is wrapped from here, never edited: readInput, tryEnter, nearestCar, camTarget, syncVisuals (wrapped at install, so they run INSIDE the
// boarding and gun wrappers: the figure's height and jump pose are in place before the guns pose the arms) and step (wrapped on the first drawn frame,
// so it runs OUTSIDE everything: while he is in the air or up on something, this module alone says where he is).
// Head room, low fences and seats (jumpworld.js): his head stops under what is drawn over him (awnings, signs, sheds, limbs, the rotor), the lawn
// fences and tree guards have a height and can be hopped or stood on, a bench is stood on at its seat. F in the air is kept until he is down; F
// while he stands on a car walks him off its nearer clear side first, then the game's own F runs (the boarding code is not touched).
// On the street, not jumping, nothing here moves the player: walking is the game's own as before.   ?jump=0 off: this file is never fetched.
import * as THREE from 'three';
import { EntryRig } from '../entry/rig.js';
import { JumpCore, TUNE, genericProfile, measureProfile, carQuery, wallResolve } from './jumpcore.js';
import { makeHead, classifySegs, seatTops } from './jumpworld.js';

const T_CROUCH = 0.09, HARD = 8.2, CAM_F = 0.5;      // s of push-off before the feet leave; landing speed (m/s) above which the landing is a hard one (a plain jump lands at 6.3)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }, lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _hp = new THREE.Vector3(), _fl = new THREE.Vector3(), _fr = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _sh = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qL = new THREE.Quaternion(), _qR = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const TOUCH = ['hips', 'spine', 'chest', 'chest2', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R'];

export function install(game) {
  if (game.jump) return game.jump;
  const g = game, pl = g.player, st = g.statics;
  const J = (g.jump = { on: true, core: null, phase: '', ct: 0, buf: 0, land: null, floor: 0, wa: 0, airK: 0, rig: null, saved: null, zs: 0, padA: false, padF: false, fails: 0, stats: null, profiles: new Map(), furn: null, head: null, segs: null, seats: null, fbuf: 0, fgo: null, fcall: false, P: { head: true, low: true, seat: true, fcar: true, deadOff: true } });
  { const Q = g.P; if (Q) { if (Q.get('jhead') === '0') J.P.head = false; if (Q.get('jlow') === '0') J.P.low = false; if (Q.get('jseat') === '0') J.P.seat = false; if (Q.get('jf') === '0') J.P.fcar = false; if (Q.get('jdead') === '0') J.P.deadOff = false; } }      // (?jhead=0 ?jlow=0 ?jseat=0 ?jf=0 ?jdead=0: each of the second round's changes off)
  const fail = (where, e) => { if (J.fails++ < 4) console.warn('[jump] ' + where + ': ' + String((e && e.stack) || e).slice(0, 400)); if (J.fails > 30) { J.on = false; try { J.core.release(); } catch (e2) {} } };
  const kerb = (x, y) => (st.onSidewalk(x, y) ? 0.15 : 0);
  const gameBase = () => pl.alt || kerb(pl.x, pl.y);      // the height the game itself draws him at

  // ---------------------------------------------------------------- the world as the physics sees it
  const profile = (car) => { const def = car.def || {}, key = (car.type || def.type || '?') + '|' + (def.len || 0); let P = J.profiles.get(key); if (P) return P;
    if (def.moto || car.moto) { P = { x0: -(def.len || 2.1) / 2, x1: (def.len || 2.1) / 2, hw: Math.max(0.22, (def.wid || 0.8) / 2 * 0.9), n: 1, top: new Float32Array([Math.min(def.hgt || 0.85, 0.85)]), from: 'moto' }; J.profiles.set(key + (def.hgt || 0), P); return P; }      // a motorcycle (src/moto/, when the lead has it): a low box to its seat; he can stand on it, never in it
    try { const sv = g.streetVehicles, Ty = sv && sv.types && sv.types[car.type || def.type], L = Ty && Ty.lods && Ty.lods[0], arrs = [];
      if (L && L.main && L.main.meshes) for (const m of L.main.meshes) { const a = m.geometry && m.geometry.attributes.position; if (a && a.array && !a.isInterleavedBufferAttribute && a.itemSize === 3) arrs.push(a.array); }
      if (arrs.length) P = measureProfile(arrs, def); } catch (e) { fail('profile', e); }
    if (!P) P = genericProfile(def); J.profiles.set(key, P); return P; };
  const cars = (x, y, out) => { const R = 11;
    for (const c of g.traffic.cars) if (Math.abs(c.x - x) < R && Math.abs(c.y - y) < R) out.push(c);
    for (const c of g.vehicles) if (Math.abs(c.x - x) < R && Math.abs(c.y - y) < R) out.push(c);
    for (const c of g.parked.near(x, y, R, (J._pk ||= []))) out.push(c);
    const hc = g.combat && g.combat.heat && g.combat.heat.cars; if (hc) for (const c of hc) if (c && c.def && Math.abs(c.x - x) < R && Math.abs(c.y - y) < R && out.indexOf(c) < 0) out.push(c);
    const hl = g.heli; if (hl && hl.f && hl.f.onGround && !hl.piloted && !(hl.f.surface > 1) && hl.mapX !== undefined && Math.abs(hl.mapX - x) < 14 && Math.abs(hl.mapY - y) < 14) { const b = (J._heli ||= { def: { len: 11, wid: 1.9, hgt: 3 }, type: 'heli', x: 0, y: 0, h: 0, z: 0 }); b.x = hl.mapX; b.y = hl.mapY; b.h = hl.f.heading; out.push(b); }
    return out; };
  // the helicopter on the street: its body is a wall at every height (nose to tail fin, 1.9 m wide at the cabin, 0.7 m at the boom)
  J.profiles.set('heli|11', { x0: -7.58, x1: 3.35, hw: 0.95, n: 1, top: new Float32Array([1e3]), from: 'heli' });
  // street furniture: the game's circles carry no height, so the height is looked up from the model that stands there (its box, scaled as placed)
  const furnTop = (o) => { try {
    if (!J.furn) { const F = g.streets && g.streets.parts && g.streets.parts.furniture, H = new Map(); J.furn = H; H.n = 0; J.seats = J.P.seat ? seatTops(g) : {};
      if (F && F.kinds) for (const name in F.kinds) { if (/^(sh_|blob|sunsh|st_)/.test(name)) continue; const K = F.kinds[name]; if (!K || !K.list || !K.list.length || !K.parts) continue; let top = 0;
        for (const p of K.parts) { const ge = p && p.geometry; if (!ge) continue; if (!ge.boundingBox) ge.computeBoundingBox(); if (ge.boundingBox && ge.boundingBox.max.y > top) top = ge.boundingBox.max.y; }
        top *= K.scale || 1; if (J.seats[name] > 0.2 && J.seats[name] < top) top = J.seats[name]; if (!(top > 0.2)) continue;
        for (const it of K.list) { const s = it[4] && (typeof it[4].s === 'number' ? it[4].s : Array.isArray(it[4].s) ? it[4].s[1] : 1) || 1, k = Math.floor(it[0] / 4) * 100003 + Math.floor(it[1] / 4); let a = H.get(k); if (!a) H.set(k, (a = [])); a.push(it[0], it[1], (it[2] || 0) + top * s); H.n++; } } }
    let best = 1.3 * 1.3, top = -1; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = J.furn.get((Math.floor(o.x / 4) + i) * 100003 + Math.floor(o.y / 4) + j); if (a) for (let k = 0; k < a.length; k += 3) { const d = (a[k] - o.x) ** 2 + (a[k + 1] - o.y) ** 2; if (d < best) { best = d; top = a[k + 2]; } } }
    return top; } catch (e) { fail('furniture', e); return -1; } };
  const TALL = [1e9, false];
  const circleTop = (o) => { if (o._jt) return o._jt; let r = TALL; const t = o.tag;
    if (o.top > 0 || o.seat > 0) { const top = o.seat > 0 ? o.seat : o.top; return (o._jt = top - kerb(o.x, o.y) <= 1.3 ? [top, o.r >= 0.18] : TALL); }      // <- circles: tags, else the probe below
    if (t === 'hydrant') r = [kerb(o.x, o.y) + 0.75, true];
    else if (t === 'fountain') { let top = 0.55; try { const so = g.heli && g.heli.heights && g.heli.heights.solids; if (so) for (const q of so) if (Math.hypot(q.x - o.x, q.y - o.y) < 1) top = q.top; } catch (e) {} r = [top, true]; }
    else if (t === 'furniture' || t === 'clutter') { const top = furnTop(o); if (top > 0 && top - kerb(o.x, o.y) <= 1.3) r = [top, o.r >= 0.18]; }
    o._jt = r; return r; };
  const roof = (x, y) => { if (!pl.roof || !(pl.alt > 1)) return null; let top = pl.alt, ok = true; try { const H = g.heli && g.heli.heights; if (H) { top = H.top(x, y, 1e4); ok = Math.abs(top - pl.alt) <= 0.7; } } catch (e) {} return { ok, top: ok ? top : pl.alt }; };
  // THE INTERFACE to what the map says about heights (CHIEF 01:07 Nov 14: the lead's layers tag at the source, this file reads the tags):
  //   low walls: seg.low (m above the segment's own ground) on the segments in game.statics, read in jumpcore.js segTop();
  //   overhead:  game.statics.overhead.at(x, y) (src/overhead.js: sheds, canopies, awnings, shop-front boxes, raised building parts, 1.2 to 3.7 m) -> m above
  //              the map's zero of the lowest underside over that point, Infinity: open sky; (or game.statics.ceil(x, y), the whole answer, if ever given);
  //   circles:   circle.top (m above the map's zero) and circle.seat (the same, to stand on) where a layer says so.
  // Until those land, the stand-in behind the same three answers is this lane's probe (jumpworld.js). One line each:
  const tagged = { low: false, ceil: typeof st.ceil === 'function', overhead: !!(st.overhead && st.overhead.at) };      // (overhead: the lead's list, asked first inside jumpworld.js makeHead; the probe answers only for what he tagged nothing for)
  try { for (const a of st.segs.values()) { for (const s of a) if (s.low > 0) { tagged.low = true; break; } if (tagged.low) break; } } catch (e) {}
  try { J.segs = tagged.low ? { from: 'seg.low tags' } : classifySegs(g); } catch (e) { fail('low walls', e); }      // <- low walls: tags, else the probe
  J.tagged = tagged;
  try { J.head = makeHead(g, tagged.ceil ? (x, y) => st.ceil(x, y) : null); } catch (e) { fail('head room', e); }      // <- overhead: statics.ceil, else the probe
  const ceil = J.head ? (x, y) => { try { return pl.roof && pl.alt > 1 ? J.head.heli(x, y) : J.head.ceil(x, y); } catch (e) { fail('ceil', e); return Infinity; } } : null;      // (on a roof only the helicopter's rotor is overhead)
  const _rq = {}, roofSolid = (x, y) => { const hl = g.heli; if (!J.P.head || !hl || !hl.f || !hl.f.onGround || hl.piloted || !(hl.f.surface > 1) || hl.mapX === undefined || Math.abs(hl.mapX - x) > 14 || Math.abs(hl.mapY - y) > 14) return false; const b = (J._heli2 ||= { x: 0, y: 0, h: 0, z: 0 }); b.x = hl.mapX; b.y = hl.mapY; b.h = hl.f.heading; return carQuery(b, J.profiles.get('heli|11'), x, y, TUNE.pad, _rq).inside; };
  const core = (J.core = new JumpCore({ statics: st, base: kerb, cars, profile, circleTop, roof, ceil, roofSolid, lowOn: () => J.P.low, headOn: () => J.P.head }));      // (J.P.head / J.P.low can be switched while the game runs: the lane's before / after films)
  J.stats = core.stats; J.profile = profile; J.carsNear = cars; J.circleTop = circleTop;      // (also read by the lane's own checks)

  // ---------------------------------------------------------------- when a jump may start
  const free = () => { const h = g.heli; return !pl.vehicle && !pl.busy && !(h && (h.piloted || h.busy || h.hasCamera)) && !(g.fly && g.fly.on) && !g.demo; };
  const dead = () => !!(g.combat && g.combat.dead);
  const dying = () => { if (!dead()) return false; try { const D = g.combat.heat && g.combat.heat.dead; return !(D && D.arrest); } catch (e) { return true; } };      // down, not in cuffs
  addEventListener('keydown', (e) => { if (e.code !== 'Space' || e.repeat || !J.on) return; if (free() && !dead() && !g.paused && !window.__startScreen) J.buf = 0.16; });      // one press, one jump; a press up to 0.16 s before landing is kept
  const read0 = g.readInput.bind(g);
  g.readInput = function () { read0(); if (!J.on) return; const I = g.input;
    if (!J.padF) { J.padF = true; let a = false; try { const all = navigator.getGamepads ? navigator.getGamepads() : []; for (const q of all) if (q && q.connected && q.buttons && q.buttons[0] && q.buttons[0].pressed) a = true; } catch (e) {} if (a && !J.padA && free() && !dead()) J.buf = 0.16; J.padA = a; }      // controller A, read once a drawn frame
    const L = J.land; if (L && L.hard && !pl.vehicle) { const k = clamp(0.2 + 0.8 * (L.t - 0.1) / 0.4, 0.2, 1); I.mx *= k; I.my *= k; } };      // a hard landing takes the pace out of the first steps
  const enter0 = g.tryEnter.bind(g); g.tryEnter = function () { if (J.on && (core.own || J.phase === 'crouch')) return false; return enter0(); };      // F waits until he is back on the street
  if (g.heli && g.heli.tryBoard) { const hb0 = g.heli.tryBoard.bind(g.heli); g.heli.tryBoard = function () { if (J.on && (core.own || J.phase === 'crouch')) return false; return hb0(); }; }
  const near0 = g.nearestCar.bind(g); g.nearestCar = function (d) { return J.on && core.own ? null : near0(d); };      // no 'F Get in' prompt while he is in the air or up on something
  const tgt0 = g.camTarget.bind(g); g.camTarget = function () { const t = tgt0(); if (J.on && core.own && !pl.vehicle) { const h = core.z - J.floor, c = g.combat, f = c && c.armedFoot && c.armedFoot() ? lerp(CAM_F, 1, clamp(Math.max(c.zoomT || 0, c.hipZ || 0, c.stance ? 1 : 0), 0, 1)) : CAM_F; t.z += J.floor - gameBase() + Math.max(-0.25, f * (h + (core.grounded ? 0 : core.vz) / 8)); } return t; };
  // (the camera stands on the level he last stood on and takes half of the jump itself (all of it while he aims or fires, so the sights stay on), so the jump is seen and the picture does not pump; the game eases its
  //  height at 8 a second, which alone would trail a 6 m/s rise by 0.8 m: the speed term cancels that lag)

  // ---------------------------------------------------------------- the step: pre and post around everyone else's
  const sound = (kind, v) => { try { const s = g.sound; if (!s || !s.on) return; if (kind === 'off') s.burst(0.05, 0.1, 1300); else { const k = clamp(v / 10, 0.3, 1.2); s.burst(0.07 + 0.05 * k, 0.16 + 0.2 * k, kind === 'car' ? 320 : 520); s.shot(kind === 'car' ? 95 : 72, 0.08 + 0.05 * k, 'sine', 0.14 + 0.16 * k, -28); } } catch (e) {} };
  const wish = { gx: 0, gy: 0, has: false, dx: 0, dy: 0 };
  const readWish = () => { const c = g.combat, I = g.input, stance = !!(c && c.stance), mx = c && c.mx !== undefined ? c.mx : I.mx, my = c && c.my !== undefined ? c.my : I.my, run = c && c.run !== undefined ? c.run : I.run, m = Math.hypot(mx, my);
    wish.gx = wish.gy = 0; wish.has = false;
    if (J.fgo && (!dead() || J.fgo.dead)) { const dx = J.fgo.x - core.x, dy = J.fgo.y - core.y, d = Math.hypot(dx, dy) || 1; wish.dx = dx / d; wish.dy = dy / d; wish.gx = wish.dx * 1.9; wish.gy = wish.dy * 1.9; wish.has = true; return wish; }
    if (!(m > 0.1) || dead()) return wish;
    let a, sp; if (stance) { a = g.cam.yaw + Math.atan2(mx, my); sp = (c.inp && c.inp.aim ? 1.75 : 2.5) * Math.min(1, m); } else { a = pl.h; sp = (run ? 5.4 : 1.9) * Math.min(1, m); }
    wish.dx = Math.cos(a); wish.dy = Math.sin(a); wish.gx = wish.dx * sp; wish.gy = wish.dy * sp; wish.has = true; return wish; };
  const pre = (dt) => {
    J.buf = Math.max(0, J.buf - dt); if (J.land) { J.land.t += dt; if (J.land.t > J.land.dur) J.land = null; }
    if (J.P.head && J.head && !J.head.ready) J.head.work(1.2);      // the sorting of what hangs overhead, a little each step until done
    if (J.fcall) { J.fcall = false; if (!core.own && free() && !dead()) g.input.use = true; }      // the F he pressed up there, now that he is down: the game's own F
    if (J.fbuf > 0) J.fbuf = Math.max(0, J.fbuf - dt);
    if ((core.own || J.phase === 'crouch') && g.input.use && J.P.fcar && !dead()) J.fbuf = 1.5;
    if (core.own) g.input.use = false;
    if (J.buf > 0 && J.phase !== 'crouch' && free() && !dead() && (!core.own || core.grounded)) { J.buf = 0; J.phase = 'crouch'; J.ct = 0; }
  };
  const post = (dt) => {
    if (!free()) { if (core.own) core.release(); J.phase = ''; return; }
    if (core.own && Math.hypot(pl.x - core.x, pl.y - core.y) > 3) { core.release(); J.phase = ''; }      // someone put him somewhere else (a respawn, a job, a test): theirs
    if (J.phase === 'crouch') { J.ct += dt; if (dead()) J.phase = core.own ? 'on' : ''; else if (J.ct >= T_CROUCH) {
      const w = readWish(); if (!core.own) core.take(pl.x, pl.y, gameBase()); J.floor = core.z;
      const k = Math.hypot(w.gx, w.gy) > 3 ? 1.06 : 1; core.launch(w.gx * k, w.gy * k); J.phase = 'air'; sound('off'); } }
    if (!dead()) J.deadOff = false;
    if (!core.own) { J.fgo = null; if (J.fbuf > 0 && J.phase !== 'crouch') { J.fbuf = 0; J.fcall = !dead(); } return; }
    // F while he stands on a car: off its nearer clear side at a walk, then the game's own F (above, once he is on the street)
    if (J.fgo) { J.fgo.t += dt; const c = J.fgo.car, cs = Math.cos(c.h), sn = Math.sin(c.h); J.fgo.x = c.x + cs * J.fgo.lx - sn * J.fgo.ly; J.fgo.y = c.y + sn * J.fgo.lx + cs * J.fgo.ly; if (J.fgo.t > 2.2 || (dead() && !J.fgo.dead) || J.phase === 'crouch') { J.fgo = null; J.fbuf = 0; } }
    // shot dead while he stands on a car: the body is drawn lying at street level (the police code's), so he goes off the car's nearer clear side first
    // and does not lie inside it. (In cuffs he stays standing where he is.)
    else if (J.P.deadOff && dying() && !J.deadOff && core.grounded && core.sup && core.sup.car) { J.deadOff = true; J.fbuf = 0; const go = stepOff(core.sup.car); if (go) { go.dead = true; J.fgo = go; } }
    else if (J.fbuf > 0 && core.grounded && core.sup && core.sup.car && J.phase !== 'crouch') { const go = stepOff(core.sup.car); if (go) { J.fgo = go; J.fbuf = 2.4; } else J.fbuf = 0; }
    core.step(dt, readWish());
    if (J.fgo) { const a = Math.atan2(J.fgo.y - core.y, J.fgo.x - core.x); let d = a - pl.h; d = Math.atan2(Math.sin(d), Math.cos(d)); pl.h += d * Math.min(1, dt * 10); }
    pl.x = core.x; pl.y = core.y; if (core.dh) pl.h += core.dh; g.focus.x = pl.x; g.focus.y = pl.y; J.floor = core.grounded ? core.z : Math.min(J.floor, core.z);
    if (core.landed) { const v = core.landV, hard = v > HARD; J.land = { t: 0, v, hard, depth: clamp(0.034 * v, 0.1, 0.46), dur: hard ? 0.62 : 0.36 }; sound(core.sup && core.sup.car ? 'car' : 'ground', v); }
    if (J.phase !== 'crouch') J.phase = !core.own ? '' : core.grounded ? 'on' : 'air';
  };
  // where to step off a car: beside it, level with where he stands, on the side that is nearer and clear (no wall, no other car, room overhead)
  const stepOff = (car) => { try { if (car.type === 'heli' || Math.abs(car.v || 0) > 1.5 || Math.hypot(car.vx || 0, car.vy || 0) > 1.5) return null; const P = profile(car), cs = Math.cos(car.h), sn = Math.sin(car.h), dx = core.x - car.x, dy = core.y - car.y, lx = clamp(dx * cs + dy * sn, P.x0 + 0.3, P.x1 - 0.3), ly = -dx * sn + dy * cs, near = [], _o = {}, _q = {};
      for (const sg of ly >= 0 ? [1, -1] : [-1, 1]) near.push([lx, sg * (P.hw + TUNE.pad + 0.5)]); near.push([P.x1 + TUNE.pad + 0.5, clamp(ly, -P.hw + 0.2, P.hw - 0.2)], [P.x0 - TUNE.pad - 0.5, clamp(ly, -P.hw + 0.2, P.hw - 0.2)]);
      for (const [ax, ay] of near) { const x = car.x + cs * ax - sn * ay, y = car.y + sn * ax + cs * ay, z = kerb(x, y); if (wallResolve(st, x, y, TUNE.wall + 0.05, z, 0, _o)) continue; if (st.raycast(core.x, core.y, x, y) < 1) continue; if (ceil && z + TUNE.head > ceil(x, y)) continue;
        let hit = false; for (const c2 of cars(x, y, [])) if (c2 !== car && carQuery(c2, profile(c2), x, y, TUNE.pad, _q).inside) hit = true; if (hit) continue;
        return { car, lx: ax, ly: ay, x, y, t: 0 }; } } catch (e) { fail('step off', e); } return null; };
  const hookStep = () => { const step0 = g.step.bind(g); g.step = function (dt) { if (!J.on) return step0(dt); const d = dt > 0 ? dt : 0; try { pre(d); } catch (e) { fail('pre', e); } step0(dt); try { post(d); } catch (e) { fail('post', e); } }; };

  // ---------------------------------------------------------------- the figure: height, and the jump laid over whatever clip is playing
  const sync0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) {
    if (!J.stepHooked) { J.stepHooked = true; hookStep(); }
    if (J.saved) { const S = J.saved, B = J.rig.B; for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) b.quaternion.copy(S[i]); } B.hips.position.copy(S.hp); J.saved.live = false; J.savedOff = J.saved; J.saved = null; }      // the bones as the clip left them, before the mixer writes this frame's
    sync0(dt); J.padF = false; if (!J.on) return;
    try { if (!pl.vehicle && !pl.busy) draw(dt > 0 ? dt : 0); } catch (e) { fail('draw', e); }
  };
  const draw = (dt) => {
    const vis = pl.vis, o = vis.object, air = core.own && !core.grounded;
    // height: exact in the air, eased over a step up or down while walking on something
    if (core.own) { if (air || J.zs === undefined) J.zs = core.z; else J.zs += (core.z - J.zs) * Math.min(1, dt * 18); if (air) J.zs = core.z; o.position.y += J.zs - gameBase(); } else J.zs = gameBase();
    // weights
    J.wa = clamp(J.wa + (air ? dt / 0.1 : -dt / 0.11), 0, 1); const wa = sm(J.wa);
    const ck = J.phase === 'crouch' ? sm(J.ct / T_CROUCH) : air && core.vz > 0 ? clamp(1 - core.airT / 0.07, 0, 1) : 0, L = J.land; let lk = 0, drop = 0.15 * ck, lean = 0.2 * ck;
    if (L) { const td = 0.075; lk = L.t < td ? sm(L.t / td) : 1 - sm((L.t - td) / (L.dur - td)); drop = Math.max(drop, L.depth * lk); lean = Math.max(lean, (L.hard ? 0.5 : 0.22) * lk); }
    if (wa < 0.002 && drop < 0.002) return;
    if (!vis.mixer) return;
    const rig = (J.rig ||= new EntryRig(vis, vis.name || 'player')); if (!rig.ok) return; const B = rig.B;
    o.updateMatrixWorld(true);
    { const S = J.savedOff || TOUCH.map(() => new THREE.Quaternion()); if (!S.hp) S.hp = new THREE.Vector3(); for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) S[i].copy(b.quaternion); } S.hp.copy(B.hips.position); J.saved = S; }
    poseJump(rig, o, pl.h, { wa, ck, lk, drop, lean, air, vz: core.vz, v0: core.v0, launchSp: core.launchSp, G: core.own ? core.G : gameBase(), armed: !!(g.combat && g.combat.armedFoot && g.combat.armedFoot()) });
  };
  console.log('[jump] on: Space / controller A on foot (jump ' + TUNE.height + ' m)');
  return J;
}

// The jump laid over the clip's pose (the figure's bones are where the mixer left them; o is the figure's root, h its heading).
// S: wa 0..1 in the air; ck 0..1 push-off crouch; lk 0..1 landing give; drop (m) and lean (rad) for the crouch or landing; vz, v0, launchSp; G ground height; armed
export function poseJump(rig, o, h, S) {
  const B = rig.B, wa = S.wa, ck = S.ck, lk = S.lk, drop = S.drop, lean = S.lean, air = S.air;
  _f.set(Math.cos(h), 0, -Math.sin(h)); _r.set(Math.sin(h), 0, Math.cos(h));
  rig.pos('hips', _hp); rig.pos('foot_L', _fl); rig.pos('foot_R', _fr); B.foot_L.getWorldQuaternion(_qL); B.foot_R.getWorldQuaternion(_qR);
  // through the air: 0 at push-off, 0.5 at the top, 1 coming down at take-off speed
  const s = air ? clamp(0.5 - S.vz / (2 * S.v0), 0, 1.3) : 1, tk = Math.sin(Math.PI * clamp(s, 0, 1)), k = clamp(S.launchSp / 5.4, 0, 1), s1 = clamp(s, 0, 1);
  const gy = Math.max(S.G, 0) + rig.ankleH, oy = o.position.y;
  // hips: where the clip has them, lowered by the crouch; in the air level over the feet, lifted a little at the top
  _t.set(o.position.x, oy + rig.standH - 0.03 + 0.03 * tk, o.position.z); _hp.y -= drop * (1 - wa); _hp.lerp(_t, wa); const hipY = _hp.y, hx = _hp.x, hz = _hp.z;
  rig.hips(_hp, 1);
  const ln = lean * (1 - wa) + wa * (0.1 + 0.16 * k) * (1 - s1) - wa * 0.05 * s1; if (Math.abs(ln) > 1e-3) rig.tilt(_q.setFromAxisAngle(_r, -ln));
  // legs: planted where the clip put the feet (the knees take the crouch), or tucked and reaching in the air
  for (const sd of ['L', 'R']) { const lead = sd === 'R', clipF = lead ? _fr : _fl, sg = lead ? 1 : -1;
    const fwd = lead ? 0.08 + 0.34 * k * (1 - s1) + 0.14 * tk : -0.08 - 0.36 * k * (1 - s1) - 0.04 * tk, down = lead ? 0.86 - 0.3 * tk - 0.04 * (1 - s1) : 0.86 - 0.15 * tk;
    _t.set(hx, hipY - down * (rig.standH / 0.95), hz).addScaledVector(_f, fwd).addScaledVector(_r, sg * rig.hipW); if (_t.y < gy) _t.y = gy;
    _t.lerpVectors(clipF, _t, wa); _pole.copy(_f).addScaledVector(UP, 0.15).addScaledVector(_r, sg * 0.12);
    rig._ik(B['thigh_' + sd], B['shin_' + sd], B['foot_' + sd], _t, _pole, 1);
    const Ft = B['foot_' + sd]; Ft.parent.getWorldQuaternion(_q2); Ft.quaternion.copy(_q2.invert()).multiply(lead ? _qR : _qL); Ft.updateMatrixWorld(true);      // the foot keeps the attitude the clip gave it
    if (wa > 0.01) rig.leg(sd, _t, _pole, _f, -(0.55 - 0.45 * s1) * (lead ? 0.7 : 1), wa); }
  // arms (the guns pose them after this when a weapon is out)
  const armed = S.armed;
  if (!armed) for (const sd of ['L', 'R']) { const sA = sm((s1 - (sd === 'L' ? 0.36 : 0.28)) / 0.5), wu = wa * (1 - sA), wf = wa * sA, wl = lk * (1 - wa), wc = ck * (1 - wa), tot = wu + wf + wl + wc;
    if (tot > 0.01) { const sg = sd === 'R' ? 1 : -1, opp = sd === 'L' ? 1 : -1; rig.pos('upper_arm_' + sd, _sh); _t.set(0, 0, 0);
      const add = (w, f, u, r) => { if (w > 0) { _t.x += w * (_sh.x + _f.x * f + _r.x * r * sg); _t.y += w * (_sh.y + u); _t.z += w * (_sh.z + _f.z * f + _r.z * r * sg); } };
      add(wc, -0.22, -0.4, 0.14);                                             // push-off: arms back
      add(wu, 0.3 + 0.14 * k * opp, (0.14 + 0.06 * tk) * (1 - k) + (opp > 0 ? 0.1 : -0.24) * k, 0.1);      // up: arms thrown up and ahead (running: the arm opposite the leading leg)
      add(wf, 0.13 + 0.04 * opp, -0.44, 0.36);                                         // coming down: out for balance
      add(wl, 0.28, -0.36, 0.12);                                             // landing: ahead and low
      _t.multiplyScalar(1 / tot); _pole.copy(_f).multiplyScalar(-0.45).addScaledVector(UP, -1).addScaledVector(_r, sg * 0.1);      // (elbows down and a little back, close to the ribs: not out like wings)
      rig.arm(sd, _t, _pole, Math.min(1, tot)); } }
  if (B.spine && wa > 0.01) rig.bend(_r, wa * 0.06 * (1 - s1));
}
