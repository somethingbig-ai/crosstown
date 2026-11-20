// riders/ridermodel.js (people lane, Nov 15): the delivery e-bike, the insulated box and the rider, made here in code. No asset file, no maker,
// no name, no logo: generic shapes and plain colours only. Everything is drawn as instances (riders.js): one material, a paint channel per vertex
// (aPaint 0..5) and five colours per instance (aTint, a mat4: columns 0..3 = channels 1..4, the fourth row of columns 0..2 = channel 5).
// Model frame: x ahead, y up, z to the RIGHT, origin on the ground midway between the tyres. Metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);
const K = (v) => [v, v, v];
function fin(list, g, col, paint = 0) {
  if (!g.attributes.normal) g.computeVertexNormals(); if (g.index) g = g.toNonIndexed(); g.deleteAttribute('uv'); const n = g.attributes.position.count, c = new Float32Array(n * 3), p = new Float32Array(n);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; p[i] = paint; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(p, 1)); list.push(g); return g;
}
function tube(list, p0, p1, r0, col, paint = 0, r1 = r0, seg = 6) { _a.set(...p0); _b.set(...p1); const d = _b.clone().sub(_a), L = d.length() || 1e-4; const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false); _q.setFromUnitVectors(Y, d.normalize()); g.applyMatrix4(_m.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, ONE)); return fin(list, g, col, paint); }
function ball(list, c, rad, col, paint = 0, ws = 8, hs = 6) { const g = new THREE.SphereGeometry(1, ws, hs); g.applyMatrix4(_m.compose(_a.set(...c), _q.identity(), _s.set(...rad))); return fin(list, g, col, paint); }
function box(list, c, size, col, paint = 0, rz = 0, ry = 0) { const g = new THREE.BoxGeometry(size[0], size[1], size[2]); if (ry) g.rotateY(ry); g.applyMatrix4(_m.compose(_a.set(...c), _q.setFromAxisAngle(Z, rz), ONE)); return fin(list, g, col, paint); }
function merge(list) { const g = mergeGeometries(list, false); g.computeBoundingSphere(); g.boundingSphere.radius = 3; for (const x of list) x.dispose(); return g; }

export const BIKE = { seat: [-0.27, 0.9], grips: [0.31, 1.06, 0.27], pedF: [0.12, 0.3, 0.14], pedR: [-0.22, 0.3, 0.14], rack: [-0.62, 0.725], wheelbase: 1.14, R: 0.33 };

