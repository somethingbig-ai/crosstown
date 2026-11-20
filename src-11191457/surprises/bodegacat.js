// surprises/bodegacat.js: the bodega cat (surprises lane, Nov 16). In a deli a cat sleeps in a loaf on a tray of bread on the register counter.
// Walk up: "E  pet the cat". It lifts its head, blinks slowly, purrs, stands, hops down and follows you out of the shop and down the street
// (about 50 s or 80 m), then sits down and stays. Pet it again where it sits and it purrs. When you are far away it is back on its bread.
//   ?bodegacat=0        off (index.js never fetches this file)
//   ?surshow=bodegacat  stand the player at the counter by the cat (where the map has no deli: a cat asleep on the ground two steps ahead)
//   ?catcoat=0|1|2      orange tabby / grey tabby / tuxedo (default: by shop)
//   ?catheel=0          it only ever walks behind you along your own path (as first shot); default: in the open it trots two metres ahead and to one side, in the camera's view
//   ?catchirp=0         no chirp when it wakes (the purr stays)
// All of it is code: one CPU-moved mesh (body lofted through spine stations, head, legs by two-bone IK, tail chain, ears, eyes, whiskers), a
// static bread tray and a soft contact shadow: 3 draw calls while the deli is near, nothing drawn and nothing computed beyond one distance
// test when it is not. Its own shader takes the shop's light inside (the interiors are unlit, baked) and the day's light in the street.
// Frame of the cat: x forward, y up, z to its right, metres at SC = 1; the mesh matrix scales it.
import * as THREE from 'three';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t, TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const SC = 1.2;      // a well-fed shop cat, a little larger than life so it reads from the door

// ------------------------------------------------------------------------------------------------ poses
// spine stations rump -> neck: x, y, half width, half height
const SP_STAND = [-0.218, 0.212, 0.012, 0.012, -0.192, 0.214, 0.05, 0.056, -0.13, 0.215, 0.064, 0.072, -0.04, 0.206, 0.062, 0.07, 0.06, 0.2, 0.067, 0.077, 0.15, 0.206, 0.06, 0.075, 0.215, 0.245, 0.046, 0.055, 0.262, 0.285, 0.04, 0.042];
const SP_LOAF = [-0.2, 0.06, 0.02, 0.02, -0.176, 0.075, 0.072, 0.07, -0.11, 0.09, 0.098, 0.095, -0.03, 0.1, 0.095, 0.102, 0.05, 0.099, 0.09, 0.101, 0.12, 0.092, 0.077, 0.09, 0.165, 0.1, 0.056, 0.066, 0.19, 0.115, 0.045, 0.046];
const SP_SIT = [-0.137, 0.04, 0.02, 0.02, -0.117, 0.06, 0.066, 0.06, -0.072, 0.086, 0.087, 0.086, -0.022, 0.14, 0.08, 0.086, 0.03, 0.2, 0.071, 0.08, 0.07, 0.256, 0.06, 0.07, 0.092, 0.306, 0.046, 0.052, 0.106, 0.34, 0.04, 0.041];
export const TN = 9, TSEG = 0.036;
const TAIL_LOAF = [1.2, 1.65, 1.95, 2.6, 3.0, 3.05, 3.05, 3.1, 3.1], TAIL_SIT = [0.9, 1.5, 2.0, 2.5, 2.9, 3.1, 3.25, 3.4, 3.5];
export function mkPose() { return { sp: new Float64Array(32), head: new Float64Array(4), att: new Float64Array(12), foot: new Float64Array(12), hock: new Float64Array(2), tail: new Float64Array(2 + TN * 2), eye: 1, floor: 1, ear: 0 }; }
const PK = ['sp', 'head', 'att', 'foot', 'hock', 'tail'];
export function mixPose(a, b, t, o) { for (const k of PK) { const A = a[k], B = b[k], O = o[k]; for (let i = 0; i < O.length; i++) O[i] = A[i] + (B[i] - A[i]) * t; } o.eye = lerp(a.eye, b.eye, t); o.floor = lerp(a.floor, b.floor, t); o.ear = lerp(a.ear, b.ear, t); return o; }
const set3 = (A, k, x, y, z) => { A[k * 3] = x; A[k * 3 + 1] = y; A[k * 3 + 2] = z; };
// legs: 0 front left (z < 0), 1 front right, 2 hind left, 3 hind right. Gait: diagonal pairs, the hind foot a touch behind its front partner.
const GOFF = [0, 0.5, 0.56, 0.06];
export const strideLen = (sp) => lerp(0.25, 0.58, sp);
function gaitFoot(o, k, restX, z, ph, amp, sp) {
  const D = lerp(0.64, 0.42, sp), st = strideLen(sp) * D * amp; let x, y = 0; ph -= Math.floor(ph);
  if (ph < D) x = restX + st * (0.5 - ph / D); else { const u = (ph - D) / (1 - D), e = u * u * (3 - 2 * u); x = restX + st * (-0.5 + e); y = (0.028 + 0.03 * sp) * amp * Math.sin(Math.PI * u); }
  set3(o.foot, k, x, y, z);
}
// standing and walking: ph = gait phase (cycles), amp 0..1 = how much of a stride, sp 0..1 = walk..run, t = seconds (tail sway)
export function poseStand(o, ph, amp, sp, t) {
  const bob = amp * 0.005 * Math.sin(TAU * 2 * ph + 0.6); for (let i = 0; i < 32; i++) o.sp[i] = SP_STAND[i]; for (let i = 0; i < 8; i++) o.sp[i * 4 + 1] += bob * (i < 4 ? 1 : -1) + sp * amp * -0.012;
  o.head[0] = 0.294; o.head[1] = 0.3 - sp * amp * 0.02; o.head[2] = 0.1; o.head[3] = 0;
  set3(o.att, 0, 0.15, 0.202, -0.03); set3(o.att, 1, 0.15, 0.202, 0.03); set3(o.att, 2, -0.135, 0.2, -0.034); set3(o.att, 3, -0.135, 0.2, 0.034);
  gaitFoot(o, 0, 0.16, -0.04, ph + GOFF[0], amp, sp); gaitFoot(o, 1, 0.16, 0.04, ph + GOFF[1], amp, sp); gaitFoot(o, 2, -0.17, -0.05, ph + GOFF[2], amp, sp); gaitFoot(o, 3, -0.17, 0.05, ph + GOFF[3], amp, sp);
  o.hock[0] = -0.04; o.hock[1] = 0.075; o.tail[0] = -0.2; o.tail[1] = 0.228;
  // the tail straight up with a hook at the tip: a cat that is pleased to be walking with you
  for (let i = 0; i < TN; i++) { const s = i / (TN - 1); o.tail[2 + i * 2] = lerp(0.55, 1.5, smooth(0, 0.42, s)) + 1.25 * smooth(0.62, 1, s) - sp * amp * 0.5 * (1 - s); o.tail[3 + i * 2] = 0.3 * Math.sin(t * 2.3 - s * 2.2) * s; }
  o.eye = 1; o.floor = 1; o.ear = 0; return o;
}
// asleep in a loaf: legs folded away under the body, the tail laid along the flank; up 0..1 lifts the head, look = head yaw (+ = to its right)
export function poseLoaf(o, t, up, look) {
  const br = Math.sin(t * 1.9) * (1 - up * 0.5); for (let i = 0; i < 32; i++) o.sp[i] = SP_LOAF[i]; for (let i = 2; i < 6; i++) { o.sp[i * 4 + 2] *= 1 + 0.018 * br; o.sp[i * 4 + 3] *= 1 + 0.03 * br; }
  o.head[0] = lerp(0.224, 0.2, up); o.head[1] = lerp(0.122, 0.2, up) + 0.002 * br; o.head[2] = lerp(0.2, -0.06, up); o.head[3] = look * up;
  set3(o.att, 0, 0.11, 0.06, -0.04); set3(o.att, 1, 0.11, 0.06, 0.04); set3(o.att, 2, -0.1, 0.06, -0.06); set3(o.att, 3, -0.1, 0.06, 0.06);
  set3(o.foot, 0, 0.135, 0, -0.035); set3(o.foot, 1, 0.135, 0, 0.035); set3(o.foot, 2, -0.03, 0, -0.084); set3(o.foot, 3, -0.03, 0, 0.084);
  o.hock[0] = -0.075; o.hock[1] = 0.015; o.tail[0] = -0.186; o.tail[1] = 0.036;
  for (let i = 0; i < TN; i++) { o.tail[2 + i * 2] = 0.04; o.tail[3 + i * 2] = TAIL_LOAF[i] + (i > 5 ? 0.1 * Math.sin(t * 0.7) * up : 0); }
  o.eye = 0; o.floor = 1; o.ear = 0; return o;
}
// sitting upright: rump down, front legs straight, tail wrapped round to the front paws
export function poseSit(o, t, look, pitch = 0) {
  for (let i = 0; i < 32; i++) o.sp[i] = SP_SIT[i]; o.head[0] = 0.128; o.head[1] = 0.379; o.head[2] = 0.04 + pitch; o.head[3] = look;
  set3(o.att, 0, 0.078, 0.215, -0.038); set3(o.att, 1, 0.078, 0.215, 0.038); set3(o.att, 2, -0.055, 0.075, -0.06); set3(o.att, 3, -0.055, 0.075, 0.06);
  set3(o.foot, 0, 0.105, 0, -0.036); set3(o.foot, 1, 0.105, 0, 0.036); set3(o.foot, 2, 0.03, 0, -0.084); set3(o.foot, 3, 0.03, 0, 0.084);
  o.hock[0] = -0.075; o.hock[1] = 0.015; o.tail[0] = -0.125; o.tail[1] = 0.03;
  for (let i = 0; i < TN; i++) { o.tail[2 + i * 2] = 0.03 + (i === TN - 1 ? 0.25 * Math.max(0, Math.sin(t * 1.3)) : 0); o.tail[3 + i * 2] = TAIL_SIT[i] + (i > 6 ? 0.25 * Math.sin(t * 1.3) : 0); }
  o.eye = 1; o.floor = 1; o.ear = 0; return o;
}
// in the air: front legs reaching down and ahead, hind legs trailing, tail out behind
export function poseJump(o, t) {
  poseStand(o, 0, 0, 0, t); set3(o.foot, 0, 0.25, 0.07, -0.035); set3(o.foot, 1, 0.27, 0.06, 0.035); set3(o.foot, 2, -0.3, 0.13, -0.045); set3(o.foot, 3, -0.28, 0.12, 0.045); o.hock[0] = -0.07; o.hock[1] = 0.03;
  for (let i = 0; i < TN; i++) { o.tail[2 + i * 2] = 0.5 - i * 0.05; o.tail[3 + i * 2] = 0; } o.floor = 0; return o;
}

