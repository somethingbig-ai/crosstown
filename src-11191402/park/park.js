// park/park.js (park lane, Nov 15): CENTRAL PARK as its own layer. Data: assets/park/ (lanes/park/SCHEMA.md): index.json + 256 m chunks.
//   init(game)   early, before the street layers are built: reads the index, sets game.park (owns(x, y) = inside the park's outline, so the
//                lawn, tree, furniture and crowd layers stand down there) and game.terrain (terrain.js). No index = no park layer, game as before.
//   start(game)  when the game is built: lifts what is drawn onto the relief (terrain.hook) and starts the chunk loader.
// The loader keeps chunks round the camera: FAR form (ground at 8 m, crown shells, water) within FAR_D, NEAR form (ground at 2 m with the
// painted mask, tree wood, lamps and benches, bridges, collision) within NEAR_D. One step at a time, yielding between pieces; everything a chunk
// draws hangs under its own group 'park:<id>', its collision entries carry that name as owner and go with it.
// Switches: ?park=0 the game without any of this; ?parkdata=test a made-up park (testdata.js); ?parknear= / ?parkfar= distances; ?parktrees=0.
import * as THREE from 'three';
import { makeTerrain, hook, CELL, N } from './terrain.js';
import { breathe, disposeGroup } from './mat.js';

export async function init(game) {
  const Q = game.P; if (Q && Q.get('park') === '0') return null;
  if (!(Q && (Q.get('park') === '1' || Q.get('parkdata') === 'test')) && !((game.city && game.city.parks) || []).some((p) => p.name === 'Central Park')) return null;      /* Nov 16: a map without Central Park (DUMBO, the core map) never fetches or hooks any of this; ?park=1 forces it */
  const park = { on: false, chunks: new Map(), features: new Map(), report: { loads: 0, near: 0, drops: 0, maxStepMs: 0 } };
  let src = null;
  if (Q && Q.get('parkdata') === 'test') { const pk = (game.city.parks || []).filter((p) => p.name === 'Central Park').sort((a, b) => b.ext.length - a.ext.length)[0]; if (!pk) return null; game.terrain = makeTerrain(pk.ext); src = (await import('./testdata.js')).make(game); }
  else { const A = (Q && Q.get('parkdir')) || 'assets/park/'; let index = null; try { const r = await fetch(A + 'index.json'); if (r.ok) index = await r.json(); } catch (e) {}
    if (!index || !index.outline || !index.chunks) { console.log('[game] park: no park data (' + A + 'index.json): the park layer is off'); return null; }
    game.terrain = makeTerrain(index.outline);
    const bin = async (f) => { const r = await fetch(A + f); if (!r.ok) throw new Error(f + ' ' + r.status); return r.arrayBuffer(); };
    const needsTreeData = c => c.trees > 0 && Q?.get('parkcol') !== '0' && Q?.get('parktrees') !== '0';
    src = { index, chunk: async (c) => { const F = c.files || {}, [data, hb, tb] = await Promise.all([fetch(A + (F.json || 'c_' + c.id + '.json')).then((r) => r.json()), bin(F.h || 'c_' + c.id + '.h.bin'), bin(F.trees || 'c_' + c.id + '.trees.bin').catch(error => {
      // Let the chunk scheduler retry a populated tree file before marking the chunk loaded.
      if (needsTreeData(c)) throw error;
      return new ArrayBuffer(0);
    })]);
      const recordBytes = (index.test ? 6 : 8) * Float32Array.BYTES_PER_ELEMENT;
      if (needsTreeData(c) && tb.byteLength < c.trees * recordBytes) throw new Error('Incomplete tree file for chunk ' + c.id);
      return { data, cm: new Int16Array(hb.slice(0, N * N * 2)), trees: tb }; } }; }
  if (!src) return null;
  Object.assign(park, { on: true, src, index: src.index, outline: src.index.outline, owns: game.terrain.owns, terrain: game.terrain });
  for (const c of src.index.chunks) park.chunks.set(c.id, { c, id: c.id, i: c.i, j: c.j, state: 0, busy: false });
  game.park = park; console.log('[game] park: ' + src.index.chunks.length + ' chunks' + (src.index.test ? ' (TEST data)' : ''));
  try { (await import('./cityprops.js')).install(game, park); } catch (e) { console.log('[game] park: city props not dropped: ' + (e && e.message)); }      /* handoff-19: the city's bins, hydrants, meters and news boxes do not stand inside the park (?parkfaults=0 = as before) */
  return park;
}

