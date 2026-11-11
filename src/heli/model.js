// model.js: the outside of the helicopter and its moving parts (heli lane, outside-model item).
// export async function buildHeliModel(ctx) -> { root, update(f, dt, view) }
// An original light utility helicopter of the AS350 / H125 class, operator the made-up "Crosstown Air". All of it is generated here at
// load: geometry in model/shape.js and model/rotorgeo.js (lofted skins cut along window, door and panel lines), the livery picture in
// model/livery.js, the materials and the rotor's motion blur below. Model space as dims.js: origin on the ground under the mast,
// +X nose, +Y up, +Z right.
import * as THREE from 'three';
import { S, LN, SL, AO } from './model/meshkit.js';
import { podAt, doorFront } from './model/shape.js';
import { ROOT } from './model/rotorgeo.js';
import { assemble } from './model/build.js';
import { paintLivery } from './model/livery.js';
import { buildPilot } from './model/pilot.js';

const TAU = Math.PI * 2;
// what lacquer and glass mirror: the game's own cube picture of the scene round the camera (world.streetRT) once it is drawn, else nothing
const ENV = { tHeliEnv: { value: null }, uHeliEnv: { value: 0 } };
const LAYER = 5;      // the aircraft is drawn on a layer of its own, so that cube picture never holds the aircraft itself

function toGeometry(s) {
  const n = s.v.length / S, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), surf = new Float32Array(n * 4), line = new Float32Array(n * 3), v = s.v;
  for (let k = 0; k < n; k++) { const e = k * S; pos[k * 3] = v[e]; pos[k * 3 + 1] = v[e + 1]; pos[k * 3 + 2] = v[e + 2]; nrm[k * 3] = v[e + 3]; nrm[k * 3 + 1] = v[e + 4]; nrm[k * 3 + 2] = v[e + 5]; uv[k * 2] = v[e + 6]; uv[k * 2 + 1] = v[e + 7]; col[k * 3] = v[e + 8]; col[k * 3 + 1] = v[e + 9]; col[k * 3 + 2] = v[e + 10]; surf[k * 4] = v[e + 11]; surf[k * 4 + 1] = v[e + 12]; surf[k * 4 + 2] = v[e + 13]; surf[k * 4 + 3] = v[e + 14]; line[k * 3] = v[e + LN]; line[k * 3 + 1] = v[e + SL]; line[k * 3 + 2] = v[e + AO]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4)); g.setAttribute('aLine', new THREE.BufferAttribute(line, 3));
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(s.i) : new Uint16Array(s.i), 1)); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

const NOISE = /* glsl */`
  float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float hNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float hFbm(vec3 p) { return 0.5 * hNoise(p) + 0.3 * hNoise(p * 2.03 + 7.1) + 0.2 * hNoise(p * 4.1 + 3.7); }`;
// (in the body shader, after the sky occlusion: light off the ground and off what stands round. The sky map knows only the sky, so the faces that
// look down and sideways take a rough average of the scene cube.)
// which skin panel a point of the airframe is on (the same lines shape.js cuts: boom rings, frames, doors, hatch, boat line, cowl joints)
const PANEL = /* glsl */`
  float hH1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  float hPanel(vec3 p) {
    if (p.y > 2.2 && p.x < 0.75 && p.x > -2.9) return 100.0 + step(-0.34, p.x) + step(-1.12, p.x) + step(-2.0, p.x) + step(-2.5, p.x) + step(0.22, p.x) + 7.0 * step(0.0, p.z);
    float id = step(-6.62, p.x) + step(-5.84, p.x) + step(-5.13, p.x) + step(-4.42, p.x) + step(-3.72, p.x) + step(-3.0, p.x) + step(-0.61, p.x) + step(3.04, p.x);
    float side = step(0.3, abs(p.z)), inY = step(0.74, p.y) * step(p.y, 1.98) * side, df = 1.85 - 0.22 * (p.y - 1.36);
    id += 11.0 * inY * step(0.25, p.x) * step(p.x, df) + 23.0 * inY * step(-0.52, p.x) * step(p.x, 0.19);
    id += 5.0 * step(0.99, p.y) * step(p.y, 1.6) * step(-1.74, p.x) * step(p.x, -0.8) * side + 37.0 * step(p.y, 0.705) + 3.0 * step(0.0, p.z);
    return id;
  }`;
// blade flapping: a blade is bent along its span (more toward the tip when it droops at rest, nearly a straight cone under load), and
// the whole disc leans with the cyclic. uFlap = coning, disc.lon, disc.lat, rotor angle; uSpan = tip radius, flapping root.
const FLAP = /* glsl */`
  uniform vec4 uFlap; uniform vec2 uSpan;
  vec3 heliFlap(vec3 p, out float slope, out vec2 dir) {
    float r = length(p.xz); dir = p.xz / max(r, 1e-4);
    float L = uSpan.x - uSpan.y, s = clamp((r - uSpan.y) / L, 0.0, 1.0), cs = cos(uFlap.w), sn = sin(uFlap.w);
    float cpsi = dir.x * cs - dir.y * sn, spsi = dir.x * sn + dir.y * cs, tilt = -uFlap.y * cpsi - uFlap.z * spsi;
    float up = smoothstep(-0.02, 0.02, uFlap.x), shape = mix(pow(s, 1.8), pow(s, 1.25), up), dshape = mix(1.8 * pow(s, 0.8), 1.25 * pow(s, 0.25), up);
    float on = step(uSpan.y, r); slope = on * (uFlap.x * dshape + tilt);
    return vec3(p.x, p.y + on * (uFlap.x * L * shape + tilt * (r - uSpan.y)), p.z);
  }`;

