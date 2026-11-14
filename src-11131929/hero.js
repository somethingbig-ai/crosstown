// hero.js (facades lane): hand-built hero buildings. assets/hero/hero.json lists them: [{name, glb, footprint: [[x_east, y_north], ...], glassEnv?: 1.0, noReceive?: "regex on material names", off?: true, group?: "name"}].
// Each glb is a whole building in the game's world frame (metres; x east, y up, z = -north; absolute position, ground at y = 0) with ordinary glTF
// materials. The massing building it replaces is cut out of the city tiles (every triangle whose inner side lies in the footprint), so the old
// wall neither shows nor casts a shadow. A material whose name starts with "glass" mirrors the live street cube. ?hero=0 turns all of it off.
//
// facades/cost, Nov 12 (first load on weak machines): the hero files (47 MB packed) no longer stand in the first-load path. At load only hero.json
// is read: the massing triangles inside each footprint are MOVED out of the city tiles into a small stand-in mesh of their own (same material,
// same shadows), so the city looks exactly as it does with ?hero=0 on those lots. Once the page is ready the files come in one building at a
// time, nearest to the player first; when a building is whole on the graphics card its stand-in is taken away and the model put in its place in
// one frame, and its street-floor instances are pruned then. A file that fails or never arrives leaves the stand-in: no hole, nothing else changes.
// Entries without a footprint ride with the footprint entry before them (flatiron_base with flatiron_upper; or name it: "group"); a group
// goes in whole or not at all. Stills, films and test tools (?capture ?shot ?demo ?play ?peds=0 ?crowd=none, window.__noStart, webdriver) keep
// the old order: everything is in before the page says ready. ?herolate=1 forces the late order, ?herolate=0 the old one, ?herolate=hold keeps the stand-ins.
// world.heroState = { late, groups: {name: 'wait'|'loading'|'in'|'failed'}, done, log: [...] }; world.heroDone = a promise.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
async function loadPacked(url) { try { const r = await fetch(url + '.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return await new GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, '')); } catch (e) { return await new GLTFLoader().loadAsync(url); } }
const nearPoly = (x, y, P, r) => { for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j], dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < r) return true; } return false; };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const frame = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function addHero(world, dir) {
  const Q = new URLSearchParams(location.search);
  if (Q.get('hero') === '0') return;
  const list = (await fetch(dir + 'hero.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])).filter((h) => !h.off);
  if (!list.length) return;
  world.heroRoot = new THREE.Group(); world.heroRoot.userData.streetCube = true; world.scene.add(world.heroRoot);
  const tool = !!window.__noStart || !!navigator.webdriver || Q.has('demo') || Q.has('capture') || Q.has('shot') || Q.has('play') || Q.get('crowd') === 'none' || Q.get('peds') === '0';
  const hold = Q.get('herolate') === 'hold', late = hold || Q.get('herolate') === '1' || (Q.get('herolate') !== '0' && !tool);     /* hold: the stand-ins stay and no file is fetched (to look at that state) */
  // groups: a footprint entry and the footprint-less entries that ride with it
  const groups = new Map(); let lastG = null;
  for (const h of list) { const gn = h.group || (h.footprint ? h.name : lastG || h.name); if (h.footprint && !h.group) lastG = h.name;
    let g = groups.get(gn); if (!g) groups.set(gn, (g = { name: gn, members: [], polys: [], stand: [], state: 'wait' })); g.members.push(h); if (h.footprint) g.polys.push(h.footprint); }
  const state = (world.heroState = { late, groups: {}, done: false, log: [], cut: 0, standTris: 0 });
  const note = (g, s) => { g.state = s; state.groups[g.name] = s; state.log.push([+(performance.now() / 1000).toFixed(2), g.name, s]); };
  // 1. the replaced massing: out of the city tiles at once. Cut-only groups (no glb at all) lose it for good, as before; the others keep it as a stand-in.
  const boxes = []; for (const g of groups.values()) { g.cutOnly = g.members.every((h) => !h.glb); if (g.cutOnly) note(g, 'in');
    for (const P of g.polys) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } boxes.push({ g, P, x0: x0 - 1, x1: x1 + 1, y0: y0 - 1, y1: y1 + 1 }); } }
  const R = 3.6;
  for (const mesh of (world.buildingMeshes || []).slice()) {
    const geo = mesh.geometry, pos = geo.attributes.position, ix = geo.index; if (!ix) continue; mesh.updateMatrixWorld(true); const M = mesh.matrixWorld;
    const bs = geo.boundingSphere, c = bs.center.clone().applyMatrix4(M); if (!boxes.some((p) => c.x > p.x0 - bs.radius && c.x < p.x1 + bs.radius && -c.z > p.y0 - bs.radius && -c.z < p.y1 + bs.radius)) continue;
    const k3 = geo.attributes.uv3;     // wall kind = floor(uv3.x / 64): 5 and up are trim, ironwork, AC boxes and tanks, which stand proud of the footprint
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), src = ix.array, out = new src.constructor(src.length); let k = 0; const moved = new Map();
    for (let i = 0; i < src.length; i += 3) {
      a.fromBufferAttribute(pos, src[i]).applyMatrix4(M); b.fromBufferAttribute(pos, src[i + 1]).applyMatrix4(M); d.fromBufferAttribute(pos, src[i + 2]).applyMatrix4(M);
      n.subVectors(b, a).cross(d.clone().sub(a)); n.y = 0; const l = n.length(); if (l > 1e-9) n.multiplyScalar(0.5 / l); else n.set(0, 0, 0);
      const x = (a.x + b.x + d.x) / 3 - n.x, y = -((a.z + b.z + d.z) / 3 - n.z);
      const trim = k3 ? k3.getX(src[i]) >= 320 : false;
      let hit = null; for (const p of boxes) if (x > p.x0 - R && x < p.x1 + R && y > p.y0 - R && y < p.y1 + R && (inPoly(x, y, p.P) || (trim && nearPoly(x, y, p.P, R)))) { hit = p.g; break; }
      if (!hit) { out[k++] = src[i]; out[k++] = src[i + 1]; out[k++] = src[i + 2]; continue; }
      state.cut++; if (hit.cutOnly) continue; let m = moved.get(hit); if (!m) moved.set(hit, (m = [])); m.push(src[i], src[i + 1], src[i + 2]);
    }
    if (k === src.length) continue;
    // the stand-in owns COPIES of the vertices it uses (never the tile's own buffers: it is disposed when its building arrives)
    const plain = Object.values(geo.attributes).every((at) => at.isBufferAttribute && !at.isInterleavedBufferAttribute && at.array && at.array.length >= at.count * at.itemSize);
    for (const [g, tri] of moved) { if (!plain) { g.noStand = true; continue; }
      const map = new Map(), idx = new Uint32Array(tri.length); for (let i = 0; i < tri.length; i++) { let j = map.get(tri[i]); if (j === undefined) map.set(tri[i], (j = map.size)); idx[i] = j; }
      const sg = new THREE.BufferGeometry(); for (const name in geo.attributes) { const at = geo.attributes[name], s = at.itemSize, arr = new at.array.constructor(map.size * s); for (const [from, to] of map) for (let q = 0; q < s; q++) arr[to * s + q] = at.array[from * s + q]; sg.setAttribute(name, new THREE.BufferAttribute(arr, s, at.normalized)); }
      sg.setIndex(new THREE.BufferAttribute(idx, 1)); sg.computeBoundingSphere(); sg.computeBoundingBox();
      const sm = new THREE.Mesh(sg, mesh.material); sm.name = 'bld_standin_' + g.name; sm.castShadow = mesh.castShadow; sm.receiveShadow = mesh.receiveShadow; sm.layers.mask = mesh.layers.mask; sm.renderOrder = mesh.renderOrder; sm.frustumCulled = mesh.frustumCulled;
      sm.matrixAutoUpdate = false; sm.matrix.copy(mesh.matrix); mesh.parent.add(sm); sm.updateMatrixWorld(true); world.buildingMeshes.push(sm); g.stand.push(sm); state.standTris += tri.length / 3; }
    geo.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1));
  }
  // 2. bring one group in: every file loaded and on the graphics card first, then stand-in out and model in within one frame
  const setup = (h, g) => g.scene.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
    if (h.noReceive && [].concat(o.material).some((m) => new RegExp(h.noReceive, 'i').test(m.name))) o.receiveShadow = false;   // e.g. "^(glass|frame)": no shadow-map speckle inside deep reveals
    for (const m of [].concat(o.material)) { m.shadowSide = THREE.DoubleSide;   /* every face casts: a single-skin shell otherwise lets the sun through its sun-facing wall onto the inside of the far one (wunion item) */ if (m.map) m.map.anisotropy = 8; if (/^glass/i.test(m.name)) { m.envMap = world.streetRT ? world.streetRT.texture : null; m.envMapIntensity = h.glassEnv ?? 1.0; world.heroGlass = (world.heroGlass || []).concat(m); } } });
  const warm = async (scene) => {     // late order only: textures to the card a few a frame, programs built off the frame, so the swap frame itself is short
    const r = world.renderer; if (!r) return; const tex = new Set(); scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) for (const k in m) { const t = m[k]; if (t && t.isTexture && !t.isRenderTargetTexture && !t.isCubeTexture) tex.add(t); } });
    for (const t of tex) { try { r.initTexture(t); } catch (e) {} await frame(); }
    try { if (r.compileAsync && world.composer) { const old = r.getRenderTarget(); r.setRenderTarget(world.composer.readBuffer); const p = r.compileAsync(scene, world.camera, world.scene); r.setRenderTarget(old); await Promise.race([p, sleep(20000)]); } } catch (e) {} };
  let glassTimer = 0; const pruned = [];     // footprints whose street-floor instances are to go (heroPrune's loop reads it)
  const bring = async (g) => { note(g, 'loading'); const got = [];
    try { for (const h of g.members) { if (!h.glb) continue; const gl = await loadPacked(dir + h.glb);     /* lead: served gzip-packed like the city, unpacked in the page */
        setup(h, gl); gl.scene.name = 'hero_' + h.name; got.push([h, gl.scene]); if (late) await warm(gl.scene); }
    } catch (e) { console.warn('[game] hero ' + g.name + ' not loaded, the plain building stays: ' + (e && e.message)); note(g, 'failed'); return; }
    if (g.noStand) { /* interleaved tiles: no stand-in could be made, the lot was cut at load */ }
    for (const sm of g.stand) { if (sm.parent) sm.parent.remove(sm); const i = world.buildingMeshes.indexOf(sm); if (i >= 0) world.buildingMeshes.splice(i, 1); sm.geometry.dispose(); } g.stand.length = 0;
    for (const [h, sc] of got) { world.heroRoot.add(sc); h.ok = true; cutBelow(world, h); glassSwap(world, h); }
    for (const P of g.polys) pruned.push(P);
    if (!glassTimer && world.heroGlass && world.streetRT) glassTimer = setInterval(() => { world.streetRT.texture.needsPMREMUpdate = true; }, 400);   // standard glass reads the cube through three's PMREM copy, which is made once unless refreshed
    note(g, 'in'); };
  const todo = [...groups.values()].filter((g) => !g.cutOnly); for (const g of groups.values()) if (g.cutOnly) for (const P of g.polys) pruned.push(P);
  const where = () => { const gm = window.game, p = gm && gm.player; if (p && isFinite(p.x) && isFinite(p.y)) return [p.x, p.y]; const c = world.camera; return c ? [c.position.x, -c.position.z] : [0, 0]; };
  const dist = (g) => { const [x, y] = where(); let best = 1e9; for (const P of g.polys) { let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } best = Math.min(best, Math.hypot(cx / P.length - x, cy / P.length - y)); } return best; };
  const run = async () => {
    if (late) { while (!window.__ready && !window.__error) await sleep(200); await sleep(300); }
    if (hold) return;
    while (todo.length) { if (late) todo.sort((a, b) => dist(a) - dist(b)); await bring(todo.shift()); }
    state.done = true; const ok = list.filter((h) => h.ok && h.glb).map((h) => h.name);
    console.log('[game] hero buildings' + (late ? ' (after ready, nearest first: ' + state.log.filter((l) => l[2] === 'in' && !groups.get(l[1]).cutOnly).map((l) => l[1] + ' ' + l[0] + ' s').join(', ') + ')' : '') + ': ' + ok.join(', ') + '; massing triangles cut: ' + state.cut + ', held as stand-ins: ' + state.standTris);
    // the helicopter's height picture was read at load with the stand-ins in it: read it again now that the real roofs are there (not while flying; ?herobake=0 off)
    if (late && ok.length && Q.get('herobake') !== '0') { const tryBake = () => { const gm = window.game, hl = gm && gm.heli, H = hl && hl.heights; if (!H || !H.bake || !H.hf) return true; if (hl.piloted) return false; try { const t0 = performance.now(); H.bake(); console.log('[game] hero: height picture read again in ' + Math.round(performance.now() - t0) + ' ms'); } catch (e) {} return true; };
      if (!tryBake()) { const iv = setInterval(() => { if (tryBake()) clearInterval(iv); }, 5000); } }
  };
  heroPrune(world, pruned, state);
  world.heroDone = run().catch((e) => { state.done = true; console.warn('[game] hero loading stopped: ' + (e && e.message)); });
  if (!late) await world.heroDone;
}

