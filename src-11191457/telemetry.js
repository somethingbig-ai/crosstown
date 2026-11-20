// telemetry.js (progress lane, Nov 14; Matt: "especially knowing when it breaks, hell yeah"). Automatic, anonymous reports from a player's
// browser, so we hear that the game broke or ran badly without the player doing anything. Posted as small JSON to the sibling of the
// feedback address (api/feedback -> api/telemetry; same servers). Four kinds:
//   error     a JS error or unhandled promise rejection: message, stack, file:line, how often. One report per DIFFERENT error (an error
//             thrown every frame sends once, with its count after one second), at most 10 different errors a page load.
//   ctxlost   the browser took the WebGL context away (or gave it back); WebGPU device loss too if the renderer ever has a device.
//   reload    this load of the page follows one that never said goodbye (a tab the browser killed for memory, a crashed tab).
//   summary   once the player has played 3 minutes, again at 15, and whenever the tab is hidden or closed: frame-time median, 1% low,
//             hitches, time to ready, time in play, quality tier, screen and picture size.
// With an error, ctxlost or reload report ONLY (never with a summary; at most 3 a page load) also go:
//   log    the last 60 s of play: feedback.js's 10-a-second replay samples (position, heading, camera yaw and pitch, speed, what he is in,
//          keys held) and its last 400 key / mouse-button events (codes and times, never typed text), plus this module's twice-a-second
//          snapshot of the 12 nearest bodies (traffic cars, other vehicles, pedestrians, people down, police) with his car's damage and the
//          police level. About 60 KB. src/replay.js (?replay=<file>) plays it back in our build.
//   shot   ONE picture of the game canvas (JPEG, at most 960 wide, about 100-200 KB), drawn and read in one task just after the error. The
//          canvas only: no page text, no HUD, no form. None on a lost context (there is nothing to read) and none with a reload report.
// For the reload report the log is parked in sessionStorage every 10 s (this tab only, gone when the tab closes; no id in it).
// Nov 14, second round (six hours of real reports showed what they could not answer):
//   LOAD SPLIT   every summary says where the load stood: seconds to first byte, world built, game set up, shaders compiled, ready, warm; bytes
//                in and of how many, files failed, the stage and the percent the loading bar showed, seconds the tab was hidden during the
//                load, the connection class the browser reports ('4g', megabits rounded), how many files came from the browser's cache, and
//                which summary of this load it is. Sent as ONE short plain string in the field `reason` (the servers already keep it) and
//                as the object `load` (kept once the servers know the name).
//   STUCK CAR    an 'error' report of kind 'stuck', once per street per page load (at most 4): the player's car has had a pedal down for most
//                of 15 s without leaving a 3 m circle, or the game's own unwedge.js decided it was wedged or at the map's edge. A FIXED
//                message per cause, the place in `at` ("x,y street, lanes, one-way"), what then happened in `why` (freed by the game, drove
//                off, got out, still there). It carries the replay log and the canvas picture like any error. The only report with a position
//                outside the log.
// Nov 15, third round (who stays): every summary also carries ONE short plain string in the field `at` (the servers already keep it; summaries
//   did not use it): "P1 e=10,2,1 a=30,58,24,3,1,180 b=90,60,33,5,2,140 in=car md=12,40,0,0,3 lw=1 cb=3 ch=42 bk=1".
//   e = the first 10 s of play: seconds in it so far, frames over 50 ms, over 100 ms (so that a player who left after 12 s can be set beside one who stayed);
//   a = the FIRST 30 s of play on their own: seconds in it so far, median fps, 1% low fps, frames over 50 ms, over 100 ms, the longest frame (ms);
//   b = the same for seconds 30-120 of play, once reached; in = what he was in at the last second of play (foot, car, heli, sub), pz=1 when the
//   game was paused (menu, map) at the last second the tab was seen; md = seconds so far on foot, in a car, in the helicopter, in the subway,
//   paused; lw = src/loadwait.js was there; cb = its call-back title was shown (1 "almost ready", 2 "ready to play", 3 both); ch = seconds from
//   the call-back's start to the tab coming back (or to this summary); bk = 1 the tab came back after it. pg = src/playgate.js's own record when
//   it is there (absent = nothing sent): on (1/0), seconds on the page's clock when PLAY lit, what lit it (rule, early, return, cap), seconds when
//   Play was pressed; x = not yet. Numbers and nine fixed words only.
// Every report carries: build id, graphics card string, browser string, and a random id made new on every page load and kept only in
// this page's memory (it joins an error to its summary; it is never stored in the browser).
// PRIVACY: nothing that identifies a player. No cookie (credentials are left out), no referrer, no page address or query string, no
// typed text, no clock time (key codes, position and a picture of the game canvas go only with an error report, as said above), no language, no stored id. Addresses in messages and stacks are
// cut down to our own file names (src/game.js:10:5); other sites, browser extensions, disk paths and e-mail addresses are blanked.
// The servers store no IP address and scrub every string again.
// OFF: ?telemetry=0 (the module is not even fetched), or game.settings 'telemetry' = false when the menu has it. Test tools send nothing:
// navigator.webdriver, tools/drive.mjs (window.__noStart), ?capture ?shot ?demo, and pages on localhost / 127.0.0.1. ?telemetry=1 forces it on.
// COST: no per-frame code at all. One timer a second (a dozen additions) and one twice a second (a pass over the cars and people into a
// fixed Int16 ring: no allocation); the frame histogram, fps samples, replay samples, inputs, marks and gpu() are feedback.js's.
import { rec } from './feedback.js';

const Q = new URLSearchParams(location.search), FORCE = Q.get('telemetry') === '1';
const OFF = Q.get('telemetry') === '0' || (!FORCE && (navigator.webdriver || window.__noStart || Q.has('capture') || Q.has('shot') || Q.has('demo') || Q.has('replay') || !/^https?:$/.test(location.protocol) || /^(localhost$|127\.|0\.0\.0\.0$|\[)/.test(location.hostname)));
const TO = String((window.__CFG && window.__CFG.feedbackUrl) || 'api/feedback').replace(/feedback\/?$/, 'telemetry');
const post = window.fetch.bind(window), KEEP = typeof Request !== 'undefined' && 'keepalive' in Request.prototype;
const T0 = performance.now(), sec = () => Math.round((performance.now() - T0) / 100) / 10;
const sid = (() => { const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); })();
const MAX_SENDS = 30, MAX_BIG = 3, MAX_ERRORS = 10, MAX_SUMMARIES = 11, MAX_CTX = 4, FIRST_SUMMARY = +(Q.get('tmsum') || 180), SECOND_SUMMARY = 900, STUCK_SECS = +(Q.get('tmstuck') || 15);
const ROOT = new URL('..', import.meta.url).href, CODE = (/\/(src-\d+)\/[^/]*$/.exec(import.meta.url) || [])[1] || null;

