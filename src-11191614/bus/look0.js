// bus/look0.js: a stand-in bus (a white and blue box with a dark window band, doors that slide, four wheels) so the system can be seen and
// tested before the model is in, and as the fallback if look.js fails to load. Same interface as look.js (CONTRACT.md).
import * as THREE from 'three';
import { DIMS0 } from './dims.js';
export const DIMS = DIMS0;
export async function makeLook(game, opts = {}) {
  const cap = opts.cap || 12, D = DIMS0, scene = game.world.scene, grp = new THREE.Group(); grp.name = 'bus-look0'; scene.add(grp);
  const mk = (geo, col, extra) => { const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(Object.assign({ color: col, roughness: 0.5, metalness: 0.1 }, extra || {})), cap * 4); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; grp.add(im); return im; };
  const box = (l, h, w, x, y, z) => { const g = new THREE.BoxGeometry(l, h, w); g.translate(x, y, z); return g; };
  const body = mk(box(D.len, 1.25, D.wid, 0, 0.3 + 0.625, 0), 0xf2f3f4), skirt = mk(box(D.len + 0.02, 0.5, D.wid + 0.02, 0, 0.55, 0), 0x163a8c), band = mk(box(D.len - 0.3, 1.0, D.wid + 0.01, -0.1, 2.05, 0), 0x14181c, { roughness: 0.1 }),
    roof = mk(box(D.len, 0.6, D.wid, 0, 2.85, 0), 0xf2f3f4), mask = mk(box(0.06, 2.4, D.wid - 0.1, D.len / 2, 1.6, 0), 0x163a8c), sign = mk(box(0.08, 0.34, 1.9, D.len / 2 + 0.01, 2.86, 0), 0xffa21a, { emissive: 0xff8a00, emissiveIntensity: 0.9 }),
    door = mk(box(0.5, 2.0, 0.05, 0, 1.4, 0), 0x2a3038, { roughness: 0.2 }), wheel = (() => { const g = new THREE.CylinderGeometry(D.radius, D.radius, 0.3, 14); g.rotateX(Math.PI / 2); return mk(g, 0x101012, { roughness: 0.9 }); })();
  const all = [body, skirt, band, roof, mask, sign], M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1); let n = 0, nd = 0, nw = 0;
  return {
    DIMS: D, group: grp,
    begin() { n = nd = nw = 0; },
    add(b) {
      if (n >= cap) return; e.set((b.roll || 0) + (b.kneel || 0) * 0.02, b.h, b.pitch || 0, 'YZX'); q.setFromEuler(e); v.set(b.x, (b.z || 0) - (b.kneel || 0) * 0.03, -b.y); M.compose(v, q, one);
      for (const im of all) im.setMatrixAt(n, M); n++;
      for (const [d, o] of [[D.doors.front, b.doorF || 0], [D.doors.rear, b.doorR || 0]]) for (const sg of [-1, 1]) { M2.makeTranslation(d.x + sg * (0.25 + o * 0.5), 0, D.wid / 2 + 0.02); M2.premultiply(M); door.setMatrixAt(nd++, M2); }
      for (const ax of [D.axF, D.axR]) for (const sd of [-1, 1]) { e.set(0, ax === D.axF ? b.steer || 0 : 0, -(b.spin || 0), 'YZX'); q.setFromEuler(e); v.set(ax, D.radius, sd * (D.wid / 2 - 0.2)); M2.compose(v, q, one); M2.premultiply(M); wheel.setMatrixAt(nw++, M2); }
    },
    end() { for (const im of all) { im.count = n; im.instanceMatrix.needsUpdate = true; } door.count = nd; door.instanceMatrix.needsUpdate = true; wheel.count = nw; wheel.instanceMatrix.needsUpdate = true; grp.visible = n > 0; },
    stats() { return { tris: n * 12 * 8, draws: 8 }; }, dispose() { scene.remove(grp); },
  };
}
