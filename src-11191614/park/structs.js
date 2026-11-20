// park/structs.js (park lane): the park's standing masonry other than bridges, from the data's `structures`:
//   wall      the park's perimeter wall and low retaining walls: a line, h = height above the ground on its low side (lidar), rough schist with a coping
//   building  the park's own houses (the Dairy, the Arsenal, the Carousel, the rink's house ...): the footprint raised to the lidar's roof height. A
//             plain stone block with a dark flat roof: the right mass in the right place, not yet the building itself.
// One mesh per chunk (the bridge's stone material); collision: wall segments, building edges.
import * as THREE from 'three';
import { BASE } from './ground.js';
import { material } from './bridge.js';

export function build(game, S, structures, inChunk) {
  const T = game.terrain, sg = game.statics, pos = [], col = [], STONE = [1, game.P && game.P.get('parkwall') === '0' ? 1 : 0.98, 1]      /* handoff-9: g 0.98 = a wall's or a house's stone (bridge.js material) */, ROOF = [0.98, 1, 1], group = new THREE.Group(); group.name = 'park_structs'; let nw = 0, nb = 0;
  const quad = (a, b, c, d, k) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); col.push(k[0], k[1], k[2]); } };
  for (const s of structures || []) {
    if (s.kind === 'wall' && s.line && s.line.length > 1) { const h = Math.max(0.5, Math.min(2.4, s.h || 1.1)), t = 0.24; if (!inChunk(s.line[0][0], s.line[0][1])) continue; nw++;
      for (let k = 0; k + 1 < s.line.length; k++) { const A = s.line[k], B = s.line[k + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.05) continue; const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, n = Math.max(1, Math.round(L / 2));
        sg.addSeg(A[0], A[1], B[0], B[1], h, 'wall');
        for (let q = 0; q < n; q++) { const a = [A[0] + (B[0] - A[0]) * q / n, A[1] + (B[1] - A[1]) * q / n], b = [A[0] + (B[0] - A[0]) * (q + 1) / n, A[1] + (B[1] - A[1]) * (q + 1) / n];
          const g = (p, o) => T.ground(p[0] - uy * o, p[1] + ux * o), za = Math.min(g(a, t), g(a, -t)), zb = Math.min(g(b, t), g(b, -t)), top = (p, z) => z + h;
          const P = (p, o, z) => [p[0] - uy * o, BASE + z, -(p[1] + ux * o)];
          quad(P(b, t, zb - 0.4), P(a, t, za - 0.4), P(a, t, top(a, za)), P(b, t, top(b, zb)), STONE); quad(P(a, -t, za - 0.4), P(b, -t, zb - 0.4), P(b, -t, top(b, zb)), P(a, -t, top(a, za)), STONE);
          quad(P(a, t + 0.04, top(a, za)), P(a, -t - 0.04, top(a, za)), P(b, -t - 0.04, top(b, zb)), P(b, t + 0.04, top(b, zb)), STONE);
          if (q === 0 && k === 0) quad(P(a, t, za - 0.4), P(a, -t, za - 0.4), P(a, -t, top(a, za)), P(a, t, top(a, za)), STONE);
          if (q === n - 1 && k === s.line.length - 2) quad(P(b, -t, zb - 0.4), P(b, t, zb - 0.4), P(b, t, top(b, zb)), P(b, -t, top(b, zb)), STONE); } } }
    else if (s.kind === 'building' && s.ring && s.ring.length > 3) { const r = s.ring; let cx = 0, cy = 0, lo = 1e9; for (const p of r) { cx += p[0] / r.length; cy += p[1] / r.length; lo = Math.min(lo, T.ground(p[0], p[1])); } if (!inChunk(cx, cy)) continue; nb++;
      const base = s.base !== undefined ? Math.min(s.base, lo) : lo, top = (s.base !== undefined ? s.base : lo) + Math.max(2.5, s.h || 4);
      let area = 0; for (let k = 0; k + 1 < r.length; k++) area += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; const ccw = area > 0;
      for (let k = 0; k + 1 < r.length; k++) { const A = ccw ? r[k] : r[k + 1], B = ccw ? r[k + 1] : r[k]; sg.addSeg(A[0], A[1], B[0], B[1], 6, 'wall');
        quad([A[0], BASE + base - 0.5, -A[1]], [B[0], BASE + base - 0.5, -B[1]], [B[0], BASE + top, -B[1]], [A[0], BASE + top, -A[1]], STONE); }
      const sh = new THREE.Shape(r.slice(0, -1).map((p) => new THREE.Vector2(p[0], p[1]))), g = new THREE.ShapeGeometry(sh), ix = g.index.array, pp = g.attributes.position;
      for (let k = 0; k < ix.length; k += 3) { const v = [ix[k], ix[k + 1], ix[k + 2]].map((i) => [pp.getX(i), BASE + top, -pp.getY(i)]); for (const q of v) { pos.push(q[0], q[1], q[2]); col.push(ROOF[0], ROOF[1], ROOF[2]); } } g.dispose(); }
  }
  if (pos.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(game, S)); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'park_structs'; group.add(mesh); }
  group.userData.n = { walls: nw, buildings: nb };
  return group;
}
