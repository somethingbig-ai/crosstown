// park/cut.js (park lane): the flat street ground gives way to the park's relief. The game draws ONE road quad per map area at height 0 and the
// blocks' sidewalk at 0.15 right across Central Park (the park is inside two blocks): any hollow of the relief (the Pond's bowl, a sunk transverse)
// would lie under them. So a small picture of "the park's ground is drawn here" (the outline drawn INSET metres in, and only over chunks whose
// ground is loaded) is read by BOTH sides: every flat ground mesh that reaches into the park's box discards its fragments where the picture is
// white (patched here, at run time, by wrapping the material's onBeforeCompile: no other layer's file is edited), and the park's own ground
// discards where it is black. Nothing is patched with ?park=0 (this module is never loaded).
import * as THREE from 'three';

export const INSET = 3;      // metres inside the outline where the park's ground takes over from the street's sidewalk (heights fade to 0 there: ground.js)
const PXM = 0.5, PAD = 6;    // picture: 2 m a pixel

export function makeCut(game, park) {
  const T = game.terrain, world = game.world, [x0, y0, x1, y1] = T.box, bx = x0 - PAD, by = y0 - PAD, bw = x1 - x0 + 2 * PAD, bh = y1 - y0 + 2 * PAD;
  const W = Math.ceil(bw * PXM), H = Math.ceil(bh * PXM), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const U = { tParkCut: { value: tex }, uParkBox: { value: new THREE.Vector4(bx, by, W / PXM, H / PXM) } };
  const X = (x) => (x - bx) * PXM, Y = (y) => H - (y - by) * PXM, out = park.outline;
  const path = () => { g.beginPath(); g.moveTo(X(out[0][0]), Y(out[0][1])); for (let k = 1; k < out.length; k++) g.lineTo(X(out[k][0]), Y(out[k][1])); g.closePath(); };
  const cut = { U, tex, patched: 0, skipped: [] };
  // redraw: white where a loaded chunk's ground is drawn, inside the inset outline
  cut.redraw = () => { g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.save(); path(); g.clip(); g.fillStyle = '#fff';
    for (const C of park.chunks.values()) if (C.state >= 1) g.fillRect(X(C.i * 256) - 0.5, Y(C.j * 256 + 256) - 0.5, 256 * PXM + 1, 256 * PXM + 1); g.restore();
    g.strokeStyle = '#000'; g.lineWidth = 2 * INSET * PXM; g.lineJoin = 'round'; path(); g.stroke(); tex.needsUpdate = true; };
  const DECL = '\nuniform sampler2D tParkCut; uniform vec4 uParkBox; varying vec3 vPkW;\n';
  const CODE = '\n { vec2 pq = (vec2(vPkW.x, -vPkW.z) - uParkBox.xy) / uParkBox.zw; if (pq.x > 0.0 && pq.x < 1.0 && pq.y > 0.0 && pq.y < 1.0 && texture2D(tParkCut, pq).r > 0.5) discard; }\n';
  const seenMesh = new WeakSet(), seenMat = new WeakSet(), bb = new THREE.Box3();
  const patch = (m, name) => { if (!m || seenMat.has(m)) return; seenMat.add(m); if (!m.isMeshStandardMaterial && !m.isMeshBasicMaterial && !m.isMeshLambertMaterial && !m.isMeshPhongMaterial) { cut.skipped.push(name + ' (' + m.type + ')'); return; }
    const obc = m.onBeforeCompile, key = m.customProgramCacheKey;
    m.onBeforeCompile = function (sh, r) { if (obc) obc.call(this, sh, r); if (!sh.vertexShader.includes('#include <project_vertex>') || !sh.fragmentShader.includes('void main() {')) return; Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vPkW;').replace('#include <project_vertex>', '#include <project_vertex>\n vPkW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', DECL + 'void main() {' + CODE); };
    m.customProgramCacheKey = function () { return (key ? key.call(this) : '') + '|parkcut'; }; m.needsUpdate = true; cut.patched++; };
  // scan: flat ground meshes (their box within 0.4 m of the street level) that reach into the park's box; new map areas bring new ones
  cut.scan = () => { const walk = (o) => { if (o === park.root || !o.visible && !o.isMesh) return; if (o.isMesh && !seenMesh.has(o) && !o.isInstancedMesh && !o.isSkinnedMesh) { const ge = o.geometry;
        if (ge && ge.attributes && ge.attributes.position && ge.attributes.position.count) { seenMesh.add(o); if (!ge.boundingBox) ge.computeBoundingBox(); o.updateWorldMatrix(true, false); bb.copy(ge.boundingBox).applyMatrix4(o.matrixWorld);
          if (bb.max.y <= 0.4 && bb.min.y >= -0.2 && bb.max.x >= x0 && bb.min.x <= x1 && -bb.min.z >= y0 && -bb.max.z <= y1) { if (Array.isArray(o.material)) o.material.forEach((m) => patch(m, o.name)); else patch(o.material, o.name); } } }
      for (const c of o.children) walk(c); }; walk(world.scene); return cut.patched; };
  cut.redraw();
  return cut;
}
// with ?parkcut=0 the park's ground still needs the two uniforms: a 1 x 1 white picture
export function noCut() { const d = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); d.needsUpdate = true; return { tParkCut: { value: d }, uParkBox: { value: new THREE.Vector4(-1e6, -1e6, 2e6, 2e6) } }; }
