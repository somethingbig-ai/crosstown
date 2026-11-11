// entry/doorsplit.js: which triangles of a car's merged body geometry are the driver's door. Pure arrays (also run in node by
// lanes/gameplay/entry/tools/doorcheck.mjs). What it knows: the source model's door as loose triangles (assets/entry/doors.bin, from the
// openx-assets sources, where every door is its own part) and its box. A triangle of the game's body is door when
//   (b) all three of its corners lie on the source door's surface (within `eps`), or
//   (a) it belongs to an island of triangles (vertices welded by position) that lies wholly inside the door's box and near the door's
//       surface: the things the streets lane added on a door (shut-line grooves, cab lettering).
// Rule (b) also cuts a door out of a body whose skin is one welded piece (the generic sedan, the hatchback, the big van).
//   DoorField(tris Int16Array mm, box) -> .dist(x, y, z, cap) distance to the door surface in metres (cap = the most that matters)
//   splitDoor(pos, idx, field, box, opt) -> { tri: Uint8Array per triangle, n, islands }
export class DoorField {
  constructor(tris, cell = 0.06) {
    const n = tris.length / 9; this.n = n; this.t = new Float32Array(tris.length); for (let i = 0; i < tris.length; i++) this.t[i] = tris[i] / 1000; this.cell = cell; this.grid = new Map();
    const t = this.t, pad = 0.021;
    for (let k = 0; k < n; k++) { const o = k * 9; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; for (let c = 0; c < 3; c++) { const x = t[o + c * 3], y = t[o + c * 3 + 1], z = t[o + c * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      for (let i = Math.floor((x0 - pad) / cell); i <= Math.floor((x1 + pad) / cell); i++) for (let j = Math.floor((y0 - pad) / cell); j <= Math.floor((y1 + pad) / cell); j++) for (let l = Math.floor((z0 - pad) / cell); l <= Math.floor((z1 + pad) / cell); l++) { const key = (i + 512) * 1048576 + (j + 512) * 1024 + (l + 512); let a = this.grid.get(key); if (!a) this.grid.set(key, (a = [])); a.push(k); } }
  }
  // distance from a point to the door's surface, at most `cap` (the grid is padded for caps up to 0.02)
  dist(px, py, pz, cap = 0.02) {
    const c = this.cell, a = this.grid.get((Math.floor(px / c) + 512) * 1048576 + (Math.floor(py / c) + 512) * 1024 + (Math.floor(pz / c) + 512)); if (!a) return cap;
    const t = this.t; let best = cap * cap;
    for (let q = 0; q < a.length; q++) { const o = a[q] * 9, d = ptTri2(px, py, pz, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5], t[o + 6], t[o + 7], t[o + 8]); if (d < best) best = d; }
    return Math.sqrt(best);
  }
}
// squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5)
function ptTri2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else { const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else { const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else { const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else { const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
          else { const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; } } } } } }
  const dx = px - qx, dy = py - qy, dz = pz - qz; return dx * dx + dy * dy + dz * dz;
}
export function splitDoor(pos, idx, field, box, opt = {}) {
  const pad = opt.pad ?? 0.012, eps = opt.eps ?? 0.002, near = opt.near ?? 0.015, share = opt.share ?? 0.3;
  const nv = pos.length / 3, nt = idx ? idx.length / 3 : nv / 3, lo = box[0], hi = box[1];
  const V = (t, c) => (idx ? idx[t * 3 + c] : t * 3 + c);
  // only triangles with a corner in the grown box matter: weld and measure those corners only
  const inb = new Uint8Array(nv); let nin = 0; for (let i = 0; i < nv; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (x >= lo[0] - pad && x <= hi[0] + pad && y >= lo[1] - pad && y <= hi[1] + pad && z >= lo[2] - pad && z <= hi[2] + pad) { inb[i] = 1; nin++; } }
  const tri = new Uint8Array(nt); if (!nin) return { tri, n: 0, islands: 0 };
  const par = new Int32Array(nv).fill(-1), key = new Map(), Q = 2000, d = new Float32Array(nv);
  for (let i = 0; i < nv; i++) { if (!inb[i]) continue; const k = (Math.round(pos[i * 3] * Q) + 20000) * 1600000000 + (Math.round(pos[i * 3 + 1] * Q) + 20000) * 40000 + (Math.round(pos[i * 3 + 2] * Q) + 20000); const j = key.get(k); if (j === undefined) { key.set(k, i); par[i] = i; d[i] = field.dist(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0.02); } else { par[i] = j; d[i] = d[j]; } }
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const bad = new Uint8Array(nv);      // bad[root]: the island reaches outside the box
  for (let t = 0; t < nt; t++) { const a = V(t, 0), b = V(t, 1), c = V(t, 2), ia = inb[a], ib = inb[b], ic = inb[c]; if (!ia && !ib && !ic) continue;
    let r = -1; for (const v of [a, b, c]) if (inb[v]) { const f = find(v); if (r < 0) r = f; else if (f !== r) { par[f] = r; if (bad[f]) bad[r] = 1; } }
    if (!(ia && ib && ic)) bad[r] = 1; }
  const cnt = new Map(); for (let i = 0; i < nv; i++) { if (!inb[i] || par[i] < 0) continue; const r = find(i); if (bad[r]) continue; let e = cnt.get(r); if (!e) cnt.set(r, (e = [0, 0])); e[0]++; if (d[i] < near) e[1]++; }
  let n = 0; const roots = new Set();
  for (let t = 0; t < nt; t++) { const a = V(t, 0), b = V(t, 1), c = V(t, 2); if (!(inb[a] && inb[b] && inb[c])) continue;
    let on = d[a] < eps && d[b] < eps && d[c] < eps;
    if (!on) { const r = find(a), e = cnt.get(r); on = !bad[find(r)] && !!e && e[1] >= e[0] * share; if (on) roots.add(r); }
    if (on) { tri[t] = 1; n++; } }
  return { tri, n, islands: roots.size };
}
