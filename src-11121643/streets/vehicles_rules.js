// vehicles_rules.js: the rules of the streets lane's vehicles that need no drawing: which kinds exist and how they drive, the colour
// palette, per-car variation from a seed, where cars park (kerbs lined by rule), what the traffic is made of. No imports, so
// tools/sim.mjs can run the same rules in node (see lanes/streets/pipeline/models/vehsim.sh).

export const hash = (n) => { let h = (n | 0) ^ 0x9e3779b9; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const srand = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r * a.length))];
function weighted(table, r) { let tot = 0; for (const k in table) tot += table[k]; let x = r * tot; for (const k in table) { x -= table[k]; if (x <= 0) return k; } return Object.keys(table)[0]; }

// how each kind drives when the player takes it (the lead's SPEC covers sedan, taxi, suv, van, sport, bus)
export const SPEC = {
  fhatch: { top: 38, acc: 6.0, grip: 8.4 }, fprius: { top: 39, acc: 6.0, grip: 8.3 }, fpickup: { top: 36, acc: 5.2, grip: 7.2 },
  taxivan: { top: 36, acc: 5.4, grip: 7.6 }, crossover: { top: 38, acc: 5.8, grip: 7.9 }, hatch: { top: 38, acc: 6.0, grip: 8.4 }, pickup: { top: 36, acc: 5.2, grip: 7.2 },
  workvan: { top: 32, acc: 4.2, grip: 6.8 }, boxtruck: { top: 26, acc: 3.0, grip: 6.2 }, stepvan: { top: 26, acc: 3.0, grip: 6.2 },
};
export const TAXI_YELLOW = 0xf2b90c;
// Kinds that are free real models, standing only (never in traffic, not for the player to take): sizes measured from the model.
// covered: Poly Haven's 'Covered Car' (CC0), a car under a dust cover.
export const STATIC_KINDS = { covered: { len: 4.38, wid: 1.80, hgt: 1.41, radius: 0.30, ax_f: 1.29, ax_r: -1.29, seat: [0, 0.37, 0.1], fixed: true } };
const C = {
  white: [0xd9d9d5, 0xd2d2ce, 0xdcdad2, 0xcccdca], black: [0x0b0b0d, 0x131416, 0x1a1c20, 0x101114], grey: [0x4a4e54, 0x5b6068, 0x3a3d42, 0x6e7378],
  silver: [0x9aa0a6, 0xaab0b5, 0xb8bcc0, 0x8f9499], blue: [0x13294b, 0x1d3557, 0x1f4e8c, 0x27405e, 0x3d5a80, 0x2f5fa8], red: [0x6b1414, 0x8f1d1d, 0x8a1c1c, 0xa32222],
  earth: [0xb8b2a2, 0x8c8271, 0x3b2a1e, 0x6b5d4a], green: [0x2e3d2f, 0x24382c],
};
const MIX_CAR = { white: 23, black: 19, grey: 12, silver: 17, blue: 12, red: 9, earth: 5, green: 3 };
const MIX_WORK = { white: 68, silver: 10, grey: 7, blue: 7, black: 5, red: 2, green: 1 };   // no brown: that is a parcel company's dress
const MIX_HIRE = { black: 62, grey: 14, silver: 10, white: 8, blue: 6 };
const WORK = { van: 1, workvan: 1, boxtruck: 1, stepvan: 1 };
// kinds that stand in for a hand-built kind (the openx models): what they stand in for decides colour, dirt, lettering and handling
export const KIND = {};
const baseOf = (t) => (KIND[t] ? KIND[t].bases[0] : t);
export function colorFor(type, r1, r2, hire = false) {
  type = baseOf(type);
  if (type === 'taxi' || type === 'taxivan') return TAXI_YELLOW;
  if (type === 'bus') return 0xe4e6e8;
  const mix = WORK[type] ? MIX_WORK : (hire || type === 'suv') ? MIX_HIRE : MIX_CAR;
  return pick(C[weighted(mix, r1)], r2);
}
const lum = (c) => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
const INK_DARK = [0x12305e, 0x8a1515, 0x141414, 0x1f5a36, 0x2a2a2a, 0x0f3d5c, 0x5a1a4a], INK_LIGHT = [0xf0f0ea, 0xf2c230, 0xe8e8e8, 0xffffff];
export const N_LIVERY = 16;
// everything about one car that comes from its seed: dirt, lettering, rack, ride height, age of the paint
export function variant(type, seed, color) {
  const r = srand(Math.floor(hash(seed) * 4e9) + 17);
  const type0 = type; type = baseOf(type);
  const work = !!WORK[type];
  const v = { type: type0, color, seed01: r(), dirt: Math.min(1, 0.26 + 0.7 * Math.pow(r(), 1.2) + (work ? 0.13 : 0)), ride: (r() - 0.5) * 0.03, rack: false, livery: -1, ink: 0 };
  const a = r(), b = r(), c = r();
  if (type === 'workvan') v.rack = a < 0.7; else if (type === 'suv' || type === 'crossover') v.rack = a < 0.07; else if (type === 'taxi' || type === 'taxivan') v.rack = a < 0.4;   // cabs: the roof ad
  const p = { van: 0.5, workvan: 0.75, boxtruck: 0.8, stepvan: 0.85 }[type] || 0;
  if (b < p) { v.livery = Math.floor(c * N_LIVERY) % N_LIVERY; v.ink = pick(lum(color) > 0.4 ? INK_DARK : INK_LIGHT, r()); }
  if (KIND[type0]) { v.rack = KIND[type0].bases.includes('taxi') && color === TAXI_YELLOW; if (color === TAXI_YELLOW) v.dirt *= 0.7; }
  if (type === 'taxi' || type === 'taxivan') v.dirt *= 0.7;
  return v;
}

