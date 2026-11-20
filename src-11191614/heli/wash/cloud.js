// cloud.js: the dust and spray a rotor's wash raises, as a real volume.
//   the air     wash/field.js, the same model written again in GLSL: the wake comes down, turns outward into a fast thin layer along the ground (a wall
//               jet), rolls up at its rim into a ring vortex, and in a low hover is drawn back in over the top toward the disc.
//   the dust    a density kept in a small grid that is fixed to the WORLD (96 x 96 cells of 0.6 m, 16 layers to 14 m, thin near the ground), stepped on
//               the GPU every drawn frame: each cell takes the dust from where the air brought it (so every lump, streak and front travels outward, and
//               stays behind when the aircraft leaves), loses a little, and the cells on the ground gain what the air there can lift off what lies
//               below (a small map filled from the game: loose grit on roofs, bare soil in the parks, little on paving, spray over water; walls stop it).
//               The same step works out how much of the sun reaches each cell through the dust above it: billows get a lit and a shaded side.
//   the picture one off-screen pass at a quarter of the frame's width and height: every pixel walks its view ray through the grid as far as the scene's
//               depth, breaking the density up with a finer grain, lighting it with the sun (the scene's shadow map too: tree and building shade falls
//               through it), and the result is laid over the finished scene picture, choosing low-resolution samples by depth so the aircraft, trunks
//               and walls cut it cleanly. It is a pass in the game's composer, placed after the ambient-occlusion pass, switched off whenever there is
//               nothing in the air near the camera (parked, high, far away): then it costs nothing.
// Depth: read from the composer (the AO pass's depth, or the scene target's own depth texture), with the camera's near and far taken every frame.
import * as THREE from 'three';
import { noise3D } from './dustvol.js';

const N = 96, NY = 16, CELL = 0.6, SPAN = N * CELL, GH = 14, GA = 0.3, AT = N * 4;
const f1 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const GRID = /* glsl */`
  const float GN = ${f1(N)}, GNY = ${f1(NY)}, GH = ${f1(GH)}, GA = ${f1(GA)}, SPAN = ${f1(SPAN)};
  float layerOf(float h) { float s = clamp(h / GH, 0.0, 1.0); return GNY * (-GA + sqrt(GA * GA + 4.0 * (1.0 - GA) * s)) / (2.0 * (1.0 - GA)) - 0.5; }
  float heightOf(float l) { float s = (l + 0.5) / GNY; return GH * (GA * s + (1.0 - GA) * s * s); }
  // the grid at a world point: r dust, g spray, b how much sun reaches it, a dust x tint (0 soil .. 1 grey grit). org = (least x, ground height, least z)
  vec4 grid(sampler2D t, vec3 org, vec3 p) {
    vec2 g = (p.xz - org.xz) / SPAN; float h = p.y - org.y;
    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0 || h > GH) return vec4(0.0, 0.0, 1.0, 0.0);
    float L = max(layerOf(max(h, 0.0)), 0.0), l0 = min(floor(L), GNY - 1.0), l1 = min(l0 + 1.0, GNY - 1.0);
    g = clamp(g, 0.5 / GN, 1.0 - 0.5 / GN);
    vec4 a = texture(t, (vec2(mod(l0, 4.0), floor(l0 * 0.25)) + g) * 0.25), b = texture(t, (vec2(mod(l1, 4.0), floor(l1 * 0.25)) + g) * 0.25);
    return mix(a, b, clamp(L - l0, 0.0, 1.0));
  }`;

const QUAD_V = /* glsl */`
  uniform vec4 uRect; out vec2 vNdc;
  void main() { vNdc = mix(uRect.xy, uRect.zw, position.xy * 0.5 + 0.5); gl_Position = vec4(vNdc, 0.0, 1.0); }`;

