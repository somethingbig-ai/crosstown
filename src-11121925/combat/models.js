// combat/models.js: the four guns, built procedurally (no external assets). Imports nothing from the rest of the game.
//   await loadWeapons(); const gun = buildWeapon('pistol' | 'smg' | 'shotgun' | 'rifle'); const {geometry, material} = buildCasing(kind);
// Frame of every gun: +X forward (bore), +Y up, +Z shooter's right, metres, origin at the centre of the firing-hand grip.
// Authoring below is in millimetres; finish() scales to metres.
// Generic firearm TYPES only: no maker marks, nothing modelled on a game's art.
// group.userData = { kind, muzzle, eject, ejectDir, support, stock|null, sightY, stats: {tris, draws},
//   moving: { slide|bolt|pump: {node, axis (unit, local), travel (m), rest (node.position at rest)}, mag: {node}, trigger: {node (origin on its pin; rotate about Z)} } }
// Shotgun: the bolt rides in the pump node; moving.mag.node is a shell hidden above the loading port (detachable: false), the tube is fixed.
// One mesh per node, all on ONE material (weaponMaterial: MeshStandardMaterial + onBeforeCompile, no textures): each vertex carries its finish
// (attributes wfin, wpar; see FIN) and the shader makes roughness, metalness, wear, grain and cut patterns from it. 4 draws a gun.
// Stills and the critic rounds: lanes/gameplay/weapons-state/STATE.md. Work on weapons-state/dev/models.js and promote it from there (see STATE.md). Keep the camera near plane at 0.05 m or more: slots and grooves stand 0.3 mm proud.
import * as THREE from 'three';

const MM = 0.001;
const V = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);

// ---------------------------------------------------------------- colours (sRGB hex; vertex colours carry all base colour)
const C = {
  blued: 0x2b2d33, nitride: 0x36383d, park: 0x4a4b4c, anod: 0x3c3e44, steel: 0x6e7074, bright: 0x9a9da2, chrome: 0xb4b6ba,
  poly: 0x1b1b1c, polyLt: 0x1e1e1f, rubber: 0x0c0c0c, dark: 0x040405, brass: 0xb5924a, white: 0xd8d8d0, red: 0x8f1414, wood: 0xffffff, woodDk: 0xe2d8d0,
  tritium: 0xcfe0c0, hull: 0x7a1417,
};

// ---------------------------------------------------------------- geometry helpers (all return non-indexed BufferGeometry, mm)
function outline(pts) {
  // pts: [x, y, r?]; r > 0 rounds that corner (r < 1.6: a single chamfer)
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], r = p[2] || 0;
    if (!r) { out.push(new THREE.Vector2(p[0], p[1])); continue; }
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    let ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const half = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) / 2;
    const t = Math.min(r / Math.max(Math.tan(half), 1e-3), la * 0.48, lb * 0.48);
    const k = r < 1.6 ? 1 : r < 4 ? 3 : r < 12 ? 4 : 6;
    const p0x = p[0] + ax * t, p0y = p[1] + ay * t, p2x = p[0] + bx * t, p2y = p[1] + by * t;
    for (let j = 0; j <= k; j++) {
      const s = j / k, u = 1 - s;
      out.push(new THREE.Vector2(u * u * p0x + 2 * u * s * p[0] + s * s * p2x, u * u * p0y + 2 * u * s * p[1] + s * s * p2y));
    }
  }
  return out;
}
const circ = (cx, cy, r, n = 14) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cy + r * Math.sin(i / n * Math.PI * 2)]);
function strip(g) { g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.clearGroups?.(); return g.index ? g.toNonIndexed() : g; }
// side profile in XY, extruded along Z, centred on z = 0, total width w, edge chamfer b (segs > 1 rounds it)
function ext(pts, w, b = 0.8, holes = null, segs = 1) {
  const sh = new THREE.Shape(outline(pts));
  if (holes) for (const h of holes) sh.holes.push(new THREE.Path(outline(h)));
  const o = b > 0 ? { depth: w - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: segs, steps: 1, curveSegments: 1 }
    : { depth: w, bevelEnabled: false, steps: 1, curveSegments: 1 };
  const g = strip(new THREE.ExtrudeGeometry(sh, o));
  g.translate(0, 0, -w / 2 + b);
  return g;
}
// cross-section in (z, y), extruded along X from x0 to x1
function extX(ptsZY, x0, x1, b = 0.8, holes = null, segs = 1) {
  const m = (a) => a.map((p) => [-p[0], p[1], p[2]]);
  const g = ext(m(ptsZY), x1 - x0, b, holes && holes.map(m), segs);
  g.translate(0, 0, (x1 - x0) / 2); g.rotateY(Math.PI / 2); g.translate(x0, 0, 0);
  return g;
}
// plan profile in (x, z), extruded along Y from y0 to y1
function extY(ptsXZ, y0, y1, b = 0.8, holes = null) {
  const g = ext(ptsXZ.map((p) => [p[0], -p[1], p[2]]), y1 - y0, b, holes && holes.map((h) => h.map((p) => [p[0], -p[1], p[2]])));
  g.translate(0, 0, (y1 - y0) / 2); g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}
// revolve [x, r] profile around the X axis; x increasing gives outward faces, x decreasing inward (bores)
function rev(prof, seg = 14) {
  const pos = [];
  const P = (i, j) => { const a = j / seg * Math.PI * 2; return [prof[i][0], prof[i][1] * Math.cos(a), prof[i][1] * Math.sin(a)]; };
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
    const A = P(i, j), B = P(i + 1, j), Cc = P(i + 1, j + 1), D = P(i, j + 1);
    if (prof[i + 1][1] > 1e-6) pos.push(...A, ...Cc, ...B);
    if (prof[i][1] > 1e-6) pos.push(...A, ...D, ...Cc);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
const at = (g, x, y, z) => g.translate(x, y, z);
// loft through cross-sections (arrays of [x, y, z], all the same length); j0..j1 limits it to a strip of the section (no caps then)
function loft(secs, capA = true, capB = true, j0 = 0, j1 = -1) {
  const n = secs[0].length, pos = [], strip = j1 >= 0, T = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < secs.length - 1; i++) for (let j = strip ? j0 : 0; j < (strip ? j1 : n); j++) {
    const A = secs[i][j % n], B = secs[i + 1][j % n], Cc = secs[i + 1][(j + 1) % n], D = secs[i][(j + 1) % n]; T(A, B, Cc); T(A, Cc, D);
  }
  if (!strip) for (const [sec, flip] of [[secs[0], capA ? 1 : 0], [secs[secs.length - 1], capB ? -1 : 0]]) {
    if (!flip) continue; const c = [0, 0, 0]; for (const q of sec) { c[0] += q[0] / n; c[1] += q[1] / n; c[2] += q[2] / n; }
    for (let j = 0; j < n; j++) flip > 0 ? T(c, sec[j], sec[(j + 1) % n]) : T(c, sec[(j + 1) % n], sec[j]);
  }
  // orient outward by the sign of the enclosed volume (strips: caller picks the section winding)
  let vol = 0; for (let i = 0; i < pos.length; i += 9) vol += pos[i] * (pos[i + 4] * pos[i + 8] - pos[i + 5] * pos[i + 7]) - pos[i + 1] * (pos[i + 3] * pos[i + 8] - pos[i + 5] * pos[i + 6]) + pos[i + 2] * (pos[i + 3] * pos[i + 7] - pos[i + 4] * pos[i + 6]);
  if (vol < 0 && !strip) for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
// superellipse section at station x: centre height cy, half-height hy, half-width hz, exponent e (2 = ellipse, 4 = boxy)
const ell = (x, cy, hy, hz, e = 2, n = 16) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), pw = 2 / e; return [x, cy + hy * Math.sign(sn) * Math.abs(sn) ** pw, hz * Math.sign(c) * Math.abs(c) ** pw]; });
// pistol-grip loft: stations [y, front x, back x, half-width, squareness, slope of the section plane], sections lie in (tilted) horizontal planes
const gripSecs = (st, n = 18, grow = 0) => st.map(([y, xf, xb, hw, e, sl]) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), pw = 2 / (e || 2.6), dx = ((xf - xb) / 2 + grow) * Math.sign(c) * Math.abs(c) ** pw;
  return [(xf + xb) / 2 + dx, y + (sl || 0) * dx, (hw + grow) * Math.sign(sn) * Math.abs(sn) ** pw];
}));
const gripLoft = (st, n = 18) => loft(gripSecs(st, n));
const arc = (cx, cy, rx, ry, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
// solid or bored cylinder along X
function cylX(x0, x1, r, y = 0, z = 0, c = 0.4, seg = 14, bore = 0) {
  const p = [[x0, bore], [x0, r - c], [x0 + c, r], [x1 - c, r], [x1, r - c], [x1, bore]];
  if (bore) p.push([x1 - Math.min(30, x1 - x0), bore]);
  return at(rev(p, seg), 0, y, z);
}
function cylZ(x, y, r, z0, z1, c = 0.3, seg = 12) { const g = cylX(z0, z1, r, 0, 0, c, seg); g.rotateY(-Math.PI / 2); return at(g, x, y, 0); }
function cylY(x, z, r, y0, y1, c = 0.3, seg = 12) { const g = cylX(y0, y1, r, 0, 0, c, seg); g.rotateZ(Math.PI / 2); return at(g, x, 0, z); }
// ring (washer) around X
function ringX(x0, x1, ro, ri, y = 0, z = 0, seg = 14) { return at(rev([[x0, ri], [x0, ro], [x1, ro], [x1, ri], [x0, ri]], seg), 0, y, z); }
function ringZ(x, y, ro, ri, z0, z1, seg = 14) { const g = ringX(z0, z1, ro, ri, 0, 0, seg); g.rotateY(-Math.PI / 2); return at(g, x, y, 0); }
// chamfered box by extents
function bx(x0, x1, y0, y1, z0, z1, b = 0.4) {
  b = Math.min(b, (x1 - x0) * 0.3, (y1 - y0) * 0.3, (z1 - z0) * 0.3);
  const g = ext([[x0, y0, b], [x1, y0, b], [x1, y1, b], [x0, y1, b]], z1 - z0, b);
  return at(g, 0, 0, (z0 + z1) / 2);
}
// plain (unchamfered) box: dark slots, grooves, markings
function pb(x0, x1, y0, y1, z0, z1) { const g = strip(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)); return at(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); }
function mirZ(g) {
  const m = g.clone(); m.scale(1, 1, -1); const p = m.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  return m;
}
const both = (g) => [g, mirZ(g)];
function rotZ(g, a, cx = 0, cy = 0) { g.translate(-cx, -cy, 0); g.rotateZ(a); g.translate(cx, cy, 0); return g; }
// picatinny rail: comb in side view, base at y, top at y + 5.6
function rail(x0, x1, y, w = 21.2) {
  const top = y + 5.6, fl = y + 2.6, p = [[x0, y], [x0, top]];
  let x = x0;
  while (x + 4.8 <= x1 + 1e-6) { p.push([x + 4.8, top]); if (x + 10 + 4.8 <= x1 + 1e-6) { p.push([x + 4.8, fl], [x + 10, fl], [x + 10, top]); x += 10; } else { x += 4.8; break; } }
  p.push([x, y]);
  return ext(p, w, 0.35);
}

// ---------------------------------------------------------------- noise
function h3(x, y, z) { let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w);
}

