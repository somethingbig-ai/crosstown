// streets.js: the street-level layer (lanes/streets): trees, ground, street furniture and signals, storefronts, vehicles and clutter.
// One call after the game is built:   game.streets = await (await import('./streets.js')).addStreets(game);
// Each part is its own module in ./streets/ exporting  async function add(game, ctx)  -> { group?, report? } ; a part that fails to load
// is logged and skipped, the game runs without it. opts.select: null = every part, 'a,b' = only those, '-a,b' = all but those
// (also from the url: ?streets=a,b or ?streets=-a  ; ?streets=none turns the layer off).
import * as THREE from 'three';
export const HELD = ['sidewalks', 'grass'];     /* lead, Nov 12: these two looks were kept on one-sided blind judging (CHIEF 06:3x); off until their lanes re-judge both ways. ?held=1 shows them */
export const PARTS = ['ground', 'sidewalks', 'grass', 'trees', 'storefronts', 'furniture', 'vehicles'];   // storefronts before furniture: furniture reads its shop list (game.streets.parts)
export async function addStreets(game, opts = {}) {
  let sel = opts.select ?? (game.P && game.P.get('streets')) ?? null;
  const out = { parts: {}, report: {} }; game.streets = out;   // set early: a later part may read an earlier one's result (game.streets.parts.<name> or ctx.parts)
  if (sel === 'none') return out;
  const shown = game.P && game.P.get('held') === '1' ? PARTS : PARTS.filter((p) => !HELD.includes(p)); let want = shown;
  if (sel) { const neg = sel.startsWith('-'), names = sel.replace(/^-/, '').split(','); want = (neg ? shown : PARTS).filter((p) => names.includes(p) !== neg); }
  const ctx = { THREE, A: 'assets/streets/', world: game.world, shared: game.world.shared, city: game.city, parts: out.parts };
  for (const p of want) {
    const t = performance.now();
    try { const m = await import('./streets/' + p + '.js'); out.parts[p] = (await m.add(game, ctx)) || {}; out.report[p] = Object.assign({ ms: Math.round(performance.now() - t) }, out.parts[p].report || {}); }
    catch (e) { out.report[p] = 'FAILED: ' + (e && (e.stack || e.message) || e).toString().slice(0, 400); console.log('[streets] ' + p + ' not loaded: ' + (e && e.message)); }
  }
  console.log('[streets] ' + JSON.stringify(out.report).slice(0, 900));
  return out;
}
