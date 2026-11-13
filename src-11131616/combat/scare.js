// combat/scare.js: THE WORLD REACTS, people on foot (gameplay lane, world helper, Nov 13; on the people helper's scare.js c77c0cfb and the
// fear step of people.js). Drivers are in drivers.js, which this file fetches after the game is playable. Off: ?scare=0 (people and
// drivers both: the game's reactions as they were), ?drivers=0 (drivers only).
// One file: nothing of the game's, the crowd's or people.js is edited. `install(game, combat)` once after combat is built. When the
// lane's people.js is on (the default) its own fear step is answered from here (Bodies.scare / frighten / stepFear are replaced on the
// instance, its lists and its Cower / Duck clips are shared, so its crouch for the kit's pedestrians keeps working).
//   a gun in the hand   people within 5 m who are facing it take it in (half of them), look for a moment, then walk off briskly; they
//                       do not look again for a minute, so a street does not empty because a pistol is carried
//   aiming              people down the barrel (22 m, in view) and anyone close: a duck, a frozen second or straight to ground, then they run
//   a shot, a blast     everyone in earshot after a human reaction time that grows with distance. Close: duck first / go to ground with
//                       the hands over the head / stand rooted / run at once, each at a pace of their own. Far: look toward it, then
//                       hurry off (a fast walk or a jog). All AWAY FROM THE GUN along the walks, each in the lane they were in; a
//                       walk that leads to the gun is turned round on; someone waiting at a kerb goes back along the walk unless the
//                       crossing is clear and leads away. While it goes on nobody calms; 9-15 s after the last shot they walk again.
//   a car on the walk   (the player's, moving) people beside its path jump clear sideways, people round it startle and run from it
//   someone run over    people near startle and get away; people further off stop and stare, then turn away
//   a crash             (the player's car, hard) people close flinch (duck), back off, then stand and look; further off they stop and look
//   a body              nobody strolls past: someone walking toward a body that they can see stops, looks, and turns back
// Works on both kinds of people: the street crowd (through its own sim) and the game's kit pedestrians (stop, crouch, run along their loop).
// Cost: nobody afraid, no gun out, not at the wheel, no body down: one test a step. A gun out: people near are looked at 5 times a
// second. At the wheel: one speed test a step, and a sidewalk test 5 times a second while the car moves.
import { clamp } from '../geo.js';


