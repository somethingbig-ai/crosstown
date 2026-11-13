// crash.js: cars crumple where they are hit, by how hard, and stay that way (players, Nov 11: "cars just stop on impact").
// One file, no dependencies but three.js and the game object: `install(game)` once at the end of Game.init. Off switch: ?crash=0.
//   - it listens to the game's own crash event (game.onCrash) and works out where the blow landed and from which side (the wall, post
//     or car the body's circles are touching, else the way the car was going);
//   - the struck car is taken over: each frame, after the game has filled its instance buffers, the car's body instances are found
//     by where the car is, zeroed, and this file's own copies (the game's geometry, dented; the game's materials and paint) are drawn
//     at the same matrix. Wheels are left to the game. A car that was never hit costs nothing; a hit costs one pass over its vertices;
//   - sheet metal crushes: what stood proud of the contact plane is pushed back to it, the metal behind buckles in a few long
//     folds, the hood or boot lid lifts. No cracks, no noise: creases;
//   - the other car in a collision is dented too: traffic, cars the player has left, and parked cars (a dented parked car keeps
//     its dents when the player gets in and drives it away). A dented car seen from far is rebuilt from the far model, dents laid on again;
//   - what was hit shapes the dent (v3): a pole, tree or hydrant drives a narrow deep V into the car, a wall a broad flat crush, another car something between;
//     a window whose glass is bent past a few centimetres shatters: the pane is gone from the car and its crumbs fall to the road; chips of paint fly from every hard blow;
//   - for gameplay: game.__crash.damage(vehicle) -> { front, rear, left, right, total } each 0..1 (how crushed that end is),
//     and game.__crash.onDamage = (vehicle, zone, amount, total) => {} is called on every blow (make it pull, smoke, stall).
//     game.__crash.hit(vehicle, point, dir, force[, { depth, radius }]) dents by hand (world coordinates; force in m/s of closing speed;
//     with depth and radius in metres it is a local blow where it was aimed: a bullet, a bat, a blast).
//     game.__crash.repair(vehicle) gives the car back as new.
import * as THREE from 'three';

const _e2 = new THREE.Euler(), _q2 = new THREE.Quaternion(), _s2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _o = {};
const MAXCARS = 12, LIMIT = { front: 0.55, rear: 0.45, left: 0.3, right: 0.3 }, BITS = 420;

