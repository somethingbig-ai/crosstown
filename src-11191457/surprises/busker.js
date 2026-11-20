// surprises/busker.js: THE SAXOPHONE BUSKER (surprises lane, Nov 17).
// Beside a few subway stairs and on a few plaza corners a man stands playing a tenor saxophone, his case open on the pavement in front of him. You hear him
// before you see him: a slow blues, alone, louder and clearer as you come round the corner, dull behind buildings. Walk up and press E: a dollar flutters into
// the case and he nods, or lifts the horn, without stopping. A shot nearby or a car coming at him: he stops, lowers the horn and steps back; when it is quiet
// again he steps up and comes back in at the start of a phrase.
//   WHO: one of the game's own people (game.kit.person), posed bone by bone each frame (busker-pose.js over showtime-pose.js's rig). The horn, strap, case,
//        hat and bills are shapes made in code. The solo is ours, made in code (busker-tune.js); the same notes move his fingers, lean him back on the held
//        ones and lift the bell on the high phrase.
//   WHERE: by rule from the map's own data, the same every session: one open subway entrance in six (by its id), beside the stair head on the pavement, and
//        one larger plaza in three, in from its sharpest corner; none nearer than 160 m to another, so only one is ever heard. info().spots lists them.
//   COST: one distance check a second until one is within 85 m. Then one figure (7 draws), horn, strap, case, hat (1 each), bills once one is dropped (1);
//        the tune (86 s at 24 kHz, 8 MB) is rendered once, a slice a frame, the first time one comes near. Beyond 95 m everything is taken out again.
//   ?busker=0 off (not fetched) · ?surshow=busker stands the player six metres in front of the nearest one · ?buskerall=1 one at every open entrance (for looks)
import * as THREE from 'three';
import { clamp, TAU } from './kit.js';
import { Rig, Player, saxGeometry, caseGeometry, hatGeometry, strapGeometry, setStrap, billsGeometry, setBill, BILLS, CASE } from './busker-pose.js';
import { soloRenderer, nextPhrase, LEN } from './busker-tune.js';

const TUNE = { wake: 85, sleep: 95, apart: 160, level: 0.6, ref: 9, max: 90, sr: 24000, shotR: 45, calm: 5.5, caseX: 1.0, caseZ: -0.08, reach: 2.3 };
const hash = (i, k = 0) => ((Math.imul(i + 1 + k * 7919, 2654435761) >>> 0) >>> 9);