// ---------------------------------------------------------------- finishes and the one weapon material
// Every gun part carries its finish in two vertex attributes; one MeshStandardMaterial with a shader hook turns them into
// roughness, metalness, colour break-up, ragged edge wear, grain and cut patterns (all procedural in object space, band-limited
// by the pixel footprint so nothing shimmers at third-person size). No textures, no UVs.
//   wfin = (roughness, metalness, edge 0..1, ambient occlusion 0..1)     wpar = (finish type, pattern, wear amount, pattern pitch mm)
const T_BLUED = 0, T_ANOD = 1, T_PARK = 2, T_POLY = 3, T_RUBBER = 4, T_WOOD = 5, T_BRIGHT = 6, T_BRASS = 7, T_VOID = 8, T_PAINT = 9;
const P_GROOVE = 1, P_CHECK = 2, P_STIP = 3, P_KNURL = 4;
const F = (t, r, m, wear = 0, col = null, pat = 0, pitch = 1) => ({ t, r, m, wear, col, pat, pitch });
const FIN = {
  blued: F(T_BLUED, 0.32, 0.85, 1.0, 0x303034), nitride: F(T_BLUED, 0.48, 0.7, 0.3, 0x39393b), anod: F(T_ANOD, 0.46, 0.5, 1.0, 0x38383b),
  anodLt: F(T_ANOD, 0.5, 0.5, 1.0, 0x4c4c4d), park: F(T_PARK, 0.8, 0.25, 0.9, 0x474745), parkDk: F(T_PARK, 0.72, 0.3, 0.9, 0x454442),
  steel: F(T_BRIGHT, 0.34, 1.0), inner: F(T_PARK, 0.7, 0.3, 0, 0x2c2c2d), bolt: F(T_BRIGHT, 0.42, 1.0, 0, 0x5e6064), pin: F(T_BLUED, 0.42, 0.7, 1.0, 0x3a3a3b), pinDk: F(T_BLUED, 0.42, 0.7, 1.0, 0x3a3a3b), screw: F(T_BLUED, 0.4, 0.7, 1.0, 0x2e2e2f), brass: F(T_BRASS, 0.3, 1.0),
  poly: F(T_POLY, 0.78, 0, 1.0, 0x242423), polyMag: F(T_POLY, 0.7, 0, 1.0, 0x222222), rubber: F(T_RUBBER, 0.92, 0, 0, 0x2b2b2a),
  gripCk: F(T_POLY, 0.7, 0, 0.6, 0x272727, P_CHECK, 1.4), stip: F(T_POLY, 0.72, 0, 0.6, 0x272727, P_STIP, 1.0), pad: F(T_RUBBER, 0.95, 0, 0, 0x2e2d2c, P_STIP, 2.2),
  wood: F(T_WOOD, 0.27, 0, 1.0), check: F(T_WOOD, 0.6, 0, 0.3, 0xc8c0b8, P_CHECK, 1.5), groove: F(T_WOOD, 0.4, 0, 0.6, null, P_GROOVE, 7.0),
  void: F(T_VOID, 1.0, 0), paint: F(T_PAINT, 0.55, 0), hull: F(T_PAINT, 0.42, 0),
  serr: F(T_BLUED, 0.48, 0.7, 0.3, 0x39393b, P_GROOVE, 2.4), knurl: F(T_BLUED, 0.5, 0.7, 1.0, 0x38383a, P_KNURL, 1.6),
};
const FIN_HEX = {
  [C.blued]: FIN.blued, [C.nitride]: FIN.nitride, [C.anod]: FIN.anod, [C.park]: FIN.park, [C.steel]: FIN.steel, [C.bright]: FIN.steel, [C.chrome]: FIN.steel,
  [C.dark]: FIN.void, [C.brass]: FIN.brass, [C.white]: FIN.paint, [C.red]: FIN.paint, [C.tritium]: FIN.paint, [C.hull]: FIN.hull, [C.rubber]: FIN.rubber,
  0x505256: FIN.pin, 0x2f3032: FIN.parkDk, 0x505356: FIN.anodLt,
};
function finishOf(mat, hex) {
  if (typeof mat === 'object') return mat;
  if (mat === 'wood') return FIN.wood;
  if (mat === 'grip') return hex === 0x0c0c0c ? FIN.pad : hex === 0x4a2c16 ? FIN.check : FIN.stip;
  const f = FIN_HEX[hex]; if (f) return f;
  if (mat === 'poly') return hex > 0x808080 || (hex >> 16) > 0x80 ? FIN.paint : FIN.poly;
  const c = new THREE.Color(hex), lum = (c.r + c.g + c.b) / 3;
  return lum > 0.06 ? FIN.steel : FIN.nitride;
}

