// look_geo.js (bus lane, model helper): every triangle of the bus, made in code. Pure maths (no three.js), so it can be counted in node.
// MODEL FRAME: +X forward, +Y up, +Z the bus's right (kerb side, doors). Origin: middle of length and width, on the road. Metres.
// A vertex: position 3, normal 3, uv 2 (u < -0.5 = no picture, plain colour), colour 3 (linear), fx 4 = roughness, metalness, glow kind, surface kind.
//   glow kind: 0 none, 1 headlamp, 2 tail/brake, 3 cabin strip light, 4 amber marker, 5 red marker, 6 the STOP REQUESTED sign, 7 screen (always lit)
//   surface kind: 0 outside plain, 1 outside with the livery picture, 2 inside, 4 dark window glass (mid/far), 5 front/side LED sign, 6 rear LED sign,
//                 8 front mask picture (swapped for the +SELECT one per bus), 9 cabin floor (speckle made in the shader)
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const mat = (hex, r = 0.6, m = 0, glow = 0, kind = 0) => ({ c: [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)], r, m, glow, kind });

// ---------------------------------------------------------------- the bus in numbers
export const LEN = 12.2, HW = 1.295, XF = 6.1, HGT = 3.2;
export const AXF = 3.3, AXR = -3.84, RADIUS = 0.49, AR = 0.62, ARY = 0.47;         // axles, tyre radius, wheel-arch radius and its centre height
export const YFS = 1.04, YSG = 2.36;                                              // the windscreen's lower edge; the foot of the sign band above it                                                          // the windscreen's lower edge
export const YB = 0.32, YFL = 0.37, YS = 1.34, YT = 2.50, YW = 2.72, RR = 0.22, YROOF = YW + RR;   // skirt bottom, low floor, window sill, window top, top of the side wall, roof corner radius
export const YF2 = 0.75, XSTEP1 = -3.15, XSTEP2 = -3.40;                          // the raised rear floor and its two steps
const XF0 = 5.72, XR0 = -5.84, RCF = 0.42, RCB = 0.26, ZF = HW - RCF, ZB = HW - RCB, RAKE = 0.16, BOW = 0.05, TH = 0.07;
const BAND0 = -5.25;                                                              // the black window band runs from here to the front corner
export const DOORS = { front: { x: 5.02, w: 1.2 }, rear: { x: -2.5, w: 1.2 } };
const WIN = {                                                                     // panes [x0, x1] in the band
  R: [[3.18, 4.34], [1.94, 3.10], [0.70, 1.86], [-0.54, 0.62], [-1.82, -0.62], [-4.40, -3.18], [-5.17, -4.48]],
  L: [[4.62, 5.60], [3.34, 4.52], [2.10, 3.26], [0.86, 2.02], [-0.38, 0.78], [-1.62, -0.46], [-2.86, -1.70], [-4.10, -2.94], [-5.17, -4.18]],
};
export const floorAt = (x) => (x > XSTEP1 ? YFL : x > XSTEP2 ? (YFL + YF2) / 2 : YF2);
// the 2048 x 2048 picture: where each part is painted [x, y, w, h] in pixels (y down)
export const REG = { sideR: [0, 0, 2048, 512], sideL: [0, 512, 2048, 512], front: [0, 1024, 512, 512], frontSel: [512, 1024, 512, 512], rear: [1024, 1024, 512, 512],
  digits: [832, 1664, 640, 96], plate: [896, 1776, 128, 64], ads: [0, 1552, 2048, 96], stop: [0, 1664, 256, 64], screen: [256, 1664, 128, 96], fare: [384, 1664, 64, 128], reader: [448, 1664, 64, 96], leaf: [512, 1664, 64, 256], dash: [576, 1664, 256, 64] };
const uvr = (reg, s, t) => [(reg[0] + s * reg[2]) / 2048, 1 - (reg[1] + (1 - t) * reg[3]) / 2048];

