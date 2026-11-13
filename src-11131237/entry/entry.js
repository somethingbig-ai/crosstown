// entry/entry.js (gameplay lane): getting into and out of cars for real. Matt, Nov 10 20:48: "getting into cars is so fake lol".
//   F near a car: the player walks round to the driver's door, takes the handle, the door swings open on its hinge, he steps in, sits down on the
//   seat behind the wheel, pulls the other leg in, pulls the door shut and takes the wheel, while the camera eases from the on-foot view to the
//   driving view. F at a standstill: the same backwards. A car in traffic has someone at the wheel: the door is opened and they are pulled out first.
// One call at the end of Game.init:   (await import('./entry/entry.js')).addEntry(this)      ?entry=0 leaves the old behaviour.
// What it changes in the game, all from outside: game.tryEnter / exitVehicle / stepBusy / updateCamera / syncVisuals / seatOf / readInput are wrapped,
// world.render is wrapped (the one car whose door is open is drawn here, door and body apart, with the streets lane's own geometry and materials;
// the streets layer skips it for those frames). Nothing is patched in anyone's shaders.
// Data: assets/entry/doors.json + doors.bin (tools: lanes/gameplay/entry/tools/srcdoors.mjs): hinge, door, steering wheel and eye point of each car
// kind, read from the openx-assets source models the streets lane's cars are made from.
// Motion: the game's own skinned people. The clips are the people lane's (CMU mocap: Idle, walks, Drive); CMU has no take of anyone getting into
// a car, so the entry itself is posed here on top of them: hips path, feet (two-bone IK), hands on handle / door pull / wheel rim, trunk and head.
// QA (URL): escript=park|jack|loop  eat=x,y,h  eview=side|front|roof|rear|in  edist=  espeed=  edoor=0 (no door drawing)  eseat=0 (lane's seats)  edbg=1
import * as THREE from 'three';
import { clamp, lerp, wrapPi } from '../geo.js';
import { EntryRig } from './rig.js';
import * as DS from './doorsplit.js';
const { splitDoor, DoorField } = DS, splitGen = DS.splitGen || null;      // splitGen: only in the newer doorsplit.js; without it the five body-made doors are simply not cut

