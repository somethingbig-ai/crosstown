// move/footround.js: the player on foot gets round street furniture (gameplay lane, Nov 18; CHIEF 13:52, Matt's trailer at 1:08: "the player walks
// into a pole").   ?footround=0 off: this file is never fetched and the foot step is the game's own as before.
// Two parts, both called from game.js's foot step:
//   steer(pl, a, sp, dt)  THIN things on his course (the game's solid circles up to 0.45 m: lamp posts, signal and sign poles, hydrants, trunks,
//       knocked props; and the street layer's poles, meters, bins, baskets, news boxes, chairs, urns, racks, which the game never collided): the
//       heading he is asked for is turned a little to the open side from a few metres out, so he walks round at his own speed with his shoulders
//       turned, as a person side-steps a pole. The camera follows his course (camH), not the side-step.
//   push(pl, out)         the street layer's furniture that is in no collision world (benches, shelters, kiosks, planters, cafe sets, parked
//       bicycles, bins ...) holds him out: round things as circles, long things (bench, shelter, bicycle) as one capsule, so he slides along
//       an edge with no bumps. A dead-centre walk into a round thing slips off to a side instead of standing still. Walls win: if the game's
//       walls push him back into a thing he stays where he was.
// The kinds and their sizes are the crowd's (crowd/nav.js pedestrianFurnitureRadii: the own half width); what stands above head height is left out.
import { pedestrianFurnitureRadii } from '../crowd/nav.js';

