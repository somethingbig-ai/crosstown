// water/swim.js (water lane, Nov 15; Matt: "SWIMMING: the player can jump or fall in and swim, and it must feel realistic (surface swim, bob in
// the waves, splash in and out, climb out at ladders and piers; a car or bike that goes in sinks)").
//   install(game, W) is called at the end of water/install.js.   ?swim=0: nothing here is wrapped.
// What a player gets:
//   in     Space toward the water at the sea wall, or a sprint held against it, takes him over the coping and into the river (splash, a dip under).
//          Space at the helm of a boat: over the side. Walking against the wall stops him as before.
//   swim   W A S D by the camera, Shift = front crawl; breaststroke otherwise; keys released = treading water upright. He floats on W.surf (waves and
//          wakes lift him), boats push him aside, a fast one hurts.
//   out    F (or swimming into it) at a ladder: a 1.6 s climb to the street. F beside a boat: aboard (W.board). Ladders: one instanced mesh, every
//          60 m of sea wall inside the playable box and one beside every berth.
//   cars   the player's car or motorcycle that meets the sea wall at 45 km/h or more, within about 45 degrees of square, goes over: it flies, lands
//          with a big splash, floats a few seconds going down by the nose and sinks; the driver is put in the water beside it. Slower: the wall.
// The top of this file (down to "the game's side") is plain arithmetic and runs in node: lanes/water/tools/swimsim.mjs.
// The game's own code is wrapped, never edited: step, stepBusy, syncVisuals, camTarget, placeCamera, nearestCar, hud.draw.
// QA: game.swim (state, stats, ladders, errs); game.swim.vault() throws him in from where he stands; game.swim.put(x, y) sets him afloat there.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, k) => a + (b - a) * k, TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export const TUNE = {
  g: 12.7,            // m/s2 in the air (the jump's own feel: a little heavier than the real thing)
  cope: 0.47,         // m, the top of the sea wall's coping above the street (streets/water.js COPE_TOP 0.45)
  copeW: 1.2,         // m, the coping's width: the wall the game stops you at stands this far inland of the shore line
  line: 1.42,         // m from the feet to the water line of a man treading water (chin just clear)
  wade: 0.55,         // m of leg under the surface at which a fall becomes a splash
  K: 13, C: 4.2,      // the float: spring to the surface and its damping (a 1.7 s bob, settles in two)
  swim: 1.25, sprint: 2.35,   // m/s: breaststroke, front crawl
  turn: 3.2,          // 1/s: how fast the heading follows the stick
  acc: 2.2, drag: 2.4,        // 1/s: getting up to pace; slowing when the keys are let go
  off: 0.45,          // m kept between the swimmer and the wall
  rBreast: 0.62, rCrawl: 1.05, rTread: 0.8,     // strokes a second
  minOut: 3.0,        // m/s out from the wall that any way in is given at least
  vaultUp: 5.4, vaultOut: 3.6,                  // the run-up vault: up and out
  walkHold: 0.45,     // s of WALKING square against the wall before he climbs over and drops in (Matt, Nov 16)
  runHold: 0.18,      // s of sprinting square against the wall before he goes over
  climb: 3.6,         // s out by a ladder: to it, eleven rungs hand over hand, over the coping (Nov 16: was a 1.6 s slide)
  carMin: 12.5,       // m/s (45 km/h): slower than this the wall holds a car
  carSquare: 0.7,     // share of the speed that must point at the water (within about 45 degrees of square-on)
  carKick: 2.4,       // m/s up as the wheels ride over the coping
  floatT: 3.6, bikeFloatT: 1.3, draft: 0.5, deep: 6.5,   // a car afloat: seconds, metres of it under at first; metres under at which it is gone
  ejectT: 1.1,        // s after the splash at which the driver is out and swimming
};

// ---------------------------------------------------------------------------------------------- the shore line, exactly (the field is good to a metre)
// lines: polylines [[x, y], ...] with the LAND ON THE LEFT of their direction (city.water[].shore). near() gives the nearest piece within reach:
// d = metres from the line, + on the water side; (nx, ny) = unit normal toward the water; (px, py) = the nearest point on the line.
export class ShoreIndex {
  constructor(lines, cell = 32) {
    this.cell = cell; this.m = new Map(); this.n = 0; this.len = 0;
    for (const L of lines || []) for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-3) continue; const s = [a[0], a[1], b[0], b[1], (b[1] - a[1]) / l, -(b[0] - a[0]) / l, 1, 1, l]; this.n++; this.len += l;
      /* s[6], s[7]: how many coping widths inland the solid line stands at this piece's two ends (the wall's mitre at a corner: 1 on a straight run, to 2.94 at a sharp turn) */
      { const un = (p, q) => { const m = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [-(q[1] - p[1]) / m, (q[0] - p[0]) / m]; }, mk = (j) => { if (j <= 0 || j >= L.length - 1) return 1; const n1 = un(L[j - 1], L[j]), n2 = un(L[j], L[j + 1]); let bx = n1[0] + n2[0], by = n1[1] + n2[1]; const m = Math.hypot(bx, by) || 1; return 1 / Math.max(0.34, (bx * n1[0] + by * n1[1]) / m); }; s[6] = mk(i); s[7] = mk(i + 1); }
      for (let u = 0; u <= l; u += cell * 0.5) this._put(a[0] + (b[0] - a[0]) * u / l, a[1] + (b[1] - a[1]) * u / l, s); this._put(b[0], b[1], s); }
  }
  _put(x, y, s) { const k = Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell); let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); if (a.indexOf(s) < 0) a.push(s); }
  near(x, y, out, R = 24) {
    const c = this.cell, i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((y - R) / c), j1 = Math.floor((y + R) / c); let best = R, hit = null, bx = 0, by = 0;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.m.get(i * 100003 + j); if (!a) continue;
      for (const s of a) { const dx = s[2] - s[0], dy = s[3] - s[1], t = clamp(((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy), 0, 1), px = s[0] + dx * t, py = s[1] + dy * t, d = Math.hypot(x - px, y - py); if (d < best) { best = d; hit = s; bx = px; by = py; } } }
    if (!hit) return null; const side = (x - hit[0]) * hit[4] + (y - hit[1]) * hit[5];
    out.d = side >= 0 ? best : -best; out.nx = hit[4]; out.ny = hit[5]; out.px = bx; out.py = by;
    { const u = Math.hypot(bx - hit[0], by - hit[1]), R2 = 5; out.k = 1 + Math.max((hit[6] - 1) * clamp(1 - u / R2, 0, 1), (hit[7] - 1) * clamp(1 - (hit[8] - u) / R2, 0, 1)); }      /* k: the wall's solid line stands k coping widths inland here (more than 1 only within 5 m of a corner) */
    return out;
  }
}

// ---------------------------------------------------------------------------------------------- who goes in
// a car (x, y, vx, vy; len, wid) near the wall w (from ShoreIndex.near): does it go over this step?
export function carGoesIn(v, w, dt, T = TUNE) {
  if (!w || w.d >= 0) return false; const sp = Math.hypot(v.vx, v.vy), vn = v.vx * w.nx + v.vy * w.ny; if (sp < T.carMin || vn < sp * T.carSquare) return false;
  const left = -w.d - (T.copeW + (v.len || 4.5) * 0.3 + (v.wid || 1.8) * 0.5);      // metres before its front circle meets the wall
  return left < vn * dt * 2 + 0.7;
}
// a man on foot at the wall. s: { air (in a jump), vx, vy (his speed in the air), h (heading), run (sprinting, keys held), hold (seconds he has been pressing) }
export function footGoesIn(s, w, T = TUNE) {
  if (!w || w.d >= 0) return false; const face = Math.cos(s.h) * w.nx + Math.sin(s.h) * w.ny, k = w.k || 1, D = T.copeW * k, corner = k > 1.05;      /* D: how far inland the wall stops him HERE (at a corner of the shore the mitred wall stands up to three widths back: the fixed 1.2 m left an invisible wall at every pier corner) */
  if (s.air) return (w.d > -(D + 1.1) && (s.vx * w.nx + s.vy * w.ny > 0.6 || face > (corner ? -0.2 : 0.2))) || (w.d > -(D + 3.3) && face > 0.5 && s.vx * w.nx + s.vy * w.ny > -0.3);      /* the second half: a jump AT the river from up to 4.5 m back (within 60 degrees of square) is a jump into it: he is given the leap that reaches */      /* Nov 16, Matt 151728-4fcf89 "i can't jump in the water": any jump at the wall that is not turned away from the river goes in (was: within 53 degrees of square and 1.8 m) */
  return (!!s.run || !!s.walk) && w.d > -(D + 0.6) && face > (corner ? 0.3 : 0.7) && s.hold >= (s.run ? T.runHold : T.walkHold);      /* Nov 16: walking held against the wall goes over too (no invisible wall), after a longer press than a sprint */
}
// THE CLIMB OUT, rung by rung. k = 0..1 of T.climb; cz = his feet's height as he takes hold. out: a = he has come to the ladder (0..1); q = his height in RUNGS
// below the top one (rungs 0.3 m apart, the top one RUNG_TOP above the street; negative, rising to 0); c = over the coping to the pavement (0..1);
// fl, fr = the rung each foot is on or moving to (the left foot rests on even rungs, the right on odd ones: one moves while the other stands).
export const RUNG = 0.3, RUNG_TOP = 0.35;
const footRung = (q, o) => { const u = (q - o) / 2, n = Math.floor(u); return o + 2 * (n + sm((u - n) * 2 - 1)); };
export function climbAt(k, cz, out = {}) {
  const q0 = (cz - RUNG_TOP) / RUNG + 0.5, e = clamp((k - 0.07) / 0.67, 0, 1), q = q0 * Math.pow(1 - e, 1.15);      /* a little quicker while the water still carries him */
  out.a = sm(k / 0.1); out.q = q; out.c = clamp((k - 0.74) / 0.26, 0, 1); out.fl = footRung(q, 0); out.fr = footRung(q, -1); out.zf = RUNG_TOP + RUNG * (q - 0.5); return out;      /* zf: his feet's own height = midway between the two rungs he stands on */
}
// is there river to land in off the wall at w? (afloat: W.afloat; the same question tools/in-scan.mjs asks of the whole shore)
export const landsAt = (afloat, w, far) => afloat(w.px + w.nx * far, w.py + w.ny * far) && afloat(w.px + w.nx * 1.2, w.py + w.ny * 1.2);
// open water for a swimmer: W.afloat, OR beside Manhattan's own wall the exact shore line. (afloat asks the field, which is good to a metre or two: along some
// 400 m of the Hudson wall it puts the shore 2.4 m out in the river, so a man who dropped in there was in "not water", could not move, and Space refused him.)
export function openAt(afloat, sd, shore, x, y, o = {}) { return afloat(x, y) || (sd(x, y) > -3.5 && !!shore.near(x, y, o, 6) && o.d > 0.2); }
// WHERE he lands: the man at (x, y) heading h by the wall w. First the way he faces (river 1.3 and 2.4 m past the shore line along his own heading), then square
// off the wall, then a fan either side of square (an inside corner, a pier's shoulder: the old single probe square off the nearest piece found land there and
// refused him). Returns out = { x, y } (a point 2.2 to 2.4 m out in open water) or null when there is no river within reach.
const FAN = [0, 0.6, -0.6, 1.1, -1.1], FAN2 = [0.45, 0, 0.9, -0.6, -1.1];
export function aimAt(afloat, x, y, h, w, out = {}) {
  if (!w) return null; const c = Math.cos(h), s = Math.sin(h), face = c * w.nx + s * w.ny;
  if (face > 0.6 && w.d < 0) { const r = -w.d / face; if (r < 9 && afloat(x + c * (r + 1.3), y + s * (r + 1.3)) && afloat(x + c * (r + 2.4), y + s * (r + 2.4))) { out.x = x + c * (r + 2.4); out.y = y + s * (r + 2.4); return out; } }
  const side = w.nx * s - w.ny * c >= 0 ? 1 : -1;      /* which side of square he faces: the fan leans that way first when he is well off square */
  for (const a0 of face > 0.6 ? FAN : FAN2) { const a = a0 * side, ca = Math.cos(a), sa = Math.sin(a), nx = w.nx * ca - w.ny * sa, ny = w.nx * sa + w.ny * ca; if (afloat(w.px + nx * 1.2, w.py + ny * 1.2) && afloat(w.px + nx * 2.2, w.py + ny * 2.2)) { out.x = w.px + nx * 2.2; out.y = w.py + ny * 2.2; return out; } }
  return null;
}
// the speed over the ground that carries him from (x, y, feet at zf, rising at vz) to the point a (aimAt) as he meets the water at height surf: out = { vx, vy }
export function throwTo(x, y, zf, vz, a, surf, out = {}, T = TUNE) {
  const drop = Math.max(0, zf - (surf - T.wade)), t = Math.max(0.35, (vz + Math.sqrt(Math.max(0, vz * vz + 2 * T.g * drop))) / T.g); out.vx = (a.x - x) / t; out.vy = (a.y - y) / t; out.t = t; return out;
}
// ---------------------------------------------------------------------------------------------- the strokes (pure: phase in, where the hands and ankles go out)
// Arms: out = [ahead, to the side (outward), up] from the shoulder, in arm lengths. Legs: out = [reach along the leg line (leg lengths), toward the belly, outward (m)].
// A cyclic curve through keys [u, a, b, c, ...] (u from 0 to 1, the last key repeating the first): a limb does not stop at each key, so this is a
// Hermite curve whose slope at a key is that of its neighbours, and level where a key is a turning point or the start or end of a hold.
const key = (K, u, out) => { u -= Math.floor(u); const n = K.length - 1; let i = 1; while (i < n && K[i][0] < u) i++; const a = K[i - 1], b = K[i], p = i >= 2 ? K[i - 2] : K[n - 1], q = i < n ? K[i + 1] : K[1];
  const ta = a[0], tb = b[0], tp = i >= 2 ? p[0] : p[0] - 1, tq = i < n ? q[0] : q[0] + 1, h = tb - ta || 1, s = (u - ta) / h, s2 = s * s, s3 = s2 * s;
  for (let j = 1; j < a.length; j++) { const d = b[j] - a[j], m0 = d * (a[j] - p[j]) > 0 ? (b[j] - p[j]) / (tb - tp) : 0, m1 = d * (q[j] - b[j]) > 0 ? (q[j] - a[j]) / (tq - ta) : 0; out[j - 1] = (2 * s3 - 3 * s2 + 1) * a[j] + (s3 - 2 * s2 + s) * h * m0 + (3 * s2 - 2 * s3) * b[j] + (s3 - s2) * h * m1; }
  return out; };
