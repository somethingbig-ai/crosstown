// params.js: the one list of numbers the helicopter's sound is played from, and pack(), which fills it from the flight state,
// the listener and the camera. Used by the game (sound.js) and by the offline renderer (lanes/heli/items/sound/render.mjs),
// so what is measured offline is what the game plays. No imports: this file is also loaded inside the audio worklet.
export const I = {
  NR: 0, N1: 1, ENG: 2, COL: 3, LOAD: 4, TORQUE: 5, POWER: 6, PEDAL: 7, IAS: 8, VS: 9, GLOAD: 10, VRS: 11, AGL: 12, AIR: 13, DAMAGE: 14,
  INSIDE: 15, DOOR: 16, DIST: 17, AZC: 18, AZS: 19, SINEL: 20, PAN: 21, CANYON: 22, GDELAY: 23, GGAIN: 24, LSPEED: 25, JUMP: 26, MUTE: 27,
  SIDE: 28,
};
export const NP = 29;
// which of them are switches (never smoothed)
export const STEP = [I.ENG, I.AIR, I.JUMP, I.MUTE];
export const ENGINE = { off: 0, starting: 1, run: 2, fail: 3 };
export const HIT = { skid: 0, hull: 1, rotor: 2 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// st: a plain object kept by the caller between calls (pack writes its own fields into it)
// ctx: { SPEC, heli: { heights: { skyline(x, yMap), top(x, yMap, zq) } } } (heights optional)
export function pack(P, st, f, listener, view, ctx, dt) {
  const SPEC = ctx.SPEC, lp = listener.pos, fp = f.pos, q = f.quat;
  P[I.NR] = f.nr; P[I.N1] = f.n1; P[I.ENG] = ENGINE[f.engine] || 0; P[I.COL] = f.collective;
  P[I.LOAD] = clamp(f.thrust / (SPEC.mass * 9.81), -0.3, 2.6); P[I.TORQUE] = clamp(f.torque, 0, 1.5); P[I.POWER] = clamp(f.power / SPEC.powerMax, 0, 1.2);
  P[I.PEDAL] = f.pedal; P[I.IAS] = f.ias; P[I.VS] = f.vel.y; P[I.GLOAD] = clamp(f.gLoad, -1, 4); P[I.VRS] = f.vrs; P[I.AGL] = f.agl; P[I.AIR] = f.onGround ? 0 : 1; P[I.DAMAGE] = f.damage;
  P[I.INSIDE] = listener.inside ? 1 : 0; P[I.DOOR] = (view && view.door) || 0;
  // where the listener is, seen from the aircraft (body axes: x nose, y up, z right)
  const rx = lp.x - fp.x, ry = lp.y - fp.y, rz = lp.z - fp.z, d = Math.max(0.5, Math.hypot(rx, ry, rz));
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;       // inverse rotation
  const tx = 2 * (qy * rz - qz * ry), ty = 2 * (qz * rx - qx * rz), tz = 2 * (qx * ry - qy * rx);
  const bx = rx + qw * tx + (qy * tz - qz * ty), by = ry + qw * ty + (qz * tx - qx * tz), bz = rz + qw * tz + (qx * ty - qy * tx);
  const h = Math.hypot(bx, bz);
  P[I.DIST] = d; P[I.AZC] = h > 1e-3 ? bx / h : 1; P[I.AZS] = h > 1e-3 ? bz / h : 0; P[I.SINEL] = by / d; P[I.SIDE] = bz / d;
  // left / right for the listener's ears: the camera's own right-hand axis
  let pan = 0; const cam = view && view.camera;
  if (cam && cam.matrixWorld) { const e = cam.matrixWorld.elements; pan = -(rx * e[0] + ry * e[1] + rz * e[2]) / d; }
  P[I.PAN] = clamp(pan, -1, 1) * clamp(d / (d + 12), 0, 1);      // close up it fills both ears
  // street canyon: how deep between the buildings the aircraft (and the listener) is
  let canyon = 0, gl = 0; const H = ctx.heli && ctx.heli.heights;
  if (H) {
    try {
      const s1 = H.skyline(fp.x, -fp.z), s2 = H.skyline(lp.x, -lp.z);
      const a = clamp((s1 - 8) / 25, 0, 1) * clamp(1.15 - fp.y / Math.max(s1, 1), 0, 1), b = clamp((s2 - 8) / 25, 0, 1) * clamp(1.15 - lp.y / Math.max(s2, 1), 0, 1);
      canyon = Math.max(a, 0.6 * b); if (H.top) gl = H.top(lp.x, -lp.z, lp.y);
    } catch (e) { canyon = 0; }
  }
  P[I.CANYON] = clamp(canyon, 0, 1);
  // the bounce off the ground (or roof) under the path: one more arrival a little later, which is what combs the sound of a fly-past
  const hs = Math.max(1, f.agl + 2), hl = Math.max(1.2, lp.y - gl), dh = Math.hypot(rx, rz), r1 = Math.hypot(dh, hs - hl), r2 = Math.hypot(dh, hs + hl);
  const extra = r2 - r1; P[I.GDELAY] = Math.min(extra, 300) / 343; P[I.GGAIN] = extra < 300 ? 0.6 * r1 / r2 * (1 - 0.5 * canyon) : 0;
  // the listener's own speed through the air (wind on the microphone), and camera cuts
  let ls = st.ls || 0, jump = st.jump || 0;
  if (st.has && dt > 1e-4) {
    const v = Math.hypot(lp.x - st.x, lp.y - st.y, lp.z - st.z) / dt;
    if (v < 160 && Math.abs(d - st.d) < 6 + 160 * dt) ls += (v - ls) * Math.min(1, dt * 4); else jump = (jump + 1) % 512;
  }
  st.has = true; st.x = lp.x; st.y = lp.y; st.z = lp.z; st.d = d; st.ls = ls; st.jump = jump;
  P[I.LSPEED] = ls; P[I.JUMP] = jump; P[I.MUTE] = ctx.game && ctx.game.sound && ctx.game.sound.muted ? 1 : 0;
  return P;
}
