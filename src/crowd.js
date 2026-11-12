// crowd.js: the crowd layer (people/crowd): several hundred people on the sidewalks and crossings, instanced and skinned on the GPU
// from baked mocap. One call at the end of Game.init(), after the street layer:
//     this.crowd = await (await import('./crowd.js')).addCrowd(this);
// New files only (crowd.js, crowd/nav.js, crowd/sim.js, crowd/render.js, crowd/lod.js, assets/crowd/). If anything here throws, it is
// logged and the game runs without the crowd.
//   ?crowd=none   off          ?crowd=N   target count (people alive around the camera at a busy corner; default below)
//   ?crowdnear=M  nobody of the crowd within M metres in front of a camera that stands still (default 6.5; 0 = no such zone)
//   ?crowdcast=people   use the game's own people.glb bodies instead of assets/crowd/crowd.glb (also the fallback when that file is missing)
// It wraps (each from here, nothing of the game's is edited): game.step (the sim runs after it), world.render (instance buffers are
// filled before it), traffic.gapAhead (cars brake for crowd members on the roadway), world.gtao.renderOverride (the crowd is drawn
// into the GTAO normal/depth target with its own material). The game's own 44 pedestrians are left as they are.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildNav } from './crowd/nav.js';
import { CrowdSim } from './crowd/sim.js';

export const DEFAULT_COUNT = 900;
const A = 'assets/crowd/';

