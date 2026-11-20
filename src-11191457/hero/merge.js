// merge.js (facades lane, Nov 17; light's draw count 17:45 and landmarks' split 18:41: the six hand-built Flatiron buildings are 150 of the ~800 draws at the spawn,
// flatiron_base alone 53): a hero model's meshes whose materials differ ONLY in their flat colour and in the level of their baked light (the models carry one
// material per wall section: "stone@s0" ... "stone@u5" are one stone at twelve light levels) are merged into one mesh and one material. The colour moves into a
// vertex colour, the baked-light level into a vertex attribute (aEm) that scales the material's emissive term; everything else must be equal for two to merge
// (textures, roughness, metalness, sides, alpha, shadow flags, attribute layout), so the picture is the same. Glass (names starting "glass") is left alone: hero.js
// gives it its own mirror. ?heromerge=0 = off. Returns [draws before, draws after].
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const id = (t) => (t ? t.uuid : 0), n3 = (v) => +(+v || 0).toFixed(4);
const TEX = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'envMap', 'lightMap', 'specularIntensityMap', 'specularColorMap', 'clearcoatMap', 'transmissionMap', 'sheenColorMap'];
const NUM = ['roughness', 'metalness', 'opacity', 'alphaTest', 'aoMapIntensity', 'envMapIntensity', 'specularIntensity', 'ior', 'clearcoat', 'transmission', 'sheen', 'reflectivity', 'bumpScale', 'side', 'shadowSide', 'blending'];
export function heroMerge(root) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), groups = new Map(), rel = new THREE.Matrix4(); let before = 0;
  root.traverse((o) => { if (!o.isMesh) return; before++; const m = o.material;
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(m) || !m || !m.isMeshStandardMaterial || /^glass/i.test(m.name || '') || !o.visible || o.morphTargetInfluences || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
    const g = o.geometry, at = Object.keys(g.attributes).filter((k) => k !== 'color').sort().map((k) => { const a = g.attributes[k]; return k + ':' + a.itemSize; }).join(',') + (m.vertexColors && g.attributes.color ? '|c' + g.attributes.color.itemSize : '');     /* r2: packed (interleaved, byte-sized) attributes are unpacked to plain floats below, so only names and sizes must agree: the six Flatiron models are packed and were all skipped in r1 */
    if (g.morphAttributes.position || rel.multiplyMatrices(inv, o.matrixWorld).determinant() < 0) return;
    const em = !!(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity ?? 1) > 0);
    const key = [m.type, TEX.map((k) => id(m[k])).join('.'), NUM.map((k) => n3(m[k])).join('.'), m.normalScale ? n3(m.normalScale.x) + '/' + n3(m.normalScale.y) : '', m.specularColor ? m.specularColor.getHexString() : '', em ? 1 : 0, m.transparent ? 1 : 0, m.depthWrite ? 1 : 0, m.depthTest ? 1 : 0, m.flatShading ? 1 : 0, m.fog ? 1 : 0, m.toneMapped ? 1 : 0, m.vertexColors && g.attributes.color ? 1 : 0, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder, o.layers.mask, o.frustumCulled ? 1 : 0, g.index ? 'ix' : 'no', at].join('|');
    let G = groups.get(key); if (!G) groups.set(key, (G = { em, list: [] })); G.list.push(o); });
  let after = before;
  for (const G of groups.values()) { if (G.list.length < 2) continue; const geos = [];
    for (const o of G.list) { const m = o.material, src = o.geometry, g = new THREE.BufferGeometry(), n = src.attributes.position.count, old = m.vertexColors && src.attributes.color ? src.attributes.color : null, cs = old && old.itemSize === 4 ? 4 : 3, col = new Float32Array(n * cs);
      for (const k of Object.keys(src.attributes)) { if (k === 'color') continue; const a = src.attributes[k], out = new Float32Array(n * a.itemSize); for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c); g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize)); }
      if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1)); g.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
      for (let i = 0; i < n; i++) { col[i * cs] = m.color.r * (old ? old.getX(i) : 1); col[i * cs + 1] = m.color.g * (old ? old.getY(i) : 1); col[i * cs + 2] = m.color.b * (old ? old.getZ(i) : 1); if (cs === 4) col[i * cs + 3] = old.getW(i); }
      g.setAttribute('color', new THREE.BufferAttribute(col, cs));
      if (G.em) { const k = m.emissiveIntensity ?? 1, e = new Float32Array(n * 3); for (let i = 0; i < n; i++) { e[i * 3] = m.emissive.r * k; e[i * 3 + 1] = m.emissive.g * k; e[i * 3 + 2] = m.emissive.b * k; } g.setAttribute('aEm', new THREE.BufferAttribute(e, 3)); }
      geos.push(g); }
    let geo = null; try { geo = mergeGeometries(geos, false); } catch (e) { geo = null; } for (const g of geos) g.dispose(); if (!geo) continue;
    const first = G.list[0], mat = first.material.clone(); mat.name = (first.material.name || 'm').replace(/@.*$/, '') + '+' + G.list.length; mat.color.setRGB(1, 1, 1); mat.vertexColors = true;
    if (G.em) { mat.emissive.setRGB(1, 1, 1); mat.emissiveIntensity = 1;
      mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aEm; varying vec3 vEm;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEm = aEm;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vEm;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vEm;'); };
      mat.customProgramCacheKey = () => 'heroEm'; }
    const me = new THREE.Mesh(geo, mat); me.name = 'heromerge_' + mat.name; me.castShadow = first.castShadow; me.receiveShadow = first.receiveShadow; me.renderOrder = first.renderOrder; me.layers.mask = first.layers.mask; me.frustumCulled = first.frustumCulled; me.matrixAutoUpdate = false; me.updateMatrix(); geo.computeBoundingSphere(); geo.computeBoundingBox();
    root.add(me); me.updateMatrixWorld(true); for (const o of G.list) { if (o.parent) o.parent.remove(o); o.geometry.dispose(); } after -= G.list.length - 1; }
  return [before, after];
}