const MATS = {};
const GLSL_V_PARS = /* glsl */`
attribute vec4 wfin; attribute vec4 wpar;
varying vec4 vWfin; varying vec4 vWpar; varying vec3 vWpos;`;
const GLSL_V_MAIN = /* glsl */`
vWfin = wfin; vWpar = wpar; vWpos = position * 1000.0;`;
const GLSL_F_PARS = /* glsl */`
varying vec4 vWfin; varying vec4 vWpar; varying vec3 vWpos;
float wh(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wh(i), wh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wh(i + vec3(0.0, 1.0, 0.0)), wh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(wh(i + vec3(0.0, 0.0, 1.0)), wh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wh(i + vec3(0.0, 1.0, 1.0)), wh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// how much of a feature of frequency s (1/mm) survives a pixel px mm wide
float wk(vec3 s, float px) { return clamp(1.6 - px * max(s.x, max(s.y, s.z)) * 2.2, 0.0, 1.0); }
float wnf(vec3 p, vec3 s, float px) { float k = wk(s, px); return k > 0.0 ? mix(0.5, wn(p * s), k) : 0.5; }
// thin straight scratches along the direction (c, s) in the side plane
float wdash(vec3 p, float c, float s, float px) {
  float k = wk(vec3(2.4), px); if (k <= 0.0) return 0.0;
  return k * 0.7 * smoothstep(0.88, 0.94, wn(vec3(p.x * c + p.y * s, p.y * c - p.x * s, p.z) * vec3(0.07, 2.4, 2.4)));
}
vec3 wBump(vec3 sp, vec3 n, float h, float fd) {
  vec2 dH = vec2(dFdx(h), dFdy(h)); vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - g);
}`;
const GLSL_F_COLOR = /* glsl */`
vec3 wp = vWpos; float wpx = length(fwidth(wp)) * 0.7;
float wT = vWpar.x, wPat = vWpar.y, wWear = vWpar.z, wPitch = max(vWpar.w, 0.05);
float wR = vWfin.x, wM = vWfin.y, wE = vWfin.z, wAO = vWfin.w, wH = 0.0, wSpec = 1.0;
float wNeut = wT < 4.5 ? 0.55 : 0.0;                        // black finishes only: wood, bright steel, brass and paint keep their colour
vec3 wC = diffuseColor.rgb;
float nBig = wnf(wp, vec3(0.028), wpx), nMed = wnf(wp + 31.7, vec3(0.11), wpx), nFine = wnf(wp + 5.3, vec3(0.55), wpx), nMic = wnf(wp, vec3(2.6), wpx);
float wStreak = wnf(wp, vec3(0.05, 1.3, 1.3), wpx);
// ragged edge wear and a few rubbed patches on the flats. Edges are sub-millimetre features: they fade out with distance (eK)
// so bright chips never sparkle at third-person size.
float eK = clamp(1.5 - wpx * 1.6, 0.0, 1.0);
wE *= eK;
float wEdge = smoothstep(0.5, 0.64, wE * 0.8 + nBig * 0.5 + (nMed - 0.5) * 0.3 + (nFine - 0.5) * 0.22 - 0.36);
float wRub = smoothstep(0.66, 0.9, nBig * 0.75 + nMed * 0.25 + wE * 0.3) * (0.35 + 0.65 * wStreak);
float wW = clamp(wEdge + wRub * 0.4, 0.0, 1.0) * wWear;
float wScr = wdash(wp, 0.97, 0.24, wpx) * smoothstep(0.55, 0.75, nBig) * wWear;
float wDust = smoothstep(0.5, 0.85, nMed * 0.55 + nFine * 0.45) * (1.0 - wAO) * 0.7;
if (wT < 0.5) {                                             // blued or nitrided steel: near-black, a tight highlight, polished thin on edges
  wC *= 1.0 + (nBig - 0.5) * 0.3 * wWear;
  wR += ((nMed - 0.5) * 0.14 + (wStreak - 0.5) * 0.08) * wWear + (nFine - 0.5) * 0.05;
  wC = mix(wC, vec3(0.2, 0.205, 0.21), max(wW * 0.8, wScr * 0.25)); wR = mix(wR, 0.3, wW * 0.6); wM = mix(wM, 1.0, wW);
  wH += nMic * 0.002; wSpec = 1.0;
} else if (wT < 1.5) {                                      // anodised aluminium: satin grey-black, silvers thin on corners only
  wC *= 0.9 + 0.2 * nBig;
  wR += (nMed - 0.5) * 0.14 + (nBig - 0.5) * 0.08;
  float chip = smoothstep(0.5, 0.54, wE * wE * 0.75 + nMed * 0.3 + (nFine - 0.5) * 0.4 - 0.5) * wWear;
  float bare = clamp(chip + wScr * 0.3, 0.0, 1.0);
  wC = mix(wC, vec3(0.22, 0.225, 0.23), bare); wR = mix(wR, 0.34, bare); wM = mix(wM, 1.0, bare);
  wC = mix(wC, wC * 1.3 + 0.006, wRub * 0.5 * wWear);
  wH += nMic * 0.008; wSpec = 0.85;
} else if (wT < 2.5) {                                      // phosphate: dry and grey, burnished dark where rubbed
  wC *= 0.82 + 0.36 * nBig; wR += (nMed - 0.5) * 0.12;
  wC = mix(wC, wC * 0.7 + vec3(0.02), wW * 0.7); wR = mix(wR, 0.45, wW * 0.8); wM = mix(wM, 0.8, wW * 0.6);
  wH += nMic * 0.014; wSpec = 0.6;
} else if (wT < 3.5) {                                      // moulded polymer: matte black, rubbed glossy on edges, a few pale scuffs
  wC *= 0.88 + 0.24 * nBig;
  wR += (nMed - 0.5) * 0.14 - wW * 0.25;
  wC = mix(wC, vec3(0.07, 0.07, 0.072), wScr * 0.4);
  wH += nMic * 0.022 + nFine * 0.008; wSpec = 0.6;
} else if (wT < 4.5) {                                      // rubber
  wC *= 0.8 + 0.4 * nBig; wH += nMic * 0.012; wDust *= 1.6; wSpec = 0.6;
} else if (wT < 5.5) {                                      // oiled walnut: even satin brown, faint rings and fibres, pores, a few dents
  float warp = wnf(wp, vec3(0.006, 0.045, 0.045), wpx) * 9.0 + wnf(wp + 17.0, vec3(0.02, 0.2, 0.2), wpx) * 2.2;
  float rr = length(vec2(wp.y * 0.55 + 90.0 + wp.x * 0.035, wp.z * 1.3 + 30.0)) + warp;
  float ring = fract(rr / 2.6 + 0.6 * nBig), late = smoothstep(0.35, 0.9, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
  late = mix(0.3, late, clamp(1.6 - wpx * 0.85, 0.0, 1.0));
  float fig = wnf(wp + 3.0, vec3(0.007, 0.09, 0.09), wpx), fib = wnf(wp, vec3(0.05, 3.0, 3.0), wpx);
  float pk = wk(vec3(3.5), wpx), pore = pk > 0.0 ? pk * step(0.8, wn(wp * vec3(0.22, 3.5, 3.5))) : 0.0;
  float dent = smoothstep(0.8, 0.9, wnf(wp + 50.0, vec3(0.16), wpx)) * smoothstep(0.4, 0.7, nBig);
  float figB = wnf(wp + 71.0, vec3(0.0035, 0.045, 0.045), wpx);   // broad dark figure: the part of the grain that still shows at third-person size
  float tone = 0.42 + 0.4 * (fig - 0.5) + 0.55 * (figB - 0.5) + 0.3 * (fib - 0.5) - 0.085 * late - 0.2 * pore + 0.34 * (nBig - 0.5) - 0.3 * dent;
  wC *= mix(vec3(0.024, 0.0105, 0.006), vec3(0.23, 0.096, 0.037), clamp(tone, 0.0, 1.0));
  wR += 0.1 * late + 0.3 * pore + (nMed - 0.5) * 0.14 + dent * 0.25 + (nBig - 0.5) * 0.22;
  wC = mix(wC, wC * 1.5 + 0.012, wW * 0.6); wR += wW * 0.3; wSpec = 0.8;
  wH -= pore * 0.05 + late * 0.006 + dent * 0.12;
  wDust *= 0.4;
} else if (wT < 6.5) {                                      // bright steel: finely brushed along the bore, a little fouling
  float br = wnf(wp, vec3(0.08, 5.0, 5.0), wpx);
  wC *= 0.86 + 0.2 * br; wC = mix(wC, wC * vec3(0.55, 0.52, 0.47), smoothstep(0.55, 0.85, nMed * 0.6 + nBig * 0.4) * 0.5);
  wR += (br - 0.5) * 0.2 + (nMed - 0.5) * 0.12; wDust *= 0.3;
} else if (wT < 7.5) {                                      // brass
  wC = mix(wC, wC * vec3(0.6, 0.5, 0.4), smoothstep(0.4, 0.8, nMed) * 0.6); wR += (nMed - 0.5) * 0.22; wDust *= 0.2;
} else { wDust = 0.0; }
if (wPat > 0.5) {
  float pk = clamp(1.5 - wpx / wPitch * 3.0, 0.0, 1.0);
  if (wPat < 1.5) {                                         // grooves across the bore axis
    float u = fract(wp.x / wPitch), gv = smoothstep(0.0, 0.16, u) * (1.0 - smoothstep(0.3, 0.46, u));
    wH -= gv * 0.1 * wPitch * pk; gv = mix(0.3, gv, pk); wC *= 1.0 - 0.5 * gv; wR += 0.2 * gv;
  } else if (wPat < 2.5) {                                  // cut checkering: two sets of V grooves
    float u1 = abs(fract((wp.x * 0.866 + wp.y * 0.5) / wPitch) - 0.5) * 2.0, u2 = abs(fract((wp.x * 0.866 - wp.y * 0.5) / wPitch) - 0.5) * 2.0, hh = min(u1, u2);
    wH += hh * 0.3 * wPitch * pk; wC *= mix(0.7, 0.45 + 0.75 * hh, pk); wR += 0.15;
  } else if (wPat < 3.5) {                                  // moulded stipple
    float s1 = pk > 0.0 ? wn(wp / wPitch) * 0.65 + wn(wp * 2.3 / wPitch + 9.1) * 0.35 : 0.5;
    wH += (s1 - 0.5) * 0.15 * wPitch * pk; wC *= mix(1.0, 0.85 + 0.3 * s1, pk);
  } else {                                                  // knurling round the bore axis
    float a = (wp.y * 0.7 + wp.z * 0.7) / wPitch, u1 = abs(fract(wp.x / wPitch + a) - 0.5) * 2.0, u2 = abs(fract(wp.x / wPitch - a) - 0.5) * 2.0, hh = min(u1, u2);
    wH += hh * 0.25 * wPitch * pk; wC *= mix(0.75, 0.5 + 0.7 * hh, pk);
  }
}
wC = mix(wC, vec3(0.2, 0.185, 0.16), clamp(wDust, 0.0, 1.0) * 0.22); wR += clamp(wDust, 0.0, 1.0) * 0.2;
diffuseColor.rgb = wC;`;
function weaponMaterial(name) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 1 });
  m.name = name; m.envMapIntensity = 1.0;
  m.onBeforeCompile = (sh) => {
    const rep = (src, a, b) => { if (!src.includes(a)) console.warn('[weapons] shader chunk missing: ' + a); return src.replace(a, b); };
    sh.vertexShader = rep(rep(sh.vertexShader, '#include <common>', '#include <common>' + GLSL_V_PARS), '#include <begin_vertex>', '#include <begin_vertex>' + GLSL_V_MAIN);
    let f = rep(sh.fragmentShader, '#include <common>', '#include <common>' + GLSL_F_PARS);
    f = rep(f, '#include <color_fragment>', '#include <color_fragment>' + GLSL_F_COLOR);
    f = rep(f, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(wR, 0.08, 1.0);');
    f = rep(f, '#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(wM, 0.0, 1.0);');
    f = rep(f, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = wBump(-vViewPosition, normal, wH * 0.001, faceDirection);');
    f = rep(f, '#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= wAO * 1.4; reflectedLight.indirectSpecular *= mix(1.0, wAO, 0.85) * wSpec * 1.4; reflectedLight.directDiffuse *= mix(1.0, wAO, 0.35); reflectedLight.directSpecular *= mix(1.0, wAO, 0.5);\n// dark gun finishes pick up the blue of an open-shade sky as a navy cast: pull the ambient half-way to neutral\nreflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, vec3(dot(reflectedLight.indirectSpecular, vec3(0.2126, 0.7152, 0.0722))), wNeut); reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722))), wNeut);');
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'weapon-fin-11';
  return m;
}
function ensureMaterials() {
  if (MATS.gun) return;
  MATS.gun = weaponMaterial('weapon-gun'); MATS.brass = weaponMaterial('weapon-brass'); MATS.shell = weaponMaterial('weapon-shell');
}

// ---------------------------------------------------------------- assembling a gun
const CREASE = Math.cos(50 * Math.PI / 180);
class Gun {
  constructor(kind) { this.kind = kind; this.nodes = { root: { parent: null, pivot: [0, 0, 0], list: [] } }; }
  node(name, pivot = [0, 0, 0], parent = 'root') { this.nodes[name] = { parent, pivot, list: [] }; return name; }
  // mat: 'metal' | 'poly' | 'grip' | 'wood' (the finish then follows from the colour, see finishOf) or a FIN entry
  add(node, mat, color, ...geos) {
    const fin = finishOf(mat, color), list = this.nodes[node].list;
    for (const g of geos.flat(3)) list.push([g, fin.col == null ? color : fin.col, fin]);
  }
  finish() {
    ensureMaterials();
    const objs = {};
    let tris = 0, draws = 0;
    for (const name in this.nodes) {
      const nd = this.nodes[name], o = name === 'root' ? new THREE.Group() : new THREE.Object3D();
      o.name = name; objs[name] = o;
      o.position.set(nd.pivot[0] * MM, nd.pivot[1] * MM, nd.pivot[2] * MM);
      if (nd.list.length) {
        const geo = mergeBucket(nd.list, nd.pivot, true);
        const mesh = new THREE.Mesh(geo, MATS.gun); mesh.name = name + '-mesh'; mesh.castShadow = true; mesh.receiveShadow = true;
        o.add(mesh); tris += geo.attributes.position.count / 3; draws++;
      }
    }
    for (const name in this.nodes) if (this.nodes[name].parent) objs[this.nodes[name].parent].add(objs[name]);
    objs.root.userData.stats = { tris, draws };
    return objs.root;
  }
}
// ambient occlusion per vertex from a voxel grid of the node's own surface (parts shade each other where they meet)
function bakeAO(P, fn, nt, ao) {
  const CELL = 1.6; let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < lo[k]) lo[k] = P[i + k]; if (P[i + k] > hi[k]) hi[k] = P[i + k]; }
  const nx = Math.ceil((hi[0] - lo[0]) / CELL) + 3, ny = Math.ceil((hi[1] - lo[1]) / CELL) + 3, nz = Math.ceil((hi[2] - lo[2]) / CELL) + 3;
  if (nx * ny * nz > 6e6) return;
  const grid = new Uint8Array(nx * ny * nz), ox = lo[0] - CELL, oy = lo[1] - CELL, oz = lo[2] - CELL;
  const mark = (x, y, z) => { grid[(((z - oz) / CELL) | 0) * nx * ny + (((y - oy) / CELL) | 0) * nx + (((x - ox) / CELL) | 0)] = 1; };
  for (let t = 0; t < nt; t++) {
    const i = t * 9, ax = P[i], ay = P[i + 1], az = P[i + 2], ux = P[i + 3] - ax, uy = P[i + 4] - ay, uz = P[i + 5] - az, vx = P[i + 6] - ax, vy = P[i + 7] - ay, vz = P[i + 8] - az;
    const na = Math.min(400, Math.ceil(Math.hypot(ux, uy, uz) / (CELL * 0.7))), nb = Math.min(400, Math.ceil(Math.hypot(vx, vy, vz) / (CELL * 0.7)));
    for (let a = 0; a <= na; a++) { const s = a / na, m = Math.ceil(nb * (1 - s)); for (let b = 0; b <= m; b++) { const r = m ? b / m * (1 - s) : 0; mark(ax + ux * s + vx * r, ay + uy * s + vy * r, az + uz * s + vz * r); } }
  }
  const ND = 13, DC = new Float32Array(ND), DS = new Float32Array(ND), DU = new Float32Array(ND); DU[0] = 1;
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, b = (k + 0.5) / 6 * Math.PI * 2; DC[1 + k * 2] = Math.cos(a) * 0.572; DS[1 + k * 2] = Math.sin(a) * 0.572; DU[1 + k * 2] = 0.82; DC[2 + k * 2] = Math.cos(b) * 0.866; DS[2 + k * 2] = Math.sin(b) * 0.866; DU[2 + k * 2] = 0.5; }
  const D0 = 3.2, D1 = 6, D2 = 10.5, dir = new Float32Array(ND * 3); let TOT = 0; for (let d = 0; d < ND; d++) TOT += DU[d] * 2.15;
  const sx = 1 / CELL, nxy = nx * ny;
  const hit = (x, y, z) => { const ix = ((x - ox) * sx) | 0, iy = ((y - oy) * sx) | 0, iz = ((z - oz) * sx) | 0; return ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz ? 0 : grid[iz * nxy + iy * nx + ix]; };
  for (let t = 0; t < nt; t++) {
    const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
    let tx = fy, ty = -fx, tz = 0; if (Math.abs(fz) > 0.9) { tx = 0; ty = fz; tz = -fy; } const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx_ = fy * tz - fz * ty, by_ = fz * tx - fx * tz, bz_ = fx * ty - fy * tx;
    for (let d = 0; d < ND; d++) { dir[d * 3] = fx * DU[d] + tx * DC[d] + bx_ * DS[d]; dir[d * 3 + 1] = fy * DU[d] + ty * DC[d] + by_ * DS[d]; dir[d * 3 + 2] = fz * DU[d] + tz * DC[d] + bz_ * DS[d]; }
    // pull the sample points a little toward the triangle's middle so a vertex on a shared edge reads its own face
    const cx = (P[t * 9] + P[t * 9 + 3] + P[t * 9 + 6]) / 3, cy = (P[t * 9 + 1] + P[t * 9 + 4] + P[t * 9 + 7]) / 3, cz = (P[t * 9 + 2] + P[t * 9 + 5] + P[t * 9 + 8]) / 3;
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k; let px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      const dx = cx - px, dy = cy - py, dz = cz - pz, dl = Math.hypot(dx, dy, dz) || 1, pull = Math.min(0.6, dl * 0.3) / dl;
      px += dx * pull + fx * 1.7; py += dy * pull + fy * 1.7; pz += dz * pull + fz * 1.7;
      let occ = 0;
      for (let d = 0; d < ND; d++) {
        const ax = dir[d * 3], ay = dir[d * 3 + 1], az = dir[d * 3 + 2];
        if (hit(px + ax * D0, py + ay * D0, pz + az * D0)) occ += DU[d] * 2.15; else if (hit(px + ax * D1, py + ay * D1, pz + az * D1)) occ += DU[d] * 1.15; else if (hit(px + ax * D2, py + ay * D2, pz + az * D2)) occ += DU[d] * 0.45;
      }
      ao[v] = 1 - Math.min(1, occ / TOT * 1.15);
    }
  }
}
function mergeBucket(list, pivot, withAO = false) {
  let n = 0; for (const [g] of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), fin = new Float32Array(n * 4), par = new Float32Array(n * 4), c = new THREE.Color();
  let o = 0;
  for (const [g, color, f] of list) {
    const p = g.attributes.position.array; c.set(color);
    // drop degenerate triangles as we copy
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-12) continue;
      for (let k = 0; k < 9; k++) pos[o + k] = p[i + k];
      for (let k = 0; k < 3; k++) {
        const v = o / 3 + k; col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        fin[v * 4] = f.r; fin[v * 4 + 1] = f.m; fin[v * 4 + 3] = 1; par[v * 4] = f.t; par[v * 4 + 1] = f.pat; par[v * 4 + 2] = f.wear; par[v * 4 + 3] = f.pitch;
      }
      o += 9;
    }
    g.dispose();
  }
  const P = pos.subarray(0, o), nv = o / 3, nt = nv / 3;
  // face normals (area weighted) and creased, weighted vertex normals
  const fn = new Float32Array(nt * 3), fa = new Float32Array(nt), th = new Float32Array(nt), nor = new Float32Array(o);
  for (let t = 0; t < nt; t++) {
    const i = t * 9, ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l; fa[t] = l;
    th[t] = l / Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz));   // the triangle's height on its longest side
  }
  const map = new Map();
  for (let v = 0; v < nv; v++) {
    const k = (Math.round(P[v * 3] * 100) + 65536) * 17179869184 + (Math.round(P[v * 3 + 1] * 100) + 65536) * 131072 + Math.round(P[v * 3 + 2] * 100) + 65536;   // 17 bits an axis at 0.01 mm
    let a = map.get(k); if (!a) map.set(k, a = []); a.push(v);
  }
  for (const a of map.values()) for (const v of a) {
    const t = (v / 3) | 0, fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
    let nx = 0, ny = 0, nz = 0;
    for (const w of a) { const s = (w / 3) | 0, d = fx * fn[s * 3] + fy * fn[s * 3 + 1] + fz * fn[s * 3 + 2]; if (d > CREASE) { const wgt = fa[s] * fa[s]; nx += fn[s * 3] * wgt; ny += fn[s * 3 + 1] * wgt; nz += fn[s * 3 + 2] * wgt; } }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    // edge: a vertex whose smoothed normal leaves its face normal sits on a chamfer or a tight curve; a vertex where faces meet
    // at a hard angle sits on a sharp edge. The shader breaks this mask up into ragged wear.
    const dev = 1 - (nx * fx + ny * fy + nz * fz);                       // 0 flat .. 0.29 at 45 deg
    fin[v * 4 + 2] = Math.max(0, Math.min(1, (dev - 0.03) / 0.12)) * Math.max(0, Math.min(1, (2.6 - th[t]) / 1.2));
  }
  if (withAO) { const ao = new Float32Array(nv).fill(1); bakeAO(P, fn, nt, ao); for (let v = 0; v < nv; v++) { const k = Math.max(0, Math.min(1, (th[(v / 3) | 0] - 2.5) / 4)); fin[v * 4 + 3] = ao[v] + (1 - ao[v]) * k; } }
  const out = new Float32Array(o);
  for (let i = 0; i < o; i += 3) { out[i] = (P[i] - pivot[0]) * MM; out[i + 1] = (P[i + 1] - pivot[1]) * MM; out[i + 2] = (P[i + 2] - pivot[2]) * MM; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col.slice(0, o), 3));
  g.setAttribute('wfin', new THREE.BufferAttribute(fin.slice(0, nv * 4), 4));
  g.setAttribute('wpar', new THREE.BufferAttribute(par.slice(0, nv * 4), 4));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- shared small parts
