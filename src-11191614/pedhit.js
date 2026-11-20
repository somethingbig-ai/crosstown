import { ragdollGround } from './ragdollGround.js';
// pedhit.js: what happens when the player's car hits a person (Matt, Nov 10 18:33: "Running over people needs to be more satisfying").
// One file, no dependencies but three.js and the game object: `install(game)` once after game.init(). It wraps game.onPedHit.
//   - a real ragdoll: 15 points joined like a body (verlet), started from the person's pose at the moment of the hit with the car's
//     speed and direction; it is carried by the bonnet, thrown, tumbles, rolls, folds against walls, kerbs, posts and other cars.
//     The points drive the person's own skeleton, so it is the same figure, same clothes, that goes flying.
//   - both kinds of people: the game's own pedestrians (their skinned figure is used as it stands) and the street crowd (the struck
//     agent is taken out of the crowd and a skinned copy of the same character, in the same colours, takes its place).
//   - the hit itself: a thud made of three layers, a hit-stop of a few frames, a camera kick, the car loses a little speed and dips.
//   - around it: people within 15 m shout and run from the spot.
//   - scaled by speed: under 12 km/h a shove that sits the person down; at 60 km/h up over the bonnet and through the air.
// No gore. Bodies come to rest and stay about 25 s. At most MAX ragdolls at once (the oldest goes).
// WALLS (gameplay/people, Nov 13, Matt on the 16:16 build: "They flew into a building and literally just went through the wall. They just
// disappeared inside the building."). Before: a body point was only pushed out of a wall it overlapped at the END of a step, to the nearer side
// of a line with no thickness, and only below 3.2 m. A fast point (0.16 m a step at 70 km/h, its radius 5-14 cm) or one dragged by the rest of
// the body or shoved by the car got across in one step and was then pushed out on the FAR side; anything thrown higher than 3.2 m met no wall at
// all. Measured in node on 300 hits in front of walls (10-160 km/h): 268 bodies passed a wall, 201 ended inside a building. Now every point's whole move
// (from where it stood after the last step to where the step, the sticks, the cars and the posts have put it) is swept against the walls: it
// stops at the first wall it meets, on the side it came from, and gives up speed there; a move that cannot be made safe is not made. Building
// walls and shop fronts hold at any height; low things (fences, tree guards: collision lines more than 1.5 m from any building) hold below
// LOWH, so a body can go over them. The step costs no more than before (node: 0.05-0.09 ms a body a drawn frame, before 0.08-0.13).
// CAR SHAPES (gameplay/people, Nov 14, Matt: "a struck person who lands on the car ... then sinks half into the car body, passing through it").
// Before: every car was one box for the body: full height over the middle 45 % of its length, 64 % of its height over the rest, pushed out through the
// nearest face, against the car as it stood at the drawn frame. So a body on an SUV's or a van's roof behind the middle lay up to 0.6-1 m inside it, a
// windscreen and a pickup's cab were open air, and at 15 frames a second the car jumped 2 m into the body between two frames. Now each car is its own side
// outline (src/carshape.js: bumper, bonnet, windscreen, roof, tail, per kind, read from the car models), the body's points are kept out of it in the CAR'S
// MOVING FRAME (the car's place is carried through the steps between two drawn frames; a point that has crossed the outline goes back to the panel it came
// through), and what touches a panel takes the panel's speed through friction: it rides, slides off when the car brakes or turns, and is never left behind in the air.
import * as THREE from 'three';
import { railSleeveVertices, armVertices, trunkVertices, stairChestVertices, stairThighVertices, lowerLegVertices, handVertices, stairHeadVertices } from './trunkVertices.js';
import { shapeOf, pushOut, topAt } from './carshape.js';
import { install as installBodyGlass } from './bodyglass.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MAX = 7, G = 9.81, SUB = 1 / 120, LOWH = 1.0, WREST = 0.2, WFRIC = 0.8, WKEEP = 0.004;
const CAR_MU = 0.45, CAR_REST = 0.05;      // CAR SHAPES: a body on painted steel and glass: friction, and next to no bounce
const PTS = ['hips', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hpL', 'hpR', 'knL', 'knR', 'ftL', 'ftR'];
const RAD = { hips: 0.13, chest: 0.14, head: 0.11, shL: 0.07, shR: 0.07, elL: 0.05, elR: 0.05, haL: 0.045, haR: 0.045, hpL: 0.09, hpR: 0.09, knL: 0.06, knR: 0.06, ftL: 0.055, ftR: 0.055 };
const MASS = { hips: 14, chest: 20, head: 5, shL: 3, shR: 3, elL: 2, elR: 2, haL: 1, haR: 1, hpL: 6, hpR: 6, knL: 4, knR: 4, ftL: 1.5, ftR: 1.5 };
const STICKS = [['hips', 'chest'], ['chest', 'head'], ['chest', 'shL'], ['chest', 'shR'], ['shL', 'shR'], ['hips', 'hpL'], ['hips', 'hpR'], ['hpL', 'hpR'], ['shL', 'hpL'], ['shR', 'hpR'], ['shL', 'hpR'], ['shR', 'hpL'], ['chest', 'hpL'], ['chest', 'hpR'],
  ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR'], ['hpL', 'knL'], ['knL', 'ftL'], ['hpR', 'knR'], ['knR', 'ftR'], ['head', 'shL'], ['head', 'shR']];
// pairs that may not come closer than this (so the body cannot fold through itself)
const APART = [['haL', 'chest', 0.16], ['haR', 'chest', 0.16], ['ftL', 'hips', 0.42], ['ftR', 'hips', 0.42], ['knL', 'knR', 0.13], ['ftL', 'ftR', 0.12], ['head', 'hips', 0.5], ['knL', 'chest', 0.3], ['knR', 'chest', 0.3], ['elL', 'hips', 0.2], ['elR', 'hips', 0.2], ['ftL', 'knR', 0.14], ['ftR', 'knL', 0.14]];
const BONE_OF = { hips: 'hips', chest: 'neck', head: 'head', shL: 'upper_arm_L', shR: 'upper_arm_R', elL: 'forearm_L', elR: 'forearm_R', haL: 'hand_L', haR: 'hand_R', hpL: 'thigh_L', hpR: 'thigh_R', knL: 'shin_L', knR: 'shin_R', ftL: 'foot_L', ftR: 'foot_R' };
const LIMBS = [['neck', 'chest', 'head'], ['upper_arm_L', 'shL', 'elL'], ['forearm_L', 'elL', 'haL'], ['upper_arm_R', 'shR', 'elR'], ['forearm_R', 'elR', 'haR'], ['thigh_L', 'hpL', 'knL'], ['shin_L', 'knL', 'ftL'], ['thigh_R', 'hpR', 'knR'], ['shin_R', 'knR', 'ftR']];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _o = {};

export function install(game, opts = {}) {
  if (game.__pedhit) return game.__pedhit; const world = game.world, scene = world.scene, S = (game.__pedhit = { list: [], pool: new Map(), hits: 0, hitstop: 0, on: true });
  if (game.P && game.P.get('pedhit') === '0') { S.on = false; return S; }

  try { S.glass = installBodyGlass(game); } catch (e) { S.glass = null; console.log('[pedhit] bodyglass: ' + (e && e.message)); }      // ragdoll lane, Nov 16: a body on a windscreen cracks it (sound and mark); ?bodyglass=0 off
  // ragdoll lane, Nov 17 (merge batch 6: bodies hang 1.3-1.6 m in the air in Central Park's hollows): the sim stays flat; the figure is DRAWN on the park's ground. ?parkbody=0 off
  const liftAt = (x, z) => { const T = game.terrain; return T && T.inBox(x, -z) && game.P?.get('parkbody') !== '0' ? T.h(x, -z) : 0; };
  const revised = game.P?.get('ragdoll2') !== '0';
  const settleArms = revised && game.P?.get('ragdollArmFit') === '1';
  const floor = (a) => revised && game.subway?.units?.size ? ragdollGround(game, a.p.x, a.p.z, a.p.y - a.r) : (game.statics.onSidewalk(a.p.x, -a.p.z) ? 0.15 : 0);

  // ---------------------------------------------------------------- the figure a struck person is shown as
  const bonesOf = (root) => { const B = {}; root.traverse((o) => { if (o.isBone) { const m = /_((?:hips|spine|chest2?|neck|head|(?:clavicle|upper_arm|forearm|hand|thigh|shin|foot|toe)_[LR]))$/.exec(o.name); if (m && !B[m[1]]) B[m[1]] = o; } }); return B; };
  function crowdFigure(a) {     // a skinned copy of the crowd character the agent wears, in the agent's colours
    const cr = game.crowd, cast = cr && cr.render && cr.render.cast, ch = cast && cast.chars[a.char]; if (!ch || !ch.root) return null;
    let pool = S.pool.get(a.char); if (!pool) S.pool.set(a.char, (pool = []));
    let f = pool.find((x) => !x.used);
    if (!f) { const root = cloneSkinned(ch.root); root.traverse((o) => { if (o.isSkinnedMesh) { o.material = o.material.clone(); o.geometry = o.geometry.clone(); o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; if (o.geometry.attributes.color) { o.userData.mask = o.geometry.attributes.color.clone(); o.material.vertexColors = true; } } });
      root.userData.brkOwn = true; scene.add(root); f = { root, mixer: new THREE.AnimationMixer(root), cast: ch }; pool.push(f); }
    f.used = true; f.root.visible = true;
    // the agent's three tints (top, bottom, hair), through the character's mask, into the copy's vertex colours
    const lin = (x) => Math.pow(x / 255, 2.2), tint = (a.tint || []).map((t) => (t === undefined || t === 0xffffff ? null : [lin((t >> 16) & 255), lin((t >> 8) & 255), lin(t & 255)]));
    f.root.traverse((o) => { if (!o.isSkinnedMesh || !o.userData.mask) return; const mk = o.userData.mask, col = o.geometry.attributes.color, n = col.count;
      for (let i = 0; i < n; i++) { let r = 1, g = 1, b = 1; for (let k = 0; k < 3; k++) { const w = mk.getComponent(i, k), t = tint[k]; if (t && w > 0) { r *= 1 + (t[0] - 1) * w; g *= 1 + (t[1] - 1) * w; b *= 1 + (t[2] - 1) * w; } } col.setXYZ(i, r, g, b); } col.needsUpdate = true; });
    // stand it where the agent is, in the agent's stride
    f.root.position.set(a.x, a.z || 0, -a.y); f.root.rotation.set(0, a.h, 0); f.root.scale.setScalar(a.scale || 1);
    try { const names = cr.sim.clipNames || [], nm = names[a.clip], clip = cast.animations.find((c) => c.name === nm) || cast.animations.find((c) => /walk/i.test(c.name)); if (clip) { f.mixer.stopAllAction(); let tr = clip.tracks.filter((t) => t.name.startsWith(ch.name + '_')); if (!tr.length) tr = clip.tracks; const act = f.mixer.clipAction(new THREE.AnimationClip(clip.name + '_' + ch.name, clip.duration, tr)); act.play(); f.mixer.setTime((a.ph || 0) * clip.duration); } } catch (e) {}
    f.root.updateMatrixWorld(true); return f;
  }

  // one figure of every crowd character is made ahead of the first hit (its shader then compiles in the background, not on the hit)
  S.warm = () => { const out = []; try { const cast = game.crowd && game.crowd.render && game.crowd.render.cast; if (cast) cast.chars.forEach((ch, i) => { const f = crowdFigure({ char: i, x: 0, y: 0, z: -50, h: 0, scale: 1, tint: [] }); if (f) { f.used = false; f.root.visible = false; f.root.traverse((o) => { if (o.isSkinnedMesh) out.push(o); }); } }); } catch (e) {} return out; };
  // ... and compiled in the background a few seconds after the game is up (the browser's parallel compiler), unless the host does it itself
  if (!opts.noWarm && !game.capture) setTimeout(async () => { try { const fig = S.warm(); if (!fig.length) return; const sc = new THREE.Scene(); sc.fog = scene.fog; for (const o of fig) { const q = Object.create(o); q.visible = true; q.children = []; q.parent = sc; sc.children.push(q); }
    const r = world.renderer; if (r.compileAsync) await r.compileAsync(sc, world.camera, scene); else r.compile(sc, world.camera, scene); S.warmed = fig.length; } catch (e) { S.warmed = 'failed: ' + (e && e.message); } }, opts.warmDelay || 5000);
  // ---------------------------------------------------------------- a hit
  function start(p, v) {
    const sp = Math.hypot(v.vx, v.vy); let fig = null, root = null;
    if (p.vis && p.vis.object) { root = p.vis.object; fig = { ped: p }; }
    else { const f = crowdFigure(p); if (!f) return null; root = f.root; fig = { crowd: f }; try { game.crowd.sim.remove(p); } catch (e) { p.scale = 0; } }
    root.updateMatrixWorld(true); const B = bonesOf(root); if (!B.hips || !B.head || !B.thigh_L) { if (fig.crowd) { fig.crowd.used = false; root.visible = false; } return null; }
    const R = { fig, root, B, P: {}, sticks: [], t: 0, rest: 0, frozen: false, sp }, cv = new THREE.Vector3(v.vx, 0, -v.vy), fwd = cv.clone().normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const side = Math.sign((p.x - v.x) * -Math.sin(v.h) + (p.y - v.y) * Math.cos(v.h)) || 1, lift = Math.min(6.2, Math.max(0, (sp - 3.2) * 0.26)), sh = THREE.MathUtils.clamp(sp / 6, 0.35, 1);
    const up0 = fig.ped && game.terrain && game.P?.get('parkbody') !== '0' ? +(root.userData.__ph || 0) : 0;      /* a pedestrian's figure is drawn lifted by the park's hook: its joints enter the sim at street level */
    for (const k of PTS) { const bn = B[BONE_OF[k]]; const w = bn ? bn.getWorldPosition(new THREE.Vector3()) : B.hips.getWorldPosition(new THREE.Vector3()); w.y -= up0;
      if (k === 'head' && B.neck) { const nk = B.neck.getWorldPosition(_v); w.add(_a.copy(w).sub(nk).setLength(0.11)); }
      // the bumper takes the legs first: low points get the car's full speed, the head lags, so the body wraps onto the bonnet
      const hgt = THREE.MathUtils.clamp(w.y / 1.7, 0, 1), k1 = (1.12 - 0.42 * hgt) * (0.9 + 0.2 * Math.random());
      const vel = cv.clone().multiplyScalar(k1 * sh).addScaledVector(right, side * (0.5 + 1.2 * Math.random()) * Math.min(1, sp / 8)); vel.y = lift * (0.75 + 0.5 * hgt) + 0.6 * Math.random();
      // A real moving panel supplies the impulse at contact. Synthetic hits supply their own velocity.
      if (revised && !v.bullet && game.vehicles.includes(v)) vel.set(p.beforeHit?.x || 0, p.beforeHit?.up || 0, -(p.beforeHit?.y || 0));      /* up: a rider knocked off his bike (riders.js) */
      if (revised && v.impact) {
        const hit = v.impact, distance = w.distanceToSquared(hit);
        const kick = Math.min(5, 1.8 * hit.force) * Math.exp(-distance / 0.12);
        vel.set(hit.dx * kick, hit.dy * kick, hit.dz * kick);
      }
      R.P[k] = { p: w.clone(), q: w.clone().addScaledVector(vel, -SUB), r: RAD[k], im: 1 / MASS[k], k }; }
    try { startSafe(R.P, p.x, p.y); } catch (e) {}
    for (const [a, b] of STICKS) R.sticks.push([R.P[a], R.P[b], R.P[a].p.distanceTo(R.P[b].p)]);
    if (revised) {
      const toe = B.toe_L || B.toe_R, foot = B.toe_L ? B.foot_L : B.foot_R;
      if (toe && foot) {
        const forward = toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(_v));
        torso(R, _m);
        R.fsg = Math.sign(forward.dot(_c.setFromMatrixColumn(_m, 2)));
      }
      for (const side of ['L', 'R']) {
        const a = R.P['sh' + side], b = R.P['el' + side], c = R.P['ha' + side];
        const upper = a.p.distanceTo(b.p), lower = b.p.distanceTo(c.p);
        const min = Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(150 * Math.PI / 180));
        (R.elbows ||= []).push([a, c, Math.min(min, a.p.distanceTo(c.p))]);
      }
    }
    R.apart = APART.map(([a, b, d]) => [R.P[a], R.P[b], Math.min(d, R.P[a].p.distanceTo(R.P[b].p) * 0.9)]);
    if (revised) R.apart.push(...R.elbows);
    // the pose at the moment of the hit: the torso's frame, each limb's direction and its bone's attitude
    R.M0i = torso(R, new THREE.Matrix4()).invert(); R.q0 = {}; for (const n in B) R.q0[n] = B[n].getWorldQuaternion(new THREE.Quaternion());
    R.d0 = {}; for (const [bone, a, b] of LIMBS) R.d0[bone] = R.P[b].p.clone().sub(R.P[a].p).normalize();
    if (revised) {
      R.trunkPoints = captureOutline(R, B.hips, trunkVertices, /_(hips|spine|chest2?)$/);
      R.footPose = {L:B.foot_L?.quaternion.clone(), R:B.foot_R?.quaternion.clone()};
      R.footApplied = {L:R.footPose.L?.clone(), R:R.footPose.R?.clone()};
    }
    R.h0 = B.hips.getWorldPosition(new THREE.Vector3()).sub(R.P.hips.p); R.h0.y -= up0;
    if (fig.ped && fig.ped.vis.mixer) fig.ped.vis.mixer.timeScale = 0;
    S.list.push(R); while (S.list.length > MAX) release(S.list.shift());
    return R;
  }
  function torso(R, m) {       // the body's frame from hips, chest and the two hip joints
    const P = R.P, x = _a.copy(P.hpR.p).sub(P.hpL.p), y = _b.copy(P.chest.p).sub(P.hips.p).normalize(); x.addScaledVector(y, -x.dot(y)); if (x.lengthSq() < 1e-8) x.set(1, 0, 0); x.normalize(); const z = _c.crossVectors(x, y);
    return m.makeBasis(x, y, z);
  }
  function restoreFeet(R) {
    if (!R.footPose) return;
    for (const side of ['L','R']) {
      const foot = R.B['foot_'+side];
      // Another animation may already own the bone at hand-back.
      if (foot && R.footApplied[side]?.equals(foot.quaternion)) foot.quaternion.copy(R.footPose[side]);
    }
  }
  function release(R) {
    restoreFeet(R);
    if (R.fig.crowd) { R.fig.crowd.used = false; R.root.visible = false; }
    else if (R.fig.ped) { const p = R.fig.ped; p.t = 99; if (p.vis.mixer) p.vis.mixer.timeScale = 1; }      // the game's own clean-up takes the figure back
  }

  // ---------------------------------------------------------------- walls: the game's collision lines, swept
  const st = game.statics, city = world.city || game.city || {}, bedge = new Map(), tallOf = new Map(), cand = [], _h = { t: 1, s: null };
  try { for (const b of city.buildings || []) { if (b.minh >= 2.5) continue; for (const P of [b.poly, ...(b.holes || [])]) for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], s = [p[0], p[1], q[0], q[1]];
    for (let ci = Math.floor(Math.min(p[0], q[0]) / 16); ci <= Math.floor(Math.max(p[0], q[0]) / 16); ci++) for (let cj = Math.floor(Math.min(p[1], q[1]) / 16); cj <= Math.floor(Math.max(p[1], q[1]) / 16); cj++) { const k = ci * 100003 + cj; let a = bedge.get(k); if (!a) bedge.set(k, (a = [])); a.push(s); } } } } catch (e) {}
  const segDist = (x, y, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy || 1e-9))); return Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t); };
  // is this collision line a building wall or a shop front (it lies on or within 1.5 m of a building's outline), or something low in the street?
  function tall(s) { let v = tallOf.get(s); if (v !== undefined) return v; v = false; const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; if (Math.hypot(s[2] - s[0], s[3] - s[1]) > 200) v = true;
    for (let ci = Math.floor((mx - 1.5) / 16); ci <= Math.floor((mx + 1.5) / 16) && !v; ci++) for (let cj = Math.floor((my - 1.5) / 16); cj <= Math.floor((my + 1.5) / 16) && !v; cj++) { const a = bedge.get(ci * 100003 + cj); if (a) for (const e of a) if (segDist(mx, my, e) < 1.5 && (segDist(s[0], s[1], e) < 1.5 || segDist(s[2], s[3], e) < 1.5)) { v = true; break; } }
    tallOf.set(s, v); return v; }
  // the lines a move from (ax, ay) to (bx, by) of a point of radius r at height y could meet
  function near(ax, ay, bx, by, r, y) { cand.length = 0; if (!st || !st.segs) return 0; const c = st.cell || 16, m = r + 0.05, x0 = Math.min(ax, bx) - m, x1 = Math.max(ax, bx) + m, y0 = Math.min(ay, by) - m, y1 = Math.max(ay, by) + m;
    for (let ci = Math.floor(x0 / c); ci <= Math.floor(x1 / c); ci++) for (let cj = Math.floor(y0 / c); cj <= Math.floor(y1 / c); cj++) { const a = st.segs.get(st.key(ci, cj)); if (a) for (const s of a) {
      if ((s[0] < x0 && s[2] < x0) || (s[0] > x1 && s[2] > x1) || (s[1] < y0 && s[3] < y0) || (s[1] > y1 && s[3] > y1)) continue; if (revised && s.set === 'subway' && Number.isFinite(game.subway?.meta?.zWalk)) {
        // The entrance kit's highest horizontal bar extends 1.125 m above pavement.
        if (y - r > game.subway.meta.zWalk + 1.125) continue;
      } else if (y >= LOWH && !tall(s)) continue; cand.push(s); } }
    return cand.length; }
  // the first of those lines the move crosses: _h.t in [0, 1), _h.s the line; false if none
  function first(ax, ay, bx, by) { const rx = bx - ax, ry = by - ay; let best = 2, bs = null;
    for (const s of cand) { const sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-14) continue; const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den; if (t >= 0 && t <= 1 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) { best = t; bs = s; } }
    _h.t = best; _h.s = bs; return bs !== null; }
  // one point's move this step, from where it stood (a.q) to where it has been put (a.p), made safe against the walls. Map metres: (x, -z).
  function walls(a, airborne) {
    // (a.sx, a.sz) is where the point stood after the last step. a.q is NOT that any more: the cars and posts above have already written
    // the speed they give the point into it (a point riding a van's roof into a wall got through on that: 9 of 60 at one spot in the node run)
    const qx = a.sx, qy = -a.sz; let px = a.p.x, py = -a.p.z; if (!near(qx, qy, px, py, a.r, a.p.y)) return;
    // A descending joint that reaches the upper face first can slide over
    // the bar. Applying the side plane here traps a trailing foot outside.
    if (airborne && a.p.y <= a.sy) {
      const top = game.subway.meta.zWalk + 1.125;
      if (a.sy >= top && a.p.y < top + a.r) {
        for (let i = cand.length-1; i >= 0; i--) {
          const s = cand[i];
          if (s.set !== 'subway') continue;
          const gap = Math.max(0, segDist(px, py, s)-.025);
          if (gap >= a.r) continue;
          const height = top + Math.sqrt(a.r*a.r-gap*gap);
          const oldGap = Math.max(0, segDist(qx, qy, s)-.025);
          const oldHeight = top + Math.sqrt(Math.max(0,a.r*a.r-oldGap*oldGap));
          if (a.sy < oldHeight-.001) continue;
          if (a.p.y < height) {
            a.p.y = height;
            a.q.y = height;
          }
          cand.splice(i,1);
        }
        if (!cand.length) return;
      }
    }
    let wx = px - a.q.x, wy = py + a.q.z, touched = false;       // the point's speed (metres a step) as it will leave this step
    if (first(qx, qy, px, py)) { const s = _h.s, L = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1e-9; let nx = -(s[3] - s[1]) / L, ny = (s[2] - s[0]) / L; if ((qx - s[0]) * nx + (qy - s[1]) * ny < 0) { nx = -nx; ny = -ny; }
      px = qx + (px - qx) * _h.t + nx * a.r; py = qy + (py - qy) * _h.t + ny * a.r; const vn = Math.min(0, wx * nx + wy * ny), tx = wx - (wx * nx + wy * ny) * nx, ty = wy - (wx * nx + wy * ny) * ny; wx = tx * WFRIC - vn * WREST * nx; wy = ty * WFRIC - vn * WREST * ny; touched = true; }
    for (let it = 0; it < 2; it++) for (const s of cand) { const dx = s[2] - s[0], dy = s[3] - s[1], t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / (dx * dx + dy * dy || 1e-9))); let ex = px - s[0] - dx * t, ey = py - s[1] - dy * t; const d = Math.hypot(ex, ey);
      if (d < a.r && d > 1e-7) { ex /= d; ey /= d; px += ex * (a.r - d); py += ey * (a.r - d); const vn = wx * ex + wy * ey; if (vn < 0) { wx -= vn * (1 + WREST * 0.5) * ex; wy -= vn * (1 + WREST * 0.5) * ey; } wx *= 0.985; wy *= 0.985; touched = true; } }
    if (!touched) return;
    // the place it has been given must itself be reachable from where it stood, and not on a wall: else it stays where it stood
    near(qx, qy, px, py, a.r, a.p.y); let bad = first(qx, qy, px, py); if (!bad) for (const s of cand) if (segDist(px, py, s) < WKEEP && (a.p.y >= LOWH || tall(s))) { bad = true; break; }
    if (bad) { px = qx; py = qy; wx = 0; wy = 0; }
    a.p.x = px; a.p.z = -py; a.q.x = px - wx; a.q.z = -(py - wy);
  }
  // posts, trees, hydrants, chairs: the map's round things, below the height of a storey (as before, without the lines)
  // ... and the same for the MIDDLE of a limb or of the trunk (ragdoll lane, Nov 16; a critic, merge batch 5: a body at rest "through the blue mailbox"): the points
  // at a limb's two ends could come to rest either side of a post or a mailbox with the limb drawn through it. Both ends give way together.
  const SEGS = [['hips', 'chest'], ['chest', 'head'], ['hpL', 'knL'], ['knL', 'ftL'], ['hpR', 'knR'], ['knR', 'ftR'], ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR']];
  function postsMid(P) { if (!st || !st.circ) return; const c = st.cell || 16;
    for (const [ka, kb] of SEGS) { const a = P[ka], b = P[kb]; if ((a.p.y + b.p.y) / 2 > 3.2) continue; const x = (a.p.x + b.p.x) / 2, z = (a.p.z + b.p.z) / 2, y = -z, r = (a.r + b.r) / 2;
      for (let ci = Math.floor((x - r) / c); ci <= Math.floor((x + r) / c); ci++) for (let cj = Math.floor((y - r) / c); cj <= Math.floor((y + r) / c); cj++) { const L = st.circ.get(st.key(ci, cj)); if (L) for (const o of L) { if (!o.on) continue; const ex = y - o.y, dx = x - o.x, d = Math.hypot(dx, ex), R = r + o.r;
        if (d < R && d > 1e-6) { const k = (R - d) / d, mx = dx * k, mz = -ex * k; for (const q of [a, b]) { q.p.x += mx; q.p.z += mz; q.q.x += mx * 0.7; q.q.z += mz * 0.7; } } } } } }
  function posts(a) { if (!st || !st.circ) return; const c = st.cell || 16, x = a.p.x, y = -a.p.z, r = a.r;
    for (let ci = Math.floor((x - r) / c); ci <= Math.floor((x + r) / c); ci++) for (let cj = Math.floor((y - r) / c); cj <= Math.floor((y + r) / c); cj++) { const L = st.circ.get(st.key(ci, cj)); if (L) for (const o of L) { if (!o.on) continue; const ex = -a.p.z - o.y, dx = a.p.x - o.x, d = Math.hypot(dx, ex), R = r + o.r;
      if (d < R && d > 1e-6) { const k = (R - d) / d, mx = dx * k, mz = -ex * k; a.p.x += mx; a.p.z += mz; a.q.x += mx * 0.7; a.q.z += mz * 0.7; } } } }
  // a person standing at a wall may have a hand or an elbow across its line at the moment of the hit: every point starts on the person's side
  function startSafe(P, ax, ay) { for (const k of PTS) { const a = P[k], bx = a.p.x, by = -a.p.z; if (!near(ax, ay, bx, by, a.r, a.p.y) || !first(ax, ay, bx, by)) continue; const t = Math.max(0, _h.t - 0.06 / (Math.hypot(bx - ax, by - ay) || 1e-9)), nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t, mx = nx - bx, my = ny - by;
      a.p.x = nx; a.p.z = -ny; a.q.x += mx; a.q.z -= my; } }

  // ---------------------------------------------------------------- the simulation
  // ---- CAR SHAPES block 1 of 3: the cars near a body, each with its outline and its place a step ago and now
  const boxes = [], poseOf = new WeakMap(), _po = { f: 0, y: 0, nf: 0, ny: 0 }; let stamp = 0;
  // A rescue places the car instantly. Start its next collision sweep at the destination.
  if (revised) S.vehicleRepositioned = e => {
    poseOf.set(e, {x:e.x, z:-e.y, h:e.h, n:stamp, placedAt:stamp});
  };
  // Rescue searches are rare. Test each active joint against the proposed car footprint.
  if (revised) S.blocksVehiclePlacement = (v,x,y,h,margin) => {
    const shape=shapeOf(v.def), c=Math.cos(h), s=Math.sin(h);
    return S.list.some(rig=>PTS.some(k=>{
      const {p,r}=rig.P[k];
      if(p.y+r<0 || p.y-r>shape.top) return false;
      const dx=p.x-x, dy=-p.z-y, f=dx*c+dy*s, side=-dx*s+dy*c;
      const gapF=Math.max(shape.xb-f,0,f-shape.xf), gapS=Math.max(0,Math.abs(side)-shape.W);
      return gapF*gapF+gapS*gapS <= (r+margin)**2;
    }));
  };
  function carBoxes(c, span) {
    boxes.length = 0; const add = (e, vx, vy, still) => { if (Math.abs(e.x - c.x) > 14 || Math.abs(e.y + c.z) > 14) return; const pp = still ? null : poseOf.get(e), ok = pp && pp.n === stamp;
      // where the car stood when the body was last stepped (kept below), or, the first time, where its speed says it came from
      boxes.push({ e, S: shapeOf(e.def), x1: e.x, z1: -e.y, h1: e.h, x0: still ? e.x : ok ? pp.x : e.x - vx * span, z0: still ? -e.y : ok ? pp.z : -e.y + vy * span, h0: still || !ok ? e.h : pp.h, ax: 0, az: 0, ach: 1, ash: 0, bx: 0, bz: 0, bch: 1, bsh: 0 }); };
    for (const e of game.vehicles) add(e, e.vx, e.vy, false);
    if (game.traffic) for (const e of game.traffic.cars) add(e, Math.cos(e.h) * (e.v || 0), Math.sin(e.h) * (e.v || 0), false);
    if (game.parked && game.parked.near) for (const e of game.parked.near(c.x, -c.z, 12, [])) add(e, 0, 0, true);
  }
  // the cars' places for step k of n between two drawn frames
  function carsAt(k, n) { for (const c of boxes) { let dh = c.h1 - c.h0; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI; const u0 = k / n, u1 = (k + 1) / n, ha = c.h0 + dh * u0, hb = c.h0 + dh * u1;
    c.ax = c.x0 + (c.x1 - c.x0) * u0; c.az = c.z0 + (c.z1 - c.z0) * u0; c.ach = Math.cos(ha); c.ash = Math.sin(ha); c.bx = c.x0 + (c.x1 - c.x0) * u1; c.bz = c.z0 + (c.z1 - c.z0) * u1; c.bch = Math.cos(hb); c.bsh = Math.sin(hb); } }
  function keepPoses() { stamp++; const put = (e) => { let pp = poseOf.get(e); if (!pp) poseOf.set(e, (pp = { x: 0, z: 0, h: 0, n: 0 })); pp.x = e.x; pp.z = -e.y; pp.h = e.h; pp.n = stamp; }; for (const e of game.vehicles) put(e); if (game.traffic) for (const e of game.traffic.cars) put(e); }
  // ---- end of CAR SHAPES block 1
  // Resolve the sphere against the top corner of a 15 cm kerb even
  // while its centre is still on the road. Sample bounded radial offsets
  // and use the corresponding height of the sphere at each offset.
  const diagonal = Math.SQRT1_2;
  const kerbAxes = [[1,0],[-1,0],[0,1],[0,-1],
    [diagonal,diagonal],[-diagonal,diagonal],[diagonal,-diagonal],[-diagonal,-diagonal]];
  let roadX = 0, roadZ = 0, clearRoad = false;
  const roadRadius = 2;
  const tread = {};
  function groundContactHeight(a, settling) {
    if (clearRoad && Math.abs(a.p.x - roadX) + a.r < roadRadius &&
        Math.abs(a.p.z - roadZ) + a.r < roadRadius) return a.r;
    let surface;
    if (revised && game.subway?.units?.size) {
      surface = ragdollGround(game, a.p.x, a.p.z, a.p.y - a.r, tread);
      const f = tread.stair;
      if (f) {
        // At an open well, the raised sidewalk can also meet a joint from
        // the side. Query just outside the stair so adjoining floors stay open.
        const across = -(a.p.x-f.x)*f.sa + (-a.p.z-f.y)*f.ca;
        const sideGap = f.w/2 - Math.abs(across);
        if (tread.open && sideGap < a.r) {
          const sign = Math.sign(across) || 1;
          const nx = sign*f.sa, nz = sign*f.ca;
          const outside = ragdollGround(game, a.p.x-nx*(sideGap+0.001),
            a.p.z-nz*(sideGap+0.001), a.p.y-a.r);
          if (outside > surface && a.p.y < outside && a.sy < outside) {
            const shift = a.r-sideGap;
            const inward = Math.min(0,(a.p.x-a.q.x)*nx+(a.p.z-a.q.z)*nz);
            a.p.x += shift*nx; a.p.z += shift*nz;
            a.q.x += (shift+inward)*nx; a.q.z += (shift+inward)*nz;
          }
        }
        const count = f.n || Math.round(Math.abs(f.z1-f.z0) / tread.rise);
        const run = f.l / count;
        const edge = Math.min(count-1, Math.floor(tread.down / run)) * run;
        const gap = Math.max(0, tread.down - edge);
        if (gap < a.r) {
          const upper = surface + tread.rise;
          const direction = f.z0 > f.z1 ? 1 : -1;
          if (a.p.y < upper && a.sy < upper) {
            // Below the lip the riser stops uphill motion. Correct previous
            // position as well, so the projection adds no downhill kick.
            const dx = direction * f.ca, dz = -direction * f.sa;
            const shift = a.r - gap;
            const inward = Math.min(0, (a.p.x-a.q.x)*dx + (a.p.z-a.q.z)*dz);
            a.p.x += shift*dx; a.p.z += shift*dz;
            a.q.x += (shift+inward)*dx; a.q.z += (shift+inward)*dz;
          } else {
            return Math.max(surface+a.r, upper+Math.sqrt(a.r*a.r-gap*gap));
          }
        }
        return surface + a.r;
      }
    } else surface = floor(a);
    const centre = surface + a.r;
    if (!revised || centre !== a.r || a.p.y > 0.15 + a.r) return centre;
    let nearest = a.r, normalX = 0, normalZ = 0;
    for (const [dx,dz] of kerbAxes) {
      if (!game.statics.onSidewalk(a.p.x + dx*nearest, -a.p.z - dz*nearest)) continue;
      const sidewalk = d => ragdollGround(game, a.p.x + dx*d, a.p.z + dz*d, a.p.y - a.r) === 0.15;
      if (!sidewalk(nearest)) continue;
      let lo = 0, hi = nearest;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (sidewalk(mid)) hi = mid;
        else lo = mid;
      }
      if (hi < nearest) {
        nearest = hi;
        normalX = dx;
        normalZ = dz;
      }
    }
    if (nearest < a.r) {
      // A joint below the lip meets the vertical kerb face. Lifting it
      // onto the pavement here repeatedly kicks a resting elbow upward.
      if (settling && a.sy < 0.15 && a.p.y < 0.15) {
        const depth = a.r - nearest;
        a.p.x -= depth * normalX;
        a.p.z -= depth * normalZ;
        const inward = (a.p.x - a.q.x)*normalX + (a.p.z - a.q.z)*normalZ;
        if (inward > 0) {
          a.q.x += inward * normalX;
          a.q.z += inward * normalZ;
        }
        return centre;
      }
      return Math.max(centre, 0.15 + Math.sqrt(a.r*a.r - nearest*nearest));
    }
    return centre;
  }
  // RUN OVER (ragdoll lane, Nov 17): a body lying in the road was a wall to a car: the bumper stopped on it or shouldered it aside, and a car never went over anyone. Now
  // a body that lies flat (every joint under knee height) and near the middle of a car coming at it faster than a walk goes UNDER it: the car passes over, the body is
  // dragged a little and rolled, and each axle of the player's own car that crosses it gives the car a bump (the nose or tail kicks up, the camera knocks, a dull double
  // thump). Off the middle of the car, or a body still up, it is pushed or shouldered as before. ?runover=0 = as before.
  const RUNOVER = revised && game.P?.get('runover') !== '0';
  function runOverStart(R, c) { const P = R.P, e = c.e, sp = Math.hypot(c.x1 - c.x0, c.z1 - c.z0); if (sp < 0.03) return false;      /* (per drawn frame: about 2 m/s at 60 frames a second) */
    let top = -9; for (const k of PTS) { const a = P[k]; top = Math.max(top, a.p.y + a.r - floor(a)); } if (top > 0.5) return false;
    const hp = P.hips.p, dx = hp.x - c.bx, dz = hp.z - c.bz, sd = dx * c.bsh + dz * c.bch; if (Math.abs(sd) > c.S.W - 0.25) return false;
    R.under = e; R.underT = 0; R.underAx = [false, false]; R.pushT = 0; S.runovers = (S.runovers || 0) + 1; return true; }
  function runOverStep(R, h) { const e = R.under, P = R.P, c = boxes.find((b) => b.e === e); R.underT += h; if (!c || R.underT > 4) { R.under = null; return; }
    const hp = P.hips.p, dx = hp.x - c.bx, dz = hp.z - c.bz, f = dx * c.bch - dz * c.bsh, sd = dx * c.bsh + dz * c.bch, S2 = c.S;
    if (f < S2.xb - 0.4 || f > S2.xf + 1.3 || Math.abs(sd) > S2.W + 0.3) { R.under = null; return; }      /* (1.3 m ahead of the nose: a hand or foot meets the bumper while the hips are still that far off; at 0.6 the body went under and out again up to six times) */      // the car has gone over (or backed off, or turned away)
    // the car's floor is 20 cm up: nothing of the body stands higher while it is under; the car drags it a little by its underside
    const mvx = (c.bx - c.ax) * 0.12, mvz = (c.bz - c.az) * 0.12; for (const k of PTS) { const a = P[k], lim = floor(a) + 0.2 - a.r; if (a.p.y > lim) { a.p.y = Math.max(floor(a) + a.r, lim); a.q.y = a.p.y; } a.p.x += mvx; a.p.z += mvz; a.q.x += mvx; a.q.z += mvz; }
    // the axles: a wheel's width either side of the middle is where the tyres run; a bump for each axle that crosses the hips or the chest
    const wb = (e.def && e.def.wheelbase) || S2.xf * 1.15, ax = [wb / 2, -wb / 2]; for (let i = 0; i < 2; i++) { if (R.underAx[i]) continue; if (f < ax[i] + 0.05) { R.underAx[i] = true;      /* (the body starts ahead of the nose and the car's frame slides forward over it: f falls) */ if (e === game.player.vehicle) bump(e, i === 0 ? 1 : -1, Math.hypot(e.vx || 0, e.vy || 0)); for (const k of ['hips', 'chest', 'hpL', 'hpR']) { P[k].q.x += (Math.random() - 0.5) * 0.02; P[k].q.z += (Math.random() - 0.5) * 0.02; } } } }
  function bump(v, end, sp) { const k = Math.min(1, 0.35 + sp / 14); v.pitch = (v.pitch || 0) + end * 0.05 * k; if (typeof v.z === 'number') v.z += 0.05 * k; game.cam.shake = Math.min(0.5, (game.cam.shake || 0) + 0.09 * k); S.bumps = (S.bumps || 0) + 1;
    const s = game.sound; if (!s || !s.on || !s.ac) return; const a = s.ac, t = a.currentTime, o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16); g.gain.setValueAtTime(0.55 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(s.out); o.start(t); o.stop(t + 0.22);
    if (s.white) { const n = a.createBufferSource(), fl = a.createBiquadFilter(), g2 = a.createGain(); n.buffer = s.white; fl.type = 'lowpass'; fl.frequency.value = 520; g2.gain.setValueAtTime(0.4 * k, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09); n.connect(fl); fl.connect(g2); g2.connect(s.out); n.start(t, Math.random()); n.stop(t + 0.11); } }
  if (RUNOVER) S.bump = bump;      /* the same bump for a car that crosses a body the guns left (combat/people.js) */
  function step(R, h) {
    const P = R.P; let vmax = 0;
    if (R.under) runOverStep(R, h);
    R.support = null;
    // A standing figure leans against the side plane. A falling figure can
    // reach the top face once both feet are above the entrance plinth.
    const airborne = revised && game.subway?.entrances &&
      Math.min(P.ftL.p.y-P.ftL.r, P.ftR.p.y-P.ftR.r) > game.subway.meta.zWalk+.14;
    const damping = revised && R.settling ? 0.82 : 0.999;
    for (const k of PTS) { const a = P[k], vx = (a.p.x - a.q.x), vy = (a.p.y - a.q.y), vz = (a.p.z - a.q.z); a.q.copy(a.p); a.sx = a.p.x; a.sz = a.p.z; a.sy = a.p.y; a.p.x += vx * damping; a.p.y += vy * damping - G * h * h; a.p.z += vz * damping; }
    for (let it = 0; it < 7; it++) {
      for (const [a, b, L] of R.sticks) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6, e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
      for (const [a, b, L] of R.apart) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6; if (d >= L) continue; const e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
      if (R.fsg && !R.settling && (it & 1)) joints(R);
    }
    if (revised) postsMid(P);      // before the walls are swept below, so nothing it moves ends beyond a wall
    for (const k of PTS) { const a = P[k];
      let priorPanel = false, px = 0, py = 0, pz = 0;
      // ---- CAR SHAPES block 2 of 3: our own car and the others, each as its outline, in the car's moving frame (see CAR SHAPES at the top)
      for (const c of boxes) { if (R.under === c.e) continue;      /* RUN OVER: the car is passing over this body (see below) */ const S2 = c.S, r = a.r, dx = a.p.x - c.bx, dz = a.p.z - c.bz, f = dx * c.bch - dz * c.bsh, s = dx * c.bsh + dz * c.bch, W = S2.W;
        if (Math.abs(s) >= W + r || f > S2.xf + r || f < S2.xb - r || a.p.y > S2.top + r) continue;
        const ex = a.sx - c.ax, ez = a.sz - c.az, f0 = ex * c.ach - ez * c.ash, s0 = ex * c.ash + ez * c.ach, dp = pushOut(S2, f, a.p.y, r, f0, a.sy, _po); if (!dp) continue;
        let F = _po.f, Sd = s, Y = _po.y, nf = _po.nf, ns = 0, ny = _po.ny; const ps = W + r - Math.abs(s);
        // out through the side if that is where it came from, or if it was inside a moment ago too and the side is nearer
        if (Math.abs(s0) >= W + r - 0.002 || (ps < dp && (() => { const t0 = topAt(S2, f0); return t0 >= 0 && a.sy < t0; })())) { const sg = Math.sign(s) || 1; F = f; Y = a.p.y; Sd = sg * (W + r); nf = 0; ny = 0; ns = sg; }
        const beforeX = a.p.x, beforeY = a.p.y, beforeZ = a.p.z;
        const X = c.bx + F * c.bch + Sd * c.bsh, Z = c.bz - F * c.bsh + Sd * c.bch, nX = nf * c.bch + ns * c.bsh, nZ = -nf * c.bsh + ns * c.bch;
        // the panel's own move in this step at that place, and the point's move against it: nothing into the panel, friction along it
        const pcx = X - (c.ax + F * c.ach + Sd * c.ash), pcz = Z - (c.az - F * c.ash + Sd * c.ach); let wx = a.p.x - a.q.x - pcx, wy = a.p.y - a.q.y, wz = a.p.z - a.q.z - pcz;      /* (its speed as it came, not counting the push back out of the panel) */ const wn = wx * nX + wy * ny + wz * nZ;
        if (RUNOVER && nf > 0.7 && ns === 0 && !R.under && runOverStart(R, c)) break;
        if (revised && ns === 0 && (nf > 0.7 || ny > 0.45)) { R.pushN = (R.pushN || 0) + 1; if (nf > 0.7) R.pushF = 1; if (k === 'hips' || k === 'chest' || !R.pushC) R.pushS = s; R.pushC = c; }      // on a car's front face (see BULLDOZE below)
        if (wn < 0 && ns === 0 && S.glass && S.glass.on && -wn > 2.6 * h) { try { if (!S.glass.strike(c.e, S2, F, Y, Sd, nf, ny, -wn / h, k) && ny > 0.5 && R.t > 0.15 && S.glass.panel) S.glass.panel(c.e, -wn / h, k);      /* (not in the first moment: the hit's own thud is sounding then) */ } catch (e) {} }      /* glass: the crack; steel from above (bonnet, roof, boot): a knock */
        if (wn < 0) { const j = -wn * (1 + CAR_REST); wx += nX * j; wy += ny * j; wz += nZ * j; const d = wx * nX + wy * ny + wz * nZ, tx = wx - d * nX, ty = wy - d * ny, tz = wz - d * nZ, tl = Math.hypot(tx, ty, tz); if (tl > 1e-9) { const k = Math.min(1, CAR_MU * j / tl); wx -= tx * k; wy -= ty * k; wz -= tz * k; } }
        if (revised && ny > 0.45) R.support = c.e;
        a.p.x = X; a.p.y = Y; a.p.z = Z; a.q.x = X - wx - pcx; a.q.y = Y - wy; a.q.z = Z - wz - pcz;
        if (revised && boxes.length > 1) {
          // Moving out of this panel can push the joint back through the previous
          // one. Slide along this panel until both contact planes are satisfied.
          const dot = px*nX + py*ny + pz*nZ;
          const lost = -(px*(X-beforeX) + py*(Y-beforeY) + pz*(Z-beforeZ));
          const tangent2 = 1 - dot*dot;
          if (priorPanel && lost > 0 && tangent2 > 0.04 && dot < 0) {
            // Near-parallel panels may have no nearby feasible point.
            const distance = Math.min(lost / tangent2, 3 * r / Math.sqrt(tangent2));
            const tx = distance*(px-dot*nX), ty = distance*(py-dot*ny), tz = distance*(pz-dot*nZ);
            a.p.x += tx; a.p.y += ty; a.p.z += tz;
            a.q.x += tx; a.q.y += ty; a.q.z += tz;
          }
          priorPanel = true; px = nX; py = ny; pz = nZ;
        }
      }
      // ---- end of CAR SHAPES block 2
      // posts and hydrants below the height of a storey, then the walls: the whole move of this step is swept (see WALLS at the top)
      if (a.p.y < 3.2) posts(a);
      walls(a, airborne);
      // the ground (the pavement stands 15 cm above the road), with friction that lets a body roll and then stop
      const gy = groundContactHeight(a, R.settling);
      if (revised && (k === 'hips' || k === 'chest')) a.supportHeight = gy - a.r;
      if (revised && a.p.y < gy) {
        const vy = a.p.y - a.q.y;
        const rebound = vy < -h ? -0.08 * vy : Math.max(0, vy);
        const friction = Math.min(1, 0.58 * Math.max(0, rebound - vy) / (Math.hypot(a.p.x - a.q.x, a.p.z - a.q.z) || 1));
        // On a split-level support the planted foot can creep from the
        // position constraints even after its horizontal velocity is zero.
        // Cap static friction by the normal correction for this contact.
        if (gy === 0.15 + a.r && (k === 'ftL' || k === 'ftR') &&
            P.hips.supportHeight < 0 && a.sy <= gy + 0.001) {
          const dx = a.p.x - a.sx, dz = a.p.z - a.sz;
          if (Math.hypot(dx, dz) <= 0.58 * (gy - a.p.y)) {
            a.p.x = a.q.x = a.sx;
            a.p.z = a.q.z = a.sz;
          }
        }
        a.q.x += friction * (a.p.x - a.q.x);
        a.q.z += friction * (a.p.z - a.q.z);
        a.p.y = gy;
        a.q.y = gy - rebound;
      } else if (a.p.y < gy) { const vy = a.p.y - a.q.y; a.p.y = gy; a.q.y = gy + vy * 0.25; a.q.x += (a.p.x - a.q.x) * 0.22; a.q.z += (a.p.z - a.q.z) * 0.22; }
      if (!revised) vmax = Math.max(vmax, a.p.distanceTo(a.q) / h); }
    if (revised) {
      const hips = P.hips, chest = P.chest;
      R.settling = (R.support || (hips.p.y - hips.supportHeight < 0.2 && chest.p.y - chest.supportHeight < 0.25)) &&
        Math.hypot(hips.p.x - hips.sx, hips.p.z - hips.sz, chest.p.x - chest.sx, chest.p.z - chest.sz) < 0.35 * h;
    }
    if (revised) {
      // BULLDOZE (ragdoll lane, Nov 16; node: at 15 and 25 km/h with the pedal held a struck body stayed on the bumper for 58 and 95 m): a body the
      // front of a moving car has pushed for a third of a second is shouldered off to the side it stands nearer, as a bumper does to what it cannot scoop
      if (R.pushN) { R.pushT = (R.pushT || 0) + h; R.pushGap = 0; } else if ((R.pushGap = (R.pushGap || 0) + h) > 0.4) { R.pushT = 0; R.pushSide = 0; }
      /* ... and one carried on the bonnet or roof of a car that keeps going (node: 95 and 99 m at 25 and 40 km/h) rolls off its side after two thirds of a second */
      if (R.pushN && R.pushT > (R.pushF ? 0.3 : 0.65)) { const c = R.pushC; if (Math.hypot(c.x1 - c.x0, c.z1 - c.z0) > 0.004) { const sg = R.pushSide || (R.pushSide = Math.abs(R.pushS) > 0.08 ? Math.sign(R.pushS) : (Math.random() < 0.5 ? 1 : -1)), d = 7 * h * h, lx = c.bsh * sg * d, lz = c.bch * sg * d; for (const k of PTS) { P[k].q.x -= lx; P[k].q.z -= lz; } } }
      R.pushN = 0; R.pushF = 0; R.pushC = null;
      // CAPS (critics, merge batch 5: bodies "at awning height, 3-4 m up ... absurd for 40 km/h"; one joint read 53.7 m up; node: a joint at 38 m/s beside a car at 11):
      // no joint moves over the ground faster than one and a half times the car that struck the body plus 6 m/s, nor rises faster than 2.6 m/s plus an eighth of that car's speed
      const cap = (Math.max(R.sp || 0, R.capSp || 0) * 1.5 + 6) * h, up = (2.6 + 0.125 * Math.max(R.sp || 0, R.capSp || 0)) * h;
      for (const k of PTS) { const a = P[k], vx = a.p.x - a.q.x, vy = a.p.y - a.q.y, vz = a.p.z - a.q.z, l = Math.hypot(vx, vz); if (l > cap) { const f = cap / l; a.q.x = a.p.x - vx * f; a.q.z = a.p.z - vz * f; } if (vy > up) a.q.y = a.p.y - up; }      // (level speed and rise only: a fall is never slowed)
    }
    return vmax;
  }
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _d = new THREE.Vector3();
  // (a joint's stop moves a point WITH its speed's memory: the stop gives it no speed of its own, or a struck leg whips the foot up at 40 m/s)
  const mv = (a, x, y, z) => { a.p.x += x; a.p.y += y; a.p.z += z; a.q.x += x; a.q.y += y; a.q.z += z; };
  function joints(R) { const P = R.P;
    // the body's own axes now: up the spine, his left, his front
    _y.copy(P.chest.p).sub(P.hips.p).normalize(); _x.copy(P.hpR.p).sub(P.hpL.p); _x.addScaledVector(_y, -_x.dot(_y)); if (_x.lengthSq() < 1e-8) return; _x.normalize(); _z.crossVectors(_x, _y).multiplyScalar(R.fsg); const lx = _d.crossVectors(_y, _z);      // lx = his left
    for (let sd = 0; sd < 2; sd++) { const hp = sd ? P.hpR : P.hpL, kn = sd ? P.knR : P.knL, ft = sd ? P.ftR : P.ftL;
      // the knee: the shin may fold back behind the thigh, never forward of it. (thigh x shin) along his left is positive when the knee is bent the right way
      const tx = kn.p.x - hp.p.x, ty = kn.p.y - hp.p.y, tz = kn.p.z - hp.p.z, sx = ft.p.x - kn.p.x, sy = ft.p.y - kn.p.y, sz = ft.p.z - kn.p.z, cx = ty * sz - tz * sy, cy = tz * sx - tx * sz, cz = tx * sy - ty * sx, fl = cx * lx.x + cy * lx.y + cz * lx.z;
      const tl = Math.hypot(tx, ty, tz) || 1e-6;
      if (fl < 0) { const sl = Math.hypot(sx, sy, sz) || 1e-6, k = sl / tl, ex = kn.p.x + tx * k - ft.p.x, ey = kn.p.y + ty * k - ft.p.y, ez = kn.p.z + tz * k - ft.p.z;      // the foot goes towards where a straight leg would have it
        mv(ft, ex * 0.3, ey * 0.3, ez * 0.3); mv(kn, -ex * 0.06, -ey * 0.06, -ez * 0.06); }
      // the hip: a thigh goes no further back than about 25 degrees behind the line of the spine, no further out than about 50 degrees, and not across the other leg
      const back = -(tx * _z.x + ty * _z.y + tz * _z.z) / tl, up = (tx * _y.x + ty * _y.y + tz * _y.z) / tl;
      if (back > 0.42 && up < 0.5) { const m = (back - 0.42) * tl * 0.35; mv(kn, _z.x * m, _z.y * m, _z.z * m); mv(ft, _z.x * m, _z.y * m, _z.z * m); }
      const out = (tx * lx.x + ty * lx.y + tz * lx.z) / tl * (sd ? -1 : 1); if (out > 0.77) { const m = (out - 0.77) * tl * (sd ? 1 : -1) * 0.35; mv(kn, lx.x * m, lx.y * m, lx.z * m); mv(ft, lx.x * m, lx.y * m, lx.z * m); }
      else if (out < -0.35) { const m = (out + 0.35) * tl * (sd ? 1 : -1) * 0.35; mv(kn, lx.x * m, lx.y * m, lx.z * m); mv(ft, lx.x * m, lx.y * m, lx.z * m); } }
  }
  // The solver has an ankle sphere. The skinned shoe extends beyond it to
  // the toe. Keep the stride's ankle rotation until the toe meets the ground.
  const jointOrigin = new THREE.Vector3(), jointEnd = new THREE.Vector3();
  const jointDirection = new THREE.Vector3(), jointTarget = new THREE.Vector3();
  const jointSwing = new THREE.Quaternion(), jointWorld = new THREE.Quaternion();
  const limbContact = {};
  function clearGround(bone, child, radiusRatio, parentPoint, childPoint, extension = 0, minimumFloor = -Infinity, sampleWidth = false, forearm = null) {
    if (!bone || !child) return false;
    bone.getWorldPosition(jointOrigin);
    child.getWorldPosition(jointEnd);
    jointDirection.subVectors(jointEnd, jointOrigin);
    const length = jointDirection.length();
    if (length < 1e-5) return false;
    const clearance = radiusRatio * length;
    let rise = (Math.max(minimumFloor, ragdollGround(game, jointEnd.x, jointEnd.z, jointEnd.y)) + clearance - jointOrigin.y) / length;
    // A limb can span the pavement while its distal joint is on the road.
    // Solve clearance at each sampled distance from its pivot.
    if (sampleWidth && Math.min(jointOrigin.y, jointEnd.y) < 0.15 + clearance) {
      const span = Math.hypot(jointDirection.x, jointDirection.z);
      const width = clearance / (span || 1);
      for (const reach of [0.35, 0.65, 1]) {
        for (const edge of [-1, 1]) {
          const x = jointOrigin.x + reach * jointDirection.x - edge * width * jointDirection.z;
          const z = jointOrigin.z + reach * jointDirection.z + edge * width * jointDirection.x;
          const y = jointOrigin.y + reach * jointDirection.y;
          const surface = ragdollGround(game, x, z, y, limbContact);
          if (surface === 0.15 || limbContact.stair)
            rise = Math.max(rise, (surface + clearance - jointOrigin.y) / (length * reach));
        }
      }
    }
    // Check both ends of a downward-pointing hand. The wrist and the palm
    // can be above different treads or opposite sides of a kerb.
    if (extension && jointDirection.y < 0) {
      jointEnd.addScaledVector(jointDirection, extension);
      const palmFloor = ragdollGround(game, jointEnd.x, jointEnd.z, jointEnd.y);
      rise = Math.max(rise, (palmFloor + clearance - jointOrigin.y) / (length * (1 + extension)));
    }
    // A palm can cross the kerb even when its wrist is on the road or
    // the forearm points up. Probe both sides at the wrist and fingertips.
    if (extension && jointOrigin.y + jointDirection.y < 0.15 + length) {
      const span = Math.hypot(jointDirection.x, jointDirection.z);
      const width = 0.24 * length / (span || 1);
      for (const reach of [1, 1 + extension]) {
        const x = jointOrigin.x + reach * jointDirection.x;
        const z = jointOrigin.z + reach * jointDirection.z;
        const y = jointOrigin.y + reach * jointDirection.y;
        for (const edge of [-1, 1]) {
          const floor = ragdollGround(game, x - edge * jointDirection.z * width,
            z + edge * jointDirection.x * width, y, limbContact);
          if (floor === 0.15 || limbContact.stair)
            rise = Math.max(rise, (floor + clearance - jointOrigin.y) / (length * reach));
        }
      }
    }
    if (jointDirection.y / length >= rise) return false;
    rise = Math.min(1, rise);
    jointTarget.set(jointDirection.x, 0, jointDirection.z);
    if (forearm && jointDirection.y<0 && jointOrigin.y<-.25 && game.subway?.units?.size) {
      const span=jointTarget.length()/length;
      // A nearly vertical segment has no stable azimuth. Fade its
      // horizontal reach to zero as the simulated arm points straight down.
      if (span < .6) forearm.verticalContact = true;
      const confidence=Math.min(1,span/.6);
      const blend=confidence*confidence*(3-2*confidence);
      rise=1-(1-rise)*blend;
    }
    if (jointTarget.lengthSq() < 1e-10 && parentPoint && childPoint)
      jointTarget.set(childPoint.x - parentPoint.x, 0, childPoint.z - parentPoint.z);
    if (jointTarget.lengthSq() < 1e-10) jointTarget.set(1, 0, 0);
    jointTarget.setLength(Math.sqrt(Math.max(0, 1 - rise * rise)));
    jointTarget.y = rise;
    jointSwing.setFromUnitVectors(jointDirection.normalize(), jointTarget);
    bone.getWorldQuaternion(jointWorld).premultiply(jointSwing);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(_q).invert()).multiply(jointWorld);
    bone.updateMatrixWorld(true);
    return true;
  }
  function placeFoot(R, side) {
    const foot = R.B['foot_' + side], toe = R.B['toe_' + side];
    if (!foot || !toe) return;
    foot.quaternion.copy(R.footPose[side]);
    let applied = clearGround(foot, toe, 0.48, R.P['kn' + side].p, R.P['ft' + side].p);
    // Probe the width and toe cap of a shoe spanning a street kerb.
    // The ankle must clear the raised side as well as the toe.
    foot.getWorldPosition(jointOrigin);
    toe.getWorldPosition(jointEnd);
    const length = jointEnd.distanceTo(jointOrigin);
    let soleFloor = -Infinity, rail = null;
    if (Math.min(jointOrigin.y, jointEnd.y) < 0.15 + length &&
        (Math.min(jointOrigin.y, jointEnd.y) > -length || game.subway?.units?.size)) {
      const dx = jointEnd.x - jointOrigin.x, dz = jointEnd.z - jointOrigin.z;
      const span = Math.hypot(dx, dz);
      const width = 0.45 * length / (span || 1);
      for (const u of [-0.30, 0.55, 1.30]) {
        for (const edge of [-1, 1]) {
          const x = jointOrigin.x + u*dx - edge*dz*width;
          const z = jointOrigin.z + u*dz + edge*dx*width;
          const surface = ragdollGround(game,x,z,jointOrigin.y,limbContact);
          if (surface === 0.15 || limbContact.stair) soleFloor = Math.max(soleFloor, surface);
        }
      }
    }
    // Let the flexed knee and ankle support a shoe on the top bar.
    if (game.subway?.entrances) {
      const top = game.subway.meta.zWalk + 1.125, ankle = R.P['ft' + side];
      if (Math.min(R.P.ftL.p.y,R.P.ftR.p.y) >= top-.025 &&
          ankle.p.y >= top && ankle.p.y <= top+ankle.r+.001) {
        const x = ankle.p.x, y = -ankle.p.z;
        near(x,y,x,y,ankle.r+.025,top);
        for (const segment of cand) {
          if (segment.set !== 'subway') continue;
          const gap = Math.max(0,segDist(x,y,segment)-.025);
          if (Math.hypot(gap,ankle.p.y-top) <= ankle.r+.001) {
            rail = segment;
            soleFloor = top;
            break;
          }
        }
      }
    }
    if (Number.isFinite(soleFloor) || game.subway?.units?.size) {
      const shin = R.B['shin_' + side], hip = R.P['hp' + side].p, knee = R.P['kn' + side].p;
      const checkTreads = Boolean(game.subway?.units?.size);
      if (rail) {
        shinStart.copy(shin.quaternion);
        footStart.copy(foot.quaternion);
      }
      const raised = clearGround(shin, foot, 0.19, hip, knee, 0, soleFloor, checkTreads);
      // Raising the ankle moves its footprint horizontally, sometimes onto the next tread.
      if (raised && checkTreads)
        clearGround(shin, foot, 0.19, hip, knee, 0, soleFloor, true);
      limitKnee(R.B['thigh_' + side], shin, foot);
      applied = clearGround(foot, toe, 0.48, R.P['kn' + side].p, R.P['ft' + side].p, 0, soleFloor) || applied;
      if (rail) fitShoeToRail(R, side, shin, foot, rail, soleFloor);
    }
    if (applied)
      R.footApplied[side].copy(foot.quaternion);
  }
  // Rotate the shin around vertical first: the ankle can move sideways on
  // the tread without losing height. If height and flexion are incompatible,
  // choose the highest shin direction on the flexion cone.
  function limitKnee(thigh, shin, foot) {
    if (!thigh || !shin) return;
    thigh.getWorldPosition(jointOrigin);
    shin.getWorldPosition(jointEnd);
    jointDirection.subVectors(jointEnd, jointOrigin).normalize();
    foot.getWorldPosition(jointTarget).sub(jointEnd).normalize();
    const cosine = jointDirection.dot(jointTarget);
    if (cosine >= kneeCos) return;
    const horizontal = Math.hypot(jointDirection.x, jointDirection.z);
    const span = Math.hypot(jointTarget.x, jointTarget.z);
    const yawCos = (kneeCos - jointDirection.y * jointTarget.y) / (horizontal * span);
    kneeTarget.copy(jointTarget);
    if (horizontal > 1e-6 && span > 1e-6 && Math.abs(yawCos) <= 1) {
      const side = Math.sign(jointDirection.x * jointTarget.z - jointDirection.z * jointTarget.x) || 1;
      const yawSin = side * Math.sqrt(1 - yawCos * yawCos);
      kneeTarget.x = span * (jointDirection.x * yawCos - jointDirection.z * yawSin) / horizontal;
      kneeTarget.z = span * (jointDirection.z * yawCos + jointDirection.x * yawSin) / horizontal;
    } else {
      kneeTarget.set(0, 1, 0).addScaledVector(jointDirection, -jointDirection.y);
      if (kneeTarget.lengthSq() < 1e-12) {
        kneeTarget.set(jointTarget.x, 0, jointTarget.z);
        if (kneeTarget.lengthSq() < 1e-12) kneeTarget.set(1, 0, 0);
      }
      kneeTarget.setLength(0.5).addScaledVector(jointDirection, kneeCos);
    }
    jointSwing.setFromUnitVectors(jointTarget, kneeTarget.normalize());
    shin.getWorldQuaternion(jointWorld).premultiply(jointSwing);
    shin.quaternion.copy(shin.parent.getWorldQuaternion(_q).invert()).multiply(jointWorld);
    shin.updateMatrixWorld(true);
  }
  const kneeCos = Math.cos(150 * Math.PI / 180), kneeTarget = new THREE.Vector3();
  const elbowAxis = new THREE.Vector3();
  const elbowLimit = 150 * Math.PI / 180;
  function limitElbow(shoulder, elbow, wrist) {
    if (!shoulder || !wrist) return;
    shoulder.getWorldPosition(jointOrigin);
    elbow.getWorldPosition(jointEnd);
    jointDirection.subVectors(jointEnd, jointOrigin).normalize();
    wrist.getWorldPosition(jointTarget).sub(jointEnd).normalize();
    const angle = jointTarget.angleTo(jointDirection);
    if (angle <= elbowLimit) return;
    elbowAxis.crossVectors(jointTarget, jointDirection);
    if (elbowAxis.lengthSq() < 1e-12) return;
    jointSwing.setFromAxisAngle(elbowAxis.normalize(), angle - elbowLimit);
    elbow.getWorldQuaternion(jointWorld).premultiply(jointSwing);
    elbow.quaternion.copy(elbow.parent.getWorldQuaternion(_q).invert()).multiply(jointWorld);
    elbow.updateMatrixWorld(true);
  }
  // Freeze a sparse outline of the captured skin in the pelvis frame.
  // Each trunk bone contributes its own extrema, including points along
  // the waist that a single outline for the whole torso would omit.
  const trunkPoint = new THREE.Vector3(), trunkDirections = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x || y || z) trunkDirections.push(new THREE.Vector3(x, y, z));
  }
  function captureOutline(R, pivot, vertices, bonePattern) {
    const points = [];
    const inverse = pivot.matrixWorld.clone().invert();
    R.root.traverse(mesh => {
      if (!mesh.isSkinnedMesh || !mesh.visible) return;
      const {skinIndex, skinWeight} = mesh.geometry.attributes;
      // Skin the prepared support vertices in the actual impact pose.
      // Unknown or resized meshes retain the full pose-dependent scan.
      const meshName = mesh.parent?.name.endsWith('_mesh') ? mesh.parent.name : mesh.name;
      const prepared = vertices[meshName + ':' + skinIndex.count];
      if (prepared) {
        for (const index of prepared) {
          mesh.getVertexPosition(index, trunkPoint).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
          points.push(trunkPoint.clone());
        }
        return;
      }
      const outlines = mesh.skeleton.bones.map(bone => bonePattern.test(bone.name)
        ? {scores: new Float64Array(trunkDirections.length).fill(-Infinity), points: []} : null);
      for (let j = 0; j < skinIndex.count; j++) {
        let best = 0;
        for (let k = 1; k < 4; k++) {
          if (skinWeight.getComponent(j, k) > skinWeight.getComponent(j, best)) best = k;
        }
        const outline = outlines[skinIndex.getComponent(j, best)];
        if (!outline) continue;
        mesh.getVertexPosition(j, trunkPoint).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        for (let i = 0; i < trunkDirections.length; i++) {
          const score = trunkPoint.dot(trunkDirections[i]);
          if (score <= outline.scores[i]) continue;
          outline.scores[i] = score;
          (outline.points[i] ||= new THREE.Vector3()).copy(trunkPoint);
        }
      }
      for (const outline of outlines) {
        if (!outline) continue;
        for (const point of outline.points) {
          if (!points.some(p => p.equals(point))) points.push(point);
        }
      }
    });
    return points;
  }
  // Bind positions and skin weights are fixed on the shipped ragdolls.
  // Share a bone transform across all contact vertices that use that bone.
  function prepareTreadSamples(mesh, indices) {
    if (mesh.geometry.morphAttributes.position?.length) return {mesh, indices};
    const {position, skinIndex, skinWeight} = mesh.geometry.attributes;
    const bones = new Map(), samples = [];
    for (const index of indices) {
      const bind = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix);
      const influences = [];
      for (let j = 0; j < 4; j++) {
        const weight = skinWeight.getComponent(index, j);
        if (!weight) continue;
        const id = skinIndex.getComponent(index, j);
        if (!bones.has(id)) bones.set(id, new THREE.Matrix4());
        influences.push({matrix:bones.get(id).elements, x:bind.x*weight, y:bind.y*weight, z:bind.z*weight, weight});
      }
      samples.push(influences);
    }
    return {mesh, indices, bones, samples};
  }
  const meshToWorld = new THREE.Matrix4(), worldOffset = new THREE.Vector3();
  // Station builds finish populating the floor list before exposing the walk.
  // Cache by list so unloading a station releases its bounds, and refresh on append.
  const floorBounds = new WeakMap();
  function supportCeilings(units) {
    let ground = 0.15, tread = -Infinity;
    for (const unit of units.values()) {
      if (!unit.walk) continue;
      const {floors, meta} = unit.walk;
      if (!floors || !(meta?.rise > 0)) return {ground:Infinity, tread:0.15};
      let bounds = floorBounds.get(floors);
      if (!bounds || bounds.count !== floors.length || bounds.rise !== meta.rise) {
        bounds = {count:floors.length, rise:meta.rise, ground:-Infinity, tread:-Infinity};
        for (const floor of floors) {
          const top = Math.max(floor.z0, floor.z1);
          bounds.ground = Math.max(bounds.ground, top);
          if (floor.stair) {
            const steps = floor.n || Math.round(Math.abs(floor.z1 - floor.z0) / meta.rise);
            bounds.tread = Math.max(bounds.tread, top - meta.rise * Math.min(1, steps));
          }
        }
        floorBounds.set(floors, bounds);
      }
      ground = Math.max(ground, bounds.ground);
      tread = Math.max(tread, bounds.tread);
    }
    return {ground, tread:Math.min(0.15, tread)};
  }
  function preparePoseMatrices({mesh,bones}) {
    if (!bones) return;
    meshToWorld.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    worldOffset.setFromMatrixPosition(meshToWorld);
    // Apply world translation once, independently of the sum of the skin weights.
    meshToWorld.setPosition(0, 0, 0);
    for (const [id, matrix] of bones) {
      matrix.multiplyMatrices(mesh.skeleton.bones[id].matrixWorld, mesh.skeleton.boneInverses[id]);
      matrix.premultiply(meshToWorld);
    }
  }
  function sampleHeight(influences) {
    let y = 0;
    for (const {matrix:m, x, y:by, z, weight} of influences)
      y += m[1]*x + m[5]*by + m[9]*z + m[13]*weight;
    return y + worldOffset.y;
  }
  function samplePosition(influences, y, point) {
    let x = 0, z = 0;
    for (const {matrix:m, x:bx, y:by, z:bz, weight} of influences) {
      x += m[0]*bx + m[4]*by + m[8]*bz + m[12]*weight;
      z += m[2]*bx + m[6]*by + m[10]*bz + m[14]*weight;
    }
    point.set(x + worldOffset.x, y, z + worldOffset.z);
  }
  // Keep bind-space influences across hits and refresh bone matrices for the
  // current pose. A vertex above the lowest verified contact cannot add lift.
  const railTopSamples = new WeakMap();
  const shinStart = new THREE.Quaternion(), footStart = new THREE.Quaternion();
  const shinEnd = new THREE.Quaternion(), footEnd = new THREE.Quaternion();
  function fitShoeToRail(R, side, shin, foot, segment, top) {
    if (!R.railMeshes) return;
    shinEnd.copy(shin.quaternion);
    footEnd.copy(foot.quaternion);
    let low = 0, high = 1;
    // Retain the least correction verified clear, with the original supported
    // pose as fallback. Check the deformed sole after each trial rotation.
    function poseAt(t) {
      shin.quaternion.slerpQuaternions(shinStart, shinEnd, t);
      foot.quaternion.slerpQuaternions(footStart, footEnd, t);
      shin.updateMatrixWorld(true);
      limitKnee(R.B['thigh_' + side], shin, foot);
    }
    for (let trial=0; trial<6; trial++) {
      const t = (low+high)/2;
      poseAt(t);
      let clear = true;
      for (const {mesh} of R.railMeshes) {
        const entry = fullRailSamples(mesh);
        preparePoseMatrices(entry);
        for (let i=0; i<entry.indices.length; i++) {
          if (entry.samples) {
            const sample=entry.samples[i], y=sampleHeight(sample);
            if (y>=top+.001) continue;
            samplePosition(sample,y,trunkPoint);
          } else mesh.getVertexPosition(i,trunkPoint).applyMatrix4(mesh.matrixWorld);
          if (trunkPoint.y<top+.001 && segDist(trunkPoint.x,-trunkPoint.z,segment)<.03) {
            clear=false;
            break;
          }
        }
        if (!clear) break;
      }
      if (clear) high=t;
      else low=t;
    }
    poseAt(high);
  }
  function fullRailSamples(mesh) {
    let entry = railTopSamples.get(mesh);
    if (!entry) {
      const indices = Array.from({length:mesh.geometry.attributes.position.count}, (_,i)=>i);
      entry = prepareTreadSamples(mesh, indices);
      railTopSamples.set(mesh, entry);
    }
    return entry;
  }
  const railSegments = new Set();
  function clearRailSkin(R) {
    R.lowestRailSample = -Infinity;
    R.railEntryLift = Infinity;
    if (!game.subway?.entrances || R.support || R.restCar) return;
    const hips = R.B.hips, point = trunkPoint;
    hips.getWorldPosition(point);
    const x = point.x, y = -point.z, pavement = game.subway.meta.zWalk;
    // Query at pavement height so high joints can still hang across the top.
    near(x, y, x, y, 2, pavement);
    railSegments.clear();
    for (const s of cand) if (s.set === 'subway' && segDist(x, y, s) <= 2) railSegments.add(s);
    if (!railSegments.size) return;
    if (!R.railMeshes) {
      R.railMeshes = [];
      R.root.traverseVisible(mesh => {
        if (!mesh.isSkinnedMesh) return;
        const name = mesh.parent?.name.endsWith('_mesh') ? mesh.parent.name : mesh.name;
        const key = name + ':' + mesh.geometry.attributes.skinIndex.count;
        const indices = new Set([trunkVertices, stairChestVertices, stairThighVertices, lowerLegVertices,
          handVertices, armVertices, railSleeveVertices, stairHeadVertices].flatMap(table => table[key] || []));
        if (indices.size) R.railMeshes.push(prepareTreadSamples(mesh, [...indices]));
      });
    }
    // During an over-top fall the shortest clearance can be upward, while
    // a grounded body still belongs on the side from which it approached.
    const aboveRail = Math.min(R.P.ftL.p.y, R.P.ftR.p.y) >= pavement+1.1;

    let lowest = Infinity, highestBelow = -Infinity;
    for (const s of railSegments) {
      const dx = s[2]-s[0], dy = s[3]-s[1], length = Math.hypot(dx,dy);
      if (!length) continue;
      const tx = dx/length, ty = dy/length;
      const side = Math.sign((x-s[0])*(-ty)+(y-s[1])*tx) || 1;
      const nx = -ty*side, ny = tx*side;
      let shift = 0, topLift = 0;
      for (const entry of R.railMeshes) {
        const {mesh,indices,samples} = entry;
        preparePoseMatrices(entry);
        for (let i = 0; i < indices.length; i++) {
          if (samples) {
            const h = sampleHeight(samples[i]);
            lowest = Math.min(lowest,h);
            if (h < pavement+.14) {
              highestBelow = Math.max(highestBelow,h);
              continue;
            }
            if (h > pavement+1.125) continue;
            samplePosition(samples[i], h, point);
          } else {
            mesh.getVertexPosition(indices[i],point).applyMatrix4(mesh.matrixWorld);
            lowest = Math.min(lowest, point.y);
            if (point.y < pavement+.14) highestBelow = Math.max(highestBelow, point.y);
          }
          if (point.y < pavement+.14 || point.y > pavement+1.125) continue;
          const rx = point.x-s[0], ry = -point.z-s[1], along = rx*tx+ry*ty;
          if (along < 0 || along > length) continue;
          const depth = .03-rx*nx-ry*ny;
          if (depth > 0) {
            shift = Math.max(shift, depth);
            topLift = Math.max(topLift, pavement+1.125-point.y+1e-6);
          }
        }
      }
      if (shift > 0) {
        if (aboveRail && topLift < shift && lowest >= pavement+.14) {
          // The side-contact samples omit parts of the soles. Check the full
          // skin before relying on the smaller vertical clearance.
          // A shoe can extend past the far face while crossing the top.
          // Measure vertical clearance over the metal footprint on both sides.
          topLift = 0;
          for (const {mesh} of R.railMeshes) {
            const entry = fullRailSamples(mesh);
            preparePoseMatrices(entry);
            for (let j=0; j<mesh.geometry.attributes.position.count; j++) {
              if (topLift >= shift) break;
              if (entry.samples) {
                const sample = entry.samples[j], y = sampleHeight(sample);
                if (pavement+1.125-y+1e-6 <= topLift) continue;
                samplePosition(sample, y, point);
              } else {
                mesh.getVertexPosition(j,point).applyMatrix4(mesh.matrixWorld);
              }
              if (point.y > pavement+1.125) continue;
              const rx=point.x-s[0], ry=-point.z-s[1], along=rx*tx+ry*ty;
              if (along>=0 && along<=length && Math.abs(rx*nx+ry*ny)<.03)
                topLift=Math.max(topLift,pavement+1.125-point.y+1e-6);
            }
          }
        }
        hips.getWorldPosition(point);
        if (aboveRail && topLift < shift && lowest >= pavement+.14) {
          point.y += topLift;
        } else {
          point.x += shift*nx; point.z -= shift*ny;
        }
        hips.position.copy(hips.parent.worldToLocal(point));
        hips.updateMatrixWorld(true);
      }
    }
    // Rail samples include every tread sample. Horizontal rail corrections
    // preserve their world heights; retain a margin for transform roundoff.
    R.lowestRailSample = lowest - 1e-7;
    R.railEntryLift = pavement+.14-highestBelow-1e-7;
  }
  function supportTrunk(R) {
    if (R.support || R.restCar) return;
    const hips = R.B.hips;
    const m = hips.matrixWorld.elements;
    const streetOnly = !game.subway?.units?.size;
    const ceilings = streetOnly ? null : supportCeilings(game.subway.units);
    const groundCeiling = ceilings?.ground ?? 0.15;
    let lift = 0;
    for (const point of R.trunkPoints) {
      // Only probe points that could require more lift than the current contact.
      const y = m[1]*point.x + m[5]*point.y + m[9]*point.z + m[13];
      if (y + lift >= groundCeiling) continue;
      const x = m[0]*point.x + m[4]*point.y + m[8]*point.z + m[12];
      const z = m[2]*point.x + m[6]*point.y + m[10]*point.z + m[14];
      lift = Math.max(lift, ragdollGround(game, x, z, y) - y);
    }
    // Check the blended skull and body surfaces together after the final neck rotation.
    // A tread corner can touch the calf or toe beyond the joint probes.
    if (ceilings && ceilings.tread > -Infinity && R.lowestRailSample + lift < ceilings.tread) {
      if (!R.treadMeshes) {
        R.treadMeshes = [];
        R.root.traverseVisible(mesh => {
          if (!mesh.isSkinnedMesh) return;
          const name = mesh.parent?.name.endsWith('_mesh') ? mesh.parent.name : mesh.name;
          const key = name + ':' + mesh.geometry.attributes.skinIndex.count;
          const indices = [...(stairChestVertices[key] || []), ...(stairThighVertices[key] || []), ...(lowerLegVertices[key] || []), ...(handVertices[key] || []), ...(armVertices[key] || []), ...(stairHeadVertices[key] || [])];
          // Vertices on the c06 arms, hands, hips, toes and skull can straddle the lip of a tread
          // while their bind-space cell representatives are over the lower step.
          if (key === 'c06_mesh:3228') indices.push(437, 616, 710, 843, 1237, 1293, 1751, 1765, 1773, 1796, 1797, 1807, 1808, 2103, 2104, 2393, 2439, 2569, 2850, 2852, 2896, 2943);
          // At stair lips, sample the posed skin across the shin, hips, lower spine and upper arm.
          if (key === 'ped_d_mesh:2018') indices.push(288, 677, 687, 699, 814, 890, 910, 934, 1269, 1312, 1313, 1318, 1330, 1331, 1335, 1344);
          // The skull can cross the tread lip before the other head samples.
          if (key === 'ped_d_mesh:945') indices.push(110, 558, 568, 605);
          // The left thumb, index and middle fingertips reach across the uphill tread edge.
          if (key === 'ped_d_mesh:5950') indices.push(4132, 4404, 4776, 4933);
          // The thumb and skull can reach a higher tread between outline samples.
          if (key === 'ped_a_mesh:5223') indices.push(1573, 2763, 4207);
          // Sample the sleeve, chest, lower spine, hip and shin where they cross a step between outline points.
          if (key === 'ped_a_mesh:3132') indices.push(524, 542, 547, 548, 550, 769, 952, 1065, 1158, 1565, 1590, 1684, 2045, 2046, 2128, 2182, 2773);
          // The skull, palm, sleeve and lower torso can reach a higher tread between outline samples.
          if (key === 'c00_mesh:3248') indices.push(109, 514, 784, 1326, 1355, 1432, 1572, 1729, 1761, 2226, 2227, 2244, 2908, 2924);
          // Sample the toe cap as it crosses the uphill tread edge.
          if (key === 'ped_a_mesh:619') indices.push(64);
          // Skull contacts at tread edges on the smaller mesh.
          if (key === 'ped_a_mesh:983') indices.push(370, 500, 606, 653, 710);
          if (indices?.length) R.treadMeshes.push(prepareTreadSamples(mesh, indices));
        });
      }
      for (const entry of R.treadMeshes) {
        const {mesh, indices, samples} = entry;
        preparePoseMatrices(entry);
        for (let i = 0; i < indices.length; i++) {
          if (samples) {
            const y = sampleHeight(samples[i]);
            if (y + lift >= ceilings.tread) continue;
            samplePosition(samples[i], y, trunkPoint);
          } else mesh.getVertexPosition(indices[i], trunkPoint).applyMatrix4(mesh.matrixWorld);
          if (trunkPoint.y + lift >= ceilings.tread) continue;
          const floor = ragdollGround(game, trunkPoint.x, trunkPoint.z, trunkPoint.y, limbContact, true);
          if (limbContact.stair) lift = Math.max(lift, floor - trunkPoint.y);
        }
      }
    }
    if (lift <= 0) return;
    hips.getWorldPosition(trunkPoint).y += lift;
    hips.position.copy(hips.parent.worldToLocal(trunkPoint));
    hips.updateMatrixWorld(true);
    return lift;
  }
  const skullPoint = new THREE.Vector3(), skullAxis = new THREE.Vector3();
  const initialNeck = new THREE.Quaternion();
  function clearHead(R) {
    const {neck, head} = R.B;
    if (!neck || !head || !game.subway?.units?.size) return;
    R.headPoints ||= captureOutline(R, head, stairHeadVertices, /_head$/);
    // Place the skull on the neck axis first. A point near the front of the
    // skull can otherwise turn the head sideways into the neighbouring riser.
    let remaining = 25 * Math.PI / 180;
    initialNeck.copy(neck.quaternion);
    if (clearGround(neck, head, 0.85, R.P.chest.p, R.P.head.p, 1.5, -Infinity, true)) {
      const turn = initialNeck.angleTo(neck.quaternion);
      if (turn > remaining) {
        neck.quaternion.copy(initialNeck.rotateTowards(neck.quaternion, remaining));
        neck.updateMatrixWorld(true);
      }
      remaining -= turn;
    }
    neck.getWorldPosition(jointOrigin);
    for (let pass = 0; pass < 3 && remaining > 0; pass++) {
      let depth = 0;
      for (const point of R.headPoints) {
        skullPoint.copy(point).applyMatrix4(head.matrixWorld);
        if (skullPoint.y >= 0.15) continue;
        const floor = ragdollGround(game, skullPoint.x, skullPoint.z, skullPoint.y, limbContact, true);
        if (limbContact.stair && floor - skullPoint.y > depth) {
          depth = floor - skullPoint.y;
          jointTarget.copy(skullPoint).sub(jointOrigin);
        }
      }
      if (depth < 0.001) break;
      // Turn about the neck toward the tread normal, keeping the neck anchored.
      skullAxis.set(-jointTarget.z, 0, jointTarget.x);
      const lever = skullAxis.length();
      if (lever < 0.001) break;
      const angle = Math.min(remaining, depth / lever);
      jointSwing.setFromAxisAngle(skullAxis.divideScalar(lever), angle);
      neck.getWorldQuaternion(jointWorld).premultiply(jointSwing);
      neck.quaternion.copy(neck.parent.getWorldQuaternion(_q).invert()).multiply(jointWorld);
      neck.updateMatrixWorld(true);
      remaining -= angle;
    }
  }
  // Restrict shoulder relaxation to arms entirely inside the open stairwell,
  // below the rail bases. Check every vertex moved by the shoulder rotation.
  function armSurface(R, arm) {
    const entries = [];
    const moving = new Set();
    arm.traverse(bone => moving.add(bone));
    R.root.traverseVisible(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const {skinIndex, skinWeight} = mesh.geometry.attributes, indices = [];
      for (let i = 0; i < skinIndex.count; i++) {
        for (let j = 0; j < 4; j++) {
          if (skinWeight.getComponent(i,j) && moving.has(mesh.skeleton.bones[skinIndex.getComponent(i,j)])) {
            indices.push(i);
            break;
          }
        }
      }
      if (indices.length) entries.push(prepareTreadSamples(mesh, indices));
    });
    return entries;
  }
  function insideWell(entries, stair, meta) {
    const steps = stair.n || Math.round(Math.abs(stair.z1-stair.z0)/meta.rise);
    for (const entry of entries) {
      preparePoseMatrices(entry);
      for (let i=0; i<entry.indices.length; i++) {
        const p = trunkPoint;
        if (entry.samples) {
          const sample = entry.samples[i];
          samplePosition(sample,sampleHeight(sample),p);
        } else entry.mesh.getVertexPosition(entry.indices[i],p).applyMatrix4(entry.mesh.matrixWorld);
        const dx=p.x-stair.x, dy=-p.z-stair.y;
        const down=stair.l/2 + (stair.z0>stair.z1?1:-1)*(dx*stair.ca+dy*stair.sa);
        if (p.y>=meta.zWalk || down<0 || down>=Math.min(meta.lOpen,stair.l) ||
            Math.abs(dy*stair.ca-dx*stair.sa)>=stair.w/2) return false;
        const tread=Math.max(stair.z0,stair.z1)-(1+Math.floor(down*steps/stair.l))*meta.rise;
        if (p.y<tread) return false;
      }
    }
    return entries.length>0;
  }
  function settleShoulder(R,side,dt) {
    const arm=R.B['upper_arm_'+side], elbow=R.B['forearm_'+side], hand=R.B['hand_'+side];
    if (!arm || !elbow || !hand) return;
    const goal=R.P['el'+side].p, wrist=R.P['ha'+side].p;
    ragdollGround(game,goal.x,goal.z,goal.y,limbContact,true);
    const stair=limbContact.stair;
    if (!stair || !limbContact.open) {
      if (R.armFit?.[side]) R.armFit[side].angle=0;
      return;
    }
    const origin=arm.getWorldPosition(jointOrigin);
    const end=elbow.getWorldPosition(jointEnd);
    // Relax only a severely displaced elbow. A small offset often comes
    // from one arm supporting the body on a different tread.
    if (end.distanceToSquared(goal)<=end.distanceToSquared(origin)) {
      if (R.armFit?.[side]) R.armFit[side].angle=0;
      return;
    }
    const state=R.armFit ||= {};
    const fit=state[side] ||= {entries:armSurface(R,arm),angle:0,lastElbow:new THREE.Vector3(),lastHand:new THREE.Vector3()};
    const wristError=hand.getWorldPosition(jointTarget).distanceToSquared(wrist);
    jointDirection.subVectors(end,origin).normalize();
    jointTarget.subVectors(goal,origin).normalize();
    const swing=jointDirection.angleTo(jointTarget);
    if (swing<.001) return;
    elbowAxis.crossVectors(jointDirection,jointTarget).normalize();
    const base=arm.quaternion.clone();
    const parent=arm.parent.getWorldQuaternion(_q);
    elbowAxis.applyQuaternion(parent.invert());
    const next=Math.min(swing,fit.angle+Math.min(dt,.05)*1.9);
    for (const angle of [next,Math.min(fit.angle,swing)]) {
      if (angle<=0) break;
      arm.quaternion.copy(base).premultiply(jointSwing.setFromAxisAngle(elbowAxis,angle));
      arm.updateMatrixWorld(true);
      if (hand.getWorldPosition(jointTarget).distanceToSquared(wrist)<=wristError &&
          insideWell(fit.entries,stair,game.subway.meta)) {
        elbow.getWorldPosition(fit.lastElbow);
        hand.getWorldPosition(fit.lastHand);
        fit.releasing=true;
        fit.angle=angle;
        return;
      }
    }
    arm.quaternion.copy(base);
    arm.updateMatrixWorld(true);
    fit.angle=0;
  }
  function releaseArm(R,side,fit,dt) {
    const elbow=R.B['forearm_'+side], hand=R.B['hand_'+side], upper=R.B['upper_arm_'+side];
    const pivot=elbow.getWorldPosition(new THREE.Vector3());
    fit.releasing=false;
    if (dt<=0 || R.frozen) return;
    ragdollGround(game,pivot.x,pivot.z,pivot.y,limbContact,true);
    const stair=limbContact.stair;
    if (!stair || !limbContact.open) return;
    const travel=4*Math.min(dt,.05);
    // The resting shoulder may have lifted the elbow a full tread above
    // its awake pose. Move that pivot before aiming the wrist from it.
    const elbowStep=pivot.distanceTo(fit.lastElbow);
    if (elbowStep>travel) {
      const origin=upper.getWorldPosition(jointOrigin);
      const goal=fit.lastElbow.clone().lerp(pivot,travel/elbowStep).sub(origin).normalize();
      const swing=jointSwing.setFromUnitVectors(jointDirection.subVectors(pivot,origin).normalize(),goal);
      const parent=upper.parent.getWorldQuaternion(_q);
      const base=upper.quaternion.clone();
      upper.quaternion.premultiply(parent.clone().invert().multiply(swing).multiply(parent));
      upper.updateMatrixWorld(true);
      if (insideWell(fit.entries,stair,game.subway.meta)) {
        elbow.getWorldPosition(pivot);
        fit.releasing=true;
      } else {
        upper.quaternion.copy(base);
        upper.updateMatrixWorld(true);
      }
    }
    fit.lastElbow.copy(pivot);
    const target=hand.getWorldPosition(new THREE.Vector3());
    const delta=target.distanceTo(fit.lastHand);
    if (delta<=travel) {
      fit.lastHand.copy(target);
      return;
    }
    const goal=fit.lastHand.clone().lerp(target,travel/delta).sub(pivot).normalize();
    const swing=new THREE.Quaternion().setFromUnitVectors(target.clone().sub(pivot).normalize(),goal);
    const parent=elbow.parent.getWorldQuaternion(new THREE.Quaternion());
    const base=elbow.quaternion.clone();
    const local=parent.clone().invert().multiply(swing).multiply(parent).multiply(base);
    for (const fraction of [1,.75,.5,.25]) {
      elbow.quaternion.copy(base).slerp(local,fraction);
      elbow.updateMatrixWorld(true);
      limitElbow(upper,elbow,hand);
      const candidate=hand.getWorldPosition(jointTarget);
      if (candidate.distanceTo(fit.lastHand)<delta && insideWell(fit.entries,stair,game.subway.meta)) {
        fit.lastHand.copy(candidate);
        fit.releasing=true;
        return;
      }
    }
    elbow.quaternion.copy(base);
    elbow.updateMatrixWorld(true);
    fit.lastHand.copy(target);
  }
  const previousAim = new THREE.Vector3();
  function trackWrist(R, side, dt) {
    const wrist = R.B['hand_'+side], elbow = R.B['forearm_'+side];
    if (!wrist || !elbow) return;
    const state = R.wristHistory?.[side];
    if (!state) return;
    wrist.getWorldPosition(jointEnd);
    const last = state.last ||= jointEnd.clone();
    elbow.getWorldPosition(jointOrigin);
    const travel = 8 * dt;
    const step = last.distanceTo(jointEnd);
    const wasTracking = state.tracking;
    state.tracking = false;
    if (dt > 0 && step > travel && jointOrigin.y < -.25 && R.rest === 0 && (state.verticalContact || wasTracking)) {
      // Seek the closest point on the current forearm sphere, then recheck
      // the wrist and fingers on the tread reached by this new direction.
      previousAim.copy(last).lerp(jointEnd,travel/step).sub(jointOrigin);
      if (previousAim.lengthSq() > 1e-10) {
        state.tracking = true;
        jointDirection.subVectors(jointEnd,jointOrigin).normalize();
        jointSwing.setFromUnitVectors(jointDirection,previousAim.normalize());
        elbow.getWorldQuaternion(jointWorld).premultiply(jointSwing);
        elbow.quaternion.copy(elbow.parent.getWorldQuaternion(_q).invert()).multiply(jointWorld);
        elbow.updateMatrixWorld(true);
        const shoulder=R.P['sh'+side].p, pivot=R.P['el'+side].p;
        if (clearGround(elbow,wrist,.30,shoulder,pivot,.55,-Infinity,true))
          clearGround(elbow,wrist,.30,shoulder,pivot,.55,-Infinity,true);
        limitElbow(R.B['upper_arm_'+side],elbow,wrist);
      }
    }
    wrist.getWorldPosition(last);
  }
  function pose(R,dt) {            // the points drive the figure's own skeleton
    const B = R.B, P = R.P, root = R.root; root.updateMatrixWorld(true);
    const Rm = torso(R, _m).multiply(R.M0i), Rq = _q2.setFromRotationMatrix(Rm);
    // hips: where the hip point is, turned as the torso has turned since the hit
    const hq = new THREE.Quaternion().copy(Rq).multiply(R.q0.hips), hp = _v.copy(R.h0).applyQuaternion(Rq).add(P.hips.p), par = B.hips.parent; hp.y += liftAt(P.hips.p.x, P.hips.p.z);
    _m2.copy(par.matrixWorld).invert(); B.hips.position.copy(hp).applyMatrix4(_m2); B.hips.quaternion.copy(par.getWorldQuaternion(_q).invert()).multiply(hq); B.hips.updateMatrixWorld(true);
    let liftedShoulder = false;
    for (const [bone, a, b] of LIMBS) { const bn = B[bone]; if (!bn) continue; const d = _a.copy(P[b].p).sub(P[a].p).normalize(), d0 = _b.copy(R.d0[bone]).applyQuaternion(Rq);
      // Solve from the corrected elbow when the upper arm has been lifted
      // above the wrist's resting tread. Preserve the bone length and twist.
      if (liftedShoulder && a.startsWith('el') && R.settling && game.subway?.units?.size) {
        bn.getWorldPosition(jointOrigin);
        ragdollGround(game,P[b].p.x,P[b].p.z,P[b].p.y,limbContact,true);
        if (limbContact.stair && jointOrigin.y>P[a].p.y)
          d.subVectors(P[b].p,jointOrigin).normalize();
      }
      const wq = new THREE.Quaternion().setFromUnitVectors(d0, d).multiply(Rq).multiply(R.q0[bone]); bn.quaternion.copy(bn.parent.getWorldQuaternion(_q).invert()).multiply(wq); bn.updateMatrixWorld(true);
      // Solve against the posed chain. Project the elbow before orienting the
      // forearm, so the wrist can still follow its independent simulated direction.
      if (revised && a.startsWith('sh')) liftedShoulder = clearGround(bn, B['forearm_' + a.at(-1)], 0.25, P.chest.p, P[a].p, 0, -Infinity, true);
      if (revised && a.startsWith('hp')) clearGround(bn, B['shin_' + a.at(-1)], 0.22, P.hips.p, P[a].p, 0, -Infinity, true);
      if (revised && a.startsWith('el')) {
        const side = a.at(-1), wrist = B['hand_' + side];
        const shoulder = P['sh' + side].p;
        const checkTreads = Boolean(game.subway?.units?.size);
        const history = checkTreads && (R.wristHistory ||= {});
        const state = history && (history[side] ||= {});
        if (state) state.verticalContact = false;
        const raised = clearGround(bn, wrist, 0.30, shoulder, P[a].p, 0.55, -Infinity, checkTreads, state);
        // Rotating around the elbow can move the fingers onto a higher tread.
        if (raised && checkTreads)
          clearGround(bn, wrist, 0.30, shoulder, P[a].p, 0.55, -Infinity, checkTreads, state);
        limitElbow(B['upper_arm_' + side], bn, wrist);
      }
    }
    if (revised) {
      placeFoot(R, 'L'); placeFoot(R, 'R');
      clearHead(R);
      clearRailSkin(R);
      const lift = supportTrunk(R);
      // A tread can lift a previously clear hand into the bottom of a post.
      if (lift >= R.railEntryLift) clearRailSkin(R);
      const settling=R.rest>.50 && lift>0;
      if (settleArms && (R.armFit || settling) && game.subway?.meta) {
        for (const side of ['L','R']) {
          if (settling) settleShoulder(R,side,dt);
          const fit=R.armFit?.[side];
          if (!fit) continue;
          if (!settling) fit.angle=0;
          if (!fit.angle && fit.releasing) releaseArm(R,side,fit,dt);
        }
      }
      if (game.subway?.units?.size) { trackWrist(R,'L',dt); trackWrist(R,'R',dt); }
    }
  }

  // ---------------------------------------------------------------- the hit's feel: sound, hit-stop, camera, the car, the bystanders
  function thud(sp) {
    const s = game.sound; if (!s || !s.on || !s.ac) return; const a = s.ac, t = a.currentTime, k = Math.min(1, 0.35 + sp / 22);
    // ragdoll lane, Nov 17: the thud's layers add up to more than full scale on a fast hit (rendered: 1.07 at 60 km/h with two bodies, 1.10 at 90 with one) and the game's
    // sound bus has no limiter, so the loudest thuds were squared off. All of it now goes through a rounded ceiling of its own: nothing over 0.84 of full scale reaches the speakers.
    if (S._thAc !== a) { S._thAc = a; const sh = a.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let q = 0; q < n; q++) { const x = (q / (n - 1)) * 2 - 1; c[q] = 1.05 * Math.tanh(1.6 * x) / Math.tanh(1.6); } sh.curve = c; const inb = a.createGain(); inb.gain.value = 0.6; inb.connect(sh); sh.connect(s.out); S._thBus = inb; }
    const bus = S._thBus;
    const osc = (f0, f1, dur, vol, type) => { const o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02); };
    const noise = (dur, vol, type, f, t0 = 0) => { const n = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(); n.buffer = s.white; fl.type = type; fl.frequency.value = f; g.gain.setValueAtTime(vol, t + t0); g.gain.exponentialRampToValueAtTime(0.001, t + t0 + dur); n.connect(fl); fl.connect(g); g.connect(bus); n.start(t + t0, Math.random()); n.stop(t + t0 + dur + 0.02); };
    osc(95, 38, 0.22, 0.95 * k, 'sine'); osc(170, 60, 0.09, 0.5 * k, 'triangle');      // the body of the thud
    noise(0.07, 0.8 * k, 'lowpass', 900); noise(0.035, 0.45 * k, 'bandpass', 2600);     // the slap on the panel
    if (sp > 9) noise(0.25, 0.25 * k, 'bandpass', 420, 0.05);                            // the roll over the bonnet
  }
  function shout(dist, delay) {     // a short cry: a voice-like glide through two formants
    const s = game.sound; if (!s || !s.on || !s.ac) return; const a = s.ac, t = a.currentTime + delay, f0 = 260 + Math.random() * 300, dur = 0.35 + Math.random() * 0.45, vol = 0.22 / (1 + dist * dist / 60);
    const o = a.createOscillator(), g = a.createGain(), f1 = a.createBiquadFilter(), f2 = a.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.5 + Math.random() * 0.5), t + dur * 0.35); o.frequency.linearRampToValueAtTime(f0 * 1.2, t + dur);
    f1.type = 'bandpass'; f1.frequency.value = 850 + Math.random() * 300; f1.Q.value = 4; f2.type = 'bandpass'; f2.frequency.value = 2600; f2.Q.value = 5; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(s.out); o.start(t); o.stop(t + dur + 0.05);
  }
  function scatter(x, y) {
    let n = 0;
    if (game.peds) for (const q of game.peds.list) { if (q.state !== 'walk') continue; const dx = q.x - x, dy = q.y - y, d = Math.hypot(dx, dy); if (d > 15 || d < 0.01) continue; q.state = 'flee'; q.t = -0.8 - Math.random(); q.fx = dx / d; q.fy = dy / d; try { game.peds.setAnim(q, 'run'); } catch (e) {} if (n++ < 3) shout(d, 0.12 + Math.random() * 0.5); }
    const sim = game.crowd && game.crowd.sim; if (sim && sim.agents) for (const a of sim.agents) { if (!a || a.gone || a.state === 'down' || a.state === 'flee' || a.state === 'sit') continue; const dx = a.x - x, dy = a.y - y, d = Math.hypot(dx, dy); if (d > 15 || d < 0.01) continue;
      try { sim.leaveGroup(a); if (a.state === 'stand') sim.nStand--; if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } a.state = 'flee'; a.t = -0.8 - Math.random(); a.vx = dx / d; a.vy = dy / d; sim.setClip(a, sim.jog); } catch (e) {} if (n++ < 3) shout(d, 0.12 + Math.random() * 0.5); }
  }
  const onHit = game.onPedHit.bind(game);
  game.onPedHit = (p, v) => {
    onHit(p, v);
    if (!S.on) return;
    if (v !== game.player.vehicle) {
      if (revised && game.vehicles.includes(v)) start(p, v);
      return;
    }
    try { const sp = Math.hypot(v.vx, v.vy), R = start(p, v); S.hits++; if (!R) return;
      thud(sp); scatter(p.x, p.y);
      // lead, Nov 11, second public report on this ("when i hit someone in a car it freezes the game", trace 20261111203010-3c7536: the car ploughed
      // into a plaza crowd, 66 -> 47 km/h in 0.2 s over three hits, each one also holding the whole world still): NO hit-stop any more, and the
      // car gives up speed once per half second at most, so a crowd slows it like a crowd and never stops the game. (was: hitstop up to 85 ms, 3-10% a hit)
      S.hitstop = 0;
      game.cam.shake = Math.min(0.6, (game.cam.shake || 0) + 0.15 + sp * 0.012);                      // the camera takes the knock
      const nowT = game.t || 0, lose = nowT - (S.lostAt || -9) > 0.5 ? Math.min(0.05, 0.02 + sp * 0.0015) : 0; if (lose) S.lostAt = nowT; v.vx *= 1 - lose; v.vy *= 1 - lose; v.pitch = (v.pitch || 0) + Math.min(0.05, sp * 0.003);    // the car feels it: a little speed gone, the nose dips
    } catch (e) { console.warn('[pedhit]', e); }
  };
  // hit-stop: the game's fixed step is skipped while it lasts
  const gstep = game.step.bind(game); game.step = (dt) => { if (S.hitstop > 0) { S.hitstop -= dt; return; } gstep(dt); };
  // once a drawn frame, after the game has placed everything
  let last = performance.now(), acc = 0;
  // Use the same vehicle dimensions and pose history as the awake solver.
  // Include the swept joint radius so a fast bumper can wake the body on this frame.
  function reachesSleeper(R, e, span, traffic) {
    const last = poseOf.get(e);
    const vx = traffic ? Math.cos(e.h) * e.v : e.vx;
    const vy = traffic ? Math.sin(e.h) * e.v : e.vy;
    const known = last && last.n === stamp;
    const dx = known ? e.x - last.x : (vx || 0) * span;
    const dy = known ? e.y + last.z : (vy || 0) * span;
    const turn = known ? Math.abs(Math.atan2(Math.sin(e.h-last.h), Math.cos(e.h-last.h))) : 0;
    if (!(dx || dy || turn) && last?.placedAt !== stamp) return false;
    const hp = R.P.hips.p;
    const reach = Math.hypot(e.def?.len || 5, e.def?.wid || 2) / 2 + 2;
    if (Math.abs(e.x-hp.x) > reach+Math.abs(dx) || Math.abs(e.y+hp.z) > reach+Math.abs(dy)) return false;
    const shape = shapeOf(e.def), c = Math.cos(e.h), s = Math.sin(e.h);
    const df = dx*c + dy*s, ds = -dx*s + dy*c;
    const turnPad = turn * reach;
    for (const k of PTS) {
      const a = R.P[k], r = a.r + turnPad;
      if (a.p.y-a.r > shape.top) continue;
      const x = a.p.x-e.x, y = -a.p.z-e.y;
      const f = x*c + y*s, side = -x*s + y*c;
      if (Math.min(f,f+df) <= shape.xf+r && Math.max(f,f+df) >= shape.xb-r &&
          Math.min(side,side+ds) <= shape.W+r && Math.max(side,side+ds) >= -shape.W-r) return true;
    }
    return false;
  }
  const STAY = game.P?.get('bodystay') !== '0', _vw = new THREE.Vector3();
  const inView = (p, cam) => { if (p.distanceTo(cam) > 70) return false; _vw.copy(p).project(world.camera); return Math.abs(_vw.x) < 1.05 && Math.abs(_vw.y) < 1.1 && _vw.z < 1; };
  S.update = (dt) => {
    if (!S.list.length) { stamp++; return; } acc = Math.min(acc + dt, 0.1); const n = Math.floor(acc / SUB); acc -= n * SUB; const cam = world.camera.position;
    for (let i = S.list.length - 1; i >= 0; i--) { const R = S.list[i]; R.t += dt;
      if (R.fig.ped) { const p = R.fig.ped; if (p.state !== 'down') { restoreFeet(R); S.list.splice(i, 1); continue; } p.t = Math.min(p.t, 5); p.vx = p.vy = 0; p.fall = 0; p.x = R.P.hips.p.x; p.y = -R.P.hips.p.z; }
      // ragdoll lane, Nov 17: a body went after 25 s wherever it lay, also in the middle of the picture in front of a player who had got out to look. Now a body the
      // camera is looking at from within 70 m stays (80 s at most: the ambulance crew takes a body by setting its clock to 99 (ems.js), which must still remove it at once); out of sight it goes after 25 s as before. ?bodystay=0 = as before.
      if (R.P.hips.p.distanceTo(cam) > 140 || (R.t > 25 && (!STAY || R.t > 80 || !inView(R.P.hips.p, cam)))) { release(R); S.list.splice(i, 1); continue; }
      // a body at rest wakes when one of the player's cars comes at it: asleep, the car drove into it and stood in it (node run: the car rolled back 6 m onto the body it had thrown); awake it is pushed along or aside like any struck body, and the walls hold it
      if (R.frozen) {
        const hp = R.P.hips.p;
        const approaching = revised
          ? game.vehicles.some(e => e !== R.restCar?.e && reachesSleeper(R, e, n * SUB, false)) ||
            game.traffic?.cars.some(e => e !== R.restCar?.e && reachesSleeper(R, e, n * SUB, true))
          : game.vehicles.some(e => Math.abs(e.x-hp.x)<4.5 && Math.abs(e.y+hp.z)<4.5 && Math.abs(e.vx)+Math.abs(e.vy)>0.5);
        if (approaching) {
          R.frozen = false;
          R.rest = 0;
          R.panelRest = null;
          for (const k of PTS) R.P[k].q.copy(R.P[k].p);
        }
      }
      let panelMoved = false;
      if (R.frozen && R.restCar) {
        const {e, x, y, h} = R.restCar;
        const exists = game.vehicles.includes(e) || game.traffic?.cars.includes(e) ||
          game.parked?.near?.(x, y, 12, []).includes(e);
        // Below 1.5 cm of accumulated panel displacement keep the settled contact.
        // Measure from the original sleep pose so a slowly departing car still wakes it.
        const turn = Math.abs(Math.atan2(Math.sin(e.h - h), Math.cos(e.h - h)));
        const displacement = Math.hypot(e.x-x, e.y-y) + turn * Math.hypot(e.def?.len || 4.6, e.def?.wid || 1.9) / 2;
        if (!exists || displacement > 0.015) {
          R.frozen = false;
          R.rest = 0;
          R.panelRest = null;
          for (const k of PTS) R.P[k].q.copy(R.P[k].p);
        } else {
          const anchor = R.restCar;
          if (anchor.lastX !== e.x || anchor.lastY !== e.y || anchor.lastH !== e.h) {
            // Apply only this frame's panel transform. The departure test above
            // still measures cumulative travel from the original sleep pose.
            const angle = e.h - anchor.lastH, c = Math.cos(angle), s = Math.sin(angle);
            for (const k of PTS) {
              const joint = R.P[k], dx = joint.p.x - anchor.lastX, dz = joint.p.z + anchor.lastY;
              joint.p.x = e.x + c * dx + s * dz;
              joint.p.z = -e.y - s * dx + c * dz;
              joint.q.copy(joint.p);
            }
            anchor.lastX = e.x;
            anchor.lastY = e.y;
            anchor.lastH = e.h;
            panelMoved = true;
          }
        }
      }
      if (!R.frozen && n) {
        R.restCar = null;
        roadX = R.P.hips.p.x;
        roadZ = R.P.hips.p.z;
        clearRoad = revised && !game.subway?.units?.size &&
          game.statics.mayOverlapSidewalk?.(roadX, -roadZ, roadRadius) === false;
        carBoxes(R.P.hips.p, n * SUB);
        let vm = 0;
        for (let k = 0; k < n; k++) {
          carsAt(k, n);
          vm = step(R, SUB);
          if (S.probe) S.probe(R);
        }
        if (revised) {
          const anchor = R.restPose || (R.restPose = PTS.map(k => R.P[k].p.clone()));
          const quiet = PTS.every((k, i) => R.P[k].p.distanceToSquared(anchor[i]) < 0.0001);
          if (quiet) R.rest += n * SUB;
          else {
            R.rest = 0;
            for (let i = 0; i < PTS.length; i++) anchor[i].copy(R.P[PTS[i]].p);
          }
        } else R.rest = vm < 0.25 ? R.rest + dt : 0;
        if (revised && R.support) {
          const e = R.support, hp = R.P.hips.p, chest = R.P.chest.p;
          // A stationary panel can bear weight through the arms or legs.
          // Require sustained contact and a stable trunk before suspending this island.
          const mark = R.panelRest;
          if (!mark || mark.e !== e || Math.hypot(e.x-mark.x,e.y-mark.y) > 0.015 ||
              Math.abs(e.h-mark.h) > 0.002 || hp.distanceToSquared(mark.hip) > 0.0025 ||
              chest.distanceToSquared(mark.chest) > 0.0025) {
            R.panelRest = {e, x:e.x, y:e.y, h:e.h, hip:hp.clone(), chest:chest.clone(), t:0};
          } else if ((mark.t += n * SUB) > 1.2) R.rest = Math.max(R.rest, 1);
        } else R.panelRest = null;
        if (R.rest > 0.9 && R.t > 1.5) {
          if (revised && R.support) {
            const e = R.support;
            R.restCar = {e, x:e.x, y:e.y, h:e.h, lastX:e.x, lastY:e.y, lastH:e.h};
          }
          R.frozen = !!R.restCar || R.P.hips.p.y < floor(R.P.hips) + 0.5;
          // A body caught across an entrance can rest head-down on a tread
          // with the pelvis suspended above it. Require actual floor contact.
          if (revised && !R.frozen && game.subway?.units?.size &&
              R.P.chest.p.y < floor(R.P.chest) + 0.5) {
            R.frozen = PTS.some(k => {
              const joint = R.P[k];
              return Math.abs(joint.p.y - joint.r - floor(joint)) < .001;
            });
          }
        }
      }
      if (revised && R.frozen) {
        R.root.updateWorldMatrix(true, false);
        // Traffic and rider code can reposition the figure's parent while its joints sleep.
        if (panelMoved || !R.restRoot || !R.restRoot.equals(R.root.matrixWorld)) {
          pose(R,R.restRoot ? 0 : dt);
          (R.restRoot ||= new THREE.Matrix4()).copy(R.root.matrixWorld);
        }
      } else {
        R.restRoot = null;
        pose(R,dt);
      } }
    if (n) keepPoses();
  };
  const render = world.render.bind(world); world.render = (t, f) => { const now = performance.now(), dt = game.capture ? 1 / 60 : Math.min(0.1, (now - last) / 1000);      /* was 0.05: at 15 frames a second the body ran at three quarters speed beside a car at full speed */ last = now; if (!game.paused) S.update(dt); if (S.glass && S.glass.on) { try { S.glass.update(); } catch (e) {} } return render(t, f); };
  return S;
}