// ---------------------------------------------------------------------------------------------------------------- definitions
// meta: vehicles.json from the build (per kind: len wid hgt radius ax_f ax_r ywl seat ...). The lead's definitions are changed in
// place, so everything that already holds one (parked slots, the mission car) follows; new kinds are added beside them.
export function applyDefs(game, meta) {
  const cars = game.kit.cars; meta = Object.assign({}, meta, STATIC_KINDS, game._vehReal || {});
  for (const t in meta) {
    const m = meta[t]; const d = cars[t] || (cars[t] = { type: t, body: [], wheels: [] });
    Object.assign(d, { type: t, len: m.len, wid: m.wid, hgt: m.hgt, radius: m.radius, wheelbase: +(m.ax_f - m.ax_r).toFixed(3), fixed: !!m.fixed });
  }
  const seats = (game.kit.seats = Object.assign({}, game.kit.seats || {}));
  for (const t in meta) if (!seats[t] && SPEC[t]) seats[t] = meta[t].seat;
  // a car the player takes keeps its look, and a new kind gets its own handling
  if (!game._vehEnter) {
    // a standing-only model is not a car to take: the nearest takeable one is offered instead
    const nearest0 = game.nearestCar.bind(game);
    game.nearestCar = function (maxD) { const hid = []; let b = nearest0(maxD); while (b && b.kind === 'slot' && b.s.def && b.s.def.fixed) { b.s.gone = true; hid.push(b.s); b = nearest0(maxD); } for (const s of hid) s.gone = false; return b; };
    game._vehEnter = true; const enter = game.tryEnter.bind(game);
    game.tryEnter = function () {
      const n = this.nearestCar(), len = this.vehicles.length, r = enter();
      if (r && n && this.vehicles.length > len) { const v = this.vehicles[len]; v.vseed = n.kind === 'slot' ? n.s.vseed : n.kind === 'traffic' ? n.c.id : 1; if (SPEC[v.type]) v.spec = SPEC[v.type]; }
      return r;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------- parking
// Shared streets (ground/shared_streets.json: [{pts: [[x, y], ...]}], OSM living_street: one slow lane through people space): is the
// road at (x, y), running along (tx, ty), following one of them (within `d` metres and roughly parallel)?
export function sharedTest(ways, d = 6) {
  const W = (ways || []).filter((w) => w && w.pts && w.pts.length > 1).map((w) => { const b = w.pts.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [1e9, 1e9, -1e9, -1e9]); return { pts: w.pts, b }; });
  return (x, y, tx, ty) => {
    for (const w of W) { const b = w.b; if (x < b[0] - d || x > b[2] + d || y < b[1] - d || y > b[3] + d) continue;
      for (let i = 0; i + 1 < w.pts.length; i++) { const ax = w.pts[i][0], ay = w.pts[i][1], ex = w.pts[i + 1][0] - ax, ey = w.pts[i + 1][1] - ay, L = Math.hypot(ex, ey) || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (L * L))); if (Math.hypot(x - ax - ex * u, y - ay - ey * u) < d && Math.abs((ex * tx + ey * ty) / L) > 0.8) return true; } }
    return false;
  };
}
// Pedestrian plazas (ground/plazas.json: [{poly: [[x, y], ...]}]): nothing parks or stands inside one or within `d` metres of it.
export function plazaTest(plazas) {
  const P = (plazas || []).filter((p) => p && p.poly && p.poly.length > 2).map((p) => { const b = p.poly.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [1e9, 1e9, -1e9, -1e9]); return { poly: p.poly, b }; });
  return (x, y, d) => {
    for (const p of P) { const b = p.b; if (x < b[0] - d || x > b[2] + d || y < b[1] - d || y > b[3] + d) continue; const q = p.poly; let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const ax = q[i][0], ay = q[i][1], bx = q[j][0], by = q[j][1];
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        const ex = bx - ax, ey = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1))); if (Math.hypot(x - ax - ex * u, y - ay - ey * u) < d) return true; }
      if (inside) return true; }
    return false;
  };
}
const PARK_STREET = { covered: 2.2, sedan: 22, suv: 19, crossover: 18, hatch: 8, pickup: 4, van: 6, workvan: 8, taxi: 2, taxivan: 1, sport: 1.5, boxtruck: 2, stepvan: 1.2 };
const PARK_AVE = { covered: 0.5, sedan: 16, suv: 20, crossover: 14, hatch: 5, pickup: 3, van: 9, workvan: 10, taxi: 5, taxivan: 3, sport: 1, boxtruck: 4, stepvan: 3.5 };
// Kerbs lined nearly bumper to bumper. Per edge and side: start clear of the corner and the crosswalk, then car after car with
// 0.45-1.3 m between bumpers; a space is left free now and then (more often on avenues), a longer gap stands for a driveway or a
// loading zone, nobody parks within 4.6 m of a hydrant, and nothing stands in a travel lane or outside the map.
export const LANE_SWEEP = 0.45;      // a lane is lw wide and a car 1.9: the band's outer 0.45 m is not swept by a car that keeps to the middle of its lane
export const ONE_LANE_RUN = 4, ONE_LANE_GAP = 8.0, ONE_LANE_CLEAR = 6.6;      // cars between pockets, pocket length (m), least clear width from the parked row to the far kerb (m; checked by lanes/streets/items/cars/rows/check.js)
const nameHash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return hash(h); };
export function buildSlots(game, opts = {}) {
  const R = game.roads, cars = game.kit.cars, P = game.parked, st = game.statics, b = game.bounds;
  const keep = P.slots.filter((s) => s.mission && !s.gone);
  for (const s of P.slots) if (!s.mission) { s.gone = true; for (const c of s.circles) c.on = false; }
  const hyd = (game.city.props.hydrant || []).map((p) => [p[0], p[1]]);
  const hgrid = new Map(); for (const h of hyd) { const k = Math.floor(h[0] / 40) + ',' + Math.floor(h[1] / 40); if (!hgrid.has(k)) hgrid.set(k, []); hgrid.get(k).push(h); }
  const nearHyd = (x, y, d) => { const i = Math.floor(x / 40), j = Math.floor(y / 40); for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) { const l = hgrid.get(a + ',' + c); if (l) for (const h of l) if ((h[0] - x) ** 2 + (h[1] - y) ** 2 < d * d) return true; } return false; };
  const inPlaza = plazaTest(opts.plazas), onShared = sharedTest(opts.shared); let plaza = 0, shared = 0, atTree = 0, onCross = 0;
  // tree trunks (0.5 m clear of every one) and crosswalk bars (nothing stands on a crosswalk), in 20 m cells
  const cell = (m, x, y, v) => { const k = Math.floor(x / 20) + ',' + Math.floor(y / 20); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(v); };
  const around = (m, x, y, fn) => { const i = Math.floor(x / 20), j = Math.floor(y / 20); for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) { const l = m.get(a + ',' + c); if (l) for (const v of l) if (fn(v)) return true; } return false; };
  const tgrid = new Map(), xgrid = new Map();
  for (const p of opts.trees || game.city.props.tree || []) cell(tgrid, p[0], p[1], p);
  for (const m of game.city.marks || []) { const q = m.q; if (!q || q.length !== 4) continue; const a = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), b = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
    if (Math.min(a, b) > 0.5 && Math.max(a, b) < 4.5) cell(xgrid, (q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]); }
  const blocked = (x, y, fx, fy, def) => {
    const hl = def.len / 2, hw = def.wid / 2;
    if (around(tgrid, x, y, (p) => { const dx = p[0] - x, dy = p[1] - y; return Math.abs(dx * fx + dy * fy) < hl + 0.75 && Math.abs(-dx * fy + dy * fx) < hw + 0.75; })) return 1;
    if (around(xgrid, x, y, (p) => { const dx = p[0] - x, dy = p[1] - y; return Math.abs(dx * fx + dy * fy) < hl + 1.0 && Math.abs(-dx * fy + dy * fx) < hw + 1.6; })) return 2;
    return 0; };
  const slots = keep.slice(), t = {}; let n = 0, skippedLane = 0, offKerb = 0, overlapSkip = 0; const boxGrid = new Map();
  const boxCut = (A, B) => { for (const P of [A, B]) for (let i = 0; i < 4; i++) { const nx = P[(i + 1) % 4][1] - P[i][1], ny = -(P[(i + 1) % 4][0] - P[i][0]); let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const q of A) { const v = q[0] * nx + q[1] * ny; if (v < a0) a0 = v; if (v > a1) a1 = v; } for (const q of B) { const v = q[0] * nx + q[1] * ny; if (v < b0) b0 = v; if (v > b1) b1 = v; } if (a1 <= b0 || b1 <= a0) return false; } return true; };
  for (const k of keep) { const d = k.def || cars[k.type]; if (!d) continue; const ch = Math.cos(k.h), sh_ = Math.sin(k.h), bx = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [k.x + ch * d.len / 2 * a - sh_ * d.wid / 2 * c, k.y + sh_ * d.len / 2 * a + ch * d.wid / 2 * c]), gk = Math.floor(k.x / 20) + ',' + Math.floor(k.y / 20); if (!boxGrid.has(gk)) boxGrid.set(gk, []); boxGrid.get(gk).push(bx); }
  R.edges.forEach((e, ei) => {
    if (e.s0 === undefined || e.len < 30) return;
    const table = e.ave ? PARK_AVE : PARK_STREET, occ = opts.occupancy ?? (e.ave ? 0.80 : 0.93);
    /* ONE-LANE STREETS LEAVE ROOM (Nov 12, public report 20261112132507-7e132b: a car turned across W 21st St could not get out between two parked rows 4.5-5.1 m
       apart): a street with one traffic lane has ONE parked row, on the side its name picks (the same side all along the street), so a car has at least ONE_LANE_CLEAR
       metres from the row to the far kerb to turn round in; after every ONE_LANE_RUN cars the row has a gap of ONE_LANE_GAP metres (a pocket to pull into, the whole
       road width free there); a one-lane street narrower than 9 m has no parked row at all. opts.oneLaneBoth = the rows as they were. */
    const oneLane = e.lanes === 1 && !opts.oneLaneBoth, keepSide = oneLane ? (nameHash(e.name || String(ei)) < 0.5 ? -1 : 1) : 0;
    if (oneLane && e.width < 9) return;
    for (const side of [-1, 1]) {
      if (oneLane && side !== keepSide) continue;
      // Plazas are fronted by delineators and planters, not parked cars: wherever a plaza lies within `plazaReach` (12 m) of this
      // edge's centre line on this side, that stretch plus 15 m either way is a no-standing zone on that side.
      let ns = null;
      if (opts.plazas && opts.plazas.length) { const reach = opts.plazaReach ?? 12, pad = opts.plazaPad ?? 15, n2 = Math.ceil(e.len / 2) + 1, hit = new Uint8Array(n2); let any = false;
        for (let q = 0; q < n2; q++) { e.line.at(Math.min(e.len, q * 2), t); for (let d = 0; d <= reach + 0.01; d += 1.5) if (inPlaza(t.x + t.ty * side * d, t.y - t.tx * side * d, 0.8)) { hit[q] = 1; any = true; break; } }
        if (any) { ns = new Uint8Array(n2); const w = Math.ceil(pad / 2); for (let q = 0; q < n2; q++) if (hit[q]) for (let k = Math.max(0, q - w); k <= Math.min(n2 - 1, q + w); k++) ns[k] = 1; } }
      // a stretch that follows a shared street has no kerb parking on either side
      let sh = null;
      if (opts.shared && opts.shared.length) { const n2 = Math.ceil(e.len / 2) + 1; for (let q = 0; q < n2; q++) { e.line.at(Math.min(e.len, q * 2), t); if (onShared(t.x, t.y, t.tx, t.ty)) { (sh ||= new Uint8Array(n2))[q] = 1; } } }
      const r = srand(ei * 2 + (side > 0 ? 1 : 0) + 7919);
      let s = e.s0 + 3 + r() * 2.5, prevColor, prev2; const end = e.s1 - 3 - r() * 2;
      // most kerb rows have a tall dark van or step van standing in them: the trades at work
      let tallAt = r() < 0.65 ? 1 + Math.floor(r() * 4) : -1, placed = 0, run = 0;
      while (s < end) {
        if (oneLane && run >= ONE_LANE_RUN) { s += ONE_LANE_GAP; run = 0; continue; }      // the pocket
        if (r() < 0.035) { s += 8 + r() * 7; run = 0; continue; }                       // driveway, loading zone, bus stop
        const tall = placed === tallAt, type0 = tall ? (r() < 0.7 ? 'van' : 'stepvan') : weighted(table, r()), type = game._vehOx ? realCast(game, type0, ei * 64 + placed, true) : type0, def = cars[type];     // an openx model is placed by its own length if (!def) { s += 1; continue; }
        if (s + def.len > end) { if (def.len > 5) { s += 0.5; continue; } break; }
        if (r() > occ) { s += 5.2 + r(); if (!oneLane) run = 0; continue; }                           // a free space
        const sc = s + def.len / 2; e.line.at(sc, t);
        const off = e.width / 2 - (def.wid > 2.2 ? 0.25 : 0.35) - def.wid / 2;
        const x = t.x + t.ty * off * side, y = t.y - t.tx * off * side;
        const fx = t.tx, fy = t.ty;
        if (Math.abs(x) > b.x - 2 || Math.abs(y) > b.y - 2) { s += 6; continue; }
        if (nearHyd(x + t.ty * side * 1.2, y - t.tx * side * 1.2, def.len / 2 + 2.3)) { s += 1.5; continue; }
        if (R.inLane(x, y, Math.max(0.75, def.wid / 2 - 0.45)) || R.inLane(x + fx * def.len * 0.4, y + fy * def.len * 0.4, 0.7) || R.inLane(x - fx * def.len * 0.4, y - fy * def.len * 0.4, 0.7)) { skippedLane++; s += 5; continue; }
        // the mission car keeps the kerb ahead of it free (the demo's autopilot pulls straight out and does not see parked cars)
        if (keep.some((k) => { const kx = Math.cos(k.h), ky = Math.sin(k.h), al = (x - k.x) * kx + (y - k.y) * ky, lat = Math.abs(-(x - k.x) * ky + (y - k.y) * kx); return lat < 3 && al > -((k.def.len + def.len) / 2 + 0.8) && al < 17 + def.len / 2; })) { s += 2; continue; }
        // the kerb must be where the road data says: sidewalk just beyond the car's kerb side, roadway under its four corners
        // (at forks, bends and plazas it is not, and a car would stand nose-in on the pavement)
        { const kx = t.ty * side, ky = -t.tx * side, hl = def.len / 2 - 0.2, hw = def.wid / 2 + 0.05; let bad = false;     // the body never overhangs the kerb
          for (const a of [-hl, 0, hl]) if (!st.onSidewalk(x + fx * a + kx * (def.wid / 2 + 0.9), y + fy * a + ky * (def.wid / 2 + 0.9))) bad = true;
          for (const a of [-hl, hl]) for (const c of [-hw, hw]) if (st.onSidewalk(x + fx * a + kx * c, y + fy * a + ky * c)) bad = true;
          if (bad) { offKerb++; s += 2; continue; }
          for (const a of [-def.len / 2, 0, def.len / 2]) for (const c of [-def.wid / 2, def.wid / 2]) if (inPlaza(x + fx * a + kx * c, y + fy * a + ky * c, 1.0)) bad = true;
          // nor along a kerb that borders a plaza: that lane is roadway beside planters and tables, not parking
          for (const a of [-def.len / 2, 0, def.len / 2]) for (const d of [2.5, 5, 8]) if (inPlaza(x + fx * a + kx * (def.wid / 2 + d), y + fy * a + ky * (def.wid / 2 + d), 1.0)) bad = true;
          // nor in the no-standing zone a plaza throws along the road it fronts (noStand, below)
          if (!bad && ns) for (let q = Math.floor(s / 2); q <= Math.ceil((s + def.len) / 2); q++) if (ns[q]) bad = true;
          if (bad) { plaza++; s += 2; continue; }
          if (sh) for (let q = Math.floor(s / 2); q <= Math.ceil((s + def.len) / 2); q++) if (sh[q]) bad = true;
          if (bad) { shared++; s += 2; continue; } }
        { const bl = blocked(x, y, fx, fy, def); if (bl) { if (bl === 1) atTree++; else onCross++; s += 1.2; continue; } }
        const h = Math.atan2(fy, fx) + (side === 1 || e.oneway ? 0 : Math.PI), seed = Math.floor(r() * 1e9);
        // neighbours differ: not the same colour as the car behind, unless it is a cab
        // neighbours differ: in any three cars in a row no two of one colour family (cabs excepted)
        let color = colorFor(type0, r(), r()); const fam = (c) => { for (const k in C) if (C[k].includes(c)) return k; return 'x'; };
        for (let k = 0; k < 6 && type0 !== 'taxi' && type0 !== 'taxivan' && (fam(color) === fam(prevColor) || fam(color) === fam(prev2)); k++) color = colorFor(type0, r(), r(), k > 2);
        if (tall) color = pick([0x131416, 0x13294b, 0x1d3557, 0x3a3d42, 0x1a1c20, 0x24382c], r());
        prev2 = prevColor; prevColor = color; placed++;
        // the real model of the kind, when switched on, stands in the place worked out for the hand-built one (it is never longer)
        const rt = game._vehOx ? type : realCast(game, type, ei * 64 + placed), rdef = cars[rt] || def;
        // people park by eye: up to a hand's width or two further out from the kerb, and a degree or so off straight (from the seed,
        // so the draw order above is untouched)
        const jo = 0.04 + 0.26 * Math.pow(hash(seed + 11), 1.5), ja = (hash(seed + 23) - 0.5) * 0.035, sx = -t.ty * side, sy = t.tx * side;
        const sl = { x: x + sx * jo, y: y + sy * jo, h: h + ja, type: rt, def: rdef, color, gone: false, circles: [], vseed: seed };
        /* NO PARKED CAR IN ANOTHER, NONE IN A LANE'S PATH (Nov 12): the body as it finally stands (its own kind's size, the by-eye offset and angle) is tested before it is
           kept: its box may not cut the box of any car already placed (two rows met at a fork), and its road side may not reach into the path a car driving down the
           middle of a lane sweeps (within LANE_SWEEP of the lane band's edge: wide vans on the narrow two-lane avenues did) */
        { const ch = Math.cos(sl.h), sh_ = Math.sin(sl.h), hl2 = rdef.len / 2, hw2 = rdef.wid / 2, kx2 = t.ty * side, ky2 = -t.tx * side, bx = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [sl.x + ch * hl2 * a - sh_ * hw2 * c, sl.y + sh_ * hl2 * a + ch * hw2 * c]); let bad = false;
          for (const a of [-1, -0.5, 0, 0.5, 1]) if (R.inLane(sl.x + ch * hl2 * a - kx2 * hw2, sl.y + sh_ * hl2 * a - ky2 * hw2, -LANE_SWEEP)) { bad = true; break; }
          if (bad) { skippedLane++; s += 2; continue; }
          const gi = Math.floor(sl.x / 20), gj = Math.floor(sl.y / 20);
          for (let a = gi - 1; a <= gi + 1 && !bad; a++) for (let c = gj - 1; c <= gj + 1 && !bad; c++) for (const o of boxGrid.get(a + ',' + c) || []) if (boxCut(bx, o)) { bad = true; break; }
          if (bad) { overlapSkip++; s += 1.5; continue; }
          const gk = gi + ',' + gj; if (!boxGrid.has(gk)) boxGrid.set(gk, []); boxGrid.get(gk).push(bx); }
        const cx = Math.cos(h), cy = Math.sin(h), rad = rdef.wid * 0.5;
        const offs = def.len > 6.2 ? [-(def.len / 2 - rad), 0, def.len / 2 - rad] : [-def.len * 0.27, def.len * 0.27];
        for (const o of offs) sl.circles.push(st.addCircle(sl.x + cx * o, sl.y + cy * o, rad, sl));
        slots.push(sl); n++; run++;
        s += def.len + (game._vehOx ? 0.5 + r() * 0.4 : 0.45 + r() * r() * 0.85);
      }
    }
  });
  P.slots = slots; P.grid = new Map();
  for (const s of slots) { if (s.vseed === undefined) s.vseed = Math.floor(hash(Math.round(s.x * 31 + s.y * 17)) * 1e9); const k = Math.floor(s.x / 80) + ',' + Math.floor(s.y / 80); if (!P.grid.has(k)) P.grid.set(k, []); P.grid.get(k).push(s); }
  return { slots: n, skippedLane, offKerb, plaza, shared, atTree, onCross, overlapSkip };
}

