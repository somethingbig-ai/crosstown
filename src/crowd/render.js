// crowd/render.js: draws the crowd. No per-person skeleton or mixer on the CPU:
//  - bake(): once at load every clip of every character is sampled from the glTF (the skeleton posed at 15 frames a second, the
//    clips' own rate) into ONE float texture: x = clip frame (each clip a run of columns, plus a copy of its first frame so that the
//    GPU's linear filter interpolates across the loop), y = character block x (bone x 3 rows of a 3x4 skinning matrix). Rigid
//    accessories get rows of their own in each character's block (the carrying bone's matrix x the attach transform).
//  - every character is a handful of instanced draws: full mesh near, a vertex-clustered mesh far, a clustered shadow caster.
//    Per instance (16 floats, one buffer upload per draw group): position, heading, the two clips' frame coordinates and their blend,
//    the character's row block, scale, fall, three tints (top, bottom, hair) packed as sRGB.
//  - the vertex shader reads the bone rows, blends up to four per vertex (two for the far mesh), and places the instance. It is
//    patched into MeshStandardMaterial (sun, sun shadow, sky light, the baked ground light as the street layer's materials read it),
//    into a MeshDepthMaterial (the sun's shadow pass) and into a MeshNormalMaterial (the GTAO normal/depth pass).
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';
import { clusterGeometry, mergeForShadow } from './lod.js';

const FPS = 10, STRIDE = 16, NEAR_R = 20, MID_R = 62, DRAW_R = 235, SHADOW_R = 62, ACC_R = 60, BLOB_R = 95;

const PARS = /* glsl */`
  attribute vec4 aPos; attribute vec4 aAnim; attribute vec4 aXf; attribute vec4 aXg;
  uniform sampler2D tAnim; uniform vec2 uAnimInv;
  #ifdef CROWD_RIGID
    uniform float uBone;
  #else
    attribute vec4 skinIndex; attribute vec4 skinWeight;
  #endif
  #ifdef CROWD_MASK
    attribute vec4 aMask;
  #endif
  uniform vec3 uMask;
  varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO;
  vec3 crowdP; vec3 crowdN;
  void crowdRows(float bone, float u, float wt, inout vec4 r0, inout vec4 r1, inout vec4 r2) {
    float v = (aAnim.w + bone * 3.0 + 0.5) * uAnimInv.y;
    r0 += wt * textureLod(tAnim, vec2(u, v), 0.0); r1 += wt * textureLod(tAnim, vec2(u, v + uAnimInv.y), 0.0); r2 += wt * textureLod(tAnim, vec2(u, v + 2.0 * uAnimInv.y), 0.0);
  }
  void crowdClip(float u, out vec4 r0, out vec4 r1, out vec4 r2) {
    r0 = vec4(0.0); r1 = vec4(0.0); r2 = vec4(0.0);
    #ifdef CROWD_RIGID
      crowdRows(uBone, u, 1.0, r0, r1, r2);
    #elif CROWD_BONES == 1
      crowdRows(skinIndex.x, u, 1.0, r0, r1, r2);
    #elif CROWD_BONES == 2
      float ws = skinWeight.x + skinWeight.y;
      crowdRows(skinIndex.x, u, skinWeight.x / ws, r0, r1, r2); if (skinWeight.y > 0.0) crowdRows(skinIndex.y, u, skinWeight.y / ws, r0, r1, r2);
    #else
      crowdRows(skinIndex.x, u, skinWeight.x, r0, r1, r2); if (skinWeight.y > 0.0) crowdRows(skinIndex.y, u, skinWeight.y, r0, r1, r2);
      if (skinWeight.z > 0.0) crowdRows(skinIndex.z, u, skinWeight.z, r0, r1, r2); if (skinWeight.w > 0.0) crowdRows(skinIndex.w, u, skinWeight.w, r0, r1, r2);
      float ws = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w; r0 /= ws; r1 /= ws; r2 /= ws;
    #endif
  }
  vec3 crowdTint(float f) { float r = floor(f / 65536.0), g = floor((f - r * 65536.0) / 256.0), b = f - r * 65536.0 - g * 256.0; return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
  void crowdCompute() {
    vec4 r0, r1, r2; crowdClip(aAnim.x, r0, r1, r2);
    if (aAnim.z > 0.004) { vec4 s0, s1, s2; crowdClip(aAnim.y, s0, s1, s2); r0 = mix(r0, s0, aAnim.z); r1 = mix(r1, s1, aAnim.z); r2 = mix(r2, s2, aAnim.z); }
    vec4 p = vec4(position, 1.0); vec3 q = vec3(dot(r0, p), dot(r1, p), dot(r2, p)), n = vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
    float fa = -1.5 * aXf.y, cf = cos(fa), sf = sin(fa); q = vec3(cf * q.x - sf * q.y, sf * q.x + cf * q.y, q.z); n = vec3(cf * n.x - sf * n.y, sf * n.x + cf * n.y, n.z);
    float c = cos(aPos.w), s = sin(aPos.w); vCH = q.y;
    crowdP = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) * aXf.x + aPos.xyz; crowdN = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
    vWPos = crowdP;
    #ifdef CROWD_MASK
      vec3 m = aMask.rgb; vCAO = aMask.a;
    #else
      vec3 m = uMask; vCAO = 1.0;
    #endif
    vCTint = mix(vec3(1.0), crowdTint(aXf.z), m.r) * mix(vec3(1.0), crowdTint(aXf.w), m.g) * mix(vec3(1.0), crowdTint(aXg.x), m.b);
  }`;
