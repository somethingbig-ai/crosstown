// pier86.js (merge2, realism round 32, Nov 19): Pier 86 without the three things that are not buildings. Two blind audits (rounds 19 and 28) scored every
// still there 3-4 of 10: 'generic tenements with fire escapes and a BAKERY / PHARMACY block stand free on the pier apron beside the carrier, one room thick'.
// The map data drew a moored submarine (id 800056) as a 36.6 m walk-up and two guessed outlines (802077 on the apron, 802078 on the carrier's deck) as
// 25 m tenements; the low museum building (801536) is real but wore the rule-made shop floor with its BAKERY / PHARMACY sign boards.
//   1. drop(): the three records leave city.buildings before anything reads it, so they are in no layer that is made from the data: collision, the map,
//      shop fronts, roof kit, crowd, helicopter. The roof kit's random draws are still made for them (kitOrder), so every other roof is as before.
//   2. rows(): their outlines join hero.js's list as cut-only rows, so their walls, trim and street-floor instances leave the tiles (and tiles that come later).
//   3. walls(): the museum's street-front walls (wall kind 0) become plain front walls (kind 1): same wall, same windows above, no shop floor, no sign boards;
//      and it is marked noshop, the mark storefronts.js already reads, so the rule-made shop fronts are not built on it.
// Only on the nine-area default map (the downtown and Battery maps hold the same pier and are left as they were), and only where a record's id AND place match.
// ?pier86=0 = as before. Nothing here is fetched: no asset is new or changed.
const DROP = [800056, 802077, 802078], PLAIN = [801536], BOX = [-1260, 2150, -1040, 2290];
const NINE = ['core', 'east', 'ne', 'ne2', 'north', 'north2', 'nw', 'nw2', 'west'].join(',');
const Q = () => new URLSearchParams(location.search);
const mid = (P) => { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; };
const here = (b) => { if (!b || !b.poly || b.poly.length < 3) return false; const [x, y] = mid(b.poly); return x > BOX[0] && x < BOX[2] && y > BOX[1] && y < BOX[3]; };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
function on(city) {
  const q = Q(); if (q.get('pier86') === '0' || q.get('hero') === '0' || (window.__CFG && window.__CFG.hero === false && q.get('hero') !== '1')) return false;     // the cut of 2 is hero.js's: without it nothing is done at all
  const s = city && city.meta && city.meta.sets; return !!s && s.map((x) => x.set).sort().join(',') === NINE;
}
// world.js, as soon as the map data is read
export function drop(city) {
  if (city.__pier86 || !on(city)) return; const st = (city.__pier86 = { cut: [], plain: [], kit: [], ids: [] }), keep = []; let prev = null;
  for (const b of city.buildings) { if (DROP.includes(b.id) && here(b)) { st.cut.push(b.poly); st.kit.push([prev, b]); st.ids.push(b.id); continue; } if (PLAIN.includes(b.id) && here(b)) { st.plain.push(b.poly); b.noshop = true; }     /* storefronts.js: no rule-made shop front on it */ keep.push(b); prev = b; }
  city.buildings = keep; console.log('[game] pier86: ' + st.ids.length + ' records out of the map data (' + st.ids.join(', ') + '), ' + st.plain.length + ' made plain');
}
// game.js, the roof kit: the list as it was, the dropped records back in their places and marked so that their units are left out after the draws
export function kitOrder(city) {
  const st = city.__pier86; if (!st || !st.kit.length) return city.buildings; const out = [], put = (p) => { for (const [prev, b] of st.kit) if (prev === p) { b.nokit = true; out.push(b); } };
  put(null); for (const b of city.buildings) { out.push(b); put(b); } return out;
}
// hero.js: cut-only rows
export function rows(city) {
  const st = city.__pier86; if (!st) return []; return st.cut.map((P, i) => ({ name: 'pier86_cut_' + st.ids[i], group: 'pier86_cut', lateCut: true, footprint: P }));
}
// world.js, after the tiles and hero.js: the museum's fronts, on every tile mesh there is and every one made later
export function walls(world) {
  const st = world.city.__pier86; if (!st || !st.plain.length) return; st.walls = 0;
  const one = (mesh) => { const geo = mesh && mesh.geometry, k3 = geo && geo.attributes.uv3, pos = geo && geo.attributes.position, ix = geo && geo.index; if (!k3 || !pos || !ix) return; if (!geo.boundingSphere) geo.computeBoundingSphere();
    mesh.updateMatrixWorld(true); const e = mesh.matrixWorld.elements, bs = geo.boundingSphere, c = bs.center, cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], cy = -(e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14]), r = bs.radius;
    if (cx + r < BOX[0] || cx - r > BOX[2] || cy + r < BOX[1] || cy - r > BOX[3]) return;
    const src = ix.array, w = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; }; let n = 0;
    const mark = new Set();     // corners first, written after: triangles of one wall share corners, and a corner already moved must not hide its neighbour
    for (let i = 0; i < src.length; i += 3) { if (k3.getX(src[i]) >= 64 || k3.getX(src[i + 1]) >= 64 || k3.getX(src[i + 2]) >= 64) continue; const a = w(src[i]), b = w(src[i + 1]), d = w(src[i + 2]);
      let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]); const l = Math.hypot(nx, nz); if (l < 1e-9) continue;     // a level face: a roof, not a wall
      nx *= 0.5 / l; nz *= 0.5 / l; const x = (a[0] + b[0] + d[0]) / 3 - nx, y = -((a[2] + b[2] + d[2]) / 3 - nz);     // half a metre in from the wall, as hero.js's cut does
      if (!st.plain.some((P) => inPoly(x, y, P))) continue; mark.add(src[i]); mark.add(src[i + 1]); mark.add(src[i + 2]); n++; }
    for (const v of mark) k3.setX(v, k3.getX(v) + 64);
    if (n) { k3.needsUpdate = true; st.walls += n; } };
  for (const m of (world.buildingMeshes || []).slice()) { try { one(m); } catch (e) { console.warn('[game] pier86: ' + (e && e.message)); } }
  const Tl = world.tiles; if (Tl && typeof Tl.mesh === 'function') { const make = Tl.mesh.bind(Tl); Tl.mesh = (T, geometry, full) => { const m = make(T, geometry, full); try { one(m); } catch (e) {} return m; }; }
  console.log('[game] pier86: ' + st.walls + ' street-front wall triangles of the museum made plain');
}
