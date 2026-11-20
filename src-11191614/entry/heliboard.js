// entry/heliboard.js (gameplay lane, Nov 13): getting into and out of the helicopter as something you watch happen.
// Matt: "just getting into the heli looks awful lol". Before this the player slid to the door standing still, the door swung through him, he
// vanished, and the camera cut to the flight view; getting out put him on the grass in the seated pose inside the swinging door.
//
// What happens now. IN: F near the aircraft (anywhere round the cabin, not only at the door) -> he walks (jogs if it is far: round the nose from the
// far side) to a spot behind the door's swing, takes the handle with the left hand and draws the door open, steps onto the skid, puts the right foot
// in, sits, pulls the door shut with the right hand; the engine starts as he sits and the camera swings out to the flight view while the door closes.
// OUT: F when landed -> the door is pushed open from the seat, left foot to the skid, right foot to the ground, he turns and pushes the door shut;
// the camera comes in from the flight view to the on-foot view on the door's side while he does it.
// F again before he has stepped up cancels (the door is let go and closes); after that F is held back until the beat is over.
//
// ONE hook in heli/heli.js (after the parts are loaded):   if (g.P.get('hboard') !== '0') try { (await import('../entry/heliboard.js')).addHeliBoard(this); } catch (e) { ... }
// Everything else is wrapped from here (heli.canBoard / tryBoard / leave / step / sync and game.updateCamera). ?hboard=0 leaves the old beat exactly as it was.
// The figure is posed with entry/rig.js (the car entry's whole-body puppet; imported, not changed). All poses are hand-keyed here in the aircraft's
// own frame (DIMS: x forward, y up, z right, origin on the ground under the mast), so they follow the aircraft on a slope or a roof.
import * as THREE from 'three';
import { EntryRig } from './rig.js';
import { DIMS } from '../heli/dims.js';
import { carsNear, depth, pushOut, planBest, say, TIGHT, FOOT, BODY_R } from './walkround.js';      /* board 4: never through the aircraft */
// the aircraft standing on the ground, as boxes a walking person cannot pass (aircraft frame: x0, x1, z0, z1): pod with its skids, nose (two steps), engine bay,
// boom (its underside is 1.6 to 1.85 m up: head height), fin with the tail rotor on its right. The stabiliser (1.9 m up) is walked under.
const HULL = [[-1.5, 1.6, -1.13, 1.13], [1.6, 2.6, -0.92, 0.92], [2.6, 3.37, -0.66, 0.66], [-3.0, -1.5, -0.87, 0.87], [-7.6, -3.0, -0.25, 0.25], [-7.65, -5.3, -0.25, 0.62]], _o2 = {};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
const ss = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }, smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
const _v = V(), _v2 = V(), _v3 = V(), _v4 = V(), _fw = V(), _lf = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _one = V(1, 1, 1);

// ------------------------------------------------------------------ the measurements the motion is keyed to (aircraft frame)
const ANK = 0.102, STAND = 1.007;      // the figure's ankle and hip-joint heights standing (rig.js measures the same in the bind pose)
export const K = {
  DOOR: 0.62,                             // how far the door is opened, of the model's full swing (1.22 rad): 43 degrees, so a hand can stay on it
  SWING: 1.22, hinge: V(1.94, 0.95, 0.864), axis: V(-0.2143, 0.9767, -0.0089).normalize(),     // model.js hinges the door on the line between podAt(doorFront(.95), .95) and (.., 1.72); read again from shape.js at start
  handle: V(0.40, 1.165, 0.972),          // outside handle (shape.js: put('handle', 0.40, 1.165, 1, ...)) on the closed door
  pull: V(1.02, 1.20, 0.86),              // where the right hand takes the door from inside
  edge: V(0.31, 1.27, 0.955),             // the door's rear edge at chest height (pushed shut from outside)
  S: V(0.08, 0, 1.42), yawS: 1.04,        // where he stands to open it (1.86 m from the hinge: the door's edge passes 0.25 m in front of him), facing the handle
  SO: V(0.30, 0, 1.62), yawO: 0.90,       // where he ends getting out
  SK: V(0.62, 2 * DIMS.skidTube + ANK, DIMS.skidZ),     // the left ankle with the foot on the skid tube
  FR1: V(1.30, DIMS.floorY + ANK, 0.70),  // the right ankle with the foot on the cabin floor just inside the sill
  seatRoot: V(DIMS.pilotSeat[0] - 0.12, DIMS.pilotSeat[1] + 0.02, DIMS.pilotSeat[2]),      // where heli.js puts the seated figure's root
  seatHip: V(0.006, 0.234, 0), seatFL: V(0.493, -0.041, -0.141), seatFR: V(0.469, -0.047, 0.126),      // the Drive clip's hips and ankles from that root (node probe; blended to the live clip at the end anyway)
  cyclic: V(1.26, 1.235, 0.41), collective: V(1.02, 0.955, 0.17),     // as near the grips as this figure's arms reach from the seat (cabin.js PIVOT: grip tops at 1.32, 1.27, 0.40 and 1.13, 0.94, 0.125)
  T_SEAT: 1.75, T_IN: 2.3, T_COMMIT: 0.52, T_OUT: 2.05, CAM_IN: 1.5, CAM_OUT: 1.05,
};
K.seatH = K.seatRoot.clone().add(K.seatHip); K.sFL = K.seatRoot.clone().add(K.seatFL); K.sFR = K.seatRoot.clone().add(K.seatFR);
const fwdOf = (yaw, out) => out.set(Math.cos(yaw), 0, -Math.sin(yaw)), leftOf = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
// the two ankles of the Idle clip standing at p facing yaw (so the puppet's first and last poses are the clip's own: no shuffle when it lets go)
function stance(p, yaw, L, R) { fwdOf(yaw, _v); leftOf(yaw, _v2); L.copy(p).addScaledVector(_v2, 0.172).addScaledVector(_v, -0.05); L.y = ANK; R.copy(p).addScaledVector(_v2, -0.164).addScaledVector(_v, -0.05); R.y = ANK; }
const S_L = V(), S_R = V(), O_L = V(), O_R = V(); stance(K.S, K.yawS, S_L, S_R); stance(K.SO, K.yawO, O_L, O_R);
// a point of the door when it is open by a (0..1 of the full swing)
export function doorPt(p, a, out) { return out.copy(p).sub(K.hinge).applyAxisAngle(K.axis, a * K.SWING).add(K.hinge); }
// Catmull-Rom through timed keys [t, x, y, z] (or [t, v]): the body never stops dead at a key
function spl(keys, t, out) {
  const n = keys.length; let i = 0; if (t <= keys[0][0]) { i = 0; t = keys[0][0]; } else if (t >= keys[n - 1][0]) { i = n - 2; t = keys[n - 1][0]; } else while (i < n - 2 && t >= keys[i + 1][0]) i++;
  const a = keys[Math.max(i - 1, 0)], b = keys[i], c = keys[i + 1], d = keys[Math.min(i + 2, n - 1)], u = (t - b[0]) / (c[0] - b[0]), u2 = u * u, u3 = u2 * u;
  const f = (k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3);
  if (!out) return f(1); return out.set(f(1), f(2), f(3));
}
// a foot swung from a to b by s (0..1): out over the ground, lifted in the middle
function swing(a, b, s, lift, out) { return out.copy(a).lerp(b, s).addScaledVector(UP, lift * Math.sin(Math.PI * s)); }
const bump = (t, a, b, c) => ss(t, a, b) * (1 - ss(t, b, c));

