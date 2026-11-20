// surprises/pizzarat.js (surprises lane, Nov 15): PIZZA RAT. Now and then, on one of a station's street stairs, a brown rat is backing down the
// steps dragging a whole cheese slice bigger than itself: it braces, yanks, the slice slides and flops over the step edge, it stops dead, lifts
// its head and sniffs (it looks at you), takes the crust again. Come within a stride or run at it and it lets go and bolts along the wall into a
// gap at the wall's foot; the slice stays on the steps.
//   - WHERE / WHEN: only on the open street stairs of stations whose underground is built (game.subway units). The roll is made once per visit to a
//     stair, when the player first comes within R_IN metres of it (the steps cannot be seen from there), from a hash of (session seed, entrance,
//     visit number): it never changes while he is there. ?ratp=1 every stair, ?ratseed=n the session seed, ?pizzarat=0 off (index.js).
//   - THE SLICE is a chain of 17 points in the stair's own section (distance down the stair, height), position-based: length kept, a little
//     bending stiffness (less toward the tip), gravity, the steps' treads and risers, stick-slip friction. The triangle is laid over that curve as a
//     sheet that only bends across the stair, so it drapes over a nosing and its tip droops; it sleeps when nothing moves it.
//   - THE RAT is one mesh moved on the CPU (571 vertices, 946 triangles): a smooth body lofted through ten stations of a spine (19 rings of 16), cupped
//     ears, bead eyes, whiskers, legs with a knee / elbow and a heel / wrist and a foot that lies flat, feet that stay planted and step when the body has
//     moved off them, forepaws up on the step above when it reaches up, a tail that drapes down the steps.
//   - LIGHT: unlit like everything underground; the light where the rat stands is worked out as subway/build.js does for the steps (the sky down
//     the open stair, the lamp under the slab) and given to the two shaders. Drawn before the subway's depth cap (renderOrder -15), on its layer too.
//   - COST: nothing but a scan of the built stations every 0.3 s until a rat is rolled; then 3 draws within 30 m, the motion only within 18 m.
// Nothing of the subway lane is edited: its floors, events (unit, drop) and S.goto are used.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU, rng } from './kit.js';

const R_IN = 16, R_OUT = 45, R_DRAW = 30, R_SIM = 18, P_STATION = 0.55, P_VISIT = 0.35;
const hash = (a, b, c) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35)) | 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
const strHash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

// ------------------------------------------------------------------------------------------------ the stair, in its own frame
// d = metres from the top edge along the way down, v = across (left of the way down), z = map height. Tread i runs d = i*tr .. (i+1)*tr at zTop - (i+1)*rise.
export function makeStair(f, meta) {
  const zTop = Math.max(f.z0, f.z1), zBot = Math.min(f.z0, f.z1), n = f.n || Math.max(1, Math.round((zTop - zBot) / meta.rise)), tr = f.l / n, rise = (zTop - zBot) / n, dn = f.z0 > f.z1 ? 1 : -1, ca = Math.cos(f.a), sa = Math.sin(f.a);
  const H = (d) => (d < 0 ? zTop : d >= f.l ? zBot : zTop - (Math.floor(d / tr) + 1) * rise);
  // the ground as something soft lies on it: the tread, or a slope k falling from the nosing just upstairs of d
  const G = (d, k) => { const h = H(d); if (d < 0 || d >= f.l) return h; const e = Math.floor(d / tr) * tr; return Math.max(h, h + rise - k * (d - e)); };
  const lineZ = (d) => zTop - (d / f.l) * (zTop - zBot), lO = meta.lOpen, dL = lO + 2.2, zL = lineZ(dL) + meta.hM - 0.25;
  // the light on something facing up at (d, v, z), as build.js lights the treads: out = rgb in scene units, returns the sky's share of it
  const light = (d, v, z, out) => { let r = 0.051, g = 0.051, b = 0.051; const dz = zL - z;
    if (dz > -0.35 && dz < 3.4) { const dh = (dL - d) * (dL - d) + v * v, d2 = dh + dz * dz; if (d2 < 81) { const e = 1.375 * (0.3 + 0.7 * dz / Math.sqrt(d2 || 1e-6)) / (1 + d2 / 3) * (d2 > 49 ? (81 - d2) / 32 : 1) * (0.22 + 1.03 * Math.exp(-dh / 4.5)); r += e; g += e * 0.965; b += e * 0.88; } }
    const e = 1.5 * Math.exp(-Math.max(0, meta.zWalk - z) / 2.4) * (d < lO ? 1 : Math.exp(-(d - lO) / 1.7)), lamp = r; r += e * 0.86; g += e * 0.93; b += e;
    const m = Math.max(r, g, b), k = (m > 1.7 ? 1.7 / m : 1) * 0.30; out[0] = r * k; out[1] = g * k; out[2] = b * k; return e * 0.86 / (e * 0.86 + lamp); };
  return { f, n, tr, rise, zTop, zBot, l: f.l, w: f.w, dn, ca, sa, H, G, lineZ, light, dL,
    local(x, y, o) { const u = (x - f.x) * ca + (y - f.y) * sa, w = -(x - f.x) * sa + (y - f.y) * ca; o.d = dn * u + f.l / 2; o.v = dn * w; return o; },
    world(d, v, o) { const u = dn * (d - f.l / 2), w = dn * v; o.x = f.x + ca * u - sa * w; o.y = f.y + sa * u + ca * w; return o; } };
}

// ------------------------------------------------------------------------------------------------ the slice: a chain over the steps
// Node k sits at arc TA + k*SL along the slice's section; larger k lies upstairs. Node KP is the point the rat holds.
const SN = 17, SL = 0.025, KP = 4, TA = -KP * SL, SR = 0.004, SLEN = 0.28, SW = 0.2, BULGE = 0.012;
export class SliceSim {
  constructor(st) { this.st = st; const F = () => new Float64Array(SN); this.d = F(); this.z = F(); this.pd = F(); this.pz = F(); this.w = F(); for (let k = 0; k < SN; k++) this.w[k] = 1 / (k < KP ? 0.3 : Math.max(0.18, 1 - (k - KP) / (SN - KP)));      /* lighter toward the tip */ this.con = new Uint8Array(SN); this.wall = Infinity;      // the rat itself: nothing upstairs of its mouth gets past it
   
    this.pinned = false; this.gd = 0; this.gz = 0; this.acc = 0; this.still = 0; this.asleep = false; this.maxPen = 0; }
  // lie along the steps upstairs of dGrip (the held point), then settle
  lay(dGrip) { const st = this.st; for (let k = 0; k < SN; k++) { const d = dGrip - (k - KP) * SL * 0.9; this.d[k] = this.pd[k] = d; this.z[k] = this.pz[k] = st.G(d, 1.2) + SR + 0.02; } this.asleep = false; this.still = 0; for (let i = 0; i < 240 && !this.asleep; i++) this.step(1 / 120); }
  pin(on, d, z) { this.pinned = on; if (on) { this.gd = d; this.gz = z; this.asleep = false; this.still = 0; } }
  collide(i) { const st = this.st, d = this.d[i], z = this.z[i], g = st.H(d) + SR; if (z >= g) return 0;
    if (d >= 0 && d < st.l) { const e = (Math.floor(d / st.tr) + 1) * st.tr, out = e + SR - d; if (out < g - z && z < g - SR - 0.006 && e < st.l) { this.d[i] = e + SR; return 0; } }      // against a riser: out through its face
    this.z[i] = g; return 1; }
  sub(h) { const { d, z, pd, pz, w, con } = this, g2 = 9.8 * h * h; let mv = 0;
    const st = this.st, lead = () => { for (let i = 0; i < KP; i++) { d[i] = d[KP] + (KP - i) * SL; z[i] = Math.max(st.H(d[i]) + SR, z[KP] - (KP - i) * 0.007); } };      // the crust corner beside the rat's head is carried: a sheet is stiff in its own plane and cannot fold back under itself
    for (let i = KP; i < SN; i++) { if (this.pinned && i === KP) { pd[i] = d[i]; pz[i] = z[i]; d[i] = this.gd; z[i] = this.gz; continue; }
      const vd = (d[i] - pd[i]) * 0.955, vz = (z[i] - pz[i]) * 0.955; pd[i] = d[i]; pz[i] = z[i]; d[i] += vd; z[i] += vz - g2; }
    for (let it = 0; it < 8; it++) { lead();
      for (let i = KP; i < SN - 1; i++) { const j = i + 1, wi = this.pinned && i === KP ? 0 : w[i], wj = this.pinned && j === KP ? 0 : w[j], ws = wi + wj; if (ws <= 0) continue; const dx = d[j] - d[i], dz = z[j] - z[i], L = Math.hypot(dx, dz) || 1e-9, c = (L - SL) / L / ws; d[i] += dx * c * wi; z[i] += dz * c * wi; d[j] -= dx * c * wj; z[j] -= dz * c * wj; }
      for (let i = this.pinned ? KP - 2 : KP; i < SN - 2; i++) { const j = i + 2, dx = d[j] - d[i], dz = z[j] - z[i], L = Math.hypot(dx, dz) || 1e-9; if (L >= 2 * SL) continue; const wi = i < KP || (this.pinned && i === KP) ? 0 : w[i], wj = j < KP || (this.pinned && j === KP) ? 0 : w[j], ws = wi + wj; if (ws <= 0) continue;
        const kb = lerp(0.75, 0.4, i / (SN - 3)), c = kb * (L - 2 * SL) / L / ws; d[i] += dx * c * wi; z[i] += dz * c * wi; d[j] -= dx * c * wj; z[j] -= dz * c * wj; }
      // it cannot fold: four segments never come nearer than a bend of about 5 cm radius allows
      for (let i = this.pinned ? KP - 3 : KP; i < SN - 4; i++) { const j = i + 4, dx = d[j] - d[i], dz = z[j] - z[i], L = Math.hypot(dx, dz) || 1e-9, min = 3.55 * SL; if (L >= min) continue; const wi = i < KP || (this.pinned && i === KP) ? 0 : w[i], wj = j < KP || (this.pinned && j === KP) ? 0 : w[j], ws = wi + wj; if (ws <= 0) continue;
        const c = 0.8 * (L - min) / L / ws; d[i] += dx * c * wi; z[i] += dz * c * wi; d[j] -= dx * c * wj; z[j] -= dz * c * wj; }
      for (let i = KP; i < SN; i++) { con[i] = this.collide(i); if (i > KP) { if (d[i] > this.wall) d[i] = this.wall; if (d[i] > d[i - 1] + 0.004) d[i] = d[i - 1] + 0.004; } }      /* and it never curls forward over itself: it leans back on the riser, then lies down */
      if (this.pinned) { d[KP] = this.gd; z[KP] = this.gz; } }
    lead();
    // friction on the treads: a point that has hardly moved sticks, one that slides loses a little
    for (let i = KP; i < SN; i++) { if (this.pinned && i === KP) continue; if (con[i]) { const dd = d[i] - pd[i], a = Math.abs(dd); if (a < 0.075 * h) d[i] = pd[i]; else d[i] -= Math.sign(dd) * 0.05 * h; }
      const m = Math.abs(d[i] - pd[i]) + Math.abs(z[i] - pz[i]); if (m > mv) mv = m; }
    return mv; }
  step(dt) { if (this.asleep) return; this.acc = Math.min(this.acc + dt, 0.05); const h = 1 / 120;
    while (this.acc >= h) { this.acc -= h; const mv = this.sub(h); this.free = this.pinned ? 0 : (this.free || 0) + h; if (!this.pinned && (mv < 6e-5 || this.free > 5)) { this.still += h; if (this.still > 0.4) { this.asleep = true; for (let i = 0; i < SN; i++) { this.pd[i] = this.d[i]; this.pz[i] = this.z[i]; } break; } } else this.still = 0; } }
  // how deep any point is inside the steps (for the checks)
  pen() { let p = 0; for (let i = 0; i < SN; i++) p = Math.max(p, this.st.H(this.d[i]) - this.z[i]); return p; }
  len() { let L = 0; for (let i = 0; i < SN - 1; i++) L += Math.hypot(this.d[i + 1] - this.d[i], this.z[i + 1] - this.z[i]); return L; }
}