function triggerBlade(x, y, len = 22, w = 6.5) {
  // pivot at (x, y); curved blade hanging down
  // a curved strip of even width that hooks forward at the tip
  return ext([[x - 3.5, y + 1], [x + 4, y + 1], [x + 4.6, y - len * 0.35, 6], [x + 2, y - len * 0.75, 8], [x + 4, y - len, 2], [x - 1.5, y - len - 0.6, 2], [x - 4.2, y - len * 0.7, 8], [x - 2.6, y - len * 0.3, 6]], w, 1.2);
}
// flip-up iron sight standing on a rail whose top is at y. front: post between two ears; rear: aperture ring
function ironSight(g, node, x, y, front, k = 1, color = C.anod) {
  const o = [], Y = (a) => y + 4.5 + (a - 4.5) * k;
  o.push(bx(x, x + 15, y - 5, y + 4.5, -12.2, 12.2, 1.0));                         // clamp base
  o.push(cylZ(x + 7.5, y - 1.5, 2.6, -13.6, -12, 0.4, 8));                          // cross-bolt head
  o.push(bx(x + 2, x + 13, y + 4, Y(9), -8, 8, 0.8));
  if (front) {
    o.push(ext([[x + 4, Y(8)], [x + 11.5, Y(8)], [x + 10, Y(34), 1.5], [x + 5.5, Y(34), 1.5]], 2.4, 0.6).translate(0, 0, 6.8), ext([[x + 4, Y(8)], [x + 11.5, Y(8)], [x + 10, Y(34), 1.5], [x + 5.5, Y(34), 1.5]], 2.4, 0.6).translate(0, 0, -6.8));
    o.push(bx(x + 5, x + 10.5, Y(8), Y(16), -6, 6, 0.5));
    o.push(cylY(x + 7.7, 0, 1.0, Y(15), Y(30), 0.2, 6));
  } else {
    o.push(bx(x + 5.5, x + 9.5, Y(8), Y(30) - 5, -7, 7, 0.7));
    o.push(at(rev([[5.5, 2.4], [5.5, 6.2], [9.5, 6.2], [9.5, 2.4], [5.5, 2.4]], 14), x, Y(30), 0));
    o.push(cylZ(x + 7.5, Y(13), 3.2, 7, 10.5, 0.5, 10));                            // windage knob
  }
  g.add(node, 'metal', color, o);
}
const pinZ = (x, y, r, hw) => cylZ(x, y, r, -hw, hw, 0.35, 16);
// cross pins that show both sides: the pin end with a dark gap ring round it (hw: half-length, 0.3 mm proud of the surface)
function pins(g, node, list, fin = FIN.pinDk) {
  for (const [x, y, r, hw] of list) { g.add(node, fin, 0, pinZ(x, y, r, hw)); g.add(node, 'metal', C.dark, both(ringZ(x, y, r + 0.55, r - 0.1, hw - 0.27, hw - 0.1, 16))); }
}
// socket-head screw on the +Z face at z, standing `proud` mm, with a real hex socket; side -1 puts it on the -Z face
function screwZ(g, node, x, y, r, z, proud = 0.9, side = 1, fin = FIN.screw) {
  const d = proud + 0.7; let head = at(ext(circ(x, y, r, 18), d, 0.3, [circ(x, y, r * 0.55, 6)]), 0, 0, z + proud - d / 2), floor = at(ext(circ(x, y, r * 0.62, 6), 0.3, 0), 0, 0, z + proud - 0.8);
  if (side < 0) { head = mirZ(head); floor = mirZ(floor); }
  g.add(node, fin, 0, head); g.add(node, 'metal', C.dark, floor);
}
// slotted screw head on the +Z face (two half discs with the slot between them)
function slotZ(g, node, x, y, r, z, proud = 0.7, side = 1, ang = 0.5, fin = FIN.screw) {
  const d = proud + 0.5, o = [];
  for (const s of [0, Math.PI]) o.push(at(ext(Array.from({ length: 9 }, (_, i) => { const a = ang + s + 0.16 + (Math.PI - 0.32) * i / 8; return [x + r * Math.cos(a), y + r * Math.sin(a)]; }), d, 0.25), 0, 0, z + proud - d / 2));
  let floor = at(ext(circ(x, y, r * 0.93, 10), 0.3, 0), 0, 0, z + proud - 0.65);
  if (side < 0) { o[0] = mirZ(o[0]); o[1] = mirZ(o[1]); floor = mirZ(floor); }
  g.add(node, fin, 0, o); g.add(node, 'metal', C.dark, floor);
}
// rows of thin dark grooves on a +/-Z face (serrations)
function serr(x0, x1, pitch, y0, y1, zHalf, slant = 0) {
  const o = [];
  for (let x = x0; x <= x1 + 1e-6; x += pitch) for (const s of [1, -1]) {
    const g = pb(x, x + pitch * 0.42, y0, y1, s * zHalf - 0.3, s * zHalf + 0.3);
    if (slant) rotZ(g, slant, x, (y0 + y1) / 2);
    o.push(g);
  }
  return o;
}

// a line of illegible engraved 'text': tiny light bars on a +/-Z face (generic roll-mark, no words)
function marks(x, y, n, zFace, h = 2.2, seed = 1) {
  return [];                                              // dropped: blocks read as fake text in close-up (round 3 critic)
  h *= 0.7;
  const o = []; let cx = x;
  for (let i = 0; i < n; i++) {
    const w = 0.4 + h3(i, seed, 3) * 0.9, gap = h3(i, seed, 4) > 0.8 ? 1.6 : 0.4, hh = h * (0.75 + 0.25 * h3(i, seed, 5));
    o.push(pb(cx, cx + w, y, y + hh, zFace - 0.25, zFace + 0.25)); cx += w + gap;
  }
  return o;
}
const MARK = 0x66686c;