function blank() { return { hip: V(), root: V(), yaw: 0, pitch: 0, roll: 0, fL: V(), fR: V(), yawL: 0, yawR: 0, pitL: 0, pitR: 0, sit: 0, w: 1, door: 0, hL: { p: V(), w: 0, curl: 0 }, hR: { p: V(), w: 0, curl: 0 }, wh: 1, look: V(1, 0, 0), lookW: 0 }; }

// ---- getting in: t seconds from the moment he has reached the standing spot
const IN_HIP = [[0, K.S.x, STAND, K.S.z], [0.28, K.S.x + 0.035, STAND - 0.02, K.S.z - 0.06], [0.55, K.S.x + 0.06, STAND - 0.005, K.S.z + 0.03], [0.95, 0.36, 0.985, 1.33], [1.36, 0.70, 1.06, 1.12], [1.56, 0.98, 1.05, 0.78], [1.80, K.seatH.x, K.seatH.y, K.seatH.z], [2.4, K.seatH.x, K.seatH.y, K.seatH.z]];
const IN_YAW = [[0, K.yawS], [0.5, K.yawS], [0.95, 0.62], [1.36, 0.16], [1.75, 0], [2.4, 0]], IN_PITCH = [[0, 0], [0.28, 0.26], [0.55, 0.05], [0.95, 0.16], [1.36, 0.34], [1.6, 0.24], [1.9, 0.02], [2.4, 0]];
export function doorIn(t) { if (t < 1.36) { const u = clamp((t - 0.27) / 0.7, 0, 1); return K.DOOR * (1 - Math.pow(1 - u, 2.4)); } const u = clamp((t - 1.36) / 0.62, 0, 1); return K.DOOR * Math.pow(1 - u, 1.3); }     // drawn open by the left hand; pulled shut by the right as he swings in (from the seat an arm only reaches the last of it)
export function poseIn(t, P) {
  const a = (P.door = doorIn(t));
  spl(IN_HIP, t, P.hip); P.yaw = spl(IN_YAW, t); P.pitch = spl(IN_PITCH, t); P.roll = 0.12 * bump(t, 1.2, 1.5, 1.85); P.sit = ss(t, 1.3, 1.78);
  // left foot: planted, to the skid 0.55-0.92, on it while he rises and swings in, then in after him
  if (t < 0.55) P.fL.copy(S_L); else if (t < 0.92) swing(S_L, K.SK, ss(t, 0.55, 0.92), 0.13, P.fL); else if (t < 1.44) P.fL.copy(K.SK);
  else { const s = ss(t, 1.44, 1.88); P.fL.copy(K.SK).lerp(K.sFL, s); P.fL.y = lerp(K.SK.y, K.sFL.y, ss(s, 0, 0.3)) + 0.18 * Math.sin(Math.PI * s); }
  P.yawL = t < 0.55 ? K.yawS : lerp(K.yawS, 0.25, ss(t, 0.55, 0.92)) * (1 - ss(t, 1.44, 1.88)); P.pitL = -0.35 * bump(t, 0.5, 0.62, 0.8) - 0.3 * bump(t, 1.36, 1.5, 1.7);
  // right foot: planted (rolling onto the toes as the weight goes to the skid), up over the sill onto the cabin floor 0.96-1.38, then forward to the pedals
  if (t < 0.96) P.fR.copy(S_R); else if (t < 1.38) { const s = ss(t, 0.96, 1.38); P.fR.copy(S_R).lerp(K.FR1, s); P.fR.z = lerp(S_R.z, K.FR1.z, ss(s, 0.25, 1)); P.fR.y = lerp(S_R.y, K.FR1.y, ss(s, 0, 0.6)) + 0.10 * Math.sin(Math.PI * s); }
  else P.fR.copy(K.FR1).lerp(K.sFR, ss(t, 1.5, 1.9));
  P.yawR = lerp(K.yawS, 0, ss(t, 0.96, 1.38)); P.pitR = -0.55 * bump(t, 0.72, 0.96, 1.15);
  // left hand: on the handle and with the door till it is out of reach; later down to the collective
  { const w1 = ss(t, 0.05, 0.27) * (1 - ss(t, 0.40, 0.58)), w2 = ss(t, 1.85, 2.2); if (t < 1.2) { doorPt(K.handle, a, P.hL.p); P.hL.w = w1; P.hL.curl = 0.85 * ss(t, 0.18, 0.27); } else { P.hL.p.copy(K.collective); P.hL.w = w2; P.hL.curl = 0.7 * w2; } }
  // right hand: takes the door from inside as he swings in and draws it shut, then to the cyclic
  { const w = ss(t, 1.05, 1.32); doorPt(K.pull, a, P.hR.p); if (t > 1.98) P.hR.p.lerp(K.cyclic, ss(t, 1.98, 2.3)); P.hR.w = w; P.hR.curl = 0.8 * ss(t, 1.25, 1.34); }
  // eyes: the handle, then the seat, then ahead
  { const k1 = bump(t, 0.02, 0.2, 0.6), k2 = bump(t, 0.7, 1.0, 1.6); if (k1 > k2) { P.look.copy(K.handle).sub(_v.set(P.hip.x, 1.65, P.hip.z)); P.lookW = 0.7 * k1; } else { P.look.set(K.seatH.x + 0.3 - P.hip.x, -0.35, K.seatH.z - P.hip.z); P.lookW = 0.6 * k2; } }
  P.w = ss(t, 0, 0.2) * (1 - ss(t, 1.9, 2.2)); P.wh = ss(t, 0, 0.12);
  const g = ss(t, 1.36, 1.75); P.root.set(lerp(P.hip.x, K.seatRoot.x, g), lerp(0, K.seatRoot.y, g), lerp(P.hip.z, K.seatRoot.z, g));
  return P;
}
// ---- getting out: t seconds from the key
const OUT_HIP = [[0, K.seatH.x, K.seatH.y, K.seatH.z], [0.30, K.seatH.x, K.seatH.y + 0.01, K.seatH.z], [0.56, 0.98, 1.05, 0.78], [0.84, 0.70, 1.06, 1.12], [1.12, 0.46, 0.93, 1.42], [1.52, K.SO.x, STAND - 0.01, K.SO.z + 0.02], [1.75, K.SO.x - 0.03, STAND, K.SO.z + 0.03], [2.05, K.SO.x, STAND, K.SO.z]];
const OUT_YAW = [[0, 0], [0.4, 0], [0.84, 0.25], [1.25, 0.72], [1.55, K.yawO], [2.05, K.yawO]], OUT_PITCH = [[0, 0], [0.3, 0.14], [0.6, 0.3], [0.84, 0.2], [1.12, 0.2], [1.45, 0.1], [1.7, 0.14], [2.05, 0]];
export function doorOut(t) { if (t < 1.28) { const u = clamp((t - 0.2) / 0.6, 0, 1); return K.DOOR * (1 - Math.pow(1 - u, 2.4)); } const u = clamp((t - 1.28) / 0.56, 0, 1); return K.DOOR * (1 - Math.pow(u, 2.0)); }
export function poseOut(t, P) {
  const a = (P.door = doorOut(t));
  spl(OUT_HIP, t, P.hip); P.yaw = spl(OUT_YAW, t); P.pitch = spl(OUT_PITCH, t); P.roll = 0.1 * bump(t, 0.3, 0.55, 0.85); P.sit = 1 - ss(t, 0.3, 0.8);
  // left foot: out over the sill to the skid 0.28-0.68, on it till the right is down, then to the ground
  if (t < 0.28) P.fL.copy(K.sFL); else if (t < 0.68) { const s = ss(t, 0.28, 0.68); P.fL.copy(K.sFL).lerp(K.SK, s); P.fL.y = lerp(K.sFL.y, K.SK.y, ss(s, 0.72, 1)) + 0.20 * Math.sin(Math.PI * s); }
  else if (t < 1.2) P.fL.copy(K.SK); else swing(K.SK, O_L, ss(t, 1.2, 1.52), 0.07, P.fL);
  P.yawL = lerp(0, 0.25, ss(t, 0.28, 0.68)); if (t > 1.2) P.yawL = lerp(0.25, K.yawO, ss(t, 1.2, 1.52)); P.pitL = -0.3 * bump(t, 1.1, 1.22, 1.4);
  // right foot: stays in the cabin till the weight is over the skid, then out over the sill and down to the grass
  if (t < 0.72) P.fR.copy(K.sFR).lerp(K.FR1, ss(t, 0.3, 0.6)); else if (t < 1.14) { const s = ss(t, 0.72, 1.14); P.fR.copy(K.FR1).lerp(O_R, s); P.fR.z = lerp(K.FR1.z, O_R.z, ss(s, 0, 0.8)); P.fR.y = lerp(K.FR1.y, O_R.y, ss(s, 0.42, 1)) + 0.12 * Math.sin(Math.PI * s); } else P.fR.copy(O_R);
  P.yawR = lerp(0, K.yawO, ss(t, 0.72, 1.3)); P.pitR = 0.25 * bump(t, 0.95, 1.08, 1.16);
  // right hand: pushes the door open from the seat, lets go as it swings away; outside, takes its edge and pushes it shut
  { const w1 = 1 - ss(t, 0.56, 0.76), w2 = ss(t, 1.16, 1.36) * (1 - ss(t, 1.74, 1.94)); if (t < 0.95) { doorPt(K.pull, a, P.hR.p); if (t < 0.22) P.hR.p.lerp(K.cyclic, 1 - ss(t, 0, 0.22)); P.hR.w = w1; P.hR.curl = 0.7 * w1; } else { doorPt(K.edge, a, P.hR.p); P.hR.w = w2; P.hR.curl = 0.25 * w2; } }
  P.hL.p.copy(K.collective); P.hL.w = 1 - ss(t, 0.2, 0.5); P.hL.curl = 0.7 * P.hL.w; P.wh = 1;
  { const k1 = bump(t, 0.25, 0.5, 1.0), k2 = bump(t, 1.15, 1.4, 1.9); if (k1 > k2) { P.look.set(0.2, -0.75, 0.9); P.lookW = 0.55 * k1; } else { doorPt(K.edge, a, P.look).sub(_v.set(P.hip.x, 1.65, P.hip.z)); P.lookW = 0.6 * k2; } }
  P.w = ss(t, 0, 0.16) * (1 - ss(t, 1.84, 2.05));
  const g = 1 - ss(t, 0.3, 0.8); P.root.set(lerp(P.hip.x, K.seatRoot.x, g), lerp(0, K.seatRoot.y, g), lerp(P.hip.z, K.seatRoot.z, g));
  return P;
}

