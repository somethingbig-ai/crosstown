// move/grroof.js (gameplay lane, Nov 16): the police against a WANTED player the grappling hook has put on a roof. CHIEF: "no shots through walls.
// Cops on a hooked roof should come up the stairs or call the helicopter." Fetched by move/grapple.js only (so only with ?grapple=1); ?grroof=0 = never
// fetched, and grapple.js keeps its first rule (?grcop). Nothing in the police code is edited: the Heat object is wrapped from outside, the way
// combat/heatunder.js does it for the subway, and every wrapper passes straight through unless he is on a hooked roof or an officer is.
//  1. TRUE LINES. While he is on a hooked roof (or on the line), what an officer sees and what a round does is worked out in three dimensions
//     over the helicopter lane's height map (game.heli.heights): an officer at the foot of the wall neither sees him nor fires; one far enough back
//     to have his head and chest over the roof's edge does both. heatcore's own copShoot runs in a frame lowered by his height, with combat.cast
//     replaced for the length of the call by a cast over the height map: its aim, its spread, its damage and its "blocked, work round" stay its own.
//  2. THE STAIRS. 2.5 s after he is known to be up there, the two (from step 3: three) nearest officers on foot run to the wall's foot on their
//     side ("the door"), go out of sight for 3 s + the roof's height at 2.2 m/s (?grstair=<m/s>), and come out ON THE ROOF at the level spot of that
//     roof furthest from him (to 25 m), and fire their first round 1.6 to 2.4 s later. The level does not cool while they climb. They step out of a roof door that faces where he landed (below: THE ROOF DOOR; ?grdoor=0 = no door drawn, they appear there). From then on they are the heat code's
//     officers still (it decides when to close in, shout, fire or cuff); only where they walk (the roof, never off it) and what they see is ours.
//  3. THE HELICOPTER. From step 3 (?grheli=<step>, ?grheli=0 never) one police helicopter is called as well: 8 s, then in from 400 m, it circles
//     42 m off and 17 m above him, keeps him seen (the level does not cool while it has a line to him), and fires five rounds (2.2 degrees wide) every 3 to 4.5 s
//     while he STANDS on a roof inside 110 m. Drawn as the stand-in of combat/heatheli.js (copied here so this file needs nothing of that hand-over).
//  4. GETTING AWAY. Hook across: the officers on the old roof keep what line they truly have for 4 s, then walk back to their spot and go down
//     (2 s + height at 2.2 m/s) and are street officers again at the wall's foot; the new roof starts its own 2.5 s and its own climb. Hook down:
//     the same, and the helicopter keeps him seen from above for 20 s on the street (or until it has had no line for 12 s), then leaves for 30 s.
//  5. HIS OWN ROUNDS from a hooked roof: combat.cast's walls have no top, so they all stopped at the edge of his own roof. While he stands on a
//     hooked roof a wall met above the real top of what stands there no longer stops his round: he can fire down at the street and up at the
//     helicopter (13 carbine hits bring it down; the next comes 75 s later).
import * as THREE from 'three';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _o = {};
const REACT = 2.5, HIDE = -60, FAR = 25, HDMG = [0, 4, 4.5, 5, 6, 7];
const FAN = [0, 0.6, -0.6, 1.2, -1.2], FAN2 = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8], HW = 1.3, HD = 1.5, HH = 2.5;      // the stair-head box: half width, half depth, height (m)

