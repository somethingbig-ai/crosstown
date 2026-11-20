// surprises/busker-pose.js: the saxophone busker's body, his horn and his case (surprises lane, Nov 17). No game in here, so node can draw it
// (helper-busker/preview.mjs). The body is one of the game's own people posed bone by bone each frame through showtime-pose.js's Rig (two-bone IK for the
// arms and legs); the tenor saxophone, the neck strap, the open case, the hat and the dollar bills are shapes made here.
//   new Player(rig)            rig = new Rig(person.object, name)
//   player.update(dt, ctl)     ctl = { t: tune time in seconds, scared: bool, tx, tz: where the danger is (his own space), sound: bool (is he blowing) }
//                              then: rig.apply(dt, origin) ; player.sax.p / .q place the horn and player.hat the hat (his own space) ; player.fingers() after apply ; player.strapPts
//   player.flinch() player.thank('nod' | 'lift')
// HIS OWN SPACE: x the way he faces, y up, z to his right, the origin on the pavement between his feet. Lengths in metres.
import * as THREE from 'three';
import { Rig, basisQ, clamp, lerp, smooth, ease, TAU } from './showtime-pose.js';
import { noteAt, TT } from './busker-tune.js';
export { Rig };

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);

// ------------------------------------------------------------------------------------------------ shapes
// a small builder: pieces with one colour each, glued into one geometry (position, normal, colour) = one draw
class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this._c = new THREE.Color(); }
  rgb(hex) { this._c.set(hex); return this._c; }
  // a round tube along a path that lies in the xy plane: pts = [x, y, radius]; m = a matrix for the whole piece
  tube(pts, segs, hex, m) { const c = this.rgb(hex), b = this.pos.length / 3, n = pts.length, p = V(), nn = V();
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], e = pts[Math.min(n - 1, i + 1)]; let tx = e[0] - a[0], ty = e[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; const slope = (e[2] - a[2]) / tl;
      for (let j = 0; j <= segs; j++) { const th = TAU * j / segs, cs = Math.cos(th), sn = Math.sin(th); p.set(pts[i][0] - ty * cs * pts[i][2], pts[i][1] + tx * cs * pts[i][2], sn * pts[i][2]); nn.set(-ty * cs - tx * slope, tx * cs - ty * slope, sn).normalize();
        if (m) { p.applyMatrix4(m); nn.transformDirection(m); } this.pos.push(p.x, p.y, p.z); this.nor.push(nn.x, nn.y, nn.z); this.col.push(c.r, c.g, c.b); } }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = b + i * (segs + 1) + j, e = a + 1, f = a + segs + 1, g = f + 1; this.idx.push(a, e, f, e, g, f); }
    return this; }
  // any three.js geometry, coloured, moved by a matrix
  add(geo, hex, m) { const c = this.rgb(hex), b = this.pos.length / 3, P = geo.attributes.position, N = geo.attributes.normal, p = V(), nn = V();
    for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); nn.fromBufferAttribute(N, i); if (m) { p.applyMatrix4(m); nn.transformDirection(m); } this.pos.push(p.x, p.y, p.z); this.nor.push(nn.x, nn.y, nn.z); this.col.push(c.r, c.g, c.b); }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(b + geo.index.getX(i)); else for (let i = 0; i < P.count; i++) this.idx.push(b + i); geo.dispose(); return this; }
  // a disc or a rod: a cylinder whose axis runs from a to b
  rod(ax, ay, az, bx, by, bz, r, hex, segs = 8, r2 = r) { const a = V(ax, ay, az), d = V(bx - ax, by - ay, bz - az), l = d.length() || 1e-6; d.multiplyScalar(1 / l);
    return this.add(new THREE.CylinderGeometry(r2, r, l, segs), hex, new THREE.Matrix4().compose(a.addScaledVector(d, l / 2), Q().setFromUnitVectors(Y, d), V(1, 1, 1))); }
  box(x, y, z, sx, sy, sz, hex, m) { const t = new THREE.Matrix4().makeTranslation(x, y, z); if (m) t.premultiply(m); return this.add(new THREE.BoxGeometry(sx, sy, sz), hex, t); }
  build(scale = 1) { const g = new THREE.BufferGeometry(), P = new Float32Array(this.pos); if (scale !== 1) for (let i = 0; i < P.length; i++) P[i] *= scale;
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.idx), 1) : new THREE.BufferAttribute(new Uint16Array(this.idx), 1)); g.computeBoundingSphere(); return g; }
}

