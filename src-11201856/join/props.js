// join/props.js (lead, helper uptown-join, Nov 19): street trees, lamps, signals and street furniture of a joined area. The whole-city layers that make these
// (game.js's kit props, streets/trees_next.js, streets/furniture.js, the night kit's lamp map) are built once at load from game.city, so a joined area had none
// past the default map's far ring. Here, per joined area, after its ground:
//   1 lists     the area's props from the pack (pack.ground.<set>.props), put through the rules game.js gives the map's own at load (large trees are park trees,
//               a light within 3 m of a signal goes, nothing stands in a traffic lane); signal props are renumbered from the uptown file's junction numbers to the
//               joined list's (pack node .u -> its place in city.nodes);
//   2 walls     trunks, poles and hydrants become circles in the collision world under the area's owner name;
//   3 kit       the game's own simple props for those lists (models.js addProps) and the signals' lit lenses (as game.js makes them, kept in step each 0.2 s);
//   4 layers    the streets layer's trees, shop fronts and furniture, by THOSE LAYERS' OWN add() run a second time on a stand-in game: its city is the area's slice (the whole
//               node and edge lists, the area's blocks, parks, buildings and props), its map box is the area's, its prop meshes and signal lamps are the area's.
//               Nothing in streets/ is changed. The tree layer's Madison Square census (added on every call) is answered empty for the second call.
//               ?joinprops=kit = stop after 3 (the simple props stay visible); ?joinskip=trees,storefronts,furniture = without those;
//   5 night     the area's lamp heads join the night kit's lamp map (the picture the light pools are drawn from is made again over the wider box) and its glows.
// ?joinprops=0 = none of this. Each step is timed in the report (game.__join.props.<set>).
import * as THREE from 'three';
import { addProps } from '../models.js';

const sl = (ms) => new Promise((r) => setTimeout(r, ms));
let fetchHooked = false, emptyCensus = 0;
const hookFetch = () => { if (fetchHooked) return; fetchHooked = true; const f0 = window.fetch; window.fetch = function (u) { if (emptyCensus > 0 && /hero_census\.json/.test(String((u && u.url) || u))) return Promise.resolve(new Response('{"trees":[]}', { headers: { 'Content-Type': 'application/json' } })); return f0.apply(this, arguments); }; };

export function lists(game, pack, a) {
  const g = pack.ground[a.set], src = g.props || {}, R = game.roads, out = {}, um = new Map(); pack.nodes.forEach((n, i) => { if (n.u !== undefined && pack.gi) um.set(n.u, pack.gi[i]); });
  for (const k in src) out[k] = src[k].map((p) => p.slice());
  // The default map's own whole-city layers already drew its far ring north of the line (trees, lamps, signals, hydrants: about 600 m): a pack prop that falls where the
  // default map has props of its kind (its 64 m square or one beside it) is left out, or the first 600 m stands with two sets of lamps (twice the light at night: seen in
  // hold h17, critic round 5) and two sets of trees.
  let ring = 0; { const LINE = game.city.meta.play[3], C = 64, key = (x, y) => Math.floor(x / C) * 65536 + Math.floor(y / C), have = (k) => { const S = new Set(), add = (L) => { for (const p of L || []) if (p[1] > LINE) S.add(key(p[0], p[1])); }; add(game.city.props[k]); if (k === 'tree') for (const im of game.propMeshes || []) if (im.userData && im.userData.kind === 'tree2') add(im.userData.items); return S; };
    for (const k in out) { const S = have(k); if (!S.size) continue; const n0 = out[k].length; out[k] = out[k].filter((p) => { const i = Math.floor(p[0] / C), j = Math.floor(p[1] / C); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (S.has((i + a) * 65536 + j + b)) return false; return true; }); ring += n0 - out[k].length; } }
  const extra = { tree2: [] }; out.tree = (out.tree || []).filter((p) => { if (p[3] > 1.3) { extra.tree2.push([p[0], p[1], p[2], p[3] * 0.7]); return false; } return true; });
  let lost = 0; out.signal = (out.signal || []).filter((p) => { const n = um.get(p[4]); if (n === undefined || !game.city.nodes[n]) { lost++; return false; } p[4] = n; p[6] = Math.PI; return true; });
  if (out.light && out.signal.length) { const SG = new Map(); for (const p of out.signal) { const k = Math.floor(p[0] / 8) * 65536 + Math.floor(p[1] / 8); let q = SG.get(k); if (!q) SG.set(k, (q = [])); q.push(p); }
    out.light = out.light.filter((l) => { const ci = Math.floor(l[0] / 8), cj = Math.floor(l[1] / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const q = SG.get(i * 65536 + j); if (q) for (const p of q) if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 3) return false; } return true; }); }
  let dropped = 0; for (const k of ['light', 'tree', 'signal', 'hydrant', 'bin', 'meter', 'newsbox']) if (out[k]) out[k] = out[k].filter((p) => { if (R.inLane(p[0], p[1], 0.45)) { dropped++; return false; } return true; });
  return { props: out, extra, lost, dropped, ring };
}