// ---------------------------------------------------------------- triangle soup
export class Soup {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.fx = []; this.i = []; this.T = null; }
  get nv() { return this.p.length / 3; }
  get nt() { return this.i.length / 3; }
  v(x, y, z, nx, ny, nz, m, u = -1, w = -1) {
    const T = this.T; if (T) { const X = x * T.c + z * T.s + T.x, Z = -x * T.s + z * T.c + T.z, NX = nx * T.c + nz * T.s, NZ = -nx * T.s + nz * T.c; x = X; z = Z; nx = NX; nz = NZ; y += T.y; }
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.c.push(m.c[0], m.c[1], m.c[2]); this.fx.push(m.r, m.m, m.glow, m.kind); return this.nv - 1;
  }
  // run fn with everything it adds moved to (x, y, z) and turned by yaw about +Y (a point's local +X turns toward -Z for yaw > 0)
  at(x, y, z, yaw, fn) { const old = this.T; if (old) throw new Error('nested at()'); this.T = { x, y, z, c: Math.cos(yaw), s: Math.sin(yaw) }; fn(); this.T = old; }
  // a flat quad; corners counter-clockwise seen from its front, or pass `hint` (a direction its front should face). uv = [u0, v0, u1, v1] for P0..P2
  q4(P0, P1, P2, P3, m, uv, hint) {
    const ux = P1[0] - P0[0], uy = P1[1] - P0[1], uz = P1[2] - P0[2], wx = P3[0] - P0[0], wy = P3[1] - P0[1], wz = P3[2] - P0[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let flip = false; if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const U = uv || [-1, -1, -1, -1];
    const a = this.v(P0[0], P0[1], P0[2], nx, ny, nz, m, U[0], U[1]), b = this.v(P1[0], P1[1], P1[2], nx, ny, nz, m, U[2], U[1]), c = this.v(P2[0], P2[1], P2[2], nx, ny, nz, m, U[2], U[3]), d = this.v(P3[0], P3[1], P3[2], nx, ny, nz, m, U[0], U[3]);
    if (flip) this.i.push(a, c, b, a, d, c); else this.i.push(a, b, c, a, c, d);
  }
  box(x0, y0, z0, x1, y1, z1, m, skip = '') {
    if (!skip.includes('+x')) this.q4([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], m);
    if (!skip.includes('-x')) this.q4([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], m);
    if (!skip.includes('+y')) this.q4([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], m);
    if (!skip.includes('-y')) this.q4([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], m);
    if (!skip.includes('+z')) this.q4([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], m);
    if (!skip.includes('-z')) this.q4([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], m);
  }
  // a round bar along a polyline
  tube(pts, r, sides, m, closed = false) {
    const n = pts.length, rings = []; let pu = null;
    for (let k = 0; k < n; k++) {
      const a = pts[closed ? (k + n - 1) % n : Math.max(k - 1, 0)], b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
      const q = pts[k], l1 = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]) || 1, l2 = Math.hypot(b[0] - q[0], b[1] - q[1], b[2] - q[2]) || 1;      // the mean of the two bars' directions, whatever their lengths
      let dx = (q[0] - a[0]) / l1 + (b[0] - q[0]) / l2, dy = (q[1] - a[1]) / l1 + (b[1] - q[1]) / l2, dz = (q[2] - a[2]) / l1 + (b[2] - q[2]) / l2; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      let ux = 0, uy = 1, uz = 0; if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
      if (pu) { const t = pu[0] * dx + pu[1] * dy + pu[2] * dz, a2 = pu[0] - dx * t, b2 = pu[1] - dy * t, c2 = pu[2] - dz * t; if (Math.hypot(a2, b2, c2) > 0.2) { ux = a2; uy = b2; uz = c2; } }      // the basis is carried along the bar, so a bend does not twist it
      let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux; const lv = Math.hypot(vx, vy, vz); vx /= lv; vy /= lv; vz /= lv;
      ux = vy * dz - vz * dy; uy = vz * dx - vx * dz; uz = vx * dy - vy * dx; pu = [ux, uy, uz];
      const ring = []; for (let s = 0; s < sides; s++) { const t = (s / sides) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t), nx = ux * c + vx * sn, ny = uy * c + vy * sn, nz = uz * c + vz * sn; ring.push(this.v(pts[k][0] + nx * r, pts[k][1] + ny * r, pts[k][2] + nz * r, nx, ny, nz, m)); }
      rings.push(ring);
    }
    for (let k = 0; k < (closed ? n : n - 1); k++) { const A = rings[k], B = rings[(k + 1) % n]; for (let s = 0; s < sides; s++) { const s2 = (s + 1) % sides; this.i.push(A[s], B[s2], B[s], A[s], A[s2], B[s2]); } }
  }
  // a sheet of thickness t whose side view is the polyline pts [[x, y], ...] (its front is on the left of the walk), from z0 to z1
  ribbon(pts, t, z0, z1, m, mBack = m, capEnds = true) {
    const n = pts.length, F = [], Bk = [], N = [];
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)]; let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      N.push([nx, ny]); F.push([pts[k][0] + nx * t / 2, pts[k][1] + ny * t / 2]); Bk.push([pts[k][0] - nx * t / 2, pts[k][1] - ny * t / 2]);
    }
    for (let k = 0; k < n - 1; k++) {
      const f0 = F[k], f1 = F[k + 1], b0 = Bk[k], b1 = Bk[k + 1], n0 = N[k], n1 = N[k + 1];
      const inset0 = pts[k][2] || 0, inset1 = pts[k + 1][2] || 0;
      let a = this.v(f0[0], f0[1], z0 + inset0, n0[0], n0[1], 0, m), b = this.v(f1[0], f1[1], z0 + inset1, n1[0], n1[1], 0, m), c = this.v(f1[0], f1[1], z1 - inset1, n1[0], n1[1], 0, m), d = this.v(f0[0], f0[1], z1 - inset0, n0[0], n0[1], 0, m); this.i.push(a, c, b, a, d, c);
      a = this.v(b0[0], b0[1], z0 + inset0, -n0[0], -n0[1], 0, mBack); b = this.v(b1[0], b1[1], z0 + inset1, -n1[0], -n1[1], 0, mBack); c = this.v(b1[0], b1[1], z1 - inset1, -n1[0], -n1[1], 0, mBack); d = this.v(b0[0], b0[1], z1 - inset0, -n0[0], -n0[1], 0, mBack); this.i.push(a, b, c, a, c, d);
      if (capEnds) {
        this.q4([f0[0], f0[1], z0 + inset0], [b0[0], b0[1], z0 + inset0], [b1[0], b1[1], z0 + inset1], [f1[0], f1[1], z0 + inset1], m, null, [0, 0, z0 - z1]);
        this.q4([f0[0], f0[1], z1 - inset0], [b0[0], b0[1], z1 - inset0], [b1[0], b1[1], z1 - inset1], [f1[0], f1[1], z1 - inset1], m, null, [0, 0, z1 - z0]);
      }
    }
    const e = n - 1, first = pts[0][2] || 0, last = pts[e][2] || 0; this.q4([F[0][0], F[0][1], z0 + first], [Bk[0][0], Bk[0][1], z0 + first], [Bk[0][0], Bk[0][1], z1 - first], [F[0][0], F[0][1], z1 - first], m, null, [pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], 0]);
    this.q4([F[e][0], F[e][1], z0 + last], [Bk[e][0], Bk[e][1], z0 + last], [Bk[e][0], Bk[e][1], z1 - last], [F[e][0], F[e][1], z1 - last], m, null, [pts[e][0] - pts[e - 1][0], pts[e][1] - pts[e - 1][1], 0]);
  }
  // a turned shape about the local Z axis: prof = [[radius, z, material], ...] walked so that its outside is on the left ((dr, dz) -> normal (-dz, dr) in (z, r))
  lathe(prof, segs) {
    for (let k = 0; k < prof.length - 1; k++) {
      const [r0, z0, m] = prof[k], [r1, z1] = prof[k + 1]; let nr = -(z1 - z0), nz = r1 - r0; const l = Math.hypot(nr, nz) || 1; nr /= l; nz /= l;
      for (let s = 0; s < segs; s++) {
        const t0 = (s / segs) * Math.PI * 2, t1 = ((s + 1) / segs) * Math.PI * 2, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        const a = this.v(r0 * c0, r0 * s0, z0, nr * c0, nr * s0, nz, m), b = this.v(r0 * c1, r0 * s1, z0, nr * c1, nr * s1, nz, m), c = this.v(r1 * c1, r1 * s1, z1, nr * c1, nr * s1, nz, m), d = this.v(r1 * c0, r1 * s0, z1, nr * c0, nr * s0, nz, m);
        if (r0 > 1e-6) this.i.push(a, c, b); if (r1 > 1e-6) this.i.push(a, d, c);
      }
    }
  }
  // rings of points (the same count each, closed) joined by flat faces turned away from the point c
  loft(secs, m, c) {
    for (let k = 0; k + 1 < secs.length; k++) { const A = secs[k], B = secs[k + 1], n = A.length; for (let j = 0; j < n; j++) { const j2 = (j + 1) % n, P0 = A[j], P1 = A[j2], P2 = B[j2], P3 = B[j];
      const ax = P2[0] - P0[0], ay = P2[1] - P0[1], az = P2[2] - P0[2], bx = P3[0] - P1[0], by = P3[1] - P1[1], bz = P3[2] - P1[2]; let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue; nx /= l; ny /= l; nz /= l;
      const flip = nx * ((P0[0] + P1[0] + P2[0] + P3[0]) / 4 - c[0]) + ny * ((P0[1] + P1[1] + P2[1] + P3[1]) / 4 - c[1]) + nz * ((P0[2] + P1[2] + P2[2] + P3[2]) / 4 - c[2]) < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const a = this.v(P0[0], P0[1], P0[2], nx, ny, nz, m), b = this.v(P1[0], P1[1], P1[2], nx, ny, nz, m), d = this.v(P2[0], P2[1], P2[2], nx, ny, nz, m), e = this.v(P3[0], P3[1], P3[2], nx, ny, nz, m);
      const t1 = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-7, t2 = Math.hypot(P3[0] - P2[0], P3[1] - P2[1], P3[2] - P2[2]) > 1e-7;
      if (flip) { if (t1) this.i.push(a, d, b); if (t2) this.i.push(a, e, d); } else { if (t1) this.i.push(a, b, d); if (t2) this.i.push(a, d, e); } } }
  }
  // a ball about c with radii r = [rx, ry, rz]; pick(i, j, n, k) gives each face's material (i from the top, j round from +X)
  ball(c, r, n, k, pick) {
    const P = (i, j) => { const ph = (Math.PI * i) / k, th = (2 * Math.PI * j) / n, d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; return [c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2], d[0], d[1], d[2]]; };
    for (let i = 0; i < k; i++) for (let j = 0; j < n; j++) { const m = pick(i, j, n, k), q = [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)].map((p) => this.v(p[0], p[1], p[2], p[3], p[4], p[5], m)); if (i > 0) this.i.push(q[0], q[1], q[2]); if (i < k - 1) this.i.push(q[0], q[2], q[3]); }
  }
  append(o) { const b = this.nv; for (const k of ['p', 'n', 'uv', 'c', 'fx']) for (let j = 0; j < o[k].length; j++) this[k].push(o[k][j]); for (let j = 0; j < o.i.length; j++) this.i.push(o.i[j] + b); return this; }
}

// ---------------------------------------------------------------- surfaces
const ROOFB = mat(0x17358c, 0.34), PAINT = mat(0xffffff, 0.34, 0.0, 0, 1), MASK = mat(0xffffff, 0.34, 0, 0, 8), ROOF = mat(0xe9ebec, 0.5), BLACK = mat(0x0b0c0e, 0.12), GLASSD = mat(0x0a0d10, 0.05, 0, 0, 4), GLASS = mat(0x0a0d10, 0.04);
const RUBBER = mat(0x111112, 0.85), DARK = mat(0x17181a, 0.8), BUMP = mat(0x121315, 0.5), STEEL = mat(0xb9bcc0, 0.3, 0.9), ALU = mat(0xc9cccf, 0.38, 0.75), TYRE = mat(0x0c0c0d, 0.9);
const LAMP_H = mat(0xdfe6ee, 0.15, 0.3, 1), LAMP_T = mat(0x5a0606, 0.2, 0, 2), LAMP_A = mat(0x9a4a05, 0.2, 0, 4), LAMP_R = mat(0x5a0606, 0.2, 0, 5), LAMP_W = mat(0xd8dadc, 0.2, 0.2), LAMP_I = [mat(0x9a4a05, 0.2, 0, 9), mat(0x9a4a05, 0.2, 0, 8)];      // [left, right] turn lamps
const SIGN_F = mat(0x050505, 0.4, 0, 0, 5), SIGN_B = mat(0x050505, 0.4, 0, 0, 6);
const I = (hex, r = 0.7, m = 0, glow = 0) => mat(hex, r, m, glow, 2);
const IWALL = I(0x3b3e43, 0.6), IPIL = I(0x23262a, 0.5), ICEIL = I(0xd6d9db, 0.65), IFLOOR = mat(0x33353a, 0.75, 0, 0, 9), ISTEP = I(0x3c3f43, 0.8), IYEL = I(0xf5b82a, 0.42), IDARK = I(0x1d1f22, 0.7),
  ISEAT = I(0x1c4f9c, 0.55), ISHELL = I(0x8d9298, 0.5), ISEATD = I(0x24272c, 0.9), ISTEEL = I(0xb4b7ba, 0.35, 0.8), ILIGHT = I(0xf4f6f2, 0.4, 0, 3), IPIC = I(0xffffff, 0.55), IRED = I(0xb01818, 0.4), IHOUSE = I(0x6b6f75, 0.75), IGLASS = mat(0x0a0d10, 0.04);

const archY = (x) => { let y = YB; for (const ax of [AXF, AXR]) { const d = Math.abs(x - ax); if (d < AR) y = Math.max(y, ARY + Math.sqrt(AR * AR - d * d)); } return y; };
const xfAt = (y) => XF - (y > YFS ? Math.min(1, (y - YFS) / (YW - YFS)) * RAKE : 0);       // the raked windscreen
export const frontX = (y, z) => xfAt(y) - BOW * (z / ZF) * (z / ZF);
// the nose's skin at height y out to the corner: [x, the angle of its outward normal from +X toward the side]
export const noseAt = (y, z) => { const az = Math.abs(z), xf = xfAt(y); if (az <= ZF) return [xf - BOW * (az / ZF) * (az / ZF), Math.atan(2 * BOW * az / (ZF * ZF))];
  const ca = Math.min(1, (az - ZF) / RCF), sa = Math.sqrt(1 - ca * ca), rx = xf - BOW - XF0; return [XF0 + rx * sa, Math.atan2(ca / RCF, sa / rx)]; };

