// lowtier.js (light lane, Nov 17 2026; CHIEF 06:34): a tier BELOW the frame-rate governor's floor.
// Why: of 59 public reports under 35 fps, 50 were already at the governor's floor (smallest picture, no AO, FXAA) and still slow, and most of
// those were Apple M-series laptops, not weak Windows cards: at the floor the frame is held up by work that does not shrink with the picture.
// Measured at that floor on an M2 Pro (lanes/light/lowtier/out/levers1.log, 20 ms frames): the sun-shadow pass 3.1 ms, the street mirror 1.6 ms,
// bloom and the other picture passes about 0. So this tier cuts those two and nothing a player at full quality ever runs:
//   - the sun-shadow map is redrawn every 4th frame (world.shadowEvery; shadows of moving cars and people step instead of gliding);
//   - the street mirror in car paint and glass is redrawn a face every 24th frame (world.streetEvery), about four times slower than the floor's.
// When: the game's own governor must already be at its floor (picture scale <= 0.66, detail <= 0.5) and the frame rate under 30 for 6 s in a row;
// it leaves again after 20 s in a row at 50 or more (it then holds full shadows for at least 30 s before it may come back, so it cannot flap).
// It never acts while a quality is pinned in the menu, in a capture, in the fly camera or while paused. No card names: frame time decides.
// ?tier=low  = on from the start, with the weak-card floor (as ?weak=1)        ?tier=high = never, and the governor's quality pinned at full
// ?tier=off  = this file is never fetched                                       game.tier.info() for tests
export function install(game) {
  const P = game.P, w = game.world, force = P.get('tier');
  const T = (game.tier = { low: false, slow: 0, fast: 0, hold: 0, n: 0, info: () => ({ low: T.low, shadowEvery: w.shadowEvery || 1, streetEvery: w.streetEvery || 3, scale: w.liveScale || 1, detail: w.detail || 1, fps: Math.round(game.fps || 0), force: force || 'auto', switches: T.n }) });
  const set = (on, why) => { if (T.low === on) return; T.low = on; T.n++; w.shadowEvery = on ? 4 : 1; if (on) { T._se = w.streetEvery; w.streetEvery = 24; } else if (w.streetEvery === 24) w.streetEvery = T._se || 6;
    console.log('[tier] ' + (on ? 'low tier on: sun shadows every 4th frame, street mirror slower' : 'low tier off: shadows every frame again') + ' (' + why + ')'); };
  if (force === 'high') { game.qPin = true; console.log('[tier] high forced: quality pinned at full'); return; }
  setInterval(() => { try {
    if (force === 'low') { if (!T.low && (w.streetN || 0) > 30) set(true, 'forced by ?tier=low'); else if (T.low && w.streetEvery !== 24) w.streetEvery = 24; return; }      // the governor's detail steps reset the mirror rate; hold it
    if (game.qPin || game.capture || game.paused || (game.fly && game.fly.on) || document.hidden) { T.slow = T.fast = 0; return; }
    const fps = game.fps || 0, floor = (w.liveScale || 1) <= 0.66 && (w.detail || 1) <= 0.51; if (T.hold > 0) T.hold--;
    if (!T.low) { T.slow = floor && fps > 1 && fps < 30 ? T.slow + 1 : 0; if (T.slow >= 6 && T.hold <= 0) { T.slow = 0; set(true, Math.round(fps) + ' fps at the smallest picture'); } }
    else { if (w.streetEvery !== 24) w.streetEvery = 24; T.fast = fps >= 50 ? T.fast + 1 : 0; if (T.fast >= 20) { T.fast = 0; T.hold = 30; set(false, Math.round(fps) + ' fps held'); } }
  } catch (e) {} }, 1000);
}
