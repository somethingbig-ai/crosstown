// still.js (tiles lane, Nov 15): things of the street that never move stop having their world matrices worked out at every draw.
// three.js walks the whole scene before each draw (scene.updateMatrixWorld, once for every render call of a frame). The Scene is left at its default, so its
// own matrix is made again each time and that FORCES every object below it to multiply its world matrix again, moved or not: 19,000 objects on three map areas,
// 25,500 on six: 3.8 s and 5.1 s of every 20 s of play on an M2 Pro (CPU profile, lanes/tiles/runs/fps6), growing with every area.
// Here this one Scene gets its own updateMatrixWorld: every top-level object is updated exactly as before (its whole subtree, forced), EXCEPT the street's
// unmoving families: the groups named in STATIC and the prop batches (unnamed top-level instanced meshes with userData.items). Those are not walked at all.
// Nothing has to know. For the static families, once a frame (stillTick, from tiles.js's update):
//   - a walk four times a second finds objects added since (a map area built during play) and makes their world matrices;
//   - a quarter of the watched objects a frame are looked at: one its owner MOVED (position / turn / size of an object that was at the default) goes on a short
//     list that is updated at every draw from then on, as before; one whose matrix was written or re-made by its owner gets its world matrix (and its children's)
//     made. So a static thing that does move is at most four frames late the first time.
// scene.updateMatrixWorld(true) (asked for by name: budget.js) still does everything. A NEW top-level object is updated in full when first seen.
//   ?still=0 off (nothing is touched). window.__still = { n watched, nMoved, nPoked, live, names } for a look.
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
// NOT streets_vehicles (parked cars are driven away) and NOT st_furniture (it makes and drops objects all the time)
const STATIC = /^(streets_trees|streets_ground|streets_grass|storefronts|dressing|tl_root)/;
const S = { on: !Q || Q.get('still') !== '0', list: [], snap: [], live: [], n: 0, nMoved: 0, nPoked: 0, nGone: 0, at: 0, lastWalk: -1e9, names: {}, scene: null };
if (typeof window !== 'undefined') window.__still = S;
const isStatic = (top) => (top.name ? STATIC.test(top.name) : !!(top.isInstancedMesh && top.userData && top.userData.items && !top.matrixAutoUpdate));
const W = 16, put = (o, a, k) => { const p = o.position, q = o.quaternion, s = o.scale, e = o.matrix.elements; a[k] = p.x; a[k + 1] = p.y; a[k + 2] = p.z; a[k + 3] = q._x; a[k + 4] = q._y; a[k + 5] = q._z; a[k + 6] = q._w; a[k + 7] = s.x; a[k + 8] = s.y; a[k + 9] = s.z; a[k + 10] = e[12]; a[k + 11] = e[13]; a[k + 12] = e[14]; a[k + 13] = e[0]; a[k + 14] = e[5]; a[k + 15] = e[10]; };
function install(scene) {
  S.scene = scene; const full = scene.updateMatrixWorld.bind(scene); S.full = full;
  // helper cost, Nov 15: the walk for new objects (30,000 visits, four times a second: 0.4 s of every 12 s of play on nine map areas) is made only after something was
  // ADDED somewhere (Object3D.add, which every three object shares, sets a flag: one assignment), and once every 2 s as a net for a list written by hand.
  // ?stillwalk=0 = a walk four times a second and a quarter of the watched a frame, as before.
  S.lazy = !Q || Q.get('stillwalk') !== '0'; S.dirty = true; S.lastFull = -1e9;
  if (S.lazy) { try { let P = Object.getPrototypeOf(scene); while (P && !Object.prototype.hasOwnProperty.call(P, 'add')) P = Object.getPrototypeOf(P); if (P && !P.__stillAdd) { const add0 = P.add; P.add = function () { S.dirty = true; return add0.apply(this, arguments); }; P.__stillAdd = true; } else if (!P) S.lazy = false; } catch (e) { S.lazy = false; } }
  scene.updateMatrixWorld = function (force) {
    if (force === true || !S.on) return full(force);
    if (this.matrixAutoUpdate) this.updateMatrix(); if (this.matrixWorldNeedsUpdate) { this.matrixWorld.copy(this.matrix); this.matrixWorldNeedsUpdate = false; }
    const kids = this.children; for (let i = 0, n = kids.length; i < n; i++) { const top = kids[i];
      if (top.__stillTop === true) continue;
      if (top.__stillTop === undefined) { top.__stillTop = isStatic(top); S.lastWalk = -1e9; S.dirty = true; }      // new at the top: in full this once, then by its family
      top.updateMatrixWorld(true); }
    const L = S.live; for (let i = 0; i < L.length; i++) { const o = L[i]; if (o.parent) o.updateMatrixWorld(true); }      // static things that turned out to move
  };
}
function walk(scene) {
  for (const top of scene.children) { if (top.__stillTop !== true) continue;
    top.traverse((o) => { if (o.__still !== undefined) return;
      if (o.isSkinnedMesh || o.isBone || o.isCamera || o.isLight || (o.userData && o.userData.moves)) { o.__still = 0; S.live.push(o); return; }      // three's, at every draw
      if (o.matrixAutoUpdate) { o.updateMatrix(); o.matrixAutoUpdate = false; o.__still = 1; } else o.__still = 2;
      if (o.parent && o.parent !== scene) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix); else o.matrixWorld.copy(o.matrix);      // parents come first in a walk
      o.matrixWorldNeedsUpdate = false; const k = S.list.length * W; S.list.push(o); put(o, S.snap, k); const nm = (top.name || 'props').replace(/[:0-9].*$/, ''); S.names[nm] = (S.names[nm] || 0) + 1; }); }
  S.n = S.list.length;
}
// once a frame, before the draw (from tiles.js's update)
export function stillTick(world, now = performance.now()) {
  if (!S.on || !world || !world.scene || (typeof window !== 'undefined' && !window.__ready)) return; const scene = world.scene;
  if (S.scene !== scene) install(scene);
  if (now - S.lastWalk > 250 && (!S.lazy || S.dirty || now - S.lastFull > 2000)) { S.lastWalk = now; S.lastFull = now; S.dirty = false; walk(scene); S.walks = (S.walks || 0) + 1; }
  const L = S.list, a = S.snap, n = L.length; if (!n) return; const m = Math.ceil(n / (S.lazy ? 8 : 4)); let i = S.at;
  for (let c = 0; c < m; c++, i++) { if (i >= n) i = 0; const o = L[i]; if (!o) continue; if (!o.parent) { L[i] = null; S.nGone++; if (o.__still === 1) o.matrixAutoUpdate = true; o.__still = undefined; continue; }      // taken out by its owner: seen afresh if it comes back
    const k = i * W, p = o.position, q = o.quaternion, s = o.scale, e = o.matrix.elements;
    if (o.matrixAutoUpdate || (o.__still === 1 && (a[k] !== p.x || a[k + 1] !== p.y || a[k + 2] !== p.z || a[k + 3] !== q._x || a[k + 4] !== q._y || a[k + 5] !== q._z || a[k + 6] !== q._w || a[k + 7] !== s.x || a[k + 8] !== s.y || a[k + 9] !== s.z))) {
      o.matrixAutoUpdate = true; o.__still = 0; S.live.push(o); S.nMoved++; L[i] = null; o.updateMatrixWorld(true); continue; }      // moved by its owner: at every draw from now on
    if (a[k + 10] !== e[12] || a[k + 11] !== e[13] || a[k + 12] !== e[14] || a[k + 13] !== e[0] || a[k + 14] !== e[5] || a[k + 15] !== e[10] || o.matrixWorldNeedsUpdate) { o.updateMatrixWorld(true); S.nPoked++; a[k + 10] = e[12]; a[k + 11] = e[13]; a[k + 12] = e[14]; a[k + 13] = e[0]; a[k + 14] = e[5]; a[k + 15] = e[10]; } }
  S.at = i;
}
export const still = S;
