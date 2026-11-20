// park/mat.js (park lane): what every park material shares with the rest of the game's light: the sun and its shadow map come from three.js
// (MeshStandardMaterial), the baked sky / far-shadow / bounce light from the ground lightmap by the formula of world.js (BAKE_LIGHT_GLSL).
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL, NOISE_GLSL } from '../facade.js';

// look pass k2 (Nov 16): seen against the sun every far tree drew white-cream and the rock a pale sheet (stills k1 c, b). Cause: the standard
// material's white highlight (GGX, F0 0.04, plus the sky's reflection) on albedos of 0.03-0.15: a tree mass's one rounded normal leaning up and the
// flat rock both put the half-vector on the normal when the view faces a low sun, and the highlight came to several times the diffuse light.
// A twig mass, leaf litter and weathered schist have no such lobe. `spec` (0..1, per material) scales both highlights; the body may set pkSpec
// per pixel; pkSide scales the sun's diffuse light (pkAgainstSun(lo): lo when the view faces the sun, 1 with the sun behind: a tree's far side
// is in its own shade). ?parksun=0 = as before.
const SUN_OLD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('parksun') === '0';

// handoff-9, the night (merge's batch 7: "its night is crushed to black and the wall, rock, pond and ground disappear"). Cause: the look pass turned the
// park's base colours down (rock 0.36 -> 0.076, stone 0.30..0.50 -> 0.10..0.19, deck 1.2 -> 0.36, shore stone 0.38 -> 0.15, far crowns x 0.55) and
// its highlights off (pkSpec 0.08..0.3) against the DAY's light, where the camera's metering and local tone step carry a dark surface. The night has
// neither: its exposure sits on its cap (sky/night.js expMax 3.2, the local tone step off), its only light on a surface away from a lamp is the dim
// sky's reflection (the very highlight pkSpec removes) and the moon, and the lamp pass (sky/nightkit.js LIGHT_FS) adds lamp light times
// (pixel / night ambient) = the base colour again. Every term is the base colour or the highlight times a fixed small number, so a third of the
// colour drew a third of the picture, below what the screen shows. Now: as the night comes (uNightK.x, the night kit's own number in world.shared:
// 1 by day, 0.05 at full night) a material's colour goes back up by `night` (what the look pass took off; the body may set pkNight per pixel) and
// pkSpec / pkSide go back to 1. By day the factor is exactly 1 and nothing changes. ?parknight=0 = the night as handoff-6 had it; ?parknightk=K scales the gain.
// The gain is 1.6 by default (hold n9a, Nov 17: at 1 the rock still read 9.0 against live's 16.7 in the lower half of camera c; at 1.6 17.5, the lawn and Fifth Ave level).
const NIGHT_K = (() => { if (typeof location === 'undefined') return 1.6; const q = new URLSearchParams(location.search); if (q.get('parknight') === '0') return 0; const k = q.get('parknightk'); return k !== null && k !== '' && isFinite(+k) ? Math.max(0, +k) : 1.6; })();

// lit(material, shared, { pars, body, key, spec, night }): adds vWPos (instancing aware), the lightmap read and the bake formula.
// pars = extra fragment declarations, body = GLSL run after <map_fragment> (may write diffuseColor, pkRough), key = program cache key.
export function lit(m, shared, o = {}) {
  const extra = o.uniforms || {}, NT = NIGHT_K > 0 && !!(shared && shared.uNightK);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, extra);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWPos; varying vec3 vWN;' + (o.vpars || ''))
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp_ = vec4(transformed, 1.0); vec3 wn_ = objectNormal;
          #ifdef USE_INSTANCING
            wp_ = instanceMatrix * wp_; wn_ = mat3(instanceMatrix) * wn_;
          #endif
          vWPos = (modelMatrix * wp_).xyz; vWN = normalize(mat3(modelMatrix) * wn_); ${o.vbody || ''}
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWN; uniform sampler2D tLight; uniform vec2 uHalf;
        uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
        ${NOISE_GLSL}
        vec3 bakeV; vec3 bakeN; float pkRough = -1.0; float pkSpec = ${SUN_OLD ? '1.0' : (o.spec === undefined ? 1 : o.spec).toFixed(3)}; float pkSide = 1.0; ${NT ? 'uniform vec3 uNightK;' : ''} float pkNight = ${(o.night === undefined ? 1 : o.night).toFixed(3)}; float pkNightE = 0.0; ${o.pars || ''}
        float pkAgainstSun(float lo) { vec2 sd = uSunDir.xz, cd = cameraPosition.xz - vWPos.xz; float sv = dot(sd, cd) / max(length(sd) * length(cd), 1e-4);
          return mix(1.0, mix(lo, 1.0, smoothstep(-0.85, 0.25, sv)), (1.0 - smoothstep(0.8, 0.98, uSunDir.y)) * step(0.0, uSunDir.y)); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 w = vWPos.xz;
          bakeV = texture2D(tLight, vec2(w.x / (2.0 * uHalf.x) + 0.5, -w.y / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = normalize(vWN);
          ${o.body || ''}
          ${NT ? `pkNightE = clamp((1.0 - uNightK.x) / 0.95, 0.0, 1.0); diffuseColor.rgb *= 1.0 + (pkNight - 1.0) * ${NIGHT_K.toFixed(3)} * pkNightE;` : ''}
        }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (o.nbody || ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n if (pkRough >= 0.0) roughnessFactor = pkRough;')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + (SUN_OLD ? '' : (NT ? '\n pkSpec = mix(pkSpec, 1.0, pkNightE); pkSide = mix(pkSide, 1.0, pkNightE);' : '') + '\n reflectedLight.directSpecular *= pkSpec; reflectedLight.indirectSpecular *= pkSpec; reflectedLight.directDiffuse *= pkSide;'));
  };
  m.customProgramCacheKey = () => 'park:' + (o.key || 'plain') + (NT ? ':n' : '');
  return m;
}

const TL = new THREE.TextureLoader();
export function tex(url, world, srgb = true, aniso = 8) {
  return new Promise((res) => TL.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(aniso, world.renderer.capabilities.getMaxAnisotropy()); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t); }, undefined, () => { console.log('[game] park: texture missing: ' + url); const d = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); d.needsUpdate = true; d.wrapS = d.wrapT = THREE.RepeatWrapping; res(d); }));
}
export const breathe = () => new Promise((r) => { let d = false; const go = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 80); });
export function disposeGroup(g) { g.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); const m = o.material; if (m && m.userData && m.userData.own) { for (const k in m.userData.own) { const t = m.userData.own[k]; if (t && t.dispose) t.dispose(); } m.dispose(); } if (o.isInstancedMesh) o.dispose(); }); }
// merged([[geometry, [r, g, b], Matrix4?], ...]) -> one non-indexed geometry with position, normal, color (linear rgb per part)
export function merged(parts) {
  let n = 0; const gs = parts.map(([g, c, m]) => { let q = g.index ? g.toNonIndexed() : g.clone(); if (m) q.applyMatrix4(m); if (!q.attributes.normal) q.computeVertexNormals(); n += q.attributes.position.count; return [q, c]; });
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const [q, c] of gs) { pos.set(q.attributes.position.array, o * 3); nrm.set(q.attributes.normal.array, o * 3); for (let k = 0; k < q.attributes.position.count; k++) { col[(o + k) * 3] = c[0]; col[(o + k) * 3 + 1] = c[1]; col[(o + k) * 3 + 2] = c[2]; } o += q.attributes.position.count; q.dispose(); }
  const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); G.setAttribute('color', new THREE.BufferAttribute(col, 3)); return G;
}