// ------------------------------------------------------------------------------------------------ the mesh, as plain arrays (node can build it)
const RB = 17, NB = 15, HR = 17, LS = 8, LR = 6, TS = 6, TR = TN + 1, EYN = 9;
// head stations back -> nose: along the head's forward axis, half width, half height, lift
const HT = [-0.06, 0.008, 0.008, 0, -0.047, 0.04, 0.037, 0, -0.022, 0.057, 0.05, 0.002, 0.006, 0.061, 0.051, 0, 0.03, 0.052, 0.044, -0.004, 0.045, 0.036, 0.03, -0.011, 0.056, 0.024, 0.02, -0.014, 0.062, 0.006, 0.005, -0.014], NH = HT.length / 4;
const BODY = 0, HEAD = BODY + NB * RB, LEGS = HEAD + NH * HR, TAIL = LEGS + 4 * LR * LS, EARS = TAIL + TR * TS, EYES = EARS + 14, NOSE = EYES + 4 * EYN, WHISK = NOSE + 3;
export const NV = WHISK + 18;
const LEG_U = [0, 0.06, 0.13, 0.17, 0.19, 0.2], LEG_RF = [0.034, 0.028, 0.025, 0.022, 0.019, 0.019, 0.018, 0.02, 0.015, 0.023, 0.006, 0.01], LEG_RH = [0.043, 0.03, 0.032, 0.026, 0.02, 0.019, 0.018, 0.02, 0.015, 0.023, 0.006, 0.01];
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

