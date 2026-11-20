// park/landmarks.js (park lane, Nov 16): hand-built places of the park, one module each. park.js calls build() once per NEAR chunk, inside the chunk's
// collision owner (so game.statics entries made here go when the chunk goes). A module builds its place only in the chunk that holds the place's anchor
// point (inC(x, y)), returns a THREE.Group (or null) and must never throw past here. ?parkmarks=0: none of them.
import * as THREE from 'three';
import * as bethesda from './bethesda.js';
import * as mall from './mall.js';
const MODS = { bethesda, mall };
export function build(game, S, C, park, inC) {
  const g = new THREE.Group(); g.name = 'park_landmarks'; if (game.P && game.P.get('parkmarks') === '0') return g;
  for (const k in MODS) try { const o = MODS[k].build(game, S, C, park, inC); if (o) g.add(o); } catch (e) { console.log('[game] park: landmark ' + k + ' failed: ' + (e && (e.stack || e.message))); }
  return g;
}
