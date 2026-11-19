// surprises/showtime-pose.js: the dancers' bodies (surprises lane, Nov 17). No game in here: a small pose rig over the people export's skeleton
// (52 bones, each character facing +X, Y up, left = -Z) and the moves of the show. showtime.js drives it; helper-showtime/preview.mjs draws it in node.
//   new Rig(object, name)      object = game.kit.person(name).object (bones named <name>_hips, <name>_upper_arm_L ...)
//   rig.reset() ... set the pose ... rig.solve() ... rig.apply(dt, origin, w)
// A pose is: where the figure's root stands and how it is turned (stage space), the pelvis (object space), a lean for pelvis / chest / head, and for each
// limb either a point to reach (two-bone IK: wrist or ankle, with a hint for the elbow or knee) or two directions (upper and lower bone).
// Every bone starts from "carried by its parent in the rest pose" and is swung the shortest way onto its direction, so nothing twists by itself.
// STAGE SPACE: origin on the car floor at the foot of the doorway's pole, x across the car, y up, z along the car (the train's own axes).
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _q = Q(), _q2 = Q(), _m = new THREE.Matrix4();

const CH = ['hips', 'spine', 'chest', 'chest2', 'neck', 'head', 'clavicle_L', 'upper_arm_L', 'forearm_L', 'hand_L', 'clavicle_R', 'upper_arm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'toe_L', 'thigh_R', 'shin_R', 'foot_R', 'toe_R'];
const WANT = { spine: 'hips', chest: 'spine', chest2: 'chest', neck: 'chest2', head: 'neck', clavicle_L: 'chest2', upper_arm_L: 'clavicle_L', forearm_L: 'upper_arm_L', hand_L: 'forearm_L',
  clavicle_R: 'chest2', upper_arm_R: 'clavicle_R', forearm_R: 'upper_arm_R', hand_R: 'forearm_R', thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', toe_L: 'foot_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R', toe_R: 'foot_R' };
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

// quaternion with x = f (made square to u), y = u, z = x cross y
export function basisQ(q, fx, fy, fz, ux, uy, uz) {
  _b.set(ux, uy, uz).normalize(); _a.set(fx, fy, fz); _a.addScaledVector(_b, -_a.dot(_b));
  if (_a.lengthSq() < 1e-8) _a.set(1, 0, 0).addScaledVector(_b, -_b.x); _a.normalize(); _c.crossVectors(_a, _b);
  _m.makeBasis(_a, _b, _c); return q.setFromRotationMatrix(_m);
}
// heading (a turn about y) that faces the stage direction (dx, dz)
export const face = (dx, dz) => Math.atan2(-dz, dx);

// two-bone IK: from s towards t with lengths a and b, the middle joint pushed towards `hint`. Fills mid and end (end = t pulled into reach).
function ik2(s, t, a, b, hint, mid, end) {
  _d.subVectors(t, s); let d = _d.length(); if (d < 1e-5) { _d.set(0, -1, 0); d = 1e-5; } _d.multiplyScalar(1 / d);
  const dd = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.004), ca = clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1), sa = Math.sqrt(1 - ca * ca);
  _e.copy(hint).addScaledVector(_d, -hint.dot(_d)); if (_e.lengthSq() < 1e-8) { _e.set(_d.y, _d.z, _d.x); _e.addScaledVector(_d, -_e.dot(_d)); } _e.normalize();
  mid.copy(s).addScaledVector(_d, a * ca).addScaledVector(_e, a * sa); end.copy(s).addScaledVector(_d, dd);
}

