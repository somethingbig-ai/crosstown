// garages/plan.js (lanes/shops/garages): where a parking garage's room goes inside its building and what stands in it. Pure data (no three.js): runs in node.
// The bay frame is the storefront's: u along the wall (metres from the bay's centre), z out of the wall (the garage is at z < 0); here t = -z is the
// depth in from the wall line, and heights are metres above the garage's lower floor (the sidewalk, 0.15 m above the map's zero).
// Sim point = (d.x, d.y) + u (d.dx, d.dy) + z (d.nx, d.ny).
//   The garage is a SPLIT-LEVEL deck with no floor over another floor (the game's collision is flat, so two floors never share a place on the map):
//   lower deck from the mouth back to TA, a ramp up the middle (TA..TS, RISE m), and the upper deck: the two platforms beside the ramp and everything
//   behind it. The mouth of the garage is in the middle of the aisle. The ceiling is 6.4 m up (lower where the building is): the game's chase camera
//   rides about 3.9 m over a car's floor (more for a van), and under a 4.5 m ceiling it sat above the slab whenever the car was on the upper deck.
export const toSim = (d, u, z) => [d.x + u * d.dx + z * d.nx, d.y + u * d.dy + z * d.ny];
export const toLocal = (d, x, y) => [(x - d.x) * d.dx + (y - d.y) * d.dy, (x - d.x) * d.nx + (y - d.y) * d.ny];
export const simHeading = (d, du, dz) => Math.atan2(du * d.dy + dz * d.ny, du * d.dx + dz * d.nx);

export const K = { RISE: 1.75, RAMP: 8, AISLE: 3.2, RW: 2.6, STALL: 5.7, PITCH: 3.0, CEIL: 6.4, MIN_D: 25, WANT_D: 38, T0: 0.3 };

function pip(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function segHit(ax, ay, bx, by, cx, cy, ex, ey) { const d1 = (ex - cx) * (ay - cy) - (ey - cy) * (ax - cx), d2 = (ex - cx) * (by - cy) - (ey - cy) * (bx - cx), d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (ey - ay) - (by - ay) * (ex - ax); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }

// the test both the tool and the game use: does the rectangle u in [ua, ub], t in [0.3, D] lie wholly inside the building, with no other wall through it?
export function roomTester(d, C, extra = []) {
  const b = C.buildings[d.bi], L = (p) => toLocal(d, p[0], p[1]), R0 = 70;
  const segs = [], ring = (P) => { const Q = P.map(L); for (let i = 0; i < Q.length; i++) { const a = Q[i], c = Q[(i + 1) % Q.length]; segs.push([a[0], a[1], c[0], c[1]]); } };
  const near = (P) => { for (const p of P) if (Math.abs(p[0] - d.x) < R0 && Math.abs(p[1] - d.y) < R0) return true; return false; };
  for (const o of C.buildings) { if (o.minh > 5.5 || !near(o.poly)) continue; ring(o.poly); for (const h of o.holes || []) ring(h); }
  const ex = extra.filter((P) => P && P.length > 2 && near(P)).map((P) => P.map(L)); for (const P of ex) ring(P.map((q) => toSim(d, q[0], q[1])));
  const own = b.poly.map(L), holes = (b.holes || []).map((h) => h.map(L));
  const inside = (u, z) => pip(u, z, own) && !holes.some((h) => pip(u, z, h)) && !ex.some((P) => pip(u, z, P));
  const clear = (ua, ub, z0, z1) => { for (const s of segs) {
    if (Math.max(s[0], s[2]) < ua || Math.min(s[0], s[2]) > ub || Math.max(s[1], s[3]) < z0 || Math.min(s[1], s[3]) > z1) continue;
    if ((s[0] > ua && s[0] < ub && s[1] > z0 && s[1] < z1) || (s[2] > ua && s[2] < ub && s[3] > z0 && s[3] < z1)) return false;
    if (segHit(ua, z0, ub, z0, s[0], s[1], s[2], s[3]) || segHit(ub, z0, ub, z1, s[0], s[1], s[2], s[3]) || segHit(ub, z1, ua, z1, s[0], s[1], s[2], s[3]) || segHit(ua, z1, ua, z0, s[0], s[1], s[2], s[3])) return false; } return true; };
  return (ua, ub, D, step = 0.7) => { const A = ua - 0.12, B = ub + 0.12, Z = -D - 0.12, nu = Math.max(2, Math.ceil((B - A) / step)), nz = Math.max(2, Math.ceil((-0.3 - Z) / step));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nz; j++) if (!inside(A + (B - A) * i / nu, -0.3 + (Z + 0.3) * j / nz)) return false;
    return clear(A, B, Z, -0.3); };
}
// tool: the best room behind a mouth (most stalls). Slow (many tests): run by tools/gar_fit.mjs, its answer is written into garages/slots.js.
export function fitGarage(d, C, extra = []) {
  const ok = roomTester(d, C, extra), half = K.AISLE + K.STALL; let best = null;
  for (let D = K.WANT_D; D >= K.MIN_D; D -= 1) {
    let ua = -K.AISLE - 0.15, ub = K.AISLE + 0.15; if (!ok(ua, ub, D)) continue;
    let ga = true, gb = true; while (ga || gb) { if (ga) { if (ua - 0.25 >= -half && ok(ua - 0.25, ub, D)) ua -= 0.25; else ga = false; } if (gb) { if (ub + 0.25 <= half && ok(ua, ub + 0.25, D)) ub += 0.25; else gb = false; } }
    const n = planGarage(d, { ua, ub, D }).stalls.length; if (!best || n > best.n) best = { ua: +ua.toFixed(2), ub: +ub.toFixed(2), D, n };
  }
  return best;
}

