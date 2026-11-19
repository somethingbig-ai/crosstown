// hero/lmnight.js (landmarks lane, Nov 17; merge's critics on batch 12: at night St Patrick's, the stair tower and the diagrid glass "read as dark holes in a
// lit city"): the landmark models (hero.json rows named lm_*) carry no night look of their own. Here, as night comes on (world.shared.uNightK.y):
//   - window materials (names starting "pane") glow warm, as lit rooms do;
//   - every other non-metal material takes a low glow of its own colour and texture, the way a floodlit stone front reads; metal keeps to reflections.
// No lights are added and nothing is fetched: only the emissive of materials the models already have. ?lmnight=0 = off. window.__lmnight for a look.
import * as THREE from 'three';
// Which models: those seen at night with this file and judged right (St Patrick's, the stair tower: stills Nov 17). ?lmnight=all = every lm_ model (to try the rest).
const ONLY = /^lm_(st_patricks|stair_tower|grand_central|library_front)$/;     /* merge lane, Nov 18: + the terminal and the library front (blind night pairs: lit picked; the viaduct, the plaza, the steps and the carrier lost lit and stay as they are) */
const UPTOWN = /^(met|theresa|sanremo|dakota|langham)$/;     /* merge lane, Nov 18: the uptown map's hand-built fronts too (round 27's audit: 'landmarks unlit at night') */
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
  let n = 0, last = -1; const tick = () => { const k = Math.max(0, Math.min(1, night.value.y)); if (Math.abs(k - last) > 0.004) { last = k; out.k = k; for (const [m, f] of mats) m.emissiveIntensity = f * k; } requestAnimationFrame(tick); };
  const iv = setInterval(() => { const st = W.heroState, G = (st && st.groups) || {}, root = W.heroRoot; n++; if (root) for (const g in G) { if (done.has(g) || G[g] !== 'in' || !(UPTOWN.test(g) || (/^lm_/.test(g) && (ALL || ONLY.test(g))))) continue; const r = root.getObjectByName('hero_' + g); if (!r) continue; done.add(g); take(r); out.groups = done.size; out.mats = mats.length; last = -1; }
    if (n > 400 || (st && st.done && n > 30)) clearInterval(iv); }, 1000);
  requestAnimationFrame(tick); return out;
}