// ================================================================ PISTOL: full-size polymer-framed striker 9 mm
function pistol() {
  const g = new Gun('pistol'), BY = 62;
  // frame: dust cover with one accessory slot, trigger guard, tang (proportions checked against photographs of the type)
  g.add('root', 'poly', C.poly, ext([[150, 49, 0.5], [150, 37.5, 1.5], [133, 37], [133, 40], [129, 40], [129, 37], [123, 37], [123, 40], [119, 40], [119, 37], [113, 37], [113, 40], [109, 40], [109, 37],
    [91, 36.5, 2], [89, 31.5, 2], [46, 31.5, 2], [44, 14, 4], [38, 9, 4], [34, 4, 2], [27, 14, 3], [-12, 16, 3], [-14, 49]], 25.6, 1.3));
  // trigger guard: a rounded strap, narrower than the frame, squared at the front
  g.add('root', 'poly', C.poly, ext([[92, 37], [91, 16]].concat(arc(79.5, 15.5, 11.5, 10.5, 0, -90, 6).slice(1), [[48, 6], [38, 9, 4], [36, 22], [42, 37]]), 16.5, 2.8,
    [[[84.5, 33, 3], [84.5, 20.5]].concat(arc(75.5, 20.5, 9, 7.5, 0, -90, 8).slice(1), [[52, 13], [45, 16.5, 4], [46, 33, 3]])], 3));
  // grip and rear frame: lofted (backstrap hump, tang, undercut), with a stippled sleeve
  const GS = [[48.8, 15, -29.5, 12.9, 3], [47, 16, -32.5, 13.3, 3], [44.5, 17.5, -33.5, 13.7, 2.9], [41, 19, -31.5, 14.1, 2.8], [36, 21, -28.5, 14.5, 2.8], [28, 25, -27, 14.9, 2.7], [16, 31, -29.5, 15.2], [6, 33.5, -33, 15.3], [-6, 29.5, -36.8, 15.3], [-20, 24.6, -39, 15.3],
    [-36, 19, -41, 15.4], [-48, 14.8, -42.8, 15.5, 2.6, -0.05], [-52.5, 13.2, -43.4, 15.4, 2.6, -0.12], [-54.5, 12, -43.6, 15.1, 2.6, -0.16], [-55.6, 10.5, -42, 13.8, 2.6, -0.16]];
  g.add('root', 'poly', C.poly, gripLoft(GS, 20));
  { const sl = gripSecs(GS.slice(6, 12), 20, 0.35).reverse(); g.add('root', 'grip', C.polyLt, loft(sl, false, false, 2, 8), loft(sl, false, false, 12, 18), loft(sl, false, false, 19, 21), loft(sl, false, false, 9, 11)); }
  // magazine release (left), slide stop (left), takedown tabs
  g.add('root', 'poly', C.poly, bx(21, 33, 10, 19, -16.6, -12, 0.8));
  g.add('root', 'poly', C.dark, serr(22.2, 31.5, 1.7, 11, 18, 16.5).filter((_, i) => i % 2 === 1));
  g.add('root', 'metal', C.nitride, bx(22, 46, 45.6, 47.6, -14.2, -12.5, 0.5), bx(13, 24, 43.5, 48.6, -15.6, -12.5, 0.7),
    both(bx(64, 68, 38.5, 45, 12.2, 13.9, 0.5)));
  g.add('root', 'metal', C.dark, serr(14.5, 22.5, 1.9, 44.2, 48, 15.5).filter((_, i) => i % 2 === 1));
  // pins
  pins(g, 'root', [[54, 38, 2.0, 12.95], [58, 44.5, 1.5, 12.95], [-10.5, 21.5, 1.6, 15.35]]);
  // barrel, chamber hood, guide rod
  g.add('root', 'metal', C.blued, at(rev([[60, 0], [60, 6.8], [155.8, 6.8], [156.5, 6.1], [156.5, 5.4], [155.6, 4.6], [150, 4.4]], 16), 0, BY, 0));
  g.add('root', 'metal', C.dark, at(rev([[150, 4.4], [140, 4.4], [140, 0]], 12), 0, BY, 0));
  g.add('root', 'metal', C.nitride, bx(43.3, 71.7, 54.5, 71.7, -8, 10.3, 0.7));
  g.add('root', 'metal', C.dark, pb(0, 43, 49.05, 49.6, -8, 8));
  g.add('root', 'metal', C.nitride, cylX(120, 156.3, 2.4, 52, 0, 0.5, 10));
  // slide
  const S = [[-12.9, 49.5], [-12.4, 49], [12.4, 49], [12.9, 49.5], [12.9, 66.5], [11.6, 70], [8.2, 72], [-8.2, 72], [-11.6, 70], [-12.9, 66.5]];
  const SN = [[-12.4, 49.2], [12.4, 49.2], [12.4, 66.6], [11.2, 69.8], [8, 71.8], [-8, 71.8], [-11.2, 69.8], [-12.4, 66.6]];
  g.node('slide');
  g.add('slide', 'metal', C.nitride,
    extX(S, -30, -27, 0.7), extX(S, 3.9, 43, 0), extX(SN, -27.5, 4.4, 0), Array.from({ length: 10 }, (_, i) => extX(S, -27 + i * 3 + 0.9, -27 + i * 3 + 3, 0.1)),
    extX(S, 72, 124, 0), extX(SN, 123.5, 142.5, 0), Array.from({ length: 6 }, (_, i) => extX(S, 124 + i * 3 + 0.9, 124 + i * 3 + 3, 0.1)),
    extX(S, 142, 156, 1.6, [circ(0, BY, 7.0, 16), circ(0, 52, 2.6, 10)]),
    extX([[-12.9, 49.5], [-12.4, 49], [12.4, 49], [12.9, 49.5], [12.9, 60.5], [10.7, 60.5], [10.7, 53.5], [-8.2, 53.5], [-8.2, 72], [-11.6, 70], [-12.9, 66.5]], 43, 72, 0));
  g.add('slide', 'metal', MARK, marks(60, 58, 16, -12.9, 2.6, 2), marks(84, 51, 9, 12.9, 1.6, 3));
  // sights (three-dot), extractor, rear cover plate
  g.add('slide', 'metal', C.nitride, bx(-28, -18, 71.5, 73.5, -8.1, 8.1, 0.5), bx(-28, -18.5, 73, 77, 2.1, 8.1, 0.6), bx(-28, -18.5, 73, 77, -8.1, -2.1, 0.6),
    ext([[143, 71.5], [152, 71.5], [151, 76.6, 0.5], [145, 76.6, 0.5]], 3.6, 0.5), bx(22, 42, 61, 63.6, 12.2, 13.25, 0.3));
  g.add('slide', 'metal', C.white, cylX(-28.35, -27.8, 1.05, 75, 5.1, 0, 8), cylX(-28.35, -27.8, 1.05, 75, -5.1, 0, 8), cylX(144.0, 145.2, 1.1, 74.6, 0, 0, 8));
  g.add('slide', 'metal', 0x303236, bx(-30.35, -29.6, 52, 65, -6.5, 6.5, 0.5));
  // magazine: steel body in the grip, polymer floor plate, top round
  g.node('mag');
  g.add('mag', 'poly', 0x2c2c2e, ext([[9.4, 46, 1], [42.4, 46, 1], [6.5, -58.5], [-24.8, -53.5]], 21, 1.2));
  g.add('mag', 'poly', C.poly, ext([[-45.5, -49.5, 1.5], [13, -59.3, 1.5], [14.5, -65.5, 2], [-46.5, -55.7, 2]], 28, 1.6));
  g.add('mag', 'poly', C.brass, at(rev([[13, 0], [13, 4.9], [29, 4.9], [33, 4.3], [38, 2.2], [39.5, 0]], 10), 0, 51.5, 0));
  // trigger with safety blade
  g.node('trigger', [57, 40, 0]);
  g.add('trigger', 'poly', C.poly, triggerBlade(57, 40, 25, 7.5));
  const root = g.finish();
  return { root, meta: { muzzle: V(156.5, BY, 0), eject: V(57, 65, 11), ejectDir: [-0.15, 0.6, 0.78], support: V(6, -14, -17), stock: null, sightY: 77 * MM,
    moving: { slide: { node: 'slide', axis: [-1, 0, 0], travel: 0.043 }, mag: { node: 'mag' }, trigger: { node: 'trigger' } } } };
}

