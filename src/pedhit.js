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
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MAX = 7, G = 9.81, SUB = 1 / 120;
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

  // ---------------------------------------------------------------- the simulation
  const boxes = [];
  function carBoxes(c) {
    boxes.length = 0; const add = (e, vx, vy) => { if (Math.abs(e.x - c.x) > 14 || Math.abs(e.y + c.z) > 14) return; const d = e.def || {}; boxes.push({ x: e.x, z: -e.y, ch: Math.cos(e.h), sh: Math.sin(e.h), L: (d.len || 4.6) / 2, W: (d.wid || 1.9) / 2, H: d.hgt || 1.4, vx, vz: -vy }); };
    for (const e of game.vehicles) add(e, e.vx, e.vy);
    if (game.traffic) for (const e of game.traffic.cars) add(e, Math.cos(e.h) * (e.v || 0), Math.sin(e.h) * (e.v || 0));
    if (game.parked && game.parked.near) for (const e of game.parked.near(c.x, -c.z, 12, [])) add(e, 0, 0);
  }
  function step(R, h) {
    const P = R.P; let vmax = 0;
    for (const k of PTS) { const a = P[k], vx = (a.p.x - a.q.x), vy = (a.p.y - a.q.y), vz = (a.p.z - a.q.z); a.q.copy(a.p); a.p.x += vx * 0.999; a.p.y += vy * 0.999 - G * h * h; a.p.z += vz * 0.999; }
    for (let it = 0; it < 7; it++) {
      for (const [a, b, L] of R.sticks) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6, e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
      for (const [a, b, L] of R.apart) { _v.copy(b.p).sub(a.p); const d = _v.length() || 1e-6; if (d >= L) continue; const e = (d - L) / d / (a.im + b.im); a.p.addScaledVector(_v, e * a.im); b.p.addScaledVector(_v, -e * b.im); }
    }
    for (const k of PTS) { const a = P[k];
      // other cars and our own: out through the nearest face; a point pushed by a face takes the car's speed, one on the roof is carried
      for (const c of boxes) { const dx = a.p.x - c.x, dz = a.p.z - c.z, f = dx * c.ch - dz * c.sh, s = dx * c.sh + dz * c.ch, top = (Math.abs(f) < c.L * 0.45 ? c.H : c.H * 0.64);
        const pf = c.L + a.r - Math.abs(f), ps = c.W + a.r - Math.abs(s), pt = top + a.r - a.p.y; if (pf <= 0 || ps <= 0 || pt <= 0) continue;
        if (pt < pf && pt < ps) { a.p.y += pt; a.q.x += (a.p.x - a.q.x - c.vx * h) * 0.35; a.q.z += (a.p.z - a.q.z - c.vz * h) * 0.35; a.q.y = Math.max(a.q.y, a.p.y - 0.02 * h); }
        else { const along = pf < ps, sg = Math.sign(along ? f : s) || 1, nx = along ? c.ch * sg : c.sh * sg, nz = along ? -c.sh * sg : c.ch * sg, pen = along ? pf : ps; a.p.x += nx * pen; a.p.z += nz * pen;
          const vn = (a.p.x - a.q.x) * nx + (a.p.z - a.q.z) * nz, cn = (c.vx * nx + c.vz * nz) * h; if (vn < cn) { a.q.x -= (cn - vn) * nx; a.q.z -= (cn - vn) * nz; } } }
      // walls, posts, hydrants (the game's own 2D collision map), below the height of a storey
      if (a.p.y < 3.2 && game.statics.resolve(a.p.x, -a.p.z, a.r, _o)) { const nx = _o.x - a.p.x, nz = -_o.y - a.p.z; a.p.x = _o.x; a.p.z = -_o.y; a.q.x += nx * 0.7; a.q.z += nz * 0.7; }
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
      S.hitstop = sp > 5 ? Math.min(0.085, 0.03 + sp * 0.0028) : 0;                              // a few frames held still on the hit
      game.cam.shake = Math.min(1, (game.cam.shake || 0) + 0.3 + sp * 0.022);                      // the camera takes the knock
      const lose = Math.min(0.1, 0.03 + sp * 0.003); v.vx *= 1 - lose; v.vy *= 1 - lose; v.pitch = (v.pitch || 0) + Math.min(0.05, sp * 0.003);    // the car feels it: a little speed gone, the nose dips
    } catch (e) { console.warn('[pedhit]', e); }
  };
  // hit-stop: the game's fixed step is skipped while it lasts
  const gstep = game.step.bind(game); game.step = (dt) => { if (S.hitstop > 0) { S.hitstop -= dt; return; } gstep(dt); };
  // once a drawn frame, after the game has placed everything
  let last = performance.now(), acc = 0;
  S.update = (dt) => {
    if (!S.list.length) return; acc = Math.min(acc + dt, 0.05); const n = Math.floor(acc / SUB); acc -= n * SUB; const cam = world.camera.position;
    for (let i = S.list.length - 1; i >= 0; i--) { const R = S.list[i]; R.t += dt;
      if (R.fig.ped) { const p = R.fig.ped; if (p.state !== 'down') { S.list.splice(i, 1); continue; } p.t = Math.min(p.t, 5); p.vx = p.vy = 0; p.fall = 0; p.x = R.P.hips.p.x; p.y = -R.P.hips.p.z; }
      if (R.t > 25 || R.P.hips.p.distanceTo(cam) > 140) { release(R); S.list.splice(i, 1); continue; }
      if (!R.frozen) { carBoxes(R.P.hips.p); let vm = 0; for (let k = 0; k < n; k++) vm = step(R, SUB); if (n) { R.rest = vm < 0.25 ? R.rest + dt : 0; if (R.rest > 0.9 && R.t > 1.5) R.frozen = true; } }
      pose(R); }
  };
  const render = world.render.bind(world); world.render = (t, f) => { const now = performance.now(), dt = game.capture ? 1 / 60 : Math.min(0.05, (now - last) / 1000); last = now; if (!game.paused) S.update(dt); return render(t, f); };
  return S;
}
