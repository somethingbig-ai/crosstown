// combat/melee.js: gameplay lane, Nov 19 (players since Nov 16, via CHIEF: "punch or melee"). ?melee=0 off (nothing fetched).
//   Gun put away (Q): the left mouse button / the pad's right trigger throws a punch: jab (left), cross (right), and the third in a row is a heavier
//   swing; at most three a second; a short lunge at whoever stands within reach in front (2.1 m, 38 degrees either side of where he faces or looks).
//   E on foot (pad: R3 with a gun out) strikes too: with a gun out it is a blow with the gun (fire and aim are untouched).
//   A walker: one blow staggers him and he runs; three points put him down (jab / cross 1, the gun 2, the swing 3) as the people code's own body
//   (combat/people.js Bodies.kill, blood switched off for the call), and after some seconds he gets up and runs. An officer: heatcore's own hitCop; six points knock him out (heat's downCop fall, no kill crime, no kill counted).
//   Nothing in reach, or a wall, a car, a pole in the way: the swing and a dull knock, nothing else.
// Sim space is (x east, y north, z up); three.js space is (x, z, -y).
import * as THREE from 'three';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a)), ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const TH = [0, 1, 3, 7, 12, 18];      /* heatcore's points for each star (its TH, not exported) */
export const REACH = 2.1, CONE = 38 * Math.PI / 180, NEED = 3, NEED_COP = 6, GAP = 0.34, STRING = 0.95, LIE = 7, RISE = 1.15, ROOT = 0.7;
const KIND = { jab: { dur: 0.3, tc: 0.11, pts: 1, arm: 'L' }, cross: { dur: 0.32, tc: 0.12, pts: 1, arm: 'R' }, swing: { dur: 0.52, tc: 0.22, pts: 3, arm: 'R' }, butt: { dur: 0.46, tc: 0.2, pts: 2, arm: 'R' } };
const SOLID = { wall: 1, prop: 1, car: 1, glass: 1, fence: 1, rail: 1, tree: 1, pole: 1 }, TOUCH = ['spine', 'chest', 'chest2', 'clavicle_L', 'clavicle_R', 'upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _s = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), _h = new THREE.Vector3(), _oL = new THREE.Vector3(), _oR = new THREE.Vector3(), _fw = new THREE.Vector3();

/* who a blow from (x, y), thrown along `face` (he) or `look` (the camera), would reach: the nearest standing person within REACH and CONE of either. */
export function pick(g, c, x, y, face, look) {
  let best = null, bs = 1e9; const tryOne = (p, kind) => { const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy); if (d > REACH || d < 0.05) return; const a = Math.atan2(dy, dx), off = Math.min(Math.abs(wrapPi(a - face)), Math.abs(wrapPi(a - look))); if (off > CONE) return; const s = d + off * 1.2; if (s < bs) { bs = s; best = { p, kind, d, a }; } };
  const cs = g.crowd && g.crowd.on !== false && g.crowd.sim; if (cs) for (const a of cs.agents) if (a && !a.gone && a.state !== 'down') tryOne(a, 'crowd');
  if (g.peds && g.peds.list) for (const p of g.peds.list) if (p.state !== 'down' && !p.gone) tryOne(p, 'ped');
  const H = c.heat; if (H && H.cops) for (const k of H.cops) if (k.hp > 0) tryOne(k, 'cop');
  return best;
}
/* is the way from his chest to the point open (no wall, car, pole between)? Uses the guns' own ray; people on the ray do not count. */
export function blocked(c, x, y, z, a, d) { try { const h = c.cast(x, y, z, Math.cos(a), Math.sin(a), 0, 0.05, d); return !!(h && SOLID[h.kind] && h.t < d - 0.25); } catch (e) { return false; } }

