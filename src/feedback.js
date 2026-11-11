// feedback.js (lead, Nov 11; Matt: "a way for ppl to write in and submit feedback that we collect, along with game traces that allow us to fix
// the issues"). A "Feedback" link bottom-right opens a small form; Send posts the note with a trace of the session to /api/feedback (same
// origin: a Cloudflare Worker on the public link, tools/serve_nocache.py on the private one). What is sent is said on the form in one line.
// The trace: build id, page address, browser and graphics card, screen and picture size, quality tier, frame rate once a second for the last
// 3 minutes, where the player and camera are, what he is in, the last 80 game key and mouse-button events (codes and times, never typed text),
// the last 60 errors and warnings, load time, and a small screenshot. No cookies, no ids; the server keeps no IP address.
const T0 = performance.now(), fps = [], inputs = [], errs = [], logs = [], replay = [], hitches = [], net = [], hist = new Array(12).fill(0); let game = null, world = null, frames = 0;
const push = (a, v, n) => { a.push(v); if (a.length > n) a.shift(); }, sec = () => +((performance.now() - T0) / 1000).toFixed(1);
const txt = (x) => { try { if (x && typeof x === 'object' && !x.stack && (x.name || x.message || x.type)) return [x.constructor && x.constructor.name, x.name, x.message, x.type, x.target && (x.target.id || x.target.tagName || x.target.src)].filter(Boolean).join(' ').slice(0, 300); return (x && x.stack) ? String(x.stack).slice(0, 1500) : typeof x === 'string' ? x.slice(0, 400) : JSON.stringify(x).slice(0, 300); } catch (e) { return String(x).slice(0, 200); } };
addEventListener('error', (e) => push(errs, [sec(), 'error', txt(e.error || e.message), (e.filename || '').split('/').slice(-2).join('/') + ':' + (e.lineno || '')], 60));
addEventListener('unhandledrejection', (e) => push(errs, [sec(), 'rejection', txt(e.reason)], 60));
for (const k of ['error', 'warn']) { const f = console[k].bind(console); console[k] = (...a) => { push(errs, [sec(), k, a.map(txt).join(' ').slice(0, 900)], 100); f(...a); }; }
{ const f = console.log.bind(console); console.log = (...a) => { const s = a.map(txt).join(' '); push(logs, [sec(), s.slice(0, 300)], 200); f(...a); }; }
const inForm = (e) => e.target && e.target.closest && e.target.closest('#fbbox');
addEventListener('keydown', (e) => { if (!e.repeat && !inForm(e)) push(inputs, [sec(), 'd', e.code], 80); }, true);
addEventListener('keyup', (e) => { if (!inForm(e)) push(inputs, [sec(), 'u', e.code], 80); }, true);
addEventListener('mousedown', (e) => { if (!inForm(e)) push(inputs, [sec(), 'd', 'Mouse' + e.button], 80); }, true);
setInterval(() => { if (game) push(fps, Math.round(game.fps || 0), 180); }, 1000);
// when the window lost and regained focus or was hidden: a long gap between frames then means "in the background", not a freeze
const away = []; for (const ev of ['focus', 'blur']) addEventListener(ev, () => push(away, [sec(), ev], 60)); document.addEventListener('visibilitychange', () => push(away, [sec(), document.hidden ? 'hidden' : 'visible'], 60));
// the last 30 s as a replay, 10 times a second: [t, x, y, heading, camera yaw, camera pitch, km/h, what he is in, keys held, alt, fps]
const held = new Set(); addEventListener('keydown', (e) => { if (!inForm(e)) held.add(e.code); }, true); addEventListener('keyup', (e) => held.delete(e.code), true); addEventListener('blur', () => held.clear());
const r2 = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : null);
setInterval(() => { if (!game || !game.player || game.paused) return; const g = game, pl = g.player, v = pl.vehicle, hl = g.heli && g.heli.piloted ? g.heli.f : null, c = g.cam || {};
  push(replay, [sec(), r2(hl ? hl.pos.x : v ? v.x : pl.x), r2(hl ? -hl.pos.z : v ? v.y : pl.y), r2(hl ? hl.heading : v ? v.h : pl.h), r2(c.yaw), r2(c.pitch), v ? Math.round(Math.abs(v.vf || 0) * 3.6) : hl ? Math.round(Math.hypot(hl.vel ? hl.vel.x : 0, hl.vel ? hl.vel.z : 0) * 3.6) : r2(pl.speed), hl ? 'heli' : v ? 'car' : (g.fly && g.fly.on) ? 'fly' : 'foot', [...held].map((k) => k.replace(/^(Key|Digit|Arrow)/, '')).join('+'), hl ? r2(hl.pos.y) : null, Math.round(g.fps || 0)], 300); }, 100);
