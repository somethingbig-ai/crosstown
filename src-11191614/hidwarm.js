// hidwarm.js (perf lane, Nov 15): PLAY lights in a background tab. ?hidwarm=0 = off (this file is never fetched).
// The last loading step ("getting the graphics card ready") counts DRAWN frames, and a hidden tab is given none: requestAnimationFrame simply
// never calls back there, so a player who opened the game and looked at another tab came back to a page still at 99% (progress lane, 17:02 Nov 15).
// While the page is hidden AND still loading, the frames that are waiting are run from here instead, about 30 a second at most: the same callbacks
// with the same kind of time stamp, so the game draws behind the start screen as it does in a tab that is looked at, and main.js lights PLAY
// (its rule asks for short frames; a hidden tab's frames are slow, so while hidden it asks for three quiet seconds instead: see main.js).
// The beat comes from a worker, because a hidden page's own timers are held to one a second; if no worker can be made, the page's timer is used
// and each of its slow beats runs a short burst of frames. A visible tab is not touched: every frame there still comes from the browser.
// It all ends for good when the load does (PLAY lit, or a tool page ready): the browser's own two functions are put back and the worker is closed.
// What it cannot do: the browser gives a hidden tab far less processor time (laptop 2: 139 s to the last step hidden, about 15 s looked at).
(() => {
  if (window.__hidwarm) return;
  const raf0 = window.requestAnimationFrame, caf0 = window.cancelAnimationFrame, now = () => performance.now();
  const pend = new Map(), S = (window.__hidwarm = { frames: 0, bursts: 0, ms: 0, worker: false, over: false }); let seq = 1e9, worker = null, timer = null, last = 0, busy = false;
  const myRaf = (cb) => { const id = ++seq, rid = raf0.call(window, (ts) => { if (pend.delete(id)) cb(ts); }); pend.set(id, { cb, rid }); return id; };
  const myCaf = (id) => { const e = pend.get(id); if (e) { pend.delete(id); caf0.call(window, e.rid); } else caf0.call(window, id); };
  window.requestAnimationFrame = myRaf; window.cancelAnimationFrame = myCaf;
  const loading = () => !(window.__ready && !window.__warming) && !window.__error;
  // one frame: everything waiting is called once with one time stamp (what the browser does); what those calls ask for waits for the next frame
  const frame = () => { const list = [...pend.values()]; pend.clear(); const ts = now(); for (const e of list) { caf0.call(window, e.rid); try { e.cb(ts); } catch (err) { console.error(err); } } S.frames++; };
  const stop = () => { if (S.over) return; S.over = true; if (window.requestAnimationFrame === myRaf) window.requestAnimationFrame = raf0; if (window.cancelAnimationFrame === myCaf) window.cancelAnimationFrame = caf0;
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; } if (timer) { clearInterval(timer); timer = null; } document.removeEventListener('visibilitychange', wake);
    if (S.frames) console.log('[game] hidden tab: ' + S.frames + ' frames run while the tab was not looked at (' + Math.round(S.ms) + ' ms)'); };
  const beat = () => { if (S.over || busy) return; if (!loading()) { stop(); return; } if (!document.hidden || !pend.size) { last = 0; return; }
    busy = true; const t0 = now(), slow = last && t0 - last > 500;     /* beats far apart = the page's own held timer: a burst, so the frames inside it are short ones */
    try { if (slow) { S.bursts++; for (let i = 0; i < 24 && now() - t0 < 400 && pend.size && loading(); i++) frame(); } else frame(); } finally { busy = false; last = now(); S.ms += last - t0; }
    if (!loading()) stop(); };
  const wake = () => { last = 0; if (worker) try { worker.postMessage(document.hidden ? 1 : 0); } catch (e) {} };
  try { if (/[?&]hidwarm=timer\b/.test(location.search)) throw 0;     /* test switch: the fall-back beat alone */
    worker = new Worker(URL.createObjectURL(new Blob(['let t=0;onmessage=(e)=>{clearInterval(t);t=0;if(e.data)t=setInterval(()=>postMessage(0),33);};'], { type: 'text/javascript' })));
    worker.onmessage = beat; worker.onerror = () => { try { worker.terminate(); } catch (e) {} worker = null; S.worker = false; }; S.worker = true; } catch (e) { worker = null; }
  timer = setInterval(() => { if (!worker || (document.hidden && now() - last > 900)) beat(); else if (!loading()) stop(); }, 250);     /* the fall-back beat, and the check that ends it all in a visible tab */
  document.addEventListener('visibilitychange', wake); wake();
})();