// ---------------------------------------------------------------- the step of the dust in its grid
const SIM_F = /* glsl */`
  layout(location = 0) out vec4 oC;
  uniform sampler2D tPrev; uniform sampler2D tSurf; uniform highp sampler3D tN;
  uniform vec4 uOrg; uniform vec4 uOrgP;       // the grid's corner now and at the last step (it moves in whole cells)
  uniform vec4 uF0;                            // where the wake meets the ground x, y, z; peak outwash speed U
  uniform vec4 uF1;                            // the wake's lean x, z; hub height above the ground; how much of a hover (ring vortex)
  uniform vec4 uQ;                             // dt; time; emission 0..1; rotor radius
  uniform vec4 uK;                             // dust loss per second; spray loss per second; 1 = wipe the grid; unused
  uniform vec4 uE;                             // dust lifted per second at full blow; spray; turbulence; how far the sun's light is dimmed by dust
  uniform vec3 uWind; uniform vec3 uSun; uniform vec4 uE2;      // how hard the rim's billows rise (of U); extra loss far out; 1 = there is loose dust here worth raising (0: spray only); unused
  in vec2 vNdc;
  ${GRID}
  vec3 air(vec3 p) {
    float R = uQ.w, U = uF0.w; vec2 rv = p.xz - uF0.xz; float r = length(rv) + 1e-4; vec2 e = rv / r; float hy = p.y - uF0.y, xr = r / R;
    float prof = xr < 1.0 ? xr : exp(-(xr - 1.0) / 1.3), del = 0.12 * R + 0.18 * r, gz = exp(-(hy / del) * (hy / del));
    float asym = max(0.15, 1.0 + 1.3 * dot(e, uF1.xy));
    float ur = U * prof * gz * asym, vy = 0.0;
    if (xr < 1.25 && hy < uF1.z) vy = -U * 0.55 * (1.0 - (xr / 1.25) * (xr / 1.25)) * min(1.0, hy / del);
    float a = 0.75 * R, qx = (r - 2.3 * R) / a, qy = (hy - 0.55 * R) / a, sv = U * 0.3 * max(uF1.w, 0.6) * exp(0.5 - 0.5 * (qx * qx + qy * qy));
    ur -= qy * sv; vy += qx * sv;
    vy += 0.11 * U * asym * smoothstep(1.4, 2.6, xr) * exp(-max(xr - 3.2, 0.0)) * exp(-hy / 3.0);      // (not in field.js) where the layer slows it thickens and lifts off the ground: the dust goes up with it
    return vec3(e.x * ur, vy, e.y * ur);
  }
  void main() {
    if (uK.z > 0.5) { oC = vec4(0.0, 0.0, 1.0, 0.0); return; }
    vec2 fc = gl_FragCoord.xy, tile = floor(fc / GN); float layer = tile.x + 4.0 * tile.y; vec2 g = (fc - tile * GN) / GN;
    float h = heightOf(layer), dt = uQ.x, t = uQ.y, R = uQ.w;
    vec3 p = vec3(uOrg.x + g.x * SPAN, uOrg.y + h, uOrg.z + g.y * SPAN);
    vec4 sf = texture(tSurf, g);                                   // r loose dust, g its tint, b water, a height of a wall standing here (x 25.5 m)
    if (h < sf.a * 25.5 - 0.3) { oC = vec4(0.0, 0.0, 1.0, 0.0); return; }
    // the air here: the wash, the wind, and the eddies in it (two sizes, drifting; stronger where the air is fast)
    vec3 a0 = air(p), v = a0; float sp = length(v);
    {   // the rim does not lift evenly: at a few bearings, which wander, the layer breaks away from the ground and goes up in a billow that the ring's return flow bends back over
      vec2 rv = p.xz - uF0.xz; float r = length(rv) + 1e-4, xr = r / R, A = atan(rv.y, rv.x) / 6.2831853;
      float pl = smoothstep(0.5, 0.74, texture(tN, vec3(A * 3.0 + 0.6, t * 0.085, r * 0.01 + 0.3)).r) + 0.6 * smoothstep(0.55, 0.8, texture(tN, vec3(A * 7.0, t * 0.16 + 0.5, 0.7)).g);
      v.y += uF0.w * uE2.x * pl * smoothstep(1.3, 2.1, xr) * smoothstep(3.6, 2.6, xr) * smoothstep(0.0, 0.8, h) * exp(-h / 5.0);
      v.xz *= 1.0 - 0.45 * min(pl, 1.0) * smoothstep(1.3, 2.1, xr);
    }
    vec3 n1 = texture(tN, p * 0.045 + vec3(0.013, 0.031, 0.021) * t).rgb - 0.5, n2 = texture(tN, p * 0.13 + vec3(-0.05, 0.07, 0.04) * t + 0.37).gbr - 0.5;
    vec3 tu = (n1 * 1.7 + n2 * 1.0) * (0.5 + 0.2 * sp) * uE.z; tu.y *= min(1.0, h / 0.5);
    v += tu + uWind * min(1.0, 0.35 + h / 12.0);
    vec3 pm = p - v * (0.5 * dt); pm.y = max(pm.y, uOrg.y + 0.02);
    vec3 v2 = air(pm) + (v - a0);
    vec3 q = p - v2 * dt; q.y = max(q.y, uOrg.y + 0.02);
    vec4 s = grid(tPrev, uOrgP.xyz, q);
    // loss: it settles and thins; faster at the edges and top of the grid so nothing is cut off there
    vec2 eb = min(g, 1.0 - g) * GN; float edge = smoothstep(0.0, 6.0, min(eb.x, eb.y)) * smoothstep(GH, GH * 0.75, h);
    float xrc = length(p.xz - uF0.xz) / R;
    float kd = exp(-dt * (uK.x + 4.0 * (1.0 - edge) + uE2.y * smoothstep(2.6, 4.6, xrc))), ks = exp(-dt * (uK.y + 4.0 * (1.0 - edge)));
    float dust = s.r * kd, tint = s.a * kd, spray = s.g * ks;
    // what the air lifts off the ground here: where it runs fast along the surface, in streaks and surges that keep their bearing a while
    if (h < 1.0 && uQ.z > 0.0) {
      vec2 rv = p.xz - uF0.xz; float r = length(rv) + 1e-4, xr = r / R; vec2 e = rv / r;
      float u = uF0.w * (xr < 1.0 ? xr : exp(-(xr - 1.0) / 1.3)) * max(0.15, 1.0 + 1.3 * dot(e, uF1.xy));
      float A = atan(e.y, e.x) / 6.2831853;
      float st = texture(tN, vec3(A * 5.0 + 0.2, r * 0.012 - t * 0.11, t * 0.07)).g, sg = texture(tN, vec3(p.xz * 0.16, t * 1.3)).b;
      float gust = (0.2 + 1.6 * smoothstep(0.3, 0.75, st)) * (0.12 + 2.3 * smoothstep(0.42, 0.72, sg));      // it comes off the ground in bursts a couple of metres across, half a second long: those are the lumps that are seen to travel
      float lift = smoothstep(4.0, 13.0, u) * (u / 15.0) * gust * uQ.z * exp(-h / 0.3) * dt;
      float dsrc = lift * uE.x * sf.r * uE2.z;
      dust += dsrc; tint += dsrc * sf.g; spray += lift * uE.y * sf.b * (0.5 + u / 15.0);
    }
    // the sun through the dust that lies toward it (the last step's dust: near enough)
    float tau = 0.0, sl = 0.7; vec3 ql = p;
    for (int i = 0; i < 5; i++) { ql += uSun * sl; vec4 a = grid(tPrev, uOrgP.xyz, ql); tau += (a.r + a.g) * sl; sl *= 1.45; }
    oC = vec4(dust, spray, exp(-uE.w * tau), tint);
  }`;

