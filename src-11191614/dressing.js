// dressing.js: the street dressing layer (fire escapes, awnings, canopies, sidewalk sheds, cornices and sills, roof boxes, street signs,
// kerb clutter). Prototypes come from assets/dressing/dressing.glb, their placements from dressing.bin / dressing.json; both are
// built by pipeline/dressing (Blender, by rule from city.json). Everything is instanced per map tile so far tiles are culled.
// An instance is 12 floats: x, y, z (map metres), heading, scale along / depth / up, tint r g b (or a sign's atlas cell), sky light, sun.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const A = 'assets/dressing/';
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function loadTex(name) {
  return new Promise((res) => new THREE.TextureLoader().load(A + 'tex/' + name, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; res(t);
  }, undefined, () => res(null)));
}

// The sign faces, drawn once on a canvas from the list the pipeline wrote: street-name blades, one-way arrows, parking plates.
function makeAtlas(spec) {
  const c = document.createElement('canvas'); c.width = spec.w; c.height = spec.h; const g = c.getContext('2d');
  g.fillStyle = '#0c6a45'; g.fillRect(0, 0, c.width, c.height); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const it of spec.items) {
    g.save(); g.translate(it.x, it.y); g.beginPath(); g.rect(0, 0, it.w, it.h); g.clip();
    if (it.t === 'blade') {
      g.fillStyle = '#0c6a45'; g.fillRect(0, 0, it.w, it.h); g.strokeStyle = '#e9efe9'; g.lineWidth = 2.5; g.strokeRect(4, 4, it.w - 8, it.h - 8);
      g.fillStyle = '#f3f6f1'; g.font = 'bold 40px "Helvetica Neue", Helvetica, Arial, sans-serif'; const w = g.measureText(it.s).width;
      g.translate(it.w / 2, it.h / 2 + 2); if (w > it.w - 26) g.scale((it.w - 26) / w, 1); g.fillText(it.s, 0, 0);
    } else if (it.t === 'oneway') {
      g.fillStyle = '#101010'; g.fillRect(0, 0, it.w, it.h); g.strokeStyle = '#e8e8e4'; g.lineWidth = 2; g.strokeRect(3, 3, it.w - 6, it.h - 6);
      g.translate(it.w / 2, it.h / 2); g.save(); g.scale(it.dir, 1); g.fillStyle = '#f2f2ee'; g.beginPath();
      g.moveTo(-82, -15); g.lineTo(44, -15); g.lineTo(44, -25); g.lineTo(86, 0); g.lineTo(44, 25); g.lineTo(44, 15); g.lineTo(-82, 15); g.closePath(); g.fill(); g.restore();
      g.fillStyle = '#101010'; g.font = 'bold 21px "Helvetica Neue", Helvetica, Arial, sans-serif'; g.fillText('ONE WAY', -16 * it.dir, 1);
    } else if (it.t === 'park') {
      const col = it.red ? '#b3261e' : '#1c6b3a';
      g.fillStyle = '#eeeeea'; g.fillRect(0, 0, it.w, it.h); g.strokeStyle = col; g.lineWidth = 5; g.strokeRect(6, 6, it.w - 12, it.h - 12);
      g.fillStyle = col; const n = it.lines.length; const lh = 120 / n;
      it.lines.forEach((t, i) => { g.font = `bold ${Math.min(30, lh * 0.82)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; const w = g.measureText(t).width; g.save(); g.translate(it.w / 2, 30 + lh * (i + 0.5)); if (w > it.w - 28) g.scale((it.w - 28) / w, 1); g.fillText(t, 0, 0); g.restore(); });
      g.fillRect(34, 166, 60, 5); g.beginPath(); g.moveTo(22, 168.5); g.lineTo(38, 159); g.lineTo(38, 178); g.fill(); g.beginPath(); g.moveTo(106, 168.5); g.lineTo(90, 159); g.lineTo(90, 178); g.fill();
    }
    g.restore();
  }
  // weathering: a few faint streaks and a little fade so the faces are not poster-clean
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + (i * 37) % 60},${35 + (i * 53) % 50},${25 + (i * 11) % 40},${0.03 + ((i * 7) % 10) * 0.006})`; g.fillRect((i * 733) % spec.w, (i * 389) % spec.h, 1 + (i % 3), 6 + (i * 13) % 40); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// One material per surface kind. The texture is a detail map (0.5 = the mean) laid out in world metres from the face normal the
// prototype carries in its UV set; the colour comes from the instance tint, or from the vertex colour where that is not white.
// Light beyond the shadow map's reach comes from the per-instance sky / sun samples, the same idea as the buildings' bake.
function makeMaterial(shared, o) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.roughness ?? 0.9, metalness: o.metalness ?? 0, map: o.map || null, normalMap: o.normalMap || null, roughnessMap: o.roughnessMap || null, side: THREE.DoubleSide });
  m.shadowSide = THREE.DoubleSide; if (m.normalMap) m.normalScale.setScalar(o.normalScale ?? 1);
  const sign = !!o.sign, cell = o.cell || [1, 1], scale = o.scale || 1;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, uDCell: { value: new THREE.Vector2(cell[0], cell[1]) }, uDScale: { value: scale } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTint; attribute vec2 aBake; attribute vec4 color; uniform vec2 uDCell; uniform float uDScale;
        varying vec3 vDTint; varying vec2 vDBake; varying vec3 vDW; varying vec3 vDCol;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vDTint = aTint; vDBake = aBake; vDCol = color.rgb;
        vec4 dP = vec4(position, 1.0); vec3 dF = vec3(uv.x, 0.0, uv.y - 1.0); dF.y = sqrt(max(0.0, 1.0 - dF.x * dF.x - dF.z * dF.z));
        #ifdef USE_INSTANCING
          dP = instanceMatrix * dP; dF = mat3(instanceMatrix) * dF;
        #endif
        dP = modelMatrix * dP; dF = normalize(mat3(modelMatrix) * dF); vDW = dP.xyz;
        ${sign ? `vec2 dUV = aTint.xy + uv * uDCell;` : `
        vec3 dU = abs(dF.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), dF)); vec3 dV = normalize(cross(dF, dU));
        vec2 dUV = vec2(dot(dP.xyz, dU), dot(dP.xyz, dV)) * uDScale;`}
        #ifdef USE_MAP
          vMapUv = dUV;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = dUV;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = dUV;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDTint; varying vec2 vDBake; varying vec3 vDW; varying vec3 vDCol;
        uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter;
        float dH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float dN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(dH(i), dH(i+vec2(1,0)), f.x), mix(dH(i+vec2(0,1)), dH(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${sign ? '' : `
        #ifdef USE_MAP
          diffuseColor.rgb *= 2.0;
        #endif
        diffuseColor.rgb *= (vDCol.r + vDCol.g + vDCol.b > 2.9) ? vDTint : vDCol;`}
        // weather: broad patches of dirt and fade, and streaks that run down
        diffuseColor.rgb *= 0.74 + 0.52 * (dN(vec2(vDW.x + vDW.z, vDW.y) * 0.8) * 0.6 + dN(vec2((vDW.x - vDW.z) * 6.0, vDW.y * 0.5)) * 0.4);`)
      .replace('#include <aomap_fragment>', `{
        float bSky = clamp(vDBake.x, 0.0, 1.0);
        float bFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vDW.xz - uShadowCenter.xz));
        float bVis = mix(1.0, vDBake.y, bFar);
        reflectedLight.directDiffuse *= bVis; reflectedLight.directSpecular *= bVis;
        reflectedLight.indirectSpecular *= mix(0.25, 1.0, bSky);
        reflectedLight.indirectDiffuse *= (0.16 + 0.84 * bSky);
      }`);
  };
  m.customProgramCacheKey = () => 'dressing2' + (sign ? 's' : 'w');
  return m;
}

export async function addDressing(game) {
  const out = { group: new THREE.Group(), meshes: [], count: 0, triangles: 0 }; out.group.name = 'dressing';
  if (game.P && game.P.has('nodress')) return out;
  const w = game.world;
  try { return await build(game, w, out); } catch (e) { console.log('[game] dressing not loaded: ' + (e && e.message)); return out; }   // the game runs without the layer
}

async function build(game, w, out) {
  const [J, buf, gltf, tx] = await Promise.all([
    fetch(A + 'dressing.json').then((r) => { if (!r.ok) throw new Error('no dressing.json'); return r.json(); }), fetch(A + 'dressing.bin').then((r) => r.arrayBuffer()), new GLTFLoader().loadAsync(A + 'dressing.glb'),
    Promise.all(['iron_d', 'iron_n', 'iron_r', 'steel_d', 'steel_n', 'wood_d', 'wood_n', 'wood_r', 'stone_d', 'stone_n', 'stone_r', 'fabric_d', 'fabric_n'].map((n) => loadTex(n + '.jpg'))),
  ]);
  const [ironD, ironN, ironR, steelD, steelN, woodD, woodN, woodR, stoneD, stoneN, stoneR, fabD, fabN] = tx;
  const atlas = makeAtlas(J.atlas);
  const defs = {
    iron: { map: ironD, normalMap: ironN, roughnessMap: ironR, roughness: 1, metalness: 0.15, scale: 0.9 },
    steel: { map: steelD, normalMap: steelN, normalScale: 0.35, roughness: 0.55, metalness: 0.35, scale: 0.7 },
    wood: { map: woodD, normalMap: woodN, roughnessMap: woodR, roughness: 1, scale: 0.42 },
    stone: { map: stoneD, normalMap: stoneN, roughnessMap: stoneR, roughness: 1, scale: 0.5 },
    fabric: { map: fabD, normalMap: fabN, normalScale: 0.7, roughness: 0.88, scale: 2.2 },
    bag: { roughness: 0.42 },
  };
  const mats = {}; for (const k in defs) mats[k] = makeMaterial(w.shared, defs[k]);
  // prototypes: top-level nodes named <kind>__<material>
  const protos = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return; let n = o; while (n.parent && n.parent !== gltf.scene) n = n.parent;
    const [kind, mat] = n.name.split('__'); if (!o.geometry.attributes.color) o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3).fill(1), 3));
    (protos[kind] ||= []).push({ geometry: o.geometry, mat, matrix: o.matrixWorld.clone() });
  });
  const F = new Float32Array(buf), S = J.stride;
  for (const kind of Object.keys(J.kinds)) {
    // facades lane: the real-massing buildings carry their own cornices, piers, sills, fire escapes and roof boxes; the OSM-placed ones would float
    if (/^(cornice|coping|fe_|bulkhead|penthouse|pier|sill|bracket)/.test(kind)) continue;
    const K = J.kinds[kind], parts = protos[K.proto || kind]; if (!parts || !K.n) { if (!parts) console.warn('[game] dressing: no prototype for', kind); continue; }
    const far = K.far || 1e9, near = K.near || 0, T = far <= 260 || near ? 95 : 190, tiles = new Map();
    for (let i = 0; i < K.n; i++) { const o = (K.off + i) * S, k = Math.floor(F[o] / T) + ',' + Math.floor(F[o + 1] / T); let a = tiles.get(k); if (!a) tiles.set(k, (a = [])); a.push(o); }
    for (const [key, items] of tiles) {
      const [ti, tj] = key.split(',').map(Number);
      for (const part of parts) {
        let mat = mats[part.mat];
        if (part.mat === 'sign') mat = mats['sign_' + kind] ||= makeMaterial(w.shared, { map: atlas, sign: true, cell: K.cell, roughness: 0.6 });
        if (!mat) { console.warn('[game] dressing: no material', part.mat); continue; }
        const g = new THREE.BufferGeometry(); for (const a in part.geometry.attributes) g.setAttribute(a, part.geometry.attributes[a]); g.setIndex(part.geometry.index);
        const n = items.length, tint = new Float32Array(n * 3), bake = new Float32Array(n * 2);
        const im = new THREE.InstancedMesh(g, mat, n);
        for (let i = 0; i < n; i++) {
          const o = items[i];
          _v.set(F[o], F[o + 2], -F[o + 1]); _q.setFromAxisAngle(_up, F[o + 3]); _s.set(F[o + 4], F[o + 6], F[o + 5]);
          _m.compose(_v, _q, _s); _m2.multiplyMatrices(_m, part.matrix); im.setMatrixAt(i, _m2);
          tint[i * 3] = F[o + 7]; tint[i * 3 + 1] = F[o + 8]; tint[i * 3 + 2] = F[o + 9]; bake[i * 2] = F[o + 10]; bake[i * 2 + 1] = F[o + 11];
        }
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3)); g.setAttribute('aBake', new THREE.InstancedBufferAttribute(bake, 2));
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix();
        im.castShadow = K.shadow !== 0; im.receiveShadow = true; im.name = kind;
        im.userData = { kind, far, near, cx: (ti + 0.5) * T, cz: -(tj + 0.5) * T, r: T * 0.7072, lod: far < 1e9 || near > 0 };
        out.group.add(im); out.meshes.push(im); out.count += n; out.triangles += n * (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    }
  }
  // distance bands: fine detail only near the camera, the stand-ins only beyond it (checked once per frame, before the scene is walked)
  const lod = out.meshes.filter((m) => m.userData.lod);
  const prev = w.scene.onBeforeRender;
  w.scene.onBeforeRender = function (renderer, scene, camera, rt) {
    prev.call(this, renderer, scene, camera, rt);
    if (!camera.isPerspectiveCamera) return;
    const p = camera.position;
    for (const m of lod) { const u = m.userData, d = Math.max(0, Math.hypot(p.x - u.cx, p.z - u.cz) - u.r); m.visible = d < u.far && (u.near === 0 || d >= u.near); }
  };
  w.scene.add(out.group);
  for (const c of J.circles) game.statics.addCircle(c[0], c[1], c[2], 'dressing');
  out.kinds = J.kinds;
  console.log('[game] dressing:', out.count, 'instances,', out.meshes.length, 'batches,', Math.round(out.triangles / 1000), 'k triangles in all');
  return out;
}