// ------------------------------------------------------------------------------------------------ the rat
// Drag: it faces upstairs (heading angle th = PI in (d, v)), hips at hipD, mouth `reach` in front of the hips. One tug = shuffle the hips back with the
// neck stretching (the mouth stays), then yank the mouth back to the body (the slice comes), then hold.
const TN = 12, TSEG = 0.0165;
export class RatSim {
  constructor(st, slice, side, seed, step0) { const s = this; s.st = st; s.slice = slice; s.side = side; s.R = rng(seed); const R = s.R;
    s.mode = 'drag'; s.ph = 'hold'; s.pt = 0; s.pT = 0.6 + R() * 1.2; s.pk = 0; s.del = 0; s.tugs = 0; s.tugN = 2 + Math.floor(R() * 3); s.t = 0;
    s.th = Math.PI; s.reach = 0.2; s.hipD = step0 * st.tr + 0.215; s.v = side * (st.w / 2 - 0.2); s.grip = true; s.headUp = 0; s.yank = 0; s.look = 0; s.lookT = 0; s.lookAt = 0; s.nib = 0;
    s.holeUp = (Math.max(0, step0 - 3 - Math.floor(R() * 2)) + 0.5) * st.tr; const iDn = clamp(step0 + 7 + Math.floor(R() * 4), step0 + 5, st.n - 2); s.holeDn = (iDn + 0.5) * st.tr; s.dEnd = (iDn - 2) * st.tr + 0.2;
    s.zHip = st.G(s.hipD, 1.2) + 0.046; s.zSh = s.zHip; s.sp = 0; s.fdir = 0; s.into = false; s.gal = 0; s.fled = 0; s.pulls = 0; s.ev = null;
    s.md = 0; s.mv = 0; s.mz = 0; s.so = 0.11; s.hunch = 0.015; s.psi = -side * 0.42;
    s.foot = []; for (let i = 0; i < 4; i++) s.foot.push({ d: 0, v: 0, z: 0, sd: 0, sv: 0, sz: 0, td: 0, tv: 0, tz: 0, k: -1, set: false });
    s.tail = new Float64Array(TN * 3); s.tailSet = false; s.C = new Float64Array(10 * 3); s.pose(0); slice.lay(s.md); slice.pin(true, s.md, s.mz); }
  go(ph, T) { this.ph = ph; this.pt = 0; this.pT = T; this.pk = 0; }
  // P: the player in the stair's frame { d, v, z, speed }
  step(dt, P) { const s = this; s.t += dt; s.ev = null;
    if (s.mode === 'drag') { const dd = P ? Math.hypot(P.d - s.hipD, P.v - s.v, P.z - s.zHip) : 1e9;
      if (dd < 1.5 || (P && P.speed > 3.2 && dd < 5)) { s.mode = 'flee'; s.fdir = P.d < s.hipD ? 1 : -1; s.grip = false; s.slice.pin(false); s.fled = 1; s.ev = 'flee'; s.headUp = 0; s.yank = 0; for (const f of s.foot) f.k = -1; }
      else s.drag(dt, P); }
    if (s.mode === 'flee') s.flee(dt);
    if (s.mode !== 'gone') s.pose(dt);
    s.slice.wall = s.mode === 'drag' ? s.md + 0.012 : Infinity;
    if (s.grip) { const sl = s.slice, k = Math.min(1, dt * 30); sl.gd += (s.md - sl.gd) * k; sl.gz += (s.mz - sl.gz) * k; } }
  drag(dt, P) { const s = this, R = s.R, sl = s.slice; s.pt += dt; const u = Math.min(1, s.pt / s.pT);
    if (s.ph === 'hold') { if (u >= 1) { if (s.hipD >= s.dEnd) { s.grip = false; sl.pin(false); s.go('nibble', 1e9); } else if (s.tugs >= s.tugN) { s.tugs = 0; s.tugN = 2 + Math.floor(R() * 4); s.keep = R() < 0.3; if (!s.keep) { s.grip = false; sl.pin(false); } s.go('sniff', 0.9 + R() * 1.8); } else { s.del = 0.05 + R() * 0.03; s.go('shuffle', 0.2 + R() * 0.12); } } }
    else if (s.ph === 'shuffle') { const k = smooth(0, 1, u), dl = s.del * (k - s.pk); s.pk = k; s.hipD += dl; s.reach += dl; if (u >= 1) { s.go('pull', 0.15 + R() * 0.06); s.ev = 'pull'; s.pulls++; } }
    else if (s.ph === 'pull') { const k = 1 - Math.pow(1 - u, 3), dl = s.del * (k - s.pk); s.pk = k; s.reach -= dl; s.yank = Math.sin(u * Math.PI); if (u >= 1) { s.yank = 0; s.tugs++; s.go('hold', 0.07 + R() * R() * 0.5); } }
    else if (s.ph === 'sniff') { if (!s.keep) s.headUp += (1 - s.headUp) * Math.min(1, dt * 9); s.lookT -= dt;
      if (s.lookT <= 0) { s.lookT = 0.35 + R() * 0.7; const near = P && Math.hypot(P.d - s.hipD, P.v - s.v) < 9; s.lookAt = s.keep ? 0 : near && R() < 0.75 ? clamp(Math.atan2(-(P.v - s.v), -(P.d - s.hipD)) * 0.8, -0.9, 0.9) : (R() - 0.5) * 1.1; }
      s.look += (s.lookAt - s.look) * Math.min(1, dt * 14);
      if (u >= 1) { if (s.keep) s.go('hold', 0.1); else { const sd = sl.d[KP]; s.r0 = s.reach; s.h0 = s.hipD; s.r1 = clamp(s.hipD - sd, 0.15, 0.225); s.h1 = sd + s.r1; s.go('regrip', 0.28); } } }
    else if (s.ph === 'regrip') { const k = smooth(0, 1, u); s.reach = lerp(s.r0, s.r1, k); s.hipD = lerp(s.h0, s.h1, k); s.headUp *= Math.max(0, 1 - dt * 12); s.look *= Math.max(0, 1 - dt * 12); if (u >= 1) { s.headUp = 0; s.look = 0; s.grip = true; sl.pin(true, sl.d[KP], sl.z[KP]); s.go('hold', 0.12 + R() * 0.2); } }
    else if (s.ph === 'nibble') { s.nib += dt; const sd = sl.d[KP], want = clamp(s.hipD - sd, 0.15, 0.225); s.reach += (want - s.reach) * Math.min(1, dt * 4); s.lookT -= dt; if (s.lookT <= 0) { s.lookT = 1.2 + R() * 2.5; s.nibUp = R() < 0.35 ? 1 : 0; } s.headUp += ((s.nibUp || 0) - s.headUp) * Math.min(1, dt * 7); } }
  flee(dt) { const s = this, st = s.st, tgt = s.fdir > 0 ? s.holeDn : s.holeUp, head = s.hipD + Math.cos(s.th) * 0.12; let tx, tv;
    if (s.into || (s.fdir > 0 ? head > tgt - 0.1 : head < tgt + 0.1)) { s.into = true; tx = tgt; tv = s.side * (st.w / 2 + 0.6); } else { tx = s.hipD + s.fdir * 0.35; tv = s.side * (st.w / 2 - 0.075); }
    let want = Math.atan2(tv - s.v, tx - s.hipD), da = want - s.th; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; s.th += clamp(da, -18 * dt, 18 * dt);
    s.sp += ((s.into ? 2.0 : 2.9) - s.sp) * Math.min(1, dt * 10); const mv = s.sp * dt * (Math.abs(da) > 1.2 ? 0.25 : 1); s.hipD += Math.cos(s.th) * mv; s.v += Math.sin(s.th) * mv; if (!s.into) s.v = clamp(s.v, -st.w / 2 + 0.06, st.w / 2 - 0.06);
    s.reach += (0.205 - s.reach) * Math.min(1, dt * 12); s.gal += dt * TAU * 7.5; if (Math.abs(s.v) > st.w / 2 + 0.24) { s.mode = 'gone'; s.ev = 'gone'; } }
  // where everything is this frame: mouth, spine heights, feet, tail
  pose(dt) { const s = this, st = s.st, hx = Math.cos(s.th), hv = Math.sin(s.th), fl = s.mode === 'flee', kz = fl ? 1.0 : 1.2;
    const gs = fl ? Math.sin(s.gal) : 0; if (s.rb === undefined || (s.ph !== 'shuffle' && s.ph !== 'pull')) s.rb = s.reach; s.bunch = fl ? 0.5 - 0.5 * gs : clamp(1 - (s.reach - s.rb) / 0.05, 0, 1);      /* 1 = gathered into a ball, 0 = stretched out: the tug (and each bound of the gallop) goes from one to the other */
    s.so = 0.095 + (s.reach - 0.15) * 0.45 + 0.022 * gs; s.hunch = 0.006 + (fl ? 0.024 : 0.036) * s.bunch + 0.008 * s.yank;
    const r = s.reach - 0.016 * s.headUp + 0.032 * gs; s.rr = r; s.md = s.hipD + hx * r; s.mv = s.v + hv * r + Math.sin(s.t * 38) * 0.004 * s.yank + (hx < 0 ? -1 : 1) * Math.sin(s.look) * 0.02;
    const chew = s.ph === 'nibble' && s.mode === 'drag' ? Math.abs(Math.sin(s.nib * 19)) * 0.004 * (1 - s.headUp) : 0;
    s.mz = st.G(s.md, 1.7) + 0.022 + 0.012 * s.yank + 0.05 * s.headUp + chew + (fl ? 0.012 : 0) + (s.headUp > 0.3 ? Math.sin(s.t * 47) * 0.0025 : 0);
    const shD = s.hipD + hx * s.so, zh = st.G(s.hipD, kz) + 0.046 + (fl ? 0.014 + 0.016 * Math.sin(s.gal + 2.4) : 0), zs = st.G(shD, kz) + 0.04 + (fl ? 0.014 + 0.016 * Math.sin(s.gal + 0.6) : 0.011 * s.yank - 0.007 * (1 - s.bunch)), kk = dt > 0 ? Math.min(1, dt * (fl ? 30 : 16)) : 1;
    s.zHip = Math.max(s.zHip + (zh - s.zHip) * kk, zh - 0.014); s.zSh = Math.max(s.zSh + (zs - s.zSh) * kk, zs - 0.012);
    // feet: 0 1 fore (left, right), 2 3 hind
    for (let i = 0; i < 4; i++) { const f = s.foot[i], fore = i < 2, lat = (i % 2 ? -1 : 1) * (fore ? 0.026 : 0.038);
      if (fl) { const ph = s.gal + (fore ? 0 : 2.2) + (i % 2) * 0.35, a = (fore ? s.so + 0.012 : -0.004) + (fore ? 0.055 : 0.07) * Math.cos(ph); f.d = s.hipD + hx * a - hv * lat; f.v = s.v + hv * a + hx * lat; f.z = st.G(f.d, 3) + Math.max(0, Math.sin(ph)) * 0.036; f.k = -1; f.set = false; continue; }
      const a = fore ? s.so - 0.012 : -0.004; let hd = s.hipD + hx * a - hv * lat, hz; const hw = s.v + hv * a + hx * lat;
      if (fore && hd >= 0 && hd < st.l && st.G(hd, 1.2) - st.H(hd) > 0.05) { hd = Math.floor(hd / st.tr) * st.tr - 0.008; hz = st.H(hd); }      // reaching up: paws on the step above
      else { if (hd >= 0 && hd < st.l) { const e = Math.floor(hd / st.tr) * st.tr; if (hd - e < 0.016) hd = e + 0.016; } hz = st.H(hd); }
      if (!f.set) { f.d = hd; f.v = hw; f.z = hz; f.set = true; f.k = -1; continue; }
      if (f.k >= 0) { f.k += dt / 0.075; const k = Math.min(1, f.k), e = smooth(0, 1, k); f.d = lerp(f.sd, f.td, e); f.v = lerp(f.sv, f.tv, e); f.z = Math.max(st.H(f.d), lerp(f.sz, f.tz, e) + Math.sin(k * Math.PI) * (0.012 + Math.abs(f.tz - f.sz) * 0.25)); if (k >= 1) f.k = -1; }
      else if (Math.hypot(hd - f.d, hw - f.v) + Math.abs(hz - f.z) > 0.032 && s.foot[i ^ 1].k < 0) { f.sd = f.d; f.sv = f.v; f.sz = f.z; f.td = hd + (hd - f.d) * 0.35; f.tv = hw; if (Math.abs(st.H(f.td) - hz) > 1e-4) f.td = hd; f.tz = hz; f.k = 0; } }
    // tail: each point lags toward its place behind the one before, then lies on the steps
    const T = s.tail, bx = -hx, bv = -hv, k2 = dt > 0 ? 1 - Math.exp(-dt * (fl ? 34 : 14)) : 1; let px = s.hipD + bx * 0.045, pv = s.v + bv * 0.045, pz = s.zHip - 0.014;
    for (let i = 0; i < TN; i++) { const yaw = (fl ? 0 : -s.side * (hx < 0 ? 1 : -1) * (0.1 * (i + 1) + 0.25 * Math.sin(i * 0.7 + 0.6))) + Math.sin(s.t * (fl ? 26 : 1.3) - i * 0.6) * (fl ? 0.11 : 0.035) * (i + 1) * 0.4, c = Math.cos(yaw), sn = Math.sin(yaw), tx = px + (bx * c - bv * sn) * TSEG, tv = pv + (bx * sn + bv * c) * TSEG, o = i * 3;
      if (!s.tailSet) { T[o] = tx; T[o + 1] = tv; } else { T[o] += (tx - T[o]) * k2; T[o + 1] += (tv - T[o + 1]) * k2; }
      const dx = T[o] - px, dv = T[o + 1] - pv, L = Math.hypot(dx, dv) || 1e-9; T[o] = px + dx / L * TSEG; T[o + 1] = pv + dv / L * TSEG;
      const gz = st.G(T[o], 3) + 0.005 + (fl ? 0.03 + 0.03 * Math.sin(s.t * 26 - i * 0.6 + 1) * (i + 1) / TN : 0); pz = fl ? Math.max(st.G(T[o], 3) + 0.004, pz + clamp(gz - pz, -TSEG * 0.3, TSEG * 0.8)) : Math.max(gz, pz - TSEG * 1.1); T[o + 2] = pz; px = T[o]; pv = T[o + 1]; }
    s.tailSet = true; }
}

