// entry/rig.js: a whole-body puppet over whatever clip is playing, for getting in and out of cars. It needs bone names only
// (<name>_hips, _spine, _chest, _chest2, _neck, _head, _upper_arm/_forearm/_hand/_thigh/_shin/_foot _L/_R, finger bones): every
// rotation is worked out in world space from where the joints are. The arm and hand parts follow the gameplay lane's combat/rig.js
// (AimRig); added here: the hips put at a world point, the trunk tilted, two-bone legs to ankle targets, feet laid flat, the head turned.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const FINGERS = ['index', 'middle', 'ring', 'pinky'], UP = new THREE.Vector3(0, 1, 0);

function worldRotate(bone, q) { bone.parent.getWorldQuaternion(_q2); bone.getWorldQuaternion(_q3); bone.quaternion.copy(_q2.invert()).multiply(q).multiply(_q3); bone.updateMatrixWorld(true); }
function setWorldQuat(bone, q, w = 1) { bone.parent.getWorldQuaternion(_q2); _q3.copy(_q2.invert()).multiply(q); if (w >= 1) bone.quaternion.copy(_q3); else bone.quaternion.slerp(_q3, w); bone.updateMatrixWorld(true); }
const basisQuat = (f, a, n, out) => out.setFromRotationMatrix(_m.makeBasis(f, a, n));