export class Rig {
  constructor(obj, name) {
    this.obj = obj; this.name = name; this.b = {}; this.qL = {}; this.pL = {}; this.Q0 = {}; this.P0 = {}; this.Q = {}; this.P = {}; this.par = {}; this.snap = {}; this.fin = [];
    for (const k of CH) { const bn = obj.getObjectByName(name + '_' + k); if (!bn) throw new Error('showtime: no bone ' + name + '_' + k); this.b[k] = bn; }
    if (this.b.hips.parent !== obj) throw new Error('showtime: the hips are not the figure\'s child');
    for (const k of CH) { const bn = this.b[k], pk = k === 'hips' ? null : CH.find((c) => this.b[c] === bn.parent);
      if (k !== 'hips' && pk !== WANT[k]) throw new Error('showtime: ' + k + ' hangs off ' + (pk || bn.parent.name) + ', not ' + WANT[k]);
      this.par[k] = pk; this.qL[k] = bn.quaternion.clone(); this.pL[k] = bn.position.clone();
      this.Q0[k] = pk ? this.Q0[pk].clone().multiply(this.qL[k]) : this.qL[k].clone();
      this.P0[k] = pk ? this.pL[k].clone().applyQuaternion(this.Q0[pk]).add(this.P0[pk]) : this.pL[k].clone();
      this.Q[k] = Q(); this.P[k] = V(); this.snap[k] = Q(); }
    // the fingers (for a grip on the pole and the bar): each finger bone curls about an axis square to the finger and to the palm, worked out once from the rest pose
    this.grip = { L: 0, R: 0 };
    const wq = (bn) => { const q = Q(); for (let b = bn; b && b !== obj; b = b.parent) q.premultiply(b.quaternion); return q; }, wp = (bn) => { const v = V(); for (let b = bn; b && b !== obj; b = b.parent) v.applyQuaternion(b.quaternion).add(b.position); return v; };
    for (const s of ['L', 'R']) { const B = (n) => obj.getObjectByName(name + '_' + n + '_' + s), idx = B('index_01'), pky = B('pinky_01'), mid = B('middle_01'); if (!idx || !pky || !mid) continue;
      const along = wp(mid).sub(this.P0['hand_' + s]).normalize(), across = wp(pky).sub(wp(idx)).normalize(), palm = V().crossVectors(along, across).multiplyScalar(s === 'L' ? -1 : 1).normalize();      // out of the palm
      for (const f of FINGERS) for (const j of ['01', '02', '03']) { const bn = B(f + '_' + j); if (!bn) continue; const c = bn.children[0], q0 = wq(bn), dir = (c ? c.position.clone().applyQuaternion(q0) : bn.position.clone().applyQuaternion(wq(bn.parent))).normalize();
        this.fin.push({ bn, q0: bn.quaternion.clone(), s, ax: V().crossVectors(dir, palm).normalize().applyQuaternion(q0.invert()), on: false }); }
      this.palm = this.palm || {}; this.palm[s] = palm; }
    const len = (k) => this.pL[k].length(), dir = (k) => this.pL[k].clone().normalize();
    this.L = { aU: { L: len('forearm_L'), R: len('forearm_R') }, aF: { L: len('hand_L'), R: len('hand_R') }, tL: { L: len('shin_L'), R: len('shin_R') }, sL: { L: len('foot_L'), R: len('foot_R') } };
    this.D = { up: { L: dir('forearm_L'), R: dir('forearm_R') }, fo: { L: dir('hand_L'), R: dir('hand_R') }, th: { L: dir('shin_L'), R: dir('shin_R') }, sh: { L: dir('foot_L'), R: dir('foot_R') } };
    this.H = this.P0.hips.y; this.k = this.H / 0.97;      // pelvis height; the figure's size against ped_a
    this.sh = this.P0.upper_arm_L.y;      // shoulder height
    this.root = { p: V(), q: Q(), qi: Q() }; this.hipP = V(); this.hipQ = Q(); this.chestQ = Q(); this.headQ = Q(); this.headFollow = true;
    const limb = () => ({ ik: false, a: V(), b: V(), flat: 0 });
    this.arm = { L: limb(), R: limb() }; this.leg = { L: limb(), R: limb() }; this.footQ = Q();
    this.snapP = V(); this.snapRP = V(); this.snapRQ = Q(); this.fade = 0; this.fadeT = 0; this.key = ''; this.posed = false;
    this.reset();
  }
  // a quiet standing pose at the stage origin: arms hanging, feet where the rest pose has them
  reset() {
    const P0 = this.P0; this.root.p.set(0, 0, 0); this.root.q.identity(); this.root.qi.identity(); this.hipP.copy(P0.hips); this.hipQ.identity(); this.chestQ.identity(); this.headQ.identity(); this.headFollow = true; this.footQ.identity();
    for (const s of ['L', 'R']) { const z = s === 'L' ? -1 : 1; this.arm[s].ik = false; this.arm[s].a.set(0.02, -1, z * 0.14); this.arm[s].b.set(0.22, -1, z * 0.06);
      this.leg[s].ik = true; this.leg[s].a.copy(P0['foot_' + s]); this.leg[s].b.set(1, 0, z * 0.12); this.leg[s].flat = 1; this.grip[s] = 0; }
    return this;
  }
  // the root: standing at a stage point with a heading, or any turn at all
  stand(x, z, th, y = 0) { this.root.p.set(x, y, z); this.root.q.setFromAxisAngle(Y, th); this.root.qi.copy(this.root.q).invert(); return this; }
  turn(q) { this.root.q.copy(q); this.root.qi.copy(q).invert(); return this; }
  // put the root so that the pelvis (hipP, already set) is at this stage point; call after turn()
  hipsAt(x, y, z) { _a.copy(this.hipP).applyQuaternion(this.root.q); this.root.p.set(x - _a.x, y - _a.y, z - _a.z); return this; }
  toObj(v) { return v.sub(this.root.p).applyQuaternion(this.root.qi); }
  toStage(v) { return v.applyQuaternion(this.root.q).add(this.root.p); }
  hand(s, x, y, z, stage = false, hx = -0.35, hy = -0.55, hz = 0.75 * (s === 'L' ? -1 : 1)) { const A = this.arm[s]; A.ik = true; A.a.set(x, y, z); if (stage) this.toObj(A.a); A.b.set(hx, hy, hz); return this; }
  arms(s, ux, uy, uz, fx, fy, fz, stage = false) { const A = this.arm[s]; A.ik = false; A.a.set(ux, uy, uz).normalize(); A.b.set(fx, fy, fz).normalize(); if (stage) { A.a.applyQuaternion(this.root.qi); A.b.applyQuaternion(this.root.qi); } return this; }
  foot(s, x, y, z, stage = false, flat = 1, kx = 1, ky = 0, kz = 0) { const A = this.leg[s]; A.ik = true; A.a.set(x, y, z); if (stage) this.toObj(A.a); A.b.set(kx, ky, kz); A.flat = flat; return this; }
  legs(s, tx, ty, tz, sx, sy, sz, stage = false, flat = 0) { const A = this.leg[s]; A.ik = false; A.a.set(tx, ty, tz).normalize(); A.b.set(sx, sy, sz).normalize(); if (stage) { A.a.applyQuaternion(this.root.qi); A.b.applyQuaternion(this.root.qi); } A.flat = flat; return this; }
  // turn the head towards a stage direction, no further than `max` from where the chest carries it
  look(dx, dy, dz, max = 0.9) { _a.set(dx, dy, dz).normalize().applyQuaternion(this.root.qi); _b.set(1, 0, 0).applyQuaternion(this.chestQ); const ang = _b.angleTo(_a); _q.setFromUnitVectors(_b, _a);
    if (ang > max) _q2.identity().slerp(_q, max / ang); else _q2.copy(_q); this.headQ.copy(_q2).multiply(this.chestQ); this.headFollow = false; return this; }
  // a change of move: the pose now on the bones is kept and faded into the new one over d seconds
  cut(d = 0.22) { if (!this.posed) return; for (const k of CH) this.snap[k].copy(this.b[k].quaternion); this.snapP.copy(this.b.hips.position); this.snapRP.copy(this.obj.position); this.snapRQ.copy(this.obj.quaternion); this.fade = d; this.fadeT = 0; }
  ph(key, d = 0.22) { if (this.key !== key) { this.cut(d); this.key = key; } }

