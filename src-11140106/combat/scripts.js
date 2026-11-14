// combat/scripts.js: a scripted player for filming and for frame-rate runs (?script=<name>). A script is a list of steps played in
// order; each step holds for `d` seconds and may set: cast (people placed for the film, see Script.cast), wait (with at: 'ped': seconds to
// wait for a person a bullet can reach), move [left, forward], run, aim, fire ('tap' = semi-auto presses, 'hold'),
// at (what the crosshair is brought onto: 'wall' | 'car' | 'glass' | 'tyre' | 'ped' | 'ground' | 'keep' | {yaw, pitch} relative turn),
// slot (weapon to switch to), reload, after (seconds a firing step goes on once its target is down; default 0.4 hold / 0.75 tap). It is deterministic: the same build plays the same film.
import { clamp, wrapPi } from '../geo.js';

const S = (d, o = {}) => Object.assign({ d }, o);
export const SCRIPTS = {
  // guns v1, end to end: pistol on a person, car glass, a wall, reload; rifle on a wall, a car, a person; walk to a car, F, drive, stop, F out, fire again
  // (step options added for it: to: 'car' walks to one and ends the step beside it; use: true presses F once; hb: true holds the handbrake)
  v1: [S(0.8, { slot: 'pistol', cast: [[7.2, 0.2, 1], [13, -1.3, 1], [11.5, 1.6, -1], [16, 0.8, 1], [18, -0.6, -1], [21, 1.4, 1]] }), S(0.45, { aim: true, at: 'ped', wait: 2 }), S(1.5, { aim: true, at: 'keep', fire: 'tap' }), S(0.9, { aim: true, at: 'keep' }),
    S(0.45, { aim: true, at: 'glass' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }), S(0.4, { aim: true, at: 'wall' }), S(0.8, { aim: true, at: 'keep', fire: 'tap' }), S(1.75, { aim: true, reload: true }),
    S(0.7, { slot: 'rifle' }), S(0.5, { aim: true, at: 'wall' }), S(0.6, { aim: true, at: 'keep', fire: 'hold' }), S(0.4, { aim: true, at: 'car' }), S(0.6, { aim: true, at: 'keep', fire: 'hold' }), S(0.5, { aim: true, at: 'ped', wait: 1 }), S(0.7, { aim: true, at: 'keep', fire: 'hold' }), S(1.2, { aim: true }),
    S(9, { to: 'car' }), S(0.2, { use: true }), S(6.5, {}), S(3.0, { move: [0, 1] }), S(2.4, { hb: true }), S(0.2, { use: true }), S(5, {}), S(0.5, { aim: true, at: 'wall' }), S(0.8, { aim: true, at: 'keep', fire: 'hold' }), S(2.4, { aim: true, reload: true }), S(1.5, {})],
  // pistol: draw, a wall, a parked car (door, then glass), a person, strafe and empty the magazine, reload
  guns1: [S(0.45, { move: [0, 1], slot: 'pistol', cast: [[7.2, 0.2, 1], [13, -1.3, 1], [11.5, 1.6, -1], [16, 0.8, 1], [18, -0.6, -1], [21, 1.4, 1]] }), S(0.45, { aim: true, at: 'ped', wait: 2 }), S(1.5, { aim: true, at: 'keep', fire: 'tap' }),
    S(1.1, { aim: true, at: 'keep' }), S(0.45, { aim: true, at: 'glass' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }), S(0.35, { aim: true, at: 'car' }), S(0.7, { aim: true, at: 'keep', fire: 'tap' }), S(1.75, { aim: true, reload: true, move: [0.5, 0] }),
    S(0.5, { aim: true, at: 'ped', wait: 1 }), S(1.4, { aim: true, at: 'keep', fire: 'tap' }), S(0.5, { aim: true, at: 'wall' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }), S(0.5, { aim: true, at: 'tyre' }), S(1.2, { aim: true, at: 'keep', fire: 'tap', move: [1, 0] }), S(1.0, { move: [0, 1] })],
  // carbine: bursts on a wall, a car until it burns, people running
  guns2: [S(0.45, { move: [0, 1], slot: 'rifle', cast: [[7.6, 0.3, 1], [12.5, -1.2, 1], [12, 1.7, -1], [15.5, 0.6, 1], [18, -0.8, -1], [20, 1.5, 1], [23, 0, 1]] }), S(0.5, { aim: true, at: 'ped', wait: 2 }), S(0.7, { aim: true, at: 'keep', fire: 'hold', after: 0.15 }), S(0.22, { aim: true, at: 'ped', wait: 0.5 }), S(0.8, { aim: true, at: 'keep', fire: 'hold' }),
    S(1.0, { aim: true, at: 'keep' }), S(0.5, { aim: true, at: 'glass' }), S(0.9, { aim: true, at: 'keep', fire: 'hold' }), S(0.3, { aim: true, at: 'car' }), S(0.7, { aim: true, at: 'keep', fire: 'hold' }), S(0.3, { aim: true, at: 'tyre' }), S(0.5, { aim: true, at: 'keep', fire: 'hold' }),
    S(2.4, { aim: true, reload: true, move: [-0.7, 0] }), S(0.5, { aim: true, at: 'car' }), S(2.6, { aim: true, at: 'keep', fire: 'hold' }), S(4, { aim: true, move: [0, -0.6] })],
  // frame-rate runs: the carbine on a parked car only, nobody cast and nobody aimed at (to tell the cost of car effects from the cost of bodies)
  cars1: [S(0.45, { move: [0, 1], slot: 'rifle' }), S(0.5, { aim: true, at: 'glass' }), S(0.9, { aim: true, at: 'keep', fire: 'hold' }), S(0.3, { aim: true, at: 'car' }), S(0.7, { aim: true, at: 'keep', fire: 'hold' }), S(0.3, { aim: true, at: 'tyre' }), S(0.5, { aim: true, at: 'keep', fire: 'hold' }), S(2.4, { aim: true, reload: true }), S(0.5, { aim: true, at: 'car' }), S(2.6, { aim: true, at: 'keep', fire: 'hold' }), S(2, { aim: true })],
  // frame-rate runs: the carbine held on aim at a parked car, never fired (to tell the cost of the aim camera from the cost of firing)
  aim1: [S(0.45, { move: [0, 1], slot: 'rifle' }), S(0.5, { aim: true, at: 'glass' }), S(12, { aim: true, at: 'keep' })],
  // QA: with ?gun=<kind>: stand and hold the aim level for a long time (tools/tunesheet.mjs changes views and tuning numbers under it)
  hold: [S(0.6, {}), S(60, { aim: true, at: { yaw: 0, pitch: -0.06 } })],
  // frame-rate runs: as `hold`, with the trigger held (it reloads by itself when the magazine is empty): firing without turning the view
  holdfire: [S(0.6, {}), S(120, { aim: true, at: { yaw: 0, pitch: -0.06 }, fire: 'hold' })],
  // frame-rate runs: stand armed without aiming, looking the same way `hold` does (with ?gun=<kind>)
  stand: [S(60, {})],
  // frame-rate runs: as aim1 (turns to the same parked car) but the aim button is never held: the same direction of view without the aim camera
  look1: [S(0.45, { move: [0, 1], slot: 'rifle' }), S(0.5, { at: 'glass' }), S(12, { at: 'keep' })],
  // shotgun then SMG
  guns3: [S(0.5, { move: [0, 1], slot: 'shotgun' }), S(0.7, { aim: true, at: 'wall' }), S(1.9, { aim: true, at: 'keep', fire: 'tap' }), S(0.6, { aim: true, at: 'glass' }), S(1.9, { aim: true, at: 'keep', fire: 'tap' }), S(0.6, { aim: true, at: 'ped' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }),
    S(0.7, { slot: 'smg' }), S(0.5, { aim: true, at: 'car' }), S(1.4, { aim: true, at: 'keep', fire: 'hold', move: [0.8, 0] }), S(0.5, { aim: true, at: 'ground' }), S(1.0, { aim: true, at: 'keep', fire: 'hold' }), S(2.2, { aim: true, reload: true })],
  // hip fire on the move, no aim button
  guns4: [S(0.4, { slot: 'smg' }), S(0.6, { move: [0, 1] }), S(0.5, { at: 'car', move: [0, 1] }), S(1.6, { at: 'keep', fire: 'hold', move: [0.5, 0.6] }), S(0.5, { at: 'wall' }), S(1.0, { at: 'keep', fire: 'hold' }), S(2, { move: [0, 1], run: true })],
  // QA: with ?gun=<kind>: stand, aim level, two shots, reload, walk off
  pose: [S(1.0, {}), S(1.2, { aim: true, at: { yaw: 0, pitch: -0.06 } }), S(0.8, { aim: true, at: 'keep', fire: 'tap' }), S(2.4, { aim: true, reload: true }), S(1.5, { move: [0, 1] }), S(1.5, { move: [0, 1], run: true })],
  // stand armed and walk about: for the carry pose
  carry: [S(0.3, { slot: 'rifle' }), S(2.5, { move: [0, 1] }), S(2, { move: [0, 1], run: true }), S(1.5, {}), S(0.4, { slot: 'pistol' }), S(2.5, { move: [0, 1] }), S(2, { move: [0, 1], run: true }), S(1.5, {})],
  // people (combat/people.js): a pistol on one person then another; a shotgun into people; a carbine burst and the street's answer
  people1: [S(0.4, { slot: 'pistol' }), S(0.7, { aim: true, at: 'ped' }), S(1.5, { aim: true, at: 'keep', fire: 'tap' }), S(1.6, { aim: true }), S(0.6, { aim: true, at: 'ped' }), S(1.5, { aim: true, at: 'keep', fire: 'tap' }), S(4, { aim: true })],
  people2: [S(0.4, { slot: 'shotgun' }), S(0.8, { aim: true, at: 'ped' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }), S(1.4, { aim: true }), S(0.7, { aim: true, at: 'ped' }), S(1.0, { aim: true, at: 'keep', fire: 'tap' }), S(4, { aim: true })],
  people3: [S(0.4, { slot: 'rifle' }), S(0.8, { aim: true, at: 'ped' }), S(0.5, { aim: true, at: 'keep', fire: 'hold' }), S(0.5, { aim: true, at: 'ped' }), S(0.5, { aim: true, at: 'keep', fire: 'hold' }), S(0.5, { aim: true, at: 'ped' }), S(0.6, { aim: true, at: 'keep', fire: 'hold' }), S(6, { aim: true })],
};

