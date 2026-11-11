// rotorgeo.js: the main rotor head and blades and the tail rotor, as geometry (meshkit, no three.js).
// Main rotor frame: origin at the hub on the blade plane, +Y up the mast; blade 0 lies along +X with its leading edge toward +Z
// (the rotor turns clockwise seen from above, so a blade over the nose moves to the right).
import { Soup, S, mat, loft, tube, rod, lathe, box, rotX, rotY, rotZ, I3 } from './meshkit.js';
import { naca, rivet } from './shape.js';

export const BM = {
  top: mat(0x6e7277, 0.5, 0, 0.35, 0), under: mat(0x26282b, 0.7, 0, 0.1, 0),      // matt near-black undersides, as most blades are: they read against trees and sky alike
  tip: mat(0xd8a50c, 0.55, 0, 0.3, 0), band: mat(0xe6e4dc, 0.55, 0, 0.3, 0), cap: mat(0x232527, 0.6, 0.3, 0, 0),
  edge: mat(0x8f9295, 0.34, 1, 0, 0), steel: mat(0xaeb1b4, 0.3, 1, 0, 0), dark: mat(0x2c2e31, 0.5, 0.9, 0, 0), hubPaint: mat(0xb9bcc0, 0.3, 0.8, 0, 0), tgrey: mat(0x2e3134, 0.5, 0, 0.35, 0),      // bright sleeves and hub against a dark star and black rubber: the head reads as parts, not as one lump
  tail: mat(0x565a5e, 0.5, 0, 0.35, 0),
  rubber: mat(0x0c0c0d, 0.8, 0, 0, 0), alu: mat(0xb9bcbf, 0.4, 1, 0, 0), red: mat(0xb3261b, 0.5, 0, 0.3, 0), white: mat(0xe9e7e0, 0.5, 0, 0.3, 0), tabs: mat(0x9a9da0, 0.45, 1, 0, 0),
};
const setM = (s, k, m) => { const v = s.v, e = k * S; v[e + 8] = m.c[0]; v[e + 9] = m.c[1]; v[e + 10] = m.c[2]; v[e + 11] = m.r; v[e + 12] = m.m; v[e + 13] = m.cc; v[e + 14] = m.t; };
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
export const ROOT = 0.30;          // where a blade's flapping starts (m from the mast)

