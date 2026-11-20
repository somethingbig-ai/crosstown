// sets.js (tiles lane): map areas as sets. A city that lists its areas (city.meta.sets = [{ set, play: [x0, y0, x1, y1] }], written by
// lanes/tiles/tools/city_sets.py) is cut here into one slice per area for the layers that build per area (lanes/tiles/CONTRACT.md).
// A thing belongs to the area its centre is in. The areas stand in columns; in a column they are stacked south to north and touch along SEAMS
// (lines y = const: the top of one area's playable box is the bottom of the next); the southmost area of a column also owns everything south
// of it, the northmost everything north, the outer columns everything west and east.
// A slice keeps the WHOLE node list (edges and signals name nodes by index) and only its own edges.
const cen = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
// the areas as cells: columns west to east (meta.seamsx = the x of every seam that runs north-south; none = one column), and in each column the
// areas south to north, each with the band of y it owns: (lo, hi]. A seam is the TOP of the area south of it (the boxes meet to a few centimetres).
function bands(m) {
  const sx = (m.seamsx || []).slice().sort((a, b) => a - b), colOf = (x) => { let c = 0; for (const v of sx) if (x > v) c++; return c; }, cols = sx.map(() => []); cols.push([]);
  for (const s of m.sets) cols[colOf((s.play[0] + s.play[2]) / 2)].push(s);
  const B = []; cols.forEach((a, c) => { a.sort((p, q) => p.play[1] - q.play[1]); a.forEach((s, i) => B.push({ s, c, lo: i === 0 ? -Infinity : a[i - 1].play[3], hi: i === a.length - 1 ? Infinity : s.play[3], xlo: c === 0 ? -Infinity : sx[c - 1], xhi: c === sx.length ? Infinity : sx[c] })); });
  B.colOf = colOf; return B;
}
const bandOf = (B, x, y) => { const c = B.colOf(x); for (let i = 0; i < B.length; i++) if (B[i].c === c && y > B[i].lo && y <= B[i].hi) return i; return 0; };
// a road edge belongs to the column its westmost point is in and, there, to the area its southmost point is in (the rule of city_sets.py)
const edgeOf = (B, e) => { let x = 1e9, y = 1e9; for (const p of e.pts) { if (p[0] < x) x = p[0]; if (p[1] < y) y = p[1]; } return bandOf(B, x, y); };
// which areas wait until after the game is ready: none for stills, films and test tools (the test hero.js uses), ?setslate=1 forces the wait, =0 forbids it
export function lateSets(game) {
  const Q = game.P, m = game.city.meta; if (!m.sets || (Q && Q.get('persets') === '0')) return null;
  const tool = !!window.__noStart || !!navigator.webdriver || (Q && (Q.has('demo') || Q.has('capture') || Q.has('shot') || Q.has('play') || Q.get('crowd') === 'none' || Q.get('peds') === '0'));
  const late = Q && Q.get('setslate') === '1' ? true : Q && Q.get('setslate') === '0' ? false : !tool; if (!late) return null;
  const pl = game.player || { x: -196, y: -214 }, B = bands(m), here = bandOf(B, pl.x, pl.y);
  return { here: B[here].s.set, far: B.filter((b, i) => i !== here).map((b) => b.s.set), edgeHere: (e) => edgeOf(B, e) === here, edgeFar: (e) => edgeOf(B, e) !== here, edgeIn: (name) => (e) => B[edgeOf(B, e)].s.set === name };     /* edgeIn(name): the edges of ONE far area (each far area is built in its own turn, when the player comes near it) */
}
export function setsOf(city) {
  if (city.__sets) return city.__sets; const m = city.meta, B = bands(m), out = [];
  B.forEach((b, bi) => { const s = b.s, mine = (x, y) => bandOf(B, x, y) === bi, by = (pts) => { const c = cen(pts); return mine(c[0], c[1]); };
    const props = {}; for (const k in city.props) props[k] = city.props[k].filter((p) => mine(p[0], p[1]));
    const slice = { meta: m, setPlay: s.play, nodes: city.nodes, edges: city.edges.filter((e) => edgeOf(B, e) === bi),
      buildings: city.buildings.filter((q) => by(q.poly)), blocks: city.blocks.filter((q) => by(q.ext)), parks: city.parks.filter((q) => by(q.ext)), marks: city.marks.filter((k) => by(k.q)),
      props, parked: city.parked.filter((p) => mine(p[0], p[1])), ped_loops: city.ped_loops.filter((l) => by(l)) };
    // region: the area's playable box pushed out to the far distance on every side where no other area lies
    const BIG = 3000, fin = Number.isFinite, r = [fin(b.xlo) ? b.xlo : s.play[0] - BIG, fin(b.lo) ? b.lo : s.play[1] - BIG, fin(b.xhi) ? b.xhi : s.play[2] + BIG, fin(b.hi) ? b.hi : s.play[3] + BIG];
    out.push({ name: s.set, play: s.play, region: r, city: slice }); });
  return (city.__sets = out);
}
