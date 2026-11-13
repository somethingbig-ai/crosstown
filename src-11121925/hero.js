// hero.js (facades lane): hand-built hero buildings. assets/hero/hero.json lists them: [{name, glb, footprint: [[x_east, y_north], ...], glassEnv?: 1.0, noReceive?: "regex on material names", off?: true}].
// Each glb is a whole building in the game's world frame (metres; x east, y up, z = -north; absolute position, ground at y = 0) with ordinary glTF
// materials. The massing building it replaces is cut out of the city tiles (every triangle whose inner side lies in the footprint), so the old
// wall neither shows nor casts a shadow. A material whose name starts with "glass" mirrors the live street cube. ?hero=0 turns all of it off.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
async function loadPacked(url) { try { const r = await fetch(url + '.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return await new GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, '')); } catch (e) { return await new GLTFLoader().loadAsync(url); } }
const nearPoly = (x, y, P, r) => { for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j], dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < r) return true; } return false; };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
export async function addHero(world, dir) {
  if (new URLSearchParams(location.search).get('hero') === '0') return;
  const list = (await fetch(dir + 'hero.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])).filter((h) => !h.off);
  if (!list.length) return;
  world.heroRoot = new THREE.Group(); world.heroRoot.userData.streetCube = true; world.scene.add(world.heroRoot);
  for (const h of list) {
    if (!h.glb) { h.ok = true; continue; }     /* a cut-only entry: its footprint's massing and shopfronts go, nothing is put in their place (facades 19:35 Nov 11: the W 24th St skybridge strip) */
    try {
      const g = await loadPacked(dir + h.glb);     /* lead: served gzip-packed like the city, unpacked in the page */
      g.scene.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
        if (h.noReceive && [].concat(o.material).some((m) => new RegExp(h.noReceive, 'i').test(m.name))) o.receiveShadow = false;   // e.g. "^(glass|frame)": no shadow-map speckle inside deep reveals
        for (const m of [].concat(o.material)) { m.shadowSide = THREE.DoubleSide;   /* every face casts: a single-skin shell otherwise lets the sun through its sun-facing wall onto the inside of the far one (wunion item) */ if (m.map) m.map.anisotropy = 8; if (/^glass/i.test(m.name)) { m.envMap = world.streetRT ? world.streetRT.texture : null; m.envMapIntensity = h.glassEnv ?? 1.0; world.heroGlass = (world.heroGlass || []).concat(m); } } });
      g.scene.name = 'hero_' + h.name; world.heroRoot.add(g.scene); h.ok = true;
    } catch (e) { console.warn('[game] hero ' + h.name + ' not loaded: ' + e.message); }
  }
  // cut the replaced massing out of the city tiles
  const polys = list.filter((h) => h.ok && h.footprint).map((h) => { const P = h.footprint; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { P, x0: x0 - 1, x1: x1 + 1, y0: y0 - 1, y1: y1 + 1 }; });
  let cut = 0; const h_reach = 3.6;
  for (const mesh of (world.buildingMeshes || []).concat(world.farRoot ? [] : [])) {
    const geo = mesh.geometry, pos = geo.attributes.position, ix = geo.index; if (!ix) continue; mesh.updateMatrixWorld(true); const M = mesh.matrixWorld;
    const bs = geo.boundingSphere, c = bs.center.clone().applyMatrix4(M); if (!polys.some((p) => c.x > p.x0 - bs.radius && c.x < p.x1 + bs.radius && -c.z > p.y0 - bs.radius && -c.z < p.y1 + bs.radius)) continue;
    const k3 = geo.attributes.uv3;     // wall kind = floor(uv3.x / 64): 5 and up are trim, ironwork, AC boxes and tanks, which stand proud of the footprint
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), src = ix.array, out = new src.constructor(src.length); let k = 0;
    for (let i = 0; i < src.length; i += 3) {
      a.fromBufferAttribute(pos, src[i]).applyMatrix4(M); b.fromBufferAttribute(pos, src[i + 1]).applyMatrix4(M); d.fromBufferAttribute(pos, src[i + 2]).applyMatrix4(M);
      n.subVectors(b, a).cross(d.clone().sub(a)); n.y = 0; const l = n.length(); if (l > 1e-9) n.multiplyScalar(0.5 / l); else n.set(0, 0, 0);
      const x = (a.x + b.x + d.x) / 3 - n.x, y = -((a.z + b.z + d.z) / 3 - n.z);
      const trim = k3 ? k3.getX(src[i]) >= 320 : false; const R = h_reach;
      let kill = false; for (const p of polys) if (x > p.x0 - R && x < p.x1 + R && y > p.y0 - R && y < p.y1 + R && (inPoly(x, y, p.P) || (trim && nearPoly(x, y, p.P, R)))) { kill = true; break; }
      if (kill) cut++; else { out[k++] = src[i]; out[k++] = src[i + 1]; out[k++] = src[i + 2]; }
    }
    geo.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1));
  }
  heroPrune(world, dir);
  if (world.heroGlass && world.streetRT) setInterval(() => { world.streetRT.texture.needsPMREMUpdate = true; }, 400);   // standard glass reads the cube through three's PMREM copy, which is made once unless refreshed
  console.log('[game] hero buildings: ' + list.filter((h) => h.ok).map((h) => h.name).join(', ') + '; massing triangles cut: ' + cut);
}