  solve() {
    const { Q, P, qL, pL, Q0, L, D } = this, hq = this.headFollow ? this.chestQ : this.headQ;
    Q.hips.copy(this.hipQ).multiply(Q0.hips); P.hips.copy(this.hipP);
    const bone = (k) => { P[k].copy(pL[k]).applyQuaternion(Q[this.par[k]]).add(P[this.par[k]]); };
    bone('spine'); Q.spine.copy(this.hipQ).slerp(this.chestQ, 0.34).multiply(Q0.spine);
    bone('chest'); Q.chest.copy(this.hipQ).slerp(this.chestQ, 0.67).multiply(Q0.chest);
    bone('chest2'); Q.chest2.copy(this.chestQ).multiply(Q0.chest2);
    bone('neck'); Q.neck.copy(this.chestQ).slerp(hq, 0.5).multiply(Q0.neck);
    bone('head'); Q.head.copy(hq).multiply(Q0.head);
    for (const s of ['L', 'R']) {
      const cl = 'clavicle_' + s, up = 'upper_arm_' + s, fo = 'forearm_' + s, ha = 'hand_' + s, A = this.arm[s];
      bone(cl); Q[cl].copy(this.chestQ).multiply(Q0[cl]); bone(up);
      if (A.ik) { ik2(P[up], A.a, L.aU[s], L.aF[s], A.b, P[fo], P[ha]); _a.subVectors(P[fo], P[up]).normalize(); _b.subVectors(P[ha], P[fo]).normalize(); } else { _a.copy(A.a); _b.copy(A.b); }
      this.aim(up, cl, D.up[s], _a); P[fo].copy(P[up]).addScaledVector(_a, L.aU[s]);
      this.aim(fo, up, D.fo[s], _b); P[ha].copy(P[fo]).addScaledVector(_b, L.aF[s]);
      Q[ha].copy(Q[fo]).multiply(qL[ha]);
      const th = 'thigh_' + s, sn = 'shin_' + s, ft = 'foot_' + s, to = 'toe_' + s, G = this.leg[s];
      bone(th);
      if (G.ik) { ik2(P[th], G.a, L.tL[s], L.sL[s], G.b, P[sn], P[ft]); _a.subVectors(P[sn], P[th]).normalize(); _b.subVectors(P[ft], P[sn]).normalize(); } else { _a.copy(G.a); _b.copy(G.b); }
      this.aim(th, 'hips', D.th[s], _a); P[sn].copy(P[th]).addScaledVector(_a, L.tL[s]);
      this.aim(sn, th, D.sh[s], _b); P[ft].copy(P[sn]).addScaledVector(_b, L.sL[s]);
      Q[ft].copy(Q[sn]).multiply(qL[ft]); if (G.flat > 0) { _q.copy(this.footQ).multiply(Q0[ft]); Q[ft].slerp(_q, G.flat); }
      bone(to); Q[to].copy(Q[ft]).multiply(qL[to]);
    }
    return this;
  }
  // bone k: carried by its parent in the rest pose, then swung the shortest way so that its own axis (dLoc, in its own space) lies along dir (object space)
  aim(k, par, dLoc, dir) { const q = this.Q[k]; q.copy(this.Q[par]).multiply(this.qL[k]); _c.copy(dLoc).applyQuaternion(q); _q.setFromUnitVectors(_c, dir); q.premultiply(_q); }
  // write the pose to the bones. origin = the stage's origin in the parent's space; w = how much of the pose (1 = all, less = the rest left to the mixer's clip)
  apply(dt, origin, w = 1) {
    const o = this.obj; let f = 1; if (this.fade > 0) { this.fadeT += dt; f = ease(this.fadeT / this.fade); if (f >= 1) this.fade = 0; }
    _a.copy(this.root.p).add(origin);
    if (f < 1) { _a.lerpVectors(this.snapRP, _a, f); _q2.copy(this.snapRQ).slerp(this.root.q, f); } else _q2.copy(this.root.q);
    if (w >= 1) { o.position.copy(_a); o.quaternion.copy(_q2); } else { o.position.lerp(_a, w); o.quaternion.slerp(_q2, w); }
    for (const k of CH) { const p = this.par[k], bn = this.b[k];
      if (p) _q.copy(this.Q[p]).invert().multiply(this.Q[k]); else _q.copy(this.Q[k]);
      if (f < 1) { _q2.copy(this.snap[k]).slerp(_q, f); _q.copy(_q2); }
      if (w >= 1) bn.quaternion.copy(_q); else bn.quaternion.slerp(_q, w); }
    _b.copy(this.hipP); if (f < 1) _b.lerpVectors(this.snapP, _b, f);
    if (w >= 1) this.b.hips.position.copy(_b); else this.b.hips.position.lerp(_b, w);
    for (const fg of this.fin) { const g = this.grip[fg.s] * w; if (g > 0.01) { _q.setFromAxisAngle(fg.ax, g * 1.1); fg.bn.quaternion.copy(fg.q0).multiply(_q); fg.on = true; } else if (fg.on) { fg.bn.quaternion.copy(fg.q0); fg.on = false; } }
    this.posed = true;
  }
  // a point of the solved pose in stage space (bone joint + an offset in object space turned with the bone)
  at(k, out, ox = 0, oy = 0, oz = 0) { out.set(ox, oy, oz); if (ox || oy || oz) { _q.copy(this.Q0[k]).invert().premultiply(this.Q[k]); out.applyQuaternion(_q); } out.add(this.P[k]); return this.toStage(out); }
  // how bone k is turned against its rest pose, in stage space
  delta(k, out) { return out.copy(this.Q0[k]).invert().premultiply(this.Q[k]).premultiply(this.root.q); }
}

// ------------------------------------------------------------------------------------------------ the moves
// c (the stage): { GX: the overhead bars at x = +-GX, barY, ceil, hw (half the car's inside width), sb: the side (+-1) of the bar that is used, far: +-1 the way along the car
// that is AWAY from the audience, beat: the beat clock (beats, a float) }. s = seconds into the move.
const _u = V(), _f = V(), _p = V(), _r = V(), _t = V(), _h = V(), _qa = Q(), _qb = Q();
const rz = (q, a) => q.setFromAxisAngle(Z, a), rx = (q, a) => q.setFromAxisAngle(X, a), ry = (q, a) => q.setFromAxisAngle(Y, a);
const zs = (s) => (s === 'L' ? -1 : 1);

