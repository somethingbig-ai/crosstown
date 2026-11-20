// interiors/plan.js (lanes/shops/interiors): where a walk-in shop's room goes and what stands in it. Pure data (no three.js), so tools can run it in node.
// The bay frame: u along the wall (the storefront's local x, metres from the bay's centre), z out of the wall (the room is at z < 0), y up from the
// shop floor (= the storefront frame's y 0, the sidewalk, 0.15 m above the map's zero). Sim point = (d.x, d.y) + u (d.dx, d.dy) + z (d.nx, d.ny).

export const toSim = (d, u, z) => [d.x + u * d.dx + z * d.nx, d.y + u * d.dy + z * d.ny];
export const toLocal = (d, x, y) => [(x - d.x) * d.dx + (y - d.y) * d.dy, (x - d.x) * d.nx + (y - d.y) * d.ny];
export const simHeading = (d, du, dz) => Math.atan2(du * d.dy + dz * d.ny, du * d.dx + dz * d.nx);

function pip(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function segHit(ax, ay, bx, by, cx, cy, ex, ey) {     // do segments ab and ce cross?
  const d1 = (ex - cx) * (ay - cy) - (ey - cy) * (ax - cx), d2 = (ex - cx) * (by - cy) - (ey - cy) * (bx - cx), d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (ey - ay) - (by - ay) * (ex - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
// the size each kind wants (m): width along the street, depth into the building
export const WANT = { deli: [7.5, 10], pizza: [7.5, 11], hotel: [9, 11], pharmacy: [10, 14] };

// The biggest room (on a 0.25 m grid) that lies wholly inside the building's footprint, crosses no other wall (another building, a part, a courtyard,
// a hand-built hero building) and stands behind the whole glazed front (x0..x1), so the open front never shows the inside of the building.
export function fitRoom(d, C, extra = []) {
  const b = C.buildings[d.bi], [Wt, Dt] = WANT[d.kind] || [8, 10];
  // everything in the bay frame, and only what can touch the biggest room asked for
  const U0 = d.x0 - Wt - 1, U1 = d.x1 + Wt + 1, Z0 = -Dt - 1.5, Z1 = 1, L = (p) => toLocal(d, p[0], p[1]);
  const segs = [], ring = (P) => { const Q = P.map(L); for (let i = 0; i < Q.length; i++) { const a = Q[i], c = Q[(i + 1) % Q.length]; if (Math.max(a[0], c[0]) < U0 || Math.min(a[0], c[0]) > U1 || Math.max(a[1], c[1]) < Z0 || Math.min(a[1], c[1]) > Z1) continue; segs.push([a[0], a[1], c[0], c[1]]); } };
  const boxOf = (P) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
  const R0 = Wt + Dt + 4, near = (P) => { const q = boxOf(P); return q[0] < d.x + R0 && q[2] > d.x - R0 && q[1] < d.y + R0 && q[3] > d.y - R0; };
  for (const o of C.buildings) { if (o.minh > 4.5 || !near(o.poly)) continue; ring(o.poly); for (const h of o.holes || []) ring(h); }
  const ex = extra.filter((P) => P && P.length > 2 && near(P)).map((P) => P.map(L)); for (const P of ex) ring(P.map((q) => toSim(d, q[0], q[1])));
  const own = b.poly.map(L), holes = (b.holes || []).map((h) => h.map(L));
  const inside = (u, z) => pip(u, z, own) && !holes.some((h) => pip(u, z, h)) && !ex.some((P) => pip(u, z, P));
  const clear = (ua, ub, za, zb) => {     // no wall crosses the rectangle (axis-aligned in this frame): no segment end inside it, no segment across an edge
    const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    for (const s of segs) {
      if (Math.max(s[0], s[2]) < ua || Math.min(s[0], s[2]) > ub || Math.max(s[1], s[3]) < z0 || Math.min(s[1], s[3]) > z1) continue;
      if ((s[0] > ua && s[0] < ub && s[1] > z0 && s[1] < z1) || (s[2] > ua && s[2] < ub && s[3] > z0 && s[3] < z1)) return false;
      if (segHit(ua, z0, ub, z0, s[0], s[1], s[2], s[3]) || segHit(ub, z0, ub, z1, s[0], s[1], s[2], s[3]) || segHit(ub, z1, ua, z1, s[0], s[1], s[2], s[3]) || segHit(ua, z1, ua, z0, s[0], s[1], s[2], s[3])) return false;
    }
    return true;
  };
  const PAD = 0.1;     // the room's walls stand at least this far inside every wall of the building (no z-fighting with the facade)
  const ok = (ua, ub, D) => {
    const A = ua - PAD, B = ub + PAD, Z = -D - PAD, nu = Math.max(2, Math.ceil((B - A) / 0.6)), nz = Math.max(2, Math.ceil((-0.3 - Z) / 0.6));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nz; j++) if (!inside(A + (B - A) * i / nu, -0.3 + (Z + 0.3) * j / nz)) return false;
    return clear(A, B, -0.3, Z);
  };
  // for each depth, the widest run along the wall that holds the whole glazed front, grown 10 cm (then 3 cm) a side at a time (the side with room first)
  let best = null;
  for (let D = Dt; D >= 3.5; D -= 0.5) {
    let ua = d.x0 - 0.02, ub = d.x1 + 0.02; if (!ok(ua, ub, D)) continue;
    let ga = true, gb = true; while ((ga || gb) && ub - ua < Wt) { if (ga && ub - ua < Wt) { if (ok(ua - 0.1, ub, D)) ua -= 0.1; else if (ok(ua - 0.03, ub, D)) ua -= 0.03; else ga = false; } if (gb && ub - ua < Wt) { if (ok(ua, ub + 0.1, D)) ub += 0.1; else if (ok(ua, ub + 0.03, D)) ub += 0.03; else gb = false; } }
    const W = ub - ua, sc = Math.min(W / Wt, 1) * 0.55 + Math.min(D / Dt, 1) * 0.45; if (!best || sc > best.score + 1e-6) best = { ua, ub, D, W, score: sc };
    if (W >= Wt - 0.05) break;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------- what stands in each kind of shop
// A plan: items { box: [u0, u1, y0, y1, z0, z1], m: material key, solid?: true (a wall for walkers), cell?, tile? }, lights [[u, z, strength]],
// people [{ role, at: [u, z], face: [du, dz] | null, clip, route? }], ceiling height h, floor material and walls.
// The room: u in [ua, ub], z in [-D, -0.12] (the front wall's inner face). The door's opening is u in [d.dl, d.dr].
const R = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

export function planShop(d, room) {
  const k = d.kind, { ua, ub, D } = room, zf = -0.12, zb = -D, W = ub - ua, H = Math.max(3.05, Math.min(d.sLo + 0.45, 3.9));
  const doorL = d.dl, doorR = d.dr, doorC = (doorL + doorR) / 2, doorSide = doorC > (ua + ub) / 2 ? 1 : -1;     // which half of the front the door is in
  const items = [], lights = [], people = [], rnd = R(d.bid * 7 + 13);
  const box = (u0, u1, y0, y1, z0, z1, m, solid = false, o = {}) => items.push(Object.assign({ box: [Math.min(u0, u1), Math.max(u0, u1), y0, y1, Math.min(z0, z1), Math.max(z0, z1)], m, solid }, o));
  // the far side from the door (counters go there so the way in stays clear)
  const s = doorSide, farU = s > 0 ? ua : ub, doorWall = s > 0 ? ub : ua, sgn = s;     // +s points from the far wall toward the door's side
  const P = { floor: 'vinyl', wall: 'wallWhite', ceil: 'ceilTile', H, items, lights, people, base: 'skirt' };
  const lightGrid = (gap, s = 1) => { const nu = Math.max(1, Math.round(W / gap)), nz = Math.max(1, Math.round(D / gap)); for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) lights.push([ua + W * (i + 0.5) / nu, zb + D * (j + 0.5) / nz, s]); };
  // shelving: a run of gondola along z between za and zb2 at u = uc, two faced (both sides) or against a wall (face +1 / -1 toward u)
  const gondola = (uc, za, zb2, h, goods, faces = 2, depth = 0.9) => {
    const hw = faces === 2 ? depth / 2 : depth / 2, u0 = faces === -1 ? uc - depth : faces === 1 ? uc : uc - hw, u1 = faces === -1 ? uc : faces === 1 ? uc + depth : uc + hw;
    box(u0, u1, 0, 0.12, za, zb2, 'kick', true); box(u0 + (faces === 2 ? hw - 0.03 : faces === 1 ? 0 : depth - 0.06), u0 + (faces === 2 ? hw + 0.03 : faces === 1 ? 0.06 : depth), 0.12, h, za, zb2, 'shelfBack');
    box(Math.min(za, zb2) === za ? u0 : u0, u1, h, h + 0.04, za, zb2, 'shelf');
    const n = Math.max(3, Math.round((h - 0.2) / 0.38));
    for (let i = 0; i < n; i++) { const y = 0.14 + (h - 0.2) * i / n, yt = y + (h - 0.2) / n - 0.05;
      box(u0, u1, y, y + 0.025, za, zb2, 'shelf');
      for (const f of faces === 2 ? [-1, 1] : [faces]) { const fu0 = f < 0 ? u0 + 0.02 : (faces === 2 ? uc + 0.03 : u0 + 0.06), fu1 = f < 0 ? (faces === 2 ? uc - 0.03 : u1 - 0.06) : u1 - 0.02;
        box(f < 0 ? fu0 + rnd() * 0.08 : fu0, f < 0 ? fu1 : fu1 - rnd() * 0.08, y + 0.025, yt, za + 0.03, zb2 - 0.03, goods, false, { face: f > 0 ? 'u+' : 'u-', seed: rnd() }); }
    }
  };
  // wall shelving along the back (z = zb), between u0 and u1
  const backShelf = (u0, u1, h, goods, depth = 0.45) => {
    box(u0, u1, 0, 0.12, zb, zb + depth, 'kick', true); box(u0, u1, h, h + 0.04, zb, zb + depth, 'shelf');
    const n = Math.max(3, Math.round((h - 0.2) / 0.36));
    for (let i = 0; i < n; i++) { const y = 0.14 + (h - 0.2) * i / n, yt = y + (h - 0.2) / n - 0.05; box(u0, u1, y, y + 0.025, zb, zb + depth, 'shelf'); box(u0 + 0.02, u1 - 0.02, y + 0.025, yt, zb + 0.03, zb + depth - 0.02 - rnd() * 0.06, goods, false, { face: 'z+', seed: rnd() }); }
  };
  // a side wall shelving (against u = uw, facing into the room: f = +1 when the wall is at ua)
  const sideShelf = (uw, f, z0, z1, h, goods, depth = 0.45) => {
    const u0 = f > 0 ? uw : uw - depth, u1 = f > 0 ? uw + depth : uw;
    box(u0, u1, 0, 0.12, z0, z1, 'kick', true); box(u0, u1, h, h + 0.04, z0, z1, 'shelf');
    const n = Math.max(3, Math.round((h - 0.2) / 0.36));
    for (let i = 0; i < n; i++) { const y = 0.14 + (h - 0.2) * i / n, yt = y + (h - 0.2) / n - 0.05; box(u0, u1, y, y + 0.025, z0, z1, 'shelf'); box(f > 0 ? u0 + 0.03 : u0 + 0.02 + rnd() * 0.06, f > 0 ? u1 - 0.02 - rnd() * 0.06 : u1 - 0.03, y + 0.025, yt, z0 + 0.02, z1 - 0.02, goods, false, { face: f > 0 ? 'u+' : 'u-', seed: rnd() }); }
  };
  const fridges = (uw, f, z0, z1) => {     // a run of glass-door drinks coolers against a side wall
    const dep = 0.75, u0 = f > 0 ? uw : uw - dep, u1 = f > 0 ? uw + dep : uw;
    box(u0, u1, 0, 2.2, z0, z1, 'fridgeBody', true); box(f > 0 ? u1 - 0.02 : u0, f > 0 ? u1 : u0 + 0.02, 0.12, 2.05, z0 + 0.04, z1 - 0.04, 'fridgeFront', false, { face: f > 0 ? 'u+' : 'u-' });
    box(u0, u1, 2.05, 2.35, z0, z1, 'fridgeTop', false, { face: f > 0 ? 'u+' : 'u-' });
    const n = Math.max(1, Math.round((z1 - z0) / 0.8)); for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; box(f > 0 ? u1 - 0.035 : u0, f > 0 ? u1 + 0.01 : u0 + 0.035, 0.12, 2.05, z - 0.025, z + 0.025, 'chrome'); }
  };
  // a counter along u at depth z (front face toward +z), from u0 to u1
  const counter = (u0, u1, zc, depth, h, top, front) => { box(u0, u1, 0, h - 0.04, zc - depth, zc, front, true, { face: 'z+' }); box(u0 - 0.03, u1 + 0.03, h - 0.04, h, zc - depth - 0.02, zc + 0.04, top); };
  const counterZ = (uc, z0, z1, depth, h, top, front, f) => { const u0 = f > 0 ? uc - depth : uc, u1 = f > 0 ? uc : uc + depth; box(u0, u1, 0, h - 0.04, z0, z1, front, true, { face: f > 0 ? 'u+' : 'u-' }); box(u0 - 0.03, u1 + 0.03, h - 0.04, h, z0 - 0.03, z1 + 0.03, top); };

  if (k === 'deli') {
    P.floor = 'vinylChecker'; P.wall = 'wallCream';
    // the register counter along the far side by the windows (the clerk between it and the wall, facing the door), drinks coolers behind it on the
    // far wall, the deli counter with the menu across the back, one or two gondolas in the middle, wall shelving on the door side
    const cu = farU + s * 0.85; counterZ(cu + s * 0.65, -1.0, -2.6, 0.65, 1.0, 'counterTop', 'counterFront', s);
    box(cu + s * 0.2 - 0.2, cu + s * 0.2 + 0.2, 1.0, 1.3, -2.2, -1.85, 'register');
    box(cu, cu + s * 0.65, 1.0, 1.5, -1.12, -1.02, 'lotto', false, { face: 'z+' });     // a scratch-card rack on the counter's front end
    fridges(farU, s, zb + 1.7, Math.max(zb + 3.2, -3.0));
    const dz = zb + 0.9; counter(ua + 0.4, ub - 0.4, dz, 0.7, 1.15, 'counterTop', 'deliCase');
    box(ua + 0.5, ub - 0.5, 1.15, 1.45, dz - 0.5, dz - 0.05, 'sneeze', false, { face: 'z+' });
    box(ua + 0.6, ub - 0.6, 2.2, Math.min(H - 0.15, 3.0), zb + 0.01, zb + 0.05, 'menuDeli', false, { face: 'z+' });
    const g0 = zb + 2.1, g1 = Math.min(-3.0, zb + D - 2.8), mA = farU + s * 2.3, mB = doorWall - s * 1.4, span = Math.abs(mB - mA);
    if (g1 - g0 > 1.2) { if (span > 3.4) { gondola(mA + s * span * 0.3, g0, g1, 1.5, 'goodsSnack'); gondola(mA + s * span * 0.72, g0, g1, 1.6, 'goodsDeli'); } else gondola((mA + mB) / 2, g0, g1, 1.55, 'goodsDeli'); }
    sideShelf(doorWall, -s, zb + 1.8, Math.min(-2.8, zb + D - 2.6), 2.0, 'goodsDeli');
    lightGrid(2.4, 1.05);
    people.push({ role: 'keeper', at: [farU + s * 0.42, -1.8], face: [s, 0.35], clip: 'idleshift' });
    people.push({ role: 'keeper2', at: [(ua + ub) / 2 - s * 0.8, dz - 0.95], face: [0, 1], clip: 'idle' });
    const gu = span > 3.4 ? mA + s * span * 0.51 : (mA + mB) / 2 + s * 0.95 * 0, au = span > 3.4 ? gu : (mA + mB) / 2 - s * 0.95;
    people.push({ role: 'shopper', route: [[au, g1 + 0.4], [au, g0 - 0.35], [(ua + ub) / 2 + s * 0.6, dz + 0.75], [doorWall - s * 0.95, g0 + 0.2], [doorWall - s * 0.95, g1 + 0.3]], clip: 'walkslow', stand: ['idle', 'phonestand'] });
  } else if (k === 'pizza') {
    P.floor = 'tileRed'; P.wall = 'wallWarm';
    // the counter with the slice case runs across the room; the deck ovens behind it; tables in front, by the windows
    const cz = zb + 2.5; counter(ua + 0.3, ub - 1.3, cz, 0.85, 1.05, 'counterSteel', 'counterRed');
    box(ua + 0.5, ub - 1.6, 1.05, 1.4, cz - 0.75, cz - 0.05, 'pizzaCase', false, { face: 'z+' });
    box(ua + 0.6, ub - 1.7, 1.06, 1.1, cz - 0.7, cz - 0.1, 'pies', false, { face: 'y+' });
    box(ua + 0.4, ub - 0.4, 0, 2.5, zb, zb + 1.15, 'ovenFront', true, { face: 'z+' });
    box(ua + 0.4, ub - 0.4, 2.5, H - 0.02, zb, zb + 0.9, 'hood', false, { face: 'z+' });
    box(ua + 0.4, ub - 0.4, 0.95, 1.0, zb + 1.15, zb + 1.5, 'counterSteel', false);
    box(ua + 0.4, ub - 0.4, 0, 0.95, zb + 1.15, zb + 1.45, 'steelDoors', true, { face: 'z+' });
    box(ua + 0.5, ub - 0.5, H - 1.0, H - 0.3, zb + 1.16, zb + 1.2, 'menuPizza', false, { face: 'z+' });
    box(ub - 1.25, ub - 0.3, 0, 1.9, cz - 0.9, cz - 0.1, 'sodaFridge', true, { face: 'z+' });
    // tables: two-tops along the window line and the wall opposite the door
    const tz = [-1.4, -2.9]; const tu = [farU + s * 1.5, farU + s * 3.0];
    for (const z of tz) for (const u of tu) { if (Math.abs(u - doorC) < 1.4 && z > -2) continue; if (z - 0.6 < cz + 0.3) continue;
      box(u - 0.035, u + 0.035, 0, 0.72, z - 0.035, z + 0.035, 'chrome', true); box(u - 0.35, u + 0.35, 0.72, 0.75, z - 0.35, z + 0.35, 'tableTop', false, { face: 'y+' });
      for (const s of [-1, 1]) { const cz2 = z + s * 0.55; box(u - 0.2, u + 0.2, 0.43, 0.47, cz2 - 0.2, cz2 + 0.2, 'chairSeat', true); box(u - 0.2, u + 0.2, 0.47, 0.88, cz2 + s * 0.17, cz2 + s * 0.2, 'chairSeat'); for (const a of [-0.17, 0.17]) for (const c of [-0.17, 0.17]) box(u + a - 0.015, u + a + 0.015, 0, 0.43, cz2 + c - 0.015, cz2 + c + 0.015, 'chrome'); } }
    box(farU + (sgn > 0 ? 0 : -0.35), farU + (sgn > 0 ? 0.35 : 0), 0.95, 1.0, -3.6, -1.0, 'counterSteel', true);     // a stand-up ledge along the far wall
    lightGrid(2.2, 1.0);
    people.push({ role: 'keeper', at: [(ua + ub) / 2 - 0.4, cz - 1.25], face: [0, 1], clip: 'idle' });
    people.push({ role: 'customer', at: [(ua + ub) / 2 + 0.2, cz + 0.65], face: [0, -1], clip: 'wait' });
    people.push({ role: 'eater', at: [farU + s * 0.62, -2.15], face: [-s, 0], clip: 'coffeestand' });
  } else if (k === 'hotel') {
    P.floor = 'marble'; P.wall = 'panel'; P.ceil = 'ceilPlaster'; P.base = 'skirtDark';
    // reception desk at the back, a seating group with a rug on one side, plants, a console; warm pendant light
    const dz = zb + 2.3, dw = Math.min(4.2, W - 2.2), du = (ua + ub) / 2 + (W > 7 ? -sgn * 0.0 : 0);
    counter(du - dw / 2, du + dw / 2, dz, 0.75, 1.1, 'stoneTop', 'woodDesk');
    box(du - dw / 2 - 0.4, du + dw / 2 + 0.4, 0, 3.0, zb, zb + 0.1, 'woodDark', false, { face: 'z+' });
    box(du - 1.1, du + 1.1, 1.7, 2.3, zb + 0.1, zb + 0.13, 'hotelSign', false, { face: 'z+' });
    box(du - dw / 2 + 0.3, du - dw / 2 + 0.55, 1.1, 1.45, dz - 0.5, dz - 0.25, 'lampShade');
    // seating: on the side away from the door, in the front half
    const su = farU + s * 1.9, sz = Math.max(dz + 1.8, -3.4);
    box(su - 1.5, su + 1.5, 0, 0.03, sz - 1.2, sz + 1.2, 'rug', false, { face: 'y+' });
    const sofa = (u, z, fu, fz, len) => { const a = fu !== 0, hl = len / 2;
      const u0 = a ? u - 0.45 : u - hl, u1 = a ? u + 0.45 : u + hl, z0 = a ? z - hl : z - 0.45, z1 = a ? z + hl : z + 0.45;
      box(u0, u1, 0.1, 0.45, z0, z1, 'sofa', true); box(a ? (fu > 0 ? u0 : u1 - 0.22) : u0, a ? (fu > 0 ? u0 + 0.22 : u1) : u1, 0.45, 0.85, a ? z0 : (fz > 0 ? z0 : z1 - 0.22), a ? z1 : (fz > 0 ? z0 + 0.22 : z1), 'sofa');
      for (const [p, q] of [[u0 + 0.05, z0 + 0.05], [u1 - 0.09, z0 + 0.05], [u0 + 0.05, z1 - 0.09], [u1 - 0.09, z1 - 0.09]]) box(p, p + 0.04, 0, 0.1, q, q + 0.04, 'woodDark'); };
    sofa(su - s * 1.05, sz, s, 0, 1.9);
    sofa(su, sz - 0.95, 0, 1, 1.0); sofa(su, sz + 0.95, 0, -1, 1.0);
    box(su - 0.45, su + 0.45, 0.38, 0.42, sz - 0.3, sz + 0.3, 'stoneTop', true); box(su - 0.4, su + 0.4, 0, 0.38, sz - 0.25, sz + 0.25, 'woodDark');
    for (const [pu, pz] of [[doorSide > 0 ? ua + 0.45 : ub - 0.45, zb + 0.6], [doorSide > 0 ? ub - 0.45 : ua + 0.45, zb + 0.6], [doorSide > 0 ? ua + 0.45 : ub - 0.45, -0.7]]) { box(pu - 0.22, pu + 0.22, 0, 0.5, pz - 0.22, pz + 0.22, 'planter', true); box(pu - 0.4, pu + 0.4, 0.5, 1.6, pz - 0.4, pz + 0.4, 'plant'); }
    box(doorSide > 0 ? ub - 0.45 : ua, doorSide > 0 ? ub : ua + 0.45, 0, 0.85, Math.max(zb + 2.6, -4.8), Math.max(zb + 4.4, -3.0), 'woodDesk', true);     // a console on the door side wall
    box(doorSide > 0 ? ub - 0.06 : ua, doorSide > 0 ? ub : ua + 0.06, 1.3, 2.3, Math.max(zb + 2.8, -4.6), Math.max(zb + 4.2, -3.2), 'artwork', false, { face: doorSide > 0 ? 'u-' : 'u+' });
    lightGrid(2.8, 0.9); P.warm = true;
    people.push({ role: 'keeper', at: [du + 0.4, dz - 1.15], face: [0, 1], clip: 'idle' });
    people.push({ role: 'guest', route: [[doorC - sgn * 0.3, -1.6], [du - 0.5, dz + 0.75], [du + 0.6, dz + 0.75], [(ua + ub) / 2 + sgn * 1.0, -2.3]], clip: 'walkslow', stand: ['wait', 'idle'] });
    people.push({ role: 'sitter', at: [su + s * 1.05, sz + 0.2], face: [-s, -0.3], clip: 'phonestand' });
  } else if (k === 'pharmacy') {
    P.floor = 'vinylWhite'; P.wall = 'wallWhite'; P.bright = 1.25;
    // checkout by the door, aisles of shelving front to back, the pharmacy counter across the back
    const pz = zb + 1.9; counter(ua + 0.8, ub - 0.8, pz, 0.7, 1.05, 'counterTop', 'counterWhite');
    box(ua + 0.2, ub - 0.2, 0, H - 0.4, zb, zb + 0.6, 'goodsRx', true, { face: 'z+' });
    box(ua + 1.0, ub - 1.0, H - 0.75, H - 0.3, zb + 0.6, zb + 0.66, 'signRx', false, { face: 'z+' });
    const cu0 = doorSide > 0 ? doorL - 2.6 : doorR + 0.6, cu1 = doorSide > 0 ? doorL - 0.6 : doorR + 2.6;
    counter(cu0, cu1, -1.15, 0.6, 1.0, 'counterTop', 'counterWhite');
    box((cu0 + cu1) / 2 - 0.25, (cu0 + cu1) / 2 + 0.15, 1.0, 1.3, -1.6, -1.35, 'register');
    box(cu0 + 0.1, cu0 + 0.7, 1.0, 1.35, -1.25, -1.15, 'lotto', false, { face: 'z+' });
    const a0 = pz + 1.4, a1 = Math.min(-2.6, zb + D - 2.4); const n = Math.max(1, Math.floor((W - 1.4) / 1.9));
    if (a1 - a0 > 1.5) for (let i = 0; i < n; i++) { const uc = ua + 0.7 + (W - 1.4) * (i + 0.5) / n; gondola(uc, a0, a1, 1.6, i % 2 ? 'goodsRx2' : 'goodsRx'); box(uc - 0.46, uc + 0.46, 1.66, 1.98, a1 - 0.02, a1 + 0.02, 'aisleSign', false, { face: 'z+' }); }
    sideShelf(farU, sgn, a0, a1 + 0.5, 1.9, 'goodsRx2');
    lightGrid(2.2, 1.2);
    people.push({ role: 'keeper', at: [(cu0 + cu1) / 2, -1.85], face: [0, 1], clip: 'idle' });
    people.push({ role: 'keeper2', at: [(ua + ub) / 2 + 0.6, pz - 1.05], face: [0, 1], clip: 'idleshift' });
    const au = (n > 1 ? ua + 0.7 + (W - 1.4) * 1 / n : (ua + ub) / 2 + 1.1); people.push({ role: 'shopper', route: [[au, a1 + 0.6], [au, a0 - 0.3], [au + (n > 1 ? (W - 1.4) / n : -2.2), a0 - 0.3], [au + (n > 1 ? (W - 1.4) / n : -2.2), a1 + 0.6]], clip: 'walkslow', stand: ['idle', 'phonestand'] });
  }
  P.zf = zf; P.zb = zb; P.ua = ua; P.ub = ub; P.D = D; P.W = W; P.doorC = doorC;
  return P;
}