// ================================================================ SMG: compact 9 mm, monolithic upper, telescoping stock (collapsed)
function smg() {
  const g = new Gun('smg'), BY = 78;
  const U = [[-19, 56, 2], [19, 56, 2], [19, 65], [17.4, 66.6], [17.4, 81.4], [19, 83], [19, 94, 0], [13.5, 99.5, 0], [-13.5, 99.5, 0], [-19, 94, 0], [-19, 83], [-17.4, 81.4], [-17.4, 66.6], [-19, 65]];   // a milled flute down each side
  g.add('root', 'metal', C.anod,
    extX(U, -95, 70, 1.0), extX(U, 115, 121, 1.0),
    extX([[-19, 56], [19, 56], [19, 70], [16, 70], [16, 59], [-16, 59], [-16, 96.5], [16, 96.5], [16, 88], [19, 88], [19, 94], [13.5, 99.5], [-13.5, 99.5], [-19, 94]], 68.9, 116.1, 0),
    rail(-92, 202, 99.3),
    bx(-99, -94.5, 54, 101, -20, 20, 1.5));                                         // rear cap
  // handguard: a shell with real through-slots (side plates, top and bottom slabs, front cap); the barrel shows inside
  const HG = [[-17, 57.5, 2], [17, 57.5, 2], [17, 94.5, 0], [12.5, 99.5, 0], [-12.5, 99.5, 0], [-17, 94.5, 0]];
  const hole = (x0, x1, y0, y1) => { const r = Math.min(3.4, (y1 - y0) * 0.49); return [[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]]; };
  const big = [hole(130, 160, 68, 75.5), hole(168, 198, 68, 75.5)], vents = [128, 140, 152, 164, 176, 188].map((x) => hole(x, x + 8, 81, 84.2));
  const side = (holes) => ext([[120, 58], [205, 58], [205, 95], [120, 95]], 2.6, 0.5, holes);
  g.add('root', 'metal', C.anod, side(big.concat(vents)).translate(0, 0, 15.7), side(big.concat([hole(124, 198, 85.4, 88.8)])).translate(0, 0, -15.7),
    extX([[-17, 92.5], [17, 92.5], [17, 94.5], [12.5, 99.5], [-12.5, 99.5], [-17, 94.5]], 120, 205, 0.8), bx(120, 205, 57.5, 60.5, -17, 17, 1.2),
    extX(HG, 201.5, 205, 0.8, [circ(0, BY, 9.2, 14)]));
  // barrel and three-lug style muzzle with flash hider
  g.add('root', 'metal', C.blued, at(rev([[112, 0], [112, 8], [224, 8], [225, 9.6], [228, 9.6], [229, 8], [232, 8], [233, 10], [249, 10], [250, 9], [250, 4.7], [236, 4.5]], 16), 0, BY, 0));
  g.add('root', 'metal', C.dark, at(rev([[236, 4.5], [215, 4.5], [215, 0]], 10), 0, BY, 0));
  for (let i = 0; i < 4; i++) { const s = pb(236, 247, -1.3, 1.3, 9.80, 10.33); s.rotateX(i * Math.PI / 2 + Math.PI / 4); g.add('root', 'metal', C.dark, at(s, 0, BY, 0)); }
  // charging handle (left, forward) in its slot
  g.add('root', 'metal', C.nitride, bx(176, 186, 83.5, 90.5, -27, -16.5, 1.2), bx(176, 180, 82.5, 91.5, -28.5, -25.5, 0.8));
  // lower: trigger housing, magazine well, guard
  // moulded lower: a rounded trigger housing that necks in behind the magazine well, a separate guard strap, beavertail
  g.add('root', 'poly', C.poly, ext([[148, 57], [148, 10, 3], [101, 8, 2], [100, 33, 3], [44, 35, 3], [34, 27, 4], [-28, 40, 6], [-60, 48, 3], [-60, 57]], 34, 3.2, null, 3),
    ext([[-18, 48], [-40, 51, 4], [-43, 45, 3], [-28, 33, 8], [-16, 34]], 27, 3.5, null, 2));
  g.add('root', 'poly', C.poly, ext([[98.5, 39], [97.5, 30]].concat(arc(70, 30, 27.5, 24, -4, -176, 14), [[42.5, 30], [41.5, 39], [48, 39], [48, 30]], arc(70, 30, 22, 18.4, -176, -4, 14), [[92, 30], [92, 39]]), 15, 2.2, null, 3));
  g.add('root', 'poly', C.poly, ext([[149.5, 30, 2], [152, 7, 3], [99.5, 3, 3], [101, 22, 2]], 37.4, 3.4, null, 3));  // flared magazine well
  g.add('root', 'poly', C.poly, both(bx(-44, 97, 48.2, 51.2, 16.2, 18.1, 1.0)), [108, 116, 124, 132, 140].map((x) => both(ext([[x, 34, 1.5], [x + 4, 34, 1.5], [x + 4.6, 12, 1.5], [x + 0.6, 12, 1.5]], 1.2, 0.5).translate(0, 0, 17.2))),
    [-8, 0, 8].map((z) => bx(147, 149.6, 12, 52, z - 2.2, z + 2.2, 1.0)));
  g.add('root', 'metal', C.anod, both(bx(-90, 66, 57, 63.5, 18.4, 20.2, 0.9)), both(bx(-93, 66, 84.5, 93.6, 18.4, 19.9, 0.9)), bx(57, 69, 68, 84, 17, 21.6, 1.4));
  g.add('root', 'metal', C.dark, pb(70, 115, 59.3, 96.2, -15.95, -15.5), pb(70, 115, 59.05, 59.5, -15.9, 15.9));  // lower rib, case deflector
  // pistol grip with a finger step and a curved backstrap
  g.add('root', 'grip', C.polyLt, gripLoft([[45, 30, -25, 13.5, 3.4], [38, 30, -24, 13.8, 3.4], [26, 29, -16, 14, 3.4], [13, 27, -19.5, 14.2, 3.6], [1, 22.5, -23, 14.3, 3.6], [-7, 24, -27, 14.4, 3.6], [-16, 17.5, -30.5, 14.5, 3.6], [-36, 10.5, -34.5, 14.6, 3.6], [-54, 5, -38, 14.6, 3.6], [-58.5, 3.5, -38, 13.9, 3.2], [-60, 1.5, -36, 12.3, 3]]));
  // controls: selector both sides, magazine release paddle, bolt release, pins
  g.add('root', 'metal', C.nitride, both(cylZ(8, 47, 5, 16.8, 18.8, 0.5, 18)), both(rotZ(bx(6, 20, 44.6, 49.4, 18.5, 20.9, 0.9), -0.5, 8, 47)),
    bx(60, 74, 50, 55.5, -19.6, -17.4, 0.6), bx(96.5, 100.5, 12, 30, -8, 8, 0.8));
  pins(g, 'root', [[138, 50, 2.6, 17.3], [-45, 52, 2.6, 18.2], [64, 44, 1.6, 17.3], [40, 46, 1.6, 17.3]]);
  g.add('root', 'poly', C.poly, both(cylZ(-45, 52, 5, 17, 17.9, 0.5)));
  for (const s of [1, -1]) { for (const [x, y] of [[-62, 60.2], [-8, 60.2], [62, 60.2], [-62, 89]]) screwZ(g, 'root', x, y, 1.9, 20.2, 0.7, s); for (const [x, y] of [[126, 62], [200, 62], [200, 90]]) screwZ(g, 'root', x, y, 1.9, 17, 0.7, s); }
  g.add('root', 'metal', MARK, marks(-52, 76, 14, -19, 2.4, 5), marks(-52, 71.5, 9, -19, 1.8, 6), marks(18, 64, 10, 19, 1.8, 7));
  g.add('root', FIN.paint, 0x8c8c88, both(cylZ(-2, 54.5, 0.9, 16.8, 17.2, 0, 10))); g.add('root', FIN.paint, 0x7a1c18, both(cylZ(18, 54.5, 0.9, 16.8, 17.2, 0, 10)));
  // hand stop under the handguard, short lower rail
  g.add('root', 'poly', C.poly, ext([[200, 56.5], [203, 44, 3], [192, 40, 3], [176, 56.5]], 22, 2));
  // telescoping stock, nearly closed: two rods in side lugs, a yoke and a thin rubber butt pad
  g.add('root', 'metal', C.nitride, both(cylX(-150, -20, 3.4, 66, 22.6, 0.5, 10)));
  g.add('root', 'metal', C.anod, both(extX([[17, 59.5], [26, 59.5, 2.5], [27.6, 66, 2], [26, 72.5, 2.5], [17, 72.5]], -93, -16, 1.5)), bx(-153, -146, 59, 73, -27, 27, 1.6));
  g.add('root', 'poly', C.rubber, ext([[-151, 101, 4], [-151, 43, 4], [-160, 40, 5], [-163, 101, 5]], 31, 4, null, 2));
  g.add('root', 'poly', C.dark, [50, 60, 70, 80, 90].map((y) => pb(-163.3, -162.7, y, y + 3, -10, 10)));
  // sling loop (left rear)
  g.add('root', 'metal', C.nitride, ringZ(-84, 86, 6.5, 4.2, -22, -19.5, 12));
  // sights
  ironSight(g, 'root', -84, 104.9, false, 0.62); ironSight(g, 'root', 180, 104.9, true, 0.62);
  // bolt, seen through the ejection port
  g.node('bolt');
  g.add('bolt', 'metal', 0x505256, bx(36, 103, 60.5, 95.5, -15.4, 13.6, 1.6), bx(102, 115, 62, 94, -15.5, 13, 1.0), bx(72, 100, 82, 91, 13, 14.4, 0.8));
  g.add('bolt', 'metal', C.steel, bx(98, 113.5, 75.5, 80.5, 12.4, 14.2, 0.5), cylZ(60, 78, 3, 13, 14.5, 0.4, 8));
  // magazine: translucent-look dark polymer, gently curved
  g.node('mag');
  g.add('mag', 'poly', 0x1a1a1c, ext([[142, 50], [142, 8], [144.5, -45, 80], [151, -103, 2], [119, -108, 2], [112, -45, 80], [109, 8], [109, 50]], 22, 1.5),
    [0.18, 0.5, 0.82].map((f) => { const xt = 109 + f * 29.5, xm = 112 + f * 29, xb = 119 + f * 28.5; return ext([[xt, 2], [xt + 3.5, 2], [xm + 3.5, -45, 60], [xb + 3.5, -100], [xb, -100], [xm, -45, 60]], 23.8, 0.8); }));
  g.add('mag', 'poly', C.poly, ext([[153.5, -101.5, 2], [154.5, -108.5, 2], [117.5, -114.5, 2], [116.5, -106.5, 2]], 25.5, 2));
  g.add('mag', 'poly', C.dark, [-10, -40, -70].map((y, i) => both(pb(114 + i * 1.5, 141 + i * 2.5, y, y + 1.4, 10.80, 11.33))));
  g.node('trigger', [64, 42, 0]);
  g.add('trigger', 'metal', C.nitride, triggerBlade(64, 42, 28, 7.5));
  const root = g.finish();
  return { root, meta: { muzzle: V(250, BY, 0), eject: V(98, 80, 19), ejectDir: [0.1, 0.45, 0.89], support: V(170, 56, 0), stock: V(-163, 70, 0), sightY: 123.5 * MM,
    moving: { bolt: { node: 'bolt', axis: [-1, 0, 0], travel: 0.05 }, mag: { node: 'mag' }, trigger: { node: 'trigger' } } } };
}

