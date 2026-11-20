// park/heroes/bow.js (park lane, helper heroes, Nov 16): BOW BRIDGE over the Lake (Vaux and Mould, 1862): the long low cast-iron bow.
// FROM THE DATA: the deck's line, length (44 m end to end with the abutments) and heights (the lidar's bridge-deck returns: 0.7 m of camber), the
// water level, the 5.1 m width of OSM's bridge outline (deck drawn 4.4 m between the railings).
// MINE: the 27 m clear span centred on the line (the park's own figure is 87 ft), the girder and railing sizes, the piers and the eight urns.
// The generic bridge still makes the deck, the parapet collision (a 3.3 m walk, the data's default path width) and the gap in the Lake's shore
// wall; only its stone drawing is hidden.
import * as THREE from 'three';
import { mk } from './kit.js';

const ID = 'w580516390';
export function build(game, S, C, park, inC) {
  const st = (C.data.structures || []).find((s) => s.id === ID); if (!st || !st.decks || !st.decks[0]) return null;
  const P = st.decks[0].pts, p0 = P[0], p1 = P[P.length - 1], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L, vx = uy, vy = -ux;
  if (!inC(p0[0] + ux * L / 2, p0[1] + uy * L / 2)) return null;
  const T = game.terrain, B = mk(), wl = st.water_level !== undefined ? st.water_level : -8.84, S_ = P.map((p) => (p[0] - p0[0]) * ux + (p[1] - p0[1]) * uy);
  const zAt = (s) => { if (s <= S_[0]) return P[0][2]; for (let k = 0; k + 1 < P.length; k++) if (s <= S_[k + 1]) { const t = (s - S_[k]) / ((S_[k + 1] - S_[k]) || 1); return P[k][2] + (P[k + 1][2] - P[k][2]) * t; } return p1[2]; };
  const Fb = (s, o, z) => [p0[0] + ux * s + vx * o, p0[1] + uy * s + vy * o, z], mid = L / 2, SP = Math.min(13.5, L / 2 - 3), zcs = zAt(mid) - 0.55, zsp = wl + 0.35, zs = (s) => zcs - (zcs - zsp) * Math.pow((s - mid) / SP, 2);
  const CREAM = [0.60, 0.585, 0.50], SHADE = [0.30, 0.29, 0.25], GREY = [0.80, 0.82, 0.86], W = 2.2, WO = 2.3, n = Math.round(L / 0.75), ds = L / n;
  for (let k = 0; k < n; k++) { const s0 = k * ds, s1 = s0 + ds, z0 = zAt(s0), z1 = zAt(s1), inS = Math.abs((s0 + s1) / 2 - mid) < SP;
    B.q(Fb(s0, -W, z0 + 0.03), Fb(s0, W, z0 + 0.03), Fb(s1, W, z1 + 0.03), Fb(s1, -W, z1 + 0.03), [1, 1, 1], 6, [[s0, 0], [s0, 1], [s1, 1], [s1, 0]]);      // the plank deck
    for (const sd of [-1, 1]) { const o = sd * W, o2 = sd * WO;
      B.q(Fb(s0, o, z0 + 0.06), Fb(s1, o, z1 + 0.06), Fb(s1, o, z1 + 1.08), Fb(s0, o, z0 + 1.08), [1, 1, 1], 5, [[s0 / 0.5, 0], [s1 / 0.5, 0], [s1 / 0.5, 1], [s0 / 0.5, 1]]);      // railing
      B.q(Fb(s0, o2, z0 - 0.5), Fb(s1, o2, z1 - 0.5), Fb(s1, o2, z1 + 0.08), Fb(s0, o2, z0 + 0.08), [1, 1, 1], 5, [[s0 / 0.58, 0], [s1 / 0.58, 0], [s1 / 0.58, 1], [s0 / 0.58, 1]]);      // the band of interlaced circles
      B.q(Fb(s0, o2 - sd * 0.06, z0 - 0.5), Fb(s1, o2 - sd * 0.06, z1 - 0.5), Fb(s1, o2 - sd * 0.06, z1 + 0.06), Fb(s0, o2 - sd * 0.06, z0 + 0.06), SHADE, 0);
      B.q(Fb(s0, o2, z0 + 0.06), Fb(s1, o2, z1 + 0.06), Fb(s1, o, z1 + 0.06), Fb(s0, o, z0 + 0.06), CREAM, 0);
      if (inS) { const a = Math.min(zs(s0), z0 - 0.52), b = Math.min(zs(s1), z1 - 0.52); B.q(Fb(s0, o2, a), Fb(s1, o2, b), Fb(s1, o2, z1 - 0.5), Fb(s0, o2, z0 - 0.5), [1, 1, 1], 5, [[s0 / 1.1, 0], [s1 / 1.1, 0], [s1 / 1.1, 1], [s0 / 1.1, 1]]);      // the open spandrel
        B.q(Fb(s0, o2 - sd * 0.5, a), Fb(s1, o2 - sd * 0.5, b), Fb(s1, o2 - sd * 0.5, z1 - 0.5), Fb(s0, o2 - sd * 0.5, z0 - 0.5), SHADE, 0); }
      else { const lo = Math.min(wl, T.ground(...Fb(s0, o2, 0).slice(0, 2)), T.ground(...Fb(s1, o2, 0).slice(0, 2))) - 0.6; B.q(Fb(s0, o2, lo), Fb(s1, o2, lo), Fb(s1, o2, z1 - 0.5), Fb(s0, o2, z0 - 0.5), GREY, 1); } }
    if (inS) { const a = Math.min(zs(s0), z0 - 0.52), b = Math.min(zs(s1), z1 - 0.52); B.q(Fb(s0, WO, a), Fb(s1, WO, b), Fb(s1, -WO, b), Fb(s0, -WO, a), SHADE, 0); }      // the soffit
    else B.q(Fb(s0, -WO, z0 - 0.5), Fb(s0, WO, z0 - 0.5), Fb(s1, WO, z1 - 0.5), Fb(s1, -WO, z1 - 0.5), SHADE, 0); }
  for (const s of [mid - SP, mid + SP]) B.q(Fb(s, -WO, wl - 0.6), Fb(s, WO, wl - 0.6), Fb(s, WO, zAt(s) - 0.5), Fb(s, -WO, zAt(s) - 0.5), GREY, 1);      // the abutments' faces to the water
  // four piers a side (at the springings and the ends), each with its planting urn: eight urns
  for (const s of [0.6, mid - SP, mid + SP, L - 0.6]) for (const sd of [-1, 1]) { const z = zAt(s), o = sd * (WO + 0.05), c = Fb(s, o, 0);
    B.box(Fb, s - 0.32, s + 0.32, o - 0.32, o + 0.32, z - 0.6, z + 1.25, CREAM, 0); B.box(Fb, s - 0.4, s + 0.4, o - 0.4, o + 0.4, z + 1.25, z + 1.34, CREAM, 0);
    B.lathe(c[0], c[1], z + 1.34, [[0.16, 0], [0.22, 0.05], [0.09, 0.14], [0.11, 0.2], [0.33, 0.42], [0.4, 0.6], [0.36, 0.64]], 10, [0.07, 0.07, 0.065], 0);      // dark cast-iron urns, low dull November planting
    B.lathe(c[0], c[1], z + 1.34, [[0.33, 0.62], [0.40, 0.72], [0.34, 0.86], [0.18, 0.94], [0, 0.97]], 8, [0.13, 0.15, 0.06], 0);
    for (let j = 0; j < 5; j++) { const t = j * 1.2566 + s, r = 0.22; B.q([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, z + 2.0], [c[0] + Math.cos(t + 0.9) * 0.34, c[1] + Math.sin(t + 0.9) * 0.34, z + 2.02], [c[0] + Math.cos(t + 0.5) * 0.5, c[1] + Math.sin(t + 0.5) * 0.5, z + 2.42], [c[0] + Math.cos(t - 0.2) * 0.3, c[1] + Math.sin(t - 0.2) * 0.3, z + 2.36], j % 2 ? [0.20, 0.15, 0.07] : [0.12, 0.16, 0.07], 0); } }
  const me = B.mesh(game, 'hero_bow'), grp = new THREE.Group(); grp.name = 'hero_bow'; grp.add(me); grp.userData.tris = B.tris();
  const f = park.features.get('b' + ID); if (f && f.group) f.group.visible = false;
  return grp;
}