// Arm keys: [phase, ahead, to the side, up, elbow] (the first three in arm lengths from the shoulder; elbow = how far the elbow is carried up, -1 .. 1).
// Front crawl, one arm, from its hand going in: reach, catch with the elbow high, pull under the chest, push past the hip, out by the thigh, the elbow
// lifted and carried forward over the water with the hand hanging under it, the hand in again ahead of the shoulder.
const CRAWL_ARM = [[0, 0.88, 0.1, 0.22, 0.8], [0.08, 0.98, 0.08, -0.04, 0.4], [0.24, 0.98, 0.08, -0.02, 0.3], [0.34, 0.8, 0.1, -0.4, 0.5], [0.46, 0.25, 0.05, -0.8, 0.25], [0.56, -0.45, 0.12, -0.6, 0.1], [0.64, -0.82, 0.22, 0.1, 0.5], [0.72, -0.45, 0.4, 0.26, 0.8], [0.8, -0.05, 0.48, 0.24, 0.8], [0.88, 0.35, 0.38, 0.28, 0.8], [0.95, 0.68, 0.2, 0.38, 0.9], [1, 0.88, 0.1, 0.22, 0.8]];      // (the arm waits stretched out just under the surface until the other has come over; the elbow travels forward as it rises, the hand swings through under it and spears in fingers first ahead of the head)
// Breaststroke: glide with the hands together ahead, sweep out, sweep in with the elbows high (the chest and head come up here), hands together under the chin, shoot forward
const BREAST_ARM = [[0, 0.97, 0.05, 0.12, 0], [0.28, 0.97, 0.05, 0.12, 0], [0.36, 0.93, 0.12, -0.04, -0.4], [0.46, 0.62, 0.74, -0.38, -0.5], [0.58, 0.28, 0.6, -0.55, -0.5], [0.68, 0.2, 0.14, -0.4, -0.6], [0.8, 0.6, 0.05, 0, -0.3], [0.92, 0.95, 0.05, 0.12, 0], [1, 0.97, 0.05, 0.12, 0]];      // (the hands spear forward together just under the surface; they press down before they sweep out, so the arms never lie wide on the water)
// Legs: [phase, reach along the leg line (leg lengths), toward the belly (m), outward (m)]: straight, heels drawn up to the seat, feet turned out wide, whipped round and together
const BREAST_LEG = [[0, 0.98, 0, 0.06], [0.5, 0.98, 0, 0.06], [0.72, 0.52, 0.1, 0.22], [0.8, 0.62, 0.06, 0.48], [0.88, 0.9, 0.02, 0.4], [0.95, 0.98, 0, 0.1], [1, 0.98, 0, 0.06]];
export function armCrawl(ph, side, out) { return key(CRAWL_ARM, ph + (side < 0 ? 0.5 : 0), out); }      // side +1 right, -1 left: half a stroke apart
export function armBreast(ph, out) { return key(BREAST_ARM, ph, out); }
// treading water: both hands scull out and in together just under the surface, out to the sides and a little ahead (a flat figure of eight)
export function armTread(t, side, out) { const w = TAU * TUNE.rTread * t + (side < 0 ? 0.35 : 0); out[0] = 0.22 + 0.08 * Math.sin(2 * w + 0.6); out[1] = 0.72 + 0.14 * Math.sin(w); out[2] = -0.03 + 0.03 * Math.sin(2 * w); out[3] = -0.2; return out; }      // (wide, a hand's depth under: they stir the surface)
// the flutter kick: six beats to the stroke, from the hip, the knee giving a little on the way down; [1] > 0 = down (toward the belly)
export function legCrawl(ph, side, out) { const s = Math.sin(TAU * 3 * ph + (side < 0 ? Math.PI : 0)); out[0] = 0.975 - 0.035 * Math.max(0, s); out[1] = 0.13 * s; out[2] = 0.05; return out; }
export function legBreast(ph, out) { return key(BREAST_LEG, ph, out); }
// treading: the egg-beater: knees up and apart, the lower legs circling one after the other
export function legTread(t, side, out) { const w = TAU * TUNE.rTread * t + (side < 0 ? Math.PI : 0); out[0] = 0.74 + 0.1 * Math.sin(w); out[1] = 0.22 + 0.12 * Math.cos(w); out[2] = 0.18 + 0.1 * Math.sin(w); return out; }
// front crawl: the body's roll about its long axis (radians; + = the right shoulder up, at the middle of the right arm's carry over the water)
export const crawlRoll = (ph) => 0.7 * Math.sin(TAU * (ph - 0.57));
// front crawl: the breath. s = strokes swum + phase. Every third arm stroke, to the side of the arm then coming over: 0, or up to +1 (right) / -1 (left)
export function crawlBreath(s) { const q = s * 2 - 0.24, n = Math.floor(q), u = q - n; if (((n % 3) + 3) % 3 !== 0) return 0; const side = ((n % 2) + 2) % 2 === 1 ? 1 : -1; return side * sm(u / 0.2) * (1 - sm((u - 0.55) / 0.25)); }
// breaststroke: how far the chest and head are up for the breath (0 on the glide, 1 at the end of the in-sweep)
export const breastLift = (ph) => { ph -= Math.floor(ph); return sm((ph - 0.4) / 0.24) * (1 - sm((ph - 0.7) / 0.2)); };
// how hard the breaststroke drives through its cycle (mean 1): the pull, then the kick; the glide between loses way
const hump = (u, a, b) => (u > a && u < b ? Math.sin(Math.PI * (u - a) / (b - a)) ** 2 : 0);
export const breastDrive = (ph) => { ph -= Math.floor(ph); return (0.75 + 0.35 * hump(ph, 0.36, 0.72) + 0.5 * hump(ph, 0.82, 1.0)) / 0.858; };

// ---------------------------------------------------------------------------------------------- the swimmer
// env: surf(x, y) -> the surface's height; wall(x, y, out) -> ShoreIndex.near or null; open(x, y) -> may he be here (afloat).
// States: 'off', 'air' (over the wall and falling), 'swim', 'climb' (a ladder), 'land' (out: the game has him again).
// In the air and on the ladder zf is the height of his feet; in the water z is his water line (TUNE.line above the feet, upright) and rides on the spring.
export class Swimmer {
  constructor(env, T = TUNE) { this.env = env; this.T = T; this.state = 'off'; this.x = this.y = this.h = 0; this.z = this.zf = this.vz = 0; this.vx = this.vy = 0; this.sp = 0; this.kx = this.ky = 0; this.lie = 0; this.crawl = 0; this.phase = 0; this.t = 0; this.wetT = 0; this.ev = {}; this.L = null; this.ct = 0; this.strokes = 0; this.moving = false; this._w = {}; }
  // over the wall: from (x, y), feet at zf, at this speed. n = the wall there (ShoreIndex.near), or null out on the water (off a boat)
  enter(x, y, zf, vx, vy, vz, h, n) {
    const T = this.T; if (n) { const vn = vx * n.nx + vy * n.ny; if (vn < T.minOut) { vx += n.nx * (T.minOut - vn); vy += n.ny * (T.minOut - vn); } }
    Object.assign(this, { state: 'air', x, y, zf, vx, vy, vz, h, ps: undefined, sp: 0, kx: 0, ky: 0, lie: 0, crawl: 0, t: 0, wetT: 0, L: null }); this.ev = {};
  }
  // straight into the water at (x, y): beside a car that went in. under = metres below floating he starts
  afloat(x, y, h, under = 0.5) { Object.assign(this, { state: 'swim', x, y, h, z: this.env.surf(x, y) - under, vz: 0.4, ps: undefined, sp: 0, kx: 0, ky: 0, lie: 0, crawl: 0, t: 0, wetT: 0, L: null }); this.ev = {}; }
  rootZ() { return this.state === 'swim' ? this.z - this.T.line : this.zf; }
  under() { return this.state === 'swim' && this.z + 0.16 < this.env.surf(this.x, this.y); }      // mouth and nose below the surface
  startClimb(L) { if (this.state !== 'swim') return false; this.state = 'climb'; this.L = L; this.ct = 0; this.zf = this.z - this.T.line; this.cx = this.x; this.cy = this.y; this.cz = this.zf; this.ch = this.h; this.sp = 0; return true; }
  step(dt, inp) {
    const T = this.T, E = this.env; this.ev = {}; this.t += dt;
    if (this.state === 'air') {
      this.vz -= T.g * dt; this.zf += this.vz * dt; this.x += this.vx * dt; this.y += this.vy * dt;
      const w = E.wall(this.x, this.y, this._w), over = w && w.d < 0.25;
      if (over && w.d > -T.copeW && this.zf < T.cope) { this.zf = T.cope; if (this.vz < 0) this.vz = 0; }      // across the coping, never through it
      const s = E.surf(this.x, this.y);
      if (!over && this.zf + T.wade < s) { const hs = Math.hypot(this.vx, this.vy); this.ev.splash = Math.hypot(this.vz, hs * 0.5); this.state = 'swim'; this.z = this.zf + T.line; this.vz *= 0.62; this.sp = Math.min(hs * 0.45, T.sprint); this.ps = s; if (hs > 0.5) this.h = Math.atan2(this.vy, this.vx); this.wetT = 0; }
      return;
    }
    if (this.state === 'climb') {
      const L = this.L; this.ct += dt; const k = this.ct / T.climb, C = climbAt(k, this.cz, this._c || (this._c = {})), a = C.a, c = C.c, s = Math.pow(c, 0.9), lz = L.lz || 0;
      const fx = L.x + L.nx * 0.4, fy = L.y + L.ny * 0.4; this.x = lerp(lerp(this.cx, fx, a), L.lx, s); this.y = lerp(lerp(this.cy, fy, a), L.ly, s);
      const top = RUNG_TOP - RUNG * 0.5;      /* his feet as he stands on the top rungs; then up on the coping, across it, and down to the pavement */
      this.zf = c <= 0 ? Math.max(this.cz, C.zf) : s < 0.68 ? lerp(top, T.cope, sm(s / 0.16)) : lerp(T.cope, lz, sm((s - 0.68) / 0.24)); this.h = this.ch + wrapPi(Math.atan2(-L.ny, -L.nx) - this.ch) * a;
      if (k >= 1) { this.state = 'land'; this.x = L.lx; this.y = L.ly; this.zf = L.lz || 0; this.ev.out = true; }
      return;
    }
    if (this.state !== 'swim') return;
    this.wetT += dt;
    // the float: his water line follows the surface on a spring, so the swell lifts him a moment late and a wake rocks him
    const s = E.surf(this.x, this.y), vs = this.ps === undefined || !(dt > 0) ? 0 : clamp((s - this.ps) / dt, -3, 3); this.ps = s; this.vz += (T.K * (s - this.z) + T.C * (vs - this.vz)) * dt; this.z += this.vz * dt;      // (the damping is against the water's own rise and fall: he goes up with a swell, not through it)
    // the stick
    const mx = inp ? inp.mx || 0 : 0, my = inp ? inp.my || 0 : 0, m = Math.hypot(mx, my), go = m > 0.1, run = go && !!(inp && inp.run); this.moving = go;
    if (go) { const a = inp.yaw + Math.atan2(mx, my), dh = wrapPi(a - this.h); this.h = wrapPi(this.h + dh * Math.min(1, dt * T.turn)); const want = (run ? T.sprint : T.swim) * Math.min(1, m) * Math.max(0, Math.cos(dh)); this.sp += (want - this.sp) * Math.min(1, dt * T.acc); }
    else this.sp *= Math.exp(-T.drag * dt);
    this.lie += ((go ? 1 : 0) - this.lie) * Math.min(1, dt * (go ? 3.2 : 2.4)); this.crawl += ((run ? 1 : 0) - this.crawl) * Math.min(1, dt * 3.5);
    // the stroke: its rate follows his pace (slower strokes as he gets under way or turns); keys let go, the stroke in hand is finished into its glide and held there
    const p0 = this.phase, rate = lerp(T.rBreast, T.rCrawl, this.crawl), pace = lerp(T.swim, T.sprint, this.crawl);
    if (go) { if (this.lie < 0.3 && this.crawl < 0.5 && this.phase < 0.24) this.phase = 0.24; this.phase += dt * rate * clamp(0.5 + 0.55 * this.sp / pace, 0.5, 1.1); } else if (this.phase > 0) this.phase = Math.min(1, this.phase + dt * rate * 0.9);
    if (this.phase >= 1) { if (go) { this.phase -= 1; this.strokes++; this.ev.stroke = 1; } else this.phase = 0; } if (go && (p0 < 0.5) !== (this.phase < 0.5)) this.ev.hand = this.phase < 0.5 ? 1 : -1;      // a hand goes in: right at 0, left at a half
    const v = this.sp * lerp(breastDrive(this.phase), 1 + 0.07 * Math.cos(TAU * 2 * (this.phase - 0.36)), this.crawl); this.v = v;      // the crawl surges a little with each arm's pull
    const kd = Math.exp(-3 * dt); this.kx *= kd; this.ky *= kd;
    this.move(this.x + (Math.cos(this.h) * v + this.kx) * dt, this.y + (Math.sin(this.h) * v + this.ky) * dt);
  }
  // to (nx, ny), kept off the wall and in the water
  move(nx, ny) {
    const T = this.T, E = this.env, w = E.wall(nx, ny, this._w); this.touch = false;
    if (w && w.d < T.off) { nx += w.nx * (T.off - w.d); ny += w.ny * (T.off - w.d); this.touch = true; }
    if (!E.open(nx, ny)) { if (E.open(nx, this.y)) ny = this.y; else if (E.open(this.x, ny)) nx = this.x; else { nx = this.x; ny = this.y; } this.sp *= 0.6; this.touch = true; }
    this.x = nx; this.y = ny;
  }
}

