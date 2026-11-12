// combat/people.js: what happens to people when the shooting starts.
//   Bodies.kill   a person who is shot dead becomes a ragdoll (doll.js) that starts in the pose, place and motion they had. A crowd
//                 agent (GPU-instanced, no skeleton of its own) is swapped in the same frame for a skinned stand-in built from the
//                 crowd cast: the same character mesh and clothing tints, posed from the same clip at the same phase.
//   Bodies.wound  hit but alive: a flinch at the wound, then they run.
//   Bodies.scare  bystanders: a human reaction time that grows with distance, then away along the walks (not into walls).
// Nothing of the game's or the crowd's is edited: crowd.render.update is wrapped (agents shown as stand-ins are skipped there).
// Sim space is (x east, y north, z up); three.js space is (x, z, -y). The doll works in three.js space.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BAKE_LIGHT_GLSL } from '../facade.js';
import { Doll, I, NP } from './doll.js';
import { worldRotate } from './rig.js';
import { clamp } from '../geo.js';
import { bake } from '../crowd/render.js';

const NOOP = () => {}, POOL = 12, DOWN = [I.H, I.N, I.C, I.P, I.KL, I.KR, I.FL, I.FR, I.EL, I.ER];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _o = {}, _mL = new THREE.Matrix4();
const phi_fix = (L) => L.negate();
const UP = new THREE.Vector3(0, 1, 0), sm = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const tintOf = (f, out) => out.set(Math.pow(((f >> 16) & 255) / 255, 2.2), Math.pow(((f >> 8) & 255) / 255, 2.2), Math.pow((f & 255) / 255, 2.2));

// ---------------------------------------------------------------------------------------------------------------- skeleton <-> doll
// The skeleton is laid onto the doll's points by rotation only (bones never change length): the two trunk blocks give the pelvis and
// the ribcage their whole orientation; every limb bone is swung from where its parent carries it onto the line between its points.
const LIMBS = [['upper_arm_L', 'SL', 'EL', 'chest'], ['forearm_L', 'EL', 'WL', 'upper_arm_L'], ['hand_L', 'WL', 'AL', 'forearm_L'], ['upper_arm_R', 'SR', 'ER', 'chest'], ['forearm_R', 'ER', 'WR', 'upper_arm_R'], ['hand_R', 'WR', 'AR', 'forearm_R'],
  ['thigh_L', 'HL', 'KL', 'pelvis'], ['shin_L', 'KL', 'FL', 'thigh_L'], ['foot_L', 'FL', 'TL', 'shin_L'], ['thigh_R', 'HR', 'KR', 'pelvis'], ['shin_R', 'KR', 'FR', 'thigh_R'], ['foot_R', 'FR', 'TR', 'shin_R']];
const ORDER = ['hips', 'spine', 'chest', 'chest2', 'neck', 'head', 'clavicle_L', 'clavicle_R', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'toe_L', 'thigh_R', 'shin_R', 'foot_R', 'toe_R'];
export class Fit {
  constructor(root, name) {
    this.root = root; this.ok = false; const B = (this.B = {});
    for (const k of ORDER) B[k] = root.getObjectByName(name + '_' + k) || null;
    for (const k of ['hips', 'neck', 'head', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']) if (!B[k]) return;
    if (!B.chest) B.chest = B.spine || B.chest2; if (!B.chest) return;
    this.q0 = {}; this.d0 = {}; this.R = {}; this.wq = new Map(); for (const k of ORDER) { this.q0[k] = new THREE.Quaternion(); this.R[k] = new THREE.Quaternion(); } this.R.pelvis = new THREE.Quaternion(); this.R.chestB = new THREE.Quaternion();
    for (const l of LIMBS) this.d0[l[0]] = new THREE.Vector3(); this.d0.neck = new THREE.Vector3(); this.d0.spine = new THREE.Vector3();
    this.fp0 = new THREE.Quaternion(); this.fc0 = new THREE.Quaternion(); this.pts = []; for (let i = 0; i < NP; i++) this.pts.push([0, 0, 0]);
    // bones that do not hang from the hips (a root-level helper some characters carry: hair, a strap): left where the person stood
    // while the body fell away, the skin weighted to them was drawn out into long black lines. They are carried with the hips.
    this.loose = []; try { const under = (o) => { for (let q = o; q; q = q.parent) if (q === B.hips) return true; return false; }, above = new Set(); for (let q = B.hips.parent; q; q = q.parent) above.add(q);
      root.traverse((o) => { if (!o.isBone || o === B.hips || above.has(o) || under(o)) return; if (o.parent && o.parent.isBone && !above.has(o.parent)) return; this.loose.push({ b: o, rel: new THREE.Matrix4() }); }); } catch (e) { this.loose = []; }
    this.ok = true;
  }
  // the doll's points for the pose the skeleton is in now (world space). The matrices must be current.
  points(out = this.pts) {
    const B = this.B, W = (k, i) => { const e = B[k].matrixWorld.elements, p = out[i]; p[0] = e[12]; p[1] = e[13]; p[2] = e[14]; return p; };
    const P = W('hips', I.P), C = W('chest', I.C), N = W('neck', I.N), hd = W('head', I.H);
    { const dx = hd[0] - N[0], dy = hd[1] - N[1], dz = hd[2] - N[2], l = Math.hypot(dx, dy, dz) || 1; hd[0] += (dx / l) * 0.1; hd[1] += (dy / l) * 0.1; hd[2] += (dz / l) * 0.1; }
    for (const s of ['L', 'R']) { W('upper_arm_' + s, I['S' + s]); const e = W('forearm_' + s, I['E' + s]), w = W('hand_' + s, I['W' + s]), a = out[I['A' + s]], l = Math.hypot(w[0] - e[0], w[1] - e[1], w[2] - e[2]) || 1; for (let k = 0; k < 3; k++) a[k] = w[k] + ((w[k] - e[k]) / l) * 0.09;
      W('thigh_' + s, I['H' + s]); W('shin_' + s, I['K' + s]); const f = W('foot_' + s, I['F' + s]); if (B['toe_' + s]) W('toe_' + s, I['T' + s]); else { const t = out[I['T' + s]]; t[0] = f[0]; t[1] = f[1] - 0.05; t[2] = f[2]; } }
    // the front points of the two blocks: forward is left x up (and is checked against where the toes point)
    const front = (L, R_, lo, hi, o, fwd, up) => { const lx = L[0] - R_[0], ly = L[1] - R_[1], lz = L[2] - R_[2], ux = hi[0] - lo[0], uy = hi[1] - lo[1], uz = hi[2] - lo[2], ul = Math.hypot(ux, uy, uz) || 1;
      let fx = ly * uz - lz * uy, fy = lz * ux - lx * uz, fz = lx * uy - ly * ux; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl; if (this.flip) { fx = -fx; fy = -fy; fz = -fz; }
      o[0] = lo[0] + fx * fwd + (ux / ul) * up; o[1] = lo[1] + fy * fwd + (uy / ul) * up; o[2] = lo[2] + fz * fwd + (uz / ul) * up; return o; };
    if (this.flip === undefined) { this.flip = false; const t = front(out[I.HL], out[I.HR], P, C, [0, 0, 0], 1, 0), toe = out[I.TL], an = out[I.FL], toe2 = out[I.TR], an2 = out[I.FR]; this.flip = (t[0] - P[0]) * (toe[0] - an[0] + toe2[0] - an2[0]) + (t[2] - P[2]) * (toe[2] - an[2] + toe2[2] - an2[2]) < 0; }
    front(out[I.HL], out[I.HR], P, C, out[I.PF], 0.1, -0.03); front(out[I.SL], out[I.SR], C, N, out[I.CF], 0.105, 0.07);
    return out;
  }
  frame(d, o, l, r_, f, out) {      // a block's orientation from its points: x forward, y up, z right
    const p = d.p, lx = p[l * 3] - p[r_ * 3], ly = p[l * 3 + 1] - p[r_ * 3 + 1], lz = p[l * 3 + 2] - p[r_ * 3 + 2]; _v.set(lx, ly, lz).normalize();
    _v2.set(p[f * 3] - p[o * 3], p[f * 3 + 1] - p[o * 3 + 1], p[f * 3 + 2] - p[o * 3 + 2]); _v2.addScaledVector(_v, -_v2.dot(_v)).normalize(); _v3.crossVectors(_v2, _v);
    return out.setFromRotationMatrix(_m.makeBasis(_v2, _v3, _v.negate()));
  }
  dir(d, a, b, out) { const p = d.p; return out.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]).normalize(); }
  // remember how the bones sit on the points now (call once, with the doll made from points())
  begin(doll) {
    const B = this.B; for (const k of ORDER) if (B[k]) B[k].getWorldQuaternion(this.q0[k]);
    this.frame(doll, I.P, I.HL, I.HR, I.PF, this.fp0).invert(); this.frame(doll, I.C, I.SL, I.SR, I.CF, this.fc0).invert();
    for (const l of LIMBS) this.dir(doll, I[l[1]], I[l[2]], this.d0[l[0]]); this.dir(doll, I.N, I.H, this.d0.neck); this.dir(doll, I.P, I.C, this.d0.spine);
    for (const L of this.loose) L.rel.copy(B.hips.matrixWorld).invert().multiply(L.b.matrixWorld);
    // the lumbar joint sits off the line from the hips to the chest: where it is from the hips now, and the way the chest lies from it
    this.sOff = null; if (B.spine && B.spine !== B.chest) { const p = doll.p, e = B.spine.matrixWorld.elements; this.sOff = (this.sOff0 || (this.sOff0 = new THREE.Vector3())).set(e[12] - p[I.P * 3], e[13] - p[I.P * 3 + 1], e[14] - p[I.P * 3 + 2]); this.sDir = (this.sDir || new THREE.Vector3()).set(p[I.C * 3] - e[12], p[I.C * 3 + 1] - e[13], p[I.C * 3 + 2] - e[14]); if (this.sDir.length() < 0.04) this.sOff = null; else this.sDir.normalize(); }
    // which way each knee folds, as the thigh bone sits now (the thigh is turned about its own length later so the knee stays a hinge)
    this.kb = this.kb || { L: new THREE.Vector3(), R: new THREE.Vector3() }; for (const s of ['L', 'R']) { const b = doll.kneeBack(I['H' + s], I['K' + s]); if (b) this.kb[s].set(b[0], b[1], b[2]); else this.kb[s].set(0, 0, 0); }
  }
  apply(doll) {
    const B = this.B, R = this.R, q0 = this.q0, p = doll.p, hips = B.hips, par = hips.parent;
    par.updateWorldMatrix(true, false); hips.position.copy(par.worldToLocal(_v.set(p[I.P * 3], p[I.P * 3 + 1], p[I.P * 3 + 2])));
    this.frame(doll, I.P, I.HL, I.HR, I.PF, R.pelvis).multiply(this.fp0); this.frame(doll, I.C, I.SL, I.SR, I.CF, R.chestB).multiply(this.fc0);
    const swing = (base, d0, a, b, out) => { _v.copy(d0).applyQuaternion(base); this.dir(doll, a, b, _v2); return out.setFromUnitVectors(_v, _v2).multiply(base); };
    R.hips.copy(R.pelvis);
    if (this.sOff) { _v3.copy(this.sOff).applyQuaternion(R.pelvis); _v2.set(p[I.C * 3] - p[I.P * 3] - _v3.x, p[I.C * 3 + 1] - p[I.P * 3 + 1] - _v3.y, p[I.C * 3 + 2] - p[I.P * 3 + 2] - _v3.z).normalize(); _v.copy(this.sDir).applyQuaternion(R.pelvis); R.spine.setFromUnitVectors(_v, _v2).multiply(R.pelvis); }
    else swing(R.pelvis, this.d0.spine, I.P, I.C, R.spine);
    R.chest.copy(B.chest === B.spine ? R.spine : R.chestB); R.chest2.copy(R.chestB); R.clavicle_L.copy(R.chestB); R.clavicle_R.copy(R.chestB);
    swing(R.chestB, this.d0.neck, I.N, I.H, R.head); R.neck.copy(R.chestB).slerp(R.head, 0.6);
    for (const l of LIMBS) { swing(l[3] === 'chest' ? R.chestB : l[3] === 'pelvis' ? R.pelvis : R[l[3]], this.d0[l[0]], I[l[1]], I[l[2]], R[l[0]]);
      if (l[0] === 'thigh_L' || l[0] === 'thigh_R') {      // turn the thigh about its own length until its knee folds the way the shin has gone
        const s = l[0] === 'thigh_L' ? 'L' : 'R', kb = this.kb[s]; if (kb.lengthSq() < 0.5) continue;
        const t = this.dir(doll, I['H' + s], I['K' + s], _v), sh = this.dir(doll, I['K' + s], I['F' + s], _v2), flex = sh.addScaledVector(t, -sh.dot(t)).length(); if (flex < 0.12) continue; sh.multiplyScalar(1 / flex);
        const ref = _v3.copy(kb).applyQuaternion(R[l[0]]); ref.addScaledVector(t, -ref.dot(t)); if (ref.lengthSq() < 1e-4) continue; ref.normalize();
        let ang = Math.atan2(_v4.crossVectors(ref, sh).dot(t), ref.dot(sh)); ang = clamp(ang, -0.6, 0.6) * sm((flex - 0.12) / 0.3); R[l[0]].premultiply(_q.setFromAxisAngle(t, ang)); } }
    R.toe_L.copy(R.foot_L); R.toe_R.copy(R.foot_R);
    // world rotations -> local, parents first
    const wq = this.wq, pool = this.wqp || (this.wqp = new Map()), tmp = (b) => { let q = pool.get(b); if (!q) pool.set(b, (q = new THREE.Quaternion())); return q; };      // (nothing is allocated per frame: the quaternions are kept per bone)
    wq.clear(); const world = (b) => { let q = wq.get(b); if (q) return q; q = tmp(b); if (b === par || !b.parent) b.getWorldQuaternion(q); else q.copy(world(b.parent)).multiply(b.quaternion); wq.set(b, q); return q; };
    wq.set(par, par.getWorldQuaternion(tmp(par)));
    for (const k of ORDER) { const b = B[k]; if (!b || (k === 'chest' && b === B.spine)) continue; const w = this._w || (this._w = {}), t = w[k] || (w[k] = new THREE.Quaternion()); t.copy(R[k]).multiply(q0[k]); b.quaternion.copy(_q2.copy(world(b.parent)).invert()).multiply(t); wq.set(b, t); }
    if (this.loose.length) { hips.updateWorldMatrix(true, false); for (const L of this.loose) { const b = L.b; if (!b.parent) continue; b.parent.updateWorldMatrix(true, false); _m.copy(b.parent.matrixWorld).invert().multiply(_mL.multiplyMatrices(hips.matrixWorld, L.rel)).decompose(b.position, b.quaternion, b.scale); } }
  }
}

