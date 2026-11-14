// budget.js (lead): live play's draw budget. The scene is ~13.5 M triangles and ~2,000 draw calls a frame at street level, 5 M of them in
// the sun-shadow pass, and most of that is things too far or too small to matter from the kerb. Every few frames, by distance from the
// camera to each static mesh's bounding sphere:
//   - small street objects (furniture, dressing, kit props, shopfront parts) stop casting sun shadows past SHADOW_SMALL and are not
//     drawn at all past HIDE_SMALL (the haze and their size hide the pop);
//   - trees and building tiles stop casting past SHADOW_BIG (the sun shadow map only reaches 150 m; beyond it the bake carries shadow);
//   - people stop casting past SHADOW_PEOPLE and are not drawn past HIDE_PEOPLE.
// It never touches .visible (other modules own that): hiding is done by moving a mesh off camera layer 0, shadows by castShadow, and
// both are put back when fly mode lifts the camera or with ?budget=0. Capture and stills do not run it.
import * as THREE from 'three';

const SMALL = /^(st_furniture|dressing|storefronts)/, BIG = /^(streets_trees)/, SKIP = /^(streets_vehicles|streets_ground)/;
export class Budget {
  constructor(game) {
    this.g = game; this.n = 0; this.items = null; this.on = false; this.built = 0;
    const P = game.P; this.off = P.get('budget') === '0';
    this.SHADOW_SMALL = +(P.get('bss') || 55); this.HIDE_SMALL = +(P.get('bhs') || 280); this.SHADOW_BIG = +(P.get('bsb') || 170); this.SHADOW_PEOPLE = +(P.get('bsp') || 40); this.HIDE_PEOPLE = +(P.get('bhp') || 170);
    this.stats = {};
  }
  // static meshes with a world bounding sphere, classed by the top-level group they hang from
  build() {
    const scene = this.g.world.scene, items = [], c = new THREE.Vector3(); scene.updateMatrixWorld(true);
    for (const top of scene.children) {
      const name = top.name || ''; if (SKIP.test(name) || top.isLight) continue;
      if (top.userData && (top.userData.crashOwn || top.userData.brkOwn)) continue;     /* tiles lane, Nov 13 (the van with no body at the end of a long drive): a crashed car's own body mesh (crash.js adds it to the scene as a one-instance mesh) MOVES with the car; listed here it kept the place it had when this list was made and was hidden as a far small thing once the car was 280 m from there */
      const kind = SMALL.test(name) ? 1 : BIG.test(name) ? 2 : (top.isInstancedMesh ? 1 : (top.isScene || /city|tile|bld/i.test(name)) ? 3 : 0);
      if (!kind) continue;
      top.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh) return;
        let bs; try { if (o.isInstancedMesh) { if (!o.count) return; o.computeBoundingSphere(); bs = o.boundingSphere; } else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); bs = o.geometry.boundingSphere; } } catch (e) { return; }
        if (!bs || !isFinite(bs.radius) || bs.radius > 220) return;        // city-wide batches: leave alone
        c.copy(bs.center).applyMatrix4(o.matrixWorld);
        items.push({ o, x: c.x, y: c.y, z: c.z, r: bs.radius * o.matrixWorld.getMaxScaleOnAxis(), kind, cast: o.castShadow, hid: false, cut: false });
      });
    }
    this.items = items; this.built = performance.now();
  }
  restore() { if (!this.items) return; for (const it of this.items) { if (it.hid) { it.o.layers.enable(0); it.hid = false; } if (it.cut) { it.o.castShadow = it.cast; it.cut = false; } } for (const p of this.people()) { if (p._bh) { p.object.traverse((m) => m.layers.enable(0)); p._bh = false; } if (p._bc) { p.object.traverse((m) => { if (m.isMesh) m.castShadow = true; }); p._bc = false; } } this.on = false; }
  people() { const g = this.g, a = []; for (const q of g.peds.list) if (q.vis && q.vis.object) a.push(q.vis); return a; }
  update() {
    if (this.off || this.g.capture) return;
    if (this.n++ % 8) return;
    const cam = this.g.world.camera.position;
    if (cam.y > 70) { if (this.on) this.restore(); return; }              // flying high: the whole city is the picture
    if (!this.items || (performance.now() - this.built > 20000 && !this.rebuilt)) { if (this.items) { this.restore(); this.rebuilt = true; } this.build(); }   // once more after 20 s: late-loading parts
    this.on = true; let hid = 0, cut = 0;
    for (const it of this.items) {
      const d = Math.hypot(it.x - cam.x, it.z - cam.z) - it.r;
      const wantHide = it.kind === 1 && d > this.HIDE_SMALL, wantCut = it.cast && d > (it.kind === 1 ? this.SHADOW_SMALL : this.SHADOW_BIG);
      if (wantHide !== it.hid) { if (wantHide) it.o.layers.disable(0); else it.o.layers.enable(0); it.hid = wantHide; }
      if (wantCut !== it.cut) { it.o.castShadow = wantCut ? false : it.cast; it.cut = wantCut; }
      hid += it.hid; cut += it.cut;
    }
    for (const p of this.people()) {
      const o = p.object, d = Math.hypot(o.position.x - cam.x, o.position.z - cam.z), h = d > this.HIDE_PEOPLE, c = d > this.SHADOW_PEOPLE;
      if (h !== !!p._bh) { o.traverse((m) => { if (h) m.layers.disable(0); else m.layers.enable(0); }); p._bh = h; }
      if (c !== !!p._bc) { o.traverse((m) => { if (m.isMesh) m.castShadow = !c; }); p._bc = c; }
    }
    this.stats = { items: this.items.length, hid, cut };
  }
}
