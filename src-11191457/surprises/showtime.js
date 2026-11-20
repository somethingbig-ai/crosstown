// surprises/showtime.js: SHOWTIME, the subway-car dancers (surprises lane, Nov 17).
// Now and then a crew of three rides the train the player takes. As the doors close one of them calls it ("SHOWTIME! What time is it?"), a beat starts from a
// speaker on the floor, and they take turns in the doorway while the others clap on the beat: round the pole with the feet off the floor, upside down by the knees
// from the overhead bar, a cap flicked up onto the head and a spin on the floor; a last picture together, a thank-you, and they stand like riders. At the next
// station they step off. 32 s from the call to the bow; the ride between two stations is about 41 s from the moment the train moves, so it is over before the stop
// (if the train stops early the show is cut to the bow).
//   WHO: three of the game's own people (game.kit.person: the people export, 52 bones). There is no dance clip, so every pose of the show is made here, bone by
//        bone, each frame (showtime-pose.js: a small rig with two-bone IK); standing as riders and walking on and off they play the export's Idle and Walk clips.
//   WHERE: a doorway of the car the player is in (its middle pole, the overhead bar on one side), a doorway or two along from him. The figures are children of the
//        train's own group, so they ride, roll and bounce with the car; when the ride changes trains in the tunnel (subway.js hop) they are moved with the player.
//   WHEN: a train that comes in while he waits on the platform has the crew aboard 1 time in 4, and they may step on at a later stop of his ride; never twice
//        within four minutes. ?showtime=0 off. ?surshow=showtime: puts him on a train with the crew and starts the show.
//   COST: nothing but an event listener until a crew exists. A crew is three skinned figures (7 draw calls each), a cap and a speaker (1 each) and the pose work.
// Sound (Web Audio, made here, our own beat: kick, snare, hat, a bass line; claps) plays only with the game's sound on; it is silent on capture pages.
import * as THREE from 'three';
import { Rig, showPose, spots, hatPlace, TOTAL, BEAT, actAt, startOf, face, clamp, smooth, TAU } from './showtime-pose.js';

const TUNE = { chance: 0.25, gap: 240, minAway: 3.4, maxAway: 11, walk: 1.25 };
const WHO = ['A', 'B', 'C'];
const LINES = [[0, 'SHOWTIME!   What time is it?', 2300], [2.4, 'What time is it?   SHOWTIME!', 2300], [4.7, 'Watch your heads, watch your knees!', 2600], [startOf('finale') + 0.3, 'That\'s the show!', 2200], [startOf('outro') + 0.1, 'Thank you, ladies and gentlemen. Be safe out there.', 3600]];

