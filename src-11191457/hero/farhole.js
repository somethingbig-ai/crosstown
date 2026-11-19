// hero/farhole.js (landmarks lane, Nov 17): the far city gives way to a hand-built landmark.
// far.glb's coarse massing stands INSIDE the real buildings north, east and west of the core, pushed back in depth (world.js farMat; see farcut.js). That holds
// while the real building is as big as the far one. A landmark model slimmer than the box it replaces (St Patrick's: Gothic nave and spires where the far set
// has a block with two square towers) left the far block standing round it as a brick shell. Here: when a hero.json row whose name starts "lm_" is in, every
// far triangle whose centre lies inside that row's footprint is taken out of the far tiles' index, for good. Nothing fetched but hero.json (already cached).
// ?farhole=0 = off. window.__farhole = { rows, tris } for a look.
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
export async function install(game) {
  const W = game.world; if (!W || !W.farRoot) return null;
  let list = []; try { list = await fetch('assets/hero/hero.json').then((r) => (r.ok ? r.json() : [])); } catch (e) { return null; }
  const rows = list.filter((h) => /^lm_/.test(h.name) && h.footprint && !h.off).map((h) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of h.footprint) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { g: h.group || h.name, P: h.footprint, x0, x1, y0, y1, done: false }; });
  const out = { rows: rows.length, tris: 0, done: 0 }; window.__farhole = out; if (!rows.length) return out;
  const cut = (ready) => { W.farRoot.updateMatrixWorld(true); W.farRoot.traverse((o) => { if (!o.isMesh || !o.geometry || !o.geometry.index) return; const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const M = o.matrixWorld, e = M.elements, c = g.boundingSphere.center, r = g.boundingSphere.radius, cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], cz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
      const near = ready.filter((q) => cx + r > q.x0 - 8 && cx - r < q.x1 + 8 && -cz + r > q.y0 - 8 && -cz - r < q.y1 + 8); if (!near.length) return;
      const pos = g.attributes.position, src = g.index.array, keep = new src.constructor(src.length); let k = 0;
      // A far block is coarse and can stand a few metres proud of the city file's outline: then a wall triangle's centre lies OUTSIDE the footprint and only the
      // roof would go (St Patrick's kept its brick walls that way). So a triangle is taken when its centre, or its centre moved 1, 3.5 or 7 m to the block's
      // inner side (against its flat normal), lies in the footprint. A neighbour's wall is safe: its inner side points away from the lot.
      const W3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i + 2 < src.length; i += 3) { let x = 0, z = 0; for (let j = 0; j < 3; j++) { const v = src[i + j], px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v), w = W3[j]; w[0] = e[0] * px + e[4] * py + e[8] * pz + e[12]; w[1] = e[1] * px + e[5] * py + e[9] * pz + e[13]; w[2] = e[2] * px + e[6] * py + e[10] * pz + e[14]; x += w[0]; z += w[2]; } x /= 3; z /= 3;
        const ux = W3[1][0] - W3[0][0], uy = W3[1][1] - W3[0][1], uz = W3[1][2] - W3[0][2], vx = W3[2][0] - W3[0][0], vy = W3[2][1] - W3[0][1], vz = W3[2][2] - W3[0][2]; let nx = uy * vz - uz * vy, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, nz); if (nl > 1e-9) { nx /= nl; nz /= nl; } else { nx = 0; nz = 0; }
        let hit = false; for (const dd of [0, 1, 3.5, 7]) { const px = x - nx * dd, py = -(z - nz * dd); if (near.some((q) => px > q.x0 && px < q.x1 && py > q.y0 && py < q.y1 && inPoly(px, py, q.P))) { hit = true; break; } if (!nl) break; }
        if (hit) { out.tris++; continue; } keep[k++] = src[i]; keep[k++] = src[i + 1]; keep[k++] = src[i + 2]; }
      if (k < src.length) { g.setIndex(new g.index.constructor(keep.slice(0, k), 1)); if (g.drawRange.count !== Infinity) g.setDrawRange(0, k); } }); };
  let n = 0; const iv = setInterval(() => { const st = W.heroState, G = (st && st.groups) || {}; n++; const ready = rows.filter((q) => !q.done && G[q.g] === 'in'); if (ready.length) { for (const q of ready) q.done = true; out.done += ready.length; try { cut(ready); } catch (e) { console.log('[farhole] ' + (e && e.message)); } }
    if (rows.every((q) => q.done || G[q.g] === 'failed') || n > 300 || (!st && n > 10)) clearInterval(iv); }, 1000);
  return out;
}