async function loadGLB(url) {      // gzip-packed beside the plain file, as the city is served
  try { const r = await fetch(url + '.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return await new GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, '')); }
  catch (e) { return await new GLTFLoader().loadAsync(url); }
}
const skinnedOf = (root) => { const out = []; root.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); return out; };

// the crowd cast: assets/crowd/crowd.glb + crowd.json (contract in people/crowd/BRIEF.md)
async function loadCast() {
  const meta = await (await fetch(A + 'crowd.json', { cache: 'no-store' })).json(), gltf = await loadGLB(A + 'crowd.glb'); gltf.scene.updateMatrixWorld(true);
  const chars = [], accs = [];
  // accessories hang on the first character's bones in the file: their parent bone and local matrix are the attach transform for everyone
  const accNodes = []; gltf.scene.traverse((o) => { if (/^acc_/.test(o.name) && o.isMesh) accNodes.push(o); });
  for (const name of Object.keys(meta.accessories || {})) { const o = accNodes.find((n) => n.name === 'acc_' + name); if (!o) continue; const bone = (o.parent && o.parent.name.replace(/^c\d+_/, '')) || meta.accessories[name].bone; o.updateMatrix(); accs.push({ name, bone, local: o.matrix.clone(), geometry: o.geometry, material: o.material }); }
  for (const o of accNodes) if (o.parent) o.parent.remove(o);
  for (const c of meta.characters) {
    const root = gltf.scene.getObjectByName(c.name); if (!root) continue; const sm = skinnedOf(root); if (!sm.length) continue;
    chars.push({ name: c.name, root, height: c.height || 1.75, skeleton: sm[0].skeleton, bind: sm[0].bindMatrix.clone(), parts: sm.map((m) => { if (m.material.map) m.material.map.anisotropy = 4; return { geometry: m.geometry, material: m.material, mask: true, ao: true, alphaTest: 0.4 }; }) });
  }
  if (!chars.length) throw new Error('crowd.glb has no characters');
  // the sim is told only of what is in the file: characters that loaded, clips that exist, accessories that have a mesh
  const names = new Set(gltf.animations.map((a) => a.name)), clips = {}; for (const k in meta.clips) if (names.has(k)) clips[k] = meta.clips[k];
  const acc = {}; for (const a of accs) acc[a.name] = meta.accessories[a.name];
  return { kind: 'crowd.glb', chars, accs, animations: gltf.animations, sim: { characters: chars.map((c) => meta.characters.find((m) => m.name === c.name)), clips, accessories: acc, clip_accessory: meta.clip_accessory || {} } };
}
// the stand-in cast: the bodies the game already has (people.glb through the kit: several materials each, no tint masks, 19k triangles)
function kitCast(game) {
  const kit = game.kit, chars = [], PAL = [[1, 1, 1], [0.8, 0.8, 0.84], [0.62, 0.66, 0.78], [0.86, 0.78, 0.68], [0.55, 0.55, 0.56], [0.78, 0.62, 0.6], [0.6, 0.72, 0.62]];
  for (const name of Object.keys(kit.people || {})) {
    const src = kit.people[name], sm = skinnedOf(src); if (!sm.length) continue;
    chars.push({ name, root: src, height: ((kit.tall && kit.tall[name]) || 1) * 1.78, skeleton: sm[0].skeleton, bind: sm[0].bindMatrix.clone(), keepParent: src.parent,
      parts: sm.map((m) => { const mn = m.material.name || ''; return { geometry: m.geometry, material: m.material, mask: /^top_/.test(mn) ? [1, 0, 0] : /^pants_/.test(mn) ? [0, 1, 0] : /^hair_/.test(mn) ? [0, 0, 1] : [0, 0, 0], alphaTest: /^(hair|brows|lashes)_/.test(mn) ? 0.35 : 0, far: !/^(brows|lashes|eyes)_/.test(mn) }; }) });
  }
  if (!chars.length) throw new Error('the kit has no skinned people');
  const clips = {}, sp = kit.clipSpeed || {}; for (const a of kit.peopleAnims || []) { if (/^(drive|getin|getout|turnl|turnr|run)$/i.test(a.name)) continue; clips[a.name] = { duration: a.duration, speed: /^idle/i.test(a.name) ? 0 : sp[a.name.toLowerCase()] || 1.4, loop: true }; }
  return { kind: 'people.glb', chars, accs: [], animations: kit.peopleAnims, sim: { characters: chars.map((c) => ({ name: c.name, height: c.height, top: PAL, bottom: PAL.slice(0, 5), hair: [[1, 1, 1], [0.7, 0.6, 0.5], [0.45, 0.4, 0.38]] })), clips, accessories: {} } };
}

export async function addCrowd(game, opts = {}) {
  const P = game.P, sel = opts.count ?? (P && P.get('crowd')), out = { on: false, report: {} }; game.crowd = out;
  if (sel === 'none' || sel === '0' || sel === 0) { console.log('[crowd] off'); return out; }
  const t0 = performance.now(), world = game.world;
  try {
    const count = Math.max(10, Math.min(3000, +sel || DEFAULT_COUNT));
    let plazas = []; try { const r = await fetch('assets/streets/ground/plazas.json'); if (r.ok) plazas = await r.json(); } catch (e) {}
    // the street layer's furniture that stands on the ground but is not in the game's collision world: the walk goes round it
    const extra = []; try { const K = game.streets && game.streets.parts && game.streets.parts.furniture && game.streets.parts.furniture.kinds;
      const RAD = [[/^ptable$/, 0.5], [/^pchair$/, 0.33], [/^planter\d/, 0.75], [/^urn\d/, 0.5], [/^rack$/, 0.6], [/^bike(B)?$/, 0.8], [/^bikeShare$/, 0.85], [/^dock$/, 0.5], [/^dockKiosk$/, 0.45], [/^benchP$/, 0.9], [/^(pbin|basket|basketFull|newsbox)$/, 0.38], [/^(cone|delin)$/, 0.22], [/^aframe$/, 0.38], [/^block$/, 0.65], [/^cart$/, 1.3], [/^kiosk$/, 1.1], [/^shelter$/, 1.5], [/^cab$/, 0.5], [/^(busstop|meter|spost|psign|psignP|armsign|umbrella|umbrellaC|umbrellaV1|umbrellaV2|sunsh)$/, 0.14]];
      if (K) for (const name in K) { const m = RAD.find((q) => q[0].test(name)); if (!m) continue; for (const it of K[name].list) { if (it[2] > 1) continue; const sc = it[4] && typeof it[4].s === 'number' ? it[4].s : 1, r = m[1] * sc; extra.push({ x: it[0], y: it[1], r });
        if (/^(bike|bikeB|bikeShare|benchP|shelter|cart)$/.test(name)) { const c = Math.cos(it[3]), sn = Math.sin(it[3]), L = /shelter/.test(name) ? 1.4 : 0.55; extra.push({ x: it[0] + c * L, y: it[1] + sn * L, r }, { x: it[0] - c * L, y: it[1] - sn * L, r }); } } } } catch (e) { console.log('[crowd] furniture not read: ' + e.message); }
    // where one can sit: the street layer's plaza chairs (seat 0.45 m up, the chair faces its own +X) and park benches (two places each)
    const seats = []; try { const K = game.streets && game.streets.parts && game.streets.parts.furniture && game.streets.parts.furniture.kinds;
      if (K && K.pchair) for (const it of K.pchair.list) { const o = it[4]; if (o && o.tilt && (Math.abs(o.tilt[0]) > 0.3 || Math.abs(o.tilt[1]) > 0.3)) continue; seats.push({ x: it[0], y: it[1], z: it[2], h: it[3], seat: 0.452 * (o && typeof o.s === 'number' ? o.s : 1) }); }
      if (K && K.benchP) for (const it of K.benchP.list) seats.push({ x: it[0], y: it[1], z: it[2], h: it[3] - Math.PI / 2, seat: 0.465, bench: true });
    } catch (e) {}
    const tN = performance.now(), nav = buildNav(game, plazas, extra); out.report.furniture = extra.length; out.report.seats = seats.length; out.report.nav_ms = Math.round(performance.now() - tN); Object.assign(out.report, { ways: nav.report.ways, km: nav.report.km, crossings: nav.report.crossings });
    let cast = null; const tC = performance.now();
    if (!(P && P.get('crowdcast') === 'people')) { try { cast = await loadCast(); } catch (e) { console.log('[crowd] no crowd cast (' + (e && e.message) + '): using the game\'s people'); } }
    if (!cast) cast = kitCast(game);
    out.report.cast = cast.kind; out.report.cast_ms = Math.round(performance.now() - tC);
    const sim = new CrowdSim(game, nav, { count, cast: cast.sim, seats, keepOut: P && P.has('crowdnear') ? +P.get('crowdnear') : undefined });
    const { CrowdRender } = await import('./crowd/render.js');
    const render = new CrowdRender(game, sim, cast, opts); Object.assign(out.report, render.report);
    for (const c of cast.chars) if (c.keepParent) c.keepParent.add(c.root);      // the kit's own figures go back where they were
    Object.assign(out, { on: true, nav, sim, render, count, group: render.group });
    // --- the hooks
    const step0 = game.step.bind(game); game.step = function (dt) { step0(dt); if (out.on) sim.step(dt); };
    const cam = world.camera, last = { x: 1e9, y: 0, z: 0, fx: 0, fz: 0 }, dir = new THREE.Vector3();
    // run the sim alone for a while with the camera where it is (after a cut, before a still): people reach the kerbs, crossings fill
    out.settle = (secs = 10) => { sim.cx = 1e9; for (let i = 0; i < secs * 60; i++) sim.step(1 / 60); };
    const render0 = world.render.bind(world);
    world.render = function (...a) {
      if (out.on && render.group.visible) {
        cam.getWorldDirection(dir); { const hl = Math.hypot(dir.x, dir.z); if (hl > 1e-4) { dir.x /= hl; dir.z /= hl; } else { dir.x = last.fx; dir.z = last.fz; } }      /* (gameplay/people, Nov 12, public report 075004-16a733: the HEADING is compared, not the 3D direction: looking down steeper than 57 degrees made x*x + z*z < 0.3, so every frame counted as a camera cut and ran settle(10) = 600 crowd steps a frame: 65 -> 2 fps standing over anything) */
        const cut = Math.hypot(cam.position.x - last.x, cam.position.z - last.z) > 25 || dir.x * last.fx + dir.z * last.fz < 0.3;
        if (cut && out.autoSettle !== false) out.settle(last.x > 1e8 ? 8 : 10);      // the camera was put somewhere else: the crowd there is already going about its day
        last.x = cam.position.x; last.z = cam.position.z; last.fx = dir.x; last.fz = dir.z;
        render.update();
      }
      return render0(...a);
    };
    const gap0 = game.traffic.gapAhead.bind(game.traffic), tr = game.traffic;
    tr.gapAhead = function (c, look) {
      let gap = gap0(c, look); const R = sim.road; if (!out.on || !R.length) return gap;
      const fx = Math.cos(c.h), fy = Math.sin(c.h), half = c.def.len / 2;
      for (const q of R) { const dx = q.x - c.x, dy = q.y - c.y, f = dx * fx + dy * fy; if (f < 0.5 || f > look + 0.4 + half) continue; if (Math.abs(-dx * fy + dy * fx) > 1.25 + 0.24) continue; const gp = f - half - 0.4; if (gp < gap) { gap = gp; tr._blk = q; } }
      return gap;
    };
    render.hookAO(world.gtao);
    out.setCount = (n) => sim.setCount(n);
    out.stats = () => Object.assign({}, sim.stats(), render.stats);
    out.report.ms = Math.round(performance.now() - t0); out.report.count = count;
    console.log('[crowd] ' + JSON.stringify(out.report));
  } catch (e) { out.on = false; out.report.failed = String((e && (e.stack || e.message)) || e).slice(0, 600); console.log('[crowd] not loaded: ' + out.report.failed); }
  return out;
}
