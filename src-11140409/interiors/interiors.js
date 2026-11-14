// interiors/interiors.js (lanes/shops/interiors): shops you can walk into. Loaded by streets/storefronts.js (its fenced "interiors" lines) with the
// doors of the slots in interiors/slots.js: for each, the bay's measurements and which storefront instances are its closed door and its glass.
//   At load (cheap, data only): the room that fits behind the front (plan.js fitRoom), what stands in it (planShop), and the collision: the building
//   footprint's wall is cut across the door, the room's walls and every counter and shelf go into game.statics (and into the police's own wall set
//   once the police exist), so walkers, the camera, bullets and officers all meet the same walls.
//   Near the player (within ?inear=60 m): the room is built (build.js: one static mesh, one glass mesh, a door leaf or two, three people from the
//   game's own mocap cast), the storefront's closed door and glass instances are hidden, and the building tile behind gets a copy of the facade
//   material that cuts the shop's opening out of the wall (a box test and discard, only on the tiles that hold an open shop). Beyond ?inear+15 m all
//   of it is dropped again and the storefront is as it was: nothing is drawn or stepped.
//   The door opens for anyone walking up (the player on foot, officers, the people inside) and closes behind them.
//   The police: an officer whose goal is on the other side of a shop's front walks to the door, through it, then on (heat walkTo is wrapped).
// Knobs: ?interiors=0 off (storefronts.js never loads this file)  ?inear=60  ?ipeople=0 nobody inside  ?ibright=1 interior light  ?ihole=0 no cut (tests)
import * as THREE from 'three';
import { fitRoom, planShop, toSim, toLocal, simHeading } from './plan.js';
import { buildShop, shopMaterial } from './build.js';
import { paintAtlas } from './art.js';

const Q = new URLSearchParams(location.search), num = (k, d) => (Q.has(k) && isFinite(+Q.get(k)) ? +Q.get(k) : d);
const NEAR = num('inear', 60), FAR = NEAR + 15, PEOPLE = Q.get('ipeople') !== '0', HOLE = Q.get('ihole') !== '0', TILE = 128;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// ---------------------------------------------------------------------------------------------------------------------- collision helpers
function removeSeg(st, s) { const c = st.cell; for (let i = Math.floor(Math.min(s[0], s[2]) / c); i <= Math.floor(Math.max(s[0], s[2]) / c); i++) for (let j = Math.floor(Math.min(s[1], s[3]) / c); j <= Math.floor(Math.max(s[1], s[3]) / c); j++) { const k = st.key(i, j), a = st.segs.get(k); if (!a) continue; const b = a.filter((o) => o !== s); if (b.length) st.segs.set(k, b); else st.segs.delete(k); } }
// the wall across the door: every segment lying along the front (within 0.6 m of the wall line, roughly parallel) loses the part in front of the door
function cutDoor(st, d) {
  const a = d.dl + 0.02, b = d.dr - 0.02, c = st.cell, [cx, cy] = toSim(d, (a + b) / 2, 0), seen = new Set(), hit = []; let n = 0;
  for (let i = Math.floor((cx - 4) / c); i <= Math.floor((cx + 4) / c); i++) for (let j = Math.floor((cy - 4) / c); j <= Math.floor((cy + 4) / c); j++) { const arr = st.segs.get(st.key(i, j)); if (arr) for (const s of arr) if (!seen.has(s)) { seen.add(s); hit.push(s); } }
  for (const s of hit) {
    const [u1, z1] = toLocal(d, s[0], s[1]), [u2, z2] = toLocal(d, s[2], s[3]);
    if (Math.abs(z1) > 0.6 || Math.abs(z2) > 0.6 || Math.abs(u2 - u1) < 0.05) continue;
    if (Math.max(u1, u2) <= a || Math.min(u1, u2) >= b) continue;
    removeSeg(st, s); n++; const owner = st.owner; st.owner = s.set || null;
    const at = (u) => { const t = (u - u1) / (u2 - u1); return [s[0] + (s[2] - s[0]) * t, s[1] + (s[3] - s[1]) * t]; };
    const lo = Math.min(u1, u2), hi = Math.max(u1, u2);
    if (a - lo > 0.01) { const p = at(lo), q = at(a); st.addSeg(p[0], p[1], q[0], q[1]); }
    if (hi - b > 0.01) { const p = at(b), q = at(hi); st.addSeg(p[0], p[1], q[0], q[1]); }
    st.owner = owner;
  }
  return n;
}
// the room's walls and the solid things in it, as segments in the bay frame
function roomSegs(d, P) {
  const { ua, ub, zb, zf } = P, out = [[ua, zf, ua, zb], [ua, zb, ub, zb], [ub, zb, ub, zf], [ua, zf, d.dl, zf], [d.dr, zf, ub, zf]];
  for (const it of P.items) if (it.solid) { const [u0, u1, , , z0, z1] = it.box; out.push([u0, z0, u1, z0], [u1, z0, u1, z1], [u1, z1, u0, z1], [u0, z1, u0, z0]); }
  return out.map(([a, b, c, e]) => [...toSim(d, a, b), ...toSim(d, c, e)]);
}

