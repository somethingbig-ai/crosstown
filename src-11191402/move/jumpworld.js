// move/jumpworld.js: what the jump needs to know about the drawn street that the game's collision data does not say.
//   makeHead(game): HEAD ROOM. ceil(x, y) = the underside (m above the map's zero) of the lowest drawn thing over a place, Infinity under open sky.
//     Read from what is drawn, not from a list of kinds: every instance of every instanced mesh of the street layers (shop fronts: awnings, signs,
//     marquees; furniture: sidewalk sheds, scaffolds, bus shelters, signs on poles, signal and lamp arms, umbrellas; the dressing layer: entrance
//     canopies; the lead's own props where still shown), the trees (each tree's own model: limbs and leaves), the parts of buildings that start above
//     the street (bridges, overhangs) and the parked helicopter's rotor. A triangle whose lowest point is LOW or more above zero is something overhead;
//     lower things are the game's circles and walls. Nothing is ray-cast: instances are sorted into an 8 m grid (a little each frame from the first
//     frame on, finished at once if a jump comes first), and the answer for a 0.25 m square is worked out the first time it is asked and kept.
//   classifySegs(game): LOW WALLS. Gives a top (s.jt) to the wall segments that are low street things, each found by the layer that drew it:
//     the lawn fences (streets grass: its own list of segments, height of its drawn fence), the park fence panels (streets furniture: kind 'fence',
//     height of the model's box) and the tree guards (streets trees: the guard instances' own matrices, height of the guard model's box).
//     Every other segment (buildings, shop fronts, the map edge, anything not recognised) keeps no top: a wall at every height.
//   seatTops(game): the height to stand on for furniture whose box is not its top (benches: the seat, found as the level of the model with the
//     most upward-facing area).
import * as THREE from 'three';

const LOW = 1.35, HIGH = 9, CS = 0.25, GC = 8, PRIM = 96, SHIFT = 1048576;
const _m = new THREE.Matrix4(), _id = new THREE.Matrix4();
const hyp = Math.hypot;

// the undersides of a model, in its own frame: a grid over x, z of the lowest point of every triangle that lies wholly above `low`
function rasterOf(geos, low) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0; const tris = [];
  for (const ge of geos) { const P = ge && ge.attributes && ge.attributes.position; if (!P || P.isInterleavedBufferAttribute || P.itemSize !== 3) continue; const a = P.array, ix = ge.index ? ge.index.array : null, cnt = ix ? ix.length : P.count;
    for (let t = 0; t + 2 < cnt; t += 3) { const i = (ix ? ix[t] : t) * 3, j = (ix ? ix[t + 1] : t + 1) * 3, k = (ix ? ix[t + 2] : t + 2) * 3, y = Math.min(a[i + 1], a[j + 1], a[k + 1]); if (!(y >= low)) continue;
      tris.push(a[i], a[i + 2], a[j], a[j + 2], a[k], a[k + 2], y); n++;
      x0 = Math.min(x0, a[i], a[j], a[k]); x1 = Math.max(x1, a[i], a[j], a[k]); z0 = Math.min(z0, a[i + 2], a[j + 2], a[k + 2]); z1 = Math.max(z1, a[i + 2], a[j + 2], a[k + 2]); } }
  if (!n) return null;
  const cs = 0.2, nx = Math.min(400, Math.max(1, Math.ceil((x1 - x0) / cs) + 1)), nz = Math.min(400, Math.max(1, Math.ceil((z1 - z0) / cs) + 1)), sx = Math.max(cs, (x1 - x0) / nx + 1e-6), sz = Math.max(cs, (z1 - z0) / nz + 1e-6), u = new Float32Array(nx * nz).fill(Infinity);
  const dot = (x, z, y) => { const i = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / sx))), j = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / sz))); if (y < u[j * nx + i]) u[j * nx + i] = y; };
  for (let t = 0; t < tris.length; t += 7) { const ax = tris[t], az = tris[t + 1], bx = tris[t + 2], bz = tris[t + 3], cx = tris[t + 4], cz = tris[t + 5], y = tris[t + 6];
    const q = Math.min(24, Math.max(1, Math.ceil(Math.max(hyp(bx - ax, bz - az), hyp(cx - ax, cz - az), hyp(cx - bx, cz - bz)) / (Math.min(sx, sz) * 0.5))));
    for (let i = 0; i <= q; i++) for (let j = 0; j <= q - i; j++) { const a = i / q, b = j / q; dot(ax + (bx - ax) * a + (cx - ax) * b, az + (bz - az) * a + (cz - az) * b, y); } }
  return { x0, z0, sx, sz, nx, nz, u, tris: n };
}
// a small shape's triangles (x, y, z by three), to be placed per instance
function trisOf(ge) { const P = ge.attributes.position, a = P.array, ix = ge.index ? ge.index.array : null, cnt = ix ? ix.length : P.count, o = new Float32Array(cnt * 3); for (let t = 0; t < cnt; t++) { const i = (ix ? ix[t] : t) * 3; o[t * 3] = a[i]; o[t * 3 + 1] = a[i + 1]; o[t * 3 + 2] = a[i + 2]; } return o; }
const segD2 = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = px - ax - dx * t, ez = pz - az - dz * t; return ex * ex + ez * ez; };
const pip = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

