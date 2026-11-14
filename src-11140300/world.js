// world.js: loads the Blender-built city, sets up sky, sun, materials and the post chain.
import * as THREE from 'three';
import { panelUniforms, loadPanels } from './panels.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { installCamera } from './camera.js';   /* camera lane's module (lanes/camera/handoff/camera.js), hooked as its own world.patch does */
import { addHero } from './hero.js';
import { makeFacadeMaterial, makeSignAtlas, NOISE_GLSL, BAKE_LIGHT_GLSL } from './facade.js';

const A = 'assets/';
const texLoader = new THREE.TextureLoader();
function tex(name, srgb) {
  return new Promise((res, rej) => texLoader.load(A + 'tex/' + name, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t);
  }, undefined, rej));
}
async function texArray(names, srgb) {
  { const kx = window.__ktx2list && window.__ktx2list['array:' + names.join('|')]; if (kx) { const t = await window.__ktx2.loadAsync(kx); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; } }     /* lead: the same five walls as one Basis array texture (tools/ktxloose.py) */
  const S = 1024, data = new Uint8Array(S * S * 4 * names.length);
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < names.length; i++) {
    const img = await createImageBitmap(await (await fetch(A + 'tex/' + names[i])).blob());
    g.drawImage(img, 0, 0, S, S); data.set(g.getImageData(0, 0, S, S).data, i * S * S * 4);
  }
  const t = new THREE.DataArrayTexture(data, S, S, names.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// LIGHT lane: one place for the sky, sun and camera numbers. The sky is Poly Haven's qwantani_noon_puresky (CC0): a clear day, sun about twelve times the sky on the ground, so shade is deep and blue.
// The sun stands diagonal to the street grid (azimuth 164, the grid runs 29 and 119) so every street has one sunlit side and a lit floor;
// its sun and sky strengths below were measured from the file (tools/hdr.py), so sun : sky is the photographed ratio, not a guess.
export const LIGHT = {
  sky: 'light/sky_4k.hdr', skySunU: 0.59521484, skySunEl: 47.99,
  sunE: [8.6, 8.5, 7.7],  // the picture's own sun measures 4.52, 4.55, 4.16 through thin cloud; a sun in a clear gap is about 1.9x that (sun 4.5x the sky on the ground)
           // irradiance on a face turned to the sun (scene units, same scale as the sky picture)
  envI: 1.1,                         // the sky lights the city at its own strength
  sunAz: 188, sunEl: 48,             // used when the build was baked for another sun (override); the bake should use the same
  fog: 0.00014, /* light L11: was .00028; critics read the haze a block away as a grey veil */ shadowR: 150, shadowMap: 4096, shadowNear: 500, shadowFar: 2100,
  sunSize: 0.015,                    // tangent of the sun's width as shadows see it (disc plus a little aureole): penumbra = distance to the caster x this
  key: 0.215, hi: 0.70, aoR: 1.5, aoS: 3.2, aoT: 1.5,   /* contact shade: reach (m), strength, thickness */
  expMin: 0.45, expMax: 4.0,
  pk: 0.75, pkMin: 0.6, pkLo: 0.6, /* light L19 (a lower floor, pkLo .35, where over a fifth of the street half is sunlit) did NOT hold when re-judged on several frames (L21: 5 of 12): pkLo = pkMin leaves it switched off */               /* light L11: highlight guard. The brightest part of the street half of the frame (8th-power mean) may not land above pk after exposure, so sunlit paving keeps its joints; the guard closes down at most to pkMin of the metered exposure. 0 = off */
  gnd: 1.0, sunK: 1.0, con: 0.55, sho: 0.35, knee: 0.36, /* light: trial knobs, all neutral at these numbers. gnd = how bright the city floor is to the image-based light; sunK scales the sun; con = film contrast (L11: .55, was .40) */
  wbR: 1.0, wbB: 1.01, skyGain: 1.35, shSearch: 0.8, bloomS: 0.10, bloomT: 2.5,
  ltmH: 0.5, ltmS: 0.0, ltmLo: 1.5, ltmHi: 2.0, /* light L28: the camera lane's local tone step (camera.js uLtmH / uLtmS), switched in by the exposure: nothing below exposure ltmLo (open sunlit streets), full from ltmHi up (dark close views with a sunlit sidewalk in frame, where the meter has opened wide) */
};
const Q = new URLSearchParams(location.search);
for (const k of Object.keys(LIGHT)) if (Q.has('L' + k)) LIGHT[k] = isNaN(+Q.get('L' + k)) ? Q.get('L' + k) : +Q.get('L' + k);

// Sun shadows the way the sun makes them: sharp where the caster touches, wider the farther the caster is (a blocker search, then a
// filter as wide as that penumbra), with the compare plane tilted to the receiving surface so wide filters do not self-shadow.
function installSunShadows() {
  if (THREE.ShaderChunk.__lightPcss) return; THREE.ShaderChunk.__lightPcss = true;
  const f = (x) => Number(x).toFixed(6);
  // lead: 12 + 32 taps a pixel is the still/capture quality; live play takes 6 + 14 (the noise turns per pixel, so it stays soft) to hold frame rate. ?Ltaps=32 forces a count.
  const NF = Math.round(+Q.get('Ltaps') || (Q.has('capture') || Q.has('shot') ? 32 : 14)), NB = Math.max(4, Math.round(NF * 0.4));
  // Nov 11, Windows reports (RTX 4070 / 5070, Direct3D): every lit shader logged "X3595: gradient instruction used in a loop with varying
  // iteration" and the page froze for 20 to 43 s while Direct3D's compiler chewed on these two loops (the second one runs after an early return,
  // and texture2D() needs screen-space gradients, which the compiler can only give by unrolling everything). The shadow map has one level, so the
  // lookups now name it (textureLod ..., 0.0): no gradients, nothing to unroll. Same picture.
  const pcss = `
  float lightIgn(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  vec2 lightVogel(int i, float n, float a){ float r = sqrt((float(i) + 0.5) / n), t = float(i) * 2.3999632 + a; return r * vec2(cos(t), sin(t)); }
  float pcssShadow(sampler2D sm, vec4 sc, float turn){
    const float WORLD = ${f(2 * LIGHT.shadowR)}, RANGE = ${f(LIGHT.shadowFar - LIGHT.shadowNear)}, SUN = ${f(LIGHT.sunSize)}, SEARCH = ${f(LIGHT.shSearch)}, MINW = ${f(1.6 * 2 * LIGHT.shadowR / LIGHT.shadowMap)};
    vec3 ax = dFdx(sc.xyz), ay = dFdy(sc.xyz); float det = ax.x * ay.y - ax.y * ay.x;
    vec2 grad = abs(det) > 1e-14 ? vec2(ay.y * ax.z - ax.y * ay.z, ax.x * ay.z - ay.x * ax.z) / det : vec2(0.0);
    grad = clamp(grad, vec2(-2.5), vec2(2.5));
    float a = (lightIgn(gl_FragCoord.xy) + turn) * 6.2831853, zb = 0.0, nb = 0.0;
    for (int i = 0; i < ${NB}; i++) { vec2 o = lightVogel(i, ${NB}.0, a) * (SEARCH / WORLD); float d = unpackRGBAToDepth(textureLod(sm, sc.xy + o, 0.0)); if (d < sc.z + dot(grad, o)) { zb += d; nb += 1.0; } }
    if (nb < 0.5) return 1.0;
    float pen = clamp((sc.z - zb / nb) * RANGE * SUN, MINW, SEARCH * 2.0), s = 0.0;
    for (int i = 0; i < ${NF}; i++) { vec2 o = lightVogel(i, ${NF}.0, a + 1.7) * (0.5 * pen / WORLD); s += step(sc.z + dot(grad, o), unpackRGBAToDepth(textureLod(sm, sc.xy + o, 0.0))); }
    return s / ${NF}.0;
  }
  float getShadow(`;
  let c = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (!c.includes('float getShadow(') || !c.includes('#if defined( SHADOWMAP_TYPE_PCF )')) { console.warn('[game] sun shadows: three.js shader changed, soft-shadow patch not applied'); return; }
  c = c.replace('float getShadow(', pcss).replace('#if defined( SHADOWMAP_TYPE_PCF )', '#if 1\n shadow = pcssShadow( shadowMap, shadowCoord, shadowRadius );\n#elif defined( SHADOWMAP_TYPE_PCF )');
  THREE.ShaderChunk.shadowmap_pars_fragment = c;
  // haze that thickens steadily with distance (plain exponential), not three's squared falloff that sits clear and then walls up
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace('exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )', 'exp( - fogDensity * vFogDepth )');
}

// A .glb served gzipped (name.glb.gz) and unpacked in the page: the real-massing city is 230 MB raw, 39 MB packed. Falls back to the plain file.
// the sky picture, gzip-packed like the city (20 MB -> 13 MB over the link), unpacked in the page; falls back to the plain file
async function loadHDR(url) {
  try { const r = await fetch(url + '.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const L = new RGBELoader(), d = L.parse(buf), t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type); t.colorSpace = THREE.LinearSRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true; t.needsUpdate = true; return t;
  } catch (e) { return await new Promise((res) => new RGBELoader().load(url, res)); }
}
async function loadGLB(url) {
  try {
    if (!self.DecompressionStream) throw new Error('no packed file');
    const split = window.__CFG && window.__CFG.public && /city\.glb$/.test(url);     /* the public build ships the city only in parts: do not ask for the whole file first (a 404 in every visitor's log) */
    let r = split ? { ok: false } : await fetch(url + '.gz'), body = r.ok ? r.body : null;
    if (!body) {     // the public host takes no file over 25 MB: there the packed file is cut into url.gz.p0, .p1, ... (tools/public_build.sh), fetched together and joined
      let np = 16; try { const q = await fetch(url + '.gz.n.json'); if (q.ok) np = +(await q.json()).parts || 16; } catch (e) {}
      const parts = []; for (let i = 0; i < np; i++) parts.push(fetch(url + '.gz.p' + i).then((q) => (q.ok ? q.arrayBuffer() : null)).catch(() => null));
      const got = await Promise.all(parts), n = got.findIndex((q) => !q); const use = got.slice(0, n < 0 ? got.length : n); if (!use.length) throw new Error('no packed file'); body = new Blob(use).stream(); }
    const buf = await new Response(body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return await new GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, ''));
  } catch (e) { return await new GLTFLoader().loadAsync(url); }
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.25, 6000); this.fixedNear = +Q.get('near') || 0; this.zK = +Q.get('zk') || 6; this.zN = 0;     /* ?near=0.25 pins the near plane (the old state) */
    this.shared = {
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uShadowFar: { value: LIGHT.shadowR }, uShadowCenter: { value: new THREE.Vector3() },
      ...panelUniforms(), uTime: { value: 0 }, tStreet: { value: null }, tWallA: { value: null }, tWallN: { value: null }, tSign: { value: null }, tLight: { value: null }, uHalf: { value: new THREE.Vector2() },
    };
    installSunShadows();
    this.q = { shadow: LIGHT.shadowMap, gtao: true, bloom: true, msaa: Q.has('msaa') ? +Q.get('msaa') : 4 };
  }

  async load(onProgress = () => {}) {
    const [build, city] = await Promise.all([fetch(A + 'build.json').then((r) => r.json()), fetch(A + (Q.get('city') || 'city.json')).then((r) => r.json())     /* tiles lane: ?city=sets/union/city.json = the stitched two-area city (test) */]);
    this.city = city; this.build = build;
    let s = build.sun; const bakedEl = Math.asin(s[2] / Math.hypot(s[0], s[1], s[2])) * 180 / Math.PI;
    if (Math.abs(bakedEl - LIGHT.skySunEl) > 3 || Q.has('LsunAz')) { const a = LIGHT.sunAz * Math.PI / 180, e = LIGHT.sunEl * Math.PI / 180; s = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]; this.sunOverride = true; }
    this.sunDir = new THREE.Vector3(s[0], s[2], -s[1]).normalize();     // map (east, north, up) -> three (x, y up, -north)
    this.shared.uSunDir.value.copy(this.sunDir); this.shared.uHalf.value.set(build.hx, build.hy);
    onProgress('textures'); await loadPanels(A + 'panels/', this.shared);
    const walls = ['red_brick_03', 'white_sandstone_bricks_03', 'concrete_wall_008', 'dark_brick_wall', 'yellow_brick'];
    const [wa, wn, lm, asA, asN, asR, cpA, cpN, grA, sky] = await Promise.all([
      texArray(walls.map((w) => w + '_diff.jpg'), true), texArray(walls.map((w) => w + '_nor.jpg'), false),
      // tiles lane: a city of more than one area (city.meta.sets) has ONE ground lightmap twice as tall (ground_light2, lanes/tiles/tools/lightmap_join.py): the
      // old picture in its middle half, the north in the upper quarter and, wrapped round, in the lower one. It repeats in v and uHalf.y is doubled (below), so
      // every shader's own lookup v = y / (2 uHalf.y) + 0.5 lands right with no change. A card that cannot hold 8192 px, or ?lm2=0, keeps the old picture.
      new Promise((res) => { const tall = (this.lm2 = !!(city.meta.sets && Q.get('lm2') !== '0' && this.renderer.capabilities.maxTextureSize >= 8192));
        const one = (name, wrapT, next) => texLoader.load(A + name, (t) => { t.colorSpace = THREE.NoColorSpace; t.flipY = true; t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = wrapT; t.anisotropy = 4; res(t); }, undefined, next);
        if (tall) one('ground_light2.webp', THREE.RepeatWrapping, () => { this.lm2 = false; one('ground_light.webp', THREE.ClampToEdgeWrapping, () => res(null)); }); else one('ground_light.webp', THREE.ClampToEdgeWrapping, () => res(null)); }),
      tex('asphalt_02_diff.jpg', true), tex('asphalt_02_nor.jpg'), tex('asphalt_02_rough.jpg'), tex('concrete_pavement_diff.jpg', true), tex('concrete_pavement_nor.jpg'), tex('leafy_grass_diff.jpg', true),
      loadHDR(A + LIGHT.sky),
    ]);
    Object.assign(this.shared.tWallA, { value: wa }); this.shared.tWallN.value = wn; this.shared.tLight.value = lm; if (this.lm2) this.shared.uHalf.value.y = 2 * build.hy;     /* tiles lane: the tall two-area lightmap (see its load above) */ this.shared.tSign.value = makeSignAtlas();
    this.setupSky(sky);
    onProgress('city');
    const facade = makeFacadeMaterial(this.shared);
    // tiles lane: the buildings come as tiles that load around the camera (tiles.js; assets/tiles). ?tiles=0, or no assets/tiles, is city.glb whole as before.
    let gltf = null; if (Q.get('tiles') !== '0') { try { const { Tiles } = await import('./tiles.js'); const tl = new Tiles(this); gltf = { scene: await tl.start(facade, this.startAt) }; this.tiles = tl; } catch (e) { console.warn('[game] tiles not used, loading city.glb: ' + (e && e.message)); } }
    if (!gltf) gltf = await loadGLB(A + 'city.glb');
    gltf.scene.userData.streetCube = true;
    const mats = {
      road: this.groundMaterial({ map: asA, normalMap: asN, roughnessMap: asR, kind: 0 }),
      sidewalk: this.groundMaterial({ map: cpA, normalMap: cpN, kind: 1 }),
      curb: this.groundMaterial({ map: cpA, normalMap: cpN, kind: 2 }),
      grass: this.groundMaterial({ map: grA, kind: 3 }),
      marks: this.groundMaterial({ kind: 4 }),
    };
    this.cityRoot = gltf.scene; this.buildingMeshes = [];
    const setupCityMesh = (o) => {
      if (!o.isMesh) return;
      const n = o.name;
      if (o.userData.tile) { this.buildingMeshes.push(o); return; }     /* a tile mesh: tiles.js has set it up */
      if (n.startsWith('bld_')) { o.material = facade; o.castShadow = true; o.receiveShadow = true; this.buildingMeshes.push(o); o.geometry.computeBoundingSphere(); }
      else {
        const k = n.replace(/_\d+$/, ''); o.material = mats[k] || mats.road; o.receiveShadow = true; o.castShadow = false;
        if (k === 'marks') { o.renderOrder = 2; }
        if (k === 'road') o.renderOrder = -1;
      }
      o.matrixAutoUpdate = false; o.updateMatrix();
    };
    gltf.scene.traverse(setupCityMesh); if (this.tiles) this.tiles.onGround = (c) => c.traverse(setupCityMesh);     /* tiles lane: the ground of a tile set that loads later gets the same materials */
    this.scene.add(gltf.scene);
    // the far city: the real massing beyond the fetched box, whole buildings thinned by height with distance (lanes/facades ffar.py)
    try {
      const far = await loadGLB(A + 'far.glb');
      // lead, Nov 10: the far tiles repeat buildings the near city also has, wall on wall; pushed back in depth so the near one always wins (z-fighting from the air)
      const farMat = Q.get('zk') === '1' ? facade : facade.clone(); if (farMat !== facade) { farMat.onBeforeCompile = facade.onBeforeCompile; farMat.customProgramCacheKey = facade.customProgramCacheKey; farMat.polygonOffset = true; farMat.polygonOffsetFactor = 2; farMat.polygonOffsetUnits = 8; farMat.userData.zk = 1; }
      far.scene.traverse((o) => { if (o.isMesh) { o.material = farMat; o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; o.updateMatrix(); } });
      this.scene.add(far.scene); this.farRoot = far.scene;
    } catch (e) { console.warn('[game] no far city: ' + e.message); }
    this.setupLights();
    this.setupPost();
    // facades lane (round 6): a cube picture of the street at the eye, so glass mirrors the real scene (the sky map holds no street).
    // lead: stills and capture redraw all six faces with the whole scene every 6th frame, as the lane wrote it. Live play cannot pay six extra
    // scene draws in a frame, so it redraws ONE face a frame and only what a window can show at that size: buildings, ground, trees, sky (layer 3).
    this.streetRT = new THREE.WebGLCubeRenderTarget(+Q.get('scube') || 512, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });     // lead, Nov 10: 512 in live play too (256 showed stair-steps in car paint and shop glass); a face is drawn every third frame, so the cost is small
    this.streetDummy = new THREE.WebGLCubeRenderTarget(1); this.streetCam = new THREE.CubeCamera(0.5, 4000, this.streetRT); this.scene.add(this.streetCam);
    this.shared.tStreet.value = this.streetDummy.texture; this.streetN = 0; this.streetFull = Q.has('capture') || Q.has('shot') || Q.get('street') === 'full'; this.streetOff = Q.get('street') === '0';
    if (Q.get('hero') !== '0' && !(window.__CFG && window.__CFG.hero === false && Q.get('hero') !== '1')) { try { await addHero(this, A + 'hero/'); } catch (e) { console.warn('[game] hero buildings not loaded: ' + (e && e.message)); } }     // facades lane: hand-built hero buildings (Flatiron, Madison Green, 23rd/5th corner, 200 Fifth)
    onProgress('ready');
  }

  setupSky(hdr) {
    // The photographed sky, turned so its sun sits where the bake's sun is. One dome for the eye, one PMREM of it for image-based light.
    hdr.mapping = THREE.EquirectangularReflectionMapping; hdr.wrapS = THREE.RepeatWrapping; hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter; hdr.generateMipmaps = false; hdr.anisotropy = 4;
    const hdrSunAz = (LIGHT.skySunU - 0.5) * Math.PI * 2;       // where the sun is in the picture (measured, see pipeline notes)
    const want = Math.atan2(this.sunDir.z, this.sunDir.x);
    this.skyU = { uGnd: { value: LIGHT.gnd }, uSkyGain: { value: LIGHT.skyGain } };   /* light L25: uniforms, so setLight() can change them in a running page */
    const mk = (forEnv) => new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: !forEnv, fog: false,
      uniforms: { tSky: { value: hdr }, uRot: { value: want - hdrSunAz }, uEnv: { value: forEnv ? 1 : 0 }, uGain: { value: 1.0 }, uGnd: this.skyU.uGnd, uSkyGain: this.skyU.uSkyGain },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 0.0); gl_Position = projectionMatrix * vec4(p.xyz, 1.0); gl_Position.z = gl_Position.w * 0.9999999; }`,
      fragmentShader: `uniform sampler2D tSky; uniform float uRot; uniform float uEnv; uniform float uGain, uGnd, uSkyGain; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float a = atan(d.z, d.x) - uRot; vec2 uv = vec2(a / 6.2831853 + 0.5, asin(clamp(d.y, -1., 1.)) / 3.14159265 + 0.5);
          vec3 c = textureLod(tSky, vec2(fract(uv.x), clamp(uv.y, 0.001, 0.999)), 0.0).rgb;
          vec3 horizon = textureLod(tSky, vec2(fract(uv.x), 0.505), 0.0).rgb;
          // below the horizon: the city floor as the light sees it (dim, warm-grey), a soft blend up to the real sky
          vec3 ground = vec3(0.075, 0.07, 0.065) * uGnd * (uEnv > 0.5 ? 1.0 : 0.0) + (uEnv > 0.5 ? vec3(0.0) : horizon * 0.9);
          if (uEnv < 0.5) c = mix(c, vec3(0.62, 0.68, 0.80) * 1.05, 0.65 * exp(-max(d.y, 0.0) * 5.0));     // the air near the horizon, as the street haze has it
          if (uEnv < 0.5) { float sl = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(c, sl * vec3(0.80, 1.0, 1.16), 0.22) * uSkyGain; }   // as a phone renders it beside a sunlit street: lighter and a touch more cyan than the HDR's cobalt
          c = mix(ground, c, smoothstep(-0.02, 0.03, d.y));
          c = min(c, vec3(uEnv > 0.5 ? 60.0 : 14.0));           // the sun disc itself is the DirectionalLight's job
          gl_FragColor = vec4(c * uGain, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.skyMesh = new THREE.Mesh(geo, mk(false)); this.skyMesh.scale.setScalar(5000); this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -10;
    this.skyMesh.onBeforeRender = (r, s, cam) => { this.skyMesh.position.copy(cam.position); this.skyMesh.updateMatrixWorld(); };
    this.scene.add(this.skyMesh);
    const envScene = new THREE.Scene(); const em = new THREE.Mesh(geo, mk(true)); em.scale.setScalar(100); envScene.add(em);
    const pm = new THREE.PMREMGenerator(this.renderer); this.envScene = envScene;
    this.scene.environment = pm.fromScene(envScene, 0, 1, 1000).texture; this.scene.environmentIntensity = LIGHT.envI;
    pm.dispose();
    // aerial haze, tinted like the sky near the horizon
    this.scene.fog = new THREE.FogExp2(new THREE.Color(0.62, 0.68, 0.80), LIGHT.fog);
  }

  // light L25: change LIGHT numbers in a running page (the frozen-street capture draws kept and trial states in one page load).
  // world.setLight({ sunK: .6, key: .166 }); exposure snaps to the new metered value on the next frame. Not for: sky file, sun direction, shadow box, AO, bloom.
  setLight(o) {
    for (const k in o) if (k in LIGHT) LIGHT[k] = o[k];
    const I = Math.max(...LIGHT.sunE) * LIGHT.sunK; this.sun.intensity = I; this.shared.uSunColor.value.copy(this.sun.color).multiplyScalar(I / Math.PI);
    this.scene.environmentIntensity = LIGHT.envI; this.scene.fog.density = LIGHT.fog; this.skyU.uSkyGain.value = LIGHT.skyGain;
    if (this.skyU.uGnd.value !== LIGHT.gnd) { this.skyU.uGnd.value = LIGHT.gnd; const pm = new THREE.PMREMGenerator(this.renderer), old = this.scene.environment; this.scene.environment = pm.fromScene(this.envScene, 0, 1, 1000).texture; pm.dispose(); if (old) old.dispose(); }
    const f = this.film.uniforms; f.uCon.value = LIGHT.con; f.uKnee.value = LIGHT.knee; f.uShoulder.value = LIGHT.sho; f.uWB.value.set(LIGHT.wbR, 1.0, LIGHT.wbB);
    const u = this.expMat.uniforms; u.uPk.value = LIGHT.pk; u.uPkMin.value = LIGHT.pkMin; u.uPkLo.value = LIGHT.pkLo; u.uFirst.value = 1; this.meterDone = false; return LIGHT;
  }

  // light L28: local tone strength follows the exposure (see LIGHT.ltmH)
  // light L33: the switch is worked out in the camera pass itself from the exposure it already reads (uLtmLo / uLtmHi), so nothing is read back to the
  // page: the one-float read-back of handoff10 stalled the frame it landed on (Metal waits for the GPU): 1.4 ms a frame on an M2 Pro, 2.6 ms on an M2 Max.
  // world.ltmGPU = false (or ?ltmread=1) is the handoff10 way, for like-for-like checks.
  setLtm() { const u = this.film.uniforms; if (!u.uLtmH) return;
    if (this.ltmGPU) { u.uLtmH.value = LIGHT.ltmH; u.uLtmS.value = LIGHT.ltmS; u.uLtmLo.value = LIGHT.ltmLo; u.uLtmHi.value = Math.max(LIGHT.ltmHi, LIGHT.ltmLo + 1e-3); return; }
    if (u.uLtmLo) { u.uLtmLo.value = -2; u.uLtmHi.value = -1; }
    const e = Math.min(1, Math.max(0, (this.ltmEx - LIGHT.ltmLo) / Math.max(1e-3, LIGHT.ltmHi - LIGHT.ltmLo))), k = e * e * (3 - 2 * e); u.uLtmH.value = LIGHT.ltmH * k; u.uLtmS.value = LIGHT.ltmS * k; }

  setupLights() {
    const I = Math.max(...LIGHT.sunE) * LIGHT.sunK, sunCol = new THREE.Color(LIGHT.sunE[0] * LIGHT.sunK / I, LIGHT.sunE[1] * LIGHT.sunK / I, LIGHT.sunE[2] * LIGHT.sunK / I);
    const sun = new THREE.DirectionalLight(sunCol, I);
    sun.castShadow = true; sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    const R = this.shared.uShadowFar.value;
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: LIGHT.shadowNear, far: LIGHT.shadowFar }); sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00002; sun.shadow.normalBias = 0.05; sun.shadow.radius = 1.0;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
    this.shared.uSunColor.value.copy(sunCol).multiplyScalar(I / Math.PI);
  }

  // keep the shadow box around the point of interest, snapped to whole texels so the shadow edges do not crawl
  updateShadow(center) {
    const R = this.shared.uShadowFar.value, texel = (2 * R) / this.q.shadow;
    const cam = this.sun.shadow.camera; const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.sunDir);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const x = Math.round(center.dot(right) / texel) * texel, y = Math.round(center.dot(up) / texel) * texel, z = center.dot(this.sunDir);
    const c = right.clone().multiplyScalar(x).addScaledVector(up, y).addScaledVector(this.sunDir, z);
    this.sun.target.position.copy(c); this.sun.position.copy(c).addScaledVector(this.sunDir, 1300); this.sun.target.updateMatrixWorld(); this.sun.updateMatrixWorld();
    this.shared.uShadowCenter.value.copy(c);
  }

  groundMaterial({ map, normalMap, roughnessMap, kind }) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, map: map || null, normalMap: normalMap || null, roughnessMap: roughnessMap || null });
    if (kind === 4 || kind === 2 || kind === 3) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }
    if (kind === 2) m.side = THREE.DoubleSide;
    if (kind === 4) { m.transparent = true; m.depthWrite = false; }
    if (m.normalMap) m.normalScale.set(0.9, 0.9);
    const shared = this.shared;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n attribute vec4 color; varying vec3 vWPos; varying vec3 vMarkCol;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vMarkCol = ${kind === 4 ? 'color.rgb' : 'vec3(1.0)'};
          #ifdef USE_MAP
            vMapUv = vWPos.xz / ${kind === 0 ? '5.0' : '3.0'};
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = vWPos.xz / ${kind === 0 ? '5.0' : '3.0'};
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = vWPos.xz / 5.0;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vMarkCol; uniform sampler2D tLight; uniform vec2 uHalf;
          uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
          ${NOISE_GLSL}
          vec3 bakeV; vec3 bakeN; float gWet;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 w = vWPos.xz;
            bakeV = texture2D(tLight, vec2(w.x / (2.0 * uHalf.x) + 0.5, -w.y / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);
            float big = fbm(w * 0.045), mid = fbm(w * 0.33 + 9.0), fine = vnoise(w * 7.0);
            gWet = 0.0;
            ${kind === 0 ? `
              // asphalt: a second, rotated texture read breaks the tiling; patches, tar seams, oil along the lanes, manhole covers
              vec3 a2 = texture2D(map, w.yx / 13.7 + 0.31).rgb;
              diffuseColor.rgb = mix(diffuseColor.rgb, a2, 0.45); diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.333))), diffuseColor.rgb, 0.6) * 0.78 + 0.02;
              diffuseColor.rgb *= 0.72 + 0.55 * big;
              float patch_ = step(0.62, fbm(floor(w / vec2(3.1, 2.3) + big * 2.0) * 0.37)); diffuseColor.rgb *= mix(1.0, 0.72, patch_ * step(0.55, mid));
              float crack = smoothstep(0.02, 0.0, abs(fbm(w * 0.6 + 40.0) - 0.5) - 0.004) ; diffuseColor.rgb *= 1.0 - 0.45 * crack * step(0.45, big);
              vec2 mc = floor(w / 23.0); vec2 mp = (fract(w / 23.0) - 0.5) * 23.0 - (hash32(mc).xy - 0.5) * 14.0; float md = length(mp);
              float cover = step(md, 0.42) * step(0.35, hash21(mc + 4.0));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.075, 0.07) * (0.7 + 0.6 * step(0.5, fract(md * 9.0))), cover);
              gWet = cover * 0.5 + 0.25 * smoothstep(0.55, 0.8, mid) * (1.0 - big);
            ` : ''}
            ${kind === 1 ? `
              // sidewalk: scored concrete flags, each a touch different, gum and stains
              diffuseColor.rgb *= vec3(0.80, 0.78, 0.75);
              vec2 g = w * mat2(0.875, -0.484, 0.484, 0.875) / 1.52; vec2 gi = floor(g), gf = fract(g);
              float joint = smoothstep(0.012, 0.004, min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y)));
              diffuseColor.rgb *= 0.86 + 0.26 * hash21(gi) ; diffuseColor.rgb *= 1.0 - 0.5 * joint;
              diffuseColor.rgb *= 0.78 + 0.4 * big;
              vec2 gc = floor(w * 2.2); float gum = step(0.965, hash21(gc)) * smoothstep(0.16, 0.10, length(fract(w * 2.2) - 0.3 - 0.4 * hash32(gc).xy));
              diffuseColor.rgb *= 1.0 - 0.6 * gum;
              diffuseColor.rgb *= 1.0 - 0.3 * smoothstep(0.6, 0.85, mid);
            ` : ''}
            ${kind === 2 ? `diffuseColor.rgb = vec3(0.30, 0.30, 0.295) * (0.7 + 0.5 * mid) * (0.8 + 0.4 * fine) * (0.75 + 0.5 * big);` : ''}
            ${kind === 3 ? `diffuseColor.rgb *= vec3(0.75, 0.95, 0.6) * (0.6 + 0.7 * big) * (0.85 + 0.3 * mid);` : ''}
            ${kind === 4 ? `
              float wear = fbm(w * 1.7) * 0.6 + fbm(w * 9.0) * 0.4;
              diffuseColor.rgb = vMarkCol * (0.50 + 0.25 * big) * (0.8 + 0.2 * fine); diffuseColor.a = smoothstep(0.30, 0.62, wear + 0.12 - 0.25 * mid) * (0.75 + 0.25 * big);
            ` : ''}
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          ${kind === 0 ? 'roughnessFactor = clamp(roughnessFactor * 0.95 - gWet * 0.5, 0.2, 1.0);' : ''}`)
        .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL);
    };
    m.customProgramCacheKey = () => 'ground4' + kind;
    return m;
  }

  setupPost() {
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    // audit item 2 (Nov 10): live play no longer multisamples the half-float scene target or redraws every mesh for the AO pass. The scene target
    // carries a depth texture; GTAO reads that (normals rebuilt from depth) at half size, and FXAA smooths edges. Film capture and stills keep 4x
    // MSAA and the full normal pass. ?aa=msaa or ?aodepth=0 = the old live path.
    this.aoDepth = Q.get('aa') !== 'msaa' && Q.get('aodepth') !== '0' && !Q.has('msaa');     // film capture and stills too since Nov 10 22:15 (CHIEF: reel frames must match the link); they run the AO at full size
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.aoDepth ? 0 : this.q.msaa });
    if (this.aoDepth) { rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.depthTexture.format = THREE.DepthFormat; rt.depthTexture.type = THREE.UnsignedIntType; }
    const comp = new EffectComposer(r, rt); this.composer = comp;
    comp.addPass(new RenderPass(this.scene, this.camera));
    // world.nearObject (set by the helicopter while the eye is in the cabin): that object is drawn in a second pass over the scene with its own
    // camera (near 0.1 m, far 40 m, depth cleared first), so things a hand's width from the eye do not cost the far city its depth precision.
    this.nearCam = new THREE.PerspectiveCamera(); this.nearCam.layers.set(5); this.nearPass = new RenderPass(this.scene, this.nearCam); this.nearPass.clear = false; this.nearPass.clearDepth = true; this.nearPass.enabled = false; comp.addPass(this.nearPass);
    if (this.q.gtao) {
      const g = new GTAOPass(this.scene, this.camera, size.x, size.y); g.output = GTAOPass.OUTPUT.Default; g.blendIntensity = 1.0;
      if (this.aoDepth) {     // (GTAOPass.setGBuffer(depth) throws in r170 when no normal target exists, so the switch is made by hand)
        g._renderGBuffer = false; g.depthTexture = rt.depthTexture; g.normalTexture = undefined;
        for (const m of [g.gtaoMaterial, g.pdMaterial]) { m.defines.NORMAL_VECTOR_TYPE = 0; m.defines.DEPTH_SWIZZLING = 'x'; m.uniforms.tNormal.value = null; m.uniforms.tDepth.value = rt.depthTexture; m.needsUpdate = true; }
        // the scene lands in whichever composer buffer is the read buffer this frame: take that one's depth; AO targets at a fraction of the size
        const rd = g.render.bind(g); g.render = (r2, wb, rb, dt2, mk) => { const d = rb.depthTexture; if (d && g.depthTexture !== d) { g.depthTexture = d; g.gtaoMaterial.uniforms.tDepth.value = d; g.pdMaterial.uniforms.tDepth.value = d; } return rd(r2, wb, rb, dt2, mk); };
        const k = +Q.get('aores') || (Q.has('capture') || Q.has('shot') ? 1 : 0.5), ss = g.setSize.bind(g); g.setSize = (w2, h2) => ss(Math.max(8, Math.round(w2 * k)), Math.max(8, Math.round(h2 * k))); g.setSize(size.x, size.y); }
      g.updateGtaoMaterial({ radius: LIGHT.aoR, distanceExponent: 2.0, thickness: LIGHT.aoT, scale: LIGHT.aoS, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.5, rings: 2, samples: 12 });
      comp.addPass(g); this.gtao = g;
    }
    if (this.q.bloom) { const b = new UnrealBloomPass(size.clone().multiplyScalar(0.5), LIGHT.bloomS, 1.0, LIGHT.bloomT); comp.addPass(b); this.bloom = b; }
    // the "camera": a small-sensor phone/compact. Lens first (slight barrel, softness that grows to the corners, colour fringe, vignette),
    // then the sensor (shot noise in linear light, part colour, part blotchy as denoised phone noise is), then the camera's own picture
    // processing (exposure, a curve that runs straight and clips highlights the way a JPEG does, saturation, contrast, sharpening halo).
    const film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uExposure: { value: 0.80 }, tExp: { value: null }, uExpTex: { value: 0 }, uTime: { value: 0 }, uRes: { value: size.clone() },
        uGrain: { value: 0.11 }, uVig: { value: 0.12 }, uSoft: { value: 0.3 }, uSharp: { value: 0.32 }, uDist: { value: 0.014 }, uCA: { value: 0.0008 },
        uSat: { value: 1.27 }, uCon: { value: LIGHT.con } /* light L11: was .40; shade goes properly dark */, uKnee: { value: LIGHT.knee }, uBlack: { value: 0.008 }, uShoulder: { value: LIGHT.sho }, uWB: { value: new THREE.Vector3(LIGHT.wbR, 1.0, LIGHT.wbB) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tExp; uniform float uExpTex; uniform float uExposure, uTime, uGrain, uVig, uSoft, uSharp, uDist, uCA, uSat, uCon, uKnee, uBlack, uShoulder; uniform vec3 uWB; uniform vec2 uRes; varying vec2 vUv;
        float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 h3(vec2 p){ return vec3(h(p), h(p + 17.13), h(p + 41.71)); }
        // one lens read: centre plus a small ring (the blur spot), and a wider ring for the camera's sharpening
        vec3 lens(vec2 uv, float spot, out vec3 wide){
          vec2 px = 1.0 / uRes; vec3 c0 = texture2D(tDiffuse, uv).rgb;
          vec3 n = texture2D(tDiffuse, uv + vec2( spot,  spot * 0.4) * px).rgb + texture2D(tDiffuse, uv + vec2(-spot * 0.4,  spot) * px).rgb
                 + texture2D(tDiffuse, uv + vec2(-spot, -spot * 0.4) * px).rgb + texture2D(tDiffuse, uv + vec2( spot * 0.4, -spot) * px).rgb;
          wide = (texture2D(tDiffuse, uv + vec2(2.2, 0.9) * px).rgb + texture2D(tDiffuse, uv + vec2(-0.9, 2.2) * px).rgb
                + texture2D(tDiffuse, uv + vec2(-2.2, -0.9) * px).rgb + texture2D(tDiffuse, uv + vec2(0.9, -2.2) * px).rgb) * 0.25;
          return c0 * 0.36 + n * 0.16;
        }
        vec3 curve(vec3 x){ vec3 t = max(x - uKnee, 0.0) / (1.0 - uKnee); vec3 hi = uKnee + (1.0 - uKnee) * mix(1.0 - exp(-t), t / (1.0 + t), uShoulder); return mix(x, hi, step(uKnee, x)); }   // light L4: half of the shoulder is the slower t/(1+t), so pale paving and sunlit leaves keep tone instead of clipping
        void main(){
          vec2 d = vUv - 0.5; vec2 da = d * vec2(uRes.x / uRes.y, 1.0); float rc = 0.25 * (uRes.x * uRes.x) / (uRes.y * uRes.y) + 0.25; float r2 = dot(da, da) / rc;   // 0 centre, 1 corner
          vec2 uv = 0.5 + d * (1.0 + uDist * (r2 - 1.0));
          float spot = uSoft * (1.0 + 1.3 * r2);
          vec3 wr, wg, wb;
          vec3 cg = lens(uv, spot, wg);
          vec3 cr = lens(0.5 + (uv - 0.5) * (1.0 + uCA * r2), spot, wr), cb = lens(0.5 + (uv - 0.5) * (1.0 - uCA * r2), spot, wb);
          vec3 col = vec3(cr.r, cg.g, cb.b), wide = vec3(wr.r, wg.g, wb.b);
          float ex = uExpTex > 0.5 ? texture2D(tExp, vec2(0.5)).r : uExposure; col *= uWB * ex * (1.0 - uVig * r2 * r2 * 0.6 - uVig * r2 * 0.4); wide *= uWB * ex;
          // sensor noise: grows with the square root of the light; a fine layer and a blotchier one, luminance and colour
          vec2 fc = gl_FragCoord.xy; float tt = fract(uTime) * 311.0;
          vec3 n1 = h3(fc + tt) + h3(fc * 1.37 + tt + 5.0) - 1.0, n2 = h3(floor(fc / 2.0) + tt + 91.0) + h3(floor(fc / 2.0 + 0.5) * 1.91 + tt) - 1.0;
          vec3 nz = mix(vec3(dot(n1, vec3(0.333))), n1, 0.55) + 0.22 * mix(vec3(dot(n2, vec3(0.333))), n2, 0.7);
          col = max(col - uBlack, 0.0);
          // sharpening as the camera does it: on the luminance, against the wide ring (leaves a faint halo at hard edges)
          float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722)), lw = dot(wide, vec3(0.2126, 0.7152, 0.0722));
          col *= clamp(1.0 + uSharp * (l0 - lw) / max(l0, 0.02), 0.6, 1.6);
          // light L4: the grain goes on after the sharpening, so sharpening does not coarsen it
          col += nz * uGrain * sqrt(max(col, 0.0) + 0.004) / (1.0 + 2.5 * max(col, 0.0));
          col = curve(col);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat);
          col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
          col = mix(col, col * col * (3.0 - 2.0 * col), uCon);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    comp.addPass(film); this.film = film;
    for (const [k, v] of Q) if (k[0] === 'F' && film.uniforms['u' + k.slice(1)] && typeof film.uniforms['u' + k.slice(1)].value === 'number') film.uniforms['u' + k.slice(1)].value = +v;     // camera numbers from the URL for tests: ?FSharp=0.3&FCon=0.45&FSat=1.25
    // lead: live play's cheaper edge smoothing. 4x multisampling of the half-float scene target costs the M2 Pro about 10 fps with this much
    // leaf and railing geometry; setLiveAA(false) drops it and smooths the finished picture with FXAA instead (game.js switches when the frame rate sags).
    const fx = new ShaderPass(FXAAShader); fx.enabled = false; comp.addPass(fx); this.fxaa = fx;
    if (Q.get('aa') === 'fxaa' || this.aoDepth) this.setLiveAA(false);
    this.meterRT = new THREE.WebGLRenderTarget(32, 18, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.meterMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 v; void main(){ vec3 a = vec3(0.0); for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) a += texture2D(t, v + (vec2(float(i), float(j)) - 1.5) / vec2(128.0, 72.0)).rgb; a /= 16.0; float l = dot(a, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(log(clamp(l, 1e-3, 1.6)), log(clamp(l, 1e-3, 8.0)), 0.0, 1.0); }' });
    this.meterScene = new THREE.Scene(); this.meterScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.meterMat)); this.meterCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.meterBuf = new Float32Array(32 * 18 * 4); this.exposure = 0.8; this.meterN = 0;
    // audit item 5: live play keeps the exposure on the GPU. The 32x18 log-luminance picture is weighed (centre and street count more, as in meter()
    // below), turned into the wanted exposure and eased, all in a 1x1 target the film pass samples. No pixels come back to the page, so no stall.
    this.expRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }));
    this.expMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, prev: { value: null }, uFirst: { value: 1 }, uKey: { value: LIGHT.key }, uMin: { value: LIGHT.expMin }, uMax: { value: LIGHT.expMax }, uEase: { value: 0.12 }, uHi: { value: LIGHT.hi }, uPk: { value: LIGHT.pk }, uPkMin: { value: LIGHT.pkMin }, uPkLo: { value: LIGHT.pkLo } }, depthTest: false, depthWrite: false,
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; uniform sampler2D prev; uniform float uFirst, uKey, uMin, uMax, uEase, uHi, uPk, uPkMin, uPkLo; void main(){ float s = 0.0, w = 0.0, h = 0.0, ps = 0.0, pw = 0.0; for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) { float k = (1.0 - 0.4 * length(vec2((float(x) - 15.5) / 16.0, (float(y) - 7.5) / 9.0))) * (y < 10 ? 1.0 : 0.35); vec2 LL = texelFetch(t, ivec2(x, y), 0).rg; float L = LL.r; s += L * k; h += exp(4.0 * L) * k; w += k; if (y < 10) { ps += exp(8.0 * LL.g) * k; pw += k; } } float want = uKey / exp(s / w); float hi = pow(h / w, 0.25) * want; want = clamp(want * clamp(pow(uHi / max(hi, 1e-4), 0.7), 0.88, 1.24), uMin, uMax); if (uPk > 0.0) { float pk = pow(ps / pw, 0.125), fr = 0.0; for (int y = 0; y < 10; y++) for (int x = 0; x < 32; x++) { float k = 1.0 - 0.4 * length(vec2((float(x) - 15.5) / 16.0, (float(y) - 7.5) / 9.0)); fr += step(uPk, exp(texelFetch(t, ivec2(x, y), 0).g) * want) * k; } want = max(min(want, uPk / max(pk, 1e-4)), want * mix(uPkMin, uPkLo, smoothstep(0.10, 0.20, fr / pw))); }   /* light L5: the bright part of the frame (4th-power mean) is steered toward uHi, so a frame full of sunlit paving closes down and a frame with no brights opens up */ float p = texelFetch(prev, ivec2(0), 0).r; gl_FragColor = vec4(uFirst > 0.5 ? want : p + (want - p) * uEase, 0.0, 0.0, 1.0); }' });
    this.expScene = new THREE.Scene(); this.expScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.expMat)); this.expI = 0; this.expGPU = !Q.has('capture') && !Q.has('shot') && Q.get('meter') !== 'cpu';
    installCamera(this, Q, LIGHT);     // camera lane: temporal anti-aliasing and the camera grade (src/camera.js); ?cam=0 off
    if (this.cam && this.cam.film) { const u = this.film.uniforms; u.uLtmT.value = 1.5; u.uLtmSky.value = 0.0; this.ltmEx = 1;
      const m = this.film.material, A = 'hk = uLtmH;', B = '(e > 0.0 ? hk : uLtmS)';
      const fix = () => { const s = m.fragmentShader; if (s.includes('uLtmLo')) return true; if (!s.includes(A) || !s.includes(B)) return false; m.fragmentShader = 'uniform float uLtmLo, uLtmHi;\n' + s.replace(A, 'lk = smoothstep(uLtmLo, uLtmHi, ex), hk = uLtmH * lk;').replace(B, '(e > 0.0 ? hk : uLtmS * lk)'); m.needsUpdate = true; return true; };
      if (fix()) { u.uLtmLo = { value: LIGHT.ltmLo }; u.uLtmHi = { value: LIGHT.ltmHi }; this.ltmGPU = Q.get('ltmread') !== '1'; if (this.cam.old) { const o0 = this.cam.old; this.cam.old = (on) => { o0(on); if (!on) fix(); }; } }     /* if the camera lane's shader text ever changes, the two anchors miss and the handoff10 read-back runs as before */
      this.setLtm(); }
  }

  updateStreet() {
    const r = this.renderer, cam = this.streetCam, n = this.streetN++, sm = r.shadowMap, au = sm.autoUpdate;
    if (this.streetFull) { if (n % 6) return; this.shared.tStreet.value = this.streetDummy.texture; cam.position.copy(this.camera.position); sm.autoUpdate = n <= 1; cam.update(r, this.scene); sm.autoUpdate = au; this.shared.tStreet.value = this.streetRT.texture; return; }
    if (n % 120 === 0) {      // (re)tag what the live faces draw: late-loading layers (streets) join on a later pass
      for (const top of this.scene.children) if (top === this.skyMesh || top.userData.streetCube || (Q.get('scars') === '0' ? /^(streets_ground|streets_trees)/ : /^(streets_ground|streets_trees|streets_vehicles|st_furniture)/).test(top.name || '')     /* lead, Nov 10: cars and street furniture are mirrored too, so paint and glass show the car alongside and the signal pole, not an empty street */) top.traverse((o) => o.layers.enable(3));
      for (const c of cam.children) c.layers.set(3);
    }
    if (n < 2) return;          // let the first frames (shadow map, materials) settle
    const ev = this.streetEvery || 3; if (n % ev) return;          // one face every third frame (every 4th or 6th when the game has cut detail to hold frame rate)
    // one face every third frame: a face is a whole (reduced) scene draw, about 4 ms of main thread on the M2 Pro
    const f = (n / ev) % 6; if (f === 0) { cam.position.copy(this.camera.position); cam.updateMatrixWorld(true); if (cam.coordinateSystem !== r.coordinateSystem) { cam.coordinateSystem = r.coordinateSystem; cam.updateCoordinateSystem(); } }
    // Public feedback Nov 11 ("the reflections updates are very distracting"): the six faces used to be redrawn one at a time INTO the cube that
    // glass and paint were reading, so while driving the mirror picture jumped face by face. They are now drawn into a second, unseen cube and the
    // two are swapped when all six are done: every reflection changes at once. (The swap exchanges the two cubes' GPU textures; nothing that
    // holds streetRT.texture needs to know.)
    if (!this.streetBack) { this.streetBack = new THREE.WebGLCubeRenderTarget(this.streetRT.width, { type: this.streetRT.texture.type, generateMipmaps: false, minFilter: THREE.LinearFilter }); this.streetBack.texture.colorSpace = this.streetRT.texture.colorSpace; r.initRenderTarget(this.streetBack); r.initRenderTarget(this.streetRT);     /* both must exist on the GPU or the swap below never happens and the shown cube stays blank */ }
    const old = r.getRenderTarget(), xr = r.xr.enabled; r.xr.enabled = false; this.shared.tStreet.value = this.streetDummy.texture; sm.autoUpdate = false;
    r.setRenderTarget(this.streetBack, f);     /* always the back cube: the swap below exchanges the GPU textures, so 'back' is always the unseen one (alternating targets as well drew into the shown cube and swapped in a blank one: glasskit, Nov 11) */ r.render(this.scene, cam.children[f]);
    r.setRenderTarget(old); r.xr.enabled = xr; sm.autoUpdate = au; this.shared.tStreet.value = this.streetRT.texture;
    if (f === 5) { const pa = r.properties.get(this.streetRT.texture), pb = r.properties.get(this.streetBack.texture); if (pa.__webglTexture && pb.__webglTexture) { const t = pa.__webglTexture; pa.__webglTexture = pb.__webglTexture; pb.__webglTexture = t; this.streetSwaps = (this.streetSwaps || 0) + 1; r.resetState(); } }
  }

  setLiveAA(msaa) {
    const n = msaa ? this.q.msaa : 0, c = this.composer;
    for (const rt of [c.renderTarget1, c.renderTarget2]) if (rt.samples !== n) { rt.samples = n; rt.dispose(); }
    this.fxaa.enabled = !msaa; this.liveAA = msaa ? 'msaa' : 'fxaa';
  }

  resize(w, h, pr) {
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); this.film.uniforms.uRes.value.set(w * pr, h * pr); if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); }
  }

  render(t, focus) {
    this.shared.uTime.value = t; this.film.uniforms.uTime.value = t + (this.grainOff || 0);   /* light L25: grainOff moves the grain alone while the street is frozen */
    // lead, Nov 10 (Matt: "lots of z fighting"): the near plane rides out with the camera's height. Depth steps grow with distance squared over the
    // near distance: at 0.25 m near, surfaces 1.5 km away had to be half a metre apart to sort cleanly, so from the air facade trim, glass, road
    // paint and the far city flickered. At street level it stays 0.25 m (hands, car interior); 100 m up it is 3 m: twelve times finer steps.
    // Stacked flat layers (road, paint, decals, sidewalk, plaza, shadow blobs) are told apart only by polygonOffset, and the lanes set them 1 to 2
    // depth steps apart: less than the rounding of the depth sums themselves, so they flickered wherever the view was steep (from the air). Every
    // offset in the scene is widened here, once per material (re-walked every 2 s for parts that load late); ?zk=1 is the old state.
    if (this.zN++ % 120 === 0 && this.zK !== 1) this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { if (!m.polygonOffset && !m.userData.zk && /^st_(sh_|lampSh)/.test(o.name)) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -3; m.needsUpdate = true; }     /* painted shadow planes under street furniture had no offset at all */
      if (m.polygonOffset && !m.userData.zk) { m.userData.zk = 1; m.polygonOffsetUnits *= this.zK; } } });
    { const cam = this.camera, n = this.fixedNear || Math.min(6, Math.max(0.25, (cam.position.y - 4) * 0.03)); if (Math.abs(cam.near - n) > 0.01 * n) { cam.near = n; cam.updateProjectionMatrix(); } }
    { const no = this.nearObject || null; if (no !== this._nearNow) {
        if (this._nearNow) this._nearNow.traverse((o) => { if (o.userData._lm !== undefined) { o.layers.mask = o.userData._lm; delete o.userData._lm; } });
        if (no) { no.traverse((o) => { o.userData._lm = o.layers.mask; o.layers.set(5); }); this.scene.traverse((o) => { if (o.isLight) o.layers.enable(5); }); }
        this._nearNow = no; this.nearPass.enabled = !!no; }
      if (no) { const c = this.nearCam, m = this.camera; c.position.copy(m.position); c.quaternion.copy(m.quaternion); c.fov = m.fov; c.aspect = m.aspect; c.near = 0.1; c.far = 40; c.updateProjectionMatrix(); c.updateMatrixWorld(); } }
    // audit item 6: three redraws the sun shadow map on every renderer.render() call (the scene pass, and again for the AO pass); once a frame is enough
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    if (this.tiles) this.tiles.update(this.camera);
    this.updateShadow(focus || this.camera.position);
    if (!this.streetOff) this.updateStreet();
    this.composer.render();
    // every few frames: log-average luminance of the scene-referred frame (centre-weighted), ease the exposure toward a mid-grey key
    if (this.meterN++ % 6 === 0) {
      const r = this.renderer, old = r.getRenderTarget(); this.meterMat.uniforms.t.value = (this.fxaa && this.fxaa.enabled ? this.composer.readBuffer : this.composer.writeBuffer).texture;   /* the scene-referred frame: one more enabled pass swaps the buffers once more */
      r.setRenderTarget(this.meterRT); r.render(this.meterScene, this.meterCam); r.setRenderTarget(old);
      // lead: a plain readPixels stalls the page until the GPU has drawn everything queued (about 9 ms a frame on the M2 Pro); live play reads the
      // meter back through a fence a frame or two later. Capture and stills keep the blocking read so every film frame is exact.
      const meter = () => {
        let s = 0, w = 0, hs = 0, ps = 0, pw = 0; for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) { const k = (1.0 - 0.4 * Math.hypot((x - 15.5) / 16, (y - 7.5) / 9)) * (y < 10 ? 1.0 : 0.35); /* rows count up from the bottom: the street weighs more than the sky */ const L = this.meterBuf[(y * 32 + x) * 4]; s += L * k; hs += Math.exp(4 * L) * k; w += k; if (y < 10) { ps += Math.exp(8 * this.meterBuf[(y * 32 + x) * 4 + 1]) * k; pw += k; } }
        const avg = Math.exp(s / w), w0 = LIGHT.key / avg, hi = Math.pow(hs / w, 0.25) * w0; let want = Math.min(LIGHT.expMax, Math.max(LIGHT.expMin, w0 * Math.min(1.24, Math.max(0.88, Math.pow(LIGHT.hi / Math.max(hi, 1e-4), 0.7))))); if (LIGHT.pk > 0) { let fr = 0; for (let y = 0; y < 10; y++) for (let x = 0; x < 32; x++) if (Math.exp(this.meterBuf[(y * 32 + x) * 4 + 1]) * want >= LIGHT.pk) fr += 1.0 - 0.4 * Math.hypot((x - 15.5) / 16, (y - 7.5) / 9); const e = Math.min(1, Math.max(0, (fr / pw - 0.10) / 0.10)); want = Math.max(Math.min(want, LIGHT.pk / Math.max(Math.pow(ps / pw, 0.125), 1e-4)), want * (LIGHT.pkMin + (LIGHT.pkLo - LIGHT.pkMin) * e * e * (3 - 2 * e))); } const first = !this.meterDone; this.meterDone = true;
        this.lastAvg = avg; this.exposure = first ? want : this.exposure + (want - this.exposure) * 0.12; this.film.uniforms.uExposure.value = this.exposure; if (this.film.uniforms.uLtmH) { this.ltmEx = this.exposure; this.setLtm(); }
      };
      if (this.expGPU) { const dst = this.expRT[this.expI ^= 1], src = this.expRT[this.expI ^ 1], u = this.expMat.uniforms; u.t.value = this.meterRT.texture; u.prev.value = src.texture; u.uKey.value = LIGHT.key; u.uHi.value = LIGHT.hi; u.uMin.value = LIGHT.expMin; u.uMax.value = LIGHT.expMax;
        r.setRenderTarget(dst); r.render(this.expScene, this.meterCam); r.setRenderTarget(old); u.uFirst.value = 0; this.film.uniforms.tExp.value = dst.texture; this.film.uniforms.uExpTex.value = 1;
        if (this.ltmGPU) this.setLtm(); else if (this.film.uniforms.uLtmH && !this.ltmBusy && r.readRenderTargetPixelsAsync) { this.ltmBusy = true; this.ltmBuf ||= new Float32Array(4); r.readRenderTargetPixelsAsync(dst, 0, 0, 1, 1, this.ltmBuf).then(() => { this.ltmEx = this.ltmBuf[0]; this.setLtm(); }).catch(() => {}).finally(() => { this.ltmBusy = false; }); }   /* light L28: one float back through a fence, no stall */
        return; }
      if (this.meterN === 1 || Q.has('capture') || Q.has('shot') || !r.readRenderTargetPixelsAsync) { r.readRenderTargetPixels(this.meterRT, 0, 0, 32, 18, this.meterBuf); meter(); }
      else if (!this.meterBusy) { this.meterBusy = true; r.readRenderTargetPixelsAsync(this.meterRT, 0, 0, 32, 18, this.meterBuf).then(meter).catch(() => {}).finally(() => { this.meterBusy = false; }); }
    }
  }
}