const R = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// The plan: numbers, the height of the floor, collision segments (bay frame: [u, z, u, z]), columns, stalls, and the boxes that are drawn.
export function planGarage(d, room, bh = 99) {
  const { ua, ub, D } = room, A = K.AISLE, RW = K.RW, T0 = K.T0, ml = d.ml, mr = d.mr, mh = d.mh;
  const rem = D - T0 - K.RAMP, TA = +(T0 + Math.min(14.5, Math.max(7.5, rem * 0.58))).toFixed(2), TS = TA + K.RAMP, RISE = K.RISE, CEIL = Math.min(K.CEIL, bh - 0.7);
  const slope = RISE / K.RAMP;
  const P = { ua, ub, D, TA, TS, RISE, CEIL, A, RW, ml, mr, mh, slope, ok: D - TS >= 5 && CEIL - RISE >= 2.3 };
  // floor height at (u, t): null outside the garage
  P.height = (u, t) => { if (u < ua || u > ub || t > D || t < -0.25) return null; if (t < T0 && (u < ml || u > mr)) return null;
    if (Math.abs(u) <= RW) return t <= TA ? 0 : t >= TS ? RISE : RISE * (t - TA) / K.RAMP; return t < TA ? 0 : RISE; };
  P.onRamp = (u, t) => Math.abs(u) <= RW && t > TA && t < TS;
  P.inside = (u, t) => u > ua && u < ub && t > T0 - 0.5 && t < D && (t >= T0 || (u > ml && u < mr));
  // ---- stalls. side -1 / +1; angled 60 degrees with the nose to the aisle and toward the way out where the side is deep enough, else along the wall
  const stalls = [], lines = [], cols = [], sd = { '-1': -A - ua, '1': ub - A }, rnd = R((d.bid || 1) * 7919 + 13);
  const boothSide = sd['1'] >= 2.2 ? 1 : -1, booth = { u0: boothSide * (A + 0.35), u1: boothSide * (A + 2.05), t0: 1.6, t1: 4.0, side: boothSide };
  if (booth.u0 > booth.u1) [booth.u0, booth.u1] = [booth.u1, booth.u0];
  const row = (side, ta, tb, level) => {
    const dep = sd[side], y = level ? RISE : 0;
    if (dep >= 5.5) { const n = Math.floor((tb - ta) / K.PITCH), off = (tb - ta - n * K.PITCH) / 2;
      for (let i = 0; i < n; i++) { const t = ta + off + K.PITCH * (i + 0.5); stalls.push({ u: side * (A + 0.5 + 2.45), t, du: -side * 0.866, dz: 0.5, level, y, r: rnd() }); }
      const tmin = (level ? TA : T0) + 0.15, L1 = Math.min(dep, 5.6) * 1.12;
      for (let i = 0; i <= n; i++) { const t = ta + off + K.PITCH * i - 1.62, L0 = Math.max(0, (tmin - t) / 0.5); if (L0 < L1) lines.push([side * (A + 0.15 + 0.866 * L0), t + 0.5 * L0, side * (A + 0.15 + 0.866 * L1), t + 0.5 * L1, y]); if (i % 2 === 0 && i > 0 && i < n) cols.push([side * (A + 0.34), t, y]); } }
    else if (dep >= 2.5) { const n = Math.floor((tb - ta) / 6.1), off = (tb - ta - n * 6.1) / 2; for (let i = 0; i < n; i++) stalls.push({ u: side * (A + 1.3), t: ta + off + 6.1 * (i + 0.5), du: 0, dz: 1, level, y, r: rnd() });
      for (let i = 0; i <= n; i++) lines.push([side * (A + 0.1), ta + off + 6.1 * i, side * (A + 2.4), ta + off + 6.1 * i, y]); }
  };
  // the platforms beside the ramp: cars along the outer wall, nose to the back (they leave over the upper deck, through the gap kept before its first stall)
  for (const side of [-1, 1]) { const w = (side < 0 ? -RW - ua : ub - RW), plat = w >= 5.4;
    row(side, side === boothSide ? booth.t1 + 0.9 : T0 + 0.9, TA - 1.2, 0); row(side, TS + (plat ? 8.5 : 1.6), D - 1.2, 1);
    if (plat) for (const t of [TA + 2.9, TA + 8.2]) stalls.push({ u: side * (RW + w - 1.45), t, du: 0, dz: -1, level: 1, y: RISE, r: rnd(), plat: true }); }
  P.stalls = stalls; P.lines = lines; P.cols = cols; P.booth = booth;
  // ---- collision (bay frame, z = -t)
  const S = [], seg = (u0, t0, u1, t1) => S.push([u0, -t0, u1, -t1]), rect = (u0, u1, t0, t1) => { seg(u0, t0, u1, t0); seg(u1, t0, u1, t1); seg(u1, t1, u0, t1); seg(u0, t1, u0, t0); };
  seg(ua, T0, ua, D); seg(ua, D, ub, D); seg(ub, D, ub, T0); seg(ua, T0, ml, T0); seg(mr, T0, ub, T0); seg(ml, T0, ml, -0.1); seg(mr, T0, mr, -0.1);
  seg(ua, TA, -RW, TA); seg(RW, TA, ub, TA); seg(-RW, TA, -RW, TS); seg(RW, TA, RW, TS);          // the platforms' faces and the ramp's two sides
  rect(booth.u0, booth.u1, booth.t0, booth.t1);
  for (const c of cols) rect(c[0] - 0.22, c[0] + 0.22, c[1] - 0.22, c[1] + 0.22);
  P.segs = S;
  return P;
}
