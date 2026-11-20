// park/heroes/kit.js (park lane, helper heroes, Nov 16): what the hand-built places share: ONE material (a mode per vertex picks the surface) and a
// small mesh builder that works in MAP coordinates ([x east, y north, z relief metres]) and writes three.js ones (x, BASE + z, -y).
// Modes (attribute hm): 0 plain vertex colour, 1 sandstone ashlar, 2 the same pierced with quatrefoils (huv), 3 the Terrace's red brick in
// herringbone with stone bands, 4 hexagonal asphalt blocks, 5 cast iron pierced with interlaced circles (huv), 6 deck planks (huv), 7 arcade tiles (huv).
import * as THREE from 'three';
import { lit } from '../mat.js';
import { BASE } from '../ground.js';
export { BASE };

// The night (park hand-over 9, mat.js `lit()`): as the night comes a park material's colour goes back up by `night` (x the lane's gain 1.6), because
// at night the lamp pass and the sky glow light a surface by its base colour and the day colours here are cut to stand the sun (ALB below).
// Per surface (the end of the shader body), from hold h7g on uptown's map at 23:00, where one value for all was tried at 1, 1.8 and 2.8 against the
// park's own ground beside each place: the sandstone reads as it is and glows under a lamp at 1.8 (so 1); the brick and the Mall's pavers were
// near black at 1 and level with the paths at 2.8; iron, planks and tiles 2.2; leaves 1.6 and bark 1.8 as the park's own trees; plain-coloured
// parts 2.8 when dark (bronze, benches, urns) down to 1.6 when pale (the bridge's painted piers). ?parkheroesnight=0 = no lift at night.
const HERO_NIGHT = typeof location === 'undefined' || new URLSearchParams(location.search).get('parkheroesnight') !== '0';
let MAT = null;
export function material(game) {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  MAT = lit(m, game.world.shared, { key: 'hero', vpars: ' attribute float hm; attribute vec2 huv; varying float vHm; varying vec2 vHuv;', vbody: 'vHm = hm; vHuv = huv;',
    pars: 'varying float vHm; varying vec2 vHuv;',
    body: `int hmd = int(vHm + 0.5); vec3 han = abs(bakeN); vec2 hf = han.y > 0.7 ? vWPos.xz : (han.x > han.z ? vWPos.zy : vWPos.xy); vec3 hc = vec3(1.0);
      if (hmd == 1 || hmd == 2) { float row = floor(hf.y / 0.42), off = hash21(vec2(row, 3.0)) * 2.0; vec2 hq = vec2(fract((hf.x + off) / 0.95) * 0.95, fract(hf.y / 0.42) * 0.42), cell = vec2(floor((hf.x + off) / 0.95), row);
        float jt = 1.0 - smoothstep(0.006, 0.022, min(min(hq.x, 0.95 - hq.x), min(hq.y, 0.42 - hq.y)));
        hc = mix(vec3(0.40, 0.34, 0.25), vec3(0.50, 0.44, 0.33), hash21(cell + 1.7)) * (0.8 + 0.4 * fbm(hf * 1.7)) * (1.0 - 0.4 * jt);
        hc = mix(hc, hc * vec3(0.42, 0.45, 0.36), smoothstep(0.38, 0.8, fbm(hf * 0.35 + 7.0)) * 0.75);
        if (hmd == 2) { vec2 hp = vec2(fract(vHuv.x) - 0.5, vHuv.y - 0.5); float hd = min(min(length(hp - vec2(0.17, 0.0)), length(hp + vec2(0.17, 0.0))), min(length(hp - vec2(0.0, 0.17)), length(hp + vec2(0.0, 0.17)))); hc *= (hd < 0.15 && abs(hp.y) < 0.4) ? 0.14 + 0.10 * smoothstep(-0.3, 0.3, -hp.y) : 0.9; } }      // the quatrefoils as deep shaded recesses (pierced, h2 showed the bright paving through them as bars and blobs)
      else if (hmd == 3) { vec2 hd = vec2(vWPos.x - 1327.7, -vWPos.z - 3219.4), ae = vec2(dot(hd, vec2(0.2572, 0.9664)), dot(hd, vec2(0.9664, -0.2572)));
        float band = max(step(abs(fract(ae.x / 4.6) - 0.5), 0.065), step(abs(fract(ae.y / 4.6) - 0.5), 0.065));
        vec2 hp = vec2(ae.x + ae.y, ae.x - ae.y) * 0.7071 / 0.105, c2 = floor(hp / 2.0), hq = fract(hp / 2.0) * 2.0; bool hz = mod(c2.x + c2.y, 2.0) < 0.5;
        float sh = hz ? fract(hq.y) : fract(hq.x), lg = hz ? hq.x / 2.0 : hq.y / 2.0, jt = 1.0 - smoothstep(0.03, 0.10, min(min(sh, 1.0 - sh), min(lg, 1.0 - lg) * 2.0));
        vec2 bid = c2 * 2.0 + (hz ? vec2(0.0, floor(hq.y)) : vec2(floor(hq.x), 0.5));
        vec3 br = mix(vec3(0.24, 0.085, 0.062), vec3(0.33, 0.13, 0.095), hash21(bid)) * (0.6 + 0.6 * fbm(ae * 0.8)) * (1.0 - 0.45 * jt);
        br = mix(br, vec3(0.10, 0.085, 0.07), smoothstep(0.45, 0.8, fbm(ae * 0.22 + 11.0)) * 0.55);      // dirt and wear
        hc = mix(br, vec3(0.36, 0.34, 0.29) * (0.7 + 0.5 * fbm(ae * 1.3)), band); }
      else if (hmd == 4) { vec2 hp = vWPos.xz / 0.21, hr = vec2(1.0, 1.7320508), hh = hr * 0.5, ha = mod(hp, hr) - hh, hb = mod(hp - hh, hr) - hh, hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
        float ed = 0.5 - max(abs(hg.x), abs(hg.x) * 0.5 + abs(hg.y) * 0.8660254), jt = 1.0 - smoothstep(0.0, 0.07, ed);
        hc = vec3(0.160, 0.148, 0.132) * (0.75 + 0.5 * hash21(floor((hp - hg) * 2.0 + 0.5))) * (0.8 + 0.4 * fbm(vWPos.xz * 0.6)) * (1.0 - 0.45 * jt);
        hc = mix(hc, vec3(0.30, 0.20, 0.07), step(0.93, hash21(floor(vWPos.xz / 0.13))) * smoothstep(0.35, 0.7, fbm(vWPos.xz * 0.25 + 3.0))); }      // fallen elm leaves
      else if (hmd == 5) { vec2 hp = vec2(fract(vHuv.x) - 0.5, vHuv.y - 0.5); float hd = min(abs(length(hp) - 0.36), abs(length(vec2(abs(hp.x) - 0.5, hp.y)) - 0.36));
        if (hd > 0.065 && abs(hp.y) < 0.43 && length(hp) > 0.09) discard; hc = vec3(0.60, 0.585, 0.50) * (0.70 + 0.45 * fbm(vWPos.xy * 2.0 + vWPos.zz)); }
      else if (hmd == 6) { float pl = vHuv.x / 0.14; hc = vec3(0.20, 0.165, 0.135) * (0.75 + 0.4 * hash21(vec2(floor(pl), 2.0))) * (0.85 + 0.3 * fbm(vHuv * vec2(1.0, 9.0))) * (1.0 - 0.55 * step(fract(pl), 0.07)); }
      else if (hmd == 7) { vec2 ht = fract(vHuv / 0.5) - 0.5; float ring = abs(length(ht) - 0.30); hc = mix(vec3(0.33, 0.24, 0.13), mix(vec3(0.07, 0.14, 0.20), vec3(0.52, 0.42, 0.22), step(ring, 0.06)), step(max(abs(ht.x), abs(ht.y)), 0.45)); }
      else if (hmd == 8) { vec2 hp = vec2(fract(vHuv.x) - 0.5, vHuv.y - 0.5); if (vnoise(vHuv * 9.0) < 0.40 + 1.6 * max(0.0, length(hp) - 0.28)) discard; hc = vec3(0.75 + 0.5 * vnoise(vHuv * 31.0)); }      // a spray of leaves (huv: a whole number + 0..1 across, 0..1 up)
      else if (hmd == 9) { float fu = fbm(vec2((vWPos.x + vWPos.z) * 7.0, vWPos.y * 0.9)); hc = vec3(0.45 + 1.2 * smoothstep(0.3, 0.7, fu)) * (0.8 + 0.4 * fbm(vWPos.xy * 0.7)); }      // furrowed bark: dark upright furrows
      if (hmd != 0) diffuseColor.rgb = hc;
      ${HERO_NIGHT ? 'pkNight = hmd == 0 ? mix(2.8, 1.6, smoothstep(0.08, 0.20, max(vColor.r, max(vColor.g, vColor.b)))) : (hmd <= 2 ? 1.0 : (hmd <= 4 ? 2.8 : (hmd <= 7 ? 2.2 : (hmd == 8 ? 1.6 : 1.8))));' : ''}` });
  return MAT;
}

