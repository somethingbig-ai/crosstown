// model.js: the outside of the helicopter and its moving parts (heli lane, outside-model item).
// export async function buildHeliModel(ctx) -> { root, update(f, dt, view), innerTrim, exhaust, lods, shutter }
// An original light utility helicopter of the AS350 / H125 class, operator the made-up "Crosstown Air". The aircraft is modelled in Blender
// (lanes/heli/items/model/blender/: a high-detail model with real panel gaps, door shuts, fasteners, louvres and hardware, baked onto the
// game-weight mesh) and arrives as assets/heli/model/heli.glb (three levels of detail, colours in the corners) with normal.png (baked
// normals), orm.jpg (red: baked occlusion, green: roughness) and tint.jpg (dirt). Only what must be live is code: the rotors' turning, blade
// flex and motion blur, the pilot's door, the lamps, the levels of detail and the seated pilot.
// Model space as dims.js: origin on the ground under the mast, +X nose, +Y up, +Z right.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S } from './model/meshkit.js';
import { podAt, doorFront } from './model/shape.js';
import { buildPilot } from './model/pilot.js';

const TAU = Math.PI * 2;
const LAYER = 5;        // the aircraft is drawn on a layer of its own, so the game's cube picture of the street never holds the aircraft itself
const ROOT = 0.25;      // where a blade starts to bend (m from the mast)
const COPIES = 32;      // a blade over a short exposure: so many faint copies of the blade itself across the angle it swept
const CHORD = 0.30;     // the blade as drawn (our own constant: dims.js carries 0.35 for the flight model; at 0.35 every judge called the blades planks)
const BK = 0.11;
const SEAT = 0.3;       // from the pilot's seat the disc overhead is this share of its outside strength (a flicker, never a dome)
const EXHAUST = [-3.02, 2.40, 0];      // the pipe's end, model space (the wash reads it)

// blade flapping: a blade is bent along its span (more toward the tip when it droops at rest, nearly a straight cone under load), and
// the whole disc leans with the cyclic. uFlap = coning, disc.lon, disc.lat, rotor angle; uSpan = tip radius, flapping root.
const FLAP = /* glsl */`
  uniform vec4 uFlap; uniform vec2 uSpan;
  vec3 heliFlap(vec3 p, out float slope, out vec2 dir) {
    float r = length(p.xz); dir = p.xz / max(r, 1e-4);
    float L = uSpan.x - uSpan.y, s = clamp((r - uSpan.y) / L, 0.0, 1.0), cs = cos(uFlap.w), sn = sin(uFlap.w);
    float cpsi = dir.x * cs - dir.y * sn, spsi = dir.x * sn + dir.y * cs, tilt = -uFlap.y * cpsi - uFlap.z * spsi;
    float up = smoothstep(-0.02, 0.02, uFlap.x), shape = mix(pow(s, 1.8), pow(s, 1.5), up), dshape = mix(1.8 * pow(s, 0.8), 1.5 * pow(s, 0.5), up);
    float on = step(uSpan.y, r); slope = on * (uFlap.x * dshape + tilt);
    return vec3(p.x, p.y + on * (uFlap.x * L * shape + tilt * (r - uSpan.y)), p.z);
  }`;
// What a camera sees of a turning rotor: over the exposure each blade sweeps an angle th, so at radius r it covers the fraction
// (blade's angular width) / th of the arc it passed over, with soft ends where it entered and left. One flat sheet carries that.
// uBlur = sweep (rad), strength, blade count, chord (m); uGeo = tip radius, cuff start, cuff end, width of the hub's arm.
const COVER = /* glsl */`
  uniform vec4 uBlur; uniform vec4 uGeo; uniform float uSteady; uniform float uLayers;
  float heliCover(vec3 p) {
    float r = length(p.xz), a = atan(p.z, p.x), tip = sqrt(max(0.0, 1.0 - pow(max(0.0, (r - uGeo.x + 0.2) / 0.2), 2.0)));
    float ch = mix(uGeo.w, uBlur.w, smoothstep(uGeo.y, uGeo.z, r)) * (0.42 + 0.58 * tip), w = ch / max(r, 0.05), th = max(uBlur.x, 1e-4), n = uBlur.z, cov = 0.0, fa = length(fwidth(p.xz)) / max(r, 0.05);
    for (int i = 0; i < 4; i++) { if (float(i) >= n) break;
      float d = a - (float(i) * 6.2831853 / n - 0.23 * w); d = abs(mod(d + 3.14159265, 6.2831853) - 3.14159265);
      cov += clamp((0.5 * (w + th) - d) / max(min(w, th), fa) + 0.5 * step(th, fa), 0.0, 1.0) * min(1.0, w / th); }
    // Once the sweep is wide the eye no longer follows single blades from frame to frame: what holds still is the disc's average cover
    // (blades x chord / circumference). At the game's own shutter the picture leans on that average and keeps the wedges on top of it, enough to count the blades.
    float mean = clamp(5.5 * n * w / 6.2831853, 0.46, 0.7), k = 0.8 * uSteady * smoothstep(0.15, 0.3, th * n / 6.2831853);      // lifted to what a viewer reads as a rotor disc (a judgment, not a measurement)
    return mix(min(cov, 1.0), mean + min(1.0, cov * 3.0) * 0.75, k) * (1.0 - smoothstep(uGeo.x - 0.03, uGeo.x, r));
  }`;