export class CatGeo {
  constructor() {
    this.pos = new Float32Array(NV * 3); this.nor = new Float32Array(NV * 3); this.col = new Float32Array(NV * 4); this.rest = new Float32Array(NV * 2);
    const idx = [], tube = (base, rings, seg, wrap, flip) => { for (let r = 0; r < rings - 1; r++) for (let j = 0; j < (wrap ? seg : seg - 1); j++) { const a = base + r * seg + j, b = base + r * seg + (j + 1) % seg, c = a + seg, d = b + seg; if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d); } };      /* every tube wound so its normals point out */
    tube(BODY, NB, RB, false, true); tube(HEAD, NH, HR, false, true); for (let l = 0; l < 4; l++) tube(LEGS + l * LR * LS, LR, LS, true, false); tube(TAIL, TR, TS, true, true);
    for (let e = 0; e < 2; e++) { const b = EARS + e * 7; idx.push(b, b + 1, b + 2, b + 3, b + 4, b + 6, b + 4, b + 5, b + 6); }
    for (let e = 0; e < 4; e++) { const b = EYES + e * EYN; for (let j = 0; j < EYN - 1; j++) idx.push(b, b + 1 + j, b + 1 + (j + 1) % (EYN - 1)); }
    idx.push(NOSE, NOSE + 1, NOSE + 2); for (let k = 0; k < 6; k++) idx.push(WHISK + k * 3, WHISK + k * 3 + 1, WHISK + k * 3 + 2);
    this.idx = new Uint16Array(idx); this.ring = new Float64Array(NB * 4); this.lc = new Float64Array(LR * 3); this.tp = new Float64Array(TR * 3); this.statics();
  }
  // what never changes: colour / kind (aCol) and the coat's own coordinates (aRest)
  // aCol: a = 0 fur (r = how white, g = marking: 0 body bands, 0.5 head, 1 rings, 2 none; b = shade), a = 1 plain rgb, a = 2 eye rgb
  statics() {
    const C = this.col, R = this.rest, c4 = (i, r, g, b, a) => { C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = a; }, r2 = (i, u, v) => { R[i * 2] = u; R[i * 2 + 1] = v; };
    for (let r = 0; r < NB; r++) for (let j = 0; j < RB; j++) { const a = -Math.PI + j * TAU / (RB - 1), u = r / (NB - 1) * 0.44, A = Math.abs(a), i = BODY + r * RB + j;
      c4(i, Math.max(smooth(0.25, 0.36, u) * smooth(1.35, 2.0, A), smooth(2.3, 2.8, A)), 0, 1, 0); r2(i, u, a); }
    for (let r = 0; r < NH; r++) for (let j = 0; j < HR; j++) { const a = -Math.PI + j * TAU / (HR - 1), A = Math.abs(a), i = HEAD + r * HR + j;
      c4(i, r >= 6 ? 1 : r === 5 ? smooth(0.25, 0.8, A) : r === 4 ? smooth(1.15, 1.75, A) : r === 3 ? smooth(1.8, 2.4, A) : r === 2 ? smooth(2.3, 2.9, A) : 0, 0.5, 1, 0); r2(i, HT[r * 4], a); }
    for (let l = 0; l < 4; l++) for (let r = 0; r < LR; r++) for (let j = 0; j < LS; j++) { const i = LEGS + (l * LR + r) * LS + j; c4(i, l < 2 && r < 2 ? (r ? 0.1 : 0.3) : smooth(l < 2 ? 0.12 : 0.115, l < 2 ? 0.165 : 0.16, LEG_U[r]), r < 2 ? 2 : 1, r === 0 ? 1 : 0.95, 0);      /* shoulder and thigh plain, so they run into the body; rings below */ r2(i, LEG_U[r] + 0.012, 0); }
    for (let r = 0; r < TR; r++) for (let j = 0; j < TS; j++) { const i = TAIL + r * TS + j; c4(i, 0, 1, r >= TR - 2 ? 0.72 : 1, 0); r2(i, r * 0.045, 0); }
    for (let e = 0; e < 2; e++) { const b = EARS + e * 7; for (let k = 0; k < 3; k++) { c4(b + k, 0.74, 0.47, 0.42, 1); r2(b + k, 0, 0); } for (let k = 3; k < 7; k++) { c4(b + k, 0, 2, 0.9, 0); r2(b + k, 0, 0); } }
    for (let e = 0; e < 4; e++) for (let k = 0; k < EYN; k++) { const i = EYES + e * EYN + k; if (e < 2) c4(i, k ? 0.42 : 0.62, k ? 0.62 : 0.8, 0.1, 2); else c4(i, 0.004, 0.004, 0.004, 2); r2(i, 0, 0); }
    for (let k = 0; k < 3; k++) { c4(NOSE + k, 0.78, 0.4, 0.38, 1); r2(NOSE + k, 0, 0); } for (let k = 0; k < 18; k++) { c4(WHISK + k, 0.93, 0.93, 0.9, 1); r2(WHISK + k, 0, 0); }
  }
  // lay every vertex for pose P, then the normals
  fill(P) {
    const pos = this.pos, fl = P.floor, clampY = (y, m) => (fl > 0 && y < m ? lerp(y, m, fl) : y), put = (i, x, y, z) => { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; };
    // ---- body: rings in the plane across the spine
    const S = P.sp, G = this.ring; for (let r = 0; r < NB; r++) { const s = r >> 1, t = (r & 1) * 0.5, a = Math.max(0, s - 1) * 4, b = s * 4, c = Math.min(7, s + 1) * 4, d = Math.min(7, s + 2) * 4; for (let k = 0; k < 4; k++) G[r * 4 + k] = t ? cr(S[a + k], S[b + k], S[c + k], S[d + k], t) : S[b + k]; }
    for (let r = 0; r < NB; r++) { const p = Math.max(0, r - 1), n = Math.min(NB - 1, r + 1); let tx = G[n * 4] - G[p * 4], ty = G[n * 4 + 1] - G[p * 4 + 1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L; const cx = G[r * 4], cy = G[r * 4 + 1], hw = G[r * 4 + 2], hh = G[r * 4 + 3];
      for (let j = 0; j < RB; j++) { const a = -Math.PI + j * TAU / (RB - 1), ca = Math.cos(a), sa = Math.sin(a); put(BODY + r * RB + j, cx - ty * hh * ca, clampY(cy + tx * hh * ca, 0.004), hw * sa); } }
    // ---- head: its own frame (forward f, up u, side s) from pitch (nose down +) and yaw (to the right +)
    const hx = P.head[0], hy = P.head[1], cp = Math.cos(P.head[2]), sp = Math.sin(P.head[2]), cy = Math.cos(P.head[3]), sy = Math.sin(P.head[3]);
    const fx = cp * cy, fy = -sp * cy, fz = sy, ux = sp, uy = cp, sx = -cp * sy, sY = sp * sy, sz = cy;
    const hp = (i, t, up, sd) => put(i, hx + fx * t + ux * up + sx * sd, hy + fy * t + uy * up + sY * sd, fz * t + sz * sd);
    for (let r = 0; r < NH; r++) { const t = HT[r * 4], rw = HT[r * 4 + 1], rh = HT[r * 4 + 2], up = HT[r * 4 + 3]; for (let j = 0; j < HR; j++) { const a = -Math.PI + j * TAU / (HR - 1); hp(HEAD + r * HR + j, t, up + rh * Math.cos(a), rw * Math.sin(a)); } }
    // ---- ears (front face, then the back), eyes (iris fans, then pupils), nose, whiskers
    for (let e = 0; e < 2; e++) { const q = e ? 1 : -1, b = EARS + e * 7, tw = P.ear * (e ? 1 : 0.4) * 0.012;
      hp(b, 0.002, 0.046, q * 0.011); hp(b + 1, -0.004, 0.026, q * 0.055); hp(b + 2, -0.012 - tw, 0.112, q * (0.05 + tw)); hp(b + 3, -0.004, 0.026, q * 0.055); hp(b + 4, -0.038, 0.034, q * 0.034); hp(b + 5, 0.002, 0.046, q * 0.011); hp(b + 6, -0.012 - tw, 0.112, q * (0.05 + tw)); }
    const eo = Math.max(0.13, P.eye);
    for (let e = 0; e < 4; e++) { const q = e & 1 ? 1 : -1, pup = e >= 2, b = EYES + e * EYN; let nx = 0.74, ny = 0.4, nz = 0.5 * q; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;      /* (t, up, side) */
      let ax = -nz, az = nx; const al = Math.hypot(ax, az); ax /= al; az /= al; const bx = -ny * az, by = az * nx - ax * nz, bz = ny * ax, off = pup ? 0.0042 : 0.0032, ra = pup ? lerp(0.0045, 0.003, P.eye) : 0.0135, rb = (pup ? 0.0098 : 0.0112) * eo;
      const ct = 0.0365 + nx * off, cu = 0.0215 + ny * off, cs = q * 0.0275 + nz * off; hp(b, ct, cu, cs);
      for (let k = 0; k < EYN - 1; k++) { const a = k * TAU / (EYN - 1), c = Math.cos(a) * ra, s = Math.sin(a) * rb; hp(b + 1 + k, ct + ax * c + bx * s, cu + by * s, cs + az * c + bz * s); } }
    hp(NOSE, 0.0625, -0.005, -0.009); hp(NOSE + 1, 0.0625, -0.005, 0.009); hp(NOSE + 2, 0.0645, -0.0165, 0);
    for (let k = 0; k < 6; k++) { const q = k < 3 ? -1 : 1, m = k % 3, b = WHISK + k * 3; hp(b, 0.048, -0.012 + m * 0.003, q * 0.024); hp(b + 1, 0.048, -0.0155 + m * 0.003, q * 0.024); hp(b + 2, 0.036, -0.03 + m * 0.019, q * 0.1); }
    // ---- legs: attach -> elbow / knee -> wrist / hock -> ankle -> toes -> tip
    const c = this.lc;
    for (let l = 0; l < 4; l++) { const front = l < 2, ax = P.att[l * 3], ay = P.att[l * 3 + 1], az = P.att[l * 3 + 2], Fx = P.foot[l * 3], Fy = P.foot[l * 3 + 1], Fz = P.foot[l * 3 + 2], rr = front ? LEG_RF : LEG_RH;
      const jx = Fx + (front ? -0.004 : P.hock[0]), jy = Fy + (front ? 0.032 : P.hock[1]), l1 = front ? 0.09 : 0.105, l2 = front ? 0.1 : 0.105; let dx = jx - ax, dy = jy - ay, d = Math.hypot(dx, dy) || 1e-6; dx /= d; dy /= d;
      const dd = clamp(d, Math.abs(l1 - l2) + 0.004, l1 + l2 - 0.001), a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - a * a)) * (front ? -1 : 1);
      set3(c, 0, ax, ay, az); set3(c, 1, ax + dx * a - dy * h, ay + dy * a + dx * h, lerp(az, Fz, 0.55)); set3(c, 2, jx, jy, Fz); set3(c, 3, Fx, Fy + 0.015, Fz); set3(c, 4, Fx + 0.022, Fy + 0.0115, Fz); set3(c, 5, Fx + 0.037, Fy + 0.008, Fz);
      for (let r = 0; r < LR; r++) { const p = Math.max(0, r - 1), n = Math.min(LR - 1, r + 1); let tx = c[n * 3] - c[p * 3], ty = c[n * 3 + 1] - c[p * 3 + 1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L; const ra = rr[r * 2], rz = rr[r * 2 + 1];
        for (let j = 0; j < LS; j++) { const an = j * TAU / LS, ca = Math.cos(an) * ra, sa = Math.sin(an) * rz; put(LEGS + (l * LR + r) * LS + j, c[r * 3] + ty * ca, clampY(c[r * 3 + 1] - tx * ca, 0.002), c[r * 3 + 2] + sa); } } }
    // ---- tail: a chain of TN segments from the rump; each ring's frame is carried along from the one before
    const T = P.tail, tp = this.tp; set3(tp, 0, T[0] + 0.02, T[1], 0);
    for (let i = 0; i < TN; i++) { const el = T[2 + i * 2], yw = T[3 + i * 2], ce = Math.cos(el); set3(tp, i + 1, tp[i * 3] - ce * Math.cos(yw) * TSEG, clampY(tp[i * 3 + 1] + Math.sin(el) * TSEG, 0.016), tp[i * 3 + 2] + ce * Math.sin(yw) * TSEG); }
    let px = 0, py = 0, pz = 1;
    for (let r = 0; r < TR; r++) { const p = Math.max(0, r - 1), n = Math.min(TR - 1, r + 1); let tx = tp[n * 3] - tp[p * 3], ty = tp[n * 3 + 1] - tp[p * 3 + 1], tz = tp[n * 3 + 2] - tp[p * 3 + 2]; const L = Math.hypot(tx, ty, tz) || 1; tx /= L; ty /= L; tz /= L;
      let k = px * tx + py * ty + pz * tz; px -= tx * k; py -= ty * k; pz -= tz * k; k = Math.hypot(px, py, pz); if (k < 1e-4) { px = ty; py = -tx; pz = 0; k = Math.hypot(px, py) || 1; } px /= k; py /= k; pz /= k;
      const qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px, rad = r === TR - 1 ? 0.006 : lerp(0.0185, 0.0125, r / (TR - 1));
      for (let j = 0; j < TS; j++) { const an = j * TAU / TS, ca = Math.cos(an) * rad, sa = Math.sin(an) * rad; put(TAIL + r * TS + j, tp[r * 3] + px * ca + qx * sa, tp[r * 3 + 1] + py * ca + qy * sa, tp[r * 3 + 2] + pz * ca + qz * sa); } }
    this.normals();
  }
  normals() { const p = this.pos, n = this.nor, I = this.idx; n.fill(0);
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x; n[a] += x; n[a + 1] += y; n[a + 2] += z; n[b] += x; n[b + 1] += y; n[b + 2] += z; n[c] += x; n[c + 1] += y; n[c + 2] += z; }
    const seam = (base, rings, seg) => { for (let r = 0; r < rings; r++) { const a = (base + r * seg) * 3, b = (base + r * seg + seg - 1) * 3; for (let k = 0; k < 3; k++) { const s = n[a + k] + n[b + k]; n[a + k] = s; n[b + k] = s; } } }; seam(BODY, NB, RB); seam(HEAD, NH, HR);
    for (let i = 0; i < NV * 3; i += 3) { const L = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= L; n[i + 1] /= L; n[i + 2] /= L; } }
}

