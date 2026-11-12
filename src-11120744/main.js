import './feedback.js';     // first: its error, console and frame-time recorders run from the first line of the load (the Feedback form is installed by game.js)
// Loading progress (Matt, Nov 11: "it's not really clear that it's loading"): every same-origin download is counted as its bytes arrive, so the
// start screen shows a real bar: percent, MB done of the build's measured total (assets/loadtotal.json, written by tools/loadmeasure.mjs) and what
// is coming in now. After the downloads the city is built on the graphics card; the bar says so and its stripe keeps moving, so it never looks frozen.
{ const L = (window.__load = { done: 0, total: 0, files: 0, failed: 0, now: '', stage: 'starting', t0: performance.now() }), plain0 = window.fetch.bind(window);
  const what = (u) => (/city\.glb|far\.glb/.test(u) ? 'buildings' : /hero\//.test(u) ? 'landmarks' : /crowd|people/.test(u) ? 'people' : /streets\/vehicles|openx/.test(u) ? 'cars' : /streets\//.test(u) ? 'streets' : /light\/|sky/.test(u) ? 'sky' : /panels|tex\//.test(u) ? 'walls' : /heli/.test(u) ? 'helicopter' : /combat|entry/.test(u) ? 'gear' : /\.js/.test(u) ? 'code' : 'city data');
  plain0('assets/loadtotal.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.bytes) L.total = j.bytes; }).catch(() => {});
  // Behind Cloudflare's proxy only some file types are kept at the edge (.bin, .gz, .js, .jpg, .webp ...). The public build can therefore ship
  // its models and textures with ".bin" added to the name (window.__CFG.bin, set by tools/public_build.sh); every request for such a file is sent there.
  const BINRE = /\.(glb|ktx2|hdr|opus|wasm|p\d)(\?.*)?$/, binOn = !!(window.__CFG && window.__CFG.bin);
  window.fetch = async (u, o) => { if (u instanceof URL) u = u.href; else if (typeof Request !== 'undefined' && u instanceof Request && u.method === 'GET') { o = o || { headers: u.headers, credentials: u.credentials, signal: u.signal }; u = u.url; }     /* three's loaders pass a Request */
    let url = typeof u === 'string' ? u : (u && u.url) || '';
    if (binOn && typeof u === 'string' && BINRE.test(u) && !/^(data|blob):/.test(u)) { u = u.replace(BINRE, '.$1.bin$2'); url = u; }
    if ((o && o.method && o.method !== 'GET') || /^(data|blob):/.test(url) || /api\/|build\.txt|loadtotal/.test(url) || window.__ready) return plain0(u, o);
    let r; try { r = await plain0(u, o); } catch (e) { L.failed++; throw e; } if (!r.ok) { if (!/\.gz(\.p\d+(\.bin)?)?$|people\.json/.test(url)) L.failed++; return r; } if (!r.body) return r; L.files++; L.now = what(url);
    const rd = r.body.getReader(); return new Response(new ReadableStream({ async pull(c) { try { const { done, value } = await rd.read(); if (done) { c.close(); return; } L.done += value.byteLength; L.last = performance.now(); c.enqueue(value); } catch (e) { L.failed++; c.error(e); } }, cancel(why) { return rd.cancel(why); } }), { status: r.status, statusText: r.statusText, headers: r.headers }); };
  const ui = setInterval(() => { const bar = document.getElementById('loadbar'), txt = document.getElementById('loadtxt'); if (!bar) { if (window.__ready) clearInterval(ui); return; }
    if (window.__ready) { bar.style.width = '100%'; txt.textContent = 'Ready'; document.getElementById('loadwrap').style.opacity = 0; clearInterval(ui); return; }
    const tot = Math.max(L.total || 250e6, L.done * 1.02), pct = Math.min(99, Math.floor(L.done / tot * 100)), mb = (x) => Math.round(x / 1e6), secs = (performance.now() - L.t0) / 1000;
    const building = (L.total && L.done >= L.total * 0.985) || (/game|compiled/.test(L.stage) && performance.now() - (L.last || 0) > 1500);
    bar.style.width = (building ? 99 : Math.max(2, pct)) + '%'; txt.textContent = building ? '99% · ' + mb(L.done) + ' MB in · building the city on your graphics card (' + Math.round(secs) + ' s)' : pct + '% · ' + mb(L.done) + ' of ' + mb(tot) + ' MB · loading ' + (L.now || 'the city') + (L.failed ? ' · ' + L.failed + ' failed' : ''); }, 150); }
import * as THREE from 'three';
import { World } from './world.js';
import { memfree } from './memfree.js';     // audit lane, Nov 11: frees the page's copies of vertex arrays and texture data after upload (?memfree=0 off)

const P = new URLSearchParams(location.search);
// Big plain-data files are served gzip-packed (the link's uplink is ~2 MB/s): any fetch of these names reads <name>.gz and unpacks it in the page, falling back to the plain file.
{ const plain = window.fetch.bind(window), packed = /(dressing\.bin|city\.json)$/;
  window.fetch = async (u, o) => { if (typeof u === 'string' && packed.test(u) && self.DecompressionStream && !(o && o.method && o.method !== 'GET')) { try { const r = await plain(u + '.gz', o); if (r.ok) return new Response(r.body.pipeThrough(new DecompressionStream('gzip')), { status: 200 }); } catch (e) {} } return plain(u, o); }; }
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
{ const sb = document.getElementById('startbox'); if (sb && !window.__noStart && !navigator.webdriver && !/[?&](demo|capture|shot|play)\b|crowd=none|peds=0/.test(location.search)) { sb.style.display = 'block'; const bm = document.getElementById('bootmsg'); if (bm) bm.style.display = 'none'; } }     // the start text shows while the game loads
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: P.has('shot') || P.has('capture') });
// If the graphics driver resets or runs out of memory the browser takes the WebGL context away and the picture goes white (first Linux report,
// Nov 11). Say so plainly instead of leaving a white page; the Feedback form still works and its trace records the loss.
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (window.__mark) window.__mark('contextLost'); if (document.getElementById('ctxlost')) return; const d = document.createElement('div'); d.id = 'ctxlost';
  d.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(11,12,14,.93);color:#eee;font:15px/1.6 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px';
  d.innerHTML = '<div style="max-width:32em"><b>The graphics card stopped drawing.</b><br>The browser took the 3D picture away: usually the graphics driver reset or ran out of memory (the game needs about 1.5 GB of graphics memory).<br><br><a href="" style="color:#ffd27a">Reload the page</a> &nbsp; Closing other tabs and games first helps. Press <b>B</b> to tell us what happened: the report includes what we need to look into it.</div>'; document.body.appendChild(d); try { document.exitPointerLock(); } catch (err) {} });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