export function makeHead(game, given) {      // given: the map's own answer (statics.ceil) when the layers tag what is overhead; then nothing is sorted here
  const g = game, H = { ready: false, srcs: [], grid: new Map(), cache: new Map(), stats: { instances: 0, kept: 0, trees: 0, polys: 0, ms: 0, rasters: 0, rasterMs: 0, cells: 0, sources: 0 }, si: 0, ii: 0, started: false, fails: 0 };
  const key = (i, j) => i * 100003 + j, e = _m.elements;
  // THE LEAD'S TAGS FIRST (game.statics.overhead, src/overhead.js): sidewalk-shed decks, entrance canopies, shop awnings, shop-front boxes and raised
  // building parts whose underside is 1.2 to 3.7 m up are HIS: the probe leaves those out and asks him. The probe keeps only what he tagged nothing
  // for: trees, street furniture (signs on posts, signal heads, shelters, umbrellas, scaffold), the rotor, and anything of his kinds above 3.7 m
  // (reached from a van's roof).
  const OV = g.statics && g.statics.overhead && typeof g.statics.overhead.at === 'function' ? g.statics.overhead : null, HIS = /^(shed_deck|canopy|sf_awn|awn_.*|sf_major|sf_fine)$/, HLO = 1.2, HHI = 3.7;
  H.tags = OV ? 'statics.overhead' : null; H.stats.left = 0;
  const put = (code, x, y, r) => { for (let i = Math.floor((x - r) / GC); i <= Math.floor((x + r) / GC); i++) for (let j = Math.floor((y - r) / GC); j <= Math.floor((y + r) / GC); j++) { const k = key(i, j); let a = H.grid.get(k); if (!a) H.grid.set(k, (a = [])); a.push(code); } };
  const geoInfo = new Map();
  const infoOf = (ge) => { let I = geoInfo.get(ge.attributes.position); if (I) return I; if (!ge.boundingBox) ge.computeBoundingBox(); if (!ge.boundingSphere) ge.computeBoundingSphere(); const P = ge.attributes.position, n = (ge.index ? ge.index.count : P.count) / 3;
    I = { ge, bb: ge.boundingBox, c: ge.boundingSphere.center, r: ge.boundingSphere.radius, prim: n <= PRIM && !P.isInterleavedBufferAttribute, ok: !P.isInterleavedBufferAttribute && P.itemSize === 3, tris: null, ras: undefined }; geoInfo.set(P, I); return I; };
  // the list of what is drawn overhead (made once, when the street layers are in)
  const collect = () => { const S = H.srcs, st = g.streets && g.streets.parts, seen = new Set();
    const add = (m, shown) => { if (!m || !m.isInstancedMesh || seen.has(m) || !m.geometry || !m.geometry.attributes.position) return; seen.add(m); if (shown && !m.visible) return; if (/^(st_)?(sh_|blob|sunsh|shcast|treepit|treeguard|treefoot)/.test(m.name || '') || /^st_(sh_|blob|sunsh|treepit|treeguard)/.test((m.userData && m.userData.kind) || '')) return; const I = infoOf(m.geometry); if (I.ok) S.push({ m, I, idn: null, his: HIS.test(m.name || '') }); };
    try { if (st && st.furniture && st.furniture.meshes) for (const m of st.furniture.meshes) add(m, false); } catch (err) { H.fails++; }
    try { if (st && st.storefronts && st.storefronts.meshes) for (const m of st.storefronts.meshes) add(m, false); } catch (err) { H.fails++; }
    try { if (g.dressing && g.dressing.meshes) for (const m of g.dressing.meshes) add(m, true); } catch (err) { H.fails++; }
    try { for (const m of g.propMeshes || []) add(m, true); } catch (err) { H.fails++; }
    try { const T = st && st.trees; if (T && T.trees && T.trees.length) S.push({ trees: T.trees }); } catch (err) { H.fails++; }
    try { const P = (g.city.buildings || []).filter((b) => b.minh >= 2.5 && b.minh < HIGH + 2 && b.poly && b.poly.length > 2 && !(OV && b.minh <= HHI)); if (P.length) S.push({ polys: P }); } catch (err) { H.fails++; }
    // walk-in shops (src/interiors/): the room's ceiling, and the wall over the doorway (the front is cut open only up to the sign's lower edge)
    try { const I = g.interiors, P = []; if (I && I.shops && I.at) I.shops.forEach((Sh, i) => { const d = Sh.d, pl = Sh.plan; if (!d || !pl || !(pl.H > 1.5)) return; const q = (u, z) => I.at(i, u, z);
        P.push({ poly: [q(pl.ua, pl.zf), q(pl.ub, pl.zf), q(pl.ub, pl.zb), q(pl.ua, pl.zb)], minh: 0.15 + pl.H, shop: 1 }); if (d.sLo > 1.5) P.push({ poly: [q(d.x0 !== undefined ? d.x0 : pl.ua, 0.25), q(d.x1 !== undefined ? d.x1 : pl.ub, 0.25), q(d.x1 !== undefined ? d.x1 : pl.ub, pl.zf), q(d.x0 !== undefined ? d.x0 : pl.ua, pl.zf)], minh: 0.15 + d.sLo, shop: 1 }); });
      if (P.length) { S.push({ polys: P }); H.stats.shops = P.length; } } catch (err) { H.fails++; }
    H.stats.sources = S.length; H.started = true; };
  const mat = (s, i) => { const a = s.m.instanceMatrix.array, o = i * 16; for (let k = 0; k < 16; k++) e[k] = a[o + k]; if (s.idn === null) { s.m.updateMatrixWorld(); s.idn = s.m.matrixWorld.equals(_id); } if (!s.idn) _m.premultiply(s.m.matrixWorld); return e; };
  // one instance into the grid, if any of it can be overhead
  const index = (s, si, i) => {
    if (s.trees) { const t = s.trees[i], m = t && t.m; if (!m || !t.model) return; H.stats.trees++; put(si * SHIFT + i, m[12], -m[14], Math.min(14, (t.rad || 6) + 1)); return; }
    if (s.polys) { const b = s.polys[i]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of b.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } H.stats.polys++; put(si * SHIFT + i, (x0 + x1) / 2, (y0 + y1) / 2, hyp(x1 - x0, y1 - y0) / 2); return; }
    H.stats.instances++; mat(s, i); const sx = hyp(e[0], e[1], e[2]), sy = hyp(e[4], e[5], e[6]), sz = hyp(e[8], e[9], e[10]); if (sx + sy + sz < 1e-6) return;
    if (OV && s.his) { const b = s.I.bb; let lo = 1e9; for (let q = 0; q < 8; q++) { const y = e[1] * (q & 1 ? b.max.x : b.min.x) + e[5] * (q & 2 ? b.max.y : b.min.y) + e[9] * (q & 4 ? b.max.z : b.min.z) + e[13]; if (y < lo) lo = y; } if (lo >= HLO && lo <= HHI) { H.stats.left++; return; } }
    const I = s.I, c = I.c, wx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], wy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13], wz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14], R = I.r * Math.max(sx, sy, sz);
    if (wy + R < LOW || wy - R > HIGH) return;
    if (I.prim) { const b = I.bb; let lo = 1e9, hi = -1e9; for (let q = 0; q < 8; q++) { const y = e[1] * (q & 1 ? b.max.x : b.min.x) + e[5] * (q & 2 ? b.max.y : b.min.y) + e[9] * (q & 4 ? b.max.z : b.min.z) + e[13]; if (y < lo) lo = y; if (y > hi) hi = y; } if (hi < LOW || lo > HIGH) return; }
    else if (e[13] + I.bb.max.y * sy < LOW) return;
    H.stats.kept++; put(si * SHIFT + i, wx, -wz, R);
  };
  const count = (s) => (s.trees ? s.trees.length : s.polys ? s.polys.length : s.m.count);
  // a slice of the sorting (budget in ms); true when all of it is done
  H.work = (ms) => { if (H.ready) return true; const t0 = performance.now(); try { if (!H.started) collect();
      while (H.si < H.srcs.length) { const s = H.srcs[H.si], n = count(s); let k = 0; while (H.ii < n) { index(s, H.si, H.ii++); if ((++k & 255) === 0 && performance.now() - t0 > ms) { H.stats.ms += performance.now() - t0; return false; } } H.si++; H.ii = 0; }
    } catch (err) { H.fails++; if (H.fails < 4) console.warn('[jump] head room: ' + String((err && err.stack) || err).slice(0, 300)); H.si++; H.ii = 0; H.stats.ms += performance.now() - t0; return false; }
    H.ready = true; H.stats.ms += performance.now() - t0; H.stats.ms = +H.stats.ms.toFixed(1); return true; };
  const treeRaster = (model) => { if (model._jras !== undefined) return model._jras; const t0 = performance.now(); let r = null; try { const L = model.lods && model.lods[0], geos = []; if (L) { if (L.wg) geos.push(L.wg); if (L.bw && L.bw.attributes && L.bw.attributes.position) geos.push(L.bw); if (L.lg && L.lg.attributes && L.lg.attributes.position && L.lg.attributes.position.count < 900000) geos.push(L.lg); } r = rasterOf(geos, 1.1); } catch (err) { H.fails++; } H.stats.rasters++; H.stats.rasterMs += performance.now() - t0; return (model._jras = r); };
  const sample = (R, lx, lz) => { const i = Math.floor((lx - R.x0) / R.sx), j = Math.floor((lz - R.z0) / R.sz); if (i < 0 || j < 0 || i >= R.nx || j >= R.nz) return Infinity; return R.u[j * R.nx + i]; };
  // upright things (a turn about the vertical, a scale): the model's own grid, looked up in its frame; a square of ours can straddle four of its cells
  const upright = (R, m, px, pz, U) => { const sx2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2], sz2 = m[8] * m[8] + m[9] * m[9] + m[10] * m[10], sy = hyp(m[4], m[5], m[6]); if (!(sx2 > 1e-9) || !(sz2 > 1e-9)) return U;
    for (let q = 0; q < 5; q++) { const dx = px + (q === 1 ? CS / 2 : q === 2 ? -CS / 2 : 0) - m[12], dz = pz + (q === 3 ? CS / 2 : q === 4 ? -CS / 2 : 0) - m[14], y = sample(R, (dx * m[0] + dz * m[2]) / sx2, (dx * m[8] + dz * m[10]) / sz2); if (y < Infinity) { const w = m[13] + y * sy; if (w >= LOW - 0.25 && w < U) U = w; } } return U; };
  const TOL2 = (CS * 0.71) ** 2;
  // the answer for one 0.25 m square (centre px, py in map metres)
  const his = (px, py) => { if (!OV) return Infinity; const h = CS / 2; return Math.min(OV.at(px, py), OV.at(px + h, py + h), OV.at(px - h, py + h), OV.at(px + h, py - h), OV.at(px - h, py - h)); };
  const compute = (px, py) => { let U = his(px, py); const a = H.grid.get(key(Math.floor(px / GC), Math.floor(py / GC))); if (!a) return U; const pz = -py;
    for (const code of a) { const si = Math.floor(code / SHIFT), i = code - si * SHIFT, s = H.srcs[si];
      if (s.trees) { const t = s.trees[i], m = t.m, R = treeRaster(t.model); if (R) U = upright(R, m, px, pz, U); continue; }
      if (s.polys) { const b = s.polys[i]; if (b.minh < U && pip(px, py, b.poly)) U = b.minh; continue; }
      const I = s.I; mat(s, i);
      if (I.prim) { const T = I.tris || (I.tris = trisOf(I.ge));
        for (let t = 0; t < T.length; t += 9) { let lo = 1e9; const w = _w; for (let v = 0; v < 3; v++) { const x = T[t + v * 3], y = T[t + v * 3 + 1], z = T[t + v * 3 + 2]; w[v * 2] = e[0] * x + e[4] * y + e[8] * z + e[12]; w[v * 2 + 1] = e[2] * x + e[6] * y + e[10] * z + e[14]; const wy = e[1] * x + e[5] * y + e[9] * z + e[13]; if (wy < lo) lo = wy; }
          if (lo < LOW || lo >= U) continue;
          const d1 = (px - w[0]) * (w[3] - w[1]) - (pz - w[1]) * (w[2] - w[0]), d2 = (px - w[2]) * (w[5] - w[3]) - (pz - w[3]) * (w[4] - w[2]), d3 = (px - w[4]) * (w[1] - w[5]) - (pz - w[5]) * (w[0] - w[4]);
          if (((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) || segD2(px, pz, w[0], w[1], w[2], w[3]) < TOL2 || segD2(px, pz, w[2], w[3], w[4], w[5]) < TOL2 || segD2(px, pz, w[4], w[5], w[0], w[1]) < TOL2) U = lo; }
        continue; }
      if (I.ras === undefined) { const t0 = performance.now(); I.ras = rasterOf([I.ge], LOW - 0.25); H.stats.rasters++; H.stats.rasterMs += performance.now() - t0; }
      if (!I.ras) continue;
      const up = e[5] / (hyp(e[4], e[5], e[6]) || 1); if (up < 0.9) continue;      // (a thing knocked flat is not overhead)
      U = upright(I.ras, e, px, pz, U); }
    return U; };
  const _w = new Float32Array(6);
  H.cell = (px, py) => { if (OV && OV.builds !== H.ovb) { if (H.ovb !== undefined) H.cache.clear(); OV.at(px, py); H.ovb = OV.builds; }      /* (his list is read again when map areas come in: our kept answers go with it) */ const i = Math.floor(px / CS), j = Math.floor(py / CS), k = i * 1000003 + j; let u = H.cache.get(k); if (u === undefined) { if (!H.ready) { while (!H.work(50)) { /* a jump before the sorting was done: finished now */ } } try { u = compute((i + 0.5) * CS, (j + 0.5) * CS); } catch (err) { u = Infinity; H.fails++; if (H.fails < 4) console.warn('[jump] head room: ' + String((err && err.stack) || err).slice(0, 300)); } if (H.cache.size > 60000) H.cache.clear(); H.cache.set(k, u); H.stats.cells++; } return u; };
  // the parked helicopter's rotor: a disc over the mast (blade tips droop to about 2.45 m over its skids' ground when stopped)
  const heli = (x, y) => { const h = g.heli; if (!h || !h.f || !h.f.onGround || h.mapX === undefined) return Infinity; const d = hyp(x - h.mapX, y - h.mapY); if (d > 5.6) return Infinity; if (h.piloted) return Infinity; let z = 0; try { z = h.f.surface > 0.05 ? h.f.surface : g.statics.onSidewalk(h.mapX, h.mapY) ? 0.15 : 0; } catch (err) {} return z + 2.45 + 0.65 * (1 - d / 5.6); };
  const D = 0.2;
  H.heli = heli;
  if (given) { H.ready = true; H.given = true; H.work = () => true; H.cell = (x, y) => { const u = given(x, y); return u > 0 ? u : Infinity; }; H.ceil = (x, y) => Math.min(H.cell(x, y), H.cell(x + D, y), H.cell(x - D, y), H.cell(x, y + D), H.cell(x, y - D), heli(x, y)); return H; }
  H.ceil = (x, y) => Math.min(H.cell(x, y), H.cell(x + D, y), H.cell(x - D, y), H.cell(x, y + D), H.cell(x, y - D), heli(x, y));
  return H;
}

