// combat/heatscripts.js: scripted players for the heat feature (?script=heat1 ...), for the node sim's numbers and for films.
// A plan is a list of phases played in order; each phase has a `do` and ends after `d` seconds or when `until(heat, game)` is true.
//   provoke   draw, fire `n` rounds into the nearest wall         fight   shoot at the nearest officer in sight (strafe: sidestep)
//   flee      run from the officers, round corners                wait    stand                    holster   put the gun away
// Registered from heat.js (the Script made by combat.js before heat loads is replaced by a Bot when the name is one of these).
import { clamp, wrapPi } from '../geo.js';

const P = (d, o = {}) => Object.assign({ do: d }, o);
export const PLANS = {
  /* one step of heat: two shots, the pair on foot comes and challenges, the fight */
  heat1: { gun: 'pistol', plan: [P('provoke', { n: 2, d: 3 }), P('wait', { until: (H) => H.cops.some((k) => k.see), d: 40 }), P('fight', { d: 600 })] },
  /* stand and fight with the carbine as it climbs to five */
  heat5: { gun: 'rifle', plan: [P('provoke', { n: 3, d: 3 }), P('fight', { d: 600, strafe: true })] },
  /* climb to three by fighting, then get away */
  heat3run: { gun: 'pistol', plan: [P('provoke', { n: 2, d: 3 }), P('fight', { until: (H) => H.level >= 3, d: 200, strafe: true }), P('flee', { until: (H) => H.level === 0, d: 400 }), P('wait', { d: 30 })] },
  /* fire and run at once */
  heatrun: { gun: 'pistol', plan: [P('provoke', { n: 3, d: 2.5 }), P('flee', { until: (H) => H.level === 0, d: 300 }), P('wait', { d: 20 })] },
  /* fire, then stand there armed and take it: down, the camera, the clinic */
  heatdown: { gun: 'pistol', plan: [P('provoke', { n: 12, d: 6 }), P('wait', { d: 600 })] },
  /* fire, put the gun away and stand still: the arrest */
  heatcuffs: { gun: 'pistol', plan: [P('provoke', { n: 2, d: 3 }), P('holster', { d: 0.6 }), P('wait', { d: 600 })] },
  /* for looking at it (with ?heatqa=<step>): stand unarmed and be shot at */
  heatqa: { gun: null, plan: [P('wait', { d: 600 })] },
  /* for the film: shots, the patrol car arrives, the fight from where one stands */
  /* for the close film (with ?heatqa=2&heatqp=0&heatstop=13): gun out, watch the patrol car come in and stop, then the fight from where one stands */
  heatclose: { gun: 'pistol', plan: [P('watch', { until: (H) => H.cops.some((k) => k.see && !k.get), d: 40 }), P('wait', { d: 0.9 }), P('fight', { d: 600 })] },
  /* round-4 film (with ?heatqa=3&heatqp=0&heatq2=1): watch the car in, stand under their fire for a moment, then fight */
  heatfilm2: { gun: 'pistol', plan: [P('watch', { until: (H) => H.cops.some((k) => k.see && !k.get), d: 40 }), P('wait', { d: 1.2 }), P('fight', { d: 600 })] },
  /* round-6 stills: as heatfilm2, but he opens fire the moment the first officer is out of the car, as a player would */
  heatfilm3: { gun: 'pistol', plan: [P('watch', { until: (H) => H.cops.some((k) => k.see && !k.get), d: 40 }), P('fight', { d: 600 })] },
  /* round 9 on: heatfilm3 with a player's hand (see 'loose' in fight) */
  heatfilm4: { gun: 'pistol', plan: [P('watch', { until: (H) => H.cops.some((k) => k.see && !k.get), d: 40 }), P('fight', { d: 600, loose: true })] },
  heatfilm: { gun: 'pistol', plan: [P('provoke', { n: 2, d: 2.2 }), P('wait', { until: (H) => H.cops.some((k) => k.see), d: 30 }), P('fight', { until: (H) => H.cars.some((v) => v.out), d: 60 }), P('fight', { d: 600, strafe: true })] },
};

