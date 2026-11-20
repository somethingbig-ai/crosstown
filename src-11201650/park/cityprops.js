// park/cityprops.js (park lane, handoff-19, Nov 18): the CITY's kerb furniture does not stand inside Central Park.
// The city's data (city.props) carries litter bins, hydrants, parking meters and news boxes along the Drives and the transverses; the streets layer
// (streets/furniture.js) stands every one at the street's sidewalk level, and inside the park the ground is the relief: a bin stood 6 m in the air over
// West Drive's kerb. The park has its own furniture (props.js). So, as streets/trees_next.js already does for the city's trees, those four kinds are taken
// out of city.props inside the park's outline, INSET metres in (cut.js: where the park's ground takes over from the street's sidewalk), before the streets
// layer reads them: park init runs at game.js 204, addStreets at 205. The hydrants' collision circles (game.js 178, made before park init) are switched off
// with them. THE STREET LIGHTS STAY: they light the Drives at night, and lifting them onto the relief is the streets lane's (lanes/park/for-streets/).
// ?parkfaults=0 = as before.
import { INSET } from './cut.js';

export const KINDS = ['bin', 'hydrant', 'meter', 'newsbox'];

// inside the outline and at least `inset` metres from every edge of it
export function deepIn(outline, x, y, inset) {
  let c = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  if (!c) return false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < inset) return false; }
  return true;
}

export function install(game, park) {
  if (game.P && game.P.get('parkfaults') === '0') return null;
  const props = game.city && game.city.props, O = park && park.outline; if (!props || !O || !O.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of O) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const st = game.statics, out = { bin: 0, hydrant: 0, meter: 0, newsbox: 0, circles: 0 };
  for (const k of KINDS) { const a = props[k]; if (!a || !a.length) continue; const keep = [];
    for (const p of a) { if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1 || !deepIn(O, p[0], p[1], INSET)) { keep.push(p); continue; }
      out[k]++;
      if (k === 'hydrant' && st && st.circ && st.key && st.cell) { const cs = st.circ.get(st.key(Math.floor(p[0] / st.cell), Math.floor(p[1] / st.cell))); if (cs) for (const o of cs) if (o.on && o.tag === 'hydrant' && o.x === p[0] && o.y === p[1]) { o.on = false; out.circles++; } } }
    props[k] = keep; }      /* a new list, as game.js 177 makes: the old prop meshes (hidden by the streets layer) keep their own */
  park.cityProps = out; console.log('[game] park: city props dropped inside the park ' + JSON.stringify(out));
  return out;
}
