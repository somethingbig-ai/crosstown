// bus/ride.js (bus lane, Nov 15): the player and the bus. Wait at a stop, board at the front door (or hop in the back door), walk the aisle,
// sit, look out as the city goes by, ring for a stop, get off; or take the wheel. The game's code is wrapped, never edited: nearestCar, tryEnter,
// stepBusy, updateCamera, exitVehicle, seatOf. While aboard the player is "busy" (player.busy = { bus: true, ... }), which is how the game already
// parks its own walking, car prompts and the push out of traffic's bodies; the bus carries him.
//   F  board / sit / stand up / get off (at an open door)      H  ring for the next stop      X  take the wheel (standing by the driver)
import * as THREE from 'three';
import { clamp, wrapPi, lerp } from '../geo.js';
import { DEF, SPEC } from './fleet.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _o = {}, _p = [0, 0];
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export function addRide(game, fleet, ui) {
  const g = game, pl = g.player, D = fleet.D, R = { on: true, cand: null, B: null, mode: null, u: 0, seat: -1, lean: [0, 0], stats: { boards: 0, back: 0, offs: 0, rings: 0, wheel: 0, eject: 0 }, keyH: false, keyX: false, msgT: 0 };
  // the aisle as a polyline in the model frame: [x, z] by distance u from its front end (the front door's step)
  // (the model's aisle may carry a spur out to the rear door and back: the walk keeps to the front door's leg and the centre line)
  const A = [D.aisle[0]]; for (let i = 1; i < D.aisle.length; i++) { const p = D.aisle[i], l = A[A.length - 1]; if ((i === 1 || Math.abs(p[1]) < 0.3) && Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05 && !(A.length > 2 && p[0] > l[0])) A.push(p); }
  const AL = [0]; for (let i = 1; i < A.length; i++) AL.push(AL[i - 1] + Math.hypot(A[i][0] - A[i - 1][0], A[i][1] - A[i - 1][1]));
  const aisleAt = (u, out) => { u = clamp(u, 0, AL[AL.length - 1]); let i = 1; while (i < A.length - 1 && AL[i] < u) i++; const k = (u - AL[i - 1]) / Math.max(1e-6, AL[i] - AL[i - 1]); out[0] = lerp(A[i - 1][0], A[i][0], k); out[1] = lerp(A[i - 1][1], A[i][1], k); return out; };
  const uOfX = (x) => { let best = 0, bd = 1e9; for (let u = 0; u <= AL[AL.length - 1]; u += 0.1) { aisleAt(u, _p); const d = Math.abs(_p[0] - x) + Math.abs(_p[1]) * 0.5; if (d < bd) { bd = d; best = u; } } return best; };
  const U_FRONT = uOfX(D.doors.front.x - 0.4), U_REAR = uOfX(D.doors.rear.x), U_MIN = Math.min(1.0, U_FRONT), U_MAX = AL[AL.length - 1];
  R.U = { front: U_FRONT, rear: U_REAR, min: U_MIN, max: U_MAX };
  const key = (c) => (g.menu && g.menu.keyName ? g.menu.keyName(c) : c.replace('Key', ''));
  const name = (B) => { const L = B.line || B.last; return L ? L.num + (L.sel ? ' Select' : '') : 'bus'; };
  const stopName = (s) => (s ? s.stop.n : '');

  // ------------------------------------------------------------------ on foot: is there a bus to board here?
  function look() {
    R.cand = null; if (pl.vehicle || pl.busy || (g.demo && !R.force) || (g.heli && (g.heli.piloted || g.heli.busy)) || (g.fly && g.fly.on) || (g.subway && g.subway.own)) return;
    let bd = 2.4;
    for (const B of fleet.buses) {
      if (Math.abs(B.x - pl.x) > 16 || Math.abs(B.y - pl.y) > 16) continue;
      if (B.c && B.state === 'dwell') {
        const f = fleet.door(B, 'front', 0.7), r = fleet.door(B, 'rear', 0.7), df = Math.hypot(f[0] - pl.x, f[1] - pl.y), dr = Math.hypot(r[0] - pl.x, r[1] - pl.y);
        if (df < 9 || dr < 5) B.hold = Math.max(B.hold, 1.2);      // the driver waits for someone plainly coming for the door
        if (df < bd && B.doorF > 0.55) { bd = df; R.cand = { B, which: 'front', act: 'board' }; }
        if (dr < bd && dr < 2.0) { bd = dr; R.cand = { B, which: 'rear', act: 'board' }; }
      } else if (B.v && !B.c && Math.hypot(B.v.vx, B.v.vy) < 1.5) { const f = fleet.door(B, 'front', 0.7), df = Math.hypot(f[0] - pl.x, f[1] - pl.y); if (df < bd + 0.6) { bd = df; R.cand = { B, which: 'front', act: 'drive' }; } }
    }
    const c = R.cand; if (!c) return;
    if (c.act === 'drive') ui.hint('Drive the bus', key('KeyF'));
    else if (c.which === 'front') ui.hint('Board the ' + name(c.B) + (c.B.line ? ' to ' + c.B.line.head : ''), key('KeyF'));
    else ui.hint(c.B.doorR > 0.55 ? 'Slip in the back door' : 'Pull the back door and hop in', key('KeyF'));
  }
  function begin(c) {
    const B = c.B; if (c.act === 'drive') { drive(B); return true; }
    if (c.which === 'rear') { B.rearOpen = true; R.stats.back++; } else R.stats.boards++;
    R.B = B; R.mode = 'in'; B.aboard = true; R.which = c.which; R.seat = -1; R.u = c.which === 'front' ? U_FRONT : U_REAR;
    pl.busy = { bus: true, kind: 'bus-in', t: 0, dur: c.which === 'rear' && B.doorR < 0.5 ? 1.7 : 1.15, x0: pl.x, y0: pl.y, z: 0, B };
    try { g.playerAnim((pl.vis.walks && pl.vis.walks[0] && pl.vis.walks[0].name) || 'walk'); } catch (e) {} ui.hint(null); if (ui.sound) ui.sound.step && ui.sound.step();
    if (c.which === 'rear' && ui.onBackDoor) ui.onBackDoor(B);
    return true;
  }
  // where the player is, model frame: [x, y, z]
  function local(out) {
    if (R.mode === 'sit') { const s = D.seats[R.seat]; out[0] = s[0]; out[1] = s[1]; out[2] = s[2]; return out; }
    aisleAt(R.u, _p); out[0] = _p[0]; out[1] = D.floorAt(_p[0]); out[2] = _p[1]; return out;
  }
  const bodyM = (B) => { _e.set(B.roll + B.kneel * 0.012, B.h, B.pitch, 'YZX'); _q.setFromEuler(_e); _v.set(B.x, (B.z || 0) - B.kneel * 0.03, -B.y); return _m.compose(_v, _q, _one); };
  const L3 = [0, 0, 0];
  function carry(b) { const B = R.B; local(L3); fleet.toMap(B, L3[0], L3[2], _p); pl.x = _p[0]; pl.y = _p[1]; b.z = (B.z || 0) + L3[1]; }
  const seatNear = () => { aisleAt(R.u, _p); let best = -1, bd = 1.15; D.seats.forEach((s, i) => { const d = Math.hypot(s[0] - _p[0], (s[2] - _p[1]) * 0.45); if (d < bd && !(R.taken && R.taken(R.B, i))) { bd = d; best = i; } }); return best; };
  const doorNear = () => { const B = R.B; aisleAt(R.u, _p); const out = []; if (Math.abs(R.u - U_FRONT) < 1.3) out.push('front'); if (Math.abs(R.u - U_REAR) < 1.3) out.push('rear'); return out; };

  function leave(which, eject) {
    const B = R.B, b = pl.busy; const out = fleet.door(B, which, 0.95); g.statics.resolve(out[0], out[1], 0.34, _o);
    if (eject) { pl.x = _o.x; pl.y = _o.y; done(); R.stats.eject++; return; }
    R.mode = 'out'; R.which = which; b.kind = 'bus-out'; b.t = 0; b.dur = 1.0; b.x0 = pl.x; b.y0 = pl.y; b.x1 = _o.x; b.y1 = _o.y; b.z0 = b.z; pl.vis.object.visible = true; ui.hint(null); R.stats.offs++;
    g.cam.yaw = B.h - Math.PI / 2 + 0.5; g.snapCamera && 0;
  }
  function done() { const B = R.B; if (B) B.aboard = false; R.B = null; R.mode = null; pl.busy = null; pl.vis.object.visible = true; ui.hint(null); try { g.playerAnim('idle'); } catch (e) {} g.world.fixedNear = R.near0 || 0; g.cam.mode = 'foot'; g.cam.pitch = 0.18; g.snapCamera(); if (ui.onLeave) ui.onLeave(B); }

  // ------------------------------------------------------------------ aboard (the game's stepBusy, for a busy that is ours)
  function stepBusy(dt) {
    const b = pl.busy, B = R.B, I = g.input; pl.speed = 0;
    if (!B || (!B.c && !B.v) || (B.c && B.c.dead) || !fleet.buses.includes(B)) { if (B) { const p = [B.x + Math.sin(B.h) * 2.4, B.y - Math.cos(B.h) * 2.4]; g.statics.resolve(p[0], p[1], 0.34, _o); pl.x = _o.x; pl.y = _o.y; B.keep = false; } done(); R.stats.eject++; return; }
    if (R.mode === 'in') {
      b.t += dt; const f = b.t / b.dur, d = fleet.door(B, R.which, 0), k1 = sm(f / 0.45), k2 = sm((f - 0.45) / 0.55); local(L3); fleet.toMap(B, L3[0], L3[2], _p);
      pl.x = lerp(lerp(b.x0, d[0], k1), _p[0], k2); pl.y = lerp(lerp(b.y0, d[1], k1), _p[1], k2); b.z = lerp(g.statics.onSidewalk(b.x0, b.y0) ? 0.15 : 0, (B.z || 0) + L3[1], sm((f - 0.3) / 0.5)); pl.h = Math.atan2(_p[1] - b.y0, _p[0] - b.x0); B.hold = Math.max(B.hold, 0.6);
      if (f >= 1) { R.mode = 'stand'; b.kind = 'bus'; pl.vis.object.visible = false; R.near0 = g.world.fixedNear || 0; g.world.fixedNear = 0.08; g.cam.yaw = B.h + (R.which === 'front' ? Math.PI * 0.75 : Math.PI / 2); g.cam.pitch = 0.05; R.hPrev = B.h; if (ui.onBoard) ui.onBoard(B, R.which); }
      return;
    }
    if (R.mode === 'out') {
      b.t += dt; const f = b.t / b.dur, k = sm(f); pl.x = lerp(b.x0, b.x1, k); pl.y = lerp(b.y0, b.y1, k); b.z = lerp(b.z0, g.statics.onSidewalk(b.x1, b.y1) ? 0.15 : 0, sm(f * 1.4)); pl.h = Math.atan2(b.y1 - b.y0, b.x1 - b.x0); B.hold = Math.max(B.hold, 0.5);
      if (f >= 1) done(); return;
    }
    // riding: the view turns with the bus
    g.cam.yaw += wrapPi(B.h - R.hPrev); R.hPrev = B.h;
    const use = I.use, kH = g.keys.has('KeyH'), kX = g.keys.has('KeyX'), ring = kH && !R.keyH, wheel = kX && !R.keyX; R.keyH = kH; R.keyX = kX;
    const st = fleet.nextStop(B), stopped = B.state === 'dwell', openF = B.doorF > 0.6, openR = B.doorR > 0.6, stuck = B.c && (B.v0 || 0) < 0.3 && !stopped;
    R.stuckT = stuck ? (R.stuckT || 0) + dt : 0;
    if (ring && B.line && st && !B.stopReq && !stopped) { B.stopReq = true; if (B.will === false) B.will = null; R.stats.rings++; if (ui.onRing) ui.onRing(B, st); R.msgT = 2.2; }
    R.msgT -= dt;
    let hint = null, hk = key('KeyF');
    if (R.mode === 'sit') {
      if (use) { R.mode = 'stand'; R.u = uOfX(D.seats[R.seat][0]); R.seat = -1; }
      else hint = stopped && (openF || openR) ? 'Stand up (doors open at ' + stopName(B.stopAt) + ')' : null;
    } else {
      const rel = g.cam.yaw - B.h, mv = -(I.my * Math.cos(rel) - I.mx * Math.sin(rel)); if (Math.abs(mv) > 0.1) R.u = clamp(R.u + mv * 1.25 * dt, U_MIN, U_MAX);
      const dn = doorNear(), canF = dn.includes('front') && (openF || !B.line || R.stuckT > 4), canR = dn.includes('rear') && (openR || !B.line || R.stuckT > 4), sn = seatNear();
      if (stopped && dn.length) B.hold = Math.max(B.hold, 0.8);
      if (wheel && R.u < U_FRONT + 1.6 && B.c && Vehicle) { takeWheel(B); return; }
      if (canF || canR) { hint = stopped ? 'Get off at ' + stopName(B.stopAt) : 'Get off'; if (use) { leave(canR ? 'rear' : 'front'); return; } }
      else if (sn >= 0) { hint = 'Sit'; if (use) { R.mode = 'sit'; R.seat = sn; } }
      if (!hint && R.u < U_FRONT + 1.6 && B.c) { hint = 'Take the wheel'; hk = key('KeyX'); }
    }
    if (R.msgT > 0) { hint = 'Stop requested: ' + stopName(st || B.stopAt); hk = ''; }
    else if (!hint && B.line && st && !B.stopReq && !stopped) { hint = 'Ring for ' + stopName(st); hk = key('KeyH'); }
    ui.hint(hint, hk); carry(b); pl.h = g.cam.yaw;
  }
  // first-person view from where he stands or sits, leaning with the bus
  function camera(dt) {
    const B = R.B, C = g.cam, cam = g.world.camera; local(L3); const eyeY = L3[1] + (R.mode === 'sit' ? (D.eyeAboveHip || D.sit || 0.66) : Math.min(D.head || 1.62, (D.headroom || 9) - L3[1] - 0.22));
    const ax = clamp(-B.acc * 0.016, -0.06, 0.06), az = clamp(B.v0 * B.yawV * 0.012, -0.07, 0.07); R.lean[0] += (ax - R.lean[0]) * Math.min(1, dt * 3); R.lean[1] += (az - R.lean[1]) * Math.min(1, dt * 3);
    const idle = 0.0012 * (1 - clamp(Math.abs(B.v0) / 3, 0, 1)) + 0.0006, t = g.t;
    bodyM(B); _v.set(L3[0] + R.lean[0] * (R.mode === 'sit' ? 0.5 : 1), eyeY + Math.sin(t * 37) * idle + Math.sin(t * 9.1) * 0.002 * clamp(Math.abs(B.v0) / 6, 0, 1), L3[2] + R.lean[1] * (R.mode === 'sit' ? 0.5 : 1)).applyMatrix4(_m);
    const p = clamp(-C.pitch, -1.25, 1.25), cp = Math.cos(p); cam.position.copy(_v); cam.up.set(0, 1, 0);
    cam.lookAt(_v.x + Math.cos(C.yaw) * cp, _v.y + Math.sin(p), _v.z - Math.sin(C.yaw) * cp); cam.rotateZ(-(B.roll * 0.8 + R.lean[1] * 0.25));
    C.tx = B.x; C.ty = B.y; C.tz = eyeY; C.clip = undefined; const fov = 64; if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); } C.fov = fov;
  }

  // ------------------------------------------------------------------ at the wheel
  let Vehicle = null; import('../game.js').then((m) => { Vehicle = m.Vehicle; }).catch((e) => ui.err('game.js', e));      // the game's own car class (the module is the one already running)
  function takeWheel(B) {
    const c = B.c, T = g.traffic; if (!c || !Vehicle) return;
    if (B.line) { fleet.endService(B, 'end'); B.sign = B.last && B.last.signI !== undefined ? B.last.signI : -1; }      /* (the sign stays: it is still an M15 to the people at the stops) */ T.remove(c); c.bus = null;
    const v = new Vehicle(DEF, c.x, c.y, c.h, c.color); v.spec = SPEC; v.vx = Math.cos(c.h) * c.v; v.vy = Math.sin(c.h) * c.v; v.spin = c.spin; v.bus = B; v.vseed = c.id; B.v = v; B.c = null; B.state = 'player'; B.gap = 1e9; g.vehicles.push(v);
    const was = R.B; R.B = null; R.mode = null; B.aboard = false; pl.busy = null; g.world.fixedNear = R.near0 || 0; ui.hint(null); pl.x = v.x; pl.y = v.y; g.finishEnter(v); g.cam.yaw = v.h; g.cam.pitch = 0.18; g.snapCamera(); R.stats.wheel++; if (ui.onWheel) ui.onWheel(B, was);
  }
  function drive(B) { const v = B.v; if (!v) return; pl.x = v.x; pl.y = v.y; g.finishEnter(v); g.cam.yaw = v.h; g.snapCamera(); R.stats.wheel++; }

  // ------------------------------------------------------------------ the wraps
  const near0 = g.nearestCar.bind(g);
  g.nearestCar = function (d) {
    if (R.cand || (pl.busy && pl.busy.bus)) return null; const hid = []; let b = near0(d);
    while (b && ((b.kind === 'traffic' && b.c.type === 'citybus') || (b.kind === 'veh' && b.v.type === 'citybus'))) { const o = b.c || b.v; o.x += 1e6; hid.push(o); b = near0(d); }
    for (const o of hid) o.x -= 1e6; return b;
  };
  const enter0 = g.tryEnter.bind(g); g.tryEnter = function () { if (R.cand && !pl.busy) { try { return begin(R.cand); } catch (e) { ui.err('board', e); pl.busy = null; return false; } } return enter0(); };
  const busy0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const b = pl.busy; if (b && b.bus) { try { stepBusy(dt); } catch (e) { ui.err('aboard', e); try { done(); } catch (e2) { pl.busy = null; } } } else busy0(dt); };
  const cam0 = g.updateCamera.bind(g); g.updateCamera = function (dt) { if (R.B && (R.mode === 'stand' || R.mode === 'sit') && !(g.fly && g.fly.on)) { try { return camera(dt); } catch (e) { ui.err('camera', e); } } return cam0(dt); };
  const exit0 = g.exitVehicle.bind(g);
  g.exitVehicle = function () {
    const v = pl.vehicle; if (!v || v.type !== 'citybus' || !v.bus) return exit0();
    const B = v.bus; fleet.poseOf(B, v, 1 / 60); const out = fleet.door(B, 'front', 0.95); g.statics.resolve(out[0], out[1], 0.34, _o);
    pl.vehicle = null; pl.vis.object.visible = true; g.cam.mode = 'foot'; v.vx = v.vy = 0; pl.x = _o.x; pl.y = _o.y; pl.h = v.h - Math.PI / 2; try { g.sound.door(); g.missions.onExit(v); g.playerAnim('idle'); } catch (e) {}
  };
  const seat0 = g.seatOf.bind(g); g.seatOf = function (v, who) { if (v && v.type === 'citybus') { const hips = g.kit.driveHips && g.kit.driveHips[who]; return [D.driver[0], -D.driver[2], D.driver[1] - (hips === undefined ? 0.5 : hips)]; } return seat0(v, who); };
  const tgt0 = g.camTarget.bind(g); g.camTarget = function () { const t = tgt0(), v = pl.vehicle; if (v && v.type === 'citybus') { t.z = v.z + 2.6; t.dist = 12.5 + Math.hypot(v.vx, v.vy) * 0.06; t.height = 2.2; } return t; };

  R.step = function (dt) {
    look(); if (!R.cand && !R.B && ui.hintOwner()) ui.hint(null);
    // a bus the player drove and left: its front door stands open while he is near it
    for (const B of fleet.buses) if (B.v && !B.c) { const mine = pl.vehicle === B.v, sp = Math.hypot(B.v.vx, B.v.vy), near = !mine && Math.hypot(B.x - pl.x, B.y - pl.y) < 9 && sp < 1;
      if (mine) {      // at the wheel: H opens and shuts the doors at a stand (the bus kneels; at a stop people get off and on: bus.js)
        const kH = g.keys.has('KeyH'); if (kH && !R.keyD && sp < 0.6) { B.pOpen = !B.pOpen; if (ui.onPlayerDoors) ui.onPlayerDoors(B, B.pOpen); } R.keyD = kH; if (sp > 1.5 && B.pOpen) { B.pOpen = false; if (ui.onPlayerDoors) ui.onPlayerDoors(B, false); }
        const t = B.pOpen ? 1 : 0; B.kneel = clamp(B.kneel + (t ? dt / 1.1 : B.doorF < 0.05 ? -dt / 0.9 : 0), 0, 1); const dd = t && B.kneel > 0.5 ? dt / 0.9 : !t ? -dt : 0; B.doorF = clamp(B.doorF + dd, 0, 1); B.doorR = clamp(B.doorR + dd, 0, 1);
        if (sp < 0.6 && !(g.fly && g.fly.on)) ui.hint(B.pOpen ? 'Close the doors' : 'Open the doors', key('KeyH'));
      } else { B.pOpen = false; B.doorF = clamp(B.doorF + (near ? dt : -dt) / 0.9, 0, 1); B.doorR = Math.max(0, B.doorR - dt); B.kneel = Math.max(0, B.kneel - dt); }
      if (!B.last) B.sign = -1; }
  };
  R.leaveNow = () => { if (R.B) leave('front', true); };
  return R;
}
