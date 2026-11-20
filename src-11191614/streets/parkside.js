// parkside.js (uptown lane, helper "parkside", Nov 16 2026): the sidewalk OUTSIDE Central Park's wall, worked out once from the city data.
// Who owns what: everything inside the park's outline, the wall included, is the park lane's (lanes/park). The sidewalk between the wall and the kerb is uptown's.
// This file draws nothing. It finds, on every Central Park polygon of city.parks, the edges that face a perimeter street (Central Park West, 5th Avenue,
// Central Park South, 110th St / Central Park North) and gives the layers what they need:
//   ground.js     mask()  = one small picture of the whole perimeter (white = the sidewalk from the wall line to just past the kerb): hexagonal asphalt blocks there (?hexwalk=0 = concrete flags as before)
//   furniture.js  segs    = the perimeter edges with their solid stretches (walls: [u0, u1, gate at u0, gate at u1], metres along the edge) and bench places;
//                 the wall there is a STAND-IN (?pkwall=0 = the black picket fence as before) and is THE PARK LANE'S TO REPLACE; benches ?pkbench=0.
// Gates: the park lane's own list (lanes/park/handoff-1/assets/park, `gate` structures: where a path or drive crosses the wall line in the 2017 lidar, and
// OpenStreetMap's gate nodes), copied here as [x, y, width] in the map's metres so this layer needs no file of theirs at run time.
const GATES = [[1102.7,2213.6,3.0],[1107.4,2217.6,3.0],[1119.2,2250.0,3.0],[1190.6,2250.1,3.0],[1033.9,2250.5,3.0],[1189.0,2251.5,3.0],[1175.8,2258.7,3.0],[1131.4,2261.3,3.0],[1012.0,2262.6,3.0],[1154.0,2269.6,11.0],[1145.0,2269.9,5.0],[1146.7,2270.1,11.0],[1207.6,2280.7,3.0],[1220.8,2304.2,3.0],[899.3,2325.4,3.0],[889.7,2330.8,11.0],[846.6,2354.1,3.0],[661.9,2456.2,3.0],[654.0,2460.5,11.0],[624.4,2477.0,3.0],[1323.4,2488.6,3.0],[1333.7,2506.9,3.0],[1336.6,2512.2,3.0],[1274.2,2524.0,3.0],[470.7,2564.6,3.0],[471.7,2568.8,3.0],[1372.1,2575.9,3.0],[474.9,2580.8,3.0],[1375.5,2582.1,10.5],[467.8,2607.5,3.0],[463.2,2625.2,3.0],[472.7,2631.1,3.0],[1413.8,2650.0,10.5],[1415.7,2653.5,3.0],[1441.5,2699.7,3.0],[588.4,2867.8,3.0],[1537.5,2871.8,3.0],[1126.9,2977.3,3.0],[649.3,2978.1,3.0],[652.4,2983.3,10.5],[685.7,3044.8,3.0],[693.1,3057.8,3.0],[694.1,3059.6,4.0],[1643.4,3062.3,3.0],[1648.8,3071.9,15.0],[1653.6,3080.7,3.0],[706.5,3081.3,3.0],[728.0,3119.8,4.0],[732.4,3127.6,3.0],[796.1,3165.3,3.0],[808.5,3264.7,3.0],[1816.5,3373.4,3.0],[924.3,3472.7,4.0],[929.0,3480.3,3.0],[1919.1,3557.8,3.0],[1922.5,3563.9,3.0],[1927.9,3573.5,10.5],[1933.2,3583.1,3.0],[1939.1,3593.6,3.0],[1959.0,3629.4,4.0],[1966.5,3643.6,4.0],[1973.1,3646.4,3.0],[1985.8,3677.7,3.0],[1576.3,3741.9,3.0],[2071.0,3824.8,3.0],[1127.3,3828.8,3.0],[1123.3,3831.2,6.0],[1122.4,3832.6,3.0],[2125.3,3921.2,3.0],[2124.7,3928.9,4.0],[2114.0,3934.3,4.0],[2119.9,3946.7,10.5],[1215.4,3995.1,3.0],[2163.6,4000.2,10.5],[2167.1,4004.9,3.0],[2178.5,4026.1,3.0],[2192.5,4077.5,3.0],[1274.8,4102.8,3.0],[1280.8,4113.2,10.5],[1288.6,4127.2,3.0],[2224.7,4128.5,3.0],[1889.5,4274.2,3.0],[2362.4,4357.2,3.0],[2356.8,4361.6,3.0],[2362.4,4372.1,3.0],[2370.4,4386.3,3.0],[1437.3,4394.6,3.0],[1441.0,4400.6,4.0],[1444.8,4407.6,3.0],[1478.0,4467.0,3.0],[1480.2,4471.4,10.5],[1485.4,4479.9,10.5],[1488.5,4485.0,3.0],[1494.0,4495.8,3.0],[1637.0,4753.8,3.0],[1642.7,4763.2,4.0],[2589.9,4764.1,3.0],[2595.2,4773.7,3.0],[2598.1,4779.0,10.5],[2602.5,4786.9,3.0],[1659.8,4793.7,3.0],[1728.4,4830.1,3.0],[2634.9,4859.2,10.5],[2642.8,4883.6,3.0],[1749.2,4954.6,3.0],[2106.4,4956.6,3.0],[2718.4,4994.8,3.0],[1871.5,5173.7,3.0],[1875.0,5179.8,4.0],[1876.0,5181.5,10.5],[2830.9,5195.3,3.0],[2836.9,5200.3,3.0],[2834.1,5201.4,3.0],[1889.5,5206.1,3.0],[2837.8,5208.5,3.0],[2667.5,5229.3,3.0],[1916.9,5256.1,10.5],[1920.8,5263.1,3.0],[2864.9,5306.8,3.0],[2943.3,5397.1,3.0],[2941.8,5397.9,3.0],[2029.2,5457.9,3.0],[2032.2,5463.1,4.0],[2036.1,5470.1,3.0],[2991.5,5484.8,3.0],[2990.3,5485.0,3.0],[2950.3,5502.9,3.0],[2911.4,5503.0,3.0],[2679.9,5654.6,3.0],[2142.1,5660.6,3.0],[2673.1,5696.9,3.0],[2750.0,5706.2,3.0],[2722.4,5737.0,3.0],[3115.1,5750.3,3.0],[3115.8,5750.8,3.0],[2991.8,5818.7,3.0],[3012.0,5829.8,3.0],[2265.0,5881.9,3.0],[2897.4,5893.4,3.0],[2887.6,5898.3,4.0],[2877.1,5904.2,4.0],[2870.2,5908.1,3.0],[2342.0,6021.5,3.0],[2343.4,6023.6,3.0],[2661.2,6024.1,3.0],[2649.8,6030.3,4.0],[2637.8,6037.4,4.0],[2628.7,6041.8,3.0],[2504.0,6093.5,3.0],[2408.4,6125.3,3.0],[2426.7,6129.1,6.0]];
const PERIM = /^(Central Park (West|South|North)|5th Avenue|Fifth Avenue|((West|East) )?110th Street|Cathedral Parkway)$/;
const hsh = (a, b = 0, c = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + 0.5) * 43758.5453; return s - Math.floor(s); };
const area2 = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const q = r[(i + 1) % n]; a += r[i][0] * q[1] - q[0] * r[i][1]; } return a; };
export const BENCH_OFF = 0.68, BENCH_PITCH = 2.15, WALL_H = 1.3;     /* uptown (landmarks 9): benches nearly end to end (was 2.8), wall 1.3 m (was 1.1) */
export const WALL_T = 0.45;

