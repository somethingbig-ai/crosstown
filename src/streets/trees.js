// trees.js (streets lane, part: trees): street and park trees with real leaf geometry, replacing the lead's card trees
// (propMeshes kinds 'tree' and 'tree2', which are hidden). Every leaf is its own small folded mesh set on a twig; no alpha cards.
// Rules, all keyed by a hash of the tree's map position:
//   species   street: London plane / honey locust / callery pear, planted in runs (one species leads each ~70 m cell);
//             sidewalks with a wall closer than 2.3 m get the narrow pear. Parks: big planes, broad elms/oaks, some locust; park trees are moved off
//             the planting grid (up to 3.5 m), one in eight is left out, one in eight is a young tree.
//   form      12 seeded models (trees_gen.js), each tree with its own size, height stretch, lean, turn and colour (some yellowing);
//             the crown is squeezed across the street where a building wall is near.
//   bands     full leaves < 18 m, 1/2.5 of the leaves 1.66x larger to 55 m, 1/4 as 2-triangle leaves 2.15x to 180 m, 1/11 at 3.7x beyond.
//             Bands are re-sorted when the camera moves (instance buffers); trees out of view (grown by the reach of their shadow) are dropped.
//   light     leaves use a normal mixed from the leaf's own and the crown's, so a crown has a lit and a shaded side; a leaf lit from
//             behind is shaded as transmitting (yellow-green, still under the shadow map); a baked occlusion value per leaf darkens
//             the inside of the crown; beyond the shadow map a stand-in from the same data takes over (with the ground bake).
//   pits      street trees stand in a soil pit: relief, dry and wet soil, crumbs, mulch, weeds, butts and scraps; the shader heaps the
//             soil against that tree's own trunk to an uneven line with a dark crease. Rim: granite lengths or setts, low and uneven.
//             Six in ten have a low three-sided iron guard (rail or hoop); four in ten of those are planted. A soft dirt apron lies
//             on the paving around each pit. No pit where a tree at a park's edge stands on the grass (a short pit if it stands on paving); no street tree within 12 m of a signal pole.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL, NOISE_GLSL } from '../facade.js';
import { makeTree, SPECIES, rng } from './trees_gen.js';

const LOD_D = [18, 55, 180];
const VARIANTS = [['plane', 3], ['planeBig', 2], ['locust', 3], ['pear', 2], ['broad', 2]];
// leaf colour (linear albedo) per species
const LEAFCOL = { plane: [0.078, 0.106, 0.042], planeBig: [0.068, 0.094, 0.038], locust: [0.118, 0.134, 0.046], pear: [0.040, 0.064, 0.028], broad: [0.058, 0.082, 0.034] };
const YELLOWS = { plane: 0.3, planeBig: 0.28, locust: 0.55, pear: 0.08, broad: 0.3 };

const h2 = (x, y, k = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

const COMMON_FRAG = `
  varying vec3 vWPos; uniform sampler2D tLight; uniform vec2 uHalf;
  uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
  ${NOISE_GLSL}
  vec3 bakeV; vec3 bakeN;`;
const BAKE_READ = `bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);`;

function leafMaterial(shared, far) {   // far: the bands beyond the nearest skip the sky reflection (the costly part of the standard material)
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52, metalness: 0, side: THREE.DoubleSide });
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aLeaf; varying vec4 vLeaf; varying vec3 vWPos; varying vec3 vTint; varying float vSunFace; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = aLeaf; vTint = vec3(1.0);
        #ifdef USE_INSTANCING
          mat4 tM = modelMatrix * instanceMatrix;
        #else
          mat4 tM = modelMatrix;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vWPos = (tM * vec4(position, 1.0)).xyz;
        vSunFace = dot(normalize(mat3(tM) * normal.xyz), uSunDir);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vLeaf; varying vec3 vTint; varying float vSunFace; float lfFlip;
        ${COMMON_FRAG}`)
      .replace('#include <color_fragment>', `
        {
          float br = vLeaf.r * 1.25, yel = vLeaf.g;
          vec3 c = vTint * br;
          c = mix(c, vec3(0.26, 0.20, 0.04) * br, yel * 0.8);
          c *= mix(0.72, 1.08, vLeaf.a);                      // darker along the midrib, paler toward the edge
          diffuseColor.rgb = c;
          ${BAKE_READ}
        }`)
      .replace('#include <lights_physical_fragment>', `
        {
          normal = normalize(vNormal);                       // the baked shading normal, not flipped for back faces
          vec3 lfL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float lfNdl = dot(normal, lfL); lfFlip = 0.0;
          vec3 lfV = normalize(vViewPosition);
          float lfBack = pow(max(dot(-lfV, lfL), 0.0), 2.0);
          if (lfNdl < 0.0) {
            // lit from behind: the leaf passes the light on, yellower and a little brighter; the shadow map still decides whether sun reaches it
            normal = normalize(mix(normal - 2.0 * lfNdl * lfL, lfL, 0.35)); lfFlip = 1.0;
            diffuseColor.rgb *= vec3(1.08, 1.16, 0.6) * mix(0.65, 1.0, vLeaf.b); roughnessFactor = 1.0;
          } else {
            // sunlit leaves on the far side of the crown, seen from behind through the gaps: the same transmitted colour
            float seeBack = smoothstep(0.0, -0.35, dot(normal, lfV));
            diffuseColor.rgb *= mix(vec3(1.0), vec3(1.08, 1.16, 0.6), seeBack);
          }
          diffuseColor.rgb *= 1.0 + lfBack * vec3(0.7, 0.8, 0.12);
        }
        #include <lights_physical_fragment>`)
      .replace('#include <lights_fragment_maps>', far ? `
        #if defined( USE_ENVMAP ) && defined( RE_IndirectDiffuse ) && defined( ENVMAP_TYPE_CUBE_UV )
          iblIrradiance += getIBLIrradiance( geometryNormal );
        #endif` : '#include <lights_fragment_maps>')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float lAo = vLeaf.b;
          reflectedLight.indirectDiffuse *= mix(0.10, 0.9, lAo);
          reflectedLight.indirectSpecular *= lAo * lAo * 0.7;
          float tFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz));
          float selfVis = clamp(0.22 + 0.95 * vSunFace, 0.04, 1.0) * mix(0.25, 1.0, lAo);
          float k = mix(mix(0.3, 1.0, lAo), selfVis, tFar);
          reflectedLight.directDiffuse *= k; reflectedLight.directSpecular *= k * (1.0 - lfFlip);
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeLeaf7' + (far ? 'f' : '');
  return m;
}

function woodMaterial(shared, map, normalMap, kind, tSoil, scan) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, map, normalMap });
  m.normalScale.set(kind === 0 ? 1.5 : 2.4, kind === 0 ? 1.5 : 2.4);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tSoil: { value: tSoil } }, scan ? { tScanN: { value: scan.normal } } : {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aW; varying vec4 vW; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vLocN; ${scan ? 'attribute vec2 aUv2; varying vec2 vUv2;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vW = aW; vLoc = position; vLocN = normal; ${scan ? 'vUv2 = aUv2;' : ''}
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vW; varying vec3 vLoc; varying vec3 vLocN; uniform sampler2D tSoil; float wShed; ${scan ? 'varying vec2 vUv2; uniform sampler2D tScanN;' : ''}
        ${COMMON_FRAG}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0), wShed * 0.92));   // bare wood under a shed plate has no furrows
        ${scan ? `{
          // the scanned foot: the species' own bark colour and fine relief at full sharpness, the scan's normal map for the big forms only
          vec3 gN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          mat3 tbn2 = getTangentFrame(-vViewPosition, gN, vUv2);
          vec3 sN = normalize(tbn2 * (texture2D(tScanN, vUv2).xyz * 2.0 - 1.0));
          normal = normalize(normal + (sN - gN) * 0.75 * vW.b);   // the species' fine bark relief stays; the scan adds its creases and swellings
        }` : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          ${BAKE_READ}
          vec3 c = diffuseColor.rgb; float lum = dot(c, vec3(0.333)); wShed = 0.0;
          vec3 an = abs(normalize(vLocN)); float wx = an.x / (an.x + an.z + 1e-4);
          ${kind === 0 ? `
            // London plane: grey-brown outer bark flaking off in jigsaw plates to olive, then cream; more bare bark up the limbs
            c = mix(vec3(lum), c, 0.35) * vec3(0.50, 0.46, 0.38);
            float n1 = mix(fbm(vLoc.xy * vec2(6.5, 3.4) + 3.0), fbm(vLoc.zy * vec2(6.5, 3.4) + 11.0), wx);
            float n2 = mix(fbm(vLoc.xy * vec2(19.0, 11.0) + 23.0), fbm(vLoc.zy * vec2(19.0, 11.0) + 31.0), wx);
            float n3 = mix(fbm(vLoc.xy * vec2(47.0, 29.0) + 5.0), fbm(vLoc.zy * vec2(47.0, 29.0) + 9.0), wx);
            float n = n1 * 0.62 + n2 * 0.26 + n3 * 0.12, thr = mix(0.38, 0.46, vW.g * smoothstep(7.0, 1.5, vLoc.y)) + 0.12 * smoothstep(2.6, 0.2, vLoc.y);
            vec3 olive = vec3(0.20, 0.20, 0.13) * (0.7 + 0.3 * n2 + 0.6 * lum), cream = vec3(0.27, 0.26, 0.205) * (0.7 + 0.3 * n2 + 0.6 * lum);
            wShed = smoothstep(thr - 0.003, thr + 0.003, n);
            c = mix(c, olive, wShed);
            c = mix(c, cream, smoothstep(-0.003, 0.003, n - thr - 0.012 - 0.05 * n2));
            c *= 1.0 - 0.3 * smoothstep(thr - 0.008, thr - 0.002, n) * (1.0 - wShed);   // the step down from the old bark, in shade; a lesser one to the newest layer
          ` : kind === 1 ? `
            // honey locust: dark grey-brown, furrowed
            c = mix(vec3(lum), c, 0.30) * vec3(0.50, 0.45, 0.40) * (0.7 + 0.6 * fbm(vLoc.xy * 2.0 + vLoc.zy));
          ` : `
            // callery pear, elm, oak: grey-brown with lighter ridges
            c = mix(vec3(lum), c, 0.25) * vec3(0.42, 0.385, 0.34) * (0.7 + 0.6 * fbm(vLoc.xy * 2.3 + vLoc.zy * 1.3));
          `}
          // green-grey algae stain low on the shaded side, dirt at the foot
          // furrows are shaded, ridges catch the light; grey and green-grey patches; damp and dirt low down, lapping up unevenly
          c *= mix(0.66 + 0.55 * clamp((lum - 0.2) / 0.28, 0.0, 1.0), 1.0, wShed);
          float pn = fbm(vLoc.xy * 1.4 + vLoc.zy * 0.9 + 5.0);
          c *= mix(vec3(1.0), vec3(0.86, 0.94, 0.80), smoothstep(0.5, 0.7, pn) * smoothstep(3.0, 0.2, vLoc.y) * 0.6);
          c *= mix(vec3(1.0), vec3(1.12, 1.1, 1.08), smoothstep(0.5, 0.3, pn) * 0.7);
          // the lowest bark is the dirtiest: splash, soot and damp staining that climbs unevenly, soil caked on the foot
          float dn = fbm(vLoc.xz * 4.0 + vLoc.y * 2.0), dn2 = fbm(vLoc.xz * 19.0 + vLoc.y * 13.0);
          float stain = 1.0 - smoothstep(0.02, 0.5, vLoc.y + (dn - 0.5) * 0.45);
          c *= mix(1.0, 0.42 + 0.25 * dn2, stain) * mix(0.8, 1.0, smoothstep(0.3, 1.2, vLoc.y));
          vec3 so = texture2D(tSoil, vWPos.xz / 0.6 + vWPos.y * 1.3).rgb; float sol = dot(so, vec3(0.333));
          float crumb = clamp((0.13 - vLoc.y + (dn - 0.5) * 0.3 + (sol - 0.2) * 0.7 + (dn2 - 0.5) * 0.12) / 0.03, 0.0, 1.0);
          c = mix(c, so * 0.45, crumb); wShed *= 1.0 - crumb;
          c *= mix(1.25, 1.0, vW.g);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float wAo = vW.r;
          reflectedLight.indirectDiffuse *= mix(0.55, 1.0, wAo); reflectedLight.indirectSpecular *= wAo * 0.5;
          float tFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz));
          reflectedLight.directDiffuse *= mix(1.0, mix(0.25, 1.0, wAo), tFar);
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeWood15_' + kind + (scan ? 's' : '');
  return m;
}