// THE TENOR SAXOPHONE. Its own space: the origin at the top of the body tube (where the neck goes in), y up the body, x towards the bell (away from the
// player), z to the player's right. Drawn at SAX_S times the numbers below: 0.83 m from the top of the neck to the bottom of the bow, the bell 0.21 m across.
export const SAX_S = 1.3;
const BRASS = 0xb98a2e, BRASS2 = 0xc9a348,      /* round 2 (merge2 round 10's critic: 'toy-gold ... no reflections'): lacquered brass is browner and less yellow than gold paint */
   PEARL = 0xf4eedd, BLACK = 0x0c0c0e, SILVER = 0xc9ccd2, DARK = 0x3a2a08;
const bodyR = (y) => lerp(0.0135, 0.034, clamp(-y / 0.47, 0, 1));
export const SAX = {
  mouth: V(-0.236, 0.081, 0).multiplyScalar(SAX_S),            // the tip of the mouthpiece, a centimetre inside the lips
  ring: V(-0.034, -0.185, 0).multiplyScalar(SAX_S),            // where the strap hooks on, at the back of the body
  left: V(0, -0.125, 0).multiplyScalar(SAX_S),                 // the middle of the left hand's three keys (on the axis of the tube)
  right: V(0, -0.32, 0).multiplyScalar(SAX_S),                 // the right hand's
  bell: V(0.172, -0.2, 0).multiplyScalar(SAX_S),               // the middle of the bell's mouth
};
export function saxGeometry() {
  const G = new Geo(), bow = [], N = 10;
  // the body, straight and widening; the bow; the bell, leaning out and flaring
  const path = [[0, 0, 0.0135], [0, -0.12, bodyR(-0.12)], [0, -0.3, bodyR(-0.3)], [0, -0.47, 0.034]];
  for (let i = 1; i <= N; i++) { const a = Math.PI + Math.PI * i / N; bow.push([0.06 + 0.06 * Math.cos(a), -0.47 + 0.06 * Math.sin(a), lerp(0.034, 0.043, i / N)]); }
  path.push(...bow, [0.124, -0.41, 0.0455], [0.133, -0.335, 0.049], [0.144, -0.275, 0.055], [0.155, -0.238, 0.0625], [0.165, -0.213, 0.0715], [0.172, -0.2, 0.0805], [0.1745, -0.1965, 0.0835], [0.1735, -0.199, 0.079]);
  G.tube(path, 16, BRASS);
  // a dark stop a little way down the bell, so that it reads as open
  G.add(new THREE.CircleGeometry(0.047, 14), DARK, new THREE.Matrix4().compose(V(0.137, -0.315, 0), Q().setFromUnitVectors(Z, V(0.19, 0.98, 0).normalize()), V(1, 1, 1)));
  // the neck: up out of the body, over and back to the mouth; the collar where it goes in; the mouthpiece and its ligature
  G.tube([[0, -0.004, 0.0138], [0, 0.035, 0.0132], [-0.011, 0.07, 0.0126], [-0.038, 0.098, 0.012], [-0.08, 0.111, 0.0114], [-0.123, 0.108, 0.0108], [-0.155, 0.1, 0.0104]], 10, BRASS);
  G.rod(0, -0.012, 0, 0, 0.012, 0, 0.0175, BRASS2, 12);
  G.tube([[-0.148, 0.1015, 0.0128], [-0.19, 0.0915, 0.0128], [-0.222, 0.0845, 0.0095], [-0.248, 0.079, 0.0035]], 10, BLACK);
  G.tube([[-0.176, 0.095, 0.0142], [-0.203, 0.0885, 0.0142]], 10, SILVER);
  // the octave key on the neck
  G.rod(-0.028, 0.112, 0, -0.1, 0.127, 0, 0.0025, BRASS2, 5); G.rod(-0.1, 0.119, 0, -0.1, 0.127, 0, 0.0075, BRASS2, 8);
  // the pearl keys down the front, three for each hand, each in its cup; the long rods; the palm keys by the left hand
  for (const y of [-0.09, -0.125, -0.16, -0.285, -0.32, -0.355]) { const r = bodyR(y); G.rod(r - 0.002, y, -0.006, r + 0.006, y, -0.006, 0.0115, BRASS2, 10); G.rod(r + 0.006, y, -0.006, r + 0.0085, y, -0.006, 0.0088, PEARL, 10); }
  G.rod(0.012, -0.05, 0.02, 0.016, -0.455, 0.036, 0.0028, BRASS2, 5); G.rod(0.014, -0.05, -0.019, 0.02, -0.4, -0.033, 0.0028, BRASS2, 5); G.rod(-0.006, -0.2, 0.026, -0.006, -0.46, 0.036, 0.0025, BRASS2, 5);
  for (const [y, k] of [[-0.036, 0.02], [-0.057, 0.024], [-0.078, 0.022]]) G.rod(0.004, y, -bodyR(y) + 0.002, 0.006, y - 0.004, -bodyR(y) - k, 0.0055, BRASS2, 6);
  // the big covered holes down the side and on the bell, their guards, the brace between the body and the bell, the thumb hook and the strap ring
  for (const [y, r] of [[-0.205, 0.0155], [-0.245, 0.017], [-0.395, 0.021], [-0.44, 0.0225]]) { const b = bodyR(y), dx = 0.55, dz = 0.835; G.rod(dx * (b - 0.002), y, dz * (b - 0.002), dx * (b + 0.008), y, dz * (b + 0.008), r, BRASS2, 12); }
  G.rod(0.127, -0.39, 0.04, 0.129, -0.39, 0.054, 0.027, BRASS2, 12); G.rod(0.139, -0.325, 0.046, 0.141, -0.325, 0.06, 0.029, BRASS2, 12); G.rod(0.075, -0.522, 0.03, 0.077, -0.53, 0.047, 0.025, BRASS2, 12);
  G.add(new THREE.TorusGeometry(0.03, 0.0026, 5, 14, Math.PI), BRASS2, new THREE.Matrix4().compose(V(0.14, -0.325, 0.062), Q().setFromAxisAngle(Y, Math.PI / 2).multiply(Q().setFromAxisAngle(Z, Math.PI / 2)), V(1, 1, 1)));
  G.rod(0.028, -0.33, 0, 0.09, -0.33, 0, 0.0042, BRASS2, 6); G.rod(0.05, -0.33, 0, 0.068, -0.33, 0, 0.011, BRASS2, 10);
  G.add(new THREE.TorusGeometry(0.008, 0.0024, 5, 10), SILVER, new THREE.Matrix4().compose(V(-0.034, -0.185, 0), Q(), V(1, 1, 1)));
  G.rod(-0.024, -0.3, 0.012, -0.04, -0.31, 0.012, 0.006, BRASS2, 6);
  return G.build(SAX_S);
}