// the signals' lit lenses, as game.js makes the map's own (three heads a signal; only the lit colour is shown)
function sigLamps(game, list) {
  const HEADS = [[5.6, 5.965], [2.6, 5.965], [-0.32, 3.945]], DROP = { r: 0, y: 0.345, g: 0.69 }, COL = { r: [1.75, 0.10, 0.05], y: [1.7, 0.95, 0.06], g: [0.06, 1.45, 0.62] };
  const geo = new THREE.CircleGeometry(0.128, 18); geo.rotateY(Math.PI / 2); const glow = new THREE.CircleGeometry(0.3, 18); glow.rotateY(Math.PI / 2);
  const n = Math.max(1, list.length * 3), L = { list, state: new Array(list.length).fill(''), base: { r: [], y: [], g: [] }, halo: {} };
  for (const k of ['r', 'y', 'g']) { const c = new THREE.Color(...COL[k]); L[k] = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }), n);
    L.halo[k] = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.05), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), n); }
  const M = new THREE.Matrix4(), T = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), hide = game.sigHide || new THREE.Matrix4().makeScale(0, 0, 0);
  list.forEach((p, i) => { e.set(0, p[2] + (p[6] || 0), 0); q.setFromEuler(e); v.set(p[0], p[7] || 0.15, -p[1]); sc.setScalar(p[3] || 1); M.compose(v, q, sc);
    for (const k of ['r', 'y', 'g']) HEADS.forEach((h, j) => { T.makeTranslation(0.129 + 0.014, h[1] - DROP[k], h[0]); L.base[k][i * 3 + j] = new THREE.Matrix4().multiplyMatrices(M, T); L[k].setMatrixAt(i * 3 + j, hide); L.halo[k].setMatrixAt(i * 3 + j, hide); }); });
  for (const k of ['r', 'y', 'g']) for (const im of [L[k], L.halo[k]]) { im.frustumCulled = false; im.matrixAutoUpdate = false; im.name = 'join_sig'; game.world.scene.add(im); }
  return L;
}

