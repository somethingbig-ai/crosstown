// sky/wet.glsl.js: the wet-road part of the street ground and sidewalk shaders (streets/ground.js, streets/sidewalks.js; two patched lines in each).
// All of it sits behind `if (uWetK.x > 0.0)`: dry, the programs do the same arithmetic as before and one uniform test more.
// uWetK = (how wet 0..1, how much darker a wet surface is, the brightest a mirrored thing may be, rain falling now 0..1: rings in the puddles).
// What a wet surface mirrors is the game's own street cube (world.js updateStreet: the scene drawn at the eye, one face every third frame, 512 px a face),
// looked up along the mirrored ray. It is the picture glass and car paint already use: coarse, a third of a second behind, and drawn from the eye, not
// from the road, so near things sit a little wrong in it. Puddles (low-lying patches from a noise field, more of them the wetter it is) mirror cleanly;
// the damp film between them mirrors through a per-pixel scatter, longer along the line of sight, which draws lights out into streaks toward the viewer.
export const WET_DECL = /* glsl */`
uniform vec4 uWetK; uniform samplerCube tStreet; uniform float uTime;
float wtH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wtN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wtH(i), wtH(i + vec2(1.0, 0.0)), f.x), mix(wtH(i + vec2(0.0, 1.0)), wtH(i + vec2(1.0, 1.0)), f.x), f.y); }
vec2 wtRing(vec2 p, float t){ vec2 g = vec2(0.0); for (int k = 0; k < 2; k++) { vec2 q = p * (k == 0 ? 2.1 : 3.3) + float(k) * 17.0; vec2 c = floor(q); float h = wtH(c + 3.0), ph = fract(t * (0.9 + 0.5 * h) + h * 7.0); vec2 o = (vec2(wtH(c), wtH(c + 11.0)) - 0.5) * 0.5; vec2 d = fract(q) - 0.5 - o; float r = length(d); float w = sin((r - ph * 0.45) * 60.0) * smoothstep(0.06, 0.0, abs(r - ph * 0.45)) * (1.0 - ph); g += (d / max(r, 1e-3)) * w; } return g; }
`;
export const WET_MAIN = /* glsl */`
if (uWetK.x > 0.0) {
  vec2 wq = vWPos.xz; float wn1 = wtN(wq * 0.13) * 0.65 + wtN(wq * 0.41 + 7.3) * 0.35, wn2 = wtN(wq * 1.9 + 3.1);
  float pud = smoothstep(0.70 - 0.13 * uWetK.x, 0.77 - 0.13 * uWetK.x, wn1) * uWetK.x, film = uWetK.x * (0.45 + 0.55 * wn2);
  vec3 wV = normalize(cameraPosition - vWPos); vec2 fwd = normalize(wV.xz + 1e-5);
  float j1 = wtH(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5, j2 = wtH(gl_FragCoord.yx * 1.31 + fract(uTime) * 47.0) - 0.5;
  vec2 rip = wtRing(wq, uTime) * uWetK.w * 0.06 * pud;
  vec2 tilt = mix(fwd * j1 * 0.46 + vec2(-fwd.y, fwd.x) * j2 * 0.07, rip, pud);
  vec3 wN = normalize(vec3(tilt.x, 1.0, tilt.y)); vec3 wR = reflect(-wV, wN); wR.y = abs(wR.y) + 0.02;
  vec3 wC = min(textureLod(tStreet, (vWPos - cameraPosition) + wR * 70.0, 0.0).rgb, vec3(uWetK.z));
  float wF = 0.02 + 0.98 * pow(1.0 - max(dot(wV, wN), 0.0), 5.0);
  float wDk = 1.0 - uWetK.y * max(film, pud);
  reflectedLight.directDiffuse *= wDk; reflectedLight.indirectDiffuse *= wDk;
  reflectedLight.directSpecular *= 1.0 + 2.0 * film;
  reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, wC * wF * mix(0.55, 1.0, pud), max(pud, film * 0.7));
}
`;