// the bread: a tray of five tin loaves, in the cat's own unscaled frame (the loaves' tops at y = 0, their length across the cat); side = which z the room is on
export function breadGeo(side = 1) {
  const P = [], N = [], C = [], I = [], v = (x, y, z, r, g, b) => { P.push(x, y, z); C.push(r, g, b, 1); return P.length / 3 - 1; };
  const PR = [-0.047, 0, 0.047, 0, 0.051, 0.03, 0.05, 0.058, 0.058, 0.074, 0.05, 0.096, 0.026, 0.109, 0, 0.112, -0.026, 0.109, -0.05, 0.096, -0.058, 0.074, -0.05, 0.058, -0.051, 0.03], n = PR.length / 2, H = 0.112, Lh = 0.15;
  const ST = [-Lh, 0.8, -Lh + 0.012, 0.97, -Lh + 0.04, 1, Lh - 0.04, 1, Lh - 0.012, 0.97, Lh, 0.8], zc = side * 0.038;
  for (let k = 0; k < 5; k++) { const xc = (k - 2) * 0.119 - 0.012, tone = 0.9 + 0.2 * ((k * 7919) % 5) / 5, b0 = P.length / 3, rot = ((k * 13) % 5 - 2) * 0.02;
    for (let s = 0; s < 6; s++) for (let j = 0; j < n; j++) { const px = PR[j * 2] * ST[s * 2 + 1], py = PR[j * 2 + 1] * (0.94 + 0.06 * ST[s * 2 + 1]), top = smooth(0.05, 0.085, py), z = ST[s * 2];
      v(xc + px + z * rot, py - H, zc + z, lerp(0.83, 0.47, top) * tone, lerp(0.6, 0.25, top) * tone, lerp(0.32, 0.085, top) * tone); }
    for (let s = 0; s < 5; s++) for (let j = 0; j < n; j++) { const a = b0 + s * n + j, b = b0 + s * n + (j + 1) % n; I.push(a, b, a + n, b, b + n, a + n); }
    for (const s of [0, 5]) { const cI = v(xc + ST[s * 2] * rot, 0.055 - H, zc + ST[s * 2] * 1.012, 0.84 * tone, 0.63 * tone, 0.36 * tone); for (let j = 0; j < n; j++) { const a = b0 + s * n + j, b = b0 + s * n + (j + 1) % n; if (s) I.push(a, b, cI); else I.push(b, a, cI); } } }
  // the tray: a red plastic bread tray, each face its own four corners
  const box = (x0, x1, y0, y1, z0, z1, r, g, b) => { const q = (a, b2, c, d) => { const i0 = v(...a, r, g, b); v(...b2, r, g, b); v(...c, r, g, b); v(...d, r, g, b); I.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); };
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); };
  const x0 = -0.325, x1 = 0.3, z0 = zc - 0.175, z1 = zc + 0.175; box(x0, x1, -H - 0.012, -H, z0, z1, 0.5, 0.05, 0.04);
  box(x0, x1, -H, -H + 0.03, z0, z0 + 0.012, 0.5, 0.05, 0.04); box(x0, x1, -H, -H + 0.03, z1 - 0.012, z1, 0.5, 0.05, 0.04); box(x0, x0 + 0.012, -H, -H + 0.03, z0, z1, 0.5, 0.05, 0.04); box(x1 - 0.012, x1, -H, -H + 0.03, z0, z1, 0.5, 0.05, 0.04);
  const nv = P.length / 3, nor = new Float32Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x; for (const q of [a, b, c]) { nor[q] += x; nor[q + 1] += y; nor[q + 2] += z; } }
  for (let i = 0; i < nv * 3; i += 3) { const L = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= L; nor[i + 1] /= L; nor[i + 2] /= L; }
  return { pos: new Float32Array(P), nor, col: new Float32Array(C), rest: new Float32Array(nv * 2), idx: new Uint16Array(I), H: H + 0.012 };
}

// ------------------------------------------------------------------------------------------------ shader
export const COATS = [      // base, stripe, white (sRGB), stripe strength, how far the white reaches
  { name: 'orange tabby', a: [0.9, 0.56, 0.24], b: [0.62, 0.27, 0.07], w: [0.97, 0.95, 0.9], st: 1, wk: 1 },
  { name: 'grey tabby', a: [0.5, 0.45, 0.37], b: [0.12, 0.1, 0.09], w: [0.96, 0.95, 0.92], st: 1, wk: 1 },
  { name: 'tuxedo', a: [0.07, 0.07, 0.075], b: [0.05, 0.05, 0.055], w: [0.97, 0.96, 0.94], st: 0, wk: 1.6 }];
