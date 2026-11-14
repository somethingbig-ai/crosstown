// entry/walkround.js (gameplay lane, Nov 13): the player's body never passes through a car or the helicopter.
// Matt, on the 16:16 build: "When I got into the car, the guy literally walked through it to get to the door... He should have walked around it."
// Three things, used by entry.js (cars) and heliboard.js (helicopter):
//   boxes   every car near a point as a body box on the map (parked, the player's own, traffic), and box maths (depth, pushOut)
//   plan()  a way on foot from A to B that stays outside everything `blocked(x, y)` says is solid: A* on a 12.5 cm grid laid round the goal,
//           then pulled straight where there is a clear line. Finds the way between two bumpers if a body fits, round the neighbour if not,
//           and returns null when there is no way at all (the caller then says so instead of walking through).
//   The pads: WIDE is how far from a body he walks when there is room, TIGHT what he will squeeze through, FOOT what ordinary walking keeps.
// Own work; nothing from any other game.
export const WIDE = 0.45, TIGHT = 0.22, FOOT = 0.30, BODY_R = 0.25;

// ---- body boxes. A box: centre x, y on the map, c/s = cos/sin of its heading, hl/hw = half length and half width, o = whose it is.
export function carBox(o, B = {}) { const d = o.def || {}; B.x = o.x; B.y = o.y; const h = o.h || 0; B.c = Math.cos(h); B.s = Math.sin(h); B.hl = (d.len || 4.6) / 2; B.hw = (d.wid || 1.85) / 2; B.o = o; B.pad = undefined; return B; }
// how deep a point is inside the box grown by pad (> 0 inside, <= 0 outside: minus the gap on the nearer axis)
export function depth(B, x, y, pad = 0) { const dx = x - B.x, dy = y - B.y, f = Math.abs(dx * B.c + dy * B.s) - B.hl - pad, sd = Math.abs(-dx * B.s + dy * B.c) - B.hw - pad; return -Math.max(f, sd); }
// true distance from a point to the box's outline (0 inside)
export function gap(B, x, y) { const dx = x - B.x, dy = y - B.y, f = Math.max(0, Math.abs(dx * B.c + dy * B.s) - B.hl), sd = Math.max(0, Math.abs(-dx * B.s + dy * B.c) - B.hw); return Math.hypot(f, sd); }
// put a point outside every box (grown by pad, or the box's own pad): out by the shorter way, a few rounds for boxes that stand close. Returns true if it moved.
export function pushOut(boxes, p, pad = FOOT) {
  const x0 = p.x, y0 = p.y; let moved = false;
  for (const lim of [9, 0.02]) {      // first with the margin; if two bodies stand so close that the margins cannot both be kept, out of the bodies themselves
    for (let it = 0; it < 4; it++) { let any = false;
      for (let i = 0; i < boxes.length; i++) { const B = boxes[i], q = Math.min(lim, B.pad === undefined ? pad : Math.min(pad, B.pad)), dx = p.x - B.x, dy = p.y - B.y, f = dx * B.c + dy * B.s, sd = -dx * B.s + dy * B.c, pf = B.hl + q - Math.abs(f), ps = B.hw + q - Math.abs(sd);
        if (pf <= 0 || ps <= 0) continue; any = moved = true;
        if (ps < pf) { const k = (sd < 0 ? -1 : 1) * (ps + 0.001); p.x += -B.s * k; p.y += B.c * k; } else { const k = (f < 0 ? -1 : 1) * (pf + 0.001); p.x += B.c * k; p.y += B.s * k; } }
      if (!any) return moved; }
    if (lim === 9) { let inBody = false; for (let i = 0; i < boxes.length; i++) if (depth(boxes[i], p.x, p.y, 0.02) > 0) { inBody = true; break; } if (!inBody) return moved; } }
  // still inside a body (boxes that overlap each other): the nearest clear place on rings round where he was
  for (let r = 0.2; r < 4; r += 0.2) for (let a = 0; a < 16; a++) { const x = x0 + Math.cos(a * 0.3927) * r, y = y0 + Math.sin(a * 0.3927) * r; let ok = true; for (let i = 0; i < boxes.length; i++) if (depth(boxes[i], x, y, 0.02) > 0) { ok = false; break; } if (ok) { p.x = x; p.y = y; return true; } }
  return moved;
}
// the cars within r of a point, as boxes (pooled: the list is good until the next call with the same pool)
export function carsNear(g, x, y, r, pool, skip) {
  const P = pool || { boxes: [], n: 0, pk: [] }; let n = 0; const r2 = r * r;
  const add = (o) => { if (!o || o === skip || o.gone || o.type === undefined) return; const dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy > r2) return; carBox(o, P.boxes[n] || (P.boxes[n] = {})); n++; };
  try { for (const s of g.parked.near(x, y, r, P.pk)) add(s); } catch (e) {}
  for (const v of g.vehicles) add(v);
  if (g.traffic && g.traffic.cars) for (const c of g.traffic.cars) add(c);
  P.boxes.length = n; return P.boxes;
}