function flapPatch(m, uniforms, key) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FLAP)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat hSlope; vec2 hDir; vec3 hPos = heliFlap(position, hSlope, hDir);\nobjectNormal = normalize(objectNormal + vec3(-hSlope * hDir.x * objectNormal.y, hSlope * dot(objectNormal.xz, hDir), -hSlope * hDir.y * objectNormal.y));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = hPos;');
  };
  m.customProgramCacheKey = () => 'heli-flap-' + key; return m;
}
// Light off the ground: the game's sky map is dark under the horizon, so without this a belly in flight is a black void. A face that looks
// down takes the sun's light as a sunlit city gives it back (albedo about 0.14), no texture read.
const uGround = { value: new THREE.Color(0.3, 0.29, 0.27) };
function bounce(m, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.uniforms.uHeliGround = uGround;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHeliGround;').replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n#if defined( RE_IndirectDiffuse )\nirradiance += uHeliGround * (0.5 - 0.5 * inverseTransformDirection(geometryNormal, viewMatrix).y);\n#endif'); };
  m.customProgramCacheKey = () => 'heli-bounce-' + key; return m;
}
// Panel gaps, door shuts and rivet rows drawn in the paint's shader from the layout the skins were cut to (model/shape.js W and L, and the
// Blender build's doghouse lines), at a width that never falls under about a pixel: the baked ones are for close up and are gone by 20 m.
// A gap darkens the paint and dents the normal, so its lower edge takes the light and its upper edge the shade: depth, not a drawn line.
const SEAM = /* glsl */`
  float hRA(vec4 d, float r) { vec4 q = r - d; float mx = max(max(q.x, q.y), max(q.z, q.w)); return r - (length(max(q, 0.0)) + min(mx, 0.0)); }
  #define HS(f) { t = (f); if (abs(t) < abs(d)) d = t; }
  #define HR(f) { t = (f); if (abs(t) < abs(e)) e = t; }
  vec2 heliSeam(vec3 p) {      // x: distance to the nearest seam, y: to the nearest rivetted seam (m)
    float d = 1e3, e = 1e3, t, az = abs(p.z);
    if (p.y > 2.19 && p.x > -2.9 && p.x < 0.82) {
      HR(p.x - 0.22) HR(p.x + 0.34) HR(p.x + 1.12) HR(p.x + 2.0) HR(p.x + 2.5)
      if (p.y > 2.3) HR(hRA(vec4(p.x + 1.05, -0.4 - p.x, az + 1.0, 0.2 - az), 0.04))
    } else if (p.x < -6.66 && (p.y > 2.12 || p.y < 1.83)) {
      HR(p.y - 2.22) HR(p.y - 2.56) HR(p.y - 1.5)
    } else {
      float df = 1.85 - 0.22 * (p.y - 1.36);
      HR(p.x + 3.0) HR(p.x + 4.42) HR(p.x + 5.84) HR(p.x + 6.62) HR(p.x + 3.72) HR(p.x + 5.13) HR(p.x + 0.61) HR(3.04 - p.x)
      HS(0.705 - p.y)
      if (az > 0.3) { HS(hRA(vec4(df - p.x, p.x - 0.25, p.y - 0.74, 1.98 - p.y), 0.06)) HS(hRA(vec4(p.x + 0.52, 0.19 - p.x, p.y - 0.74, 1.98 - p.y), 0.06)) }
      if (az > 0.2) HR(hRA(vec4(p.x + 1.74, -0.80 - p.x, p.y - 0.99, 1.60 - p.y), 0.07))
      if (az > 0.15) HR(hRA(vec4(p.x + 2.55, -1.98 - p.x, p.y - 1.50, 1.93 - p.y), 0.045))
      if (p.z < -0.3) HS(0.058 - length(vec2(p.x + 1.08, p.y - 1.80)))
      if (p.z > 0.1 && p.y > 0.9) HR(hRA(vec4(p.x - 2.5, 2.92 - p.x, p.y - 0.965, 1.115 - p.y), 0.03))
      if (p.y > 1.9) HR(hRA(vec4(p.x + 0.5, 0.74 - p.x, az + 1.0, 0.7 - az), 0.05))
      if (p.y < 0.8) HR(hRA(vec4(p.x + 1.15, 1.95 - p.x, az + 1.0, 0.36 - az), 0.05))
    }
    if (abs(e) < abs(d)) d = e;
    return vec2(d, e);
  }`;
