// moto/mototraffic.js (gameplay lane; hand-over 2 of the motorcycle): riders in traffic, taking a bike from one, being shot on the bike.
// Fetched by moto.js after the game is playable (its TRAFFIC switch); ?mototraffic=0 leaves it out.
//   - Riders in traffic: some of the cars the traffic code spawns become motorcycles (same lane rules, a 2 m body instead of a 4.7 m one). The
//     traffic file is not touched: traffic.spawn is wrapped. Each has a rider: a figure of the game's own people frozen in the riding pose
//     (instances, as the lead's drivers are), leaning with the bike; a foot down when it stands.
//   - F at a rider who is standing in traffic: the player walks round to the bike's side, takes him by the arm and hauls him off (the lead's
//     ragdoll; he gets up and runs), then gets on. It is a crime with witnesses, as taking a car is.
//   - Police bullets that reach the bike while the player rides it hit the rider: there is no body to sit behind.
import * as THREE from 'three';
import { clamp, wrapPi } from '../geo.js';
import { TUNE } from './motophys.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), _v = V3(), _v2 = V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _e = new THREE.Euler(), ONE = V3(1, 1, 1), _o = {}, SUB = 1 / 120;
const ss = (u, a, b) => { u = clamp((u - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

export async function install(g, M, POSE) {
  const pl = g.player, P = g.P, TR = g.traffic, st = g.statics, I = M.int, DEF = I.DEF, kerb = I.kerb;
  const SHARE = +(P.get('motoshare') || 0.07); let seed = 4711; const rr = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  M.npcs = []; M.stats.jacks = 0; M.stats.riders = 0;
  let EntryRig = null; try { EntryRig = (await import('../entry/rig.js')).EntryRig; } catch (e) { M.err('rig2', e); }

  // ---------------------------------------------------------------- some of the traffic rides
  const make = (c) => { c.type = 'moto'; c.def = DEF; c.moto = true; c.color = I.PAINTS[Math.floor(rr() * I.PAINTS.length)]; c.mlean = 0; c.mz = 0; c.mph = c.h; c.rk = Math.floor(rr() * 997); c.v0 *= 1.08; M.stats.riders++; return c; };
  const fit = (c) => c && c.type !== 'bus' && c.type !== 'moto' && !c.dbl && c.def && c.def.len < 5.6;
  if (TR && SHARE > 0) { const sp0 = TR.spawn.bind(TR); TR.spawn = function (e, dir, li, s) { const c = sp0(e, dir, li, s); if (fit(c) && rr() < SHARE) make(c); return c; };
    for (const c of TR.cars) if (fit(c) && Math.hypot(c.x - pl.x, c.y - pl.y) > 45 && rr() < SHARE) make(c); }
  // the game seats a driver figure in everything that drives: for this kind its seat is put out of sight (ours is drawn here)
  try { g.kit.seats = Object.assign({}, g.kit.seats || {}); g.kit.seats.moto = [0, 0, -90]; } catch (e) {}

  // ---------------------------------------------------------------- the rider figures: the game's people, frozen in the riding pose
  const kinds = []; try { for (const d of g.drivers || []) if (d.who && !kinds.includes(d.who)) kinds.push(d.who); if (!kinds.length && g.kit.pedKinds) for (const k of g.kit.pedKinds().slice(0, 2)) kinds.push(k); } catch (e) {}
  function bake(kind, stopped) {
    const p = g.kit.person(kind); if (!p || !p.acts.drive || !EntryRig) return null; const rig = new EntryRig(p, kind); if (!rig.ok) return null;
    p.acts.drive.play(); p.mixer.setTime(0.2); p.object.updateMatrixWorld(true);
    POSE.apply(rig, p.object, POSE.ride({ vf: stopped ? 0 : 10, lean: stopped ? TUNE.footLean : 0, steer: 0, acc: 0 }, POSE.make(), rig, 0), _m.identity(), _q.identity(), 1); p.object.updateMatrixWorld(true);
    const parts = [], v = V3();
    p.object.traverse((m) => { if (!m.isSkinnedMesh) return; m.skeleton.update(); const geo = m.geometry.clone(), pos = geo.attributes.position, arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); geo.morphAttributes = {}; geo.computeVertexNormals(); geo.computeBoundingSphere(); parts.push({ geometry: geo, material: m.material }); });
    return parts.length ? parts : null;
  }
  const CAP = 14, batches = [];
  if (typeof window !== 'undefined' && g.world.renderer && g.world.renderer.getContext) for (const k of kinds.slice(0, 2)) for (const stopped of [false, true]) { let parts = null; try { parts = bake(k, stopped); } catch (e) { M.err('bake', e); }
    if (!parts) continue; const meshes = parts.map((q) => { const im = new THREE.InstancedMesh(q.geometry, q.material, CAP); im.frustumCulled = false; im.castShadow = true; im.count = 0; im.visible = false; im.name = 'moto_rider'; im.userData.brkOwn = true; g.world.scene.add(im); return im; }); batches.push({ kind: k, stopped, meshes, n: 0 }); }
  const nk = Math.max(1, new Set(batches.map((b) => b.kind)).size);
  M.riderKinds = batches.map((b) => b.kind + (b.stopped ? ':stopped' : ''));
  M.riders = {
    begin() { for (const b of batches) b.n = 0; },
    add(c, mb, d) { if (d > 170 || !batches.length) return; const want = [...new Set(batches.map((b) => b.kind))][c.rk % nk], b = batches.find((q) => q.kind === want && q.stopped === (c.v < 0.6)) || batches[0]; if (b.n >= CAP) return; for (const im of b.meshes) im.setMatrixAt(b.n, mb); b.n++; },
    end() { for (const b of batches) for (const im of b.meshes) { im.count = b.n; im.visible = b.n > 0; if (b.n) im.instanceMatrix.needsUpdate = true; } },
  };

  // ---------------------------------------------------------------- taking a bike from its rider
  function crime() { try { const H = g.combat && g.combat.heat; if (!H) return; if (typeof H.crime === 'function') H.crime('jack', pl.x, pl.y); else if (H.queue && H.start) { H.queue.push(['jack', pl.x, pl.y]); H.start('jack'); } } catch (e) { M.err('crime', e); } }
  M.riderKind = (c) => (kinds.length ? kinds[c.rk % Math.min(kinds.length, 2)] : null);      // ragdoll lane, Nov 16: the figure this rider is drawn as (combat.js gives the same one to the body when he is shot)
  function makeNpc(c, v) { const kind = kinds.length ? kinds[c.rk % Math.min(kinds.length, 2)] : null; if (!kind || !EntryRig) return null; let vis = null; try { vis = g.kit.person(kind); } catch (e) {} if (!vis || !vis.acts.drive) return null; const rig = new EntryRig(vis, kind); if (!rig.ok) return null;
    g.world.scene.add(vis.object); vis.acts.drive.play(); vis.mixer.setTime(0.2); return { vis, rig, kind, v, c, state: 'ride', t: 0, rest: 0, pose: POSE.make(), x: v.x, y: v.y, h: v.h, z: 0, R: null, fake: null, U: null }; }
  function dropNpc(n) { try { g.world.scene.remove(n.vis.object); } catch (e) {} if (n.fake) n.fake.state = 'gone'; const i = M.npcs.indexOf(n); if (i >= 0) M.npcs.splice(i, 1); }
  M.releaseRider = (c) => {
    if (!TR.cars.includes(c)) return false;
    const v = new M.Vehicle(DEF, c.x, c.y, c.h, c.color);
    v.z = c.mz || 0; v.lean = c.mlean || 0; v.spin = c.spin || 0;
    v.vx = Math.cos(c.h)*c.v; v.vy = Math.sin(c.h)*c.v;
    v.stand = 0; v.down = v.lean < 0 ? -1 : 1;
    TR.remove(c); g.vehicles.push(v);
    return true;
  };
  M.jack = {
    begin(c) {
      if (pl.busy || M.fall) return false; TR.remove(c); const v = new M.Vehicle(DEF, c.x, c.y, c.h, c.color); v.lean = c.mlean || 0; v.held = TUNE.footLean; v.keep = true; v.spin = c.spin || 0; v.steer = c.steer || 0; v.vseed = c.id; g.vehicles.push(v);
      let way = null, side = -1; for (const sd of [-1, 1]) { way = I.wayTo(v, sd, I.SIDE_D); if (way) { side = sd; break; } }
      if (!way) { const i = g.vehicles.indexOf(v); if (i >= 0) g.vehicles.splice(i, 1); TR.cars.push(c); I.say('No way round to the bike'); M.stats.noway++; return false; }
      const npc = makeNpc(c, v); if (npc) M.npcs.push(npc);
      pl.busy = { moto: true, kind: 'in', v, t: 0, z: kerb(pl.x, pl.y), phase: 'walk', path: way.pts.length > 1 ? way.pts.slice(1) : way.pts.slice(-1), wp: 0, side, d: I.SIDE_D, u: 0, k: 0, w: 0, still: false, pp: { t: 0, n: 0, stall: 0, best: 1e9, own: way.ownPad || 0.1 }, lifted: false, h0: pl.h, jack: { npc, t: 0, thrown: false, c } };
      M.last = v; crime(); return true;
    },
    // true when the rider is off and the player can get on
    step(dt, b) { const J = b.jack; J.t += dt / 0.95; if (!J.thrown && J.t > 0.45) { J.thrown = true; M.stats.jacks++; if (J.npc) haul(J.npc, b.side); } return J.t >= 1; },
    // the player's arms while he hauls: both hands on the rider (arm and collar), a step in, a heave
    pose(b, o) { const J = b.jack, n = J.npc, grab = ss(J.t, 0.05, 0.3) * (1 - ss(J.t, 0.5, 0.72)), sd = b.side; o.pitch += 0.28 * grab; o.hip.z -= sd * 0.1 * grab; o.roll += sd * 0.25 * ss(J.t, 0.4, 0.6) * (1 - ss(J.t, 0.7, 1));
      if (n && grab > 0.01 && !J.thrown) { I.rootMat(b.v, _cm, _cq); _m.copy(_cm).invert(); n.rig.pos(sd < 0 ? 'upper_arm_L' : 'upper_arm_R', _v).applyMatrix4(_m); _v.y -= 0.1; n.rig.pos('chest', _v2).applyMatrix4(_m); _v2.z += sd * 0.14;
        const A = sd < 0 ? o.hL : o.hR, B = sd < 0 ? o.hR : o.hL; A.p.lerp(_v, grab); B.p.lerp(_v2, grab); A.w = Math.max(A.w, grab); B.w = Math.max(B.w, grab); A.curl = B.curl = 0.8; } },
  };
  // off the far side, by the arm: the lead's ragdoll (as the guns lane hands it a shot person), then up and away
  function haul(n, side) {
    const v = n.v, PH = g.__pedhit, c = Math.cos(v.h), s = Math.sin(v.h), lz = -side, lx = -0.35, ux = (c * lx + s * lz) * 3.0, uy = (s * lx - c * lz) * 3.0;      // off the side away from the player and a little back, 3 m/s
    const hp = n.rig.pos('hips', V3()); n.x = hp.x; n.y = -hp.z; n.state = 'down'; n.t = 0; n.rest = 0;
    if (PH && PH.on && !pl.vehicle) { const fake = { vis: n.vis, x: n.x, y: n.y, h: v.h, state: 'down', t: 0, fall: 0, vx: 0, vy: 0, kind: 'ped', hp: 100, scale: 1 }, sp = Math.hypot(ux, uy) || 1;
      const sv = { x: n.x - ux / sp * 2.6, y: n.y - uy / sp * 2.6, h: Math.atan2(uy, ux), vx: ux, vy: uy, def: { len: 4.6, wid: 1.9, hgt: 1.4 }, bullet: true }, last0 = PH.list[PH.list.length - 1], shake = g.cam.shake, mo = g.missions.onPedHit, th = g.sound.thud; g.missions.onPedHit = () => {}; g.sound.thud = () => {};
      pl.vehicle = sv; try { g.onPedHit(fake, sv); } catch (e) { M.err('haul', e); } finally { pl.vehicle = null; g.missions.onPedHit = mo; g.sound.thud = th; } PH.hitstop = 0; g.cam.shake = shake;
      const R = PH.list[PH.list.length - 1]; if (R && R !== last0 && R.fig && R.fig.ped === fake) { for (const k in R.P) { const a = R.P[k], hg = clamp(a.p.y / 1.5, 0, 1), kk = 0.5 + 0.9 * hg; a.q.set(a.p.x - ux * kk * SUB, a.p.y - (0.6 + 1.2 * hg) * SUB, a.p.z + uy * kk * SUB); } n.R = R; n.fake = fake; } }
    if (!n.R) { n.x += ux * 0.3; n.y += uy * 0.3; flee(n); }
  }
  function flee(n) { n.state = 'flee'; n.t = 0; n.away = Math.atan2(n.y - pl.y, n.x - pl.x); n.h = n.away; try { n.rig._hipsMoved = true; n.rig.restHips(); const vis = n.vis, run = vis.acts.jog ? 'jog' : vis.acts.run ? 'run' : 'walk'; vis.mixer.stopAllAction(); vis.mixer.timeScale = 1; vis.acts[run].reset().play(); } catch (e) {} }
  function tick(dt) {
    const fx = g.focus.x, fy = g.focus.y;
    for (const c of TR.cars) { if (!c.moto || Math.abs(c.x - fx) > 240 || Math.abs(c.y - fy) > 240) continue; const yaw = wrapPi(c.h - (c.mph ?? c.h)) / Math.max(dt, 1e-4); c.mph = c.h; const want = c.v < 0.5 ? TUNE.footLean : clamp(Math.atan(c.v * yaw / 9.81), -0.6, 0.6); c.mlean += (want - c.mlean) * Math.min(1, dt * 5); }
    for (let i = M.npcs.length - 1; i >= 0; i--) { const n = M.npcs[i]; n.t += dt;
      if (n.state === 'ride') { const b = pl.busy; if (!(b && b.moto && b.jack && b.jack.npc === n)) { /* he changed his mind: the rider and his bike are traffic again */ const v = n.v, j = g.vehicles.indexOf(v); if (j >= 0 && pl.vehicle !== v) { g.vehicles.splice(j, 1); if (!TR.cars.includes(n.c)) TR.cars.push(n.c); } dropNpc(n); } }
      else if (n.state === 'down') { if (n.R) { const hp = n.R.P.hips.p, sp = Math.hypot(hp.x - n.x, -hp.z - n.y) / Math.max(dt, 1e-4); n.x = hp.x; n.y = -hp.z; n.rest = sp < 0.35 ? n.rest + dt : 0; if (n.fake) n.fake.t = 0; }
        if ((n.rest > 0.6 && n.t > 1.3) || n.t > 6) { if (n.R) { n.U = POSE.riseStart(n.vis, n.rig, n.R); n.fake.state = 'gone'; n.x = n.U.x; n.y = n.U.y; n.h = n.U.h; st.resolve(n.x, n.y, 0.3, _o, true); if (_o.depth < 0.3) { n.x = _o.x; n.y = _o.y; } try { n.vis.mixer.stopAllAction(); n.vis.mixer.timeScale = 1; n.vis.acts.idle.reset().play(); } catch (e) {} n.state = 'up'; n.t = 0; } else flee(n); } }
      else if (n.state === 'up') { if (n.t >= POSE.T_UP) flee(n); }
      else if (n.state === 'flee') { const sp = Math.min(3.4, 1.2 + n.t * 3); n.h += wrapPi(n.away - n.h) * Math.min(1, dt * 6); st.resolve(n.x + Math.cos(n.h) * sp * dt, n.y + Math.sin(n.h) * sp * dt, 0.3, _o); _o2.x = _o.x; _o2.y = _o.y; try { if (M.WR) M.WR.pushOut(M.WR.carsNear(g, _o2.x, _o2.y, 8, (M.poolN ||= { boxes: [], pk: [] })), _o2, 0.3); } catch (e) {} n.x = _o2.x; n.y = _o2.y; try { n.vis.mixer.timeScale = clamp(sp / 2.8, 0.5, 1.4); } catch (e) {}
        if (n.t > 3 && (n.t > 12 || Math.hypot(n.x - pl.x, n.y - pl.y) > 45)) dropNpc(n); }
    }
  }
  const _o2 = { x: 0, y: 0 };
  const step0 = g.step.bind(g); g.step = function (dt) { step0(dt); try { tick(dt); } catch (e) { M.err('tick2', e); } };
  const sv0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) { sv0(dt); try { for (const n of M.npcs) { const vis = n.vis, o = vis.object; n.z = kerb(n.x, n.y);
      if (n.state === 'ride') { vis.mixer.update(0); n.rig._hipsMoved = false; M.bikeMat(n.v, _cm, _cq); POSE.apply(n.rig, o, POSE.ride(n.v, n.pose, n.rig, 0), _cm, _cq, 1); }
      else if (n.state === 'up') { vis.mixer.update(dt); POSE.riseSync(n.U, n.rig, vis, n.t, n.x, n.y, n.h, n.z, n.pose); }
      else if (n.state === 'flee') { o.position.set(n.x, n.z, -n.y); o.rotation.set(0, n.h, 0); vis.mixer.update(dt); } } } catch (e) { M.err('sync2', e); } };

  console.log('[moto] traffic riders on: share ' + SHARE + ', figures ' + (M.riderKinds.join(', ') || 'none'));
}