// ---------------------------------------------------------------- the body shell: rings around the bus stacked from skirt to roof
function shell(S, G, q) {
  const near = q === 0, far = q === 2, arcN = [10, 5, 2][q], cN = [6, 3, 1][q], rN = [4, 2, 1][q], fN = [6, 3, 1][q];
  const xset = new Set([XR0, XF0, BAND0]);
  if (!far) { for (const w of WIN.R.concat(WIN.L)) { xset.add(w[0]); xset.add(w[1]); } for (const d of [DOORS.front, DOORS.rear]) { xset.add(d.x - d.w / 2); xset.add(d.x + d.w / 2); } }
  for (const ax of [AXF, AXR]) for (let k = 0; k <= arcN; k++) xset.add(+(ax - AR * Math.cos((Math.PI * k) / arcN)).toFixed(4));
  const xs = [...xset].sort((a, b) => a - b);
  const rows = (far ? [YB, YS, YT, YW] : [YB, YFL, YFS, YS, YSG, YT, YW]).map((y) => ({ y, d: 0 }));
  for (let k = 1; k <= rN; k++) { const a = ((Math.PI / 2) * k) / rN; rows.push({ y: YW + RR * Math.sin(a), d: RR * (1 - Math.cos(a)) }); }
  const cols = [];
  for (const x of xs) cols.push({ s: 'R', x });
  for (let k = 1; k < cN; k++) cols.push({ s: 'FR', a: k / cN });
  for (let k = 0; k <= fN; k++) cols.push({ s: 'F', t: 1 - (2 * k) / fN });
  for (let k = 1; k < cN; k++) cols.push({ s: 'FL', a: 1 - k / cN });
  for (let k = xs.length - 1; k >= 0; k--) cols.push({ s: 'L', x: xs[k] });
  for (let k = 1; k < cN; k++) cols.push({ s: 'BL', a: k / cN });
  for (let k = 0; k <= fN; k++) cols.push({ s: 'B', t: -1 + (2 * k) / fN });
  for (let k = 1; k < cN; k++) cols.push({ s: 'BR', a: 1 - k / cN });
  const nc = cols.length, nr = rows.length;
  const pos = (c, r) => {
    const y = r.y, d = r.d, xf = xfAt(y) - d * 0.5, xr = -XF + (y > YT ? Math.min(1, (y - YT) / (YW - YT)) * 0.06 : 0) + d * 0.6, a = (c.a || 0) * Math.PI / 2;
    switch (c.s) {
      case 'R': return [c.x, y, HW - d];
      case 'L': return [c.x, y, -HW + d];
      case 'F': return [xf - BOW * c.t * c.t, y, c.t * ZF];
      case 'FR': return [XF0 + (xf - BOW - XF0) * Math.sin(a), y, ZF + (RCF - d) * Math.cos(a)];
      case 'FL': return [XF0 + (xf - BOW - XF0) * Math.sin(a), y, -ZF - (RCF - d) * Math.cos(a)];
      case 'B': return [xr, y, c.t * ZB];
      case 'BL': return [XR0 + (xr - XR0) * Math.sin(a), y, -ZB - (RCB - d) * Math.cos(a)];
      default: return [XR0 + (xr - XR0) * Math.sin(a), y, ZB + (RCB - d) * Math.cos(a)];
    }
  };
  const P = rows.map((r) => cols.map((c) => pos(c, r))), N = [];
  for (let r = 0; r < nr; r++) { N.push([]); for (let c = 0; c < nc; c++) {
    const a = P[r][(c + nc - 1) % nc], b = P[r][(c + 1) % nc], lo = P[Math.max(r - 1, 0)][c], hi = P[Math.min(r + 1, nr - 1)][c];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = hi[0] - lo[0], wy = hi[1] - lo[1], wz = hi[2] - lo[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1; N[r].push([nx / l, ny / l, nz / l]); } }
  const ORDER = ['R', 'FR', 'F', 'FL', 'L', 'BL', 'B', 'BR'], isC = (s) => s.length === 2;
  const sideOf = (a, b) => (a.s === b.s ? a.s : isC(a.s) ? a.s : isC(b.s) ? b.s : ORDER[(ORDER.indexOf(a.s) + 1) % 8]);
  const inAny = (list, x) => list.some((w) => x > w[0] && x < w[1]);
  const E = 1e-6, cls = (s, a, b, y0, y1) => {
    if (y0 >= YW - E) return 'roof';
    const winRow = y0 >= YS - E && y1 <= YT + E;
    if (s === 'R' || s === 'L') {
      const xm = (a.x + b.x) / 2;
      if (s === 'R' && !far && y0 >= YFL - E && y1 <= YT + E && (Math.abs(xm - DOORS.front.x) < DOORS.front.w / 2 || Math.abs(xm - DOORS.rear.x) < DOORS.rear.w / 2)) return near ? 'hole' : 'glass';
      if (winRow && xm > BAND0) return far || inAny(WIN[s], xm) ? 'glass' : 'black';
      return 'paint';
    }
    if (s[0] === 'F') return (far ? winRow : y0 >= YFS - E && y1 <= YSG + E) ? 'glass' : y0 >= (far ? YT : YSG) - E ? 'black' : 'paint';
    return 'paint';
  };
  const K = []; for (let r = 0; r < nr - 1; r++) { K.push([]); for (let c = 0; c < nc; c++) { const a = cols[c], b = cols[(c + 1) % nc]; K[r].push(cls(sideOf(a, b), a, b, rows[r].y, rows[r + 1].y)); } }
  const open = (k) => k === 'glass' || k === 'hole';
  const uvOf = (s, a, b, p) => {
    let proj = s; if (isC(s)) { const am = ((isC(a.s) ? a.a : a.s === s[1] ? 0 : 1) + (isC(b.s) ? b.a : b.s === s[1] ? 0 : 1)) / 2; proj = am < 0.5 ? s[1] : s[0]; }
    const t = p[1] / HGT;
    if (proj === 'R') return uvr(REG.sideR, (p[0] + XF) / LEN, t); if (proj === 'L') return uvr(REG.sideL, (XF - p[0]) / LEN, t);
    if (proj === 'F') return uvr(REG.front, (HW - p[2]) / (2 * HW), t); return uvr(REG.rear, (p[2] + HW) / (2 * HW), t);
  };
  const clip = (p, s) => (s === 'R' || s === 'L' ? [p[0], Math.max(p[1], archY(p[0])), p[2]] : p), inn = (p, n) => [p[0] - n[0] * TH, p[1] - n[1] * TH, p[2] - n[2] * TH];
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc; c++) {
    const c2 = (c + 1) % nc, A = cols[c], B = cols[c2], s = sideOf(A, B), k = K[r][c], y1 = rows[r + 1].y;
    if (k === 'hole' && !near) continue;
    if ((s === 'R' || s === 'L') && archY(A.x) >= y1 - E && archY(B.x) >= y1 - E) continue;
    const pa = clip(P[r][c], s), pb = clip(P[r][c2], s), pc = clip(P[r + 1][c2], s), pd = clip(P[r + 1][c], s), na = N[r][c], nb = N[r][c2], ncn = N[r + 1][c2], nd = N[r + 1][c];
    const emit = (T, m, tex) => { const ua = tex ? uvOf(s, A, B, pa) : [-1, -1], ub = tex ? uvOf(s, A, B, pb) : ua, uc = tex ? uvOf(s, A, B, pc) : ua, ud = tex ? uvOf(s, A, B, pd) : ua;
      const i0 = T.v(pa[0], pa[1], pa[2], na[0], na[1], na[2], m, ua[0], ua[1]), i1 = T.v(pb[0], pb[1], pb[2], nb[0], nb[1], nb[2], m, ub[0], ub[1]), i2 = T.v(pc[0], pc[1], pc[2], ncn[0], ncn[1], ncn[2], m, uc[0], uc[1]), i3 = T.v(pd[0], pd[1], pd[2], nd[0], nd[1], nd[2], m, ud[0], ud[1]); T.i.push(i0, i1, i2, i0, i2, i3); };
    if (k === 'paint') emit(S, s[0] === 'F' && !isC(s) ? MASK : (isC(s) && s[0] === 'F' && uvOf(s, A, B, pa)[1] < 1 - 1024 / 2048 ? MASK : PAINT), true);
    else if (k === 'roof') emit(S, ROOFB, false); else if (k === 'black') emit(S, BLACK, false);
    else if (k === 'glass') { if (near) emit(G, GLASS, false); else emit(S, GLASSD, false); }
    if (!near || rows[r].y < YFL - E || rows[r].y >= YW - E) continue;
    const ia = inn(pa, na), ib = inn(pb, nb), ic = inn(pc, ncn), id = inn(pd, nd), mid = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2, (pa[2] + pc[2]) / 2];
    if (!open(k)) { if (s[0] !== 'B' && !(s[1] === 'B')) S.q4(ib, ia, id, ic, rows[r].y >= YS - E && rows[r].y < YT - E ? IPIL : IWALL); continue; }
    if (s !== 'R' && s !== 'L') continue;
    const edge = (p, q2, ip, iq, solid) => { if (solid) S.q4(p, q2, iq, ip, IDARK, null, [mid[0] - (p[0] + q2[0]) / 2, mid[1] - (p[1] + q2[1]) / 2, 0]); };
    edge(pa, pd, ia, id, !open(K[r][(c + nc - 1) % nc])); edge(pb, pc, ib, ic, !open(K[r][c2]));
    edge(pa, pb, ia, ib, r === 0 || !open(K[r - 1][c])); edge(pd, pc, id, ic, !open(K[r + 1][c]));
  }
  // the roof: from the top ring to a spine along the middle, slightly crowned
  const top = nr - 1, spine = (p) => [Math.max(XR0, Math.min(XF0 - 0.25, p[0])), YROOF + 0.035, 0];
  for (let c = 0; c < nc; c++) { const c2 = (c + 1) % nc, a = P[top][c], b = P[top][c2], sa = spine(a), sb = spine(b), na = N[top][c], nb = N[top][c2];
    const i0 = S.v(a[0], a[1], a[2], na[0] * 0.3, 1, na[2] * 0.3, ROOF), i1 = S.v(b[0], b[1], b[2], nb[0] * 0.3, 1, nb[2] * 0.3, ROOF), i2 = S.v(sb[0], sb[1], sb[2], 0, 1, 0, ROOF), i3 = S.v(sa[0], sa[1], sa[2], 0, 1, 0, ROOF); S.i.push(i0, i1, i2, i0, i2, i3); }
  if (!far) {                                                  // underside and wheel wells
    S.q4([-5.9, YB + 0.03, -1.22], [5.9, YB + 0.03, -1.22], [5.9, YB + 0.03, 1.22], [-5.9, YB + 0.03, 1.22], DARK, null, [0, -1, 0]);
    for (const ax of [AXF, AXR]) for (const sg of [1, -1]) { const z0 = sg * (HW - 0.01), z1 = sg * (HW - 0.78);
      for (let k = 0; k < arcN; k++) { const t0 = (Math.PI * k) / arcN, t1 = (Math.PI * (k + 1)) / arcN, p0 = [ax - AR * Math.cos(t0), ARY + AR * Math.sin(t0)], p1 = [ax - AR * Math.cos(t1), ARY + AR * Math.sin(t1)];
        S.q4([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], DARK, null, [ax - p0[0], ARY - p0[1], 0]); }
      S.q4([ax - AR, YB, z1], [ax + AR, YB, z1], [ax + AR, ARY + AR, z1], [ax - AR, ARY + AR, z1], DARK, null, [0, 0, sg]); }
  }
}

