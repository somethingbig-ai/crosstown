// loadwait.js (progress lane, Nov 15): the wait on the start screen. Players' reports (lanes/INBOX.md, progress 15:36 Nov 15): of 979 loads 510
// never reached ready; 232 left within 10 s of a bar that said "N of 198 MB", 214 put the tab in the background and never came back.
// Three things, all on the start screen only; this file reads window.__load, __ready, __warming, __startScreen and the page, and touches
// no loader, fetch or warm-up code:
//   1. the tab calls a player back: the title carries the percent while it loads, and when the tab is hidden and PLAY is ready (or the load
//      can go no further without the tab being seen) the title alternates and the tab icon gets an amber dot; a soft chime only where the
//      browser already allows this page to make sound (it has been clicked); never a prompt, never an error;
//   2. an honest time left, from the player's own measured speed over the last seconds, as its own line (#loadeta) above #loadtxt;
//   3. six pictures of the game, cross-fading behind the start text, each with one line of what you can do (assets/wait/*.webp, fetched
//      one at a time and only after the game's own downloads have begun).
// Off: ?loadwait=0 (main.js then does not fetch this file).

// ---- time left (no page needed: tested in node, lanes/progress/loadwait/tools/eta.test.mjs) ----
// After the last byte the city is built and the graphics card made ready. Finishers' medians on a first visit (reports, Nov 14 and 15):
// ready 18 s after the last byte, PLAY 39 s after ready. A machine that has been here before uses its own last times instead.
export const POST_BUILD = 18, POST_WARM = 39, SLOW = 1e6 /* bytes a second = 8 Mbit/s */;

export function phrase(s) {     // seconds -> { text, secs }: rounded the way a person would say it
  if (s < 8) return { text: 'a few seconds', secs: 5 };
  if (s < 27.5) { const r = Math.max(10, Math.round(s / 5) * 5); return { text: 'about ' + r + ' seconds', secs: r }; }
  if (s < 55) { const r = Math.round(s / 10) * 10; return { text: 'about ' + r + ' seconds', secs: r }; }
  if (s < 75) return { text: 'about a minute', secs: 60 };
  if (s < 105) return { text: 'about a minute and a half', secs: 90 };
  if (s < 135) return { text: 'about 2 minutes', secs: 120 };
  if (s < 315) { const h = Math.round(s / 30), m = Math.floor(h / 2); return { text: 'about ' + m + (h % 2 ? ' and a half' : '') + ' minutes', secs: h * 30 }; }
  if (s < 3300) { const m = Math.round(s / 60); return { text: 'about ' + m + ' minutes', secs: m * 60 }; }
  return { text: 'over an hour', secs: 3600 };
}

