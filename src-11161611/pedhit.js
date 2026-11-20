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
import { shapeOf, pushOut, topAt } from './carshape.js';
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
    for (const k of PTS) { const bn = B[BONE_OF[k]]; const w = bn ? bn.getWorldPosition(new THREE.Vector3()) : B.hips.getWorldPosition(new THREE.Vector3());
      if (k === 'head' && B.neck) { const nk = B.neck.getWorldPosition(_v); w.add(_a.copy(w).sub(nk).setLength(0.11)); }
      // the bumper takes the legs first: low points get the car's full speed, the head lags, so the body wraps onto the bonnet
      const hgt = THREE.MathUtils.clamp(w.y / 1.7, 0, 1), k1 = (1.12 - 0.42 * hgt) * (0.9 + 0.2 * Math.random());
      const vel = cv.clone().multiplyScalar(k1 * sh).addScaledVector(right, side * (0.5 + 1.2 * Math.random()) * Math.min(1, sp / 8)); vel.y = lift * (0.75 + 0.5 * hgt) + 0.6 * Math.random();
      R.P[k] = { p: w.clone(), q: w.clone().addScaledVector(vel, -SUB), r: RAD[k], im: 1 / MASS[k], k }; }
    try { startSafe(R.P, p.x, p.y); } catch (e) {}
    for (const [a, b] of STICKS) R.sticks.push([R.P[a], R.P[b], R.P[a].p.distanceTo(R.P[b].p)]);
    R.apart = APART.map(([a, b, d]) => [R.P[a], R.P[b], Math.min(d, R.P[a].p.distanceTo(R.P[b].p) * 0.9)]);
    // the pose at the moment of the hit: the torso's frame, each limb's direction and its bone's attitude
    R.M0i = torso(R, new THREE.Matrix4()).invert(); R.q0 = {}; for (const n in B) R.q0[n] = B[n].getWorldQuaternion(new THREE.Quaternion());
    R.d0 = {}; for (const [bone, a, b] of LIMBS) R.d0[bone] = R.P[b].p.clone().sub(R.P[a].p).normalize();
    R.h0 = B.hips.getWorldPosition(new THREE.Vector3()).sub(R.P.hips.p);
    if (fig.ped && fig.ped.vis.mixer) fig.ped.vis.mixer.timeScale = 0;
    S.list.push(R); while (S.list.length > MAX) release(S.list.shift());
    return R;
  }
  function torso(R, m) {       // the body's frame from hips, chest and the two hip joints
    const P = R.P, x = _a.copy(P.hpR.p).sub(P.hpL.p), y = _b.copy(P.chest.p).sub(P.hips.p).normalize(); x.addScaledVector(y, -x.dot(y)); if (x.lengthSq() < 1e-8) x.set(1, 0, 0); x.normalize(); const z = _c.crossVectors(x, y);
    return m.makeBasis(x, y, z);
  }
  function release(R) {
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
      if ((s[0] < x0 && s[2] < x0) || (s[0] > x1 && s[2] > x1) || (s[1] < y0 && s[3] < y0) || (s[1] > y1 && s[3] > y1)) continue; if (y >= LOWH && !tall(s)) continue; cand.push(s); } }
    return cand.length; }
  // the first of those lines the move crosses: _h.t in [0, 1), _h.s the line; false if none
  function first(ax, ay, bx, by) { const rx = bx - ax, ry = by - ay; let best = 2, bs = null;
    for (const s of cand) { const sx = s[2] - s[0], sy = s[3] - s[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-14) continue; const t = ((s[0] - ax) * sy - (s[1] - ay) * sx) / den, u = ((s[0] - ax) * ry - (s[1] - ay) * rx) / den; if (t >= 0 && t <= 1 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) { best = t; bs = s; } }
    _h.t = best; _h.s = bs; return bs !== null; }
  // one point's move this step, from where it stood (a.q) to where it has been put (a.p), made safe against the walls. Map metres: (x, -z).
  function walls(a) {
    // (a.sx, a.sz) is where the point stood after the last step. a.q is NOT that any more: the cars and posts above have already written
    // the speed they give the point into it (a point riding a van's roof into a wall got through on that: 9 of 60 at one spot in the node run)
    const qx = a.sx, qy = -a.sz; let px = a.p.x, py = -a.p.z; if (!near(qx, qy, px, py, a.r, a.p.y)) return;
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
  function posts(a) { if (!st || !st.circ) return; const c = st.cell || 16, x = a.p.x, y = -a.p.z, r = a.r;
    for (let ci = Math.floor((x - r) / c); ci <= Math.floor((x + r) / c); ci++) for (let cj = Math.floor((y - r) / c); cj <= Math.floor((y + r) / c); cj++) { const L = st.circ.get(st.key(ci, cj)); if (L) for (const o of L) { if (!o.on) continue; const ex = -a.p.z - o.y, dx = a.p.x - o.x, d = Math.hypot(dx, ex), R = r + o.r;
      if (d < R && d > 1e-6) { const k = (R - d) / d, mx = dx * k, mz = -ex * k; a.p.x += mx; a.p.z += mz; a.q.x += mx * 0.7; a.q.z += mz * 0.7; } } } }
  // a person standing at a wall may have a hand or an elbow across its line at the moment of the hit: every point starts on the person's side
  function startSafe(P, ax, ay) { for (const k of PTS) { const a = P[k], bx = a.p.x, by = -a.p.z; if (!near(ax, ay, bx, by, a.r, a.p.y) || !first(ax, ay, bx, by)) continue; const t = Math.max(0, _h.t - 0.06 / (Math.hypot(bx - ax, by - ay) || 1e-9)), nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t, mx = nx - bx, my = ny - by;
      a.p.x = nx; a.p.z = -ny; a.q.x += mx; a.q.z -= my; } }

  // ---------------------------------------------------------------- the simulation
  // ---- CAR SHAPES block 1 of 3: the cars near a body, each with its outline and its place a step ago and now
  const boxes = [], poseOf = new WeakMap(), _po = { f: 0, y: 0, nf: 0, ny: 0 }; let stamp = 0;
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
  function step(R, h) {
    const P = R.P; let vmax = 0;
    for (const k of PTS) { const a = P[k], vx = (a.p.x - a.q.x), vy = (a.p.y - a.q.y), vz = (a.p.z - a.q.z); a.q.copy(a.p); a.sx = a.p.x; a.sz = a.p.z; a.sy = a.p.y; a.p.x += vx * 0.999; a.p.y += vy * 0.999 - G * h * h; a.p.z += vz * 0.999; }
    for (let it = 0; it < 7; it++) {
      for (const [a, b, L] of R.sticks) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6, e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
      for (const [a, b, L] of R.apart) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6; if (d >= L) continue; const e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
    }
    for (const k of PTS) { const a = P[k];
      // ---- CAR SHAPES block 2 of 3: our own car and the others, each as its outline, in the car's moving frame (see CAR SHAPES at the top)
      for (const c of boxes) { const S2 = c.S, r = a.r, dx = a.p.x - c.bx, dz = a.p.z - c.bz, f = dx * c.bch - dz * c.bsh, s = dx * c.bsh + dz * c.bch, W = S2.W;
        if (Math.abs(s) >= W + r || f > S2.xf + r || f < S2.xb - r || a.p.y > S2.top + r) continue;
        const ex = a.sx - c.ax, ez = a.sz - c.az, f0 = ex * c.ach - ez * c.ash, s0 = ex * c.ash + ez * c.ach, dp = pushOut(S2, f, a.p.y, r, f0, a.sy, _po); if (!dp) continue;
        let F = _po.f, Sd = s, Y = _po.y, nf = _po.nf, ns = 0, ny = _po.ny; const ps = W + r - Math.abs(s);
        // out through the side if that is where it came from, or if it was inside a moment ago too and the side is nearer
        if (Math.abs(s0) >= W + r - 0.002 || (ps < dp && (() => { const t0 = topAt(S2, f0); return t0 >= 0 && a.sy < t0; })())) { const sg = Math.sign(s) || 1; F = f; Y = a.p.y; Sd = sg * (W + r); nf = 0; ny = 0; ns = sg; }
        const X = c.bx + F * c.bch + Sd * c.bsh, Z = c.bz - F * c.bsh + Sd * c.bch, nX = nf * c.bch + ns * c.bsh, nZ = -nf * c.bsh + ns * c.bch;
        // the panel's own move in this step at that place, and the point's move against it: nothing into the panel, friction along it
        const pcx = X - (c.ax + F * c.ach + Sd * c.ash), pcz = Z - (c.az - F * c.ash + Sd * c.ach); let wx = a.p.x - a.q.x - pcx, wy = a.p.y - a.q.y, wz = a.p.z - a.q.z - pcz;      /* (its speed as it came, not counting the push back out of the panel) */ const wn = wx * nX + wy * ny + wz * nZ;
        if (wn < 0) { const j = -wn * (1 + CAR_REST); wx += nX * j; wy += ny * j; wz += nZ * j; const d = wx * nX + wy * ny + wz * nZ, tx = wx - d * nX, ty = wy - d * ny, tz = wz - d * nZ, tl = Math.hypot(tx, ty, tz); if (tl > 1e-9) { const k = Math.min(1, CAR_MU * j / tl); wx -= tx * k; wy -= ty * k; wz -= tz * k; } }
        a.p.x = X; a.p.y = Y; a.p.z = Z; a.q.x = X - wx - pcx; a.q.y = Y - wy; a.q.z = Z - wz - pcz; }
      // ---- end of CAR SHAPES block 2
      // posts and hydrants below the height of a storey, then the walls: the whole move of this step is swept (see WALLS at the top)
      if (a.p.y < 3.2) posts(a);
      walls(a);
      // the ground (the pavement stands 15 cm above the road), with friction that lets a body roll and then stop
      const gy = (game.statics.onSidewalk(a.p.x, -a.p.z) ? 0.15 : 0) + a.r;
      if (a.p.y < gy) { const vy = a.p.y - a.q.y; a.p.y = gy; a.q.y = gy + vy * 0.25; a.q.x += (a.p.x - a.q.x) * 0.22; a.q.z += (a.p.z - a.q.z) * 0.22; }
      vmax = Math.max(vmax, a.p.distanceTo(a.q) / h); }
    return vmax;
  }
  function pose(R) {            // the points drive the figure's own skeleton
    const B = R.B, P = R.P, root = R.root; root.updateMatrixWorld(true);
    const Rm = torso(R, _m).multiply(R.M0i), Rq = _q2.setFromRotationMatrix(Rm);
    // hips: where the hip point is, turned as the torso has turned since the hit
    const hq = new THREE.Quaternion().copy(Rq).multiply(R.q0.hips), hp = _v.copy(R.h0).applyQuaternion(Rq).add(P.hips.p), par = B.hips.parent;
    _m2.copy(par.matrixWorld).invert(); B.hips.position.copy(hp).applyMatrix4(_m2); B.hips.quaternion.copy(par.getWorldQuaternion(_q).invert()).multiply(hq); B.hips.updateMatrixWorld(true);
    for (const [bone, a, b] of LIMBS) { const bn = B[bone]; if (!bn) continue; const d = _a.copy(P[b].p).sub(P[a].p).normalize(), d0 = _b.copy(R.d0[bone]).applyQuaternion(Rq);
      const wq = new THREE.Quaternion().setFromUnitVectors(d0, d).multiply(Rq).multiply(R.q0[bone]); bn.quaternion.copy(bn.parent.getWorldQuaternion(_q).invert()).multiply(wq); bn.updateMatrixWorld(true); }
  }

  // ---------------------------------------------------------------- the hit's feel: sound, hit-stop, camera, the car, the bystanders
  function thud(sp) {
    const s = game.sound; if (!s || !s.on || !s.ac) return; const a = s.ac, t = a.currentTime, k = Math.min(1, 0.35 + sp / 22);
    const osc = (f0, f1, dur, vol, type) => { const o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(s.out); o.start(t); o.stop(t + dur + 0.02); };
    const noise = (dur, vol, type, f, t0 = 0) => { const n = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(); n.buffer = s.white; fl.type = type; fl.frequency.value = f; g.gain.setValueAtTime(vol, t + t0); g.gain.exponentialRampToValueAtTime(0.001, t + t0 + dur); n.connect(fl); fl.connect(g); g.connect(s.out); n.start(t + t0, Math.random()); n.stop(t + t0 + dur + 0.02); };
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
    onHit(p, v); if (!S.on || v !== game.player.vehicle) return;
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
  S.update = (dt) => {
    if (!S.list.length) { stamp++; return; } acc = Math.min(acc + dt, 0.1); const n = Math.floor(acc / SUB); acc -= n * SUB; const cam = world.camera.position;
    for (let i = S.list.length - 1; i >= 0; i--) { const R = S.list[i]; R.t += dt;
      if (R.fig.ped) { const p = R.fig.ped; if (p.state !== 'down') { S.list.splice(i, 1); continue; } p.t = Math.min(p.t, 5); p.vx = p.vy = 0; p.fall = 0; p.x = R.P.hips.p.x; p.y = -R.P.hips.p.z; }
      if (R.t > 25 || R.P.hips.p.distanceTo(cam) > 140) { release(R); S.list.splice(i, 1); continue; }
      // a body at rest wakes when one of the player's cars comes at it: asleep, the car drove into it and stood in it (node run: the car rolled back 6 m onto the body it had thrown); awake it is pushed along or aside like any struck body, and the walls hold it
      if (R.frozen) { const hp = R.P.hips.p; for (const e of game.vehicles) if (Math.abs(e.x - hp.x) < 4.5 && Math.abs(e.y + hp.z) < 4.5 && Math.abs(e.vx) + Math.abs(e.vy) > 0.5) { R.frozen = false; R.rest = 0; for (const k of PTS) R.P[k].q.copy(R.P[k].p); break; } }
      if (!R.frozen) { carBoxes(R.P.hips.p, n * SUB); let vm = 0; for (let k = 0; k < n; k++) { carsAt(k, n);      /* CAR SHAPES block 3 of 3 (with keepPoses below and the 0.1 s frame caps) */ vm = step(R, SUB); if (S.probe) S.probe(R); }      /* S.probe: the lane's test (people-state/wall/tools/hits.mjs) looks at every step; nothing sets it in the game */ if (n) { R.rest = vm < 0.25 ? R.rest + dt : 0; if (R.rest > 0.9 && R.t > 1.5 && R.P.hips.p.y < (game.statics.onSidewalk(R.P.hips.p.x, -R.P.hips.p.z) ? 0.65 : 0.5)) R.frozen = true;      /* a body lying on a bonnet or a roof is never frozen: frozen there it stayed in the air when the car drove off (6 of 300 in the node run before the wall fix, 16 after it: more bodies now drop back onto the car that hit them) */ } }
      pose(R); }
    if (n) keepPoses();
  };
  const render = world.render.bind(world); world.render = (t, f) => { const now = performance.now(), dt = game.capture ? 1 / 60 : Math.min(0.1, (now - last) / 1000);      /* was 0.05: at 15 frames a second the body ran at three quarters speed beside a car at full speed */ last = now; if (!game.paused) S.update(dt); return render(t, f); };
  return S;
}
