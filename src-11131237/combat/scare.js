// combat/scare.js: bystanders react to the player's gun (public wish 3: "if I pull a gun, people around me should be scared").
// One file, nothing of the game's or the crowd's is edited. `install(game, combat)` once after combat is built; off with ?scare=0.
//   a gun in the hand   people a few metres off who can see it stop and look for a moment, then turn and walk off briskly (some jog)
//   aiming              people down the barrel (a cone, 20 m) and anyone close know at once: a duck or a frozen moment, then they run
//   a shot              everyone within earshot comes to know after a human reaction time that grows with distance: some duck first,
//                       a few go to ground with their hands over the head, most run AWAY FROM THE GUN along the walks, each at a pace
//                       of their own (a hurry to a flat-out run); those on a walk that leads to the gun turn round. Nobody runs on
//                       the spot. While shots go on nobody calms; 9-15 s after the last one they slow to a walk again.
// Works on both kinds of people: the street crowd (GPU-instanced: driven through its own sim, with two made-up clips, Duck and
// Cower, baked into its clip texture at load) and the game's kit pedestrians (hold, then run along their loop away from the gun).
// Cost: with no gun in the hand and nobody afraid, one test a step. The panic code is the gameplay lane's people.js, without doll.js.
import * as THREE from 'three';
import { worldRotate } from './rig.js';
import { clamp } from '../geo.js';
import { bake } from '../crowd/render.js';

const D2R = Math.PI / 180, _q = new THREE.Quaternion();
const BONES = ['hips', 'spine', 'chest', 'chest2', 'neck', 'head', 'clavicle_L', 'clavicle_R', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'toe_L', 'thigh_R', 'shin_R', 'foot_R', 'toe_R'];
const COWER = { drop: 0.42, lean: 62, nod: 20, armUp: 140, fore: 115 }, DUCK = { drop: 0.2, lean: 30, nod: 16, armUp: 38, fore: 85 };