// ------------------------------------------------------------------------------------------------ meshes
const lin = (r, g, b) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];
const NOISE = `float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }`;
const VERT = `attribute vec4 aCol; attribute vec2 aRest; varying vec3 vN; varying vec3 vW; varying vec4 vC; varying vec2 vR;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = mat3(modelMatrix) * normal; vC = aCol; vR = aRest; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const RAT_FRAG = `uniform vec3 uL; uniform vec3 uLd; varying vec3 vN; varying vec3 vW; varying vec4 vC; varying vec2 vR;
  ${NOISE}
  void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float fur = step(vC.a, 0.02), tail = step(99.0, vR.x);
    // an agouti coat: every hair banded dark and pale, lying along the body, so the coat is grizzled salt-and-pepper close up and grey-brown from a few steps away
    vec2 h = vec2(vR.x * 46.0, vR.y * 900.0); float s1 = vn(h), s2 = vn(h * vec2(2.7, 2.3) + 7.0), s3 = vn(vR * vec2(11.0, 7.0)), s4 = vn(vec2(vR.x * 17.0 + s1, vR.y * 260.0)), g = s1 * 0.5 + s2 * 0.3 + s4 * 0.2;
    vec3 alb = vC.rgb * mix(1.0, (0.5 + 1.0 * g) * (0.86 + 0.28 * s3), fur) + fur * vec3(0.10, 0.09, 0.075) * smoothstep(0.62, 0.8, s2);
    alb *= 1.0 - tail * 0.3 * smoothstep(0.3, 0.45, abs(fract(vR.x) - 0.5));      // the tail's rings of scales
    float ao = mix(0.5, 1.0, smoothstep(-0.95, 0.1, N.y)), wr = 0.5 + 0.5 * dot(N, uLd), dif = mix(0.3, 1.0, wr * wr * (3.0 - 2.0 * wr)) * ao, rim = pow(1.0 - abs(dot(N, V)), 2.0);
    vec3 c = alb * uL * dif + fur * uL * vec3(0.40, 0.37, 0.33) * rim * 0.22 * (0.3 + 0.7 * wr) * (0.5 + s1);
    c += uL * vC.a * pow(max(dot(N, normalize(uLd + V)), 0.0), 34.0) * 0.8;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
