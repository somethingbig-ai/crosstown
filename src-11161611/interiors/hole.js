// interiors/hole.js (light lane handoff18, Nov 15; the two functions were lines of interiors.js until now): the copy of the building-front material that
// cuts the shop openings, and the tiny mesh that lets the start screen compile it.
// WHY ITS OWN FILE: measured on a Windows machine (lanes/light/win/WINBOX.md), Direct3D needs 30 to 50 s of one core for this one program, and interiors.js
// made it at the very END of game.init(), so the shader step could never be shorter than that. Now the early linking of warmup.js (?warmearly=1, or the
// Windows trial) makes the copy as soon as the tile fronts exist (earlyHole below, before game.init()), and interiors.js takes THAT SAME material object
// and mesh (world.__shopHole) instead of making its own: one program, started 30 s sooner. Without early linking, or with ?holeearly=0, nothing here runs
// before interiors.js and everything is as it was.
import * as THREE from 'three';

export function holeMaterial(base) {
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
// the warm-up mesh of the copy: three corners of a tile mesh's own geometry (so the program's vertex inputs are a tile's), a thousandth of its size
export function holeWarmMesh(src, m) {
  const g = new THREE.BufferGeometry(); for (const k in src.attributes) { const a = src.attributes[k]; g.setAttribute(k, new THREE.BufferAttribute(a.array.slice(0, a.itemSize * 3), a.itemSize, a.normalized)); } g.setIndex([0, 1, 2]);
  const o = new THREE.Mesh(g, m); o.frustumCulled = false; o.scale.setScalar(0.001); return o;
}
// the tile fronts' material and a tile mesh, found the way interiors.js finds them
export function tileFacade(world) {
  const tm = (world.buildingMeshes || []).filter((m) => m.userData && m.userData.tile);
  let facade = null; for (const m of tm) if (m.material && m.material.onBeforeCompile) { facade = m.material; break; }
  return { facade, tm };
}
// earlyHole(world): called by warmup.js's early linking. Makes the copy and its mesh now and puts the mesh in the scene (60 m under the street, in a group
// of its own) so the next early pass links its program. Returns null while no tile exists yet (the caller asks again at its next pass).
// world.__shopHole = { base, m, U, mesh, group, taken }: interiors.js takes it when its own facade is `base` (taken = true: the mesh moves into
// interiors_warm, the group leaves the scene); if interiors.js never comes for it (no shop on this map, ?interiors=0 met later, a failed load),
// dropEarlyHole() takes it out again before the compile-ahead step, so no load ends with a program it would not have had.
export function earlyHole(world) {
  if (world.__shopHole) return world.__shopHole;
  const { facade, tm } = tileFacade(world); if (!facade || !tm.length || !tm[0].geometry) return null;
  const h = holeMaterial(facade), mesh = holeWarmMesh(tm[0].geometry, h.m), group = new THREE.Group(); group.name = 'interiors_warm_early'; group.position.set(0, -60, 0);
  group.add(mesh); world.scene.add(group);
  return (world.__shopHole = { base: facade, m: h.m, U: h.U, mesh, group, taken: false });
}
export function dropEarlyHole(world) {
  const H = world.__shopHole; if (!H || H.taken) return false;
  try { world.scene.remove(H.group); H.mesh.geometry.dispose(); H.m.dispose(); } catch (e) {} world.__shopHole = null; return true;
}