// sun shadows too fine for the shadow map, worked out per pixel in the pit's own frame: the trunk (a post of radius p2.x at z = p2.y)
// and the guard's bars and rails (half-length p2.z along x; 0 = no guard). loc = point in the pit's frame, sunL = sun direction there.
const PIT_SHADOW_GLSL = `
  float guardSide(float pc, float kc, float pt, float kt, float cl, float lim, float py) {
    if (abs(kc) < 0.02) return 0.0;
    float h = (cl - pc) / kc; if (h < py || h > 0.53) return 0.0;
    float qt = pt + kt * h; if (abs(qt) > lim) return 0.0;
    // the sun's disc gives a penumbra of about a hundredth of the distance to the bar: hard at the foot, a few millimetres at the top rail
    float pen = 0.002 + 0.016 * max(h - py, 0.0);
    float bar = 1.0 - smoothstep(0.006, 0.006 + pen, abs(fract(qt / 0.135) - 0.5) * 0.135);
    float rail = (1.0 - smoothstep(0.011, 0.011 + pen, abs(h - 0.505) * 1.0)) + (1.0 - smoothstep(0.009, 0.009 + pen, abs(h - 0.12)));
    return clamp(bar + rail, 0.0, 1.0);
  }
  float pitShadow(vec3 loc, vec3 sunL, vec3 p2) {
    vec2 hs = sunL.xz; float hl = length(hs), sh = 0.0;
    if (hl > 0.05 && sunL.y > 0.08) {
      vec2 sd = -hs / hl, rel = loc.xz - vec2(0.0, p2.y);
      float al = dot(rel, sd), ac = abs(dot(rel, vec2(-sd.y, sd.x))), R = p2.x * 1.15;
      sh = step(0.01, R) * smoothstep(-0.01, 0.02, al) * (1.0 - smoothstep(R, R + 0.01 + 0.03 * al, ac));
      if (p2.z > 0.01) {
        vec2 k = hs / sunL.y; float hx = p2.z, hz = 0.665, g = 0.0;
        g = max(g, guardSide(loc.z, k.y, loc.x, k.x, -hz, hx, loc.y));
        g = max(g, guardSide(loc.x, k.x, loc.z, k.y, -hx, hz, loc.y));
        g = max(g, guardSide(loc.x, k.x, loc.z, k.y, hx, hz, loc.y));
        sh = max(sh, g * 0.92);
      }
    }
    return sh;
  }`;
