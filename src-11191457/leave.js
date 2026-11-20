// leave.js (lead map-switch, Nov 19): when the page is left (a map picked on the start screen, a reload, a link), what the old page holds is given back AT ONCE.
// MEASURED (lanes/lead/map-switch/README.md; MacBook M2 Max, 64 GB, no swap in use): after a map is picked the browser PARKS the old page whole (its back/forward
// cache) in the same process, so the next map loads with the old map's heap still held: Midtown after Uptown was ready in 115-131 s and ran at 2.2-2.6 fps (20 s and
// 42 fps on its own), a quarter to half of its time in the garbage collector. Our test server never showed it: it sends no-store, and a no-store page is not parked.
// WHAT THIS DOES on `pagehide`: the frame loop is stopped (the game is paused), the WebGL context is given up (WEBGL_lose_context: every buffer,
// texture and program of the page goes with it in one step) and the canvas shrunk to one pixel, the texture transcoder's workers are ended, sound is closed, and the page's own handles on the game and
// the world are dropped. A page the browser parks whole in its back/forward cache keeps its whole heap; the next page of ours throws it out with one message (below);
// should it be parked anyway and shown again (Back), it reloads itself, since its graphics are gone.
// The context given up here is not a fault: the 'lost context' event is kept from the telemetry module while leaving.
//   ?leave=0  off (this file is not fetched)      the next page reads what was done from sessionStorage into window.__mapswitch (tests)
export function installLeave(renderer, canvas, P) {
  const S = (window.__leave = { on: true, done: false });
  try { const j = sessionStorage.getItem('crosstown.leave'); if (j) { sessionStorage.removeItem('crosstown.leave'); window.__mapswitch = JSON.parse(j); } } catch (e) {}
  try { canvas.addEventListener('webglcontextlost', (e) => { if (S.done) e.stopImmediatePropagation(); }, true); } catch (e) {}
  const go = (why) => { if (S.done) return; S.done = true; window.__leaving = true; const t0 = performance.now(), o = { why, lost: null, ms: 0 };
    try { o.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; o.tex = renderer.info.memory.textures; o.geo = renderer.info.memory.geometries; } catch (e) {}
    try { const g = window.game; if (g) { g.paused = true; try { const ac = g.sound && (g.sound.ac || g.sound.ctx); if (ac && ac.close) ac.close().catch(() => {}); } catch (e) {} } } catch (e) {}
    try { const gl = renderer.getContext(); try { renderer.renderLists.dispose(); renderer.dispose(); } catch (e) {} const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); o.lost = gl.isContextLost(); } catch (e) { o.err = String(e && e.message).slice(0, 80); }
    try { canvas.width = canvas.height = 1; } catch (e) {}
    try { if (window.__ktx2 && window.__ktx2.dispose) window.__ktx2.dispose(); } catch (e) {}
    try { window.game = null; window.world = null; } catch (e) {}
    o.ms = Math.round(performance.now() - t0); try { sessionStorage.setItem('crosstown.leave', JSON.stringify(o)); } catch (e) {} };
  /* An older page of ours that the browser has parked is thrown out when a message reaches it: every page listens on one channel and says one word on it when it starts.
     (Tried first and measured NOT to work in today's Chrome: a no-op `unload` listener, and a held Web Lock: the page was parked all the same, r2.)
     ?leavehow=bc | hide | none = only the message, only the give-back on leaving, neither (tests) */
  const how = P.get('leavehow') || 'both'; S.how = how; S.heard = 0;
  if (how === 'both' || how === 'hide') addEventListener('pagehide', (e) => go(e.persisted ? 'pagehide, parked' : 'pagehide'));
  if ((how === 'both' || how === 'bc') && typeof BroadcastChannel === 'function') { try { const bc = (S.bc = new BroadcastChannel('crosstown-page')); bc.onmessage = () => { S.heard++; }; bc.postMessage('here'); } catch (e) {} }
  addEventListener('pageshow', (e) => { if (e.persisted && S.done) location.reload(); });     /* shown again after all (Back): its graphics are gone, so it loads afresh */
  S.go = go; return S;
}