// ---------------------------------------------------------------- a wheel: local Z is the axle, +Z the outside face
export function wheel(S, segs, lugs = true) {
  S.lathe([[0, 0.135, STEEL], [0.045, 0.13, STEEL], [0.075, 0.10, ALU], [0.10, 0.10, ALU], [0.115, 0.05, STEEL], [0.17, 0.05, ALU], [0.19, 0.06, ALU], [0.27, 0.10, ALU], [0.29, 0.115, ALU], [0.30, 0.13, TYRE], [0.40, 0.15, TYRE], [0.465, 0.125, TYRE], [0.49, 0.085, TYRE], [0.49, -0.085, TYRE],
    [0.465, -0.125, TYRE], [0.40, -0.15, TYRE], [0.30, -0.13, ALU], [0.29, -0.115, ALU], [0.27, -0.11, ALU], [0.245, 0.0, ALU], [0.17, 0.02, STEEL], [0.12, 0.02, STEEL], [0.10, -0.05, STEEL], [0, -0.05, STEEL]], segs);
  if (lugs) for (let k = 0; k < 10; k++) { const a = ((k + 0.5) / 10) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), H = (r, t, z) => [r * c - t * s, r * s + t * c, z];      // hand holes: the dark of the drum behind the disc
    S.q4(H(0.205, -0.024, 0.071), H(0.252, -0.03, 0.094), H(0.252, 0.03, 0.094), H(0.205, 0.024, 0.071), DARK, null, [0, 0, 1]); }
  if (lugs) for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, x = 0.142 * Math.cos(a), y = 0.142 * Math.sin(a); S.box(x - 0.014, y - 0.014, 0.05, x + 0.014, y + 0.014, 0.078, STEEL, '-z'); S.box(x - 0.014, y - 0.014, -0.012, x + 0.014, y + 0.014, 0.02, STEEL, '+z'); }
}
export const WHEELS = [[AXF, 1.10, 0, 1], [AXF, -1.10, 1, 1], [AXR, 1.13, 1, 0], [AXR, -1.13, 0, 0], [AXR, 0.79, 0, 0], [AXR, -0.79, 1, 0]];   // x, z, turned round (outside face toward -Z), steers

// ---------------------------------------------------------------- one door leaf: local x 0..LEAF_W from its hinge edge, y from the floor, z = thickness
export const LEAF_W = 0.595, LEAF_H = YT - YFL - 0.03;
export function leaf(S, G) {
  const w = LEAF_W, h = LEAF_H, t = 0.02, f = 0.045;
  S.box(0, 0, -t, f, h, t, BLACK); S.box(w - f, 0, -t, w, h, t, BLACK); S.box(f, 0, -t, w - f, 0.16, t, BLACK); S.box(f, h - 0.07, -t, w - f, h, t, BLACK); S.box(f, 0.98, -t, w - f, 1.03, t, BLACK);
  S.box(w - 0.012, 0.02, -t - 0.012, w + 0.004, h - 0.02, t + 0.012, RUBBER);
  for (const [y0, y1] of [[0.16, 0.98], [1.03, h - 0.07]]) { G.q4([f, y0, 0.006], [w - f, y0, 0.006], [w - f, y1, 0.006], [f, y1, 0.006], GLASS); G.q4([w - f, y0, -0.006], [f, y0, -0.006], [f, y1, -0.006], [w - f, y1, -0.006], GLASS); }
}
// hinge edges of the four leaves [x, z, dir, sign of the swing]: dir +1 = the leaf runs toward +X from its hinge
export const LEAVES = [[DOORS.front.x + 0.6, HW - 0.035, -1, -1, 'F'], [DOORS.front.x - 0.6, HW - 0.035, 1, -1, 'F'], [DOORS.rear.x + 0.6, HW - 0.035, -1, 1, 'R'], [DOORS.rear.x - 0.6, HW - 0.035, 1, 1, 'R']];