const BAKE_READ = `bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);`;

// put the crowd's vertex stage into one of three's materials. v: { bones: 4|2, rigid: bone row, mask: bool|[r,g,b], lit: bool }
function patch(mat, U, v) {
  mat.defines = Object.assign({}, mat.defines, { CROWD_BONES: v.bones || 4 }); if (v.rigid !== undefined) mat.defines.CROWD_RIGID = 1; if (v.mask === true) mat.defines.CROWD_MASK = 1;
  const uBone = { value: v.rigid || 0 }, uMask = { value: new THREE.Vector3(...(Array.isArray(v.mask) ? v.mask : [0, 0, 0])) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tAnim: U.tAnim, uAnimInv: U.uAnimInv, uBone, uMask });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + PARS).replace('void main() {', 'void main() {\n crowdCompute();')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = crowdN;').replace('#include <begin_vertex>', 'vec3 transformed = crowdP;');
    if (v.lit) {
      Object.assign(sh.uniforms, { tLight: U.shared.tLight, uHalf: U.shared.uHalf, uSunColor: U.shared.uSunColor, uShadowFar: U.shared.uShadowFar, uShadowCenter: U.shared.uShadowCenter });
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vCTint;')
        // the baked ground light where the figure stands (sky seen from the street, sun beyond the shadow map), then the ground's own
        // share of the sky: the lower body sees pavement, not sky, so the light from above falls off towards the feet
        .replace('#include <aomap_fragment>', (U.shared.tLight && U.shared.tLight.value ? BAKE_READ + BAKE_LIGHT_GLSL : '') + `
          { // the cast's baked occlusion (under the chin, the arms, the hems): all of it on the sky's light, part of it on the sun's
            float ao = ${v.ao ? 'clamp(vCAO, 0.0, 1.0)' : '1.0'};
            #ifdef CROWD_FARLIT
              float cg = 1.0; float amb = 1.3; float sunK = 1.22;     // far figures are a few pixels: keep their colour, no gradient
            #else
              float cg = mix(0.45, 1.0, smoothstep(0.0, 1.25, vCH)); float amb = 0.8; float sunK = 1.15;
            #endif
            // the sun on cloth and skin as strong as on the pavement beside them (their albedo is darker than concrete: a little more
            // than physical keeps the lit side from reading flat), the cast's occlusion mostly on the sky's light
            reflectedLight.indirectDiffuse *= cg * amb * ao; reflectedLight.indirectSpecular *= cg * 0.5 * ao; reflectedLight.directDiffuse *= mix(1.0, ao, 0.2) * sunK; reflectedLight.directSpecular *= ao * 1.5; }`);
    }
  };
  if (v.farLit) mat.defines.CROWD_FARLIT = 1;
  mat.customProgramCacheKey = () => 'crowd5|' + (v.ao ? 'a' : '') + (v.farLit ? 'f' : '') + (v.bones || 4) + '|' + (v.rigid !== undefined ? 'r' : 's') + '|' + (v.mask === true ? 'm' : 'u') + '|' + (v.lit ? 'l' : 'd');
  return mat;
}

