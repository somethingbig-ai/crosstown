// roofkit.js (facades lane, Nov 16; Matt: "a lot of radiators just like standing in the air"): the roof plant and the water tanks of game.js's
// "rooftop kit" stood at a random spot round the middle of the map's footprint, at the map's one height for the building. The buildings DRAWN are
// the city's real massing (set-backs, light courts, L shapes, towers on a base), so one unit in ten stood beside its building and many more stood
// over a lower tier: in the air. Now every unit sits on the roof that is drawn under it, or is not drawn:
//   - before a height is known: only units whose whole foot lies inside the footprint (and not in a court), on buildings that are drawn as tiles;
//   - as soon as the helicopter's picture of the city from above (heli.js Heights.bake, half a metre a cell, the tile meshes and hand-built
//     buildings as drawn) has a square: each unit in it is set on the level roof under its foot; if the roof there is not level (an edge, a
//     set-back, a pitched roof) it moves to the nearest level spot of its own building within 13 m; if there is none, or no roof, it is taken out.
//     A square is read again when its buildings arrive later (tiles.js sets), and its units are placed again from scratch.
// The picture is taken WITHOUT the units (they would read as roof) and they are stamped into it afterwards where they now stand, so the helicopter
// and the grapple still meet them. The item arrays (models.js userData.items [x, y, turn, scale, roof height]) are kept true: a unit taken out
// gets height -1e4. ?roofkit=0 = before.
import * as THREE from 'three';

const KINDS = ['ac', 'watertower'], TOL = 0.4, MINROOF = 2.5;
const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const edgeD = (poly, x, y) => { let d = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const ax = poly[j][0], ay = poly[j][1], dx = poly[i][0] - ax, dy = poly[i][1] - ay, l2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); d = Math.min(d, Math.hypot(ax + dx * u - x, ay + dy * u - y)); } return d; };
// the whole foot (radius r) on the building's own footprint, clear of its courts
const onOwn = (b, x, y, r) => inPoly(b.poly, x, y) && edgeD(b.poly, x, y) >= r && !(b.holes || []).some((h) => inPoly(h, x, y) || edgeD(h, x, y) < r);

