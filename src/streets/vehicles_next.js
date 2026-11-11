// vehicles.js (streets lane): the vehicles. Replaces the kit's six car models and their batches with this lane's set
// (assets/streets/vehicles/vehicles.glb: 13 kinds at three detail levels, built by lanes/streets/pipeline/models), lines the kerbs by
// rule, widens the traffic mix (rules in vehicles_rules.js) and draws every car with per-car variation from a seed.
//   near (< ~24 m)  full model: shut lines, handles, mirrors, wipers, lamp units behind lenses, plates, interior behind see-through glass,
//                   four wheels that spin and steer
//   mid  (< ~120 m) light model, wheels part of the body, dark reflecting glass
//   far             a few hundred triangles in two draws
// Distances are scaled by the lens (a long lens keeps detail further out) and chosen each time the world is rendered, from the camera
// that renders. Each car: paint colour, road dirt low on the body (amount from the seed), ride height, ladder rack / roof box,
// trade lettering on vans and trucks (invented names), gold or white plate, a soft dark patch on the road under it.
// What it changes in the lead's game, all at load time and none of it in his files: game.kit.cars (sizes of the six kinds, seven
// more), game.batches (stubbed: his syncVisuals still runs, this module draws the cars), game.parked.slots/grid (regenerated),
// game.traffic.pickType/colorFor/spawn/target, game.tryEnter (wrapped), world.render (wrapped to place the instances).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { BAKE_LIGHT_GLSL, NOISE_GLSL } from '../facade.js';
import { applyAll, variant, N_LIVERY, KIND, TAXI_YELLOW } from './vehicles_rules.js';

const LOD_NEAR = 22, LOD_MID = 110, FAR = 260, CAP = [10, 110, 260], CAP_BUS = [5, 12, 16];
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _s = new THREE.Sphere(), _fr = new THREE.Frustum();

