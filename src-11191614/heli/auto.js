// auto.js: a pilot that flies the helicopter along waypoints with the same controls a player has (for the demo flight, filming and the
// frame-rate play test). Usage: heli.director = new AutoPilot(heli, legs, { cam: 'chase' }); legs: [{ x, y, alt, speed }, ..., { land: padIndex }]
// (map metres; alt is height above the street, m; speed m/s). director.done turns true when it has landed (or passed the last point).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class AutoPilot {
  constructor(heli, legs, opt = {}) { this.heli = heli; this.legs = legs; this.i = 0; this.cam = opt.cam; this.done = false; this.t = 0; this.phase = 'start'; this.loop = !!opt.loop; }
  cmd(f, t, dt) {
    const H = this.heli, out = (this.out ||= { pitch: 0, roll: 0, yaw: 0, lift: 0, engine: false }); out.pitch = out.roll = out.yaw = out.lift = 0; out.engine = false; this.t += dt;
    if (this.done) { out.lift = -1; return out; }
    if (f.engine === 'off' && this.phase === 'start') { out.engine = true; this.phase = 'spool'; return out; }
    if (f.engine !== 'run' || f.nr < 0.97) return out;
    let leg = this.legs[this.i]; if (!leg) { if (this.loop) { this.i = 0; leg = this.legs[0]; } else { this.done = true; return out; } }
    const x = f.pos.x, y = -f.pos.z, hd = f.heading, ch = Math.cos(hd), sh = Math.sin(hd), vx = f.vel.x, vy = -f.vel.z, vf = vx * ch + vy * sh, vl = -vx * sh + vy * ch, sp = Math.hypot(vx, vy);     // vl: speed to the LEFT
    let tx, ty, alt, speed, land = null;
    if (leg.land !== undefined) { land = H.pads[leg.land]; tx = land.x; ty = land.y; alt = (land.z || 0) + (this.phase === 'descend' ? -5 : 14); speed = 16; } else { tx = leg.x; ty = leg.y; alt = leg.alt; speed = leg.speed || 30; }
    const dx = tx - x, dy = ty - y, dist = Math.hypot(dx, dy), brg = Math.atan2(dy, dx);
    // how fast to be going: no faster than can be stopped (or turned) by the point
    const next = this.legs[this.i + 1], through = !land && next && next.land === undefined, vWant = through ? speed : Math.min(speed, Math.max(0, dist - 1) * 0.22 + 0.4);
    const wvx = Math.cos(brg) * vWant, wvy = Math.sin(brg) * vWant, wf = wvx * ch + wvy * sh, wl = -wvx * sh + wvy * ch;
    out.pitch = clamp((wf - vf) * 0.11, -1, 1);
    const fast = clamp((sp - 7) / 8, 0, 1), he = wrapPi(brg - hd);
    // slow: slide sideways to the line and turn the nose with the pedals; fast: bank toward the bearing
    out.roll = clamp(-(wl - vl) * 0.14 * (1 - fast) + -he * 1.6 * fast, -1, 1);
    const wantHd = land && dist < 25 ? land.h : (dist > 6 ? brg : hd);
    out.yaw = clamp(-wrapPi(wantHd - hd) * 1.6 * (1 - fast * 0.8), -1, 1);
    const y0 = f.pos.y - 1.25, eAlt = alt - y0; out.lift = clamp(eAlt * 0.09 - f.vel.y * 0.02, -0.8, 1);
    // never fly into what is ahead: if the roofs on the way stand higher than we are, climb first and wait
    const look = Math.min(dist, 30 + sp * 3); let roof = 0; for (let s = 10; s <= look; s += 10) roof = Math.max(roof, H.heights.top(x + Math.cos(brg) * s, y + Math.sin(brg) * s, 1e4)); if (roof + 12 > y0) { out.lift = 1; if (roof + 4 > y0) out.pitch = clamp(-vf * 0.2, -1, 1); }
    if (land) {
      if (this.phase !== 'descend' && dist < 2.2 && sp < 1.6 && Math.abs(wrapPi(land.h - hd)) < 0.12) this.phase = 'descend';
      if (this.phase === 'descend') { out.lift = f.agl > 6 ? -0.55 : -0.3; if (f.onGround) { this.hold = (this.hold || 0) + dt; out.lift = -1; if (this.hold > 1.5) { this.i++; this.phase = 'fly'; this.hold = 0; if (!this.legs[this.i] && !this.loop) this.done = true; } } }
    } else if (dist < (through ? 30 + sp * 0.9 : 5)) { this.i++; this.phase = 'fly'; }
    return out;
  }
}