export function install(game, kit) {
  const g = game, w = g.world, st = g.statics, P = g.P || new URLSearchParams('');
  const S = { spots: null, cur: null, why: '', tips: 0, scares: 0, wakes: 0, ms: 0, msMax: 0, n: 0, TUNE, tune: null, buf: null, kinds: null, plazas: undefined, heard: 0, log: [] };
  const SEEN = P.has('buskerseen') ? +P.get('buskerseen') : 47;
  const _o = {}, ZERO = new THREE.Vector3(), pool = {}; let props = null, tick = 0, snd = null, lastShots = -1, scanT = 0;
  const note = (s) => { S.log.push(s); if (S.log.length > 30) S.log.shift(); };
  S.info = () => ({ on: !S.why, why: S.why, spots: S.spots ? S.spots.map((s) => [Math.round(s.x), Math.round(s.y), s.from]) : null, n: S.spots ? S.spots.length : -1, active: S.cur ? { x: +S.cur.x.toFixed(1), y: +S.cur.y.toFixed(1), from: S.cur.from, who: S.cur.who, d: +(S.d || 0).toFixed(1), state: S.cur.state, t: +(S.cur.t || 0).toFixed(2), up: S.cur.pl ? +S.cur.pl.up.toFixed(2) : null } : null,
    wakes: S.wakes, tips: S.tips, scares: S.scares, ms: S.n ? +(S.ms / S.n).toFixed(3) : 0, msMax: +S.msMax.toFixed(2), frames: S.n, draws: S.cur && props ? props.draws + (S.cur.fig ? S.cur.fig.draws : 0) : 0, tris: S.cur && props ? props.tris + (S.cur.fig ? S.cur.fig.tris : 0) : 0,
    tune: { len: LEN, built: !!S.buf || !!(S.tune && S.tune.done), notes: S.tune ? S.tune.notes : 0, ms: S.tune ? +S.tune.ms.toFixed(1) : 0 }, sound: !!snd, heard: snd ? +snd.V.gain.gain.value.toFixed(3) : 0, muffled: snd ? +snd.V.hid.toFixed(2) : 0, log: S.log.slice(-8) });

  // ------------------------------------------------------------------------------------------------ where they stand
  const inMap = (x, y) => !g.bounds || g.bounds.in(x, y, -8);
  const free = (x, y, r) => inMap(x, y) && st.onSidewalk(x, y) && !st.resolve(x, y, r, _o);
  // a place to stand facing (fx, fy): on the pavement, clear, room for the case a metre in front and three metres of open pavement beyond him
  const fits = (x, y, fx, fy) => free(x, y, 0.5) && free(x + fx * TUNE.caseX, y + fy * TUNE.caseX, 0.45) && st.raycast(x, y, x + fx * 3.2, y + fy * 3.2) === 1;
  function atEntrance(e) { const dx = Math.cos(e.h), dy = Math.sin(e.h), nx = -dy, ny = dx, hw = (e.w || 1.5) / 2; let best = null, bs = -1;      // (dx, dy) = down the stair; he stands beside the well with his back to its rail
    for (const side of [1, -1]) for (const off of [1.4, 1.8, 2.3]) for (const al of [1.4, 0.4, 2.6, -0.8]) { const x = e.x + dx * al + nx * side * (hw + off), y = e.y + dy * al + ny * side * (hw + off), fx = nx * side, fy = ny * side; if (!fits(x, y, fx, fy)) continue;
      const open = st.raycast(x, y, x + fx * 9, y + fy * 9) * 9, sc = Math.min(open, 6) - off * 0.5 - Math.abs(al - 1.4) * 0.3 + (st.onSidewalk(x + fx * 2.6, y + fy * 2.6) ? 3 : 0); if (sc > bs) { bs = sc; best = { x, y, h: Math.atan2(fy, fx), from: 'entrance ' + e.id }; } }
    return best; }
  function atPlaza(pz, i) { const poly = pz.poly; if (!poly || poly.length < 3) return null; let cx = 0, cy = 0; for (const p of poly) { cx += p[0]; cy += p[1]; } cx /= poly.length; cy /= poly.length;
    const vs = poly.map((p) => [Math.hypot(p[0] - cx, p[1] - cy), p]).sort((a, b) => b[0] - a[0]);      // the corners, the sharpest (farthest from the middle) first
    for (const [d, p] of vs.slice(0, 4)) { if (d < 8) break; const fx = (cx - p[0]) / d, fy = (cy - p[1]) / d; for (const inn of [4.6, 5.8, 3.4]) { const x = p[0] + fx * inn, y = p[1] + fy * inn; if (fits(x, y, fx, fy)) return { x, y, h: Math.atan2(fy, fx), from: 'plaza ' + i + (pz.name ? ' ' + pz.name : '') }; } }
    return null; }
  function buildSpots() { const out = [], all = P.get('buskerall') === '1', far = (s) => all || out.every((q) => Math.hypot(q.x - s.x, q.y - s.y) >= TUNE.apart);
    const EN = (g.subway && g.subway.entrances) || [];
    for (const e of EN) { if (!e.open || e.off || !(all || hash(e.id) % 6 === 0)) continue; let s = null; try { s = atEntrance(e); } catch (er) { kit.fail('busker.spot', er); } if (s && far(s)) out.push(s); }
    (S.plazas || []).forEach((pz, i) => { if (!(pz.area >= 400) || hash(i, 3) % 3 !== 0) return; let s = null; try { s = atPlaza(pz, i); } catch (er) { kit.fail('busker.spot', er); } if (s && far(s)) out.push(s); });
    out.forEach((s, i) => { s.i = i; s.seed = hash(Math.round(s.x * 3 + s.y * 7), 5); }); S.spots = out; note('spots ' + out.length + ' (entrances seen ' + EN.length + ', plazas ' + (S.plazas || []).length + ')'); return out; }
  S.buildSpots = buildSpots;
  // the plazas file the crowd also reads; the subway's entrances are there once the subway is (it may come a little after us, or not at all)
  try { fetch('assets/streets/ground/plazas.json').then((r) => (r.ok ? r.json() : [])).then((j) => { S.plazas = Array.isArray(j) ? j : []; }).catch(() => { S.plazas = []; }); } catch (e) { S.plazas = []; }
  function ready(dt) { if (S.spots) return true; scanT += dt; const sub = g.subway && g.subway.entrances; if ((sub || scanT > 6) && (S.plazas !== undefined || scanT > 6)) { if (S.plazas === undefined) S.plazas = []; buildSpots(); return true; } return false; }

  // ------------------------------------------------------------------------------------------------ the man and his things
  function figure(kind) {
    if (pool[kind] !== undefined) return pool[kind];
    try { const p = S.personFor ? S.personFor(kind) : g.kit && g.kit.person ? g.kit.person(kind) : null; if (!p || !p.object) throw new Error('no person ' + kind);
      const rig = new Rig(p.object, kind), pl = new Player(rig); let draws = 0, tris = 0; p.object.traverse((o) => { if (o.isMesh) { draws++; const ge = o.geometry; tris += ge ? (ge.index ? ge.index.count : ge.attributes.position.count) / 3 : 0; } });
      return (pool[kind] = { p, rig, pl, draws, tris }); } catch (e) { kit.fail('busker.cast', e); S.why = 'cast: ' + ((e && e.message) || e); return (pool[kind] = null); }
  }
  function makeProps() { if (props) return props;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02, side: THREE.DoubleSide }), brass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.92, envMapIntensity: 1.5, side: THREE.DoubleSide })      /* round 2: polished metal that shows the street in it, not paint */, dark = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9, side: THREE.DoubleSide });
    for (const m of [mat, brass, dark]) if (kit.bakeLit) kit.bakeLit(m);
    const group = new THREE.Group(); group.name = 'sur_busker';
    const sax = new THREE.Mesh(saxGeometry(), brass), cas = new THREE.Mesh(caseGeometry(), mat), strap = new THREE.Mesh(strapGeometry(), dark), bills = new THREE.Mesh(billsGeometry(), mat), hat = new THREE.Mesh(hatGeometry(), mat);
    sax.name = 'sur_busker_sax'; cas.name = 'sur_busker_case'; strap.name = 'sur_busker_strap'; bills.name = 'sur_busker_bills'; hat.name = 'sur_busker_hat'; cas.position.set(TUNE.caseX, 0, TUNE.caseZ); bills.visible = false;
    for (const m of [sax, cas, strap, bills, hat]) { m.frustumCulled = false; m.castShadow = m !== strap && m !== bills; m.receiveShadow = m === cas; group.add(m); }
    const tri = (m) => m.geometry.index.count / 3;
    return (props = { group, sax, cas, strap, bills, hat, mat, draws: 4, tris: tri(sax) + tri(cas) + tri(strap) + tri(hat), fly: [], slot: 0 }); }

  function wake(s) { makeProps(); if (!S.kinds) { const k = g.kit && g.kit.pedKinds ? g.kit.pedKinds() : ['ped_a']; const men = k.filter((n) => n === 'ped_a' || n === 'ped_c'); S.kinds = men.length ? men : k.length ? k : ['ped_a']; }      /* the two men of the people export */
    s.who = S.kinds[s.seed % S.kinds.length]; const fig = figure(s.who) || S.kinds.map((k) => figure(k)).find((f) => f); if (!fig && !S.bare) { s.dead = true; return; } S.why = '';
    const G = props.group; props.hat.visible = !!fig; if (fig) { const o = fig.p.object; o.visible = true; G.add(o); fig.rig.posed = false; fig.rig.fade = 0; const pl = fig.pl; pl.up = 1; pl.back = 0; pl.look = 0; pl.fl = 0; pl.nodT = pl.liftT = -1; }
    s.gh = st.onSidewalk(s.x, s.y) ? 0.15 : 0; G.position.set(s.x, s.gh, -s.y); G.rotation.set(0, s.h, 0); G.visible = true; if (w.scene && G.parent !== w.scene) w.scene.add(G);
    s.fig = fig; s.pl = fig ? fig.pl : null; s.state = 'play'; s.t = (s.seed % 80) * 1.07 % LEN; s.t = nextPhrase(s.t) - 0.3; s.calmT = 0; s.thT = 0; s.tx = 1; s.tz = 0; S.cur = s; S.hid = false; S.wakes++; lastShots = g.combat && typeof g.combat.shots === 'number' ? g.combat.shots : -1;
    if (!S.buf && !S.tune) S.tune = soloRenderer(TUNE.sr); note('wake ' + s.from + ' ' + s.who); }
  function sleep(why) { const s = S.cur; if (!s) return; S.cur = null; stopSound(); try { const G = props.group; if (s.fig) { const o = s.fig.p.object; o.parent && o.parent.remove(o); } G.parent && G.parent.remove(G); } catch (e) { kit.fail('busker.sleep', e); } s.fig = null; s.pl = null; note('sleep ' + why); }

  // ------------------------------------------------------------------------------------------------ the sound
  function startSound(s) { const au = kit.audio && kit.audio(); if (!au || snd || !S.buf && !(S.tune && S.tune.done)) return; const a = au.ac;
    if (!S.buf) { const b = a.createBuffer(1, S.tune.len, TUNE.sr); b.getChannelData(0).set(S.tune.d); S.buf = b; S.tune = { done: true, notes: S.tune.notes, ms: S.tune.ms, len: S.tune.len }; }
    const V = kit.voice({ ref: TUNE.ref, max: TUNE.max, level: TUNE.level, wall: true, roll: 1 }); if (!V) return; const blow = a.createGain(); blow.gain.value = s.state === 'play' ? 1 : 0; blow.connect(V.in); snd = { V, blow, a, src: null }; seek(s, s.t); }
  // (re)start the loop at tune time t
  function seek(s, t) { s.t = ((t % LEN) + LEN) % LEN; if (!snd) return; try { if (snd.src) { snd.src.stop(); snd.src.disconnect(); } } catch (e) {} const src = snd.a.createBufferSource(); src.buffer = S.buf; src.loop = true; src.connect(snd.blow); src.start(0, s.t); snd.src = src; snd.t0 = snd.a.currentTime - s.t; }
  function stopSound() { if (!snd) return; try { snd.src && snd.src.stop(); } catch (e) {} snd.V.off(); snd.V.stop(); snd = null; }

  // ------------------------------------------------------------------------------------------------ what frightens him; the dollar
  function danger(s) { const pl = g.player, c = g.combat;
    if (c && typeof c.shots === 'number') { if (lastShots >= 0 && c.shots !== lastShots && Math.hypot(pl.x - s.x, pl.y - s.y) < TUNE.shotR) { lastShots = c.shots; return [pl.x, pl.y, 1]; } lastShots = c.shots; }
    const look = (v) => { if (!v || v.dead) return null; const sp = Math.abs(v.v || 0); if (sp < 1) return null; const dx = s.x - v.x, dy = s.y - v.y, d = Math.hypot(dx, dy); if (d > 12) return null; if (d < 3.4) return [v.x, v.y, 0];
      const sg = v.v < 0 ? -1 : 1, at = (Math.cos(v.h) * dx + Math.sin(v.h) * dy) * sg / d; return sp > 3 && at > 0.9 && d < 4 + sp * 0.9 ? [v.x, v.y, 0] : null; };
    let r = look(pl.vehicle); if (!r && g.traffic && g.traffic.cars) for (const v of g.traffic.cars) { if (Math.abs(v.x - s.x) > 12 || Math.abs(v.y - s.y) > 12) continue; if ((r = look(v))) break; } return r; }
  function tip(s) { const pl = g.player, ch = Math.cos(s.h), sh = Math.sin(s.h), dx = pl.x - s.x, dy = pl.y - s.y, f = { u: 0, x0: dx * ch + dy * sh, z0: dx * sh - dy * ch, y0: 1.02, x1: TUNE.caseX + (Math.random() - 0.5) * 0.14, z1: TUNE.caseZ + (Math.random() - 0.5) * 0.5, yaw: Math.random() * TAU, ph: Math.random() * TAU, b: props.slot++ % BILLS };
    const d = Math.hypot(f.x1 - f.x0, f.z1 - f.z0) || 1; f.x0 += (f.x1 - f.x0) / d * 0.35; f.z0 += (f.z1 - f.z0) / d * 0.35; props.fly.push(f); props.bills.visible = true; S.tips++; s.thT = 0.55; s.thank = S.tips % 2 ? 'nod' : 'lift'; if (typeof g.cash === 'number' && g.cash >= 1) g.cash -= 1; note('tip ' + S.tips); }
  function bills(dt) { const F = props.fly; for (let i = F.length - 1; i >= 0; i--) { const f = F[i]; f.u = Math.min(1, f.u + dt / 1.15); const u = f.u, e = u * u * (3 - 2 * u), fl = Math.sin(u * TAU * 2.2 + f.ph) * (1 - u), y = f.y0 + (CASE.floor + 0.012 + 0.002 * f.b - f.y0) * (u * (0.35 + 0.65 * u)) + 0.1 * Math.sin(Math.PI * Math.min(1, u * 2.5)) * (1 - u);
      setBill(props.bills.geometry, f.b, f.x0 + (f.x1 - f.x0) * e + fl * 0.07 * Math.cos(f.yaw), y, f.z0 + (f.z1 - f.z0) * e + fl * 0.07 * Math.sin(f.yaw), f.yaw + u * 3.4, fl * 0.9, 1 - 0.75 * u); if (u >= 1) F.splice(i, 1); } }
  S.tip = () => { if (S.cur && props) tip(S.cur); }; S.scare = (x, y) => { const s = S.cur; if (s) frighten(s, x === undefined ? g.player.x : x, y === undefined ? g.player.y : y, true); };
  function frighten(s, x, y, bang) { const ch = Math.cos(s.h), sh = Math.sin(s.h), dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy) || 1; s.tx = (dx * ch + dy * sh) / d; s.tz = (dx * sh - dy * ch) / d; s.calmT = TUNE.calm + (bang ? 1 : 0);
    if (s.state === 'play') { s.state = 'scared'; S.scares++; if (s.pl && bang) s.pl.flinch(); if (snd) snd.blow.gain.setTargetAtTime(0, snd.a.currentTime, 0.03); note('scared by a ' + (bang ? 'shot' : 'car')); } }

  // ------------------------------------------------------------------------------------------------ each frame
  kit.onFrame((dt) => {
    if (!S.cur) { tick -= dt || 0.016; if (tick > 0) return; tick = 1; if (!ready(1)) return; const pl = g.player; let best = null, bd = TUNE.wake; for (const s of S.spots) { if (s.dead) continue; const d = Math.hypot(s.x - pl.x, s.y - pl.y); if (d < bd) { bd = d; best = s; } } if (best) wake(best); if (!S.cur) return; }
    const t0 = performance.now(), s = S.cur, pl = g.player, d = Math.hypot(s.x - pl.x, s.y - pl.y); S.d = d; if (d > TUNE.sleep) { sleep('far'); return; }
    // heard from 85 m, DRAWN only within about 47 m (round 2: one stands 60 m from the spawn, where he was 23 draws nobody could make out; the tune still carries). ?buskerseen=<metres>
    { const far = d > (S.hid ? SEEN - 3 : SEEN + 3); if (far !== !!S.hid) { S.hid = far; try { props.group.visible = !far; if (s.fig) s.fig.p.object.visible = !far; } catch (e) { kit.fail('busker.hide', e); } } }
    if (S.tune && !S.tune.done) S.tune.step(1.5);
    if (!snd) startSound(s); if (snd && snd.src) s.t = (((snd.a.currentTime - snd.t0) % LEN) + LEN) % LEN; else s.t = (s.t + dt) % LEN;
    if (dt > 0) {
      s.chk = (s.chk || 0) - dt; if (s.chk <= 0) { s.chk = 0.15; const r = danger(s); if (r) frighten(s, r[0], r[1], !!r[2]); }
      if (s.state === 'scared') { s.calmT -= dt; if (s.calmT <= 0) { s.state = 'back'; note('calm again'); } }
      else if (s.state === 'back' && (!s.pl || (s.pl.up >= 1 && s.pl.back <= 0))) { s.state = 'play'; seek(s, nextPhrase(s.t) - 0.25); if (snd) snd.blow.gain.setTargetAtTime(1, snd.a.currentTime, 0.02); }
      if (s.thT > 0) { s.thT -= dt; if (s.thT <= 0 && s.pl && s.state === 'play') s.pl.thank(s.thank); }
      if (s.pl) { s.pl.update(dt, { t: s.t, scared: s.state === 'scared', tx: s.tx, tz: s.tz }); s.fig.rig.apply(dt, ZERO, 1); s.pl.fingers(); props.sax.position.copy(s.pl.sax.p); props.sax.quaternion.copy(s.pl.sax.q); props.hat.position.copy(s.pl.hat.p); props.hat.quaternion.copy(s.pl.hat.q); props.hat.scale.setScalar(s.pl.hat.s); setStrap(props.strap.geometry, s.pl.strapPts); }
      if (props.fly.length) bills(dt);
    }
    if (snd) S.heard = snd.V.at(s.x, s.y, s.gh + 1.25, dt);
    // E: a dollar in the case. And nobody walks through him.
    if (kit.onFoot && kit.onFoot()) { const ch = Math.cos(s.h), sh = Math.sin(s.h), bx = s.x + ch * TUNE.caseX * 0.6, by = s.y + sh * TUNE.caseX * 0.6;
      if (s.state === 'play' && Math.hypot(pl.x - bx, pl.y - by) < TUNE.reach) { kit.prompt('drop a dollar'); if (kit.use()) tip(s); }
      const hx = s.x - ch * (s.pl ? s.pl.back * 0.5 : 0), hy = s.y - sh * (s.pl ? s.pl.back * 0.5 : 0), q = Math.hypot(pl.x - hx, pl.y - hy); if (q < 0.55 && q > 0.01 && dt > 0) { pl.x = hx + (pl.x - hx) / q * 0.55; pl.y = hy + (pl.y - hy) / q * 0.55; } }
    const ms = performance.now() - t0; S.ms += ms; S.n++; if (ms > S.msMax) S.msMax = ms;
  }, 'busker');
  S.sleep = sleep; S.ready = ready; S.seek = (t) => { if (S.cur) seek(S.cur, t); }; S.props = () => props; S.pool = pool;
  return S;
}

