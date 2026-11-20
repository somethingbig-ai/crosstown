// water.js (tiles lane, Nov 15): the water of a city that lists it. city.water = [{ name, level, poly, shore, cut }] is written by
// lanes/tiles/tools/city_water.py (the East River on the six-area map); a city without the list builds nothing here and is drawn as before.
//   poly  = the water's outline in map metres (x east, y north); shore = the open line of the shore, south to north, WATER ON ITS RIGHT;
//   level = the height of the surface (street = 0); cut = the sidewalk blocks that reach over the water, with the water taken out.
// streets/ground.js (built once per map area) calls three things:
//   cutBlocks(whole city, the area's blocks)  -> the blocks to draw the sidewalk from (the data's blocks stay as they are);
//   landBase(whole city, region)              -> the road's base quad with the water cut out of it (null = no water in this region);
//   waterInit(game, region, areas)            -> ONCE, in the first area's call (at load): the water surface, the sea wall along the shore and the wall in
//       game.statics for EVERY area (a player set down at the shore before that area's streets are built must not walk onto the river), and the ground of
//       the tile sets' own models (tiles.js) is trimmed: an area whose streets are not built yet shows its model's ground, whose road quad reaches 750 m
//       into the neighbours and lay over their water (seen in the players' order, runs/water9). Triangles across the shore are cut along it (trimModel).
// The surface is a plain MeshStandardMaterial: the sun and the sky's environment map light it, a slow ripple bends its normal. It does NOT read the
// ground lightmap (so nothing of the street shadow picture can land on it). heli/heli.js reads city.water itself for the helicopter's ground.
import * as THREE from 'three';

const BIG = 1e5, COPE_W = 1.2, COPE_TOP = 0.45;     // the sea wall's coping: 1.2 m wide, 0.45 m above the road (0.3 above the sidewalk). The cut sidewalk ends 0.9 m from the shore line (water[].inset), so its kerb and gutter end inside the coping
export const waterOf = (city) => (city && Array.isArray(city.water) && city.water.length ? city.water : null);
function box(w) { if (!w._bb) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of w.poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } Object.defineProperty(w, '_bb', { value: [x0, y0, x1, y1], enumerable: false }); } return w._bb; }
// the outline's edges sorted into bands of y, 32 m each (a point is tested against the few edges of its band: the test runs for every triangle of a model's ground)
const BAND = 32;
function bands(w) { if (!w._bands) { const b = box(w), n = Math.max(1, Math.ceil((b[3] - b[1]) / BAND)), B = []; for (let k = 0; k < n; k++) B.push([]); const at = (y) => Math.max(0, Math.min(n - 1, Math.floor((y - b[1]) / BAND))), P = w.poly;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], c = P[j]; for (let k = at(Math.min(a[1], c[1])), k1 = at(Math.max(a[1], c[1])); k <= k1; k++) B[k].push(a[0], a[1], c[0], c[1]); }
    Object.defineProperty(w, '_bands', { value: B, enumerable: false }); } return w._bands; }
