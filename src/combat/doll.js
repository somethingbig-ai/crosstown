// combat/doll.js: the physics of a body that has been shot. No three.js here (it runs in node for tests): 22 point masses on the
// joints, held together by rigid sticks, kept anatomical by one-sided limits (distance ranges sampled from joint angles, a real
// hinge at each knee), with ground / kerb / wall contact and Coulomb friction. A dying body does not go limp in one frame: "tone"
// springs hold the pose it had and steer it toward a reaction (knees buckling, the trunk curling round the wound, a hand going to
// it) while their strength runs out over a few tenths of a second.
// Space: three.js world (x east, y up, z south), metres, seconds. people.js lays a skeleton onto the points.
export const I = { H: 0, N: 1, C: 2, CF: 3, SL: 4, SR: 5, EL: 6, ER: 7, WL: 8, WR: 9, AL: 10, AR: 11, P: 12, PF: 13, HL: 14, HR: 15, KL: 16, KR: 17, FL: 18, FR: 19, TL: 20, TR: 21 };
export const NP = 22;
// head, neck base, mid spine, sternum, shoulders, elbows, wrists, hand tips, pelvis, pelvis front, hip joints, knees, ankles, toes
const MASS = [5, 3, 12, 6, 3.5, 3.5, 2.2, 2.2, 1.3, 1.3, 0.6, 0.6, 10, 5, 5, 5, 5, 5, 2.6, 2.6, 0.9, 0.9];
const RAD = [0.098, 0.065, 0.102, 0.078, 0.068, 0.068, 0.05, 0.05, 0.04, 0.04, 0.035, 0.035, 0.102, 0.074, 0.09, 0.09, 0.068, 0.068, 0.06, 0.06, 0.04, 0.04];
const G_LEGL = 0, G_LEGR = 1, G_SPINE = 2, G_NECK = 3, G_ARML = 4, G_ARMR = 5, NG = 6;
const EV = (globalThis.process && process.env) || {}, HF = +(EV.HF ?? 0), VF = +(EV.VF || 0.45), PA = +(EV.PA || 5), SB = +(EV.SB || 0.3), MF = +(EV.MF || 0.7), H2 = +(EV.H2 ?? 0), M2 = +(EV.M2 ?? 0.45), T2 = +(EV.T2 ?? 0.32), ST = +(EV.ST || 0.08), AL = +(EV.AL || 1), HS = +(EV.HS ?? 0.5), TB = +(EV.TB ?? 0.5), KT = +(EV.KT ?? 0.2), TS = +(EV.TS ?? 0.42), STEP = +(EV.STEP ?? 0.8), SO = +(EV.SO ?? 0.0), LB = +(EV.LB ?? 0.8), RUP = +(EV.RUP ?? 0.2), KGT = +(EV.KGT ?? 0.35), SF = +(EV.SF ?? 0.15), SITF = +(EV.SITF ?? 0.22), SITH = +(EV.SITH ?? 0.55), LF = +(EV.LF ?? 0.03), AU = +(EV.AU ?? 1.2), KA = +(EV.KA ?? 0.65), KB = +(EV.KB ?? 0.8), PL = +(EV.PL ?? 0.5), UT = +(EV.UT ?? 0), UK = +(EV.UK ?? 0), KMIN = +(EV.KMIN ?? 62), LC = +(EV.LC ?? 0), AT = +(EV.AT ?? 0.3), AH = +(EV.AH ?? 0.15), GV = +(EV.GV ?? 0.25), FG = +(EV.FG ?? 0.003), JK = +(EV.JK ?? 2.6), SAG = +(EV.SAG ?? 0.9), IM = +(EV.IM ?? 1.7), AR = +(EV.AR ?? 0.2), SV = +(EV.SV ?? 0.3), AFT = +(EV.AFT ?? 1.8), GD = +(EV.GD ?? 0.012), KS = +(EV.KS ?? 1.4), NF = +(EV.NF ?? 110), WR = +(EV.WR ?? 1.2), LCAP = +(EV.LCAP ?? 0), AFD = +(EV.AFD ?? 0.9), CR = +(EV.CR ?? 1.25), DFR = +(EV.DFR ?? 0.995), WK = +(EV.WK ?? 4), STG = +(EV.STG ?? 0), AO = +(EV.AO ?? 0.3), AOK = +(EV.AOK ?? 0.3), ROR = +(EV.ROR ?? 0.5), RO = +(EV.RO ?? 2.4), LBK = +(EV.LBK ?? 0.7), ROU = +(EV.ROU ?? 0.5), ROT = +(EV.ROT ?? 4.2), TWL = +(EV.TWL ?? 45), TWC = +(EV.TWC ?? 1.5), KD = +(EV.KD ?? 0.3), AD = +(EV.AD ?? 0.04), ADR = +(EV.ADR ?? 0.15), PSH = +(EV.PSH ?? 1), VK = +(EV.VK ?? 1), RELAX = 3.2, D2R = Math.PI / 180, H_SUB = 1 / 120, ITER = 7, GRAV = 9.81, MU = 0.85;
const hyp = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);
const sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// rotate v about unit axis a by angle (Rodrigues), into out
function rot(v, a, ang, out) {
  const c = Math.cos(ang), s = Math.sin(ang), d = (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) * (1 - c);
  const x = v[0] * c + (a[1] * v[2] - a[2] * v[1]) * s + a[0] * d, y = v[1] * c + (a[2] * v[0] - a[0] * v[2]) * s + a[1] * d, z = v[2] * c + (a[0] * v[1] - a[1] * v[0]) * s + a[2] * d;
  out[0] = x; out[1] = y; out[2] = z; return out;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class Doll {
  // pts: NP points [x, y, z] (the pose at this moment). env: { ground(x, z) -> height, wall(x, z, r, out{x,z}) -> bool (optional) }
  constructor(pts, env, seed = 1) {
    this.env = env; this.t = 0; this.asleep = false; this.still = 0; this.seed = (seed * 2654435761) >>> 0 || 7; this.onGround = 0; this.lain = 0;
    const p = (this.p = new Float64Array(NP * 3)), q = (this.q = new Float64Array(NP * 3)); this.w = new Float64Array(NP); this.r = new Float64Array(RAD); this.nacc = new Float64Array(NP);
    for (let i = 0; i < NP; i++) { p[i * 3] = q[i * 3] = pts[i][0]; p[i * 3 + 1] = q[i * 3 + 1] = pts[i][1]; p[i * 3 + 2] = q[i * 3 + 2] = pts[i][2]; this.w[i] = 1 / MASS[i]; }
    // the feet as they stand: a planted foot tells how high the ankle and the ball of the foot ride above the ground
    { let ra = 0.1, rt = 0.05; for (const [a, t] of [[I.FL, I.TL], [I.FR, I.TR]]) { const g = env.ground(pts[a][0], pts[a][2]); ra = Math.min(ra, pts[a][1] - g); rt = Math.min(rt, pts[t][1] - env.ground(pts[t][0], pts[t][2])); }
      this.r[I.FL] = this.r[I.FR] = Math.min(0.1, Math.max(0.055, ra)); this.r[I.TL] = this.r[I.TR] = Math.min(0.05, Math.max(0.025, rt)); }
    // nothing starts inside the ground
    for (let i = 0; i < NP; i++) { const g = env.ground(p[i * 3], p[i * 3 + 2]) + this.r[i]; if (p[i * 3 + 1] < g) this.r[i] = Math.max(0.02, p[i * 3 + 1] - env.ground(p[i * 3], p[i * 3 + 2])); }
    this.sticks = []; this.ranges = []; this.springs = []; this.tk = new Float64Array(NG); this.tT = new Float64Array(NG).fill(1e-3);
    const P = (i) => pts[i], D = (i, j) => len(sub(pts[i], pts[j]));
    const stick = (i, j) => this.sticks.push({ i, j, d: D(i, j) });
    // a one-sided limit; always wide enough to hold the pose the body starts in (so nothing snaps on the first step)
    const range = (i, j, lo, hi) => { const d = D(i, j); this.ranges.push({ i, j, lo: Math.min(lo, d), hi: Math.max(hi, d), cap: this._cap || 0.003 }); this._cap = 0; };      // (cap: how many metres a pass the limit takes up: the knee and elbow stops are firm, the rest give)
    const spring = (i, j, g) => { const s = { i, j, g, d0: D(i, j), d1: D(i, j), ta: 0.25, t0: 0, m: 1, dp: D(i, j), drag: 0 }; this.springs.push(s); return s; };
    // --- the trunk: two rigid blocks (ribcage with the shoulders; pelvis with the hip joints) on a lumbar stick
    const up = [I.N, I.C, I.CF, I.SL, I.SR], lo = [I.P, I.PF, I.HL, I.HR];
    for (let a = 0; a < up.length; a++) for (let b = a + 1; b < up.length; b++) stick(up[a], up[b]);
    for (let a = 0; a < lo.length; a++) for (let b = a + 1; b < lo.length; b++) stick(lo[a], lo[b]);
    stick(I.P, I.C); stick(I.N, I.H);
    for (const s of ['L', 'R']) { stick(I['S' + s], I['E' + s]); stick(I['E' + s], I['W' + s]); stick(I['W' + s], I['A' + s]); stick(I['H' + s], I['K' + s]); stick(I['K' + s], I['F' + s]); stick(I['F' + s], I['T' + s]); }
    // frames
    const pl = norm(sub(P(I.HL), P(I.HR))), pf0 = sub(P(I.PF), P(I.P)), pf = norm(sub(pf0, mul(pl, dot(pf0, pl)))), pu = cross(pf, pl);
    const cl = norm(sub(P(I.SL), P(I.SR))), cf0 = sub(P(I.CF), P(I.C)), cf = norm(sub(cf0, mul(cl, dot(cf0, cl)))), cu = cross(cf, cl);
    this.vol = [this.triple(I.P, I.HL, I.HR, I.PF) >= 0 ? 1 : -1, this.triple(I.C, I.SL, I.SR, I.CF) >= 0 ? 1 : -1];
    // each block also remembers its shape: every step it is put back to that shape exactly (best-fit turn of the remembered shape onto
    // where its points are). The pelvis' four points are nearly flat (the hip line and a point just above it): held by sticks alone it
    // was crushed flat by a hard fold of the trunk and then flicked back, which showed as a twitch of the hips on a body lying still
    this.blocks = [lo, up].map((idx) => { let cx = 0, cy = 0, cz = 0, M = 0; for (const i of idx) { cx += pts[i][0] * MASS[i]; cy += pts[i][1] * MASS[i]; cz += pts[i][2] * MASS[i]; M += MASS[i]; } cx /= M; cy /= M; cz /= M; return { idx, M, r: idx.map((i) => [pts[i][0] - cx, pts[i][1] - cy, pts[i][2] - cz]), q: [0, 0, 0, 1] }; });
    // sample a joint's allowed rotations and record how far apart pairs of points get: those extremes are the limit
    const sample = (pairs, place) => { const mm = pairs.map(() => [1e9, 0]); place((moved) => { pairs.forEach(([i, j], k) => { const a = moved[i] || P(i), b = moved[j] || P(j), d = len(sub(a, b)); if (d < mm[k][0]) mm[k][0] = d; if (d > mm[k][1]) mm[k][1] = d; }); }); pairs.forEach(([i, j], k) => range(i, j, mm[k][0], mm[k][1])); };
    // lumbar: the ribcage turns about the mid spine: flexion 50 forward / 22 back, 25 to either side, 35 of twist
    { const piv = P(I.C), t = [0, 0, 0], t2 = [0, 0, 0], t3 = [0, 0, 0];
      sample([[I.CF, I.PF], [I.SL, I.HL], [I.SR, I.HR], [I.SL, I.HR], [I.SR, I.HL], [I.N, I.PF]], (rec) => { for (const fx of [-22, 0, 25, 50, 62]) for (const lt of [-25, 0, 25]) for (const tw of [-35, 0, 35]) { const mv = {}; for (const i of up) { if (i === I.C) continue; const v = sub(P(i), piv); rot(v, cu, tw * D2R, t); rot(t, cf, lt * D2R, t2); rot(t2, cl, -fx * D2R, t3); mv[i] = add(piv, t3); } rec(mv); } }); }
    // neck: 50 forward / 40 back, 35 to the side, 55 of turn (a turn does not move the head's centre: tilt and nod only)
    { const piv = P(I.N), v = sub(P(I.H), piv), t = [0, 0, 0], t2 = [0, 0, 0];
      sample([[I.H, I.CF], [I.H, I.SL], [I.H, I.SR]], (rec) => { for (const fx of [-40, -15, 0, 25, 50]) for (const lt of [-35, 0, 35]) { rot(v, cf, lt * D2R, t); rot(t, cl, -fx * D2R, t2); rec({ [I.H]: add(piv, t2) }); } }); }
    // hips: thigh from 25 behind to 115 in front, 20 across to 50 out
    for (const s of ['L', 'R']) { const hj = P(I['H' + s]), L = D(I['H' + s], I['K' + s]), sg = s === 'L' ? 1 : -1, K = I['K' + s], oth = I['H' + (s === 'L' ? 'R' : 'L')];
      sample([[K, I.PF], [K, oth]], (rec) => { for (const fx of [-25, 0, 40, 80, 115, 122]) for (const ab of [-20, 0, 25, 50, 78]) { if (ab > 60 && fx < 30) continue; const a = fx * D2R, b = ab * D2R, dir = add(add(mul(pu, -Math.cos(a) * Math.cos(b)), mul(pf, Math.sin(a) * Math.cos(b))), mul(pl, Math.sin(b) * sg)); rec({ [K]: add(hj, mul(dir, L)) }); } }); }
    // knees, elbows: how far they fold; ankles and wrists: a cone about where they are
    const fold = (a, b, c, minDeg) => { const l1 = D(a, b), l2 = D(b, c); this._cap = 0.012; range(a, c, Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(minDeg * D2R)), (l1 + l2) * 0.9985); };
    const cone = (a, b, c, less, more) => { const l1 = D(a, b), l2 = D(b, c), d = D(a, c), th = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)))), f = (x) => Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(Math.max(0.05, Math.min(Math.PI, x)))); range(a, c, f(th - less * D2R), f(th + more * D2R)); };
    for (const s of ['L', 'R']) { fold(I['H' + s], I['K' + s], I['F' + s], KMIN); fold(I['S' + s], I['E' + s], I['W' + s], 32); cone(I['K' + s], I['F' + s], I['T' + s], 28, 38); cone(I['E' + s], I['W' + s], I['A' + s], 55, 55); }
    // the body does not pass through itself
    const apart = (i, j, d) => this.ranges.push({ i, j, lo: Math.min(d, D(i, j)), hi: 1e9 });
    apart(I.KL, I.KR, 0.14); apart(I.FL, I.FR, 0.11); apart(I.KL, I.FR, 0.12); apart(I.KR, I.FL, 0.12); apart(I.TL, I.TR, 0.08); apart(I.TL, I.FR, 0.09); apart(I.TR, I.FL, 0.09);
    for (const s of ['L', 'R']) { const o = s === 'L' ? 'R' : 'L';
      for (const h of [I['W' + s], I['A' + s]]) { apart(h, I.P, 0.17); apart(h, I.C, 0.17); apart(h, I.CF, 0.12); apart(h, I.PF, 0.12); apart(h, I.H, 0.14); apart(h, I.N, 0.1); apart(h, I.KL, 0.1); apart(h, I.KR, 0.1); apart(h, I['H' + s], 0.12); apart(h, I['H' + o], 0.12); }
      apart(I['E' + s], I.C, 0.19); apart(I['E' + s], I.CF, 0.15); apart(I['E' + s], I.P, 0.18); apart(I['E' + s], I['S' + o], 0.27); apart(I['E' + s], I.H, 0.15);
      apart(I['F' + s], I.P, 0.2); apart(I['F' + s], I['H' + s], 0.15); apart(I['F' + s], I['H' + o], 0.16); apart(I['K' + s], I.H, 0.2); apart(I['K' + s], I.CF, 0.16); apart(I['K' + s], I.C, 0.2); apart(I['F' + s], I.PF, 0.16); }
    // dead legs do not do the splits: the knees and the ankles only get so far apart
    this._cap = 0.008; range(I.KL, I.KR, 0, 0.6); this._cap = 0.008; range(I.FL, I.FR, 0, 1.0);
    // nor does a body fold shut like a book (chest onto its own thighs): trunk and thigh together stop at about a right angle
    { const sp = D(I.P, I.N), th = D(I.HL, I.KL), lo = Math.sqrt(sp * sp + th * th - 2 * sp * th * Math.cos(NF * D2R)); apart(I.N, I.KL, lo); apart(I.N, I.KR, lo); }
    apart(I.WL, I.WR, 0.07); apart(I.AL, I.AR, 0.06); apart(I.H, I.PF, 0.3);
    // --- tone: what the muscles were holding
    this.sp = {};
    for (const s of ['L', 'R']) { const g = s === 'L' ? G_LEGL : G_LEGR, o = s === 'L' ? 'R' : 'L', ga = s === 'L' ? G_ARML : G_ARMR;
      this.sp['knee' + s] = spring(I['H' + s], I['F' + s], g); this.sp['knee' + s].drag = 0.12;      // a dead shin does not whip up when the thigh lands
      this.sp['hipF' + s] = spring(I['K' + s], I.PF, g); this.sp['hipO' + s] = spring(I['K' + s], I['H' + o], g); this.sp['hipF' + s].m = 0.5; this.sp['hipO' + s].m = 0;      // (the cross-hip hold fights the knee hinge and makes feet pop: off) spring(I['K' + s], I['T' + s], g);
      this.sp['elbow' + s] = spring(I['S' + s], I['W' + s], ga); this.sp['armC' + s] = spring(I['E' + s], I.C, ga); this.sp['armF' + s] = spring(I['E' + s], I.CF, ga); this.sp['armO' + s] = spring(I['E' + s], I['S' + o], ga); spring(I['E' + s], I['A' + s], ga); }
    this.sp.curl = spring(I.CF, I.PF, G_SPINE); this.sp.sideL = spring(I.SL, I.HL, G_SPINE); this.sp.sideR = spring(I.SR, I.HR, G_SPINE); this.sp.diagL = spring(I.SL, I.HR, G_SPINE); this.sp.diagR = spring(I.SR, I.HL, G_SPINE);
    this.sp.nod = spring(I.H, I.CF, G_NECK); spring(I.H, I.SL, G_NECK); spring(I.H, I.SR, G_NECK);
    this.extra = [];      // short-lived pulls (a hand to the wound)
    this.legLen = { L: D(I.HL, I.KL) + D(I.KL, I.FL), R: D(I.HR, I.KR) + D(I.KR, I.FR) }; this.shin = { L: D(I.KL, I.FL), R: D(I.KR, I.FR) }; this.nk0 = D(I.N, I.PF); this.relT = 0;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  triple(o, a, b, c) { const p = this.p, ox = p[o * 3], oy = p[o * 3 + 1], oz = p[o * 3 + 2], ax = p[a * 3] - ox, ay = p[a * 3 + 1] - oy, az = p[a * 3 + 2] - oz, bx = p[b * 3] - ox, by = p[b * 3 + 1] - oy, bz = p[b * 3 + 2] - oz, cx = p[c * 3] - ox, cy = p[c * 3 + 1] - oy, cz = p[c * 3 + 2] - oz;
    return (ay * bz - az * by) * cx + (az * bx - ax * bz) * cy + (ax * by - ay * bx) * cz; }
  // velocities (m/s): every point gets (vx, vy, vz); vel may also be an array of NP [x, y, z] (the clip's own motion at the joints)
  setVel(vel) { const p = this.p, q = this.q; for (let i = 0; i < NP; i++) { const v = Array.isArray(vel[0]) ? vel[i] : vel; q[i * 3] = p[i * 3] - v[0] * H_SUB; q[i * 3 + 1] = p[i * 3 + 1] - v[1] * H_SUB; q[i * 3 + 2] = p[i * 3 + 2] - v[2] * H_SUB; } }
  addVel(i, vx, vy, vz) { const q = this.q; q[i * 3] -= vx * H_SUB; q[i * 3 + 1] -= vy * H_SUB; q[i * 3 + 2] -= vz * H_SUB; }
  nearest(x, y, z, only) { let b = 0, bd = 1e9; const p = this.p; for (let i = 0; i < NP; i++) { if (only && !only.includes(i)) continue; const d = Math.hypot(p[i * 3] - x, p[i * 3 + 1] - y, p[i * 3 + 2] - z); if (d < bd) { bd = d; b = i; } } return b; }
  // a blow at (x, y, z) along unit (dx, dy, dz): dv m/s to what is within rad of it (falling off), and `all` m/s to the whole body
  impulse(x, y, z, dx, dy, dz, dv, rad, all = 0) {
    const p = this.p;
    for (let i = 0; i < NP; i++) { const d = Math.hypot(p[i * 3] - x, p[i * 3 + 1] - y, p[i * 3 + 2] - z), k = dv * Math.max(0, 1 - d / rad) * Math.min(1, 3.2 * this.w[i] + 0.55) + all; if (k > 0) this.addVel(i, dx * k, dy * k, dz * k); }
  }
  // the reaction to a lethal hit. part: 'head' | 'body' | 'legs'; force: the weapon's (1 pistol, 2.4 shotgun, 5 a blast)
  hit(h) {
    const p = this.p, r = () => this.rnd(), force = h.force || 1, blast = force >= 4;
    let dx = h.dx, dy = h.dy, dz = h.dz; { const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
    const set = (g, k, T) => { this.tk[g] = k; this.tT[g] = T; };
    // which way the body faces, and the side the hit is on
    const fx = p[I.CF * 3] - p[I.C * 3], fz = p[I.CF * 3 + 2] - p[I.C * 3 + 2], fl = Math.hypot(fx, fz) || 1, front = -(dx * fx + dz * fz) / fl;      // > 0: shot from the front
    const lx = p[I.SL * 3] - p[I.SR * 3], lz = p[I.SL * 3 + 2] - p[I.SR * 3 + 2], left = (h.x - p[I.C * 3]) * lx + (h.z - p[I.C * 3 + 2]) * lz > 0;
    this.front = front; this.part = h.part;
    this.fast = blast || force > 1.8;
    if (blast) {
      set(G_LEGL, 0.03, 0.3); set(G_LEGR, 0.03, 0.35); set(G_SPINE, 0.15, 0.9); set(G_NECK, 0.25, 0.9); set(G_ARML, 0.04, 0.4); set(G_ARMR, 0.04, 0.4);
      // thrown: every point is pushed away from the seat of the blast (h.cx, h.cy, h.cz), the lower the harder (the blast is at the
      // ground: it takes the legs from under them), so the body
      // leaves the ground turning; no two are thrown alike
      const dv = 1.3 * force, cx = h.cx ?? h.x - dx * 3, cy = h.cy ?? 0.3, cz = h.cz ?? h.z - dz * 3;
      let dc = Math.hypot(p[I.P * 3] - cx, p[I.P * 3 + 2] - cz); const fall = Math.max(0.35, 1 - dc / 11);
      for (let i = 0; i < NP; i++) { let ex = p[i * 3] - cx, ey = p[i * 3 + 1] - cy + 0.5, ez = p[i * 3 + 2] - cz; const el = Math.hypot(ex, ey, ez) || 1, lowr = 1 - Math.min(1, Math.max(0, (p[i * 3 + 1] - cy) / 1.7)), k = dv * fall * (0.5 + 0.95 * lowr); this.addVel(i, (ex / el) * k + (r() - 0.5) * 1.2, (ey / el) * k + 1.6 * fall + (r() - 0.5), (ez / el) * k + (r() - 0.5) * 1.2); }
      return;
    }
    const dv = 1.25 * force, heavy = force > 1.8;
    // nothing drives the stride any more: the body drops where it is rather than carrying on at a walk
    // (and the swing of the stride's own leg and arms goes with it: left alone, that momentum spins a body with nothing holding it)
    { const q_ = this.q, keep = h.part === 'body' ? 0.3 : 0.62, rel = 0.3, P3 = I.P * 3, px = p[P3] - q_[P3], py = p[P3 + 1] - q_[P3 + 1], pz = p[P3 + 2] - q_[P3 + 2]; for (let i = 0; i < NP * 3; i += 3) { const vx = p[i] - q_[i], vy = p[i + 1] - q_[i + 1], vz = p[i + 2] - q_[i + 2]; q_[i] = p[i] - (px * keep + (vx - px) * rel); q_[i + 1] = p[i + 1] - (py + (vy - py) * rel); q_[i + 2] = p[i + 2] - (pz * keep + (vz - pz) * rel); } }
    // no two fall alike: a little turn about the body's own axis (shoulders one way, hips the other)
    { const tw = (r() - 0.5) * (h.part === 'body' ? 0.7 : 1.5), sx = lx / (Math.hypot(lx, lz) || 1), sz = lz / (Math.hypot(lx, lz) || 1), fwx = fx / fl, fwz = fz / fl; this.addVel(I.SL, fwx * tw, 0, fwz * tw); this.addVel(I.SR, -fwx * tw, 0, -fwz * tw); this.addVel(I.HL, -fwx * tw * 0.6, 0, -fwz * tw * 0.6); this.addVel(I.HR, fwx * tw * 0.6, 0, fwz * tw * 0.6); this.addVel(I.C, sx * tw * 0.4, 0, sz * tw * 0.4); }
    if (h.part === 'head') {
      // the lights go out. The head snaps with the bullet; for a third of a second the body is still standing as it was, rigid,
      // arms hanging; then both knees go together and it drops straight down, sits onto its heels and goes over the way the
      // bullet went (it does not fold up over its own knees)
      const hl = Math.hypot(dx, dz) || 1, bx = dx / hl, bz = dz / hl, tS = heavy ? 0.04 : 0.24 + r() * 0.16;
      for (let g = 0; g < NG; g++) set(g, 0, 1e-3); set(G_NECK, 0.12, 0.25); set(G_LEGL, 0.42, tS + 0.55); set(G_LEGR, 0.42, tS + 0.55); set(G_SPINE, 0.35, tS + 0.7); set(G_ARML, 0.03, 0.4); set(G_ARMR, 0.03, 0.4);
      for (const s of ['L', 'R']) { const k = this.sp['knee' + s]; k.d1 = k.d0 * (0.56 + r() * 0.1); k.t0 = tS + (s === 'L' ? 0 : (r() - 0.5) * 0.1); k.ta = 0.28 + r() * 0.06; this.sp['hipF' + s].m = 1; (this.plant ||= {})[s] = k.t0 + k.ta * PL; }
      this.impulse(h.x, h.y, h.z, dx, dy * 0.4, dz, dv * 1.0, 0.3, heavy ? dv * 0.3 : 0);
      { const sgn = r() < 0.5 ? 1 : -1, ll = Math.hypot(lx, lz) || 1, k = sgn * (0.15 + r() * 0.2); for (const i of [I.P, I.PF, I.HL, I.HR]) this.addVel(i, (lx / ll) * k + bx * 0.15, 0, (lz / ll) * k + bz * 0.15); for (const i of [I.SL, I.SR, I.C, I.CF, I.N]) this.addVel(i, bx * 0.45, 0, bz * 0.45); }
      this.arch = { bx, bz, l0: (p[I.N * 3] - p[I.P * 3]) * bx + (p[I.N * 3 + 2] - p[I.P * 3 + 2]) * bz, L: 0.16 + r() * 0.08, T: tS + 0.6 }; this.push = { bx, bz, a: 2.5 + r() * 1.5, l0: this.lean(bx, bz), until: 0.25 }; this.noSpin = 0.7;
      this.unlock(0.01 + r() * 0.01, 0.01 + r() * 0.01);
      return;
    }
    if (h.part === 'legs') {
      // the leg that was hit is knocked from under them along the bullet and gives way at once; the other carries for a moment and
      // folds; the trunk, still held, goes down over the lost leg: forward when the leg went back, and to that side
      const s = this.nearest(h.x, h.y, h.z, [I.KL, I.KR, I.FL, I.FR]) % 2 === 0 ? 'L' : 'R', o = s === 'L' ? 'R' : 'L', hl = Math.hypot(dx, dz) || 1, bx = dx / hl, bz = dz / hl, ll = Math.hypot(lx, lz) || 1, sd = s === 'L' ? 1 : -1;
      set(s === 'L' ? G_LEGL : G_LEGR, 0.12, 0.5); set(o === 'L' ? G_LEGL : G_LEGR, 0.45, 0.8 + r() * 0.2); set(G_SPINE, 0.4, 1.0); set(G_NECK, 0.4, 1.0); set(G_ARML, 0.25, 0.8); set(G_ARMR, 0.25, 0.8);
      { const ks = this.sp['knee' + s], ko = this.sp['knee' + o]; ks.d1 = ks.d0 * 0.6; ks.ta = 0.18; ko.d1 = ko.d0 * (0.6 + r() * 0.12); ko.t0 = 0.22 + r() * 0.15; ko.ta = 0.35; this.plant = { [o]: ko.t0 + ko.ta * PL }; }
      for (const a of ['L', 'R']) { this.sp['armC' + a].d1 = this.sp['armC' + a].d0 * (1.35 + r() * 0.3); this.sp['armC' + a].ta = 0.2 + r() * 0.1; this.sp['armF' + a].d1 = this.sp['armF' + a].d0 * 1.3; this.sp['armF' + a].ta = 0.3; this.sp['elbow' + a].d1 = this.sp['elbow' + a].d0 * 1.1; }
      this.impulse(h.x, h.y, h.z, dx, dy, dz, dv * 1.2, 0.4, 0);
      { const k = 2.6 + r() * 0.8; for (const i of [I['K' + s], I['F' + s], I['T' + s]]) this.addVel(i, bx * k * (i === I['K' + s] ? 0.6 : 1), i === I['K' + s] ? 0 : 0.9, bz * k * (i === I['K' + s] ? 0.6 : 1)); }
      { const V = 0.45 + r() * 0.3, S = 0.35 + r() * 0.35, g0 = Math.min(p[I.FL * 3 + 1], p[I.FR * 3 + 1]); for (const i of [I.H, I.N, I.C, I.CF, I.SL, I.SR, I.P, I.PF, I.HL, I.HR]) { const k = Math.max(0, (p[i * 3 + 1] - g0) / 1.3); this.addVel(i, (-bx * V + (lx / ll) * sd * S) * k, 0, (-bz * V + (lz / ll) * sd * S) * k); } }
      this.unlock(s === 'L' ? 0.05 : 0.015, s === 'R' ? 0.05 : 0.015);
      return;
    }
    // the body. The bullet decides everything: the trunk is rocked the way the bullet travels, about the feet, while the legs still
    // carry for a quarter of a second (arms thrown out, head left behind); then the knees give, one before the other, with the hips
    // still half held, so the body goes down and over the way it was rocked: onto its back from a shot in the front, onto its face
    // from a shot in the back, onto its side from the side. Heavy (a shotgun): no standing phase, it is thrown.
    const hl = Math.hypot(dx, dz) || 1, bx = dx / hl, bz = dz / hl, q_ = this.q;
    // what was left of the stride against the bullet is gone
    for (let i = 0; i < NP; i++) { const k = i * 3, vb = ((p[k] - q_[k]) * bx + (p[k + 2] - q_[k + 2]) * bz); if (vb < 0) { q_[k] += vb * bx; q_[k + 2] += vb * bz; } }
    // what the body was doing when it was struck decides how it goes down (not fixed numbers): where each foot is along the bullet's
    // way and whether it is carrying weight, and how far the centre of mass has to travel before it is past its support
    const fb = (i) => p[i * 3] * bx + p[i * 3 + 2] * bz, gnd = (i) => p[i * 3 + 1] - this.env.ground(p[i * 3], p[i * 3 + 2]) - this.r[i];
    let comB = 0, comM = 0; for (let i = 0; i < NP; i++) { comB += fb(i) * MASS[i]; comM += MASS[i]; } comB /= comM;
    const sL = fb(I.FL), sR = fb(I.FR), aL = gnd(I.FL), aR = gnd(I.FR), airL = aL > 0.045 && aL > aR + 0.02, airR = aR > 0.045 && aR > aL + 0.02;
    const sup = Math.max(airL ? -1e9 : sL, airR ? -1e9 : sR), gap = Math.max(-0.1, Math.min(0.5, sup + 0.08 - comB));
    // the leg on the far side of the bullet gives first (the body goes down over it, the way it was hit); feet level: the one not carrying
    // a step that does not save them: the foot that is not carrying (or the one nearer the gun) is thrown out the bullet's way to catch
    // the weight; it lands, takes the weight and that knee gives. From the side it is the far foot that goes out. Not everyone gets one in
    const sideOn = Math.abs(front) < 0.5, stepS = heavy ? null : airL ? 'L' : airR ? 'R' : r() > STEP ? null : (sideOn ? sL > sR : sL < sR) ? 'L' : 'R';
    let stp = null;
    if (stepS) { const ss = stepS === 'L' ? sL : sR, so = stepS === 'L' ? sR : sL, Ls = Math.max(0.13 + r() * 0.1, Math.min(0.42, comB + SO + r() * 0.15 - ss)), s0 = 0.05 + r() * 0.07; const sT = 0.2 + Ls * 0.28 + r() * 0.05; stp = this.stp = { s: stepS, bx, bz, L: Ls, t0: s0, T: sT, lift: LF + r() * 0.04, fw: SO + r() * 0.12 + SF * sT }; }
    const first = stepS ? stepS === 'L' : Math.abs(sL - sR) > 0.06 ? sL > sR : airL ? true : airR ? false : r() < 0.5, goS = first ? 'L' : 'R', stS = first ? 'R' : 'L', stAir = first ? airR : airL;
    const wf = Math.max(0, Math.min(1, (front - 0.15) / 0.5)), tS = heavy ? 0.03 : (stp ? stp.t0 + stp.T * 0.75 + 0.1 * wf : 0.05 + TS * wf + r() * 0.08) + STG, T = heavy ? 0.5 : 1.0 + r() * 0.2 + 0.15 * wf;      // wf: how much this is a shot in the front (the body sits back and goes over; from behind it is thrown onto its knees and face) this.st = { gap, first, airL, airR };
    set(G_LEGL, heavy ? 0.2 : 0.4, T); set(G_LEGR, heavy ? 0.2 : 0.4, T); set(G_SPINE, heavy ? 0.4 : 0.26, heavy ? 0.6 : 0.8 + r() * 0.2); set(G_NECK, 0.14, 0.5 + r() * 0.2); set(G_ARML, heavy ? 0.12 : 0.16, 0.45 + r() * 0.2); set(G_ARMR, heavy ? 0.12 : 0.16, 0.45 + r() * 0.2);
    { const go = this.sp['knee' + goS], stay = this.sp['knee' + stS]; go.d1 = go.d0 * (0.6 + r() * 0.1); go.t0 = tS * (1 - 0.4 * wf); go.ta = heavy ? 0.3 : KA * (0.7 + 0.3 * wf) + r() * 0.1 + KT * wf; stay.d1 = stay.d0 * (0.7 + r() * 0.12); stay.t0 = tS + (stAir ? 0.04 : (0.1 + r() * 0.12 + Math.max(0, gap) * 0.35) * (1 - wf) + (-0.4 * tS + r() * ST) * wf); stay.ta = heavy ? 0.34 : KB * (0.7 + 0.3 * wf) + KT * wf;
      go.end = go.t0 + go.ta; stay.end = stay.t0 + stay.ta; go.give = stay.give = true; if (!heavy) this.plant = { [goS]: go.t0 + go.ta * PL, [stS]: stay.t0 + stay.ta * PL };      // a knee that has given holds nothing: left as a strut at its folded length it pushed the foot away and the legs did the splits
      // (from the front the hips fold with the knees: the body sits back instead of kneeling)
      for (const s of ['L', 'R']) { const hf = this.sp['hipF' + s]; hf.m = 0.45 + 0.2 * wf; if (!heavy) { hf.d1 = hf.d0 * (1 + HF * wf); hf.ta = 0.3; hf.t0 = tS * 0.5; if (wf > 0.3) { hf.d2 = hf.d0 * (1 + H2 * wf); hf.t2 = tS * 0.5 + T2 + r() * 0.08; } } }
      // a foot that was in the air on the gun's side comes down the bullet's way: the half step of someone knocked off their stride
      if (!heavy && stAir) { const k = HS * (0.6 + r() * 0.4); this.addVel(I['F' + stS], bx * k, 0, bz * k); this.addVel(I['T' + stS], bx * k, 0, bz * k); this.addVel(I['K' + stS], bx * k * 0.6, 0, bz * k * 0.6); } }
    // the chest is opened by a shot in the front and thrown out by one in the back: the spine arches either way, it does not curl
    this.sp.curl.d1 = this.sp.curl.d0 * (front > 0.2 ? 1.06 : front < -0.2 ? 1.07 : 1.0); this.sp.curl.ta = 0.1;
    // the trunk is wrenched round by the hit (the struck side goes with the bullet)
    { const a = this.sp[left ? 'diagL' : 'diagR'], b = this.sp[left ? 'diagR' : 'diagL'], sg = front >= 0 ? 1 : -1; a.d1 = a.d0 * (1 + 0.04 * sg); b.d1 = b.d0 * (1 - 0.04 * sg); a.ta = b.ta = 0.09; }
    if (Math.abs(front) < 0.5) { const sd = this.sp[left ? 'sideR' : 'sideL']; sd.d1 = sd.d0 * 0.9; sd.ta = 0.15; }
    this.sp.nod.d1 = this.sp.nod.d0 * (front > 0.2 ? 0.82 : 1.06); this.sp.nod.ta = 0.1;
    // the arms are not posed: the struck side's is flung by the blow (it has been thrown with the shoulder), the other only lags
    // behind the trunk and drops; neither is held
    { const s = left ? 'L' : 'R', o = left ? 'R' : 'L', ar = this.sp['armC' + s], el = this.sp['elbow' + s], ar2 = this.sp['armC' + o], el2 = this.sp['elbow' + o], ll = Math.hypot(lx, lz) || 1, ox = (lx / ll) * (left ? -1 : 1), oz = (lz / ll) * (left ? -1 : 1);
      ar.d1 = ar.d0 * (1.0 + r() * 0.1); ar.ta = 0.09; el.d1 = el.d0 * (0.97 + r() * 0.12); el.ta = 0.14; ar2.d1 = ar2.d0 * (1.0 + r() * 0.12); ar2.ta = 0.25 + r() * 0.1; ar2.t0 = 0.12 + r() * 0.15; el2.d1 = el2.d0 * (0.95 + r() * 0.15); el2.ta = 0.25;
      this.tT[s === 'L' ? G_ARML : G_ARMR] = 0.24 + r() * 0.14; this.tT[o === 'L' ? G_ARML : G_ARMR] = 0.3 + r() * 0.3;
      if (AO) { const a1 = this.sp['armO' + s], a2 = this.sp['armO' + o]; a1.d1 = a1.d0 * (1 + AO * (0.7 + r() * 0.6)); a1.ta = 0.1 + r() * 0.05; a2.d1 = a2.d0 * (1 + AO * (0.3 + r() * 0.7)); a2.ta = 0.16 + r() * 0.1; a2.t0 = 0.05 + r() * 0.1; this.tk[G_ARML] = this.tk[G_ARMR] = AOK; this.tT[s === 'L' ? G_ARML : G_ARMR] = 0.42 + r() * 0.15; this.tT[o === 'L' ? G_ARML : G_ARMR] = 0.5 + r() * 0.25; }
      const k = (heavy ? 2.2 : 2.2) + r() * 1.2; { const ko = (1.4 + r() * 1.6) * AU, ku = (0.5 + r() * 1.3) * AU; this.addVel(I['W' + s], -dx * 0.9 - ox * ko, ku, -dz * 0.9 - oz * ko); this.addVel(I['A' + s], -dx * 0.9 - ox * ko, ku, -dz * 0.9 - oz * ko); this.addVel(I['E' + s], dx * k * 0.3 - ox * ko * 0.5, ku * 0.45, dz * k * 0.3 - oz * ko * 0.5); }
      const k2 = (0.7 + r() * 1.3) * AU, ku2 = (0.4 + r() * 1.5) * AU; this.addVel(I['W' + o], ox * k2 - dx * 0.5, ku2, oz * k2 - dz * 0.5); this.addVel(I['A' + o], ox * k2 - dx * 0.5, ku2, oz * k2 - dz * 0.5); this.addVel(I['E' + o], ox * k2 * 0.5, 0, oz * k2 * 0.5); }
    if (!heavy && front > -0.3 && r() < 0) {      // then, as they go down, a hand to the wound
      const tgt = this.nearest(h.x, h.y, h.z, [I.CF, I.PF, I.C, I.P, I.SL, I.SR]), s = left ? 'L' : 'R'; this.extra.push({ i: I['W' + s], j: tgt, d: 0.13, k: 0.06, t0: 0.4 + r() * 0.15, t1: 1.3 + r() * 0.4 }); }
    // the blow itself, where it lands
    this.impulse(h.x, h.y, h.z, dx, dy, dz, heavy ? dv : dv * IM, heavy ? 0.7 : 0.34, heavy ? dv * 0.38 : 0);
    // and the legs give a little under it at once: the figure sags as it is struck
    if (!heavy && SAG) for (const i of SIT) this.addVel(i, 0, -SAG * (0.7 + r() * 0.6), 0);
    // knocked off balance: the trunk is carried the bullet's way, the more the further its weight has to go to be past its feet (so
    // the body always ends up going over that way, whatever the stride was doing); the feet stay
    { const V = heavy ? 1.15 * Math.sqrt(force) : (0.55 + gap * 1.6 + r() * 0.15) * Math.sqrt(force) * VK, g0 = Math.min(p[I.FL * 3 + 1], p[I.FR * 3 + 1]); for (let i = 0; i < NP; i++) { const u = Math.max(0, Math.min(1.25, (p[i * 3 + 1] - g0) / 1.3)), back = u < 0.72 ? u / 0.72 : 1 - 0.3 * Math.min(1, (u - 0.72) / 0.4), k = (heavy ? u : u * u * 1.15 * (1 - wf) + u * u * u * VF * wf) * V; this.addVel(i, bx * k, heavy ? 0.5 * k : 0, bz * k); } }
    // from the front the trunk is thrown back about the hips (the shoulders fastest, the hips not at all): with the knees already going
    // it goes over backward onto its back, instead of sinking upright onto its heels and curling up
    if (!heavy && wf > 0) { const yP = p[I.P * 3 + 1], K = (TB + r() * 0.4) * (1 - 0.8 * Math.max(0, gap)) * Math.sqrt(force) * wf; this.thr = { bx, bz, K, t0: tS * 0.6, dur: 0.22 }; this.stand = tS * 0.6 * wf; }
    if (stp) { this.stand = stp.t0 + stp.T + STG; this.standV = SV + r() * 0.3; this.sbx = bx; this.sbz = bz; }      // (it comes as the knees start to go, not at the hit: thrown at once, the body toppled like a plank in 0.6 s with no stagger)
    // the moment of the hit, readable: the struck shoulder is thrown back and the other comes round, the head is left behind
    { const hs = left ? I.SL : I.SR, os = left ? I.SR : I.SL, k = Math.min(3.6, (heavy ? 1.3 : JK) * force), kh = Math.min(2.6, k * 1.2); this.addVel(hs, dx * k, 0, dz * k); this.addVel(os, -dx * k * 0.45, 0, -dz * k * 0.45); this.addVel(I.H, -dx * kh, -0.3, -dz * kh); }
    // and it keeps going over that way: until the trunk is well off balance it is carried on (nothing in the legs can bring it back)
    if (!heavy) this.arch = { bx, bz, l0: (p[I.N * 3] - p[I.P * 3]) * bx + (p[I.N * 3 + 2] - p[I.P * 3 + 2]) * bz, L: (AR + r() * 0.1) * (1 - (1 - AL) * wf), T: AT + r() * 0.15 };
    if (!heavy) this.noSpin = 0.6;
    if (!heavy) this.push = { bx, bz, a: (3 + r() * 1.5) * PSH, l0: this.lean(bx, bz), until: Math.max(0.12, gap + 0.1), wf, sup, t0: 0.16 * (1 - wf) + tS * 0.6 * wf };
    this.unlock(0.012 + r() * 0.02, 0.012 + r() * 0.02);
  }
  lean(bx, bz) { const p = this.p; return ((p[I.N * 3] + p[I.P * 3]) / 2 - (p[I.FL * 3] + p[I.FR * 3]) / 2) * bx + ((p[I.N * 3 + 2] + p[I.P * 3 + 2]) / 2 - (p[I.FL * 3 + 2] + p[I.FR * 3 + 2]) / 2) * bz; }
  // a locked knee does not buckle: break both a touch (forward, by the given metres)
  unlock(l, r_) {
    const p = this.p;
    for (const [s, d] of [['L', l], ['R', r_]]) { const b = this.kneeBack(I['H' + s], I['K' + s]); if (!b) continue; const k = I['K' + s] * 3; p[k] -= b[0] * d; p[k + 1] -= b[1] * d; p[k + 2] -= b[2] * d; }
  }
  // the direction the shin may fold toward (the back of the knee), from the pelvis' own left and the thigh; null when undefined
  kneeBack(hip, kn) {
    const p = this.p; let ax = p[I.HL * 3] - p[I.HR * 3], ay = p[I.HL * 3 + 1] - p[I.HR * 3 + 1], az = p[I.HL * 3 + 2] - p[I.HR * 3 + 2];
    let tx = p[kn * 3] - p[hip * 3], ty = p[kn * 3 + 1] - p[hip * 3 + 1], tz = p[kn * 3 + 2] - p[hip * 3 + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const d = ax * tx + ay * ty + az * tz; ax -= tx * d; ay -= ty * d; az -= tz * d; const al = Math.hypot(ax, ay, az); if (al < 0.03) return null; ax /= al; ay /= al; az /= al;
    this._ax = ax; this._ay = ay; this._az = az;
    return [ay * tz - az * ty, az * tx - ax * tz, ax * ty - ay * tx];
  }
  step(dt) {
    if (this.asleep) return; const n = Math.max(1, Math.round(dt / H_SUB));
    for (let s = 0; s < n; s++) this.sub();
    // nothing dead stays sitting up or squatting on its heels: a trunk that has come to a stop off the ground is tipped over
    { const p_ = this.p, q_ = this.q, c = I.C * 3, up = p_[c + 1] - this.env.ground(p_[c], p_[c + 2]), v = Math.hypot(p_[c] - q_[c], p_[c + 1] - q_[c + 1], p_[c + 2] - q_[c + 2]) / H_SUB;
      const pu = p_[I.P * 3 + 1] - this.env.ground(p_[I.P * 3], p_[I.P * 3 + 2]), nu = p_[I.N * 3 + 1] - this.env.ground(p_[I.N * 3], p_[I.N * 3 + 2]);
      const butt = pu > 0.25 && nu < 0.36, vp = Math.hypot(p_[I.P * 3] - q_[I.P * 3], p_[I.P * 3 + 1] - q_[I.P * 3 + 1], p_[I.P * 3 + 2] - q_[I.P * 3 + 2]) / H_SUB;
      if (butt && this.t > 0.8 && vp < 0.35 && this.t > (this.tipT || 0)) { this.nRule = (this.nRule || 0) + 1; this.rA = (this.rA || 0) + 1; this.tipT = this.t + 0.45; this.loose = this.t + 0.3; let ax = p_[I.HL * 3] - p_[I.HR * 3], az = p_[I.HL * 3 + 2] - p_[I.HR * 3 + 2]; const al = Math.hypot(ax, az) || 1, sg = this.rnd() < 0.5 ? 2.6 : -2.6; ax = ax / al * sg * 0.4; az = az / al * sg * 0.4; for (const i of [I.P, I.PF, I.HL, I.HR, I.KL, I.KR]) this.addVel(i, ax, 0, az);
        // (a body draped over its own knees with the hips in the air: the legs slide out from under it, away from the head)
        let lx = p_[I.P * 3] - p_[I.N * 3], lz = p_[I.P * 3 + 2] - p_[I.N * 3 + 2]; const ll = Math.hypot(lx, lz) || 1; lx = lx / ll * 2.8; lz = lz / ll * 2.8; for (const i of [I.KL, I.KR, I.FL, I.FR, I.TL, I.TR]) this.addVel(i, lx, 0.25, lz); for (const i of [I.P, I.PF, I.HL, I.HR]) this.addVel(i, lx * 0.3, -0.6, lz * 0.3); this.still = 0; }
      else if (this.t > 0.8 && (up > 0.4 || (pu > 0.22 && nu > 0.36)) && v < 0.6 && this.t > (this.tipT || 0)) { this.nRule = (this.nRule || 0) + 1; this.rB = (this.rB || 0) + 1; this.tipT = this.t + 0.35; let ex = p_[c] - (p_[I.FL * 3] + p_[I.FR * 3]) / 2, ez = p_[c + 2] - (p_[I.FL * 3 + 2] + p_[I.FR * 3 + 2]) / 2; const el = Math.hypot(ex, ez); { const lx = p_[I.N * 3] - p_[I.P * 3], lz = p_[I.N * 3 + 2] - p_[I.P * 3 + 2], ll = Math.hypot(lx, lz); if (ll > 0.12) { ex = lx / ll; ez = lz / ll; } else if (this.push) { ex = this.push.bx; ez = this.push.bz; } else
        if (el < 0.08) { const a = this.rnd() * 6.283; ex = Math.cos(a); ez = Math.sin(a); } else { ex /= el; ez /= el; } }      // sat up: it goes over the way it already leans
        for (const i of [I.C, I.CF, I.N, I.H, I.SL, I.SR]) this.addVel(i, ex * 1.1, 0, ez * 1.1); this.still = 0; } }
    // nor propped half up on its elbows: hips down but the shoulders still well off the ground and nothing moving: it lies back
    { const p_ = this.p, q_ = this.q, n = I.N * 3, P = I.P * 3, nu = p_[n + 1] - this.env.ground(p_[n], p_[n + 2]), pu = p_[P + 1] - this.env.ground(p_[P], p_[P + 2]), v = Math.hypot(p_[n] - q_[n], p_[n + 1] - q_[n + 1], p_[n + 2] - q_[n + 2]) / H_SUB;
      if (this.t > 1 && nu > 0.3 && pu < 0.24 && v < 0.4 && this.t > (this.tipT || 0)) { this.nRule = (this.nRule || 0) + 1; this.rC = (this.rC || 0) + 1; this.tipT = this.t + 0.4; this.loose = this.t + 0.25; let ex = p_[n] - p_[P], ez = p_[n + 2] - p_[P + 2]; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el; for (const i of [I.C, I.CF, I.N, I.H, I.SL, I.SR]) this.addVel(i, ex * 1.6, -0.5, ez * 1.6); for (const i of [I.EL, I.ER, I.WL, I.WR]) { const ox = p_[i * 3] - p_[I.C * 3], oz = p_[i * 3 + 2] - p_[I.C * 3 + 2], ol = Math.hypot(ox, oz) || 1; this.addVel(i, (ox / ol) * 1.8, 0, (oz / ol) * 1.8); } this.still = 0; } }
    // nor do its knees stay standing up once it lies there: a raised knee with nothing holding it falls outward
    if (this.t > 0.9 && !this.aft) { const p_ = this.p, q_ = this.q, pu = p_[I.P * 3 + 1] - this.env.ground(p_[I.P * 3], p_[I.P * 3 + 2]); if (pu < 0.24) for (const [k, f, sg] of [[I.KL, I.FL, 1], [I.KR, I.FR, -1]]) {
      const ku = p_[k * 3 + 1] - this.env.ground(p_[k * 3], p_[k * 3 + 2]), kv = Math.hypot(p_[k * 3] - q_[k * 3], p_[k * 3 + 1] - q_[k * 3 + 1], p_[k * 3 + 2] - q_[k * 3 + 2]) / H_SUB; if (ku < 0.27 || kv > 0.3) continue; this.nRule = (this.nRule || 0) + 0.02;
      let ax = p_[I.HL * 3] - p_[I.HR * 3], az = p_[I.HL * 3 + 2] - p_[I.HR * 3 + 2]; const al = Math.hypot(ax, az) || 1, kk = sg * 0.9 / al; this.addVel(k, ax * kk, -0.2, az * kk); this.addVel(f, -ax * kk * 0.4, 0, -az * kk * 0.4); this.still = 0; } }
    // rest: nothing moving faster than a few centimetres a second for half a second
    const p = this.p, q = this.q; let m = 0, mh = 0; for (let i = 0; i < NP * 3; i++) { const v = Math.abs(p[i] - q[i]); if (v > m) m = v; if (v > mh && HEAVY[(i / 3) | 0]) mh = v; }
    { const lowC = p[I.C * 3 + 1] - this.env.ground(p[I.C * 3], p[I.C * 3 + 2]) < 0.38, lowP = p[I.P * 3 + 1] - this.env.ground(p[I.P * 3], p[I.P * 3 + 2]) < 0.38; if (this.onGround > 5 && lowC && lowP) this.lain += dt; else if (!(lowC && lowP)) this.lain = Math.max(0, this.lain - dt * 2); }      // lain: seconds the trunk has been down (kneeling does not count)
    // (a body still propped off the ground is not at rest, however still: the rules above get their chance first)
    const gy_ = (i) => p[i * 3 + 1] - this.env.ground(p[i * 3], p[i * 3 + 2]), propped = this.t < 7 && (gy_(I.P) > 0.26 || gy_(I.N) > 0.4 || gy_(I.KL) > 0.42 || gy_(I.KR) > 0.42);
    if (propped && this.t > 2.4) this.noWall = true;      // wedged upright among chairs or against a post: it stops being held up by them
    const settling = propped;
    if (settling) this.still = 0; else if (mh < 0.05 * H_SUB * (this.t > 4 ? 3 : 1) && m < 0.3 * H_SUB && this.t > 0.7) { this.still += dt; if (this.still > 0.45) this.sleep(); } else this.still = 0;
    if (this.t > 3 && !settling && m < 0.4 * H_SUB) { this.slow = (this.slow || 0) + dt; if (this.slow > 1.2) this.sleep(); } else this.slow = 0;
    if (this.lain > 3.4 && !propped) this.sleep();      // settled by its own motion, then still
    if (this.t > 14) this.sleep();
  }
  sleep() { this.asleep = true; this.q.set(this.p); }
  // a body that is down is struck again: it wakes and takes the blow where it lands
  nudge(x, y, z, dx, dy, dz, dv = 1.4) { this.asleep = false; this.still = 0; this.slow = 0; if (this.t > 3) this.t = 3; this.lain = Math.min(this.lain, 0.9); this.impulse(x, y, z, dx, dy, dz, dv, 0.26, 0); }
  sub() {
    const p = this.p, q = this.q, w = this.w, R = this.r, env = this.env, h = H_SUB, t = (this.t += h), nacc = this.nacc, gc = this.gc || (this.gc = new Float64Array(NP));
    // how settled the body is: the more of it lies on the ground, the more its motion is soaked up (flesh on pavement does not ring)
    const damp = t < (this.loose || 0) ? 0.996 : this.onGround > 5 ? 0.985 - Math.min(0.1, this.lain * GD) : this.onGround > 2 ? 0.988 : 0.9985, gy = GRAV * h * h;
    const calm = this.lain > 0.25 ? Math.max(0.04, 7.5 * Math.exp(-(this.lain - 0.3) * CR)) : 7.5;      // once it lies there, what is left of its motion can only die away: nothing starts up again at speed
    const vmax = (this.t < 1.2 && this.fast ? 16 : calm) * h;      // nothing on a body whips faster than this
    const low = !this.fast && p[I.P * 3 + 1] - env.ground(p[I.P * 3], p[I.P * 3 + 2]) < 0.45, vup = 1.1 * h;      // once the hips are down the legs do not fly up after them
    // once the body is down a leg coming out from under it slides out; it does not whip
    const legCap = !this.fast && this.tLow !== undefined && t > this.tLow + 0.12 ? LCAP * h : 0;
    const slowT = this.aft && this.lain > 0 && !this.fast;      // once the trunk is down a knee still standing or an arm still in the air sinks, it does not drop: there is flesh on it
    for (let i = 0; i < NP; i++) { const k = i * 3; let dm = damp < 0.99 && FREE[i] ? DFR : damp; if (slowT && (KNEE[i] ? KD : ARM[i] ? AD : 0) && p[k + 1] - gc[i] - R[i] > 0.05) dm = Math.min(dm, 1 - (KNEE[i] ? KD : AD)); let vx = (p[k] - q[k]) * dm, vy = (p[k + 1] - q[k + 1]) * (dm > 0.99 ? 0.9995 : dm), vz = (p[k + 2] - q[k + 2]) * dm; if (low && LEG[i] && vy > vup) vy = vup; { const lim = legCap && LEG[i] ? Math.min(vmax, legCap) : LIGHT[i] ? vmax * 0.75 : vmax, v2 = vx * vx + vy * vy + vz * vz; if (v2 > lim * lim) { const c = lim / Math.sqrt(v2); vx *= c; vy *= c; vz *= c; } } q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2]; p[k] += vx; p[k + 1] += vy - gy; p[k + 2] += vz; nacc[i] = 0; gc[i] = env.ground(p[k], p[k + 2]); }
    // the pelvis' own pitch is a light, loosely held thing in this skeleton (its front point swings about the hip line): left free it
    // flicks over when a hip stop engages on a body lying still; its turning relative to the pelvis is soaked up, hard once down
    { const k = this.onGround > 5 ? 0.3 : 0.06, a = I.PF * 3, b = I.P * 3; for (let c = 0; c < 3; c++) { const vp = p[b + c] - q[b + c], vf = p[a + c] - q[a + c]; p[a + c] -= (vf - vp) * k; } }
    // still on its feet for a moment: the legs take the knock (the trunk's drift over the feet is bled off into the ground) while the
    // chest, head and arms show it; then the knees go
    if (this.stand && t < this.stand) { let vx = 0, vz = 0, M = 0; for (const i of STS) { const m = MASS[i]; vx += (p[i * 3] - q[i * 3]) * m; vz += (p[i * 3 + 2] - q[i * 3 + 2]) * m; M += m; } { const sv = (this.standV || 0) * h; vx = (vx / M - (this.sbx || 0) * sv) * 0.07; vz = (vz / M - (this.sbz || 0) * sv) * 0.07; } for (const i of STS) { p[i * 3] -= vx; p[i * 3 + 2] -= vz; } }
    if (this.thr && t > this.thr.t0 && t < this.thr.t0 + this.thr.dur) { const T = this.thr, yP = p[I.P * 3 + 1], dv = T.K * h * (h / T.dur); for (const i of THROW) { const k = dv * Math.max(0, Math.min(1.2, (p[i * 3 + 1] - yP) / 0.5)); p[i * 3] += T.bx * k; p[i * 3 + 2] += T.bz * k; } }
    if (this.push && t < 0.9) { const P = this.push;
      if (this.lean(P.bx, P.bz) - P.l0 < P.until && p[I.C * 3 + 1] - gc[I.C] > 0.55) { const a = P.a * h * h * sm((t - (P.t0 ?? 0.16)) / 0.14); for (const i of PUSH) { const k = i === I.P || i === I.PF ? 0.45 : 1; p[i * 3] += P.bx * a * k; p[i * 3 + 2] += P.bz * a * k; } }
      // from the front the hips are carried back out from over the feet while the knees give (the whole trunk with them, so it does
      // not pitch): the body sits down behind its heels and goes onto its back with the legs in front of it, not folded under it
      if (P.wf > 0 && t > P.t0 && p[I.P * 3 + 1] - gc[I.P] > 0.3) { const far = p[I.P * 3] * P.bx + p[I.P * 3 + 2] * P.bz - P.sup; if (far < SB) { const a = PA * P.wf * h * h * sm((t - P.t0) / 0.12) * Math.min(1, (SB - far) / 0.1); for (const i of SIT) { p[i * 3] += P.bx * a; p[i * 3 + 2] += P.bz * a; } } } }
    // while there is anything left in the legs the trunk is not free to spin about its own axis (the feet steer it): its turning is bled off
    if (this.noSpin && t < this.noSpin) { let cx = 0, cz = 0, vx = 0, vz = 0, M = 0; for (const i of PUSH) { const m = MASS[i], k = i * 3; cx += p[k] * m; cz += p[k + 2] * m; vx += (p[k] - q[k]) * m; vz += (p[k + 2] - q[k + 2]) * m; M += m; } cx /= M; cz /= M; vx /= M; vz /= M;
      let L = 0, J = 0; for (const i of PUSH) { const m = MASS[i], k = i * 3, rx = p[k] - cx, rz = p[k + 2] - cz; L += m * (rz * (p[k] - q[k] - vx) - rx * (p[k + 2] - q[k + 2] - vz)); J += m * (rx * rx + rz * rz); }
      const w = (L / (J || 1)) * 0.2 * sm((this.noSpin - t) / 0.25) * sm((t - 0.07) / 0.1); for (const i of PUSH) { const k = i * 3, rx = p[k] - cx, rz = p[k + 2] - cz; q[k] += rz * w; q[k + 2] -= rx * w; } }
    // (only while still up: forced on a body that is sitting, it loads the hip stops and they throw the trunk forward when it lets go)
    // the back gives the way it was hit: shoulders carried on over the hips, hips pushed out under them (what the trunk gains the
    // pelvis loses: nothing outside the body is doing this)
    if (this.arch && t < this.arch.T && p[I.P * 3 + 1] - gc[I.P] > 0.5) { const A = this.arch, want = A.l0 + A.L * sm((t - 0.01) / 0.11), cur = (p[I.N * 3] - p[I.P * 3]) * A.bx + (p[I.N * 3 + 2] - p[I.P * 3 + 2]) * A.bz, e = Math.max(-0.009, Math.min(0.009, (want - cur) * 0.1)) * sm((A.T - t) / 0.25);
      for (const i of ARCH_U) { p[i * 3] += A.bx * e * (1 - AH); p[i * 3 + 2] += A.bz * e * (1 - AH); } for (const i of ARCH_L) { p[i * 3] -= A.bx * e * AH; p[i * 3 + 2] -= A.bz * e * AH; } }
    // legs do not hold up a body that is already going over: once the trunk leans well back (or forward) over standing hips, both
    // knees give now, whatever they were going to do (held, the body bent over backward at the waist like a limbo dancer)
    if (this.push && !this._kg && this.part === 'body' && this.tLow === undefined && t > 0.1 && p[I.P * 3 + 1] - gc[I.P] > 0.6) { const P = this.push, al = (p[I.N * 3] - p[I.P * 3]) * P.bx + (p[I.N * 3 + 2] - p[I.P * 3 + 2]) * P.bz, up = p[I.N * 3 + 1] - p[I.P * 3 + 1];
      if (Math.abs(al) > up * LB) { this._kg = t; for (const S of ['L', 'R']) { const k = this.sp['knee' + S]; if (k.t0 > t) k.t0 = t; if (k.ta > KGT) k.ta = KGT; k.end = Math.max(t, k.t0) + k.ta; if (this.plant && this.plant[S] > t + 0.08) this.plant[S] = t + 0.08; } } }
    // a foot that is planted stays planted until its leg gives: while it stands on it the ankle is as heavy as the ground to the
    // constraints (they move the knee and the hip instead) and is put back where it stood (left to friction alone it crept a few
    // millimetres a step: 15 cm of skating before the knees went)
    const PN = this._pn || (this._pn = [0, 0]); PN[0] = PN[1] = 0;
    const sitting = this.front > 0.3 && this.part === 'body' && this.tLow === undefined && p[I.P * 3 + 1] - gc[I.P] < SITH;
    if (this.plant && this.tLow === undefined && !this.fast && !sitting) for (let s = 0; s < 2; s++) { const S = s ? 'R' : 'L', i = s ? I.FR : I.FL, un = this.plant[S]; if (un === undefined || t > un || (this.stp && this.stp.s === S) || !(this.gcon && this.gcon[s])) continue; PN[s] = 1; w[i] = 1 / (MASS[i] * 80); }
    // the catch step: the foot is carried out the bullet's way in a low arc and set down
    let SD = null;
    if (this.stp && t > this.stp.t0) { const S = this.stp, u = (t - S.t0) / S.T, a = I['F' + S.s] * 3, b = I['T' + S.s] * 3;
      if (S.x0 === undefined) { S.x0 = p[a]; S.y0 = p[a + 1]; S.z0 = p[a + 2]; S.ox = p[b] - p[a]; S.oy = p[b + 1] - p[a + 1]; S.oz = p[b + 2] - p[a + 2];
        let lx = p[I.HL * 3] - p[I.HR * 3], lz = p[I.HL * 3 + 2] - p[I.HR * 3 + 2]; const ll = Math.hypot(lx, lz) || 1, sg = S.s === 'L' ? 0.1 : -0.1; S.vx = p[I.P * 3] + S.bx * S.fw + (lx / ll) * sg - S.x0; S.vz = p[I.P * 3 + 2] + S.bz * S.fw + (lz / ll) * sg - S.z0;
        const vl = Math.hypot(S.vx, S.vz); if (vl > 0.55) { S.vx *= 0.55 / vl; S.vz *= 0.55 / vl; } else if (vl < 0.1) { S.vx = S.bx * 0.12; S.vz = S.bz * 0.12; } }
      if (u >= 1 || p[I.P * 3 + 1] - gc[I.P] < 0.5) this.stp = null;
      else { const e = sm(u); S.cx = S.x0 + S.vx * e; S.cz = S.z0 + S.vz * e; S.cy = S.y0 + (env.ground(S.cx, S.cz) + R[I['F' + S.s]] - S.y0) * e + S.lift * Math.sin(Math.PI * u); S.a = a; S.b = b; SD = S; } }
    // once the trunk is down what is loose in the body goes on a little and dies away: the head rolls to one side, an arm slides out,
    // a knee left standing falls outward
    const slip = this._slip || (this._slip = [0, 0]); slip[0] = slip[1] = 0;
    if (this.aft && this.lain > 0) { const A = this.aft; if (A.t0 === undefined) A.t0 = t; const e = AFT * Math.exp(-(t - A.t0) / AFD) * h * h;
      let ax = p[I.N * 3] - p[I.P * 3], az = p[I.N * 3 + 2] - p[I.P * 3 + 2]; const al = Math.hypot(ax, az) || 1, lx = -az / al, lz = ax / al;
      if (t - A.t0 < 3.2) {
        { const o = (p[I.H * 3] - p[I.N * 3]) * lx + (p[I.H * 3 + 2] - p[I.N * 3 + 2]) * lz, sg = Math.abs(o) > 0.03 ? Math.sign(o) : A.hs, k = sg * A.hk * e; p[I.H * 3] += lx * k; p[I.H * 3 + 2] += lz * k; }
        for (const [w, hd, el, ak] of [[I.WL, I.AL, I.EL, A.aL], [I.WR, I.AR, I.ER, A.aR]]) { if (!ak) continue; const o = (p[w * 3] - p[I.C * 3]) * lx + (p[w * 3 + 2] - p[I.C * 3 + 2]) * lz, k = (o >= 0 ? 1 : -1) * ak * e * 0.35, kd = -ak * e * 0.9 / al; p[w * 3] += lx * k + ax * kd; p[w * 3 + 2] += lz * k + az * kd; p[hd * 3] += lx * k + ax * kd; p[hd * 3 + 2] += lz * k + az * kd; p[el * 3] += (lx * k + ax * kd) * 0.5; p[el * 3 + 2] += (lz * k + az * kd) * 0.5; } }
      if (p[I.P * 3 + 1] - gc[I.P] < 0.34) { let hx = p[I.HL * 3] - p[I.HR * 3], hz = p[I.HL * 3 + 2] - p[I.HR * 3 + 2]; const hl = Math.hypot(hx, hz) || 1, kk = A.kn * h * h / hl; for (const [kn, f, sg, hp, fk] of [[I.KL, I.FL, 1, I.HL, A.fL], [I.KR, I.FR, -1, I.HR, A.fR]]) { const up = p[kn * 3 + 1] - gc[kn] > 0.2, tuck = hyp(p[f * 3] - p[hp * 3], p[f * 3 + 1] - p[hp * 3 + 1], p[f * 3 + 2] - p[hp * 3 + 2]) < (sg > 0 ? this.legLen.L * A.uL : this.legLen.R * A.uR); if (!up && !tuck) continue; if (up) { p[kn * 3] += hx * kk * sg; p[kn * 3 + 2] += hz * kk * sg; }
          // and its foot slides away from the hip: the leg lets itself out
          let fx = p[f * 3] - p[hp * 3], fz = p[f * 3 + 2] - p[hp * 3 + 2]; if (up) { const bl = Math.hypot(ax, az) || 1, f0 = Math.hypot(fx, fz) || 1; fx = fx / f0 * 0.5 - ax / bl; fz = fz / f0 * 0.5 - az / bl; } const fl = Math.hypot(fx, fz) || 1, fa = (up ? KS * h * h : (tuck ? fk + UK : fk) * AFT * h * h) / fl; p[f * 3] += fx * fa; p[f * 3 + 2] += fz * fa; if (up) slip[sg > 0 ? 0 : 1] = 1; } } }
    const drag = t < 0.6 ? 0.2 : t < 1.0 ? 0.2 - 0.17 * (t - 0.6) / 0.4 : 0.03;      // strong while there is still life in the muscles, slack after
    // joint drag: the rate at which each held pair opens or closes is bled off (tissue, not ball bearings)
    for (const s of this.springs) { const a = s.i * 3, b = s.j * 3; let dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2]; const d = hyp(dx, dy, dz) || 1e-6, rate = d - s.dp; s.dp = d; if (t < 2 * h) continue; const k = -(s.drag ? Math.max(s.drag * (t < 1 ? 1 : 0.5), drag) : (s.g === G_ARML || s.g === G_ARMR) && t > 0.12 ? drag * ADR : drag) * rate / d / (w[s.i] + w[s.j]); dx *= k; dy *= k; dz *= k; p[a] -= dx * w[s.i]; p[a + 1] -= dy * w[s.i]; p[a + 2] -= dz * w[s.i]; p[b] += dx * w[s.j]; p[b + 1] += dy * w[s.j]; p[b + 2] += dz * w[s.j]; }
    const pair = (i, j, target, k) => { const a = i * 3, b = j * 3; let dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2]; const d = hyp(dx, dy, dz) || 1e-6, c = ((d - target) / d / (w[i] + w[j])) * k; dx *= c; dy *= c; dz *= c; p[a] += dx * w[i]; p[a + 1] += dy * w[i]; p[a + 2] += dz * w[i]; p[b] -= dx * w[j]; p[b + 1] -= dy * w[j]; p[b + 2] -= dz * w[j]; };
    // a limit gives: it takes up at most a few millimetres a pass, so a joint driven hard past its stop is eased back, not shot back
    const soft = (i, j, target, cap = 0.003) => { const a = i * 3, b = j * 3; let dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2]; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6; let e = (d - target) * 0.5; if (e > cap) e = cap; else if (e < -cap) e = -cap; const c = e / d / (w[i] + w[j]); dx *= c; dy *= c; dz *= c; p[a] += dx * w[i]; p[a + 1] += dy * w[i]; p[a + 2] += dz * w[i]; p[b] -= dx * w[j]; p[b + 1] -= dy * w[j]; p[b + 2] -= dz * w[j]; };
    // tone strengths now
    // (and whatever is left goes out of it as the hips reach the ground: a body lands limp. Tone that outlived the landing pushed a
    // body that had gone down on its back over onto its face a moment later)
    if (this.tLow === undefined && t > 0.12 && p[I.P * 3 + 1] - gc[I.P] < 0.36) { this.tLow = t; for (const x of this.extra) x.t1 = Math.min(x.t1, t + 0.2);
      this.aft = { hs: this.rnd() < 0.5 ? 1 : -1, hk: 3 + this.rnd() * 4, aL: this.rnd() < 0.7 ? 5 + this.rnd() * 4 : 0, aR: this.rnd() < 0.7 ? 5 + this.rnd() * 4 : 0, kn: 3 + this.rnd() * 2, fL: 4 + this.rnd() * 6, fR: 4 + this.rnd() * 6, uL: UT ? UT + this.rnd() * 0.2 : 0, uR: UT ? UT + this.rnd() * 0.2 : 0 }; }
    const limp = this.tLow === undefined ? 1 : Math.max(0, 1 - (t - this.tLow) / 0.14);
    const tk = this._tk || (this._tk = new Float64Array(NG)); let anyTone = false; for (let g = 0; g < NG; g++) { const u = 1 - t / this.tT[g]; tk[g] = u > 0 ? this.tk[g] * Math.pow(u, 1.4) * limp : 0; if (tk[g] > 0) anyTone = true; }
    // once it is down the body is not a statue: for a few seconds what is left in it lets go, slowly (a drawn-up knee slides out, a
    // folded trunk opens, the head rolls over)
    const rk = 0;      // (the slow 'relax' after landing is gone: it read as a pose correction)
    for (let it = 0; it < ITER; it++) {
      if (rk > 0 && it === 0) { pair(I.HL, I.FL, this.legLen.L * 0.93, rk); pair(I.HR, I.FR, this.legLen.R * 0.97, rk * 0.6); pair(I.CF, I.PF, this.sp.curl.d0, rk * 6); pair(I.N, I.PF, this.nk0, rk * 6); pair(I.SL, I.WL, this.sp.elbowL.d0 * 1.05, rk * 0.6); pair(I.SR, I.WR, this.sp.elbowR.d0 * 1.05, rk); }
      if (SD) { const a = SD.a, b = SD.b; p[a] += (SD.cx - p[a]) * 0.7; p[a + 1] += (SD.cy - p[a + 1]) * 0.7; p[a + 2] += (SD.cz - p[a + 2]) * 0.7; p[b] += (SD.cx + SD.ox - p[b]) * 0.7; p[b + 1] += (SD.cy + SD.oy - p[b + 1]) * 0.7; p[b + 2] += (SD.cz + SD.oz - p[b + 2]) * 0.7; }
      if (anyTone) for (const s of this.springs) { let k = tk[s.g]; if (k <= 0) continue; if (s.end) { k *= 1 - sm((t - s.end) / 0.12); if (k <= 0) continue; } let tg = s.d0 + (s.d1 - s.d0) * sm((t - s.t0) / s.ta); if (s.d2) tg += (s.d2 - tg) * sm((t - s.t2) / 0.22);
        // a knee that is giving is no strut: it folds as fast as the weight on it wants (held straight it pushed the feet apart into the splits)
        if (s.give && t > s.t0) { const a = s.i * 3, b = s.j * 3; if (hyp(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]) < tg) k *= GV; }
        pair(s.i, s.j, tg, k * s.m); }
      for (let e = this.extra.length - 1; e >= 0; e--) { const x = this.extra[e]; if (t < x.t0) continue; if (t > x.t1) { this.extra.splice(e, 1); continue; } const a = x.i * 3, b = x.j * 3, d = hyp(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]); if (d > x.d) pair(x.i, x.j, x.d, x.k * sm((t - x.t0) / 0.12) * sm((x.t1 - t) / 0.2)); }
      for (const s of this.ranges) { const a = s.i * 3, b = s.j * 3; const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < s.lo * s.lo) soft(s.i, s.j, s.lo, s.cap); else if (d2 > s.hi * s.hi) soft(s.i, s.j, s.hi, s.cap); }
      this.knee(I.HL, I.KL, I.FL, this.shin.L); this.knee(I.HR, I.KR, I.FR, this.shin.R);
      if (TWL < 180) this.untwist();
      if (it === 0 && RO && this.aft && this.lain > 0 && !this.fast) this.rollFlat(t - this.tLow, h);
      for (const s of this.sticks) pair(s.i, s.j, s.d, 1);
      for (let k = this.sticks.length - 1; k >= 0; k--) { const s = this.sticks[k]; pair(s.i, s.j, s.d, 1); }
      if (it >= ITER - 2) { this.rigid(this.blocks[0]); this.rigid(this.blocks[1]); }
      // the ground
      if (it === ITER - 1) for (let i = 0; i < NP; i++) if (p[i * 3 + 1] < 0.4 + gc[i]) gc[i] = env.ground(p[i * 3], p[i * 3 + 2]);      // where the constraints have left it
      for (let i = 0; i < NP; i++) { const k = i * 3, g = gc[i] + R[i]; if (p[k + 1] >= g) continue;
        if (g - p[k + 1] > 0.085) { const g0 = env.ground(q[k], q[k + 2]) + R[i]; if (g0 < g - 0.05) { p[k] = q[k]; p[k + 2] = q[k + 2]; if (p[k + 1] < g0) { nacc[i] += g0 - p[k + 1]; p[k + 1] = g0; } continue; } }      // the kerb's face
        nacc[i] += g - p[k + 1]; p[k + 1] = g; }
    }
    // the two trunk blocks keep their handedness (a hard blow must not turn a ribcage inside out)
    // (the blocks cannot turn inside out any more: rigid() only ever rotates them)
    // walls and standing things
    // (live build, Nov 11) a wall in the game is a line with no thickness: a joint that got across it in one step (a fast limb, or dragged by the rest)
    // was then pushed out on the FAR side and the body followed it into the building. env.cross (optional): the way from where the joint last
    // stood to where it is now may not cross a wall. env.solid: building walls still hold a body the `noWall` rule has let go of (that rule is
    // for chairs and posts; env.wall's sixth argument then asks for walls only). Without env.cross / env.solid (node tests) nothing changes.
    if (env.wall && (!this.noWall || env.solid)) { const o = this._o || (this._o = { x: 0, z: 0 }), W = this.wq || (this.wq = Float64Array.from(q)), np = !!this.noWall, cr = env.cross; for (const i of WALL) { const k = i * 3;
      if (cr && (p[k] !== W[k] || p[k + 2] !== W[k + 2]) && cr(W[k], W[k + 2], p[k], p[k + 2])) { p[k] = W[k]; p[k + 2] = W[k + 2]; q[k] = W[k]; q[k + 2] = W[k + 2]; }
      if (env.wall(p[k], p[k + 2], R[i] + 0.03, o, p[k + 1], np)) { if (cr && cr(W[k], W[k + 2], o.x, o.z)) { o.x = W[k]; o.z = W[k + 2]; } p[k] = o.x; p[k + 2] = o.z; q[k] = o.x; q[k + 2] = o.z; }
      W[k] = p[k]; W[k + 2] = p[k + 2]; } }
    // whatever the constraints wanted, no joint is moved further in a step than a body can move (a stop that lets go must not show as a twitch)
    { const cap = (this.t < 1.2 && this.fast ? 17 : calm + 1) * h, c2 = cap * cap; for (let i = 0; i < NP; i++) { const k = i * 3, dx = p[k] - q[k], dy = p[k + 1] - q[k + 1], dz = p[k + 2] - q[k + 2], d2 = dx * dx + dy * dy + dz * dz, cc = legCap && LEG[i] ? Math.min(cap, legCap * 1.15) : cap; if (d2 > cc * cc) { const c = cc / Math.sqrt(d2); p[k] = q[k] + dx * c; p[k + 1] = q[k + 1] + dy * c; p[k + 2] = q[k + 2] + dz * c; } } }
    // a trunk that has come down stays down: whatever the joints still have to sort out, they do it along the ground (a stop taking
    // up its slack under a body lying flat lifted the hips a hand's breadth and rolled it over, half a second after it had landed)
    if (RUP && this.lain > 0.2 && !this.fast) { const c = RUP * h; for (const i of TRUNK) { const k = i * 3 + 1; if (p[k] - q[k] > c) p[k] = q[k] + c; } }
    { const gcn = this.gcon || (this.gcon = [0, 0]); for (let s = 0; s < 2; s++) { const i = s ? I.FR : I.FL, k = i * 3; gcn[s] = nacc[i] > 0 ? 1 : 0; if (!PN[s]) continue; w[i] = 1 / MASS[i]; const dx = p[k] - q[k], dz = p[k + 2] - q[k + 2]; if (dx * dx + dz * dz < 0.012 * 0.012 && nacc[i] > 0) { p[k] = q[k]; p[k + 2] = q[k + 2]; } else this.plant[s ? 'R' : 'L'] = 0; } }
    // a leg letting itself out along the ground does not lift its knee or its foot to do it
    if (LC && this.aft && this.aft.t0 !== undefined) { const c = 0.12 * h; for (const i of LEGS) { const k = i * 3 + 1; if (p[k] - q[k] > c) p[k] = q[k] + c; } }
    // friction where it touches, and no bounce
    let on = 0;
    for (let i = 0; i < NP; i++) { if (nacc[i] <= 0) continue; on++; const k = i * 3; { const vy = p[k + 1] - q[k + 1]; if (vy < 0 || vy < nacc[i]) q[k + 1] = p[k + 1]; }
      const vx = p[k] - q[k], vz = p[k + 2] - q[k + 2], v = hyp(vx, vz), f = (FOOT[i] ? (this.tLow === undefined ? (sitting ? SITF : MF) : slip[i === I.FL || i === I.TL ? 0 : 1] ? 0.1 : M2) : FRIC[i] || MU) * nacc[i] + (FOOT[i] && this.tLow === undefined && !this.fast && !sitting ? FG : 0.00004); if (v <= f) { q[k] = p[k]; q[k + 2] = p[k + 2]; } else { q[k] += vx * (f / v); q[k + 2] += vz * (f / v); } }
    this.onGround = on;
  }
  // put a block back into its remembered shape: the rotation nearest to where its points are now (Mueller et al. 2016: a few
  // warm-started steps on a quaternion; it cannot mirror), about their centre of mass
  rigid(B) {
    const p = this.p, idx = B.idx, r = B.r, q = B.q; let cx = 0, cy = 0, cz = 0; for (const i of idx) { const m = MASS[i]; cx += p[i * 3] * m; cy += p[i * 3 + 1] * m; cz += p[i * 3 + 2] * m; } cx /= B.M; cy /= B.M; cz /= B.M;
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let k = 0; k < idx.length; k++) { const i = idx[k], m = MASS[i], x = p[i * 3] - cx, y = p[i * 3 + 1] - cy, z = p[i * 3 + 2] - cz, R = r[k]; a00 += m * x * R[0]; a01 += m * x * R[1]; a02 += m * x * R[2]; a10 += m * y * R[0]; a11 += m * y * R[1]; a12 += m * y * R[2]; a20 += m * z * R[0]; a21 += m * z * R[1]; a22 += m * z * R[2]; }
    let r00, r01, r02, r10, r11, r12, r20, r21, r22;
    const mat = () => { const x = q[0], y = q[1], z = q[2], w = q[3]; r00 = 1 - 2 * (y * y + z * z); r01 = 2 * (x * y - z * w); r02 = 2 * (x * z + y * w); r10 = 2 * (x * y + z * w); r11 = 1 - 2 * (x * x + z * z); r12 = 2 * (y * z - x * w); r20 = 2 * (x * z - y * w); r21 = 2 * (y * z + x * w); r22 = 1 - 2 * (x * x + y * y); };
    for (let n = 0; n < 6; n++) { mat();
      // omega = sum over columns of (R_col x A_col) / |sum R_col . A_col|
      let ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12), oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22), oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-9; ox /= den; oy /= den; oz /= den; const w = Math.sqrt(ox * ox + oy * oy + oz * oz); if (w < 1e-7) break;
      const hs = Math.sin(w / 2) / w, hc = Math.cos(w / 2), dx = ox * hs, dy = oy * hs, dz = oz * hs, x = q[0], y = q[1], z = q[2], qw = q[3];
      q[0] = hc * x + dx * qw + dy * z - dz * y; q[1] = hc * y + dy * qw + dz * x - dx * z; q[2] = hc * z + dz * qw + dx * y - dy * x; q[3] = hc * qw - dx * x - dy * y - dz * z; const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; }
    mat(); for (let k = 0; k < idx.length; k++) { const i = idx[k] * 3, R = r[k]; p[i] = cx + r00 * R[0] + r01 * R[1] + r02 * R[2]; p[i + 1] = cy + r10 * R[0] + r11 * R[1] + r12 * R[2]; p[i + 2] = cz + r20 * R[0] + r21 * R[1] + r22 * R[2]; }
  }
  // the hips cannot turn against the ribcage about the spine by more than a spine allows. (The sampled distance limits between the
  // shoulders and the hip joints did not stop it: in 41 % of shots from the front the pelvis rolled right over under a chest lying
  // face up, legs and all: the body "curled on its side" of the laptop captures.) Both blocks are turned back toward each other.
  untwist() {
    const p = this.p, P = I.P * 3, N = I.N * 3; let ux = p[N] - p[P], uy = p[N + 1] - p[P + 1], uz = p[N + 2] - p[P + 2]; const ul = Math.hypot(ux, uy, uz); if (ul < 0.1) return; ux /= ul; uy /= ul; uz /= ul;
    let ax = p[I.SL * 3] - p[I.SR * 3], ay = p[I.SL * 3 + 1] - p[I.SR * 3 + 1], az = p[I.SL * 3 + 2] - p[I.SR * 3 + 2], bx = p[I.HL * 3] - p[I.HR * 3], by = p[I.HL * 3 + 1] - p[I.HR * 3 + 1], bz = p[I.HL * 3 + 2] - p[I.HR * 3 + 2];
    let d = ax * ux + ay * uy + az * uz; ax -= ux * d; ay -= uy * d; az -= uz * d; d = bx * ux + by * uy + bz * uz; bx -= ux * d; by -= uy * d; bz -= uz * d; if (Math.hypot(ax, ay, az) < 0.05 || Math.hypot(bx, by, bz) < 0.05) return;
    const tw = Math.atan2((ay * bz - az * by) * ux + (az * bx - ax * bz) * uy + (ax * by - ay * bx) * uz, ax * bx + ay * by + az * bz), ex = Math.abs(tw) - TWL * D2R; if (ex <= 0) return;
    const ang = (tw > 0 ? 1 : -1) * Math.min(ex, TWC * D2R) * 0.5, turn = (list, piv, an) => { const c = Math.cos(an), s = Math.sin(an), ox = p[piv * 3], oy = p[piv * 3 + 1], oz = p[piv * 3 + 2]; for (const i of list) { if (i === piv) continue; const k = i * 3, x = p[k] - ox, y = p[k + 1] - oy, z = p[k + 2] - oz, dd = (ux * x + uy * y + uz * z) * (1 - c);
      p[k] = ox + x * c + (uy * z - uz * y) * s + ux * dd; p[k + 1] = oy + y * c + (uz * x - ux * z) * s + uy * dd; p[k + 2] = oz + z * c + (ux * y - uy * x) * s + uz * dd; } };
    turn(TW_U, I.C, ang); turn(TW_L, I.P, -ang);
  }
  // a limp trunk does not balance on one shoulder: once down, a body left on its side goes over onto its back (or its front, when
  // that is nearer) in half a second or so, hips and ribcage together, and the legs come round with the hips
  rollFlat(tl, h) {
    if (tl > ROT) return; const p = this.p, q = this.q, gc = this.gc, P = I.P * 3, N = I.N * 3, C = I.C * 3, F = I.CF * 3; let ux = p[N] - p[P], uy = p[N + 1] - p[P + 1], uz = p[N + 2] - p[P + 2]; const ul = Math.hypot(ux, uy, uz); if (ul < 0.1) return; ux /= ul; uy /= ul; uz /= ul; if (p[P + 1] - gc[I.P] > 0.34) return;
    // nor does it stay propped on an elbow with the shoulders off the ground: the ribcage is let down (and an upper arm standing under its shoulder slides out)
    if (LBK && p[N + 1] - gc[I.N] - this.r[I.N] > 0.1) { const k = LBK * sm(tl / 0.25) * sm((ROT - tl) / 0.5) * h, hu = Math.hypot(ux, uz) || 1; for (const i of LB_U) { const d = k * (i === I.C || i === I.CF ? 0.5 : 1); p[i * 3 + 1] -= d; q[i * 3 + 1] -= d; }
      for (const [e, sh] of [[I.EL, I.SL], [I.ER, I.SR]]) { if (p[sh * 3 + 1] - p[e * 3 + 1] < 0.12) continue; let ox = p[e * 3] - p[C], oz = p[e * 3 + 2] - p[C + 2]; const d = ox * ux + oz * uz; ox -= ux * d; oz -= uz * d; const ol = Math.hypot(ox, oz) || 1, m = 1.2 * k; p[e * 3] += ox / ol * m; p[e * 3 + 2] += oz / ol * m; q[e * 3] += ox / ol * m; q[e * 3 + 2] += oz / ol * m; } }
    if (Math.abs(uy) > ROU) return;
    const wx = p[F] - p[C], wy = p[F + 1] - p[C + 1], wz = p[F + 2] - p[C + 2], wl = Math.hypot(wx, wy, wz) || 1, cy = wy / wl, want = cy >= -0.2 ? 1 : -1, flat = want * cy; if (flat > 0.93) return;
    const gy = uz * wx - ux * wz; if (Math.abs(gy) < 1e-4) return; const ang = (gy > 0 ? 1 : -1) * want * RO * sm(tl / ROR) * sm((ROT - tl) / 0.5) * Math.min(1, (0.97 - flat) * 2.5) * h;
    const turn = (list, piv) => { const c = Math.cos(ang), s = Math.sin(ang), ox = p[piv * 3], oy = p[piv * 3 + 1], oz = p[piv * 3 + 2]; for (const i of list) { if (i === piv) continue; const k = i * 3, x = p[k] - ox, y = p[k + 1] - oy, z = p[k + 2] - oz, dd = (ux * x + uy * y + uz * z) * (1 - c);
      const nx = ox + x * c + (uy * z - uz * y) * s + ux * dd, ny = oy + y * c + (uz * x - ux * z) * s + uy * dd, nz = oz + z * c + (ux * y - uy * x) * s + uz * dd; q[k] += nx - p[k]; q[k + 1] += ny - p[k + 1]; q[k + 2] += nz - p[k + 2]; p[k] = nx; p[k + 1] = ny; p[k + 2] = nz; } };
    turn(TW_U, I.C); turn(TW_L, I.P);
  }
  // a knee is a hinge: the shin folds back, never forward
  knee(hip, kn, an, L) {
    const b = this.kneeBack(hip, kn); if (!b) return; const p = this.p, w = this.w, a = an * 3, k = kn * 3, sx = p[a] - p[k], sy = p[a + 1] - p[k + 1], sz = p[a + 2] - p[k + 2];
    const c = sx * b[0] + sy * b[1] + sz * b[2], lim = 0.03 * L;
    if (c < lim) { const l = (lim - c) / (w[an] + w[kn]); p[a] += b[0] * l * w[an]; p[a + 1] += b[1] * l * w[an]; p[a + 2] += b[2] * l * w[an]; p[k] -= b[0] * l * w[kn]; p[k + 1] -= b[1] * l * w[kn]; p[k + 2] -= b[2] * l * w[kn]; }
    // sideways it may go only as the hip can turn the whole leg in or out: within a wedge of about 45 degrees round the fold
    const ax = this._ax, ay = this._ay, az = this._az, sd = sx * ax + sy * ay + sz * az, sl = 0.1 * L + Math.max(0, c) * (this.tLow === undefined ? 1.0 : 1 + (WK - 1) * sm((this.t - this.tLow - 0.1) / WR));
    if (Math.abs(sd) > sl) { const l = ((sd > 0 ? sl : -sl) - sd) / (w[an] + w[kn]); p[a] += ax * l * w[an]; p[a + 1] += ay * l * w[an]; p[a + 2] += az * l * w[an]; p[k] -= ax * l * w[kn]; p[k + 1] -= ay * l * w[kn]; p[k + 2] -= az * l * w[kn]; }
  }
  mirror(i, o, a, b) {      // reflect point i through the plane (o, a, b)
    const p = this.p, ox = p[o * 3], oy = p[o * 3 + 1], oz = p[o * 3 + 2], ax = p[a * 3] - ox, ay = p[a * 3 + 1] - oy, az = p[a * 3 + 2] - oz, bx = p[b * 3] - ox, by = p[b * 3 + 1] - oy, bz = p[b * 3 + 2] - oz;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const nl = hyp(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const d = (p[i * 3] - ox) * nx + (p[i * 3 + 1] - oy) * ny + (p[i * 3 + 2] - oz) * nz; p[i * 3] -= 2 * d * nx; p[i * 3 + 1] -= 2 * d * ny; p[i * 3 + 2] -= 2 * d * nz;
  }
}
const LIGHT = []; for (const i of [I.TL, I.TR, I.AL, I.AR, I.WL, I.WR, I.FL, I.FR]) LIGHT[i] = 1;
const HEAVY = []; for (const i of [I.H, I.C, I.P, I.N, I.HL, I.HR, I.KL, I.KR, I.SL, I.SR]) HEAVY[i] = 1;
const FREE = []; for (const i of [I.H, I.EL, I.ER, I.WL, I.WR, I.AL, I.AR]) FREE[i] = 1;
const FRIC = []; FRIC[I.H] = 0.3; FRIC[I.WL] = FRIC[I.WR] = FRIC[I.AL] = FRIC[I.AR] = 0.4; FRIC[I.EL] = FRIC[I.ER] = 0.6;
const FOOT = []; for (const i of [I.FL, I.FR, I.TL, I.TR]) FOOT[i] = 1;
const TRUNK = [I.N, I.C, I.CF, I.SL, I.SR, I.P, I.PF, I.HL, I.HR];
const LEGS = [I.KL, I.KR, I.FL, I.FR, I.TL, I.TR];
const KNEE = []; KNEE[I.KL] = KNEE[I.KR] = 1; const ARM = []; for (const i of [I.EL, I.ER, I.WL, I.WR, I.AL, I.AR]) ARM[i] = 1;
const LB_U = [I.H, I.N, I.C, I.CF, I.SL, I.SR];
const TW_U = [I.H, I.N, I.C, I.CF, I.SL, I.SR], TW_L = [I.P, I.PF, I.HL, I.HR];
const LEG = []; for (const i of [I.KL, I.KR, I.FL, I.FR, I.TL, I.TR]) LEG[i] = 1;
const ARCH_U = [I.H, I.N, I.CF, I.SL, I.SR], ARCH_L = [I.P, I.PF, I.HL, I.HR];
const PUSH = [I.H, I.N, I.C, I.CF, I.SL, I.SR, I.P, I.PF];
const THROW = [I.C, I.CF, I.N, I.H, I.SL, I.SR];
const STS = +(EV.STM ?? 1) ? [I.P, I.PF, I.HL, I.HR] : [I.H, I.N, I.C, I.CF, I.SL, I.SR, I.P, I.PF, I.HL, I.HR];
const SIT = [I.H, I.N, I.C, I.CF, I.SL, I.SR, I.P, I.PF, I.HL, I.HR];
const WALL = [I.H, I.C, I.P, I.KL, I.KR, I.WL, I.WR, I.FL, I.FR];