// a character's bones by name, and which way it faces (left x up, checked against where the toes point)
function bonesOf(root, name) {
  const B = {}; for (const k of BONES) B[k] = root.getObjectByName(name + '_' + k) || null;
  for (const k of ['hips', 'neck', 'head', 'upper_arm_L', 'forearm_L', 'upper_arm_R', 'forearm_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']) if (!B[k]) return null;
  if (!B.chest) B.chest = B.spine || B.chest2; if (!B.chest) return null;
  const W = (b) => { const e = b.matrixWorld.elements; return [e[12], e[13], e[14]]; }, HL = W(B.thigh_L), HR = W(B.thigh_R), P = W(B.hips), C = W(B.chest);
  const lx = HL[0] - HR[0], ly = HL[1] - HR[1], lz = HL[2] - HR[2], ux = C[0] - P[0], uy = C[1] - P[1], uz = C[2] - P[2], fx = ly * uz - lz * uy, fz = lx * uy - ly * ux;
  let tx = 0, tz = 0; for (const s of ['L', 'R']) { const t = B['toe_' + s]; if (!t) continue; const a = W(t), f = W(B['foot_' + s]); tx += a[0] - f[0]; tz += a[2] - f[2]; }
  return { B, flip: fx * tx + fz * tz < 0 };
}
// a crouch laid over the pose the skeleton is in: hips down with the feet kept, trunk folded forward, head tucked, arms brought up
function crouch(fit, k, o) {
  const B = fit.B, a = B.thigh_L.matrixWorld.elements, b = B.thigh_R.matrixWorld.elements, L = new THREE.Vector3(a[12] - b[12], 0, a[14] - b[14]).normalize(); if (fit.flip) L.negate();
  const P = (bn) => bn.getWorldPosition(new THREE.Vector3()), leg = P(B.thigh_L).distanceTo(P(B.shin_L)) + P(B.shin_L).distanceTo(P(B.foot_L)), d = o.drop * k * leg, phi = Math.acos(clamp(1 - d / leg, -1, 1));
  const hips = B.hips, w = hips.getWorldPosition(new THREE.Vector3()); w.y -= d; hips.position.copy(hips.parent.worldToLocal(w)); hips.updateMatrixWorld(true);
  const turn = (bn, ang) => { if (bn) worldRotate(bn, _q.setFromAxisAngle(L, ang)); };
  for (const s of ['L', 'R']) { turn(B['thigh_' + s], -phi); turn(B['shin_' + s], 2 * phi); turn(B['foot_' + s], -phi); }
  const lean = (o.lean * k + (o.wob || 0) * 2) * D2R / 3; turn(B.spine, lean); if (B.chest !== B.spine) turn(B.chest, lean); turn(B.chest2, lean); turn(B.neck, (o.nod * k + (o.wob || 0) * 3) * D2R);
  for (const s of ['L', 'R']) { turn(B['upper_arm_' + s], -(o.armUp * k) * D2R); turn(B['forearm_' + s], -(o.fore * k) * D2R); }
}
// Cower (a loop: crouched, hands over the head, trembling) and Duck (the startle: down fast, half up) for every crowd character,
// made from its standing pose and baked into the crowd's clip texture beside the mocap. Once, at load.
function addClips(S) {
  const cr = S.g.crowd, R = cr.render, cast = R.cast, sim = S.sim, t0 = performance.now();
  if (!sim.clips.some((c) => c.name === 'Cower')) {
    const idleName = (sim.idles[0] || sim.clips[0]).name, idle = cast.animations.find((c) => c.name.toLowerCase() === idleName.toLowerCase()); if (!idle) return;
    const defs = [['Cower', 2.0, [0, 0.5, 1.0, 1.5, 2.0], (i) => [1, COWER, [0, 1, -0.6, 0.8, 0][i]]], ['Duck', 1.6, [0, 0.16, 0.7, 1.6], (i) => [[0, 1, 0.82, 0.75][i], DUCK, 0]]], out = defs.map(() => []); let made = 0;
    for (const ch of cast.chars) {
      const root = ch.root, pre = ch.name + '_', tr = idle.tracks.filter((t) => t.name.startsWith(pre)); if (!tr.length) continue;
      const mixer = new THREE.AnimationMixer(root), act = mixer.clipAction(new THREE.AnimationClip('tmp_' + ch.name, idle.duration, tr)); act.play(); mixer.setTime(0); root.updateMatrixWorld(true);
      const fit = bonesOf(root, ch.name); if (!fit) { act.stop(); mixer.uncacheRoot(root); continue; }
      const bones = [...new Set(BONES.map((k) => fit.B[k]).filter(Boolean))], base = bones.map((b) => [b.quaternion.clone(), b.position.clone()]);
      const reset = () => { bones.forEach((b, i) => { b.quaternion.copy(base[i][0]); b.position.copy(base[i][1]); }); root.updateMatrixWorld(true); };
      defs.forEach(([name, dur, times, at], di) => {
        const Q = bones.map(() => []), HP = [];
        times.forEach((t, i) => { const [k, o, wob] = at(i); reset(); if (k > 0) crouch(fit, k, Object.assign({ wob }, o)); bones.forEach((b, j) => Q[j].push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)); HP.push(fit.B.hips.position.x, fit.B.hips.position.y, fit.B.hips.position.z); });
        bones.forEach((b, j) => out[di].push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, Q[j]))); out[di].push(new THREE.VectorKeyframeTrack(fit.B.hips.name + '.position', times, HP));
      });
      reset(); act.stop(); mixer.uncacheRoot(root); made++;
    }
    if (!made) return;
    defs.forEach(([name, dur], di) => { cast.animations.push(new THREE.AnimationClip(name, dur, out[di])); sim.clipNames.push(name); sim.clips.push({ i: sim.clips.length, name, duration: dur, speed: 0, loop: true, needs: null }); });
    const Bk = bake(S.g.world.renderer, cast, sim.clipNames, R.smooth || 0), old = R.baked.tex; R.baked = Bk; R.U.tAnim.value = Bk.tex; R.U.uAnimInv.value.set(1 / Bk.W, 1 / Bk.H); old.dispose();
    console.log('[scare] cower and duck clips made for ' + made + ' characters, crowd clips re-baked: ' + Math.round(performance.now() - t0) + ' ms');
  }
  S.cower = sim.clips.find((c) => c.name === 'Cower') || null; S.duck = sim.clips.find((c) => c.name === 'Duck') || null;
}