// ---------------------------------------------------------------------------------------------------------------- made-up clips
// A crouch laid over whatever pose the skeleton is in: hips down with the feet kept where they are, the trunk folded forward, the
// head tucked, the arms brought up (to the back of the head when deep). World-space turns about the body's own side-to-side axis.
const D2R = Math.PI / 180;
function crouch(fit, k, o) {
  const B = fit.B, a = B.thigh_L.matrixWorld.elements, b = B.thigh_R.matrixWorld.elements, L = new THREE.Vector3(a[12] - b[12], 0, a[14] - b[14]).normalize(); if (fit.flip) L.negate();
  const P = (bn) => bn.getWorldPosition(new THREE.Vector3()), leg = P(B.thigh_L).distanceTo(P(B.shin_L)) + P(B.shin_L).distanceTo(P(B.foot_L)), d = o.drop * k * leg, phi = Math.acos(clamp(1 - d / leg, -1, 1));
  const hips = B.hips, w = hips.getWorldPosition(new THREE.Vector3()); w.y -= d; hips.position.copy(hips.parent.worldToLocal(w)); hips.updateMatrixWorld(true);
  const turn = (bn, ang) => { if (bn) worldRotate(bn, _q.setFromAxisAngle(L, ang)); };
  for (const s of ['L', 'R']) { turn(B['thigh_' + s], -phi); turn(B['shin_' + s], 2 * phi); turn(B['foot_' + s], -phi); }
  const lean = (o.lean * k + (o.wob || 0) * 2) * D2R / 3; turn(B.spine, lean); if (B.chest !== B.spine) turn(B.chest, lean); turn(B.chest2, lean); turn(B.neck, (o.nod * k + (o.wob || 0) * 3) * D2R);
  for (const s of ['L', 'R']) { turn(B['upper_arm_' + s], -(o.armUp * k) * D2R); turn(B['forearm_' + s], -(o.fore * k) * D2R); }
}
const COWER = { drop: 0.42, lean: 62, nod: 20, armUp: 140, fore: 115 }, DUCK = { drop: 0.2, lean: 30, nod: 16, armUp: 38, fore: 85 };
// Cower (a loop: crouched, hands over the head, trembling) and Duck (the startle: down fast, half up) for every crowd character,
// made from its standing pose and baked into the crowd's clip texture beside the mocap
function addClips(Bd) {
  const cr = Bd.crowd, R = cr.render, cast = Bd.cast, sim = Bd.sim, t0 = performance.now(); if (sim.clips.some((c) => c.name === 'Cower')) return;
  const idleName = (sim.idles[0] || sim.clips[0]).name, idle = cast.animations.find((c) => c.name.toLowerCase() === idleName.toLowerCase()); if (!idle) return;
  const defs = [['Cower', 2.0, [0, 0.5, 1.0, 1.5, 2.0], (i) => [1, COWER, [0, 1, -0.6, 0.8, 0][i]]], ['Duck', 1.6, [0, 0.16, 0.7, 1.6], (i) => [[0, 1, 0.82, 0.75][i], DUCK, 0]]], out = defs.map(() => []);
  for (const ch of cast.chars) {
    const root = ch.root, pre = ch.name + '_', tr = idle.tracks.filter((t) => t.name.startsWith(pre)); if (!tr.length) continue;
    const mixer = new THREE.AnimationMixer(root), act = mixer.clipAction(new THREE.AnimationClip('tmp_' + ch.name, idle.duration, tr)); act.play(); mixer.setTime(0); root.updateMatrixWorld(true);
    const fit = new Fit(root, ch.name); if (!fit.ok) { act.stop(); mixer.uncacheRoot(root); continue; } fit.points();
    const bones = [...new Set(ORDER.map((k) => fit.B[k]).filter(Boolean))], base = bones.map((b) => [b.quaternion.clone(), b.position.clone()]);
    const reset = () => { bones.forEach((b, i) => { b.quaternion.copy(base[i][0]); b.position.copy(base[i][1]); }); root.updateMatrixWorld(true); };
    defs.forEach(([name, dur, times, at], di) => {
      const Q = bones.map(() => []), HP = [];
      times.forEach((t, i) => { const [k, o, wob] = at(i); reset(); if (k > 0) crouch(fit, k, Object.assign({ wob }, o)); bones.forEach((b, j) => Q[j].push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)); HP.push(fit.B.hips.position.x, fit.B.hips.position.y, fit.B.hips.position.z); });
      bones.forEach((b, j) => out[di].push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, Q[j]))); out[di].push(new THREE.VectorKeyframeTrack(fit.B.hips.name + '.position', times, HP));
    });
    reset(); act.stop(); mixer.uncacheRoot(root);
  }
  defs.forEach(([name, dur], di) => { cast.animations.push(new THREE.AnimationClip(name, dur, out[di])); sim.clipNames.push(name); sim.clips.push({ i: sim.clips.length, name, duration: dur, speed: 0, loop: true, needs: null }); });
  const Bk = bake(Bd.g.world.renderer, cast, sim.clipNames, R.smooth || 0), old = R.baked.tex; R.baked = Bk; R.U.tAnim.value = Bk.tex; R.U.uAnimInv.value.set(1 / Bk.W, 1 / Bk.H); old.dispose();
  Bd.cower = sim.clips.find((c) => c.name === 'Cower'); Bd.duck = sim.clips.find((c) => c.name === 'Duck');
  console.log('[people] cower and duck clips made for ' + cast.chars.length + ' characters, crowd clips re-baked: ' + Math.round(performance.now() - t0) + ' ms');
}