// ---------------------------------------------------------------- the animation texture
export function bake(renderer, cast, clipNames) {
  const t0 = performance.now(), chars = cast.chars, accs = cast.accs || [];
  const NB = Math.max(...chars.map((c) => c.skeleton.bones.length)), ROWS = (NB + accs.length) * 3;
  const clips = clipNames.map((n) => { const c = cast.animations.find((a) => a.name.toLowerCase() === n.toLowerCase()); return c ? { name: n, clip: c, F: Math.max(2, Math.round(c.duration * (c.duration < 1.6 ? 2 * FPS : FPS))) } : null; });
  let W = 0; for (const c of clips) if (c) { c.x0 = W; W += c.F + 1; }
  const first = clips.find((c) => c); for (let i = 0; i < clips.length; i++) if (!clips[i]) clips[i] = Object.assign({}, first, { name: clipNames[i], missing: true });
  const H = chars.length * ROWS, data = new Float32Array(W * H * 4), m = new THREE.Matrix4(), sc = new THREE.Matrix4();
  const put = (x, y, e) => { for (let r = 0; r < 3; r++) { const o = ((y + r) * W + x) * 4; data[o] = e[r]; data[o + 1] = e[4 + r]; data[o + 2] = e[8 + r]; data[o + 3] = e[12 + r]; } };
  chars.forEach((ch, ci) => {
    const root = ch.root, sk = ch.skeleton, bones = sk.bones, inv = sk.boneInverses, bind = ch.bind, y0 = ci * ROWS; ch.rowBase = y0;
    if (root.parent) root.parent.remove(root); root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
    const mixer = new THREE.AnimationMixer(root), pre = [ch.name + '_', ch.name + '.'];
    const ab = accs.map((a) => bones.find((b) => b.name === ch.name + '_' + a.bone) || null); sc.makeScale(ch.height / 1.8, ch.height / 1.8, ch.height / 1.8);
    for (const c of clips) {
      if (c.missing) continue;
      let tracks = c.clip.tracks.filter((t) => t.name.startsWith(pre[0]) || t.name.startsWith(pre[1])); if (!tracks.length) continue;
      const act = mixer.clipAction(new THREE.AnimationClip(c.name + '_' + ch.name, c.clip.duration, tracks)); act.play();
      for (let f = 0; f < c.F; f++) {
        mixer.setTime((f / c.F) * c.clip.duration); root.updateMatrixWorld(true);
        for (let b = 0; b < bones.length; b++) { m.multiplyMatrices(bones[b].matrixWorld, inv[b]).multiply(bind); put(c.x0 + f, y0 + b * 3, m.elements); }
        for (let k = 0; k < accs.length; k++) if (ab[k]) { m.multiplyMatrices(ab[k].matrixWorld, sc).multiply(accs[k].local); put(c.x0 + f, y0 + (NB + k) * 3, m.elements); }
      }
      act.stop(); mixer.uncacheAction(act.getClip());
      for (let y = y0; y < y0 + ROWS; y++) { const a = (y * W + c.x0) * 4, b = (y * W + c.x0 + c.F) * 4; for (let k = 0; k < 4; k++) data[b + k] = data[a + k]; }
    }
  });
  // float texture with linear filtering where the GPU has it, else half floats (always filterable)
  // half floats: always filterable, half the memory of floats (about 1 mm and 0.0005 of a turn: plenty for a skinning matrix)
  let h; if (typeof Float16Array !== 'undefined') h = new Uint16Array(new Float16Array(data).buffer); else { h = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) h[i] = THREE.DataUtils.toHalfFloat(data[i]); }
  const tex = new THREE.DataTexture(h, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return { tex, W, H, NB, ROWS, clips, ms: Math.round(performance.now() - t0), missing: clips.filter((c) => c.missing).map((c) => c.name) };
}

