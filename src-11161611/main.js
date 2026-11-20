import './feedback.js';     // first: its error, console and frame-time recorders run from the first line of the load (the Feedback form is installed by game.js)
if (!/[?&]telemetry=0\b/.test(location.search)) import('./telemetry.js').catch(() => {});     // progress lane, Nov 14: automatic anonymous error / lost-context / frame-time reports (src/telemetry.js); ?telemetry=0 off (nothing fetched)
if (!/[?&]loadwait=0\b/.test(location.search)) import('./loadwait.js').catch(() => {});     // progress lane, Nov 15: the wait on the start screen (src/loadwait.js): time left from the player's own speed, the tab title and icon call a background tab back, pictures of the game behind the start text; ?loadwait=0 off (nothing fetched)
if (!/[?&]hidwarm=0\b/.test(location.search)) import('./hidwarm.js').catch(() => {});     // perf lane, Nov 15: PLAY lights in a background tab: while the page is hidden and still loading, the waiting frames are run from a worker's beat, because a hidden tab is given no frames and the last loading step counts drawn ones (src/hidwarm.js; ?hidwarm=0 off, nothing fetched)
if (/[?&]replay=/.test(location.search)) import('./replay.js').catch((e) => console.log('[replay] not loaded: ' + (e && e.message)));     // progress lane: private tool, plays a stored telemetry report's log back in this build (src/replay.js; not in the public build)
// Loading progress (Matt, Nov 11: "it's not really clear that it's loading"): every same-origin download is counted as its bytes arrive, so the
// start screen shows a real bar: percent, MB done of the build's measured total (assets/loadtotal.json, written by tools/loadmeasure.mjs) and what
// is coming in now. After the downloads the city is built on the graphics card; the bar says so and its stripe keeps moving, so it never looks frozen.
{ const L = (window.__load = { done: 0, total: 0, files: 0, failed: 0, now: '', stage: 'starting', t0: performance.now() }), plain0 = window.fetch.bind(window);
  const what = (u) => (/city\.glb|far\.glb/.test(u) ? 'buildings' : /hero\//.test(u) ? 'landmarks' : /crowd|people/.test(u) ? 'people' : /streets\/vehicles|openx/.test(u) ? 'cars' : /streets\//.test(u) ? 'streets' : /light\/|sky/.test(u) ? 'sky' : /panels|tex\//.test(u) ? 'walls' : /heli/.test(u) ? 'helicopter' : /combat|entry/.test(u) ? 'gear' : /\.js/.test(u) ? 'code' : 'city data');
  plain0('assets/loadtotal.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.bytes) L.total = j.bytes; }).catch(() => {});
  // Behind Cloudflare's proxy only some file types are kept at the edge (.bin, .gz, .js, .jpg, .webp ...). The public build can therefore ship
  // its models and textures with ".bin" added to the name (window.__CFG.bin, set by tools/public_build.sh); every request for such a file is sent there.
  const BINRE = /\.(glb|ktx2|hdr|opus|wasm|p\d)(\?.*)?$/, binOn = !!(window.__CFG && window.__CFG.bin);
  // lead, Nov 14 (players' own reports: the middle first load took 67 s, and half of those who could run the game left before it ended). Each loading
  // stage asked for its files only once the stage before it was built, so downloading and building took turns, and a download stood still whenever
  // the page was busy building. assets/preload.json (tools/preload_list.py, from a measured load) lists the big files in the order the game asks for
  // them: a worker fetches them six at a time from the first moment and hands each over as a blob; when the game asks for one it gets the blob, or
  // waits for the fetch already under way (a file asked for out of turn is fetched at once). At most 96 MB waits unread. Any fault falls back to
  // the plain fetch. OFF unless ?prefetch=1: measured on laptop 2 through a 30 Mbit line it took Ready from 68.4 s to 66.2 s, one run each, which is
  // inside the noise; it stays a switch until the players' load split (telemetry round 2) says whether they wait on the line or on the building.
  const PF = new Map(), pfRes = new Map(), pfSeen = new Set(), pfKey = (u) => { try { return new URL(u, location.href).href; } catch (e) { return String(u); } }; let pfW = null;
  const pfFail = (why) => { for (const r of pfRes.values()) r.no(new Error(why)); pfRes.clear(); PF.clear(); if (pfW) { try { pfW.terminate(); } catch (e) {} pfW = null; } };
  if (/[?&]prefetch=1\b/.test(location.search) && self.Worker && self.Blob) plain0('assets/preload.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((list) => { if (!Array.isArray(list) || !list.length) return;
    const src = `let list = [], i = 0, ahead = 0, cap = 96e6, pend = 0; const started = new Set(); setInterval(() => { if (pend) { postMessage({ n: pend }); pend = 0; } }, 200);
      const get = async (k) => { if (started.has(k)) return; started.add(k);
        try { const r = await fetch(k); if (!r.ok || !r.body) throw new Error('status ' + r.status); const rd = r.body.getReader(), parts = []; let n = 0;
          for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.byteLength; pend += value.byteLength; ahead += value.byteLength; }
          postMessage({ k, blob: new Blob(parts), size: n, type: r.headers.get('content-type') || '' }); } catch (e) { postMessage({ k, err: String((e && e.message) || e) }); } };
      const run = async () => { while (i < list.length) { if (ahead > cap) { await new Promise((r) => setTimeout(r, 100)); continue; } await get(list[i++]); } };
      onmessage = (ev) => { const m = ev.data; if (m.list) { list = m.list; cap = m.cap || cap; for (let c = 0; c < (m.par || 6); c++) run(); } else if (m.want) get(m.want); else if (m.used) ahead -= m.used; };`;
    const urls = []; for (let u of list) { if (typeof u !== 'string') continue; if (binOn && BINRE.test(u)) u = u.replace(BINRE, '.$1.bin$2'); const k = pfKey(u); if (pfSeen.has(k) || PF.has(k)) continue; let ok, no; const p = new Promise((a, b) => { ok = a; no = b; }); p.catch(() => {}); PF.set(k, p); pfRes.set(k, { ok, no }); urls.push(k); }
    if (!urls.length) return; L.pf = { n: urls.length, got: 0, used: 0, bad: 0 }; const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (ev) => { const m = ev.data; if (m.n && !window.__ready) { L.done += m.n; L.last = performance.now(); } if (!m.k) return; const r = pfRes.get(m.k); pfRes.delete(m.k); if (!r) return;
      if (m.err) { L.pf.bad++; PF.delete(m.k); r.no(new Error(m.err)); } else { L.pf.got++; if (!window.__ready) { L.files++; L.now = what(m.k); } r.ok(m); } };
    w.onerror = () => pfFail('prefetch worker'); pfW = w; w.postMessage({ list: urls, par: 6, cap: 96e6 });
    const done = setInterval(() => { if (window.__ready && !window.__warming) { clearInterval(done); setTimeout(() => pfFail('over'), 30000); } }, 2000); }).catch(() => {});
  window.fetch = async (u, o) => { if (u instanceof URL) u = u.href; else if (typeof Request !== 'undefined' && u instanceof Request && u.method === 'GET') { o = o || { headers: u.headers, credentials: u.credentials, signal: u.signal }; u = u.url; }     /* three's loaders pass a Request */
    let url = typeof u === 'string' ? u : (u && u.url) || '';
    if (binOn && typeof u === 'string' && BINRE.test(u) && !/^(data|blob):/.test(u)) { u = u.replace(BINRE, '.$1.bin$2'); url = u; }
    if (!(o && o.method && o.method !== 'GET') && !/^(data|blob):/.test(url)) { const k = pfKey(u), p = PF.get(k); pfSeen.add(k); if (p) { PF.delete(k); if (pfW) pfW.postMessage({ want: k }); try { const e = await p; L.pf.used++; if (pfW) pfW.postMessage({ used: e.size }); return new Response(e.blob, { status: 200, headers: e.type ? { 'content-type': e.type } : {} }); } catch (e) { /* the prefetch failed: ask again the plain way */ } } }
    if ((o && o.method && o.method !== 'GET') || /^(data|blob):/.test(url) || /api\/|build\.txt|loadtotal/.test(url) || window.__ready) return plain0(u, o);
    let r; try { r = await LR.rfetch(plain0, u, o); } catch (e) { L.failed++; throw e; } if (!r.ok) { if (!/\.gz(\.p\d+(\.bin)?)?$|people\.json/.test(url)) L.failed++; return r; } if (!r.body) return r; L.files++; L.now = what(url);
    const rd = r.body.getReader(); return new Response(new ReadableStream({ async pull(c) { try { const { done, value } = await rd.read(); if (done) { c.close(); return; } L.done += value.byteLength; L.last = performance.now(); c.enqueue(value); } catch (e) { L.failed++; c.error(e); } }, cancel(why) { return rd.cancel(why); } }), { status: r.status, statusText: r.statusText, headers: r.headers }); };
  const ui = setInterval(() => { const bar = document.getElementById('loadbar'), txt = document.getElementById('loadtxt'); if (!bar) { if (window.__ready && !window.__warming) clearInterval(ui); return; }
    if (window.__ready && !window.__warming) { bar.style.width = '100%'; txt.textContent = 'Ready'; document.getElementById('loadwrap').style.opacity = 0; clearInterval(ui); return; }
    const tot = Math.max(L.total || 250e6, L.done * 1.02), pct = Math.min(99, Math.floor(L.done / tot * 100)), mb = (x) => Math.round(x / 1e6), secs = (performance.now() - L.t0) / 1000;
    const building = (L.total && L.done >= L.total * 0.985) || (/game|compiled/.test(L.stage) && performance.now() - (L.last || 0) > 1500);
    if (window.__warming) { bar.style.width = '99%'; txt.textContent = 'Last step · getting the graphics card ready (' + Math.round(secs) + ' s). The first visit can pause here for up to a minute.'; return; }
    bar.style.width = (building ? 99 : Math.max(2, pct)) + '%'; txt.textContent = building ? '99% · ' + mb(L.done) + ' MB in · building the city on your graphics card (' + Math.round(secs) + ' s)' : pct + '% · ' + mb(L.done) + ' of ' + mb(tot) + ' MB · loading ' + (L.now || 'the city') + (L.failed ? ' · ' + L.failed + ' failed' : ''); }, 150); }
import * as THREE from 'three';
import { World } from './world.js';
import * as LR from './loadretry.js';     // progress lane, Nov 15: a file that failed to download is asked for again, and a load that cannot start says so with a Try again button (src/loadretry.js; ?loadretry=0 off)
import { memfree } from './memfree.js';     // audit lane, Nov 11: frees the page's copies of vertex arrays and texture data after upload (?memfree=0 off)

const P = new URLSearchParams(location.search);
if (window.__CFG && window.__CFG.heatedge === 0 && !P.has('heatedge')) P.set('heatedge', '0');
if (window.__CFG && window.__CFG.emsvol === 0 && !P.has('emsvol')) P.set('emsvol', '0');
if (window.__CFG && window.__CFG.public) { if (!P.has('grapple')) P.set('grapple', '1'); }      /* lead, Nov 16 16:09 (Matt, #nyc: 'put them all on please'): the public site now has everything Matt's link has: handling r4, heli heat, water, top speed, buses, the three Aurora vehicles, the cola sign, ?map=downtown and ?map=dumbo; the grappler is ON by default there (?grapple=0 off). Before that: */      /* lead, Nov 16: gameplay's handling retune (r4) and grappler are on Matt's link only until CHIEF says public: the public site keeps the live car (?handling=1 tries the new one there) and has no grappler */     // lead, Nov 15, CHIEF 12:22: the public build keeps the ambulance and fire engine sirens silent until Matt has heard them (PUBLIC_EMSVOL=0 -> __CFG.emsvol = 0; ?emsvol=1 plays them there)     // lead, Nov 15: the public build holds gameplay p2 + p3 (police at the map's edge) off until shown on its map (PUBLIC_HEATEDGE=0 -> __CFG.heatedge = 0; ?heatedge=1 shows it there)
// Big plain-data files are served gzip-packed (the link's uplink is ~2 MB/s): any fetch of these names reads <name>.gz and unpacks it in the page, falling back to the plain file.
{ const plain = window.fetch.bind(window), packed = /(dressing\.bin|city(-\d+|-dumbo)?\.json)$/;     /* downtown lane: city-15.json too; merge lane: city-dumbo.json too */
  window.fetch = async (u, o) => { if (typeof u === 'string' && packed.test(u) && self.DecompressionStream && !(o && o.method && o.method !== 'GET')) { try { const r = await plain(u + '.gz', o); if (r.ok) return new Response(r.body.pipeThrough(new DecompressionStream('gzip')), { status: 200 }); } catch (e) {} } return plain(u, o); }; }
// perf lane (download size): files listed in assets/dl.json come packed harder than gzip and are rebuilt byte for byte in a worker (src/dl/dl.js). ?dl=0 = off.
if (P.get('dl') !== '0') try { await (await import('./dl/dl.js')).installDL(); } catch (e) { console.log('[dl] not installed: ' + (e && e.message)); }
// lead, Nov 11 (public link): strangers on phones and old machines get a plain message instead of a frozen page. The game needs WebGL2 and is
// built for laptops and desktops; "Try anyway" goes on (some new phones and tablets do run it, slowly).
{ const probe = document.createElement('canvas').getContext('webgl2'), phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  if ((!probe || phone) && !/[?&]anyway/.test(location.search) && !window.__anyway) {
    const m = document.getElementById('bootmsg'); const why = !probe ? 'This browser or graphics card cannot run it (WebGL 2 is missing or switched off).' : 'It is a 200 MB download and needs a laptop or desktop graphics card: it will be slow or may not start on a phone.';
    { const sb0 = document.getElementById('startbox'); if (sb0) sb0.style.display = 'none'; if (m) m.style.display = ''; }
    if (m) { m.style.textTransform = 'none'; m.style.letterSpacing = '0'; m.style.maxWidth = '30em'; m.style.lineHeight = '1.5'; m.innerHTML = 'CROSSTOWN runs in Chrome, Edge or Safari on a laptop or desktop with a recent graphics card. ' + why + (probe ? '<br><a href="' + location.pathname + (location.search ? location.search + '&' : '?') + 'anyway=1" style="color:#ffd27a">Try anyway</a>' : '') + ' &nbsp; <a href="credits/" style="color:#bbb">Credits</a>'; }
    window.__blocked = !probe ? 'nowebgl2' : 'phone'; await new Promise(() => {}); } }
// Safari (public reports Nov 11, two M1 Macs: 16 to 19 fps where Chrome gets 45+, and "the game keeps crashing": Safari reloads a page that uses
// this much memory). Until that is solved the start screen says so plainly, and the game starts Safari on a lighter setting (smaller picture,
// less drawn) to give it its best chance.
window.__safari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg\/|Firefox|FxiOS|OPR\//.test(navigator.userAgent);
if (window.__safari) { const sb0 = document.getElementById('startbox'); if (sb0) { const d = document.createElement('p'); d.style.cssText = 'margin:0 0 12px;padding:8px 12px;border-radius:8px;background:rgba(255,210,122,.14);border:1px solid rgba(255,210,122,.5);color:#ffe2a8;font-size:14px'; d.innerHTML = '<b>Please use Chrome for now.</b> In Safari this runs at about a third of the speed and Safari may reload the page when memory runs short. It will start here on a lighter setting.'; sb0.insertBefore(d, sb0.firstChild); } }
const canvas = document.getElementById('c');
{ const sb = document.getElementById('startbox'); if (sb && !window.__noStart && (!navigator.webdriver || /[?&]start=1/.test(location.search)) && !/[?&](demo|capture|shot|play)\b|crowd=none|peds=0/.test(location.search)) { sb.style.display = 'block'; const bm = document.getElementById('bootmsg'); if (bm) bm.style.display = 'none'; } }     // the start text shows while the game loads
// lead, Nov 14 (3 players' reports, Windows Chrome: "Error creating WebGL context" here, and the page then sat at the loading bar for good): say so plainly.
const renderer = await (async () => { try { return new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: P.has('shot') || P.has('capture') }); } catch (e) {
  const m = document.getElementById('bootmsg'), sb0 = document.getElementById('startbox'); if (sb0) sb0.style.display = 'none';
  if (m) { m.style.display = ''; m.style.textTransform = 'none'; m.style.letterSpacing = '0'; m.style.maxWidth = '30em'; m.style.lineHeight = '1.5'; m.innerHTML = 'The browser would not give the game a 3D picture (the graphics card is busy, out of memory, or hardware acceleration is switched off). Closing other tabs and games and reloading often helps. <a href="" style="color:#ffd27a">Reload</a> &nbsp; <a href="credits/" style="color:#bbb">Credits</a>'; }
  window.__blocked = 'nocontext'; console.warn('[game] no WebGL context: ' + (e && e.message)); await new Promise(() => {}); } })();