// ---------------------------------------------------------------------------------------------- a car (or a motorcycle) that goes in
// States: 'fly' (over the coping and through the air), 'float' (down by the nose, bubbling), 'sink', 'gone'. z = the height of its wheels' ground.
export class Sinker {
  constructor(env, T = TUNE) { this.env = env; this.T = T; this.state = 'off'; this._w = {}; this.ev = {}; }
  start(x, y, h, vx, vy, len = 4.5, bike = false) { Object.assign(this, { state: 'fly', x, y, h, vx, vy, z: 0, vz: this.T.carKick, pitch: 0, roll: 0, t: 0, len, bike, vs: 0, wob: Math.random() * 6 }); this.ev = {}; }
  step(dt) {
    const T = this.T, E = this.env; this.ev = {}; this.t += dt; if (this.state === 'off' || this.state === 'gone') return;
    this.x += this.vx * dt; this.y += this.vy * dt; const s = E.surf(this.x, this.y);
    if (this.state === 'fly') {
      const w = E.wall(this.x, this.y, this._w), on = w && w.d < this.len * 0.2;      // the wheels still have wall under them
      this.vz -= 9.81 * dt; this.z += this.vz * dt; if (on && this.z < 0.12) { this.z = 0.12; if (this.vz < 0) this.vz = 0; }
      this.pitch += (on ? 0.25 : -0.85) * dt * (this.bike ? 1.6 : 1);
      if (!on && this.z + 0.3 < s) { this.ev.splash = Math.hypot(this.vx, this.vy, this.vz); this.state = 'float'; this.t = 0; this.vx *= 0.38; this.vy *= 0.38; this.vz *= 0.25; }
      return;
    }
    const kd = Math.exp(-2.2 * dt); this.vx *= kd; this.vy *= kd;
    if (this.state === 'float') {
      const F = this.bike ? T.bikeFloatT : T.floatT, k = this.t / F, want = s - T.draft - 0.9 * k * k; this.vz += (16 * (want - this.z) - 4.5 * this.vz) * dt; this.z += this.vz * dt;
      this.pitch += (-0.42 * (0.35 + 0.65 * k) - this.pitch) * Math.min(1, dt * 2.2); this.roll = 0.05 * Math.sin(this.t * 1.9 + this.wob) * (1 - 0.5 * k); this.ev.bubbles = 0.4 + 0.6 * k;
      if (this.t >= F) { this.state = 'sink'; this.t = 0; this.vs = Math.max(0.15, -this.vz); }
      return;
    }
    this.vs = Math.min(1.7, this.vs + 1.0 * dt); this.z -= this.vs * dt; this.pitch += (-0.95 - this.pitch) * Math.min(1, dt * 0.9); this.roll *= Math.exp(-dt); this.ev.bubbles = Math.max(0, 1 - this.t / 4);
    if (this.z < s - T.deep) this.state = 'gone';
  }
}

// where ladders go along shore lines: every `gap` metres, each { x, y (on the line), nx, ny (toward the water) }. ok(p) filters.
export function ladderSpots(lines, gap = 60, ok = null) {
  const out = []; for (const L of lines || []) { let run = gap * 0.5;
    for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-3) continue; const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
      while (run <= l) { const p = { x: a[0] + tx * run, y: a[1] + ty * run, nx: ty, ny: -tx }; if (!ok || ok(p)) { out.push(p); run += gap; } else run += 6; }
      run -= l; } }
  return out;
}

