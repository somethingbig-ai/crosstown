// sky/carrierlights.js (light lane, Nov 17 2026; CHIEF 06:34: "light the carrier at Pier 86 at night (deck lights, island windows)").
// The aircraft carrier (landmarks' hero model lm_carrier, assets/hero/hero.json) stood black against the river at night. This hands the night kit
// (sky/nightkit.js, kit.addLamps: the park's lamp posts use the same door) a set of lamp heads on the ship: low lights along both edges of the
// flight deck, floodlights on the island's four corners, lit ports along its two long faces, a row along the bridge glass and one at the masthead.
// They are the kit's own glow sprites, one draw for all, switched with the street lamps; by day nothing is drawn. Glows only: the kit's lamp
// map lights the STREET under a lamp, and under these is a pier 15 m below the deck.
// EVERY place below was taken from the model's own vertices (lm_carrier.glb, which is in map metres) and checked to lie within 1.6 m of it
// (lanes/light/carrier/out/island-lamps.json, deckpts.json). The first cut placed the island's lights on the corners of a box drawn square to the
// map round an island that stands at 27 degrees to it, and 29 of 73 hung in the air (merge's critic, batch 10: "glowing orbs ... attached to
// nothing"). If landmarks moves or rebuilds the ship, these must be taken again.
// Strengths stay at 0.6 or under: above about 0.8 the kit's glow sprite clips and shows its square.
// ?carrierlights=0 = this file is never fetched. ?lm=0 (no carrier) = no lights. game.carrierLights for tests.
export function install(game) {
  const C = (game.carrierLights = { done: false, n: 0, tries: 0 });
  const EDGE = [[-1068.3,2161],[-1081.6,2135.2],[-1084.1,2169.6],[-1097.3,2143.8],[-1099.9,2178.3],[-1115,2148.9],[-1115.7,2187],[-1128.7,2161.6],[-1131.3,2196.1],[-1144.9,2169.4],[-1146.8,2205.1],[-1161.4,2176.7],[-1157.2,2224.5],[-1177,2185.8],[-1172.7,2233.6],[-1192.8,2194.4],[-1188.3,2242.7],[-1208.8,2202.6],[-1205,2249.6],[-1224.6,2211.3],[-1221.9,2256],[-1241.3,2218.2],[-1238.8,2262.4],[-1261,2219.2],[-1255.8,2268.8],[-1272,2237.2],[-1272.9,2274.8],[-1288.2,2245],[-1290.3,2280.4],[-1302.2,2257.2]];      // deck edge, every 18 m, 1.5 m in from the ship's outline; lit 1.1 m above the deck
  const ISLAND = [[-1174.8,2220.2,24.1,0.6],[-1171.3,2226.8,24.1,0.6],[-1208.9,2237.9,27.3,0.6],[-1205.1,2245.1,27.3,0.6],[-1180.0,2223.9,23.5,0.45],[-1177.4,2229.1,23.5,0.45],[-1187.5,2227.9,23.5,0.45],[-1184.8,2233.0,23.5,0.45],[-1191.8,2228.6,23.5,0.45],[-1187.9,2236.3,23.5,0.45],[-1204.8,2230.8,19.0,0.45],[-1206.6,2236.6,23.5,0.45],[-1202.8,2243.9,19.0,0.45],[-1202.8,2243.9,23.5,0.45],[-1210.4,2238.3,19.0,0.45],[-1206.4,2246.3,19.0,0.45],[-1192.0,2237.7,27.5,0.5],[-1197.2,2232.3,27.5,0.5],[-1196.0,2239.9,27.5,0.5],[-1201.2,2234.3,27.5,0.5],[-1200.9,2242.4,27.5,0.5],[-1202.6,2243.4,27.5,0.5],[-1194.9,2235.0,47.1,0.6]];      // [x, y, height, strength]: floodlights, ports, bridge glass, masthead
  const lamps = () => EDGE.map(([x, y]) => [x, y, 15.5, 0.5]).concat(ISLAND);
  const go = () => { if (++C.tries > 900) { clearInterval(C.t); C.done = 'gave up'; return; }
    const k = game.night && game.night.kit, w = game.world; if (!k || !k.addLamps || !w.heroRoot) return; let ship = false; w.heroRoot.traverse((o) => { if (/lm_carrier/.test(o.name || '')) ship = true; }); if (!ship) return;
    clearInterval(C.t); try { const hs = lamps(), m = k.map; k.map = null; try { C.glow = k.addLamps(hs); } finally { k.map = m; } C.n = hs.length; C.done = true; console.log('[game] carrier: ' + C.n + ' lights on deck and island'); } catch (e) { C.done = 'failed: ' + (e && e.message); console.log('[game] carrier lights ' + C.done); } };
  C.t = setInterval(go, 1000);
}