// ---------------------------------------------------------------------------------------------------------------- low walls
export function classifySegs(game) {
  const g = game, st = g.statics, parts = (g.streets && g.streets.parts) || {}, R = { ms: 0, lawn: 0, panel: 0, guard: 0, lawnH: 0, panelH: 0, guardH: 0, missed: { lawn: 0, panel: 0, guard: 0 }, notes: [] }, t0 = performance.now();
  if (!st || !st.segs) return R;
  const kerb = (x, y) => (st.onSidewalk(x, y) ? 0.15 : 0), c = st.cell;
  // the segment the game holds with these ends (its numbers are the layer's own, so they match to the last bit; 1 mm of slack for the guards, which we work out again)
  const find = (ax, ay, bx, by, tol) => { const a = st.segs.get(st.key(Math.floor(Math.min(ax, bx) / c), Math.floor(Math.min(ay, by) / c))); if (a) for (const s of a) if (Math.abs(s[0] - ax) <= tol && Math.abs(s[1] - ay) <= tol && Math.abs(s[2] - bx) <= tol && Math.abs(s[3] - by) <= tol) return s; return null; };
  const boxTop = (geos) => { let top = 0; for (const ge of geos) { if (!ge) continue; if (!ge.boundingBox) ge.computeBoundingBox(); if (ge.boundingBox && ge.boundingBox.max.y > top) top = ge.boundingBox.max.y; } return top; };
  // lawn fences (streets/grass.js): its own segments; height = the top of the fence it drew (posts with their finials), read from its mesh
  try { const G = parts.grass, all = []; if (G) { if (G.fenceSegs) all.push(G); if (G.sets) for (const k in G.sets) if (G.sets[k] && G.sets[k] !== G && G.sets[k].fenceSegs) all.push(G.sets[k]); }
    for (const P of all) { let h = 0; try { P.group.traverse((o) => { if (!o.isMesh || !o.geometry || !/^park_fence_/.test(o.name || '')) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b && b.max.y > h && b.max.y < 3) h = b.max.y; }); } catch (err) {}
      if (!(h > 0.3)) { h = 1.2; R.notes.push('lawn fence mesh not found: 1.2 m taken'); } R.lawnH = +h.toFixed(3);
      for (const q of P.fenceSegs) { const s = find(q[0], q[1], q[2], q[3], 0); if (s) { s.jt = h; s.jk = 'lawn'; R.lawn++; } else R.missed.lawn++; } } } catch (err) { R.notes.push('lawn: ' + String(err).slice(0, 120)); }
  // park fence panels (streets/furniture.js kind 'fence'): one segment per panel from (x, y) along its heading; height = the model's box, scaled as placed
  try { const K = parts.furniture && parts.furniture.kinds && parts.furniture.kinds.fence; if (K && K.list && K.list.length) { const top = boxTop(K.parts.map((p) => p.geometry)) * (K.scale || 1); let x1 = -1e9; for (const p of K.parts) { const b = p.geometry.boundingBox; if (b && b.max.x > x1) x1 = b.max.x; }
      for (const it of K.list) { const o = it[4], sx = o && Array.isArray(o.s) ? o.s[0] : o && typeof o.s === 'number' ? o.s : 1, sy = o && Array.isArray(o.s) ? o.s[1] : o && typeof o.s === 'number' ? o.s : 1, m = sx * 2, tx = Math.cos(it[3]), ty = Math.sin(it[3]);
        const s = find(it[0], it[1], it[0] + tx * m, it[1] + ty * m, 1e-6); if (s) { s.jt = it[2] + top * sy; s.jk = 'panel'; R.panel++; R.panelH = +(top * sy).toFixed(3); } else R.missed.panel++; } } } catch (err) { R.notes.push('panel: ' + String(err).slice(0, 120)); }
  // tree guards (streets/trees_next.js): three sides of each guard instance, worked out from its matrix as the layer did; height = the guard model's box
  try { const T = parts.trees; if (T && T.group) T.group.traverse((o) => { if (!o.isInstancedMesh || !o.userData || o.userData.kind !== 'st_treeguard' || !o.geometry) return; const ge = o.geometry; if (!ge.boundingBox) ge.computeBoundingBox(); const b = ge.boundingBox, top = b.max.y, a = o.instanceMatrix.array;
      const L = [1.5, 2.3, 3.0].reduce((p, q) => (Math.abs(q - (b.max.x - b.min.x)) < Math.abs(p - (b.max.x - b.min.x)) ? q : p), 1.5), gx = L / 2 - 0.06, gz = 1.45 / 2 - 0.06;
      for (let i = 0; i < o.count; i++) { const e = a.subarray(i * 16, i * 16 + 16), W = (lx, lz) => [e[0] * lx + e[8] * lz + e[12], -(e[2] * lx + e[10] * lz + e[14])], p = [W(-gx, gz), W(-gx, -gz), W(gx, -gz), W(gx, gz)];
        for (let q = 0; q < 3; q++) { const s = find(p[q][0], p[q][1], p[q + 1][0], p[q + 1][1], 1e-3); if (s) { if (s.jt == null) R.guard++; s.jt = e[13] + top; s.jk = 'guard'; R.guardH = +top.toFixed(3); } else R.missed.guard++; } } }); } catch (err) { R.notes.push('guard: ' + String(err).slice(0, 120)); }
  R.ms = +(performance.now() - t0).toFixed(1); return R;
}
// what every segment is, for the lane's report (not used by the game): buildings and the map edge by their own corners, shop fronts by the storefront layer's list
export function segReport(game) {
  const g = game, st = g.statics, seen = new Set(), all = []; for (const a of st.segs.values()) for (const s of a) if (!seen.has(s)) { seen.add(s); all.push(s); }
  const K = (ax, ay, bx, by) => ax + ',' + ay + ',' + bx + ',' + by, B = new Set(), S = new Set();
  for (const b of g.city.buildings) if (b.minh < 2.5) for (const poly of [b.poly].concat(b.holes || [])) for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; B.add(K(p[0], p[1], q[0], q[1])); }
  const sf = g.streets && g.streets.parts && g.streets.parts.storefronts && g.streets.parts.storefronts.solidSegs; if (sf) for (let i = 0; i < sf.length; i += 4) S.add(K(sf[i], sf[i + 1], sf[i + 2], sf[i + 3]));
  const n = { total: all.length, building: 0, shopfront: 0, lawn: 0, panel: 0, guard: 0, other: 0 }, other = [];
  for (const s of all) { if (s.jk) n[s.jk]++; else if (B.has(K(s[0], s[1], s[2], s[3]))) { n.building++; s.jk0 = 'building'; } else if (S.has(K(s[0], s[1], s[2], s[3]))) { n.shopfront++; s.jk0 = 'shopfront'; } else { n.other++; s.jk0 = 'other'; if (other.length < 12) other.push(s.slice(0, 4).map((v) => +v.toFixed(2))); } }
  return { n, other, all };
}

