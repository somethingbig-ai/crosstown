// moto/moto.js (gameplay lane, Nov 14 2026; Matt: "I want a MOTORCYCLE"): a motorcycle you can take, ride, crash and be thrown off.
//   One call at the END of Game.init:  import('./moto/moto.js').then((m) => m.install(game))      ?moto=0: nothing of this is fetched.
// What is where:
//   motophys.js   the physics, one function stepBike(state, dt, input, env) (see lanes/gameplay/moto-state/NOTES.md for the interface)
//   motomodel.js  the model, made in code (fetched after the game is playable)
//   this file     everything else: the bike as one of the game's vehicles (class MotoVehicle extends the game's Vehicle, so wanted level, patrol
//                 cars, jobs, the wedged-car rescue and the map-edge banner see "the player's vehicle" as before), bikes standing at the kerb (they
//                 are parked slots of game.parked with type 'moto'), getting on and off (walks round bodies, leg over, stand up, engine), the rider's
//                 pose, the lower camera that rolls with the lean, crashes that throw him (the lead's pedhit ragdoll with its wall sweep), getting
//                 up, picking a fallen bike up, the engine note.
// The game's own code is wrapped from here, never edited: tryEnter, exitVehicle, stepBusy, step, syncVisuals, camTarget, placeCamera, onCrash,
// nearestCar, hud.text, sound.update. The streets layer needs one line (it draws an unknown kind as a saloon): tools/patch.py.
// QA (URL): motoat=x,y,h (a bike stands there)  motorate=<share of kerb gaps with bikes, default 0.3>  motophys=<module>  motodbg=1
import * as THREE from 'three';
import { Vehicle } from '../game.js';
import { clamp, lerp, wrapPi } from '../geo.js';
import { stepBike, initBike, TUNE, leanMax } from './motophys.js';