class Batch {       // one instance buffer, shared by the draws of one character and band
  constructor(cap) { this.cap = cap; this.arr = new Float32Array(cap * STRIDE); this.ib = new THREE.InstancedInterleavedBuffer(this.arr, STRIDE, 1); this.ib.setUsage(THREE.DynamicDrawUsage); this.n = 0; this.meshes = []; this.dropped = 0; }
  geometry(src, names) {
    const g = new THREE.InstancedBufferGeometry(); g.setIndex(src.index);
    for (const n of names) { const s = n === 'aMask' ? src.attributes.color : src.attributes[n]; if (s) g.setAttribute(n, s); }
    g.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.ib, 4, 0)); g.setAttribute('aAnim', new THREE.InterleavedBufferAttribute(this.ib, 4, 4)); g.setAttribute('aXf', new THREE.InterleavedBufferAttribute(this.ib, 4, 8)); g.setAttribute('aXg', new THREE.InterleavedBufferAttribute(this.ib, 4, 12));
    g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); return g;
  }
  mesh(geo, mat) { const me = new THREE.Mesh(geo, mat); me.frustumCulled = false; me.matrixAutoUpdate = false; me.visible = false; this.meshes.push(me); return me; }
  end() { const n = this.n; for (const me of this.meshes) { me.visible = n > 0; me.geometry.instanceCount = n; } if (n) { this.ib.clearUpdateRanges(); this.ib.addUpdateRange(0, n * STRIDE); this.ib.needsUpdate = true; } }
}

