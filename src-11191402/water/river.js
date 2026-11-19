// water/river.js (water lane, Nov 15): the rivers' surface. The tiles lane's water.js owns WHERE the water is (city.water polygons, the sea wall, the
// solid shore) and keeps doing so; this file only draws the surface differently. With it on, the flat 'water' meshes of streets/water.js are hidden and
// ONE mesh that follows the camera is drawn in their place: a square grid, 1 m cells round the eye growing to the horizon, whose corners are moved by
// the wave function of waves.js (the same numbers the boats float on). Where the water is comes from a picture made once at load from the polygons
// (minus the far banks' land): a distance-to-shore field, 2048 x 2048 over the rivers' box. The shader throws away what is more than a few metres
// inland of it and the land's own geometry hides the rest (the surface writes no depth and is drawn after every solid thing, as before).
// Look: Fresnel mirror of the game's live street cube (sky, skyline), the sun's glitter, a deep green-grey body colour lit by the sky, foam at the
// shore, on steep crests and in wakes, the scene's haze. ?water=0 = the tiles lane's water as it was.
import * as THREE from 'three';
import * as WV from './waves.js';

import { RANGE } from './field.js';
// ---- small ripples: a tileable normal picture made from 48 random sine trains (no file)
function rippleTexture() {
  // red, green: the slope of a ripple field in x and y, blue: its height; each divided by 4 x its own root-mean-square (so a byte holds +-4 sigma), tileable
  const n = 256, D = new Uint8Array(n * n * 4), W = [], GX = new Float32Array(n * n), GY = new Float32Array(n * n), HH = new Float32Array(n * n); let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 64; i++) { const a = rnd() * Math.PI * 2, m = 2 + Math.floor(rnd() * rnd() * 34), kx = Math.round(Math.cos(a) * m), ky = Math.round(Math.sin(a) * m); if (!kx && !ky) continue; W.push([kx, ky, rnd() * 6.283, 1 / Math.pow(Math.hypot(kx, ky), 1.25)]); }
  let sg = 0, sh = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let gx = 0, gy = 0, hh = 0; for (const w of W) { const ph = (x * w[0] + y * w[1]) / n * 6.283185 + w[2], c = Math.cos(ph) * w[3]; gx += c * w[0]; gy += c * w[1]; hh += Math.sin(ph) * w[3]; } const i = y * n + x; GX[i] = gx; GY[i] = gy; HH[i] = hh; sg += gx * gx + gy * gy; sh += hh * hh; }
  const rg = Math.sqrt(sg / (2 * n * n)) || 1, rh = Math.sqrt(sh / (n * n)) || 1, B = (v) => Math.max(0, Math.min(255, Math.round(127.5 + v * 31.875)));
  for (let i = 0; i < n * n; i++) { D[i * 4] = B(GX[i] / rg); D[i * 4 + 1] = B(GY[i] / rg); D[i * 4 + 2] = B(HH[i] / rh); D[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(D, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}
// ---- the grid: cell 1 m to 40 m from the centre, then 8% wider a step, to past the far plane
function gridGeometry() {
  const half = []; let x = 0, c = 1; half.push(0); while (x < 6400) { x += c; half.push(x); if (x >= 40) c *= 1.08; }
  const ax = []; for (let i = half.length - 1; i > 0; i--) ax.push(-half[i]); for (const v of half) ax.push(v);
  const n = ax.length, P = new Float32Array(n * n * 3), I = new Uint32Array((n - 1) * (n - 1) * 6); let o = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { P[o++] = ax[i]; P[o++] = 0; P[o++] = ax[j]; } o = 0;
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; I[o++] = a; I[o++] = d; I[o++] = b; I[o++] = b; I[o++] = d; I[o++] = e; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); return g;
}

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
${WV.GLSL}
uniform vec3 uRvC; uniform float uRvLevel; uniform vec4 uRvBox; uniform sampler2D tRvField;
varying vec3 vRvW; varying vec2 vRvRest; varying float vRvFar; varying float vRvShore;
void main() {
  vec2 rest = position.xz + uRvC.xz; float far = length(position.xz);
  // metres to the shore (+ water): close to it the waves die down, as against a wall they slop instead of running
  vec2 fuv = (vec2(rest.x, -rest.y) - uRvBox.xy) / uRvBox.zw; float sd = (texture2D(tRvField, clamp(fuv, 0.001, 0.999)).r * 2.0 - 1.0) * ${RANGE.toFixed(1)};
  float calm = mix(0.35, 1.0, smoothstep(0.0, 26.0, sd));
  vec3 d = waDisp(rest, far) * calm;
  vec3 w = vec3(rest.x + d.x, uRvLevel + d.y, rest.y + d.z);
  vRvW = w; vRvRest = rest; vRvFar = far; vRvShore = sd;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
${WV.GLSL}
uniform vec3 uSunDir, uSunColor; uniform samplerCube tStreet; uniform sampler2D tRvField, tRvRip; uniform vec4 uRvBox; uniform float uRvCube, uRvFoam; uniform vec3 uRvDeep, uRvSky;
uniform vec4 uRvTrail[4]; uniform vec4 uRvHull[4]; uniform vec2 uRvHullH[4];
uniform vec4 uRvRing[8]; uniform vec4 uRvSwim; uniform vec2 uRvSwimH;      /* Nov 16 (Matt: swimming "does not look super real"): rings thrown by a swimmer's hands, kicks and plunge (x, three z, start time, strength), and the swimmer himself (x, three z, speed, on) with his heading */
varying vec3 vRvW; varying vec2 vRvRest; varying float vRvFar; varying float vRvShore;
float rvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rvNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rvHash(i), rvHash(i + vec2(1, 0)), f.x), mix(rvHash(i + vec2(0, 1)), rvHash(i + vec2(1, 1)), f.x), f.y); }
vec3 rvSky(vec3 r) { r.y = max(r.y, 0.02); vec3 a = mix(uRvSky * 1.25, uRvSky * vec3(0.55, 0.72, 1.0), pow(r.y, 0.45)); if (uRvCube < 0.5) return a; return min(textureLod(tStreet, r, 0.0).rgb, vec3(9.0)); }
void main() {
  vec2 fuv = (vec2(vRvRest.x, -vRvRest.y) - uRvBox.xy) / uRvBox.zw; float sd = (texture2D(tRvField, clamp(fuv, 0.001, 0.999)).r * 2.0 - 1.0) * ${RANGE.toFixed(1)};
  if (sd < -6.0) discard;
  vec3 toEye = cameraPosition - vRvW; float dist = length(toEye); vec3 V = toEye / dist;
  float px = dist * 0.0011;      // about a pixel's width out there, metres
  float calm = mix(0.35, 1.0, smoothstep(0.0, 26.0, sd));
  vec2 s = waSlope(vRvRest, vRvFar, px) * calm;
  // small ripples: two layers of the ripple picture sliding across each other, a third coarse one; they fade where they would only glitter as noise
  vec2 p = vRvRest; float rf = 1.0 / (1.0 + px * px * 30.0), rf2 = 1.0 / (1.0 + px * px * 1.6);
  // small chop: five layers of the ripple picture, each turned another way and half the size of the one before (23 m down to 0.6 m a tile, features
  // down to a few centimetres), crests sharpened by their own height. The picture's mip levels take a layer away where it is finer than a pixel; what is
  // lost that way goes into the surface's roughness.
  vec2 gs = vec2(0.0); float lostV = 0.0;
  #define RV_LAYER(ca, sa, tile, amp, sx, sy) { vec2 u = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y); vec3 tx = texture2D(tRvRip, u * vec2(1.0, 0.78) / tile + uWaT * vec2(sx, sy)).xyz - 0.5; vec2 gl = tx.xy * vec2(1.0, 0.78) * (1.0 + 1.4 * tx.z); gs += vec2(ca * gl.x - sa * gl.y, sa * gl.x + ca * gl.y) * (amp * 8.0); float fl = 1.0 / (1.0 + pow(px * 40.0 / tile, 2.0)); lostV += amp * amp * (1.0 - fl); }
  RV_LAYER(0.47, -0.88, 31.0, 0.050, 0.010, 0.002)
  RV_LAYER(0.90, 0.44, 12.3, 0.085, 0.022, -0.004)
  RV_LAYER(-0.26, 0.97, 5.1, 0.095, 0.040, 0.008)
  RV_LAYER(0.71, -0.71, 2.1, 0.070, 0.070, -0.013)
  RV_LAYER(-0.97, -0.24, 0.87, 0.042, 0.120, 0.020)
  // gusts and slicks: over tens of metres the wind ruffles one patch and leaves the next nearly smooth
  vec2 gq = vec2(dot(p, vec2(0.47, -0.88)), dot(p, vec2(0.88, 0.47)));      // along the wind, across it: gusts run in lanes down the wind
  float gust = texture2D(tRvRip, gq * vec2(0.0011, 0.0046) + uWaT * vec2(0.0020, 0.0003)).b * 0.6 + texture2D(tRvRip, gq * vec2(0.0005, 0.0017) - uWaT * vec2(0.0006, 0.0002)).b * 0.4;
  float ruf = mix(0.55, 1.25, smoothstep(0.34, 0.66, gust));      /* round 5: slicks at a tenth read as flat painted blotches; a slick is now half as ruffled, with a soft edge */
  s += gs * (0.45 + 0.55 * uWaSea) * ruf; lostV *= ruf * ruf;
  float fRing = 0.0, swimD = 99.0, ringH = 0.0;
  for (int i = 0; i < 8; i++) { vec4 rg = uRvRing[i]; float age = uWaT - rg.z; if (rg.w <= 0.0 || age < 0.0 || age > 5.0) continue; vec2 e = vRvRest - rg.xy; float d = length(e); if (d > 9.0) continue;
    float rad = 0.15 + 0.85 * age, wdt = 0.22 + 0.16 * age, ph = d - rad, env = exp(-ph * ph / (wdt * wdt)), amp = (0.25 + 0.75 * rg.w) * exp(-age * 0.75) / (1.0 + 0.55 * rad);
    s += (e / max(d, 0.05)) * (amp * 1.7 * env * sin(ph * 13.0)); ringH += amp * env * cos(ph * 13.0);      /* a packet of two or three short crests riding outward at 0.85 m/s, flattening as it goes */
    fRing = max(fRing, min(rg.w * 2.5, 1.0) * (1.0 - smoothstep(0.10, 0.45 + 1.1 * rg.w, age)) * (1.0 - smoothstep(0.10, 0.30 + (0.25 + 0.6 * rg.w) * age, d))); }      /* critic 1: "nothing the body does disturbs the water": a patch of bubbles where each hand or foot went in, brightest at once, gone in a second and a half */
  if (uRvSwim.w > 0.0) { vec2 e = vRvRest - uRvSwim.xy; swimD = length(e); if (swimD < 6.0) { vec2 l = vec2(dot(e, uRvSwimH), dot(e, vec2(-uRvSwimH.y, uRvSwimH.x)));      /* l.x ahead of him, l.y to his side */
      float sp = clamp(uRvSwim.z / 2.3, 0.0, 1.0); float back = max(-l.x, 0.0), vq = (abs(l.y) - 0.22 - back * 0.32) / (0.10 + back * 0.07), vee = exp(-vq * vq) * exp(-back * 1.3) * step(l.x, 0.3) * sp;
      s += vec2(-uRvSwimH.y, uRvSwimH.x) * sign(l.y) * vee * 0.35 * uRvSwim.w + (e / max(swimD, 0.05)) * 0.30 * uRvSwim.w * exp(-(swimD - 0.55) * (swimD - 0.55) / 0.048) * sin(swimD * 16.0 - uWaT * 5.0); ringH += 0.25 * uRvSwim.w * exp(-(swimD - 0.55) * (swimD - 0.55) / 0.048) * cos(swimD * 16.0 - uWaT * 5.0) + 0.5 * vee * uRvSwim.w; } }      /* the small V he pushes when he moves, and the lapping against his body */
  vec3 Nn = normalize(vec3(-s.x, 1.0, -s.y));
  float rough = clamp(0.035 + sqrt(lostV) * 1.1, 0.035, 0.30);
  float nv = max(dot(Nn, V), 0.001); float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 R = reflect(-V, Nn); R.y = abs(R.y) + 0.02;
  // what the surface mirrors. Near: each small facet shows its own piece of sky or shore, sharp. Far: a pixel holds many facets, whose slopes smear the
  // picture UP AND DOWN far more than sideways: three looks along that line (the long broken reflections under buildings), eased toward the sky's mean
  vec3 Nf = normalize(vec3(-s.x * 0.6, 1.0, -s.y * 0.6)); vec3 Rf = reflect(-V, Nf); Rf.y = abs(Rf.y) + 0.02; float st = 0.05 + rough * 0.9;
  vec3 smear = (rvSky(normalize(Rf + vec3(0.0, -st * 0.6, 0.0)) * vec3(1.0, 1.0, 1.0)) + rvSky(normalize(Rf + vec3(0.0, st * 0.5, 0.0))) + rvSky(normalize(Rf + vec3(0.0, st * 1.8, 0.0)))) / 3.0;
  float farK = smoothstep(0.045, 0.16, rough);
  vec3 sky = mix(min(rvSky(R), smear * 3.0 + 0.02), smear, farK * 0.7);
  { float sl = dot(sky, vec3(0.2126, 0.7152, 0.0722)); sky = mix(sky, vec3(sl) * vec3(0.93, 1.0, 1.08), 0.5) * 0.9; }      // a silty river gives the sky back greyer than it is
  F = mix(F, max(F, 0.02 + 0.98 * pow(1.0 - max(dot(Nf, V), 0.001), 5.0)), farK);      // far off, the facets the eye sees are the ones turned up to the sky
  // the body: silt. An opaque olive-brown lit by the sky and the sun, darker straight down (the eye looks into it), a little lighter in thin crests
  float up = dot(rvSky(vec3(0.0, 1.0, 0.0)), vec3(0.3333));
  float crest = smoothstep(-0.10, 0.42, vRvW.y - uRvLevelF);
  vec3 body = uRvDeep * (up * 0.55 + dot(uSunColor, vec3(0.3333)) * max(uSunDir.y, 0.0) * 0.9) * (0.60 + 0.25 * (1.0 - nv) + 0.4 * crest * (1.0 - nv) + 0.85 * smoothstep(0.55, 0.95, nv));      /* Nov 16: seen from above (a roof, the helicopter) the river was near black; the real one is a mid grey-olive there (refs/C04) */
  float sm = dot(uRvSky, vec3(0.3333));
  { float wallK = 1.0 - smoothstep(0.0, 3.5, sd); sky = mix(sky, min(sky, body * 1.4 + 0.02), wallK); }      /* Nov 16: beside a wall the cube (taken at the camera) gave back the bright sidewalk as a glowing band; a wall's foot mirrors the wall's own dark face */
  vec3 col = mix(body, sky, F);
  // the sun on the water
  vec3 H = normalize(V + uSunDir); float nh = max(dot(Nn, H), 0.0), a2 = rough * rough * 1.8, dd = nh * nh * (a2 * a2 - 1.0) + 1.0;
  col += uSunColor * (a2 * a2 / (3.14159 * dd * dd)) * 0.020 * F * 22.0 * step(0.0, uSunDir.y) * clamp(dot(Nn, uSunDir) * 6.0, 0.0, 1.0);
  col *= 1.0 + clamp(ringH, -0.4, 0.4) * 0.55;      /* the rings read from above too: their crests a little lighter, their troughs darker */
  // foam: the lap at the shore, the breaking tops of the steepest waves, boat wakes
  float n1 = texture2D(tRvRip, p * 0.047 + uWaT * vec2(0.004, 0.003)).b, n2 = texture2D(tRvRip, p * vec2(0.0131, -0.0117) - uWaT * vec2(0.002, 0.003)).b, n3 = texture2D(tRvRip, p * vec2(-0.21, 0.19) + uWaT * vec2(0.011, -0.007)).b;
  float lap = sin(sd * 1.6 - uWaT * 1.3 + n2 * 5.0) * 0.5 + 0.5;
  float band = 1.0 - smoothstep(0.0, 0.35 + 0.75 * lap, sd);
  float fShore = band * smoothstep(-0.9, 0.0, sd) * smoothstep(0.54, 0.70, n1 * 0.55 + n3 * 0.45 + band * 0.12);
  float steep = length(s) * rf2; float fCap = smoothstep(0.50, 0.80, steep + (n2 - 0.5) * 0.30) * smoothstep(0.48, 0.62, n1) * uWaSea * calm;
  float wk = waWake(vRvRest) * (1.0 - smoothstep(180.0, 420.0, vRvFar)); float n5 = texture2D(tRvRip, p * vec2(0.61, -0.57) + uWaT * vec2(0.02, 0.015)).b; float mot = n5 * 0.55 + n3 * 0.45; float big = texture2D(tRvRip, p * vec2(0.037, 0.031) + uWaT * vec2(0.003, 0.002)).b; mot = mot * 0.6 + big * 0.4;      /* the arms from above were rows of even dashes: a larger noise breaks them */
  float fWake = clamp(smoothstep(0.05, 0.16, wk) * smoothstep(0.42, 0.60, mot) * 0.40 + smoothstep(0.15, 0.26, wk * (0.5 + 1.0 * mot)) * 0.9, 0.0, 1.0);
  // the churned track right behind each boat (boat.js gives the stern's place, heading and how hard it churns)
  float fTrail = 0.0;
  float fSwim = 0.0; if (uRvSwim.w > 0.0 && swimD < 4.0) { vec2 e = vRvRest - uRvSwim.xy; vec2 l = vec2(dot(e, uRvSwimH), dot(e, vec2(-uRvSwimH.y, uRvSwimH.x))); float sp = clamp(uRvSwim.z / 2.3, 0.0, 1.0);
    l.x += 0.40 * sp;      /* his chest is given; flat out, the middle of him lies 0.4 m behind it */
    float bodyE = length(l / vec2(0.30 + 0.72 * sp, 0.27 + 0.05 * sp)), grainS = rvNoise(mat2(0.80, -0.60, 0.60, 0.80) * vRvRest * 47.0 + uWaT * 2.1) * 0.5 + rvNoise(mat2(0.28, 0.96, -0.96, 0.28) * vRvRest * 113.0 - uWaT * 3.3) * 0.5,      /* two turned layers: one unturned layer showed its lattice as rows of bricks */ fineS = clamp(1.0 - abs((texture2D(tRvRip, vRvRest * vec2(0.53, 0.47) + uWaT * vec2(0.021, -0.013)).b - 0.5) * 5.0), 0.0, 1.0), bq = (bodyE - 0.95) / 0.30;
    float lead = 0.75 + 0.25 * clamp(l.x / (0.3 + 0.7 * sp), -1.0, 1.0) * sp;      /* more white water on the side he moves toward, less behind */
    fSwim = exp(-bq * bq) * (0.70 + 0.30 * sp) * lead * smoothstep(0.30, 0.55, grainS * 0.6 + fineS * 0.4 + 0.12 * sp)      /* critic 1: the waterline was "a ruled line, a figure pushed through glass": a band of bubbly broken water where the surface meets him */
      + (1.0 - smoothstep(0.0, 0.30, abs(l.y) - 0.08)) * smoothstep(-0.7, -1.2, l.x) * exp((l.x + 1.2) * 1.8) * sp * 0.75 * smoothstep(0.32, 0.58, grainS * 0.7 + fineS * 0.3);      /* the boil of the kick just behind his feet, short */
    fSwim *= uRvSwim.w * (1.0 - smoothstep(1.6, 2.4, swimD)); }
  { float grainR = rvNoise(mat2(0.60, 0.80, -0.80, 0.60) * vRvRest * 53.0 - uWaT * 2.3) * 0.5 + rvNoise(mat2(0.96, -0.28, 0.28, 0.96) * vRvRest * 127.0 + uWaT * 3.7) * 0.5; fRing *= smoothstep(0.50 - 0.30 * fRing, 0.72 - 0.30 * fRing, grainR); }      /* grains of bubbles (fine hash noise), not ribbons: the ripple picture gave long smeared marble streaks at the chase camera's low angle */
  float foam = clamp(max(max(max(fShore * 0.16, fCap * 0.25), fWake * 0.6), max(fRing, fSwim) * 0.3) + fTrail, 0.0, 1.0) * uRvFoam;      /* Nov 16: the shore's lap at 0.55 was a glowing pale band a metre wide along every wall (the shore picture is too coarse for a thin line) */      /* round 5: whitecaps on a river this calm read as stray flecks */
  vec3 foamCol = vec3(0.80, 0.84, 0.85) * (up * 0.9 + dot(uSunColor, vec3(0.3333)) * max(uSunDir.y, 0.0) * 2.4) * (0.7 + 0.6 * n3);
  foamCol = mix(vec3(0.34, 0.38, 0.31) * (up * 0.9 + dot(uSunColor, vec3(0.3333)) * max(uSunDir.y, 0.0) * 2.0), foamCol, smoothstep(0.35, 0.85, foam));      // thin foam is aerated green water, thick foam white
  col = mix(col, foamCol, clamp(foam * (0.35 + 0.9 * n3), 0.0, 1.0));
  { float fw = clamp(max(fRing, fSwim), 0.0, 1.0) * uRvFoam; if (fw > 0.0) col = mix(col, min(vec3(0.80, 0.84, 0.85) * (up * 0.9 + dot(uSunColor, vec3(0.3333)) * max(uSunDir.y, 0.0) * 2.4), vec3(0.95)), fw * 0.92); }      /* the swimmer's own white water is white (the river's thin foam is an olive wash) */
  // contacts: the wall's foot and each hull keep the sky off the water beside them
  float shade = mix(0.50, 1.0, smoothstep(0.0, 2.4 + dist * 0.022, sd));      // the dark line under a shore: from far off it is the bank's own dark reflection, tens of metres wide
  for (int i = 0; i < 4; i++) { vec4 hb = uRvHull[i]; if (hb.z <= 0.0) continue; vec2 e = vRvRest - hb.xy, l = vec2(dot(e, uRvHullH[i]), dot(e, vec2(-uRvHullH[i].y, uRvHullH[i].x))) / (hb.zw + vec2(0.5, 0.45)); shade *= 1.0 - 0.28 * (1.0 - smoothstep(0.7, 1.25, length(l))); }
  if (uRvSwim.w > 0.0) shade *= 1.0 - 0.38 * uRvSwim.w * (1.0 - smoothstep(0.20, 1.3, swimD));      /* critic 2: "no reflection and no shadow on the water, pasted on": a darker patch of water round him */
  col *= shade;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function buildRiver(game, field) {
  const world = game.world, P = game.P, waters = game.city.water, level = waters[0].level === undefined ? -1.6 : waters[0].level;
  const ft = new THREE.DataTexture(field.data, field.n, field.n, THREE.RedFormat); ft.minFilter = ft.magFilter = THREE.LinearFilter; ft.wrapS = ft.wrapT = THREE.ClampToEdgeWrapping; ft.needsUpdate = true;
  const U = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), WV.uniforms(), {
    uRvC: { value: new THREE.Vector3() }, uRvLevel: { value: level }, uRvLevelF: { value: level }, uRvBox: { value: new THREE.Vector4(field.box[0], field.box[1], field.box[2] - field.box[0], field.box[3] - field.box[1]) },
    tRvField: { value: ft }, tRvRip: { value: rippleTexture() }, tStreet: world.shared.tStreet, uSunDir: world.shared.uSunDir, uSunColor: world.shared.uSunColor, uRvCube: { value: 1 }, uRvFoam: { value: 1 },
    uRvDeep: { value: new THREE.Color().setRGB(0.080, 0.078, 0.056) }, uRvHull: { value: new Float32Array(16) }, uRvHullH: { value: new Float32Array(8) }, uRvSky: { value: new THREE.Color().setRGB(0.62, 0.68, 0.80) }, uRvTrail: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uRvRing: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) }, uRvSwim: { value: new THREE.Vector4(0, 0, 0, 0) }, uRvSwimH: { value: new THREE.Vector2(1, 0) },
  });
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: 'uniform float uRvLevelF;\n' + (P.get('riverabove') === '1' ? FRAG : FRAG.replace('0.85 * smoothstep(0.55, 0.95, nv)', '0.0')), fog: true, depthWrite: false });      /* merge lane, batch 4c: hand-over 3's lighter river seen from above is OFF unless ?riverabove=1 (a blind critic called it slightly worse than before in both pairs, 230 m up, by day: lanes/merge/batch-4c/README.md) */
  if (P.get('waterwire') === '1') mat.wireframe = true;
  const mesh = new THREE.Mesh(gridGeometry(), mat); mesh.name = 'river_surface'; mesh.frustumCulled = false; mesh.renderOrder = 40; mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = false;
  const R = { mesh, mat, U, field, level, t: 0, ringN: 0, rings: 0 };
  // a ring on the water at (x, y) in map metres, k 0..1 how hard the water was struck (a hand 0.3, a kick 0.2, a man going in 1); eight live at a time, the oldest is reused
  R.ripple = (x, y, k = 0.4) => { if (!(k > 0) || !isFinite(x) || !isFinite(y)) return; U.uRvRing.value[R.ringN].set(x, -y, WV.state.t, Math.min(1.5, k)); R.ringN = (R.ringN + 1) % 8; R.rings++; };
  // the swimmer, each frame: where he is (map metres), his heading, his speed (m/s); on = false when nobody is in the water
  R.swimmer = (x, y, h, speed, on) => { const v = U.uRvSwim.value; if (!on) { v.w = 0; return; } v.set(x, -y, Math.abs(speed) || 0, 1); U.uRvSwimH.value.set(Math.cos(h), -Math.sin(h)); };
  mesh.onBeforeRender = (r, s, cam) => {
    // the grid's centre: under the eye, in whole metres (the 1 m cells never slide under the waves); drawn into the mirror cube it stays where the main view put it
    if (cam === world.camera) U.uRvC.value.set(Math.round(cam.position.x), 0, Math.round(cam.position.z));
    WV.updateUniforms(U, WV.state.t); U.uRvCube.value = world.streetOff || world.shared.tStreet.value === world.streetDummy.texture ? 0 : 1;
    if (s.fog) U.uRvSky.value.copy(s.fog.color);
  };
  const grp = new THREE.Group(); grp.name = 'river'; grp.add(mesh); world.scene.add(grp); R.group = grp;
  return R;
}
