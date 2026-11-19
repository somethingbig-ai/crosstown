// water/waves.js (water lane, Nov 15): ONE wave function, read by the water's shader and by the boats' physics, so a hull rides exactly the
// waves the player sees. A sum of Gerstner (trochoid) waves for the river's chop, plus the V-shaped wakes of up to four moving boats.
//   heightAt(x, y, t)        the surface height above the water's rest level at map point (x east, y north), metres
//   sample(x, y, t, out)     out.h height, out.nx / out.ny the surface slope's downhill... (see below), out.vx / out.vy the water's own drift
//   GLSL                     the same function as shader text (waDisp, waNormal), fed by uniforms()
// Map frame everywhere in this file: x east, y north (three.js: x, -z).
const G = 9.81, TAU = Math.PI * 2;
// direction (degrees, where the wave travels to, from east counter-clockwise), length L (m), amplitude A (m), steepness Q (0..1 share of the sharpest crest)
// A river in a fresh breeze: short wind chop running up-river (the Hudson lies about 29 degrees east of north here) and a cross chop; nothing longer than 23 m
// (critic round 2: a 41 m swell read as an ocean hump). The surface moves by about a quarter of a metre; a ferry's wake is the big wave here.
const SET = [
  [62, 23.0, 0.075, 0.55],
  [81, 14.0, 0.062, 0.60],
  [38, 9.0, 0.046, 0.65],
  [104, 5.6, 0.030, 0.70],
  [55, 3.4, 0.018, 0.70],
  [-12, 11.0, 0.036, 0.50],
];
export const WAVES = SET.map(([deg, L, A, Q]) => { const a = deg * Math.PI / 180, k = TAU / L, w = Math.sqrt(G * k); return { dx: Math.cos(a), dy: Math.sin(a), L, A, k, w, q: Q / (k * A * SET.length) * 0.9 }; });
export const NW = WAVES.length;
// the sea state: 1 = the set above. The game may ease it (calm in a slip, rougher mid-river); the shader and the physics read the same number.
export const state = { sea: 1, t: 0 };
// ---- boat wakes: each source is a boat under way. Behind it two arms open at the Kelvin angle; each arm is a short train of crests.
export const MAXWAKE = 4, KELVIN = Math.tan(19.47 * Math.PI / 180);
export const wakes = [];      // { x, y, hx, hy (unit heading), amp (m), len (m of arm that still stands), k (crest spacing wavenumber) }
export function setWake(i, x, y, h, speed, size) {      // size: 1 a speedboat, 3 a ferry
  const w = wakes[i] || (wakes[i] = {}); w.x = x; w.y = y; w.hx = Math.cos(h); w.hy = Math.sin(h);
  const s = Math.min(1, Math.max(0, (Math.abs(speed) - 1.5) / 7)); w.amp = 0.11 * size * s * (speed < 0 ? 0.3 : 1); w.len = 60 + 110 * size * s; w.k = TAU / (2.2 + 2.6 * size); w.wid = 1.6 + 1.5 * size; w.sp = speed;
}
export function clearWake(i) { if (wakes[i]) wakes[i].amp = 0; }
function wakeH(x, y) {
  let h = 0;
  for (let i = 0; i < wakes.length; i++) { const w = wakes[i]; if (!w || !(w.amp > 0)) continue;
    const ex = x - w.x, ey = y - w.y, al = -(ex * w.hx + ey * w.hy); if (al < -2 || al > w.len) continue;      // metres astern
    const lat = Math.abs(-ex * w.hy + ey * w.hx), d = lat - Math.max(al, 0) * KELVIN, wd = w.wid * (0.3 + 0.7 * Math.min(1, Math.max(al, 0) / 14)) * (1 + al * 0.012); if (Math.abs(d) > wd * 3) continue;
    const fade = Math.min(1, (al + 2) / 6) * (1 - al / w.len); h += w.amp * (1 + 1.3 * Math.exp(-Math.max(al, 0) / 14)) * fade * fade * Math.exp(-(d * d) / (wd * wd)) * Math.cos(d * w.k) / Math.sqrt(1 + al * 0.02); }
  return h;
}
// the Gerstner sum at the REST point (px, py): where that water particle is now. o = [x, y, height]
function gerst(px, py, t, o) {
  let ox = 0, oy = 0, oz = 0; const s = state.sea;
  for (let i = 0; i < NW; i++) { const w = WAVES[i], ph = w.k * (w.dx * px + w.dy * py) - w.w * t, c = Math.cos(ph), sn = Math.sin(ph), a = w.A * s; ox += w.q * a * w.dx * c; oy += w.q * a * w.dy * c; oz += a * sn; }
  o[0] = px + ox; o[1] = py + oy; o[2] = oz; return o;
}
const _g = [0, 0, 0];
// the height at a fixed map point: the trochoid moves water sideways, so the rest point that is over (x, y) now is found in three steps
export function heightAt(x, y, t = state.t) {
  let px = x, py = y; for (let i = 0; i < 3; i++) { gerst(px, py, t, _g); px += x - _g[0]; py += y - _g[1]; }
  gerst(px, py, t, _g); return _g[2] + wakeH(x, y);
}
// height and slope: out.h, out.sx = dh/dx, out.sy = dh/dy (from two more heights 0.6 m away: the hull is wider than that)
export function sample(x, y, t, out) {
  const h = heightAt(x, y, t), e = 0.6; out.h = h; out.sx = (heightAt(x + e, y, t) - h) / e; out.sy = (heightAt(x, y + e, t) - h) / e; return out;
}
// the water's own horizontal speed at a point (orbital motion of the big waves): what spray and loose things drift with
export function driftAt(x, y, t, out) {
  let vx = 0, vy = 0; const s = state.sea; for (let i = 0; i < 3; i++) { const w = WAVES[i], ph = w.k * (w.dx * x + w.dy * y) - w.w * t, v = w.A * s * w.w * Math.sin(ph); vx += w.dx * v; vy += w.dy * v; } out.x = vx; out.y = vy; return out;
}