export class EntryRig {
  constructor(vis, name) {
    this.root = vis.object; this.ok = false; const B = (this.B = {}), get = (k) => this.root.getObjectByName(name + '_' + k);
    for (const k of ['hips', 'spine', 'chest', 'chest2', 'neck', 'head']) B[k] = get(k);
    for (const s of ['L', 'R']) for (const k of ['clavicle', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe']) B[k + '_' + s] = get(k + '_' + s);
    for (const k of ['hips', 'spine', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']) if (!B[k]) return;
    let skel = null; this.root.traverse((o) => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; }); if (!skel) return;
    // measured in the bind pose (standing, feet flat, facing the root's +X): hand frames, foot and head attitudes, sizes
    const saved = skel.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    const rp = this.root.position.clone(), rq = this.root.quaternion.clone(); this.root.position.set(0, 0, 0); this.root.quaternion.identity();
    skel.pose(); this.root.updateMatrixWorld(true);
    const W = (k) => B[k].getWorldPosition(new THREE.Vector3()), WQ = (k) => B[k].getWorldQuaternion(new THREE.Quaternion());
    this.hand = {}; this.fing = { L: [], R: [] };
    for (const s of ['L', 'R']) {
      const h = B['hand_' + s], mid = get('middle_01_' + s), idx = get('index_01_' + s), pnk = get('pinky_01_' + s); if (!mid || !idx || !pnk) { this.hand[s] = null; continue; }
      const P = W('hand_' + s), f = mid.getWorldPosition(new THREE.Vector3()).sub(P).normalize(), a0 = idx.getWorldPosition(new THREE.Vector3()).sub(pnk.getWorldPosition(new THREE.Vector3())).normalize();
      const n = new THREE.Vector3().crossVectors(f, a0).normalize(), a = new THREE.Vector3().crossVectors(n, f).normalize();
      const qb = basisQuat(f, a, n, new THREE.Quaternion()), hw = h.getWorldQuaternion(new THREE.Quaternion());
      this.hand[s] = { inv: hw.clone().invert().multiply(qb).invert(), len: mid.getWorldPosition(new THREE.Vector3()).distanceTo(P) };
      for (const fn of [...FINGERS, 'thumb']) for (const j of ['01', '02', '03']) {
        const b = get(fn + '_' + j + '_' + s); if (!b) continue; const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        const ax = fn === 'thumb' ? f.clone() : a.clone();
        this.fing[s].push({ b, rest: b.quaternion.clone(), axis: ax.applyQuaternion(pq).normalize(), thumb: fn === 'thumb', j: +j, curled: false });
      }
    }
    this.headRel = WQ('head'); this.footRel = { L: WQ('foot_L'), R: WQ('foot_R') }; this.hipsRel = WQ('hips');
    this.ankleH = (W('foot_L').y + W('foot_R').y) / 2; this.standH = W('hips').y; this.hipW = W('thigh_L').distanceTo(W('thigh_R')) / 2;
    this.thigh = W('shin_L').distanceTo(W('thigh_L')); this.shin = W('foot_L').distanceTo(W('shin_L')); this.armLen = W('forearm_L').distanceTo(W('upper_arm_L')) + W('hand_L').distanceTo(W('forearm_L'));
    this.headUp = W('head').y - W('hips').y; this.shoulderUp = W('upper_arm_L').y - W('hips').y; this.footFwd = B.toe_L ? W('toe_L').x - W('foot_L').x : 0.13;
    this.hipsRest = saved[skel.bones.indexOf(B.hips)][0].clone();
    skel.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
    this.root.position.copy(rp); this.root.quaternion.copy(rq); this.root.updateMatrixWorld(true);
    this.ok = !!(this.hand.L && this.hand.R);
  }
  pos(k, out) { return this.B[k].getWorldPosition(out); }
  // the hips at a world point (w blends from where the clip has them); restHips() gives the clip its own place back
  hips(p, w = 1) { const h = this.B.hips; h.getWorldPosition(_a).lerp(p, w); h.parent.worldToLocal(_a); h.position.copy(_a); h.updateMatrixWorld(true); this._hipsMoved = true; }
  restHips() { if (this._hipsMoved) { this.B.hips.position.copy(this.hipsRest); this._hipsMoved = false; } }
  // turn the pelvis (and so the whole body) by a world rotation
  tilt(q) { worldRotate(this.B.hips, q); }
  // bend the trunk: a world rotation spread over the three spine bones
  bend(axis, ang) { if (!ang) return; const B = this.B, list = [B.spine, B.chest, B.chest2].filter(Boolean); for (const b of list) worldRotate(b, _q.setFromAxisAngle(axis, ang / list.length)); }
  // head: face a world direction (up stays up); w blends from the clip
  look(dir, w = 1) { const h = this.B.head; if (w <= 0) return; _a.copy(dir).normalize(); _c.crossVectors(_a, UP); if (_c.lengthSq() < 1e-6) return; _c.normalize(); _b.crossVectors(_c, _a); basisQuat(_a, _b, _c, _q4).multiply(this.headRel); h.getWorldQuaternion(_q); _q.slerp(_q4, w); const q = _q4.copy(_q); setWorldQuat(h, q); }
  // two-bone chain (upper, lower, end) to put the end joint at `target`, the middle joint leaning toward `pole`
  _ik(U, F, H, target, pole, w, reach = 1) {
    const S = U.getWorldPosition(_a), E = F.getWorldPosition(_b), Wp = H.getWorldPosition(_c);
    const l1 = E.distanceTo(S), l2 = Wp.distanceTo(E), T = _d.copy(Wp).lerp(target, Math.min(1, w));
    const dir = _e.subVectors(T, S); let d = dir.length(); if (d < 1e-4) return; dir.multiplyScalar(1 / d); d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), (l1 + l2) * reach - 0.004);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pp = _f.copy(pole).addScaledVector(dir, -pole.dot(dir)); if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0); pp.normalize();
    const E2 = _g.copy(S).addScaledVector(dir, a).addScaledVector(pp, h), T2x = S.x + dir.x * d, T2y = S.y + dir.y * d, T2z = S.z + dir.z * d;
    _q.setFromUnitVectors(E.sub(S).normalize(), _d.subVectors(E2, S).normalize()); worldRotate(U, _q);
    F.getWorldPosition(_b); H.getWorldPosition(_c); _q.setFromUnitVectors(_c.sub(_b).normalize(), _d.set(T2x, T2y, T2z).sub(_b).normalize()); worldRotate(F, _q);
  }
  arm(s, target, pole, w = 1) { if (w > 0) this._ik(this.B['upper_arm_' + s], this.B['forearm_' + s], this.B['hand_' + s], target, pole, w, 0.965); }      // an arm never locks dead straight
  // a leg: the ankle at `target`, the knee toward `pole`; then the foot laid flat, toes toward `fwd` (a level world direction), tipped by `pitch` (toes up +)
  leg(s, target, pole, fwd, pitch = 0, w = 1) {
    if (w <= 0) return; const Ft = this.B['foot_' + s]; this._ik(this.B['thigh_' + s], this.B['shin_' + s], Ft, target, pole, w);
    _a.copy(fwd); _a.y = 0; if (_a.lengthSq() < 1e-6) return; _a.normalize(); _c.crossVectors(_a, UP).normalize(); _q4.setFromRotationMatrix(_m.makeBasis(_a, UP, _c)); if (pitch) _q4.premultiply(_q.setFromAxisAngle(_c, pitch));
    _q4.multiply(this.footRel[s]); Ft.getWorldQuaternion(_q); _q.slerp(_q4, w); const q = _q4.copy(_q); setWorldQuat(Ft, q);
  }
  // orient a hand: f = wrist-to-knuckles direction, n = the hand's measured normal (back of the right hand, palm of the left)
  handDir(s, f, n, w = 1) { const H = this.B['hand_' + s], hd = this.hand[s]; if (!hd || w <= 0) return; const ff = _a.copy(f).normalize(), nn = _b.copy(n).addScaledVector(ff, -n.dot(ff)).normalize(), aa = _c.crossVectors(nn, ff); basisQuat(ff, aa, nn, _q).multiply(hd.inv); const q = _q4.copy(_q); setWorldQuat(H, q, w); }
  curl(s, amt) {
    const sg = s === 'R' ? 1 : -1;
    for (const g of this.fing[s]) {
      if (amt <= 0.001) { if (g.curled) { g.b.quaternion.copy(g.rest); g.curled = false; } continue; }
      const th = g.thumb ? (g.j === 1 ? 0.25 : 0.3) : (g.j === 1 ? 0.95 : g.j === 2 ? 1.25 : 0.7);
      _q.setFromAxisAngle(g.axis, th * amt * sg * (g.thumb ? -1 : 1)); g.b.quaternion.copy(_q).multiply(g.rest); g.curled = true;
    }
  }
}