// ?surshow=busker: stand the player six metres from the nearest busker, on foot, facing him
export function show(game, kit, S) {
  const g = game, pl = g.player, st = g.statics; let tries = 0;
  const go = () => { if (!S.ready(1)) { if (tries++ < 40) setTimeout(go, 500); return false; } let best = null, bd = 1e9; for (const s of S.spots) { if (s.dead) continue; const d = Math.hypot(s.x - pl.x, s.y - pl.y); if (d < bd) { bd = d; best = s; } } if (!best) { S.why = S.why || 'no busker on this map'; return false; }
    let px = 0, py = 0, ok = false; for (const a of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) { for (const r of [6, 5, 4]) { px = best.x + Math.cos(best.h + a) * r; py = best.y + Math.sin(best.h + a) * r; if (st.raycast(best.x, best.y, px, py) === 1) { ok = true; break; } } if (ok) break; }
    try { if (pl.vehicle) { pl.vehicle = null; if (pl.vis && pl.vis.object) pl.vis.object.visible = true; if (g.cam) g.cam.mode = 'foot'; } } catch (e) {}
    pl.x = px; pl.y = py; pl.h = Math.atan2(best.y - py, best.x - px); if (g.focus) { g.focus.x = px; g.focus.y = py; } if (g.cam) g.cam.yaw = pl.h; if (g.snapCamera) g.snapCamera(); if (S.cur && S.cur !== best) S.sleep('show'); return best; };
  return go();
}