export class Script {
  constructor(game, combat, name) {
    this.g = game; this.c = combat; this.name = name; this.steps = SCRIPTS[name] || SCRIPTS.guns1; this.i = -1; this.t = 0; this.mx = 0; this.my = 0; this.run = false; this.tgt = null; this.tapT = 0; this.done = false; this.n = 0;
    if (!SCRIPTS[name]) console.log('[guns] no script "' + name + '": playing guns1');
  }
  // put people where the film needs them (step option cast: [[metres ahead, metres to the side, 1 walking toward the player | -1 away], ...]):
  // crowd members on the walkway the player stands on when the crowd is on, else kit pedestrians on the nearest pedestrian loop
  cast(list) {
    const g = this.g, pl = g.player, fx = Math.cos(pl.h), fy = Math.sin(pl.h), cs = g.crowd && g.crowd.on && g.crowd.sim, st = g.statics, o = {}; this.casted = this.casted || [];
    const free = (x, y) => st.onSidewalk(x, y) && !(st.resolve(x, y, 0.45, o) > 0) && st.raycast(pl.x, pl.y, x, y) >= 0.98;
    try {
      if (cs && cs.nav && cs.nav.near) { let w = null, bd = 6; for (const q of cs.nav.near(pl.x, pl.y, 40, [])) { if (q.kind === 'cross' || Math.abs(q.ux * fx + q.uy * fy) < 0.8) continue; const s = (pl.x - q.ax) * q.ux + (pl.y - q.ay) * q.uy, l = Math.abs((pl.x - q.ax) * q.nx + (pl.y - q.ay) * q.ny); if (s > -2 && s < q.len + 2 && l < bd) { bd = l; w = q; } }
        if (w) { const sg = w.ux * fx + w.uy * fy > 0 ? 1 : -1, s0 = (pl.x - w.ax) * w.ux + (pl.y - w.ay) * w.uy, l0 = (pl.x - w.ax) * w.nx + (pl.y - w.ay) * w.ny, ls = (-fy * w.nx + fx * w.ny) > 0 ? 1 : -1;      // ls: which way along the walkway's normal is the player's left
          for (const [ah, sd, dir] of list) { let done = false; for (let k = 0; k < 7 && !done; k++) { const s = clamp(s0 + sg * (ah + k * 0.9), 0.5, w.len - 0.5), l = l0 - ls * sd * (1 - k * 0.12), x = w.ax + w.ux * s + w.nx * l, y = w.ay + w.uy * s + w.ny * l; if (!free(x, y)) continue;
            const a = cs.make(w, s, l, -sg * dir); a.lt = l; a.v = a.v0; a.cast = true; this.casted.push(a); done = true; } }
          return; } }
      const P = g.peds, t = {}; let L = null, bs = 0, bd = 8; for (const l of P.nearLoops(pl.x, pl.y)) for (let s = 0; s < l.len; s += 1) { l.at(s, t); const d = Math.hypot(t.x - pl.x, t.y - pl.y); if (d < bd) { bd = d; L = l; bs = s; } }
      if (!L) return; L.at(bs, t); const sg = t.tx * fx + t.ty * fy > 0 ? 1 : -1;
      for (const [ah, sd, dir] of list) { const n0 = P.list.length; for (let k = 0; k < 40 && P.list.length === n0; k++) P.spawn(pl.x, pl.y, true); const p = P.list[n0]; if (!p) continue; p.loop = L; p.s = (bs + sg * ah + L.len) % L.len; p.dir = -sg * dir; p.off = clamp(-sd * p.dir * sg, -1.2, 1.2); L.at(p.s, t); p.x = t.x + t.ty * p.dir * p.off; p.y = t.y - t.tx * p.dir * p.off; p.h = Math.atan2(t.ty * p.dir, t.tx * p.dir); p.cast = true; this.casted.push(p); }
    } catch (e) { console.log('[guns] script cast: ' + (e && e.message)); }
  }
  // something to point at, from where the player stands
  find(kind) {
    const g = this.g, pl = g.player, yaw = g.cam.yaw, score = (x, y, lo, hi) => { const d = Math.hypot(x - pl.x, y - pl.y); if (d < lo || d > hi) return 1e9; const a = Math.abs(wrapPi(Math.atan2(y - pl.y, x - pl.x) - yaw)); if (a > 2.0) return 1e9; if (g.statics.raycast(pl.x, pl.y, x, y) < 0.98) return 1e9; return d + a * 9; };
    if (kind === 'car' || kind === 'glass' || kind === 'tyre') {
      let best = null, bs = 1e8; const tryc = (v) => { if (v.wreck) return; let s = score(v.x, v.y, 4.2, 30); if (s > 1e8) return; const a = Math.atan2(v.y - pl.y, v.x - pl.x); s += Math.abs(Math.cos(a - v.h)) * 7 + (v.type === 'van' || v.type === 'bus' ? 9 : 0); if (s < bs) { bs = s; best = v; } };
      for (const v of g.parked.near(pl.x, pl.y, 34, [])) tryc(v); for (const v of g.traffic.cars) if (v.v < 1) tryc(v); for (const v of g.vehicles) tryc(v);
      if (!best) return this.find('wall'); const H = best.def.hgt - (best.type === 'taxi' ? 0.3 : 0), belt = Math.min(H * 0.58, 1.08);
      return { o: best, z: kind === 'glass' ? (belt + H) / 2 + 0.02 : kind === 'tyre' ? best.def.radius : belt * 0.62, fwd: kind === 'glass' ? -best.def.len * 0.06 : kind === 'tyre' ? best.def.wheelbase / 2 : -best.def.len * 0.05 };
    }
    if (kind === 'ped') {
      const cand = [], tryp = (p, z) => { if (p.state === 'down' || p.gone || p.state === 'sit' || p.hp <= 0) return; let s = score(p.x, p.y, 3.5, 42); if (p.cast) s -= 30; if (s < 1e8) cand.push({ s, o: p, z: z + 1.22 * (p.scale || p.tall || 1) }); };
      for (const p of g.peds.list) tryp(p, g.statics.onSidewalk(p.x, p.y) ? 0.15 : 0); const cs = g.crowd && g.crowd.on && g.crowd.sim; if (cs) for (const a of cs.agents) tryp(a, a.z || 0);
      // the nearest one a bullet can really reach (no pole, tree, car or other person in the way)
      cand.sort((a, b) => a.s - b.s); for (const c of cand.slice(0, 12)) { const dx = c.o.x - pl.x, dy = c.o.y - pl.y, dz = c.z - 1.55, L = Math.hypot(dx, dy, dz), h = this.c.cast(pl.x, pl.y, 1.55, dx / L, dy / L, dz / L, 0.6, L + 1); if (h.obj === c.o) return c; }
      if (this.strict) return null; return cand[0] || this.find('wall');
    }
    if (kind === 'ground') return { x: pl.x + Math.cos(yaw) * 6, y: pl.y + Math.sin(yaw) * 6, z: 0.05 };
    // a wall: the nearest one in a fan ahead
    let best = null; for (let k = -6; k <= 6; k++) { const a = yaw + k * 0.16, f = g.statics.raycast(pl.x, pl.y, pl.x + Math.cos(a) * 30, pl.y + Math.sin(a) * 30); if (f < 1 && f * 30 > 4 && (!best || f * 30 + Math.abs(k) * 0.8 < best.s)) best = { s: f * 30 + Math.abs(k) * 0.8, x: pl.x + Math.cos(a) * 30 * f, y: pl.y + Math.sin(a) * 30 * f, z: 1.55 }; }
    return best || { x: pl.x + Math.cos(yaw) * 12, y: pl.y + Math.sin(yaw) * 12, z: 0.05 };
  }
  drive(dt, I, K) {
    const g = this.g, C = g.cam; this.t += dt; K.reload = false;
    while (!this.done && (this.i < 0 || this.t >= this.steps[this.i].d)) {
      if (this.i >= 0) this.t -= this.steps[this.i].d; this.i++; if (this.i >= this.steps.length) { if (g.P.has('loop')) { this.i = 0; } else { this.done = true; this.i = this.steps.length - 1; break; } }
      const s = this.steps[this.i]; if (s.cast) this.cast(s.cast); this.waitT = s.at === 'ped' && s.wait ? s.wait : 0; if (s.slot) K.want = s.slot; if (s.reload) K.reload = true; this.tapT = 0.12; this.n++; this.useNow = !!s.use; if (s.to) { this.tgt = this.find(s.to); this.off = [0, 0]; }
      if (s.at && s.at !== 'keep') { this.strict = this.waitT > 0; this.tgt = typeof s.at === 'string' ? this.find(s.at) : { rel: s.at, yaw0: C.yaw, pitch0: C.pitch }; this.off = [(Math.sin(this.n * 12.9) * 0.5) * 0.12, (Math.sin(this.n * 7.3) * 0.5) * 0.1]; }
      if (!s.at && !s.to) this.tgt = null;
    }
    // a step that waits for a person a bullet can reach holds its clock until there is one (or its patience runs out)
    if (!this.done && this.waitT > 0 && !this.tgt) { this.waitT -= dt; this.t = 0; this.strict = this.waitT > 0; this.tgt = this.find('ped'); this.strict = false; if (this.tgt) this.off = [0, 0]; }
    const down = this.tgt && this.tgt.o && (this.tgt.o.state === 'down' || this.tgt.o.gone || this.tgt.o.hp <= 0) && this.tgt.z !== undefined && !this.tgt.o.def;
    { const st = this.steps[this.i], af = st.after ?? (st.fire === 'hold' ? 0.4 : 0.75); if (down && !this.done && st.fire && st.d - this.t > af) this.t = st.d - af; }      // the target is down: watch the fall for a moment, then move on
    const s = this.done ? {} : this.steps[this.i], mv = s.move || [0, 0]; this.mx = mv[0]; this.my = mv[1]; this.run = !!s.run; this.hb = !!s.hb; K.aim = !!s.aim; I.use = !!this.useNow; this.useNow = false;
    if (s.to && !this.done) { const o = this.tgt && this.tgt.o, pl = g.player; if (o && o.def && !pl.vehicle && !pl.busy && Math.hypot(o.x - pl.x, o.y - pl.y) > 3.1) this.my = 1; else this.t = Math.max(this.t, s.d); }      /* walk to it; beside it the step is over */
    // bring the crosshair onto the target the way a hand does: quick at first, settling, never perfectly still
    let onTarget = true;
    if (this.tgt) {
      const T = this.tgt, cam = g.world.camera, cx = cam.position.x, cy = -cam.position.z, cz = cam.position.y; let wy, wp;
      if (T.rel) { wy = T.yaw0 + T.rel.yaw; wp = T.pitch0 + (T.rel.pitch || 0); }
      else { let x = T.x, y = T.y, z = T.z; if (T.o) { x = T.o.x; y = T.o.y; if (T.fwd) { x += Math.cos(T.o.h) * T.fwd; y += Math.sin(T.o.h) * T.fwd; } if (T.o.state === 'down' || T.o.gone) z = 0.3; }
        x += this.off[0]; z += this.off[1]; const d = Math.hypot(x - cx, y - cy); wy = Math.atan2(y - cy, x - cx); wp = -Math.atan2(z - cz, d) + 0.08; }
      { const tt = this.c.t, wk = +(g.P.get('gwander') || 1) * Math.min(1, 6 / (T.o || T.x !== undefined ? Math.hypot((T.o ? T.o.x : T.x) - cx, (T.o ? T.o.y : T.y) - cy) : 6)); wy += (Math.sin(tt * 2.1) + 0.6 * Math.sin(tt * 4.7 + 1)) * 0.011 * wk; wp += (Math.sin(tt * 2.9 + 2) + 0.5 * Math.sin(tt * 5.3)) * 0.007 * wk; }      /* a hand on a mouse is never still: the picture drifts a few px per tile between shots, as in every reference (measured 4-14 px per 15 fps tile); less on far targets so the shots still land */
      const kt = this.c.kickT ?? 9, ey = wrapPi(wy - C.yaw), ep = wp - C.pitch, k = kt < 0.11 ? 0 : 1 - Math.exp(-dt * (s.fire ? (T.o && !T.o.def ? 7 : 5) : 11));      // under fire the hand comes back onto the target after a beat, not at once
      C.yaw += clamp(ey * k, -dt * 5.5, dt * 5.5); C.pitch = clamp(C.pitch + clamp(ep * k, -dt * 3.5, dt * 3.5), -1.2, 1.25); C.lookT = 0;
      onTarget = Math.abs(ey) < (s.fire ? 0.035 : 0.02) && Math.abs(ep) < (s.fire ? 0.035 : 0.02);
    }
    K.fire = false; if (down) return;
    if (s.fire === 'hold') K.fire = onTarget || this.t > 0.3;
    else if (s.fire === 'tap') { this.tapT -= dt; if (this.tapT <= 0 && (onTarget || this.t > 0.9)) { K.fire = true; if (this.tapT < -0.05) this.tapT = (s.rate || 0.3) + Math.sin(this.n * 3.1 + this.t * 5) * 0.04; } }
  }
}
