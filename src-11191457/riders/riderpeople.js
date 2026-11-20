// riders/riderpeople.js (people lane, Nov 15): the rider as one of the game's own people. A body of the crowd's cast (crowd.js: the same
// meshes and pictures the walkers are drawn from) is put in a riding or standing pose on a private copy of its skeleton, frozen into plain
// geometry and drawn as instances. Dress for November is made here: the jacket (trunk and sleeves, swollen a little, quilted) and gloves are
// painted flat over whatever the body wears, trousers take a dark tint, and a helmet / hood over a hat / knit hat and a face covering are
// built round the head as it was measured. Nothing is loaded: no new file, picture or name. If the crowd has no cast (?crowd=0) there are no
// figures from here and riders.js keeps its made-in-code figure.
// Model frame as ridermodel.js: x ahead, y up, z to the RIGHT, origin on the ground midway between the tyres (standing: between the feet).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EntryRig } from '../entry/rig.js';
import { BAKE_LIGHT_GLSL } from '../facade.js';
import { BIKE } from './ridermodel.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), LEFT = V(0, 0, -1), FWD = V(1, 0, 0), _q = new THREE.Quaternion(), _t = V(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _n3 = new THREE.Matrix3();
// which bodies, and what each wears on its head. want: cast names tried in order (men of middling height first), then any body not yet taken
export const VARIANTS = [
  { want: ['c04', 'c00', 'c12'], gear: 'helmet', gaiter: true },
  { want: ['c13', 'c02', 'c24'], gear: 'hood', gaiter: true },
  { want: ['c18', 'c16', 'c08'], gear: 'helmet', gaiter: false, hoodDown: true },
  { want: ['c10', 'c21', 'c15'], gear: 'hat', gaiter: true },
];
export const PEOPLE_POSES = ['ride', 'astride', 'stand', 'stand2'];

// ---------------------------------------------------------------- the pose
function pose(rig, name, k) {
  const A = rig.ankleH, out = { look: V(1, 0, 0), phone: null };
  if (name === 'ride' || name === 'astride') {
    const ride = name === 'ride'; rig.hips(ride ? V(-0.285, 1.0, 0) : V(-0.17, 0.95, -0.05));
    const p0 = ride ? 0.3 : 0.2; rig.tilt(_q.setFromAxisAngle(LEFT, p0 * 0.3)); rig.bend(LEFT, p0 * 0.7);
    const gl = V(BIKE.grips[0] - 0.075, BIKE.grips[1] + 0.035, -BIKE.grips[2]), gr = V(BIKE.grips[0] - 0.075, BIKE.grips[1] + 0.035, BIKE.grips[2]);
    for (let i = 0; i < 7 && rig.pos('upper_arm_L', _t).distanceTo(gl) > rig.armLen * 0.93; i++) rig.bend(LEFT, 0.06);      // lean as far as the arms need to hold the bar
    if (ride) { rig.leg('L', V(BIKE.pedF[0] - 0.09, BIKE.pedF[1] + 0.02 + A, -0.15), V(1, 0.9, -0.12), FWD, -0.1); rig.leg('R', V(BIKE.pedR[0] - 0.09, BIKE.pedR[1] + 0.02 + A, 0.15), V(1, 0.9, 0.12), FWD, -0.1); }
    else { rig.leg('L', V(-0.08, A + 0.035, -0.37), V(1, 0.5, -0.35), V(0.95, 0, -0.3), 0); rig.leg('R', V(BIKE.pedR[0] - 0.09, BIKE.pedR[1] + 0.02 + A, 0.15), V(1, 0.9, 0.12), FWD, -0.1); }      // left foot down
    rig.arm('L', gl, V(-0.3, -1, -0.55)); rig.arm('R', gr, V(-0.3, -1, 0.55));
    out.look.set(1, ride ? -0.07 : -0.03, 0);
  } else if (name === 'stand') {      // head down at the phone in the right hand
    rig.bend(LEFT, 0.1); const h = rig.pos('hips', V()), T = V(h.x + 0.25 * k, h.y + 0.27 * k, 0.07); rig.arm('R', T, V(-0.2, -1, 0.8)); out.phone = T; out.look.set(0.78, -0.62, 0);
  } else {      // hands in the jacket's pockets, looking up the street
    const h = rig.pos('hips', V()); rig.arm('L', V(h.x + 0.07, h.y + 0.06 * k, -(rig.hipW + 0.1)), V(-1, -0.3, -0.5)); rig.arm('R', V(h.x + 0.07, h.y + 0.06 * k, rig.hipW + 0.1), V(-1, -0.3, 0.5)); out.look.set(1, 0.02, 0);
  }
  out.look.normalize(); rig.look(out.look, 1); return out;
}

