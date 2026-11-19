// streets.js: the street-level layer (lanes/streets): trees, ground, street furniture and signals, storefronts, vehicles and clutter.
// One call after the game is built:   game.streets = await (await import('./streets.js')).addStreets(game);
// Each part is its own module in ./streets/ exporting  async function add(game, ctx)  -> { group?, report? } ; a part that fails to load
// is logged and skipped, the game runs without it. opts.select: null = every part, 'a,b' = only those, '-a,b' = all but those
// (also from the url: ?streets=a,b or ?streets=-a  ; ?streets=none turns the layer off).
import * as THREE from 'three';
export const HELD = ['sidewalks'];     /* lead, Nov 12: kept on one-sided blind judging (CHIEF 06:3x); off until its lane re-judges both ways. ?held=1 shows it. Grass v1 left this list in the 15:45 merge (both-sides verdict streets/grass 15:27, frozen v1cut f6d702ae); ?hold=grass (or ?hold=a,b) holds a part back again = the flat grass */
export const NEXT = { trees: 'trees_next' }, NEXT_ON = true;     /* merge 15:45 Nov 12: the streets release trees (trees_next.js = release 7cd0406d + trees_gen_next.js + the added files in assets/streets/trees) are the default: both-sides verdict streets/trees 15:37 (16 of 16), not slower at the spawn, faster at the plaza. ?treeslead=1 gives the trees of before (trees.js 53940095) */
export const PER_SET = ['ground', 'grass'];     /* tiles lane: the layers already converted to one call per map area */
export const PARTS = ['ground', 'sidewalks', 'grass', 'trees', 'storefronts', 'furniture', 'vehicles', 'carts'];   // storefronts before furniture: furniture reads its shop list (game.streets.parts)
export async function addStreets(game, opts = {}) {
  let sel = opts.select ?? (game.P && game.P.get('streets')) ?? null;
  const out = { parts: {}, report: {} }; game.streets = out;   // set early: a later part may read an earlier one's result (game.streets.parts.<name> or ctx.parts)
  if (sel === 'none') return out;
  const heldOn = !!(game.P && game.P.get('held') === '1'), oldTrees = !!(game.P && game.P.get('treeslead') === '1'), hold = HELD.concat(((game.P && game.P.get('hold')) || '').split(',')); const shown = heldOn ? PARTS : PARTS.filter((p) => !hold.includes(p)); let want = shown;
  if (sel) { const neg = sel.startsWith('-'), names = sel.replace(/^-/, '').split(','); want = (neg ? shown : PARTS).filter((p) => names.includes(p) !== neg); }
  const ctx = { THREE, A: 'assets/streets/', world: game.world, shared: game.world.shared, city: game.city, parts: out.parts };
  for (const p of want) {
    const t = performance.now();
    try { const m = await import('./streets/' + ((heldOn || NEXT_ON) && NEXT[p] && !(p === 'trees' && oldTrees) ? NEXT[p] : p) + '.js');
      // tiles lane (map areas as sets, lanes/tiles/CONTRACT.md): a layer named in PER_SET is built once per area of a city that lists its areas (meta.sets), each call
      // with that area's slice of the city; the first area's result stands where the one result stood, the others hang off it as .sets. ?persets=0 = one whole-city call as before.
      if ((PER_SET.includes(p) || ((game.P && game.P.get('perset')) || '').split(',').includes(p)) && game.city.meta.sets && !(game.P && game.P.get('persets') === '0')) { const { setsOf } = await import('./sets.js'); const res = {}, all = setsOf(game.city);
        // the area the player starts in is built now; the others AFTER the game is ready, one at a time (the load does not wait for streets a player cannot reach
        // for a minute). Stills, films and test tools build everything now, as hero.js does; ?setslate=1 forces the late order, ?setslate=0 the old one.
        const Q = game.P, tool = !!window.__noStart || !!navigator.webdriver || (Q && (Q.has('demo') || Q.has('capture') || Q.has('shot') || Q.has('play') || Q.get('crowd') === 'none' || Q.get('peds') === '0'));
        const late = Q && Q.get('setslate') === '1' ? true : Q && Q.get('setslate') === '0' ? false : !tool, sa = game.world && game.world.startAt, pl = game.player || (sa ? { x: sa[0], y: sa[1] } : { x: -196, y: -214 });
        const here = all.find((S) => pl.x >= S.play[0] && pl.x <= S.play[2] && pl.y >= S.play[1] && pl.y <= S.play[3]) || all[0];
        const one = async (S, isLate) => { const st = game.statics; if (st) st.owner = S.name; const t1 = performance.now(); try { res[S.name] = (await m.add(game, { ...ctx, city: S.city, set: S, late: !!isLate })) || {};     /* late: built during play (the layer yields between pieces and makes its shaders before it shows) */ } finally { if (st) st.owner = null; } return Math.round(performance.now() - t1); };
        await one(here); for (const S of all) if (S !== here) { if (late) (out.later = out.later || []).push({ part: p, set: S.name, region: S.region, run: () => one(S, true) }); else await one(S); }
        const first = res[here.name] || {}; first.sets = res; out.parts[p] = first; }
      else out.parts[p] = (await m.add(game, ctx)) || {}; out.report[p] = Object.assign({ ms: Math.round(performance.now() - t) }, out.parts[p].report || {}); }
    catch (e) { out.report[p] = 'FAILED: ' + (e && (e.stack || e.message) || e).toString().slice(0, 400); console.log('[streets] ' + p + ' not loaded: ' + (e && e.message)); }
  }
  console.log('[streets] ' + JSON.stringify(out.report).slice(0, 900));
  // tiles lane: the areas left for after ready (above) are built here, each in its own turn of the page, with a pause between them
  if (out.later && out.later.length) { const sl = (ms) => new Promise((r) => setTimeout(r, ms)); out.lateDone = (async () => { while (!window.__ready && !window.__error) await sl(200); await sl(1200);
      // an area is built when the camera comes within `gate` metres of its playable box (?setsgate=900; 0 = at once, as before Nov 14): an area two areas away costs
      // nothing until the player heads for it, so the map can grow without the first minutes of every session paying for all of it. out.lateDone ends when the
      // areas in reach are built; the loop goes on for the others (out.latePending = how many jobs still wait).
      const gate = game.P && game.P.has('setsgate') ? +game.P.get('setsgate') : 900, plays = {}; for (const s of game.city.meta.sets || []) plays[s.set] = s.play;
      const near = (name) => { const b = plays[name], c = game.world && game.world.camera && game.world.camera.position, ts = game.world && game.world.tiles && game.world.tiles.sets && game.world.tiles.sets.find((q) => q.set === name);
        if (ts && ts.state !== 2) return false;     /* the area's tile set (its buildings and the model's ground, which the ground layer takes over) must be in first: tiles.js fetches it from 1,200 m */
        if (!gate || !b || !c) return true; const x = c.x, y = -c.z, dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]); return Math.hypot(dx, dy) <= gate; };
      const pend = out.later.slice(), run1 = async (j) => { try { const ms = await j.run();
        if (j.part === 'furniture' || j.part === 'storefronts') {
          if (game.peds) game.peds.furniture = null;
          game.crowd?.refreshFurniture?.(j.region);
        }
        (out.report.late = out.report.late || []).push([j.part, j.set, ms, +(performance.now() / 1000).toFixed(1)]); console.log('[streets] ' + j.part + ' of ' + j.set + ' built after ready in ' + ms + ' ms'); } catch (e) { console.log('[streets] late ' + j.part + ' of ' + j.set + ' FAILED: ' + (e && e.message)); } await sl(400); };
      /* tiles lane (helper cost), Nov 15: of the areas in reach the NEAREST to the camera is built first, layer by layer as before (the queue is in the map's area order: on nine areas `west`, 343 m from the spawn, waited behind north, east and ne). ?latenear=0 = the map's order. */
      if (!(game.P && game.P.get('latenear') === '0')) { const dist = (name) => { const b = plays[name], c = game.world && game.world.camera && game.world.camera.position; if (!b || !c) return 0; const x = c.x, y = -c.z; return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3])); };
        const find0 = pend.findIndex.bind(pend); pend.findIndex = (f) => { let best = -1, bp = null, bd = 1e18; for (let i = 0; i < pend.length; i++) { const j = pend[i]; if (!f(j)) continue; if (bp === null) bp = j.part; if (j.part !== bp) break; const d = dist(j.set); if (d < bd) { bd = d; best = i; } } return best; }; }
      out.latePending = pend.length; for (;;) { const i = pend.findIndex((j) => near(j.set)); if (i < 0) break; await run1(pend.splice(i, 1)[0]); out.latePending = pend.length; }
      if (pend.length) (async () => { while (pend.length) { const i = pend.findIndex((j) => near(j.set)); if (i < 0) { await sl(500); continue; } await run1(pend.splice(i, 1)[0]); out.latePending = pend.length; } })(); })(); }
  // lead, Nov 12 (CHIEF: no solid trunk in a traffic lane): a tree's collision circle that stands in a lane is switched off (5 of 1414 on the 19:25 build); the streets lane moves or drops those trees
  try { const st = game.statics, rd = game.roads; let n = 0; if (st && st.circ && rd && rd.inLane) for (const a of st.circ.values()) for (const c of a) if (c.tag === 'tree' && c.on && rd.inLane(c.x, c.y, c.r)) { c.on = false; n++; } if (n) console.log('[streets] ' + n + ' tree trunks in a traffic lane made passable'); out.report.trunksInLane = n; } catch (e) {}
  return out;
}
