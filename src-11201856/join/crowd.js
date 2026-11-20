// join/crowd.js (lead, helper uptown-join, Nov 19): the crowd north of the line. crowd/nav.js builds the crowd's sidewalk net once, at load, inside the map's box as
// it is then; a joined pack's areas therefore had no net and only the game's own few walkers. Here, once per pack, the SAME builder (buildNav, untouched) makes a
// second net for the pack's areas alone: it is handed a stand-in game whose box is the pack's areas (south side on the line, the map's own 9 m margin), whose road
// list holds only the pack's roads and the default roads that cross the line, and whose buildings and parks are the pack's. The second net's ways and corners are
// then numbered into the crowd's one net (nav.ways, nav.verts), and the net's questions (near, blocked, push, soft, gapTo, obstaclesNear, inBuilding, refresh) ask
// the old net south of the line and the new one north of it. crowd/sim.js needs no change: it fills ways round the camera by their density, whichever net made them.
// At the line the two nets are made one where a walk of each runs along the same road and side (see 'made one at the line' below). ?joincrowd=0 = none of this.
import { buildNav, furnitureOf } from '../crowd/nav.js';

export function addNet(game, J, name, pack) {
  const cr = game.crowd, P = game.P, rep = {}; if (P && P.get('joincrowd') === '0') return { off: 1 }; if (!cr || !cr.on || !cr.nav || !cr.sim) return { skipped: 'no crowd' };
  const t0 = performance.now(), nav = cr.nav, sim = cr.sim, city = game.city, SL = Math.min(...pack.sets.map((q) => q.play[1])), LINE = SL > J.box0[3] + 1 ? SL : J.box0[3]     /* packs.patch: a pack that stands on another pack: its own south side is its line */, M = 9;
  const B = [Math.min(...pack.sets.map((s) => s.play[0])), LINE, Math.max(...pack.sets.map((s) => s.play[2])), Math.max(...pack.sets.map((s) => s.play[3]))];
  // the roads the new net is built along: the pack's own, and the default map's that reach over the line inside the pack's width (the stretch from the line to their north end)
  const E = []; E.length = city.edges.length; let ne = 0; city.edges.forEach((e, i) => { if (!e || e.dead || !e.pts) return; if (e.join === name || e.pts.some((p) => p[1] > LINE && p[0] > B[0] && p[0] < B[2])) { E[i] = e; ne++; } });
  const roads = Object.create(game.roads); roads.edges = E; roads.nodes = city.nodes;
  const c2 = Object.create(city); c2.buildings = pack.buildings; c2.parks = [].concat(...Object.keys(pack.ground || {}).map((k) => pack.ground[k].parks || []));
  const stand = Object.create(game); stand.roads = roads; stand.city = c2; const OV = 7.5;     /* the new net starts 7.5 m (three of the builder's samples) south of where the old one ends, so each walk over the line exists twice for that stretch and the two can be made one (below) */
  stand.bounds = { x: (B[2] - B[0]) / 2 - M + 3, y: (B[3] - B[1] + OV) / 2 + 3, cx: (B[0] + B[2]) / 2, cy: (B[1] - M - OV + B[3] - M) / 2 };
  let extra = []; try { extra = furnitureOf(game).extra.filter((o) => o.y > LINE - 15 && o.x > B[0] - 15 && o.x < B[2] + 15); } catch (e) {}
  const n2 = buildNav(stand, [], extra, []); rep.build_ms = Math.round(performance.now() - t0); rep.edges = ne; rep.furniture = extra.length; Object.assign(rep, { ways: n2.report.ways, km: n2.report.km, crossings: n2.report.crossings, dropped: n2.report.dropped });
  if (!n2.ways.length) return Object.assign(rep, { skipped: 'no ways' });
  // one net: the new corners and ways take the next numbers and the fields crowd/sim.js gives every way when it starts
  for (const v of n2.verts) { v.id = nav.verts.length; nav.verts.push(v); }
  for (const w of n2.ways) { w.id = nav.ways.length; nav.ways.push(w); w.agents = []; w.pop = 0; w.frac = sim.rand(); w.wait = [[], []]; w.clearT = -1; w.clear = true; w.join = name; }
  // The two nets made one at the line (?joincrowd=apart = left apart, as the first cut). A default walk that crosses the line ends 9 m south of it at a corner of its own (V1);
  // the new net's walk along the same road and side starts up to 7.5 m further south and runs through that point. The new walk is cut to start AT V1 (its base point moved along
  // its own line, its length shortened), V1 becomes its end corner, and the builder's own refresh makes its band again from there. Walkers then plan over V1 like any corner.
  // Walks that still end at the line keep a through walk's density (crowd/nav.js thins a walk that ends to 0.4).
  { const near = (v) => v.inc.length === 1 && Math.abs(v.y - (LINE - M)) < 16 && v.x > B[0] - 5 && v.x < B[2] + 5, olds = [], st = new Set(); let n = 0, ends = 0;
    for (const w of nav.ways) { if (w.join === name || w.kind !== 'strip' || !w.e) continue;     /* packs.patch: the walks to meet are every earlier net's (the map's own, or the pack's below) */ for (const v of [w.a, w.b]) if (near(v)) olds.push({ w, v }); }
    if (P.get('joincrowd') !== 'apart') for (const w2 of n2.ways) { if (w2.kind !== 'strip' || !w2.e || st.has(w2)) continue; const atA = near(w2.a), atB = near(w2.b); if (atA === atB) continue; const v2 = atA ? w2.a : w2.b;
      for (const o of olds) { if (o.used || o.w.e !== w2.e || (o.w.side || 0) !== (w2.side || 0)) continue; const dx = o.v.x - w2.ax, dy = o.v.y - w2.ay, sA = dx * w2.ux + dy * w2.uy, lat = Math.abs(dx * w2.nx + dy * w2.ny), cut = atA ? sA : w2.len - sA;
        if (lat > 0.5 || cut < -0.3 || cut > 60 || w2.len - cut < 4) continue;     /* V1 lies on the new walk's line, within the overlap */
        if (atA) { w2.ax = w2.ax + w2.ux * sA; w2.ay = w2.ay + w2.uy * sA; w2.len -= sA; w2.a = o.v; o.v.inc.push({ w: w2, end: 0 }); } else { w2.len = sA; w2.b = o.v; o.v.inc.push({ w: w2, end: 1 }); }
        v2.inc.length = 0; o.used = true; st.add(w2); if (!o.w.__jl) { o.w.__jl = 1; o.w.rho /= 0.4; } n++; break; } }
    if (st.size) { const more = n2.refresh(undefined, (w) => st.has(w)); for (let k = 0; k < 1000 && !more(50); k++); }
    for (const w of n2.ways.concat(olds.filter((o) => !o.used).map((o) => o.w))) if (w.kind !== 'cross' && w.rho > 0 && !w.__jl && !st.has(w) && ((w.a.inc.length < 2 && near(w.a)) || (w.b.inc.length < 2 && near(w.b)))) { w.__jl = 1; w.rho /= 0.4; ends++; }
    rep.stitched = n; rep.lineEnds = ends; }
  const Y0 = LINE - M, north = (y) => y > Y0, tmp = [], near1 = nav.near, pick = (k) => { const f1 = nav[k], f2 = n2[k]; if (typeof f1 === 'function' && typeof f2 === 'function') nav[k] = function (x, y) { return (north(y) ? f2 : f1).apply(null, arguments); }; };
  nav.near = (x, y, r, out = []) => { near1(x, y, r, out); if (y + r > Y0 && x + r > B[0] && x - r < B[2]) { n2.near(x, y, r, tmp); for (let i = 0; i < tmp.length; i++) out.push(tmp[i]); } return out; };
  for (const k of ['blocked', 'push', 'soft', 'gapTo', 'obstaclesNear', 'raisedTablesNear', 'inBuilding']) pick(k);
  { const r1 = nav.refresh; nav.refresh = (extra, pred, raised) => { const a = r1(extra, pred, raised), b = n2.refresh(extra, pred, raised); nav.ver++; return (ms) => { const x = a(ms), y = x ? b(ms) : false; return x && y; }; }; }
  nav.weight = (nav.weight || 0) + (n2.weight || 0); nav.ver++; (nav.joined = nav.joined || {})[name] = n2; if (cr.report) cr.report['join_' + name] = rep;
  rep.ms = Math.round(performance.now() - t0); rep.waysNow = nav.ways.length; return rep;
}