export async function addArea(game, J, pack, a) {
  const P = game.P, mode = P.get('joinprops') || 'layers', rep = { mode, t0: +(performance.now() / 1000).toFixed(1) }; if (mode === '0') return { off: 1 };
  const city = game.city, world = game.world, st = game.statics, g = pack.ground[a.set], B = a.play; let t = performance.now(); const lap = (k) => { const n = performance.now(); rep[k + '_ms'] = Math.round(n - t); t = n; };
  console.log('[join] props of ' + a.set + ' start (' + mode + ') at ' + rep.t0 + ' s');
  // 1 lists
  const { props, extra, lost, dropped, ring } = lists(game, pack, a); rep.inDefaultRing = ring; rep.n = {}; for (const k in props) rep.n[k] = props[k].length; rep.n.tree2 = extra.tree2.length; rep.signalsLost = lost; rep.inLane = dropped; lap('lists');
  // 2 walls
  if (st) { const own = st.owner; st.owner = a.set; try { for (const k of ['light', 'tree', 'signal', 'hydrant']) for (const p of props[k] || []) st.addCircle(p[0], p[1], k === 'tree' ? 0.22 : k === 'hydrant' ? 0.2 : 0.14, k); } finally { st.owner = own; } } lap('walls'); await sl(30);
  // 3 kit props and signal lenses
  t = performance.now(); const meshes = addProps(world.scene, game.kit, { props }, extra); for (const m of meshes) m.userData.join = a.set; rep.kitMeshes = meshes.length; lap('kit'); await sl(30);
  t = performance.now(); const L = sigLamps(game, props.signal || []);
  const sg = Object.create(game); sg.sigLamps = L; sg.propMeshes = meshes; sg.dressing = null;     /* the lead's dressing meshes are the first call's to rework, not this one's */ sg.bounds = { in: (x, y, k = 0) => x > B[0] - k && x < B[2] + k && y > B[1] - k && y < B[3] + k };
  sg.city = { meta: Object.assign({}, city.meta, { play: B.slice() }), nodes: city.nodes, edges: city.edges, water: city.water, buildings: g.b.map((i) => pack.buildings[i]), blocks: g.blocks, parks: g.parks, marks: g.marks, props, parked: g.parked, ped_loops: g.ped_loops };
  // the stand-in's own signal update is the game CLASS's method, held as its own property: read through the stand-in's prototype it would be the hook below on the game
  // itself, which calls every stand-in's update: a call that never ends (it froze the page in holds h14 and h15)
  { let pr = Object.getPrototypeOf(game); while (pr && !Object.prototype.hasOwnProperty.call(pr, 'updateSignals')) pr = Object.getPrototypeOf(pr); const base = pr && pr.updateSignals; sg.updateSignals = function () { return base ? base.call(this) : undefined; }; }
  (J.sig = J.sig || []).push(sg);
  if (!J.sigHook) { J.sigHook = 1; const u0 = game.updateSignals; game.updateSignals = function () { const r = u0.apply(this, arguments); for (const s of J.sig) { try { if (Object.prototype.hasOwnProperty.call(s, 'updateSignals')) s.updateSignals(); } catch (e) { if (!J.sigErr) { J.sigErr = String(e && e.message); console.log('[join] signals of a joined area: ' + J.sigErr); } } } return r; }; }
  try { sg.updateSignals(); } catch (e) { rep.sigFailed = String(e && e.message); } lap('signals'); a.sg = sg; a.propMeshes = meshes;
  // 4 the streets layer's trees and furniture for the area
  if (mode !== 'kit' && game.streets && game.streets.parts) { const parts = Object.create(game.streets.parts), ctx = { THREE, A: 'assets/streets/', world, shared: world.shared, city: sg.city, parts, set: { name: a.set, play: B, region: B, city: sg.city }, late: P.get('joinlate') !== '0'     /* treeslate.patch: the tree layer takes turns between its steps when late; ?joinlate=0 = in one go, as before */ };
    const skip = (P.get('joinskip') || '').split(',');
    for (const [part, file] of [['trees', 'trees_next'], ['storefronts', 'storefronts'], ['furniture', 'furniture']])     /* storefronts before furniture: furniture reads the area's shop list from ctx.parts */ { const have = game.streets.parts[part]; if (!have || skip.includes(part)) { rep[part] = have ? 'skipped' : 'layer off'; continue; } console.log('[join] props of ' + a.set + ': ' + part + ' starts at ' + (performance.now() / 1000).toFixed(1) + ' s'); await sl(60); t = performance.now(); const own = st && st.owner; if (st) st.owner = a.set;
      try { hookFetch(); emptyCensus++; const m = await import('../streets/' + file + '.js'), r = (await m.add(sg, ctx)) || {}; parts[part] = r; (have.sets = have.sets || {})[a.set] = r; if (r.group) r.group.name = (r.group.name || part) + ':' + a.set; rep[part] = Object.assign({ ms: Math.round(performance.now() - t) }, r.report && JSON.parse(JSON.stringify(r.report, (k, v) => (k === 'model_ktris' ? undefined : v)     /* treeslate.patch: the tree layer's own step times (tm) stay in the report */))); }
      catch (e) { rep[part] = 'FAILED: ' + String((e && (e.stack || e.message)) || e).slice(0, 500); console.log('[join] ' + part + ' of ' + a.set + ' not built: ' + (e && e.message)); } finally { emptyCensus--; if (st) st.owner = own || null; } }
    // what the stand-in was given that the game itself must hear of
    try { if (game.peds) game.peds.furniture = null; if (game.crowd && game.crowd.refreshFurniture) game.crowd.refreshFurniture(B); } catch (e) { rep.crowdRefresh = String(e && e.message); } }
  rep.ownKeys = Object.keys(sg).join(',');
  // 5 night: the lamp heads, kept for the kit whenever it comes (it is made at the first dusk)
  { const F = game.streets && game.streets.parts && game.streets.parts.furniture && game.streets.parts.furniture.sets && game.streets.parts.furniture.sets[a.set], kinds = F && F.kinds, heads = [], LK = P.has('joinlamp') && isFinite(+P.get('joinlamp')) ? Math.max(0, Math.min(1, +P.get('joinlamp'))) : 0.75;     /* night.patch (item 1): how strong a joined area's lamps are drawn into the night kit's lamp picture. The kit takes a pixel's night colour over the night ambient as its albedo; a road the day's light picture has in full sun (most of the joined row: low buildings, wide avenues) reads as albedo 1 where Midtown's roads, in their towers' baked shade, read a third of that, so the same lamps lit the joined row twice as bright (hold h19: street half of the frame 67 - 92 of 255 against 28 - 59 on 8th Avenue; without lamp light 13 - 26 against 7 - 12). 0.75 = 0.56 of the light and nine tenths of the pool's radius; ?joinlamp=1 = as before */
    const Ll = kinds && kinds.lampLod && kinds.lampLod.list; if (Ll) for (const it of Ll) { const s = (it[4] && typeof it[4].s === 'number' ? it[4].s : 1), h = it[3] || 0; heads.push([it[0] + Math.cos(h) * 2.8 * s, it[1] + Math.sin(h) * 2.8 * s, (8.4 + 1.25) * s + (it[2] || 0), LK]); }
    const Tw = kinds && kinds.twin && kinds.twin.list; if (Tw) for (const it of Tw) heads.push([it[0], it[1], 4.2 + (it[2] || 0), 0.6 * LK]);
    if (!heads.length) for (const p of props.light || []) heads.push([p[0], p[1], 9.2, LK]);     /* no furniture layer: the kit's plain poles */
    a.heads = heads; rep.lampHeads = heads.length; }
  rep.t1 = +(performance.now() / 1000).toFixed(1); return rep;
}

