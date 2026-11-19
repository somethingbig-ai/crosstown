// sky/wet.glsl.js: the wet-road part of the street ground and sidewalk shaders (streets/ground.js, streets/sidewalks.js; three patched lines in each).
// All of it sits behind `if (uWetK.x > 0.0)`: dry, the programs do the same arithmetic as before and one uniform test more.
// uWetK = (how wet 0..1, how much darker a wet surface is, the brightest a mirrored thing may be, rain falling now 0..1: rings in the puddles).
// light lane, Nov 14 (rain round 2, "the rain looks kind of fake"), from photographs of wet Manhattan streets (lanes/light/rain/ref):
//  - a wet road is DARK (near black where it mirrors nothing) and its shine is a grain of small sharp glints, not a pale sheet: the scatter of the
//    damp film is now a noise fixed to the road (cells a little bigger than a pixel, two sizes blended as the road recedes), not a per-frame screen dither;
//  - standing water lies in broad shallow patches and mirrors cleanly; rings where drops land;
//  - every lamp draws a streak on the road toward the viewer: WET_U carries up to WET_NL lamps (street lamp heads, head and tail lamps of the
//    nearest cars; sky/rain.js fills them), each drawn as a lobe that is narrow across the line of sight and long along it. In a puddle it is the
//    lamp's small sharp image, on the damp film a long broken streak.
// What a wet surface mirrors otherwise is still the game's own street cube (world.js updateStreet: coarse, a third of a second late, drawn from the eye).
// ?rain2=0 gives back the rain as it was before this work, exactly: sky/wet1.glsl.js and sky/rain1.js are that code, byte for byte.
import * as W1 from './wet1.glsl.js';
// lead, Nov 15: the public build can hold rain 2 back (PUBLIC_RAIN2=0 in tools/public_build.sh -> __CFG.rain2 = 0; CHIEF 04:15: public waits for light's weak-GPU check); ?rain2=1 shows it there
export const RAIN2 = (() => { if (typeof location === 'undefined') return true; const q = new URLSearchParams(location.search).get('rain2'); if (q === '0') return false; if (q === '1') return true; return !(typeof window !== 'undefined' && window.__CFG && window.__CFG.rain2 === 0); })();
export const WET_NL = 10;
export const WET_U = { uWetLP: { value: new Float32Array(WET_NL * 4) }, uWetLC: { value: new Float32Array(WET_NL * 4) }, uWetLN: { value: 0 } };      // lamp xyz + source radius; lamp rgb; how many
const DECL2 = /* glsl */`
uniform vec4 uWetK; uniform samplerCube tStreet; uniform float uTime;
uniform vec4 uWetLP[${WET_NL}]; uniform vec4 uWetLC[${WET_NL}]; uniform float uWetLN;
float wtH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wtN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wtH(i), wtH(i + vec2(1.0, 0.0)), f.x), mix(wtH(i + vec2(0.0, 1.0)), wtH(i + vec2(1.0, 1.0)), f.x), f.y); }
vec2 wtG(vec2 p){ return vec2(wtN(p), wtN(p.yx + 19.7)) - 0.5; }
vec2 wtRing(vec2 p, float t){ vec2 g = vec2(0.0); for (int k = 0; k < 2; k++) { vec2 q = p * (k == 0 ? 2.1 : 3.3) + float(k) * 17.0; vec2 c = floor(q); float h = wtH(c + 3.0), ph = fract(t * (0.9 + 0.5 * h) + h * 7.0); vec2 o = (vec2(wtH(c), wtH(c + 11.0)) - 0.5) * 0.5; vec2 d = fract(q) - 0.5 - o; float r = length(d); float w = sin((r - ph * 0.45) * 60.0) * smoothstep(0.06, 0.0, abs(r - ph * 0.45)) * (1.0 - ph); g += (d / max(r, 1e-3)) * w; } return g; }
`;
const MAIN2 = /* glsl */`
if (uWetK.x > 0.0) {
  vec2 wq = vWPos.xz; vec3 wTo = cameraPosition - vWPos; float wD = length(wTo); vec3 wV = wTo / max(wD, 1e-3);
  float wUp = smoothstep(0.55, 0.9, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));      // water lies on what faces up (a kerb face is only damp)
  float wn1 = wtN(wq * 0.11) * 0.55 + wtN(wq * 0.37 + 7.3) * 0.30 + wtN(wq * 1.7 + 3.1) * 0.15, wth = 0.70 - 0.10 * uWetK.x, wvar = 0.35 + 0.65 * wtN(wq * 0.83 + 41.0);
  float pud = smoothstep(wth, wth + 0.075, wn1) * smoothstep(0.2, 0.75, uWetK.x) * wUp;
  float wpx = min(length(dFdx(wq)), length(dFdy(wq))), lv = log2(max(wpx * 112.0, 1.0)), l0 = floor(lv), s0 = 70.0 / exp2(l0);
  vec2 gr = mix(wtG(wq * s0), wtG(wq * s0 * 0.5), lv - l0);
  float glint = wtH(floor(wq * s0 * 1.3) + 5.0); glint *= glint;
  vec2 rip = wtRing(wq, uTime) * uWetK.w * 0.05;
  vec2 tilt = mix(gr * (0.09 * (0.45 + 0.55 * smoothstep(0.04, 0.30, wV.y))), gr * 0.03 + rip, pud);      /* pass 8: less scatter at grazing angles (far road by day was salt-and-pepper speckle where sky meets building in the mirror) */
  vec3 wN = normalize(vec3(tilt.x, 1.0, tilt.y)); vec3 wR = reflect(-wV, wN); wR.y = abs(wR.y) + 0.02;
  vec3 wC = min(textureLod(tStreet, (vWPos - cameraPosition) + wR * 70.0, 0.0).rgb, vec3(uWetK.z));
  float wF = 0.02 + 0.98 * pow(1.0 - max(dot(wV, wN), 0.0), 5.0), wF0 = 0.02 + 0.98 * pow(1.0 - max(wV.y, 0.0), 5.0);
  float wbk = smoothstep(0.30, 0.72, wtN(wq * vec2(1.1, 1.3) + 23.0) * 0.6 + wtN(wq * 4.3 + 5.0) * 0.4);      /* pass 6: the road's own patchiness (worn, patched, coarser asphalt) breaks every streak into pieces */
  float wDk = 1.0 - uWetK.y * uWetK.x * (0.80 + 0.22 * smoothstep(0.30, 0.62, wn1) + 0.2 * pud);      /* pass 6: soaked patches darker than damp ones */
  reflectedLight.directDiffuse *= wDk; reflectedLight.indirectDiffuse *= wDk;
  reflectedLight.directSpecular *= 1.0 + 2.0 * uWetK.x;
  vec3 wS = wC * wF * mix(0.5 * wvar, 1.0, pud);
  if (uWetLN > 0.0) {
    vec3 R0 = vec3(-wV.x, wV.y, -wV.z); vec2 hR = normalize(R0.xz + 1e-5); vec3 acc = vec3(0.0);
    float sa = (0.004 + 0.022 * R0.y) * (0.7 + 0.9 * glint), seN = 0.50, seF = 0.40;      /* one narrow streak from under the lamp toward the eye, the same on film and puddle (critic 1: no ovals, no pillars) */
    for (int i = 0; i < ${WET_NL}; i++) { if (float(i) >= uWetLN) break;
      vec3 Lv = uWetLP[i].xyz - vWPos; Lv.y = abs(Lv.y) + 0.05; float ld = length(Lv); vec3 l = Lv / ld; float lh = length(l.xz); vec2 hl = l.xz / max(lh, 1e-4);
      float az = (hR.x * hl.y - hR.y * hl.x) * lh, el = l.y - R0.y, wsz = min(uWetLP[i].w / ld, 0.012), sA = sa + wsz, sE = (el < 0.0 ? seN : seF) + wsz;
      acc += uWetLC[i].rgb * (exp(-az * az / (sA * sA) - el * el / (sE * sE)) * step(0.0, dot(hR, hl)) * min(uWetLN - float(i), 1.0) / (1.0 + ld * ld * 0.0004)); }      /* uWetLN may be a fraction: the last lobe fades as sky/rain.js moves the count (the low-tier cap) */
    acc /= 1.0 + 0.8 * max(acc.r, max(acc.g, acc.b));      /* pass 7, 8 (0.45 -> 0.8): no blown solid spear right under a headlamp; the road's grain shows through the brightest part */
    wS += acc * wF0 * mix((0.10 + 1.9 * glint) * (0.12 + 1.25 * wbk) * (0.5 + 0.5 * wvar), 0.8, pud);
  }
  reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, wS, max(pud, 0.8 * wUp) * uWetK.x);
}
`;
export const WET_DECL = RAIN2 ? DECL2 : W1.WET_DECL, WET_MAIN = RAIN2 ? MAIN2 : W1.WET_MAIN;