class Scare {
  constructor(game, combat) {
    this.g = game; this.c = combat; this.on = true; this.t = 0; this.threats = []; this.pending = []; this.afraid = []; this.seedN = 90210; this.sim = null; this.cower = null; this.duck = null; this.gunT = 0; this._shotAt = null; this._t = {};
    this.stats = { wary: 0, alarmed: 0, shots: 0 };
  }
  rnd() { this.seedN = (this.seedN * 1664525 + 1013904223) >>> 0; return this.seedN / 4294967296; }
  // the crowd may be built after combat: taken up when it is there
  crowd() { if (this.sim) return this.sim; const cr = this.g.crowd; if (!cr || !cr.on || !cr.sim || this._noCrowd) return null; this.sim = cr.sim; try { addClips(this); } catch (e) { console.log('[scare] no duck / cower clips: ' + (e && e.message)); } return this.sim; }

  // ---------------------------------------------------------------- a shot or a blast at (x, y): heard within r
  scare(x, y, r, level) {
    const t = this.t, rnd = () => this.rnd(), sim = this.crowd(); this.stats.shots++;
    // someone shot dead: the people round them come to know, but what they run from is the gun, not the body
    let tx = x, ty = y; { const k = this._shotAt, pl = this.g.player; if (k && k.x === x && k.y === y && pl) { tx = pl.x; ty = pl.y; } this._shotAt = null; }
    let th = this.threats.find((q) => Math.hypot(q.x - tx, q.y - ty) < 6); if (!th) { this.threats.push((th = { x: tx, y: ty, t, level, r })); if (this.threats.length > 8) this.threats.shift(); } th.t = t; th.x = tx; th.y = ty; th.level = Math.max(th.level, level); th.r = Math.max(th.r, r + Math.hypot(tx - x, ty - y));
    const note = (p, kind) => { const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 > r * r) return; const d = Math.sqrt(d2); if (level < 2 && d > r * 0.55 && rnd() < 0.3) return;      // far off, one shot: not everyone has understood yet
      p._re = t + (d < 10 ? 0.12 + rnd() * 0.16 : 0.16 + d / 343 + rnd() * 0.28 + (d / r) * (d / r) * (level < 2 ? 1.1 : 0.6) * rnd()); p._lv = 2; this.pending.push({ p, kind }); };
    for (const p of this.g.peds.list) if ((!p.fear || p.fear.lv < 2) && !p._re && p.state === 'walk') note(p, 'ped');
    if (sim) for (const a of sim.agents) if (!a.gone && (!a.fear || a.fear.lv < 2) && !a._re && a.state !== 'down') { note(a, 'crowd'); if (a._re && a.state === 'sit') a._re += rnd() * 0.3; }
  }
  // someone who was just hit and lives: they know at once
  frighten(p, kind, x, y, secs) {
    if (p.gone || p.state === 'down') return; if (p.fear && p.fear.lv >= 2) { p.fear.T = Math.max(p.fear.T, secs); p.fear.hold = Math.min(p.fear.hold, 0.3); return; }
    this.crowd(); if (!this.threats.length) this.threats.push({ x, y, t: this.t, level: 1, r: 40 });
    if (!p._re) this.pending.push({ p, kind }); p._re = this.t + 0.3; p._lv = 2; p._hit = true;
  }
  // ---------------------------------------------------------------- the gun itself, seen (no sound): only while one is in the hand
  gun(dt) {
    this.gunT -= dt; if (this.gunT > 0) return; this.gunT = 0.2;
    const g = this.g, c = this.c, pl = g.player, t = this.t, rnd = () => this.rnd(), aim = !!(c.inp && c.inp.aim), yaw = g.cam ? g.cam.yaw : pl.h, ax = Math.cos(yaw), ay = Math.sin(yaw), R = aim ? 20 : 6, sim = this.crowd();
    const see = (p, kind) => { if (p.gone || p.state === 'down' || p.fear || p._re || p._seen > t) return; const dx = p.x - pl.x, dy = p.y - pl.y, d2 = dx * dx + dy * dy; if (d2 > R * R) return; const d = Math.sqrt(d2) || 1e-3;
      const inLine = aim && (dx * ax + dy * ay) / d > 0.86, faces = -(Math.cos(p.h) * dx + Math.sin(p.h) * dy) / d;      // faces > 0: walking toward the gun
      if (inLine) { if (g.statics.raycast && g.statics.raycast(pl.x, pl.y, p.x, p.y) < 1) { p._seen = t + 1; return; } p._re = t + 0.14 + rnd() * 0.45 + d * 0.02; p._lv = 1; this.pending.push({ p, kind }); return; }
      if (d > 6) return; if (kind === 'crowd' && p.state === 'sit') { p._seen = t + 8; return; }
      if (d > 2.6 && faces < -0.25) { p._seen = t + 1.5; return; }      // back turned, not right beside it: has not seen it (asked again soon)
      if (rnd() > (aim ? 0.9 : 0.6)) { p._seen = t + 8 + rnd() * 8; return; }      // looked, and did not take it in
      p._re = t + 0.25 + rnd() * 0.9; p._lv = aim && d < 4 ? 1 : 0; this.pending.push({ p, kind }); };
    for (const p of g.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim) { const L = sim.agents; for (let i = 0; i < L.length; i++) see(L[i], 'crowd'); }
  }
  threatFor(p) { let best = null, bd = 1e9; for (const q of this.threats) { if (this.t - q.t > 9) continue; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = q; } } this._td = bd; return best; }
  react(p, kind) {
    const rnd = () => this.rnd(), lv = p._lv || 0, pl = this.g.player, sim = this.sim; p._lv = 0;
    const th = lv >= 2 ? this.threatFor(p) || this.threats[this.threats.length - 1] : { x: pl.x, y: pl.y }; if (!th) return; const d = Math.hypot(p.x - th.x, p.y - th.y);
    const old = p.fear; if (old && old.lv >= lv) return;
    const sat = kind === 'crowd' && p.state === 'sit'; if (sat) { if (lv < 2) return; if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } try { sim.leaveGroup(p); } catch (e) {} p.w = null; try { sim.rejoin(p); } catch (e) {} if (p.gone || !p.w) return; p.v = 0; }
    // a gun only seen: most stop and look for a moment first. A shot: most run at once, some stand rooted (more of them close by)
    const q = rnd(), hold = old && old.hold > 0 ? old.hold : sat ? 0.28 + rnd() * 0.25 : p._hit ? 0 : lv === 0 ? (q < 0.7 ? 0.35 + rnd() * 0.7 : 0) : lv === 1 ? (q < 0.5 ? 0.2 + rnd() * 0.4 : 0) : q < (d < 14 ? 0.28 : 0.14) ? 0.25 + rnd() * 0.45 : 0; p._hit = false;
    let F = old; if (F) { if (F.cower > 0 || F.look) this.endStand(p, F); F.lv = lv; F.T = 9 + rnd() * 6; F.hold = hold; F.run = false; } else { F = p.fear = { lv, T: lv === 0 ? 5 + rnd() * 5 : lv === 1 ? 7 + rnd() * 5 : 9 + rnd() * 6, hold, think: 0, kind, run: false, v: 0, calm: null }; this.afraid.push(p); }
    F.pace = rnd(); F.th = lv < 2 ? th : null; if (lv) this.stats.alarmed++; else this.stats.wary++;
    if (kind === 'crowd') { if (!F.calm) F.calm = { v0: p.v0 };
      // a few go to ground where they are, hands over the head, and only run when it has gone on for a while
      if (lv >= 1 && this.cower && !hold && p.state !== 'sit' && d < 32 && rnd() < (lv === 1 ? 0.12 : d < 16 ? 0.2 : 0.1) && this.g.statics.onSidewalk(p.x, p.y) && p.state !== 'cross') { this.startCower(p, F, 2.5 + rnd() * 7); return; }
      if (hold > 0) { if (lv === 0) this.startLook(p, F, th); else { F.v0 = p.v0; p.v0 = 0; if (this.duck) { try { sim.leaveGroup(p); } catch (e) {} F.idle = p.idle; p.idle = this.duck; p.talk = null; p.walkClip = this.duck; p.v = Math.min(p.v, 0.5); sim.setClip(p, this.duck); p.ph = sat ? 0.1 : 0; } } } }
    else { if (!F.calm) F.calm = { speed: p.speed, walk: p.walk, walkSpeed: p.walkSpeed }; if (hold > 0) p.speed = 0.02; }
    if (!hold) this.run(p, F, th);
  }
  // stands where they are, turned to the gun, for the length of the hold (the crowd's own 'stand' state turns them)
  startLook(p, F, th) {
    const cs = this.sim; if (p.state !== 'walk' || p.lead || p.fol) { F.v0 = p.v0; p.v0 = 0; return; }
    p.state = 'stand'; cs.nStand++; p.t = 0; p.standT = 1e9; p.tx = p.x; p.ty = p.y; p.th = Math.atan2(th.y - p.y, th.x - p.x); p.talk = null; p.v = Math.min(p.v, 0.4); F.look = true;
  }
  startCower(p, F, secs) {
    const cs = this.sim; try { cs.leaveGroup(p); } catch (e) {} if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state !== 'stand') { p.state = 'stand'; cs.nStand++; } p.t = 0; p.standT = 1e9; p.tx = p.x; p.ty = p.y; p.th = p.h; p.talk = null; p.v = Math.min(p.v, 0.3);
    F.idle = p.idle; p.idle = this.cower; cs.setClip(p, this.cower); F.cower = secs; F.hold = 0;
  }
  endStand(p, F) { F.cower = 0; F.look = false; if (F.idle) { p.idle = F.idle; F.idle = null; } }
  run(p, F, th) {
    const rnd = () => this.rnd(), lv = F.lv, u = F.pace; F.run = true; F.hold = 0; this.endStand(p, F);
    if (F.kind === 'ped') { if (p.state !== 'walk') return; const base = (F.calm && F.calm.speed) || 1.4;
      if (lv === 0 && u < 0.7) p.speed = base * (1.35 + u * 0.5);      // walks off, fast
      else { p.speed = lv === 0 ? 3.0 + u : lv === 1 ? 3.4 + u * 1.4 : 3.6 + u * 1.9; if (p.vis.acts && p.vis.acts.run) { p.walk = 'run'; p.walkSpeed = p.vis.runSpeed || 4; this.g.peds.setAnim(p, 'run'); } }
      if (th) this.steer(p, F, th, true); return; }
    const cs = this.sim; if (lv > 0 || p.lead || p.fol) { try { cs.leaveGroup(p); } catch (e) {} }
    if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state === 'sit') { if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } p.w = null; p.state = 'walk'; if (th) { p.h = Math.atan2(p.y - th.y, p.x - th.x); } p.v = 1.8; }
    if (p.state === 'stand') { cs.nStand--; p.state = 'walk'; p.standT = 0; }
    if (!p.w) { try { cs.rejoin(p); } catch (e) {} if (p.gone || !p.w) { p.fear = null; return; } }
    if (p.state === 'wait') { const w = p.w; p.state = w.kind === 'cross' ? 'cross' : 'walk'; p.lt = clamp((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny, -1.8, 1.8); p.la = 0; }
    if (p.state === 'flee') return;
    p.talk = null; p.path = null; p.noPlan = null; p.trip = 1e9; p.door = 0;
    if (lv === 0 && u < 0.7) { try { cs.pace(p, 1.7 + u * 0.45); } catch (e) {} F.v = p.v0; cs.setClip(p, p.walkClip); }      // a brisk walk away, not a run
    else { try { cs.hold(p, null); } catch (e) {} p.walkClip = cs.jog; const k = lv === 0 ? 0.95 + u * 0.2 : lv === 1 ? 1.05 + u * 0.4 : 1.12 + u * 0.62;      // a hurry ... flat out: no two alike
      F.v = p.v0 = Math.min(5.4, cs.jog.speed * p.tall * k); p.v = Math.max(p.v, 1.3 + rnd() * 0.9); cs.setClip(p, cs.jog); p.ph = rnd(); }
    if (th) this.steer(p, F, th, true);
  }
  // keep going away from the gun: along the walk one is on; turn round if that walk leads back toward it
  steer(p, F, th, first) {
    const ax = p.x - th.x, ay = p.y - th.y, l = Math.hypot(ax, ay) || 1;
    if (F.kind === 'ped') { const t = this._t; p.loop.at(p.s, t); const al = (t.tx * ax + t.ty * ay) / l * p.dir; if (al < (first ? 0 : -0.3) && l < 50) p.dir = -p.dir; return; }
    p.gx = ax / l; p.gy = ay / l; const w = p.w; if (!w || w.kind === 'cross' || w.ux === undefined) return;
    const al = (w.ux * p.gx + w.uy * p.gy) * p.d; if (al < (first ? -0.08 : -0.35) && l < 50) { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; }
  }
  calm(p, F) {
    p.fear = null; p._seen = this.t + 14 + this.rnd() * 10; if (p.gone || p.state === 'down') return;
    if (F.kind === 'ped') { if (F.calm) { p.speed = F.calm.speed; p.walk = F.calm.walk; p.walkSpeed = F.calm.walkSpeed; this.g.peds.setAnim(p, p.walk); } return; }
    if (F.idle) { p.idle = F.idle; F.idle = null; } if (p.state === 'stand' && p.standT > 1e8) { p.standT = 0; p.t = 1; }
    try { this.sim.pace(p, 1.2 + this.rnd() * 0.5); this.sim.setClip(p, p.walkClip); } catch (e) { p.v0 = (F.calm && F.calm.v0) || 1.3; }
  }
  step(dt) {
    if (!this.on) return; const c = this.c, armed = c.armedFoot && c.armedFoot();
    if (!armed && !this.afraid.length && !this.pending.length) { this.t += dt; return; }      // no gun out, nobody afraid: nothing to do
    const t = (this.t += dt), P = this.pending, A = this.afraid, pl = this.g.player;
    if (armed) this.gun(dt);
    for (let i = this.threats.length - 1; i >= 0; i--) if (t - this.threats[i].t > 25) this.threats.splice(i, 1);
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i], p = q.p; if (p.gone || p.state === 'down') { p._re = 0; P.splice(i, 1); continue; } if (t >= p._re) { p._re = 0; P.splice(i, 1); try { this.react(p, q.kind); } catch (e) { p.fear = null; this.err(e); } } }
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i], F = p.fear; if (!F || p.gone || p.state === 'down' || (F.kind === 'ped' && !this.g.peds.list.includes(p))) { p.fear = null; A.splice(i, 1); continue; }
      try {
        const gunTh = F.lv < 2 ? (F.th.x = pl.x, F.th.y = pl.y, F.th) : null;      // someone who only saw the gun keeps away from where it is now
        if (F.cower > 0) { F.cower -= dt; if (F.cower <= 0) { const th = gunTh || this.threatFor(p); if (th && (gunTh ? Math.hypot(p.x - pl.x, p.y - pl.y) < 25 && armed : this._td < 45)) { this.run(p, F, th); if (!p.fear) { A.splice(i, 1); } } else { A.splice(i, 1); this.calm(p, F); } } continue; }
        if (F.hold > 0) { F.hold -= dt; if (F.hold <= 0) { if (F.kind === 'crowd' && F.v0) { p.v0 = F.v0; F.v0 = 0; } this.run(p, F, gunTh || this.threatFor(p)); if (!p.fear) { A.splice(i, 1); continue; } } else continue; }
        F.think -= dt; if (F.think <= 0) { F.think = 0.35 + this.rnd() * 0.3; const th = gunTh || this.threatFor(p);
          if (gunTh) { if (Math.hypot(p.x - pl.x, p.y - pl.y) < 22) this.steer(p, F, th, false); else F.T = Math.min(F.T, 1.5); }      // far enough from a gun that has not gone off: back to a walk soon
          else if (th && this._td < 70) { F.T = Math.max(F.T, 6 + this.rnd() * 3); this.steer(p, F, th, false); }
          if (F.kind === 'crowd' && F.run) {      // the crowd's own habits do not apply to someone getting away
            if (p.state === 'wait' && p.wq) { const w = p.w; w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; p.state = 'cross'; p.lt = clamp((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny, -1.8, 1.8); p.la = 0; }
            else if (p.state === 'stand') { this.sim.nStand--; p.state = 'walk'; p.path = null; }
            if (p.state !== 'flee' && F.v) { p.v0 = F.v; if (F.lv > 0 && p.walkClip !== this.sim.jog) p.walkClip = this.sim.jog; } } }
        // nobody jogs on the spot: someone who cannot get on (hemmed in, a dead end) goes to ground there, or tries the other way
        if (F.kind === 'crowd' && F.run && F.lv > 0 && p.state !== 'flee') { F.pt = (F.pt || 0) + dt; if (F.px === undefined) { F.px = p.x; F.py = p.y; F.pt = 0; } if (F.pt > 0.5) { const moved = Math.hypot(p.x - F.px, p.y - F.py); F.px = p.x; F.py = p.y; F.pt = 0; if (moved < 0.3) F.stuck = 9; }
          if (p.v < 0.5) F.stuck = (F.stuck || 0) + dt; else if (F.stuck < 9) F.stuck = 0;
          if (F.stuck > 0.35) { F.stuck = 0; if (this.cower && this.g.statics.onSidewalk(p.x, p.y) && p.state !== 'cross' && this.rnd() < 0.2) { F.run = false; this.startCower(p, F, 2.5 + this.rnd() * 5); continue; } else if (p.w && p.w.kind !== 'cross') { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; } } }
        // someone who turns to run does it on the spot, fast (the crowd's own turn is a stroller's arc)
        if (F.spin > 0 && F.kind === 'crowd' && p.w && p.w.ux !== undefined && (p.state === 'walk' || p.state === 'cross')) { F.spin -= dt; const want = Math.atan2(p.w.uy * p.d, p.w.ux * p.d); let dh = want - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += clamp(dh, -6.5 * dt, 6.5 * dt); if (Math.abs(dh) > 1) p.v = Math.max(p.v, 1.2); }
        F.T -= dt; if (F.T <= 0) { A.splice(i, 1); this.calm(p, F); }
      } catch (e) { p.fear = null; A.splice(i, 1); this.err(e); }
    }
  }
  err(e) { if (!this._err) { this._err = true; console.log('[scare] ' + (e && (e.stack || e.message))); } }
}