export function install(game, kit) {
  const g = game, P = g.P || new URLSearchParams(''), sub = g.subway;
  const S = { crew: null, shows: 0, crews: 0, rolls: 0, lastT: -1e9, force: false, why: '', ms: 0, n: 0, msMax: 0, TUNE, stage: null, log: [] };
  S.info = () => ({ on: !S.why, why: S.why, crews: S.crews, shows: S.shows, rolls: S.rolls, state: S.crew ? S.crew.state : null, T: S.crew ? +S.crew.T.toFixed(2) : null, act: S.crew && S.crew.state === 'show' ? actAt(S.crew.T).name : null,
    ms: S.n ? +(S.ms / S.n).toFixed(3) : 0, msMax: +S.msMax.toFixed(2), frames: S.n, stage: S.stage, log: S.log.slice(-12) });
  if (!sub || !sub.on || !sub.tMap) { S.why = 'no subway on this map'; return S; }
  if (!g.kit || !g.kit.person) { S.why = 'no people'; return S; }
  const note = (s) => { S.log.push(s); if (S.log.length > 40) S.log.shift(); };
  const pool = {};      // the three figures, made once and kept
  const hatSt = {}, _v = new THREE.Vector3(), _q = new THREE.Quaternion(), ZERO = new THREE.Vector3();
  let props = null, snd = null;

  // ------------------------------------------------------------------------------------------------ the cast and the props
  function cast() {
    if (pool.A) return true; if (pool.bad) return false;
    try { const kinds = (g.kit.pedKinds ? g.kit.pedKinds() : []).filter((n) => g.kit.people && g.kit.people[n]); if (kinds.length < 3) throw new Error('fewer than three kinds of people');
      WHO.forEach((w, i) => { const name = kinds[i % kinds.length], p = g.kit.person(name); if (!p || !p.object) throw new Error('no person ' + name); const rig = new Rig(p.object, name);
        p.object.traverse((o) => { o.layers.enable(sub.LAYER || 9); if (o.isSkinnedMesh) o.frustumCulled = false; if (o.isMesh) o.castShadow = false; });
        pool[w] = { who: w, p, rig, w: 0, home: [0, 0, 0], walk: null, gone: false, clip: '' }; });
      return true; } catch (e) { pool.bad = true; pool.A = null; S.why = 'cast: ' + ((e && e.message) || e); kit.fail('showtime.cast', e); return false; }
  }
  // geometry glued together with a colour per piece (one draw each for the speaker and the cap)
  function glue(parts) { let n = 0; const gs = parts.map(([geo, col, m]) => { const q = geo.index ? geo.toNonIndexed() : geo; if (m) q.applyMatrix4(m); n += q.attributes.position.count; return [q, new THREE.Color(col)]; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const [q, c] of gs) { pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); for (let i = 0; i < q.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; } o += q.attributes.position.count; q.dispose(); }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); return out; }
  function makeProps() {
    if (props) return props; const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
    // the speaker: a party box on its end, two cones and a grab handle (0.26 wide, 0.46 high, 0.22 deep), facing +x
    const box = new THREE.Mesh(glue([[new THREE.BoxGeometry(0.22, 0.46, 0.26), 0x15161a, M(0, 0.23, 0)], [new THREE.CylinderGeometry(0.095, 0.095, 0.012, 18), 0x2c2e36, M(0.112, 0.15, 0, 0, 0, Math.PI / 2)], [new THREE.CylinderGeometry(0.05, 0.03, 0.02, 14), 0x8a8d96, M(0.118, 0.15, 0, 0, 0, Math.PI / 2)],
      [new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), 0x2c2e36, M(0.112, 0.335, 0, 0, 0, Math.PI / 2)], [new THREE.CylinderGeometry(0.03, 0.018, 0.02, 12), 0x8a8d96, M(0.118, 0.335, 0, 0, 0, Math.PI / 2)], [new THREE.TorusGeometry(0.105, 0.008, 6, 20), 0x2a7fff, M(0.113, 0.15, 0, 0, Math.PI / 2, 0)],
      [new THREE.BoxGeometry(0.03, 0.03, 0.16), 0x3a3c44, M(0, 0.49, 0)], [new THREE.BoxGeometry(0.03, 0.04, 0.02), 0x3a3c44, M(0, 0.47, 0.07)], [new THREE.BoxGeometry(0.03, 0.04, 0.02), 0x3a3c44, M(0, 0.47, -0.07)]]), mat);
    // the cap: a crown and a peak, its origin in the middle of the rim, the peak towards +x
    const hat = new THREE.Mesh(glue([[new THREE.SphereGeometry(0.1, 16, 8, 0, TAU, 0, Math.PI / 2), 0xc81e2a, M(0, -0.012, 0, 0, 0, 0, 1.0, 0.92, 0.92)], [new THREE.SphereGeometry(0.1, 14, 6), 0xb01822, M(0.105, 0.0, 0, 0, 0, -0.12, 0.8, 0.07, 0.82)], [new THREE.SphereGeometry(0.014, 8, 6), 0xf2f2f2, M(0, 0.082, 0)]]), mat);
    for (const m of [box, hat]) { m.layers.enable(sub.LAYER || 9); m.frustumCulled = false; m.name = 'sur_showtime_prop'; }
    return (props = { box, hat, mat });
  }

  // ------------------------------------------------------------------------------------------------ the place: a doorway of a car
  const doorZs = (tr) => { const out = []; for (const d of tr.doorways || []) if (d.side === 1) out.push({ z: (d.z0 + d.z1) / 2, car: d.car }); return out; };
  function pickDoor(tr, lz) { let best = null, bs = 1e9; for (const d of doorZs(tr)) { const a = Math.abs(d.z - lz), s = a < TUNE.minAway ? 100 + (TUNE.minAway - a) : a; if (s < bs) { bs = s; best = d; } } return best; }
  function ctxOf(tr, d, lz, lx) { const w = (tr.walk || []).find((q) => q.car === d.car) || { x1: tr.width / 2 - 0.59 };
    return { GX: w.x1 + 0.05, barY: 1.9, ceil: (tr.ceilingY || tr.floorY + 2.1) - tr.floorY, hw: tr.width / 2 - 0.07, sb: 1, far: d.z >= lz ? 1 : -1, beat: 0 }; }
  // riders standing in the crew's doorway are moved along the aisle (the subway lane's own people: only their place in the car is changed)
  function makeRoom(C) { try { const R = sub.riders, Pp = R && R.pops && R.pops.get(C.t.u), O = Pp && Pp.occ && Pp.occ.get(C.t); if (!O) return; let n = 0;
      for (const a of O.list) { if (a.mode !== 'stand' || a.plan) continue; const dz = a.lz - C.zd; if (Math.abs(dz) < 1.75) { a.lz = C.zd + (dz >= 0 ? 1 : -1) * (2.0 + 0.5 * (n++ % 2)); } } S.moved = (S.moved || 0) + n; } catch (e) { kit.fail('showtime.room', e); } }
  function place(C, t, d, lz) { const tr = t.train; C.t = t; C.zd = d.z; C.car = d.car; C.c = ctxOf(tr, d, lz); if (C.sbWant) C.c.sb = C.sbWant; C.group.position.set(0, tr.floorY, d.z); if (C.group.parent !== tr.group) tr.group.add(C.group);
    const sp = spots(C.c); for (const w of WHO) { const D = C.d[w]; D.home = w === 'C' && C.done ? [sp.floor[0], sp.floor[1], sp.C[2]] : sp[w]; }
    props.box.position.set(sp.box[0], 0, sp.box[1]); props.box.rotation.set(0, face(-C.c.sb * 0.2, -C.c.far), 0); makeRoom(C); S.stage = { car: d.car, zd: +d.z.toFixed(2), sb: C.c.sb, far: C.c.far, GX: +C.c.GX.toFixed(3), hw: +C.c.hw.toFixed(3) }; }

  function makeCrew(t, lz, state) {
    if (S.crew || !cast()) return null; makeProps(); const d = pickDoor(t.train, lz); if (!d) return null;
    const C = (S.crew = { t, state, T: 0, done: false, group: new THREE.Group(), d: pool, hat: { mode: 'head', u: 0 }, step: 0, clapB: 0, line: 0, w: 0, age: 0 }); C.group.name = 'sur_showtime';
    for (const w of WHO) { const D = pool[w]; D.w = 0; D.walk = null; D.gone = false; D.rig.posed = false; D.rig.key = ''; D.rig.fade = 0; D.p.object.visible = true; C.group.add(D.p.object); play(D, 'idle', w === 'B' ? 1.7 : w === 'C' ? 3.1 : 0); }
    C.group.add(props.box); hatOn(C, 'head'); place(C, t, d, lz); S.crews++; S.lastT = g.t || 0; note('crew ' + state + ' car ' + d.car + ' z ' + d.z.toFixed(1)); return C;
  }
  function dropCrew(why) { const C = S.crew; if (!C) return; S.crew = null; try { for (const w of WHO) { const D = pool[w]; D.p.mixer && D.p.mixer.stopAllAction(); D.p.cur = null; D.clip = ''; D.p.object.parent && D.p.object.parent.remove(D.p.object); }
      for (const m of [props.box, props.hat]) m.parent && m.parent.remove(m); C.group.parent && C.group.parent.remove(C.group); } catch (e) { kit.fail('showtime.drop', e); } if (snd) snd.V.off(); note('dropped: ' + why); }
  function play(D, name, at) { const p = D.p, a = p.acts[name] || p.acts.idle || p.acts.idleshift; if (!a) return; const key = a === p.acts[name] ? name : 'idle'; if (D.clip === key) return;
    if (D.clip && p.acts[D.clip]) p.acts[D.clip].fadeOut(0.25); a.reset().fadeIn(D.clip ? 0.25 : 0).play(); if (at) a.time = at % (p.dur[key] || 1); D.clip = key; }
  // the cap rides on C's head bone or in his right hand; in the air it belongs to the doorway
  function hatOn(C, mode) { if (C.hatMode === mode) return; C.hatMode = mode; const D = pool.C, r = D.rig, h = props.hat;
    if (mode === 'air') { C.group.add(h); return; } const k = mode === 'head' ? 'head' : 'hand_R', b = r.b[k]; b.add(h);
    _q.copy(r.Q0[k]).invert(); h.quaternion.copy(_q); if (mode === 'head') h.position.set(0.012, 0.105 * r.k, 0).applyQuaternion(_q); else h.position.subVectors(r.P0.hand_R, r.P0.forearm_R).normalize().multiplyScalar(0.11).applyQuaternion(_q); }

  // ------------------------------------------------------------------------------------------------ the beat
  // 16 steps to the bar (a step is a quarter of a beat). K kick, S snare, H hat, B the bass (semitones over A1), two bars long.
  const PAT = { K: 'x.....x...x.....x.....x..x.x....', S: '....x.......x.......x.......x..x', H: 'x.x.x.x.x.x.x.xxx.x.x.x.x.x.x.x.', B: [0, -1, -1, 0, -1, -1, 3, -1, -1, -1, 5, -1, -1, 3, -1, -1, 0, -1, -1, 0, -1, -1, 7, -1, -1, 5, -1, 3, -1, -1, -2, -1] };
  function sound() { if (snd) return snd; const V = kit.voice && kit.voice({ ref: 4.5, max: 46, level: 0.85 }); if (!V) return null; return (snd = { V, clapV: kit.voice({ ref: 4.5, max: 40, level: 0.8 }) }); }
  function hit(kind, at, n) { const s = snd, a = s.V.a, t = Math.max(a.currentTime + 0.005, at);
    if (kind === 'K') { const o = a.createOscillator(), e = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.95, t + 0.004); e.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.connect(e); e.connect(s.V.in); o.start(t); o.stop(t + 0.3); }
    else if (kind === 'B') { const f = 55 * Math.pow(2, n / 12), o = a.createOscillator(), e = a.createGain(), lp = a.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); lp.type = 'lowpass'; lp.frequency.setValueAtTime(520, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.2); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.34, t + 0.008); e.gain.exponentialRampToValueAtTime(0.001, t + 0.24); o.connect(lp); lp.connect(e); e.connect(s.V.in); o.start(t); o.stop(t + 0.27); }
    else if (kind === 'S') { kit.burst(s.V, { type: 'bandpass', freq: 1900, q: 0.7, gain: 0.5, att: 0.002, dec: 0.13, at: t - a.currentTime }); kit.burst(s.V, { type: 'highpass', freq: 5200, q: 0.5, gain: 0.2, att: 0.002, dec: 0.09, at: t - a.currentTime }); }
    else if (kind === 'H') kit.burst(s.V, { type: 'highpass', freq: 7800, q: 0.6, gain: n ? 0.16 : 0.09, att: 0.001, dec: n ? 0.09 : 0.035, at: t - a.currentTime });
    else if (kind === 'C') { for (let i = 0; i < 3; i++) kit.burst(s.clapV, { type: 'bandpass', freq: 1250 + i * 240, q: 1.1, gain: 0.3, att: 0.001, dec: 0.07, at: t - a.currentTime + i * 0.011 }); } }
  function beat(C, dt) { if (!kit.audio || !kit.audio() || !sound()) return; const a = snd.V.a, st = BEAT / 4, T0 = BEAT, T1 = startOf('outro') + 0.02;
    const [x, y] = sub.tMap(C.t, props.box.position.x, C.zd + props.box.position.z), h = C.t.T.z + C.t.train.floorY + 0.3; snd.V.at(x, y, h, dt); snd.clapV.at(x, y, h + 1, dt);
    if (C.state !== 'show') return;
    while (C.step * st + T0 < Math.min(C.T + 0.12, T1)) { const i = C.step % 32, at = a.currentTime + (C.step * st + T0 - C.T); C.step++; if (PAT.K[i] === 'x') hit('K', at); if (PAT.S[i] === 'x') hit('S', at); if (PAT.H[i] === 'x') hit('H', at, i % 16 === 14); if (PAT.B[i] >= -2 && PAT.B[i] !== -1) hit('B', at, PAT.B[i]); }
    // the crew's claps on the backbeat (beats 1, 3, 5 ... of the show clock), from the fifth beat to the last picture
    while ((C.clapB * 2 + 1) * BEAT < Math.min(C.T + 0.12, startOf('finale'))) { const tb = (C.clapB * 2 + 1) * BEAT; C.clapB++; if (tb > 2.4) hit('C', a.currentTime + (tb - C.T)); } }

  // ------------------------------------------------------------------------------------------------ the states
  const nextOf = (t) => { try { return !!sub.nextHop(t.u.st, t.T.dir, t.T.key, t.route); } catch (e) { return false; } };
  function startShow(C) { if (C.done || C.state === 'show') return; const R = sub.ride; if (R && R.t === C.t) { const far = C.zd >= R.lz ? 1 : -1; if (far !== C.c.far) { const d = { z: C.zd, car: C.car }; place(C, C.t, d, R.lz); } }
    for (const w of WHO) { const D = pool[w]; D.walk = null; D.rig.posed = false; D.rig.key = ''; D.rig.fade = 0; } C.state = 'show'; C.T = 0; C.step = 0; C.clapB = 0; C.line = 0; S.shows++; note('show at ' + (g.t || 0).toFixed(1)); }
  // walking on or off through the doorway: each one a list of stage points, a clip and a delay
  function walkPlan(C, off) { const side = C.t.side || 1, hw = C.c.hw, out = (i) => [side * (hw + 2.3 + 0.35 * i), (i - 1) * 0.42], door = (i) => [side * (hw - 0.25), (i - 1) * 0.3];
    WHO.forEach((w, i) => { const D = pool[w], h = D.home; D.walk = off ? { pts: [[D.p.object.position.x, D.p.object.position.z], door(i), out(i)], k: 1, wait: 1.9 + i * 0.75, off: true } : { pts: [out(i), door(i), [h[0], h[1]]], k: 1, wait: 1.9 + i * 0.8, off: false, endH: h[2] };
      if (!off) { D.p.object.position.set(out(i)[0], 0, out(i)[1]); D.p.object.visible = false; } }); }
  function walkStep(C, D, dt) { const W = D.walk, o = D.p.object; if (!W) return false; if (W.wait > 0) { W.wait -= dt; if (W.wait > 0) return true; o.visible = true; }
    const [tx, tz] = W.pts[W.k], dx = tx - o.position.x, dz = tz - o.position.z, d = Math.hypot(dx, dz), sp = TUNE.walk * D.rig.k; play(D, 'walk'); const wk = D.p.walks && D.p.walks.find((q) => q.name === 'walk'); D.p.mixer.timeScale = wk ? clamp(sp / wk.speed, 0.6, 1.5) : 1;
    if (d < sp * dt + 0.02) { o.position.x = tx; o.position.z = tz; W.k++; if (W.k >= W.pts.length) { D.walk = null; D.p.mixer.timeScale = 1; if (W.off) { D.gone = true; o.visible = false; } else { o.rotation.set(0, W.endH, 0); play(D, 'idle'); } return false; } return true; }
    o.position.x += dx / d * sp * dt; o.position.z += dz / d * sp * dt; const want = face(dx, dz); let dh = want - o.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); o.rotation.set(0, o.rotation.y + clamp(dh, -6 * dt, 6 * dt), 0); return true; }

  sub.on('train', (kind, t, u) => { try { const C = S.crew, riding = sub.ride && sub.ride.t === t;
    if (kind === 'arrive') { if (C || sub.ride || !sub.own || sub.unit !== u || t.T.plat < 0) return; if (!roll()) return; const pl = g.player, lz = (pl.x - t.mx) * t.ux + (pl.y - t.my) * t.uy; makeCrew(t, clamp(lz, -t.train.length / 2 + 2, t.train.length / 2 - 2), 'ride'); }
    else if (kind === 'doors-open') { if (C && C.t === t && C.done && C.state === 'ride') { C.state = 'off'; walkPlan(C, true); note('stepping off'); }
      else if (!C && riding && nextOf(t) && roll()) { const N = makeCrew(t, sub.ride.lz, 'on'); if (N) walkPlan(N, false); } }
    else if (kind === 'doors-close') { if (!C || C.t !== t) return; if (C.state === 'off') { dropCrew('stepped off'); return; } if (C.state === 'on') { for (const w of WHO) { const D = pool[w]; if (D.walk) { D.walk = null; D.p.object.visible = true; D.p.object.position.set(D.home[0], 0, D.home[1]); D.p.object.rotation.set(0, D.home[2], 0); D.p.mixer.timeScale = 1; play(D, 'idle'); } } C.state = 'ride'; }
      if (riding && !C.done && nextOf(t)) startShow(C); }
    else if (kind === 'stop') { if (C && C.t === t && C.state === 'show' && C.T < startOf('outro')) { C.T = startOf('outro'); note('cut to the bow: the train stopped'); } }
    else if (kind === 'gone') { if (C && C.t === t && !riding) dropCrew('train gone'); }
  } catch (e) { kit.fail('showtime.train', e); } });
  sub.on('hop', (u, nu, nt) => { try { const C = S.crew; if (!C || !sub.ride || sub.ride.t !== nt) { if (C && C.t.u === u) dropCrew('hop without us'); return; }
    // the same doorway of the same car on the next station's train (the trains of a line are alike; where they are not, the doorway nearest to where it was)
    const old = C.t.train, tr = nt.train, same = old.walk.length === tr.walk.length && old.carLen === tr.carLen && old.width === tr.width, zc = (C.car - (old.walk.length - 1) / 2) * old.carLen, z1 = same ? C.zd : (Math.min(C.car, tr.walk.length - 1) - (tr.walk.length - 1) / 2) * tr.carLen + (C.zd - zc);
    let best = null, bd = 1e9; for (const d of doorZs(tr)) { const a = Math.abs(d.z - z1); if (a < bd) { bd = a; best = d; } } if (!best) { dropCrew('no doorway after the hop'); return; }
    const far = C.c.far, sb = C.c.sb; place(C, nt, best, best.z - far * 4); C.c.far = far; C.c.sb = sb; } catch (e) { kit.fail('showtime.hop', e); } });
  sub.on('board', (t) => { try { const C = S.crew; if (!C || C.t !== t || C.state !== 'ride' || C.done) return; const lz = sub.ride.lz, a = Math.abs(C.zd - lz); if (a < TUNE.minAway - 0.6 || a > TUNE.maxAway) { const d = pickDoor(t.train, lz); if (d) { place(C, t, d, lz); for (const w of WHO) pool[w].rig.posed = false; note('moved to his car'); } }
    else { const far = C.zd >= lz ? 1 : -1; if (far !== C.c.far) place(C, t, { z: C.zd, car: C.car }, lz); } } catch (e) { kit.fail('showtime.board', e); } });
  sub.on('leave', () => { if (S.crew) dropCrew('he left the subway'); });
  sub.on('drop', (u) => { if (S.crew && S.crew.t.u === u) dropCrew('station dropped'); });
  function roll() { if (S.force) { S.force = false; return true; } S.rolls++; if ((g.t || 0) - S.lastT < TUNE.gap) return false; return Math.random() < TUNE.chance; }

  // ------------------------------------------------------------------------------------------------ each frame
  kit.onFrame((dt) => { const C = S.crew; if (!C) return; const t0 = performance.now(); C.age += dt;
    if (!C.t.train || !C.t.train.group || C.group.parent !== C.t.train.group) { dropCrew('the train is gone'); return; }
    if (!C.t.train.group.visible) return;
    const show = C.state === 'show'; if (show) { C.T += dt; while (C.line < LINES.length && LINES[C.line][0] <= C.T) { const L = LINES[C.line++]; if (C.T - L[0] < 1) kit.say(L[1], L[2]); }
      if (C.T >= TOTAL) { C.state = 'ride'; C.done = true; const sp = spots(C.c); pool.C.home = [sp.floor[0], sp.floor[1], sp.C[2]]; note('show over at ' + (g.t || 0).toFixed(1)); } }
    C.w = clamp(C.w + (C.state === 'show' ? dt / 0.45 : -dt / 0.6), 0, 1); const w = smooth(0, 1, C.w), c = C.c; let left = 0;
    C.hat.mode = 'head';
    for (const k of WHO) { const D = pool[k], o = D.p.object; if (D.gone) continue; left++;
      if (D.walk) { if (walkStep(C, D, dt)) { D.p.mixer.update(dt); continue; } if (D.gone) { left--; continue; } }
      if (w < 1) { if (!D.walk) { play(D, 'idle'); o.position.set(D.home[0], 0, D.home[1]); o.rotation.set(0, D.home[2], 0); } D.p.mixer.update(dt); }
      if (w > 0) { showPose(D.rig, c, Math.min(C.T, TOTAL - 0.001), k, C.hat); D.rig.apply(dt, ZERO, w); } else D.rig.posed = false; }
    // the cap
    if (w > 0 && show) { const m = C.hat.mode; hatOn(C, m); if (m === 'air') { hatPlace(pool.C.rig, C.hat, _v, _q, hatSt, c.ceil); props.hat.position.copy(_v); props.hat.quaternion.copy(_q); } else hatSt.p0 = null; if (m === 'hand') { hatPlace(pool.C.rig, C.hat, _v, _q, hatSt, c.ceil); } }
    else hatOn(C, 'head');
    // the speaker thumps on the beat
    { const b = show ? C.T / BEAT : 0, p = show && C.T > BEAT && C.T < startOf('outro') ? Math.pow(Math.max(0, Math.cos(TAU * b)), 6) : 0; props.box.scale.set(1 + 0.05 * p, 1 + 0.02 * p, 1 + 0.03 * p); }
    if (C.state === 'off' && !left) { dropCrew('stepped off'); }
    try { if (S.crew) beat(C, dt); } catch (e) { kit.fail('showtime.beat', e); }
    const ms = performance.now() - t0; S.ms += ms; S.n++; if (ms > S.msMax) S.msMax = ms;
  }, 'showtime');

  // ------------------------------------------------------------------------------------------------ for looks and tests
  S.startNow = () => { const R = sub.ride; if (!R) return false; if (!S.crew) { S.force = false; makeCrew(R.t, R.lz, 'ride'); } const C = S.crew; if (!C) return false; if (C.t !== R.t) { dropCrew('other train'); makeCrew(R.t, R.lz, 'ride'); } S.crew.done = false; startShow(S.crew); return S.crew.state === 'show'; };
  S.seek = (T) => { if (S.crew && S.crew.state === 'show') { S.crew.T = T; S.crew.line = LINES.length; } };
  S.facing = (lz) => { const C = S.crew; if (C && (C.zd >= lz ? 1 : -1) !== C.c.far) place(C, C.t, { z: C.zd, car: C.car }, lz); }; S.pool = pool; S.props = () => props; S.dropCrew = dropCrew; S.makeCrew = makeCrew;
  return S;
}

