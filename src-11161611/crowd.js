// crowd.js: the crowd layer (people/crowd): several hundred people on the sidewalks and crossings, instanced and skinned on the GPU
// from baked mocap. One call at the end of Game.init(), after the street layer:
//     this.crowd = await (await import('./crowd.js')).addCrowd(this);
// New files only (crowd.js, crowd/nav.js, crowd/sim.js, crowd/render.js, crowd/lod.js, assets/crowd/). If anything here throws, it is
// logged and the game runs without the crowd.
//   ?crowd=none   off          ?crowd=N   target count (people alive around the camera at a busy corner; default below)
//   ?crowdnear=M  nobody of the crowd within M metres in front of a camera that stands still (default 6.5; 0 = no such zone)
//   ?crowdcast=people   use the game's own people.glb bodies instead of assets/crowd/crowd.glb (also the fallback when that file is missing)
// people/crowd-perf, Nov 12 (first load and frame rate; each with its own off switch, ?crowdperf=0 turns all of them off):
//   ?crowdwork=0   the cast is read whole on the page as before (crowd.glb: 9 MB of glTF JSON, 44,550 animation channels, and the bake, all
//                  inside Game.init). On: the page reads crowd-mesh.glb.gz (bodies, one clip) and a worker reads crowd-anim.glb.gz and bakes
//                  the clip texture (crowd/castworker.js); the people fade in when it arrives. Also the fallback: no split files, no worker.
//   ?crowdstep=0   the sim runs once per world step as before (twice a frame at 30 fps, up to four times below that) and every person every
//                  step. On: once a drawn frame. (The far-stepping switch ?crowdfar=1 of Nov 12 is gone since Nov 14: 0.1 ms a frame, and far walkers
//                  moved less evenly; sim.js has only the per-think chances by time, put in by people/crowd-perf/tools/apply-sim.mjs.)
//   ?crowdnav=0    crowd/nav.js asks statics.onSidewalk as before (Nov 14, tools/apply-nav.mjs: the same answers from an index of each block's edges).
//   ?crowdms=N     the crowd's own main-thread budget, ms a frame (OFF unless given, e.g. ?crowdms=1.5; 0 = no budget): over it for a while, the count comes down
//                  (people leave where the camera does not look, as when the game's detail step thins them), and comes back when there is room.
// It wraps (each from here, nothing of the game's is edited): game.step (the sim runs after it), world.render (instance buffers are
// filled before it), traffic.gapAhead (cars brake for crowd members on the roadway), world.gtao.renderOverride (the crowd is drawn
// into the GTAO normal/depth target with its own material). The game's own 44 pedestrians are left as they are.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildNav } from './crowd/nav.js';
import { CrowdSim } from './crowd/sim.js';
import { bakeData } from './crowd/bake.js';

export const DEFAULT_COUNT = 900;
const A = 'assets/crowd/';

