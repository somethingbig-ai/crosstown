// hints.js (progress lane, Nov 15): the few things a new player must discover, said IN PLAY the way runhint.js says "Hold SHIFT to run":
// ONE short line near the bottom, at the moment the game has seen the need, about 6 s, at most twice ever, never again once he has done it.
//   car     on foot 12 s in all, within 6 m of a parked or stopped car for 1 s, never been in one   "Press F next to a car to drive it"
//   heli    on foot within 15 m of the landed helicopter for 1 s, never flown                         "Walk to the helicopter's door and press F to fly it"
//   subway  standing 3 s within 4 m of the top of an OPEN subway stair, never been below             "Walk down the stairs to ride the subway"
//   menu    45 s played, the menu never opened (players wrote they could not find the controls)      "P or ESC: all the controls and settings"
//   map     90 s played, the full-screen map never opened                                            "TAB opens the city map"
//   fb      4 minutes played, the feedback form never opened; ONCE ever                               "Something wrong or missing? Press B to tell us"
// Keys are the player's bound ones (menu keys); with a controller as the last input the wording changes (Y / the Menu button; the map and the
// feedback form have no controller button, so those say "on the keyboard"). One chip at a time and never with runhint's: 8 s between any two,
// nothing while paused, on the start screen, on the full map, in the feedback form, in the fly camera, underground, or under a job banner / GPS note.
// Kept in the settings as 'hints' = { shown: {id: n}, done: {id: 1} } (for the page load only when there are no settings).
// Cost: one timer four times a second, nothing per frame; game.hints.cost has the measured tick. ?hints=0 leaves the file unfetched.
const SHOW = 6, GAP = 8, AGAIN = 45, TICK = 0.25;
export function install(game) {
  if (game.demo || game.capture || game.hints) return;
  const S = game.settings, shown = {}, done = {};
  try { const o = S && S.get('hints', null); if (o && typeof o === 'object') { Object.assign(shown, o.shown || {}); Object.assign(done, o.done || {}); } } catch (e) {}
  const save = () => { try { if (S) S.set('hints', { shown: { ...shown }, done: { ...done } }); } catch (e) {} };
  const now = () => performance.now();
  let played = 0, footT = 0, nearT = { car: 0, heli: 0, subway: 0 }, cur = null, hideAt = 0, freeAt = 0, el = null, iv = 0, padT = -1e9, keyT = -1e9, padPS = false, rhFirst = -1;
  const last = {}, cost = { n: 0, ms: 0, max: 0 };

  // ---- the words
  const key = (code, dflt) => { try { const m = game.menu, n = m && (m.keys && m.keys.keyName ? m.keys.keyName(code) : m.keyName ? m.keyName(code) : null); if (n) return String(n).toUpperCase(); } catch (e) {} return dflt; };
  const onPad = () => padT > keyT && now() - padT < 60000;
  const use = () => (onPad() ? (padPS ? '△' : 'Y') : key('KeyF', 'F'));
  const TEXT = {
    car: () => 'Press ' + use() + ' next to a car to drive it',
    heli: () => 'Walk to the helicopter’s door and press ' + use() + ' to fly it',
    subway: () => 'Walk down the stairs to ride the subway',
    menu: () => (onPad() ? 'The ' + (padPS ? 'OPTIONS' : 'MENU') + ' button: all the controls and settings' : key('KeyP', 'P') + ' or ESC: all the controls and settings'),
    map: () => key('Tab', 'TAB') + (onPad() ? ' on the keyboard' : '') + ' opens the city map',
    fb: () => 'Something wrong or missing? Press ' + key('KeyB', 'B') + (onPad() ? ' on the keyboard' : '') + ' to tell us',
  };
  const MAX = { car: 2, heli: 2, subway: 2, menu: 2, map: 2, fb: 1 }, ORDER = (game.P && game.P.get && game.P.get('hints') === 'all') ? ['car', 'heli', 'subway', 'menu', 'map', 'fb'] : ['subway', 'map'];      /* lead, Nov 16 (CHIEF): only the subway and map lines are on (running is runhint.js's); ?hints=all = all six */

  // ---- what the game shows us
  const mapUp = () => { try { const g = game; return !!(g.gps && g.gps.mapOpen ? g.gps.mapOpen() : g.hud && g.hud.cmap && g.hud.cmap.full); } catch (e) { return false; } };
  const formUp = () => { try { const b = document.getElementById('fbbox'); return !!(b && b.style.display === 'block'); } catch (e) { return false; } };
  const runUp = () => { try { const r = document.getElementById('runhint'); return !!(r && +r.style.opacity === 1); } catch (e) { return false; } };
  const padLive = () => { try { for (const q of navigator.getGamepads ? navigator.getGamepads() : []) { if (!q || !q.connected) continue; let a = false; for (let i = 0; i < q.axes.length && i < 4; i++) if (Math.abs(q.axes[i] || 0) > 0.3) a = true;
        for (let i = 0; !a && i < q.buttons.length; i++) if (q.buttons[i] && q.buttons[i].pressed) a = true;
        if (a) { padPS = !/xbox|xinput|045e/i.test(q.id || '') && /dualsense|dualshock|playstation|sony|054c|wireless controller/i.test(q.id || ''); return true; } } } catch (e) {} return false; };
  const nearStair = (pl) => { const sub = game.subway, E = sub && sub.entrances; if (!E) return false; for (let i = 0; i < E.length; i++) { const e = E[i]; if (!e.open || e.off) continue; const dx = e.x - pl.x, dy = e.y - pl.y; if (dx * dx + dy * dy < 16) return true; } return false; };
  const nearHeli = (pl) => { const h = game.heli, f = h && h.f; if (!f || !f.onGround || f.damage >= 1 || h.busy) return false; const x = h.mapX, y = h.mapY; if (typeof x !== 'number' || typeof y !== 'number' || Math.abs((pl.alt || 0) - (f.surface || 0)) > 6) return false; const dx = x - pl.x, dy = y - pl.y; return dx * dx + dy * dy < 225; };

  // ---- the chip (runhint's place and look: they are never up together)
  const show = (id) => { try {
      if (!el) { el = document.createElement('div'); el.id = 'hintchip'; el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 16px "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.04em;color:#fff;background:rgba(12,13,15,.78);border-left:4px solid #ffb82e;padding:9px 18px;border-radius:8px;opacity:0;transition:opacity .4s;max-width:92vw;text-align:center'; document.body.appendChild(el); }
      el.textContent = TEXT[id](); el.style.opacity = 1; cur = id; hideAt = played + SHOW; shown[id] = (shown[id] || 0) + 1; last[id] = played; save(); } catch (e) {} };
  const hide = () => { if (el) el.style.opacity = 0; if (cur) freeAt = played + GAP; cur = null; hideAt = 0; };
  const finish = (id) => { if (done[id]) return; done[id] = 1; if (cur === id) hide(); save(); };
  const open = (id) => !done[id] && (shown[id] || 0) < MAX[id];
  const due = (id) => open(id) && (last[id] === undefined || played - last[id] >= AGAIN);

  // keys that do the thing (the timer also sees the state; this catches a quick tap between two ticks) and "the keyboard was the last input"
  const typing = (e) => { const t = e.target; return !!(t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')); };
  const onKey = (e) => { keyT = now(); if (window.__startScreen || typing(e) || e.repeat) return; if (e.code === 'Tab') finish('map'); else if (e.code === 'KeyB') finish('fb'); else if (e.code === 'KeyP') finish('menu'); };
  const onMouse = () => { keyT = now(); };
  addEventListener('keydown', onKey); addEventListener('mousedown', onMouse);

  const tick = () => {
    const pl = game.player; if (!pl || window.__startScreen || document.hidden) return;
    const heli = game.heli, sub = game.subway, flying = !!(heli && heli.piloted), below = !!(sub && sub.own), paused = !!game.paused, map = mapUp(), form = formUp();
    // done by himself: cancelled for good
    if (pl.vehicle) finish('car'); if (flying) finish('heli'); if (below) finish('subway'); if (paused) finish('menu'); if (map) finish('map'); if (form) finish('fb');
    if (!ORDER.some(open)) { if (!cur) { clearInterval(iv); removeEventListener('keydown', onKey); removeEventListener('mousedown', onMouse); if (el) { const q = el; el = null; setTimeout(() => { try { q.remove(); } catch (e) {} }, 600); } return; } }
    if (padLive()) padT = now();
    // nothing of ours over a pause, the map, the form, the fly camera, the subway's own chip, a job banner or a GPS note
    if (paused || form) { if (cur) hide(); return; }
    played += TICK;
    if (map || below || (game.fly && game.fly.on) || (game.missions && game.missions.banner) || (game.gps && game.gps.note)) { if (cur) hide(); return; }
    const foot = !pl.vehicle && !pl.busy && !flying && !(heli && heli.busy), sp = pl.speed || 0;
    if (foot) footT += TICK;
    // runhint has the place: while its chip is up, and just before it comes (it shows at 8 s walked, and once more 25 s of walking later)
    const rh = game.runhint; let rhSoon = false;
    if (rh && !rh.over && foot && sp > 0.5) { if (rh.shown >= 1 && rhFirst < 0) rhFirst = rh.walked; const at = rh.shown === 0 ? 8 : rh.shown === 1 ? rhFirst + 25 : 1e9; rhSoon = rh.walked >= at - (cur ? 0.8 : SHOW + 1); }
    if (runUp()) { if (cur) hide(); freeAt = played + GAP; return; }
    if (cur) { if (played >= hideAt || rhSoon) hide(); return; }
    // how long each need has been seen (the near tests run only for a hint that could still show)
    nearT.car = foot && sp < 2.2 && footT >= 12 && open('car') && game.nearestCar && game.nearestCar(6) ? nearT.car + TICK : 0;
    nearT.heli = foot && open('heli') && nearHeli(pl) ? nearT.heli + TICK : 0;
    nearT.subway = foot && sp < 1 && open('subway') && nearStair(pl) ? nearT.subway + TICK : 0;
    if (played < freeAt || rhSoon || played < 10) return;
    const need = { car: nearT.car >= 1, heli: nearT.heli >= 1, subway: nearT.subway >= 3, menu: played >= 45, map: played >= 90, fb: played >= 240 };
    let pick = null; for (const id of ORDER) if (need[id] && due(id) && (!pick || (shown[id] || 0) < (shown[pick] || 0))) pick = id;     // one not yet said before the second time of another
    if (pick) show(pick);
  };
  iv = setInterval(() => { const t0 = now(); try { tick(); } catch (e) {} const d = now() - t0; cost.n++; cost.ms += d; if (d > cost.max) cost.max = d; }, TICK * 1000);
  game.hints = { shown, done, cost, get current() { return cur; }, get played() { return played; }, get pad() { return onPad(); } };
}
