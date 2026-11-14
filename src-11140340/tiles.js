// tiles.js (tiles lane): the city's buildings as tiles that load around the camera.
// assets/tiles/tiles.json lists tile SETS (one per built area, see lanes/tiles/RECIPE.md); a set's set.json lists its tiles. Every tile has two forms:
//   FULL   <tile>.t.gz   the mesh the Blender build made, bit for bit (what city.glb held);
//   SHELL  shells.t.gz   the same buildings without the small relief (trim, ironwork, window units), all tiles of a set in one file.
// The first load takes the ground, every shell and the FULL tiles within `first` metres of the start point. After that, each frame's
// update() keeps FULL tiles within `rin` metres of the camera (and of where it will be in four seconds), swaps a tile to FULL as soon as its
// file is in (one swap a frame), and lets a tile fall back to its shell beyond `rout`. A tile whose file is late or fails keeps its shell:
// there is never a hole. Stills, films and judged captures (?shot ?capture) and ?tiles=all load every tile FULL before the first frame,
// which is the picture of before. ?tiles=0 (in world.js) loads city.glb whole, the old way.
// A whole set (its ground and shells) is fetched only when the camera is within `tset` metres of the set's box, so an area far from the start
// costs the first load nothing.
//   url knobs: ?tfirst=250 ?trin=420 ?trout=650 ?tset=2000 ?tahead=4 ?tnet=<bytes per second: slows tile fetches, for tests> ?tshell=0 (no shells: tiles pop, for tests)
// PINNED tiles (set.json "pin": the tiles a hand-built hero building stands in) are always FULL, from the first load on, and have no shell:
// hero.js cuts its buildings' massing out of the tile meshes once at load, and so finds them all there, as it did in city.glb. A pinned
// tile of a set that loads later comes with that set.
// World.buildingMeshes always holds every tile mesh that exists (shell and full); a shell is only hidden (.visible) while its full tile shows.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Q = new URLSearchParams(location.search), num = (k, d) => (Q.has(k) && isFinite(+Q.get(k)) ? +Q.get(k) : d);
const TYPES = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array, i16: Int16Array, i8: Int8Array, u32: Uint32Array };
async function gunzip(url, rate) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (rate) { const len = +r.headers.get('content-length') || buf.byteLength / 5; await new Promise((res) => setTimeout(res, len / rate * 1000)); }     // test knob: a slow link
  return buf;
}
// .t file -> [{ name, geometry, lo, hi }]
export function parseT(buf) {
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x3154594e) throw new Error('not a tile file');     // 'NYT1'
  const jl = dv.getUint32(4, true), j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))), base = 8 + jl, out = [];
  for (const m of j.meshes) {
    const g = new THREE.BufferGeometry();
    for (const a of m.attrs) {
      const T = TYPES[a.type]; let arr = new T(buf, base + a.off, m.verts * a.size);
      if (a.enc === 'q') { const f = new Float32Array(arr.length), n = a.size, k = a.k, add = a.add; for (let i = 0; i < arr.length; i++) f[i] = Math.fround(arr[i] * k + add[i % n]); arr = f; }
      g.setAttribute(a.name, new THREE.BufferAttribute(arr, a.size, !!a.norm && a.enc !== 'q'));
    }
    const d = new Int32Array(buf, base + m.index.off, m.tris * 3), ix = new Uint32Array(d.length); let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; ix[i] = s; }
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...m.lo), new THREE.Vector3(...m.hi)); g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    out.push({ name: m.name, geometry: g, lo: m.lo, hi: m.hi });
  }
  return out;
}