// ---------------------------------------------------------------- pieces built round the head (flat colour: aFlat.w = channel, xyz = shade or the colour itself)
// channel: 1 jacket, 2 trousers, 3 helmet / hat, 4 the jacket's body or a vest over it, 5 a colour of its own
function piece(g, mat, ch, col, uv) {
  g.applyMatrix4(mat); const n = g.attributes.position.count, f = new Float32Array(n * 4), mk = new Float32Array(n * 4), u = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { f[i * 4] = col[0]; f[i * 4 + 1] = col[1]; f[i * 4 + 2] = col[2]; f[i * 4 + 3] = ch; mk[i * 4 + 3] = 1; u[i * 2] = uv[0]; u[i * 2 + 1] = uv[1]; }
  g.setAttribute('aFlat', new THREE.BufferAttribute(f, 4)); g.setAttribute('aMask', new THREE.BufferAttribute(mk, 4)); g.setAttribute('uv', new THREE.BufferAttribute(u, 2)); return g;
}
// a ball of radius 1 with only the faces that keep(x, y, z of the face's middle) says to keep
function shell(keep, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs), ix = g.index.array, P = g.attributes.position, out = [];
  for (let i = 0; i < ix.length; i += 3) { const a = ix[i], b = ix[i + 1], c = ix[i + 2]; if (keep((P.getX(a) + P.getX(b) + P.getX(c)) / 3, (P.getY(a) + P.getY(b) + P.getY(c)) / 3, (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3)) out.push(a, b, c); }
  g.setIndex(out); return g;
}
const K = (v) => [v, v, v];

