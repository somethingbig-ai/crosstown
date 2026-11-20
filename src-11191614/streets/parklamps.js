// streets/parklamps.js (merge2 round 33, Nov 19): where the lamp posts of the small street-level parks stand. Pure arithmetic on the map data and the
// grass layer's path layouts (assets/streets/grass/parks*.json, the `paths` grass.js hands on); no THREE, no page: furniture.js draws them (kind 'plamp'),
// makes them solid and the night kit lights them (sky/nightkit.js reads the kind's list). ?pathlamps=0 = none (not ?parklamps: that name is the park lane's, for Central Park's own posts).
// The rule, per park that has a path layout (found by name and place, as grass.js finds it; not the housing greens marked nf):
//  - a post about every STEP metres along each path, the longest paths first, sides alternating along a path (a staggered row, as park lamps stand);
//  - it stands OFF metres outside the paving (path half width 2.3 + the soil strip and the lawn fence), never nearer than that to ANY paving of the park
//    (another path, a paved area, a building's apron), so none is on a path or in a junction;
//  - inside the park's outline and RIM metres clear of it (the outer fence and the sidewalk beyond), not in a hole, not in or beside sand, water or a park building;
//  - 1.8 m clear of every tree trunk; clear of whatever the caller says is taken (furniture.js: its own pieces, buildings);
//  - never nearer than MIN metres to another post (junctions do not gather posts). A place that fails is tried on the other side, then up to SLIDE metres along.
export const PATH_W = 4.6, OFF = 1.0, STEP = 22, MIN = 15, RIM = 2.5, TREE = 1.8, SLIDE = 6;
const pip = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const dSeg = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0; return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
const dLine = (x, y, P, closed) => { let d = 1e9; for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, dSeg(x, y, P[i], P[i + 1])); if (closed && P.length > 2) d = Math.min(d, dSeg(x, y, P[P.length - 1], P[0])); return d; };
const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
const bbox = (P) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
// the layout of a park: grass.js's own rule (same name, the layout's middle inside the park's box, the nearest such)
export function layOf(pk, bb, layParks) { let best = null, bd = 1e9; for (const L of layParks || []) { let x = 0, y = 0, n = 0; for (const a of (L.paths || []).concat(L.areas || [])) for (const q of a.p || []) { x += q[0]; y += q[1]; n++; } if (!n || (L.name || '') !== (pk.name || '')) continue; x /= n; y /= n;
    if (x < bb[0] - 5 || x > bb[2] + 5 || y < bb[1] - 5 || y > bb[3] + 5) continue; const d = Math.hypot(x - (bb[0] + bb[2]) / 2, y - (bb[1] + bb[3]) / 2); if (d < bd) { bd = d; best = L; } } return best; }
// metres from a point to the nearest paving of a layout (negative = on it): what grass.js paints as paving in the park's mask
export function paveDist(x, y, L) { let d = 1e9; for (const p of L.paths || []) { if (!p.p || p.p.length < 2) continue; d = Math.min(d, dLine(x, y, p.p, p.c) - PATH_W / 2); if (p.c && p.p.length > 2 && area(p.p) < 900 && pip(x, y, p.p)) d = Math.min(d, -1); }
  for (const a of L.areas || []) { if (a.k === 'sand' || a.k === 'water' || !a.p || a.p.length < 3) continue; d = Math.min(d, pip(x, y, a.p) ? -1 : dLine(x, y, a.p, true) - (a.k === 'building' ? 2.5 : 0.3)); } return d; }