export function install(game, G, K) {
  const g = game, pl = g.player, st = g.statics, P = g.P, top = K.top, num = (k, d) => (P.has(k) && P.get(k) !== '' && isFinite(+P.get(k)) ? +P.get(k) : d);
  const DOOR = P.get('grdoor') !== '0', HATCH = P.get('grdoor') === 'hatch' /* test: always the hatch, never the box */, LOOK = P.get('grhelilook') !== '0';      /* handover-4: the roof door (?grdoor=0) and the helicopter's police look and low hover (?grhelilook=0); both off = handover-3 */
  const STAIR = clamp(num('grstair', 2.2), 0.5, 20), HELI_L = P.get('grheli') === '0' ? 99 : clamp(num('grheli', 3), 1, 5);
  const R = { on: true, cops: [], roof: null, unit: null, nextHeli: 0, vis: null, fails: 0, huts: [], pend: null, door: DOOR, look: LOOK,
    stats: { roofs: 0, called: 0, arrived: 0, reach: [], noRoom: 0, wentDown: 0, shotsUp: 0, shotsRoof: 0, hitsUp: 0, hitsRoof: 0, blocked: 0, heliCalls: 0, heliShots: 0, heliHits: 0, heliLeft: 0, heliDown: 0, eyeTicks: 0, wallsOver: 0, huts: 0, hatches: 0, hutsGone: 0, hutReuse: 0, pushed: 0 } };
  const S = R.stats, heat = () => g.combat && g.combat.heat, fail = (w, e) => { if (R.fails++ < 4) console.warn('[grroof] ' + w + ': ' + String((e && e.stack) || e).slice(0, 400)); };
  // his height when it is not the street's: standing on a hooked roof, or on the line
  const plz = () => (G.phase ? Math.max(0, pl.alt || 0) : K.onMine() ? pl.alt : 0);
  const onR = (k) => !!k.gr && (k.gr.ph === 'up' || k.gr.ph === 'back'), hid = (k) => !!k.gr && (k.gr.ph === 'in' || k.gr.ph === 'out');
  const okAt = (x, y, z) => Math.abs(top(x, y) - z) < 0.7;
  // a clear straight line over the buildings between two points (map x, y, height): the height map every half metre
  const los3 = (ox, oy, oz, tx, ty, tz) => { const d = Math.hypot(tx - ox, ty - oy), n = Math.max(1, Math.ceil(d / 0.5));
    for (let i = 1; i < n; i++) { const u = i / n; if (u * d < 0.45 || (1 - u) * d < 0.45) continue; if (top(ox + (tx - ox) * u, oy + (ty - oy) * u) > oz + (tz - oz) * u + 0.05) return false; } return true; };
  R.los3 = los3;
  // the height of whoever stands at this place on the map: him, an officer on a roof, else the street
  const zOf = (x, y) => { if (Math.abs(x - pl.x) < 0.01 && Math.abs(y - pl.y) < 0.01) return plz(); for (const k of R.cops) if (onR(k) && Math.abs(x - k.x) < 0.01 && Math.abs(y - k.y) < 0.01) return k.gr.z; return 0; };
  const live = () => R.cops.length > 0 || plz() >= 1;
  // a round's way over the height map, in the true frame; the answer is given in the frame lowered by sh (what heatcore's copShoot works in)
  const cast3 = (ox, oy, oz, dx, dy, dz, tmin, tmax, sh) => { const h = { kind: 'none', t: tmax, x: ox + dx * tmax, y: oy + dy * tmax, z: oz + dz * tmax - sh, nx: -dx, ny: -dy, nz: -dz, obj: null, part: 'concrete' };
    const under = (s) => { const T = top(ox + dx * s, oy + dy * s); return oz + dz * s < (T > 0 ? T : 0) - 0.02; };
    let prev = tmin; for (let s = tmin + 0.5; s <= tmax; s += 0.5) { if (oz + dz * s > 420) break; if (under(s)) { let a = prev, b = s; for (let i = 0; i < 4; i++) { const m = (a + b) / 2; if (under(m)) b = m; else a = m; }
        const x = ox + dx * b, y = oy + dy * b, z = oz + dz * b, T = top(x, y), flat = dz < 0 && oz + dz * a >= (T > 0 ? T : 0) - 0.3, hl = Math.hypot(dx, dy) || 1;
        h.t = b; h.x = x; h.y = y; h.z = z - sh; h.kind = T > 0.6 ? 'wall' : 'ground'; if (flat) { h.nx = 0; h.ny = 0; h.nz = 1; } else { h.nx = -dx / hl; h.ny = -dy / hl; h.nz = 0; } return h; } prev = s; }
    return h; };
  const mark = (H) => { H.seen = true; H.unseenT = 0; H.coolT = 0; H.lkp.x = pl.x; H.lkp.y = pl.y; H.lkp.h = pl.h; H.lkp.t = H.t; H.lkp.vx = 0; H.lkp.vy = 0; S.eyeTicks++; };
  R.eye = () => { const U = R.unit; return !!U && U.mode === 'on' && U.dist < 260 && U.los; };
  // is an officer who came up within reach of him (the arrest: grapple.js lets it through only then)
  R.reach = () => { for (const k of R.cops) if (onR(k) && k.hp > 0 && Math.abs(k.gr.z - pl.alt) < 1 && Math.hypot(k.x - pl.x, k.y - pl.y) < 3.2) return true; return false; };

  // ------------------------------------------------------------------ the Heat object, wrapped once
  const wrap = (H) => { if (H._grRoof) return; H._grRoof = true; const c = H.c || g.combat;
    const los0 = H.los.bind(H), sight0 = H.sight.bind(H), shoot0 = H.copShoot.bind(H), walk0 = H.walkTo.bind(H), cover0 = H.coverNear.bind(H), clear0 = H.clearFrom.bind(H), think0 = H.think.bind(H), stepCop0 = H.stepCop.bind(H), pose0 = H.poseCop.bind(H);
    H.los = function (ax, ay, bx, by) { if (!live()) return los0(ax, ay, bx, by); for (const k of R.cops) if (hid(k) && ((Math.abs(ax - k.x) < 0.01 && Math.abs(ay - k.y) < 0.01) || (Math.abs(bx - k.x) < 0.01 && Math.abs(by - k.y) < 0.01))) return false;      /* a man on the stairs sees nothing */
      const za = zOf(ax, ay), zb = zOf(bx, by); if (za < 1 && zb < 1) return los0(ax, ay, bx, by); return los3(ax, ay, za + 1.6, bx, by, zb + 1.55); };
    // the helicopter's eye: he stays seen (and nobody shouts "lost him") while it has a line to him
    H.sight = function () { if (!(H.level > 0) || !R.eye()) return sight0(); const sh = H.shout; H.shout = () => {}; try { sight0(); } finally { H.shout = sh; } if (!H.seen) mark(H); };
    H.copShoot = function (k) { if (hid(k)) return false; const pz = plz(), kz = onR(k) ? k.gr.z : 0; if (pz < 1 && !kz) return shoot0(k);
      const sh = pz >= 1 ? pz - (st.onSidewalk(pl.x, pl.y) ? 0.15 : 0) : 0, fx = c.fx, muz0 = H.muzzleOf, cast0 = c.cast, hit0 = c.hit, imp0 = fx && fx.impact, sp0 = fx && fx.spawn, mzl0 = fx && fx.muzzle, n0 = H.stats.copShots, b0 = H.stats.blocked, h0 = H.stats.copHits;
      H.muzzleOf = function (kk, out) { muz0.call(H, kk, out); out.y -= sh; return out; };
      c.cast = function (ox, oy, oz, dx, dy, dz, tmin, tmax) { return cast3(ox, oy, oz + sh, dx, dy, dz, tmin, tmax, sh); };
      c.hit = function (h) { if (h && h.kind !== 'none' && fx && fx.impact) { try { fx.impact(_v.set(h.x, h.z, -h.y), _n.set(h.nx, h.nz, -h.ny), 'concrete', { power: 0.8 }); } catch (e) {} } return null; };
      if (fx) { if (imp0) fx.impact = function (p, ...a) { p.y += sh; try { return imp0.call(fx, p, ...a); } finally { p.y -= sh; } };
        if (sp0) fx.spawn = function (o) { if (o && typeof o.y === 'number') o.y += sh; return sp0.call(fx, o); };
        if (mzl0) fx.muzzle = function (p, ...a) { p.y += sh; try { return mzl0.call(fx, p, ...a); } finally { p.y -= sh; } }; }
      try { return shoot0(k); } finally { H.muzzleOf = muz0; c.cast = cast0; c.hit = hit0; if (fx) { if (imp0) fx.impact = imp0; if (sp0) fx.spawn = sp0; if (mzl0) fx.muzzle = mzl0; }
        const dn = H.stats.copShots - n0, dh = H.stats.copHits - h0; if (kz) { S.shotsRoof += dn; S.hitsRoof += dh; } else { S.shotsUp += dn; S.hitsUp += dh; } S.blocked += H.stats.blocked - b0; } };
    H.walkTo = function (k, tx, ty, sp, dt, stop) { if (hid(k)) return 0; if (!onR(k)) return walk0(k, tx, ty, sp, dt, stop);
      const z = k.gr.z, dx = tx - k.x, dy = ty - k.y, d = Math.hypot(dx, dy); k.z = z; if (d < stop || !(dt > 0)) return 0; const a0 = Math.atan2(dy, dx), s = Math.min(sp, d / dt) * dt;
      const free = !DOOR || k.gr.outT > 0 || k.gr.ph === 'back' || hutAt(k.x, k.y, z, 0.3);      /* stepping out of the door, going back in, or somehow inside: the box does not hold him */
      for (const da of DOOR ? FAN2 : FAN) { const a = a0 + da, x = k.x + Math.cos(a) * s, y = k.y + Math.sin(a) * s; if (!okAt(x, y, z) || !okAt(x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6, z)) continue; if (!free && hutAt(x, y, z, 0.3)) continue;
        k.x = x; k.y = y; if (!k.see || sp > 1.9) k.h += clamp(wrapPi(a - k.h), -dt * 9, dt * 9);
        for (const q of R.cops) if (q !== k && onR(q) && q.hp > 0) { const ex = k.x - q.x, ey = k.y - q.y, dd = Math.hypot(ex, ey); if (dd < 0.7 && dd > 1e-3) { const nx = k.x + (ex / dd) * (0.7 - dd) * 0.5, ny = k.y + (ey / dd) * (0.7 - dd) * 0.5; if (okAt(nx, ny, z)) { k.x = nx; k.y = ny; } } }
        return s / dt; }
      return 0; };
    H.coverNear = function (x, y, r, k, clear) { return k && k.gr ? null : cover0(x, y, r, k, clear); };
    H.clearFrom = function (x, y) { const pz = plz(); if (!live()) return clear0(x, y); const T = top(x, y), z = (T > 2.2 ? T : 0) + 1.3; return los3(x, y, z, pl.x, pl.y, pz + 1.2) || los3(x, y, z, pl.x, pl.y, pz + 1.6); };
    // where an officer on the roof may be sent: never off it
    const fixPost = (k) => { const q = k.gr; k.cover = null; k.path = null; if (q.ph === 'back') { k.post = q.hut ? { x: q.sx, y: q.sy } : { x: q.ex, y: q.ey }; k.mode = 'move'; return; }
      if (k.post && okAt(k.post.x, k.post.y, q.z)) return; const d = Math.hypot(pl.x - k.x, pl.y - k.y);
      if (Math.abs(plz() - q.z) < 0.7 && d > 10) { k.post = { x: k.x + (pl.x - k.x) * (d - 8) / d, y: k.y + (pl.y - k.y) * (d - 8) / d }; k.mode = 'move'; } else { k.post = { x: k.x, y: k.y }; if (k.mode !== 'hold') { k.mode = 'hold'; k.holdT = H.t + 2; } } };
    H.think = function (k) { think0(k); if (onR(k)) { try { fixPost(k); } catch (e) { fail('post', e); } } };
    H.stepCop = function (k, dt) { const q = k.gr; if (!q) return stepCop0(k, dt);
      if (hid(k)) { k.z = HIDE; k.see = false; k.saw = false; k.speed = 0; k.aim = 0; k.onT = 0; return; }
      if (q.ph === 'go') { k.post = { x: q.dx, y: q.dy }; k.cover = null; k.mode = 'move'; k.see = false; return stepCop0(k, dt); }      // running for the door: he does not stop to look up
      k.z = q.z; if (q.outT > 0) { /* out of the door: walks to his spot in front of it and looks at nothing else (a hatch: he rises through it first) */ q.outT -= dt; const rise = q.hut && q.hut.kind === 'hatch' ? clamp((q.outT - 1.8) / 0.8, 0, 1) : 0; k.see = false; k.cover = null; k.mode = 'move'; k.post = rise > 0 ? { x: k.x, y: k.y } : { x: q.ex, y: q.ey }; if (!rise && Math.hypot(k.x - q.ex, k.y - q.ey) < 0.35) q.outT = 0; const r = stepCop0(k, dt); k.z = q.z - 1.7 * rise; return r; }
      if (q.ph === 'back') { k.see = false; k.post = q.hut ? { x: q.sx, y: q.sy } : { x: q.ex, y: q.ey }; k.cover = null; k.mode = 'move'; } else if (k.mode === 'leave' || (k.post && !okAt(k.post.x, k.post.y, q.z))) fixPost(k);
      const r = stepCop0(k, dt); if (k.gr && onR(k)) k.z = q.z; return r; };
    H.poseCop = function (k, tx, ty, tz, dt) { const pz = plz(); if (pz >= 1 && H.seen) tz = pz + 1.25; return pose0(k, tx, ty, tz, dt); };
    // the player's own rounds against the helicopter
    if (c && typeof c.cast === 'function' && !c._grRoof) { c._grRoof = true; const cast0 = c.cast.bind(c), hit0 = c.hit.bind(c);
      c.cast = function (ox, oy, oz, dx, dy, dz, tmin, tmax) { let h = cast0(ox, oy, oz, dx, dy, dz, tmin, tmax); const U = R.unit; if (H.copFire) return h;
        /* HIS rounds from a hooked roof: combat.cast's walls are lines on the map with no top, so every round stopped at the edge of his own roof. A wall met ABOVE the real top of what stands there (the height map, half a metre before and after) is not there: the round goes on */
        if (oz > 2.5 && plz() >= 1) for (let i = 0; i < 8 && h.kind === 'wall'; i++) { const b = h.t; if (Math.max(top(ox + dx * (b - 0.5), oy + dy * (b - 0.5)), top(ox + dx * (b + 0.5), oy + dy * (b + 0.5))) > oz + dz * b - 0.2) break; S.wallsOver++; h = cast0(ox, oy, oz, dx, dy, dz, b + 0.05, tmax); }
        if (!U || U.mode === 'down') return h;
        const rx = U.x - ox, ry = U.y - oy, rz = U.z - oz, B = rx * dx + ry * dy + rz * dz, disc = B * B - (rx * rx + ry * ry + rz * rz - 2.3 * 2.3); if (disc < 0) return h; const t = B - Math.sqrt(disc); if (t < tmin || t >= h.t) return h;
        h.t = t; h.kind = 'grheli'; h.x = ox + dx * t; h.y = oy + dy * t; h.z = oz + dz * t; h.nx = -dx; h.ny = -dy; h.nz = -dz; h.obj = U; h.part = 'body'; return h; };
      c.hit = function (h, W, first) { if (!h || h.kind !== 'grheli') return hit0(h, W, first); const U = h.obj; if (U !== R.unit || U.mode === 'down') return null;
        try { c.fx.impact(_a.set(h.x, h.z, -h.y), _n.set(h.nx, h.nz, -h.ny), 'metal', { power: 1 }); if (first) c.snd('impact', 'metal', { dist: U.dist, pan: 0 }); } catch (e) {}
        U.hp -= ((W && W.dmg) || 20) * 0.2; if (U.hp <= 0) { U.mode = 'down'; U.downAt = U.t; S.heliDown++; R.nextHeli = H.t + 75; H.say('roof: police helicopter shot down'); H.shout('Air unit is hit! Going down!', 2); try { H.crime('copKill', U.x, U.y); } catch (e) {} } return null; }; } };

  // ------------------------------------------------------------------ the stairs
  // the level spot of his roof furthest from him (to FAR m), at least one cell in from every edge: where they come out. null = no room up there
  const entry = (px, py, z) => { const C = 1.5, seen = new Set(['0,0']), Q = [[0, 0]]; let best = null, bs = -1;
    for (let n = 0; n < Q.length && n < 2500; n++) { const [i, j] = Q[n], x = px + i * C, y = py + j * C; let inner = true;
      for (const [u, w] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ok = okAt(x + u * C, y + w * C, z); if (!ok) { inner = false; continue; } const key = (i + u) + ',' + (j + w); if (seen.has(key) || Math.abs(i + u) > 30 || Math.abs(j + w) > 30) continue; seen.add(key); Q.push([i + u, j + w]); }
      const d = Math.hypot(i, j) * C, sc = d > FAR ? FAR - (d - FAR) * 0.1 : d; if (inner && sc > bs) { bs = sc; best = { x, y, d }; } }
    return best && best.d >= 5 ? best : null; };
  // THE ROOF DOOR (handover-4, ?grdoor=0 off): a stair-head box with a door (where the roof has no room for one, a hatch in the roof) stands at the
  // spot the officers come out of, from the moment the hook holds (he is still on the line), and goes 3 s after he and the last officer have left
  // that roof. A record here (R.huts); the meshes are R.draw's. The box pushes him out sideways and officers walk round it; it stops no round and no line.
  const hutAt = (x, y, z, m) => { for (const h of R.huts) if (h.kind === 'hut' && Math.abs(h.z - z) < 0.7) { const rx = x - h.x, ry = y - h.y; if (Math.abs(rx * h.ux + ry * h.uy) < HD + m && Math.abs(-rx * h.uy + ry * h.ux) < HW + m) return h; } return null; };
  // the roof's own furniture the height map does not hold: water towers and plant (game.js "rooftop kit" -> models.js userData.items [x, y, turn, scale, roof height]). Radii are GUESSED
  const kit = () => { const pm = g.propMeshes || []; if (R.kit && R.kitN === pm.length) return R.kit; const seen = new Set(), a = [];
    for (const m of pm) { const kd = m.userData && m.userData.kind; if ((kd !== 'watertower' && kd !== 'ac') || !Array.isArray(m.userData.items)) continue; for (const p of m.userData.items) { if (seen.has(p)) continue; seen.add(p); a.push([p[0], p[1], p[4], (kd === 'ac' ? 1.2 : 2.3) * (p[3] || 1)]); } }
    R.kit = a; R.kitN = pm.length; return a; };
  const segD = (ax, ay, bx, by, px, py) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, u = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1); return Math.hypot(ax + dx * u - px, ay + dy * u - py); };
  const findDoor = (lx, ly, z) => { const C = 0.75, seen = new Set(['0,0']), Q = [[0, 0]]; let best = null, bs = 1e9, tried = 0, fit = 0, clearN = 0;
    const near = kit().filter((p) => Math.abs(p[2] - z) < 2.5 && Math.hypot(p[0] - lx, p[1] - ly) < 45);
    for (let n = 0; n < Q.length && n < 4200; n++) { const [i, j] = Q[n], ex = lx + i * C, ey = ly + j * C;
      for (const [u, w] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const key = (i + u) + ',' + (j + w); if (seen.has(key) || Math.abs(i + u) > 35 || Math.abs(j + w) > 35 || !okAt(ex + u * C, ey + w * C, z)) continue; seen.add(key); Q.push([i + u, j + w]); }
      const dl = Math.hypot(i, j) * C; if (dl < 6 || dl > 26) continue; tried++; const ux = (lx - ex) / dl, uy = (ly - ey) / dl, cx = ex - ux * (HD + 0.9), cy = ey - uy * (HD + 0.9);
      let ok = okAt(ex, ey, z) && okAt(ex + ux * 1.5, ey + uy * 1.5, z) && okAt(cx, cy, z) && okAt(ex + ux * 0.9 - uy * 1.2, ey + uy * 0.9 + ux * 1.2, z) && okAt(ex + ux * 0.9 + uy * 1.2, ey + uy * 0.9 - ux * 1.2, z);
      for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (ok && (a || b)) ok = okAt(cx + ux * a * (HD + 0.3) - uy * b * (HW + 0.3), cy + uy * a * (HD + 0.3) + ux * b * (HW + 0.3), z);
      if (!ok) continue; fit++; let cut = 0; for (let t = 2.5; t < dl - 1; t += 0.5) if (!okAt(ex + ux * t, ey + uy * t, z)) cut++; const line = !cut;      /* the last metre is his own: he may stand on the very edge. In the browser the height map is drawn from the meshes WITH the water towers and plant (heli.js), so this line is also "nothing on the roof stands between" */
      let blk = !line, deep = 0; for (const p of near) { const a = p[3] + 2.0 - Math.hypot(cx - p[0], cy - p[1]), b = p[3] + 0.3 - segD(lx, ly, ex, ey, p[0], p[1]); if (a > 0 || b > 0) { blk = true; deep += Math.max(a, 0) * 3 + Math.max(b, 0); } } if (!blk) clearN++;
      const sc = (!line ? 200 + cut * 4 /* no clear line anywhere: the place with the least in the way */ : blk ? 100 + deep * 10 : 0) + (line ? 0 : deep * 10) + (dl < 12 ? (12 - dl) * 1.5 : dl > 15 ? dl - 15 : 0) + dl * 0.02; if (sc < bs) { bs = sc; best = { kind: 'hut', x: cx, y: cy, z, ux, uy, ex, ey, sx: cx + ux * (HD - 0.4), sy: cy + uy * (HD - 0.4), dl: +dl.toFixed(1), hid: blk, line }; } }
    R.lastFind = { tried, fit, clear: clearN, kit: near.length, dl: best ? best.dl : null, hid: best ? best.hid : null, line: best ? best.line : null }; return best; };
  R.findDoor = findDoor; R.kitList = kit; R.entry = entry;
  const placeHut = (lx, ly, z) => {
    for (const h of R.huts) { const d = Math.hypot(h.ex - lx, h.ey - ly); if (Math.abs(h.z - z) > 0.7 || d > 45) continue; let ok = true; for (let s = 1; s < d && ok; s += 1) ok = okAt(lx + (h.ex - lx) * s / d, ly + (h.ey - ly) * s / d, z); if (ok) { S.hutReuse++; return h; } }      // the door already on this roof
    const ent = entry(lx, ly, z); if (!ent) return null; const el = Math.hypot(lx - ent.x, ly - ent.y) || 1, vx = (lx - ent.x) / el, vy = (ly - ent.y) / el; let h = null;
    /* handover-6: where the box goes. handover-5 slid the way-out point along the one line from the far spot to him; on the hold's roof (a wedge by Madison Square, he lands at its tip) that line runs along the roof's edge and no box fitted on it, so he got the hatch 25 m off behind the water tower. Now EVERY level spot of the roof (a 0.75 m grid) 6 to 26 m from him is tried: the box turned to face him must be all roof (0.3 m to spare), with room to step out. Of those, the ones with a straight unbroken line over the roof to him come first (the browser's height map holds the roof's water tower and plant, so that line is also a clear view), nearest 12 to 15 m wins; a place with no such line is taken only if none has one. No cell fits at all: the hatch */
    if (!HATCH) h = findDoor(lx, ly, z);
    if (!h) h = { kind: 'hatch', x: ent.x, y: ent.y, z, ux: vx, uy: vy, ex: ent.x, ey: ent.y, sx: ent.x, sy: ent.y };
    h.lx = lx; h.ly = ly; h.idleT = 0; h.open = 0; h.openT = 0; h.t0 = heat() ? heat().t : 0; R.huts.push(h); if (h.kind === 'hut') S.huts++; else S.hatches++; return h; };
  const huts = (H, dt) => { const t = H.t;
    if (G.phase && G.next === 'pull' && G.land && G.land.z >= 1) { if (!R.pend || R.pend.key !== G.stats.attached) R.pend = { key: G.stats.attached, hut: placeHut(G.land.x, G.land.y, G.land.z) }; } else if (!G.phase && R.pend && !(R.roof && R.roof.key === R.pend.key)) R.pend = null;
    for (const h of R.huts) { const used = (R.roof && R.roof.hut === h) || (R.pend && R.pend.hut === h) || R.cops.some((k) => k.gr && k.gr.hut === h); h.idleT = used ? 0 : h.idleT + dt; if (h.idleT > 3) { h.gone = true; S.hutsGone++; }
      let op = false; for (const k of R.cops) { const q = k.gr; if (!q || q.hut !== h) continue; if (q.outT > 0 || (q.ph === 'in' && q.tUp - t < 0.5) || (q.ph === 'back' && Math.hypot(k.x - q.sx, k.y - q.sy) < 2.6)) op = true; } if (op) h.openT = 0.7; else h.openT -= dt; h.open = clamp(h.open + (h.openT > 0 ? 4 : -2.5) * dt, 0, 1); }
    if (R.huts.some((h) => h.gone)) R.huts = R.huts.filter((h) => !h.gone);
    if (K.onMine()) { const h = hutAt(pl.x, pl.y, pl.alt, 0.35); if (h) { /* he does not walk through the box: out by the nearest side that is still roof */ const rx = pl.x - h.x, ry = pl.y - h.y, a = rx * h.ux + ry * h.uy, b = -rx * h.uy + ry * h.ux, A = HD + 0.36, B = HW + 0.36;
        const C = [[A - Math.abs(a), (a < 0 ? -A : A), b], [B - Math.abs(b), a, (b < 0 ? -B : B)], [A + Math.abs(a), (a < 0 ? A : -A), b], [B + Math.abs(b), a, (b < 0 ? B : -B)]].sort((p, q) => p[0] - q[0]);
        for (const [, na, nb] of C) { const x = h.x + h.ux * na - h.uy * nb, y = h.y + h.uy * na + h.ux * nb; if (okAt(x, y, pl.alt)) { pl.x = x; pl.y = y; S.pushed++; break; } } } } };
  // the wall's foot on this officer's side of the building he is on
  const door = (k, z) => { const dx = k.x - pl.x, dy = k.y - pl.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    for (let s = 0.5; s <= Math.min(d, 70); s += 0.5) { const T = top(pl.x + ux * s, pl.y + uy * s); if (T < 0.6 && T > -0.5) { st.resolve(pl.x + ux * (s + 1.2), pl.y + uy * (s + 1.2), 0.34, _o); return { x: _o.x, y: _o.y }; } }
    return { x: k.x, y: k.y }; };
  const call = (H, rf) => { const want = rf.ent ? (H.level >= 3 ? 3 : 2) : 0; if (rf.n >= want) return;
    const C = H.cops.filter((k) => k.hp > 0 && !k.gone && !k.gr && !k.get && !k.sub && k.mode !== 'leave' && Math.hypot(k.x - pl.x, k.y - pl.y) < 90).sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y));
    for (const k of C) { if (rf.n >= want) break; const dr = door(k, rf.z), a = rf.n * 2.1;
      k.gr = { ph: 'go', z: rf.z, rf, dx: dr.x, dy: dr.y, ex: rf.ent.x + (rf.n ? Math.cos(a) * 0.9 : 0), ey: rf.ent.y + (rf.n ? Math.sin(a) * 0.9 : 0), i: rf.n, tGo: H.t + Math.hypot(k.x - dr.x, k.y - dr.y) / 4 + 5, awayT: 0, backT: 0 };
      const h = rf.hut; if (h) { const q = k.gr, sd = rf.n === 1 ? 1.2 : rf.n === 2 ? -1.2 : 0, f = h.kind === 'hut' ? (sd ? 0.9 : 1.3) : (sd ? 0.5 : 1.2); q.hut = h; q.sx = h.sx; q.sy = h.sy; q.ex = h.ex + h.ux * f - h.uy * sd; q.ey = h.ey + h.uy * f + h.ux * sd; }
      if (!okAt(k.gr.ex, k.gr.ey, rf.z)) { k.gr.ex = rf.ent.x; k.gr.ey = rf.ent.y; }
      R.cops.push(k); S.called++; if (!rf.n++) { H.shout(H.pick(['He is on the roof! Take the stairs!', 'Roof! Get up there!', 'Suspect on the roof. Going up!']), 2); H.say('roof: officers sent up the stairs of a ' + rf.z.toFixed(0) + ' m roof'); } } };
  const stairs = (H, dt) => { const t = H.t, L = H.level;
    for (const k of R.cops) { const q = k.gr; if (!q) continue;
      if (q.ph === 'go') { if (L === 0 || H.dead) { k.gr = null; continue; } if (Math.hypot(k.x - q.dx, k.y - q.dy) < 2.2 || t > q.tGo) { q.ph = 'in'; q.tUp = t + 3 + q.z / STAIR + 1.2 * q.i; k.x = q.dx; k.y = q.dy; k.z = HIDE; k.see = false; } }
      else if (q.ph === 'in') { if (L === 0 || H.dead) { q.ph = 'out'; q.tDown = t + 2; } else if (t >= q.tUp && !(q.hut && (t < (q.rf.nextOut || 0) || R.cops.some((o) => o !== k && o.gr && o.gr.hut === q.hut && o.gr.outT > 0)))) { q.ph = 'up'; k.x = q.ex; k.y = q.ey; k.z = q.z; k.h = Math.atan2(pl.y - k.y, pl.x - k.x); if (q.hut) { /* one at a time, out of the door */ q.rf.nextOut = t + (q.hut.kind === 'hatch' ? 2.6 : 1.8) + 0.25 /* handover-6: strictly one at a time: the next waits until this one's step-out is over (was 1.7 / 1.1 s, shorter than the step-out itself) */; k.x = q.sx; k.y = q.sy; k.h = Math.atan2(q.hut.uy, q.hut.ux); q.outT = q.hut.kind === 'hatch' ? 2.6 : 1.8; } k.mode = 'move'; k.post = null; k.cover = null; k.path = null; k.thinkT = 0; k.onT = 0; k.up = 1; k.burst = 0; k.fireCd = H.rr(1.6, 2.4) /* out of the door: a breath before the first round */; S.arrived++; S.reach.push(+(t - q.rf.t0).toFixed(1));
          if (!q.rf.up++) { H.shout(H.pick(['POLICE! On the roof! Do not move!', 'Roof door! We have him!']), 2); H.say('roof: first officer out on the roof ' + (t - q.rf.t0).toFixed(1) + ' s after he got there'); } } }
      else if (q.ph === 'up') { if (R.roof !== q.rf || L === 0 || H.dead) { q.awayT += dt; if (q.awayT > (L === 0 ? 0.5 : 4)) { q.ph = 'back'; q.backT = 0; } } else q.awayT = 0; }
      else if (q.ph === 'back') { q.backT += dt; if (R.roof === q.rf && L > 0 && !H.dead) { q.ph = 'up'; q.awayT = 0; k.thinkT = 0; }      // he came back to this roof
        else if ((q.hut ? Math.hypot(k.x - q.sx, k.y - q.sy) < 0.6 : Math.hypot(k.x - q.ex, k.y - q.ey) < 1.6) || q.backT > 9) { q.ph = 'out'; q.tDown = t + 2 + q.z / STAIR; k.z = HIDE; k.see = false; } }
      else if (q.ph === 'out') { if (t >= q.tDown) { k.gr = null; k.x = q.dx; k.y = q.dy; k.z = st.onSidewalk(k.x, k.y) ? 0.15 : 0; k.mode = 'move'; k.post = null; k.cover = null; k.path = null; k.thinkT = 0; S.wentDown++; } } } };

  // ------------------------------------------------------------------ the helicopter
  const tops = (U) => { let m = 0; for (let i = 0; i <= 10; i++) m = Math.max(m, top(U.x + U.vx * i * 0.5, U.y + U.vy * i * 0.5)); return m; };      /* what is under it and on its way for the next 5 s */
  const spawn = (H) => { let a0; try { g.world.camera.getWorldDirection(_a); a0 = Math.atan2(_a.z, -_a.x); } catch (e) { a0 = pl.h + Math.PI; } const a = a0 + H.rr(-0.7, 0.7);
    const U = (R.unit = { x: pl.x + Math.cos(a) * 400, y: pl.y + Math.sin(a) * 400, z: Math.max(plz() + 40, 90), h: a + Math.PI, vx: -Math.cos(a) * 30, vy: -Math.sin(a) * 30, vz: 0, hp: 100, mode: 'on', side: H.rnd() < 0.5 ? -1 : 1, ang: a, cd: 2.5, burst: 0, t: 0, dist: 400, los: false, losT: 0, offT: 0, blindT: 0, rot: 0, t0: H.t, ringT: 0, ring: 0 });
    S.heliCalls++; H.shout(H.pick(['Aviation is overhead!', 'Air unit has the roof!']), 2); H.say('roof: police helicopter sent'); if (!H.note) H.note = { title: 'POLICE HELICOPTER', sub: 'It has you on the roof. Hook away or lose it', t: 2.5 }; return U; };
  const leave = (H, U, why, again) => { U.mode = 'leave'; U.leaveAt = U.t; U.la = Math.atan2(U.y - pl.y, U.x - pl.x); S.heliLeft++; R.nextHeli = H.t + again; H.say('roof: police helicopter leaves (' + why + ')'); };
  const heli = (H, dt) => { const U = R.unit, c = H.c || g.combat, L = H.level, pz = plz(), rf = R.roof; if (!U) return;
    U.t += dt; U.rot += dt * 38;
    if (U.mode === 'down') { U.vz -= 9.8 * dt; U.x += U.vx * dt; U.y += U.vy * dt; U.z += U.vz * dt; U.h += dt * 2.6; if (U.z <= Math.max(0, top(U.x, U.y)) + 1.2 || U.t > U.downAt + 14) { try { c.fx.impact(_a.set(U.x, U.z, -U.y), _n.set(0, 1, 0), 'metal', { power: 3 }); c.scare(U.x, U.y, 60, 2); } catch (e) {} R.unit = null; } return; }
    if (U.mode === 'on') { if (L === 0 || H.dead) leave(H, U, L === 0 ? 'no wanted level' : 'he is down', 20); else { U.offT = pz < 1 ? U.offT + dt : 0; U.blindT = U.los ? 0 : U.blindT + dt; if (U.offT > 20) { leave(H, U, 'he is on the street', 30); H.shout('Air unit breaking off.', 1); } else if (U.blindT > 12 && U.t > 25) { leave(H, U, 'no line to him', 30); H.shout('Air unit has lost him!', 1); } } }
    let gx, gy, gz; const low = LOOK && pz >= 1 && U.mode === 'on';      /* the low, near hover is for a man ON a roof; over a man on the street it flies as in handover-3, above the roofs round him */
    if (U.mode === 'leave') { gx = U.x + Math.cos(U.la) * 300; gy = U.y + Math.sin(U.la) * 300; gz = U.z + 25; if (Math.hypot(U.x - pl.x, U.y - pl.y) > 480 || U.t - U.leaveAt > 25) { R.unit = null; return; } }
    else { U.ang += U.side * 0.1 * dt; const RAD = low ? 30 : 42; gx = pl.x + Math.cos(U.ang) * RAD; gy = pl.y + Math.sin(U.ang) * RAD; gz = pz + (low ? 13 : 17);
      if (low) { /* handover-4: LOW and near, 30 m off and 13 m above him, 9 m over the roofs under its own stretch of the circle only (not the highest roof anywhere round him); it turns back from a stretch that would lift it 12 m, and climbs while it has no line to him */ U.ringT -= dt; if (U.ringT <= 0) { U.ringT = 0.5; U.ringLow = true; const need = (a) => { let m = 0; for (const r of [22, 30, 36]) for (const o of [-0.2, 0, 0.2]) m = Math.max(m, top(pl.x + Math.cos(a + o) * r, pl.y + Math.sin(a + o) * r)); return m; };
          U.ring = need(U.ang); const ah = need(U.ang + U.side * 0.5); if (ah + 9 > pz + 25 && ah > U.ring + 4 && U.t > (U.flipT || 0)) { U.side = -U.side; U.flipT = U.t + 6; } }
        gz = Math.max(gz, U.ring + 9); if (U.blindT > 2) gz += Math.min((U.blindT - 2) * 4, 30); } else {
      /* never lower than 14 m over the highest roof on its circle (looked at once a second): with him on the street it stays above the roofs round him */ U.ringT -= dt; if (U.ringT <= 0 || U.ringLow) { U.ringLow = false; U.ringT = 1; let m = 0; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; m = Math.max(m, top(pl.x + Math.cos(a) * 42, pl.y + Math.sin(a) * 42), top(pl.x + Math.cos(a) * 28, pl.y + Math.sin(a) * 28)); } U.ring = m; } gz = Math.max(gz, U.ring + 14); } }
    gz = Math.max(gz, tops(U) + (low ? 9 : 14));
    let wx = (gx - U.x) * 0.7, wy = (gy - U.y) * 0.7; const wl = Math.hypot(wx, wy); if (wl > 38) { wx *= 38 / wl; wy *= 38 / wl; }
    const ax = wx - U.vx, ay = wy - U.vy, al = Math.hypot(ax, ay), am = Math.min(al, 9 * dt) / (al || 1); U.vx += ax * am; U.vy += ay * am; U.vz += clamp(clamp((gz - U.z) * 0.8, -8, 10) - U.vz, -6 * dt, 6 * dt);
    U.x += U.vx * dt; U.y += U.vy * dt; U.z += U.vz * dt; const tz = pz + 1.2; U.dist = Math.hypot(pl.x - U.x, pl.y - U.y, tz - U.z);
    const wantH = low && Math.hypot(pl.x - U.x, pl.y - U.y) < 48 ? U.ang + U.side * Math.PI / 2 /* handover-5: SIDE-ON to him along its circle while it hovers low, so the word on its side can be read (it was nose-on) */ : U.mode === 'on' && U.dist < 160 ? Math.atan2(pl.y - U.y, pl.x - U.x) : Math.hypot(U.vx, U.vy) > 3 ? Math.atan2(U.vy, U.vx) : U.h; U.h += clamp(wrapPi(wantH - U.h), -1.4 * dt, 1.4 * dt);
    U.losT -= dt; if (U.losT <= 0) { U.losT = 0.2; U.los = los3(U.x, U.y, U.z - 0.8, pl.x, pl.y, tz + 0.3); }
    if (U.mode !== 'on' || !(K.onMine() && pz >= 1) || L < HELI_L || !U.los || U.dist > 110 || H.t < (H.holdFire || 0)) return;
    U.cd -= dt; if (U.cd > 0) return; if (U.burst <= 0) U.burst = 5;
    const mh = low ? Math.atan2(pl.y - U.y, pl.x - U.x) : U.h /* side-on: the rounds come from the door on his side */, ox = U.x + Math.cos(mh) * 1.6, oy = U.y + Math.sin(mh) * 1.6, oz = U.z - 0.9, ex = pl.x - ox, ey = pl.y - oy, ez = tz - oz, Ld = Math.hypot(ex, ey, ez) || 1, sig = 2.2 * (pl.speed > 3 ? 1.7 : pl.speed > 1 ? 1.25 : 1) * (LOOK && U.dist < 45 ? 45 / Math.max(U.dist, 25) : 1) * Math.PI / 180;      /* nearer with the new look: the cone is widened so a round is as likely to hit as from 45 m */
    const a = Math.atan2(ey, ex) + H.gauss() * sig, e = Math.asin(clamp(ez / Ld, -1, 1)) + H.gauss() * sig, dx = Math.cos(a) * Math.cos(e), dy = Math.sin(a) * Math.cos(e), dz = Math.sin(e);
    let tp = -1; { const rx = ox - pl.x, ry = oy - pl.y, A = dx * dx + dy * dy, B = rx * dx + ry * dy, Cc = rx * rx + ry * ry - 0.27 * 0.27, disc = B * B - A * Cc; if (disc >= 0 && A > 1e-9) { const t = (-B - Math.sqrt(disc)) / A, z = oz + dz * t - pz; if (t > 0 && z > 0 && z < 1.78) tp = t; } }
    const h = cast3(ox, oy, oz, dx, dy, dz, 2, 160, 0), hit = tp > 0 && tp < h.t + 0.3, te = hit ? tp : h.t; S.heliShots++;
    try { _b.set(ox, oz, -oy); _a.set(ox + dx * te, oz + dz * te, -(oy + dy * te)); H.copTracer(_b, _a); if (hit) c.fx.impact(_a, _n.set(-dx, -dz, dy), 'flesh', { power: 0.8 }); else if (h.kind !== 'none') c.fx.impact(_a, _n.set(h.nx, h.nz, -h.ny), 'concrete', { power: 0.8 });
      c.snd('shot', 'rifle', { dist: U.dist, pan: 0 }); if (c.fx.spawn) c.fx.spawn({ x: ox, y: oz, z: -oy, life: 0.07, s0: 0.5, s1: 0.2, r: 1, g: 0.8, b: 0.4, a: 0.95, add: true, fade: 1 }); } catch (e2) {}
    if (hit) { S.heliHits++; H.src = { x: U.x, y: U.y }; try { c.hurt((HDMG[L] || 5) * (0.85 + 0.3 * H.rnd())); } finally { H.src = null; } }
    U.burst--; U.cd = U.burst > 0 ? 0.11 : H.rr(3, 4.5); };
  // the stand-in of combat/heatheli.js (navy hull, white band, POLICE on the sides, strobes, rotor disc), built on its first frame
  const build = () => { const Rt = new THREE.Group(); Rt.name = 'police-heli-roof'; const M = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.2 }), navy = M(LOOK ? 0x1c4fc0 : 0x13233f), white = M(LOOK ? 0xf4f6f8 : 0xe9ecef), dark = M(0x15171a);
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; Rt.add(m); return m; };
    const sph = new THREE.SphereGeometry(1, 18, 12), cyl = new THREE.CylinderGeometry(1, 1, 1, 10), box = new THREE.BoxGeometry(1, 1, 1);
    add(sph, navy, 0.2, 1.55, 0, 2.3, 1.0, 0.95); add(sph, white, 0.2, 1.2, 0, 2.2, 0.62, 0.97); add(sph, dark, 1.35, 1.75, 0, 1.0, 0.66, 0.86);
    const boom = add(cyl, navy, -3.6, 1.85, 0, 0.2, 5.2, 0.2); boom.rotation.z = Math.PI / 2; add(box, navy, -6.0, 2.4, 0, 0.9, 1.5, 0.07); add(box, white, -5.4, 1.9, 0, 0.5, 0.05, 1.5);
    for (const s of [-1, 1]) { const sk = add(cyl, dark, 0.2, 0.08, s * 1.05, 0.05, 3.4, 0.05); sk.rotation.z = Math.PI / 2; add(box, dark, 0.9, 0.5, s * 0.9, 0.05, 0.9, 0.05); add(box, dark, -0.5, 0.5, s * 0.9, 0.05, 0.9, 0.05); }
    add(cyl, dark, 0, 2.75, 0, 0.09, 0.6, 0.09); const disc = new THREE.Mesh(new THREE.CircleGeometry(5.3, 28), new THREE.MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.set(0, 3.05, 0); Rt.add(disc);
    const blades = new THREE.Group(); blades.position.set(0, 3.06, 0); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(box, dark); b.scale.set(5.3, 0.03, 0.22); b.position.set(Math.cos(i * 2.094) * 2.65, 0, Math.sin(i * 2.094) * 2.65); b.rotation.y = -i * 2.094; blades.add(b); } Rt.add(blades);
    const lamp = (col, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: col })); m.position.set(-0.2, 0.62, z); Rt.add(m); return m; }, red = lamp(0xff2020, -0.5), blue = lamp(0x2050ff, 0.5);
    if (!LOOK) try { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const x = cv.getContext('2d'); x.clearRect(0, 0, 512, 128); x.fillStyle = '#ffffff'; x.font = '800 96px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', 256, 68);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; const pm = new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), pm); p.position.set(-0.35, 1.72, s * 0.9); p.rotation.y = s > 0 ? 0 : Math.PI; Rt.add(p); } } catch (e) {}
    const V = { root: Rt, blades, red, blue };
    if (LOOK) { /* handover-4/-5: the police look. Blue over white; POLICE in dark navy on a white board on BOTH sides (3.6 m by 0.9 m before the 1.25 scale: letters about 0.75 m high) and under the belly; two big red and two big blue lamps on the skid struts, one colour always lit; a white tail strobe; a nose lamp; and, AT NIGHT ONLY, a searchlight (soft nested cones and a spot cut to the roof's edge; no real light) */
      const glow = (col, r, op) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      red.material.color.set(0xff1414); blue.material.color.set(0x1f55ff); red.scale.setScalar(2.1); blue.scale.setScalar(2.1); red.position.set(0.9, 0.42, -0.9); blue.position.set(-0.5, 0.42, -0.9); red.add(glow(0xff3030, 0.23, 0.4)); blue.add(glow(0x3060ff, 0.23, 0.45)); /* handover-6: the halos were 2.6 m across (half the cabin, by day); now 1.2 m, just round the lamp */
      const red2 = red.clone(), blue2 = blue.clone(); red2.position.z = 0.9; blue2.position.z = 0.9; Rt.add(red2); Rt.add(blue2); V.reds = [red, red2]; V.blues = [blue, blue2];
      V.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); V.strobe.position.set(-6.0, 3.2, 0); V.strobe.add(glow(0xffffff, 0.45, 0.4)); Rt.add(V.strobe);
      V.nose = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf2f7ff })); V.nose.position.set(1.7, 0.72, 0); V.nose.add(glow(0xcfe2ff, 0.4, 0.4)); Rt.add(V.nose);
      try { const word = (bg) => { const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256; const x = cv.getContext('2d'); x.clearRect(0, 0, 1024, 256); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 1024, 256); } x.fillStyle = '#0b1f66'; x.font = '900 236px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', 512, 138, 968); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; return tx; };
        /* a plane's front shows its picture the right way round, and only the front is drawn: the left side's plane is turned half round, so neither side is mirrored; the belly's is turned to face down, read with the nose to the reader's right */
        const sm = new THREE.MeshBasicMaterial({ map: word('#ffffff') }); V.words = [];
        for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), sm); p.position.set(0.0, 1.42, s * 1.0); p.rotation.y = s > 0 ? 0 : Math.PI; Rt.add(p); V.words.push(p); }
        const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: word(null), transparent: true, depthWrite: false })); p.rotation.x = Math.PI / 2; p.position.set(0.2, 0.56, 0); Rt.add(p); V.words.push(p); } catch (e) {}
      Rt.scale.setScalar(1.25);
      const lm = (op) => new THREE.MeshBasicMaterial({ color: 0xd6e6ff, transparent: true, opacity: op, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      /* handover-6, the cone: ONE open cone drawn as faint light, not as panes (handover-5's three nested flat cones drew as hard wedges and whitened the picture). A small shader: bright at the lamp, fading to nothing along its length; fading to nothing at its outline (where the surface turns edge-on to the eye), so it has no line anywhere. Additive, writes no depth. R.draw dims it to a tenth while the camera is inside it */
      const cg = new THREE.ConeGeometry(1, 1, 40, 6, true); cg.translate(0, -0.5, 0);
      V.coneMat = new THREE.ShaderMaterial({ uniforms: { uOp: { value: 0 }, uCol: { value: new THREE.Color(0xd6e6ff) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
        vertexShader: 'varying float vL; varying vec3 vN; varying vec3 vV; void main() { vL = -position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform float uOp; uniform vec3 uCol; varying float vL; varying vec3 vN; varying vec3 vV; void main() { float rim = abs(dot(normalize(vN), normalize(vV))); float along = smoothstep(0.0, 0.03, vL) * pow(max(1.0 - vL, 0.0), 1.6); gl_FragColor = vec4(uCol * (uOp * rim * rim * along), 1.0); }' });
      V.cone = new THREE.Mesh(cg, V.coneMat); V.cone.name = 'police-heli-cone'; V.cone.frustumCulled = false; V.cone.renderOrder = 5; V.coneIn = 1;
      /* the spot: a fan round the point at his feet, bright in the middle and dark at the rim; each of its 36 spokes is cut where the roof ends (R.draw), so it never lies in the air over the street */
      const NS = 36, sg = new THREE.BufferGeometry(), idx = []; for (let i = 0; i < NS; i++) { const j = (i + 1) % NS; idx.push(0, 1 + i, 1 + j, 1 + i, 1 + NS + i, 1 + NS + j, 1 + i, 1 + NS + j, 1 + j); } sg.setIndex(idx); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((2 * NS + 1) * 3), 3)); sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array((2 * NS + 1) * 3), 3));      /* centre, a ring half way out, the rim */
      V.spotMat = lm(0); V.spot = new THREE.Mesh(sg, V.spotMat); V.spot.name = 'police-heli-spot'; V.spot.frustumCulled = false; V.spot.renderOrder = 4; V.NS = NS;
      V.cone.visible = V.spot.visible = false; g.world.scene.add(V.cone); g.world.scene.add(V.spot); V.sx = pl.x; V.sy = pl.y; V.lt = 0; }
    Rt.rotation.order = 'YZX'; g.world.scene.add(Rt); return V; };
  // the roof door's meshes (handover-4): a few boxes each, shared shapes and materials, made on first use
  let HG = null; const hutVis = new Map();
  const hutMesh = (h) => { if (!HG) { const M = (col, r) => new THREE.MeshStandardMaterial({ color: col, roughness: r, metalness: 0.05 }); HG = { box: new THREE.BoxGeometry(1, 1, 1), wall: M(0x5b5650, 0.95), cap: M(0x2f3033, 0.85), frame: M(0xe6e2d6, 0.7), leaf: M(0xb8322a, 0.55), hleaf: M(0x3d4a45, 0.6), hwall: M(0x8d8a82, 0.92), in: new THREE.MeshBasicMaterial({ color: 0x050607 }), lamp: new THREE.MeshBasicMaterial({ color: 0xffe2a0 }) }; }
    const Gp = new THREE.Group(); Gp.name = 'roof-door'; const add = (par, mat, x, y, z, sx, sy, sz, sh) => { const m = new THREE.Mesh(HG.box, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = !!sh; m.receiveShadow = !!sh; par.add(m); return m; }, piv = new THREE.Group();
    if (h.kind === 'hut') { /* handover-5: dark grey-brown walls and a darker cap (the pale box of handover-4 did not read); a REAL doorway 1 m wide, 2.1 m high and 1 m deep in the front, lined black, with an off-white frame round it; the officer starts inside it. The leaf is red, hung on the frame, and swings OUT and right round to lie on the wall beside the opening (166 degrees) so no officer walks through it */
      const OW = 1.0, OH = 2.1, RD = 1.0, JW = (2 * HW - OW) / 2;
      add(Gp, HG.wall, -RD / 2, HH / 2, 0, 2 * HD - RD, HH, 2 * HW, 1); for (const s of [-1, 1]) add(Gp, HG.wall, HD - RD / 2, HH / 2, s * (OW + JW) / 2, RD, HH, JW, 1); add(Gp, HG.wall, HD - RD / 2, (OH + HH) / 2, 0, RD, HH - OH, OW, 1);
      add(Gp, HG.in, HD - RD + 0.012, OH / 2, 0, 0.02, OH, OW); for (const s of [-1, 1]) add(Gp, HG.in, HD - RD / 2 - 0.01, OH / 2, s * (OW / 2 - 0.006), RD - 0.03, OH, 0.01); add(Gp, HG.in, HD - RD / 2 - 0.01, OH - 0.006, 0, RD - 0.03, 0.01, OW); add(Gp, HG.in, HD - RD / 2 - 0.01, 0.02, 0, RD - 0.03, 0.04, OW);
      for (const s of [-1, 1]) add(Gp, HG.frame, HD + 0.03, (OH + 0.12) / 2, s * (OW / 2 + 0.06), 0.08, OH + 0.12, 0.12); add(Gp, HG.frame, HD + 0.03, OH + 0.06, 0, 0.08, 0.12, OW + 0.24);
      add(Gp, HG.cap, 0.1, HH + 0.07, 0, 2 * HD + 0.5, 0.14, 2 * HW + 0.3, 1); add(Gp, HG.lamp, HD + 0.09, 2.36, 0, 0.1, 0.1, 0.3); add(Gp, HG.cap, HD + 0.35, 0.05, 0, 0.7, 0.1, 1.3, 1);
      piv.position.set(HD + 0.1, 0, -OW / 2); add(piv, HG.leaf, 0, OH / 2, OW / 2, 0.06, OH - 0.04, OW - 0.02, 1); }
    else { for (const [x, z, sx, sz] of [[0.6, 0, 0.12, 1.32], [-0.6, 0, 0.12, 1.32], [0, 0.6, 1.08, 0.12], [0, -0.6, 1.08, 0.12]]) add(Gp, HG.hwall, x, 0.14, z, sx, 0.28, sz, 1); add(Gp, HG.in, 0, 0.03, 0, 1.08, 0.04, 1.08); piv.position.set(-0.6, 0.3, 0); add(piv, HG.hleaf, 0.6, 0, 0, 1.3, 0.06, 1.3, 1); }
    Gp.add(piv); Gp.position.set(h.x, h.z, -h.y); Gp.rotation.y = Math.atan2(h.uy, h.ux); g.world.scene.add(Gp); return { root: Gp, piv }; };
  const drawHuts = () => { for (const h of R.huts) { let v = hutVis.get(h); if (v === undefined) { try { v = hutMesh(h); } catch (e) { v = null; fail('door model', e); } hutVis.set(h, v); } if (v) { if (h.kind === 'hut') v.piv.rotation.y = h.open * 2.9; else v.piv.rotation.z = h.open * 1.9; } }
    if (hutVis.size > R.huts.length) for (const [h, v] of hutVis) if (!R.huts.includes(h)) { if (v) g.world.scene.remove(v.root); hutVis.delete(h); } };
  R.hutVis = hutVis;
  const lightOff = () => { const V = R.vis; if (V && V.cone) V.cone.visible = V.spot.visible = false; };
  R.draw = () => { if (DOOR || hutVis.size) drawHuts(); const U = R.unit; if (!U) { if (R.vis && R.vis.root.visible) { R.vis.root.visible = false; lightOff(); } return; } if (R.vis === null) { try { R.vis = build(); } catch (e) { R.vis = false; fail('heli model', e); } } const V = R.vis; if (!V) return;
    const fw = U.vx * Math.cos(U.h) + U.vy * Math.sin(U.h), sd = -U.vx * Math.sin(U.h) + U.vy * Math.cos(U.h); V.root.visible = true; V.root.position.set(U.x, U.z - (LOOK ? 2.0 : 1.6), -U.y); V.root.rotation.set(U.mode === 'down' ? U.t * 1.3 : clamp(-sd * 0.012, -0.35, 0.35), U.h, clamp(-fw * 0.006, -0.22, 0.22));
    V.blades.rotation.y = -U.rot; const ph = Math.floor(U.t * 6) % 4; V.red.visible = ph === 0; V.blue.visible = ph === 2;
    if (V.cone) { /* handover-5: red for 0.4 s then blue for 0.4 s, each with one short blink, so one colour is lit in 85 of 100 stills; the tail strobe; the searchlight is for the NIGHT only (sky/night.js: game.night.n is 0 by day and 1 at night; ?tod=22 or the N key), follows him a little late and goes out when the helicopter has no line */
      const f = (U.t % 0.8) / 0.8, ron = f < 0.5 && !(f > 0.175 && f < 0.25), bon = f >= 0.5 && !(f > 0.675 && f < 0.75); for (const m of V.reds) m.visible = ron; for (const m of V.blues) m.visible = bon; V.strobe.visible = Math.floor(U.t * 20) % 24 === 0;
      const nk = R.nightK(), lit = nk > 0 && U.mode === 'on' && U.los && U.dist < 150, dtv = clamp(U.t - V.lt, 0, 0.1); V.lt = U.t; if (!lit) { lightOff(); V.sx = pl.x; V.sy = pl.y; return; }
      const kf = 1 - Math.exp(-dtv * 3.5); V.sx += (pl.x - V.sx) * kf; V.sy += (pl.y - V.sy) * kf; const pz = plz(), T = top(V.sx, V.sy), gz = Math.abs(T - pz) < 0.7 ? T : pz >= 1 ? pz : Math.max(T, 0), gy = gz + 0.09, SR = 3.4;
      /* the spot is cut to the surface it lies on: each spoke stops at the last quarter metre that is still that roof (or that street). In the air (on the line, or the late spot past the edge): no spot */
      let rsum = 0; const onIt = okAt(V.sx, V.sy, gz); if (onIt) { const ps = V.spot.geometry.attributes.position, cs = V.spot.geometry.attributes.color, NS = V.NS; ps.setXYZ(0, 0, 0, 0); cs.setXYZ(0, 1, 1, 1);
        for (let i = 0; i < NS; i++) { const a = i * 2 * Math.PI / NS, ca = Math.cos(a), sa = Math.sin(a); let r = 0; while (r < SR && okAt(V.sx + ca * Math.min(r + 0.25, SR), V.sy + sa * Math.min(r + 0.25, SR), gz)) r = Math.min(r + 0.25, SR); rsum += r; const fo = (q) => { const u = 1 - q * q; return u * u; }, k1 = fo(r * 0.5 / SR), k2 = fo(r / SR); ps.setXYZ(i + 1, ca * r * 0.5, 0, -sa * r * 0.5); cs.setXYZ(i + 1, k1, k1, k1); ps.setXYZ(NS + i + 1, ca * r, 0, -sa * r); cs.setXYZ(NS + i + 1, k2, k2, k2); }      /* soft: (1 - q^2)^2, nothing at the full 3.4 m; where the roof ends first, it ends there */
        ps.needsUpdate = true; cs.needsUpdate = true; V.spotR = rsum / NS; }
      V.spotMat.opacity = 0.15 * nk; const cr = onIt ? clamp(rsum / V.NS, 1.2, SR) : 2;
      V.root.updateMatrixWorld(true); V.nose.getWorldPosition(_a); _b.set(V.sx - _a.x, gy - _a.y, -V.sy - _a.z); const len = _b.length() || 1; V.cone.position.copy(_a); V.cone.quaternion.setFromUnitVectors(_n.set(0, -1, 0), _b.multiplyScalar(1 / len)); V.cone.scale.set(cr, len, cr); /* far dimmer when the eye is inside the cone: its distance from the cone's axis against the cone's radius there */ let inK = 1; try { const cp = g.world.camera.getWorldPosition(_v); const tx = cp.x - _a.x, ty = cp.y - _a.y, tz = cp.z - _a.z, ta = tx * _b.x + ty * _b.y + tz * _b.z; if (ta > 0 && ta < len + 4) { const da = Math.hypot(tx - _b.x * ta, ty - _b.y * ta, tz - _b.z * ta), q = da / Math.max(cr * Math.min(ta, len) / len, 0.6); inK = clamp((q - 0.8) / 1.4, 0.1, 1); } } catch (e) {} V.coneIn += (inK - V.coneIn) * clamp(dtv * 6, 0, 1); V.coneMat.uniforms.uOp.value = 0.11 * nk * V.coneIn; V.spot.position.set(V.sx, gy, -V.sy); V.cone.visible = true; V.spot.visible = onIt; } };
  /* how much night it is for the searchlight: 0 by day (and when sky/night.js is not there, ?night=0), rising from the late evening to 1 at night */
  R.nightK = () => { const N = g.night; return N && N.n > 0.35 ? clamp((N.n - 0.35) / 0.4, 0, 1) : 0; };

  // ------------------------------------------------------------------ once a step, after the game's own (called by grapple.js)
  R.step = (dt) => { const H = heat(); if (!H || H.lite || typeof H.stepCop !== 'function' || !H.cops) return; wrap(H);
    const t = H.t, L = H.level, pz = K.onMine() ? pl.alt : 0, key = G.stats.attached;
    if (R.cops.length) R.cops = R.cops.filter((k) => k.gr && !k.gone && k.hp > 0 && H.cops.includes(k));
    if (pz >= 1) { if (!R.roof || R.roof.key !== key) { R.roof = { key, z: pz, t0: t, known: false, ent: undefined, n: 0, up: 0, retry: 0, heliAt: undefined }; S.roofs++; if (DOOR) { try { R.roof.hut = R.pend && R.pend.key === key ? R.pend.hut : placeHut(pl.x, pl.y, pz); } catch (e) { fail('door', e); } R.pend = null; } } }
    else if (!G.phase) R.roof = null;
    const rf = pz >= 1 ? R.roof : null;
    if (rf && L > 0 && !H.dead) { if (!rf.known && (H.seen || (t - H.lkp.t < 6 && Math.hypot(H.lkp.x - pl.x, H.lkp.y - pl.y) < 12))) rf.known = true;
      if (rf.known && t - rf.t0 >= REACT) { if (rf.ent === undefined) { rf.ent = rf.hut ? { x: rf.hut.ex, y: rf.hut.ey, d: Math.hypot(rf.hut.ex - pl.x, rf.hut.ey - pl.y) } : entry(pl.x, pl.y, pz); if (!rf.ent) { S.noRoom++; H.say('roof: no room up there for officers (helicopter only)'); } }
        if (t >= rf.retry) { rf.retry = t + 1.5; call(H, rf); }
        if (L >= HELI_L && !R.unit && t >= R.nextHeli) { if (rf.heliAt === undefined) rf.heliAt = t + 8; if (t >= rf.heliAt) spawn(H); } } }
    /* officers are on the stairs of the roof he stands on: they know where he is, so the level does not cool as if he had hidden */ if (rf && L > 0 && R.cops.some((k) => k.gr.rf === rf && (k.gr.ph === 'go' || k.gr.ph === 'in'))) H.coolT = 0;
    stairs(H, dt); if (DOOR) { try { huts(H, dt); } catch (e) { fail('door', e); } } heli(H, dt); };
  console.log('[grroof] on: officers come up the stairs of a hooked roof' + (HELI_L < 9 ? ', a police helicopter from step ' + HELI_L : '') + '; ?grroof=0 off');
  return R;
}
