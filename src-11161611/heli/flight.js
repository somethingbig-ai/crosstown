// flight.js: the helicopter's flight model. A rigid body with a rotor: thrust from blade pitch and inflow (so climb, descent, translational
// lift, ground effect and the vortex ring all fall out of one equation), rotor speed as a state driven by a governed turbine (pull more than
// the engine has and the rotor droops; cut the engine and it autorotates), disc tilt for control with flapback, a tail rotor against
// the main rotor's torque, fuselage drag, tail surfaces, wind with gusts, and sprung skids for landing on streets and roofs.
// On top of it sits the stability system a modern light helicopter has (attitude command, height hold, heading hold); 'sim' turns it off.
// Axes (three.js world): x east, y up, z south. Body: +X nose, +Y up, +Z right. Positive yaw (about +Y) swings the nose LEFT.
import * as THREE from 'three';
import { DIMS } from './dims.js';

const RHO = 1.225, G = 9.81;
export const SPEC = {
  mass: 2050, I: new THREE.Vector3(1700, 6200, 6800),     // roll (X), yaw (Y), pitch (Z) inertia, kg m2
  R: DIMS.rotorR, omega0: DIMS.rpm * Math.PI / 30, Irotor: 1250,
  sigma: DIMS.blades * DIMS.chord / (Math.PI * DIMS.rotorR), liftSlope: 5.7, cd0: 0.0105,
  thetaMin: 0.004, thetaMax: 0.262,      // blade pitch at collective 0 and 1 (rad)
  powerMax: 590e3, powerIdleN1: 0.67,
  hubY: DIMS.rotorY - DIMS.cg[1], hubK: 26000,            // hub above the CG; hub stiffness N m per rad of disc tilt
  tiltMax: 0.125,                                          // disc tilt at full cyclic (rad)
  tailArm: -DIMS.tailRotor[0], tailMax: 3800,              // tail rotor thrust at full pedal, N
  cdA: new THREE.Vector3(1.35, 5.2, 6.4),                  // flat-plate drag areas: front, top, side (m2)
};
const A = Math.PI * SPEC.R * SPEC.R;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _p = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3();

// Wind: a steady wind aloft with slow gusts and finer turbulence, weaker down in the street canyons, rougher just above the roofs.
export class Wind {
  constructor(speed = 5.5, fromDeg = 250) { this.speed = speed; this.from = fromDeg; this.t = 0; this.out = new THREE.Vector3(); }
  n(x, s) { return Math.sin(x * 1.0 + s) * 0.5 + Math.sin(x * 2.31 + s * 1.7) * 0.3 + Math.sin(x * 5.13 + s * 2.9) * 0.2; }
  // p: world position; roof: height of the ground or roof below; skyline: typical roof height around (for the canyon factor)
  at(p, t, agl, skyline = 40) {
    const a = (270 - this.from) * Math.PI / 180;      // direction the air moves TO, as a map heading (x east, y north)
    const y = p.y, shelter = clamp((y - 6) / Math.max(12, skyline), 0.18, 1);     // sheltered between the buildings
    const gust = 1 + 0.32 * this.n(t * 0.21 + p.x * 0.004, 1.3) + 0.14 * this.n(t * 0.9 + p.z * 0.01, 4.1);
    const rough = clamp(1.6 - Math.abs(agl - 6) / 25, 0.5, 1.6) * (0.35 + 0.65 * shelter);    // mechanical turbulence near roof level
    const sp = this.speed * shelter * gust, veer = 0.25 * this.n(t * 0.13 + p.z * 0.003, 7.7);
    this.out.set(Math.cos(a + veer) * sp + this.n(t * 1.9 + p.y * 0.05, 2.2) * rough * this.speed * 0.16, this.n(t * 1.4 + p.x * 0.03, 9.4) * rough * this.speed * 0.13, -Math.sin(a + veer) * sp + this.n(t * 1.6 + p.x * 0.04, 5.5) * rough * this.speed * 0.16);
    return this.out;
  }
}

