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
const MAX_SENDS = 30, MAX_BIG = 3, MAX_ERRORS = 10, MAX_SUMMARIES = 8, MAX_CTX = 4, FIRST_SUMMARY = +(Q.get('tmsum') || 180), SECOND_SUMMARY = 900;
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
let sends = 0, seq = 0, bigs = 0, lastBytes = 0;
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
  try { s = rec.gpu(); } catch (e) {}
  if (s === 'unknown') { try { const w = window.world; if (w && w.renderer) { const gl = w.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); s = (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown'; } } catch (e) {} }
  if (s === 'unknown' && !window.world) { try { const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (gl) { const x = gl.getExtension('WEBGL_debug_renderer_info'); s = (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown'; const l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); } else s = 'none'; } catch (e) {} }     // an error before the game has a renderer: ask a throwaway context once
  s = String(s).slice(0, 120); if (s !== 'unknown') gpuStr = s; return s;
}
let buildTxt = '';     // main.js reads build.txt later than this module starts (and not at all in some test modes): read it here too, so an early error has its build
const build = () => String(window.__build || buildTxt || CODE || '').slice(0, 40) || null;
const stage = () => (lost ? 'lost' : !window.__ready ? (window.__blocked ? 'blocked' : 'loading') : window.__warming ? 'warming' : window.__startScreen ? 'start' : (window.game && window.game.paused) ? 'paused' : 'play');
const tier = () => { try { const w = window.world; return w ? { scale: +(w.liveScale || 1).toFixed(2), ao: !!(w.gtao && w.gtao.enabled), aa: String(w.liveAA || 'msaa').slice(0, 12), detail: +(w.detail || 1).toFixed(2) } : null; } catch (e) { return null; } };
const picture = () => { try { const c = window.world.renderer.domElement; return [c.width, c.height]; } catch (e) { return null; } };
const head = (type) => ({ v: 1, type, sid, seq: seq++, t: sec(), build: build(), gpu: gpu(), ua: String(navigator.userAgent).slice(0, 200), stage: stage() });

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
function big(o, withShot) {
  if (bigs >= MAX_BIG) { o.noShot = 'limit'; return o; } bigs++;
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
  if (event === 'lost') { lost = true; lostN++; } else lost = false;
  if (ctxReports >= MAX_CTX) return; ctxReports++;
  let mem = null; try { const i = window.world.renderer.info; mem = { textures: i.memory.textures, geometries: i.memory.geometries, programs: (i.programs || []).length }; } catch (e) {}
  send(Object.assign(event === 'lost' ? big(head('ctxlost'), false) : head('ctxlost'), { api, event, n: lostN, hidden: !!document.hidden, readySecs: window.__readyAt || null, playSecs, tier: tier(), picture: picture(), mem, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }, extra || {}));
  if (event === 'lost') setTimeout(() => summary('ctxlost'), 1200);
}

// ---- the summary: frame times while really playing (not loading, not the start screen, not paused, not hidden), from feedback.js's histogram
const B = [8, 12, 17, 20, 25, 33, 50, 67, 100, 200, 500], ph = new Array(12).fill(0), prev = new Array(12).fill(0), fpsS = [];
let playSecs = 0, wasPlay = false, summaries = 0, lastSumAt = -1e9, lastSumPlay = -1, did3 = false, did15 = false, gpuDev = null;
function summary(why) {
  if (OFF || summaries >= MAX_SUMMARIES) return; summaries++; lastSumAt = performance.now(); lastSumPlay = playSecs;
  const n = ph.reduce((a, b) => a + b, 0), at = (q) => { let c = 0; for (let i = 0; i < 12; i++) { c += ph[i]; if (c >= n * q) return i < 11 ? B[i] : 1000; } return null; };
  const f = fpsS.slice().sort((a, b) => a - b), m = rec.marks || {}, p99 = n ? at(0.99) : null, L = window.__load;
  send(Object.assign(head('summary'), { why, upSecs: sec(), readySecs: window.__readyAt || null, warmSecs: m.warm || null, playAtSecs: m.play || null, playSecs,
    fpsMed: f.length ? f[f.length >> 1] : null, fpsLow1: p99 ? Math.round(1000 / p99) : null, ftMedMs: n ? at(0.5) : null, ft99Ms: p99, frames: n, bucketsMs: B, hist: ph.slice(),
    hitches50: ph[7] + ph[8] + ph[9] + ph[10] + ph[11], hitches100: ph[9] + ph[10] + ph[11], longTasks: (rec.longs || []).length,
    tier: tier(), screen: [screen.width, screen.height, +(+devicePixelRatio).toFixed(2)], picture: picture(), cores: navigator.hardwareConcurrency || null, memGB: navigator.deviceMemory || null,
    errors: errTotal, errorKinds: seen.size, errorTop: [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((e) => [e.msg.slice(0, 120), e.n]), ctxLost: lostN, loadFailed: L ? L.failed : null, blocked: window.__blocked || null }));
}

function start() {
  window.__telemetry = { sid, on: !OFF, to: TO, scrub, summary, pack, snap, bytes: () => lastBytes };
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
  setInterval(snap, 500);
  // the log parked for the reload report: every 10 s, in idle time (packMs = how long the last one took)
  const park = () => { try { const t = performance.now(); if (window.game && !window.game.paused && !document.hidden) sessionStorage.setItem('crosstown.tm.log', JSON.stringify(pack())); window.__telemetry.packMs = +(performance.now() - t).toFixed(2); } catch (e) { try { sessionStorage.removeItem('crosstown.tm.log'); } catch (e2) {} } };
  setInterval(() => (window.requestIdleCallback ? requestIdleCallback(park, { timeout: 4000 }) : park()), 10000);
  let loadErr = false;
  setInterval(() => {
    const g = window.game, h = rec.hist, playing = !!(g && window.__ready && !g.paused && !window.__startScreen && !window.__warming && !document.hidden && !lost);
    if (playing && wasPlay) { for (let i = 0; i < 12; i++) ph[i] += h[i] - prev[i]; playSecs++; if (fpsS.length < 7200) fpsS.push(Math.round(g.fps || 0)); }
    for (let i = 0; i < 12; i++) prev[i] = h[i]; wasPlay = playing;
    if (!did3 && playSecs >= FIRST_SUMMARY) { did3 = true; summary('played' + FIRST_SUMMARY); } else if (!did15 && playSecs >= SECOND_SUMMARY) { did15 = true; summary('played' + SECOND_SUMMARY); }
    if (!loadErr && window.__error) { loadErr = true; onErr('load', String(window.__error).split('\n')[0], window.__error, ''); }     // main.js caught a failed load: it never reaches the window's error event
    if (!gpuDev) { try { const d = window.world && window.world.renderer && window.world.renderer.backend && window.world.renderer.backend.device; if (d && d.lost && d.lost.then) { gpuDev = d; d.lost.then((i) => onCtx('webgpu', 'lost', { reason: scrub((i && i.reason) || '', 40) || null, msg: scrub((i && i.message) || '', 200) || null })); } } catch (e) {} }
  }, 1000);
  const bye = (why) => { if (performance.now() - lastSumAt < 2000 || (why === 'hidden' && playSecs - lastSumPlay < 20 && lastSumPlay >= 0)) return; summary(why); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) bye('hidden'); });
  addEventListener('pagehide', () => bye('pagehide'));
}
try { start(); } catch (e) {}