export function install(game, opts = {}) {
  if (game.__crash) return game.__crash;
  const S = (game.__crash = { on: true, cars: [], hits: 0, relods: 0, heirs: 0, panes: 0, onDamage: null });
  S.damage = (v) => { const it = S.cars.find((i) => i.v === v), z = it ? it.zone : { front: 0, rear: 0, left: 0, right: 0 }; const o = { front: z.front / LIMIT.front, rear: z.rear / LIMIT.rear, left: z.left / LIMIT.left, right: z.right / LIMIT.right }; o.total = Math.min(1, (o.front + o.rear + o.left + o.right) / 2); return o; };
  S.hit = () => false; S.repair = () => {};
  if (game.P && game.P.get('crash') === '0') { S.on = false; return S; }
  const world = game.world, scene = world.scene, st = game.statics;
  const groupOf = () => S.group || (S.group = scene.getObjectByName('streets_vehicles')) || null;

  // ---------------------------------------------------------------- taking a car over
  // the body instances of the car at (x, z): one per instanced mesh that draws something there (not its shadow patches, not its wheels)
  function partsAt(x, z, tol = 0.03) {
    const out = [], g = groupOf(); if (!g) return out;
    for (const o of g.children) { if (!o.isInstancedMesh || o.userData.crashOwn || !o.visible || !o.count) continue; const m = o.material; if (!m || m.blending !== THREE.NormalBlending) continue;      /* (glass is taken too: it shares the body's buffer) */ const pc = o.geometry.attributes.position; if (!pc || pc.count < 60) continue;
      const a = o.instanceMatrix.array, n = Math.min(o.count, a.length / 16); for (let i = 0; i < n; i++) { const k = i * 16; if (Math.abs(a[k + 12] - x) < tol && Math.abs(a[k + 14] - z) < tol && (a[k] !== 0 || a[k + 2] !== 0)) { out.push({ mesh: o, id: i }); break; } } }
    return out;
  }
  function copyOf(f, id) {
    const g = new THREE.BufferGeometry(), sg = f.geometry; for (const n of Object.keys(sg.attributes)) { const at = sg.attributes[n]; if (at.isInstancedBufferAttribute) { const s = at.itemSize; g.setAttribute(n, new THREE.InstancedBufferAttribute(at.array.slice(id * s, id * s + s), s, at.normalized)); } else if (n === 'position' || n === 'normal') g.setAttribute(n, at.clone()); else g.setAttribute(n, at); }
    g.setIndex(sg.index); for (const gr of sg.groups || []) g.addGroup(gr.start, gr.count, gr.materialIndex);
    const im = new THREE.InstancedMesh(g, f.material, 1); if (f.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(f.instanceColor.array.slice(id * 3, id * 3 + 3), 3);
    im.castShadow = f.castShadow; im.receiveShadow = f.receiveShadow; im.renderOrder = f.renderOrder; im.frustumCulled = false; im.layers.mask = f.layers.mask; im.matrixAutoUpdate = false; im.name = 'crash_' + (f.name || 'part');
    if (f.customDepthMaterial) im.customDepthMaterial = f.customDepthMaterial; if (f.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) im.onBeforeRender = f.onBeforeRender;
    im.userData.crashOwn = true; im.userData.brkOwn = true; im.userData.kind = f.userData.kind; scene.add(im); const m0 = Array.isArray(f.material) ? f.material[0] : f.material;
    return { src: f, im, g, n0: g.attributes.normal ? g.attributes.normal.array.slice() : null, glass: !!(m0 && (m0.transparent || /glass/i.test(m0.name || ''))) && g.attributes.position.count < 60000, comp: null, dead: null };
  }
  function take(v) {
    let it = S.cars.find((i) => i.v === v); if (it) return it;
    const now = partsAt(v.x, -v.y); if (!now.length) return null;
    it = { v, parts: [], M: new THREE.Matrix4(), zone: { front: 0, rear: 0, left: 0, right: 0 }, lost: 0, n: 0, box: new THREE.Box3(), log: [], chg: 0, orphan: 0 };
    now[0].mesh.getMatrixAt(now[0].id, it.M);
    build(it, now);
    S.cars.push(it); if (S.cars.length > MAXCARS) { const pv = game.player && game.player.vehicle; drop(S.cars.find((i) => i.v !== pv && i !== it) || S.cars[0]); }
    return it;
  }
  function build(it, now) { for (const p of now) { const c = copyOf(p.mesh, p.id); it.parts.push(c); if (!it.log.length) { const a = c.g.attributes.position.array; for (let i = 0; i < a.length; i += 3) if (a[i + 1] > -1.5 && a[i + 1] < 6) it.box.expandByPoint(_v.set(a[i], a[i + 1], a[i + 2])); }      /* (some models park hidden pieces far under the ground: not the body) */ c.im.setMatrixAt(0, it.M); c.im.instanceMatrix.needsUpdate = true; } }
  function strip(it) { for (const p of it.parts) { scene.remove(p.im); p.g.dispose(); p.im.dispose(); } it.parts.length = 0; }
  function drop(it) { strip(it); const i = S.cars.indexOf(it); if (i >= 0) S.cars.splice(i, 1); }
  // the game now draws this car from another model (nearer or farther detail band): our copy is made again from that one and the dents laid on again
  function relod(it, now) { strip(it); build(it, now); S.replay = true; try { for (const h of it.log) crush(it, h.c, h.d, h.D, h.R, h.seed); } finally { S.replay = false; } S.relods++; }
  S.repair = (v) => { const it = S.cars.find((i) => i.v === v); if (it) drop(it); };
  const alive = (v) => (v.circles ? !v.gone : (game.vehicles && game.vehicles.includes(v)) || (game.traffic && game.traffic.cars.includes(v)));
  // a dented parked or traffic car the player gets into: the game makes a Vehicle where that one stood; the dents go with it
  const heir = (s) => { if (!(s.circles ? s.gone : s.def && !(game.vehicles || []).includes(s))) return null; let best = null, bd = 2.5; for (const n of game.vehicles || []) { const d = Math.hypot(n.x - s.x, n.y - s.y); if (d < bd) { bd = d; best = n; } } return best; };
  // once a frame, when the game has refilled its buffers: the game's own instances of a taken car are zeroed, ours stand in
  function sweep() {
    for (let n = S.cars.length - 1; n >= 0; n--) { const it = S.cars[n]; let v = it.v;
      if (!alive(v)) { const nv = heir(v); if (!nv) { if (++it.orphan > 90) drop(it); else for (const p of it.parts) p.im.visible = false; continue; } const dup = S.cars.find((i) => i.v === nv && i !== it); if (dup && dup.log.length) { drop(it); continue; } if (dup) { drop(dup); n = S.cars.indexOf(it); } v = it.v = nv; it.orphan = 0; S.heirs++; }
      const now = partsAt(v.x, -v.y); if (!now.length) { it.lost++; for (const p of it.parts) p.im.visible = false; if (it.lost > 1800 && v !== (game.player && game.player.vehicle)) drop(it); continue; }
      it.lost = 0; now[0].mesh.getMatrixAt(now[0].id, it.M); const done = new Set();
      let same = now.length === it.parts.length; for (let i = 0; same && i < now.length; i++) if (now[i].mesh !== it.parts[i].src) same = false;
      if (same) it.chg = 0; else if (++it.chg > 12) { it.chg = 0; relod(it, now); }
      for (const p of now) { const at = p.mesh.instanceMatrix; if (!done.has(at)) { done.add(at); const a = at.array, k = p.id * 16; a[k] = a[k + 1] = a[k + 2] = a[k + 4] = a[k + 5] = a[k + 6] = a[k + 8] = a[k + 9] = a[k + 10] = 0; at.needsUpdate = true; } }
      for (const p of it.parts) { p.im.visible = true; p.im.setMatrixAt(0, it.M); p.im.instanceMatrix.needsUpdate = true; } }
  }
  let frameNo = 0, swept = -1; const wrender = world.render.bind(world); world.render = (t, f) => { frameNo++; return wrender(t, f); };
  const prevOBR = scene.onBeforeRender;
  scene.onBeforeRender = function (r, sc, cam, rt) { if (prevOBR) prevOBR.call(this, r, sc, cam, rt); if (S.on && (S.cars.length || queue.length || bl.length) && cam.isPerspectiveCamera && swept !== frameNo) { swept = frameNo; try { apply(); sweep(); stepBits(); } catch (e) { fail(e); } } };      // (the first view drawn each frame; the buffers are refilled by the game before the next)
  let fails = 0; const fail = (e) => { if (fails++ < 3) console.warn('[crash] ' + String((e && e.stack) || e).slice(0, 400)); if (fails > 20) S.on = false; };

  // ---------------------------------------------------------------- glass and chips
  // the panes of a glass part: its connected pieces (a windscreen, a door window), found once when the car is first hit
  function panes(p) {
    const a = p.g.attributes.position.array, n = a.length / 3, par = new Int32Array(n), ix = p.g.index ? p.g.index.array : null, find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }, uni = (x, y) => { x = find(x); y = find(y); if (x !== y) par[y] = x; };
    for (let i = 0; i < n; i++) par[i] = i; const weld = new Map(); for (let i = 0; i < n; i++) { const k = Math.round(a[i * 3] * 400) + ',' + Math.round(a[i * 3 + 1] * 400) + ',' + Math.round(a[i * 3 + 2] * 400), w = weld.get(k); if (w === undefined) weld.set(k, i); else uni(w, i); }
    const nt = (ix ? ix.length : n) / 3; for (let t2 = 0; t2 < nt; t2++) { const i0 = ix ? ix[t2 * 3] : t2 * 3, i1 = ix ? ix[t2 * 3 + 1] : t2 * 3 + 1, i2 = ix ? ix[t2 * 3 + 2] : t2 * 3 + 2; uni(i0, i1); uni(i1, i2); }
    p.comp = new Int32Array(n); p.csize = new Map(); for (let i = 0; i < n; i++) { const c2 = (p.comp[i] = find(i)); p.csize.set(c2, (p.csize.get(c2) || 0) + 1); } p.dead = {};
  }
  // a pane bent too far is gone: its triangles are folded to nothing and its crumbs fall where it stood
  function shatter(it, p, cm, d) {
    const a = p.g.attributes.position.array, n = a.length / 3;
    for (const [c2, hitN] of cm) { if (hitN < 3 && hitN < p.csize.get(c2) * 0.2) continue; p.dead[c2] = true; S.panes++; const pts = [];
      for (let i = 0; i < n; i++) if (p.comp[i] === c2) { if (pts.length < 40 && (i % 3 === 0 || p.csize.get(c2) < 60)) pts.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); a[i * 3] = a[c2 * 3]; a[i * 3 + 1] = a[c2 * 3 + 1]; a[i * 3 + 2] = a[c2 * 3 + 2]; }
      if (!S.replay) for (let k = 0; k < pts.length; k += 3) { _v.set(pts[k], pts[k + 1], pts[k + 2]).applyMatrix4(it.M); for (let j = 0; j < 3; j++) bit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 1.6 - d.x * 0.6, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6 - d.z * 0.6, 0.012 + Math.random() * 0.02, 0.72, 0.9, 0.86); } }
  }
  // small things thrown by a blow (glass crumbs, chips of paint): one instanced mesh for all of them, drawn only while any is about
  let bits = null; const bl = [], bcol = new THREE.Color();
  function bit(x, y, z, vx, vy, vz, sz, r, g2, b2) {
    if (!bits) { bits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.45, 0.8), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }), BITS); bits.frustumCulled = false; bits.count = 0; bits.castShadow = false; bits.userData.crashOwn = true; bits.userData.brkOwn = true; bits.name = 'crash_bits'; scene.add(bits); }
    if (bl.length >= BITS) bl.shift(); bl.push({ x, y, z, vx, vy, vz, sz, r, g: g2, b: b2, t: 0, rot: Math.random() * 6.28, rest: false });
  }
  let tPrev = 0;
  function stepBits() {
    if (!bits) return; const now = performance.now(), dt = Math.min(0.05, tPrev ? (now - tPrev) / 1000 : 0.016); tPrev = now; if (!bl.length) { if (bits.count) { bits.count = 0; bits.visible = false; } return; }
    let n = 0; for (let i = bl.length - 1; i >= 0; i--) { const q = bl[i]; q.t += dt; if (q.t > 26) { bl.splice(i, 1); continue; }
      if (!q.rest) { q.vy -= 9.81 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += dt * 9; const gy = 0.012 + q.sz * 0.2; if (q.y < gy) { q.y = gy; if (q.vy < -1.2) { q.vy *= -0.25; q.vx *= 0.5; q.vz *= 0.5; } else q.rest = true; } } }
    for (const q of bl) { const k = q.t > 22 ? Math.max(0, (26 - q.t) / 4) : 1; _e2.set(q.rest ? 0 : q.rot, q.rot, q.rest ? 0 : q.rot * 0.7); _q2.setFromEuler(_e2); _s2.setScalar(q.sz * k); _m.compose(_v.set(q.x, q.y, q.z), _q2, _s2); bits.setMatrixAt(n, _m); bits.setColorAt(n, bcol.setRGB(q.r, q.g, q.b)); n++; }
    bits.count = n; bits.visible = n > 0; bits.instanceMatrix.needsUpdate = true; if (bits.instanceColor) bits.instanceColor.needsUpdate = true;
  }
  // ---------------------------------------------------------------- the dent
  // c: contact point, d: unit direction the metal is pushed (into the car), both in the car's own space; D: how deep (m); R: half width of the blow
  function crush(it, c, d, D, R, seed) {
    const up = Math.abs(d.y) > 0.9 ? _v.set(1, 0, 0) : _v.set(0, 1, 0), tx = new THREE.Vector3().crossVectors(up, d).normalize(), ty = new THREE.Vector3().crossVectors(d, tx);
    const B = it.box, top = B.max.y, bot = B.min.y, L = 0.55 + D * 2.2, a1 = 0.35 + (seed % 1) * 0.5, a2 = 1.1 + ((seed * 1.7) % 1) * 0.6;
    for (const p of it.parts) { const pos = p.g.attributes.position, a = pos.array; let ch = false; const touched = []; if (p.glass && !p.comp) panes(p); const cm = p.glass ? new Map() : null;
      for (let i = 0; i < a.length; i += 3) {
        const rx = a[i] - c.x, ry = a[i + 1] - c.y, rz = a[i + 2] - c.z, s = -(rx * d.x + ry * d.y + rz * d.z) /* how far the vertex stands proud of the contact plane (+: outside) */, u = rx * tx.x + ry * tx.y + rz * tx.z, w = rx * ty.x + ry * ty.y + rz * ty.z;
        if (s < -L) continue; const lat = Math.hypot(u / R, w / (R * 1.6)); if (lat >= 1.7) continue;
        const fall = lat < 1 ? 1 - 0.35 * lat * lat : Math.max(0, 0.65 * (1.7 - lat) / 0.7), plane = D * fall;         // the wall's face, as deep as it came in here
        let push = 0; if (s > -plane) push = (s + plane) * (0.92 + 0.08 * Math.min(1, fall));            // what stood in the wall's way is pressed back to it
        else push = plane * 0.3 * Math.exp((s + plane) / (L * 0.45));                                    // the metal behind is carried in a little
        if (push < 1e-4) continue;
        // long folds across the crush (a triangle wave: metal creases, it does not ripple), deeper where more was pressed
        const f = (Math.abs(((u * a1 + w * 0.3) / R * 1.15 + seed) % 1 - 0.5) * 2 - 0.5) * 0.11 + (Math.abs(((w * a2 - u * 0.25) / R * 0.8 + seed * 2.1) % 1 - 0.5) * 2 - 0.5) * 0.06, k = push + f * Math.min(push, D) * 1.0;
        a[i] += d.x * k; a[i + 1] += d.y * k; a[i + 2] += d.z * k;
        // a lid over the crushed end buckles up along its middle; low panels tuck under
        if (Math.abs(d.y) < 0.5) { const h = (a[i + 1] - bot) / Math.max(0.2, top - bot), lift = push * 0.28 * Math.max(0, 1 - Math.abs(h - 0.62) / 0.3) * Math.max(0, 1 - Math.abs(-s - plane - L * 0.25) / (L * 0.5)); a[i + 1] += lift - push * 0.06 * Math.max(0, 0.3 - h); }
        ch = true; touched.push(i); if (cm && push > 0.055) { const c2 = p.comp[i / 3]; if (!p.dead[c2]) cm.set(c2, (cm.get(c2) || 0) + 1); } }
      if (!ch) continue; pos.needsUpdate = true; if (cm && cm.size) shatter(it, p, cm, d);
      // normals: recomputed for the dented part only, joined across split vertices that share a place (no seams open, no hard black edges)
      const nor = p.g.attributes.normal; if (nor) { const ix = p.g.index ? p.g.index.array : null, nt = (ix ? ix.length : a.length / 3) / 3, acc = new Map(), mark = new Uint8Array(a.length / 3); for (const i of touched) mark[i / 3] = 1;
        const key = (vi) => Math.round(a[vi * 3] * 500) + ',' + Math.round(a[vi * 3 + 1] * 500) + ',' + Math.round(a[vi * 3 + 2] * 500);
        for (let t = 0; t < nt; t++) { const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2; if (!mark[i0] && !mark[i1] && !mark[i2]) continue;
          const ax = a[i1 * 3] - a[i0 * 3], ay = a[i1 * 3 + 1] - a[i0 * 3 + 1], az = a[i1 * 3 + 2] - a[i0 * 3 + 2], bx = a[i2 * 3] - a[i0 * 3], by = a[i2 * 3 + 1] - a[i0 * 3 + 1], bz = a[i2 * 3 + 2] - a[i0 * 3 + 2], nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          for (const vi of [i0, i1, i2]) { if (!mark[vi]) continue; const k = key(vi); let q = acc.get(k); if (!q) acc.set(k, (q = [0, 0, 0])); q[0] += nx; q[1] += ny; q[2] += nz; } }
        const na = nor.array; for (const i of touched) { const q = acc.get(key(i / 3)); if (!q) continue; const l = Math.hypot(q[0], q[1], q[2]); if (l < 1e-12) continue; let x = q[0] / l, y = q[1] / l, z = q[2] / l; if (p.n0 && x * p.n0[i] + y * p.n0[i + 1] + z * p.n0[i + 2] < -0.2) { x = -x; y = -y; z = -z; } na[i] = x; na[i + 1] = y; na[i + 2] = z; } nor.needsUpdate = true; }
      p.g.computeBoundingSphere(); }
  }
  // a blow on a car: point and direction in the world (dir: the way the metal is pushed), force: closing speed in m/s.
  // It is kept in the car's own frame and laid on when the next frame is drawn (the game's buffers then show the car where it is).
  const queue = [];
  S.hit = (v, point, dir, force, opt) => {
    if (!S.on || !(force > 0) || !v) return false; const ch = Math.cos(v.h), sh = Math.sin(v.h), X = point.x - v.x, Z = point.z + v.y;
    const now = performance.now(), lh = v.__crashT || 0; if (!(opt && opt.depth) && now - lh < 300 && force < (v.__crashF || 0) * 1.3) return false; v.__crashT = now; v.__crashF = force;      // one blow, not every bounce of it
    queue.push({ v, c: [X * ch - Z * sh, point.y - (v.z || 0), X * sh + Z * ch], d: [dir.x * ch - dir.z * sh, dir.y, dir.x * sh + dir.z * ch], force, opt: opt || null }); if (queue.length > 24) queue.shift(); S.hits++; return true;
  };
  function apply() {
    const q = queue.splice(0); for (const hq of q) { const v = hq.v, it = take(v); if (!it) continue;
      // from the car's frame to the model's (through where the car is drawn now: whatever scale or offset the game draws it with)
      const ch = Math.cos(v.h), sh = Math.sin(v.h), W = (a, pos) => _v.set(a[0] * ch + a[2] * sh + (pos ? v.x : 0), a[1] + (pos ? (v.z || 0) : 0), -a[0] * sh + a[2] * ch - (pos ? v.y : 0));
      _inv.copy(it.M).invert(); const c = _c.copy(W(hq.c, true)).applyMatrix4(_inv), d = _d.copy(W(hq.d, false)).transformDirection(_inv); d.y *= 0.3; d.normalize(); const force = hq.force;
      // which end took it (the model's axes: +x is its nose, +z its right side)
      const zone = Math.abs(d.x) > Math.abs(d.z) ? (d.x < 0 ? 'front' : 'rear') : (d.z < 0 ? 'right' : 'left'), room = LIMIT[zone] - it.zone[zone]; if (room <= 0.005 || it.log.length >= 40) continue;
      const local = hq.opt && hq.opt.depth > 0, narrow = !!(hq.opt && hq.opt.narrow), want = local ? hq.opt.depth : Math.min(0.5, 0.005 * force + 0.001 * force * force) * (zone === 'left' || zone === 'right' ? 0.8 : 1) * (narrow ? 1.2 : 1), D = Math.min(room, want); if (D < 0.004) continue; it.zone[zone] += D;
      // the contact sits on the body's outline, at bumper height
      const B = it.box; if (local) c.y = Math.min(Math.max(c.y, B.min.y + 0.15), B.max.y); else c.y = Math.min(Math.max(c.y, B.min.y + 0.3), B.min.y + 0.75);      /* (a blow by hand lands where it was aimed; a crash at bumper height) */
      if (zone === 'front') c.x = B.max.x - it.zone.front + D; else if (zone === 'rear') c.x = B.min.x + it.zone.rear - D; else if (zone === 'left') c.z = B.min.z + it.zone.left - D; else c.z = B.max.z - it.zone.right + D;
      c.x = Math.min(B.max.x, Math.max(B.min.x, c.x)); c.z = Math.min(B.max.z, Math.max(B.min.z, c.z));
      const h = { c: c.clone(), d: d.clone(), D, R: local ? (hq.opt.radius || 0.4) : narrow ? 0.2 + force * 0.008 : zone === 'front' || zone === 'rear' ? 0.5 + force * 0.035 : 0.6 + force * 0.04, seed: it.n++ * 1.37 + (v.x || 0) * 0.01 }; it.log.push(h);
      crush(it, h.c, h.d, h.D, h.R, h.seed);
      if (D > 0.04) { const wp = _v.copy(h.c).applyMatrix4(it.M), wx = wp.x, wy = wp.y, wz = wp.z, col = it.parts[0] && it.parts[0].im.instanceColor ? it.parts[0].im.instanceColor.array : [0.5, 0.5, 0.5], nb = Math.min(14, Math.round(D * 60)); for (let j = 0; j < nb; j++) bit(wx + (Math.random() - 0.5) * 0.5, wy + Math.random() * 0.3, wz + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 3, 0.8 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.012 + Math.random() * 0.025, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8); }
      if (S.onDamage) { try { S.onDamage(v, zone, D / LIMIT[zone], S.damage(v).total); } catch (e) {} } }
  }

  // ---------------------------------------------------------------- where did the game's crash land
  const pre = new Map();        // each loose car's velocity before the game's step (after a crash the game has already turned it round)
  const gstep = game.step.bind(game);
  game.step = (dt) => { if (S.on) for (const v of game.vehicles || []) { let p = pre.get(v); if (!p) pre.set(v, (p = { vx: 0, vy: 0 })); p.vx = v.vx; p.vy = v.vy; } gstep(dt); if (pre.size > 12) for (const k of pre.keys()) if (!game.vehicles.includes(k)) pre.delete(k); };
  const onCrash = game.onCrash.bind(game);
  game.onCrash = (v, force) => { onCrash(v, force); if (!S.on) return; try { landed(v, force); } catch (e) { fail(e); } };
  function landed(v, force) {
    const p = pre.get(v) || { vx: v.vx, vy: v.vy }, ch = Math.cos(v.h), sh = Math.sin(v.h), L = v.def.len, r = v.def.wid * 0.5, z = (v.z || 0) + 0.5;
    // another car? the nearest one whose outline is against ours takes the blow too
    let other = null, bd = 1e9; const cand = (o) => { if (o === v) return; const d = Math.hypot(o.x - v.x, o.y - v.y); if (d < (L + (o.def ? o.def.len : 4.5)) * 0.5 + 0.3 && d < bd) { bd = d; other = o; } };
    for (const o of (game.traffic && game.traffic.cars) || []) if (Math.abs(o.x - v.x) < 10 && Math.abs(o.y - v.y) < 10) cand(o); for (const o of game.vehicles || []) cand(o);
    let nx = 0, ny = 0, px = 0, py = 0, found = false, pole = false;
    if (!other && st) for (const o of [L * 0.3, 0, -L * 0.3]) { if (st.resolve(v.x + ch * o, v.y + sh * o, r + 0.22, _o) && _o.tag && _o.tag.def && _o.tag.circles && !_o.tag.gone) { const t = _o.tag, sp = Math.hypot(p.vx, p.vy) || 1; let toward = -1; for (const q of t.circles) { const ex = q.x - (v.x + ch * o), ey = q.y - (v.y + sh * o), el = Math.hypot(ex, ey) || 1; toward = Math.max(toward, (ex * p.vx + ey * p.vy) / (el * sp)); } if (toward > 0.3) { other = t; break; } } }      /* (one we were moving at, not one we brushed past on the way to a wall) */      // a parked car
    if (other) { // the closest pair of points on the two centre lines
      let best = 1e9; const oc = Math.cos(other.h), os = Math.sin(other.h), oL = other.def ? other.def.len : 4.5;
      for (const a of [0.42, 0.3, 0, -0.3, -0.42]) for (const b of [0.42, 0.28, 0, -0.28, -0.42]) { const ax = v.x + ch * L * a, ay = v.y + sh * L * a, bx = other.x + oc * oL * b, by = other.y + os * oL * b, d = Math.hypot(ax - bx, ay - by); if (d < best) { best = d; nx = (ax - bx) / (d || 1); ny = (ay - by) / (d || 1); px = (ax + bx) / 2; py = (ay + by) / 2; } }
      found = true;
      S.hit(other, _v.set(px, z, -py), new THREE.Vector3(-nx, 0, ny), force * 0.8); }
    else if (st) { let dep = -1; for (const o of [L * 0.3, 0, -L * 0.3]) { const cx = v.x + ch * o, cy = v.y + sh * o; if (st.resolve(cx, cy, r + 0.22, _o) && _o.depth > dep && (_o.nx || _o.ny)) { dep = _o.depth; nx = _o.nx; ny = _o.ny; px = cx - _o.nx * r; py = cy - _o.ny * r; found = true; pole = typeof _o.tag === 'string' && /light|tree|signal|hydrant|pole|meter|post/.test(_o.tag); } } }
    if (!found) { const sp = Math.hypot(p.vx, p.vy) || 1; nx = -p.vx / sp; ny = -p.vy / sp; px = v.x - nx * L * 0.5; py = v.y - ny * L * 0.5; }
    S.hit(v, new THREE.Vector3(px, z, -py), new THREE.Vector3(nx, 0, -ny), force, pole ? { narrow: true } : undefined);
  }
  S.stats = () => ({ cars: S.cars.length, hits: S.hits, relods: S.relods, heirs: S.heirs, panes: S.panes, bits: bl.length, parts: S.cars.reduce((n, i) => n + i.parts.length, 0) });
  return S;
}
