// overhead.js (lead/h-jump, Nov 14; lanes/lead/h-jump/handover/TAGS.md): game.statics.overhead, the list of what stands OVER the street and how high its
// underside is, for the jump's head room (src/move/ reads it or not: this file only says what is there, it moves nobody).
// Each thing is a rectangle on the map with one underside height, read from the instances the layers draw (their own matrices and model boxes), so it is
// what is in the picture:  'shed' sidewalk-shed decks and 'canopy' entrance canopies (dressing.js), 'awning' shop awnings and 'shopbox' shop-front boxes:
// marquees, fascias, box signs (streets/storefronts.js), 'raised' parts of buildings that start 2.5 to 3.7 m up (city.json minh; lower ones are walls).
// Only undersides 1.2 to 3.7 m above the map's zero are kept (a 1.8 m person jumping 1.1 m from a kerb reaches 3.05).
// NOT here: tree branches (no height in any data), street furniture (signs on posts, signal heads, bus shelters), the facades lane's own awnings and
// fire escapes, the helicopter's rotor (it moves: heli/dims.js rotorR 5.345, rotorY 3.14).
// Nothing is read until the first at() / near() call (about 10 ms once); read again when the number of drawn instances changes. ?overhead=0: never fetched.
import * as THREE from 'three';

const CELL = 8, LO = 1.2, HI = 3.7;
const KIND = (name) => (name === 'shed_deck' ? 'shed' : name === 'canopy' ? 'canopy' : name === 'sf_awn' || name.startsWith('awn_') ? 'awning' : name === 'sf_major' || name === 'sf_fine' ? 'shopbox' : null);

export function install(game) {
  const st = game.statics; if (!st || st.overhead) return st && st.overhead;
  const O = { n: 0, by: {}, ms: 0, builds: 0, sig: '', grid: new Map(), t: -1e9 };
  const sources = () => { const out = []; try { for (const m of (game.dressing && game.dressing.meshes) || []) if (m.count > 0 && KIND(m.name)) out.push(m);
    const sf = game.streets && game.streets.parts && game.streets.parts.storefronts; for (const m of (sf && sf.meshes) || []) if (m.count > 0 && KIND(m.name || '')) out.push(m); } catch (e) {} return out; };
  const put = (r, x0, y0, x1, y1, kind) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) { const k = i * 100003 + j; let a = O.grid.get(k); if (!a) O.grid.set(k, (a = [])); a.push(r); } O.n++; O.by[kind] = (O.by[kind] || 0) + 1; };
  const build = (src) => { const t0 = performance.now(), M = new THREE.Matrix4(); O.grid = new Map(); O.n = 0; O.by = {};
    for (const m of src) { const ge = m.geometry, kind = KIND(m.name); if (!ge) continue; if (!ge.boundingBox) ge.computeBoundingBox(); const b = ge.boundingBox; m.updateWorldMatrix(true, false);
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M); M.premultiply(m.matrixWorld); const e = M.elements;
        let ux = e[0], uy = -e[2]; const ul = Math.hypot(ux, uy); if (ul > 1e-6) { ux /= ul; uy /= ul; } else { ux = 1; uy = 0; }      // the instance's own long axis on the map (scene x, -z)
        let lo = 1e9, a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
        for (let c = 0; c < 8; c++) { const lx = c & 1 ? b.max.x : b.min.x, ly = c & 2 ? b.max.y : b.min.y, lz = c & 4 ? b.max.z : b.min.z, X = e[0] * lx + e[4] * ly + e[8] * lz + e[12], Y = e[1] * lx + e[5] * ly + e[9] * lz + e[13], my = -(e[2] * lx + e[6] * ly + e[10] * lz + e[14]);
          const pu = X * ux + my * uy, pv = -X * uy + my * ux; if (Y < lo) lo = Y; if (pu < a0) a0 = pu; if (pu > a1) a1 = pu; if (pv < b0) b0 = pv; if (pv > b1) b1 = pv; }
        if (!(lo >= LO && lo <= HI)) continue;
        const cu = (a0 + a1) / 2, cv = (b0 + b1) / 2, hu = (a1 - a0) / 2, hv = (b1 - b0) / 2, cx = cu * ux - cv * uy, cy = cu * uy + cv * ux, ex = Math.abs(ux) * hu + Math.abs(uy) * hv, ey = Math.abs(uy) * hu + Math.abs(ux) * hv;
        put([cx, cy, ux, uy, hu, hv, lo, kind], cx - ex, cy - ey, cx + ex, cy + ey, kind); } }
    for (const bl of (game.city && game.city.buildings) || []) { if (!(bl.minh >= 2.5 && bl.minh <= HI) || !bl.poly || bl.poly.length < 3) continue; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of bl.poly) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
      const r = [(x0 + x1) / 2, (y0 + y1) / 2, 1, 0, (x1 - x0) / 2, (y1 - y0) / 2, bl.minh, 'raised']; r.poly = bl.poly; put(r, x0, y0, x1, y1, 'raised'); }      // (its rectangle is the footprint's box; r.poly is the footprint itself)
    O.ms = +(performance.now() - t0).toFixed(1); O.builds++; };
  const fresh = () => { const now = performance.now(); if (now - O.t < 2000) return; O.t = now; try { const src = sources(), sig = src.length + ':' + src.reduce((n, m) => n + m.count, 0) + ':' + ((game.city && game.city.buildings && game.city.buildings.length) || 0); if (sig !== O.sig) { O.sig = sig; build(src); } } catch (e) { if (!O.err) { O.err = String(e && e.message); console.warn('[overhead] ' + O.err); } } };
  const inside = (r, x, y) => { const dx = x - r[0], dy = y - r[1]; if (Math.abs(dx * r[2] + dy * r[3]) > r[4] || Math.abs(-dx * r[3] + dy * r[2]) > r[5]) return false; if (!r.poly) return true;
    const P = r.poly; let inn = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const p = P[i], q = P[j]; if ((p[1] > y) !== (q[1] > y) && x < ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]) + p[0]) inn = !inn; } return inn; };
  // the lowest underside over a point, metres above the map's zero; Infinity under open sky
  O.at = (x, y) => { fresh(); let c = Infinity; const a = O.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(y / CELL)); if (a) for (const r of a) if (r[6] < c && inside(r, x, y)) c = r[6]; return c; };
  // every thing whose rectangle's centre is within r of a point: [cx, cy, ux, uy, halfAlong, halfAcross, underside, kind] (ux, uy: unit vector of its long axis)
  O.near = (x, y, r) => { fresh(); const seen = new Set(), out = []; for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) { const a = O.grid.get(i * 100003 + j); if (a) for (const q of a) if (!seen.has(q) && Math.hypot(q[0] - x, q[1] - y) <= r) { seen.add(q); out.push(q); } } return out; };
  st.overhead = O; return O;
}