class Scare {
  constructor(game, combat) {
    this.g = game; this.c = combat; this.on = true; this.t = 0; this.threats = []; this.pending = []; this.afraid = []; this.downs = []; this.seedN = 90210; this.sim = null; this.B = null; this.cower = null; this.duck = null;
    this.gunT = 0; this.carT = 0; this.bodT = 0; this.adoptT = 0; this._shotAt = null; this._t = {}; this._crash = { x: 0, y: 0, t: -9 }; this.listeners = []; this.drivers = null; this.ms = 0;
    this.stats = { wary: 0, alarmed: 0, panic: 0, shots: 0, crashes: 0, pedhits: 0, carScares: 0, bodyLooks: 0, cower: 0, duck: 0, look: 0 };
  }
  rnd() { this.seedN = (this.seedN * 1664525 + 1013904223) >>> 0; return this.seedN / 4294967296; }
  emit(ev) { for (const f of this.listeners) { try { f(ev); } catch (e) { this.err(e); } } }
  // the lane's people.js (Bodies): its lists and clips are shared, its fear step is ours
  adopt(B) {
    if (!B || this.B === B) return; this.B = B; const S = this;
    for (const k of ['threats', 'pending', 'afraid']) { if (Array.isArray(B[k])) { for (const q of this[k]) B[k].push(q); this[k] = B[k]; } }
    B.scare = function (x, y, r, level) { if (!B.on || !S.on) return false; try { S.scare(x, y, r, level); } catch (e) { S.err(e); } return true; };
    B.frighten = function (p, kind, x, y, secs) { if (!B.on || !S.on) return false; try { S.frighten(p, kind, x, y, secs); } catch (e) { S.err(e); } return true; };
    B.stepFear = function (dt) { B.t += dt; S.step(dt); };
  }
  // the crowd may be built after combat: taken up when it is there; the two made-up clips are people.js's (none with ?gpeople=0: then nobody crouches)
  crowd() {
    if (!this.sim) { const cr = this.g.crowd; if (!cr || !cr.on || !cr.sim) return null; this.sim = cr.sim; }
    if (!this.cower) { const cl = this.sim.clips || []; this.cower = cl.find((c) => c.name === 'Cower') || null; this.duck = cl.find((c) => c.name === 'Duck') || null; }
    return this.sim;
  }
  // someone comes to know of something after `delay` s. lv 0 wary, 1 alarmed, 2 panic; tag: what it is (null: the shooting)
  note(p, kind, lv, tag, delay) {
    const t = this.t; if (p._re) { if (lv > (p._lv || 0)) { p._lv = lv; p._tag = tag; p._re = Math.min(p._re, t + delay); } return; }
    p._re = t + delay; p._lv = lv; p._tag = tag; this.pending.push({ p, kind });
  }
  // ---------------------------------------------------------------- a shot or a blast at (x, y): heard within r
  scare(x, y, r, level) {
    const t = this.t, rnd = () => this.rnd(), sim = this.crowd(), pl = this.g.player; this.stats.shots++;
    // someone shot dead: the people round them come to know, but what they run from is the gun, not the body
    let tx = x, ty = y, kill = false; { const k = this._shotAt; if (k && k.x === x && k.y === y && pl) { tx = pl.x; ty = pl.y; kill = true; } this._shotAt = null; }
    let th = this.threats.find((q) => Math.hypot(q.x - tx, q.y - ty) < 6); if (!th) { this.threats.push((th = { x: tx, y: ty, t, level, r })); if (this.threats.length > 8) this.threats.shift(); } th.t = t; th.x = tx; th.y = ty; th.level = Math.max(th.level, level); th.r = Math.max(th.r, r + Math.hypot(tx - x, ty - y));
    const r2 = r * r, see = (p, kind) => { const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 > r2) return; const d = Math.sqrt(d2); if (level < 2 && d > r * 0.55 && rnd() < 0.3) { this.note(p, kind, 2, null, 1.4 + rnd() * 2.2); return; }      // far off, one shot: not everyone has understood yet; they do when the others run
      this.note(p, kind, 2, null, d < 10 ? 0.12 + rnd() * 0.16 : 0.16 + d / 343 + rnd() * 0.28 + (d / r) * (d / r) * (level < 2 ? 1.1 : 0.6) * rnd()); };
    for (const p of this.g.peds.list) if ((!p.fear || p.fear.lv < 2) && p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (!a || a.gone || a.state === 'down' || (a.fear && a.fear.lv >= 2)) continue; see(a, 'crowd'); if (a._re && a.state === 'sit') a._re += rnd() * 0.3; } }
    const boom = level >= 2 && r >= 60; if (boom) { th.t = t + 8; const D = this.downs; D.push({ p: { gone: false, state: 'fire' }, kind: 'fire', x, y, t }); if (D.length > 10) D.shift(); }      // a blast: the fright lasts longer, and nobody strolls past the fire
    this.emit({ kind: boom ? 'boom' : 'shot', x: tx, y: ty, ex: x, ey: y, r, level, kill });
  }
  // someone who was just hit and lives: they know at once
  frighten(p, kind, x, y, secs) {
    if (p.gone || p.state === 'down') return; if (p.fear && p.fear.lv >= 2) { p.fear.T = Math.max(p.fear.T, secs); p.fear.hold = Math.min(p.fear.hold || 0, 0.3); p.fear.look = Math.min(p.fear.look || 0, 0.3); return; }
    this.crowd(); if (!this.threats.length) this.threats.push({ x, y, t: this.t, level: 1, r: 40 });
    if (!p._re) this.pending.push({ p, kind }); p._re = this.t + 0.3; p._lv = 2; p._tag = null; p._hit = true;
  }
  // something that is not gunfire, at a place: people within rNear are alarmed (startle, get away), people out to rFar stop and look
  alarm(x, y, rNear, rFar, o = {}) {
    const rnd = () => this.rnd(), sim = this.crowd(), st = this.g.statics, R2 = rFar * rFar;
    const see = (p, kind) => { if (p.fear && p.fear.lv >= 1) return; const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 > R2) return; const d = Math.sqrt(d2);
      if (d < rNear) this.note(p, kind, 1, { x, y, fix: true, clear: o.clear || 16, T: o.T || 4 + rnd() * 3, stare: rnd() < (o.stareP ?? 0.6) ? 1.5 + rnd() * 4 : 0, src: o.src }, 0.12 + rnd() * 0.3 + d * 0.01);
      else { if (rnd() > (o.farP ?? 0.75) || (kind === 'crowd' && p.state === 'sit')) return; if (d > 14 && st.raycast && st.raycast(x, y, p.x, p.y) < 1) return;      // round a corner: heard, not seen, not worth stopping for
        this.note(p, kind, 0, { x, y, fix: true, clear: o.clear || 16, look: 1.2 + rnd() * (o.lookMax || 4), src: o.src }, 0.25 + rnd() * 0.7 + d * 0.02); } };
    for (const p of this.g.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (a && !a.gone && a.state !== 'down' && a.state !== 'flee') see(a, 'crowd'); } }
  }
  // the player's car hit something hard (game.onCrash): force is the closing speed, m/s
  crash(v, force) {
    if (!(force > 5.5) || !v) return; const t = this.t, C = this._crash; if (t - C.t < 2.5 && Math.hypot(v.x - C.x, v.y - C.y) < 12) return; C.t = t; C.x = v.x; C.y = v.y; this.stats.crashes++;
    this.alarm(v.x, v.y, clamp(3 + force * 0.6, 6, 14), clamp(10 + force * 1.6, 16, 42), { src: 'crash', clear: 12 });
    this.emit({ kind: 'crash', x: v.x, y: v.y, force, v });
  }
  // someone was run over (game.onPedHit)
  pedHit(p, v) {
    if (!p) return; this.stats.pedhits++; this.down(p, p.loop ? 'ped' : 'crowd');
    this.alarm(p.x, p.y, 9, 24, { src: 'runover', clear: 18, T: 5 + this.rnd() * 3, stareP: 0.35, farP: 0.8 });
    this.emit({ kind: 'pedhit', x: p.x, y: p.y, v });
  }
  down(p, kind) { if (!p) return; const D = this.downs; if (D.some((d) => d.p === p)) return; D.push({ p, kind, x: p.x, y: p.y, t: this.t }); if (D.length > 10) D.shift(); }
  // ---------------------------------------------------------------- the gun itself, seen (no sound): only while one is in the hand
  gun(dt) {
    this.gunT -= dt; if (this.gunT > 0) return; this.gunT = 0.2;
    const g = this.g, c = this.c, pl = g.player, t = this.t, rnd = () => this.rnd(), aim = !!(c.inp && c.inp.aim), yaw = g.cam ? g.cam.yaw : pl.h, ax = Math.cos(yaw), ay = Math.sin(yaw), R = aim ? 22 : 5, R2 = R * R, sim = this.crowd(), px = pl.x, py = pl.y;
    const see = (p, kind) => { const dx = p.x - px, dy = p.y - py, d2 = dx * dx + dy * dy; if (d2 > R2 || p.fear || p._re) return; const d = Math.sqrt(d2) || 1e-3;
      const inLine = aim && (dx * ax + dy * ay) / d > (d < 8 ? 0.8 : 0.93), faces = -(Math.cos(p.h) * dx + Math.sin(p.h) * dy) / d;      // faces > 0: turned toward the gun
      if (inLine) { if (kind === 'crowd' && p.state === 'sit' && d > 8) return; if (g.statics.raycast && g.statics.raycast(px, py, p.x, p.y) < 1) return; this.note(p, kind, 1, { gun: true }, 0.14 + rnd() * 0.45 + d * 0.02); return; }      // (someone a gun is pointed at knows, whether or not they had shrugged it off when it was only carried)
      if (p._seen > t || d > (aim ? 11 : 5)) return; if (kind === 'crowd' && p.state === 'sit') { p._seen = t + 8; return; }      // a gun held up and aimed is seen from further off than one carried low
      if (d > 2.4 && faces < (d > 5 ? 0.35 : 0.1)) { p._seen = t + 1.5; return; }      // not turned toward it and not right beside it: has not seen it (asked again soon)
      if (rnd() > (aim ? (d > 5 ? 0.6 : 0.9) : 0.5)) { p._seen = t + 15 + rnd() * 15; return; }      // looked, and did not take it in
      this.note(p, kind, aim && d < 4 ? 1 : 0, { gun: true }, 0.25 + rnd() * 0.9); };
    for (const p of g.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (!a || a.gone || a.state === 'down' || a.state === 'flee') continue; const dx = a.x - px; if (dx > R || dx < -R) continue; see(a, 'crowd'); } }
  }
  // ---------------------------------------------------------------- the player's car on a sidewalk, moving: 5 times a second
  car(dt) {
    const g = this.g, v = g.player.vehicle; if (!v || v.vx === undefined) return; const sp2 = v.vx * v.vx + v.vy * v.vy; if (sp2 < 9) return;
    this.carT -= dt; if (this.carT > 0) return; this.carT = 0.2;
    const st = g.statics, sp = Math.sqrt(sp2), ux = v.vx / sp, uy = v.vy / sp, nose = (v.def ? v.def.len : 4) * 0.4;
    if (!st.onSidewalk(v.x + ux * nose, v.y + uy * nose) && !st.onSidewalk(v.x, v.y)) return;
    const t = this.t, rnd = () => this.rnd(), sim = this.crowd(), ahead = 6 + sp * 1.4, hw = (v.def ? v.def.wid : 1.9) / 2; let n = 0;
    const see = (p, kind) => { const dx = p.x - v.x, dy = p.y - v.y; if (dx > 40 || dx < -40 || dy > 40 || dy < -40) return; const f = dx * ux + dy * uy, s = -dx * uy + dy * ux, as = Math.abs(s); if (f < -5 || f > ahead + 8 || as > 11) return;
      if (p.fear && p.fear.lv >= 1) { p.fear.T = Math.max(p.fear.T, 3); return; }
      // beside the path (the crowd's own rule moves those IN it): jump clear, sideways and a little on, not along it
      if (kind === 'crowd' && f > -1 && f < ahead && as < hw + 2.6 && as >= hw + 0.75 && p.state !== 'sit' && p.state !== 'flee') { const sg = s < 0 ? -1 : 1, k = 0.25 * (rnd() - 0.3); this.sideStep(p, -uy * sg + ux * k, ux * sg + uy * k, 0.7 + rnd() * 0.5); }
      if (kind === 'crowd' && p.state === 'sit') return;
      n++; this.note(p, kind, 1, { veh: v, x: v.x, y: v.y, clear: 22, T: 4 + rnd() * 4 }, 0.08 + rnd() * 0.4 + Math.hypot(dx, dy) * 0.015); };
    for (const p of g.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (a && !a.gone && a.state !== 'down') see(a, 'crowd'); } }
    if (n) { this.stats.carScares += n; if (t - (this._carEv || -9) > 1.5) { this._carEv = t; this.emit({ kind: 'onwalk', x: v.x, y: v.y, v }); } }
  }
  // a short run in a straight line (the crowd's own 'flee': walls are followed, the walk is rejoined when it is over)
  sideStep(p, vx, vy, secs) {
    const cs = this.sim; try { cs.leaveGroup(p); } catch (e) {} if (p.state === 'stand') cs.nStand--; if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    const L = Math.hypot(vx, vy) || 1; p.state = 'flee'; p.t = 1.6 - secs; p.vx = vx / L; p.vy = vy / L; p.standT = 0; cs.setClip(p, cs.jog);
  }
  // ---------------------------------------------------------------- bodies: nobody strolls past one. Twice a second while one lies there
  bodies(dt) {
    this.bodT -= dt; if (this.bodT > 0) return; this.bodT = 0.5;
    const g = this.g, t = this.t, D = this.downs, rnd = () => this.rnd(), st = g.statics, sim = this.crowd();
    for (let i = D.length - 1; i >= 0; i--) { const d = D[i], p = d.p; if (t - d.t > 55 || (d.kind === 'ped' && !g.peds.list.includes(p)) || (d.kind === 'crowd' && p.gone)) { D.splice(i, 1); continue; } if (!p.gone && p.state === 'down') { d.x = p.x; d.y = p.y; } }
    // where the bodies are: people.js's own (a shot body lies until its place in the pool of twelve is needed: for two minutes people mind it),
    // and anyone a car has put down (the crowd clears those itself)
    const L = this._bl || (this._bl = []), B = this.B; L.length = 0; for (const d of D) L.push(d.x, d.y);
    if (B) { for (const b of B.live) { const dl = b.doll; if (!dl || !(b.t < 120)) continue; const x = dl.p[36], y = -dl.p[38]; if (isFinite(x) && isFinite(y)) L.push(x, y); }      // (36, 38: the pelvis, doll.js I.P = 12)
      for (const p of B.peds) if (p.state === 'down' && p.body && p.body.doll && p.body.doll.t < 120) L.push(p.x, p.y); }
    if (!L.length) return;
    const see = (p, kind) => { if (p.fear || p._re || p._seen > t) return; for (let k = 0; k < L.length; k += 2) { const dx = L[k] - p.x, dy = L[k + 1] - p.y; if (dx > 9 || dx < -9 || dy > 9 || dy < -9) continue; const d2 = dx * dx + dy * dy; if (d2 > 81 || d2 < 0.6) continue; const dd = Math.sqrt(d2);
        if ((Math.cos(p.h) * dx + Math.sin(p.h) * dy) / dd < 0.2 && !(kind === 'crowd' && p.state === 'stand' && dd < 5)) continue;      // walking away from it already
        if (st.raycast && st.raycast(p.x, p.y, L[k], L[k + 1]) < 1) { p._seen = t + 2; return; }
        this.stats.bodyLooks++; this.note(p, kind, 0, { x: L[k], y: L[k + 1], fix: true, clear: 15, look: rnd() < 0.35 ? 2.5 + rnd() * 4 : 0.7 + rnd() * 1.3, src: 'body' }, rnd() * 0.5); return; } };
    for (const p of g.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (a && !a.gone && (a.state === 'walk' || a.state === 'stand') && !a.lead) see(a, 'crowd'); } }
  }
  threatFor(p) { let best = null, bd = 1e9; for (const q of this.threats) { if (this.t - q.t > 9) continue; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = q; } } this._td = bd; return best; }
  // ---------------------------------------------------------------- the moment someone understands
  react(p, kind) {
    const rnd = () => this.rnd(), lv = p._lv || 0, tag = p._tag, pl = this.g.player, sim = this.sim, st = this.g.statics; p._lv = 0; p._tag = null;
    const old = p.fear; if (old && old.lv >= lv) return;
    let th; if (lv >= 2 && !tag) th = this.threatFor(p) || this.threats[this.threats.length - 1]; else if (!tag || tag.gun) th = { x: pl.x, y: pl.y }; else th = { x: tag.x, y: tag.y }; if (!th) return;
    const d = Math.hypot(p.x - th.x, p.y - th.y), sat = kind === 'crowd' && p.state === 'sit';
    if (sat) { if (lv < 2 && !(lv === 1 && d < 9)) return; if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } try { sim.leaveGroup(p); } catch (e) {} p.w = null; try { sim.rejoin(p); } catch (e) {} if (p.gone || !p.w) return; p.v = 0; }
    // what they do first: hold = a duck (the startle), look = stand turned to it (a look, a stare, or rooted to the spot), cow = to ground
    const q = rnd(); let hold = 0, look = 0, cow = 0, far = false;
    if (old && (old.hold > 0 || old.look > 0)) { hold = old.hold > 0 ? old.hold : 0; look = old.look > 0 ? Math.min(old.look, 0.5) : 0; }
    else if (sat) hold = 0.28 + rnd() * 0.25;
    else if (p._hit) { /* hit: off at once */ }
    else if (lv === 0) look = tag && tag.look ? tag.look : q < 0.7 ? 0.35 + rnd() * 0.7 : 0;
    else if (lv === 1) { if (q < 0.42) hold = 0.2 + rnd() * 0.45; else if (q < 0.56) look = 0.5 + rnd() * 1.1; else if (q < 0.68 && !(tag && tag.veh)) cow = 2.5 + rnd() * 5; }
    else if (d > 32) { far = true; if (q < 0.5) look = 0.4 + rnd() * 1.0; else if (q < 0.62) hold = 0.25 + rnd() * 0.4; }
    else { const cq = d < 16 ? 0.2 : 0.1; if (q < 0.26) hold = 0.25 + rnd() * 0.45; else if (q < 0.26 + cq) cow = 2.5 + rnd() * 7; else if (q < 0.34 + cq) look = 0.6 + rnd() * 1.3; }
    p._hit = false;
    if (kind === 'crowd' ? p.state === 'cross' || p.state === 'flee' : p.onRoad) { if (lv === 0 && !(tag && tag.gun)) return; hold = look = cow = 0; }      // out on the roadway: nobody stops there to look
    if (cow && (kind === 'crowd' ? !this.cower || p.state === 'cross' || p.state === 'flee' || !st.onSidewalk(p.x, p.y) : !this.B || p.state !== 'walk' || p.onRoad)) cow = 0;
    if (hold && kind === 'ped' && !this.B) { look = hold; hold = 0; }
    let F = old; const T = tag && tag.T ? tag.T : lv === 0 ? 5 + rnd() * 5 : lv === 1 ? 7 + rnd() * 5 : 9 + rnd() * 6;
    if (F) { this.endStand(p, F); F.lv = lv; F.T = T; F.run = false; } else { F = p.fear = { lv, T, hold: 0, look: 0, cower: 0, think: 0, kind, run: false, v: 0, calm: null }; this.afraid.push(p); }
    F.hold = hold; F.look = look; F.pace = rnd(); F.far = far; F.th = lv >= 2 && !tag ? null : th; F.veh = tag && tag.veh ? tag.veh : null; F.fix = !!(tag && tag.fix); F.clear = tag && tag.clear !== undefined ? tag.clear : 22; F.stare = (tag && tag.stare) || 0; F.src = (tag && tag.src) || null;
    if (lv >= 2) this.stats.panic++; else if (lv) this.stats.alarmed++; else this.stats.wary++;
    // someone starts at a gun pointed their way: the people right beside them notice THEM, look, and move off too (half of them)
    if (lv === 1 && tag && tag.gun && sim) { const L = sim.agents, t = this.t; for (let i = 0; i < L.length; i++) { const a = L[i]; if (!a || a === p || a.gone || a.fear || a._re || a.state === 'down' || a.state === 'sit' || a.state === 'flee') continue; const dx = a.x - p.x, dy = a.y - p.y; if (dx > 4 || dx < -4 || dy > 4 || dy < -4 || rnd() < 0.5) continue; this.note(a, 'crowd', 0, { gun: true }, 0.3 + rnd() * 0.9); } }
    if (kind === 'crowd') { if (!F.calm) F.calm = { v0: p.v0 };
      if (p.state === 'flee') { F.hold = F.look = 0; F.run = true; return; }      // already jumping clear of a car: the rest when that is over
      if (cow) { this.stats.cower++; this.startCower(p, F, cow); return; }
      if (look > 0) { this.stats.look++; this.startLook(p, F, th); }
      else if (hold > 0) { this.stats.duck++; F.v0 = p.v0; p.v0 = 0; if (this.duck) { try { sim.leaveGroup(p); } catch (e) {} F.idle = p.idle; p.idle = this.duck; p.talk = null; p.walkClip = this.duck; p.v = Math.min(p.v, 0.5); sim.setClip(p, this.duck); p.ph = sat ? 0.1 : 0; } } }
    else { if (!F.calm) F.calm = { speed: p.speed, walk: p.walk, walkSpeed: p.walkSpeed };
      if (cow) { this.stats.cower++; F.cower = cow; p.speed = 0.02; return; }
      if (hold > 0) { this.stats.duck++; p.speed = 0.02; }
      else if (look > 0) { this.stats.look++; p.speed = 0.02; const t = this._t; p.loop.at(p.s, t); if ((t.tx * (th.x - p.x) + t.ty * (th.y - p.y)) * p.dir < 0) p.dir = -p.dir; } }      // turns to it
    if (!hold && !look) this.run(p, F, th);
  }
  // stands where they are, turned to it, for the length of the look (the crowd's own 'stand' state turns them)
  startLook(p, F, th) {
    const cs = this.sim; if ((p.state !== 'walk' && p.state !== 'stand') || p.lead || p.fol) { F.v0 = p.v0; p.v0 = 0; return; }
    if (p.state !== 'stand') { p.state = 'stand'; cs.nStand++; } p.t = 0; p.standT = 1e9; p.tx = p.x; p.ty = p.y; p.th = Math.atan2(th.y - p.y, th.x - p.x); p.talk = null; p.v = Math.min(p.v, 0.4); F.stood = true;
  }
  startCower(p, F, secs) {
    const cs = this.sim; try { cs.leaveGroup(p); } catch (e) {} if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state !== 'stand') { p.state = 'stand'; cs.nStand++; } p.t = 0; p.standT = 1e9; p.tx = p.x; p.ty = p.y; p.th = p.h; p.talk = null; p.v = Math.min(p.v, 0.3);
    F.idle = p.idle; p.idle = this.cower; cs.setClip(p, this.cower); F.cower = secs; F.hold = 0; F.look = 0;
  }
  endStand(p, F) { F.cower = 0; F.stood = false; if (F.idle) { p.idle = F.idle; F.idle = null; } if (F.kind === 'crowd' && F.v0) { p.v0 = F.v0; F.v0 = 0; } }
  run(p, F, th) {
    const rnd = () => this.rnd(), lv = F.lv, u = F.pace, easy = lv === 0 ? u < 0.7 : F.far && u < 0.3 && !(th && Math.hypot(p.x - th.x, p.y - th.y) < 42); F.run = true; F.hold = 0; F.look = 0; this.endStand(p, F);
    if (F.kind === 'ped') { if (p.state !== 'walk') return; const base = (F.calm && F.calm.speed) || 1.4;
      if (easy) p.speed = base * (1.35 + u * 0.5);      // walks off, fast
      else { p.speed = lv === 0 ? 3.0 + u : lv === 1 || F.far ? 3.4 + u * 1.4 : 3.6 + u * 1.9; if (p.vis.acts && p.vis.acts.run) { p.walk = 'run'; p.walkSpeed = p.vis.runSpeed || 4; this.g.peds.setAnim(p, 'run'); } }
      if (th) this.steer(p, F, th, true); return; }
    const cs = this.sim; if (th) { const ax = p.x - th.x, ay = p.y - th.y, l = Math.hypot(ax, ay) || 1; p.gx = ax / l; p.gy = ay / l; }
    if (lv > 0 || p.lead || p.fol) { try { cs.leaveGroup(p); } catch (e) {} }
    if (p.state === 'sit') { if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } p.w = null; p.state = 'walk'; if (th) { p.h = Math.atan2(p.y - th.y, p.x - th.x); } p.v = 1.8; }
    if (p.state === 'stand') { cs.nStand--; p.state = 'walk'; p.standT = 0; }
    if (!p.w) { try { cs.rejoin(p); } catch (e) {} if (p.gone || !p.w) { p.fear = null; return; } }
    // waiting at the kerb: over the crossing only when it is clear and leads away from it; else back along the walk (not out into the traffic)
    if (p.state === 'wait') { const w = p.w; let over = false; try { over = w.kind === 'cross' && (w.ux * p.gx + w.uy * p.gy) * p.d > 0.15 && cs.canWalk(w, p, 0); } catch (e) {}
      if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
      if (over || w.kind !== 'cross') { p.state = w.kind === 'cross' ? 'cross' : 'walk'; p.lt = clamp((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny, -1.8, 1.8); p.la = 0; }
      else { try { cs.rejoin(p); } catch (e) {} if (p.gone || !p.w) { p.fear = null; return; } } }
    else if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state === 'flee') return;
    p.talk = null; p.path = null; p.noPlan = null; p.trip = 1e9; p.door = 0;
    if (easy) { try { cs.pace(p, 1.7 + u * 0.45); } catch (e) {} F.v = p.v0; cs.setClip(p, p.walkClip); }      // a brisk walk away, not a run
    else { try { cs.hold(p, null); } catch (e) {} p.walkClip = cs.jog; const k = lv === 0 ? 0.95 + u * 0.2 : lv === 1 || F.far ? 1.02 + u * 0.4 : 1.1 + u * 0.66;      // a hurry ... flat out: no two alike
      F.v = p.v0 = Math.min(5.5, cs.jog.speed * p.tall * k); p.v = Math.max(p.v, lv >= 2 && !F.far ? 2.1 + rnd() * 1.3 : 1.3 + rnd() * 0.9);      /* off the mark: the crowd's own pick-up is a stroller's */ cs.setClip(p, cs.jog); p.ph = rnd(); }
    if (th) this.steer(p, F, th, true);
  }
  // keep going away from it: along the walk one is on; turn round if that walk leads back toward it
  steer(p, F, th, first) {
    const ax = p.x - th.x, ay = p.y - th.y, l = Math.hypot(ax, ay) || 1;
    if (F.kind === 'ped') { const t = this._t; p.loop.at(p.s, t); const al = (t.tx * ax + t.ty * ay) / l * p.dir; if (al < (first ? 0 : -0.3) && l < 50) p.dir = -p.dir; return; }
    p.gx = ax / l; p.gy = ay / l; const w = p.w; if (!w || w.kind === 'cross' || w.ux === undefined) return;
    const al = (w.ux * p.gx + w.uy * p.gy) * p.d; if (al < (first ? -0.08 : -0.35) && l < 50) { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; }
  }
  calm(p, F) {
    p.fear = null; if (p.gone || p.state === 'down') return;
    if (F.src === 'body' || F.th && !F.fix && !F.veh) p._seen = this.t + (F.lv === 0 ? 45 + this.rnd() * 30 : 14 + this.rnd() * 10);
    if (F.kind === 'ped') { if (F.calm) { p.speed = F.calm.speed; p.walk = F.calm.walk; p.walkSpeed = F.calm.walkSpeed; this.g.peds.setAnim(p, p.walk); } }
    else { if (F.idle) { p.idle = F.idle; F.idle = null; } if (p.state === 'stand' && p.standT > 1e8) { p.standT = 0; p.t = 1; }
      try { this.sim.pace(p, 1.2 + this.rnd() * 0.5); this.sim.setClip(p, p.walkClip); } catch (e) { p.v0 = (F.calm && F.calm.v0) || 1.3; } }
    // got clear of a crash or of someone run over: some turn and stand looking at it from where they now are
    if (F.stare > 0 && F.th && p.state === 'walk') this.note(p, F.kind, 0, { x: F.th.x, y: F.th.y, fix: true, clear: 0, look: F.stare, src: 'stare', T: 2 + this.rnd() * 3 }, 0.05);
  }
  step(dt) {
    if (!this.on) return; const c = this.c, pl = this.g.player, A = this.afraid, P = this.pending, armed = c.armedFoot && c.armedFoot(), drive = !!pl.vehicle;
    const t = (this.t += dt); if (!this.B) { if ((this.adoptT -= dt) <= 0) { this.adoptT = 2; if (c.bodies) this.adopt(c.bodies); } }
    const lying = this.downs.length || (this.B && (this.B.live.length || this.B.peds.length));
    if (!armed && !drive && !A.length && !P.length && !lying) return;      // nothing to do
    const t0 = performance.now();
    if (armed) this.gun(dt); else if (drive) this.car(dt);
    if (lying) this.bodies(dt);
    for (let i = this.threats.length - 1; i >= 0; i--) if (t - this.threats[i].t > 25) this.threats.splice(i, 1);
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i], p = q.p; if (p.gone || p.state === 'down') { p._re = 0; P.splice(i, 1); continue; } if (t >= p._re) { p._re = 0; P.splice(i, 1); try { this.react(p, q.kind); } catch (e) { p.fear = null; this.err(e); } } }
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i], F = p.fear; if (!F || p.gone || p.state === 'down' || (F.kind === 'ped' && !this.g.peds.list.includes(p))) { if (F && !p.gone && p.state !== 'down') { try { this.endStand(p, F); } catch (e) {} } p.fear = null; A.splice(i, 1); continue; }
      try {
        // what someone who was not shot at keeps away from: the gun where it is now, the car where it is now, or the place
        const own = F.th ? (F.veh ? (F.th.x = F.veh.x, F.th.y = F.veh.y, F.th) : F.fix ? F.th : (F.th.x = pl.x, F.th.y = pl.y, F.th)) : null;
        if (F.cower > 0) { F.cower -= dt; if (F.cower <= 0) { const th = own || this.threatFor(p); if (th && (own ? Math.hypot(p.x - th.x, p.y - th.y) < F.clear && (F.fix || F.veh || armed) : this._td < 45)) { if (F.kind === 'ped') p.speed = (F.calm && F.calm.speed) || 1.3; this.run(p, F, th); if (!p.fear) { A.splice(i, 1); } } else { A.splice(i, 1); this.calm(p, F); } } continue; }
        if (F.hold > 0 || F.look > 0) { if (F.hold > 0) F.hold -= dt; else F.look -= dt; if (F.hold <= 0 && F.look <= 0) { F.hold = F.look = 0;
            if (F.lv === 0 && F.clear === 0) { A.splice(i, 1); this.endStand(p, F); this.calm(p, F); continue; }      // a stare from where they stand: over, on they go
            this.run(p, F, own || this.threatFor(p)); if (!p.fear) { A.splice(i, 1); continue; } } else continue; }
        F.think -= dt; if (F.think <= 0) { F.think = 0.35 + this.rnd() * 0.3; const th = own || this.threatFor(p);
          if (own) { if (Math.hypot(p.x - own.x, p.y - own.y) < F.clear && !(F.veh && !this.g.vehicles.includes(F.veh))) this.steer(p, F, th, false); else F.T = Math.min(F.T, 1.5); }      // far enough from it: back to a walk soon
          else if (th && this._td < 70) { F.T = Math.max(F.T, 6 + this.rnd() * 3); this.steer(p, F, th, false); }
          if (F.kind === 'crowd' && F.run) {      // the crowd's own habits do not apply to someone getting away
            if (p.state === 'wait') { this.run(p, F, th); if (!p.fear) { A.splice(i, 1); continue; } }
            else if (p.state === 'stand') { this.sim.nStand--; p.state = 'walk'; p.path = null; }
            if (p.state !== 'flee' && !F.v && p.state !== 'stand') { this.run(p, F, th); if (!p.fear) { A.splice(i, 1); continue; } }      // jumped clear of a car first: now gets away
            if (p.state !== 'flee' && F.v) { p.v0 = F.v; if (F.lv > 0 && F.v > 2.3 && p.walkClip !== this.sim.jog) p.walkClip = this.sim.jog; } } }
        // nobody jogs on the spot: someone who cannot get on (hemmed in, a dead end) goes to ground there, or tries the other way
        if (F.kind === 'crowd' && F.run && F.lv > 0 && p.state !== 'flee') { F.pt = (F.pt || 0) + dt; if (F.px === undefined) { F.px = p.x; F.py = p.y; F.pt = 0; } if (F.pt > 0.5) { const moved = Math.hypot(p.x - F.px, p.y - F.py); F.px = p.x; F.py = p.y; F.pt = 0; if (moved < 0.3) F.stuck = 9; }
          if (p.v < 0.5) F.stuck = (F.stuck || 0) + dt; else if (F.stuck < 9) F.stuck = 0;
          if (F.stuck > 0.35) { F.stuck = 0; if (this.cower && F.lv >= 2 && this.g.statics.onSidewalk(p.x, p.y) && p.state !== 'cross' && this.rnd() < 0.08) { F.run = false; this.startCower(p, F, 2.5 + this.rnd() * 5); continue; } else if (p.w && p.w.kind !== 'cross') { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; } } }
        // someone who turns to run does it on the spot, fast (the crowd's own turn is a stroller's arc)
        if (F.spin > 0 && F.kind === 'crowd' && p.w && p.w.ux !== undefined && (p.state === 'walk' || p.state === 'cross')) { F.spin -= dt; const want = Math.atan2(p.w.uy * p.d, p.w.ux * p.d); let dh = want - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += clamp(dh, -6.5 * dt, 6.5 * dt); if (Math.abs(dh) > 1) p.v = Math.max(p.v, 1.2); }
        F.T -= dt; if (F.T <= 0) { A.splice(i, 1); this.calm(p, F); }
      } catch (e) { p.fear = null; A.splice(i, 1); this.err(e); }
    }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // for tests and the hand-over's numbers: who is doing what
  census() {
    const o = { afraid: this.afraid.length, pending: this.pending.length, downs: this.downs.length, lv: [0, 0, 0], cower: 0, duck: 0, look: 0, run: 0, ped: 0, crowd: 0, ms: +this.ms.toFixed(4) };
    for (const p of this.afraid) { const F = p.fear; if (!F) continue; o.lv[F.lv]++; o[F.kind]++; if (F.cower > 0) o.cower++; else if (F.hold > 0) o.duck++; else if (F.look > 0) o.look++; else if (F.run) o.run++; }
    return o;
  }
  err(e) { if (!this._err) { this._err = true; console.log('[scare] ' + (e && (e.stack || e.message))); } }
}