// ------------------------------------------------------------------ the figure
// lay a pose (aircraft frame) on the figure; M, Q = the aircraft's matrix and attitude. w = 0 leaves the clip alone.
export function applyPose(rig, o, P, M, Q) {
  _q.setFromAxisAngle(UP, P.yaw); o.quaternion.copy(Q).multiply(_q); o.position.copy(P.root).applyMatrix4(M); o.updateMatrixWorld(true);
  const w = P.w, fwd = _fw.set(1, 0, 0).applyQuaternion(o.quaternion), left = _lf.set(0, 0, -1).applyQuaternion(o.quaternion);
  if (w > 0.001) {
  rig.hips(_v.copy(P.hip).applyMatrix4(M), w);
  if (P.pitch || P.roll) { _q.setFromAxisAngle(left, P.pitch * 0.3 * w); _q2.setFromAxisAngle(fwd, P.roll * 0.3 * w); rig.tilt(_q.multiply(_q2)); rig.bend(left, P.pitch * 0.7 * w); rig.bend(fwd, P.roll * 0.7 * w); }
  const pole = _v4.copy(fwd).addScaledVector(UP, 0.55 + 0.6 * P.sit).normalize();
  for (const s of ['L', 'R']) { const yaw = s === 'L' ? P.yawL : P.yawR; _v2.set(Math.cos(yaw), 0, -Math.sin(yaw)).transformDirection(M); rig.leg(s, _v.copy(s === 'L' ? P.fL : P.fR).applyMatrix4(M), _v3.copy(pole).addScaledVector(left, (s === 'L' ? 1 : -1) * (0.1 + 0.2 * P.sit)), _v2, s === 'L' ? P.pitL : P.pitR, w); } }
  for (const s of ['L', 'R']) { const h = s === 'L' ? P.hL : P.hR, hw = h.w * P.wh; if (hw <= 0.001) { rig.curl(s, 0); continue; }
    rig.arm(s, _v.copy(h.p).applyMatrix4(M), _v3.set(0, -1, 0).addScaledVector(left, s === 'L' ? 0.7 : -0.7).addScaledVector(fwd, -0.3), hw); rig.curl(s, h.curl); }
  if (P.lookW > 0 && w > 0.001) rig.look(_v.copy(P.look).transformDirection(M), P.lookW * w);
}