// one main blade along +X (span stations from the cuff to the tip)
function mainBlade(s, D, q) {
  const R = D.rotorR, C = D.chord, rs = [], nr = [30, 12, 5][q], nc = [22, 12, 6][q];
  for (let i = 0; i <= nr; i++) rs.push(0.88 + (R - 0.88) * Math.pow(i / nr, 0.9)); rs.splice(rs.length - 1, 0, R - 0.07, R - 0.03, R - 0.008); rs.sort((a, b) => a - b);
  const vs = []; for (let j = 0; j < nc; j++) vs.push(j / nc * Math.PI * 2);
  const f = (u, v, o) => {
    const r = Math.min(R, Math.max(0.88, u)), k = smooth((r - 0.9) / 0.4), tipT = Math.max(0, (r - (R - 0.16)) / 0.16), c = (0.2 + (C - 0.2) * k) * (1 - 0.42 * tipT * tipT), th = 0.2 - 0.08 * k;
    const xc = 0.5 * (1 + Math.cos(v)), end = Math.sqrt(Math.min(1, Math.max(0, (R - r) / 0.03))), y0 = (Math.sin(v) >= 0 ? 1 : -1) * naca(xc, th) * c * (0.25 + 0.75 * end), z0 = (0.25 - xc) * c - 0.25 * (C - c) * (tipT > 0 ? 1 : 0) * 0 - 0.1 * C * tipT * tipT;
    const tw = 0.14 - 0.19 * (r / R), ct = Math.cos(tw), st = Math.sin(tw);
    o[0] = r; o[1] = y0 * ct + z0 * st; o[2] = z0 * ct - y0 * st; return o;
  };
  const base = loft(s, f, rs, vs, BM.top, { wrap: true, away: (u) => [u, 0, 0], pole: () => [1, 0, 0] });
  for (let i = 0; i < rs.length; i++) for (let j = 0; j < nc; j++) {
    const r = rs[i], xc = 0.5 * (1 + Math.cos(vs[j])), up = Math.sin(vs[j]) >= 0 || j === 0, k = base + i * nc + j;
    let m = up ? BM.top : BM.under;
    if (r > R - 0.035) m = BM.cap; else if (r > R - 0.32) m = BM.tip; else if (r > R - 0.62 && r < R - 0.50) m = BM.band; else if (r < 1.15) m = up ? BM.hubPaint : BM.under;
    if (xc < 0.11 && r > 1.25 && r < R - 0.035) m = BM.edge;
    setM(s, k, m);
  }
  if (q < 2) for (const r of [3.35, 3.72]) { const k = s.nv; box(s, 0.3, 0.0025, 0.05, BM.tabs); const tw = 0.14 - 0.19 * (r / R); s.place(k, rotX(-tw - 0.05), [r, -0.75 * C * Math.sin(tw) * 1, -0.75 * C - 0.018]); }
  // cuff and sleeve: two plates clamping the blade root with the star's arm between them, bolts through, the spherical bearing at the
  // inboard end, rubber frequency adapters either side, and the pitch horn reaching forward to its link
  if (q < 2) {
    for (const sg of [-1, 1]) {
      const k = s.nv; loft(s, (u, v, o) => { const w = 0.092 + 0.022 * Math.sin(Math.min(1, Math.max(0, u)) * Math.PI), t = 0.012, c = Math.cos(v), sn = Math.sin(v), e = 5, rr = 1 / Math.pow(Math.pow(Math.abs(c) / w, e) + Math.pow(Math.abs(sn) / t, e), 1 / e); o[0] = 0.30 + Math.min(1, Math.max(0, u)) * 0.72; o[1] = sn * rr + sg * 0.056; o[2] = c * rr; return o; }, [0, 0.02, 0.2, 0.4, 0.6, 0.8, 0.98, 1], [0, 0.5, 1.0, 1.4, 1.57, 1.74, 2.14, 2.64, 3.14, 3.64, 4.14, 4.54, 4.71, 4.88, 5.28, 5.78], BM.hubPaint, { wrap: true, away: (u) => [0.30 + u * 0.72, sg * 0.056, 0] });
      void k;
    }
    { const k = s.nv; box(s, 0.26, 0.09, 0.14, BM.dark); s.place(k, I3, [0.90, 0, 0]); }
    if (q === 0) for (const x of [0.80, 0.90, 1.0]) for (const z of [-0.05, 0.05]) { rod(s, [x, -0.078, z], [x, 0.078, z], 0.012, 6, BM.steel); for (const sg of [-1, 1]) { const k = s.nv; lathe(s, [[0.021, 0], [0.021, 0.006], [0.012, 0.006]], 6, BM.steel, { sharp: true }); s.place(k, sg > 0 ? I3 : rotX(Math.PI), [x, sg * 0.068, z]); } }
    { const k = s.nv; lathe(s, [[0, -0.085], [0.06, -0.07], [0.09, -0.034], [0.095, 0], [0.09, 0.034], [0.06, 0.07], [0, 0.085]], 12, BM.rubber); s.place(k, rotZ(Math.PI / 2), [0.335, 0, 0]); }
    for (const sg of [-1, 1]) { const k = s.nv; box(s, 0.13, 0.07, 0.05, BM.rubber); s.place(k, I3, [0.52, 0, sg * 0.125]); const k2 = s.nv; box(s, 0.15, 0.03, 0.062, BM.steel); s.place(k2, I3, [0.52, 0, sg * 0.125]); }
    { const k = s.nv; box(s, 0.06, 0.034, 0.2, BM.dark); s.place(k, I3, [0.47, -0.03, 0.17]); rod(s, [0.47, -0.062, 0.25], [0.47, 0.005, 0.25], 0.013, 6, BM.steel); const b2 = s.nv; lathe(s, [[0, -0.02], [0.02, -0.012], [0.024, 0], [0.02, 0.012], [0, 0.02]], 8, BM.steel); s.place(b2, I3, [0.47, -0.066, 0.25]); }
  }
}