// ---------------------------------------------------------------------------------------------------------------- the stand-in's look
// The crowd's own material for a character, with three's ordinary skinning in place of the crowd's instance stage: the same tints
// through the same vertex masks, the same baked ground light and occlusion terms (crowd/render.js patch()).
function standMaterial(src, part, shared, hasMask) {
  const m = src.clone(); m.vertexColors = false; m.transparent = false; m.depthWrite = true; if (part.alphaTest) { m.alphaTest = part.alphaTest; m.side = THREE.DoubleSide; } m.envMapIntensity = src.envMapIntensity;
  const U = (m.userData.si = { uT0: { value: new THREE.Vector3(1, 1, 1) }, uT1: { value: new THREE.Vector3(1, 1, 1) }, uT2: { value: new THREE.Vector3(1, 1, 1) }, uMask: { value: new THREE.Vector3(...(Array.isArray(part.mask) ? part.mask : [0, 0, 0])) }, uFeet: { value: 0 }, uWound: { value: new THREE.Vector4(0, 0, 0, 0) } });
  const lit = !!(shared && shared.tLight && shared.tLight.value), ao = hasMask && part.ao;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        ${hasMask ? 'attribute vec4 aMask;' : ''} uniform vec3 uMask; uniform vec3 uT0; uniform vec3 uT1; uniform vec3 uT2; uniform float uFeet; varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO; varying vec3 vBind;`)
      .replace('#include <project_vertex>', `vBind = position; { vec4 siW = modelMatrix * vec4(transformed, 1.0); vWPos = siW.xyz; vCH = siW.y - uFeet;
        ${hasMask ? 'vec3 siM = aMask.rgb; vCAO = aMask.a;' : 'vec3 siM = uMask; vCAO = 1.0;'}
        vCTint = mix(vec3(1.0), uT0, siM.r) * mix(vec3(1.0), uT1, siM.g) * mix(vec3(1.0), uT2, siM.b); }
        #include <project_vertex>`);
    if (shared) Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter });
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vCTint; varying float vCH; varying float vCAO; varying vec3 vBind; uniform vec4 uWound; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vCTint; if (uWound.w > 0.0) { vec3 wd = vBind - uWound.xyz; float wr = length(wd) * (1.0 + 0.22 * sin(wd.x * 70.0 + wd.y * 31.0) + 0.16 * sin(wd.y * 110.0 - wd.z * 47.0 + 1.7)); float sw = 1.0 - smoothstep(uWound.w * 0.6, uWound.w, wr); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.13, 0.008, 0.008) + vec3(0.05, 0.0015, 0.0015), sw * 0.96); }')
      .replace('#include <aomap_fragment>', (lit ? 'bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);' + BAKE_LIGHT_GLSL : '') + `
        { float ao = ${ao ? 'clamp(vCAO, 0.0, 1.0)' : '1.0'}; float cg = mix(0.45, 1.0, smoothstep(0.0, 1.25, vCH)); float amb = 0.8; float sunK = 1.15;
          reflectedLight.indirectDiffuse *= cg * amb * ao; reflectedLight.indirectSpecular *= cg * 0.5 * ao; reflectedLight.directDiffuse *= mix(1.0, ao, 0.2) * sunK; reflectedLight.directSpecular *= ao * 1.5; }`);
  };
  m.customProgramCacheKey = () => 'standin6|' + (hasMask ? 'm' : 'u') + (ao ? 'a' : '') + (lit ? 'l' : 'd');
  return m;
}

const BLOB_GEO = new THREE.BufferGeometry(); BLOB_GEO.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3)); BLOB_GEO.setIndex([0, 2, 1, 0, 3, 2]);
const BLOB_MAT = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, uniforms: { uK: { value: 0.62 } },
  vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float uK; varying vec2 vQ; void main(){ float d = length(vQ); float a = 1.0 - smoothstep(0.0, 1.0, d); gl_FragColor = vec4(0.0, 0.0, 0.0, uK * a * a * (0.6 + 0.8 * a)); }' });
// blood on the ground under a body at rest: a small dark stain that spreads slowly and stops (no spray, no gore)
// LIT, like the pavement it lies on (it takes the sun, the shade and the exposure with it): as an unlit quad it was multiplied by the
// film pass's auto-exposure and glowed neon red in the shade (round 11 captures). uH: how hard the edge is (spots harder than pools)
BLOB_GEO.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
// Round 15: a DECAL UNDER BODIES by draw order (opaque, hard edge by discard, renderOrder 1, no depth write; bodies are renderOrder 3, so a
// body lying on it always covers it), and UNLIT: a dark red divided by the film pass's live exposure (POOL_K, set each frame in poseRest),
// so it shows as the same dark red in sun and shade (lit it went pink, unlit and undivided it glowed).
const POOL_K = { value: 1 }, POOL_TEX = { value: null }, POOL_TEXON = { value: 0 };      // (live play meters exposure into a 1x1 texture the film pass reads, world.js tExp / uExpTex: the pool divides by the same texel, or it glows red in shade: seen in out/pub/lead_over.jpg)
function poolMat() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const U = (m.uniforms = { uA: { value: 0 }, uS: { value: 0 }, uH: { value: 0.22 }, uPK: POOL_K, tPExp: POOL_TEX, uPExpOn: POOL_TEXON });
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvQ = position.xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uA; uniform float uS; uniform float uH; uniform float uPK; uniform sampler2D tPExp; uniform float uPExpOn; varying vec2 vQ;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ float an = atan(vQ.y, vQ.x); float edge = 0.72 + 0.12 * sin(an * 2.0 + uS) + 0.08 * sin(an * 5.0 + uS * 2.3) + 0.05 * sin(an * 9.0 + uS * 0.7) + 0.05 * uH * sin(an * 14.0 + uS * 1.9); float pd = length(vQ) / edge; pd *= 1.0 + 0.10 * sin(vQ.x * 9.0 + uS * 3.1) * sin(vQ.y * 11.0 - uS * 1.7); float pa = 1.0 - smoothstep(mix(0.86, 0.95, uH), 1.0, pd); /* (close stills, Nov 12: the rim had round punched holes and one flat colour: a sticker. Now a whole lobed shape, thin and browner at the rim, deep in the middle, with a faint wet sheen off-centre) */ if (uA * pa < 0.5) discard; float thick = 1.0 - smoothstep(0.25, 0.97, pd); vec3 bc = mix(vec3(0.085, 0.012, 0.008), vec3(0.036, 0.0012, 0.0012), smoothstep(0.0, 0.55, thick)); float sh = exp(-dot(vQ - vec2(0.18, -0.22), vQ - vec2(0.18, -0.22)) * 9.0) * (0.6 + 0.4 * sin(vQ.x * 17.0 + uS)); bc += vec3(0.022, 0.016, 0.016) * sh * thick; float pk = uPExpOn > 0.5 ? 1.0 / clamp(texture2D(tPExp, vec2(0.5)).r, 0.25, 8.0) : uPK; diffuseColor = vec4(bc * pk, 1.0); }'); };
  m.customProgramCacheKey = () => 'bloodpool11'; return m;
}
// blood in the air at the hit: a short burst of dark drops out of the far side (and a few back toward the gun) that fall and leave
// small spots on the ground behind the person. One Points object for everything; restrained: no chunks, gone in half a second
const NDROP = 120, NSPOT = 36;
class Drops {
  constructor(B) {
    this.B = B; this.n = 0; this.pos = new Float32Array(NDROP * 3).fill(-999); this.vel = new Float32Array(NDROP * 3); this.life = new Float32Array(NDROP); this.sz = new Float32Array(NDROP); this.al = new Float32Array(NDROP); this.spot = new Float32Array(NDROP); this.next = 0;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(this.sz, 1)); g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aS; attribute float aA; uniform float uScale; varying float vA; varying float vM; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, aS * uScale / max(0.3, -mv.z)); vA = aS > 0.0 ? aA : 0.0; vM = aS > 0.05 ? 1.0 : 0.0; }',
      fragmentShader: 'varying float vA; varying float vM; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float a = 1.0 - smoothstep(0.0, 1.0, length(q)); a *= mix(a, 1.0, 0.3); if (a * vA < 0.01) discard; gl_FragColor = vec4(mix(vec3(0.03, 0.002, 0.002), vec3(0.07, 0.004, 0.003), vM), a * vA); }' });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 4; B.blobs.add(this.pts);
    this.spots = []; this.si = 0;
  }
  // at (x, y, z) three.js space, bullet travelling along unit d; k: how much (1 a pistol round)
  burst(x, y, z, dx, dy, dz, k, rnd) {
    const n = Math.round(10 * k), nb = Math.round(9 * k); let left = Math.round(7 * k);
    for (let j = 0; j < n + nb; j++) { const i = this.next; this.next = (this.next + 1) % NDROP; const back = j >= n, sp = back ? 0.25 + rnd() * 0.5 : 1.2 + rnd() * rnd() * 4.5, sg = 1, c = back ? 1.2 : 0.4;
      { const o = back ? -0.1 : 0.12; this.pos[i * 3] = x + dx * o; this.pos[i * 3 + 1] = y + (rnd() - 0.5) * 0.06; this.pos[i * 3 + 2] = z + dz * o; }
      this.vel[i * 3] = (dx * sg + (rnd() - 0.5) * c) * sp; this.vel[i * 3 + 1] = (dy * sg + (rnd() - 0.3) * c) * sp + 0.6; this.vel[i * 3 + 2] = (dz * sg + (rnd() - 0.5) * c) * sp;
      this.life[i] = back ? 0.5 : 0.4; this.sz[i] = back ? 0.08 + rnd() * 0.08 : 0.008 + rnd() * 0.012; this.al[i] = back ? 0.7 : 0.85; this.spot[i] = 0;
      // some of it reaches the ground behind them within a quarter of a second: a few spots and one larger splash, there from then on
      if (!back && left-- > 0) { const big = false; this.spot[i] = big ? 0.17 + rnd() * 0.06 : 0.035 + rnd() * rnd() * 0.1; this.life[i] = 1.5; const s2 = big ? 1.1 + rnd() * 0.6 : 0.8 + rnd() * 2.6; this.vel[i * 3] = (dx + (rnd() - 0.5) * 0.9) * s2; this.vel[i * 3 + 1] = -2.2 - rnd() * 1.6; this.vel[i * 3 + 2] = (dz + (rnd() - 0.5) * 0.9) * s2; } }
    this.n = NDROP;
  }
  step(dt, cam, h) {
    for (const s of this.spots) if (s.t < 1) { s.t = Math.min(1, s.t + dt * 5); s.me.scale.setScalar(s.r * (0.4 + 0.6 * s.t)); }
    if (!this.n) return; let live = 0; const P = this.pos, V = this.vel, env = this.B.env;
    for (let i = 0; i < NDROP; i++) { if (this.life[i] <= 0) continue; this.life[i] -= dt; const k = i * 3, mist = this.sz[i] > 0.05; if (mist) { this.sz[i] += dt * 0.35; this.al[i] = Math.max(0, this.al[i] - dt * 1.4); V[k + 1] += 8.6 * dt; } V[k + 1] -= 9.81 * dt; const d = Math.exp(-2.2 * dt); V[k] *= d; V[k + 2] *= d; P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      const g = env.ground(P[k], P[k + 2]); if (P[k + 1] <= g + 0.01 || this.life[i] <= 0) { if (P[k + 1] <= g + 0.01 && this.spot[i]) this.land(P[k], g, P[k + 2], this.spot[i]); this.life[i] = 0; this.sz[i] = 0; P[k + 1] = -999; } else live++; }
    this.n = live; this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.aS.needsUpdate = true; this.pts.geometry.attributes.aA.needsUpdate = true; this.mat.uniforms.uScale.value = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
  }
  land(x, g, z, sz) {
    let s = this.spots[this.si]; if (!s) { const me = new THREE.Mesh(BLOB_GEO, poolMat()); me.frustumCulled = false; me.renderOrder = 1; me.receiveShadow = true; this.B.blobs.add(me); s = this.spots[this.si] = { me, t: 0, r: 0 }; } this.si = (this.si + 1) % NSPOT;
    s.t = 0; s.r = sz; s.me.material.uniforms.uH.value = 0.7; s.me.position.set(x, g + 0.03, z); s.me.rotation.y = x * 7.1 + z * 3.3; s.me.material.uniforms.uS.value = x * 3.7 + z; s.me.material.uniforms.uA.value = 0.9; s.me.scale.setScalar(s.r * 0.4);
  }
}
const PATCH_MAT = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, uniforms: { uA: { value: 0 }, uS: { value: 0 } },
  vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float uA; uniform float uS; varying vec2 vQ; void main(){ float an = atan(vQ.y, vQ.x); float edge = 0.7 + 0.14 * sin(an * 3.0 + uS) + 0.09 * sin(an * 5.0 + uS * 2.3) + 0.05 * sin(an * 11.0 + uS * 0.7); float d = length(vQ) / edge; float a = 1.0 - smoothstep(0.78, 1.0, d); gl_FragColor = vec4(mix(vec3(0.05, 0.002, 0.002), vec3(0.02, 0.001, 0.001), smoothstep(0.0, 0.6, 1.0 - d)), uA * a); }' });
