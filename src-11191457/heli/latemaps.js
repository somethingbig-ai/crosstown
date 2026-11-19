// latemaps.js (perf lane, Nov 18): THE HELICOPTER'S SKIN PICTURES COME AFTER READY. normal.png (4096 px, 3.58 MB), orm.jpg (4096, 2.91) and tint.jpg (2048, 0.93)
// were 7.4 MB of the first download for a helicopter parked 60-110 m from the start. model.js now loads assets/heli/model/lo/<name> first (the mean of every 8 x 8
// block of the full picture: what the card's own mip level 3 holds; 0.33 MB for the three, lanes/perf/spawnfirst/lateheli/mkhelilo.sh) and hands the textures here.
// Right after ready the full pictures come down one at a time and each is put into the SAME texture object, so every material of all three levels of detail follows.
//   ?lateheli=0     as before: this file and lo/ are never fetched.
//   ?lateheli=hold  tests: the full pictures wait for window.__lateGo.
//   Off as well under ?shot and ?capture (model.js). A lo/ picture that is missing: that picture is loaded whole with the load, as before.
// window.__lateheli: { done: [[name, asked s, in s, upload ms]], failed: [], left }.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// list: [[texture, url of the full picture, name]] in the order to fetch; renderer may be null (then the first frame that draws the helicopter uploads)
export async function lateMaps(list, renderer, hold) {
  const LH = (window.__lateheli = window.__lateheli || { done: [], failed: [], left: 0 }); LH.left += list.length;
  const Q = window.__lateq;     /* lateq: the queue waits for ready itself; ?lateq=0 = as before */
  if (!Q) await new Promise((res) => { let d = false; const ok = () => { if (d || !window.__ready || (hold && !window.__lateGo)) return; d = true; clearInterval(iv); res(); }, iv = setInterval(ok, 50); addEventListener('nyc-ready', ok, { once: true }); ok(); });
  // lateq (src/lateq.js): one() = the old loop's body. With the shared queue the pictures are one lane ('heli'); the line is free again once a picture's bytes are in.
  const one = async ([t, url, name], free) => {
    const t1 = performance.now(); let im = null;
    for (let n = 0; n < 3 && !im; n++) {
      try {
        // the same two ways model.js loadTex reads a picture: decoded off the main thread, or (no createImageBitmap, ?helitex=img) as an <img>
        if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) { const r = await fetch(url); if (!r.ok) throw new Error(name + ' ' + r.status); const b = await r.blob(); if (free) free();     /* lateq: the bytes are in */ im = await createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
        else if (free) im = await Q.img(url, free); else { const e = new Image(); e.src = url; await e.decode(); im = e; }
      } catch (err) { im = null; console.log('[heli] late maps: ' + name + ' not loaded (try ' + (n + 1) + ' of 3): ' + (err && err.message)); await sleep(4000); }
    }
    LH.left--; if (free) free();     /* lateq: given up (the bytes of one that came were handed over above) */
    if (!im) { LH.failed.push(name); return; }      // the small picture stays (it keeps its data, so a lost context can still restore it)
    let up = 0;
    try {
      t.dispose();      // the card's copy of the small picture goes
      t.image = im; if (t.userData) delete t.userData.keepData; t.needsUpdate = true;
      // to the card now, in a task of its own, not inside the frame that next draws the helicopter (as model.js does for the first upload; ?heliup=0 off)
      if (renderer && renderer.initTexture && !/[?&]heliup=0/.test(location.search)) { await sleep(40); const t2 = performance.now(); try { renderer.initTexture(t); } catch (e) {} up = Math.round(performance.now() - t2); }
    } catch (err) { LH.failed.push(name); console.log('[heli] late maps: ' + name + ' not put in: ' + (err && err.message)); return; }
    LH.done.push([name, +(t1 / 1000).toFixed(2), +(performance.now() / 1000).toFixed(2), up]);
    console.log('[heli] late maps: ' + name + ' in at ' + (performance.now() / 1000).toFixed(1) + ' s (asked ' + (t1 / 1000).toFixed(1) + ' s, upload ' + up + ' ms)');
  };
  if (Q) { let i = 0; Q.lane({ kind: 'heli', d: 0, name: () => 'heli/model/' + list[i][2], gate: () => !hold || !!window.__lateGo, more: () => i < list.length }, (free) => one(list[i++], free)); return; }
  for (const it of list) await one(it);
}