class Bot {
  constructor(game, combat, heat, name) { this.g = game; this.c = combat; this.H = heat; this.name = name; this.def = PLANS[name]; this.steps = this.def.plan; this.i = -1; this.t = 0; this.T = 0; this.mx = 0; this.my = 0; this.run = false; this.done = false; this.tapT = 0; this.tgt = null; this.newT = 0; this.fired = 0; this.strafeT = 0; this.sdir = 1; this.fleeH = null; this.n = 0; }
  turn(dt, wy, wp, rate = 6) { const C = this.g.cam, ey = wrapPi(wy - C.yaw), ep = wp - C.pitch, k = 1 - Math.exp(-dt * rate); C.yaw += clamp(ey * k, -dt * 5.5, dt * 5.5); C.pitch = clamp(C.pitch + clamp(ep * k, -dt * 3.5, dt * 3.5), -1.2, 1.25); C.lookT = 0; this.aerr = Math.hypot(ey, ep); return Math.abs(ey) < 0.03 && Math.abs(ep) < 0.03; }
  lookAt(dt, x, y, z, rate) { const cam = this.g.world.camera, cx = cam.position.x, cy = -cam.position.z, cz = cam.position.y, d = Math.hypot(x - cx, y - cy); return this.turn(dt, Math.atan2(y - cy, x - cx), -Math.atan2(z - cz, d) + 0.08, rate); }
  drive(dt, I, K) {
    const g = this.g, c = this.c, H = this.H, pl = g.player, C = g.cam; this.t += dt; this.T += dt; K.reload = false; K.fire = false; K.aim = false; I.use = false; this.mx = 0; this.my = 0; this.run = false;
    if (H.dead) { this.tgt = null; return; }
    let s = this.steps[this.i];
    while (!this.done && (this.i < 0 || this.t >= s.d || (s.until && this.t > 0.2 && s.until(H, g)))) { this.i++; this.t = 0; this.fired = 0; if (this.i >= this.steps.length) { this.done = true; this.i = this.steps.length - 1; } s = this.steps[this.i]; if (H.log) console.log('[heat] ' + H.t.toFixed(1) + ' bot: ' + (this.done ? 'done' : s.do)); }
    if (this.done) return;
    if (s.do !== 'holster' && s.do !== 'flee' && c.slot === 'unarmed' && !c.swap && this.def.gun && !(this.i > 0 && this.steps[this.i - 1].do === 'holster')) K.want = this.def.gun;
    if (s.do === 'holster') { if (c.slot !== 'unarmed' && !c.swap) K.want = 'unarmed'; return; }
    if (s.do === 'provoke') {
      /* a wall some way off, a little above head height */
      if (!this.wall) { let best = null; for (let k = -6; k <= 6; k++) { const a = C.yaw + k * 0.2, f = g.statics.raycast(pl.x, pl.y, pl.x + Math.cos(a) * 40, pl.y + Math.sin(a) * 40); if (f < 1 && f * 40 > 5 && (!best || f * 40 + Math.abs(k) < best.s)) best = { s: f * 40 + Math.abs(k), x: pl.x + Math.cos(a) * 40 * f, y: pl.y + Math.sin(a) * 40 * f }; } this.wall = best || { x: pl.x + Math.cos(C.yaw) * 15, y: pl.y + Math.sin(C.yaw) * 15 }; }
      K.aim = true; const on = this.lookAt(dt, this.wall.x, this.wall.y, 2.6, 9); this.tapT -= dt; if ((on || this.t > 1) && this.fired < (s.n || 2) && this.tapT <= 0 && c.slot !== 'unarmed') { K.fire = true; if (this.tapT < -0.04) { this.tapT = 0.3; this.fired++; } }
      return; }
    if (s.do === 'watch') { K.aim = c.slot !== 'unarmed'; const v = H.cars.find((q) => !q.wreck), k = this.nearest(false); if (k) this.lookAt(dt, k.x, k.y, 1.2, 3); else if (v) this.lookAt(dt, v.x, v.y, 1.0, 3); return; }
    if (s.do === 'wait') { if (c.slot !== 'unarmed') { const k = this.nearest(false); if (k) this.lookAt(dt, k.x, k.y, 1.3, 3); } return; }
    if (s.do === 'fight') {
      let k = this.nearest(true); /* film hand (s.loose): stays on the man he is shooting at unless another is clearly nearer */ if (s.loose && this.tgt && this.tgt.hp > 0 && this.tgt.see && k && k !== this.tgt && Math.hypot(this.tgt.x - pl.x, this.tgt.y - pl.y) < Math.hypot(k.x - pl.x, k.y - pl.y) + 3.5) k = this.tgt; if (k !== this.tgt) { this.tgt = k; this.newT = 0.55; this.offT = 0; }
      /* a human hand: late onto a new target, never quite on it */
      this.offT = (this.offT || 0) - dt; if (this.offT <= 0) { this.offT = 0.45; const sk = +(g.P.get('skill') || 1); this.off = [Math.sin(++this.n * 12.9) * 0.3 / sk, Math.sin(this.n * 7.3) * 0.28 / sk]; }
      K.aim = true; const W = c.slot !== 'unarmed'; if (s.strafe) { this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 0.9 + (Math.sin(this.T * 3.7) + 1) * 0.6; this.sdir = -this.sdir; } this.mx = this.sdir * 0.8; }
      if (!k) { const q = this.nearest(false); if (q) this.lookAt(dt, q.x, q.y, 1.3, 4); else this.lookAt(dt, H.lkp.x + Math.cos(C.yaw) * 20, H.lkp.y + Math.sin(C.yaw) * 20, 1.3, 2); return; }
      this.newT -= dt; const kt = c.kickT ?? 9, lead = (k.speed || 0) * 0.14 * (this.n % 2 ? 1 : -1) / +(g.P.get('skill') || 1); let on = kt < 0.11 ? false : this.lookAt(dt, k.x + this.off[0] + lead /* a hand is behind a running man */, k.y, k.z + 0.72 + 0.5 * k.up + this.off[1], s.loose ? 11 : 7);
      /* a player fires when the sights are on the body, not only when they have stopped dead on one point (the flinch under fire and a moving man kept the old test from ever passing: capture h9a, one round fired in five seconds) */
      if (s.loose && !on && kt >= 0.11 && this.aerr < 0.32 / Math.max(4, Math.hypot(k.x - pl.x, k.y - pl.y))) on = true;
      if (W && this.newT <= 0) { const auto = c.slot === 'rifle' || c.slot === 'smg'; if (auto) K.fire = on || this.fireHold > 0; else { this.tapT -= dt; if (this.tapT <= 0 && on) { K.fire = true; if (this.tapT < -0.04) this.tapT = 0.3 + Math.sin(this.T * 5) * 0.04; } } this.fireHold = on ? 0.25 : (this.fireHold || 0) - dt; }
      return; }
    if (s.do === 'flee') {
      /* away from the nearest officer; a wall ahead means turn down the street that has room */
      const k = this.nearest(false), st = g.statics; this.fleeT = (this.fleeT || 0) - dt;
      if (this.fleeH === null || this.fleeT <= 0) { this.fleeT = 1.2; let base = k ? Math.atan2(pl.y - k.y, pl.x - k.x) : C.yaw; if (!k || Math.hypot(k.x - pl.x, k.y - pl.y) > 60) base = this.fleeH ?? base; let best = base, bs = -1e9; for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6]) { const a = base + da, room = st.raycast(pl.x, pl.y, pl.x + Math.cos(a) * 45, pl.y + Math.sin(a) * 45) * 45, sc = Math.min(room, 30) - Math.abs(da) * 5 - (this.fleeH !== null ? Math.abs(wrapPi(a - this.fleeH)) * 4 : 0); if (sc > bs) { bs = sc; best = a; } } this.fleeH = best; }
      this.turn(dt, this.fleeH, 0.14, 8); this.my = 1; this.run = true; if (c.slot !== 'unarmed' && !c.swap && this.t > 0.5) K.want = 'unarmed';
      return; }
  }
  nearest(visible) { const pl = this.g.player; let best = null, bd = 90; for (const k of this.H.cops) { if (k.hp <= 0 || (visible && !k.see)) continue; const d = Math.hypot(k.x - pl.x, k.y - pl.y) - (k.up > 0.8 ? 6 : 0); if (d < bd) { bd = d; best = k; } } return best; }
}

export function register(game, combat, heat, SCRIPTS, Script) {
  for (const n in PLANS) if (!SCRIPTS[n]) SCRIPTS[n] = [{ d: 1 }];
  const name = game.P.get('script'); if (name && PLANS[name]) { combat.script = new Bot(game, combat, heat, name); console.log('[heat] script ' + name); }
}