export class Tiles {
  constructor(world, dir = Q.get('tdir') || 'assets/tiles/') {     /* ?tdir=: another tile folder (tests) */
    this.world = world; this.dir = dir; this.tiles = []; this.byId = new Map(); this.root = new THREE.Group(); this.root.name = 'tl_root'; this.root.userData.streetCube = true;
    const still = Q.has('shot') || Q.has('capture');
    this.all = Q.get('tiles') === 'all' || (still && Q.get('tiles') !== 'stream');
    this.first = num('tfirst', 250); this.rin = num('trin', 420); this.rout = Math.max(num('trout', 650), this.rin + 60); this.rset = num('tset', 2000); this.ahead = num('tahead', 4);     /* seconds of travel looked ahead: at 56 m/s a tile is crossed in under 5 s */ this.rate = num('tnet', 0); this.noShell = Q.get('tshell') === '0';
    this.shadowBig = num('bsb', 170); this.budgetOff = Q.get('budget') === '0' || still; this.maxLoads = 2;
    this.n = 0; this.loading = 0; this.ready = []; this.last = new THREE.Vector3(); this.lastT = 0; this.vel = new THREE.Vector3();
    this.stats = { sets: 0, tiles: 0, full: 0, swaps: 0, drops: 0, failed: 0, late: 0, minSwap: 1e9, bytes: 0, parseMs: 0, parsed: 0, firstBytes: 0, firstFull: 0, log: [] };
    window.__tiles = this;
  }
  // start: [x east, y north] in map metres. Resolves with the group that stands where city.glb's scene stood.
  async start(material, start = [-196, -214]) {
    this.material = material; const sx = start[0], sz = -start[1];
    const man = await fetch(this.dir + 'tiles.json').then((r) => { if (!r.ok) throw new Error('no tiles.json'); return r.json(); });
    const sets = await Promise.all(man.sets.map((s) => fetch(this.dir + s.dir + 'set.json').then((r) => r.json()).then((j) => Object.assign(j, { dir: this.dir + s.dir, origin: s.origin || j.origin || [0, 0] }))));
    const jobs = []; this.sets = sets;
    for (const S of sets) {
      this.stats.sets++; S.state = 0; const o = S.origin; S.wbox = [S.box[0] + o[0], S.box[1] + o[1], S.box[2] + o[0], S.box[3] + o[1]];
      for (const t of S.tiles) { const T = { id: S.set + '/' + t.id, name: t.id, set: S, url: S.dir + t.file, bytes: t.bytes, box: [t.box[0] + o[0], t.box[1] + o[1], t.box[2] + o[0], t.box[3] + o[1]], h: t.h, shell: null, full: null, state: 0, failT: 0, pin: !!(S.pin && S.pin.includes(t.id)) }; this.tiles.push(T); this.byId.set(T.id, T); }
      if (this.all || this.dist({ box: S.wbox }, sx, sz) <= this.rset) jobs.push(this.loadSet(S).then(() => { this.stats.firstBytes += S.ground.bytes + (S.state === 2 && S.hasShells ? S.shells.bytes : 0); }));
    }
    this.stats.tiles = this.tiles.length;
    const near = this.tiles.filter((T) => T.set.state > 0 && (this.all || T.pin || this.dist(T, sx, sz) <= this.first));
    for (const T of near) jobs.push(this.fetchFull(T).then((mesh) => { T.pending = mesh; this.stats.firstBytes += T.bytes; }));
    await Promise.all(jobs);
    for (const T of near) if (T.pending) this.show(T, T.pending, 0);
    this.stats.firstFull = near.length; this.last.set(sx, 0, sz);
    console.log('[tiles] ' + this.tiles.length + ' tiles in ' + sets.length + ' set(s); first load ' + near.length + ' full, ' + (this.stats.firstBytes / 1e6).toFixed(1) + ' MB' + (this.all ? ' (all tiles: still/capture)' : ''));
    return this.root;
  }
  // a set's ground and shells: at the first load for sets within `tset` metres of the start, later when the camera comes that near
  async loadSet(S) {
    S.state = 1;
    try {
      const jobs = [new GLTFLoader().parseAsync(await gunzip(S.dir + S.ground.file), S.dir).then((g) => { const add = []; for (const c of [...g.scene.children]) { c.position.x += S.origin[0]; c.position.z += S.origin[1]; c.userData.set = S.set;     /* whose ground this is: a layer built per area takes only its own (streets/ground) */ add.push(c); } return add; })];
      if (!this.all && !this.noShell && S.shells) jobs.push(gunzip(S.dir + S.shells.file).then(parseT));
      const [ground, shells] = await Promise.all(jobs);
      for (const c of ground) { if (this.onGround) this.onGround(c); this.root.add(c); }
      for (const m of shells || []) { const T = this.byId.get(S.set + '/' + m.name); if (T && !T.pin) { T.shell = this.mesh(T, m.geometry, false); this.root.add(T.shell); } }
      S.hasShells = !!shells; S.state = 2; this.sync();
      if (this.started) for (const T of this.tiles) if (T.set === S && T.pin && T.state === 0) { T.state = 1; this.loading++; this.fetchFull(T).then((mesh) => this.ready.push([T, mesh]), () => { T.state = 0; }).finally(() => { this.loading--; }); }
    } catch (e) { S.state = 0; S.failT = performance.now() + 8000; console.log('[tiles] set ' + S.set + ' not loaded: ' + (e && e.message)); }
  }
  dist(T, x, z) { const b = T.box; return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3])); }
  mesh(T, geometry, full) {
    const m = new THREE.Mesh(geometry, this.material); m.name = T.name; m.userData.tile = full ? 'full' : 'shell'; m.castShadow = full; m.receiveShadow = true;
    m.position.set(T.set.origin[0], 0, T.set.origin[1]); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
    { const bs = geometry.boundingSphere, c = bs.center.clone().applyMatrix4(m.matrixWorld); m.userData.c = [c.x, c.z, bs.radius]; }
    return m;
  }
  async fetchFull(T) { const buf = await gunzip(T.url, this.started ? this.rate : 0); const t0 = performance.now(), m = this.mesh(T, parseT(buf)[0].geometry, true); this.stats.parseMs += performance.now() - t0; this.stats.parsed++; return m; }
  show(T, mesh, d) {
    this.root.add(mesh); T.full = mesh; T.state = 2; if (T.shell) T.shell.visible = false; this.sync(); this.stats.full++; this.stats.swaps++;
    if (this.started) { this.stats.minSwap = Math.min(this.stats.minSwap, d); if (d < this.first) this.stats.late++;
      if (this.stats.log.length < 400) { const c = this.world.camera, f = c.getWorldDirection(new THREE.Vector3()), r = (v) => +v.toFixed(2); this.stats.log.push({ t: +(performance.now() / 1000).toFixed(2), tile: T.id, d: Math.round(d), cam: [r(c.position.x), r(c.position.y), r(-c.position.z), r(c.position.x + f.x * 100), r(c.position.y + f.y * 100), r(-(c.position.z + f.z * 100)), r(c.fov)] }); } }     /* cam = a ?shot= camera: map metres, x east, height, y north, then the look-at point and the fov */
  }
  // tests: hold every tile as it is (frozen), and put one tile in a given form
  async force(id, full) { const T = this.byId.get(id); if (!T) return false; if (full && !T.full) { T.state = 1; this.show(T, await this.fetchFull(T), 1e6); } else if (!full && T.full) this.drop(T); return true; }
  drop(T) { const m = T.full; this.root.remove(m); m.geometry.dispose(); T.full = null; T.state = 0; if (T.shell) T.shell.visible = true; this.sync(); this.stats.full--; this.stats.drops++; }
  sync() { const a = (this.world.buildingMeshes || []).filter((m) => !m.userData.tile);     /* hero.js keeps its stand-in meshes in this list too */ for (const T of this.tiles) { if (T.shell) a.push(T.shell); if (T.full) a.push(T.full); } this.world.buildingMeshes = a; this.rev = (this.rev || 0) + 1; }
  // every frame, from World.render()
  update(cam) {
    this.started = true; const p = cam.position, now = performance.now(); if (this.frozen) return;
    if (this.ready.length) { const [T, mesh] = this.ready.shift(); if (T.state === 1) this.show(T, mesh, this.dist(T, p.x, p.z)); }     // one swap a frame
    if (now - (this.checkT || 0) < 180) return; this.checkT = now;     // five times a second: who is wanted, who can go
    if (this.lastT) { const dt = (now - this.lastT) / 1000; if (dt > 0.02 && dt < 2) this.vel.set((p.x - this.last.x) / dt, 0, (p.z - this.last.z) / dt).clampLength(0, 90); else this.vel.set(0, 0, 0); } this.last.copy(p); this.lastT = now;
    const ax = p.x + this.vel.x * this.ahead, az = p.z + this.vel.z * this.ahead, air = Math.max(0, p.y - 40) * 1.5, rin = this.rin + air, rout = this.rout + air, high = p.y > 70 || this.budgetOff;
    let best = null, bd = 1e9; const bud = window.game && window.game.budget, big = bud && bud.SHADOW_BIG ? bud.SHADOW_BIG : this.shadowBig;     /* the game lowers budget.SHADOW_BIG when the frame rate sags (game.js): follow it */
    for (const S of this.sets) if (S.state === 0 && now > (S.failT || 0) && this.dist({ box: S.wbox }, p.x, p.z) <= this.rset + air) this.loadSet(S);
    for (const T of this.tiles) {
      const d = Math.min(this.dist(T, p.x, p.z), this.dist(T, ax, az));
      if (T.set.state !== 2) continue;
      if (T.state === 0 && !this.all && d < rin && now > T.failT && d < bd) { bd = d; best = T; }
      else if (T.state === 2) {
        if (!this.all && d > rout && T.shell && !T.pin) this.drop(T);
        else { const c = T.full.userData.c, cast = high || Math.hypot(c[0] - p.x, c[1] - p.z) - c[2] <= big; if (T.full.castShadow !== cast) T.full.castShadow = cast; }     /* budget.js's rule for building tiles, kept here because tiles come and go */
      }
    }
    if (best && this.loading < this.maxLoads) { const T = best; T.state = 1; this.loading++;
      this.fetchFull(T).then((mesh) => { this.stats.bytes += T.bytes; this.ready.push([T, mesh]); }, (e) => { T.state = 0; T.failT = performance.now() + 5000; this.stats.failed++; console.log('[tiles] ' + T.id + ' not loaded, shell stays: ' + (e && e.message)); }).finally(() => { this.loading--; }); }
  }
}