// ---------------------------------------------------------------------------------------------------------------- traffic
const MOVE_AVE = { taxi: 30, taxivan: 12, suv: 15, sedan: 14, crossover: 8, van: 5, workvan: 5, hatch: 3, pickup: 2, boxtruck: 3, stepvan: 2 };
const MOVE_STREET = { taxi: 18, taxivan: 6, suv: 15, sedan: 18, crossover: 12, hatch: 6, van: 6, workvan: 7, pickup: 4, boxtruck: 4, stepvan: 3 };
// The free real models (opts.realOn, off by default: ?vreal=1): the same draw from the same tables, then every hatch and pickup and
// two sedans in three are cast as the real model of that kind, so a frame with and without differs only in those cars.
const realCast = (game, type, k, parked = false) => {
  if (game._vehOx) { const cars = game.kit.cars, base = type === 'taxivan' && parked ? 'taxi' : type, c = Object.keys(KIND).filter((t) => KIND[t].bases.includes(base) && cars[t]);   /* no real minivan cab: a real sedan cab stands in */ return c.length ? c[Math.floor(hash(k * 13 + 1) * c.length) % c.length] : type; }
  const R = game._vehReal, on = game._vehRealOn; if (!on || !R) return type; if (type === 'hatch' && R.fhatch) return 'fhatch'; if (type === 'pickup' && R.fpickup) return 'fpickup'; if (type === 'sedan' && R.fprius && hash(k * 7 + 3) < 0.67) return 'fprius'; return type; };
