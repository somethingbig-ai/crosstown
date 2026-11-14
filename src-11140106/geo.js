// geo.js: map-space helpers. The sim runs in map metres (x east, y north, heading = atan2(dy, dx)); three.js is (x, up, -y).
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class Polyline {
  constructor(pts) {
    this.p = pts; this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }
  // point + unit tangent at distance s
  at(s, out = {}) {
    const c = this.cum, p = this.p; s = clamp(s, 0, this.len);
    let i = this._i || 1; if (i >= c.length) i = 1;
    if (c[i - 1] > s || c[i] < s) { i = 1; while (i < c.length - 1 && c[i] < s) i++; }
    this._i = i;
    const a = p[i - 1], b = p[i], L = c[i] - c[i - 1] || 1e-6, t = (s - c[i - 1]) / L;
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.tx = (b[0] - a[0]) / L; out.ty = (b[1] - a[1]) / L;
    return out;
  }
  // nearest point: returns {s, d, x, y}
  project(x, y) {
    let best = { d: 1e18, s: 0, x: 0, y: 0 }; const p = this.p;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0], ay = p[i - 1][1], bx = p[i][0], by = p[i][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1), px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d, s: this.cum[i - 1] + Math.sqrt(L2) * t, x: px, y: py };
    }
    return best;
  }
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Static collision: wall segments and round obstacles in a uniform grid.
export class StaticWorld {
  constructor(cell = 16) { this.cell = cell; this.segs = new Map(); this.circ = new Map(); this.blocks = new Map(); this.owner = null; }
  // tiles lane (map areas that come and go): while this.owner names a tile set, every wall, circle and sidewalk block added carries that name
  // (no caller changes); removeSet(name) takes them all out again. Things added with no owner set stay for good, as before.
  removeSet(name) { let n = 0; for (const m of [this.segs, this.circ, this.blocks]) for (const [k, a] of m) { const b = a.filter((o) => o.set !== name); if (b.length !== a.length) { n += a.length - b.length; if (b.length) m.set(k, b); else m.delete(k); } } return n; }
  key(i, j) { return i * 100003 + j; }
  addSeg(ax, ay, bx, by) {
    const c = this.cell, s = [ax, ay, bx, by]; if (this.owner) s.set = this.owner;
    const i0 = Math.floor(Math.min(ax, bx) / c), i1 = Math.floor(Math.max(ax, bx) / c), j0 = Math.floor(Math.min(ay, by) / c), j1 = Math.floor(Math.max(ay, by) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = this.key(i, j); let a = this.segs.get(k); if (!a) this.segs.set(k, (a = [])); a.push(s); }
  }
  addPoly(poly) { for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; this.addSeg(a[0], a[1], b[0], b[1]); } }
  addCircle(x, y, r, tag) { const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell)); let a = this.circ.get(k); if (!a) this.circ.set(k, (a = [])); const o = { x, y, r, tag, on: true }; if (this.owner) o.set = this.owner; a.push(o); return o; }
  addBlock(poly) {   // sidewalk polygons, for "am I on the kerb"
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of poly.ext) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const c = 64, b = { poly, x0, y0, x1, y1 }; if (this.owner) b.set = this.owner;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) { const k = this.key(i, j); let a = this.blocks.get(k); if (!a) this.blocks.set(k, (a = [])); a.push(b); }
  }
  onSidewalk(x, y) {
    const a = this.blocks.get(this.key(Math.floor(x / 64), Math.floor(y / 64))); if (!a) return false;
    for (const b of a) {
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (pointInPoly(x, y, b.poly.ext)) { let hole = false; for (const h of b.poly.holes) if (pointInPoly(x, y, h)) { hole = true; break; } if (!hole) return true; }
    }
    return false;
  }
  // Push a circle out of everything it overlaps. Returns the number of contacts; out gets the summed push and the last contact normal.
  resolve(x, y, r, out, skipCircles = false) {
    const c = this.cell; let n = 0; out.x = x; out.y = y; out.nx = 0; out.ny = 0; out.depth = 0; out.tag = null;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((y - r) / c), j1 = Math.floor((y + r) / c);
    for (let it = 0; it < 2; it++) {
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j), a = this.segs.get(k);
        if (a) for (const s of a) {
          const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1e-9, t = clamp(((out.x - s[0]) * dx + (out.y - s[1]) * dy) / L2, 0, 1);
          const px = s[0] + dx * t, py = s[1] + dy * t; let ex = out.x - px, ey = out.y - py; const d = Math.hypot(ex, ey);
          if (d < r && d > 1e-6) { ex /= d; ey /= d; out.x += ex * (r - d); out.y += ey * (r - d); out.nx = ex; out.ny = ey; out.depth = Math.max(out.depth, r - d); n++; }
        }
        const b = skipCircles ? null : this.circ.get(k);
        if (b) for (const o of b) {
          if (!o.on) continue; let ex = out.x - o.x, ey = out.y - o.y; const d = Math.hypot(ex, ey), R = r + o.r;
          if (d < R && d > 1e-6) { ex /= d; ey /= d; out.x += ex * (R - d); out.y += ey * (R - d); out.nx = ex; out.ny = ey; out.depth = Math.max(out.depth, R - d); out.tag = o.tag; n++; }
        }
      }
    }
    return n;
  }
  // first hit of a segment against the walls: returns t in [0,1] or 1
  raycast(ax, ay, bx, by) {
    const c = this.cell; let best = 1; const seen = new Set();
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (c * 0.5)) + 1;
    for (let q = 0; q <= steps; q++) {
      const x = ax + ((bx - ax) * q) / steps, y = ay + ((by - ay) * q) / steps, k = this.key(Math.floor(x / c), Math.floor(y / c));
      if (seen.has(k)) continue; seen.add(k); const a = this.segs.get(k); if (!a) continue;
      for (const s of a) {
        const rx = bx - ax, ry = by - ay, sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) continue;
        const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den;
        if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
      }
    }
    return best;
  }
}