// The one opaque material of the aircraft: per-corner colour, roughness, metalness and lacquer; the livery picture where a corner asks
// for it; panel gaps, window seals and grime drawn from the distances the geometry carries.
function bodyMaterial(tex, o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.085, envMapIntensity: 1, alphaHash: !!o.fade, transparent: !!o.ghost, depthWrite: !o.ghost, side: o.double ? THREE.DoubleSide : THREE.FrontSide });
  m.userData.u = o.uniforms || {};
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u, ENV);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSurf; attribute vec3 aLine; varying vec4 vSurf; varying vec3 vLine; varying vec3 vObj; varying vec3 vAx; varying vec3 vAy;' + (o.flap ? FLAP : ''))
      .replace('#include <beginnormal_vertex>', o.flap ? '#include <beginnormal_vertex>\nfloat hSlope; vec2 hDir; vec3 hPos = heliFlap(position, hSlope, hDir);\nobjectNormal = normalize(objectNormal + vec3(-hSlope * hDir.x * objectNormal.y, hSlope * dot(objectNormal.xz, hDir), -hSlope * hDir.y * objectNormal.y));' : '#include <beginnormal_vertex>\n{ vec3 hw = position; objectNormal = normalize(objectNormal + aSurf.z * 0.0025 * (vec3(sin(hw.y * 23.0 + hw.z * 17.0), sin(hw.z * 19.0 + hw.x * 13.0), sin(hw.x * 21.0 + hw.y * 15.0)) + 0.6 * vec3(sin(hw.y * 51.0 - hw.x * 37.0), sin(hw.z * 43.0 + hw.x * 47.0), sin(hw.x * 41.0 - hw.z * 53.0)))); }      // real skins are never optically flat: a faint waviness the mirror images ride on')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf; vLine = aLine; vObj = position; vAx = normalMatrix * vec3(1.0, 0.0, 0.0); vAy = normalMatrix * vec3(0.0, 1.0, 0.0);' + (o.flap ? '\ntransformed = hPos;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSurf; varying vec3 vLine; varying vec3 vObj; varying vec3 vAx; varying vec3 vAy; uniform samplerCube tHeliEnv; uniform float uHeliEnv;' + NOISE + PANEL)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(map, vMapUv).rgb, vSurf.w);\n#endif')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float hPaint = step(0.5, vSurf.z);
        // every skin panel is its own sheet: a shade of its own, a gloss of its own, and it never sits quite true to its neighbour
        float hId = hPanel(vObj); vec3 hPv = vec3(hH1(hId), hH1(hId + 17.3), hH1(hId + 41.7)) - 0.5;
        float hRun = smoothstep(0.5, 0.95, hNoise(vec3(vObj.x * 34.0, vObj.y * 2.2, vObj.z * 34.0))) * (1.0 - smoothstep(0.7, 2.3, vObj.y)) * 0.28 * hPaint;      // rain runs
        float hFw = fwidth(vLine.x) + 1e-6, hGap = clamp((max(0.0026, 0.36 * hFw) - vLine.x) / hFw + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.02, 0.05, hFw)) * mix(1.0, 0.6, smoothstep(0.004, 0.012, hFw));      // a gap is in shadow and has a dark seal behind it: it reads wider than it measures
        float hN1 = hFbm(vObj * 3.3), hN2 = hNoise(vObj * 23.0), hN3 = hNoise(vObj * vec3(9.0, 60.0, 9.0));
        float hBelly = (1.0 - smoothstep(0.45, 1.0, vObj.y)) * (0.16 + 0.05 * hN2) * hPaint;
        vec3 hEx = vObj - vec3(clamp(vObj.x, -6.3, -2.9), 2.36 - 0.075 * (-2.9 - clamp(vObj.x, -6.3, -2.9)), 0.0);
        float hSoot = exp(-dot(hEx, hEx) * 13.0) * (1.0 - smoothstep(-2.95, -2.75, vObj.x)) * (0.25 + 0.75 * smoothstep(-6.3, -3.2, vObj.x)) * (0.55 + 0.45 * hN3);
        float hSeam = (1.0 - smoothstep(0.0, 0.045, vLine.x)) * (0.3 + 0.7 * hN2);
        float hDirt = hSeam * 0.42 + hBelly + hSoot * 0.9 + hRun;
        hDirt = clamp(hDirt, 0.0, 1.0) * (0.35 + 0.65 * hPaint);
        diffuseColor.rgb = diffuseColor.rgb * (1.0 - 0.6 * hDirt) * (1.0 + 0.07 * hPv.x * hPaint) + vec3(0.05, 0.044, 0.036) * hBelly * 0.5;      // grime darkens; road dust greys the belly
        diffuseColor.rgb *= 1.0 - 0.93 * hGap;
        float hSw = fwidth(vLine.y) + 1e-6, hSeal = clamp((0.0045 - vLine.y) / hSw + 0.5, 0.0, 1.0) * step(vLine.y, 0.5) * min(1.0, 0.012 / hSw);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.022, 0.024), hSeal);
        // bare metal and black paint scuff too: fine scratches along the skids, dulled patches on the hub
        float hBare = 1.0 - hPaint;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.07, 0.065, 0.06), hBare * smoothstep(0.55, 0.9, hN3) * 0.5 * step(vObj.y, 0.7));`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(roughness * vSurf.x + hDirt * 0.35 + 0.06 * hPv.y * hPaint + hSeal * 0.3 + hBare * (hN2 - 0.5) * 0.18, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vSurf.y * (1.0 - hSeal);')
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { float hW = 0.0048, hH = -0.0019 * (1.0 - smoothstep(0.0, hW, vLine.x)) * min(1.0, 0.6 * hW / hFw);
          vec3 hSx = dFdx(-vViewPosition), hSy = dFdy(-vViewPosition), hR1 = cross(hSy, normal), hR2 = cross(normal, hSx); float hDet = dot(hSx, hR1);
          vec3 hNb = abs(hDet) * normal - sign(hDet) * (dFdx(hH) * hR1 + dFdy(hH) * hR2); if (dot(hNb, hNb) > 1e-20) normal = normalize(hNb);
          vec3 hPt = vec3(hH1(hId + 3.1), hH1(hId + 29.7), hH1(hId + 53.9)) - 0.5; normal = normalize(normal + hPaint * 0.03 * (vAx * hPt.x + vAy * hPt.y + cross(vAx, vAy) * hPt.z)); }`)
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normal;\n#endif')
      .replace('#include <opaque_fragment>', 'if (!(outgoingLight.r >= 0.0 && outgoingLight.g >= 0.0 && outgoingLight.b >= 0.0)) outgoingLight = vec3(0.0);      // one bad pixel would spread through the bloom\n#include <opaque_fragment>')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ float hAO = pow(vLine.z, 1.5), hAOs = mix(1.0, hAO, 0.85); reflectedLight.indirectDiffuse *= hAO; reflectedLight.indirectSpecular *= hAOs;\n{ vec3 hNw = inverseTransformDirection(geometryNormal, viewMatrix); float hDn = smoothstep(0.35, -0.6, hNw.y);\nvec3 hB = textureLod(tHeliEnv, hNw, 0.0).rgb + textureLod(tHeliEnv, normalize(hNw + vec3(0.55, -0.3, 0.0)), 0.0).rgb + textureLod(tHeliEnv, normalize(hNw + vec3(-0.55, -0.3, 0.0)), 0.0).rgb + textureLod(tHeliEnv, normalize(hNw + vec3(0.0, -0.3, 0.55)), 0.0).rgb + textureLod(tHeliEnv, normalize(hNw + vec3(0.0, -0.3, -0.55)), 0.0).rgb + textureLod(tHeliEnv, normalize(hNw + vec3(0.0, -0.8, 0.0)), 0.0).rgb;\nreflectedLight.indirectDiffuse += material.diffuseColor * min(hB / 6.0, vec3(3.0)) * (0.9 * hDn * uHeliEnv * hAO); }\n#ifdef USE_CLEARCOAT\nvec3 hRw = inverseTransformDirection(reflect(-geometryViewDir, geometryClearcoatNormal), viewMatrix);\nvec3 hCity = min(textureLod(tHeliEnv, hRw, 0.0).rgb, vec3(14.0)) * EnvironmentBRDF(geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness);\nclearcoatSpecularIndirect = 1.1 * mix(clearcoatSpecularIndirect, hCity, uHeliEnv * 0.72) * hAOs;      // part sky map, part scene cube: the cube alone is coarse enough to show its texels in dark paint\n#endif\n}')
      .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment.replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * vSurf.z * (1.0 - hSeal) * (1.0 - hGap) * (1.0 - 0.6 * hDirt);').replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = clamp(clearcoatRoughness + 0.25 * hDirt + 0.05 * hPv.y, 0.03, 1.0);'));
  };
  m.customProgramCacheKey = () => 'heli-body' + (o.flap ? '-flap' : '') + (o.fade ? '-fade' : '') + (o.ghost ? '-ghost' : '');
  return m;
}
// shadow pass for the bending blades
function flapDepth(uniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uniforms); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FLAP).replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat hSlope; vec2 hDir; transformed = heliFlap(position, hSlope, hDir);'); };
  m.customProgramCacheKey = () => 'heli-flapdepth'; return m;
}