// What drives: cabs first on the avenues, then black hire cars, then everyone else; more of it. The lead's Traffic keeps doing the
// driving; only what it picks and how many it keeps are changed here.
// Hero blocks, by hand (plaza item, Nov 10): the map carries Broadway between 22nd and 23rd St as a two-lane block, but its centre line
// runs through what the photographs (and ground/plazas.json) show as the Flatiron plaza: tables, planters, the kiosk. Nothing drives
// or stands there: a lane that runs inside a plaza named here (the plazas.json polygons holding one of these points) takes no
// traffic; a block with no lane left is not entered, cars take another exit.
export const CLOSED_AT = [[-206.6, -398.5]];
export function closedLanes(game, plazas, at = CLOSED_AT, d = 1.0) {
  const R = game.roads, out = new Map(), t = {};
  const polys = (plazas || []).filter((p) => p && p.poly && at.some((q) => plazaTest([p])(q[0], q[1], 0))); if (!polys.length) return out;
  const test = plazaTest(polys);
  for (const e of R.edges) { if (e.s0 === undefined) continue; e.line.at(e.len / 2, t); if (!test(t.x, t.y, 30)) continue;
    for (const dir of e.oneway ? [1] : [1, -1]) { const nl = R.laneCount(e, dir); for (let li = 0; li < nl; li++) { let n = 0, k = 0; for (let s = 4; s < e.len - 4; s += 2) { R.lanePos(e, dir, li, s, t); n++; if (test(t.x, t.y, d)) k++; }
      if (n && k / n > 0.4) { if (!out.has(e)) out.set(e, new Set()); out.get(e).add(dir + ':' + li); } } } }
  return out;
}
export function applyTraffic(game, opts = {}) {
  const T = game.traffic, cars = game.kit.cars, R = game.roads;
  T.target = opts.target ?? 130;
  const closed = opts.closed === false ? new Map() : closedLanes(game, opts.plazas);
  if (closed.size) {
    const shut = (e, dir, li) => { const c = closed.get(e); return !!c && c.has(dir + ':' + li); };
    const open = (e, dir, li) => { const n = R.laneCount(e, dir); let best = -1; for (let l = 0; l < n; l++) if (!shut(e, dir, l) && (best < 0 || Math.abs(l - li) < Math.abs(best - li))) best = l; return best; };
    const spawnA = T.spawn.bind(T), next0 = T.chooseNext.bind(T), free0 = T.laneFree.bind(T);
    T.spawn = function (e, dir, li, s) { if (shut(e, dir, li)) { li = open(e, dir, li); if (li < 0) return null; } return spawnA(e, dir, li, s); };
    // a car coming up to such a block takes its open lane; where a block has none, another exit (the draw is repeated)
    T.chooseNext = function (c) { let nx = next0(c); for (let k = 0; k < 6 && nx && closed.has(nx.e); k++) { if (!shut(nx.e, nx.dir, nx.li)) break; const l = open(nx.e, nx.dir, nx.li); if (l >= 0) { nx.li = l; break; } nx = next0(c); }
      if (nx && shut(nx.e, nx.dir, nx.li)) {      // the draw keeps going straight on (a middle lane hardly ever turns): take any exit that is open
        const ex = R.exits(R.endNode(c.e, c.dir), c.e).filter((x) => open(x.e, x.dir, 0) >= 0); if (ex.length) { const x = ex[Math.floor(this.rand() * ex.length) % ex.length]; nx = { e: x.e, dir: x.dir, li: open(x.e, x.dir, Math.min(R.laneCount(x.e, x.dir) - 1, c.li)) }; } }
      return nx; };
    T.laneFree = function (c, l2) { return !shut(c.e, c.dir, l2) && free0(c, l2); };
    for (const c of T.cars) if (shut(c.e, c.dir, c.li)) { const l = open(c.e, c.dir, c.li); if (l >= 0) { c.li = l; R.lanePos(c.e, c.dir, c.li, c.s, c); } else c._shut = true; }
    T.cars = T.cars.filter((c) => !c._shut);
  }
  const spawn0 = T.spawn.bind(T);
  T.pickType = function () {
    const r = this.rand(), e = this._e; if (r < 0.03 && cars.bus && e && e.ave) return 'bus';
    const h = weighted(e && e.ave ? MOVE_AVE : MOVE_STREET, this.rand()), t = realCast(game, h, this.cars.length); this._hand = h; this._cast = t; return cars[t] ? t : 'sedan';
  };
  T.colorFor = function (type) { const a = this.rand(), b = this.rand(), ht = this._cast === type && this._hand ? this._hand : baseOf(type); return colorFor(ht, a, b, ht === 'sedan' && this.rand() < 0.45); };
  T.spawn = function (e, dir, li, s) { this._e = e; return spawn0(e, dir, li, s); };
  // the cars already on the road are re-cast with the new mix (same places, same lanes)
  for (const c of T.cars) { if (c.type === 'bus') continue; T._e = c.e; const type = T.pickType(); if (type === 'bus') continue; c.type = type; c.def = cars[type]; c.color = T.colorFor(type); }
  if (opts.populate !== false) { const p = game.player; T.populate(p.x, p.y); }
  return { target: T.target, cars: T.cars.length, closed: closed.size };
}

