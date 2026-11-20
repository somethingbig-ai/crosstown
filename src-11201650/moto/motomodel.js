// moto/motomodel.js (gameplay lane): the motorcycle's model, made here in code. An ordinary unbranded naked street bike of our own
// design: no maker, no name, no logo, nothing taken from any game or product. No asset file: buildBike() makes four small geometries
// (body, front end, wheel, side stand) with vertex colours; moto.js draws every bike in the scene as instances of them
// (three draw calls for all bikes together, a fourth while a stand is down).
// Bike frame: x ahead, y up, z to the RIGHT, origin on the road midway between the tyres' contact points. Metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const GEO = {
  rear: [-0.70, 0.31], front: [0.74, 0.31], radius: 0.31,          // axles (x, y)
  pivot: [0.43, 0.95, 0], axis: [-0.434, 0.901, 0],                 // steering head and the steering axis (26 degrees of rake)
  standPivot: [-0.05, 0.30, -0.13], standLen: 0.297, standDown: [0.101, -0.815, -0.572], standUp: [-0.985, -0.12, -0.12],
  seat: [-0.30, 0.80], pegs: [-0.20, 0.34, 0.24], grips: [0.335, 1.08, 0.30], tank: [0.12, 0.99],
  low: [[1.08, 0.34], [1.27, 0.33], [0.34, 0.24], [0.42, 0.26], [0.0, 0.07], [0.62, 0.07]],      // (height, half width) of what touches the road when it lies on its side
};
export const PAINTS = [0x9e1616, 0x12306b, 0x0e0f12, 0xc9ccd1, 0xc85a12, 0x1c5237, 0xd4b012];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
function fin(list, g, col, paint = 0) {
  g = g.index ? g : g; g.deleteAttribute('uv'); const n = g.attributes.position.count, c = new Float32Array(n * 3), p = new Float32Array(n);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; p[i] = paint; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aPaint', new THREE.BufferAttribute(p, 1)); list.push(g); return g;
}
const K = (v) => [v, v, v];
function tube(list, p0, p1, r, col, seg = 6, r1 = r, paint = 0) { _a.set(...p0); _b.set(...p1); const d = _b.clone().sub(_a), L = d.length(); const g = new THREE.CylinderGeometry(r1, r, L, seg, 1, false); _q.setFromUnitVectors(Y, d.normalize()); g.applyMatrix4(_m.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, ONE)); return fin(list, g, col, paint); }
function path(list, pts, r, col, seg = 6) { for (let i = 1; i < pts.length; i++) tube(list, pts[i - 1], pts[i], r, col, seg); }
function ball(list, c, rad, col, paint = 0, ws = 10, hs = 7) { const g = new THREE.SphereGeometry(1, ws, hs); g.applyMatrix4(_m.compose(_a.set(...c), _q.identity(), _b.set(...rad))); return fin(list, g, col, paint); }
function box(list, c, size, col, rz = 0, paint = 0) { const g = new THREE.BoxGeometry(size[0], size[1], size[2]); g.applyMatrix4(_m.compose(_a.set(...c), _q.setFromAxisAngle(_b.set(0, 0, 1), rz), ONE)); return fin(list, g, col, paint); }
function disc(list, c, r, w, col, seg = 16, open = false) { const g = new THREE.CylinderGeometry(r, r, w, seg, 1, open); g.rotateX(Math.PI / 2); g.translate(c[0], c[1], c[2]); return fin(list, g, col); }
// a body lofted through rounded cross-sections: [x, centre y, half height, half width] ...
function loft(list, secs, col, paint = 0, N = 10, pw = 0.62) {
  const pos = [], idx = [], S = secs.length;
  for (const s of secs) for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t); pos.push(s[0], s[1] + s[2] * Math.sign(sn) * Math.abs(sn) ** pw, s[3] * Math.sign(cs) * Math.abs(cs) ** pw); }
  for (let k = 0; k < S - 1; k++) for (let i = 0; i < N; i++) { const a = k * N + i, b = k * N + (i + 1) % N, c = a + N, d = b + N; idx.push(a, c, b, b, c, d); }
  const c0 = pos.length / 3; pos.push(secs[0][0], secs[0][1], 0); const c1 = c0 + 1; pos.push(secs[S - 1][0], secs[S - 1][1], 0);
  for (let i = 0; i < N; i++) { idx.push(c0, i, (i + 1) % N); idx.push(c1, (S - 1) * N + (i + 1) % N, (S - 1) * N + i); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return fin(list, g, col, paint);
}
// a curved sheet round an axle (a mudguard): centre (cx, cy), radius, from angle a0 to a1 (0 = ahead, 90 degrees = up), half width, a little crown
function guard(list, cx, cy, R, a0, a1, w, col, paint = 0, n = 9) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a); for (const [dz, dr] of [[-w, -0.012], [-w * 0.6, 0.008], [0, 0.016], [w * 0.6, 0.008], [w, -0.012]]) pos.push(cx + c * (R + dr), cy + s * (R + dr), dz); }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return fin(list, g, col, paint);
}
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