// ?surshow=showtime: down the nearest stair, onto a train that goes on to another station, a doorway and a half from the crew, and the doors close.
export function show(game, kit, S) {
  const g = game, sub = g.subway, pl = g.player; if (!sub || !S || S.why || S.showing) return false; S.showing = true; S.showLog = [];
  const say = (s) => { S.showLog.push(s); }; let st = 0, wait = 0, t = null, ent = null, tries = 0;
  const done = (ok, why) => { S.showing = false; S.showDone = ok; say((ok ? 'ok: ' : 'failed: ') + why); st = 99; };
  kit.onStep((dt) => { if (st === 99) return; wait += dt; if (wait > 90) { done(false, 'timed out in stage ' + st); return; }
    if (sub.ride && st < 4) { const R = sub.ride; if (R.t.state === 'dwell') { t = R.t; st = 4; wait = 0; } else { done(S.startNow(), 'already riding: started at once'); return; } }
    if (st === 0) { if (sub.own) { st = 2; wait = 0; return; } let bd = 1e9; ent = null; for (const e of sub.entrances || []) { if (!e.open || e.off) continue; const s0 = sub.stationOf && sub.stationOf(e.st); if (s0 && s0.built === false) continue; const d = Math.hypot(e.x - pl.x, e.y - pl.y); if (d < bd) { bd = d; ent = e; } }
      if (!ent) { done(false, 'no open entrance'); return; } if (pl.vehicle) { pl.vehicle = null; if (pl.vis && pl.vis.object) pl.vis.object.visible = true; g.cam.mode = 'foot'; }
      sub.goto(sub.entrances.indexOf(ent), 1.2); g.focus.x = pl.x; g.focus.y = pl.y; if (g.snapCamera) g.snapCamera(); say('at entrance ' + ent.id + ' of ' + ent.st); st = 1; wait = 0; }
    else if (st === 1) { const u = [...sub.units.values()].find((q) => q.st && q.st.id === ent.st); if (sub.own) { st = 2; wait = 0; say('underground'); return; } if (u && u.state === 'ready') { pl.x = ent.x + ent.ca * 0.5; pl.y = ent.y + ent.sa * 0.5; } }
    else if (st === 2) { const u = sub.unit; if (!u || !u.trains || !u.trains.length) return;
      for (const q of u.trains) { if (q.T.plat < 0) continue; const ri = q.T.routes.findIndex((r) => { try { return !!sub.nextHop(u.st, q.T.dir, q.T.key, r); } catch (e) { return false; } }); if (ri < 0) continue; t = q; if (q.state === 'wait' || q.state === 'out') { q.routeI = ri; q.state = 'wait'; q.t = 0; q.train.group.visible = false; } break; }
      if (!t) { done(false, 'no train here goes on to another station (' + u.st.id + ')'); return; } st = 3; wait = 0; say('train called at ' + u.st.id); }
    else if (st === 3) { if (t.state === 'in' && t.c < -1) t.c = -1; if (t.state === 'dwell') { st = 4; wait = 0; } else if (t.state === 'wait' && wait > 3 && tries++ < 3) { t.t = 0; } }
    else if (st === 4) { if (t.state !== 'dwell') { done(false, 'the train left without him'); return; } if (t.t < 3 || (t.t > 11.5 && !sub.ride)) { t.t = 3; return; } if (t.doors < 0.9) return;
      if (S.crew && S.crew.t !== t) S.dropCrew('another train'); if (!S.crew) S.makeCrew(t, 0, 'ride'); const C = S.crew; if (!C) { done(false, 'no crew: ' + S.why); return; }
      // he stands in the aisle a doorway and a half from the crew's doorway, looking at them
      const tr = t.train, zs = tr.walk.find((q) => q.car === C.car) || tr.walk[0], lz0 = C.zd - 4.3 >= zs.z0 + 0.5 ? C.zd - 4.3 : C.zd + 4.3, lz = clamp(lz0, zs.z0 + 0.4, zs.z1 - 0.4);
      if (!sub.ride) sub.ride = { t, lx: 0.3, lz }; else { sub.ride.lx = 0.3; sub.ride.lz = lz; } const dirZ = C.zd >= lz ? 1 : -1; pl.h = Math.atan2(t.uy * dirZ, t.ux * dirZ); g.cam.yaw = pl.h; if (g.cam.pitch !== undefined) g.cam.pitch = 0.08;
      C.done = false; S.facing(lz); t.t = Math.max(t.t, 12.6); st = 5; wait = 0; say('aboard, car ' + C.car + ', ' + Math.abs(C.zd - lz).toFixed(1) + ' m from the crew'); }
    else if (st === 5) { if (S.crew && S.crew.state === 'show') { done(true, 'show started'); return; } if (wait > 8) done(S.startNow(), 'started by hand'); }
  }, 'showtime.show');
  return true;
}
