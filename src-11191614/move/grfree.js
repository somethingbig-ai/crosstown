// move/grfree.js (gameplay lane, Nov 16; Matt's point 4: "on the roof you must be able to do dumb things, even ones that kill you"). Fetched by
// move/grapple.js only with ?grapple=1 and the second pull on; ?grfree=0 = never fetched (the roof is fenced as before, the fling is grapple.js's own).
// WHAT IT DOES
// - No fence: heli.step puts a man on a roof back when the height under him changes by more than 0.7 m. That step is wrapped here: where the ground
//   falls away he walks or runs off and falls; a rise of 0.7 to 1.4 m (a parapet, a step) is hopped when he keeps pushing at it; higher is a wall.
// - SPACE on a roof: a jump with the speed he runs at (+1.4 m/s when running), 6.3 m/s up (the game's own jump: 1.1 m), gravity 18, a little steering in the air.
//   A roof under his feet = he lands and runs on. A far wall met with his feet 0.4 to 1.6 m under its top = he grabs the edge and pulls up (0.45 s hang,
//   0.6 s up; SPACE in the hang = let go). Lower than that: he hits the wall and falls.
// - Falling: gravity 18, air drag to 50 m/s. He lands on what is under him (the height map: street or roof; a car = a bounce off its roof). The hurt is
//   grapple.js's own rule, (v - 9) x 6 with v = fall speed and 0.35 of the forward speed; a wall met above 12 m/s costs (v - 12) x 3.
// - PARACHUTE: SPACE in the air (0.3 s after leaving) with 15 m or more of air under him opens it: 0.8 s to open, then about 5.5 m/s down and 10 m/s
//   forward. A / D turn, W = faster (12 forward / 6.5 down), S = the brakes (6.5 / 5.2: a steeper way down, to drop onto a roof); it flares by itself under 3.5 m. The landing obeys the same
//   hurt rule (a flown canopy lands under it: no hurt). A wall under canopy turns him away (hurt only above 12.5 m/s, faster than it flies). SPACE again = cut away: he falls,
//   and there is no second one. Under 15 m it only streams and does not hold him. It never opens by itself.
// - STAGE H (replaces the numbers above where they differ): A / D turn a full circle in 6.5 s. S = deep brakes, 2.5 m/s forward / 6.2 down (almost straight down onto a roof);
//   W = 13 forward / 7 down; the flare is the last 2.5 m. A wing tip touching a wall slides him off it; the wing folds (0.5 s, 8.5 m/s down) only when he flies INTO a wall.
//   The far edge: caught on contact with his feet 0.4 to 2.75 m under its top, or when it is up to 0.6 m ahead of him as he falls past. He HANGS: W or SPACE = climb up
//   (after 0.45 s), S = let go, by himself he climbs after 3 s. The camera is pulled in along its boom whenever it would be inside a building (in the air, after a landing, on a roof).
// - A fling (SPACE in the hook's pull) is handed to this file by grapple.js (G.free.take), so the parachute works after a fling too.
// - Camera (laid on in the syncVisuals wrap, where grapple.js lays its own): behind and above him on the player's own yaw; under canopy the yaw follows the turn.
// Only wraps; edits nobody's code. The game's own jump (move/jump.js) is switched off while he stands on a roof or is in the air, and back on in the street.
import * as THREE from 'three';

const GRAV = 18, JUMP_V = 6.3, RUN_PUSH = 1.4, AIRC = 3.5, C0 = GRAV / 2500, C_STREAM = 0.012, GRAB_LO = 0.4, GRAB_HI = 2.75, GRAB_AHEAD = 0.6, T_HANG = 0.45, HANG_MAX = 3, T_UP = 0.6;
const CH_MIN = 30, RAG_V = 19.5, T_TUM = 0.45, T_LIE = 1.9, T_UP2 = 0.9, T_OPEN = 0.8, SINK = 5.5, GLIDE = 10, TURN = 0.97, JOLT = 55, FLARE = 2.5, HARD = 8.2, CAR_TOP = 1.4, HALF = 3.3, WING_Z = 4.3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };

