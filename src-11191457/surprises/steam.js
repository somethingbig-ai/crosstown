// surprises/steam.js: steam from manhole covers that swirls round you as you walk through it (surprises lane, Nov 15; Matt's list, item 6).
// Some of the street's manhole covers (the ones the ground layer draws: read from its decal quads) leak steam, as over New York's steam mains:
//   - thin wisps from the rim and pick holes that gather into one billowing column, bent by the wind, in irregular puffs, thinning as it climbs;
//   - whatever moves through it moves it: the air parts round a walker and curls into the two eddies behind them, a passing car tears the column
//     and drags it down the street; it closes again afterwards;
//   - white in the day's light, grey under cloud and at night; a low hiss close by.
// More covers steam in rain and at night (cold water on hot pipes), as they do.
//   ?steam=0 off     ?steamshare=0.12 the share of covers that steam     game.surprises.mods.steam.info()
// Cost: asleep unless a steaming cover is within 110 m of the camera (one grid lookup a frame). Awake: ONE draw (the shared particle batch,
// at most 1,800 sprites), about 0.1 ms of script.
import { clamp, lerp, smooth, TAU } from './kit.js';

const CELL = 64, REACH = 110, MAXV = 7, MAXP = 1800;
const h3 = (x, y, k) => { let n = (Math.round(x * 4) * 374761393 + Math.round(y * 4) * 668265263 + k * 2246822519) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

export function install(game, kit) {
  const g = game, P = g.P, st = g.statics;
  const S = { vents: 0, covers: 0, live: [], awake: false, ms: 0, tune: { share: P.has('steamshare') ? +P.get('steamshare') : 0.1, rate: 1.25, rise: 1.25, wind: 0.95, dense: P.has('steamdense') ? +P.get('steamdense') : 1.7 } };
  const grid = new Map(), key = (x, y) => Math.floor(x / CELL) * 100003 + Math.floor(y / CELL), have = new Set();
  const addVent = (x, y, d) => { const id = Math.round(x * 10) + ',' + Math.round(y * 10); if (have.has(id)) return; have.add(id); S.covers++; const r = h3(x, y, 1); if (r >= S.tune.share * 2.2) return;      // r under share: always; up to 2.2 x share: in rain or at night
    const v = { x, y, d: d || 0.9, r, k: h3(x, y, 2), acc: 0, puff: 0, puffT: 0, on: 0 }, kk = key(x, y); let a = grid.get(kk); if (!a) grid.set(kk, (a = [])); a.push(v); S.vents++; };

  // ---- the covers: every decal quad of the ground layer flagged as a manhole cover (streets/ground.js buildDecals: aP = [metal, 1])
  const scanned = new WeakSet(); let scanT = 0, fallback = false;
  function scan() {
    const G = g.streets && g.streets.parts && g.streets.parts.ground; let groups = [];
    if (G) { if (G.sets) for (const k in G.sets) { if (G.sets[k] && G.sets[k].group) groups.push(G.sets[k].group); } else if (G.group) groups.push(G.group); }
    for (const grp of groups) { if (scanned.has(grp)) continue; scanned.add(grp);
      grp.traverse((m) => { const ge = m.geometry, aP = ge && ge.attributes && ge.attributes.aP, pos = ge && ge.attributes.position; if (!aP || !pos || ge.index) return;
        for (let i = 0; i + 5 < pos.count; i += 6) { if (aP.getY(i) !== 1) continue; const x = (pos.getX(i) + pos.getX(i + 2)) / 2, y = -(pos.getZ(i) + pos.getZ(i + 2)) / 2, d = Math.hypot(pos.getX(i + 1) - pos.getX(i), pos.getZ(i + 1) - pos.getZ(i)) * 0.78; addVent(x, y, d); } }); }
    // no street layer at all (a test page without it): covers by the same sort of rule, down the middle of a lane, so the surprise still exists
    if (!G && !fallback && g.roads && g.roads.edges) { fallback = true; for (const e of g.roads.edges) { if (e.out || !e.pts || e.pts.length < 2) continue; const a = e.pts[0], b = e.pts[e.pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 50) continue;
      for (let s = 18 + h3(a[0], a[1], 5) * 20, j = 0; s < L - 18; s += 30 + 40 * h3(a[0], a[1], 6 + j), j++) { const f = s / L, dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, o = (h3(a[0], a[1], 40 + j) - 0.5) * 5; addVent(a[0] + (b[0] - a[0]) * f - dy * o, a[1] + (b[1] - a[1]) * f + dx * o, 0.9); } } }
  }

  // ---- what is awake: the steaming covers nearest the camera
  let ps = null, voice = null, hiss = null; const L3 = [0, 0, 0], near = [];
  const wind = { x: 0, y: 0 }, bodies = [];
  function pick(c, wet) {
    near.length = 0; const i0 = Math.floor((c.x - REACH) / CELL), i1 = Math.floor((c.x + REACH) / CELL), j0 = Math.floor((c.y - REACH) / CELL), j1 = Math.floor((c.y + REACH) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = grid.get(i * 100003 + j); if (!a) continue; for (const v of a) { if (v.r >= S.tune.share * (1 + 1.2 * wet)) continue; const d = Math.hypot(v.x - c.x, v.y - c.y); if (d < REACH) { v._d = d * (1 + 1.5 * Math.max(0, -((v.x - c.x) * c.dx + (v.y - c.y) * c.dy) / Math.max(d, 1))); near.push(v); } } }
    near.sort((a, b) => a._d - b._d); if (near.length > MAXV) near.length = MAXV; return near;
  }
  // air pushed by a moving body (a walker: radius 0.4 m up to 2 m; a car: 1.3 m up to 1.8 m): out of its way in front, round its sides, and
  // pulled along and curled inward behind it (two eddies of opposite hand)
  function field(i, p, v, dt) {
    const o = i * 3, x = p[o], y = p[o + 1], h = p[o + 2];
    for (const b of bodies) { if (h > b.top) continue; const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy, R = b.r * 4.2; if (d2 > R * R) continue;
      const d = Math.sqrt(d2) + 1e-4, nx = dx / d, ny = dy / d, sp = b.sp, ux = sp > 0.05 ? b.vx / sp : 0, uy = sp > 0.05 ? b.vy / sp : 0, along = nx * ux + ny * uy, side = nx * uy - ny * ux, fall = 1 - d / R, top = 1 - smooth(b.top - 0.5, b.top, h);
      if (d < b.r * 1.7) { const out = (b.r * 1.7 - d) * 20; v[o] += nx * out * dt * 9; v[o + 1] += ny * out * dt * 9; }      // never inside the body
      if (sp > 0.05) { const k = sp * fall * fall * top * dt;
        if (along > 0) { v[o] += (nx * 0.9 + -uy * Math.sign(side) * 1.6 * (1 - along)) * k * 6; v[o + 1] += (ny * 0.9 + ux * Math.sign(side) * 1.6 * (1 - along)) * k * 6; }      // ahead: pushed aside
        else { const sw = -Math.sign(side) * (0.4 + Math.abs(side)); v[o] += (ux * 1.6 + (-uy * sw) * 2.4 - nx * 0.5) * k * 5; v[o + 1] += (uy * 1.6 + (ux * sw) * 2.4 - ny * 0.5) * k * 5; v[o + 2] += k * 0.8; } } }      // behind: dragged along and curled in
    // the day's wind, with slow gusts that differ from place to place, and the column's own small turbulence
    const t = S.t, gx = Math.sin(x * 0.11 + t * 0.37) + Math.sin(y * 0.07 - t * 0.23), gy = Math.cos(y * 0.13 + t * 0.31) + Math.sin(x * 0.05 + t * 0.19), up = smooth(0.3, 3.5, h);
    v[o] += ((wind.x * (0.5 + up) + gx * 0.22 * up) - v[o]) * dt * 0.9 + Math.sin(h * 2.3 + t * 1.7 + i) * dt * 0.5; v[o + 1] += ((wind.y * (0.5 + up) + gy * 0.22 * up) - v[o + 1]) * dt * 0.9 + Math.cos(h * 2.1 - t * 1.3 + i * 1.7) * dt * 0.5;
  }
  function emit(v, dt, lod, wet) {
    // a column breathes: a slow swell with sudden fuller puffs
    v.puffT -= dt; if (v.puffT <= 0) { v.puffT = 0.35 + 1.6 * Math.random(); v.puff = 0.35 + 1.5 * Math.random() * Math.random(); }
    const rate = (110 + 60 * v.k) * S.tune.rate * lod * v.puff * (1 + 0.5 * wet); v.acc += rate * dt; const R = v.d * 0.5;
    while (v.acc >= 1) { v.acc -= 1; const a = Math.random() * TAU, big = 1 / Math.sqrt(lod), D = S.tune.dense;
      // (1) the jets: thin, fast, white, from the pick holes and the rim; this is where it is thickest
      if (Math.random() < 0.55) { const hole = Math.random() < 0.4, ha = (Math.floor(Math.random() * 2) * Math.PI) + v.k * 6, rr = hole ? R * 0.62 : R * (0.93 + 0.1 * Math.random()), aa = hole ? ha : a;
        ps.emit(v.x + Math.cos(aa) * rr, v.y + Math.sin(aa) * rr, 0.02, Math.cos(aa) * 0.25, Math.sin(aa) * 0.25, (1.7 + 1.1 * Math.random()) * v.puff, { life: 0.9 + 0.8 * Math.random(), s0: 0.05 * big, s1: (0.34 + 0.3 * Math.random()) * big, r: 1, g: 1, b: 1, a: (0.2 + 0.16 * Math.random()) * D, drag: 1.1, grav: -0.3, fin: 0.05 }); continue; }
      // (2) the body: clots that swell, roll and thin as they climb and lean with the wind; some thick, most thin; lit from above (the lower ones greyer)
      const thick = Math.random() < 0.3 ? 2.6 : 1, sh = 0.72 + 0.28 * Math.random(), rr = R * (0.2 + 0.7 * Math.random()), up = S.tune.rise * (0.7 + 0.7 * Math.random()), life = (2.6 + 2.8 * Math.random()) * (0.8 + 0.4 * v.k);
      ps.emit(v.x + Math.cos(a) * rr, v.y + Math.sin(a) * rr, 0.15 + 0.5 * Math.random(), Math.cos(a) * 0.1, Math.sin(a) * 0.1, up,
        { life, s0: 0.35 * big, s1: (1.1 + 1.3 * Math.random()) * big, r: sh, g: sh, b: sh * 1.01, a: (0.09 + 0.07 * Math.random()) * thick * D * Math.min(1.6, big), drag: 0.35, grav: -0.16, fin: 0.12 }); }
  }
  const mkHiss = () => { const s = kit.audio(); if (!s || !s.white) return null; voice = kit.voice({ ref: 2.2, max: 26, level: 0.5 }); if (!voice) return null; const a = s.ac, src = a.createBufferSource(); src.buffer = s.white; src.loop = true; src.playbackRate.value = 0.9;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.5; const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; src.connect(bp); bp.connect(hp); hp.connect(voice.in); src.start(0, Math.random()); return { src, bp }; };

  kit.onFrame((dt, t) => {
    const t0 = performance.now(); scanT -= dt; if (scanT <= 0) { scanT = 1.5; scan(); }
    if (!S.vents) return; const c = kit.cam(), wet = Math.max(g.rain ? g.rain.wet || 0 : 0, g.night ? (g.night.n || 0) * 0.6 : 0); S.t = t;
    const list = pick(c, wet); if (!list.length && !(ps && ps.n)) { if (S.awake) { S.awake = false; if (ps) ps.draw(); if (voice) voice.off(); } return; }
    S.awake = true; S.live = list; if (!ps) ps = S.ps = kit.particles({ max: MAXP, kind: 'puff', blending: 'mix', order: 6, name: 'sur_steam' });
    if (dt > 0) {
      // the wind turns slowly through the day; it is the same for every column in sight
      const wa = 0.9 + Math.sin(t * 0.013) * 1.3, ws = S.tune.wind * (0.7 + 0.45 * Math.sin(t * 0.21) + 0.25 * Math.sin(t * 0.67 + 1)); wind.x = Math.cos(wa) * ws; wind.y = Math.sin(wa) * ws;
      // who is moving air nearby
      bodies.length = 0; const pl = g.player, first = list[0];
      if (first && first._d < 40) { const add = (x, y, vx, vy, r, top) => { if (bodies.length < 14) bodies.push({ x, y, vx, vy, sp: Math.hypot(vx, vy), r, top }); };
        if (pl.vehicle) { const v = pl.vehicle; add(v.x, v.y, v.vx, v.vy, 1.3, 1.9); } else add(pl.x, pl.y, Math.cos(pl.h) * (pl.speed || 0), Math.sin(pl.h) * (pl.speed || 0), 0.4, 2.0);
        for (const q of g.traffic.cars) { if (Math.abs(q.x - c.x) > 45 || Math.abs(q.y - c.y) > 45) continue; let hit = false; for (const v of list) if (Math.abs(q.x - v.x) < 9 && Math.abs(q.y - v.y) < 9) { hit = true; break; } if (hit) add(q.x, q.y, Math.cos(q.h) * q.v, Math.sin(q.h) * q.v, q.def && q.def.len > 6 ? 1.6 : 1.3, q.def && q.def.hgt ? q.def.hgt + 0.3 : 1.9); }
        for (const q of (g.peds && g.peds.list) || []) { if (bodies.length >= 14) break; if (Math.abs(q.x - first.x) > 5 || Math.abs(q.y - first.y) > 5) continue; add(q.x, q.y, Math.cos(q.h || 0) * (q.speed || q.v || 1.3), Math.sin(q.h || 0) * (q.speed || q.v || 1.3), 0.4, 2.0); } }
      for (const v of list) emit(v, dt, v._d < 30 ? 1 : v._d < 60 ? 0.5 : 0.25, wet);
      ps.step(dt, field);
    }
    kit.light(1.0, L3); const n = g.night ? g.night.n || 0 : 0, sn = P.get('steamnight') !== '0', k = lerp(0.86, sn ? 1.3 : 0.5, n); ps.draw([L3[0] * k * (sn ? lerp(1, 1.06, n) : 1), L3[1] * k * (sn ? lerp(1, 0.96, n) : 1), L3[2] * k * (sn ? lerp(1, 0.82, n) : 1)]);      /* merge2 round 26 (Nov 18): at night the steam is lit like the lamp-lit street round it (brighter, warm) instead of at half the scene light: it drew darker than the lit windows behind it and 'reads as soot smoke' (round 25 critic). ?steamnight=0 = as before */
    if (!hiss && kit.audio() && list[0] && list[0]._d < 30) hiss = mkHiss();
    if (voice) { const v = list[0]; if (v) voice.at(v.x, v.y, 0.3, dt); else voice.off(); }
    S.ms = S.ms * 0.95 + (performance.now() - t0) * 0.05;
  }, 'steam');

  S.info = () => ({ covers: S.covers, vents: S.vents, awake: S.awake, live: S.live.length, sprites: ps ? ps.n : 0, ms: +S.ms.toFixed(3), hiss: !!hiss });
  S.nearest = (x, y, share) => { let best = null, bd = 1e9; for (const a of grid.values()) for (const v of a) { if (v.r >= (share || S.tune.share)) continue; const d = Math.hypot(v.x - x, v.y - y); if (d < bd) { bd = d; best = v; } } return best; };
  S.scan = scan;
  return S;
}

// stand the player a few steps from the nearest steaming cover, looking at it
export function show(game, kit, S) {
  S.scan(); const pl = game.player, v = S.nearest(pl.x, pl.y); if (!v) return false;
  const o = {}; game.statics.resolve(v.x - 4, v.y - 1, 0.34, o); pl.x = o.x === undefined ? v.x - 4 : o.x; pl.y = o.y === undefined ? v.y - 1 : o.y; pl.h = Math.atan2(v.y - pl.y, v.x - pl.x);
  if (pl.vehicle) { pl.vehicle = null; pl.vis.object.visible = true; game.cam.mode = 'foot'; } game.focus.x = pl.x; game.focus.y = pl.y; game.cam.yaw = pl.h; game.snapCamera(); return v;
}