// (from the bwaywest item) per hero entry: "cutBelow": y drops its triangles wholly under y; "glassMirror": k swaps its glass* materials for ones that read the
// street cube directly (sharp); and the rule-made street floor ('storefronts') and 'dressing' instances are taken off every hero footprint.
// a hero entry with "cutBelow": y loses every triangle that lies wholly under y (the flatiron item's whole model stands over this item's base until it is cut there)
function cutBelow(world, h) { const g = h.cutBelow && world.heroRoot && world.heroRoot.getObjectByName('hero_' + h.name); if (!g) return; g.updateMatrixWorld(true); let cut = 0; const v = new THREE.Vector3();
  g.traverse((o) => { if (!o.isMesh || !o.geometry.index) return; const pos = o.geometry.attributes.position, ix = o.geometry.index.array, out = new ix.constructor(ix.length); let k = 0;
    const Y = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y;
    for (let i = 0; i < ix.length; i += 3) { if (Math.max(Y(ix[i]), Y(ix[i + 1]), Y(ix[i + 2])) < h.cutBelow + 0.03) { cut++; continue; } out[k++] = ix[i]; out[k++] = ix[i + 1]; out[k++] = ix[i + 2]; }
    o.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1)); });
  console.log('[game] hero ' + h.name + ': ' + cut + ' triangles under ' + h.cutBelow + ' m removed'); }