// where a bullet meets the figure's own surface (the hit test is a cylinder): one ray against the skinned meshes as they are posed now
const _rc = new THREE.Raycaster();
function surface(root, h) {
  const d = new THREE.Vector3(h.dx, h.dz, -h.dy).normalize(), o = new THREE.Vector3(h.x, h.z, -h.y).addScaledVector(d, -0.35); _rc.set(o, d); _rc.far = 1.1; let best = null;
  root.traverse((m) => { if (!m.isSkinnedMesh || !m.visible) return; try { const hits = []; m.raycast(_rc, hits); for (const q of hits) if (!best || q.distance < best.distance) { best = q; best.obj = m; } } catch (e) {} });
  if (!best) return null; const n = best.face ? best.face.normal.clone().transformDirection(best.obj.matrixWorld) : d.clone().negate(); if (n.dot(d) > 0) n.negate(); return { point: best.point.clone(), normal: n, dir: d };
}
// a wound on a figure that has ordinary materials (the kit's people): a small dark wet patch lying on the surface, carried by the nearest bone
function patch(fit, S, rnd) {
  let bone = null, bd = 1e9; for (const k in fit.B) { const b = fit.B[k]; if (!b) continue; const d = b.getWorldPosition(_v).distanceTo(S.point); if (d < bd) { bd = d; bone = b; } } if (!bone) return null;
  const me = new THREE.Mesh(BLOB_GEO, PATCH_MAT.clone()); me.material.uniforms.uS.value = rnd * 20; me.material.uniforms.uA.value = 0.9; me.frustumCulled = false; me.renderOrder = 2;
  const ws = bone.getWorldScale(new THREE.Vector3()).x || 1, bq = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  me.position.copy(bone.worldToLocal(S.point.clone().addScaledVector(S.normal, 0.006))); me.quaternion.copy(bq).multiply(_q.setFromUnitVectors(UP, S.normal)); me.userData = { t: 0, k: 1 / ws }; me.scale.setScalar(0.02 / ws); bone.add(me); return me;
}
// one skinned figure of a crowd character, re-used for whoever of that character is shot next
class StandIn {
  constructor(B, ci) {
    const cast = B.cast, ch = cast.chars[ci], shared = B.g.world.shared; this.ci = ci; this.ch = ch; this.name = ch.name;
    const root = SkeletonUtils.clone(ch.root); this.holder = new THREE.Group(); this.holder.add(root); this.root = root; root.traverse((o) => { if (o.isMesh) o.renderOrder = 3; }); this.mats = []; this.accs = [];
    const meshes = []; root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); }); let skel = null;
    meshes.forEach((me, k) => {
      const part = ch.parts[k] || ch.parts[0], src = part.geometry, hasMask = !!src.attributes.color && part.mask === true, g = new THREE.BufferGeometry(); g.setIndex(src.index);
      for (const n of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (src.attributes[n]) g.setAttribute(n, src.attributes[n]); if (hasMask) g.setAttribute('aMask', src.attributes.color);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); me.geometry = g; me.material = standMaterial(part.material, part, shared, hasMask); this.mats.push(me.material);
      if (!skel) skel = me.skeleton; else if (me.skeleton.bones.length === skel.bones.length) me.bind(skel, me.bindMatrix);
      me.frustumCulled = false; me.castShadow = true; me.receiveShadow = true;
    });
    // what they may be carrying: every accessory hangs ready on its bone, shown only when this person has it
    for (const a of cast.accs || []) { const bone = root.getObjectByName(ch.name + '_' + a.bone); if (!bone) { this.accs.push(null); continue; }
      const hasMask = !!a.geometry.attributes.color, g = new THREE.BufferGeometry(); g.setIndex(a.geometry.index); for (const n of ['position', 'normal', 'uv']) if (a.geometry.attributes[n]) g.setAttribute(n, a.geometry.attributes[n]); if (hasMask) g.setAttribute('aMask', a.geometry.attributes.color);
      const me = new THREE.Mesh(g, standMaterial(a.material, { mask: hasMask ? true : [0, 0, 0] }, shared, hasMask)); me.matrixAutoUpdate = false; const k = ch.height / 1.8; me.matrix.makeScale(k, k, k).multiply(a.local); me.castShadow = true; me.receiveShadow = true; me.frustumCulled = false; me.visible = false; bone.add(me); me.renderOrder = 3; this.accs.push(me); this.mats.push(me.material); }
    // the soft dark where a figure meets the ground (the crowd draws one under every agent; a body keeps its own, spreading as it lies down)
    this.blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT.clone()); this.blob.frustumCulled = false; this.blob.renderOrder = 3; this.blob.visible = false; B.blobs.add(this.blob);
    this.mixer = new THREE.AnimationMixer(root); this.acts = new Map(); this.fit = new Fit(root, ch.name); this.used = false; this.doll = null; this.t = 0;
  }
  action(B, clipIndex) {
    let a = this.acts.get(clipIndex); if (a !== undefined) return a;
    const name = B.sim.clips[clipIndex].name, src = B.cast.animations.find((c) => c.name.toLowerCase() === name.toLowerCase()), pre = [this.name + '_', this.name + '.'];
    const tracks = src ? src.tracks.filter((t) => t.name.startsWith(pre[0]) || t.name.startsWith(pre[1])) : [];
    a = tracks.length ? this.mixer.clipAction(new THREE.AnimationClip(name + '_' + this.name, src.duration, tracks)) : null; this.acts.set(clipIndex, a); return a;
  }
  // stand where the agent stands, in the pose its instance is drawn in (dt: seconds earlier or later than now)
  pose(B, a, dt = 0) {
    const h = this.holder; h.position.set(a.x, a.z, -a.y); h.rotation.set(0, a.h, 0); h.scale.setScalar(a.scale);
    const mx = this.mixer; mx.stopAllAction(); const C = B.sim.clips, bl = a.blend > 0.004 ? a.blend : 0;
    const A = this.action(B, a.clip), Bc = bl ? this.action(B, a.clipB) : null;
    const wrap = (t, d) => ((t % d) + d) % d;
    if (A) { A.reset(); A.setEffectiveWeight(Bc ? 1 - bl : 1); A.play(); A.time = wrap(a.ph * C[a.clip].duration + dt * (a.rate ?? 1), C[a.clip].duration); }
    if (Bc) { Bc.reset(); Bc.setEffectiveWeight(bl); Bc.play(); Bc.time = wrap(a.phB * C[a.clipB].duration + dt * (a.rateB ?? 1), C[a.clipB].duration); }
    mx.update(0); h.updateMatrixWorld(true);
  }
  // a dark wet stain on the clothes where the bullet went in, spreading a little: fixed to the body (worked out in the mesh's bind space)
  mark(x, y, z, dx, dy, dz) {
    const B = this.fit.B, P = new THREE.Vector3(x + dx * 0.09, y + dy * 0.09, z + dz * 0.09), mid = (a, b) => a.getWorldPosition(new THREE.Vector3()).lerp(b.getWorldPosition(_v2), 0.5);
    const cand = [[B.head, B.head.getWorldPosition(new THREE.Vector3())], [B.chest2 || B.chest, mid(B.chest, B.neck)], [B.hips, mid(B.hips, B.chest)], [B.thigh_L, mid(B.thigh_L, B.shin_L)], [B.thigh_R, mid(B.thigh_R, B.shin_R)], [B.shin_L, mid(B.shin_L, B.foot_L)], [B.shin_R, mid(B.shin_R, B.foot_R)]];
    let best = cand[0], bd = 1e9; for (const c of cand) { const d = c[1].distanceTo(P); if (d < bd) { bd = d; best = c; } }
    let me = null; this.root.traverse((o) => { if (o.isSkinnedMesh && !me) me = o; }); if (!me) return; const j = me.skeleton.bones.indexOf(best[0]); if (j < 0) return;
    _m.multiplyMatrices(best[0].matrixWorld, me.skeleton.boneInverses[j]).multiply(me.bindMatrix).invert(); P.applyMatrix4(_m); this.wound = { t: 0, x: P.x, y: P.y, z: P.z };
  }
  dress(a) {
    for (const m of this.mats) { const U = m.userData.si; tintOf(a.tint[0], U.uT0.value); tintOf(a.tint[1], U.uT1.value); tintOf(a.tint[2], U.uT2.value); U.uFeet.value = a.z; U.uWound.value.set(0, 0, 0, 0); }
    this.wound = null;
    this.accs.forEach((me, k) => { if (!me) return; me.visible = !!(a.acc & (1 << k)); if (me.visible) { const U = me.material.userData.si; tintOf(a.accT[k], U.uT0.value); U.uT1.value.set(1, 1, 1); U.uT2.value.set(1, 1, 1); } });
  }
}

