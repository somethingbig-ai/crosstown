// props.js: loose street props (Matt, Nov 11: "Why are the chairs and stuff, like, glued to the ground?").
// One file, no dependencies but three.js and the game object: `install(game)` once at the end of Game.init. Off switch: ?props=0.
//   - plaza chairs and tables, bins, baskets, cones, A-frames, crates, boxes, trash bags and newspaper boxes are bodies: walking into one
//     shoves it, running into it knocks it over, a car scatters them, a blast throws them; they come to rest and stay where they land.
//   - nothing is simulated until something touches a prop. Until then a prop is the game's own instance and its own static circle,
//     untouched. On the first touch its instance is taken out of the batch (scale 0, with its blob/sun shadow and far stand-in), its
//     circle is switched off, and one instance in a small pool of this file (same geometry, same material, same tint) takes its place.
//   - a small rigid-body solver of its own (no physics library to load): a body is its real outline (support points read off the
//     model's vertices), with mass and inertia from its size. Bodies go back to sleep at rest (zero cost) and get a circle again
//     where they lie if they still stand tall enough to block.
//   - for guns and explosions (world coordinates, three.js vectors):
//       game.__props.ray(origin, dir, impulse = 40, maxDist = 80) -> { point, kind } | null     a bullet: pushes what it meets first
//       game.__props.blast(point, power = 1, radius = 6)                                           an explosion: throws what is near
//       game.__props.impulse(point, vec, radius = 0.6)                                             a kick: vec is kg*m/s
import * as THREE from 'three';

const LOOSE = ['pchair', 'ptable', 'pbin', 'basket', 'basketFull', 'cone', 'aframe', 'crate', 'cbox', 'bag', 'newsbox', 'can', 'canRust', 'delin', 'chalk', 'ubox', 'barrier', 'cart', 'bike', 'bikeB'];
// v3 (Nov 13): things that are FIXED to the ground and stand until a car at speed or a blast breaks them off: sign posts, parking meters, fence panels.
// The plates on a post (PLATE) come down with it. A walking player and a bullet leave all of these alone.
const FIXED = ['spost', 'meter', 'fence'], PLATE = ['psign', 'psignP', 'blade', 'oneway', 'hblade', 'honeway', 'hpsign'], BREAK_SPEED = 5;
const TWINS = { bike: ['bikeM', 'bikeL'], bikeB: ['bikeM', 'bikeL'], psign: ['psignL'], psignP: ['psignL'] };
const G = 9.81, SUB = 1 / 120, CELL = 4, MAXB = 360, PLAYER_R = 0.34, PLAYER_M = 80;
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _o = {};
const UP = new THREE.Vector3(0, 1, 0);
const DIRS = (() => { const out = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) out.push(new THREE.Vector3(x, y, z).normalize()); return out; })();

