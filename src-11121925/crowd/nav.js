// crowd/nav.js: the walking network of the crowd, built once at load from the game's own road graph and collision world.
// A WAY is a straight piece of sidewalk measured from its kerb line: a base line A->B (on the kerb), an inward normal n (into the
// block) and, every 2.5 m, the band [lo, hi] of lateral offsets one can walk at (clear of the kerb furniture line, short of the wall).
// Kinds: 'strip' (along a road, between junctions), 'stub' (from a crossing's kerb point to the block corner), 'cross' (kerb to kerb
// over a road at a junction: its lateral axis runs along the road, band = the painted crossing). VERTICES join ways end to end.
// Nothing here knows about agents; sim.js walks it.
import { pointInPoly } from '../geo.js';

const STEP = 2.5, FURN = 1.5, WALL = 0.5, HI_CAP = 12, CROSS_AT = 1.3, CROSS_HALF = 1.9;
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function buildNav(game, plazas = [], extraObs = []) {
  const R = game.roads, st = game.statics, city = game.city, nodes = R.nodes, edges = R.edges;
  const bx = game.bounds.x - 3, by = game.bounds.y - 3;
  const ways = [], verts = [], rep = { strips: 0, stubs: 0, crossings: 0, bridges: 0, dropped: 0, cut: 0, deadEnds: 0 };
  const parks = (city.parks || []).map((p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.ext) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { ext: p.ext, x0, y0, x1, y1 }; });
  const inPark = (x, y) => { for (const p of parks) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1 && pointInPoly(x, y, p.ext)) return true; return false; };
  const walkable = (x, y) => Math.abs(x) < bx && Math.abs(y) < by && st.onSidewalk(x, y);
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
      const t = st.raycast(px + w.nx * (first - 0.2), py + w.ny * (first - 0.2), px + w.nx * 9, py + w.ny * 9), wall = t >= 1 ? 9 : first - 0.2 + t * (9.2 - first);
      let h = first, park = false; for (let l = first + 0.4; l <= Math.min(wall - WALL, HI_CAP) + 1e-6; l += l < 5.6 ? 0.4 : 0.8) { if (!walkable(px + w.nx * l, py + w.ny * l)) break; if (inPark(px + w.nx * l, py + w.ny * l)) { park = true; break; } h = l; }
      if (park) h -= 0.3; if (h - first < 0.75) { if (!park && wall - first > 0.75) { tl[i] = first + 0.25; th[i] = Math.max(first + 0.5, wall - 0.3); } continue; }
      hi[i] = h; lo[i] = Math.max(first + 0.35, h > FURN + 1.3 ? FURN : Math.max(0.5, h - 1.3)); if (lo[i] > hi[i] - 0.3) lo[i] = hi[i] - 0.3; ok++;
    }
    // a short pinch (a wall that comes to within a stride of the kerb for a few metres) is squeezed through, not a dead end
    for (let i = 0; i < n; i++) { if (hi[i] > 0) continue; let j = i; while (j < n && !(hi[j] > 0) && th[j] > 0) j++; if (j > i && j - i <= 5 && i > 0 && j < n && hi[j] > 0) { for (let k = i; k < j; k++) { lo[k] = tl[k]; hi[k] = th[k]; ok++; } } i = Math.max(i, j); }
    w.lo = lo; w.hi = hi; w.np = n; return ok;
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
  const OC = 6, og = new Map(), ok_ = (i, j) => i * 8192 + j, allObs = [];
  const addObs = (x, y, r) => { const o = { x, y, r }; allObs.push(o); const k = ok_(Math.floor(x / OC), Math.floor(y / OC)); let a = og.get(k); if (!a) og.set(k, (a = [])); a.push(o); };
  for (const a of st.circ.values()) for (const o of a) if (o.on && !(o.tag && typeof o.tag === 'object')) addObs(o.x, o.y, Math.min(o.r, 1.2));
  for (const o of extraObs) addObs(o.x, o.y, o.r);
  // is a body of radius r at (x, y) in something?
  const blocked = (x, y, r) => { for (let i = Math.floor((x - r - 1.6) / OC); i <= Math.floor((x + r + 1.6) / OC); i++) for (let j = Math.floor((y - r - 1.6) / OC); j <= Math.floor((y + r + 1.6) / OC); j++) { const a = og.get(ok_(i, j)); if (a) for (const o of a) if ((o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r) ** 2) return true; } return false; };
  for (const w of ways) {
    if (w.kind === 'cross') continue;
    const x0 = Math.min(w.ax, w.b.x) - 13, x1 = Math.max(w.ax, w.b.x) + 13, y0 = Math.min(w.ay, w.b.y) - 13, y1 = Math.max(w.ay, w.b.y) + 13;
    for (let i = Math.floor(x0 / OC); i <= Math.floor(x1 / OC); i++) for (let j = Math.floor(y0 / OC); j <= Math.floor(y1 / OC); j++) {
      const a = og.get(ok_(i, j)); if (!a) continue;
      for (const o of a) { const dx = o.x - w.ax, dy = o.y - w.ay, s = dx * w.ux + dy * w.uy, l = dx * w.nx + dy * w.ny; if (s > -1.5 && s < w.len + 1.5 && l > -0.3 && l < HI_CAP + 1) w.obs.push({ s, l, r: o.r, x: o.x, y: o.y }); }
    }
    w.obs.sort((p, q) => p.s - q.s);
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
  }
  // ---- how busy each way is (people per metre at scale 1): avenues and the big cross streets first, side streets thin, more by a plaza
  let total = 0;
  for (const w of ways) {
    const e = w.e, mx = w.ax + w.ux * w.len / 2, my = w.ay + w.uy * w.len / 2;
    let rho = e.ave ? 1.25 : /Broadway/.test(e.name || '') ? 1.0 : e.lanes >= 3 ? 1.0 : 0.3;
    if (w.kind === 'cross') rho = 0;
    else { let wd = 0, n = 0; for (let i = 0; i < w.np; i++) if (w.hi[i] > 0) { wd += w.hi[i] - w.lo[i]; n++; } w.width = n ? wd / n : 0; rho *= Math.min(1.7, Math.max(0.35, w.width / 3)); }
    w.plaza = nearPlaza(mx, my);      // (a plaza is not busier than the avenue beside it: the photos show them half empty)
    rho *= 0.75 + 0.5 * hash(w.e.len * 7.3 + (w.side || 0), e.a * 3.1 + e.b);
    if (w.a.inc.length < 2 || w.b.inc.length < 2) rho *= 0.4;      // a walk that ends: few go down it
    w.rho = rho; total += rho * w.len; w.mx = mx; w.my = my;
  }
  // ---- places to stand on the plazas themselves (clear of walls, poles and furniture circles)
  const spots = [], o = {};
  pz.forEach((p, pi) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    if (x1 < -bx || x0 > bx || y1 < -by || y0 > by) return; const n = Math.min(24, Math.round(p.area / 90));
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const x = x0 + (x1 - x0) * hash(pi * 3.7 + tries, 1.3), y = y0 + (y1 - y0) * hash(pi * 5.1 + tries, 7.9);
      if (!pointInPoly(x, y, p.poly) || Math.abs(x) > bx || Math.abs(y) > by || R.inLane(x, y, 1.2)) continue;
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
  for (const nd of nodes) { delete nd._arms; delete nd._corners; }
  rep.ways = ways.length; rep.verts = verts.length; rep.km = +(ways.reduce((s, w) => s + (w.kind === 'cross' ? 0 : w.len), 0) / 1000).toFixed(1); rep.spots = spots.length;
  rep.obstacles = allObs.length;
  return { ways, verts, spots, near, blocked, report: rep, STEP, weight: total };
}
// the band at distance s along a way
export function bandAt(w, s, out) {
  const f = s / STEP, i = f <= 0 ? 0 : f >= w.np - 1 ? w.np - 1 : Math.floor(f), j = Math.min(w.np - 1, i + 1), t = Math.min(1, Math.max(0, f - i));
  out.lo = w.lo[i] + (w.lo[j] - w.lo[i]) * t; out.hi = w.hi[i] + (w.hi[j] - w.hi[i]) * t; return out;
}