const VERT = `attribute vec4 aCol; attribute vec2 aRest; varying vec3 vN; varying vec3 vW; varying vec4 vC; varying vec2 vR;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = mat3(modelMatrix) * normal; vC = aCol; vR = aRest; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FRAG = `uniform vec3 uL; uniform vec3 uLd; uniform vec3 uA; uniform vec3 uB; uniform vec3 uWh; uniform vec3 uK; varying vec3 vN; varying vec3 vW; varying vec4 vC; varying vec2 vR;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); if (!gl_FrontFacing) N = -N;
    float kind = vC.a, fur = step(kind, 0.5), eye = step(1.5, kind); vec3 alb = vC.rgb;
    if (fur > 0.5) { float u = vR.x, a = abs(vR.y), m = vC.g, st = 0.0, wob = vn(vec2(u * 26.0, a * 2.2));
      if (m < 0.25) { st = smoothstep(0.1, 0.5, sin(u * 150.0 + 1.3 * sin(a * 2.6) + wob * 2.4)) * (1.0 - smoothstep(1.6, 2.2, a)); st = max(st, 1.0 - smoothstep(0.1, 0.2, a)); }      /* bands down the flanks, a dark line along the spine */
      else if (m < 0.75) st = smoothstep(0.2, 0.6, cos(a * 13.0)) * (1.0 - smoothstep(-0.014, 0.012, u)) * (1.0 - smoothstep(0.9, 1.25, a));      /* the lines on the forehead */
      else if (m < 1.5) st = smoothstep(0.1, 0.5, sin(u * 150.0)) * 0.7;      /* rings on the legs and the tail */
      float g = vn(vec2(u * 700.0, vR.y * 40.0)) * 0.6 + vn(vec2(u * 240.0 + 9.0, vR.y * 90.0)) * 0.4;
      alb = mix(mix(uA, uB, st * uK.x), uWh, clamp(vC.r * uK.y, 0.0, 1.0)) * (0.8 + 0.4 * g) * vC.b; }
    else if (eye > 0.5) alb = mix(vec3(0.05, 0.03, 0.02), alb, smoothstep(0.15, 0.45, uK.z));
    float ao = mix(0.55, 1.0, smoothstep(-0.95, 0.15, N.y)), wr = 0.5 + 0.5 * dot(N, uLd), dif = mix(0.34, 1.0, wr * wr * (3.0 - 2.0 * wr)) * ao, rim = pow(1.0 - abs(dot(N, V)), 2.5);
    vec3 c = alb * uL * dif + fur * uL * (alb * 0.5 + 0.08) * rim * 0.35 * (0.35 + 0.65 * wr);
    c += eye * uL * pow(max(dot(N, normalize(uLd + V)), 0.0), 40.0) * 0.7;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const SH_FRAG = `uniform float uO; varying vec2 vQ; void main(){ float r = length(vQ); if (r >= 1.0) discard; float e = 1.0 - r * r; gl_FragColor = vec4(0.0, 0.0, 0.0, uO * e * e); }`;
const lin = (c) => new THREE.Vector3(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2));