// ---------------------------------------------------------------- what is bolted on outside
function extras(S, G, q, o = {}) {
  const near = q === 0, lampSeg = near ? 12 : 6;
  S.box(5.70, 0.33, -1.22, 6.17, 0.66, 1.22, BUMP, '-x'); S.box(-6.17, 0.34, -1.24, -5.80, 0.62, 1.24, BUMP, '+x');
  if (q < 2) for (const sg of [1, -1]) {                                 // headlamp units and the rear lamp stacks
    const lens = (r, m, rim) => (near ? [[0, 0.022, m], [r * 0.7, 0.018, m], [r, 0.004, rim], [r * 1.07, 0.024, rim], [r * 1.2, 0.022, rim], [r * 1.28, 0, rim]] : [[0, 0.014, m], [r, 0.010, rim], [r * 1.25, 0, rim]]), TI = LAMP_I[sg > 0 ? 1 : 0];
    for (let k = 0; k < 6; k++) { const za = sg * (0.54 + 0.115 * k), zb = sg * (0.54 + 0.115 * (k + 1)), A = noseAt(0.85, za)[0] + 0.006, B = noseAt(0.85, zb)[0] + 0.006; S.q4([A, 0.71, za], [B, 0.71, zb], [B, 0.99, zb], [A, 0.99, za], BLACK, null, [1, 0, sg * 0.3]); }      // the dark lamp unit, wrapped round the corner
    for (const [z, r, m] of [[0.66, 0.072, LAMP_H], [0.86, 0.072, LAMP_H], [1.07, 0.046, TI]]) { const [x, ph] = noseAt(0.85, z); S.at(x + 0.008, 0.85, sg * z, Math.PI / 2 - sg * ph, () => S.lathe(lens(r, m, STEEL), lampSeg)); }
    for (const [y, m] of [[1.02, LAMP_T], [1.22, TI], [1.42, LAMP_T], [1.62, LAMP_W]]) S.at(-6.105, y, sg * 1.06, -Math.PI / 2, () => S.lathe(lens(0.06, m, RUBBER), lampSeg));
    S.at(-6.105, 2.30, sg * 1.02, -Math.PI / 2, () => S.lathe(lens(0.048, LAMP_T, RUBBER), lampSeg));
    S.at(-6.105, 2.30, sg * 0.86, -Math.PI / 2, () => S.lathe(lens(0.048, LAMP_A, RUBBER), lampSeg));
    for (const [x, m, w] of [[4.28, LAMP_A, 0.05], [4.10, TI, 0.035], [0.0, LAMP_A, 0.05], [-5.55, LAMP_R, 0.05]]) S.box(x - w, 1.10, sg > 0 ? HW - 0.002 : -HW - 0.012, x + w, 1.145, sg > 0 ? HW + 0.012 : -HW + 0.002, m, sg > 0 ? '-z' : '+z');      // side marker and turn lamps, as parts
  }
  S.box(-6.125, 2.36, -0.42, -6.10, 2.395, 0.42, LAMP_T, '+x');                    // high stop lamp bar
  // LED signs: front (curved with the mask), kerb side behind the first pane, rear
  { const n = near ? 6 : 2, z0 = -0.84, z1 = 0.84, y0 = YSG + 0.045, y1 = YW - 0.035;
    for (let k = 0; k < n; k++) { const za = z1 - ((z1 - z0) * k) / n, zb = z1 - ((z1 - z0) * (k + 1)) / n, e = 0.012;
      S.q4([frontX(y0, za) + e, y0, za], [frontX(y0, zb) + e, y0, zb], [frontX(y1, zb) + e, y1, zb], [frontX(y1, za) + e, y1, za], SIGN_F, [k / n, 0, (k + 1) / n, 1]); } }
  S.q4([3.22, YT - 0.29, HW + 0.004], [4.30, YT - 0.29, HW + 0.004], [4.30, YT - 0.04, HW + 0.004], [3.22, YT - 0.04, HW + 0.004], SIGN_F, [0, 0, 1, 1]);
  if (q < 2) for (const sd of ['R', 'L']) for (const w of WIN[sd]) { const z = sd === 'R' ? HW : -HW; if (w[0] > 4.6) continue; S.box(w[0], YT - 0.40, z - 0.002, w[1], YT - 0.37, z + 0.005, BLACK, sd === 'R' ? '-z' : '+z'); }      // the opening top lights' rail
  S.box(-6.085, 2.44, 0.40, -6.06, 2.74, 1.04, BLACK, '+x'); S.q4([-6.087, 2.47, 0.46], [-6.087, 2.47, 0.98], [-6.087, 2.71, 0.98], [-6.087, 2.71, 0.46], SIGN_B, [0, 0, 1, 1], [-1, 0, 0]);
  if (q < 2) {                                     // the fleet number (four digit places the shader fills per bus), the plate, the windscreen's centre bar
    const digits = (o, du, h, col, fx) => { const w = h * 0.62, M = mat(col, 0.34, 0, 0, 7); for (let k = 0; k < 4; k++) { const a = [o[0] + du[0] * w * (k - 2), o[1], o[2] + du[2] * w * (k - 2)], b = [a[0] + du[0] * w, a[1], a[2] + du[2] * w]; if (fx) { a[0] = frontX(o[1], a[2]) + 0.005; b[0] = frontX(o[1], b[2]) + 0.005; }
      S.q4(a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], M, [k + 0.02, 0, k + 0.98, 1]); } };
    digits([4.05, 2.53, HW + 0.004], [1, 0, 0], 0.105, 0x17358c); digits([5.15, 2.53, -HW - 0.004], [-1, 0, 0], 0.105, 0x17358c); digits([0, 0.81, 0.46], [0, 0, -1], 0.10, 0x17358c, true); digits([-XF - 0.006, 2.14, 0.72], [0, 0, 1], 0.12, 0xf2c010);
    const px = frontX(0.87, -0.46) + 0.014, u0 = uvr(REG.plate, 0, 0), u1 = uvr(REG.plate, 1, 1); S.box(px - 0.03, 0.785, -0.63, px - 0.002, 0.965, -0.29, BUMP, '-x'); S.q4([px, 0.80, -0.30], [px, 0.80, -0.62], [px, 0.95, -0.62], [px, 0.95, -0.30], PAINT, [u0[0], u0[1], u1[0], u1[1]]);
    S.tube([[frontX(YFS, 0) + 0.004, YFS, 0], [frontX(YSG, 0) + 0.004, YSG, 0]], 0.014, 4, BLACK);
  }
  if (near) {                                      // rubbers round every pane and round the doors
    const strip = (x0, y0, x1, y1, sd, d, m) => S.box(x0, y0, sd === 'R' ? HW - 0.002 : -HW - d, x1, y1, sd === 'R' ? HW + d : -HW + 0.002, m, sd === 'R' ? '-z' : '+z');
    for (const sd of ['R', 'L']) for (const w of WIN[sd]) { strip(w[0], YS, w[1], YS + 0.028, sd, 0.007, RUBBER); strip(w[0], YT - 0.028, w[1], YT, sd, 0.007, RUBBER); strip(w[0], YS + 0.028, w[0] + 0.028, YT - 0.028, sd, 0.007, RUBBER); strip(w[1] - 0.028, YS + 0.028, w[1], YT - 0.028, sd, 0.007, RUBBER); }
    for (const d of [DOORS.front, DOORS.rear]) { const a = d.x - d.w / 2, b = d.x + d.w / 2; strip(a - 0.035, YFL, a + 0.008, YT + 0.035, 'R', 0.014, RUBBER); strip(b - 0.008, YFL, b + 0.035, YT + 0.035, 'R', 0.014, RUBBER); strip(a + 0.008, YT - 0.005, b - 0.008, YT + 0.035, 'R', 0.014, RUBBER); }
  }
  // roof: the air-conditioning pod at the rear with a sloped nose, two hatches, clearance lamps
  { const y0 = YROOF - 0.06, y1 = HGT - 0.02, xa = 0.9, xb = 4.7, xc = 5.62, xz = 0.3, U = (x, y, sg) => (sg > 0 ? uvr(REG.sideR, (x + XF) / LEN, y / HGT) : uvr(REG.sideL, (XF - x) / LEN, y / HGT));
    for (const sg of [1, -1]) {                               // the roof fairing: a rail along each edge, flush with the side, sloping down to the roof at the front; the liveries run up onto it
      const zo = sg * (HW - 0.13), zt = sg * (HW - 0.22), zn = sg * 0.78, P = [[xa, y0, zo], [xb, y0, zo], [xc, y0, zo], [xb, y1, zt], [xa, y1, zt]], uv = P.map((p) => U(p[0], p[1], sg)), n = [0, 0.25, sg];
      const id = P.map((p, k) => S.v(p[0], p[1], p[2], n[0], n[1], n[2], PAINT, uv[k][0], uv[k][1])); if (sg > 0) S.i.push(id[0], id[1], id[3], id[0], id[3], id[4], id[1], id[2], id[3]); else S.i.push(id[0], id[3], id[1], id[0], id[4], id[3], id[1], id[3], id[2]);
      S.q4([xa, y1, zt], [xb, y1, zt], [xb, y1, zn], [xa, y1, zn], ROOFB, null, [0, 1, 0]); S.q4([xb, y1, zt], [xc, y0, zo], [xc, y0, zn], [xb, y1, zn], ROOFB, null, [1, 1, 0]);
      S.q4([xa, y0, zn], [xb, y0, zn], [xb, y1, zn], [xa, y1, zn], ROOFB, null, [0, 0, -sg]); S.q4([xb, y0, zn], [xc, y0, zn], [xb, y1, zn], [xb, y1, zn], ROOFB, null, [0, 0, -sg]); S.q4([xz, y0, zo], [xz, y0, zn], [xa, y1, zn], [xa, y1, zt], ROOFB, null, [-1, 1, 0]); S.q4([xz, y0, zo], [xa, y0, zo], [xa, y1, zt], [xa, y1, zt], ROOFB, null, [0, 0, sg]); S.q4([xz, y0, zn], [xa, y0, zn], [xa, y1, zn], [xa, y1, zn], ROOFB, null, [0, 0, -sg]); }
    S.q4([xa, y1 - 0.04, -0.78], [xa, y1 - 0.04, 0.78], [xb, y1 - 0.04, 0.78], [xb, y1 - 0.04, -0.78], ROOFB, null, [0, 1, 0]); S.q4([xb, y1 - 0.04, -0.78], [xb, y1 - 0.04, 0.78], [xc, y0, 0.78], [xc, y0, -0.78], ROOFB, null, [1, 1, 0]); S.q4([xz, y0, -0.78], [xz, y0, 0.78], [xa, y1 - 0.04, 0.78], [xa, y1 - 0.04, -0.78], ROOFB, null, [-1, 1, 0]);
    { const sec = (x, w, yt, c) => [[x, y0, -w], [x, yt - c, -w], [x, yt, -w + c], [x, yt, w - c], [x, yt - c, w], [x, y0, w]], yp = y1 - 0.02; S.loft([sec(-5.68, 0.72, y0 + 0.002, 0.001), sec(-5.50, 0.95, yp, 0.10), sec(-2.15, 0.95, yp, 0.10), sec(-1.82, 0.74, y0 + 0.002, 0.001)], ROOF, [-3.8, y0, 0]); } if (near) for (const sg of [1, -1]) S.box(-5.3, y0 + 0.07, sg * 0.95 - 0.005, -2.2, y1 - 0.08, sg * 0.95 + 0.006, DARK);
    for (const x of [-0.7]) S.box(x - 0.36, YROOF, -0.36, x + 0.36, YROOF + 0.075, 0.36, ROOF, '-y');
    if (near) { for (const z of [-1.0, -0.2, 0, 0.2, 1.0]) S.box(5.60, YROOF - 0.06 + (Math.abs(z) > 0.5 ? -0.05 : 0.035), z - 0.04, 5.68, YROOF - 0.035 + (Math.abs(z) > 0.5 ? -0.05 : 0.035), z + 0.04, LAMP_A);
      S.tube([[-5.85, YROOF - 0.05, -1.0], [-5.85, YROOF + 0.22, -1.0]], 0.05, 8, DARK); } }
  if (q === 2) return;
  // mirrors
  for (const sg of [1, -1]) { const zt = sg * (HW + 0.02), zo = sg * (HW + 0.30);
    S.tube([[5.86, 2.50, zt], [6.12, 2.44, zo], [6.14, 2.10, zo]], 0.018, 6, DARK); { const rs = (y, sh) => { const x0 = 6.09 + sh, x1 = 6.17 - sh, z0 = zo - 0.10 + sh, z1 = zo + 0.10 - sh, c = 0.022 * (1 - sh / 0.04); return [[x0, y, z0 + c], [x0 + c, y, z0], [x1 - c, y, z0], [x1, y, z0 + c], [x1, y, z1 - c], [x1 - c, y, z1], [x0 + c, y, z1], [x0, y, z1 - c]]; }; S.loft([rs(1.70, 0.039), rs(1.715, 0.018), rs(1.75, 0), rs(2.07, 0), rs(2.105, 0.018), rs(2.12, 0.039)], BUMP, [6.13, 1.91, zo]); } for (let k = 0; k < 3; k++) S.q4([6.172, 1.80 + k * 0.08, zo + 0.07], [6.172, 1.80 + k * 0.08, zo - 0.07], [6.172, 1.84 + k * 0.08, zo - 0.07], [6.172, 1.84 + k * 0.08, zo + 0.07], mat(k === 1 ? 0xe8e8e4 : 0xc8281e, 0.4), null, [1, 0, 0]); S.q4([6.088, 1.74, zo - 0.085], [6.088, 1.74, zo + 0.085], [6.088, 2.08, zo + 0.085], [6.088, 2.08, zo - 0.085], mat(0x8d99a6, 0.05, 1), null, [-1, 0, 0]); }
  if (!near) return;
  // wipers, bike rack (folded up against the nose), tow eyes
  for (const sg of [1, -1]) { const zb = sg * 0.30, ze = sg * 0.86; S.tube([[frontX(1.06, zb) + 0.03, 1.06, zb], [frontX(1.55, (zb + ze) / 2) + 0.035, 1.55, (zb + ze) / 2 + sg * 0.05], [frontX(1.95, ze) + 0.03, 1.95, ze]], 0.011, 5, DARK);
    S.box(frontX(1.6, ze) + 0.012, 1.45, ze - 0.02 * sg - 0.012, frontX(1.6, ze) + 0.032, 2.15, ze - 0.02 * sg + 0.012, RUBBER); }
  if (o.rack) { const x = 6.22, z = 0.92; S.tube([[x, 0.50, -z], [x + 0.03, 1.22, -z], [x + 0.03, 1.22, z], [x, 0.50, z]], 0.02, 6, STEEL, true);
    S.tube([[x + 0.01, 0.74, -z], [x + 0.01, 0.74, z]], 0.016, 6, STEEL); S.tube([[x + 0.02, 0.98, -z], [x + 0.02, 0.98, z]], 0.016, 6, STEEL);
    for (const zz of [-0.5, 0.5]) { S.tube([[x + 0.035, 0.50, zz], [x + 0.06, 1.20, zz]], 0.014, 5, DARK); S.box(6.14, 0.44, zz - 0.04, x + 0.02, 0.52, zz + 0.04, DARK); } }
}

