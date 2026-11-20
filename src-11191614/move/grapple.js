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
const RANGE2 = 240, CD2 = 0.8, CD_HANG = 0.35, GRAV = 18, ACC = 90, DEC = 90, UNDER = Math.tan(20 * Math.PI / 180), CONE2 = [1.5, 3, 4.5, 6.5, 9];      // the second pull (?grpull=0 = not used)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export function install(game) {
  if (game.grapple) return game.grapple;
  const g = game, pl = g.player, st = g.statics, _o = {};
  const G = (g.grapple = { on: true, key: 'KeyX', phase: '', t: 0, T: 0, cd: 0, cdMax: CD, want: false, mine: false, from: null, to: null, land: null, note: '', sub: '', noteT: 0, hintT: 0, last: null, cop: g.P.get('grcop') !== '0', cone: g.P.get('grcone') !== '0', mark: g.P.get('grmark') !== '0', roofWant: g.P.get('grroof') !== '0', v2: g.P.get('grpull') !== '0', R2: RANGE2, roof: null, aim: null, aimT: 0, looks: 0, lookMs: 0, fast: g.P.get('gpfast') !== '0', used: false, lookN: 3,      // (perf/frame) ?gpfast=0 = the marker looks from the start, as before
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
    if (!pl.roof && pl.alt > 0.16 && G.phase !== 'hang') return 'raised';      // on a garage ramp, a car's bonnet: not from there
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
    const r = G.v2 ? aim2(ray) : aimAt(ray); if (r.ok) { r.kind = r.wall ? 'wall' : onRoof ? 'across' : 'up'; return r; }
    if (onRoof && r.why !== 'too far' && r.why !== 'too high') { const q = findDown(ray); if (q) return { ok: true, kind: 'down', q }; return { ok: false, why: 'no way down' }; }
    return r; };
  // the marker's look, LOOK s apart, from the drawn frame: reads only (the height map's "last" note is put back)
  const look = (dt) => { if (G.fast) { if (!G.used && !G.phase && !(G.markT && performance.now() - G.markT < 2000)) { G.aim = null; G.aimT = 0; G.lookN = 3; return; } G.lookN++; }      // (perf/frame) the HUD below draws the marker only in these cases, so nothing is searched outside them
    G.aimT -= dt > 0 ? dt : 0.016; if (G.aimT > 0 || (G.fast && G.lookN < 3)) return; G.aimT = LOOK; G.lookN = 0;
    if (!G.mark || (G.phase && G.phase !== 'hang') || cannot()) { G.aim = null; return; } const ray = camRay(); if (!ray) { G.aim = null; return; }
    const hs = Hs(), keep = hs.last, t0 = typeof performance !== 'undefined' ? performance.now() : 0; let p; try { p = plan(ray); } finally { hs.last = keep; }
    G.looks++; if (t0) G.lookMs += performance.now() - t0;
    G.aim = !p.ok ? { ok: false, why: p.why } : p.kind === 'down' ? { ok: true, kind: 'down', x: p.q.x, y: p.q.y, z: p.q.z } : { ok: true, kind: p.kind, x: p.ex, y: p.ey, z: p.ez, snap: p.snap || 0, rise: p.lz - (G.v2 ? feet2() : feet()) }; };

  const camRay = () => { const cam = g.world && g.world.camera; if (!cam || !cam.getWorldDirection) return null; const d = cam.getWorldDirection(new THREE.Vector3()), p = cam.position; return { ox: p.x, oy: -p.z, oz: p.y, dx: d.x, dy: -d.z, dz: d.y }; };
  const begin = (phase, to, land, T) => { const fz = feet(); G.phase = 'out'; G.next = phase; G.t = 0; G.T = T; G.from = { x: pl.x, y: pl.y, z: fz }; G.to = to; G.land = land; G.mine = true; G.aim = null; G.aimT = 0;
    if (g.jump) { G.jumpWas = g.jump.on; g.jump.on = false; } pl.speed = 0; };

  // FIRE. ray optional (tests); -> { ok, why }
  G.fire = (ray) => {
    const S = G.stats, no = (why, show) => { S.refused++; S.why[why] = (S.why[why] || 0) + 1; G.last = { ok: false, why }; if (show) { say('NO HOLD', show === true ? '' : show, 0.9); G.cd = G.cdMax = CD_MISS; G.miss = ray ? { t: 0, ray } : null; } return G.last; };
    if (!G.on || (G.phase && !(G.v2 && G.phase === 'hang'))) return (G.last = { ok: false, why: 'busy' });
    const c = cannot(); if (c) { if (c === 'car') say('NOT FROM A CAR', '', 0.9); S.refused++; S.why[c] = (S.why[c] || 0) + 1; return (G.last = { ok: false, why: c }); }
    if (G.cd > 0) return (G.last = { ok: false, why: 'cooldown' });
    ray = ray || camRay(); if (!ray) return no('no camera');
    S.fired++;
    const r = plan(ray);
    if (G.v2 && G.phase === 'hang' && (!r.ok || ray.dz < DOWN)) { G.phase = 'rappel'; G.next = 'rappel'; G.t = 0; S.rappel = (S.rappel || 0) + 1; return (G.last = { ok: true, kind: 'down', rappel: true }); }      // hanging with nothing above to hold, or looking well down: down the line to whatever is under him
    if (r.ok && r.kind === 'down') { const q = r.q; begin('lower', { x: q.ex, y: q.ey, z: pl.alt + 0.2 }, { x: q.x, y: q.y, z: q.z }, clamp((pl.alt - q.z) / 22, 1.0, 2.6) + (G.v2 ? Math.max(0, pl.alt - q.z - 57) / 45 : 0)); S.lowered++; return (G.last = { ok: true, kind: 'down', ...q }); }
    if (r.ok && G.v2) { begin2(r); S.attached++; if (r.across) S.across++; if (r.snap) S.snapped++; if (r.wall) S.walls = (S.walls || 0) + 1; return (G.last = { ...r, ok: true }); }
    if (r.ok) { const D = Math.hypot(r.ex - pl.x, r.ey - pl.y, r.ez - feet());
      begin('pull', { x: r.ex, y: r.ey, z: r.ez }, { x: r.lx, y: r.ly, z: r.lz }, clamp(D / 30, 1.0, 1.5)); S.attached++; if (r.across) S.across++; if (r.snap) S.snapped++; return (G.last = { ...r, ok: true }); }
    if (r.why === 'no way down') return no('no way down', 'no open street on this side');
    return no(r.why, r.why === 'nothing to hold' ? true : r.why);
  };
  // put him down at once where the street is (a death or an arrest in the air, a fault)
  G.abort = (why) => { if (!G.phase) return; if (G.v2 && G.next !== 'lower') return abort2(why); G.stats.aborted++; const onTo = G.phase !== 'out' && G.next === 'pull' && G.t / G.T > 0.85;
    if (onTo) arrive(); else { if (G.phase === 'out') { /* not moved yet */ } else if (G.next === 'lower') { pl.x = G.land.x; pl.y = G.land.y; pl.roof = null; pl.alt = 0; G.mine = false; } else { pl.x = G.from.x; pl.y = G.from.y; pl.alt = G.from.z > 1 ? G.from.z : 0; pl.roof = G.from.z > 1 ? true : null; } done(); }
    console.log('[grapple] let go (' + why + ')'); };
  const done = () => { G.phase = ''; G.next = ''; G.tOut = 0; G.hangAt = null; G.cd = G.cdMax = wanted() && G.cop ? CD_WANTED : G.v2 ? CD2 : CD; if (g.jump && G.jumpWas !== undefined) { g.jump.on = G.jumpWas; G.jumpWas = undefined; } };
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

  // ================================================================ THE SECOND PULL (stage 1, Nov 16). ?grpull=0 = none of this runs: the pull and the limits above, as they were.
  // What changes with it: (1) REACH: a 240 m line and no limit on the rise (a 200 m roof from 40 m back across an avenue is a 205 m line); (2) AIM: a ray that
  // passes over a roof into the sky takes the edge under it (up to 20 degrees under), the cone is 1.5 to 9 degrees (the two widest rings only past 45 m), and of
  // all that hold the one nearest the crosshair is taken; (3) WALL: when the roof over the wall he aims at cannot be had (too far, no level spot, no clear
  // line) the hook bites the wall as high as the line reaches and he HANGS there; X again goes on up (the wall he hangs on if nothing else is under the crosshair); X with nothing more to hold, or looking 25 degrees down, lets him down the line at 30 m/s unhurt;
  // (4) THE PULL: the hook flies out at about 300 m/s, he is hauled along the straight line at 90 m/s2 up to 28 to 45 m/s (more on a long line), slowed only
  // in the last metres to 11 to 14 m/s, goes over the edge in an arc and runs on over the roof; (5) SPACE while he is pulled lets go: he flies on with the
  // speed he had and falls (18 m/s2, the jump's); walls stop him, the landing hurts by its speed ((v - 9) x 6 a hit, v = fall speed with a third of the
  // forward speed) and can kill. SPACE while he hangs = let go and drop.
  const feet2 = () => (G.phase === 'hang' ? pl.alt : feet());
  const hurtBy = (n) => { const c = g.combat, S = G.stats; if (!(n > 0) || !c || typeof c.hurt !== 'function') return; if (!c.heat || c.heat.failed) n = Math.min(n, Math.max(0, c.health - 5));
    try { c.hurt(n); } catch (e) { fail('hurt2', e); } S.fallHurt = (S.fallHurt || 0) + 1; if (!(c.health > 0) || (c.heat && c.heat.dead)) S.fallDead = (S.fallDead || 0) + 1; };
  const find2 = (ray, s0, deep) => {      // s0: start the ray there (past a sliver of roof nothing could stand on)
    const fz = feet2(), onRoof = !!(pl.roof && pl.alt > 1), hx0 = pl.x, hy0 = pl.y, hz0 = fz + 1.35;
    const hl = Math.hypot(ray.dx, ray.dy); if (hl < 0.05) return { ok: false, why: 'straight up or down' };
    const ux = ray.dx / hl, uy = ray.dy / hl, tmin = s0 || Math.max(0.3, ((pl.x - ray.ox) * ux + (pl.y - ray.oy) * uy) / hl);
    const at = (s) => top(ray.ox + ray.dx * s, ray.oy + ray.dy * s), isHit = (s) => { const T = at(s); return T > 2.2 && ray.oz + ray.dz * s <= T + OVER; };
    let left = !onRoof || !!s0, prev = tmin, hit = -1, cand = null, lastT = onRoof ? fz : 0;
    for (let s = tmin, sMax = Math.min(900, (G.R2 + 10) / Math.max(hl, 0.08)); s <= sMax; s += Math.max(STEP, s * 0.012)) { const z = ray.oz + ray.dz * s; if (z < -1) break; const T = at(s);
      if (!left) { if (Math.abs(T - fz) < 0.7) { prev = s; continue; } left = true; }
      if (T > 2.2) { if (z <= T + OVER) { hit = s; break; }
        if (Math.abs(T - lastT) > 0.7 && !(onRoof && Math.abs(T - fz) < 0.7)) { const m = (z - T) / s; if (m < UNDER && (!cand || m < cand.m)) cand = { a: prev, b: s, T, m }; } }      // the ray goes over this roof: its near edge is a candidate
      else if (z < T + 0.05) break;      // the ray has met the street
      lastT = T; prev = s; }
    let b, T0, under = 0, wallHit = false;
    if (hit >= 0) { let a = prev; b = hit; for (let i = 0; i < 9 && b - a > 0.02; i++) { const m = (a + b) / 2; if (isHit(m)) b = m; else a = m; } T0 = at(b); wallHit = ray.oz + ray.dz * b < T0 - 2.5; }
    else if (cand) { let a = cand.a; b = cand.b; for (let i = 0; i < 9 && b - a > 0.02; i++) { const m = (a + b) / 2; if (Math.abs(at(m) - cand.T) < 0.7) b = m; else a = m; } T0 = cand.T; under = Math.atan(cand.m) * 57.3; }
    else return { ok: false, why: 'nothing to hold' };
    const ex = ray.ox + ray.dx * b, ey = ray.oy + ray.dy * b; let why = 'no level roof there', L = null;
    for (const d of [1.0, 1.5, 2, 3, 4]) { const x = ex + ux * d, y = ey + uy * d, c = flat(x, y, T0); if (c > 0 && inMap(x, y)) { L = { x, y, z: c }; break; } }
    if (L) { const ez = Math.max(L.z, Math.min(T0, L.z + 1.5)) + 0.25;
      if (onRoof && Math.abs(L.z - fz) < 0.7 && Math.hypot(L.x - pl.x, L.y - pl.y) < 3) return { ok: false, why: 'nothing to hold' };
      if (Math.hypot(ex - hx0, ey - hy0, ez - hz0) > G.R2) why = 'too far'; else if (!lineClear(hx0, hy0, hz0, ex, ey, ez, 0.9)) why = 'no clear line';
      else return { ok: true, ex, ey, ez, lx: L.x, ly: L.y, lz: L.z, across: onRoof, under, ux, uy }; }
    if (wallHit || (hit >= 0 && why === 'too far')) { const dxy = Math.hypot(ex - hx0, ey - hy0), ax = ex - ux * 0.55, ay = ey - uy * 0.55;      // the wall itself, as high as the line reaches; he will hang 0.55 m out from it
      if (dxy < G.R2 - 4) { const zmax = hz0 + Math.sqrt(G.R2 * G.R2 - dxy * dxy) - 1;
        for (const zw of [Math.min(T0 - 2.5, zmax), ray.oz + ray.dz * b]) { if (zw < fz + 4 || zw > T0 - 2 || zw > zmax || top(ax, ay) > zw - 2.6 || !inMap(ax, ay) || !lineClear(hx0, hy0, hz0, ex, ey, zw, 0.9)) continue;
          return { ok: true, wall: true, ex, ey, ez: zw, lx: ax, ly: ay, lz: zw - 1.7, across: false, under, ux, uy, roofWhy: why }; } }
      else why = 'too far'; }
    if (hit >= 0 && why === 'no level roof there' && (deep | 0) < 2) { const r = find2(ray, b + 1.2, (deep | 0) + 1); if (r.ok) return r; }      // a lip or a sliver in front of the real wall: look on past it
    return { ok: false, why };
  };
  const aim2 = (ray) => { const r0 = find2(ray); if (r0.ok && !r0.under) return r0; let best = r0.ok ? r0 : null, ba = r0.ok ? r0.under : 99;
    const hl = Math.hypot(ray.dx, ray.dy);
    if (G.cone && hl >= 0.05) { const rx = ray.dy / hl, ry = -ray.dx / hl, ux = -ray.dz * ray.dx / hl, uy = -ray.dz * ray.dy / hl, uz = hl, fz = feet2();
      for (let k = 0; k < CONE2.length && ba > CONE2[k]; k++) for (const [a, b] of DIRS) { const t = Math.tan(CONE2[k] * Math.PI / 180), dx = ray.dx + (rx * a + ux * b) * t, dy = ray.dy + (ry * a + uy * b) * t, dz = ray.dz + uz * b * t, L = Math.hypot(dx, dy, dz);
        const r = find2({ ox: ray.ox, oy: ray.oy, oz: ray.oz, dx: dx / L, dy: dy / L, dz: dz / L }); if (!r.ok || CONE2[k] + r.under >= ba) continue;
        if (k > 2 && Math.hypot(r.ex - pl.x, r.ey - pl.y, r.ez - fz) < 45) continue;      // the two widest rings only for what is far off
        best = r; ba = CONE2[k] + r.under; } }
    if (best) { if (ba > 0) best.snap = Math.round(ba * 10) / 10; return best; }
    if (G.phase === 'hang' && G.hangAt) { const H = G.hangAt, r = find2({ ox: pl.x - H.ux * 0.4, oy: pl.y - H.uy * 0.4, oz: pl.alt + 1.5, dx: H.ux * 0.5, dy: H.uy * 0.5, dz: 0.866 }); if (r.ok) { r.own = true; return r; } }      // hanging, nothing under the crosshair: on up the wall he hangs on
    return r0; };
  const begin2 = (r) => { const hang = G.phase === 'hang', P0 = { x: pl.x, y: pl.y, z: feet2() };
    const A = r.wall ? { x: r.lx, y: r.ly, z: r.lz } : { x: r.ex, y: r.ey, z: r.ez + 0.9 }, D = Math.hypot(A.x - P0.x, A.y - P0.y, A.z - P0.z) || 0.01;      // where his feet are hauled to: the hang point, or just over the edge
    G.phase = 'out'; G.next = r.wall ? 'hang' : 'pull'; G.t = 0; G.T = 0; G.tOut = clamp(0.06 + D / 300, 0.1, 0.8); G.from = P0; G.fromHang = hang; G.to = { x: r.ex, y: r.ey, z: r.ez }; G.land = r.wall ? null : { x: r.lx, y: r.ly, z: r.lz };
    G.hangNext = r.wall ? { ux: r.ux, uy: r.uy } : null; G.p = { x: P0.x, y: P0.y, z: P0.z }; G.A = A; G.D = D; G.u = { x: (A.x - P0.x) / D, y: (A.y - P0.y) / D, z: (A.z - P0.z) / D }; G.sp = 0; G.vmax = clamp(26 + D * 0.1, 28, 45);
    G.mine = !r.wall; G.aim = null; G.aimT = 0; G.go = false; G.carry = null; if (g.jump && G.jumpWas === undefined) { G.jumpWas = g.jump.on; g.jump.on = false; } pl.speed = 0; };
  const put = () => { const p = G.p; pl.x = p.x; pl.y = p.y; pl.alt = Math.max(0.01, p.z); pl.roof = null; pl.speed = 0; if (g.cam && typeof g.cam.tz === 'number') g.cam.tz = pl.alt + 1.5; };
  const letGo = () => { const v = G.phase === 'pull' ? G.sp : 0, u = G.u, S = G.stats; S.flings = (S.flings || 0) + 1; if (G.pull) { G.pull.arr = v; G.pull.let = true; G.lastPull = G.pull; }
    G.fl = { vx: u.x * v, vy: u.y * v, vz: u.z * v, t: 0, v0: v }; G.phase = 'fling'; G.next = 'fling'; G.land = null; G.hangAt = null; G.mine = false; G.go = false; put(); };
  const landAt = (gz, imp) => { const p = G.p, f = G.fl, hl = g.heli, S = G.stats, v = Math.hypot(f.vx, f.vy), sp = Math.min(9, v); G.lastFling = { imp, t: f.t, x: p.x, y: p.y, z: gz, wall: f.wall || 0 };
    hurtBy((imp - 9) * 6);      // (G.phase is still set here: the roof guards do not look at this hurt)
    if (gz > 0.6 && gz <= 2.2) { let q = null;      // a low thing (a shed, a kiosk): not a roof to stand on; the nearest open street beside it
      for (let r = 0.5; r <= 8 && !q; r += 0.5) for (let k = 0; k < 12 && !q; k++) { const x = p.x + Math.cos(k * Math.PI / 6) * r, y = p.y + Math.sin(k * Math.PI / 6) * r, T = top(x, y); if (T < 0.6 && T > -0.5 && inMap(x, y)) { st.resolve(x, y, 0.34, _o); if (Math.hypot(_o.x - x, _o.y - y) < 0.3) q = { x: _o.x, y: _o.y }; } }
      if (q) { p.x = q.x; p.y = q.y; gz = 0; S.lowLand = (S.lowLand || 0) + 1; } }
    pl.x = p.x; pl.y = p.y;
    if (gz > 0.6) { pl.alt = gz; pl.roof = true; hl._rx = p.x; hl._ry = p.y; G.rx = p.x; G.ry = p.y; G.mine = true; if (sp > 1) G.carry = { vx: f.vx / v * sp, vy: f.vy / v * sp, t: 0, T: 0.5 }; }
    else { st.resolve(p.x, p.y, 0.34, _o); const T = top(_o.x, _o.y); if (T < 0.6 && T > -0.5 && Math.hypot(_o.x - p.x, _o.y - p.y) < 1.5) { pl.x = _o.x; pl.y = _o.y; } pl.alt = 0; pl.roof = null; G.mine = false; }
    pl.speed = sp; done(); };
  const abort2 = (why) => { G.stats.aborted++; const p = G.p;
    if (G.phase === 'out' && !G.fromHang) done(); else if (G.phase === 'vault') arrive();
    else { let T = top(p.x, p.y); if (T > p.z + 1.6) { p.x = G.from.x; p.y = G.from.y; p.z = G.from.z; T = top(p.x, p.y); } G.fl = { vx: 0, vy: 0, vz: 0, t: 0 }; landAt(T > -0.5 ? Math.max(0, T) : 0, 0); }      // he comes down where he is: the street or the roof under him
    console.log('[grapple] let go (' + why + ')'); };
  const fly2 = (dt) => { G.t += dt; const p = G.p, A = G.A, u = G.u;
    if (G.phase === 'out') { if (G.fromHang) put(); else { pl.x = G.from.x; pl.y = G.from.y; } if (G.t >= G.tOut) { G.phase = 'pull'; G.t = 0; G.sp = 6; G.pull = { D: G.D, t: 0, top: 0, arr: 0, out: G.tOut }; put(); } return; }
    if (G.phase === 'pull') { if (G.go) return letGo();
      const rem = Math.hypot(A.x - p.x, A.y - p.y, A.z - p.z), vEnd = G.next === 'hang' ? 4 : clamp(G.vmax * 0.4, 11, 14), Q = G.pull;
      G.sp = Math.min(G.vmax, G.sp + ACC * dt, Math.sqrt(vEnd * vEnd + 2 * DEC * rem)); Q.t += dt; if (G.sp > Q.top) Q.top = G.sp; const d = G.sp * dt;
      if (Math.hypot(u.x, u.y) > 0.05) pl.h = Math.atan2(u.y, u.x);
      if (d >= rem) { p.x = A.x; p.y = A.y; p.z = A.z; Q.arr = G.sp; G.lastPull = Q;
        if (G.next === 'hang') { G.phase = 'hang'; G.hangAt = G.hangNext; G.t = 0; G.cd = G.cdMax = CD_HANG; G.stats.hung = (G.stats.hung || 0) + 1; put(); return; }
        const L = G.land, dh = Math.hypot(L.x - p.x, L.y - p.y) || 0.01, vh = clamp(G.sp * Math.hypot(u.x, u.y) + 3, 6, 9), tv = Math.max(0.4, dh / vh);      // over the edge in an arc, down on the level spot
        G.phase = 'vault'; G.t = 0; G.T = tv; G.va = { x: p.x, y: p.y, z: p.z, vx: (L.x - p.x) / tv, vy: (L.y - p.y) / tv, vz: (L.z - p.z) / tv + 0.5 * GRAV * tv, run: vh / dh }; put(); return; }
      p.x += u.x * d; p.y += u.y * d; p.z += u.z * d;
      if (rem - d > 1.6 && top(p.x, p.y) > p.z + 1.6) { G.stats.scraped = (G.stats.scraped || 0) + 1; p.x -= u.x * d; p.y -= u.y * d; p.z -= u.z * d; G.sp = 0; return letGo(); }      // (never met in the tests: the line was looked along before the shot)
      put(); return; }
    if (G.phase === 'vault') { const a = G.va, t = Math.min(G.t, G.T); p.x = a.x + a.vx * t; p.y = a.y + a.vy * t; p.z = a.z + a.vz * t - 0.5 * GRAV * t * t; put(); pl.h = Math.atan2(a.vy, a.vx);
      if (G.t >= G.T) { const L = G.land, dh = Math.hypot(L.x - a.x, L.y - a.y) || 0.01; arrive(); G.carry = { vx: (L.x - a.x) * a.run, vy: (L.y - a.y) * a.run, t: 0, T: 0.5 }; pl.speed = dh * a.run; } return; }
    if (G.phase === 'rappel') { const T = top(p.x, p.y), gz = T > -0.5 ? Math.max(0, T) : 0; p.z -= Math.min(30, 4 + G.t * 30) * dt; if (p.z <= gz) { p.z = gz; G.fl = { vx: 0, vy: 0, vz: 0, t: G.t }; return landAt(gz, 0); } put(); return; }
    if (G.phase === 'hang') { put(); if (G.go) return letGo(); if (G.want && !(G.cd > 0)) G.fire(); return; }
    if (G.phase === 'fling') { if (G.free && G.free.take(G.p, G.fl)) return;      /* move/grfree.js flies him from here (the parachute works after a fling); ?grfree=0 = the fling below */
      const f = G.fl, n = Math.max(1, Math.ceil(Math.hypot(f.vx, f.vy, f.vz) * dt / 0.4)), h = dt / n; f.t += dt;
      for (let i = 0; i < n; i++) { f.vz -= GRAV * h; let nx = p.x + f.vx * h, ny = p.y + f.vy * h; const nz = p.z + f.vz * h, Tn = top(nx, ny);
        if ((f.vx || f.vy) && (Tn > nz + 0.4 || Tn <= -0.5 || !inMap(nx, ny) || (nz < 3.2 && st.raycast && st.raycast(p.x, p.y, nx, ny) < 1))) { const sp = Math.hypot(f.vx, f.vy); f.wall = sp; f.vx = f.vy = 0; nx = p.x; ny = p.y; if (sp > 12) hurtBy((sp - 12) * 3); }      // a wall (or a fence near the ground, or the map's edge): he stops against it and drops
        const T = top(nx, ny), gz = T > -0.5 ? Math.max(0, T) : 0;
        if (nz <= gz) { p.x = nx; p.y = ny; p.z = gz; return landAt(gz, Math.hypot(f.vz, 0.35 * Math.hypot(f.vx, f.vy))); }
        p.x = nx; p.y = ny; p.z = nz; }
      put(); } };
  // after the landing he runs on the way he came (0.5 s, fading), never past the roof's edge
  const carry = (dt) => { const c = G.carry; c.t += dt; const k = 1 - c.t / c.T; if (k <= 0 || G.phase || !pl.roof || pl.vehicle) { G.carry = null; return; }
    const nx = pl.x + c.vx * k * dt, ny = pl.y + c.vy * k * dt, T = top(nx, ny); if (Math.abs(T - pl.alt) > 0.6 || Math.abs(top(nx + c.vx * 0.12, ny + c.vy * 0.12) - pl.alt) > 0.6) { G.carry = null; return; }
    pl.x = nx; pl.y = ny; pl.alt = T; g.heli._rx = nx; g.heli._ry = ny; G.rx = nx; G.ry = ny; };
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && G.v2 && (G.phase === 'pull' || G.phase === 'hang')) G.go = true; });
  G.find2 = find2; G.aim2 = aim2; G.letGo = () => { if (G.v2 && (G.phase === 'pull' || G.phase === 'hang')) G.go = true; };

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
      if (G.phase) { const h = heat(); if (pl.vehicle || pl.busy || (h && h.dead) || (g.heli && g.heli.piloted)) G.abort('taken'); else if (G.v2 && G.next !== 'lower') fly2(d); else fly(d); }
      else if (G.want) G.fire();
      G.want = false; G.go = false; if (G.carry) carry(d);
      if (G.mine && !G.phase && pl.roof) { G.rx = pl.x; G.ry = pl.y; watch(d); }
      if (G.roof) { try { G.roof.step(d); } catch (e) { fail('roof', e); } }
    } catch (e) { fail('step', e); if (G.phase) { try { G.abort('fault'); } catch (e2) { G.phase = ''; } } }
  };
  if (typeof g.nearestCar === 'function') { const near0 = g.nearestCar.bind(g); g.nearestCar = function (...a) { return G.phase ? null : near0(...a); }; }      // no "F Get in" prompt (and no car taken) while the line holds him
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => { if (e.code === G.key && typeof performance !== 'undefined') G.markT = performance.now(); });
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => { if (e.repeat || e.code !== G.key || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; G.want = true; });

  // ---------------------------------------------------------------- the line and the hook (drawn), the HUD
  let rope = null, hook = null;
  const hand = (v) => { const a = pl.h - Math.PI / 2; return v.set(pl.x + Math.cos(a) * 0.22 + Math.cos(pl.h) * 0.15, (pl.alt || kerb(pl.x, pl.y)) + 1.32, -(pl.y + Math.sin(a) * 0.22 + Math.sin(pl.h) * 0.15)); };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const draw = () => {
    const sc = g.world && g.world.scene; if (!sc || !sc.add) return;
    let show = false;
    if (G.phase && G.phase !== 'vault' && G.phase !== 'fling') { hand(_a); const E = G.to; _b.set(E.x, E.z, -E.y); if (G.phase === 'out') _b.lerpVectors(_a, _b, clamp(G.t / (G.tOut || T_OUT), 0, 1)); show = true; }
    else if (G.miss && G.miss.ray) { const r = G.miss.ray, u = G.miss.t / 0.3, s = (u < 0.5 ? u * 2 : 2 - u * 2) * 22; hand(_a); _b.set(_a.x + r.dx * s, _a.y + r.dz * s, _a.z - r.dy * s); show = s > 0.3; }
    if (!show) { if (rope) rope.visible = hook.visible = false; return; }
    if (!rope) { rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x23262b })); rope.frustumCulled = false; rope.name = 'grapple-rope';
      hook = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0x8a8f98 })); hook.frustumCulled = false; hook.name = 'grapple-hook'; sc.add(rope); sc.add(hook); }
    _d.subVectors(_b, _a); const L = Math.max(0.01, _d.length()); _d.multiplyScalar(1 / L);
    rope.visible = hook.visible = true; rope.position.copy(_a).addScaledVector(_d, L / 2); rope.scale.set(1, L, 1); rope.quaternion.setFromUnitVectors(UP, _d); hook.position.copy(_b); hook.quaternion.copy(rope.quaternion);
  };
  // ================================================================ STAGE B: THE LOOK (Matt's point 3; ?grlook=0 = stage A's thin line, cone and camera exactly)
  // A camera-facing braided cable from his LEFT hand (the guns keep the right), a grapnel that flies, bites and puffs, a launcher in the hand, the arm up the line and
  // the body hauled (rig: entry/rig.js, as move/jump.js uses it), and a pull camera laid over the game's own (placeCamera wrapped; blended in and out, never cut).
  const K = (G.lk = { on: G.v2 && g.P.get('grlook') !== '0', w: 0, d: 5, f: 1, fa: 0, sp: 0, armW: 0, bodyW: 0, lean: 0, tuck: 0, clock: 0, snapT: 9, puffT: 9, reel: null, was: false, prev: '', rig: null, rigVis: null, Rig: null, saved: null, tipPx: 0, ropePx: 0, camIn: 0, frames: 0 });
  const V3 = () => new THREE.Vector3(), _hA = V3(), _hD = V3(0, 0, -1), _ax = V3(), _fw = V3(), _rt = V3(), _s = V3(), _t = V3(), _pl = V3(), _bd = V3(), _tip = V3(), _n1 = V3(), _n2 = V3(), _pp = V3(), _pv = V3(), _tg = V3(), _sd = V3(), _lastTip = V3(), _pfO = V3(), _pfD = V3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), DN = new THREE.Vector3(0, -1, 0), wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
  const TOUCH = ['hips', 'spine', 'chest', 'chest2', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  if (K.on && typeof document !== 'undefined') import('../entry/rig.js').then((m) => { K.Rig = m.EntryRig; }).catch((e) => fail('rig', e));
  const unpose = () => { const S = K.saved; if (!S || !S.live || !K.rig) return; const B = K.rig.B; for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) b.quaternion.copy(S[i]); } S.live = false; };      // the bones as the clip left them, before the mixer writes this frame's
  const lineOn = () => { const ph = G.phase; return ph === 'out' || ph === 'pull' || ph === 'hang' || ph === 'rappel' || ph === 'lower'; };
  // the arm, the body and the hand's place (_hA) and aim (_hD), in the picture's axes
  const pose = (dt) => {
    const ph = G.phase, on = lineOn(), miss = !ph && G.miss && G.miss.ray ? G.miss.ray : null, vis = pl.vis, o = vis && vis.object, base = pl.alt || kerb(pl.x, pl.y);
    _fw.set(Math.cos(pl.h), 0, -Math.sin(pl.h)); _rt.set(Math.sin(pl.h), 0, Math.cos(pl.h)); _ax.copy(_rt).multiplyScalar(-1);
    _s.set(pl.x, base + 1.42, -pl.y).addScaledVector(_rt, -0.2);
    const aimNow = () => { if (on && G.to) _hD.set(G.to.x, G.to.z, -G.to.y).sub(_s).normalize(); else if (miss) _hD.set(miss.dx, miss.dz, -miss.dy).normalize(); };
    aimNow();
    const armT = on || miss || K.reel ? 1 : 0, bodyT = ph === 'pull' || ph === 'hang' || ph === 'rappel' || ph === 'lower' || ph === 'vault' || ph === 'fling' ? 1 : 0;
    const leanT = ph === 'pull' && G.u ? clamp(0.8 * Math.acos(clamp(G.u.z, -1, 1)), 0, 1.15) : ph === 'vault' ? 0.45 : ph === 'fling' ? 0.4 : 0.06;
    K.armW = clamp(K.armW + (armT ? dt * 14 : -dt * 6), 0, 1); K.bodyW = clamp(K.bodyW + (bodyT ? dt * 9 : -dt * 6), 0, 1); K.lean += (leanT - K.lean) * Math.min(1, dt * 9); K.tuck = clamp(K.tuck + (ph === 'vault' ? dt * 8 : -dt * 6), 0, 1);
    const aw = ease(K.armW), bw = ease(K.bodyW); let posed = false;
    if ((aw > 0.01 || bw > 0.01) && K.Rig && vis && o && vis.mixer && !pl.vehicle && !pl.busy) {
      if (K.rigVis !== vis) { K.rigVis = vis; K.saved = null; try { K.rig = new K.Rig(vis, vis.name || 'player'); } catch (e) { K.rig = null; fail('rig', e); } }
      const rig = K.rig;
      if (rig && rig.ok) { const B = rig.B; o.updateMatrixWorld(true);
        { const S = K.saved || (K.saved = TOUCH.map(() => new THREE.Quaternion())); for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) S[i].copy(b.quaternion); } S.live = true; }
        if (bw > 0.01) { rig.tilt(_q.setFromAxisAngle(_ax, K.lean * bw)); _bd.set(0, -1, 0).applyQuaternion(_q); const sw = Math.sin(K.clock * 5.2) * 0.06, tk = ease(K.tuck), len = rig.thigh + rig.shin;
          for (const sd of ['L', 'R']) { const L = sd === 'L'; rig.pos('thigh_' + sd, _pp);      // legs trail: behind the line of the body, hanging a little, one knee more bent
            _t.copy(_bd).multiplyScalar(0.7).addScaledVector(DN, 0.32).addScaledVector(_fw, -(L ? 0.42 + sw : 0.15 - sw) * (1 - tk) + (L ? 0.6 : 0.4) * tk).normalize().multiplyScalar(len * ((L ? 0.84 : 0.95) - 0.2 * tk)).add(_pp);
            _pl.copy(_fw).addScaledVector(_bd, -0.3); rig._ik(B['thigh_' + sd], B['shin_' + sd], B['foot_' + sd], _t, _pl, bw); }
          rig.pos('upper_arm_R', _pp); _t.copy(_bd).multiplyScalar(0.75).addScaledVector(_fw, -0.32 + 0.5 * tk).addScaledVector(_rt, 0.3).normalize().multiplyScalar(rig.armLen * 0.9).add(_pp);      // the free arm trails
          rig.arm('R', _t, _pl.copy(_fw).multiplyScalar(-1).addScaledVector(_rt, 0.4), bw * 0.85); }
        if (aw > 0.01) { rig.pos('upper_arm_L', _s); aimNow(); _t.copy(_s).addScaledVector(_hD, rig.armLen * 0.97);
          rig.arm('L', _t, _pl.set(0, -1, 0).addScaledVector(_rt, -0.5), aw); rig.handDir('L', _hD, _rt, aw); rig.curl('L', aw);
          if (_hD.y < 0.9 && bw < 0.5) rig.look(_t.copy(_fw).lerp(_hD, 0.6), 0.5 * aw * (1 - bw)); }
        else rig.curl('L', 0);
        rig.pos('hand_L', _hA); posed = true; }
    } else if (K.rig && K.rig.ok && aw <= 0.01 && K.curlOn) K.rig.curl('L', 0);
    K.curlOn = posed && aw > 0.01; K.posed = posed;
    if (!posed) _hA.copy(_s).addScaledVector(_hD, 0.55);
    return aw;
  };
  // the cable, the grapnel, the launcher and the puff: built once, in code
  let LB = null;
  const NS = 32, RND = Array.from({ length: 16 }, (_, i) => { const a = i * 2.399963, z = ((i * 7) % 16) / 8 - 1, r = Math.sqrt(Math.max(0, 1 - z * z)); return [Math.cos(a) * r, z, Math.sin(a) * r, 0.6 + ((i * 5) % 7) / 10]; });
  const buildB = (sc) => {
    const d = new Uint8Array(8 * 8 * 4), prof = [0.3, 0.55, 1.0, 1.7, 1.15, 0.7, 0.45, 0.28];      // across: dark edges, a highlight off-centre; along: the braid's diagonal
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const k = prof[r] * ((c + r) % 4 < 2 ? 1 : 0.62), i = (r * 8 + c) * 4; d[i] = Math.min(255, 88 * k); d[i + 1] = Math.min(255, 94 * k); d[i + 2] = Math.min(255, 104 * k); d[i + 3] = 255; }
    const tex = new THREE.DataTexture(d, 8, 8); tex.wrapS = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    const geo = new THREE.BufferGeometry(), pos = new Float32Array((NS + 1) * 6), uv = new Float32Array((NS + 1) * 4), idx = [];
    for (let i = 0; i < NS; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
    const rope = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); rope.frustumCulled = false; rope.name = 'grapple-cable';
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c }), part = (grp, geo2, m, x, y, z) => { const me = new THREE.Mesh(geo2, m); me.position.set(x, y, z); me.frustumCulled = false; grp.add(me); return me; };
    const hk = new THREE.Group(), steel = mat(0xc9d0da), dark = mat(0x4a4f58); hk.name = 'grapple-grapnel';      // a three-fluke grapnel, its shank along +Y (the way it flies)
    part(hk, new THREE.CylinderGeometry(0.02, 0.026, 0.3, 6), dark, 0, 0, 0); part(hk, new THREE.TorusGeometry(0.034, 0.011, 4, 8), dark, 0, -0.18, 0);
    for (let k = 0; k < 3; k++) { const h = new THREE.Group(); h.rotation.y = k * 2.0944; const f = part(h, new THREE.TorusGeometry(0.09, 0.016, 5, 9, Math.PI + 0.5), steel, 0.09, 0.13, 0); f.rotation.z = -0.5; hk.add(h); }
    const gun = new THREE.Group(), body = mat(0x2a2d33); gun.name = 'grapple-launcher';      // a compact launcher: body, barrel, spool, a yellow band; +Y = the way it points
    part(gun, new THREE.BoxGeometry(0.055, 0.2, 0.075), body, 0, 0, 0); part(gun, new THREE.CylinderGeometry(0.02, 0.024, 0.12, 8), mat(0x7a808a), 0, 0.15, 0); part(gun, new THREE.BoxGeometry(0.06, 0.03, 0.08), mat(0xffb82e), 0, 0.06, 0);
    part(gun, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), mat(0x51565f), 0, -0.03, 0.055).rotation.z = Math.PI / 2; part(gun, new THREE.BoxGeometry(0.04, 0.05, 0.1), body, 0, -0.09, -0.06);
    const pg = new THREE.BufferGeometry(), pp = new Float32Array(48), pc = new Float32Array(48); for (let i = 0; i < 16; i++) { const s = i < 8; pc[i * 3] = s ? 1 : 0.62; pc[i * 3 + 1] = s ? 0.82 : 0.6; pc[i * 3 + 2] = s ? 0.4 : 0.56; }
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage)); pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    const puff = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.1, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 1, depthWrite: false })); puff.frustumCulled = false; puff.name = 'grapple-puff';
    for (const x of [rope, hk, gun, puff]) { x.visible = false; sc.add(x); }
    return { rope, pos, uv, hook: hk, gun, puff, pp };
  };
  const drawB = (dt) => {
    const sc = g.world && g.world.scene, cam = g.world && g.world.camera; if (!sc || !sc.add || !cam) return; K.clock += dt; K.snapT += dt; K.puffT += dt; K.frames++;
    const ph = G.phase, on = lineOn(), miss = !ph && G.miss && G.miss.ray ? G.miss : null;
    if (K.prev === 'out' && ph && ph !== 'out' && G.to) { K.snapT = 0; K.puffT = 0; _pfO.set(G.to.x, G.to.z, -G.to.y); _pfD.copy(_hD).multiplyScalar(-1); }      // the bite: the line snaps taut, sparks and dust at the anchor
    const aw = pose(dt); K.prev = ph;
    if (!LB) { if (!(on || miss)) return; LB = buildB(sc); }
    const cv = g.world.renderer && g.world.renderer.domElement, pxm = 2 * Math.tan((cam.fov || 52) * Math.PI / 360) / ((cv && cv.height) || 720);
    LB.gun.visible = aw > 0.05; if (LB.gun.visible) { LB.gun.position.copy(_hA).addScaledVector(_hD, 0.07); LB.gun.quaternion.setFromUnitVectors(UP, _hD); }
    _a.copy(_hA).addScaledVector(_hD, 0.24);      // the cable leaves the launcher's mouth
    let show = false, uo = 1, mode = 0;      // mode 1 = whipping out, 2 = held, 3 = reeling in
    if (on) { const E = G.to; _tip.set(E.x, E.z, -E.y); if (ph === 'out') { uo = clamp(G.t / (G.tOut || T_OUT), 0, 1); _tip.lerpVectors(_a, _tip, uo); mode = 1; } else mode = 2; show = true; K.reel = null; _lastTip.copy(_tip); K.was = true; }
    else { if (K.was) { K.was = false; K.reel = { t: 0, T: 0.22, b: _lastTip.clone() }; }
      if (miss) { const r = miss.ray, u = miss.t / 0.3, s = (u < 0.5 ? u * 2 : 2 - u * 2) * 22; _tip.set(_a.x + r.dx * s, _a.y + r.dz * s, _a.z - r.dy * s); show = s > 0.3; mode = 1; uo = 0.5; K.reel = null; }
      else if (K.reel) { const R = K.reel; R.t += dt; if (R.t >= R.T) K.reel = null; else { _tip.lerpVectors(R.b, _a, ease(R.t / R.T)); show = true; mode = 3; } } }
    if (K.puffT < 0.45 && LB) { const t = K.puffT, P = LB.pp, dc = cam.position.distanceTo(_pfO); for (let i = 0; i < 16; i++) { const R = RND[i], s = i < 8, v = (s ? 3.2 : 1.0) * R[3], b = s ? 1.6 : 0.5;
        P[i * 3] = _pfO.x + (_pfD.x * b + R[0] * v) * t; P[i * 3 + 1] = _pfO.y + (_pfD.y * b + R[1] * v) * t - (s ? 6 : -0.6) * t * t; P[i * 3 + 2] = _pfO.z + (_pfD.z * b + R[2] * v) * t; }
      LB.puff.geometry.attributes.position.needsUpdate = true; LB.puff.material.size = Math.max(0.09, dc * pxm * 4) * (1 + t * 2); LB.puff.material.opacity = 1 - t / 0.45; LB.puff.visible = true; } else LB.puff.visible = false;
    LB.rope.visible = LB.hook.visible = show; if (!show) { K.ropePx = 0; return; }
    _d.subVectors(_tip, _a); const L = Math.max(0.01, _d.length()); _d.multiplyScalar(1 / L);
    _n1.crossVectors(_d, UP); if (_n1.lengthSq() < 1e-4) _n1.set(1, 0, 0); _n1.normalize(); _n2.crossVectors(_d, _n1);
    const P = LB.pos, U = LB.uv, amp1 = mode === 1 ? Math.min(0.5, 0.1 + 0.03 * L) * (1 - uo * 0.6) : 0, snap = mode === 2 && K.snapT < 0.4 ? 0.22 * Math.exp(-K.snapT * 14) * Math.cos(K.snapT * 75) : 0;
    const pt = (s, out) => { out.copy(_a).addScaledVector(_d, L * s); const m = Math.sin(Math.PI * s);
      if (mode === 1) { const w = s * L * 0.9 - K.clock * 38; out.addScaledVector(_n1, Math.cos(w) * amp1 * m).addScaledVector(_n2, Math.sin(w) * amp1 * m * 0.6); out.y -= m * 0.012 * L * (1 - uo); }
      else if (mode === 2) { if (snap) out.addScaledVector(_n1, snap * (m + 0.4 * Math.sin(2 * Math.PI * s))); }
      else { out.y -= m * Math.min(1.2, 0.05 * L); out.addScaledVector(_n1, Math.sin(s * 9 - K.clock * 30) * 0.08 * m); } return out; };
    let wmin = 1e9;
    for (let i = 0; i <= NS; i++) { const s = i / NS; pt(s, _pp); pt(Math.min(1, s + 0.01), _tg).sub(pt(Math.max(0, s - 0.01), _pv)); _pv.subVectors(cam.position, _pp); const dc = _pv.length();
      _sd.crossVectors(_tg, _pv); if (_sd.lengthSq() < 1e-12) _sd.copy(_n1); _sd.normalize(); const hw = Math.max(0.022, 1.5 * pxm * dc); if (hw / (pxm * dc) < wmin) wmin = hw / (pxm * dc);
      const j = i * 6; P[j] = _pp.x + _sd.x * hw; P[j + 1] = _pp.y + _sd.y * hw; P[j + 2] = _pp.z + _sd.z * hw; P[j + 3] = _pp.x - _sd.x * hw; P[j + 4] = _pp.y - _sd.y * hw; P[j + 5] = _pp.z - _sd.z * hw;
      const k = i * 4; U[k] = U[k + 2] = s * L * 4; U[k + 1] = 0; U[k + 3] = 1; }
    LB.rope.geometry.attributes.position.needsUpdate = true; LB.rope.geometry.attributes.uv.needsUpdate = true; K.ropePx = wmin * 2;
    const dT = cam.position.distanceTo(_tip), hs = Math.max(1, dT * pxm * 14 / 0.36); K.tipPx = 0.36 * hs / (dT * pxm || 1);
    LB.hook.position.copy(_tip); LB.hook.quaternion.setFromUnitVectors(UP, mode === 3 ? _tg.copy(_d).multiplyScalar(-1) : _d); if (mode === 1) LB.hook.quaternion.multiply(_q2.setFromAxisAngle(UP, K.clock * 22)); LB.hook.scale.setScalar(hs);
  };
  // THE CAMERA over the game's own (v2c): a chase camera that rides with him. Pull: a few metres behind him on the line, out from the wall and to one side, looking past him at the anchor.
  // Over the parapet and for 0.7 s on the roof: behind and above him. Lowering and the hang's way down: out from the wall, looking back at him. Fling: behind and above. It is never inside a
  // building and never has a building between it and his head or knees (the height map is asked; other places are tried, nearer, the other side, higher), and he is kept inside the picture.
  const _cg = V3(), _cu = V3(0, 0, -1), _cn = V3(), _cr = V3(), _cc = V3(), _cw = V3(), _dh = V3(), _da = V3(), _an = V3(), _co = V3(), _ck = V3(0, 2, 4), _cl = V3(0, 0, -1), _cv = V3(0, 0, -1), _qg = new THREE.Quaternion(), _qm = new THREE.Quaternion();
  const CAMP = [null, [4.2, 1.6, 2.0], [4.6, 2.2, 1.0], [5.5, 1.5, 1.5], [5.5, 2.5, 1.0]];      // back along his way, off it (out from the wall, or up), to the side: pull, roof, down the wall, fling
  const sight = (cx, cy, cz, tx, ty, tz) => { const L = Math.hypot(tx - cx, ty - cy, tz - cz), n = Math.max(2, Math.ceil(L / 0.5)); for (let i = 0; i < n; i++) { const u = i / n; if (top(cx + (tx - cx) * u, cy + (ty - cy) * u) > cz + (tz - cz) * u - 0.25) return false; } return true; };
  const camFit = (o) => { const T = top(_cc.x + o.x, -(_cc.z + o.z)), fl = (T > -0.5 ? Math.max(0, T) : 0) + 0.5; if (T <= 0.6 && _cc.y + o.y < fl) o.y = fl - _cc.y;      // not under the street; never nearer than 4.2 m (he must fit in the picture)
    if (o.length() < 4.2) { const hh = Math.hypot(o.x, o.z), want = Math.sqrt(Math.max(0.01, 17.64 - o.y * o.y)); if (hh > 0.05) { o.x *= want / hh; o.z *= want / hh; } } };
  const camClear = (o) => { const x = _cc.x + o.x, y = -(_cc.z + o.z), z = _cc.y + o.y, a = pl.alt || 0; return sight(x, y, z, pl.x, pl.y, a + 1.7) && sight(x, y, z, pl.x, pl.y, a + 0.5); };
  const camLook = (dt) => {
    const cam = g.world && g.world.camera, C = g.cam; if (!cam || !C) return; const ph = G.phase, d = dt > 0 ? dt : 0;
    const ended = !ph && K.cph && K.cph !== 'hang' && K.cph !== 'out' && !!pl.roof; K.cph = ph; if (ph) K.set = 0; else if (ended) K.set = 0.7; else if (K.set > 0) K.set -= d;
    const m = pl.vehicle ? 0 : ph === 'rappel' || ph === 'lower' || (ph === 'out' && G.next === 'lower') ? 3 : ph === 'out' || ph === 'pull' ? 1 : ph === 'vault' || (!ph && K.set > 0) ? 2 : ph === 'fling' ? 4 : 0, tw = m ? 1 : 0, first = K.w < 0.03 && tw > 0;
    K.w += (tw - K.w) * Math.min(1, d * (tw > K.w ? 14 : 2.4)); if (K.w < 0.004) K.w = 0; if (m) K.m = m; const mm = m || K.m || 1;
    const sp = ph === 'pull' ? G.sp || 0 : ph === 'vault' && G.va ? Math.hypot(G.va.vx, G.va.vy) : ph === 'fling' && G.fl ? 0.6 * Math.hypot(G.fl.vx, G.fl.vy, G.fl.vz) : ph === 'rappel' ? 20 : 0; K.sp += (sp - K.sp) * Math.min(1, d * 6); const k = clamp(K.sp / 45, 0, 1);
    K.fa += (K.w * (3 + 15 * k) - K.fa) * Math.min(1, d * 5);
    if (m === 1 && G.u) { const u = G.u; if (Math.hypot(u.x, u.y) > 0.15) C.yaw += wrapPi(Math.atan2(u.y, u.x) - C.yaw) * Math.min(1, d * 5);      // the game's own camera is brought round behind his way of travel, and level, so the hand-back is a blend
      if (ph === 'pull') C.pitch += (0.16 - C.pitch) * Math.min(1, d * 2.2); }
    else if (m === 2) { if (ph === 'vault' && G.va) C.yaw += wrapPi(Math.atan2(G.va.vy, G.va.vx) - C.yaw) * Math.min(1, d * 5); C.pitch += (0.42 - C.pitch) * Math.min(1, d * 4); }      // on the roof the game's camera takes over from above, looking down over the parapet
    if (K.w <= 0 && K.fa < 0.02) { K.fa = 0; return; }
    const w = ease(K.w); _cg.copy(cam.position); _qg.copy(cam.quaternion); _cc.set(pl.x, (pl.alt || 0) + 1.25, -pl.y);
    _cv.copy(_cu); if (m !== 1) { _cv.y = 0; if (_cv.lengthSq() < 1e-4) _cv.set(Math.cos(C.yaw), 0, -Math.sin(C.yaw)); _cv.normalize(); }
    if (m === 1 && G.u) _cv.set(G.u.x, G.u.z, -G.u.y); else if (ph === 'vault' && G.va) _cv.set(G.va.vx, 0, -G.va.vy).normalize();
    else if (m === 3) { const F = G.from, L = G.land, H = G.hangAt; if (ph === 'rappel' && H) _cv.set(H.ux, 0, -H.uy).normalize(); else if (ph !== 'rappel' && F && L && Math.hypot(F.x - L.x, F.y - L.y) > 0.3) _cv.set(F.x - L.x, 0, -(F.y - L.y)).normalize(); }
    else if (m === 4 && G.fl && Math.hypot(G.fl.vx, G.fl.vy) > 1) _cv.set(G.fl.vx, 0, -G.fl.vy).normalize();
    if (first) _cu.copy(_cv); else _cu.lerp(_cv, Math.min(1, d * 6)).normalize();
    _cr.set(Math.sin(C.yaw), 0, Math.cos(C.yaw)); if (mm === 1) { _cn.set(0, 1, 0).addScaledVector(_cu, -_cu.y); if (_cn.lengthSq() < 0.04) _cn.set(-Math.cos(C.yaw), 0, Math.sin(C.yaw)); _cn.normalize(); } else _cn.set(0, 1, 0);
    const Q = CAMP[mm]; K.d += (Q[0] + (mm === 1 ? K.sp * 0.03 : 0) - K.d) * Math.min(1, d * 4); if (first) K.d = Q[0];
    const hs = Hs(), keep = hs.last; let ok = false;
    try { for (const f of [1, 0.75, 0.55]) { for (let c = 0; c < 4 && !ok; c++) { _co.copy(_cu).multiplyScalar(-K.d * f).addScaledVector(_cn, Q[1] * f + (c === 2 ? 2.5 : 0)).addScaledVector(_cr, c === 1 ? -Q[2] : Q[2]); if (c === 3) _co.y += Q[1] + 4; camFit(_co); ok = camClear(_co); } if (ok) break; }
      if (!ok) K.blind = (K.blind || 0) + 1;
      if (first || !d) _ck.copy(_co); else { _ck.lerp(_co, Math.min(1, d * 8)); if (ok && !camClear(_ck)) _ck.copy(_co); }
    } finally { hs.last = keep; }
    K.camIn = ok ? 0 : 1; _cw.copy(_cc).add(_ck);
    if (mm === 1) { if (ph && G.to) _an.set(G.to.x, G.to.z, -G.to.y); } else if (mm === 3) _an.copy(_cc).y -= 1.2; else _an.copy(_cc).addScaledVector(_cu, mm === 4 ? 1.5 : 2).y -= mm === 4 ? 0.8 : 0;
    _dh.copy(_cc).sub(_cw); const dist = _dh.length() || 1; _dh.multiplyScalar(1 / dist); _da.copy(_an).sub(_cw).normalize();
    const lim = Math.max(0.02, (C.fov + K.fa) * Math.PI / 360 - Math.atan(1.45 / dist) - 0.07);      // how far off the middle his chest may sit with head and feet still in the picture
    let ang = Math.acos(clamp(_dh.dot(_da), -1, 1)); _q.setFromUnitVectors(_dh, _da); _q2.set(0, 0, 0, 1).slerp(_q, ang > 1e-3 ? Math.min(1, lim / ang) : 0); _da.copy(_dh).applyQuaternion(_q2);
    if (first || !d) _cl.copy(_da); else _cl.lerp(_da, Math.min(1, d * 10)).normalize();
    ang = Math.acos(clamp(_dh.dot(_cl), -1, 1)); if (ang > lim) { _q.setFromUnitVectors(_dh, _cl); _q2.set(0, 0, 0, 1).slerp(_q, lim / ang); _cl.copy(_dh).applyQuaternion(_q2); }
    _dh.copy(_cl); if (_dh.y > 0.978) { _dh.y = 0.978; const hl = Math.hypot(_dh.x, _dh.z) || 1, s = Math.sqrt(1 - 0.978 * 0.978) / hl; if (hl < 1e-3) { _dh.x = Math.cos(C.yaw) * 0.209; _dh.z = -Math.sin(C.yaw) * 0.209; } else { _dh.x *= s; _dh.z *= s; } }
    const sh = 0.03 * k * k, n = g.frame || K.frames; _cw.x += Math.sin(n * 1.7) * sh; _cw.y += Math.sin(n * 2.3) * sh; _cw.z += Math.cos(n * 1.3) * sh;
    cam.position.copy(_cw); cam.lookAt(_cw.x + _dh.x * 10, _cw.y + _dh.y * 10, _cw.z + _dh.z * 10); _qm.copy(cam.quaternion);
    cam.position.lerpVectors(_cg, _cw, w); cam.quaternion.copy(_qg).slerp(_qm, w);
    const fov = C.fov + K.fa; if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  // (laid on in syncVisuals, after the game's updateCamera: a placeCamera wrap is skipped whenever a gun is out, combat.js places its own camera then)
  // (lead's helper traffic-fix, Nov 18; public error "computeBoundingSphere(): Computed radius is NaN", reports 201520-b9622a and 235729-8e51cc.) pl.alt does not
  // exist until he has first been off the street, and a line fired from the street leaves it alone while it flies out (phase 'out'): the line below wrote
  // `undefined` into his figure's height for those 0.8 s. His whole figure, and the launcher, cable and puff that hang on his hand's place, were NaN: he and
  // the line were NOT DRAWN while the first line of a page load flew out, and whoever next asked the scene for bounds (a roof ray, memfree, the park) logged
  // three's error for the cable. Now the height is written only when it is a number; syncVisuals has already stood him on the street. ?graltfix=0 = as before.
  const ALT_OLD = g.P.get('graltfix') === '0';
  const sync0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) { if (K.on) { try { camLook(dt); } catch (e) { fail('cam', e); } try { unpose(); } catch (e) { fail('unpose', e); } } sync0(dt); try { if (G.phase && pl.vis && pl.vis.object && !pl.vehicle && (ALT_OLD || pl.alt === +pl.alt)) pl.vis.object.position.y = pl.alt; if (K.on) drawB(dt > 0 ? Math.min(dt, 0.1) : 0.016); else draw(); look(dt); if (G.roof) G.roof.draw(dt); } catch (e) { fail('draw', e); } };
  const _p = new THREE.Vector3(), dia = (c, x, y, r) => { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.stroke(); };
  const hookHud = () => { const H = g.hud; if (!H || !H.draw || !H.text || !H.panel || G.hud) return; G.hud = true; const d0 = H.draw.bind(H);
    H.draw = function () { d0(); try { if (!H.ctx) return; const c = H.ctx, W = H.w / H.k, Hh = H.h / H.k, no = G.phase ? '' : cannot();
      if (!no || no === 'jump') { const x = W / 2 - 70, y = Hh - 118; c.globalAlpha = 0.9; H.panel(x - (pl.roof && pl.alt > 1 ? 50 : 0), y, 140 + (pl.roof && pl.alt > 1 ? 100 : 0), 30, 6);      // the hook's own line: ready, or the wait
        if (G.cd > 0 && G.cdMax > 0 && !G.phase) { c.fillStyle = '#ffb82e'; c.fillRect(x + 6, y + 24, 128 * (1 - G.cd / G.cdMax), 3); }
        H.text(G.phase === 'hang' ? 'X  UP · LOOK DOWN + X  DOWN · SPACE  DROP' : G.phase === 'pull' && G.v2 ? 'SPACE  LET GO' : G.phase ? 'HOOK' : G.cd > 0 ? 'HOOK ' + G.cd.toFixed(1) : pl.roof && pl.alt > 1 ? 'X  HOOK · LOOK DOWN: DOWN' : 'X  HOOK', W / 2, y + 20, 15, G.cd > 0 || G.phase ? '#9aa0a8' : '#fff', 'center', 600); c.globalAlpha = 1; }
      const A = G.aim, cam = g.world && g.world.camera;      // the aim marker: where X would hold and what it would do
      if (G.phase) G.used = true;      // (stage F) the marker only for 2 s after an X press, during a pull, or on a hookable edge once he has used the hook this session
      if (A && !no && cam && (G.phase || (G.markT && performance.now() - G.markT < 2000) || (A.ok && G.used))) { const armed = !!(g.combat && g.combat.armedFoot && g.combat.armedFoot());
        if (A.ok) { _p.set(A.x, A.z, -A.y).project(cam); const ready = !(G.cd > 0), col = ready ? '#ffb82e' : '#c8ccd2';
          if (_p.z < 1) { const sx = clamp((_p.x * 0.5 + 0.5) * W, 24, W - 24), sy = clamp((0.5 - _p.y * 0.5) * Hh, 24, Hh - 150);
            c.globalAlpha = ready ? 0.95 : 0.5; c.strokeStyle = 'rgba(0,0,0,0.55)'; const mr = K.on ? 6 : 9; c.lineWidth = K.on ? 3 : 4; dia(c, sx, sy, mr); c.strokeStyle = col; c.lineWidth = K.on ? 1.5 : 2; dia(c, sx, sy, mr); c.fillStyle = col; c.fillRect(sx - 1.5, sy - 1.5, 3, 3);
            H.text(ready ? A.kind.toUpperCase() : 'WAIT', sx, sy + (K.on ? 21 : 27), K.on ? 11 : 13, col, 'center', 700, 2); c.globalAlpha = 1; } }
        else { const word = A.why === 'too high' ? 'TOO HIGH' : A.why === 'too far' ? 'TOO FAR' : '';
          if (!armed) { c.globalAlpha = 0.45; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(W / 2, Hh / 2, 4, 0, 6.2832); c.stroke(); }
          if (word) { c.globalAlpha = 0.6; H.text(word, W / 2, Hh / 2 + 30, 12, '#fff', 'center', 700, 2); } c.globalAlpha = 1; } }
      if (K.on && K.w > 0.3 && K.sp > 16 && cam && G.to && G.phase === 'pull') { _p.set(G.to.x, G.to.z, -G.to.y).project(cam); const cx = _p.z < 1 ? clamp((_p.x * 0.5 + 0.5) * W, 0, W) : W / 2, cy = _p.z < 1 ? clamp((0.5 - _p.y * 0.5) * Hh, 0, Hh) : Hh / 2, kk = clamp((K.sp - 16) / 29, 0, 1);      // speed streaks, away from where he is going
        c.strokeStyle = '#fff'; c.lineWidth = 1.2; for (let i = 0; i < 12; i++) { const a = (i * 0.5236) + Math.sin(K.frames * 12.9898 + i * 78.233) * 0.25, r1 = (0.3 + 0.25 * Math.abs(Math.sin(K.frames * 3.7 + i * 5.1))) * W, r2 = r1 + 14 + K.sp * 1.3; c.globalAlpha = 0.05 + 0.13 * kk; c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke(); } c.globalAlpha = 1; }
      if (G.noteT > 0) { const a = Math.min(1, G.noteT * 4), hh = G.sub ? 60 : 40, yy = 228; c.globalAlpha = a; H.panel(W / 2 - 150, yy, 300, hh, 6); H.text(G.note, W / 2, yy + 27, 18, '#ffb82e', 'center', 700, 3); if (G.sub) H.text(G.sub, W / 2, yy + 49, 14, '#fff', 'center', 500); c.globalAlpha = 1; }
    } catch (e) { fail('hud', e); } }; };
  try { hookHud(); } catch (e) { fail('hud', e); }
  // the police on a hooked roof (move/grroof.js: true lines of sight, officers up the stairs, the helicopter); ?grroof=0 = never fetched, the first rule above stands alone
  if (G.roofWant && G.cop) import('./grroof.js').then((m) => { G.roof = m.install(g, G, { top, onMine }); }).catch((e) => fail('grroof', e));
  // no fence on the roofs, jumps, falls and the parachute (move/grfree.js); ?grfree=0 = never fetched, the roof and the fling as they were
  if (G.v2 && g.P.get('grfree') !== '0') import('./grfree.js').then((m) => { m.install(g, G, { top, hurtBy, inMap, say, done }); }).catch((e) => fail('grfree', e));
  G.find = find; G.aimAt = aimAt; G.plan = plan; G.look = look; G.findDown = findDown; G.cannot = cannot; G.top = top; G.camRay = camRay;
  console.log('[grapple] on: X fires the hook where the middle of the picture points (on foot), X on a roof = across or down; the marker shows which');
  return G;
}
