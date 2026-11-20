// progress lane, Nov 15 (players' automatic reports: about 1 load in 100 never started because ONE code file did not download, and the bar then
// stood still for good). Three things, all off with ?loadretry=0 (then every call below is the plain call it wraps):
//   imp(load, url)      a dynamic import that failed to download is tried again: the file is first asked for with fetch() until it answers
//                       (0.4 s, 1.5 s, 4 s apart), then the SAME address is imported again (never a changed address: that would make a second
//                       copy of the module). If the server says the file is gone (404: a new build was published while this page was open, and
//                       publishing removes the old code folder) the page is reloaded once by itself to get the new build.
//   rfetch(f, u, o)     a file fetch that failed (no answer, or 5xx / 429 / 408) is asked for twice more (0.4 s, 1.5 s apart). 404 is an answer.
//   fail(e)             when the game cannot start: the start screen says so in one plain line with a "Try again" button (reload), instead of
//                       a bar that stands still. The error itself is thrown on as before, so the automatic report goes out as today.
// With nothing failing this file does no fetch of its own and changes nothing on the page.
const OFF = /[?&]loadretry=0\b/.test(location.search), F = window.fetch.bind(window), KEY = 'crosstown.loadretry';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), WAIT = [400, 1500, 4000];
export const S = (window.__loadretry = { on: !OFF, again: [], fetchAgain: 0, failed: null, reloaded: null });
try { const j = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (j && Date.now() - j.t < 120000) { S.reloaded = j.what; console.log('[loadretry] this page was reloaded by itself: ' + j.what + ' was gone (a new build)'); } } catch (e) {}
// A download failure of a module, as the three engines word it (all TypeError); a module that downloaded and then threw is not one of these.
export const isNet = (e) => !!e && /dynamically imported module|Importing a module script failed|Failed to fetch|NetworkError|Load failed/i.test(String(e.message || e));
const short = (u) => { try { return new URL(u, location.href).pathname.split('/').slice(-2).join('/'); } catch (e) { return String(u); } };
// Ask for the file until it answers. 'ok' = it is there; 'gone' = 404 / 410, or an answer that is not a script; 'down' = still no answer.
async function probe(url, i) {
  try { const r = await F(url, { cache: 'reload' }); const ct = r.headers.get('content-type') || ''; try { if (r.body) r.body.cancel(); } catch (e) {}
    if (r.status === 404 || r.status === 410 || (r.ok && ct && !/javascript|ecmascript/.test(ct))) return 'gone'; if (r.ok) return 'ok'; } catch (e) {}
  return 'down'; }
export async function imp(load, url, o) {
  if (OFF) return load();
  let err;
  for (let i = 0; ; i++) {
    try { const m = await load(); if (i) { S.again.push(short(url) + ' x' + i); console.log('[loadretry] ' + short(url) + ' downloaded on try ' + (i + 1)); if (window.__mark) window.__mark('loadretry'); } return m; } catch (e) { err = e; }
    if (!isNet(err) || i >= WAIT.length) break;
    await sleep(WAIT[i]); const st = await probe(url, i);
    if (st === 'gone') { if (await stale(url)) await new Promise(() => {}); /* the page is reloading */ break; } }
  if (!(o && o.optional)) fail(err);
  throw err; }
// The file is gone from the server: a new build replaced the one this page came from. Reload once (a second time within two minutes is not tried).
async function stale(url) {
  if (window.__ready) return false;
  try { const j = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (j && Date.now() - j.t < 120000) return false;
    sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), what: short(url) })); if (!sessionStorage.getItem(KEY)) return false; } catch (e) { return false; }
  console.log('[loadretry] ' + short(url) + ' is gone from the server (a new build): reloading once'); location.reload(); return true; }
export async function rfetch(f, u, o) {
  if (OFF) return f(u, o);
  for (let i = 0; ; i++) { let r = null, err = null; try { r = await f(u, o); } catch (e) { err = e; }
    const bad = err ? !(err.name === 'AbortError' || (o && o.signal && o.signal.aborted)) : (r.status >= 500 || r.status === 429 || r.status === 408);
    if (!bad || i >= 2 || window.__ready) { if (i && !bad) S.fetchAgain++; if (err) throw err; return r; }
    try { if (r && r.body) r.body.cancel(); } catch (e) {}
    await sleep(i ? 1500 : 400); } }
// The plain line and the button. Shown once, only while the start screen (or the boot text) is still up.
export function fail(e) {
  if (OFF || S.failed || window.__ready) return; const boot = document.getElementById('boot'); if (!boot) return;
  const net = isNet(e); S.failed = net ? 'download' : 'error'; window.__loadFailed = S.failed; if (window.__mark) window.__mark('loadFailed');
  const d = document.createElement('div'); d.id = 'loadfail'; d.style.cssText = 'margin:0 auto 14px;max-width:32em;text-align:center;font:15px/1.5 system-ui,sans-serif;color:#ffe2a8;text-transform:none;letter-spacing:0';
  const p = document.createElement('div'); p.textContent = net ? 'A file did not download. Your connection may have dropped.' : 'The game could not start on this try.'; p.style.marginBottom = '12px';
  const b = document.createElement('button'); b.id = 'loadfailbtn'; b.textContent = 'Try again'; b.style.cssText = 'font:700 16px system-ui,sans-serif;letter-spacing:.06em;padding:11px 36px;border-radius:8px;border:0;background:#ffd27a;color:#111;cursor:pointer';
  b.addEventListener('click', (ev) => { ev.stopPropagation(); b.disabled = true; b.textContent = 'Loading…'; location.reload(); });
  d.appendChild(p); d.appendChild(b);
  const sb = document.getElementById('startbox'), lw = document.getElementById('loadwrap'), pb = document.getElementById('playbtn'), bm = document.getElementById('bootmsg');
  if (sb && lw && sb.style.display !== 'none') { lw.style.display = 'none'; if (pb) pb.style.display = 'none'; sb.insertBefore(d, lw); } else { if (bm) bm.style.display = 'none'; boot.appendChild(d); }
  try { b.focus(); } catch (err) {} }