// ---------------------------------------------------------------- inside
// seats: [x, y, z, yaw] = the sitter's hip point and facing; yaw 0 faces +X (forward), +PI/2 faces -Z (toward the street side), -PI/2 faces +Z (the kerb).
export const SEATS = (() => {
  const s = [], hy = (x) => floorAt(x) + 0.50, add = (x, z, yaw, y) => s.push([x, y === undefined ? hy(x) : y, z, yaw]);
  for (const x of [3.55, 3.05]) { add(x, 0.98, Math.PI / 2, 1.24); add(x, -0.98, -Math.PI / 2, 1.24); }                // on the front wheel housings, facing the aisle
  for (const x of [2.25, 1.78, 1.31]) { add(x, 1.0, Math.PI / 2); add(x, -1.0, -Math.PI / 2); }                        // the fold-up benches (wheelchair places)
  for (const x of [0.55, -0.22, -0.99]) for (const z of [0.62, 1.03]) add(x, z, 0);
  for (const x of [0.55, -0.22, -0.99, -1.76, -2.53]) for (const z of [-0.62, -1.03]) add(x, z, 0);
  for (const x of [-3.62, -4.08, -4.54]) { add(x, 1.0, Math.PI / 2, 1.33); add(x, -1.0, -Math.PI / 2, 1.33); }        // over the rear wheels
  for (const z of [-1.0, -0.5, 0, 0.5, 1.0]) add(-5.02, z, 0);
  return s;
})();
export const DRIVER = [4.98, 1.12, -0.70];
const pillarsOf = (w) => { const o = []; for (let k = 0; k + 1 < w.length; k++) if (w[k][0] - w[k + 1][1] < 0.2 && w[k][1] < 4.6) o.push((w[k][0] + w[k + 1][1]) / 2); return o; };
export const CORDS = [].concat(pillarsOf(WIN.R).map((x) => [x, 1.82, HW - TH - 0.012]), pillarsOf(WIN.L).map((x) => [x, 1.82, -HW + TH + 0.012]));