export class Eta {
  constructor(o = {}) { this.pb = o.build ?? POST_BUILD; this.pw = o.warm ?? POST_WARM; this.s = []; this.D = null; this.shown = null; this.tShown = -1e9; this.tMove = null; this.lastDone = -1; this.tPrev = null; this.speed = 0; this.stalled = false; this.slow = false; this.mb = null; this.tMb = -1e9; }
  // t seconds (any clock), done / total bytes, phase 'dl' | 'build' | 'warm' | 'ready', since = seconds in the build or warm phase
  step(t, done, total, phase, since = 0) {
    const dt = this.tPrev == null ? 0 : Math.max(0, Math.min(5, t - this.tPrev)); this.tPrev = t;
    if (done !== this.lastDone) { this.lastDone = done; this.tMove = t; if (this.stalled) { this.stalled = false; this.s = []; } }     /* after a pause the speed is measured afresh */ if (this.tMove == null) this.tMove = t;
    this.s.push([t, done]); while (this.s.length > 2 && this.s[1][0] <= t - 8) this.s.shift();     // the last 8 s
    const a = this.s[0], span = t - a[0]; let speed = span >= 2 ? (done - a[1]) / span : 0; this.speed = speed;
    const out = { phase, speed, mbit: speed * 8 / 1e6, secs: null, text: '', slow: false, stalled: false };
    if (phase === 'ready') { out.text = 'Ready'; return out; }
    let E;
    if (phase === 'dl') {
      if (done <= 0 || span < 2) { out.text = done > 0 ? 'Measuring your connection…' : ''; return out; }
      if (t - this.tMove >= 5 || speed <= 0) { out.stalled = this.stalled = true; out.text = 'The download has paused. Waiting for your connection…'; return out; }     // no promise while nothing arrives
      const dl = Math.max(0, total - done) / speed; E = dl + this.pb + this.pw; this.slow = this.slow ? !(speed > SLOW * 1.3 || dl < 20) : speed < SLOW && dl > 30; out.slow = this.slow;
      if (this.slow && (this.mb == null || (Math.abs(out.mbit - this.mb) > 0.15 * this.mb && t - this.tMb >= 4))) { this.mb = out.mbit; this.tMb = t; }     // the figure named in the slow line holds still too
    } else if (phase === 'build') E = Math.max(0, this.pb - since) + this.pw;
    else E = Math.max(0, this.pw - since);
    // the figure shown counts down with the clock and is drawn toward the fresh estimate over a few seconds, so it never jumps about
    if (this.D == null) this.D = E; else { this.D = Math.max(0, this.D - dt); const d = E - this.D; if (Math.abs(d) > Math.max(4, 0.12 * this.D)) this.D += d * Math.min(1, dt / 4); }
    const c = phrase(this.D + Math.min(8, 0.08 * this.D));     // rounded a little up: a promise is better kept early than late
    if (!this.shown) { this.shown = c; this.tShown = t; }
    else if (c.text !== this.shown.text) { const up = c.secs > this.shown.secs; if (t - this.tShown >= (up ? 6 : 2.5) && (!up || this.D > this.shown.secs * 1.25)) { this.shown = c; this.tShown = t; } }
    out.secs = this.shown.secs; const T = this.shown.text, Tc = T[0].toUpperCase() + T.slice(1), mb = Math.round(total / 1e6);
    if (phase === 'dl') out.text = out.slow ? Tc + ' left on this connection (' + (this.mb < 1 ? this.mb.toFixed(1) : Math.round(this.mb)) + ' Mbit/s). It is a ' + mb + ' MB city.' : Tc + ' left on your connection';
    else if (phase === 'build') out.text = 'Downloaded. ' + Tc + ' more while the city is built.';
    else out.text = this.D < 8 ? 'Nearly there…' : Tc + ' more: the last step.';
    return out;
  }
}

// ---- the page ----
const SLIDES = [
  ['drive', 'Take any car. <b>F</b> gets in and out, <b>W&nbsp;A&nbsp;S&nbsp;D</b> drives.'],
  ['heli', 'Fly the helicopter between the towers.'],
  ['subway', 'Walk down the stairs and ride the subway. On foot, hold <b>Shift</b> to run.'],
  ['shop', 'Doors open. Walk into the shops.'],
  ['night', 'Stay until night. Every car has a radio.'],
  ['map', '<b>Tab</b> opens the city map. <b>Esc</b> is the menu.'],
];