function seams(m, off, key) {
  const prev = m.onBeforeCompile, uOff = { value: new THREE.Vector3(off[0], off[1], off[2]) };
  m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.uniforms.uHeliOff = uOff;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; uniform vec3 uHeliOff;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position + uHeliOff;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + SEAM)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float hFw = length(fwidth(vObj)) * 0.7 + 1e-5; vec2 hSd = heliSeam(vObj); float hOn = step(0.5, vObj.y) * (1.0 - smoothstep(0.03, 0.07, hFw));
        float hW = max(0.0045, 0.6 * hFw), hGap = (1.0 - smoothstep(hW * 0.6, hW * 1.4, abs(hSd.x))) * hOn;
        float hRr = max(0.004, 0.55 * hFw), hRiv = (1.0 - smoothstep(hRr * 0.6, hRr * 1.3, length(vec2((abs(fract(dot(vObj, vec3(0.7, 0.83, 0.61)) / 0.055) - 0.5)) * 0.055, abs(abs(hSd.y) - 0.02))))) * hOn * (1.0 - smoothstep(0.012, 0.025, hFw));
        diffuseColor.rgb *= (1.0 - mix(0.9, 0.6, smoothstep(0.004, 0.012, hFw)) * hGap) * (1.0 - 0.22 * hRiv); vec3 hSeamDn = vec3(0.0);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { float hW2 = hW * 2.2, hH = -0.3 * hW2 * (1.0 - smoothstep(0.0, hW2, abs(hSd.x))) * hOn * smoothstep(0.0015, 0.005, hFw);      // close up the baked normals carry the gap: the dent here is for distance
          vec3 hSx = dFdx(-vViewPosition), hSy = dFdy(-vViewPosition), hR1 = cross(hSy, normal), hR2 = cross(normal, hSx); float hDet = dot(hSx, hR1);
          vec3 hNb = abs(hDet) * normal - sign(hDet) * (dFdx(hH) * hR1 + dFdy(hH) * hR2); if (dot(hNb, hNb) > 1e-20) { hNb = normalize(hNb); hSeamDn = hNb - normal; normal = hNb; } }`)
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = normalize(clearcoatNormal + 0.25 * hSeamDn);\n#endif')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = min(1.0, roughnessFactor + 0.4 * hGap);'); };
  m.customProgramCacheKey = () => 'heli-seam-' + key; return m;
}
function flapDepth(uniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uniforms); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FLAP).replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat hSlope; vec2 hDir; transformed = heliFlap(position, hSlope, hDir);'); };
  m.customProgramCacheKey = () => 'heli-flapdepth'; return m;
}
// the blurred rotor: one sheet, lit like the blades (sun and sky light, no mirror), its cover from COVER; never a hard rim, never hashed
function discMaterial(uniforms, colour, key) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + FLAP)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat hSlope; vec2 hDir; vec3 hPos = heliFlap(position, hSlope, hDir);\nobjectNormal = normalize(objectNormal + vec3(-hSlope * hDir.x * objectNormal.y, 0.0, -hSlope * hDir.y * objectNormal.y));')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; transformed = hPos;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + COVER)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat hR = length(vObj.xz), hCov = heliCover(vObj) * uBlur.y; if (hCov < 0.004) discard;\n' + colour + '\ndiffuseColor.a = 1.0 - pow(1.0 - min(hCov, 0.999), 1.0 / max(uLayers, 1.0));');
  };
  return bounce(m, 'disc-' + key);
}
// The blurred rotor's shadow near the ground: the sun map's texels are far too coarse for a thin, part-covered disc, so the same cover is
// laid flat along the sun's rays onto the surface below.
function rotorShadowMaterial(uniforms) {
  return new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec3 vObj; uniform vec3 uSunTo; uniform float uGroundY;\n' + FLAP + '\nvoid main() { float s; vec2 d; vec3 p = heliFlap(position, s, d); vObj = position; vec4 w = modelMatrix * vec4(p, 1.0); w.xyz -= uSunTo * ((w.y - uGroundY) / max(uSunTo.y, 0.05)); w.y = uGroundY + 0.035; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying vec3 vObj; uniform float uShadowK;\n' + COVER + '\nvoid main() { float c = heliCover(vObj) * uBlur.y * uShadowK * (1.0 - smoothstep(uGeo.x - 1.2, uGeo.x, length(vObj.xz))); if (c < 0.004) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, c); }' });
}
function discGeometry(sheets, segs) {      // sheets: [y, inner radius, outer radius, rings]
  const pos = [], idx = [], nrm = []; let base = 0;
  for (const [y, r0, r1, rings] of sheets) {
    for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) { const r = r0 + (r1 - r0) * i / rings, a = j / segs * TAU; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); nrm.push(0, 1, 0); }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs, c = base + (i + 1) * segs + (j + 1) % segs, d = base + (i + 1) * segs + j; idx.push(a, b, c, a, c, d); }
    base += (rings + 1) * segs;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx); g.computeBoundingSphere(); return g;
}
// Glass: a thin tinted pane. Seen square-on you look through it; at a glancing angle it mirrors the sky, sharply.
const uHeliIn = { value: 0 };      // 1 while the camera is the pilot's eyes
function glassMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x07090b, roughness: 0.0, metalness: 0, ior: 2.0, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.6, specularIntensity: 1 });      // the index is raised to stand for a pane's two faces
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHeliGround = uGround; sh.uniforms.uHeliIn = uHeliIn;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHeliGround; uniform float uHeliIn;').replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n{ vec3 hR = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix); float hG = 0.2 + 0.8 * pow(1.0 - saturate(dot(geometryViewDir, geometryNormal)), 5.0); if (uHeliIn < 0.5) reflectedLight.indirectSpecular += uHeliGround * 2.5 * hG * smoothstep(0.15, -0.25, hR.y); }      // the sky map is dark under the horizon: a pane seen from below mirrors the sunlit city\n').replace('#include <opaque_fragment>', /* glsl */`
      float hIn = 1.0 - uHeliIn, hF = mix(0.03, 0.2, hIn) + mix(0.5, 0.8, hIn) * pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 5.0), hS = dot(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(0.3, 0.6, 0.1));
      diffuseColor.a = clamp(mix(mix(0.06, opacity, hIn), 1.0, hF) + hS * mix(0.1, 0.8, hIn), 0.0, 1.0);      // looking out from the cabin the pane is clear: the tint, the mirror and the ground's reflection are for looking in. (By the camera, not by the face: which face is 'front' proved unreliable here and made the view from the seat milky.)
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'heli-glass2'; return m;
}
function pilotGeometry(s) {
  const n = s.v.length / S, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), v = s.v;
  for (let k = 0; k < n; k++) { const e = k * S; pos[k * 3] = v[e]; pos[k * 3 + 1] = v[e + 1]; pos[k * 3 + 2] = v[e + 2]; nrm[k * 3] = v[e + 3]; nrm[k * 3 + 1] = v[e + 4]; nrm[k * 3 + 2] = v[e + 5]; col[k * 3] = v[e + 8]; col[k * 3 + 1] = v[e + 9]; col[k * 3 + 2] = v[e + 10]; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(s.i) : new Uint16Array(s.i), 1)); g.computeBoundingSphere(); return g;
}
const assetURL = (name) => new URL('../../assets/heli/model/' + name, import.meta.url).href;
async function loadGLB(name) { const r = await fetch(assetURL(name)); if (!r.ok) throw new Error(name + ' ' + r.status); return new GLTFLoader().parseAsync(await r.arrayBuffer(), ''); }
async function loadTex(name, srgb) {
  try { const t = await new THREE.TextureLoader().loadAsync(assetURL(name)); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; } catch (e) { console.log('[heli] model: no ' + name); return null; }
}