memfree.lean(renderer); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await (await import('./ktx2hook.js')).installKTX2(renderer);     // lead, Nov 10: Basis/KTX2 textures (see ktx2hook.js)
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
  await world.load((s) => { msg.textContent = s; if (window.__load) window.__load.stage = s; }); if (window.__load) window.__load.stage = 'game';
  fit(); addEventListener('resize', fit);
  if (P.has('shot')) {
    // ?shot=x,y,z,tx,ty,tz[,fov]: a still from a fixed camera (map metres: x east, y up, z north)
    const setCam = (a) => { world.camera.position.set(a[0], a[1], -a[2]); world.camera.lookAt(a[3], a[4], -a[5]); world.camera.fov = a[6] || 55; world.camera.updateProjectionMatrix(); };
    window.shot = (a) => { setCam(a); for (let i = 0; i < 3; i++) world.render(i / 60, new THREE.Vector3(a[3], 0, -a[5])); return true; };
    window.shot(P.get('shot').split(',').map(Number));
    document.getElementById('boot').remove(); window.__ready = true; if (window.__mark) window.__mark('ready'); window.__readyAt = +(performance.now() / 1000).toFixed(1);
  } else {
    const { Game } = await import('./game.js');
    const game = new Game(world, P); window.game = game; await game.init();
    // Start screen (Matt, Nov 11): before play, a short note that this is an early preview, how to give feedback, a Play button and a tiny credits
    // link. Skipped for films, stills, judged captures and test tools (?demo ?capture ?peds=0 ?crowd=none ?play=1, or window.__noStart set by a tool).
    // Before Play goes live, the shaders are compiled in the background (the browser's parallel compile where it has one) while the loading bar
    // says so. Without this the first frames after Play froze the page for many seconds (3 s on our laptops, 20 to 40 s in the first outside traces).
    // The figures a struck person turns into (pedhit.js) are part of this: they sit hidden in the scene, and compiled only on the first hit, in the
    // wrong render state, they cost that hit a 120-150 ms hitch ("when i hit someone in a car it freezes the game", Nov 11).
    const figs = []; try { if (game.__pedhit && game.__pedhit.warm) for (const o of game.__pedhit.warm()) { let r0 = o; while (r0.parent && r0.parent !== world.scene) r0 = r0.parent; if (!figs.includes(r0)) figs.push(r0); } for (const f of figs) f.visible = true; } catch (e) {}
    if (!P.has('nocompile')) { try { const r = renderer, old = r.getRenderTarget(); r.setRenderTarget(world.composer.readBuffer); const t0c = performance.now();
        await Promise.race([r.compileAsync(world.scene, world.camera), new Promise((res) => setTimeout(res, 60000))]); r.setRenderTarget(old); console.log('[game] shaders compiled ahead in ' + ((performance.now() - t0c) / 1000).toFixed(1) + ' s'); } catch (e) { console.log('[game] compile ahead skipped: ' + (e && e.message)); } }
    // ... and they stay in the first drawn frames (they stand 50 m under the street), so their meshes are already on the graphics card at the first hit
    { let n = 0; const iv = setInterval(() => { if (++n > 40 || (!game.paused && n > 8)) { for (const f of figs) f.visible = false; clearInterval(iv); } }, 100); }
    if (window.__load) window.__load.stage = 'compiled';
    const boot = document.getElementById('boot'), sb = document.getElementById('startbox'), pb = document.getElementById('playbtn');
    const skip = !sb || window.__noStart || navigator.webdriver || P.has('demo') || P.has('capture') || P.has('play') || P.get('crowd') === 'none' || P.get('peds') === '0' || /^(demo|pad)/.test(P.get('heli') || '');
    if (skip) { boot.style.opacity = 0; setTimeout(() => boot.remove(), 700); }
    else { boot.style.background = 'rgba(11,12,14,.86)'; boot.style.zIndex = 100; const hudEls = [document.getElementById('hud'), game.hud && game.hud.canvas].filter(Boolean); for (const h of hudEls) h.style.visibility = 'hidden'; window.__hudEls = hudEls; document.getElementById('bootmsg').style.display = 'none'; pb.disabled = false; pb.style.opacity = 1; pb.textContent = 'PLAY'; window.__startScreen = true; setTimeout(() => { if (window.__startScreen) game.paused = true; }, 400);
      const go = () => { if (!window.__startScreen) return; window.__startScreen = false; if (window.__mark) window.__mark('play'); game.paused = false; for (const h of window.__hudEls || []) h.style.visibility = ''; boot.style.opacity = 0; setTimeout(() => boot.remove(), 500); try { game.sound.unlock(); } catch (e) {} try { const pr = canvas.requestPointerLock && canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} };
      pb.addEventListener('click', go); { const pv = setInterval(() => { if (!window.__startScreen) { clearInterval(pv); return; } try { for (const q of navigator.getGamepads ? navigator.getGamepads() : []) if (q && q.connected && q.buttons.some((b, i) => (i === 0 || i === 9) && b.pressed)) { go(); break; } } catch (e) {} }, 120); }     /* a controller's A or Start presses Play */ addEventListener('keydown', (e) => { if (window.__startScreen && (e.code === 'Enter' || e.code === 'Space')) { e.stopPropagation(); go(); } }, true); }
    if (P.has('capture')) { const { capture } = await import('./capture.js'); window.capture = (o) => capture(game, o); }
    window.__ready = true; if (window.__mark) window.__mark('ready'); window.__readyAt = +(performance.now() / 1000).toFixed(1); game.start(); memfree.start(world);
  }
} catch (e) { msg.textContent = 'error: ' + e.message; console.error(e); window.__error = String(e.stack || e); }
