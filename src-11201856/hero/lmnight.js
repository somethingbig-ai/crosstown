// hero/lmnight.js (landmarks lane, Nov 17; merge's critics on batch 12: at night St Patrick's, the stair tower and the diagrid glass "read as dark holes in a
// lit city"): the landmark models (hero.json rows named lm_*) carry no night look of their own. Here, as night comes on (world.shared.uNightK.y):
//   - window materials (names starting "pane") glow warm, as lit rooms do;
//   - every other non-metal material takes a low glow of its own colour and texture, the way a floodlit stone front reads; metal keeps to reflections.
// No lights are added and nothing is fetched: only the emissive of materials the models already have. ?lmnight=0 = off. window.__lmnight for a look.
import * as THREE from 'three';
// Which models: those seen at night with this file and judged right (St Patrick's, the stair tower: stills Nov 17). ?lmnight=all = every lm_ model (to try the rest).
const ONLY = /^lm_(st_patricks|stair_tower|grand_central|library_front)$/;     /* merge lane, Nov 18: + the terminal and the library front (blind night pairs: lit picked; the viaduct, the plaza, the steps and the carrier lost lit and stay as they are) */
const UPTOWN = /^(met|theresa|sanremo|dakota|langham)$/;     /* merge lane, Nov 18: the uptown map's hand-built fronts too (round 27's audit: 'landmarks unlit at night') */
/* uptown lane, PROPOSED (handoff-u14/lmnight-metflood.patch; OFF unless ?metflood=1): a smooth floodlight on the Met's Fifth Av front, worked out per pixel from where the pixel stands.
   STONE (materials mstone*, mplain*, mgran*, mrust*, mflute*, mpil*, mdent*): a row of uplights on the four column pedestals (7.45 m up, 25 m either side of the front's middle), fading with height above
   them, a little stronger over each pedestal near its foot, weaker inside the arches and behind the front; along the wings a quick fall and then a long soft tail, so the wings read dim-lit, not switched
   off; the plinth below the lamps keeps a third; a pool round each lamp standard's globes. Times the stone's own colour and picture, times the night (0 by day). The model's own constant stone light
   (hero-u11 on) is switched off under it. GROUND (mstep*, mstair*: the landing and the flights): a soft warm spill that is gone 15 m out from the wall, and a pool at the foot of each standard.
   GLOBES (mlamp): a warm light of their own at night on top of what they have. No light object, no new draw, one extra uniform; these materials get their own programs. */
const METFLOOD = new URLSearchParams(location.search).get('metflood') !== '0' /* merge lane, Nov 20: ON by default after the blind round of batch 44 (12 better, 12 equal, 0 worse); ?metflood=0 = the flat glow as before */, MET_K = { value: 0 }, MET_STONE = /^(mstone|mplain|mgran|mrust|mflute|mpil|mdent)/, MET_GROUND = /^(mstep|mstair)/, MET_GLOBE = /^mlamp/;
const MET_FS = `uniform float uMetK; varying vec3 vMetW;
vec3 metFrame(vec3 p){ return vec3((p.x - 2017.043) * 0.48328 + (-p.z - 3772.224) * 0.87546, p.y, (p.x - 2017.043) * 0.87546 - (-p.z - 3772.224) * 0.48328); }
float metPool(vec3 q, float y, float r2){ float d1 = distance(q, vec3(22.85, y, 4.2)), d2 = distance(q, vec3(37.75, y, 4.2)); return 1.0 / (1.0 + d1 * d1 / r2) + 1.0 / (1.0 + d2 * d2 / r2); }
float metFlood(vec3 p){ vec3 q = metFrame(p); float u = q.x, w = q.z, h = q.y - 7.45, hp = max(h, 0.0);
  float du = max(abs(u - 30.3) - 25.0, 0.0), L = (0.65 / (1.0 + du * du / 144.0) + 0.35 / (1.0 + du * du / 2500.0)) * mix(0.34, 1.0, smoothstep(-3.5, 0.8, h)) / (1.0 + hp * hp / 150.0);
  vec4 pu = (vec4(u) - vec4(7.95, 22.85, 37.75, 52.65)) / 4.5; vec4 pe = exp(-pu * pu); float sc = pe.x + pe.y + pe.z + pe.w;
  L *= mix(1.0, 0.62 + 0.55 * min(sc, 1.0), exp(-hp / 6.0)) * mix(0.6, 1.0, smoothstep(-1.2, -0.2, w)) * (1.0 - 0.75 * smoothstep(2.5, 14.0, -w));
  return L + 0.5 * metPool(q, 9.5, 2.5); }
float metSpill(vec3 p){ vec3 q = metFrame(p); float du = max(abs(q.x - 30.3) - 26.0, 0.0);
  return 0.30 * (1.0 - smoothstep(2.0, 15.0, q.z)) / (1.0 + du * du / 60.0) + 0.42 * metPool(q, 5.0, 7.0) * (1.0 - smoothstep(6.0, 14.0, q.z)); }`;