function start() {
  const W = window, D = document, T0 = D.title || 'CROSSTOWN', now = () => performance.now() / 1000;
  const S = (W.__loadwait = { title: T0, phase: 'dl', eta: null, slides: 0, called: false, kinds: 0 /* 1 "almost ready" shown, 2 "ready to play" shown */, callAt: 0, backAt: 0, chime: 'no', pics: [] });
  const icon = D.querySelector('link[rel="icon"]'), icon0 = icon ? icon.getAttribute('href') : null;
  let saved = null; try { saved = JSON.parse(localStorage.getItem('crosstown.loadwait') || 'null'); } catch (e) {}
  const ok = (x) => typeof x === 'number' && x >= 2 && x <= 150;
  const eta = new Eta(saved && ok(saved.b) && ok(saved.w) ? { build: saved.b, warm: saved.w } : {});
  let myTitle = null, dot = null, hidSeen = D.hidden, tBuild = null, tWarm = null, tHidWarm = null, flip = 0, chimed = false, over = false, etaEl = null, bg = null, css = null, slideT = null, cap = null;
  const setTitle = (s) => { if (D.title !== s) { D.title = s; } myTitle = s; };
  const setIcon = (on) => { if (!icon) return; try {
    if (!on) { if (icon.getAttribute('href') !== icon0) icon.setAttribute('href', icon0); return; }
    if (!dot) { const c = D.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#0b0c0e'; g.beginPath(); g.arc(32, 32, 31, 0, 7); g.fill(); g.fillStyle = '#ffb82e'; g.beginPath(); g.arc(32, 32, 21, 0, 7); g.fill(); dot = c.toDataURL('image/png'); }
    if (icon.getAttribute('href') !== dot) icon.setAttribute('href', dot); } catch (e) {} };
  // A sound only where the browser already lets this page play one: it has had a click or a key (userActivation), or says so itself
  // (Firefox's getAutoplayPolicy). Anything else: silence, no AudioContext made, so no console warning and nothing asked of the player.
  const chime = () => { if (chimed) return; chimed = true; try {
    const ua = navigator.userActivation, allowed = (ua && ua.hasBeenActive) || (navigator.getAutoplayPolicy && navigator.getAutoplayPolicy('audiocontext') === 'allowed');
    if (!allowed) { S.chime = 'not allowed: silent'; return; }
    let vol = 1; try { const st = JSON.parse(localStorage.getItem('crosstown.settings') || '{}'); if (typeof st['audio.master'] === 'number') vol = Math.max(0, Math.min(1, st['audio.master'])); } catch (e) {}
    if (vol <= 0) { S.chime = 'sound is off in settings'; return; }
    const AC = W.AudioContext || W.webkitAudioContext; if (!AC) return; const ac = new AC(); if (ac.state !== 'running') { S.chime = 'context not running: silent'; ac.close().catch(() => {}); return; }
    const t = ac.currentTime + 0.05; for (const [f, at] of [[659.25, 0], [987.77, 0.16]]) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.07 * vol, t + at + 0.03); g.gain.exponentialRampToValueAtTime(0.0005, t + at + 0.7); o.connect(g).connect(ac.destination); o.start(t + at); o.stop(t + at + 0.75); }
    S.chime = 'played'; setTimeout(() => ac.close().catch(() => {}), 1500); } catch (e) { S.chime = 'failed quietly'; } };

  // the pictures: behind the start text, one fetched at a time, the next one only when its turn is near
  const pictures = () => { const boot = D.getElementById('boot'), sb = D.getElementById('startbox'); if (!boot || !sb) return;
    css = D.createElement('style'); css.textContent = '#lwbg{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none;transition:opacity 1.2s}#lwbg i{position:absolute;inset:0;background:#0b0c0e center/cover no-repeat;opacity:0;transition:opacity 1.6s;filter:brightness(.62)}#lwbg i.on{opacity:1}#lwbg u{position:absolute;inset:0;background:linear-gradient(#0b0c0e99,#0b0c0e33 30%,#0b0c0e33 62%,#0b0c0ecc)}#lwcap{position:absolute;left:28px;bottom:26px;max-width:calc(50vw - 21em);font:500 17px/1.4 Helvetica,system-ui,sans-serif;color:#f2f2f2;text-shadow:0 1px 6px #000,0 0 2px #000;border-left:3px solid #ffb82e;background:rgba(11,12,14,.8);border-radius:0 8px 8px 0;padding:8px 14px 8px 12px;opacity:0;transition:opacity .8s}#lwcap b{color:#ffd27a;font-weight:700}#lwcap.on{opacity:1}@media (max-width:1180px){#lwcap{left:0;right:0;bottom:10px;max-width:none;text-align:center;border:0;background:none;padding:0 16px;font-size:14px}}@media (max-height:640px) and (max-width:1180px){#lwcap{display:none}}@media (prefers-reduced-motion:reduce){#lwbg i{transition:none}}#boot.lw>.title,#boot.lw>#startbox{position:relative;z-index:1}#boot.lw>.title{text-shadow:0 2px 14px #000}#boot.lw>#startbox{background:rgba(11,12,14,.84);border-radius:14px;padding-top:16px!important;padding-bottom:12px!important;box-shadow:0 0 0 1px rgba(255,210,122,.10)}';
    D.head.appendChild(css); bg = D.createElement('div'); bg.id = 'lwbg'; bg.innerHTML = '<i></i><i></i><u></u><div id="lwcap"></div>'; boot.insertBefore(bg, boot.firstChild); boot.classList.add('lw');
    const layers = bg.querySelectorAll('i'); cap = bg.querySelector('#lwcap'); let k = 0, front = 0, bad = 0;
    const next = () => { if (over || !bg) return; const [name, text] = SLIDES[k % SLIDES.length]; k++; const im = new Image();
      im.onload = () => { if (over || !bg) return; if (!S.pics.includes(name)) S.pics.push(name); front ^= 1; layers[front].style.backgroundImage = 'url("' + im.src + '")'; layers[front].classList.add('on'); layers[front ^ 1].classList.remove('on'); cap.classList.remove('on'); setTimeout(() => { if (cap) { cap.innerHTML = text; cap.classList.add('on'); } }, 500); S.slides++; slideT = setTimeout(next, 7000); };
      im.onerror = () => { if (++bad < SLIDES.length) slideT = setTimeout(next, 1500); };
      im.src = 'assets/wait/' + name + '.webp'; };
    next(); };

  const done = () => { over = true; clearInterval(iv); clearTimeout(slideT); D.removeEventListener('visibilitychange', tick); if (myTitle != null && D.title === myTitle) D.title = T0; setIcon(false); if (etaEl) etaEl.remove(); if (bg) bg.remove(); if (css) css.remove(); const b = D.getElementById('boot'); if (b) b.classList.remove('lw'); bg = cap = null; S.phase = 'over'; };
  const tick = () => { if (over) return; try {
    const L = W.__load; if (W.__blocked || !L) { done(); return; }     // phones and no-WebGL visitors: the plain message, untouched
    const t = now(), sb = D.getElementById('startbox'), shown = !!sb && sb.style.display !== 'none', boot = D.getElementById('boot');
    if (D.hidden) hidSeen = true; else if (S.callAt && !S.backAt) S.backAt = t;     /* for src/telemetry.js: the tab came back after the call-back (seconds on the page's clock) */
    if (W.__ready && !W.__warming && !W.__startScreen) { done(); return; }     // playing (or a tool that skips the start screen)
    const tot = Math.max(L.total || 250e6, L.done * 1.02), pct = Math.min(99, Math.floor(L.done / tot * 100));
    const building = (L.total && L.done >= L.total * 0.985) || (/game|compiled|warming/.test(L.stage) && performance.now() - (L.last || 0) > 1500);
    const phase = W.__startScreen ? 'ready' : W.__ready && W.__warming ? 'warm' : building ? 'build' : 'dl';
    if (phase !== 'dl' && tBuild == null) { tBuild = L.last ? L.last / 1000 : t; hidSeen = D.hidden; } if ((phase === 'warm' || phase === 'ready') && tWarm == null) tWarm = t;
    if (phase === 'ready' && S.phase !== 'ready') { chime(); if (!hidSeen && tBuild != null && tWarm != null) try { localStorage.setItem('crosstown.loadwait', JSON.stringify({ b: +(tWarm - tBuild).toFixed(1), w: +(t - tWarm).toFixed(1) })); } catch (e) {} }
    S.phase = phase;
    const e = eta.step(t, L.done, tot, phase, phase === 'build' ? t - tBuild : phase === 'warm' ? t - tWarm : 0); S.eta = e;
    // 2. the line under the bar
    if (shown && !etaEl) { const txt = D.getElementById('loadtxt'); if (txt && txt.parentNode) { etaEl = D.createElement('div'); etaEl.id = 'loadeta'; etaEl.setAttribute('aria-live', 'polite'); etaEl.style.cssText = 'margin-top:8px;min-height:1.45em;font:600 14px/1.45 Helvetica,system-ui,sans-serif;color:#ffd27a'; txt.parentNode.insertBefore(etaEl, txt); } }
    if (etaEl && etaEl.textContent !== e.text) etaEl.textContent = e.text;
    // 3. the pictures, once the game's own downloads are under way; they leave when PLAY is ready and the game itself shows behind the text
    if (shown && !bg && !css && phase !== 'ready' && (L.files > 0 || L.done > 2e5)) pictures();
    if (bg && phase === 'ready') bg.style.opacity = 0;
    // 1. the tab. While hidden a browser draws no frames, so the last step cannot finish there: once everything is in and the tab has
    // been hidden through 4 s of that step, the player is called back for it too (truthfully: "almost ready").
    if (phase === 'warm' && D.hidden) { if (tHidWarm == null) tHidWarm = t; } else tHidWarm = null;
    const call = D.hidden && (phase === 'ready' || (tHidWarm != null && t - tHidWarm >= 4));
    if (call) { if (!S.called) { S.called = true; S.callAt = t; chime(); } S.kinds |= phase === 'ready' ? 2 : 1; flip++; const a = phase === 'ready' ? '▶ Ready to play · ' + T0 : '▶ Almost ready · ' + T0, b = phase === 'ready' ? T0 + ' · ready ▶' : '● Come back to start · ' + T0; setTitle(Math.floor(flip / 3) % 2 ? b : a); setIcon(true); }
    else { setIcon(false); if (phase === 'ready') setTitle(T0); else if (L.done > 0) setTitle((phase === 'dl' ? Math.max(1, pct) : 99) + '% · ' + T0); }
  } catch (err) { /* never in the game's way */ } };
  const iv = setInterval(tick, 500); D.addEventListener('visibilitychange', tick);
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') try { start(); } catch (e) {}