// ================================================================ RIFLE: 5.56 gas carbine, flat-top, free-float handguard, six-position stock
function rifle() {
  const g = new Gun('rifle'), BY = 90;
  const R = [[-15, 72], [15, 72], [15, 97], [14, 101.5], [10.6, 106.5], [10.6, 114.5], [-10.6, 114.5], [-10.6, 106.5], [-14, 101.5], [-15, 97]];
  // upper receiver in three lengths around a real ejection port
  g.add('root', 'metal', C.anod, extX(R, -36, 75, 1.0), extX(R, 132, 160, 1.0),
    extX([[-15, 72], [15, 72], [15, 83], [12.5, 83], [12.5, 75], [-12.5, 75], [-12.5, 103], [12.5, 103], [12.5, 97], [15, 97], [14, 101.5], [10.6, 106.5], [10.6, 114.5], [-10.6, 114.5], [-10.6, 106.5], [-14, 101.5], [-15, 97]], 73.9, 133.1, 0),
    rail(-34, 158, 114.3));
  // brass deflector, forward assist, open dust cover with its hinge
  const fa = rev([[-7, 0], [-7, 4.9], [-6, 5.6], [-2, 5.6], [-1, 4.8], [24, 4.8], [24, 0]], 12); fa.rotateY(0.5); at(fa, 52, 97, 14.5);
  g.add('root', 'metal', C.anod, ext([[56, 84], [74, 84], [74, 99], [69, 99, 2]], 6.5, 1.0).translate(0, 0, 16.5), fa,
    bx(75, 132, 66.5, 81, 15.2, 17, 0.5), cylX(72, 135, 1.5, 81.6, 15.8, 0.3, 8), bx(99, 108, 71.5, 76, 16.6, 18, 0.4), bx(80, 127, 69, 79, 16.6, 17.4, 0.6));
  // charging handle
  g.add('root', 'metal', C.anod, bx(-50, -37, 103.5, 111, -21, 21, 1.4), bx(-51, -36, 102, 106, -25, -15, 0.9), bx(-40, -20, 106, 110, -6, 6, 0.6));
  // lower receiver with buffer tower, magazine well, guard
  // forged lower: fire-control body, a wider magazine well with a rounded front, pin bosses, the buffer-tube ring, a flat guard strap
  g.add('root', 'metal', C.anod, ext([[160, 72, 1], [160, 59, 4], [149, 54, 3], [148, 39], [84, 39], [30, 38.5, 3], [14, 30, 3], [-24, 37, 5], [-48, 46, 3], [-48, 84], [-36, 84], [-36, 72]], 24.4, 1.3),
    ext([[149, 68, 2], [148.5, 7, 3], [82, 10, 3], [80, 40, 3], [86, 68, 3]], 29.4, 3.4, null, 3),
    cylX(-48, -36, 17.8, BY, 0, 1.4, 18),
    ext(arc(56.5, 27, 31.5, 20.5, -14, -166, 14).concat(arc(56.5, 27, 26.2, 15.2, -166, -14, 14)), 15, 2.0, null, 2),
    both(bx(-22, 79, 60, 70.8, 11.6, 13.2, 1.1)), both(cylZ(153, 64, 6.4, 11, 13.5, 0.8, 20)), both(cylZ(-27, 56, 6.4, 11, 13.5, 0.8, 20)),
    [-7, 0, 7].map((z) => bx(147.4, 150.2, 14, 62, z - 1.8, z + 1.8, 0.9)), both(bx(-47, -37, 60, 80, 9, 13.4, 1.6)));
  g.add('root', 'metal', C.anod, ext([[150, 15, 2], [151, 5.5, 2.5], [81, 9, 2.5], [81, 15, 2]], 30.6, 2.2), ringZ(93, 47, 7.6, 5.5, 13.6, 16.6, 12),
    both(ext([[72, 81.5, 2], [136, 81.5, 2], [136, 99.5, 3], [72, 99.5, 3]], 1.2, 0.5, [[[76.5, 83.6, 2], [131, 83.6, 2], [131, 96.6, 2], [76.5, 96.6, 2]]]).translate(0, 0, 15.3)).slice(0, 1));
  g.add('root', 'metal', C.dark, at(rev([[76, 13.2], [131, 13.2]].reverse(), 12), 0, BY, 0));
  // pistol grip with a finger step and a curved backstrap
  g.add('root', FIN.gripCk, 0, gripLoft([[45, 31, -23, 12, 3.4], [39, 31, -23, 12.4, 3.4], [28, 30.5, -13, 13, 3.4], [17, 30, -17, 13.6, 3.6], [3, 25, -22, 14, 3.8], [-5, 27, -27, 14.1, 3.8], [-14, 20, -32, 14.2, 3.8], [-36, 7.5, -41, 14.4, 3.8], [-54, -4, -47.5, 14.4, 3.8], [-58.5, -6, -48, 13.8, 3.4], [-60, -8, -46, 12.2, 3]]));
  // controls
  g.add('root', 'metal', C.anod, both(cylZ(12, 54, 5, 11.5, 14, 0.5)), rotZ(bx(12, 30, 52.3, 55.7, -15.6, -13.4, 0.6), 0.0, 12, 54),
    bx(84, 96, 66, 86, -17.4, -14.2, 0.8), bx(86, 94, 76, 86, -18.8, -16.7, 0.8),
    cylZ(93, 47, 5, 14.2, 17.4, 0.5));
  g.add('root', 'metal', C.dark, serr(88.5, 96, 1.6, 43.5, 50.5, 17.45).filter((_, i) => i % 2 === 0));
  pins(g, 'root', [[153, 64, 3.2, 13.8], [-27, 56, 3.2, 13.8], [54, 46, 2, 12.5], [33, 49, 2, 12.5], [84.5, 20.5, 1.4, 7.3]]);
  g.add('root', 'metal', MARK, marks(100, 46, 12, -13.2, 2.4, 8), marks(100, 41.5, 8, -13.2, 1.8, 9), marks(104, 36, 10, -13.2, 1.6, 10), marks(-2, 60.5, 4, -14, 1.6, 11), marks(22, 46, 4, -13.2, 1.6, 12));
  // castle nut, end plate with sling loop, buffer tube
  g.add('root', 'metal', C.park, at(rev([[-60, 0], [-60, 17.5], [-52, 17.5], [-52, 0]], 12), 0, BY, 0), bx(-52, -48.2, 66, 108, -16, 16, 1.2));
  g.add('root', 'metal', C.park, ringZ(-50, 70, 7, 4.5, -19, -16.4, 12));
  g.add('root', 'metal', C.anod, at(rev([[-232, 0], [-232, 14.6], [-48, 14.6]], 16), 0, BY, 0));
  // stock: a shell round the buffer tube, a triangular web under it, butt flange and rubber pad, latch lever
  g.add('root', 'poly', C.poly, ext([[-98, 107, 6], [-246, 108, 4], [-246, 71, 4], [-98, 72, 6]], 31, 8, null, 3),
    ext([[-146, 75], [-246, 75], [-246, 22, 5], [-232, 20, 4]], 20, 3, [[[-236, 42, 4], [-236, 67, 4], [-180, 67, 4]]]),
    ext([[-240, 109, 3], [-240, 20, 3], [-251, 20, 2], [-251, 109, 2]], 33, 4, null, 2), bx(-150, -112, 63, 73, -8, 8, 2.2));
  g.add('root', 'poly', C.rubber, ext([[-250.5, 109, 3], [-250.5, 20, 3], [-257, 21, 3], [-258, 109, 3]], 34, 4, null, 2));
  g.add('root', 'poly', C.dark, [30, 42, 54, 66, 78, 90].map((y) => pb(-258.3, -257.7, y, y + 5, -11, 11)), both(pb(-238, -220, 96, 100, 15.2, 15.8)));
  // barrel: under the handguard, gas block, exposed length, birdcage flash hider
  g.add('root', 'metal', 0x2f3032, at(rev([[160, 0], [160, 9.5], [300, 9.5], [300, 11.5], [326, 11.5], [326, 9.3], [506, 9.3], [507, 11], [511, 11], [512, 8.5], [516, 8.5], [517, 11], [549, 11], [550, 10], [550, 5], [520, 5]], 16), 0, BY, 0));
  g.add('root', 'metal', C.dark, at(rev([[520, 5], [500, 3], [500, 0]], 10), 0, BY, 0));
  for (let i = 0; i < 5; i++) { const s = pb(522, 544, -1.5, 1.5, 10.80, 11.33); s.rotateX((i - 2) * Math.PI / 3.2 - Math.PI / 2); g.add('root', 'metal', C.dark, at(s, 0, BY, 0)); }
  // free-float handguard: eight plates round the bore with real through-slots (the barrel and gas tube show inside), top rail, end rings
  const OCT = [[-8.3, 70], [8.3, 70], [20, 81.7], [20, 98.3], [8.3, 110], [-8.3, 110], [-20, 98.3], [-20, 81.7]];
  const slotHole = (x) => [[x, BY - 3.5, 3.4], [x + 32, BY - 3.5, 3.4], [x + 32, BY + 3.5, 3.4], [x, BY + 3.5, 3.4]];
  for (let k = 0; k < 8; k++) {
    const xs = k === 2 ? [] : k % 2 ? [203.5, 246.5, 289.5, 332.5, 375.5] : [182, 225, 268, 311, 354, 397];
    const pl = ext([[166, BY - 9.3], [435, BY - 9.3], [435, BY + 9.3], [166, BY + 9.3]], 2.4, 0.5, xs.length ? xs.map(slotHole) : null);
    pl.translate(0, -BY, 18.8); pl.rotateX(-k * Math.PI / 4); pl.translate(0, BY, 0);
    g.add('root', 'metal', C.anod, pl);
  }
  g.add('root', 'metal', C.anod, extX(OCT, 161, 167, 0.8, [circ(0, BY, 13, 16)]), extX(OCT, 434, 440, 0.8, [circ(0, BY, 14.5, 16)]),
    bx(161, 440, 108.5, 114.6, -10.6, 10.6, 0.8), rail(163, 438, 114.3), ringX(157, 162, 19.5, 12, BY, 0, 16));
  g.add('root', 'metal', C.steel, cylX(160, 314, 2.3, BY + 13.2, 0, 0.3, 8));
  for (const s of [1, -1]) for (const x of [174, 428]) screwZ(g, 'root', x, 90, 2.6, 20, 0.7, s);
  ironSight(g, 'root', -30, 119.9, false, 0.76); ironSight(g, 'root', 418, 119.9, true, 0.76);
  // bolt carrier, seen through the ejection port
  g.node('bolt');
  g.add('bolt', 'metal', 0x4e5053, at(rev([[0, 0], [0, 12.4], [108, 12.4], [109, 11.4], [113, 11.4], [114, 12.4], [132, 12.4], [133, 11], [133, 0]], 14), 0, BY, 0));
  g.add('bolt', 'metal', C.steel, bx(84, 100, 86.5, 93.5, 11, 13.3, 0.6), cylZ(121, BY, 3, 11, 13.2, 0.5, 8));
  // 30-round magazine, curved, ribbed
  g.node('mag');
  g.add('mag', 'metal', 0x505356, ext([[142, 60], [141.5, 5], [147, -50, 80], [170, -100, 2], [113, -121, 2], [92, -50, 80], [84, 5], [83.5, 60]], 22.4, 1.6),
    [0.3, 0.64].map((f) => { const xt = 84 + f * 57.5, xm = 92 + f * 55, xb = 115 + f * 57, yb = -113 + f * 21; return ext([[xt, 4], [xt + 4, 4], [xm + 4, -50, 60], [xb + 4, yb], [xb, yb], [xm, -50, 60]], 24.4, 1.0); }));
  g.add('mag', 'metal', 0x2c2d2f, cylZ(143, -112, 2.6, -13.2, 13.2, 0.5, 8));
  g.add('mag', 'metal', 0x2c2d2f, ext([[172.5, -98.5, 2], [174.5, -105.5, 2], [112.5, -128, 2], [110.5, -120, 2]], 26, 2));
  g.node('trigger', [58, 44, 0]);
  g.add('trigger', 'metal', C.nitride, triggerBlade(58, 44, 29, 7.5));
  const root = g.finish();
  return { root, meta: { muzzle: V(550, BY, 0), eject: V(104, 90, 16), ejectDir: [0.25, 0.3, 0.92], support: V(300, 70, 0), stock: V(-258, 64, 0), sightY: 143.8 * MM,
    moving: { bolt: { node: 'bolt', axis: [-1, 0, 0], travel: 0.095 }, mag: { node: 'mag' }, trigger: { node: 'trigger' } } } };
}

