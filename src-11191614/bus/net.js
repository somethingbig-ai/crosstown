// bus/net.js (bus lane, Nov 15): the bus routes laid on the game's own road graph.
// assets/bus/routes.json holds each route's line and stops in map metres (from the open GTFS feed; tools/build_data.py). The game's map is a
// graph of blocks (game.roads.edges) that differs per data set (three, six or nine areas), so the lines are matched to the blocks here, at load:
// every 12 m of a route's line picks the block under it that runs the same way; gaps are bridged through the graph; what the loaded map does not
// carry falls away. A line = { key, num, sel, head, via, seq: [{ e, dir, s0 }], len, stops: [{ k, s, S, stop }], hw }.
//   seq[k].s0 = metres from the line's start to the start of that block;  a stop sits on block k at s metres along it (S along the whole line).
// No three.js here: this runs in node too (tools/bsim.mjs).

const CELL = 60;

export function buildNet(game, data, opt = {}) {
  const R = game.roads, B = game.bounds, minLen = opt.minLen || 320;
  // blocks by grid cell
  const grid = new Map(), key = (i, j) => i * 65536 + j;
  for (const e of R.edges) {
    const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
    for (let i = Math.floor((b[0] - 24) / CELL); i <= Math.floor((b[2] + 24) / CELL); i++) for (let j = Math.floor((b[1] - 24) / CELL); j <= Math.floor((b[3] + 24) / CELL); j++) { const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(e); }
  }
  const t = {};
  // the block under (x, y) that can be driven along heading (hx, hy)
  const pick = (x, y, hx, hy, maxD = 20) => {
    const a = grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))); if (!a) return null; let best = null;
    for (const e of a) {
      const pr = e.line.project(x, y); if (pr.d > maxD) continue; e.line.at(pr.s, t); const al = hx * t.tx + hy * t.ty;
      let dir = al >= 0 ? 1 : -1; if (e.oneway && dir < 0) continue; if (Math.abs(al) < 0.72) continue;
      if (R.laneCount(e, dir) < 1) continue;
      const sc = pr.d + (1 - Math.abs(al)) * 30 + (pr.s < 1 || pr.s > e.len - 1 ? 4 : 0); if (!best || sc < best.sc) best = { e, dir, sc, d: pr.d, s: dir > 0 ? pr.s : e.len - pr.s };
    }
    return best;
  };
  // a short drive from the end of (e0, d0) to the start of block (e1, d1): [{e, dir}, ...] between them, or null
  const bridge = (e0, d0, e1, d1, maxHops = 7, maxLen = 520) => {
    const start = R.endNode(e0, d0), goal = R.startNode(e1, d1); if (start === goal) return [];
    let front = [{ n: start, from: e0, path: [], len: 0 }]; const seen = new Set([start]);
    for (let hop = 0; hop < maxHops && front.length; hop++) {
      const next = [];
      for (const f of front) for (const x of R.exits(f.n, f.from)) {
        if (x.e === e1 || x.e === e0) continue; const n = R.endNode(x.e, x.dir), len = f.len + x.e.len; if (len > maxLen || seen.has(n)) { if (n !== goal || len > maxLen) continue; }
        const path = f.path.concat([{ e: x.e, dir: x.dir }]); if (n === goal) return path; seen.add(n); next.push({ n, from: x.e, path, len });
      }
      front = next;
    }
    return null;
  };

  const stops = data.stops.map((s, i) => ({ i, n: s.n, x: s.x, y: s.y, lines: [], routes: [] })), lines = [], rep = { lines: 0, m: 0, shapeM: 0, breaks: 0, stops: 0, stopsOff: 0, short: 0 };
  for (const Rt of data.routes) Rt.dirs.forEach((D, di) => {
    let part = 0;
    for (const run of D.runs) {
      // sample the run
      const sm = []; let tot = 0;
      for (let i = 0; i + 1 < run.length; i++) { const a = run[i], b = run[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue; const hx = (b[0] - a[0]) / L, hy = (b[1] - a[1]) / L, n = Math.max(1, Math.ceil(L / 12)); for (let q = 0; q < n; q++) { const u = (q + 0.5) / n; sm.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, hx, hy]); } tot += L; }
      rep.shapeM += tot;
      const raw = []; for (const s of sm) { if (!B.in(s[0], s[1], 40)) { raw.push(null); continue; } const m = pick(s[0], s[1], s[2], s[3]); raw.push(m && !m.e.out ? m : m ? { ...m, out: 1 } : null); }
      // runs of blocks: collapse repeats, drop one-sample blips between two samples of the same block
      let cur = []; const segs = []; const close = () => { if (cur.length) segs.push(cur); cur = []; };
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i]; if (!m) { if (cur.length && i + 3 < raw.length && (raw[i + 1] || raw[i + 2] || raw[i + 3])) continue; close(); continue; }
        const last = cur[cur.length - 1]; if (last && last.e === m.e && last.dir === m.dir) { last.n++; continue; }
        if (last && cur.length > 1 && last.n === 1) { const p = cur[cur.length - 2]; if (p.e === m.e && p.dir === m.dir) { cur.pop(); p.n++; continue; } }
        cur.push({ e: m.e, dir: m.dir, n: 1 });
      }
      close();
      // join each run's blocks through the graph; where no short drive joins two, the line breaks there
      for (const sg of segs) {
        let seq = []; const flush = () => { if (seq.length) emit(seq); seq = []; };
        const emit = (q) => {
          // a block met by a single sample at a run's end is as often the cross street: trim, and trim blocks that leave the map
          while (q.length && q[0].e.out) q.shift(); while (q.length && q[q.length - 1].e.out) q.pop();
          let len = 0; for (const x of q) { x.s0 = len; len += x.e.len; } if (len < minLen) { rep.short++; return; }
          const L = { key: Rt.id + (Rt.sel ? '+' : '') + ':' + di + (part ? ':' + part : ''), num: Rt.id, sel: !!Rt.sel, ltd: !!D.ltd, head: D.head, via: D.via, name: Rt.name, seq: q.map((x) => ({ e: x.e, dir: x.dir, s0: x.s0 })), len, stops: [], hw: D.hw, di };
          part++; lines.push(L); rep.lines++; rep.m += len;
        };
        for (const x of sg) {
          const last = seq[seq.length - 1]; if (!last) { seq.push(x); continue; }
          if (R.endNode(last.e, last.dir) === R.startNode(x.e, x.dir) && last.e !== x.e) { seq.push(x); continue; }
          const br = last.e === x.e ? null : bridge(last.e, last.dir, x.e, x.dir);
          if (br && !br.some((b) => b.e.out)) { for (const b of br) seq.push({ e: b.e, dir: b.dir, n: 0 }); seq.push(x); } else if (x.n >= 2 || !br) { rep.breaks++; flush(); seq.push(x); }
        }
        flush();
      }
    }
    // the stops of this direction, each on the line (and block) that passes it
    const mine = lines.filter((L) => L.key.startsWith(Rt.id + (Rt.sel ? '+' : '') + ':' + di));
    for (const si of D.stops) {
      const st = stops[si]; let best = null;
      for (const L of mine) L.seq.forEach((q, k) => { const b = q.e.box; if (st.x < b[0] - 30 || st.x > b[2] + 30 || st.y < b[1] - 30 || st.y > b[3] + 30) return; const pr = q.e.line.project(st.x, st.y); if (pr.d > 28) return; const s = q.dir > 0 ? pr.s : q.e.len - pr.s; if (!best || pr.d < best.d) best = { L, k, s, d: pr.d }; });
      if (!best) { rep.stopsOff++; continue; }
      best.L.stops.push({ k: best.k, s: best.s, S: best.L.seq[best.k].s0 + best.s, stop: st }); if (!st.lines.includes(best.L)) st.lines.push(best.L); const nm = best.L.num + (best.L.sel ? '+' : ''); if (!st.routes.includes(nm)) st.routes.push(nm); rep.stops++;
    }
    for (const L of mine) { L.stops.sort((a, b) => a.S - b.S); for (let i = L.stops.length - 1; i > 0; i--) if (L.stops[i].S - L.stops[i - 1].S < 25) L.stops.splice(i, 1); }
  });
  const used = stops.filter((s) => s.lines.length);
  return { lines, stops: used, rep };
}
