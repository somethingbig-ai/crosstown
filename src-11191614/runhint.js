// runhint.js (progress lane, Nov 15; CHIEF 15:17). Three players wrote "running does not work": they walked for many minutes and never pressed
// Shift, although the start and pause screens list it (feedback 095332-41f9a2: 22 minutes on the arrow keys). So the game says it IN PLAY, once
// it has seen the need: a player who has walked 8 s in all without ever running gets one short line, "Hold LEFT SHIFT to run" (the key he has
// bound; with a controller in use: "Press the left stick to run"). It shows 6 s, comes back once after another 25 s of walking, and never
// again once he has run (kept in the settings as 'hint.run' when the menu is there; otherwise for the page load). Nothing per frame: one
// timer four times a second, no allocation; ?runhint=0 leaves the file unfetched.
export function install(game) {
  const S = game.settings, done0 = (() => { try { return !!(S && S.get('hint.run', false)); } catch (e) { return false; } })();
  if (done0 || game.demo || game.capture) return;
  let walked = 0, shown = 0, nextAt = 8, hideAt = 0, el = null, over = false, padT = -1e9;
  const pad = () => { try { for (const q of navigator.getGamepads ? navigator.getGamepads() : []) if (q && q.connected && (Math.abs(q.axes[0] || 0) > 0.3 || Math.abs(q.axes[1] || 0) > 0.3)) return true; } catch (e) {} return false; };
  const text = () => { if (performance.now() - padT < 4000) return 'Press the left stick to run';
    let k = 'LEFT SHIFT'; try { const n = game.menu && game.menu.keys && game.menu.keys.keyName && game.menu.keys.keyName('ShiftLeft'); if (n) k = String(n).toUpperCase(); } catch (e) {} return 'Hold ' + k + ' to run'; };
  const show = () => { try { if (!el) { el = document.createElement('div'); el.id = 'runhint'; el.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 16px "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.04em;color:#fff;background:rgba(12,13,15,.78);border-left:4px solid #ffb82e;padding:9px 18px;border-radius:8px;opacity:0;transition:opacity .4s'; document.body.appendChild(el); }
      el.textContent = text(); el.style.opacity = 1; shown++; hideAt = walked + 6; nextAt = walked + 25; } catch (e) {} };
  const hide = () => { if (el) el.style.opacity = 0; hideAt = 0; };
  const finish = () => { over = true; hide(); clearInterval(iv); try { if (S) S.set('hint.run', true); } catch (e) {} setTimeout(() => { try { if (el) el.remove(); } catch (e) {} }, 600); };
  const iv = setInterval(() => {
    if (over) return; const pl = game.player; if (!pl || game.paused || window.__startScreen || document.hidden) return;
    const foot = !pl.vehicle && !pl.busy && !(game.heli && (game.heli.piloted || game.heli.busy)) && !(game.fly && game.fly.on), sp = pl.speed || 0;
    if (!foot) { if (hideAt) hide(); return; }
    if (sp > 3) { finish(); return; }                                   // he ran: he knows
    if (sp > 0.5) { walked += 0.25; if (pad()) padT = performance.now(); }
    if (hideAt && walked >= hideAt) hide();
    if (!hideAt && shown < 2 && walked >= nextAt) show();
    if (shown >= 2 && !hideAt) { over = true; clearInterval(iv); }     // said twice: enough (not stored: he gets it again next visit)
  }, 250);
  game.runhint = { get shown() { return shown; }, get walked() { return walked; }, get over() { return over; } };
}