// Glass: a thin tinted pane. Seen square-on you look through it; at a glancing angle it mirrors the sky; a black bonded band runs
// round its edge.
function glassMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x060809, roughness: 0.03, metalness: 0, ior: 1.7, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.25, specularIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ENV);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aLine; varying vec3 vLine; varying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLine = aLine; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLine; varying vec3 vObj; uniform samplerCube tHeliEnv; uniform float uHeliEnv;' + NOISE)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float hSw = fwidth(vLine.y) + 1e-6, hFrit = clamp((0.006 + 0.002 * hNoise(vObj * 9.0) - vLine.y) / hSw + 0.5, 0.0, 1.0) * (gl_FrontFacing ? 0.85 : 0.0);      // the bonded band is on the outer face; the inner face is the cockpit's to dress
        float hDust = 0.02 + 0.05 * hFbm(vObj * 5.0) + 0.16 * (1.0 - smoothstep(0.0, 0.07, vLine.y)) * hNoise(vObj * 40.0);
        diffuseColor.rgb = mix(diffuseColor.rgb + vec3(0.30, 0.28, 0.25) * hDust, vec3(0.02), hFrit);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.5, hFrit);')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ vec3 hRw = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix); vec3 hCity = (min(textureLod(tHeliEnv, hRw, 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw + vec3(0.11, 0.0, 0.0)), 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw - vec3(0.11, 0.0, 0.0)), 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw + vec3(0.0, 0.11, 0.0)), 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw - vec3(0.0, 0.11, 0.0)), 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw + vec3(0.0, 0.0, 0.11)), 0.0).rgb, vec3(5.0)) + min(textureLod(tHeliEnv, normalize(hRw - vec3(0.0, 0.0, 0.11)), 0.0).rgb, vec3(5.0))) / 7.0 * EnvironmentBRDF(geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness); reflectedLight.indirectSpecular = 2.1 * mix(reflectedLight.indirectSpecular, hCity, uHeliEnv * (1.0 - hFrit)); }')      // a pane has two faces: nearly twice the mirror image of one
      .replace('#include <opaque_fragment>', /* glsl */`
        float hFres = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 5.0);
        float hSpec = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(0.3, 0.6, 0.1));
        diffuseColor.a = clamp(max(mix((gl_FrontFacing ? opacity : 0.13) + hDust * 0.6, 1.0, hFres), hFrit) + hSpec * 0.5, 0.0, 1.0);      // the tint is for looking in; looking out from the cabin (the pane's back) it stays as light as it was
        if (!(outgoingLight.r >= 0.0 && outgoingLight.g >= 0.0 && outgoingLight.b >= 0.0 && diffuseColor.a >= 0.0)) { outgoingLight = vec3(0.0); diffuseColor.a = 0.0; }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'heli-glass';
  return m;
}

// What a camera sees of a turning rotor: over the exposure each blade sweeps an angle theta, so at radius r it covers the fraction
// (blade's angular width) / (theta) of the arc it passed over, with soft ends where it entered and left. One flat disc carries that,
// bent and tilted like the blades themselves. uBlur = theta (rad), fade (0 solid blades .. 1 blur), blade count, chord (m).
const BLUR_COV = /* glsl */`
  uniform vec4 uBlur; uniform vec3 uBlurGeo; uniform float uSteady;     // tip radius, root radius of the aerofoil, root chord
  float heliCover(vec3 p) {
    float r = length(p.xz), a = atan(p.z, p.x), ch = mix(uBlurGeo.z, uBlur.w, smoothstep(uBlurGeo.y, uBlurGeo.y + 0.35, r)) * (1.0 - 0.42 * pow(clamp((r - uBlurGeo.x + 0.16) / 0.16, 0.0, 1.0), 2.0));
    float w = ch / max(r, 0.05), th = max(uBlur.x, 1e-4), cov = 0.0, n = uBlur.z;
    for (int i = 0; i < 4; i++) { if (float(i) >= n) break;
      float d = a - (float(i) * 6.2831853 / n - 0.25 * w - 0.5 * th); d = abs(mod(d + 3.14159265, 6.2831853) - 3.14159265);
      cov += clamp((0.5 * (w + th) - d) / min(w, th), 0.0, 1.0) * min(1.0, w / th); }
    // Once the sweep is wide the eye (and any run of frames) no longer follows single blades: what holds still is the disc's average cover,
    // blades x chord / circumference. So once the sweep is a third of the gap between blades the picture leans on that average (lifted to what a viewer reads as a
    // rotor disc, a judgment, not a measurement) and keeps only a trace of the wedges, enough to count the blades. Fast shutters stay as computed.
    float mean = min(0.7, 6.0 * n * ch / (6.2831853 * max(r, 0.3))), k = 0.86 * uSteady * smoothstep(0.25, 0.4, th * n / 6.2831853);      // uSteady: 1 at the game's own shutter (1/50 s and slower), 0 for a stills camera's fast shutter, where the wedges are what a photograph shows      // sweep against the gap between blades
    return mix(min(cov, 1.0), mean, k) * (1.0 - smoothstep(uBlurGeo.x - 0.09, uBlurGeo.x, r));
  }`;
function blurMaterial(uniforms, o) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false });      // matt: a smeared blade has no mirror image to show
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + FLAP)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat hSlope; vec2 hDir; vec3 hPos = heliFlap(position, hSlope, hDir);\nobjectNormal = normalize(objectNormal + vec3(-hSlope * hDir.x * objectNormal.y, 0.0, -hSlope * hDir.y * objectNormal.y));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; transformed = hPos;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + BLUR_COV)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float hR = length(vObj.xz), hGz = abs(dot(normalize(vViewPosition), normalize(vNormal))), hCov = min(1.0, heliCover(vObj) * (1.0 + 0.11 * sqrt(max(0.0, 1.0 - hGz * hGz)) / max(hGz, 0.02))) * uBlur.y; if (hCov < 0.003) discard;      // a blade is thick as well as wide: seen edge-on it hides more than its chord's share of the arc
        ${o.colour}
        diffuseColor.a = 1.0 - pow(1.0 - min(hCov, 0.999), 1.0 / 3.0);`);
  };
  m.customProgramCacheKey = () => 'heli-blur-' + o.key;
  return m;
}
// The blurred rotor's shadow. The sun map's texels are far too coarse to carry a thin, part-covered disc, so near the ground the same
// coverage is laid flat along the sun's rays onto the surface below: a faint disc, darker toward the hub, with the blades' wedges in it.
function rotorShadowMaterial(uniforms) {
  return new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec3 vObj; uniform vec3 uSunTo; uniform float uGroundY;\n' + FLAP + '\nvoid main() { float s; vec2 d; vec3 p = heliFlap(position, s, d); vObj = position; vec4 w = modelMatrix * vec4(p, 1.0); w.xyz -= uSunTo * ((w.y - uGroundY) / max(uSunTo.y, 0.05)); w.y = uGroundY + 0.035; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying vec3 vObj; uniform float uShadowK;\n' + BLUR_COV + '\nvoid main() { float c = heliCover(vObj) * uBlur.y * uShadowK; if (c < 0.004) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, c); }' });
}
function discGeometry(R, r0, segs, rings, layers = [0]) {
  const pos = [], idx = [], nrm = [];
  layers.forEach((y, li) => { const base = li * (rings + 1) * segs;
    for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) { const r = r0 + (R * 1.004 - r0) * i / rings, a = j / segs * TAU; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); nrm.push(0, 1, 0); }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs, c = base + (i + 1) * segs + (j + 1) % segs, d = base + (i + 1) * segs + j; idx.push(a, b, c, a, c, d); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx); g.computeBoundingSphere(); return g;
}
// lamps: lit lenses, brighter than white so the film pass blooms them
function lampMaterial(uLamp) {
  return new THREE.ShaderMaterial({ uniforms: { uLamp: { value: uLamp } }, vertexShader: 'attribute vec4 aSurf; attribute vec3 color; uniform vec3 uLamp; varying vec3 vC; void main() { float k = aSurf.x < 0.5 ? uLamp.x : aSurf.x < 1.5 ? uLamp.y : uLamp.z; vC = color * k + color * 0.05; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }' });
}

