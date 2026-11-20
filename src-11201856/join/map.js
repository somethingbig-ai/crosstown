// join/map.js (lead, helper uptown-join, Nov 19): the Tab map, the small map and the GPS north of the line. The map (citymap2.js) reads the city once, when it is
// made: its box, its grid of things to draw, its street and landmark names, its whole-map picture. The GPS router (gps/route.js) numbers the junctions once.
// After a pack has joined:
//   map   a second map object is MADE BY THE MAP'S OWN CLASS from a stand-in city (the default city's lists + the packs' roads, blocks, parks and buildings, the
//         box grown to the joined areas) with its key and mouse listeners and its whole-map picture held back, and what it worked out (box, frame, grid, names,
//         landmark list, scale) is handed to the map that is on screen, which keeps its own state and listeners. The whole-map picture is the old one drawn into
//         the wider box with only the joined strip painted new. Detail tiles are thrown away and come back as they are looked at.
//   GPS   a new router over the joined road lists, its tables handed to the router the GPS holds (waypoints and routes north of the line).
// The old round map (?citymap=0, ?map2=0) is not grown. ?joinmap=0 = none of this.
export async function grow(game, J) {
  const rep = {}, t0 = performance.now(), hud = game.hud, old = hud && hud.cmap, city = game.city, packs = Object.keys(J.pk || {}).map((k) => J.pk[k]);
  try { const G = game.gps; if (G && G.router && G.router.constructor) { const t = performance.now(), r2 = new G.router.constructor(game.roads), keep = { plans: G.router.plans, ms: G.router.ms, worst: G.router.worst }; Object.assign(G.router, r2, keep); rep.gps = { junctions: r2.N, core: r2.coreSize, ms: Math.round(performance.now() - t) }; if (G.target && G.replan) { try { G.replan(); } catch (e) {} } } else rep.gps = 'no gps'; } catch (e) { rep.gps = 'FAILED: ' + String(e && e.message); }
  if (!old || !old.grid || !old.paint || !old.box) { rep.map = 'not the styled map'; return rep; }
  const t1 = performance.now(), m = await import('../citymap2.js'), CityMap = m.CityMap; if (!(old instanceof CityMap)) { rep.map = 'another map class'; return rep; }
  const M0 = city.meta, A = J.areas, play = [Math.min(...A.map((s) => s.play[0])), Math.min(...A.map((s) => s.play[1])), Math.max(...A.map((s) => s.play[2])), Math.max(...A.map((s) => s.play[3]))];
  const meta = Object.assign({}, M0, { play, sets: (M0.sets || []).concat(...packs.map((p) => p.sets)) });
  const blocks = city.blocks.slice(), parks = city.parks.slice(), buildings = city.buildings.slice(); for (const p of packs) { for (const k in p.ground || {}) { for (const b of p.ground[k].blocks || []) if (b.ext && b.ext.length > 2) blocks.push(b); for (const b of p.ground[k].parks || []) if (b.ext && b.ext.length > 2) parks.push(b); } for (const b of p.buildings) if (!b.dup) buildings.push(b); }
  const sg = Object.create(game); sg.city = { meta, nodes: city.nodes, edges: city.edges.filter((e) => e && !e.dead && e.pts), blocks, parks, buildings, water: city.water, waterPiers: city.waterPiers, props: city.props };
  // made with no listeners and no whole-map picture (both belong to the map on screen)
  let donor; const base0 = CityMap.prototype.base; CityMap.prototype.base = function () { return null; }; window.addEventListener = function () {};
  try { donor = new CityMap(sg, hud); } finally { CityMap.prototype.base = base0; delete window.addEventListener; }
  rep.make_ms = Math.round(performance.now() - t1);
  // the whole-map picture(s): the old one at its place in the wider box, the joined strip painted new
  const t2 = performance.now(), Bo = old.box, Bn = donor.box, S = donor.S0, LINE = J.box0[3], bases = {};
  for (const pal in old.bases || {}) { const ob = old.bases[pal]; if (!ob || !ob.cv) continue; const cv = document.createElement('canvas'); cv.width = Math.ceil((Bn[2] - Bn[0]) * S); cv.height = Math.ceil((Bn[3] - Bn[1]) * S); const c = cv.getContext('2d');
    const top = Bn[3], y0 = LINE - 40, strip = document.createElement('canvas'); strip.width = cv.width; strip.height = Math.max(1, Math.ceil((top - y0) * S)); donor.paint(strip, Bn[0], top, S, pal);
    c.imageSmoothingQuality = 'high'; c.drawImage(strip, 0, 0); const dy = Math.round((top - y0) * S); c.drawImage(ob.cv, 0, Math.max(0, (Bo[3] - y0) * ob.S), ob.cv.width, ob.cv.height - Math.max(0, (Bo[3] - y0) * ob.S), (Bo[0] - Bn[0]) * S, dy, (Bo[2] - Bo[0]) * S, (y0 - Bo[1]) * S); bases[pal] = { cv, S }; }
  rep.picture_ms = Math.round(performance.now() - t2);
  for (const k of ['box', 'play', 'fr', 'S0', 'grid', 'stamp', 'names', 'marks', 'wm', 'wn', 'inAreas']) old[k] = donor[k];
  old.bases = bases; if (old.tiles && old.tiles.clear) old.tiles.clear(); old.st = null; old.clampT && old.clampT();
  rep.map = { box: Bn.map(Math.round), names: donor.names.length, marks: donor.marks.length, pictures: Object.keys(bases).join(',') }; rep.ms = Math.round(performance.now() - t0); return rep;
}
