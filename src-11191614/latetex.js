// latetex.js (perf lane, Nov 18): LATE TEXTURES. Eight big relief (normal) maps were 17.5 MB of the first download: the five walls (4.6 MB), the dressing's five
// (fire escapes, awnings, sills: 3.0 MB) and the world's own road and pavement relief (9.9 MB, which the street layer replaces everywhere it is built, so at the
// start it is drawn nowhere near the player). Each now has a LOW file in assets/texlo/ (lanes/perf/spawnfirst/latetex/mktexlo.py): the same compressed blocks of its
// levels 2.. (a quarter of the width and height), 1.0 MB for all eight. The first load takes the low files; right after ready the full files come down one at a
// time (the walls first, then the dressing, then the ground) and each is put into the SAME texture object, so every material that holds it follows. Until a full
// file lands its surface is exact from the distance where the card reads level 2 or lower, and softer nearer than that.
//   ?latetex=0     as before: this file and assets/texlo/ are never fetched (ktx2hook.js asks for neither).
//   ?latetex=hold  tests: the full files wait for window.__lateGo.
//   Off as well under ?shot and ?capture (fixed stills must not change a few seconds in), with ?ktx=0, and when assets/texlo/texlo.json is missing.
// window.__latetex: { files, queue, done: [[file, asked s, in s]], failed }.
import * as THREE from 'three';
const Q = new URLSearchParams(location.search), q = Q.get('latetex'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LT = { on: q !== '0' && !Q.has('shot') && !Q.has('capture') && Q.get('ktx') !== '0', hold: q === 'hold', files: {}, queue: [], done: [], failed: [], k: null, running: false,
  // the low file's address for a full one, or null
  lo(full) { const f = this.files[full]; return f ? 'assets/texlo/' + f.lo : null; },
  // t holds the low file's levels now: the full file is put into it after ready. memfree.js must not empty it and lock it before then (userData.keepData)
  later(t, full) { if (!t.userData) t.userData = {}; t.userData.keepData = true; this.queue.push({ t, full, pri: (this.files[full] || {}).pri || 0 }); if (!this.running) run(); } };
export async function installLateTex(k) {
  if (!LT.on) return null;
  const r = await fetch('assets/texlo/texlo.json'); if (!r.ok) return null;
  LT.files = (await r.json()).files || {}; LT.k = k; window.__latetex = LT; return LT;
}
function swap(t, c) {
  // where memfree's lean mode is on (Safari, ?lean) a block-compressed picture of 1024 px and more goes up without its largest level: the same here
  const MF = window.__memfree; if (MF && MF.leanOn && !t.isCompressedArrayTexture && c.mipmaps.length > 2 && Math.max(c.mipmaps[0].width, c.mipmaps[0].height) >= (MF.leanMin || 1024)) { c.mipmaps.shift(); c.image.width = c.mipmaps[0].width; c.image.height = c.mipmaps[0].height; }
  t.dispose();     // the card's copy of the low file goes; the next frame that draws it makes the full one
  t.mipmaps = c.mipmaps; t.image = c.image; t.format = c.format; t.type = c.type; t.minFilter = c.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.generateMipmaps = false;
  if (t.userData) delete t.userData.keepData; t.needsUpdate = true;
}
async function run() {
  LT.running = true;
  // lateq (src/lateq.js): with the shared queue the full files are one lane (the queue waits for ready; the file is chosen when the turn comes): the walls and the dressing as 'walls',
  // the world's own road relief as 'later' at 343 m (it is drawn only that far away, where the low file is already exact). ?lateq=0 = the lines below, as before.
  const Q = window.__lateq;
  if (Q) { const head = () => { LT.queue.sort((a, b) => a.pri - b.pri); return LT.queue[0]; };
    Q.lane({ kind: () => (head().pri >= 2 ? 'later' : 'walls'), d: () => (head().pri >= 2 ? 343 : head().pri), name: () => head().full, par: 2, gate: () => !LT.hold || !!window.__lateGo, more: () => LT.queue.length > 0 }, async (free) => {
      const e = head(); LT.queue.shift(); free.as(e.full); const t1 = performance.now(); let c = null;
      for (let n = 0; n < 3 && !c; n++) { try { c = await Q.ktx(LT.k, e.full, free); } catch (err) { free(); console.log('[latetex] ' + e.full + ' not loaded (try ' + (n + 1) + ' of 3): ' + (err && err.message)); await sleep(4000); } }
      free(); if (!c) { LT.failed.push(e.full); return; }
      try { swap(e.t, c); } catch (err) { LT.failed.push(e.full); console.log('[latetex] ' + e.full + ' not put in: ' + (err && err.message)); return; }
      LT.done.push([e.full, +(t1 / 1000).toFixed(2), +(performance.now() / 1000).toFixed(2)]);
      console.log('[latetex] ' + e.full + ' in at ' + (performance.now() / 1000).toFixed(1) + ' s (asked ' + (t1 / 1000).toFixed(1) + ' s)'); });
    return; }     /* LT.running stays true: the lane lives on */
  while (!(window.__ready && !(LT.hold && !window.__lateGo))) await sleep(50);
  for (;;) {
    LT.queue.sort((a, b) => a.pri - b.pri); const e = LT.queue.shift(); if (!e) break;
    const t1 = performance.now(); let c = null;
    for (let n = 0; n < 3 && !c; n++) { try { c = await LT.k.loadAsync(e.full); } catch (err) { console.log('[latetex] ' + e.full + ' not loaded (try ' + (n + 1) + ' of 3): ' + (err && err.message)); await sleep(4000); } }
    if (!c) { LT.failed.push(e.full); continue; }     // the low file stays (it keeps its data: a lost context can still restore it)
    try { swap(e.t, c); } catch (err) { LT.failed.push(e.full); console.log('[latetex] ' + e.full + ' not put in: ' + (err && err.message)); continue; }
    LT.done.push([e.full, +(t1 / 1000).toFixed(2), +(performance.now() / 1000).toFixed(2)]);
    console.log('[latetex] ' + e.full + ' in at ' + (performance.now() / 1000).toFixed(1) + ' s (asked ' + (t1 / 1000).toFixed(1) + ' s)');
  }
  LT.running = false;
}