// ------------------------------------------------------------------------------------------------ the surprise
export function install(game, kit) {
  const g = game, w = g.world, Q = g.P || new URLSearchParams('');
  const S = { st: 'none', spot: null, t: 0, pets: 0, walked: 0, followT: 0, ms: 0, frames: 0, scan: 0, trail: [], coat: -1, sound: 0 };
  const cat = (S.cat = { x: 0, y: 0, h: 0, hd: 0, pitch: 0, v: 0, ph: 0, sit: 0, up: 0, eye: 0, look: 0, lookP: 0, lin: 1, idle: 0, blink: 3, ear: 0, earT: 2, purr: 0 });
  const A = mkPose(), B = mkPose(), PZ = mkPose(), L3 = [0, 0, 0], _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Vector3();
  let look = null, snd = null; const HEEL = Q.get('catheel') !== '0';

  // ---- where: a deli's register counter (the scratch-card rack marks its front end), between the rack and the register
  function spotOf(sh) { if (!sh.d || sh.d.kind !== 'deli' || !sh.plan || !sh.plan.items) return null; const it = sh.plan.items.find((q) => q.m === 'lotto'); if (!it) return null;
    const d = sh.d, b = it.box, uc = (b[0] + b[1]) / 2, zc = b[4] - 0.42, rs = Math.sign((sh.plan.ua + sh.plan.ub) / 2 - uc) || 1, at = (u, z) => [d.x + u * d.dx + z * d.nx, d.y + u * d.dy + z * d.ny];
    const p = at(uc, zc), st = at(uc + rs * 0.95, zc), hdB = Math.atan2(d.ny, d.nx), hd = Math.atan2(d.ny + 0.28 * rs * d.dy, d.nx + 0.28 * rs * d.dx), side = Math.sign(rs * d.dx * Math.sin(hdB) - rs * d.dy * Math.cos(hdB)) || 1;
    return { sh, x: p[0], y: p[1], h: 0.15 + b[2] + 0.012 + 0.112 - 0.008, hd, hdB, side, sx: st[0], sy: st[1], along: [d.nx, d.ny], floor: 0.15, free: false, coat: Math.abs((d.bid | 0) * 7 + 3) % 3, id: d.id }; }
  function findSpot() { const I = g.interiors, pl = g.player; if (!I || !I.shops) return null; let best = null, bd = 1e9; for (const sh of I.shops) { const sp = spotOf(sh); if (!sp) continue; const dd = Math.hypot(sp.x - pl.x, sp.y - pl.y); if (dd < bd) { bd = dd; best = sp; } } return best; }
  const inShop = (x, y) => { const sp = S.spot; return !!(sp && sp.sh && sp.sh.inside(x, y)); };
  const ground = (x, y) => (inShop(x, y) || (g.statics && g.statics.onSidewalk && g.statics.onSidewalk(x, y)) ? 0.15 : 0);
  function home() { const sp = S.spot; S.st = 'sleep'; S.t = 0; cat.x = sp.x; cat.y = sp.y; cat.h = sp.h; cat.hd = sp.hd; cat.pitch = 0; cat.v = 0; cat.sit = 0; cat.up = 0; cat.eye = 0; cat.look = 0; cat.lookP = 0; cat.purr = 0; cat.lin = sp.free ? 0 : 1; S.trail.length = 0; S.walked = 0; S.followT = 0; S.doneT = 0; S.stayed = false; S.land = null; if (look) setCoat(S.coat); }
  // a cat asleep anywhere (the show on a map with no deli, and the node check): on the ground, no bread
  S.place = (x, y, hd = 0) => { S.spot = { sh: null, x, y, h: ground(x, y), hd, hdB: hd, side: 1, sx: x + Math.cos(hd) * 0.9, sy: y + Math.sin(hd) * 0.9, along: [-Math.sin(hd), Math.cos(hd)], floor: ground(x, y), free: true, coat: 0, id: 'free' }; home(); return S.spot; };

  // ---- the meshes
  function mkLook() { const mk = (G, dyn) => { const geo = new THREE.BufferGeometry(), at = (a, k) => new THREE.BufferAttribute(a, k); geo.setAttribute('position', at(G.pos, 3)); geo.setAttribute('normal', at(G.nor, 3)); geo.setAttribute('aCol', at(G.col, 4)); geo.setAttribute('aRest', at(G.rest, 2)); geo.setIndex(new THREE.BufferAttribute(G.idx, 1));
      if (dyn) { geo.attributes.position.setUsage(THREE.DynamicDrawUsage); geo.attributes.normal.setUsage(THREE.DynamicDrawUsage); }
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uL: { value: new THREE.Vector3(1, 1, 1) }, uLd: { value: new THREE.Vector3(0, 1, 0) }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uWh: { value: new THREE.Vector3(1, 1, 1) }, uK: { value: new THREE.Vector3(1, 1, 0) } }, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: false }));
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; w.scene.add(m); return m; };
    const geo = new CatGeo(), mesh = mk(geo, true); mesh.name = 'sur_bodegacat';
    const sq = new THREE.PlaneGeometry(2, 2); sq.rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(sq, new THREE.ShaderMaterial({ uniforms: { uO: { value: 0.4 } }, vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: SH_FRAG, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    shadow.frustumCulled = false; shadow.matrixAutoUpdate = false; shadow.visible = false; shadow.renderOrder = 2; shadow.name = 'sur_bodegacat_shadow'; w.scene.add(shadow);
    return { geo, mesh, shadow, bread: null, breadOf: null, mk }; }
  function setCoat(n) { const c = COATS[((n % 3) + 3) % 3], U = look.mesh.material.uniforms; U.uA.value.copy(lin(c.a)); U.uB.value.copy(lin(c.b)); U.uWh.value.copy(lin(c.w)); U.uK.value.x = c.st; U.uK.value.y = c.wk; }
  S.setCoat = (n) => { S.coat = n; if (look) setCoat(n); };
  function breadFor(sp) { if (look.breadOf === sp) return; if (look.bread) { w.scene.remove(look.bread); look.bread.geometry.dispose(); look.bread.material.dispose(); look.bread = null; } look.breadOf = sp; if (sp.free) return;
    const m = (look.bread = look.mk(breadGeo(sp.side), false)); m.name = 'sur_bodegacat_bread'; m.matrix.makeRotationY(sp.hdB); m.matrix.setPosition(sp.x, sp.h + 0.008, -sp.y); m.matrixWorldNeedsUpdate = true; }
  const hide = () => { if (look) { look.mesh.visible = false; look.shadow.visible = false; if (look.bread) look.bread.visible = false; } };

  // ---- sound: a purr (low noise chopped at 25 Hz, swelling with the breath) and a short chirp when it wakes
  function purrOn() { const s = kit.audio && kit.audio(); if (!s || !s.white) return; try { const a = s.ac;
      if (!snd) { const v = kit.voice({ ref: 1.6, max: 16, level: 1 }); if (!v) return; const src = a.createBufferSource(); src.buffer = s.white; src.loop = true; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 1.2; const chop = a.createGain(); chop.gain.value = 0.5; const lfo = a.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 25; const ld = a.createGain(); ld.gain.value = 0.5; lfo.connect(ld); ld.connect(chop.gain);
        const br = a.createGain(); br.gain.value = 0.7; const bl = a.createOscillator(); bl.type = 'sine'; bl.frequency.value = 0.55; const bd = a.createGain(); bd.gain.value = 0.3; bl.connect(bd); bd.connect(br.gain); const env = a.createGain(); env.gain.value = 0; src.connect(lp); lp.connect(chop); chop.connect(br); br.connect(env); env.connect(v.in); src.start(); lfo.start(); bl.start(); snd = { v, env, a, src, lfo, bl }; }
      S.sound++; } catch (e) { kit.fail('bodegacat.sound', e); } }
  function chirp() { const s = kit.audio && kit.audio(); if (!s || !snd || Q.get('catchirp') === '0') return; try { const a = s.ac, t = a.currentTime + 0.05, o = a.createOscillator(), e = a.createGain(), f = a.createBiquadFilter(); o.type = 'triangle'; o.frequency.setValueAtTime(430, t); o.frequency.linearRampToValueAtTime(690, t + 0.16); o.frequency.linearRampToValueAtTime(610, t + 0.26);
      const vb = a.createOscillator(), vg = a.createGain(); vb.frequency.value = 27; vg.gain.value = 26; vb.connect(vg); vg.connect(o.frequency); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.8; e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.16, t + 0.04); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(f); f.connect(e); e.connect(snd.v.in); o.start(t); vb.start(t); o.stop(t + 0.34); vb.stop(t + 0.34); } catch (e) { kit.fail('bodegacat.sound', e); } }

  // ---- what happens
  function pet() { const pl = g.player; S.pets++; if (S.st === 'sleep') { S.st = 'wake'; S.t = 0; S.px = pl.x; S.py = pl.y; cat.purr = 9; purrOn(); chirp(); } else { cat.purr = 4.5; cat.happy = 2.2; purrOn(); } }
  S.pet = pet;
  function startFollow() { S.st = 'follow'; S.t = 0; S.followT = 0; S.doneT = 0; S.walked = 0; cat.idle = 0; cat.pitch = 0; const pl = g.player; if (!S.trail.length) S.trail.push([pl.x, pl.y]); }
  function relTo(x, y) { return wrapA(Math.atan2(y - cat.y, x - cat.x) - cat.hd); }
  function update(dt) {
    const pl = g.player, sp = S.spot, dP = Math.hypot(pl.x - cat.x, pl.y - cat.y); S.t += dt;
    // eyes, ears, the head turning to the player
    cat.blink -= dt; if (cat.blink < -0.16) cat.blink = 2.5 + Math.random() * 4; cat.earT -= dt; if (cat.earT < -0.25) cat.earT = 2 + Math.random() * 6; cat.ear = cat.earT < 0 ? Math.sin(-cat.earT / 0.25 * Math.PI) : 0;
    if (cat.happy > 0) cat.happy -= dt; if (cat.purr > 0) cat.purr -= dt;
    const wantLook = S.st === 'sleep' ? 0 : dP < 9 ? clamp(-relTo(pl.x, pl.y), -1.0, 1.0) : 0; cat.look += (wantLook - cat.look) * Math.min(1, dt * 5);
    const wantP = S.st === 'sleep' || S.st === 'jump' ? 0 : -0.2 * smooth(4, 1.2, dP); cat.lookP += (wantP - cat.lookP) * Math.min(1, dt * 4);
    if (S.st === 'sleep') { cat.eye = 0; cat.up = 0; if (dP < 1.9 && kit.onFoot() && (sp.free || sp.sh.inside(pl.x, pl.y))) { kit.prompt('pet the cat'); if (kit.use()) pet(); } }
    else if (S.st === 'wake') {      // head up, eyes open, one slow blink at you
      cat.up = smooth(0, 0.55, S.t); cat.eye = smooth(0.25, 0.55, S.t) * (1 - smooth(1.15, 1.35, S.t) * (1 - smooth(1.55, 1.85, S.t)));
      if (S.t > 2.1) { S.st = 'rise'; S.t = 0; } }
    else if (S.st === 'rise') {      // up on its feet, turning to the way down
      cat.up = 1; cat.eye = 1; S.k = smooth(0, 0.7, S.t);
      if (!S.land) { let lx = sp.sx, ly = sp.sy; if (!sp.free && Math.hypot(pl.x - lx, pl.y - ly) < 0.7) { const q = (pl.x - lx) * sp.along[0] + (pl.y - ly) * sp.along[1] > 0 ? -1 : 1; lx += sp.along[0] * 0.6 * q; ly += sp.along[1] * 0.6 * q; } S.land = [lx, ly]; }
      if (sp.free) { if (S.t > 0.8) { S.land = null; startFollow(); } }
      else { const da = relTo(S.land[0], S.land[1]); if (S.t > 0.5) { cat.hd += clamp(da, -dt * 3.2, dt * 3.2); cat.ph += dt * 2.2 * smooth(0.05, 0.4, Math.abs(da)); } if (S.t > 1.0 && Math.abs(da) < 0.12) { S.st = 'jump'; S.t = 0; S.j0 = [cat.x, cat.y, cat.h]; } } }
    else if (S.st === 'jump') { const k = clamp(S.t / 0.55, 0, 1), e = k * k * (3 - 2 * k), j = S.j0; cat.x = lerp(j[0], S.land[0], e); cat.y = lerp(j[1], S.land[1], e); cat.h = lerp(j[2], sp.floor, k * k) + 0.16 * Math.sin(Math.PI * Math.min(1, k * 1.25)) * (1 - k); cat.pitch = -0.75 * Math.sin(Math.PI * k) * smooth(0, 0.3, k); S.k = k;
      if (k >= 1) { cat.h = sp.floor; S.trail.length = 0; S.trail.push([pl.x, pl.y]); S.land = null; startFollow(); } }
    else if (S.st === 'follow') follow(dt, dP);
    else if (S.st === 'stay') { cat.v = 0; cat.h += clamp(ground(cat.x, cat.y) - cat.h, -dt * 1.2, dt * 1.2); cat.sit = Math.min(1, cat.sit + dt * 2.2); cat.eye = cat.happy > 0 ? 0.2 : cat.blink < 0 ? 0.1 : 1;
      if (dP < 1.7 && kit.onFoot() && !(cat.happy > 0)) { kit.prompt('pet the cat'); if (kit.use()) pet(); }
      if (dP > 95 && Math.hypot(pl.x - sp.x, pl.y - sp.y) > 55) home(); }
    // light: the shop's inside, the day's in the street
    const inside = S.st === 'sleep' || S.st === 'wake' || S.st === 'rise' || S.st === 'jump' ? !sp.free : inShop(cat.x, cat.y); cat.lin += clamp((inside ? 1 : 0) - cat.lin, -dt * 2, dt * 2);
    if (snd) { const on = cat.purr > 0 ? 1 : 0; snd.env.gain.setTargetAtTime(on * 0.5, snd.a.currentTime, on ? 0.35 : 0.6); snd.v.at(cat.x, cat.y, cat.h + 0.2, dt); }
  }
  const clear = (ax, ay, bx, by) => !g.statics || !g.statics.raycast || g.statics.raycast(ax, ay, bx, by) >= 1;
  function follow(dt, dP) { const pl = g.player, T = S.trail; S.followT += dt; cat.eye = cat.blink < 0 ? 0.1 : 1;
    // the player's crumbs: where the way is not open the cat walks the way he walked, so doors, shelves and corners take care of themselves
    const last = T[T.length - 1]; if (!pl.vehicle && Math.hypot(pl.x - last[0], pl.y - last[1]) > 0.4) T.push([pl.x, pl.y]); if (T.length > 400) T.splice(0, T.length - 400);
    let rem = Math.hypot(T[0][0] - cat.x, T[0][1] - cat.y); for (let i = 1; i < T.length; i++) rem += Math.hypot(T[i][0] - T[i - 1][0], T[i][1] - T[i - 1][1]); { const l2 = T[T.length - 1]; rem += Math.hypot(pl.x - l2[0], pl.y - l2[1]); }
    const gone = !!pl.vehicle || dP > 45 || rem > 70, done = S.followT > 50 || S.walked > 80; if (done && !S.doneT) S.doneT = S.followT;
    if (gone || (done && (ground(cat.x, cat.y) > 0.1 || S.followT > S.doneT + 12))) { S.st = 'stay'; S.t = 0; S.stayed = gone ? 'left behind' : 'done'; return; }      /* it stops on a sidewalk (or in the shop), not in the road, unless the player keeps to the road */
    // where the way IS open it trots at heel: two metres ahead and a step to one side, where the game's camera (behind the player) can see it
    const ps = pl.speed || 0, ch = Math.cos(pl.h), sh = Math.sin(pl.h), gp = ground(pl.x, pl.y); let heel = null;
    if (HEEL) for (const q of [S.heelSide || 1, -(S.heelSide || 1)]) { const hx = pl.x + ch * 2.0 + sh * 0.8 * q, hy = pl.y + sh * 2.0 - ch * 0.8 * q; if (ground(hx, hy) === gp && clear(pl.x, pl.y, hx, hy) && clear(cat.x, cat.y, hx, hy)) { heel = [hx, hy]; S.heelSide = q; break; } }
    S.heel = !!heel; let want = 0, go;
    if (heel) { T.length = 0; T.push([pl.x, pl.y]); const dx = heel[0] - cat.x, dy = heel[1] - cat.y, d = Math.hypot(dx, dy), vx = dx * 2.2 + ch * ps, vy = dy * 2.2 + sh * ps;
      go = cat.v > 0.05 && cat.sit < 0.05 ? d > 0.2 || ps > 0.3 : d > 0.75; want = go ? clamp(Math.hypot(vx, vy), 0.5, 5.8) : 0; if (cat.sit > 0.25) want = 0; cat.v += clamp(want - cat.v, -dt * 9, dt * 6);
      if (cat.v > 0.02 && d > 1e-3) { const da = wrapA(Math.atan2(vy, vx) - cat.hd); cat.hd += clamp(da, -dt * 8, dt * 8); const m = Math.min(cat.v * dt * (Math.abs(da) > 1.3 ? 0.3 : 1), d + ps * dt), L = Math.hypot(vx, vy) || 1; cat.x += vx / L * m; cat.y += vy / L * m; S.walked += m; } }
    else { const gap = 1.25; go = rem > (cat.sit > 0.05 || cat.v < 0.05 ? 2.0 : gap); want = go ? clamp((rem - gap + 0.2) * 1.7, 0.6, 5.6) : 0; if (cat.sit > 0.25) want = 0; cat.v += clamp(want - cat.v, -dt * 9, dt * 6);
      let move = cat.v * dt;
      while (move > 1e-5 && T.length) { const tx = T[0][0], ty = T[0][1], d = Math.hypot(tx - cat.x, ty - cat.y); if (d < 0.12 && T.length > 1) { T.shift(); continue; } if (d < 1e-4) break;
        const da = wrapA(Math.atan2(ty - cat.y, tx - cat.x) - cat.hd); cat.hd += clamp(da, -dt * 9, dt * 9); const m = Math.min(move, d) * (Math.abs(da) > 1.2 ? 0.25 : 1); cat.x += (tx - cat.x) / d * m; cat.y += (ty - cat.y) / d * m; S.walked += m; move -= Math.max(m, move * 0.5); if (T.length === 1) break; } }
    if (go) { cat.sit = Math.max(0, cat.sit - dt * 4); cat.idle = 0; } else { cat.idle += dt; if (cat.idle > 1.8) cat.sit = Math.min(1, cat.sit + dt * 2.4); }
    if (cat.v < 0.02) { cat.v = 0; if (dP < 6 && cat.sit < 0.5) { const r = relTo(pl.x, pl.y); cat.hd += clamp(r, -dt * 3.5, dt * 3.5) * smooth(0.3, 1.0, Math.abs(r)); S.turning = smooth(0.3, 0.6, Math.abs(r)); if (S.turning > 0) cat.ph += dt * 2.2; } else S.turning = 0; } else S.turning = 0;      /* stopped: it turns to face you (a few steps on the spot), then sits */
    const sp1 = smooth(1.2, 4.6, cat.v); cat.ph += (cat.v / SC) * dt / strideLen(sp1);
    const gh = ground(cat.x, cat.y); cat.h += clamp(gh - cat.h, -dt * 1.2, dt * 1.2);
  }

  function draw(t) { const sp = S.spot, G = look.geo; let P = A;
    if (S.st === 'sleep' || S.st === 'wake') poseLoaf(A, t, cat.up, cat.look);
    else if (S.st === 'rise') { poseLoaf(A, t, 1, cat.look); poseStand(B, cat.ph, 0.35, 0, t); B.head[3] = cat.look; B.head[2] += cat.lookP; P = mixPose(A, B, S.k, PZ); }
    else if (S.st === 'jump') { poseStand(A, cat.ph, 0, 0, t); poseJump(B, t); P = mixPose(A, B, Math.sin(Math.PI * clamp(S.k * 1.1, 0, 1)), PZ); }
    else { const sp1 = smooth(1.2, 4.6, cat.v); poseStand(A, cat.ph, Math.max(smooth(0.03, 0.5, cat.v), cat.v < 0.02 && cat.sit < 0.5 && S.st === 'follow' ? 0.25 * (S.turning || 0) : 0), sp1, t); A.head[3] = cat.look * 0.8; A.head[2] += cat.lookP * (1 - sp1 * 0.6); if (cat.sit > 0.001) { poseSit(B, t, cat.look, cat.lookP); P = mixPose(A, B, cat.sit * cat.sit * (3 - 2 * cat.sit), PZ); } }
    P.eye = cat.eye; P.ear = cat.ear; G.fill(P); const ga = look.mesh.geometry.attributes; ga.position.needsUpdate = true; ga.normal.needsUpdate = true;
    _m.makeRotationY(cat.hd); if (cat.pitch) _m.multiply(_r.makeRotationZ(cat.pitch)); _m.scale(_s.set(SC, SC, SC)); _m.setPosition(cat.x, cat.h, -cat.y); look.mesh.matrix.copy(_m); look.mesh.matrixWorldNeedsUpdate = true; look.mesh.visible = true;
    // light
    kit.light(0.92, L3); const br = g.interiors && g.interiors.uBright ? g.interiors.uBright.value : 1, k = cat.lin, sun = w.sunDir, n = g.night ? g.night.n || 0 : 0;
    const lr = lerp(Math.max(0.1, L3[0]), 1.0 * br, k), lg = lerp(Math.max(0.1, L3[1]), 0.97 * br, k), lb = lerp(Math.max(0.1, L3[2]), 0.9 * br, k), so = sun && sun.y > 0.05 ? (1 - k) * (1 - n) * 0.75 : 0;
    let dx = so * (sun ? sun.x : 0), dy = 1, dz = so * (sun ? sun.z : 0); const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    for (const m of [look.mesh, look.bread]) { if (!m) continue; const U = m.material.uniforms; U.uL.value.set(lr, lg, lb); U.uLd.value.set(dx, dy, dz); } look.mesh.material.uniforms.uK.value.z = cat.eye;
    if (look.bread) { look.bread.visible = true; const U = look.bread.material.uniforms; U.uL.value.set(1.0 * br, 0.97 * br, 0.9 * br); U.uLd.value.set(0, 1, 0); }
    // the contact shadow: under the body on the ground, off while it lies on the bread
    const sh = look.shadow, on = S.st === 'follow' || S.st === 'stay' || (S.st === 'sleep' && sp.free) || S.st === 'jump'; sh.visible = on;
    if (on) { const lift = Math.max(0, cat.h - ground(cat.x, cat.y)), a = lerp(0.3, 0.2, cat.sit) * SC, b = lerp(0.15, 0.17, cat.sit) * SC; _m.makeRotationY(cat.hd); _m.scale(_s.set(a * (1 + lift), 1, b * (1 + lift))); _m.setPosition(cat.x - Math.cos(cat.hd) * 0.02, cat.h - lift + 0.012, -(cat.y - Math.sin(cat.hd) * 0.02)); sh.matrix.copy(_m); sh.matrixWorldNeedsUpdate = true; sh.material.uniforms.uO.value = lerp(0.5, 0.34, k) / (1 + lift * 5); }
  }

  const CATDOOR = !(g.P && g.P.get('catdoor') === '0');
  kit.onFrame((dt, t) => {
    const pl = g.player; let sp = S.spot;
    // the shop door stays open for the cat as it does for a person (interiors.js opens it for the player, officers and its own people within 2.2 m; a player who ran out let it shut on the cat, which then walked through the glass). Nothing of the shop's is edited: its open amount is pushed up while the cat is in the doorway. ?catdoor=0 = as before
    if (CATDOOR && dt > 0 && S.st === 'follow' && sp && sp.sh && sp.sh.doorAt && typeof sp.sh.open === 'number') { const da = sp.sh.doorAt; if (Math.hypot(cat.x - da[0], cat.y - da[1]) < 2.2) { sp.sh.open = Math.min(1, sp.sh.open + dt * 4.2); S.doorHeld = (S.doorHeld || 0) + dt; } }
    // asleep or nowhere: one countdown and one distance, nothing else, until a deli is near
    if (S.st === 'none' || S.st === 'sleep') {
      if (--S.scan <= 0) { S.scan = 90; if (!sp || (!sp.free && Math.hypot(sp.x - pl.x, sp.y - pl.y) > 60)) { const n = findSpot(); if (n && (!sp || n.sh !== sp.sh)) { S.spot = sp = n; S.coat = Q.get('catcoat') !== null ? +Q.get('catcoat') || 0 : sp.coat; home(); } } if (S.wantShow && sp) { S.wantShow = false; stand(); } }
      if (!sp) return; if (Math.hypot(sp.x - pl.x, sp.y - pl.y) > 45 || (sp.sh && !sp.sh.built)) { if (look && look.mesh.visible) hide(); return; }
    }
    const t0 = performance.now(); if (!look) { look = mkLook(); setCoat(S.coat < 0 ? 0 : S.coat); } breadFor(sp); if (dt > 0) update(dt); draw(t); S.ms += performance.now() - t0; S.frames++;
  }, 'bodegacat');
  function stand() { const pl = g.player, sp = S.spot; if (pl.vehicle) { pl.vehicle = null; pl.vis.object.visible = true; g.cam.mode = 'foot'; } pl.x = sp.sx; pl.y = sp.sy; pl.h = Math.atan2(sp.y - sp.sy, sp.x - sp.sx); g.focus.x = pl.x; g.focus.y = pl.y; if (g.cam) g.cam.yaw = pl.h; if (g.snapCamera) g.snapCamera(); }
  S.stand = stand; S.find = () => { if (!S.spot) { const n = findSpot(); if (n) { S.spot = n; S.coat = Q.get('catcoat') !== null ? +Q.get('catcoat') || 0 : n.coat; home(); } } return S.spot; };
  S.info = () => ({ st: S.st, spot: S.spot && { id: S.spot.id, x: +S.spot.x.toFixed(1), y: +S.spot.y.toFixed(1), h: +S.spot.h.toFixed(2), free: S.spot.free }, cat: { x: +cat.x.toFixed(2), y: +cat.y.toFixed(2), h: +cat.h.toFixed(2), v: +cat.v.toFixed(2), sit: +cat.sit.toFixed(2) }, coat: S.coat, pets: S.pets, walked: +S.walked.toFixed(1), followT: +S.followT.toFixed(1), stayed: S.stayed || null, heel: !!S.heel, trail: S.trail.length, msPerFrame: S.frames ? +(S.ms / S.frames).toFixed(3) : 0, frames: S.frames, tris: look ? look.geo.idx.length / 3 + (look.bread ? look.bread.geometry.index.count / 3 : 0) + 2 : 0, draws: look ? (look.mesh.visible ? 1 : 0) + (look.bread && look.bread.visible ? 1 : 0) + (look.shadow.visible ? 1 : 0) : 0, sound: S.sound });
  return S;
}

// stand the player at the deli counter by the cat; with no deli on the map (or none built yet after a few seconds), a cat asleep on the ground two steps ahead
export function show(game, kit, S) {
  if (S.find()) { S.stand(); return S.spot; }
  S.wantShow = true; S.scan = 0;
  setTimeout(() => { if (S.spot) return; S.wantShow = false; const pl = game.player; S.place(pl.x + Math.cos(pl.h) * 2, pl.y + Math.sin(pl.h) * 2, pl.h + 2.4); }, 6000);
  return true;
}