// where each one stands when it is not his turn: all three on the far side of the doorway from the audience (the pole swing sweeps a metre round the pole);
// C's floor is the aisle on the audience's side
export function spots(c) {
  return { A: [-c.sb * 0.2, c.far * 1.6, face(0, -c.far)], B: [c.sb * 0.6, c.far * 1.02, face(-0.15 * c.sb, -c.far)], C: [-c.sb * 0.78, c.far * 0.98, face(0.2 * c.sb, -c.far)],
    floor: [-c.sb * 0.12, -c.far * 1.35], box: [-c.sb * (c.hw - 0.2), c.far * 0.42] };
}

// feet on the floor where the rest pose has them, a little apart
function plant(r, w = 0.15, y = 0) { const P = r.P0; r.foot('L', P.foot_L.x, P.foot_L.y + y, -w, false, 1, 1, 0, -0.2); r.foot('R', P.foot_R.x, P.foot_R.y + y, w, false, 1, 1, 0, 0.2); }

// waiting your turn: a bounce on the beat, a sway over two beats, a clap on the backbeat
export function groove(r, c, sp, clap = 1, amt = 1) {
  const b = c.beat, dip = 0.06 * Math.pow(Math.max(0, Math.cos(TAU * b)), 2) * amt, sw = 0.05 * Math.sin(Math.PI * b) * amt;
  r.stand(sp[0], sp[1], sp[2]); r.hipP.set(r.P0.hips.x - dip * 0.3, r.H - 0.025 - dip, sw);
  rx(r.hipQ, sw * 0.8); rx(_qa, -sw * 1.4); rz(_qb, -0.06 - dip * 1.6); r.chestQ.copy(_qa).multiply(_qb);
  rz(_qb, 0.05 - dip * 2.2); r.headQ.copy(r.chestQ).multiply(_qb); r.headFollow = false; plant(r, 0.16);
  if (clap > 0) { const u = (((b % 2) + 2) % 2) / 2, ap = 0.035 + 0.2 * Math.pow(Math.abs(Math.cos(Math.PI * u)), 0.55), y = r.sh - 0.2 - dip;
    r.hand('L', 0.3, y, -ap + sw, false, -0.1, -0.5, -0.85); r.hand('R', 0.3, y + 0.015, ap + sw, false, -0.1, -0.5, 0.85); }
  else { r.arms('L', 0.05, -1, -0.2 - dip, 0.3, -0.9, -0.1); r.arms('R', 0.05, -1, 0.2 + dip, 0.3, -0.9, 0.1); }
}

// THE CALL-OUT (4.8 s), the leader out in front: one arm up pumping, a hand by his mouth; then he points down the car
export function callout(r, c, s, sp0) {
  const b = c.beat, dip = 0.07 * Math.pow(Math.max(0, Math.cos(TAU * b)), 2), k = ease(s / 0.8), x = lerp(sp0[0], -c.sb * 0.3, k), z = lerp(sp0[1], -c.far * 0.75, k);
  r.ph('call'); r.stand(x, z, face(0, -c.far)); r.hipP.set(r.P0.hips.x, r.H - 0.03 - dip, 0.03 * Math.sin(Math.PI * b)); plant(r, 0.2);
  rz(r.chestQ, 0.1); r.look(0, 0.1, -c.far, 0.5);
  if (s < 2.5) { r.arms('R', 0.1, 1, 0.28, 0.12, 1, -0.1 + dip * 3); r.hand('L', 0.17, r.sh + 0.14, -0.1, false, 0.2, -0.6, -0.8); }      // "SHOWTIME!"
  else { r.ph('call2'); const sw = Math.sin(Math.PI * b); r.arms('R', 0.8, 0.12 + dip, 0.45 + 0.25 * sw, 0.95, 0.1, 0.1 + 0.3 * sw); r.arms('L', 0.5, -0.3, -0.75, 0.6, 0.6, -0.5); rx(r.hipQ, 0.06 * sw); }
}