export async function start(game) {
  const park = game.park; if (!park || park.started) return park; park.started = true;
  const Q = game.P, T = game.terrain, world = game.world, st = game.statics, num = (k, d) => (Q && Q.has(k) ? +Q.get(k) : d);
  const NEAR_D = num('parknear', 260), FAR_D = num('parkfar', 1900), treesOn = !(Q && Q.get('parktrees') === '0');
  hook(game);
  // lamp posts (Nov 16): assets/park/lamps.json = every post of the park (the few OpenStreetMap maps + posts placed by rule along the ways it tags lit:
  // lanes/park/tools/mklamps.py). They take the place of the chunk's own OSM lamps and glow at night (night.js). ?parklamps=0 or no file: OSM's lamps only, no glow.
  let LAMPS = null;
  if (Q?.get('parklamps') !== '0' && !park.index.test) try {
    const response = await fetch((Q?.get('parkdir') || 'assets/park/') + 'lamps.json');
    if (response.ok) {
      const { lamps } = await response.json();
      if (Array.isArray(lamps) && lamps.length && lamps.every(row =>
        Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[1]) && Number.isFinite(row[2]))) {
        LAMPS = new Map();
        for (const [x, y] of lamps) {
          const key = Math.floor(x / CELL) + '_' + Math.floor(y / CELL);
          if (!LAMPS.has(key)) LAMPS.set(key, []);
          LAMPS.get(key).push({ kind: 'lamp', x, y });
        }
        park.lamps = lamps;
      }
    }
  } catch (error) { console.log('[game] park: lamps.json not read: ' + error.message); }
  const G = await import('./ground.js'), Tr = await import('./trees.js'), Wa = await import('./water.js'), Br = await import('./bridge.js'), Pr = await import('./props.js'), St = await import('./structs.js'), Sh = await import('./shore.js'), shoreOn = !(Q && Q.get('parkshore') === '0');
  const Lm = await import('./landmarks.js'); const Cu = await import('./cut.js'), cut = Q && Q.get('parkcut') === '0' ? null : Cu.makeCut(game, park); park.cut = cut;      /* ?parkcut=0: the street's flat ground is left whole (hollows hidden under it) */
  const S = { ...(await G.shared(game)), ...(cut ? cut.U : Cu.noCut()) }, root = new THREE.Group(); root.name = 'park'; world.scene.add(root); park.root = root;
  Tr.setSpecies(park.index.species_info); const pool = treesOn ? Tr.nearPool(game, root) : null;
  const fid = (o, k) => String(o.id !== undefined ? o.id : (o.name || k) + ':' + ((o.ring || o.line)[0] || []).join(','));
  const corridors = () => { const a = []; for (const f of park.features.values()) if (f.corridors) a.push(...f.corridors); return a; };
  const pipR = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  // features: things listed whole in every chunk they touch (water, bridges) are built once and counted
  const owned = (name, fn) => { const was = st.owner; st.owner = name; try { return fn(); } finally { st.owner = was; } };      // never across an await: another layer may be building an area meanwhile
  const hold = (C, id, make) => { let f = park.features.get(id); if (!f) { try { f = owned('park:f:' + id, make); } catch (error) { st.removeSet('park:f:' + id); throw error; } f.refs = 0; f.id = id; park.features.set(id, f); if (f.group) root.add(f.group); } f.refs++; C.feat.push(f); return f; };
  const release = (C, keep) => { C.feat = C.feat.filter((f) => { if (keep && keep(f)) return true; if (--f.refs > 0) return false; park.features.delete(f.id); st.removeSet('park:f:' + f.id); if (f.group) { root.remove(f.group); disposeGroup(f.group); } for (const d of f.decks || []) T.removeDeck(d); return false; }); };
  const rewall = () => { const C = corridors(); for (const f of park.features.values()) if (f.area) { st.removeSet('park:f:' + f.id); owned('park:f:' + f.id, () => {
      disposeGroup(Wa.build(game, f.area, C).group);
      for (const [x,y,r] of f.stones || []) st.addParkCircle(x,y,r,'rock');
    }); } };

  const persistentTrunks = Q?.get('parkcol') !== '0';
  const addTrunks = (C, owner) => owned(owner, () => {
    for (const t of C.trees) st.addCircle(t.x, t.y, Math.min(0.5, Math.max(0.16, t.h * 0.022)), 'tree');
  });
  const toFar = async (C) => { const t0 = performance.now(); let d;
    try { d = await park.src.chunk(C.c); }
    catch (error) {
      if (Q?.get('parkcol') !== '0' && (C.fetchFailures = (C.fetchFailures || 0) + 1) >= 3)
        C.retryAfter = performance.now() + 30000;
      throw error;
    }
    C.fetchFailures = 0; C.retryAfter = 0; C.data = d.data; C.cm = d.cm; C.F = G.prepHeights(C.cm, C.i, C.j, C.data, park.outline, cut ? Cu.INSET : 0); T.set(C.i, C.j, C.cm);
    const wet = (C.data.areas || []).filter((a) => (a.kind === 'water' || a.kind === 'ice' || a.kind === 'building') && a.ring && a.ring.length > 2);      // no tree stands in water, on the rink or through a roof
    C.trees = treesOn ? Tr.parse(d.trees, C.data.paths, park.index.test ? 6 : 8).filter((t) => t.x >= C.i * CELL && t.x < C.i * CELL + CELL && t.y >= C.j * CELL && t.y < C.j * CELL + CELL && T.owns(t.x, t.y) && !wet.some((a) => pipR(t.x, t.y, a.ring))) : [];
    { const W = (C.data.structures || []).filter((q) => q.kind === 'wall' && q.line && q.line.length > 1);      /* critic r1, Nov 16: a trunk whose lidar top lay over the wall stood IN the wall (its root flare poked through, still a): moved 1.5 m off the wall line, to its own side */
      if (W.length) for (const t of C.trees) for (const q of W) for (let k = 0; k + 1 < q.line.length; k++) { const p0 = q.line[k], p1 = q.line[k + 1], dx = p1[0] - p0[0], dy = p1[1] - p0[1], L2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((t.x - p0[0]) * dx + (t.y - p0[1]) * dy) / L2)), nx = t.x - p0[0] - dx * u, ny = t.y - p0[1] - dy * u, d = Math.hypot(nx, ny); if (d < 1.5 && d > 0.02) { t.x += nx / d * (1.5 - d); t.y += ny / d * (1.5 - d); t.mv = 1; } }
      /* look pass k2: a moved tree can land against the next wall piece or on a path: such a tree is left out (tools/treewall.py --sim2 counts them) */
      if (W.length) { const dl = (x, y, L) => { let m = 1e9; for (let k = 0; k + 1 < L.length; k++) { const dx = L[k + 1][0] - L[k][0], dy = L[k + 1][1] - L[k][1], u = Math.max(0, Math.min(1, ((x - L[k][0]) * dx + (y - L[k][1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(x - L[k][0] - dx * u, y - L[k][1] - dy * u)); } return m; };
        const PP = (C.data.paths || []).filter((p) => p.pts && p.pts.length > 1 && !p.tunnel);
        C.trees = C.trees.filter((t) => !t.mv || (!W.some((q) => dl(t.x, t.y, q.line) < 1.45) && !PP.some((p) => dl(t.x, t.y, p.pts) < (p.w || 3) / 2 + 0.2))); } }
    if (persistentTrunks && C.trees.length) addTrunks(C, 'park:trunks:' + C.id);
    C.data.__trees = C.trees;      /* the mask painter drifts fallen leaves under them (ground.js) */
    C.feat = [];
    if (Q?.get('parkcol') !== '0') for (const area of C.data.areas || []) {
      if (area.kind !== 'rock' || !(area.ring?.length >= 3)) continue;
      hold(C, 'rock:' + fid(area, area.ring[0].join(',')), () => {
        st.addPoly(area.ring, undefined, 'rock');
        for (const hole of area.holes || []) st.addPoly(hole, undefined, 'rock');
        return { rock: true };
      });
    }
    C.group = new THREE.Group(); C.group.name = 'park:' + C.id; C.farG = G.build(game, S, C.i, C.j, C.cm, C.F, C.data, park.outline, true); C.group.add(C.farG); root.add(C.group); await breathe();
    (C.data.areas || []).forEach((a, k) => { if (a.kind === 'water' && a.ring && a.ring.length > 2) hold(C, 'w' + fid(a, k), () => { const w = Object.assign(Wa.build(game, a, corridors()), { area: a });
      if (shoreOn && !/fountain/i.test(a.name || '') && a.ring.length >= 12) try {      /* a basin has no reeds */ const bp = []; for (const s of C.data.structures || []) if (s.kind === 'bridge' || s.kind === 'arch') for (const d of s.decks || []) for (const p of d.pts || []) bp.push(p); for (const s of C.data.structures || []) if ((s.kind === 'bridge' || s.kind === 'arch') && s.line) for (const p of s.line) bp.push(p);
        const sh = Sh.build(game, S, a, w.level, (x, y) => bp.some((p) => Math.hypot(p[0] - x, p[1] - y) < 7)); w.group.add(sh); w.stones = sh.userData.stones; console.log('[game] park: shore ' + (a.name || '') + ' ' + JSON.stringify(sh.userData.counts)); } catch (e) { console.log('[game] park: shore failed: ' + (e && e.message)); }
      return w; }); });
    if (C.trees.length) { await breathe(); C.crowns = await Tr.crowns(game, C.trees); C.group.add(C.crowns); }
    C.state = 1; if (cut) cut.redraw(); park.report.loads++; park.report.maxStepMs = Math.max(park.report.maxStepMs, Math.round(performance.now() - t0)); };
  const toNear = async (C) => { const own = 'park:' + C.id; C.nearG = new THREE.Group(); C.nearG.name = 'near';
    const gm = G.build(game, S, C.i, C.j, C.cm, C.F, C.data, park.outline, false); C.nearG.add(gm); await breathe();
    let nb = 0; (C.data.structures || []).forEach((s, k) => { if ((s.kind !== 'bridge' && s.kind !== 'arch') || !((s.decks && s.decks.length) || (s.line && s.line.length > 1))) return; const id = 'b' + fid(s, k); if (!park.features.has(id)) nb++;
      hold(C, id, () => { const r = s.ring || s.line; let mx = 0, my = 0; for (const p of r) { mx += p[0] / r.length; my += p[1] / r.length; } let wl; if (s.kind === 'bridge') for (const f of park.features.values()) if (f.area && pipR(mx, my, f.area.ring)) wl = f.level; const b = Br.build(game, S, s, wl); console.log('[game] park: bridge ' + (s.name || id) + ' ' + JSON.stringify(b.info)); return b; }); });
    if (nb) rewall();
    const inC = (x, y) => x >= C.i * CELL && x < C.i * CELL + CELL && y >= C.j * CELL && y < C.j * CELL + CELL; C.nearG.add(owned(own, () => St.build(game, S, C.data.structures, inC)));
    C.nearG.add(owned(own, () => Pr.build(game, (C.data.props || []).filter((p) => p.x >= C.i * CELL && p.x < C.i * CELL + CELL && p.y >= C.j * CELL && p.y < C.j * CELL + CELL && !(LAMPS && p.kind === 'lamp')).concat((LAMPS && LAMPS.get(C.i + '_' + C.j)) || []))));
    C.nearG.add(owned(own, () => Lm.build(game, S, C, park, inC)));      /* hand-built places (landmarks.js) */
    if (/^(4_1[0-3]|5_1[12])$/.test(C.id) && Q.get('parkheroes') !== '0' && (Q.get('parkheroes') === '1' || ((game.city.meta || {}).play || [])[3] >= 3584)) { const Hx = await import('./heroes/index.js'); C.nearG.add(owned(own, () => Hx.build(game, S, C, park))); }      /* heroes/: Bethesda Terrace, the Mall, Bow Bridge by hand, in the six chunks that hold them and only on a map whose playable box reaches past Bow Bridge (y 3584: the uptown map; the default map ends at 2872, inside the Mall, and fetches none of heroes/); ?parkheroes=0 = as before, ?parkheroes=1 = on any map */
    if (C.trees.length) { await breathe(); C.nearG.add(await Tr.mid(game, C.trees)); if (!persistentTrunks) addTrunks(C, own); }
    C.farG.visible = false; C.group.add(C.nearG); C.state = 2; park.report.near++; };
  const toFarAgain = (C) => { st.removeSet('park:' + C.id); if (pool) pool.forget(C.trees); for (const t of C.trees) t.wi = null; C.group.remove(C.nearG); disposeGroup(C.nearG); C.nearG = null; C.farG.visible = true; release(C, (f) => !!f.area || f.rock); C.state = 1; };
  const drop = (C, failedLoad = false) => { if (C.state === 2) toFarAgain(C); if (persistentTrunks && C.trees?.length) st.removeSet('park:trunks:' + C.id); if (C.feat) release(C); if (C.group) { root.remove(C.group); disposeGroup(C.group); } T.drop(C.i, C.j); C.group = C.farG = C.crowns = C.data = C.cm = C.F = null; C.trees = []; C.state = 0; C.nearFailed = false; if (cut) cut.redraw(); if (!failedLoad) park.report.drops++; };

  const distTo = (C, x, y) => Math.hypot(Math.max(C.i * CELL - x, 0, x - C.i * CELL - CELL), Math.max(C.j * CELL - y, 0, y - C.j * CELL - CELL));
  // one step: the most urgent change. Returns false when there is nothing to do.
  let busy = false;
  const step = async () => { if (busy) return true; const cam = world.camera.position, x = cam.x, y = -cam.z; let best = null, bd = 1e9, act = 0;
    for (const C of park.chunks.values()) { const d = distTo(C, x, y), want = d < NEAR_D && !C.nearFailed ? 2 : d < FAR_D ? 1 : 0;
      if (C.retryAfter && C.retryAfter > performance.now()) continue;
      if (C.state < want) { const pr = d - (C.state === 0 ? 0 : 0); if (pr < bd) { bd = pr; best = C; act = C.state + 1; } }
      else if (C.state === 2 && d > NEAR_D + 50) { if (best === null) { best = C; act = -1; bd = 1e8; } }
      else if (C.state >= 1 && d > FAR_D + 150) { if (best === null) { best = C; act = -2; bd = 1e8; } } }
    if (!best) return false; busy = true; const t0 = performance.now();
    try { if (act === 1) await toFar(best); else if (act === 2) await toNear(best); else if (act === -1) toFarAgain(best); else drop(best); best.fail = 0; }
    catch (e) { if (act === 1) drop(best, true); else if (act === 2 && best.nearG) toFarAgain(best); best.state = best.state || 0; best.fail = (best.fail || 0) + 1; if (best.fail > 2) { if (act === 2) best.nearFailed = true; else if (!best.retryAfter) park.chunks.delete(best.id); } console.log('[game] park: chunk ' + best.id + ' step ' + act + ' failed: ' + (e && (e.stack || e.message))); }
    finally { busy = false; } park.report.lastMs = Math.round(performance.now() - t0); return true; };
  let poolT = 0, scanT = 0;
  const tick = async () => { await step(); if (cut && performance.now() - scanT > 2000) { scanT = performance.now(); cut.scan(); } if (pool && !busy && performance.now() - poolT > 350) { poolT = performance.now(); const cam = world.camera.position, L = []; for (const C of park.chunks.values()) if (C.state === 2 && C.trees.length) L.push(C.trees); try { await pool.update(cam.x, -cam.z, L); } catch (e) { console.log('[game] park: near trees: ' + (e && e.message)); } } };
  if (park.lamps) try { (await import('./night.js')).install(game, park); } catch (e) { console.log('[game] park: night lamps not loaded: ' + (e && e.message)); }
  park.timer = setInterval(() => { tick(); }, 120);
  // settle(): everything the camera's place asks for is built (stills and tests wait on this)
  park.settle = async () => { for (let k = 0; k < 400; k++) { while (busy) await breathe(); if (!(await step())) break; } if (cut) cut.scan(); if (pool) { const cam = world.camera.position, L = []; for (const C of park.chunks.values()) if (C.state === 2 && C.trees.length) L.push(C.trees); await pool.update(cam.x, -cam.z, L); } return park.report; };
  park.mirrorNow = () => Wa.mirrorNow();
  park.dispose = () => { clearInterval(park.timer); clearInterval(park.nightLamps?.t); for (const C of park.chunks.values()) if (C.state) drop(C); world.scene.remove(root); };
  park.count = () => { const n = [0, 0, 0]; for (const C of park.chunks.values()) n[C.state]++; return { none: n[0], far: n[1], near: n[2], features: park.features.size, nearTrees: pool ? pool.n : 0 }; };
  if (!Q || Q.get('parkloop') !== '0') try { (await import('./loop.js')).install(game, park); } catch (e) { console.log('[game] park: runners and cyclists not loaded: ' + (e && e.message)); }      /* park/loop.js: runners and cyclists on the drives; ?parkloop=0 = none */
  if (!Q || Q.get('parktransverse') !== '0') try { (await import('./transverse.js')).install(game, park); } catch (e) { console.log('[game] park: transverse walls not loaded: ' + (e && e.message)); }      /* park/transverse.js: the 65th St transverse's retaining walls; ?parktransverse=0 = the trench as before */
  // the first chunks before the game shows: the player may start in or beside the park
  try { const pl = game.player; if (pl && T.inBox(pl.x, pl.y)) await park.settle(); } catch (e) {}
  return park;
}