// the e-bike. mitts: bar mitts over the grips (November); else a carrier bag hangs from the bar
export function buildBike(mitts) {
  const B = [], BLK = K(0.02), RUB = K(0.028), STEEL = K(0.3), R = BIKE.R, ra = [-0.56, R, 0], fa = [0.58, R, 0];
  for (const ax of [ra, fa]) {      // the wheels are buildWheel(): they turn
    for (let i = 0; i < 6; i++) { const a0 = (ax === ra ? 0.25 : 0.75) + i * 0.36, a1 = a0 + 0.36, rr = R + 0.022; box(B, [ax[0] + Math.cos((a0 + a1) / 2) * rr, ax[1] + Math.sin((a0 + a1) / 2) * rr, 0], [0.125, 0.012, 0.075], BLK, 0, (a0 + a1) / 2 + Math.PI / 2); }      // mudguard
  }
  { const g = new THREE.CylinderGeometry(0.115, 0.115, 0.13, 12); g.rotateX(Math.PI / 2); g.translate(ra[0], ra[1], 0); fin(B, g, K(0.12)); }      // hub motor
  const bb = [-0.05, 0.3, 0], st = [-0.24, 0.8, 0], hd = [0.37, 0.84, 0], hl = [0.4, 0.7, 0];
  tube(B, bb, st, 0.026, K(1), 1); tube(B, [-0.22, 0.76, 0], hd, 0.026, K(1), 1); tube(B, bb, hl, 0.034, K(1), 1); tube(B, hl, [0.35, 0.9, 0], 0.03, K(1), 1);      // seat tube, top tube, down tube, head tube
  for (const s of [-1, 1]) { tube(B, [bb[0], bb[1], s * 0.05], [ra[0], ra[1], s * 0.085], 0.016, K(1), 1); tube(B, [-0.21, 0.72, s * 0.03], [ra[0], ra[1], s * 0.085], 0.013, K(1), 1);
    tube(B, [0.4, 0.78, s * 0.075], [fa[0], fa[1], s * 0.075], 0.027, BLK, 0, 0.022);                                                    // suspension fork
    tube(B, [-0.44, 0.71, s * 0.075], [ra[0] - 0.02, ra[1], s * 0.09], 0.008, BLK, 0, 0.008, 4); tube(B, [-0.76, 0.71, s * 0.075], [ra[0] + 0.02, ra[1], s * 0.09], 0.008, BLK, 0, 0.008, 4); }      // rack stays
  box(B, [0.4, 0.79, 0], [0.05, 0.03, 0.19], BLK);
  tube(B, st, [-0.27, 0.87, 0], 0.016, STEEL); box(B, [-0.28, 0.89, 0], [0.27, 0.06, 0.17], BLK); box(B, [-0.17, 0.885, 0], [0.1, 0.045, 0.09], BLK);      // post, saddle
  box(B, [-0.6, 0.715, 0], [0.42, 0.02, 0.17], BLK);                                                                                      // rear rack
  box(B, [0.16, 0.56, 0], [0.4, 0.13, 0.1], K(0.05), 0, Math.atan2(0.4, 0.45));                                                           // the battery on the down tube
  box(B, [0.05, 0.795, 0], [0.3, 0.085, 0.085], K(0.9), 2);                                                                              // a second, mismatched battery strapped under the top tube
  for (const u of [0.3, 0.62]) { const x = -0.22 + (hd[0] + 0.22) * u, y = 0.76 + (hd[1] - 0.76) * u; tube(B, [x - 0.03, y - 0.004, 0], [x + 0.03, y + 0.004, 0], 0.05, K(1), 2, 0.05, 6); }      // tape round battery and tube
  tube(B, [-0.02, 0.385, 0], [0.06, 0.475, 0], 0.04, K(1), 2); tube(B, [-0.2, 0.42, 0], [-0.16, 0.52, 0], 0.031, K(1), 2);              // tape on the frame
  tube(B, [0.35, 0.9, 0], [0.31, 1.05, 0], 0.017, STEEL); tube(B, [0.31, 1.06, -0.31], [0.31, 1.06, 0.31], 0.014, BLK, 0, 0.014, 5);    // stem, bar
  for (const s of [-1, 1]) tube(B, [0.31, 1.06, s * 0.2], [0.31, 1.06, s * 0.33], 0.02, RUB, 0, 0.02, 5);
  box(B, [0.325, 1.135, 0.04], [0.012, 0.15, 0.078], BLK, 0, -0.5); box(B, [0.319, 1.137, 0.04], [0.004, 0.13, 0.066], [0.5, 0.75, 1.1], 0, -0.5);      // the phone on the bar, screen lit
  box(B, [0.47, 0.93, 0], [0.05, 0.06, 0.07], BLK); box(B, [0.497, 0.93, 0], [0.006, 0.045, 0.055], [2.4, 2.3, 2.0]);                    // headlight
  box(B, [-0.815, 0.7, 0], [0.012, 0.035, 0.09], [1.6, 0.04, 0.03]);                                                                    // tail light
  tube(B, [bb[0], bb[1], -0.14], [bb[0], bb[1], 0.14], 0.013, STEEL, 0, 0.013, 4);
  for (const [p, s] of [[BIKE.pedF, -1], [BIKE.pedR, 1]]) { tube(B, [bb[0], bb[1], s * 0.1], [p[0], p[1], s * 0.1], 0.012, STEEL, 0, 0.012, 4); box(B, [p[0], p[1], s * 0.15], [0.1, 0.022, 0.09], BLK); }
  tube(B, [-0.36, 0.3, -0.07], [-0.44, 0.02, -0.21], 0.011, BLK, 0, 0.011, 4);                                                          // side stand
  { const g = new THREE.TorusGeometry(0.085, 0.017, 5, 10); g.rotateX(1.2); g.translate(-0.25, 0.72, 0); fin(B, g, K(0.16)); }           // the chain lock round the seat post
  if (mitts) for (const s of [-1, 1]) { ball(B, [0.285, 1.065, s * 0.28], [0.13, 0.085, 0.11], K(0.03), 0, 8, 6); }
  else { ball(B, [0.3, 0.9, 0.22], [0.085, 0.12, 0.08], K(0.82), 0, 7, 5); tube(B, [0.3, 1.0, 0.22], [0.31, 1.06, 0.22], 0.012, K(0.82), 0, 0.006, 4); }
  return merge(B);
}

