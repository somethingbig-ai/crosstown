// lateground.js (perf lane, Nov 18): GROUND PICTURES AFTER READY. Of the street layer's pictures 5.1 MB need not be in the first download:
//   asph_col.jpg (2048 px, 1.80 MB) and asph_nrm.jpg (1024 px, 0.77 MB), the road's stone: lo/asph_col.jpg (512 px) and lo/asph_nrm.jpg (256 px) are loaded first
//     (the mean of every 4 x 4 block: the card's own mip level 2; 0.15 MB, lanes/perf/spawnfirst/lateground/mkgroundlo.sh), the full ones right after ready.
//   the photographed crossings of photo/photos.json (three photos, their paint atlas, asph_hist.webp: 2.53 MB; the nearest is 151 m from the start): NOTHING first.
//     Each photo is a see-through layer over the ordinary road; its texture starts as one clear pixel, so the layer's shader throws every pixel away
//     (FS_PHOTO: a < 0.004 -> discard) and the road under it shows. The mesh is there and its program is compiled with the rest, as before.
//     The photo's own pictures go in LAST and only when the pictures it is drawn with (asph_hist, the paint atlas) are in, so a photo never shows half made.
// Every full picture is put into the SAME texture object (world.__groundTex holds one copy for every map area), one at a time, the road's stone first.
//   ?lateground=0     as before: this file and lo/ are never fetched (ground.js).
//   ?lateground=hold  tests: the full pictures wait for window.__lateGo.
//   Off as well under ?shot and ?capture. A lo/ picture that is missing: that picture is loaded whole with the load, as before.
// window.__lateground: { done: [[file, asked s, in s, upload ms]], failed: [], left }.
import * as THREE from 'three';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SMALL = { 'asph_col.jpg': 'lo/asph_col.jpg', 'asph_nrm.jpg': 'lo/asph_nrm.jpg' };
export function lateGround(game, base) {
  const P = game.P, hold = !!P && P.get('lateground') === 'hold', renderer = game.world && game.world.renderer;
  const LG = (window.__lateground = { done: [], failed: [], left: 0 }), queue = []; let running = false;
  const later = (t, f, pri, kind) => { queue.push({ t, f, pri, kind }); LG.left++; if (!running) run(); };
  const image = async (f, free) => { if (free) return window.__lateq.img(base + f, free);     /* lateq: the line is given back when the bytes are in, before the decode */ const im = new Image(); im.src = base + f; await im.decode(); return im; };
  // a grey picture as one channel, as ground.js lum() makes it, read in strips of 256 rows with a turn between (no frame pays for 16 M pixels at once)
  const grey = async (f, free) => { const im = await image(f, free), W = im.width, H = im.height, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    let r = new Uint8Array(W * H), w = W, h = H; for (let y = 0; y < H; y += 256) { const n = Math.min(256, H - y), px = g.getImageData(0, y, W, n).data, o = y * W; for (let i = 0, e = W * n; i < e; i++) r[o + i] = px[i * 4]; await sleep(0); }
    c.width = c.height = 0;
    // memfree's lean mode (Safari, ?lean) halves a data picture of 1024 px and more at its FIRST upload only (memfree.js leanTex: version 0): the same mean of four here, as this one arrives later
    const MF = window.__memfree; if (MF && MF.leanOn && Math.max(W, H) >= (MF.leanMin || 1024) && !(W & 1) && !(H & 1)) { w = W >> 1; h = H >> 1; const o = new Uint8Array(w * h); for (let y = 0, q = 0; y < h; y++) { let p = y * 2 * W; for (let x = 0; x < w; x++, p += 2) o[q++] = (r[p] + r[p + 1] + r[p + W] + r[p + W + 1] + 2) >> 2; } r = o; }
    return { data: r, width: w, height: h }; };
  async function run() {
    running = true; const Q = window.__lateq;
    // from the task that sets ready where main.js sends 'nyc-ready' (late-asph's line), else at a timer's next turn
    if (!Q) await new Promise((res) => { let d = false; const ok = () => { if (d || !window.__ready || (hold && !window.__lateGo)) return; d = true; clearInterval(iv); res(); }, iv = setInterval(ok, 50); addEventListener('nyc-ready', ok, { once: true }); ok(); });
    // lateq (src/lateq.js): take() = the old loop's body. With the shared queue the pictures are one lane (the stone as 'road', the photo layers as 'near' at 150 m; the picture is
    // chosen when the turn comes, and the queue waits for ready). ?lateq=0 = one after another on its own, as before.
    const bad = new Set(), head = () => { queue.sort((a, b) => a.pri - b.pri); return queue[0]; };
    const take = async (e, free) => {
      const t1 = performance.now(); let im = null;
      // a photo whose paint atlas or stain picture did not arrive stays clear: the ordinary road shows there
      if (e.kind === 'photo' && bad.size) { LG.left--; LG.failed.push(e.f + ' (left clear: ' + [...bad].join(', ') + ' missing)'); return; }
      for (let n = 0; n < 3 && !im; n++) { try { im = e.kind === 'grey' ? await grey(e.f, free) : await image(e.f, free); } catch (err) { im = null; console.log('[ground] late: ' + e.f + ' not loaded (try ' + (n + 1) + ' of 3): ' + (err && err.message)); await sleep(4000); } }
      LG.left--;
      if (!im) { LG.failed.push(e.f); if (e.kind !== 'small') bad.add(e.f); return; }
      if (free) free();     /* lateq: (the line was given back when the bytes came in: Q.img inside image()) */
      let up = 0;
      try { e.t.dispose(); e.t.image = im; e.t.needsUpdate = true;
        if (renderer && renderer.initTexture) { await sleep(40); const t2 = performance.now(); try { renderer.initTexture(e.t); } catch (x) {} up = Math.round(performance.now() - t2); }     // to the card in a task of its own, not inside a drawn frame
      } catch (err) { LG.failed.push(e.f); if (e.kind !== 'small') bad.add(e.f); console.log('[ground] late: ' + e.f + ' not put in: ' + (err && err.message)); return; }
      LG.done.push([e.f, +(t1 / 1000).toFixed(2), +(performance.now() / 1000).toFixed(2), up]);
      console.log('[ground] late: ' + e.f + ' in at ' + (performance.now() / 1000).toFixed(1) + ' s (asked ' + (t1 / 1000).toFixed(1) + ' s, upload ' + up + ' ms)');
    };
    if (Q) { Q.lane({ kind: () => (head().pri ? 'near' : 'road'), d: () => (head().pri ? 150 + head().pri : 0), name: () => 'streets/ground/' + head().f, gate: () => !hold || !!window.__lateGo, more: () => queue.length > 0 }, (free) => { const e = head(); queue.shift(); return take(e, free); }); return; }     /* running stays true: the lane lives on */
    for (;;) { const e = head(); if (!e) break; queue.shift(); await take(e); }
    running = false;
  }
  return {
    // which of ground.js's load() files this module takes
    has: (f) => !!SMALL[f] || f.startsWith('photo/'),
    // loadNow = ground.js's own loader (same flags, same settings on the texture)
    load(f, srgb, rep, loadNow) {
      if (SMALL[f]) return loadNow(SMALL[f], srgb, rep).then((t) => { later(t, f, 0, 'small'); return t; }, () => loadNow(f, srgb, rep));
      // a photo or its paint atlas: one clear pixel now, with the settings load() gives a picture
      const c = document.createElement('canvas'); c.width = c.height = 1; const t = new THREE.Texture(c);
      t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.anisotropy = srgb ? 16 : 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
      later(t, f, srgb ? 3 : 2, srgb ? 'photo' : 'atlas'); return Promise.resolve(t);     /* ground.js loads the photos as colour (srgb) and the paint atlas as data */
    },
    // asph_hist.webp (read only by the photo layers): one mid-grey pixel now, with the settings lum() gives its picture
    lum(f) {
      const t = new THREE.DataTexture(new Uint8Array([105]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
      later(t, f, 1, 'grey'); return Promise.resolve(t);
    },
  };
}