function metFlood(root) { let n = 0; root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (!m || !m.isMeshStandardMaterial || m.userData.metFlood) continue;
    const nm = m.name || '', kind = MET_STONE.test(nm) ? 1 : MET_GROUND.test(nm) ? 2 : MET_GLOBE.test(nm) ? 3 : 0; if (!kind) continue; m.userData.metFlood = kind; n++; if (kind === 1) m.emissive.setRGB(0, 0, 0);
    const add = kind === 1 ? 'diffuseColor.rgb * vec3(1.0, 0.80, 0.55) * (uMetK * metFlood(vMetW))' : kind === 2 ? 'diffuseColor.rgb * vec3(1.0, 0.80, 0.55) * (uMetK * metSpill(vMetW))' : 'vec3(1.0, 0.86, 0.6) * (uMetK * 3.4)';
    m.onBeforeCompile = (sh) => { sh.uniforms.uMetK = MET_K;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMetW;').replace('#include <project_vertex>', '#include <project_vertex>\nvMetW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MET_FS).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ' + add + ';'); };
    m.customProgramCacheKey = () => 'metflood' + kind; m.needsUpdate = true; } }); return n; }
export function install(game) {
  const ALL = new URLSearchParams(location.search).get('lmnight') === 'all';
  const W = game.world; if (!W) return null; const night = W.shared && W.shared.uNightK; if (!night) return null;
  const mats = [], seen = new Set(), done = new Set(), out = { groups: 0, mats: 0, k: 0 }; window.__lmnight = out;
  const take = (root) => root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (!m || seen.has(m) || !m.emissive || /^glass/i.test(m.name || '')) continue; seen.add(m);
      const pane = /^pane/i.test(m.name || ''), metal = (m.metalness || 0) > 0.5; if (metal) continue;
      const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;     /* linear */
      if (pane) { m.emissive = new THREE.Color(1.0, 0.80, 0.52); mats.push([m, lum < 0.03 ? 0.50 : 0.07]); }     /* dark window panes = lit rooms; a pale glass curtain wall only a faint glow (a whole tower lit cream at 0.5: stills night2) */
      else { m.emissive = m.color.clone(); if (lum > 0.18) m.emissive.multiplyScalar(0.18 / lum); if (m.map && !m.emissiveMap) m.emissiveMap = m.map; mats.push([m, 0.14]); }     /* pale stone capped: white marble blew out to a blank sheet */
      m.emissiveIntensity = 0; m.needsUpdate = true; } });
  let n = 0, last = -1; const tick = () => { const k = Math.max(0, Math.min(1, night.value.y)); if (Math.abs(k - last) > 0.004) { last = k; out.k = k; MET_K.value = 0.13 * k; for (const [m, f] of mats) m.emissiveIntensity = f * k; } requestAnimationFrame(tick); };
  const iv = setInterval(() => { const st = W.heroState, G = (st && st.groups) || {}, root = W.heroRoot; n++; if (root) for (const g in G) { if (done.has(g) || G[g] !== 'in' || !(UPTOWN.test(g) || (/^lm_/.test(g) && (ALL || ONLY.test(g))))) continue; const r = root.getObjectByName('hero_' + g); if (!r) continue; done.add(g); take(r); if (METFLOOD && g === 'met') out.metFlood = metFlood(r); out.groups = done.size; out.mats = mats.length; last = -1; }
    if (n > 400 || (st && st.done && n > 30)) clearInterval(iv); }, 1000);
  requestAnimationFrame(tick); return out;
}