export function install(game, opts = {}) {
  if (game.__props) return game.__props;
  const S = (game.__props = { on: true, bodies: [], awake: 0, woken: 0, recs: 0, broken: 0, unwalled: 0, force: false, ray: () => null, blast: () => 0, impulse: () => 0, strike: () => false });
  if (game.P && game.P.get('props') === '0') { S.on = false; return S; }
  const F = game.streets && game.streets.parts && game.streets.parts.furniture, st = game.statics, world = game.world;
  if (!F || !F.kinds || !F.meshes || !st) { S.on = false; S.why = 'no furniture'; return S; }

  // ---------------------------------------------------------------- what is loose, and where
  const hash = new Map(), hk = (x, y) => Math.floor(x / CELL) * 100003 + Math.floor(y / CELL), byName = new Map();
  for (const m of F.meshes) { let a = byName.get(m.name); if (!a) byName.set(m.name, (a = [])); a.push(m); }
  const shapes = new Map();
  function shapeFrom(geos, k) {       // a model's own outline: its box, and the vertex furthest out in each of 26 directions
    const box = new THREE.Box3(), best = DIRS.map(() => ({ d: -1e9, p: new THREE.Vector3() })); let any = false;
    for (const geo of geos) { const pos = geo && geo.attributes.position; if (!pos) continue; const stp = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += stp) { _v.fromBufferAttribute(pos, i); box.expandByPoint(_v); any = true; for (let k = 0; k < DIRS.length; k++) { const d = _v.dot(DIRS[k]); if (d > best[k].d) { best[k].d = d; best[k].p.copy(_v); } } } }
    if (!any) return null;
    const pts = []; for (const b of best) if (!pts.some((p) => p.distanceToSquared(b.p) < 1e-4)) pts.push(b.p.clone());
    const size = box.getSize(new THREE.Vector3()), cen = box.getCenter(new THREE.Vector3()); cen.y = box.min.y + size.y * 0.42;      // a little bottom-heavy, as furniture is
    return { pts, size, cen, k: k || 1, minY: box.min.y };
  }
  function shapeOf(name) { let sh = shapes.get(name); if (sh === undefined) { const K = F.kinds[name]; sh = K ? shapeFrom((K.parts || []).map((q) => q.geometry), K.scale || 1) : null; shapes.set(name, sh); } return sh; }
  const shOf = (rec) => rec.sh || shapeOf(rec.name);
  for (const name of LOOSE.concat(FIXED, PLATE)) { const K = F.kinds[name], fx = FIXED.includes(name) ? 1 : PLATE.includes(name) ? 2 : 0; if (!K || !K.list || !K.list.length || !shapeOf(name)) continue;
    for (const it of K.list) { const o = it[4]; if (o && o.tilt && Math.abs(o.tilt[0]) > 1) continue;       // (already lying on its side as set dressing: left as it is)
      const rec = { name, x: it[0], y: it[1], z: it[2], h: it[3], o, body: null, fx }, k = hk(rec.x, rec.y); let a = hash.get(k); if (!a) hash.set(k, (a = [])); a.push(rec); S.recs++; } }
  const add = (rec) => { const k = hk(rec.x, rec.y); let a = hash.get(k); if (!a) hash.set(k, (a = [])); a.push(rec); S.recs++; };
  // the streets lane's clutter.js draws its own bins, boxes, crates, cans and cones in the hero blocks (parts.clutter.dyn): those are loose too
  const CL = game.streets.parts.clutter; S.clutter = 0;
  if (CL && CL.dyn && CL.take) for (const D of CL.dyn) { if (!/^(basket|crate|cbox|can|barrel|cone|newsbox|box|bottle|cup|bucket|pail|pallet)/i.test(D.name) || !D.hi || !D.hi.ms || !D.hi.ms.length) continue; const sh = shapeFrom(D.hi.ms.map((m) => m.geometry), 1); if (!sh) continue;
    for (let i = 0; i < D.n; i++) { const M = D.M; if (M[i * 16 + 15] === 0 || (M[i * 16] === 0 && M[i * 16 + 1] === 0 && M[i * 16 + 2] === 0)) continue; const sy = Math.hypot(M[i * 16 + 4], M[i * 16 + 5], M[i * 16 + 6]); if (Math.abs(M[i * 16 + 5]) < sy * 0.6) continue;       /* lying on its side as dressing: left */
      add({ name: D.name, x: D.P[i * 2], y: -D.P[i * 2 + 1], z: M[i * 16 + 13], h: 0, o: null, body: null, cl: D, ci: i, sh: Object.assign({}, sh, { k: Math.hypot(M[i * 16], M[i * 16 + 1], M[i * 16 + 2]) }) }); S.clutter++; } }
  // the streets lane's plaza.js draws its own chairs and tables in the hero plazas (parts.plaza.loose): found by place like furniture's, in meshes with no tile
  const PZ = game.streets.parts.plaza, noTile = new WeakSet(); S.plaza = 0;
  if (PZ && PZ.loose) for (const e of PZ.loose) for (const m of e.meshes || []) { noTile.add(m); let a = byName.get('st_' + e.name); if (!a) byName.set('st_' + e.name, (a = [])); if (!a.includes(m)) { a.push(m); S.plaza++; } }
  const near = (x, y, r, fn) => { const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((y - r) / CELL), j1 = Math.floor((y + r) / CELL); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = hash.get(i * 100003 + j); if (a) for (let q = a.length - 1; q >= 0; q--) fn(a[q], a, q); } };

  // ---------------------------------------------------------------- our own instances of a kind (same geometry, material and tint as the game's)
  const pools = new Map();
  function poolOf(name, srcMeshes) {
    const key = name + '|' + srcMeshes[0].uuid; let P = pools.get(key); if (P) return P;
    P = { name, n: 0, cap: 16, parts: [], sh: shapeFrom(srcMeshes.map((m) => m.geometry), 1) };
    for (const src of srcMeshes) { const g = new THREE.BufferGeometry(), sg = src.geometry, inst = [];
      for (const a in sg.attributes) { const at = sg.attributes[a]; if (at.isInstancedBufferAttribute) inst.push({ name: a, size: at.itemSize, norm: at.normalized, data: null }); else g.setAttribute(a, at); }
      g.setIndex(sg.index); for (const gr of sg.groups || []) g.addGroup(gr.start, gr.count, gr.materialIndex); g.boundingSphere = sg.boundingSphere; g.boundingBox = sg.boundingBox;
      P.parts.push({ g, src, inst, im: null }); }
    grow(P, P.cap); pools.set(key, P); return P;
  }
  function grow(P, cap) {
    for (const part of P.parts) { const old = part.im, im = new THREE.InstancedMesh(part.g, part.src.material, cap);
      for (const a of part.inst) { const d = new Float32Array(cap * a.size); if (a.data) d.set(a.data); a.data = d; part.g.setAttribute(a.name, new THREE.InstancedBufferAttribute(d, a.size, a.norm)); }
      if (old) { im.instanceMatrix.array.set(old.instanceMatrix.array); world.scene.remove(old); old.dispose(); }
      im.count = P.n; im.frustumCulled = false; im.castShadow = part.src.castShadow; im.receiveShadow = true; im.renderOrder = part.src.renderOrder; im.name = 'props_' + P.name; im.userData = { kind: part.src.userData.kind, looseProp: true }; im.matrixAutoUpdate = false;
      if (part.src.customDepthMaterial) im.customDepthMaterial = part.src.customDepthMaterial; if (part.src.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) im.onBeforeRender = part.src.onBeforeRender;
      world.scene.add(im); part.im = im; }
    P.cap = cap;
  }
  // take the game's instance at (x, z) out of every batch that draws it (the kind's own parts, its far stand-in, its blob and sun shadow)
  const inTile = (m, x, z) => { if (noTile.has(m)) return true; const u = m.userData, hf = (u.r || 1e9) / 1.4142 + 0.05; return Math.abs(x - u.cx) <= hf && Math.abs(z - u.cz) <= hf; };
  function findIn(m, x, z, tol) { if (!inTile(m, x, z)) return -1; const a = m.instanceMatrix.array, t2 = tol * tol; for (let i = 0; i < m.count; i++) { const dx = a[i * 16 + 12] - x, dz = a[i * 16 + 14] - z; if (dx * dx + dz * dz < t2 && (a[i * 16] !== 0 || a[i * 16 + 1] !== 0 || a[i * 16 + 2] !== 0)) return i; } return -1; }
  const zero = (m, i) => { const a = m.instanceMatrix.array; for (let k = 0; k < 12; k++) a[i * 16 + k] = 0; m.instanceMatrix.needsUpdate = true; };
  const sunR = { pchair: 0.24, ptable: 0.33 };
  function takeOut(rec) {
    if (rec.cl) { const D = rec.cl, i = rec.ci, M = CL.take(D.name, i); if (!M) return null; return { meshes: D.hi.ms, M, attr: (j, name, size) => { const a = (D.attrs || []).find((q) => q.name === name); return a && a.data ? a.data.subarray(i * a.size, i * a.size + a.size) : null; } }; }
    const x = rec.x, z = -rec.y, own = [];
    for (const m of byName.get('st_' + rec.name) || []) { const i = findIn(m, x, z, 0.02); if (i >= 0) { own.push([m, i]); } }
    if (!own.length) return null;
    for (const sfx of ['L', 'Lod']) for (const m of byName.get('st_' + rec.name + sfx) || []) { const i = findIn(m, x, z, 0.02); if (i >= 0) zero(m, i); }
    for (const tw of TWINS[rec.name] || []) for (const m of byName.get('st_' + tw) || []) { const i = findIn(m, x, z, 0.02); if (i >= 0) zero(m, i); }
    if (rec.name === 'basketFull') for (const m of byName.get('st_basketL') || []) { const i = findIn(m, x, z, 0.02); if (i >= 0) zero(m, i); }
    for (const [nm, list] of byName) { if (nm !== 'st_blob' && !nm.startsWith('st_sh_')) continue; for (const m of list) { const i = findIn(m, x, z, 0.02); if (i >= 0) zero(m, i); } }
    if (sunR[rec.name]) for (const m of byName.get('st_sunsh') || []) { if (!inTile(m, x, z)) continue; const a = m.instanceMatrix.array;       // the sun shadow lies off to one side: its near end is the prop
      for (let i = 0; i < m.count; i++) { const sx = Math.hypot(a[i * 16], a[i * 16 + 1], a[i * 16 + 2]); if (!sx) continue; const hl = sx - sunR[rec.name], ox = a[i * 16 + 12] - a[i * 16] / sx * hl, oz = a[i * 16 + 14] - a[i * 16 + 2] / sx * hl; if ((ox - x) * (ox - x) + (oz - z) * (oz - z) < 0.01) { zero(m, i); break; } } }
    const M = own[0][0].instanceMatrix.array.slice(own[0][1] * 16, own[0][1] * 16 + 16), vals = own.map(([m, i]) => { const o = {}; for (const a in m.geometry.attributes) { const at = m.geometry.attributes[a]; if (at.isInstancedBufferAttribute) o[a] = at.array.slice(i * at.itemSize, i * at.itemSize + at.itemSize); } return o; });
    for (const [m, i] of own) zero(m, i); if (own.some(([m]) => noTile.has(m)) && PZ && PZ.refresh) { try { PZ.refresh(world.camera); } catch (e) {} }
    return { meshes: own.map((q) => q[0]), M, attr: (j, name) => (vals[j] || vals[0])[name] || null };
  }

  // ---------------------------------------------------------------- a body
  function wake(rec) {
    if (rec.fx && !rec.body && !S.force) return null;      // fixed to the ground: only a car at speed or a blast (S.force) breaks it off
    if (rec.body) { const b = rec.body; if (!b.awake) { b.awake = true; b.rest = 0; S.awake++; if (b.circle) { b.circle.on = false; b.circle = null; } } return b; }
    if (S.bodies.length >= MAXB && !retire()) return null;
    const own = takeOut(rec); if (!own) { if (PZ && PZ.loose && (rec.name === 'pchair' || rec.name === 'ptable') && (rec.miss = (rec.miss || 0) + 1) < 40) return null;      /* a hero-plaza piece is only in its near mesh close to the camera: try again later */ rec.dead = true; return null; }
    const P = poolOf(rec.name, own.meshes); if (P.n >= P.cap) grow(P, P.cap * 2); const sh = P.sh || shOf(rec);
    // the instance as the game drew it
    _m.fromArray(own.M); const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); _m.decompose(pos, q, sc);
    const slot = P.n++; for (let k = 0; k < P.parts.length; k++) { const part = P.parts[k]; for (const a of part.inst) { const v = own.attr(k, a.name, a.size); if (v) { a.data.set(v, slot * a.size); part.g.attributes[a.name].needsUpdate = true; } } part.im.count = P.n; }
    const size = sh.size.clone().multiply(sc), vol = Math.max(0.004, size.x * size.y * size.z), m = Math.min(60, Math.max(2.5, vol * (rec.name === 'newsbox' ? 180 : rec.name === 'bag' ? 60 : 38)));
    const oc = sh.cen.clone().multiply(sc), pts = sh.pts.map((p) => p.clone().multiply(sc).sub(oc));
    const I = new THREE.Vector3(m * (size.y * size.y + size.z * size.z) / 12, m * (size.x * size.x + size.z * size.z) / 12, m * (size.x * size.x + size.y * size.y) / 12).multiplyScalar(0.8);
    const b = { rec, P, slot, sc, oc, pts, m, Ii: new THREE.Vector3(1 / I.x, 1 / I.y, 1 / I.z), p: pos.clone().add(_v.copy(oc).applyQuaternion(q)), q, v: new THREE.Vector3(), w: new THREE.Vector3(), r: 0.5 * Math.hypot(size.x, size.y, size.z), rh: 0.5 * Math.max(size.x, size.z), hgt: size.y,
      awake: true, rest: 0, circle: null, sw: st.onSidewalk(rec.x, rec.y), g0: 0, t: 0, mu: rec.name === 'bag' ? 0.9 : 0.55, e: rec.name === 'bag' ? 0.02 : 0.22 };
    let lo = 1e9; for (const p of pts) { const y = _v.copy(p).applyQuaternion(q).y; if (y < lo) lo = y; } b.g0 = b.p.y + lo;       // the ground it stands on is where its lowest point is
    // its static circle(s) go
    const R = b.rh + 0.25, c = st.cell; for (let i = Math.floor((rec.x - R) / c); i <= Math.floor((rec.x + R) / c); i++) for (let j = Math.floor((rec.y - R) / c); j <= Math.floor((rec.y + R) / c); j++) { const a = st.circ.get(st.key(i, j)); if (a) for (const o of a) if (o.on && (o.tag === 'furniture' || o.tag === 'clutter') && Math.hypot(o.x - rec.x, o.y - rec.y) < R && o.r < 0.7) o.on = false; }
    rec.body = b; S.bodies.push(b); S.awake++; S.woken++; write(b); return b;
  }
  function retire() {       // room for one more: the body at rest furthest from the player goes (never one in view range)
    const pl = game.player; let bi = -1, bd = 120; for (let i = 0; i < S.bodies.length; i++) { const b = S.bodies[i]; if (b.awake) continue; const d = Math.hypot(b.p.x - pl.x, b.p.z + pl.y); if (d > bd) { bd = d; bi = i; } }
    if (bi < 0) return false; const b = S.bodies[bi]; if (b.circle) b.circle.on = false; b.rec.dead = true; b.rec.body = null; b.sc.set(0, 0, 0); write(b); S.bodies.splice(bi, 1); return true;
  }
  function write(b) { _v.copy(b.oc).applyQuaternion(b.q); _a.copy(b.p).sub(_v); _m.compose(_a, b.q, b.sc); for (const part of b.P.parts) { _m.toArray(part.im.instanceMatrix.array, b.slot * 16); part.im.instanceMatrix.needsUpdate = true; } }
  const ground = (b) => (st.onSidewalk(b.p.x, -b.p.z) === b.sw ? b.g0 : b.g0 + (b.sw ? -0.15 : 0.15));
  // impulse J (kg m/s) at world point `at`
  function push(b, J, at) { b.v.addScaledVector(J, 1 / b.m); if (at) { _r.copy(at).sub(b.p); _c.crossVectors(_r, J); _qi.copy(b.q).invert(); _c.applyQuaternion(_qi).multiply(b.Ii).applyQuaternion(b.q); b.w.add(_c); if (b.w.lengthSq() > 900) b.w.setLength(30); } }
  function step(b, h) {
    b.v.y -= G * h; b.v.multiplyScalar(1 - 0.04 * h); b.w.multiplyScalar(1 - 0.5 * h);
    b.p.addScaledVector(b.v, h);
    const w = b.w, q = b.q; _q.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0).multiply(q); q.x += _q.x; q.y += _q.y; q.z += _q.z; q.w += _q.w; q.normalize(); _qi.copy(q).invert();
    const gy = ground(b); let pen = 0, touch = 0;
    for (const p of b.pts) {
      _r.copy(p).applyQuaternion(q); const d = gy - (b.p.y + _r.y); if (d <= 0) continue; touch++; if (d > pen) pen = d;
      _a.crossVectors(w, _r).add(b.v); const vn = _a.y;       // the point's velocity
      let jn = 0;
      if (vn < 0) { _c.crossVectors(_r, UP).applyQuaternion(_qi).multiply(b.Ii).applyQuaternion(q); _d.crossVectors(_c, _r); const K = 1 / b.m + _d.y; jn = -(1 + (vn < -1.2 ? b.e : 0)) * vn / K;
        b.v.y += jn / b.m; _c.crossVectors(_r, UP).multiplyScalar(jn).applyQuaternion(_qi).multiply(b.Ii).applyQuaternion(q); w.add(_c); }
      // friction against the sliding of this point
      _a.crossVectors(w, _r).add(b.v); _a.y = 0; const vt = _a.length(); if (vt > 1e-3) { _n.copy(_a).multiplyScalar(-1 / vt); _c.crossVectors(_r, _n).applyQuaternion(_qi).multiply(b.Ii).applyQuaternion(q); _d.crossVectors(_c, _r); const Kt = 1 / b.m + _d.dot(_n), jt = Math.min(b.mu * (jn + b.m * G * h / Math.max(1, touch)), vt / Kt);
        b.v.addScaledVector(_n, jt / b.m); _c.crossVectors(_r, _n).multiplyScalar(jt).applyQuaternion(_qi).multiply(b.Ii).applyQuaternion(q); w.add(_c); }
    }
    if (pen > 0) b.p.y += pen * 0.7;
    if (touch) { b.w.multiplyScalar(1 - Math.min(0.5, 3.2 * h)); b.v.x *= 1 - 1.4 * h; b.v.z *= 1 - 1.4 * h; }       // things do not roll and skate for ever: legs catch, bags sag
    return touch;
  }
  function sleep(b) {
    b.awake = false; b.v.set(0, 0, 0); b.w.set(0, 0, 0); S.awake--;
    let top = -1e9; for (const p of b.pts) { const y = _v.copy(p).applyQuaternion(b.q).y; if (y > top) top = y; }
    if (b.p.y + top - ground(b) > 0.45) b.circle = st.addCircle(b.p.x, -b.p.z, Math.min(0.4, Math.max(0.16, b.rh * 0.75)), 'prop');      // still standing tall: it blocks again where it is (a thing lying flat is stepped over)
  }

  // ---------------------------------------------------------------- who touches what
  const cars = [];
  function carList() { cars.length = 0; const pl = game.player; for (const v of game.vehicles || []) if (Math.abs(v.x - pl.x) < 70 && Math.abs(v.y - pl.y) < 70) cars.push({ c: v, vx: v.vx || 0, vy: v.vy || 0, own: v === pl.vehicle });
    for (const c of (game.traffic && game.traffic.cars) || []) if (Math.abs(c.x - pl.x) < 70 && Math.abs(c.y - pl.y) < 70) cars.push({ c, vx: Math.cos(c.h) * (c.v || 0), vy: Math.sin(c.h) * (c.v || 0), own: false }); }
  // a fence panel that has been knocked flat is no wall any more: its line is taken out of the game's walls
  function unwall(rec) { const c = st.cell, hx = Math.cos(rec.h), hy = Math.sin(rec.h); let n = 0;
    for (let i = Math.floor((rec.x - 3) / c); i <= Math.floor((rec.x + 3) / c); i++) for (let j = Math.floor((rec.y - 3) / c); j <= Math.floor((rec.y + 3) / c); j++) { const a = st.segs.get(st.key(i, j)); if (!a) continue;
      for (let q = a.length - 1; q >= 0; q--) { const s = a[q], dx = s[2] - s[0], dy = s[3] - s[1], l = Math.hypot(dx, dy); if (l > 4 || l < 0.2) continue; const t = Math.max(0, Math.min(1, ((rec.x - s[0]) * dx + (rec.y - s[1]) * dy) / (l * l))), d = Math.hypot(rec.x - s[0] - dx * t, rec.y - s[1] - dy * t);
        if (d < 0.12 && (Math.abs(dx * hy - dy * hx) / l < 0.15 || Math.abs(dx * hx + dy * hy) / l < 0.15)) { a.splice(q, 1); n++; } } }
    S.unwalled += n; return n; }
  // before the game moves anything: props about to be touched wake up (their circles go, so the car or the player is not stopped dead)
  function pre() {
    const pl = game.player;
    if (!pl.vehicle) { const sp = pl.speed || 0; if (sp > 0.05) { const fx = Math.cos(pl.h), fy = Math.sin(pl.h); near(pl.x, pl.y, 1.6, (rec) => { if (rec.body || rec.dead) return; const sh = shOf(rec), dx = rec.x - pl.x, dy = rec.y - pl.y, d = Math.hypot(dx, dy), rr = 0.5 * Math.max(sh.size.x, sh.size.z) * sh.k; if (d < Math.max(rr, 0.32) + PLAYER_R + 0.16 && dx * fx + dy * fy > 0) wake(rec); }); } }
    carList();
    for (const k of cars) { const sp = Math.hypot(k.vx, k.vy); if (sp < 0.4) continue; const c = k.c, L = (c.def ? c.def.len : 4.4) / 2 + 0.5 + sp * 0.12, W = (c.def ? c.def.wid : 1.8) / 2 + 0.45, ch = Math.cos(c.h), shn = Math.sin(c.h);
      near(c.x, c.y, L + 1, (rec) => { if (rec.body || rec.dead || rec.fx === 2) return; const dx = rec.x - c.x, dy = rec.y - c.y, lx = dx * ch + dy * shn, ly = -dx * shn + dy * ch;
        if (!rec.fx) { if (Math.abs(lx) < L && Math.abs(ly) < W) wake(rec); return; }
        // a fixed thing: the car has to be going at it fast enough, and the blow costs the car speed and a dent
        const L2 = (c.def ? c.def.len : 4.4) / 2 + 0.3 + sp * 0.04, W2 = (c.def ? c.def.wid : 1.8) / 2 + (rec.name === 'fence' ? 0.9 : 0.12); if (sp < BREAK_SPEED || Math.abs(lx) > L2 || Math.abs(ly) > W2 || (dx * k.vx + dy * k.vy) < 0) return;
        S.force = true; let b = null; try { b = wake(rec); if (b) { S.broken++; near(rec.x, rec.y, 0.5, (pl2) => { if (pl2.fx === 2 && !pl2.body && !pl2.dead && Math.hypot(pl2.x - rec.x, pl2.y - rec.y) < 0.35) { const b2 = wake(pl2); if (b2) b2.v.set(k.vx * 0.5, 0.5, -k.vy * 0.5); } }); } } finally { S.force = false; }
        if (!b) return; if (rec.name === 'fence') unwall(rec);
        b.v.set(k.vx * 0.4, 0.9 + sp * 0.04, -k.vy * 0.4); b.w.set(-k.vy / sp * 2.2, 0, -k.vx / sp * 2.2);
        const lose = rec.name === 'fence' ? 0.9 : 0.86; if (c.vx !== undefined) { c.vx *= lose; c.vy *= lose; } else if (c.v !== undefined) c.v *= lose;
        if (game.__crash && game.__crash.hit) { try { game.__crash.hit(c, _v.set(rec.x, (c.z || 0) + 0.5, -rec.y), _a.set(-k.vx / sp, 0, k.vy / sp), sp * 0.7, rec.name === 'fence' ? undefined : { narrow: true }); } catch (e) {} } }); }
  }
  function contacts(dt) {
    const pl = game.player, B = S.bodies;
    // the player on foot: shoves what they walk into, knocks over what they run into
    if (!pl.vehicle) { const sp = pl.speed || 0, fx = Math.cos(pl.h) * sp, fz = -Math.sin(pl.h) * sp, py = (st.onSidewalk(pl.x, pl.y) ? 0.15 : 0);
      for (const b of B) { const dx = b.p.x - pl.x, dz = b.p.z + pl.y; if (Math.abs(dx) > 1.5 || Math.abs(dz) > 1.5 || b.p.y - py > 1.9) continue; const d = Math.hypot(dx, dz) || 1e-3, R = Math.min(b.rh, 0.45) + PLAYER_R; if (d >= R) continue;
        const nx = dx / d, nz = dz / d, rel = (fx - b.v.x) * nx + (fz - b.v.z) * nz; if (rel <= 0.02) continue; if (!b.awake) wake(b.rec);
        const run = sp > 3, over = b.t > 0.25 && _v.copy(UP).applyQuaternion(b.q).y < 0.6, kick = !(b.kt > 0); b.kt = over ? 0.6 : run ? 0.35 : 0.12; b.over = over;      /* one kick per contact, not a push every step (that carried things along at the runner's pace); once it is over, feet go past it */
        const k = !kick ? 0 : (over ? 0.3 : 1) * ((run ? 0.8 : 0.9) * PLAYER_M / (PLAYER_M + 2.5 * b.m)) * rel; _d.set(nx * k * b.m, (run ? 0.22 : 0) * k * b.m, nz * k * b.m); /* a walk shoves it along at walking pace; a run sends it ahead and over; heavy things barely move */
        _a.set(b.p.x - nx * b.rh * 0.6, run ? py + Math.min(b.hgt * 0.9, 0.95) : ground(b) + b.hgt * 0.12, b.p.z - nz * b.rh * 0.6); /* (walking: pushed at its middle, it slides; running: caught high, it tips) */ if (kick) push(b, _d, _a); if (over) continue; const hv = b.m / (b.m + 25), ov = R - d; b.p.x += nx * ov * (1 - hv); b.p.z += nz * ov * (1 - hv); pl.x -= nx * ov * hv; pl.y += nz * ov * hv; } }      // a heavy thing (a newspaper box) gives way slowly: the player is held up by it
    // cars: whatever is inside a moving car's outline is thrown ahead and aside
    for (const k of cars) { const sp = Math.hypot(k.vx, k.vy); if (sp < 0.4) continue; const c = k.c, L = (c.def ? c.def.len : 4.4) / 2, W = (c.def ? c.def.wid : 1.8) / 2, ch = Math.cos(c.h), shn = Math.sin(c.h);
      for (const b of B) { const dx = b.p.x - c.x, dy = -b.p.z - c.y; if (Math.abs(dx) > L + 2 || Math.abs(dy) > L + 2 || b.p.y - (c.z || 0) > 1.7) continue; const rb = Math.min(b.rh, 0.4), lx = dx * ch + dy * shn, ly = -dx * shn + dy * ch, ox = L + rb - Math.abs(lx), oy = W + rb - Math.abs(ly); if (ox <= 0 || oy <= 0) continue;
        if (!b.awake) wake(b.rec);
        let nx, ny; if (ox < oy) { const s = Math.sign(lx) || 1; nx = ch * s; ny = shn * s; b.p.x += nx * ox; b.p.z -= ny * ox; } else { const s = Math.sign(ly) || 1; nx = -shn * s; ny = ch * s; b.p.x += nx * oy; b.p.z -= ny * oy; }
        const rel = (k.vx - b.v.x) * nx + (k.vy + b.v.z) * ny; if (rel <= 0) continue;
        const jit = ((b.slot * 7919) % 13) / 13 - 0.5, kk = 1.15 * rel + 0.3; _d.set((nx * kk + (k.vx / sp) * 0.2 * rel - ny * jit * 0.25 * rel) * b.m, Math.min(5, 0.6 + 0.16 * sp) * (0.7 + 0.6 * (jit + 0.5)) * b.m, -(ny * kk + (k.vy / sp) * 0.2 * rel + nx * jit * 0.25 * rel) * b.m);
        _a.set(b.p.x - nx * rb, (c.z || 0) + 0.45, b.p.z + ny * rb); push(b, _d, _a);
        if (k.own && sp > 2) { const lose = Math.min(0.02, b.m / 2500); c.vx *= 1 - lose; c.vy *= 1 - lose; if (S.sound) S.sound(b, sp); } } }
    // bodies against each other, and against props still asleep (a thrown chair wakes the table it lands on)
    for (let i = 0; i < B.length; i++) { const a = B[i]; if (!a.awake) continue;
      for (let j = 0; j < B.length; j++) { if (j === i) continue; const b = B[j]; if (b.awake && j < i) continue; _n.copy(b.p).sub(a.p); const d = _n.length(), R = (a.r + b.r) * 0.62; if (d >= R || d < 1e-4) continue; _n.multiplyScalar(1 / d);
        const rel = _v.copy(a.v).sub(b.v).dot(_n); if (!b.awake) { if (rel < 0.5) continue; wake(b.rec); }
        const ma = a.m, mb = b.m, pn = (R - d); a.p.addScaledVector(_n, -pn * mb / (ma + mb)); b.p.addScaledVector(_n, pn * ma / (ma + mb)); if (rel > 0) { const J = 1.3 * rel * ma * mb / (ma + mb); _d.copy(_n).multiplyScalar(J); _a.copy(a.p).addScaledVector(_n, a.r * 0.6); push(b, _d, _a); _d.multiplyScalar(-1); push(a, _d, _a); } }
      if (a.v.lengthSq() > 0.6) near(a.p.x, -a.p.z, a.r + 0.6, (rec) => { if (rec.body || rec.dead) return; const sh = shOf(rec), d = Math.hypot(rec.x - a.p.x, rec.y + a.p.z); if (d < a.rh + 0.5 * Math.max(sh.size.x, sh.size.z) * sh.k && a.p.y - rec.z < sh.size.y * sh.k + a.r) wake(rec); }); }
  }
  function walls(b) {       // buildings, fences, trees, posts and props still standing
    const r = Math.min(0.3, b.rh * 0.6), x = b.p.x, y = -b.p.z; if (!st.resolve(x, y, r, _o)) return; const nx = _o.x - x, ny = _o.y - y, d = Math.hypot(nx, ny); if (d < 1e-5) return;
    b.p.x = _o.x; b.p.z = -_o.y; const ux = nx / d, uy = ny / d, vn = b.v.x * ux - b.v.z * uy; if (vn < 0) { b.v.x -= 1.3 * vn * ux; b.v.z += 1.3 * vn * uy; }
  }

  // ---------------------------------------------------------------- the frame
  function post(dt) {
    if (!S.bodies.length) return; contacts(dt);
    if (!S.awake) return; const pl = game.player, n = Math.max(1, Math.min(4, Math.round(dt / SUB)));
    for (const b of S.bodies) { if (b.kt > 0) b.kt -= dt; if (!b.awake) continue; b.t += dt; let touch = 0; for (let k = 0; k < n; k++) touch = step(b, dt / n); walls(b);
      if (Math.abs(b.p.x - pl.x) > 90 || Math.abs(b.p.z + pl.y) > 90) { sleep(b); write(b); continue; }       // only near the player
      if (touch && b.v.lengthSq() < 0.03 && b.w.lengthSq() < 0.12) { b.rest += dt; if (b.rest > 0.5) sleep(b); } else b.rest = 0;
      write(b); }
  }
  const gstep = game.step.bind(game);
  game.step = (dt) => { if (!S.on) return gstep(dt); try { pre(); } catch (e) { fail(e); } gstep(dt); try { post(dt); } catch (e) { fail(e); } };
  let fails = 0; const fail = (e) => { if (fails++ < 3) console.warn('[props] ' + String((e && e.stack) || e).slice(0, 400)); if (fails > 20) S.on = false; };

  // ---------------------------------------------------------------- for guns, breaks and explosions (world coordinates)
  const wakeNear = (p, r) => { near(p.x, -p.z, r + 1, (rec) => { if (rec.body || rec.dead) return; const sh = shOf(rec), hy = sh.size.y * sh.k; if (Math.hypot(rec.x - p.x, rec.y + p.z) < r + 0.5 * Math.max(sh.size.x, sh.size.z) * sh.k && p.y > rec.z - r && p.y < rec.z + hy + r) wake(rec); }); };
  S.impulse = (point, vec, radius = 0.6) => { if (!S.on) return 0; wakeNear(point, radius); let n = 0; for (const b of S.bodies) { if (b.p.distanceTo(point) > radius + b.r) continue; if (!b.awake) wake(b.rec); push(b, vec, point); n++; } return n; };
  S.blast = (point, power = 1, radius = 6) => { if (!S.on) return 0; S.force = power >= 1; try { wakeNear(point, S.force ? Math.min(radius, 3.5 * power) : radius); if (!S.force) wakeNear(point, radius); else { S.force = false; wakeNear(point, radius); } } finally { S.force = false; } let n = 0;
    for (const b of S.bodies) { _n.copy(b.p).sub(point); const d = _n.length(); if (d > radius) continue; if (!b.awake) wake(b.rec); _n.y = Math.abs(_n.y) + 0.6 * Math.max(0.3, d); _n.normalize(); const f = power * 9 * Math.pow(1 - d / radius, 1.5) * Math.min(b.m, 14); _d.copy(_n).multiplyScalar(f); _a.copy(b.p).addScaledVector(_n, -b.r * 0.4); _a.y -= b.hgt * 0.2; push(b, _d, _a); n++; } return n; };
  S.ray = (origin, dir, impulse = 40, maxDist = 80) => { if (!S.on) return null; const d = _b.copy(dir).normalize(); let best = null, bt = maxDist;
    const test = (cx, cy, cz, r, what) => { _v.set(cx - origin.x, cy - origin.y, cz - origin.z); const t = _v.dot(d); if (t < 0 || t > bt) return; const m2 = _v.lengthSq() - t * t; if (m2 > r * r) return; bt = t - Math.sqrt(r * r - m2) * 0.5; best = what; };
    for (const b of S.bodies) test(b.p.x, b.p.y, b.p.z, b.r * 0.8, b);
    for (let t = 0; t < maxDist; t += CELL) { const x = origin.x + d.x * t, y = -(origin.z + d.z * t); near(x, y, CELL * 0.6, (rec) => { if (rec.body || rec.dead) return; const sh = shOf(rec), hy = sh.size.y * sh.k; test(rec.x, rec.z + hy * 0.5, -rec.y, 0.4 * Math.hypot(sh.size.x * sh.k, hy, sh.size.z * sh.k), rec); }); if (t > bt + CELL) break; }
    if (!best) return null; const b = best.rec ? (best.awake ? best : wake(best.rec)) : wake(best); if (!b) return null; const at = new THREE.Vector3().copy(origin).addScaledVector(d, bt); push(b, _d.copy(d).multiplyScalar(impulse), at); return { point: at, kind: b.rec.name }; };
  // a break at `point` (the breakable pass calls this): true when a loose prop took the blow
  S.strike = (point, dir, power = 2) => { if (!S.on) return false; const n = S.impulse(point, _c.copy(dir).normalize().multiplyScalar(30 * power).setY(8 * power), 0.25); if (power >= 3) S.blast(point, power * 0.5, 2 + power); return n > 0; };
  S.stats = () => ({ recs: S.recs, clutter: S.clutter, plazaMeshes: S.plaza, bodies: S.bodies.length, awake: S.awake, woken: S.woken, broken: S.broken, unwalled: S.unwalled, pools: pools.size });
  return S;
}