// THE CASE, open on the pavement: its own space has x away from him (towards whoever is listening), z along its length, the origin under its middle.
// The lid is hinged on his side and stands open, so its lining faces the street. A few bills and coins are in it already.
export const CASE = { len: 0.86, wid: 0.31, floor: 0.02, rim: 0.105 };
const BILL = [0.156, 0.066], GREEN = 0x66755f, GREEN2 = 0x9aa58e, FLY = 1.15;      /* round 2 ('cartoon green bills'): a dollar is grey-green, not grass-green */      // a dollar's own size in the case; the one in the air is drawn a third larger so that it is seen
export function caseGeometry() {
  const G = new Geo(), L = CASE.len, W = CASE.wid, H = CASE.rim, T = 0.014, SHELL = 0x141416, LINE = 0x7c1424, LINE2 = 0x64101c;
  const tray = (h, m, lining) => { G.box(0, T / 2, 0, W, T, L, SHELL, m); G.box(0, T + 0.003, 0, W - 2 * T, 0.006, L - 2 * T, lining, m);
    for (const s of [-1, 1]) { G.box(s * (W - T) / 2, h / 2, 0, T, h, L, SHELL, m); G.box(0, h / 2, s * (L - T) / 2, W - 2 * T, h, T, SHELL, m); G.box(s * (W / 2 - T - 0.002), h / 2 + T / 2, 0, 0.004, h - T, L - 2 * T, lining, m); G.box(0, h / 2 + T / 2, s * (L / 2 - T - 0.002), W - 2 * T, h - T, 0.004, lining, m); } };
  tray(H, null, LINE);
  // the lid: built shut and upside down over the tray, then swung open about the hinge on his side
  const open = 1.88, lid = new THREE.Matrix4().makeTranslation(-W / 2, H, 0).multiply(new THREE.Matrix4().makeRotationZ(open)).multiply(new THREE.Matrix4().makeTranslation(W / 2, 0.05, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI));
  tray(0.05, lid, LINE2);
  // the latches and the handle on the street side
  for (const z of [-0.26, 0.26]) G.box(W / 2 + 0.004, H - 0.02, z, 0.008, 0.03, 0.04, SILVER); G.box(W / 2 + 0.014, H * 0.5, 0, 0.012, 0.022, 0.13, 0x2a2a2e);
  // what is in it already: a few bills, some change
  let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (const [x, z, a] of [[0.03, -0.2, 0.5], [-0.04, 0.12, -0.9], [0.05, 0.24, 1.9], [-0.02, -0.05, 2.6]]) { const m = new THREE.Matrix4().compose(V(x, CASE.floor + 0.004 + r() * 0.004, z), Q().setFromAxisAngle(Y, a), V(1, 1, 1)); G.box(0, 0, 0, BILL[1], 0.0012, BILL[0], GREEN, m); G.box(0, 0.0008, 0, BILL[1] * 0.62, 0.0012, BILL[0] * 0.5, GREEN2, m); }
  for (let i = 0; i < 9; i++) { const x = (r() - 0.5) * 0.2, z = (r() - 0.5) * 0.66; G.rod(x, CASE.floor + 0.003, z, x, CASE.floor + 0.0055, z, 0.009 + r() * 0.004, r() < 0.3 ? 0xb87333 : SILVER, 8); }
  return G.build();
}

