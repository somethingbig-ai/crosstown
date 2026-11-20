// park/heroes/index.js (park lane, helper heroes, Nov 16): the hand-built places every New Yorker knows, one module each: Bethesda Terrace and its
// fountain, the Mall, Bow Bridge. park.js calls build() once per NEAR chunk, inside the chunk's collision owner and AFTER the chunk's generic bridges
// are made: a hero that takes the place of a generic bridge / arch hides that feature's drawing and keeps its decks and collision.
// Each module builds only what lies in this chunk (inC), returns a THREE.Group or null. ?parkheroes=0: none of them, the park as before.
import * as THREE from 'three';
import * as bethesda from './bethesda.js';
import * as mall from './mall.js';
import * as bow from './bow.js';
const MODS = { bethesda, mall, bow }, CELL = 256;
export function build(game, S, C, park) {
  const g = new THREE.Group(); g.name = 'park_heroes'; if (game.P && game.P.get('parkheroes') === '0') return g;
  const inC = (x, y) => x >= C.i * CELL && x < C.i * CELL + CELL && y >= C.j * CELL && y < C.j * CELL + CELL;
  for (const k in MODS) try { const o = MODS[k].build(game, S, C, park, inC); if (o) { g.add(o); park.heroTris = park.heroTris || {}; (park.heroTris[k] = park.heroTris[k] || {})[C.id] = o.userData.tris; console.log('[game] park: hero ' + k + ' in ' + C.id + ': ' + o.userData.tris + ' triangles ' + JSON.stringify(o.userData.n || {})); } }
    catch (e) { console.log('[game] park: hero ' + k + ' failed: ' + (e && (e.stack || e.message))); }
  return g;
}
