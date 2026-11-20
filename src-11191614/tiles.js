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
//   url knobs: ?tfirst=250 ?trin=420 ?trout=650 ?tset=1200 ?tahead=4 ?tnet=<bytes per second: slows tile fetches, for tests> ?tshell=0 (no shells: tiles pop, for tests)
// PINNED tiles (set.json "pin": the tiles a hand-built hero building stands in) are always FULL, from the first load on, and have no shell:
// hero.js cuts its buildings' massing out of the tile meshes once at load, and so finds them all there, as it did in city.glb. A pinned
// tile of a set that loads later comes with that set.
// World.buildingMeshes always holds every tile mesh that exists (shell and full); a shell is only hidden (.visible) while its full tile shows.
import * as THREE from 'three';
import { stillTick } from './still.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Q = new URLSearchParams(location.search), num = (k, d) => (Q.has(k) && isFinite(+Q.get(k)) ? +Q.get(k) : d);
const TYPES = { f32: Float32Array, u16: Uint16Array, u8: Uint8Array, i16: Int16Array, i8: Int8Array, u32: Uint32Array };
async function gunzip(url, rate) {
  { const D = window.__dl, k = url.replace(/\.gz$/, ''); if (D && k !== url && D.has(k)) { try { const buf = await D.get(k); if (rate) await new Promise((res) => setTimeout(res, D.size(k) / rate * 1000)); return buf; } catch (e) {} } }     /* perf lane: the same bytes from the smaller <file>.dz.bin (src/dl/dl.js; ?dl=0 off) */
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (rate) { const len = +r.headers.get('content-length') || buf.byteLength / 5; await new Promise((res) => setTimeout(res, len / rate * 1000)); }     // test knob: a slow link
  return buf;
}
// .t file -> [{ name, geometry, lo, hi }]
export function parseT(buf) {
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x3154594e) throw new Error('not a tile file');     // 'NYT1'
  const jl = dv.getUint32(4, true), j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))), base = 8 + jl, out = [];
  for (const m of j.meshes) out.push(parseMesh(buf, base, m));
  return out;
}
// the meshes of a .t file one at a time (a set that arrives during play is unpacked a mesh a frame: tiles.js loadSet)
export function parseHead(buf) { const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x3154594e) throw new Error('not a tile file'); const jl = dv.getUint32(4, true); return { meshes: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))).meshes, base: 8 + jl }; }
export function parseMesh(buf, base, m) {
  {
    const g = new THREE.BufferGeometry();
    for (const a of m.attrs) {
      const T = TYPES[a.type]; let arr = new T(buf, base + a.off, m.verts * a.size);
      if (a.enc === 'q') { const f = new Float32Array(arr.length), n = a.size, k = a.k, add = a.add; for (let i = 0; i < arr.length; i++) f[i] = Math.fround(arr[i] * k + add[i % n]); arr = f; }
      g.setAttribute(a.name, new THREE.BufferAttribute(arr, a.size, !!a.norm && a.enc !== 'q'));
    }
    const d = new Int32Array(buf, base + m.index.off, m.tris * 3), ix = new Uint32Array(d.length); let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; ix[i] = s; }
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...m.lo), new THREE.Vector3(...m.hi)); g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return { name: m.name, geometry: g, lo: m.lo, hi: m.hi };
  }
}