const BODY = 0.3, WALL_R = 0.34, THIN = 0.65, SOFT_THIN = 0.65, CELL = 4, MARGIN = 0.07, MAX_STEER = 0.7;
const LONG = { shelter: 1.4, benchP: 0.55, bike: 0.55, bikeB: 0.55, bikeShare: 0.55, cart: 0.55 };      // half length along the thing's heading (crowd/nav.js furnitureOf)
const SKIP = /^(cone|delin)$/, OWN = { kiosk: 0.5 };      // the drawn kiosk is 0.34 x 0.92 m: the crowd's 0.9 m would stop him visibly short
// The browser's street layer makes most of its furniture solid itself (statics circles tagged 'furniture': bench, kiosk, planter, bin, shelter ...): a list item with
// such a circle on it is left to the game's own collision (no second hold-out); the side-step below reads those circles as it reads a pole.
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function install(game) {
  if (game.footround) return game.footround;
  const st = game.statics, key = (i, j) => i * 100003 + j, _t = { x: 0, y: 0, end: true };
  const R = (game.footround = { on: true, camH: 0, camT: -1, ang: 0, lastT: -9, side: 0, sideO: null, sideT: -9, steerT: -9, dropT: -9, nudgeT: -9, nudgeS: 0, stall: 0, a: 0, sp: 0, dt: 0, grid: new Map(), n: 0, sig: '', sigT: -9,
    stats: { steerSteps: 0, pushes: 0, slips: 0, held: 0, soft: 0, rebuilds: 0, solidAlready: 0, otherSide: 0, bothShut: 0, stalls: 0, nudges: 0 } });

  // ---- the street layer's furniture, as circles and capsules in a 4 m grid; read again when an area's lists arrive or change
  const signature = (F) => { let s = ''; const one = (K) => { let n = 0; for (const k in K) if (K[k] && K[k].list) n += K[k].list.length; s += n + ','; }; if (F.sets) for (const n in F.sets) if (F.sets[n] && F.sets[n].kinds) one(F.sets[n].kinds); if (F.kinds) one(F.kinds); return s + (F.displacedFurniture ? F.displacedFurniture.size : ''); };
  const solidAt = (x, y, e) => { const c = st.cell; for (let i = Math.floor((x - e) / c); i <= Math.floor((x + e) / c); i++) for (let j = Math.floor((y - e) / c); j <= Math.floor((y + e) / c); j++) { const a = st.circ.get(st.key(i, j)); if (a) for (const o of a) if (o.on && o.tag === 'furniture' && Math.hypot(o.x - x, o.y - y) < e) return true; } return false; };
  function rebuild(F) {
    R.grid.clear(); R.n = 0; R.stats.rebuilds++; R.stats.solidAlready = 0;
    const all = []; if (F.sets) for (const n in F.sets) if (F.sets[n] && F.sets[n].kinds && !all.includes(F.sets[n].kinds)) all.push(F.sets[n].kinds); if (F.kinds && !all.includes(F.kinds)) all.push(F.kinds);
    for (const K of all) for (const name in K) {
      const m = pedestrianFurnitureRadii(name); if (!m || SKIP.test(name) || !K[name] || !K[name].list) continue;
      for (const it of K[name].list) {
        if (F.displacedFurniture && F.displacedFurniture.has(it)) continue; if (it[2] > 1) continue;      // on a terrace or a roof
        const sc = it[4] && typeof it[4].s === 'number' ? it[4].s : 1, r = (OWN[name] || m[2]) * sc, L = (LONG[name] || 0) * sc, c = Math.cos(it[3] || 0), sn = Math.sin(it[3] || 0);
        if (solidAt(it[0], it[1], r + L + 0.3)) { R.stats.solidAlready++; continue; }
        const o = { x: it[0], y: it[1], r, L, cx: c, cy: sn, name }; R.n++;
        const e = L + r + BODY + 0.05;      /* every cell his middle can touch it from */ for (let i = Math.floor((o.x - e) / CELL); i <= Math.floor((o.x + e) / CELL); i++) for (let j = Math.floor((o.y - e) / CELL); j <= Math.floor((o.y + e) / CELL); j++) { const k = key(i, j); let a = R.grid.get(k); if (!a) R.grid.set(k, (a = [])); a.push(o); }
      }
    }
    R.stats.soft = R.n;
  }
  function refresh() {
    if (game.t - R.sigT < 1.5) return; R.sigT = game.t;
    const F = game.streets && game.streets.parts && game.streets.parts.furniture; if (!F) return;
    const s = signature(F); if (s !== R.sig) { R.sig = s; rebuild(F); }
  }
  // nearest point of a thing's axis to (x, y): into _t
  const axisPoint = (o, x, y) => { _t.end = true; if (!o.L) { _t.x = o.x; _t.y = o.y; return; } let u = (x - o.x) * o.cx + (y - o.y) * o.cy; u = u < -o.L ? -o.L : u > o.L ? o.L : u; _t.end = u === -o.L || u === o.L; _t.x = o.x + o.cx * u; _t.y = o.y + o.cy * u; };
  const softDepth = (x, y, but) => { let worst = 0; const a = R.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))); if (a) for (const o of a) { if (o === but) continue; axisPoint(o, x, y); const d = o.r + BODY - Math.hypot(x - _t.x, y - _t.y); if (d > worst) worst = d; } return worst; };

  // ---- the side-step. a: the heading asked for (camera + keys). Returns the heading to turn to.
  const cand = [];
  R.steer = (pl, a, sp, dt) => {
    refresh();
    if (game.t - R.lastT > 0.12) { R.camH = pl.h; R.ang = 0; R.sideO = null; R.stall = 0; R.nudgeT = -9; }      // first step of a walk
    R.lastT = game.t; R.a = a; R.sp = sp; R.dt = dt; R.camH += wrapPi(a - R.camH) * Math.min(1, dt * 10); R.camT = game.t;
    const dx = Math.cos(a), dy = Math.sin(a), look = Math.min(3.8, Math.max(2.6, sp * 0.55)), px = pl.x, py = pl.y;
    cand.length = 0;
    const c = st.cell, x0 = Math.min(px, px + dx * look) - 1, x1 = Math.max(px, px + dx * look) + 1, y0 = Math.min(py, py + dy * look) - 1, y1 = Math.max(py, py + dy * look) + 1;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) { const arr = st.circ.get(st.key(i, j)); if (arr) for (const o of arr) if (o.on && o.r <= THIN && !(o.tag && typeof o.tag === 'object')) cand.push(o, o.r + WALL_R + (o.r > 0.45 && o.tag === 'furniture' ? 0.2 : 0)); }      /* a planter's bowl is drawn 0.24 m wider than its solid circle */
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) { const arr = R.grid.get(key(i, j)); if (arr) for (const o of arr) if (!o.L && o.r <= SOFT_THIN && cand.indexOf(o) < 0) cand.push(o, o.r + BODY); }
    let want = 0, bestAlong = 1e9, bestO = null, bestLat = 0, bestNeed = 0;
    for (let k = 0; k < cand.length; k += 2) {
      const o = cand[k], clear = cand[k + 1] + MARGIN, rx = o.x - px, ry = o.y - py, along = rx * dx + ry * dy, lat = dx * ry - dy * rx;      // lat > 0: it stands to his left
      if (along < -0.25 || along > look || Math.abs(lat) >= clear) continue;
      if (along < bestAlong) { bestAlong = along; bestO = o; bestLat = lat; bestNeed = clear - Math.abs(lat); }
    }
    if (bestO) {
      R.steerT = game.t;
      // +1: pass with it on his right (he turns left). A side is shut when a wall, a railing, another solid thing or a bench stands where he would pass.
      const clear = bestNeed + Math.abs(bestLat), shut = (s) => { const qx = bestO.x - dy * s * clear, qy = bestO.y + dx * s * clear; st.resolve(qx, qy, WALL_R, _r); return Math.hypot(_r.x - qx, _r.y - qy) + softDepth(qx, qy, bestO) + (st.raycast(px, py, qx, qy) < 1 ? 1 : 0); };
      if (R.sideO !== bestO || game.t >= R.sideT) {      // chosen when it comes into view, looked at again five times a second
        const sl = shut(1), sr = shut(-1), kept = R.sideO === bestO ? R.side : 0, nat = Math.abs(bestLat) > 0.06 ? (bestLat > 0 ? -1 : 1) : 0;
        const pref = kept || nat || (sr + 0.02 < sl ? -1 : 1);      // dead ahead: the side with more room, else the left
        let side = pref;
        if (sl > 0.03 && sr > 0.03) { side = 0; if (kept !== 0 || R.sideO !== bestO) R.stats.bothShut++; }      // no way round by a side-step: the game's own wall slide acts
        else if ((pref > 0 ? sl : sr) > 0.03) { side = -pref; R.stats.otherSide++; }
        R.sideO = bestO; R.side = side; R.sideT = game.t + 0.2;
      }
      const side = game.t < R.dropT ? 0 : R.side;
      if (side) {
        // he is on the wrong side of the centre for the side kept: the room to make is larger
        const need = (bestLat > 0 ? -1 : 1) === side || Math.abs(bestLat) <= 0.06 ? bestNeed : bestNeed + 2 * Math.abs(bestLat);
        want = side * Math.min(MAX_STEER, Math.atan2(need * 1.2, Math.max(0.3, bestAlong - 0.1)));
        R.stats.steerSteps++;
      }
    } else R.sideO = null;
    R.ang += (want - R.ang) * Math.min(1, dt * (Math.abs(want) > Math.abs(R.ang) ? Math.min(16, Math.max(6, sp * 2.3)) : 5));      /* a walk eases into the turn; a sprint has half a second */
    if (Math.abs(R.ang) < 1e-4) R.ang = 0;
    return a + R.ang;
  };
  const _r = { x: 0, y: 0 };

  // ---- the hold-out. out: where the game's walls and circles left his step (statics.resolve's answer); changed in place.
  R.push = (pl, out) => {
    let x = out.x, y = out.y, hit = 0, nx = 0, ny = 0, round = false;
    if (R.n) for (let it = 0; it < 2; it++) {
      const a = R.grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))); if (!a) break; let any = false;
      for (const o of a) {
        axisPoint(o, x, y); let ex = x - _t.x, ey = y - _t.y; const d = Math.hypot(ex, ey), rr = o.r + BODY; if (d >= rr) continue;
        if (d > 1e-5) { ex /= d; ey /= d; } else { ex = -Math.cos(pl.h); ey = -Math.sin(pl.h); }
        x += ex * (rr - d); y += ey * (rr - d); nx = ex; ny = ey; hit++; any = true; round = _t.end;      /* a round thing, or the rounded end of a long one */
      }
      if (!any) break;
    }
    const step = Math.hypot(out.x - pl.x, out.y - pl.y);
    if (hit) {
      R.stats.pushes++;
      // dead-centre into a round thing: the push only sends him back. Slip to a side so he goes round (exactly central: the side the side-step kept, else the left).
      const hx = Math.cos(pl.h), hy = Math.sin(pl.h);
      if (round && hit === 1 && nx * hx + ny * hy < -0.94 && step > 1e-4) {
        const cr = hx * ny - hy * nx /* > 0: he is left of its centre, and goes on round its left */, s = Math.abs(cr) > 0.01 ? (cr > 0 ? -1 : 1) : -(R.side || 1), tx = -ny * s, ty = nx * s, k = step * 0.7;
        if (softDepth(x + tx * k, y + ty * k) < 0.02) { x += tx * k; y += ty * k; R.stats.slips++; }
      }
      st.resolve(x, y, WALL_R, _r);      // the walls win
      if (Math.hypot(_r.x - x, _r.y - y) > 1e-4) { x = _r.x; y = _r.y; if (softDepth(x, y) > 0.03) { x = pl.x; y = pl.y; R.stats.held++; } }
    }
    // never left standing at a thing: under 30 % of the speed asked for 0.3 s at a pole, a round thing or a rounded end (not at a wall or a flat side,
    // where standing is right): the side-step is dropped for a second and he is moved along the freer tangent of what holds him until he is past.
    const ask = R.sp * R.dt;
    if (ask > 1e-6 && game.t === R.lastT) {
      const slow = Math.hypot(x - pl.x, y - pl.y) < 0.3 * ask, thing = (hit && round) || game.t - R.steerT < 0.6;
      if (slow && thing) R.stall += R.dt; else if (!slow) R.stall = Math.max(0, R.stall - 2 * R.dt);
      if (R.stall >= 0.3) { R.stall = 0; R.nudgeT = game.t + 0.6; R.nudgeS = 0; R.dropT = game.t + 1; R.stats.stalls++; }
      if (game.t < R.nudgeT && Math.hypot(x - pl.x, y - pl.y) < 0.6 * ask) {
        let ex = x - (pl.x + Math.cos(pl.h) * ask), ey = y - (pl.y + Math.sin(pl.h) * ask); const e = Math.hypot(ex, ey);      // from where he asked to be to where he was left: the normal of what holds him
        if (e > 1e-6) { ex /= e; ey /= e; const ax = Math.cos(R.a), ay = Math.sin(R.a);
          const free = (s) => { const qx = pl.x - ey * s * 0.3, qy = pl.y + ex * s * 0.3; st.resolve(qx, qy, WALL_R, _r); return Math.hypot(_r.x - qx, _r.y - qy) < 0.02 && softDepth(qx, qy) < 0.02; };
          let s = R.nudgeS; if (!s || !free(s)) { const fl = free(1), fr = free(-1), dl = -ey * ax + ex * ay; s = fl && fr ? (Math.abs(dl) > 0.05 ? (dl > 0 ? 1 : -1) : R.side || 1) : fl ? 1 : fr ? -1 : 0; }
          R.nudgeS = s;
          if (s) { const qx = x - ey * s * ask * 0.8, qy = y + ex * s * ask * 0.8; st.resolve(qx, qy, WALL_R, _r); if (softDepth(_r.x, _r.y) < 0.03) { x = _r.x; y = _r.y; R.stats.nudges++; } } }
      }
    }
    out.x = x; out.y = y;
  };
  return R;
}
