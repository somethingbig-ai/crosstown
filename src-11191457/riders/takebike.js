// riders/takebike.js (gameplay/takeover bike, Nov 18; Matt: "I should be able to shoot anywhere and take anything over"): F takes a bicycle or an e-bike.
//   ?takebike=0   off (riders.js does not fetch this file; moto.js's four `bike` lines never see a tagged bike)
// How: the nearest rider's bike (ridden, or on its stand in a parked row) within REACH is handed to the motorcycle code as one of ITS standing bikes
// (moto.spawn: a kerb slot of type 'moto') tagged `bike` = the rider's own look object; the same F press then runs the motorcycle's mount. So boarding, riding,
// leaning, getting off, crashes, the camera, the pad's Triangle and the pistol / SMG rule are the motorcycle's. What differs for a tagged bike:
//   - moto.js does not draw its motorcycle model for it; this file draws the rider lane's bicycle (riders.js draw) where the motorcycle would be;
//   - moto.js caps its speed (bike.top: 8.5 m/s a bicycle, 11 an e-bike) and gives it a pedal's push, not an engine's;
//   - the rider who was on it is put off unhurt: one of the kit's people (kit.person, as mototraffic.js's put-off rider is) stumbles a step to the side away
//     from the player, then runs from him (the way entry.js's hauled driver flees); a box he wore on his back goes with him. Gone after 14 s or 45 m.
//     (Not one of the crowd: cars and bullets do not know him. Without a kit figure he is the rider lane's standing figure, as before.)
//   - no engine: the motorcycle's engine note and its start / stop sounds are silenced while the vehicle is a tagged bike; horn.js rings a bell for it;
//   - the HUD's "F Get on" is offered at a bike in reach (only inside hud.draw: every tryEnter wrap still sees the game's own nearestCar).
const REACH = 2.6, hyp = Math.hypot;
export function install(g, out, K) {
  const pl = g.player, st = g.statics, o1 = {}, scene = g.world && g.world.scene, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const T = (out.tb = { on: true, men: [], stats: { taken: 0, ridden: 0, parked: 0, shoved: 0, runners: 0, offers: 0 }, last: null, err: null });
  const fail = (k, e) => { if (T.err) return; T.err = k + ': ' + String(e && (e.stack || e.message) || e); console.log('[takebike] ' + T.err); };
  // the nearest bike he could take: one being ridden, or one on its stand in a parked row
  function nearBike() { let best = null, bd = REACH;
    for (const r of out.list) { if (r.state !== 'ride' || r.gone) continue; const d = hyp(r.x - pl.x, r.y - pl.y); if (d < bd) { bd = d; best = { r, C: null, d }; } }
    for (const C of out.clumps) { if (Math.abs(C.x - pl.x) > 40 || Math.abs(C.y - pl.y) > 40) continue; for (const b of C.bikes) { const d = hyp(b.x - pl.x, b.y - pl.y); if (d < bd) { bd = d; best = { r: b, C, d }; } } }
    return best; }
  T.nearBike = nearBike;
  // the man who was on it: a stumble to the side away from the player (carrying some of the bike's speed), then he runs from him
  function man(look, x, y, h, v, box) { const sx = -Math.sin(h), sy = Math.cos(h), sg = (x - pl.x) * sx + (y - pl.y) * sy >= 0 ? 1 : -1, f = Math.min(1, v / 4);
    const q = { o: look, x: x + sx * sg * 0.35, y: y + sy * sg * 0.35, h, v0: v * 0.5, dir: Math.atan2(sy * sg + Math.sin(h) * f, sx * sg + Math.cos(h) * f), t: 0, vis: null, box: !!box };
    try { const ks = g.kit && g.kit.pedKinds ? g.kit.pedKinds() : (g.peds && g.peds.kinds) || [], kind = ks.length ? ks[(look.pv || 0) % ks.length] : null, vis = kind && scene ? g.kit.person(kind) : null, run = vis && vis.acts && vis.mixer ? (vis.acts.jog ? 'jog' : vis.acts.run ? 'run' : vis.acts.walk ? 'walk' : null) : null;
      if (run) { vis.mixer.stopAllAction(); vis.mixer.timeScale = 1; vis.acts[run].reset().play(); vis.object.position.set(q.x, 0, -q.y); vis.object.rotation.set(0, h, 0); scene.add(vis.object); q.vis = vis; T.stats.runners++; } } catch (e) { fail('man', e); }
    T.men.push(q); T.stats.shoved++; while (T.men.length > 6) drop(0); }
  function drop(i) { const q = T.men[i]; T.men.splice(i, 1); if (q && q.vis) try { scene.remove(q.vis.object); } catch (e) {} }
  function take(n) { const m = g.moto, r = n.r; if (!m || !m.spawn) return false; const h = r.hv !== undefined && !n.C ? r.hv : r.h;
    if (n.C) { const i = n.C.bikes.indexOf(r); if (i < 0) return false; n.C.bikes.splice(i, 1); if (r.circ) for (const q of r.circ) q.on = false; if (r.sit) { r.sit.pv = r.sit.pv || 0; man(r.sit, r.x, r.y, h, 0, false); r.sit = null; } T.stats.parked++; }
    else { const i = out.list.indexOf(r); if (i < 0) return false; out.list.splice(i, 1); man(r, r.x, r.y, h, r.v || 0, r.box === 2 || r.box === 4); T.stats.ridden++; }
    // what the bike keeps: a box or crate on the rack stays on it; a box worn on the back goes with the man
    const look = Object.assign({}, r, { box: r.box === 2 ? 0 : r.box === 4 ? 3 : r.box, top: r.bk === 0 ? 11 : 8.5, odo: r.odo || 0 });
    const s = m.spawn(r.x, r.y, h, 0x202226); s.bike = look; T.stats.taken++; T.last = { t: g.t, x: r.x, y: r.y, ridden: !n.C, top: look.top }; return true; }
  // the prompt: inside hud.draw only, a bike in reach that is nearer than what the game offers is offered as a motorcycle slot would be (moto.js then words it "Get on")
  const nc0 = g.nearestCar.bind(g), dOf = (n) => { const o = n && (n.v || n.s || n.c); return o ? hyp(o.x - pl.x, o.y - pl.y) : 1e9; }; let inHud = false;
  g.nearestCar = function (d) { const n = nc0(d); if (!inHud || !T.on || pl.vehicle || pl.busy) return n;
    try { const b = nearBike(); if (b && b.d < dOf(n)) { const f = { kind: 'bike', s: { type: 'moto', bikeOffer: true, x: b.r.x, y: b.r.y, h: b.r.h } }; if (g.moto) g.moto.near = f; T.stats.offers++; return f; } } catch (e) { fail('offer', e); } return n; };
  if (g.hud && typeof g.hud.draw === 'function') { const hd0 = g.hud.draw.bind(g.hud); g.hud.draw = function (...a) { inHud = true; try { return hd0(...a); } finally { inHud = false; } }; }
  // no engine on a bicycle: the motorcycle's note is turned down each frame it would sound, and its starter / shut-off are not played
  try { const s = g.sound; if (s && typeof s.update === 'function') { const su0 = s.update.bind(s); s.update = function (dt) { su0(dt); const v = pl.vehicle; if (v && v.bike && s.eg && s.ac) { try { s.eg.gain.cancelScheduledValues(s.ac.currentTime); s.eg.gain.setTargetAtTime(0, s.ac.currentTime, 0.02); } catch (e) {} } }; }
    const m = g.moto; if (m && typeof m.snd === 'function') { const snd0 = m.snd; m.snd = (k) => { const b = pl.busy, v = (b && b.v) || pl.vehicle; if (v && v.bike && (k === 'start' || k === 'stop')) return; return snd0(k); }; } } catch (e) { fail('sound', e); }
  const te0 = g.tryEnter.bind(g);
  g.tryEnter = function () {
    try { if (T.on && !pl.vehicle && !pl.busy && !(g.moto && g.moto.fall)) { const b = nearBike(); if (b) { let n = null; try { n = nc0(); } catch (e) {} if (b.d < dOf(n)) take(b); } } } catch (e) { fail('take', e); }
    return te0();
  };
  const step0 = g.step.bind(g);
  g.step = function (dt) { step0(dt);
    try { const v = pl.vehicle; if (v && v.bike) v.bike.odo = (v.bike.odo || 0) + (v.vf || 0) * dt;
      for (let i = T.men.length - 1; i >= 0; i--) { const q = T.men[i]; q.t += dt; if (q.t > 0.55) q.dir = Math.atan2(q.y - pl.y, q.x - pl.x);
        const sp = Math.min(3.6, 1.2 + q.t * 3) + q.v0 * Math.exp(-4 * q.t); q.h += wrap(q.dir - q.h) * Math.min(1, dt * 7);
        if (q.vis || q.t < 1) { st.resolve(q.x + Math.cos(q.dir) * sp * dt, q.y + Math.sin(q.dir) * sp * dt, 0.28, o1, true); q.x = o1.x; q.y = o1.y; }      /* (the stand-in figure has no run: it takes its step and stands) */
        if (q.vis) { const o = q.vis.object; o.position.set(q.x, st.onSidewalk(q.x, q.y) ? 0.15 : 0, -q.y); o.rotation.set(0, q.h, q.t < 0.55 ? -0.32 * Math.sin(Math.PI * q.t / 0.55) : 0); q.vis.mixer.timeScale = Math.max(0.5, Math.min(1.4, sp / 2.8)); q.vis.mixer.update(dt); }
        if (q.t > 2 && (q.t > (q.vis ? 14 : 90) || hyp(q.x - pl.x, q.y - pl.y) > 45)) drop(i); } } catch (e) { fail('step', e); }
  };
  // called from riders.js's sync, while its instance batches are open
  T.draw = (near) => { try { const m = g.moto; if (!m) return;
      for (const v of g.vehicles) if (v.bike) K.draw(v.bike, v.x, v.y, v.z || 0, v.h, -(v.lean || 0), null);
      for (const s of m.bikes) if (s.bike && !s.gone) K.draw(s.bike, s.x, s.y, ((s.zf || 0) + (s.zr || 0)) / 2, s.h, -(s.lean || 0), null);
      for (const q of T.men) { const z = st.onSidewalk(q.x, q.y) ? 0.15 : 0; if (!q.vis) K.fig(q.o, q.x, q.y, z, q.h, near(q.x, q.y)); if (q.box && K.box) K.box(q.o, q.x, q.y, z, q.h); } } catch (e) { fail('draw', e); } };
  console.log('[takebike] on');
  return T;
}