// install(game, combat): combat.scare / combat.frighten are answered here (through Bodies when the lane's people.js is on), combat.kill tells
// us who was shot, game.onCrash and game.onPedHit tell us about the player's car. Not installed with ?scare=0.
export function install(game, combat) {
  if (!game || !combat || combat.__scare) return combat && combat.__scare; if (game.P && game.P.get('scare') === '0') return null;
  const S = (combat.__scare = new Scare(game, combat)); game.__world = S;
  const scare0 = combat.scare.bind(combat), fr0 = combat.frighten.bind(combat), step0 = combat.stepPeople.bind(combat), kill0 = combat.kill.bind(combat);
  if (combat.bodies) S.adopt(combat.bodies);
  // (with Bodies on, combat.scare and combat.frighten reach us through Bodies; without it, from here)
  combat.scare = (x, y, r, level) => { if (!S.on || combat.bodies) return scare0(x, y, r, level); try { S.scare(x, y, r, level); } catch (e) { S.err(e); } };
  combat.frighten = (p, kind, x, y, secs) => { if (!S.on || combat.bodies) return fr0(p, kind, x, y, secs); try { S.frighten(p, kind, x, y, secs); } catch (e) { S.err(e); } };
  combat.kill = (p, kind, h, force) => { if (p) { S._shotAt = { x: p.x, y: p.y }; if (!combat.bodies) { try { S.down(p, kind === 'ped' || p.loop ? 'ped' : 'crowd'); } catch (e) {} } } return kill0(p, kind, h, force); };
  combat.stepPeople = (dt) => { step0(dt); if (!S.B) { try { S.step(dt); } catch (e) { S.err(e); } } if (S.drivers) S.drivers.frame(dt); };
  if (typeof game.onCrash === 'function') { const oc = game.onCrash; game.onCrash = function (v, force) { const r = oc.apply(this, arguments); if (S.on && v === game.player.vehicle) { try { S.crash(v, force); } catch (e) { S.err(e); } } return r; }; }
  if (typeof game.onPedHit === 'function') { const op = game.onPedHit; game.onPedHit = function (p, v) { const r = op.apply(this, arguments); if (S.on) { try { S.pedHit(p, v); } catch (e) { S.err(e); } } return r; }; }
  S.crowd();
  // the drivers' half: fetched when the game is playable (not part of the first load)
  if (!game.P || game.P.get('drivers') !== '0') { const go = () => import('./drivers.js').then((m) => { S.drivers = m.install(game, combat, S); }).catch((e) => console.log('[scare] drivers.js not loaded: ' + (e && e.message))); if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 0); }
  console.log('[scare] the world reacts: people on' + (S.B ? ' (with people.js)' : '') + (S.cower ? ', crouch clips found' : ''));
  return S;
}