// ---------------------------------------------------------------- one body in one pose, as plain geometry
function figure(ch, idle, poseName, VA, keep = null) {
  const root = cloneSkinned(ch.root); root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1); root.updateMatrixWorld(true);
  let mesh = null; root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; }); if (!mesh) return null;
  if (idle) { const tr = idle.tracks.filter((t) => t.name.startsWith(ch.name + '_')); if (tr.length) { const mx = new THREE.AnimationMixer(root); mx.clipAction(new THREE.AnimationClip('riders_idle_' + ch.name, idle.duration, tr)).play(); mx.setTime(0.3); } }
  root.updateMatrixWorld(true);
  const rig = new EntryRig({ object: root }, ch.name); if (rig.standH === undefined || !rig.B.chest) return null;
  const k = rig.standH / 0.95, PZ = pose(rig, poseName, k); root.updateMatrixWorld(true);
  // skin it here
  const sk = mesh.skeleton, bones = sk.bones, G = mesh.geometry, P = G.attributes.position, N = G.attributes.normal, UVs = G.attributes.uv, C = G.attributes.color, SI = G.attributes.skinIndex, SW = G.attributes.skinWeight, n = P.count;
  const BM = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[i])), pre = new THREE.Matrix4().copy(mesh.bindMatrix), post = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  const cls = bones.map((b) => { const s = b.name.replace(ch.name + '_', ''); return /^(clavicle|upper_arm|forearm)/.test(s) ? 1 : /^hand/.test(s) ? 2 : /^head/.test(s) ? 3 : /^(thigh|shin)/.test(s) ? 4 : /^(foot|toe)/.test(s) ? 5 : 0; });
  const bindPos = bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(_m.copy(sk.boneInverses[i]).invert())), armRoot = { L: bones.findIndex((b) => b.name === ch.name + '_upper_arm_L'), R: bones.findIndex((b) => b.name === ch.name + '_upper_arm_R') };
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), flat = new Float32Array(n * 4), mask = new Float32Array(n * 4), uv = new Float32Array(n * 2), p = V(), q = V(), nn = V(), acc = new THREE.Matrix4(), e = acc.elements;
  const F = PZ.look, U = V(-F.y, F.x, 0), hb = { lo: V(1e9, 1e9, 1e9), hi: V(-1e9, -1e9, -1e9) }; let uvSafe = [0.5, 0.5], haveSafe = false;
  if (keep) keep.grow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 16; j++) e[j] = 0; const w = [0, 0, 0, 0, 0, 0]; let ws = 0, arm = -1, aw = 0;
    for (let j = 0; j < 4; j++) { const wt = SW.getComponent(i, j); if (!(wt > 0)) continue; const bi = SI.getComponent(i, j), be = BM[bi].elements; for (let c = 0; c < 16; c++) e[c] += be[c] * wt; ws += wt; w[cls[bi]] += wt; if (cls[bi] === 1 && wt > aw) { aw = wt; arm = bi; } }
    if (ws > 0) for (let j = 0; j < 16; j++) e[j] /= ws; else acc.identity(); for (const j in w) w[j] /= ws || 1;
    _m2.multiplyMatrices(post, acc).multiply(pre); p.fromBufferAttribute(P, i); const bind = q.copy(p).applyMatrix4(pre).clone(); p.applyMatrix4(_m2); nn.fromBufferAttribute(N, i).applyMatrix3(_n3.setFromMatrix4(_m2)).normalize();
    const mr = C ? C.getX(i) : 0, mg = C ? C.getY(i) : 0, mb = C ? C.getZ(i) : 0, ma = C && C.itemSize > 3 ? C.getW(i) : 1;
    let chn = 0, sh = 1, grow = 0;
    if (w[2] >= 0.5) { chn = 5; sh = 0.035; grow = 0.006; }      // gloves
    else if (w[1] > 0.45 || (mr > 0.5 && w[3] < 0.5)) {      // the jacket: sleeves and trunk, quilted
      const sleeve = w[1] > 0.45, side = bones[arm] && /_R$/.test(bones[arm].name) ? 'R' : 'L', qd = sleeve && armRoot[side] >= 0 ? bind.distanceTo(bindPos[armRoot[side]]) : bind.y, rp = 0.5 + 0.5 * Math.cos(qd * Math.PI * 2 / 0.095);
      chn = sleeve ? 1 : 4; grow = 0.012 + 0.017 * Math.sqrt(rp); sh = (0.7 + 0.3 * rp) * (0.55 + 0.45 * ma); }
    else if (w[4] > 0.5 && mg < 0.5) { chn = 2; sh = 0.6 + 0.4 * ma; grow = 0.007; }      // bare legs: trousers
    if (keep) keep.grow[i] = grow;
    if (grow) p.addScaledVector(nn, grow);
    if (!haveSafe && chn === 4 && UVs) { uvSafe = [UVs.getX(i), UVs.getY(i)]; haveSafe = true; }
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; nor[i * 3] = nn.x; nor[i * 3 + 1] = nn.y; nor[i * 3 + 2] = nn.z; if (UVs) { uv[i * 2] = UVs.getX(i); uv[i * 2 + 1] = UVs.getY(i); }
    if (chn === 5) { flat[i * 4] = flat[i * 4 + 1] = flat[i * 4 + 2] = sh; } else { flat[i * 4] = flat[i * 4 + 1] = flat[i * 4 + 2] = chn ? sh : 1; } flat[i * 4 + 3] = chn;
    mask[i * 4] = chn ? 0 : mr; mask[i * 4 + 1] = mg; mask[i * 4 + 2] = mb; mask[i * 4 + 3] = ma;
    if (w[3] > 0.8 && mb < 0.5) { const a = p.dot(F), b = p.dot(U), c = p.z; hb.lo.min(_t.set(a, b, c)); hb.hi.max(_t); }      // the head (without the hair), in the frame it looks along
  }
  const body = new THREE.BufferGeometry(); body.setIndex(G.index); body.setAttribute('position', new THREE.BufferAttribute(pos, 3)); body.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); body.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); body.setAttribute('aMask', new THREE.BufferAttribute(mask, 4)); body.setAttribute('aFlat', new THREE.BufferAttribute(flat, 4));
  const parts = [body];
  // the head's middle and half sizes; pieces are built in its frame (x = where it looks, y = its up, z = right)
  if (hb.hi.x > hb.lo.x) {
    const cx = (hb.lo.x + hb.hi.x) / 2, cy = (hb.lo.y + hb.hi.y) / 2, rx = (hb.hi.x - hb.lo.x) / 2, ry = (hb.hi.y - hb.lo.y) / 2, rz = (hb.hi.z - hb.lo.z) / 2, hc = V().addScaledVector(F, cx).addScaledVector(U, cy), HF = new THREE.Matrix4().makeBasis(F, U, V(0, 0, 1)).setPosition(hc);
    const at = (ox, oy, sx, sy, sz, rz2 = 0) => new THREE.Matrix4().copy(HF).multiply(_m.makeRotationZ(rz2).setPosition(ox, oy, 0)).multiply(_m2.makeScale(sx, sy, sz));
    const add = (g, m, c, col) => parts.push(piece(g, m, c, col, uvSafe));
    if (VA.gear === 'helmet') { add(shell((x, y) => y > -0.12 - 0.25 * Math.max(0, -x)), at(-0.006, ry * 0.2, rx * 1.2 + 0.014, ry * 1.0, rz * 1.2 + 0.014, 0.1), 3, K(1));      // a bike helmet, lower at the back
      for (const s of [-0.5, 0, 0.5]) add(new THREE.BoxGeometry(1, 1, 1), at(-0.01, ry * 1.2 - Math.abs(s) * ry * 0.22, rx * 1.5, 0.012, 0.016, 0.1).multiply(_m.makeTranslation(0, 0, s * rz * 1.5 / 0.016)), 5, K(0.02));      // its vents
      add(new THREE.BoxGeometry(1, 1, 1), at(rx * 1.14, ry * 0.2, 0.05, 0.012, rz * 1.5, -0.12), 3, K(0.75)); }      // peak
    else { add(shell((x, y) => y > -0.1 - 0.5 * Math.max(0, -x)), at(-0.004, ry * 0.16, rx * 1.07 + 0.008, ry * 0.98, rz * 1.08 + 0.008, 0.05), VA.gear === 'hat' ? 3 : 5, VA.gear === 'hat' ? K(1) : K(0.045));      // knit hat
      if (VA.gear === 'hat') add(new THREE.TorusGeometry(1, 0.13, 5, 14).rotateX(Math.PI / 2), at(-0.004, ry * 0.12, rx * 1.07 + 0.008, 0.11, rz * 1.08 + 0.008, 0.05), 3, K(0.8)); }      // its turned-up edge
    if (VA.gear === 'hood') add(shell((x, y) => x * 0.96 - y * 0.2 < 0.5), at(-0.022, -ry * 0.06, rx * 1.15 + 0.014, ry * 1.17 + 0.012, rz * 1.2 + 0.014, 0.12), 1, K(1.25));      // the hood, open at the face
    if (VA.gaiter) add(shell((x, y) => y < 0.02 + 0.3 * Math.max(0, -x)), at(0, -ry * 0.12, rx * 1.05 + 0.005, ry * 1.02, rz * 1.04 + 0.005), 5, K(0.05));      // nose, mouth and neck covered
  }
  if (keep) keep.nHead = parts.length;
  const ck = rig.pos('chest2' in rig.B && rig.B.chest2 ? 'chest2' : 'chest', V()), hp = rig.pos('hips', V()), su = V().subVectors(ck, hp).normalize(), sb = V(-su.y, su.x, 0);      // spine, and "behind" it
  if (VA.hoodDown) parts.push(piece(new THREE.SphereGeometry(1, 9, 6), new THREE.Matrix4().makeRotationZ(-Math.atan2(su.x, su.y)).setPosition(ck.x + sb.x * 0.135 + su.x * 0.12, ck.y + sb.y * 0.135 + su.y * 0.12, 0).multiply(_m2.makeScale(0.065, 0.1, 0.15)), 1, K(0.9), uvSafe));
  if (keep) keep.nChest = parts.length;
  if (PZ.phone) { const T = PZ.phone, m = (dx, sx, sy, sz) => new THREE.Matrix4().makeRotationZ(-0.6).setPosition(T.x + 0.03 + dx, T.y + 0.075, T.z).multiply(_m2.makeScale(sx, sy, sz));
    parts.push(piece(new THREE.BoxGeometry(1, 1, 1), m(0, 0.012, 0.15, 0.075), 5, K(0.03), uvSafe), piece(new THREE.BoxGeometry(1, 1, 1), m(-0.007, 0.004, 0.13, 0.063), 5, [0.55, 0.8, 1.15], uvSafe)); }
  if (keep) { keep.root = root; keep.mesh = mesh; keep.flat = flat; keep.mask = mask; keep.parts = parts.slice(); }
  for (const g of parts) for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aMask', 'aFlat'].includes(a)) g.deleteAttribute(a);
  const geo = mergeGeometries(parts, false); if (!geo) return null; geo.computeBoundingSphere(); geo.boundingSphere.radius = 3;
  // where a box worn on the back sits: against the back, its bottom at the belt; [x, y, tilt]
  const tilt = -Math.atan2(su.x, su.y), back = [hp.x + sb.x * 0.39 + su.x * 0.1, hp.y + sb.y * 0.39 + su.y * 0.1, tilt];
  return { geometry: geo, back, tris: geo.index.count / 3 };
}

