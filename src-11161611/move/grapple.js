// move/grapple.js (gameplay lane, Nov 15): a grappling hook, first small cut. ?grapple=1 turns it on; without it this file is never fetched.
// X on foot fires the hook along the crosshair's ray (the camera's, as the guns use). It holds only on a building: the top of the first wall the
// ray meets (or the roof it comes down on), no further than 45 m from his hand, no more than 40 m above or below his feet, with a clear line for
// the rope and a level spot 1 to 4 m in from the edge. The line goes out (0.15 s), he is pulled along it (1 to 1.5 s) and stands on the roof.
// X on a roof: looking well down (25 degrees or more) = the hook lowers him to the street on the side he looks at (the nearest open side if that
// one is shut); otherwise another roof under the crosshair = across to it, and nothing under it = down as well. 2 s between shots, shown in the HUD; nothing to hold on = "NO HOLD" and a short wait.
// Standing on a roof is the game's own, from the helicopter: player.roof / player.alt, and heli.step keeps him inside the parapet (he cannot walk
// off, so there is no fall). This file only wraps game.step, game.readInput and hud.draw; it edits nobody's code and needs game.heli.heights.
// Police: heatcore.js sees, shoots and arrests in the flat, so an officer at the foot of the wall shot a man on the roof above him (node: dead in
// 25 s on a 24 m roof). While he is wanted and stands on a roof the hook put him on: a shot from an officer who cannot see over the roof's edge does
// no harm, nobody cuffs him from the street, and an officer who can see over the edge (far enough back from the wall) counts as seeing him, so the
// level does not cool while they have him in view; the hook takes 4 s, not 2, to be ready again while he is wanted. ?grcop=0 switches all of that
// off. THIRD CUT (Nov 16): move/grroof.js replaces that rule with true lines of sight, officers who come up the stairs and a police helicopter
// (?grroof=0 = this file's first rule alone, as before). Not here (later ideas): swinging, wall-running, hooking cars or people, a
// controller button (proposal: LB), a pose for the pull, sound.
// MOUSE AIM (second cut, Nov 15): the hook goes where the middle of the picture points, as before (the gun's crosshair when a gun is out). New:
// (1) a hand is never exactly on an edge: when the straight ray holds nothing, rays 1.5, 3 and 4.5 degrees round it are tried, nearest first, and the
// first that holds is taken (every one obeys the same 45 m / 40 m limits); ?grcone=0 = the straight ray only. (2) an aim marker, on foot, worked out
// 8 times a second with the very test X uses: an amber diamond ON the hold point with UP / ACROSS / DOWN (grey, with WAIT, while the hook is not
// ready); nothing in reach = a dim ring in the middle, with TOO HIGH / TOO FAR when that is why. ?grmark=0 = no marker. (3) no "F Get in" prompt
// while the line holds him. The camera and the mouse are not touched: aiming at a wall finds its top, so no pitch limit is in the way.
import * as THREE from 'three';

