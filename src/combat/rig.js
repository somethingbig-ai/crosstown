// combat/rig.js: procedural posing of a skinned person on top of whatever clip is playing. It only needs bone names
// (<name>_spine, _chest, _chest2, _neck, _head, _upper_arm_L/R, _forearm_L/R, _hand_L/R, finger bones), not their axes: every
// rotation is worked out in world space from where the joints are, so it fits any rig that follows the people export's naming.
//   AimRig: twist the upper body, put the hands where a weapon's grips are (two-bone IK), wrap the fingers.
//   Ragdoll: a body that has been shot: point masses on the joints with stick constraints, the skeleton follows them.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

// turn a bone by a world-space rotation, keeping its children with it
export function worldRotate(bone, q) {
  bone.parent.getWorldQuaternion(_q2); bone.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q2.invert()).multiply(q).multiply(_q3); bone.updateMatrixWorld(true);
}
function setWorldQuat(bone, q, w = 1) {
  bone.parent.getWorldQuaternion(_q2); _q3.copy(_q2.invert()).multiply(q);
  if (w >= 1) bone.quaternion.copy(_q3); else bone.quaternion.slerp(_q3, w); bone.updateMatrixWorld(true);
}
const basisQuat = (f, a, n, out) => out.setFromRotationMatrix(_m.makeBasis(f, a, n));

