// park/heroes/bethesda.js (park lane, helper heroes, Nov 16): BETHESDA TERRACE AND FOUNTAIN, built on the lidar relief (nothing is flattened).
// FROM THE DATA: the axis and the arcade's north face (OSM way 234241518), the width of the face (22.8 m, OSM's notch in the upper paving), the stair
// wings (11.4 .. 23.6 m either side of the axis, stair lines at 17.6 m: OSM steps 44225604 / 44225620), the two levels and the landing half way (lidar),
// the lower terrace's outline (OSM relation 3170084), the basin's place and 28.4 m width (OSM way 958635828), its water level (lidar).
// MINE (from the photographs, not measured): seven arches of 2.3 m, wall and pier thicknesses, baluster height 1.0 m, the tread depth (0.41 m; the
// risers follow the lidar slope), the fountain's bowls and the angel (7.6 m to her head, wing tips 8.0 m), that she faces the Mall.
// NOT BUILT: the arcade's inside (a blind, dark face: the sim's height grid holds a ramp there and the drive's deck lifts a walker onto the drive),
// the stair from the Mall down into the arcade south of the drive, falling water, carving.
import * as THREE from 'three';
import { mk, F, O, U, V, pip } from './kit.js';

let DECKS = [];
export function build(game, S, C, park, inC) {
  if (!inC(O[0], O[1])) return null;
  const T = game.terrain, sg = game.statics, B = mk(), g = (a, e) => { const p = F(a, e, 0); return T.ground(p[0], p[1]); };
  for (const d of DECKS) T.removeDeck(d); DECKS = [];
  const ZU = g(-4, 5), ZL = g(16, 0), ST = [1, 1, 1], BLUE = [0.82, 0.83, 0.86], DARK = [0.012, 0.012, 0.012], HW = 11.4, AF = 2.0, AT = -8, AB = 12.7;
  const seg = (a0, e0, a1, e1, h) => { const p = F(a0, e0, 0), q = F(a1, e1, 0); sg.addSeg(p[0], p[1], q[0], q[1], h, 'wall'); };
  // a pierced balustrade between two frame points (a, e, z): plinth, quatrefoil panel, coping; z may slope
  const bal = (a0, e0, z0, a1, e1, z1, under = 0) => { const L = Math.hypot(a1 - a0, e1 - e0), da = (a1 - a0) / L, de = (e1 - e0) / L, G = (s, o, z) => F(a0 + da * s - de * o, e0 + de * s + da * o, z0 + (z1 - z0) * s / L + z), n = Math.max(1, Math.round(L / 0.62));
    B.box(G, 0, L, -0.17, 0.17, -under, 0.22, ST, 1); B.q(G(0, 0, 0.22), G(L, 0, 0.22), G(L, 0, 0.88), G(0, 0, 0.88), ST, 2, [[0, 0], [n, 0], [n, 1], [0, 1]]); B.box(G, 0, L, -0.2, 0.2, 0.88, 1.02, ST, 1); seg(a0, e0, a1, e1, 1.1); };
  const pier = (a, e, z, h, w) => { B.box(F, a - w, a + w, e - w, e + w, z - 0.4, z + h, ST, 1); B.box(F, a - w - 0.08, a + w + 0.08, e - w - 0.08, e + w + 0.08, z + h, z + h + 0.12, ST, 1); const p = F(a, e, 0); B.lathe(p[0], p[1], z + h + 0.12, [[w * 1.25, 0], [w * 1.1, 0.16], [w * 0.55, 0.36], [w * 0.2, 0.44], [w * 0.24, 0.56], [0, 0.68]], 8, ST, 1, 1, 0.13); };

  // 1. the arcade's north face: seven arches under the balcony
  { const bw = 2 * HW / 7, ow = 1.15, zs = ZL + 2.5, z0 = ZL - 0.4, N = 8, face = (e0, e1, za, zb, zt, a) => B.q(F(a, e1, zb), F(a, e0, za), F(a, e0, zt), F(a, e1, zt), ST, 1);
    for (let i = 0; i < 7; i++) { const ec = -HW + bw * (i + 0.5);
      face(ec - bw / 2, ec - ow, z0, z0, ZU, AF); face(ec + ow, ec + bw / 2, z0, z0, ZU, AF);
      for (const sd of [-1, 1]) B.q(F(AF, ec + sd * ow, z0), F(AF - 0.5, ec + sd * ow, z0), F(AF - 0.5, ec + sd * ow, zs), F(AF, ec + sd * ow, zs), ST, 1);      // jambs
      for (let k = 0; k < N; k++) { const x0 = -ow + 2 * ow * k / N, x1 = -ow + 2 * ow * (k + 1) / N, za = zs + Math.sqrt(Math.max(0, ow * ow - x0 * x0)), zb = zs + Math.sqrt(Math.max(0, ow * ow - x1 * x1));
        face(ec + x0, ec + x1, za, zb, ZU, AF); B.q(F(AF, ec + x0, za), F(AF, ec + x1, zb), F(AF - 0.5, ec + x1, zb), F(AF - 0.5, ec + x0, za), ST, 1); }      // spandrel, soffit
      B.q(F(AF - 0.5, ec + ow, z0), F(AF - 0.5, ec - ow, z0), F(AF - 0.5, ec - ow, zs + ow), F(AF - 0.5, ec + ow, zs + ow), DARK, 0);      // the shade inside
      if (Math.abs(i - 3) <= 1) B.q(F(AF - 0.48, ec + 0.7, ZL + 0.9), F(AF - 0.48, ec - 0.7, ZL + 0.9), F(AF - 0.48, ec - 0.7, ZL + 2.7), F(AF - 0.48, ec + 0.7, ZL + 2.7), [0.40, 0.34, 0.24], 0); }      // daylight from the far stair
    B.box(F, AF - 0.05, AF + 0.12, -HW, HW, ZU - 0.5, ZU - 0.2, ST, 1);      // the cornice
    seg(AF + 0.15, -HW, AF + 0.15, HW, 6); }
  // 2. the balcony over the arcade (brick), its balustrade, the deck a walker stands on
  B.q(F(-2.5, -HW, ZU + 0.03), F(-2.5, HW, ZU + 0.03), F(AF, HW, ZU + 0.03), F(AF, -HW, ZU + 0.03), ST, 3);
  DECKS.push(T.addDeck({ pts: [F(-0.25, -HW, ZU), F(-0.25, HW, ZU)], hw: 2.3 }));
  { const bw = 2 * HW / 7; for (let i = 0; i <= 7; i++) { const e = -HW + bw * i; pier(AF - 0.25, Math.max(-HW + 0.3, Math.min(HW - 0.3, e)), ZU, 1.25, 0.26); if (i < 7) bal(AF - 0.25, e + 0.3, ZU, AF - 0.25, e + bw - 0.3, ZU); } }
  // 3. the two grand stairs: treads that follow the lidar slope (never below it), a deck so the walker is on them, walls with balustrades, piers
  for (const sd of [-1, 1]) { const n = 50, da = (AB - AT) / n, z = [], e0 = sd * 12.0, e1 = sd * 23.0;
    for (let k = 0; k < n; k++) { let m = -1e9; for (const e of [12.2, 15, 17.6, 20, 22.8]) m = Math.max(m, g(AT + (k + 0.5) * da, sd * e)); z.push(k ? Math.min(z[k - 1], m + 0.03) : m + 0.03); }
    for (let k = 0; k < n; k++) { const a = AT + k * da, lo = Math.min(e0, e1), hi = Math.max(e0, e1); B.q(F(a, lo, z[k]), F(a, hi, z[k]), F(a + da, hi, z[k]), F(a + da, lo, z[k]), BLUE, 1);
      const zn = k + 1 < n ? z[k + 1] : z[k] - 0.2; if (zn < z[k] - 0.005) B.q(F(a + da, hi, zn), F(a + da, lo, zn), F(a + da, lo, z[k]), F(a + da, hi, z[k]), BLUE, 1); }
    DECKS.push(T.addDeck({ pts: z.map((v, k) => F(AT + (k + 0.5) * da, sd * 17.5, v)), hw: 5.4 }));
    for (const e of [sd * 11.7, sd * 23.3]) { for (let k = 0; k < n; k += 5) { const k1 = Math.min(n - 1, k + 5); bal(AT + k * da, e, z[k] + 0.3, AT + (k1 + (k1 === n - 1 ? 1 : 0)) * da, e, z[k1] + 0.3, ZU - ZL + 1.5); }
      pier(AT - 0.45, e, z[0], 1.75, 0.45); pier(AT + 25 * da, e, z[25], 1.95, 0.42); pier(AB + 0.6, e, ZL, 2.1, 0.6); } }
  // upper terrace: the parapet either side of the stairs, along the drop
  for (const sd of [-1, 1]) { bal(-4.6, sd * 23.9, g(-6, sd * 26), -4.6, sd * 27, g(-6, sd * 26)); pier(-4.6, sd * 27.3, g(-6, sd * 27), 1.3, 0.3); }
  // 4. paving laid on the relief: the upper terrace and the lower terrace to the Lake (red brick in herringbone with stone bands)
  const area = (C.data.areas || []).find((a) => a.id === 'r3170084'), basin = (C.data.areas || []).find((a) => a.id === 'w958635828');
  let cx = 1342.4, cy = 3269.3, R = 14.2, wl = -6.795;
  if (basin && basin.ring) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of basin.ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; R = (x1 - x0 + y1 - y0) / 4; if (basin.level !== undefined) wl = basin.level; }
  const cell = (a, e, d) => { const P = [[a, e], [a, e + d], [a + d, e + d], [a + d, e]].map(([p, q]) => F(p, q, g(p, q) + 0.045)); B.q(P[0], P[1], P[2], P[3], ST, 3); };
  for (let a = -14; a < -2.6; a += 1.5) for (let e = -23.5; e < 23.4; e += 1.5) { const mid = Math.abs(e + 0.75) < HW - 0.7; if (!mid && a + 1.5 > AT) continue; if (Math.min(g(a, e), g(a + 1.5, e), g(a, e + 1.5), g(a + 1.5, e + 1.5)) < ZU - 0.35) continue; cell(a, e, 1.5); }
  // The lower terrace is ONE paved floor from the arcade and the stair feet to the Lake, round the basin. h2 showed OSM's outline alone leaves a
  // notch and a ring of lawn north of the basin, so from the basin's south edge on (a > 34) every cell between the outline's east and west
  // limits that stands clear of the Lake (0.3 m over its level, -8.73 in h2's mirror report) is paved too. At the stair feet the first row starts at the last tread.
  const LAKE = -8.73, cellR = (a0, a1, e0, e1) => { const P = [[a0, e0], [a0, e1], [a1, e1], [a1, e0]].map(([p, q]) => F(p, q, g(p, q) + 0.045)); B.q(P[0], P[1], P[2], P[3], ST, 3); };
  let eLo = -24, eHi = 24; if (area && area.ring) { let lo = 1e9, hi = -1e9; for (const p of area.ring) { const dx = p[0] - O[0], dy = p[1] - O[1], a = dx * U[0] + dy * U[1], e = dx * V[0] + dy * V[1]; if (a > 20) { lo = Math.min(lo, e); hi = Math.max(hi, e); } } if (hi > lo) { eLo = Math.max(-33, lo); eHi = Math.min(33, hi); } }
  for (let a = AF + 0.1; a < 96; a += 1.5) for (let e = -33; e < 33; e += 1.5) { const am = a + 0.75, em = e + 0.75, p = F(am, em, 0); let a0 = a;
    if (Math.abs(em) > HW && a < AB) { if (a + 1.5 <= AB + 0.05) continue; a0 = AB; }
    const inRing = area && area.ring ? pip(p[0], p[1], area.ring) : (a <= 76 && Math.abs(e) <= 24), fill = am > 34 && em > eLo && em < eHi && Math.min(g(a, e), g(a + 1.5, e), g(a, e + 1.5), g(a + 1.5, e + 1.5)) > LAKE + 0.3;
    if (!inRing && !fill) continue; if (Math.hypot(p[0] - cx, p[1] - cy) < R + 0.2) continue; cellR(a0, a + 1.5, e, e + 1.5); }
  // 5. the fountain: the basin's stone wall round the water the lidar level gives, the two bowls, the Angel of the Waters
  { const GR = [0.86, 0.87, 0.9], BASEST = [0.16, 0.155, 0.14], BRZ = [0.10, 0.16, 0.13], BOWL = [0.14, 0.14, 0.13];
    B.lathe(cx, cy, wl, [[R + 1.3, -1.5], [R + 1.3, -0.42], [R + 0.95, -0.40], [R + 0.95, 0.04], [R + 0.55, 0.06], [R + 0.55, 0.46], [R + 0.45, 0.54], [R, 0.54], [R - 0.1, 0.46], [R - 0.1, -0.1]], 56, GR, 1);
    for (let k = 0; k < 24; k++) { const t0 = k / 24 * Math.PI * 2, t1 = (k + 1) / 24 * Math.PI * 2; sg.addSeg(cx + Math.cos(t0) * (R + 0.55), cy + Math.sin(t0) * (R + 0.55), cx + Math.cos(t1) * (R + 0.55), cy + Math.sin(t1) * (R + 0.55), 0.7, 'wall'); }
    B.lathe(cx, cy, wl, [[2.6, -0.1], [2.6, 0.55], [1.7, 0.75], [1.25, 1.0], [1.1, 2.0], [1.5, 2.25]], 8, BASEST, 0, 1, 0.39);
    B.lathe(cx, cy, wl, [[1.5, 2.25], [3.5, 2.8], [3.65, 2.95], [3.45, 2.95], [1.0, 2.62]], 20, BOWL, 0);
    B.lathe(cx, cy, wl, [[0.95, 2.62], [0.8, 3.0], [0.95, 3.6], [0.75, 4.1], [1.9, 4.45], [2.0, 4.6], [1.85, 4.6], [0.55, 4.42]], 16, BRZ, 0);
    B.lathe(cx, cy, wl, [[0.5, 4.42], [0.42, 5.0], [0.52, 5.05], [0.46, 5.6], [0.36, 6.3], [0.29, 6.75], [0.36, 6.98], [0.22, 7.14], [0.11, 7.2], [0.15, 7.38], [0.13, 7.5], [0, 7.6]], 10, BRZ, 0);
    const Fc = (a, e, z) => [cx + U[0] * a + V[0] * e, cy + U[1] * a + V[1] * e, wl + z];      // she faces the Mall (-a): wings behind and out, one arm raised forward
    // two raised wings swept back: a fan of feathers from each shoulder (long and short tips alternate), a trailing edge down to the hip
    for (const sd of [-1, 1]) { const Rt = Fc(0.22, sd * 0.16, 6.5), T = []; for (let i = 0; i <= 10; i++) { const th = 1.40 - i * 0.08, Lw = (i % 2 ? 0.86 : 1) * (2.1 - 0.07 * i); T.push(Fc(0.30 + 0.22 * Lw, sd * (0.16 + Math.cos(th) * Lw), 6.6 + Math.sin(th) * Lw)); }
      for (let i = 0; i < 10; i += 2) B.q(Rt, T[i], T[i + 1], T[i + 2], BRZ, 0);
      B.q(Rt, T[10], Fc(0.38, sd * 0.5, 5.55), Fc(0.26, sd * 0.15, 5.9), BRZ, 0); }
    B.tube([Fc(-0.05, -0.3, 6.85), Fc(-0.5, -0.4, 6.75), Fc(-0.95, -0.42, 7.05)], [0.11, 0.09, 0.07], 5, BRZ, 0); B.tube([Fc(-0.05, 0.3, 6.85), Fc(-0.22, 0.44, 6.4), Fc(-0.42, 0.42, 6.05)], [0.11, 0.09, 0.07], 5, BRZ, 0);
    // the four cherubs round the stem under the upper bowl, as simple turned figures
    for (let k = 0; k < 4; k++) { const t = 0.39 + Math.PI / 4 + k * Math.PI / 2; B.lathe(cx + Math.cos(t) * 1.25, cy + Math.sin(t) * 1.25, wl + 2.7, [[0.2, 0], [0.26, 0.45], [0.17, 0.8], [0.09, 0.9], [0.15, 1.02], [0.13, 1.14], [0, 1.22]], 6, BRZ, 0); } }
  const me = B.mesh(game, 'hero_bethesda'), grp = new THREE.Group(); grp.name = 'hero_bethesda'; grp.add(me); grp.userData.tris = B.tris();
  // the generic arch drawn for the drive over the arcade (a plain stone block) is hidden; its decks stay (cars and walkers on the drive)
  const f = park.features.get('bgw234241518'); if (f && f.group) f.group.visible = false;
  return grp;
}