// one wheel, its axle at the origin (riders.js turns it): a fat-ish tyre, the rim, spokes, a valve and a reflector so the turning shows
export const AXLES = [[-0.56, BIKE.R], [0.58, BIKE.R]];
export function buildWheel() {
  const B = [], R = BIKE.R;
  fin(B, new THREE.TorusGeometry(R - 0.042, 0.042, 7, 22), K(0.028)); fin(B, new THREE.TorusGeometry(R - 0.088, 0.013, 4, 22), K(0.22));
  for (let i = 0; i < 7; i++) { const a = i * Math.PI / 7, rr = R - 0.09; tube(B, [Math.cos(a) * rr, Math.sin(a) * rr, 0], [-Math.cos(a) * rr, -Math.sin(a) * rr, 0], 0.0045, K(0.25), 0, 0.0045, 3); }
  box(B, [0, R - 0.15, 0], [0.03, 0.07, 0.012], [1.3, 0.55, 0.05]); box(B, [0.02, -(R - 0.1), 0], [0.012, 0.04, 0.012], K(0.5));
  return merge(B);
}

// the insulated bag-box: about a 46 cm cube, origin at the middle of its bottom. paint 1 = the body. Soft: the corners are pulled in, the
// sides belly out a little, the bottom third is dirtier; a lid with a flap down the back, a dull reflective strip, scuffs. No name, no mark.
function soft(list, c, size, col, paint, pinch = 0.93, dirt = 1) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2], 2, 3, 2).toNonIndexed(), P = g.attributes.position, n = P.count, cc = new Float32Array(n * 3), hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  for (let i = 0; i < n; i++) { let x = P.getX(i), y = P.getY(i), z = P.getZ(i); const ex = Math.abs(Math.abs(x) - hx) < 1e-5, ey = Math.abs(Math.abs(y) - hy) < 1e-5, ez = Math.abs(Math.abs(z) - hz) < 1e-5;
    if (ex && ez) { x *= pinch; z *= pinch; } if (ey) { x *= pinch + 0.02; z *= pinch + 0.02; } if (!ey && !(ex && ez)) { if (ex) x *= 1.025; if (ez) z *= 1.025; }
    const k = (y < -hy * 0.3 ? dirt : 1) * (0.9 + 0.2 * Math.abs(Math.sin(i * 12.9898 + x * 78.233 + z * 37.719) * 43758.5453 % 1)); P.setXYZ(i, x + c[0], y + c[1], z + c[2]); cc[i * 3] = col[0] * k; cc[i * 3 + 1] = col[1] * k; cc[i * 3 + 2] = col[2] * k; }
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g.computeVertexNormals(); const pa = new Float32Array(n).fill(paint); g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1)); list.push(g); return g;
}
export function buildBox() {
  const B = [], S = 0.46, H = 0.45, SIL = K(0.42);
  soft(B, [0, H * 0.45, 0], [S, H * 0.9, S], K(1), 1, 0.93, 0.72);                                                                     // body
  soft(B, [0, H * 0.94, 0], [S + 0.02, H * 0.13, S + 0.02], K(0.8), 1, 0.95);                                                           // lid
  box(B, [-(S / 2 + 0.006), H * 0.8, 0], [0.012, H * 0.3, S * 0.8], K(0.74), 1); box(B, [-(S / 2 + 0.013), H * 0.68, 0], [0.006, 0.03, 0.09], K(0.04));      // the lid's flap down the back, its tab
  for (const s of [-1, 1]) { box(B, [0, H * 0.5, s * (S / 2 + 0.008)], [S * 0.84, 0.024, 0.004], SIL); box(B, [0.06 * s, H * 0.845, s * (S / 2 + 0.006)], [S * 0.9, 0.008, 0.004], K(0.03)); }      // strips on the sides, the zip line
  box(B, [-(S / 2 + 0.014), H * 0.44, 0], [0.004, 0.024, S * 0.7], SIL);                                                                // strip on the flap side
  box(B, [-(S / 2 + 0.004), H * 0.22, 0.03], [0.02, 0.17, S * 0.58], K(0.62), 1);                                                       // a pocket low on the back
  box(B, [0.08, H * 0.3, S / 2 + 0.007], [0.13, 0.07, 0.003], K(1.5), 1, 0.2); box(B, [-0.1, H * 0.66, -(S / 2 + 0.007)], [0.1, 0.05, 0.003], K(0.55), 1, -0.3); box(B, [-0.12, H * 0.2, S / 2 + 0.007], [0.09, 0.035, 0.003], K(0.22));      // scuffs, a strip of tape
  box(B, [0, H + 0.012, 0], [0.16, 0.012, 0.03], K(0.05)); for (const s of [-1, 1]) box(B, [0.02, H * 0.42, s * (S / 2 + 0.004)], [0.03, H * 0.8, 0.003], K(0.05));      // carry handle, straps
  return merge(B);
}
// a plastic crate strapped to the rack with something in a bag in it. paint 1 = the crate, 2 = the bag
export function buildCrate() {
  const B = [], L = 0.36, W = 0.32, H = 0.27, T = 0.012;
  box(B, [0, T / 2, 0], [L, T, W], K(0.8), 1);
  for (const y of [0.05, 0.12, 0.2, H - 0.02]) { const hh = y > 0.19 ? 0.045 : 0.03; for (const s of [-1, 1]) { box(B, [0, y, s * (W / 2 - T / 2)], [L, hh, T], K(1), 1); box(B, [s * (L / 2 - T / 2), y, 0], [T, hh, W], K(1), 1); } }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B, [sx * (L / 2 - 0.012), H / 2, sz * (W / 2 - 0.012)], [0.024, H, 0.024], K(0.85), 1);
  for (const sx of [-0.33, 0, 0.33]) for (const sz of [-1, 1]) box(B, [sx * L, H / 2, sz * (W / 2 - T / 2)], [0.014, H, T], K(0.9), 1);
  ball(B, [0.01, H * 0.78, 0], [L * 0.4, 0.15, W * 0.4], K(1), 2, 7, 5); ball(B, [0.05, H + 0.1, 0.02], [0.05, 0.06, 0.045], K(0.92), 2, 5, 4);      // the bag, its knotted top
  tube(B, [-L / 2, H * 0.55, -W / 2 - 0.004], [L / 2, H * 0.3, -W / 2 - 0.004], 0.006, K(0.03), 0, 0.006, 3); tube(B, [-L / 2, H * 0.3, W / 2 + 0.004], [L / 2, H * 0.55, W / 2 + 0.004], 0.006, K(0.03), 0, 0.006, 3);      // a bungee cord
  return merge(B);
}