// THE POLE (7.2 s): two steps in, both hands on the pole, round it two and a half times with the feet off the floor, down into a low spin, up with the arms wide
export function poleAct(r, c, s, sp) {
  const R = 0.5, dir = c.sb, ph0 = Math.atan2(c.far * 0.75, -c.sb * 0.55), T0 = 0.9, T1 = 4.9, T2 = 6.0, T3 = 7.2;
  const orbit = (ph, lean, y) => { const cs = Math.cos(ph), sn = Math.sin(ph); _u.set(-cs * lean, 1, -sn * lean).normalize(); _f.set(-sn * dir, 0, cs * dir); basisQ(_qa, _f.x, _f.y, _f.z, _u.x, _u.y, _u.z); r.turn(_qa);
    r.hipsAt(R * cs, y, R * sn); _r.crossVectors(_f, _u); return _r.x * -cs + _r.z * -sn > 0 ? 'R' : 'L'; };
  if (s < T0) { r.ph('pole0'); const k = ease(s / T0), cs = Math.cos(ph0), sn = Math.sin(ph0), x = lerp(sp[0], R * 1.15 * cs, k), z = lerp(sp[1], R * 1.15 * sn, k);
    r.stand(x, z, face(-sn * dir - cs * 0.5, cs * dir - sn * 0.5)); const st = Math.sin(k * Math.PI * 2); r.hipP.y = r.H - 0.04 - 0.05 * Math.abs(st);
    r.foot('L', r.P0.foot_L.x + 0.16 * st, r.P0.foot_L.y + 0.06 * Math.max(0, st), -0.13, false, 1); r.foot('R', r.P0.foot_R.x - 0.16 * st, r.P0.foot_R.y + 0.06 * Math.max(0, -st), 0.13, false, 1);
    if (k > 0.45) { r.hand('L', 0, r.sh + 0.2, 0, true); r.hand('R', 0, r.sh - 0.18, 0, true); r.grip.L = r.grip.R = smooth(0.6, 0.95, k); } r.look(-x, 0.2, -z, 0.6); return; }
  if (s < T1) { r.ph('pole1', 0.3); const u = (s - T0) / (T1 - T0), ph = ph0 + dir * TAU * 2.5 * (0.2 * ease(u) + 0.8 * u), lift = smooth(0, 0.1, u) * (1 - smooth(0.92, 1, u));
    const ins = orbit(ph, 0.12 + 0.5 * lift, r.H - 0.06 + 0.13 * lift + 0.03 * Math.sin(u * TAU * 2.5)), out = ins === 'L' ? 'R' : 'L', zi = zs(ins), sc = Math.sin(u * TAU * 2.5 + 1) * 0.12;
    r.hand(ins, -0.045 * Math.cos(ph), r.sh + 0.3, -0.045 * Math.sin(ph), true, -0.3, -0.7, zi * 0.3); r.hand(out, 0.04 * Math.sin(ph), r.sh - 0.1, -0.04 * Math.cos(ph), true, -0.3, -0.6, -zi * 0.7); r.grip.L = r.grip.R = 1;
    r.legs(ins, 0.74 + sc, -0.6, zi * 0.28, -0.3 - sc, -0.94, zi * 0.08); r.legs(out, -0.38 - sc, -0.84, -zi * 0.42, -0.82, -0.5 + sc, -zi * 0.22);
    ry(r.chestQ, zi * -0.25); rz(_qb, 0.12); r.chestQ.multiply(_qb); ry(_qb, zi * 0.55); r.headQ.copy(r.chestQ).multiply(_qb); r.headFollow = false; return; }
  if (s < T2) { r.ph('pole2', 0.28); const u = (s - T1) / (T2 - T1), ph = ph0 + dir * TAU * (2.5 + 0.75 * (u * (2 - u))), cs = Math.cos(ph), sn = Math.sin(ph), low = Math.sin(Math.PI * Math.min(1, u * 1.15));
    r.stand(R * 1.05 * cs, R * 1.05 * sn, face(-sn * dir - cs * 0.6, cs * dir - sn * 0.6)); r.hipP.set(r.P0.hips.x - 0.12 * low, r.H - 0.5 * low, 0); plant(r, 0.2); rz(r.chestQ, -0.3 * low);
    const ins = dir > 0 ? 'L' : 'R', out = ins === 'L' ? 'R' : 'L'; r.hand(ins, 0, r.H - 0.5 * low + 0.62, 0, true); r.grip[ins] = 1; r.arms(out, -0.2, 0.25, zs(out), -0.1, 0.5, zs(out)); r.look(-c.sb * 0.3, 0.3, -c.far, 0.7); return; }
  { r.ph('pole3', 0.3); const u = (s - T2) / (T3 - T2), k = ease(u * 1.3), ph = ph0 + dir * TAU * 3.25, x = lerp(R * 1.05 * Math.cos(ph), sp[0], k), z = lerp(R * 1.05 * Math.sin(ph), sp[1], k), up = 1 - smooth(0.6, 1, u);
    r.stand(x, z, sp[2]); r.hipP.y = r.H - 0.03; plant(r, 0.22); rz(r.chestQ, 0.12 * up);
    r.arms('L', 0, 0.3 * up - 1 + up, -1 * up - 0.14, 0.1, 0.75 * up - 1 + up, -0.7 * up - 0.06); r.arms('R', 0, 0.3 * up - 1 + up, 1 * up + 0.14, 0.1, 0.75 * up - 1 + up, 0.7 * up + 0.06); r.look(0, 0.1, -c.far, 0.5); }
}