// the night kit's lamp map over the wider box, and the glows (called each second by join.js; does its work once per area, when the kit exists)
export function nightTick(game, J) {
  const K = game.night && game.night.kit; if (!K || !K.addLamps) return; const todo = J.areas.filter((a) => a.heads && a.heads.length && !a.lampsIn); if (!todo.length) return;
  const t0 = performance.now(), hs = [].concat(...todo.map((a) => a.heads)); for (const a of todo) a.lampsIn = 1;
  try { if (K.map && K.pass) { const r = K.map.rect; let x0 = r[0], y1 = -r[1], x1 = x0 + 1 / r[2], y0 = y1 - 1 / r[3], grown = false;
      for (const h of hs) { if (h[0] - 40 < x0) { x0 = h[0] - 40; grown = true; } if (h[0] + 40 > x1) { x1 = h[0] + 40; grown = true; } if (h[1] - 40 < y0) { y0 = h[1] - 40; grown = true; } if (h[1] + 40 > y1) { y1 = h[1] + 40; grown = true; } }
      if (grown) { /* the picture as it stands (the map's lamps, the park's posts, earlier areas) is kept: copied, then drawn back at its place in the wider one */ const cv = K.map.tex.image, c = cv.getContext('2d'), tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = cv.height; tmp.getContext('2d').drawImage(cv, 0, 0);
        const S = Math.min(0.5, 2048 / Math.max(x1 - x0, y1 - y0)), ox0 = r[0], oy1 = -r[1], ow = 1 / r[2], oh = 1 / r[3]; cv.width = Math.ceil((x1 - x0) * S); cv.height = Math.ceil((y1 - y0) * S); c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height); c.imageSmoothingQuality = 'high'; c.drawImage(tmp, (ox0 - x0) * S, (y1 - oy1) * S, ow * S, oh * S);
        K.map.rect = [x0, -y1, 1 / (x1 - x0), 1 / (y1 - y0)]; K.map.size = [cv.width, cv.height]; K.pass.u.uMap.value.set(...K.map.rect); K.map.tex.dispose(); K.map.tex.needsUpdate = true; } }
    K.addLamps(hs); J.night = { lamps: hs.length, map: K.map && K.map.size, ms: Math.round(performance.now() - t0) }; console.log('[join] night lamps ' + JSON.stringify(J.night)); }
  catch (e) { J.night = { failed: String((e && (e.stack || e.message)) || e).slice(0, 300) }; console.log('[join] night lamps not added: ' + (e && e.message)); }
}