// the baked meshes (lanes/heli/items/model/bake.mjs): every level of detail with sky occlusion in each corner
async function loadBaked() {
  const r = await fetch(new URL('../../assets/heli/model/model.bin.gz', import.meta.url)); if (!r.ok || !self.DecompressionStream) throw new Error('model.bin.gz ' + r.status);
  const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), n = new DataView(buf).getUint32(0, true), index = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))), base = 4 + n;
  if (index.S !== S) throw new Error('model.bin is from another build (corner size ' + index.S + ', code ' + S + ')');
  return index.lods.map((L) => { const o = {}; for (const k in L) o[k] = { v: new Float32Array(buf, base + L[k].v, L[k].nv * S), i: new Uint32Array(buf, base + L[k].i, L[k].ni) }; return o; });
}

export async function buildHeliModel(ctx) {
  const D = ctx.DIMS, P = ctx.game && ctx.game.P, t0 = performance.now();
  const root = new THREE.Group(); root.name = 'heli-model';
  const canvas = paintLivery(), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  // the camera's shutter: 1/50 s unless ?helishutter=<1/s> says otherwise (a stills camera at 1/500 nearly freezes the blades)
  const api = { root: null, update: null, lods: null, shutter: 1 / Math.max(10, +(P && P.get('helishutter')) || 50) };      // api.shutter may be set while it runs (stills at another shutter speed)

  const uFlap = { value: new THREE.Vector4() }, uSpan = { value: new THREE.Vector2(D.rotorR, ROOT) }, uFlap0 = { value: new THREE.Vector4() }, uSpanT = { value: new THREE.Vector2(D.tailRotorR, 0.05) };
  const uBlur = { value: new THREE.Vector4(0, 0, D.blades, D.chord) }, uBlurS = { value: new THREE.Vector4(0, 0, D.blades, D.chord) }, uSteady = { value: 1 }, uBlurT = { value: new THREE.Vector4(0, 0, 2, 0.195) }, uHeliT = { value: 0 }, uLamp = new THREE.Vector3();
  const mBody = bodyMaterial(tex), mGlass = glassMaterial(), mLamp = lampMaterial(uLamp);
  const mBlades = bodyMaterial(tex, { flap: true, fade: true, uniforms: { uFlap, uSpan } }), mTailBlades = bodyMaterial(tex, { flap: true, fade: true, uniforms: { uFlap: uFlap0, uSpan: uSpanT } });
  const dBlades = flapDepth({ uFlap, uSpan });
  const mGhost = bodyMaterial(tex, { ghost: true }), mGhostB = bodyMaterial(tex, { ghost: true, flap: true, uniforms: { uFlap, uSpan } }), mGhostT = bodyMaterial(tex, { ghost: true, flap: true, uniforms: { uFlap: uFlap0, uSpan: uSpanT } }), GB = 18, GHOSTS = 9, _m4 = new THREE.Matrix4(); let ghostTh = -1;      // the hub's arms over the shutter's sweep: so many faint copies
  const mesh = (soup, mat, par, shadow = true) => { const m = new THREE.Mesh(toGeometry(soup), mat); m.castShadow = shadow; m.receiveShadow = shadow; par.add(m); return m; };

  // ---- three levels of detail of everything that does not blur
  const lods = [], hinge = podAt(doorFront(0.95), 0.95, 1).p, hingeTop = podAt(doorFront(1.72), 1.72, 1).p, axis = new THREE.Vector3(hingeTop[0] - hinge[0], hingeTop[1] - hinge[1], hingeTop[2] - hinge[2]).normalize();
  let doorG = null, baked = null, doorTrim = null; const innerTrim = new THREE.Group(); innerTrim.name = 'heli-inner-trim';
  try { baked = await loadBaked(); } catch (e) { console.log('[heli] model: no baked meshes (' + (e && e.message) + '), building them now without sky occlusion'); }
  for (let q = 0; q < 3; q++) {
    const A = baked ? baked[q] : assemble(D, q), R = A, g = new THREE.Group(); g.name = 'lod' + q; g.visible = q === 0; root.add(g);
    // the sun's shadow pass draws a lighter stand-in for the full body: the middle level's body rides in the same buffers and only the shadow pass draws it
    let bodySoup = A.body, n0 = 0, n1 = 0;
    if (q === 0 && baked) { const B = baked[1].body, nv = A.body.v.length / S, v = new Float32Array(A.body.v.length + B.v.length), ix = new Uint32Array(A.body.i.length + B.i.length); v.set(A.body.v); v.set(B.v, A.body.v.length); ix.set(A.body.i); for (let k = 0; k < B.i.length; k++) ix[A.body.i.length + k] = B.i[k] + nv; n0 = A.body.i.length; n1 = B.i.length; bodySoup = { v, i: ix }; }
    const L = { g, body: mesh(bodySoup, mBody, g) };
    if (n1) { const bg = L.body.geometry; bg.setDrawRange(0, n0); L.body.onBeforeShadow = () => bg.setDrawRange(n0, n1); L.body.onAfterShadow = () => bg.setDrawRange(0, n0); }
    if (q < 2) { L.glass = mesh(A.glass, mGlass, g, false); L.glass.renderOrder = 2; }
    else { const gm = mesh(A.glass, mBody, g); gm.geometry.attributes.color.array.fill(0.012); gm.geometry.attributes.aSurf.array.forEach((_, i, a) => { a[i] = i % 4 === 0 ? 0.08 : i % 4 === 2 ? 1 : 0; }); }
    if (q === 0) {
      doorG = new THREE.Group(); doorG.position.set(hinge[0], hinge[1], hinge[2]); g.add(doorG);
      for (const [s, m, sh] of [[A.door, mBody, true], [A.doorGlass, mGlass, false]]) { const o = mesh(s, m, doorG, sh); if (sh && n1) o.castShadow = false;      /* the stand-in body carries the door's shadow */ o.geometry.translate(-hinge[0], -hinge[1], -hinge[2]); if (!sh) o.renderOrder = 2; }
      L.rivets = mesh(A.rivets, mBody, g, false);
      if (A.trim) { const tm = mesh(A.trim, mBody, innerTrim, false); L.trim = tm; tm.receiveShadow = true; g.add(innerTrim); doorTrim = mesh(A.doorTrim, mBody, doorG, false); doorTrim.receiveShadow = true; doorTrim.geometry.translate(-hinge[0], -hinge[1], -hinge[2]); }
    }
    L.lamps = mesh(A.lamps, mLamp, g, false);
    // main rotor: the spinning group carries the hub and the blades; the tail rotor spins about the model's Z
    L.spin = new THREE.Group(); L.spin.position.set(0, D.rotorY, 0); g.add(L.spin);
    L.hub = mesh(R.hub, mBody, L.spin); L.hub.castShadow = false;
    if (R.hubArms && R.hubArms.i.length) { L.arms = mesh(R.hubArms, mBody, L.spin); L.arms.castShadow = false;
      if (q === 0) { L.armsBlur = new THREE.InstancedMesh(L.arms.geometry, mGhost, GHOSTS); L.armsBlur.frustumCulled = false; L.armsBlur.visible = false; L.armsBlur.renderOrder = 2; L.spin.add(L.armsBlur); } }
    if (q < 2) { L.pilot = mesh(buildPilot(D, q), mBody, g, false); L.pilot.receiveShadow = true; L.pilot.visible = false; } L.blades = mesh(R.blades, mBlades, L.spin); L.blades.customDepthMaterial = dBlades; L.blades.frustumCulled = false;
    // at a fast shutter a blade is a short smear with its own thickness, twist and markings: the blade itself, drawn faintly many times over its sweep
    if (q < 2) { L.bladesBlur = new THREE.InstancedMesh(L.blades.geometry, mGhostB, GB); L.bladesBlur.frustumCulled = false; L.bladesBlur.visible = false; L.bladesBlur.renderOrder = 3; L.spin.add(L.bladesBlur); }
    const tg = new THREE.Group(); tg.position.set(D.tailRotor[0], D.tailRotor[1], D.tailRotor[2]); tg.rotation.x = Math.PI / 2; g.add(tg);
    L.tspin = new THREE.Group(); tg.add(L.tspin); L.thub = mesh(R.tailHub, mBody, L.tspin); L.thub.castShadow = false; L.tblades = mesh(R.tailBlades, mTailBlades, L.tspin); L.tblades.castShadow = false;
    if (q < 2) { L.tbladesBlur = new THREE.InstancedMesh(L.tblades.geometry, mGhostT, GB); L.tbladesBlur.frustumCulled = false; L.tbladesBlur.visible = false; L.tbladesBlur.renderOrder = 3; L.tspin.add(L.tbladesBlur); }
    lods.push(L);
  }
  // ---- the blurred discs (one each, shared by every level of detail)
  const mainBlur = new THREE.Mesh(discGeometry(D.rotorR, ROOT, 96, 10, [-0.017, 0, 0.017]), blurMaterial({ uFlap, uSpan, uBlur, uSteady, uBlurGeo: { value: new THREE.Vector3(D.rotorR, 0.9, 0.17) } }, { key: 'main', colour: /* glsl */`
    float hTop = gl_FrontFacing ? 1.0 : 0.0;
    float hWide = smoothstep(0.25, 0.4, uBlur.x * uBlur.z / 6.2831853); vec3 hc = mix(vec3(0.15, 0.16, 0.17), mix(vec3(0.27, 0.28, 0.30), vec3(0.17, 0.175, 0.185), hWide), hTop);
    hc = mix(hc, vec3(0.78, 0.76, 0.70), (1.0 - 0.7 * hWide) * smoothstep(${(D.rotorR - 0.63).toFixed(3)}, ${(D.rotorR - 0.61).toFixed(3)}, hR) * (1.0 - smoothstep(${(D.rotorR - 0.51).toFixed(3)}, ${(D.rotorR - 0.49).toFixed(3)}, hR)));
    hc = mix(hc, vec3(0.67, 0.37, 0.004), (1.0 - 0.7 * hWide) * smoothstep(${(D.rotorR - 0.33).toFixed(3)}, ${(D.rotorR - 0.31).toFixed(3)}, hR));
    hc = mix(hc, vec3(0.012), smoothstep(${(D.rotorR - 0.04).toFixed(3)}, ${(D.rotorR - 0.03).toFixed(3)}, hR));
    hc = mix(hc, vec3(0.13, 0.14, 0.15), 1.0 - smoothstep(0.95, 1.2, hR));
    diffuseColor.rgb = hc;` }));
  mainBlur.position.set(0, D.rotorY, 0); mainBlur.frustumCulled = false; mainBlur.renderOrder = 3; root.add(mainBlur);
  const uSunTo = { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uGroundY = { value: 0 }, uShadowK = { value: 0 };
  const rotorShadow = new THREE.Mesh(discGeometry(D.rotorR, ROOT, 96, 10), rotorShadowMaterial({ uFlap, uSpan, uBlur: uBlurS, uSteady, uBlurGeo: { value: new THREE.Vector3(D.rotorR, 0.9, 0.17) }, uSunTo, uGroundY, uShadowK })); rotorShadow.position.set(0, D.rotorY, 0); rotorShadow.frustumCulled = false; rotorShadow.renderOrder = 1; root.add(rotorShadow);
  const tailG = new THREE.Group(); tailG.position.set(D.tailRotor[0], D.tailRotor[1], D.tailRotor[2]); tailG.rotation.x = Math.PI / 2; root.add(tailG);
  const tailBlur = new THREE.Mesh(discGeometry(D.tailRotorR, 0.05, 48, 6, [-0.008, 0, 0.008]), blurMaterial({ uFlap: uFlap0, uSpan: uSpanT, uBlur: uBlurT, uSteady, uBlurGeo: { value: new THREE.Vector3(D.tailRotorR, 0.1, 0.07) } }, { key: 'tail', colour: /* glsl */`
    vec3 hc = vec3(0.27, 0.28, 0.30); float hT = ${D.tailRotorR.toFixed(3)} - hR;
    hc = mix(hc, vec3(0.014), 1.0 - smoothstep(0.02, 0.03, hT));
    diffuseColor.rgb = hc;` }));
  tailBlur.frustumCulled = false; tailBlur.renderOrder = 3; tailG.add(tailBlur);

  // the mirror cube: a blank one with storage until the game's is live (a sampler must never sit on an undrawn cube)
  const W = ctx.world, blank = new THREE.WebGLCubeRenderTarget(2);
  if (W && W.renderer) { const r = W.renderer, old = r.getRenderTarget(); for (let fc = 0; fc < 6; fc++) { r.setRenderTarget(blank, fc); r.clear(); } r.setRenderTarget(old); }
  ENV.tHeliEnv.value = blank.texture; const mirrorOff = P && P.get('helimirror') === '0';
  root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER); }); if (W && W.camera) W.camera.layers.enable(LAYER);
  let cur = 0;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  console.log('[heli] model built in ' + Math.round(performance.now() - t0) + ' ms: ' + lods.map((L) => { let n = 0; L.g.traverse((o) => { if (o.isMesh) n += o.geometry.index.count / 3; }); return Math.round(n / 1000) + 'k'; }).join(' / ') + ' triangles');

  const smearB = (inst, mat, sweep, w, on) => { inst.visible = on; if (!on) return; if (!(Math.abs(sweep - inst.userData.th) <= 1e-4)) { inst.userData.th = sweep; for (let k = 0; k < GB; k++) inst.setMatrixAt(k, _m4.makeRotationY((k / (GB - 1) - 0.5) * sweep)); inst.instanceMatrix.needsUpdate = true; } return 1 - Math.pow(1 - Math.min(0.97, w / sweep), 1 / Math.max(1, GB * w / (sweep + w))); };
  function update(f, dt, view) {
    // which level of detail (a little slack so it does not flicker at the edge)
    const live = !mirrorOff && W && W.streetRT && !W.streetOff && (W.streetN || 0) > 24 && W.shared.tStreet.value === W.streetRT.texture;
    ENV.tHeliEnv.value = live ? W.streetRT.texture : blank.texture; ENV.uHeliEnv.value = live ? 1 : 0; if (view.camera && !view.camera.layers.isEnabled(LAYER)) view.camera.layers.enable(LAYER);
    const d = view.dist, want = d < (cur === 0 ? 46 : 42) ? 0 : d < (cur <= 1 ? 215 : 200) ? 1 : 2;
    if (want !== cur) { lods[cur].g.visible = false; lods[want].g.visible = true; cur = want; }
    const L = lods[cur];
    // rotors
    const shutter = api.shutter, om = f.nr * D.rpm * TAU / 60, th = om * shutter, fade = sstep(0.008, 0.035, th);
    L.spin.rotation.y = -f.rotorAngle; mainBlur.rotation.y = -f.rotorAngle;
    // a parked aircraft is not stepped by the flight model, so its coning stays 0: the blades' own droop at rest is put back here, and deepened (they sag about 0.55 m at the tip)
    // at rest the flight model reports the hang (coning -0.055); the blades here are a little limper than its straight cone (about 0.65 m at the tip)
    const rest = Math.min(1, Math.max(0, 1 - f.nr * 2.2)), cone = (f.nr < 0.02 && Math.abs(f.coning) < 1e-6 ? -0.055 : f.coning) * (1 + 1.4 * rest);
    uFlap.value.set(cone, f.disc.lon, f.disc.lat, f.rotorAngle); uHeliT.value = view.t || 0; uSteady.value = sstep(1 / 80, 1 / 55, shutter);
    // three pictures of a turning blade: the blade itself (still or nearly), the blade smeared over a short sweep (fast shutters), the disc (wide sweeps)
    const gh = !!L.bladesBlur, disc = gh ? sstep(0.62, 0.8, th) : fade, ghostOn = gh && th > 0.02 && disc < 0.995;
    uBlur.value.x = th; uBlur.value.y = disc; uBlurS.value.x = th; uBlurS.value.y = fade;
    if (gh) { const a = smearB(L.bladesBlur, mGhostB, th, 0.09, ghostOn); if (ghostOn) mGhostB.opacity = a * (1 - disc); }
    if (L.arms) { const smear = !!L.armsBlur && th > 0.02; L.arms.visible = !smear; if (L.armsBlur) { L.armsBlur.visible = smear;
      if (smear && Math.abs(th - ghostTh) > 1e-4) { ghostTh = th; const sw = Math.min(th, 2.1); for (let k = 0; k < GHOSTS; k++) L.armsBlur.setMatrixAt(k, _m4.makeRotationY((k / (GHOSTS - 1) - 0.5) * sw)); L.armsBlur.instanceMatrix.needsUpdate = true; mGhost.opacity = 1 - Math.pow(1 - Math.min(0.985, 0.55 / (0.55 + th)), 1 / GHOSTS); } } }
    if (L.pilot) L.pilot.visible = !view.piloted && !view.inside && (f.engine !== 'off' || f.nr > 0.05);      // someone is flying it when the game has put nobody in the seat
    mBlades.opacity = gh ? 1 : 1 - fade; L.blades.visible = gh ? th <= 0.02 : fade < 0.995; L.blades.castShadow = fade < 0.5; mainBlur.visible = disc > 0.005;
    if (view.inside) uBlur.value.y *= 0.16;      // lead, Nov 10 (Matt: the inside view "got all weird" high up): from the seat the turning rotor is a faint flicker overhead, not a grey dome across the windscreen
    const sk = 0.78 * (1 - sstep(8, 22, f.agl || 0)); rotorShadow.visible = fade > 0.005 && sk > 0.01 && cur < 2; rotorShadow.rotation.y = -f.rotorAngle; uShadowK.value = sk; uGroundY.value = f.surface || 0; if (W && W.sunDir) uSunTo.value.copy(W.sunDir);
    const omT = f.nr * D.tailRpm * TAU / 60, thT = omT * shutter, fadeT = sstep(0.012, 0.05, thT), ght = !!L.tbladesBlur, discT = ght ? sstep(2.3, 2.7, thT) : fadeT, ghostT = ght && thT > 0.03 && discT < 0.995;
    L.tspin.rotation.y = -f.tailAngle; tailBlur.rotation.y = -f.tailAngle; uBlurT.value.x = thT; uBlurT.value.y = discT;
    if (ght) { const a = smearB(L.tbladesBlur, mGhostT, thT, 0.3, ghostT); if (ghostT) mGhostT.opacity = a * (1 - discT); }
    mTailBlades.opacity = ght ? 1 : 1 - fadeT; L.tblades.visible = ght ? thT <= 0.03 : fadeT < 0.995; tailBlur.visible = discT > 0.005;
    // the pilot's door
    if (doorG) doorG.quaternion.setFromAxisAngle(axis, (view.door || 0) * 1.22);
    if (L.trim) L.trim.visible = d < 26;      // through the glass the far wall stops mattering past this
    if (doorTrim) doorTrim.visible = innerTrim.visible && d < 26;      // the door's own inner panel rides on the door; it follows the group's switch
    // lamps: steady position lights and the landing light with the rotor turning, the red beacon flashing
    const on = f.nr > 0.2 ? 1 : 0, t = view.t || 0, ph = t % 1.25;
    uLamp.set(on * 9, on * (ph < 0.07 || (ph > 0.18 && ph < 0.24) ? 90 : 0.4), on * 55);
    if (L.rivets) L.rivets.visible = d < 8.5;      // a rivet is under a pixel beyond this
  }
  // innerTrim: everything of ours that exists only to be seen from inside (cabin liner, inner window reveals, rear bulkhead; the door's inner
  // panel follows it). Hide it (innerTrim.visible = false) while the camera is inside and the cockpit draws its own; the outside does not change
  // except that through the glass the far wall is then the cockpit's to show.
  api.root = root; api.update = update; api.lods = lods; api.innerTrim = innerTrim; return api;
}
