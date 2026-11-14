// streets.js: the street-level layer (lanes/streets): trees, ground, street furniture and signals, storefronts, vehicles and clutter.
// One call after the game is built:   game.streets = await (await import('./streets.js')).addStreets(game);
// Each part is its own module in ./streets/ exporting  async function add(game, ctx)  -> { group?, report? } ; a part that fails to load
// is logged and skipped, the game runs without it. opts.select: null = every part, 'a,b' = only those, '-a,b' = all but those
// (also from the url: ?streets=a,b or ?streets=-a  ; ?streets=none turns the layer off).
import * as THREE from 'three';
export const HELD = ['sidewalks'];     /* lead, Nov 12: kept on one-sided blind judging (CHIEF 06:3x); off until its lane re-judges both ways. ?held=1 shows it. Grass v1 left this list in the 15:45 merge (both-sides verdict streets/grass 15:27, frozen v1cut f6d702ae); ?hold=grass (or ?hold=a,b) holds a part back again = the flat grass */
export const NEXT = { trees: 'trees_next' }, NEXT_ON = true;     /* merge 15:45 Nov 12: the streets release trees (trees_next.js = release 7cd0406d + trees_gen_next.js + the added files in assets/streets/trees) are the default: both-sides verdict streets/trees 15:37 (16 of 16), not slower at the spawn, faster at the plaza. ?treeslead=1 gives the trees of before (trees.js 53940095) */
export const PARTS = ['ground', 'sidewalks', 'grass', 'trees', 'storefronts', 'furniture', 'vehicles'];   // storefronts before furniture: furniture reads its shop list (game.streets.parts)
export async function addStreets(game, opts = {}) {
  let sel = opts.select ?? (game.P && game.P.get('streets')) ?? null;
  const out = { parts: {}, report: {} }; game.streets = out;   // set early: a later part may read an earlier one's result (game.streets.parts.<name> or ctx.parts)
  if (sel === 'none') return out;
  const heldOn = !!(game.P && game.P.get('held') === '1'), oldTrees = !!(game.P && game.P.get('treeslead') === '1'), hold = HELD.concat(((game.P && game.P.get('hold')) || '').split(',')); const shown = heldOn ? PARTS : PARTS.filter((p) => !hold.includes(p)); let want = shown;
  if (sel) { const neg = sel.startsWith('-'), names = sel.replace(/^-/, '').split(','); want = (neg ? shown : PARTS).filter((p) => names.includes(p) !== neg); }
  const ctx = { THREE, A: 'assets/streets/', world: game.world, shared: game.world.shared, city: game.city, parts: out.parts };
  for (const p of want) {
    const t = performance.now();
    try { const m = await import('./streets/' + ((heldOn || NEXT_ON) && NEXT[p] && !(p === 'trees' && oldTrees) ? NEXT[p] : p) + '.js'); out.parts[p] = (await m.add(game, ctx)) || {}; out.report[p] = Object.assign({ ms: Math.round(performance.now() - t) }, out.parts[p].report || {}); }
    catch (e) { out.report[p] = 'FAILED: ' + (e && (e.stack || e.message) || e).toString().slice(0, 400); console.log('[streets] ' + p + ' not loaded: ' + (e && e.message)); }
  }
  console.log('[streets] ' + JSON.stringify(out.report).slice(0, 900));
  // lead, Nov 12 (CHIEF: no solid trunk in a traffic lane): a tree's collision circle that stands in a lane is switched off (5 of 1414 on the 19:25 build); the streets lane moves or drops those trees
  try { const st = game.statics, rd = game.roads; let n = 0; if (st && st.circ && rd && rd.inLane) for (const a of st.circ.values()) for (const c of a) if (c.tag === 'tree' && c.on && rd.inLane(c.x, c.y, c.r)) { c.on = false; n++; } if (n) console.log('[streets] ' + n + ' tree trunks in a traffic lane made passable'); out.report.trunksInLane = n; } catch (e) {}
  return out;
}