// THE BAR (7.2 s): both hands on the overhead bar, the knees up and through between the arms and hooked over it, the hands let go: he hangs by his knees,
// head down, and claps; then back the way he came. a = how far he is turned over (0 upright, pi head down).
export function barAct(r, c, s, sp, z0 = 0) {
  const sb = c.sb, bx = sb * c.GX, by = c.barY, T0 = 0.8, T1 = 1.3, T2 = 2.6, T3 = 5.4, T4 = 6.6, T5 = 7.2, k = r.k;
  const hang = (a, sway) => { const ca = Math.cos(a), sa = Math.sin(a), t = a / Math.PI;
    // the pelvis (d towards the aisle from the bar, height): under the bar on his feet -> level, pelvis on the window side, knees at the bar -> hanging below the bar
    const d0 = 0.1, y0 = r.H - 0.01, d1 = -0.2 * k, y1 = by - 0.4 * k, d2 = 0.05 + sway, y2 = by - 0.455 * k, w = t < 0.5 ? ease(t * 2) : 1, w2 = t < 0.5 ? 0 : ease(t * 2 - 1);
    const d = lerp(lerp(d0, d1, w), d2, w2), y = lerp(lerp(y0, y1, w), y2, w2);
    basisQ(_qa, sb * ca, sa, 0, -sb * sa, ca, 0); r.turn(_qa); r.hipP.copy(r.P0.hips); r.hipsAt(bx - sb * d, y, z0);
    for (const sd of ['L', 'R']) { const zz = z0 + sb * zs(sd) * 0.13;
      // the thigh: down -> knee up to the chest -> towards the bar; the shin: down -> folded -> over the bar and down the window side
      _h.copy(r.P0['thigh_' + sd]).applyQuaternion(r.root.q).add(r.root.p); _t.set(bx + sb * 0.03 - _h.x, by + 0.05 - _h.y, zz - _h.z).normalize();
      const wA = smooth(0.04, 0.3, t), wB = smooth(0.3, 0.5, t); _p.set(0, -1, 0).lerp(_f.set(sb * 0.86, 0.5, 0), wA).lerp(_t, wB).normalize();
      const sA = smooth(0.03, 0.25, t), sB = smooth(0.33, 0.52, t), sC = smooth(0.5, 1, t); _f.set(0, -1, 0).lerp(_u.set(-sb * 0.3, -0.95, 0), sA).lerp(_u.set(sb * 0.9, -0.42, 0), sB).lerp(_u.set(sb * 0.5, -0.86, 0), sC).normalize();
      r.legs(sd, _p.x, _p.y, _p.z, _f.x, _f.y, _f.z, true, t < 0.03 ? 1 : 0); }
    return t; };
  const grab = () => { r.hand('L', bx, by - 0.035, z0 - sb * 0.21, true, 0.3, -0.5, -0.8); r.hand('R', bx, by - 0.035, z0 + sb * 0.21, true, 0.3, -0.5, 0.8); r.grip.L = r.grip.R = 1; };
  if (s < T0) { r.ph('bar0'); const u = ease(s / T0), x = lerp(sp[0], bx - sb * 0.1, u), z = lerp(sp[1], z0, u), st = Math.sin(u * Math.PI * 2);
    r.stand(x, z, face(sb, 0)); r.hipP.y = r.H - 0.04 - 0.04 * Math.abs(st);
    r.foot('L', r.P0.foot_L.x + 0.15 * st, r.P0.foot_L.y + 0.05 * Math.max(0, st), -0.13); r.foot('R', r.P0.foot_R.x - 0.15 * st, r.P0.foot_R.y + 0.05 * Math.max(0, -st), 0.13);
    if (u > 0.5) { const g = smooth(0.5, 1, u); r.arms('L', 0.25 * g, 1 * g - (1 - g), -0.2, 0.3 * g, 1, -0.05); r.arms('R', 0.25 * g, 1 * g - (1 - g), 0.2, 0.3 * g, 1, 0.05); } return; }
  if (s < T1) { r.ph('bar1', 0.18); const u = (s - T0) / (T1 - T0); hang(0, 0); r.hipP.y = r.H - 0.01 - 0.1 * Math.sin(Math.PI * u) * (1 - u); r.hipsAt(bx - sb * 0.1, r.hipP.y, z0); plant(r, 0.13); grab(); r.look(sb, 0.5, 0, 0.5); return; }
  if (s < T2) { r.ph('bar2', 0.15); const u = (s - T1) / (T2 - T1), a = Math.PI * (0.15 * u + 0.85 * ease(u)); const t = hang(a, 0);
    if (t < 0.56) grab(); else { const g = smooth(0.56, 0.9, t); r.arms('L', 0.1, -1, -sb * (0.15 + 0.5 * g), 0.1, -1, -sb * (0.1 + 0.7 * g), true); r.arms('R', 0.1, -1, sb * (0.15 + 0.5 * g), 0.1, -1, sb * (0.1 + 0.7 * g), true); }
    rz(r.chestQ, -0.5 * Math.sin(Math.PI * Math.min(1, t * 1.6))); return; }
  if (s < T3) { r.ph('bar3', 0.2); const u = s - T2, sway = 0.07 * Math.sin(u * TAU / 1.2); hang(Math.PI, sway);
    // head down: a clap on every backbeat with the arms let fall towards the floor, flung wide between the claps
    const b = c.beat, q = (((b % 2) + 2) % 2) / 2, ap = 0.03 + 0.5 * Math.pow(Math.abs(Math.cos(Math.PI * q)), 0.6);
    r.hand('L', 0.2, r.sh + 0.42 - ap * 0.35, -ap, false, -0.3, 0.3, -0.9); r.hand('R', 0.2, r.sh + 0.42 - ap * 0.35, ap, false, -0.3, 0.3, 0.9);
    rz(r.chestQ, 0.1); r.look(-sb * 0.5, 0.1, -c.far, 0.8); return; }
  if (s < T4) { r.ph('bar4', 0.2); const u = (s - T3) / (T4 - T3), a = Math.PI * (1 - (0.15 * u + 0.85 * ease(u))); const t = hang(a, 0); if (t < 0.6) grab(); else { r.hand('L', bx, by - 0.035, z0 - sb * 0.21, true, 0.3, 0.5, -0.8); r.hand('R', bx, by - 0.035, z0 + sb * 0.21, true, 0.3, 0.5, 0.8); }
    rz(r.chestQ, -0.5 * Math.sin(Math.PI * Math.min(1, t * 1.6))); return; }
  { r.ph('bar5', 0.25); const u = ease((s - T4) / (T5 - T4)); r.stand(lerp(bx - sb * 0.1, sp[0], u), lerp(z0, sp[1], u), lerp(face(sb, 0), sp[2], u)); r.hipP.y = r.H - 0.03 - 0.12 * (1 - u); plant(r, 0.16);
    r.arms('L', 0.3, 0.2 - u, -0.9, 0.5, 0.5 - u, -0.6); r.arms('R', 0.3, 0.2 - u, 0.9, 0.5, 0.5 - u, 0.6); r.look(0, 0.1, -c.far, 0.5); }
}