// (from the bwaywest item) per hero entry: "cutBelow": y drops its triangles wholly under y; "glassMirror": k swaps its glass* materials for ones that read the
// street cube directly (sharp); and the rule-made street floor ('storefronts') and 'dressing' instances are taken off every hero footprint.
async function heroPrune(world, dir) {
  if (new URLSearchParams(location.search).get('hero') === '0') return;
  const list = await fetch(dir + 'hero.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const polys = list.filter((h) => !h.off && h.footprint).map((h) => h.footprint); if (!polys.length) return;
  // a hero entry with "cutBelow": y loses every triangle that lies wholly under y (the flatiron item's whole model stands over this item's base until it is cut there)
  for (const h of list) { const g = h.cutBelow && world.heroRoot && world.heroRoot.getObjectByName('hero_' + h.name); if (!g) continue; g.updateMatrixWorld(true); let cut = 0; const v = new THREE.Vector3();
    g.traverse((o) => { if (!o.isMesh || !o.geometry.index) return; const pos = o.geometry.attributes.position, ix = o.geometry.index.array, out = new ix.constructor(ix.length); let k = 0;
      const Y = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
      for (let i = 0; i < ix.length; i += 3) { if (Math.max(Y(ix[i]), Y(ix[i + 1]), Y(ix[i + 2])) < h.cutBelow + 0.03) { cut++; continue; } out[k++] = ix[i]; out[k++] = ix[i + 1]; out[k++] = ix[i + 2]; }
      o.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1)); });
    console.log('[game] hero ' + h.name + ': ' + cut + ' triangles under ' + h.cutBelow + ' m removed'); }
  // a hero entry with "glassMirror": k gets its glass* materials swapped for ones that read the street cube directly (sharp at the cube's own
  // resolution; the standard material only sees three's blurred PMREM copy, which a flat shop window shows as a smear)
  for (const h of list) { const g = h.glassMirror && world.streetRT && world.heroRoot && world.heroRoot.getObjectByName('hero_' + h.name); if (!g) continue;
    const swap = new Map(); g.traverse((o) => { if (!o.isMesh || Array.isArray(o.material) || !/^glass/i.test(o.material.name)) return; const a = o.material; let b = swap.get(a);
      if (!b) { b = new THREE.MeshPhongMaterial({ name: a.name, color: a.color, map: a.map, emissive: a.emissive, emissiveMap: a.emissiveMap, envMap: world.streetRT.texture, combine: THREE.AddOperation, reflectivity: h.glassMirror, shininess: 300, specular: 0x333333, vertexColors: a.vertexColors }); if (/^glasst/i.test(a.name)) { b.map = null; b.color.set(0x000000); b.reflectivity = h.glassMirror * (/^glasstb/i.test(a.name) ? 1.0 : 0.4); b.specular.set(0x000000); b.shininess = 1; b.transparent = true; b.blending = THREE.AdditiveBlending; b.depthWrite = false; b.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_fragment>', THREE.ShaderChunk.envmap_fragment.replace('outgoingLight += envColor.xyz * specularStrength * reflectivity;', 'float glFr = 0.6 + 3.0 * pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); outgoingLight += envColor.xyz * reflectivity * glFr;')); }; b.customProgramCacheKey = () => 'glasst'; } swap.set(a, b); }
      o.material = b; }); }
  const R = 2.2, m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const hit = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < R) return true; } return c; };
  let ticks = 0, total = 0; const id = setInterval(() => {
    for (const name of ['storefronts', 'dressing']) { const g = world.scene.getObjectByName(name); if (!g) continue;
      g.traverse((o) => { if (!o.isInstancedMesh || o.userData.heroPruned) return; o.userData.heroPruned = true; let k = 0;
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y < 30 && polys.some((P) => hit(p.x, -p.z, P))) { o.setMatrixAt(i, zero); k++; } }
        if (k) { o.instanceMatrix.needsUpdate = true; total += k; } }); }
    if (++ticks > 300) { clearInterval(id); console.log('[game] hero prune: ' + total + ' street-floor instances removed'); }
  }, 1000);
}
