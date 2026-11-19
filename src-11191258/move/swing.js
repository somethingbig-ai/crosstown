// move/swing.js (gameplay lane, Nov 18; Matt: "free flow and fewer limits: swing from buildings, with momentum. A rebuild, not a tune").
// ?swing=1 only; without it this file is never fetched and the grapple is as it was. With it: HOLD X (mouse side button "back", pad D-pad up) = a line
// from his launcher to the best hold ahead and above (a building face or roof edge, either side of the street); he hangs on it as a pendulum (fixed
// rope, gravity 18 as the jump's). RELEASE = let go with all his speed. W = pump (speed builds), A / D = steer the arc, SHIFT = reel in (tighter,
// faster, a slingshot up), SPACE while free in the air = the fall and parachute of move/grfree.js. No cooldown, no limit on chaining. From the
// street the line reels him up off the ground into the first arc. A wall met = he kicks off it and keeps going (no hurt while the swing has him).
// The old straight pull moves to C while ?swing=1. It wraps game.step / readInput / updateCamera / syncVisuals from outside; needs game.grapple (the
// height map and grfree's free fall). All numbers in N below; game.swing.stats counts what happened.
import * as THREE from 'three';

export const N = { G: 18, PUMP: 5, PUMPV: 33, REL: 0.6, FLYMIN: 0.3, FLYMAX: 0.9, BOT: 6, AMIN: 10, AMAX: 45, STEER: 9, REEL: 11, AUTO: 18, VMAX: 42, TURN: 0.9, DRAG: 0.012, HAND: 1.7, CLEAR: 4.5, FLOOR: 3, FALL: 12, PUMPH: 22, LATK: 0.3, LATMAX: 3.5, AVOID: 2.4, CAMD: 4.4, CAMIN: 2.0, LINEPX: 0.0068, PRE: 1, PRET: 0.18, EDGE: 30, LMIN: 5, RMAX: 95, KICK: 0.1, SUB: 1 / 120 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
const BEAR = [0, 12, -12, 24, -24, 36, -36, 50, -50, 65, -65, 80, -80].map((d) => d * Math.PI / 180), ALL = [100, -100, 125, -125, 150, -150, 180].map((d) => d * Math.PI / 180);

export function install(game) {
  if (game.swing) return game.swing;
  const g = game, pl = g.player, st = g.statics, G = g.grapple;
  const S = (g.swing = { on: true, a: null, held: false, heldWas: false, side: 0, mouse: false, space: false, mx: 0, my: 0, run: false, fails: 0, camW: 0, roll: 0, camH: 0.8, camK: 1, N,
    stats: { presses: 0, attached: 0, noAnchor: 0, fallback: 0, releases: 0, wallKicks: 0, skims: 0, vaults: 0, wraps: 0, tops: 0, reanchor: 0, roofLands: 0, streetLands: 0, toFree: 0, chutes: 0, dropped: 0, vmax: 0, autoRel: 0, saves: 0 } });
  const Hs = () => g.heli && g.heli.heights;
  if (!G || !G.on || !Hs()) { S.on = false; console.log('[swing] needs the grapple and its height map: not installed'); return S; }
  G.key = 'KeyC';      // the straight pull moves to C; X is the swing line
  const top = (x, y) => Hs().top(x, y, 1e4), ground = (x, y) => { const T = top(x, y); return T > -0.5 ? Math.max(0, T) : 0; };
  const inMap = (x, y) => { const B = g.bounds; return Math.abs(x - (B.cx || 0)) < B.x - 2 && Math.abs(y - (B.cy || 0)) < B.y - 2; };
  const fail = (where, e) => { if (S.fails++ < 4) console.warn('[swing] ' + where + ': ' + String((e && e.stack) || e).slice(0, 400)); };
  const ST = S.stats, F = () => G.free; S.arm = 'L';
  // the map's edge (EDGE m from the play bounds, going outward) or nothing but open water / off-map cells on the path ahead: no line is thrown that way, and a swing that gets there lets go
  const edgeOut = (x, y, vx, vy) => { const B = g.bounds, ex = x - (B.cx || 0), ey = y - (B.cy || 0); if ((B.x - Math.abs(ex) < N.EDGE && ex * vx > 0) || (B.y - Math.abs(ey) < N.EDGE && ey * vy > 0)) return true;
    const l = Math.hypot(vx, vy); if (l < 1) return false; for (const s of [12, 24, 36]) if (top(x + vx / l * s, y + vy / l * s) > -0.5) return false; return true; };
  const dead = () => { const c = g.combat, h = c && c.heat; return !!((h && h.dead) || (c && c.dead)); };
  const cannot = () => pl.vehicle || pl.busy || dead() || g.demo || (g.fly && g.fly.on) || (g.heli && (g.heli.piloted || g.heli.busy || g.heli.hasCamera)) || (g.subway && g.subway.own) || pl.alt < -1.5 || G.phase;
  const lineClear = (ax, ay, az, bx, by, bz, tail) => { const L = Math.hypot(bx - ax, by - ay, bz - az); if (!(L < 400)) return false; const n = Math.max(2, Math.ceil(L / 0.8));      /* a runaway or non-finite length is never marched */
    for (let i = 1; i < n; i++) { const u = i / n; if ((1 - u) * L < tail) break; if (top(ax + (bx - ax) * u, ay + (by - ay) * u) > az + (bz - az) * u - 0.15) return false; } return true; };

  // THE HOLD: from his hand (x, y, hz), heading `dir` (rad), speed v. -> { x, y, z, side, fb, fwd, lat, gmax } or null. Faces ahead on both sides first, high enough
  // that the arc clears the street and any roof under it; anything in reach (fb) if none. Each bearing offers up to three faces (a taller one behind a low one).
  S.find = (x, y, hz, dir, v, vz = 0) => { let best = null, bs = -1e9; const ux0 = Math.cos(dir), uy0 = Math.sin(dir), gm = [];
    { let m = 0; for (let s = 0; s <= 150; s += 3) { const T = top(x + ux0 * s, y + uy0 * s); if (T > m && T < (S.run ? hz + 6 : 4.5)) m = T; gm.push(m); } }      // the floor under his path (walls are not floor)
    const tryBear = (off, fb) => { const a = dir + off, ux = Math.cos(a), uy = Math.sin(a), need = fb ? 2.2 : Math.max(2.2, hz + 3); let prev = 2, n = 0, inside = false;
      for (let s = 4; s <= N.RMAX && n < 3; s += 2) { const T = top(x + ux * s, y + uy * s); if (T <= need) { prev = s; inside = false; continue; } if (inside) continue; inside = true; n++;
        let lo = prev, hi = s; for (let i = 0; i < 4; i++) { const m = (lo + hi) / 2; if (top(x + ux * m, y + uy * m) > need) hi = m; else lo = m; }
        const ex = x + ux * (hi + 0.15), ey = y + uy * (hi + 0.15), Te = Math.max(T, top(ex, ey)), d = hi, fwd = d * Math.cos(off), lat = d * Math.sin(off), al = Math.abs(lat);
        const gmax = gm[Math.min(gm.length - 1, Math.ceil(Math.max(0, 2 * fwd + 6) / 3))], amin = gmax + N.AMIN, cap = S.run ? 1e9 : gmax + N.AMAX;      // the canyon: holds 12 to 45 m over the floor under his path (Shift = any height)
        const ez = fb ? Math.min(Te - 0.4, Math.max(hz + 8, amin)) : Math.min(Te - 0.4, cap, Math.max(hz + 16, amin + 18)); if (ez < 2 || (!fb && (ez < hz + 3 || ez < amin))) continue;
        if (!inMap(ex, ey)) continue;      // never a hold beyond the play bounds: the arc under it could not be flown
        if (!lineClear(x, y, hz, ex, ey, ez, 1.2)) continue;
        const rise = ez - hz, D = Math.hypot(d, rise), side = off > 0.01 ? 1 : off < -0.01 ? -1 : 0;
        // the rope: its low point BOT over the floor. From the air he FALLS into the arc: the pivot is set where his own ballistic path meets the rope's sphere at a tangent (tau s from now); from low down the line reels him up
        const Lr = Math.max(N.LMIN, ez - N.HAND - N.BOT - gmax), z0 = hz - N.HAND, zb = gmax + N.BOT; let pf = -1, slack = false;
        if (!fb) for (let tau = 0.1; tau <= 2; tau += 0.05) { const ph = Math.atan(Math.max(0, N.G * tau - vz) / Math.max(v, 6)); if (z0 + vz * tau - 0.5 * N.G * tau * tau - zb - Lr * (1 - Math.cos(ph)) <= 0) { if (tau > 0.12) { pf = v * tau + Lr * Math.sin(ph); slack = true; } break; } }
        if (pf < 0) pf = Lr > rise + 1 ? Math.sqrt(Lr * Lr - rise * rise) : clamp(8 + v * 0.5, 10, 22); pf = Math.min(pf, 60);
        let sc = -Math.abs(fwd - pf) * 0.9 - Math.abs(al - 11) * 0.7 + Math.min(rise, 25) * 0.4 - (D > 85 ? (D - 85) * 2 : 0) - (fwd < 4 ? 25 : 0) - (fwd < 10 ? (10 - fwd) * 2 : 0);
        if (V2) sc -= Math.max(0, Math.atan2(rise, d) - 0.6) * 30 + Math.max(0, Math.abs(off) - 0.9) * 20;      /* round 13: holds inside the view are preferred */ if (side && side === -S.side) sc += 14; if (fb) sc -= 60;
        if (sc > bs) { bs = sc; best = { x: ex, y: ey, z: ez, side, fb: !!fb, fwd, lat, gmax, pf, L: Lr, slack }; } } };
    for (const b of BEAR) tryBear(b, false);
    if (!best) { for (const b of BEAR) tryBear(b, true); for (const b of ALL) tryBear(b, true); }
    return best; };

  // THE STREET he is over: its axis nearest to `want` (near a crossing the side streets too) -> { ang, d (rad off want), off (m left of the centre line) } or null
  const _tt = {}; const street = (x, y, want) => { const R = g.roads; if (!R || !R.nearestEdge || !R.edges) return null; let ne = null; try { ne = R.nearestEdge(x, y, 45); } catch (e) { return null; } if (!ne || !ne.e || !ne.e.line) return null; let best = null;
    const tryE = (e, s, own) => { e.line.at(s, _tt); const ang = Math.atan2(_tt.ty, _tt.tx); for (const k of [0, Math.PI]) { const d = Math.abs(wrapPi(ang + k - want)); if (!best || d < best.d) best = { ang: wrapPi(ang + k), d, own }; } };
    tryE(ne.e, ne.s, true); const e = ne.e, nd = ne.s < 24 ? e.a : ne.s > e.len - 24 ? e.b : -1, Nn = nd >= 0 && R.nodes && R.nodes[nd];
    if (Nn && Nn.e) for (const k of Nn.e) { const e2 = R.edges[k]; if (e2 && e2 !== e && e2.line && e2.len > 12) tryE(e2, e2.a === nd ? 2 : e2.len - 2, false); }
    best.off = best.own ? (x - ne.x) * -Math.sin(best.ang) + (y - ne.y) * Math.cos(best.ang) : 0; return best; };
  // FIRE: take him from wherever he is (street, roof, grfree's air, my own coast) onto a line. auto = a re-anchor of my own, not a press.
  const fire = (auto) => { if (V2) return fire2(auto); if (!auto) ST.presses++; const fr = F(), fa = fr && fr.a, C = g.cam;
    let a = S.a; const surf = !a && !fa;
    if (!a) { if (fa) { a = { x: fa.x, y: fa.y, z: fa.z, vx: fa.vx, vy: fa.vy, vz: fa.vz }; } else { const sp = pl.speed || 0; a = { x: pl.x, y: pl.y, z: pl.roof && pl.alt > 1 ? pl.alt : Math.max(pl.alt || 0, ground(pl.x, pl.y)), vx: Math.cos(pl.h) * sp, vy: Math.sin(pl.h) * sp, vz: 0 }; } }
    const vh = Math.hypot(a.vx, a.vy), look = C && typeof C.yaw === 'number' ? C.yaw : pl.h;
    // the heading: the axis of the street he is over, biased by where he looks and by A / D (at a crossing a held A or D takes the side street); the raw view only where there is no street
    const mx = S.a ? S.mx : (g.input && g.input.mx) || 0, base = S.a && typeof S.axis === 'number' ? wrapPi(S.axis + (Math.abs(S.oy || 0) > 0.45 ? S.oy : 0)) : look, want = wrapPi(base - mx * 1.1), sr = street(a.x, a.y, want);      /* round 6: in a chain the heading is the axis of the street he is on, turned only by A / D or a deliberate look (over 26 deg); the camera's yaw follows his velocity, so taking it as the heading let every wobble walk him off the street */
    let dir = want; if (sr && sr.d < 0.95) { dir = sr.ang; S.axis = sr.ang; }
    if (surf && pl.roof && auto) { const R = g.roads; let ne = null; try { ne = R && R.nearestEdge && R.nearestEdge(a.x, a.y, 150); } catch (e) { ne = null; } if (ne && isFinite(ne.x + ne.y) && Math.hypot(ne.x - a.x, ne.y - a.y) > 4) dir = Math.atan2(ne.y - a.y, ne.x - a.x); }      // X held on a roof: out toward the nearest street
    if (edgeOut(a.x, a.y, Math.cos(dir), Math.sin(dir))) { ST.edgeNo = (ST.edgeNo || 0) + 1; S.last = { ok: false, edge: true }; if (S.a) S.a.rewant = 0.5; return false; }
    const gnd = ground(a.x, a.y), hz = a.z + N.HAND, h = S.find(a.x, a.y, hz, dir, vh, a.vz), low = surf || a.z - gnd < 2.5;
    const under = false;
    if (!h || (h.fb && !low && !under && !S.any)) { if (!auto) ST.noAnchor++; S.last = { ok: false };
      if (!S.a && fa) { fr.a = null; fr.col = null; if (g.jump && S.jumpWas === undefined) { S.jumpWas = g.jump.on; g.jump.on = false; } Object.assign(a, { t: 0, dir, mode: 'coast', peak: a.z, skim: false, blockT: 0, avoid: 0, gA: 0, flash: 0, kickT: 0 }); S.a = a; pl.roof = null; G.mine = false; }
      if (S.a) S.a.rewant = 0.15; return false; }      // nothing in reach at all: no line, but X held keeps looking and catches the first hold that comes
    if (fa) { fr.a = null; fr.col = null; }
    if (!S.a && g.jump && S.jumpWas === undefined) { S.jumpWas = g.jump.on; g.jump.on = false; }
    const ux = Math.cos(dir), uy = Math.sin(dir);
    a.ax = h.x; a.ay = h.y; a.az = h.z; a.t = 0; a.dir = dir; a.rewant = 0; a.fb = h.fb; a.skim = low; a.blockT = 0; a.avoid = 0; a.gA = 0; a.flash = 0; a.auto = false; a.slack = false;
    if (h.fb && !under) { const k = Math.max(vh, 16); a.vx = ux * k; a.vy = uy * k; a.vz = Math.max(a.vz, 11); a.mode = 'coast'; a.peak = a.z; a.flash = 0.3; a.rewant = 0.3; ST.vaults++; }      // nothing above him: the line on a low hold vaults him up and forward; X held takes the next real hold
    else { const lat = clamp(h.lat * N.LATK, -N.LATMAX, N.LATMAX) + (sr && sr.d < 0.95 ? clamp(-sr.off, -9, 9) * 0.6 : 0);      // and toward the middle of the street      // the arc runs along the street: it turns about a point above his path, drawn toward the hold's side, not about the wall itself
      a.px = a.x + ux * h.pf - uy * lat; a.py = a.y + uy * h.pf + ux * lat; a.pz = h.z; if (!inMap(a.px, a.py)) { const B = g.bounds; a.px = clamp(a.px, (B.cx || 0) - B.x + 4, (B.cx || 0) + B.x - 4); a.py = clamp(a.py, (B.cy || 0) - B.y + 4, (B.cy || 0) + B.y - 4); }
      const D = Math.hypot(a.px - a.x, a.py - a.y, a.pz - hz);
      a.slack = !!h.slack && D > h.L; a.Lt = a.slack ? h.L : clamp(Math.min(D, h.L), N.LMIN, D); a.L = a.slack ? h.L : D; a.taut = false; a.mode = 'swing'; a.out = clamp(Math.hypot(h.x - a.x, h.y - a.y, h.z - hz) / 260, 0.04, 0.3);      // the rope is cut so the low point clears the floor under the arc
      if (low) { if (vh < 10) { a.vx = ux * 10; a.vy = uy * 10; } if (a.vz < 7) a.vz = 7; } }
    (S.dbg || (S.dbg = [])).push([+a.x.toFixed(0), +a.y.toFixed(0), +a.z.toFixed(1), Math.round(dir * 57.3), Math.round(look * 57.3), sr ? +sr.off.toFixed(1) : 99, Math.round(h.z), Math.round(a.L || 0), h.fb ? 1 : 0, Math.round(h.gmax), Math.round(vh), S.relA || 0]); if (S.dbg.length > 400) S.dbg.shift();      /* per line: x, y, z, heading, view yaw, m left of the centre line, hold z, rope, vault, floor, speed, last let-go angle */
    if (h.side) S.side = h.side; if (!h.fb) S.arm = h.side > 0 ? 'L' : h.side < 0 ? 'R' : S.arm === 'L' ? 'R' : 'L'; S.a = a; ST.attached++; if (h.fb) ST.fallback++; if (auto) ST.reanchor++; S.last = { ok: true, rise: h.z - a.z, side: h.side, fb: h.fb };
    pl.roof = null; G.mine = false; return true; };
  const end = () => { S.a = null; S.axis = undefined; if (g.jump && S.jumpWas !== undefined) { g.jump.on = S.jumpWas; S.jumpWas = undefined; } };
  const toFree = (space) => { const a = S.a, fr = F(); end(); ST.toFree++;      // grfree's fall from here: its landing rule, its parachute
    const vh = Math.hypot(a.vx, a.vy), k = !space && vh > 14 ? 14 / vh : 1;      // coming down to land he runs it out: the forward speed is not a fall
    if (fr && fr.take({ x: a.x, y: a.y, z: a.z }, { vx: a.vx * k, vy: a.vy * k, vz: a.vz })) { if (space && fr.a) { fr.a.t = Math.max(fr.a.t, 0.31); fr.spaceWant = true; ST.chutes++; } return; }
    const gz = ground(a.x, a.y); pl.x = a.x; pl.y = a.y; if (gz > 2.2) { pl.alt = gz; pl.roof = true; } else { pl.alt = 0; pl.roof = null; } };
  const standOn = (a, gz) => { const v = Math.hypot(a.vx, a.vy); end(); if (v > 7 && S.lk) S.lk.rollT = 0.55; pl.x = a.x; pl.y = a.y; pl.speed = Math.min(9, v); if (v > 1) pl.h = Math.atan2(a.vy, a.vx);
    if (gz > 2.2) { pl.alt = gz; pl.roof = true; if (g.heli) { g.heli._rx = a.x; g.heli._ry = a.y; } G.rx = a.x; G.ry = a.y; G.mine = true; ST.roofLands++; }
    else { pl.alt = 0; pl.roof = null; ST.streetLands++; } };
  // a wall at (nx, ny): the way out of it (unit, level), from the open cells round the point
  const wallN = (x, y, z, o) => { let nx = 0, ny = 0; for (let k = 0; k < 12; k++) { const c = Math.cos(k * Math.PI / 6), s = Math.sin(k * Math.PI / 6); if (top(x + c * 1.1, y + s * 1.1) <= z + 0.4) { nx += c; ny += s; } } const l = Math.hypot(nx, ny); if (l < 0.01) return false; o.x = nx / l; o.y = ny / l; return true; };
  const _n = { x: 0, y: 0 };
  const wallAt = (a, ang, d) => { const T = top(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d); return T > a.z + 6 || T <= -0.5; };
  // once a frame: the floor coming up under his path (he is lifted over it) and a facade ahead (the arc bends off it)
  const scout = (a) => { const vh = Math.hypot(a.vx, a.vy); a.gA = 0; a.avoid = 0; { const s2 = typeof S.axis === 'number' ? street(a.x, a.y, S.axis) : null; a.cOff = s2 && s2.own && s2.d < 0.5 ? s2.off : 0; } if (vh < 3) return; const va = Math.atan2(a.vy, a.vx);
    for (const t of [0.25, 0.5, 0.8]) { const T = top(a.x + a.vx * t, a.y + a.vy * t); if (T > a.gA && T < a.z + 6 && (S.run || T < 4.5 || T < a.z - 0.5)) a.gA = T; }
    const d = clamp(vh * 0.55, 5, 22); if (!wallAt(a, va, d) && !wallAt(a, va, d * 0.5)) return; const pref = wrapPi(a.dir - va) >= 0 ? 1 : -1;
    for (const r of [0.35, 0.7, 1.1]) for (const s of [pref, -pref]) if (!wallAt(a, va + s * r, d) && !wallAt(a, va + s * r, d * 0.5)) { a.avoid = s; return; } };

  const sub = (a, h) => { const sw = a.mode === 'swing' && a.t >= a.out;
    a.vz -= N.G * h; const v = Math.hypot(a.vx, a.vy, a.vz), vh = Math.hypot(a.vx, a.vy);
    if (sw) { const hz = a.z + N.HAND, below = a.pz - hz;
      if (S.my > 0 && v > 0.5 && v < N.PUMPV && below > 0 && (a.vz < 0 || a.z - Math.max(ground(a.x, a.y), a.gA) < N.PUMPH)) {      // the pump builds speed low down and on the way down, not height
        const k = N.PUMP * h / v; a.vx += a.vx * k; a.vy += a.vy * k; a.vz += a.vz * k; }
      if (S.mx && vh > 1) { const k = -S.mx * N.STEER * h / vh; const px = -a.vy * k, py = a.vx * k; a.vx += px; a.vy += py; }      // D = to his right
      if (vh > 3 && !a.avoid) { const r = clamp(wrapPi(a.dir + (S.run ? 0 : clamp(-(a.cOff || 0) * 0.03, -0.3, 0.3)) - Math.atan2(a.vy, a.vx)), -N.TURN * h, N.TURN * h), c = Math.cos(r), sn = Math.sin(r), x0 = a.vx; a.vx = x0 * c - a.vy * sn; a.vy = x0 * sn + a.vy * c; }      // the arc bends toward where he looked when he fired
      if (a.L > a.Lt) a.L = Math.max(a.Lt, a.L - N.AUTO * h); else if (S.run && a.L > N.LMIN) { a.L -= N.REEL * h; a.Lt = a.L; }
      const hgt = a.z - Math.max(ground(a.x, a.y), a.gA); if (hgt < N.FLOOR) { a.vz += 34 * (1 - Math.max(0, hgt) / N.FLOOR) * h; if (a.vz < 0) a.vz *= 1 - Math.min(1, 7 * h); } }      // the line lifts his feet over the street and over a roof coming up
    if (a.avoid && vh > 3) { const r = a.avoid * N.AVOID * h, c = Math.cos(r), sn = Math.sin(r), x0 = a.vx; a.vx = x0 * c - a.vy * sn; a.vy = x0 * sn + a.vy * c; }
    if (!S.run && a.z > 24 && a.vz > 0) a.vz *= 1 - Math.min(1, (a.z - 24) * 0.5 * h);      // the canyon's ceiling: above 24 m the climb dies away (Shift = no ceiling)
    const dk = (1 - N.DRAG * h * (v > 30 ? 1 + (v - 30) * 0.15 : 1)) * (v > N.VMAX ? N.VMAX / v : 1); a.vx *= dk; a.vy *= dk; a.vz *= dk;
    let nx = a.x + a.vx * h, ny = a.y + a.vy * h, nz = a.z + a.vz * h;
    if (sw) { const dx = nx - a.px, dy = ny - a.py, dz = nz + N.HAND - a.pz, d = Math.hypot(dx, dy, dz);
      if (a.slack) { if (d <= a.L + 0.25) a.slack = false; else if (a.t > 2.4 || dx * a.vx + dy * a.vy > 0) { a.slack = false; a.L = d; } }      // falling into the arc: the rope takes him where his path meets it (or, if he missed it, from where he is, reeling in)
      else if (d > a.L) { const ux = dx / d, uy = dy / d, uz = dz / d, pull = d - a.L, vr = a.vx * ux + a.vy * uy + a.vz * uz, v0 = Math.hypot(a.vx, a.vy, a.vz); nx -= ux * pull; ny -= uy * pull; nz -= uz * pull;
        const keep = a.L > a.Lt ? -N.AUTO * 0.55 : 0; if (vr > keep) { a.vx -= (vr - keep) * ux; a.vy -= (vr - keep) * uy; a.vz -= (vr - keep) * uz; if (keep === 0) { const v1 = Math.hypot(a.vx, a.vy, a.vz); if (v1 > 2) { const s = Math.min(1.3, v0 / v1); a.vx *= s; a.vy *= s; a.vz *= s; } } } a.taut = true; a.slackT = 0; }      // the rope turns his speed, it does not eat it
      else { a.slackT = (a.slackT || 0) + h; if (a.slackT > 0.08) a.taut = false; } }
    // walls, the map's edge
    const Tn = top(nx, ny);
    if (Tn > nz + 0.4 || Tn <= -0.5 || !inMap(nx, ny)) {
      if (Tn > 2.2 && (S.run || Tn < 4.5 || a.z - ground(a.x, a.y) < 1) && Tn - nz < (sw ? 2.2 : 1.3) && inMap(nx, ny)) { nz = Tn + 0.05; if (a.vz < 0) a.vz = 0; }      // a lip or parapet: over it
      else { let ok = Tn > nz + 0.4 && wallN(a.x, a.y, a.z, _n); if (!ok) { const l = vh || 1; _n.x = -a.vx / l; _n.y = -a.vy / l; }
        const vn = a.vx * _n.x + a.vy * _n.y; if (vn < 0) { const kk = Math.max(-(1 + N.KICK) * vn, 5 - vn); a.vx += kk * _n.x; a.vy += kk * _n.y; if (a.vz < 4) a.vz = 4; }      /* a kick-off: he leaves the wall at 5 m/s or more, going up */ else { a.vx += _n.x * 2; a.vy += _n.y * 2; }
        if (!(a.kickT > 0)) ST.wallKicks++; a.kickT = 0.25; nx = a.x + _n.x * 0.05; ny = a.y + _n.y * 0.05; if (top(nx, ny) > nz + 0.4) { nx = a.x; ny = a.y; } } }
    const gz = ground(nx, ny);
    if (nz <= gz + 0.02) { nz = gz;
      if (a.mode === 'swing' && gz <= 2.2 && !(vh < 2 && a.t > 1.5)) { if (a.vz < 0) a.vz = 0; const f = 1 - 1.5 * h / Math.max(vh, 1.5); a.vx *= f; a.vy *= f; if (!a.skim) ST.skims++; a.skim = true; }      // the line holds him: his feet skim and he runs through
      else { a.x = nx; a.y = ny; a.z = nz; if (a.mode === 'coast' && -a.vz > 13 && a.peak - gz > N.FALL) { a.z = gz + 0.05; toFree(false); } else standOn(a, gz); return false; } }      // only a real fall from height with no line is a fall; else he lands running
    else if (nz > gz + 0.6) a.skim = false;
    { const v2 = Math.hypot(a.vx, a.vy, a.vz); if (!(v2 < N.VMAX * 1.3)) { const k = v2 > 0 && isFinite(v2) ? N.VMAX / v2 : 0; a.vx = a.vx * k || 0; a.vy = a.vy * k || 0; a.vz = a.vz * k || 0; ST.clamped = (ST.clamped || 0) + 1; } if (!isFinite(nx + ny + nz)) { nx = a.x; ny = a.y; nz = a.z; } }
    a.x = nx; a.y = ny; a.z = nz; return true; };


  // ================================================================ VERSION 2 (round 11, Nov 19; Matt: "it should feel so damn smooth ... it should help you"). An ASSISTED, AUTHORED arc, not a free pendulum:
  // each line carries him along a shallow circular dip (low point BOT over the floor under his path, raised by a damped lift if anything comes up under him), heading turned toward where the camera looks
  // (bent along the street within 25 deg of its axis, kept on the street while a facade is dead ahead), speed set by a model (in at v0, out at v0 + GAIN up to CAP, a little faster through the bottom).
  // X held: at the end of the arc the next line is already out and takes over in the same frame (no cable-less flight); his velocity is carried into the new arc by a decaying offset (C1, BL s).
  // X up: the fling (speed x FLING, at least 6 m/s up), then round 7's free flight / landing / parachute rules. ?swingv=1 = the old pendulum.
  const V2 = !(g.P && g.P.get && g.P.get('swingv') === '1'); S.v2 = V2;
  const N2 = { BOT: 7.5, CLR: 6.5, CAP: 37, GAIN: 4.5, GAINW: 7, VMIN: 16, DK: 1.9, DMIN: 34, DMAX: 70, BL: 0.5, TURN: 1.3, DIP: 0.1, FLING: 1.06, PRE: 0.3, CAMD: 4.2, FOV0: 62, FOV1: 72, HE: 8.5, ACC: 56 }; S.N2 = N2;
  const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  // round 12: the dip is two half cosines (z0 down to zb over qm, up to z1 by qe): level at both ends, so one arc hands his velocity to the next unchanged; steepest half way down and half way up
  const zArc = (a, q) => q < a.qm ? a.zb + (a.z0 - a.zb) * (1 + Math.cos(Math.PI * q / a.qm)) / 2 : a.zb + (a.z1 - a.zb) * (1 - Math.cos(Math.PI * clamp((q - a.qm) / (a.qe - a.qm), 0, 1))) / 2,
    slArc = (a, q) => q < a.qm ? -(a.z0 - a.zb) * Math.PI / (2 * a.qm) * Math.sin(Math.PI * q / a.qm) : q >= a.qe ? 0 : (a.z1 - a.zb) * Math.PI / (2 * (a.qe - a.qm)) * Math.sin(Math.PI * (q - a.qm) / (a.qe - a.qm));
  const heading2 = (a, look, mx, hd) => { let th = wrapPi(look - mx * 0.6); const sr = street(a.x, a.y, th);
    if (sr && sr.d < 0.44) th = wrapPi(sr.ang + clamp(-(sr.off || 0) * 0.02, -0.2, 0.2));      // within 25 deg of the street: along it, drawn to its middle
    else if (wallAt(a, th, 12) || wallAt(a, th, 26)) { const s2 = street(a.x, a.y, hd); if (s2 && s2.d < 0.7) th = s2.ang; }      // a facade where he looks: stay on the street until the side street opens
    return th; };
  const fling = (a, up) => { a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = S.held ? 0.12 : 0; a.vx *= N2.FLING; a.vy *= N2.FLING; if (a.vz < up) a.vz = up; a.auto = false; a.slack = false; a.taut = false; S.pre = null; S.preN = 9; };
  const fire2 = (auto) => { if (!auto) ST.presses++; const fr = F(), fa = fr && fr.a, C = g.cam; let a = S.a; const surf = !a && !fa;
    if (!a) { if (fa) { a = { x: fa.x, y: fa.y, z: fa.z, vx: fa.vx, vy: fa.vy, vz: fa.vz }; } else { const sp = pl.speed || 0; a = { x: pl.x, y: pl.y, z: pl.roof && pl.alt > 1 ? pl.alt : Math.max(pl.alt || 0, ground(pl.x, pl.y)), vx: Math.cos(pl.h) * sp, vy: Math.sin(pl.h) * sp, vz: 0 }; } }
    const vh = Math.hypot(a.vx, a.vy), look = C && typeof C.yaw === 'number' ? C.yaw : pl.h, hd0 = vh > 4 ? Math.atan2(a.vy, a.vx) : look, mx = S.a ? S.mx : (g.input && g.input.mx) || 0;
    let dir = heading2(a, look, mx, hd0);
    if (surf && pl.roof && auto) { const R = g.roads; let ne = null; try { ne = R && R.nearestEdge && R.nearestEdge(a.x, a.y, 150); } catch (e) { ne = null; } if (ne && isFinite(ne.x + ne.y) && Math.hypot(ne.x - a.x, ne.y - a.y) > 4) dir = Math.atan2(ne.y - a.y, ne.x - a.x); }
    if (edgeOut(a.x, a.y, Math.cos(dir), Math.sin(dir))) { ST.edgeNo = (ST.edgeNo || 0) + 1; S.last = { ok: false, edge: true }; if (S.a) S.a.rewant = 0.5; return false; }
    const gnd = ground(a.x, a.y), hz = a.z + N.HAND, low = surf || a.z - gnd < 2.5; let h = S.find(a.x, a.y, hz, dir, Math.max(vh, 14), 0);
    if ((!h || h.fb) && Math.abs(wrapPi(hd0 - dir)) > 0.3) { const h2 = S.find(a.x, a.y, hz, hd0, Math.max(vh, 14), 0); if (h2 && !h2.fb) h = h2; }
    if ((!h || h.fb) && S.a) for (const o of [0.5, -0.5, 1, -1]) { const h3 = S.find(a.x, a.y, hz, dir + o, Math.max(vh, 14), 0); if (h3 && !h3.fb) { h = h3; break; } }      // round 12: in a chain, a hold to either side before giving up      // nothing where he looks: a hold along his flight, the arc still turns to the look
    if (!h || (h.fb && !low)) { if (!auto) ST.noAnchor++; S.last = { ok: false };
      if (!S.a && fa) { fr.a = null; fr.col = null; if (g.jump && S.jumpWas === undefined) { S.jumpWas = g.jump.on; g.jump.on = false; } Object.assign(a, { t: 0, dir, mode: 'coast', peak: a.z, skim: false, blockT: 0, avoid: 0, gA: 0, flash: 0, kickT: 0 }); S.a = a; pl.roof = null; G.mine = false; }
      if (S.a) S.a.rewant = 0.15; return false; }
    if (fa) { fr.a = null; fr.col = null; }
    if (!S.a && g.jump && S.jumpWas === undefined) { S.jumpWas = g.jump.on; g.jump.on = false; }
    const ux = Math.cos(dir), uy = Math.sin(dir);
    a.ax = h.x; a.ay = h.y; a.az = h.z; a.px = h.x; a.py = h.y; a.pz = h.z; a.t = 0; a.dir = dir; a.rewant = 0; a.fb = h.fb; a.skim = false; a.blockT = 0; a.avoid = 0; a.gA = 0; a.flash = 0; a.auto = false; a.slack = false; a.kickT = 0;
    if (h.fb) { const k = Math.max(vh, 16); a.vx = ux * k; a.vy = uy * k; a.vz = Math.max(a.vz, 11); a.mode = 'coast'; a.peak = a.z; a.flash = 0.3; a.rewant = 0.3; ST.vaults++; }
    else { const v0 = clamp(vh, N2.VMIN, N2.CAP), D = clamp(v0 * N2.DK, N2.DMIN, N2.DMAX), zb = Math.max(h.gmax + N2.BOT, Math.min(treeAlong(a.x, a.y, ux, uy, D + 10), h.gmax + 16) + 2.5), He = N2.HE, over = a.z - zb, H = clamp(over, 0, 14);
      a.z0 = a.z; if (H < 1.2) { a.zb = a.z; a.qm = 0; } else { a.zb = a.z - H; a.qm = D / 2 * clamp(Math.sqrt(H / He), 0.6, 1.25); }      // from low down: he starts at the bottom of the dip and rises
      a.z1 = Math.max(a.zb, zb) + He; a.qe = a.qm + D / 2 * clamp(Math.sqrt((a.z1 - a.zb) / He), 0.7, 1.4); a.qx = a.x; a.qy = a.y; a.qz = a.z; a.xq = 0; a.rq = 10; a.ext = 0; a.v0 = v0; a.v1 = Math.min(N2.CAP, v0 + (S.my > 0 ? N2.GAINW : N2.GAIN)); a.q = 0; a.bx = a.x; a.by = a.y; a.lift = 0; a.lv = 0; a.bt = 0; a.w = a.w || 0; a.hd = hd0; a.stuck = 0; a.preT = false;
      const sl = slArc(a, 0), c = 1 / Math.sqrt(1 + sl * sl); a.dvx = a.vx - v0 * c * Math.cos(hd0); a.dvy = a.vy - v0 * c * Math.sin(hd0); a.dvz = a.vz - v0 * c * sl;      // his velocity now, less the arc's: carried in and eased out over BL s (no snap)
      { const m = Math.hypot(a.dvx, a.dvy, a.dvz); if (m > 45) { a.dvx *= 45 / m; a.dvy *= 45 / m; a.dvz *= 45 / m; } }
      a.L = a.Lt = Math.hypot(h.x - a.x, h.y - a.y, h.z - hz); a.taut = true; a.mode = 'swing'; a.out = 0.04; }
    if (h.side) S.side = h.side; if (!h.fb) S.arm = h.side > 0 ? 'L' : h.side < 0 ? 'R' : S.arm === 'L' ? 'R' : 'L'; S.a = a; ST.attached++; if (h.fb) ST.fallback++; if (auto) ST.reanchor++; S.last = { ok: true, rise: h.z - a.z, side: h.side, fb: h.fb }; S.pre = null;
    pl.roof = null; G.mine = false; return true; };
  const fly2 = (dt) => { let a = S.a; const C = g.cam; a.t += dt; if (a.flash > 0) a.flash -= dt; if (a.kickT > 0) a.kickT -= dt;
    if (!S.held) { fling(a, 6); ST.releases++; return fly(dt); }      // X up: the fling
    if (edgeOut(a.x, a.y, a.vx, a.vy)) { ST.edgeDrops = (ST.edgeDrops || 0) + 1; S.pre = null; a.vz = Math.max(a.vz, 8); return toFree(a.z - ground(a.x, a.y) > 5); }      // the map's edge, a park, the river: a long high fling and the parachute rule
    scout(a); const th = heading2(a, C && typeof C.yaw === 'number' ? C.yaw : a.hd, S.mx, a.hd); a.dir = th; S.axis = th;
    const g0 = [a.x, a.y, a.z, a.vx, a.vy, a.vz], n = Math.min(24, Math.max(1, Math.ceil(dt / N.SUB))), h = dt / n; let done = false;
    for (let i = 0; i < n && !done; i++) { const wt = a.avoid ? a.avoid * 1.8 : clamp(wrapPi(th - a.hd) * 3, -Math.min(N2.TURN, 42 / (a.v1 * (1 - 0.45 * (a.sk || 0)))), Math.min(N2.TURN, 42 / (a.v1 * (1 - 0.45 * (a.sk || 0))))); a.w += (wt - a.w) * Math.min(1, 9 * h); a.hd = wrapPi(a.hd + a.w * h);
      const u = clamp(a.q / a.qe, 0, 1), sp = (a.v0 + (a.v1 - a.v0) * sm(u) + N2.DIP * a.v1 * Math.sin(Math.PI * u)) * (1 - 0.45 * (a.sk = (a.sk || 0) + (sm(Math.abs(wrapPi(th - a.hd)) / 1.2) - (a.sk || 0)) * Math.min(1, 3 * h))), sl = slArc(a, a.q), dq = sp / Math.sqrt(1 + sl * sl) * h, zt = zArc(a, a.q + dq);
      let cx = Math.cos(a.hd), cy = Math.sin(a.hd), nbx = a.bx + cx * dq, nby = a.by + cy * dq, Tn = top(nbx, nby);
      { const zw = zt + a.lift + 0.4, wl = top(nbx - cy * 2.5 + cx * 2, nby + cx * 2.5 + cy * 2) > zw, wr = top(nbx + cy * 2.5 + cx * 2, nby - cx * 2.5 + cy * 2) > zw; if (wl !== wr) { a.hd = wrapPi(a.hd + (wl ? -2.2 : 2.2) * h); a.w = 0; ST.shy = (ST.shy || 0) + 1; } }      // round 12: a facade within 2.5 m on one side: he turns away from it before it is met
      if (Tn > zt + a.lift + 0.4 || Tn <= -0.5 || !inMap(nbx, nby)) {      // a wall after all (the bend did not clear it): he slides along it, never kicks or sticks
        if (!(a.kickT > 0)) ST.wallKicks++; a.kickT = 0.25; a.stuck += h; let ok = false;
        if (wallN(a.bx, a.by, zt + a.lift, _n)) { const vn = cx * _n.x + cy * _n.y; if (vn < 0) { cx -= vn * _n.x * 1.15; cy -= vn * _n.y * 1.15; const l = Math.hypot(cx, cy) || 1; cx /= l; cy /= l; a.hd = Math.atan2(cy, cx); a.w = 0; } nbx = a.bx + cx * dq; nby = a.by + cy * dq; Tn = top(nbx, nby); ok = !(Tn > zt + a.lift + 0.4 || Tn <= -0.5 || !inMap(nbx, nby)); }
        if (!ok) { const pref = wrapPi(a.dir - a.hd) >= 0 ? 1 : -1, zz = zt + a.lift + 0.4, bad = (T) => T > zz || T <= -0.5;      // round 12: no stop and no reverse: the nearest clear heading (the look's side first), he runs along the wall
          for (let k = 1; k <= 9 && !ok; k++) for (const s of [pref, -pref]) { const an = a.hd + s * k * 0.33, c2 = Math.cos(an), s2 = Math.sin(an), ex = a.bx + c2 * dq, ey = a.by + s2 * dq;
            if (!bad(top(ex, ey)) && inMap(ex, ey) && !bad(top(a.bx + c2 * 3, a.by + s2 * 3))) { a.hd = wrapPi(an); a.w = 0; cx = c2; cy = s2; nbx = ex; nby = ey; ok = true; break; } }
          if (!ok) { nbx = a.bx; nby = a.by; if (Tn > 0 && Tn < zz + 25) a.gA = Math.max(a.gA, Tn); ST.pinned = (ST.pinned || 0) + 1; } } }
      else if (a.stuck > 0) a.stuck = Math.max(0, a.stuck - h);
      a.q += dq; a.bx = nbx; a.by = nby; a.bt += h;
      const la = sp * 0.25, fl = (X, Y) => { const T = ground(X, Y); return T < zt + a.lift + 0.4 ? T : 0; }, need = Math.max(0, Math.max(ground(nbx, nby), fl(nbx + cx * la, nby + cy * la), fl(nbx + cx * la * 2, nby + cy * la * 2), a.gA) + N2.CLR - zt, Math.max(treeTop(nbx, nby), treeTop(nbx + cx * la, nby + cy * la)) + 2 - zt); a.lv += ((need - a.lift) * 36 - a.lv * 12) * h; a.lift += a.lv * h;      // never the ground: a damped lift keeps CLR over whatever is under and just ahead
      const T = N2.BL, f = a.bt < T ? a.bt * (1 - a.bt / T) * (1 - a.bt / T) : 0, nx = nbx + a.dvx * f, ny = nby + a.dvy * f; let nz = zt + a.lift + a.dvz * f; { const gz = ground(nx, ny) + 0.3; if (nz < gz) nz = gz; }
      { const pvx = (nx - a.qx) / h, pvy = (ny - a.qy) / h, pvz = (nz - a.qz) / h; a.qx = nx; a.qy = ny; a.qz = nz;      // round 12: his body chases the authored point; its change of velocity is capped at ACC (no snap at a line change, a turn or a wall)
        let dx = pvx + (nx - a.x) * 6 - a.vx, dy = pvy + (ny - a.y) * 6 - a.vy, dz = pvz + (nz - a.z) * 6 - a.vz; const m = Math.hypot(dx, dy, dz), cap = N2.ACC * h; if (m > cap) { dx *= cap / m; dy *= cap / m; dz *= cap / m; }
        a.vx += dx; a.vy += dy; a.vz += dz; let px = a.x + a.vx * h, py = a.y + a.vy * h, pz = a.z + a.vz * h, Tb = top(px, py);
        if (Tb > pz + 0.4 || Tb <= -0.5) { let okb = false; if (Tb > 0 && Tb < pz + 3) { pz = Tb + 0.3; if (a.vz < 0) a.vz = 0; okb = true; }      // a low edge: over it
          else if (wallN(a.x, a.y, a.z, _n)) { const vn = a.vx * _n.x + a.vy * _n.y; if (vn < 0) { a.vx -= vn * _n.x; a.vy -= vn * _n.y; } px = a.x + a.vx * h; py = a.y + a.vy * h; Tb = top(px, py); okb = !(Tb > pz + 0.4 || Tb <= -0.5); ST.scrape = (ST.scrape || 0) + 1; }
          if (!okb) { const ex = nx - a.x, ey = ny - a.y, el = Math.hypot(ex, ey), vv = Math.hypot(a.vx, a.vy); if (el > 0.05) { a.vx = ex / el * vv; a.vy = ey / el * vv; px = a.x + a.vx * h; py = a.y + a.vy * h; Tb = top(px, py); okb = !(Tb > pz + 0.4 || Tb <= -0.5); }      // else toward the authored point (it is in the clear)
            if (!okb) { px = a.x; py = a.y; a.vx = 0; a.vy = 0; } ST.snap = (ST.snap || 0) + 1; } }
        { const ex = px - nx, ey = py - ny, el = Math.hypot(ex, ey); if (el > 4) { const k = (el - 4) / el; a.bx += ex * k; a.by += ey * k; a.qx += ex * k; a.qy += ey * k; } }      // the authored point never runs more than 4 m from him
        { const gz = ground(px, py) + 0.3; if (pz < gz) { pz = gz; if (a.vz < 0) a.vz = 0; } } a.x = px; a.y = py; a.z = pz; }
      if (!a.preT && a.q > a.qe - sp * N2.PRE) { a.preT = true;      // the next line goes out before this one lets go: thrown at the hold the next arc will most likely take
        try { const dir = a.dir, hh = edgeOut(a.x, a.y, Math.cos(dir), Math.sin(dir)) ? null : S.find(a.x + a.vx * N2.PRE, a.y + a.vy * N2.PRE, a.z + a.vz * N2.PRE + N.HAND, dir, sp, 0); if (hh && !hh.fb) S.pre = { x: hh.x, y: hh.y, z: hh.z, t: 0, arm: hh.side > 0 ? 'L' : hh.side < 0 ? 'R' : S.arm === 'L' ? 'R' : 'L' }; } catch (e) { fail('pre2', e); } }
      if (a.q >= a.qe + a.xq || (a.q > a.rq && (a.ax - a.x) * cx + (a.ay - a.y) * cy < -6)) { done = true;      // the end of the arc (or the hold is behind him after a turn): the next line takes over in this same step
        if (cannot() || !fire2(true)) { a = S.a; if (!a) return; if (a.mode === 'swing') { if (++a.ext <= 6) { a.xq = a.q - a.qe + 7; a.rq = a.q + 7; a.rewant = 0; ST.glide = (ST.glide || 0) + 1; } else { fling(a, 10); a.rewant = 0.15; } } } a = S.a; if (!a) return; } }      // round 12: no hold yet = he glides on on this cable and tries again every 7 m (6 times), only then lets go
    { const v1 = Math.hypot(a.vx, a.vy, a.vz), mv = Math.hypot(a.x - g0[0], a.y - g0[1], a.z - g0[2]);      // the hard guard (as the old model's)
      if (!isFinite(a.x + a.y + a.z + v1) || v1 > 90 || mv > 90 * dt + 6) { ST.guard = (ST.guard || 0) + 1; if (ST.guard < 4) console.warn('[swing] guard2: ' + JSON.stringify({ to: [a.x, a.y, a.z, a.vx, a.vy, a.vz], from: g0, q: a.q, qe: a.qe, Lc: a.Lc }).slice(0, 300));
        const v0 = Math.hypot(g0[3], g0[4], g0[5]), k = isFinite(v0) && v0 > N.VMAX ? N.VMAX / v0 : isFinite(v0) ? 1 : 0; a.x = g0[0]; a.y = g0[1]; a.z = g0[2]; a.vx = g0[3] * k || 0; a.vy = g0[4] * k || 0; a.vz = g0[5] * k || 0; a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0.3; a.slack = false; a.taut = false; S.pre = null;
        if (!isFinite(a.x + a.y + a.z)) { end(); return; } } }
    if (S.pre) S.pre.t += dt; if (a.mode === 'swing') a.L = a.Lt = Math.hypot(a.ax - a.x, a.ay - a.y, a.az - a.z - N.HAND);
    ST.fr = (ST.fr || 0) + 1; if (a.z >= 5 && a.z <= 30) ST.inBand = (ST.inBand || 0) + 1; if (a.z - ground(a.x, a.y) < 4.5 && a.t > 1) ST.lowFr = (ST.lowFr || 0) + 1;
    const v = Math.hypot(a.vx, a.vy, a.vz); if (v > ST.vmax) ST.vmax = v; S.v = v;
    pl.x = a.x; pl.y = a.y; pl.alt = Math.max(0.01, a.z); pl.roof = null; pl.speed = 0; if (Math.hypot(a.vx, a.vy) > 2) pl.h = Math.atan2(a.vy, a.vx);
    if (g.cam && typeof g.cam.tz === 'number') g.cam.tz = pl.alt + 1.5; };
  // the v2 camera: the player's own look (the mouse turns it freely; it is never written here), eased a little toward his flight; 5.4 m back, his place followed 0.07 s late and his height 0.35 s late (he rises and falls in
  // the frame), a little roll into turns, fov FOV0 -> FOV1 with speed; ray-tested (buildings, tree crowns) and pulled in, never nearer than CAMIN.
  const cam2 = (d, a, C, cam) => { const vh = Math.hypot(a.vx, a.vy), v = Math.hypot(vh, a.vz), sp = sm((v - 8) / 30), tx0 = pl.x, ty0 = pl.y, tz0 = pl.alt + 1.0, E = (T) => 1 - Math.exp(-d / T);
    // round 13: ONE camera for the whole chain (lines, flings, coasts). Its yaw is his TRAVEL direction (eased 0.22 s) plus a bounded part of the player's look (less while a facade is where he looks): it never stares
    // into a wall he is flying along. Horizon level by default (the look's pitch has a quarter of its effect); roll only while the travel direction turns, 6 deg at most, level again within 0.4 s.
    const hdv = vh > 6 ? Math.atan2(a.vy, a.vx) : a.mode === 'swing' && typeof a.hd === 'number' ? a.hd : C.yaw;
    if (!S.cOn) { S.cOn = true; S.cHd = vh > 6 ? hdv : C.yaw; S.cHr = hdv; S.cW = 0; S.cLk = 0; S.cLK = 0.8; S.cyo = 0; S.ctx = tx0; S.cty = ty0; S.cz = tz0; S.camK = 1; S.cFov = C.fov || 58; S.roll = 0; S.cox = undefined; S.cUp = 0; S.cAy = 0; S.cD = N2.CAMD; }
    S.cW += ((vh > 6 ? clamp(wrapPi(hdv - S.cHr) / d, -3, 3) : 0) - S.cW) * E(0.15); S.cHr = hdv; S.cHd = wrapPi(S.cHd + wrapPi(hdv - S.cHd) * E(0.22));
    { const lc = Math.cos(C.yaw), ls = Math.sin(C.yaw), fac = top(tx0 + lc * 8, ty0 + ls * 8) > tz0 + 3 || top(tx0 + lc * 16, ty0 + ls * 16) > tz0 + 3; S.cLK += ((fac ? 0.2 : 0.8) - S.cLK) * E(0.3); S.cLk += (clamp(wrapPi(C.yaw - S.cHd), -S.cLK, S.cLK) * 0.55 - S.cLk) * E(0.2); }
    const kp = E(0.07); S.ctx += (tx0 + a.vx * 0.07 - S.ctx) * kp; S.cty += (ty0 + a.vy * 0.07 - S.cty) * kp; S.cz += (tz0 - S.cz) * E(0.25);
    { const l = Math.hypot(tx0 - S.ctx, ty0 - S.cty); if (l > 1.5) { S.ctx = tx0 + (S.ctx - tx0) * 1.5 / l; S.cty = ty0 + (S.cty - ty0) * 1.5 / l; } } S.cz = clamp(S.cz, tz0 - 4, tz0 + 4); const czs = tz0 - 1.2 * Math.tanh((tz0 - S.cz) / 1.2);      // he falls and rises in the frame, 1.2 m at most
    S.cFov += (N2.FOV0 + (N2.FOV1 - N2.FOV0) * sp - S.cFov) * E(0.45); const th2 = Math.tan(S.cFov * Math.PI / 360), pitch = clamp(0.06 + (clamp(C.pitch, -0.6, 0.9) - 0.18) * 0.25, -0.12, 0.2);
    // HIS SIZE HELD: the distance is set from his length as the camera sees it (real bones, across the view) so that he is 21 % of the frame's height at any fov and in any pose; 3.3 to 6 m
    { let Lp = 1.25; try { const rig = K.rig && K.rig.ok && K.w > 0.5 ? K.rig : null; if (rig && cam.getWorldDirection) { rig.pos('head', _h1); _h1.y += 0.15; let m = 0; cam.getWorldDirection(_gq2);
          for (const f of ['foot_L', 'foot_R']) { rig.pos(f, _h2); _h2.sub(_h1); const al = _h2.dot(_gq2); m = Math.max(m, Math.sqrt(Math.max(0, _h2.lengthSq() - al * al))); } if (m > 0.3) Lp = m; } } catch (e) { fail('size', e); }
      S.cLp = Lp; S.cD += (clamp(Lp / (2 * 0.21 * th2), 3.3, 6) - S.cD) * E(0.35); }
    const D = S.cD, yaw0 = wrapPi(S.cHd + S.cLk), at = (yw) => { const hd = D * Math.cos(pitch); _c.x = S.ctx - Math.cos(yw) * hd; _c.y = S.cty - Math.sin(yw) * hd; _c.z = czs + 0.5 + D * Math.sin(pitch); },
      bad = (yw) => { at(yw); if (clearTo(tx0, ty0, tz0, _c.x, _c.y, _c.z, 10) < 1) return true; const c = Math.cos(yw), s = Math.sin(yw); return top(_c.x - s * 3, _c.y + c * 3) > _c.z + 0.3 || top(_c.x + s * 3, _c.y - c * 3) > _c.z + 0.3 || top(_c.x - c * 3, _c.y - s * 3) > _c.z + 0.3; };
    // a wall (or a tree crown) within 3 m of the camera or between it and him: the camera swings round him to the open side, eased over 0.3 s; it is pulled in only if no side is open
    { let pick = 0; if (bad(yaw0)) { pick = null; const sg = S.cyo < 0 ? -1 : 1; for (const o of [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25]) if (!bad(yaw0 + o * sg)) { pick = o * sg; break; } if (pick === null) pick = S.cyo; ST.camSw = (ST.camSw || 0) + 1; } S.cyo += (pick - S.cyo) * E(0.12); }
    const yaw = wrapPi(yaw0 + S.cyo), cyw = Math.cos(yaw), syw = Math.sin(yaw); at(yaw); let wx = _c.x, wy = _c.y, wz = _c.z; { const gw = ground(wx, wy); if (wz < gw + 0.7 && gw < tz0 + 1) wz = gw + 0.7; }
    const d0 = Math.hypot(wx - tx0, wy - ty0, wz - tz0) || 1, kc = clearTo(tx0, ty0, tz0, wx, wy, wz, 14); S.camK += (kc - S.camK) * Math.min(1, d * (kc < S.camK ? 6 : 1.4)); const K2 = clamp(S.camK, Math.min(1, N.CAMIN / d0), 1);
    wx = tx0 + (wx - tx0) * K2; wy = ty0 + (wy - ty0) * K2; wz = tz0 + (wz - tz0) * K2;
    { const ox = wx - tx0, oy = wy - ty0, oz = wz - tz0, kf = E(0.09); if (S.cox === undefined) { S.cox = ox; S.coy = oy; S.coz = oz; } else { S.cox += (ox - S.cox) * kf; S.coy += (oy - S.coy) * kf; S.coz += (oz - S.coz) * kf; } wx = tx0 + S.cox; wy = ty0 + S.coy; wz = tz0 + S.coz; }      // no cuts: his place in the view is eased whatever moved the camera
    S.cDist = Math.hypot(wx - tx0, wy - ty0, wz - tz0);
    // THE HOLD SEEN: for a line's first 0.6 s the view tips up (8 deg at most) and a little sideways (6 deg) if the hook would sit outside the frame
    { let up = 0, sd = 0; if (a.mode === 'swing' && a.t < 0.6) { const el = Math.atan2(a.az - wz, Math.hypot(a.ax - wx, a.ay - wy)), vh2 = Math.atan(th2), br = wrapPi(Math.atan2(a.ay - wy, a.ax - wx) - yaw), hh = Math.atan(th2 * (cam.aspect || 16 / 9));
        up = clamp(el - (vh2 - 0.1) - 0.05, 0, 0.14); sd = Math.sign(br) * clamp(Math.abs(br) - (hh - 0.14), 0, 0.1); } S.cUp += (up - S.cUp) * E(up > S.cUp ? 0.12 : 0.4); S.cAy += (sd - S.cAy) * E(Math.abs(sd) > Math.abs(S.cAy) ? 0.12 : 0.4); }
    const ly = yaw + S.cAy, lz = czs + 1.6 + S.cUp * 14 - (pitch - 0.06) * 10; cam.position.set(wx, wz, -wy); cam.up.set(0, 1, 0); cam.lookAt(tx0 + Math.cos(ly) * 10, lz, -(ty0 + Math.sin(ly) * 10));
    const rt = Math.abs(S.cW) > 0.15 ? clamp(-S.cW * 0.09, -0.105, 0.105) : 0; S.roll += (rt - S.roll) * E(0.13); if (Math.abs(S.roll) > 0.002) cam.rotateZ(S.roll);
    S.cF0 = C.fov; S.cPit = C.pitch; C.tx = pl.x; C.ty = pl.y; C.tz = pl.alt + 1.5; };
  const fly = (dt) => { let a = S.a; if (V2 && a.mode === 'swing') return fly2(dt); a.t += dt; if (a.kickT > 0) a.kickT -= dt; if (a.flash > 0) a.flash -= dt;
    if (a.mode === 'swing' && !S.held && !a.auto) { a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0; ST.releases++; if (a.vz < 4 && a.z - Math.max(ground(a.x, a.y), a.gA) < 4) a.vz = 4; }      // let go low: the line flicks him up enough to reach the next shot
    // X HELD = the rhythm kept for him: past the bottom, on the way up, REL of the rope's length beyond the pivot, the line lets go and he flies; Shift held = he rides it to the top instead
    const autoRel = () => { if (a.mode === 'swing' && a.taut && !a.slack && a.vz > 0 && !S.run && a.L <= a.Lt + 0.01) { const dxp = (a.x - a.px) * Math.cos(a.dir) + (a.y - a.py) * Math.sin(a.dir);
      if (dxp > a.L * (a.auto ? 0.12 : N.REL) || (dxp > 0 && a.z + a.vz * a.vz / (2 * N.G) > 27) || (dxp > 2 && Math.hypot(a.vx, a.vy, a.vz) < 9) || (dxp > 0 && a.vz > Math.sqrt(2 * N.G * Math.max(0.5, a.az - 6.7 - a.z))))      /* the last: low buildings, he lets go earlier and flatter so the flight tops out under the next hold, not over the roofs */ { ST.autoRel++; S.relA = Math.round(Math.atan2(a.vz, Math.hypot(a.vx, a.vy)) * 57.3); a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0; a.auto = false; } } }; autoRel();
    if (a.mode === 'swing' && a.t > 0.6 && a.vz <= 1 && a.vx * Math.cos(a.dir) + a.vy * Math.sin(a.dir) < 3) { ST.tops++; a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0.001; }      // held past the top of the arc: it lets go by itself and takes the next hold ahead, so X held never swings him back
    if (a.mode === 'swing' && a.t > a.out + 0.15) { if (lineClear(a.x, a.y, a.z + N.HAND, a.ax, a.ay, a.az, 1.6)) a.blockT = 0; else a.blockT += dt;
      if (a.blockT > 0.1) { ST.wraps++; a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0.001; } }      // the line would lie across a corner: it lets go, and X still held takes the next hold at once
    if (a.mode === 'coast') { if (a.z > a.peak) a.peak = a.z; if (S.space) return toFree(true);
      const gz = ground(a.x, a.y), hurt = a.vz < -13 && a.peak - gz > N.FALL && a.z - gz < 18; let go = false;
      if (S.held) { if (a.rewant > 0) go = (a.rewant -= dt) <= 0; else go = a.t >= N.FLYMIN && (a.vz < 3 || a.t > N.FLYMAX); } else { a.rewant = 0; go = hurt; }      // held: the next line goes at the top of the flight. Not held: a line of its own only if he would land hard
      if (go && !cannot()) { S.any = hurt; const ok = fire(true); S.any = false; a = S.a; if (!a) return; if (a.mode === 'coast') a.rewant = 0.12; if (ok && !S.held) { a.auto = true; ST.saves++; } }
      if (a.mode === 'coast' && hurt && (!S.held || a.z - ground(a.x + a.vx * 0.2, a.y + a.vy * 0.2) < 2.5)) return toFree(!S.held); }      // nothing caught him: the parachute (X up) or grfree's own landing
    if (edgeOut(a.x, a.y, a.vx, a.vy)) { ST.edgeDrops = (ST.edgeDrops || 0) + 1; const vh = Math.hypot(a.vx, a.vy), k = vh > 12 ? 12 / vh : 1; a.vx *= k; a.vy *= k; return toFree(a.z - ground(a.x, a.y) > 5); }      // the map's edge: the line lets go; high = the parachute, low = grfree's landing
    // round 10 (LOOK only; the flight is round 7's): while he still rises the NEXT line is thrown at the hold round 7's rule will most likely take at the top (searched from where he will be then); it is drawn slack, paying out, until round 7's own moment attaches it
    if (a.mode !== 'coast' || !S.held) { S.pre = null; S.preN = 0; }
    else if (N.PRE && !S.pre && !(a.flash > 0) && (S.preN || 0) < 4 && a.t >= N.PRET + (S.preN || 0) * 0.1) { S.preN = (S.preN || 0) + 1;
      try { const tau = clamp(Math.max(N.FLYMIN - a.t, (a.vz - 3) / N.G), 0, Math.max(0, N.FLYMAX - a.t)), xp = a.x + a.vx * tau, yp = a.y + a.vy * tau, zp = a.z + a.vz * tau - 0.5 * N.G * tau * tau, base = typeof S.axis === 'number' ? S.axis : a.dir, sr = street(xp, yp, base), dir = sr && sr.d < 0.95 ? sr.ang : base;
        const h = edgeOut(xp, yp, Math.cos(dir), Math.sin(dir)) ? null : S.find(xp, yp, zp + N.HAND, dir, Math.hypot(a.vx, a.vy), a.vz - N.G * tau);
        if (h && !h.fb && lineClear(a.x, a.y, a.z + N.HAND, h.x, h.y, h.z, 1.6)) S.pre = { x: h.x, y: h.y, z: h.z, t: 0, arm: h.side > 0 ? 'L' : h.side < 0 ? 'R' : S.arm === 'L' ? 'R' : 'L' }; } catch (e) { fail('pre', e); } }
    if (S.pre) S.pre.t += dt;
    scout(a); const g0 = [a.x, a.y, a.z, a.vx, a.vy, a.vz];
    const n = Math.min(24, Math.max(1, Math.ceil(dt / N.SUB))), h = dt / n; for (let i = 0; i < n; i++) { if (i) autoRel(); if (!sub(a, h)) return; }      /* the let-go is tested every 1/120 s, not once a frame: at 20 fps a frame is 6 sub-steps */
    ST.fr = (ST.fr || 0) + 1; if (a.z >= 5 && a.z <= 30) ST.inBand = (ST.inBand || 0) + 1;
    { const v1 = Math.hypot(a.vx, a.vy, a.vz), mv = Math.hypot(a.x - g0[0], a.y - g0[1], a.z - g0[2]);      // the hard guard: a non-finite or runaway state never leaves this frame
      if (!isFinite(a.x + a.y + a.z + v1) || v1 > 80 || mv > 80 * dt + 6) { ST.guard = (ST.guard || 0) + 1; if (ST.guard < 4) console.warn('[swing] guard: ' + JSON.stringify({ to: [a.x, a.y, a.z, a.vx, a.vy, a.vz], from: g0, mode: a.mode, L: a.L, Lt: a.Lt, p: [a.px, a.py, a.pz] }).slice(0, 400));
        const v0 = Math.hypot(g0[3], g0[4], g0[5]), k = isFinite(v0) && v0 > N.VMAX ? N.VMAX / v0 : isFinite(v0) ? 1 : 0; a.x = g0[0]; a.y = g0[1]; a.z = g0[2]; a.vx = g0[3] * k || 0; a.vy = g0[4] * k || 0; a.vz = g0[5] * k || 0; a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0.3; a.slack = false; a.taut = false;
        if (!isFinite(a.x + a.y + a.z)) { end(); return; } } }
    if (a.mode === 'swing' && !a.slack && a.t > a.out && Math.hypot(a.x - a.px, a.y - a.py, a.z + N.HAND - a.pz) > a.L + 3) { ST.pinned = (ST.pinned || 0) + 1; a.mode = 'coast'; a.t = 0; a.peak = a.z; a.rewant = 0.25; }      // a wall or the map's edge holds him off the rope's arc (the rope would drag him THROUGH it, then snap him across in one frame): the line lets go
    { const co = a.mode === 'coast', on = !co || a.flash > 0 || !!S.pre; if (co) { ST.tAir = (ST.tAir || 0) + dt; if (on) ST.tLine = (ST.tLine || 0) + dt; }      /* the measure: tAir = s between lines, tLine = of those with a line drawn, fly / flyN = cable-less s / count, sweep = the median cable-less time in ms (the old line's 0.28 s whip-away is not counted as a line) */
      if (!on) S.gapT = (S.gapT || 0) + dt; else if (S.gapT > 0) { const A = S.gaps || (S.gaps = []); A.push(S.gapT); if (A.length > 300) A.shift(); ST.fly = (ST.fly || 0) + S.gapT; ST.flyN = (ST.flyN || 0) + 1; S.gapT = 0; ST.sweep = Math.round(A.slice().sort((p, q) => p - q)[A.length >> 1] * 1000); } }
    const v = Math.hypot(a.vx, a.vy, a.vz); if (v > ST.vmax) ST.vmax = v; S.v = v;
    pl.x = a.x; pl.y = a.y; pl.alt = Math.max(0.01, a.z); pl.roof = null; pl.speed = 0; if (Math.hypot(a.vx, a.vy) > 2) pl.h = Math.atan2(a.vy, a.vx);
    if (g.cam && typeof g.cam.tz === 'number') g.cam.tz = pl.alt + 1.5; };

  // ---------------------------------------------------------------- wrapped from outside
  const pad = () => { try { const L = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null; if (L) for (const p of L) if (p && p.buttons[12] && p.buttons[12].pressed) return true; } catch (e) { /* no pad */ } return false; };
  const read0 = g.readInput.bind(g); g.readInput = function () { read0(); const I = g.input; if (!I) return; if (S.a) { S.mx = I.mx; S.my = I.my; S.run = !!I.run; I.mx = 0; I.my = 0; I.use = false; I.run = false; I.handbrake = false; } else { S.mx = 0; S.my = 0; S.run = false; } };
  const step0 = g.step.bind(g);
  g.step = function (dt) { const d = dt > 0 ? Math.min(dt, 0.1) : 0;
    step0(dt);
    try { S.held = !!(g.keys && g.keys.has('KeyX')) || S.mouse || pad(); const edge = S.held && !S.heldWas; S.heldWas = S.held;
      if (S.a && (pl.vehicle || pl.busy || dead() || Math.hypot(pl.x - S.a.x, pl.y - S.a.y) > 8)) { end(); ST.dropped++; if (!pl.vehicle && !pl.roof) pl.alt = 0; }
      if (S.on && edge && !cannot()) fire(false);
      if (S.on && S.held && !S.a && pl.roof && !(F() && F().a) && !cannot()) { S.roofT = (S.roofT || 0) + d; if (S.roofT > 0.3) { S.roofT = -0.6; fire(true); } } else if (!(S.roofT < 0)) S.roofT = 0; else S.roofT += d;      // X still held on a roof: he does not stand there, the line takes him back out toward the street
      if (S.a) fly(d);
      S.space = false;
    } catch (e) { fail('step', e); if (S.a) { try { toFree(false); } catch (e2) { S.a = null; } } }
  };
  if (typeof addEventListener === 'function') {
    addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && S.a) S.space = true; });
    addEventListener('mousedown', (e) => { if (e.button === 3) { S.mouse = true; e.preventDefault(); } });
    addEventListener('mouseup', (e) => { if (e.button === 3) { S.mouse = false; e.preventDefault(); } });
    addEventListener('blur', () => { S.mouse = false; });
  }
  if (typeof g.nearestCar === 'function') { const near0 = g.nearestCar.bind(g); g.nearestCar = function (...a) { return S.a ? null : near0(...a); }; }

  // ---------------------------------------------------------------- the camera: ONE chase camera for the whole chain. Behind him along his velocity (smoothed over 0.5 s), 6-8 m back, a little above his
  // shoulders when slow at the top and lower when fast at the bottom, him in the lower middle of the frame; ray-tested against buildings and tree crowns and pulled in; the mouse adds a bounded look that eases back.
  const TG = { map: null, t: 0 }; const treeGrid = () => { if (TG.map) return TG.map; const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; if (TG.n > 40 || (TG.t && Math.abs(now - TG.t) < 2)) return null; TG.t = now || 1e-3; TG.n = (TG.n || 0) + 1;
    const P = g.streets && (g.streets.parts || g.streets), T = P && P.trees, L = T && T.trees; if (!L || !L.length) return null; const M = new Map();
    for (const t of L) { const m = t && t.m; if (!m) continue; const r = clamp((t.rad || 4) * 0.9, 1.5, 9), x = m[12], y = -m[14], z0 = m[13] + 2.2, z1 = m[13] + 3 + r * 2.4, e = [x, y, z0, z1, r];
      for (let cx = Math.floor((x - r) / 12); cx <= Math.floor((x + r) / 12); cx++) for (let cy = Math.floor((y - r) / 12); cy <= Math.floor((y + r) / 12); cy++) { const k = cx * 8192 + cy; let c = M.get(k); if (!c) M.set(k, (c = [])); c.push(e); } }
    S.treeN = L.length; return (TG.map = M); };
  const inTree = (x, y, z) => { const M = treeGrid(); if (!M) return false; const c = M.get(Math.floor(x / 12) * 8192 + Math.floor(y / 12)); if (!c) return false; for (const e of c) if (z > e[2] && z < e[3] && Math.hypot(x - e[0], y - e[1]) < e[4]) return true; return false; };
  const blocked = (x, y, z) => top(x, y) > z - 0.45 || inTree(x, y, z);
  const treeTop = (x, y) => { const M = treeGrid(); if (!M) return 0; const c = M.get(Math.floor(x / 12) * 8192 + Math.floor(y / 12)); if (!c) return 0; let m = 0; for (const e of c) if (e[3] > m && Math.hypot(x - e[0], y - e[1]) < e[4] + 1.2) m = e[3]; return m; };      // round 13: the top of a tree crown over (x, y), 0 = none
  const treeAlong = (x, y, ux, uy, D) => { let m = 0; for (let q = 0; q <= D; q += 3) { const t = treeTop(x + ux * q, y + uy * q); if (t > m) m = t; } return m; };
  // how far out from (tx, ty, tz) toward (wx, wy, wz) the way is clear, 0..1 (three rays: the line and half a metre to each side)
  const clearTo = (tx, ty, tz, wx, wy, wz, n) => { const dx = wx - tx, dy = wy - ty, hl = Math.hypot(dx, dy) || 1, sx = -dy / hl * 0.5, sy = dx / hl * 0.5;
    for (let i = 1; i <= n; i++) { const u = i / n, x = tx + dx * u, y = ty + dy * u, z = tz + (wz - tz) * u; if (blocked(x, y, z) || blocked(x + sx * u, y + sy * u, z) || blocked(x - sx * u, y - sy * u, z)) return Math.max(0, (i - 1.4) / n); } return 1; };
  const _c = { x: 0, y: 0, z: 0 }, _gq2 = new THREE.Vector3(), _gp = new THREE.Vector3(), _gq = new THREE.Quaternion(), _op = new THREE.Vector3(), _oq = new THREE.Quaternion(), _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3();
  if (typeof g.updateCamera === 'function') { const cam0 = g.updateCamera.bind(g);
    g.updateCamera = function (dt) { cam0(dt); const d = dt > 0 ? Math.min(dt, 0.1) : 0.016, a = S.a, C = g.cam, cam = g.world && g.world.camera;
      S.camW = clamp(S.camW + (a ? d * 2.5 : -d * 2), 0, 1); if (!(S.camW > 0) || !C || !cam || !cam.position || !cam.quaternion || !cam.lookAt || pl.vehicle || (g.heli && g.heli.hasCamera)) { S.roll = 0; S.cOn = false; return; }
      try { const w = S.camW * S.camW * (3 - 2 * S.camW); _gp.copy(cam.position); _gq.copy(cam.quaternion);
        if (a && V2) { cam2(d, a, C, cam); _op.copy(cam.position); _oq.copy(cam.quaternion); }
        else if (a) { const vh = Math.hypot(a.vx, a.vy), v = Math.hypot(vh, a.vz), sp = clamp(v / 40, 0, 1), k = 1 - Math.exp(-d / 0.5);
          if (!S.cOn) { S.cOn = true; S.cy = C.yaw; S.oy = 0; S.yawSet = C.yaw; S.cvz = 0; S.camK = 1; S.cSide = 0; S.camH = 0.9; S.cD = 4.2; S.cLift = 0; S.cz = pl.alt; S.cox = undefined; S.lookA = 0; }
          S.oy = clamp(S.oy + wrapPi(C.yaw - S.yawSet), -1.15, 1.15); if (C.lookT > 0.7) { S.oy *= Math.exp(-d * 2.2); C.pitch += (0.18 - C.pitch) * Math.min(1, d * 1.5); }      // the mouse: a bounded look, eased back
          if (vh > 4) S.cy = wrapPi(S.cy + wrapPi((typeof S.axis === 'number' ? S.axis + clamp(wrapPi(Math.atan2(a.vy, a.vx) - S.axis), -0.5, 0.5) * 0.5 : Math.atan2(a.vy, a.vx)) - S.cy) * k * clamp((vh - 4) / 6, 0, 1));
          S.cvz += (clamp(a.vz / Math.max(v, 10), -1, 1) - S.cvz) * k; S.camH += (1.2 - sp * 0.9 - S.camH) * k; S.cD += (N.CAMD + sp * 0.5 - S.cD) * k;
          const yaw = wrapPi(S.cy + S.oy); C.yaw = yaw; S.yawSet = yaw; C.tx = pl.x; C.ty = pl.y; C.tz = pl.alt + 1.5;
          const cyw = Math.cos(yaw), syw = Math.sin(yaw), pitch = clamp(0.1 + (clamp(C.pitch, -0.6, 0.9) - 0.18) * 0.5 - S.cvz * 0.3, -0.4, 0.26);      /* never top-down: at most 15 deg above him, 23 below (on the way up, so the sky and the hold show) */
          const sd = a.mode === 'swing' ? Math.sign((a.ax - a.x) * -syw + (a.ay - a.y) * cyw) : 0; S.cSide += (sd - S.cSide) * Math.min(1, d * 1.2);      // a little to the far side, so the hold's side of the street shows
          const tx = pl.x, ty = pl.y, tz = pl.alt + 1.2, so = -S.cSide * 1.6; S.cz += (pl.alt - S.cz) * (1 - Math.exp(-d / 0.6)); const lagZ = clamp((S.cz - pl.alt) * 0.6, -1.5, 1.5);      /* round 7: the camera's height follows his 0.6 s late and by part, so he rises and falls in the frame; it sits a little to the side away from the hold, so the line crosses the frame */
          // where the camera would sit with `lift` more pitch -> how much of the way out to it is clear (0..1)
          const at = (lift) => { const p = Math.min(0.3, pitch + lift), hd = S.cD * Math.cos(p); _c.x = tx - cyw * hd - syw * so; _c.y = ty - syw * hd + cyw * so; _c.z = tz + S.camH + S.cD * Math.sin(p) + lagZ; const gw = ground(_c.x, _c.y); if (_c.z < gw + 0.7 && gw < tz + 1) _c.z = gw + 0.7; return clearTo(tx, ty, tz, _c.x, _c.y, _c.z, 16); };
          let lw = 0; for (const L of [0, 0.1, 0.2]) if (at(L) >= 0.95) { lw = L; break; }      // a tree crown or a wall between: the camera rises over it first (quick up, slow down) ...
          S.cLift += (lw - S.cLift) * Math.min(1, d * (lw > S.cLift ? 7 : 1.5)); const kc = at(S.cLift); let wx = _c.x, wy = _c.y, wz = _c.z; const d0 = Math.hypot(wx - tx, wy - ty, wz - tz) || 1;
          S.camK += (kc - S.camK) * Math.min(1, d * (kc < S.camK ? 10 : 1.6)); const K2 = clamp(S.camK, Math.min(1, N.CAMIN / d0), 1);      // ... and only then comes in: eased over 0.3 s, and never nearer than CAMIN (no frame filled by his back)
          wx = tx + (wx - tx) * K2; wy = ty + (wy - ty) * K2; wz = tz + (wz - tz) * K2; const dn = d0 * K2, fv = 60 + sp * 6; S.cDist = dn; { const ox = wx - tx, oy = wy - ty, oz = wz - tz, kf = 1 - Math.exp(-d / 0.14); if (S.cox === undefined) { S.cox = ox; S.coy = oy; S.coz = oz; } else { S.cox += (ox - S.cox) * kf; S.coy += (oy - S.coy) * kf; S.coz += (oz - S.coz) * kf; } wx = tx + S.cox; wy = ty + S.coy; wz = tz + S.coz; }      /* no cuts: the camera's place relative to him is eased over 0.14 s whatever moved it (a wall pull-in, the lift, the ground guard) */ if (S.dbgSide) { wx = tx + syw * 7; wy = ty - cyw * 7; wz = tz + 0.4; }
          cam.position.set(wx, wz, -wy); cam.up.set(0, 1, 0); { const env = a.mode === 'swing' ? clamp(a.t / 0.2, 0, 1) * clamp((1.0 - a.t) / 0.4, 0, 1) : 0, la = env ? clamp(wrapPi(Math.atan2(a.ay - a.y, a.ax - a.x) - yaw), -1, 1) * 0.25 * env : 0; S.lookA += (la - S.lookA) * Math.min(1, d * 6); S.lookU = (S.lookU || 0) + (env * 1.6 - (S.lookU || 0)) * Math.min(1, d * 6); const ly = yaw + S.lookA, lz = pl.alt + 1.5 + S.cvz * 1.5 + lagZ * 0.5 + S.lookU; if (S.dbgSide) cam.lookAt(tx, tz, -ty); else cam.lookAt(tx + Math.cos(ly) * 7, lz, -(ty + Math.sin(ly) * 7));      /* as a line goes out the view glances up and toward the hold, then comes back */ const vp = Math.round(Math.atan2(lz - wz, Math.hypot(tx + cyw * 7 - wx, ty + syw * 7 - wy)) * 57.3); if (!(vp >= ST.pitchMin)) ST.pitchMin = vp; if (!(vp <= ST.pitchMax)) ST.pitchMax = vp; }      /* looks past him down the street: the horizon stays in frame */
          let rt = 0; if (a.mode === 'swing' && a.taut) rt = clamp(((a.ax - a.x) * syw - (a.ay - a.y) * cyw) / Math.max(4, a.L), -1, 1) * 0.1;
          S.roll += (rt - S.roll) * Math.min(1, d * 3); if (Math.abs(S.roll) > 0.002) cam.rotateZ(-S.roll);
          _op.copy(cam.position); _oq.copy(cam.quaternion); S.cFov = fv; S.cF0 = C.fov; }
        else { S.cOn = false; if (_op.lengthSq() === 0) return; _op.x += (_gp.x - _op.x) * Math.min(1, d * 6); _op.z += (_gp.z - _op.z) * Math.min(1, d * 6); _op.y += (_gp.y - _op.y) * Math.min(1, d * 6); }      // the chain is over: ease to the game's own camera
        if (w < 0.999) { cam.position.copy(_gp).lerp(_op, w); cam.quaternion.copy(_gq).slerp(_oq, w); } else { cam.position.copy(_op); cam.quaternion.copy(_oq); }
        const fv = C.fov + ((S.cFov || 58) - C.fov) * w; if (Math.abs(cam.fov - fv) > 0.01) { cam.fov = fv; cam.updateProjectionMatrix(); }
      } catch (e) { fail('camera', e); } }; }
  // for the checks: is he whole in the frame (head and feet), is the way from the camera to his chest clear, how tall he is in the frame (share of its height)
  S.seen = () => { const cam = g.world && g.world.camera; if (!cam || !cam.position) return null; const z = pl.alt || 0, rig = K.rig && K.rig.ok && K.w > 0.5 ? K.rig : null, asp = cam.aspect || 16 / 9; let tall = 0, inF = true, cy = 0;
    if (rig) rig.pos('head', _h1); else _h1.set(pl.x, z + 1.65, -pl.y); _h1.y += 0.15; _h1.project(cam); if (!(Math.abs(_h1.x) < 1 && Math.abs(_h1.y) < 1 && _h1.z < 1)) inF = false;
    for (const f of ['foot_L', 'foot_R']) { if (rig) rig.pos(f, _h2); else _h2.set(pl.x, z, -pl.y); _h2.project(cam); if (!(Math.abs(_h2.x) < 1 && Math.abs(_h2.y) < 1 && _h2.z < 1)) inF = false; tall = Math.max(tall, Math.hypot((_h1.y - _h2.y) / 2, (_h1.x - _h2.x) / 2 * asp)); cy = (_h1.y + _h2.y) / 4 + 0.5; }      // tall = his length on the screen, head to the farther foot (real bones), in frame heights
    const p = cam.position; let tilt = -1, tuck = -1; if (rig) { rig.pos('hips', _h2); rig.pos('head', _h1); _h1.sub(_h2); tilt = Math.round(Math.acos(clamp(_h1.y / (_h1.length() || 1), -1, 1)) * 57.3); rig.pos('thigh_L', _h1); rig.pos('foot_L', _h2); tuck = +(_h1.distanceTo(_h2) / (rig.thigh + rig.shin)).toFixed(2); }
    return { tilt, tuck, want: Math.round(Math.acos(clamp(K.lean.y, -1, 1)) * 57.3), inF, clear: clearTo(pl.x, pl.y, z + 1.2, p.x, -p.z, p.y, 16) >= 0.9, tall, cy, bones: !!rig }; };

  // ---------------------------------------------------------------- the line (taut, or sagging when slack) and the body hanging from one arm
  const SEG = 1, V3 = () => new THREE.Vector3(), _a = V3(), _b = V3(), _p = V3(), _q = V3(), _d = V3(), _t = V3(), _pp = V3(), _pole = V3(), _fw = V3(), _rt = V3(), _ax = V3(), _ub = V3(), _fb = V3(), UP = new THREE.Vector3(0, 1, 0), DN = new THREE.Vector3(0, -1, 0), _qq = new THREE.Quaternion();
  const K = (S.lk = { rollT: 0, relT: 0, tip: V3(), segs: null, hook: null, Rig: null, rig: null, rigVis: null, saved: null, w: 0, lean: V3().set(0, 1, 0), clock: 0 });
  const TOUCH = ['hips', 'spine', 'chest', 'chest2', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  if (typeof document !== 'undefined') import('../entry/rig.js').then((m) => { K.Rig = m.EntryRig; }).catch((e) => fail('rig', e));
  const unpose = () => { const s = K.saved; if (!s || !s.live || !K.rig) return; const B = K.rig.B; for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) b.quaternion.copy(s[i]); } s.live = false; };
  const hand = (v) => v.set(pl.x - Math.sin(pl.h) * 0.2, (pl.alt || 0) + N.HAND, -(pl.y + Math.cos(pl.h) * 0.2));
  // the line: ONE thin straight cable from his hand to a small bright hook that stays where it struck; let go, it whips back to his hand in a sixth of a second (never drawn slack along a wall)
  // round 10: the line is a 12-piece ribbon (pale edges, dark core) that sags while slack; the NEXT line flies out at S.pre during the rise; the line let go whips away from his hand toward its hook for 0.28 s; a small dark hook with a glint
  const NS = 12, _w = V3(), _e = V3(), _hd = V3(); K.oTip = V3(); K.oFrom = V3(); K.hnd = V3(); K.sag = 0; K.old = 0;
  const ribbon = (name) => { const geo = new THREE.BufferGeometry(), nv = (NS + 1) * 4; geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); const col = new Float32Array(nv * 3), ix = [];
    for (let i = 0; i <= NS; i++) { col.set([0.8, 0.83, 0.87, 0.8, 0.83, 0.87, 0.05, 0.06, 0.08, 0.05, 0.06, 0.08], i * 12); if (i < NS) { const p = i * 4; ix.push(p, p + 1, p + 4, p + 4, p + 1, p + 5, p + 2, p + 3, p + 6, p + 6, p + 3, p + 7); } }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(ix); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.frustumCulled = false; m.name = name; m.visible = false; return m; };
  const lay = (m, A, B, sag, wave, phs) => { const cam = g.world.camera, P = m.geometry.attributes.position, fh = 2 * Math.tan(((cam && cam.fov) || 60) * Math.PI / 360); _d.subVectors(B, A); const L = Math.max(0.01, _d.length()); _d.multiplyScalar(1 / L); _w.crossVectors(_d, UP); if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0); _w.normalize();
    for (let i = 0; i <= NS; i++) { const u = i / NS, k = i * 4; _e.lerpVectors(A, B, u); _e.y -= sag * 4 * u * (1 - u); if (wave) _e.addScaledVector(_w, wave * Math.sin(u * 9 + phs) * (1 - u));
      _p.copy(cam && cam.position ? cam.position : A).sub(_e); const dist = _p.length() || 1, wd = Math.max(0.03, N.LINEPX * fh * dist); _q.crossVectors(_d, _p); if (_q.lengthSq() < 1e-8) _q.set(1, 0, 0); _q.normalize(); _p.multiplyScalar(0.02 / dist);
      P.setXYZ(k, _e.x + _q.x * wd * 0.5, _e.y + _q.y * wd * 0.5, _e.z + _q.z * wd * 0.5); P.setXYZ(k + 1, _e.x - _q.x * wd * 0.5, _e.y - _q.y * wd * 0.5, _e.z - _q.z * wd * 0.5);
      P.setXYZ(k + 2, _e.x + _q.x * wd * 0.3 + _p.x, _e.y + _q.y * wd * 0.3 + _p.y, _e.z + _q.z * wd * 0.3 + _p.z); P.setXYZ(k + 3, _e.x - _q.x * wd * 0.3 + _p.x, _e.y - _q.y * wd * 0.3 + _p.y, _e.z - _q.z * wd * 0.3 + _p.z); }
    P.needsUpdate = true; m.visible = true; return fh; };
  const drawLine = (dt) => { const sc = g.world && g.world.scene, a = S.a; if (!sc || !sc.add) return; const sw = !!(a && (a.mode === 'swing' || a.flash > 0)), pre = !sw && a && S.pre ? S.pre : null, on = sw || !!pre;
    if (!K.segs) { if (!on) return; K.segs = [ribbon('swing-line'), ribbon('swing-line-old')]; sc.add(K.segs[0]); sc.add(K.segs[1]);
      K.hook = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: V2 ? 0xffe9a8 : 0x1b1d22 })); K.hook.frustumCulled = false; K.hook.name = 'swing-hook'; sc.add(K.hook);
      K.glint = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: 0xffffff })); K.glint.frustumCulled = false; K.glint.visible = false; sc.add(K.glint);
      K.puff = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf1ece0, transparent: true, opacity: 0.8, depthWrite: false })); K.puff.frustumCulled = false; K.puff.visible = false; sc.add(K.puff); }
    const m = K.segs[0], o = K.segs[1], cam = g.world.camera;
    if (K.rig && K.rig.ok && K.w > 0.5) K.rig.pos('hand_' + ((pre ? pre.arm : S.arm) === 'R' ? 'R' : 'L'), _a); else hand(_a);
    const key = sw ? a.ax * 7 + a.az : 0; if (K.cur && K.cur !== key) { K.old = 0.28; K.oTip.copy(K.tip); K.oFrom.copy(K.hnd); } K.cur = key;      // the line let go: it does not vanish
    if (K.old > 0) { K.old -= dt; const e = 1 - clamp(K.old / 0.28, 0, 1); _hd.lerpVectors(K.oFrom, K.oTip, e * e * 0.85); _hd.y += 1.2 * e; if (K.old > 0) lay(o, _hd, K.oTip, 0, 0.3 + 0.9 * (1 - e), K.clock * 30); else o.visible = false; } else o.visible = false;
    if (!on) { m.visible = false; K.hook.visible = false; K.glint.visible = false; K.puff.visible = false; K.sag = 0; K.wasPre = false; return; }
    let sag = 0, struck = false;
    if (pre) { const e = clamp(pre.t / 0.25, 0, 1); _b.set(pre.x, pre.z, -pre.y); const Lp = _b.distanceTo(_a); _b.lerpVectors(_a, _b, e); K.tip.copy(_b); K.wasPre = true; sag = K.sag = Lp * e * 0.07; struck = e >= 1; }      // thrown early: flying out, then hooked but slack
    else { _b.set(a.ax, a.az, -a.ay); if (K.wasPre) { K.tip.lerp(_b, Math.min(1, dt * 16)); if (K.tip.distanceTo(_b) < 0.3) K.wasPre = false; _b.copy(K.tip); struck = true; } else { if (a.t < a.out) _b.lerpVectors(_a, _b, clamp(a.t / a.out, 0, 1)); K.tip.copy(_b); struck = !(a.t < a.out); }
      const want = a.mode === 'swing' && (a.slack || !a.taut) && a.t < 1.2 ? 0.05 * _b.distanceTo(_a) : 0; K.sag += (want - K.sag) * Math.min(1, dt * (want < K.sag ? 14 : 8)); sag = K.sag; K.hnd.copy(_a); }      // drawn into line as it comes taut
    const fh = lay(m, _a, _b, sag, 0, 0), dist = cam && cam.position ? cam.position.distanceTo(_b) : 10, hs = Math.max(0.7, 0.011 * fh * dist / 0.4);
    K.hook.visible = true; K.hook.position.copy(_b); _d.subVectors(_b, _a).normalize(); K.hook.quaternion.setFromUnitVectors(UP, _d); if (V2) { const h2 = Math.max(hs, 1.8); K.hook.scale.set(h2 * 0.7, h2 * 1.2, h2 * 0.7); } else K.hook.scale.set(hs * 0.7, hs * 1.6, hs * 0.7);
    K.glint.visible = struck && !!(cam && cam.position); if (K.glint.visible) { _p.copy(cam.position).sub(_b).normalize(); K.glint.position.copy(_b).addScaledVector(_p, 0.25 * hs).addScaledVector(UP, 0.12 * hs); K.glint.scale.setScalar(hs * (0.8 + 0.5 * Math.sin(K.clock * 9))); }
    const pu = V2 && sw && a.mode === 'swing' ? a.t / 0.3 : sw && a.mode === 'swing' && !K.wasPre ? (a.t - a.out) / 0.22 : -1; K.puff.visible = pu >= 0 && pu < 1; if (K.puff.visible) { K.puff.position.set(a.ax, a.az, -a.ay); K.puff.scale.setScalar(V2 ? 1 + pu * 3 : 0.5 + pu * 1.1); K.puff.material.opacity = (V2 ? 0.9 : 0.5) * (1 - pu); }
    if (sw && a.mode === 'swing' && a.t >= a.out && K.mk !== a.ax * 7 + a.az) { K.mk = a.ax * 7 + a.az; const M = K.marks || (K.marks = []); let q = M.length < 4 ? null : M.shift(); if (!q) { q = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 4), new THREE.MeshBasicMaterial({ color: 0x23252a })); q.name = 'swing-mark'; sc.add(q); } q.position.set(a.ax, a.az, -a.ay); M.push(q); } };
  // the body. On the line: hanging at full stretch from the line arm, angled along the rope, legs trailing on the way down, swinging through at the bottom, knees coming up toward the top.
  // Between lines: a forward dive, knees tucked, both arms reaching. A fast landing: one forward roll.
  const pose = (dt) => { const a = S.a, vis = pl.vis, o = vis && vis.object; K.clock += dt; const rolling = !a && K.rollT > 0 && !pl.vehicle && !pl.busy; if (K.rollT > 0) K.rollT -= dt;
    K.w = clamp(K.w + (a || rolling ? dt * 9 : -dt * 6), 0, 1);
    if (!(K.w > 0.01) || !K.Rig || !vis || !o || !vis.mixer || pl.vehicle || pl.busy) return;
    if (K.rigVis !== vis) { K.rigVis = vis; K.saved = null; try { K.rig = new K.Rig(vis, vis.name || 'player'); } catch (e) { K.rig = null; fail('rig', e); } }
    const rig = K.rig; if (!rig || !rig.ok) return; const B = rig.B, w = K.w * K.w * (3 - 2 * K.w);
    const rp = rolling ? clamp(1 - K.rollT / 0.55, 0, 1) : 0; if (rolling && o.position) o.position.y -= 0.5 * Math.sin(Math.PI * rp);
    o.updateMatrixWorld(true);
    { const s = K.saved || (K.saved = TOUCH.map(() => new THREE.Quaternion())); for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) s[i].copy(b.quaternion); } s.live = true; }
    _fw.set(Math.cos(pl.h), 0, -Math.sin(pl.h)); _rt.set(Math.sin(pl.h), 0, Math.cos(pl.h));
    const sw0 = a && a.mode === 'swing' && a.t >= a.out; K.tw = clamp((K.tw || 0) + (sw0 && !a.slack && (a.taut || K.tw > 0.6) ? dt * 5 : -dt * 8), 0, 1);      /* round 10: he hangs in line only once the cable is taut; until then he is still the tucked flier */
    const sw = sw0 && K.tw > 0.3, base = pl.alt || 0, co = !!(a && !sw) || rolling, tgt = a && a.mode === 'swing' ? _hd.set(a.ax, a.az, -a.ay) : a && S.pre ? _hd.set(S.pre.x, S.pre.z, -S.pre.y) : null;
    const v = a ? Math.hypot(a.vx, a.vy, a.vz) : 0, tr = clamp(v / 30, 0.2, 1), len = rig.thigh + rig.shin, kick = Math.sin(K.clock * 3.1) * 0.04;
    const up = a && v > 1 ? clamp(a.vz / v, -1, 1) : 0, LA = (a && a.mode === 'coast' && S.pre ? S.pre.arm : S.arm) === 'R' ? 'R' : 'L', FA = LA === 'L' ? 'R' : 'L', fs = FA === 'R' ? 1 : -1;      // LA = the line arm (the hold's side), FA = the free arm, fs = +1 when the free arm is his right
    const fl = a && a.mode === 'coast' ? a.t : 9, tuck = co && !rolling, reach = false;
    const ph = sw ? clamp(((pl.x - a.px) * Math.cos(a.dir) + (pl.y - a.py) * Math.sin(a.dir)) / Math.max(4, a.L), -1, 1) : 0;      // where he is on the arc: -1 coming down toward it, 0 under the pivot, +1 going up beyond it
    // round 7: four shapes a cycle. ON THE LINE the body lies along the rope: sideways toward the hold (seen from behind) and fore-aft with the arc; legs together and trailing on the way down, kicking through and apart past the bottom;
    // the line arm straight up the cable, the free arm out for balance. LET GO: a ball, knees to chest, pitched forward. Then OPEN: a stride in the air, the OTHER arm reaching up for the next line.
    if (sw) { _t.set(a.ax - pl.x, a.az - base - 1.0, -(a.ay - pl.y)).normalize(); const lat = _t.dot(_rt); _t.copy(UP).addScaledVector(_rt, clamp(lat * 1.5, -0.75, 0.75)).addScaledVector(_fw, clamp(-ph * 1.3, -0.8, 0.8)).normalize(); }
    else if (tuck) _t.set(0, 0.6, 0).addScaledVector(_fw, 0.7 + Math.min(fl, 0.45) * 1.6).normalize();      /* trunk pitched forward along his flight, 49 to 67 deg: a quarter-roll at most */
    else if (a) _t.set(0, 1, 0).addScaledVector(_fw, 0.3).addScaledVector(_rt, fs * 0.35).normalize();
    else _t.set(0, 1, 0);
    K.lean.lerp(_t, Math.min(1, dt * 9)).normalize();
    _qq.setFromUnitVectors(UP, _d.copy(UP).lerp(K.lean, w).normalize()); rig.tilt(_qq);
    if (rolling) { const th = rp * Math.PI * 2; _ax.copy(_rt).multiplyScalar(-1); _qq.setFromAxisAngle(_ax, th); rig.tilt(_qq); _ub.copy(UP).multiplyScalar(Math.cos(th)).addScaledVector(_fw, Math.sin(th)); _fb.copy(_fw).multiplyScalar(Math.cos(th)).addScaledVector(UP, -Math.sin(th)); }
    for (const sd of ['L', 'R']) { const Lf = sd === 'L', sg = Lf ? -1 : 1, lead = sd === FA; let k = 1; rig.pos('thigh_' + sd, _pp);
      if (rolling) { _d.copy(_ub).multiplyScalar(0.25).addScaledVector(_fb, 0.9); k = 0.7; }
      else if (tuck) { _d.copy(_fw).multiplyScalar(0.8).addScaledVector(DN, 0.3).addScaledVector(K.lean, 0.2).addScaledVector(_rt, sg * 0.1); k = lead ? 0.4 : 0.55; }
      else if (reach) { _d.copy(DN).addScaledVector(_fw, lead ? 0.3 : -0.7).addScaledVector(_rt, sg * 0.3); k = lead ? 0.8 : 0.97; }
      else { const kf = clamp(ph * 2.2 + 0.25, -1, 1.2); _d.copy(K.lean).multiplyScalar(-1).addScaledVector(_fw, kf * 1.1).addScaledVector(_rt, sg * (0.05 + Math.max(0, kf) * 0.22)); k = kf > 0.2 ? (lead ? 1 : 0.72) : 0.97; }
      _d.normalize().multiplyScalar(len * k).add(_pp); _pole.copy(_fw).addScaledVector(K.lean, tuck || rolling ? 0.9 : 0.3); rig._ik(B['thigh_' + sd], B['shin_' + sd], B['foot_' + sd], _d, _pole, w); }
    const armTo = (s, rk, pole) => { rig.pos('upper_arm_' + s, _pp); _d.copy(_ax).normalize().multiplyScalar(rig.armLen * rk).add(_pp); rig.arm(s, _d, pole, w); };      // _ax = the way the arm points
    for (const s of ['L', 'R']) { const sg = s === 'L' ? -1 : 1, line = s === LA;
      if (rolling) { _ax.copy(_fb).multiplyScalar(0.7).addScaledVector(_ub, -0.35).addScaledVector(_rt, sg * 0.3); armTo(s, 0.9, _pole.set(0, -1, 0)); }
      else if (tgt && line) { rig.pos('upper_arm_' + s, _pp); _ax.copy(tgt).sub(_pp).normalize(); _d.copy(_pp).addScaledVector(_ax, rig.armLen * 0.97); rig.arm(s, _d, _pole.set(0, -1, 0).addScaledVector(_rt, sg * 0.5), w); rig.handDir(s, _ax, _rt, w); }      /* the line arm: thrown at the new hold as the slack line flies out, and on the line */
      else if (tuck) { _ax.copy(_fw).multiplyScalar(0.7).addScaledVector(DN, 0.6).addScaledVector(_rt, -sg * 0.1); armTo(s, 0.6, _pole.set(0, -1, 0).addScaledVector(_rt, sg)); }
      else if (reach) { if (!line) _ax.copy(UP).multiplyScalar(0.85).addScaledVector(_fw, 0.5).addScaledVector(_rt, sg * 0.4); else _ax.copy(DN).multiplyScalar(0.5).addScaledVector(_fw, -0.5).addScaledVector(_rt, sg * 0.7); armTo(s, 0.95, _pole.set(0, -1, 0).addScaledVector(_rt, sg * 0.5)); }
      else if (sw || (a && a.mode === 'swing')) { if (line) { rig.pos('upper_arm_' + s, _pp); _ax.set(a.ax, a.az, -a.ay).sub(_pp).normalize(); _d.copy(_pp).addScaledVector(_ax, rig.armLen * 0.97); rig.arm(s, _d, _pole.set(0, -1, 0).addScaledVector(_rt, sg * 0.5), w); rig.handDir(s, _ax, _rt, w); }
        else { _ax.copy(_rt).multiplyScalar(sg).addScaledVector(UP, -0.25 + Math.max(0, ph) * 0.9).addScaledVector(_fw, -0.3 + ph * 0.5); armTo(s, 0.95, _pole.copy(_fw).multiplyScalar(-1).addScaledVector(DN, 0.5)); } } }
    const cw = a && a.mode === 'swing' ? LA : null; if (K.curlOn && K.curlOn !== cw) { rig.curl(K.curlOn, 0); K.curlOn = null; } if (cw) { rig.curl(cw, w); K.curlOn = cw; } };
  if (typeof g.syncVisuals === 'function') { const sync0 = g.syncVisuals.bind(g);
    g.syncVisuals = function (dt) { try { unpose(); } catch (e) { fail('unpose', e); } sync0(dt); const d = dt > 0 ? Math.min(dt, 0.1) : 0.016;
      try { pose(d); } catch (e) { fail('pose', e); } try { drawLine(d); } catch (e) { fail('line', e); } }; }
  console.log('[swing] on: hold X (mouse side button, pad D-pad up) to swing; the straight pull is on C');
  return S;
}