export function install(g, G, X) {
  if (G.free) return G.free;
  const pl = g.player, st = g.statics, hl = g.heli, { top, inMap, say, done } = X, _o = {};
  // chute lane, Nov 17 (CHIEF: 'a fall from more than about 12 m ragdolls the player, then he gets up, with no death; SPACE during a fall from more than about 30 m opens it'):
  // ?chute=0 = no parachute at all; ?fallrag=0 = no going down after a long fall (the 0.5 s stumble as before). A fall never kills: it leaves him 10 health at least.
  const CHUTE = !(g.P && g.P.get('chute') === '0'), FALLRAG = !(g.P && g.P.get('fallrag') === '0');
  // Matt, Nov 18: "When I'm on a parachute I literally cannot move my camera up and down." Under the canopy the view's pitch is the player's own (mouse, touch look, the pad's right stick: g.cam.pitch, the range on foot); ?chutepitch=0 = the fixed view as before.
  const CPITCH = !(g.P && g.P.get('chutepitch') === '0');
  const hurtBy = (n) => { const c = g.combat; if (!(n > 0)) return; X.hurtBy(c && c.health > 0 ? Math.min(n, Math.max(0, c.health - 10)) : 0); };
  const F = (G.free = { on: true, a: null, last: null, mx: 0, my: 0, vx: 0, vy: 0, blockT: 0, stum: 0, spaceWant: false, jumpWas: false, fails: 0, cw: 0, col: null, log: null,
    stats: { walked: 0, jumped: 0, hopped: 0, flings: 0, blocked: 0, grabs: 0, pulledUp: 0, letGo: 0, chutes: 0, streams: 0, cuts: 0, bumps: 0, cars: 0, walls: 0, lips: 0, roofLands: 0, streetLands: 0, settled: 0 } });
  const S = F.stats, fail = (where, e) => { if (F.fails++ < 4) console.warn('[grfree] ' + where + ': ' + String((e && e.stack) || e).slice(0, 400)); };
  const ground = (x, y) => { const T = top(x, y); return T > -0.5 ? Math.max(0, T) : 0; };
  const onFoot = () => !pl.vehicle && !pl.busy && !(hl && (hl.piloted || hl.busy || hl.hasCamera)) && !(g.fly && g.fly.on) && !g.demo;
  const dead = () => { const c = g.combat, h = c && c.heat; return !!((h && h.dead) || (c && c.dead)); };
  const put = (a) => { pl.x = a.x; pl.y = a.y; pl.alt = Math.max(0.01, a.z); pl.roof = null; pl.speed = 0; if (g.cam && typeof g.cam.tz === 'number') g.cam.tz = pl.alt + 1.5; };
  const overCar = (x, y) => { for (const L of [g.traffic && g.traffic.cars, g.vehicles]) if (L) for (const c of L) if (c !== pl.vehicle && Math.hypot(x - c.x, y - c.y) < 1.2) return c; return null; };

  const startAir = (x, y, z, vx, vy, vz, from) => {
    F.a = { x, y, z, vx, vy, vz, t: 0, mode: 'fall', from, z0: z, k: 0, hd: pl.h, used: false, cut: false, wall: 0, car: false, bumps: 0, grabbed: false, g: null, vmax: 0, chT: 0, openZ: 0, openV: 0, sinkS: 0, glideS: 0, flyT: 0, h0: g.combat ? g.combat.health : 0, lost: 0 };
    G.mine = false; G.carry = null; F.stum = 0; put(F.a); };
  // the landing: the hurt by its speed, then he stands there (a roof is his as a hooked one is: the roof police know it)
  const land = (a, gz, imp) => {
    const c = g.combat, v = Math.hypot(a.vx, a.vy), mode = a.mode; F.a = null;
    if (!dead()) hurtBy((imp - 9) * 6); pl.x = a.x; pl.y = a.y; pl.speed = 0;
    if (gz > 0.6) { pl.alt = gz; pl.roof = true; if (hl) { hl._rx = a.x; hl._ry = a.y; } G.rx = a.x; G.ry = a.y; G.mine = true; S.roofLands++;
      const sp = Math.min(mode === 'chute' ? 5 : 7, v); if (sp > 1 && imp < 14 && !a.grabbed) G.carry = { vx: a.vx / v * sp, vy: a.vy / v * sp, t: 0, T: 0.5 }; }
    else { let got = false; const tryAt = (x, y) => { const Tt = top(x, y); if (!(Tt < 0.6 && Tt > -0.5)) return false; st.resolve(x, y, 0.34, _o); if (Math.hypot(_o.x - x, _o.y - y) > 0.05) return false; pl.x = x; pl.y = y; return true; };      // the street: clear of what stands on it (at the very foot of a wall: the nearest clear spot)
      st.resolve(a.x, a.y, 0.34, _o); const ox = _o.x, oy = _o.y; got = tryAt(a.x, a.y) || (Math.hypot(ox - a.x, oy - a.y) < 1.5 && tryAt(ox, oy));
      for (const r of [0.5, 0.9, 1.4, 2, 3]) { if (got) break; for (let k = 0; k < 8 && !got; k++) got = tryAt(a.x + Math.cos(k * 0.7854) * r, a.y + Math.sin(k * 0.7854) * r); }
      pl.alt = 0; pl.roof = null; G.mine = false; S.streetLands++; }
    if (FALLRAG && imp >= RAG_V && mode !== 'chute' && !dead()) { F.rag = { t: 0, hd: v > 1 ? Math.atan2(a.vy, a.vx) : pl.h, imp, sd: (a.t * 7.3 % 2) < 1 ? 1 : -1 }; pl.h = F.rag.hd; S.rags = (S.rags || 0) + 1; if (g.cam) g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.6); } else
    if (imp > HARD) F.stum = 0.5; if (mode === 'chute' || mode === 'stream') F.col = { t: 0, x: a.x, y: a.y, z: gz, hd: a.hd, k: mode === 'chute' ? a.k : 0.15 };
    if (G.cd < 0.3) { G.cd = 0.3; if (!(G.cdMax > 0.3)) G.cdMax = 0.3; }
    F.vx = F.vy = 0; a.lost += c ? Math.max(0, a.h0 - c.health) : 0;
    F.last = { from: a.from, mode, z0: a.z0, t: a.t, imp, gz, roof: gz > 0.6, x: pl.x, y: pl.y, wall: a.wall, car: a.car, bumps: a.bumps, grabbed: a.grabbed, cut: a.cut, used: a.used, vmax: a.vmax, lost: a.lost, dead: dead() || !!(c && !(c.health > 0)),
      rag: !!F.rag, openZ: a.openZ, openV: a.openV, sink: a.flyT > 0 ? a.sinkS / a.flyT : 0, glide: a.flyT > 0 ? a.glideS / a.flyT : 0, chT: a.chT };
    if (F.log) F.log(F.last); };
  // taken out of the air by something else (a car seat, the clinic, a fault): he stands on what is under him, unhurt
  const settle = (why) => { const a = F.a; if (!a) return; F.a = null; S.settled++; F.col = null; F.last = { from: a.from, mode: 'settled', why };
    if (pl.vehicle || (hl && hl.piloted)) return; let x = a.x, y = a.y, T = top(x, y); if (T > a.z + 1.6 || T <= -0.5) { x = pl.x; y = pl.y; T = top(x, y); }
    if (T > 0.6) { pl.x = x; pl.y = y; pl.alt = T; pl.roof = true; if (hl) { hl._rx = x; hl._ry = y; } G.rx = x; G.ry = y; G.mine = true; } else { pl.alt = 0; pl.roof = null; } };

  const key = (a) => {      // SPACE in the air
    if (a.mode === 'chute') { a.mode = 'fall'; a.cut = true; S.cuts++; F.col = { t: 0, x: a.x, y: a.y, z: a.z, hd: a.hd, k: a.k, away: true, vx: a.vx * 0.5, vy: a.vy * 0.5 }; return; }
    if (!CHUTE || a.mode !== 'fall' || a.used) return; const below = a.z - ground(a.x, a.y); if (below < CH_MIN) return;
    a.used = true; a.hd = Math.hypot(a.vx, a.vy) > 1 ? Math.atan2(a.vy, a.vx) : pl.h; a.openZ = below; a.openV = -a.vz; a.k = 0;
    if (below < CH_MIN) { a.mode = 'stream'; S.streams++; } else { a.mode = 'chute'; S.chutes++; } };

  const grabStep = (a, d) => { const q = a.g; q.t += d;      // (stage H) he hangs until told: W or SPACE = up (after a beat of T_HANG), S = let go; by himself he climbs after HANG_MAX
    if (!q.up && q.t > 0.2 && F.my < -0.3 && !dead()) { a.mode = 'fall'; a.g = null; a.vx = a.vy = a.vz = 0; a.x = q.x0; a.y = q.y0; a.grabbed = false; S.letGo++; return put(a); }
    if (!q.up && ((q.t > T_HANG && (F.spaceWant || F.my > 0.3)) || q.t > HANG_MAX)) { q.up = true; q.t0 = q.t; }
    if (!q.up) { const r = Math.min(1, d * 14); a.z += (q.tz - 1.55 - a.z) * r; a.x += (q.x0 - a.x) * r; a.y += (q.y0 - a.y) * r; S.hangF = (S.hangF || 0) + 1; }
    else { const u = Math.min(1, (q.t - q.t0) / T_UP), v = ease((u - 0.6) / 0.4); a.z = Math.max(a.z, q.tz - 1.55 * (1 - ease(u * 1.7))); a.x = q.x0 + (q.lx - q.x0) * v; a.y = q.y0 + (q.ly - q.y0) * v;
      if (u >= 1) { a.x = q.lx; a.y = q.ly; a.z = q.tz; a.vx = a.vy = a.vz = 0; S.pulledUp++; return land(a, q.tz, 0); } }
    say('HOLDING ON', q.up ? '' : 'W  CLIMB UP · S  LET GO', 0.3); put(a); };

  const fly = (d) => {
    const a = F.a; a.t += d; if (a.mode === 'grab') return grabStep(a, d);
    if (F.spaceWant && a.t > 0.3 && !dead()) key(a);
    const C = g.cam, dd = dead(), mx = dd ? 0 : F.mx || 0, my = dd ? 0 : F.my || 0, m = Math.min(1, Math.hypot(mx, my)), n = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * d / 0.4)), h = d / n;
    if (a.mode === 'chute') a.chT += d;
    for (let i = 0; i < n; i++) {
      const hd0 = a.hd;
      if (a.mode === 'chute') {
        a.k = Math.min(1, a.k + h / T_OPEN); const k3 = a.k * a.k * a.k, fl = a.k >= 1 && a.z - ground(a.x, a.y) < FLARE && !(a.colT > 0); a.hd += mx * TURN * h * a.k;
        if (a.colT > 0) a.colT -= h;
        if (a.k >= 0.6 && !fl) {      // (stage F) the wing has width: a wall nearer than half a span + 1 m on one side only = eased away from it
          const lx = -Math.sin(a.hd), ly = Math.cos(a.hd), fx = Math.cos(a.hd), fy = Math.sin(a.hd), wl = (sd, f) => top(a.x + lx * sd + fx * f, a.y + ly * sd + fy * f) > a.z + 1;
          const sL = wl(HALF + 1, 0) || wl(HALF + 1, 4), sR = wl(-HALF - 1, 0) || wl(-HALF - 1, 4), ah = wl(0, 9) || wl(HALF, 7) || wl(-HALF, 7), tp = (sd) => Math.max(top(a.x + lx * sd * 7 + fx * 5, a.y + ly * sd * 7 + fy * 5), top(a.x + lx * sd * 12, a.y + ly * sd * 12));
          const dir = sL && !sR ? -1 : sR && !sL ? 1 : ah && !(sL && sR) ? (tp(1) <= tp(-1) ? 1 : -1) : 0; if (dir) { a.hd += dir * (ah ? 1.3 : 0.7) * (Math.abs(mx) > 0.3 ? 0.3 : 1) * h      /* (stage I) a held A / D wins over the easing-away (it used to out-turn him: 1.3 against 0.97) */; a.assist = (a.assist || 0) + h; } }
        const vs = a.colT > 0 ? 8.5 : fl ? 1.8 : SINK + (my > 0.3 ? 1.5 : my < -0.3 ? 0.7 : 0) + Math.abs(mx) * 0.4, vf = a.colT > 0 ? 3 : fl ? (my < -0.3 ? 1 : 4) : GLIDE + (my > 0.3 ? 3 : my < -0.3 ? -7.5 : 0)      /* (stage H) S = deep brakes 2.5 forward / 6.2 down, W = 13 / 7 */, c = C0 + (GRAV / (vs * vs) - C0) * k3;
        a.vz += (-GRAV + (a.vz < 0 ? Math.min(JOLT, c * a.vz * a.vz) : -c * a.vz * a.vz)) * h;
        const r = Math.min(1, (my < -0.3 ? 4.5 : 2.5) * a.k * h); a.vx += (Math.cos(a.hd) * vf * a.k - a.vx) * r; a.vy += (Math.sin(a.hd) * vf * a.k - a.vy) * r;
        if (a.k >= 1 && !fl && a.chT > 2.5) { a.flyT += h; a.sinkS += -a.vz * h; a.glideS += Math.hypot(a.vx, a.vy) * h; }
      } else {
        const q = (a.mode === 'stream' ? C_STREAM : C0) * Math.hypot(a.vx, a.vy, a.vz) * h; a.vx -= a.vx * q; a.vy -= a.vy * q; a.vz -= a.vz * q; a.vz -= GRAV * h;
        if (m > 0.1 && C) { const ang = C.yaw + Math.atan2(mx, my), v0 = Math.hypot(a.vx, a.vy); a.vx += Math.cos(ang) * AIRC * m * h; a.vy += Math.sin(ang) * AIRC * m * h; const v1 = Math.hypot(a.vx, a.vy), cap = Math.max(v0, 3); if (v1 > cap) { a.vx *= cap / v1; a.vy *= cap / v1; } }
      }
      if (-a.vz > a.vmax) a.vmax = -a.vz;
      if (a.mode === 'chute' && a.k >= 0.6) { const lx = -Math.sin(a.hd), ly = Math.cos(a.hd), px = a.x + a.vx * h, py = a.y + a.vy * h, pz = a.z + a.vz * h;      // (stage F) a wing tip into a wall: that side folds, he is pushed off the wall and drops (the landing hurts by its speed)
        for (const sd of [1, -1]) if (top(px + lx * sd * HALF, py + ly * sd * HALF) > pz + WING_Z) {      // (stage H) a tip touching a wall slides him off it (4 m/s sideways, turning away); only flying INTO a wall folds the wing (below)
          const qx = a.x - lx * sd * 4 * h, qy = a.y - ly * sd * 4 * h; if (top(qx, qy) <= a.z + GRAB_LO && top(qx, qy) > -0.5 && inMap(qx, qy)) { a.x = qx; a.y = qy; } a.hd -= sd * 0.9 * h; if (!(a.t - (a.brT || -9) < 1)) { S.brushes = (S.brushes || 0) + 1; a.brushes = (a.brushes || 0) + 1; } a.brT = a.t; break; } }
      let nx = a.x + a.vx * h, ny = a.y + a.vy * h; const nz = a.z + a.vz * h, Tn = top(nx, ny);
      if (a.mode === 'fall' && !dead() && a.t > 0.15 && a.vz < 1.5 && a.vz > -16 && Tn <= nz + GRAB_LO) { const sp = Math.hypot(a.vx, a.vy);      // (stage H) his hands reach an edge up to 0.6 m ahead and up to 1.2 m above them
        if (sp > 0.5) { const ux = a.vx / sp, uy = a.vy / sp; let f = 0, Te = 0; for (f = 0.15; f <= GRAB_AHEAD + 0.01; f += 0.15) { Te = top(nx + ux * f, ny + uy * f); if (Te > nz + GRAB_LO) break; }
          if (f <= GRAB_AHEAD + 0.01 && Te - nz <= GRAB_HI && inMap(nx + ux * (f + 0.7), ny + uy * (f + 0.7)) && Math.abs(top(nx + ux * (f + 0.3), ny + uy * (f + 0.3)) - Te) < 0.5 && Math.abs(top(nx + ux * (f + 0.7), ny + uy * (f + 0.7)) - Te) < 0.5) {
            a.mode = 'grab'; a.grabbed = true; a.x = nx; a.y = ny; a.z = nz; a.g = { t: 0, x0: nx + ux * (f - 0.15), y0: ny + uy * (f - 0.15), tz: Te, lx: nx + ux * (f + 0.7), ly: ny + uy * (f + 0.7), ux, uy, reach: f }; a.vx = a.vy = a.vz = 0; S.grabs++; S.reached = (S.reached || 0) + 1; return put(a); } } }
      if ((a.vx || a.vy) && (Tn > nz + GRAB_LO || Tn <= -0.5 || !inMap(nx, ny) || (nz < 3.2 && st.raycast && st.raycast(a.x, a.y, nx, ny) < 1))) {
        const sp = Math.hypot(a.vx, a.vy), ux = a.vx / sp, uy = a.vy / sp;
        if (a.mode === 'chute') {      // a wall under canopy: turned away from it, towards the lower side
          if (sp > 12.5) hurtBy((sp - 12) * 3); const L = top(a.x + Math.cos(a.hd + 1.57) * 4, a.y + Math.sin(a.hd + 1.57) * 4), R = top(a.x + Math.cos(a.hd - 1.57) * 4, a.y + Math.sin(a.hd - 1.57) * 4);
          const wa = (o) => top(a.x + Math.cos(a.hd + o) * 3, a.y + Math.sin(a.hd + o) * 3) > a.z + GRAB_LO, into = sp > 5 && wa(0.7) && wa(-0.7), tn = into ? 1.9 : 0.8, v = into ? 3 : Math.max(3, sp * 0.75);      // (stage H) glancing = turned along it, speed kept; flown INTO it (wall both sides ahead) = the wing folds
          if (into && !(a.colT > 0)) { S.collapses = (S.collapses || 0) + 1; a.cols = (a.cols || 0) + 1; a.colT = 0.5; a.colS = L <= R ? -1 : 1; }
          a.hd = wrapPi(a.hd + (L <= R ? tn : -tn)); a.vx = Math.cos(a.hd) * v; a.vy = Math.sin(a.hd) * v; if (!(a.t - (a.bT || -9) < 0.6)) { a.bumps++; S.bumps++; } a.bT = a.t; nx = a.x; ny = a.y;
        } else if (a.mode === 'fall' && Tn > nz + GRAB_LO && Tn - nz <= GRAB_HI && a.vz > -16 && inMap(nx + ux * 0.7, ny + uy * 0.7) && Math.abs(top(nx + ux * 0.3, ny + uy * 0.3) - Tn) < 0.5 && Math.abs(top(nx + ux * 0.7, ny + uy * 0.7) - Tn) < 0.5) {
          a.mode = 'grab'; a.grabbed = true; a.z = nz; a.g = { t: 0, x0: a.x, y0: a.y, tz: Tn, lx: nx + ux * 0.7, ly: ny + uy * 0.7, ux, uy }; a.vx = a.vy = a.vz = 0; S.grabs++; return put(a);
        } else if (a.mode === 'fall' && Tn > nz + GRAB_LO && Tn - nz <= 1.2 && top(nx + ux * 0.9, ny + uy * 0.9) < Tn - 0.5 && top(nx + ux * 0.9, ny + uy * 0.9) > -0.5 && inMap(nx + ux * 0.9, ny + uy * 0.9)) {      // a thin lip (a parapet): he kicks up over it
          const need = Math.sqrt(2 * GRAV * (Tn - nz + 0.15)); if (a.vz < need) { a.vz = need; S.lips++; } nx = a.x; ny = a.y;
        } else { a.wall = Math.max(a.wall, sp); S.walls++; a.vx = a.vy = 0; nx = a.x; ny = a.y; if (sp > 12) hurtBy((sp - 12) * 3); }      // a wall, a fence near the ground or the map's edge: he stops against it and drops
      }
      const gz = ground(nx, ny);
      if (a.vz < 0 && !a.car && gz < 0.6 && nz <= CAR_TOP && nz > gz && overCar(nx, ny)) {      // a car's roof: the hurt of the landing, then he comes off it
        const c = overCar(nx, ny), imp = Math.hypot(a.vz, 0.35 * Math.hypot(a.vx, a.vy)), dx = nx - c.x, dy = ny - c.y, dl = Math.hypot(dx, dy) || 1; a.car = true; S.cars++; hurtBy((imp - 9) * 6);
        a.vz = 2.5; a.vx = (dl > 0.05 ? dx / dl : Math.cos(pl.h)) * 3; a.vy = (dl > 0.05 ? dy / dl : Math.sin(pl.h)) * 3; if (a.mode !== 'fall') { F.col = { t: 0, x: nx, y: ny, z: CAR_TOP, hd: a.hd, k: a.mode === 'chute' ? a.k : 0.15 }; a.mode = 'fall'; } a.x = nx; a.y = ny; a.z = CAR_TOP; continue; }
      if (nz <= gz) { a.x = nx; a.y = ny; a.z = gz; return land(a, gz, a.car ? 0 : Math.hypot(a.vz, 0.35 * Math.hypot(a.vx, a.vy))); }
      a.x = nx; a.y = ny; a.z = nz; }
    if (a.mode === 'chute') pl.h = a.hd; else if (Math.hypot(a.vx, a.vy) > 2) pl.h += wrapPi(Math.atan2(a.vy, a.vx) - pl.h) * Math.min(1, d * 8);
    const below = a.z - ground(a.x, a.y);
    // (stage E) the prompt only when SPACE would really open it: 0.3 s into the fall and 15 m of air under him here AND where he will be in 0.35 and 0.7 s (so not over the gap of a roof-to-roof jump)
    let air = below; for (const q of [0.35, 0.7]) air = Math.min(air, a.z + a.vz * q - GRAV / 2 * q * q - ground(a.x + a.vx * q, a.y + a.vy * q));
    if (CHUTE && a.mode === 'fall' && !a.used && a.t > 0.3 && air >= CH_MIN) say('SPACE  PARACHUTE', Math.round(below) + ' m', 0.12);
    else if (a.mode === 'chute' && a.chT < 5) say('W A S D  STEER', 'SPACE  CUT AWAY · THE GUN WORKS', 0.3);
    put(a); };

  // ---------------------------------------------------------------- the roof's edge (heli.step wrapped: its parapet rule no longer holds him)
  const edge = (wx, wy, rx, ry, alt, dt) => {
    const d = dt > 0 ? dt : 1 / 60, vx = (wx - rx) / d, vy = (wy - ry) / d; if (Math.hypot(vx, vy) < 12) { F.vx += (vx - F.vx) * 0.5; F.vy += (vy - F.vy) * 0.5; }
    if (pl.x === wx && pl.y === wy) { F.blockT = 0; F.teeT = Math.max(0, (F.teeT || 0) - d * 2); return; }      // heli.step let him be
    const T = top(wx, wy); if (T <= -0.5 || !inMap(wx, wy)) { S.blocked++; return; }
    if (T < alt - 0.7) { if (Math.hypot(F.vx, F.vy) < 3.5) { F.teeT = (F.teeT || 0) + d; S.teeters = (S.teeters || 0) + 1; if (F.teeT > 0.3) say('THE EDGE', 'SHIFT  RUN OFF · SPACE  JUMP', 0.3); return; }      /* (stage I) WALKING into an edge: he is held at the lip for as long as he walks; a run (Shift) or a jump goes over */ F.teeT = 0; S.walked++; return startAir(wx, wy, alt, F.vx, F.vy, 0, 'walk'); }
    if (T > alt + 0.7 && T <= alt + 1.4) { F.blockT += d; if (F.blockT > (Math.hypot(F.vx, F.vy) > 3.5 ? 0.05 : 0.2)) {      /* (stage E) at a run he vaults a parapet in his stride */ F.blockT = 0; S.hopped++; const sp = Math.hypot(F.vx, F.vy) || 1, k = Math.max(2.2, sp) / sp; return startAir(rx, ry, alt, F.vx * k, F.vy * k, Math.sqrt(2 * GRAV * (T - alt + 0.3)), 'hop'); } return; }
    S.blocked++; };
  if (hl && typeof hl.step === 'function') { const hs0 = hl.step.bind(hl);
    hl.step = function (dt, I) {
      const was = F.on && !F.a && !G.phase && pl.roof && pl.alt > 1 && onFoot(), rx = this._rx, ry = this._ry, alt = pl.alt; let wx = pl.x, wy = pl.y;
      // the game's own walk has just been stopped by the street's collision set (the building's own walls, seen from inside): on a roof only the heights count, so his step is taken again without it
      if (was && typeof rx === 'number' && I && dt > 0 && Math.hypot(wx - rx, wy - ry) < 0.6) { const m = Math.min(1, Math.hypot(I.mx || 0, I.my || 0)); if (m > 0.1) { const sp = (I.run ? 5.4 : 1.9) * m; wx = pl.x = rx + Math.cos(pl.h) * sp * dt; wy = pl.y = ry + Math.sin(pl.h) * sp * dt; } }
      const r = hs0(dt, I); if (was && typeof rx === 'number') { try { edge(wx, wy, rx, ry, alt, dt); } catch (e) { fail('edge', e); } } return r; }; }

  // ---------------------------------------------------------------- wrapped: readInput, step
  const take = () => { const I = g.input; if (!I) return; if (I.mx || I.my) { F.mx = I.mx; F.my = I.my; } I.mx = 0; I.my = 0; I.use = false; I.run = false; };
  const read0 = g.readInput.bind(g); g.readInput = function () { read0(); const I = g.input; if (I) { F.mx = I.mx; F.my = I.my; } if (F.a || F.stum > 0 || F.rag) take(); };
  const step0 = g.step.bind(g);
  // the gun under the canopy (chute lane, Nov 17): combat's canCarry() refuses a gun above 2 m (roofs and the air). Under a fully open canopy that one test is lifted; every other test of it stays (a seat, the helicopter, busy). Wrapped here, combat.js is not edited; ?chute=0 or ?grfree=0 = as before.
  const gunHook = () => { const c = g.combat; if (!c || typeof c.canCarry !== 'function') return; F.cc = true; if (typeof addEventListener === 'function') { const gk = (T) => { const a = F.a; if (a && a.mode === 'chute') F.gunT = Math.max(F.gunT || 0, T); }; addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 2) gk(0.9); }, true); addEventListener('keydown', (e) => { if (/^Digit[1-9]$/.test(e.code)) gk(1.5); }, true); } const cc = c.canCarry; c.canCarry = function () { if (F.rag) return false;      /* handover-2: down on the ground the gun is put away */ const a = F.a; if (CHUTE && a && a.mode === 'chute' && a.k >= 1 && pl.alt > 2) { if (!(F.gunT > 0)) return false;      /* helper 4: under the canopy the gun is in his hands only while he uses it (click, aim, a weapon key); otherwise his hands are on the toggles */ const z = pl.alt; pl.alt = 0; try { return cc.call(this); } finally { pl.alt = z; } } return cc.call(this); }; };
  g.step = function (dt) {
    const d = dt > 0 ? dt : 0;
    try { if (!F.cc) gunHook(); const J = g.jump, up = !!F.a || !!F.rag || (!!pl.roof && pl.alt > 1 && !pl.vehicle);      // the game's own jump is for the street: on a roof and in the air SPACE is this file's
      if (J) { if (up && !G.phase) { if (J.on && !J.phase) { J.on = false; F.jumpWas = true; } } else if (F.jumpWas && !G.phase) { J.on = true; F.jumpWas = false; } }
      if (F.a || F.stum > 0 || F.rag) take();
    } catch (e) { fail('pre', e); }
    step0(dt);
    try {
      if (F.stum > 0) F.stum -= d;
      if (F.rag) { const R = F.rag; R.t += d; pl.speed = 0; if (R.x === undefined) { R.x = pl.x; R.y = pl.y; } if (R.t < T_LIE) pl.h = R.hd; if (Math.hypot(pl.x - R.x, pl.y - R.y) < 3) { pl.x = R.x; pl.y = R.y; }      /* he stays where he fell until he is up (the clinic or a seat may still move him) */ if (R.t >= T_LIE + T_UP2 || dead() || pl.vehicle || F.a || (hl && hl.piloted)) F.rag = null; else if (R.t > T_TUM && R.t < T_LIE) say('DOWN', '', 0.2); }
      if (F.a) { const a = F.a;
        if (Math.hypot(pl.x - a.x, pl.y - a.y) > 3) { F.a = null; F.col = null; S.settled++; F.last = { from: a.from, mode: 'settled', why: 'moved' }; pl.alt = 0; pl.roof = null; }      // the game put him somewhere else (the clinic after a death): he is there, on the street
        else if (pl.vehicle || pl.busy || (hl && hl.piloted) || G.phase) settle('taken'); else fly(d); }      // (a man shot dead in the air goes on down as he was: the body lands)
      else if (F.spaceWant && pl.roof && pl.alt > 1 && !G.phase && onFoot() && !dead() && !(F.stum > 0) && !F.rag) {
        const sp = Math.hypot(F.vx, F.vy), k = sp > 3 ? (sp + RUN_PUSH) / sp : 1; S.jumped++; startAir(pl.x, pl.y, pl.alt, F.vx * k, F.vy * k, JUMP_V, 'jump'); }
      if (!pl.roof && !F.a) { F.vx = F.vy = 0; }
    } catch (e) { fail('step', e); try { settle('fault'); } catch (e2) { F.a = null; } }
    F.spaceWant = false;
  };
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => { if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; F.spaceWant = true; });
  F.space = () => { F.spaceWant = true; };
  F.take = (p, f) => { if (!F.on) return false; S.flings++; startAir(p.x, p.y, Math.max(0.01, p.z), f.vx, f.vy, f.vz, 'fling'); done(); return true; };      // grapple.js hands the fling over
  F.settle = settle; F.startAir = startAir;

  // ---------------------------------------------------------------- drawn: the camera, the canopy and its lines, the body
  const V3 = () => new THREE.Vector3(), _cg = V3(), _cw = V3(), _ck = V3(), _cc = V3(), _ca = V3(), _a = V3(), _b = V3(), _fw = V3(), _rt = V3(), _ax = V3(), _up = new THREE.Vector3(0, 1, 0)      /* helper 4: V3() takes no numbers, so 'up' was (0, 0, 0) in handover-1 and every limb target lost its height: the seated legs, the arms out flat */, _pole = V3();
  const _qg = new THREE.Quaternion(), _qm = new THREE.Quaternion(), _q = new THREE.Quaternion();
  // (handover-2) trees: the height map knows buildings, not crowns, and the view after a landing in a park sat inside one. Crowns near him are listed twice a second (street trees and the park's own);
  // a camera place inside a crown is refused, and a sight line through the middle of one is counted as shut (not within 2.5 m of him: he may land under a tree).
  const TR = { t: -9, x: 0, y: 0, L: [] };
  const treesNear = (x, y) => { if (K.clock - TR.t < 0.5 && Math.hypot(x - TR.x, y - TR.y) < 12) return TR.L; TR.t = K.clock; TR.x = x; TR.y = y; const L = TR.L = [];
    try { const A = g.streets && g.streets.parts && g.streets.parts.trees && g.streets.parts.trees.trees; if (A && A.length) for (let i = 0; i < A.length; i++) { const q = A[i]; if (!q || Math.abs(q.x - x) > 45 || Math.abs(q.y - y) > 45) continue; const sy = q.sc && q.sc[1] || 1, inf = q.model && q.model.info, hi = inf && inf.hi ? inf.hi[1] * sy : 9, lo = inf && inf.forkH ? inf.forkH * sy : 2.5; L.push([q.x, q.y, q.rad || 2.5, Math.max(1.2, lo - 0.6), hi + 0.5]); } } catch (e) {}
    try { const Cs = g.park && g.park.chunks; if (Cs && Cs.values) for (const C of Cs.values()) { const A = C && C.trees; if (!A || !A.length) continue; for (let i = 0; i < A.length; i++) { const q = A[i]; if (!q || Math.abs(q.x - x) > 45 || Math.abs(q.y - y) > 45) continue; const g0 = Math.max(0, top(q.x, q.y)); L.push([q.x, q.y, q.r || 2.5, g0 + (q.h || 9) * 0.3, g0 + (q.h || 9) + 0.5]); } } } catch (e) {}
    return L; };
  const inTree = (x, y, z, deep) => { const a = F.a, L = treesNear(a ? a.x : pl.x, a ? a.y : pl.y); for (let i = 0; i < L.length; i++) { const q = L[i]; if (z > q[3] && z < q[4]) { const r = deep ? q[2] * 0.6 : q[2] + 0.5; if ((x - q[0]) * (x - q[0]) + (y - q[1]) * (y - q[1]) < r * r) return true; } } return false; };
  const sight = (cx, cy, cz, tx, ty, tz) => { const L = Math.hypot(tx - cx, ty - cy, tz - cz), n = Math.max(2, Math.ceil(L / 0.5)); for (let i = 0; i < n; i++) { const u = i / n; if (top(cx + (tx - cx) * u, cy + (ty - cy) * u) > cz + (tz - cz) * u - 0.25) return false; if (i > 0 && (1 - u) * L > 2.5 && inTree(cx + (tx - cx) * u, cy + (ty - cy) * u, cz + (tz - cz) * u, 1)) return false; } return true; };
  // (stage E) the chase camera: behind and a little above HIM on the player's own yaw, under the canopy; a wall near = pulled in along the same line, never inside a building (the height map says).
  // After a landing it stays on him until the game's own camera has him in the picture with a clear line, then hands over in 0.4 s.
  const clearAt = (x, y, z) => !inTree(x, y, z, 0) && top(x, y) < z - 0.3 && top(x + 0.45, y) < z - 0.3 && top(x - 0.45, y) < z - 0.3 && top(x, y + 0.45) < z - 0.3 && top(x, y - 0.45) < z - 0.3;
  const sees = (x, y, z, sx, sy, sz) => clearAt(x, y, z) && sight(x, y, z, sx, sy, sz + 1.7) && sight(x, y, z, sx, sy, sz + 0.4);
  const _cv = V3(), _qi = new THREE.Quaternion();
  const framed = (cam, pos, quat, sx, sy, sz) => { const th = Math.tan((cam.fov || 55) * Math.PI / 360), as = cam.aspect || 1.78; _qi.copy(quat).invert();
    for (const h of [0.1, 1.75]) { _cv.set(sx, sz + h, -sy).sub(pos).applyQuaternion(_qi); const dz = -_cv.z; if (!(dz > 0.6) || Math.abs(_cv.y) > dz * th * 0.82 || Math.abs(_cv.x) > dz * th * as * 0.85) return false; } return true; };
  // (stage F) under canopy: behind and about level with him, 8.5 m back, looking up a little so the wing is in the top of the picture. If the line straight behind is shut, other sides are tried
  // before coming closer; nothing found = close behind and above at under 55 degrees of pitch, never straight overhead.
  const _ct = V3();
  const chase = (sx, sy, sz, ch, grab, yaw, d, snap) => {
    const rg = !ch && !grab && !!F.rag, hiK = ch ? clamp((sz - Math.max(0, top(sx, sy)) - 6) / 14, 0, 1) : 0, back = ch ? 8 : grab ? 5 : rg ? 5.4 : 7, up = ch ? 0.9 - 1.9 * hiK : rg ? 2.5 : 2.3; let ok = false; _ct.set(sx, sz + (ch ? 2.9 : rg ? 0.45 : 1.2), -sy);      // handover-2: under canopy nearer and, with air under him, from below his feet so he and the wing stand against the sky; down on the ground it looks at the body F.cyaw = null;
    // the pitched view: he looks DOWN by vd (g.cam.pitch, 0.12 taken off so the view on foot and the gun's pose agree with it). The camera rides a circle round his chest from 43 degrees below him to 34 above; past those stops the view tilts on in place, to 56 degrees down (the street under him is in the picture) and 80 up (the canopy from below).
    const cp = ch && CPITCH && !!g.cam && typeof g.cam.pitch === 'number', vd = cp ? clamp(g.cam.pitch - 0.12, -1.4, 1.05) : 0, el = clamp(vd, -0.75, 0.6), cb = Math.cos(el), sb = Math.sin(el);
    if (cp) F.cvd = vd;
    out: for (const f of [1, 0.8, 0.62, 0.46, 0.32]) for (const dy of f > 0.5 ? [0, 0.45, -0.45, 0.9, -0.9] : [0, 0.45, -0.45, 0.9, -0.9, 1.6, -1.6, 2.4, -2.4, 3.14]) {
      const bk = cp ? back * cb : back, x = sx - Math.cos(yaw + dy) * bk * f, y = sy - Math.sin(yaw + dy) * bk * f; let z = sz + (ch ? up + (1 - f) * 1.2 : up * (0.6 + 0.4 * f)); if (cp) { z = sz + 1.6 + back * f * sb; const gz = top(x, y); if (gz < sz + 1 && z < Math.max(0, gz) + 0.6) z = Math.max(0, gz) + 0.6; }      /* never under the street or a roof below him */ if (sees(x, y, z, sx, sy, sz)) { _ca.set(x, z, -y); ok = true; if (dy) F.cyaw = yaw + dy; break out; } }
    if (!ok) { F.blind = (F.blind || 0) + 1; for (const dy of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, 3.14]) { const x = sx - Math.cos(yaw + dy) * 1.3, y = sy - Math.sin(yaw + dy) * 1.3; if (clearAt(x, y, sz + 2.3)) { _ca.set(x, sz + 2.3, -y); ok = true; break; } }
      if (!ok) _ca.set(sx - Math.cos(yaw) * 0.9, Math.max(sz, top(sx, sy)) + 2.4, -(sy - Math.sin(yaw) * 0.9)); }
    if (cp) { let hx = sx - _ca.x, hz = -sy - _ca.z; const hl2 = Math.hypot(hx, hz); if (hl2 > 0.3) { hx /= hl2; hz /= hl2; } else { hx = Math.cos(yaw); hz = -Math.sin(yaw); } const cv = Math.cos(vd); _ct.set(_ca.x + hx * cv * 10, _ca.y - Math.sin(vd) * 10, _ca.z + hz * cv * 10); } else
    if (ch) { const dd = Math.hypot(_ca.x - sx, _ca.z + sy); _ct.y = sz + 1.2 + 1.3 * clamp((dd - 2) / 4, 0, 1); }      /* helper 4: a camera pushed close by a wall looks at him, not up into the cloth */
    if (snap || !d) { _ck.copy(_ca); _cc.copy(_ct); } else { const r = Math.min(1, d * (cp ? 14 : 7)); _cc.lerp(_ct, r); _ck.lerp(_ca, r); if (!clearAt(_ck.x, -_ck.z, _ck.y)) _ck.copy(_ca); } };
  const camClear = () => { const cam = g.world && g.world.camera; if (!cam || !(F.a || F.camOn || (pl.roof && pl.alt > 1 && onFoot() && !G.phase))) return;      // (stage H) whoever placed it (ours, the blend, the game's own on a roof)
    const p = cam.position, hs = hl && hl.heights, keep = hs && hs.last; try { if (clearAt(p.x, -p.z, p.y)) return; const a = F.a, sx = a ? a.x : pl.x, sy = a ? a.y : pl.y, sz = (a ? a.z : pl.alt) + 1.5;
      for (const f of [0.85, 0.7, 0.55, 0.42, 0.3, 0.2, 0.1]) { const x = sx + (p.x - sx) * f, y = sy + (-p.z - sy) * f, z = sz + (p.y - sz) * f; if (clearAt(x, y, z)) { p.set(x, z, -y); F.pulls = (F.pulls || 0) + 1; return; } } F.shut = (F.shut || 0) + 1; } finally { if (hs) hs.last = keep; } };
  const camF = (dt) => {
    const cam = g.world && g.world.camera, C = g.cam; if (!cam || !C) return; const a = F.a, d = dt > 0 ? Math.min(dt, 0.1) : 0; let P = F.post;
    if (a) { P = F.post = null; if (!F.camOn) { F.camOn = true; F.cw = 0; F.csnap = true; } } else if (F.camOn && !P) { P = F.post = { t: 0, rel: -1, ok: 0, x: pl.x, y: pl.y }; F.landT = 0; }
    if (!F.camOn) { F.cw = 0; return; }
    if (P) { P.t += d; const jumped = Math.hypot(pl.x - P.x, pl.y - P.y) > 3; P.x = pl.x; P.y = pl.y;
      if (jumped || pl.vehicle || (hl && (hl.piloted || hl.hasCamera)) || (g.fly && g.fly.on)) { F.camOn = false; F.post = null; F.cw = 0; return; }      // the game moved him (the clinic) or he took a seat: its camera at once
      if (P.rel < 0 && G.phase) P.rel = 0; }
    F.cw = Math.min(1, F.cw + d * 9); if (typeof C.yaw !== 'number') return;
    const hs = hl && hl.heights, keep = hs && hs.last; _cg.copy(cam.position); _qg.copy(cam.quaternion); let w = F.cw;
    try {
      { const ci = g.combat && g.combat.inp; F.gunT = ci && (ci.fire || ci.aim) ? 0.7 : Math.max(0, (F.gunT || 0) - d); }
      if (a) { const ch = a.mode === 'chute'; if (ch && !(F.gunT > 0)) C.yaw += wrapPi(a.hd - C.yaw) * Math.min(1, d * 2.2); chase(a.x, a.y, a.z, ch, a.mode === 'grab', C.yaw, d, F.csnap); }
      else { const sz = pl.alt > 0.02 ? pl.alt : 0; chase(pl.x, pl.y, sz, false, false, C.yaw, d, false);
        if (P.rel < 0) { const see = sees(_cg.x, -_cg.z, _cg.y, pl.x, pl.y, sz); P.ok = see && !F.rag && (P.t > 1.5 || framed(cam, _cg, _qg, pl.x, pl.y, sz)) ? P.ok + 1 : 0; if (P.ok >= 2 && P.t > 0.25) P.rel = 0; else if (F.cyaw != null) C.yaw += wrapPi(F.cyaw - C.yaw) * Math.min(1, d * 4); }      // (stage F) the game's own view as soon as it has him with a clear line; until then ours, turning the player's view to the open side
        else { P.rel += d / 0.4; if (P.rel >= 1) { F.camOn = false; F.post = null; F.cw = 0; return; } }
        w *= 1 - ease(Math.max(0, P.rel)); }
    } finally { if (hs) hs.last = keep; }
    F.csnap = false; cam.position.copy(_ck); cam.lookAt(_cc); _qm.copy(cam.quaternion);
    cam.position.lerpVectors(_cg, _ck, w); cam.quaternion.copy(_qg).slerp(_qm, w); };

  const K = { T: THREE, Rig: null, rig: null, rigVis: null, saved: null, grp: null, can: null, lines: null, clock: 0 };
  const TOUCH = ['hips', 'spine', 'chest', 'chest2', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  if (typeof document !== 'undefined') import('../entry/rig.js').then((m) => { K.Rig = m.EntryRig; }).catch((e) => fail('rig', e));
  const unpose = () => { const Sv = K.saved; if (!Sv || !Sv.live || !K.rig) return; const B = K.rig.B; for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) b.quaternion.copy(Sv[i]); } Sv.live = false; };
  const _bu = V3(), _bk = V3(), _t2 = V3(), _sd = V3(), mix = (p, q, j) => p + (q - p) * j;
  const pose = (dt) => {
    const a = F.a, vis = pl.vis, o = vis && vis.object, R = a ? null : F.rag; if (!o || pl.vehicle || (!a && !(F.stum > 0) && !R)) return; if (a) o.position.y = pl.alt;
    if (!K.Rig) return; if (K.rigVis !== vis) { K.rigVis = vis; K.saved = null; try { K.rig = new K.Rig(vis, vis.name || 'player'); } catch (e) { K.rig = null; fail('rig', e); } }
    const rig = K.rig; if (!rig || !rig.ok) return; const B = rig.B; o.updateMatrixWorld(true);
    { const Sv = K.saved || (K.saved = TOUCH.map(() => new THREE.Quaternion())); for (let i = 0; i < TOUCH.length; i++) { const b = B[TOUCH[i]]; if (b) Sv[i].copy(b.quaternion); } Sv.live = true; }
    _fw.set(Math.cos(pl.h), 0, -Math.sin(pl.h)); _rt.set(Math.sin(pl.h), 0, Math.cos(pl.h)); _ax.copy(_rt).multiplyScalar(-1); const t = K.clock;
    if (R) {      // down after a long fall (handover-2): over onto his front and a quarter onto one side, one arm thrown past the head and the other by the hip, one leg straight and one knee drawn up; a soft shadow under him; then up through a push of both hands
      const dn = ease(R.t / T_TUM), upk = ease((R.t - T_LIE) / T_UP2), e = dn * (1 - upk), bounce = R.t < T_TUM * 2 ? Math.sin(Math.PI * clamp((R.t - T_TUM) / T_TUM, 0, 1)) * 0.07 : 0, lean = 1.5 * e, breathe = Math.sin(t * 2.1) * 0.012 * e, m = R.sd, y0 = o.position.y;
      o.position.y += bounce - (0.86 * Math.sin(lean) - 0.12 * Math.sin(Math.PI * upk)); rig.tilt(_q.setFromAxisAngle(_ax, lean + breathe)); rig.tilt(_q.setFromAxisAngle(_fw, m * (0.5 * Math.sin(Math.PI * dn) * (1 - upk) + 0.3 * e)));
      if (typeof rig.bend === 'function') rig.bend(_up, m * 0.4 * e); o.updateMatrixWorld(true);
      _bu.copy(_up).multiplyScalar(Math.cos(lean)).addScaledVector(_fw, Math.sin(lean)); _bk.copy(_up).multiplyScalar(Math.sin(lean)).addScaledVector(_fw, -Math.cos(lean));
      const push = Math.sin(Math.PI * upk), pw = Math.min(1, e + push * 0.6), sA = m > 0 ? 'R' : 'L', sB = m > 0 ? 'L' : 'R';
      const armT = (s, sd, up, bk) => { if (!B['upper_arm_' + s]) return; rig.pos('upper_arm_' + s, _a); _b.copy(_a).addScaledVector(_rt, sd).addScaledVector(_bu, up).addScaledVector(_bk, bk); _pole.copy(_rt).multiplyScalar(s === 'L' ? -1 : 1).addScaledVector(_bu, -0.3).addScaledVector(_bk, 0.35); rig.arm(s, _b, _pole, pw); };
      const legT = (s, sd, up, bk) => { if (!B['thigh_' + s] || !B['foot_' + s] || typeof rig.leg !== 'function') return; rig.pos('thigh_' + s, _a); _b.copy(_a).addScaledVector(_rt, sd).addScaledVector(_bu, up).addScaledVector(_bk, bk); _pole.copy(_rt).multiplyScalar(s === 'L' ? -1 : 1).addScaledVector(_bk, -0.35 - push); _t2.copy(_rt).multiplyScalar(s === 'L' ? -1 : 1).addScaledVector(_fw, -0.5); rig.leg(s, _b, _pole, _t2, 0, e); };
      armT(sA, m * mix(0.2, 0.3, push), mix(0.44, 0.02, push), mix(-0.1, -0.3, push)); armT(sB, -m * mix(0.38, 0.3, push), mix(-0.26, 0.02, push), mix(-0.08, -0.3, push));
      legT(sA, m * 0.12, -0.88, -0.02); legT(sB, -m * 0.42, mix(-0.46, -0.6, push), -0.06);
      { const bl = K.blob || mkBlob(); if (bl && B.hips) { rig.pos('hips', _a); bl.visible = e > 0.02; bl.position.set(_a.x + _fw.x * 0.3 * e, y0 + 0.02, _a.z + _fw.z * 0.3 * e); bl.rotation.y = pl.h; bl.scale.set(0.55 + 0.8 * e, 1, 0.62); bl.material.uniforms.uK.value = 0.3 + 0.32 * e; } }
      return; }
    if (!a) { rig.tilt(_q.setFromAxisAngle(_ax, Math.sin(Math.PI * clamp(1 - F.stum / 0.5, 0, 1)) * 0.75)); return; }      // the stumble after a hard landing
    if (a.mode === 'grab') { const q = a.g; for (const s of ['L', 'R']) { _b.set(a.x + q.ux * 0.3, q.tz + 0.05, -(a.y + q.uy * 0.3)).addScaledVector(_rt, s === 'L' ? -0.24 : 0.24); _pole.copy(_rt).multiplyScalar(s === 'L' ? -1 : 1).addScaledVector(_fw, -0.5); rig.arm(s, _b, _pole, 1); } return; }
    // limbs placed in his own body frame: _sd (his right), _bu (hips to head), _bk (out of his back)
    const frame = (lean, roll) => { _bu.copy(_up).multiplyScalar(Math.cos(lean)).addScaledVector(_fw, Math.sin(lean)); _bk.copy(_up).multiplyScalar(Math.sin(lean)).addScaledVector(_fw, -Math.cos(lean)); _sd.copy(_rt); if (roll) { _q.setFromAxisAngle(_fw, roll); _bu.applyQuaternion(_q); _bk.applyQuaternion(_q); _sd.applyQuaternion(_q); } };
    const arm = (s, sd, up, bk, w) => { if (!B['upper_arm_' + s]) return; rig.pos('upper_arm_' + s, _a); _b.copy(_a).addScaledVector(_sd, sd).addScaledVector(_bu, up).addScaledVector(_bk, bk); _pole.copy(_sd).multiplyScalar(s === 'L' ? -1 : 1).addScaledVector(_bu, -0.5).addScaledVector(_bk, 0.3); rig.arm(s, _b, _pole, w); };
    const leg = (s, sd, up, bk, w, toe) => { if (!B['thigh_' + s] || !B['foot_' + s] || typeof rig.leg !== 'function') return; rig.pos('thigh_' + s, _a); _b.copy(_a).addScaledVector(_sd, sd).addScaledVector(_bu, up).addScaledVector(_bk, bk); _pole.copy(_bk).multiplyScalar(-1).addScaledVector(_sd, s === 'L' ? -0.4 : 0.4); _t2.copy(_fw).addScaledVector(_bu, -0.6); rig.leg(s, _b, _pole, _t2, toe == null ? 0.5 : toe, w); };
    if (a.mode === 'chute') {      // under canopy (handover-2): he hangs by the shoulders from the risers and swings under them like a weight on a string (two damped springs: roll follows the wing's bank late and overshoots, pitch starts at the fall's lean, so the opening swings his legs through); hands up and out on the toggles, the turn's hand (both on S) pulled down to the chest; legs loose, one knee a little forward, trailing the swing
      const w = ease(a.chT * 2.5), bank = K.bank || 0, tl = clamp(F.mx || 0, -1, 1), br = (F.my || 0) < -0.3 ? 1 : 0, gun = F.gunT > 0, h = Math.min(dt, 0.05);
      if (K.swA !== a) { K.swA = a; K.sp = clamp(K.lean || 0.6, 0, 1.3); K.spv = 0; K.sr = 0; K.srv = 0; K.pL = 0; K.pR = 0; }
      K.spv += ((-0.05 - 0.12 * br - K.sp) * 16 - K.spv * 2.4) * h; K.sp += K.spv * h; K.srv += ((bank * 1.15 - K.sr) * 12 - K.srv * 1.6) * h; K.sr += K.srv * h;
      K.pL += ((gun ? 0 : Math.max(br, tl)) - K.pL) * Math.min(1, h * 9); K.pR += ((gun ? 0 : Math.max(br, -tl)) - K.pR) * Math.min(1, h * 9);
      const sp = K.sp + Math.sin(t * 1.3) * 0.03, sr = K.sr + Math.sin(t * 0.9 + 1) * 0.025;
      rig.tilt(_q.setFromAxisAngle(_ax, sp)); rig.tilt(_q.setFromAxisAngle(_fw, sr)); o.updateMatrixWorld(true); frame(sp, sr);
      if (B.upper_arm_L && B.upper_arm_R) { rig.pos('upper_arm_L', _a); rig.pos('upper_arm_R', _b); _a.add(_b).multiplyScalar(0.5); o.position.x += a.x - _a.x; o.position.y += a.z + 1.42 - _a.y; o.position.z += -a.y - _a.z; o.updateMatrixWorld(true); }
      if (!gun) { arm('L', -(0.27 + 0.05 * K.pL), 0.42 - 0.5 * K.pL, -0.05 - 0.1 * K.pL, w); arm('R', 0.27 + 0.05 * K.pR, 0.42 - 0.5 * K.pR, -0.05 - 0.1 * K.pR, w); }
      const lgS = clamp(-K.srv * 0.06, -0.2, 0.2), lgP = clamp(K.spv * 0.06, -0.25, 0.25);
      const LL = (rig.thigh + rig.shin) || 0.9;      /* helper 4: the legs hang at the rig's own leg length (a fixed 0.86 m bent the knees) */
      leg('L', -0.08 + lgS, -0.965 * LL, 0.02 + lgP + Math.sin(t * 1.3 + 0.6) * 0.04, w, -0.45); leg('R', 0.09 + lgS, -0.925 * LL, -0.12 + lgP + Math.sin(t * 1.3 + 2.1) * 0.04, w, -0.45);
      if (!gun && typeof rig.look === 'function' && B.head) { _t2.copy(_fw); _t2.y = -0.3; rig.look(_t2, w * 0.7); }
      if (B.upper_arm_L && B.upper_arm_R && B.hand_L && B.hand_R) { const H = K.hang || (K.hang = { sL: V3(), sR: V3(), hL: V3(), hR: V3(), ch: V3(), bu: V3(), bk: V3(), sd: V3(), ok: 0 }); o.updateMatrixWorld(true);
        rig.pos('upper_arm_L', H.sL).addScaledVector(_bu, 0.08); rig.pos('upper_arm_R', H.sR).addScaledVector(_bu, 0.08); rig.pos('hand_L', H.hL); rig.pos('hand_R', H.hR); rig.pos(B.chest2 ? 'chest2' : 'chest', H.ch); H.bu.copy(_bu); H.bk.copy(_bk); H.sd.copy(_sd); H.ok = 2; H.gun = gun; }
      return; }
    // falling (handover-2): belly to the ground in a second and fighting the air: the trunk rocks and twists, the arms wheel out of step, the legs pedal; a jump starts as a running leap (one arm and knee forward) and turns into the fall
    const w = ease(a.t * 4), j = (a.from === 'jump' || a.from === 'hop') && !a.used ? 1 - ease((a.t - 0.4) / 0.45) : 0, fl = (1 - j) * w, lean = (mix(Math.min(1.4, 0.35 + Math.max(0, -a.vz - 2) * 0.1), 0.2, j) + Math.sin(t * 2.3 + 0.7) * 0.22 * (1 - j)) * w, roll = (Math.sin(t * 3.1) * 0.34 + Math.sin(t * 1.3 + 2) * 0.2) * fl;
    K.lean = lean; rig.tilt(_q.setFromAxisAngle(_ax, lean)); rig.tilt(_q.setFromAxisAngle(_fw, roll)); frame(lean, roll); if (typeof rig.bend === 'function') rig.bend(_bu, Math.sin(t * 5.1) * 0.4 * fl); o.updateMatrixWorld(true);
    const pL = t * 8.4, pR = t * 7.1 + 2.2, qL = t * 7.7, qR = qL + 3.14 + 0.5 * Math.sin(t * 1.7);
    arm('L', mix(-0.4 - 0.16 * Math.cos(pL), -0.2, j), mix(0.22 + 0.3 * Math.sin(pL), 0.28, j), mix(0.05 + 0.22 * Math.cos(pL + 1.2), -0.45, j), w); arm('R', mix(0.4 + 0.16 * Math.cos(pR), 0.26, j), mix(0.22 + 0.3 * Math.sin(pR), -0.3, j), mix(0.05 + 0.22 * Math.cos(pR + 1.2), 0.3, j), w);
    leg('L', mix(-0.2 - 0.08 * Math.sin(qL), -0.1, j), mix(-0.62 + 0.14 * Math.cos(qL), -0.5, j), mix(0.2 + 0.3 * Math.sin(qL), -0.4, j), w); leg('R', mix(0.2 + 0.08 * Math.sin(qR), 0.1, j), mix(-0.62 + 0.14 * Math.cos(qR), -0.72, j), mix(0.2 + 0.3 * Math.sin(qR), 0.38, j), w); };
  const mkBlob = () => { const sc = g.world && g.world.scene; if (!sc || !sc.add) return null; const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3)); geo.setIndex([0, 2, 1, 0, 3, 2]);      // the soft ground shadow the game gives a lying body (combat/people.js BLOB_*)
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, uniforms: { uK: { value: 0.6 } }, vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform float uK; varying vec2 vQ; void main(){ float d = length(vQ); float a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(0.0, 0.0, 0.0, uK * a * a * (0.6 + 0.8 * a)); }' });
    const bl = new THREE.Mesh(geo, mat); bl.frustumCulled = false; bl.visible = false; sc.add(bl); K.blob = bl; return bl; };

  // the canopy (handover-2): a nine-cell ram-air wing built as real cells: each cell's top skin bulges between its ribs and is lit by the game's sun (the creases at the ribs show the cells), the under skin is
  // drawn as cloth with light coming through (bright mid-cell, dark at the seams), open dark mouths at the nose, tip ribs and stabilisers. Thin lines (one pixel) fan from four risers to the ribs; the risers
  // end ON HIS SHOULDERS (read from his bones every frame), a slider sits on them, a brake line runs from each hand to the tail and pulls that side of the tail down. A pack on his back.
  const NC = 9, SPAN = 6.6, CH = 2.7, ARC = (u) => 5.6 - u * u * 3.6, thick = (s) => 0.02 + 0.34 * (s < 0.22 ? 0.55 + 0.45 * Math.sin(Math.PI / 2 * s / 0.22) : Math.pow(Math.cos(Math.PI / 2 * (s - 0.22) / 0.78), 1.3));
  const build = () => { const sc = g.world && g.world.scene; if (!sc || !sc.add) return null; const grp = new THREE.Group(), g2 = new THREE.Group(), MM = 6, SS = [0, 0.04, 0.1, 0.22, 0.38, 0.55, 0.72, 0.86, 1], sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k], DARK = [0.05, 0.04, 0.04];
    const set = () => ({ pos: [], col: [], fw: [], bw: [], idx: [] }), TOPS = set(), UND = set();
    const vtx = (S, u, s, y, c, f, b, dx) => { S.pos.push(CH * (0.45 - s) - (dx || 0), y, u * SPAN); S.col.push(c[0], c[1], c[2]); S.fw.push(f); S.bw.push(b); return S.pos.length / 3 - 1; };
    const grid = (S, rows) => { for (let r = 0; r + 1 < rows.length; r++) for (let k = 0; k + 1 < rows[r].length; k++) S.idx.push(rows[r][k], rows[r + 1][k], rows[r + 1][k + 1], rows[r][k], rows[r + 1][k + 1], rows[r][k + 1]); };
    const yT = (u, s, bl) => ARC(u) + thick(s) + 0.16 * bl * (1 - 0.55 * s), yB = (u, s, bl) => ARC(u) - 0.07 * bl * (1 - 0.6 * s);
    for (let i = 0; i < NC; i++) { const u0 = i / NC - 0.5, du = 1 / NC, base = i === 0 || i === NC - 1 ? [0.07, 0.11, 0.26] : i >= 3 && i <= 5 ? [0.97, 0.95, 0.9] : [0.95, 0.27, 0.06], tip = 1 - Math.abs(u0 + du / 2) * 0.3, tp = [], bt = [], mo = [[], []];
      for (let m = 0; m <= MM; m++) { const v = m / MM, u = u0 + du * v, bl = Math.sin(Math.PI * v), rt = [], rb = [];
        for (const s of SS) { rt.push(vtx(TOPS, u, s, yT(u, s, bl), sh(base, (0.62 + 0.38 * bl) * tip * (1 - 0.14 * s)), s * s, bl)); rb.push(vtx(UND, u, s, yB(u, s, bl), sh(base, (0.42 + 0.5 * Math.pow(bl, 0.7)) * (0.86 + 0.14 * (1 - s))), s * s, -0.45 * bl)); }
        tp.push(rt); bt.push(rb); mo[0].push(vtx(UND, u, 0, yT(u, 0, bl), DARK, 0, bl, 0.03)); mo[1].push(vtx(UND, u, 0, yB(u, 0, bl), DARK, 0, -0.45 * bl, 0.03)); }
      grid(TOPS, tp); grid(UND, bt); grid(UND, mo);
      for (const u of i === NC - 1 ? [u0, u0 + du] : [u0]) { const ra = [], rb = [], edge = u === -0.5 || Math.abs(u - 0.5) < 1e-6; for (const s of SS) { ra.push(vtx(edge ? TOPS : UND, u, s, yT(u, s, 0), edge ? sh(base, 0.8) : sh(base, 0.22), s * s, 0)); rb.push(vtx(edge ? TOPS : UND, u, s, yB(u, s, 0), edge ? sh(base, 0.6) : DARK, s * s, 0)); } grid(edge ? TOPS : UND, [ra, rb]); } }      // the ribs (the two tip ribs are lit)
    for (const sd of [-1, 1]) { const u = sd * 0.5, c = [0.07, 0.11, 0.26], a0 = vtx(UND, u, 0.12, yB(u, 0.12, 0), sh(c, 0.75), 0, 0), a1 = vtx(UND, u, 0.82, yB(u, 0.82, 0), sh(c, 0.75), 0.4, 0), a2 = vtx(UND, u + sd * 0.012, 0.45, yB(u, 0.45, 0) - 0.6, sh(c, 0.55), 0.2, 0); UND.idx.push(a0, a1, a2); }      // the stabilisers
    const mesh = (S, mat) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(S.col, 3)); geo.setIndex(S.idx); geo.computeVertexNormals(); const me = new THREE.Mesh(geo, mat); me.frustumCulled = false; me.castShadow = false; grp.add(me); return { me, base: Float32Array.from(S.pos), fw: S.fw, bw: S.bw }; };
    const Std = THREE.MeshStandardMaterial || THREE.MeshLambertMaterial; K.skins = [mesh(TOPS, new Std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 })), mesh(UND, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }))]; K.und = K.skins[1].me;
    // where the lines meet the wing: four rows on every rib of a side; the brake lines on the tail
    K.att = []; K.brk = []; for (const sd of [-1, 1]) { for (let r = 0; r < 4; r++) for (const i of sd < 0 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]) { const u = i / NC - 0.5, s = [0.06, 0.3, 0.58, 0.85][r]; K.att.push([CH * (0.45 - s), yB(u, s, 0), u * SPAN, sd, r < 2 ? 0 : 1]); } for (const uu of [0.1, 0.25, 0.4]) K.brk.push([CH * (0.45 - 1), ARC(uu) + 0.02, sd * uu * SPAN, sd]); }
    const NL = K.att.length + 8, lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NL * 6), 3)); const ln = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe4e1d8, transparent: true, opacity: 0.62, fog: false })); ln.frustumCulled = false; g2.add(ln);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((4 * 12 + 6) * 3), 3)); const rs = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x14181f, side: THREE.DoubleSide, fog: false })); rs.frustumCulled = false; g2.add(rs);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.12), new Std({ color: 0x23272e, roughness: 0.7, metalness: 0 })); pack.frustumCulled = false; g2.add(pack);
    grp.rotation.order = 'YXZ'; grp.visible = false; g2.visible = false; sc.add(grp); sc.add(g2); K.grp = grp; K.g2 = g2; K.ln = ln; K.rs = rs; K.pack = pack; return grp; };
  const _l0 = V3(), _l1 = V3(), _l2 = V3(), _lt = [V3(), V3(), V3(), V3()], _mb = new THREE.Matrix4(), _n3 = V3();
  // the lines, risers, slider and pack, laid from the wing as drawn (grp's matrix) to his shoulders and hands as posed; without a posed body (the fold on the ground, a missing rig) to where his shoulders would be
  const rigging = (ox, oy, oz, hd, slack) => { const grp = K.grp, H = K.hang, live = H && H.ok > 0, P = K.ln.geometry.attributes.position, A = P.array, RP = K.rs.geometry.attributes.position, RA = RP.array; grp.updateMatrix(); const M = grp.matrix; K.g2.position.set(ox, oy, oz); let n = 0, rn = 0;
    const fx = Math.cos(hd), fz = -Math.sin(hd), rx = Math.sin(hd), rz = Math.cos(hd), put = (p, q) => { A[n++] = p.x - ox; A[n++] = p.y - oy; A[n++] = p.z - oz; A[n++] = q.x - ox; A[n++] = q.y - oy; A[n++] = q.z - oz; };
    const tri = (p, q, r) => { for (const v of [p, q, r]) { RA[rn++] = v.x - ox; RA[rn++] = v.y - oy; RA[rn++] = v.z - oz; } }, band = (p, q, wx, wz) => { for (const [ax, az] of [[wx, 0], [0, wz]]) { _l0.set(p.x - ax * rx - az * fx, p.y, p.z - ax * rz - az * fz); _l1.set(p.x + ax * rx + az * fx, p.y, p.z + ax * rz + az * fz); _l2.set(q.x + ax * rx + az * fx, q.y, q.z + ax * rz + az * fz); tri(_l0, _l1, _l2); _l1.set(q.x - ax * rx - az * fx, q.y, q.z - ax * rz - az * fz); tri(_l0, _l2, _l1); } };
    const sho = (sd, out) => live ? out.copy(sd < 0 ? H.sL : H.sR) : out.set(ox + rx * sd * 0.2, oy + 1.45, oz + rz * sd * 0.2);
    for (const sd of [-1, 1]) for (const r of [0, 1]) { const S = sho(sd, _a), T = _lt[(sd < 0 ? 0 : 2) + r]; _b.set(CH * (0.45 - (r ? 0.74 : 0.2)), 5.3, sd * 1.5).applyMatrix4(M); T.copy(_b).sub(S); const L = T.length() || 1; T.multiplyScalar(Math.min(0.55, L * 0.3) / L).add(S); band(S, T, 0.016, 0.016); }
    for (let i = rn; i < rn + 18; i++) RA[i] = 0;      // helper 4: no slider drawn (it read as a trapeze bar over his head)
    for (const q of K.att) { _b.set(q[0], q[1], q[2]).applyMatrix4(M); put(_lt[(q[3] < 0 ? 0 : 2) + q[4]], _b); }
    for (const sd of [-1, 1]) { const T = _lt[(sd < 0 ? 0 : 2) + 1], hand = live && !H.gun ? (sd < 0 ? H.hL : H.hR) : T; _cv.set(CH * (0.45 - 0.92), 3.9, sd * 1.45).applyMatrix4(M); put(hand, _cv); for (const q of K.brk) if (q[3] === sd) { _b.set(q[0], q[1], q[2]).applyMatrix4(M); put(_cv, _b); } }
    P.needsUpdate = true; RP.needsUpdate = true; K.ln.material.opacity = 0.62 * (1 - (slack || 0));
    const pk = K.pack; pk.visible = !!live; if (live) { pk.position.set(H.ch.x - ox, H.ch.y - oy, H.ch.z - oz).addScaledVector(H.bk, 0.19).addScaledVector(H.bu, -0.1); _n3.crossVectors(H.sd, H.bu); pk.quaternion.setFromRotationMatrix(_mb.makeBasis(H.sd, H.bu, _n3)); H.ok--; } };
  const drawCanopy = (dt) => {
    if (K.blob && !F.rag) K.blob.visible = false;
    const a = F.a, c = F.col, on = a && (a.mode === 'chute' || a.mode === 'stream'); if (!on && !c) { if (K.grp) { K.grp.visible = false; K.g2.visible = false; } K.bank = 0; return; }
    const grp = K.grp || build(); if (!grp) return; grp.visible = true; K.g2.visible = true; const t = K.clock, full = on && a.mode === 'chute' && a.k >= 1, pL = on ? K.pL || 0 : 0, pR = on ? K.pR || 0 : 0, limp = on ? 0 : Math.min(1, c.t / 0.5);
    { const amp = full ? 0.04 : 0.11 + 0.2 * limp, night = clamp((g.night && g.night.n) || 0, 0, 1); K.und.material.color.setScalar(1 - 0.78 * night);      // the tail flutters, the cells breathe, a pulled brake line bends its side of the tail down; folding, the cells go slack
      for (const S of K.skins) { const P = S.me.geometry.attributes.position, A = P.array, Bs = S.base, W = S.fw, Bw = S.bw; for (let i = 0; i < W.length; i++) { const x = Bs[i * 3], z = Bs[i * 3 + 2], u = z / SPAN;
        A[i * 3 + 1] = Bs[i * 3 + 1] + W[i] * (amp * Math.sin(t * 13 + z * 2.3 + x * 1.7) - 0.34 * (pL * clamp(-u * 2.6, 0, 1) + pR * clamp(u * 2.6, 0, 1))) + Bw[i] * (0.03 * Math.sin(t * 2.3 + z * 1.9) + 0.012 * Math.sin(t * 7.1 + z * 4.3) - 0.2 * limp * (0.6 + 0.4 * Math.sin(t * 9 + z * 3.1))); } P.needsUpdate = true; if (S.me !== K.und && (K.nrm = ((K.nrm || 0) + 1) % 3) === 0) S.me.geometry.computeVertexNormals(); } }
    if (on) { const st = a.mode === 'stream', v = st ? 0.1 : a.chT / 0.6, inf = ease((v - 0.55) / 0.45), sn = ease((v - 0.25) / 0.3), over = v > 0.55 && v < 1.3 ? Math.sin((v - 0.55) / 0.75 * Math.PI) * 0.08 : 0;      // the opening in 0.6 s: a streamer, the snivel, then the cells fill from the middle
      if (!st && v > 0.5 && K.snapA !== a) { K.snapA = a; if (g.cam) g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.3); }      // the snatch
      const span = 0.07 + 0.2 * sn + 0.73 * inf + over, shake = (1 - inf) * (st ? 1 : 1 - 0.4 * sn); K.bank = (K.bank || 0) + ((st ? 0 : -clamp(F.mx || 0, -1, 1) * 0.42 * inf) - (K.bank || 0)) * Math.min(1, dt * 3);
      grp.position.set(a.x, a.z, -a.y); grp.rotation.set(K.bank + Math.sin(t * 23) * 0.16 * shake + Math.sin(t * 0.9) * 0.035 * inf, a.hd + Math.sin(t * 0.6 + 2) * 0.03 * inf, (0.3 + Math.sin(t * 17) * 0.14) * shake + Math.sin(t * 1.1) * 0.03 * inf); grp.scale.set(0.3 + 0.25 * sn + 0.45 * inf + over * 0.5, 0.86 + 0.14 * inf, span + (st ? 0.02 * Math.sin(t * 31) : 0));
      K.fold = (K.fold || 0) + ((a.colT > 0 ? 1 : 0) - (K.fold || 0)) * Math.min(1, dt * 12); const lx = -Math.sin(a.hd), ly = Math.cos(a.hd), cs = a.colS || 1, fo = K.fold;      // (stage F) the folded side: the wing is drawn 45 % narrower and moved to the open side, and rolls down towards the wall
      if (fo > 0.01) { grp.scale.z *= 1 - 0.45 * fo; grp.position.x -= lx * cs * HALF * 0.45 * fo; grp.position.z += ly * cs * HALF * 0.45 * fo; grp.rotation.x += cs * 0.35 * fo; }
      if (!st && a.k >= 0.6) { let inw = 0; for (const sd of [1, -1]) { const e = HALF * (sd === cs ? 1 - 0.9 * fo : 1); if (top(a.x + lx * sd * e, a.y + ly * sd * e) > a.z + WING_Z + 0.3) inw = 1; } if (inw) F.wingIn = (F.wingIn || 0) + 1; }
      rigging(a.x, a.z, -a.y, a.hd, 0); }
    else { c.t += dt; const T = c.away ? 2.2 : 1.5, u = c.t / T; if (u >= 1) { F.col = null; grp.visible = false; K.g2.visible = false; return; }      // down on the landing (or left behind after the cut): the wing flies on over him, loses its air and comes down ahead of him, then is gone
      if (c.away) { c.x += c.vx * dt; c.y += c.vy * dt; c.z -= 2 * dt; grp.position.set(c.x, c.z, -c.y); grp.rotation.set(Math.sin(t * 9) * 0.5, c.hd, u * 1.2); grp.scale.set(1 - 0.5 * u, 1 - 0.6 * u, Math.max(0.05, c.k * (1 - u))); K.g2.visible = false; }
      else { const sw = ease(u / 0.7), out = 1 - ease((u - 0.8) / 0.2), fl = ease((u - 0.12) / 0.55), fwd = 3.6 * sw;      // helper 4: it flies on ahead of him, the nose drops and the cells empty flat onto the ground (it used to stand on its edge like a board)
        grp.position.set(c.x + Math.cos(c.hd) * fwd, c.z, -c.y - Math.sin(c.hd) * fwd); grp.rotation.set(Math.sin(t * 5) * 0.1 * sw, c.hd + 0.25 * sw, -0.42 * Math.sin(Math.PI * Math.min(1, u / 0.6))); grp.scale.set((1 - 0.12 * sw) * out, Math.max(0.03, (1 - 0.95 * fl) * out), Math.max(0.1, c.k * (1 - 0.18 * sw) * out)); K.g2.visible = u < 0.8; if (u < 0.8) rigging(pl.x, pl.alt > 0.02 ? pl.alt : 0, -pl.y, pl.h, u / 0.8); } } };
  if (typeof g.syncVisuals === 'function') { const sync0 = g.syncVisuals.bind(g);
    g.syncVisuals = function (dt) { const d = dt > 0 ? Math.min(dt, 0.1) : 0.016; K.clock += d;
      try { camF(dt); camClear(); const cm = g.world && g.world.camera; if (cm && !F.a && F.landT != null && (F.landT += d) < 3) { cm.getWorldDirection(_cv); if (_cv.y < -0.866) F.over = (F.over || 0) + 1; } } catch (e) { fail('cam', e); } try { unpose(); } catch (e) { fail('unpose', e); }
      sync0(dt);
      try { pose(d); } catch (e) { fail('pose', e); } try { drawCanopy(d); } catch (e) { fail('canopy', e); } }; }
  F.K = K; F.build = build; F.drawCanopy = drawCanopy; F.camF = camF;
  F.CHUTE = CHUTE; F.FALLRAG = FALLRAG; F.CPITCH = CPITCH; F.N = { CH_MIN, RAG_V, T_TUM, T_LIE, T_UP2, SINK, GLIDE, TURN, FLARE };
  console.log('[grfree] on: no fence on roofs; SPACE on a roof jumps, SPACE in the air with 30 m under him opens the parachute (again = cut away; ?chute=0 off); a 12 m fall puts him down and he gets up (?fallrag=0 off); ?grfree=0 = all off');
  return F;
}
