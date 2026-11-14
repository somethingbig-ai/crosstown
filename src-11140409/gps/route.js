// gps/route.js (progress lane, GPS): the drive between any two points of the map, along the roads and their one-way directions.
// Same road rules and the same cost as Roads.route in geo.js (a block costs its length + 8; no U-turn at a junction that has another way out;
// roads that leave the playable map are not used), and the same result shape as mission.js's route ({ segs: [{ e, dir }], s0, end: { s }, len }),
// so anything that draws the job route can draw this one. What is new: it starts from any point (a car's lane, or on foot from the nearest road,
// either way along a two-way street), ends at a point part-way along a block, and searches with a heap and a straight-line bound (A*), so a
// plan across the whole two-area map takes a fraction of a millisecond instead of scanning every junction for every step.
// No three.js, no DOM: runs in node for the timing test (lanes/progress/gps/tools/routetest.mjs).

export class Router {
  constructor(roads) {
    this.R = roads; const N = (this.N = roads.nodes.length);
    this.dist = new Float64Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N); this.gen = 0;
    this.pe = new Array(N).fill(null); this.pd = new Int8Array(N); this.pf = new Int32Array(N);     // how each junction was reached: by edge, direction, from junction (-1 = the start block)
    this.hk = new Float64Array(N * 4 + 16); this.hn = new Int32Array(N * 4 + 16); this.hl = 0;         // heap: keys and junctions
    // ways out of each junction, built once: [{ e, dir, to }]
    this.out = roads.nodes.map(() => []);
    for (const e of roads.edges) { this.out[e.a].push({ e, dir: 1, to: e.b }); if (!e.oneway) this.out[e.b].push({ e, dir: -1, to: e.a }); }
    for (const e of roads.edges) if (!e.box) e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    this.plans = 0; this.ms = 0; this.worst = 0;
    // THE CORE: the biggest set of junctions that can all drive to each other on roads inside the map. At the map's edge there are blocks one can
    // only drive out of the map from, or only into the map on: a waypoint goes on a block one can get TO (e.goal), a start on a block one can get
    // away FROM (e.start), so a route always exists between what this module picks.
    const usable = roads.edges.filter((e) => !e.out), inn = roads.nodes.map(() => []); for (const e of usable) { inn[e.b].push(e.a); if (!e.oneway) inn[e.a].push(e.b); }
    const reach = (seed, next) => { const seen = new Uint8Array(N), st = [seed]; seen[seed] = 1; while (st.length) { const u = st.pop(); for (const v of next(u)) if (!seen[v]) { seen[v] = 1; st.push(v); } } return seen; };
    const fwd = (u) => this.out[u].filter((x) => !x.e.out).map((x) => x.to), bwd = (u) => inn[u];
    const tried = new Uint8Array(N); let core = new Uint8Array(N), size = 0; const nUse = new Set(usable.flatMap((e) => [e.a, e.b]));
    for (const s0 of nUse) { if (tried[s0]) continue; const F = reach(s0, fwd), B = reach(s0, bwd), C = new Uint8Array(N); let n = 0; for (let i = 0; i < N; i++) if (F[i] && B[i]) { C[i] = 1; tried[i] = 1; n++; } if (n > size) { size = n; core = C; } if (size * 2 > nUse.size) break; }
    this.core = core; this.coreSize = size;
    for (const e of roads.edges) { e.goal = !e.out && !!(core[e.a] || (!e.oneway && core[e.b])); e.start = !e.out && !!(core[e.b] || (!e.oneway && core[e.a])); }
  }
  // the nearest drivable roads to a point: [{ e, t (metres from e.a along the centre line), d, x, y }], nearest first, at most n
  // want: 'goal' | 'start' keeps to blocks of the core (see the constructor)
  nearest(x, y, maxD = 400, n = 1, want = '') {
    const got = [];
    for (const e of this.R.edges) {
      if (e.out || (want && !e[want])) continue; const b = e.box; if (x < b[0] - maxD || x > b[2] + maxD || y < b[1] - maxD || y > b[3] + maxD) continue;
      const pr = e.line.project(x, y); if (pr.d > maxD) continue;
      got.push({ e, t: pr.s, d: pr.d, x: pr.x, y: pr.y }); if (n === 1 && got.length > 1) { if (got[1].d < got[0].d) got[0] = got[1]; got.length = 1; }
    }
    if (n > 1) { got.sort((a, b) => a.d - b.d); got.length = Math.min(got.length, n); }
    return got;
  }
  push(k, n) { const hk = this.hk, hn = this.hn; let i = this.hl++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hn[i] = hn[p]; i = p; } hk[i] = k; hn[i] = n; }
  pop() { const hk = this.hk, hn = this.hn, top = hn[0], L = --this.hl; if (L > 0) { const k = hk[L], n = hn[L]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= L) break; if (c + 1 < L && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hn[i] = hn[c]; i = c; } hk[i] = k; hn[i] = n; } return top; }

  // plan(), and when the way the car points leads nowhere (a block whose far end only goes on out of the map): the route that starts by turning round
  planAny(from, to) { return this.plan(from, to) || (from.dir && !from.e.oneway ? this.plan({ e: from.e, t: from.t, dir: 0 }, to) : null); }
  // from: { e, t, dir } (dir 1 | -1 = the way the car points; 0 = either way the road allows: on foot).  to: { e, t }.
  // Returns { segs, s0, end: { s }, len } or null when there is no drive.
  plan(from, to) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0, R = this.R, nodes = R.nodes, G = to.e, gt = to.t, gx = to.x, gy = to.y;
    const gen = ++this.gen, dist = this.dist, stamp = this.stamp, closed = this.closed; this.hl = 0;
    const h = (n) => Math.hypot(nodes[n].p[0] - gx, nodes[n].p[1] - gy);
    let best = 1e18, bestVia = -2, bestDir = 0, bestStart = 0;       // bestVia: -2 none, -1 straight along the start block, else the junction the last block is entered from
    const dirs = from.dir ? [from.e.oneway ? 1 : from.dir] : from.e.oneway ? [1] : [1, -1], E0 = from.e, startOf = {};
    for (const d of dirs) {
      const s = d > 0 ? from.t : E0.len - from.t; startOf[d] = s;
      if (G === E0) { const gs = d > 0 ? gt : G.len - gt; if (gs > s - 2 && gs - s < best) { best = Math.max(0, gs - s); bestVia = -1; bestDir = d; bestStart = d; } }
      const n = d > 0 ? E0.b : E0.a, c = E0.len - s;
      if (stamp[n] !== gen || c < dist[n]) { stamp[n] = gen; dist[n] = c; this.pe[n] = E0; this.pd[n] = d; this.pf[n] = -1; this.push(c + h(n), n); }
    }
    while (this.hl) {
      if (this.hk[0] >= best) break; const u = this.pop(); if (closed[u] === gen) continue; closed[u] = gen;
      const du = dist[u], pe = this.pe[u], outs = this.out[u]; let only = true; for (let i = 0; i < outs.length; i++) if (!outs[i].e.out && outs[i].e !== pe) { only = false; break; }      // turning back is allowed only where the map leaves no other way on
      for (let i = 0; i < outs.length; i++) {
        const x = outs[i], e = x.e; if (e.out || (e === pe && !only)) continue;
        if (e === G) { const c = du + 8 + (x.dir > 0 ? gt : G.len - gt); if (c < best) { best = c; bestVia = u; bestDir = x.dir; } }
        const v = x.to; if (closed[v] === gen) continue; const c = du + e.len + 8;
        if (stamp[v] !== gen || c < dist[v]) { stamp[v] = gen; dist[v] = c; this.pe[v] = e; this.pd[v] = x.dir; this.pf[v] = u; this.push(c + h(v), v); }
      }
    }
    let out = null;
    if (bestVia === -1) out = { segs: [{ e: E0, dir: bestStart }], s0: startOf[bestStart], end: { s: bestStart > 0 ? gt : G.len - gt }, len: best };
    else if (bestVia >= 0) {
      const segs = [{ e: G, dir: bestDir }]; let u = bestVia, guard = this.N + 2;
      while (u >= 0 && guard-- > 0) { segs.push({ e: this.pe[u], dir: this.pd[u] }); u = this.pf[u]; }
      segs.reverse(); const d0 = segs[0].dir; let len = -startOf[d0]; for (let i = 0; i < segs.length - 1; i++) len += segs[i].e.len; const es = bestDir > 0 ? gt : G.len - gt;
      out = { segs, s0: startOf[d0], end: { s: es }, len: len + es };
    }
    if (t0) { const ms = performance.now() - t0; this.plans++; this.ms += ms; if (ms > this.worst) this.worst = ms; this.last = ms; }
    return out;
  }
}