// material name (from the build) -> draw group, per detail level
let VB = { plate: true, tyre: true, sink: true, blob: true };
function groupOf(name, lod) {
  if (name === 'paint') return 'paint';
  if (name === 'livery') return lod < 2 ? 'livery' : null;
  if (/^rack/.test(name)) return lod < 2 ? 'rack' : null;
  if (name === 'lens' || name === 'lens_red') return lod === 0 ? 'lens' : null;
  if (VB.plate && name === 'plate') return lod < 2 ? 'plate' : 'misc';
  if (VB.plate && name === 'plate_text') return lod < 2 ? null : 'misc';      // the plate's own picture carries its lettering
  if (lod === 2) return 'misc';
  if (name === 'glass' || name === 'glass_dark') return 'glass';
  if (name === 'light_tail') return 'tail';
  if (lod === 0 && (/^interior/.test(name) || name === 'brake')) return 'int';
  return 'misc';
}
// roughness, metalness, glow, plate flag carried per vertex in the merged groups
const OVER = { drl: [0.2, 0, 0.35, 0], light_head: [0.06, 0.0, 0.0, 0], lamp_housing: [0.14, 1.0, 0.0, 0], plate: [0.4, 0, 0, 1], taxi_light: [0.35, 0, 0.55, 0], amber: [0.1, 0, 0.0, 0], light_white: [0.15, 0.6, 0.05, 0], glass: [0.04, 0, 0, 0], glass_dark: [0.04, 0, 0, 0], tire: [0.86, 0, 0, 0], trim_gloss: [0.3, 0, 0, 0] };
function prepGeo(mesh, inv, group) {
  const g = mesh.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && group === 'livery')) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (group === 'plate') {      // each plate (nose, tail) gets its own 0..1 across its face, read as the viewer facing it reads it
    const p = g.attributes.position, uv = new Float32Array(p.count * 2), bb = [[1e9, -1e9, 1e9, -1e9], [1e9, -1e9, 1e9, -1e9]];
    for (let i = 0; i < p.count; i++) { const b = bb[p.getX(i) > 0 ? 0 : 1]; b[0] = Math.min(b[0], p.getY(i)); b[1] = Math.max(b[1], p.getY(i)); b[2] = Math.min(b[2], p.getZ(i)); b[3] = Math.max(b[3], p.getZ(i)); }
    for (let i = 0; i < p.count; i++) { const f = p.getX(i) > 0, b = bb[f ? 0 : 1], u = (p.getZ(i) - b[2]) / (b[3] - b[2] || 1); uv[i * 2] = f ? 1 - u : u; uv[i * 2 + 1] = (p.getY(i) - b[0]) / (b[1] - b[0] || 1); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const n = g.attributes.position.count, m = mesh.material, col = new Float32Array(n * 3), am = new Float32Array(n * 4);
  const o = OVER[m.name] || [m.roughness, m.metalness, 0, 0]; let c = m.color;
  if (m.name === 'light_head') c = new THREE.Color(0.035, 0.037, 0.04);      // projector lenses: dark glass with the sky in them, not grey balls
  if (m.name === 'amber') c = new THREE.Color(0.2, 0.065, 0.01); if (m.name === 'lamp_housing') c = new THREE.Color(0.62, 0.63, 0.66);
  if (m.name === 'glass' || m.name === 'glass_dark') c = new THREE.Color(0.012, 0.016, 0.018);
  if (m.name === 'tire') c = new THREE.Color(0.032, 0.032, 0.034);
  if (m.name === 'interior_Body') c = new THREE.Color(0.07, 0.07, 0.075); else if (/^interior_(Light_Grey_Plastic|Headliner|Interior)$/.test(m.name)) c = c.clone().multiplyScalar(0.6);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; am.set(o, i * 4); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMat', new THREE.BufferAttribute(am, 4));
  return g;
}

// New York plates, made up: eight in a 2 x 4 atlas, most the gold 'Empire State' plate, some the white one; navy lettering, a black
// plastic surround, two bolts; numbers invented (three letters, four digits)
function plateAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'), L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let s = 91; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) {
    const x0 = (i % 2) * 512, y0 = Math.floor(i / 2) * 256, white = i < 7;      // the eighth is a cab's: gold, its medallion number (invented)      // most plates on the street now are the white 'Excelsior' issue
    g.fillStyle = '#121212'; g.fillRect(x0, y0, 512, 256);
    const grd = g.createLinearGradient(0, y0, 0, y0 + 256); if (white) { grd.addColorStop(0, '#e9eef2'); grd.addColorStop(0.55, '#f4f4ef'); grd.addColorStop(1, '#f1c95a'); } else { grd.addColorStop(0, '#f6c437'); grd.addColorStop(1, '#e19d16'); }
    g.fillStyle = grd; g.beginPath(); g.roundRect ? g.roundRect(x0 + 14, y0 + 12, 484, 232, 14) : g.rect(x0 + 14, y0 + 12, 484, 232); g.fill();
    g.fillStyle = '#1a2a5e'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 40px "Arial Narrow", Arial, sans-serif'; g.fillText('NEW YORK', x0 + 256, y0 + 46);
    const num = white ? L[Math.floor(r() * L.length)] + L[Math.floor(r() * L.length)] + L[Math.floor(r() * L.length)] + '-' + String(1000 + Math.floor(r() * 9000)) : '7K42';
    g.save(); g.translate(x0 + 256, y0 + 138); g.scale(0.82, 1); g.font = 'bold 112px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; g.fillText(num, 0, 0); g.restore();
    g.font = 'bold 26px Arial, sans-serif'; g.fillText(white ? 'EXCELSIOR' : 'TAXI', x0 + 256, y0 + 214);
    for (const bx of [118, 394]) { g.fillStyle = '#8c8c86'; g.beginPath(); g.arc(x0 + bx, y0 + 30, 9, 0, 7); g.fill(); g.fillStyle = '#3a3a36'; g.fillRect(x0 + bx - 6, y0 + 29, 12, 2); }
    const dg = g.createLinearGradient(0, y0 + 150, 0, y0 + 256); dg.addColorStop(0, 'rgba(60,50,35,0)'); dg.addColorStop(1, 'rgba(60,50,35,0.22)'); g.fillStyle = dg; g.fillRect(x0 + 14, y0 + 150, 484, 94);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function liveryAtlas() {
  const NAMES = ['MARLOWE & FINCH ELECTRIC', 'KOWALCZYK BROS. PLUMBING', 'TRESCOTT HVAC SERVICE', 'BELLWEATHER LINEN SUPPLY', 'ODALYS WHOLESALE FLOWERS', 'QUILLFEATHER PRINTING', 'NORTH RIVER SEAFOOD CO.', 'HARROWGATE MOVING & STORAGE',
    'PIPEWRIGHT DRAIN CLEANING', 'TESSARO TILE & STONE', 'GRANDVIEW GLASS & MIRROR', 'OSTROWSKI PRODUCE', 'LANTERN LOCK & SAFE', 'DUNMORE ELEVATOR REPAIR', 'CALLOWAY CATERING', 'BRIGHTLINE COURIER'];
  const SUBS = ['LICENSED & INSURED', 'COMMERCIAL  •  RESIDENTIAL', '24 HOUR SERVICE', 'SINCE 1987', 'FREE ESTIMATES', 'ALL FIVE BOROUGHS', 'FAMILY OWNED', 'SAME DAY DELIVERY'];
  const FONTS = ['800 %px "Arial Narrow", "Helvetica Neue", Arial, sans-serif', 'bold %px Georgia, "Times New Roman", serif', '900 %px Impact, "Arial Black", sans-serif', 'italic bold %px Helvetica, Arial, sans-serif', 'bold %px "Trebuchet MS", "Gill Sans", sans-serif', 'bold %px "Courier New", monospace'];
  const c = document.createElement('canvas'); c.width = 2048; c.height = 2048; const g = c.getContext('2d'); g.clearRect(0, 0, 2048, 2048);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < N_LIVERY; i++) {
    const x0 = (i % 2) * 1024, y0 = (7 - Math.floor(i / 2)) * 256, style = i % 4;
    const fit = (text, font, size, y, maxW) => { g.font = font.replace('%', size); const w = g.measureText(text).width; g.save(); g.translate(x0 + 512, y0 + y); if (w > maxW) g.scale(maxW / w, 1); g.fillText(text, 0, 0); g.restore(); };
    const f = FONTS[(i * 5 + 1) % FONTS.length], phone = '212-555-01' + String(10 + ((i * 37) % 89));
    if (style === 0) { fit(NAMES[i], f, 104, 92, 960); fit(SUBS[i % 8] + '   ' + phone, FONTS[0], 50, 196, 900); }
    else if (style === 1) { fit(NAMES[i], f, 96, 84, 940); g.fillRect(x0 + 60, y0 + 142, 904, 8); fit(phone + '   •   ' + SUBS[(i + 3) % 8], FONTS[4], 48, 200, 880); }
    else if (style === 2) { g.lineWidth = 7; g.strokeRect(x0 + 24, y0 + 20, 976, 216); fit(NAMES[i], f, 92, 100, 900); fit(SUBS[(i + 5) % 8] + '  •  ' + phone, FONTS[0], 44, 190, 860); }
    else { const w = NAMES[i].split(' '), a = w.slice(0, Math.ceil(w.length / 2)).join(' '), b = w.slice(Math.ceil(w.length / 2)).join(' '); fit(a, f, 88, 62, 940); fit(b, f, 76, 140, 940); fit(phone, FONTS[2], 46, 214, 500); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

export async function add(game, ctx) {
  const world = game.world, scene = world.scene, shared = world.shared, A = ctx.A + 'vehicles/';
  const draco = new DRACOLoader().setDecoderPath('node_modules/three/examples/jsm/libs/draco/gltf/');
  const [meta, gltf] = await Promise.all([fetch(A + 'vehicles.json', { cache: 'no-store' }).then((r) => r.json()), new GLTFLoader().setDRACOLoader(draco).loadAsync(A + 'vehicles.glb')]);
  // the openx-assets models (CC-BY, see ATTRIBUTION.md), on unless ?vopenx=0: same kit conventions, so they are more kinds of the same
  let oxMeta = null, oxScene = null, oxPrev = null; const prevKinds = [];
  if (!(game.P && game.P.get('vopenx') === '0')) try { let ox = 'openx'; if (!(game.P && game.P.get('vox2') === '0')) { const r2 = await fetch(A + 'openx_next.json', { cache: 'no-store' }); if (r2.ok) { oxMeta = await r2.json(); ox = 'openx_next'; } }
      if (ox === 'openx') oxMeta = await fetch(A + 'openx.json', { cache: 'no-store' }).then((r) => r.json());
      oxScene = (await new GLTFLoader().setDRACOLoader(draco).loadAsync(A + ox + '.glb')).scene; oxScene.updateMatrixWorld(true);
      if (oxMeta.ox_cab) { oxMeta.ox_cab.base = ['taxi']; if (oxMeta.ox_corolla) oxMeta.ox_corolla.base = ['sedan']; }      // cabs are the cab model; same length, so the kerbs fill as before
      // kinds whose newest build is not fit to show are taken from the build before (openx_next.prev.glb): the sprinter's nose shows a
      // chevron left of its maker's star in the 13:45 build
      if (ox === 'openx_next') for (const t of String(game.P && game.P.has('vprev') ? game.P.get('vprev') : '').split(',').filter(Boolean)) { if (!oxPrev) { oxPrev = (await new GLTFLoader().setDRACOLoader(draco).loadAsync(A + 'openx_next.prev.glb')).scene; oxPrev.updateMatrixWorld(true); } prevKinds.push(t); }
      console.log('[streets] vehicles: ' + ox + ' models' + (prevKinds.length ? ', from the build before: ' + prevKinds : '')); } catch (e) { console.log('[streets] vehicles: openx models not loaded: ' + (e && e.message)); oxMeta = null; }
  const allMeta = Object.assign({}, meta, oxMeta || {}), findNode = (n) => gltf.scene.getObjectByName(n) || (oxPrev && prevKinds.some((t) => n.indexOf(t) > 0) && oxPrev.getObjectByName(n)) || (oxScene && oxScene.getObjectByName(n));
  draco.dispose();
  const P = game.P, opt = (k, d) => (P && P.has(k) ? P.get(k) : d);
  VB = { plate: opt('vb_plate', '1') !== '0', tyre: opt('vb_tyre', '1') !== '0', sink: opt('vb_sink', '1') !== '0', blob: opt('vb_blob', '1') !== '0' }; const SINK = VB.sink ? 0.012 : 0;
  // the street cube is read through a uniform of our own that always holds a cube with storage behind it: world.js's stand-in cube is
  // never drawn into, and a sampler left on it trips ANGLE ("two textures of different types use the same sampler location") on some Macs
  const vehCube0 = new THREE.WebGLCubeRenderTarget(2); { const R = world.renderer, old = R.getRenderTarget(); for (let f = 0; f < 6; f++) { R.setRenderTarget(vehCube0, f); R.clear(); } R.setRenderTarget(old); }
  const VEH_CUBE = { value: vehCube0.texture };
  const VEH_DBG = { value: +opt('vdbg', '0') }, VEH_CPOS = { value: new THREE.Vector3() }, VEH_PAR = { value: +opt('vpar', '11') };
  // the lead's street cube is 256 px a face in live play: lacquer and glass mirror it, so near cars show its texels. ?vcube=512 redraws it finer.
  { const cs = +opt('vcube', '512'); if (world.streetRT && cs > world.streetRT.width && cs <= 1024) world.streetRT.setSize(cs, cs); }
  const VEH_GRIME = { value: await new THREE.TextureLoader().loadAsync(A + 'grime.webp') }; VEH_GRIME.value.wrapS = VEH_GRIME.value.wrapT = THREE.RepeatWrapping; VEH_GRIME.value.anisotropy = 4;
  const VEH_STREET = { value: 0 }, streetOn = opt('vstreet', '1') !== '0';
  const dense = opt('vdense', '1') !== '0';

  // ---------------------------------------------------------------- materials (shared by every kind)
  function patch(m, o) {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared); sh.uniforms.uVehStreet = VEH_STREET; sh.uniforms.uVehDbg = VEH_DBG; sh.uniforms.tVehStreet = VEH_CUBE; sh.uniforms.uVehCubePos = VEH_CPOS; sh.uniforms.tVehGrime = VEH_GRIME; sh.uniforms.uVehPar = VEH_PAR;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aVar; attribute vec4 aMat; varying vec4 vVar; varying vec4 vMat; varying vec3 vOPos; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vCrown;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vVar = aVar; vMat = aMat; vOPos = position;
          #ifdef USE_INSTANCING
            mat4 vehM = modelMatrix * instanceMatrix;
          #else
            mat4 vehM = modelMatrix;
          #endif
          vWPos = (vehM * vec4(position, 1.0)).xyz; vWNrm = normalize(mat3(vehM) * normal);
          vCrown = mat3(vehM) * vec3(position.x * 0.05, 0.0, position.z * 0.22);     // bonnets and roofs are crowned: their mirror image sweeps across the sky`);
      if (o.plate) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            float fi = aVar.z > 0.5 ? 7.0 : floor(fract(aVar.y * 7.31) * 7.0);
            vMapUv = vec2((mod(fi, 2.0) + uv.x) / 2.0, (3.0 - floor(fi / 2.0) + uv.y) / 4.0);
          #endif`);
      // the sun's shadow map is ~7 cm a texel here: on a car's curved panels it falls as blotches (the body shadowing itself a texel
      // off). Bodies look it up 12 cm out along the normal: shade from buildings, trees and other cars stays, the self-blotching goes.
      sh.vertexShader = sh.vertexShader.replace('#include <shadowmap_vertex>', THREE.ShaderChunk.shadowmap_vertex.split('directionalLightShadows[ i ].shadowNormalBias').join('( directionalLightShadows[ i ].shadowNormalBias + ' + (o.wheel || o.scan ? '0.04' : '0.12') + ' )'));
      if (o.scan || o.wheel) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
          vec4 vehW = vehM * vec4(transformed, 1.0); vec3 vehAx = normalize(mat3(vehM) * vec3(0.0, 0.0, 1.0));
          float vehLow = smoothstep(0.075, 0.0, vehW.y);
          vehW.xyz += vehAx * sign(position.z) * 0.011 * vehLow * step(abs(position.z), 1e3);      // the sidewall bulges over the contact
          vehW.y = max(vehW.y, 0.002);                                                              // and the tread lies flat on the road
          vec4 mvPosition = viewMatrix * vehW; gl_Position = projectionMatrix * mvPosition;`);
      if (o.livery) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv = vec2((mod(aVar.z, 2.0) + uv.x) / 2.0, (floor(aVar.z / 2.0) + 1.0 - uv.y) / 8.0);   // glTF's v runs down, the canvas's up
          #endif`);
      let f = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vVar; varying vec4 vMat; varying vec3 vOPos; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vCrown;
          uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter;
          uniform vec3 uSunDir; uniform samplerCube tVehStreet; uniform float uVehStreet; uniform float uVehDbg; uniform vec3 uVehCubePos; uniform float uVehPar; uniform sampler2D tVehGrime;
          ${NOISE_GLSL}
          vec3 bakeV; vec3 bakeN; float vehDirt; float vehOcc = 1.0; float vehSky; float vehSun;
          // What a car's lacquer and glass mirror. The scene has only the sky to reflect, so the street is made here: above the
          // roofline (higher where the baked sky light says the canyon is deep, ragged along the block) the real sky; below it
          // walls with rows of windows, lit by where the sun stands; a dark band of street life at their foot; the road below.
          vec3 vehEnv(vec3 Rw, vec3 skyR, vec3 amb, float skyVis, float sunVis) {
            float az = atan(Rw.z, Rw.x), y = Rw.y / max(length(Rw.xz), 0.05);
            float blk = vnoise(vec2(az * 2.2 + 3.0, 0.5)), roof = mix(0.22, 1.1, 1.0 - skyVis) * (0.55 + 0.9 * blk);
            float wall = smoothstep(roof + 0.02, roof - 0.02, y);
            float lit = smoothstep(-0.2, 0.6, dot(normalize(Rw.xz), -normalize(uSunDir.xz)));
            vec3 tone = mix(vec3(0.30, 0.26, 0.22), vec3(0.55, 0.52, 0.47), vnoise(vec2(az * 2.2 + 3.0, 7.0)));
            vec3 wallC = tone * (amb * 0.9 + uSunColor * 0.9 * lit);
            wallC = mix(wallC, vec3(0.045) * (amb + uSunColor * 0.3), 0.85 * smoothstep(0.17, 0.05, y));      // street life in shade at the walls' foot
            vec3 ground = mix(vec3(0.11), vec3(0.20), smoothstep(-0.15, -0.7, y)) * (amb * 1.2 + uSunColor * mix(0.9, sunVis, smoothstep(-0.1, -0.6, y)));
            return mix(ground, mix(skyR, wallC, wall), smoothstep(-0.035, 0.01, y));
          }`)
        .replace('#include <map_fragment>', o.tint ? '#include <map_fragment>\n vec3 vehTex = diffuseColor.rgb;' : '#include <map_fragment>')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            ${o.tint ? 'float tl = dot(vehTex, vec3(0.3, 0.59, 0.11)), tsat = max(vehTex.r, max(vehTex.g, vehTex.b)) - min(vehTex.r, min(vehTex.g, vehTex.b)); diffuseColor.rgb = mix(vehTex, diffuseColor.rgb, smoothstep(0.42, 0.62, tl) * (1.0 - smoothstep(0.03, 0.12, tsat)));' : ''}
            bakeN = normalize(vWNrm);
            bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb;
            vehSky = clamp(bakeV.r, 0.0, 1.0); vehSun = bakeV.g;
            bakeV.r *= 0.5 + 0.5 * bakeN.y;          // the bake is the ground's: a wall of the car sees half that sky
            ${o.misc ? 'if (vMat.w > 0.5) diffuseColor.rgb = mix(vec3(0.88, 0.62, 0.12), vec3(0.86, 0.86, 0.83), step(0.62, fract(vVar.y * 7.31)));' : ''}
            float hh = ${o.wheel ? '0.22' : 'vOPos.y'}; const float DUSTK = ${(+opt('vdust', '0.45')).toFixed(3)}; const float GRIMEK = ${(+opt('vgrime', '1')).toFixed(3)};
            float n1 = fbm(vec2(vOPos.x * 1.3 + vVar.y * 37.0, vOPos.z * 1.3 + vOPos.y * 0.8)), n2 = vnoise(vOPos.xz * 9.0 + vVar.y * 11.0);
            float n3 = vnoise(vec2(vOPos.x * 7.0 + vVar.y * 13.0, vOPos.y * 21.0));      // fine streaks, not blotches
            float spray = smoothstep(0.7, 0.05, hh) * (0.75 + 0.25 * n1 + 0.25 * n3) + 0.02 + 0.02 * n2;     // low on the body and soft; nothing on bonnet or roof
            vehDirt = clamp(vVar.x * spray * ${o.inner || o.scan ? '0.0' : o.glass ? '0.35' : o.wheel ? '0.3' : o.misc ? '0.5' : o.plate ? '0.4' : '1.1'}, 0.0, 0.88);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.17, 0.14), vehDirt * 0.85);
            // what the body hides from the sky: surfaces facing the road and the bottom 40 cm sit in the car's own shade
            ${o.inner || o.wheel || o.scan ? '' : 'vehOcc = mix(0.22, 1.0, smoothstep(-0.65, 0.3, bakeN.y)) * mix(0.45, 1.0, smoothstep(0.06, 0.42, vOPos.y)); diffuseColor.rgb *= vehOcc;'}
            // a parked city car carries a film of dust on everything that faces up: patchy, streaked where rain ran off, thinner on glass
            ${o.inner || o.wheel || o.scan ? '' : `{ float up = smoothstep(0.35, 0.85, bakeN.y), streak = vnoise(vec2(vOPos.x * 0.7 + vVar.y * 5.0, vOPos.z * 9.0));
              float dust = clamp(vVar.x * 1.25 - 0.08, 0.0, 1.0) * up * (0.72 + 0.28 * fbm(vOPos.xz * 6.0 + vVar.y * 23.0)) * (0.8 + 0.2 * streak) * ${o.glass ? '0.5' : '0.75'};
              diffuseColor.rgb = mix(diffuseColor.rgb, max(diffuseColor.rgb, vec3(0.42, 0.40, 0.36)), clamp(dust, 0.0, 0.6) * DUSTK); vehDirt = clamp(vehDirt + dust * 0.9 * DUSTK, 0.0, 0.92); }`}
            // photographed grime (ambientCG, CC0): rain streaks hanging from the shoulder line and the roof edge, road film thrown up from
            // the sills and behind the wheels, a mottle in the dust on top
            ${o.inner || o.wheel || o.scan || o.plate ? '' : `{ float gs = 1.0 - smoothstep(0.55, 0.9, abs(bakeN.y)), gu = (vOPos.x + vOPos.z * 0.7) * 0.42 + vVar.y * 7.0;
              float gR = texture2D(tVehGrime, vec2(gu, 1.0 - clamp((0.99 - vOPos.y) / 0.6, 0.02, 0.98))).r * step(vOPos.y, 0.99);
              float gF = texture2D(tVehGrime, vec2(gu * 1.37 + 0.4, clamp((vOPos.y - 0.13) / 0.62, 0.02, 0.98))).g;
              float gM = texture2D(tVehGrime, vOPos.xz * 0.8 + vVar.y * 3.0).b;
              float gr = clamp(vVar.x * GRIMEK * ${o.glass ? '0.4' : '1.0'} * (gs * (0.3 * gR + 1.25 * gF) + (1.0 - gs) * max(bakeN.y, 0.0) * 0.2 * gM), 0.0, 0.8);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.135, 0.115), gr); vehDirt = clamp(vehDirt + gr * 0.8, 0.0, 0.95); }`}
            ${o.inner ? 'diffuseColor.rgb *= 0.85;' : ''}
            ${o.wheel ? `if (vMat.x > 0.85) {      // the tyre: grooved tread, rings on the sidewall (aVar.z = its radius)
              float wr = length(vOPos.xy), tr = step(vVar.z - 0.016, wr), ang = atan(vOPos.y, vOPos.x);
              float blockT = step(0.3, fract(vOPos.z * 42.0)) * step(0.22, fract(ang * 14.0 + vOPos.z * 9.0));
              float lr = (wr / max(vVar.z, 0.2) - 0.80) / 0.09, lt = step(0.0, lr) * step(lr, 1.0) * step(0.45, fract(ang * 9.55)) * step(fract(ang * 0.159 + 0.1), 0.42) * step(0.3, fract(ang * 57.0 + lr * 1.7));
              diffuseColor.rgb *= mix((1.0 + 0.7 * step(0.86, fract(wr * 55.0))) * (1.0 + ${VB.tyre ? '1.1' : '0.0'} * lt), 0.3 + 0.7 * blockT, tr); }
            else if (vMat.y > 0.5 && vMat.x > 0.15) diffuseColor.rgb *= mix(0.45, 1.0, step(0.2, fract(vVar.y * 5.3))) * mix(0.75, 1.0, fract(vVar.y * 9.1));   // rims: bright on most, dark on some` : ''}
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor ${o.misc ? '* vMat.x' : ''} ${o.paint ? '+ 0.28 * step(0.82, fract(vVar.y * 3.71))' : ''}, 0.93, vehDirt);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = metalnessFactor ${o.misc ? '* vMat.y' : ''} * (1.0 - vehDirt);`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat *= (1.0 - vehDirt) * (1.0 - 0.6 * step(0.82, fract(vVar.y * 3.71)));
          #endif`)
        .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + (o.glass ? '\n reflectedLight.indirectSpecular *= 0.0;' : ''));
      if (o.misc) f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vMat.z * 2.0;');
      if (o.tail) f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = vec3(1.0, 0.03, 0.01) * mix(0.10, 5.5, clamp(vVar.w, 0.0, 1.0));');
      // lettering: read close up; from far off the lines of text close up into clean solid bars instead of breaking into speckle
      if (o.livery) f = f.replace('#include <map_fragment>', '#ifdef USE_MAP\n { float la = texture2D(map, vMapUv).a; float tpp = fwidth(vMapUv.y) * 2048.0; diffuseColor.a *= mix(la, smoothstep(0.07, 0.16, la), clamp((tpp - 1.2) / 1.5, 0.0, 1.0)); }\n#endif');
      if (o.paint || o.glass) f = f.replace('#include <opaque_fragment>', `{
          vec3 Nw = normalize(vWNrm); Nw = normalize(Nw + vCrown * ${o.real ? '0.0' : '1.0'} * smoothstep(0.5, 0.95, Nw.y));
          // a door is curved top to bottom: low down it mirrors the road, then the dark foot of the street, then walls, and the sky along the shoulder
          ${o.paint && !o.real ? 'Nw = normalize(Nw + vec3(0.0, (vOPos.y - 0.70) * 0.75 * (1.0 - abs(Nw.y)), 0.0));' : ''}
          vec3 Vw = normalize(cameraPosition - vWPos), Rw = reflect(-Vw, Nw);
          float Fc = ${o.paint ? '0.085' : '0.06'} + 0.94 * pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 5.0);
          #ifdef USE_ENVMAP
            vec3 skyR = getIBLRadiance(geometryViewDir, geometryNormal, ${o.paint ? '0.3' : '0.12'}), amb = getIBLRadiance(geometryViewDir, geometryNormal, 1.0);
          #else
            vec3 skyR = vec3(1.0), amb = vec3(0.5);
          #endif
          vec3 env = vehEnv(Rw, skyR, amb, vehSky, vehSun);
          // the live picture of the street at the eye (world.js, one face a frame): real walls, trees and sky in lacquer and glass
          if (uVehStreet > 0.5) {
            // the cube is drawn at the eye, the car stands metres from it: follow the mirrored ray to the road (y = 0) or to the street's
            // far side and look up the cube toward THAT point, so the kerb, the lane paint and the walls land where a mirror would put them
            float tg = Rw.y < -0.01 ? max(vWPos.y, 0.0) / -Rw.y : 1e4, tw = uVehPar / max(length(Rw.xz), 0.2);
            vec3 Rl = mix(Rw, normalize(vWPos + Rw * min(tg, tw) - uVehCubePos), step(0.5, uVehPar));
            vec3 st = min(texture(tVehStreet, Rl).rgb, vec3(4.0));
            ${o.paint ? `{ // lacquer is not a mirror: five taps over a small cone take the stair-steps of the 256 px cube out of bright edges
              vec3 ta = normalize(cross(Rl, vec3(0.0, 1.0, 0.0)) + 1e-4), tb = cross(Rl, ta); float cr = 0.009;
              st = (st * 2.0 + min(texture(tVehStreet, Rl + ta * cr).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl - ta * cr).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl + tb * cr).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl - tb * cr).rgb, vec3(4.0))) / 6.0;
              // bonnet, roof and boot are broad shallow curves: what they mirror is stretched and soft, a sweep of wall tone and sky rather
              // than a readable window grid (critics r18: 'a crisp, tiled grid of bright window rectangles ... stamped on')
              float upK = smoothstep(0.45, 0.9, Nw.y) * ${(+opt('vsoft', '0.75')).toFixed(2)}; if (upK > 0.01) { float cw = 0.085;
                vec3 wd = (min(texture(tVehStreet, Rl + (ta + tb) * cw).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl - (ta + tb) * cw).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl + (ta - tb) * cw).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl - (ta - tb) * cw).rgb, vec3(4.0))
                  + min(texture(tVehStreet, Rl + ta * cw * 2.0).rgb, vec3(4.0)) + min(texture(tVehStreet, Rl - ta * cw * 2.0).rgb, vec3(4.0))) / 6.0;
                st = mix(st, wd, upK); } }` : ''}
            if (tg < tw) st *= mix(0.25, 1.0, smoothstep(0.0, 0.5, tg * length(Rw.xz)));      // the road right beside the car lies in the car's own shade
            env = mix(env, st, ${o.paint ? '0.95' : '1.0'}); }
          env *= ${o.real ? '0.55' : o.paint ? '1.45' : '1.0'};
          env += uSunColor * 7.0 * pow(max(dot(Rw, normalize(uSunDir)), 0.0), 500.0) * clamp(reflectedLight.directDiffuse.g * 6.0, 0.0, 1.0);     // the sun's glint, where the sun reaches
          ${o.paint ? 'float cc = (1.0 - 0.55 * vehDirt) * (1.0 - 0.65 * step(0.82, fract(vVar.y * 3.71))) * vehOcc;' : 'float cc = 1.0 - 0.6 * vehDirt;'}
          ${o.seethru ? 'float gk = cc * mix(0.6, 1.4, smoothstep(0.95, 1.6, vOPos.y)); float ga = clamp(0.30 + Fc * 1.6 * gk + vehDirt * 0.4, 0.0, 1.0); outgoingLight = (outgoingLight * 0.30 + env * Fc * 1.9 * gk) / ga; diffuseColor.a = ga;   // strong at the top of the screen and toward grazing, clearer low down'
            : 'outgoingLight = outgoingLight * (1.0 - Fc * cc) + env * Fc * cc;'}
          if (uVehDbg > 0.5) outgoingLight = uVehDbg > 1.5 ? vec3(Fc) : env;      // ?vdbg=1: what the lacquer mirrors; 2: how much of it
        }
        #include <opaque_fragment>`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'veh29' + JSON.stringify(o);
    return m;
  }
  const MAT = {
    paint0: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.22, envMapIntensity: 1.0 }), { paint: 1 }),
    paint: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.22, envMapIntensity: 1.0 }), { paint: 1, far: 1 }),
    misc: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true }), { misc: 1 }),
    wheel: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true }), { misc: 1, wheel: 1 }),
    glass0: patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.02, 0.03, 0.03), roughness: 0.03, metalness: 0, envMapIntensity: 1.25, transparent: true, depthWrite: false }), { glass: 1, seethru: 1 }),
    glass: patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.016, 0.018), roughness: 0.04, metalness: 0, envMapIntensity: 1.6 }), { glass: 1 }),
    tail: patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.30, 0.004, 0.004), roughness: 0.16, metalness: 0, emissive: 0xffffff }), { tail: 1 }),
    lens: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.03, metalness: 0, envMapIntensity: 1.8, transparent: true, opacity: 0.22, depthWrite: false }), { lens: 1, glass: 1 }),
    plate: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, map: plateAtlas() }), { plate: 1 }),
    livery: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, map: liveryAtlas(), alphaTest: 0.42 }), { livery: 1 }),
  };
  MAT.rack = MAT.misc;
  MAT.int = patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 0.3 }), { misc: 1, inner: 1 });

  // Poly Haven 'Old Tyre' (CC0, a photo-scanned tyre; SOURCES.md): the near band's tyres are this scan, sized to each model's wheel,
  // in place of the models' plain black rubber. ?vb_scan=0 keeps the models' own.
  let tyreScan = null;
  if (opt('vb_scan', '0') !== '0') try {      /* off since r17: the scan is fatter than the models' rims (it cut into the spokes) and read as 'fuzzy black blobs'; the models' own tyres are pressed flat instead */
    const gt = await new GLTFLoader().loadAsync(A + 'old_tyre/old_tyre_1k.gltf'); gt.scene.updateMatrixWorld(true); let mesh = null; gt.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld); g.computeBoundingBox(); const bb = g.boundingBox;
    const m = mesh.material; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = 8;
    m.metalness = 0; m.metalnessMap = null; m.envMapIntensity = 0.5; patch(m, { scan: 1 });
    tyreScan = { geo: g, mat: m, r: Math.max(bb.max.x, bb.max.y), w: bb.max.z - bb.min.z };
  } catch (e) { console.log('[streets] vehicles: tyre scan not loaded: ' + (e && e.message)); }
  const _ts = new THREE.Vector3(), _m4 = new THREE.Matrix4();

  // ---------------------------------------------------------------- geometry: one merged geometry per kind, level and group
  gltf.scene.updateMatrixWorld(true);
  const group = new THREE.Group(); group.name = 'streets_vehicles'; scene.add(group);
  const types = {}; let draws = 0;
  const RS = opt('vb_rs', '1') !== '0';      // ?vb_rs=0: bodies take no shadow (to tell shadow-map blotches from reflection)
  const mkMesh = (geo, mat, cap, cast) => { const im = new THREE.InstancedMesh(geo, mat, cap); im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = RS || !(mat === MAT.paint0 || mat === MAT.paint); im.count = 0; im.visible = false; im.matrixAutoUpdate = false; group.add(im); draws++; return im; };
  const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
  class Set_ {                                    // instances that share matrices and variation: the meshes of one group list
    constructor(cap, withColor) { this.cap = cap; this.n = 0; this.mat = attr(cap, 16); this.va = attr(cap, 4); this.col = withColor ? attr(cap, 3) : null; this.meshes = []; }
    addMesh(geo, mat, cast, color) { const im = mkMesh(geo, mat, this.cap, cast); im.instanceMatrix = this.mat; geo.setAttribute('aVar', this.va); if (color) im.instanceColor = this.col; this.meshes.push(im); return im; }
    put(m, a, b, c, d) { const i = this.n; if (i >= this.cap) return -1; m.toArray(this.mat.array, i * 16); const v = this.va.array; v[i * 4] = a; v[i * 4 + 1] = b; v[i * 4 + 2] = c; v[i * 4 + 3] = d; this.n = i + 1; return i; }
    color(i, c) { _c.set(c); const a = this.col.array; a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    end() { for (const im of this.meshes) { im.count = this.n; im.visible = this.n > 0; } if (this.n) { this.mat.clearUpdateRanges?.(); this.mat.addUpdateRange?.(0, this.n * 16); this.mat.needsUpdate = true; this.va.clearUpdateRanges?.(); this.va.addUpdateRange?.(0, this.n * 4); this.va.needsUpdate = true; if (this.col) { this.col.clearUpdateRanges?.(); this.col.addUpdateRange?.(0, this.n * 3); this.col.needsUpdate = true; } } }
  }
  let ktris = 0; const trisOf = {};
  for (const t of Object.keys(allMeta)) {
    const T = (types[t] = { meta: allMeta[t], lods: [] }); const caps = t === 'bus' ? CAP_BUS : CAP; trisOf[t] = [];
    for (let lod = 0; lod < 3; lod++) {
      const node = findNode('veh_' + t + '_l' + lod); if (!node) continue;
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), by = {};
      node.traverse((o) => { if (!o.isMesh) return; const g = groupOf(o.material.name, lod); if (!g) return; (by[g] ||= []).push(prepGeo(o, inv, g)); });
      const L = { main: new Set_(caps[lod], true), livery: null, rack: null, wheels: null }; let tris = 0;
      for (const g of Object.keys(by)) {
        const geo = by[g].length > 1 ? mergeGeometries(by[g]) : by[g][0]; tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        if (g === 'livery') { L.livery = new Set_(caps[lod], true); L.livery.addMesh(geo, MAT.livery, false, true); continue; }
        if (g === 'rack') { L.rack = new Set_(caps[lod], false); L.rack.addMesh(geo, MAT.rack, lod < 2, false); continue; }
        const mat = g === 'paint' ? (lod === 0 ? MAT.paint0 : MAT.paint) : g === 'glass' ? (lod === 0 ? MAT.glass0 : MAT.glass) : MAT[g];
        const im = L.main.addMesh(geo, mat, g === 'paint' || g === 'misc' || (g === 'glass' && lod > 0), g === 'paint');
        if (g === 'glass' && lod === 0) im.renderOrder = 2; if (g === 'lens') im.renderOrder = 3;
      }
      if (lod === 0) {
        const wn = findNode('vwheel_' + t);
        if (wn) { const winv = new THREE.Matrix4().copy(wn.matrixWorld).invert(), gs = []; wn.traverse((o) => { if (o.isMesh && !(tyreScan && o.material.name === 'tire')) gs.push(prepGeo(o, winv, 'misc')); });
          const geo = gs.length > 1 ? mergeGeometries(gs) : gs[0]; tris += 4 * (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
          L.wheels = new Set_(caps[0] * 4, false); L.wheels.addMesh(geo, MAT.wheel, true, false);
          if (tyreScan) { L.tyres = new Set_(caps[0] * 4, false); L.tyres.addMesh(tyreScan.geo.clone(), tyreScan.mat, true, false); const mm = allMeta[t]; L.tyreScale = new THREE.Vector3(mm.radius / tyreScan.r, mm.radius / tyreScan.r, Math.max(0.16, (mm.tw || 0.22) * 1.05) / tyreScan.w); tris += 4 * 2880; }
          const m = allMeta[t]; L.wpos = [[m.ax_f, -m.ywl, true, false], [m.ax_f, m.ywl, true, true], [m.ax_r, -m.ywl, false, false], [m.ax_r, m.ywl, false, true]].map((w) => ({ pos: new THREE.Vector3(w[0], m.radius, w[1]), front: w[2], flip: w[3] })); }
      }
      T.lods[lod] = L; trisOf[t][lod] = Math.round(tris);
    }
  }
  // ---------------------------------------------------------------- free real models that only stand at the kerb
  // Poly Haven 'Covered Car' (CC0, see SOURCES.md): its own textures and material, lit like the rest; length turned onto +X.
  const statics = {};
  try {
    const g2 = await new GLTFLoader().loadAsync(A + 'covered_car/covered_car_1k.gltf'); g2.scene.updateMatrixWorld(true);
    const turn = new THREE.Matrix4().makeRotationY(-Math.PI / 2), parts = [];
    g2.scene.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(turn, o.matrixWorld)); const m = o.material; if (m.map) m.map.anisotropy = 8; m.envMapIntensity = 0.6; patch(m, { own: 1 }); parts.push({ geo, m }); });
    const S = new Set_(48, false); for (const p of parts) { S.addMesh(p.geo, p.m, true, false); ktris += 0; }
    statics.covered = S;
  } catch (e) { console.log('[streets] vehicles: covered car not loaded: ' + (e && e.message)); }

  // Free real car models (Gazebo Fuel / Open Robotics, CC0; see SOURCES.md): their own photo textures, paint tinted per car where the
  // texture is bright and colourless, the same lacquer reflection and road dirt as the rest; four wheels that spin and steer.
  // They are a few thousand triangles each, so one band serves every distance.
  const reals = {}; let realMeta = {};
  const plateTex = (txt) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#c9a019'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#16224a'; g.lineWidth = 5; g.strokeRect(7, 7, 242, 114);
    g.fillStyle = '#16224a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 20px Arial, sans-serif'; g.fillText('EMPIRE STATE', 128, 24); g.font = 'bold 62px "Arial Narrow", Arial, sans-serif'; g.fillText(txt, 128, 74);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const PLATE_TXT = { fhatch: 'KDB 7703', fprius: 'HRM 2946', fpickup: 'JRT 5518' };
  if (opt('vreal', '0') === '1') try {
    realMeta = await fetch(A + 'real.json', { cache: 'no-store' }).then((r) => r.json());
    const g3 = await new GLTFLoader().loadAsync(A + 'real.glb'); g3.scene.updateMatrixWorld(true);
    for (const t of Object.keys(realMeta)) {
      const node = g3.scene.getObjectByName('real_' + t), wn = g3.scene.getObjectByName('rwheel_' + t); if (!node) { delete realMeta[t]; continue; }
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), R = { body: new Set_(120, true), wheels: new Set_(480, false), wpos: null, tris: realMeta[t].tris };
      const use = (o, set, m4, opt, color) => { const geo = o.geometry.clone(); geo.applyMatrix4(m4);
        if (opt.plate) { const p = geo.attributes.position, uv = new Float32Array(p.count * 2); let y0 = 1e9, y1 = -1e9; for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
          for (let i = 0; i < p.count; i++) { const u = (p.getZ(i) + 0.1525) / 0.305; uv[i * 2] = p.getX(i) > 0 ? 1 - u : u; uv[i * 2 + 1] = (p.getY(i) - y0) / (y1 - y0 || 1); } geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); } const m = o.material.clone(); m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true; m.side = THREE.FrontSide; if (opt.plate) { m.color.set(0xffffff); m.map = plateTex(PLATE_TXT[t] || 'KLM 4827'); m.side = THREE.DoubleSide; }
        if (/window|glass/i.test(m.name)) { m.map = null; m.color.setRGB(0.02, 0.025, 0.03); opt = { real: 1, glass: 1 }; color = false; } m.roughness = opt.wheel ? 0.7 : opt.glass ? 0.05 : 0.42; m.metalness = opt.wheel ? 0.0 : 0.15; m.envMapIntensity = 0.8; if (m.map) m.map.anisotropy = 8; patch(m, opt); set.addMesh(geo, m, true, color); };
      node.traverse((o) => { if (!o.isMesh) return; let p = o; while (p && p !== node) { if (p === wn) return; p = p.parent; } const plate = o.material.name === 'plate';
        use(o, R.body, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), plate ? { real: 1, plate: 1 } : { real: 1, paint: 1, tint: 1 }, !plate); });
      if (wn) { wn.traverse((o) => { if (o.isMesh) use(o, R.wheels, new THREE.Matrix4(), { real: 1, wheel: 1 }, false); });
        const m = realMeta[t]; R.wpos = [[m.ax_f, -m.ywl, true, false], [m.ax_f, m.ywl, true, true], [m.ax_r, -m.ywl, false, false], [m.ax_r, m.ywl, false, true]].map((w) => ({ pos: new THREE.Vector3(w[0], m.radius, w[1]), front: w[2], flip: w[3] })); }
      reals[t] = R;
    }
  } catch (e) { console.log('[streets] vehicles: real models not loaded: ' + (e && e.message)); realMeta = {}; }

  // the soft dark patch on the road under every car
  const blobGeo = new THREE.PlaneGeometry(2, 2); blobGeo.rotateX(-Math.PI / 2);
  // multiply-blended: the car's own footprint with rounded corners, near black right under the body, gone within 10 cm past the sills
  const blobMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  blobMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec2 vQ; varying vec2 vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz)); vQ = position.xz * vH;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec2 vQ; varying vec2 vH;')
      .replace('#include <opaque_fragment>', `{ vec2 hf = vH - 0.16; vec2 dq = abs(vQ) - (hf - 0.22); float outd = length(max(dq, 0.0)) - 0.22;
          float k = outd <= 0.0 ? 1.0 : 0.75 * exp(-outd * outd / (2.0 * 0.04 * 0.04)) + 0.25 * exp(-outd * outd / (2.0 * 0.22 * 0.22));      // a tight core and a soft skirt
          k *= 0.93 + 0.05 * clamp(-outd / 0.4, 0.0, 1.0);
          outgoingLight = vec3(1.0 - k); diffuseColor.a = 1.0; }
        #include <opaque_fragment>`);
  };
  const BLOB_CAP = 700, blob = new THREE.InstancedMesh(blobGeo, blobMat, BLOB_CAP); blob.frustumCulled = false; blob.count = 0; blob.renderOrder = 5;      /* after the road's own patch and decal layers (ground.js draws some at 2 and 3 since 15:25: they covered this shade) */ blob.matrixAutoUpdate = false; group.add(blob);
  const blobS = new THREE.Vector3();
  // where each tyre presses on the road: a small, nearly black patch fading out over a hand's width (the body's patch is too broad for it)
  const tyreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -14 });
  tyreMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec2 vQ;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vQ = position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec2 vQ;')
      .replace('#include <opaque_fragment>', '{ float q2 = dot(vQ, vQ); float k = max(0.92 * exp(-vQ.x * vQ.x * 9.0 - vQ.y * vQ.y * 1.2) * step(abs(vQ.y), 0.95), 0.7 * exp(-7.0 * q2) + 0.27 * exp(-1.6 * q2));      /* a hard dark line across the tread where it meets the road */ outgoingLight = vec3(1.0 - k); diffuseColor.a = 1.0; }\n #include <opaque_fragment>');
  };
  const TYRE_CAP = 400, tyreBlob = new THREE.InstancedMesh(blobGeo, tyreMat, TYRE_CAP); tyreBlob.frustumCulled = false; tyreBlob.count = 0; tyreBlob.renderOrder = 5.1; tyreBlob.matrixAutoUpdate = false; group.add(tyreBlob);
  const tyreS = new THREE.Vector3();
  function tyres(M, x, y, z, h) {
    if (tyreBlob.count + 4 > TYRE_CAP || !M.ax_f) return; const hw = (M.ywl || M.wid * 0.42), r = M.radius || 0.33;
    _e.set(0, h, 0); _q.setFromEuler(_e); tyreS.set(r * 1.05, 1, (M.tw || 0.22) * 1.0 + 0.12);
    for (const ax of [M.ax_f, M.ax_r]) for (const sd of [-hw, hw]) { _v.set(ax, 0, sd).applyQuaternion(_q); _v.x += x; _v.y = z + 0.014; _v.z += -y; _m2.compose(_v, _q, tyreS); tyreBlob.setMatrixAt(tyreBlob.count++, _m2); }
  }

  // ---------------------------------------------------------------- the lead's car drawing steps aside; rules replace his slots and mix
  for (const k in game.batches) { const b = game.batches[k]; for (const im of b.meshes.concat(b.wheelMeshes)) { im.count = 0; im.visible = false; } }
  const stub = { begin() {}, add() {}, end() {} };
  game.batches = new Proxy({}, { get: () => stub, ownKeys: () => [], has: () => true });
  let plazas = []; try { const r = await fetch(ctx.A + 'ground/plazas.json', { cache: 'no-store' }); if (r.ok) plazas = await r.json(); } catch (e) {}
  let sharedWays = []; try { const r = await fetch(ctx.A + 'ground/shared_streets.json', { cache: 'no-store' }); if (r.ok) sharedWays = await r.json(); } catch (e) {}
  const trees = []; { const seen = new Set(); for (const im of game.propMeshes || []) { const k = im.userData.kind, it = im.userData.items; if ((k === 'tree' || k === 'tree2') && it && !seen.has(it)) { seen.add(it); for (const p of it) trees.push(p); } } }
  const rules = applyAll(game, meta, { openx: oxMeta || undefined, plazas, shared: sharedWays, real: realMeta, realOn: opt('vreal', '0') === '1', trees: trees.length ? trees : undefined, double: opt('vdouble', '1') !== '0', occupancy: dense ? undefined : 0.5, target: +opt('vtraffic', 130) });

  // hero blocks, by hand: the car at the head of the W 22nd St north row is a yellow cab (the sedan model in cab dress); ?vcab=x,y;x,y
  // names other parked cars to turn into cabs, ?vcab=0 none
  const CABT = types.ox_cab ? 'ox_cab' : 'ox_corolla';
  for (const pt of String(opt('vcab', '-298.9,-413.4')).split(';').filter((v) => v && v !== '0')) { const [px, py] = pt.split(',').map(Number); let best = null, bd = 6;
    for (const s of game.parked.slots) { const d = Math.hypot(s.x - px, s.y - py); if (d < bd && s.def && s.def.len < 5.4) { bd = d; best = s; } }
    if (best && types[CABT] && game.kit.cars[CABT]) { best.type = CABT; best.def = game.kit.cars[CABT]; best.color = TAXI_YELLOW; best._vv = null;
      best.x += -Math.sin(best.h) * +opt('vcabin', '0.4'); best.y += Math.cos(best.h) * +opt('vcabin', '0.4'); }      /* in to the kerb on its left (critics: 'sitting in the travel lane') */ else console.log('[streets] vehicles: no car near ' + pt + ' to make a cab of'); }
  // ---------------------------------------------------------------- placing the instances (each render, from the rendering camera)
  const cam = world.camera, st = { near: 0, mid: 0, far: 0, tris: 0 };
  let camX = 0, camZ = 0, kLens = 1;
  function draw(o, type, x, y, z, h, roll, pitch, color, spin, steer, brake, seed) {
    const SK = statics[type], RK = reals[type];
    const T = types[type] || types.sedan, M = SK || RK ? game.kit.cars[type] : T.meta;
    const dx = x - camX, dz = -y - camZ, d0 = Math.hypot(dx, dz), d = d0 * kLens;
    if (d0 > FAR) return;
    if (d0 > 45) { _s.center.set(x, 1, -y); _s.radius = M.len * 0.6; if (!_fr.intersectsSphere(_s)) return; }
    let vv = o._vv; if (!vv || vv.type !== type || vv.color !== color) vv = o._vv = variant(type, seed === undefined ? Math.round(x * 13 + y * 7) : seed, color);
    if (SK) { if (d0 > 220) return; _e.set(0, h, 0); _q.setFromEuler(_e); _v.set(x, z, -y); _m.compose(_v, _q, _one); if (SK.put(_m, 0.3, 0.5, 0, 0) < 0) return;
      if (blob.count < BLOB_CAP) { _v.y = z + 0.012; blobS.set(M.len * 0.5 + 0.07, 1, M.wid * 0.5 + 0.1); _m2.compose(_v, _q, blobS); blob.setMatrixAt(blob.count++, _m2); } st.mid++; return; }
    if (RK) {
      if (RK.body.n >= RK.body.cap) return;
      let vv = o._vv; if (!vv || vv.type !== type || vv.color !== color) vv = o._vv = variant(type, seed === undefined ? Math.round(x * 13 + y * 7) : seed, color);
      _e.set(roll, h, pitch, 'YZX'); _q.setFromEuler(_e); _v.set(x, z, -y); _m.compose(_v, _q, _one);
      const i = RK.body.put(_m, vv.dirt, vv.seed01, 0, 0); RK.body.color(i, color);
      if (RK.wpos && d < 120) for (const w of RK.wpos) { _e.set(0, (w.front ? steer : 0) + (w.flip ? Math.PI : 0), w.flip ? spin : -spin, 'YZX'); _q.setFromEuler(_e); _m2.compose(w.pos, _q, _one); _m2.premultiply(_m); RK.wheels.put(_m2, Math.min(1, vv.dirt + 0.2), vv.seed01, M.radius, 0); }
      if (d0 < 170 && blob.count < BLOB_CAP) { _e.set(0, h, 0); _q.setFromEuler(_e); _v.set(x, z + 0.012, -y); blobS.set(M.len * 0.5 + 0.12, 1, M.wid * 0.5 + 0.12); _m2.compose(_v, _q, blobS); blob.setMatrixAt(blob.count++, _m2); }
      st.mid++; st.tris += RK.tris; return;
    }
    let lod = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : 2; while (lod < 2 && T.lods[lod].main.n >= T.lods[lod].main.cap) lod++;
    const L = T.lods[lod];
    _e.set(roll, h, pitch, 'YZX'); _q.setFromEuler(_e); _v.set(x, z + vv.ride - SINK, -y); _m.compose(_v, _q, _one);
    const i = L.main.put(_m, type === 'ox_cab' ? Math.max(vv.dirt, 0.42) : vv.dirt, vv.seed01, color === TAXI_YELLOW ? 1 : 0, brake ? 1 : 0); if (i < 0) return;
    L.main.color(i, color);
    if (vv.livery >= 0 && L.livery) { const j = L.livery.put(_m, vv.dirt, vv.seed01, vv.livery, 0); if (j >= 0) L.livery.color(j, vv.ink); }
    if (vv.rack && L.rack && type !== 'ox_cab') L.rack.put(_m, vv.dirt * 0.6, vv.seed01, 0, 0);
    if (L.wheels) {
      _v.y = z - SINK; _m3.compose(_v, _q, _one);
      for (const w of L.wpos) {
        _e.set(0, (w.front ? steer : 0) + (w.flip ? Math.PI : 0), w.flip ? spin : -spin, 'YZX'); _q.setFromEuler(_e); _m2.compose(w.pos, _q, _one); _m2.premultiply(_m3);
        L.wheels.put(_m2, Math.min(1, vv.dirt * 1.3 + 0.2), vv.seed01, M.radius, 0);
        if (L.tyres) { _m4.makeScale(L.tyreScale.x, L.tyreScale.y, L.tyreScale.z); _m4.premultiply(_m2); L.tyres.put(_m4, vv.dirt, vv.seed01, M.radius, 0); }
      }
    }
    if (d0 < 170 && blob.count < BLOB_CAP) { _e.set(0, h, 0); _q.setFromEuler(_e); _v.set(x, z + 0.012, -y); blobS.set(M.len * 0.5 + 0.12, 1, M.wid * 0.5 + 0.12); _m2.compose(_v, _q, blobS); blob.setMatrixAt(blob.count++, _m2); }
    if (VB.blob && d0 < 60) tyres(T.meta, x, y, z, h);
    if (lod === 0) st.near++; else if (lod === 1) st.mid++; else st.far++; st.tris += trisOf[type] ? trisOf[type][lod] : 0;
  }
  const near = [];
  function place() {
    cam.updateMatrixWorld(); _m.multiplyMatrices(cam.projectionMatrix, _m2.copy(cam.matrixWorld).invert()); _fr.setFromProjectionMatrix(_m);
    camX = cam.position.x; camZ = cam.position.z; kLens = Math.tan((cam.fov * Math.PI) / 360) / Math.tan((55 * Math.PI) / 360);
    for (const t in types) for (const L of types[t].lods) { if (!L) continue; L.main.n = 0; if (L.livery) L.livery.n = 0; if (L.rack) L.rack.n = 0; if (L.wheels) L.wheels.n = 0; if (L.tyres) L.tyres.n = 0; }
    blob.count = 0; tyreBlob.count = 0; st.near = st.mid = st.far = st.tris = 0; for (const k in statics) statics[k].n = 0; for (const k in reals) { reals[k].body.n = 0; reals[k].wheels.n = 0; }
    const tt = game.t;
    for (const c of game.traffic.cars) draw(c, c.type, c.x, c.y, 0, c.h, 0, 0, c.color, c.spin, c.steer, c.dbl ? (tt % 1.1) < 0.5 : c.brake, c.id);
    for (const v of game.vehicles) draw(v, v.type, v.x, v.y, v.z, v.h, v.roll, v.pitch, v.color, v.spin, v.steer, v.braking, v.vseed);
    for (const s of game.parked.near(camX, -camZ, FAR, near)) draw(s, s.type, s.x, s.y, 0, s.h, 0, 0, s.color, 0, 0, false, s.vseed);
    for (const t in types) for (const L of types[t].lods) { if (!L) continue; L.main.end(); if (L.livery) L.livery.end(); if (L.rack) L.rack.end(); if (L.wheels) L.wheels.end(); if (L.tyres) L.tyres.end(); }
    for (const k in statics) statics[k].end(); for (const k in reals) { reals[k].body.end(); reals[k].wheels.end(); }
    blob.visible = blob.count > 0; blob.instanceMatrix.needsUpdate = true; tyreBlob.visible = tyreBlob.count > 0; tyreBlob.instanceMatrix.needsUpdate = true;
  }
  const render0 = world.render.bind(world);
  world.render = function (...a) { if (group.visible) place(); const tv = shared.tStreet && shared.tStreet.value; VEH_STREET.value = streetOn && tv && world.streetRT && tv === world.streetRT.texture && (world.streetN || 0) > 24 ? 1 : 0; VEH_CUBE.value = VEH_STREET.value ? world.streetRT.texture : vehCube0.texture; if (world.streetCam) VEH_CPOS.value.copy(world.streetCam.position); return render0(...a); };
  place();
  for (const t in trisOf) ktris += trisOf[t][0] / 1000;
  const self = { group, types, stats: st, rules, place, vstreet: VEH_STREET, vcube: VEH_CUBE };
  game.streetVehicles = self;
  return { group, report: { kinds: Object.keys(types).length, draws, parked: rules.park.slots, traffic: game.traffic.cars.length, double: rules.double ? rules.double.spots : 0, plazas: plazas.length, off_plaza: rules.park.plaza, off_shared: rules.park.shared, off_kerb: rules.park.offKerb, drawn: st.near + '/' + st.mid + '/' + st.far, ktris: Math.round(st.tris / 1000), tris_per_kind: trisOf } };
}
