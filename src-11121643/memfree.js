// memfree.js (audit lane, Nov 11): gives back what the page keeps after the graphics card has its copy.
// Real Safari held 5.3 GB in the page's process on the public build: every vertex array and every texture's data stays in JS after upload,
// because three.js keeps them in case they are changed or uploaded again. This game never does that for static things, so after a thing has been
// uploaded and drawn for a few seconds its JS copy is swapped for an empty array.
//   KEPT: skinned meshes (gun hits ray-test them), anything not StaticDrawUsage, per-instance arrays (matrices, colours), anything whose
//         version changed after its upload, small arrays, and anything marked: mesh.userData.keepArrays = true or geometry.userData.keepArrays = true
//         (texture.userData.keepData = true for a texture).
//   A freed array or texture ignores a later needsUpdate (counted in stats.blocked, first few named in the console) instead of uploading nothing.
//   ?memfree=0 switches all of it off. ?memfree=trap logs the first reads of a freed array with a stack (for finding code that still reads).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const Q = new URLSearchParams(location.search).get('memfree');
const MF = (window.__memfree = { on: Q !== '0', trap: Q === 'trap', stats: { attrs: 0, attrMB: 0, tex: 0, texMB: 0, bitmaps: 0, bitmapMB: 0, sweeps: 0, blocked: 0, kept: 0, reads: 0 }, up: [], log: [] });
MF.byRoot = {};
// top-level scene objects whose meshes are read again by game code (car doors are cut from the car meshes on first use, the helicopter and the
// player build parts late): everything under them keeps its arrays. Add a name here, or set userData.keepArrays on the object.
MF.keepRoots = /vehicle|heli|player|crowd|people|ped|combat|entry|gun|prop|break|rag|furniture/i;
const MIN = 4096, AGE = 4000, note = (s) => { if (MF.log.length < 40) { MF.log.push(s); console.log('[memfree] ' + s); } };
if (MF.on) {
  // every buffer the renderer uploads reports here (three calls this after bufferData); code that set its own onUpload keeps its own
  const mark = function () { if (this.__mfT !== undefined || this.usage !== THREE.StaticDrawUsage || this.isInstancedBufferAttribute || this.isInstancedInterleavedBuffer) return; this.__mfT = performance.now(); this.__mfV = this.version; MF.up.push(this); };
  THREE.BufferAttribute.prototype.onUploadCallback = mark; THREE.InterleavedBuffer.prototype.onUploadCallback = mark;
}
// A parsed model keeps its parser, and the parser keeps the file's whole binary part plus a second copy cut into buffer views (the vertex arrays
// are windows onto those). Wherever game code holds on to the loader's result (the kit, the street scans, closures) that pins the file's bytes
// for good, even after the arrays above are swapped out. Nothing in the game asks a parser for anything after load, so its stores are emptied
// as soon as the caller has its result.
if (MF.on) { const parse0 = GLTFLoader.prototype.parse; GLTFLoader.prototype.parse = function (data, path, onLoad, onError) { return parse0.call(this, data, path, (g) => { try { onLoad(g); } finally { try { const p = g && g.parser; if (p) { const b = p.extensions && p.extensions.KHR_binary_glTF; if (b) { b.body = null; b.content = null; } if (p.cache && p.cache.removeAll) p.cache.removeAll(); p.primitiveCache = {}; p.sourceCache = {}; p.textureCache = {}; p.nodeCache = {}; MF.stats.parsers = (MF.stats.parsers || 0) + 1; } } catch (e) {} } }, onError); }; }
const block = (o, what) => { try { Object.defineProperty(o, 'needsUpdate', { configurable: true, set(v) { if (v) { MF.stats.blocked++; note('needsUpdate ignored on freed ' + what); } } }); } catch (e) {} };
function freeAttr(a) {
  const arr = a.array, bytes = arr.byteLength, empty = new arr.constructor(0);
  if (MF.trap) { let said = 0; Object.defineProperty(a, 'array', { configurable: true, get() { MF.stats.reads++; if (said++ < 2) note('READ of freed array (' + (a.name || a.itemSize + 'x' + a.count) + ') ' + String(new Error().stack).split('\n').slice(1, 6).join(' | ')); return empty; }, set() {} }); }
  else a.array = empty;
  a.__mfFreed = true; block(a, 'vertex array'); MF.stats.attrs++; MF.stats.attrMB += bytes / 1048576;
}
// One pass. Cheap when nothing is new: the scene is walked only when uploads have arrived since the last pass.
MF.sweep = function (world) {
  if (!MF.on) return; const now = performance.now(), S = MF.stats; S.sweeps++;
  const ready = MF.up.some((a) => now - a.__mfT > AGE); let keep = null;
  if (ready) { keep = new Set(); const ok = new Map(), k = (a) => { if (a) keep.add(a.isInterleavedBufferAttribute ? a.data : a); }, y = (a, n) => { if (a) ok.set(a.isInterleavedBufferAttribute ? a.data : a, n); };
    for (const top of world.scene.children) { const name = top.name || top.type, held = MF.keepRoots.test(name) || (top.userData && top.userData.keepArrays);
      top.traverse((o) => { const g = o.geometry; if (!g) return;
        // bounds are worked out now, while the positions are still here: three computes them lazily (a new InstancedMesh on an old geometry, a ray test)
        if (!g.__mfB) { g.__mfB = 1; try { if (g.attributes.position && g.attributes.position.array && g.attributes.position.array.length) { if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox(); } } catch (e) {} }
        const all = held || o.isSkinnedMesh || o.isPoints || o.isLine || (o.userData && o.userData.keepArrays) || (g.userData && g.userData.keepArrays) || (g.morphAttributes && Object.keys(g.morphAttributes).length > 0);
        const f = all ? k : (a) => y(a, name); f(g.index); for (const n in g.attributes) f(g.attributes[n]); }); }
    const rest = [];
    for (const a of MF.up) { if (a.__mfFreed) continue;
      if (a.version !== a.__mfV || !a.array || a.array.byteLength < MIN || keep.has(a) || (a.updateRanges && a.updateRanges.length)) { S.kept++; continue; }
      if (now - a.__mfT < AGE || !ok.has(a)) { if (now - a.__mfT < 120000) rest.push(a); continue; }      /* not in the scene (yet): looked at again for two minutes, then left alone */
      const n = ok.get(a).replace(/[0-9_.-]+$/, '') || '?'; MF.byRoot[n] = +((MF.byRoot[n] || 0) + a.array.byteLength / 1048576).toFixed(1); freeAttr(a); }
    MF.up = rest; }
  // textures: the compressed blocks, raw pixel arrays and decoded bitmaps of textures the card already has
  const r = world.renderer, props = r.properties, groups = new Map();
  const see = (t) => { if (!t || !t.isTexture || t.__mfFreed || t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isCanvasTexture || (t.userData && t.userData.keepData)) return;
    const im = t.image, key = t.mipmaps && t.mipmaps.length ? t.mipmaps[0] : t.source; if (!key) return; let g = groups.get(key); if (!g) groups.set(key, (g = { ts: [], ok: true }));
    g.ts.push(t); const p = props.get(t); if (!p || !p.__webglTexture || p.__version !== t.version) g.ok = false; if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement && !(t.source && t.source.__mfLean && !t.source.__mfOrig)) g.ok = false; };
  const mats = new Set(); world.scene.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m); });
  for (const m of mats) { for (const n in m) { const v = m[n]; if (v && v.isTexture) see(v); } if (m.uniforms) for (const n in m.uniforms) { const v = m.uniforms[n] && m.uniforms[n].value; if (v && v.isTexture) see(v); } }
  for (const g of groups.values()) { if (!g.ok) continue; const t = g.ts[0]; if (!t.__mfSeen) { for (const q of g.ts) q.__mfSeen = now; continue; } if (now - t.__mfSeen < AGE) continue;   // uploaded and unchanged for a while
    let bytes = 0; const im = t.image;
    if (t.mipmaps && t.mipmaps.length && t.mipmaps[0].data) { for (const m of t.mipmaps) if (m.data && m.data.byteLength) { bytes += m.data.byteLength; m.data = new m.data.constructor(0); } S.tex++; S.texMB += bytes / 1048576; }
    else if (im && im.data && im.data.byteLength > 65536 && (t.isDataTexture || t.isDataArrayTexture || t.isData3DTexture) && !MF.keepPixels) { bytes = im.data.byteLength; if (MF.trap) { const e = new im.data.constructor(0); let said = 0; Object.defineProperty(im, 'data', { configurable: true, get() { MF.stats.reads++; if (said++ < 2) note('READ of freed pixels ' + (t.name || im.width + 'x' + im.height) + ' ' + String(new Error().stack).split('\n').slice(1, 6).join(' | ')); return e; }, set() {} }); } else im.data = new im.data.constructor(0); S.tex++; S.texMB += bytes / 1048576; }
    else if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement && t.source.__mfLean && !t.source.__mfOrig) { bytes = im.width * im.height * 4; t.source.data = { width: im.width, height: im.height }; im.width = im.height = 0; S.bitmaps++; S.bitmapMB += bytes / 1048576; }      /* our own half-size copy */
    else if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap && im.width * im.height > 65536) { bytes = im.width * im.height * 4; try { im.close(); } catch (e) {} S.bitmaps++; S.bitmapMB += bytes / 1048576; }
    else continue;
    for (const q of g.ts) { q.__mfFreed = true; q.__mfBytes = bytes; block(q, 'texture ' + (q.name || '')); if (q.source) block(q.source, 'texture source'); } }
  // the texture transcoder's workers (four, each with its own copy of the transcoder and the last picture it unpacked) are ended once they
  // are idle; three.js starts new ones by itself if a texture arrives later
  try { const wp = window.__ktx2 && window.__ktx2.workerPool; if (wp && wp.workers.length && wp.workerStatus === 0 && !wp.queue.length && now - (MF.t0 || now) > 12000) { S.workersEnded = (S.workersEnded || 0) + wp.workers.filter(Boolean).length; wp.dispose(); } } catch (e) {}
  // The browser only gives the swapped-out arrays back when its collector next runs a full pass, and in steady play the game allocates too little
  // to make it (Chrome still held all 1.4 GB 80 s in). New array storage is what the collectors watch, so after a pass that freed something a
  // few small empty buffers are made and dropped (4 MB four times a second for 15 s; untouched, so they cost no real memory).
  { const freed = S.attrMB + S.texMB + S.bitmapMB; if (freed > (MF.freedSeen || 0) + 16 && MF.churn !== false && !MF.churning) { MF.freedSeen = freed; MF.churning = 60; const iv = setInterval(() => { try { new ArrayBuffer(4 << 20); } catch (e) {} if (--MF.churning <= 0) { MF.churning = 0; clearInterval(iv); } }, 250); } }
  S.attrMB = +S.attrMB.toFixed(1); S.texMB = +S.texMB.toFixed(1); S.bitmapMB = +S.bitmapMB.toFixed(1);
};
// start(world): passes at 6 s, then every 5 s for the first minute (things that come into view late), then every 20 s.
MF.start = function (world) { if (!MF.on || MF.timer) return; MF.t0 = performance.now(); MF.leanShadow(world); let n = 0; const tick = () => { try { MF.sweep(world); } catch (e) { note('sweep failed: ' + (e && e.message)); } MF.timer = setTimeout(tick, ++n < 12 ? 5000 : 20000); }; MF.timer = setTimeout(tick, 6000); };
// lean(renderer): Safari charges every byte on the graphics card to the page's own process (measured: 512 MB of buffers = +513 MB), so there
// the plain (not block-compressed) 8-bit pictures of 1024 px and more are halved (block-compressed ones lose their largest level, the 16-bit sky every second pixel) before they are uploaded: pictures, canvas-made textures and
// raw pixel arrays (layered ones too), and the sun shadow map goes from 4096 to 2048. Chrome and the rest are not touched.
// ?lean=1 forces it on anywhere, ?lean=0 off, ?lean=<px> sets the size from which a picture is halved (default 1024).
// texture.userData.noLean = true leaves one texture alone. A canvas the game keeps drawing on is copied down again at each needsUpdate.
const isDom = (im) => (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) || (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) || (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && im instanceof OffscreenCanvas);
function leanTex(t) {
  if (t.isCompressedTexture && !t.isCompressedArrayTexture && t.version === 0 && t.mipmaps && t.mipmaps.length > 2 && !(t.userData && t.userData.noLean)) { const m0 = t.mipmaps[0], m1 = t.mipmaps[1];     // block-compressed: leave out the largest level
    if (m0 && m1 && m0.data && !m1.__mfTop && !m0.__mfTop && Math.max(m0.width, m0.height) >= MF.leanMin && m1.width === Math.max(1, m0.width >> 1) && m1.height === Math.max(1, m0.height >> 1)) { t.mipmaps.shift(); m1.__mfTop = true; if (t.image && t.image.width === m0.width) { t.image.width = m1.width; t.image.height = m1.height; } MF.leanS.n++; MF.leanS.cMB = (MF.leanS.cMB || 0) + m0.data.byteLength / 1048576; } return; }
  if (t.isCompressedTexture || t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isCubeTexture || (t.userData && t.userData.noLean)) return;
  if (t.type === THREE.HalfFloatType && t.isDataTexture && !t.isDataArrayTexture && t.version === 0 && t.magFilter === THREE.LinearFilter && !(t.mipmaps && t.mipmaps.length) && t.source && t.source.data && t.source.data.data instanceof Uint16Array && !t.source.__mfLean) {     // a 16-bit float picture (the sky): every second pixel
    const im = t.source.data, w = im.width, h = im.height, ch = Math.round(im.data.length / (w * h)); if (Math.max(w, h) < MF.leanMin || (w & 1) || (h & 1) || ch < 1 || ch > 4 || ch * w * h !== im.data.length) return;
    const W = w >> 1, H = h >> 1, a = im.data, o = new Uint16Array(W * H * ch); for (let y = 0, q = 0; y < H; y++) { let p = y * 2 * w * ch; for (let x = 0; x < W; x++, p += 2 * ch) for (let k = 0; k < ch; k++) o[q++] = a[p + k]; }
    t.source.__mfLean = true; im.data = o; im.width = W; im.height = H; MF.leanS.n++; MF.leanS.MB += (a.byteLength - o.byteLength) / 1048576; return; }
  if (t.type !== THREE.UnsignedByteType) return;
  const src = t.source, im = src && src.data, L = MF.leanS; if (!im) return;
  if (src.__mfOrig) { const o = src.__mfOrig, g = im.getContext('2d'); g.clearRect(0, 0, im.width, im.height); g.drawImage(o, 0, 0, im.width, im.height); return; }     // a live canvas: copy it down again
  if (src.__mfLean) return;
  if (isDom(im)) { const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height; if (Math.max(w, h) < MF.leanMin || !w || !h) return;
    const c = document.createElement('canvas'); c.width = Math.max(1, w >> 1); c.height = Math.max(1, h >> 1); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    src.__mfLean = true; if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) src.__mfOrig = im; else if (im.close) { try { im.close(); } catch (e) {} }
    src.data = c; L.n++; L.MB += (w * h - c.width * c.height) * 4 * 1.333 / 1048576; return; }
  if (im.data && im.data instanceof Uint8Array && (t.isDataTexture || t.isDataArrayTexture) && t.version === 0 && t.magFilter === THREE.LinearFilter && !(t.mipmaps && t.mipmaps.length)) { const w = im.width, h = im.height, d = t.isDataArrayTexture ? im.depth || 1 : 1, ch = Math.round(im.data.length / (w * h * d));
    if (Math.max(w, h) < MF.leanMin || (w & 1) || (h & 1) || ch < 1 || ch > 4 || ch * w * h * d !== im.data.length) return; const W = w >> 1, H = h >> 1, a = im.data, o = new Uint8Array(W * H * d * ch);
    for (let z = 0; z < d; z++) { const zi = z * w * h * ch, zo = z * W * H * ch; for (let y = 0; y < H; y++) { let p = zi + y * 2 * w * ch, q = zo + y * W * ch; for (let x = 0; x < W; x++, p += 2 * ch) for (let k = 0; k < ch; k++) o[q++] = (a[p + k] + a[p + ch + k] + a[p + w * ch + k] + a[p + w * ch + ch + k] + 2) >> 2; } }
    src.__mfLean = true; im.data = o; im.width = W; im.height = H; L.n++; L.MB += (a.length - o.length) * 1.333 / 1048576; } }
MF.leanS = { n: 0, MB: 0, shadow: 0 };
MF.lean = function (renderer) { const q = new URLSearchParams(location.search).get('lean'); if (q === '0' || !(q || window.__safari)) return; MF.leanOn = true; MF.leanMin = +q > 256 ? +q : 1024;
  const d = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', { configurable: true, set(v) { if (v === true) { try { leanTex(this); } catch (e) { note('lean failed: ' + (e && e.message)); } } d.set.call(this, v); } }); };
// leanShadow(world): called from start(); the sun's shadow map (a colour and a depth picture, 4 bytes a pixel each) at half the side
MF.leanShadow = function (world) { try { const sh = world.sun && world.sun.shadow; if (!MF.leanOn || !sh || sh.mapSize.x <= 2048) return; const was = sh.mapSize.x; sh.mapSize.set(2048, 2048); if (sh.map) { sh.map.dispose(); sh.map = null; } MF.leanS.shadow = was; } catch (e) {} };
export const memfree = MF;