export class Tiles {
  constructor(world, dir = Q.get('tdir') || 'assets/tiles/') {     /* ?tdir=: another tile folder (tests) */
    this.world = world; this.dir = dir; this.tiles = []; this.byId = new Map(); this.root = new THREE.Group(); this.root.name = 'tl_root'; this.root.userData.streetCube = true;
    const still = Q.has('shot') || Q.has('capture');
    this.all = Q.get('tiles') === 'all' || (still && Q.get('tiles') !== 'stream');
    this.first = num('tfirst', 250); this.rin = num('trin', 420); this.rout = Math.max(num('trout', 650), this.rin + 60); this.rset = num('tset', 1200);     /* 1200 since Nov 14 (was 2000): with a third area the one two areas away is left to far.glb's skyline until the camera heads for it; the neighbour of the start (715 m) still comes with the first load */ this.ahead = num('tahead', 4);     /* seconds of travel looked ahead: at 56 m/s a tile is crossed in under 5 s */ this.rate = num('tnet', 0); this.noShell = Q.get('tshell') === '0';
    // perf lane, Nov 15 (late shells): the SHELLS of a first-load set farther than `tlate` metres from the start point are no part of the first load: they come down right after
    // ready, nearest set first (runLate below). The set's ground is in at the first frame; its buildings follow. 16 of the 21 MB of shells were for buildings 690 m and more
    // from the player's first step. ?lateshells=0 = with the first load, as before; ?tlate=<metres> (500); ?lateshells=hold = tests: they wait for window.__lateGo.
    this.lateSh = Q.get('lateshells') === '0' ? 0 : Q.get('lateshells') === 'hold' ? 2 : 1; this.lateAt = num('tlate', 500); this.lateQ = [];
    this.shadowBig = num('bsb', 170); this.budgetOff = Q.get('budget') === '0' || still; this.maxLoads = 2;
    this.n = 0; this.loading = 0; this.ready = []; this.last = new THREE.Vector3(); this.lastT = 0; this.vel = new THREE.Vector3();
    this.stats = { sets: 0, tiles: 0, full: 0, swaps: 0, drops: 0, failed: 0, late: 0, minSwap: 1e9, bytes: 0, parseMs: 0, parsed: 0, firstBytes: 0, firstFull: 0, log: [] };
    window.__tiles = this;
  }
  // start: [x east, y north] in map metres. Resolves with the group that stands where city.glb's scene stood.
  async start(material, start = [-196, -214]) {
    this.material = material; const sx = start[0], sz = -start[1];
    const man = await fetch(this.dir + 'tiles.json').then((r) => { if (!r.ok) throw new Error('no tiles.json'); return r.json(); });
    /* lead helper trees-rads, Nov 18 (Matt: "Radiators still hovering in the air"): the white louvred boxes are the window air conditioners built into the FULL tiles
       (wall kind 8). Most sit in a window; some stand in the air beside or between buildings (the tile build put them on a wall of the map that is not drawn there).
       assets/winac-air.json (lanes/lead/trees-rads/tools/winac_census.py, from the tile files) lists, per tile, the middles of the boxes with no wall or roof face
       within 0.6 m; their triangles are left out of the tile's mesh when it is made (mesh() below). No list, or ?winac=1 = every box as before. */
    this.airBoxes = null; if (Q.get('winac') !== '1') try { const r = await fetch('assets/winac-air.json'); if (r.ok) this.airBoxes = (await r.json())[this.dir] || null; } catch (e) {}
    const sets = await Promise.all(man.sets.map((s) => fetch(this.dir + s.dir + 'set.json').then((r) => r.json()).then((j) => Object.assign(j, { dir: this.dir + s.dir, origin: s.origin || j.origin || [0, 0] }))));
    const jobs = []; this.sets = sets; const cm = this.world && this.world.city && this.world.city.meta, own = cm && Array.isArray(cm.sets) && cm.sets.length ? new Set(cm.sets.map((q) => q.set)) : null;     /* the areas of this map, when it names them */
    // uptown (landmarks): with ?hdir=<hero folder> the tiles a footprint of that folder's hero.json touches are pinned here (the uptown test sets have no "pin" in set.json)
    let hpin = []; if (Q.get('hdir') && Q.get('hero') !== '0') try { hpin = (await fetch(Q.get('hdir') + 'hero.json').then((r) => (r.ok ? r.json() : []))).filter((h) => h.footprint && !h.off).map((h) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const p of h.footprint) { b[0] = Math.min(b[0], p[0] - 4); b[1] = Math.min(b[1], -p[1] - 4); b[2] = Math.max(b[2], p[0] + 4); b[3] = Math.max(b[3], -p[1] + 4); } return b; }); } catch (e) {}
    for (const S of sets) {
      this.stats.sets++; S.state = 0; const o = S.origin; S.wbox = [S.box[0] + o[0], S.box[1] + o[1], S.box[2] + o[0], S.box[3] + o[1]];
      for (const t of S.tiles) { const T = { id: S.set + '/' + t.id, name: t.id, set: S, url: S.dir + t.file, bytes: t.bytes, box: [t.box[0] + o[0], t.box[1] + o[1], t.box[2] + o[0], t.box[3] + o[1]], h: t.h, shell: null, full: null, state: 0, failT: 0, pin: !!(S.pin && S.pin.includes(t.id)) }; if (hpin.some((b) => b[0] < T.box[2] && b[2] > T.box[0] && b[1] < T.box[3] && b[3] > T.box[1])) T.pin = true; this.tiles.push(T); this.byId.set(T.id, T); }
      // tiles lane, Nov 15: a set of the tile folder that is NOT one of this map's areas (the east column's sets under the three-area map: they hold the buildings beyond
      // the map's east edge) is no part of the first load: it comes in right after the game is ready, as a far area does during play (update() below). 9 MB less before
      // ready on the three-area map. ?tout=1 = with the first load, as before.
      S.outside = !!own && !own.has(S.set) && Q.get('tout') !== '1';
      S.lateShell = !!this.lateSh && !this.all && !this.noShell && !!S.shells && this.dist({ box: S.wbox }, sx, sz) > this.lateAt;     /* perf lane: late shells */
      if (this.all || (!S.outside && this.dist({ box: S.wbox }, sx, sz) <= this.rset)) jobs.push(this.loadSet(S).then(() => { this.stats.firstBytes += S.ground.bytes + (S.state === 2 && S.hasShells ? S.shells.bytes : 0); }));
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
      // a set that arrives DURING PLAY (the camera came within `tset` of an area two areas from the start) is unpacked and added one shell a frame: all at once
      // it was one long frame on a weak machine (unpacking 0.8 M triangles, then every buffer going to the card in the same frame)
      const play = this.started && !this.all, tS = performance.now(); let worst = 0;
      const late = !!S.lateShell && !this.started;     /* perf lane: late shells */
      if (!this.all && !this.noShell && S.shells && !late) jobs.push(gunzip(S.dir + S.shells.file).then((b) => (play ? b : parseT(b))));
      const [ground, shells] = await Promise.all(jobs);
      for (const c of ground) { if (this.onGround) this.onGround(c); this.root.add(c); }
      const addShell = (m) => { const T = this.byId.get(S.set + '/' + m.name); if (T && !T.pin) { T.shell = this.mesh(T, m.geometry, false); if (T.full) T.shell.visible = false; this.root.add(T.shell); } };
      if (play && shells) { const H = parseHead(shells); for (const m of H.meshes) { const t1 = performance.now(); addShell(parseMesh(shells, H.base, m)); worst = Math.max(worst, performance.now() - t1); await new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 100); }); }
        this.stats.sets2 = (this.stats.sets2 || []).concat([[S.set, +(tS / 1000).toFixed(1), Math.round(performance.now() - tS), Math.round(worst)]]);
        console.log('[tiles] set ' + S.set + ' came in during play: ' + H.meshes.length + ' shells over ' + Math.round(performance.now() - tS) + ' ms, the longest step ' + worst.toFixed(0) + ' ms'); }
      else for (const m of shells || []) addShell(m);
      if (late) { this.lateQ.push(S); return; }     /* perf lane: the ground is in; the set stays in state 1 until runLate has brought its shells */
      S.hasShells = !!shells; S.state = 2; this.sync(); if (this.onSet && this.started) try { this.onSet(S); } catch (e) {}     /* a set that came in during play: who keeps a picture of the buildings (the helicopter's height picture) reads its part again */
      if (this.started) for (const T of this.tiles) if (T.set === S && T.pin && T.state === 0) { T.state = 1; this.loading++; this.fetchFull(T).then((mesh) => this.ready.push([T, mesh]), () => { T.state = 0; }).finally(() => { this.loading--; }); }
    } catch (e) { S.state = 0; S.failT = performance.now() + 8000; console.log('[tiles] set ' + S.set + ' not loaded: ' + (e && e.message)); }
  }
  // perf lane, Nov 15: the late shells. One file on the line at a time, the nearest set to the camera first; a file is unpacked and added a few shells a frame (a set that
  // arrives during play: one a frame) while the next one is already coming down. A file that fails is asked for again every 8 s, as a failed set is.
  async runLate(cam) {
    this.lateRun = true; const get = (S) => { const g = gunzip(S.dir + S.shells.file, this.rate); g.catch(() => {}); return g; }, frame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 100); });
    const pick = () => { const p = cam.position; let b = -1, bd = 1e9; this.lateQ.forEach((S, i) => { const d = this.dist({ box: S.wbox }, p.x, p.z); if (d < bd) { bd = d; b = i; } }); return b < 0 ? null : this.lateQ.splice(b, 1)[0]; };
    // perf lane, Nov 18 (src/lateq.js): add() = the unpacking, as it was inline. With the shared queue the late shells are one lane ('far', by the distance of the nearest waiting
    // set, which is chosen when the turn comes); the line is free for the next download while a file is unpacked, and files are unpacked one after another, as before.
    // ?lateq=0 = the loop below, as before.
    const add = async (S, buf) => { const tS = performance.now(), H = parseHead(buf); let worst = 0, acc = 0;
      for (const m of H.meshes) { const t1 = performance.now(), T = this.byId.get(S.set + '/' + m.name); if (T && !T.pin) { T.shell = this.mesh(T, parseMesh(buf, H.base, m).geometry, false); if (T.full) T.shell.visible = false; this.root.add(T.shell); } acc += performance.now() - t1; if (acc >= (window.__warming || window.__startScreen ? 24 : 5)) { worst = Math.max(worst, acc); acc = 0; await frame(); } }     /* a frame's worth: 5 ms in play, 24 ms behind the start screen */
      S.hasShells = true; S.state = 2; this.sync(); if (this.onSet) try { this.onSet(S); } catch (e) {}
      this.stats.lateShells = (this.stats.lateShells || []).concat([[S.set, +(performance.now() / 1000).toFixed(1), Math.round(performance.now() - tS), Math.round(Math.max(worst, acc))]]);
      console.log('[tiles] late shells of ' + S.set + ' in at ' + (performance.now() / 1000).toFixed(1) + ' s: ' + H.meshes.length + ' shells over ' + Math.round(performance.now() - tS) + ' ms, the longest frame share ' + Math.max(worst, acc).toFixed(0) + ' ms');
    };
    const LQ = window.__lateq;
    if (LQ) { let failT = 0, chain = Promise.resolve(); const nearest = () => { const p = cam.position; let b = 1e9; for (const S of this.lateQ) b = Math.min(b, this.dist({ box: S.wbox }, p.x, p.z)); return b; };
      LQ.lane({ kind: 'far', d: nearest, name: 'late shells', more: () => this.lateQ.length > 0 && performance.now() >= failT }, async (free) => { const S = pick(); if (!S) return; free.as(S.dir + S.shells.file); let buf;
        try { buf = await get(S); } catch (e) { console.log('[tiles] late shells of ' + S.set + ' not loaded, asked again in 8 s: ' + (e && e.message)); this.lateQ.push(S); failT = performance.now() + 8000; return; }
        free(); chain = chain.then(() => add(S, buf)).catch((e) => { console.log('[tiles] late shells of ' + S.set + ' not added: ' + (e && e.message)); }); await chain; });
      return; }     /* lateRun stays true: the lane lives on */
    let S = pick(), job = S && get(S);
    while (S) {
      let buf = null; for (;;) { try { buf = await job; break; } catch (e) { console.log('[tiles] late shells of ' + S.set + ' not loaded, asked again in 8 s: ' + (e && e.message)); await new Promise((r) => setTimeout(r, 8000)); job = get(S); } }
      const N = pick(), njob = N && get(N); await add(S, buf);
      S = N; job = njob;
    }
    this.lateRun = false;
  }
  dist(T, x, z) { const b = T.box; return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3])); }
  mesh(T, geometry, full) {
    if (full && this.airBoxes) { const L = this.airBoxes[T.url.slice(this.dir.length).replace(/\.t\.gz$/, '')], k3 = geometry.attributes.uv3, ix = geometry.index, pos = geometry.attributes.position;     /* trees-rads: the air conditioners that stand in the air (see start()) */
      if (L && k3 && ix && pos) { const src = ix.array, out = new src.constructor(src.length); let k = 0;
        for (let i = 0; i < src.length; i += 3) { const a = src[i], b = src[i + 1], c = src[i + 2]; let drop = false;
          if (Math.floor(k3.getX(a) / 64) === 8) { const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3; for (const q of L) { const dx = x - q[0], dy = y - q[1], dz = z - q[2]; if (dx * dx + dy * dy + dz * dz < 0.81) { drop = true; break; } } }
          if (!drop) { out[k++] = a; out[k++] = b; out[k++] = c; } }
        if (k < src.length) { geometry.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1)); this.stats.airBoxTris = (this.stats.airBoxTris || 0) + (src.length - k) / 3; } } }
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
    this.started = true; const p = cam.position, now = performance.now(); stillTick(this.world, now);     /* still.js: the street's unmoving things leave three's per-frame matrix work (?still=0) */ if (this.frozen) return;
    if (this.lateSh && this.lateQ.length && !this.lateRun && !(this.lateSh === 2 && !window.__lateGo)) this.runLate(cam);     /* perf lane: late shells */
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