// ------------------------------------------------------------------ the beat
class HeliBoard {
  constructor(heli) {
    const g = heli.g; this.h = heli; this.g = g; this.beat = null; this.P = blank(); this.rig = null; this.rigFor = null; this.posed = false; this.stats = { ins: 0, outs: 0, cancels: 0 };
    this.c = { k: 0, dir: 0, ease: null, frozen: null, last: null }; this.A = mkPose(); this.B = mkPose(); this.R = mkPose();
    this.seatHands = g.P.get('hbhands') !== '0';
    const self = this;
    this.canBoard0 = heli.canBoard.bind(heli); this.step0 = heli.step.bind(heli); this.sync0 = heli.sync.bind(heli); this.board0 = heli.board.bind(heli); this.hcam0 = heli.updateCamera.bind(heli); this.gcam0 = g.updateCamera.bind(g);
    heli.canBoard = function () { return self.canBoard(); };
    heli.tryBoard = function () { if (!self.canBoard()) return false; return self.begin('in') !== false; };
    heli.leave = function () { self.begin('out'); };
    this.round = g.P.get('hround') !== '0';      /* ?hround=0: the walk as before board 4 */
    heli.step = function (dt, I) { if (self.beat) { try { self.advance(dt, I); } catch (e) { self.fail('step', e); } } else if (self.round) self.pushFoot(g.player); self.step0(dt, I); if (self.beat || self.doorNow > 0) { heli.door = self.doorNow; if (!self.beat) self.doorNow = 0; } };
    heli.sync = function (dt) { self.sync0(dt); try { self.sync(dt); } catch (e) { self.fail('sync', e); } };
    g.updateCamera = function (dt) { let own = false; try { own = self.camera(dt); } catch (e) { self.fail('camera', e); } if (!own) return self.gcam0(dt); };
  }
  async init() {     // the door's real hinge line, as model.js takes it
    try { if (this.h.model && !this.h.model.standIn) { const sh = await import('../heli/model/shape.js'), a = sh.podAt(sh.doorFront(0.95), 0.95, 1).p, b = sh.podAt(sh.doorFront(1.72), 1.72, 1).p; K.hinge.set(a[0], a[1], a[2]); K.axis.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); } } catch (e) { console.log('[hboard] door hinge from the built-in numbers (' + (e && e.message) + ')'); }
    return this;
  }
  fail(where, e) { this.errs = (this.errs || 0) + 1; if (this.errs <= 3) console.log('[hboard] ' + where + ' threw: ' + (e && (e.stack || e.message))); if (this.beat) this.abort(); }
  // anything goes wrong mid-beat: end it in a sane state (seated if he had sat down, else on his feet where he is)
  abort() { const h = this.h, b = this.beat; this.beat = null; this.doorNow = 0; this.c.dir = 0; this.c.ease = null; this.c.frozen = null; if (h.busy && h.busy.hb) h.busy = null; if (b && b.kind === 'in' && !h.piloted && b.ph === 'act' && b.t > K.T_COMMIT) this.board0(); this.release(); }
  matrix() { const r = this.h.root; return _m.compose(r.position, r.quaternion, _one); }
  // map point of an aircraft-frame point, and back
  toMap(p, o) { _v.copy(p).applyMatrix4(this.matrix()); o.x = _v.x; o.y = -_v.z; o.wy = _v.y; return o; }
  toCraft(x, y, out) { return out.set(x, this.h.f.surface, -y).applyMatrix4(_mi.copy(this.matrix()).invert()); }
  getRig() { const vis = this.g.player.vis; if (this.rigFor !== vis.object) { this.rigFor = vis.object; this.rig = null; try { const r = new EntryRig(vis, 'player'); if (r.ok) this.rig = r; } catch (e) { console.log('[hboard] no rig: ' + (e && e.message)); } } return this.rig; }
  release() { if (this.rig && this.posed) { this.rig.restHips(); this.rig.curl('L', 0); this.rig.curl('R', 0); } this.posed = false; }

  canBoard() {
    const h = this.h, pl = this.g.player, f = h.f; if (h.piloted || h.busy || this.beat || pl.vehicle || pl.busy || !f.onGround) return false;
    if (Math.abs((pl.alt || 0) - (f.surface > 1 ? f.surface : 0)) > 2.5) return false;
    const p = this.toCraft(pl.x, pl.y, _v3); return p.x > -2.6 && p.x < 5.2 && p.z > -3.2 && p.z < 4.4;      // anywhere round the cabin and nose (the old rule: within 2.6 m of the door)
  }
  // the way to the standing spot from p (aircraft frame, on the ground): round the nose if he is on the far side or ahead of it
  // board 4: the aircraft's body as boxes on the map
  hull() { const hd = this.h.f.heading, c = Math.cos(hd), s = Math.sin(hd), out = (this._hull ||= HULL.map(() => ({})));
    for (let i = 0; i < HULL.length; i++) { const r = HULL[i], B = out[i]; this.toMap(_v2.set((r[0] + r[1]) / 2, 0, (r[2] + r[3]) / 2), B); B.c = c; B.s = s; B.hl = (r[1] - r[0]) / 2; B.hw = (r[3] - r[2]) / 2; B.o = this.h; B.pad = undefined; } return out; }
  // ordinary walking: he cannot stand inside the aircraft
  pushFoot(pl) { const h = this.h, f = h.f, r = h.root.position; if (h.piloted || h.busy || !f.onGround || pl.vehicle || pl.busy || (this.g.fly && this.g.fly.on)) return; const dx = pl.x - r.x, dy = pl.y + r.z; if (dx * dx + dy * dy > 110 || Math.abs((pl.alt || 0) - (f.surface > 1 ? f.surface : 0)) > 2.5) return;
    if (pushOut(this.hull(), pl, FOOT)) { this.stats.pushes = (this.stats.pushes || 0) + 1; if (pl.alt > 1) { h._rx = pl.x; h._ry = pl.y; } } }
  // the way to the standing spot on foot, outside the aircraft and any car beside it (walkround.js); null if there is none
  route(p) {
    if (!this.round) return this.route0(p);
    const fw = fwdOf(K.yawS, _v), S0 = V(K.S.x - fw.x * 0.75, 0, K.S.z - fw.z * 0.75), S = K.S.clone(), g = this.g, pl = g.player, m0 = this.toMap(S0, {}), mS = this.toMap(S, {});
    const hull = this.hull(), cars = carsNear(g, pl.x, pl.y, 15, (this.poolC ||= { boxes: [], pk: [] })), st = this.h.f.surface > 1 ? null : g.statics;
    const mk = (T) => (pad) => (x, y) => { const near = (x - T.x) * (x - T.x) + (y - T.y) * (y - T.y) < 0.36, q = near ? Math.min(pad, TIGHT) : pad;
      for (let i = 0; i < hull.length; i++) if (depth(hull[i], x, y, q) > 0) return true; for (let i = 0; i < cars.length; i++) if (depth(cars[i], x, y, q) > 0) return true; return st ? st.resolve(x, y, BODY_R, _o2, near) > 0 : false; };
    let w = planBest(pl.x, pl.y, m0.x, m0.y, mk(m0)), tail = [S0, S]; if (!w) { w = planBest(pl.x, pl.y, mS.x, mS.y, mk(mS)); tail = [S]; }
    if (!w || w.len > 30) return null; this.stats.planMs = Math.max(this.stats.planMs || 0, +w.ms.toFixed(2));
    const out = w.pts.slice(1, -1).map((q) => this.toCraft(q.x, q.y, V())); if (!out.length && tail.length > 1 && Math.hypot(p.x - S.x, p.z - S.z) <= 1.0 && !mk(mS)(TIGHT)((pl.x + mS.x) / 2, (pl.y + mS.y) / 2)) tail = [S];
    for (const q of tail) out.push(q); return out;
  }
  route0(p) {
    const fw = fwdOf(K.yawS, _v), S0 = V(K.S.x - fw.x * 0.75, 0, K.S.z - fw.z * 0.75), S = K.S.clone(), out = [];
    const left = p.z < -1.25, ahead = p.x > 3.6 && p.z < 1.3;
    if (left && p.x < 4.4) out.push(V(4.9, 0, Math.min(-2.1, p.z)));
    if (left || ahead) out.push(V(4.8, 0, 2.3));      // wide of the nose: the view following him cuts the corner
    if (Math.hypot(p.x - S.x, p.z - S.z) > 1.0 || out.length) out.push(S0);
    out.push(S); return out;
  }
  begin(kind) {
    const g = this.g, h = this.h, pl = g.player, f = h.f, cam = g.world.camera, c = this.c;
    if (kind === 'in') {
      const p = this.toCraft(pl.x, pl.y, V()), path = this.route(p); if (!path) { say('No way round to the pilot\u2019s door'); return false; } let len = 0, q = p; for (const w of path) { len += Math.hypot(w.x - q.x, w.z - q.z); q = w; }
      const vis = pl.vis, wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 }, run = len > 4.2 && vis.acts && vis.acts.run;
      this.beat = { kind, ph: 'walk', t: 0, path, i: 0, len, run, wk, vw: Math.min(2.0, wk.speed), vr: 4.4, cr: vis.runSpeed || 5.0, y0: vis.object.position.y, seated: false };
      h.busy = { kind: 'hb', t: 0, dur: Infinity, hb: true, ph: 'in:walk' };
      c.ease = { pose: readCam(cam, mkPose()), t: 0, dur: 0.45 }; c.k = 0; c.dir = 0; c.frozen = null; this.doorNow = 0; this.stats.ins++;
    } else {
      // what heli.leave() did to the state, without the snap: he is out of the controls at once, the engine is cut, the camera starts for the on-foot view
      const chase = h.camMode !== 'cockpit', yaw0 = chase ? h.cam.yaw : f.heading;
      h.piloted = false; h.hasCamera = false; g.cam.mode = 'foot'; if (f.engine !== 'off') f.engine = 'off'; h.insideView = false;
      const m = this.toMap(K.seatH, {}); pl.x = m.x; pl.y = m.y; pl.h = f.heading; pl.alt = f.surface > 1 ? f.surface : 0; pl.roof = f.surface > 1; pl.speed = 0; h._rx = pl.x; h._ry = pl.y; pl.vis.object.visible = true;
      this.beat = { kind, ph: 'act', t: 0, seated: true, sound: 0 }; h.busy = { kind: 'hb', t: 0, dur: Infinity, hb: true, ph: 'out' };
      // the on-foot camera ends on the door's side, out to the right of him and a little behind (straight behind would bring it in past the tail rotor, and the rear quarter swept the fin across the picture)
      const C = g.cam, hd = f.heading, ox = -0.30 * Math.cos(hd) + 0.95 * Math.sin(hd), oy = -0.30 * Math.sin(hd) - 0.95 * Math.cos(hd);
      g.snapCamera(); C.yaw = Math.atan2(-oy, -ox); C.pitch = 0.2; C.lookT = 0; C.clip = undefined;
      c.k = chase ? 1 : 0; c.dir = chase ? -1 : 0; c.frozen = null; c.ease = chase ? null : null; c.yaw0 = yaw0; this.doorNow = 0; this.stats.outs++;
      if (vis0(pl) && pl.vis.acts.drive && pl.vis.cur !== 'drive') g.playerAnim('drive');
    }
  }
  fade(name, dur) { const v = this.g.player.vis; if (!v.mixer || !v.acts[name] || v.cur === name) return; if (v.cur && v.acts[v.cur]) v.acts[v.cur].fadeOut(dur); v.acts[name].reset().fadeIn(dur).play(); v.cur = name; v.mixer.timeScale = 1; }
  // every fixed step while a beat runs (before the helicopter's own step)
  advance(dt, I) {
    const g = this.g, h = this.h, pl = g.player, b = this.beat, f = h.f, use = I.use; I.use = false;
    if (!f.onGround && !b.seated) { this.abort(); return; }
    b.t += dt;
    if (b.kind === 'in' && b.ph === 'walk') {
      if (use || b.t > 9) { this.cancel(); return; }
      const w = b.path[b.i], m = this.toMap(w, (this._mp ||= {})), dx = m.x - pl.x, dy = m.y - pl.y, d = Math.hypot(dx, dy), last = b.i === b.path.length - 1, run = b.run && !last, v = run ? b.vr : b.vw, stepLen = v * dt;     /* jogs the long way round, walks the last steps to the door */
      if (d <= (last ? stepLen : this.round ? Math.max(stepLen, 0.12) : 0.4)) { if (last) { pl.x = m.x; pl.y = m.y; b.ph = 'act'; b.t = 0; b.h0 = wrapPi(pl.h - f.heading); h.busy.ph = 'in:act'; this.fade('idle', 0.22); pl.speed = 0; return; } b.i++; return; }
      pl.h += wrapPi(Math.atan2(dy, dx) - pl.h) * Math.min(1, dt * 11); pl.x += dx / d * stepLen; pl.y += dy / d * stepLen; pl.speed = v; if (this.round && pushOut(this.hull(), pl, 0.2)) this.stats.walkPushes = (this.stats.walkPushes || 0) + 1;      /* straight at the mark (steering by the heading alone circled it at a jog) */
      if (g.cam.lookT > 0.6) g.cam.yaw += wrapPi(pl.h - g.cam.yaw) * Math.min(1, dt * (b.run ? 3 : 1.2));      /* mouse left alone: the view comes round behind him (round the nose it would stay on the far side) */
      g.playerAnim(run ? 'run' : b.wk.name); if (pl.vis.mixer) pl.vis.mixer.timeScale = v / (run ? b.cr : b.wk.speed);
      return;
    }
    if (b.kind === 'in') {
      if (b.ph === 'undo') { this.doorNow = Math.max(0, this.doorNow - dt * 2.2); b.u = Math.min(1, (b.u || 0) + dt / 0.3); if (this.doorNow <= 0 && b.u >= 1) { this.beat = null; h.busy = null; this.release(); } return; }
      if (use && !b.seated && b.t < K.T_COMMIT) { b.ph = 'undo'; b.u = 0; h.busy.ph = 'in:undo'; this.stats.cancels++; return; }
      this.doorNow = doorIn(b.t);
      if (!b.seated && g.cam.lookT > 0.6) { const cp = this.toCraft(g.world.camera.position.x, -g.world.camera.position.z, _v3); if (cp.z < 1.5 || cp.x > 0.9) { const hd = f.heading, ox = -0.45 * Math.cos(hd) + 0.9 * Math.sin(hd), oy = -0.45 * Math.sin(hd) - 0.9 * Math.cos(hd); g.cam.yaw += wrapPi(Math.atan2(-oy, -ox) - g.cam.yaw) * Math.min(1, dt * 3); } }      /* the view must be on the door's side and behind the open door to see him get in */
      if (!b.s1 && b.t > 0.27) { b.s1 = 1; g.sound.door && g.sound.door(); }
      if (!b.anim && b.t > 1.3) { b.anim = 1; this.fade('drive', 0.4); }
      if (!b.seated && b.t >= K.T_SEAT) {     // seated: the helicopter is his (the engine starts), the camera begins to leave for the flight view
        b.seated = true; const cam = g.world.camera, c = this.c; c.frozen = c.last ? copyPose(c.last, mkPose()) : readCam(cam, mkPose()); this.board0(); h.insideView = false;
        if (h.camMode !== 'cockpit') { c.k = 0; c.dir = 1; }
      }
      if (!b.s2 && b.t > 1.94) { b.s2 = 1; g.sound.door && g.sound.door(); }
      if (b.t >= K.T_IN) { this.beat = null; this.doorNow = 0; if (h.camMode === 'cockpit') { this.c.frozen = null; this.c.dir = 0; this.c.k = 1; h.cam.init = false; } }
      return;
    }
    // out
    this.doorNow = doorOut(b.t);
    if (!b.s1 && b.t > 0.2) { b.s1 = 1; g.sound.door && g.sound.door(); }
    if (!b.anim && b.t > 0.42) { b.anim = 1; this.fade('idle', 0.4); }
    if (!b.s2 && b.t > 1.8) { b.s2 = 1; g.sound.door && g.sound.door(); }
    poseOut(Math.min(b.t, K.T_OUT), this.P); const m = this.toMap(_v2.set(this.P.hip.x, 0, this.P.hip.z), (this._mp ||= {})); pl.x = m.x; pl.y = m.y; pl.h = f.heading + this.P.yaw; h._rx = pl.x; h._ry = pl.y;
    if (b.t >= K.T_OUT) { this.beat = null; h.busy = null; this.doorNow = 0; this.release(); g.playerAnim('idle'); const c = this.c; c.dir = 0; c.k = 0; if (c.last) c.ease = { pose: copyPose(c.last, mkPose()), t: 0, dur: 0.45 }; }
  }
  cancel() { const h = this.h; this.beat = null; h.busy = null; this.stats.cancels++; this.g.playerAnim('idle'); if (this.g.player.vis.mixer) this.g.player.vis.mixer.timeScale = 1; }

  // every drawn frame, after the helicopter has placed its own things
  sync(dt) {
    const g = this.g, h = this.h, pl = g.player, b = this.beat, o = pl.vis.object;
    if (!b) {
      // at the controls, seen from outside: the right hand down on the cyclic and the left on the collective, not on a car's wheel
      if (this.seatHands && h.piloted && o.visible && this.getRig()) { const P = this.P, M = this.matrix(), rig = this.rig, fwd = _fw.set(1, 0, 0).applyQuaternion(o.quaternion), left = _lf.set(0, 0, -1).applyQuaternion(o.quaternion);
        for (const s of ['L', 'R']) { rig.arm(s, _v.copy(s === 'L' ? K.collective : K.cyclic).applyMatrix4(M), _v3.set(0, -1, 0).addScaledVector(left, s === 'L' ? 0.7 : -0.7).addScaledVector(fwd, -0.3), 1); rig.curl(s, s === 'L' ? 0.7 : 0.8); } this.posed = true; }
      else if (this.posed) this.release();
      return;
    }
    if (!o.visible || !this.getRig()) return;
    const M = this.matrix(), Q = h.root.quaternion, P = this.P;
    if (b.kind === 'in' && b.ph === 'walk') {     // walking up: the clip does it; only the height is ours (onto the ground the skids stand on)
      const c = this.toCraft(pl.x, pl.y, _v3); c.y = 0; c.applyMatrix4(M); o.position.y = lerp(b.y0, c.y, ss(b.t, 0, 0.35)); b.yEnd = o.position.y; return;
    }
    if (b.kind === 'in') {
      poseIn(b.t, P); if (b.ph === 'undo') { P.w *= 1 - ss(b.u, 0, 1); P.hL.w *= 1 - ss(b.u, 0, 0.5); }
      if (b.h0 !== undefined && b.t < 0.3) P.yaw = b.h0 + wrapPi(P.yaw - b.h0) * ss(b.t, 0, 0.3);
    } else poseOut(Math.min(b.t, K.T_OUT), P);
    applyPose(this.rig, o, P, M, Q); this.posed = true;
    // the game draws him at street level (0, or 0.15 on a sidewalk); the skids stand on the ground as the helicopter finds it (a lawn is 0.18 up): eased across
    if (!h.piloted) { const gy = pl.alt || (g.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0); _v.set(P.hip.x, 0, P.hip.z).applyMatrix4(M); const k = b.kind === 'in' ? 1 - ss(b.t, 0, 0.3) : ss(b.t, K.T_OUT - 0.3, K.T_OUT), from = b.kind === 'in' ? (b.yEnd ?? b.y0) : gy; if (k > 0 && P.root.y === 0) o.position.y += (from - _v.y) * k; }
  }

  // ------------------------------------------------------------------ the camera: one swing between the on-foot view and the flight view
  camera(dt) {
    const g = this.g, h = this.h, c = this.c, b = this.beat, cam = g.world.camera;
    if ((!b && !c.dir && !c.ease) || (g.fly && g.fly.on) || h.director) { if (!b) { c.dir = 0; c.ease = null; c.frozen = null; } c.last = null; return false; }
    if (c.dir > 0) c.k = Math.min(1, c.k + dt / K.CAM_IN); else if (c.dir < 0) c.k = Math.max(0, c.k - dt / K.CAM_OUT);
    const e = smoother(c.k), A = this.A, B = this.B; let R = null;
    if (e < 1) {     // the on-foot view (as the game and the weapons module would place it), or the one he had when he sat down
      if (c.frozen) copyPose(c.frozen, A); else { const hc = h.hasCamera; h.hasCamera = false; try { this.gcam0(dt); } finally { h.hasCamera = hc; } readCam(cam, A); const C = g.cam; A.tgt.set(C.tx, C.tz + 0.15, -C.ty); }
      R = A;
    }
    if (e > 0) {     // the flight view (chase or far), live
      const C = g.cam, tx = C.tx, ty = C.ty, yaw = C.yaw; this.hcam0(dt); readCam(cam, B); B.tgt.copy(h.cam.tgt); B.tgt.y += h.camMode === 'far' ? 0.5 : 0.2;
      if (e < 1) { C.tx = tx; C.ty = ty; C.yaw = yaw; R = orbitBlend(A, B, e, this.R); } else R = B;
    }
    if (c.ease) { c.ease.t += dt; const m = ss(c.ease.t, 0, c.ease.dur); if (m >= 1) c.ease = null; else R = poseBlend(c.ease.pose, R, m, this.R); }
    cam.position.copy(R.pos); cam.quaternion.copy(R.quat); if (Math.abs(cam.fov - R.fov) > 0.01) { cam.fov = R.fov; cam.updateProjectionMatrix(); }
    c.last = copyPose(R, (c._l ||= mkPose()));
    if (c.dir > 0 && c.k >= 1 && !b) { c.dir = 0; c.frozen = null; }
    return true;
  }
}
const vis0 = (pl) => pl.vis && pl.vis.acts;
function mkPose() { return { pos: V(), quat: new THREE.Quaternion(), fov: 50, tgt: V() }; }
function copyPose(a, o) { o.pos.copy(a.pos); o.quat.copy(a.quat); o.fov = a.fov; o.tgt.copy(a.tgt); return o; }
function readCam(cam, o) { o.pos.copy(cam.position); o.quat.copy(cam.quaternion); o.fov = cam.fov; cam.getWorldDirection(o.tgt).multiplyScalar(3.4).add(cam.position); return o; }
function poseBlend(a, b, k, o) { o.pos.copy(a.pos).lerp(b.pos, k); o.quat.copy(a.quat).slerp(b.quat, k); o.fov = lerp(a.fov, b.fov, k); o.tgt.copy(a.tgt).lerp(b.tgt, k); return o; }
// between two views that each look at something: the looked-at point slides across, the camera swings round it (the short way) and the arm grows; never a straight line through what stands between
const _la = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qr = new THREE.Quaternion();
function lookQuat(pos, tgt, out) { return out.setFromRotationMatrix(_la.lookAt(pos, tgt, UP)); }
function orbitBlend(a, b, k, o) {
  o.tgt.copy(a.tgt).lerp(b.tgt, k);
  const ax = a.pos.x - a.tgt.x, ay = a.pos.y - a.tgt.y, az = a.pos.z - a.tgt.z, bx = b.pos.x - b.tgt.x, by = b.pos.y - b.tgt.y, bz = b.pos.z - b.tgt.z;
  const ra = Math.hypot(ax, ay, az) || 1e-3, rb = Math.hypot(bx, by, bz) || 1e-3, ya = Math.atan2(az, ax), yb = Math.atan2(bz, bx), pa = Math.asin(clamp(ay / ra, -1, 1)), pb = Math.asin(clamp(by / rb, -1, 1));
  const r = lerp(ra, rb, k), y = ya + wrapPi(yb - ya) * k, p = lerp(pa, pb, k);
  o.pos.set(o.tgt.x + Math.cos(y) * Math.cos(p) * r, o.tgt.y + Math.sin(p) * r, o.tgt.z + Math.sin(y) * Math.cos(p) * r);
  // each end's own turn away from a plain look-at (the on-foot view's tilt, the flight view's bank) is carried across
  lookQuat(a.pos, a.tgt, _qa).invert().multiply(a.quat); lookQuat(b.pos, b.tgt, _qb).invert().multiply(b.quat); _qr.copy(_qa).slerp(_qb, k);
  lookQuat(o.pos, o.tgt, o.quat).multiply(_qr); o.fov = lerp(a.fov, b.fov, k); return o;
}

export async function addHeliBoard(heli) { const b = new HeliBoard(heli); await b.init(); heli.hb = b; console.log('[hboard] helicopter boarding beat on (?hboard=0 for the old one)'); return b; }