// the water a point stands in (its entry), or null
export function waterAt(city, x, y) {
  const W = waterOf(city); if (!W) return null;
  for (const w of W) { const b = box(w); if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; const B = bands(w), E = B[Math.min(B.length - 1, Math.floor((y - b[1]) / BAND))]; let inside = false;
    for (let o = 0; o < E.length; o += 4) { const ax = E[o], ay = E[o + 1], cx = E[o + 2], cy = E[o + 3]; if ((ay > y) !== (cy > y) && x < ((cx - ax) * (y - ay)) / (cy - ay) + ax) inside = !inside; }      // the same crossing test as geo.js pointInPoly, on the edges of this band of y only
    if (inside) return w; }
  return null;
}
// a polygon cut to a rectangle [x0, y0, x1, y1] (Sutherland-Hodgman: the rectangle is convex, the polygon need not be)
function clip(poly, r) {
  let P = poly; const side = [[0, 1, r[0]], [0, -1, r[2]], [1, 1, r[1]], [1, -1, r[3]]];
  for (const [ax, sg, v] of side) { const inn = (p) => sg * (p[ax] - v) >= 0, out = [];
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ia = inn(a), ib = inn(b);
      if (ia) out.push(a); if (ia !== ib) { const t = (v - a[ax]) / (b[ax] - a[ax]), q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; q[ax] = v; out.push(q); } }
    P = out; if (P.length < 3) return []; }
  const o = []; for (const p of P) { const l = o[o.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-4) o.push(p); }
  if (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 1e-4) o.pop();
  return o.length > 2 ? o : [];
}
// a flat mesh geometry over a polygon at height h, facing up; uv = the place in the rectangle r
function flat(poly, h, r) {
  const c = poly.map((p) => new THREE.Vector2(p[0], p[1])), tris = THREE.ShapeUtils.triangulateShape(c, []), P = [], N = [], UV = [];
  for (const t of tris) { let [a, b, d] = [poly[t[0]], poly[t[1]], poly[t[2]]]; if ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0) [b, d] = [d, b];
    for (const p of [a, b, d]) { P.push(p[0], h, -p[1]); N.push(0, 1, 0); UV.push((p[0] - r[0]) / (r[2] - r[0]), (p[1] - r[1]) / (r[3] - r[1])); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
// the land west of a shore line, as one ring: the line, closed far to the north, west and south
const landRing = (w) => { const s = w.shore, a = s[0], b = s[s.length - 1]; return w.land === 'east' ? s.concat([[b[0], -BIG], [BIG, -BIG], [BIG, BIG], [a[0], BIG]]) : s.concat([[b[0], BIG], [-BIG, BIG], [-BIG, -BIG], [a[0], -BIG]]); };     /* (helper west) land: 'east' = a west shore (the Hudson): its line runs north to south, the land is closed far to the EAST */

// the sidewalk blocks of one area with the water taken out: a block the data lists in water[].cut is replaced by its first part, its other parts are added at the end
export function cutBlocks(whole, blocks) {
  const W = waterOf(whole); if (!W) return blocks; const by = new Map(); for (const w of W) for (const c of w.cut || []) { const b = whole.blocks[c.block]; if (b) by.set(b, c.parts || []); }
  if (!by.size) return blocks; const more = [], out = blocks.map((b) => { const p = by.get(b); if (!p) return b; for (let i = 1; i < p.length; i++) more.push(p[i]); return p[0] || { ext: [], holes: [] }; });
  return out.concat(more).filter((b) => b.ext.length > 2);
}
// the road's base over a region [x0, y0, x1, y1] with the water cut out; null where the region has no water (the caller keeps its plain quad)
export function landBase(whole, r) {
  const W = waterOf(whole); if (!W) return null; const w = W.find((q) => q.shore && clip(q.poly, r).length); if (!w) return null;
  const land = clip(landRing(w), r); return land.length ? flat(land, 0, r) : new THREE.BufferGeometry();
}
let MAT = null;
function materials() {
  if (MAT) return MAT; const uT = { value: 0 };
  // deep river water: dark green-blue under its own colour, the sky in it at a low angle (the environment map), the sun's glitter from the ripple
  const water = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.013, 0.026, 0.028), roughness: 0.16, metalness: 0, envMapIntensity: 1.0 });
  water.onBeforeCompile = (sh) => { sh.uniforms.uWaT = uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vWaP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vWaP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWaP; uniform float uWaT;
      // slope of a travelling wave: direction d (unit), length L metres, steepness s, speed c m/s; faded where it is smaller than a few pixels
      vec2 waS(vec2 p, vec2 d, float L, float s, float c, float dv) { float k = 6.2832 / L; return d * (s * cos(dot(p, d) * k + uWaT * c * k) / (1.0 + dv * 0.012 / L)); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 p = vWaP.xz; float dv = length(cameraPosition - vWaP);
        p += 2.6 * vec2(sin(p.y * 0.047 + uWaT * 0.05), sin(p.x * 0.039 - uWaT * 0.04)) + 0.7 * vec2(sin(p.y * 0.23 + 1.3), sin(p.x * 0.19));      // the crests bend: no ruled lines seen from the air
        vec2 g = waS(p, vec2(0.82, 0.57), 17.0, 0.030, 1.1, dv) + waS(p, vec2(-0.38, 0.92), 7.3, 0.040, 0.8, dv) + waS(p, vec2(0.96, -0.28), 3.1, 0.050, 0.6, dv)
               + waS(p, vec2(-0.71, -0.70), 1.37, 0.055, 0.45, dv) + waS(p, vec2(0.26, 0.97), 0.61, 0.050, 0.35, dv);
        normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz); }`); };
  water.customProgramCacheKey = () => 'tilesWater1';
  const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.36, 0.35, 0.33), roughness: 0.93, metalness: 0 });     // weathered concrete
  return (MAT = { water, wall, uT });
}
// the pieces of a shore line that lie in a region, each a run of points (cut at the region's edge)
function shoreRuns(w, r) {
  const runs = [], inn = (p) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3], s = w.shore; let cur = null;
  const cross = (a, b) => { let t0 = 0, t1 = 1; const d = [b[0] - a[0], b[1] - a[1]];      // the part of a-b inside the rectangle (Liang-Barsky)
    for (const [pp, q] of [[-d[0], a[0] - r[0]], [d[0], r[2] - a[0]], [-d[1], a[1] - r[1]], [d[1], r[3] - a[1]]]) { if (pp === 0) { if (q < 0) return null; } else { const t = q / pp; if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; } } }
    return [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]]; };
  for (let i = 0; i + 1 < s.length; i++) { const a = s[i], b = s[i + 1], c = cross(a, b); if (!c || Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 1e-3) { cur = null; continue; }
    if (!cur || !inn(a)) { cur = [c[0]]; runs.push(cur); } cur.push(c[1]); if (!inn(b)) cur = null; }
  return runs;
}
// the water surface, the sea wall and the solid wall of one region. Returns { water: m2 drawn, wall: metres, segs: wall segments in game.statics }
export function addWater(game, group, r) {
  const W = waterOf(game.city), rep = { water: 0, wall: 0, segs: 0 }; if (!W) return null; const M = materials(), st = game.statics;
  for (const w of W) {
    const part = clip(w.poly, r); if (!part.length) continue; const lvl = w.level === undefined ? -1.6 : w.level;
    const sm = new THREE.Mesh(flat(part, lvl, r), M.water); sm.name = 'water'; sm.receiveShadow = false; sm.matrixAutoUpdate = false; sm.onBeforeRender = () => { M.uT.value = performance.now() / 1000; }; group.add(sm);
    // The surface writes NO depth and is drawn after every other solid thing (nothing lies under it: the road's base is cut at the shore). The page's contact-shade pass
    // (world.gtao, made from the depth picture at half size) drew dark bands and pale rectangles on this flat mirror-dark plane seen at a low angle: with the pass off, or with
    // the water out of the depth picture, they are gone (lanes/tiles/runs/late2/why.out). The game switches that pass off by itself when the frame rate sags, which is why the
    // rectangles came and went. To the passes that read depth the water is now as far as the sky. ?waterao=1 = as before.
    if (!(game.P && game.P.get && game.P.get('waterao') === '1')) { M.water.depthWrite = false; sm.renderOrder = 40; }
    { let a = 0; for (let i = 0; i < part.length; i++) { const p = part[i], q = part[(i + 1) % part.length]; a += p[0] * q[1] - q[0] * p[1]; } rep.water += Math.round(Math.abs(a) / 2); }
    if (!w.shore) continue;
    // the sea wall: a coping on the land side of the shore line, its face down into the water, and a wall no one walks or drives through at its land side
    const P = [], N = [], quad = (a, b, c, d, n) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) N.push(...n); };
    for (const run of shoreRuns(w, r)) {
      // the land side is on the LEFT of the line's direction: every point pushed left by the coping's width
      const un = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };      // the left normal of a-b
      const L = run.map((p, i) => { const n1 = un(run[Math.max(0, i - 1)], i ? p : run[1]), n2 = un(i < run.length - 1 ? p : run[i - 1], run[Math.min(run.length - 1, i + 1)]); let bx = n1[0] + n2[0], by = n1[1] + n2[1]; const l = Math.hypot(bx, by) || 1; bx /= l; by /= l;
        const k = COPE_W / Math.max(0.34, bx * n1[0] + by * n1[1]); return [p[0] + bx * k, p[1] + by * k]; });      // a true mitre: the line stays COPE_W from both segments (to three widths at a sharp corner)
      for (let i = 0; i + 1 < run.length; i++) { const a = run[i], b = run[i + 1], la = L[i], lb = L[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-3) continue; const dx = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
        const V = (p, h) => [p[0], h, -p[1]];
        quad(V(a, COPE_TOP), V(a, lvl - 0.6), V(b, lvl - 0.6), V(b, COPE_TOP), [dy, 0, dx]);      // the face over the water (its normal points to the water: right of the direction, (dy, -dx) on the map)
        quad(V(a, COPE_TOP), V(b, COPE_TOP), V(lb, COPE_TOP), V(la, COPE_TOP), [0, 1, 0]);        // the top
        quad(V(la, 0), V(la, COPE_TOP), V(lb, COPE_TOP), V(lb, 0), [-dy, 0, -dx]);                 // the face to the land
        // solid: the coping's land side, AND the shore line itself (where the shore turns sharply in less than two widths the offset line crosses itself and leaves a way in: the shore line never does)
        if (st) { st.addSeg(la[0], la[1], lb[0], lb[1], 0, 'shore'); st.addSeg(a[0], a[1], b[0], b[1], 0, 'shore'); rep.segs += 2; } rep.wall += l; }
    }
    if (P.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, M.wall); m.name = 'seawall'; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
  }
  rep.wall = Math.round(rep.wall); return rep.water ? rep : null;
}

// does the line a-b touch the outline of any water? (the outline's edges in the bands of y the line passes)
function crossesShore(city, x1, y1, x2, y2) {
  const W = waterOf(city); if (!W) return false; const lo = Math.min(y1, y2), hi = Math.max(y1, y2), xl = Math.min(x1, x2), xh = Math.max(x1, x2);
  const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  for (const w of W) { const b = box(w); if (xh < b[0] || xl > b[2] || hi < b[1] || lo > b[3]) continue; const B = bands(w), k0 = Math.max(0, Math.min(B.length - 1, Math.floor((lo - b[1]) / BAND))), k1 = Math.max(0, Math.min(B.length - 1, Math.floor((hi - b[1]) / BAND)));
    for (let k = k0; k <= k1; k++) { const E = B[k]; for (let o = 0; o < E.length; o += 4) { const ax = E[o], ay = E[o + 1], cx = E[o + 2], cy = E[o + 3]; if (Math.max(ax, cx) < xl || Math.min(ax, cx) > xh || Math.max(ay, cy) < lo || Math.min(ay, cy) > hi) continue;
      const d1 = side(ax, ay, cx, cy, x1, y1), d2 = side(ax, ay, cx, cy, x2, y2), d3 = side(x1, y1, x2, y2, ax, ay), d4 = side(x1, y1, x2, y2, cx, cy); if (((d1 >= 0 && d2 <= 0) || (d1 <= 0 && d2 >= 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0))) return true; } } }
  return false;
}
// the ground of a tile set's own model (tiles.js: meshes road, sidewalk, curb, grass, marks with userData.set) where the city has water: the road quad becomes the
// set's own region with the water cut out. Of the others a triangle wholly in the water is left out and one that lies ACROSS the shore is cut along it: halved at its
// longest side until the pieces are wholly on land, wholly in the water, or under TRIM_MIN metres (those are left out: the road quad below ends exactly at the shore).
// Before (Nov 15, first version) a triangle was judged by four points, and a block's long thin triangle with all four on land kept 670 m of sidewalk over the river
// (area ne, from the shore at y -61 to x 1992: lanes/tiles/runs/late1/who.out).
const TRIM_MIN = 1.5;
export function trimModel(game, o, regions) {
  if (!o.isMesh || o.userData.set === undefined || o.userData.waterTrim) return; const k = /^(road|sidewalk|curb|grass|marks)(_\d+)?$/.exec(o.name), r = regions[o.userData.set]; if (!k || !r) return;
  o.userData.waterTrim = 1; const px = o.position.x, pz = o.position.z;
  if (k[1] === 'road') { const g = landBase(game.city, r) || flat([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], 0, r); g.translate(-px, 0, -pz); g.computeBoundingSphere(); g.computeBoundingBox(); const old = o.geometry; o.geometry = g; try { old.dispose(); } catch (e) {} return; }
  const g = o.geometry, p = g.attributes.position, W = waterOf(game.city), city = game.city; if (!p || !p.array || !p.array.length || !W) return;
  if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox; if (!W.some((w) => { const b = box(w); return bb.max.x + px >= b[0] && bb.min.x + px <= b[2] && -(bb.min.z + pz) >= b[1] && -(bb.max.z + pz) <= b[3]; })) return;
  const wx0 = Math.min(...W.map((w) => box(w)[0])), idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count, n0 = p.count, keep = [], NX = [], NY = [], from = []; let out = 0, cut = 0;
  // every attribute a plain one (a new corner is the mean of two old ones in each of them); if not, a triangle across the shore is left out whole
  const plain = Object.values(g.attributes).every((a) => a.isBufferAttribute && !a.isInterleavedBufferAttribute && a.array && a.array.length === a.count * a.itemSize) && !g.morphAttributes.position;
  const X = (i) => (i < n0 ? p.getX(i) + px : NX[i - n0]), Y = (i) => (i < n0 ? -(p.getZ(i) + pz) : NY[i - n0]), wet = (i) => !!waterAt(city, X(i), Y(i));
  const mid = (i, j) => { NX.push((X(i) + X(j)) / 2); NY.push((Y(i) + Y(j)) / 2); from.push(i, j); return n0 + NX.length - 1; };
  const piece = (a, b, c, depth) => {
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b), cx = X(c), cy = Y(c); if (Math.max(ax, bx, cx) < wx0) { keep.push(a, b, c); return; }
    const wa = wet(a), wb = wet(b), wc = wet(c), across = crossesShore(city, ax, ay, bx, by) || crossesShore(city, bx, by, cx, cy) || crossesShore(city, cx, cy, ax, ay);
    if (!wa && !wb && !wc && !across) { keep.push(a, b, c); return; }      // on land
    if (wa && wb && wc && !across) { out++; return; }                      // in the water
    const lab = Math.hypot(bx - ax, by - ay), lbc = Math.hypot(cx - bx, cy - by), lca = Math.hypot(ax - cx, ay - cy), l = Math.max(lab, lbc, lca);
    if (!plain || l < TRIM_MIN || depth > 40) { out++; return; }           // a small piece on the shore line itself
    if (!depth) cut++;
    if (l === lab) { const m = mid(a, b); piece(a, m, c, depth + 1); piece(m, b, c, depth + 1); } else if (l === lbc) { const m = mid(b, c); piece(a, b, m, depth + 1); piece(a, m, c, depth + 1); } else { const m = mid(c, a); piece(a, b, m, depth + 1); piece(m, b, c, depth + 1); }
  };
  for (let i = 0; i + 2 < n; i += 3) piece(idx ? idx[i] : i, idx ? idx[i + 1] : i + 1, idx ? idx[i + 2] : i + 2, 0);
  if (!out && !NX.length) return;
  if (NX.length) {      // the new corners, appended to every attribute; the old buffers on the graphics card (if the mesh was drawn already) are let go
    try { g.dispose(); } catch (e) {}
    for (const name of Object.keys(g.attributes)) { const a = g.attributes[name], sz = a.itemSize, arr = new a.array.constructor((n0 + NX.length) * sz), isInt = !(arr instanceof Float32Array || arr instanceof Float64Array); arr.set(a.array);
      for (let q = 0; q < NX.length; q++) { const i = from[q * 2] * sz, j = from[q * 2 + 1] * sz, t = (n0 + q) * sz; for (let c = 0; c < sz; c++) { const v = (arr[i + c] + arr[j + c]) / 2; arr[t + c] = isInt ? Math.round(v) : v; } }
      const na = new THREE.BufferAttribute(arr, sz, a.normalized); na.name = a.name; if (a.usage !== undefined) na.setUsage(a.usage); g.setAttribute(name, na); } }
  g.setIndex(keep); o.userData.waterCut = cut;
}
// once for the whole map (the first area's ground call): regions = { area name: [x0, y0, x1, y1] }, or one region for a map without areas
export function waterInit(game, wreg, sets) {
  const world = game.world; if (world.__water || !waterOf(game.city)) return null; world.__water = 1;
  const regions = {}; if (sets) for (const S of sets) regions[S.name] = S.region; else regions[''] = wreg;
  const group = new THREE.Group(); group.name = 'streets_ground_water'; const st = game.statics, own = st ? st.owner : null, rep = { water: 0, wall: 0, segs: 0, trimmed: 0 }; if (st) st.owner = null;     /* the wall belongs to no area: it stays when an area's things are taken out */
  try { for (const n in regions) { const r = addWater(game, group, regions[n]); if (r) { rep.water += r.water; rep.wall += r.wall; rep.segs += r.segs; } } } finally { if (st) st.owner = own; }
  world.scene.add(group);
  if (!(game.P && game.P.get && game.P.get('bank') === '0')) import('./bank.js').then((m) => m.bankInit(game, waterOf(game.city))).catch((e) => console.log('[water] far bank not built: ' + (e && e.message)));     /* the land and buildings across the water (bank.js; ?bank=0 off): scenery, not waited for */
  const trim = (c) => { try { c.traverse((o) => { if (o.userData && o.userData.set !== undefined && !o.userData.waterTrim) { trimModel(game, o, regions); if (o.userData.waterTrim) rep.trimmed++; } }); } catch (e) { console.log('[water] model ground not trimmed: ' + (e && e.message)); } };
  if (world.cityRoot) trim(world.cityRoot);
  const T = world.tiles; if (T) { const prev = T.onGround; T.onGround = (c) => { if (prev) prev(c); trim(c); }; }     /* a tile set that comes in later */
  return rep;
}
