// farcut.js (downtown lane, Nov 15): the far city gives way to an area's own buildings.
// far.glb is the real massing round the CORE box, drawn everywhere beyond it. When the map grew north, east and west it was left as it is: its coarse buildings stand
// inside the areas' real ones, pushed back in depth (world.js farMat), which holds where both come from the same heights. South of the core (row A) they show from the
// air as dark boxes through the real roofs. Here: once an area's tile set is in (its shells stand for every building of the area), every far triangle whose centre lies
// in that area's part of the map (the bands of sets.js) AND inside the box of the set's tiles is taken out of the far tiles' index, for good (a set never leaves).
// An area that is not fetched yet keeps its far massing: that is its skyline until the camera heads for it (tiles.js `tset`).
// Which areas: by default only those SOUTH of the core's south seam, so the nine-area map and the nine northern areas of a longer map draw exactly what they drew.
// ?farcut=all = every area of the map (for the map's owner to try), ?farcut=0 = off. world.farCutState = { sets: [[name, triangles, ms]], tris, of }.
const bands = (m) => { const sx = (m.seamsx || []).slice().sort((a, b) => a - b), colOf = (x) => { let c = 0; for (const v of sx) if (x > v) c++; return c; }, cols = sx.map(() => []); cols.push([]);
  for (const s of m.sets) cols[colOf((s.play[0] + s.play[2]) / 2)].push(s);
  const B = []; cols.forEach((a, c) => { a.sort((p, q) => p.play[1] - q.play[1]); a.forEach((s, i) => B.push({ s, c, lo: i === 0 ? -Infinity : a[i - 1].play[3], hi: i === a.length - 1 ? Infinity : s.play[3] })); });
  B.colOf = colOf; return B; };     /* = sets.js bands(): the area a point belongs to */
const bandOf = (B, x, y) => { const c = B.colOf(x); for (let i = 0; i < B.length; i++) if (B[i].c === c && y > B[i].lo && y <= B[i].hi) return i; return 0; };

export function farCut(world) {
  const Q = new URLSearchParams(location.search), mode = Q.get('farcut'), Tl = world.tiles, root = world.farRoot, meta = world.city && world.city.meta;
  if (mode === '0' || !Tl || !Tl.sets || !root || !meta || !Array.isArray(meta.sets) || !meta.sets.length) return;
  const core = meta.sets.find((s) => s.set === 'core'), B = bands(meta);
  const want = new Set(meta.sets.filter((s) => mode === 'all' || (core && s.play[3] <= core.play[1] + 1)).map((s) => s.set)); if (!want.size) return;
  const boxOf = new Map(); for (const S of Tl.sets) if (S.wbox) boxOf.set(S.set, S.wbox);     /* [x0, z0, x1, z1], z = -north */
  root.updateMatrixWorld(true); const meshes = []; let of = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.index && o.geometry.attributes.position) { meshes.push({ o, own: null, orig: null }); of += o.geometry.index.count / 3; } });
  const state = (world.farCutState = { want: [...want], sets: [], tris: 0, of }), done = new Set(), gone = new Set();
  const owners = (m) => {     // per triangle: 1 + the band its centre lies in, when that is inside the box of that area's tiles; else 0
    const g = m.o.geometry, p = g.attributes.position, ix = g.index.array, e = m.o.matrixWorld.elements, own = new Uint8Array(ix.length / 3);
    for (let t = 0, i = 0; i < ix.length; i += 3, t++) { let x = 0, z = 0; for (let q = 0; q < 3; q++) { const v = ix[i + q], X = p.getX(v), Y = p.getY(v), Z = p.getZ(v); x += e[0] * X + e[4] * Y + e[8] * Z + e[12]; z += e[2] * X + e[6] * Y + e[10] * Z + e[14]; } x /= 3; z /= 3;
      const b = bandOf(B, x, -z), wb = boxOf.get(B[b].s.set); if (wb && x >= wb[0] && x <= wb[2] && z >= wb[1] && z <= wb[3]) own[t] = b + 1; }
    m.own = own; m.orig = ix.slice(); };
  const cut = (S) => { if (!S || S.state !== 2 || !want.has(S.set) || done.has(S.set)) return; done.add(S.set); const bi = B.findIndex((b) => b.s.set === S.set), wb = boxOf.get(S.set); if (bi < 0 || !wb) return; gone.add(bi + 1);
    const t0 = performance.now(); let n = 0;
    for (const m of meshes) { const g = m.o.geometry; if (!g.boundingBox) g.computeBoundingBox(); if (!m.wb) { const bb = g.boundingBox.clone().applyMatrix4(m.o.matrixWorld); m.wb = [bb.min.x, bb.min.z, bb.max.x, bb.max.z]; }
      if (m.wb[2] < wb[0] || m.wb[0] > wb[2] || m.wb[3] < wb[1] || m.wb[1] > wb[3]) continue; if (!m.own) owners(m);
      const ix = g.index, a = ix.array, src = m.orig, own = m.own; let k = 0, mine = 0;
      for (let t = 0, i = 0; i < src.length; i += 3, t++) { if (gone.has(own[t])) { if (own[t] === bi + 1) mine++; continue; } a[k++] = src[i]; a[k++] = src[i + 1]; a[k++] = src[i + 2]; }
      if (!mine) continue; n += mine; ix.needsUpdate = true; g.setDrawRange(0, k); if (!k) m.o.visible = false; }     /* the index keeps its size (no new buffer on the card); the draw range ends at what is left */
    const ms = +(performance.now() - t0).toFixed(1); state.sets.push([S.set, n, ms]); state.tris += n; console.log('[game] far city: ' + n + ' triangles out where ' + S.set + ' stands (' + ms + ' ms)'); };
  for (const S of Tl.sets) cut(S);     // the areas of the first load
  const was = Tl.onSet; Tl.onSet = (S) => { try { cut(S); } catch (e) {} if (was) was(S); };     // an area that comes in during play (tiles.js calls this once its shells are in)
  setInterval(() => { for (const S of Tl.sets) if (S.state === 2 && want.has(S.set) && !done.has(S.set)) cut(S); }, 2000);     // and whoever was missed (a set that finished between the first load and the first frame)
}