const TRAFFIC = true;       // riders in traffic and taking a bike from one (mototraffic.js): hand-over 2
const DEF = { type: 'moto', moto: true, len: TUNE.len, wid: TUNE.wid, hgt: 1.12, radius: TUNE.radius, wheelbase: TUNE.wb, body: [], wheels: [] };
const DEF_DOWN = Object.assign({}, DEF, { wid: 1.3, hgt: 0.5 });
const DEF_OWN = Object.assign({}, DEF_DOWN, { hgt: -1 });      // handover-3 (2): the bike its thrown rider is still astride: no solid for the ragdoll (carshape.js makes an outline with nothing above the road of it); len and wid as lying
const LANE_MAX = 3;      // handover-3 (4): bikes left in a travel lane that stay vehicles (traffic brakes for the player's vehicles, not for parked slots)
const SPEC = { top: TUNE.top, acc: TUNE.acc, grip: TUNE.grip };
const PAINTS = [0x9e1616, 0x12306b, 0x0e0f12, 0xc9ccd1, 0xc85a12, 0x1c5237, 0xd4b012];
// the bike's own frame: x ahead, y up, z to the right. Where the rider touches it:
const SEAT = [-0.30, 0.895], PEG = [-0.19, 0.335, 0.25], GRIP = [0.335, 1.08, 0.30], PIVOT = [0.43, 0.95, 0], AXIS = [-0.434, 0.901, 0];
const LOW = [[1.08, 0.34], [1.27, 0.33], [0.34, 0.24], [0.42, 0.26], [0.0, 0.07], [0.62, 0.07]];
const RIDE_PITCH = 0.66, X0 = -0.30, SIDE_D = 0.56, LIFT_D = 1.52, T_MOUNT = 2.0, T_LIFT = 1.3, T_UP = 1.55, SUB = 1 / 120;
const ss = (u, a, b) => { u = clamp((u - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const bump = (u, a, b, c) => ss(u, a, b) * (1 - ss(u, b, c));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = V3(), _v2 = V3(), _v3 = V3(), _fw = V3(), _lf = V3(), _pl = V3(), UP = V3(0, 1, 0), ONE = V3(1, 1, 1), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _o = {}, _o2 = {}, _pp = { x: 0, y: 0 };
const _mb = new THREE.Matrix4(), _mf = new THREE.Matrix4(), _mw = new THREE.Matrix4(), _mt = new THREE.Matrix4(), _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _col = new THREE.Color();
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const liftOf = (lean) => { const a = Math.abs(lean); if (a < 0.95) return 0; const sn = Math.sin(a), cs = Math.cos(a); let m = 0; for (const p of LOW) m = Math.max(m, p[1] * sn - p[0] * cs); return m * ss(a, 0.95, 1.15); };      // lying on its side it rests on its bar end and peg: the wheels' line is lifted that much (riding never leans past 0.92)
const newPose = () => ({ hip: V3(), fL: V3(), fR: V3(), look: V3(1, 0, 0), hL: { p: V3(), f: V3(1, 0, 0), n: V3(0, -1, 0), w: 0, curl: 0 }, hR: { p: V3(), f: V3(1, 0, 0), n: V3(0, 1, 0), w: 0, curl: 0 }, yaw: 0, pitch: 0, roll: 0, sit: 0, rootY: 0, yawL: 0, yawR: 0, pitL: 0, pitR: 0, lookW: 0, splay: 1 });
const VEC = ['hip', 'fL', 'fR', 'look'], NUM = ['yaw', 'pitch', 'roll', 'sit', 'rootY', 'yawL', 'yawR', 'pitL', 'pitR', 'lookW'];
function copyPose(a, b) { for (const k of VEC) b[k].copy(a[k]); for (const k of NUM) b[k] = a[k]; for (const h of ['hL', 'hR']) { b[h].p.copy(a[h].p); b[h].f.copy(a[h].f); b[h].n.copy(a[h].n); b[h].w = a[h].w; b[h].curl = a[h].curl; } return b; }
function mixPose(a, b, k) { for (const n of VEC) b[n].lerpVectors(a[n], b[n], k); for (const n of NUM) b[n] = lerp(a[n], b[n], k); for (const h of ['hL', 'hR']) { b[h].p.lerpVectors(a[h].p, b[h].p, k); b[h].f.lerpVectors(a[h].f, b[h].f, k).normalize(); b[h].n.lerpVectors(a[h].n, b[h].n, k).normalize(); b[h].w = lerp(a[h].w, b[h].w, k); b[h].curl = lerp(a[h].curl, b[h].curl, k); } return b; }
// the same pose seen in a mirror (getting on from the right)
function mirrorPose(o) { o.hip.z = -o.hip.z; _v.copy(o.fL); o.fL.set(o.fR.x, o.fR.y, -o.fR.z); o.fR.set(_v.x, _v.y, -_v.z); o.yaw = -o.yaw; o.roll = -o.roll; const a = o.yawL; o.yawL = -o.yawR; o.yawR = -a; const p = o.pitL; o.pitL = o.pitR; o.pitR = p; o.look.z = -o.look.z;
  const L = o.hL, R = o.hR; for (const h of [L, R]) { h.p.z = -h.p.z; h.f.z = -h.f.z; h.n.set(-h.n.x, -h.n.y, h.n.z); } o.hL = R; o.hR = L; return o; }

// lay a pose (given in the frame CM / CQ: x ahead, y up, z right) on a figure through the boarding lane's rig; w = how much of it (0 = the clip alone)
function applyPose(rig, o, pose, CM, CQ, w = 1) {
  _q.setFromAxisAngle(UP, pose.yaw); o.quaternion.copy(CQ).multiply(_q); o.position.set(pose.hip.x, pose.rootY || 0, pose.hip.z).applyMatrix4(CM); o.updateMatrixWorld(true);
  const fwd = _fw.set(1, 0, 0).applyQuaternion(o.quaternion), left = _lf.set(0, 0, -1).applyQuaternion(o.quaternion);
  rig.hips(_v.copy(pose.hip).applyMatrix4(CM), w);
  if (pose.pitch || pose.roll) { _q.setFromAxisAngle(left, pose.pitch * 0.3 * w); _q2.setFromAxisAngle(fwd, pose.roll * 0.3 * w); rig.tilt(_q.multiply(_q2)); rig.bend(left, pose.pitch * 0.7 * w); rig.bend(fwd, pose.roll * 0.7 * w); }
  const pole = _pl.copy(fwd).addScaledVector(UP, 0.55 + 0.6 * pose.sit).normalize(), sp = pose.splay === undefined ? 1 : pose.splay;
  for (const s of ['L', 'R']) { const yaw = s === 'L' ? pose.yawL : pose.yawR; _v2.set(Math.cos(yaw), 0, -Math.sin(yaw)).transformDirection(CM); rig.leg(s, _v.copy(s === 'L' ? pose.fL : pose.fR).applyMatrix4(CM), _v3.copy(pole).addScaledVector(left, (s === 'L' ? 1 : -1) * (0.1 + 0.25 * pose.sit) * sp), _v2, s === 'L' ? pose.pitL : pose.pitR, w); }
  for (const s of ['L', 'R']) { const h = s === 'L' ? pose.hL : pose.hR, hw = h.w * w; if (hw <= 0.001) { rig.curl(s, 0); continue; }
    rig.arm(s, _v.copy(h.p).applyMatrix4(CM), _v3.set(0, -1, 0).addScaledVector(left, s === 'L' ? 0.7 : -0.7).addScaledVector(fwd, -0.3), hw);
    rig.handDir(s, _v.copy(h.f).transformDirection(CM), _v2.copy(h.n).transformDirection(CM), hw); rig.curl(s, h.curl * w); }
  if (pose.lookW > 0) rig.look(_v.copy(pose.look).transformDirection(CM), pose.lookW * w);
}

// ---------------------------------------------------------------------------------------------------- the figure's poses
// Riding: hips on the seat, feet on the pegs (the left one down at a stop), hands on the grips (they turn with the bars), trunk leant to the
// bars, head level and looking into the turn. In the bike's own (leaning) frame, so he leans with it.
function grip(v, side, out) { _v.set(GRIP[0], GRIP[1], side * GRIP[2]).sub(_v2.set(...PIVOT)).applyAxisAngle(_v3.set(...AXIS), v.steer || 0).add(_v2); return out.copy(_v); }
function ridePose(v, o, R, dz = 0) {
  const sp = Math.abs(v.vf || 0), lm = Math.max(0.1, leanMax(sp)), k = clamp(v.lean / lm, -1, 1), tuck = clamp(sp / 45, 0, 1), ank = R ? R.ankleH : 0.085;
  o.hip.set(SEAT[0] - 0.02 * tuck, SEAT[1], 0.03 * k * -1); o.rootY = 0; o.yaw = 0; o.pitch = RIDE_PITCH + 0.2 * tuck - clamp((v.acc || 0) * 0.006, -0.08, 0.08); o.roll = -0.16 * k; o.sit = 1; o.splay = 0.55;
  o.fL.set(PEG[0], PEG[1] + ank, -PEG[2]); o.fR.set(PEG[0], PEG[1] + ank, PEG[2]); o.yawL = 0.12; o.yawR = -0.12; o.pitL = o.pitR = -0.12;
  const dn = 1 - ss(sp, 0.5, 2.4); if (dn > 0) { const z = -0.46, y = (ank + 0.01 + dz + 0.46 * Math.sin(v.lean)) / Math.cos(v.lean); _v.set(-0.12, y, z); o.fL.lerp(_v, dn); o.fL.y += 0.07 * Math.sin(Math.PI * dn) * (dn < 1 ? 1 : 0); o.pitL *= 1 - dn; o.yawL = lerp(o.yawL, 0.3, dn); }
  grip(v, -1, o.hL.p); grip(v, 1, o.hR.p); for (const h of [o.hL, o.hR]) { h.p.x -= 0.07; h.p.y += 0.02; h.w = 1; h.curl = 0.9; } o.hL.f.set(0.9, -0.28, 0.12).normalize(); o.hR.f.set(0.9, -0.28, -0.12).normalize(); o.hL.n.set(0.2, -1, 0).normalize(); o.hR.n.set(-0.2, 1, 0).normalize();
  o.look.set(1, 0.02, -0.75 * k - 0.6 * clamp(v.steer || 0, -0.5, 0.5) * (1 - ss(sp, 1, 6))).normalize(); o.lookW = 0.85; return o;
}
// Getting on from the LEFT, u seconds in (run backwards it is getting off). In the bike's UPRIGHT frame (x ahead, z right, y up from the road
// under the bike). R = the rig's sizes, gy(x, z) = ground height there, v = the bike (its lean and bars place the hands).
const _hb = V3(), FB = { standH: 0.97, ankleH: 0.085, hipW: 0.09 };
function bikePoint(v, x, y, z, out) { const r = -v.lean, c = Math.cos(r), s = Math.sin(r); return out.set(x, y * c - z * s + liftOf(v.lean), y * s + z * c); }      // a point of the leaning bike, in the upright frame
function mountPose(u, v, R, gy, o) {
  R = R || FB; const yaw0 = -Math.PI / 2 + 0.45, a = ss(u, 0.78, 1.32), g0 = gy(X0, -SIDE_D);
  o.hip.set(X0 + 0.0 * a, 0, lerp(-SIDE_D, 0, a)); const stand = g0 + R.standH - 0.025 - 0.05 * bump(u, 0.15, 0.45, 0.8) + 0.035 * bump(u, 0.7, 0.95, 1.2);
  o.hip.y = lerp(stand, SEAT[1], ss(u, 0.98, 1.42)) - 0.03 * bump(u, 1.4, 1.52, 1.75); o.rootY = lerp(g0, 0, a);
  o.yaw = lerp(yaw0, 0, ss(u, 0.58, 1.28)); o.pitch = 0.24 * ss(u, 0.1, 0.4) * (1 - ss(u, 1.3, 1.7)) + 0.32 * bump(u, 0.55, 0.95, 1.4) + RIDE_PITCH * ss(u, 1.05, 1.6); o.roll = -0.2 * bump(u, 0.6, 0.92, 1.3); o.sit = ss(u, 0.98, 1.42); o.splay = lerp(1, 0.55, o.sit);
  const f0x = Math.cos(yaw0), f0z = -Math.sin(yaw0), l0x = -Math.sin(yaw0), l0z = -Math.cos(yaw0), hw = R.hipW + 0.015;
  const L0 = _v2.set(X0 + l0x * hw + f0x * 0.03, 0, -SIDE_D + l0z * hw + f0z * 0.03); L0.y = gy(L0.x, L0.z) + R.ankleH;
  // the left foot stays where it stands, then shuffles to where it holds the bike up (the heel flicks the stand on the way)
  const sL = ss(u, 1.45, 1.78), Ld = _v3.set(-0.12, R.ankleH + 0.01 + 0.46 * Math.sin(TUNE.footLean), -0.46); o.fL.lerpVectors(L0, Ld, sL); o.fL.y += 0.06 * Math.sin(Math.PI * sL); o.fL.x -= 0.07 * Math.sin(Math.PI * sL); o.yawL = lerp(yaw0, 0.3, ss(u, 0.9, 1.7)); o.pitL = 0;
  // the right leg: up, back over the tail, down onto its peg
  const sR = ss(u, 0.6, 1.3), R0 = _v2.set(X0 - l0x * hw - f0x * 0.05, 0, -SIDE_D - l0z * hw - f0z * 0.05); R0.y = gy(R0.x, R0.z) + R.ankleH;
  o.fR.lerpVectors(R0, _v3.set(PEG[0], PEG[1] + R.ankleH, PEG[2]), sR); const arc = Math.sin(Math.PI * Math.pow(sR, 0.85)); o.fR.y += 0.74 * arc; o.fR.x -= 0.34 * arc; o.yawR = lerp(yaw0, -0.12, sR); o.pitR = -0.5 * arc - 0.12 * sR;
  // hands: the left takes the left grip; the right rests on the seat's nose while the leg goes over, then takes its grip
  grip(v, -1, _hb); bikePoint(v, _hb.x - 0.07, _hb.y + 0.02, _hb.z, o.hL.p); o.hL.w = ss(u, 0.05, 0.42); o.hL.curl = 0.9 * ss(u, 0.3, 0.45); o.hL.f.set(0.9, -0.28, 0.12).normalize(); o.hL.n.set(0.2, -1, 0).normalize();
  const k = ss(u, 1.22, 1.62); bikePoint(v, -0.27, 0.87, -0.11, o.hR.p); grip(v, 1, _hb); bikePoint(v, _hb.x - 0.07, _hb.y + 0.02, _hb.z, _v2); o.hR.p.lerp(_v2, k); o.hR.p.y += 0.1 * Math.sin(Math.PI * k);
  o.hR.w = ss(u, 0.28, 0.6); o.hR.curl = 0.3 + 0.6 * k; o.hR.f.set(0.9, -0.28, -0.12).lerp(_v2.set(0.5, -0.5, 0.7), 1 - k).normalize(); o.hR.n.set(-0.2, 1, 0).normalize();
  o.look.set(0.75 - o.hip.x, 1.0 - (o.hip.y + 0.6), 0 - o.hip.z).normalize().lerp(_v2.set(1, 0, 0), ss(u, 1.1, 1.6)).normalize(); o.lookW = 0.7;
  return o;
}
// Standing a fallen bike up, k = 0..1: he stands on the side it fell to, beyond the bars, crouches, takes the low grip and the seat, and walks
// it up. Same frame as mountPose, for a bike that fell to its LEFT (mirrored for the other side); ends where mountPose(0.42) begins.
function liftPose(k, v, R, gy, o) {
  mountPose(0.42, v, R, gy, o); R = R || FB; const cr = bump(k, 0.0, 0.3, 0.95), D = LIFT_D - SIDE_D;
  // four short steps in as the bike comes up: a foot only moves while it is off the ground
  const a1 = ss(k, 0.35, 0.5), a2 = ss(k, 0.62, 0.77), b1 = ss(k, 0.48, 0.63), b2 = ss(k, 0.75, 0.9), pL = (a1 + a2) / 2, pR = (b1 + b2) / 2;
  o.fL.z -= D * (1 - pL); o.fR.z -= D * (1 - pR); o.hip.z -= D * (1 - (pL + pR) / 2); o.fL.y += 0.06 * (Math.sin(Math.PI * a1) + Math.sin(Math.PI * a2)); o.fR.y += 0.06 * (Math.sin(Math.PI * b1) + Math.sin(Math.PI * b2));
  o.hip.y -= 0.40 * cr; o.pitch = 0.24 + 0.85 * cr; o.sit = 0.5 * cr; o.hL.w = ss(k, 0.05, 0.28); o.hR.w = ss(k, 0.1, 0.3); o.hL.curl = o.hR.curl = 0.8 * ss(k, 0.2, 0.3);
  o.look.set(0.4, -0.7 * cr - 0.1, 1).normalize(); o.lookW = 0.6; return o;
}

function upPose(t, o, R) { const k = ss(t, 0.5, 1.3); o.hip.set(-0.05 * (1 - k), lerp(0.4, R.standH - 0.02, k), 0); o.rootY = 0; o.yaw = 0; o.pitch = lerp(0.95, 0, k); o.roll = 0; o.sit = 0.5 * (1 - k); o.splay = 1;
  o.fL.set(0.1, R.ankleH, -0.14); o.fR.set(-0.12, R.ankleH, 0.14); o.yawL = 0.15; o.yawR = -0.15; o.pitL = o.pitR = 0;
  o.hL.p.set(0.42, 0.07, -0.24); o.hR.p.set(0.42, 0.07, 0.24); o.hL.w = o.hR.w = 1 - ss(t, 0.5, 0.85); o.hL.curl = o.hR.curl = 0; o.hL.f.set(1, -0.1, 0.1).normalize(); o.hR.f.set(1, -0.1, -0.1).normalize(); o.hL.n.set(0, -1, 0); o.hR.n.set(0, 1, 0);
  o.look.set(1, -0.4 * (1 - k), 0).normalize(); o.lookW = 0.5 * (1 - k); return o; }
// Getting up from where a ragdoll left a figure: its pose there is kept (riseStart) and eased into a crouch with the hands on the road and from
// there onto its feet (riseSync, t seconds in, over the Idle clip; the figure stands at map x, y facing h on ground height z).
function riseStart(vis, rig, R) {
  vis.object.updateMatrixWorld(true); const bones = []; vis.object.traverse((o) => { if (o.isBone) bones.push(o); });
  const hips = rig.B.hips, hw = hips.getWorldPosition(V3()), hq = hips.getWorldQuaternion(new THREE.Quaternion()), head = rig.pos('head', V3());
  // face down he pushes up toward his head; on his back he sits up toward his feet
  const P = R.P, x = V3().copy(P.hpR.p).sub(P.hpL.p), y = V3().copy(P.chest.p).sub(P.hips.p).normalize(), back = V3().crossVectors(x, y).normalize(); let hx = head.x - hw.x, hz = head.z - hw.z; if (back.y < -0.2) { hx = -hx; hz = -hz; }
  return { bones, from: bones.map((o) => o.quaternion.clone()), hw, hq, hips, x: hw.x, y: -hw.z, h: Math.hypot(hx, hz) > 0.05 ? Math.atan2(-hz, hx) : vis.object.rotation.y };
}
function riseSync(U, rig, vis, t, x, y, h, z, pose) {
  const o = vis.object; _e.set(0, h, 0); _cq.setFromEuler(_e); _cm.compose(_v.set(x, z, -y), _cq, ONE);
  applyPose(rig, o, upPose(t, pose, rig), _cm, _cq, 1 - ss(t, 1.0, T_UP - 0.05));
  const k = ss(t, 0, 0.6); if (k < 1) { o.updateMatrixWorld(true);
    // the hips first (their place and attitude in the world), then every other bone against its parent
    const hb = U.hips, par = hb.parent; hb.getWorldPosition(_v); _v.lerpVectors(U.hw, _v, k); par.worldToLocal(_v); hb.position.copy(_v); par.getWorldQuaternion(_q).invert(); _q2.copy(_q).multiply(U.hq); hb.quaternion.copy(_q2.slerp(hb.quaternion, k));
    for (let i = 0; i < U.bones.length; i++) { const bn = U.bones[i]; if (bn === hb) continue; _q.copy(U.from[i]).slerp(bn.quaternion, k); bn.quaternion.copy(_q); }
    rig._hipsMoved = true; o.updateMatrixWorld(true); }
  // nothing of him under the ground on the way up (the eased joints know nothing of the road): the whole body is lifted by what is missing
  let low = 0; for (const [n, m] of LOWB) { const bn = rig.B[n]; if (!bn) continue; const d = bn.getWorldPosition(_v).y - z - m; if (d < low) low = d; }
  if (low < 0) { rig.B.hips.getWorldPosition(_v); _v.y -= low; rig.hips(_v, 1); o.updateMatrixWorld(true); }
}
const LOWB = [['foot_L', 0.07], ['foot_R', 0.07], ['toe_L', 0.03], ['toe_R', 0.03], ['hand_L', 0.04], ['hand_R', 0.04], ['head', 0.1], ['hips', 0.1], ['shin_L', 0.06], ['shin_R', 0.06], ['forearm_L', 0.04], ['forearm_R', 0.04]];
export const POSE = { ride: ridePose, mount: mountPose, lift: liftPose, up: upPose, apply: applyPose, mirror: mirrorPose, make: newPose, mix: mixPose, copy: copyPose, riseStart, riseSync, T_MOUNT, T_LIFT, T_UP };

export function install(game) {
  if (game.moto || (game.P && game.P.get('moto') === '0')) return game.moto || null;
  const g = game, pl = g.player, P = g.P, st = g.statics;
  const M = (g.moto = { on: true, def: DEF, bikes: [], phys: stepBike, tune: TUNE, stats: { mounts: 0, offs: 0, throws: 0, bumps: 0, lifts: 0, getups: 0, deaths: 0, placed: 0, noway: 0 }, errs: {}, fall: null, camK: 0, camRoll: 0, wantOff: false, rig: null, WR: null, model: null, posed: false, pose: newPose(), prev: newPose(), xf: 1, last: null, log: [] });
  M.err = (k, e) => { if (M.errs[k]) return; M.errs[k] = String(e && (e.stack || e.message) || e); console.log('[moto] ' + k + ': ' + M.errs[k]); };
  M.setPhysics = (fn) => { M.phys = fn || stepBike; };
  M.env = { g: 9.81, resolve: (x, y, r, o) => st.resolve(x, y, r, o), onSidewalk: (x, y) => st.onSidewalk(x, y) };
  if (g.kit && g.kit.cars && !g.kit.cars.moto) g.kit.cars.moto = DEF;
  try { if (g.batches && !g.batches.moto) g.batches.moto = { begin() {}, add() {}, end() {} }; } catch (e) {}      // the game's own car drawing (when the streets layer is off) asks for a batch per kind
  const kerb = (x, y) => (st.onSidewalk(x, y) ? 0.15 : 0);
  const toMap = (v, x, z, o) => { const c = Math.cos(v.h), s = Math.sin(v.h); o.x = v.x + c * x + s * z; o.y = v.y + s * x - c * z; return o; };
  const say = (t) => { try { if (M.WR && M.WR.say) M.WR.say(t); } catch (e) {} };
  // the player's point put outside walls and outside every vehicle's body (the boarding lane's boxes)
  const clearSpot = () => { const x0 = pl.x, y0 = pl.y; st.resolve(pl.x, pl.y, 0.34, _o); if (st.raycast(x0, y0, _o.x, _o.y) >= 1) { pl.x = _o.x; pl.y = _o.y; }
    try { const WR = M.WR; if (WR) { const bx = WR.carsNear(g, pl.x, pl.y, 8.5, (M.poolC ||= { boxes: [], pk: [] })).filter((B) => !(B.o && B.o.type === 'moto' && B.o.down)), q = { x: pl.x, y: pl.y };      // (he may stand over a bike that lies on the road)
        if (bx.length && WR.pushOut(bx, q, 0.32)) { st.resolve(q.x, q.y, 0.34, _o, true); const ok = (x, y) => st.raycast(pl.x, pl.y, x, y) >= 1 && !bx.some((B) => WR.depth(B, x, y, 0) > 0);      // never through a wall to get clear of a car
          if (ok(_o.x, _o.y)) { pl.x = _o.x; pl.y = _o.y; } else if (ok(q.x, q.y)) { pl.x = q.x; pl.y = q.y; } } } } catch (e) { M.err('clear', e); } };

  // ------------------------------------------------------------------------------------------------ the bike as one of the game's vehicles
  const _I = { gentleSteer: P.get('motosteer') !== '0', steer: 0, throttle: 0, brake: 0, handbrake: false, rider: false };
  // handover-3 (2a): is no point of the thrown rider in his own lying bike's box any more (or is he past the fall)?
  const riderClear = (v, F) => { const R = F.R; if (!R || F.up || F.dead || F.t > 6) return true; const c = Math.cos(v.h), sn = Math.sin(v.h), hl = DEF_DOWN.len / 2 + 0.04, hw = DEF_DOWN.wid / 2 + 0.04, z = v.z || 0;
    for (const k in R.P) { const a = R.P[k], ex = a.p.x - v.x, ey = -a.p.z - v.y; if (a.p.y < z + DEF_DOWN.hgt + a.r + 0.04 && Math.abs(ex * c + ey * sn) < hl + a.r && Math.abs(-ex * sn + ey * c) < hw + a.r) return false; } return true; };
  // handover-3 (5): the wall at the edge of the map (game.js: the playable box grown by 6 m) is what the bike's last contact was with
  const edgeHit = (v) => { const b = g.bounds; if (!b) return false; const c = Math.cos(v.h), sn = Math.sin(v.h), r = TUNE.wid * 0.5 + 0.3; for (const o of [TUNE.len * 0.3, 0, -TUNE.len * 0.3]) { const ex = v.x + c * o - (b.cx || 0), ey = v.y + sn * o - (b.cy || 0);
      if ((b.x + 6 - Math.abs(ex) < r && v.hitNx * ex < 0 && Math.abs(v.hitNx) > 0.7) || (b.y + 6 - Math.abs(ey) < r && v.hitNy * ey < 0 && Math.abs(v.hitNy) > 0.7)) return true; } return false; };
  // handover-3 (4): does the bike stand or lie in a travel lane? (asked once per place it rests at)
  const inLaneB = (v) => { const R = g.roads; if (!R || !R.inLane || P.get('motolane') === '0') return false; if (v.lnx !== undefined && Math.abs(v.lnx - v.x) < 0.05 && Math.abs(v.lny - v.y) < 0.05) return v.lnIn; const c = Math.cos(v.h), sn = Math.sin(v.h); let r = false;
    for (const k of [0.8, 0, -0.8]) if (!st.onSidewalk(v.x + c * k, v.y + sn * k) && R.inLane(v.x + c * k, v.y + sn * k, 0)) { r = true; break; } v.lnx = v.x; v.lny = v.y; v.lnIn = r; return r; };
  const rests = (v) => { if (!inLaneB(v)) { v.inLane = false; toSlot(v); return; } if (!v.inLane) { v.inLane = true; v.laneT = g.t; M.stats.laneKept = (M.stats.laneKept || 0) + 1; let n = 0, old = null; for (const o of g.vehicles) if (o.moto && o.inLane && o !== pl.vehicle && !o.keep) { n++; if (o !== v && (!old || o.laneT < old.laneT)) old = o; } if (n > LANE_MAX && old) { old.inLane = false; toSlot(old); } } };
  class MotoVehicle extends Vehicle {
    constructor(def, x, y, h, color) { if (!def || def.type !== 'moto') return new Vehicle(def, x, y, h, color);      /* the motion lane's unstick makes a loosed parked car with the constructor of whatever touched it */ super(DEF, x, y, h, color); this.moto = true; this.spec = SPEC; initBike(this); this.restT = 0; this.keep = false; this.pvx = 0; this.pvy = 0; }
    step(dt, inp) {
      const v = this, ridden = pl.vehicle === v; _I.rider = ridden;
      if (ridden) { _I.steer = inp.steer || 0; _I.throttle = inp.throttle || 0; _I.brake = inp.brake || 0; _I.handbrake = !!inp.handbrake; if (M.wantOff) { _I.throttle = 0; _I.steer = 0; _I.brake = v.vf > 0.3 ? 1 : 0; _I.handbrake = true; } }
      else { _I.steer = 0; _I.throttle = 0; _I.brake = 0; _I.handbrake = false; }
      v.pvx = v.vx; v.pvy = v.vy;
      if (!ridden && !v.down && (v.held === null || v.held === undefined) && v.stand < 0.5) v.down = v.lean >= 0 ? 1 : -1;      // nobody holds it and the stand is up: it goes over
      if (!ridden && !v.down && !v.keep && Math.hypot(v.vx, v.vy) > 1.7) { v.down = Math.random() < 0.5 ? 1 : -1; v.stand = 0; }      // knocked by a car
      if (v.loosed && !ridden && !v.down && v.lx !== undefined && Math.hypot(v.x - v.lx, v.y - v.ly) > 0.004) { v.down = Math.random() < 0.5 ? 1 : -1; v.stand = 0; } v.lx = v.x; v.ly = v.y;      // shoved by a car (unstick moves it by hand)
      const Fo = M.fall, own = !!(Fo && Fo.v === v && v.down && !Fo.clearOf); if (own && Fo.t > 0.05 && riderClear(v, Fo)) Fo.clearOf = true;      /* handover-3 (2a) */
      const d = own && !Fo.clearOf ? DEF_OWN : v.down ? DEF_DOWN : DEF; if (v.def !== d) v.def = d;
      try { M.phys(v, dt, _I, M.env); } catch (e) { M.err('phys', e); }
      v.roll = -v.lean;
      if (ridden && v.hit > 2.5) { v.damage += v.hit; v.hitT = 0.35; M.byWall = true; M.atEdge = edgeHit(v); try { g.onCrash(v, v.hit); } finally { M.byWall = false; M.atEdge = false; } }      /* handover-3 (5) */
      v.hitT = Math.max(0, v.hitT - dt);
      if (!ridden && !v.keep && !v.loosed && Math.hypot(v.vx, v.vy) < 0.05 && Math.abs(v.lean - (v.down ? v.down * TUNE.downLean : v.stand * TUNE.standLean)) < 0.03) { v.restT += dt; if (v.restT > 0.35 && !(v.inLane && Math.abs(v.lnx - v.x) < 0.05 && Math.abs(v.lny - v.y) < 0.05)) (M.toRest ||= []).push(v); } else v.restT = 0;
    }
  }
  M.Vehicle = MotoVehicle;

  // ------------------------------------------------------------------------------------------------ bikes that stand (or lie) somewhere: parked slots
  const PK = g.parked;
  function addSlot(x, y, h, color, o = {}) {
    const s = { x, y, h, type: 'moto', def: o.down ? DEF_DOWN : DEF, color, gone: false, circles: [], moto: true, vseed: Math.floor(hash(x, y) * 1e9), lean: o.lean !== undefined ? o.lean : TUNE.standLean, down: o.down || 0, stand: o.down ? 0 : 1, steer: o.steer !== undefined ? o.steer : 0.42, spin: o.spin || 0, zf: o.zf !== undefined ? o.zf : kerb(x, y), zr: o.zr !== undefined ? o.zr : kerb(x, y) };
    const c = Math.cos(h), sn = Math.sin(h);
    if (s.down) { const ox = -sn * 0.45 * s.down, oy = c * 0.45 * s.down; for (const k of [0.62, 0, -0.62]) s.circles.push(st.addCircle(x + c * k + ox, y + sn * k + oy, 0.3, s)); }
    else for (const k of [0.56, -0.56]) s.circles.push(st.addCircle(x + c * k, y + sn * k, 0.2, s));
    PK.slots.push(s); const k = Math.floor(x / 80) + ',' + Math.floor(y / 80); if (!PK.grid.has(k)) PK.grid.set(k, []); PK.grid.get(k).push(s); M.bikes.push(s); M.nearT = 0; return s;
  }
  function dropSlot(s) { PK.take(s); const i = M.bikes.indexOf(s); if (i >= 0) M.bikes.splice(i, 1); M.nearT = 0; }
  function fromSlot(s) { dropSlot(s); const v = new MotoVehicle(DEF, s.x, s.y, s.h, s.color); v.lean = s.lean; v.down = s.down; v.stand = s.stand; v.steer = s.steer; v.spin = s.spin; v.zf = s.zf; v.zr = s.zr; v.z = (s.zf + s.zr) / 2; v.roll = -v.lean; v.vseed = s.vseed; if (v.down) v.def = DEF_DOWN; g.vehicles.push(v); return v; }
  function toSlot(v) { const i = g.vehicles.indexOf(v); if (i >= 0) g.vehicles.splice(i, 1); return addSlot(v.x, v.y, v.h, v.color, { lean: v.lean, down: v.down, steer: v.steer, spin: v.spin, zf: v.zf, zr: v.zr }); }
  M.spawn = (x, y, h, color = PAINTS[0], o) => addSlot(x, y, h, color, o); M.fromSlot = fromSlot; M.toSlot = toSlot;
  // at the kerb among the parked cars: in some of the gaps between two cars of a row, one to three bikes, rear wheel to the kerb. Laid out per
  // 80 m square as the player comes within reach, so both map areas (and parked rows built late) get theirs.
  const RATE = +(P.get('motorate') || 0.3), done = new Set(), tmpN = [];
  function consider(s) {
    if (s.moto || s.gone || s.mission || !s.def || s.def.len > 6.5 || s.def.fixed) return; const h1 = hash(s.x, s.y); if (h1 > RATE) return;
    const c = Math.cos(s.h), sn = Math.sin(s.h); let best = null, bd = 15;
    for (const o of PK.near(s.x + c * 6, s.y + sn * 6, 11, tmpN)) { if (o === s || o.moto || !o.def) continue; const dx = o.x - s.x, dy = o.y - s.y, f = dx * c + dy * sn, l = -dx * sn + dy * c; if (f > 1 && Math.abs(l) < 0.8 && Math.abs(wrapPi(o.h - s.h)) < 0.3 && f < bd) { bd = f; best = o; } }
    if (!best) return; const gap = bd - s.def.len / 2 - best.def.len / 2; if (gap < 1.9) return;
    const mid = s.def.len / 2 + gap / 2, mx = s.x + c * mid, my = s.y + sn * mid, off = s.def.wid / 2 + 1.0;
    const wl = st.onSidewalk(mx - sn * off, my + c * off), wr = st.onSidewalk(mx + sn * off, my - c * off); if (wl === wr) return; const side = wl ? -1 : 1;      // -1: the kerb is on the row's left
    const n = Math.max(1, Math.min(1 + Math.floor(hash(s.y, s.x) * 3), Math.floor((gap - 0.8) / 0.95)));
    for (let i = 0; i < n; i++) { const a = mid + (i - (n - 1) / 2) * 0.95, x = s.x + c * a, y = s.y + sn * a, hb = wrapPi(s.h + side * (1.0 + (hash(x, y) - 0.5) * 0.2));
      if (st.onSidewalk(x, y) || st.resolve(x, y, 0.6, _o) || (g.roads.inLane && g.roads.inLane(x + Math.cos(hb) * 0.95, y + Math.sin(hb) * 0.95, 0.2)) || !g.bounds.in(x, y, -4)) continue;
      addSlot(x, y, hb, PAINTS[Math.floor(hash(x * 3.1, y * 1.7) * PAINTS.length)]).laid = true; M.stats.placed++; }
  }
  function layOut() { const fx = g.focus.x, fy = g.focus.y, i0 = Math.floor((fx - 260) / 80), i1 = Math.floor((fx + 260) / 80), j0 = Math.floor((fy - 260) / 80), j1 = Math.floor((fy + 260) / 80);
    if (M.gridSeen !== PK.grid) { M.gridSeen = PK.grid; for (let i = M.bikes.length - 1; i >= 0; i--) if (M.bikes[i].gone) M.bikes.splice(i, 1);      /* (rows laid afresh take every old slot away, ours with them) */ for (const s of M.bikes) if (!s.gone && !PK.slots.includes(s)) { PK.slots.push(s); const k = Math.floor(s.x / 80) + ',' + Math.floor(s.y / 80); if (!PK.grid.has(k)) PK.grid.set(k, []); PK.grid.get(k).push(s); }
      // ... and may have put cars where there were gaps: a bike we stood in a gap that now has a car in it goes, and every square is looked at again
      for (const s of M.bikes.slice()) { if (!s.laid || s.gone) continue; let hit = false; for (const o of PK.near(s.x, s.y, 7, tmpN)) { if (o.moto || !o.def) continue; const c = Math.cos(o.h), sn = Math.sin(o.h); for (const k of [0.9, 0, -0.9]) { const px = s.x + Math.cos(s.h) * k - o.x, py = s.y + Math.sin(s.h) * k - o.y; if (Math.abs(px * c + py * sn) < o.def.len / 2 + 0.15 && Math.abs(-px * sn + py * c) < o.def.wid / 2 + 0.15) hit = true; } } if (hit) { dropSlot(s); M.stats.placed--; } }
      done.clear(); }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i + ',' + j; if (done.has(k)) continue; const a = PK.grid.get(k); if (!a || !a.some((s) => !s.moto)) continue; done.add(k); for (const s of a.slice()) consider(s); } }
  M.layOut = layOut;
  if (P.has('motoat')) { const a = P.get('motoat').split(',').map(Number); addSlot(a[0], a[1], a[2] || 0, PAINTS[0]); }

  // ------------------------------------------------------------------------------------------------ getting on, getting off
  const rootMat = (v, m, q) => { _e.set(0, v.h, 0); q.setFromEuler(_e); return m.compose(_v.set(v.x, v.z || 0, -v.y), q, ONE); };
  const bikeMat = (v, m, q) => { _e.set(-v.lean, v.h, Math.atan2((v.zf ?? v.z ?? 0) - (v.zr ?? v.z ?? 0), TUNE.wb), 'YZX'); q.setFromEuler(_e); return m.compose(_v.set(v.x, (v.z || 0) + liftOf(v.lean), -v.y), q, ONE); };
  M.bikeMat = bikeMat;
  const groundAt = (v, side) => (x, z) => { const za = z * -side; return kerb(v.x + Math.cos(v.h) * x + Math.sin(v.h) * za, v.y + Math.sin(v.h) * x - Math.cos(v.h) * za) - (v.z || 0); };      // (the pose is laid out for the left side; z is mirrored for the right)
  function sideClear(v, side, d) { toMap(v, X0, side * d, _o2); const x = _o2.x, y = _o2.y; if (st.resolve(x, y, 0.24, _o) > 0 || st.raycast(v.x, v.y, x, y) < 1) return false;
    const WR = M.WR; if (WR) for (const B of WR.carsNear(g, x, y, 9, (M.poolS ||= { boxes: [], pk: [] }), v)) if (!(Math.abs(B.o.v || 0) > 1) && WR.depth(B, x, y, WR.TIGHT) > 0) return false; return true; }
  // the way on foot to the spot beside the bike: outside every body, clear of walls (the boarding lane's planner)
  function wayTo(v, side, d) {
    const T = toMap(v, X0, side * d, {}), WR = M.WR; if (!WR) return { pts: [{ x: pl.x, y: pl.y }, T], len: Math.hypot(T.x - pl.x, T.y - pl.y), T };
    const boxes = WR.carsNear(g, v.x, v.y, 17, (M.poolW ||= { boxes: [], pk: [] })); let own = boxes.find((B) => B.o === v); if (!own) boxes.push((own = WR.carBox(v)));
    const ownPad = Math.max(0.03, Math.min(WR.TIGHT, WR.gap(own, T.x, T.y) - 0.06));
    const mk = (pad) => (x, y) => { const near = (x - T.x) * (x - T.x) + (y - T.y) * (y - T.y) < 0.36;
      for (let i = 0; i < boxes.length; i++) { const B = boxes[i]; if (WR.depth(B, x, y, B === own ? Math.min(pad, ownPad) : near ? Math.min(pad, WR.TIGHT) : pad) > 0) return true; }
      return st.resolve(x, y, WR.BODY_R, _o2, near) > 0; };
    if (mk(WR.TIGHT)(T.x, T.y)) return null; const w = WR.planBest(pl.x, pl.y, T.x, T.y, mk); if (!w || w.len > 34) return null; w.T = T; w.ownPad = ownPad; return w;
  }
  function beginMount(n) {
    let v = n.kind === 'slot' ? fromSlot(n.s) : n.v; const made = n.kind === 'slot';
    const pref = v.down ? -v.down : -1, d = v.down ? LIFT_D : SIDE_D; let way = null, side = pref;      // a bike that fell to its left (down +1) is stood up from its left
    for (const sd of v.down ? [pref] : [pref, -pref]) { way = wayTo(v, sd, d); if (way) { side = sd; break; } }
    if (!way) { M.stats.noway++; say(v.down ? 'No room to pick the bike up' : 'No way round to the bike'); if (made) toSlot(v); return false; }
    v.keep = true; v.restT = 0;
    pl.busy = { moto: true, kind: 'in', v, t: 0, z: kerb(pl.x, pl.y), phase: 'walk', path: way.pts.length > 1 ? way.pts.slice(1) : way.pts.slice(-1), wp: 0, side, d, u: 0, k: 0, w: 0, still: false, pp: { t: 0, n: 0, stall: 0, best: 1e9, own: way.ownPad || 0.1 }, lifted: false, h0: pl.h };
    M.last = v; return true;
  }
  function cancel(b) { pl.busy = null; if (b.v) { b.v.keep = false; if (!b.v.down && b.v.stand < 0.5 && Math.abs(b.v.lean) < 0.1) { b.v.stand = 1; b.v.held = null; } } M.release(); try { g.playerAnim('idle'); } catch (e) {} }
  function walk(dt, b) {
    const v = b.v, I = g.input, vis = pl.vis, WR = M.WR, pp = b.pp, moving = Math.hypot(I.mx, I.my) > 0.3; if (!moving) b.still = true; else if (b.still && !g.demo) { cancel(b); return; }
    if (b.t > 14) { cancel(b); return; }
    b.z += (kerb(pl.x, pl.y) - b.z) * Math.min(1, dt * 9); pp.t += dt;
    const near = () => { if (!WR) return []; const a = WR.carsNear(g, pl.x, pl.y, 9.5, (M.poolF ||= { boxes: [], pk: [] })); for (const B of a) if (B.o === v) B.pad = pp.own; return a; };
    let boxes = near();
    if (pp.dirty) { pp.dirty = false; pp.n++; const w = wayTo(v, b.side, b.d); if (w) { b.path = w.pts.length > 1 ? w.pts.slice(1) : w.pts.slice(-1); b.wp = 0; pp.best = 1e9; pp.stall = 0; } else if (pp.n > 6) { say('No way round to the bike'); cancel(b); return; } }
    const wp = b.path[b.wp], dx = wp.x - pl.x, dy = wp.y - pl.y, d = Math.hypot(dx, dy), last = b.wp === b.path.length - 1;
    let rest = d; for (let i = b.wp; i < b.path.length - 1; i++) rest += Math.hypot(b.path[i + 1].x - b.path[i].x, b.path[i + 1].y - b.path[i].y);
    const sp = Math.min(rest > 4.5 ? 3.4 : 1.9, Math.max(0.7, rest * 3.2)), stepLen = sp * dt;
    const arrive = () => { b.phase = b.jack ? 'jack' : v.down ? 'lift' : 'mount'; b.u = 0; b.k = 0; b.w = 0; b.h0 = pl.h; pl.speed = 0; try { g.playerAnim('idle'); if (vis.mixer) vis.mixer.timeScale = 1; } catch (e) {} if (v.down) { v.held = v.lean; v.down = 0; v.def = DEF; M.stats.lifts++; } else v.held = v.lean; };
    if (d <= Math.max(stepLen, last ? 0.03 : 0.1)) { if (last) { pl.x = wp.x; pl.y = wp.y; arrive(); } else b.wp++; return; }
    const want = Math.atan2(dy, dx); pl.h += wrapPi(want - pl.h) * Math.min(1, dt * 11);
    st.resolve(pl.x + dx / d * stepLen, pl.y + dy / d * stepLen, 0.25, _o2, last && d < 0.6); _pp.x = _o2.x; _pp.y = _o2.y; if (WR && boxes.length) WR.pushOut(boxes, _pp, 0.2); pl.x = _pp.x; pl.y = _pp.y;
    if (rest < pp.best - 0.004) { pp.best = rest; pp.stall = 0; } else if ((pp.stall += dt) > 0.45) { if (last && d < 0.5) { arrive(); return; } pp.stall = 0; pp.dirty = true; }
    const wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 };
    pl.speed = sp; try { g.playerAnim(sp > 3 ? (vis.acts.jog ? 'jog' : 'run') : wk.name); if (vis.mixer) vis.mixer.timeScale = sp > 3 ? sp / (vis.acts.jog ? ((g.kit.clipSpeed && g.kit.clipSpeed.jog) || 2.6) * ((g.kit.tall && g.kit.tall.player) || 1) : vis.runSpeed || 5) : sp / wk.speed; } catch (e) {}
  }
  // the standing-side pose for this moment, in the bike's upright frame (mirrored for the right side)
  function sidePose(b, o) { const v = b.v, gy = groundAt(v, b.side); let vv = v; if (b.side > 0) vv = M._mv = Object.assign(M._mv || {}, { lean: -v.lean, steer: -(v.steer || 0) });
    if (b.phase === 'lift') liftPose(b.k, vv, M.rig, gy, o); else mountPose(b.phase === 'jack' ? 0.42 : b.u, vv, M.rig, gy, o); if (b.side > 0) mirrorPose(o); if (b.phase === 'jack' && M.jack) M.jack.pose(b, o); return o; }
  function cue(a, b, t) { return a < t && b >= t; }
  function fadeClip(to) { const vis = pl.vis; try { if (vis.mixer && vis.acts[to] && vis.cur !== to) { if (vis.cur && vis.acts[vis.cur]) vis.acts[vis.cur].fadeOut(0.45); vis.acts[to].reset().fadeIn(0.45).play(); vis.cur = to; vis.mixer.timeScale = 1; } } catch (e) {} }
  function stepBusy(dt, b) {
    const v = b.v; b.t += dt; pl.speed = 0;
    if (b.kind === 'fall') return stepFall(dt, b); if (b.kind === 'getup') return stepUp(dt, b);
    if (b.kind === 'in' && b.phase === 'walk') return walk(dt, b);
    b.w = Math.min(1, b.w + dt / 0.26); const pace = 1.12;
    if (b.phase === 'jack') { if (!M.jack || M.jack.step(dt, b)) { b.phase = 'mount'; b.u = 0.42; b.lifted = true; v.held = TUNE.footLean; } }
    else if (b.phase === 'lift') { b.k += dt / T_LIFT; v.held = -b.side * TUNE.downLean * (1 - ss(b.k, 0.3, 0.95)); if (b.k >= 1) { b.phase = 'mount'; b.u = 0.42; b.lifted = true; v.held = 0; } }
    else if (b.kind === 'in') { const u0 = b.u; b.u += dt * pace;
      v.held = b.lifted ? TUNE.footLean * ss(b.u, 1.3, 1.7) : lerp(TUNE.standLean, TUNE.footLean * ss(b.u, 1.3, 1.7), ss(b.u, 0.3, 0.72)); v.stand = b.lifted ? 0 : 1 - ss(b.u, 1.45, 1.62);
      if (cue(u0, b.u, 1.0)) fadeClip('drive'); if (cue(u0, b.u, 1.5) && !b.lifted) M.snd('stand'); if (cue(u0, b.u, 1.68)) M.snd('start');
      M.camK = ss(b.u, 0.8, T_MOUNT);
      if (b.u >= T_MOUNT) return finishMount(b); }
    else { const u0 = b.u; b.u -= dt * pace * 1.1;
      v.held = lerp(TUNE.standLean, TUNE.footLean * ss(b.u, 1.3, 1.7), ss(b.u, 0.3, 0.72)); v.stand = 1 - ss(b.u, 1.45, 1.62);
      if (cue(b.u, u0, 1.0)) fadeClip('idle'); if (cue(b.u, u0, 1.55)) M.snd('stand');
      M.camK = ss(b.u, 0.8, T_MOUNT);
      if (b.u <= 0) return finishOff(b); }
    // the game's idea of where he is follows his hips
    const o = sidePose(b, M.pose); toMap(v, o.hip.x, o.hip.z, _o2); pl.x = lerp(pl.x, _o2.x, b.w); pl.y = lerp(pl.y, _o2.y, b.w); pl.h = b.w < 1 && b.kind === 'in' ? b.h0 + wrapPi(v.h + o.yaw - b.h0) * b.w : v.h + o.yaw; b.z = kerb(pl.x, pl.y);
    if (g.cam.pitch < 0.04 && M.camK > 0) g.cam.pitch += (0.04 - g.cam.pitch) * Math.min(1, dt * 4);
  }
  function finishMount(b) {
    const v = b.v, s = g.sound, door0 = s.door; v.held = null; v.stand = 0; v.keep = false; M.stats.mounts++; M.camK = 1; M.wantOff = false;
    copyPose(M.pose, M.prev); M.prevFrame = 'up'; M.xf = 0; s.door = () => {}; try { g.finishEnter(v); } finally { s.door = door0; }
    g.cam.pitch = Math.max(g.cam.pitch, 0.04);
  }
  function beginOff(v) {
    if (Math.hypot(v.vx, v.vy) > 0.35) { if (!M.wantOff) M.offThr = g.input.throttle > 0.2; M.wantOff = true; return; } M.wantOff = false;      /* handover-3 (1): F with W still held: the pedal held at that moment does not call the dismount off (it did, in the same step: F did nothing below 15 km/h with W down); a NEW press of W does */
    let side = 0; for (const sd of [-1, 1]) if (sideClear(v, sd, SIDE_D)) { side = sd; break; } if (!side) { say('No room to get off here'); return; }
    pl.vehicle = null; g.cam.mode = 'foot'; g.cam.pitch = Math.max(g.cam.pitch, 0.04); v.vx = v.vy = 0; v.held = v.lean; v.keep = true; try { g.missions.onExit(v); } catch (e) {}
    pl.busy = { moto: true, kind: 'out', v, t: 0, z: 0, phase: 'mount', side, u: T_MOUNT, w: 1, k: 0, lifted: false, h0: pl.h }; M.camK = 1;
    ridePose(v, M.prev, M.rig, 0); M.prevFrame = 'bike'; M.xf = 0; M.snd('stop');
  }
  function finishOff(b) { const v = b.v; pl.busy = null; v.keep = false; v.held = null; v.stand = 1; v.lean = TUNE.standLean; M.stats.offs++; M.camK = 0; M.release(); try { g.playerAnim('idle'); } catch (e) {} if (!v.loosed) rests(v); st.resolve(pl.x, pl.y, 0.3, _o); pl.x = _o.x; pl.y = _o.y; }
  M.release = () => { const r = M.rig; if (r && M.posed) { r.restHips(); r.curl('L', 0); r.curl('R', 0); } M.posed = false; };

  // ------------------------------------------------------------------------------------------------ crashes: thrown, hurt, up again
  // The game reports a crash of the player's vehicle (a wall or a pole from the physics; a car from collideCars) with the closing speed. Above
  // TUNE.throw (into something) or TUNE.ram (struck by something that was moving at him) the rider leaves the bike.
  function crashed(v, f) {
    if (M.fall || pl.vehicle !== v) return; const mine = Math.hypot(v.pvx, v.pvy), who = M.byWall ? 1 : clamp(mine / Math.max(f, 0.1), 0, 1), thr = lerp(TUNE.ram, TUNE.throw, who);
    if (f < thr || M.atEdge) { M.stats.bumps++; if (M.atEdge && f >= thr) M.stats.edgeStops = (M.stats.edgeStops || 0) + 1; M.log.push([M.atEdge ? 'edge' : 'bump', +f.toFixed(1), +g.t.toFixed(2)]); return; }      /* handover-3 (5): the edge of the map stops him, it does not throw him */
    M.pend = { v, f, who, wall: !!M.byWall, nx: v.hitNx || 0, ny: v.hitNy || 0 };
  }
  function throwRider(v, f, who) {
    if (M.fall || pl.vehicle !== v) return; const dvx = v.vx - v.pvx, dvy = v.vy - v.pvy, ux = v.pvx * 0.92 + dvx * 0.9 * (1 - who), uy = v.pvy * 0.92 + dvy * 0.9 * (1 - who);
    M.stats.throws++; M.wantOff = false; M.log.push(['throw', +f.toFixed(1), +g.t.toFixed(2), +who.toFixed(2)]);
    const B = M.bailAt || null, hp = B ? V3(B.x, B.z, -B.y) : M.rig ? M.rig.pos('hips', V3()) : V3(v.x, 0.9, -v.y);      /* board/car bail */
    pl.vehicle = null; g.cam.mode = 'foot'; g.cam.pitch = Math.max(g.cam.pitch, 0.04); try { g.missions.onExit(v); } catch (e) {}
    if (v.moto) { v.down = v.lean > 0.04 ? 1 : v.lean < -0.04 ? -1 : Math.random() < 0.5 ? 1 : -1; v.held = null; v.stand = 0; v.keep = false; v.yawV += (Math.random() - 0.5) * 3.5; if (M.wallN) { const rb = clamp(1.5 + f * 0.25, 3, 6); v.vx += M.wallN.nx * rb; v.vy += M.wallN.ny * rb; }      /* handover-3 (2d): off a wall the bike comes back 0.8-3 m, so he does not come down in it */ else if (who > 0.6) { v.vx += v.pvx * 0.25; v.vy += v.pvy * 0.25; } v.def = DEF_OWN; M.snd('scrape'); }      /* board/car bail: a car he jumps out of is not laid down */
    const dmg = clamp((f - 6) * 4.2, 3, 400), F = (M.fall = { t: 0, v, f, dmg, lethal: false, killed: false, R: null, fake: null, rest: 0, x: hp.x, y: -hp.z });
    pl.x = F.x; pl.y = F.y; pl.busy = { moto: true, kind: 'fall', v, t: 0, z: kerb(pl.x, pl.y) }; M.camK = 0;
    const so = M.bailOff && v.moto ? 2.2 * v.down : 0;      /* handover-3 (2c): F off a moving bike: he goes to the side it does not fall to (down +1 = on its left: he goes right) */
    try { startDoll(F, ux + (B ? B.px : Math.sin(v.h) * so), uy + (B ? B.py : -Math.cos(v.h) * so), f, hp); } catch (e) { M.err('doll', e); }
    const c = g.combat; if (c && typeof c.hurt === 'function' && typeof c.health === 'number' && !c.dead) { try { const h0 = c.health; if (dmg >= h0) { F.lethal = true; c.hurt(Math.max(0, h0 - 1)); } else c.hurt(dmg); F.hurt = h0 - c.health; } catch (e) { M.err('hurt', e); } }
    g.cam.shake = Math.min(1, g.cam.shake + 0.3 + f * 0.02);
  }
  // board/car bail (entry.js): F at speed. The rider leaves v as if thrown, at v's own speed; true if he did.
  M.bail = (v, f, at) => { if (M.fall || pl.vehicle !== v || g.P.get('ebail') === '0') return false; v.pvx = v.vx; v.pvy = v.vy; M.byWall = false; M.bailAt = at || null; M.bailOff = !at && !!v.moto; try { throwRider(v, f, 0); } finally { M.bailAt = null; M.bailOff = false; } if (M.fall) M.stats.bails = (M.stats.bails || 0) + 1; return !!M.fall; };
  // the lead's pedhit ragdoll (with its wall sweep) has one way in, game.onPedHit(person, car), answered only for the player's own car. The
  // rider is handed to it as the guns lane hands a shot person: a stand-in 'car' (marked .bullet, which the police code skips) for that one call.
  function startDoll(F, ux, uy, f, hp) {
    const PH = g.__pedhit, vis = pl.vis; if (!PH || !PH.on || !vis || !vis.mixer || !M.rig) return;
    const sp = Math.hypot(ux, uy) || 1e-3, dx = ux / sp, dy = uy / sp, fake = { vis, x: F.x, y: F.y, h: pl.h, state: 'down', t: 0, fall: 0, vx: 0, vy: 0, kind: 'player', isPlayer: true, hp: 100, scale: 1 };
    const sv = { x: F.x - dx * 2.6, y: F.y - dy * 2.6, h: Math.atan2(dy, dx), vx: ux, vy: uy, def: { len: 4.6, wid: 1.9, hgt: 1.4 }, bullet: true, moto: false };
    const last0 = PH.list[PH.list.length - 1], shake = g.cam.shake, mo = g.missions.onPedHit, th = g.sound.thud; g.missions.onPedHit = () => {}; g.sound.thud = () => {};
    pl.vehicle = sv; try { g.onPedHit(fake, sv); } finally { pl.vehicle = null; g.missions.onPedHit = mo; g.sound.thud = th; }
    PH.hitstop = 0; g.cam.shake = shake; const R = PH.list[PH.list.length - 1]; if (!R || R === last0 || !R.fig || R.fig.ped !== fake) return;
    // he leaves the bike at the speed it had, head first: the upper body a little faster than the feet, and up a little
    const up = M.bailAt ? 0.5 : M.bailOff ? 0.7 : clamp(0.8 + f * 0.07, 1.0, 2.0), g0 = kerb(F.x, F.y);      /* handover-3 (2): was 1.0 + 0.13 f up to 4.0 */      /* board/car bail: out of a car door he drops, he is not thrown up (seen: 4.3 m up at 100 km/h) */
    for (const k in R.P) { const a = R.P[k], hg = clamp((a.p.y - g0) / 1.5, 0, 1), kk = 0.84 + 0.3 * hg, jx = (Math.random() - 0.5) * 0.8, jz = (Math.random() - 0.5) * 0.8; a.q.set(a.p.x - (ux * kk + jx) * SUB, a.p.y - up * (0.7 + 0.6 * hg) * SUB, a.p.z - (-uy * kk + jz) * SUB); }
    F.R = R; F.fake = fake;
  }
  function slideOff(R) { const hp = R.P.hips.p, x = hp.x, y = -hp.z; let dx = 0, dy = 0, bd = 9; const see = (o) => { if (!o || !o.def || o.type === 'moto' || o.gone) return; const c = Math.cos(o.h), s = Math.sin(o.h), ex = x - o.x, ey = y - o.y, f = ex * c + ey * s, l = -ex * s + ey * c; if (Math.abs(f) > o.def.len / 2 + 0.4 || Math.abs(l) > o.def.wid / 2 + 0.4) return; const d = Math.hypot(ex, ey); if (d < bd) { bd = d; const sg = l >= 0 ? 1 : -1; dx = -s * sg; dy = c * sg; } };
    for (const o of g.vehicles) see(o); for (const o of g.traffic.cars) see(o); for (const o of PK.near(x, y, 8, tmpN)) see(o); if (bd > 8) { dx = Math.cos(pl.h + 1.57); dy = Math.sin(pl.h + 1.57); }
    if (st.raycast(x, y, x + dx * 2.6, y + dy * 2.6) < 1) { dx = -dx; dy = -dy; }      // not toward a wall
    R.frozen = false; R.rest = 0; for (const k in R.P) { const a = R.P[k]; a.q.set(a.p.x - dx * 2.6 * SUB, a.p.y - 1.1 * SUB, a.p.z + dy * 2.6 * SUB); } }
  // once the heat body runs, a death while he is in the air or lying must not make a second body of the same figure
  function wrapDie() { const H = g.combat && g.combat.heat; if (!H || typeof H.die !== 'function' || H.__motoDie) return H && H.__motoDie ? H : null; const die0 = H.die.bind(H); H.__motoDie = true;
    H.die = function () { if (!M.fall || !M.fall.R) return die0(); const c = g.combat, b = c.bodies, ph = g.__pedhit; c.bodies = null; g.__pedhit = null; try { die0(); } finally { c.bodies = b; g.__pedhit = ph; } M.fall.dead = true; M.stats.deaths++; }; return H; }
  function stepFall(dt, b) {
    const F = M.fall; if (!F) { pl.busy = null; return; } F.t += dt; const R = F.R;
    /* handover-3 (3): the police body, fetched on the first hurt of a session, never heard of that hurt and gave the health back at once */ if (F.hurt && !F.heatT) { const H = g.combat && g.combat.heat; if (H && typeof H.lastHurtT === 'number' && typeof H.t === 'number') { F.heatT = true; if (H.lastHurtT < H.t - F.t - 0.5) H.lastHurtT = H.t - F.t; } }
    if (R) { const hp = R.P.hips.p, sp = Math.hypot(hp.x - F.x, -hp.z - F.y) / Math.max(dt, 1e-4); F.x = hp.x; F.y = -hp.z; pl.x = F.x; pl.y = F.y; b.z = kerb(pl.x, pl.y); F.rest = sp < 0.35 && hp.y < b.z + 0.75 ? F.rest + dt : 0; if (F.fake) F.fake.t = 0; }
    else F.rest += dt;
    // come to rest ON a car (bonnet, roof): he slides off it before anything else, so that he never gets up through its body
    if (R && F.t > 2.2 && (F.shoves || 0) < 4 && R.P.hips.p.y > b.z + 0.62 && Math.hypot(R.P.hips.p.x - (F.lx ?? 1e9), R.P.hips.p.z - (F.lz ?? 1e9)) < 0.02) { F.still = (F.still || 0) + dt; if (F.still > 0.35) { F.still = 0; F.shoves = (F.shoves || 0) + 1; slideOff(R); } } else F.still = 0;
    if (R) { F.lx = R.P.hips.p.x; F.lz = R.P.hips.p.z; }
    if (F.lethal && !F.killed && (F.rest > 0.3 || F.t > 3.4)) { F.killed = true; const H = wrapDie(), c = g.combat; try { c.hurt(999); if (c.health > 0) c.health = 0; } catch (e) { M.err('kill', e); } if (!H) F.lethal = false; return; }
    if (F.killed) { if (F.t > 9 && !F.dead) { F.lethal = false; F.killed = false; } return; }      // (no police code to take him to the clinic: he gets up after all)
    if ((F.rest > 0.9 && F.t > 1.7) || F.t > 7) startUp(b);
  }
  // Getting up: the body as the ragdoll left it is eased into a crouch (hands on the road) and from there onto its feet.
  function startUp(b) {
    const F = M.fall, R = F.R, vis = pl.vis, rig = M.rig; b.kind = 'getup'; b.t = 0; M.stats.getups++;
    if (!R || !rig) { F.up = null; return; }
    const U = (F.up = riseStart(vis, rig, R)); if (F.fake) F.fake.state = 'gone'; pl.x = U.x; pl.y = U.y; pl.h = U.h; clearSpot(); b.z = kerb(pl.x, pl.y);
    try { vis.mixer.stopAllAction(); vis.mixer.timeScale = 1; vis.acts.idle.reset().setEffectiveWeight(1).play(); vis.cur = 'idle'; } catch (e) {}
  }
  function stepUp(dt, b) { if (b.t >= T_UP || !M.fall || !M.fall.up) { if (b.t >= (M.fall && M.fall.up ? T_UP : 0.9)) endFall(); } }
  function endFall() { const F = M.fall; M.fall = null; if (pl.busy && pl.busy.moto) pl.busy = null; M.release(); if (F && F.fake) F.fake.state = 'gone'; clearSpot(); try { g.playerAnim('idle'); } catch (e) {} }
  function syncUp(b) { const F = M.fall, U = F && F.up; if (!U || !M.rig) return; riseSync(U, M.rig, pl.vis, b.t, pl.x, pl.y, pl.h, b.z, M.pose); M.posed = true; }
  // after a death the police code wakes him at the clinic: the figure is given back whole
  function afterDeath() { const F = M.fall, H = g.combat && g.combat.heat, D = H && H.dead; if (!F || !F.dead) return;
    if (D && !D.woke) { if (F.R) { pl.x = F.R.P.hips.p.x; pl.y = -F.R.P.hips.p.z; } return; }
    const vis = pl.vis; if (F.fake) F.fake.state = 'gone'; M.fall = null; try { if (M.rig) { M.rig._hipsMoved = true; M.rig.restHips(); } if (vis.mixer) { vis.mixer.timeScale = 1; vis.mixer.stopAllAction(); } vis.cur = null; g.playerAnim('idle'); } catch (e) {} }

  // ------------------------------------------------------------------------------------------------ the hooks
  const near0 = g.nearestCar.bind(g); g.nearestCar = function (d) { if (M.fall || (pl.busy && pl.busy.moto)) return (M.near = null); return (M.near = near0(d)); };
  const te0 = g.tryEnter.bind(g);
  g.tryEnter = function () {
    if (M.fall || (pl.busy && pl.busy.moto)) return false; if (pl.busy) return te0();
    let n = null; try { n = g.nearestCar(); } catch (e) {} const o = n && (n.v || n.s || n.c); if (!o || o.type !== 'moto') return te0();
    if (n.kind === 'traffic') { try { return M.jack ? M.jack.begin(n.c) : false; } catch (e) { M.err('jack', e); pl.busy = null; return false; } }
    try { return beginMount(n); } catch (e) { M.err('mount', e); pl.busy = null; return false; }
  };
  const ex0 = g.exitVehicle.bind(g); g.exitVehicle = function () { const v = pl.vehicle; if (!v) return; if (!v.moto) return ex0(); try { beginOff(v); } catch (e) { M.err('off', e); } };
  const sb0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const b = pl.busy; if (b && b.moto) { try { stepBusy(dt, b); } catch (e) { M.err('busy', e); if (pl.busy === b) pl.busy = null; M.fall = null; } } else sb0(dt); };
  if (typeof g.onCrash === 'function') { const cr0 = g.onCrash.bind(g); g.onCrash = function (v, f) { const r = cr0(v, f); try { if (v && v.moto) crashed(v, f); } catch (e) { M.err('crash', e); } return r; }; }
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    step0(dt);
    try {
      /* handover-3 (1): F at 11-15 km/h on a bike = the calm dismount (it did nothing) */ if (g.entry && typeof g.entry.bail === 'function' && !g.entry.__motoGap) { const E = g.entry, b0 = E.bail; E.__motoGap = true; E.bail = function (v) { if (v && v.moto && pl.vehicle === v && !pl.busy && Math.hypot(v.vx, v.vy) <= 4.2) { M.stats.slowOff = (M.stats.slowOff || 0) + 1; try { beginOff(v); } catch (e) { M.err('off', e); } return false; } return b0.call(E, v); }; }
      if (M.pend) { const p = M.pend; M.pend = null; M.wallN = p.wall ? p : null; try { throwRider(p.v, p.f, p.who); } finally { M.wallN = null; } }
      if (M.toRest) { for (const v of M.toRest) if (g.vehicles.includes(v) && pl.vehicle !== v && !v.keep && !v.loosed) rests(v); M.toRest = null; }      /* handover-3 (4): not a parked slot while it is in a travel lane */
      const v = pl.vehicle;
      if (M.wantOff) { if (g.input.throttle <= 0.2) M.offThr = false; if (!v || !v.moto || (g.input.throttle > 0.2 && !M.offThr)) M.wantOff = false; else if (Math.hypot(v.vx, v.vy) < 0.3) beginOff(v); }
      if (M.xf < 1) M.xf = Math.min(1, M.xf + dt / 0.3);
      if (M.fall) { wrapDie(); if (M.fall.dead) afterDeath(); else if (!pl.busy || !pl.busy.moto) { const H = g.combat && g.combat.heat; if (H && H.dead) { M.fall.dead = true; M.stats.deaths++; } else pl.busy = { moto: true, kind: M.fall.up ? 'getup' : 'fall', v: M.fall.v, t: M.fall.up ? T_UP : 0, z: kerb(pl.x, pl.y) }; } }
      if (!v && !pl.busy && M.camK > 0) M.camK = Math.max(0, M.camK - dt * 2.5);
      for (let i = 0; i < g.vehicles.length; i++) { const o = g.vehicles[i]; if (o.type === 'moto' && !o.moto) { const s = o.loosed, n = new MotoVehicle(DEF, o.x, o.y, o.h, o.color); n.loosed = s; n.vx = o.vx; n.vy = o.vy; if (s && s.moto) { n.lean = s.lean; n.down = s.down; n.stand = s.stand; n.steer = s.steer; const j = M.bikes.indexOf(s); if (j >= 0) M.bikes.splice(j, 1); M.nearT = 0; } else n.stand = 1; g.vehicles[i] = n; } }
      M.parkT = (M.parkT || 0) - dt; if (M.parkT <= 0) { M.parkT = 0.7; layOut(); }
    } catch (e) { M.err('step', e); }
  };
  const sv0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) {
    sv0(dt);
    try {
      if (M.model) draw(dt);
      const rig = M.rig, b = pl.busy, v = pl.vehicle, o = pl.vis.object; if (!rig) return;
      if (v && v.moto && o.visible) { const p = ridePose(v, M.pose, rig, kerb(v.x - Math.sin(v.h) * 0.46, v.y + Math.cos(v.h) * 0.46) - (v.z || 0)); bikeMat(v, _cm, _cq);
        if (M.xf < 1) { if (M.prevFrame === 'up') { rootMat(v, _mt, _q2); toFrame(M.prev, _mt, _cm); M.prevFrame = 'bike'; } mixPose(M.prev, p, ss(M.xf, 0, 1)); }
        applyPose(rig, o, p, _cm, _cq, 1); M.posed = true; }
      else if (b && b.moto && (b.kind === 'out' || (b.kind === 'in' && b.phase !== 'walk'))) { const bv = b.v, p = sidePose(b, M.pose); rootMat(bv, _cm, _cq);
        if (M.xf < 1 && b.kind === 'out') { if (M.prevFrame === 'bike') { bikeMat(bv, _mt, _q2); toFrame(M.prev, _mt, _cm); M.prevFrame = 'up'; } mixPose(M.prev, p, ss(M.xf, 0, 1)); }
        if (b.w < 1 && b.kind === 'in') p.yaw = wrapPi(b.h0 - bv.h) + wrapPi(p.yaw - wrapPi(b.h0 - bv.h)) * b.w;
        applyPose(rig, o, p, _cm, _cq, b.kind === 'in' ? b.w : 1); M.posed = true; }
      else if (b && b.moto && b.kind === 'getup') syncUp(b);
      else if (M.posed && !M.fall) M.release();
    } catch (e) { M.err('sync', e); }
  };
  // a pose given in frame A, re-expressed in frame B (positions and directions)
  const _ma = new THREE.Matrix4();
  function toFrame(p, A, B) { _ma.copy(B).invert().multiply(A); for (const k of ['hip', 'fL', 'fR']) p[k].applyMatrix4(_ma); p.look.transformDirection(_ma); for (const h of [p.hL, p.hR]) { h.p.applyMatrix4(_ma); h.f.transformDirection(_ma); h.n.transformDirection(_ma); } p.rootY = 0; }

  // ------------------------------------------------------------------------------------------------ camera: lower, closer, rolling with the lean
  const tgt0 = g.camTarget.bind(g);
  g.camTarget = function () {
    const t = tgt0(), v = pl.vehicle && pl.vehicle.moto ? pl.vehicle : pl.busy && pl.busy.moto && pl.busy.v && (pl.busy.kind === 'in' || pl.busy.kind === 'out') ? pl.busy.v : null;
    if (M.fall) { t.z = (pl.busy ? pl.busy.z || 0 : 0) + 0.9; t.dist = 4.8; t.height = 0.7; t.auto = 0; return t; }
    if (!v) return t; const k = pl.vehicle === v ? 1 : M.camK, sp = Math.hypot(v.vx, v.vy);
    const bk = { x: v.x, y: v.y, z: v.z + 0.98, dist: 4.3 + sp * 0.036, height: 0.82, fov: 56 + clamp(sp / 45, 0, 1) * 17, yaw: v.h - v.yawV * 0.1, auto: 3.4 + sp * 0.12 };
    if (k >= 1) return bk;
    t.x = lerp(pl.x, bk.x, k); t.y = lerp(pl.y, bk.y, k); t.z = lerp((pl.busy ? pl.busy.z || 0 : 0) + 1.3, bk.z, k); t.dist = lerp(4.2, bk.dist, k); t.height = lerp(0.45, bk.height, k); t.fov = lerp(52, bk.fov, k); t.auto = 0; return t;
  };
  const place0 = g.placeCamera.bind(g);
  g.placeCamera = function (dt) {
    place0(dt);
    try { const C = g.cam, cam = g.world.camera, v = pl.vehicle && pl.vehicle.moto ? pl.vehicle : null; if ((g.fly && g.fly.on) || (g.heli && g.heli.hasCamera)) return;
      if (!v && M.camK > 0.001 && !pl.vehicle) { const ahead = 2.2 * M.camK * M.camK; cam.lookAt(C.tx + Math.cos(C.yaw) * ahead, C.tz + lerp(0.15, 0.1, M.camK), -(C.ty + Math.sin(C.yaw) * ahead)); }
      const want = v ? clamp(v.lean, -0.9, 0.9) * 0.2 : 0; M.camRoll += (want - M.camRoll) * Math.min(1, (dt || 0.016) * 6); if (Math.abs(M.camRoll) > 0.0005) { cam.rotateZ(M.camRoll); cam.updateMatrixWorld(); }
    } catch (e) { M.err('cam', e); }
  };

  // ------------------------------------------------------------------------------------------------ small things: prompt, sound
  if (g.hud && typeof g.hud.text === 'function') { const tx0 = g.hud.text.bind(g.hud); g.hud.text = function (s, ...a) { if (s === 'Get in' && M.near) { const o = M.near.v || M.near.s || M.near.c; if (o && o.type === 'moto') s = o.down ? 'Pick up' : 'Get on'; } return tx0(s, ...a); }; }
  // shot while riding: there is no body to sit behind. A police round that reaches the bike hits the rider.
  { const c = g.combat; if (c && typeof c.hit === 'function' && typeof c.hurt === 'function') { const hit0 = c.hit.bind(c); M.stats.shot = 0;
      c.hit = function (h, W, first) { const v = pl.vehicle; if (h && h.kind === 'car' && v && v.moto && h.obj === v && !M.fall && c.heat && c.heat.copFire) { M.stats.shot++; try { if (c.fx && c.fx.impact) c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(h.nx || 0, 0, -(h.ny || 0)), 'flesh', { power: 0.8 }); } catch (e) {} c.hurt(((W && W.dmg) || 10) * 0.6); return 'ped'; } return hit0(h, W, first); }; } }
  M.snd = (k) => { const s = g.sound; if (!s || !s.on) return; try {
    if (k === 'stand') { s.shot(1400, 0.035, 'square', 0.05); s.burst(0.04, 0.12, 2400); }
    else if (k === 'start') { s.burst(0.28, 0.2, 500); s.shot(64, 0.5, 'sawtooth', 0.16, 70); M.startT = g.t; }
    else if (k === 'stop') { s.shot(90, 0.3, 'sawtooth', 0.08, -50); }
    else if (k === 'scrape') { s.burst(0.7, 0.3, 2600); s.burst(0.25, 0.5, 700); } } catch (e) {} };
  if (g.sound && typeof g.sound.update === 'function') { const su0 = g.sound.update.bind(g.sound);
    g.sound.update = function (dt) { su0(dt); const s = g.sound, v = pl.vehicle; if (!s.on || !v || !v.moto || !s.o1) return;
      // a bike's engine: six close gears, revs higher and brighter than a car's, a blip as it catches
      try { const now = s.ac.currentTime, sp = Math.abs(v.vf), gears = [0, 0.13, 0.25, 0.39, 0.55, 0.75, 1.01].map((x) => x * TUNE.top); let gi = 1; while (gi < 6 && sp > gears[gi]) gi++; const r = (sp - gears[gi - 1]) / (gears[gi] - gears[gi - 1]), thr = g.input.throttle, blip = Math.max(0, 1 - (g.t - (M.startT || -9)) / 0.5);
        const f = 68 + r * 150 + gi * 7 + thr * 14 + blip * 60; s.o1.frequency.setTargetAtTime(f, now, 0.035); s.o2.frequency.setTargetAtTime(f * 1.498, now, 0.035); s.elp.frequency.setTargetAtTime(520 + r * 1500 + thr * 1100, now, 0.06); s.eg.gain.setTargetAtTime(0.045 + thr * 0.065 + r * 0.02 + blip * 0.03, now, 0.06); } catch (e) {} }; }

  // ------------------------------------------------------------------------------------------------ drawing: every bike in sight as instances
  const CAP = 72, LS = new THREE.Matrix4(), TF = new THREE.Matrix4().makeTranslation(0.74, 0.31, 0), TR = new THREE.Matrix4().makeTranslation(-0.70, 0.31, 0), SCR = new THREE.Matrix4().makeScale(1, 1, 1.35), TS = new THREE.Matrix4().makeTranslation(-0.05, 0.30, -0.13);
  const SD = V3(0.101, -0.815, -0.572).normalize(), SU = V3(-0.985, -0.12, -0.12).normalize(), QD = new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), SD), QU = new THREE.Quaternion().setFromUnitVectors(V3(0, -1, 0), SU), nearL = [];
  function put(o, lean, steer, spin, stand, zf, zr, color) {
    const D = M.model, i = D.n; if (i >= CAP) return; D.n++;
    _e.set(-lean, o.h, Math.atan2(zf - zr, TUNE.wb), 'YZX'); _q.setFromEuler(_e); _mb.compose(_v.set(o.x, (zf + zr) / 2 + liftOf(lean), -o.y), _q, ONE);
    D.body.setMatrixAt(i, _mb); _col.set(color); D.body.setColorAt(i, _col); D.fork.setColorAt(i, _col);
    _q2.setFromAxisAngle(_v2.set(...AXIS), steer || 0); LS.makeRotationFromQuaternion(_q2); _mt.makeTranslation(PIVOT[0], PIVOT[1], 0).multiply(LS).multiply(_mw.makeTranslation(-PIVOT[0], -PIVOT[1], 0)); _mf.multiplyMatrices(_mb, _mt); D.fork.setMatrixAt(i, _mf);
    _mw.makeRotationZ(-spin); _mt.multiplyMatrices(_mf, TF).multiply(_mw); D.wheel.setMatrixAt(i * 2, _mt); _mt.multiplyMatrices(_mb, TR).multiply(_mw).multiply(SCR); D.wheel.setMatrixAt(i * 2 + 1, _mt);
    if (stand > 0.02 && D.ns < CAP) { _q2.copy(QU).slerp(QD, stand); _mw.makeRotationFromQuaternion(_q2); _mt.multiplyMatrices(_mb, TS).multiply(_mw); D.stand.setMatrixAt(D.ns++, _mt); }
  }
  function draw(dt) {
    const D = M.model, cam = g.world.camera, cx = cam.position.x, cy = -cam.position.z, d3 = cam.getWorldDirection(_v3), dl = Math.hypot(d3.x, d3.z) || 1, dx = d3.x / dl, dy = -d3.z / dl, cosH = Math.cos(((cam.fov * cam.aspect) / 2 + 14) * Math.PI / 180);
    const seen = (x, y) => { const ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey); return d < 24 || (d < 230 && ex * dx + ey * dy > d * Math.max(0.2, cosH)); };
    D.n = 0; D.ns = 0;
    for (const v of g.vehicles) if (v.moto && seen(v.x, v.y)) put(v, v.lean, v.steer, v.spin, v.stand, v.zf, v.zr, v.color);
    if (M.riders) M.riders.begin();
    for (const c of g.traffic.cars) if (c.moto && seen(c.x, c.y)) { put(c, c.mlean || 0, c.steer, c.spin, 0, c.mz || 0, c.mz || 0, c.color); if (M.riders) M.riders.add(c, _mb, Math.hypot(c.x - cx, c.y - cy)); }
    if (M.riders) M.riders.end();
    M.nearT = (M.nearT || 0) - 1; if (M.nearT <= 0) { M.nearT = 12; nearL.length = 0; for (const s of M.bikes) if (!s.gone && Math.abs(s.x - cx) < 250 && Math.abs(s.y - cy) < 250) nearL.push(s); }
    for (const s of nearL) if (!s.gone && seen(s.x, s.y)) put(s, s.lean, s.steer, s.spin, s.stand, s.zf, s.zr, s.color);
    for (const k of ['body', 'fork', 'wheel', 'stand']) { const im = D[k], n = k === 'wheel' ? D.n * 2 : k === 'stand' ? D.ns : D.n; im.count = n; im.visible = n > 0; if (n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } }
    M.drawn = D.n;
  }
  async function loadLater() {
    // the rig and the way-round planner are the boarding lane's (already fetched by its own module); the model is built once the game is playable
    try { const R = await import('../entry/rig.js'); const r = new R.EntryRig(pl.vis, 'player'); if (r.ok) M.rig = r; } catch (e) { M.err('rig', e); }
    try { M.WR = await import('../entry/walkround.js'); } catch (e) { M.err('walkround', e); }
    if (P.has('motophys')) { try { const m = await import(P.get('motophys')); if (m.stepBike) M.phys = m.stepBike; } catch (e) { M.err('motophys', e); } }
    if ((TRAFFIC && P.get('mototraffic') !== '0') || P.get('mototraffic') === '1') { try { await (await import('./mototraffic.js')).install(g, M, POSE); } catch (e) { M.err('traffic', e); } }
    if (typeof window === 'undefined' || !g.world || !g.world.renderer || !g.world.renderer.getContext) return;
    for (let i = 0; i < 240 && !(window.__ready && !window.__warming); i++) await new Promise((r) => setTimeout(r, 500));      // the model is made once the game is playable, not while it loads
    await M.loadModel();
  }
  M.loadModel = async () => {
    const t0 = performance.now(), MM = await import('./motomodel.js'), G = MM.buildBike(), mats = MM.bikeMaterials(), mk = (geo, mat, n, col) => { const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.count = 0; im.visible = false; im.name = 'moto'; im.userData.brkOwn = true;      /* (the lead's budget.js lists instanced meshes by where they stood when it looked and hides them as 'far small things' 280 m from there: these move) */ if (col) { im.setColorAt(0, _col.set(0xffffff)); } g.world.scene.add(im); return im; };
    M.model = { n: 0, ns: 0, tris: G.tris, body: mk(G.body, mats.body, CAP, true), fork: mk(G.fork, mats.fork, CAP, true), wheel: mk(G.wheel, mats.plain, CAP * 2), stand: mk(G.stand, mats.plain, CAP), ms: Math.round(performance.now() - t0) };
    console.log('[moto] on: model ' + G.tris.bike + ' triangles a bike, built in ' + M.model.ms + ' ms; rig ' + (M.rig ? 'ok' : 'none') + '; ' + M.bikes.length + ' bikes standing near');
  };
  M.int = { DEF, PAINTS, kerb, toMap, wayTo, bikeMat, rootMat, fromSlot, toSlot, say, cancel, SIDE_D, X0 };
  layOut();
  M.ready = loadLater().catch((e) => M.err('load', e));
  return M;
}