// every colour of the heroes is scaled by this: render h2 showed the game's sun and encoding turn an albedo of 0.3 into near white (brick came out
// salmon, sandstone cream-white, bark pale grey), so the colours written in these modules are about four times what reaches the material
const ALB = 0.25;
const NOUV =[[-1, -1], [-1, -1], [-1, -1], [-1, -1]];
// mk(base): base = BASE for world geometry, 0 for a model that is instanced (its own origin on the ground)
export function mk(base = BASE) {
  const pos = [], col = [], huv = [], hm = [], B = {};
  B.q = (a, b, c, d, k = [1, 1, 1], m = 0, uv = NOUV) => { const P = [a, b, c, a, c, d], U = [0, 1, 2, 0, 2, 3]; for (let i = 0; i < 6; i++) { const p = P[i]; pos.push(p[0], base + p[2], -p[1]); col.push(k[0] * ALB, k[1] * ALB, k[2] * ALB); huv.push(uv[U[i]][0], uv[U[i]][1]); hm.push(m); } };
  // a box in a frame F(a, e, z) -> [x, y, z] (a along, e to the right): top and four sides
  B.box = (F, a0, a1, e0, e1, z0, z1, k, m = 0) => { B.q(F(a0, e0, z1), F(a0, e1, z1), F(a1, e1, z1), F(a1, e0, z1), k, m); B.q(F(a0, e0, z0), F(a0, e1, z0), F(a0, e1, z1), F(a0, e0, z1), k, m); B.q(F(a1, e1, z0), F(a1, e0, z0), F(a1, e0, z1), F(a1, e1, z1), k, m);
    B.q(F(a0, e1, z0), F(a1, e1, z0), F(a1, e1, z1), F(a0, e1, z1), k, m); B.q(F(a1, e0, z0), F(a0, e0, z0), F(a0, e0, z1), F(a1, e0, z1), k, m); };
  // a turned shape round the vertical through (cx, cy): profile [[r, z] ...] (z added to z0)
  B.lathe = (cx, cy, z0, pr, seg, k, m = 0, sx = 1, rot = 0) => { for (let i = 0; i + 1 < pr.length; i++) for (let j = 0; j < seg; j++) { const t0 = rot + j / seg * Math.PI * 2, t1 = rot + (j + 1) / seg * Math.PI * 2, P = (q, t) => [cx + q[0] * Math.cos(t) * sx, cy + q[0] * Math.sin(t), z0 + q[1]]; B.q(P(pr[i], t0), P(pr[i], t1), P(pr[i + 1], t1), P(pr[i + 1], t0), k, m); } };
  // a tube along points with radii
  B.tube = (P, R, n, k, m = 0) => { let prev = null; for (let i = 0; i < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const L = Math.hypot(tx, ty, tz) || 1; tx /= L; ty /= L; tz /= L;
      let n1 = Math.abs(tz) > 0.98 ? [1, 0, 0] : [ty, -tx, 0]; const l1 = Math.hypot(n1[0], n1[1], n1[2]); n1 = n1.map((v) => v / l1); const n2 = [ty * n1[2] - tz * n1[1], tz * n1[0] - tx * n1[2], tx * n1[1] - ty * n1[0]], ring = [];
      for (let j = 0; j <= n; j++) { const t = j / n * Math.PI * 2, c = Math.cos(t) * R[i], s = Math.sin(t) * R[i]; ring.push([P[i][0] + n1[0] * c + n2[0] * s, P[i][1] + n1[1] * c + n2[1] * s, P[i][2] + n1[2] * c + n2[2] * s]); }
      if (prev) for (let j = 0; j < n; j++) B.q(prev[j], prev[j + 1], ring[j + 1], ring[j], k, m); prev = ring; } };
  B.tris = () => pos.length / 9;
  B.geo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('huv', new THREE.Float32BufferAttribute(huv, 2)); g.setAttribute('hm', new THREE.Float32BufferAttribute(hm, 1)); g.computeVertexNormals(); return g; };
  B.mesh = (game, name) => { const me = new THREE.Mesh(B.geo(), material(game)); me.name = name; me.castShadow = true; me.receiveShadow = true; return me; };
  return B;
}
// instanced(game, B (a mk(0) builder), [{ x, y, z (relief), rot (radians about the vertical), s }], name)
export function instanced(game, geo, tris, L, name) {
  const B = { tris: () => tris }, im = new THREE.InstancedMesh(geo, material(game), L.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  L.forEach((p, k) => { e.set(0, p.rot || 0, 0); q.setFromEuler(e); v.set(p.x, BASE + p.z, -p.y); s.setScalar(p.s || 1); m4.compose(v, q, s); im.setMatrixAt(k, m4); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = name; im.castShadow = true; im.receiveShadow = true; im.userData.tris = B.tris() * L.length; return im;
}
export const pip = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
// the Terrace's own frame: a along the Mall / arcade axis (north-ish), e to the east of it; origin = the middle of the arcade's north face (OSM)
export const O = [1327.7, 3219.4], U = [0.2572, 0.9664], V = [0.9664, -0.2572];
export const F = (a, e, z) => [O[0] + U[0] * a + V[0] * e, O[1] + U[1] * a + V[1] * e, z];