// ---------------------------------------------------------------------------------------------------------------- Bodies
export class Bodies {
  constructor(game, combat) {
    this.g = game; this.c = combat; this.blood = !(game.P && game.P.get && ['0', 'off', 'none'].includes(game.P.get('gblood')));      // ?gblood=0: no blood at all (drops, spots, pools, stains, the guns' own red mist)
    this.live = []; this.free = []; this.peds = []; this.n = 0; this.ms = 0; this.on = true;
    const st = game.statics;
    // walls and standing things from the map, and the cars near a falling body as boxes (a point is eased out of a box, a few cm a step)
    this.boxes = []; this.boxN = 0;
    this.env = { ground: (x, z) => (st.onSidewalk(x, -z) ? 0.15 : 0), solid: true, cross: (x0, z0, x1, z1) => st.raycast(x0, -z0, x1, -z1) < 1,
      // np: walls only (a body let go by the doll's `noWall` rule: no chairs, posts or cars, but a building still holds it)
      wall: (x, z, r, out, y, np) => { let hit = false; if (st.resolve(x, -z, r, _o, !!np)) { x = _o.x; z = -_o.y; hit = true; }
      if (!np) for (const c of this.boxes) { const dx = x - c.x, dy = -z - c.y; if (dx * dx + dy * dy > c.r2 || (y !== undefined && y > c.top)) continue; const lx = dx * c.cs + dy * c.sn, ly = -dx * c.sn + dy * c.cs, px = c.hx + r - Math.abs(lx), py = c.hy + r - Math.abs(ly); if (px <= 0 || py <= 0) continue;
        let ex = 0, ey = 0; if (px < py) ex = (lx < 0 ? -1 : 1) * Math.min(px, 0.05); else ey = (ly < 0 ? -1 : 1) * Math.min(py, 0.05); x += ex * c.cs - ey * c.sn; z -= ex * c.sn + ey * c.cs; hit = true; }
      // (seen on a laptop, out/pub/crossA_k0: a body lying INSIDE a concrete block) the map holds street furniture as a circle (a block: r 0.5 m) but a block is
      // drawn as a box whose corners reach 0.75 m: for a body the big furniture circles count 45 % wider (eased out, 5 cm a step at most)
      if (!np && st.circ && st.key && st.cell) { try { const ci = Math.floor(x / st.cell), cj = Math.floor(-z / st.cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const L = st.circ.get(st.key(ci + a, cj + b)); if (!L) continue; for (const c of L) { if (!c.on || c.tag !== 'furniture' || c.r < 0.45 || (y !== undefined && y > 0.75)) continue; const dx = x - c.x, dy = -z - c.y, d = Math.hypot(dx, dy), R = c.r * 1.45 + r; if (d >= R || d < 1e-6) continue; const e = Math.min(R - d, 0.05); x += (dx / d) * e; z -= (dy / d) * e; hit = true; } } } catch (e) {} }
      if (hit) { out.x = x; out.z = z; } return hit; } };
    this.blobs = new THREE.Group(); game.world.scene.add(this.blobs); try { this.drops = new Drops(this); } catch (e) { this.drops = null; }
    { const gt = game.world.gtao, bl = this.blobs; if (gt && gt.renderOverride && !gt._bodies) { gt._bodies = true; const ro = gt.renderOverride.bind(gt); const self = this; gt.renderOverride = function (...a) { const v = bl.visible; bl.visible = false; for (const q of self.peds) if (q.body && q.body.mark) q.body.mark.visible = false; try { return ro(...a); } finally { bl.visible = v; for (const q of self.peds) if (q.body && q.body.mark) q.body.mark.visible = true; } }; } }
    const cr = game.crowd; this.crowd = cr && cr.on ? cr : null;
    this.pools = [];
    if (!this.blood) { try { if (combat && combat.fx && combat.fx.blood) combat.fx.blood = () => {}; } catch (e) {} }
    try { const w = new THREE.Mesh(BLOB_GEO, poolMat()); w.material.uniforms.uA.value = 1; w.position.set(0, -60, 0); w.frustumCulled = false; w.renderOrder = 1; w.receiveShadow = true; this.blobs.add(w); } catch (e) {}
    this.t = 0; this.threats = []; this.pending = []; this.afraid = []; this.flinches = []; this.hidden = []; this.seedN = 4242;
    // a hit that does not kill: combat.hit() answers 'ped'; the flinch starts from here (its code is not ours to edit)
    // a bullet meets a body that is already down (the game's own ray skips them): flesh, a jolt, a little blood
    if (combat && combat.cast) { const cast0 = combat.cast.bind(combat), self = this; combat.cast = function (ox, oy, oz, dx, dy, dz, tmin, tmax) { const H = cast0(ox, oy, oz, dx, dy, dz, tmin, tmax); try { self.castDown(H, ox, oy, oz, dx, dy, dz, tmin); } catch (e) {} return H; }; }
    if (combat && combat.hit) { const hit0 = combat.hit.bind(combat), self = this; combat.hit = function (h, W, first) { if (h.kind === 'body') { try { self.hitDown(h, W, first); } catch (e) {} return 'body'; } const r = hit0(h, W, first); if (r === 'ped' && h.obj) { try { self.wound(h.obj, h.kind, h); } catch (e) { if (!self._err2) { self._err2 = true; console.log('[people] wound failed: ' + (e && (e.stack || e.message))); } } } return r; }; }
    if (this.crowd) { this.sim = cr.sim; this.cast = cr.render.cast; this.group = new THREE.Group(); this.group.name = 'bodies'; game.world.scene.add(this.group);
      try { addClips(this); } catch (e) { console.log('[people] no cower clips: ' + (e && (e.stack || e.message))); }
      this.warm();
      // an agent that a stand-in is playing is drawn by the crowd at no size for that frame (its ground shadow stays)
      const R = cr.render, up0 = R.update.bind(R), H = this.hidden; R.update = function () { if (!H.length) return up0(); for (const a of H) { a._s = a.scale; a.scale = 0; } try { return up0(); } finally { for (const a of H) a.scale = a._s; } }; }
  }
  // the first stand-in is built and drawn once out of sight at load, so the first kill does not wait for a shader to compile
  warm() { try { const b = new StandIn(this, 0); b.holder.position.set(0, -60, 0); this.group.add(b.holder); this.free.push(b); this._warm = { b, n: 4 }; } catch (e) { console.log('[people] stand-in not built: ' + (e && (e.stack || e.message))); this.crowd = null; } }
  take(ci) {
    let i = this.free.findIndex((b) => b.ci === ci), b;
    if (i >= 0) b = this.free.splice(i, 1)[0]; else { b = new StandIn(this, ci); this.group.add(b.holder); }
    if (!b.fit.ok) return null;
    // room in the pool: the oldest body that is out of sight goes; if all are in sight, the oldest
    while (this.live.length >= POOL) { let k = this.live.findIndex((q) => q.doll && !this.seen(q)); if (k < 0) k = this.live.findIndex((q) => q.doll); if (k < 0) break; this.release(this.live[k]); }
    if (b.rest) this.freeze(b, false); b.rest = 0; b.used = true; b.holder.visible = true; b.t = 0; this.live.push(b); return b;
  }
  release(b) { const i = this.live.indexOf(b); if (i >= 0) this.live.splice(i, 1); if (b.rest) this.freeze(b, false); b.rest = 0; b.used = false; b.doll = null; b.holder.visible = false; b.blob.visible = false; this.free.push(b); if (this.free.length > 30) { const d = this.free.shift(); this.group.remove(d.holder); } }
  // a stand-in at rest: three's per-frame skeleton update (bone matrices and the bone texture's upload) is switched off / on again
  freeze(b, on) { try { b.root.traverse((o) => { if (!o.isSkinnedMesh || !o.skeleton) return; const sk = o.skeleton; if (on) { if (sk.update !== NOOP) { sk.update(); sk.update = NOOP; } } else if (sk.update === NOOP) delete sk.update; }); } catch (e) {} }
  seen(b) { const cam = this.g.world.camera, p = b.doll ? b.doll.p : null; if (!p) return false; _v.set(p[I.P * 3], p[I.P * 3 + 1], p[I.P * 3 + 2]); const d = _v.distanceTo(cam.position); if (d > 120) return false; _v.project(cam); return Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.2 && _v.z < 1; }