export class CrowdRender {
  constructor(game, sim, cast, opts = {}) {
    const world = game.world, R = world.renderer; this.g = game; this.sim = sim; this.cast = cast;
    const B = (this.baked = bake(R, cast, sim.clipNames));
    const U = (this.U = { tAnim: { value: B.tex }, uAnimInv: { value: new THREE.Vector2(1 / B.W, 1 / B.H) }, shared: world.shared || {} });
    this.group = new THREE.Group(); this.group.name = 'crowd'; this.normalGroup = new THREE.Group(); this.batches = []; this.chars = [];
    const noop = new THREE.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const depthMat = patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U, { bones: 1 });
    const nrm = (v) => { const m = patch(new THREE.MeshNormalMaterial(), U, v); m.blending = THREE.NoBlending; return m; };
    const nrmNear = nrm({ bones: 4 }); nrmNear.side = THREE.DoubleSide;
    const rep = (this.report = { chars: cast.chars.length, clips: B.clips.length - B.missing.length, anim_tex: B.W + 'x' + B.H, anim_mb: +(B.W * B.H * 8 / 1048576).toFixed(1), bake_ms: B.ms, tris_near: 0, tris_mid: 0, tris_far: 0, tris_shadow: 0, parts: 0 });
    if (B.missing.length) rep.clips_missing = B.missing.join(',');
    const capN = opts.capNear || 64, capM = opts.capMid || 160, capF = opts.capFar || 320, capS = opts.capShadow || 128;
    // Past the middle distance a figure is thirty pixels tall: there the cast is drawn with a few stand-in bodies (for each character
    // the one of its sex nearest its height; a child stays a child), each still in its own colours. It keeps the far band and the
    // shadow casters to a handful of draws however large the cast grows.
    const meta = cast.sim.characters, grp = (c) => ((c.height || 1.75) < 1.45 ? 'k' : c.female ? 'f' : 'm'), arche = new Set(), nArch = opts.archetypes || 3;
    for (const g of ['k', 'f', 'm']) { const L = meta.map((c, i) => i).filter((i) => grp(meta[i]) === g).sort((a, b) => meta[a].height - meta[b].height); if (!L.length) continue; const n = Math.min(L.length, g === 'k' ? 1 : nArch); for (let k = 0; k < n; k++) arche.add(L[Math.floor(((k + 0.5) / n) * L.length)]); }
    const farOf = meta.map((c, i) => { let b = -1, bd = 9; for (const j of arche) { if (grp(meta[j]) !== grp(c)) continue; const d = Math.abs(meta[j].height - c.height); if (d < bd) { bd = d; b = j; } } return b < 0 ? [...arche][0] : b; });
    rep.far_bodies = arche.size;
    cast.chars.forEach((ch, ci) => {
      const isA = arche.has(ci), near = new Batch(capN), mid = new Batch(capM), far = isA ? new Batch(capF) : null, shadow = isA ? new Batch(capS) : null, farGeos = [];
      for (const p of ch.parts) {
        const hasMask = !!p.geometry.attributes.color && p.mask === true, names = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].concat(hasMask ? ['aMask'] : []);
        const mk = (bones, far) => { const m = p.material.clone(); m.vertexColors = false; m.transparent = false; m.depthWrite = true; if (p.alphaTest) { m.alphaTest = p.alphaTest; m.side = THREE.DoubleSide; } m.envMapIntensity = p.material.envMapIntensity; if (bones < 4) { m.normalMap = null; }
          return patch(m, U, { bones, mask: hasMask ? true : p.mask || [0, 0, 0], lit: true, ao: hasMask && p.ao, farLit: far }); };
        const gN = near.geometry(p.geometry, names), mN = near.mesh(gN, mk(4)); mN.receiveShadow = true; this.group.add(mN); this.normalGroup.add(near.mesh(gN, nrmNear));
        rep.tris_near += p.geometry.index.count / 3; rep.parts++;
        if (p.far === false) continue;
        const lodM = clusterGeometry(p.geometry, opts.cell || 0.04), gM = mid.geometry(lodM, names), mM = mid.mesh(gM, mk(2)); mM.receiveShadow = true; this.group.add(mM); rep.tris_mid += lodM.userData.tris;
        if (!isA) continue;
        // the far band: coarser still. Only the near band goes into the GTAO normal pass (the contact shadow grounds the rest)
        const lod = clusterGeometry(p.geometry, opts.cellFar || 0.085), gF = far.geometry(lod, names), mF = far.mesh(gF, mk(1, true)); mF.receiveShadow = true; this.group.add(mF);
        rep.tris_far += lod.userData.tris; farGeos.push(lod);
      }
      if (isA) { const sg = mergeForShadow(farGeos), sm = shadow.mesh(shadow.geometry(sg, ['position', 'skinIndex', 'skinWeight']), noop); sm.castShadow = true; sm.customDepthMaterial = depthMat; this.group.add(sm); rep.tris_shadow += sg.userData.tris; this.batches.push(far, shadow); }
      this.chars.push({ near, mid, far, shadow, rowBase: ch.rowBase, farRow: ch.rowBase, farK: 1 }); this.batches.push(near, mid);
    });
    this.chars.forEach((c, i) => { const A = this.chars[farOf[i]]; c.far = A.far; c.shadow = A.shadow; c.farRow = A.rowBase; c.farK = cast.chars[i].height / cast.chars[farOf[i]].height; });
    for (const k of ['tris_near', 'tris_mid']) rep[k] = Math.round(rep[k] / cast.chars.length); for (const k of ['tris_far', 'tris_shadow']) rep[k] = Math.round(rep[k] / arche.size);
    // rigid accessories: one instanced draw per kind, following one bone's rows
    this.accs = (cast.accs || []).map((a, k) => {
      const b = new Batch(opts.capAcc || 160), geo = b.geometry(a.geometry, ['position', 'normal', 'aMask']);
      const m = a.material.clone(); m.vertexColors = false; const me = b.mesh(geo, patch(m, U, { rigid: B.NB + k, mask: !!a.geometry.attributes.color, lit: true })); me.receiveShadow = true; this.group.add(me);
      this.normalGroup.add(b.mesh(geo, nrm({ rigid: B.NB + k }))); this.batches.push(b); return b;
    });
    // a soft contact shadow under every figure, in sun and in shade (the sun shadow map has 7 cm texels and a soft filter: it cannot
    // hold the dark where the feet meet the ground)
    { const cap = opts.capBlob || 700, arr = new Float32Array(cap * 4), ib = new THREE.InstancedInterleavedBuffer(arr, 4, 1); ib.setUsage(THREE.DynamicDrawUsage);
      const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3)); g.setIndex([0, 2, 1, 0, 3, 2]); g.setAttribute('aBlob', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, uniforms: { uK: { value: opts.blob ?? 0.62 } },
        vertexShader: 'attribute vec4 aBlob; varying vec2 vQ; varying float vA; void main(){ vQ = position.xz; vA = aBlob.w; vec3 p = aBlob.xyz + vec3(position.x * 0.6, 0.012, position.z * 0.6); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }',
        fragmentShader: 'uniform float uK; varying vec2 vQ; varying float vA; void main(){ float d = length(vQ); float a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(0.0, 0.0, 0.0, uK * vA * a * a * (0.6 + 0.8 * a)); }' });
      const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.matrixAutoUpdate = false; me.renderOrder = 3; this.group.add(me); this.blob = { arr, ib, g, me, cap, n: 0 }; }
    world.scene.add(this.group);
    this.stats = { drawn: 0, near: 0, mid: 0, far: 0, shadow: 0, acc: 0, dropped: 0 }; this.nearR = opts.nearR || NEAR_R; this.midR = opts.midR || MID_R; this.shadowR = opts.shadowR || SHADOW_R;
  }
  // what the camera sees of the sim, written into the instance buffers
  update() {
    const sim = this.sim, cam = this.g.world.camera, B = this.baked, C = B.clips, iW = 1 / B.W, S = this.stats;
    cam.updateMatrixWorld(); const e = cam.matrixWorld.elements, cx = cam.position.x, cy = -cam.position.z; let fx = -e[8], fy = e[10]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect), cosV = Math.cos(Math.min(3.1, hf + 0.14)), look = Math.abs(e[9]) > 0.6;      // looking steeply up or down: no cone test
    for (const b of this.batches) b.n = 0; S.near = S.far = S.shadow = S.acc = 0; let dropped = 0;
    const nearR = this.nearR, midR = this.midR, shR = this.shadowR, BL = this.blob; BL.n = 0; S.mid = 0;
    for (const a of sim.agents) {
      const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy); if (d > DRAW_R || (d < 0.55 && cam.position.y < 2.4)) continue;
      const seen = look || d < 7 || dx * fx + dy * fy > d * cosV, ch = this.chars[a.char];
      const sh = d < shR && (seen || d < 28); if (!seen && !sh) continue;
      const c = C[a.clip], c2 = C[a.clipB], uA = (c.x0 + 0.5 + a.ph * c.F) * iW, uB = (c2.x0 + 0.5 + a.phB * c2.F) * iW;
      const put = (b, row, k) => { if (b.n >= b.cap) { dropped++; return; } const A = b.arr, o = b.n++ * STRIDE; A[o] = a.x; A[o + 1] = a.z; A[o + 2] = -a.y; A[o + 3] = a.h; A[o + 4] = uA; A[o + 5] = uB; A[o + 6] = a.blend; A[o + 7] = row === undefined ? ch.rowBase : row; A[o + 8] = k === undefined ? a.scale : a.scale * k; A[o + 9] = a.fall; A[o + 10] = a.tint[0]; A[o + 11] = a.tint[1]; A[o + 12] = a.tint[2]; };
      if (sh) { put(ch.shadow, ch.farRow, ch.farK); S.shadow++; }
      if (!seen) continue;
      if (d < nearR) { put(ch.near); S.near++; } else if (d < midR) { put(ch.mid); S.mid++; } else { put(ch.far, ch.farRow, ch.farK); S.far++; }
      if (d < BLOB_R && BL.n < BL.cap && a.state !== 'down') { const o = BL.n++ * 4; BL.arr[o] = a.x; BL.arr[o + 1] = a.seatOf ? a.seatOf.z : a.z; BL.arr[o + 2] = -a.y; BL.arr[o + 3] = d < 60 ? 1 : 1 - (d - 60) / (BLOB_R - 60); }
      if (a.acc && d < ACC_R) for (let k = 0; k < this.accs.length; k++) if (a.acc & (1 << k)) { const b = this.accs[k]; if (b.n < b.cap) { put(b); b.arr[(b.n - 1) * STRIDE + 10] = a.accT[k]; b.arr[(b.n - 1) * STRIDE + 11] = 0xffffff; b.arr[(b.n - 1) * STRIDE + 12] = 0xffffff; S.acc++; } }
    }
    for (const b of this.batches) b.end(); S.drawn = S.near + S.mid + S.far; S.dropped = dropped;
    BL.g.instanceCount = BL.n; BL.me.visible = BL.n > 0; if (BL.n) { BL.ib.clearUpdateRanges(); BL.ib.addUpdateRange(0, BL.n * 4); BL.ib.needsUpdate = true; }
  }
  // the GTAO pass draws the scene with one override material, which knows nothing of this skinning: the crowd is left out of that
  // draw and added to the same normal/depth target with its own normal material
  hookAO(gtao) {
    if (!gtao || gtao._crowd) return; gtao._crowd = true; const ro = gtao.renderOverride.bind(gtao), self = this;
    gtao.renderOverride = function (renderer, mat, rt, cc, ca) {
      const vis = self.group.visible; self.group.visible = false; ro(renderer, mat, rt, cc, ca); self.group.visible = vis; if (!vis || mat !== gtao.normalMaterial) return;
      const ac = renderer.autoClear; renderer.autoClear = false; renderer.setRenderTarget(rt); renderer.render(self.normalGroup, gtao.camera); renderer.autoClear = ac;
    };
  }
}
