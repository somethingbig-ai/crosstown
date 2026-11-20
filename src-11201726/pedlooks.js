// pedlooks.js (people lane, Nov 17 2026): the game's own close pedestrians are four bodies in four fixed outfits, so fourteen of them read as
// clones ("the same suit, the same red tee, the same green sweater, one face on four people": blind judges, Nov 16). Each pedestrian body now gets a
// look of its own, with no new model or picture: its main garment recoloured (only the texels of that garment's own colour: the red of the tee, not
// the jeans drawn on the same picture), its hair and brows recoloured, its skin tone scaled. One hook line in game.js; it wraps peds.visual, so only
// pedestrians change (the player, drivers, police and the crowd are untouched). ?pedlooks=0 = as before. With MetaHuman pedestrians in (?mh) it finds
// none of these materials and does nothing.
import * as THREE from 'three';

// per body: W = the garment's colour direction (key = how far a texel leans that way, relative to its brightness), L = the garment's mean
// brightness in the picture (linear), pal = garment colours to hand out (null = as drawn), skin = tone factors
const C = { K: [0.012, 0.012, 0.014], CH: [0.03, 0.03, 0.034], G: [0.13, 0.13, 0.135], LG: [0.32, 0.32, 0.33], N: [0.02, 0.03, 0.075], BR: [0.07, 0.045, 0.028], CA: [0.36, 0.25, 0.12], BU: [0.17, 0.025, 0.035], OL: [0.07, 0.08, 0.035], W: [0.62, 0.62, 0.6], MU: [0.45, 0.3, 0.06], GR: [0.06, 0.16, 0.08], TE: [0.04, 0.16, 0.17] };
const LIGHT = [[1, 1, 1], [1, 1, 1], [0.86, 0.8, 0.77], [0.62, 0.53, 0.48], [0.42, 0.34, 0.3]], DARK = [[1, 1, 1], [1, 1, 1], [1.7, 1.8, 1.9], [2.8, 3.0, 3.2]];
const KIND = {
  ped_a: { W: [-0.5, -0.5, 1], L: 0.028, pal: [null, C.CH, C.K, C.G, C.BR, C.OL], skin: LIGHT },          // navy suit
  ped_b: { W: [1, -0.5, -0.5], L: 0.17, pal: [null, C.W, C.K, C.N, C.LG, C.MU, C.GR, C.TE], skin: DARK },   // red tee over jeans
  ped_c: { W: [-0.5, 1, -0.5], L: 0.038, pal: [null, C.N, C.CH, C.BU, C.CA, C.G, C.K], skin: LIGHT },       // green sweater
  ped_d: { W: [1, 0, -1], L: 0.22, pal: [null, C.CH, C.N, C.K, C.G, C.OL, C.BU], skin: LIGHT },             // brown suit
};
const HAIR = [null, [0.012, 0.01, 0.009], [0.05, 0.03, 0.018], [0.11, 0.065, 0.03], [0.33, 0.23, 0.1], [0.3, 0.3, 0.31], [0.16, 0.05, 0.025]];

// a copy of the material whose picture is recoloured in the fragment stage: texels that lean the garment's way become tint * (their brightness / L)
function recolour(mat, W, K, B, L, tint) {
  const m = mat.clone(); m.name = mat.name; const U = { uLookW: { value: new THREE.Vector3(...W) }, uLookK: { value: new THREE.Vector2(K, B) }, uLookT: { value: new THREE.Vector3(tint[0] / L, tint[1] / L, tint[2] / L) } };
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, U);
    sh.fragmentShader = 'uniform vec3 uLookW; uniform vec2 uLookK; uniform vec3 uLookT;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 lc = diffuseColor.rgb; float lL = dot(lc, vec3(0.299, 0.587, 0.114)); float lk = clamp(dot(lc, uLookW) / max(lL, 0.002) * uLookK.x + uLookK.y, 0.0, 1.0); diffuseColor.rgb = mix(lc, uLookT * lL, lk); }'); };
  m.customProgramCacheKey = () => 'pedlook1'; m.needsUpdate = true; return m;
}
const hash = (n, k) => { let h = (Math.imul(n + 1, 2654435761) ^ Math.imul(k + 7, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return (h ^ (h >>> 13)) >>> 0; };

export function install(game) {
  const peds = game.peds; if (!peds || typeof peds.visual !== 'function' || !game.kit || !game.kit.peopleExport) return false;
  const visual = peds.visual.bind(peds), count = {}, st = (game.pedLooks = { bodies: 0, garments: 0, hair: 0, skin: 0, failed: 0 });
  peds.visual = function (kind) {
    const v = visual(kind), cfg = KIND[kind]; if (!v || v.looked || !cfg || !v.object) return v; v.looked = true;
    try { const n = (count[kind] = (count[kind] || 0) + 1) - 1, g = cfg.pal[n < cfg.pal.length ? (n + 1) % cfg.pal.length : hash(n, 1) % cfg.pal.length], hr = HAIR[hash(n, kind.charCodeAt(4)) % HAIR.length], sk = cfg.skin[hash(n, 3) % cfg.skin.length]; let touched = false;
      v.object.traverse((o) => { if (!o.isMesh || Array.isArray(o.material) || !o.material) return; const nm = o.material.name || '';
        if (/^top_/.test(nm) && g) { o.material = recolour(o.material, cfg.W, 2.2, 0, cfg.L, g); st.garments++; touched = true; }
        else if (/^(hair|brows)_/.test(nm) && hr) { o.material = recolour(o.material, [0, 0, 0], 0, 1, 0.02, hr); st.hair++; touched = true; }
        else if (/^skin_/.test(nm) && (sk[0] !== 1 || sk[1] !== 1)) { const m = o.material.clone(); m.name = nm; m.color.multiply(new THREE.Color(sk[0], sk[1], sk[2])); o.material = m; st.skin++; touched = true; } });
      if (touched) st.bodies++;
    } catch (e) { st.failed++; console.log('[pedlooks] ' + kind + ': ' + (e && e.message)); }
    return v; };
  console.log('[pedlooks] on: each pedestrian body gets its own garment colour, hair and skin tone'); return true;
}