// install(game, combat): combat.scare / combat.frighten are answered here, combat.stepPeople also steps this, combat.kill tells us who was shot.
// Not installed (the game's own plain reaction stays) with ?scare=0, or when the lane's people.js is on (?gpeople=1: it does this itself).
export function install(game, combat) {
  if (!game || !combat || combat.__scare) return combat && combat.__scare; if (game.P && game.P.get('scare') === '0') return null; if (combat.bodies) return null;
  const S = (combat.__scare = new Scare(game, combat));
  const scare0 = combat.scare.bind(combat), fr0 = combat.frighten.bind(combat), step0 = combat.stepPeople.bind(combat), kill0 = combat.kill.bind(combat);
  combat.scare = (x, y, r, level) => { if (!S.on || combat.bodies) return scare0(x, y, r, level); try { S.scare(x, y, r, level); } catch (e) { S.err(e); } };
  combat.frighten = (p, kind, x, y, secs) => { if (!S.on || combat.bodies) return fr0(p, kind, x, y, secs); try { S.frighten(p, kind, x, y, secs); } catch (e) { S.err(e); } };
  combat.kill = (p, kind, h, force) => { S._shotAt = p ? { x: p.x, y: p.y } : null; return kill0(p, kind, h, force); };
  combat.stepPeople = (dt) => { step0(dt); if (!combat.bodies) { try { S.step(dt); } catch (e) { S.err(e); } } };
  S.crowd();      // the two made-up clips are baked now, at load, when the crowd is already there (else when it first is)
  console.log('[scare] bystanders react to the gun: on');
  return S;
}