export async function buildHeliModel(ctx) {
  const D = ctx.DIMS, P = ctx.game && ctx.game.P, W = ctx.world, t0 = performance.now();
  const root = new THREE.Group(); root.name = 'heli-model';
  // the camera's shutter: 1/50 s unless ?helishutter=<1/s> says otherwise (a stills camera at 1/1000 nearly freezes the blades). api.shutter may be set while it runs.
  const api = { root, update: null, lods: null, innerTrim: null, exhaust: EXHAUST.slice(), shutter: 1 / Math.max(10, +(P && P.get('helishutter')) || 50) };
  const [gltf, tNormal, tOrm, tTint] = await Promise.all([loadGLB('heli.glb'), loadTex('normal.png'), loadTex('orm.jpg'), loadTex('tint.jpg', true)]);

  // ---- the meshes of the file, gathered by level of detail, group and surface class
  const bins = new Map();
  gltf.scene.traverse((o) => { if (!o.isMesh) return; const u = o.userData, g = o.geometry, k = (u.lod | 0) + '|' + u.grp + '|' + u.cls + '|' + (g.attributes.uv ? 1 : 0); for (const a in g.attributes) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(g); });
  const uFlap = { value: new THREE.Vector4() }, uSpan = { value: new THREE.Vector2(D.rotorR, ROOT) }, uSteady = { value: 1 }, uLayers = { value: 3 }, uOne = { value: 1 };
  const NS = () => new THREE.Vector2(1, -1);      // the file's UVs run top-down (glTF), and the tangents come from them in the shader
  const maps = (o, coat) => Object.assign(o, tNormal ? { normalMap: tNormal, normalScale: NS() } : {}, {},      /* the lacquer's own normal is the smooth skin plus the shader's seams: a second read of the normal map cost more than it showed */ tOrm ? { aoMap: tOrm, roughnessMap: tOrm } : {}, tTint ? { map: tTint } : {});
  // with the baked map, green carries the roughness as a share of the material's (0.62 where clean)
  const mkPaint = (off, key) => seams(bounce(new THREE.MeshPhysicalMaterial(maps({ vertexColors: true, roughness: tOrm ? 0.55 : 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4 }, true)), 'paint'), off, key);
  const mats = {
    'paint|1': mkPaint([0, 0, 0], 'body'),
    'metal|1': bounce(new THREE.MeshStandardMaterial(maps({ vertexColors: true, color: 0x9a9a9a, roughness: tOrm ? 0.5 : 0.3, metalness: 1, envMapIntensity: 1.0 })), 'metal'),
    'matte|1': bounce(new THREE.MeshStandardMaterial(maps({ vertexColors: true, roughness: tOrm ? 1.0 : 0.62, metalness: 0 })), 'matte'),
    'metal|0': bounce(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9a9a9a, roughness: 0.4, metalness: 1 }), 'metal0'),
    'matte|0': bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }), 'matte0'),
    'liner|0': bounce(new THREE.MeshLambertMaterial({ vertexColors: true }), 'liner'),
    'decal|0': bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'decal'),
    'glass|0': glassMaterial(),
  };
  const lampCol = { lamp_red: [1, 0.03, 0.02, 0], lamp_green: [0.03, 1, 0.12, 0], lamp_tail: [1, 0.95, 0.85, 0], lamp_strobe: [1, 0.05, 0.03, 1], lamp_land: [1, 0.96, 0.88, 2] }, lamps = [];
  const mBlades = bounce(flapPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }), { uFlap, uSpan }, 'blade'), 'blade');
  const mCopies = bounce(flapPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false }), { uFlap, uSpan }, 'copies'), 'copies');
  const mTailBlades = bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }), 'tb'), mTailCopies = bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false }), 'tc');
  for (const m of [mBlades, mTailBlades]) m.color.setRGB(BK, BK, BK);
  const dBlades = flapDepth({ uFlap, uSpan }), ARMS = 12, mArmCopies = bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6, transparent: true, depthWrite: false }), 'arms'); let armTh = -1;
  const matFor = (cls, uv) => { if (cls.startsWith('lamp')) { const m = new THREE.MeshBasicMaterial({ color: 0x000000 }); lamps.push([m, lampCol[cls] || lampCol.lamp_tail]); return m; } return mats[cls + '|' + uv] || mats[cls + '|0'] || mats['matte|0']; };

  const hinge = podAt(doorFront(0.95), 0.95, 1).p, hingeTop = podAt(doorFront(1.72), 1.72, 1).p, axis = new THREE.Vector3(hingeTop[0] - hinge[0], hingeTop[1] - hinge[1], hingeTop[2] - hinge[2]).normalize();
  mats['paintdoor|1'] = mkPaint(hinge, 'door');      // the door's mesh is stored about its hinge: its seams are found from where it sits closed
  const innerTrim = new THREE.Group(); innerTrim.name = 'heli-inner-trim'; let doorTrim = null;
  const mPilot = bounce(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), 'pilot');
  const lods = [], doors = [];
  for (let q = 0; q < 3; q++) {
    const g = new THREE.Group(); g.name = 'lod' + q; g.visible = q === 0; root.add(g);
    const L = { g, spin: new THREE.Group(), tspin: new THREE.Group(), door: new THREE.Group(), arms: [], blades: null, tblades: null, glass: null, body: null, pilot: null };
    L.spin.position.set(0, D.rotorY, 0); g.add(L.spin);
    const tg = new THREE.Group(); tg.position.set(D.tailRotor[0], D.tailRotor[1], D.tailRotor[2]); tg.rotation.x = Math.PI / 2; g.add(tg); tg.add(L.tspin);
    L.door.position.set(hinge[0], hinge[1], hinge[2]); g.add(L.door); doors.push(L.door);
    for (const [k, list] of bins) {
      const [lod, grp, cls, uv] = k.split('|'); if (+lod !== q) continue;
      const geo = list.length > 1 ? mergeGeometries(list, false) : list[0]; if (!geo) { console.log('[heli] model: could not merge ' + k); continue; }
      if (grp === 'door' || grp === 'doortrim') geo.translate(-hinge[0], -hinge[1], -hinge[2]);
      const blade = grp === 'blades', tblade = grp === 'tailblades', m = new THREE.Mesh(geo, blade ? mBlades : tblade ? mTailBlades : grp === 'door' && cls === 'paint' && uv === '1' ? mats['paintdoor|1'] : matFor(cls, uv));
      const shell = grp === 'body' || grp === 'door'; m.receiveShadow = cls !== 'glass' && !cls.startsWith('lamp'); m.castShadow = q > 0 && shell && cls === 'paint';
      if (cls === 'glass') { m.renderOrder = 2; if (grp === 'body') L.glass = m; }
      if (grp === 'body') { g.add(m); if (cls === 'paint' && uv === '1') L.body = m; }
      else if (grp === 'door') L.door.add(m);
      else if (grp === 'trim') { innerTrim.add(m); m.receiveShadow = true; }
      else if (grp === 'doortrim') { L.door.add(m); doorTrim = m; }
      else if (grp === 'hubspin') L.spin.add(m);
      else if (grp === 'hubarms') { L.spin.add(m); L.arms.push(m); }
      else if (blade) { L.spin.add(m); L.blades = m; m.customDepthMaterial = dBlades; m.frustumCulled = false; m.castShadow = true; }
      else if (grp === 'tailspin') L.tspin.add(m);
      else if (tblade) { L.tspin.add(m); L.tblades = m; }
      else g.add(m);
    }
    if (q === 0) g.add(innerTrim);
    if (q < 2) { L.pilot = new THREE.Mesh(pilotGeometry(buildPilot(D, q)), mPilot); L.pilot.visible = false; g.add(L.pilot);
      L.crew = new THREE.Mesh(pilotGeometry(buildPilot({ ...D, pilotSeat: D.copilotSeat, pilotEye: [D.pilotEye[0], D.pilotEye[1], -D.pilotEye[2]] }, q)), mPilot); L.crew.visible = false; g.add(L.crew); }      // and a second in the left seat (both only while it flies with nobody of the game's aboard)
    // a blade over a short exposure: the blade itself, drawn faintly several times across its sweep (blur that widens toward the tip, as a turning blade's does)
    if (q < 2) { L.armCopies = L.arms.map((a) => { const c = new THREE.InstancedMesh(a.geometry, mArmCopies, ARMS); c.frustumCulled = false; c.visible = false; c.renderOrder = 3; c.layers.set(LAYER); L.spin.add(c); return c; }); }      // the head's arms over the exposure's sweep
    lods.push(L);
  }
  // the sun's shadow of the close level is cast by the far level's shell (a few thousand triangles), drawn in the shadow pass only
  if (lods[2].body) { const pg = lods[2].body.geometry.clone(), n = pg.index.count, proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial()); pg.setDrawRange(0, 0); proxy.castShadow = true; proxy.frustumCulled = false; proxy.onBeforeShadow = () => pg.setDrawRange(0, n); proxy.onAfterShadow = () => pg.setDrawRange(0, 0); lods[0].g.add(proxy); }

  // ---- the blurred rotors (shared by every level of detail)
  const BL = '0.016, 0.017, 0.018';      // blades are a dark matt grey (the file's are lighter: scaled here), so the disc reads against roofs and sky alike
  const uBlur = { value: new THREE.Vector4(0, 0, D.blades, CHORD) }, uBlurS = { value: new THREE.Vector4(0, 0, D.blades, CHORD) }, uGeo = { value: new THREE.Vector4(D.rotorR, 0.80, 1.14, 0.17) };
  const mainBlur = new THREE.Mesh(discGeometry([[0.015, 0.95, D.rotorR, 12], [-0.015, 0.95, D.rotorR, 12], [0, 0.15, D.rotorR, 12], [0.062, 0.15, 0.95, 2], [-0.062, 0.15, 0.95, 2]], 96), discMaterial({ uFlap, uSpan, uBlur, uGeo, uSteady, uLayers }, /* glsl */`
    vec3 hc = mix(vec3(0.07, 0.07, 0.07), vec3(${BL}), smoothstep(0.85, 1.14, hR)); hc = mix(hc, vec3(0.12, 0.12, 0.115), smoothstep(4.94, 4.96, hR) * (1.0 - smoothstep(5.05, 5.07, hR))); hc = mix(hc, vec3(0.16, 0.115, 0.008), smoothstep(${(D.rotorR - 0.155).toFixed(3)}, ${(D.rotorR - 0.135).toFixed(3)}, hR)); diffuseColor.rgb = hc;`, 'main'));
  const SHEET = 12 * 96 * 6; let discThree = true; mainBlur.position.set(0, D.rotorY, 0); mainBlur.frustumCulled = false; mainBlur.renderOrder = 3; mainBlur.visible = false; root.add(mainBlur);
  // the pitch links and scissors under the hub, turning: a faint cone
  const linkBlur = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.23, 0.28, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a8c90, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  linkBlur.position.set(0, D.rotorY - 0.185, 0); linkBlur.renderOrder = 3; linkBlur.visible = false; root.add(linkBlur);
  const uSunTo = { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uGroundY = { value: 0 }, uShadowK = { value: 0 };
  const rotorShadow = new THREE.Mesh(discGeometry([[0, 0.13, D.rotorR, 10]], 96), rotorShadowMaterial({ uFlap, uSpan, uBlur: uBlurS, uGeo, uSteady: { value: 0 }, uLayers: uOne, uSunTo, uGroundY, uShadowK })); rotorShadow.position.set(0, D.rotorY, 0); rotorShadow.frustumCulled = false; rotorShadow.renderOrder = 1; rotorShadow.visible = false; root.add(rotorShadow);
  const uFlap0 = { value: new THREE.Vector4() }, uSpanT = { value: new THREE.Vector2(D.tailRotorR, 0.05) }, uBlurT = { value: new THREE.Vector4(0, 0, 2, 0.195) }, uGeoT = { value: new THREE.Vector4(D.tailRotorR, 0.10, 0.26, 0.08) };
  const tailG = new THREE.Group(); tailG.position.set(D.tailRotor[0], D.tailRotor[1], D.tailRotor[2]); tailG.rotation.x = Math.PI / 2; root.add(tailG);
  const tailBlur = new THREE.Mesh(discGeometry([[0, 0.05, D.tailRotorR, 6]], 48), discMaterial({ uFlap: uFlap0, uSpan: uSpanT, uBlur: uBlurT, uGeo: uGeoT, uSteady, uLayers: uOne }, /* glsl */`
    diffuseColor.rgb = mix(vec3(${BL}), vec3(0.2, 0.05, 0.005), smoothstep(${(D.tailRotorR - 0.095).toFixed(3)}, ${(D.tailRotorR - 0.085).toFixed(3)}, hR));`, 'tail'));
  tailBlur.frustumCulled = false; tailBlur.renderOrder = 3; tailBlur.visible = false; tailG.add(tailBlur);

  root.traverse((o) => { if (o.isMesh) o.layers.set(LAYER); }); if (W && W.camera) W.camera.layers.enable(LAYER);
  let sunLight = null; if (W && W.scene) W.scene.traverse((o) => { if (o.isDirectionalLight && !sunLight) sunLight = o; });
  let cur = 0; const _m4 = new THREE.Matrix4(), _v3 = new THREE.Vector3();
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  console.log('[heli] model built in ' + Math.round(performance.now() - t0) + ' ms: ' + lods.map((L) => { let n = 0; L.g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) n += o.geometry.index ? o.geometry.index.count / 3 : 0; }); return Math.round(n / 1000) + 'k'; }).join(' / ') + ' triangles, maps ' + [tNormal, tOrm, tTint].map((t) => (t ? 1 : 0)).join(''));

  // One rotor's picture for this frame. th = the angle a blade sweeps in the exposure. Three pictures, each fading into the next by plain
  // opacity: the blade itself (th under 0.004), the blade's copies over its sweep (short exposures), the sheet (wide sweeps).
  const rotorPicture = (blades, copies, mat, sheet, ub, th, w, strength) => {
    const wide = copies ? sstep(0.2, 0.3, th) : sstep(0.004, 0.012, th), short = copies && th >= 0.004 && wide < 0.995;
    if (blades) blades.visible = copies ? th < 0.004 : wide < 0.6;
    if (copies) { copies.visible = short;
      if (short) { if (Math.abs(th - copies.userData.th) > 1e-5) { copies.userData.th = th; for (let k = 0; k < COPIES; k++) copies.setMatrixAt(k, _m4.makeRotationY(((k + 0.5) / COPIES - 0.5) * th)); copies.instanceMatrix.needsUpdate = true; }
        const m = COPIES * Math.min(1, w / th), c = Math.min(0.985, w / th); mat.opacity = (1 - Math.pow(1 - c, 1 / Math.max(1, m))) * (1 - wide); } }      // so many copies lie over one another at the blade's middle
    ub.value.x = th; ub.value.y = wide * strength; sheet.visible = wide * strength > 0.004;
    return wide;
  };
  function update(f, dt, view) {
    if (view.camera && !view.camera.layers.isEnabled(LAYER)) view.camera.layers.enable(LAYER);
    uHeliIn.value = view.inside ? 1 : 0;
    if (sunLight && W.sunDir) { const k = 0.10 * sunLight.intensity * Math.max(0, W.sunDir.y); uGround.value.setRGB(sunLight.color.r * k, sunLight.color.g * k * 0.97, sunLight.color.b * k * 0.92); }
    // which level of detail (a little slack so it does not flicker at the edge)
    const d = view.dist, want = d < (cur === 0 ? 46 : 42) ? 0 : d < (cur <= 1 ? 215 : 200) ? 1 : 2;
    if (want !== cur) { lods[cur].g.visible = false; lods[want].g.visible = true; cur = want; }
    const L = lods[cur], shutter = api.shutter;
    // ---- main rotor
    const th = f.nr * D.rpm * TAU / 60 * shutter;
    L.spin.rotation.y = -f.rotorAngle; mainBlur.rotation.y = -f.rotorAngle;
    // a parked aircraft is not stepped by the flight model, so its coning stays 0: the blades' own droop at rest is put back here (they sag about 0.65 m at the tip)
    const rest = Math.min(1, Math.max(0, 1 - f.nr * 2.2)), c0 = f.nr < 0.02 && Math.abs(f.coning) < 1e-6 ? -0.055 : f.coning, cone = c0 * (c0 > 0 ? 1.9 : 1 + 1.4 * rest);      // under load the blades as drawn cone nearly twice the flight model's figure and bend upward toward the tip (about 0.6 m at the tip in the hover: less than that no viewer saw)
    uFlap.value.set(cone, f.disc.lon, f.disc.lat, f.rotorAngle); uSteady.value = sstep(1 / 80, 1 / 55, shutter);
    // from the pilot's seat the disc overhead is a faint flicker, never a grey dome across the windscreen
    const wide = rotorPicture(L.blades, null, mCopies, mainBlur, uBlur, th, 0.09, view.inside ? SEAT : 1);
    if (L.blades) L.blades.castShadow = th < 0.004;
    const armsBlur = th > 0.3, smear = th > 0.012 && !armsBlur && !!L.armCopies;      // at wide sweeps the hub's own sheets carry it for (const a of L.arms) a.visible = !(smear || armsBlur); linkBlur.visible = armsBlur && cur < 2 && !view.inside;
    if (L.armCopies) { for (const c of L.armCopies) c.visible = smear;
      if (smear) { const sw = Math.min(th * 2.0, 2.09);      /* a little more than the true sweep: at the true one the grips read as frozen beside blurred blades */ if (Math.abs(sw - armTh) > 1e-5 || L.armCopies[0].userData.th !== sw) { armTh = sw; for (const c of L.armCopies) { c.userData.th = sw; for (let k = 0; k < ARMS; k++) c.setMatrixAt(k, _m4.makeRotationY(((k + 0.5) / ARMS - 0.5) * sw)); c.instanceMatrix.needsUpdate = true; } }
        const wa = 0.3, m = ARMS * Math.min(1, wa / sw); mArmCopies.opacity = 1 - Math.pow(1 - Math.min(0.97, wa / sw), 1 / Math.max(1, m)); } }
    // the blade is a few centimetres thick: seen within a few degrees of the disc's plane the sheet is drawn three times over that thickness
    { let el = 1; if (view.camera) { _v3.copy(view.camera.position); root.worldToLocal(_v3); el = Math.abs(_v3.y - D.rotorY) / (Math.hypot(_v3.x, _v3.z) + 0.01); } const three = el < 0.14; if (three !== discThree) { discThree = three; mainBlur.geometry.setDrawRange(three ? 0 : 2 * SHEET, three ? Infinity : Infinity); } uLayers.value = three ? 3 : 1; }
    uBlurS.value.x = th; uBlurS.value.y = sstep(0.004, 0.012, th);
    const sk = 0.5 * (1 - sstep(6, 18, f.agl || 0));      // faint: the blades' passing shadows (they turn with the rotor, so they flicker from frame to frame), no steady oval rotorShadow.visible = uBlurS.value.y > 0.005 && sk > 0.01 && cur < 2; rotorShadow.rotation.y = -f.rotorAngle; uShadowK.value = sk; uGroundY.value = f.surface || 0; if (W && W.sunDir) uSunTo.value.copy(W.sunDir);
    // ---- tail rotor
    const thT = f.nr * D.tailRpm * TAU / 60 * shutter;
    L.tspin.rotation.y = -f.tailAngle; tailBlur.rotation.y = -f.tailAngle; rotorPicture(L.tblades, null, mTailCopies, tailBlur, uBlurT, thT, 0.3, 1);
    // ---- the pilot's door, the pilot, what is only seen through the glass
    const dq = (view.door || 0) * 1.22; for (const dg of doors) dg.quaternion.setFromAxisAngle(axis, dq);
    if (L.pilot) L.crew.visible = L.pilot.visible = !view.piloted && !view.inside && (f.engine !== 'off' || f.nr > 0.05);      // someone is flying it when the game has put nobody in the seat
    if (doorTrim) doorTrim.visible = innerTrim.visible;
    // ---- lamps: steady position lights and the landing light with the rotor turning, the red beacon flashing
    const on = f.nr > 0.2 ? 1 : 0, ph = (view.t || 0) % 1.25, lk0 = on * 9 + 0.05, lk1 = on * (ph < 0.07 || (ph > 0.18 && ph < 0.24) ? 40 : 0.4) + 0.05, lk2 = on * 9 + 0.05;
    for (let i = 0; i < lamps.length; i++) { const c = lamps[i][1], k = c[3] === 0 ? lk0 : c[3] === 1 ? lk1 : lk2; lamps[i][0].color.setRGB(c[0] * k, c[1] * k, c[2] * k); }
  }
  // innerTrim: everything of ours that exists only to be seen from outside through the glass (the cabin's liner and rear bulkhead; the door's
  // inner panel follows it). The cockpit hides it (innerTrim.visible = false) while the camera is inside and draws its own.
  api.update = update; api.lods = lods; api.innerTrim = innerTrim; api.mainBlur = mainBlur; api.tailBlur = tailBlur; return api;
}