// a hero entry with "glassMirror": k gets its glass* materials swapped for ones that read the street cube directly (sharp at the cube's own
// resolution; the standard material only sees three's blurred PMREM copy, which a flat shop window shows as a smear)
function glassSwap(world, h) { const g = h.glassMirror && world.streetRT && world.heroRoot && world.heroRoot.getObjectByName('hero_' + h.name); if (!g) return;
  const swap = new Map(); g.traverse((o) => { if (!o.isMesh || Array.isArray(o.material) || !/^glass/i.test(o.material.name)) return; const a = o.material; let b = swap.get(a);
    if (!b) { b = new THREE.MeshPhongMaterial({ name: a.name, color: a.color, map: a.map, emissive: a.emissive, emissiveMap: a.emissiveMap, envMap: world.streetRT.texture, combine: THREE.AddOperation, reflectivity: h.glassMirror, shininess: 300, specular: 0x333333, vertexColors: a.vertexColors }); if (/^glasst/i.test(a.name)) { b.map = null; b.color.set(0x000000); b.reflectivity = h.glassMirror * (/^glasstb/i.test(a.name) ? 1.0 : 0.4); b.specular.set(0x000000); b.shininess = 1; b.transparent = true; b.blending = THREE.AdditiveBlending; b.depthWrite = false; b.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_fragment>', THREE.ShaderChunk.envmap_fragment.replace('outgoingLight += envColor.xyz * specularStrength * reflectivity;', 'float glFr = 0.6 + 3.0 * pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); outgoingLight += envColor.xyz * reflectivity * glFr;')); }; b.customProgramCacheKey = () => 'glasst'; } swap.set(a, b); }
    o.material = b; }); }
// street-floor instances come off a footprint when its building is in (polys grows as buildings arrive; each instanced mesh remembers how many it has had)
function heroPrune(world, polys, state) {
  const R = 2.2, m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const hit = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < R) return true; } return c; };
  let ticks = 0, total = 0, doneAt = 0; const id = setInterval(() => {
    for (const name of ['storefronts', 'dressing']) { const g = world.scene.getObjectByName(name); if (!g) continue;
      g.traverse((o) => { if (!o.isInstancedMesh) return; const from = o.userData.heroPruned === true ? polys.length : o.userData.heroPruned || 0; if (from >= polys.length) return; o.userData.heroPruned = polys.length; const mine = polys.slice(from); let k = 0;
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y < 30 && mine.some((P) => hit(p.x, -p.z, P))) { o.setMatrixAt(i, zero); k++; } }
        if (k) { o.instanceMatrix.needsUpdate = true; total += k; } }); }
    ticks++; if (state.done && !doneAt) doneAt = ticks;
    if (ticks > 300 && doneAt && ticks > doneAt + 30) { clearInterval(id); console.log('[game] hero prune: ' + total + ' street-floor instances removed'); }
  }, 1000);
}