// THE HAT: a pork-pie, its origin in the middle of the sweatband, the front towards +x
export function hatGeometry() { const G = new Geo(), FELT = 0x26221f;
  G.add(new THREE.CylinderGeometry(0.094, 0.1, 0.07, 18), FELT, new THREE.Matrix4().makeTranslation(0, 0.036, 0)); G.add(new THREE.CylinderGeometry(0.078, 0.094, 0.012, 18), FELT, new THREE.Matrix4().makeTranslation(0, 0.066, 0));
  G.add(new THREE.CylinderGeometry(0.102, 0.102, 0.022, 18, 1, true), 0x6b1f1a, new THREE.Matrix4().makeTranslation(0, 0.012, 0)); G.add(new THREE.CylinderGeometry(0.136, 0.14, 0.008, 20), FELT, new THREE.Matrix4().makeTranslation(0, 0.002, 0));
  return G.build(); }

// THE DOLLARS dropped in the case: up to BILLS of them in one geometry; each is a strip of four quads so that it can curl as it falls
export const BILLS = 8, BILL_V = 10;
export function billsGeometry() { const g = new THREE.BufferGeometry(), n = BILLS * BILL_V, P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), C = new Float32Array(n * 3), I = [], c1 = new THREE.Color(GREEN), c2 = new THREE.Color(GREEN2);
  for (let b = 0; b < BILLS; b++) { for (let k = 0; k < 5; k++) for (let e = 0; e < 2; e++) { const i = b * BILL_V + k * 2 + e, c = k === 0 || k === 4 ? c2 : c1; C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b; Nn[i * 3 + 1] = 1; P[i * 3 + 1] = -50; }
    for (let k = 0; k < 4; k++) { const a = b * BILL_V + k * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setIndex(I); return g; }
// write bill b: its middle at (x, y, z), turned by yaw, tipped by roll about its length, curled by curl (0 = flat)
const _bq = Q(), _bq2 = Q(), _bv = V();
export function setBill(geo, b, x, y, z, yaw, roll, curl) { const P = geo.attributes.position; _bq.setFromAxisAngle(Y, yaw); _bq2.setFromAxisAngle(X, roll); _bq.multiply(_bq2);
  for (let k = 0; k < 5; k++) for (let e = 0; e < 2; e++) { const u = k / 4 - 0.5; _bv.set(u * BILL[0] * FLY, curl * (u * u * 4 - 0.33) * 0.03, (e - 0.5) * BILL[1] * FLY).applyQuaternion(_bq); P.setXYZ(b * BILL_V + k * 2 + e, x + _bv.x, y + _bv.y, z + _bv.z); }
  P.needsUpdate = true; }

// ------------------------------------------------------------------------------------------------ the player
const _m = V(), _a = V(), _b = V(), _c = V(), _q = Q(), _q2 = Q(), _q3 = Q(), _N = {};
const rz = (q, a) => q.setFromAxisAngle(Z, a), rx = (q, a) => q.setFromAxisAngle(X, a), ry = (q, a) => q.setFromAxisAngle(Y, a);
const toward = (v, to, dt, tau) => v + (to - v) * (1 - Math.exp(-dt / tau));
// which of the six main keys are down for a note: the lower the note within its octave, the more fingers (left hand's three first), as on the horn
function fingering(m, out) { const k = ((m - 50) % 12 + 12) % 12, down = clamp(6 - Math.round(k * 0.55), 0, 6); for (let i = 0; i < 6; i++) out[i] = i < down ? 1 : 0; if (k === 11 || k === 1) out[1] = 1 - out[1]; return out; }

export const POSE = {
  mouth: [0.088, -0.034, 0],          // the lips, from the head bone, in the figure's rest axes (times its size)
  up: [0.33, 0.9, -0.3],              // the body of the horn while he plays: its top is forward of and to the left of its bottom (the bow hangs by his right hip)
  fwd: [1, -0.25, 0.12],              // which way the bell faces
  wristL: [-0.07, 0.0, -0.062], wristR: [-0.068, -0.005, 0.066],      // each wrist from its place on the tube, in the horn's space
  back: 0.5,                          // metres he steps back when frightened
};

export class Player {
  constructor(rig) {
    this.rig = rig; this.sax = { p: V(), q: Q() }; this.hat = { p: V(), q: Q(), s: 1 }; this.strapPts = [V(), V(), V()]; this.T = 0;
    this.up = 1; this.back = 0; this.lift = 0; this.lean = 0; this.crouch = 0; this.fl = 0; this.nodT = -1; this.liftT = -1; this.look = 0; this.tx = 1; this.tz = 0; this.air = 0;
    this.curl = new Float32Array(8).fill(0.5); this.keys = [1, 1, 1, 0, 0, 0]; this.pk = [0, 0];
    // each hand's own axes in the rest pose: along the hand (wrist to the middle knuckle) and out of the palm
    this.hb = {}; for (const s of ['L', 'R']) { const mid = rig.obj.getObjectByName(rig.name + '_middle_01_' + s), along = mid ? mid.position.clone().applyQuaternion(rig.Q0['hand_' + s]).normalize() : V(1, 0, 0), palm = (rig.palm && rig.palm[s]) || V(0, -1, 0);
      this.hb[s] = basisQ(Q(), along.x, along.y, along.z, palm.x, palm.y, palm.z).invert(); }
  }
  flinch() { this.fl = 1; }
  thank(how) { if (how === 'lift') this.liftT = 0; else this.nodT = 0; }
  // a point of the horn (its own space, already scaled) in his space
  saxAt(v, out) { return out.copy(v).applyQuaternion(this.sax.q).add(this.sax.p); }

  update(dt, ctl) {
    const r = this.rig, k = r.k, P0 = r.P0, N = noteAt(ctl.t, _N), n = ctl.scared || ctl.sound === false ? null : N.n; this.T += dt;
    // ---- what the music asks of the body
    const upTo = ctl.scared ? 0 : 1; this.up = upTo ? Math.min(1, this.up + dt / 0.8) : Math.max(0, this.up - dt / 0.4); this.back = clamp(this.back + (ctl.scared ? dt / 0.6 : -dt / 0.9), 0, 1);
    if (ctl.scared) { this.tx = ctl.tx === undefined ? 1 : ctl.tx; this.tz = ctl.tz || 0; } this.look = toward(this.look, ctl.scared ? 1 : 0, dt, 0.25); this.fl = toward(this.fl, 0, dt, 0.45);
    if (this.nodT >= 0) { this.nodT += dt / 1.1; if (this.nodT >= 1) this.nodT = -1; } if (this.liftT >= 0) { this.liftT += dt / 1.3; if (this.liftT >= 1) this.liftT = -1; }
    const nod = this.nodT >= 0 ? Math.pow(Math.sin(Math.PI * 2 * this.nodT), 2) * (1 - 0.35 * this.nodT) : 0, thx = this.liftT >= 0 ? Math.sin(Math.PI * this.liftT) : 0;
    const high = n ? clamp((n.m - 67) / 7, 0, 1) : 0, low = n && n.m <= 51 ? 1 : 0, coming = !n && N.rest < 0.35 && !ctl.scared ? 1 : 0;
    this.lift = toward(this.lift, Math.max(high * (n && n.long ? 1 : 0.6), thx * 0.8), dt, 0.28); this.lean = toward(this.lean, n ? (n.long ? 0.55 + 0.45 * high : 0.22) : 0, dt, n ? 0.5 : 0.7); this.crouch = toward(this.crouch, low, dt, 0.3);
    this.air = toward(this.air, !n && !coming && !ctl.scared ? 1 : 0, dt, 0.3);      // between phrases: the shoulders drop, a breath
    if (n) fingering(n.m, this.keys); const wig = n ? 0 : 0.06 * Math.sin(this.T * 5.1);
    for (let i = 0; i < 8; i++) { const f = i % 4, h = i < 4 ? 0 : 3, key = f < 3 ? this.keys[h + f] : (n && (n.m + (h ? 1 : 0)) % 3 === 0 ? 1 : 0), to = f < 3 ? (key ? 0.66 : 0.34 + wig) : (key ? 0.6 : 0.42); this.curl[i] = toward(this.curl[i], to, dt, 0.035); }
    // ---- the body: soft knees, a slow sway over four beats, a dip on the beat, the left foot tapping; back on long notes, bent over the low ones
    const beat = ctl.t / (TT * 3), play = this.up * (1 - this.look), sw = Math.sin(Math.PI * beat / 2) * 0.032 * play, dip = 0.016 * Math.pow(Math.max(0, Math.cos(Math.PI * beat)), 2) * play * (n ? 1 : 0.4), tap = Math.pow(Math.max(0, Math.sin(TAU * beat - 0.6)), 3) * 0.035 * play;
    const lean = this.lean * play, cr = this.crouch * play, fl = this.fl, eb = ease(this.back), bx = -POSE.back * eb;
    r.reset(); r.stand(bx, 0, 0);
    r.hipP.set(P0.hips.x + 0.045 * lean - 0.03 * cr - 0.05 * fl, r.H - (0.045 + dip + 0.06 * cr + 0.13 * fl + 0.02 * this.look) * k, sw);
    rx(_q, sw * 0.9); rz(_q2, 0.04 * lean - 0.04 * cr); r.hipQ.copy(_q).multiply(_q2);
    rz(r.chestQ, 0.035 + 0.2 * lean - 0.3 * cr - 0.32 * fl + 0.03 * this.air + 0.1 * this.lift * play - 0.07 * nod); rx(_q, -sw * 1.3); r.chestQ.multiply(_q); ry(_q, -0.1 * play); r.chestQ.multiply(_q);
    // the feet: planted, the right one a little back; stepping back the right goes first, then the left
    const eR = ease(clamp(this.back * 2, 0, 1)), eL = ease(clamp(this.back * 2 - 1, 0, 1)), fy = (e) => 0.07 * Math.sin(Math.PI * e);
    r.foot('L', P0.foot_L.x + 0.07 - POSE.back * eL, P0.foot_L.y + fy(eL) + tap, -0.105 * k, true, 1, 1, 0, -0.3); r.foot('R', P0.foot_R.x - 0.06 - POSE.back * eR, P0.foot_R.y + fy(eR), 0.12 * k, true, 1, 1, 0, 0.35);
    // the head: chin a little down onto the mouthpiece, back with the horn on a high note, a nod of thanks; frightened, it turns to the danger
    rz(_q, -0.1 + 0.2 * this.lift * play + 0.1 * lean - 0.3 * nod * play); r.headQ.copy(r.chestQ).multiply(_q); r.headFollow = false;
    if (this.look > 0.01) { _a.set(this.tx, -0.05, this.tz).normalize(); _b.set(1, 0, 0).applyQuaternion(r.headQ); _q.setFromUnitVectors(_b, _a); const ang = 2 * Math.acos(clamp(Math.abs(_q.w), 0, 1)), mx = 1.05; _q2.identity().slerp(_q, this.look * (ang > mx ? mx / ang : 1)); r.headQ.premultiply(_q2); }
    r.solve();
    // ---- the horn: its mouthpiece in his mouth, the body down past his right hip, the bell out in front; lowered, it hangs on the strap across his chest
    r.at('head', _m, POSE.mouth[0] * k, POSE.mouth[1] * k, POSE.mouth[2] * k);
    const pitch = 0.5 * this.lift + 0.22 * lean - 0.2 * cr - 0.3 * nod + 0.05 * Math.sin(Math.PI * beat / 2 + 1);
    basisQ(_q, POSE.fwd[0], POSE.fwd[1], POSE.fwd[2], POSE.up[0], POSE.up[1], POSE.up[2]); rz(_q2, pitch); _q2.multiply(_q); rx(_q3, -sw * 2); _q2.premultiply(_q3);
    if (this.up < 1) { const u = ease(this.up); r.at('chest2', _a, 0.2 * k, 0.1 * k, 0.03 * k); _m.lerpVectors(_a, _m, u); basisQ(_q, 1, -0.3, 0.3, 0.22, 0.9, -0.38); _q.slerp(_q2, u); _q2.copy(_q); }
    this.sax.q.copy(_q2); this.sax.p.copy(SAX.mouth).applyQuaternion(_q2).negate().add(_m);
    // ---- the hands on it: the left on the upper keys, the right on the lower, each wrist behind and outside the tube, the palm turned in to it
    const sc = k < 1 ? 0.5 + 0.5 * k : 1;
    for (const s of ['L', 'R']) { const w = s === 'L' ? POSE.wristL : POSE.wristR, at = s === 'L' ? SAX.left : SAX.right; _a.set(at.x + w[0] * sc, at.y + w[1], at.z + w[2] * sc); this.saxAt(_a, _a);
      if (s === 'L') r.hand('L', _a.x, _a.y, _a.z, true, -0.25, -0.55, -0.8); else r.hand('R', _a.x, _a.y, _a.z, true, -0.55, -0.3, 0.78); }
    r.solve();
    for (const s of ['L', 'R']) { const zs = s === 'L' ? -1 : 1, hk = 'hand_' + s; _a.set(0.86, 0.12, -zs * 0.5).applyQuaternion(this.sax.q).applyQuaternion(r.root.qi); _b.set(0.25, 0, -zs).applyQuaternion(this.sax.q).applyQuaternion(r.root.qi);
      basisQ(_q, _a.x, _a.y, _a.z, _b.x, _b.y, _b.z); _q.multiply(this.hb[s]); r.Q[hk].copy(_q).multiply(r.Q0[hk]); }
    // the strap: from its ring on the horn up to each side of his neck
    // the hat: on his head (placed in his space each frame, like the horn), tipped back a little
    r.at('head', this.hat.p, 0.004 * k, 0.112 * k, 0); r.delta('head', this.hat.q); rz(_q, 0.1); this.hat.q.multiply(_q); this.hat.s = k > 1 ? 1 : 0.5 + 0.5 * k;
    this.saxAt(SAX.ring, this.strapPts[0]); r.at('neck', this.strapPts[1], -0.045 * k, 0.03 * k, -0.062 * k); r.at('neck', this.strapPts[2], -0.045 * k, 0.03 * k, 0.062 * k);
    return N;
  }
  // after rig.apply: the eight fingers on the keys, each with its own curl (the rig's own grip is one number for a whole hand)
  fingers() { const fin = this.rig.fin; for (let i = 0; i < fin.length; i++) { const fg = fin[i], side = i < fin.length / 2 ? 0 : 1, per = fin.length / 2 / 4, f = Math.floor((i % (fin.length / 2)) / per), j = i % per, c = this.curl[side * 4 + f] * (j === 0 ? 0.75 : j === 1 ? 1.25 : 0.8);
      _q.setFromAxisAngle(fg.ax, c * 1.1); fg.bn.quaternion.copy(fg.q0).multiply(_q); fg.on = true; } }
}

// the strap as one small geometry: two flat bands from the ring to the sides of the neck (8 corners), rewritten each frame
export function strapGeometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(24), 3)); g.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]); return g; }
export function setStrap(geo, pts, w = 0.024) { const P = geo.attributes.position, Nn = geo.attributes.normal;
  for (let s = 0; s < 2; s++) { const a = pts[0], b = pts[1 + s]; _a.subVectors(b, a).normalize(); _b.set(1, 0.2, 0); _c.crossVectors(_a, _b).normalize().multiplyScalar(w / 2); _b.crossVectors(_c, _a).normalize(); const o = s * 4;
    P.setXYZ(o, a.x - _c.x * 0.5, a.y - _c.y * 0.5, a.z - _c.z * 0.5); P.setXYZ(o + 1, a.x + _c.x * 0.5, a.y + _c.y * 0.5, a.z + _c.z * 0.5); P.setXYZ(o + 2, b.x - _c.x, b.y - _c.y, b.z - _c.z); P.setXYZ(o + 3, b.x + _c.x, b.y + _c.y, b.z + _c.z);
    for (let i = 0; i < 4; i++) Nn.setXYZ(o + i, Math.abs(_b.x) > 0 ? _b.x * Math.sign(_b.x) : 1, _b.y * Math.sign(_b.x || 1), _b.z * Math.sign(_b.x || 1)); }
  P.needsUpdate = true; Nn.needsUpdate = true; }