export class Flight {
  // env: { ground(x, zThree, yProbe) -> height of ground or roof (m), escape(p, out) optional for walls, wind: Wind }
  constructor(env) {
    this.env = env;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.w = new THREE.Vector3();     // w: body rates (roll, yaw, pitch about X, Y, Z)
    this.nr = 0; this.n1 = 0; this.engine = 'off'; this.startT = 0; this.rotorAngle = 0; this.tailAngle = 0;
    this.collective = 0; this.cyc = { lon: 0, lat: 0 }; this.pedal = 0;      // actual control positions: collective 0..1, cyclic -1..1 (lon + = stick forward, lat + = right), pedal -1..1 (+ = right pedal, nose right)
    this.vi = 0; this.thrust = 0; this.power = 0; this.torque = 0; this.groundFx = 1; this.vrs = 0; this.etl = 0;
    this.assist = 'easy'; this.trimPitch = 0; this.hoverCol = 0.56; this.hdgHold = null; this.altHold = null;
    this.onGround = true; this.contactN = 0; this.agl = 0; this.surface = 0; this.gLoad = 1; this.damage = 0; this.hits = [];      // hits: [{p, speed, kind}] this step, for sound and sparks
    this.sweep = true; this.sn = 0; this.rescued = 0; this.wreckRest = false;     /* gameplay/heli, Nov 14: sweep = the floor rule and the guard below (heli.js clears it for ?hwreck=0) */
    this.t = 0; this.acc = new THREE.Vector3(); this.airBody = new THREE.Vector3(); this.wind = new THREE.Vector3(); this.coning = 0; this.disc = { lon: 0, lat: 0 }; this.ball = 0;
    this.contacts = DIMS.contacts.map((c) => new THREE.Vector3(c[0] - DIMS.cg[0], c[1] - DIMS.cg[1], c[2] - DIMS.cg[2]));
    this.hull = DIMS.hull.map((c) => ({ p: new THREE.Vector3(c[0] - DIMS.cg[0], c[1] - DIMS.cg[1], c[2] - DIMS.cg[2]), rotor: false }));
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; this.hull.push({ p: new THREE.Vector3(Math.cos(a) * SPEC.R * 0.97, SPEC.hubY, Math.sin(a) * SPEC.R * 0.97), rotor: true }); }
    this.hull.push({ p: new THREE.Vector3(DIMS.tailRotor[0], DIMS.tailRotor[1] - DIMS.cg[1] - DIMS.tailRotorR, DIMS.tailRotor[2]), rotor: true, tail: true });
    this.hull.push({ p: new THREE.Vector3(0, SPEC.hubY + 0.12, 0), rotor: false, mast: true });     /* gameplay/heli: the mast top (not used with sweep off) */
  }
  // put it down on its skids at a map position (x east, y north), heading h (0 = east, counter-clockwise), on whatever is below
  place(x, y, h, height) {
    const gy = height !== undefined ? height : this.env.ground(x, -y, 1e4);
    this.pos.set(x, gy + DIMS.cg[1] - 0.012, -y); this.quat.setFromAxisAngle(_v.set(0, 1, 0), h); this.vel.set(0, 0, 0); this.w.set(0, 0, 0); this.onGround = true; this.surface = gy; this.agl = 0; this.wreckRest = false; this.restT = 0; this.inT = 0; if (this.good) this.good.pos.copy(this.pos);
  }
  // straight into flight (for tests, cameras and the demo): in the air at a height above the surface below, rotor at speed, trimmed
  airborne(x, y, h, agl, speed = 0) {
    this.place(x, y, h); this.pos.y += agl; this.engine = 'run'; this.n1 = 0.9; this.nr = 1; this.collective = this.hoverCol; this.vi = 9.5; this.onGround = false;
    this.vel.set(Math.cos(h) * speed, 0, -Math.sin(h) * speed); this.altHold = null; this.hdgHold = h;
  }
  get heading() { _fw.set(1, 0, 0).applyQuaternion(this.quat); return Math.atan2(-_fw.z, _fw.x); }
  get pitch() { _fw.set(1, 0, 0).applyQuaternion(this.quat); return Math.asin(clamp(_fw.y, -1, 1)); }     // nose up positive
  get roll() { _r.set(0, 0, 1).applyQuaternion(this.quat); return -Math.asin(clamp(_r.y, -1, 1)); }      // right side down positive
  get ias() { return this.airBody.length(); }
  get vs() { return this.vel.y; }

  // cmd: { pitch: -1..1 (+ = nose down / go forward), roll: -1..1 (+ = right), yaw: -1..1 (+ = nose right), lift: -1..1 (+ = up),
  //        engine: true to toggle, direct: {lon, lat} extra raw cyclic (mouse) }
  step(dt, cmd) {
    const n = 2, h = dt / n; this.hits.length = 0;
    if (this.wreckRest) { this.t += dt; this.vel.set(0, 0, 0); this.w.set(0, 0, 0); return; }     /* gameplay/heli: a written-off airframe that has come to rest on a surface is left there (nothing in the game moves a helicopter but itself) */
    if (cmd.engine) this.toggleEngine();
    for (let i = 0; i < n; i++) { this.pilot(h, cmd); this.sub(h); }
    this.t += dt; if (this.sweep) this.guard(dt);
  }
  /* gameplay/heli, Nov 14: the last line of defence, once a step: one ground reading and a few comparisons. Whatever went wrong before it, the aircraft is never
     left below the street, inside a solid, or with a number that is not a number. Each catch is counted (this.rescued) and written to the console
     ('[heli] wreck guard: ...'; feedback.js keeps console lines, so reports carry it). */
  guard(dt) {
    const S = this, p = S.pos, q = S.quat, env = S.env, CG = DIMS.cg[1], G0 = S.good || (S.good = { pos: p.clone(), quat: q.clone() });
    const fin = (a) => Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z) < 1e7;     // false for NaN and for Infinity
    let why = '', was = '';
    if (!(fin(p) && fin(S.vel) && fin(S.w) && Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) + Math.abs(q.w) < 9 && Math.abs(S.nr) + Math.abs(S.vi) + Math.abs(S.collective) + Math.abs(S.n1) + Math.abs(S.cyc.lon) + Math.abs(S.cyc.lat) + Math.abs(S.pedal) < 1e7)) {
      why = 'a number that is not a number'; was = [p.x, -p.z, p.y].map((v) => (v === v ? v.toFixed(1) : 'NaN')).join(', ');
      p.copy(G0.pos); q.copy(G0.quat); S.nr = S.n1 = S.vi = S.vrs = S.collective = S.pedal = 0; S.cyc.lon = S.cyc.lat = 0; S.iP = S.iR = S.iY = S.iC = S.wantP = S.wantR = S.vsCmd = 0; S.colLim = 1; S.simCol = undefined; S.altHold = S.hdgHold = null;
      S.acc.set(0, 0, 0); S.airBody.set(0, 0, 0); S.surface = env.ground(p.x, p.z, 1e4); S.damage = 1; if (S.engine !== 'off') S.engine = 'fail';
    } else {
      const gy = env.ground(p.x, p.z, p.y + 1.2);
      if (p.y < -0.5) why = 'below the street';
      else if (gy - p.y > 1.6) { S.inT = (S.inT || 0) + dt; if (S.inT > 1.5) why = 'inside a solid'; }
      else { S.inT = 0; if ((S.goodT = (S.goodT || 0) + dt) > 0.25) { S.goodT = 0; G0.pos.copy(p); G0.quat.copy(q); } return; }
      if (!why) return; was = p.x.toFixed(1) + ', ' + (-p.z).toFixed(1) + ', ' + p.y.toFixed(1);
    }
    // put back: out the nearest open way at its own height if there is one (it then falls as it should); else onto the nearest street within 60 m; else onto the roof above it
    let put = '';
    if (why === 'inside a solid' && env.escape && env.escape(p.x, p.y, p.z, _p)) { const d = Math.hypot(_p.x, _p.z) || 1; p.x += _p.x * (1 + 4 / d); p.z += _p.z * (1 + 4 / d); put = 'moved out sideways'; }
    else {
      let top = env.ground(p.x, p.z, 1e4), found = top <= 0.5;
      if (!found) for (const r of [4, 8, 12, 18, 25, 35, 45, 60]) { for (let i = 0; i < 16 && !found; i++) { const a = i * Math.PI / 8, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (env.ground(x, z, 1e4) <= 0.5 && env.ground(x + 3, z, 1e4) <= 0.5 && env.ground(x - 3, z, 1e4) <= 0.5 && env.ground(x, z + 3, 1e4) <= 0.5 && env.ground(x, z - 3, 1e4) <= 0.5) { p.x = x; p.z = z; top = env.ground(x, z, 1e4); found = true; } } if (found) break; }
      const hd = S.heading; q.setFromAxisAngle(_v.set(0, 1, 0), hd === hd ? hd : 0);     // upright, nose where it was: any other way up, some point of it would be back under the surface
      p.y = top + CG + 0.35; put = found ? 'stood on the street' : 'stood on the roof above';
    }
    S.vel.set(0, 0, 0); S.w.set(0, 0, 0); S.inT = 0; S.wreckRest = false; S.restT = 0; G0.pos.copy(p); G0.quat.copy(q); S.rescued++;
    if (S.rescued <= 20) console.log('[heli] wreck guard: ' + why + ' at ' + was + ' (map x, y, height; damage ' + S.damage.toFixed(2) + ', engine ' + S.engine + '): ' + put + ' at ' + p.x.toFixed(1) + ', ' + (-p.z).toFixed(1) + ', ' + p.y.toFixed(1) + ' (catch ' + S.rescued + ')');
  }
  toggleEngine() { if (this.engine === 'off' || this.engine === 'fail') { if (this.damage < 1) { this.engine = 'starting'; this.startT = 0; } } else this.engine = 'off'; }

  // ---------------------------------------------------------------- the pilot's hands and the stability system
  pilot(dt, cmd) {
    const S = this, sim = S.assist === 'sim', air = !S.onGround, run = air ? S.nr > 0.5 : (S.engine === 'run' && S.nr > 0.93);
    const hd = S.heading, ch = Math.cos(hd), sh = Math.sin(hd);
    // ground speed along and across the nose (level frame)
    const vf = S.vel.x * ch - S.vel.z * sh, vr = S.vel.x * sh + S.vel.z * ch, sp = Math.hypot(vf, vr);
    let lon, lat, ped, col;
    if (sim) {
      // the stick moves the swashplate; only the rotor's own damping steadies it
      lon = clamp(cmd.pitch + (cmd.direct ? cmd.direct.lon : 0), -1, 1); lat = clamp(cmd.roll + (cmd.direct ? cmd.direct.lat : 0), -1, 1); ped = cmd.yaw;
      S.simCol = clamp((S.simCol === undefined ? S.collective : S.simCol) + cmd.lift * dt * 0.45, 0, 1); col = S.simCol;
    } else {
      S.simCol = undefined;
      // attitude command: the stick asks for a nose-down angle and a bank; hands off, it levels and eases toward a hover
      const any = Math.abs(cmd.pitch) > 0.05 || Math.abs(cmd.roll) > 0.05 || (cmd.direct && (Math.abs(cmd.direct.lon) + Math.abs(cmd.direct.lat)) > 0.03);
      let wantP = -(cmd.pitch + (cmd.direct ? cmd.direct.lon : 0)) * (cmd.pitch > 0 ? 0.25 : 0.33), wantR = (cmd.roll + (cmd.direct ? cmd.direct.lat : 0)) * 0.62;
      if (!any && air) {     // hands off: a gentle brake toward the hover, at most ~9 degrees, softer when already slow
        const k = clamp(sp / 6, 0.25, 1); wantP += clamp(vf * 0.022, -0.16, 0.16) * k; wantR += clamp(-vr * 0.03, -0.14, 0.14) * k;
      } else if (air) { wantR += clamp(-vr * 0.012, -0.08, 0.08) * (Math.abs(cmd.roll) < 0.05 ? 1 : 0); }     // only pitch commanded: keep it from drifting sideways
      if (S.engine !== 'run' && air && S.agl < 28 && vf > 9) wantP += 0.2 * clamp((28 - S.agl) / 14, 0, 1);      // engine out near the ground: it helps with the flare
      if (!air) { wantP = clamp(wantP, -0.04, 0.04); wantR = clamp(wantR, -0.04, 0.04); }
      S.wantP = (S.wantP || 0) + (wantP - (S.wantP || 0)) * Math.min(1, dt * 5); S.wantR = (S.wantR || 0) + (wantR - (S.wantR || 0)) * Math.min(1, dt * 6);
      const eP = S.wantP - S.pitch, eR = S.wantR - S.roll;
      // slow integrator trims out what the tail rotor and the wind push on
      S.iP = clamp((S.iP || 0) + eP * dt * (air ? 1.4 : 0), -0.5, 0.5); S.iR = clamp((S.iR || 0) + eR * dt * (air ? 1.4 : 0), -0.5, 0.5);
      lon = clamp(-(eP * 5.2 + S.iP - S.w.z * 1.25), -1, 1); lat = clamp(eR * 4.2 + S.iR - S.w.x * 0.55, -1, 1);
      // pedals: a yaw rate asked for, heading held otherwise; at speed the fin and a coordinated-turn rate do the turning
      const fast = clamp((sp - 8) / 14, 0, 1);
      const turning = Math.abs(cmd.roll) > 0.05 || (cmd.direct && Math.abs(cmd.direct.lat) > 0.03);
      let wantYaw = -cmd.yaw * (1.15 - 0.85 * fast);     // rad/s, positive = nose left
      if (air && turning) wantYaw += fast * (-G * Math.tan(clamp(S.wantR, -1, 1)) / Math.max(sp, 8));
      if (Math.abs(cmd.yaw) > 0.05 || (turning && fast > 0.05) || !air) S.hdgHold = null; else if (S.hdgHold === null && Math.abs(S.w.y) < 0.25) S.hdgHold = hd;
      if (S.hdgHold !== null) { let e = S.hdgHold - hd; e = Math.atan2(Math.sin(e), Math.cos(e)); wantYaw += clamp(e * 2.2, -0.6, 0.6); }
      S.iY = clamp((S.iY || 0) + (wantYaw - S.w.y) * dt * 2.5, -1, 1);
      ped = clamp(-((wantYaw - S.w.y) * 1.6 + S.iY), -1, 1); if (!air && S.collective < 0.25) { ped = 0; S.iY = 0; }     // feet still while it sits on its skids
      // collective: the lever asks for a rate of climb; centred, it holds the height. On the ground with the lever down it sits flat.
      const up = cmd.lift;
      if (!run) { col = 0; S.altHold = null; }
      else if (!air && up <= 0.05) { col = Math.max(0, S.collective - dt * 0.6); S.altHold = null; S.iC = 0; }
      else {
        let wantVs = up > 0 ? up * 9.5 : up * 11;
        if (Math.abs(up) < 0.05) { if (S.altHold === null && Math.abs(S.vel.y) < 2.5) S.altHold = S.pos.y; if (S.altHold !== null) wantVs = clamp((S.altHold - S.pos.y) * 1.2, -3, 3); else wantVs = 0; } else S.altHold = null;
        if (S.engine !== 'run') { wantVs = Math.min(wantVs, 0); }
        wantVs = Math.max(wantVs, -(0.55 + Math.max(0, S.agl - 0.3) * 0.5));       // it will not let you fly it into the ground: the last metres come down at a walking pace
        S.vsCmd = (S.vsCmd || 0) + clamp(wantVs - (S.vsCmd || 0), -dt * 9, dt * 9); wantVs = S.vsCmd;
        const eV = wantVs - S.vel.y; S.iC = clamp((S.iC || 0) + eV * dt * 0.05, -0.3, 0.3);
        col = clamp(S.hoverCol + eV * 0.055 + S.iC - S.acc.y * 0.004, 0, 1);
        // the torque limit: no more lever than the engine can turn (pulling through it only droops the rotor)
        S.colLim = clamp((S.colLim === undefined ? 1 : S.colLim) + ((S.torque > 1.0 || S.nr < 0.975) && S.engine === 'run' ? -dt * 0.5 : dt * 0.12), 0.5, 1); col = Math.min(col, S.colLim);
        // engine out: what a pilot is drilled to do. Lever down to keep the rotor turning on the air coming up through it; then, close to
        // the ground, the rotor's stored energy is spent through the lever to stop the sink (the height hold above does that part).
        if (S.engine !== 'run' && air && S.agl > clamp(S.vel.y * S.vel.y / 7 + 1.5, 2.5, 16)) { col = clamp(0.08 + (S.nr - 1.02) * 2.2 + (up > 0 ? up * 0.25 : 0), 0, 0.55); S.altHold = null; S.iC = 0; S.vsCmd = S.vel.y; }
      }
    }
    // the controls themselves take a moment to move (hydraulic servos, a hand on a lever)
    const k = Math.min(1, dt * 14);
    S.cyc.lon += (lon - S.cyc.lon) * k; S.cyc.lat += (lat - S.cyc.lat) * k; S.pedal += (ped - S.pedal) * Math.min(1, dt * 12);
    S.collective += clamp(col - S.collective, -dt * 1.6, dt * 1.6);
  }

  // ---------------------------------------------------------------- one physics step
  sub(dt) {
    const S = this, P = SPEC, env = S.env; S.sn++;
    // surface below, height above it
    const gy = env.ground(S.pos.x, S.pos.z, S.pos.y); S.surface += (gy - S.surface) * Math.min(1, dt * 6); S.agl = S.pos.y - DIMS.cg[1] - gy;
    // air: wind where we are, air-relative velocity in body axes
    const wnd = env.wind ? env.wind.at(S.pos, S.t, S.agl, env.skyline ? env.skyline(S.pos.x, S.pos.z) : 40) : _v.set(0, 0, 0); S.wind.copy(wnd);
    _qi.copy(S.quat).invert();
    const air = S.airBody.copy(S.vel).sub(wnd).applyQuaternion(_qi);       // body-frame velocity through the air
    // ---- engine and rotor speed
    if (S.engine === 'starting') { S.startT += dt; S.n1 = Math.min(P.powerIdleN1 + 0.25, S.n1 + dt * (S.startT < 1.0 ? 0.08 : 0.2)); if (S.nr > 0.97 && S.n1 > 0.8) S.engine = 'run'; }
    else if (S.engine === 'run') { /* governed below */ }
    else S.n1 = Math.max(0, S.n1 - dt * (S.n1 > 0.3 ? 0.22 : 0.05));
    const Om = Math.max(S.nr, 0.02) * P.omega0, tip = Om * P.R;
    // ---- main rotor: disc tilt from cyclic, flapback and the body's own rates
    const u = air.x, wv = air.z, vc0 = air.y;       // forward, rightward, upward speed of the body through the air
    const fb = 0.0011 * (0.4 + S.collective);        // the disc blows back from the wind across it
    const lonT = S.cyc.lon * P.tiltMax - u * fb + S.w.z * 0.05, latT = S.cyc.lat * P.tiltMax - wv * fb * 0.8 - S.w.x * 0.04;
    S.disc.lon = lonT; S.disc.lat = latT;
    const nx = Math.sin(lonT), nz = Math.sin(latT), ny = Math.sqrt(Math.max(0.5, 1 - nx * nx - nz * nz));     // thrust direction in body axes
    const vc = u * nx + vc0 * ny + wv * nz;          // air speed along the thrust line (positive: the disc is climbing through the air)
    const vh2 = Math.max(0, air.lengthSq() - vc * vc), mu = Math.sqrt(vh2) / Math.max(tip, 30);
    const theta = P.thetaMin + (P.thetaMax - P.thetaMin) * S.collective;
    const lam = (vc + S.vi) / Math.max(tip, 30);
    let T = 0.5 * RHO * P.liftSlope * P.sigma * A * tip * tip * (theta / 3 * (1 + 1.5 * mu * mu) - lam / 2);
    T = clamp(T, -0.25 * P.mass * G, 2.6 * P.mass * G);
    // ground effect: the cushion under the disc near a surface, fading with forward speed (it comes back over a roof edge)
    const zr = Math.max(S.pos.y + P.hubY - S.surface, 1.2), ge = 1 / (1 - Math.min(0.26, ((P.R / (4 * zr)) ** 2) / (1 + (mu / Math.max(Math.abs(lam), 0.02)) ** 2 * 0.25)));
    S.groundFx = ge; T *= ge;
    // vortex ring: sinking fast through your own downwash with little forward speed. The thrust goes soft and the machine shudders.
    const vh = Math.sqrt(P.mass * G / (2 * RHO * A)), sink = -vc / vh, slow = clamp(1 - Math.sqrt(vh2) / (vh * 0.9), 0, 1);
    const vrs = clamp((sink - 0.55) / 0.35, 0, 1) * clamp((1.75 - sink) / 0.4, 0, 1) * slow * (S.nr > 0.6 ? 1 : 0); S.vrs += (vrs - S.vrs) * Math.min(1, dt * 2.5);
    T *= 1 - 0.34 * S.vrs; if (S.vrs > 0.05) T *= 1 + 0.16 * S.vrs * Math.sin(S.t * 31 + Math.sin(S.t * 13.7) * 2);
    // induced velocity follows the thrust with a short lag (momentum theory, kept finite in the vortex ring)
    const viT = T > 0 ? T / (2 * RHO * A * Math.max(Math.sqrt(vh2 + (vc + S.vi) ** 2), vh * 0.55)) : 0;
    S.vi += (viT - S.vi) * Math.min(1, dt * 7);
    S.etl = clamp(Math.sqrt(vh2) / 12, 0, 1);
    // power the rotor asks for: induced + profile + tail rotor; negative when the air drives it (autorotation)
    const Pind = 1.13 * T * (vc + S.vi), Ppro = P.sigma * P.cd0 / 8 * RHO * A * tip ** 3 * (1 + 4.6 * mu * mu), Ptail = 0.07 * Math.abs(Pind) + 9e3 * Math.abs(S.pedal) * S.nr ** 3;
    const Preq = Pind + Ppro + Ptail + 12e3 * S.nr;       // + gearbox and accessories
    let Qeng = 0;
    if (S.engine === 'run' || S.engine === 'starting') {
      const avail = P.powerMax * clamp((S.n1 - 0.45) / 0.55, 0, 1) ** 1.6;
      const want = S.engine === 'run' ? Math.max(0, Preq + (1.0 - S.nr) * 4.2e6) : (S.nr < 1 ? 330e3 * clamp(0.25 + S.nr, 0, 1) : 0);     // the governor holds 100 % rotor speed
      if (S.engine === 'run') { const n1w = clamp(0.67 + 0.34 * Math.sqrt(clamp(want / P.powerMax, 0, 1.05)), 0.67, 1.02); S.n1 += clamp(n1w - S.n1, -dt * 0.28, dt * 0.36); }
      S.power = Math.min(want, avail); Qeng = S.power / Math.max(Om, 4);
    } else S.power = 0;
    const Qreq = Preq / Math.max(Om, 4) + (S.nr > 1.12 ? (S.nr - 1.12) * 6e4 : 0) + (S.nr < 0.2 && S.engine === 'off' ? 220 : 0);     // + rotor brake at the bottom
    S.nr = clamp(S.nr + (Qeng - Qreq) / (P.Irotor * P.omega0) * dt, 0, 1.25);
    S.torque = Qeng / (P.powerMax / P.omega0);
    S.thrust = T; S.coning = clamp(T / (P.mass * G) * 0.062 / Math.max(S.nr * S.nr, 0.08), -0.02, 0.2) * (S.nr > 0.25 ? 1 : S.nr * 4) - (1 - Math.min(1, S.nr * 2.2)) * 0.055;     // blades cone up under load, droop at rest
    S.rotorAngle = (S.rotorAngle + Om * dt) % (Math.PI * 2); S.tailAngle = (S.tailAngle + Om * (DIMS.tailRpm / DIMS.rpm) * dt) % (Math.PI * 2);
    // ---- forces (body axes), moments about the CG
    const F = _f.set(T * nx, T * ny, T * nz), M = _m.set(P.hubY * F.z + P.hubK * latT * S.nr * S.nr, 0, -P.hubY * F.x - P.hubK * lonT * S.nr * S.nr);
    // rotor damping of the body's rates
    M.x -= S.w.x * 5200 * S.nr; M.z -= S.w.z * 11500 * S.nr;
    // torque reaction (clockwise rotor: nose goes left = +yaw) and the tail rotor
    const q = 0.5 * RHO;
    const anti = 0.82 * Qeng * clamp(S.nr * 1.2, 0, 1);       // the rigging: neutral pedals cancel most of the torque, the rest is for the feet (or the heading hold)
    const Ttr = S.pedal * P.tailMax * S.nr * S.nr;            // pedal thrust, + = nose right
    M.y += Qeng - anti - Ttr * P.tailArm;
    F.z -= (anti / P.tailArm + Ttr) * 0.6;                    // the tail rotor also pushes the whole machine sideways (it hovers one skid low)
    M.y -= S.w.y * (9000 * S.nr * S.nr + 500);                // tail rotor yaw damping
    // tail surfaces: the fin turns the nose into the airflow, the stabiliser steadies the pitch
    const au = Math.abs(u) + 2, vFin = wv + 6.4 * S.w.y + 0.5 * S.w.x, wTail = vc0 - 6.0 * S.w.z;
    M.y -= q * 3.0 * au * vFin * 6.4; F.z -= q * 3.0 * au * vFin;
    M.z += q * 2.4 * au * wTail * 6.0; F.y -= q * 2.4 * au * wTail;
    // fuselage drag
    F.x -= q * P.cdA.x * u * Math.abs(u); F.y -= q * P.cdA.y * vc0 * Math.abs(vc0) * 0.5; F.z -= q * P.cdA.z * wv * Math.abs(wv);
    // downwash on the fuselage in the hover
    F.y -= 0.035 * Math.max(T, 0) * (1 - S.etl);
    S.ball = clamp(-(F.z) / (P.mass * G) * 6, -1, 1);
    // ---- to the world, gravity, contacts
    const Fw = _v.copy(F).applyQuaternion(S.quat); Fw.y -= P.mass * G;
    S.contactN = 0; let skidsDown = 0, lift = 0, touch = false;
    const contact = (bp, kind) => {
      const rw = _r.copy(bp).applyQuaternion(S.quat), px = S.pos.x + rw.x, py = S.pos.y + rw.y, pz = S.pos.z + rw.z;
      const g0 = env.ground(px, pz, py + 1.2), pen = g0 - py;
      /* gameplay/heli, Nov 14: FLOOR OR WALL. A point more than 1.6 m under the surface was always taken for "inside a wall" and given a sideways push only (or
         nothing at all where no open spot lay within 12 m, which is everywhere below the street): so an arrival faster than the skid springs can stop within
         1.6 m (about 35 m/s and up) went through the street or the roof and fell for ever. Now a point that came down onto the surface from above it, or was
         standing on it a moment ago, stays a point on a FLOOR however deep it is driven; only a point that came in from the side under a higher surface is in a wall. */
      const fresh = bp.ln === S.sn - 1, ly = fresh ? bp.ly : undefined, wasFl = fresh && bp.fl; bp.ly = py; bp.ln = S.sn; bp.fl = false;
      if (pen <= 0) return; touch = true;
      const floor = pen < 1.6 || !env.escape || (S.sweep && (ly >= g0 - 1.6 || (wasFl && Math.abs(g0 - bp.fg) < 1.6)));
      // velocity of the point
      _w.copy(S.w).applyQuaternion(S.quat); const vx = S.vel.x + (_w.y * rw.z - _w.z * rw.y), vy = S.vel.y + (_w.z * rw.x - _w.x * rw.z), vz = S.vel.z + (_w.x * rw.y - _w.y * rw.x);
      let fx = 0, fy = 0, fz = 0; const soft = kind === 'rotor' && S.sweep && S.damage >= 1 && S.nr < 0.3 ? 0.1 : 1;     /* gameplay/heli: broken blades bend */
      if (floor) {      // standing on it (street, roof)
        bp.fl = true; bp.fg = g0; if (S.sweep && pen > 1.0 && kind !== 'rotor') lift = Math.max(lift, pen - 1.0);     /* driven deeper than the springs reach: the airframe is held at that depth (below) */
        const k = (kind === 'skid' ? 135e3 : 90e3) * soft, c = (kind === 'skid' ? 12500 : 9000) * soft; let N = Math.max(0, k * Math.min(pen, 0.5) - c * vy); N = Math.min(N, P.mass * G * 6);
        const vt2 = Math.hypot(vx, vz), mu0 = kind === 'skid' ? 0.6 : 0.5, ft = vt2 > 1e-4 ? Math.min(mu0 * N / vt2, 16000 * soft) : 0;
        fx = -vx * ft; fy = N; fz = -vz * ft; S.contactN += N; if (kind === 'skid') skidsDown++;
        if (vy < -1.8 || (kind !== 'skid' && (vy < -0.6 || vt2 > 1.5))) S.hits.push({ x: px, y: py, z: pz, speed: Math.hypot(vy, kind === 'skid' ? 0 : vt2), kind });
      } else {      // inside a wall: out the nearest way
        const e = env.escape(px, py, pz, _p); if (!e) return; const d = Math.hypot(_p.x, _p.z) || 1, ex = _p.x / d, ez = _p.z / d, vn = vx * ex + vz * ez;
        const N = Math.min(60e3 * Math.min(d, 2.5) - 14000 * Math.min(vn, 0) * 1, P.mass * G * 8) * soft; fx = ex * N; fz = ez * N; if (vn < -0.5) S.hits.push({ x: px, y: py, z: pz, speed: -vn, kind: kind === 'skid' ? 'hull' : kind });
        fx -= (vx - vn * ex) * 3000; fz -= (vz - vn * ez) * 3000; fy -= vy * 1500;
      }
      Fw.x += fx; Fw.y += fy; Fw.z += fz;
      // moment about the CG, back in body axes
      _p.set(rw.y * fz - rw.z * fy, rw.z * fx - rw.x * fz, rw.x * fy - rw.y * fx).applyQuaternion(_qi); M.add(_p);
    };
    if (S.agl < 4 || S.onGround) for (const c of S.contacts) contact(c, 'skid');
    for (const hp of S.hull) { if (hp.mast && !S.sweep) continue; contact(hp.p, hp.rotor ? 'rotor' : 'hull'); }
    S.onGround = skidsDown >= 2;
    if (lift > 0) { S.pos.y += lift; if (S.vel.y < 0) S.vel.y = 0; }     /* gameplay/heli: the ground does not give more than a metre: what is left of the fall ends here (the hit that did it is already in S.hits, at its speed) */
    let worst = 0; for (const hit of S.hits) { if (hit.done) continue; hit.done = true; if (hit.kind === 'rotor') { S.nr = Math.max(0, S.nr - 0.02 * Math.min(hit.speed + 2, 10)); worst = Math.max(worst, 0.02 + hit.speed * 0.01); } else if (hit.speed > 2.6) worst = Math.max(worst, (hit.speed - 2.6) ** 1.5 * (hit.kind === 'skid' ? 0.035 : 0.06)); }
    S.hitCool = Math.max(0, (S.hitCool || 0) - dt); if (worst > 0 && (S.hitCool <= 0 || worst > 0.3)) { S.damage = Math.min(1, S.damage + worst); S.hitCool = 0.25; }
    if (S.damage >= 1 && (S.engine === 'run' || S.engine === 'starting')) S.engine = 'fail';
    // ---- integrate
    S.acc.copy(Fw).multiplyScalar(1 / P.mass); S.gLoad = (S.acc.y + G) / G;
    S.vel.addScaledVector(S.acc, dt); S.pos.addScaledVector(S.vel, dt);
    const I = P.I, w = S.w;
    w.x += (M.x - (I.z - I.y) * w.y * w.z) / I.x * dt; w.y += (M.y - (I.x - I.z) * w.z * w.x) / I.y * dt; w.z += (M.z - (I.y - I.x) * w.x * w.y) / I.z * dt;
    w.x = clamp(w.x, -6, 6); w.y = clamp(w.y, -6, 6); w.z = clamp(w.z, -6, 6);
    _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1).normalize(); S.quat.multiply(_q).normalize();
    /* gameplay/heli: a written-off airframe grinding on a surface or a wall loses its speed and its spin, and once it has lain within 0.3 m of one spot for a second and a half, carried by a surface and not inside a solid (the guard's business), it is left at rest (S.wreckRest; place() wakes it) */
    if (S.sweep && S.damage >= 1 && touch && S.nr < 0.3) { const kd = 1 - Math.min(1, dt * 2.5); S.vel.x *= kd; S.vel.z *= kd; if (S.contactN > 0) S.vel.y *= kd;     /* against a wall only, it still falls at its own speed */ w.multiplyScalar(1 - Math.min(1, dt * 5));
      if (!S.restP) S.restP = S.pos.clone(); if (S.nr > 0.01 || S.inT > 0 || S.contactN < P.mass * G * 0.3 || w.lengthSq() > 1 || S.pos.distanceToSquared(S.restP) > 0.09) { S.restP.copy(S.pos); S.restT = 0; } else if ((S.restT = (S.restT || 0) + dt) > 1.5) { S.wreckRest = true; S.vel.set(0, 0, 0); w.set(0, 0, 0); } }
    // at rest on the skids with the rotor idling it stays put (no creeping from numerical noise)
    if (S.onGround && S.collective < 0.12 && S.vel.lengthSq() < 0.04 && w.lengthSq() < 0.01) { S.vel.multiplyScalar(0.8); w.multiplyScalar(0.8); }
  }
}