// ---- what leaves the page is cleaned here: addresses down to our own file names, no query strings, no disk paths, no e-mail addresses
export function scrub(s, n = 300) {
  s = String(s == null ? '' : s).slice(0, n * 4);
  s = s.replace(/\b(?:blob:)?[a-z][a-z0-9+.-]*:\/\/[^\s)'"<>]+/gi, (m) => {
    const tail = (/(?::\d+){1,2}$/.exec(m) || [''])[0], u = (tail ? m.slice(0, -tail.length) : m).replace(/^blob:/i, '');
    const own = u.startsWith(ROOT) ? u.slice(ROOT.length) : u.startsWith(location.origin + '/') ? u.slice(location.origin.length + 1) : null;
    if (own === null) return (/^(chrome|moz|safari-web)-extension|^webkit-masked/i.test(u) ? '<extension>' : '<url>') + (/^\d/.test(tail.slice(1)) && u.includes('/', u.indexOf('//') + 2) ? tail : '');
    return own.split(/[?#]/)[0].replace(/^src-\d+\//, 'src/') + tail; });
  s = s.replace(/(?:\b[A-Za-z]:\\|\\\\|\/(?:Users|home|root|var|private|tmp|Volumes|mnt|media|opt|usr|etc|Library|Applications|data|storage|sdcard)\/)[^\s)'"<>:]*/g, '<path>');
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>').replace(/[?&][\w.%-]+=[^\s&)'"<>]*/g, '');
  return s.slice(0, n);
}
const top = (stack) => { for (const l of String(stack || '').split('\n')) { const m = /((?:src|node_modules)\/[\w./-]+\.js):(\d+)/.exec(l); if (m && !m[1].startsWith('node_modules')) return m[1] + ':' + m[2]; } return ''; };

// ---- sending: a small POST that survives the page closing; no cookies, no referrer; text/plain so that the other-origin service needs no preflight
let sends = 0, seq = 0, bigs = 0, stuckBigs = 0, lastBytes = 0;
const allowed = () => { try { const g = window.game; return !(g && g.settings && g.settings.get('telemetry', true) === false); } catch (e) { return true; } };
function send(o) {
  if (OFF || sends >= MAX_SENDS || !allowed()) return false;
  try { const body = JSON.stringify(o), isBig = body.length > 14000; if (body.length > 680000) return false; sends++; lastBytes = body.length;
    if (isBig) post(TO, { method: 'POST', body, credentials: 'omit', mode: 'no-cors', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'content-type': 'text/plain' } }).catch(() => {});     // too big to outlive the page (64 KB cap): the page is still up after an error
    else if (KEEP) post(TO, { method: 'POST', body, keepalive: true, credentials: 'omit', mode: 'no-cors', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'content-type': 'text/plain' } }).catch(() => {});
    else if (navigator.sendBeacon) navigator.sendBeacon(TO, body);
    if (window.__tmlog) window.__tmlog.push(o);
    return true; } catch (e) { return false; }
}
let gpuStr = '';
function gpu() {
  if (gpuStr) return gpuStr; let s = 'unknown';
  try { if (!lost) s = rec.gpu() || 'unknown'; } catch (e) {}
  if (s === 'unknown') { try { const w = window.world; if (w && w.renderer) { const gl = w.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); s = (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown'; } } catch (e) {} }
  if (s === 'unknown' && !window.world) { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (gl) { const x = gl.getExtension('WEBGL_debug_renderer_info'); s = (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown'; const l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); } else s = 'none'; } catch (e) {} }     // an error before the game has a renderer: ask a throwaway context once
  s = String(s).slice(0, 120); if (s !== 'unknown') gpuStr = s; return s;
}
let buildTxt = '';     // main.js reads build.txt later than this module starts (and not at all in some test modes): read it here too, so an early error has its build
const build = () => String(window.__build || buildTxt || CODE || '').slice(0, 40) || null;
const stage = () => (lost ? 'lost' : !window.__ready ? (window.__blocked ? 'blocked' : 'loading') : window.__warming ? 'warming' : window.__startScreen ? 'start' : (window.game && window.game.paused) ? 'paused' : 'play');
const tier = () => { try { const w = window.world; return w ? { scale: +(w.liveScale || 1).toFixed(2), ao: !!(w.gtao && w.gtao.enabled), aa: String(w.liveAA || 'msaa').slice(0, 12), detail: +(w.detail || 1).toFixed(2) } : null; } catch (e) { return null; } };
const picture = () => { try { const c = window.world.renderer.domElement; return [c.width, c.height]; } catch (e) { return null; } };
const head = (type, was) => ({ v: 1, type, sid, seq: seq++, t: sec(), build: build(), gpu: gpu(), ua: String(navigator.userAgent).slice(0, 200), stage: was || stage() });

// ---- the bodies near the player, twice a second, into a fixed ring (no allocation): per snapshot a 10-number header and 12 bodies of 5
//   header: time (tenths of a second since feedback.js started; low 15 bits, rest), x and y in decimetres (low 15 bits, rest), bodies,
//           police level, his car's damage x100, his car's turn rate x100
//   body:   kind (1 traffic car, 2 other vehicle, 4 pedestrian, 5 crowd person, 6 person down, 7 police on foot, 8 police car),
//           east and north of him in 2 cm steps, heading x1000, speed x10 (m/s)
const NB = 12, PER = 10 + NB * 5, SLOTS = 120, ring = new Int16Array(SLOTS * PER), bd = new Float32Array(NB), bk = new Int8Array(NB), bx = new Float32Array(NB), by = new Float32Array(NB), bh = new Float32Array(NB), bv = new Float32Array(NB);
let ringN = 0, bn = 0, px = 0, py = 0;
const i16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v === v ? Math.round(v) : 0);
function offer(kind, x, y, h, v) {
  const dx = x - px, dy = y - py, d = dx * dx + dy * dy; if (!(d < 2025)) return;     // within 45 m
  let i = bn; if (bn < NB) bn++; else { i = 0; for (let j = 1; j < NB; j++) if (bd[j] > bd[i]) i = j; if (bd[i] <= d) return; }
  bd[i] = d; bk[i] = kind; bx[i] = dx; by[i] = dy; bh[i] = h || 0; bv[i] = v || 0;
}
function snap() {
  const g = window.game; if (!g || !g.player || g.paused || !window.__ready || document.hidden) return;
  try { const pl = g.player, v = pl.vehicle, hl = g.heli && g.heli.piloted ? g.heli.f : null, heat = g.combat && g.combat.heat; px = hl ? hl.pos.x : v ? v.x : pl.x; py = hl ? -hl.pos.z : v ? v.y : pl.y; bn = 0;
    let a = g.traffic && g.traffic.cars; if (a) for (let i = 0; i < a.length; i++) offer(1, a[i].x, a[i].y, a[i].h, a[i].v);
    a = g.vehicles; const pc = heat && heat.cars; if (a) for (let i = 0; i < a.length; i++) if (a[i] !== v) offer(pc && pc.indexOf(a[i]) >= 0 ? 8 : 2, a[i].x, a[i].y, a[i].h, a[i].vf);
    a = g.peds && g.peds.list; if (a) for (let i = 0; i < a.length; i++) offer(a[i].state === 'down' ? 6 : 4, a[i].x, a[i].y, a[i].h, a[i].speed);
    a = g.crowd && ((g.crowd.sim && g.crowd.sim.agents) || g.crowd.agents); if (a) for (let i = 0; i < a.length; i++) offer(a[i].fall ? 6 : 5, a[i].x, a[i].y, a[i].h, a[i].v);
    a = g.__pedhit && g.__pedhit.list; if (a) for (let i = 0; i < a.length; i++) { const p = a[i].P && a[i].P.hips && a[i].P.hips.p; if (p) offer(6, p.x, -p.z, 0, 0); }
    a = heat && heat.cops; if (a) for (let i = 0; i < a.length; i++) offer(7, a[i].x, a[i].y, a[i].h, 0);
    const o = (ringN % SLOTS) * PER, t = Math.round((performance.now() - rec.t0) / 100), X = Math.round(px * 10) + 1073741824, Y = Math.round(py * 10) + 1073741824;
    ring[o] = t & 32767; ring[o + 1] = t >> 15; ring[o + 2] = X & 32767; ring[o + 3] = X >> 15; ring[o + 4] = Y & 32767; ring[o + 5] = Y >> 15; ring[o + 6] = bn; ring[o + 7] = heat ? i16(heat.level) : -1; ring[o + 8] = v ? i16((v.damage || 0) * 100) : -1; ring[o + 9] = v ? i16((v.yawV || 0) * 100) : 0;
    for (let i = 0; i < NB; i++) { const q = o + 10 + i * 5; if (i < bn) { ring[q] = bk[i]; ring[q + 1] = i16(bx[i] * 50); ring[q + 2] = i16(by[i] * 50); ring[q + 3] = i16(bh[i] * 1000); ring[q + 4] = i16(bv[i] * 10); } else ring[q] = 0; }
    ringN++; } catch (e) {}
}
// the log as it is sent (built only when a report needs it, and every 10 s in idle time for the reload report)
const SW = /^[a-z][a-z0-9_]{0,15}$/i, SV = /^[\w.,:-]{0,24}$/;
function pack() {
  const n = Math.min(ringN, SLOTS), out = new Int16Array(n * PER); for (let i = 0; i < n; i++) { const src = ((ringN - n + i) % SLOTS) * PER; out.set(ring.subarray(src, src + PER), i * PER); }
  const u8 = new Uint8Array(out.buffer); let b = ''; for (let i = 0; i < u8.length; i += 8192) b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  const sw = {}; let k = 0; for (const [a, v] of Q) if (k < 20 && SW.test(a) && SV.test(v) && !/^(utm|ref|src|source|from|via|user|name|mail|email|id|uid|token|key|fbclid|gclid)/i.test(a)) { sw[a] = v; k++; }     /* second read (progress owner): switches are for OUR ?name=value test switches; a link someone shared with ?ref=<a name> must not carry that name into a report */
  const g = window.game || {}, v = g.player && g.player.vehicle;
  return { v: 1, everyMs: 100, fields: ['t', 'x', 'y', 'heading', 'camYaw', 'camPitch', 'kmh', 'in', 'keys', 'alt', 'fps'], samples: rec.replay, inputs: rec.inputs, bodiesEveryMs: 500, bodiesPer: PER, bodiesMax: NB, bodies: btoa(b),
    gameT: typeof g.t === 'number' ? Math.round(g.t * 10) / 10 : null, car: v ? String(v.type || '').slice(0, 20) : null, switches: sw };
}
// one picture of the game canvas: drawn and read in the same task (the canvas keeps nothing between frames). Never throws.
let shooting = false;
function shot() {
  if (shooting || lost) return [null, lost ? 'context lost' : 'busy']; shooting = true;
  try { const w = window.world, g = window.game, c = w.renderer.domElement; if (w.renderer.getContext().isContextLost()) return [null, 'context lost'];
    w.render((g && g.t) || 0); const k = Math.min(1, 960 / c.width), d = document.createElement('canvas'); d.width = Math.round(c.width * k); d.height = Math.round(c.height * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height);
    let s = d.toDataURL('image/jpeg', 0.6); if (s.length > 400000) s = d.toDataURL('image/jpeg', 0.35); return s.length > 400000 || s.length < 200 ? [null, 'too big'] : [s, null];
  } catch (e) { return [null, 'could not draw: ' + scrub(e && e.message, 80)]; } finally { shooting = false; }
}
// the log (and, when asked, the picture) put on one report; only 3 a page load get them
function big(o, withShot, stuck) {     // stuck-car reports have their own allowance of 2, so that they never use up an error's
  if (stuck ? stuckBigs >= 2 : bigs >= MAX_BIG) { o.noShot = 'limit'; return o; } if (stuck) stuckBigs++; else bigs++;
  try { o.log = pack(); } catch (e) {}
  if (withShot) { const [s, why] = window.world && window.__ready ? shot() : [null, 'no picture yet']; if (s) o.shot = s; else o.noShot = why; } else o.noShot = 'context lost';
  return o;
}

// ---- errors: one report per different error, a second after it is first seen (so a per-frame error arrives once, with its count)
const seen = new Map(); let errTotal = 0, errReports = 0;
function onErr(kind, message, stack, at) {
  try { errTotal++;
    const st = scrub(stack || '', 1500), msg = scrub(String(message || '').split('\n')[0] || st.split('\n')[0] || kind, 300), where = scrub(at || '', 80) || top(st), key = (kind + '|' + msg + '|' + (top(st) || where)).slice(0, 300);
    let e = seen.get(key); if (e) { e.n++; return; } if (seen.size >= 60) return; e = { n: 1, msg, kind }; seen.set(key, e);
    if (errReports >= MAX_ERRORS) return; errReports++;
    const h = head('error'), g = window.game;
    setTimeout(() => big(h, true), 0);     // the picture and the log in the next task: not inside the error handler, and before the next frame
    setTimeout(() => { if (h.log && !h.shot && /^could not draw/.test(h.noShot || '')) { const [s] = shot(); if (s) { h.shot = s; h.noShot = undefined; h.shotLate = true; } } }, 800);     // the error broke the drawing too: one more try just before the report goes
    setTimeout(() => send(Object.assign(h, { kind, msg, stack: st, at: where, n: e.n, errors: errTotal, readySecs: window.__readyAt || null, playSecs, fps: g ? Math.round(g.fps || 0) : null, tier: tier() })), 1000);
  } catch (err) {}
}
const what = (r) => { try { if (r && typeof r === 'object') return [r.name || (r.constructor && r.constructor.name), r.message || r.type].filter(Boolean).join(': '); return typeof r === 'string' ? r : typeof r; } catch (e) { return 'unknown'; } };

// ---- lost graphics context
let lost = false, lostN = 0, ctxReports = 0;
function onCtx(api, event, extra) {
  const was = stage();     // the stage BEFORE the loss (the first round's reports all said 'lost')
  if (event === 'lost') { try { gpu(); } catch (e) {} lost = true; lostN++; } else lost = false;
  if (ctxReports >= MAX_CTX) return; ctxReports++;
  let mem = null; try { const i = window.world.renderer.info; mem = { textures: i.memory.textures, geometries: i.memory.geometries, programs: (i.programs || []).length }; } catch (e) {}
  send(Object.assign(event === 'lost' ? big(head('ctxlost', was), false) : head('ctxlost'), { api, event, n: lostN, hidden: !!document.hidden, readySecs: window.__readyAt || null, playSecs, tier: tier(), picture: picture(), mem, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }, extra || {}));
  if (event === 'lost') setTimeout(() => summary('ctxlost'), 1200);
}

// ---- where the load stands (for every summary): marks are main.js's (world, init, compiled, ready, warm, play; seconds since the page opened)
let hidLoad = 0, hidAt = 0, sumN = 0, stuckN = 0;
const r1 = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 10) / 10 : null);
// light lane, Nov 15 (handoff16; CHIEF: Windows loads spend their minutes somewhere between "game set up" and Play, and the split above stops at
// "compiled"): what src/warmup.js and the renderer already know, read here, numbers only, nothing per frame. progs = shader programs alive;
// par = the browser links off the page's thread (KHR_parallel_shader_compile); add / link / wait / per = the warm-up batch (programs it added, ms the
// page spent starting it, ms waited for it after the compile-ahead, ms a program); ramp = the first-frames ramp (0 skipped as a repeat visit,
// 1 running, 2 done, 3 stopped early or failed), its seconds, steps and longest step; f1 = the longest and fN = the count of page freezes over
// 0.2 s between ready and Play lit (long tasks; Chrome and Edge only), fz = their sum in seconds.
let frz = null;
function warmInfo() {
  const o = {}; try { const w = window.world, r = w && w.renderer, S = w && w.warmup && w.warmup.S, m = rec.marks || {};
    if (r) { o.progs = r.info && r.info.programs ? r.info.programs.length : null; try { o.par = r.getContext().getExtension('KHR_parallel_shader_compile') ? 1 : 0; } catch (e) {} }
    if (S && S.early && S.early.arm) { o.arm = S.early.arm; if (S.early.passes) { o.ep = S.early.passes; o.en = S.early.added; } }     /* light handoff17: the Windows trial of early linking (src/warmup.js): arm 1 forced, 2 trial with early linking, 3 trial without; its passes and the programs they made */
    if (S) { if (typeof S.added === 'number') o.add = S.added; if (typeof S.linkMs === 'number') o.link = S.linkMs; if (typeof S.waitMs === 'number') o.wait = S.waitMs; if (typeof S.perProg === 'number') o.per = r1(S.perProg);
      const R = S.ramp; if (S.rampSkipped !== undefined) o.ramp = 0; else if (R) { o.ramp = S.ramping ? 1 : R.why === 'done' ? 2 : 3; if (typeof R.ms === 'number') o.rampS = r1(R.ms / 1000); o.steps = (R.steps || 0) + (R.mSteps || 0); if (R.maxStep) o.maxStep = Math.round(R.maxStep); } }
    const a = window.__readyAt, b = m.warm || performance.now() / 1000; if (frz) Object.assign(o, frz); else if (a) { let n = 0, mx = 0, sum = 0; for (const l of rec.longs || []) if (l[0] >= a - 0.05 && l[0] <= b) { n++; sum += l[1]; if (l[1] > mx) mx = l[1]; } o.f1 = r1(mx / 1000); o.fN = n; o.fz = r1(sum / 1000); if (m.warm) frz = { f1: o.f1, fN: o.fN, fz: o.fz }; }     /* kept once Play is lit: feedback.js holds only the last 80 long tasks, so a long play would push these out (second read, F1) */
  } catch (e) {} return o;
}
function loadInfo() {
  const L = window.__load || {}, m = rec.marks || {}, nav = performance.getEntriesByType('navigation')[0] || {}, c = navigator.connection || {}, now = performance.now(), done = L.done || 0;
  const tot = Math.max(L.total || 250e6, done * 1.02), building = (L.total && done >= L.total * 0.985) || (/game|compiled/.test(L.stage) && now - (L.last || 0) > 1500);
  const stg = String(L.stage || ''), st = window.__blocked ? 'blocked' : window.__ready && !window.__warming ? 'ready' : /^(starting|game|compiled|warming)$/.test(stg) ? stg : 'world';
  let n = 0, cached = 0; try { const o = location.origin + '/'; for (const e of performance.getEntriesByType('resource')) { if (!e.name.startsWith(o)) continue; n++; if (e.transferSize === 0 && e.decodedBodySize > 0) cached++; } } catch (e) {}
  return { fb: nav.responseStart > 0 ? r1(nav.responseStart / 1000) : null, world: m.world || null, init: m.init || null, compiled: m.compiled || null, ready: window.__readyAt || null, warm: m.warm || null,
    dlPct: L.total ? Math.min(100, Math.round(done / L.total * 100)) : null, dlSecs: L.last ? r1(L.last / 1000) : null, mbDone: Math.round(done / 1e6), mbTotal: L.total ? Math.round(L.total / 1e6) : null, failed: L.failed || 0,
    st, bar: st === 'ready' ? 100 : st === 'warming' || building ? 99 : Math.max(2, Math.min(99, Math.floor(done / tot * 100))), hiddenSecs: Math.round((hidLoad + (hidAt ? now - hidAt : 0)) / 1000),
    conn: typeof c.effectiveType === 'string' ? c.effectiveType.slice(0, 8) : null, downlink: typeof c.downlink === 'number' ? Math.min(10, r1(c.downlink)) : null, saveData: c.saveData ? 1 : 0, cached, resources: n, sums: sumN, stuck: stuckN, wu: warmInfo() };
}
// the same as one short plain string (letters, digits, = . and spaces only), for servers that do not know the new field names yet
const loadPack = (l) => 'L1' + [['fb', l.fb], ['wo', l.world], ['in', l.init], ['co', l.compiled], ['rd', l.ready], ['wm', l.warm], ['dl', l.dlPct], ['dlt', l.dlSecs], ['mb', l.mbTotal ? l.mbDone + 'of' + l.mbTotal : l.mbDone], ['fl', l.failed], ['st', l.st], ['bar', l.bar], ['hid', l.hiddenSecs], ['cn', l.conn], ['dn', l.downlink], ['sv', l.saveData || null], ['ca', l.cached + 'of' + l.resources], ['sm', l.sums], ['sk', l.stuck || null]].concat(l.wu ? [['ea', l.wu.arm], ['ep', l.wu.ep], ['en', l.wu.en], ['pg', l.wu.progs], ['par', l.wu.par], ['wa', l.wu.add], ['wl', l.wu.link], ['ww', l.wu.wait], ['wp', l.wu.per], ['rp', l.wu.ramp], ['rs', l.wu.rampS], ['rn', l.wu.steps], ['rx', l.wu.maxStep], ['f1', l.wu.f1], ['fn', l.wu.fN], ['fz', l.wu.fz]] : []).map(([k, v]) => (v == null ? '' : ' ' + k + '=' + String(v).replace(/[^\w.]/g, ''))).join('');

// ---- the summary: frame times while really playing (not loading, not the start screen, not paused, not hidden), from feedback.js's histogram
const B = [8, 12, 17, 20, 25, 33, 50, 67, 100, 200, 500], ph = new Array(12).fill(0), prev = new Array(12).fill(0), fpsS = [];
const PH = Q.get('tmphase') !== '0', phased = {}; let playSecs = 0, wasPlay = false, summaries = 0, lastSumAt = -1e9, lastSumPlay = -1, did3 = false, did15 = false, gpuDev = null;
// who stays (third round): the first 30 s of play and seconds 30-120 as their own windows, what he is in, and loadwait.js's call-back. All of it
// in the once-a-second timer below (playTick: a scan of feedback.js's at most 60 hitches and three additions); nothing per frame.
const MODES = ['foot', 'car', 'heli', 'sub', 'menu'], md = [0, 0, 0, 0, 0], mx = [0, 0]; let h10 = null, h30 = null, h120 = null, hT = 0, mode = 0, inMenu = 0;
// lead, Nov 18 (CHIEF 16:08 Nov 16: 'a feature-used / where-quit field, fixed words only'): the summary's `at` string also carries
//   mp = which map (mid, down, dumbo, up, other: from the city file's name, a fixed word, never the address), wq = what he was in at the last
//   second of play, finer than `in` (foot, car, moto, heli, sub, boat, swim, bus), fu = which of those he has been in this load, as letters in
//   a fixed order (c car, m motorbike, h helicopter, s subway, b boat, w swim, u bus, g grappling hook used, t map opened; '-' = none).
//   Thirteen fixed words and nine letters; no position, no text.
const WQ = ['foot', 'car', 'moto', 'heli', 'sub', 'boat', 'swim', 'bus'], FU = 'cmhsbwugt', fu = new Array(9).fill(0); let wq = 0;
const mapWord = () => { try { const c = new URLSearchParams(location.search).get('city') || (window.__CFG && window.__CFG.city) || ''; return !c || c === 'city.json' ? 'mid' : /^city-(15|19)/.test(c) ? 'down' : /^city-dumbo/.test(c) ? 'dumbo' : /^city-u/.test(c) ? 'up' : 'other'; } catch (e) { return 'other'; } };
const wqNow = (g) => { const v = g.player && g.player.vehicle, sw = g.swim && g.swim.core && g.swim.core.state;
  return g.heli && g.heli.piloted ? 3 : g.subway && g.subway.own ? 4 : g.water && g.water.on ? 5 : (sw === 'swim' || sw === 'climb') ? 6 : g.bus && g.bus.aboard ? 7 : v ? (v.type === 'moto' ? 2 : 1) : 0; };
const modeNow = (g) => (g.heli && g.heli.piloted ? 2 : g.subway && g.subway.own ? 3 : g.player && g.player.vehicle ? 1 : 0);
function playTick(g) {     // once per counted second of play, after playSecs++
  if (playSecs <= 120) { const k = playSecs <= 30 ? 0 : 1; for (const e of rec.hitches || []) if (e[0] > hT && e[1] > mx[k]) mx[k] = e[1]; if (playSecs === 10) h10 = ph.slice(); else if (playSecs === 30) h30 = ph.slice(); else if (playSecs === 120) h120 = ph.slice(); }
  inMenu = 0; try { mode = modeNow(g); } catch (e) {} md[mode]++;
  try { wq = wqNow(g); if (wq) fu[wq - 1] = 1; if (g.grapple && g.grapple.stats && g.grapple.stats.attached > 0) fu[7] = 1; } catch (e) {}
}
export function win(h, f, m) {     // one window: [seconds, median fps, 1% low fps, frames over 50 ms, over 100 ms, longest frame ms] or null
  const n = h.reduce((a, b) => a + b, 0); if (!n || !f.length) return null; let c = 0, p = 11, top = 11; for (let i = 0; i < 12; i++) { c += h[i]; if (c >= n * 0.99) { p = i; break; } } while (top > 6 && !h[top]) top--;
  f = f.slice().sort((a, b) => a - b); return [f.length, f[f.length >> 1], Math.round(1000 / (p < 11 ? B[p] : 1000)), h[7] + h[8] + h[9] + h[10] + h[11], h[9] + h[10] + h[11], Math.round(Math.max(m, top > 6 ? B[top - 1] : 0))];     // the longest frame is at least its histogram bucket's floor (feedback.js keeps only its 12 worst hitches when it has seen 60)
}
function playPack() {
  const a = win(h30 || ph, fpsS.slice(0, 30), mx[0]), b = h30 ? win((h120 || ph).map((x, i) => x - h30[i]), fpsS.slice(30, 120), mx[1]) : null, lw = window.__loadwait, t = performance.now() / 1000, e = h10 || ph;
  let s = 'P1' + (a ? ' e=' + [Math.min(10, playSecs), e[7] + e[8] + e[9] + e[10] + e[11], e[9] + e[10] + e[11]] + ' a=' + a : '') + (b ? ' b=' + b : '') + (playSecs ? ' in=' + MODES[mode] : '') + (inMenu ? ' pz=1' : '') + (playSecs || md[4] ? ' md=' + md : '') + ' lw=' + (lw ? 1 : 0);
  if (lw && lw.callAt > 0) s += ' cb=' + ((lw.kinds | 0) & 3) + ' ch=' + Math.max(0, Math.min(99999, Math.round((lw.backAt > 0 ? lw.backAt : t) - lw.callAt))) + ' bk=' + (lw.backAt > 0 ? 1 : 0);
  const pg = window.__playgate; if (pg && typeof pg === 'object') s += ' pg=' + [pg.on ? 1 : 0, pgn(pg.litAt), /^(rule|early|return|cap)$/.test(pg.litBy) ? pg.litBy : 'x', pgn(pg.pressedAt)];     /* the playgate helper's own record, when it is there */
  s += ' mp=' + mapWord() + (playSecs ? ' wq=' + WQ[wq] + ' fu=' + (FU.split('').filter((c, i) => fu[i]).join('') || '-') : '');     /* lead, Nov 18: which map, where he was at the end, what he used: fixed words and letters only */
  return s;
}
const pgn = (x) => (typeof x === 'number' && x >= 0 && x < 1e5 ? Math.round(x * 10) / 10 : 'x');
function summary(why) {
  if (OFF || summaries >= MAX_SUMMARIES) return; summaries++; sumN++; lastSumAt = performance.now(); lastSumPlay = playSecs; let ld = null, pp = null; try { ld = loadInfo(); } catch (e) {} try { pp = playPack(); } catch (e) {}
  const n = ph.reduce((a, b) => a + b, 0), at = (q) => { let c = 0; for (let i = 0; i < 12; i++) { c += ph[i]; if (c >= n * q) return i < 11 ? B[i] : 1000; } return null; };
  const f = fpsS.slice().sort((a, b) => a - b), m = rec.marks || {}, p99 = n ? at(0.99) : null, L = window.__load;
  send(Object.assign(head('summary'), { why, reason: ld ? loadPack(ld) : null, at: pp, load: ld, upSecs: sec(), readySecs: window.__readyAt || null, warmSecs: m.warm || null, playAtSecs: m.play || null, playSecs,
    fpsMed: f.length ? f[f.length >> 1] : null, fpsLow1: p99 ? Math.round(1000 / p99) : null, ftMedMs: n ? at(0.5) : null, ft99Ms: p99, frames: n, bucketsMs: B, hist: ph.slice(),
    hitches50: ph[7] + ph[8] + ph[9] + ph[10] + ph[11], hitches100: ph[9] + ph[10] + ph[11], longTasks: (rec.longs || []).length,
    tier: tier(), screen: [screen.width, screen.height, +(+devicePixelRatio).toFixed(2)], picture: picture(), cores: navigator.hardwareConcurrency || null, memGB: navigator.deviceMemory || null,
    errors: errTotal, errorKinds: seen.size, errorTop: [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((e) => [e.msg.slice(0, 120), e.n]), ctxLost: lostN, loadFailed: L ? L.failed : null, blocked: window.__blocked || null }));
}

// ---- stuck cars. Polled twice a second (no per-frame code, no allocation until one is found). unwedge.js's own counters say when IT decided
// the car was wedged or at the map's edge; what it leaves alone on purpose (a car pushing against a queue of traffic) is watched here.
const CAUSE = { traffic: 'Stuck car: pedal down, not moving, traffic ahead', other: 'Stuck car: pedal down, not moving, nothing ahead', freed: 'Stuck car: wedged, freed by the game', nospot: 'Stuck car: wedged, the game found no clear spot', edge: 'Stuck car: at the edge of the map, turned round by the game' };
const SK = { v: null, ax: 0, ay: 0, t: 0, fw: 0, rv: 0, places: new Set(), pend: null, uT: -1, uF: 0, uE: 0 };
function placeOf(g, x, y) {
  let best = null, bd = 40, bi = -1; try { const E = g.roads.edges; for (let i = 0; i < E.length; i++) { const e = E[i], p = e.pts; if (!p || !e.line) continue; if (Math.min(Math.abs(p[0][0] - x), Math.abs(p[p.length - 1][0] - x)) > (e.len || 400) + 40) continue; const d = e.line.project(x, y).d; if (d < bd) { bd = d; best = e; bi = i; } } } catch (e) {}
  const name = best && best.name ? String(best.name).replace(/[^\w .'-]/g, '').slice(0, 40) : 'no street';
  return { key: bi >= 0 ? 'e' + bi : 'g' + Math.round(x / 40) + '.' + Math.round(y / 40), text: Math.round(x) + ',' + Math.round(y) + ' ' + name + (best ? ', ' + (best.lanes || 1) + (best.lanes > 1 ? ' lanes' : ' lane') + ', ' + (best.oneway ? 'one-way' : 'two-way') + (bd > 6 ? ', ' + Math.round(bd) + ' m off it' : '') : '') };
}
function stuckDone(p, out) { SK.pend = null; const g = window.game; p.h.why = out; send(Object.assign(p.h, { errors: errTotal, readySecs: window.__readyAt || null, playSecs, fps: g ? Math.round(g.fps || 0) : null, tier: tier() })); }
function stuckRaise(g, cause, x, y, v, out) {
  const pl = placeOf(g, x, y); if (SK.places.has(pl.key) || SK.places.size >= 4) return; SK.places.add(pl.key); stuckN++;
  let ahead = '', near = 0; try { const c = Math.cos(v.h), s = Math.sin(v.h); let ad = 1e9, av = 0; for (const o of g.traffic.cars) { const dx = o.x - v.x, dy = o.y - v.y; if (dx * dx + dy * dy < 64) near++; const f = dx * c + dy * s, sd = Math.abs(-dx * s + dy * c); if (f > 0 && f < 12 && sd < 1.8 && f < ad) { ad = f; av = o.v || 0; } } if (ad < 1e9) ahead = 'ahead: a traffic car ' + ad.toFixed(1) + ' m away, moving ' + av.toFixed(1) + ' m a second'; } catch (e) {}
  if (cause === 'traffic' && !ahead) cause = 'other';
  const U = g.unwedge, h = head('error'); h.kind = 'stuck'; h.msg = CAUSE[cause]; h.at = pl.text; h.n = Math.round(SK.fw + SK.rv);
  h.stack = ['pedals here: forward ' + SK.fw.toFixed(1) + ' s, reverse ' + SK.rv.toFixed(1) + ' s, in ' + Math.max(0, SK.t).toFixed(0) + ' s', ahead || 'ahead: no traffic car within 12 m', 'near: ' + near + ' traffic cars within 8 m', 'car: ' + String(v.type || '').replace(/[^\w]/g, '').slice(0, 20) + ', speed ' + Math.hypot(v.vx || 0, v.vy || 0).toFixed(1) + ' m a second, damage ' + (v.damage || 0).toFixed(2), U ? 'unwedge: tried ' + U.tried + ', freed ' + U.freed + ', edge ' + U.edge : 'unwedge: not loaded'].join('\n');
  big(h, true, true); const p = { h, x, y, v, age: 0, uF: U ? U.freed : 0, uE: U ? U.edge : 0 }; if (out) stuckDone(p, out); else SK.pend = p;
}
function stuckTick() {
  const g = window.game; if (OFF || !g || !g.player || g.paused || !window.__ready || document.hidden) return; const v = g.player.vehicle, U = g.unwedge, I = g.input || {};
  if (SK.pend) { const p = SK.pend; p.age += 0.5; const out = U && U.freed > p.uF ? 'freed by the game' : U && U.edge > p.uE ? 'turned round at the map edge' : v !== p.v ? 'got out of the car' : Math.hypot(v.x - p.x, v.y - p.y) > 8 ? 'drove off' : p.age >= 30 ? 'still there' : ''; if (out) stuckDone(p, out + ' after ' + Math.round(p.age) + ' s'); }
  if (U) { if (SK.uT >= 0 && U.tried > SK.uT && v) { const freed = U.freed > SK.uF, edge = U.edge > SK.uE, f = (freed || edge) && U.last && U.last.from; stuckRaise(g, edge ? 'edge' : freed ? 'freed' : 'nospot', f ? f[0] : v.x, f ? f[1] : v.y, v, freed || edge ? 'freed by the game after 0 s (the picture is from just after)' : 'not freed'); } SK.uT = U.tried; SK.uF = U.freed; SK.uE = U.edge; }
  if (!v || v.wreck || g.demo || (g.fly && g.fly.on) || (g.heli && g.heli.piloted)) { SK.v = null; return; }
  if (SK.v !== v || Math.hypot(v.x - SK.ax, v.y - SK.ay) > 3) { SK.v = v; SK.ax = v.x; SK.ay = v.y; SK.t = 0; SK.fw = 0; SK.rv = 0; return; }
  SK.t += 0.5; if (I.throttle > 0.3) SK.fw += 0.5; if (I.brake > 0.3) SK.rv += 0.5; if (I.throttle > 0.3 || I.brake > 0.3) SK.idle = 0; else if ((SK.idle = (SK.idle || 0) + 0.5) >= 5) { SK.t = 0; SK.fw = 0; SK.rv = 0; }     // five seconds off the pedals: he is waiting, not stuck; the count starts again
  if (SK.t >= STUCK_SECS && SK.fw + SK.rv >= SK.t * 0.55 && !SK.pend) { stuckRaise(g, 'traffic', v.x, v.y, v, ''); SK.t = 0; SK.fw = 0; SK.rv = 0; }
}

function start() {
  window.__telemetry = { sid, on: !OFF, to: TO, scrub, summary, pack, snap, bytes: () => lastBytes, loadInfo, loadPack, playPack, stuck: SK };
  if (OFF) return;
  try { post('build.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((x) => { buildTxt = String(x || '').trim().slice(0, 40); }).catch(() => {}); } catch (e) {}
  // a load that follows a page which never said goodbye: the tab was killed (memory) or crashed. feedback.js keeps the tab's sign of life.
  try { const k = 'crosstown.tm', was = JSON.parse(sessionStorage.getItem(k) || 'null'), alive = +sessionStorage.getItem('crosstown.alive') || 0, nav = (performance.getEntriesByType('navigation')[0] || {}).type || '', disc = !!document.wasDiscarded;
    let loads = 0; try { loads = JSON.parse(sessionStorage.getItem('crosstown.loads') || '[]').length; } catch (e) {}
    const now = { bye: 0, build: null, ready: 0, play: 0, up: 0, lost: 0 }, keep = () => { try { now.build = build(); now.ready = window.__readyAt || 0; now.play = playSecs; now.up = Math.round(sec()); now.lost = lostN; sessionStorage.setItem(k, JSON.stringify(now)); } catch (e) {} };
    if (was && !was.bye && (nav === 'reload' || disc)) send(Object.assign((() => { const h = head('reload'); try { const l = JSON.parse(sessionStorage.getItem('crosstown.tm.log') || 'null'); if (l && l.samples) { h.log = l; h.noShot = 'page gone'; } sessionStorage.removeItem('crosstown.tm.log'); } catch (e) {} return h; })(), { nav, discarded: disc, sinceAliveSecs: alive ? Math.round((Date.now() - alive) / 1000) : null, loads, before: { build: was.build || null, readySecs: was.ready || null, playSecs: was.play || 0, upSecs: was.up || 0, ctxLost: was.lost || 0 } }));
    keep(); setInterval(keep, 5000); addEventListener('pagehide', () => { now.bye = 1; keep(); }); addEventListener('pageshow', (e) => { if (e.persisted) { now.bye = 0; keep(); } });
  } catch (e) {}
  // errors feedback.js recorded before this module was in (window errors have a file:line in slot 3; console.error lines do not and are not sent)
  try { for (const e of rec.errs) if (e && ((e[1] === 'error' && e.length > 3) || e[1] === 'rejection')) onErr(e[1], String(e[2]).split('\n')[0], e[2], e[1] === 'error' ? e[3] : ''); } catch (e) {}
  addEventListener('error', (e) => { if (e instanceof ErrorEvent) onErr('error', e.message || what(e.error), e.error && e.error.stack, e.filename ? String(e.filename).split(/[?#]/)[0].split('/').slice(-2).join('/').replace(/^src-\d+\//, 'src/') + ':' + (e.lineno || 0) : ''); });
  addEventListener('unhandledrejection', (e) => onErr('rejection', what(e.reason), e.reason && e.reason.stack, ''));
  document.addEventListener('webglcontextlost', (e) => { if (e.target && e.target.id === 'c') onCtx('webgl', 'lost', { reason: scrub(e.statusMessage || '', 120) || null }); }, true);
  document.addEventListener('webglcontextrestored', (e) => { if (e.target && e.target.id === 'c') onCtx('webgl', 'restored'); }, true);
  setInterval(() => { snap(); try { stuckTick(); } catch (e) {} }, 500);
  if (document.hidden) hidAt = performance.now();
  document.addEventListener('visibilitychange', () => { if (window.__readyAt) { hidAt = 0; return; } const now = performance.now(); if (document.hidden) hidAt = now; else if (hidAt) { hidLoad += now - hidAt; hidAt = 0; } });     // seconds hidden during the load
  // the log parked for the reload report: every 10 s, in idle time (packMs = how long the last one took)
  const park = () => { try { const t = performance.now(); if (window.game && !window.game.paused && !document.hidden) sessionStorage.setItem('crosstown.tm.log', JSON.stringify(pack())); window.__telemetry.packMs = +(performance.now() - t).toFixed(2); } catch (e) { try { sessionStorage.removeItem('crosstown.tm.log'); } catch (e2) {} } };
  setInterval(() => (window.requestIdleCallback ? requestIdleCallback(park, { timeout: 4000 }) : park()), 10000);
  let loadErr = false;
  setInterval(() => {
    const g = window.game, h = rec.hist, playing = !!(g && window.__ready && !g.paused && !window.__startScreen && !window.__warming && !document.hidden && !lost);
    if (playing && wasPlay) { for (let i = 0; i < 12; i++) ph[i] += h[i] - prev[i]; playSecs++; if (fpsS.length < 7200) fpsS.push(Math.round(g.fps || 0)); playTick(g); }
    else if (g && window.__ready && g.paused && !window.__startScreen && !window.__warming && !document.hidden && !lost) { md[4]++; inMenu = 1; }     /* paused with the tab in view: the menu or the map */
    try { if (g && !fu[8] && (g.gps && g.gps.mapOpen ? g.gps.mapOpen() : g.hud && g.hud.cmap && g.hud.cmap.full)) fu[8] = 1; } catch (e) {}     /* the Tab map was opened (fu letter t) */
    hT = (performance.now() - rec.t0) / 1000;
    for (let i = 0; i < 12; i++) prev[i] = h[i]; wasPlay = playing;
    if (!did3 && playSecs >= FIRST_SUMMARY) { did3 = true; summary('played' + FIRST_SUMMARY); } else if (!did15 && playSecs >= SECOND_SUMMARY) { did15 = true; summary('played' + SECOND_SUMMARY); }
    if (!OFF && PH) { const m = rec.marks || {}; for (const k of ['init', 'ready', 'warm']) if (m[k] && !phased[k]) { phased[k] = 1; const a = lastSumAt, b = lastSumPlay; summary('at-' + k); lastSumAt = a; lastSumPlay = b; break; } }     /* light handoff16: one summary as the load passes "game set up", "ready" and "Play lit", so a load that dies in between is seen without the tab having to say goodbye; they do not count against the goodbye summaries' own spacing; ?tmphase=0 off */
    if (!gpuStr && window.world && !lost) gpu();     // read and kept while the context is alive: after a loss the card's name cannot be read
    if (hidAt && window.__readyAt) { hidLoad += Math.max(0, window.__readyAt * 1000 - hidAt); hidAt = 0; }
    if (!loadErr && window.__error) { loadErr = true; onErr('load', String(window.__error).split('\n')[0], window.__error, ''); }     // main.js caught a failed load: it never reaches the window's error event
    if (!gpuDev) { try { const d = window.world && window.world.renderer && window.world.renderer.backend && window.world.renderer.backend.device; if (d && d.lost && d.lost.then) { gpuDev = d; d.lost.then((i) => onCtx('webgpu', 'lost', { reason: scrub((i && i.reason) || '', 40) || null, msg: scrub((i && i.message) || '', 200) || null })); } } catch (e) {} }
  }, 1000);
  const bye = (why) => { if (performance.now() - lastSumAt < 2000 || (why === 'hidden' && playSecs - lastSumPlay < 20 && lastSumPlay >= 0)) return; summary(why); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) bye('hidden'); });
  addEventListener('pagehide', () => { if (SK.pend) { const p = SK.pend; delete p.h.shot; delete p.h.log; p.h.noShot = 'page left'; stuckDone(p, 'page left after ' + Math.round(p.age) + ' s'); } bye('pagehide'); });
}
try { start(); } catch (e) {}