// THE HAT AND THE FLOOR (7.2 s): the cap comes off, is flicked up from knee height, turns over twice and lands on his head; then down: a low spin on one leg with the other
// swept round, over onto his back and round with the legs in the air, up into a b-boy stand. hat = { mode: 'head' | 'hand' | 'air', u: 0..1 of the flight } is filled for showtime.js.
export function floorAct(r, c, s, sp, hat) {
  const fx = sp[0], fz = sp[1], th = face(0, -c.far), T0 = 0.5, T1 = 1.05, T2 = 1.95, T3 = 2.6, T4 = 4.8, T5 = 6.4, T6 = 7.2;
  hat.mode = 'head';
  if (s < T3) { const cr = s < T1 ? smooth(0.2, T1, s) : 1 - smooth(T1, T2 - 0.2, s); r.ph('hat'); r.stand(fx, fz, th); r.hipP.set(r.P0.hips.x - 0.1 * cr, r.H - 0.03 - 0.34 * cr, 0); plant(r, 0.2); rz(r.chestQ, -0.32 * cr);
    if (s < T0) { const u = ease(s / T0); r.hand('R', lerp(0.25, 0.1, u), lerp(r.sh - 0.3, r.sh + 0.3, u), lerp(0.25, 0.13, u), false, 0, -0.3, 1); r.grip.R = u; }
    else if (s < T1) { const u = ease((s - T0) / (T1 - T0)); r.hand('R', lerp(0.1, 0.36, u), lerp(r.sh + 0.3, r.H - 0.42, u), lerp(0.13, 0.3, u), false, 0, -0.3, 1); r.grip.R = 1; hat.mode = 'hand'; }
    else if (s < T2) { const u = (s - T1) / (T2 - T1), fl = smooth(0, 0.22, u); r.hand('R', lerp(0.36, 0.42, fl), lerp(r.H - 0.42, r.sh - 0.05, fl), 0.3, false, 0, -0.3, 1); hat.mode = 'air'; hat.u = u; r.look(0, 0.9 - u, -c.far, 0.6); }
    else { const u = ease((s - T2) / 0.3); r.arms('L', 0.3, -0.1 * u, -0.95, 0.75, 0.25, -0.6); r.arms('R', 0.3, -0.1 * u, 0.95, 0.75, 0.25, 0.6); rz(r.chestQ, 0.14 * u); r.look(0, 0.15, -c.far, 0.5); }
    if (s < T2) r.arms('L', 0.05, -0.8, -0.6, 0.4, -0.4, -0.5); return; }
  if (s < T4) { r.ph('grind', 0.3); const u = (s - T3) / (T4 - T3), psi = th + TAU * 2.25 * (0.15 * ease(u) + 0.85 * u); r.stand(fx, fz, psi);
    // down on the left leg, the hands on the floor in front, the right leg straight out and swept round with the whole body
    r.hipP.set(-0.1, 0.33 * r.k, 0.02); rz(r.chestQ, -0.62); r.foot('L', 0.1, r.P0.foot_L.y + 0.03, -0.14, false, 0.5, 1, 0.2, -0.5);
    const lift = 0.05 * Math.sin(u * TAU * 4.5); r.legs('R', 0.74, -0.2 + lift, 0.64, 0.78, -0.16 + lift, 0.6);
    r.hand('L', 0.34, 0.05, -0.3, false, -0.2, 0.2, -1); r.hand('R', 0.18, 0.05, 0.02, false, -0.6, 0.3, 0.6); rz(_qb, 0.5); r.headQ.copy(r.chestQ).multiply(_qb); r.headFollow = false; return; }
  if (s < T5) { r.ph('back', 0.3); const u = (s - T4) / (T5 - T4), psi = th + TAU * (2.25 + 3.2 * (u * (2 - u))); ry(_qa, psi); rz(_qb, 1.78); _qa.multiply(_qb); r.turn(_qa);
    // on his back, knees drawn up and the legs in a V in the air, turning fast and slowing
    r.hipP.copy(r.P0.hips); r.hipsAt(fx, 0.2 * r.k, fz); const kick = 0.12 * Math.sin(u * TAU * 3);
    r.legs('L', 0.8, 0.5, -0.42, 0.55 + kick, 0.8, -0.35); r.legs('R', 0.8, 0.5, 0.42, 0.55 - kick, 0.8, 0.35);
    r.arms('L', 0.35, 0.1, -0.95, 0.75, 0.3, -0.55); r.arms('R', 0.35, 0.1, 0.95, 0.75, 0.3, 0.55); rz(r.chestQ, -0.3); rz(_qb, -0.75); r.headQ.copy(_qb); r.headFollow = false; return; }
  { r.ph('bboy', 0.34); const u = (s - T5) / (T6 - T5), up = smooth(0, 0.55, u); r.stand(fx, fz, th); r.hipP.set(r.P0.hips.x, r.H - 0.03 - 0.3 * (1 - up), 0); plant(r, 0.22); bboy(r, c, up); }
}
// arms crossed, leaning back, chin up
export function bboy(r, c, up = 1) { rz(r.chestQ, 0.16 * up); const y = r.sh - 0.19; r.hand('L', 0.2, y + 0.03, 0.1, false, -0.1, -0.6, -0.8); r.hand('R', 0.23, y - 0.03, -0.1, false, -0.1, -0.6, 0.8); r.grip.L = r.grip.R = 0.8; rz(_qb, 0.16); r.headQ.copy(r.chestQ).multiply(_qb); r.headFollow = false; }

// THE LAST PICTURE (3.6 s): A up on the pole, sitting on it with his legs wrapped round and leaning out on one arm; B hanging from the bar with his knees up;
// C down on one knee pointing at them. Held, then everybody down.
export function finale(r, c, s, who, sp, z0 = 0) {
  const T = 3.6, hold = smooth(0, 0.5, s) * (1 - smooth(T - 0.75, T - 0.25, s)), sb = c.sb;
  if (hold <= 0.001 && s > 1) { r.ph('fin-down', 0.3); groove(r, c, sp, 0, 0.6); return; }
  r.ph('fin-' + who, 0.36);
  if (who === 'A') { const ex = -sb, lean = 0.95, cl = Math.cos(lean), sl = Math.sin(lean), ph = sb * c.far > 0 ? 'R' : 'L', fr = ph === 'R' ? 'L' : 'R';      // leaning out across the car, away from the bar B hangs on
    basisQ(_qa, -ex * cl, sl, 0, ex * sl, cl, 0); r.turn(_qa); r.hipP.copy(r.P0.hips); r.hipsAt(ex * 0.25, 1.04 * r.k, 0);
    // he sits on the pole: a knee either side of it and the shins crossed behind; the far hand high on the pole, the near arm thrown out
    r.legs('L', 0.9, 0.28, -0.3, 0.25, -0.6, 0.75); r.legs('R', 0.9, 0.2, 0.3, 0.3, -0.62, -0.72);
    r.hand(ph, 0.03 * ex, r.sh + 0.2, 0, true, 0, -0.6, zs(ph) * 0.8); r.grip[ph] = 1; r.arms(fr, ex * 0.75, 0.5, -c.far * 0.42, ex * 0.6, 0.78, -c.far * 0.2, true); rz(r.chestQ, 0.2); r.look(ex * 0.3, 0.5, -c.far, 0.9); return; }
  if (who === 'B') { const bx = sb * c.GX; r.stand(bx - sb * 0.03, z0, face(-sb * 0.2, -c.far)); r.hipP.set(r.P0.hips.x, r.H + 0.02, 0); const zb = face(-sb * 0.2, -c.far);      // along the bar, his hands one before the other
    r.hand('L', bx, c.barY - 0.035, z0 - c.far * 0.16, true, 0.5, -0.3, -0.8); r.hand('R', bx, c.barY - 0.035, z0 + c.far * 0.12, true, 0.5, -0.3, 0.8); r.grip.L = r.grip.R = 1;
    r.legs('L', 0.82, 0.5, -0.16, -0.1, -1, -0.05); r.legs('R', 0.9, 0.3, 0.16, 0.25, -0.95, 0.05); rz(r.chestQ, -0.12); r.look(0, 0.1, -c.far, 0.5); return; }
  { r.stand(sp[0], sp[1], face(sb * 0.5, -c.far)); r.hipP.set(r.P0.hips.x - 0.05, 0.52 * r.k, 0);      // C: down on his right knee
    r.foot('L', 0.32, r.P0.foot_L.y, -0.16, false, 1, 1, 0.3, -0.2); r.legs('R', 0.12, -1, 0.1, -1, -0.12, 0.05); r.arms('R', 0.3, 0.75, 0.6, 0.35, 0.85, 0.4); r.hand('L', 0.3, 0.62 * r.k, -0.2, false, -0.2, 0.2, -1); rz(r.chestQ, 0.1); r.look(0, 0.2, -c.far, 0.6); }
}

