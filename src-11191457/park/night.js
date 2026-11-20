// park/night.js (park lane, Nov 16): the park's lamp posts at night. The night kit (sky/nightkit.js) lights the street from a top-down lamp map and
// draws a glow on every street lamp head, both made once from the street layer's lamps. This hands it the park's posts (park.lamps: [x, y, relief, src])
// through kit.addLamps: their pools go into the same lamp map (where the map reaches) and their lanterns get the same glow sprite, one draw for all.
// The kit is fetched the first time the light leaves full day, so this looks for it once a second until it is there. By day nothing is drawn.
import { BASE } from './ground.js';
export function install(game, park) {
  if (park.nightLamps) return; const N = park.nightLamps = { done: false, n: 0, tries: 0 };
  const go = () => { const k = game.night && game.night.kit; if (!k) return; if (!k.addLamps) { N.done = 'no addLamps in the kit'; clearInterval(N.t); return; }
    try { k.addLamps(park.lamps.map((l) => [l[0], l[1], BASE + l[2] + 3.12, 0.9])); N.n = park.lamps.length; N.done = true; console.log('[game] park: ' + N.n + ' lamp posts lit'); } catch (e) { N.done = 'failed: ' + (e && e.message); console.log('[game] park: night lamps ' + N.done); }
    clearInterval(N.t); };
  N.t = setInterval(go, 1000);
}