// If the graphics driver resets or runs out of memory the browser takes the WebGL context away and the picture goes white (first Linux report,
// Nov 11). Say so plainly instead of leaving a white page; the Feedback form still works and its trace records the loss.
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (window.__mark) window.__mark('contextLost'); if (document.getElementById('ctxlost')) return; const d = document.createElement('div'); d.id = 'ctxlost';
  d.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(11,12,14,.93);color:#eee;font:15px/1.6 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px';
  d.innerHTML = '<div style="max-width:32em"><b>The graphics card stopped drawing.</b><br>The browser took the 3D picture away: usually the graphics driver reset or ran out of memory (the game needs about 1.5 GB of graphics memory).<br><br><a href="" style="color:#ffd27a">Reload the page</a> &nbsp; Closing other tabs and games first helps. Press <b>B</b> to tell us what happened: the report includes what we need to look into it.</div>'; document.body.appendChild(d); try { document.exitPointerLock(); } catch (err) {} });
// lead, Nov 14 (player reports 001455-7fb232 and 010030-7ca35d): two machines that cannot run it got no word why. (1) No graphics driver: the
// browser draws with the processor (about 10 fps): the start screen says so. (2) Every shader fails to link (one Windows Firefox machine, 100
// 'VALIDATE_STATUS false' lines, nothing drawn): after 5 failed programs a plain panel says so once. The first lines still go to the console.
try { const gl0 = renderer.getContext(), x0 = gl0.getExtension('WEBGL_debug_renderer_info'), gs0 = String(x0 ? gl0.getParameter(x0.UNMASKED_RENDERER_WEBGL) : gl0.getParameter(gl0.RENDERER));
  window.__softGL = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gs0) || /[?&]softgl=1/.test(location.search);
  if (window.__softGL) { const sb0 = document.getElementById('startbox'); if (sb0) { const d = document.createElement('p'); d.id = 'softnote'; d.style.cssText = 'margin:0 0 12px;padding:8px 12px;border-radius:8px;background:rgba(255,210,122,.14);border:1px solid rgba(255,210,122,.5);color:#ffe2a8;font-size:14px'; d.innerHTML = '<b>This browser is not using a graphics card.</b> It is drawing with the processor, so the game will run at about 10 frames a second. Switch on hardware acceleration in the browser settings, or update the graphics driver, then reload.'; sb0.insertBefore(d, sb0.firstChild); } } } catch (e) {}
{ let nBad = 0; renderer.debug.onShaderError = (gl, prog, vs, fs) => { nBad++; if (nBad <= 5) console.error('THREE.WebGLProgram: Shader Error ' + gl.getError() + ' - VALIDATE_STATUS ' + gl.getProgramParameter(prog, gl.VALIDATE_STATUS) + ' ' + String(gl.getProgramInfoLog(prog) || '').trim().slice(0, 200) + ' | ' + ((String(gl.getShaderInfoLog(fs) || '') + String(gl.getShaderInfoLog(vs) || '')).match(/ERROR[^\n]*/) || [''])[0].slice(0, 200));
    if (nBad !== 5 || document.getElementById('shfail') || document.getElementById('ctxlost') || gl.isContextLost()) return; if (window.__mark) window.__mark('shadersFail'); const d = document.createElement('div'); d.id = 'shfail';
    d.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(11,12,14,.93);color:#eee;font:15px/1.6 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px';
    d.innerHTML = '<div style="max-width:32em"><b>This browser and graphics card cannot draw the game.</b><br>The graphics driver refused the game\'s drawing programs, so the picture would stay empty.<br><br>Please try <b>Chrome or Edge</b>, or update the graphics driver. Press <b>B</b> to tell us: the report names the card so we can look into it. &nbsp; <a href="#" id="shfailgo" style="color:#ffd27a">Carry on anyway</a></div>'; document.body.appendChild(d); try { document.exitPointerLock(); } catch (err) {}
    const go = document.getElementById('shfailgo'); if (go) go.onclick = (ev) => { ev.preventDefault(); d.remove(); }; }; window.__shFail = renderer.debug.onShaderError; }
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
memfree.lean(renderer); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await (await LR.imp(() => import('./ktx2hook.js'), new URL('./ktx2hook.js', import.meta.url))).installKTX2(renderer);     // lead, Nov 10: Basis/KTX2 textures (see ktx2hook.js)
const world = new World(renderer);
// lead, Nov 10: which build is this? Shown bottom-left for the first 25 s (publish.sh writes build.txt), so a stale tab can be told from a new one.
fetch('build.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((t) => { if (!t || /capture|shot|crowd=none/.test(location.search)) return; window.__build = t.trim(); const d = document.createElement('div'); d.textContent = 'build ' + t.trim(); d.style.cssText = 'position:fixed;left:10px;bottom:8px;font:12px system-ui,sans-serif;color:#fff;opacity:.75;text-shadow:0 1px 2px #000;z-index:50;pointer-events:none;transition:opacity 2s'; document.body.appendChild(d); setTimeout(() => { d.style.opacity = 0; }, 25000); }).catch(() => {});
window.world = world; window.THREE = THREE;
const W = +(P.get('w') || 0), H = +(P.get('h') || 0);
// live play renders at most ~2.4 million pixels (about 1080p x 1.15): the facade and soft-shadow shaders are paid per pixel, and a retina window at 1.5x was twice that.
// world.liveScale (game.js lowers it when the frame rate still sags) scales it further.
function fit() { const w = W || innerWidth, h = H || innerHeight; world.resize(w, h, W ? 1 : Math.min(devicePixelRatio, Math.min(devicePixelRatio, 1.5, Math.sqrt((P.has('px') ? +P.get('px') * 1e6 : window.__safari ? 1.3e6 : 2.4e6) / (w * h))) * (world.liveScale || 1))); }
window.__fit = fit;
const msg = document.getElementById('bootmsg');
try {
  await world.load((s) => { msg.textContent = s; if (window.__load) window.__load.stage = s; }); if (window.__load) window.__load.stage = 'game'; if (window.__mark) window.__mark('world');     /* progress lane: load marks for telemetry (world, init, compiled) */
  fit(); addEventListener('resize', fit);
  if (P.has('shot')) {
    // ?shot=x,y,z,tx,ty,tz[,fov]: a still from a fixed camera (map metres: x east, y up, z north)
    const setCam = (a) => { world.camera.position.set(a[0], a[1], -a[2]); world.camera.lookAt(a[3], a[4], -a[5]); world.camera.fov = a[6] || 55; world.camera.updateProjectionMatrix(); };
    window.shot = (a) => { setCam(a); for (let i = 0; i < 3; i++) world.render(i / 60, new THREE.Vector3(a[3], 0, -a[5])); return true; };
    window.shot(P.get('shot').split(',').map(Number));
    document.getElementById('boot').remove(); window.__ready = true; if (window.__mark) window.__mark('ready'); window.__readyAt = +(performance.now() / 1000).toFixed(1);
  } else {
    let warm = null; if (P.get('warmup') !== '0' && !P.has('nocompile')) try { warm = (await import('./warmup.js')).startWarmup(world, renderer, P); } catch (e) { console.log('[game] warm-up ahead not loaded: ' + (e && e.message)); }     /* light lane, Nov 15: on a first visit the street mirror's and the picture passes' shader programs are linked as one batch before the first frame, not one by one in the first drawn frames (src/warmup.js; ?warmup=0 = the old way) */
    const { Game } = await LR.imp(() => import('./game.js'), new URL('./game.js', import.meta.url));
    const game = new Game(world, P); window.game = game; await game.init(); if (window.__mark) window.__mark('init'); window.__heroGo = true;     /* lead: the landmarks' files may start coming down now, while the shaders compile (hero.js fetchBytes) */
    // Start screen (Matt, Nov 11): before play, a short note that this is an early preview, how to give feedback, a Play button and a tiny credits
    // link. Skipped for films, stills, judged captures and test tools (?demo ?capture ?peds=0 ?crowd=none ?play=1, or window.__noStart set by a tool).
    // Before Play goes live, the shaders are compiled in the background (the browser's parallel compile where it has one) while the loading bar
    // says so. Without this the first frames after Play froze the page for many seconds (3 s on our laptops, 20 to 40 s in the first outside traces).
    // The figures a struck person turns into (pedhit.js) are part of this: they sit hidden in the scene, and compiled only on the first hit, in the
    // wrong render state, they cost that hit a 120-150 ms hitch ("when i hit someone in a car it freezes the game", Nov 11).
    const figs = []; try { if (game.__pedhit && game.__pedhit.warm) for (const o of game.__pedhit.warm()) { let r0 = o; while (r0.parent && r0.parent !== world.scene) r0 = r0.parent; if (!figs.includes(r0)) figs.push(r0); } for (const f of figs) f.visible = true; } catch (e) {}
    if (warm) try { warm.begin(); } catch (e) {}     /* light lane: the street mirror's and the picture passes' programs join the batch below (see the line above new Game) */
    if (!P.has('nocompile')) { try { const r = renderer, old = r.getRenderTarget(); r.setRenderTarget(world.composer.readBuffer); const t0c = performance.now();
        await Promise.race([r.compileAsync(world.scene, world.camera), new Promise((res) => setTimeout(res, 60000))]); r.setRenderTarget(old); console.log('[game] shaders compiled ahead in ' + ((performance.now() - t0c) / 1000).toFixed(1) + ' s'); } catch (e) { console.log('[game] compile ahead skipped: ' + (e && e.message)); } }
    if (warm) try { await Promise.race([warm.finish(), new Promise((res) => setTimeout(res, 90000))]); } catch (e) {}     /* light lane: wait for the rest of that batch */
    // ... and they stay in the first drawn frames (they stand 50 m under the street), so their meshes are already on the graphics card at the first hit
    { let n = 0; const iv = setInterval(() => { if (++n > 40 || (!game.paused && n > 8)) { for (const f of figs) f.visible = false; clearInterval(iv); } }, 100); }
    if (window.__load) window.__load.stage = 'compiled'; if (window.__mark) window.__mark('compiled');
    const boot = document.getElementById('boot'), sb = document.getElementById('startbox'), pb = document.getElementById('playbtn');
    const skip = !sb || window.__noStart || (navigator.webdriver && P.get('start') !== '1') || P.has('demo') || P.has('capture') || P.has('play') || P.get('crowd') === 'none' || P.get('peds') === '0' || /^(demo|pad)/.test(P.get('heli') || '');
    if (skip) { boot.style.opacity = 0; setTimeout(() => boot.remove(), 700); }
    else { boot.style.background = 'rgba(11,12,14,.86)'; boot.style.zIndex = 100; const hudEls = [document.getElementById('hud'), game.hud && game.hud.canvas].filter(Boolean); for (const h of hudEls) h.style.visibility = 'hidden'; window.__hudEls = hudEls; document.getElementById('bootmsg').style.display = 'none'; window.__warming = true; if (window.__load) window.__load.stage = 'warming';
      // Nov 12 (public traces: the page froze for 8 to 66 s right AFTER Play on a first visit, as long as the compile step itself): compiling ahead only
      // covers the programs of one pass; the street mirror, the shadow pass and everything first seen in the second frame were built, and every
      // texture and mesh sent to the graphics card, in the first frames of play. The game now really draws behind this screen, and Play goes live
      // only once the frames run short and no new program has appeared for a second (at most 150 s; ?warm=0 the old way).
      const arm = () => { window.__warming = false; game.paused = true; pb.disabled = false; pb.style.opacity = 1; pb.textContent = 'PLAY'; window.__startScreen = true; if (window.__mark) window.__mark('warm'); };
      window.__armPlay = () => { if (P.get('warm') === '0') { setTimeout(arm, 400); return; } const t0w = performance.now(); let lastT = t0w, n = 0, okN = 0, progN = -1, progT = t0w, baseT = 0;
        const tick = (now) => { const dt = now - lastT; lastT = now; n++; okN = dt < 120 ? okN + 1 : 0; const pn = renderer.info.programs ? renderer.info.programs.length : 0; if (pn !== progN) { progN = pn; progT = now; }
          /* light lane, Nov 15: with the street mirror's programs linked ahead (src/warmup.js) the rule below is met BEFORE the landmark buildings arrive (they load after ready), and their programs would then be built in the first seconds of play. Until now the mirror's own stream of new programs happened to bridge that gap. So Play also waits for the landmarks, at most 12 s past the old rule; ?warmhero=0 or ?warmup=0 = the old rule alone */
          const base = n >= 45 && (okN >= 20 || (document.hidden && window.__hidwarm && now - progT > 3000)) /* perf lane: a hidden tab's frames are never short (src/hidwarm.js) */ && now - progT > 1000 && !(warm && warm.S.ramping);     /* light handoff15: not while the first frames are still letting the scene in batch by batch (warmup.js ramp; ?warmramp=0) */ if (base && !baseT) baseT = now; const hs = world.heroState, hold = warm && P.get('warmhero') !== '0' && baseT && hs && hs.late && !hs.done && now - baseT < 12000;
          if ((base && !hold) || now - t0w > 150000) { console.log('[game] warm-up: ' + n + ' frames in ' + ((now - t0w) / 1000).toFixed(1) + ' s, ' + pn + ' programs'); arm(); } else requestAnimationFrame(tick); };
        requestAnimationFrame(tick); };
      const go = () => { if (!window.__startScreen) return; window.__startScreen = false; if (window.__mark) window.__mark('play'); game.paused = false; for (const h of window.__hudEls || []) h.style.visibility = ''; boot.style.opacity = 0; setTimeout(() => boot.remove(), 500); try { game.sound.unlock(); } catch (e) {} try { game.look.ask('play'); } catch (e) {} };
      if (P.get('playgate') !== '0') try { (await import('./playgate.js')).install({ game, world, renderer, warm, P, arm, go, pb, boot }); } catch (e) { console.log('[game] playgate not installed: ' + (e && e.message)); }     /* progress lane, Nov 15: PLAY lights earlier, also for a tab that was hidden, and is plainer once lit (src/playgate.js; on only with ?playgate=1; to make it the default change === '1' to !== '0') */
      pb.addEventListener('click', go); { const pv = setInterval(() => { if (!window.__startScreen) { clearInterval(pv); return; } try { for (const q of navigator.getGamepads ? navigator.getGamepads() : []) if (q && q.connected && q.buttons.some((b, i) => (i === 0 || i === 9) && b.pressed)) { go(); break; } } catch (e) {} }, 120); }     /* a controller's A or Start presses Play */ addEventListener('keydown', (e) => { if (window.__startScreen && (e.code === 'Enter' || e.code === 'Space')) { e.stopPropagation(); go(); } }, true); }
    if (P.has('capture')) { const { capture } = await import('./capture.js'); window.capture = (o) => capture(game, o); }
    window.__ready = true; if (window.__mark) window.__mark('ready'); window.__readyAt = +(performance.now() / 1000).toFixed(1); if (warm && warm.ramp && !skip) try { warm.ramp(figs); } catch (e) { console.log('[game] warm-up ramp not started: ' + (e && e.message)); }     /* light handoff15: behind the start screen the first frames let the scene in a few shader programs at a time, so a first visit has no 9 s frozen frame (src/warmup.js; ?warmramp=0 = all at once) */ game.start(); memfree.start(world); if (window.__armPlay) window.__armPlay();
  }
} catch (e) { msg.textContent = 'error: ' + e.message; console.error(e); window.__error = String(e.stack || e); LR.fail(e); }