// ---------------------------------------------------------------------------------------------------------------- seats
// kind name -> height above the thing's own base to stand on, for kinds whose box is not their top
export function seatTops(game) {
  const out = {}; try { const F = game.streets && game.streets.parts && game.streets.parts.furniture; if (!F || !F.kinds) return out;
    for (const name of ['bench', 'benchP']) { const K = F.kinds[name]; if (!K || !K.parts) continue; const bins = new Float64Array(40), hi = new Float32Array(40);      // 2.5 cm levels from 0.2 to 1.2 m
      for (const p of K.parts) { const ge = p.geometry, P = ge && ge.attributes && ge.attributes.position; if (!P || P.isInterleavedBufferAttribute) continue; const a = P.array, ix = ge.index ? ge.index.array : null, cnt = ix ? ix.length : P.count;
        for (let t = 0; t + 2 < cnt; t += 3) { const i = (ix ? ix[t] : t) * 3, j = (ix ? ix[t + 1] : t + 1) * 3, k = (ix ? ix[t + 2] : t + 2) * 3, ux = a[j] - a[i], uy = a[j + 1] - a[i + 1], uz = a[j + 2] - a[i + 2], vx = a[k] - a[i], vy = a[k + 1] - a[i + 1], vz = a[k + 2] - a[i + 2];
          const ny = uz * vx - ux * vz, nl = hyp(uy * vz - uz * vy, ny, ux * vy - uy * vx); if (!(nl > 1e-12) || Math.abs(ny) / nl < 0.9) continue; const y = (a[i + 1] + a[j + 1] + a[k + 1]) / 3, b = Math.floor((y - 0.2) / 0.025); if (b < 0 || b >= 40) continue; bins[b] += nl / 2; const ym = Math.max(a[i + 1], a[j + 1], a[k + 1]); if (ym > hi[b]) hi[b] = ym; } }
      let best = -1; for (let b = 0; b < 40; b++) if (bins[b] > 0 && (best < 0 || bins[b] > bins[best])) best = b;
      if (best >= 0) out[name] = +(hi[best] * (K.scale || 1)).toFixed(3); }
    if (out.bench && !out.benchP) out.benchP = out.bench; if (out.benchP && !out.bench) out.bench = out.benchP;
    if (out.bench && out.benchP) out.benchP = out.bench = Math.max(out.bench, out.benchP) > 0.7 ? Math.min(out.bench, out.benchP) : out.bench;
  } catch (err) {} return out;
}