// A delivery vehicle double-parked now and then on the wide one-way avenues: a van or truck standing in the kerb-side travel lane with
// its flashers on. It is a traffic car that never moves (the lead's followers already change lane round a stalled car).
export function applyDoubleParked(game, opts = {}) {
  const T = game.traffic, R = game.roads, cars = game.kit.cars, every = opts.every ?? 3;
  const spots = [], inPlaza = plazaTest(opts.plazas), onShared = sharedTest(opts.shared), q = {}; let bars = null;
  R.edges.forEach((e, ei) => {
    if (e.s0 === undefined || !e.ave || !e.oneway || e.lanes < 3 || e.len < 70 || hash(ei * 13 + 5) > 1 / every) return;
    if (!bars) { bars = []; for (const m of game.city.marks || []) { const k = m.q; if (!k || k.length !== 4) continue; const a = Math.hypot(k[1][0] - k[0][0], k[1][1] - k[0][1]), b = Math.hypot(k[2][0] - k[1][0], k[2][1] - k[1][1]); if (Math.min(a, b) > 0.5 && Math.max(a, b) < 4.5) bars.push((k[0][0] + k[2][0]) / 2, (k[0][1] + k[2][1]) / 2); } }
    const r = srand(ei + 4242), right = r() < 0.6, li0 = right ? e.lanes - 1 : 0, s0 = e.len * (0.28 + 0.14 * srand(ei + 99)());
    { let bad = false; for (const a of [-5, 0, 5]) { R.lanePos(e, 1, li0, s0 + a, q); for (const c of [-2, 0, 2]) if (inPlaza(q.x + Math.sin(q.h) * c, q.y - Math.cos(q.h) * c, 1.0)) bad = true; e.line.at(Math.max(0, Math.min(e.len, s0 + a)), q); if (onShared(q.x, q.y, q.tx, q.ty)) bad = true; } R.lanePos(e, 1, li0, s0, q); for (let i = 0; i < bars.length; i += 2) if (Math.hypot(bars[i] - q.x, bars[i + 1] - q.y) < 7) bad = true;     // never on a crosswalk
      if (bad) return; }
    spots.push({ e, li: li0, s: s0, type: weighted({ van: 3, workvan: 3, boxtruck: 3, stepvan: 3 }, r()), seed: Math.floor(r() * 1e9), car: null, nudge: (right ? 1 : -1) * 0.75 });
  });
  const step0 = T.step.bind(T), spawn0 = T.spawn.bind(T), t = {};
  T.step = function (dt, tt) {
    const g = this.g, px = g.focus.x, py = g.focus.y;
    this._dpT = (this._dpT || 0) - dt;
    if (this._dpT <= 0) { this._dpT = 1;
      for (const sp of spots) {
        if (sp.car && this.cars.indexOf(sp.car) < 0) sp.car = null;
        if (sp.cool > 0) { sp.cool -= 1; continue; }
        if (sp.car) continue;
        R.lanePos(sp.e, 1, sp.li, sp.s, t); const d = Math.hypot(t.x - px, t.y - py); if (d > 380 || (d < 150 && !opts.anywhere)) continue;
        if (this.cars.some((c) => Math.hypot(c.x - t.x, c.y - t.y) < 16)) continue;
        const c = spawn0(sp.e, 1, sp.li, sp.s); if (!c) continue;
        c.type = sp.type; c.def = cars[sp.type]; c.color = colorFor(sp.type, hash(sp.seed), hash(sp.seed + 1)); c.id = sp.seed; c.v = 0; c.v0 = 0; c.stun = 1e9; c.dbl = true; c.held = 99;
        sp.car = c;
      }
    }
    // the demo's autopilot waits for ever behind a standing car: when it comes up the same block, the delivery is done and the van
    // drives off well before it arrives, 130 m out (a player at the wheel has to go round, like everyone else)
    const pv = g.demo && g.player.vehicle;
    if (pv) for (const sp of spots) { const c = sp.car; if (!c || Math.hypot(c.x - pv.x, c.y - pv.y) > 130) continue;
      c.stun = 0; c.dbl = false; c.held = 0; c.v0 = 10; c.lo = c.lo0 = sp.nudge; sp.car = null; sp.cool = 150; }
    step0(dt, tt);
    for (const sp of spots) { const c = sp.car; if (!c) continue; c.v = 0; c.stun = 1e9; c.brake = false; c.held = 99; c.wait = 0; c.steer = 0; c.x += Math.sin(c.h) * sp.nudge; c.y -= Math.cos(c.h) * sp.nudge; }   // tucked toward the parked row
  };
  return { spots: spots.length };
}

export function applyAll(game, meta, opts = {}) {
  if (opts.real) game._vehReal = opts.real; game._vehRealOn = !!opts.realOn;
  for (const k in KIND) delete KIND[k]; game._vehOx = false;
  if (opts.openx) { meta = Object.assign({}, meta, opts.openx); game._vehOx = true; for (const t in opts.openx) { const m = opts.openx[t]; KIND[t] = { bases: t === 'ox_sedan98' && !opts.oldSedan ? [] : m.base };      /* the generic 1998 sedan reads as an old low-detail model up close: kept in the kit, not cast */ SPEC[t] = m.cls === 'van' ? SPEC.workvan : m.cls === 'suv' ? SPEC.crossover : { top: 40, acc: 6.2, grip: 8.5 }; } }
  applyDefs(game, meta);
  const out = { park: buildSlots(game, opts), traffic: applyTraffic(game, opts) };
  if (opts.double) out.double = applyDoubleParked(game, opts);
  return out;
}
