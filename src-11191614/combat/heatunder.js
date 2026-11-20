// combat/heatunder.js (gameplay u1 + u2 + u3 + u4, Nov 15; u4 = an officer on his way aboard gets round a platform column that stands on his door place, ?heatdoor=0; u2 = the way to the stair round street furniture, ?heatway=0, and who rides on at a change of stations; u3 = an officer below has his own people-in-the-line test and one aboard closes in, ?heataboard=0): the police follow the player down. This is the SUBWAY lane's parked part (lanes/subway/src/subway/police.js, Nov 14), ported:
// install(game, S) is called by heatcore.js once the police body runs (?heatunder=0 = never). Taken out of the port, because combat.js and heatcore.js now do it themselves:
// the wrapper on combat.cast (rounds stopped by the station: combat.js subSolids / slabOpen) and the lifted frame round copShoot (heatcore.js plZ). heatcore.js knows an
// officer who is below by k.sub.phase === 'under' (its und(k)). The subway lane's files are read, never edited: ../subway/nav.js for the ways, S.on(...) for its events.
// What follows is the subway lane's own description of the part.
//  - Officers on foot who SAW him go down a stair run to that stair, down it and after him through passage, mezzanine, stairs and platform, by ways found with
//    nav.js over the station's own collision (u.walk). Down there they are the heat code's officers still: its state machine decides when to close in, shout, aim,
//    fire or cuff; only where they stand, how they get there and what they can see is ours (police-nav.js, walk.sight).
//  - Officers who did not see him go down know nothing of it: they search the street as the heat code has them do, and the heat cools by its own rules.
//  - A train: an officer who reaches an open door steps in and rides; the others stay on the platform and are let go when the train has left the station.
//  - Bullets (his and theirs) stop at the station's walls, floors and ceilings (walk.sight), and go down an open stair instead of into the sidewalk over it.
// THE HEAT CODE IS NOT EDITED (gameplay lane's files): its objects are wrapped from here, the way subway.js wraps the game. Wrapped on the Heat object: step, sight,
// los, stepCop, walkTo, coverNear, clearFrom, copShoot (and inside it, for the length of the call, muzzleOf, combat.cast, combat.hit, fx.impact, fx.spawn, fx.muzzle),
// poseCop, downCop, arrest, die, inLine (u3). On combat: cast. On combat.bodies.env: ground. Every wrapper passes straight through unless the player is underground or an officer is.
// Nothing here runs, and nav.js / police-nav.js are not fetched, until the heat code's body is running (it starts on the player's first crime) and the player steps onto a
// stair. With the police off (?heat=0 / none, ?guns=0) the part does nothing at all.
export async function install(game, S) {
  const g = game, P = g.P, pl = g.player, meta = S.meta, LAYER = S.LAYER, EN = S.entrances, Walk = S.Walk, zW = meta.zWalk, W2 = meta.wStair / 2, lO = meta.lOpen, zPof = (t) => t.T.z + t.train.floorY;      /* a platform's height is its train's floor (stations need not all lie at one depth) */
  const N = { follow: 0, under: 0, board: 0, alight: 0, rode: 0, exit: 0, released: 0, inWall: 0, shots: 0, noShot: 0, wallHits: 0, downUnder: 0, cuffed: 0, steps: 0 };
  const st = (S.police = { on: false, hooked: false, why: '', n: N, first: null, log: [], nav: { paths: 0, ms: 0, worst: 0 } });
  if (/^(0|none|off)$/.test(P.get('guns') || '') || /^(0|none)$/.test(P.get('heat') || '')) { st.why = 'the police are off'; return st; }
  st.on = true;
  const LOG = P.has('heatlog') || P.has('sublog'), say = (s) => { const l = (H ? H.t.toFixed(1) : '-') + ' ' + s; if (st.log.length < 300) st.log.push(l); if (LOG) console.log('[subway] police: ' + l); };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a)), _o = { x: 0, y: 0 };
  let H = null, c = null, NAV = null, PN = null, loading = null, lastEnt = S.entry || null, cur = null, active = false;
  const K3 = { x: 0, y: 0, z: 0 }, B = { n: 1, paths: 0, ms: 0 }, doomed = [], deadUnder = [];
  const under = (k) => !!k.sub && k.sub.phase === 'under';
  const ABOARD = P.get('heataboard') !== '0';      /* u3: an officer below has his own people-in-the-line test, and one aboard walks up the aisle when his bursts are refused (?heataboard=0 = as u2) */
  const DOORP = P.get('heatdoor') !== '0';      /* u4: a door whose place on the platform is taken by a column: to the doorway's threshold along a line that can be walked (?heatdoor=0 = as u3) */
  const WAYS = P.get('heatway') !== '0'; let wayN = 1, plT = null;      /* u2: ways on the street (one found a game step at most); the train he boarded */
  const SW = (u) => PN.strict(u.walk);      // the station's collision as the officers use it (police-nav.js: the whole body kept off a stair's sides)
  const streetZ = (x, y) => (g.statics.onSidewalk(x, y) ? 0.15 : 0);

  const tryHook = () => { if (H) return true; if (!st.on) return false; c = g.combat; const h = c && c.heat; if (!h || typeof h.stepCop !== 'function' || typeof h.walkTo !== 'function') return false;      /* (the heat code's body only exists once there has been a first crime) */
    if (!PN) { loading ||= Promise.all([import('../subway/nav.js'), import('./heatundernav.js')]).then(([a, b]) => { NAV = a; PN = b; }).catch((e) => { st.on = false; st.why = 'not loaded: ' + (e && e.message); }); return false; }
    try { hook(h); H = h; st.hooked = true; say('hooked into the heat code'); } catch (e) { st.on = false; st.why = 'hook failed: ' + (e && (e.stack || e.message)); console.warn('[subway] police: ' + st.why); }
    return !!H; };
  S.on('enter', (u, e) => { lastEnt = e; tryHook(); });
  S.on('step', (dt) => { if (!st.on) return; if (!H) { tryHook(); return; } try { afterStep(dt); } catch (e) { oops('after', e); } });
  S.on('deep', (on) => { if (H && on) fxLayers(); });
  S.on('board', (t) => {
    plT = t;
    if (!H?.level || H.dead) return;
    for (const k of H.cops) {
      if (k.hp <= 0 || k.mode === 'leave' || !under(k) || k.sub.u !== S.unit) continue;
      k.sub.intercept = t; k.sub.boardDoor = null;
    }
  });
  // Stage a pursuing officer ahead while the player's train is still out in the tunnel.
  function meetTrain(k, to, train) {
    const s = k.sub, walk = SW(to), floor = zPof(train);
    if (!H.level || H.dead || k.mode === 'leave') return false;
    const nearest = doorOf(train, S.ride.lz);
    if (!nearest) return false;
    const distance = door => Math.abs(door.z - S.ride.lz);
    const doors = train.train.doors.filter(door => door.side === train.side && door.car === nearest.car)
      .sort((a, b) => distance(a) - distance(b));
    for (const fallback of [false, true]) for (const door of doors) {
      // A platform column can block the usual waiting point. At a transfer,
      // stage on the clear platform strip beside the openable door instead.
      const edge = train.side * (train.train.width / 2 + 0.8);
      const xDoor = train.mx + train.ux * door.z - train.uy * edge;
      const yDoor = train.my + train.uy * door.z + train.ux * edge;
      const blocked = !walk.free(xDoor, yDoor, floor, PN.R);
      if (fallback && !blocked) continue;
      const backs = blocked && !fallback ? [0.5] : [1.4, 2.2, 3];
      for (const along of (blocked && !fallback ? [0] : [0, -1, 1, -2, 2])) for (const back of backs) {
        const lx = train.side*(train.train.width/2 + back), lz = door.z + along;
        const x = train.mx + train.ux*lz - train.uy*lx, y = train.my + train.uy*lz + train.ux*lx;
        const f = walk.free(x, y, floor, PN.R);
        if (!f || f.k !== 'platform') continue;
        // The walk grid contains fixtures. Other officers waiting for this train
        // also need their own standing space when several miss the same departure.
        if (H.cops.some(other => other !== k && other.hp > 0 && other.sub?.u === to &&
            !other.sub.ride && Math.abs(other.z - floor) < 1 &&
            Math.hypot(other.x - x, other.y - y) < 2 * PN.R + 0.1)) continue;
        s.u = to; s.phase = 'under'; s.ride = s.path = s.pg = s.ex = s.sg = null;
        s.intercept = train; s.boardDoor = door;
        // Queue behind the last officer staged for this doorway.
        s.boardBehind = H.cops.filter(q => q !== k && q.hp > 0 &&
          q.sub?.u === to && q.sub.intercept === train && q.sub.boardDoor === door).at(-1);
        s.p.x = k.x = x; s.p.y = k.y = y; s.p.z = s.vz = k.z = floor;
        k.path = null; layers(k); setOrder(k, 0);
        return true;
      }
    }
    return false;
  }
  S.on('hop', (from, to, nt) => { const was = plT; plT = nt; if (!H) return; for (const k of H.cops.slice()) { const s = k.sub; if (!s || s.u !== from) continue;
      if (s.phase === 'under' && s.ride && (was ? s.ride.t === was : s.ride.t.T.id === nt.T.id) && s.ride.in && k.hp > 0) { S.transferAisle(s.ride, nt.train); s.ride.t = nt; s.ride.exitDoor = null; s.intercept = nt; s.boardDoor = null; s.u = to; s.sg = s.path = null; placeRider(k); k.z = s.vz = s.p.z; N.rode++; say('officer ' + k.n + ' rides with him to ' + to.st.name); }
      else if (s.phase === 'under' && !s.ride?.in && k.hp > 0 && meetTrain(k, to, nt)) continue;
      else if (s.phase === 'under') { if (k.hp > 0) release(k, 'left behind at ' + from.st.name); } else k.sub = null; } });
  S.on('train', (kind, t, u) => { if (!H) return; if (kind === 'leave') { for (const k of H.cops) { const s = k.sub; if (!s || s.phase !== 'under' || !s.ride || s.ride.t !== t || s.ride.in) continue; const m = S.tMap(t, t.side * (t.train.width / 2 + 0.8), s.ride.lz), zP = zPof(t); s.ride = null; if (u.walk && SW(u).free(m[0], m[1], zP, 0.3)) { s.p.x = k.x = m[0]; s.p.y = k.y = m[1]; } s.p.z = zP; s.path = null; } return; } if (kind !== 'gone') return; for (const k of H.cops.slice()) if (under(k) && k.sub.ride && k.sub.ride.t === t && k.hp > 0) release(k, 'carried off by a train he was alone on'); });
  S.on('drop', (u) => { if (!H) return; for (const k of H.cops.slice()) { const s = k.sub; if (!s || s.u !== u) continue; if (s.phase === 'under' && k.hp > 0) release(k, 'his station was put away'); else k.sub = null; } for (let i = deadUnder.length - 1; i >= 0; i--) if (deadUnder[i].u === u) deadUnder.splice(i, 1); });
  const oops = (w, e) => { st.errs = st.errs || {}; if (st.errs[w]) return; st.errs[w] = String((e && (e.stack || e.message)) || e).slice(0, 400); console.warn('[heat] under ' + w + ': ' + st.errs[w]); };
  const release = (k, why) => { k.sub = null; if (k.gone) return; k.hp = 0; k.gone = true; const i = H.cops.indexOf(k); if (i >= 0) H.cops.splice(i, 1); try { H.release(k); } catch (e) {} N.released++; say('officer ' + k.n + ' let go: ' + why); };

  // ---------------------------------------------------------------- what is drawn: our layer (the city's is not drawn below), the stair's draw order
  const parts = (k) => [k.vis && k.vis.object, k.vis && k.vis.kitM, k.gun, k.capO && k.capO.group, k.vestO, k.beltO, k.badgeO];
  const layers = (k) => { for (const o of parts(k)) if (o) o.traverse((q) => q.layers.enable(LAYER)); if (k.guns) for (const n in k.guns) k.guns[n].traverse((q) => q.layers.enable(LAYER)); };
  const setOrder = (k, v) => { const s = k.sub; if (!s || s.ord === v) return; s.ord = v; for (const o of parts(k)) if (o) o.traverse((q) => { if (q.isMesh) q.renderOrder = v; }); };
  const fxLayers = () => { try { const fx = c.fx; if (fx && fx.group) fx.group.traverse((q) => q.layers.enable(LAYER)); if (fx && fx.light) fx.light.layers.enable(LAYER); for (const n in c.guns || {}) if (c.guns[n]) c.guns[n].traverse((q) => q.layers.enable(LAYER)); } catch (e) { oops('layers', e); } };

  // ---------------------------------------------------------------- trains
  const tOpen = (t) => t.state === 'dwell' && t.doors > 0.85;
  const doorOf = (t, lz) => { let b = null; for (const d of t.train.doors) if (d.side === t.side && (!b || Math.abs(d.z - lz) < Math.abs(b.z - lz))) b = d; return b; };
  const sameCar = (t, a, b) => { for (const w of t.train.walk) if (a >= w.z0 - 0.4 && a <= w.z1 + 0.4) return b >= w.z0 - 0.4 && b <= w.z1 + 0.4; return false; };
  const placeRider = (k) => { const s = k.sub, R = s.ride, m = S.tMap(R.t, R.lx, R.lz); k.x = s.p.x = m[0]; k.y = s.p.y = m[1]; s.p.z = R.t.T.z + R.t.train.floorY; };
  // A closing doorway must settle even when pursuit movement is idle.
  const settleDoorway = (k) => {
    const s = k.sub, R = s.ride;
    if (tOpen(R.t)) return true;
    if (R.in && R.exitDoor) {
      const inside = R.t.train.width / 2 - 0.5;
      R.lx = clamp(R.lx, -inside, inside);
      R.exitDoor = null;
    } else if (!R.in && R.landing) {
      const [x, y, z] = R.landing;
      s.ride = s.path = null;
      k.x = s.p.x = x; k.y = s.p.y = y; k.z = s.vz = s.p.z = z;
      return false;
    }
    return true;
  };
  // an officer aboard: along the aisle to the player, or to the nearest door and out when it is open
  const rideWalk = (k, G, v, dt) => { const s = k.sub, R = s.ride, t = R.t, tr = t.train, Wt = tr.width / 2, step = Math.min(v, 2.6) * dt, x0 = R.lx, z0 = R.lz, side = t.side;
    const toward = (a, b) => a + clamp(b - a, -step, step);
    if (!settleDoorway(k)) return 0;
    if (!R.in) { R.lx = toward(R.lx, 0); if (Math.abs(R.lx) < Wt - 0.5) R.in = true; }      // through the doorway first
    else if (G.player && G.ride && G.ride.t === t && sameCar(t, R.lz, G.ride.lz)) {
      // If the player reboards during our exit, step back through the same doorway.
      if (R.exitDoor && Math.abs(R.lx) > Wt - 0.5) R.lx = toward(R.lx, 0);
      else { R.exitDoor = null; if (Math.abs(R.lx) > 0.12 && Math.abs(R.lz - G.ride.lz) > 0.5) R.lx = toward(R.lx, 0); else R.lz = toward(R.lz, G.ride.lz); }
    }
    else {
      let d = doorOf(t, R.lz);
      if (tOpen(t)) {
        if (!R.exitDoor) {
          const walk = SW(s.u), floor = zPof(t), car = d.car;
          let best = null, distance = Infinity;
          for (const door of tr.doors) {
            const dz = Math.abs(door.z - R.lz);
            if (door.side !== side || door.car !== car || dz >= distance) continue;
            for (const back of [0.8, 0.5]) {
              const [x, y] = S.tMap(t, side * (Wt + back), door.z);
              if (walk.free(x, y, floor, PN.R)?.k !== 'platform') continue;
              best = door; distance = dz; R.exitBack = back; break;
            }
          }
          R.exitDoor = best;
        }
        if (!R.exitDoor) return 0;
        d = R.exitDoor;
      } else R.exitDoor = null;
      if (Math.abs(R.lz - d.z) > 0.12) { if (Math.abs(R.lx) > 0.12) R.lx = toward(R.lx, 0); else R.lz = toward(R.lz, d.z); }
      else if (tOpen(t)) { R.lz = d.z; R.lx = toward(R.lx, side * (Wt + R.exitBack)); if (R.lx * side >= Wt + R.exitBack) { const m = S.tMap(t, R.lx, R.lz), zP = zPof(t), f = s.u.walk && SW(s.u).free(m[0], m[1], zP, PN.R); if (f?.k === 'platform') { s.ride = null; s.boardDoor = null; s.p.x = k.x = m[0]; s.p.y = k.y = m[1]; s.p.z = zP; s.path = null; N.alight++; say('officer ' + k.n + ' steps off the train'); return step / dt; } R.lx = x0; } } }
    for (const w of tr.walk) if (R.lz >= w.z0 - 0.4 && R.lz <= w.z1 + 0.4) { if (Math.abs(R.lx) < Wt - 0.5) R.lz = clamp(R.lz, w.z0 + 0.25, w.z1 - 0.25); break; }
    const dlx = R.lx - x0, dlz = R.lz - z0, m = Math.hypot(dlx, dlz); if (m > 1e-4) s.h = Math.atan2(t.uy * dlz + t.ux * dlx, t.ux * dlz - t.uy * dlx); placeRider(k); return m / dt; };

  // ---------------------------------------------------------------- where an officer underground is going
  const pp = () => (S.own ? S.pos : { x: pl.x, y: pl.y, z: streetZ(pl.x, pl.y) });
  const exitGoal = (k, nx, ny) => { const s = k.sub; if (!s.ex || H.t - s.exT > 2.5) { let b = null, bd = 1e9; for (const i of s.u.st.ent) { const e = EN[i]; if (!e.open) continue; const d = Math.hypot(e.x - nx, e.y - ny) + 0.35 * Math.hypot(e.x - k.x, e.y - k.y); if (d < bd) { bd = d; b = e; } }
      if (b) { const f = s.u.st.floors.find((q) => q.k === 'street' && q.ent === b.id), x = b.x + b.ca * 0.5, y = b.y + b.sa * 0.5; s.ex = { x, y, z: f ? Walk.zAt(f, Walk.u(f, x, y)) : zW - 0.3, exit: true, e: b }; s.exT = H.t; } }
    return s.ex || { x: k.x, y: k.y, z: s.p.z }; };
  const searchGoal = (k) => { const s = k.sub, walk = SW(s.u);
    if (K3.unit === s.u && s.k3 !== K3.t) { s.k3 = K3.t; s.sgN = 0; if (Math.hypot(K3.x - s.p.x, K3.y - s.p.y) > 1.5 || Math.abs(K3.z - s.p.z) > 1) { s.sg = { x: K3.x, y: K3.y, z: K3.z, search: true }; s.sgT = H.t + 20; N.toLast = (N.toLast || 0) + 1; return s.sg; } }      /* u1: first to where he was last seen */
    if (s.sg && H.t < s.sgT && Math.hypot(s.sg.x - s.p.x, s.sg.y - s.p.y) > 1.2) return s.sg;
    const center = K3.unit === s.u ? K3 : s.p;
    const plat = (s.sgN = (s.sgN || 0) + 1) % 2 === 1;      /* u1: then the platforms, every other time */
    const fl = s.u.st.floors, pfl = plat ? fl.filter((q) => q.k === 'platform') : fl; for (let i = 0; i < 12; i++) { const F = i < 8 && pfl.length ? pfl : fl, f = F[(Math.random() * F.length) | 0]; if (!f || f.stair || f.k === 'pit' || f.k === 'street' || Math.hypot(f.x - center.x, f.y - center.y) > 45 + f.l / 2) continue;
      const uu = (Math.random() - 0.5) * Math.max(0, Math.min(f.l, 60) - 1.2) + (f.l > 60 ? clamp(Walk.u(f, center.x, center.y), -f.l / 2 + 30, f.l / 2 - 30) : 0), vv = (Math.random() - 0.5) * Math.max(0, f.w - 1.2), x = f.x + f.ca * uu - f.sa * vv, y = f.y + f.sa * uu + f.ca * vv;
      if (walk.free(x, y, f.z0, PN.R)) { s.sg = { x, y, z: f.z0, search: true }; s.sgT = H.t + 12; return s.sg; } }
    return (s.sg = { x: center.x, y: center.y, z: center.z, search: true }); };
  const goal = (k) => { const s = k.sub;
    if (k.mode === 'leave') return exitGoal(k, k.x, k.y);
    if (!S.own || S.unit !== s.u) { const T = H.seen ? pl : H.lkp; return exitGoal(k, T.x, T.y); }      // he is back on the street: up the stair nearest to where he is (or was last seen)
    if ((S.ride && s.intercept === S.ride.t) || H.seen || k.see || H.unseenT < 6) { const p = S.pos; return { x: p.x, y: p.y, z: p.z, player: true, ride: S.ride }; }
    return searchGoal(k); };

  // ---------------------------------------------------------------- an officer's line of sight when the ground is in it
  const seenBy = (k, ox, oy, street) => { const own = S.own, ku = !!(k && under(k)); if (!own && !ku) return street();
    const u = own ? S.unit : k.sub.u, walk = u && u.walk; if (!walk) return false;
    if (!ku && !street()) return false;      // an officer on the street: buildings and vans hide a man as they always do, and then the ground does
    if (ku && own && k.sub.u !== u) return false;
    const R = own ? S.ride : null, kr = ku ? k.sub.ride : null; if (R && kr) return kr.t === R.t && sameCar(R.t, kr.lz, R.lz);
    const p = pp(), a = [ox, oy, (k ? k.z : streetZ(ox, oy)) + 1.5], b = [p.x, p.y, p.z + 1.35];
    if (walk.sight(a, b, 0.4, 0.2) >= 0.999) return true; b[2] = p.z + 1.62; return walk.sight(a, b, 0.4, 0.2) >= 0.999; };
  // a train between an officer and him (one aboard, one not, or two trains): its doors must be open for a shot
  const trainBlocks = (k) => { const R = S.own ? S.ride : null, kr = under(k) ? k.sub.ride : null; if (!R && !kr) return false; if (R && kr && R.t === kr.t) return false; const t = R ? R.t : kr.t; return !(t.state === 'dwell' && t.doors > 0.5) || !!(R && kr); };

  function hook(h) {
    const walkTo0 = h.walkTo.bind(h), stepCop0 = h.stepCop.bind(h), los0 = h.los.bind(h), sight0 = h.sight.bind(h), step0 = h.step.bind(h), cover0 = h.coverNear.bind(h), clear0 = h.clearFrom.bind(h), shoot0 = h.copShoot.bind(h), pose0 = h.poseCop.bind(h), down0 = h.downCop.bind(h), arrest0 = h.arrest.bind(h), die0 = h.die.bind(h);
    fxLayers();
    h.step = function (dt) {
      while (doomed.length) { const k = doomed.pop(); if (h.cops.includes(k)) release(k, 'lost under the city'); }
      let any = false; for (const k of h.cops) if (k.sub && k.hp > 0) { any = true; break; } active = S.own || any; B.n = 1; wayN = 1;
      if (S.own) { pl.x = S.pos.x; pl.y = S.pos.y; /* (the game's own step has moved him by the street's rules; subway.js puts him back after: the police reckon with where he is) */ if (S.pos.z < -0.8) h.runT = h.t; /* nor is he run over by the traffic on the street above him */ }
      return step0(dt); };
    h.sight = function () { sight0(); if (!active) return; const own = S.own, p = pp();
      for (const k of h.cops) { if (k.hp <= 0) continue; if (own || under(k)) k.dist = Math.hypot(k.dist, k.z - p.z); if (k.see) k._subSeen = h.t; }
      if (h.seen) { K3.unit = own ? S.unit : null; K3.x = p.x; K3.y = p.y; K3.z = p.z; K3.t = h.t; } };
    h.los = function (ax, ay, bx, by) { if (!active) return los0(ax, ay, bx, by);
      const toP = bx === pl.x && by === pl.y, fromP = !toP && ax === pl.x && ay === pl.y; if (!toP && !fromP) return los0(ax, ay, bx, by);
      const ox = toP ? ax : bx, oy = toP ? ay : by; let k = null; if (cur && cur.x === ox && cur.y === oy) k = cur; else for (const q of h.cops) if (q.x === ox && q.y === oy && q.hp > 0) { k = q; break; }
      return seenBy(k, ox, oy, () => los0(ax, ay, bx, by)); };
    h.coverNear = function (x, y, r, k, clear) { if (k && k.sub) return null; /* the cars they would hide behind are on the street */ return cover0(x, y, r, k, clear); };
    h.clearFrom = function (x, y) { const k = cur; if (!active || !(S.own || (k && under(k)))) return clear0(x, y); const u = S.own ? S.unit : k.sub.u, walk = u && u.walk; if (!walk) return false; const p = pp(), a = [x, y, (k ? k.z : streetZ(x, y)) + 1.3]; return walk.sight(a, [p.x, p.y, p.z + 1.2], 0.4, 0.2) >= 0.999 || walk.sight(a, [p.x, p.y, p.z + 1.6], 0.4, 0.2) >= 0.999; };
    h.poseCop = function (k, tx, ty, tz, dt) { if (active && S.own) tz = (h.seen || h.level === 0 ? S.pos.z : K3.z) + 1.25; return pose0(k, tx, ty, tz, dt); };

    // ---- who follows: an officer on foot who has him in sight (or had, a moment ago) when he is on his way down
    const follow = (k) => { if (!S.own || !S.unit || S.unit.state !== 'ready' || !S.unit.walk || k.get || k.mode === 'leave' || !(h.level > 0) || h.dead || S.pos.z > zW - 0.6) return;
      if (!(k.see || h.t - (k._subSeen ?? -99) < 2.5 || (lastEnt && Math.hypot(k.x-lastEnt.x,k.y-lastEnt.y) < 35))) return;
      const floorEntry = EN[S.floor?.ent];
      const e = lastEnt?.st === S.unit.st.id ? lastEnt : floorEntry;
      if (!e || e.st !== S.unit.st.id) return;
      k.sub = { phase: 'street', e, u: S.unit, t0: h.t, id: k.n, p: { x: k.x, y: k.y, z: zW }, vz: k.z, trail: [], lead: 0 }; N.follow++; layers(k); say('officer ' + k.n + ' saw him go down entrance ' + e.id + ': after him (' + Math.hypot(k.x - e.x, k.y - e.y).toFixed(0) + ' m from the stair)'); };
    const sendTo = (k, x, y) => { if (Math.hypot(x - k.x, y - k.y) < 1.5) x = k.x + 3; k.post = { x, y }; k.cover = null; k.mode = 'move'; k.dodge = false; };
    const goUnder = (k) => { const s = k.sub, e = s.e, walk = SW(s.u), vv0 = clamp(-(k.x - e.x) * e.sa + (k.y - e.y) * e.ca, -(W2 - 0.36), W2 - 0.36);
      for (const [uu, vv] of [[-0.3, vv0], [-0.3, 0], [0.15, 0]]) { const x = e.x + e.ca * uu - e.sa * vv, y = e.y + e.sa * uu + e.ca * vv, f = walk.free(x, y, zW, PN.R); if (!f) continue;
        s.phase = 'under'; s.p.x = k.x = x; s.p.y = k.y = y; s.p.z = PN.zOn(f, x, y); s.vz = k.z; s.tU = h.t; s.path = null; k.path = null; N.under++; say('officer ' + k.n + ' on the stair of entrance ' + e.id + ' after ' + (h.t - s.t0).toFixed(1) + ' s'); return true; }
      return false; };
    // 0 = ours this step, 1 = an ordinary officer on the street again, 2 = nothing to stand on (his station is gone): he is let go after the step
    const pre = (k, dt) => { const s = k.sub, u = s.u;
      if (!u || u.state !== 'ready' || !u.walk) { if (s.phase === 'under') { doomed.push(k); return 2; } k.sub = null; return 1; }
      if (s.phase === 'street') { if (!S.own || S.unit !== u || h.t - s.t0 > 45 || k.mode === 'leave' || h.level === 0) { k.sub = null; return 1; }
        if (!k.see || k.mode !== 'hold') sendTo(k, s.e.x - s.e.ca * 0.35, s.e.y - s.e.sa * 0.35); return 0; }
      if ((s.lay = (s.lay || 0) - dt) <= 0) { s.lay = 1.5; layers(k); }
      if (s.ride) placeRider(k); k.cover = null; k.z = s.vz;
      if (k.mode !== 'leave' && (!k.see || (s.ride && !S.ride && S.own && tOpen(s.ride.t)) || (S.ride && !s.ride && s.intercept === S.ride.t))) { const G = goal(k); sendTo(k, G.x, G.y); }
      else if (ABOARD && s.ride && !s.ride.in && k.mode !== 'leave' && S.own && S.ride && S.ride.t === s.ride.t && s.ride.t.state === 'dwell') { sendTo(k, S.pos.x, S.pos.y); N.inDoor = (N.inDoor || 0) + 1; }      /* u3: through the doorway, all the way in */
      else if (ABOARD && s.ride && k.see && k.mode !== 'leave' && (k._nl || 0) >= 2 && h.t - k._nlT < 2.5 && S.own && S.ride && S.ride.t === s.ride.t && !h.dead) { sendTo(k, S.pos.x, S.pos.y); N.close = (N.close || 0) + 1; }      /* u3: aboard with him and twice refused a shot: up the aisle to him */
      else if (k.mode === 'leave' && !k.post) k.post = { x: k.x + 3, y: k.y };
      return 0; };
    const post = (k, dt) => { const s = k.sub; if (!s || s.phase !== 'under' || k.hp <= 0 || k.gone) return; if (!s.u.walk) return; const walk = SW(s.u); N.steps++;
      if (s.ride) { placeRider(k); k.z = s.vz = s.p.z; setOrder(k, 0); return; }
      if (k.x !== s.p.x || k.y !== s.p.y) { const f = walk.free(k.x, k.y, s.p.z, PN.R); if (f) { s.p.x = k.x; s.p.y = k.y; s.p.z = PN.zOn(f, k.x, k.y); } else { k.x = s.p.x; k.y = s.p.y; } }      // (knocked back by a hit, shouldered by a mate: only to where a body can stand)
      const f = walk.floorAt(s.p.x, s.p.y, s.p.z, 0.6), zt = f ? PN.treadZ(meta, f, s.p.x, s.p.y) : s.p.z; s.vz += (zt - s.vz) * Math.min(1, dt * 16); if (Math.abs(zt - s.vz) > 0.6) s.vz = zt; k.z = s.vz;
      if (!walk.point(s.p.x, s.p.y, s.p.z)) N.inWall++;      /* (the middle of the body in a wall, a column or off the floor. walk.js tests a ring of eight points, so a 0.3 m body can brush the corner of a column for a frame: not counted) */
      if (f) { const nm = f.k === 'street' ? 'stair ' + f.ent : f.k === 'pstair' ? 'platform stair' : f.k; if (s.trail[s.trail.length - 1] !== nm) { s.trail.push(nm); if (f.k === 'platform' && !st.first) { st.first = { n: k.n, s: +(h.t - s.t0).toFixed(1), under: +(h.t - s.tU).toFixed(1), way: s.trail.join(' > ') }; say('officer ' + k.n + ' is on the platform ' + st.first.s + ' s after he set off (' + st.first.way + ')'); } } setOrder(k, f.k === 'street' ? -15 : 0); } };
    h.stepCop = function (k, dt) { if (!active) return stepCop0(k, dt);
      if (!k.sub) { follow(k); if (!k.sub) return stepCop0(k, dt); }
      let r = 0; try { r = pre(k, dt); } catch (e) { oops('pre', e); k.sub = null; r = 1; } if (r === 2) return; if (r === 1) return stepCop0(k, dt);
      cur = k; try { stepCop0(k, dt); } finally { cur = null; } try { post(k, dt); } catch (e) { oops('post', e); } };

    // ---- how he gets there
    // ---- u2: a way on the street round what stands on it (the street's collision set g.statics, and cars that stand), for an officer on his way to the stair
    const sFree = (x, y, r) => g.statics.resolve(x, y, r, _o) === 0;
    const sLine = (ax, ay, bx, by) => { const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.3)); for (let i = 1; i <= n; i++) if (!sFree(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, 0.3)) return false; return true; };
    const streetWay = (k, tx, ty) => { const t0 = performance.now(), C = 0.35, pad = 10, x0 = Math.min(k.x, tx) - pad, y0 = Math.min(k.y, ty) - pad, nx = Math.ceil((Math.abs(k.x - tx) + 2 * pad) / C) + 1, ny = Math.ceil((Math.abs(k.y - ty) + 2 * pad) / C) + 1, n = nx * ny; if (n > 80000) return null;
      const boxes = [], addB = (v, sp) => { if (!v || !v.def || Math.abs(sp || 0) > 1 || v.x < x0 - 4 || v.y < y0 - 4 || v.x > x0 + nx * C + 4 || v.y > y0 + ny * C + 4) return; boxes.push([v.x, v.y, Math.cos(v.h), Math.sin(v.h), v.def.len / 2 + 0.5, v.def.wid * 0.45 + 0.5]); };
      try { for (const v of g.vehicles) addB(v, Math.hypot(v.vx || 0, v.vy || 0)); for (const v of g.parked.near((k.x + tx) / 2, (k.y + ty) / 2, Math.hypot(k.x - tx, k.y - ty) / 2 + pad + 4, [])) addB(v, 0); for (const v of g.traffic.cars) addB(v, v.v); } catch (e2) {}
      const inBox = (x, y) => { for (const b of boxes) { const ex = x - b[0], ey = y - b[1]; if (Math.abs(ex * b[2] + ey * b[3]) < b[4] && Math.abs(-ex * b[3] + ey * b[2]) < b[5]) return true; } return false; };
      const fr = new Int8Array(n), free = (i) => { if (fr[i]) return fr[i] > 0; const x = x0 + (i % nx) * C, y = y0 + ((i / nx) | 0) * C, f = sFree(x, y, 0.34) && !inBox(x, y); fr[i] = f ? 1 : -1; return f; };
      const near = (x, y, own) => { const ci = Math.round((x - x0) / C), cj = Math.round((y - y0) / C); let b = -1, bd = 1e9; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const q = j * nx + i, dd = di * di + dj * dj; if (dd < bd && (own && dd === 0 ? (fr[q] = 1) : free(q))) { bd = dd; b = q; } } return b; };
      const a = near(k.x, k.y, true), z = near(tx, ty, false); if (a < 0 || z < 0) return null;
      const gs = new Float32Array(n).fill(1e9), pv = new Int32Array(n).fill(-1), done = new Uint8Array(n), hp = [], zx = z % nx, zy = (z / nx) | 0, hh = (i) => Math.hypot((i % nx) - zx, ((i / nx) | 0) - zy);
      const push = (i, f) => { hp.push([f, i]); let c = hp.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hp[p][0] <= hp[c][0]) break; const t = hp[p]; hp[p] = hp[c]; hp[c] = t; c = p; } };
      const pop = () => { const top = hp[0], l = hp.pop(); if (hp.length) { hp[0] = l; let c = 0; for (;;) { const a2 = 2 * c + 1, b2 = a2 + 1; let m = c; if (a2 < hp.length && hp[a2][0] < hp[m][0]) m = a2; if (b2 < hp.length && hp[b2][0] < hp[m][0]) m = b2; if (m === c) break; const t = hp[m]; hp[m] = hp[c]; hp[c] = t; c = m; } } return top; };
      gs[a] = 0; push(a, hh(a)); let found = false, it = 0;
      while (hp.length && it++ < 30000) { const i = pop()[1]; if (done[i]) continue; done[i] = 1; if (i === z) { found = true; break; } const ix = i % nx, iy = (i / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const jx = ix + di, jy = iy + dj; if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue; const q = jy * nx + jx; if (done[q] || !free(q)) continue; if (di && dj && (!free(iy * nx + jx) || !free(jy * nx + ix))) continue; const c = gs[i] + (di && dj ? 1.414 : 1); if (c < gs[q]) { gs[q] = c; pv[q] = i; push(q, c + hh(q)); } } }
      st.nav.ways = (st.nav.ways || 0) + 1; if (!found) { st.nav.wayMs = (st.nav.wayMs || 0) + performance.now() - t0; return null; }
      const pts = []; for (let i = z; i >= 0 && i !== a; i = pv[i]) pts.unshift([x0 + (i % nx) * C, y0 + ((i / nx) | 0) * C]); pts.push([tx, ty]);
      /* fewer points: from where he is, the farthest one that can be walked to in a straight line */ const clear = (p, q) => { if (!sLine(p[0], p[1], q[0], q[1])) return false; const d = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(d / 0.4); for (let i = 1; i < m; i++) if (inBox(p[0] + (q[0] - p[0]) * i / m, p[1] + (q[1] - p[1]) * i / m)) return false; return true; };
      const out = []; let cur = [k.x, k.y], i = 0; while (i < pts.length) { let j = Math.min(pts.length - 1, i + 40); while (j > i && !clear(cur, pts[j])) j--; out.push(pts[j]); cur = pts[j]; i = j + 1; }
      const ms = performance.now() - t0; st.nav.wayMs = (st.nav.wayMs || 0) + ms; if (ms > (st.nav.wayWorst || 0)) st.nav.wayWorst = ms; return out; };
    /* one step along a found way: the heat code's own walkTo without its side steps and its ways by the road junctions (the way found has those in it already): the same body against the street's collision, standing cars and his mates */
    const wayStep = (k, tx, ty, sp, dt) => { const dx = tx - k.x, dy = ty - k.y, d = Math.hypot(dx, dy); if (d < 0.05) return 0; const m = Math.min(sp, d / dt); k.h += clamp(wrapPi(Math.atan2(dy, dx) - k.h), -dt * 9, dt * 9); g.statics.resolve(k.x + (dx / d) * m * dt, k.y + (dy / d) * m * dt, 0.32, _o); k.x = _o.x; k.y = _o.y;
      const box = (v, pad) => { const cs = Math.cos(v.h), sn = Math.sin(v.h), ex = k.x - v.x, ey = k.y - v.y, lx = ex * cs + ey * sn, ly = -ex * sn + ey * cs, hx = v.def.len / 2 + pad, hy = v.def.wid * 0.45 + pad; if (Math.abs(lx) < hx && Math.abs(ly) < hy) { let px = lx, py = ly; if (hx - Math.abs(lx) < hy - Math.abs(ly)) px = Math.sign(lx || 1) * hx; else py = Math.sign(ly || 1) * hy; k.x = v.x + px * cs - py * sn; k.y = v.y + px * sn + py * cs; } };
      try { for (const v of g.parked.near(k.x, k.y, 6, [])) box(v, 0.3); for (const v of g.vehicles) if (Math.abs(v.x - k.x) < 8 && Math.abs(v.y - k.y) < 8) box(v, 0.3); for (const v of g.traffic.cars) if (Math.abs(v.x - k.x) < 8 && Math.abs(v.y - k.y) < 8) box(v, 0.35); } catch (e2) {}
      for (const q of h.cops) if (q !== k && q.hp > 0) { const ex = k.x - q.x, ey = k.y - q.y, dd = Math.hypot(ex, ey); if (dd < 0.7 && dd > 1e-3) { k.x += (ex / dd) * (0.7 - dd) * 0.5; k.y += (ey / dd) * (0.7 - dd) * 0.5; } }
      k.z = streetZ(k.x, k.y); k.path = null; return m; };
    const streetWalk = (k, sp, dt) => { const s = k.sub, e = s.e; let dx = k.x - e.x, dy = k.y - e.y, uu = dx * e.ca + dy * e.sa, vv = -dx * e.sa + dy * e.ca;
      if (!s.lead) s.lead = g.statics.resolve(e.x - e.ca * 2.4, e.y - e.sa * 2.4, 0.34, _o) > 0.05 ? 2 : 1;      // a point in line with the stair, 2.4 m before its top step (the kerb stones and railings stand on the other three sides)
      if (s.lead === 1 && (Math.hypot(uu + 2.4, vv) < 0.9 || (uu < -0.4 && uu > -3.6 && Math.abs(vv) < 0.6))) s.lead = 2;
      const d = s.lead === 1 ? 2.4 : 0.3; let wx = e.x - e.ca * d, wy = e.y - e.sa * d;
      /* u2: the heat code's walkTo steps to one side of a low thing in the way for 0.7 s and then heads for the place again; at a planter, a tree guard or a row of
         street furniture between an officer and the stair that never ends (traced: lanes/gameplay/heat-state/handover-u2/PLAYED.txt). So when the straight line to the
         stair is not free, the way round is found once on a small grid of the street's own collision and walked point by point. ?heatway=0: as u1. */
      if (WAYS) { s.wT = (s.wT || 0) - dt; if (s.wT <= 0) { s.wT = 0.5; const dn = s.way && s.wi < s.way.length ? Math.hypot(s.way[s.wi][0] - k.x, s.way[s.wi][1] - k.y) : 0;
          if (sLine(k.x, k.y, wx, wy)) s.way = null; else if ((!s.way || s.wi >= s.way.length || s.wl !== s.lead || (dn > s.wd - 0.4 && ++s.wS >= 2)) && wayN > 0) { wayN--; s.way = streetWay(k, wx, wy); s.wi = 0; s.wAt = h.t; s.wl = s.lead; s.wd = 1e9; s.wS = 0; if (s.way) N.ways = (N.ways || 0) + 1; else N.noWay = (N.noWay || 0) + 1; } else { if (dn <= s.wd - 0.4) s.wS = 0; s.wd = dn; } }
        if (s.way) { while (s.wi < s.way.length - 1 && Math.hypot(s.way[s.wi][0] - k.x, s.way[s.wi][1] - k.y) < 0.55) s.wi++; if (s.wi < s.way.length) { wx = s.way[s.wi][0]; wy = s.way[s.wi][1]; } } }
      const r = s.way ? wayStep(k, wx, wy, Math.max(sp, 4.2), dt) : walkTo0(k, wx, wy, Math.max(sp, 4.2), dt, 0.1);
      dx = k.x - e.x; dy = k.y - e.y; uu = dx * e.ca + dy * e.sa; vv = -dx * e.sa + dy * e.ca;
      if (s.lead === 2 && uu > -0.85 && uu < 0.4 && Math.abs(vv) < W2 - 0.05) goUnder(k); else if (k.mode === 'hold' && !k.see) k.mode = 'move';
      return r; };
    const underWalk = (k, tx, ty, sp, dt) => { const s = k.sub, walk = SW(s.u), G = goal(k), v = k.mode === 'leave' ? 2.4 : k.see ? Math.max(sp, 1.6) : G.search ? 3.0 : 4.4;
      // Make space inside before the next officer enters this doorway.
      if (s.ride?.in && G.ride?.t === s.ride.t && Math.abs(s.ride.lx) > 0.12 &&
          h.cops.some(q => q.hp > 0 && q.sub?.boardBehind === k && q.sub.intercept === s.ride.t)) {
        const dx = clamp(-s.ride.lx, -2.6*dt, 2.6*dt);
        s.ride.lx += dx; placeRider(k); return Math.abs(dx)/dt;
      }
      // in his sights: the heat code's own post says how near to come (to arm's length for the cuffs, to the gun's range in a fight)
      const ahead = s.boardBehind;
      if (ahead) {
        if (ahead.hp > 0 && ahead.mode !== 'leave' && G.ride?.t === s.intercept &&
            ahead.sub?.u === s.u && ahead.sub.intercept === s.intercept && (!ahead.sub.ride?.in || Math.abs(ahead.sub.ride.lx) > 0.12)) return 0;
        s.boardBehind = null;
      }
      if (G.player && k.see && (!s.ride && !G.ride || s.ride && G.ride && s.ride.t === G.ride.t && sameCar(s.ride.t, s.ride.lz, G.ride.lz)) && !(ABOARD && s.ride && !s.ride.in)) { const want = Math.hypot(tx - pl.x, ty - pl.y), d3 = Math.hypot(k.x - G.x, k.y - G.y, s.p.z - G.z); if (d3 <= Math.max(want, 1.2)) { k.post = { x: k.x, y: k.y }; return 0; } }
      if (G.ride && !s.ride && G.ride.t.state !== 'dwell') { k.post = { x: k.x, y: k.y }; s.path = null; N.watch = (N.watch || 0) + 1; return 0; }
      let m; if (s.ride) m = rideWalk(k, G, v, dt) * dt;
      else { let T = G; if (G.ride) { const t = G.ride.t, zP = zPof(t), d = (s.intercept === t && s.boardDoor) || doorOf(t, G.ride.lz), q = S.tMap(t, t.side * (t.train.width / 2 + 0.8), d.z); T = { x: q[0], y: q[1], z: zP };
          if (tOpen(t) && Math.hypot(s.p.x - q[0], s.p.y - q[1]) < 0.6 && Math.abs(s.p.z - zP) < 0.5) { s.ride = { t, landing: [s.p.x,s.p.y,s.p.z], lx: t.side * (t.train.width / 2 + 0.8), lz: d.z, in: false }; s.path = null; N.board++; say('officer ' + k.n + ' steps aboard after him'); return 1.5; }
          /* u4: the door place (0.8 m outside the car at the door's middle) is where a platform column stands at about one door in five (traced: lanes/gameplay/heat-state/handover-u4/PLAYED.txt):
             the way found ends beside the column, 0.6 to 0.9 m from the place, and he stood there to the end of the stop. Within 1.8 m of such a place: straight to the doorway's
             threshold (0.5 m outside the car, the door's middle or 0.3 m either side) when that line can be walked, and aboard from there; with the column in that line, first
             straight to the platform's edge strip beside the door. */
          if (DOORP && tOpen(t) && Math.abs(s.p.z - zP) < 0.5 && Math.hypot(s.p.x - q[0], s.p.y - q[1]) < 1.8 && !walk.free(q[0], q[1], zP, PN.R)) for (const dz of [0, 0.3, -0.3, 1.0, -1.0, 1.5, -1.5]) { const lx = t.side * (t.train.width / 2 + 0.5), c2 = S.tMap(t, lx, d.z + dz); if (!walk.free(c2[0], c2[1], zP, PN.R) || !PN.straight(walk, s.p, [c2[0], c2[1], zP])) continue;
            const ex = c2[0] - s.p.x, ey = c2[1] - s.p.y, dd = Math.hypot(ex, ey); if (dd < 0.3) { if (Math.abs(dz) > 0.5) continue; s.ride = { t, landing: [s.p.x,s.p.y,s.p.z], lx, lz: d.z + dz, in: false }; s.path = null; N.board++; N.doorRound = (N.doorRound || 0) + 1; say('officer ' + k.n + ' steps aboard after him (round a column at the door)'); return 1.5; }
            const stp = Math.min(dd, v * dt); walk.move(s.p, (ex / dd) * stp, (ey / dd) * stp, PN.R); k.x = s.p.x; k.y = s.p.y; s.h = Math.atan2(ey, ex); s.path = null; if (!k.see || v > 1.9) k.h += clamp(wrapPi(s.h - k.h), -dt * 9, dt * 9); return stp / dt; } }
        // a mate a few steps ahead who is going to the same place: his way is taken, not found again
        if (!s.path || s.pathT <= 0) for (const q of h.cops) { const qs = q.sub; if (q === k || q.hp <= 0 || !under(q) || qs.u !== s.u || qs.ride || !qs.path || !qs.pg || qs.pi >= qs.path.length || !(qs.pathT > 0.2)) continue; if (Math.hypot(qs.pg.x - T.x, qs.pg.y - T.y) > 1.2 || Math.abs(qs.pg.z - T.z) > 0.5 || Math.hypot(q.x - k.x, q.y - k.y) > 3 || Math.abs(qs.p.z - s.p.z) > 0.6) continue; const j = Math.max(0, qs.pi - 1); if (!PN.straight(walk, s.p, qs.path[j])) continue; s.path = qs.path.slice(j); s.pi = 0; s.pg = { x: qs.pg.x, y: qs.pg.y, z: qs.pg.z }; s.short = qs.short; s.pathT = 1.0; s.redo = false; N.shared = (N.shared || 0) + 1; break; }
        m = PN.underStep(walk, NAV.findPath, s, T, v, dt, B); k.x = s.p.x; k.y = s.p.y;
        for (const q of h.cops) { if (q === k || q.hp <= 0 || !under(q) || q.sub.u !== s.u) continue; const ex = k.x - q.x, ey = k.y - q.y, dd = Math.hypot(ex, ey); if (dd < 0.7 && dd > 1e-3 && Math.abs(q.sub.p.z - s.p.z) < 1) { const nx = k.x + (ex / dd) * (0.7 - dd) * 0.5, ny = k.y + (ey / dd) * (0.7 - dd) * 0.5, f = walk.free(nx, ny, s.p.z, PN.R); if (f) { s.p.x = k.x = nx; s.p.y = k.y = ny; s.p.z = PN.zOn(f, nx, ny); } } }
        if (G.exit && Math.hypot(s.p.x - G.x, s.p.y - G.y) < 0.7 && s.p.z > zW - 1.0) { const e = G.e; setOrder(k, 0); k.x = e.x - e.ca * 0.9; k.y = e.y - e.sa * 0.9; k.z = streetZ(k.x, k.y); k.sub = null; k.path = null; N.exit++; say('officer ' + k.n + ' back up on the street by entrance ' + e.id); return v; } }
      if (s.h !== undefined && (!k.see || v > 1.9)) k.h += clamp(wrapPi(s.h - k.h), -dt * 9, dt * 9);
      return m / dt; };
    h.walkTo = function (k, tx, ty, sp, dt, stop) { const s = k.sub; if (!s) return walkTo0(k, tx, ty, sp, dt, stop); try { return s.phase === 'street' ? streetWalk(k, sp, dt) : underWalk(k, tx, ty, sp, dt); } catch (e) { oops('walk', e); return 0; } };

    // ---- u3: who is in the line of fire of an officer who is BELOW (the player below too). The heat code's own test (heatcore.js inLine) is made for the street: it counts
    // anybody up to 6 m (riders) or 10 m (street people) BEYOND the target in a corridor a metre wide, by place on the map alone. Below that held every burst of an officer
    // standing at arm's length from an armed man (traced: lanes/gameplay/heat-state/handover-u3/PLAYED.txt): a rider beyond him in another train, behind the car's side or
    // on the platform counted, and so did the people on the street overhead. Here, for such an officer: another officer below in the line; a rider in the corridor, in front
    // of the target or beyond him only as far as a round could miss him at that range (0.6 m at arm's length, the heat code's 6 m from 4 m on), and only a rider a round
    // could reach (nothing of the station or of a train between the muzzle and him: combat.cast). The street's people are not in a line under the street.
    const inLine0 = h.inLine.bind(h);
    h.inLine = function (k, ox, oy, tx, ty) { if (!ABOARD || !active || !S.own || !under(k)) return inLine0(k, ox, oy, tx, ty); if (P.get('heatline') === '0') return 0;
      const ex = tx - ox, ey = ty - oy, d = Math.hypot(ex, ey) || 1, ux = ex / d, uy = ey / d, pz = S.pos.z, oz = (k.z || 0) + 1.4;
      for (const q of h.cops) { if (q === k || q.hp <= 0 || !under(q) || Math.abs((q.z || 0) - (k.z || 0)) > 1.5) continue; const px = q.x - ox, py = q.y - oy, f = px * ux + py * uy; if (f >= 0.7 && f <= d - 0.4 && Math.abs(px * uy - py * ux) < 0.42 + 0.02 * Math.min(f, d)) return 2; }
      const far = clamp(2 * (d - 1), 0.6, 6); let Rd = null; try { Rd = c.riders ? c.riders() : null; } catch (e) { Rd = null; } if (!Rd) return 0;
      for (const r of Rd) { const px = r.x - ox, py = r.y - oy, f = px * ux + py * uy; if (f < 0.7 || f > d + far || Math.abs(px * uy - py * ux) > 0.5 + 0.055 * Math.min(f, d)) continue; const lz = oz + (pz + 1.2 - oz) * (f / d); if (!(lz > r.z - 0.5 && lz < r.z + r.hgt + 0.5)) continue;
        const rz = r.z + Math.min(1.2, r.hgt * 0.7) - oz, l = Math.hypot(px, py, rz) || 1; let hit = null; h.copFire = true; try { hit = c.cast(ox, oy, oz, px / l, py / l, rz / l, 0.3, l); } catch (e) { hit = null; } finally { h.copFire = false; }
        if (hit && hit.kind === 'sub' && hit.t < l - 0.35) { N.walled = (N.walled || 0) + 1; continue; } return 1; }
      return 0; };
    // ---- shots: heatcore.js's own copShoot (it aims at his real height and combat.cast stops the round at the station's solids); here only a train between them
    h.copShoot = function (k) { if (!active) return shoot0(k);
      if (trainBlocks(k)) { k.burst = 0; k.fireCd = 0.6 + Math.random() * 0.5; N.noShot++; return false; }
      N.shots++; const r = shoot0(k); if (ABOARD && under(k)) { if (r === false) { k._nl = h.t - (k._nlT ?? -99) < 2.5 ? (k._nl || 0) + 1 : 1; k._nlT = h.t; } else k._nl = 0; } return r; };
    // ---- an officer shot underground falls on the station's floor, not up on the street
    const floorY = (walk, x, y, zr) => { const f = walk.floorAt(x, y, zr, 1.3); return f ? Walk.zAt(f, Walk.u(f, x, y)) : zr; };
    const Bd = c.bodies; if (Bd && Bd.env && typeof Bd.env.ground === 'function') { const g0 = Bd.env.ground; Bd.env.ground = function (x, z) { if (deadUnder.length) for (const d of deadUnder) if (Math.abs(d.k.x - x) < 3.5 && Math.abs(d.k.y + z) < 3.5) return floorY(d.walk, x, -z, d.z); return g0(x, z); }; }
    h.downCop = function (k, hh, force) { if (!under(k) || !c.bodies || !k.sub.u.walk) return down0(k, hh, force);
      const Bo = c.bodies, env0 = Bo.env, walk = k.sub.u.walk, zr = k.sub.p.z, D = { k, u: k.sub.u, walk, z: zr }; deadUnder.push(D); if (deadUnder.length > 8) deadUnder.shift(); N.downUnder++;
      Bo.env = { ground: (x, z) => floorY(walk, x, -z, zr), solid: true, cross: (x0, z0, x1, z1) => !walk.floorAt(x1, -z1, zr, 1.6) };
      try { return down0(k, hh, force); } finally { Bo.env = env0; layers(k); } };
    // ---- cuffed or shot down below: subway.js hands the player back to the street the moment combat says he is down, so the picture goes dark at once and
    // he wakes where the heat code wakes him (see the lane's notes: to show the cuffs or the fall underground, subway.js would have to keep him)
    const dark = () => { if (h.dead) { h.dead.t = Math.max(h.dead.t, 2.95); h.fade = 1; } };
    h.arrest = function () { const below = S.own && !h.dead; arrest0(); if (below && h.dead?.arrest) { N.cuffed++; say('cuffed underground'); dark(); } };
    h.die = function () { const own = S.own; die0(); if (own && h.dead) { say('shot down underground'); dark(); } };
  }
  // after the trains have moved (subway.js 'step'): riders are carried with their car
  const afterStep = (dt) => { st.nav.paths += B.paths; st.nav.ms += B.ms; if (B.ms > st.nav.worst) st.nav.worst = B.ms; B.paths = 0; B.ms = 0;
    for (const k of H.cops) if (under(k) && k.sub.ride && k.hp > 0 && settleDoorway(k)) { placeRider(k); k.z = k.sub.vz = k.sub.p.z; }
    for (let i = deadUnder.length - 1; i >= 0; i--) if (!g.peds.list.includes(deadUnder[i].k)) deadUnder.splice(i, 1); };
  // for the lane's tools: what the police are doing
  st.state = () => { const h = H || (g.combat && g.combat.heat) || {}, cops = (h.cops || []).map((k) => { const s = k.sub, w = s && s.u && s.u.walk, f = w && s.phase === 'under' ? w.floorAt(s.p.x, s.p.y, s.p.z, 0.6) : null; return { n: k.n, hp: Math.round(k.hp), mode: k.mode, see: !!k.see, ph: s ? s.phase : '', x: +k.x.toFixed(1), y: +k.y.toFixed(1), z: +(k.z || 0).toFixed(2), fl: s && s.ride ? 'train' : f ? f.k : '', d: +(k.dist || 0).toFixed(1) }; });
    return { on: st.on, hooked: st.hooked, why: st.why, level: h.level || 0, pts: +(h.pts || 0).toFixed(1), seen: !!h.seen, unseen: +(h.unseenT || 0).toFixed(1), cool: +(h.coolT || 0).toFixed(1), dead: !!h.dead, cops, n: N, first: st.first, nav: { paths: st.nav.paths, ms: +st.nav.ms.toFixed(1), worst: +st.nav.worst.toFixed(1) }, errs: st.errs || null }; };
  return st;
}
