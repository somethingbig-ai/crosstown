// water/places.js (water lane, helper maps, Nov 16): WHERE on the rivers things are, for any map the game loads. No imports: runs in node too
// (lanes/water/tools/map-field.mjs prints every place and line of a city file).
//   PLACES       where a boat lies for the taking: a lat/lon near a real landing; install.js puts the boat alongside the nearest wall the player can
//                stand at (berth()). kind 'speedboat' = a boat to take; kind 'moorings' = n moored sailboats as scenery (nobody boards them).
//                A place outside the loaded map's play box is skipped before anything is computed for it.
//   riverLines   the line the tug, the tour boat and the route ferry follow on one river: through the middle of the water, the length of the map.
export const PLACES = [
  // ---- the nine-area map (Midtown): as before, same order
  { name: 'Chelsea Piers', lat: 40.7468, lon: -74.0086 }, { name: 'Pier 66', lat: 40.7527, lon: -74.0086 }, { name: 'Pier 76', lat: 40.7585, lon: -74.0048 },
  { name: 'Pier 83', lat: 40.7628, lon: -74.0014 }, { name: 'Pier 84', lat: 40.7641, lon: -74.0005 }, { name: 'W 30th St', lat: 40.7545, lon: -74.0071 },
  { name: 'Stuyvesant Cove', lat: 40.7330, lon: -73.9740 }, { name: 'E 34th St landing', lat: 40.7437, lon: -73.9712 }, { name: 'Pier 97', lat: 40.7715, lon: -73.9945 },
  // ---- uptown, the Hudson
  { name: 'W 70th St pier', lat: 40.7805, lon: -73.9900 },
  { name: 'W 79th St Boat Basin', lat: 40.7861, lon: -73.9853 },
  { name: '79th St moorings', lat: 40.7872, lon: -73.9862, kind: 'moorings', n: 8 },
  { name: 'Riverside, W 96th St', lat: 40.7975, lon: -73.9770 },
  { name: 'Riverside, W 110th St', lat: 40.8065, lon: -73.9705 },
  { name: 'West Harlem Piers, W 125th St', lat: 40.8187, lon: -73.9615 },
  // ---- uptown, the East River and the Harlem River
  { name: 'E 62nd St', lat: 40.7605, lon: -73.9570 },
  { name: 'E 72nd St', lat: 40.7655, lon: -73.9498 },
  { name: 'E 90th St ferry landing', lat: 40.7776, lon: -73.9425 },
  { name: 'Pier 107, E 107th St', lat: 40.7868, lon: -73.9370 },
  { name: 'E 120th St', lat: 40.7965, lon: -73.9290 },
  // ---- DUMBO and the bridges
  { name: 'Fulton Ferry Landing', lat: 40.7032, lon: -73.9958 },
  { name: 'Brooklyn Bridge Park, Pier 1', lat: 40.7018, lon: -73.9972 },
  { name: 'Main St cove', lat: 40.7044, lon: -73.9905 },
  { name: 'John St', lat: 40.7046, lon: -73.9872 },
  { name: 'Pier 11, Wall St', lat: 40.7033, lon: -74.0060 },
  { name: 'Pier 17', lat: 40.7056, lon: -74.0015 },
  { name: 'Pier 35', lat: 40.7095, lon: -73.9885 },
];
// fairway marks, south to north: where the middle of a river is on a map that has only one of its banks (DUMBO: Manhattan is not in that map's data,
// so the water runs on west to the picture's edge). With two or more of a river's marks on the map the route boats run mark to mark; else riverLines finds the middle.
export const FAIRWAY = [
  { river: 'East River', name: 'off Pier 11', lat: 40.6990, lon: -74.0040 }, { river: 'East River', name: 'Brooklyn Bridge, mid span', lat: 40.70568, lon: -73.99633 },
  { river: 'East River', name: 'Manhattan Bridge, mid span', lat: 40.70697, lon: -73.99047 }, { river: 'East River', name: 'off the Navy Yard', lat: 40.7090, lon: -73.9785 },
  { river: 'East River', name: 'Williamsburg Bridge, mid span', lat: 40.7135, lon: -73.9722 },
];
export function fairwayOn(meta, riverName) { const toMap = toMapOf(meta); return FAIRWAY.filter((f) => f.river === riverName).map((f) => toMap(f.lat, f.lon)); }
// lat/lon -> map metres (the city file's frame)
export const toMapOf = (meta) => { const k = 111320 * Math.cos(meta.lat0 * Math.PI / 180); return (la, lo) => [(lo - meta.lon0) * k, (la - meta.lat0) * 110574]; };
// the places of this map: [{ name, kind, x, y, n }], only those within `pad` metres of the play box
export function placesOn(meta, pad = 150) {
  const toMap = toMapOf(meta), p = meta.play || [-600, -600, 600, 600], out = [];
  for (const q of PLACES) { const m = toMap(q.lat, q.lon); if (m[0] < p[0] - pad || m[0] > p[2] + pad || m[1] < p[1] - pad || m[1] > p[3] + pad) continue; out.push({ name: q.name, kind: q.kind || 'speedboat', x: m[0], y: m[1], n: q.n || 0 }); }
  return out;
}