function pitMaterial(shared, tSoil, tSoilN) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tSoil: { value: tSoil }, tSoilN: { value: tSoilN } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; attribute vec4 aPit; attribute float aLift; attribute float aDry; varying vec3 vPit; varying vec3 vPit2; varying float vDry; varying vec3 vLoc; varying vec3 vSunL; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // soil heaped against this tree's trunk (aPit: trunk radius at the soil line, its offset across the pit, a seed, guard half-length), to an uneven line
          vec2 pl = position.xz - vec2(0.0, aPit.y); float rr = length(pl), ang = atan(pl.y, pl.x);
          float irr = 0.5 + 0.22 * sin(ang * 2.0 + aPit.z * 6.283) + 0.14 * sin(ang * 5.0 + aPit.z * 17.0);
          // aPit.x is the trunk's SMALLEST radius at the soil line: the soil is highest there and only falls away outward, so it
          // passes above the trunk mesh all the way round (no gap, no shelf), a crowned mound banked against the bark
          float d = max(rr - aPit.x, 0.0), on = step(0.01, aPit.x) * clamp(aLift, 0.0, 1.0);
          transformed.y += on * ((0.025 + 0.06 * irr) * exp(-d / (0.12 + 0.12 * irr)) + 0.02 * exp(-d / 0.5));   // up 3 cm here, 8 there: never a level line on the bark
          vPit = vec3(mix(1.0, d, step(0.01, aPit.x)), aLift, irr); vPit2 = vec3(aPit.x, aPit.y, aPit.w); vDry = aDry; vLoc = transformed;
        }
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vSunL = uSunDir * mat3(modelMatrix * instanceMatrix);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSunL = uSunDir;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPit; varying vec3 vPit2; varying float vDry; varying vec3 vLoc; varying vec3 vSunL; uniform sampler2D tSoil; uniform sampler2D tSoilN;
        ${COMMON_FRAG}
        ${PIT_SHADOW_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vDry > -0.5) {   // soil: the photographed soil's own relief
          vec3 sn = texture2D(tSoilN, vWPos.xz / 0.85).xyz * 2.0 - 1.0;
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix) + vec3(sn.x, 0.0, -sn.y) * mix(1.4, 0.7, smoothstep(0.45, 0.6, vDry)));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${BAKE_READ}
          vec2 w = vWPos.xz; float big = fbm(w * 1.3);
          if (vDry > -0.5) {
            // the pit floor is flat, dusty, trodden dirt with grit; black compost (ambientCG Ground048) lies on it in patches with a ragged, crumbly edge
            vec3 st = texture2D(tSoil, w / 0.85).rgb; float sl = dot(st, vec3(0.333));
            float e = smoothstep(0.496, 0.504, vDry + (fbm(w * 6.0) - 0.5) * 0.22 + (fbm(w * 27.0) - 0.5) * 0.1);
            vec3 st2 = texture2D(tSoil, w.yx / 2.3 + 0.37).rgb; float s2 = dot(st2, vec3(0.333)) * 0.5 + dot(texture2D(tSoil, w / 0.31 + 0.2).rgb, vec3(0.333)) * 0.5;
            float scuff = smoothstep(0.5, 0.75, fbm(vec2(w.x * 2.6 + w.y * 1.1, w.y * 7.5)));
            float grit = smoothstep(0.62, 0.8, s2 * 2.2) * 0.3;
            vec3 dryC = vec3(0.092, 0.078, 0.060) * (0.6 + 1.6 * s2) * (0.86 + 0.3 * scuff) * (0.85 + 0.3 * big) * (1.0 - grit);
            diffuseColor.rgb *= mix(mix(vec3(sl), st, 0.6) * vec3(0.40, 0.41, 0.42), dryC, e);
          } else {
            float mid = fbm(w * 9.0), fine = vnoise(w * 46.0);
            float iron = step(diffuseColor.r, 0.05) * step(diffuseColor.r * 1.05, diffuseColor.b);
            float stone = step(0.1, diffuseColor.r) * step(diffuseColor.r, 0.45) * step(diffuseColor.g, diffuseColor.r * 1.04) * step(diffuseColor.r, diffuseColor.g * 1.12);
            diffuseColor.rgb *= 0.6 + 0.8 * mix(mid, fine, 0.5);
            // granite: speckle, grime; iron: scuffed paint, rust where it has chipped
            diffuseColor.rgb *= mix(1.0, 0.75 + 0.5 * vnoise(w * 160.0), stone) * mix(1.0, 0.7 + 0.45 * big, stone);
            float rust = iron * smoothstep(0.5, 0.62, fbm(vLoc.xz * 5.0 + w * 1.3) * 0.45 + fbm(vLoc.xy * 31.0 + vLoc.zy * 27.0) * 0.25 + (0.1 - vLoc.y) * 2.6 + 0.3 * smoothstep(0.47, 0.5, vLoc.y)) * 0.9;   // rust low down, where rain and dogs get at it
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.042, 0.02) * (0.6 + 0.8 * fine), rust);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.062, 0.066), iron * (1.0 - rust) * smoothstep(0.6, 0.75, fbm(vLoc.xy * 9.0 + vLoc.zy * 11.0 + w * 3.0)) * 0.7);
          }
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          // hard sun shadows of the trunk and the guard on soil and rim
          float sh = pitShadow(vLoc, vSunL, vPit2);
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float kS = 1.0 - 0.7 * sh * lit;
          reflectedLight.directDiffuse *= kS; reflectedLight.indirectDiffuse *= kS; reflectedLight.directSpecular *= 1.0 - sh; reflectedLight.indirectSpecular *= kS;
        }`);
  };
  m.customProgramCacheKey = () => 'stTreePit17';
  return m;
}

// ---- pit geometry: local x along the kerb, z across (road at +z), y up from the sidewalk surface.
// rim: 'granite' (a low kerb in lengths) or 'cobble' (a row of setts), set low and uneven with soil in the joints; planted: ground cover.
// Per vertex aLift: 1 = lies on the soil (the shader heaps it up against the trunk), 0 = fixed, < 0 = dirt apron on the paving (-coverage).
function pitGeometry(L, Wd, seed, rim, planted) {
  const R = rng(seed), P = [], C = [], I = [], LF = [], DR = [], shade = []; let lift = 1, dv = -1;
  const rimFade = (x, z) => Math.max(0, Math.min(1, (Math.min(L / 2 - 0.12 - Math.abs(x), Wd / 2 - 0.12 - Math.abs(z))) / 0.16));   // the mound never lifts soil at the rim
  const quad = (a, b, c, d, col, cols) => { const o = P.length / 3; [a, b, c, d].forEach((v, i) => { P.push(v[0], v[1], v[2]); const k = cols ? cols[i] : 1; C.push(col[0] * k, col[1] * k, col[2] * k); LF.push(v[3] !== undefined ? v[3] : lift === 1 ? rimFade(v[0], v[2]) : lift); DR.push(dv); }); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const tri = (a, b, c, col, cols) => { const o = P.length / 3; [a, b, c].forEach((v, i) => { P.push(v[0], v[1], v[2]); const k = cols ? cols[i] : 1; C.push(col[0] * k, col[1] * k, col[2] * k); LF.push(lift === 1 ? rimFade(v[0], v[2]) : lift); DR.push(dv); }); I.push(o, o + 1, o + 2); };
  const hx = L / 2, hz = Wd / 2, bw = rim === 'cobble' ? 0.11 : 0.125, rimH = rim === 'cobble' ? 0.052 : 0.06, ix = hx - bw, iz = hz - bw;
  const wet = [0.034, 0.027, 0.021], dry = [0.125, 0.104, 0.078], stoneC = [0.215, 0.212, 0.205];
  // relief: ridges and hollows; dryness: pale sandy dirt on the high ground, black compost in the hollows and in patches
  const ph = [R() * 6.3, R() * 6.3, R() * 6.3, R() * 6.3], fq = [2.1 + R() * 2, 3.3 + R() * 3, 5 + R() * 4, 6 + R() * 5];
  const relief = (x, z) => 0.009 * Math.sin(x * fq[0] + ph[0]) * Math.cos(z * fq[1] + ph[1]) + 0.007 * Math.sin((x + z) * fq[2] + ph[2]) + 0.005 * Math.cos((x - z * 1.3) * fq[3] + ph[3]);
  const edgeD = (x, z) => Math.min(ix - Math.abs(x), iz - Math.abs(z));
  let soilY = (x, z) => 0.016 + 0.014 * Math.min(1, Math.max(0, edgeD(x, z)) / 0.2) + Math.max(0, relief(x, z) + 0.004) * 0.9;
  const wornX = (R() * 2 - 1) * ix, wornZ = (R() < 0.5 ? -1 : 1) * iz, wornR = 0.3 + 0.35 * R(), wx2 = (R() * 2 - 1) * ix * 0.7, wz2 = (R() * 2 - 1) * iz * 0.7, wr2 = 0.12 + 0.2 * R();
  const dryness = planted
    ? (x, z) => { const e = edgeD(x, z) - 0.015 - 0.05 * (0.5 + 0.5 * Math.sin(x * fq[2] + ph[1]) * Math.sin(z * fq[3] + ph[2])); return Math.max(0, Math.min(1, 0.5 - e * 6.0)); }
    : (x, z) => { const e = edgeD(x, z) - 0.06 - 0.12 * (0.5 + 0.5 * Math.sin(x * fq[2] + ph[1]) * Math.sin(z * fq[3] + ph[2])), w = Math.hypot(x - wornX, z - wornZ) - wornR, w2 = Math.hypot(x - wx2, z - wz2) - wr2; return Math.max(0, Math.min(1, 0.5 - Math.min(e, w, w2) * 4.0)); };
  const soilCol = (x, z, k) => { dv = dryness(x, z); return [k, k, k]; };   // soil is coloured in the shader from its dryness; the vertex colour is only light and dark
  { const base = soilY; soilY = (x, z) => Math.min(base(x, z) + (planted ? 0.03 : 0.014) * (1 - Math.max(0, Math.min(1, (dryness(x, z) - 0.3) / 0.4))), 0.026 + Math.max(0, edgeD(x, z)) * 0.3); }   // the mulch has thickness where it lies
  // a bed of soil under the whole pit, so the joints of the rim show dirt, not paving
  lift = 0; dv = 0.25; quad([-hx + 0.012, 0.024, -hz + 0.012], [-hx + 0.012, 0.024, hz - 0.012], [hx - 0.012, 0.024, hz - 0.012], [hx - 0.012, 0.024, -hz + 0.012], [0.6, 0.6, 0.6]); dv = -1;
  // soil surface
  lift = 1;
  const nx = Math.round(2 * ix / 0.07), nz = Math.round(2 * iz / 0.07), o0 = P.length / 3;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -ix + 2 * ix * i / nx, z = -iz + 2 * iz * j / nz, border = i === 0 || j === 0 || i === nx || j === nz;
    // at the rim the soil stands at different heights against the stones
    const y = border ? 0.016 + 0.006 * R() : soilY(x, z) + (R() - 0.5) * (0.006 + 0.034 * (1 - dryness(x, z))), col = soilCol(x, z, (0.8 + 0.4 * R()) * (border ? 0.7 : 1));
    // the outermost ring of the soil runs in under the stones
    const bx = border ? (i === 0 ? -0.05 : i === nx ? 0.05 : 0) : (R() - 0.5) * 0.03, bz = border ? (j === 0 ? -0.05 : j === nz ? 0.05 : 0) : (R() - 0.5) * 0.03;
    P.push(x + bx, y, z + bz); C.push(col[0], col[1], col[2]); LF.push(border ? 0 : rimFade(x, z)); DR.push(dv);
  }
  dv = -1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = o0 + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; if ((i + j) % 2) I.push(a, c, b, b, c, d); else I.push(a, c, d, a, d, b); }
  // where loose things come to rest: mostly against the rim and in the hollows
  const rest = (m) => { for (let t = 0; t < 8; t++) { let x = (R() * 2 - 1) * (ix - m), z = (R() * 2 - 1) * (iz - m); if (R() < 0.45) { if (R() < 0.5) x = Math.sign(x) * (ix - m - 0.1 * R() * R()); else z = Math.sign(z) * (iz - m - 0.1 * R() * R()); return [x, z]; } if (relief(x, z) < 0.004 || t === 7) return [x, z]; } };
  // crumbs, clods and pebbles: low rounded lumps, dark underneath
  const lump = (x, z, s, h, col) => { const y = soilY(x, z) - 0.006, n = 5 + Math.floor(R() * 2), a0 = R() * 6.283, top = [x + (R() - 0.5) * s * 0.5, y + h, z + (R() - 0.5) * s * 0.5], ring = [], mid = [];
    for (let q = 0; q < n; q++) { const a = a0 + q / n * 6.283, r2 = s * (0.75 + 0.5 * R()); ring.push([x + Math.cos(a) * r2, y, z + Math.sin(a) * r2]); mid.push([x + Math.cos(a) * r2 * 0.72, y + h * (0.6 + 0.3 * R()), z + Math.sin(a) * r2 * 0.72]); }
    for (let q = 0; q < n; q++) { const m = (q + 1) % n; quad(ring[q], mid[q], mid[m], ring[m], col, [0.35, 0.9, 0.9, 0.35]); tri(mid[q], top, mid[m], col, [0.9, 1.1, 0.9]); } };
  const nClod = 4 + Math.floor(R() * 6);
  for (let t = 0; t < nClod; t++) { const x = (R() * 2 - 1) * (ix - 0.04), z = (R() * 2 - 1) * (iz - 0.04), s = 0.012 + 0.04 * R() * R(); const cc = soilCol(x, z, 0.9 + 0.5 * R()); lump(x, z, s, s * (0.5 + 0.4 * R()), cc); dv = -1; }
  const nPeb = 1 + Math.floor(R() * 3);
  for (let t = 0; t < nPeb; t++) { let [x, z] = rest(0.03); for (let q = 0; q < 4 && dryness(x, z) < 0.5; q++) { x = (R() * 2 - 1) * (ix - 0.03); z = (R() * 2 - 1) * (iz - 0.03); } const s = 0.005 + 0.011 * R(), k = 0.4 + 0.8 * R(), wm = R() * 0.05; lump(x, z, s, s * 0.6, [0.15 * k + wm, 0.142 * k + wm * 0.6, 0.13 * k]); }
  // loose bits that catch the light and shade the ground: bark chips on the compost, grit and stones on the bare dirt, half sunk
  { const nS = Math.round(4 * ix * iz * 170), drift = []; for (let q = 0; q < 9; q++) drift.push([(R() * 2 - 1) * ix, (R() * 2 - 1) * iz, 0.08 + 0.2 * R()]);
    for (let t = 0; t < nS; t++) {
      let x, z; if (R() < 0.65) { const dc = drift[Math.floor(R() * drift.length)], a = R() * 6.283, rr = dc[2] * Math.sqrt(R()); x = dc[0] + Math.cos(a) * rr; z = dc[1] + Math.sin(a) * rr; } else { x = (R() * 2 - 1) * ix; z = (R() * 2 - 1) * iz; }
      if (Math.abs(x) > ix - 0.03 || Math.abs(z) > iz - 0.03) continue;
      const d = dryness(x, z), y = soilY(x, z);
      if (d > 0.5) { if (R() < 0.96) continue; const s2 = 0.003 + 0.006 * R(), k = 0.4 + 0.7 * R(), wm = R() * 0.04; lump(x, z, s2, s2 * 0.6, [0.13 * k + wm, 0.12 * k + wm * 0.6, 0.11 * k]); continue; }
      const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), big = R() < 0.04, l = big ? 0.018 + 0.014 * R() : 0.004 + 0.013 * R(), w = l * (0.18 + 0.5 * R()), k = 0.35 + 0.9 * R(), up = (0.002 + 0.02 * R() * R()) * (R() < 0.5 ? 1 : -0.3), tone = R();
      const col = tone < 0.55 ? [0.06 * k, 0.036 * k, 0.025 * k] : tone < 0.85 ? [0.08 * k, 0.05 * k, 0.032 * k] : tone < 0.94 ? [0.07 * k, 0.064 * k, 0.057 * k] : [0.035 * k, 0.026 * k, 0.02 * k], jj = () => 0.6 + 0.8 * R();
      const A = [x - c * l * jj() - sn * w * jj(), y - 0.004, z - sn * l * jj() + c * w * jj()], B = [x - c * l * jj() + sn * w * jj(), y - 0.002 + up * 0.3, z - sn * l * jj() - c * w * jj()], Cc = [x + c * l * jj() + sn * w * jj(), y + Math.max(0.001, up), z + sn * l * jj() - c * w * jj()], D = [x + c * l * jj() - sn * w * jj(), y + Math.max(0.001, up * 0.6), z + sn * l * jj() + c * w * jj()];
      if (R() < 0.3) tri(A, B, Cc, col, [0.5, 0.6, 1.1]); else quad(A, B, Cc, D, col, [0.45, 0.55, 1.15, 1]);
    } }
  // mulch: bark chips and splinters, irregular, half pressed into the soil
  const nChip = 0;
  for (let t = 0; t < nChip; t++) {
    const [x, z] = R() < 0.5 ? rest(0.03) : [(R() * 2 - 1) * (ix - 0.04), (R() * 2 - 1) * (iz - 0.04)], y = soilY(x, z) + 0.002, a = R() * 6.283, c = Math.cos(a), s = Math.sin(a), l = 0.012 + 0.028 * R(), w = 0.004 + 0.009 * R(), k = 0.6 + 0.7 * R();
    const col = R() < 0.35 ? [0.105 * k, 0.098 * k, 0.088 * k] : [0.085 * k, 0.056 * k, 0.034 * k], j = () => 0.7 + 0.6 * R(), up = 0.004 + 0.012 * R();
    quad([x - c * l * j() - s * w * j(), y - 0.006, z - s * l * j() + c * w * j()], [x - c * l * j() + s * w * j(), y - 0.004, z - s * l * j() - c * w * j()], [x + c * l * j() + s * w * j(), y + up, z + s * l * j() - c * w * j()], [x + c * l * j() - s * w * j(), y + up * 0.8, z + s * l * j() + c * w * j()], col, [0.6, 0.7, 1.05, 1]);
  }
  // rim: uneven stones set low, each a little off line, grimy low down
  lift = 0;
  const block = (cx, cz, dx, dz, hl, hw, y1, col, tilt, yaw) => {   // a whole stone: flat top, rounded arrises (shared vertices, so it shades smooth), bedded level
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ax = dx * cy - dz * sy, az = dx * sy + dz * cy, px = -az, pz = ax, o = P.length / 3, bev = Math.min(0.009, hl * 0.3, hw * 0.3);
    const ring = (inset, y, k) => { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(cx + ax * (hl - inset) * a + px * (hw - inset) * b, y + a * tilt, cz + az * (hl - inset) * a + pz * (hw - inset) * b); const kk = k * (0.92 + 0.16 * R()); C.push(col[0] * kk, col[1] * kk, col[2] * kk); LF.push(0); DR.push(-1); } };
    ring(bev, y1, 1); ring(0, y1 - bev * 0.8, 0.9); ring(0, 0, 0.35);
    I.push(o, o + 3, o + 2, o, o + 2, o + 1);
    for (let r2 = 0; r2 < 2; r2++) for (let q = 0; q < 4; q++) { const n = (q + 1) % 4, a = o + r2 * 4 + q, b = o + r2 * 4 + n, c = o + r2 * 4 + 4 + n, d = o + r2 * 4 + 4 + q; I.push(a, b, c, a, c, d); }
  };
  const side = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, px = -dz * bw / 2, pz = dx * bw / 2;
    let a = 0;
    while (a < len - 0.02) {
      const unit = rim === 'cobble' ? 0.12 + 0.14 * R() : 0.4 + 0.9 * R(), b = Math.min(len, a + unit), gap = rim === 'cobble' ? 0.003 + 0.005 * R() : 0.002 + 0.004 * R(), m = (a + b) / 2;
      const k = 0.5 + 0.7 * R(), warm = rim === 'cobble' ? R() * 0.05 : 0.01 * R(), col = [stoneC[0] * k + warm, stoneC[1] * k + warm * 0.7, stoneC[2] * k * 0.97], off = (R() - 0.5) * (rim === 'cobble' ? 0.012 : 0.006), sunk = 1;
      if (b - a > 0.05 && !(rim === 'cobble' && R() < 0.02)) block(x0 + dx * m + px + (-dz) * off, z0 + dz * m + pz + dx * off, dx, dz, (b - a) / 2 - gap, bw / 2 * (rim === 'cobble' ? 0.86 + 0.16 * R() : 0.8 + 0.3 * R()), rimH * (0.92 + 0.16 * R()), col, (R() - 0.5) * 0.003, (R() - 0.5) * (rim === 'cobble' ? 0.03 : 0.008));
      a = b;
    }
  };
  side(-hx, -hz, hx, -hz); side(hx, -hz, hx, hz); side(hx, hz, -hx, hz); side(-hx, hz, -hx, -hz);
  // soil heaped over the inner edge of the rim here and there
  const nSp = 0;
  for (let t = 0; t < nSp; t++) { let x = (R() * 2 - 1) * hx, z = (R() * 2 - 1) * hz; if (R() < 0.5) x = Math.sign(x) * (ix + bw * (0.1 + 0.95 * R())); else z = Math.sign(z) * (iz + bw * (0.1 + 0.95 * R())); const s = 0.02 + 0.035 * R(), y = rimH * 0.35;
    const o = P.length / 3, n = 6, col = soilCol(x, z, 0.8 + 0.4 * R()); P.push(x, y + 0.012 + s * 0.2, z); C.push(col[0], col[1], col[2]); LF.push(0); DR.push(dv);
    for (let q = 0; q < n; q++) { const a = q / n * 6.283, r2 = s * (0.6 + 0.8 * R()); P.push(x + Math.cos(a) * r2, 0.004, z + Math.sin(a) * r2); C.push(col[0] * 0.6, col[1] * 0.6, col[2] * 0.6); LF.push(0); DR.push(dv); }
    for (let q = 0; q < n; q++) I.push(o, o + 1 + (q + 1) % n, o + 1 + q); dv = -1; }
  // plants: weeds of different kinds, sizes and health anywhere in a bare pit (thicker at the rim); a bed of ground cover in a planted one
  lift = 1;
  const blade = (ox, oz, y0, a, h, lean, w, col) => {
    const ca = Math.cos(a), sa = Math.sin(a), tx = -sa * w, tz = ca * w, tw = (R() - 0.5) * 0.5, pt = (f) => { const b2 = lean * f * f * h, aa = a + tw * f; return [ox + Math.cos(aa) * b2, y0 + h * f * (1 - 0.35 * lean * f), oz + Math.sin(aa) * b2]; };
    const p1 = pt(0.4), p2 = pt(0.75), p3 = pt(1), s1 = 0.9, s2 = 0.6;
    quad([ox - tx, y0, oz - tz], [ox + tx, y0, oz + tz], [p1[0] + tx * s1, p1[1], p1[2] + tz * s1], [p1[0] - tx * s1, p1[1], p1[2] - tz * s1], col, [0.25, 0.25, 0.7, 0.7]);
    quad([p1[0] - tx * s1, p1[1], p1[2] - tz * s1], [p1[0] + tx * s1, p1[1], p1[2] + tz * s1], [p2[0] + tx * s2, p2[1], p2[2] + tz * s2], [p2[0] - tx * s2, p2[1], p2[2] - tz * s2], col, [0.7, 0.7, 1, 1]);
    tri([p2[0] - tx * s2, p2[1], p2[2] - tz * s2], [p2[0] + tx * s2, p2[1], p2[2] + tz * s2], p3, col, [1, 1, 1.15]);
    shade.push(ox, oz);
  };
  const green = () => { const g = 0.5 + 0.8 * R(), t = R(); return t < 0.25 ? [0.15 * g, 0.13 * g, 0.055 * g] : t < 0.55 ? [0.055 * g, 0.085 * g, 0.03 * g] : t < 0.8 ? [0.035 * g, 0.075 * g, 0.026 * g] : [0.07 * g, 0.10 * g, 0.028 * g]; };
  if (planted) {
    const nC = 2 + Math.floor(R() * 3), sideX = R() < 0.5 ? -1 : 1;
    for (let cI = 0; cI < nC; cI++) {
      const ccx = sideX * ix * (0.62 + 0.3 * R()) * (R() < 0.8 ? 1 : -1), ccz = (R() * 2 - 1) * iz * 0.8, cr = 0.12 + 0.2 * R(), hC = 0.08 + 0.3 * R(), gC = 0.5 + 0.8 * R(), dryC = R() < 0.15, nT = Math.round(cr * cr * 3.14 / 0.02);
      for (let t = 0; t < nT; t++) {
        const a = R() * 6.283, rr = cr * Math.sqrt(R()), x = Math.max(-ix + 0.12, Math.min(ix - 0.12, ccx + Math.cos(a) * rr)), z = Math.max(-iz + 0.12, Math.min(iz - 0.12, ccz + Math.sin(a) * rr)); if (Math.hypot(x, z) < 0.62) continue;
        const y0 = soilY(x, z) - 0.01, g = gC * (0.8 + 0.4 * R()), nb = 6 + Math.floor(R() * 8), hgt = hC * (0.6 + 0.8 * R());
        for (let b = 0; b < nb; b++) blade(x + (R() - 0.5) * 0.05, z + (R() - 0.5) * 0.05, y0, R() * 6.283, hgt * (0.35 + 0.8 * R()), 0.25 + 0.5 * R(), 0.004 + 0.004 * R(), dryC || R() < 0.1 ? [0.15 * g, 0.13 * g, 0.06 * g] : R() < 0.3 ? [0.06 * g, 0.10 * g, 0.035 * g] : [0.028 * g, 0.068 * g, 0.024 * g]);
      }
    }
  }
  const nT = planted ? 2 : 2 + Math.floor(R() * 7);
  for (let t = 0; t < nT; t++) {
    let x = (R() * 2 - 1) * (ix - 0.02), z = (R() * 2 - 1) * (iz - 0.02); if (Math.hypot(x, z) < 0.6) continue; if (R() < 0.45) { if (R() < 0.5) x = Math.sign(x) * (ix - 0.02 - 0.1 * R()); else z = Math.sign(z) * (iz - 0.02 - 0.1 * R()); }
    const y0 = soilY(x, z) - 0.012, col = green(), kind = R();
    if (kind < 0.72) {
      const nb = 9 + Math.floor(R() * 14), hgt = 0.03 + 0.2 * R() * R(), sp = 0.02 + 0.05 * R();
      for (let b = 0; b < nb; b++) blade(x + (R() - 0.5) * sp, z + (R() - 0.5) * sp, y0, R() * 6.283, hgt * (0.5 + 0.7 * R()), 0.3 + 0.9 * R(), 0.003 + 0.005 * R(), col.map((c) => c * (0.8 + 0.4 * R())));
    } else if (kind < 0.86) {
      const nl = 5 + Math.floor(R() * 5), rad = 0.025 + 0.04 * R(), a0 = R() * 6.283;
      for (let b = 0; b < nl; b++) {
        const a = a0 + b / nl * 6.283 + (R() - 0.5) * 0.6, c = Math.cos(a), sn = Math.sin(a), l = rad * (0.6 + 0.6 * R()), w = l * (0.22 + 0.2 * R()), up = 0.01 + 0.03 * R();
        quad([x, y0 + 0.012, z], [x + c * l * 0.5 + sn * w, y0 + 0.014 + up, z + sn * l * 0.5 - c * w], [x + c * l, y0 + 0.012 + up * 0.5, z + sn * l], [x + c * l * 0.5 - sn * w, y0 + 0.014 + up, z + sn * l * 0.5 + c * w], col, [0.4, 0.9, 1.1, 0.9]);
      }
    } else {   // a taller weed: a stalk with a few leaves
      const h = 0.12 + 0.2 * R(), lx = (R() - 0.5) * 0.08, lz = (R() - 0.5) * 0.08; blade(x, z, y0, R() * 6.283, h, 0.25, 0.003, col.map((c) => c * 0.7));
      for (let b = 0; b < 5; b++) { const f = 0.3 + 0.7 * b / 5, a = R() * 6.283, l = 0.03 + 0.04 * R(), bx = x + lx * f, bz = z + lz * f, by = y0 + h * f * 0.8; tri([bx, by, bz], [bx + Math.cos(a) * l + Math.sin(a) * l * 0.3, by + 0.01, bz + Math.sin(a) * l - Math.cos(a) * l * 0.3], [bx + Math.cos(a) * l - Math.sin(a) * l * 0.3, by + 0.012, bz + Math.sin(a) * l + Math.cos(a) * l * 0.3], col, [0.6, 1, 1]); }
    }
  }
  // what people leave: cigarette ends and scraps, lying flat, half trodden in, gathered at the edge and in the hollows
  const nB = 3 + Math.floor(R() * 9);
  for (let t = 0; t < nB; t++) {
    const [x, z] = rest(0.03), y = soilY(x, z) + 0.005, a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), l = 0.012, w = 0.0038, k = 0.6 + 0.4 * R();
    const P4 = (u0, u1, yy) => [[x + c * u0 - sn * w, yy, z + sn * u0 + c * w], [x + c * u0 + sn * w, yy, z + sn * u0 - c * w], [x + c * u1 + sn * w, yy, z + sn * u1 - c * w], [x + c * u1 - sn * w, yy, z + sn * u1 + c * w]];
    const q1 = P4(-l, 0, y), q2 = P4(0, l * (0.4 + R()), y), q3 = P4(-l, l * 1.2, y + 0.006).map((v, i) => [v[0] + (i < 2 ? 0 : 0), v[1], v[2]]);
    quad(q1[0], q1[1], q1[2], q1[3], [0.36 * k, 0.24 * k, 0.11 * k], [0.5, 0.5, 0.5, 0.5]); quad(q2[0], q2[1], q2[2], q2[3], [0.42 * k, 0.40 * k, 0.36 * k], [0.5, 0.5, 0.5, 0.5]);
    quad([q3[0][0], y + 0.007, q3[0][2]], [q3[1][0], y + 0.007, q3[1][2]], [x + sn * w, y + 0.007, z - c * w], [x - sn * w, y + 0.007, z + c * w], [0.36 * k, 0.24 * k, 0.11 * k]);
    quad([x - sn * w, y + 0.007, z + c * w], [x + sn * w, y + 0.007, z - c * w], [q2[2][0], y + 0.007, q2[2][2]], [q2[3][0], y + 0.007, q2[3][2]], [0.42 * k, 0.40 * k, 0.36 * k]);
  }
  const nLit = 0;
  for (let t = 0; t < nLit; t++) {
    const [x, z] = rest(0.1), y = soilY(x, z) + 0.004, a = R() * 6.283, sz = 0.035 + 0.05 * R(), k = R(), n = 7;
    const col = k < 0.55 ? [0.40, 0.39, 0.36] : [0.27, 0.22, 0.15], pts = [];
    for (let j = 0; j < n; j++) { const aa = a + j / n * 6.283, r2 = sz * (0.5 + 0.7 * R()); pts.push([x + Math.cos(aa) * r2, y - 0.006 + R() * 0.016, z + Math.sin(aa) * r2 * 0.7]); }
    const cen = [x, y + 0.008, z]; for (let j = 0; j < n; j++) tri(cen, pts[(j + 1) % n], pts[j], col, [0.9 + 0.2 * R(), 0.55 + 0.4 * R(), 0.55 + 0.4 * R()]);
  }
  // the soil is darker under every plant (their shadows are too fine for the shadow map)
  for (let v = o0; v < o0 + (nx + 1) * (nz + 1); v++) { let k = 1; const x = P[v * 3], z = P[v * 3 + 2];
    for (let q = 0; q < shade.length; q += 2) { const d2 = (shade[q] - x) * (shade[q] - x) + (shade[q + 1] - z) * (shade[q + 1] - z); if (d2 < 0.02) k = Math.min(k, 0.45 + 0.55 * d2 / 0.02); }
    C[v * 3] *= k; C[v * 3 + 1] *= k; C[v * 3 + 2] *= k; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aLift', new THREE.Float32BufferAttribute(LF, 1)); g.setAttribute('aDry', new THREE.Float32BufferAttribute(DR, 1)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
// dirt washed out of the pit onto the paving: a soft blended skirt (its own transparent layer), wide on the building side, a sliver at the kerb
function apronGeometry(L, Wd, seed) {
  const R = rng(seed), P = [], A = [], O = [], I = [], hx = L / 2, hz = Wd / 2;
  const ring = [], n = 48, w0 = 0.26 + 0.25 * R();
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.283, c = Math.cos(a), s = Math.sin(a), k = 1 / Math.max(Math.abs(c) / hx, Math.abs(s) / hz), ex = c * k, ez = s * k, l = Math.hypot(ex, ez);
    const w = w0 * (0.4 + 1.1 * R()) * (s > 0.3 ? 0.25 : 1), far = 2.3, zc = (z) => Math.min(z, hz + 0.06);
    ring.push([[ex * 0.9, ez * 0.9, 0.95, 0], [ex * (1 + w * 0.45 / l), zc(ez * (1 + w * 0.45 / l)), 0.45 + 0.35 * R(), 0], [ex * (1 + w / l), zc(ez * (1 + w / l)), 0, 0.15], [ex * (1 + far / l), zc(ez * (1 + far / l)), 0, 1]]);
  }
  for (const r of ring) for (const v of r) { P.push(v[0], 0.003, v[1]); A.push(v[2]); O.push(v[3]); }
  for (let i = 0; i < n; i++) { const a = i * 4, b = ((i + 1) % n) * 4; for (let q = 0; q < 3; q++) I.push(a + q, b + q, b + q + 1, a + q, b + q + 1, a + q + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aCov', new THREE.Float32BufferAttribute(A, 1)); g.setAttribute('aOut', new THREE.Float32BufferAttribute(O, 1)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
function apronMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWPos; attribute float aCov; attribute float aOut; attribute vec4 aPit; varying vec2 vCov; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vPit2; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCov = vec2(aCov, aOut); vLoc = position; vPit2 = vec3(aPit.x, aPit.y, aPit.w);
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz; vSunL = uSunDir * mat3(modelMatrix * instanceMatrix);
        #else
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vSunL = uSunDir;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec2 vCov; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vPit2;\n ${COMMON_FRAG}\n ${PIT_SHADOW_GLSL}`)
      .replace('#include <color_fragment>', `
        {
          ${BAKE_READ}
          vec2 w = vWPos.xz; float c = vCov.x;
          // soil and grit tracked out of the pit: a film that thins away, with crumbs in it
          float drift = smoothstep(0.25, 0.8, fbm(w * 2.6) * 0.65 + fbm(w * 9.0) * 0.35 + (c - 0.5) * 0.7);
          diffuseColor.rgb = vec3(0.075, 0.062, 0.047) * (0.7 + 0.6 * fbm(w * 14.0)) * (0.75 + 0.5 * vnoise(w * 180.0));
          diffuseColor.a = clamp(c * c * 1.3, 0.0, 1.0) * drift * 0.8;
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          // the trunk's and the guard's shadows run on over the paving: where the shadow map says the sun reaches, darken what lies under
          float sh = pitShadow(vLoc, vSunL, vPit2) * (1.0 - smoothstep(0.8, 1.0, vCov.y));
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float aD = diffuseColor.a, aS = sh * lit * 0.7, aO = aD + aS * (1.0 - aD), kd = aD / max(aO, 1e-4);
          reflectedLight.directDiffuse *= kd * (1.0 - 0.95 * sh); reflectedLight.indirectDiffuse *= kd; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectSpecular *= kd;
          diffuseColor.a = aO;
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeApron7';
  return m;
}
// low iron guard on three sides (open to the kerb): flat-bar hoops or rails and pickets between square posts with caps and foot plates,
// every piece a little out of true
function guardGeometry(L, Wd, style, seed) {
  const R = rng(seed || 5), P = [], C = [], I = [];
  const rod = (a, b, t, t2) => {   // a bar between two points, t wide and t2 deep
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, u = Math.abs(d[1]) / l > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let s = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]; const sl = Math.hypot(s[0], s[1], s[2]); s = s.map((v) => v / sl * t);
    let w = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]]; const wl = Math.hypot(w[0], w[1], w[2]); w = w.map((v) => v / wl * (t2 || t));
    const o = P.length / 3, k = 0.8 + 0.5 * R(), col = [0.02 * k, 0.021 * k, 0.025 * k];
    for (const e of [a, b]) for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(e[0] + s[0] * p + w[0] * q, e[1] + s[1] * p + w[1] * q, e[2] + s[2] * p + w[2] * q); C.push(col[0], col[1], col[2]); }
    for (let q = 0; q < 4; q++) { const n = (q + 1) % 4; I.push(o + q, o + n, o + 4 + n, o + q, o + 4 + n, o + 4 + q); }
    I.push(o + 4, o + 5, o + 6, o + 4, o + 6, o + 7);
  };
  const hx = L / 2 - 0.06, hz = Wd / 2 - 0.06, H = 0.46, y0 = 0.06, j = (a) => (R() - 0.5) * a;
  const runs = [[-hx, -hz, hx, -hz], [-hx, -hz, -hx, hz], [hx, -hz, hx, hz]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), sag = j(0.012), lx = j(0.014), lz = j(0.014);
    const at = (f, y) => [x0 + (x1 - x0) * f + lx * y / H, y + sag * Math.sin(f * 3.1416), z0 + (z1 - z0) * f + lz * y / H];
    if (style === 'hoop') {
      rod(at(0, y0 + 0.05), at(1, y0 + 0.05), 0.004, 0.011);
      const n = Math.round(len / 0.2), w = 1.35 / n;
      for (let i = 0; i < n; i++) {
        const c = (i + 0.5) / n + j(0.004), bent = R() < 0.14 ? j(0.5) : 0, top = (H - 0.04) * (1 + j(0.04)) * (bent ? 0.93 : 1), pts = [[-0.5, 0]];
        for (let q = 0; q <= 16; q++) { const a = Math.PI * (1 - q / 16); pts.push([Math.cos(a) * 0.5, 0.6 + 0.4 * Math.sin(a)]); }
        pts.push([0.5, 0]);
        const P3 = pts.map(([u, v]) => { const q = at(Math.max(0, Math.min(1, c + u * w + bent * v * 0.06)), v === 0 ? 0.0 : y0 + v * top); q[0] += bent * v * 0.05 * (z1 - z0) / len; q[2] -= bent * v * 0.05 * (x1 - x0) / len; return q; });
        for (let k = 0; k < P3.length - 1; k++) rod(P3[k], P3[k + 1], 0.0055, 0.0075);
      }
    } else {
      for (const y of [y0 + 0.07, y0 + H]) rod(at(0, y), at(1, y), 0.005, 0.013);
      const n = Math.round(len / 0.13); for (let i = 1; i < n; i++) { const f = i / n + j(0.003); rod(at(f, y0 + 0.07), at(f, y0 + H), 0.006); }
    }
  }
  for (const [x, z] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
    const top = y0 + H + (style === 'hoop' ? -0.06 : 0.05), tx = x + j(0.016), tz = z + j(0.016), pt = 0.014;
    rod([x, 0, z], [tx, top, tz], pt); rod([tx, top, tz], [tx, top + 0.012, tz], pt * 1.5);          // post and cap
    rod([x, 0.0, z], [x, 0.008, z], 0.04);                                                              // foot plate
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  const gg = g.toNonIndexed(); gg.computeVertexNormals(); return gg;
}

// distance from each tree to the nearest building wall (metres, capped), from a grid of wall segments
function nearestEdge(polys, trees, key, cap) {
  const CS = 16, grid = new Map();
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const x0 = Math.floor(Math.min(a[0], c[0]) / CS), x1 = Math.floor(Math.max(a[0], c[0]) / CS), y0 = Math.floor(Math.min(a[1], c[1]) / CS), y1 = Math.floor(Math.max(a[1], c[1]) / CS);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + ',' + y; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(a[0], a[1], c[0], c[1]); }
    }
  }
  for (const t of trees) {
    let best = cap, bx = 0, by = 0; const cx = Math.floor(t.x / CS), cy = Math.floor(t.y / CS);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      const l = grid.get(x + ',' + y); if (!l) continue;
      for (let i = 0; i < l.length; i += 4) {
        const ax = l[i], ay = l[i + 1], dx = l[i + 2] - ax, dy = l[i + 3] - ay, q = Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.y - ay) * dy) / (dx * dx + dy * dy + 1e-9)));
        const d = Math.hypot(t.x - ax - dx * q, t.y - ay - dy * q); if (d < best) { best = d; bx = ax + dx * q - t.x; by = ay + dy * q - t.y; }
      }
    }
    t[key] = best; t[key + 'v'] = [bx, by];
  }
}
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }

// The foot of a near tree is scanned geometry: the lowest part of a real trunk (Poly Haven scans, cut and straightened by
// tools in the lane's scratch; assets/streets/trees/feet.json) stood around the generated trunk, following its axis, never inside it,
// its far-flung roots drawn in; it wears the species' own bark (same material, UVs continued from the trunk) so there is no seam.
function footGeometry(foot, T, S, seed) {
  const SINK = S.trunkR < 0.2 ? 0.05 : 0.10, suv = new Float32Array(Uint8Array.from(atob(foot.uv), (c) => c.charCodeAt(0)).buffer);
  const f32 = new Float32Array(Uint8Array.from(atob(foot.pos), (c) => c.charCodeAt(0)).buffer), u16 = new Uint16Array(Uint8Array.from(atob(foot.idx), (c) => c.charCodeAt(0)).buffer);
  const tp = T.info.trunk.pts, tr = T.info.trunk.rad;
  const at = (y) => { let i = 0; while (i < tp.length - 2 && tp[i + 1][1] < y) i++; const a = tp[i], b = tp[i + 1], t = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1] || 1))); return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, tr[i] + (tr[i + 1] - tr[i]) * t]; };
  const k = at(foot.h * S.trunkR)[2], ang = seed * 2.399, ca = Math.cos(ang), sa = Math.sin(ang), urep = Math.max(1, Math.round(6.283 * S.trunkR / 0.45));
  const n = f32.length / 3, P = new Float32Array(n * 3), A = new Float32Array(n), Rr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = f32[i * 3] * ca - f32[i * 3 + 2] * sa, z = f32[i * 3] * sa + f32[i * 3 + 2] * ca; const y = f32[i * 3 + 1] * k - SINK, c = at(y);
    let r = Math.hypot(x, z) || 1e-6; const r2 = (r < 1.6 ? r : 1.6 + (r - 1.6) * 0.4) ; x *= r2 / r; z *= r2 / r; r = r2;
    const rw = Math.max(r * k, c[2] * 1.012);                                   // never inside the generated trunk
    x = x / r * rw; z = z / r * rw;
    P[i * 3] = c[0] + x; P[i * 3 + 1] = y; P[i * 3 + 2] = c[1] + z; A[i] = Math.atan2(-x, -z); if (A[i] < 0) A[i] += 6.283185; Rr[i] = rw - c[2];
  }
  const pos = [], uv = [], aw = [], uv2 = [], top = foot.h * k - SINK;
  const push = (i, a) => { pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); uv.push(a / 6.283185 * urep, (P[i * 3 + 1] + 0.35) / 0.55 + Math.max(0, Rr[i]) / 0.55 * 0.8); const e = Math.max(0, Math.min(1, (P[i * 3 + 1] - (top - 0.42)) / 0.38)); aw.push(255, 255, Math.round(255 * (1 - e * e * (3 - 2 * e))), 255); uv2.push(suv[i * 2], suv[i * 2 + 1]); };
  for (let t = 0; t < u16.length; t += 3) {
    const v = [u16[t], u16[t + 1], u16[t + 2]], a = v.map((i) => A[i]), wrap = Math.max(...a) - Math.min(...a) > Math.PI;
    for (let q = 0; q < 3; q++) push(v[q], wrap && a[q] < Math.PI ? a[q] + 6.283185 : a[q]);
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aW', new THREE.BufferAttribute(new Uint8Array(aw), 4, true)); g.setAttribute('aUv2', new THREE.Float32BufferAttribute(uv2, 2));
  // smooth normals by position (the triangles were split so the bark's u can wrap)
  const key = (i) => Math.round(pos[i * 3] * 2000) + ',' + Math.round(pos[i * 3 + 1] * 2000) + ',' + Math.round(pos[i * 3 + 2] * 2000), acc = new Map(), nrm = new Float32Array(pos.length);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  for (let t = 0; t < pos.length / 9; t++) { pa.fromArray(pos, t * 9); pb.fromArray(pos, t * 9 + 3); pc.fromArray(pos, t * 9 + 6); nn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
    for (let q = 0; q < 3; q++) { const kk = key(t * 3 + q); let o = acc.get(kk); if (!o) acc.set(kk, o = new THREE.Vector3()); o.add(nn); } }
  // scans are not always wound the same way round: make the normals point away from the trunk axis
  let outw = 0; for (let i = 0; i < pos.length / 3; i++) { const o = acc.get(key(i)), c = at(pos[i * 3 + 1]); outw += o.x * (pos[i * 3] - c[0]) + o.z * (pos[i * 3 + 2] - c[1]); }
  const sgn = outw < 0 ? -1 : 1;
  for (let i = 0; i < pos.length / 3; i++) { const o = acc.get(key(i)), c = at(pos[i * 3 + 1]); nn.copy(o).multiplyScalar(sgn); const rx = pos[i * 3] - c[0], rz = pos[i * 3 + 2] - c[1];
    if (nn.lengthSq() < 1e-14 || nn.x * rx + nn.z * rz < -0.2 * Math.hypot(rx, rz) * nn.length()) nn.set(rx, 0.3 * Math.hypot(rx, rz), rz);   // a collapsed or turned patch of the scan: face it outward
    nn.normalize(); nrm[i * 3] = nn.x; nrm[i * 3 + 1] = nn.y; nrm[i * 3 + 2] = nn.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (sgn < 0) { const p2 = g.attributes.position.array, u2 = g.attributes.uv.array; for (let t = 0; t < pos.length / 9; t++) { for (let c = 0; c < 3; c++) { const a = t * 9 + 3 + c, b = t * 9 + 6 + c, tmp = p2[a]; p2[a] = p2[b]; p2[b] = tmp; const na = nrm[a]; nrm[a] = nrm[b]; nrm[b] = na; } for (let c = 0; c < 2; c++) { const a = t * 6 + 2 + c, b = t * 6 + 4 + c, tmp = u2[a]; u2[a] = u2[b]; u2[b] = tmp; const u3 = g.attributes.aUv2.array, t3 = u3[a]; u3[a] = u3[b]; u3[b] = t3; } const wa = g.attributes.aW.array, a4 = t * 12 + 4 + 2, b4 = t * 12 + 8 + 2, tw = wa[a4]; wa[a4] = wa[b4]; wa[b4] = tw; } }
  // the narrowest the bark gets near the soil line, for the pit's mound
  const bins = new Array(16).fill(0); for (let i = 0; i < n; i++) if (P[i * 3 + 1] > 0.04 && P[i * 3 + 1] < 0.16) { const b = Math.floor(A[i] / 6.2832 * 16) % 16; bins[b] = Math.max(bins[b], Rr[i] + at(P[i * 3 + 1])[2]); }
  const nz = bins.filter((b) => b > 0);
  // the soil is heaped to a radius between the narrowest and the widest of the foot at the soil line: it buries the undersides of the lobes and banks up on the slim sides
  const lo = nz.length ? Math.min(...nz) : k * 1.05, hi = nz.length ? Math.max(...nz) : k * 1.05;
  return { g, rMin: lo + 0.6 * (hi - lo), tris: pos.length / 9 };
}

export async function add(game, ctx) {
  const world = game.world, shared = world.shared, scene = world.scene;
  const group = new THREE.Group(); group.name = 'streets_trees'; scene.add(group);

  // ---- the trees the lead placed
  const seen = new Set(), trees = [];
  for (const im of game.propMeshes || []) {
    const kind = im.userData.kind; if (kind !== 'tree' && kind !== 'tree2') continue;
    im.visible = false;
    const items = im.userData.items; if (!items || seen.has(items)) continue; seen.add(items);
    for (const p of items) trees.push({ x: p[0], y: p[1], h: p[2], s: kind === 'tree2' ? (p[3] || 1) / 0.7 : (p[3] || 1), park: kind === 'tree2' });
  }
  if (!trees.length) return { group, report: { instances: 0 } };
  // a tree standing in a park is a park tree whatever its size; the others are street trees: find their wall and their kerb
  const parks = (ctx.city.parks || []).map((p) => p.ext).filter(Boolean);
  for (const t of trees) if (!t.park) for (const p of parks) if (inPoly(t.x, t.y, p)) { t.park = true; break; }
  nearestEdge(ctx.city.buildings.filter((b) => !b.far && (b.minh || 0) < 5).map((b) => b.poly), trees, 'wall', 12);
  nearestEdge(ctx.city.blocks.map((b) => b.ext), trees, 'kerb', 12);
  nearestEdge(parks, trees, 'pk', 12);          // a street tree at a park's edge: look at what it stands on; on grass it gets no pit
  { const grass = []; if (world.cityRoot) world.cityRoot.traverse((o) => { if (o.isMesh && /^grass/.test(o.name)) grass.push(o); });
    const rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
    for (const t of trees) if (!t.park && t.pk < 2.4 && grass.length) { from.set(t.x, 60, -t.y); rc.set(from, dn); t.onGrass = rc.intersectObjects(grass, false).length > 0;
      // hard against the grass there is no room for a pit on the paving: the tree stands just inside the lawn instead
      if (!t.onGrass && t.pk < 0.7) { const l = Math.hypot(t.pkv[0], t.pkv[1]) || 1; t.from = [t.x, t.y]; t.x += t.pkv[0] / l * (t.pk + 0.7); t.y += t.pkv[1] / l * (t.pk + 0.7); t.onGrass = true; } } }
  for (const t of trees) if (!t.park) { const v = t.kerbv, l = Math.hypot(v[0], v[1]); t.kh = l > 0.05 && t.kerb < 6 ? Math.atan2(v[0], -v[1]) : t.h; }

  // ---- models
  const tl = new THREE.TextureLoader(), A = ctx.A + 'trees/';
  const tex = async (f, srgb) => { const t = await tl.loadAsync(A + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const [b12c, b12n, b14c, b14n, soilC, soilN] = await Promise.all([tex('Bark012_color.jpg', true), tex('Bark012_normal.jpg'), tex('Bark014_color.jpg', true), tex('Bark014_normal.jpg'), tex('Ground048_color.jpg', true), tex('Ground048_normal.jpg')]);
  const feet = (await (await fetch(A + 'feet.json')).json()).feet;
  const woodMats = [woodMaterial(shared, b12c, b12n, 0, soilC), woodMaterial(shared, b14c, b14n, 1, soilC), woodMaterial(shared, b12c, b12n, 2, soilC)];
  const scans = await Promise.all(feet.map(async (f) => { const normal = await tex('foot_' + f.src + '_normal.webp'); normal.flipY = false; normal.needsUpdate = true; return { map: null, normal }; }));
  const footMatCache = new Map(), footMat = (bark, fi) => { const key = bark + '_' + fi; if (!footMatCache.has(key)) { const fm = woodMaterial(shared, bark === 1 ? b14c : b12c, bark === 1 ? b14n : b12n, bark, soilC, scans[fi]); fm.side = THREE.DoubleSide; fm.shadowSide = THREE.DoubleSide; footMatCache.set(key, fm); } return footMatCache.get(key); };
  const leafMat = leafMaterial(shared), leafMatFar = leafMaterial(shared, true);
  const models = [], bySpecies = {};
  let vi = 0;
  for (const [sp, n] of VARIANTS) {
    bySpecies[sp] = [];
    for (let k = 0; k < n; k++) {
      const T = makeTree(SPECIES[sp], 101 + vi * 37 + k * 11);
      const big = sp === 'planeBig' || sp === 'broad', fi = big ? (k % 2 ? 0 : 2) : (vi + k) % 2, foot = footGeometry(feet[fi], T, SPECIES[sp], 3 + vi * 5 + k);
      T.info.rMin = foot.rMin; foot.fi = fi;
      const wpos = new THREE.BufferAttribute(T.wood.pos, 3), wnrm = new THREE.BufferAttribute(T.wood.nrm, 3), wuv = new THREE.BufferAttribute(T.wood.uv, 2), waw = new THREE.BufferAttribute(T.wood.col, 4, true), widx = new THREE.BufferAttribute(T.wood.idx, 1);
      const lods = [];
      for (let l = 0; l < 4; l++) {
        const wg = new THREE.BufferGeometry(); wg.setAttribute('position', wpos); wg.setAttribute('normal', wnrm); wg.setAttribute('uv', wuv); wg.setAttribute('aW', waw); wg.setIndex(widx); wg.setDrawRange(0, T.wood.cuts[l]);
        const L = T.leaves[l], lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(L.pos, 3)); lg.setAttribute('normal', new THREE.BufferAttribute(L.nrm, 4, true)); lg.setAttribute('aLeaf', new THREE.BufferAttribute(L.col, 4, true)); lg.setIndex(new THREE.BufferAttribute(L.idx, 1));
        lods.push({ wg, lg, tris: T.wood.cuts[l] / 3 + L.idx.length / 3 });
      }
      const m = { sp, spec: SPECIES[sp], info: T.info, lods, foot, trees: [], id: models.length };
      models.push(m); bySpecies[sp].push(m); vi++;
    }
  }

  // ---- one tree at a time: species, model, size, colour, matrix
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), Sc = new THREE.Vector3();
  const pick = (r, table) => { let a = 0; for (const [k, w] of table) { a += w; if (r < a) return k; } return table[table.length - 1][0]; };
  // the lead's collision circles (tag 'tree') follow the park trees that are moved or left out
  const circ = game.statics && game.statics.circ, circOf = (t) => {
    if (!circ) return null; const a = circ.get(game.statics.key(Math.floor(t.x / game.statics.cell), Math.floor(t.y / game.statics.cell)));
    if (a) for (const o of a) if (o.tag === 'tree' && o.on && Math.abs(o.x - t.x) < 0.02 && Math.abs(o.y - t.y) < 0.02) return o; return null; };
  let nCirc = 0;
  const sigs = new Map(); for (const g of (ctx.city.props.signal || [])) { const k = Math.floor(g[0] / 16) + ',' + Math.floor(g[1] / 16); if (!sigs.has(k)) sigs.set(k, []); sigs.get(k).push(g); }
  const nearSignal = (t) => { const cx = Math.floor(t.x / 16), cy = Math.floor(t.y / 16); for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) { const l = sigs.get(i + ',' + j); if (l) for (const g of l) if (Math.hypot(g[0] - t.x, g[1] - t.y) < 12) return true; } return false; };
  for (const t of trees) {
    const hx0 = t.from ? t.from[0] : t.x, hy0 = t.from ? t.from[1] : t.y, r = (k) => h2(t.from ? hx0 : t.x, t.from ? hy0 : t.y, k);   // a tree moved off the paving keeps the species, size and colour its planting spot gave it
    const co = t.park ? circOf(t) : null;
    if (t.park && r(15) < 0.2) { t.skip = true; if (co) { co.on = false; nCirc++; } continue; }      // lawns have gaps
    if (t.from) { const o = circOf({ x: t.from[0], y: t.from[1] }); if (o) { o.on = false; nCirc++; game.statics.addCircle(t.x, t.y, 0.25, 'tree'); } }
    if (!t.park && nearSignal(t)) { t.skip = true; const c2 = circOf(t); if (c2) { c2.on = false; nCirc++; } continue; }   // street corners are kept clear of trees
    let sp;
    if (t.park) {
      sp = pick(r(1), [['planeBig', 0.42], ['broad', 0.36], ['locust', 0.10], ['plane', 0.12]]);
      const ox = t.x, oy = t.y; t.x = ox + (r(11) - 0.5) * 7.0; t.y = oy + (h2(ox, oy, 12) - 0.5) * 7.0; t.h2 = [ox, oy];          // park trees are not planted on a grid
      if (co) { co.on = false; t.co = true; nCirc++; }
    } else {
      const cx = Math.floor(t.x / 70), cy = Math.floor(t.y / 70), lead = pick(h2(cx, cy, 5), [['plane', 0.38], ['locust', 0.36], ['pear', 0.26]]);
      sp = r(1) < 0.68 ? lead : pick(r(2), [['plane', 0.36], ['locust', 0.36], ['pear', 0.28]]);
      if (t.wall < 2.3) sp = 'pear'; else if (t.wall < 3.2 && sp === 'plane') sp = 'locust';
    }
    const list = bySpecies[sp], m = list[Math.floor(r(3) * list.length) % list.length], S = m.spec;
    let f = t.park ? (1.0 + 0.3 * Math.min(1, Math.max(0, (t.s - 1) / 0.7))) * (0.72 + 0.6 * r(4)) : (0.78 + 0.28 * Math.min(1, Math.max(0, (t.s - 0.8) / 0.5))) * (0.72 + 0.5 * r(4));
    if (r(13) < (t.park ? 0.12 : 0.07)) f *= 0.55;                                         // a young replacement tree now and then
    const cr = m.info.radius * f;
    const sAcross = t.park ? 1 : Math.max(0.5, Math.min(1.0, (t.wall + 0.9) / cr)), sAlong = 0.9 + 0.25 * r(5), sy = 0.86 + 0.3 * r(6);
    P.set(t.x, 0.15, -t.y);
    E.set((r(7) - 0.5) * 0.14, t.park ? r(8) * 6.283 : t.kh + (r(8) < 0.5 ? Math.PI : 0), (r(9) - 0.5) * 0.14, 'YXZ'); Q.setFromEuler(E);
    Sc.set(f * sAlong, f * sy, f * sAcross);
    M.compose(P, Q, Sc);
    t.R = m.info.rMin * f * Math.min(sAlong, sAcross) * 0.97;
    t.m = new Float32Array(M.elements); t.model = m; t.f = f; t.rad = Math.max(cr, S.H * f * 0.6);
    // colour: species green, brightness and a share of trees turning yellow
    const base = LEAFCOL[sp], yy = Math.pow(r(10), 2.2) * YELLOWS[sp] * 1.6, br = 0.72 + 0.56 * r(14);
    t.c = [base[0] * br * (1 + 1.0 * yy), base[1] * br * (1 + 0.38 * yy), base[2] * br * (1 - 0.4 * yy)];
    if (t.co) game.statics.addCircle(t.x, t.y, Math.max(0.22, S.trunkR * f * 1.1), 'tree');
    m.trees.push(t);
  }

  // ---- instanced meshes per model and band, filled each time the camera moves
  let leafPre = null;
  for (const m of models) {
    const cap = Math.max(1, m.trees.length); m.meshes = [];
    for (let l = 0; l < 4; l++) {
      const wood = new THREE.InstancedMesh(m.lods[l].wg, woodMats[m.spec.bark], cap), leaf = new THREE.InstancedMesh(m.lods[l].lg, l < 2 ? leafMat : leafMatFar, cap);
      wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage); leaf.instanceMatrix = wood.instanceMatrix;
      leaf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); leaf.instanceColor.setUsage(THREE.DynamicDrawUsage);
      for (const o of [wood, leaf]) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; o.count = 0; o.matrixAutoUpdate = false; o.userData.kind = 'st_tree'; group.add(o); }
      if (l === 3) wood.castShadow = false;                                  // the last band lies beyond the shadow map
      // The two far bands use the cheaper leaf material (no sky reflection) and stay out of the post chain's depth/normal pass;
      // the near and middle bands are exactly as before. Every band but the last casts its own shadow.
      leaf.castShadow = l < 3;
      // optional (opt.standins): cast each band's leaf shadow through the next band's lighter leaf mesh, drawn only in the shadow pass
      let shade = null;
      if (l < 3) { shade = new THREE.InstancedMesh(m.lods[l + 1].lg, leafMatFar, cap); shade.instanceMatrix = wood.instanceMatrix; shade.frustumCulled = false; shade.castShadow = true; shade.receiveShadow = false; shade.count = 0; shade.visible = false; shade.matrixAutoUpdate = false; shade.userData.kind = 'st_treeshade';
        shade.onBeforeRender = (r, sc, cam, g) => { g.setDrawRange(0, 0); }; shade.onBeforeShadow = (r, o, cam, sc, g) => { g.setDrawRange(0, Infinity); }; group.add(shade); }
      if (l < 2) leaf.onBeforeRender = (r, sc, cam, g) => { g.setDrawRange(0, Infinity); };
      // optional (opt.prepassFar): lay down depth for the far bands' leaves first, so each pixel of the far canopy is shaded once
      let pre = null;
      if (l >= 2) { if (!leafPre) { leafPre = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }); }
        pre = new THREE.InstancedMesh(m.lods[l].lg, leafPre, cap); pre.instanceMatrix = wood.instanceMatrix; pre.frustumCulled = false; pre.castShadow = false; pre.receiveShadow = false; pre.count = 0; pre.visible = false; pre.renderOrder = -3; pre.matrixAutoUpdate = false; pre.userData.kind = 'st_treepre';
        const pm = leafPre; pre.onBeforeRender = (r, sc, cam, g, mat) => { g.setDrawRange(0, mat === pm ? Infinity : 0); }; group.add(pre); }
      if (l >= 2) { const own = leafMatFar; leaf.onBeforeRender = (r, sc, cam, g, mat) => { g.setDrawRange(0, mat === own ? Infinity : 0); }; leaf.onBeforeShadow = (r, o, cam, sc, g) => { g.setDrawRange(0, Infinity); }; }
      let ft = null;
      if (l < 2) { ft = new THREE.InstancedMesh(m.foot.g, footMat(m.spec.bark, m.foot.fi), cap); ft.instanceMatrix = wood.instanceMatrix; ft.frustumCulled = false; ft.castShadow = false; ft.receiveShadow = true; ft.count = 0; ft.matrixAutoUpdate = false; ft.userData.kind = 'st_treefoot'; group.add(ft); }
      m.meshes.push({ wood, leaf, foot: ft, shade, pre });
    }
  }
  const opt = { standins: false, prepassFar: 'auto' };   // 'auto': the far-band depth pre-pass runs while the camera stands in a park (far canopy fills the view there)
  const frustum = new THREE.Frustum(), PM = new THREE.Matrix4(), sph = new THREE.Sphere(), last = { p: new THREE.Vector3(1e9, 0, 0), q: new THREE.Quaternion(), fov: 0 };
  const stats = { shown: [0, 0, 0, 0], tris: 0 };
  function update(force) {
    const cam = world.camera; cam.updateMatrixWorld();
    if (!force && last.p.distanceToSquared(cam.position) < 0.04 && Math.abs(last.q.dot(cam.quaternion)) > 0.99999 && last.fov === cam.fov) return;
    last.p.copy(cam.position); last.q.copy(cam.quaternion); last.fov = cam.fov;
    PM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(PM);
    const cx = cam.position.x, cz = cam.position.z, zoom = Math.tan(27 * Math.PI / 180) / Math.tan(cam.fov * Math.PI / 360);
    const near = shared.uShadowFar.value + 45;
    stats.shown = [0, 0, 0, 0]; stats.tris = 0;
    let preOn = opt.prepassFar === true; if (opt.prepassFar === 'auto') { const mx = cam.position.x, my = -cam.position.z; for (const pp of parks) if (inPoly(mx, my, pp)) { preOn = true; break; } }
    for (const m of models) {
      const n = [0, 0, 0, 0];
      for (const t of m.trees) {
        const dx = t.x - cx, dz = -t.y - cz, d = Math.hypot(dx, dz);
        sph.center.set(t.x, 7 * t.f, -t.y); sph.radius = t.rad + (d > near ? 3 : 24); if (!frustum.intersectsSphere(sph)) continue;
        const de = d / Math.max(1, zoom * 0.85), l = de < LOD_D[0] ? 0 : de < LOD_D[1] ? 1 : de < LOD_D[2] ? 2 : 3;
        const ms = m.meshes[l], i = n[l]++;
        ms.wood.instanceMatrix.array.set(t.m, i * 16); ms.leaf.instanceColor.array.set(t.c, i * 3);
      }
      for (let l = 0; l < 4; l++) {
        const ms = m.meshes[l]; ms.wood.count = ms.leaf.count = n[l]; ms.wood.visible = ms.leaf.visible = n[l] > 0; if (ms.pre) { ms.pre.count = n[l]; ms.pre.visible = preOn && n[l] > 0; } if (ms.shade) { ms.shade.count = n[l]; ms.shade.visible = opt.standins && n[l] > 0; ms.leaf.castShadow = !opt.standins && l < 3; } if (ms.foot) { ms.foot.count = n[l]; ms.foot.visible = n[l] > 0; stats.tris += n[l] * m.foot.tris; }
        if (n[l]) { ms.wood.instanceMatrix.needsUpdate = true; ms.leaf.instanceColor.needsUpdate = true; }
        stats.shown[l] += n[l]; stats.tris += n[l] * m.lods[l].tris;
      }
    }
  }
  const render0 = world.render.bind(world);
  world.render = (t, focus) => { update(false); return render0(t, focus); };
  update(true);

  // ---- pits and guards: static, per map tile
  const pitMat = pitMaterial(shared, soilC, soilN);
  const sizes = [[1.5, 1.45], [2.3, 1.45], [3.0, 1.45]];
  const pitG = sizes.map((s, i) => [['granite', false], ['cobble', false], ['granite', true], ['cobble', true]].map(([rim, pl], v) => pitGeometry(s[0], s[1], 7 + i * 5 + v * 13, rim, pl)));
  const guardG = sizes.map((s, i) => [guardGeometry(s[0], s[1], 'rail', 31 + i), guardGeometry(s[0], s[1], 'hoop', 47 + i)]);
  for (const gs of guardG) for (const g of gs) { const n = g.attributes.position.count; g.setAttribute('aDry', new THREE.Float32BufferAttribute(new Float32Array(n).fill(-1), 1)); g.setAttribute('aLift', new THREE.Float32BufferAttribute(new Float32Array(n), 1)); }
  const TT = 150, tiles = new Map(), pitTiles = []; let nPit = 0, nGuard = 0, pitTris = 0;
  for (const t of trees) {
    if (t.park || t.skip || t.onGrass) continue;
    const r = (k) => h2(t.x, t.y, 20 + k);
    const si = t.pk < 2.4 ? 0 : t.model.sp === 'plane' ? (r(1) < 0.5 ? 2 : 1) : (r(1) < 0.35 ? 0 : r(1) < 0.8 ? 1 : 2);
    // most pits have a guard; four in ten guarded pits are planted; the rim is a granite kerb or a row of setts
    const guard = r(2) < 0.62, planted = guard && r(4) < 0.4, v = (r(3) < 0.55 ? 0 : 1) + (planted ? 2 : 0);
    const k = Math.floor(t.x / TT) + ',' + Math.floor(t.y / TT); let tile = tiles.get(k);
    if (!tile) tiles.set(k, tile = { p: sizes.map(() => [[], [], [], []]), g: sizes.map(() => [[], []]), a: sizes.map(() => []) });
    let back = Math.max(0, sizes[si][1] / 2 + 0.06 - t.kerb);              // keep the pit on the sidewalk side of the kerb
    if (t.pk < 1.1) { const l = Math.hypot(t.pkv[0], t.pkv[1]) || 1, pkz = (t.pkv[0] * Math.sin(t.kh) - t.pkv[1] * Math.cos(t.kh)) / l; back = Math.max(-0.3, Math.min(0.3, back + (1.1 - t.pk) * pkz)); }   // and on the paved side of a park's edge
    E.set(0, t.kh, 0); Q2.setFromEuler(E); P.set(t.x - Math.sin(t.kh) * back, 0.15, -t.y - Math.cos(t.kh) * back); Sc.set(1, 1, 1); M.compose(P, Q2, Sc);
    const mm = M.clone(); mm.pit = [t.R, back, r(6), guard ? sizes[si][0] / 2 - 0.06 : 0]; tile.p[si][v].push(mm); tile.a[si].push(mm); if (guard) tile.g[si][r(5) < 0.5 ? 0 : 1].push(M.clone());
  }
  const apronG = sizes.map((s, i) => apronGeometry(s[0], s[1], 91 + i)), apronMat = apronMaterial(shared);
  for (const [, tile] of tiles) for (let si = 0; si < 3; si++) {
    if (tile.a[si].length) { const ag = new THREE.BufferGeometry(); for (const k in apronG[si].attributes) ag.setAttribute(k, apronG[si].attributes[k]); ag.setIndex(apronG[si].index);
      const ap = new Float32Array(tile.a[si].length * 4); tile.a[si].forEach((mm, i) => ap.set(mm.pit, i * 4)); ag.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4));
      const im = new THREE.InstancedMesh(ag, apronMat, tile.a[si].length); im.renderOrder = 6; im.onBeforeRender = (r, sc, cam, g, mat) => { g.setDrawRange(0, mat === apronMat ? Infinity : 0); }; tile.a[si].forEach((mm, i) => im.setMatrixAt(i, mm)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.receiveShadow = true; im.userData.kind = 'st_treeapron'; group.add(im); pitTiles.push(im); }
    const sets = [0, 1, 2, 3].map((v) => [tile.p[si][v], pitG[si][v], false]).concat([0, 1].map((v) => [tile.g[si][v], guardG[si][v], true]));
    for (const [list, geo, cast] of sets) {
      if (!list.length) continue;
      let g2 = geo;
      if (!cast) { g2 = new THREE.BufferGeometry(); for (const k in geo.attributes) g2.setAttribute(k, geo.attributes[k]); g2.setIndex(geo.index);
        const ap = new Float32Array(list.length * 4); list.forEach((mm, i) => ap.set(mm.pit, i * 4)); g2.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4)); }
      const im = new THREE.InstancedMesh(g2, pitMat, list.length); list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.castShadow = false; im.receiveShadow = true; im.userData.kind = cast ? 'st_treeguard' : 'st_treepit';
      group.add(im); pitTiles.push(im); if (cast) nGuard += list.length; else nPit += list.length;
      pitTris += list.length * (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    }
  }
  // pits are small things: beyond 230 m their tiles are not drawn
  const render1 = world.render; world.render = (t, focus) => { const c = world.camera.position; for (const im of pitTiles) { const b = im.boundingSphere; im.visible = Math.hypot(b.center.x - c.x, b.center.z - c.z) - b.radius < 150; } return render1(t, focus); };

  const report = { instances: trees.length, circles_moved: nCirc, models: models.length, pits: nPit, guards: nGuard, pit_ktris_city: Math.round(pitTris / 1000),
    get ktris() { return Math.round(stats.tris / 1000); }, get bands() { return stats.shown.join('/'); },
    model_ktris: models.map((m) => m.sp[0] + m.sp.slice(-1) + ':' + m.lods.map((l) => Math.round(l.tris / 100) / 10).join('/')).join(' ') };
  return { group, report, update, stats, trees, models, opt, leafMat };
}