// ================================================================ SHOTGUN: 12-gauge pump, 18.5 in barrel, walnut furniture
function shotgun() {
  const g = new Gun('shotgun'), BY = 48, TY = 21;
  const R = [[-20, 0, 6], [20, 0, 6]].concat(arc(0, 42, 20, 22, 0, 180, 12));
  const Rp = outline(R).map((q) => [q.x, q.y]), rs = (x, top, w) => Rp.map(([z, y]) => [x, y > 40 ? 40 + (y - 40) * top : y, z * w]);
  g.add('root', 'metal', C.blued, loft([rs(7, 0.58, 0.95), rs(13, 0.74, 0.98), rs(22, 0.87, 1), rs(34, 0.96, 1), rs(50, 1, 1), rs(118, 1, 1)]), extX(R, 186, 205, 1.0),
    extX([[-20, 0, 6], [20, 0, 6], [20, 37], [17, 37], [17, 3], [-17, 3]].concat(arc(0, 42, 17, 19, 180, 40, 10), arc(0, 42, 20, 22, 40, 180, 10)), 117.4, 187.1, 0));
  g.add('root', 'metal', MARK, marks(48, 30, 14, -20, 2.6, 13), marks(245, 47, 20, -12.42, 1.6, 14));
  // loading port (dark), pins
  g.add('root', 'metal', C.dark, pb(96, 182, -0.3, 0.2, -11, 11));
  pins(g, 'root', [[66, 15, 2.6, 20.3], [108, 12, 2.6, 20.3]]);
  // barrel, bead, magazine tube with cap, barrel ring
  g.add('root', 'metal', C.blued, at(rev([[195, 0], [195, 14], [217, 14], [225, 12.4], [654, 11.2], [655, 10.4], [655, 9.3], [615, 9.3]], 18), 0, BY, 0));
  g.add('root', 'metal', C.dark, at(rev([[615, 9.3], [595, 9.3], [595, 0]], 12), 0, BY, 0));
  g.add('root', 'metal', C.brass, cylY(647, 0, 1.6, BY + 10.5, BY + 14, 0.6, 8));
  g.add('root', 'metal', C.blued, at(rev([[195, 0], [195, 12.6], [561, 12.6]], 16), 0, TY, 0), at(rev([[583, 14.6], [587, 12], [589, 8], [589, 0]], 16), 0, TY, 0),
    ext([[549, TY], [549, BY], [561, BY], [561, TY]], 9, 1), ringX(549, 561, 14.2, 11, BY, 0, 16), ringX(549, 561, 15, 12, TY, 0, 16));
  g.add('root', FIN.knurl, 0, at(rev([[561, 12.6], [561, 14], [562, 14.6], [583, 14.6]], 16), 0, TY, 0));
  g.add('root', 'metal', C.nitride, cylY(575, 0, 3.2, TY - 19.5, TY - 14, 0.8, 10));
  // trigger plate with an oval guard, cross-bolt safety, action release
  g.add('root', 'metal', C.anod, ext([[36, 2], [128, 2], [127, -3.5, 2], [123, -5]].concat(arc(82, -5, 40, 30, -6, -174, 14), [[41, -5], [40, -4, 3]]), 15, 2.4,
    [[[115.5, -5.5]].concat(arc(82, -6, 32.5, 22, -3, -177, 14), [[48.5, -5.5]])], 2));
  // the receiver's nose tapers to the barrel and tube; inside the port: shell carrier and chamber mouth (seen when the action is open)
  g.add('root', 'metal', C.blued, loft([[205, 1, 1], [211, 0.93, 0.9], [219, 0.8, 0.74]].map(([x, sy, sz]) => Rp.map(([z, y]) => [x, 32 + (y - 32) * sy, z * sz]))));
  g.add('root', 'metal', C.steel, bx(121, 183, 6, 9, -13, 13, 1.0), ringX(182, 186.5, 15.5, 10.2, BY, 0, 16));
  pins(g, 'root', [[45.5, -5, 2.8, 7.8]]); g.add('root', 'metal', C.nitride, bx(119, 127, -6.5, -2.5, -9.6, -7, 0.6));
  // walnut stock, recoil pad, sling stud
  // station: [x, top, bottom, half-width, squareness]
  const ST = [[8, 52.6, 1.6, 18.2, 4.5], [1, 50, -5, 19, 3.2], [-9, 41.5, -14, 18.2, 2.6], [-21, 33.5, -21.5, 17.4, 2.3], [-34, 28.5, -25.5, 17, 2.3], [-48, 27.5, -27, 17, 2.3], [-62, 29.5, -26.5, 17.4, 2.3], [-80, 32.5, -30.5, 18.2, 2.4],
    [-110, 34, -40, 19.3, 2.5], [-160, 32, -55, 20.4, 2.6], [-220, 28.5, -73, 21.2, 2.7], [-284, 24.5, -92, 21.5, 2.8]];
  const sect = (q, grow = 0, n = 20) => ell(q[0], (q[1] + q[2]) / 2, (q[1] - q[2]) / 2 + grow, q[3] + grow, q[4], n);
  const stAt = (x) => {                                   // Catmull-Rom through the stations (they run from +x to -x)
    let i = 0; while (i < ST.length - 2 && x < ST[i + 1][0]) i++;
    const p0 = ST[Math.max(0, i - 1)], p1 = ST[i], p2 = ST[i + 1], p3 = ST[Math.min(ST.length - 1, i + 2)], t = (x - p1[0]) / (p2[0] - p1[0]);
    return p1.map((_, k) => k === 0 ? x : 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t));
  };
  const xs = []; for (let x = 8; x > -284; x -= x > -120 ? 6.5 : 20) xs.push(x); xs.push(-284);
  g.add('root', 'wood', C.wood, loft(xs.map((x) => sect(stAt(x)))));
  const pe = ST[ST.length - 1];
  g.add('root', 'poly', C.poly, loft([sect([-282.5, pe[1], pe[2], pe[3], pe[4]], 0.25), sect([-286, pe[1], pe[2], pe[3], pe[4]], 0.25)]));
  g.add('root', 'grip', 0x0c0c0c, loft([sect([-285.5, pe[1], pe[2], pe[3], pe[4]]), sect([-296, pe[1] - 0.5, pe[2] + 1, pe[3] - 0.5, pe[4]]), sect([-300, pe[1] - 4, pe[2] + 5, pe[3] - 4, pe[4]])]));
  g.add('root', 'metal', C.nitride, cylY(-205, 0, 3.2, -75, -64, 0.8, 10));
  // cut checkering on the wrist: a pointed panel each side that follows the surface (stipple-mapped, darker)
  for (const side of [0, Math.PI]) {
    const secs = [[-4, 0.03], [-13, 0.34], [-22, 0.62], [-31, 0.78], [-40, 0.62], [-49, 0.34], [-58, 0.03]].map(([x, w]) => {
      const q = stAt(x), cy = (q[1] + q[2]) / 2 - 3, hy = (q[1] - q[2]) / 2 + 0.3, hz = q[3] + 0.3, pw = 2 / q[4];
      return Array.from({ length: 7 }, (_, i) => { const a = side + (i / 6 - 0.5) * 2 * w, c = Math.cos(a), sn = Math.sin(a); return [x, cy + 3 + hy * Math.sign(sn) * Math.abs(sn) ** pw, hz * Math.sign(c) * Math.abs(c) ** pw]; });
    });
    g.add('root', 'grip', 0x4a2c16, loft(secs.reverse(), false, false, 0, 6));
  }
  // pump: ribbed fore-end that cradles the barrel, action bars, and the bolt (it travels with the pump)
  g.node('pump');
  const sec = (rz, ry) => Array.from({ length: 16 }, (_, i) => [rz * Math.cos(i / 16 * Math.PI * 2), TY + 5 + ry * Math.sin(i / 16 * Math.PI * 2)]);
  // smooth walnut fore-end, swelling to a lip at the rear, with a panel of fine finger grooves cut into each side
  const FE = [[296, 20, 23], [297.5, 23.2, 26.4], [304, 24, 27.2], [313, 23.4, 26.6], [332, 22.6, 25.8], [400, 22.2, 25.4], [460, 22.6, 25.7], [476, 23, 26], [481.5, 22.4, 25.2], [484, 20, 23]];
  const fe = (q, grow = 0) => ell(q[0], TY + 5, q[2] + grow, q[1] + grow, 2.3, 20);
  g.add('pump', 'wood', C.woodDk, loft(FE.map((q) => fe(q))));
  { const gs = [[333, 22.6, 25.8], [366, 22.4, 25.6], [400, 22.2, 25.4], [434, 22.4, 25.55], [459, 22.6, 25.7]].map((q) => fe(q, 0.3)); g.add('pump', FIN.groove, C.woodDk, loft(gs, false, false, 16, 22), loft(gs, false, false, 8, 14)); }
  g.add('pump', 'metal', C.blued, both(bx(190, 300, TY - 3, TY + 3, 13.2, 15.2, 0.5)));
  g.add('pump', FIN.bolt, 0, extX([[-16.4, 31, 1], [16.4, 31, 1]].concat(arc(0, 42, 16.4, 17.6, 0, 180, 10)), 124, 186.2, 1.0));
  g.add('pump', 'metal', 0x55575b, bx(168, 185.5, 44, 48.5, 15.2, 17, 0.4));
  g.add('pump', 'metal', C.dark, pb(130, 162, 35.4, 37.6, 16.1, 16.72), pb(126, 127.2, 32, 56, 16.1, 16.72));
  // inside of the receiver (far wall, floor) in dull steel with an ejector strip, so the open action shows an interior, not a void
  g.add('root', FIN.inner, 0, pb(118, 186, 3.1, 60, -16.95, -16.5), pb(118, 186, 3.05, 3.5, -16.9, 16.9)); g.add('root', 'metal', C.steel, bx(124, 181, 43.5, 46.5, -16.6, -15.3, 0.5));
  // a shell (stands in for the magazine: the tube is fixed). Sits out of sight above the loading port.
  g.node('mag', [140, 14, 0]);
  const cs = casingGeo('shotgun', true); g.add('mag', 'poly', C.hull, at(cs.hull, 110, 14, 0)); g.add('mag', 'poly', C.brass, at(cs.head, 110, 14, 0));
  g.node('trigger', [82, -2, 0]);
  g.add('trigger', 'metal', C.steel, triggerBlade(82, -2, 23, 6.5));
  const root = g.finish();
  return { root, meta: { muzzle: V(655, BY, 0), eject: V(152, 47, 20), ejectDir: [0.1, 0.35, 0.93], support: V(390, TY - 2, 0), stock: V(-300, -34, 0), sightY: (BY + 14) * MM,
    moving: { pump: { node: 'pump', axis: [-1, 0, 0], travel: 0.085 }, mag: { node: 'mag', detachable: false, shell: true }, trigger: { node: 'trigger' } } } };
}

// ---------------------------------------------------------------- casings
function casingGeo(kind, split = false) {
  const n = split ? 12 : 10;
  if (kind === 'shotgun') {
    const head = rev([[0, 0], [0, 11.1], [1.8, 11.1], [1.8, 10.3], [16, 10.3]], n), hull = rev([[16, 10.2], [58, 10.2], [60, 8.6], [60, 0]], n);
    return split ? { head, hull } : { parts: [[head, C.brass], [hull, C.hull]] };
  }
  if (kind === 'rifle') return { parts: [[rev([[0, 0], [0, 4.8], [1.1, 4.8], [1.6, 4.1], [2.6, 4.8], [36.5, 4.5], [39.5, 3.2], [44.7, 3.2], [44.7, 2.7], [41, 2.7]], n), C.brass]] };
  return { parts: [[rev([[0, 0], [0, 4.95], [1.1, 4.95], [1.6, 4.3], [2.6, 4.95], [19.1, 4.83], [19.1, 4.4], [15, 4.4]], n), C.brass]] };
}
const casings = {};
export function buildCasing(kind) {
  const k = kind === 'smg' ? 'pistol' : kind;
  if (casings[k]) return casings[k];
  ensureMaterials();
  const geometry = mergeBucket(casingGeo(k).parts.map(([g, c]) => [g, c, c === C.hull ? FIN.hull : FIN.brass]), [0, 0, 0]);
  // centre on the case's middle so it tumbles naturally
  geometry.computeBoundingBox(); const c = geometry.boundingBox.getCenter(new THREE.Vector3()); geometry.translate(-c.x, 0, 0);
  return (casings[k] = { geometry, material: k === 'shotgun' ? MATS.shell : MATS.brass });
}

// ---------------------------------------------------------------- public API
export const WEAPON_KINDS = ['pistol', 'smg', 'shotgun', 'rifle'];
const BUILDERS = { pistol, smg, shotgun, rifle }, templates = {};
let loading = null;
export function loadWeapons() {
  // built one gun per task so the page keeps painting while they are made (about a second in all)
  const tick = () => new Promise((r) => setTimeout(r, 0));
  if (!loading) loading = (async () => { await tick(); ensureMaterials(); for (const k of WEAPON_KINDS) { await tick(); templates[k] = templates[k] || BUILDERS[k](); } })();
  return loading;
}
export function buildWeapon(kind) {
  if (!BUILDERS[kind]) throw new Error('buildWeapon: unknown kind ' + kind);
  const t = templates[kind] || (templates[kind] = BUILDERS[kind]());
  const root = t.root.clone(true), m = t.meta, find = (n) => root.getObjectByName(n);
  const moving = {};
  for (const k in m.moving) {
    const s = m.moving[k], e = { ...s, node: find(s.node) };
    if (s.axis) { e.axis = new THREE.Vector3(...s.axis).normalize(); e.rest = e.node.position.clone(); }
    moving[k] = e;
  }
  root.userData = { kind, muzzle: m.muzzle.clone(), eject: m.eject.clone(), ejectDir: new THREE.Vector3(...m.ejectDir).normalize(), support: m.support.clone(),
    stock: m.stock ? m.stock.clone() : null, sightY: m.sightY, moving, stats: { ...t.root.userData.stats } };
  return root;
}