  // h: the hit, sim space (x y z, dx dy dz, part). Returns true when the death is ours.
  kill(p, kind, h, force = 1) {
    if (!this.on) return false;
    try { const ok = kind === 'ped' ? this.killPed(p, h, force) : this.killCrowd(p, h, force); if (ok) { this.bleed(h, force); this._shotAt = force < 4 ? { x: p.x, y: p.y } : null; } return ok; } catch (e) { if (!this._err) { this._err = true; console.log('[people] kill failed: ' + (e && (e.stack || e.message))); } return false; }
  }
  hitOf(h, force) { const o = { x: h.x, y: h.z, z: -h.y, dx: h.dx, dy: h.dz, dz: -h.dy, part: h.part, force }; if (h.cx !== undefined) { o.cx = h.cx; o.cy = h.cz ?? 0.3; o.cz = -h.cy; } return o; }
  killCrowd(a, h, force) {
    if (!this.crowd || a.gone) return false; this.endFlinch(a); const cs = this.sim, b = this.take(a.char); if (!b) return false;
    // the pose a thirtieth of a second ago and the pose now: where the joints are and how fast each is moving
    const fit = b.fit, D = 1 / 30; b.dress(a); b.pose(this, a, -D); const p0 = fit.points().map((q) => q.slice()); b.pose(this, a, 0); const pts = fit.points();
    const vx = Math.cos(a.h) * a.v, vz = -Math.sin(a.h) * a.v, vel = pts.map((q, i) => [(q[0] - p0[i][0]) / D + vx, (q[1] - p0[i][1]) / D, (q[2] - p0[i][2]) / D + vz]);
    const doll = new Doll(pts, this.env, a.id); doll.setVel(vel); fit.begin(doll); doll.hit(this.hitOf(h, force)); b.doll = doll; b.who = a; this.pool(doll, h, force); if (force < 4 && this.blood) { const S = surface(b.root, h); if (S) b.mark(S.point.x, S.point.y, S.point.z, S.dir.x * 0.25, S.dir.y * 0.25, S.dir.z * 0.25); else b.mark(h.x, h.z, -h.y, h.dx, h.dz, -h.dy); }
    // the instanced agent leaves the crowd in this same frame
    cs.remove(a); cs.hits++; a.state = 'down';
    this.n++; return true;
  }
  killPed(p, h, force) {
    const vis = p.vis; if (!vis || !vis.mixer) return false; const name = vis.name || p.kind, o = vis.object;
    let fit = vis._fit; if (!fit || fit.root !== o) fit = vis._fit = new Fit(o, name); if (!fit.ok) return false;
    const mx = vis.mixer, ts = mx.timeScale, D = 1 / 30, sp = p.state === 'walk' || p.state === 'flee' ? (p.state === 'flee' ? 4.6 : p.speed || 0) : 0;
    mx.timeScale = 1; mx.update(-D * ts); o.updateMatrixWorld(true); const p0 = fit.points().map((q) => q.slice()); mx.update(D * ts); o.updateMatrixWorld(true); const pts = fit.points();
    const vx = Math.cos(p.h) * sp, vz = -Math.sin(p.h) * sp, vel = pts.map((q, i) => [(q[0] - p0[i][0]) / D + vx, (q[1] - p0[i][1]) / D, (q[2] - p0[i][2]) / D + vz]);
    const doll = new Doll(pts, this.env, (p.x * 31 + p.y * 17) | 0); doll.setVel(vel); fit.begin(doll); doll.hit(this.hitOf(h, force));
    let mark = null; if (force < 4 && this.blood) { try { const S = surface(o, h); if (S) mark = patch(fit, S, this.rnd()); } catch (e) {} }
    try { o.traverse((q) => { if (q.isMesh) q.renderOrder = 3; }); } catch (e) {}
    p.state = 'down'; p.t = 0; p.fall = 0; p.vx = 0; p.vy = 0; mx.timeScale = 0; p.body = { doll, fit, mark, blob: new THREE.Mesh(BLOB_GEO, BLOB_MAT.clone()) }; p.body.blob.frustumCulled = false; p.body.blob.renderOrder = 3; this.blobs.add(p.body.blob); this.peds.push(p); this.pool(doll, h, force);
    this.n++; return true;
  }
  bleed(h, force) { if (!this.drops || !this.blood || force >= 4) return; const l = Math.hypot(h.dx, h.dy, h.dz || 0) || 1; this.drops.burst(h.x, h.z, -h.y, h.dx / l, (h.dz || 0) / l, -h.dy / l, Math.min(1.8, 0.7 + 0.3 * force), () => this.rnd()); }
  castDown(H, ox, oy, oz, dx, dy, dz, tmin) {
    const one = (d) => { if (!d || d.t < 0.04) return; const p = d.p, ex = p[I.P * 3] - ox, ey = -p[I.P * 3 + 2] - oy, ez = p[I.P * 3 + 1] - oz, al = ex * dx + ey * dy + ez * dz; if (al < 0 || al > H.t + 1.5) return; if (ex * ex + ey * ey + ez * ez - al * al > 2.2) return;
      for (const i of DOWN) { const cx = p[i * 3] - ox, cy = -p[i * 3 + 2] - oy, cz = p[i * 3 + 1] - oz, b = cx * dx + cy * dy + cz * dz, r = i === I.C || i === I.P ? 0.16 : 0.11, q = b * b - (cx * cx + cy * cy + cz * cz) + r * r; if (q < 0) continue; const t = b - Math.sqrt(q); if (t < tmin || t >= H.t) continue;
        H.t = t; H.kind = 'body'; H.x = ox + dx * t; H.y = oy + dy * t; H.z = oz + dz * t; H.nx = -dx; H.ny = -dy; H.nz = -dz; H.obj = d; H.part = 'body'; H.dx = dx; H.dy = dy; H.dz = dz; } };
    for (const b of this.live) one(b.doll); for (const q of this.peds) one(q.body && q.body.doll);
  }
  hitDown(h, W, first) {
    const c = this.c, d = h.obj, dx = h.dx ?? -h.nx, dy = h.dy ?? -h.ny, dz = h.dz ?? -h.nz; try { c.fx.impact(_v.set(h.x, h.z, -h.y), _v2.set(-dx, -dz, dy), 'flesh', { power: 0.8 }); } catch (e) {}
    d.nudge(h.x, h.z, -h.y, dx, dz - 0.15, -dy, Math.min(1.5, 0.75 + 0.25 * ((W && W.force) || 1))); if (first) this.bleed({ x: h.x, y: h.y, z: h.z, dx, dy, dz }, 0.3);
  }
  // the cars near bodies that are still moving, as boxes for env.wall
  cars() {
    const B = this.boxes, g = this.g; B.length = 0; const add = (c) => { if (!c || !c.def) return; const cs = Math.cos(c.h), sn = Math.sin(c.h), hx = c.def.len / 2 - 0.08, hy = c.def.wid * 0.45; B.push({ x: c.x, y: c.y, cs, sn, hx, hy, r2: (hx + 1) * (hx + 1) + (hy + 1) * (hy + 1), top: (c.z || 0) + c.def.hgt * 0.85 }); };
    const near = (d) => { if (!d || d.asleep) return; const x = d.p[I.P * 3], y = -d.p[I.P * 3 + 2]; try { for (const c of g.parked.near(x, y, 6, (this._pk ||= []))) if (!B.some((b) => b.x === c.x && b.y === c.y)) add(c); } catch (e) {}
      for (const L of [g.traffic && g.traffic.cars, g.vehicles]) if (L) for (const c of L) if (Math.abs(c.x - x) < 7 && Math.abs(c.y - y) < 7 && !B.some((b) => b.x === c.x && b.y === c.y)) add(c); };
    for (const b of this.live) near(b.doll); for (const q of this.peds) near(q.body && q.body.doll);
  }
  rnd() { this.seedN = (this.seedN * 1664525 + 1013904223) >>> 0; return this.seedN / 4294967296; }

  // ------------------------------------------------------------------ hit but alive: a flinch where it struck
  pool(doll, h, force) {
    if (!this.blobs || !this.blood || force >= 4) return; const i = doll.nearest(h.x, h.z, -h.y, [I.H, I.C, I.CF, I.P, I.PF, I.KL, I.KR]), i2 = i === I.C || i === I.CF ? I.P : i, me = new THREE.Mesh(BLOB_GEO, poolMat()); me.frustumCulled = false; me.renderOrder = 1; me.visible = false; me.receiveShadow = true; me.rotation.y = this.rnd() * 6.28;
    me.material.uniforms.uS.value = this.rnd() * 20; this.blobs.add(me); this.pools.push({ me, doll, i, i2, t: 0, r: 0.5 + this.rnd() * 0.16, sx: 0.85 + this.rnd() * 0.4 });
    if (this.pools.length > 14) { const d = this.pools.shift(); this.blobs.remove(d.me); d.me.material.dispose(); }
  }
  wound(p, kind, h) {
    if (!this.on || p.gone || p.state === 'down') return false; this.bleed(h, 0.5);
    const dl = Math.hypot(h.dx, h.dy) || 1, F = { p, kind, t: 0, dx: h.dx / dl, dz: -h.dy / dl, part: h.part, amp: h.part === 'head' ? 0.6 : 0.62, b: null, side: this.rnd() < 0.5 ? 1 : -1 };
    if (kind === 'crowd') {
      if (!this.crowd) return false; this.endFlinch(p); const pl = this.g.player; if (Math.hypot(p.x - pl.x, p.y - pl.y) > 28) return false;
      const b = this.take(p.char); if (!b) return false; b.dress(p); b.who = p; b.doll = null; F.b = b; this.hidden.push(p); p.v = Math.min(p.v, 0.25);
    } else { if (!p.vis || !p.vis.mixer) return false; this.endFlinch(p); let fit = p.vis._fit; if (!fit || fit.root !== p.vis.object) fit = p.vis._fit = new Fit(p.vis.object, p.vis.name || p.kind); if (!fit.ok) return false; F.fit = fit; }
    this.flinches.push(F); return true;
  }
  endFlinch(p) { const i = this.flinches.findIndex((f) => f.p === p); if (i < 0) return; const F = this.flinches[i]; this.flinches.splice(i, 1); if (F.b) { const k = this.hidden.indexOf(p); if (k >= 0) this.hidden.splice(k, 1); this.release(F.b); } }
  // the trunk is knocked along the bullet's way and comes back; the head whips after it; the struck side's shoulder goes with it
  flinch(F, dt) {
    const fit = F.b ? F.b.fit : F.fit, B = fit.B, u = F.t / 0.75, e = u < 0.16 ? sm(u / 0.16) : 1 - sm((u - 0.16) / 0.84), e2 = u < 0.3 ? sm(u / 0.3) : 1 - sm((u - 0.3) / 0.7);
    // the knees give for a moment: the hips drop and both legs fold to keep the feet where they are
    { const hips = B.hips, dip = 0.085 * e2, a = B.thigh_L.matrixWorld.elements, b = B.thigh_R.matrixWorld.elements, L = _v2.set(a[12] - b[12], a[13] - b[13], a[14] - b[14]).normalize(), phi = Math.acos(clamp(1 - dip / 0.86, -1, 1));
      hips.parent.worldToLocal(hips.getWorldPosition(_v3).addScaledVector(UP, -dip)); hips.position.copy(_v3); hips.updateMatrixWorld(true);
      if (fit.flip) phi_fix(L); _q.setFromAxisAngle(L, -phi); worldRotate(B.thigh_L, _q); worldRotate(B.thigh_R, _q); _q.setFromAxisAngle(L, 2 * phi); worldRotate(B.shin_L, _q); worldRotate(B.shin_R, _q); _q.setFromAxisAngle(L, -phi); worldRotate(B.foot_L, _q); worldRotate(B.foot_R, _q); }
    const ax = _v.set(F.dz, 0, -F.dx).normalize(), th = F.amp * e;      // up x dir: turning about it tips the body the way the bullet went
    if (F.part === 'legs') { _q.setFromAxisAngle(ax, -th * 0.9); for (const k of ['spine', 'chest']) if (B[k]) worldRotate(B[k], _q); const leg = B[F.side > 0 ? 'thigh_L' : 'thigh_R'], sh = B[F.side > 0 ? 'shin_L' : 'shin_R']; _q.setFromAxisAngle(ax, th * 0.8); worldRotate(leg, _q); _q.setFromAxisAngle(ax, -th * 1.4); worldRotate(sh, _q); return; }
    _q.setFromAxisAngle(ax, th / 3); for (const k of ['spine', 'chest', 'chest2']) if (B[k] && !(k === 'chest' && B.chest === B.spine)) worldRotate(B[k], _q);
    _q.setFromAxisAngle(UP, F.side * th * 0.5); if (B.chest2) worldRotate(B.chest2, _q);
    _q.setFromAxisAngle(ax, F.part === 'head' ? th * 0.9 : -F.amp * e2 * 0.5); worldRotate(B.neck, _q);
    const arm = B[F.side > 0 ? 'upper_arm_L' : 'upper_arm_R']; _q.setFromAxisAngle(ax, th * 0.9); worldRotate(arm, _q);
  }