export function install(g, c) {
  const LEGS = !(g.P && g.P.get && g.P.get('meleelegs') === '0'), pl = g.player, M = { on: true, cur: null, n: 0, lastT: -9, cd: 0, key: false, was: false, w: 0, kos: [], roots: [], t: 0, saved: null, stats: { thrown: 0, landed: 0, knock: 0, heavy: 0, butt: 0, stagger: 0, down: 0, up: 0, cop: 0 }, log: [] };
  g.melee = c.melee = M;
  addEventListener('keydown', (e) => { if (!e.repeat && e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && !(g.__surKit && g.__surKit.promptNow)) M.key = true; });      /* E is also the street surprises' "use" (busker, cat, slice; surprises/kit.js): with their prompt on screen the key is theirs alone */
  addEventListener('mousedown', (e) => { const cv = g.world.renderer.domElement; if (e.button === 0 && (document.pointerLockElement === cv || (e.target === cv && g.look && g.look.free()))) M.click = 0.3; });      /* a quick click between two steps still counts, and one made during a blow is kept for 0.3 s */
  const can = () => !g.paused && !c.dead && c.canCarry() && !pl.vehicle && !pl.busy && !(g.fly && g.fly.on) && !c.mapUp() && !(g.grapple && g.grapple.free && g.grapple.free.a);
  /* ---- sound: a short dull knock made on the guns' own audio context (no sample of a blow exists in the set) */
  const knock = (hit, heavy) => { try { const A = c.audio, ac = A && A.ac; if (!ac || ac.state !== 'running' || (g.sound && g.sound.muted)) return; const t0 = ac.currentTime, o = ac.createOscillator(), og = ac.createGain(), n = ac.createBufferSource(), ng = ac.createGain(), lp = ac.createBiquadFilter();
      const len = Math.floor(ac.sampleRate * 0.09), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.22));
      o.type = 'sine'; o.frequency.setValueAtTime(hit ? (heavy ? 150 : 190) : 120, t0); o.frequency.exponentialRampToValueAtTime(hit ? 62 : 70, t0 + 0.09); og.gain.setValueAtTime(hit ? (heavy ? 0.5 : 0.36) : 0.16, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + (heavy ? 0.2 : 0.13));
      n.buffer = buf; lp.type = 'lowpass'; lp.frequency.value = hit ? (heavy ? 1500 : 2100) : 700; ng.gain.value = hit ? (heavy ? 0.42 : 0.3) : 0.1;
      o.connect(og).connect(ac.destination); n.connect(lp).connect(ng).connect(ac.destination); o.start(t0); o.stop(t0 + 0.25); n.start(t0); } catch (e) {} };
  /* ---- the law: until the first crime of a game combat.heat is heat.js's small stand-in, which has start() and no crime(): a blow must fetch the body as a shot does (handover-2: 13 blows, 0 stars) */
  const crime = (k, x, y) => { try { const H = c.heat; if (!H) return; if (H.crime) H.crime(k, x, y); else if (H.start) Promise.resolve(H.start('melee')).then((B) => { try { if (B && B.crime) B.crime(k, x, y); } catch (e) {} }, () => {}); } catch (e) {} };
  /* ---- the blow lands */
  const dry = (fn) => { const B = c.bodies, b0 = B ? B.blood : null, im = c.fx && c.fx.impact; if (B) B.blood = false; if (im) c.fx.impact = () => {}; try { return fn(); } finally { if (B) B.blood = b0; if (im) c.fx.impact = im; } };      /* no blood, no red mist: he is knocked out, not shot */
  const unroot = (p) => { const i = M.roots.findIndex((r) => r.p === p); if (i >= 0) M.roots.splice(i, 1); };
  const land = (T, K) => { const p = T.p, ux = Math.cos(T.a), uy = Math.sin(T.a), S = M.stats, heavy = K.pts >= 3;
    const h = { kind: T.kind, obj: p, t: T.d, x: p.x - ux * 0.15, y: p.y - uy * 0.15, z: (p.z || 0) + (heavy ? 1.55 : 1.35) * (p.scale || 1), dx: ux, dy: uy, dz: heavy ? 0.25 : 0.05, nx: -ux, ny: -uy, nz: 0, part: heavy ? 'head' : 'body' };
    S.landed++; knock(true, heavy); g.cam.shake = Math.min(1, (g.cam.shake || 0) + (heavy ? 0.7 : 0.45));
    if (T.kind === 'cop') { const H = c.heat, l0 = (H && H.level) || 0; S.cop++; p._mk = (p._mk || 0) + K.pts; const ko = p._mk >= NEED_COP || p.hp <= K.pts * 9; h.part = 'body';      /* an officer takes six points (two full strings; a walker three). Under that: heatcore's own hitCop (9 hp a point, knocked back a step, no fire for a second, the copHit crime) */
      if (!ko) dry(() => c.hit(h, { dmg: K.pts * 9, force: heavy ? 1.15 : 0.85, melee: true }, false));
      else if (H && H.downCop) { p._mk = 0; S.copDown = (S.copDown || 0) + 1; const own = Object.prototype.hasOwnProperty.call(H, 'addHeat'), ah = H.addHeat, n0 = H.stats ? H.stats.copsDown : 0;      /* KNOCKED OUT, not killed: he falls through heat's own downCop (the only fall an officer has; he does not get up), but its copKill crime is held back for the call, its officers-killed count is put back and combat's kill count is not touched: a fist is assault on an officer, not a killing */
        H.addHeat = () => {}; try { dry(() => H.downCop(p, h, heavy ? 1.15 : 0.85)); } finally { if (own) H.addHeat = ah; else delete H.addHeat; }
        p.ko = true; if (H.stats) { H.stats.copsDown = n0; H.stats.copsKO = (H.stats.copsKO || 0) + 1; H.stats.crimes.copHit = (H.stats.crimes.copHit || 0) + 1; } H.lastCopHitT = H.t; }
      try { const L = ko ? Math.min(5, Math.max(3, l0 + 1)) : 2; if (H && H.addHeat && !H.dead && (ko || H.level < L)) { if (H.level < L) H.pts = Math.max(H.pts, TH[L]); H.addHeat('copHit', p.x, p.y); } } catch (e) {}      /* a hand laid on an officer is two stars at once; putting him down one more, three at least (copHit alone is 2 points = one star; handover-3) */
      M.log.push([+M.t.toFixed(2), ko ? 'cop-ko' : 'cop', Math.round(Math.max(0, p.hp)), H ? H.level : -1]); return; }
    p._mk = (p._mk || 0) + K.pts;
    if (p._mk >= NEED) { let ok = false; dry(() => { ok = !!(c.bodies && c.bodies.on && c.bodies.kill(p, T.kind, h, heavy ? 1.15 : 0.85)); if (ok && c.bodies) c.bodies._shotAt = null; }); if (!ok) { p._mk = NEED - 1; dry(() => { try { c.bodies && c.bodies.wound(p, T.kind, h); } catch (e) {} }); c.frighten(p, T.kind, pl.x, pl.y, 12); S.stagger++; M.log.push([+M.t.toFixed(2), 'stagger(no body)', p._mk]); return; }
      S.down++; p._mk = 0; if (T.kind === 'crowd') { const b = c.bodies.live.find((q) => q.who === p && q.doll); if (b) M.kos.push({ a: p, b, doll: b.doll, t: 0, rise: -1 }); } else if (p.body && p.body.doll) M.kos.push({ ped: p, doll: p.body.doll, t: 0, rise: -1, to0: Float32Array.from(p.body.doll.p) });      /* his own first points = the pose he stood in (Fit works from it) */
      crime('wound', p.x, p.y); unroot(p); c.scare(p.x, p.y, 16, 1); M.log.push([+M.t.toFixed(2), 'down', T.kind]); return; }
    S.stagger++; dry(() => { try { c.bodies && c.bodies.wound(p, T.kind, h); } catch (e) {} }); unroot(p); M.roots.push({ p, kind: T.kind, x: p.x, y: p.y, t: ROOT }); if (T.kind === 'ped') p.stagger = ROOT; if (p._mk === K.pts) crime('wound', p.x, p.y); c.scare(p.x, p.y, 9, 1); M.log.push([+M.t.toFixed(2), 'stagger', p._mk]); };
  /* ---- a blow starts */
  const start = (kind) => { const K = KIND[kind], look = g.cam.yaw, T = pick(g, c, pl.x, pl.y, pl.h, look), cur = { kind, K, t: 0, hit: false, T: null, a: T ? T.a : (kind === 'butt' ? look : pl.h), lunge: 0, wall: false };
    if (T) { if (blocked(c, pl.x, pl.y, (pl.alt || 0) + 1.3, T.a, T.d)) cur.wall = true; else { cur.T = T; cur.lunge = clamp(T.d - 0.85, 0, 0.6); } }
    else cur.wall = blocked(c, pl.x, pl.y, (pl.alt || 0) + 1.3, cur.a, 1.15);
    M.cur = cur; M.cd = GAP; M.lastT = M.t; M.stats.thrown++; if (kind === 'swing') M.stats.heavy++; if (kind === 'butt') { M.stats.butt++; c.stanceT = 0; } };
  const step = (dt) => { M.t += dt; M.cd -= dt; const armed = c.armedFoot(), held = !!c.inp.fire && !armed; if (held && !M.was) M.click = 0.3; M.was = held; M.click = armed ? 0 : (M.click || 0) - dt; const fire = held || M.click > 0, edge = M.click > 0, key = M.key; M.key = false;
    if (!M.cur && (key || fire) && M.cd <= 0 && can() && !c.swap && (armed ? key : c.slot === 'unarmed') && (edge || key || M.t - M.lastT >= GAP)) {
      M.click = 0; if (armed) start('butt'); else { M.n = M.t - M.lastT < STRING ? M.n + 1 : 1; const k = M.n % 3; start(k === 1 ? 'jab' : k === 2 ? 'cross' : 'swing'); } }
    const cur = M.cur; if (cur) { const K = cur.K, t0 = cur.t; cur.t += dt;
      if (cur.T || cur.kind !== 'butt') pl.h += clamp(wrapPi(cur.a - pl.h), -14 * dt, 14 * dt);      /* he turns into the blow */
      if (cur.T && cur.lunge > 0 && t0 < K.tc) { const s = cur.lunge * Math.min(dt, K.tc - t0) / K.tc; pl.x += Math.cos(cur.a) * s; pl.y += Math.sin(cur.a) * s; }
      if (cur.kind === 'butt') { c.stanceT = Math.min(c.stanceT, 0.3); if (t0 < K.tc - 0.07 && cur.t >= K.tc - 0.07) c.gunBackV -= 5.5; }      /* the gun is thrust forward on its own recoil spring */
      if (!cur.hit && cur.t >= K.tc) { cur.hit = true; const T = cur.T; if (T && !T.p.gone && T.p.state !== 'down' && Math.hypot(T.p.x - pl.x, T.p.y - pl.y) < REACH + 0.5) { T.a = Math.atan2(T.p.y - pl.y, T.p.x - pl.x); T.d = Math.hypot(T.p.x - pl.x, T.p.y - pl.y); try { land(T, K); } catch (e) { if (!M._err) { M._err = true; console.log('[melee] hit: ' + (e && (e.stack || e.message))); } } } else if (cur.wall) { M.stats.knock++; knock(false, false); } }
      if (cur.t >= K.dur) M.cur = null; }
    M.w = clamp(M.w + (M.cur || M.t - M.lastT < 0.7 ? dt / 0.09 : -dt / 0.3), 0, armed ? 0 : 1);
    for (let i = M.roots.length - 1; i >= 0; i--) { const r = M.roots[i], p = r.p; r.t -= dt; if (p.gone || p.state === 'down') { M.roots.splice(i, 1); continue; }      /* struck and still up: he reels on the spot (a second and a third blow can reach him), then runs */
      if (r.t > 0) { p.x = r.x; p.y = r.y; if (p.v !== undefined) p.v = 0; } else { M.roots.splice(i, 1); try { c.frighten(p, r.kind, pl.x, pl.y, 10); } catch (e) {} } }
    for (let i = M.kos.length - 1; i >= 0; i--) { try { if (!upStep(M.kos[i], dt)) M.kos.splice(i, 1); } catch (e) { M.kos.splice(i, 1); if (!M._err2) { M._err2 = true; console.log('[melee] get-up: ' + (e && (e.stack || e.message))); } } } };
  /* ---- he gets up: the body's points are led from where they lie to the pose the agent would stand in, then the agent is put back in the crowd, running */
  const lead = (K, d) => { const P = d.p, n = P.length / 3; for (let i = 0; i < n; i++) { const hi = K.to[i * 3 + 1] - K.to[12 * 3 + 1], u = ease((K.rise - Math.max(0, hi) * 0.28) / (RISE * 0.72)), uy = ease(K.rise / RISE - (hi < -0.2 ? 0 : 0.12)); P[i * 3] = K.from[i * 3] + (K.to[i * 3] - K.from[i * 3]) * u; P[i * 3 + 2] = K.from[i * 3 + 2] + (K.to[i * 3 + 2] - K.from[i * 3 + 2]) * u; P[i * 3 + 1] = K.from[i * 3 + 1] + (K.to[i * 3 + 1] - K.from[i * 3 + 1]) * uy; } if (d.q && d.q.set) d.q.set(P); };      /* the trunk and legs first, the head and arms a little later */
  const upStep = (K, dt) => { const B = c.bodies; K.t += dt;
    if (K.ped) { const p = K.ped, d = K.doll; if (!g.peds.list.includes(p) || !p.body || p.body.doll !== d || p.state !== 'down') return false;      /* a kit pedestrian (game.peds.list): the same get-up, on his own figure */
      if (K.rise < 0) { if (K.t < LIE || !(d.asleep || K.t > LIE + 3)) return true; const P = d.p, T = K.to0, ox = P[36] - T[36], oz = P[38] - T[38]; let oy = 0; try { oy = B.env.ground(P[36], P[38]) - B.env.ground(T[36], T[38]); } catch (e) {} K.from = Float32Array.from(P); K.to = new Float32Array(T.length); for (let i = 0; i < T.length; i += 3) { K.to[i] = T[i] + ox; K.to[i + 1] = T[i + 1] + oy; K.to[i + 2] = T[i + 2] + oz; } d.asleep = false; d.step = () => {}; K.rise = 0; return true; }
      K.rise += dt; lead(K, d); if (K.rise < RISE + 0.1) return true;
      const j = B.peds.indexOf(p); if (j >= 0) B.peds.splice(j, 1); try { B.blobs.remove(p.body.blob); if (p.body.mark && p.body.mark.parent) p.body.mark.parent.remove(p.body.mark); } catch (e) {} p.body = null; p.x = d.p[36]; p.y = -d.p[38]; p.state = 'walk'; p.t = 0; p.fall = 0; p._mk = 0; if (p.vis && p.vis.mixer) p.vis.mixer.timeScale = 1; M.stats.up++; M.log.push([+M.t.toFixed(2), 'up', 'ped']);
      try { c.frighten(p, 'ped', pl.x, pl.y, 14); } catch (e) {} return false; }
    const a = K.a, b = K.b, d = K.doll, cs = g.crowd && g.crowd.sim; if (!cs || b.who !== a || b.doll !== d || !B.live.includes(b)) return false;      /* the pool took the body back */
    if (K.rise < 0) { if (K.t < LIE || !(d.asleep || K.t > LIE + 3)) return true; const P = d.p, NPT = P.length / 3; K.from = Float32Array.from(P); a.x = P[12 * 3]; a.y = -P[12 * 3 + 2]; a.v = 0; if (b.rest) { B.freeze(b, false); b.rest = 0; } d.asleep = false; d.step = () => {};
      b.pose(B, a, 0); const pts = b.fit.points(); K.to = new Float32Array(NPT * 3); for (let i = 0; i < NPT; i++) { K.to[i * 3] = pts[i][0]; K.to[i * 3 + 1] = pts[i][1]; K.to[i * 3 + 2] = pts[i][2]; } K.rise = 0; return true; }
    K.rise += dt; lead(K, d);
    if (K.rise < RISE + 0.1) return true;
    a.gone = false; if (!cs.agents.includes(a)) cs.agents.push(a); if (a.w && a.w.agents && !a.w.agents.includes(a)) a.w.agents.push(a); cs.retired = Math.max(0, (cs.retired || 1) - 1); a.state = 'walk'; a.t = 0; a.scared = 0; a.fear = null; a._re = 0; a._mk = 0; B.release(b); M.stats.up++; M.log.push([+M.t.toFixed(2), 'up']);
    try { c.frighten(a, 'crowd', pl.x, pl.y, 14); } catch (e) {} return false; };
  /* ---- his arms: a guard, and the arm that is thrown (the rig's two-bone reach, combat/rig.js), the shoulders turning with it */
  const unpose = () => { const Sv = M.saved, rig = c.rig; if (!Sv || !Sv.live || !rig) return; for (let i = 0; i < TOUCH.length; i++) { const b = rig.B[TOUCH[i]]; if (b) b.quaternion.copy(Sv[i]); } Sv.live = false; if (LEGS && rig.stanceOff) rig.stanceOff(); };
  const pose = () => { const rig = c.rig, w = M.w; if (!rig || !(w > 0) || pl.vehicle || !pl.vis || !pl.vis.object || pl.vis.object.visible === false || c.armedFoot()) return;
    const B = rig.B, Sv = M.saved || (M.saved = TOUCH.map(() => new THREE.Quaternion())); for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) Sv[i].copy(b.quaternion); } Sv.live = true;
    const cur = M.cur, K = cur && cur.K, u = cur ? (cur.t < K.tc ? ease(cur.t / K.tc) : 1 - ease((cur.t - K.tc) / (K.dur - K.tc))) : 0, arm = K ? K.arm : '', sw = cur && cur.kind === 'swing';
    _f.set(Math.cos(pl.h), 0, -Math.sin(pl.h)); _r.set(Math.sin(pl.h), 0, Math.cos(pl.h)); pl.vis.object.updateMatrixWorld(true);
    if (LEGS && rig.legs && rig.stanceLegs) { _h.copy(_f).multiplyScalar(0.04 * w + 0.13 * u * w).addScaledVector(UP, -(0.035 * w + 0.045 * u * w)); _oL.copy(_f).multiplyScalar(0.1 * w + 0.17 * u * w).addScaledVector(_r, -0.03 * w); _oR.copy(_f).multiplyScalar(-0.09 * w).addScaledVector(_r, 0.05 * w); rig.stanceLegs(_h, _oL, _oR, _fw.copy(_f)); }      /* knees bent, left foot forward; it steps in and the hips go with the blow (?meleelegs=0 = straight legs) */
    rig.twist((arm === 'R' ? (sw ? 0.75 : 0.42) : arm === 'L' ? -0.3 : 0) * u * w + 0.12 * w * (1 - u), 0, _r);
    for (const s of ['L', 'R']) { const sg = s === 'R' ? 1 : -1, k = s === arm ? u : 0; rig.pos('upper_arm_' + s, _s);
      _t.copy(_s).addScaledVector(_f, 0.24 + (sw ? 0.44 : 0.5) * k).addScaledVector(UP, -0.1 + (sw ? 0.14 : 0.1) * k).addScaledVector(_r, sg * (-0.05 - 0.13 * k + (sw && s === arm ? 0.42 * Math.sin(Math.PI * Math.min(1, cur.t / K.tc) * 0.5 + Math.PI * 0.5) * (cur.t < K.tc ? 1 : 0) : 0)));
      _p.copy(UP).multiplyScalar(-0.9).addScaledVector(_r, sg * (sw && s === arm ? 0.9 : 0.45)).addScaledVector(_f, -0.15); rig.arm(s, _t, _p, w); rig.curl(s, w); } };
  /* ---- the blow with the gun: the gun hand goes up a little, then forward and down at him (turned onto him inside the cone), the gun turning with it; the guns' own pose has just placed gun and arm, this moves them for the half second (handover-3: only the recoil spring moved, 'cannot be read') */
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _hf = new THREE.Vector3(), _hn = new THREE.Vector3(), _d = new THREE.Vector3();
  const butt = () => { const cur = M.cur, rig = c.rig, gun = c.guns && c.guns[c.slot]; if (!cur || cur.kind !== 'butt' || !rig || !gun || !gun.visible || !c.armedFoot() || pl.vehicle) return;
    const K = cur.K, s = Math.min(1, cur.t / K.tc), u = cur.t < K.tc ? ease(s) : 1 - ease((cur.t - K.tc) / (K.dur - K.tc)); if (!(u > 0.001)) return;
    const Sv = M.saved || (M.saved = TOUCH.map(() => new THREE.Quaternion())); if (!Sv.live) { for (let i = 0; i < TOUCH.length; i++) { const b = rig.B[TOUCH[i]]; if (b) Sv[i].copy(b.quaternion); } Sv.live = true; }
    const yaw0 = g.cam.yaw, dy = cur.T ? clamp(wrapPi(cur.a - yaw0), -CONE, CONE) : 0, a = yaw0 + dy, up = cur.t < K.tc ? Math.sin(Math.PI * s) * 0.13 : 0;
    _f.set(Math.cos(a), 0, -Math.sin(a)); _r.set(Math.sin(a), 0, Math.cos(a)); pl.vis.object.updateMatrixWorld(true);
    _s.copy(rig.handFrame('R', _hf, _hn)); _t.copy(_s).addScaledVector(_f, 0.36 * u).addScaledVector(UP, up - 0.2 * u);
    _q1.setFromAxisAngle(_r, -0.8 * u); _q2.setFromAxisAngle(UP, dy * u).multiply(_q1);
    _d.copy(gun.position).sub(_s).applyQuaternion(_q2); gun.position.copy(_t).add(_d); gun.quaternion.premultiply(_q2); _hf.applyQuaternion(_q2); _hn.applyQuaternion(_q2);
    _p.copy(UP).multiplyScalar(-0.9).addScaledVector(_r, 0.22).addScaledVector(_f, -0.2); rig.arm('R', _t, _p, 1); rig.handDir('R', _hf, _hn, 1); gun.updateMatrixWorld(true); };
  const post0 = c.post.bind(c); c.post = function (dt) { post0(dt); try { step(dt > 0 ? dt : 0); } catch (e) { if (!M._err3) { M._err3 = true; console.log('[melee] step: ' + (e && (e.stack || e.message))); } } };
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { try { unpose(); } catch (e) {} sv0(dt); try { pose(); butt(); } catch (e) { if (!M._err4) { M._err4 = true; console.log('[melee] pose: ' + (e && (e.stack || e.message))); } } };
  M.start = start; M.step = step; M.pick = (x, y, f, l) => pick(g, c, x, y, f, l); return M;
}