const WAVE = 15, EPOCH_UP = 1.2, EPOCH_DOWN = 5.3;   // green-wave speed (m/s) and the two phase origins (s)
// Directed road graph with lanes.
export class Roads {
  constructor(city) {
    this.nodes = city.nodes; this.edges = city.edges;
    for (const e of this.edges) { e.line = new Polyline(e.pts); e.rev = new Polyline(e.pts.slice().reverse()); e.lw = e.lanes > 1 ? 3.3 : 3.4; }
    // Signal timing: a green wave along every one-way avenue in its own direction of travel (as Manhattan's avenues are timed), so a
    // driver holding about WAVE m/s meets green after green. Uptown avenues count the offset one way, downtown avenues the other.
    const gd = ((city.meta && city.meta.grid_deg) || 0) * Math.PI / 180, ux = Math.sin(gd), uy = Math.cos(gd);
    for (const n of this.nodes) {
      if (!n.sig) continue; let sgn = 0;
      for (const k of n.e) { const e = this.edges[k]; if (!e.ave || !e.oneway) continue; const p = e.pts, q = p[p.length - 1], d = (q[0] - p[0][0]) * ux + (q[1] - p[0][1]) * uy; if (Math.abs(d) > e.len * 0.5) sgn += Math.sign(d); }
      if (!sgn) continue; n.wave = Math.sign(sgn); const along = n.p[0] * ux + n.p[1] * uy;
      n.off = ((((sgn > 0 ? -along : along) / WAVE + (sgn > 0 ? EPOCH_UP : EPOCH_DOWN)) % 60) + 60) % 60;
    }
    // Where an avenue begins at a cross street (Madison Avenue at 23rd Street) nothing arrives along the avenue: there the long green
    // goes to the street, in step with the avenue's wave, so that what turns onto the avenue meets its lights green.
    this.nodes.forEach((n, i) => { if (!n.sig) return; let inn = 0, out = 0; for (const k of n.e) { const e = this.edges[k]; if (!e.ave) continue; if (e.b === i || (!e.oneway && e.a === i)) inn++; if (e.a === i || (!e.oneway && e.b === i)) out++; } n.feed = inn === 0 && out > 0; });
    this.twinSignals();
  }
  // Two signalled nodes a few metres apart are one crossing drawn as two (the two carriageways of Park Avenue, a street meeting a
  // forked avenue): they change together, or a car clearing the first half would be held in the middle by the second.
  twinSignals() {
    const par = this.nodes.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (const e of this.edges) if (e.len < 26 && this.nodes[e.a].sig && this.nodes[e.b].sig) { e.twin = true; const a = find(e.a), b = find(e.b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    // a crossing whose halves belong to opposite waves (a two-way avenue with a median) cannot serve both: those all change together
    const mixed = new Set(); this.nodes.forEach((n, i) => { const r = find(i); if (r !== i && (n.wave || 0) !== (this.nodes[r].wave || 0)) mixed.add(r); });
    this.nodes.forEach((n, i) => { const r = find(i); if (mixed.has(r)) { n.off = 10; n.wave = 0; } else if (r !== i) { n.off = this.nodes[r].off; n.wave = this.nodes[r].wave; } });
  }
  // where a car's nose stops for the junction at the end of edge e (distance along the direction of travel)
  stopS(e, dir) { const nd = this.nodes[this.endNode(e, dir)]; return nd.e.length >= 3 ? e.len - nd.r - 5.6 : e.len; }
  // does traffic on e obey the signal at its end? Not on the short link between the two halves of one crossing: once in, clear it
  stops(e, dir) { return !e.twin && this.nodes[this.endNode(e, dir)].e.length >= 3; }
  // is (x, y) within `margin` metres of a travel lane of any road (between junctions)?
  inLane(x, y, margin = 0) {
    for (const e of this.edges) {
      const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
      const half = (e.lanes * e.lw) / 2 + margin; if (x < b[0] - half || x > b[2] + half || y < b[1] - half || y > b[3] + half) continue;
      const pr = e.line.project(x, y); if (pr.d < half && pr.s > 0.5 && pr.s < e.len - 0.5) return true;
    }
    return false;
  }
  // which edge and direction a car at (x, y) heading h is driving on: close to the centre line and pointing the way the car points
  locate(x, y, h, maxD = 30) {
    let best = null; const cx = Math.cos(h), cy = Math.sin(h), t = {};
    for (const e of this.edges) {
      const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
      if (x < b[0] - maxD || x > b[2] + maxD || y < b[1] - maxD || y > b[3] + maxD) continue;
      const pr = e.line.project(x, y); if (pr.d > maxD) continue; e.line.at(pr.s, t);
      const al = cx * t.tx + cy * t.ty; let dir = al >= 0 ? 1 : -1; if (e.oneway) dir = 1;
      const score = pr.d + (1 - al * dir) * 9 + (pr.d > e.width / 2 + 1 ? 6 : 0);    // metres; a car across the lane or off the roadway scores worse
      if (!best || score < best.score) best = { e, dir, d: pr.d, s: dir > 0 ? pr.s : e.len - pr.s, score };
    }
    return best;
  }
  // lanes one can drive along an edge in direction dir (+1: a->b)
  laneCount(e, dir) { return e.oneway ? (dir > 0 ? e.lanes : 0) : Math.max(1, Math.floor(e.lanes / 2)); }
  laneOffset(e, dir, li) {   // metres to the right of the centre line, seen in the direction of travel
    if (e.oneway) return (li - (e.lanes - 1) / 2) * e.lw;
    return (li + 0.5) * e.lw;
  }
  // position on a lane at distance s from its start (in travel direction)
  lanePos(e, dir, li, s, out = {}) {
    const ln = dir > 0 ? e.line : e.rev; ln.at(s, out); const off = this.laneOffset(e, dir, li);
    out.x += out.ty * off; out.y += -out.tx * off; out.h = Math.atan2(out.ty, out.tx); return out;
  }
  endNode(e, dir) { return dir > 0 ? e.b : e.a; }
  startNode(e, dir) { return dir > 0 ? e.a : e.b; }
  // the ways out of a node for someone who arrived by edge `from`
  exits(node, from) {
    const out = [];
    for (const k of this.nodes[node].e) {
      const e = this.edges[k]; if (e === from && this.nodes[node].e.length > 1) continue;
      if (e.a === node) out.push({ e, dir: 1 }); else if (e.b === node && !e.oneway) out.push({ e, dir: -1 });
    }
    return out;
  }
  // signal for traffic arriving at `node` along edge e: 'g' | 'y' | 'r'
  signal(node, e, t) {
    const n = this.nodes[node]; if (!n.sig) return 'g';
    const ph = (t + n.off) % 60;
    if (n.feed ? !e.ave : e.ave) return ph < 27 ? 'g' : ph < 30 ? 'y' : 'r';
    return ph < 32 ? 'r' : ph < 56 ? 'g' : ph < 59 ? 'y' : 'r';
  }
  // seconds until that signal next shows green (0 when it is green now)
  toGreen(node, e, t) {
    const n = this.nodes[node]; if (!n.sig) return 0; const ph = (t + n.off) % 60;
    if (n.feed ? !e.ave : e.ave) return ph < 27 ? 0 : 60 - ph; return ph < 32 ? 32 - ph : ph < 56 ? 0 : 92 - ph;
  }
  nearestEdge(x, y, maxD = 60) {
    let best = null;
    for (const e of this.edges) { const pr = e.line.project(x, y); if (pr.d < maxD && (!best || pr.d < best.d)) best = { e, d: pr.d, s: pr.s, x: pr.x, y: pr.y }; }
    return best;
  }
  // shortest drive from (edge e, dir) to node target: returns list of {e, dir}
  route(e0, dir0, target) {
    const start = this.endNode(e0, dir0), N = this.nodes.length;
    const dist = new Float64Array(N).fill(1e18), prev = new Array(N).fill(null), done = new Uint8Array(N);
    dist[start] = 0;
    for (;;) {
      let u = -1, bd = 1e18; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0 || u === target) break; done[u] = 1;
      const pe = prev[u] ? prev[u].e : e0;
      for (const x of this.exits(u, pe)) { if (x.e.out) continue; const v = this.endNode(x.e, x.dir), nd = bd + x.e.len + 8; if (nd < dist[v]) { dist[v] = nd; prev[v] = { e: x.e, dir: x.dir, from: u }; } }
    }
    if (dist[target] > 1e17) return null;
    const path = []; let u = target; while (u !== start && prev[u]) { path.push({ e: prev[u].e, dir: prev[u].dir }); u = prev[u].from; }
    path.push({ e: e0, dir: dir0 }); path.reverse(); return path;
  }
}