// ---------------------------------------------------------------------------------------------------------------------- the facade cut
function holeMaterial(base) {
  const m = base.clone(), ob = base.onBeforeCompile, key = typeof base.customProgramCacheKey === 'function' ? base.customProgramCacheKey.bind(base) : () => '';
  const U = { uHoleA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uHoleB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uHoleN: { value: 0 } };
  m.onBeforeCompile = (sh, r) => { if (ob) ob.call(base, sh, r); Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform vec4 uHoleA[4]; uniform vec4 uHoleB[4]; uniform int uHoleN;
      bool inShopHole(vec3 p) { for (int i = 0; i < 4; i++) { if (i >= uHoleN) break; vec3 q = p - uHoleA[i].xyz; vec2 ax = uHoleB[i].xy; float a = dot(q.xz, ax), n = dot(q.xz, vec2(-ax.y, ax.x));
        if (abs(a) < uHoleA[i].w && abs(q.y) < uHoleB[i].z && abs(n) < uHoleB[i].w) return true; } return false; }
      void main() { if (inShopHole(vWPos)) discard;`); };
  m.customProgramCacheKey = () => key() + '-shophole';
  m.userData = Object.assign({}, base.userData, { shopHole: true });
  return { m, U };
}

// ---------------------------------------------------------------------------------------------------------------------- the layer
export async function addInteriors(game, { doors, meshes, ctx }) {
  const t0 = performance.now(), w = game.world, C = game.city, st = game.statics, scene = w.scene;
  let hero = []; if (Q.get('hero') !== '0') try { const r = await fetch(ctx.A.replace(/streets\/$/, 'hero/') + 'hero.json'); if (r.ok) hero = (await r.json()).filter((h) => !h.off && h.footprint && h.footprint.length > 2).map((h) => h.footprint); } catch (e) {}
  const shops = [], rep = { shops: [], ms: 0, cut: 0 };
  for (const d of doors) {
    const room = fitRoom(d, C, hero); if (!room) { rep.shops.push({ id: d.id, kind: d.kind, room: null }); console.log('[interiors] no room fits behind ' + d.id); continue; }
    const plan = planShop(d, room), segs = roomSegs(d, plan), dc = (d.dl + d.dr) / 2;
    const S = { d, room, plan, segs, built: null, people: [], open: 0, hw: (d.dr - d.dl) / 2 - 0.12, dc, doorIn: toSim(d, dc, -1.0), doorOut: toSim(d, dc, 1.0), doorAt: toSim(d, dc, 0), sfHidden: null };
    S.inside = (x, y) => { const [u, z] = toLocal(d, x, y); return u > room.ua - 0.05 && u < room.ub + 0.05 && z > -room.D - 0.05 && z < -0.08; };
    // collision now (cheap): the door through the footprint wall, the room and its things
    if (st && st.addSeg) { rep.cut += cutDoor(st, d); const ow = st.owner; st.owner = null; for (const s of segs) st.addSeg(s[0], s[1], s[2], s[3]); st.owner = ow; }
    shops.push(S); rep.shops.push({ id: d.id, kind: d.kind, room: [+room.W.toFixed(2), room.D], at: d.x.toFixed(1) + ',' + d.y.toFixed(1) });
  }
  if (!shops.length) return { shops, report: rep };

  // shared things: the atlas (painted now, uploaded at the first build), the materials, the facade copy that cuts the openings
  const atlasTex = new THREE.CanvasTexture(paintAtlas()); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 4; atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  const uBright = { value: num('ibright', 1) }, matShop = shopMaterial(atlasTex, uBright);
  const matGlass = new THREE.MeshStandardMaterial({ color: 0xc8d4d6, transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.2 });
  const tileMeshes = () => (w.buildingMeshes || []).filter((m) => m.userData && m.userData.tile);
  let facade = null; for (const m of tileMeshes()) if (m.material && m.material.onBeforeCompile) { facade = m.material; break; }
  const hole = facade && HOLE ? holeMaterial(facade) : null;
  // shader warm-up: tiny meshes far under the street with each new material, so the start screen's compile covers them (no hitch at the first shop)
  const warm = new THREE.Group(); warm.name = 'interiors_warm'; warm.position.set(game.player.x, -60, -game.player.y);
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3)); g.setAttribute('aUV', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    for (const m of [matShop, matGlass]) { const o = new THREE.Mesh(g, m); o.frustumCulled = false; warm.add(o); } }
  if (hole) { const src = tileMeshes()[0].geometry, g = new THREE.BufferGeometry(); for (const k in src.attributes) { const a = src.attributes[k]; g.setAttribute(k, new THREE.BufferAttribute(a.array.slice(0, a.itemSize * 3), a.itemSize, a.normalized)); } g.setIndex([0, 1, 2]); const o = new THREE.Mesh(g, hole.m); o.frustumCulled = false; o.scale.setScalar(0.001); warm.add(o); }
  scene.add(warm); setTimeout(() => { warm.visible = false; }, 45000);

  // ---- the storefront's own door and glass instances of a shop (hidden while it is open)
  const sfMesh = (name, key) => { const [ti, tj] = key.split(',').map(Number), cx = (ti + 0.5) * TILE, cz = -(tj + 0.5) * TILE; return (meshes || []).find((m) => m.name === name && Math.abs(m.userData.cx - cx) < 1 && Math.abs(m.userData.cz - cz) < 1); };
  const hideSF = (S, on) => {
    const d = S.d;
    if (on && !S.sfHidden) { S.sfHidden = []; for (const [name, rg] of [['sf_glass', d.glass], ['sf_fine', d.fine]]) { const m = sfMesh(name, d.tile); if (!m) continue; const A = m.instanceMatrix.array, a = Math.round(rg[0]), b = Math.round(rg[1]); S.sfHidden.push([m, a, A.slice(a * 16, b * 16)]); A.fill(0, a * 16, b * 16); m.instanceMatrix.needsUpdate = true; } }
    else if (!on && S.sfHidden) { for (const [m, a, saved] of S.sfHidden) { m.instanceMatrix.array.set(saved, a * 16); m.instanceMatrix.needsUpdate = true; } S.sfHidden = null; }
  };
  // ---- the facade cut: hole slots for the built shops, the tile meshes near them wear the cutting copy
  const holeBox = (S, i) => { const d = S.d, cu = (d.x0 + d.x1) / 2, [sx, sy] = toSim(d, cu, 0), top = d.sLo + 0.02;
    hole.U.uHoleA.value[i].set(sx, (0.15 + top - 0.3) / 2, -sy, (d.x1 - d.x0) / 2 + 0.04); hole.U.uHoleB.value[i].set(d.dx, -d.dy, (top + 0.15 + 0.3) / 2, 0.32); };
  let holeT = 0;
  const syncHoles = () => {
    if (!hole) return; const on = shops.filter((S) => S.built); hole.U.uHoleN.value = Math.min(4, on.length); on.slice(0, 4).forEach((S, i) => holeBox(S, i));
    for (const m of tileMeshes()) { const c = m.userData.c; let want = false; if (c) for (const S of on) { const [x, y] = S.doorAt; if (Math.hypot(c[0] - x, c[1] + y) < c[2] + 6) { want = true; break; } }
      if (want && m.material !== hole.m) { m.userData.__imat = m.material; m.material = hole.m; } else if (!want && m.material === hole.m) { m.material = m.userData.__imat || facade; } }
  };

  // ---- people inside: the game's own skinned cast (mocap clips), a few per shop
  const kinds = game.kit && game.kit.pedKinds ? game.kit.pedKinds() : [], pool = [];
  const person = (kind) => { let v = pool.find((p) => p.kind === kind && !p.used); if (!v) { const p = game.kit.person(kind); if (!p) return null; v = Object.assign(p, { kind }); v.object.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; } }); pool.push(v); } v.used = true; v.object.visible = true; scene.add(v.object); return v; };
  const play = (v, name, fade = 0.25) => { if (!v.mixer) return; const a = v.acts[name] || v.acts.idle; if (!a || v.cur === a) return; if (v.cur) v.cur.fadeOut(fade); a.reset().fadeIn(fade).play(); v.cur = a; };
  const spawnPeople = (S) => {
    if (!PEOPLE || !kinds.length) return; const d = S.d;
    S.plan.people.forEach((pp, i) => {
      const v = person(kinds[(d.bid * 3 + i * 5 + (pp.role === 'keeper' ? 1 : 0)) % kinds.length]); if (!v) return;
      const at = pp.route ? pp.route[0] : pp.at, [x, y] = toSim(d, at[0], at[1]), f = pp.face || [0, 1];
      const q = { pp, v, x, y, h: simHeading(d, f[0], f[1]), i: 0, wait: 1 + i, state: pp.route ? 'stand' : 'still', walk: (v.walks || []).find((wk) => wk.name === 'walkslow') || { name: 'walkslow', speed: 0.92 } };
      play(v, pp.route ? (pp.stand ? pp.stand[0] : 'idle') : pp.clip, 0); if (v.mixer) v.mixer.setTime((d.bid % 7) + i * 2.3); S.people.push(q);
    });
  };
  const dropPeople = (S) => { for (const q of S.people) { const v = q.v; if (v.mixer) v.mixer.stopAllAction(); v.cur = null; v.used = false; v.object.visible = false; scene.remove(v.object); } S.people = []; };
  const stepPeople = (S, dt, near) => {
    const d = S.d, pl = game.player;
    for (const q of S.people) {
      const pp = q.pp, v = q.v;
      if (q.state === 'walk') {
        const tgt = pp.route[q.i], [tx, ty] = toSim(d, tgt[0], tgt[1]), dx = tx - q.x, dy = ty - q.y, dd = Math.hypot(dx, dy);
        const blocked = !pl.vehicle && Math.hypot(pl.x - q.x, pl.y - q.y) < 0.9 && ((pl.x - q.x) * dx + (pl.y - q.y) * dy) > 0;
        if (dd < 0.12) { q.state = 'stand'; q.wait = 2.5 + ((q.i * 7 + d.bid) % 5); play(v, pp.stand ? pp.stand[q.i % pp.stand.length] : 'idle'); }
        else if (blocked) { play(v, 'idle'); }
        else { const sp = q.walk.speed; q.h += clamp(wrapPi(Math.atan2(dy, dx) - q.h), -dt * 4, dt * 4); const k = Math.min(sp * dt, dd); q.x += Math.cos(q.h) * k; q.y += Math.sin(q.h) * k; play(v, q.walk.name); if (v.mixer) v.mixer.timeScale = 1; }
      } else if (q.state === 'stand') { q.wait -= dt; if (q.wait <= 0) { q.i = (q.i + 1) % pp.route.length; q.state = 'walk'; } }
      // the player is not walked through: pushed out of a 0.45 m circle
      if (!pl.vehicle && !pl.busy) { const ex = pl.x - q.x, ey = pl.y - q.y, e = Math.hypot(ex, ey); if (e < 0.5 && e > 1e-3) { pl.x = q.x + ex / e * 0.5; pl.y = q.y + ey / e * 0.5; } }
      const o = v.object; o.position.set(q.x, 0.15, -q.y); o.rotation.set(0, q.h, 0);
      if (near && v.mixer) v.mixer.update(dt);
    }
  };

  // ---- build and drop one shop
  const build = (S) => {
    const t = performance.now(), d = S.d, r = buildShop(d, S.plan), grp = new THREE.Group(); grp.name = 'interior_' + d.id;
    grp.position.set(d.x, 0.15, -d.y); grp.rotation.y = d.rot; grp.matrixAutoUpdate = false; grp.updateMatrix();
    const ms = new THREE.Mesh(r.geo, matShop); ms.name = 'int_static'; ms.matrixAutoUpdate = false; grp.add(ms);
    const mg = new THREE.Mesh(r.glass, matGlass); mg.name = 'int_glass'; mg.renderOrder = 3; mg.matrixAutoUpdate = false; grp.add(mg);
    const leaves = r.leaves.map((L) => { const pv = new THREE.Group(); pv.position.set(L.hinge[0], 0, L.hinge[1]); const a = new THREE.Mesh(L.geo, matShop), b = new THREE.Mesh(L.glass, matGlass); b.renderOrder = 3; pv.add(a, b); grp.add(pv); return { pv, side: L.side }; });
    scene.add(grp); grp.updateMatrixWorld(true);
    S.built = { grp, leaves, geos: [r.geo, r.glass, ...r.leaves.flatMap((L) => [L.geo, L.glass])], tris: r.tris, draws: 2 + leaves.length * 2, ms: 0 };
    hideSF(S, true); spawnPeople(S); syncHoles();
    S.built.ms = +(performance.now() - t).toFixed(1); rep.lastBuild = { id: d.id, ms: S.built.ms };
  };
  const drop = (S) => { if (!S.built) return; scene.remove(S.built.grp); for (const g of S.built.geos) g.dispose(); S.built = null; hideSF(S, false); dropPeople(S); syncHoles(); };

  // ---- the police: through the door, not into the wall
  const route = (x, y, tx, ty) => {
    for (const S of shops) {
      const a = S.inside(x, y), b = S.inside(tx, ty); if (a === b) continue;
      const [u, z] = toLocal(S.d, x, y), lined = Math.abs(u - S.dc) < S.hw;
      if (!a) return lined && z > -0.3 && z < 1.6 ? S.doorIn : S.doorOut;
      return lined && z > -1.5 ? S.doorOut : S.doorIn;
    }
    return null;
  };
  let heatDone = false;
  const hookHeat = () => {
    const H = game.combat && game.combat.heat; if (!H || typeof H.walkTo !== 'function' || !H.wall) return; heatDone = true;
    for (const S of shops) { cutDoor(H.wall, S.d); for (const s of S.segs) H.wall.addSeg(s[0], s[1], s[2], s[3]); }
    const w0 = H.walkTo; H.walkTo = function (k, tx, ty, sp, dt, stop) { const r = route(k.x, k.y, tx, ty); if (r) { k.viaDoor = true; return w0.call(this, k, r[0], r[1], sp, dt, 0.05); } k.viaDoor = false; return w0.call(this, k, tx, ty, sp, dt, stop); };
    rep.heat = true; console.log('[interiors] police know the shop doors');
  };

  // ---- every step: build / drop by distance, the doors, the people
  const _v = new THREE.Vector3();
  const update = (dt) => {
    if (!heatDone) hookHeat();
    const pl = game.player, cam = w.camera.position, fx = game.focus ? game.focus.x : pl.x, fy = game.focus ? game.focus.y : pl.y;
    holeT -= dt; let changed = false;
    for (const S of shops) {
      const [dx0, dy0] = S.doorAt, dist = Math.min(Math.hypot(fx - dx0, fy - dy0), Math.hypot(cam.x - dx0, -cam.z - dy0));
      if (!S.built && dist < NEAR) { build(S); changed = true; } else if (S.built && dist > FAR) { drop(S); changed = true; continue; }
      if (!S.built) continue;
      // the door: open while someone is within 2.2 m of it
      let want = 0; const near2 = (x, y) => Math.hypot(x - dx0, y - dy0) < 2.2;
      if (!pl.vehicle && near2(pl.x, pl.y)) want = 1;
      const H = game.combat && game.combat.heat; if (!want && H && H.cops) for (const k of H.cops) if (k.hp > 0 && near2(k.x, k.y)) { want = 1; break; }
      if (!want) for (const q of S.people) if (q.state === 'walk' && near2(q.x, q.y)) { want = 1; break; }
      S.open += clamp(want - S.open, -dt * 1.6, dt * 2.6);
      const ang = (1 - Math.pow(1 - S.open, 2)) * 1.5; for (const L of S.built.leaves) { L.pv.rotation.y = ang * L.side; L.pv.updateMatrixWorld(true); }
      stepPeople(S, dt, dist < 40);
    }
    if (changed || holeT <= 0) { holeT = 0.5; syncHoles(); }
  };
  const step0 = game.step.bind(game); game.step = function (dt) { step0(dt); try { update(dt); } catch (e) { if (!rep.err) { rep.err = String(e && (e.stack || e.message)); console.log('[interiors] step: ' + rep.err); } } };

  rep.ms = Math.round(performance.now() - t0);
  console.log('[interiors] ' + shops.length + ' shops: ' + rep.shops.map((s) => s.id + ' ' + s.kind + (s.room ? ' ' + s.room[0] + 'x' + s.room[1] + ' m' : ' NO ROOM')).join(', ') + '; door walls cut ' + rep.cut + '; ' + rep.ms + ' ms');
  const api = {
    shops, report: rep, uBright, matShop, matGlass, hole,
    // tests: what is built and what it costs
    cost() { return shops.map((S) => ({ id: S.d.id, kind: S.d.kind, built: !!S.built, draws: S.built ? S.built.draws + S.people.reduce((a, q) => { let n = 0; q.v.object.traverse((c) => { if (c.isMesh && c.visible) n++; }); return a + n; }, 0) : 0, tris: S.built ? S.built.tris + S.people.reduce((a, q) => { let n = 0; q.v.object.traverse((c) => { if (c.isMesh && c.geometry && c.geometry.index) n += c.geometry.index.count / 3; }); return a + n; }, 0) : 0, people: S.people.length, buildMs: S.built ? S.built.ms : null })); },
    // tests: stand the player on the sidewalk in front of shop i (m metres out), facing the door
    front(i, m = 3.5) { const S = shops[i], d = S.d, [x, y] = toSim(d, S.dc, m); const pl = game.player; pl.x = x; pl.y = y; pl.h = simHeading(d, 0, -1); if (game.cam) { game.cam.yaw = pl.h; game.cam.pitch = 0.12; } if (game.snapCamera) game.snapCamera(); return { x, y, h: pl.h }; },
    // tests: a point in the shop's frame in map metres, and the heading of a direction in it
    at(i, u, z) { return toSim(shops[i].d, u, z); }, heading(i, du, dz) { return simHeading(shops[i].d, du, dz); },
    dropAll() { for (const S of shops) drop(S); },
  };
  return api;
}