// THE THANK-YOU (2.4 s): a bow, then standing easy
export function outro(r, c, s, sp) { r.ph('outro', 0.35); groove(r, c, sp, 0, 0.5 * (1 - smooth(0.2, 1.6, s))); const bow = Math.sin(Math.PI * clamp((s - 0.3) / 1.5, 0, 1)); rz(_qb, -0.55 * bow); r.chestQ.multiply(_qb); r.hipP.x -= 0.09 * bow; rz(r.headQ, -0.7 * bow); r.headFollow = false;
  r.arms('R', 0.3 * bow, -1, 0.2 + 0.5 * bow, 0.5 * bow, -1 + bow * 0.6, 0.1 + 0.6 * bow); }

// THE SHOW: who does what when. Times in seconds from the call-out; a bar of the beat is 2.4 s (100 beats a minute).
export const BPM = 100, BEAT = 60 / BPM;
export const ACTS = [['call', 4.8], ['pole', 7.2], ['bar', 7.2], ['floor', 7.2], ['finale', 3.6], ['outro', 2.4]];
export const TOTAL = ACTS.reduce((a, b) => a + b[1], 0);
export function actAt(t) { let t0 = 0; for (let i = 0; i < ACTS.length; i++) { if (t < t0 + ACTS[i][1] || i === ACTS.length - 1) return { i, name: ACTS[i][0], s: t - t0, len: ACTS[i][1], t0 }; t0 += ACTS[i][1]; } }
export const startOf = (name) => { let t0 = 0; for (const a of ACTS) { if (a[0] === name) return t0; t0 += a[1]; } return 0; };

// one dancer's pose at show time t (who = 'A' | 'B' | 'C'); returns the act. hat is filled while C has it off his head.
export function showPose(r, c, t, who, hat) {
  const a = actAt(t), S = spots(c), sp = S[who], zB = c.far * 0.28; r.reset(); c.beat = t / BEAT;
  if (a.name === 'call') { if (who === 'A') callout(r, c, a.s, sp); else groove(r, c, sp, a.s > 2.4 ? 1 : 0, a.s > 2.4 ? 1 : 0.5); }
  else if (a.name === 'pole') { if (who === 'A') poleAct(r, c, a.s, sp); else { r.ph('g'); groove(r, c, sp); } }
  else if (a.name === 'bar') { if (who === 'B') barAct(r, c, a.s, sp, zB); else { r.ph('g'); groove(r, c, sp); } }
  else if (a.name === 'floor') { if (who === 'C') floorAct(r, c, a.s, [S.floor[0], S.floor[1], sp[2]], hat); else { r.ph('g'); groove(r, c, sp); } }
  else if (a.name === 'finale') finale(r, c, a.s, who, who === 'C' ? [S.floor[0], S.floor[1], sp[2]] : sp, zB);
  else outro(r, c, a.s, who === 'C' ? [S.floor[0], S.floor[1], sp[2]] : sp);
  r.solve(); return a;
}

// THE CAP (stage space): on his head; in his right hand; or in the air between where the hand let go of it and his head, turning over twice.
// st keeps where it was let go. The cap's own shape has its origin in the middle of its rim, the peak towards +x.
const _hp = V(), _hq = Q(), HAT_UP = 0.105;
export function hatPlace(r, hat, p, q, st, ceil = 2.1) {
  r.delta('head', _hq); r.at('head', _hp, 0.012, HAT_UP * r.k, 0);
  if (hat.mode === 'head') { p.copy(_hp); q.copy(_hq); st.air = false; return; }
  if (hat.mode === 'hand') { _t.subVectors(r.P0.hand_R, r.P0.forearm_R).normalize().multiplyScalar(0.11); r.at('hand_R', p, _t.x, _t.y, _t.z); r.delta('hand_R', q); st.air = false; st.p0 = (st.p0 || V()).copy(p); st.q0 = (st.q0 || Q()).copy(q); return; }
  if (!st.p0) { st.p0 = _hp.clone(); st.q0 = _hq.clone(); } const u = clamp(hat.u, 0, 1), k = u * u * (3 - 2 * u) * 0.3 + u * 0.7;
  p.lerpVectors(st.p0, _hp, k); p.y = Math.min(ceil - 0.14, p.y + 1.5 * u * (1 - u)); q.copy(st.q0).slerp(_hq, k); _qb.setFromAxisAngle(Z, -TAU * 2 * u); q.multiply(_qb); st.air = true;
}