// ---- the way round
const N = 112, W = 2 * N + 1, H = 0.125, SZ = W * W;
let cache = null, gs = null, par = null, heap = null, hpos = null;
function alloc() { cache = new Uint8Array(SZ); gs = new Float32Array(SZ); par = new Int32Array(SZ); heap = new Int32Array(SZ * 4); hpos = new Float32Array(SZ * 4); }
// blocked(x, y) -> true where a body (a circle of BODY_R about the point is the caller's business) may not stand.
// Returns { pts: [{x, y}, ...] (from the start, ending exactly on the goal), len, ms, cells } or null.
export function plan(sx, sy, gx, gy, blocked, opt = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0; if (!cache) alloc(); cache.fill(0);
  const free = (i, j) => { if (i < -N || i > N || j < -N || j > N) return false; const k = (j + N) * W + i + N; let c = cache[k]; if (!c) c = cache[k] = blocked(gx + i * H, gy + j * H) ? 2 : 1; return c === 1; };
  if (blocked(gx, gy)) return null; cache[N * W + N] = 1;
  let si = Math.round((sx - gx) / H), sj = Math.round((sy - gy) / H); if (Math.abs(si) > N || Math.abs(sj) > N) return null;
  if (!free(si, sj)) {      // he stands against something: the nearest clear place first (a short step straight out)
    let best = null, bd = 1e9; for (let r = 1; r <= 8 && !best; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { if (Math.max(Math.abs(a), Math.abs(b)) !== r || !free(si + a, sj + b)) continue; const d = Math.hypot(gx + (si + a) * H - sx, gy + (sj + b) * H - sy); if (d < bd) { bd = d; best = [si + a, sj + b]; } }
    if (!best) return null; si = best[0]; sj = best[1];
  }
  // A* from the start cell to the goal cell (0, 0)
  gs.fill(1e9); let hn = 0; const S = (sj + N) * W + si + N, G = N * W + N, hx = (k) => { const i = Math.abs(k % W - N), j = Math.abs(((k / W) | 0) - N); return H * (Math.max(i, j) + 0.4142 * Math.min(i, j)); };
  const push = (k, f) => { if (hn >= heap.length) return; let n = hn++; while (n > 0) { const p = (n - 1) >> 1; if (hpos[p] <= f) break; heap[n] = heap[p]; hpos[n] = hpos[p]; n = p; } heap[n] = k; hpos[n] = f; };
  const pop = () => { const top = heap[0]; hn--; if (hn > 0) { const k = heap[hn], f = hpos[hn]; let n = 0; for (;;) { let c = 2 * n + 1; if (c >= hn) break; if (c + 1 < hn && hpos[c + 1] < hpos[c]) c++; if (hpos[c] >= f) break; heap[n] = heap[c]; hpos[n] = hpos[c]; n = c; } heap[n] = k; hpos[n] = f; } return top; };
  gs[S] = 0; par[S] = -1; push(S, hx(S)); let found = false, cells = 0; const maxCells = opt.maxCells || 40000;
  while (hn > 0 && cells < maxCells) {
    const k = pop(); if (cache[k] === 3) continue; cache[k] = 3; cells++; if (k === G) { found = true; break; }      // 3 = settled (and free)
    const i = k % W - N, j = ((k / W) | 0) - N, g0 = gs[k];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { if (!a && !b) continue; const ni = i + a, nj = j + b; if (ni < -N || ni > N || nj < -N || nj > N) continue; const nk = (nj + N) * W + ni + N; if (cache[nk] === 3 || cache[nk] === 2) continue;
      if (!free(ni, nj)) continue; if (a && b && (!freeOr3(i + a, j) || !freeOr3(i, j + b))) continue;      // no cutting a corner between two solid cells
      const ng = g0 + (a && b ? 1.4142 * H : H); if (ng < gs[nk]) { gs[nk] = ng; par[nk] = k; push(nk, ng + hx(nk)); } }
  }
  function freeOr3(i, j) { if (i < -N || i > N || j < -N || j > N) return false; const c = cache[(j + N) * W + i + N]; return c === 3 || (c !== 2 && free(i, j)); }
  if (!found) return null;
  const raw = []; for (let k = G; k >= 0; k = par[k]) raw.push({ x: gx + (k % W - N) * H, y: gy + (((k / W) | 0) - N) * H }); raw.reverse(); raw[raw.length - 1] = { x: gx, y: gy };
  // pull it straight wherever there is a clear line (sampled every 4 cm with the same test)
  const los = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 0.04); for (let q = 1; q < n; q++) if (blocked(a.x + (b.x - a.x) * q / n, a.y + (b.y - a.y) * q / n)) return false; return true; };
  const pts = [{ x: sx, y: sy }]; if (Math.hypot(raw[0].x - sx, raw[0].y - sy) > 1e-3) pts.push(raw[0]); else raw[0] = pts[0];
  let i = 0; const last = raw.length - 1;
  while (i < last) { let lo = i + 1, hi = last; if (!los(raw[i], raw[hi])) { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (los(raw[i], raw[m])) lo = m; else hi = m; } hi = lo; } pts.push(raw[hi]); i = hi; }
  let len = 0; for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q].x - pts[q - 1].x, pts[q].y - pts[q - 1].y);
  return { pts, len, cells, ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0 };
}
// the comfortable way if there is one and it is not much longer, else the tight way, else null. mk(pad) -> blocked function.
export function planBest(sx, sy, gx, gy, mk, opt = {}) {
  const direct = Math.hypot(gx - sx, gy - sy), a = plan(sx, sy, gx, gy, mk(WIDE), { maxCells: opt.wideCells || 5000 }); if (a && a.len < direct + 7) { a.pad = WIDE; return a; }
  const b = plan(sx, sy, gx, gy, mk(TIGHT), { maxCells: opt.maxCells || 16000 }); if (b) b.pad = TIGHT; if (a) a.pad = WIDE;
  if (a && b) return b.len < a.len - 3 ? b : a; return a || b;
}

// ---- a line of text for the player (the HUD is a canvas of the lead's; this is one small element over it)
let sayEl = null, sayT = 0;
export function say(text, ms = 2600) {
  try { if (typeof document === 'undefined') return; if (!sayEl) { sayEl = document.createElement('div'); sayEl.id = 'entry-say';
      sayEl.style.cssText = 'position:fixed;left:50%;top:70%;transform:translateX(-50%);padding:10px 22px;border-radius:22px;background:rgba(8,9,10,0.66);color:#fff;font:600 18px system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.2px;pointer-events:none;z-index:40;opacity:0;transition:opacity .18s;white-space:nowrap'; document.body.appendChild(sayEl); }
    sayEl.textContent = text; sayEl.style.opacity = '1'; clearTimeout(sayT); sayT = setTimeout(() => { sayEl.style.opacity = '0'; }, ms); } catch (e) {}
}