// frame times: a histogram (ms buckets) and the 12 worst hitches of the last 3 minutes with when they happened
{ const B = [8, 12, 17, 20, 25, 33, 50, 67, 100, 200, 500]; let last = 0; const tick = (now) => { requestAnimationFrame(tick); if (last && !document.hidden) { const d = now - last; frames++; let i = 0; while (i < B.length && d > B[i]) i++; hist[i]++; if (d > 50) { hitches.push([sec(), Math.round(d)]); if (hitches.length > 60) { hitches.sort((a, b) => b[1] - a[1]); hitches.length = 12; } } } last = now; }; requestAnimationFrame(tick); window.__ftBuckets = B; }
// long tasks: every time the page's main thread was busy for over 0.2 s (what a freeze is made of), with when and how long
const longs = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 200) push(longs, [+(e.startTime / 1000).toFixed(1), Math.round(e.duration)], 80); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
const marks = {}; window.__mark = (k) => { if (!(k in marks)) marks[k] = +(performance.now() / 1000).toFixed(1); };
// network: requests that failed or took over 4 s (names and times only)
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { const bad = e.responseStatus >= 400 || e.duration > 4000; if (bad) push(net, [+(e.startTime / 1000).toFixed(1), e.name.split('/').slice(-3).join('/').slice(0, 90), Math.round(e.duration), e.responseStatus || 0, Math.round((e.transferSize || 0) / 1024)], 60); } }).observe({ type: 'resource', buffered: true }); } catch (e) {}
function caps() { try { const gl = world.renderer.getContext(), c = world.renderer.capabilities, x = gl.getExtension('WEBGL_debug_renderer_info'); return { version: gl.getParameter(gl.VERSION), vendor: x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), maxTexture: c.maxTextureSize, maxCube: c.maxCubemapSize, maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), maxSamples: c.maxSamples, maxAnisotropy: c.getMaxAnisotropy(), maxVertexTextures: c.maxVertexTextures, floatTargets: !!gl.getExtension('EXT_color_buffer_float'), compressed: ['astc', 'bptc', 's3tc', 'etc'].filter((k) => gl.getExtension('WEBGL_compressed_texture_' + k) || gl.getExtension('EXT_texture_compression_' + k)), extensions: gl.getSupportedExtensions(), drawing: [gl.drawingBufferWidth, gl.drawingBufferHeight], lost: gl.isContextLost() }; } catch (e) { return { error: String(e).slice(0, 100) }; } }
function gpu() { try { const gl = world.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return 'unknown'; } }
function shot() { try { const c = world.renderer.domElement; world.render(game.t || 0); const k = Math.min(1, 960 / c.width), d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); return d.toDataURL('image/jpeg', 0.6); } catch (e) { return null; } }
export function trace() {
  const g = game || {}, w = world || {}, pl = g.player || {}, cam = w.camera, v = pl.vehicle, r1 = (x) => (typeof x === 'number' ? +x.toFixed(1) : x);
  return { build: window.__build || null, url: location.origin + location.pathname + location.search, at: new Date().toISOString(), upSecs: sec(), readySecs: window.__readyAt || null,
    ua: navigator.userAgent, lang: navigator.language, gpu: gpu(), cores: navigator.hardwareConcurrency || null, memGB: navigator.deviceMemory || null,
    screen: [screen.width, screen.height, devicePixelRatio], picture: w.renderer ? [w.renderer.domElement.width, w.renderer.domElement.height] : null,
    tier: { scale: r1(w.liveScale || 1), aa: w.liveAA || 'msaa', ao: !!(w.gtao && w.gtao.enabled) }, fps, fpsNow: Math.round(g.fps || 0),
    player: { x: r1(pl.x), y: r1(pl.y), h: r1(pl.h), in: v ? 'car:' + ((v.def && v.def.name) || '') : (g.heli && g.heli.piloted) ? 'helicopter' : (g.fly && g.fly.on) ? 'fly' : 'foot', kmh: v ? Math.round(Math.abs(v.vf || 0) * 3.6) : null, alt: g.heli && g.heli.piloted ? r1(g.heli.f.pos.y) : null },
    camera: cam ? { p: cam.position.toArray().map(r1), fov: r1(cam.fov), near: r1(cam.near) } : null, gun: g.combat ? g.combat.slot || null : null, job: g.missions ? String(g.missions.state || '') : null, cash: g.missions ? g.missions.cash : null,
    mouseCaptured: !!document.pointerLockElement, visible: !document.hidden, focused: document.hasFocus(), away, params: Object.fromEntries(new URLSearchParams(location.search)), settings: { paused: !!g.paused, muted: !!(g.sound && g.sound.muted), ktx: !!window.__ktx2list, cfg: window.__CFG || null, heli: !!g.heli, guns: !!g.combat, crowd: !!g.crowd },
    load: window.__load ? { MB: +(window.__load.done / 1e6).toFixed(1), files: window.__load.files, failed: window.__load.failed, secs: window.__readyAt || null } : null,
    render: w.renderer ? { calls: w.renderer.info.render.calls, triangles: w.renderer.info.render.triangles, textures: w.renderer.info.memory.textures, geometries: w.renderer.info.memory.geometries, programs: (w.renderer.info.programs || []).length } : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    frames: { count: frames, bucketsMs: window.__ftBuckets, histogram: hist, worstHitches: hitches.slice().sort((a, b) => b[1] - a[1]).slice(0, 12) },
    replay: { everyMs: 100, fields: ['t', 'x', 'y', 'heading', 'camYaw', 'camPitch', 'kmh', 'in', 'keys', 'alt', 'fps'], samples: replay },
    longTasks: longs, marks,
    webgl: caps(), network: net, inputs, errors: errs, log: logs };
}
export function install(g) {
  game = g; world = g.world; window.__trace = trace;
  if (/capture|shot|crowd=none/.test(location.search) || document.getElementById('fblink')) return;
  const css = 'position:fixed;z-index:60;font:12px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000';
  const l = document.createElement('a'); l.id = 'fblink'; l.href = '#'; l.textContent = 'Feedback'; l.style.cssText = css + ';right:12px;bottom:8px;opacity:.85;text-decoration:underline;cursor:pointer'; document.body.appendChild(l);
  const b = document.createElement('div'); b.id = 'fbbox'; b.style.cssText = 'display:none;position:fixed;right:12px;bottom:34px;z-index:71;width:340px;max-width:92vw;background:rgba(14,16,20,.96);color:#e8e8e8;font:13px/1.45 system-ui,sans-serif;border-radius:8px;padding:12px;box-shadow:0 6px 30px rgba(0,0,0,.5)';
  b.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Tell us what went wrong or what you want</div><textarea id="fbtext" maxlength="2000" rows="5" style="width:100%;box-sizing:border-box;background:#1b1e24;color:#fff;border:1px solid #3a3f49;border-radius:6px;padding:6px;font:inherit" placeholder="What happened? What were you doing?"></textarea><input id="fbmail" type="email" maxlength="120" placeholder="Email (optional, only if you want a reply)" style="width:100%;box-sizing:border-box;margin-top:6px;background:#1b1e24;color:#fff;border:1px solid #3a3f49;border-radius:6px;padding:6px;font:inherit"><div style="font-size:11px;opacity:.75;margin:6px 0">Sent with your note: build, browser and graphics card, frame rate, where you are in the game, your last key presses in the game, error messages and a screenshot. No IP address is kept.</div><button id="fbsend" style="background:#ffd27a;color:#111;border:0;border-radius:6px;padding:6px 14px;font:600 13px system-ui;cursor:pointer">Send</button> <a id="fbclose" href="#" style="color:#bbb;margin-left:8px">Close</a> <span id="fbmsg" style="margin-left:8px;font-size:12px"></span>';
  document.body.appendChild(b); const $ = (id) => document.getElementById(id);
  for (const ev of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'wheel']) b.addEventListener(ev, (e) => e.stopPropagation());     // typing in the form must not drive the game
  l.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); b.style.display = b.style.display === 'none' ? 'block' : 'none'; if (b.style.display === 'block') { b._shot = shot(); $('fbmsg').textContent = ''; $('fbtext').focus(); } });
  $('fbclose').addEventListener('click', (e) => { e.preventDefault(); b.style.display = 'none'; });
  $('fbsend').addEventListener('click', async () => { const text = $('fbtext').value.trim(); if (!text) { $('fbmsg').textContent = 'Write a line first.'; return; } $('fbsend').disabled = true; $('fbmsg').textContent = 'Sending...';
    try { const body = JSON.stringify({ text, email: $('fbmail').value.trim().slice(0, 120), trace: trace(), screenshot: b._shot || shot() }), to = (window.__CFG && window.__CFG.feedbackUrl) || 'api/feedback';
      // the public feedback service sleeps when idle and can take most of a minute to wake: wait up to 90 s, and try once more if the first try fails
      const post = async () => { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 90000); try { const r = await fetch(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ac.signal }); if (!r.ok) throw new Error('server said ' + r.status); } finally { clearTimeout(tm); } };
      const slow = setTimeout(() => { $('fbmsg').textContent = 'Sending... (waking the server, up to a minute)'; }, 4000);
      try { try { await post(); } catch (e1) { $('fbmsg').textContent = 'Trying again...'; await post(); } } finally { clearTimeout(slow); }
      $('fbmsg').textContent = 'Sent. Thank you.'; $('fbtext').value = ''; setTimeout(() => { b.style.display = 'none'; }, 1600); } catch (e) { $('fbmsg').textContent = 'Could not send (' + e.message + '). Try again in a minute.'; } $('fbsend').disabled = false; });
  // B opens the form at any time (it frees the mouse first): the start screen tells players so
  addEventListener('keydown', (e) => { if (e.code !== 'KeyB' || e.repeat || inForm(e) || window.__startScreen) return; try { document.exitPointerLock && document.exitPointerLock(); } catch (err) {} b.style.display = 'block'; b._shot = shot(); $('fbmsg').textContent = ''; setTimeout(() => $('fbtext').focus(), 30); e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => { l.style.display = document.pointerLockElement ? 'none' : ''; if (document.pointerLockElement) b.style.display = 'none'; });
}
