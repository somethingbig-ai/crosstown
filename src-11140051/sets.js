// sets.js (tiles lane): map areas as sets. A city that lists its areas (city.meta.sets = [{ set, play: [x0, y0, x1, y1] }], written by
// lanes/tiles/tools/city_sets.py) is cut here into one slice per area for the layers that build per area (lanes/tiles/CONTRACT.md).
// A thing belongs to the area its centre is in; with one seam (meta.seam, a line y = const) that is: north of it or not.
// A slice keeps the WHOLE node list (edges and signals name nodes by index) and only its own edges.
const cen = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
// which areas wait until after the game is ready: none for stills, films and test tools (the test hero.js uses), ?setslate=1 forces the wait, =0 forbids it
export function lateSets(game) {
  const Q = game.P, m = game.city.meta; if (!m.sets || (Q && Q.get('persets') === '0')) return null;
  const tool = !!window.__noStart || !!navigator.webdriver || (Q && (Q.has('demo') || Q.has('capture') || Q.has('shot') || Q.has('play') || Q.get('crowd') === 'none' || Q.get('peds') === '0'));
  const late = Q && Q.get('setslate') === '1' ? true : Q && Q.get('setslate') === '0' ? false : !tool; if (!late) return null;
  const pl = game.player || { x: -196, y: -214 }, hereNorth = pl.y > m.seam, edgeNorth = (e) => { let lo = 1e9; for (const p of e.pts) lo = Math.min(lo, p[1]); return lo > m.seam; };
  return { hereNorth, far: m.sets.filter((s) => ((s.play[1] + s.play[3]) / 2 > m.seam) !== hereNorth).map((s) => s.set), edgeHere: (e) => edgeNorth(e) === hereNorth, edgeFar: (e) => edgeNorth(e) !== hereNorth };
}
export function setsOf(city) {
  if (city.__sets) return city.__sets; const m = city.meta, seam = m.seam, out = [];
  for (const s of m.sets) {
    const north = (s.play[1] + s.play[3]) / 2 > seam, mine = (y) => (y > seam) === north, by = (pts) => mine(cen(pts)[1]);
    const props = {}; for (const k in city.props) props[k] = city.props[k].filter((p) => mine(p[1]));
    const slice = { meta: m, setPlay: s.play, nodes: city.nodes, edges: city.edges.filter((e) => { let lo = 1e9; for (const p of e.pts) lo = Math.min(lo, p[1]); return (lo > seam) === north; }),
      buildings: city.buildings.filter((b) => by(b.poly)), blocks: city.blocks.filter((b) => by(b.ext)), parks: city.parks.filter((b) => by(b.ext)), marks: city.marks.filter((k) => by(k.q)),
      props, parked: city.parked.filter((p) => mine(p[1])), ped_loops: city.ped_loops.filter((l) => by(l)) };
    // region: the area's playable box pushed out to the far distance on every side where no other area lies
    const BIG = 3000, r = [s.play[0] - BIG, north ? seam : s.play[1] - BIG, s.play[2] + BIG, north ? s.play[3] + BIG : seam];
    out.push({ name: s.set, play: s.play, region: r, city: slice });
  }
  return (city.__sets = out);
}