function seat(S, m, tall) {      // local: hip at the origin, facing +X
  const top = tall ? 0.72 : 0.50;
  const pr = [[0.24, -0.075], [0.16, -0.055], [-0.10, -0.07], [-0.19, -0.03], [-0.235, 0.10], [-0.275, top - 0.06], [-0.285, top]];
  // Taper the moulded shell at the front lip and upper corners.
  if (!tall) { pr[0].push(0.025); pr[5].push(0.008); pr[6].push(0.048); }
  S.ribbon(pr, 0.028, -0.215, 0.215, m);
  if (tall) return;
  // The blue inserts follow the sitter-facing surface of the moulded shell.
  for (const start of [1, 4]) {
    const edge = (k) => {
      const dx = pr[k+1][0] - pr[k-1][0], dy = pr[k+1][1] - pr[k-1][1];
      const scale = 0.016 / Math.hypot(dx, dy);
      return [pr[k][0] + dy * scale, pr[k][1] - dx * scale];
    };
    const a = edge(start), b = edge(start + 1);
    const point = (u, z) => [a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u, z];
    const widths = [0.143, 0.166, 0.166, 0.143], stops = [0, 0.075, 0.925, 1];
    for (let i = 1; i < stops.length; i++) {
      const u = stops[i-1], v = stops[i];
      S.q4(point(u,-widths[i-1]), point(v,-widths[i]), point(v,widths[i]), point(u,widths[i-1]),
        ISEAT, null, [b[1]-a[1], a[0]-b[0], 0]);
    }
  }
}
function interior(S, G) {
  const zi = HW - TH, XB = -5.32, XD = 4.30, DH = DOORS.front.w / 2;                 // inner wall, rear wall, the line behind the driver
  // floors, steps, rear wall, the front lining under the windscreen
  S.q4([XSTEP1, YFL, -zi], [XSTEP1, YFL, zi], [5.72, YFL, zi], [5.72, YFL, -zi], IFLOOR, null, [0, 1, 0]); S.q4([5.72, YFL, -0.9], [5.72, YFL, 0.9], [5.99, YFL, 0.9], [5.99, YFL, -0.9], IFLOOR, null, [0, 1, 0]);
  S.box(XSTEP2, YFL, -zi, XSTEP1, (YFL + YF2) / 2, zi, IFLOOR, '-y-x'); S.box(XB, YFL, -zi, XSTEP2, YF2, zi, IFLOOR, '-y-x');
  // Access covers in the raised rear aisle. Leave the speckled flooring visible inside each rim.
  const hatchRim = I(0x666663, 0.55, 0.35);
  for (const centre of [-4.53, -3.83]) {
    const rim = (inset) => {
      const points = [];
      for (let corner = 0; corner < 4; corner++) {
        const cx = centre + (corner === 0 || corner === 3 ? 0.16 : -0.16);
        const cz = corner < 2 ? 0.22 : -0.22;
        for (let segment = 0; segment <= 3; segment++) {
          const angle = (corner + segment / 3) * Math.PI / 2;
          points.push([cx + (0.08 - inset) * Math.cos(angle), YF2 + 0.002,
            cz + (0.08 - inset) * Math.sin(angle)]);
        }
      }
      return points;
    };
    const outer = rim(0), inner = rim(0.013);
    for (let i = 0; i < outer.length; i++) {
      const next = (i + 1) % outer.length;
      S.q4(outer[i], outer[next], inner[next], inner[i], hatchRim, null, [0, 1, 0]);
    }
  }
  for (const [x, y] of [[XSTEP1, (YFL + YF2) / 2], [XSTEP2, YF2]]) S.box(x - 0.05, y - 0.02, -zi, x + 0.004, y + 0.004, zi, IYEL);
  S.box(DOORS.front.x - DH, YFL - 0.01, zi - 0.06, DOORS.front.x + DH, YFL + 0.004, HW - 0.005, IYEL); S.box(DOORS.rear.x - DH, YFL - 0.01, zi - 0.06, DOORS.rear.x + DH, YFL + 0.004, HW - 0.005, IYEL);
  S.q4([XD - 0.10, YFL + 0.004, -0.2], [XD - 0.10, YFL + 0.004, zi], [XD - 0.02, YFL + 0.004, zi], [XD - 0.02, YFL + 0.004, -0.2], IYEL, null, [0, 1, 0]);      // the yellow line behind the driver
  S.q4([XB, YF2, -zi], [XB, YF2, zi], [XB, 2.8, zi], [XB, 2.8, -zi], IWALL, null, [1, 0, 0]);
  S.box(5.52, YSG, -1.15, 5.74, 2.80, 1.15, IDARK, '+x+y');
  // ceiling: wall top, advert rail, light strip, the flat middle; the same on both sides (profile in local x = -z, turned to run along the bus)
  for (const sg of [1, -1]) S.at(0, 0, 0, sg > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
    const a = sg > 0 ? XB : -5.9, b = sg > 0 ? 5.9 : -XB, P = (z, y) => [-(z), y];     // local x = -world z (sg>0) / +world z (sg<0)
    const pr = [P(zi, YT - 0.02), P(zi - 0.02, YT + 0.06), P(zi - 0.20, 2.70), P(zi - 0.42, 2.775), P(zi - 0.50, 2.79), P(0, 2.80)];
    S.ribbon(pr.slice(0, 2), 0.01, a, a + 0.2, ICEIL);
    const start = a + 0.2, end = b - 0.5;
    const pitch = (end - start) / 6;
    for (let bay = 0; bay < 6; bay++) {
      const left = start + bay * pitch, right = start + (bay + 1) * pitch;
      const diffuserEnd = bay === 5 ? end : right - 0.10;
      S.ribbon(pr.slice(0, 2), 0.01, left, diffuserEnd, ILIGHT, ILIGHT, false);
      if (bay < 5) S.ribbon(pr.slice(0, 2), 0.01, diffuserEnd, right, ICEIL, ICEIL, false);
    }
    S.ribbon(pr.slice(0, 2), 0.01, b - 0.5, b, ICEIL);
    S.ribbon(pr.slice(1, 4), 0.01, a, b, ICEIL);
    S.ribbon(pr.slice(3), 0.01, a, b, mat(0xd6d9db, 0.65, 0, 0, 2.25));
  });
  for (const sg of [1, -1]) for (let k = 0; k < 9; k++) {       // advert cards on the sloped rail
    const x0 = -4.9 + k * 1.08, x1 = x0 + 1.0, n = (k * 3 + (sg > 0 ? 0 : 4)) % 8, za = sg * (zi - 0.035), zb = sg * (zi - 0.185), u0 = uvr(REG.ads, n / 8, 0), u1 = uvr(REG.ads, (n + 1) / 8, 1);
    const p0 = [sg > 0 ? x1 : x0, 2.560, za], p1 = [sg > 0 ? x0 : x1, 2.560, za], p2 = [sg > 0 ? x0 : x1, 2.676, zb], p3 = [sg > 0 ? x1 : x0, 2.676, zb];
    S.q4(p0, p1, p2, p3, IPIC, [u0[0], u0[1], u1[0], u1[1]], [0, -1, -sg]);
  }
  // Slotted air outlets along the sides of the raised central ceiling.
  const grille = I(0x939598, 0.70), slot = I(0x43454a, 0.78);
  for (const side of [-1, 1]) {
    const face = (x0, x1, z0, z1, offset, material) => {
      const point = (x, z) => [x, 2.80 - 0.01 * z / (zi - 0.50) - offset, side * z];
      S.q4(point(x0,z0), point(x1,z0), point(x1,z1), point(x0,z1), material, null, [0,-1,0]);
    };
    for (const x of [-4.45, -2.65, -0.85, 0.95, 2.75, 4.55]) {
      face(x, x + 0.66, 0.54, 0.72, 0.008, grille);
      for (let row = 0; row < 6; row++) {
        const z = 0.556 + row * 0.024;
        face(x + 0.04, x + 0.62, z, z + 0.010, 0.009, slot);
      }
    }
  }
  // wheel housings
  for (const sg of [1, -1]) { S.box(AXF - 0.66, YFL, sg > 0 ? 0.66 : -zi, AXF + 0.66, 1.06, sg > 0 ? zi : -0.66, IHOUSE, '-y'); S.box(AXR - 0.68, YF2, sg > 0 ? 0.54 : -zi, AXR + 0.68, 1.15, sg > 0 ? zi : -0.54, IHOUSE, '-y'); }
  S.box(XB, YF2, -zi, -4.76, 1.14, zi, IHOUSE, '-y-x');                                             // the plinth under the back row
  // seats and their legs
  for (const [x, y, z, yaw] of SEATS) { S.at(x, y, z, yaw, () => { seat(S, ISHELL, false); }); const fl = floorAt(x) + 0.001, base = y - 0.11;
    if (base - fl > 0.5 || (x < -4.7)) continue; S.box(x - 0.03, fl, z - 0.03, x + 0.03, base, z + 0.03, IDARK, '-y+y'); }
  // Moulded handholds span the tops of the paired forward-facing seats.
  for (const [x, y, z, yaw] of SEATS) {
    if (yaw !== 0 || x < -4.7) continue;
    S.at(x, y, z, yaw, () => {
      S.tube([[-0.294, 0.44, -0.18], [-0.311, 0.55, -0.177],
        [-0.315, 0.583, -0.147], [-0.315, 0.583, 0.147],
        [-0.311, 0.55, 0.177], [-0.294, 0.44, 0.18]], 0.016, 4, ISHELL);
    });
  }
  for (const x of [1.25, -2.0]) { const u = uvr(REG.screen, 0, 0), w = uvr(REG.screen, 1, 1), SC = I(0xffffff, 0.3, 0, 7); S.box(x - 0.03, 2.43, -0.33, x + 0.03, 2.72, 0.33, IDARK); S.tube([[x, 2.70, 0], [x, 2.80, 0]], 0.02, 5, IDARK);
    S.q4([x - 0.031, 2.45, 0.31], [x - 0.031, 2.45, 0.01], [x - 0.031, 2.70, 0.01], [x - 0.031, 2.70, 0.31], SC, [u[0], u[1], w[0], w[1]], [-1, 0, 0]); S.q4([x - 0.031, 2.45, -0.01], [x - 0.031, 2.45, -0.31], [x - 0.031, 2.70, -0.31], [x - 0.031, 2.70, -0.01], SC, [u[0], u[1], w[0], w[1]], [-1, 0, 0]);
    S.q4([x + 0.031, 2.45, -0.31], [x + 0.031, 2.45, -0.01], [x + 0.031, 2.70, -0.01], [x + 0.031, 2.70, -0.31], SC, [u[0], u[1], w[0], w[1]], [1, 0, 0]); S.q4([x + 0.031, 2.45, 0.01], [x + 0.031, 2.45, 0.31], [x + 0.031, 2.70, 0.31], [x + 0.031, 2.70, 0.01], SC, [u[0], u[1], w[0], w[1]], [1, 0, 0]); }
  S.box(5.40, 2.30, -1.12, 5.52, 2.46, -0.30, IDARK); S.box(5.30, 1.9, -1.2, 5.34, 2.2, -1.0, IDARK); S.box(4.95, 0.56, -1.19, 5.45, 1.02, -1.08, IDARK); S.tube([[5.30, 0.95, -1.1], [5.22, 1.12, -1.1]], 0.016, 5, IDARK);      // the driver's sun visor, inside mirror, side console and its lever
  // grab rails overhead, stanchions at the seats and the doors, stop strips on the pillars
  const POLE = 0.017, RX = DOORS.rear.x, rail = (z) => [[XD - 0.1, 2.80, z], [XD - 0.1, 2.24, z], [XSTEP1 + 0.1, 2.24, z], [XSTEP2 - 0.25, 2.44, z], [-4.75, 2.44, z], [-4.75, 2.80, z]];
  for (const sg of [1, -1]) { S.tube(rail(sg * 0.42), POLE, 6, IYEL);
    for (const x of [2.52, 1.05]) S.tube([[x, YFL, sg * 0.42], [x, 2.24, sg * 0.42]], POLE, 6, IYEL);
    for (const x of sg > 0 ? [-0.60] : [-0.60, -2.14]) S.tube([[x, YFL + 0.98, sg * 0.42], [x, 2.24, sg * 0.42]], POLE, 6, IYEL);
    // The step stanchion bends inward to meet the sloping overhead rail.
    const stepX = XSTEP2 - 0.02;
    const railY = 2.24 + 0.20 * (stepX - (XSTEP1 + 0.1)) / (XSTEP2 - 0.25 - (XSTEP1 + 0.1));
    S.tube([[stepX, YF2, sg * 0.50], [stepX, railY - 0.20, sg * 0.50],
      [stepX, railY - 0.15, sg * 0.49], [stepX, railY - 0.04, sg * 0.43],
      [stepX, railY, sg * 0.42]], POLE, 6, IYEL);
    for (const x of [1.8, -1.3]) S.tube([[x, 2.24, sg * 0.42], [x, 2.80, sg * 0.42]], POLE, 6, IYEL); }
  for (const x of [RX - DH - 0.06, RX + DH + 0.06]) { S.tube([[x, YFL, 0.80], [x, 2.79, 0.80]], POLE, 6, IYEL); S.box(x - 0.015, YFL, 0.80, x + 0.015, 1.25, zi, IHOUSE); G.q4([x, 1.25, 0.80], [x, 1.25, zi], [x, 1.95, zi], [x, 1.95, 0.80], IGLASS); G.q4([x, 1.25, zi], [x, 1.25, 0.80], [x, 1.95, 0.80], [x, 1.95, zi], IGLASS); }
  S.tube([[XD, YFL, 0.72], [XD, 2.80, 0.72]], POLE, 6, IDARK); S.tube([[5.66, YFL, 0.30], [5.66, 1.3, 0.30], [5.36, 1.3, 0.30]], POLE, 6, IDARK);
  for (const [x, y, z] of CORDS) { const s = Math.sign(z); S.box(x - 0.018, YS + 0.08, z - 0.006, x + 0.018, YT - 0.1, z + 0.006, IYEL); S.box(x - 0.022, y - 0.03, z - s * 0.016, x + 0.022, y + 0.03, z + 0.006 * s + 0.0, IRED); }
  // the driver's place: platform, seat, dash, wheel, screen, partition; fare box and reader; the STOP REQUESTED sign
  S.box(XD, YFL, -zi, 5.9, 0.56, -0.2, ISTEP, '-y'); S.at(DRIVER[0], DRIVER[1], DRIVER[2], 0, () => { seat(S, ISEATD, true); S.box(-0.12, -0.52, -0.12, 0.12, -0.10, 0.12, IDARK); });
  S.box(5.52, 0.56, -zi, 5.84, 1.14, -0.2, IDARK, '-y'); S.ribbon([[5.50, 1.10], [5.62, 1.30], [5.84, 1.24]], 0.03, -1.13, -0.28, IDARK);
  { const u = uvr(REG.screen, 0, 0), w = uvr(REG.screen, 1, 1); S.q4([5.515, 1.135, -0.50], [5.515, 1.135, -0.90], [5.60, 1.275, -0.90], [5.60, 1.275, -0.50], I(0xffffff, 0.3, 0, 7), [u[0], u[1], w[0], w[1]], [-1, 0.5, 0]);
    const d0 = uvr(REG.dash, 0, 0), d1 = uvr(REG.dash, 1, 1); S.q4([5.53, 0.86, -0.25], [5.53, 0.86, -1.15], [5.53, 1.08, -1.15], [5.53, 1.08, -0.25], IPIC, [d0[0], d0[1], d1[0], d1[1]], [-1, 0, 0]); }
  { const c = [5.40, 1.16, DRIVER[2]], pts = []; for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, r = 0.225, ca = Math.cos(a) * r, sa = Math.sin(a) * r; pts.push([c[0] + ca * 0.42, c[1] + ca * 0.91, c[2] + sa]); }
    S.tube(pts, 0.017, 6, IDARK, true); S.tube([[5.62, 0.9, c[2]], c], 0.03, 6, IDARK); S.tube([pts[3], pts[10]], 0.014, 5, IDARK); S.tube([c, pts[0]], 0.014, 5, IDARK); }
  S.box(XD - 0.02, 0.56, -zi, XD + 0.02, 1.45, -0.22, IDARK); S.box(XD, 0.56, -0.22, 5.35, 1.30, -0.18, IDARK);
  for (const [a, b] of [[[XD, 1.45, -zi], [XD, 1.45, -0.22]], [[XD, 1.30, -0.20], [5.35, 1.30, -0.20]]]) { const y1 = 2.25; G.q4(a, b, [b[0], y1, b[2]], [a[0], y1, a[2]], IGLASS); G.q4(b, a, [a[0], y1, a[2]], [b[0], y1, b[2]], IGLASS); }
  S.tube([[XD, 0.56, -0.20], [XD, 2.74, -0.20]], POLE, 6, IDARK);
  { const f0 = uvr(REG.fare, 0, 0), f1 = uvr(REG.fare, 1, 1), x = 5.36, z = 0.02; S.box(x - 0.13, YFL, z - 0.13, x + 0.13, 1.30, z + 0.13, ISTEEL, '-y'); S.q4([x - 0.131, 0.80, z + 0.12], [x - 0.131, 0.80, z - 0.12], [x - 0.131, 1.29, z - 0.12], [x - 0.131, 1.29, z + 0.12], IPIC, [f0[0], f0[1], f1[0], f1[1]], [-1, 0, 0]);
    const r0 = uvr(REG.reader, 0, 0), r1 = uvr(REG.reader, 1, 1); S.box(5.26, 1.30, 0.24, 5.34, 1.52, 0.36, IDARK); S.q4([5.259, 1.31, 0.355], [5.259, 1.31, 0.245], [5.259, 1.51, 0.245], [5.259, 1.51, 0.355], I(0xffffff, 0.3, 0, 7), [r0[0], r0[1], r1[0], r1[1]], [-1, 0, 0]); }
  { const u = uvr(REG.stop, 0, 0), w = uvr(REG.stop, 1, 1); S.box(4.06, 2.58, -0.36, 4.12, 2.76, 0.36, IDARK); S.q4([4.059, 2.595, 0.34], [4.059, 2.595, -0.34], [4.059, 2.745, -0.34], [4.059, 2.745, 0.34], I(0xffffff, 0.4, 0, 6), [u[0], u[1], w[0], w[1]], [-1, 0, 0]); }
}

