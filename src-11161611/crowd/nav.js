// crowd/nav.js: the walking network of the crowd, built once at load from the game's own road graph and collision world.
// A WAY is a straight piece of sidewalk measured from its kerb line: a base line A->B (on the kerb), an inward normal n (into the
// block) and, every 2.5 m, the band [lo, hi] of lateral offsets one can walk at (clear of the kerb furniture line, short of the wall).
// Kinds: 'strip' (along a road, between junctions), 'stub' (from a crossing's kerb point to the block corner), 'cross' (kerb to kerb
// over a road at a junction: its lateral axis runs along the road, band = the painted crossing). VERTICES join ways end to end.
// Nothing here knows about agents; sim.js walks it.
// people/crowd-walls (Nov 14, public reports of people walking through fences, tables and shop fronts):
//   furnitureOf(game)   the street furniture the game does not collide, each thing with the room the walk leaves round it (r, as before) AND
//                       its own half width (h: what a body is held out of); every area's lists if the street layer is ever built per area
//   nav.push(x, y, r, out)   moves a body out of that furniture (the game's own collision world does not hold it)
//   nav.refresh(extra, pred) again for the ways pred picks: band, things in the way, density. For an area whose street things (fences,
//                       shop fronts, trunks, furniture) arrive after the network was built: the far area of a public load is built after
//                       ready. Returns more(ms): call it until it returns true (a few ways a frame, no hitch).
import { pointInPoly } from '../geo.js';

const STEP = 2.5, FURN = 1.5, WALL = 0.5, HI_CAP = 12, CROSS_AT = 1.3, CROSS_HALF = 1.9;
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// [kind, the room the walk leaves round it (as before), its own half width (what a body is held out of)]
const RAD = [[/^ptable$/, 0.5, 0.42], [/^pchair$/, 0.33, 0.28], [/^planter\d/, 0.75, 0.6], [/^urn\d/, 0.5, 0.4], [/^rack$/, 0.6, 0.25], [/^bike(B)?$/, 0.8, 0.3], [/^bikeShare$/, 0.85, 0.3], [/^dock$/, 0.5, 0.3], [/^dockKiosk$/, 0.45, 0.3], [/^benchP$/, 0.9, 0.32], [/^(pbin|basket|basketFull|newsbox)$/, 0.38, 0.3], [/^(cone|delin)$/, 0.22, 0.16], [/^aframe$/, 0.38, 0.28], [/^block$/, 0.65, 0.5], [/^cart$/, 1.3, 0.7], [/^kiosk$/, 1.1, 0.9], [/^shelter$/, 1.5, 0.55], [/^cab$/, 0.5, 0.4], [/^(busstop|meter|spost|psign|psignP|armsign|umbrella|umbrellaC|umbrellaV1|umbrellaV2|sunsh)$/, 0.14, 0.1]];
// the street layer's furniture that stands on the ground but is not in the game's collision world (the walk goes round it), and where
// one can sit: plaza chairs (seat 0.45 m up, the chair faces its own +X) and park benches (two places each). Every area's.
export function furnitureOf(game) {
  const extra = [], seats = [], F = game.streets && game.streets.parts && game.streets.parts.furniture; if (!F) return { extra, seats };
  const all = []; if (F.sets) { for (const n in F.sets) if (F.sets[n] && F.sets[n].kinds && !all.includes(F.sets[n].kinds)) all.push(F.sets[n].kinds); } if (F.kinds && !all.includes(F.kinds)) all.push(F.kinds);
  for (const K of all) {
    for (const name in K) { const m = RAD.find((q) => q[0].test(name)); if (!m || !K[name].list) continue; for (const it of K[name].list) { if (it[2] > 1) continue; const sc = it[4] && typeof it[4].s === 'number' ? it[4].s : 1, r = m[1] * sc, h = m[2] * sc; extra.push({ x: it[0], y: it[1], r, h });
      if (/^(bike|bikeB|bikeShare|benchP|shelter|cart)$/.test(name)) { const c = Math.cos(it[3]), sn = Math.sin(it[3]), L = /shelter/.test(name) ? 1.4 : 0.55; extra.push({ x: it[0] + c * L, y: it[1] + sn * L, r, h }, { x: it[0] - c * L, y: it[1] - sn * L, r, h }); } } }
    if (K.pchair && K.pchair.list) for (const it of K.pchair.list) { const o = it[4]; if (o && o.tilt && (Math.abs(o.tilt[0]) > 0.3 || Math.abs(o.tilt[1]) > 0.3)) continue; seats.push({ x: it[0], y: it[1], z: it[2], h: it[3], seat: 0.452 * (o && typeof o.s === 'number' ? o.s : 1) }); }
    if (K.benchP && K.benchP.list) for (const it of K.benchP.list) seats.push({ x: it[0], y: it[1], z: it[2], h: it[3] - Math.PI / 2, seat: 0.465, bench: true });
  }
  return { extra, seats };
}

