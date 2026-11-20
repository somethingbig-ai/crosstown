// water/navlights.js (water lane, Nov 16): the boats' lights after dark. Red to port, green to starboard, white at the stern, and on the ships a white
// masthead light; the cabin windows are lit. Each light is one soft additive point at the lamp the model already carries (boats.js parts.lights), so a
// boat reads at night from across the river. Driven by the game's clock (game.night.n, 0 by day .. 1 at night); by day nothing is drawn.
//   ?navlights=0 off      ?navlights=1 on in daylight too (to look at them)
import * as THREE from 'three';

export function installNav(g, W, api) {
  const P = g.P, world = g.world, force = P.get('navlights') === '1', MAXB = 48, N = MAXB * 4;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('size', new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, uniforms: { uH: { value: 900 }, uK: { value: 0 } },
    vertexShader: 'attribute float size; attribute vec3 color; uniform float uH; varying vec3 vC; void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * projectionMatrix[1][1] * uH * 0.5 / max(0.1, -mv.z), 5.0, 90.0); }',
    fragmentShader: 'uniform float uK; varying vec3 vC; void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 9.0) * 1.6 + exp(-r * r * 2.2) * 0.35; a *= smoothstep(1.0, 0.7, r); gl_FragColor = vec4(vC * a * uK, 1.0); }' });
  const pts = new THREE.Points(geo, mat); pts.name = 'boat_navlights'; pts.frustumCulled = false; pts.renderOrder = 60; pts.visible = false; world.scene.add(pts);
  const COL = { port: [1.0, 0.1, 0.05], starboard: [0.08, 1.0, 0.3], stern: [1.0, 0.95, 0.85], mast: [1.0, 0.95, 0.85] }, _v = new THREE.Vector3(), _b = new THREE.Box3();
  // where a boat's lamps are, in its own frame (x ahead, y up, z to starboard): the model's lamp meshes, or places worked out from its size
  function lampsOf(b) {
    if (b.navL) return b.navL; const S = b.spec, L = (b.M && b.M.parts && b.M.parts.lights) || {}, fb = S.freeboard || 1, out = [], big = S.len > 15;
    const at = (key, dflt) => { const m = L[key]; if (m && m.geometry) { try { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); m.geometry.boundingBox.getCenter(_v); if (isFinite(_v.x)) return [_v.x + m.position.x, _v.y + m.position.y, _v.z + m.position.z]; } catch (e) {} } return dflt; };
    const p = at('port', [S.len * 0.3, fb + 0.4, -S.beam * 0.4]), s = at('starboard', [S.len * 0.3, fb + 0.4, S.beam * 0.4]), w = at('stern', [-S.len * 0.46, fb + 0.5, 0]), sz = big ? 1.5 : 0.4;
    // the lamps stand a little proud of their housings, so the hull does not hide them from abeam
    out.push({ p: [p[0], p[1] + 0.05, p[2] - 0.12], c: COL.port, s: sz }, { p: [s[0], s[1] + 0.05, s[2] + 0.12], c: COL.starboard, s: sz }, { p: [w[0] - (big ? 0.15 : 0), w[1] + 0.06, w[2]], c: COL.stern, s: sz });
    if (big) out.push({ p: [S.len * 0.2, Math.max(p[1], w[1]) + (S.kind === 'tug' ? 3.2 : 2.6), 0], c: COL.mast, s: sz * 1.15 });
    return (b.navL = out);
  }
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) {
    sv0(dt);
    try { const k = force ? 1 : clamp01(((g.night && g.night.n) || 0) * 1.6 - 0.3); if (k <= 0.01) { pts.visible = false; W.navK = 0; return; }
      let n = 0; const cam = world.camera;
      for (const list of [W.boats, W.others]) for (const b of list) { if (n >= N - 4) break; if (Math.hypot(b.x - cam.position.x, b.y + cam.position.z) > 2600) continue;
        for (const l of lampsOf(b)) { api.toWorld(b, l.p, _v); pos[n * 3] = _v.x; pos[n * 3 + 1] = _v.y; pos[n * 3 + 2] = _v.z; col[n * 3] = l.c[0]; col[n * 3 + 1] = l.c[1]; col[n * 3 + 2] = l.c[2]; siz[n] = l.s; n++; }
        const cab = b.M && b.M.parts && b.M.parts.lights && b.M.parts.lights.cabin; if (cab) for (const m of cab) if (m && m.material && m.material.name === 'boat_windows') m.material.emissiveIntensity = 0.85 * k; }
      geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true;
      mat.uniforms.uK.value = k; mat.uniforms.uH.value = world.renderer.domElement.height || 900; pts.visible = n > 0; W.navK = k; W.navN = n;
    } catch (e) { W.err('navlights', e); }
  };
  W.nav = { pts, lampsOf };
  return W.nav;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