export class AimRig {
  constructor(vis, name) {
    this.root = vis.object; this.ok = false; const B = (this.B = {}), get = (k) => this.root.getObjectByName(name + '_' + k);
    for (const k of ['hips', 'spine', 'chest', 'chest2', 'neck', 'head']) B[k] = get(k);
    for (const s of ['L', 'R']) { for (const k of ['clavicle', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot']) B[k + '_' + s] = get(k + '_' + s); }
    this.legs = !!(B.hips && B.thigh_L && B.shin_L && B.foot_L && B.thigh_R && B.shin_R && B.foot_R);
    if (!B.spine || !B.upper_arm_R || !B.forearm_R || !B.hand_R || !B.upper_arm_L || !B.hand_L) return;
    let skel = null; this.root.traverse((o) => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; }); if (!skel) return;
    // measure in the bind pose: which way each hand's fingers, knuckle row and back point, in the hand bone's own frame
    const saved = skel.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    skel.pose(); this.root.updateMatrixWorld(true);
    this.hand = {}; this.fing = { L: [], R: [] };
    for (const s of ['L', 'R']) {
      const h = B['hand_' + s], mid = get('middle_01_' + s), idx = get('index_01_' + s), pnk = get('pinky_01_' + s); if (!mid || !idx || !pnk) { this.hand[s] = null; continue; }
      const P = h.getWorldPosition(new THREE.Vector3()), f = mid.getWorldPosition(new THREE.Vector3()).sub(P).normalize(), a0 = idx.getWorldPosition(new THREE.Vector3()).sub(pnk.getWorldPosition(new THREE.Vector3())).normalize();
      const n = new THREE.Vector3().crossVectors(f, a0).normalize(), a = new THREE.Vector3().crossVectors(n, f).normalize();
      const qb = basisQuat(f, a, n, new THREE.Quaternion()), hw = h.getWorldQuaternion(new THREE.Quaternion());
      this.hand[s] = { inv: hw.clone().invert().multiply(qb).invert(), len: mid.getWorldPosition(new THREE.Vector3()).distanceTo(P) };      // desired hand world quat = desired basis * inv
      for (const fn of [...FINGERS, 'thumb']) for (const j of ['01', '02', '03']) {
        const b = get(fn + '_' + j + '_' + s); if (!b) continue; const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        const ax = fn === 'thumb' ? f.clone() : a.clone();      // fingers fold about the knuckle row; the thumb rolls in about the hand's length
        this.fing[s].push({ b, rest: b.quaternion.clone(), axis: ax.applyQuaternion(pq).normalize(), thumb: fn === 'thumb', idx: fn === 'index', j: +j, curled: false });
      }
    }
    if (B.head) this.headRel = this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(B.head.getWorldQuaternion(new THREE.Quaternion()));
    skel.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); }); this.root.updateMatrixWorld(true);
    this.ok = !!(this.hand.L && this.hand.R);
  }
  pos(k, out) { return this.B[k].getWorldPosition(out); }
  // yaw (about world up) and pitch (about the given right axis) spread over the three spine bones
  twist(yaw, pitch, right) {
    const B = this.B, list = [B.spine, B.chest, B.chest2].filter(Boolean), n = list.length;
    for (const b of list) { _q.setFromAxisAngle(_a.set(0, 1, 0), yaw / n); if (pitch) { _q.premultiply(_q3.setFromAxisAngle(right, pitch / n)); } worldRotate(b, _q); }
  }
  // face the head `yaw` off the body's own heading and `pitch` up (about `right`), whatever the clip and the trunk are doing
  face(yaw, pitch, right, w = 1) { const h = this.B.head; if (!h || !this.headRel || w <= 0) return; this.root.getWorldQuaternion(_q).multiply(this.headRel); _q.premultiply(_q3.setFromAxisAngle(_a.set(0, 1, 0), yaw)).premultiply(_q3.setFromAxisAngle(right, pitch)); const q = new THREE.Quaternion().copy(_q); setWorldQuat(h, q, w); }
  // turn one bone (and what hangs from it) about a world axis
  nudge(k, axis, ang) { const b = this.B[k]; if (!b || !ang) return; worldRotate(b, _q.setFromAxisAngle(axis, ang)); }
  // lean the head a little (cheek to the stock) and turn it to the aim
  head(q, w) { const h = this.B.head; if (!h) return; h.getWorldQuaternion(_q); _q.slerp(q, w); setWorldQuat(h, _q); }
  // put the wrist of one arm at `target` (world), the elbow leaning toward `pole` (a world direction); w blends from the clip's pose
  arm(s, target, pole, w = 1) {
    const U = this.B['upper_arm_' + s], F = this.B['forearm_' + s], H = this.B['hand_' + s]; if (w <= 0) return;
    const S = U.getWorldPosition(_a), E = F.getWorldPosition(_b), W = H.getWorldPosition(_c);
    const l1 = E.distanceTo(S), l2 = W.distanceTo(E), T = _d.copy(W).lerp(target, Math.min(1, w));
    const dir = _e.subVectors(T, S); let d = dir.length(); if (d < 1e-4) return; dir.multiplyScalar(1 / d); d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.004);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pp = _f.copy(pole).addScaledVector(dir, -pole.dot(dir)); if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0); pp.normalize();
    const E2 = new THREE.Vector3().copy(S).addScaledVector(dir, a).addScaledVector(pp, h), T2 = new THREE.Vector3().copy(S).addScaledVector(dir, d);
    _q.setFromUnitVectors(E.sub(S).normalize(), _d.subVectors(E2, S).normalize()); worldRotate(U, _q);
    F.getWorldPosition(_b); H.getWorldPosition(_c);
    _q.setFromUnitVectors(_c.sub(_b).normalize(), _d.subVectors(T2, _b).normalize()); worldRotate(F, _q);
  }
  // a clip without a track for the hips' place leaves last frame's shift standing: take it back out before adding this frame's (else it piles up)
  stanceOff() { const h = this.B.hips; if (h && this._hipSet && h.position.distanceToSquared(this._hipSet) < 1e-12) { h.position.sub(this._hipAdd); h.updateMatrixWorld(true); } this._hipSet = null; }
  // the firing stance from the ground up: the hips sink and shift (world vector `shift`, y negative = down), each foot stays where the clip
  // had it plus its own offset (world vectors offL / offR, for a staggered stance), the knees bend toward `fwd` to make up the difference
  stanceLegs(shift, offL, offR, fwd) {
    if (!this.legs) return; const B = this.B, h = B.hips, feet = {}; this.stanceOff(); h.updateMatrixWorld(true);
    for (const s of ['L', 'R']) { const f = B['foot_' + s]; feet[s] = { p: f.getWorldPosition(new THREE.Vector3()).add(s === 'L' ? offL : offR), q: f.getWorldQuaternion(new THREE.Quaternion()) }; }
    const p0 = h.position.clone(); h.getWorldPosition(_a).add(shift); h.parent.worldToLocal(_a); h.position.copy(_a); h.updateMatrixWorld(true); this._hipSet = h.position.clone(); this._hipAdd = h.position.clone().sub(p0);
    for (const s of ['L', 'R']) { const T = B['thigh_' + s], S = B['shin_' + s], Ft = B['foot_' + s], ft = feet[s];
      const P = T.getWorldPosition(_a), K = S.getWorldPosition(_b), A = Ft.getWorldPosition(_c), l1 = K.distanceTo(P), l2 = A.distanceTo(K);
      const dir = _e.subVectors(ft.p, P); let d = dir.length(); if (d < 1e-4) continue; dir.multiplyScalar(1 / d); d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.002);
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const pp = _f.copy(fwd).addScaledVector(dir, -fwd.dot(dir)); if (pp.lengthSq() < 1e-6) pp.set(0, 0, 1); pp.normalize();
      const K2 = new THREE.Vector3().copy(P).addScaledVector(dir, a).addScaledVector(pp, hh), A2 = new THREE.Vector3().copy(P).addScaledVector(dir, d);
      _q.setFromUnitVectors(K.sub(P).normalize(), _d.subVectors(K2, P).normalize()); worldRotate(T, _q);
      S.getWorldPosition(_b); Ft.getWorldPosition(_c); _q.setFromUnitVectors(_c.sub(_b).normalize(), _d.subVectors(A2, _b).normalize()); worldRotate(S, _q);
      setWorldQuat(Ft, ft.q); }
  }
  // orient a hand: f = wrist-to-knuckles direction, n = the hand's measured normal (back of the right hand, palm of the left)
  handDir(s, f, n, w = 1) {
    const H = this.B['hand_' + s], hd = this.hand[s]; if (!hd || w <= 0) return;
    const ff = _a.copy(f).normalize(), nn = _b.copy(n).addScaledVector(ff, -n.dot(ff)).normalize(), aa = _c.crossVectors(nn, ff);
    basisQuat(ff, aa, nn, _q).multiply(hd.inv); setWorldQuat(H, _q, w);
  }
  // the hand's present frame in the world (f, a, n as measured), for hanging a thing in a hand that a clip is moving
  handFrame(s, f, n) { const H = this.B['hand_' + s], hd = this.hand[s]; H.getWorldQuaternion(_q).multiply(_q2.copy(hd.inv).invert()); f.set(1, 0, 0).applyQuaternion(_q); n.set(0, 0, 1).applyQuaternion(_q); return H.getWorldPosition(_d); }
  // fold the fingers: amt 0 (as the clip has them) .. 1 (a fist round a grip); trigger: the index finger stays straighter
  // shape: [knuckle, middle, tip] angles in rad at amt 1 in place of the fist's (a hook round a fore-end bends little at the knuckle and a lot after it)
  curl(s, amt, trigger = false, shape = null) {
    const sg = (s === 'R' ? 1 : -1) * (s === 'L' ? (this.curlL ?? 1) : 1);
    for (const g of this.fing[s]) {
      if (amt <= 0.001) { if (g.curled) { g.b.quaternion.copy(g.rest); g.curled = false; } continue; }
      let th = g.thumb ? (g.j === 1 ? 0.25 : 0.3) : shape ? shape[g.j - 1] : (g.j === 1 ? 0.95 : g.j === 2 ? 1.25 : 0.7); if (g.idx && trigger) th *= g.j === 1 ? 0.45 : 0.6;
      _q.setFromAxisAngle(g.axis, th * amt * sg * (g.thumb ? -1 : 1)); g.b.quaternion.copy(_q).multiply(g.rest); g.curled = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- ragdoll
// Twelve point masses: head, neck, hips, two each of shoulder, elbow, hand, hip, knee, foot. Verlet steps, stick constraints, the
// ground, a little joint stiffness so it folds like a body and not like a string. The skeleton is laid onto the points each frame.
const RP = ['head', 'chest2', 'hips', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
const STICKS = [['head', 'chest2'], ['chest2', 'hips'], ['chest2', 'upper_arm_L'], ['chest2', 'upper_arm_R'], ['upper_arm_L', 'upper_arm_R'], ['upper_arm_L', 'forearm_L'], ['forearm_L', 'hand_L'], ['upper_arm_R', 'forearm_R'], ['forearm_R', 'hand_R'],
  ['hips', 'thigh_L'], ['hips', 'thigh_R'], ['thigh_L', 'thigh_R'], ['thigh_L', 'shin_L'], ['shin_L', 'foot_L'], ['thigh_R', 'shin_R'], ['shin_R', 'foot_R'],
  ['upper_arm_L', 'thigh_L'], ['upper_arm_R', 'thigh_R'], ['upper_arm_L', 'thigh_R'], ['upper_arm_R', 'thigh_L'], ['head', 'upper_arm_L'], ['head', 'upper_arm_R'], ['head', 'hips']];
// soft limits: pairs that may not come closer than a share of their rest distance (keeps knees and elbows from folding flat, legs apart)
const KEEP = [['hips', 'foot_L', 0.45], ['hips', 'foot_R', 0.45], ['upper_arm_L', 'hand_L', 0.4], ['upper_arm_R', 'hand_R', 0.4], ['foot_L', 'foot_R', 0.5], ['shin_L', 'shin_R', 0.6], ['head', 'hips', 0.9], ['hand_L', 'hips', 0.35], ['hand_R', 'hips', 0.35]];
const RAD = { head: 0.11, chest2: 0.13, hips: 0.12, upper_arm_L: 0.06, upper_arm_R: 0.06, forearm_L: 0.05, forearm_R: 0.05, hand_L: 0.04, hand_R: 0.04, thigh_L: 0.09, thigh_R: 0.09, shin_L: 0.06, shin_R: 0.06, foot_L: 0.05, foot_R: 0.05 };
const MASS = { head: 5, chest2: 22, hips: 16, upper_arm_L: 3, upper_arm_R: 3, forearm_L: 2, forearm_R: 2, hand_L: 1, hand_R: 1, thigh_L: 8, thigh_R: 8, shin_L: 4, shin_R: 4, foot_L: 1.5, foot_R: 1.5 };

export class Ragdoll {
  // vis: the person (object + bones named <name>_*). ground(x, z) -> height. The pose at this moment is where it starts.
  constructor(vis, name, ground) {
    this.root = vis.object; this.ground = ground; this.ok = false; this.t = 0; this.still = 0; this.asleep = false;
    const get = (k) => this.root.getObjectByName(name + '_' + k); this.root.updateMatrixWorld(true);
    this.b = {}; this.p = {}; for (const k of RP) { const b = get(k); if (!b) return; this.b[k] = b; const w = b.getWorldPosition(new THREE.Vector3()); this.p[k] = { x: w.x, y: w.y, z: w.z, px: w.x, py: w.y, pz: w.z, r: RAD[k], im: 1 / MASS[k] }; }
    for (const k of ['spine', 'chest', 'neck', 'toe_L', 'toe_R']) this.b[k] = get(k);
    const dist = (a, b) => Math.hypot(this.p[a].x - this.p[b].x, this.p[a].y - this.p[b].y, this.p[a].z - this.p[b].z);
    this.sticks = STICKS.map(([a, b]) => ({ a: this.p[a], b: this.p[b], d: dist(a, b), hard: !/^(upper_arm_[LR]|head)$/.test(a) || !/thigh|hips/.test(b) }));
    // the cross-body sticks hold the trunk together; taken from a standing pose so the trunk keeps its shape whatever the clip was doing
    this.keep = KEEP.map(([a, b, f]) => ({ a: this.p[a], b: this.p[b], d: dist(a, b) * f }));
    this.ok = true;
  }
  // give every point the body's velocity (m/s), then add a blow at the point nearest `at` (world), along dir
  kick(vel, at, dir, power, dt = 1 / 60) {
    let best = null, bd = 1e9;
    for (const k of RP) { const p = this.p[k]; p.px = p.x - vel.x * dt; p.py = p.y - vel.y * dt; p.pz = p.z - vel.z * dt; if (at) { const d = Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z); if (d < bd) { bd = d; best = p; } } }
    if (best && dir) { const J = power * dt; for (const k of RP) { const p = this.p[k], d = Math.hypot(p.x - best.x, p.y - best.y, p.z - best.z), w = Math.max(0, 1 - d / 0.7) * Math.min(1, p.im * 9); p.px -= dir.x * J * w; p.py -= dir.y * J * w; p.pz -= dir.z * J * w; } }
    // the legs give way at once: knees are knocked forward a touch so the body crumples instead of toppling like a plank
    for (const k of ['shin_L', 'shin_R']) { const p = this.p[k]; p.py += 0.012; p.px += (Math.sin(p.x * 91.7) * 0.01); }
  }
  step(dt) {
    if (!this.ok || this.asleep) return; this.t += dt; const h = dt / 2; let moved = 0;
    for (let sub = 0; sub < 2; sub++) {
      for (const k of RP) { const p = this.p[k]; let vx = (p.x - p.px) * 0.992, vy = (p.y - p.py) * 0.992, vz = (p.z - p.pz) * 0.992; p.px = p.x; p.py = p.y; p.pz = p.z; vy -= 9.8 * h * h; p.x += vx; p.y += vy; p.z += vz; }
      for (let it = 0; it < 7; it++) {
        for (const s of this.sticks) { const a = s.a, b = s.b; let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const d = Math.hypot(dx, dy, dz) || 1e-6; const k = (d - s.d) / d / (a.im + b.im) * (s.hard ? 1 : 0.5); dx *= k; dy *= k; dz *= k; a.x += dx * a.im; a.y += dy * a.im; a.z += dz * a.im; b.x -= dx * b.im; b.y -= dy * b.im; b.z -= dz * b.im; }
        for (const s of this.keep) { const a = s.a, b = s.b; let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const d = Math.hypot(dx, dy, dz) || 1e-6; if (d >= s.d) continue; const k = (d - s.d) / d / (a.im + b.im) * 0.6; dx *= k; dy *= k; dz *= k; a.x += dx * a.im; a.y += dy * a.im; a.z += dz * a.im; b.x -= dx * b.im; b.y -= dy * b.im; b.z -= dz * b.im; }
        for (const k of RP) { const p = this.p[k], gy = this.ground(p.x, p.z) + p.r; if (p.y < gy) { p.y = gy; const f = 0.55; p.px += (p.x - p.px) * f; p.pz += (p.z - p.pz) * f; if (p.py > p.y) p.py = p.y + (p.py - p.y) * 0.2; } }
      }
    }
    for (const k of RP) { const p = this.p[k]; moved = Math.max(moved, Math.abs(p.x - p.px) + Math.abs(p.y - p.py) + Math.abs(p.z - p.pz)); }
    if (moved < 0.0012) { this.still += dt; if (this.still > 0.8) this.asleep = true; } else this.still = 0;
  }
  // lay the skeleton onto the points
  apply() {
    if (!this.ok) return; const P = this.p, B = this.b, root = this.root, V = (k, o) => o.set(P[k].x, P[k].y, P[k].z);
    // the hips: position, and a frame from the spine line and the line between the hip joints
    const up = _a.set(P.chest2.x - P.hips.x, P.chest2.y - P.hips.y, P.chest2.z - P.hips.z).normalize(), side = _b.set(P.thigh_L.x - P.thigh_R.x, P.thigh_L.y - P.thigh_R.y, P.thigh_L.z - P.thigh_R.z).normalize();
    const hips = B.hips; root.updateMatrixWorld(true);
    // where the bone's own spine line and hip line are now, then two swings bring them onto the points
    const cur = hips.getWorldPosition(_c); hips.parent.worldToLocal(_d.set(P.hips.x, P.hips.y, P.hips.z)); hips.position.copy(_d); hips.updateMatrixWorld(true);
    const swing = (bone, fromChild, toVec) => { const o = bone.getWorldPosition(_c), c = fromChild.getWorldPosition(_d).sub(o); if (c.lengthSq() < 1e-8) return; _q.setFromUnitVectors(c.normalize(), _e.copy(toVec).normalize()); worldRotate(bone, _q); };
    swing(hips, B.spine || B.chest2, up);
    { const l = B.thigh_L.getWorldPosition(_c).sub(B.thigh_R.getWorldPosition(_d)).normalize(); const tgt = _e.copy(side).addScaledVector(up, -side.dot(up)).normalize(), now = _f.copy(l).addScaledVector(up, -l.dot(up)).normalize(); if (tgt.lengthSq() > 0.5 && now.lengthSq() > 0.5) { _q.setFromUnitVectors(now, tgt); worldRotate(hips, _q); } }
    const to = (a, b) => _f.set(P[b].x - P[a].x, P[b].y - P[a].y, P[b].z - P[a].z);
    if (B.spine && B.chest) { swing(B.spine, B.chest, to('hips', 'chest2')); }
    { const l = B.upper_arm_L.getWorldPosition(_c).sub(B.upper_arm_R.getWorldPosition(_d)).normalize(), tgt = to('upper_arm_R', 'upper_arm_L').normalize(); const ax = _a.set(P.chest2.x - P.hips.x, P.chest2.y - P.hips.y, P.chest2.z - P.hips.z).normalize(); const t2 = new THREE.Vector3().copy(tgt).addScaledVector(ax, -tgt.dot(ax)), n2 = new THREE.Vector3().copy(l).addScaledVector(ax, -l.dot(ax)); if (t2.lengthSq() > 0.2 && n2.lengthSq() > 0.2) { _q.setFromUnitVectors(n2.normalize(), t2.normalize()); worldRotate(B.chest || B.chest2, _q); } }
    if (B.neck) swing(B.neck, B.head, to('chest2', 'head'));
    for (const s of ['L', 'R']) {
      swing(B['upper_arm_' + s], B['forearm_' + s], to('upper_arm_' + s, 'forearm_' + s)); swing(B['forearm_' + s], B['hand_' + s], to('forearm_' + s, 'hand_' + s));
      swing(B['thigh_' + s], B['shin_' + s], to('thigh_' + s, 'shin_' + s)); swing(B['shin_' + s], B['foot_' + s], to('shin_' + s, 'foot_' + s));
    }
  }
}