// ---- the route line of one river: [[x, y, clear], ...] from its south end to its north end, clear = metres of water to the nearest shore (<= CAP).
// inWater(x, y): is the point in THIS river; sd(x, y): metres to the shore from the field (saturates at range). The river is looked at on a 30 m grid
// between the play box's south and north sides + `over`; a cell counts with 22 m of water round it; the line is the cheapest way from the south end
// to the north end where a metre near a shore costs up to nine times a metre in mid-river (so it keeps to the middle, takes the wider side of an
// island, and does not run off into a bay). Its ends are drawn back to where there are 110 m of water each side, so a boat can turn round there.
export function riverLines(w, inWater, sd, range, play, fair, over = 700) {
  const G = 30, CAP = 240, MINC = 22, TURN = 110; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of w.poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  if (play) { y0 = Math.max(y0, play[1] - over); y1 = Math.min(y1, play[3] + over); x0 = Math.max(x0, play[0] - 2600); x1 = Math.min(x1, play[2] + 2600); }
  y0 += 60; y1 -= 60; const nx = Math.floor((x1 - x0) / G), ny = Math.floor((y1 - y0) / G); if (nx < 3 || ny < 6 || nx * ny > 400000) return [];
  const N = nx * ny, C = new Float32Array(N), X = (i) => x0 + (i + 0.5) * G, Y = (j) => y0 + (j + 0.5) * G;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = X(i), y = Y(j); C[j * nx + i] = inWater(x, y) && sd(x, y) >= MINC ? CAP : 0; }
  // metres of water round each cell (3-4 chamfer from the cells that do not count; the grid's own sides are open water, not shores)
  const A = G, B = G * 1.4142, rel = (k, v) => { if (C[k] > v) C[k] = v; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!C[k]) continue; if (i) rel(k, C[k - 1] + A); if (j) { rel(k, C[k - nx] + A); if (i) rel(k, C[k - nx - 1] + B); if (i < nx - 1) rel(k, C[k - nx + 1] + B); } }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!C[k]) continue; if (i < nx - 1) rel(k, C[k + 1] + A); if (j < ny - 1) { rel(k, C[k + nx] + A); if (i < nx - 1) rel(k, C[k + nx + 1] + B); if (i) rel(k, C[k + nx - 1] + B); } }
  // cheapest way from one cell to every cell (Dijkstra, a binary heap of [cost, cell])
  const wgt = (k) => { const u = 1 - Math.min(C[k], CAP) / CAP; return 1 + 8 * u * u; };
  const D = new Float64Array(N), from = new Int32Array(N);
  const flood = (s) => { D.fill(1e30); from.fill(-1); const hk = [], hc = [];
    const push = (c, k) => { let i = hk.length; hk.push(k); hc.push(c); while (i) { const p = (i - 1) >> 1; if (hc[p] <= c) break; hk[i] = hk[p]; hc[i] = hc[p]; i = p; } hk[i] = k; hc[i] = c; };
    const pop = () => { const k = hk[0], lc = hc.pop(), lk = hk.pop(), n = hk.length; if (n) { let i = 0; for (;;) { let m = i * 2 + 1; if (m >= n) break; if (m + 1 < n && hc[m + 1] < hc[m]) m++; if (hc[m] >= lc) break; hk[i] = hk[m]; hc[i] = hc[m]; i = m; } hk[i] = lk; hc[i] = lc; } return k; };
    D[s] = 0; push(0, s);
    while (hk.length) { const c0 = hc[0], k = pop(); if (c0 > D[k]) continue; const i = k % nx, j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (!C[q]) continue;
        const c = c0 + (di && dj ? B : A) * (wgt(k) + wgt(q)) * 0.5; if (c < D[q]) { D[q] = c; from[q] = k; push(c, q); } } } };
  const back = (e) => { const o = []; for (let k = e; k >= 0; k = from[k]) o.push(k); return o.reverse(); };
  let cells = [];
  // fairway marks of this river on this map (a map whose river has only one bank in its data: DUMBO): the line runs mark to mark
  const marks = []; for (const m of fair || []) { let b = -1, bd = 200 * 200; const mi = Math.floor((m[0] - x0) / G), mj = Math.floor((m[1] - y0) / G); for (let j = mj - 6; j <= mj + 6; j++) for (let i = mi - 6; i <= mi + 6; i++) { if (i < 0 || j < 0 || i >= nx || j >= ny || !C[j * nx + i]) continue; const d = (X(i) - m[0]) ** 2 + (Y(j) - m[1]) ** 2; if (d < bd) { bd = d; b = j * nx + i; } } if (b >= 0 && marks.indexOf(b) < 0) marks.push(b); }
  if (marks.length >= 2) { for (let a = 0; a + 1 < marks.length; a++) { flood(marks[a]); if (D[marks[a + 1]] > 1e29) break; const leg = back(marks[a + 1]); cells = cells.concat(a ? leg.slice(1) : leg); } }
  else {
    // the south end: the widest water in the lowest rows
    let s = -1; for (let j = 0; j < Math.min(ny, 12) && s < 0; j++) { let b = 0; for (let i = 0; i < nx; i++) { const c = C[j * nx + i]; if (c > b) { b = c; s = j * nx + i; } } if (b < 60 && j < 11) s = -1; }
    if (s < 0) return [];
    flood(s);
    // the north end: the highest row the line reaches with room to turn (70 m each side), else the highest it reaches at all
    let e = -1; for (const need of [70, MINC]) { for (let j = ny - 1; j >= 0 && e < 0; j--) { let b = 0; for (let i = 0; i < nx; i++) { const k = j * nx + i; if (D[k] < 1e29 && C[k] >= need && C[k] > b) { b = C[k]; e = k; } } } if (e >= 0) break; }
    if (e < 0 || e === s) return [];
    cells = back(e); while (cells.length > 12 && C[cells[0]] < TURN) cells.shift(); while (cells.length > 12 && C[cells[cells.length - 1]] < TURN) cells.pop();      /* both ends back to where a 64 m ferry can turn round: seen in a page, she put her bow ashore turning in the Harlem River (42 m of water each side) */
  }
  if (cells.length < 8) return [];
  // a point every 180 m, each the mean of the cells round it (rounds the grid's stairs off without cutting a bend)
  const line = [], STEP = 6;
  for (let a = 0; a < cells.length; a += STEP) { let sx = 0, sy = 0, n = 0, c = 1e9; for (let b = Math.max(0, a - 3); b <= Math.min(cells.length - 1, a + 3); b++) { const k = cells[b], i = k % nx; sx += X(i); sy += Y((k - i) / nx); c = Math.min(c, C[k]); n++; } line.push([sx / n, sy / n, c]); }
  return line.length >= 4 ? [line] : [];
}