// ---------------------------------------------------------------- the material: the body's own, with the dress and the crowd's light
function material(src, shared, U = null) {      // U: the tints as a uniform (one skinned figure) instead of an instance attribute
  const m = src.clone(); m.vertexColors = false; m.transparent = false; m.depthWrite = true; m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.envMapIntensity = src.envMapIntensity;
  const lit = !!(shared && shared.tLight && shared.tLight.value && shared.uHalf && shared.uSunColor && shared.uShadowFar && shared.uShadowCenter);
  m.onBeforeCompile = (sh) => {
    if (U) sh.uniforms.aTint = U.aTint;
    if (lit) Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aMask; attribute vec4 aFlat; ${U ? 'uniform' : 'attribute'} mat4 aTint;
      varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO; varying vec4 vFlatC;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 tj = aTint[0].xyz, tp = aTint[1].xyz, th = aTint[2].xyz, tb = aTint[3].xyz;
        vCTint = mix(vec3(1.0), tb, aMask.r) * mix(vec3(1.0), tp, aMask.g) * mix(vec3(1.0), vec3(0.07, 0.065, 0.06), aMask.b);
        vCAO = aMask.a; vCH = position.y;
        float ch = aFlat.w; vec3 fc = aFlat.xyz;
        if (ch > 4.5) fc *= 1.0; else if (ch > 3.5) fc *= tb; else if (ch > 2.5) fc *= th; else if (ch > 1.5) fc *= tp; else if (ch > 0.5) fc *= tj;
        vFlatC = vec4(fc, ch > 0.5 ? 1.0 : 0.0);
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO; varying vec4 vFlatC; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= vCTint; diffuseColor.rgb = mix(diffuseColor.rgb, vFlatC.rgb, clamp(vFlatC.a, 0.0, 1.0)); diffuseColor.a = max(diffuseColor.a, vFlatC.a);`)
      .replace('#include <aomap_fragment>', (lit ? 'bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);' + BAKE_LIGHT_GLSL : '') + `
      { float ao = clamp(vCAO, 0.0, 1.0); float cg = mix(0.45, 1.0, smoothstep(0.0, 1.25, vCH));
        reflectedLight.indirectDiffuse *= cg * 0.8 * ao; reflectedLight.indirectSpecular *= cg * 0.5 * ao; reflectedLight.directDiffuse *= mix(1.0, ao, 0.2) * 1.15; reflectedLight.directSpecular *= ao * 1.5; }`);
  };
  m.customProgramCacheKey = () => 'riders-people1|' + (lit ? 'l' : 'd') + (U ? 'u' : ''); return m;
}

const castChars = (cast, taken = new Set()) => VARIANTS.map((v) => { let c = null; for (const nm of v.want) { c = cast.chars.find((q) => q.name === nm && !taken.has(q)); if (c) break; } if (!c) c = cast.chars.find((q) => !taken.has(q)) || cast.chars[0]; taken.add(c); return c; });
// figures[pose][variant] = { geometry, material, back } or null when the crowd's cast is not there (yet)
export function buildPeople(g) {
  const R = g.crowd && g.crowd.render, cast = R && R.cast; if (!cast || !cast.chars || !cast.chars.length || cast.kind === 'people.glb') return null;
  const idle = (cast.animations || []).find((a) => a && a.tracks && a.tracks.length && /^idle/i.test(a.name)) || null, taken = new Set(), out = {}, mats = new Map(); let tris = 0;
  const chars = castChars(cast, taken);
  for (const p of PEOPLE_POSES) { out[p] = [];
    for (let i = 0; i < VARIANTS.length; i++) { const ch = chars[i], part = ch.parts && ch.parts[0]; if (!part || !ch.root) return null; const f = figure(ch, idle, p, VARIANTS[i]); if (!f) return null;
      if (!mats.has(ch)) mats.set(ch, material(part.material, g.world.shared)); f.material = mats.get(ch); f.who = ch.name; tris += f.tris; out[p].push(f); } }
  out.report = { bodies: chars.map((c) => c.name).join(','), tris: Math.round(tris / (PEOPLE_POSES.length * VARIANTS.length)), idle: idle ? idle.name : 'bind pose' };
  return out;
}

// ---------------------------------------------------------------- the same rider as a skinned figure, for the ragdoll
// ragdoll lane, Nov 16 (Matt: "once I shoot them, they get a suit"): a rider who was shot or struck by a car fell as one of the game's ordinary
// pedestrians, in that pedestrian's clothes. This is the rider himself: the same body of the cast, in the same pose, the same jacket, trousers, gloves
// and tints (the same per-vertex dress as figure() above, kept on the skin instead of frozen), the helmet / hat / hood / face covering hung on the head
// bone. Returns what Peds.visual() returns ({ object, mixer, acts, kind, name }), or null (no cast: the caller keeps the pedestrian as before).
// Figures are kept and used again once the game has let one go (used = false, as it does with its own).
const riderPool = [];
export function skinnedRider(g, pv, tr, poseName = 'ride') {
  const R = g.crowd && g.crowd.render, cast = R && R.cast; if (!cast || !cast.chars || !cast.chars.length || cast.kind === 'people.glb' || !tr) return null;
  const i = (((pv | 0) % VARIANTS.length) + VARIANTS.length) % VARIANTS.length; if (!PEOPLE_POSES.includes(poseName)) poseName = 'ride';
  let f = riderPool.find((q) => !q.used && q.pv === i && q.pose === poseName);
  if (!f) {
    const ch = castChars(cast)[i], part = ch && ch.parts && ch.parts[0]; if (!part || !ch.root) return null;
    const idle = (cast.animations || []).find((a) => a && a.tracks && a.tracks.length && /^idle/i.test(a.name)) || null, K = {};
    if (!figure(ch, idle, poseName, VARIANTS[i], K) || !K.mesh || !K.grow) return null;
    const G = K.mesh.geometry, P = G.attributes.position, N = G.attributes.normal, n = P.count, pos = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) { const gr = K.grow[j]; pos[j * 3] = P.getX(j) + N.getX(j) * gr; pos[j * 3 + 1] = P.getY(j) + N.getY(j) * gr; pos[j * 3 + 2] = P.getZ(j) + N.getZ(j) * gr; }
    const geo = new THREE.BufferGeometry(); geo.setIndex(G.index); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); for (const a of ['normal', 'uv', 'skinIndex', 'skinWeight']) if (G.attributes[a]) geo.setAttribute(a, G.attributes[a]);
    geo.setAttribute('aMask', new THREE.BufferAttribute(K.mask, 4)); geo.setAttribute('aFlat', new THREE.BufferAttribute(K.flat, 4)); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
    const U = { aTint: { value: new THREE.Matrix4() } }, root = K.root;
    root.traverse((o) => { if (o.isSkinnedMesh && o !== K.mesh) o.visible = false; });      // figure() draws the first skin only; so does this
    K.mesh.geometry = geo; K.mesh.material = material(part.material, g.world.shared, U); K.mesh.frustumCulled = false; K.mesh.castShadow = true; K.mesh.receiveShadow = true;
    const gearMat = material(part.material, g.world.shared, U), bone = (nm) => root.getObjectByName(ch.name + '_' + nm);
    const hang = (b, geos) => { if (!b || !geos.length) return; const m = geos.length > 1 ? mergeGeometries(geos, false) : geos[0]; if (!m) return; const me = new THREE.Mesh(m, gearMat); me.matrixAutoUpdate = false; me.matrix.copy(b.matrixWorld).invert(); me.frustumCulled = false; me.castShadow = true; b.add(me); };
    hang(bone('head'), K.parts.slice(1, K.nHead)); hang(bone('chest2') || bone('chest'), K.parts.slice(K.nHead, K.nChest));
    f = { object: root, name: ch.name, kind: ch.name, mixer: new THREE.AnimationMixer(root), acts: {}, U, pv: i, pose: poseName, rest: [], rider: true, used: false };
    root.traverse((o) => { if (o.isBone) f.rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
    g.world.scene.add(root); riderPool.push(f); while (riderPool.length > 12) { const k = riderPool.findIndex((q) => !q.used); if (k < 0) break; g.world.scene.remove(riderPool[k].object); riderPool.splice(k, 1); }
  } else for (const [o, p, q, sc] of f.rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }
  f.U.aTint.value.fromArray(tr); f.used = true; f.object.visible = true; f.object.traverse((o) => { if (o.isMesh) o.renderOrder = 0; }); return f;
}