// ---------------------------------------------------------------- a seated rider: hip at the origin, facing +X (the driver is one too)
// surface kinds 10 coat, 11 trousers and hat, 12 skin: tinted per rider in the shader. v = 0 bare head, 1 a hat, a thick coat and a bag on the lap.
export function rider(S, v) {
  const COAT = mat(0xffffff, 0.85, 0, 0, 10), LEG = mat(0xffffff, 0.9, 0, 0, 11), SKIN = mat(0xb98a6e, 0.6, 0, 0, 12), HAIR = I(0x18130f, 0.85), SHOE = I(0x0d0d0e, 0.6), BAG = I(0x1b1d22, 0.8), HAT = I(0x17181c, 0.95), f = v ? 0.025 : 0;
  for (const sg of [1, -1]) { const z0 = sg > 0 ? 0.03 : -0.17, z1 = sg > 0 ? 0.17 : -0.03, a0 = sg > 0 ? 0.20 + f : -0.29 - f, a1 = sg > 0 ? 0.29 + f : -0.20 - f, b0 = sg > 0 ? 0.13 : -0.25 - f, b1 = sg > 0 ? 0.25 + f : -0.13;
    S.box(-0.10, -0.05, z0, 0.37, 0.09, z1, LEG); S.box(0.27, -0.45, z0 + 0.01, 0.38, -0.05, z1 - 0.01, LEG, '+y'); S.box(0.26, -0.50, z0, 0.47, -0.43, z1, SHOE, '-y');
    S.box(-0.18, 0.20, a0, -0.05, 0.47, a1, COAT, '-y'); S.box(-0.09, 0.11, b0, 0.21, 0.205, b1, COAT); }
  const rs = (y, cx, hx, hz) => { const c = Math.min(0.05, hx * 0.45, hz * 0.45); return [[cx - hx, y, -hz + c], [cx - hx + c, y, -hz], [cx + hx - c, y, -hz], [cx + hx, y, -hz + c], [cx + hx, y, hz - c], [cx + hx - c, y, hz], [cx - hx + c, y, hz], [cx - hx, y, hz - c]]; };
  S.loft([rs(-0.02, -0.07, 0.12 + f, 0.19 + f), rs(0.28, -0.10, 0.12 + f, 0.20 + f), rs(0.46, -0.125, 0.115 + f, 0.225 + f), rs(0.53, -0.12, 0.085, 0.13), rs(0.575, -0.11, 0.055, 0.065), rs(0.58, -0.11, 0.051, 0.051)], COAT, [-0.1, 0.25, 0]);
  S.ball([-0.095, 0.685, 0], [0.098, 0.118, 0.086], 10, 7, (i, j, n) => { const back = j > 2 && j < n - 3; return v ? (i < 3 ? HAT : i < 5 && back ? HAIR : SKIN) : i < 2 || (i < 5 && back) || (i < 3 && j > 0 && j < n - 1) ? HAIR : SKIN; });
  S.loft([rs(0.50, -0.105, 0.05, 0.05), rs(0.60, -0.10, 0.05, 0.05)], SKIN, [-0.1, 0.55, 0]);      // the neck
  if (v) S.loft([rs(0.725, -0.095, 0.103, 0.092), rs(0.75, -0.095, 0.103, 0.092)], HAT, [-0.095, 0.73, 0]);      // the hat's rolled edge
  if (v) S.box(0.0, 0.09, -0.15, 0.27, 0.31, 0.15, BAG, '-y');
}
// ---------------------------------------------------------------- one level of detail: 0 near, 1 mid, 2 far
export function build(q, o = {}) {
  const body = new Soup(), glass = new Soup(), out = { body, glass };
  shell(body, glass, q); extras(body, glass, q, o);
  if (q === 0) { interior(body, glass); out.wheel = new Soup(); wheel(out.wheel, 20); out.leaf = new Soup(); out.leafGlass = new Soup(); leaf(out.leaf, out.leafGlass); out.riders = [0, 1].map((v) => { const R = new Soup(); rider(R, v); return R; }); }
  else {
    for (const [x, z, flip] of WHEELS) { if (q === 2 && Math.abs(z) < 1) continue; body.at(x, RADIUS, z, flip ? Math.PI : 0, () => { if (q === 1) wheel(body, 12, false); else body.lathe([[0, 0.10, ALU], [0.29, 0.11, TYRE], [0.49, 0.10, TYRE], [0.49, -0.1, TYRE]], 8); }); }
  }
  return out;
}