export function roofKit(g, owner) {
  const recs = [], byItem = new Map(), byB = new Map(), dims = {}, _m = new THREE.Matrix4(), _b = new THREE.Box3();
  const K = { recs, stats: { units: 0, first: { shown: 0, hidden: 0 }, squares: 0, placed: 0, kept: 0, moved: 0, out: 0, noRoof: 0, dz: [] }, live: false };
  for (const im of g.propMeshes || []) { const kind = im.userData && im.userData.kind, items = im.userData && im.userData.items; if (!KINDS.includes(kind) || !items) continue;
    im.userData.rk0 = im.instanceMatrix.array.slice();
    items.forEach((p, i) => { let r = byItem.get(p); if (!r) { const b = owner.get(p); if (!b) return; r = { p, kind, b, x0: p[0], y0: p[1], h0: p[4], s: p[3] || 1, ims: [], x: p[0], y: p[1], h: p[4], on: true }; byItem.set(p, r); recs.push(r); let a = byB.get(b); if (!a) byB.set(b, (a = [])); a.push(r); } r.ims.push([im, i]);
      // the kind's real size at scale 1, from the mesh as it stands (largest over its parts): half width of the foot, height above the roof
      if (!im.geometry.boundingBox) im.geometry.computeBoundingBox(); im.getMatrixAt(i, _m); _b.copy(im.geometry.boundingBox).applyMatrix4(_m); const d = dims[kind] || (dims[kind] = { rad: 0, top: 0 });
      if (i === 0) { d.rad = Math.max(d.rad, (_b.max.x - p[0]) / r.s, (p[0] - _b.min.x) / r.s, (_b.max.z + p[1]) / r.s, (-p[1] - _b.min.z) / r.s); d.top = Math.max(d.top, (_b.max.y - p[4]) / r.s); } }); }
  for (const k of KINDS) if (dims[k]) { dims[k].rad = Math.min(Math.max(dims[k].rad * 0.8, 0.6), 4); dims[k].top = Math.min(Math.max(dims[k].top, 0.5), 12); }     /* 0.8: the box of a turned unit is wider than its foot */
  K.dims = dims; K.stats.units = recs.length;
  const dirty = new Set();
  const put = (r, on, x, y, h) => { r.on = on; if (on) { r.x = x; r.y = y; r.h = h; r.p[0] = x; r.p[1] = y; r.p[4] = h; } else { r.p[0] = r.x0; r.p[1] = r.y0; r.p[4] = -1e4; }
    for (const [im, i] of r.ims) { const a = im.instanceMatrix.array, o = im.userData.rk0, k = i * 16; for (let n = 0; n < 16; n++) a[k + n] = o[k + n];
      if (on) { a[k + 12] += x - r.x0; a[k + 13] += h - r.h0; a[k + 14] -= y - r.y0; } else for (let n = 0; n < 11; n++) a[k + n] = 0;     /* taken out: no size, in its old place (the batch's bounds stay tight) */
      dirty.add(im); } };
  const flush = () => { for (const im of dirty) { im.instanceMatrix.needsUpdate = true; im.boundingSphere = null; im.boundingBox = null; im.computeBoundingSphere(); } dirty.clear(); };
  const rad = (r) => dims[r.kind].rad * r.s;
  // before any height is known
  for (const r of recs) { const ok = !r.b.far && !r.b.noKit /* merge lane, batch 8: a building under a hero row marked "roofKit": false (hero.js) has no units */ && onOwn(r.b, r.x0, r.y0, rad(r)); put(r, ok, r.x0, r.y0, r.h0); K.stats.first[ok ? 'shown' : 'hidden']++; }
  flush();

  // ---- with the picture from above (heli.js calls this at the end of bake() with the squares it has just read)
  let H = null, grid = null;
  const raw = (x, y) => { if (!(x > H.hfX0 && x < H.hfX1 && y > H.hfY0 && y < H.hfY1)) return -1; const k = Math.floor((y - H.hfY0) / H.hfSq) * H.hfTX + Math.floor((x - H.hfX0) / H.hfSq); if (!H.hfDone[k] || !H.hf[k]) return -1; const N = H.hfN; return H.hf[k][(Math.floor((y - H.hfY0) * H.hfS) % N) * N + Math.floor((x - H.hfX0) * H.hfS) % N] * 0.1; };
  // the level roof under a foot of radius q at (x, y): its height, or -1 (cells of a square not read yet do not count)
  const level = (x, y, q) => { let lo = 1e9, hi = -1e9, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = raw(x + i * q, y + j * q); if (v < 0) continue; n++; if (v < lo) lo = v; if (v > hi) hi = v; } return n >= 5 && lo > MINROOF && hi - lo <= TOL ? lo : -1; };
  const clash = (r, x, y) => (byB.get(r.b) || []).some((o) => o !== r && o.on && o.done && Math.hypot(o.x - x, o.y - y) < rad(o) + rad(r) + 0.3);
  const place = (r) => { const q = rad(r) + 0.5, S = K.stats; if (r.b.noKit) { put(r, false); S.out++; return; }     /* merge lane, batch 8: as above */ let h = level(r.x0, r.y0, q);
    if (h >= 0 && !clash(r, r.x0, r.y0)) { put(r, true, r.x0, r.y0, h); S.kept++; if (S.dz.length < 20000) S.dz.push(+(r.h0 - h).toFixed(1)); return; }
    if (raw(r.x0, r.y0) >= 0 && raw(r.x0, r.y0) <= MINROOF) S.noRoof++;
    const a0 = (r.x0 * 12.9898 + r.y0 * 78.233) % 6.2832;
    for (const d of [3, 6, 9, 13]) for (let i = 0; i < 8; i++) { const x = r.x0 + Math.cos(a0 + i * 0.7854) * d, y = r.y0 + Math.sin(a0 + i * 0.7854) * d; if (!onOwn(r.b, x, y, rad(r))) continue; h = level(x, y, q); if (h >= 0 && !clash(r, x, y)) { put(r, true, x, y, h); S.moved++; return; } }
    put(r, false); S.out++; };
  const stamp = (r) => { const q = rad(r), top = Math.min(65535, Math.round((r.h + dims[r.kind].top * r.s) * 10)), N = H.hfN; for (let y = r.y - q; y <= r.y + q; y += 0.5) for (let x = r.x - q; x <= r.x + q; x += 0.5) { if (!(x > H.hfX0 && x < H.hfX1 && y > H.hfY0 && y < H.hfY1)) continue; const k = Math.floor((y - H.hfY0) / H.hfSq) * H.hfTX + Math.floor((x - H.hfX0) / H.hfSq), sq = H.hfDone[k] && H.hf[k]; if (!sq) continue; const c = (Math.floor((y - H.hfY0) * H.hfS) % N) * N + Math.floor((x - H.hfX0) * H.hfS) % N; if (sq[c] > 5 && sq[c] < top) sq[c] = top; } };
  K.squares = (heights, list) => { H = heights; if (!H || !H.hf || !list || !list.length) return;
    const sig = [H.hfX0, H.hfY0, H.hfTX, H.hfTY, H.hfSq].join(); if (!grid || grid.sig !== sig) { grid = { sig, cells: new Map() }; for (const r of recs) { if (!(r.x0 > H.hfX0 && r.x0 < H.hfX1 && r.y0 > H.hfY0 && r.y0 < H.hfY1)) continue; const k = Math.floor((r.y0 - H.hfY0) / H.hfSq) * H.hfTX + Math.floor((r.x0 - H.hfX0) / H.hfSq); let a = grid.cells.get(k); if (!a) grid.cells.set(k, (a = [])); a.push(r); } }
    if (!K.live) { K.live = true; /* from here on a unit shows only where the picture has put it */ for (const r of recs) if (r.on) put(r, false); }
    K.pass = (K.pass || 0) + 1;
    for (const k of list) { const a = grid.cells.get(k) || []; K.stats.squares++; for (const r of a) { r.done = 0; r.on = false; } for (const r of a) { r.done = K.pass; place(r); K.stats.placed++; } }
    // the units back into the picture: this square's, and those of the squares round it whose foot reaches in
    const seen = new Set(); for (const k of list) { const tx = k % H.hfTX, ty = Math.floor(k / H.hfTX); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const x = tx + i, y = ty + j; if (x < 0 || y < 0 || x >= H.hfTX || y >= H.hfTY) continue; const n = y * H.hfTX + x; if (seen.has(n)) continue; seen.add(n); for (const r of grid.cells.get(n) || []) if (r.on && r.done) stamp(r); } }
    flush(); };
  return K;
}