const ss = (u, a, b) => { u = clamp((u - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const bump = (u, a, b, c) => ss(u, a, b) * (1 - ss(u, b, c));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V3(), _v2 = V3(), _v3 = V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _one = V3(1, 1, 1), UP = V3(0, 1, 0);
const TAXI_YELLOW = 0xf2b90c;       // streets/vehicles_rules.js
const FAR_K = 1.9;
const T_IN = 3.1;
const ND_A = 0.30, ND_B = 2.95;         // no door to open: from the hand on the handle straight to seated (and back)                   // seconds (at pace 1) from taking the handle to both hands on the wheel
const OPEN = 1.0;                   // door's full swing, radians (57 degrees)

// ---------------------------------------------------------------------------------------------------------------- per car kind
// Everything in the car's own frame: x ahead, y up, z to the right, metres from the car's origin on the road.
function carParams(type, D, def, rig) {
  const d = D && D[type], P = { type, door: !!d };
  const wid = def.wid || 1.85;
  if (d) {
    P.hinge = V3(...d.hinge); P.L = d.hinge[0] - d.world[0][0]; P.xr = d.world[0][0]; P.zs = d.hinge[2];
    P.belt = d.glass ? d.glass[0][1] : 0.95; P.roofY = d.world[1][1]; P.roofZ = d.world[1][2]; P.wheelC = d.wheel ? V3(...d.wheel.c) : null;
    if (d.wheel) { const f = d.wheel.frame; P.wheelAx = V3(f[0], f[1], f[2]).normalize(); if (P.wheelAx.x > 0) P.wheelAx.negate(); P.wheelR = Math.max(0.15, (d.wheel.box[1][1] - d.wheel.box[0][1]) / 2 - 0.02); }
    P.eye = d.eye && d.eye[1] > 0.5 ? V3(...d.eye) : P.wheelC ? V3(P.wheelC.x - 0.47, P.wheelC.y + 0.30, P.wheelC.z) : null;
  }
  if (!P.hinge) { P.L = 1.15; P.zs = -wid / 2; P.xr = -0.25; P.hinge = V3(P.xr + P.L, 0.8, P.zs); P.belt = 0.95; }
  return P;
}
// where the hips go when seated, for a figure of this build (hips-to-eye measured in its Drive pose)
function seatFor(P, st, fig) {
  if (P.eye && fig) return V3(P.eye.x - fig.eyeFwd + 0.13, P.eye.y - fig.eyeUp, P.eye.z);
  return V3(st[0], st[2] + 0.22, -st[1]);
}

// ---------------------------------------------------------------------------------------------------------------- the motion
// The pose `u` seconds into getting in (the same function run backwards is getting out). All in the car's frame.
//   P car kind, S seat hips, R figure sizes (rig), gy(x, z) ground height at a point beside the car (car frame), o: { jack: 0..1 arms out to a driver }
// The motion was first laid out on a slower clock (T_RAW seconds, entryPoseRaw); the player's runs on a tighter one in which he is already stepping in
// while the door is still swinging (critic e1: 'holds with the door open and nothing moving'). warp() maps the tight clock onto the laid-out one.
const T_RAW = 3.75, WARP = [[0, 0], [0.28, 0.30], [0.5, 0.85], [0.8, 1.15], [1.55, 2.05], [1.9, 2.45], [2.3, 2.92], [2.7, 3.34], [3.1, 3.75]];
function warp(u) { if (u <= 0) return 0; for (let i = 1; i < WARP.length; i++) if (u <= WARP[i][0]) { const a = WARP[i - 1], b = WARP[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); } return T_RAW; }
function entryPose(u, P, S, R, gy, out) { const x = clamp((u - 0.26) / 0.72, 0, 1); return entryPoseRaw(warp(u), P, S, R, gy, out, u < 1.6 ? 1 - Math.pow(1 - x, 2.4) - (u > 0.86 ? 0.05 * Math.exp(-7 * (u - 0.86)) * Math.sin(13 * (u - 0.86)) : 0) : -1); }
function entryPoseRaw(u, P, S, R, gy, out, doorOpen = -1) {
  const zs = P.zs, xr = P.xr, o = out || {};
  const P0 = _p0.set(xr + 0.0, 0, zs - 0.41), Pb = _pb.set(S.x - 0.02, 0, zs - 0.33), psi0 = -Math.PI / 2 + 0.4, psi1 = 0.32;
  const tall = S.y > 0.85;
  const hyH = Math.min(P.belt - 0.07, 1.10), bendK = clamp((1.3 - hyH) / 0.42, 0.15, 1); const a1 = ss(u, 0.85, 1.35), a2 = ss(u, 1.28, 2.12), fk = clamp((u - 1.19) / 0.70, 0, 1), sit = fk < 0.72 ? 0.80 * Math.pow(fk / 0.72, 1.9) : 0.80 + 0.20 * ss(fk, 0.72, 1), give = bump(u, 0.35, 0.75, 1.3);
  const hip = (o.hip ||= V3()); hip.lerpVectors(P0, Pb, a1).lerp(_v.set(S.x, 0, S.z), a2); hip.z -= 0.24 * give; hip.x -= 0.12 * give;       // gives way as the door comes past
  const g0 = gy(hip.x, Math.min(hip.z, zs - 0.3));
  hip.y = lerp(g0 + R.standH - 0.035 * bump(u, 0.8, 1.1, 1.4) - 0.02 - 0.06 * bendK * bump(u, 0.0, 0.3, 0.9), S.y, sit) - 0.045 * bump(u, 1.82, 1.97, 2.25) + 0.02 * bump(u, 2.1, 2.3, 2.6);
  const far = P.wheelC ? clamp(P.wheelC.x - S.x - 0.49, 0, 0.2) : 0, lean = (o.lean = tall ? 0 : (0.15 - FAR_K * far) * ss(u, 2.2, 2.8)); hip.x += (0.055 + 0.45 * far) * ss(u, 2.2, 2.8) * (tall ? 0 : 1);      // settles back into the seat: reclined, not bolt upright
  o.yaw = lerp(lerp(psi0, psi1, ss(u, 0.75, 1.4)), 0, ss(u, 1.55, 2.7));
  o.pitch = 0.46 * bendK * bump(u, 0.0, 0.3, 0.85) + 0.72 * bump(u, 1.15, 1.7, 2.3) + 0.18 * bump(u, 2.5, 2.95, 3.4) + 0.03 * ss(u, 2.0, 2.6);                    // lean to the handle; duck under the roof
  o.roll = -0.26 * bendK * bump(u, 0.0, 0.3, 0.8) + 0.62 * bump(u, 1.2, 1.7, 2.3) - 0.40 * bump(u, 2.35, 2.8, 3.3) - 0.035 * ss(u, 3.2, 3.6);                  // toward the cabin going in; out toward the door to pull it shut
  o.sit = sit; o.settle = ss(u, 2.0, 2.6);
  // a van's cab: up onto the step, stand in the doorway, then onto the seat
  // feet (ankles). Standing by the door: either side of the hips
  const f0 = _v.set(Math.cos(psi0), 0, -Math.sin(psi0)), l0 = _v2.set(-Math.sin(psi0), 0, -Math.cos(psi0));
  const fL = (o.fL ||= V3()), fR = (o.fR ||= V3()), floor = S.y - (S.y > 0.85 ? 0.40 : 0.24) + R.ankleH;
  const L0 = _l0.copy(P0).addScaledVector(l0, R.hipW + 0.01).addScaledVector(f0, 0.07), R0 = _r0.copy(P0).addScaledVector(l0, -R.hipW - 0.01).addScaledVector(f0, -0.08);
  L0.y = gy(L0.x, L0.z) + R.ankleH; R0.y = gy(R0.x, R0.z) + R.ankleH;
  const L1 = _l1.set(S.x + 0.17, 0, zs - 0.27); L1.y = gy(L1.x, L1.z) + R.ankleH;
  const L3 = _l3.set(S.x + 0.70, floor, S.z - 0.15), R2 = _r2.set(S.x + 0.76, floor, S.z + 0.11);
  const sL1 = ss(u, 0.88, 1.25), sL3 = ss(u, 2.0, 2.55), sR2 = ss(u, 1.15, 1.8);
  fL.lerpVectors(L0, L1, sL1).lerp(L3, sL3); fL.y += 0.07 * Math.sin(Math.PI * sL1) + 0.20 * Math.sin(Math.PI * sL3) * (1 - 0.35 * sL3);
  fR.lerpVectors(R0, R2, sR2); fR.y += 0.20 * Math.sin(Math.PI * Math.min(1, sR2 * 1.25)) * (1 - 0.5 * sR2);
  { const sb = ss(u, 0.36, 0.62) * (1 - sR2); fR.z -= 0.15 * sb; fR.x -= 0.05 * sb; fR.y += 0.05 * Math.sin(Math.PI * ss(u, 0.36, 0.62)); }      // a step back with the right foot as the door comes past
  // the knee and shin must clear the sill on the way over it: swing the foot out a touch before it comes in
  fL.z -= 0.05 * Math.sin(Math.PI * sL3) * (1 - sL3); fR.z -= 0.06 * Math.sin(Math.PI * sR2) * (1 - sR2);
  if (tall) {
    const up = ss(u, 1.45, 2.0), dn = ss(u, 2.0, 2.5), hy = S.y + 0.10; o.sit = dn; o.settle = ss(u, 2.3, 2.8);
    hip.lerpVectors(P0, Pb, a1); hip.z -= 0.15 * give; hip.x -= 0.05 * give; hip.lerp(_v.set(S.x - 0.04, 0, zs + 0.06), up).lerp(_v.set(S.x, 0, S.z), dn);
    hip.y = lerp(lerp(g0 + R.standH - 0.02 - 0.17 * bendK * bump(u, 0.0, 0.3, 0.9) - 0.06 * bump(u, 1.1, 1.45, 1.8), hy, ss(u, 1.5, 2.0)), S.y, ss(u, 2.05, 2.5));
    o.yaw = lerp(lerp(psi0, psi1, ss(u, 0.75, 1.4)), 0, ss(u, 1.9, 2.7)); o.pitch = 0.27 * bendK * bump(u, 0.0, 0.3, 0.85) + 0.34 * bump(u, 1.3, 1.9, 2.5) + 0.18 * bump(u, 2.5, 2.95, 3.4) + 0.10 * ss(u, 2.3, 2.8); o.roll = 0.12 * bump(u, 1.5, 2.0, 2.5) - 0.30 * bump(u, 2.5, 2.95, 3.4);
    const stepY = clamp(S.y - 0.80, 0.33, 0.55) + R.ankleH, St = _v.set(S.x + 0.26, stepY, zs + 0.14), sA = ss(u, 1.12, 1.55), sB = ss(u, 2.25, 2.75), sC = ss(u, 1.55, 2.2);
    R2.x = S.x + 0.50; L3.x = S.x + 0.44;
    fR.lerpVectors(R0, St, sA); fR.y += 0.16 * Math.sin(Math.PI * sA) * (1 - 0.6 * sA); fR.lerp(R2, sB); fR.y += 0.06 * Math.sin(Math.PI * sB);
    fL.lerpVectors(L0, L1, sL1).lerp(L3, sC); fL.y += 0.07 * Math.sin(Math.PI * sL1) + 0.12 * Math.sin(Math.PI * sC); fL.z -= 0.12 * Math.sin(Math.PI * sC) * (1 - sC);
    o.yawL = lerp(lerp(psi0, 0.35, sL1), 0.05, sC); o.yawR = lerp(psi0, -0.05, ss(u, 1.15, 1.6)); o.pitL = 0.3 * Math.sin(Math.PI * sC) + 0.1 * sC; o.pitR = 0.1 * sB;
  }
  else { fR.y = Math.min(fR.y, Math.max(R0.y, hip.y - 0.18)); if (sL3 > 0) fL.y = Math.min(fL.y, Math.max(L1.y, hip.y - 0.18)); }
  if (!tall) { o.yawL = lerp(lerp(psi0, 0.35, sL1), 0.05, sL3); o.yawR = lerp(psi0, -0.05, ss(u, 1.15, 1.6)); o.pitL = 0.35 * Math.sin(Math.PI * sL3) + 0.25 * sL3 - 0.5 * bump(u, 1.4, 1.85, 2.15); fL.y += 0.05 * bump(u, 1.4, 1.85, 2.15) * (1 - sL3); o.pitR = 0.3 * Math.sin(Math.PI * sR2) + 0.25 * sR2; }
  // the door: swings open quickly and coasts to its stop; pulled shut, it speeds up into the latch
  { const x = clamp((u - 0.30) / 0.8, 0, 1), y = clamp((u - 2.86) / 0.44, 0, 1); o.door = doorOpen >= 0 ? doorOpen : u < 2 ? 1 - Math.pow(1 - x, 2.4) : (1 - 0.56 * ss(u, 2.0, 2.6)) * (1 - y * y * (3 - 2 * y) * (0.55 + 0.45 * y)); }
  if (o.doorMax < 1) o.door = Math.min(o.door, o.doorMax);      // something stands in the door's way (a wall, a post, the next car): it opens as far as there is room
  // hands. Left: outside handle, then the pull inside the door, then the rim. Right: the rim as he sits.
  const th = -o.door * OPEN, cs = Math.cos(th), sn = Math.sin(th), H = P.hinge;
  const onDoor = (x, y, z, v) => { const dx = x - H.x, dz = z - H.z; return v.set(H.x + dx * cs + dz * sn, y, H.z - dx * sn + dz * cs); };
  const hy = Math.min(P.belt - 0.07, 1.10), hL = (o.hL ||= { p: V3(), f: V3(), n: V3(), w: 0, curl: 0 }), hR = (o.hR ||= { p: V3(), f: V3(), n: V3(), w: 0, curl: 0 });
  if (u < 1.7) {
    onDoor(xr + 0.14, hy, zs - 0.045, hL.p); hL.w = ss(u, 0.0, 0.30) * (1 - ss(o.door, 0.42, 0.8)); hL.curl = 0.9 * ss(u, 0.2, 0.32) * (1 - ss(o.door, 0.4, 0.6));
    hL.f.set(0.35 * cs + 0.3 * sn, 0.82, -0.35 * sn + 0.3 * cs); hL.n.set(sn, -0.2, cs);                 // fingers up behind the handle bar, palm to the door
    hL.p.addScaledVector(hL.f, -0.075);
  } else {
    const k = ss(u, 3.32, 3.72); onDoor(H.x - 0.62 * P.L, P.belt - 0.03, zs + 0.19, hL.p); wheelHand(P, S, -1, _v3, hL.f, hL.n);
    if (k > 0) { hL.p.lerp(_v3, k); } else { hL.f.set(0.95 * cs - 0.1 * sn, -0.25, -0.95 * sn - 0.1 * cs); hL.n.set(-sn * 0.3 + cs * 0.4, 0.5, -cs * 0.3 - sn * 0.4); }
    if (k > 0 && k < 1) { hL.f.lerp(_v.set(0.95, -0.25, -0.1), 1 - k); hL.n.lerp(_v.set(0.4, 0.5, -0.3), 1 - k); }
    hL.w = ss(u, 2.38, 2.76); hL.curl = 0.8 * ss(u, 2.62, 2.8);
  }
  wheelHand(P, S, 1, hR.p, hR.f, hR.n); hR.w = ss(u, 1.35, 1.85); hR.curl = 0.8 * ss(u, 1.75, 1.95);      // the right hand takes the rim early: he lowers himself on it
  if (!tall && P.roofY && u > 1.25 && u < 2.34) { hL.p.set(S.x + 0.20, P.roofY + 0.035, P.roofZ - 0.05); hL.f.set(0.15, 0.05, 1); hL.n.set(0, -1, 0.1); hL.w = ss(u, 1.28, 1.6) * (1 - ss(u, 2.06, 2.32)); hL.curl = 0.45; }      // the left hand on the roof rail over the opening while he drops in
  // eyes: the handle, then down into the cabin, then the road
  const lk = (o.look ||= V3()); const kA = ss(u, 1.0, 1.5), kB = ss(u, 2.2, 2.8);
  lk.set(P.xr + 0.3 - hip.x, hy + 0.1 - (hip.y + R.headUp), zs - hip.z).normalize().lerp(_v.set(S.x + 0.5 - hip.x, S.y + 0.1 - (hip.y + R.headUp * 0.8), S.z - hip.z).normalize(), kA).lerp(_v.set(1, -0.05, 0), kB).lerp(_v.set(0.55, -0.15, -0.85), 0.8 * bump(u, 2.3, 2.75, 3.3)).normalize();
  o.lookW = 0.75 * (1 - 0.6 * ss(u, 3.2, 3.7));
  return o;
}
const _p0 = V3(), _pb = V3(), _l0 = V3(), _r0 = V3(), _l1 = V3(), _l3 = V3(), _r2 = V3();
// a hand on the steering wheel's rim: side -1 left (about ten to), +1 right (ten past); p = wrist, f = wrist-to-knuckles, n = the rig's hand normal
function wheelHand(P, S, side, p, f, n) {
  if (!P.wheelC) { p.set(S.x + 0.42, S.y + 0.42, S.z + side * 0.17); f.set(0.6, 0.75, 0); n.set(0, 0, 1); return; }
  const ax = P.wheelAx, rt = _wr.set(0, 0, 1).addScaledVector(ax, -ax.z).normalize(), up = _wu.crossVectors(rt, ax).normalize(); if (up.y < 0) up.negate();
  const a = side < 0 ? 0.42 : -0.05; p.copy(P.wheelC).addScaledVector(rt, side * P.wheelR * Math.cos(a)).addScaledVector(up, P.wheelR * Math.sin(a));
  f.copy(up).multiplyScalar(0.72).addScaledVector(ax, -0.62).addScaledVector(rt, -side * 0.25).normalize(); n.copy(rt).addScaledVector(ax, side * 0.25);
  p.addScaledVector(f, -0.062).addScaledVector(ax, 0.028).addScaledVector(rt, side * 0.012);
}
const _wr = V3(), _wu = V3();

// ---------------------------------------------------------------------------------------------------------------- a figure on the rig
class Puppet {
  constructor(vis, name) { this.vis = vis; this.name = name; this.rig = null; try { const r = new EntryRig(vis, name); if (r.ok) this.rig = r; } catch (e) { console.log('[entry] no rig for ' + name + ': ' + (e && e.message)); } this.pose = {}; }
  // lay the pose (car frame) on the figure; CM = the car's matrix, w = how much of it (0 = the clip alone)
  apply(pose, CM, CQ, w = 1) {
    const rig = this.rig, o = this.vis.object; if (!rig) return;
    // the root: under the hips, turned with the body
    _q.setFromAxisAngle(UP, pose.yaw); o.quaternion.copy(CQ).multiply(_q); o.position.set(pose.hip.x, 0, pose.hip.z).applyMatrix4(CM); o.updateMatrixWorld(true);
    const fwd = _fw.set(1, 0, 0).applyQuaternion(o.quaternion), left = _lf.set(0, 0, -1).applyQuaternion(o.quaternion);
    rig.hips(_v.copy(pose.hip).applyMatrix4(CM), w);
    if (pose.pitch || pose.roll) { const kp = 1 - 0.8 * (pose.settle || 0); _q.setFromAxisAngle(left, pose.pitch * 0.3 * w * kp); _q2.setFromAxisAngle(fwd, pose.roll * 0.3 * w); rig.tilt(_q.multiply(_q2)); rig.bend(left, pose.pitch * 0.7 * w); rig.bend(fwd, pose.roll * 0.7 * w); }
    if (pose.lean) rig.tilt(_q.setFromAxisAngle(left, -pose.lean * w));
    const pole = _pl.copy(fwd).addScaledVector(UP, 0.55 + 0.6 * pose.sit).normalize();
    for (const s of ['L', 'R']) { const yaw = s === 'L' ? pose.yawL : pose.yawR; _v2.set(Math.cos(yaw), 0, -Math.sin(yaw)).transformDirection(CM); rig.leg(s, _v.copy(s === 'L' ? pose.fL : pose.fR).applyMatrix4(CM), _v3.copy(pole).addScaledVector(left, (s === 'L' ? 1 : -1) * (0.1 + 0.25 * pose.sit)), _v2, s === 'L' ? pose.pitL : pose.pitR, w); }
    for (const s of ['L', 'R']) { const h = s === 'L' ? pose.hL : pose.hR, hw = h.w * w; if (hw <= 0.001) { rig.curl(s, 0); continue; }
      rig.arm(s, _v.copy(h.p).applyMatrix4(CM), _v3.set(0, -1, 0).addScaledVector(left, s === 'L' ? 0.7 : -0.7).addScaledVector(fwd, -0.3), hw);
      rig.handDir(s, _v.copy(h.f).transformDirection(CM), _v2.copy(h.n).transformDirection(CM), hw); rig.curl(s, h.curl * w); }
    if (pose.lookW > 0) rig.look(_v.copy(pose.look).transformDirection(CM), pose.lookW * w);
  }
  release() { if (this.rig) { this.rig.restHips(); this.rig.curl('L', 0); this.rig.curl('R', 0); } }
}
const _fw = V3(), _lf = V3(), _pl = V3();
// someone at the wheel being hauled out: the exit run fast, bent over, hands off the wheel at once
function npcOutPose(pose, u) { pose.pitch += 0.4 * bump(T_RAW - u, 0.2, 1.3, 2.4); pose.hR.w *= ss(u, 3.3, 3.7); pose.hL.w *= ss(u, 3.3, 3.7); pose.lookW = 0.3; return pose; }
// the player while he hauls (t = 0..1): steps into the opening and leans in, both hands on the driver (arm and collar), backs out pulling, lets go,
// and is back where the door-open pose had him. P car kind, S seat hips.
function playerJackPose(pose, t, npcRig, cmInv, P, S) {
  const k1 = ss(t, 0, 0.22), k2 = ss(t, 0.36, 0.72), k3 = ss(t, 0.84, 1), grab = ss(t, 0.12, 0.24) * (1 - ss(t, 0.62, 0.74));
  const bx = pose.hip.x, bz = pose.hip.z, ix = S.x - 0.16 - bx, iz = P.zs - 0.20 - bz, ox = P.xr - 0.30 - (bx + ix), oz = P.zs - 0.80 - (bz + iz);
  pose.hip.x += (ix * k1 + ox * k2) * (1 - k3); pose.hip.z += (iz * k1 + oz * k2) * (1 - k3); pose.hip.y -= 0.06 * grab;
  const fl = (ss(t, 0.0, 0.16) * (1 - ss(t, 0.8, 0.93))), fl2 = ss(t, 0.5, 0.74) * (1 - ss(t, 0.8, 0.93)), fr = ss(t, 0.07, 0.24) * (1 - ss(t, 0.87, 1)), fr2 = ss(t, 0.36, 0.6) * (1 - ss(t, 0.87, 1));
  pose.fL.x += ix * fl + ox * fl2; pose.fL.z += iz * fl + oz * fl2; pose.fR.x += ix * fr + ox * fr2; pose.fR.z += iz * fr + oz * fr2;
  pose.fL.y += 0.06 * (Math.sin(Math.PI * ss(t, 0.0, 0.16)) + Math.sin(Math.PI * ss(t, 0.5, 0.74)) + Math.sin(Math.PI * ss(t, 0.8, 0.93))); pose.fR.y += 0.06 * (Math.sin(Math.PI * ss(t, 0.07, 0.24)) + Math.sin(Math.PI * ss(t, 0.36, 0.6)) + Math.sin(Math.PI * ss(t, 0.87, 1)));
  const dy = (-Math.PI / 2 + 0.3 - pose.yaw) * k1 * (1 - k3); pose.yaw += dy; pose.yawL += dy; pose.yawR += dy;
  pose.pitch += 0.85 * ss(t, 0.05, 0.22) * (1 - ss(t, 0.36, 0.66)) + 0.12 * grab; pose.hip.y -= 0.10 * ss(t, 0.05, 0.22) * (1 - ss(t, 0.36, 0.66));
  if (grab > 0.01 && npcRig) {
    npcRig.pos('upper_arm_L', _v).applyMatrix4(cmInv); _v.y -= 0.12; pose.hL.p.copy(_v); pose.hL.w = grab; pose.hL.curl = 0.8 * grab; pose.hL.f.set(0.3, -0.2, 0.9); pose.hL.n.set(0.9, 0, -0.3);
    npcRig.pos('chest2', _v).applyMatrix4(cmInv); _v.z -= 0.14; _v.x -= 0.05; pose.hR.p.copy(_v); pose.hR.w = grab; pose.hR.curl = 0.8 * grab; pose.hR.f.set(0.2, 0.1, 0.95); pose.hR.n.set(-0.9, 0, 0.2); }
  return pose;
}

// ---------------------------------------------------------------------------------------------------------------- the open-door car
// The streets layer draws every car as instances of one merged geometry per material group. The one car whose door is moving is taken out of
// that for the frame and drawn here as two sets of one-instance meshes over index subsets of the SAME vertex buffers and materials: body less
// door, and door (turned about the hinge). Shadows, depth and AO passes all see the real open door.
class DoorCar {
  constructor(game, D, bin) { this.g = game; this.D = D; this.bin = bin; this.kinds = {}; this.cur = null; this.angle = 0; this.off = game.P.get('edoor') === '0'; this.sink = game.P.get('vb_sink') === '0' ? 0 : 0.012; }
  sv() { return this.g.streetVehicles; }
  // build (once per kind) the split meshes
  kind(type) {
    if (type in this.kinds) return this.kinds[type];
    let K = null;
    try {
      const sv = this.sv(), T = sv && sv.types[type], L = T && T.lods[0], d = this.D[type]; if (!L || !d || (d.gen ? !splitGen : !this.bin) || this.off) return (this.kinds[type] = null);
      const t0 = performance.now(), field = d.gen ? null : new DoorField(this.bin.subarray(d.tris[0], d.tris[0] + d.tris[1]));
      const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
      K = { type, L, meta: T.meta, body: attr(1, 16), doorM: attr(1, 16), va: attr(1, 4), col: attr(1, 3), meshes: [], doorTris: 0, group: new THREE.Group() };
      const two = new Map(), both = (m) => { if (m.transparent) return m; let d = two.get(m); if (!d) { d = m.clone(); d.onBeforeCompile = m.onBeforeCompile; d.customProgramCacheKey = m.customProgramCacheKey; d.side = THREE.DoubleSide; d.shadowSide = THREE.DoubleSide; two.set(m, d); } return d; };      /* an open door is seen from behind: its skin must not be see-through from there */
      const mk = (src, geo, mat4, va, col, door) => { const g = new THREE.BufferGeometry(); for (const k in src.geometry.attributes) if (k !== 'aVar') g.setAttribute(k, src.geometry.attributes[k]); g.setAttribute('aVar', va); g.setIndex(geo); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
        const im = new THREE.InstancedMesh(g, door ? both(src.material) : src.material, 1); im.instanceMatrix = mat4; if (src.instanceColor && col) im.instanceColor = col; im.frustumCulled = false; im.castShadow = src.castShadow; im.receiveShadow = src.receiveShadow; im.renderOrder = src.renderOrder; im.matrixAutoUpdate = false; im.count = 1; K.group.add(im); return im; };
      const split = (set, va, col) => { if (!set) return; for (const src of set.meshes) { const geo = src.geometry, pos = geo.attributes.position.array, idx = geo.index ? geo.index.array : null, r = d.gen ? splitGen(pos, idx, d) : splitDoor(pos, idx, field, d.world);
        const nt = r.tri.length, A = new (pos.length / 3 > 65535 ? Uint32Array : Uint16Array)((nt - r.n) * 3), Bd = new (pos.length / 3 > 65535 ? Uint32Array : Uint16Array)(r.n * 3); let ia = 0, ib = 0;
        for (let t = 0; t < nt; t++) { const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2; if (r.tri[t]) { Bd[ib++] = a; Bd[ib++] = b; Bd[ib++] = c; } else { A[ia++] = a; A[ia++] = b; A[ia++] = c; } }
        if (A.length) mk(src, new THREE.BufferAttribute(A, 1), K.body, va, col); if (Bd.length) mk(src, new THREE.BufferAttribute(Bd, 1), K.doorM, va, col, true); K.doorTris += r.n; } };
      split(L.main, K.va, K.col);
      if (L.livery) { K.lva = attr(1, 4); K.lcol = attr(1, 3); K.nLiv0 = K.group.children.length; split(L.livery, K.lva, K.lcol); K.liv = K.group.children.slice(K.nLiv0); }
      if (L.rack) { K.rva = attr(1, 4); const n0 = K.group.children.length; split(L.rack, K.rva, null); K.rack = K.group.children.slice(n0); }
      if (L.wheels) { K.wm = attr(4, 16); K.wva = attr(4, 4); for (const src of L.wheels.meshes) { const im = mk(src, src.geometry.index, K.wm, K.wva, null); im.count = 4; } }
      if (L.tyres) { K.tm = attr(4, 16); K.tva = attr(4, 4); for (const src of L.tyres.meshes) { const im = mk(src, src.geometry.index, K.tm, K.tva, null); im.count = 4; } }
      // the dark patches on the road under the car and its tyres (the streets layer's own two meshes, found by how they blend)
      const blobs = sv.group.children.filter((c) => c.isInstancedMesh && c.material && c.material.blending === THREE.MultiplyBlending).sort((a, b) => a.renderOrder - b.renderOrder);
      if (blobs[0]) { K.blob = new THREE.InstancedMesh(blobs[0].geometry, blobs[0].material, 1); K.blob.frustumCulled = false; K.blob.renderOrder = blobs[0].renderOrder; K.blob.matrixAutoUpdate = false; K.group.add(K.blob); }
      if (blobs[1]) { K.tblob = new THREE.InstancedMesh(blobs[1].geometry, blobs[1].material, 4); K.tblob.frustumCulled = false; K.tblob.renderOrder = blobs[1].renderOrder; K.tblob.matrixAutoUpdate = false; K.group.add(K.tblob); }
      K.group.visible = false; K.group.name = 'entry_door_' + type; sv.group.add(K.group);
      if (K.doorTris < 200) { console.log('[entry] ' + type + ': no door found in the model (' + K.doorTris + ' triangles)'); sv.group.remove(K.group); K = null; }
      else console.log('[entry] door of ' + type + ': ' + K.doorTris + ' triangles, ' + Math.round(performance.now() - t0) + ' ms');
    } catch (e) { console.log('[entry] door of ' + type + ' failed: ' + (e && (e.stack || e.message))); K = null; }
    return (this.kinds[type] = K);
  }
  // this car's door stands at `angle` (radians) from now until clear()
  set(v, angle) { const K = this.kind(v.type); if (!K) { this.cur = null; return false; } if (this.cur && this.cur.K !== K) this.cur.K.group.visible = false; this.cur = { v, K }; this.angle = angle; return true; }
  clear() { if (this.cur) this.cur.K.group.visible = false; this.cur = null; }
  // the car's body matrix as the streets layer places it (ride height and sink included)
  matrix(v, out, q) { const vv = v._vv || { ride: 0 }; _e.set(v.roll || 0, v.h, v.pitch || 0, 'YZX'); q.setFromEuler(_e); return out.compose(_v.set(v.x, (v.z || 0) + (this.sv() ? (vv.ride || 0) - this.sink : 0), -v.y), q, _one); }
  // called just before the world is drawn: place our copy
  place() {
    const c = this.cur; if (!c) return; const v = c.v, K = c.K, vv = v._vv; if (!vv) { K.group.visible = false; return; }
    const M = this.matrix(v, _m, _q); M.toArray(K.body.array); K.body.needsUpdate = true;
    const H = this.D[v.type].hinge; _m2.makeTranslation(H[0], 0, H[2]).multiply(_mr.makeRotationY(-this.angle)).multiply(_mt.makeTranslation(-H[0], 0, -H[2])).premultiply(M).toArray(K.doorM.array); K.doorM.needsUpdate = true;
    const dirt = v.type === 'ox_cab' ? Math.max(vv.dirt, 0.42) : vv.dirt; K.va.array.set([dirt, vv.seed01, v.color === TAXI_YELLOW ? 1 : 0, v.braking ? 1 : 0]); K.va.needsUpdate = true;
    _c.set(v.color); K.col.array.set([_c.r, _c.g, _c.b]); K.col.needsUpdate = true;
    if (K.liv) { const on = vv.livery >= 0; for (const m of K.liv) m.visible = on; if (on) { K.lva.array.set([vv.dirt, vv.seed01, vv.livery, 0]); K.lva.needsUpdate = true; _c.set(vv.ink); K.lcol.array.set([_c.r, _c.g, _c.b]); K.lcol.needsUpdate = true; } }
    if (K.rack) { const on = !!vv.rack && v.type !== 'ox_cab'; for (const m of K.rack) m.visible = on; if (on) { K.rva.array.set([vv.dirt * 0.6, vv.seed01, 0, 0]); K.rva.needsUpdate = true; } }
    const meta = K.meta, L = K.L;
    if (K.wm && L.wpos) { _e.set(v.roll || 0, v.h, v.pitch || 0, 'YZX'); _q2.setFromEuler(_e); _m2.compose(_v.set(v.x, (v.z || 0) - this.sink, -v.y), _q2, _one);
      L.wpos.forEach((w, k) => { _e.set(0, (w.front ? v.steer : 0) + (w.flip ? Math.PI : 0), w.flip ? v.spin : -v.spin, 'YZX'); _q2.setFromEuler(_e); _mr.compose(w.pos, _q2, _one).premultiply(_m2); _mr.toArray(K.wm.array, k * 16); K.wva.array.set([Math.min(1, vv.dirt * 1.3 + 0.2), vv.seed01, meta.radius, 0], k * 4);
        if (K.tm && L.tyreScale) { _mt.makeScale(L.tyreScale.x, L.tyreScale.y, L.tyreScale.z).premultiply(_mr).toArray(K.tm.array, k * 16); K.tva.array.set([vv.dirt, vv.seed01, meta.radius, 0], k * 4); } });
      K.wm.needsUpdate = true; K.wva.needsUpdate = true; if (K.tm) { K.tm.needsUpdate = true; K.tva.needsUpdate = true; } }
    _e.set(0, v.h, 0); _q2.setFromEuler(_e);
    if (K.blob) { _mr.compose(_v.set(v.x, (v.z || 0) + 0.012, -v.y), _q2, _v2.set(meta.len * 0.5 + 0.12, 1, meta.wid * 0.5 + 0.12)); K.blob.setMatrixAt(0, _mr); K.blob.instanceMatrix.needsUpdate = true; }
    if (K.tblob && meta.ax_f) { const hw = meta.ywl || meta.wid * 0.42, r = meta.radius || 0.33; _v2.set(r * 1.05, 1, (meta.tw || 0.22) + 0.12); let k = 0;
      for (const ax of [meta.ax_f, meta.ax_r]) for (const sd of [-hw, hw]) { _v.set(ax, 0, sd).applyQuaternion(_q2); _v.x += v.x; _v.y = (v.z || 0) + 0.014; _v.z += -v.y; _mr.compose(_v, _q2, _v2); K.tblob.setMatrixAt(k++, _mr); } K.tblob.instanceMatrix.needsUpdate = true; }
    K.group.visible = true;
  }
}
const _mr = new THREE.Matrix4(), _mt = new THREE.Matrix4(), _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------------------------- the feature
class Entry {
  constructor(game) { this.g = game; this.P = {}; this.fig = {}; this.D = null; this.cars = null; this.cam = { k: 0, on: false }; this.npc = null; this.speed = +(game.P.get('espeed') || 1.75); this.stats = { enters: 0, exits: 0, jacks: 0, cancels: 0 }; this.last = null; }
  async init() {
    const g = this.g; let bin = null;
    try { const [j, b] = await Promise.all([fetch('assets/entry/doors.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)), fetch('assets/entry/doors.bin', { cache: 'no-store' }).then((r) => (r.ok ? r.arrayBuffer() : null))]); this.D = j; if (b) bin = new Int16Array(b); } catch (e) { console.log('[entry] door data not loaded: ' + (e && e.message)); }
    this.D = this.D || {}; this.cars = new DoorCar(g, this.D, bin);
    this.me = new Puppet(g.player.vis, 'player'); this.measure('player');
    this.hook();
    if (g.P.has('eat')) { const a = g.P.get('eat').split(',').map(Number), pl = g.player; pl.x = a[0]; pl.y = a[1]; if (a.length > 2) pl.h = a[2]; g.focus.x = pl.x; g.focus.y = pl.y; try { g.traffic.populate(pl.x, pl.y); } catch (e) {} g.cam.yaw = pl.h; g.snapCamera(); }
    if (g.P.has('escript')) this.script = { name: g.P.get('escript'), t: 0, i: 0, st: 'find' };
    // the door meshes of each kind are cut on first use (some tens of ms a kind): not on the F press if it can be helped.
    // perf, Nov 12: all 15 kinds used to be cut one every 0.9 s from 4 s after load, which on a slow machine was 13 hitches (up to 44 ms on an M2 Max,
    // six times that on a weak laptop) in the first seconds of play. Now a kind is cut when a car of that kind is within 45 m of the player
    // (on foot, or in a car that is not moving), nearest first, one at a time in an idle moment: the cars round the spawn are done behind the start
    // screen, a kind never met is never cut. F on a kind not yet cut still cuts it on the press, as before (DoorCar.set -> kind). ?ecut=all = the old way.
    // Measured at 4x CPU throttle (laptop 3): the old timer's cuts ran until 72.5 s and the lead's warm-up could not end before them (PLAY live at
    // 74.8 s); cut near the spawn only and back to back, PLAY went live at 62.9 s.
    if (!g.capture && typeof setTimeout === 'function' && g.streetVehicles && g.P.get('ecut') === 'all') { const kinds = Object.keys(this.D); const next = () => { const t = kinds.shift(); if (!t) return; if (!g.player.busy) this.cars.kind(t); else kinds.unshift(t); setTimeout(next, 900); }; setTimeout(next, 4000); }
    else if (!g.capture && typeof setTimeout === 'function' && g.streetVehicles) {
      const idle = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 0), K = this.cars.kinds, D = this.D, pk = [];
      const look = () => { let t = null;
        try { const pl = g.player; if (!pl.busy && !(pl.vehicle && Math.abs(pl.vehicle.vf || 0) > 3)) { let bd = 45 * 45; const sv = g.streetVehicles, see = (v) => { const ty = v && v.type; if (!ty || ty in K || !(ty in D)) return; const T = sv && sv.types && sv.types[ty]; if (!T || !T.lods || !T.lods[0]) return;      /* its model is not there yet: asked again later, not marked as a kind without a door */ const d = (v.x - pl.x) * (v.x - pl.x) + (v.y - pl.y) * (v.y - pl.y); if (d < bd) { bd = d; t = ty; } };
          for (const v of g.vehicles) see(v); for (const s of g.parked.near(pl.x, pl.y, 45, pk)) see(s); for (const c of g.traffic.cars) see(c); } } catch (e) {}
        const quiet = typeof window !== 'undefined' && (!window.__ready || window.__warming || window.__startScreen || g.paused);      // before the game runs (the shaders are compiling) and behind the start screen there is no frame to spoil: cut at once, back to back
        if (t && quiet) setTimeout(() => { try { this.cars.kind(t); } catch (e) {} setTimeout(look, 20); }, 0);
        else if (t) idle(() => { try { if (!g.player.busy) this.cars.kind(t); } catch (e) {} setTimeout(look, 250); }); else setTimeout(look, 500); };
      setTimeout(look, 0);      // the first ones go while the shaders compile, before the lead's warm-up frames start (a cut over 40 ms among them resets its count of good frames)
    }
    console.log('[entry] on: ' + Object.keys(this.D).length + ' car kinds with door data; rig ' + (this.me.rig ? 'ok' : 'none'));
    return this;
  }
  // a figure's build in the Drive pose: where its eyes are from its hips (to put the eyes on the car's eye point)
  measure(name) {
    if (this.fig[name]) return this.fig[name]; const kit = this.g.kit; let f = null;
    try { const p = kit.person && kit.person(name); if (p && p.acts.drive) { p.acts.drive.play(); p.mixer.setTime(0); p.object.updateMatrixWorld(true); const hp = p.object.getObjectByName(name + '_hips'), hd = p.object.getObjectByName(name + '_head');
      if (hp && hd) { const a = hp.getWorldPosition(V3()), b = hd.getWorldPosition(V3()), fw = V3(1, 0, 0).applyQuaternion(hd.getWorldQuaternion(new THREE.Quaternion())); f = { eyeFwd: b.x - a.x + 0.085, eyeUp: b.y - a.y + 0.105, hipsY: a.y, hipsX: a.x, headFwd: fw }; } } } catch (e) {}
    return (this.fig[name] = f);
  }
  params(v) { return this.P[v.type] || (this.P[v.type] = carParams(v.type, this.D, v.def || {}, null)); }
  seat(v, name = 'player') { const P = this.params(v), st = this.seatLane(v); return seatFor(P, st, this.g.P.get('eseat') === '0' ? null : this.measure(name)); }
  seatLane(v) { return (this.g.kit.seats && this.g.kit.seats[v.type]) || [-0.05, 0.37, 0.1]; }
  ground(v) { const g = this.g, c = Math.cos(v.h), s = Math.sin(v.h), base = (v.z || 0) + (this.cars.sv() ? ((v._vv && v._vv.ride) || 0) - this.cars.sink : 0); return (x, z) => (g.statics.onSidewalk(v.x + c * x + s * z, v.y + s * x - c * z) ? 0.15 : 0) - base; }
  // car frame (x ahead, z right) to map metres
  toMap(v, x, z, o) { const c = Math.cos(v.h), s = Math.sin(v.h); o.x = v.x + c * x + s * z; o.y = v.y + s * x - c * z; return o; }

  hook() {
    const g = this.g, E = this;
    const tryEnter0 = g.tryEnter.bind(g), exit0 = g.exitVehicle.bind(g), stepBusy0 = g.stepBusy.bind(g), cam0 = g.updateCamera.bind(g), sync0 = g.syncVisuals.bind(g), seat0 = g.seatOf.bind(g), read0 = g.readInput.bind(g);
    { const near0 = g.nearestCar.bind(g); g.nearestCar = function (d) { const b = g.player.busy; return b && b.entry ? null : near0(d); }; }      // no 'F Get in' prompt while he is getting in or out
    g.tryEnter = function () {
      if (g.player.busy) return false; const n = g.nearestCar(), driver = n && n.kind === 'traffic' ? n.c : null, vis = g.player.vis;
      const door0 = g.sound.door; g.sound.door = () => {}; let r; try { r = tryEnter0(); } finally { g.sound.door = door0; }
      const b = g.player.busy; if (!r || !b || b.kind !== 'in' || !b.v) return r;       // no animated figure (or ?noanim): the game's own instant entry stands
      E.begin(b.v, 'in', driver); return r;
    };
    g.exitVehicle = function () {
      const v = g.player.vehicle, door0 = g.sound.door; g.sound.door = () => {}; try { exit0(); } finally { g.sound.door = door0; }
      const b = g.player.busy; if (!b || b.kind !== 'out') return; E.begin(v, 'out', null);
    };
    g.stepBusy = function (dt) { const b = g.player.busy; if (b && b.entry) E.step(dt); else stepBusy0(dt); };
    g.updateCamera = function (dt) { if (E.camStep(dt)) return; return cam0(dt); };
    g.syncVisuals = function (dt) { sync0(dt); E.sync(dt); };
    g.seatOf = function (v, name) { const P = E.params(v); if (!P.eye || g.P.get('eseat') === '0') return seat0(v, name); const f = E.measure(name); if (!f) return seat0(v, name); const S = seatFor(P, null, f); return [S.x - f.hipsX, -S.z, S.y - f.hipsY]; };
    g.readInput = function () { read0(); if (E.script) E.runScript(1 / 60); };
    const world = g.world, render0 = world.render.bind(world);
    world.render = function (...a) {
      const c = E.cars.cur; if (!c) return render0(...a);
      const i = g.vehicles.indexOf(c.v); if (i < 0 || !c.v._vv) return render0(...a);
      E.cars.place(); g.vehicles.splice(i, 1); try { return render0(...a); } finally { g.vehicles.splice(i, 0, c.v); }
    };
  }

  // ------------------------------------------------------------------ state
  begin(v, kind, driver) {
    const g = this.g, pl = g.player, vis = pl.vis, P = this.params(v);
    const b = (pl.busy = { entry: true, kind, v, t: 0, dur: 99, z: 0, x: pl.x, y: pl.y, h: pl.h, phase: kind === 'in' ? 'walk' : 'act', u: kind === 'in' ? 0 : T_IN, w: kind === 'in' ? 0 : 1, moved: false, still: false, path: null, jack: null });
    this.last = v; b.nodoor = !this.cars.kind(v.type); this.me.pose.doorMax = b.doorMax = this.doorRoom(v, P);
    if (kind === 'in') {
      b.path = this.route(v, P); b.wp = 0;
      if (!driver && g.P.has('edriver')) driver = { id: +g.P.get('edriver') || 1 };      // QA: someone sits in the parked car too
      if (driver && this.g.kit.person) this.seatDriver(v, driver, b); else if (this.npc && this.npc.v === v && this.npc.state === 'seated') b.jack = { t: 0 };
    } else { this.cam.k = 1; this.cam.on = true; if (vis.acts.drive) { g.playerAnim('drive'); } }
    if (vis.mixer) vis.mixer.timeScale = 1; if (vis.acts && vis.acts.drive) vis.acts.drive.setEffectiveTimeScale(1);
    if (b.nodoor && kind === 'out') { b.u = ND_A; g.playerAnim('idle'); g.sound.door(); }      // no door to open: he is on his feet at the handle at once
  }
  // way to the spot by the door: straight if the car is not in the way, else round the nearer end
  route(v, P) {
    const g = this.g, pl = g.player, c = Math.cos(v.h), s = Math.sin(v.h), px = (pl.x - v.x) * c + (pl.y - v.y) * s, pz = (pl.x - v.x) * s - (pl.y - v.y) * c;      // player in the car's frame
    const hl = (v.def.len || 4.6) / 2 + 0.55, hw = (v.def.wid || 1.85) / 2 + 0.5, tx = P.xr + 0.0, tz = P.zs - 0.41, pts = [];
    if (pz > -hw + 0.05) {      // on the car's right, or in line with it: round the nearer end
      let ex = Math.abs(px) > hl ? Math.sign(px) * hl : (Math.abs(hl - px) + Math.abs(hl - tx) < Math.abs(-hl - px) + Math.abs(-hl - tx) ? hl : -hl);
      // a car parked close against that end leaves no room to pass: take the other end if it is clearer
      if (Math.abs(px) <= hl) { const room = (e) => { let m = 9; const q = this.toMap(v, e, 0, {}); const see = (o) => { if (o === v || o.gone) return; const d = Math.hypot(o.x - q.x, o.y - q.y) - ((o.def && o.def.len) || 4.6) / 2; if (d < m) m = d; };
          for (const o of g.parked.near(q.x, q.y, 9)) see(o); for (const o of g.vehicles) see(o); for (const o of g.traffic.cars) see(o); return m; };
        if (room(ex) < 0.25 && room(-ex) > room(ex) + 0.3) ex = -ex; }
      if (Math.abs(px) <= hl) pts.push([ex, hw]);
      pts.push([ex, -hw]);
    }
    pts.push([tx, tz]);
    return pts.map((p) => this.toMap(v, p[0], p[1], {}));
  }
  // how far this car's door can swing (0..1 of OPEN) before its edge meets a wall or a car standing beside it
  doorRoom(v, P) {
    const g = this.g, H = P.hinge, L = P.L, a = this.toMap(v, H.x - L * 0.5, P.zs - 0.12, {}), e = {}, others = [];
    const see = (o) => { if (o && o !== v && !o.gone && Math.hypot(o.x - v.x, o.y - v.y) < 12 && !(Math.abs(o.v || 0) > 0.5)) others.push(o); };
    try { for (const o of g.parked.near(v.x, v.y, 12)) see(o); for (const o of g.vehicles) see(o); for (const o of g.traffic.cars) see(o); } catch (err) {}
    let ok = 1;
    for (let k = 0.3; k <= 1.001; k += 0.1) {
      let hit = false;
      for (const f of [0.55, 1]) { const th = k * OPEN; this.toMap(v, H.x - L * f * Math.cos(th), H.z - L * f * Math.sin(th), e);
        if (g.statics.raycast(a.x, a.y, e.x, e.y) < 1) hit = true;
        for (const o of others) { const c = Math.cos(o.h), sn = Math.sin(o.h), dx = (e.x - o.x) * c + (e.y - o.y) * sn, dz = (e.x - o.x) * sn - (e.y - o.y) * c, d = o.def || {}; if (Math.abs(dx) < (d.len || 4.6) / 2 + 0.04 && Math.abs(dz) < (d.wid || 1.85) / 2 + 0.04) hit = true; } }
      if (hit) { ok = Math.max(0.3, k - 0.1); break; }
    }
    if (ok < 1) console.log('[entry] door of ' + v.type + ' has room for ' + Math.round(ok * 100) + '% of its swing');
    return ok;
  }
  seatDriver(v, c, b) {
    const g = this.g, kinds = g.drivers.map((d) => d.who), who = kinds.length ? kinds[c.id % kinds.length] : (g.kit.pedKinds && g.kit.pedKinds()[0]); if (!who) return;
    let vis = null; try { vis = g.kit.person(who); } catch (e) {} if (!vis) return;
    if (this.npc) { g.world.scene.remove(this.npc.vis.object); this.npc = null; }
    g.world.scene.add(vis.object); const pup = new Puppet(vis, who); if (!pup.rig) { g.world.scene.remove(vis.object); return; }
    if (vis.acts.drive) { vis.acts.drive.play(); vis.cur = 'drive'; }
    this.npc = { vis, pup, who, v, u: T_RAW, state: 'seated', t: 0, x: 0, y: 0, h: 0 }; b.jack = { t: 0 };
  }
  cancel() { const g = this.g, pl = g.player; pl.busy = null; this.me.release(); this.stats.cancels++; if (this.npc && this.npc.state === 'seated') { /* the driver stays in the car, which is now a loose vehicle: leave them seated */ } }

  step(dt) {
    const g = this.g, pl = g.player, b = pl.busy, v = b.v, I = g.input, vis = pl.vis, P = this.params(v); b.t += dt; dt *= this.speed;
    if (b.phase === 'walk') {
      const moving = Math.hypot(I.mx, I.my) > 0.3; if (!moving) b.still = true; else if (b.still && !g.demo) { this.cancel(); return; }
      if (b.t > 12) { this.cancel(); return; }
      const wp = b.path[b.wp], dx = wp.x - pl.x, dy = wp.y - pl.y, d = Math.hypot(dx, dy), last = b.wp === b.path.length - 1;
      let rest = d; for (let i = b.wp; i < b.path.length - 1; i++) rest += Math.hypot(b.path[i + 1].x - b.path[i].x, b.path[i + 1].y - b.path[i].y);
      const sp = Math.min(rest > 4.5 ? 3.4 : 1.9, Math.max(0.7, rest * 3.2)), stepLen = sp * dt;
      if (d <= Math.max(stepLen, last ? 0.03 : 0.25)) { if (last) { pl.x = wp.x; pl.y = wp.y; b.phase = 'act'; b.u = 0; b.w = 0; b.h0 = pl.h; g.playerAnim('idle'); if (vis.mixer) vis.mixer.timeScale = 1; pl.speed = 0; return; } b.wp++; return; }
      const want = Math.atan2(dy, dx); pl.h += wrapPi(want - pl.h) * Math.min(1, dt * 11); pl.x += Math.cos(pl.h) * stepLen * Math.max(0.3, Math.cos(wrapPi(want - pl.h))); pl.y += Math.sin(pl.h) * stepLen * Math.max(0.3, Math.cos(wrapPi(want - pl.h)));
      const wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 };
      pl.speed = sp; g.playerAnim(sp > 3 ? (vis.acts.jog ? 'jog' : 'run') : wk.name); if (vis.mixer) vis.mixer.timeScale = sp > 3 ? sp / (vis.acts.jog ? (g.kit.clipSpeed.jog || 2.6) * ((g.kit.tall && g.kit.tall.player) || 1) : vis.runSpeed || 5) : sp / wk.speed;
      return;
    }
    pl.speed = 0; b.w = Math.min(1, b.w + dt / 0.28);
    if (b.kind === 'in') {
      const j = b.jack, n = this.npc;
      if (j && n && n.state !== 'gone' && b.u >= 1.0 && j.t < 1) { j.t += dt / 1.7; this.stepJack(dt, b, j, n); if (j.t >= 1) { this.stats.jacks++; } }      // door open: the driver comes out before the player goes on
      else { const u0 = b.u; b.u += dt; if (b.nodoor && b.u >= ND_A && b.u < T_IN) { b.u = T_IN; this.skipJack(b); this.me.release(); this.hardDrive(); g.sound.door(); this.finish(b); return; } this.cues(u0, b.u, v, 1); }
      if (b.u >= T_IN) { this.finish(b); return; }
    } else {
      const u0 = b.u; b.u -= b.nodoor && b.u <= ND_A ? dt * 0.35 : dt; if (b.nodoor && b.u < ND_B && b.u > ND_A) b.u = ND_A; this.cues(b.u, u0, v, -1);
      if (b.u <= 0) { b.u = 0; this.finish(b); return; }
    }
    // the game's idea of where the player is follows the hips
    const S = this.seat(v), pose = entryPose(b.u, P, S, this.sizes(), this.ground(v), this.me.pose); this.toMap(v, pose.hip.x, pose.hip.z, _o); pl.x = lerp(pl.x, _o.x, b.w); pl.y = lerp(pl.y, _o.y, b.w); pl.h = b.w < 1 && b.h0 !== undefined && b.kind === 'in' ? b.h0 + wrapPi(v.h + pose.yaw - b.h0) * b.w : v.h + pose.yaw; b.z = 0;
    // the car takes the weight: it leans to the door side as he sits (and bobs once), and shivers when the door slams
    { const wu = warp(b.u), tau = Math.max(0, wu - 1.85), sl = Math.max(0, wu - 3.34), want = -0.020 * (ss(wu, 1.62, 1.9) + 0.55 * Math.exp(-5 * tau) * Math.sin(17 * tau) * (tau > 0 ? 1 : 0)) + 0.004 * Math.exp(-9 * sl) * Math.sin(40 * sl) * (sl > 0 && b.kind === 'in' ? 1 : 0); v.roll += (want * (v.def.len > 5.5 ? 0.5 : 1) - v.roll) * 0.6; }
    this.cars.set(v, pose.door * OPEN); if (pose.door <= 0.0005 && (b.kind === 'out' ? b.u < 0.28 : b.u > 2.68)) this.cars.clear();
  }
  sizes() { const r = this.me.rig; return r || FALLBACK; }
  // things that happen once as the time passes a mark (either direction)
  cues(a, b, v, dir) {
    const g = this.g, vis = g.player.vis, hit = (t) => a < t && b >= t;
    if (hit(0.28)) { if (dir > 0) g.sound.door(); }                                             // latch
    if (hit(dir > 0 ? 2.66 : 0.32)) g.sound.door();                                            // shut
    if (hit(2.33) && dir < 0) g.sound.door();                                                  // opened from inside
    if (hit(1.0) && vis.mixer && vis.acts.drive && vis.acts.idle) { const from = dir > 0 ? 'idle' : 'drive', to = dir > 0 ? 'drive' : 'idle'; vis.acts[from].fadeOut(0.5); vis.acts[to].reset().fadeIn(0.5).play(); vis.cur = to; vis.mixer.timeScale = 1; }
  }
  finish(b) {
    const g = this.g, pl = g.player, v = b.v; this.cars.clear();
    if (b.kind === 'in') { this.stats.enters++; this.cam.on = true; g.finishEnter(v); }      // the game's own: vehicle set, Drive playing, missions told
    else { this.stats.exits++; pl.busy = null; this.me.release(); g.playerAnim('idle'); g.statics.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; this.cam.on = false; this.cam.k = 0; }
  }

  // ------------------------------------------------------------------ someone at the wheel
  // a car with no door to open and someone at the wheel: he is on his feet beside it at once, and runs
  skipJack(b) {
    const j = b.jack, n = this.npc; if (!j || !n || n.state !== 'seated') return; j.t = 1; this.stats.jacks++;
    try { const v = n.v, P = this.params(v), vis = n.vis; this.toMap(v, P.xr + 0.55, P.zs - 0.85, _o); n.x = _o.x; n.y = _o.y; n.h = v.h + Math.PI / 2 + 0.15; n.state = 'flee'; n.t = 0.3; n.pup.release();
      const run = vis.acts.jog ? 'jog' : vis.acts.run ? 'run' : null; if (run) { for (const k in vis.acts) if (k !== run) vis.acts[k].stop(); vis.acts[run].reset().play(); vis.cur = run; } n.away = v.h + Math.PI - 0.3; n.dir = n.h; } catch (e) { console.log('[entry] driver not put out: ' + (e && e.message)); }
  }
  stepJack(dt, b, j, n) {
    if (n.state === 'seated' && j.t >= 0.2) { n.state = 'out'; n.t = 0; }
  }
  stepNpc(dt) {
    const n = this.npc, g = this.g; if (!n) return; const v = n.v, vis = n.vis; n.t += dt;
    if (n.state === 'out') {      // out of the seat fast, hauled by the arm: the exit run at more than twice the pace, ending on his feet beside the door
      n.u = Math.max(1.35, n.u - dt * (n.u > 2.4 ? 5 : 2.2));
      if (n.u < 2.3 && vis.cur === 'drive' && vis.acts.idle) { vis.acts.drive.fadeOut(0.3); vis.acts.idle.reset().fadeIn(0.3).play(); vis.cur = 'idle'; }
      if (n.u <= 1.351) { n.state = 'flee'; n.t = 0; const P = this.params(v), pose = n.pup.pose; this.toMap(v, pose.hip.x, pose.hip.z, _o); n.x = _o.x; n.y = _o.y; n.h = v.h + pose.yaw; n.pup.release();
        const run = vis.acts.jog ? 'jog' : vis.acts.run ? 'run' : null; if (run) { vis.acts[vis.cur] && vis.acts[vis.cur].fadeOut(0.25); vis.acts[run].reset().fadeIn(0.25).play(); vis.cur = run; } n.away = v.h + Math.PI - 0.3; n.dir = v.h + Math.PI / 2 + 0.15; }
    } else if (n.state === 'flee') {      // stumbles clear of the door, then runs for it back down the street
      const sp = Math.min(3.6, 1.2 + n.t * 3); if (n.t > 0.55) n.dir = n.away; n.h += wrapPi(n.dir - n.h) * Math.min(1, dt * 5); const nx = n.x + Math.cos(n.h) * sp * dt, ny = n.y + Math.sin(n.h) * sp * dt; g.statics.resolve(nx, ny, 0.3, _o); n.x = _o.x; n.y = _o.y;
      if (vis.mixer) vis.mixer.timeScale = clamp(sp / 2.8, 0.5, 1.4);
      if (n.t > 2 && (n.t > 14 || Math.hypot(n.x - g.player.x, n.y - g.player.y) > 45)) { g.world.scene.remove(vis.object); this.npc = null; }
    }
  }

  // ------------------------------------------------------------------ drawing
  hardDrive() { const vis = this.g.player.vis; if (!vis.acts || !vis.acts.drive) return; for (const k in vis.acts) if (k !== 'drive' && vis.acts[k] && vis.acts[k].stop) vis.acts[k].stop(); vis.acts.drive.reset().setEffectiveWeight(1).play(); vis.cur = 'drive'; if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.update(0); } }
  // calm at the wheel: the Drive take (a mocap take that sways trunk and head) is held near its first frame and only breathes
  calm(dt) { const dr = this.g.player.vis.acts && this.g.player.vis.acts.drive; if (!dr) return; if (dr.getEffectiveTimeScale() !== 0) dr.setEffectiveTimeScale(0);
    const want = 0.16 + 0.14 * Math.sin((this.g.t || 0) * 0.7); dr.time += (want - dr.time) * Math.min(1, (dt || 0.016) * 1.5); }
  sync(dt) {
    const g = this.g, pl = g.player, b = pl.busy, me = this.me;
    const n = this.npc;
    if (n) this.stepNpc(dt * this.speed);
    if (this.npc) { const n = this.npc, v = n.v, vis = n.vis; if (vis.mixer) vis.mixer.update(dt);
      if (n.state === 'flee') { vis.object.position.set(n.x, g.statics.onSidewalk(n.x, n.y) ? 0.15 : 0, -n.y); vis.object.rotation.set(0, n.h, 0); }
      else if (n.pup.rig) { const CM = this.cars.matrix(v, _cm2, _cq2), P = this.params(v), S = this.seat(v, n.who), pose = entryPoseRaw(n.u, P, S, n.pup.rig, this.ground(v), n.pup.pose);
        if (n.state === 'out') npcOutPose(pose, n.u);
        n.pup.apply(pose, CM, _cq2, 1); } }
    if (b && b.entry && b.phase !== 'walk') {
      if (!me.rig) return; const v = b.v, CM = this.cars.matrix(v, _cm, _cq), pose = entryPose(b.u, this.params(v), this.seat(v), me.rig, this.ground(v), me.pose);
      if (n && b.jack && b.jack.t > 0 && b.jack.t < 1 && n.pup.rig) playerJackPose(pose, b.jack.t, n.pup.rig, _m2.copy(CM).invert(), this.params(v), this.seat(v));
      if (b.w < 1 && b.h0 !== undefined && b.kind === 'in') pose.yaw = wrapPi(b.h0 - v.h) + wrapPi(pose.yaw - wrapPi(b.h0 - v.h)) * b.w;
      me.apply(pose, CM, _cq, b.w);
    } else if (pl.vehicle && pl.vis.object.visible && me.rig && this.params(pl.vehicle).eye && g.P.get('eseat') !== '0') {
      // at the wheel: the same seated pose the entry ends in (feet at the pedals, hands on this car's own rim), carried by the car
      const v = pl.vehicle, CM = this.cars.matrix(v, _cm, _cq), pose = entryPose(T_IN, this.params(v), this.seat(v), me.rig, ZERO, me.pose);
      this.calm(dt);
      this._sa = (this._sa || 0) + (clamp(-(v.steer || 0) * 1.15, -0.42, 0.42) - (this._sa || 0)) * Math.min(1, (dt || 0.016) * 7); const a = this._sa; if (Math.abs(a) > 0.004 && this.params(v).wheelC) { const P = this.params(v); for (const h of [pose.hL, pose.hR]) { h.p.sub(P.wheelC).applyAxisAngle(P.wheelAx, a).add(P.wheelC); h.f.applyAxisAngle(P.wheelAx, a); h.n.applyAxisAngle(P.wheelAx, a); } }
      me.apply(pose, CM, _cq, 1);
    } else { me.release(); this._sa = 0; if (pl.vehicle && !b) this.calm(dt); }
    if (this.g.P.has('eview')) this.qaCam();
  }

  // ------------------------------------------------------------------ camera: one ease between the on-foot view and the driving view
  camStep(dt) {
    const g = this.g, pl = g.player, b = pl.busy, C = g.cam, c = this.cam;
    if (g.fly && g.fly.on) return false; if (g.heli && g.heli.hasCamera) return false;
    let v = null, want = 0;
    if (b && b.entry && (b.phase !== 'walk' || b.v.def.hgt > 1.9)) { v = b.v; want = b.phase === 'walk' ? 0 : b.kind === 'in' ? ss(b.u, 1.5, T_IN + 0.5) : ss(b.u, 1.3, T_IN - 0.2); c.on = true; }
    else if (c.on && pl.vehicle) { v = pl.vehicle; want = 1; }
    else { c.on = false; c.k = 0; return false; }
    if (b && b.entry) c.k = b.nodoor ? c.k + clamp(want - c.k, -dt * 2.4, dt * 2.4) : want; else c.k = Math.min(1, c.k + dt / 0.9 * (1.02 - c.k) * 3);
    const k = c.k; if (!b && k > 0.995 && !(c.fb > 0.02 && (c.hold = (c.hold || 0) + dt) < 1.5)) { c.on = false; c.k = 0; c.hold = 0; return false; }      // fully the driving view: the game's own camera carries on from the same numbers
    const big = v.def.len > 7 ? 1.9 : v.def.hgt > 2 ? 1.3 : 1, sp = Math.hypot(v.vx, v.vy);
    const foot = { x: pl.vehicle ? v.x : pl.x, y: pl.vehicle ? v.y : pl.y, z: (g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0) + (b ? 1.2 : 1.5), dist: b ? 4.6 : 3.4, height: b ? 0.5 : 0.35, fov: 52 };      // while he gets in or out: a little further back and lower, so door, legs and feet stay in the picture
    const car = { x: v.x, y: v.y, z: v.z + 1.15 * big, dist: (5.6 + sp * 0.045) * big, height: 1.25 * big, fov: 56 + clamp(sp / 45, 0, 1) * 16 };
    const t = { x: lerp(foot.x, car.x, k), y: lerp(foot.y, car.y, k), z: lerp(foot.z, car.z, k), dist: lerp(foot.dist, car.dist, k), height: lerp(foot.height, car.height, k), fov: lerp(foot.fov, car.fov, k) };
    // if the car is between the camera and the door, come round to the door's side (only while the mouse is left alone)
    if (C.lookT > 1.0 && b) { { const a = v.h - 0.62, hq = g.statics.raycast(t.x, t.y, t.x - Math.cos(a) * (t.dist + 0.6), t.y - Math.sin(a) * (t.dist + 0.6)); c.qo = (c.qo === undefined ? 1 : c.qo) + ((hq < 0.85 ? 0 : 1) - (c.qo === undefined ? 1 : c.qo)) * Math.min(1, dt * 5); }
      const off = wrapPi(v.h - ((0.62) - 0.47 * (1 - c.qo)) - C.yaw); if (Math.abs(off) > 0.03 + 0.27 * c.qo) C.yaw += off * Math.min(1, dt * 2.4); }      // to the rear quarter on the door's side, where the door does not hide him
    else if (C.lookT > 1.5 && !b && pl.vehicle) C.yaw += wrapPi(v.h - C.yaw) * Math.min(1, dt * 3.2 * k);
    const kk = Math.min(1, dt * 14); C.tx += (t.x - C.tx) * kk; C.ty += (t.y - C.ty) * kk; C.tz += (t.z - C.tz) * Math.min(1, dt * 8);
    C.dist += (t.dist - C.dist) * Math.min(1, dt * 5); C.fov += (t.fov - C.fov) * Math.min(1, dt * 5); C.h += (t.height - C.h) * Math.min(1, dt * 5);
    C.shake = Math.max(0, C.shake - dt * 2.2);
    c.v = b && !pl.vehicle ? v : null; this.placeCam(dt, k); return true;
  }
  // the game's placeCamera with its on-foot / in-car differences blended by k
  placeCam(dt, k) {
    const g = this.g, C = g.cam, cam = g.world.camera; const pitch = lerp(Math.max(-0.25, C.pitch), clamp(C.pitch, 0.04, 0.9), k);
    let d = C.dist; const bx = -Math.cos(C.yaw), by = -Math.sin(C.yaw);
    const hd = d * Math.cos(pitch); let hit = 1; for (const sd of [0, 0.45, -0.45]) hit = Math.min(hit, g.statics.raycast(C.tx, C.ty, C.tx + bx * (hd + 0.6) - by * sd, C.ty + by * (hd + 0.6) + bx * sd));
    { const v = this.cam.v; if (v && v.def && v.def.hgt > 1.9) {      // a van or truck between him and the camera: come in to its near side, never sit inside its body
      const c = Math.cos(v.h), s = Math.sin(v.h), hl = (v.def.len || 4.6) / 2 + 0.3, hw = (v.def.wid || 1.85) / 2 + 0.3, ox = (C.tx - v.x) * c + (C.ty - v.y) * s, oz = (C.tx - v.x) * s - (C.ty - v.y) * c, ex = bx * hd, ey = by * hd, dx = ex * c + ey * s, dz = ex * s - ey * c;
      if (Math.abs(ox) > hl || Math.abs(oz) > hw) { let t0 = 0, t1 = 1; for (const [o, dd, h] of [[ox, dx, hl], [oz, dz, hw]]) { if (Math.abs(dd) < 1e-6) { if (Math.abs(o) > h) t0 = 2; continue; } let a = (-h - o) / dd, e = (h - o) / dd; if (a > e) { const q = a; a = e; e = q; } if (a > t0) t0 = a; if (e < t1) t1 = e; }
        if (t0 < t1 && C.tz + (C.h + d * Math.sin(pitch)) * t0 < (v.z || 0) + v.def.hgt + 0.3) hit = Math.min(hit, t0); } } }
    const want = hit < 1 ? Math.max(0.9, d * hit - 0.35) : d; if (!dt || C.clip === undefined) C.clip = want; else C.clip += (want - C.clip) * Math.min(1, dt * (want < C.clip ? 22 : 2.2)); d = Math.min(d, C.clip);
    let cx = C.tx + bx * d * Math.cos(pitch), cy = C.ty + by * d * Math.cos(pitch), cz = C.tz + C.h + d * Math.sin(pitch); if (cz < 0.4) cz = 0.4;
    { const pb = g.player.busy, v = (pb && pb.entry && pb.v) || g.player.vehicle, c = this.cam; let m = 0;      // never rammed into the car's body or his head: a clear place behind instead
      if (v && v.def) { const co = Math.cos(v.h), si = Math.sin(v.h), hl = (v.def.len || 4.6) / 2, hw = (v.def.wid || 1.85) / 2, top = (v.z || 0) + (v.def.hgt || 1.45), ox = (cx - v.x) * co + (cy - v.y) * si, oz = (cx - v.x) * si - (cy - v.y) * co;
        m = clamp(Math.min((hl + 0.6 - Math.abs(ox)) / 0.3, (hw + 0.6 - Math.abs(oz)) / 0.3, (top + 0.5 - cz) / 0.3), 0, 1);
        if (pb && pb.entry) m = Math.max(m, clamp((0.7 - d / Math.max(1, C.dist)) / 0.15, 0, 1));
        if (this.me && this.me.rig && g.player.vis.object.visible) { const hp = this.me.rig.pos('head', _v2); m = Math.max(m, clamp((0.6 - Math.hypot(hp.x - cx, hp.y - cz, hp.z + cy)) / 0.2, 0, 1)); }
        if (m > 0 && !(c.fb > 0)) { let best = -1; for (const [dx, dz] of [[-0.81, -0.58], [-0.98, -0.2], [-1, 0], [-0.98, 0.2]]) { const mx = co * dx + si * dz, my = si * dx - co * dz, L = Math.min(4.4, g.statics.raycast(C.tx, C.ty, C.tx + mx * 5, C.ty + my * 5) * 5 - 0.35); if (L > best) { best = L; c.fbx = mx; c.fby = my; c.fbL = L; } if (L >= 3) break; } }
        c.fb = Math.max(m, (c.fb || 0) - (dt || 0) * 1.6);
        if (c.fb > 0) { const L = Math.max(1.2, c.fbL || 0); cx = lerp(cx, C.tx + c.fbx * L, c.fb); cy = lerp(cy, C.ty + c.fby * L, c.fb); cz = lerp(cz, Math.max(cz, top + 0.35), c.fb); } } else c.fb = 0; }
    const sh = C.shake * C.shake * 0.25, n = g.frame; cam.position.set(cx + Math.sin(n * 1.7) * sh, cz + Math.sin(n * 2.3) * sh, -cy + Math.cos(n * 1.3) * sh);
    const ahead = 2.2 * k * k; cam.lookAt(C.tx + Math.cos(C.yaw) * ahead, C.tz + lerp(0.15, 0.1, k), -(C.ty + Math.sin(C.yaw) * ahead));
    { const extra = (-0.25 - C.pitch) * (1 - k); if (extra > 0) { const dd = cam.getWorldDirection(_v), hl = Math.hypot(dd.x, dd.z) || 1, e = Math.min(1.4, Math.asin(clamp(dd.y, -1, 1)) + extra); cam.lookAt(cam.position.x + dd.x / hl * Math.cos(e) * 10, cam.position.y + Math.sin(e) * 10, cam.position.z + dd.z / hl * Math.cos(e) * 10); } }
    if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
  }
  // QA: a fixed camera on the driver's door of the car in play (?eview=side|front|rear|roof|in, ?edist=)
  qaCam() {
    const g = this.g, pl = g.player, v = (pl.busy && pl.busy.v) || pl.vehicle || this.last; if (!v) return; const P = this.params(v), cam = g.world.camera, d = +(g.P.get('edist') || 4.2), view = g.P.get('eview');
    const tx = (P.xr + P.hinge.x) / 2 - 0.1, at = { side: [tx, 1.15, -d - 0.9, tx, 0.95, 0], front: [tx + d * 0.8, 1.5, -d * 0.62 - 0.9, tx - 0.2, 0.9, -0.7], rear: [tx - d * 0.85, 1.6, -d * 0.55 - 0.9, tx + 0.2, 0.9, -0.7], roof: [tx - 0.4, d + 1.2, -1.3, tx, 0.6, -1.0], in: [tx + 0.1, 1.25, 0.75, tx + 0.15, 0.95, -0.9] }[view] || [tx, 1.15, -d - 0.9, tx, 0.95, 0];
    const c = Math.cos(v.h), s = Math.sin(v.h); cam.position.set(v.x + c * at[0] + s * at[2], at[1], -(v.y + s * at[0] - c * at[2])); cam.lookAt(v.x + c * at[3] + s * at[5], at[4], -(v.y + s * at[3] - c * at[5]));
    const f = +(g.P.get('efov') || 42); if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ scripted player, for filming and frame-rate runs (?escript=)
  //   park: walk to the nearest parked car with a door, F, drive off, stop, F, walk away.   jack: the same on a car in traffic (held still).   loop: park, for ever.
  runScript(dt) {
    const g = this.g, pl = g.player, I = g.input, sc = this.script; sc.t += dt; I.mx = 0; I.my = 0; I.steer = 0; I.throttle = 0; I.brake = 0; I.handbrake = false; I.run = false; I.lock = undefined;
    const go = (st) => { sc.st = st; sc.t = 0; }, walkTo = (x, y) => { const rel = Math.atan2(y - pl.y, x - pl.x) - g.cam.yaw; I.mx = Math.sin(rel); I.my = Math.cos(rel); };
    if (sc.st === 'find') {
      if (sc.t < (sc.name === 'jack' ? 1.2 : 0.6)) return; let best = null, bd = 60;
      if (sc.name === 'jack') { for (const c of g.traffic.cars) { if ((g.streetVehicles && !this.D[c.type]) || c.v > 0.4 || (g.P.has('ekind') && c.type !== g.P.get('ekind'))) continue; const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (d < bd && d > 4) { bd = d; best = c; } } }
      else for (const s of g.parked.near(pl.x, pl.y, g.P.has('ekind') ? 150 : 40)) { if ((g.streetVehicles && !this.D[s.type]) || s.gone || (g.P.has('ekind') && s.type !== g.P.get('ekind'))) continue; const d = Math.hypot(s.x - pl.x, s.y - pl.y) + (sc.used && sc.used.has(s) ? 100 : 0); if (d < bd && d > 2.5) { bd = d; best = s; } }
      if (!best) { if (sc.t > (sc.name === 'jack' ? 40 : 6)) go('idle'); return; } sc.car = best; (sc.used ||= new Set()).add(best);
      if (g.P.has('enear') && !sc.placed) { sc.placed = true; const c = Math.cos(best.h), s = Math.sin(best.h), d = +(g.P.get('enear') || 4) || 4, sd = g.P.get('eside') === 'left' ? -1 : 1; pl.x = best.x - c * 1.2 + s * d * sd; pl.y = best.y - s * 1.2 - c * d * sd; pl.h = Math.atan2(best.y - pl.y, best.x - pl.x); g.cam.yaw = pl.h; g.snapCamera(); }      /* ?enear=4: start four metres off the car's kerb side (eside=left: its door side) */
      go('walk');
    } else if (sc.st === 'walk') {
      const c = sc.car; if (sc.name === 'jack') { c.stun = 2; }
      const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (d < 3.5 && (sc.name !== 'jack' || c.v < 1)) { I.use = true; go('enter'); return; } walkTo(c.x, c.y); if (sc.t > 25) go('idle');
    } else if (sc.st === 'enter') {
      if (sc.name === 'jack' && sc.car && !pl.busy && !pl.vehicle && sc.t < 1) { sc.car.stun = 2; I.use = true; }
      if (pl.vehicle) go('settle'); else if (!pl.busy && sc.t > 1.5) go('find');
    } else if (sc.st === 'settle') { I.handbrake = true; if (sc.t > 0.8) { const v = pl.vehicle; sc.side = g.statics.onSidewalk(v.x - Math.sin(v.h) * 3.2, v.y + Math.cos(v.h) * 3.2) ? -1 : 1; go('drive'); }
    } else if (sc.st === 'drive') {
      const t = sc.t; I.throttle = t < 2.6 ? 0.45 : 0; I.steer = (t > 0.3 && t < 1.2 ? 0.55 : t >= 1.2 && t < 2.1 ? -0.55 : 0) * sc.side; I.lock = I.steer * 0.42; I.latLim = 12;
      if (t >= 2.6) { const v = pl.vehicle; if (Math.abs(v.vf) > 0.6) I.brake = 1; else I.handbrake = true; if (Math.hypot(v.vx, v.vy) < 0.15 && t > 3.6) { I.use = true; go('exit'); } }
    } else if (sc.st === 'exit') { if (!pl.vehicle && !pl.busy) go('away'); else if (pl.vehicle && sc.t > 1) I.use = true;
    } else if (sc.st === 'away') { I.my = 1; if (sc.t > 1.6) go(sc.name === 'loop' ? 'find' : 'idle'); }
  }
}
const _o = {}, _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cm2 = new THREE.Matrix4(), _cq2 = new THREE.Quaternion(), ZERO = () => 0;
const FALLBACK = { standH: 0.97, ankleH: 0.08, hipW: 0.09, headUp: 0.62 };

export async function addEntry(game) {
  if (game.P.get('entry') === '0') return null;
  const e = new Entry(game); await e.init(); game.entry = e; return e;
}
