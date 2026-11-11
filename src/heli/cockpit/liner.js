// liner.js: what covers the shell from the pilot's eye: one skin lofted just inside the shell's own surface (read from
// model/shape.js), carrying the roof liner, pillar and windscreen-surround trim, side walls and the nose bowl, and, on a second
// skin a little further out, the inner face of the glass. Each vertex knows how far it is from the nearest window edge (aCut.x,
// metres, positive inside the glass), so the materials cut the openings and shade a rounded rubber seal per pixel, and the glass
// draws only where glass is. The pilot's door part of both skins rides the door bone.
// The window and door outlines are the shell's own formulas (model/shape.js keeps them private; copied here 2026-11-10: if the
// shell's windows move, move these). No DOM, no three.js scene objects: also runs under node for the bake.
import * as THREE from 'three';
import { GRAIN } from './geo.js';

export const LINER_IN = 0.036, GLASS_IN = 0.014;       // how far inside the shell's outer skin the trim and the glass's inner face stand

export function buildLiner(DIMS, sh, kit, doorBone = 8) {
  const { podPoint, podSect, doorFront } = sh, { roundAll, rrect } = kit, FY = DIMS.floorY;
  const W = [
    (x, y, z) => roundAll([Math.abs(z) - 0.034, y - (1.145 + 0.07 * (3.2 - x)), 3.19 - x, x - (doorFront(y) + 0.062)], 0.075),                  // windscreen
    (x, y, z) => roundAll([Math.abs(z) - 0.06, 0.935 - y, 3.10 - x, x - 2.2, 1.16 - Math.abs(z) + (y - 0.6) * 1.2], 0.08),                        // chin
    (x, y, z) => (Math.abs(z) < 0.3 ? -1 : roundAll([doorFront(y) - 0.075 - x, x - 0.335, y - 1.19, 1.925 - y], 0.095)),                          // door window
    (x, y, z) => (Math.abs(z) < 0.3 ? -1 : rrect(x, y, -0.43, 0.105, 1.19, 1.925, 0.095)),                                                       // rear window
    (x, y, z) => (y < 1.7 ? -1 : rrect(x, Math.abs(z), 0.82, 1.56, 0.10, 0.60, 0.07)),                                                           // roof window
  ];
  const doorR = (x, y, z) => (z < 0.3 ? -1 : roundAll([doorFront(y) - x, x - 0.25, y - 0.74, 1.98 - y], 0.06));
  const xs = [], NA = 132; for (let x = 3.24; x > -0.6401; x -= 0.04) xs.push(x);
  const NX = xs.length, P = [0, 0, 0], A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  // the grid: skin point, outward normal, distances
  const G = new Float32Array(NX * NA * 8);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NA; j++) {
    const x = xs[i], a = j / NA * Math.PI * 2, e = 2e-3, o = (i * NA + j) * 8;
    podPoint(x, a, P); podPoint(x + e, a, A); podPoint(x - e, a, B); podPoint(x, a + e, C); podPoint(x, a - e, D);
    let nx = (A[1] - B[1]) * (C[2] - D[2]) - (A[2] - B[2]) * (C[1] - D[1]), ny = (A[2] - B[2]) * (C[0] - D[0]) - (A[0] - B[0]) * (C[2] - D[2]), nz = (A[0] - B[0]) * (C[1] - D[1]) - (A[1] - B[1]) * (C[0] - D[0]);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; const ym = podSect(x).ym; if (nx * 0 + ny * (P[1] - ym) + nz * P[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    let d = -1e9; for (const w of W) d = Math.max(d, w(P[0], P[1], P[2]));
    G[o] = P[0]; G[o + 1] = P[1]; G[o + 2] = P[2]; G[o + 3] = nx; G[o + 4] = ny; G[o + 5] = nz; G[o + 6] = d; G[o + 7] = doorR(P[0], P[1], P[2]);
  }
  // materials by place: [colour, roughness, grain, grain scale, wear, bump]
  const col = new THREE.Color(), look = (x, y, z) => {
    if (y > 1.95) return [0x8d8b85, 0.96, GRAIN.fabric, 46, 0.35, 0.9];                 // roof liner cloth
    if (x > 2.22 && y < 1.2) return [0x1d1e20, 0.6, GRAIN.plastic, 70, 0.4, 0.5];       // nose bowl, dark so it does not mirror in the screen
    if (y < 1.17) return [0x3a3c3f, 0.66, GRAIN.plastic, 60, 0.9, 0.8];                // lower walls, scuffed
    return [0x5f6162, 0.6, GRAIN.plastic, 60, 0.6, 0.7];                               // pillars and window surrounds
  };
  const mk = (off, keep, glass) => {
    const pos = [], nor = [], colr = [], mat = [], ao = [], cut = [], si = [], idx = [], maps = [new Map(), new Map()];
    const vert = (k, side) => { const m = maps[side]; let v = m.get(k); if (v !== undefined) return v; const o = k * 8; v = pos.length / 3; m.set(k, v);
      pos.push(G[o] - G[o + 3] * off, G[o + 1] - G[o + 4] * off, G[o + 2] - G[o + 5] * off); nor.push(-G[o + 3], -G[o + 4], -G[o + 5]);
      const L = look(G[o], G[o + 1], G[o + 2]); col.set(L[0]); colr.push(col.r, col.g, col.b); mat.push(L[1], 0, L[2], L[3]); ao.push(1, L[4], L[5]);
      cut.push(G[o + 6], side ? G[o + 7] : (G[o + 2] > 0.3 ? -G[o + 7] : 1)); si.push(side ? doorBone : 0, 0, 0, 0); return v; };
    for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NA; j++) {
      const q = [i * NA + j, (i + 1) * NA + j, (i + 1) * NA + (j + 1) % NA, i * NA + (j + 1) % NA];
      for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        const d = t.map((k) => G[k * 8 + 6]), y = t.map((k) => G[k * 8 + 1]), dr = t.map((k) => G[k * 8 + 7]);
        if (!keep(d, y)) continue;
        const inDoor = dr.some((v) => v > 0), outDoor = dr.some((v) => v <= 0);
        for (const side of [0, 1]) { if (side ? !inDoor : !outDoor) continue;
          const v = t.map((k) => vert(k, side));
          // face the cabin: winding against the stored inward normal
          const a = v[0] * 3, b = v[1] * 3, c = v[2] * 3, ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
          const fn = (uy * vz - uz * vy) * nor[a] + (uz * vx - ux * vz) * nor[a + 1] + (ux * vy - uy * vx) * nor[a + 2];
          if (fn >= 0) idx.push(v[0], v[1], v[2]); else idx.push(v[0], v[2], v[1]); }
      }
    }
    const g = new THREE.BufferGeometry(), n = pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aCut', new THREE.Float32BufferAttribute(cut, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); const sw = new Float32Array(n * 4); for (let i = 0; i < n; i++) sw[i * 4] = 1; g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!glass) { g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 4)); g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); }
    g.setIndex(idx); g.computeBoundingSphere(); return g;
  };
  const liner = mk(LINER_IN, (d, y) => !(d[0] > 0.035 && d[1] > 0.035 && d[2] > 0.035) && !(y[0] < FY - 0.08 && y[1] < FY - 0.08 && y[2] < FY - 0.08), false);
  const glass = mk(GLASS_IN, (d) => d[0] > -0.03 || d[1] > -0.03 || d[2] > -0.03, true);
  return { liner, glass };
}