async function loadGLB(url) {      // gzip-packed beside the plain file, as the city is served
  { const D = window.__dl; if (D && D.has(url)) try { return await new GLTFLoader().parseAsync(await D.get(url), url.replace(/[^/]*$/, '')); } catch (e) {} }     /* perf lane: the same file from the smaller <file>.dz.bin (src/dl/dl.js; ?dl=0 off) */
  try { const r = await fetch(url + '.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); return await new GLTFLoader().parseAsync(buf, url.replace(/[^/]*$/, '')); }
  catch (e) { return await new GLTFLoader().loadAsync(url); }
}
const skinnedOf = (root) => { const out = []; root.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); return out; };

// the crowd cast: assets/crowd/crowd.glb + crowd.json (contract in people/crowd/BRIEF.md)
function castOf(meta, gltf, clipNames) {
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
  const names = new Set(clipNames || gltf.animations.map((a) => a.name)), clips = {}; for (const k in meta.clips) if (names.has(k)) clips[k] = meta.clips[k];
  const acc = {}; for (const a of accs) acc[a.name] = meta.accessories[a.name];
  return { kind: 'crowd.glb', chars, accs, animations: gltf.animations, sim: { characters: chars.map((c) => meta.characters.find((m) => m.name === c.name)), clips, accessories: acc, clip_accessory: meta.clip_accessory || {} } };
}
// the crowd cast: assets/crowd/crowd.glb + crowd.json (contract in people/crowd/BRIEF.md)
async function loadCast() {
  const meta = await (await fetch(A + 'crowd.json', { cache: 'no-store' })).json(), gltf = await loadGLB(A + 'crowd.glb'); gltf.scene.updateMatrixWorld(true);
  return castOf(meta, gltf);
}
// people/crowd-perf: the same cast from two files. The page takes crowd-mesh.glb.gz (everything but the clips; the standing idle is kept, the
// guns module poses its made-up clips from it at load); crowd/castworker.js takes crowd-anim.glb.gz, bakes the clip texture and sends it
// (cast.pending), then the clips' keys, which become real tracks the first time someone asks for them (a struck or shot person's pose).
const SPARE = 64;      // empty columns kept in the worker's texture for clips added on the page (the guns module's Cower and Duck: 38)
async function loadCastSplit(P, smooth, late) {
  const metaP = fetch(A + 'crowd.json', { cache: 'no-store' }).then((r) => r.json()); metaP.catch(() => {}); const tx = P && P.get('crowdtex'), r = await fetch(A + 'crowd-mesh' + (tx === 'k' || tx === 'h' ? '-' + tx : '') + '.glb.gz');      /* ?crowdtex=k: the 25 body pictures as KTX2 (compressed on the graphics card); h: at 512 px. Off unless asked: not judged yet */
  if (!r.ok || !self.DecompressionStream || typeof Worker === 'undefined' || !import.meta.resolve) throw new Error('no split cast');
  const meta = await metaP, clipNames = Object.keys(meta.clips), t0 = performance.now();
  const w = new Worker(new URL('./crowd/castworker.js', import.meta.url), { type: 'module' }), anims = [], clipOf = (n) => anims.find((a) => a.name === n);
  const tracksIn = (m) => { for (const c of m.clips) { const a = clipOf(c.name); if (!a || a.real) continue; a.duration = c.duration; const F = c.F, D = c.D, n = D.length / 6;
    const build = () => { const out = new Array(n); for (let i = 0; i < n; i++) { const kind = D[i * 6 + 1], nk = D[i * 6 + 2], to = D[i * 6 + 3], vo = D[i * 6 + 4], ve = i + 1 < n ? D[(i + 1) * 6 + 3] : F.length, Ctor = kind === 1 ? THREE.QuaternionKeyframeTrack : kind === 0 ? THREE.VectorKeyframeTrack : THREE.NumberKeyframeTrack; out[i] = new Ctor(m.names[D[i * 6]], F.subarray(to, to + nk), F.subarray(vo, ve), D[i * 6 + 5]); } return out; };
    Object.defineProperty(a, 'tracks', { configurable: true, enumerable: true, get() { const t = build(); Object.defineProperty(a, 'tracks', { value: t, writable: true, configurable: true, enumerable: true }); return t; }, set(v) { Object.defineProperty(a, 'tracks', { value: v, writable: true, configurable: true, enumerable: true }); } }); } };
  const pending = new Promise((res, rej) => { w.onmessage = (ev) => { const m = ev.data; if (m.type === 'bake') { m.at = performance.now(); res(m); } else if (m.type === 'tracks') { try { tracksIn(m); } catch (e) { console.log('[crowd] clip keys not taken: ' + e.message); } w.terminate(); } else if (m.type === 'error') { rej(new Error(m.message)); w.terminate(); } }; w.onerror = (e) => { rej(new Error((e && e.message) || 'the worker did not start')); }; });
  pending.catch(() => {});
  w.postMessage({ cmd: 'bake', url: new URL(A + 'crowd-anim.glb.gz', location.href).href, three: import.meta.resolve('three'), meta: { characters: meta.characters.map((c) => ({ name: c.name, height: c.height })), accessories: meta.accessories, clips: meta.clips }, clipNames, smooth, spare: SPARE, wait: !!late });
  let gltf; try { const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); gltf = await new GLTFLoader().parseAsync(buf, A); } catch (e) { w.terminate(); throw e; }
  gltf.scene.updateMatrixWorld(true);
  const cast = castOf(meta, gltf, clipNames); for (const n of clipNames) { const real = gltf.animations.find((a) => a.name === n); if (real) real.real = true; anims.push(real || new THREE.AnimationClip(n, meta.clips[n].duration, [])); }
  cast.animations = anims; cast.kind = 'crowd-mesh.glb + worker'; cast.pending = pending; cast.spare = SPARE; cast.go = late ? () => w.postMessage({ cmd: 'go' }) : null; cast.t0 = t0;
  // no worker result (an old browser, a blocked worker): the whole file on the page after all, baked here
  cast.whole = async () => { const full = await loadCast(); for (const a of full.animations) { const q = clipOf(a.name); if (q && !q.real) { q.duration = a.duration; q.tracks = a.tracks; } } return bakeData(THREE, { chars: full.chars, accs: full.accs, animations: full.animations, sim: full.sim }, clipNames, smooth, SPARE); };
  return cast;
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
    let cast = null; const tC = performance.now(), perf = (k) => !(P && (P.get(k) === '0' || P.get('crowdperf') === '0'));
    const { CrowdRender, smoothOf } = await import('./crowd/render.js');
    if (!(P && P.get('crowdcast') === 'people') && perf('crowdwork')) { try { cast = await loadCastSplit(P, smoothOf(P), P && P.get('crowdanim') === 'late'); } catch (e) { console.log('[crowd] cast not split (' + (e && e.message) + '): the whole file on the page'); } }
    if (!cast && !(P && P.get('crowdcast') === 'people')) { try { cast = await loadCast(); } catch (e) { console.log('[crowd] no crowd cast (' + (e && e.message) + '): using the game\'s people'); } }
    if (!cast) cast = kitCast(game);
    out.report.cast = cast.kind; out.report.cast_ms = Math.round(performance.now() - tC);
    const sim = new CrowdSim(game, nav, { count, cast: cast.sim, seats, keepOut: P && P.has('crowdnear') ? +P.get('crowdnear') : undefined });
    const render = new CrowdRender(game, sim, cast, opts); Object.assign(out.report, render.report);
    for (const c of cast.chars) if (c.keepParent) c.keepParent.add(c.root);      // the kit's own figures go back where they were
    Object.assign(out, { on: true, nav, sim, render, count, group: render.group });
    // --- the hooks
    // people/crowd-perf: the frame loop takes up to four world steps a frame when the frame rate is low, and the sim ran in each: the slower the
    // machine, the more of its frame the crowd took. Now once a drawn frame, with the time that passed (two halves if that is over 1/20 s).
    const once = perf('crowdstep') && !game.capture, T = (out.cost = { sim: 0, upd: 0, ms: 0, k: 1, n0: count }); let acc = 0; sim.timed = once;
    const step0 = game.step.bind(game); game.step = function (dt) { step0(dt); if (!out.on) return; if (!once) { const t = performance.now(); sim.step(dt); T.sim += performance.now() - t; return; }
      acc += dt; };
    // the one step of a drawn frame is taken just before the frame is drawn, with all the time its world steps covered (taken at the first world step it
    // ran one frame behind on part of that time, and walkers moved less evenly than before: measured, runs/d4-jitter.json)
    const stepOnce = () => { if (!once) return; if (!out.on) { acc = 0; return; } if (acc <= 0) return; const t = performance.now(), d = Math.min(acc, 0.1); acc = 0; if (d > 0.05) { sim.step(d / 2); sim.step(d / 2); } else sim.step(d); T.sim += performance.now() - t; };
    // the crowd's own budget: its main-thread time a frame (sim and instance buffers), averaged over a second. Over it, fewer people; under it, back.
    const budget = !perf('crowdms') ? 0 : P && P.has('crowdms') ? +P.get('crowdms') || 0 : 0;      /* OFF unless asked (?crowdms=1.5): on the weak reading it took 22 % of the people away (284 -> 220) on top of the game's own detail steps, for about 0.3 ms */ let bn = 0, bt = performance.now(), over = 0, under = 0;
    const apply = () => sim.setCount(Math.max(10, Math.round(T.n0 * T.k)));
    const tick = () => { if (++bn < 30) return; const now = performance.now(); if (now - bt < 1000) return; T.ms = (T.sim + T.upd) / bn; T.fps = (bn * 1000) / (now - bt); T.sim = T.upd = 0; bn = 0; bt = now; if (!budget || game.capture || game.paused) return;
      over = T.ms > budget * 1.15 ? over + 1 : 0; under = T.ms < budget * 0.7 ? under + 1 : 0;
      if (over >= 3 && T.k > 0.4) { T.k = Math.max(0.4, T.k * 0.88); over = 0; apply(); } else if (under >= 6 && T.k < 1) { T.k = Math.min(1, T.k * 1.08); under = 0; apply(); } };
    const cam = world.camera, last = { x: 1e9, y: 0, z: 0, fx: 0, fz: 0 }, dir = new THREE.Vector3();
    // run the sim alone for a while with the camera where it is (after a cut, before a still): people reach the kerbs, crossings fill
    out.settle = (secs = 10) => { sim.cx = 1e9; for (let i = 0; i < secs * 60; i++) sim.step(1 / 60); };
    const render0 = world.render.bind(world);
    world.render = function (...a) {
      stepOnce();
      if (out.on && render.group.visible) {
        cam.getWorldDirection(dir); { const hl = Math.hypot(dir.x, dir.z); if (hl > 1e-4) { dir.x /= hl; dir.z /= hl; } else { dir.x = last.fx; dir.z = last.fz; } }      /* (gameplay/people, Nov 12, public report 075004-16a733: the HEADING is compared, not the 3D direction: looking down steeper than 57 degrees made x*x + z*z < 0.3, so every frame counted as a camera cut and ran settle(10) = 600 crowd steps a frame: 65 -> 2 fps standing over anything) */
        const cut = Math.hypot(cam.position.x - last.x, cam.position.z - last.z) > 25 || dir.x * last.fx + dir.z * last.fz < 0.3;
        if (cut && out.autoSettle !== false) out.settle(last.x > 1e8 ? 8 : 10);      // the camera was put somewhere else: the crowd there is already going about its day
        last.x = cam.position.x; last.z = cam.position.z; last.fx = dir.x; last.fz = dir.z;
        const t = performance.now(); render.update(); T.upd += performance.now() - t; tick();
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
    out.setCount = (n) => { T.n0 = n; apply(); };      // the game's detail step sets the size; the budget's share (cost.k) stays on top of it
    // the worker's clip texture: when it comes the people are there (they fade in over most of a second if the game is already being played)
    if (cast.pending) { out.report.anim = 'pending';
      const done = (B, how) => { render.setBaked(B, !!window.__ready && !game.paused && !window.__warming); out.report.anim = how; out.report.anim_s = +(performance.now() / 1000).toFixed(2); out.report.anim_worker = B.T ? { fetch: Math.round(B.T.fetch), parse: Math.round(B.T.parse), bake: Math.round(B.T.bake), total: Math.round(B.T.total) } : undefined; out.report.anim_tex = B.W + 'x' + B.H; out.report.anim_mb = +(B.W * B.H * 8 / 1048576).toFixed(1); console.log('[crowd] clips in: ' + JSON.stringify({ how, at: out.report.anim_s, worker: out.report.anim_worker })); };
      cast.pending.then((B) => done(B, 'worker'), async (e) => { console.log('[crowd] worker failed (' + (e && e.message) + '): baking on the page'); try { done(await cast.whole(), 'page'); } catch (e2) { out.on = false; render.group.visible = false; console.log('[crowd] no clips: ' + (e2 && e2.message)); } });
      if (cast.go) { const iv = setInterval(() => { if (window.__ready) { clearInterval(iv); cast.go(); } }, 100); } }
    out.stats = () => Object.assign({}, sim.stats(), render.stats);
    out.report.ms = Math.round(performance.now() - t0); out.report.count = count;
    console.log('[crowd] ' + JSON.stringify(out.report));
  } catch (e) { out.on = false; out.report.failed = String((e && (e.stack || e.message)) || e).slice(0, 600); console.log('[crowd] not loaded: ' + out.report.failed); }
  return out;
}