const CONE = [1.5, 3, 4.5].map((d) => Math.tan(d * Math.PI / 180)), DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]], LOOK = 0.125;      // the aim's cone (degrees off the ray, nearest first) and how often the marker looks (s)
const RANGE = 45, RISE = 40, CD = 2, CD_WANTED = 4, CD_MISS = 0.6, T_OUT = 0.15, OVER = 3, STEP = 0.25, DOWN = -0.42;      // DOWN: the ray's fall (25 degrees below level) from which X on a roof means the way down
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export function install(game) {
  if (game.grapple) return game.grapple;
  const g = game, pl = g.player, st = g.statics, _o = {};
  const G = (g.grapple = { on: true, key: 'KeyX', phase: '', t: 0, T: 0, cd: 0, cdMax: CD, want: false, mine: false, from: null, to: null, land: null, note: '', sub: '', noteT: 0, hintT: 0, last: null, cop: g.P.get('grcop') !== '0', cone: g.P.get('grcone') !== '0', mark: g.P.get('grmark') !== '0', roofWant: g.P.get('grroof') !== '0', roof: null, aim: null, aimT: 0, looks: 0, lookMs: 0,
    stats: { fired: 0, attached: 0, refused: 0, lowered: 0, across: 0, snapped: 0, aborted: 0, copSeen: 0, shotsStopped: 0, arrestsStopped: 0, why: {} }, fails: 0 });
  const Hs = () => g.heli && g.heli.heights;
  if (!Hs()) { G.on = false; console.log('[grapple] needs the helicopter\'s height map (game.heli.heights): not installed'); return G; }
  const top = (x, y) => Hs().top(x, y, 1e4);
  const fail = (where, e) => { if (G.fails++ < 4) console.warn('[grapple] ' + where + ': ' + String((e && e.stack) || e).slice(0, 400)); };
  const say = (note, sub = '', t = 1.1) => { G.note = note; G.sub = sub; G.noteT = t; };
  const kerb = (x, y) => (st.onSidewalk(x, y) ? 0.15 : 0);
  const feet = () => (pl.roof && pl.alt > 1 ? pl.alt : kerb(pl.x, pl.y));
  const heat = () => g.combat && g.combat.heat;
  const wanted = () => { const h = heat(); return !!(h && h.level > 0); };
  const inMap = (x, y) => { const B = g.bounds; return Math.abs(x - (B.cx || 0)) < B.x - 1.5 && Math.abs(y - (B.cy || 0)) < B.y - 1.5; };

  // may he fire at all? '' = yes, else the reason (shown only for the plain ones)
  const cannot = () => {
    const hl = g.heli, h = heat(), J = g.jump;
    if (pl.vehicle) return 'car'; if (pl.busy) return 'busy';
    if (hl && (hl.piloted || hl.busy || hl.hasCamera)) return 'heli'; if (g.fly && g.fly.on) return 'fly'; if (g.demo) return 'demo';
    if (g.subway && g.subway.own) return 'subway'; if (pl.alt < 0) return 'below';
    if (h && h.dead) return 'down'; if (g.combat && g.combat.dead) return 'down';
    if (J && J.on && J.phase) return 'jump';
    if (!pl.roof && pl.alt > 0.16) return 'raised';      // on a garage ramp, a car's bonnet: not from there
    return '';
  };

  // is the level spot (x, y) good to stand on at about height T? -> its height, or -1
  const flat = (x, y, T) => { const c = top(x, y); if (c < 2.2 || Math.abs(c - T) > 4) return -1;
    for (const [u, v] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if (Math.abs(top(x + u, y + v) - c) > 0.6) return -1; return c; };
  // is the straight line a -> b clear of buildings (the last `tail` m before b are let through)?
  const lineClear = (ax, ay, az, bx, by, bz, tail) => { const L = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(2, Math.ceil(L / 0.4));
    for (let i = 1; i < n; i++) { const u = i / n; if ((1 - u) * L < tail) break; if (top(ax + (bx - ax) * u, ay + (by - ay) * u) > az + (bz - az) * u - 0.15) return false; } return true; };

  // THE AIM: ray = { ox, oy, oz, dx, dy, dz } in map space (z up). -> { ok, why, ex, ey, ez (the hook), lx, ly, lz (where he will stand) }
  const find = (ray) => {
    const fz = feet(), onRoof = !!(pl.roof && pl.alt > 1), hx0 = pl.x, hy0 = pl.y, hz0 = fz + 1.35;
    const hl = Math.hypot(ray.dx, ray.dy); if (hl < 0.05) return { ok: false, why: 'straight up or down' };
    const ux = ray.dx / hl, uy = ray.dy / hl;
    const tmin = Math.max(0.3, ((pl.x - ray.ox) * ux + (pl.y - ray.oy) * uy) / hl);      // start abreast of him, not at the camera behind him
    let left = !onRoof, prev = tmin, hit = -1, T0 = 0;
    const test = (s) => { const x = ray.ox + ray.dx * s, y = ray.oy + ray.dy * s, z = ray.oz + ray.dz * s, T = top(x, y);
      if (T > 2.2 && z <= T + OVER && !(onRoof && !left && Math.abs(T - fz) < 0.7)) { T0 = T; return true; } return false; };
    for (let s = tmin; s <= RANGE + 8; s += STEP) { const x = ray.ox + ray.dx * s, y = ray.oy + ray.dy * s, z = ray.oz + ray.dz * s;
      if (z < -1) break; const T = top(x, y);
      if (!left) { if (Math.abs(T - fz) < 0.7) { prev = s; continue; } left = true; }
      if (T > 2.2 && z <= T + OVER) { hit = s; T0 = T; break; }
      if (T <= 2.2 && z < T + 0.05) break;      // the ray has met the street
      prev = s; }
    if (hit < 0) return { ok: false, why: 'nothing to hold' };
    let a = prev, b = hit; for (let i = 0; i < 6 && b - a > 0.02; i++) { const m = (a + b) / 2; if (test(m)) b = m; else a = m; }
    const ex = ray.ox + ray.dx * b, ey = ray.oy + ray.dy * b;
    let L = null; for (const d of [1.0, 1.5, 2, 3, 4]) { const x = ex + ux * d, y = ey + uy * d, c = flat(x, y, T0); if (c > 0 && inMap(x, y)) { L = { x, y, z: c }; break; } }
    if (!L) return { ok: false, why: 'no level roof there' };
    const ez = Math.max(L.z, Math.min(T0, L.z + 1.5)) + 0.25;      // the hook sits on the edge: the parapet's top if there is one
    if (L.z - fz > RISE || fz - L.z > RISE) return { ok: false, why: 'too high' };
    if (Math.hypot(ex - hx0, ey - hy0, ez - hz0) > RANGE) return { ok: false, why: 'too far' };
    if (onRoof && Math.abs(L.z - fz) < 0.7 && Math.hypot(L.x - pl.x, L.y - pl.y) < 3) return { ok: false, why: 'nothing to hold' };
    if (!lineClear(hx0, hy0, hz0, ex, ey, ez, 0.9)) return { ok: false, why: 'no clear line' };
    return { ok: true, ex, ey, ez, lx: L.x, ly: L.y, lz: L.z, across: onRoof };
  };

  // THE WAY DOWN from a roof: the street just past the roof's edge on the side (ux, uy), else the nearest open side
  const downAlong = (ux, uy) => { const fz = pl.alt; let s = 0, edge = -1;
    for (s = 0.5; s <= 60; s += 0.5) { const T = top(pl.x + ux * s, pl.y + uy * s); if (T > fz + 0.7) return null; if (T < 0.6 && T > -0.5) { edge = s; break; } if (T <= -0.5) return null; }
    if (edge < 0) return null;
    for (const d of [1.4, 2.2, 3]) { let x = pl.x + ux * (edge + d), y = pl.y + uy * (edge + d); if (!inMap(x, y)) continue;
      st.resolve(x, y, 0.34, _o); if (Math.hypot(_o.x - x, _o.y - y) > 0.3) continue; x = _o.x; y = _o.y;      // clear of posts and wall lines by a body's half width
      const T = top(x, y); if (!(T < 0.6 && T > -0.5)) continue;
      if (st.raycast && st.raycast(pl.x + ux * (edge + 0.6), pl.y + uy * (edge + 0.6), x, y) < 1) continue;      // a fence or shop front between the wall's foot and the spot
      if (st.raycast) { let open = 0; for (let k = 0; k < 8; k++) if (st.raycast(x, y, x + Math.cos(k * Math.PI / 4) * 5, y + Math.sin(k * Math.PI / 4) * 5) >= 1) open++; if (open < 4) continue; }      // not into a pocket between walls
      return { x, y, z: T, ex: pl.x + ux * (edge - 0.3), ey: pl.y + uy * (edge - 0.3), d: edge + d }; }
    return null; };
  const findDown = (ray) => { const hl = Math.hypot(ray.dx, ray.dy), a0 = hl > 0.05 ? Math.atan2(ray.dy, ray.dx) : pl.h; let best = null;
    const first = downAlong(Math.cos(a0), Math.sin(a0)); if (first) return first;
    for (let k = 1; k < 16; k++) { const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8, q = downAlong(Math.cos(a), Math.sin(a)); if (q && (!best || q.d < best.d)) best = q; }
    return best; };

  // THE AIM WITH A HAND'S TOLERANCE: the straight ray first; if it holds nothing, the rays round it, nearest first. -> as find(), plus snap (degrees off)
  const aimAt = (ray) => { const r0 = find(ray); if (r0.ok || !G.cone) return r0;
    const hl = Math.hypot(ray.dx, ray.dy); if (hl < 0.05) return r0;
    const rx = ray.dy / hl, ry = -ray.dx / hl, ux = -ray.dz * ray.dx / hl, uy = -ray.dz * ray.dy / hl, uz = hl, q = { ox: ray.ox, oy: ray.oy, oz: ray.oz, dx: 0, dy: 0, dz: 0 };      // level right, and up square to the ray
    for (let k = 0; k < CONE.length; k++) for (const [a, b] of DIRS) { const t = CONE[k]; let dx = ray.dx + (rx * a + ux * b) * t, dy = ray.dy + (ry * a + uy * b) * t, dz = ray.dz + uz * b * t; const L = Math.hypot(dx, dy, dz); q.dx = dx / L; q.dy = dy / L; q.dz = dz / L;
      const r = find(q); if (r.ok) { r.snap = [1.5, 3, 4.5][k]; return r; } }
    return r0; };
  // WHAT X WOULD DO NOW along this ray (the marker and the shot both ask here, so they cannot disagree): -> { ok, kind: 'up' | 'across' | 'down', why, ... }
  const plan = (ray) => { const onRoof = !!(pl.roof && pl.alt > 1);
    if (onRoof && ray.dz < DOWN) { const q = findDown(ray); if (q) return { ok: true, kind: 'down', q }; }      // on a roof, looking well down: the way down (streets are narrow: the far wall is nearly always under the crosshair)
    const r = aimAt(ray); if (r.ok) { r.kind = onRoof ? 'across' : 'up'; return r; }
    if (onRoof && r.why !== 'too far' && r.why !== 'too high') { const q = findDown(ray); if (q) return { ok: true, kind: 'down', q }; return { ok: false, why: 'no way down' }; }
    return r; };
  // the marker's look, LOOK s apart, from the drawn frame: reads only (the height map's "last" note is put back)
  const look = (dt) => { G.aimT -= dt > 0 ? dt : 0.016; if (G.aimT > 0) return; G.aimT = LOOK;
    if (!G.mark || G.phase || cannot()) { G.aim = null; return; } const ray = camRay(); if (!ray) { G.aim = null; return; }
    const hs = Hs(), keep = hs.last, t0 = typeof performance !== 'undefined' ? performance.now() : 0; let p; try { p = plan(ray); } finally { hs.last = keep; }
    G.looks++; if (t0) G.lookMs += performance.now() - t0;
    G.aim = !p.ok ? { ok: false, why: p.why } : p.kind === 'down' ? { ok: true, kind: 'down', x: p.q.x, y: p.q.y, z: p.q.z } : { ok: true, kind: p.kind, x: p.ex, y: p.ey, z: p.ez, snap: p.snap || 0, rise: p.lz - feet() }; };

  const camRay = () => { const cam = g.world && g.world.camera; if (!cam || !cam.getWorldDirection) return null; const d = cam.getWorldDirection(new THREE.Vector3()), p = cam.position; return { ox: p.x, oy: -p.z, oz: p.y, dx: d.x, dy: -d.z, dz: d.y }; };
  const begin = (phase, to, land, T) => { const fz = feet(); G.phase = 'out'; G.next = phase; G.t = 0; G.T = T; G.from = { x: pl.x, y: pl.y, z: fz }; G.to = to; G.land = land; G.mine = true; G.aim = null; G.aimT = 0;
    if (g.jump) { G.jumpWas = g.jump.on; g.jump.on = false; } pl.speed = 0; };

  // FIRE. ray optional (tests); -> { ok, why }
  G.fire = (ray) => {
    const S = G.stats, no = (why, show) => { S.refused++; S.why[why] = (S.why[why] || 0) + 1; G.last = { ok: false, why }; if (show) { say('NO HOLD', show === true ? '' : show, 0.9); G.cd = G.cdMax = CD_MISS; G.miss = ray ? { t: 0, ray } : null; } return G.last; };
    if (!G.on || G.phase) return (G.last = { ok: false, why: 'busy' });
    const c = cannot(); if (c) { if (c === 'car') say('NOT FROM A CAR', '', 0.9); S.refused++; S.why[c] = (S.why[c] || 0) + 1; return (G.last = { ok: false, why: c }); }
    if (G.cd > 0) return (G.last = { ok: false, why: 'cooldown' });
    ray = ray || camRay(); if (!ray) return no('no camera');
    S.fired++;
    const r = plan(ray);
    if (r.ok && r.kind === 'down') { const q = r.q; begin('lower', { x: q.ex, y: q.ey, z: pl.alt + 0.2 }, { x: q.x, y: q.y, z: q.z }, clamp((pl.alt - q.z) / 22, 1.0, 2.6)); S.lowered++; return (G.last = { ok: true, kind: 'down', ...q }); }
    if (r.ok) { const D = Math.hypot(r.ex - pl.x, r.ey - pl.y, r.ez - feet());
      begin('pull', { x: r.ex, y: r.ey, z: r.ez }, { x: r.lx, y: r.ly, z: r.lz }, clamp(D / 30, 1.0, 1.5)); S.attached++; if (r.across) S.across++; if (r.snap) S.snapped++; return (G.last = { ...r, ok: true }); }
    if (r.why === 'no way down') return no('no way down', 'no open street on this side');
    return no(r.why, r.why === 'nothing to hold' ? true : r.why);
  };
  // put him down at once where the street is (a death or an arrest in the air, a fault)
  G.abort = (why) => { if (!G.phase) return; G.stats.aborted++; const onTo = G.phase !== 'out' && G.next === 'pull' && G.t / G.T > 0.85;
    if (onTo) arrive(); else { if (G.phase === 'out') { /* not moved yet */ } else if (G.next === 'lower') { pl.x = G.land.x; pl.y = G.land.y; pl.roof = null; pl.alt = 0; G.mine = false; } else { pl.x = G.from.x; pl.y = G.from.y; pl.alt = G.from.z > 1 ? G.from.z : 0; pl.roof = G.from.z > 1 ? true : null; } done(); }
    console.log('[grapple] let go (' + why + ')'); };
  const done = () => { G.phase = ''; G.next = ''; G.cd = G.cdMax = wanted() && G.cop ? CD_WANTED : CD; if (g.jump && G.jumpWas !== undefined) { g.jump.on = G.jumpWas; G.jumpWas = undefined; } };
  const arrive = () => { const L = G.land, hl = g.heli;
    pl.x = L.x; pl.y = L.y; if (G.next === 'pull') { pl.alt = L.z; pl.roof = true; hl._rx = L.x; hl._ry = L.y; G.mine = true; G.rx = L.x; G.ry = L.y; } else { pl.alt = 0; pl.roof = null; G.mine = false; }
    pl.speed = 0; done(); };

  // one step of the flight, after the game's own step (this alone says where he is while the line holds him)
  const fly = (dt) => {
    G.t += dt;
    if (G.phase === 'out') { pl.x = G.from.x; pl.y = G.from.y; if (G.t >= T_OUT) { G.phase = G.next; G.t = 0; pl.roof = null; pl.alt = G.from.z; } return; }
    const u = clamp(G.t / G.T, 0, 1), F = G.from, E = G.to, L = G.land;
    if (G.phase === 'pull') { const k = 0.85; if (u < k) { const e = ease(u / k) * 0.6 + (u / k) * (u / k) * 0.4; pl.x = F.x + (E.x - F.x) * e; pl.y = F.y + (E.y - F.y) * e; pl.alt = Math.max(0.01, F.z + (E.z - F.z) * e); }
      else { const e = ease((u - k) / (1 - k)); pl.x = E.x + (L.x - E.x) * e; pl.y = E.y + (L.y - E.y) * e; pl.alt = E.z + (L.z - E.z) * e; }
      pl.h = Math.atan2(E.y - F.y, E.x - F.x); }
    else { const e1 = ease(u / 0.35), e2 = ease((u - 0.25) / 0.75); pl.x = F.x + (L.x - F.x) * e1; pl.y = F.y + (L.y - F.y) * e1; pl.alt = Math.max(0.01, F.z + (L.z - F.z) * e2); }
    pl.roof = null; pl.speed = 0; if (g.cam && typeof g.cam.tz === 'number') g.cam.tz = pl.alt + 1.5;      // the camera's height keeps up with him (it eases, and lost him off the top of the picture)
    if (u >= 1) arrive();
  };

  // THE POLICE (see the head of the file). heatcore.js sees, shoots and arrests in the flat: measured in node, an officer who walked to the foot of the
  // wall "saw" a man 24 m above him 2 m away and shot him dead there, or could cuff him. Three guards, all from outside, only while he stands on a roof
  // the hook put him on: (1) a shot from an officer who cannot see over the roof's edge does no harm, (2) no arrest from the street, (3) an officer
  // who CAN see over the edge and has a clear flat line to it counts as seeing him even where the flat test says a wall is in the way.
  const onMine = () => G.mine && !G.phase && !!pl.roof && pl.alt > 2;
  // can a standing man at (x, y) on the street see him over the edge of the roof he is on?
  const seesFrom = (x, y, need) => { const dx = x - pl.x, dy = y - pl.y, d = Math.hypot(dx, dy); if (d < 0.5) return false;
    let e = 0; for (let s = 0.5; s <= d; s += 0.5) { if (Math.abs(top(pl.x + dx / d * s, pl.y + dy / d * s) - pl.alt) > 0.7) { e = s; break; } } if (!e) return false;      // no edge between them: he is inside the building below
    const back = d - e; if (back < 1 || (e - 0.5) * (pl.alt - 1.6) / back > 1.7) return false;      // under the wall, or the edge hides a standing man from there
    if (need) { need.x = pl.x + dx / d * (e + 0.4); need.y = pl.y + dy / d * (e + 0.4); } return true; };
  const _e = {};
  const guard = () => { const h = heat(), c = g.combat; if (!G.cop || !h || !c || h.lite) return;
    if (typeof c.hurt === 'function' && c.hurt !== G.hurtW) { const hurt0 = c.hurt.bind(c); G.hurtW = c.hurt = function (n) { try { const hh = heat(), src = hh && hh.src; if (src && !G.roof && onMine() && !seesFrom(src.x, src.y)) { G.stats.shotsStopped++; return; } } catch (e) { fail('hurt', e); } return hurt0(n); }; }
    if (typeof h.arrest === 'function' && h.arrest !== G.arrW) { const a0 = h.arrest.bind(h); G.arrW = h.arrest = function (...a) { if (onMine() && !(G.roof && G.roof.reach())) { G.stats.arrestsStopped++; return; } return a0(...a); }; } };
  const watch = (dt) => {
    const h = heat(); if (G.roof || !G.cop || !h || !(h.level > 0) || h.dead || !h.cops || typeof h.los !== 'function') return;
    G.wT = (G.wT || 0) - dt; if (G.wT > 0) { if (G.wSeen && !h.seen) mark(h); return; } G.wT = 0.2; G.wSeen = false;
    for (const k of h.cops) { if (!(k.hp > 0) || Math.hypot(k.x - pl.x, k.y - pl.y) > 60) continue; if (seesFrom(k.x, k.y, _e) && h.los(k.x, k.y, _e.x, _e.y)) { G.wSeen = true; break; } }
    if (G.wSeen) mark(h);
  };
  const mark = (h) => { h.seen = true; h.unseenT = 0; h.coolT = 0; h.lkp.x = pl.x; h.lkp.y = pl.y; h.lkp.h = pl.h; h.lkp.t = h.t; h.lkp.vx = 0; h.lkp.vy = 0; G.stats.copSeen++; };

  // ---------------------------------------------------------------- wrapped from outside
  const read0 = g.readInput.bind(g); g.readInput = function () { read0(); if (G.phase) { const I = g.input; I.mx = 0; I.my = 0; I.use = false; I.run = false; } };
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    const d = dt > 0 ? dt : 0;
    try { // someone else moved him off the roof I put him on (a wake-up at the clinic, a rescue): he is on the street there
      if (G.mine && !G.phase && pl.roof && pl.alt > 1 && Math.hypot(pl.x - G.rx, pl.y - G.ry) > 2.5 && Math.abs(top(pl.x, pl.y) - pl.alt) > 0.7) { pl.roof = null; pl.alt = 0; G.mine = false; }
      if (G.mine && !G.phase && !pl.roof) G.mine = false;
    } catch (e) { fail('pre', e); }
    if (G.phase) { const I = g.input; if (I) { I.mx = 0; I.my = 0; I.use = false; } }
    try { guard(); } catch (e) { fail('guard', e); }
    step0(dt);
    try {
      if (G.cd > 0) G.cd = Math.max(0, G.cd - d); if (G.noteT > 0) G.noteT -= d; if (G.miss) { G.miss.t += d; if (G.miss.t > 0.3) G.miss = null; }
      if (G.phase) { const h = heat(); if (pl.vehicle || pl.busy || (h && h.dead) || (g.heli && g.heli.piloted)) G.abort('taken'); else fly(d); }
      else if (G.want) G.fire();
      G.want = false;
      if (G.mine && !G.phase && pl.roof) { G.rx = pl.x; G.ry = pl.y; watch(d); }
      if (G.roof) { try { G.roof.step(d); } catch (e) { fail('roof', e); } }
    } catch (e) { fail('step', e); if (G.phase) { try { G.abort('fault'); } catch (e2) { G.phase = ''; } } }
  };
  if (typeof g.nearestCar === 'function') { const near0 = g.nearestCar.bind(g); g.nearestCar = function (...a) { return G.phase ? null : near0(...a); }; }      // no "F Get in" prompt (and no car taken) while the line holds him
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => { if (e.repeat || e.code !== G.key || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; G.want = true; });

  // ---------------------------------------------------------------- the line and the hook (drawn), the HUD
  let rope = null, hook = null;
  const hand = (v) => { const a = pl.h - Math.PI / 2; return v.set(pl.x + Math.cos(a) * 0.22 + Math.cos(pl.h) * 0.15, (pl.alt || kerb(pl.x, pl.y)) + 1.32, -(pl.y + Math.sin(a) * 0.22 + Math.sin(pl.h) * 0.15)); };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const draw = () => {
    const sc = g.world && g.world.scene; if (!sc || !sc.add) return;
    let show = false;
    if (G.phase) { hand(_a); const E = G.to; _b.set(E.x, E.z, -E.y); if (G.phase === 'out') _b.lerpVectors(_a, _b, clamp(G.t / T_OUT, 0, 1)); show = true; }
    else if (G.miss && G.miss.ray) { const r = G.miss.ray, u = G.miss.t / 0.3, s = (u < 0.5 ? u * 2 : 2 - u * 2) * 22; hand(_a); _b.set(_a.x + r.dx * s, _a.y + r.dz * s, _a.z - r.dy * s); show = s > 0.3; }
    if (!show) { if (rope) rope.visible = hook.visible = false; return; }
    if (!rope) { rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x23262b })); rope.frustumCulled = false; rope.name = 'grapple-rope';
      hook = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0x8a8f98 })); hook.frustumCulled = false; hook.name = 'grapple-hook'; sc.add(rope); sc.add(hook); }
    _d.subVectors(_b, _a); const L = Math.max(0.01, _d.length()); _d.multiplyScalar(1 / L);
    rope.visible = hook.visible = true; rope.position.copy(_a).addScaledVector(_d, L / 2); rope.scale.set(1, L, 1); rope.quaternion.setFromUnitVectors(UP, _d); hook.position.copy(_b); hook.quaternion.copy(rope.quaternion);
  };
  const sync0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { sync0(dt); try { if (G.phase && pl.vis && pl.vis.object && !pl.vehicle) pl.vis.object.position.y = pl.alt; draw(); look(dt); if (G.roof) G.roof.draw(dt); } catch (e) { fail('draw', e); } };
  const _p = new THREE.Vector3(), dia = (c, x, y, r) => { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.stroke(); };
  const hookHud = () => { const H = g.hud; if (!H || !H.draw || !H.text || !H.panel || G.hud) return; G.hud = true; const d0 = H.draw.bind(H);
    H.draw = function () { d0(); try { if (!H.ctx) return; const c = H.ctx, W = H.w / H.k, Hh = H.h / H.k, no = G.phase ? '' : cannot();
      if (!no || no === 'jump') { const x = W / 2 - 70, y = Hh - 118; c.globalAlpha = 0.9; H.panel(x - (pl.roof && pl.alt > 1 ? 50 : 0), y, 140 + (pl.roof && pl.alt > 1 ? 100 : 0), 30, 6);      // the hook's own line: ready, or the wait
        if (G.cd > 0 && G.cdMax > 0 && !G.phase) { c.fillStyle = '#ffb82e'; c.fillRect(x + 6, y + 24, 128 * (1 - G.cd / G.cdMax), 3); }
        H.text(G.phase ? 'HOOK' : G.cd > 0 ? 'HOOK ' + G.cd.toFixed(1) : pl.roof && pl.alt > 1 ? 'X  HOOK · LOOK DOWN: DOWN' : 'X  HOOK', W / 2, y + 20, 15, G.cd > 0 || G.phase ? '#9aa0a8' : '#fff', 'center', 600); c.globalAlpha = 1; }
      const A = G.aim, cam = g.world && g.world.camera;      // the aim marker: where X would hold and what it would do
      if (A && !no && cam) { const armed = !!(g.combat && g.combat.armedFoot && g.combat.armedFoot());
        if (A.ok) { _p.set(A.x, A.z, -A.y).project(cam); const ready = !(G.cd > 0), col = ready ? '#ffb82e' : '#c8ccd2';
          if (_p.z < 1) { const sx = clamp((_p.x * 0.5 + 0.5) * W, 24, W - 24), sy = clamp((0.5 - _p.y * 0.5) * Hh, 24, Hh - 150);
            c.globalAlpha = ready ? 0.95 : 0.5; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 4; dia(c, sx, sy, 9); c.strokeStyle = col; c.lineWidth = 2; dia(c, sx, sy, 9); c.fillStyle = col; c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
            H.text(ready ? A.kind.toUpperCase() : 'WAIT', sx, sy + 27, 13, col, 'center', 700, 2); c.globalAlpha = 1; } }
        else { const word = A.why === 'too high' ? 'TOO HIGH' : A.why === 'too far' ? 'TOO FAR' : '';
          if (!armed) { c.globalAlpha = 0.45; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(W / 2, Hh / 2, 4, 0, 6.2832); c.stroke(); }
          if (word) { c.globalAlpha = 0.6; H.text(word, W / 2, Hh / 2 + 30, 12, '#fff', 'center', 700, 2); } c.globalAlpha = 1; } }
      if (G.noteT > 0) { const a = Math.min(1, G.noteT * 4), hh = G.sub ? 60 : 40, yy = 228; c.globalAlpha = a; H.panel(W / 2 - 150, yy, 300, hh, 6); H.text(G.note, W / 2, yy + 27, 18, '#ffb82e', 'center', 700, 3); if (G.sub) H.text(G.sub, W / 2, yy + 49, 14, '#fff', 'center', 500); c.globalAlpha = 1; }
    } catch (e) { fail('hud', e); } }; };
  try { hookHud(); } catch (e) { fail('hud', e); }
  // the police on a hooked roof (move/grroof.js: true lines of sight, officers up the stairs, the helicopter); ?grroof=0 = never fetched, the first rule above stands alone
  if (G.roofWant && G.cop) import('./grroof.js').then((m) => { G.roof = m.install(g, G, { top, onMine }); }).catch((e) => fail('grroof', e));
  G.find = find; G.aimAt = aimAt; G.plan = plan; G.look = look; G.findDown = findDown; G.cannot = cannot; G.top = top; G.camRay = camRay;
  console.log('[grapple] on: X fires the hook where the middle of the picture points (on foot), X on a roof = across or down; the marker shows which');
  return G;
}