// the slice: vR = (s from the crust's outer edge, c across) in metres; vC.x = half width there, vC.y = 0 on the top skin, 1 underneath (the cut sides run between)
const SLICE_FRAG = `uniform vec3 uL; uniform vec3 uLd; varying vec3 vN; varying vec3 vW; varying vec4 vC; varying vec2 vR;
  ${NOISE}
  float fb(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; } return s / 0.9375; }
  vec3 S(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
  void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); vec2 m = vR;
    float w1 = fb(m * 38.0), w2 = fb(m * 90.0 + 11.0), f1 = fb(m * 260.0 + 5.0), f2 = vn(m * 700.0), f3 = vn(m * 1500.0 + 3.0);
    float edge = m.x + (w2 - 0.5) * 0.007, crust = 1.0 - smoothstep(0.019, 0.024, edge), side = vC.x - abs(m.y);
    vec3 cheese = mix(S(0.80, 0.67, 0.45), S(0.74, 0.50, 0.26), smoothstep(0.35, 0.75, w1 * 0.6 + w2 * 0.4));      // pale melted cheese; tan-orange where the oil and the sauce come through it
    cheese = mix(cheese, S(0.50, 0.31, 0.15), smoothstep(0.58, 0.70, f1) * smoothstep(0.40, 0.62, w2) * 0.8);      // fine browning: freckles of a millimetre or two, in loose patches
    cheese = mix(cheese, S(0.36, 0.20, 0.10), smoothstep(0.72, 0.80, f1) * smoothstep(0.50, 0.70, w2) * 0.7);
    cheese *= 0.9 + 0.2 * f2;
    float rw = 0.004 + 0.007 * w1, sauce = max(1.0 - smoothstep(rw * 0.6, rw, edge - 0.022), (1.0 - smoothstep(0.001, 0.0045, side + (w2 - 0.5) * 0.004)) * 0.7);
    cheese = mix(cheese, S(0.55, 0.17, 0.09) * (0.85 + 0.3 * f2), sauce * 0.9);                                    // red sauce where the cheese stops short of the crust, and along the cuts
    vec3 bread = mix(S(0.80, 0.66, 0.46), S(0.60, 0.42, 0.24), smoothstep(0.45, 0.8, fb(m * vec2(150.0, 60.0) + 2.0)) * 0.8) * (0.9 + 0.2 * f3);
    vec3 under = mix(S(0.76, 0.64, 0.46), S(0.42, 0.28, 0.15), smoothstep(0.55, 0.8, f1));
    vec3 alb = mix(mix(mix(cheese, bread, crust), S(0.78, 0.66, 0.47), smoothstep(0.03, 0.3, vC.y)), under, smoothstep(0.6, 0.95, vC.y)) * KALB;
    float gl = (1.0 - crust) * (1.0 - smoothstep(0.0, 0.2, vC.y));
    vec3 Nb = normalize(N + gl * 0.35 * vec3(vn(m * 210.0) - 0.5, 0.0, vn(m * 210.0 + 40.0) - 0.5));
    float wr = 0.5 + 0.5 * dot(Nb, uLd), dif = mix(0.4, 1.0, wr * wr * (3.0 - 2.0 * wr)) * mix(1.0, 0.55, smoothstep(0.3, 1.0, vC.y));
    vec3 c = alb * uL * dif + uL * gl * pow(max(dot(Nb, normalize(uLd + V)), 0.0), 40.0) * 0.1;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`.replace('KALB', (0.46).toFixed(3));      // the whole slice's brightness against the steps it lies on (the blind critic: never the brightest thing on the stair)
// soft darkness multiplied onto what is already drawn: vR = quad coordinates -1..1, vC.x = strength, vC.y = 1 for the ragged gap in the wall
const DARK_FRAG = `varying vec4 vC; varying vec2 vR;
  ${NOISE}
  void main(){ float r = length(vR), a; if (vC.y > 0.5) { float n = vn(vR * 3.1 + 7.0) * 0.6 + vn(vR * 9.0) * 0.4; a = (1.0 - smoothstep(0.42 + 0.4 * n, 0.6 + 0.4 * n, max(abs(vR.x) * 0.9, vR.y * 0.5 + 0.5))) * vC.x; } else a = (1.0 - smoothstep(vC.z, 1.0, r)) * vC.x;
    gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`;

const RING = 25, NC = 10, SUB = 3, BODY = (NC - 1) * SUB + 1, EARN = 13, EYEN = 9, LR = 5, LS = 8, TRING = 8, NWH = 10, EARS = BODY * RING, EYES = EARS + 2 * EARN, LEGS = EYES + 2 * EYEN, TAIL = LEGS + 4 * LR * LS, WHISK = TAIL + (TN + 1) * TRING, TOES = WHISK + NWH * 3, RAT_V = TOES + 48;
// half widths and half heights at the ten stations: tail root, rump, hips, mid back, shoulders, neck, skull, cheeks, muzzle, nose (a pear: all haunch, no neck)
const BRW = [0.011, 0.036, 0.049, 0.048, 0.037, 0.029, 0.0225, 0.0155, 0.009, 0.0042], BRH = [0.011, 0.034, 0.046, 0.047, 0.037, 0.028, 0.022, 0.015, 0.0085, 0.0042];
// a smooth curve through the stations (Catmull-Rom), read at ring k; A holds `stride` numbers a station, q picks one
const crv = (A, stride, q, k) => { const r = Math.min(NC - 2, Math.floor(k / SUB)), t = k / SUB - r, p0 = A[Math.max(0, r - 1) * stride + q], p1 = A[r * stride + q], p2 = A[(r + 1) * stride + q], p3 = A[Math.min(NC - 1, r + 2) * stride + q]; return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t); };
const RW = Array.from({ length: BODY }, (_, k) => crv(BRW, 1, 0, k)), RH = Array.from({ length: BODY }, (_, k) => crv(BRH, 1, 0, k));
const LWF = [0.012, 0.0075, 0.0048, 0.0052, 0.0036], LHF = [0.012, 0.0075, 0.0045, 0.003, 0.0016], LWH = [0.024, 0.0125, 0.0058, 0.0062, 0.0046], LHH = [0.026, 0.0125, 0.0055, 0.0034, 0.0017];
const S_ROWS = [0, 0.005, 0.011, 0.018, 0.026, 0.04, 0.06, 0.085, 0.11, 0.135, 0.16, 0.185, 0.21, 0.235, 0.26, 0.28], S_COLS = [-1, -0.9, -0.5, 0, 0.5, 0.9, 1], SLICE_H = S_ROWS.length * S_COLS.length, SLICE_V = 2 * SLICE_H, NSH = 6, NDQ = 4 + NSH;