// ---------------------------------------------------------------- the view rays through it (a quarter of the frame each way)
const MARCH_V = /* glsl */`
  uniform sampler2D tLight; uniform vec2 uHalf; uniform vec4 uOrg;
  out vec2 vNdc; out float vSky;
  void main() { vNdc = position.xy; vec2 c = uOrg.xz + ${f1(SPAN * 0.5)};
    vSky = clamp(textureLod(tLight, vec2(c.x / (2.0 * uHalf.x) + 0.5, -c.y / (2.0 * uHalf.y) + 0.5), 0.0).r, 0.0, 1.15); gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MARCH_F = /* glsl */`
  #include <packing>
  layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oZ;
  uniform sampler2D tDepth; uniform sampler2D tA; uniform highp sampler3D tN; uniform sampler2D tShadow; uniform mat4 uShadowM; uniform float uShadowOn;
  uniform vec4 uOrg; uniform vec3 uCam; uniform vec3 uFw; uniform vec3 uRx; uniform vec3 uUy; uniform vec4 uNF;
  uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uAmb; uniform vec3 uSoil; uniform vec3 uGrit; uniform vec3 uSpray;
  uniform vec4 uM;       // steps; time; grain size (1/m); how hard the grain eats the dust
  uniform vec4 uL;       // thickness; density at which a lump is solid; extra shade inside a lump; forward glow
  uniform vec3 uFogColor; uniform float uFogDensity; uniform vec4 uF0; uniform vec4 uF1; uniform vec4 uQ;
  in vec2 vNdc; in float vSky;
  // how the air carries the grain here (the wall jet outward, a little up where it lifts): the grain is moved with it, so what is seen to move is the dust
  vec3 flow(vec3 p) { vec2 rv = p.xz - uF0.xz; float r = length(rv) + 1e-3, xr = r / uQ.w, hy = p.y - uF0.y, del = 0.12 * uQ.w + 0.18 * r;
    float ur = uF0.w * (xr < 1.0 ? xr : exp(-(xr - 1.0) / 1.3)) * exp(-(hy / del) * (hy / del)) * max(0.15, 1.0 + 1.3 * dot(rv / r, uF1.xy)) * 0.75 + 0.5;
    return vec3(rv.x / r * ur, 0.2 * ur * smoothstep(1.2, 2.4, xr), rv.y / r * ur); }
  ${GRID}
  float sunVis(vec3 p) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 sc = uShadowM * vec4(p, 1.0); sc.xyz /= sc.w;
    if (sc.x < 0.002 || sc.x > 0.998 || sc.y < 0.002 || sc.y > 0.998 || sc.z > 1.0) return 1.0;
    return step(sc.z - 0.0011, unpackRGBAToDepth(texture(tShadow, sc.xy)));
  }
  void main() {
    vec2 uv = vNdc * 0.5 + 0.5;
    float dz = texture(tDepth, uv).x, vz = uNF.x * uNF.y / (uNF.y - dz * (uNF.y - uNF.x));
    oZ = vec4(vz, 0.0, 0.0, 1.0); oC = vec4(0.0);
    vec3 dir = uFw + uRx * vNdc.x + uUy * vNdc.y; float dl = length(dir); vec3 rd = dir / dl;
    vec3 bmin = uOrg.xyz, bmax = uOrg.xyz + vec3(SPAN, GH, SPAN);
    vec3 inv = 1.0 / vec3(abs(rd.x) < 1e-5 ? 1e-5 : rd.x, abs(rd.y) < 1e-5 ? 1e-5 : rd.y, abs(rd.z) < 1e-5 ? 1e-5 : rd.z), t0 = (bmin - uCam) * inv, t1 = (bmax - uCam) * inv, tn = min(t0, t1), tf = max(t0, t1);
    float ta = max(max(tn.x, tn.y), max(tn.z, 0.05)), tb = min(min(tf.x, tf.y), min(tf.z, vz * dl));
    if (tb <= ta) return;
    float n = uM.x, ds = (tb - ta) / n, tm = uM.y;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float t = ta + ds * jit, T = 1.0, vis = 1.0, cs = dot(rd, uSun); int since = 9; vec3 C = vec3(0.0);
    float phase = 1.0 + uL.w * pow(max(cs, 0.0), 5.0) + 0.14 * max(-cs, 0.0);
    vec3 drift = vec3(0.021, -0.045, 0.013) * tm; float lod = clamp(log2(ds * uM.z * 48.0 * 0.7) - 1.0, 0.0, 3.0);
    const float TT = 0.9; float f1 = fract(tm / TT), f2 = fract(tm / TT + 0.5), w1 = 1.0 - abs(2.0 * f1 - 1.0);      // the grain no finer than the steps can follow
    for (int i = 0; i < 48; i++) {
      if (float(i) >= n || T < 0.02) break;
      vec3 p = uCam + rd * t; vec4 g = grid(tA, uOrg.xyz, p); float d = g.r + g.g;
      if (d > 0.0015) {
        // the grain: thin dust is torn into wisps by it, thick dust only dappled
        vec3 fv = flow(p), q1 = (p - fv * ((f1 - 0.5) * TT)) * uM.z + drift, q2 = (p - fv * ((f2 - 0.5) * TT)) * uM.z + drift + vec3(0.37, 0.11, 0.53);
        vec4 na = textureLod(tN, q1, lod), nb = textureLod(tN, q2, lod); float gr = 0.5 + 1.25 * (mix(0.62 * nb.r + 0.38 * nb.a, 0.62 * na.r + 0.38 * na.a, w1) - 0.5), k = clamp(d / uL.y, 0.0, 1.0);
        vec4 da = textureLod(tN, q1 * 3.3 + 0.17, lod), db = textureLod(tN, q2 * 3.3 + 0.17, lod); gr += 0.3 * (mix(db.g, da.g, w1) - 0.5) * (1.0 - 0.33 * lod);      // a finer grain on the skin of the lumps
        float lo = 0.5 - 0.2 * k - 0.05 * uM.w, dd = d * 2.0 * smoothstep(lo, lo + 0.1, gr) * uL.x;      // thin dust is torn into wisps; thick dust keeps holes and a ragged skin
        if (dd > 0.0005) {
          if (since > 0) { vis = sunVis(p + uSun * 0.3); since = 0; } since++;
          float a = 1.0 - exp(-dd * ds), sp = g.g / d, ti = clamp(g.a / max(g.r, 1e-4), 0.0, 1.0);
          vec3 alb = mix(mix(uSoil, uGrit, ti), uSpray, sp);
          // a lump's side toward the sun is lit, its far side lies in its own shade: the same grain read a little way toward the sun tells which this is
          vec4 nl = textureLod(tN, (w1 > 0.5 ? q1 : q2) + uSun * (0.9 * uM.z), lod), n0 = w1 > 0.5 ? na : nb; float lobe = clamp(0.5 + 2.4 * (0.62 * (n0.r - nl.r) + 0.38 * (n0.a - nl.a)), 0.0, 1.0);
          float sunT = (0.22 + 0.78 * g.b) * exp(-uL.z * dd) * mix(0.5, 1.25, lobe), hf = clamp((p.y - uOrg.y) / 6.0, 0.0, 1.0);
          vec3 L = uSunColor * (0.25 + 0.75 * vis) * sunT * phase + uAmb * vSky * (0.6 + 0.3 * hf + 0.1 * g.b);
          C += T * a * alb * L; T *= 1.0 - a;
        }
      }
      t += ds;
    }
    float al = 1.0 - T, fog = 1.0 - exp(-uFogDensity * 0.5 * (ta + tb));
    oC = vec4(mix(C, uFogColor * al, fog), al);
  }`;

// ---------------------------------------------------------------- laid over the scene picture
const COMP_F = /* glsl */`
  layout(location = 0) out vec4 oC;
  uniform sampler2D tC; uniform sampler2D tZ; uniform sampler2D tDepth; uniform vec4 uNF; uniform vec2 uLow; uniform float uT;
  in vec2 vNdc;
  #ifdef FULL
  uniform sampler2D tScene; uniform vec4 uBox;
  #endif
  void main() {
    vec2 uv = vNdc * 0.5 + 0.5; vec4 c;
    #ifdef FULL
    vec4 sc = texture(tScene, uv); if (vNdc.x < uBox.x || vNdc.y < uBox.y || vNdc.x > uBox.z || vNdc.y > uBox.w) { oC = sc; return; }
    #endif
    if (uNF.z < 0.5) c = texture(tC, uv);
    else {
      float dz = texture(tDepth, uv).x, z = uNF.w > 0.5 ? dz : uNF.x * uNF.y / (uNF.y - dz * (uNF.y - uNF.x)), zl = texture(tZ, uv).x;
      if (abs(zl - z) < 0.04 * z) { vec2 o = 0.5 / uLow; c = 0.25 * (texture(tC, uv + o) + texture(tC, uv - o) + texture(tC, uv + vec2(o.x, -o.y)) + texture(tC, uv + vec2(-o.x, o.y))); }
      else {      // an edge in depth: take the low-resolution samples that lie at this pixel's own depth
        vec2 st = uv * uLow - 0.5, b = floor(st), f = st - b; ivec2 hi = ivec2(uLow) - 1; c = vec4(0.0); float ws = 0.0;
        for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
          ivec2 q = clamp(ivec2(b) + ivec2(i, j), ivec2(0), hi);
          float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 0.02; w /= 0.02 * z + abs(texelFetch(tZ, q, 0).x - z);
          c += texelFetch(tC, q, 0) * w; ws += w;
        }
        c /= ws;
      }
    }
    #ifdef FULL
    oC = vec4(sc.rgb * (1.0 - c.a) + c.rgb, sc.a);
    #else
    if (c.a < 0.002) discard;
    oC = c;
    #endif
  }`;
const COPY_F = /* glsl */`
  layout(location = 0) out vec4 oC; uniform sampler2D tScene; in vec2 vNdc;
  void main() { oC = texture(tScene, vNdc * 0.5 + 0.5); }`;

// the scene's depth in metres, copied at half size: needed where the composer's own buffers share the depth texture (it cannot then be read while they are drawn into)
const ZCOPY_F = /* glsl */`
  layout(location = 0) out vec4 oC; uniform sampler2D tDepth; uniform vec4 uNF; in vec2 vNdc;
  void main() { float dz = texture(tDepth, vNdc * 0.5 + 0.5).x; oC = vec4(uNF.x * uNF.y / (uNF.y - dz * (uNF.y - uNF.x)), 0.0, 0.0, 1.0); }`;

const DEF = { steps: 44, res: 4, rise: 0.15, farLoss: 1.2, kDust: 11, kSpray: 1.6, tauD: 4.5, tauS: 1.2, turb: 0.8, shade: 0.8, grain: 0.2, eat: 1.4, thick: 1, solid: 1.0, lump: 0.6, glow: 0.9, far: 380, minSrc: 0.06, spraySteps: 14, mist: 0 };
const _v = new THREE.Vector3();

export class Cloud {
  // wash: the Wash (its surface tests, waters, wind are used); nothing is built if the composer cannot take the pass (then .ok is false)
  constructor(world, wash) {
    this.world = world; this.wash = wash; this.ok = false; this.active = false; this.mode = 0; this.P = Object.assign({}, DEF);
    try { const q = new URLSearchParams(location.search).get('wc'); if (q) for (const kv of q.split(',')) { const [k, v] = kv.split(':'); if (k in this.P && isFinite(+v)) this.P[k] = +v; } this.dbg = new URLSearchParams(location.search).has('washdbg'); } catch (e) { /* no page address: defaults */ }
    this.org = new THREE.Vector4(0, 0, 0, 0); this.orgP = new THREE.Vector4(0, 0, 0, 0); this.anch = false; this.wipe = true; this.acc = 0; this.quiet = 1e3; this.hold = 0; this.emit = 0; this.s = 0; this.t = 0; this.rr = 0; this.checked = 0;
    this.src = 0; this.srcD = 0; this.surf = new Uint8Array(N * N * 4); this.sup = new Float32Array(4096).fill(1); this.supId = new Int32Array(4096); this.supN = 0; this.viewDist = 0; this.ever = false;
    try { this.build(); this.ok = this.hook(); if (this.ok) this.mode = this.depthMode(); } catch (e) { console.log('[heli] wash: cloud not built: ' + (e && (e.stack || e.message))); this.ok = false; }
  }

  build() {
    const world = this.world, sh = world.shared, fog = world.scene.fog, P = this.P, HF = THREE.HalfFloatType;
    const rt = (w, h, count) => { const r = new THREE.WebGLRenderTarget(w, h, { type: HF, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, count: count || 1, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }); for (const t of r.textures) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; } return r; };
    this.grid = [rt(AT, AT), rt(AT, AT)]; this.gi = 0; this.low = rt(8, 8, 2);
    this.surfTex = new THREE.DataTexture(this.surf, N, N, THREE.RGBAFormat, THREE.UnsignedByteType); this.surfTex.minFilter = this.surfTex.magFilter = THREE.LinearFilter; this.surfTex.colorSpace = THREE.NoColorSpace; this.surfTex.needsUpdate = true;
    const noise = noise3D().clone(); noise.generateMipmaps = true; noise.minFilter = THREE.LinearMipmapLinearFilter; noise.needsUpdate = true;      // (its own copy, with mip levels)
    const mk = (vs, fs, uniforms, extra) => new THREE.ShaderMaterial(Object.assign({ glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false }, extra || {}));
    this.uSim = { uRect: { value: new THREE.Vector4(-1, -1, 1, 1) }, tPrev: { value: null }, tSurf: { value: this.surfTex }, tN: { value: noise }, uOrg: { value: this.org }, uOrgP: { value: this.orgP },
      uF0: { value: new THREE.Vector4() }, uF1: { value: new THREE.Vector4(0, 0, 6, 1) }, uQ: { value: new THREE.Vector4(0.016, 0, 0, 5.3) }, uK: { value: new THREE.Vector4(1 / P.tauD, 1 / P.tauS, 1, 0) },
      uE: { value: new THREE.Vector4(P.kDust, P.kSpray, P.turb, P.shade) }, uWind: { value: new THREE.Vector3() }, uSun: sh.uSunDir, uE2: { value: new THREE.Vector4(P.rise, P.farLoss, 0, 0) } };
    this.mSim = mk(QUAD_V, SIM_F, this.uSim);
    this.uMarch = { tLight: sh.tLight, uHalf: sh.uHalf, uOrg: { value: this.org }, tDepth: { value: null }, tA: { value: null }, tN: { value: noise }, tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
      uCam: { value: new THREE.Vector3() }, uFw: { value: new THREE.Vector3() }, uRx: { value: new THREE.Vector3() }, uUy: { value: new THREE.Vector3() }, uNF: { value: new THREE.Vector4(0.25, 6000, 1, 0) },
      uSun: sh.uSunDir, uSunColor: sh.uSunColor, uAmb: { value: new THREE.Vector3(0.50, 0.58, 0.72) }, uSoil: { value: new THREE.Vector3(0.62, 0.52, 0.38) }, uGrit: { value: new THREE.Vector3(0.45, 0.42, 0.37) }, uSpray: { value: new THREE.Vector3(0.82, 0.85, 0.88) },
      uM: { value: new THREE.Vector4(P.steps, 0, P.grain, P.eat) }, uL: { value: new THREE.Vector4(P.thick, P.solid, P.lump, P.glow) },
      uFogColor: { value: fog ? fog.color : new THREE.Color(0.6, 0.7, 0.8) }, uFogDensity: { value: fog ? fog.density : 0 }, uF0: this.uSim.uF0, uF1: this.uSim.uF1, uQ: this.uSim.uQ };
    this.mMarch = mk(MARCH_V, MARCH_F, this.uMarch);
    this.uComp = { uRect: { value: new THREE.Vector4(-1, -1, 1, 1) }, tC: { value: this.low.textures[0] }, tZ: { value: this.low.textures[1] }, tDepth: { value: null }, uNF: this.uMarch.uNF, uLow: { value: new THREE.Vector2(8, 8) }, uT: { value: 0 } };
    this.mComp = mk(QUAD_V, COMP_F, this.uComp, { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    // a multisampled scene buffer (film capture, stills, ?aa=msaa) cannot be blended into after it has been resolved (its samples are thrown away then, and what is
    // left under a partial draw is undefined: seen as a black block). There the scene is rewritten whole: into the other buffer with the cloud laid in, and back.
    const full = { value: new THREE.Vector4(-1, -1, 1, 1) }; this.uCompF = Object.assign({}, this.uComp, { uRect: full, tScene: { value: null }, uBox: this.uComp.uRect });
    this.mCompF = mk(QUAD_V, COMP_F, this.uCompF, { defines: { FULL: 1 } }); this.uCopy = { uRect: full, tScene: { value: null } }; this.mCopy = mk(QUAD_V, COPY_F, this.uCopy);
    this.zc = rt(8, 8); this.zc.texture.minFilter = this.zc.texture.magFilter = THREE.NearestFilter; this.uZ = { uRect: this.uComp.uRect, tDepth: { value: null }, uNF: this.uMarch.uNF }; this.mZ = mk(QUAD_V, ZCOPY_F, this.uZ);
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mSim); this.quad.frustumCulled = false; this.scene.add(this.quad);
  }

  // into the game's composer, after the ambient-occlusion pass (its depth is this frame's); false if the composer is not as expected
  hook() {
    const world = this.world, comp = world.composer; if (!comp || !comp.passes || !comp.insertPass) return false;
    const gi = world.gtao ? comp.passes.indexOf(world.gtao) : -1, self = this;
    this.pass = { enabled: false, needsSwap: false, clear: false, renderToScreen: false, isHeliWashCloud: true,
      setSize(w, h) { self.setSize(w, h); }, dispose() {},
      render(r, wb, rb) { const rt = r.getRenderTarget(), ac = r.autoClear; try { self.render(r, wb, rb); } catch (e) { self.ok = false; self.active = this.enabled = false; r.setRenderTarget(rt); r.autoClear = ac; console.log('[heli] wash: cloud pass threw and is switched off: ' + (e && (e.stack || e.message))); if (self.dbg) setTimeout(() => { throw e; }, 0); } } };
    comp.insertPass(this.pass, gi >= 0 ? gi + 1 : 1);
    const s = world.renderer.getDrawingBufferSize(new THREE.Vector2()); this.setSize(comp.readBuffer ? comp.readBuffer.width : s.x, comp.readBuffer ? comp.readBuffer.height : s.y);
    return true;
  }
  setSize(w, h) { const k = Math.max(2, this.P.res), lw = Math.max(8, Math.round(w / k)), lh = Math.max(8, Math.round(h / k)); if (this.low.width !== lw || this.low.height !== lh) this.low.setSize(lw, lh); const zw = Math.max(8, Math.round(w / 2)), zh = Math.max(8, Math.round(h / 2)); if (this.zc.width !== zw || this.zc.height !== zh) this.zc.setSize(zw, zh); this.uComp.uLow.value.set(lw, lh); }

  // which depth this frame's picture can be cut by: 2 = the AO pass's (full use), 1 = the scene target's own (rays only), 0 = none (no cloud: the caller draws its fallback)
  depthMode() { const w = this.world, g = w.gtao; if (g && g.enabled !== false && g.depthTexture) return 2; const rb = w.composer && w.composer.readBuffer; return rb && rb.depthTexture ? 1 : 0; }

  // ---- what lies on the ground, cell by cell
  bare(x, y) {      // the lawn shader's own bare patches (streets/ground.js FS_GRASS), so the soil that shows is the soil that blows
    let a = 0.5, s = 0, px = x * 0.13 + 40, py = y * 0.13 + 40;
    for (let i = 0; i < 4; i++) { const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const h00 = gh21(ix, iy), h10 = gh21(ix + 1, iy), h01 = gh21(ix, iy + 1), h11 = gh21(ix + 1, iy + 1); s += a * (h00 + (h10 - h00) * fx + (h01 - h00) * fy + (h00 - h10 - h01 + h11) * fx * fy); px = px * 2.03 + 17.1; py = py * 2.03 + 17.1; a *= 0.5; }
    return Math.min(1, Math.max(0, (s - 0.62) / 0.12));
  }
  cell(i, j, deplete) {
    const W = this.wash, x = this.org.x + (i + 0.5) * CELL, z = this.org.z + (j + 0.5) * CELL, y0 = this.org.y, S = this.surf, o = (j * N + i) * 4;
    for (const w of W.waters) { const dx = x - w.x, dz = z - w.zt; if (dx * dx + dz * dz < w.radius * w.radius && dx * dx + dz * dz >= w.hole * w.hole && Math.abs(w.level - y0) < 2.5) { S[o] = 0; S[o + 1] = 255; S[o + 2] = 255; S[o + 3] = 0; return; } }
    const top = W.groundAt(x, z, y0 + 2.5), d = top - y0;
    if (d > 0.7) { S[o] = 0; S[o + 1] = 255; S[o + 2] = 0; S[o + 3] = Math.min(255, Math.round(d * 10)); return; }
    if (d < -0.9) { S[o] = S[o + 2] = S[o + 3] = 0; S[o + 1] = 255; return; }
    let amt, tint, kind;
    if (top > 2.5) { kind = 2; const n = vn(x * 0.11 + 3.1, z * 0.11 + 7.7), n2 = vn(x * 0.37, z * 0.37 + 5); amt = 0.012 + 0.05 * n * n2 * 2; tint = 0.9; }                 // a city roof: swept by every wind there is; a trace of grit where water has stood
    else if (W.inPark(x, -z)) { kind = 1; const b = this.bare(x, -z); amt = 0.004 + 0.3 * b; tint = 0.12 + 0.2 * (1 - b); }                                          // a park: bare soil blows (thinly: it is trodden hard), grass holds everything
    else { kind = 0; amt = 0.02 * (0.5 + vn(x * 0.2, z * 0.2)); tint = 1; }                                                                                          // paving: a little grit, soon gone
    const ix = Math.floor(x / 3), iz = Math.floor(z / 3), si = ((ix & 63) << 6) | (iz & 63), id = (ix * 73856093) ^ (iz * 19349663);
    if (this.supId[si] !== id) { this.supId[si] = id; this.sup[si] = 1; }
    const sup = this.sup[si]; if (deplete) this.sup[si] = Math.max(SUP_MIN[kind], sup - SUP_RATE[kind]);
    S[o] = Math.round(255 * Math.min(1, amt * sup)); S[o + 1] = Math.round(255 * tint); S[o + 2] = 0; S[o + 3] = 0;
  }
  fill(step) { for (let j = 0; j < N; j += step) for (let i = 0; i < N; i += step) { this.cell(i, j, false); if (step > 1) { const S = this.surf, o = (j * N + i) * 4; for (let b = 0; b < step; b++) for (let a = 0; a < step; a++) if ((a || b) && i + a < N && j + b < N) { const q = ((j + b) * N + i + a) * 4; S[q] = S[o]; S[q + 1] = S[o + 1]; S[q + 2] = S[o + 2]; S[q + 3] = S[o + 3]; } } } this.surfTex.needsUpdate = true; }
  // the grid follows the aircraft in whole cells; the map of the ground is slid with it and its new edge filled
  follow(cx, cz) {
    const ox = Math.round((cx - SPAN / 2) / CELL) * CELL, oz = Math.round((cz - SPAN / 2) / CELL) * CELL, di = Math.round((ox - this.org.x) / CELL), dj = Math.round((oz - this.org.z) / CELL);
    if (!di && !dj) return; this.org.x = ox; this.org.z = oz;
    if (Math.abs(di) >= N || Math.abs(dj) >= N) { this.fill(2); return; }
    const S = this.surf, T = (this._tmp || (this._tmp = new Uint8Array(N * N * 4))); T.set(S);
    for (let j = 0; j < N; j++) { const sj = j + dj; for (let i = 0; i < N; i++) { const si = i + di, o = (j * N + i) * 4; if (si >= 0 && si < N && sj >= 0 && sj < N) { const q = (sj * N + si) * 4; S[o] = T[q]; S[o + 1] = T[q + 1]; S[o + 2] = T[q + 2]; S[o + 3] = T[q + 3]; } else this.cell(i, j, false); } }
    this.surfTex.needsUpdate = true;
  }

  // ---- every fixed step. fl: the wash field; strength 0..1
  step(dt, fl, strength) {
    if (!this.ok) return; const W = this.wash; this.acc = Math.min(0.5, this.acc + dt); this.t += dt;
    let emit = fl.on && strength > 0 && this.viewDist < this.P.far ? strength : 0;
    if (emit > 0) {
      let y0 = fl.cy; if (y0 < 1.5 && W.lawnY > y0 && W.inPark(fl.cx, -fl.cz)) y0 = W.lawnY;
      const jump = Math.abs(fl.cx - (this.org.x + SPAN / 2)) + Math.abs(fl.cz - (this.org.z + SPAN / 2)) > SPAN * 0.7;
      if (!this.anch || jump || Math.abs(y0 - this.org.y) > 1.2) {
        if (this.anch && !jump && this.quiet < 9 && this.hold < 1.6) { this.hold += dt; emit = 0; }      // the surface under the wake changed height (a roof's edge): let what hangs over the old one thin first
        else { this.org.y = y0; this.org.x = Math.round((fl.cx - SPAN / 2) / CELL) * CELL; this.org.z = Math.round((fl.cz - SPAN / 2) / CELL) * CELL; this.orgP.copy(this.org); this.anch = true; this.wipe = true; this.hold = 0; this.fill(2); }
      } else this.hold = 0;
      if (emit > 0) { this.follow(fl.cx, fl.cz);
        if ((this.srcN = (this.srcN || 0) + 1) % 20 === 1) { const S = this.surf, c = N / 2, rr = Math.min(c - 1, Math.round(2.6 * fl.R / CELL)); let d = 0, w = 0, n = 0;
          for (let j = -rr; j <= rr; j += 3) for (let i = -rr; i <= rr; i += 3) { if (i * i + j * j > rr * rr) continue; const o = ((c + j) * N + c + i) * 4; d += S[o]; w += S[o + 2] > 0 ? 1 : 0; n++; }
          this.srcD = d / (255 * n); this.src = Math.max(this.srcD, w > 0 && this.P.mist > 0 ? 1 : 0); }      // (water alone no longer switches the pass on: its thin mist cost 1.15 to 1.5 ms on the M1 Pro and read as 'one soft sprite'; ?wc=mist:1 brings it back)
        if (this.src < this.P.minSrc) emit = 0;       // a clean roof, a lawn, swept paving: nothing to raise, and nothing is drawn or paid for
        else { this.quiet = 0; this.ever = true; } }
    }
    if (emit <= 0) this.quiet += dt;
    this.emit = emit; this.s += (emit - this.s) * Math.min(1, dt * (emit > this.s ? 1.4 : 0.3));
    const U = this.uSim; if (fl.on) { U.uF0.value.set(fl.cx, this.org.y, fl.cz, Math.abs(fl.cy - this.org.y) < 1.5 || emit > 0 ? fl.U : 0); U.uF1.value.set(fl.lx, fl.lz, fl.h, fl.hov); } else U.uF0.value.w = 0;
    U.uQ.value.w = fl.R; U.uWind.value.set(W.wx * 0.6, 0, W.wz * 0.6);
    if (this.anch && this.quiet < 12) {      // keep the map of the ground fresh a few cells at a time; where the air is scouring, the loose dust runs down
      const R = fl.R, cx = fl.cx - this.org.x, cz = fl.cz - this.org.z;
      for (let k = 0; k < 150; k++) { const q = this.rr = (this.rr + 7919) % (N * N), i = q % N, j = (q / N) | 0, r = Math.hypot((i + 0.5) * CELL - cx, (j + 0.5) * CELL - cz) / R; this.cell(i, j, emit > 0 && r > 0.6 && r < 2.6); }
      this.surfTex.needsUpdate = true;
      if ((this.supN++ & 31) === 0) { const s = this.sup; for (let i = 0; i < 4096; i++) s[i] += (1 - s[i]) * 0.012; }
    }
  }

  // ---- every drawn frame, before the scene is drawn: is there anything in the air near the camera, and can the picture be cut by depth?
  update(cam, t) {
    if (!this.ok) return;
    const cx = this.org.x + SPAN / 2, cz = this.org.z + SPAN / 2; this.viewDist = this.anch ? Math.hypot(cam.position.x - cx, cam.position.y - this.org.y, cam.position.z - cz) : 0;
    this.mode = this.depthMode();
    if (this.quiet >= 11 && this.ever) { this.ever = false; this.wipe = true; }      // long since anything was raised: what is left is too thin to see; start clean next time
    this.active = this.pass.enabled = !this.off && this.anch && this.ever && this.viewDist < this.P.far && this.mode > 0;
    this.uMarch.uM.value.y = t; this.uComp.uT.value = t;
  }
  // a parked aircraft is not stepped: nothing new is raised, what hangs in the air thins
  idle(dt) { this.emit = 0; this.quiet += dt; this.acc = Math.min(0.5, this.acc + dt); this.t += dt; this.s *= Math.max(0, 1 - dt * 0.3); this.uSim.uF0.value.w = 0; }
  // the grid's box on the screen (the picture is only laid where it can be); false if it is off the screen
  bounds(cam) {
    let x0 = 1, y0 = 1, x1 = -1, y1 = -1, behind = false; const o = this.org;
    for (let k = 0; k < 8; k++) { _v.set(o.x + (k & 1 ? SPAN : 0), o.y + (k & 2 ? GH : -0.2), o.z + (k & 4 ? SPAN : 0)).applyMatrix4(cam.matrixWorldInverse);
      if (_v.z > -cam.near) { behind = true; continue; } _v.applyMatrix4(cam.projectionMatrix); x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); }
    if (behind) { x0 = y0 = -1; x1 = y1 = 1; } else { x0 = Math.max(-1, x0 - 0.01); y0 = Math.max(-1, y0 - 0.01); x1 = Math.min(1, x1 + 0.01); y1 = Math.min(1, y1 + 0.01); if (x1 <= x0 || y1 <= y0) return false; }
    this.uComp.uRect.value.set(x0, y0, x1, y1); return true;
  }

  // ---- the pass itself (called by the composer after the scene and its AO are drawn)
  render(r, wb, rb) {
    if (!this.active) return;
    const world = this.world, cam = world.camera, g = world.gtao, P = this.P, full = g && g.enabled !== false && g.depthTexture ? g.depthTexture : null, depth = full || rb.depthTexture; if (!depth) return;
    const oldRT = r.getRenderTarget(), oldAC = r.autoClear; r.autoClear = false;
    const US = this.uSim, UM = this.uMarch, UC = this.uComp, q = this.quad;
    // the dust's own step: as many as the time since the last drawn frame needs (one, in live play)
    const n = Math.max(1, Math.min(6, Math.ceil(this.acc / 0.034))), dt = this.acc / n; this.acc = 0;
    US.uK.value.set(1 / P.tauD + (this.quiet > 3 ? 0.35 : 0), 1 / P.tauS, 0, 0); US.uE.value.set(P.kDust, P.kSpray, P.turb, P.shade); US.uE2.value.set(P.rise, P.farLoss, this.srcD >= P.minSrc ? 1 : 0, 0); q.material = this.mSim; US.tPrev.value = null;
    if (this.wipe) { US.uK.value.z = 1; for (let k = 0; k < 2; k++) { r.setRenderTarget(this.grid[k]); r.render(this.scene, this.cam); } US.uK.value.z = 0; this.wipe = false; this.orgP.copy(this.org); }
    for (let k = 0; k < n; k++) {
      US.uQ.value.x = dt; US.uQ.value.y = this.t - dt * (n - 1 - k); US.uQ.value.z = this.emit;
      US.tPrev.value = this.grid[this.gi].texture; this.gi ^= 1; r.setRenderTarget(this.grid[this.gi]); r.render(this.scene, this.cam); this.orgP.copy(this.org);
    }
    if (!this.bounds(cam)) { r.setRenderTarget(oldRT); r.autoClear = oldAC; return; }
    // the rays
    const e = cam.matrixWorld.elements, th = Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1), lod = this.viewDist > 150 ? 0.6 : 1;
    UM.uCam.value.copy(cam.position); UM.uFw.value.set(-e[8], -e[9], -e[10]); UM.uRx.value.set(e[0], e[1], e[2]).multiplyScalar(th * cam.aspect); UM.uUy.value.set(e[4], e[5], e[6]).multiplyScalar(th);
    // Matt's link, eye in the cabin: the aircraft is drawn last in a pass of its own that clears the depth first (world.nearPass, near 0.1 m), so the depth then holds
    // only the cabin, in that camera's planes: read it so (the cabin still cuts the cloud; the city behind it cannot, and the grid's own walls and ground stand in)
    const nc = world.nearPass && world.nearPass.enabled && world.nearCam ? world.nearCam : cam;
    UM.uNF.value.set(nc.near, nc.far, full ? 1 : 0, 0); UM.tDepth.value = depth; UM.tA.value = this.grid[this.gi].texture;
    UM.uM.value.x = Math.round((this.srcD >= P.minSrc ? P.steps : P.spraySteps) * lod);      // a thin mist off water alone needs a third of the steps a dust cloud does UM.uM.value.z = P.grain; UM.uM.value.w = P.eat; UM.uL.value.set(P.thick, P.solid, P.lump, P.glow);
    const sun = world.sun; if (sun && sun.shadow && sun.shadow.map) { UM.tShadow.value = sun.shadow.map.texture; UM.uShadowM.value.copy(sun.shadow.matrix); UM.uShadowOn.value = 1; } else UM.uShadowOn.value = 0;
    q.material = this.mMarch; r.setRenderTarget(this.low); r.render(this.scene, this.cam);
    // over the scene
    const own = rb.depthTexture, shared = !full || (own && (own === full || own.source === full.source));      // would reading the depth while drawing into this buffer be reading its own attachment?
    if (shared) { this.uZ.tDepth.value = depth; q.material = this.mZ; r.setRenderTarget(this.zc); r.render(this.scene, this.cam); UC.tDepth.value = this.zc.texture; UM.uNF.value.z = 1; UM.uNF.value.w = 1; } else { UC.tDepth.value = full; UM.uNF.value.w = 0; }
    if (rb.samples > 0) { this.uCompF.tScene.value = rb.texture; q.material = this.mCompF; r.setRenderTarget(wb); r.render(this.scene, this.cam); this.uCopy.tScene.value = wb.texture; q.material = this.mCopy; r.setRenderTarget(rb); r.render(this.scene, this.cam); }
    else { q.material = this.mComp; r.setRenderTarget(rb); r.render(this.scene, this.cam); }
    r.setRenderTarget(oldRT); r.autoClear = oldAC;
    if (this.dbg && (this.checked++ === 30 || this.checked === 500)) this.check(r);
  }
  // ?washdbg: a shader that did not compile is thrown as a page error, so a frame run reports it
  check(r) { const g = this.world.gtao, info = 'wash cloud info: mode ' + this.mode + ' s ' + this.s.toFixed(2) + ' y0 ' + this.org.y.toFixed(2) + ' surf ' + (() => { let d = 0, w = 0, so = 0; for (let i = 0; i < this.surf.length; i += 4) { d += this.surf[i]; w += this.surf[i + 2] > 0; so += this.surf[i + 3] > 0; } return (d / (N * N)).toFixed(1) + '/' + w + '/' + so; })() + ' org ' + this.org.x.toFixed(1) + ',' + this.org.z.toFixed(1) + ' F0 ' + this.uSim.uF0.value.toArray().map((v) => v.toFixed(1)).join(',') + ' F1 ' + this.uSim.uF1.value.toArray().map((v) => v.toFixed(2)).join(',') + ' emit ' + this.emit.toFixed(2) + ' quiet ' + this.quiet.toFixed(1) + ' dist ' + this.viewDist.toFixed(0) + ' U ' + this.uSim.uF0.value.w.toFixed(1) + ' near ' + this.world.camera.near + ' depth ' + (g && g.depthTexture ? g.depthTexture.format + '/' + g.depthTexture.type + '/' + g.depthTexture.image.width : 'none') + ' low ' + this.low.width + 'x' + this.low.height + ' gtao ' + !!(g && g.enabled !== false) + ' aoDepth ' + !!this.world.aoDepth + ' passes ' + this.world.composer.passes.length; setTimeout(() => { throw new Error(info); }, 0);
    for (const m of [this.mSim, this.mMarch, this.mComp]) { const p = r.properties.get(m).currentProgram, d = p && p.diagnostics; if (d && !d.runnable) setTimeout(() => { throw new Error('wash cloud shader: ' + (d.programLog || '') + ' | ' + (d.fragmentShader && d.fragmentShader.log || '') + ' | ' + (d.vertexShader && d.vertexShader.log || '')); }, 0); } }
}
const SUP_MIN = [0.25, 0.55, 0.7], SUP_RATE = [0.012, 0.004, 0.002];
const fr = (v) => v - Math.floor(v);
// the ground shader's hash (streets/ground.js gh21), in single precision as the GPU works it
function gh21(x, y) { const f = Math.fround; let a = fr(f(x * 0.1031)), b = fr(f(y * 0.1031)), c = a; const d = f(a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)); a = f(a + d); b = f(b + d); c = f(c + d); return fr(f((a + b) * c)); }
function vn(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = gh21(ix, iy), b = gh21(ix + 1, iy), c = gh21(ix, iy + 1), d = gh21(ix + 1, iy + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