// two-bone reach: the middle joint between a and c for bone lengths l1, l2, bent towards hint
function mid(a, c, l1, l2, hint) {
  const d = _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]), L = Math.min(d.length(), (l1 + l2) * 0.999), u = d.normalize(), x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = _b.set(...hint); p.addScaledVector(u, -p.dot(u)).normalize(); return [a[0] + u.x * x + p.x * h, a[1] + u.y * x + p.y * h, a[2] + u.z * x + p.z * h];
}
export const POSES = {
  // on the saddle, both feet on the pedals, hands on the grips
  ride: { hip: [-0.29, 0.97], sh: [-0.07, 1.45], head: [0.03, 1.66], look: [1, -0.1], hands: [[0.3, 1.08, -0.27], [0.3, 1.08, 0.27]], feet: [[0.13, 0.36, -0.15], [-0.21, 0.36, 0.15]], back: [-0.33, 1.05, -0.3] },
  // standing over the bike at a light or by the kerb: left foot down (the bike leans a little that way)
  astride: { hip: [-0.27, 0.97], sh: [-0.08, 1.46], head: [0.0, 1.67], look: [1, -0.05], hands: [[0.3, 1.08, -0.27], [0.3, 1.08, 0.27]], feet: [[-0.06, 0.07, -0.36], [-0.21, 0.36, 0.15]], back: [-0.33, 1.06, -0.25] },
  // standing by the bikes, head down at the phone
  stand: { hip: [0, 0.93], sh: [0.03, 1.43], head: [0.1, 1.615], look: [0.75, -0.66], hands: [[0.1, 0.99, -0.2], [0.27, 1.2, 0.07]], feet: [[0.02, 0.045, -0.11], [-0.02, 0.045, 0.12]], phone: 1, back: [-0.2, 1.0, -0.1] },
  // standing, hands in the pockets, looking up the street
  stand2: { hip: [0, 0.935], sh: [-0.01, 1.45], head: [0.02, 1.665], look: [1, 0.02], hands: [[0.09, 0.99, -0.2], [0.09, 0.99, 0.2]], feet: [[0.03, 0.045, -0.13], [-0.03, 0.045, 0.1]], back: [-0.23, 1.02, 0] },
};
// the rider. paint: 1 jacket (arms, hood), 2 trousers, 3 helmet, 4 the body of the jacket or a hi-vis vest over it, 5 skin. gear: 'helmet' | 'hood'
export function buildRider(poseName, gear) {
  const P = POSES[poseName], B = [], H = P.hip, S = P.sh, GLOVE = K(0.03), SHOE = K(0.04);
  const sx = S[0] - H[0], sy = S[1] - H[1], sl = Math.hypot(sx, sy), ux = sx / sl, uy = sy / sl, fx = uy, fy = -ux;      // spine and what is "front" of it
  // the puffer: rings up the spine, bulging between the quilting seams
  { const N = 10, rings = [[-0.1, 0.13, 0.17], [-0.02, 0.15, 0.19], [0.1, 0.135, 0.175], [0.2, 0.155, 0.195], [0.33, 0.14, 0.18], [0.45, 0.16, 0.2], [0.58, 0.145, 0.19], [0.72, 0.165, 0.215], [0.86, 0.15, 0.22], [0.97, 0.11, 0.18], [1.04, 0.06, 0.08]], pos = [], idx = [];
    for (const r of rings) for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, c = Math.cos(a) * r[1], z = Math.sin(a) * r[2], cx = H[0] + sx * r[0], cy = H[1] + sy * r[0]; pos.push(cx + fx * c, cy + fy * c, z); }
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) { const a = k * N + i, b = k * N + (i + 1) % N, c = a + N, d = b + N; idx.push(a, b, c, b, d, c); }
    const c0 = pos.length / 3; pos.push(H[0] - sx * 0.1, H[1] - sy * 0.1, 0); for (let i = 0; i < N; i++) idx.push(c0, (i + 1) % N, i);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); fin(B, g, K(1), 4); }
  // legs
  for (const s of [0, 1]) { const z = s ? 0.1 : -0.1, hp = [H[0], H[1], z], ft = P.feet[s], an = [ft[0] - 0.05, ft[1] + 0.05, ft[2]], kn = mid(hp, an, 0.45, 0.46, [1, 0.25, (s ? 1 : -1) * 0.25]);
    tube(B, hp, kn, 0.1, K(1), 2, 0.076, 9); tube(B, kn, an, 0.074, K(1), 2, 0.056, 9); ball(B, kn, K(0.076), K(1), 2, 8, 6); ball(B, hp, K(0.1), K(1), 2, 8, 6); box(B, [ft[0] + 0.02, ft[1] - 0.005, ft[2]], [0.27, 0.085, 0.1], SHOE); }
  // arms (the puffer's sleeves)
  for (const s of [0, 1]) { const z = s ? 0.2 : -0.2, shd = [S[0] - ux * 0.06, S[1] - uy * 0.06, z], hn = P.hands[s], el = mid(shd, hn, 0.31, 0.29, [-0.6, -1, (s ? 1 : -1) * 0.5]);
    ball(B, shd, K(0.085), K(1), 1, 7, 5); tube(B, shd, el, 0.08, K(1), 1, 0.072, 9); ball(B, el, K(0.07), K(1), 1, 6, 5); tube(B, el, hn, 0.07, K(1), 1, 0.056, 9); ball(B, hn, K(0.05), GLOVE, 0, 6, 5); }
  if (P.phone) { const h = P.hands[1]; box(B, [h[0] + 0.03, h[1] + 0.055, h[2]], [0.012, 0.15, 0.075], K(0.03), 0, -0.6); box(B, [h[0] + 0.022, h[1] + 0.059, h[2]], [0.004, 0.13, 0.063], [0.55, 0.8, 1.15], 0, -0.6); }
  // head, face covering, helmet or hood
  const hd = P.head, lk = P.look, ll = Math.hypot(lk[0], lk[1]), lx = lk[0] / ll, ly = lk[1] / ll;
  tube(B, [S[0], S[1] - 0.02, 0], [hd[0] - lx * 0.02, hd[1] - 0.06, 0], 0.055, K(1), gear === 'hood' ? 1 : 5, 0.05, 6);
  ball(B, hd, [0.1, 0.115, 0.095], K(1), 5, 10, 8);
  if (gear === 'hood') { ball(B, [hd[0] - lx * 0.035, hd[1] - ly * 0.035 + 0.008, 0], [0.132, 0.14, 0.128], K(1), 1, 10, 8); ball(B, [hd[0] + lx * 0.05 + ly * 0.062, hd[1] + ly * 0.05 - lx * 0.062, 0], [0.066, 0.052, 0.074], K(0.06), 0, 8, 6);      // hood up over a hat, a black gaiter over nose and mouth
    ball(B, [hd[0] + lx * 0.03 - ly * 0.07, hd[1] + ly * 0.03 + lx * 0.07, 0], [0.085, 0.045, 0.092], K(0.05), 0, 8, 5); }                                                                                                                             // the hat's edge on the brow
  else { ball(B, [hd[0] - lx * 0.012 - ly * 0.05, hd[1] - ly * 0.012 + lx * 0.05, 0], [0.135, 0.092, 0.118], K(1), 3, 10, 7); ball(B, [S[0] - ux * 0.02 - fx * 0.15, S[1] - uy * 0.02 - fy * 0.15, 0], [0.09, 0.1, 0.15], K(1), 1, 8, 6);                 // helmet; the hood lies on the back
    ball(B, [hd[0] + lx * 0.052 + ly * 0.066, hd[1] + ly * 0.052 - lx * 0.066, 0], [0.062, 0.046, 0.07], K(0.06), 0, 8, 6); }
  return merge(B);
}

// one lit material for everything
export function riderMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint;\nattribute mat4 aTint;')
    .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n{ vec3 tc = vec3( 1.0 ); if ( aPaint > 4.5 ) tc = vec3( aTint[0].w, aTint[1].w, aTint[2].w ); else if ( aPaint > 3.5 ) tc = aTint[3].xyz; else if ( aPaint > 2.5 ) tc = aTint[2].xyz; else if ( aPaint > 1.5 ) tc = aTint[1].xyz; else if ( aPaint > 0.5 ) tc = aTint[0].xyz; vColor.xyz *= tc; }\n#endif'); };
  m.customProgramCacheKey = () => 'riders-paint'; return m;
}