class Look {
  constructor(layer) { const mk = (nv, idx, frag, o = {}) => { const g = new THREE.BufferGeometry(), F = (k) => new THREE.BufferAttribute(new Float32Array(nv * k), k); g.setAttribute('position', F(3)); g.setAttribute('normal', F(3)); g.setAttribute('aCol', F(4)); g.setAttribute('aRest', F(2)); g.setIndex(idx);
      g.attributes.position.setUsage(THREE.DynamicDrawUsage); g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { uL: { value: new THREE.Vector3(0.3, 0.3, 0.3) }, uLd: { value: new THREE.Vector3(0, 1, 0) } }, vertexShader: VERT, fragmentShader: frag, side: THREE.DoubleSide, fog: false, ...o })); m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.enable(layer); m.renderOrder = -15; return m; };
    // ---- the rat: indices and what never changes (colours, rest coordinates)
    const idx = [], tube = (base, rings, seg, wrap) => { for (let r = 0; r < rings - 1; r++) for (let j = 0; j < (wrap ? seg : seg - 1); j++) { const a = base + r * seg + j, b = base + r * seg + (j + 1) % seg, c = a + seg, d = b + seg; idx.push(a, b, c, b, d, c); } };
    tube(0, BODY, RING, false); for (let e = 0; e < 2; e++) { const b = EARS + e * EARN; for (let j = 0; j < EARN - 1; j++) idx.push(b, b + 1 + j, b + 1 + (j + 1) % (EARN - 1)); } for (let e = 0; e < 2; e++) { const b = EYES + e * EYEN; for (let j = 0; j < EYEN - 1; j++) idx.push(b, b + 1 + j, b + 1 + (j + 1) % (EYEN - 1)); }
    for (let l = 0; l < 4; l++) tube(LEGS + l * LR * LS, LR, LS, true); tube(TAIL, TN + 1, TRING, true); for (let k = 0; k < NWH + 16; k++) idx.push(WHISK + k * 3, WHISK + k * 3 + 1, WHISK + k * 3 + 2);      /* whiskers, then the toes: one thin triangle each */
    this.rat = mk(RAT_V, idx, RAT_FRAG); this.A = new Float64Array(NC); this.B = new Float64Array(BODY * 3); this.Lg = new Float64Array(LR * 3); const C = this.rat.geometry.attributes.aCol.array, Rr = this.rat.geometry.attributes.aRest.array, col = (i, c, gl = 0) => { C[i * 4] = c[0]; C[i * 4 + 1] = c[1]; C[i * 4 + 2] = c[2]; C[i * 4 + 3] = gl; };
    // a wild brown rat: grey-brown agouti, darker down the spine, pale grey-buff under; ears, feet and tail a dull greyish pink (not bright)
    const top = lin(0.33, 0.29, 0.25), flank = lin(0.46, 0.42, 0.37), belly = lin(0.68, 0.66, 0.62), pink = lin(0.70, 0.58, 0.54), tailc = lin(0.40, 0.33, 0.29), ear = lin(0.50, 0.39, 0.35), toe = lin(0.78, 0.67, 0.63), mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    for (let k = 0; k < BODY; k++) for (let j = 0; j < RING; j++) { const i = k * RING + j, sn = Math.sin(j / (RING - 1) * TAU); let c = sn > 0 ? mix3(flank, top, smooth(0.1, 0.8, sn)) : mix3(flank, belly, smooth(0.15, 0.75, -sn)); if (k >= 18 && sn < 0) c = mix3(c, belly, 0.5); if (k === BODY - 1) c = pink; else if (k === BODY - 2) c = mix3(c, pink, 0.4); col(i, c, k === BODY - 1 ? 0.2 : 0); Rr[i * 2] = k / (BODY - 1); Rr[i * 2 + 1] = j / (RING - 1); }
    for (let e = 0; e < 2; e++) for (let j = 0; j < EARN; j++) { col(EARS + e * EARN + j, j ? ear : mix3(ear, pink, 0.5), 0.05); } for (let e = 0; e < 2; e++) for (let j = 0; j < EYEN; j++) col(EYES + e * EYEN + j, [0.004, 0.003, 0.003], 1);
    for (let l = 0; l < 4; l++) for (let r = 0; r < LR; r++) for (let j = 0; j < LS; j++) { const i = LEGS + l * LR * LS + r * LS + j; col(i, r < 2 ? (r ? mix3(flank, belly, 0.35) : flank) : r === 2 ? mix3(flank, pink, 0.7) : pink, r < 2 ? 0 : 0.07); Rr[i * 2] = 0.3 + r * 0.07; Rr[i * 2 + 1] = j / LS; }
    for (let r = 0; r <= TN; r++) for (let j = 0; j < TRING; j++) { const i = TAIL + r * TRING + j; col(i, mix3(tailc, lin(0.29, 0.24, 0.21), Math.sin(j / TRING * TAU) > 0.3 ? 0.6 : 0), 0.06); Rr[i * 2] = 100 + r * 4; } for (let i = WHISK; i < TOES; i++) col(i, lin(0.7, 0.68, 0.64), 0.03); for (let i = TOES; i < RAT_V; i++) col(i, toe, 0.07);
    // ---- the slice
    // two skins on the same grid (top, then underneath) joined round the edge: a slice has a body, and a thick rounded crust
    const si = [], nc = S_COLS.length, nr = S_ROWS.length; for (let r = 0; r < nr - 1; r++) for (let j = 0; j < nc - 1; j++) { const a = r * nc + j, b = a + 1, c = a + nc, d = c + 1; si.push(a, b, c, b, d, c, a + SLICE_H, c + SLICE_H, b + SLICE_H, b + SLICE_H, c + SLICE_H, d + SLICE_H); }
    const rim = (a, b) => si.push(a, b, a + SLICE_H, b, b + SLICE_H, a + SLICE_H); for (let j = 0; j < nc - 1; j++) { rim(j, j + 1); rim((nr - 1) * nc + j, (nr - 1) * nc + j + 1); } for (let r = 0; r < nr - 1; r++) { rim(r * nc, (r + 1) * nc); rim(r * nc + nc - 1, (r + 1) * nc + nc - 1); }
    this.slice = mk(SLICE_V, si, SLICE_FRAG); const sC = this.slice.geometry.attributes.aCol.array, sR = this.slice.geometry.attributes.aRest.array; this.sm = new Float32Array(SLICE_V * 5); this.cd = new Float64Array(SN); this.cz = new Float64Array(SN);      // per vertex: s (with the crust's bow), c, height off the chain, which way is out of the slice (s, c)
    for (let b = 0; b < 2; b++) for (let r = 0; r < nr; r++) for (let j = 0; j < nc; j++) { const i = b * SLICE_H + r * nc + j, s = S_ROWS[r], q = S_COLS[j], hw = (SW / 2) * (1 - s / 0.287) + 0.0015, c = q * hw, se = s - BULGE * (1 - (c / (SW / 2)) * (c / (SW / 2))) * (1 - s / SLEN);
      const e = Math.abs(q) === 1, cr = 0.0052 + 0.0105 * Math.exp(-Math.pow((s - 0.011) / 0.0085, 2)), tt = r === nr - 1 ? 0.003 : Math.max(e ? 0.0038 : 0, cr * (e ? 0.8 : 1) * (r === 0 ? 0.62 : 1)), tb = r === 0 ? 0.0035 : 0.0008;
      this.sm[i * 5] = se; this.sm[i * 5 + 1] = c; this.sm[i * 5 + 2] = (b ? tb : tt) - 0.003; this.sm[i * 5 + 3] = r === 0 ? -1 : r === nr - 1 ? 1 : 0; this.sm[i * 5 + 4] = e ? q : 0; sR[i * 2] = s; sR[i * 2 + 1] = c; sC[i * 4] = hw; sC[i * 4 + 1] = b; }
    // ---- shadows under the rat (two) and the gap in the wall
    const di = []; for (let q = 0; q < NDQ; q++) di.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    this.dark = mk(NDQ * 4, di, DARK_FRAG, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); this.dark.renderOrder = -16;
    const dR = this.dark.geometry.attributes.aRest.array, Q = [-1, -1, 1, -1, 1, 1, -1, 1]; for (let q = 0; q < NDQ; q++) for (let k = 0; k < 4; k++) { dR[(q * 4 + k) * 2] = Q[k * 2]; dR[(q * 4 + k) * 2 + 1] = Q[k * 2 + 1]; }
    this.group = new THREE.Group(); this.group.name = 'sur_pizzarat'; this.group.matrixAutoUpdate = false; this.group.add(this.dark, this.rat, this.slice); this.ld = [0, 0, 0]; this.L = [0, 0, 0]; }
  // the group's frame: X = down the stair, Y = up, Z = -v; origin at the stair's middle on height 0
  place(st) { const f = st.f, dn = st.dn, m = this.group.matrix; m.set(dn * st.ca, 0, dn * st.sa, f.x, 0, 1, 0, 0, -dn * st.sa, 0, dn * st.ca, -f.y, 0, 0, 0, 1); this.group.matrixWorldNeedsUpdate = true; for (const o of this.group.children) { o.matrix.identity(); } this.group.updateMatrixWorld(true); this.st = st; }
  shq(q, st, cd, cv, Rd, Rv, str, inner) { const g = this.dark.geometry.attributes, P = g.position.array, C = g.aCol.array, R = g.aRest.array, hl = st.l / 2; let d0 = cd - Rd, d1 = cd + Rd; if (cd >= 0 && cd < st.l) { const e = Math.floor(cd / st.tr) * st.tr; d0 = Math.max(d0, e); d1 = Math.min(d1, e + st.tr); } const z = st.H(cd) + 0.003;
    for (let k = 0; k < 4; k++) { const i = q * 4 + k, dd = k === 0 || k === 3 ? d0 : d1, y = k < 2 ? -1 : 1; P[i * 3] = dd - hl; P[i * 3 + 1] = z; P[i * 3 + 2] = -(cv + y * Rv); R[i * 2] = (dd - cd) / Rd; R[i * 2 + 1] = y; C[i * 4] = str; C[i * 4 + 1] = 0; C[i * 4 + 2] = inner; } }
  holes(st, rat) { const P = this.dark.geometry.attributes.position.array, C = this.dark.geometry.attributes.aCol.array, hl = st.l / 2;
    // the two gaps at the wall's foot it can bolt into: one below it, one above
    for (let q = 2; q < 4; q++) { const d = q === 2 ? rat.holeDn : rat.holeUp, z = st.H(d), zz = -(rat.side * (st.w / 2 - 0.004)), o = q * 12; P[o] = d - 0.085 - hl; P[o + 1] = z; P[o + 2] = zz; P[o + 3] = d + 0.085 - hl; P[o + 4] = z; P[o + 5] = zz; P[o + 6] = d + 0.085 - hl; P[o + 7] = z + 0.1; P[o + 8] = zz; P[o + 9] = d - 0.085 - hl; P[o + 10] = z + 0.1; P[o + 11] = zz;
      for (let k = 0; k < 4; k++) { C[(q * 4 + k) * 4] = 0.94; C[(q * 4 + k) * 4 + 1] = 1; } } this.dark.geometry.attributes.position.needsUpdate = true; this.dark.geometry.attributes.aCol.needsUpdate = true; }
  update(st, rat, sl, light) { const hl = st.l / 2;
    // ---------------- light
    const sky = st.light(rat.hipD, rat.v, rat.zHip, this.L), lx = lerp(clamp((st.dL - rat.hipD) * 0.25, -0.45, 0.45), -0.5, sky), ll = Math.hypot(lx, 1), m = this.group.matrix.elements;
    for (const o of [this.rat, this.slice]) { o.material.uniforms.uL.value.set(this.L[0], this.L[1], this.L[2]); o.material.uniforms.uLd.value.set(m[0] * lx / ll, 1 / ll, m[2] * lx / ll); }
    // ---------------- the slice over its chain
    // the chain is the slice's line down the steps; what is drawn is that line eased (dough bends in a curve, it does not crease), kept off the steps
    { const P = this.slice.geometry.attributes.position.array, N = this.slice.geometry.attributes.normal.array, sm = this.sm, cg = rat.side * 0.06, psi = rat.psi, cp = Math.cos(psi), sp = Math.sin(psi), vg = rat.gv, d = this.cd, z = this.cz; d.set(sl.d); z.set(sl.z);
      for (let it = 0; it < 2; it++) { let pd = d[0], pz = z[0]; for (let k = 1; k < SN - 1; k++) { const a = (pd + 2 * d[k] + d[k + 1]) / 4, b = (pz + 2 * z[k] + z[k + 1]) / 4; pd = d[k]; pz = z[k]; d[k] = a; z[k] = b; } }
      for (let k = 0; k < SN; k++) z[k] = Math.max(z[k], st.G(d[k], 6) + 0.0035);
      for (let i = 0; i < SLICE_V; i++) { const s = sm[i * 5], c = sm[i * 5 + 1] - cg, th = sm[i * 5 + 2], tau = s * cp - c * sp, kf = clamp((tau - TA) / SL, 0, SN - 1.001), k = Math.floor(kf), f = kf - k, k0 = Math.max(0, k - 1), k3 = Math.min(SN - 1, k + 2);
        let td = lerp(d[k + 1] - d[k0], d[k3] - d[k], f), tz = lerp(z[k + 1] - z[k0], z[k3] - z[k], f); const tl = Math.hypot(td, tz) || 1e-9; td /= tl; tz /= tl; const nd = tz, nz = -td, bs = i < SLICE_H ? 1 : -1, os = sm[i * 5 + 3], oc = sm[i * 5 + 4], oa = os * cp - oc * sp, ol = os * sp + oc * cp;
        P[i * 3] = lerp(d[k], d[k + 1], f) + nd * th - hl; P[i * 3 + 1] = lerp(z[k], z[k + 1], f) + nz * th; P[i * 3 + 2] = -(vg + s * sp + c * cp);
        const k6 = os || oc ? 0.6 : 1, nx = nd * bs * k6 + oa * td, ny = nz * bs * k6 + oa * tz, nl = Math.hypot(nx, ny, ol) || 1; N[i * 3] = nx / nl; N[i * 3 + 1] = ny / nl; N[i * 3 + 2] = -ol / nl; }
      this.slice.geometry.attributes.position.needsUpdate = true; this.slice.geometry.attributes.normal.needsUpdate = true;
      // its own shade on the treads: one soft patch under each stretch of it, darker and tighter where it lies on the step
      for (let b = 0; b < NSH; b++) { const k = KP + 1 + b * 2, s = ((k - KP) * SL - cg * sp) / cp, hw = (SW / 2) * (1 - s / 0.287), h = sl.z[k] - st.H(sl.d[k]); this.shq(4 + b, st, sl.d[k], vg + s * sp - cg * cp, 0.045, Math.max(0.02, hw + 0.018), s < 0 || s > 0.275 ? 0 : 0.42 * clamp(1 - (h - 0.004) / 0.07, 0, 1), 0.6); }
      const g = this.dark.geometry.attributes; g.position.needsUpdate = true; g.aCol.needsUpdate = true; g.aRest.needsUpdate = true; }
    if (rat.mode === 'gone') { this.rat.visible = false; const C = this.dark.geometry.attributes.aCol.array; if (C[0] !== 0) { for (let k = 0; k < 8; k++) C[k * 4] = 0; this.dark.geometry.attributes.aCol.needsUpdate = true; } return; }
    // ---------------- the rat
    const P = this.rat.geometry.attributes.position.array, N = this.rat.geometry.attributes.normal.array, hx = Math.cos(rat.th), hv = Math.sin(rat.th), sx = -hv, sv = hx, so = rat.so, nose = rat.rr + 0.012, hlen = nose - so, bw0 = 1 + 0.1 * (rat.bunch || 0);
    const A = this.A, Cc = rat.C, B = this.B, zN = rat.mz + 0.01, br = 1 + 0.035 * Math.sin(rat.t * 9.5), mvOff = rat.mv - (rat.v + hv * (nose - 0.012)), zSh = Math.max(rat.zSh, zN - 0.058), rear = clamp((zSh - rat.zHip) / 0.1, 0, 1), arch = rat.hunch + 0.007 + 0.3 * Math.abs(zSh - rat.zHip);      // it rears to reach a step above (shoulders come up under the head, never a long neck); the back humps, more so then
    A[0] = -0.046 * (1 - 0.45 * rear); A[1] = -0.03 * (1 - 0.4 * rear); A[2] = 0; const sLen = Math.hypot(so, zSh - rat.zHip) || 1e-9, pA = -(zSh - rat.zHip) / sLen, pZ = so / sLen;      /* the back humps square to the spine: reared up a step it bulges out behind, a ball, not a plank */ A[3] = so * 0.45; A[4] = so; A[5] = so + hlen * 0.3; A[6] = so + hlen * 0.58; A[7] = so + hlen * 0.8; A[8] = so + hlen * 0.95; A[9] = nose;
    for (let r = 0; r < NC; r++) { let a = A[r]; let z; if (a <= 0) z = rat.zHip - (r === 0 ? 0.02 : r === 1 ? 0.007 : 0); else if (a <= so) { const bump = arch * Math.sin(Math.PI * a / so); z = lerp(rat.zHip, zSh, a / so) + bump * pZ; a += bump * pA; } else { const t = (a - so) / hlen; z = lerp(zSh + 0.004, zN, t * t * (3 - 2 * t)) + 0.007 * Math.sin(Math.PI * t); }
      const t2 = a > so ? (a - so) / hlen : 0, d = rat.hipD + hx * a, v = rat.v + hv * a + mvOff * t2 * t2; z = Math.max(z, st.G(d, 1.2) + BRH[r] * 0.9); Cc[r * 3] = d; Cc[r * 3 + 1] = v; Cc[r * 3 + 2] = z; }
    const bw = bw0 + 0.2 * rear;      // sat up on its haunches to reach a step above, it is a pear: the weight goes to the rump
    // the body's rings: the ten stations and two smooth ones between each pair (a curve through four stations)
    for (let k = 0; k < BODY; k++) { const o = k * 3; for (let q = 0; q < 3; q++) B[o + q] = crv(Cc, 3, q, k); B[o + 2] = Math.max(B[o + 2], st.G(B[o], 1.2) + RH[k] * 0.9); }
    // one ring of n points round (cd, cv, cz) across the direction t; hd, hw: which way its width lies (default: level, across t)
    const ring = (base, n, cd, cv, cz, tdx, tvx, tzx, rw, rh, flat, hd, hw) => { let L = Math.hypot(tdx, tvx, tzx) || 1e-9; tdx /= L; tvx /= L; tzx /= L; let sd, sw; if (hd !== undefined) { sd = hd; sw = hw; } else { sd = -tvx; sw = tdx; L = Math.hypot(sd, sw) || 1e-9; sd /= L; sw /= L; }
      let ud = -tzx * sw, uv = tzx * sd, uz = tdx * sw - tvx * sd; if (hd !== undefined) { L = Math.hypot(ud, uv, uz) || 1e-9; ud /= L; uv /= L; uz /= L; } const nn = n === RING ? n - 1 : n;
      for (let j = 0; j < n; j++) { const ph = j / nn * TAU, c = Math.cos(ph), s = Math.sin(ph), sh = s < 0 ? s * flat : s, i = (base + j) * 3, od = sd * c * rw + ud * sh * rh, ov = sw * c * rw + uv * sh * rh, oz = uz * sh * rh;
        P[i] = cd + od - hl; P[i + 1] = cz + oz; P[i + 2] = -(cv + ov); const nl = Math.hypot(sd * c + ud * s, uz * s, sw * c + uv * s) || 1; N[i] = (sd * c + ud * s) / nl; N[i + 1] = uz * s / nl; N[i + 2] = -(sw * c + uv * s) / nl; } };
    for (let k = 0; k < BODY; k++) { const a = Math.max(0, k - 1) * 3, b = Math.min(BODY - 1, k + 1) * 3, o = k * 3; ring(k * RING, RING, B[o], B[o + 1], B[o + 2], B[b] - B[a], B[b + 1] - B[a + 1], B[b + 2] - B[a + 2], RW[k] * (k >= 8 && k <= 11 ? br : 1) * (k >= 3 && k <= 12 ? bw : 1), RH[k] * (k >= 3 && k <= 10 ? 1 + 0.2 * rear : 1), k < 15 ? 0.8 : 0.92); }
    // the body's normals from the surface itself (along the body x round it), so no ring or facet shows
    for (let k = 1; k < BODY - 1; k++) for (let j = 0; j < RING; j++) { const i = (k * RING + j) * 3, a = ((k - 1) * RING + j) * 3, b = ((k + 1) * RING + j) * 3, l = (k * RING + (j + RING - 2) % (RING - 1)) * 3, r = (k * RING + (j + 1) % (RING - 1)) * 3, ax = P[b] - P[a], ay = P[b + 1] - P[a + 1], az = P[b + 2] - P[a + 2], cx = P[r] - P[l], cy = P[r + 1] - P[l + 1], cz = P[r + 2] - P[l + 2];
      let nx = ay * cz - az * cy, ny = az * cx - ax * cz, nz = ax * cy - ay * cx; const nl = Math.hypot(nx, ny, nz); if (nl < 1e-12) continue; const sg = nx * N[i] + ny * N[i + 1] + nz * N[i + 2] < 0 ? -1 / nl : 1 / nl; N[i] = nx * sg; N[i + 1] = ny * sg; N[i + 2] = nz * sg; }
    const put = (i, d, v, z, nd, nv, nz) => { P[i * 3] = d - hl; P[i * 3 + 1] = z; P[i * 3 + 2] = -v; N[i * 3] = nd; N[i * 3 + 1] = nz; N[i * 3 + 2] = -nv; };
    // head frame from the skull to the snout: f forward, e to its left, u up
    let fd = Cc[24] - Cc[18], fv = Cc[25] - Cc[19], fz = Cc[26] - Cc[20], fl = Math.hypot(fd, fv, fz) || 1e-9; fd /= fl; fv /= fl; fz /= fl; let ed = -fv, ev = fd, el = Math.hypot(ed, ev) || 1e-9; ed /= el; ev /= el; const ud = -fz * ev, uv = fz * ed, uz = fd * ev - fv * ed;
    for (let e = 0; e < 2; e++) { const sg = e ? -1 : 1, b = EARS + e * EARN, cd = Cc[18] + ed * sg * 0.019 + ud * 0.02 - fd * 0.004, cv = Cc[19] + ev * sg * 0.019 + uv * 0.02 - fv * 0.004, cz = Cc[20] + uz * 0.02 - fz * 0.004;
      // the ear's own plane: a up and out, b back and out; it faces forward and a little out, and is cupped (its middle sits behind its rim)
      let ad = ud + ed * sg * 0.45, av = uv + ev * sg * 0.45, az = uz, al = Math.hypot(ad, av, az); ad /= al; av /= al; az /= al; let bd = ed * sg * 0.8 - fd * 0.6, bv = ev * sg * 0.8 - fv * 0.6, bz = -fz * 0.6, bl = Math.hypot(bd, bv, bz); bd /= bl; bv /= bl; bz /= bl;
      let nd = av * bz - az * bv, nv = az * bd - ad * bz, nz = ad * bv - av * bd; const sgn = nd * fd + nv * fv + nz * fz < 0 ? -1 : 1; nd *= sgn; nv *= sgn; nz *= sgn; put(b, cd - nd * 0.0035, cv - nv * 0.0035, cz - nz * 0.0035, nd, nv, nz);
      for (let j = 0; j < EARN - 1; j++) { const ph = j / (EARN - 1) * TAU, c = Math.cos(ph) * 0.0165, s = Math.sin(ph) * 0.014, k = 0.55; put(b + 1 + j, cd + ad * c + bd * s, cv + av * c + bv * s, cz + az * c + bz * s, nd + (ad * c + bd * s) * k * 80, nv + (av * c + bv * s) * k * 80, nz + (az * c + bz * s) * k * 80); } }
    for (let e = 0; e < 2; e++) { const sg = e ? -1 : 1, b = EYES + e * EYEN, cd = Cc[21] + ed * sg * 0.0128 + ud * 0.0078, cv = Cc[22] + ev * sg * 0.0128 + uv * 0.0078, cz = Cc[23] + uz * 0.0078; put(b, cd + ed * sg * 0.0046 + ud * 0.001, cv + ev * sg * 0.0046 + uv * 0.001, cz + uz * 0.001, ed * sg, ev * sg, 0.25);
      for (let j = 0; j < EYEN - 1; j++) { const ph = j / (EYEN - 1) * TAU, c = Math.cos(ph) * 0.0052, s = Math.sin(ph) * 0.0052; put(b + 1 + j, cd + fd * c + ud * s, cv + fv * c + uv * s, cz + fz * c + uz * s, ed * sg * 0.7 + fd * c * 120 + ud * s * 120, ev * sg * 0.7 + fv * c * 120 + uv * s * 120, 0.3 + (fz * c + uz * s) * 120); } }
    // whiskers: three a side from the muzzle, out and a little back
    for (let k = 0; k < NWH; k++) { const sg = k < 5 ? 1 : -1, q = (k % 5 - 2) * 0.55, b = WHISK + k * 3, bd = Cc[24] + ed * sg * 0.0055 - fd * 0.004, bv = Cc[25] + ev * sg * 0.0055 - fv * 0.004, bz = Cc[26] - fz * 0.004 - 0.001;
      put(b, bd + ud * 0.0007, bv + uv * 0.0007, bz + uz * 0.0007, fd, fv, fz); put(b + 1, bd - ud * 0.0007, bv - uv * 0.0007, bz - uz * 0.0007, fd, fv, fz); put(b + 2, bd + ed * sg * 0.044 + ud * q * 0.016 - fd * 0.007 * (q + 1), bv + ev * sg * 0.044 + uv * q * 0.016 - fv * 0.007 * (q + 1), bz + uz * q * 0.016 - fz * 0.007 * (q + 1), fd, fv, fz); }
    // legs: joint at the body, knee / elbow, heel / wrist, the middle of the foot, the toes. The hind foot lies long and flat ahead of its heel.
    for (let l = 0; l < 4; l++) { const f = rat.foot[l], fore = l < 2, sg = l % 2 ? -1 : 1, b = LEGS + l * LR * LS, cr = fore ? 4 : 2, wj = fore ? 0.022 : 0.034, G = this.Lg, W = fore ? LWF : LWH, H = fore ? LHF : LHH;
      const hb = fore ? 0.004 : 0.012, len = fore ? 0.015 : 0.03, kf = fore ? -0.008 : 0.024; G[0] = Cc[cr * 3] + sx * sg * wj; G[1] = Cc[cr * 3 + 1] + sv * sg * wj; G[2] = Cc[cr * 3 + 2] - (fore ? 0.01 : 0.012);
      // a leg is only so long: a forepaw that cannot reach the ground is held up under the chest (a rat rearing), a hind foot trails
      let pd = f.d, pv = f.v, pz = f.z; { const ln = Math.hypot(pd - G[0], pv - G[1], pz - G[2]); if (fore) { const w = smooth(0.05, 0.075, ln); if (w > 0) { pd = lerp(pd, G[0] + hx * 0.026 - sx * sg * 0.005, w); pv = lerp(pv, G[1] + hv * 0.026 - sv * sg * 0.005, w); pz = lerp(pz, G[2] - 0.04, w); } } else if (ln > 0.07) { const k = 0.07 / ln; pd = G[0] + (pd - G[0]) * k; pv = G[1] + (pv - G[1]) * k; pz = G[2] + (pz - G[2]) * k; } }
      G[6] = pd - hx * hb; G[7] = pv - hv * hb; G[8] = pz + (fore ? 0.006 : 0.0075); G[3] = (G[0] + G[6]) / 2 + hx * kf + sx * sg * 0.005; G[4] = (G[1] + G[7]) / 2 + hv * kf + sv * sg * 0.005; G[5] = (G[2] + G[8]) / 2 + (fore ? 0.002 : 0.008);
      G[12] = pd + hx * len + sx * sg * 0.003; G[13] = pv + hv * len + sv * sg * 0.003; G[14] = pz + 0.0022; G[9] = (G[6] + G[12]) / 2; G[10] = (G[7] + G[13]) / 2; G[11] = pz + 0.0042;
      for (let r = 0; r < LR; r++) { const a = Math.max(0, r - 1) * 3, c = Math.min(LR - 1, r + 1) * 3; ring(b + r * LS, LS, G[r * 3], G[r * 3 + 1], G[r * 3 + 2], G[c] - G[a], G[c + 1] - G[a + 1], G[c + 2] - G[a + 2], W[r], H[r], 1, sx * sg, sv * sg); }
      // four long bony toes spread on the step from the end of each foot
      for (let t = 0; t < 4; t++) { const an = (t - 1.5) * (fore ? 0.42 : 0.3) + sg * 0.12, ca = Math.cos(an), sa = Math.sin(an), dd = hx * ca + sx * sa, dv = hv * ca + sv * sa, tl = fore ? 0.016 : 0.023, od = G[12] - dd * 0.004 + sx * (t - 1.5) * 0.0028, ov = G[13] - dv * 0.004 + sv * (t - 1.5) * 0.0028, i = TOES + l * 12 + t * 3, td = od + dd * tl, tv = ov + dv * tl;
        put(i, od - dv * 0.0016, ov + dd * 0.0016, pz + 0.003, 0, 0, 1); put(i + 1, od + dv * 0.0016, ov - dd * 0.0016, pz + 0.003, 0, 0, 1); put(i + 2, td, tv, Math.max(st.H(td), pz) + 0.0012, 0, 0, 1); } }
    { const T = rat.tail; let pd = Cc[0], pv = Cc[1], pz = Cc[2]; for (let r = 0; r <= TN; r++) { const cd = r ? T[(r - 1) * 3] : pd, cv = r ? T[(r - 1) * 3 + 1] : pv, cz = r ? T[(r - 1) * 3 + 2] : pz, n = Math.min(TN - 1, r), nd = T[n * 3], nv = T[n * 3 + 1], nz = T[n * 3 + 2], q = r < 2 ? 0 : (r - 2) * 3, rr = lerp(0.0085, 0.0018, Math.pow(r / TN, 0.8));
        ring(TAIL + r * TRING, TRING, cd, cv, cz, r ? nd - (r < 2 ? pd : T[q]) : nd - cd, r ? nv - (r < 2 ? pv : T[q + 1]) : nv - cv, r ? nz - (r < 2 ? pz : T[q + 2]) : nz - cz, rr, rr, 1); } }
    this.rat.geometry.attributes.position.needsUpdate = true; this.rat.geometry.attributes.normal.needsUpdate = true; this.rat.visible = true;
    // ---------------- its shadow on the tread under each end
    { const into = rat.into ? 0 : 1; for (let q = 0; q < 2; q++) { const a = q ? so * 0.85 : 0.0, cd = rat.hipD + hx * a, cv = rat.v + hv * a, h = clamp(1 - ((q ? rat.zSh : rat.zHip) - 0.046 - st.H(cd)) / 0.14, 0, 1), R = q ? 0.075 : 0.095; this.shq(q, st, cd, cv, R, R * 0.92, 0.72 * h * into, 0.3); }
      const g = this.dark.geometry.attributes; g.position.needsUpdate = true; g.aCol.needsUpdate = true; g.aRest.needsUpdate = true; } }
  dispose() { if (this.group.parent) this.group.parent.remove(this.group); for (const o of this.group.children) { o.geometry.dispose(); o.material.dispose(); } }
}

