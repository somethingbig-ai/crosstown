// park/props.js (park lane): the park's own furniture, built here because the street layer's are street kinds.
//   lamp   Central Park's post (Henry Bacon, 1907: a slim fluted cast-iron shaft on a leafed base) with the 1980s Kent Bloomer luminaire
//          (a glass lantern under a cap and finial), about 3.6 m to the top.
//   bench  the 1939 World's Fair bench: wood slats (seat and back) carried on cast-iron frames whose arms are full hoops; 1.8 m long.
//   bin    the park's slatted green litter basket.
// One InstancedMesh per kind per chunk; each lamp and bench is a collision circle owned by the chunk.
import * as THREE from 'three';
import { lit, merged } from './mat.js';
import { BASE } from './ground.js';

let KIT = null;
function kit(game) {
  if (KIT) return KIT; const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  const IRON = [0.012, 0.016, 0.013], GLASS = [0.20, 0.21, 0.19]      /* critic r1, Nov 16: the lanterns read as small white globes by day (was 0.75, 0.72, 0.60) */, WOOD = [0.085, 0.052, 0.026], GREEN = [0.012, 0.030, 0.016];
  // lamp: lathe profiles (radius, height)
  const lathe = (pr, seg = 10) => new THREE.LatheGeometry(pr.map((p) => new THREE.Vector2(p[0], p[1])), seg);
  const post = lathe([[0.17, 0], [0.17, 0.10], [0.13, 0.16], [0.14, 0.42], [0.10, 0.50], [0.075, 0.62], [0.065, 0.9], [0.055, 2.55], [0.075, 2.62], [0.05, 2.68], [0.10, 2.80], [0.03, 2.84]]);
  const lantern = lathe([[0.03, 2.84], [0.13, 2.90], [0.20, 3.08], [0.19, 3.22], [0.13, 3.34]], 8);
  const cap = lathe([[0.15, 3.33], [0.16, 3.36], [0.08, 3.44], [0.03, 3.50], [0.035, 3.56], [0.0, 3.64]], 8);
  const lamp = merged([[post, IRON], [lantern, GLASS], [cap, IRON]]);
  // bench, long axis = x, seat faces +z
  const parts = [], box = (w, h, d, x, y, z, rx, c) => parts.push([new THREE.BoxGeometry(w, h, d), c, M(x, y, z, rx)]);
  for (let k = 0; k < 5; k++) box(1.8, 0.03, 0.075, 0, 0.43 + (k === 4 ? -0.012 : 0), -0.16 + k * 0.088, 0, WOOD);
  for (let k = 0; k < 4; k++) box(1.8, 0.03, 0.075, 0, 0.52 + k * 0.095, -0.21 - k * 0.03, 1.27, WOOD);
  for (const x of [-0.86, 0, 0.86]) { box(0.035, 0.43, 0.035, x, 0.215, 0.20, 0, IRON); box(0.035, 0.85, 0.035, x, 0.42, -0.24, -0.1, IRON); box(0.035, 0.035, 0.46, x, 0.40, -0.01, 0, IRON);
    if (x !== 0) parts.push([new THREE.TorusGeometry(0.19, 0.016, 5, 14), IRON, M(x, 0.62, 0.0, 0, Math.PI / 2, 0)]); }
  const bench = merged(parts);
  // Cover each quarter of the slats, including the rear corners, in plan view.
  bench.computeBoundingBox();
  const bounds = bench.boundingBox;
  const step = (bounds.max.x - bounds.min.x) / 4;
  const midZ = (bounds.min.z + bounds.max.z) / 2;
  const benchRadius = Math.hypot(step / 2, (bounds.max.z - bounds.min.z) / 2);
  const benchCenters = Array.from({ length: 4 }, (_, i) =>
    new THREE.Vector3(bounds.min.x + (i + 0.5) * step, 0, midZ));
  const bp = [[new THREE.CylinderGeometry(0.30, 0.25, 0.04, 12), GREEN, M(0, 0.02, 0)], [new THREE.CylinderGeometry(0.31, 0.31, 0.04, 12), GREEN, M(0, 0.86, 0)]]; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; bp.push([new THREE.BoxGeometry(0.07, 0.84, 0.012), GREEN, M(Math.cos(a) * 0.285, 0.44, Math.sin(a) * 0.285, 0, -a + Math.PI / 2, 0)]); }
  const bin = merged(bp);
  for (const g of [lamp, bench, bin]) g.userData.shared = true;
  const mat = lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }), game.world.shared, { key: 'prop',
    body: 'if (vColor.r > 0.15) pkNight = 2.72;'      /* handoff-9: the lantern glass (0.75 -> 0.20 by day, critic r1) is what the lamp pass lights into the bright globe at night: back to 0.75 as the night comes (mat.js; 1 + 1.72 x the gain 1.6 = 3.75) */ });
  KIT = { benchCenters, benchRadius, geo: { lamp, bench, bin }, mat, r: { lamp: 0.2, bench: 0.55, bin: 0.32 } };
  return KIT;
}

// build(game, props, i, j) -> group. Only props whose point lies in chunk (i, j) are built (a prop is listed once, in its own chunk).
export function build(game, props) {
  const K = kit(game), T = game.terrain, group = new THREE.Group(); group.name = 'park_props';
  const by = {}; for (const p of props || []) if (K.geo[p.kind]) (by[p.kind] = by[p.kind] || []).push(p);
  const center = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const kind in by) { const L = by[kind], im = new THREE.InstancedMesh(K.geo[kind], K.mat, L.length); im.name = 'park_' + kind; im.castShadow = kind !== 'bin'; im.receiveShadow = true;
    L.forEach((p, k) => { e.set(0, (p.h || 0) + (kind === 'bench' ? Math.PI / 2 : 0), 0); q.setFromEuler(e); v.set(p.x, BASE + T.h(p.x, p.y), -p.y); m4.compose(v, q, s); im.setMatrixAt(k, m4); if (kind === 'bench' && game.P.get('parkcol') !== '0') {
        for (const local of K.benchCenters) {
          center.copy(local).applyMatrix4(m4);
          const circle = game.statics.addParkCircle(center.x, -center.z, K.benchRadius, 'bench');
          circle.benchOwner = p;
          circle.benchAlong = (center.x - p.x) * m4.elements[0] + (center.z + p.y) * m4.elements[2];
          circle.benchDX = m4.elements[0]; circle.benchDY = -m4.elements[2];
        }
      } else if (kind === 'lamp' && game.P.get('parkcol') !== '0') game.statics.addParkCircle(p.x, p.y, K.r[kind], 'furniture');
      else game.statics.addCircle(p.x, p.y, K.r[kind], 'furniture'); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); group.add(im); }
  return group;
}