export function buildRotorParts(D, q = 0) {
  const hub = new Soup(), arms = new Soup(), blades = new Soup(), tailHub = new Soup(), tailBlades = new Soup();
  // The hub is two meshes: `hub` is everything round about the mast (it looks the same turning or still), `arms` is what is not (the
  // star's arms, pitch links, scissors), which model.js smears over the shutter's sweep when the rotor turns.
  // ---- main hub (turns, does not flap): mast, the turning swashplate with its links and scissors, the star, the cap
  const seg = q ? 12 : 24;
  rod(hub, [0, -0.34, 0], [0, 0.06, 0], 0.062, seg, BM.steel, { caps: 0 });
  lathe(hub, [[0.062, -0.11], [0.095, -0.105], [0.105, -0.07], [0.15, -0.035], [0.16, -0.025], [0.16, 0.025], [0.15, 0.035], [0.105, 0.07], [0.095, 0.09], [0.062, 0.095]], seg, BM.hubPaint);
  lathe(hub, [[0.1, 0.08], [0.098, 0.1], [0.08, 0.125], [0.045, 0.14], [0, 0.145]], seg, BM.dark);
  if (q < 2) {
    for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2; rod(hub, [Math.cos(a) * 0.125, 0.02, Math.sin(a) * 0.125], [Math.cos(a) * 0.125, 0.062, Math.sin(a) * 0.125], 0.012, 6, BM.steel); }
    lathe(hub, [[0.08, -0.29], [0.255, -0.29], [0.272, -0.28], [0.272, -0.268], [0.255, -0.258], [0.08, -0.258]], seg, BM.steel, { sharp: true });
    lathe(hub, [[0.062, -0.245], [0.082, -0.235], [0.082, -0.185], [0.062, -0.175]], seg, BM.rubber);
    for (let i = 0; i < 3; i++) {
      const a = -i * Math.PI * 2 / 3, R = rotY(a), k = arms.nv;
      // the star's arm: a flat composite plate between the sleeve plates, wider at the root
      loft(arms, (u, v, o) => { const uu = Math.min(1, Math.max(0, u)), w = 0.125 - 0.055 * uu, t = 0.024 - 0.009 * uu, c = Math.cos(v), sn = Math.sin(v), e = 4, rr = 1 / Math.pow(Math.pow(Math.abs(c) / w, e) + Math.pow(Math.abs(sn) / t, e), 1 / e); o[0] = 0.12 + uu * 0.5; o[1] = sn * rr; o[2] = c * rr; return o; }, [0, 0.25, 0.5, 0.75, 1], [0, 0.4, 0.8, 1.2, 1.57, 1.94, 2.34, 2.74, 3.14, 3.54, 3.94, 4.34, 4.71, 5.08, 5.48, 5.88], BM.tgrey, { wrap: true, away: (u) => [0.12 + u * 0.5, 0, 0] });
      // pitch link from the turning swashplate up to the pitch horn, a ball joint at each end, a lug on the plate
      rod(arms, [0.24, -0.25, 0.13], [0.47, -0.068, 0.25], 0.021, 8, BM.alu);
      for (const pnt of [[0.24, -0.25, 0.13], [0.47, -0.068, 0.25]]) { const b2 = arms.nv; lathe(arms, [[0, -0.026], [0.024, -0.016], [0.028, 0], [0.024, 0.016], [0, 0.026]], 8, BM.steel); arms.place(b2, I3, pnt); }
      { const b3 = arms.nv; box(arms, 0.07, 0.034, 0.06, BM.steel); arms.place(b3, I3, [0.25, -0.274, 0.13]); }
      rod(arms, [0.61, -0.035, 0], [0.61, 0.035, 0], 0.017, 6, BM.steel);
      arms.place(k, R, [0, 0, 0]);
    }
    // two scissor links holding the turning plate to the mast
    for (const sy of [0, Math.PI]) { const k = arms.nv; box(arms, 0.024, 0.1, 0.05, BM.dark); arms.place(k, rotZ(0.75), [0.11, -0.195, 0]); const k2 = arms.nv; box(arms, 0.024, 0.09, 0.05, BM.dark); arms.place(k2, rotZ(-0.6), [0.155, -0.235, 0]); rod(arms, [0.145, -0.2, -0.04], [0.145, -0.2, 0.04], 0.013, 6, BM.steel); arms.place(k, rotY(1.05 + sy), [0, 0, 0]); }
  }
  for (let i = 0; i < D.blades; i++) { const k = blades.nv; mainBlade(blades, D, q); blades.place(k, rotY(-i * Math.PI * 2 / D.blades), [0, 0, 0]); }

  // ---- tail rotor: spins about +Y here (the model turns that to +Z); two blades along +X and -X
  const TR = D.tailRotorR, tseg = q ? 8 : 16;
  lathe(tailHub, [[0.03, -0.06], [0.048, -0.055], [0.052, 0.02], [0.04, 0.045], [0.018, 0.06], [0, 0.062]], tseg, BM.dark);
  if (q < 2) { rod(tailHub, [0, 0.02, 0], [0, 0.11, 0], 0.012, 8, BM.steel); const k = tailHub.nv; box(tailHub, 0.2, 0.014, 0.03, BM.steel); tailHub.place(k, rotY(0.5), [0, 0.1, 0]); for (const sg of [-1, 1]) rod(tailHub, [sg * 0.088, 0.1, -sg * 0.048], [sg * 0.12, 0.0, -sg * 0.065], 0.006, 5, BM.alu); }
  for (let b = 0; b < 2; b++) {
    const k = tailBlades.nv, nr = [14, 7, 4][q], nc = [16, 10, 6][q], rs = [], vs = [];
    for (let i = 0; i <= nr; i++) rs.push(0.07 + (TR - 0.07) * i / nr); rs.splice(rs.length - 1, 0, TR - 0.02, TR - 0.005); for (let j = 0; j < nc; j++) vs.push(j / nc * Math.PI * 2);
    const base = loft(tailBlades, (u, v, o) => { const r = Math.min(TR, Math.max(0.07, u)), kk = smooth((r - 0.1) / 0.16), c = 0.07 + 0.125 * kk, th = 0.3 - 0.18 * kk, xc = 0.5 * (1 + Math.cos(v)), end = Math.sqrt(Math.min(1, Math.max(0, (TR - r) / 0.02))); const y0 = (Math.sin(v) >= 0 ? 1 : -1) * naca(xc, th) * c * (0.2 + 0.8 * end), z0 = (0.3 - xc) * c, tw = 0.16, ct = Math.cos(tw), st = Math.sin(tw); o[0] = r; o[1] = y0 * ct + z0 * st; o[2] = z0 * ct - y0 * st; return o; }, rs, vs, BM.top, { wrap: true, away: (u) => [u, 0, 0], pole: () => [1, 0, 0] });
    for (let i = 0; i < rs.length; i++) for (let j = 0; j < nc; j++) { const r = rs[i], xc = 0.5 * (1 + Math.cos(vs[j])); let m = BM.tail; if (r > TR - 0.025) m = BM.cap; if (xc < 0.1 && r > 0.3 && r < TR - 0.025) m = BM.edge; /* no tip colour: smeared, a coloured tip draws a ring */ setM(tailBlades, base + i * nc + j, m); }
    if (q < 2) { const g = tailBlades.nv; box(tailBlades, 0.1, 0.03, 0.06, BM.dark); tailBlades.place(g, I3, [0.09, 0, 0]); }
    tailBlades.place(k, rotY(b * Math.PI), [0, 0, 0]);
  }
  void tube; void rivet;
  return { hub, hubArms: arms, blades, tailHub, tailBlades };
}