// ------------------------------------------------------------------------------------------------ install
export function install(game, kit) {
  const g = game, pl = g.player, Pq = g.P || new URLSearchParams(''), M = { rolls: 0, yes: 0, spawns: 0, fled: 0, pulls: 0, ms: 0, msMax: 0, frames: 0, cur: null, want: null, state: 'idle' };
  const seed = Pq.get('ratseed') !== null ? +Pq.get('ratseed') | 0 : (Math.random() * 0x7fffffff) | 0, pAll = Pq.get('ratp') !== null ? clamp(+Pq.get('ratp') || 0, 0, 1) : -1;
  M.seed = seed; const visit = new Map(); let hooked = null, scanT = 0, look = null, voice = null; const lp = { d: 0, v: 0 }, wp = { x: 0, y: 0 }, PP = { d: 0, v: 0, z: 0, speed: 0 }; let lastX = 0, lastY = 0, spd = 0;
  // would a rat be on this stair on this visit? (the whole roll; nothing else decides it)
  M.roll = (stId, entId, nVisit) => { if (pAll >= 0) return hash(seed, entId, nVisit) < pAll; return hash(seed, strHash(stId), 77) < P_STATION && hash(seed, entId, nVisit) < P_VISIT; };
  const floorOf = (u, entId) => { const m = (u._ratF ||= new Map()); if (!m.has(entId)) m.set(entId, (u.st.floors || []).find((q) => q.k === 'street' && q.ent === entId) || null); return m.get(entId); };
  const despawn = () => { const c = M.cur; if (!c) return; M.cur = null; M.state = 'idle'; try { if (c.look.group.parent) c.look.group.parent.remove(c.look.group); } catch (e) {} if (voice) voice.off(); };
  const spawn = (S, u, e, f, step0) => { if (!look) look = new Look(S.LAYER === undefined ? 9 : S.LAYER); const st = makeStair(f, S.meta), R = rng(hash(seed, e.id, 5) * 0x7fffffff | 0), side = R() < 0.5 ? -1 : 1, i0 = step0 === undefined ? 4 + Math.floor(R() * 6) : step0;
    const sl = new SliceSim(st), rat = new RatSim(st, sl, side, (hash(seed, e.id, 9) * 0x7fffffff) | 0, Math.min(i0, st.n - 9)); rat.gv = rat.mv;
    look.place(st); look.holes(st, rat); look.rat.visible = true; look.group.visible = true; look.update(st, rat, sl); (u.res && u.res.well ? u.res.well : g.world.scene).add(look.group); look.group.updateMatrixWorld(true);
    M.cur = { u, e, st, rat, sl, look, dirty: false }; M.spawns++; M.state = 'drag'; };
  const scan = () => { const S = g.subway; if (!S || !S.units || !S.entrances) return; if (hooked !== S) { hooked = S; try { S.on('drop', (u) => { if (M.cur && M.cur.u === u) despawn(); for (const i of u.st.ent || []) { const v = visit.get(i); if (v) v.in = false; } u._ratF = null; }); } catch (e) {} }
    const px = pl.x, py = pl.y, EN = S.entrances;
    if (M.cur) { const c = M.cur, f = c.st.f; if (Math.hypot(px - f.x, py - f.y) > R_OUT || c.u.state !== 'ready') despawn(); }
    for (const u of S.units.values()) { if (u.state !== 'ready' || !u.st.floors) continue;
      for (const i of u.st.ent) { const e = EN[i]; if (!e || !e.open || e.off) continue; const f = floorOf(u, e.id); if (!f) continue; const dd = Math.hypot(px - f.x, py - f.y); let v = visit.get(i);
        if (M.want === i) { M.want = null; despawn(); spawn(S, u, e, f, 5); if (!v) visit.set(i, (v = { n: 0, in: true })); v.in = true; continue; }
        if (dd < R_IN) { if (!v) visit.set(i, (v = { n: 0, in: false })); if (!v.in) { v.in = true; M.rolls++; if (M.roll(u.st.id, e.id, v.n) && !M.cur && M.want === null) { M.yes++; spawn(S, u, e, f); } } }
        else if (dd > R_OUT && v && v.in) { v.in = false; v.n++; } } } };
  kit.onStep((dt) => { scanT -= dt; if (scanT <= 0) { scanT = 0.3; scan(); } }, 'pizzarat');
  const sound = (ev, c) => { if (!kit.audio()) return; if (!voice) voice = kit.voice({ ref: 3, max: 40, level: 0.5 }); if (!voice) return;
    if (ev === 'pull') kit.burst(voice, { freq: 1500 + Math.random() * 700, q: 1.2, gain: 0.1, att: 0.02, dec: 0.13 });                                         // the crust scraping on the step
    else if (ev === 'flee') { for (let k = 0; k < 3; k++) kit.burst(voice, { freq: 5200 + k * 500, q: 14, gain: 0.5, att: 0.006, dec: 0.045, at: k * 0.075 }); kit.burst(voice, { freq: 900, q: 0.8, gain: 0.12, att: 0.004, dec: 0.1 }); } };
  kit.onFrame((dt) => { const c = M.cur; if (!c) return; const t0 = performance.now(), st = c.st, rat = c.rat, cam = kit.cam(); st.world(rat.hipD, rat.v, wp); const dist = Math.hypot(cam.x - wp.x, cam.y - wp.y, cam.h - rat.zHip);
    if (dist > R_DRAW) { c.look.group.visible = false; return; } c.look.group.visible = true; if (dist > R_SIM || !(dt > 0)) return;
    const S = g.subway; st.local(pl.x, pl.y, lp); const v = Math.hypot(pl.x - lastX, pl.y - lastY) / dt; lastX = pl.x; lastY = pl.y; spd += ((v < 30 ? v : 0) - spd) * Math.min(1, dt * 6);
    PP.d = lp.d; PP.v = lp.v; PP.z = S && S.own ? pl.alt || 0 : st.zTop; PP.speed = spd; const onFoot = !pl.vehicle;
    rat.step(dt, onFoot || Math.hypot(lp.d - rat.hipD, lp.v - rat.v) < 3 ? PP : null); if (rat.grip) rat.gv = rat.mv; c.sl.step(dt);
    if (rat.ev) { if (rat.ev === 'flee') { M.fled++; M.state = 'flee'; } else if (rat.ev === 'gone') M.state = 'gone'; else if (rat.ev === 'pull') M.pulls++; sound(rat.ev, c); }
    c.look.update(st, rat, c.sl); if (voice) voice.at(wp.x, wp.y, rat.zHip, dt);
    const ms = performance.now() - t0; M.frames++; M.ms += (ms - M.ms) * 0.02; if (ms > M.msMax) M.msMax = ms; }, 'pizzarat');
  M.info = () => { const c = M.cur; return { seed, rolls: M.rolls, yes: M.yes, spawns: M.spawns, fled: M.fled, pulls: M.pulls, state: M.state, ms: +M.ms.toFixed(3), msMax: +M.msMax.toFixed(2), frames: M.frames, at: c ? { station: c.u.st.id, ent: c.e.id, step: Math.floor(c.rat.hipD / c.st.tr), ph: c.rat.ph, mode: c.rat.mode, hipD: +c.rat.hipD.toFixed(3), v: +c.rat.v.toFixed(2), z: +c.rat.zHip.toFixed(2), slice: c.sl.asleep ? 'asleep' : 'awake' } : null }; };
  M.despawn = despawn; M.scan = scan;
  return M;
}

// ?surshow=pizzarat: stand the player at the top of the nearest open stair and put the rat on its fifth step
export function show(game, kit, M) { const S = game.subway; if (!S || !S.entrances || !M || !M.scan) return false; const pl = game.player; let best = -1, bd = 1e9;
  for (const e of S.entrances) { if (!e.open || e.off) continue; const st = S.stationOf && S.stationOf(e.st); if (st && st.built === false) continue; const d = Math.hypot(e.x - pl.x, e.y - pl.y); if (d < bd) { bd = d; best = e.id; } }
  if (best < 0) return false; const i = S.entrances.findIndex((e) => e.id === best); try { if (pl.vehicle) { pl.vehicle = null; if (pl.vis && pl.vis.object) pl.vis.object.visible = true; game.cam.mode = 'foot'; } S.goto(i, 0.9); game.focus.x = pl.x; game.focus.y = pl.y; if (game.snapCamera) game.snapCamera(); } catch (e) {}
  M.want = i; return true; }