  // ------------------------------------------------------------------ bystanders
  // A shot or a blast at (x, y): everyone within r comes to know of it after a human reaction time that grows with distance.
  scare(x, y, r, level) {
    if (!this.on) return false; const t = this.t, rnd = () => this.rnd();
    // someone shot dead: the people round them come to know, but what they run from is the gun, not the body (a threat placed on the
    // victim sent everyone between the two straight at the shooter)
    let tx = x, ty = y; { const k = this._shotAt, pl = this.g.player; if (k && k.x === x && k.y === y && pl) { tx = pl.x; ty = pl.y; } this._shotAt = null; }
    let th = this.threats.find((q) => Math.hypot(q.x - tx, q.y - ty) < 6); if (!th) { this.threats.push((th = { x: tx, y: ty, t, level, r })); if (this.threats.length > 8) this.threats.shift(); } th.t = t; th.level = Math.max(th.level, level); th.r = Math.max(th.r, r + Math.hypot(tx - x, ty - y));
    const note = (p, kind) => { const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy; if (d2 > r * r) return; const d = Math.sqrt(d2); if (level < 2 && d > r * 0.55 && rnd() < 0.3) return;      // far off, one shot: not everyone has understood yet
      p._re = t + (d < 10 ? 0.12 + rnd() * 0.16 : 0.16 + d / 343 + rnd() * 0.28 + (d / r) * (d / r) * (level < 2 ? 1.1 : 0.6) * rnd()); this.pending.push({ p, kind }); };
    for (const p of this.g.peds.list) if (!p.fear && !p._re && p.state === 'walk') note(p, 'ped');
    if (this.sim) for (const a of this.sim.agents) if (!a.gone && !a.fear && !a._re && a.state !== 'down') { note(a, 'crowd'); if (a._re && a.state === 'sit') a._re += rnd() * 0.3; }      // someone sitting takes longer to be up and away
    return true;
  }
  // someone who was just hit: they know at once
  frighten(p, kind, x, y, secs) {
    if (!this.on) return false; if (p.gone || p.state === 'down') return true; if (p.fear) { p.fear.T = Math.max(p.fear.T, secs); p.fear.hold = Math.min(p.fear.hold, 0.3); return true; }
    if (!this.threats.length) this.threats.push({ x, y, t: this.t, level: 1, r: 40 });
    if (!p._re) this.pending.push({ p, kind }); p._re = this.t + 0.3; p._hit = true; return true;
  }
  threatFor(p) { let best = null, bd = 1e9; for (const q of this.threats) { if (this.t - q.t > 9) continue; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = q; } } this._td = bd; return best; }
  react(p, kind) {
    const rnd = () => this.rnd(), th = this.threatFor(p) || this.threats[this.threats.length - 1]; if (!th) return; const d = Math.hypot(p.x - th.x, p.y - th.y);
    // most run at once; some stand rooted for a moment first (more of them close by, where it is hardest to believe)
    const sat = kind === 'crowd' && p.state === 'sit'; if (sat) { if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } try { this.sim.leaveGroup(p); } catch (e) {} p.w = null; try { this.sim.rejoin(p); } catch (e) {} if (p.gone || !p.w) return; p.v = 0; }
    const q = rnd(), hold = sat ? 0.28 + rnd() * 0.25 : p._hit ? 0 : q < (d < 14 ? 0.28 : 0.14) ? 0.25 + rnd() * 0.45 : 0; p._hit = false;
    const F = (p.fear = { T: 9 + rnd() * 6, hold, think: 0, kind, run: false, v: 0, calm: null }); this.afraid.push(p);
    if (kind === 'crowd') { const cs = this.sim; F.calm = { v0: p.v0 };
      // a few go to ground where they are, hands over the head, and only run when it has gone on for a while
      if (this.cower && !hold && p.state !== 'sit' && d < 32 && rnd() < (d < 16 ? 0.2 : 0.1) && this.g.statics.onSidewalk(p.x, p.y) && p.state !== 'cross') { this.startCower(p, F, 2.5 + rnd() * 7); return; }
      if (hold > 0) { F.v0 = p.v0; p.v0 = 0; if (this.duck) { try { cs.leaveGroup(p); } catch (e) {} F.idle = p.idle; p.idle = this.duck; p.talk = null; p.walkClip = this.duck; p.v = Math.min(p.v, 0.5); cs.setClip(p, this.duck); p.ph = sat ? 0.1 : 0; } } }
    else { F.calm = { speed: p.speed, walk: p.walk, walkSpeed: p.walkSpeed }; if (hold > 0) p.speed = 0.02;
      // the kit's people have no crouch clip: the same made-up crouch the crowd has is laid over their own pose each frame (poseRest)
      else if (d < 32 && p.state === 'walk' && rnd() < (d < 16 ? 0.2 : 0.1)) { F.cower = 2.5 + rnd() * 6; p.speed = 0.02; return; } }
    if (!hold) this.run(p, F, th);
  }
  startCower(p, F, secs) {
    const cs = this.sim; try { cs.leaveGroup(p); } catch (e) {} if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state !== 'stand') { p.state = 'stand'; cs.nStand++; } p.t = 0; p.standT = 1e9; p.tx = p.x; p.ty = p.y; p.th = p.h; p.talk = null; p.v = Math.min(p.v, 0.3);
    F.idle = p.idle; p.idle = this.cower; cs.setClip(p, this.cower); F.cower = secs; F.hold = 0;
  }
  run(p, F, th) {
    const rnd = () => this.rnd(); F.run = true; F.hold = 0; F.cower = 0; if (F.idle) { p.idle = F.idle; F.idle = null; }
    if (F.kind === 'ped') { if (p.state !== 'walk') return; p.speed = 3.9 + rnd() * 1.3; if (p.vis.acts && p.vis.acts.run) { p.walk = 'run'; p.walkSpeed = p.vis.runSpeed || 4; this.g.peds.setAnim(p, 'run'); } if (th) this.steer(p, F, th, true); return; }
    const cs = this.sim; try { cs.leaveGroup(p); } catch (e) {}
    if (p.wq) { p.wq.w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; }
    if (p.state === 'sit') { if (p.seatOf) { if (p.seatOf.who === p) p.seatOf.who = null; p.seatOf = null; } p.w = null; p.state = 'walk'; if (th) { p.h = Math.atan2(p.y - th.y, p.x - th.x); } p.v = 1.8; }      // up from the chair and off
    if (p.state === 'stand') { cs.nStand--; p.state = 'walk'; }
    if (!p.w) { try { cs.rejoin(p); } catch (e) {} if (p.gone || !p.w) { p.fear = null; return; } }
    if (p.state === 'wait') { const w = p.w; p.state = w.kind === 'cross' ? 'cross' : 'walk'; p.lt = clamp((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny, -1.8, 1.8); p.la = 0; }
    if (p.state === 'flee') return;
    p.talk = null; p.path = null; p.noPlan = null; p.trip = 1e9; p.door = 0; try { cs.hold(p, null); } catch (e) {}
    p.walkClip = cs.jog; F.v = p.v0 = Math.min(4.7, cs.jog.speed * p.tall * (1.32 + rnd() * 0.3)); p.v = Math.max(p.v, 1.3 + rnd() * 0.9); cs.setClip(p, cs.jog); p.ph = rnd();
    if (th) this.steer(p, F, th, true);
  }
  // keep going away from the nearest shooting: along the walk one is on; turn round if that walk leads back toward it
  steer(p, F, th, first) {
    const ax = p.x - th.x, ay = p.y - th.y, l = Math.hypot(ax, ay) || 1;
    if (F.kind === 'ped') { const t = this._t || (this._t = {}); p.loop.at(p.s, t); const al = (t.tx * ax + t.ty * ay) / l * p.dir; if (al < (first ? 0 : -0.3) && l < 50) p.dir = -p.dir; return; }
    p.gx = ax / l; p.gy = ay / l; const w = p.w; if (!w || w.kind === 'cross' || w.ux === undefined) return;
    const al = (w.ux * p.gx + w.uy * p.gy) * p.d; if (al < (first ? -0.08 : -0.35) && l < 50) { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; }
  }
  calm(p, F) {
    p.fear = null; if (p.gone || p.state === 'down') return;
    if (F.kind === 'ped') { if (F.calm) { p.speed = F.calm.speed; p.walk = F.calm.walk; p.walkSpeed = F.calm.walkSpeed; this.g.peds.setAnim(p, p.walk); } return; }
    if (F.idle) { p.idle = F.idle; F.idle = null; } if (p.state === 'stand' && p.standT > 1e8) { p.standT = 0; p.t = 1; }
    try { this.sim.pace(p, 1.2 + this.rnd() * 0.5); } catch (e) { p.v0 = (F.calm && F.calm.v0) || 1.3; }
  }
  stepFear(dt) {
    const t = (this.t += dt), P = this.pending, A = this.afraid;
    for (let i = this.threats.length - 1; i >= 0; i--) if (t - this.threats[i].t > 25) this.threats.splice(i, 1);
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i], p = q.p; if (p.gone || p.state === 'down') { p._re = 0; P.splice(i, 1); continue; } if (t >= p._re) { p._re = 0; P.splice(i, 1); if (!p.fear) this.react(p, q.kind); } }
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i], F = p.fear; if (!F || p.gone || p.state === 'down' || (F.kind === 'ped' && !this.g.peds.list.includes(p))) { p.fear = null; A.splice(i, 1); continue; }
      if (F.cower > 0) { F.cower -= dt; if (F.cower <= 0) { const th = this.threatFor(p); if (th && this._td < 45) { this.run(p, F, th); if (!p.fear) { A.splice(i, 1); } } else { A.splice(i, 1); this.calm(p, F); } } continue; }
      if (F.hold > 0) { F.hold -= dt; if (F.hold <= 0) { if (F.kind === 'crowd' && F.v0) p.v0 = F.v0; this.run(p, F, this.threatFor(p)); if (!p.fear) { A.splice(i, 1); continue; } } else continue; }
      F.think -= dt; if (F.think <= 0) { F.think = 0.35 + this.rnd() * 0.3; const th = this.threatFor(p); if (th && this._td < 70) { F.T = Math.max(F.T, 6 + this.rnd() * 3); this.steer(p, F, th, false); }
        if (F.kind === 'crowd' && F.run) {      // the crowd's own habits do not apply to someone running for their life
          if (p.state === 'wait' && p.wq) { const w = p.w; w.wait[p.wq.end][p.wq.n] = 0; p.wq = null; p.state = 'cross'; p.lt = clamp((p.x - w.ax) * w.nx + (p.y - w.ay) * w.ny, -1.8, 1.8); p.la = 0; }
          else if (p.state === 'stand') { this.sim.nStand--; p.state = 'walk'; p.path = null; }
          if (p.state !== 'flee') { p.v0 = F.v; if (p.walkClip !== this.sim.jog) p.walkClip = this.sim.jog; } } }
      // nobody jogs on the spot: someone who cannot get on (hemmed in, a dead end) goes to ground there, or tries the other way
      if (F.kind === 'crowd' && F.run && p.state !== 'flee') { F.pt = (F.pt || 0) + dt; if (F.px === undefined) { F.px = p.x; F.py = p.y; F.pt = 0; } if (F.pt > 0.5) { const moved = Math.hypot(p.x - F.px, p.y - F.py); F.px = p.x; F.py = p.y; F.pt = 0; if (moved < 0.3) F.stuck = 9; }
        if (p.v < 0.5) F.stuck = (F.stuck || 0) + dt; else if (F.stuck < 9) F.stuck = 0;
        if (F.stuck > 0.35) { F.stuck = 0; if (this.cower && this.g.statics.onSidewalk(p.x, p.y) && p.state !== 'cross' && this.rnd() < 0.45) { F.run = false; this.startCower(p, F, 2.5 + this.rnd() * 5); continue; } else if (p.w && p.w.kind !== 'cross') { p.d = -p.d; p.path = null; p.noPlan = null; p.la = 0; F.spin = 0.7; } } }
      // someone who turns to run does it on the spot, fast (the crowd's own turn is a stroller's arc)
      if (F.spin > 0 && F.kind === 'crowd' && p.w && p.w.ux !== undefined && (p.state === 'walk' || p.state === 'cross')) { F.spin -= dt; const want = Math.atan2(p.w.uy * p.d, p.w.ux * p.d); let dh = want - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += clamp(dh, -6.5 * dt, 6.5 * dt); if (Math.abs(dh) > 1) p.v = Math.max(p.v, 1.2); }
      F.T -= dt; if (F.T <= 0) { A.splice(i, 1); this.calm(p, F); }
    }
  }

  // the fixed 1/60 s step
  step(dt) {
    const t0 = performance.now();
    try { this.stepFear(dt); } catch (e) { if (!this._err3) { this._err3 = true; console.log('[people] bystanders failed: ' + (e && (e.stack || e.message))); } }
    if (--this.boxN <= 0) { this.boxN = 12; try { this.cars(); } catch (e) { this.boxes.length = 0; } }
    for (const b of this.live) { if (!b.doll) continue; b.t += dt; b.doll.step(dt); }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i], d = p.body.doll; if (!this.g.peds.list.includes(p)) { this.peds.splice(i, 1); this.blobs.remove(p.body.blob); if (p.body.mark && p.body.mark.parent) p.body.mark.parent.remove(p.body.mark); p.body = null; continue; }
      if (p.body.mark) { const m = p.body.mark, u = m.userData; u.t += dt; m.scale.setScalar((0.045 + 0.065 * (1 - Math.exp(-u.t / 1.2))) * u.k); }
      d.step(dt); p.fall = 0; p.x = d.p[I.P * 3]; p.y = -d.p[I.P * 3 + 2];
      if (d.t < 40) p.t = Math.min(p.t, 5);      // the game clears a fallen pedestrian after nine seconds: ours lies longer
    }
    this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  // after the clips have posed everyone, before the frame is drawn
  pose(dt) {
    if (this._warm && --this._warm.n <= 0) { if (!this._warm.b.used) this._warm.b.holder.visible = false; this._warm = null; }
    const t0 = performance.now();
    // (public report 075004-16a733: frame rate beside a body) a body AT REST is posed once and then left alone: no fit, no shadow blob work, and
    // for a stand-in no skeleton update or bone-texture upload either (rest: 0 moving, 1 posed for the last time, 2 frozen). A shot wakes it.
    for (const b of this.live) if (b.doll) { const d = b.doll;
      if (b.wound && b.wound.t < 9) { const W = b.wound; W.t += dt; const r = 0.045 + 0.07 * (1 - Math.exp(-W.t / 1.3)); for (const m of b.mats) m.userData.si.uWound.value.set(W.x, W.y, W.z, r); }
      if (d.asleep && b.rest) { if (b.rest === 1) { this.freeze(b, true); b.rest = 2; } this.nRest = (this.nRest || 0) + 1; continue; }
      if (b.rest) { this.freeze(b, false); b.rest = 0; }
      b.fit.apply(d); this.shade(d, b.blob, 1); if (d.asleep) b.rest = 1; }
    for (const p of this.peds) { const o = p.vis.object, bd = p.body, d = bd.doll, hq = bd.fit.B.hips.quaternion;
      // (a kit pedestrian's figure is the game's own: at rest it is left as posed unless something else has moved it since)
      if (d.asleep && bd.rest && o.position.x === bd.rx && o.position.z === bd.rz && o.rotation.y === bd.rh && hq.x === bd.hx && hq.y === bd.hy && hq.z === bd.hz && hq.w === bd.hw) continue;
      o.position.set(p.x, this.env.ground(p.x, -p.y), -p.y); o.rotation.set(0, p.h, 0); o.updateMatrixWorld(true); bd.fit.apply(d); this.shade(d, bd.blob, 0);
      bd.rest = d.asleep; if (bd.rest) { bd.rx = o.position.x; bd.rz = o.position.z; bd.rh = o.rotation.y; bd.hx = hq.x; bd.hy = hq.y; bd.hz = hq.z; bd.hw = hq.w; } }
    this.poseRest(dt, t0);
    if (this.drops) { const w = this.g.world; this.drops.step(dt, w.camera, w.renderer.domElement.height); }
  }
  // a body's ground shadow: under the trunk, long as the body once it is down (up: how strong it is while the figure still stands)
  shade(doll, bl, up) {
    { const p = doll.p, mx = (p[I.P * 3] + p[I.C * 3]) / 2, mz = (p[I.P * 3 + 2] + p[I.C * 3 + 2]) / 2, hx = p[I.H * 3] - (p[I.FL * 3] + p[I.FR * 3]) / 2, hz = p[I.H * 3 + 2] - (p[I.FL * 3 + 2] + p[I.FR * 3 + 2]) / 2, len = Math.hypot(hx, hz), low = clamp(1.25 - p[I.C * 3 + 1] + this.env.ground(mx, mz), 0, 1);
      bl.visible = true; bl.position.set(mx, this.env.ground(mx, mz) + 0.012, mz); bl.rotation.y = Math.atan2(-hz, hx); bl.scale.set(0.6 + Math.max(0, len * 0.62 - 0.3) * low, 1, 0.6 + 0.1 * low); bl.material.uniforms.uK.value = (0.62 - 0.12 * low) * (up + (1 - up) * low); }
  }
  poseRest(dt, t0) {
    // the pool: nothing until the trunk has lain for a moment; then it starts small on the ground under the wound and creeps outward
    // for ten seconds or so (it stays where it began: the ground does not follow a limb that is still settling)
    { let ex = 0; try { const f = this.g.world && this.g.world.film; ex = f && f.uniforms && f.uniforms.uExposure ? +f.uniforms.uExposure.value : 0; } catch (e) { ex = 0; } POOL_K.value = ex > 0.05 && isFinite(ex) ? clamp(1 / ex, 0.35, 1.6) : 1; try { const fu = this.g.world.film.uniforms; POOL_TEX.value = fu.tExp ? fu.tExp.value : null; POOL_TEXON.value = fu.uExpTex && fu.uExpTex.value > 0.5 && POOL_TEX.value ? 1 : 0; } catch (e) { POOL_TEXON.value = 0; } }      // (capped: in live play on a laptop the pool showed BRIGHT red under trees, out/pub/lead_over.jpg: one over a small exposure figure blew it up)
    for (const q of this.pools) { const d = q.doll; if (!q.me.visible && d.lain < 0.45 && !d.asleep) continue; q.t += dt; const r = q.r * (0.15 + 0.85 * (1 - Math.exp(-q.t / 1.8)));      // from a hand's width: half size after a second, full in about five (at 3.0 s round 19's critics saw no pool in 2.4 s)
      if (!q.me.visible) { const P = d.p, lo = P[I.SL * 3 + 1] < P[I.SR * 3 + 1] ? I.SL : I.SR, ox = P[lo * 3] - P[I.C * 3], oz = P[lo * 3 + 2] - P[I.C * 3 + 2], ol = Math.hypot(ox, oz) || 1, x = P[q.i * 3] * 0.65 + P[q.i2 * 3] * 0.35 + (ox / ol) * 0.3, z = P[q.i * 3 + 2] * 0.65 + P[q.i2 * 3 + 2] * 0.35 + (oz / ol) * 0.3; q.me.visible = true; q.me.position.set(x, this.env.ground(x, z) + 0.02, z); }
      q.me.scale.set(Math.max(0.01, r * q.sx), 1, Math.max(0.01, r)); q.me.material.uniforms.uA.value = 0.96; }
    for (const p of this.afraid) { const F = p.fear; if (!F || F.kind !== 'ped' || p.state === 'down' || !p.vis || !p.vis.object) continue; const want = F.cower > 0 || F.hold > 0; F.dk = clamp((F.dk || 0) + (want ? dt * 6 : -dt * 3.5), 0, 1); if (F.dk <= 0) continue;
      try { let fit = p.vis._fit; if (!fit || fit.root !== p.vis.object) fit = p.vis._fit = new Fit(p.vis.object, p.vis.name || p.kind); if (!fit.ok) continue; p.vis.object.updateMatrixWorld(true); if (fit.flip === undefined) fit.points(); if (F.cower > 0) F.deep = true;
        crouch(fit, sm(F.dk), Object.assign({ wob: F.deep ? Math.sin(this.t * 9 + p.x) * 0.35 : 0 }, F.deep ? COWER : DUCK)); } catch (e) {} }
    for (let i = this.flinches.length - 1; i >= 0; i--) { const F = this.flinches[i], p = F.p; F.t += dt;
      if (F.t > 0.75 || p.gone || p.state === 'down') { this.endFlinch(p); continue; }
      if (F.b) F.b.pose(this, p, 0); else p.vis.object.updateMatrixWorld(true);
      this.flinch(F, dt); }
    this.msPose = (this.msPose || 0) + (performance.now() - t0 - (this.msPose || 0)) * 0.05;
  }
}