// place(city, layParks, o) -> { posts: [[x, y, park index]], parks: [{ name, at, n, tried }] }
//   o.skip(x, y): this park is another layer's (Central Park); o.taken(x, y): something stands here; o.ok(x, y): the map is played here
export function place(city, layParks, o = {}) {
  const posts = [], parks = [], trees = new Map(), TC = 8, tk = (i, j) => i * 100003 + j;
  for (const t of (city.props && city.props.tree) || []) { const k = tk(Math.floor(t[0] / TC), Math.floor(t[1] / TC)); let a = trees.get(k); if (!a) trees.set(k, (a = [])); a.push(t); }
  const treeNear = (x, y) => { const i0 = Math.floor(x / TC), j0 = Math.floor(y / TC); for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const a = trees.get(tk(i, j)); if (a) for (const t of a) if (Math.hypot(t[0] - x, t[1] - y) < TREE) return true; } return false; };
  const seen = new Set();
  (city.parks || []).forEach((pk, pi) => { if (!pk.ext || pk.ext.length < 3) return; const bb = bbox(pk.ext), cx = pk.ext.reduce((s, p) => s + p[0], 0) / pk.ext.length, cy = pk.ext.reduce((s, p) => s + p[1], 0) / pk.ext.length;
    if (o.skip && o.skip(cx, cy)) return; const L = layOf(pk, bb, layParks); if (!L || L.nf || !(L.paths || []).length) return;
    const key = (pk.name || '') + '|' + bb.map((v) => Math.round(v)).join(','); if (seen.has(key)) return; seen.add(key);      /* a park listed twice (two outlines of one place) gets one set of posts */
    const bad = (L.areas || []).filter((a) => (a.k === 'sand' || a.k === 'water' || a.k === 'building') && a.p && a.p.length >= 3), rec = { name: pk.name || '', at: [Math.round(cx), Math.round(cy)], n: 0, tried: 0 };
    const good = (x, y) => { if (!pip(x, y, pk.ext) || dLine(x, y, pk.ext, true) < RIM) return false; for (const h of pk.holes || []) if (h.length > 2 && (pip(x, y, h) || dLine(x, y, h, true) < RIM)) return false;
      if (o.ok && !o.ok(x, y)) return false; if (paveDist(x, y, L) < OFF - 0.1) return false; for (const a of bad) if (pip(x, y, a.p) || dLine(x, y, a.p, true) < 1.0) return false;
      if (treeNear(x, y)) return false; for (const q of posts) if (Math.hypot(q[0] - x, q[1] - y) < MIN) return false; return !(o.taken && o.taken(x, y)); };
    const lines = L.paths.filter((p) => p.p && p.p.length >= 2).map((p, k) => { const P = p.c && p.p.length > 2 ? p.p.concat([p.p[0]]) : p.p, S = [0]; for (let i = 0; i + 1 < P.length; i++) S.push(S[i] + Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1])); return { P, S, len: S[S.length - 1], k }; })
      .filter((l) => l.len >= 10).sort((a, b) => b.len - a.len || a.k - b.k);
    const at = (l, s, side) => { s = Math.max(0, Math.min(l.len, s)); let i = 0; while (i + 2 < l.S.length && l.S[i + 1] < s) i++; const a = l.P[i], b = l.P[i + 1], sl = l.S[i + 1] - l.S[i] || 1, t = (s - l.S[i]) / sl, tx = (b[0] - a[0]) / sl, ty = (b[1] - a[1]) / sl, d = PATH_W / 2 + OFF;
      return [a[0] + (b[0] - a[0]) * t - ty * d * side, a[1] + (b[1] - a[1]) * t + tx * d * side]; };
    for (const l of lines) { const n = Math.max(1, Math.round(l.len / STEP)); for (let k = 0; k < n; k++) { const s0 = (k + 0.5) * l.len / n, side = (k + l.k) % 2 ? 1 : -1; rec.tried++; let done = false;
        for (let sl = 0; sl <= SLIDE && !done; sl += 2) for (const ds of sl ? [sl, -sl] : [0]) { if (done) break; const s = s0 + ds; if (s < 0 || s > l.len) continue; for (const sd of [side, -side]) { const q = at(l, s, sd); if (good(q[0], q[1])) { posts.push([+q[0].toFixed(2), +q[1].toFixed(2), pi]); rec.n++; done = true; break; } } } } }
    parks.push(rec); });
  return { posts, parks };
}