// metres still to drive on a route (from s0 on its first block to end.s on its last)
export function routeLeft(r) { if (!r) return 0; const n = r.segs.length; if (n === 1) return Math.max(0, r.end.s - r.s0); let L = r.segs[0].e.len - r.s0 + r.end.s; for (let i = 1; i < n - 1; i++) L += r.segs[i].e.len; return Math.max(0, L); }

// The route as one line of points in map metres, for drawing on the road: each block's centre line shifted `off(e, dir)` metres to the right of
// travel, cut short of each junction and joined through it with a curve, then cut to [start, start + maxLen] and resampled every `step` metres.
// out: Float32Array of x, y pairs (reused); returns the number of points.
export function roadLine(roads, r, off, start, maxLen, step, out) {
  const pts = []; const n = r.segs.length, tmp = {};
  let prevEnd = null, run = 0;
  for (let i = 0; i < n; i++) {
    const sg = r.segs[i], e = sg.e, ln = sg.dir > 0 ? e.line : e.rev, o = off(e, sg.dir);
    const na = roads.nodes[sg.dir > 0 ? e.a : e.b], nb = roads.nodes[sg.dir > 0 ? e.b : e.a];
    let from = i === 0 ? r.s0 : Math.min(ln.len * 0.45, (na.r || 6) + 3), to = i === n - 1 ? r.end.s : ln.len - Math.min(ln.len * 0.45, (nb.r || 6) + 3);
    if (i === 0 && n > 1 && from > to) from = to; if (i === n - 1 && n > 1 && to < from) to = from; if (to < from) to = from;
    const put = (s) => { ln.at(s, tmp); const q = [tmp.x + tmp.ty * o, tmp.y - tmp.tx * o, tmp.tx, tmp.ty]; return q; };
    const a = put(from);
    if (prevEnd) {     // the curve through the junction: a quadratic whose control point is where the two lanes' lines meet (or half-way, when they are parallel)
      const p = prevEnd, den = p[2] * a[3] - p[3] * a[2]; let cx = (p[0] + a[0]) / 2, cy = (p[1] + a[1]) / 2;
      if (Math.abs(den) > 0.2) { const k = ((a[0] - p[0]) * a[3] - (a[1] - p[1]) * a[2]) / den, far = Math.hypot(a[0] - p[0], a[1] - p[1]); if (k > 0 && k < far * 2) { cx = p[0] + p[2] * k; cy = p[1] + p[3] * k; } }
      for (let k = 1; k < 6; k++) { const t = k / 6, u = 1 - t; pts.push([u * u * p[0] + 2 * u * t * cx + t * t * a[0], u * u * p[1] + 2 * u * t * cy + t * t * a[1]]); }
    }
    pts.push(a);
    for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 0.5 || ln.cum[j] >= to - 0.5) continue; pts.push(put(ln.cum[j])); }
    const b = put(to); pts.push(b); prevEnd = b; run += Math.max(0, to - from) + 12;
    if (run > start + maxLen + 80) break;      // enough road for the window: the rest of the route is not walked
  }
  // resample by distance
  let acc = 0, k = 0, next = start; const end = start + maxLen;
  for (let i = 1; i < pts.length && k * 2 + 2 <= out.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-4) continue;
    while (next <= acc + L && next <= end && k * 2 + 2 <= out.length) { const t = (next - acc) / L; out[k * 2] = a[0] + (b[0] - a[0]) * t; out[k * 2 + 1] = a[1] + (b[1] - a[1]) * t; k++; next += step; }
    acc += L; if (next > end) break;
  }
  roadLine.total = acc;      // length walked (the whole line when it is shorter than start + maxLen)
  roadLine.atEnd = next <= end;       // the window reaches the route's end
  if (roadLine.atEnd && pts.length && k * 2 + 2 <= out.length && acc > start) { const b = pts[pts.length - 1]; out[k * 2] = b[0]; out[k * 2 + 1] = b[1]; k++; }
  return k;
}