// ------------------------------------------------------------------------------------------------ the same thing for the shader
// three.js frame in the shader: p = world xz, map y = -z. Wave directions are given to it already in xz.
export function uniforms() {
  const U = { uWaT: { value: 0 }, uWaSea: { value: 1 }, uWaD: { value: [] }, uWaP: { value: [] }, uWkA: { value: [] }, uWkB: { value: [] } };
  for (const w of WAVES) { U.uWaD.value.push(w.dx, -w.dy); U.uWaP.value.push(w.k, w.w, w.A, w.q); }
  for (let i = 0; i < MAXWAKE; i++) { U.uWkA.value.push(0, 0, 1, 0); U.uWkB.value.push(0, 1, 1, 1); }
  U.uWaD.value = new Float32Array(U.uWaD.value); U.uWaP.value = new Float32Array(U.uWaP.value); U.uWkA.value = new Float32Array(U.uWkA.value); U.uWkB.value = new Float32Array(U.uWkB.value);
  return U;
}
export function updateUniforms(U, t) {
  U.uWaT.value = t; U.uWaSea.value = state.sea; const A = U.uWkA.value, B = U.uWkB.value;
  for (let i = 0; i < MAXWAKE; i++) { const w = wakes[i]; if (w && w.amp > 0) { A[i * 4] = w.x; A[i * 4 + 1] = -w.y; A[i * 4 + 2] = w.hx; A[i * 4 + 3] = -w.hy; B[i * 4] = w.amp; B[i * 4 + 1] = w.len; B[i * 4 + 2] = w.k; B[i * 4 + 3] = w.wid; } else B[i * 4] = 0; }
}
export const GLSL = /* glsl */`
#define WA_N ${NW}
#define WK_N ${MAXWAKE}
uniform float uWaT, uWaSea; uniform vec2 uWaD[WA_N]; uniform vec4 uWaP[WA_N]; uniform vec4 uWkA[WK_N]; uniform vec4 uWkB[WK_N];
// the wake of boat i at world xz p: its height
float waWake1(vec2 p, vec4 a, vec4 b) {
  if (b.x <= 0.0) return 0.0; vec2 e = p - a.xy; float al = -dot(e, a.zw); if (al < -2.0 || al > b.y) return 0.0;
  float lat = abs(-e.x * a.w + e.y * a.z), d = lat - max(al, 0.0) * ${KELVIN.toFixed(5)}, wd = b.w * (0.3 + 0.7 * min(1.0, max(al, 0.0) / 14.0)) * (1.0 + al * 0.012);
  float fade = min(1.0, (al + 2.0) / 6.0) * (1.0 - al / b.y);
  return b.x * (1.0 + 1.3 * exp(-max(al, 0.0) / 14.0)) * fade * fade * exp(-(d * d) / (wd * wd)) * cos(d * b.z) / sqrt(1.0 + al * 0.02);
}
float waWake(vec2 p) { float h = 0.0; for (int i = 0; i < WK_N; i++) h += waWake1(p, uWkA[i], uWkB[i]); return h; }
// where the water particle that rests at xz p is now: (sideways x, up, sideways z). far = distance from the eye: a wave too short for the
// mesh out there is left out of the shape (the normal still has it)
vec3 waDisp(vec2 p, float far) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < WA_N; i++) { vec4 w = uWaP[i]; float L = 6.2832 / w.x, on = 1.0 - smoothstep(L * 9.0, L * 18.0, far), ph = w.x * dot(uWaD[i], p) - w.y * uWaT, a = w.z * uWaSea * on;
    o.xz += w.w * a * uWaD[i] * cos(ph); o.y += a * sin(ph); }
  o.y += waWake(p) * (1.0 - smoothstep(250.0, 500.0, far)); return o;
}
// the slope of the surface at rest point p (d height / d x, d height / d z); fade(L) in 0..1 lets a wave of length L count
vec2 waSlope(vec2 p, float far, float px) {
  vec2 s = vec2(0.0); float den = 1.0;
  for (int i = 0; i < WA_N; i++) { vec4 w = uWaP[i]; float L = 6.2832 / w.x, on = 1.0 / (1.0 + pow(px * 3.0 / L, 2.0)), ph = w.x * dot(uWaD[i], p) - w.y * uWaT, a = w.z * uWaSea * on;
    s += uWaD[i] * (w.x * a * cos(ph)); den -= w.w * w.x * a * sin(ph); }
  s /= max(den, 0.25);
  if (far < 500.0) { float e = 0.35, h0 = waWake(p); s += vec2(waWake(p + vec2(e, 0.0)) - h0, waWake(p + vec2(0.0, e)) - h0) / e * (1.0 - smoothstep(250.0, 500.0, far)); }
  return s;
}
`;