export function buildBike() {
  const BLK = K(0.018), RUB = K(0.022), FRM = K(0.035), ENG = [0.085, 0.085, 0.09], CYL = [0.2, 0.2, 0.205], ALLOY = K(0.5), STEEL = [0.36, 0.35, 0.34], CHROME = K(0.72), WHITE = K(1);
  // ---------------------------------------------------------------- body (fixed to the frame)
  const B = [];
  loft(B, [[0.37, 0.86, 0.045, 0.06], [0.29, 0.885, 0.085, 0.13], [0.15, 0.90, 0.10, 0.168], [0.0, 0.885, 0.09, 0.15], [-0.10, 0.85, 0.06, 0.11], [-0.15, 0.83, 0.03, 0.08]], WHITE, 1);      // tank
  loft(B, [[-0.09, 0.815, 0.03, 0.10], [-0.25, 0.80, 0.035, 0.145], [-0.45, 0.805, 0.035, 0.14], [-0.60, 0.835, 0.03, 0.10], [-0.67, 0.85, 0.02, 0.07]], BLK);                                 // seat
  loft(B, [[-0.28, 0.735, 0.04, 0.105], [-0.50, 0.755, 0.04, 0.115], [-0.66, 0.80, 0.03, 0.08], [-0.75, 0.82, 0.02, 0.05]], WHITE, 1);                                                          // tail
  box(B, [-0.762, 0.818, 0], [0.02, 0.034, 0.09], [1.5, 0.03, 0.02]);                                                                                                                         // tail lamp
  tube(B, [-0.70, 0.78, 0], [-0.865, 0.60, 0], 0.014, BLK, 5); box(B, [-0.878, 0.57, 0], [0.012, 0.11, 0.17], [0.62, 0.6, 0.5], 0.25);                                                        // plate hanger, a blank plate
  guard(B, -0.70, 0.31, 0.345, 1.0, 2.75, 0.078, BLK);                                                                                                                                        // rear hugger
  for (const s of [-1, 1]) {
    box(B, [-0.18, 0.665, s * 0.122], [0.27, 0.15, 0.018], WHITE, 0.08, 1);                                                                                                                   // side panel
    tube(B, [0.43, 0.93, s * 0.03], [0.30, 0.46, s * 0.10], 0.02, FRM); tube(B, [0.42, 0.91, s * 0.04], [-0.12, 0.76, s * 0.09], 0.022, FRM);
    tube(B, [-0.12, 0.76, s * 0.09], [-0.18, 0.40, s * 0.112], 0.022, FRM); tube(B, [-0.12, 0.76, s * 0.09], [-0.62, 0.79, s * 0.07], 0.017, FRM);
    tube(B, [-0.18, 0.40, s * 0.115], [-0.70, 0.31, s * 0.125], 0.027, K(0.16));                                                                                                             // swingarm
    tube(B, [-0.18, 0.42, s * 0.12], [-0.20, 0.34, s * 0.13], 0.014, FRM, 5); tube(B, [-0.20, 0.34, s * 0.13], [-0.20, 0.34, s * 0.24], 0.016, RUB, 5);                                       // foot peg
    disc(B, [0.05, 0.38, s * 0.165], 0.10, 0.04, K(0.3), 14);                                                                                                                                 // engine side cover
  }
  box(B, [0.10, 0.38, 0], [0.36, 0.24, 0.30], ENG); box(B, [0.17, 0.60, 0], [0.20, 0.23, 0.24], CYL, -0.2); box(B, [0.20, 0.725, 0], [0.21, 0.05, 0.22], ENG, -0.2);                           // crankcase, cylinders, head
  for (let i = 0; i < 3; i++) box(B, [0.165 + i * 0.012, 0.545 + i * 0.055, 0], [0.225, 0.012, 0.262], K(0.13), -0.2);                                                                         // cooling fins
  box(B, [0.365, 0.60, 0], [0.03, 0.22, 0.26], BLK, 0.2);                                                                                                                                     // radiator
  path(B, [[0.28, 0.56, 0.08], [0.345, 0.36, 0.11], [0.22, 0.225, 0.135], [-0.18, 0.245, 0.165]], 0.024, STEEL, 6);                                                                          // exhaust pipe
  tube(B, [-0.18, 0.26, 0.18], [-0.66, 0.42, 0.20], 0.058, STEEL, 9, 0.05); disc(B, [-0.665, 0.422, 0.20], 0.035, 0.012, BLK, 8);                                                             // silencer
  tube(B, [-0.20, 0.72, 0], [-0.36, 0.40, 0], 0.03, K(0.42), 6);                                                                                                                              // rear shock
  box(B, [-0.44, 0.345, -0.105], [0.54, 0.05, 0.014], K(0.06), Math.atan2(0.09, -0.52) + Math.PI); disc(B, [-0.70, 0.31, -0.105], 0.095, 0.012, K(0.4), 14);                                   // chain, sprocket
  // ---------------------------------------------------------------- front end (turns about the steering axis)
  const F = [];
  for (const s of [-1, 1]) {
    tube(F, [0.74, 0.31, s * 0.09], [0.60, 0.60, s * 0.09], 0.031, K(0.2), 7); tube(F, [0.60, 0.60, s * 0.09], [0.415, 0.985, s * 0.09], 0.021, CHROME, 7);                                    // fork leg
    path(F, [[0.385, 1.05, 0], [0.36, 1.085, s * 0.20], [0.335, 1.08, s * 0.24]], 0.013, CHROME, 5); tube(F, [0.335, 1.08, s * 0.24], [0.335, 1.08, s * 0.36], 0.019, RUB, 6);                // bar, grip
    tube(F, [0.36, 1.085, s * 0.22], [0.37, 1.24, s * 0.30], 0.007, BLK, 4); ball(F, [0.372, 1.265, s * 0.31], [0.012, 0.036, 0.056], BLK, 0, 8, 5);                                          // mirror
  }
  box(F, [0.42, 0.975, 0], [0.07, 0.028, 0.24], FRM, 0.45); box(F, [0.482, 0.84, 0], [0.06, 0.028, 0.24], FRM, 0.45); tube(F, [0.41, 0.99, 0], [0.385, 1.05, 0], 0.02, FRM, 6);                  // clamps, riser
  ball(F, [0.585, 0.86, 0], [0.075, 0.09, 0.09], BLK); ball(F, [0.627, 0.86, 0], [0.042, 0.078, 0.078], [2.3, 2.2, 1.9], 0, 10, 6);                                                             // headlight shell and lens
  box(F, [0.47, 1.02, 0], [0.06, 0.05, 0.12], BLK, 0.45);                                                                                                                                     // clocks
  guard(F, 0.74, 0.31, 0.338, 0.55, 2.55, 0.068, WHITE, 1);                                                                                                                                   // front mudguard
  // ---------------------------------------------------------------- a wheel (axle along z, centre at the origin)
  const W = [];
  { const g = new THREE.TorusGeometry(0.245, 0.065, 7, 22); fin(W, g, RUB); }
  disc(W, [0, 0, 0], 0.202, 0.078, ALLOY, 18, true); disc(W, [0, 0, 0], 0.05, 0.11, K(0.3), 10);
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5, g = new THREE.BoxGeometry(0.16, 0.03, 0.022); g.applyMatrix4(_m.compose(_a.set(Math.cos(a) * 0.122, Math.sin(a) * 0.122, 0), _q.setFromAxisAngle(_b.set(0, 0, 1), a), ONE)); fin(W, g, ALLOY); }
  for (const s of [-1, 1]) disc(W, [0, 0, s * 0.058], 0.135, 0.006, K(0.6), 16);
  // ---------------------------------------------------------------- the side stand (hangs down -y from its pivot)
  const S = []; tube(S, [0, 0, 0], [0, -GEO.standLen, 0], 0.012, FRM, 5); box(S, [0, -GEO.standLen, 0.012], [0.05, 0.012, 0.05], FRM);
  const out = {};
  for (const [k, list] of [['body', B], ['fork', F], ['wheel', W], ['stand', S]]) { const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false); g.computeBoundingSphere(); g.boundingSphere.radius = 3; out[k] = g; for (const x of list) x.dispose(); }
  out.tris = { body: tris(out.body), fork: tris(out.fork), wheel: tris(out.wheel), stand: tris(out.stand) }; out.tris.bike = out.tris.body + out.tris.fork + 2 * out.tris.wheel + out.tris.stand;
  return out;
}

// materials: one lit material; the paint colour of each bike (instanceColor) only tints the vertices marked aPaint
export function bikeMaterials() {
  const mk = (paint) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: paint ? 0.38 : 0.5, metalness: paint ? 0.25 : 0.35, side: THREE.DoubleSide });
    if (paint) { m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint;').replace('#include <color_vertex>', '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n vColor = vec3( 1.0 );\n#endif\n#ifdef USE_COLOR\n vColor *= color;\n#endif\n#ifdef USE_INSTANCING_COLOR\n vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aPaint );\n#endif'); }; m.customProgramCacheKey = () => 'moto-paint'; }
    return m; };
  return { body: mk(true), fork: mk(true), plain: mk(false) };
}