// people/crowd-perf, Nov 14: statics.onSidewalk's answer, from each block polygon's edges sorted into bands of y (same edges, same arithmetic,
// only those that cannot cross the point's y are left out: the same answer bit for bit, a tenth of the time on the 796-corner block of the two-area map)
function swIndex(st) {
  if (!st.blocks || !st.key) return null; const idx = new Map();
  const ring = (poly) => { let y0 = 1e9, y1 = -1e9; for (const p of poly) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const n = Math.max(1, Math.min(512, poly.length >> 1)), h = (y1 - y0) / n || 1, slabs = []; for (let k = 0; k < n; k++) slabs.push([]);
    const at = (y) => { const k = Math.floor((y - y0) / h); return k < 0 ? 0 : k >= n ? n - 1 : k; };
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const yi = poly[i][1], yj = poly[j][1], k1 = at(Math.max(yi, yj)); for (let k = at(Math.min(yi, yj)); k <= k1; k++) slabs[k].push(poly[i][0], yi, poly[j][0], yj); }
    const R = { y0, y1, at, slabs: slabs.map((a) => new Float64Array(a)) }; idx.set(poly, R); return R; };
  const inside = (x, y, poly) => { if (poly.length < 12) return pointInPoly(x, y, poly); const R = idx.get(poly) || ring(poly); if (!(y >= R.y0 && y <= R.y1)) return false;
    const a = R.slabs[R.at(y)]; let inn = false; for (let o = 0; o < a.length; o += 4) { const xi = a[o], yi = a[o + 1], xj = a[o + 2], yj = a[o + 3]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn; } return inn; };
  return (x, y) => { const a = st.blocks.get(st.key(Math.floor(x / 64), Math.floor(y / 64))); if (!a) return false;
    for (const b of a) { if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (inside(x, y, b.poly.ext)) { let hole = false; for (const h of b.poly.holes) if (inside(x, y, h)) { hole = true; break; } if (!hole) return true; } }
    return false; };
}
export function buildNav(game, plazas = [], extraObs = []) {
  const R = game.roads, st = game.statics, city = game.city, nodes = R.nodes, edges = R.edges;
  // (crowd.js hands over the furniture as { x, y, r }: the walking room only. The things' own half widths are read here, so crowd.js stays as it is.)
  if (extraObs.length && extraObs[0].h === undefined) { try { const f = furnitureOf(game).extra; if (f.length) extraObs = f; } catch (e) {} }
  const bx = game.bounds.x - 3, by = game.bounds.y - 3, bcx = game.bounds.cx || 0, bcy = game.bounds.cy || 0;     /* tiles lane: the playable box may sit off the origin */
  const ways = [], verts = [], rep = { strips: 0, stubs: 0, crossings: 0, bridges: 0, dropped: 0, cut: 0, deadEnds: 0 };
  const parks = (city.parks || []).map((p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.ext) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { ext: p.ext, x0, y0, x1, y1 }; });
  /* tiles lane (helper cost 2), Nov 15: a park's outline of 12 corners or more is asked through slabs of y (as swIndex above does for the sidewalks): only the sides that can cross the point's y are tried, in the outline's order, with the same crossing test, so the same answer (the Hudson's long park has hundreds of corners: 239 ms of the nine-area load, 113 of six). ?parkslab=0 = every side. */
  const PSLAB = !/[?&]parkslab=0/.test(location.search), pslab = (poly) => { let y0 = 1e9, y1 = -1e9; for (const p of poly) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const n = Math.max(1, Math.min(512, poly.length >> 1)), h = (y1 - y0) / n || 1, slabs = []; for (let k = 0; k < n; k++) slabs.push([]); const at = (y) => { const k = Math.floor((y - y0) / h); return k < 0 ? 0 : k >= n ? n - 1 : k; };
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const yi = poly[i][1], yj = poly[j][1], k1 = at(Math.max(yi, yj)); for (let k = at(Math.min(yi, yj)); k <= k1; k++) slabs[k].push(poly[i][0], yi, poly[j][0], yj); }
    return { y0, y1, at, slabs: slabs.map((a) => new Float64Array(a)) }; };
  const pin = (x, y, p) => { if (!PSLAB || p.ext.length < 12) return pointInPoly(x, y, p.ext); const R = p.sl || (p.sl = pslab(p.ext)); if (!(y >= R.y0 && y <= R.y1)) return false;
    const a = R.slabs[R.at(y)]; let inn = false; for (let o = 0; o < a.length; o += 4) { const xi = a[o], yi = a[o + 1], xj = a[o + 2], yj = a[o + 3]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn; } return inn; };
  /* and the parks whose box reaches a point come from a 64 m grid of the boxes instead of every park of the city for every point asked (that walk was the cost: 263 ms on nine areas with the slabs alone). Same parks tried, same answer. */
  const PG = PSLAB ? new Map() : null; if (PG) for (const p of parks) for (let i = Math.floor(p.x0 / 64); i <= Math.floor(p.x1 / 64); i++) for (let j = Math.floor(p.y0 / 64); j <= Math.floor(p.y1 / 64); j++) { const k = i * 65536 + j; let a = PG.get(k); if (!a) PG.set(k, (a = [])); a.push(p); }
  const inPark = (x, y) => { const L = PG ? PG.get(Math.floor(x / 64) * 65536 + Math.floor(y / 64)) : parks; if (L) for (const p of L) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1 && pin(x, y, p)) return true; return false; };
  // is a point inside a building's outline? (asked only where a line stands in the kerb zone)
  let BG = null; const inBuilding = (x, y) => { if (!BG) { BG = new Map(); for (const b of city.buildings || []) { if ((b.minh || 0) >= 3 || !b.poly) continue; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of b.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } for (let i = Math.floor(x0 / 32); i <= Math.floor(x1 / 32); i++) for (let j = Math.floor(y0 / 32); j <= Math.floor(y1 / 32); j++) { const k = i * 8192 + j; let a = BG.get(k); if (!a) BG.set(k, (a = [])); a.push(b); } } }
    const a = BG.get(Math.floor(x / 32) * 8192 + Math.floor(y / 32)); if (a) for (const b of a) if (pointInPoly(x, y, b.poly)) return true; return false; };
  const swQ = game.P && game.P.get && (game.P.get('crowdnav') === '0' || game.P.get('crowdperf') === '0') ? null : swIndex(st), onSw = swQ || ((x, y) => st.onSidewalk(x, y));      /* people/crowd-perf */
  const walkable = (x, y) => Math.abs(x - bcx) < bx && Math.abs(y - bcy) < by && onSw(x, y);
  const pz = plazas.map((p) => { let x = 0, y = 0; for (const q of p.poly) { x += q[0]; y += q[1]; } return { x: x / p.poly.length, y: y / p.poly.length, r: Math.sqrt(p.area / Math.PI) + 30, poly: p.poly, area: p.area }; });
  const nearPlaza = (x, y) => { for (const p of pz) if (Math.hypot(x - p.x, y - p.y) < p.r) return true; return false; };

  const mkVert = (x, y) => { const v = { id: verts.length, x, y, inc: [] }; verts.push(v); return v; };
  // the band of one way: sampled every STEP metres. Returns false when no part of it can be walked.
  function profile(w) {
    const n = Math.max(2, Math.ceil(w.len / STEP) + 1), lo = new Float32Array(n), hi = new Float32Array(n), tl = new Float32Array(n), th = new Float32Array(n); let ok = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(w.len, i * STEP), px = w.ax + w.ux * s, py = w.ay + w.uy * s; lo[i] = hi[i] = 0;
      // the kerb may sit a little off the line (the junction box bulges the roadway): walk from the first lateral that is sidewalk
      let first = -1; for (let l = 0.5; l <= 3.3; l += 0.4) if (walkable(px + w.nx * l, py + w.ny * l)) { first = l; break; }
      if (first < 0) continue;
      // people/crowd-walls ("npcs get stuck on fences"): the first line met from the kerb used to be taken for the building line. A tree
      // guard (four short fence lines round the pit, in the kerb zone) therefore read as a wall 0.5 m from the kerb, and the walk was
      // squeezed between kerb and guard, through the guard's own lines and the trunk. A line in the kerb zone with walkable ground behind it that is not
      // inside a building's outline is now stepped over: the walk starts behind it.
      let wall = 9; { let from = first - 0.2; for (let k = 0; k < 3; k++) { const t = st.raycast(px + w.nx * from, py + w.ny * from, px + w.nx * 9, py + w.ny * 9); wall = t >= 1 ? 9 : from + t * (9 - from); if (wall >= 9 || wall > FURN + 0.6) break;
        const bx_ = px + w.nx * (wall + 0.45), by_ = py + w.ny * (wall + 0.45); if (!walkable(bx_, by_) || inBuilding(bx_, by_)) break;
        first = Math.max(first, wall + 0.05); from = wall + 0.06; rep.guards = (rep.guards || 0) + 1; } }
      let h = first, park = false; for (let l = first + 0.4; l <= Math.min(wall - WALL, HI_CAP) + 1e-6; l += l < 5.6 ? 0.4 : 0.8) { if (!walkable(px + w.nx * l, py + w.ny * l)) break; if (inPark(px + w.nx * l, py + w.ny * l)) { park = true; break; } h = l; }
      if (park) h -= 0.3; if (h - first < 0.75) { if (!park && wall - first > 0.75) { tl[i] = first + 0.25; th[i] = Math.max(first + 0.5, wall - 0.3); } continue; }
      hi[i] = h; lo[i] = Math.max(first + 0.35, h > FURN + 1.3 ? FURN : Math.max(0.5, h - 1.3)); if (lo[i] > hi[i] - 0.3) lo[i] = hi[i] - 0.3; ok++;
    }
    // a short pinch (a wall that comes to within a stride of the kerb for a few metres) is squeezed through, not a dead end
    for (let i = 0; i < n; i++) { if (hi[i] > 0) continue; let j = i; while (j < n && !(hi[j] > 0) && th[j] > 0) j++; if (j > i && j - i <= 5 && i > 0 && j < n && hi[j] > 0) { for (let k = i; k < j; k++) { lo[k] = tl[k]; hi[k] = th[k]; ok++; } } i = Math.max(i, j); }
    w.lo = lo; w.hi = hi; w.np = n; w.q = 0; return ok;
  }
  function addWay(va, vb, hintX, hintY, kind, e, extra) {
    const dx = vb.x - va.x, dy = vb.y - va.y, len = Math.hypot(dx, dy); if (len < 0.3 || va === vb) return null;
    const ux = dx / len, uy = dy / len; let nx = uy, ny = -ux; if (nx * hintX + ny * hintY < 0) { nx = -nx; ny = -ny; }
    const w = Object.assign({ id: ways.length, kind, a: va, b: vb, ax: va.x, ay: va.y, ux, uy, nx, ny, len, e, agents: [], obs: [], want: 0, rho: 0 }, extra);
    if (kind === 'cross') { w.lo = new Float32Array([-CROSS_HALF, -CROSS_HALF]); w.hi = new Float32Array([CROSS_HALF, CROSS_HALF]); w.np = 2; }
    else {
      if (!profile(w)) { rep.dropped++; return null; }
      // a way with a stretch that cannot be walked (a building on the kerb, the edge of the map) keeps its longest good run
      let bs = -1, bl = 0, cs = -1; for (let i = 0; i <= w.np; i++) { const good = i < w.np && w.hi[i] > 0; if (good && cs < 0) cs = i; if (!good && cs >= 0) { if (i - cs > bl) { bl = i - cs; bs = cs; } cs = -1; } }
      if (bl < w.np) {
        rep.cut++; if (bl < 3) { rep.dropped++; return null; }
        const s0 = bs * STEP, s1 = Math.min(len, (bs + bl - 1) * STEP); if (s1 - s0 < 5) { rep.dropped++; return null; }
        const A = bs === 0 ? va : mkVert(va.x + ux * s0, va.y + uy * s0), B = bs + bl === w.np ? vb : mkVert(va.x + ux * s1, va.y + uy * s1);
        // the other good runs of it are walks too (they end where the bad stretch begins)
        if (!extra || !extra.piece) { let c0 = -1; for (let i = 0; i <= w.np; i++) { const good = i < w.np && w.hi[i] > 0; if (good && c0 < 0) c0 = i; if (!good && c0 >= 0) { if (c0 !== bs && i - c0 >= 4) { const t0 = c0 * STEP, t1 = Math.min(len, (i - 1) * STEP); addWay(c0 === 0 ? va : mkVert(va.x + ux * t0, va.y + uy * t0), i === w.np ? vb : mkVert(va.x + ux * t1, va.y + uy * t1), nx, ny, kind, e, Object.assign({}, extra, { piece: true })); } c0 = -1; } } }
        return addWay(A, B, nx, ny, kind, e, Object.assign({}, extra, { piece: true }));
      }
    }
    w.id = ways.length; ways.push(w); va.inc.push({ w, end: 0 }); vb.inc.push({ w, end: 1 });
    rep[kind === 'strip' ? 'strips' : kind === 'stub' ? 'stubs' : kind === 'cross' ? 'crossings' : 'bridges']++;
    return w;
  }

  // ---- junctions: where each arm's two kerb points are, the corner between neighbouring arms, the crossing of each arm
  const armOf = new Map();    // node|edge -> arm
  nodes.forEach((nd, ni) => {
    const arms = [];
    for (const ei of nd.e) {
      const e = edges[ei]; if (!e || !e.pts) continue;
      for (const atA of [true, false]) {     // a loop edge meets its node twice
        if ((atA ? e.a : e.b) !== ni) continue;
        const p = e.pts, q0 = atA ? p[0] : p[p.length - 1], q1 = atA ? p[1] : p[p.length - 2], L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
        arms.push({ e, ei, atA, ox: (q1[0] - q0[0]) / L, oy: (q1[1] - q0[1]) / L, W: e.width, ang: Math.atan2(q1[1] - q0[1], q1[0] - q0[0]), tQ: [0, 0], V: [null, null], ok: true });
      }
    }
    arms.sort((a, b) => a.ang - b.ang); nd._arms = arms; const big = arms.length >= 3;
    for (const a of arms) { armOf.set(ni + '|' + a.ei + '|' + (a.atA ? 1 : 0), a); a.t = big ? nd.r + CROSS_AT : 0; }
    // corner between arm i (its left side, seen leaving the node) and the next arm counter-clockwise (its right side)
    const corners = [];
    for (let i = 0; i < arms.length && arms.length >= 2; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length];
      let th = b.ang - a.ang; if (th <= 0) th += Math.PI * 2;
      const pax = nd.p[0] - a.oy * a.W / 2, pay = nd.p[1] + a.ox * a.W / 2, pbx = nd.p[0] + b.oy * b.W / 2, pby = nd.p[1] - b.ox * b.W / 2;
      const c = { a, b, th, q: null };
      const det = a.ox * b.oy - a.oy * b.ox;
      if (th < Math.PI - 0.3 && Math.abs(det) > 0.25) {
        const rx = pbx - pax, ry = pby - pay, t = (rx * b.oy - ry * b.ox) / det, u = (rx * a.oy - ry * a.ox) / det;
        if (t > -1 && u > -1 && t < 45 && u < 45) { c.q = [pax + a.ox * t, pay + a.oy * t]; c.ta = t; c.tb = u; if (big) { a.t = Math.max(a.t, t + 1.0); b.t = Math.max(b.t, u + 1.0); } }
      }
      corners.push(c);
    }
    for (const a of arms) {
      const e = a.e, other = nodes[a.atA ? e.b : e.a], room = e.len - a.t - (other.e.length >= 3 ? other.r + CROSS_AT : 0);
      if (big && (e.twin || room < 3)) a.ok = false;
      // kerb points: index 0 = left of the way out of the node, 1 = right
      a.P = [[nd.p[0] - a.oy * a.W / 2 + a.ox * a.t, nd.p[1] + a.ox * a.W / 2 + a.oy * a.t], [nd.p[0] + a.oy * a.W / 2 + a.ox * a.t, nd.p[1] - a.ox * a.W / 2 + a.oy * a.t]];
    }
    nd._corners = corners;
  });
  // an edge too short for a walk of its own between two junctions (the link between the halves of one crossing, a fork): both its arms
  edges.forEach((e, ei) => { const A = armOf.get(e.a + '|' + ei + '|1'), B = armOf.get(e.b + '|' + ei + '|0'); if (A && B && (!A.ok || !B.ok)) { A.ok = B.ok = false; A.short = B.short = true; } });
  // vertices at the kerb points; two that fall within 3 m of each other across a corner without a block corner (a bend, a change of
  // width) are one vertex
  for (const nd of nodes) {
    if (!nd._arms) continue;
    for (const a of nd._arms) if (a.ok) a.V = [mkVert(a.P[0][0], a.P[0][1]), mkVert(a.P[1][0], a.P[1][1])];
    for (const c of nd._corners || []) {
      if (c.q || !c.a.ok || !c.b.ok) continue; const va = c.a.V[0], vb = c.b.V[1]; if (va === vb) continue;
      if (Math.hypot(va.x - vb.x, va.y - vb.y) < 3) { va.x = (va.x + vb.x) / 2; va.y = (va.y + vb.y) / 2; c.b.V[1] = va; vb.dead = true; }
    }
  }
  // ---- strips along every edge, both sides
  edges.forEach((e, ei) => {
    const A = armOf.get(e.a + '|' + ei + '|1'), B = armOf.get(e.b + '|' + ei + '|0'); if (!A || !B || !A.ok || !B.ok) return;
    const sA = A.t, sB = e.len - B.t; if (sB - sA < 2) return;
    for (const sd of [1, -1]) {      // +1: right of a->b
      const v0 = A.V[sd > 0 ? 1 : 0], v1 = B.V[sd > 0 ? 0 : 1]; const chain = [v0];
      const p = e.pts, cum = e.line.cum;
      for (let k = 1; k < p.length - 1; k++) {
        if (cum[k] < sA + 1.5 || cum[k] > sB - 1.5) continue;
        const d0x = p[k][0] - p[k - 1][0], d0y = p[k][1] - p[k - 1][1], L0 = Math.hypot(d0x, d0y) || 1, d1x = p[k + 1][0] - p[k][0], d1y = p[k + 1][1] - p[k][1], L1 = Math.hypot(d1x, d1y) || 1;
        let mx = d0y / L0 + d1y / L1, my = -d0x / L0 - d1x / L1; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml; const cosH = mx * (d0y / L0) + my * (-d0x / L0), k2 = Math.min(1.6, 1 / Math.max(0.3, cosH));
        chain.push(mkVert(p[k][0] + mx * sd * e.width / 2 * k2, p[k][1] + my * sd * e.width / 2 * k2));
      }
      chain.push(v1);
      for (let k = 0; k + 1 < chain.length; k++) { const a = chain[k], b = chain[k + 1], dx = b.x - a.x, dy = b.y - a.y; addWay(a, b, dy * sd, -dx * sd, 'strip', e, { side: sd }); }
    }
  });
  // ---- corners (two stubs meeting at the block corner), bridges along a kerb that passes a junction without a corner, crossings
  nodes.forEach((nd, ni) => {
    if (!nd._arms || nd._arms.length < 2) return;
    for (const c of nd._corners || []) {
      const a = c.a, b = c.b;
      if (a.ok !== b.ok) {       // a walk meets a short edge: its stub runs to the corner, and the corner is where the short edge's own kerb walk starts
        const good = a.ok ? a : b, v = a.ok ? a.V[0] : b.V[1], sh = a.ok ? b : a; if (!sh.short || v.dead) continue; sh.Q = sh.Q || [null, null];
        if (c.q) { const q = mkVert(c.q[0], c.q[1]); const w1 = a.ok ? addWay(v, q, -a.oy, a.ox, 'stub', a.e, { node: ni }) : addWay(q, v, b.oy, -b.ox, 'stub', b.e, { node: ni }); sh.Q[a.ok ? 1 : 0] = w1 ? q : v; }
        else sh.Q[a.ok ? 1 : 0] = v;
        continue;
      }
      if (!a.ok || !b.ok) continue; const va = a.V[0], vb = b.V[1]; if (va === vb || va.dead || vb.dead) continue;
      if (c.q) {
        const q = mkVert(c.q[0], c.q[1]);
        const w1 = addWay(va, q, -a.oy, a.ox, 'stub', a.e, { node: ni }), w2 = addWay(q, vb, b.oy, -b.ox, 'stub', b.e, { node: ni });
        if (!w1 || !w2) { /* a corner that cannot be walked: try straight across */ if (!w1 && !w2) addWay(va, vb, (va.x + vb.x) / 2 - nd.p[0], (va.y + vb.y) / 2 - nd.p[1], 'stub', a.e, { node: ni, bridge: true }); }
      } else if (nd._arms.length >= 3 || Math.hypot(va.x - vb.x, va.y - vb.y) >= 3) addWay(va, vb, (va.x + vb.x) / 2 - nd.p[0], (va.y + vb.y) / 2 - nd.p[1], 'strip', a.e, { node: ni, bridge: true, side: 0 });
    }
    if (nd._arms.length >= 3) for (const a of nd._arms) {
      if (!a.ok || a.e.twin) continue; const v0 = a.V[0], v1 = a.V[1]; if (v0.dead || v1.dead) continue;
      // both kerb points must stand on a sidewalk
      if (!walkable(v0.x - a.oy * 0.7, v0.y + a.ox * 0.7) || !walkable(v1.x + a.oy * 0.7, v1.y - a.ox * 0.7)) continue;
      addWay(v0, v1, a.ox, a.oy, 'cross', a.e, { node: ni, ave: !!a.e.ave });
    }
  });
  // a crossing that lands where no walk goes on is no crossing
  for (const w of ways) if (w.kind === 'cross' && (w.a.inc.length < 2 || w.b.inc.length < 2)) { w.deadX = true; for (const v of [w.a, w.b]) v.inc = v.inc.filter((i) => i.w !== w); rep.crossings--; }
  { const keep = ways.filter((w) => !w.deadX); ways.length = 0; for (const w of keep) { w.id = ways.length; ways.push(w); } }
  // the kerb walks of the short edges, corner to corner
  edges.forEach((e, ei) => {
    const A = armOf.get(e.a + '|' + ei + '|1'), B = armOf.get(e.b + '|' + ei + '|0'); if (!A || !B || !A.short || !A.Q || !B.Q) return;
    for (const sd of [1, -1]) { const v0 = A.Q[sd > 0 ? 1 : 0], v1 = B.Q[sd > 0 ? 0 : 1]; if (!v0 || !v1 || v0 === v1) continue; const dx = v1.x - v0.x, dy = v1.y - v0.y; if (Math.hypot(dx, dy) > e.len + 30) continue;
      if (addWay(v0, v1, dy * sd, -dx * sd, 'strip', e, { side: sd, short: true })) rep.shorts = (rep.shorts || 0) + 1; }
  });
  for (const v of verts) if (v.inc.length === 1) rep.deadEnds++;

  // ---- what stands on the ground: the game's collision circles (poles, trees, hydrants, solid furniture; not parked cars) and what
  // the caller adds (the street layer's chairs, tables, planters, racks, which do not collide in the game), in one grid
  const OC = 6, og = new Map(), fg = new Map(), ok_ = (i, j) => i * 8192 + j, allObs = [];
  const addObs = (x, y, r, soft, h) => { const o = { x, y, r, h: h || r }; allObs.push(o); const k = ok_(Math.floor(x / OC), Math.floor(y / OC)); let a = og.get(k); if (!a) og.set(k, (a = [])); a.push(o); if (soft) { let b = fg.get(k); if (!b) fg.set(k, (b = [])); b.push(o); } };
  const readObs = (extra) => { og.clear(); fg.clear(); allObs.length = 0;
    for (const a of st.circ.values()) for (const o of a) if (o.on && !(o.tag && typeof o.tag === 'object')) addObs(o.x, o.y, Math.min(o.r, 1.2), false);
    for (const o of extra) addObs(o.x, o.y, o.r, true, o.h); };
  readObs(extraObs);
  // a body of radius r out of the furniture the game does not collide (fg): out.x, out.y; returns how many things it touched
  const push = (x, y, r, out) => { out.x = x; out.y = y; let n = 0; const i0 = Math.floor((x - r - 1.6) / OC), i1 = Math.floor((x + r + 1.6) / OC), j0 = Math.floor((y - r - 1.6) / OC), j1 = Math.floor((y + r + 1.6) / OC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = fg.get(ok_(i, j)); if (a) for (const o of a) { let ex = out.x - o.x, ey = out.y - o.y; const d = Math.hypot(ex, ey), R = o.h + r; if (d < R) { if (d < 1e-6) { ex = 1; ey = 0; } else { ex /= d; ey /= d; } out.x += ex * (R - d); out.y += ey * (R - d); out.nx = ex; out.ny = ey; n++; } } }
    return n; };
  // the furniture that reaches into a box, appended to out
  const soft = (x0, y0, x1, y1, out) => { for (let i = Math.floor((x0 - 1.6) / OC); i <= Math.floor((x1 + 1.6) / OC); i++) for (let j = Math.floor((y0 - 1.6) / OC); j <= Math.floor((y1 + 1.6) / OC); j++) { const a = fg.get(ok_(i, j)); if (a) for (const o of a) if (o.x + o.h > x0 && o.x - o.h < x1 && o.y + o.h > y0 && o.y - o.h < y1) out.push(o); } return out; };
  // how far the nearest such thing's edge is from (x, y), up to `far`
  const gapTo = (x, y, far) => { let best = far; for (let i = Math.floor((x - far - 1.6) / OC); i <= Math.floor((x + far + 1.6) / OC); i++) for (let j = Math.floor((y - far - 1.6) / OC); j <= Math.floor((y + far + 1.6) / OC); j++) { const a = fg.get(ok_(i, j)); if (a) for (const o of a) { const d = Math.hypot(o.x - x, o.y - y) - o.h; if (d < best) best = d; } } return best; };
  // is a body of radius r at (x, y) in something?
  const blocked = (x, y, r) => { for (let i = Math.floor((x - r - 1.6) / OC); i <= Math.floor((x + r + 1.6) / OC); i++) for (let j = Math.floor((y - r - 1.6) / OC); j <= Math.floor((y + r + 1.6) / OC); j++) { const a = og.get(ok_(i, j)); if (a) for (const o of a) if ((o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2) return true; } return false; };
  const carve = (w) => {
    if (w.kind === 'cross') return; w.obs.length = 0;
    const x0 = Math.min(w.ax, w.b.x) - 13, x1 = Math.max(w.ax, w.b.x) + 13, y0 = Math.min(w.ay, w.b.y) - 13, y1 = Math.max(w.ay, w.b.y) + 13;
    for (let i = Math.floor(x0 / OC); i <= Math.floor(x1 / OC); i++) for (let j = Math.floor(y0 / OC); j <= Math.floor(y1 / OC); j++) {
      const a = og.get(ok_(i, j)); if (!a) continue;
      for (const o of a) { const dx = o.x - w.ax, dy = o.y - w.ay, s = dx * w.ux + dy * w.uy, l = dx * w.nx + dy * w.ny; if (s > -1.5 && s < w.len + 1.5 && l > -0.3 && l < HI_CAP + 1) w.obs.push({ s, l, r: o.r, h: o.h, x: o.x, y: o.y }); }
    }
    w.obs.sort((p, q) => p.s - q.s); w.lo0 = w.lo.slice(); w.hi0 = w.hi.slice(); w.np0 = w.np;
    // where things stand in the band, the band gives way: it keeps the wider clear side (a row of cafe tables by the kerb pushes the
    // walk towards the wall); a lone pole in the middle is left for the walkers to step round
    let pl = -1, ph = -1;
    for (let i = 0; i < w.np; i++) {
      if (!(w.hi[i] > 0)) { pl = ph = -1; continue; } const sC = Math.min(w.len, i * STEP), lo0 = w.lo[i], hi0 = w.hi[i];
      // what the things near this stretch block, as intervals across the band; the walk takes the widest clear gap (leaning to the
      // one it was in a step earlier, so it does not hop from side to side between tables)
      const iv = []; for (const o of w.obs) { if (o.s < sC - 1.9 - o.r) continue; if (o.s > sC + 1.9 + o.r) break; const a = o.l - o.r - 0.42, b = o.l + o.r + 0.42; if (b > lo0 && a < hi0) iv.push([a, b]); }
      if (!iv.length) { pl = lo0; ph = hi0; continue; }
      iv.sort((p, q) => p[0] - q[0]); let best = null, bs = -1, cur = lo0;
      const gap = (a, b) => { if (b - a < 0.55) return; const ov = pl >= 0 ? Math.max(0, Math.min(b, ph) - Math.max(a, pl)) : 0, sc = (b - a) + 1.5 * ov; if (sc > bs) { bs = sc; best = [a, b]; } };
      for (const q of iv) { if (q[0] > cur) gap(cur, q[0]); cur = Math.max(cur, q[1]); } if (cur < hi0) gap(cur, hi0);
      if (best) { w.lo[i] = best[0]; w.hi[i] = best[1]; pl = best[0]; ph = best[1]; } else { /* furniture right across: leave a thread through the middle of the least bad place */ pl = ph = -1; }
    }
    { let wd = 0, n = 0; for (let i = 0; i < w.np; i++) if (w.hi[i] > 0) { wd += w.hi[i] - w.lo[i]; n++; } w.wd0 = n ? wd / n : 0; }      /* how busy the walk is goes by this width, not by the thread's */
    thread(w);
  };
  // people/crowd-walls ("people are walking through the tables"): where the band above still has things standing in it (plaza tables and
  // chairs right across the walk: it found no gap at its 2.5 m samples and left the band whole), the walk is THREADED between them: on a
  // grid of 0.625 m along by 0.25 m across the way's own profile, the path from end to end that stays clear of every thing by a body's
  // width, moves across as little as it can and prefers the wider gaps; the band becomes the clear room round that path at each station,
  // narrowed towards a gap at no more than 45 degrees so that whoever is in it can reach the gap. Kept at that finer step (w.q = 4).
  // A way with no clear way through is closed (rep.threadsBlocked).
  const CLR = 0.25, Q = 4, DS = STEP / Q, DL = 0.25;
  function thread(w) {
    const O = w.obs; if (!O.length) return; const cb = { lo: 0, hi: 0 };
    // is anything in the band as it stands? (looked at on the fine stations)
    const n = Math.max(2, Math.round(w.len / DS) + 1); let dirty = false, k0 = 0;
    for (let i = 0; i < n && !dirty; i++) { const sC = Math.min(w.len, i * DS); bandAt(w, sC, cb); if (!(cb.hi > 0)) continue; while (k0 < O.length && O[k0].s < sC - 2) k0++;
      for (let k = k0; k < O.length && O[k].s < sC + 2; k++) { const o = O[k], rr = o.h + CLR - 0.06, ds = o.s - sC; if (ds > rr || ds < -rr) continue; const hw = Math.sqrt(rr * rr - ds * ds); if (o.l + hw > cb.lo && o.l - hw < cb.hi) { dirty = true; break; } } }
    if (!dirty) return;
    // the way's own profile (before the band above gave way), at the fine stations
    const P0 = { lo: w.lo0, hi: w.hi0, np: w.np0, q: 0 }, lo = new Float32Array(n), hi = new Float32Array(n); let L0 = 1e9, L1 = -1e9;
    for (let i = 0; i < n; i++) { bandAt(P0, Math.min(w.len, i * DS), cb); if (cb.hi - cb.lo > 0.05 && cb.hi > 0) { lo[i] = cb.lo; hi[i] = cb.hi; L0 = Math.min(L0, cb.lo); L1 = Math.max(L1, cb.hi); } }
    if (L1 <= L0) return; const m = Math.max(1, Math.round((L1 - L0) / DL) + 1), blk = new Uint8Array(n * m);
    for (const o of O) { const rr = o.h + CLR, i0 = Math.max(0, Math.ceil((o.s - rr) / DS)), i1 = Math.min(n - 1, Math.floor((o.s + rr) / DS)), j0 = Math.max(0, Math.ceil((o.l - rr - L0) / DL)), j1 = Math.min(m - 1, Math.floor((o.l + rr - L0) / DL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if ((i * DS - o.s) ** 2 + (L0 + j * DL - o.l) ** 2 < rr * rr) blk[i * m + j] = 1; }
    // 0 free, 1 a thing, 2 outside the profile; the width of the free run each free cell is in
    const run = new Float32Array(n * m);
    for (let i = 0; i < n; i++) { const b = i * m; for (let j = 0; j < m; j++) { const l = L0 + j * DL; if (!(hi[i] > 0) || l < lo[i] - 1e-3 || l > hi[i] + 1e-3) blk[b + j] = 2; }
      for (let j = 0; j < m;) { if (blk[b + j]) { j++; continue; } let e = j; while (e + 1 < m && !blk[b + e + 1]) e++; for (let k = j; k <= e; k++) run[b + k] = (e - j) * DL; j = e + 1; } }
    const C = new Float32Array(n * m), from = new Int16Array(n * m), cell = (i, j) => { const v = blk[i * m + j]; return v === 2 ? (hi[i] > 0 ? 1e5 : 0) : v === 1 ? 60 : 0.3 * Math.max(0, 2 - run[i * m + j]); };
    for (let j = 0; j < m; j++) C[j] = cell(0, j);
    for (let i = 1; i < n; i++) for (let j = 0; j < m; j++) { let best = 1e9, bj = j; for (let d = -2; d <= 2; d++) { const k = j + d; if (k < 0 || k >= m) continue; const c = C[(i - 1) * m + k] + 0.35 * (d < 0 ? -d : d); if (c < best) { best = c; bj = k; } } C[i * m + j] = best + cell(i, j); from[i * m + j] = bj; }
    let j = 0; { let best = 1e9; for (let k = 0; k < m; k++) if (C[(n - 1) * m + k] < best) { best = C[(n - 1) * m + k]; j = k; } }
    const fl = new Float32Array(n), fh = new Float32Array(n); let blocked = 0;
    for (let i = n - 1; i >= 0; i--) { const b = i * m;
      if (!(hi[i] > 0)) { fl[i] = fh[i] = 0; } else if (blk[b + j]) { fl[i] = fh[i] = clamp_(L0 + j * DL, lo[i], hi[i]); if (blk[b + j] === 1) blocked++; }
      else { let a = j, e = j; while (a > 0 && !blk[b + a - 1]) a--; while (e + 1 < m && !blk[b + e + 1]) e++; fl[i] = Math.max(lo[i], L0 + a * DL); fh[i] = Math.min(hi[i], L0 + e * DL); if (fh[i] < fl[i]) fh[i] = fl[i] = L0 + j * DL; }
      j = from[b + j]; }
    // towards a gap at 45 degrees at most
    for (let i = 1; i < n; i++) if (fh[i] > 0 && fh[i - 1] > 0) { fh[i] = Math.min(fh[i], fh[i - 1] + DS); fl[i] = Math.max(fl[i], fl[i - 1] - DS); }
    for (let i = n - 2; i >= 0; i--) if (fh[i] > 0 && fh[i + 1] > 0) { fh[i] = Math.min(fh[i], fh[i + 1] + DS); fl[i] = Math.max(fl[i], fl[i + 1] - DS); }
    // no clear way through: the walk is closed (nobody is put on it, nobody plans over it) rather than have people press into the things
    if (blocked) { rep.threadsBlocked = (rep.threadsBlocked || 0) + 1; w.blockedAt = blocked; fl.fill(0); fh.fill(0); }
    w.lo = fl; w.hi = fh; w.np = n; w.q = Q; rep.threaded = (rep.threaded || 0) + 1;
  }
  const clamp_ = (v, a, b) => (v < a ? a : v > b ? b : v);
  for (const w of ways) carve(w);
  // ---- how busy each way is (people per metre at scale 1): avenues and the big cross streets first, side streets thin, more by a plaza
  let total = 0;
  const dense = (w) => {
    const e = w.e, mx = w.ax + w.ux * w.len / 2, my = w.ay + w.uy * w.len / 2;
    let rho = e.ave ? 1.25 : /Broadway/.test(e.name || '') ? 1.0 : e.lanes >= 3 ? 1.0 : 0.3;
    if (w.kind === 'cross') rho = 0;
    else { let wd = 0, n = 0; for (let i = 0; i < w.np; i++) if (w.hi[i] > 0) { wd += w.hi[i] - w.lo[i]; n++; } w.width = n ? wd / n : 0; if (w.q && w.wd0 > 0) w.width = w.wd0; rho *= Math.min(1.7, Math.max(0.35, w.width / 3)); w.shut = !!(w.q && !n); }
    w.plaza = nearPlaza(mx, my);      // (a plaza is not busier than the avenue beside it: the photos show them half empty)
    rho *= 0.75 + 0.5 * hash(w.e.len * 7.3 + (w.side || 0), e.a * 3.1 + e.b);
    if (w.a.inc.length < 2 || w.b.inc.length < 2) rho *= 0.4;      // a walk that ends: few go down it
    w.rho = rho; w.mx = mx; w.my = my;
  };
  for (const w of ways) dense(w);
  // the people of a walk that is closed (no way through its furniture) go to the open walks within 70 m, by their own share: the
  // place is as busy as it was, the people are beside the tables instead of in them
  for (const w of ways) { if (!w.shut) continue; const give = w.rho * w.len; w.rho = 0; let sum = 0; const near = [];
    for (const o of ways) { if (o.shut || o.kind === 'cross' || !(o.rho > 0) || Math.abs(o.mx - w.mx) > 70 || Math.abs(o.my - w.my) > 70) continue; near.push(o); sum += o.rho * o.len; }
    if (sum > 0) { const k = 1 + give / sum; for (const o of near) o.rho *= k; rep.moved = +((rep.moved || 0) + give).toFixed(1); } }
  for (const w of ways) total += w.rho * w.len;
  // ---- places to stand on the plazas themselves (clear of walls, poles and furniture circles)
  const spots = [], o = {};
  pz.forEach((p, pi) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    if (x1 < bcx - bx || x0 > bcx + bx || y1 < bcy - by || y0 > bcy + by) return; const n = Math.min(24, Math.round(p.area / 90));
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const x = x0 + (x1 - x0) * hash(pi * 3.7 + tries, 1.3), y = y0 + (y1 - y0) * hash(pi * 5.1 + tries, 7.9);
      if (!pointInPoly(x, y, p.poly) || Math.abs(x - bcx) > bx || Math.abs(y - bcy) > by || R.inLane(x, y, 1.2)) continue;
      if (st.resolve(x, y, 1.0, o) > 0 || blocked(x, y, 0.75) || blocked(x + Math.cos(hash(tries, pi) * 6.283) * 1.05, y + Math.sin(hash(tries, pi) * 6.283) * 1.05, 0.6)) continue;
      spots.push({ x, y, z: st.onSidewalk(x, y) ? 0.15 : 0, h: hash(tries, pi) * 6.283, plaza: pi, who: null }); k++;
    }
  });
  // ---- a coarse grid of ways for "what is near the camera"
  const CELL = 64, grid = new Map(), gk = (i, j) => i * 4096 + j;
  for (const w of ways) { const i0 = Math.floor(Math.min(w.ax, w.b.x) / CELL), i1 = Math.floor(Math.max(w.ax, w.b.x) / CELL), j0 = Math.floor(Math.min(w.ay, w.b.y) / CELL), j1 = Math.floor(Math.max(w.ay, w.b.y) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = gk(i, j); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(w); } }
  let stamp = 0;
  function near(x, y, r, out = []) {
    out.length = 0; stamp++;
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) { const a = grid.get(gk(i, j)); if (a) for (const w of a) if (w._st !== stamp) { w._st = stamp; out.push(w); } }
    return out;
  }
  // the ways pred picks, again, against the collision world as it is NOW: a few at a time (more(ms) until it returns true). A way that
  // can no longer be walked anywhere keeps its place in the network and gets no people; a plaza place that is now in something is given up.
  function refresh(extra, pred) {
    if (extra) readObs(extra); nav.ver++; const todo = ways.filter((w) => w.kind !== 'cross' && (!pred || pred(w))); let k = 0, done = false; rep.refreshed = (rep.refreshed || 0) + todo.length;
    return function more(ms = 2) {
      if (done) return true; const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      while (k < todo.length) { const w = todo[k++], ok = profile(w); carve(w); dense(w); if (w.shut) w.rho = 0; if (!ok) { w.rho = 0; rep.closed = (rep.closed || 0) + 1; } if (t0 && performance.now() - t0 > ms) return false; }
      for (const s of spots) if (!s.dead && (!pred || pred({ mx: s.x, my: s.y, ax: s.x, ay: s.y })) && (st.resolve(s.x, s.y, 1.0, o) > 0 || blocked(s.x, s.y, 0.75))) { s.dead = true; rep.spotsDead = (rep.spotsDead || 0) + 1; }
      done = true; return true;
    };
  }
  for (const nd of nodes) { delete nd._arms; delete nd._corners; }
  rep.ways = ways.length; rep.verts = verts.length; rep.km = +(ways.reduce((s, w) => s + (w.kind === 'cross' ? 0 : w.len), 0) / 1000).toFixed(1); rep.spots = spots.length;
  rep.obstacles = allObs.length;
  const nav = { ways, verts, spots, near, blocked, push, gapTo, soft, refresh, ver: 1, report: rep, STEP, weight: total };
  return nav;
}
// the band at distance s along a way
export function bandAt(w, s, out) {
  const f = s / (w.q ? STEP / w.q : STEP), i = f <= 0 ? 0 : f >= w.np - 1 ? w.np - 1 : Math.floor(f), j = Math.min(w.np - 1, i + 1), t = Math.min(1, Math.max(0, f - i));
  out.lo = w.lo[i] + (w.lo[j] - w.lo[i]) * t; out.hi = w.hi[i] + (w.hi[j] - w.hi[i]) * t; return out;
}