export function parkside(game) {
  if (game.__parkside) return game.__parkside;
  /* extras (uptown hand-over, Nov 16): ON by default only on a map that holds one of the uptown lane's sets (city.meta.sets named u<row><column>: u2f .. u7h). The live
     nine-area map also has Central Park's south end (3 polygons, Central Park South / West, 5th Avenue: 24 edges would be dressed), so there the default is OFF.
     ?pkside=1 = on on any map, ?pkside=0 = off everywhere; ?hexwalk= ?pkbench= ?pkwall= (0 or 1) still answer each for itself. */
  const Q = game.P, qv = (k) => (Q && Q.get ? Q.get(k) : null), UP_MAP = !!(game.city && game.city.meta && (game.city.meta.sets || []).some((s) => /^u\d/.test((s && s.set) || '')));
  const DEF = qv('pkside') !== null ? qv('pkside') !== '0' : UP_MAP, on = (k) => (qv(k) !== null ? qv(k) !== '0' : DEF);
  const out = { hex: on('hexwalk'), bench: on('pkbench'), wall: on('pkwall'), wallH: WALL_H, segs: [], strips: [], byExt: new Map(), inStrip: () => false, report: { segs: 0 } };
  game.__parkside = out;
  const city = game.city; if (!city || !city.parks || !city.edges || !(out.hex || out.bench || out.wall)) return out;
  const t0 = performance.now();
  // the perimeter streets as plain segments, in a grid
  const SC = 80, sgrid = new Map();
  for (const e of city.edges) { if (!PERIM.test(e.name || '')) continue; const p = e.pts || [], hw = (e.width || 12) / 2;
    for (let i = 0; i + 1 < p.length; i++) { const s = [p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], hw], L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < 0.5) continue; s.push((s[2] - s[0]) / L, (s[3] - s[1]) / L);
      for (let a = Math.floor((Math.min(s[0], s[2]) - 34) / SC); a <= Math.floor((Math.max(s[0], s[2]) + 34) / SC); a++) for (let b = Math.floor((Math.min(s[1], s[3]) - 34) / SC); b <= Math.floor((Math.max(s[1], s[3]) + 34) / SC); b++) { const k = a * 100003 + b; let l = sgrid.get(k); if (!l) sgrid.set(k, (l = [])); l.push(s); } } }
  if (!sgrid.size) return out;
  let slot = 0, wallM = 0, nBench = 0, nGate = 0;
  for (const pk of city.parks) { if (pk.name !== 'Central Park' || !pk.ext || pk.ext.length < 3) continue;
    const ring = area2(pk.ext) > 0 ? pk.ext : pk.ext.slice().reverse(), mine = new Map(), list = [];      // the same walk as furniture.js's park-edge loop: i means the same edge there
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1.2) continue;
      const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, nx = ty, ny = -tx, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;      // n: out of the park
      const cand = sgrid.get(Math.floor(mx / SC) * 100003 + Math.floor(my / SC)); if (!cand) continue; let best = null;
      for (const s of cand) { const sl = Math.hypot(s[2] - s[0], s[3] - s[1]), u = Math.max(0, Math.min(sl, (mx - s[0]) * s[5] + (my - s[1]) * s[6])), px = s[0] + s[5] * u - mx, py = s[1] + s[6] * u - my, d = Math.hypot(px, py), perp = px * nx + py * ny;
        if (Math.abs(tx * s[5] + ty * s[6]) < 0.85 || perp < s[4] + 1.5 || d > s[4] + 16 || perp < d * 0.9) continue; if (!best || d < best.d) best = { d, sw: perp - s[4] }; }
      if (!best || best.sw < 4) continue;      // under 4 m from the kerb the outline is not a wall behind a sidewalk (the Met's front on 5th Avenue)
      const sg = { i, ax: a[0], ay: a[1], bx: b[0], by: b[1], tx, ty, nx, ny, L, sw: Math.min(14, best.sw), walls: [], benches: [], e0: true, e1: true };
      const prev = list[list.length - 1]; if (prev && Math.hypot(prev.bx - sg.ax, prev.by - sg.ay) < 3) { prev.e1 = false; sg.e0 = false; }
      list.push(sg); mine.set(i, sg); }
    if (list.length > 1) { const f = list[0], l = list[list.length - 1]; if (Math.hypot(l.bx - f.ax, l.by - f.ay) < 3) { l.e1 = false; f.e0 = false; } }
    for (const sg of list) {
      // gates on this edge -> the solid stretches between them
      const gaps = []; for (const g of GATES) { const u = (g[0] - sg.ax) * sg.tx + (g[1] - sg.ay) * sg.ty, v = (g[0] - sg.ax) * sg.nx + (g[1] - sg.ay) * sg.ny, w = Math.max(3, g[2] || 3) / 2 + 0.2; if (Math.abs(v) < 6 && u > -w && u < sg.L + w) gaps.push([u - w, u + w]); }
      gaps.sort((p, q) => p[0] - q[0]); let u = 0, gate0 = false; nGate += gaps.length;
      for (const g of gaps) { if (g[0] - u > 0.6) sg.walls.push([u, g[0], gate0, true]); u = Math.max(u, g[1]); gate0 = true; }
      if (sg.L - u > 0.6) sg.walls.push([u, sg.L, gate0, false]);
      // benches against the wall, facing the street: runs of 8 to 12 with a few metres clear between runs, some stretches bare (a bus stop, a vendor's pitch), none at a gate or at the end of the wall
      for (const w of sg.walls) { const lo = w[0] + (w[2] ? 2.6 : sg.e0 && w[0] < 0.01 ? 7 : 0.2) + BENCH_PITCH / 2, hi = w[1] - (w[3] ? 2.6 : sg.e1 && w[1] > sg.L - 0.01 ? 7 : 0.2) - BENCH_PITCH / 2;
        for (let s = lo; s <= hi; s += BENCH_PITCH) { const j = slot++, blk = Math.floor(j / 14), pos = j % 14, gap = hsh(blk, 7) < 0.5 ? 1 : 0; if (hsh(blk, 3) < 0.04 || pos < gap) continue;     /* uptown (landmarks 9): a near-continuous row (critic r7 'one lonely bench'): one place in 14 clear at most, one stretch in 25 bare */
          sg.benches.push([sg.ax + sg.tx * s + sg.nx * BENCH_OFF, sg.ay + sg.ty * s + sg.ny * BENCH_OFF]); nBench++; }
        wallM += w[1] - w[0]; }
      // the paving strip: from under the wall to just past the kerb, a little longer than the edge (5 m longer where the wall turns in at a drive)
      const x0 = -(sg.e0 ? 5 : 1.5), x1 = sg.L + (sg.e1 ? 5 : 1.5), v0 = -0.5, v1 = sg.sw + 0.7, P = (s, v) => [sg.ax + sg.tx * s + sg.nx * v, sg.ay + sg.ty * s + sg.ny * v];
      out.strips.push([P(x0, v0), P(x1, v0), P(x1, v1), P(x0, v1)]); out.segs.push(sg); }
    if (mine.size) out.byExt.set(pk.ext, mine); }
  // is a map point on the park-side sidewalk? (furniture.js: no shop-front things there)
  const GC = 60, grid = new Map(); for (const sg of out.segs) for (let a = Math.floor((Math.min(sg.ax, sg.bx) - 16) / GC); a <= Math.floor((Math.max(sg.ax, sg.bx) + 16) / GC); a++) for (let b = Math.floor((Math.min(sg.ay, sg.by) - 16) / GC); b <= Math.floor((Math.max(sg.ay, sg.by) + 16) / GC); b++) { const k = a * 100003 + b; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(sg); }
  out.inStrip = (x, y) => { const l = grid.get(Math.floor(x / GC) * 100003 + Math.floor(y / GC)); if (!l) return false; for (const sg of l) { const u = (x - sg.ax) * sg.tx + (y - sg.ay) * sg.ty, v = (x - sg.ax) * sg.nx + (y - sg.ay) * sg.ny; if (u > -2 && u < sg.L + 2 && v > -0.6 && v < sg.sw + 0.3) return true; } return false; };
  // the paving as a picture: 2048 on its long side over the box of all strips (1.3 m a pixel on the uptown test map, about 2 m for the whole park), each strip drawn 0.6 pixel wider
  // into the road and under the wall, read in the shader with a threshold at half: the edge of the paving is right to about half a pixel, and it falls where no sidewalk shows.
  out.mask = () => { if (!out.segs.length) return null; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of out.strips) for (const p of q) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const tex = Math.max(x1 - x0, y1 - y0) / 2000, pad = 12 * tex; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; const W = Math.ceil((x1 - x0) / tex), H = Math.ceil((y1 - y0) / tex), e = 0.6 * tex;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
    for (const sg of out.segs) { const u0 = -(sg.e0 ? 5 : 1.5), u1 = sg.L + (sg.e1 ? 5 : 1.5), v0 = -0.5 - e, v1 = sg.sw + 0.7 + e; g.beginPath();
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].forEach(([u, v], k) => { const x = (sg.ax + sg.tx * u + sg.nx * v - x0) / tex, y = H - (sg.ay + sg.ty * u + sg.ny * v - y0) / tex; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); }
    return { canvas: c, rect: [x0, y0, W * tex, H * tex], m_px: tex }; };
  out.report = { segs: out.segs.length, wall_m: Math.round(wallM), benches: nBench, gates: nGate, ms: Math.round(performance.now() - t0) };
  return out;
}