// ================================================================================================ the game's side
export async function install(game, W) {
  const g = game, P = g && g.P; if (!g || !W || !W.surf) return null; if (g.swim) return g.swim; if (P && P.get('swim') === '0') return null;
  const THREE = await import('three'); let EntryRig = null; try { EntryRig = (await import('../entry/rig.js')).EntryRig; } catch (e) {}
  const pl = g.player, st = g.statics, world = g.world, city = g.city, T = TUNE, AMBER = '#ffb52e';
  const S = (g.swim = W.swim = { on: true, core: null, ladders: [], sinkers: [], errs: {}, stats: { ins: 0, vaults: 0, jumps: 0, offBoat: 0, climbs: 0, boards: 0, cars: 0, bikes: 0, sunk: 0, hits: 0, strokes: 0 }, hold: 0, space: 0, dive: false, reach: null, reachT: 0, seenT: 0, hint: null, helpT: 0, rig: null, ph: 0, tune: T });
  const err = (k, e) => { if (S.errs[k]) return; S.errs[k] = String((e && (e.stack || e.message)) || e).slice(0, 500); console.log('[swim] ' + k + ': ' + S.errs[k]); };
  const lines = (city.water || []).filter((w) => w.shore && w.shore.length > 1).map((w) => w.shore), shore = (S.shore = new ShoreIndex(lines));
  const _op = {}, open = (x, y) => openAt(W.afloat, W.shoreDist, shore, x, y, _op), env = { surf: W.surf, wall: (x, y, o) => shore.near(x, y, o), open };
  const core = (S.core = new Swimmer(env)), _w = {}, _w2 = {}, _o = {}, _aim = {}, _thr = {};
  const kerb = (x, y) => (st && st.onSidewalk(x, y) ? 0.15 : 0);
  const heliBusy = () => { const h = g.heli; return !!(h && (h.piloted || h.busy)); };
  const dead = () => !!(g.combat && g.combat.dead);

  // ---------------------------------------------------------------- ladders
  const play = city.meta.play || [-city.meta.px, -city.meta.py, city.meta.px, city.meta.py], inPlay = (x, y, m) => x > play[0] + m && x < play[2] - m && y > play[1] + m && y < play[3] - m;
  function ladderAt(p) {      // p on the shore line with its normal: a ladder there if a man can stand behind it and float in front of it
    if (!inPlay(p.x, p.y, 5) || !W.afloat(p.x + p.nx * 1.5, p.y + p.ny * 1.5) || !W.afloat(p.x + p.nx * 4, p.y + p.ny * 4)) return null;
    for (const back of [2.0, 2.5]) { const lx = p.x - p.nx * back, ly = p.y - p.ny * back; if (W.afloat(lx, ly)) continue; if (st) { st.resolve(lx, ly, 0.34, _o); if (Math.hypot(_o.x - lx, _o.y - ly) > 0.35) continue; if (shore.near(_o.x, _o.y, _w2) && _w2.d > -1.3) continue; }
      let out = null; if (g.footout && g.footout.ladderOut && !(P && P.get('ladderin') === '1')) try { out = g.footout.ladderOut(lx, ly); if (out === false) continue; } catch (e) { out = null; }      /* gameplay lane, Nov 19 (report bd6d92: 'i climbed up a ladder into a building now i cant get out'): a ladder whose top is inside a building's outline (walls are lines: he stood INSIDE the pier shed at 1222, -497) takes him on from the top over the wall to the nearest open ground, L.out (move/footout.js does the move); with no open ground within 25 m there is no ladder; ?ladderin=1 = as before */
      return { x: p.x, y: p.y, nx: p.nx, ny: p.ny, lx, ly, lz: kerb(lx, ly), out }; }
    return null;
  }
  try {
    for (const q of W.berths || []) { if (!shore.near(q.lx, q.ly, _w, 12)) continue; const tx = -_w.ny, ty = _w.nx, px = _w.px, py = _w.py; let L = null;
      for (const k of [6.5, -6.5, 9, -9, 0]) { const w = shore.near(px + tx * k, py + ty * k, _w2, 4); if (!w) continue; L = ladderAt({ x: w.px, y: w.py, nx: w.nx, ny: w.ny }); if (L) break; }
      if (L) { L.berth = q.name; S.ladders.push(L); } }
    const nb = S.ladders.length;
    for (const p of ladderSpots(lines, +(P && P.get('laddergap')) || 60, (p) => !!ladderAt(p))) { if (S.ladders.some((o, i) => i < nb && Math.hypot(o.x - p.x, o.y - p.y) < 25)) continue; S.ladders.push(ladderAt(p)); }
    if (S.ladders.length) {
      // one ladder: x along the wall, y up from the street, z out over the water. Rails from under the water to hand height above the coping, hooped back to the land.
      const pos = [], nor = [], col = [], idx = [], lo = W.level - 1.3, top = 1.38, YEL = [0.8, 0.58, 0.07], STL = [0.56, 0.58, 0.6];
      const box = (cx, cy, cz, sx, sy, sz, c) => { const b = new THREE.BoxGeometry(sx, sy, sz), p = b.attributes.position, n = b.attributes.normal, base = pos.length / 3; for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + cx, p.getY(i) + cy, p.getZ(i) + cz); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c[0], c[1], c[2]); } for (let i = 0; i < b.index.count; i++) idx.push(b.index.getX(i) + base); b.dispose(); };
      for (const sx of [-0.22, 0.22]) { box(sx, (lo + top) / 2, 0.11, 0.05, top - lo, 0.05, YEL); box(sx, top, -0.24, 0.05, 0.05, 0.75, YEL); box(sx, (top + 0.45) / 2, -0.6, 0.05, top - 0.45, 0.05, YEL); for (const y of [0.2, -1.1, -2.2]) box(sx, y, 0.045, 0.04, 0.04, 0.09, STL); }
      for (let y = lo + 0.25; y <= 0.36; y += 0.3) box(0, y, 0.11, 0.44, 0.035, 0.04, STL);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }), S.ladders.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      S.ladders.forEach((L, i) => { q.setFromAxisAngle(UPV, Math.atan2(L.nx, -L.ny)); M.compose(v.set(L.x, 0, -L.y), q, one); mesh.setMatrixAt(i, M); });
      mesh.instanceMatrix.needsUpdate = true; mesh.name = 'swim_ladders'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; world.scene.add(mesh); S.ladderMesh = mesh; S.ladderTris = (idx.length / 3) * S.ladders.length;
    }
  } catch (e) { err('ladders', e); }

  // ---------------------------------------------------------------- sounds and spray
  const snd = (fn) => { try { const s = g.sound; if (s && s.on) fn(s); } catch (e) {} };
  const splashSound = (k) => snd((s) => { s.burst(0.35 + 0.5 * k, 0.16 + 0.34 * k, 1300 + 1500 * k); s.shot(120 - 50 * k, 0.22 + 0.2 * k, 'sine', 0.12 + 0.2 * k, -40); });
  const strokeSound = (k) => snd((s) => s.burst(0.14, 0.025 + 0.035 * k, 2600));
  const spray = W.spray, emit = (x, up, y, vx, vup, vy, life, size) => { if (spray) spray.emit(x, up, -y, vx, vup, -vy, life, size); };      // (map x, height, map y)
  function splash(x, y, k, dirx = 0, diry = 0) {      // k 0..1 a man, to 3 a car: a crown thrown up and out, and a column in the middle
    const s = W.surf(x, y), n = Math.round(26 + 60 * k), R = 0.25 + 0.5 * k;
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R, out = (1.2 + 2.6 * Math.random()) * (0.6 + 0.5 * k), up = (2.2 + 3.4 * Math.random()) * (0.55 + 0.45 * k); emit(x + Math.cos(a) * r, s + 0.05, y + Math.sin(a) * r, Math.cos(a) * out + dirx * 0.35, up, Math.sin(a) * out + diry * 0.35, 0.55 + 0.6 * Math.random(), (0.09 + 0.13 * Math.random()) * (0.8 + 0.3 * k)); }
    for (let i = 0; i < 8 + 10 * k; i++) emit(x + (Math.random() - 0.5) * R, s + 0.1, y + (Math.random() - 0.5) * R, dirx * 0.2, (4 + 3 * Math.random()) * (0.6 + 0.5 * k), diry * 0.2, 0.7 + 0.4 * Math.random(), 0.14 + 0.09 * k);
    splashSound(clamp(k, 0.15, 1)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.12 * k);
  }
  const froth = (x, y, r, n, size) => { const s = W.surf(x, y); for (let i = 0; i < n; i++) { const a = Math.random() * TAU, q = Math.sqrt(Math.random()) * r; emit(x + Math.cos(a) * q, s + 0.02, y + Math.sin(a) * q, (Math.random() - 0.5) * 0.5, 0.5 + 0.9 * Math.random(), (Math.random() - 0.5) * 0.5, 0.35 + 0.35 * Math.random(), size * (0.6 + 0.8 * Math.random())); } };

  // ---------------------------------------------------------------- in and out of the water
  const busyOf = () => ({ swim: true, kind: 'swim', t: 0, z: core.rootZ() });
  // style: 'dive' (a run-up: hands first), 'jump' (from a stand: feet first, stepping off), 'step' (walked over the edge: up on the coping, then a drop), '' (thrown: a rider, a driver)
  function goIn(x, y, zf, vx, vy, vz, h, n, why, style = '') { core.enter(x, y, zf, vx, vy, vz, h, style ? null : n); pl.busy = busyOf(); pl.x = x; pl.y = y; g.cam.mode = 'foot'; S.stats.ins++; S.stats[why] = (S.stats[why] || 0) + 1; S.seenT = 0; S.hold = 0;
    S.entry = { style, t: 0, wt: -1, xt: 0, z0: zf, sx: (Math.random() < 0.5 ? -1 : 1) }; S.stats[style || 'thrown'] = (S.stats[style || 'thrown'] || 0) + 1; try { g.playerAnim('idle'); if (pl.vis.mixer) pl.vis.mixer.timeScale = 1; } catch (e) {} }
  function release() { if (pl.busy && pl.busy.swim) pl.busy = null; core.state = 'off'; S.reach = null; S.hint = null; try { if (S.rig) S.rig.restHips(); g.playerAnim('idle'); } catch (e) {} }
  const lands = (w, far) => landsAt(W.afloat, w, far);
  S.vault = (style = 'dive') => { const w = shore.near(pl.x, pl.y, _w, 40); if (!w || pl.busy || pl.vehicle) return false; if (w.d < 0) { pl.x = w.px - w.nx * 1.6; pl.y = w.py - w.ny * 1.6; } pl.h = Math.atan2(w.ny, w.nx); goIn(pl.x, pl.y, kerb(pl.x, pl.y), w.nx * T.vaultOut, w.ny * T.vaultOut, T.vaultUp, pl.h, w, 'vaults', style); return true; };
  S.put = (x, y) => { if (!W.afloat(x, y)) return false; if (pl.vehicle) return false; core.afloat(x, y, pl.h, 0.2); pl.busy = busyOf(); pl.x = x; pl.y = y; g.cam.mode = 'foot'; return true; };
  addEventListener('keydown', (e) => { if (e.code !== 'Space' || e.repeat || !S.on) return; const B = pl.busy; if (B && B.boat && B.kind === 'helm') S.dive = true; else if (!B && !pl.vehicle) S.space = 0.2; });

  // on foot, each step (nothing but two compares unless he is sprinting or in the air)
  function footWatch(dt) {
    const J = g.jump, jc = J && J.on && J.core, air = !!(jc && jc.own && !jc.grounded), I = g.input, mov = Math.hypot(I.mx, I.my) > 0.1, run = !!I.run && mov; if (S.space > 0) S.space -= dt;
    if (!air && !mov && !(S.space > 0 && !(J && J.on))) { S.hold = 0; return; }
    if (heliBusy() || (g.fly && g.fly.on) || g.demo || dead()) return;
    const x = air ? jc.x : pl.x, y = air ? jc.y : pl.y, w = shore.near(x, y, _w, 8); if (!w) { S.hold = 0; return; }
    const spaced = S.space > 0 && !(J && J.on), face = Math.cos(pl.h) * w.nx + Math.sin(pl.h) * w.ny, D = T.copeW * (w.k || 1), corner = (w.k || 1) > 1.05;
    // a: where he comes down (aimAt: his own heading first, then square off the wall, then a fan: an inside corner or a pier's shoulder still has river somewhere)
    const leap = (z, up, style, why) => { const a = aimAt(open, x, y, pl.h, w, _aim); if (!a) return false; throwTo(x, y, z, up, a, W.surf(a.x, a.y), _thr); goIn(x, y, z, _thr.vx, _thr.vy, up, Math.atan2(a.y - y, a.x - x), w, why, style); S.entry.tf = _thr.t; return true; };
    if (air) { if (!footGoesIn({ air: true, vx: jc.vx, vy: jc.vy, h: pl.h }, w)) return; const z = jc.z, vz = jc.vz, far = w.d < -(D + 1.1), going = Math.hypot(jc.vx, jc.vy) > 1.2 || (mov && run) || far; if (!aimAt(open, x, y, pl.h, w, _aim)) return; jc.release(); J.phase = ''; leap(z, Math.max(vz, far ? 4.6 : going ? 3.6 : 3.9), going ? 'dive' : 'jump', 'jumps'); return; }
    if (spaced && footGoesIn({ air: true, vx: 0, vy: 0, h: pl.h }, w)) { if (leap(kerb(x, y), mov || w.d < -(D + 1.1) ? T.vaultUp * 0.85 : 4.4, mov || w.d < -(D + 1.1) ? 'dive' : 'jump', 'vaults')) { S.space = 0; return; } }
    S.hold = mov && face > (corner ? 0.3 : run ? 0.75 : 0.7) && w.d > -(D + 0.6) ? S.hold + dt : 0;
    if (footGoesIn({ air: false, run, walk: mov && !run, h: pl.h, hold: S.hold }, w)) {
      if (run) leap(kerb(x, y), T.vaultUp * 0.8, 'dive', 'vaults');
      else { const a = aimAt(open, x, y, pl.h, w, _aim); if (a) { const l = Math.hypot(a.x - x, a.y - y) || 1, v = 1.55 * Math.max(1, (w.k || 1) * 0.8); goIn(x, y, kerb(x, y), (a.x - x) / l * v, (a.y - y) / l * v, 3.4, Math.atan2(a.y - y, a.x - x), w, 'walks', 'step'); } }      /* walked over the edge: a step up on the coping (the core holds him at its top while he crosses it), then he drops off its lip feet first */
    }
  }
  function offBoat() {
    const B = pl.busy, b = B && B.b; S.dive = false; if (!b || !B.boat || B.kind !== 'helm') return;
    const c = Math.cos(b.h), s = Math.sin(b.h), far = b.spec.beam / 2 + 1.6; let side = 0, best = -1e9; for (const k of [1, -1]) { const x = pl.x - s * k * far, y = pl.y + c * k * far; if (!W.afloat(x, y)) continue; const d = W.shoreDist(x, y); if (d > best) { best = d; side = k; } }
    if (!side) { W.note = { text: 'No room to jump here', t: 0 }; return; }
    W.mine = null; W.on = false; b.moored = true; b.mx = b.x; b.my = b.y; b.mh = b.h; b.thr = 0; const zf = B.z || b.z;
    goIn(pl.x, pl.y, zf, (b.vx || 0) * 0.6 - s * side * 3.3, (b.vy || 0) * 0.6 + c * side * 3.3, 3.6, Math.atan2(c * side, -s * side), null, 'offBoat');
  }

  // boats against a swimmer: pushed off the hull, knocked by a moving one, hurt by a fast one
  function boatsPush(dt) {
    for (const list of [W.boats, W.others]) for (const b of list) { const dx = core.x - b.x, dy = core.y - b.y, R = b.spec.len / 2 + 2; if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const c = Math.cos(b.h), s = Math.sin(b.h), hl = Math.max(0, b.spec.len / 2 - b.spec.beam / 2), f = clamp(dx * c + dy * s, -hl, hl), ex = dx - c * f, ey = dy - s * f, d = Math.hypot(ex, ey) || 1e-3, r = b.spec.beam / 2 + 0.4; if (d >= r) continue;
      const nx = ex / d, ny = ey / d, vn = (b.vx || 0) * nx + (b.vy || 0) * ny - (Math.cos(core.h) * core.sp * nx + Math.sin(core.h) * core.sp * ny);
      core.move(core.x + nx * (r - d), core.y + ny * (r - d)); if (vn > 0.5) { core.kx = nx * vn * 0.9; core.ky = ny * vn * 0.9; }
      if (vn > 4.5 && (S.hitT || 0) <= 0) { S.hitT = 1.2; S.stats.hits++; snd((q) => q.thud ? q.thud() : q.burst(0.18, 0.4, 400)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.4); core.vz -= 2.2; try { if (g.combat && typeof g.combat.hurt === 'function' && typeof g.combat.health === 'number') g.combat.hurt(Math.min(60, (vn - 3) * 6)); } catch (e) {} } }
    // the things standing in the water (W.solids: the ferry slip's piles): a swimmer goes round them
    for (const o of W.solids || []) { const ex = core.x - o.x, ey = core.y - o.y, r = o.r + 0.32; if (Math.abs(ex) > r || Math.abs(ey) > r) continue; const d = Math.hypot(ex, ey) || 1e-3; if (d < r) core.move(core.x + (ex / d) * (r - d), core.y + (ey / d) * (r - d)); }
    if (S.hitT > 0) S.hitT -= dt;
  }
  // what F would do now: the nearest ladder within reach, else a boat alongside
  function findReach() {
    let best = null, bd = 1e9; for (const L of S.ladders) { const d = Math.hypot(L.x - core.x, L.y - core.y); if (d < bd) { bd = d; best = L; } } S.near = best; S.nearD = bd;
    if (best && bd < 2.1) return { ladder: best };
    for (const b of W.boats) { if (Math.abs(b.vf) > 2.5) continue; const dx = core.x - b.x, dy = core.y - b.y, c = Math.cos(b.h), s = Math.sin(b.h), hl = b.spec.len / 2 - b.spec.beam / 2, f = clamp(dx * c + dy * s, -hl, hl), d = Math.hypot(dx - c * f, dy - s * f) - b.spec.beam / 2; if (d < 1.7) return { boat: b }; }
    return null;
  }
  // the way in, once he meets the water: the column and crown, how deep he goes, a dive levelling out
  function entryStep(dt) {
    const E = S.entry;
    if (core.ev.splash) { E.wt = 0; const x = core.x, y = core.y, s = W.surf(x, y), dive = E.style === 'dive' || !E.style, big = E.style === 'step' ? 0.7 : 1; E.px = x; E.py = y;
      core.vz = Math.min(core.vz, E.style === 'step' ? -4.6 : dive ? -5.6 : -6.6);      /* under by about a body length (a dive goes in flatter and shallower than a feet-first jump) */
      if (dive) { core.lie = 1; core.sp = Math.max(core.sp, 1.9); E.xt = Math.max(0, (E.th || 2.2) - 1.3); E.xt0 = E.xt; }
      for (let i = 0; i < 34 * big; i++) emit(x + (Math.random() - 0.5) * 0.26, s + 0.05 + Math.random() * 0.5, y + (Math.random() - 0.5) * 0.26, (Math.random() - 0.5) * 0.7 + core.vx * 0.12, (4.5 + 5.5 * Math.random()) * big, (Math.random() - 0.5) * 0.7 + core.vy * 0.12, 0.7 + 0.5 * Math.random(), 0.12 + 0.12 * Math.random());      // the column
      for (let i = 0; i < 44; i++) { const a = (i / 44) * TAU + Math.random() * 0.12, r = 0.42 + 0.1 * Math.random(), o = (1.9 + 1.1 * Math.random()) * big; emit(x + Math.cos(a) * r, s + 0.04, y + Math.sin(a) * r, Math.cos(a) * o, (2.8 + 1.5 * Math.random()) * big, Math.sin(a) * o, 0.5 + 0.35 * Math.random(), 0.09 + 0.08 * Math.random()); }      // the crown: a ring thrown up and out
      try { if (W.river && W.river.ripple) W.river.ripple(x, y, 1); } catch (e) {} S.wet = 1; }
    if (E.wt < 0) return; const w0 = E.wt; E.wt += dt;
    { const v = (E.style === 'step' ? 5.6 : E.style === 'jump' ? 7.6 : 6.2) * (1 - E.wt / 0.58); if (v > 0 && core.vz > -v) core.vz = -v; }      /* (he meets the water with his chin still 0.9 m above it: 2 m of travel puts his head a body length under) */      /* his weight carries him down for the first 0.4 s (the float's spring alone stopped him half a metre under: seen in in-ways3) */
    if (w0 < 0.3 && E.wt >= 0.3 && E.style !== 'step') { const s = W.surf(E.px, E.py); for (let i = 0; i < 16; i++) emit(E.px + (Math.random() - 0.5) * 0.18, s + 0.05, E.py + (Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.5, 4.2 + 3.6 * Math.random(), (Math.random() - 0.5) * 0.5, 0.6 + 0.4 * Math.random(), 0.1 + 0.08 * Math.random()); froth(E.px, E.py, 0.9, 22, 0.12); try { if (W.river && W.river.ripple) W.river.ripple(E.px, E.py, 0.6); } catch (e) {} }      // the water closing over him throws a second jet
    if (E.xt0) E.xt = E.xt0 * (1 - sm(E.wt / 0.55));
    if (E.wt > 0.3) { const dz = core.z - W.surf(core.x, core.y); if (E.deep === undefined || dz < E.deep) E.deep = dz; }
    if (E.wt > 3) { S.lastEntry = { style: E.style, deep: E.deep, t: E.t }; S.entry = null; }
  }
  function swimStep(dt, B) {
    const I = g.input; B.t += dt;
    if (Math.hypot(pl.x - core.x, pl.y - core.y) > 4 || pl.vehicle) { release(); return; }
    if (S.entry && core.state === 'air') S.entry.t += dt;      // someone put him elsewhere (a respawn, a job, a test): theirs
    const was = core.state; core.step(dt, dead() ? null : { mx: I.mx, my: I.my, run: I.run, yaw: g.cam.yaw });
    if (core.state === 'swim') {
      boatsPush(dt);
      if (core.ev.splash) { splash(core.x, core.y, clamp(core.ev.splash / 9, 0.3, 1), core.vx, core.vy); S.helpT = 0; }
      if (S.entry) entryStep(dt);
      if (core.ev.stroke) { S.stats.strokes++; if (core.moving) strokeSound(core.crawl); }
      if ((S.reachT -= dt) <= 0) { S.reachT = 0.15; S.reach = findReach(); }
      const R = S.reach; let go = !!I.use && !dead();
      if (R && R.ladder && !go && core.moving && core.touch) { const L = R.ladder; if (Math.hypot(L.x - core.x, L.y - core.y) < 1.1 && -(Math.cos(core.h) * L.nx + Math.sin(core.h) * L.ny) > 0.4) { S.intoT = (S.intoT || 0) + dt; if (S.intoT > 0.3) go = true; } else S.intoT = 0; } else if (!go) S.intoT = 0;
      if (go && R && R.ladder) { core.startClimb(R.ladder); S.stats.climbs++; S.intoT = 0; froth(core.x, core.y, 0.5, 14, 0.1); splashSound(0.2); }
      else if (go && R && R.boat && typeof W.board === 'function') { const z = core.rootZ(); pl.x = core.x; pl.y = core.y; core.state = 'off'; pl.busy = null; S.stats.boards++; try { if (S.rig) S.rig.restHips(); } catch (e) {} W.board(R.boat); if (pl.busy && pl.busy.boat) pl.busy.z0 = pl.busy.z = z; froth(core.x, core.y, 0.5, 14, 0.1); splashSound(0.2); I.use = false; return; }
      S.helpT += dt;
      // "where is a ladder": none ahead for 20 s
      if ((S.viewT = (S.viewT || 0) - dt) <= 0) { S.viewT = 0.3; const L = S.near; let seen = false; if (L && S.nearD < 70) { const cy = g.cam.yaw; seen = (Math.cos(cy) * (L.x - core.x) + Math.sin(cy) * (L.y - core.y)) > 0.45 * S.nearD || S.nearD < 6; } S.seenT = seen ? 0 : S.seenT + 0.3; S.hint = S.seenT >= 20 && L ? L : null; }
    } else { S.reach = null; S.hint = null; }
    I.use = false; pl.x = core.x; pl.y = core.y; pl.h = core.h; pl.speed = core.sp; B.z = core.rootZ(); B.kind = core.state;
    if (core.state === 'land') { try { mark(pl.x, pl.y, pl.h, 0.5, 0.36, 0.3, 38); mark(pl.x + Math.cos(pl.h) * -0.5, pl.y + Math.sin(pl.h) * -0.5, pl.h + 0.6, 0.3, 0.2, 0.26, 34); } catch (e) {} pl.busy = null; core.state = 'off'; g.cam.mode = 'foot'; if (st) { st.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } try { if (S.rig) S.rig.restHips(); g.playerAnim('idle'); } catch (e) {} }
    else if (was === 'off') release();
  }

  // ---------------------------------------------------------------- cars and motorcycles that go in
  function plunge(v, w) {
    const K = new Sinker(env), bike = !!v.moto, sp = Math.hypot(v.vx, v.vy); K.start(v.x, v.y, v.h, v.vx, v.vy, v.def.len, bike);
    const rec = { v, K, aboard: !bike && pl.vehicle === v, own: Object.prototype.hasOwnProperty.call(v, 'step') ? v.step : null }; v.step = function () {}; v._sinking = true; S.sinkers.push(rec); S.stats[bike ? 'bikes' : 'cars']++;
    snd((s) => s.crash && s.crash(Math.min(14, sp * 0.5))); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.5);
    if (bike && pl.vehicle === v) {      // the rider leaves the saddle at the wall and goes in ahead of the machine
      pl.vehicle = null; pl.vis.object.visible = true; try { g.missions.onExit(v); } catch (e) {} try { if (g.moto) { g.moto.camK = 0; g.moto.wantOff = false; } } catch (e) {}
      goIn(v.x, v.y, 0.75, v.vx * 0.85, v.vy * 0.85, 4.2, v.h, null, 'thrown'); }
  }
  function eject(rec) {
    const v = rec.v; rec.aboard = false; if (pl.vehicle !== v) return; pl.vehicle = null; pl.vis.object.visible = true; g.cam.mode = 'foot'; try { g.missions.onExit(v); } catch (e) {}
    const lx = -Math.sin(v.h), ly = Math.cos(v.h), far = v.def.wid / 2 + 0.9; let x = v.x + lx * far, y = v.y + ly * far; if (!W.afloat(x, y)) { x = v.x - lx * far; y = v.y - ly * far; } if (!W.afloat(x, y)) { x = v.x; y = v.y; }
    core.afloat(x, y, v.h, 0.55); pl.busy = busyOf(); pl.x = x; pl.y = y; S.stats.ins++; S.seenT = 0; S.helpT = 0; froth(x, y, 0.5, 16, 0.1); try { g.playerAnim('idle'); if (pl.vis.mixer) pl.vis.mixer.timeScale = 1; } catch (e) {}
  }
  function stepSinkers(dt) {
    for (let i = S.sinkers.length - 1; i >= 0; i--) { const rec = S.sinkers[i], v = rec.v, K = rec.K; K.step(dt);
      v.x = K.x; v.y = K.y; v.vx = K.vx; v.vy = K.vy; v.vf = Math.hypot(K.vx, K.vy); v.z = K.z; v.pitch = K.pitch; v.roll = K.roll; v.yawV = 0; v.steer = (v.steer || 0) * 0.95; v.slip = 0; v.vs = 0; v.acc = 0; v.braking = false;
      if (K.bike) { v.zf = K.z + Math.sin(K.pitch) * 0.72; v.zr = K.z - Math.sin(K.pitch) * 0.72; if (K.state !== 'fly') v.lean = (v.lean || 0) + (1.25 - (v.lean || 0)) * Math.min(1, dt * 2); }
      if (K.ev.splash) { const c = Math.cos(K.h), s = Math.sin(K.h), k = K.bike ? 1.3 : 2.6; splash(K.x + c * K.len * 0.25, K.y + s * K.len * 0.25, k, K.vx * 2, K.vy * 2); if (!K.bike) splash(K.x - c * K.len * 0.25, K.y - s * K.len * 0.25, k * 0.7, K.vx, K.vy); }
      if (K.ev.bubbles && Math.random() < dt * 34 * K.ev.bubbles) { const c = Math.cos(K.h), s = Math.sin(K.h), a = (Math.random() - 0.3) * K.len * 0.5, q = (Math.random() - 0.5) * 1.4; froth(K.x + c * a - s * q, K.y + s * a + c * q, 0.25, 2, 0.07 + 0.05 * K.ev.bubbles); if (Math.random() < 0.08) snd((o) => o.burst(0.1, 0.03, 500 + 600 * Math.random())); }
      if (rec.aboard) { if (pl.vehicle !== v) rec.aboard = false; else if (K.state !== 'fly' && (K.state !== 'float' || K.t > T.ejectT)) eject(rec); }
      if (K.state === 'gone') { S.sinkers.splice(i, 1); if (pl.vehicle === v) eject(rec); const j = g.vehicles.indexOf(v); if (j >= 0) g.vehicles.splice(j, 1); if (rec.own) v.step = rec.own; else delete v.step; v.gone = true; S.stats.sunk++; } }
  }
  function carWatch(dt) {
    const v = pl.vehicle; if (!v || v._sinking || !v.def) return; if (Math.abs(v.vx) + Math.abs(v.vy) < T.carMin) return;
    const w = shore.near(v.x, v.y, _w, 16); if (!w) return; const q = { x: v.x, y: v.y, vx: v.vx, vy: v.vy, len: v.def.len, wid: v.def.wid };
    if (carGoesIn(q, w, dt) && lands(w, 4) && lands(w, 9)) plunge(v, w);
  }

  // ---------------------------------------------------------------- wet: darker, glossier clothes and hair from the first splash; 40 s to dry on land
  // S.wet 1 (in the water) .. 0 (dry). The player's OWN materials are changed and put back exactly (the numbers saved here); a material some other figure also
  // wears is not touched: the player gets a copy of it while he is wet and his own back when dry. Nothing here runs with ?swim=0 (install returns before it).
  // [how dark, how smooth, how much more of the sky it mirrors] when soaked. The people export names its materials skin_, top_, shoes_, hair_, brows_, lashes_, eyes_ (critic s1, Nov 16: "bone dry: a combed glossy helmet, a clean cloth sleeve": hair far darker with a tight hard highlight, skin with hard glints, cloth dark with a wet sheen)
  const wetKind = (n) => /hair|beard/i.test(n) ? [0.3, 0.07, 2.6, 0.3] : /brow|lash/i.test(n) ? [0.6, 0.3, 0.5, 0] : /eye|teeth/i.test(n) ? [1, 0.1, 0.3, 0] : /skin|face|head|body|hand/i.test(n) ? [0.8, 0.09, 2.2, 0.08] : /shoe/i.test(n) ? [0.5, 0.1, 2, 0.25] : [0.4, 0.07, 2.6, 0.3];      /* 4th: a little metalness so the sky and sun glint off dark wet cloth and hair (critic s2: still "bone dry" at 6 m) */
  const WET = (S.wetLook = { on: false, root: null, list: [], w: -1 }); S.wet = 0;
  const wetDry = () => { for (const r of WET.list) { if (r.copy) { if (r.mesh.material === r.copy) r.mesh.material = r.orig; for (const m of r.mats) m.dispose(); } else r.mats.forEach((m, i) => { const v = r.save[i]; if (m.color && v.c) m.color.copy(v.c); if (v.r !== undefined) m.roughness = v.r; if (v.e !== undefined) m.envMapIntensity = v.e; if (v.m !== undefined) m.metalness = v.m; }); } WET.list.length = 0; WET.on = false; WET.root = null; WET.w = -1; };
  S.wetDry = wetDry;
  function wetLook(w) {
    const root = pl.vis && pl.vis.object; if (WET.on && (w <= 0 || WET.root !== root)) wetDry(); if (w <= 0 || !root) return;
    if (!WET.on) { const mine = new Set(), used = new Set(); root.traverse((o) => { if (o.isMesh && o.material) for (const m of [].concat(o.material)) mine.add(m); });
      const inMe = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }; world.scene.traverse((o) => { if (o.isMesh && o.material && !inMe(o)) for (const m of [].concat(o.material)) if (mine.has(m)) used.add(m); });      // (once per swim: who else wears these)
      root.traverse((o) => { if (!o.isMesh || !o.material) return; const src = [].concat(o.material), copy = src.some((m) => used.has(m)), mats = copy ? src.map((m) => { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; return c; }) : src;
        const save = src.map((m) => ({ c: m.color ? m.color.clone() : null, r: m.roughness, e: m.envMapIntensity, m: m.metalness, wk: wetKind(m.name || o.name || '') }));
        const rec = { mesh: o, orig: o.material, copy: copy ? (Array.isArray(o.material) ? mats : mats[0]) : null, mats, save }; if (copy) o.material = rec.copy; WET.list.push(rec); });
      WET.on = true; WET.root = root; WET.w = -1; }
    if (Math.abs(w - WET.w) < 0.012) return; WET.w = w; const k = sm(w * 1.6);
    for (const r of WET.list) r.mats.forEach((m, i) => { const v = r.save[i]; if (m.color && v.c) m.color.copy(v.c).multiplyScalar(lerp(1, v.wk[0], k)); if (v.r !== undefined) m.roughness = lerp(v.r, Math.min(v.r, v.wk[1]), k); if (v.e !== undefined) m.envMapIntensity = v.e * (1 + v.wk[2] * k); if (v.m !== undefined) m.metalness = lerp(v.m, Math.max(v.m, v.wk[3]), k); });
  }
  // wet marks on the pavement: a patch where he comes out, footprints for his first steps (a small pool of flat dark discs, each fading over half a minute)
  const MARKS = []; let markGeo = null, markI = 0, stepD = 0, stepSide = 1, lastX = 0, lastY = 0, dripT = 0, plopT = 0;
  function mark(x, y, h, rx, ry, a, life) {
    if (!markGeo) markGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2); let M = MARKS[markI];
    if (!M) { const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.name = 'swim_wetmark'; m.renderOrder = 2; m.frustumCulled = false; world.scene.add(m); M = MARKS[markI] = { m, t: 0, life: 1, a: 0 }; }
    markI = (markI + 1) % 30; M.m.position.set(x, kerb(x, y) + 0.016, -y); M.m.rotation.set(0, h, 0); M.m.scale.set(rx, 1, ry); M.t = 0; M.life = life; M.a = a; M.m.visible = true;
  }
  function wetStep(dt) {
    const B = pl.busy, inWater = !!(B && B.swim && core.state === 'swim'), climbing = !!(B && B.swim && core.state === 'climb');
    if (inWater) S.wet = 1; else if (S.wet > 0 && !climbing && !(B && B.swim)) S.wet = Math.max(0, S.wet - dt / 40);
    wetLook(pl.vehicle ? Math.min(S.wet, WET.on ? 1 : 0) : S.wet);
    for (const M of MARKS) { if (!M.m.visible) continue; M.t += dt; const k = 1 - M.t / M.life; if (k <= 0) M.m.visible = false; else M.m.material.opacity = M.a * Math.min(1, k * 1.6); }
    if (!(S.wet > 0) || inWater || pl.vehicle || !pl.vis || !pl.vis.object.visible) { lastX = pl.x; lastY = pl.y; return; }
    // water running off him: thick on the ladder and for the first seconds out, then the odd drop
    const z0 = pl.vis.object.position.y, since = (1 - S.wet) * 40, rate = climbing ? 55 : 46 * Math.exp(-since / 3.2) + 5 * S.wet * S.wet; dripT += rate * dt;
    while (dripT >= 1) { dripT -= 1; const a = Math.random() * TAU, r = 0.1 + 0.2 * Math.random(); emit(pl.x + Math.cos(a) * r, z0 + 0.35 + 1.25 * Math.random(), pl.y + Math.sin(a) * r, (Math.random() - 0.5) * 0.3, -0.6 - 1.2 * Math.random(), (Math.random() - 0.5) * 0.3, 0.3 + 0.3 * Math.random(), 0.014 + 0.018 * Math.random()); }      /* (drops, not foam balls: 0.03 to 0.065 read as snowballs in a close still) */
    if (climbing) { plopT -= dt; if (plopT <= 0) { plopT = 0.14 + 0.12 * Math.random(); const L = core.L, x = L.x + L.nx * (0.25 + 0.45 * Math.random()) - L.ny * (Math.random() - 0.5) * 0.7, y = L.y + L.ny * (0.25 + 0.45 * Math.random()) + L.nx * (Math.random() - 0.5) * 0.7; froth(x, y, 0.12, 3, 0.05); try { if (W.river && W.river.ripple) W.river.ripple(x, y, 0.1 + 0.1 * Math.random()); } catch (e) {} } }
    // footprints
    if (!B && S.wet > 0.55) { const d = Math.hypot(pl.x - lastX, pl.y - lastY); if (d < 3) stepD += d; if (stepD > 0.68) { stepD = 0; stepSide = -stepSide; const c = Math.cos(pl.h), s = Math.sin(pl.h), k = (S.wet - 0.55) / 0.45; mark(pl.x - s * 0.1 * stepSide, pl.y + c * 0.1 * stepSide, pl.h, 0.135, 0.062, 0.34 * Math.min(1, k * 2.2), 26); } }
    lastX = pl.x; lastY = pl.y;
  }
  // ---------------------------------------------------------------- the wrappers
  const step0 = g.step.bind(g); g.step = function (dt) {
    if (!S.on) return step0(dt); const d = dt > 0 ? dt : 0;
    try { if (pl.vehicle) { carWatch(d); if (pl.vehicle && pl.vehicle._sinking) g.input.use = false; } } catch (e) { err('car', e); }
    step0(dt);
    try { if (S.sinkers.length) stepSinkers(d); } catch (e) { err('sink', e); }
    try { if (S.dive) offBoat(); else if (!pl.vehicle && !pl.busy) footWatch(d); } catch (e) { err('foot', e); }
    try { if (S.wet > 0 || WET.on || MARKS.length || (pl.busy && pl.busy.swim)) wetStep(d); } catch (e) { err('wet', e); }
  };
  const sb0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const B = pl.busy; if (B && B.swim) { try { swimStep(dt, B); } catch (e) { err('swim', e); release(); } } else sb0(dt); };
  if (typeof g.nearestCar === 'function') { const nc0 = g.nearestCar.bind(g); g.nearestCar = function (d) { const n = nc0(d); return n && n.kind === 'veh' && n.v && n.v._sinking ? null : n; }; }      // a car going down is not got into
  // the look of the swim (S.look: these can be turned in the console). Depths in m, angles in radians from upright.
  const SW = (S.look = { treadLean: 0.1, treadDeep: 0.06, treadBob: 0.045, treadHunch: 0.06, breathHz: 0.36, breastLie: 1.3, breastRise: 0.2, breastDeep: 0.18, breastUp: 0.13, breastArch: 0.25, breastLeg: 1.3, crawlLie: 1.3, crawlDeep: 0.16, crawlArch: -0.14, clipDeep: 0.05, crawlLeg: 1.41, camZ: 0.18, camH: 0.14, camDist: 2.5, camDip: 0.12, camFloor: 0.24 });
  S.fx = { rings: 0, drops: 0 };
  const rip = (x, y, k) => { S.fx.rings++; try { const Rv = W.river; if (Rv && Rv.ripple) Rv.ripple(x, y, clamp(k, 0, 1)); } catch (e) { err('river', e); } };
  // a few small fast drops thrown from (x, y) on the surface at height s: (vx, vy) along the map, vup up
  // Thrown water (wakefx.js's sheets, streaks and mist: water with height). (x, y) on the map, h the height it starts at, s the surface there (where it dies).
  const HF = () => (W.hullfx && W.hullfx.on && W.hullfx.emit ? W.hullfx : null), rn = (a) => (Math.random() - 0.5) * a, many = (r, dt) => { const n = r * dt; return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); };
  const sheet = (x, y, h, s, vx, vy, vup, size, life) => { const F = HF(); if (!F) return; S.fx.drops++; F.emit(0, x, h, -y, vx, vup, -vy, life, size * 0.55, 0.38, 0.6, s - 0.04); };      /* lead, after sw-final3: the pieces read as cotton clouds half a metre wide; smaller, thinner, growing less */
  const streak = (x, y, h, s, vx, vy, vup) => { const F = HF(); if (!F) return; S.fx.drops++; F.emit(1, x, h, -y, vx, vup, -vy, 0.3 + 0.3 * Math.random(), 0.016 + 0.02 * Math.random(), 0.85, 0, s - 0.04); };
  const mist = (x, y, s, vx, vy) => { const F = HF(); if (!F) return; F.emit(2, x, s + 0.15, -y, vx, 0.3 + 0.3 * Math.random(), -vy, 0.6 + 0.4 * Math.random(), 0.35 + 0.3 * Math.random(), 0.075, 1.6, s - 0.04); };
  const _hc4 = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq3 = new THREE.Quaternion(), _hm = new THREE.Matrix4(), _hc = new THREE.Vector3(), _top = new THREE.Vector3(), _hn = new THREE.Vector3(), _el = new THREE.Vector3();
  // the head to a world attitude: face along `face`, the crown toward `top`; the neck takes half of the turn
  function headAim(rig, face, top) {
    const hd = rig.B.head, nk = rig.B.neck; face.normalize(); _hc.crossVectors(face, top); if (_hc.lengthSq() < 1e-6) return; _hc.normalize(); top.crossVectors(_hc, face);
    _hq.setFromRotationMatrix(_hm.makeBasis(face, top, _hc)).multiply(rig.headRel);
    if (nk && nk.parent) { hd.getWorldQuaternion(_hq2); _hq2.invert().premultiply(_hq); _hq3.identity().slerp(_hq2, 0.5); nk.parent.getWorldQuaternion(_hq2); nk.getWorldQuaternion(_hc4); nk.quaternion.copy(_hq2.invert()).multiply(_hq3).multiply(_hc4); nk.updateMatrixWorld(true); }
    hd.parent.getWorldQuaternion(_hq2); hd.quaternion.copy(_hq2.invert()).multiply(_hq); hd.updateMatrixWorld(true);
  }
  const ct0 = g.camTarget.bind(g); g.camTarget = function () {
    const B = pl.busy; if (!(B && B.swim) || pl.vehicle) return ct0();
    if (core.state === 'swim') { const s = W.surf(pl.x, pl.y), dz = clamp(core.z - s, -0.45, 0.2), sg = core.sp > 0.2 ? clamp((core.v || 0) / core.sp - 1, -0.4, 0.4) : 0;      // low and close behind his head: the swell lifts the view, a surge dips it, and it goes down to the surface with him when he goes under
      return { x: pl.x, y: pl.y, z: s + SW.camZ + 0.75 * dz - SW.camDip * core.lie * sg, dist: SW.camDist + core.sp * 0.22, height: SW.camH, fov: 52, yaw: pl.h, auto: core.sp > 0.3 ? 1.0 : 0 }; }
    return { x: pl.x, y: pl.y, z: Math.max(core.zf + 1.35, W.level + 0.4), dist: 3.9, height: 0.4, fov: 52, yaw: pl.h, auto: core.state === 'climb' ? 1.4 : 0 };
  };
  // the game keeps its camera 0.4 m above the street; the water is 1.6 m below it. While he swims the floor is the water under the camera.
  const pc0 = g.placeCamera.bind(g), _cd = new THREE.Vector3(); g.placeCamera = function (dt) {
    pc0(dt); const B = pl.busy; if (!(B && B.swim) || pl.vehicle || (g.heli && g.heli.hasCamera) || (g.fly && g.fly.on)) return;
    try { const C = g.cam, cam = world.camera, pitch = Math.max(-0.25, C.pitch), d = Math.min(C.dist, C.clip === undefined ? C.dist : C.clip), cz = C.tz + C.h + d * Math.sin(pitch); if (cz >= 0.4) return;
      const y = Math.max(cz, W.surf(cam.position.x, -cam.position.z) + SW.camFloor); if (Math.abs(y - cam.position.y) < 1e-4) return; cam.position.y = y; cam.lookAt(C.tx, C.tz + 0.15, -C.ty);
      const extra = -0.25 - C.pitch; if (extra > 0) { cam.getWorldDirection(_cd); const hl = Math.hypot(_cd.x, _cd.z) || 1, e = Math.min(1.4, Math.asin(clamp(_cd.y, -1, 1)) + extra); cam.lookAt(cam.position.x + _cd.x / hl * Math.cos(e) * 10, cam.position.y + Math.sin(e) * 10, cam.position.z + _cd.z / hl * Math.cos(e) * 10); } } catch (e) { err('camera', e); }
  };

  // ---------------------------------------------------------------- the figure: the strokes, laid over the idle clip
  const V = () => new THREE.Vector3(), _f = V(), _l = V(), _r = V(), _hp = V(), _s = V(), _t = V(), _pole = V(), _ax = V(), _nf = V(), _ld = V(), _look = V(), UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _cl = {};
  const a3 = [0, 0, 0], b3 = [0, 0, 0], c3 = [0, 0, 0];
  function pose(dt) {
    const vis = pl.vis; if (!EntryRig || !vis || !vis.mixer) return; const rig = (S.rig ||= new EntryRig(vis, vis.name || 'player')); if (!rig.ok) return;
    const h = pl.h, ch = Math.cos(h), sh = Math.sin(h); _f.set(ch, 0, -sh); _l.set(-sh, 0, -ch); _r.set(sh, 0, ch); vis.object.updateMatrixWorld(true);
    const arm = (sd, sg, fwd, lat, up, w) => { rig.pos('upper_arm_' + sd, _s); const R = rig.armLen; _t.copy(_s).addScaledVector(_f, fwd * R).addScaledVector(_r, sg * lat * R).addScaledVector(UP, up * R); const hi = sm(up * 2.5 + 0.2); _pole.set(0, 0, 0).addScaledVector(UP, lerp(-0.6, 1, hi)).addScaledVector(_r, sg * 0.8).addScaledVector(_f, -0.3); rig.arm(sd, _t, _pole, w); return _t; };
    if (core.state === 'air') {      // the way in. dive: the body tips over the hips until the hands lead, arms and legs in one line; jump: stepping off, feet first; step: over the coping at a walk, then the drop
      const E = S.entry || { style: '', t: core.t, sx: 1 }, t = E.t, tf = E.tf || 1, LL = rig.thigh + rig.shin, dn = clamp(-core.vz / 7, 0, 1);
      const legTo = (sd, sg, af, au, len, kf, pitch, w) => { rig.pos('thigh_' + sd, _s); _t.copy(_s).addScaledVector(_f, af * LL * len).addScaledVector(UP, au * LL * len).addScaledVector(_r, sg * 0.05); _pole.copy(_f).multiplyScalar(kf).addScaledVector(UP, 0.5 - Math.abs(kf) * 0.3).addScaledVector(_r, sg * 0.12); rig.leg(sd, _t, _pole, _f, pitch, w); };
      if (E.style === 'dive' || !E.style) {
        const k = sm(t / 0.28), th = 0.3 + 1.95 * sm((t - 0.1) / (0.78 * tf)), sn = Math.sin(th), cs = Math.cos(th); E.th = th;
        rig.tilt(_q.setFromAxisAngle(_l, th)); rig.bend(_l, -0.14 * Math.sin(Math.PI * clamp(t / tf, 0, 1)));
        for (const [sd, sg] of [['L', -1], ['R', 1]]) { arm(sd, sg, lerp(0.15, Math.sin(th + 0.08), k), lerp(0.3, 0.05, k), lerp(-0.9, Math.cos(th + 0.08), k), 1); legTo(sd, sg, -sn, -cs, 0.985, cs, -(Math.PI / 2 + th) * 0.88, sm(t / 0.22)); }
        _look.copy(_f).multiplyScalar(sn + 0.25).addScaledVector(UP, cs); rig.look(_look, 0.8 * k); return; }
      if (E.style === 'jump') {
        const u = clamp(t / tf, 0, 1), k = sm(t / 0.3), close = sm((u - 0.5) / 0.32); rig.tilt(_q.setFromAxisAngle(_l, 0.16 - 0.1 * close));
        for (const [sd, sg] of [['L', -1], ['R', 1]]) { const lead = sg === E.sx; arm(sd, sg, 0.22, lerp(0.45, 0.85, k), lerp(-0.6, 0.62, k) - 0.1 * close, 1);
          legTo(sd, sg, (lead ? 0.5 : -0.28) * (1 - close) * k, -1, lerp(lead ? 0.72 : 0.92, 0.985, Math.max(close, 1 - k)), 1, lerp(-0.2, -1.4, close), 1); }
        return; }
      // step: a walking gait while the coping carries him, then arms out and legs together as he drops
      { const drop = sm((0.2 - core.vz) / 2.5), gph = t * 1.9; rig.tilt(_q.setFromAxisAngle(_l, 0.1 + 0.08 * drop));
        for (const [sd, sg] of [['L', -1], ['R', 1]]) { const sw = Math.sin(TAU * gph + (sg < 0 ? Math.PI : 0)), lift = Math.max(0, Math.cos(TAU * gph + (sg < 0 ? Math.PI : 0)));
          arm(sd, sg, lerp(-0.25 * sw, 0.15, drop), lerp(0.3, 0.85, drop), lerp(-0.85, 0.45, drop), lerp(0.6, 1, drop));
          legTo(sd, sg, 0.3 * sw * (1 - drop), -1, lerp(0.97 - 0.2 * lift, 0.985, drop), 1, lerp(0, -1.4, drop), 1); }
        return; } }
    if (core.state === 'climb') {      // rung by rung: each hand on its rail, each foot on its rung (climbAt), then over the coping at a walk
      const L = core.L, C = climbAt(core.ct / T.climb, core.cz, _cl), c = C.c, on = C.a * (1 - sm(c / 0.3)), LL = rig.thigh + rig.shin; rig.tilt(_q.setFromAxisAngle(_l, 0.16 * on + 0.1 * Math.sin(Math.PI * c)));
      const bx = L.x + L.nx * 0.11, by = L.y + L.ny * 0.11, rail = 1.4;      // the ladder's plane; the top of its rails above the street
      for (const [sd, sg] of [['L', -1], ['R', 1]]) { const fr = sg < 0 ? C.fl : C.fr, hr = sg < 0 ? C.fr : C.fl;      // a hand goes up with the OTHER foot
        _t.set(bx, Math.min(rail, RUNG_TOP + RUNG * hr + 1.42), -by).addScaledVector(_r, sg * 0.22).addScaledVector(_f, -0.03); _pole.set(0, -0.7, 0).addScaledVector(_r, sg * 0.7).addScaledVector(_f, -0.4); rig.arm(sd, _t, _pole, on);
        if (c <= 0) { _t.set(bx, RUNG_TOP + RUNG * fr + 0.09, -by).addScaledVector(_r, sg * 0.12).addScaledVector(_f, -0.1); _pole.copy(_f).addScaledVector(_r, sg * 0.45); rig.leg(sd, _t, _pole, _f, -0.2, C.a); }
        else { const g2 = c * 2.2 + (sg < 0 ? 0 : 0.5), sw = Math.sin(TAU * g2), lift = Math.max(0, Math.cos(TAU * g2)), w = 1 - sm((c - 0.7) / 0.3); rig.pos('thigh_' + sd, _s); _t.copy(_s).addScaledVector(_f, 0.3 * sw).addScaledVector(UP, -LL * (0.96 - 0.22 * lift)).addScaledVector(_r, sg * 0.05); _pole.copy(_f).addScaledVector(UP, 0.3).addScaledVector(_r, sg * 0.15); rig.leg(sd, _t, _pole, _f, 0, w); } }
      return; }
    if (core.state !== 'swim') return;
    const lie = core.lie, cr = core.crawl, ph = core.phase, t = core.t, wT = 1 - lie, wB = lie * (1 - cr), wC = lie * cr, Q = SW, R = rig.armLen, LL = rig.thigh + rig.shin, sNow = core.strokes + ph, ds = sNow - (S.sPrev === undefined ? sNow : S.sPrev), live = core.moving && ds > 0 && ds < 0.5, sP = sNow - ds; S.sPrev = sNow;
    const crossed = (off, n = 1) => live && Math.floor(n * sNow + off) > Math.floor(n * sP + off), spd = core.v || core.sp, surf0 = W.surf(pl.x, pl.y);
    const lift = breastLift(ph), bth = crawlBreath(sNow), ab = Math.abs(bth), roll = wC * crawlRoll(ph), sc = TAU * T.rTread * t, breath = Math.sin(TAU * Q.breathHz * t);
    // the trunk: its lean from upright, and how far the shoulders are under his float line. Treading he hangs nearly upright with the water at his collar; swimming he lies along the surface
    const th = wT * (Q.treadLean + 0.03 * Math.sin(sc)) + wB * (Q.breastLie - Q.breastRise * lift) + wC * Q.crawlLie;
    const deep = rig.shoulderUp * Math.cos(th) + wT * (Q.treadDeep - Q.treadBob * breath - 0.012 * Math.sin(2 * sc)) + wB * (Q.breastDeep - Q.breastUp * lift) + wC * (Q.crawlDeep + 0.015 * Math.cos(TAU * 2 * ph)), back = 0.32 * lie;      // (Deep = the shoulders under his float line; the hips hang from them by the trunk's lean, so no blend stands him up out of the water)
    _hp.set(pl.x - ch * back, core.z - Math.max(0, core.z - surf0 - 0.04) * 0.7 - deep, -(pl.y - sh * back));      /* (bobbing up out of a plunge he does not stand out of the water) */ rig.hips(_hp, 1);
    rig.tilt(_q.setFromAxisAngle(_l, th)); _ax.copy(_f).multiplyScalar(Math.sin(th)).addScaledVector(UP, Math.cos(th)); if (Math.abs(roll) > 1e-3) { rig.tilt(_q.setFromAxisAngle(_ax, -roll * 0.5)); rig.bend(_ax, -roll * 0.5); }      // half the roll is the hips', half a twist up the back: the shoulders turn further than the seat;      // (about the head-ward axis a positive turn puts the right side down)
    rig.bend(_l, wT * Q.treadHunch + wB * (-0.06 - Q.breastArch * lift) + wC * Q.crawlArch);
    // the head, held in the world (it does not roll with the body): level when treading; face down with the crown leading on the glide and in the crawl; lifted to breathe at the end of the breaststroke's in-sweep; turned to the side of the arm coming over for the crawl's breath
    const ya = 0.32 * Math.sin(0.83 * t) + 0.2 * Math.sin(0.31 * t + 1);      // treading he looks about him, the head tipped back a little
    _look.set(0, 0, 0).addScaledVector(_f, wT * Math.cos(ya) + wB * lerp(0.6, 0.97, lift) + wC * lerp(0.3, 0.12, ab)).addScaledVector(UP, wT * 0.14 + wB * lerp(-0.8, -0.05, lift) + wC * lerp(-0.95, -0.3, ab)).addScaledVector(_r, wT * Math.sin(ya) + wC * bth);      // (the crawl's breath: half a face, low, turned to the side)
    _top.set(0, 0, 0).addScaledVector(UP, wT + lie * 0.25).addScaledVector(_f, lie); headAim(rig, _look, _top);
    const thL = wT * 0.05 + wB * (Q.breastLeg - 0.22 * lift) + wC * Q.crawlLeg; _ld.copy(_f).multiplyScalar(-Math.sin(thL)).addScaledVector(UP, -Math.cos(thL)); _nf.copy(_f).multiplyScalar(Math.cos(thL)).addScaledVector(UP, -Math.sin(thL));
    for (const [sd, sg] of [['L', -1], ['R', 1]]) {
      armTread(t, sg, a3); armBreast(ph, b3); armCrawl(ph, sg, c3); const fw = a3[0] * wT + b3[0] * wB + c3[0] * wC, la = a3[1] * wT + b3[1] * wB + c3[1] * wC, up = a3[2] * wT + b3[2] * wB + c3[2] * wC, el = a3[3] * wT + b3[3] * wB + c3[3] * wC;
      rig.pos('upper_arm_' + sd, _s); _t.copy(_s).addScaledVector(_f, fw * R).addScaledVector(_r, sg * la * R).addScaledVector(UP, up * R); _pole.set(0, 0, 0).addScaledVector(UP, el).addScaledVector(_r, sg * 0.8).addScaledVector(_f, -0.25); rig.arm(sd, _t, _pole, 1);
      // the hand flat and in line with the forearm: palm down ahead of him, palm back when the forearm hangs for the pull
      rig.pos('forearm_' + sd, _s); rig.pos('hand_' + sd, _hn); _t.subVectors(_hn, _s).normalize(); { const u = ph + (sg < 0 ? 0.5 : 0), uu = u - Math.floor(u); _t.addScaledVector(UP, -0.8 * wC * hump(uu, 0.62, 0.97)); }      /* carried over the water the hand hangs loose from the wrist */
      _pole.copy(UP).addScaledVector(_f, 0.7).multiplyScalar(sg); rig.handDir(sd, _t, _pole, 1); rig.curl(sd, 0.1 + 0.25 * wC * sm((up + 0.05) * 5)); _el.copy(_s);
      const hx = _hn.x, hy = -_hn.z, hs = W.surf(hx, hy), off = sg < 0 ? 0.5 : 0;
      if (wC > 0.5) {      // front crawl: the hand goes in (a ripple, spray thrown ahead), comes out by the thigh (a few drops), and drips as it is carried over
        const u = ph + off - Math.floor(ph + off), vx = ch * spd, vy = sh * spd, ox = sh * sg, oy = -ch * sg;      // (ox, oy): outward on his side
        if (crossed(off)) { rip(hx, hy, 0.3); for (let i = 0; i < 3; i++) sheet(hx + rn(0.1), hy + rn(0.1), hs + 0.03, hs, vx + ch * (0.6 + Math.random()) + ox * (0.3 + 0.6 * Math.random()), vy + sh * (0.6 + Math.random()) + oy * (0.3 + 0.6 * Math.random()), 0.6 + 0.7 * Math.random(), 0.07 + 0.06 * Math.random(), 0.3 + 0.2 * Math.random()); for (let i = 0; i < 6; i++) streak(hx + rn(0.08), hy + rn(0.08), hs + 0.04, hs, vx + ch * (1 + 1.5 * Math.random()) + ox * Math.random() + rn(0.6), vy + sh * (1 + 1.5 * Math.random()) + oy * Math.random() + rn(0.6), 0.8 + 1.4 * Math.random()); }
        if (live && u > 0.63 && u < 0.76 && _hn.y > hs - 0.03) for (let i = many(11, dt); i > 0; i--) { const k = Math.random(); sheet(lerp(_el.x, _hn.x, k) + rn(0.05), -lerp(_el.z, _hn.z, k) + rn(0.05), lerp(_el.y, _hn.y, k) - 0.04, hs, vx * 0.7, vy * 0.7, -0.2 - 0.5 * Math.random(), 0.05 + 0.05 * Math.random(), 0.18 + 0.14 * Math.random()); }      // out by the thigh: a torn sheet hangs under the forearm
        if (live && u > 0.64 && u < 0.96 && _hn.y > hs + 0.02) for (let i = many(14, dt); i > 0; i--) streak(hx + rn(0.04), hy + rn(0.04), _hn.y - 0.04, hs, vx * 0.8 + rn(0.3), vy * 0.8 + rn(0.3), -0.3 - 0.6 * Math.random()); }      // and drops fall from the hand as it is carried over
      else if (wT > 0.6 && _hn.y > hs - 0.25) { const k = Math.floor(T.rTread * t + (sg < 0 ? 0.5 : 0)); if (k !== S['sc' + sd]) { S['sc' + sd] = k; rip(hx, hy, 0.15); if (Math.random() < 0.2) sheet(hx, hy, hs + 0.02, hs, rn(0.3), rn(0.3), 0.3, 0.08, 0.25); } }      // treading: each scull stirs the surface over that hand
      legTread(t, sg, a3); legBreast(ph, b3); legCrawl(ph, sg, c3); const ext = a3[0] * wT + b3[0] * wB + c3[0] * wC, kn = a3[1] * wT + b3[1] * wB + c3[1] * wC, lt = a3[2] * wT + b3[2] * wB + c3[2] * wC;
      rig.pos('thigh_' + sd, _s); _t.copy(_s).addScaledVector(_ld, LL * ext).addScaledVector(_nf, kn).addScaledVector(_r, sg * lt); _pole.copy(_nf).addScaledVector(_r, sg * (0.25 + 1.2 * wB * (b3[2] - 0.06) + 0.5 * wT));
      rig.leg(sd, _t, _pole, _f, -(Math.PI / 2 + thL) * lerp(0.88, 1, lie), 1);      // swimming, the foot is pointed in line with the leg
      if (wC > 0.5) { rig.pos('foot_' + sd, _hn); const fx = _hn.x, fy = -_hn.z, fs = W.surf(fx, fy), q = clamp(spd / T.sprint, 0.3, 1.1); if (crossed(off + 0.25, 3)) rip(fx, fy, 0.2);      // the kick: a low boil of white water over the feet all the while he crawls
        if (live) { for (let i = many(6 * q, dt); i > 0; i--) sheet(fx + rn(0.2), fy + rn(0.2), fs + 0.02, fs, ch * spd * 0.3 + rn(0.6), sh * spd * 0.3 + rn(0.6), 0.6 + 0.9 * Math.random(), 0.07 + 0.07 * Math.random(), 0.25 + 0.2 * Math.random()); for (let i = many(7 * q, dt); i > 0; i--) streak(fx + rn(0.15), fy + rn(0.15), fs + 0.04, fs, ch * spd * 0.3 + rn(1.2), sh * spd * 0.3 + rn(1.2), 1.2 + 1.6 * Math.random()); for (let i = many(0.8 * q, dt); i > 0; i--) mist(fx, fy, fs, ch * spd * 0.3, sh * spd * 0.3); } }
    }
    rig.pos('head', _hn); const nx = _hn.x, ny = -_hn.z;
    const ns = W.surf(nx, ny), vx = ch * spd, vy = sh * spd;
    if (live && spd > 0.4) for (let i = many((6 * wC + 2.5 * wB) * clamp(spd / T.swim, 0.4, 1.6), dt); i > 0; i--) { const sd2 = rn(0.24); sheet(nx + ch * 0.13 + sh * sd2, ny + sh * 0.13 - ch * sd2, ns + 0.02, ns, vx * 1.05 + sh * sd2 * 4, vy * 1.05 - ch * sd2 * 4, 0.3 + 0.4 * Math.random(), 0.05 + 0.05 * Math.random(), 0.2 + 0.1 * Math.random()); }      // a low ridge of white water pushed ahead of the head and the leading shoulder
    if (wB > 0.5) { if (crossed(0.45)) rip(nx, ny, 0.3); if (crossed(0.12)) rip(nx + ch * 0.25, ny + sh * 0.25, 0.4);
      if (live && lift > 0.12 && ph - Math.floor(ph) < 0.66) { for (let i = many(18, dt); i > 0; i--) { const sd2 = rn(0.6); sheet(nx + ch * 0.1 + sh * sd2, ny + sh * 0.1 - ch * sd2, ns + 0.03, ns, vx + ch * (0.5 + 0.8 * Math.random()) + sh * sd2 * 1.5, vy + sh * (0.5 + 0.8 * Math.random()) - ch * sd2 * 1.5, 0.8 + 1.1 * Math.random(), 0.09 + 0.08 * Math.random(), 0.35 + 0.2 * Math.random()); } for (let i = many(12, dt); i > 0; i--) streak(nx + ch * 0.15 + rn(0.4), ny + sh * 0.15 + rn(0.4), ns + 0.05, ns, vx + ch * 1.2 + rn(1), vy + sh * 1.2 + rn(1), 1 + 1.5 * Math.random()); }      // the breath: a wall of white as the shoulders surge up
      if (crossed(0.1)) { const kx = nx - ch * 1.55, ky = ny - sh * 1.55, ks = W.surf(kx, ky); rip(kx, ky, 0.3); for (let i = 0; i < 5; i++) sheet(kx + rn(0.4), ky + rn(0.4), ks + 0.02, ks, rn(0.8), rn(0.8), 0.5 + 0.6 * Math.random(), 0.07 + 0.06 * Math.random(), 0.25 + 0.15 * Math.random()); for (let i = 0; i < 2; i++) streak(kx + rn(0.3), ky + rn(0.3), ks + 0.04, ks, rn(1), rn(1), 1 + Math.random()); } }      // the kick snaps shut behind him: a small boil
    if (wT > 0.6) { const k = Math.floor(Q.breathHz * t + 0.25); if (k !== S.bobK) { S.bobK = k; rip(nx, ny, 0.3); } }      // treading: a ring as he settles at the bottom of each breath
    S.inW = true; try { const Rv = W.river; if (Rv && Rv.swimmer) { rig.pos(rig.B.chest2 ? 'chest2' : 'spine', _hn); Rv.swimmer(_hn.x, -_hn.z, pl.h, spd, true); } /* his chest (between the shoulders), the heading his body lies along */ } catch (e) { err('river', e); }
  }
  // where the swimmer leaves the water (or is taken out of it) the river is told once; coming into it is a ring of its own
  // Under the surface he is not drawn. The river's surface is opaque but writes no depth, so the passes that read the depth buffer after it still found his body under
  // the water and shaded it in as a dark figure. While he swims his own materials are cut by a level plane a little under the water round him; put back as they were after.
  const clipP = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), clipArr = [clipP], clipOn = [];
  function underClip(on, y) {
    const R = world.renderer; if (!R || !pl.vis || !pl.vis.object) return;
    if (on) { clipP.constant = -y; if (!clipOn.length) { S.clip0 = R.localClippingEnabled; R.localClippingEnabled = true; }
      pl.vis.object.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.clippingPlanes !== clipArr) { clipOn.push({ m, was: m.clippingPlanes }); m.clippingPlanes = clipArr; m.needsUpdate = true; } }); }
    else if (clipOn.length) { for (const c of clipOn) if (c.m.clippingPlanes === clipArr) { c.m.clippingPlanes = c.was; c.m.needsUpdate = true; } clipOn.length = 0; R.localClippingEnabled = S.clip0; }
  }
  function waterSide() { const B = pl.busy, wet = !!(B && B.swim) && !pl.vehicle && (core.state === 'swim' || core.state === 'climb'); underClip(wet && SW.clipDeep > 0, (core.state === 'swim' ? W.surf(pl.x, pl.y) : W.level) - SW.clipDeep); const inw = !!(B && B.swim) && !pl.vehicle && core.state === 'swim'; if (inw && !S.wasIn) rip(core.x, core.y, S.wasAir ? 1 : 0.6); S.wasAir = core.state === 'air'; S.wasIn = inw;
    if (!inw && S.inW) { S.inW = false; S.sPrev = undefined; try { const Rv = W.river; if (Rv && Rv.swimmer) Rv.swimmer(pl.x, pl.y, pl.h, 0, false); } catch (e) { err('river', e); } } }
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) {
    sv0(dt); try { waterSide(); } catch (e) { err('river', e); } const B = pl.busy; if (!(B && B.swim) || pl.vehicle) return;
    try { pose(dt); } catch (e) { err('pose', e); }
  };

  // ---------------------------------------------------------------- the HUD
  if (g.hud && typeof g.hud.draw === 'function') { const hd0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { hd0(); const B = pl.busy; if (B && B.swim) { try { drawHud(this); } catch (e) { err('hud', e); } } }; }
  function drawHud(hud) {
    const c = hud.ctx, k = hud.k || 1, Wd = hud.w / k, H = 1080 /* as hud.js draw(): its units are a 1080-high screen (hud.h / k was not that, and the lines were drawn off the screen) */; if (g.demo || g.capture || !hud.w || core.state !== 'swim') return; /* the HUD is drawn in 1080-high units: hud.k */ const F = g.menu && g.menu.keyName ? g.menu.keyName('KeyF') : 'F', R = S.reach;
    if (R) { const txt = R.ladder ? 'Climb out' : 'Climb aboard'; hud.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22); hud.text(F, Wd / 2 - 96, H * 0.62 + 30, 20, AMBER, 'center', 800); hud.text(txt, Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); }
    else if (S.hint) { const L = S.hint, a = Math.atan2(L.y - core.y, L.x - core.x) - g.cam.yaw, d = Math.round(Math.hypot(L.x - core.x, L.y - core.y)); hud.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22);
      c.save(); c.translate(Wd / 2 - 96, H * 0.62 + 22); c.rotate(-a); c.fillStyle = AMBER; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 8); c.lineTo(0, 3); c.lineTo(-8, 8); c.closePath(); c.fill(); c.restore();
      hud.text('Ladder  ' + d + ' m', Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); }
    if (S.helpT < 9) { c.globalAlpha = clamp(9 - S.helpT, 0, 1); const hy = H - 206;      /* above the game's own lines at the bottom: its key hints (H - 60..30) and the spoken-line box over them (H - 145..65): ours lay across both (out/sw-7/tread_side_2.jpg) */ hud.panel(Wd / 2 - 300, hy, 600, 40, 6); hud.text('W A S D  swim     Shift  crawl     ' + F + '  climb out at a ladder or onto a boat', Wd / 2, hy + 27, 15, '#fff', 'center', 600, 1); c.globalAlpha = 1; }
  }
  console.log('[swim] on: ' + S.ladders.length + ' ladders along ' + Math.round(shore.len) + ' m of shore line (' + shore.n + ' pieces)' + (EntryRig ? '' : '; no rig: the figure is not posed') + (Object.keys(S.errs).length ? '; faults: ' + Object.keys(S.errs).join(', ') : ''));
  return S;
}
