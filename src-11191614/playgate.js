// playgate.js (progress lane, Nov 15): the step between "ready" and a lit PLAY button. On only with ?playgate=1 (main.js then fetches this file and
// hands it the start screen's own arm() and go(); without the switch this file is never fetched and the page is as before).
// WHY (players' reports, lanes/INBOX.md progress 17:35 + 17:37 Nov 15): ready to PLAY lit took a median 33 s; 103 loads left in that step, 55 left with
// PLAY lit and unpressed; and a hidden tab draws no frames, so the old rule (which counts drawn frames) could never light PLAY in a background tab.
// WHAT IT DOES, three things:
//   1. PLAY lights as EARLY as is honest. On a visit whose shaders are already built (src/warmup.js, light lane, finds that out and skips its ramp;
//      read here, never changed) PLAY lights after ten frames, eight of them short in a row: the landmark buildings, which the old rule waits up to
//      12 s for, come in behind the lit button or in play (measured: no frame over 0.15 s). On a FIRST visit, where the shaders are built during this
//      step, PLAY lights at the old rule's own moment: lighting sooner was tried twice on a laptop and froze play each time (0.7 to 1.2 s).
//      A press BEFORE that is accepted too (?pgqueue=0 = not): the button says STARTING…, the dark screen lifts to show the city coming in, and the
//      game starts the moment the gate passes.
//   2. A HIDDEN TAB: time hidden counts against nothing (the 150 s cap and every wait run on seen time), the frame that follows a return is not held
//      against the player, and on a visit with the shaders already built PLAY lights while hidden, a second after ready, so loadwait.js's "Ready to
//      play" title calls the player back to a button that is already lit. If something draws frames in the hidden tab (the perf lane's
//      src/hidwarm.js runs them from a worker), those frames count like any others and the same rule lights PLAY while hidden, first visit or not.
//   3. PLAY IS OBVIOUS once lit: the button pulses and takes the keyboard focus, the line under it says "Press ENTER or click PLAY", and a click
//      anywhere on the start screen that is not a link, a button or the What's-new list starts the game.
// For the reports: window.__playgate = { on, readyAt, litAt, litBy: 'rule'|'early'|'return'|'cap', litHidden, rampAtLit, pressedAt, pressedBy,
//   queued, settledAt, hiddenSecs, hidFrames, frames } (seconds since the page began, as window.__readyAt). telemetry.js is not touched by this file.
// Other switches still work as before: ?warm=0 (the old 0.4 s way: this file then only does part 3), ?warmhero=0, ?warmramp=0|1, ?rampwait=1, ?earlycap.
// Test knobs: ?pgfresh=1 (an early PLAY on a first visit too, once ramp and landmarks are in: it froze play, see Gate), ?pgmin=<seconds after ready before an early PLAY> (default 0), ?pgqueue=0, ?pgearly=0 (the old rule's own moment, parts 2 and 3 only).

// ---- the rule (no page needed: lanes/progress/playgate/tools/gate.test.mjs) ----
// Times are milliseconds on the SEEN clock: the caller takes hidden time out before calling.
export class Gate {
  constructor(o = {}) { this.early = o.early !== false; this.min = o.min || 0; this.cap = o.cap || 150000; this.heroMax = o.heroMax || 12000; this.freshEarly = !!o.freshEarly; this.t0 = null; this.last = null; this.n = 0; this.okN = 0; this.progN = -1; this.progT = 0; this.baseT = 0; this.full = false; }
  begin(t) { this.t0 = this.last = this.progT = t; }
  // one drawn frame. s = { progs, ramping, mainIn, heroWait, fresh }. fresh = this visit builds its shaders (warmup.js did not find them built). Returns 'rule' (the old rule is met), 'early', 'cap' or null.
  frame(t, s) {
    if (this.t0 == null) this.begin(t);
    const dt = t - this.last; this.last = t; this.n++; this.okN = dt < 120 ? this.okN + 1 : 0;
    if (s.progs !== this.progN) { this.progN = s.progs; this.progT = t; }
    const base = this.n >= 45 && this.okN >= 20 && t - this.progT > 1000 && !s.ramping;     // main.js's rule, as it stands there
    if (base && !this.baseT) this.baseT = t;
    const hold = !!s.heroWait && this.baseT && t - this.baseT < this.heroMax;
    if (base && !hold) { this.full = true; return 'rule'; }
    if (t - this.t0 > this.cap) { this.full = true; return 'cap'; }
    // EARLY only where src/warmup.js found the shaders ALREADY BUILT (it then skips its ramp: a visit after the first). Measured on laptops, Nov 15
    // (README): on such a visit PLAY lit 3.5 s after ready, not 10.0, and the landmark buildings then arrived in play with no frame over 0.15 s.
    // On a visit that builds its shaders (s.fresh) two earlier gates were tried and both froze play: PLAY at the end of the ramp without the
    // landmarks gave a frame of 1.24 s in play (the old rule: 0.35 s); with the landmarks but without the old rule's quiet second, one of 0.74 s came
    // 1.9 s after PLAY lit. There the old rule is the honest moment and stays as it is (?pgfresh=1 = the second of those gates, for a re-test).
    if (this.early && (!s.fresh || this.freshEarly) && s.mainIn && !s.ramping && !(s.fresh && s.heroWait) && this.n >= 10 && this.okN >= 8 && t - this.t0 >= this.min) return 'early';
    return null;
  }
  // no frame can be drawn (hidden tab). True when nothing that is left needs one before the player may press: the shaders are already built.
  blind(t, s) { if (this.t0 == null) this.begin(t); return this.early && !s.fresh && !s.ramping && t - this.t0 >= Math.max(this.min, 1000); }
}

// ---- the page ----
export function install(ctx) {
  const { game, world, renderer, warm, P, arm, go, pb, boot } = ctx, W = window, D = document, sec = () => +(performance.now() / 1000).toFixed(1);
  const S = (W.__playgate = { on: true, v: 1, readyAt: null, litAt: null, litBy: null, litHidden: false, rampAtLit: null, pressedAt: null, pressedBy: null, queued: false, settledAt: null, hiddenSecs: 0, hidFrames: 0, frames: 0 });
  const QUEUE = P.get('pgqueue') !== '0', OLDWAY = P.get('warm') === '0';
  const gate = new Gate({ early: P.get('pgearly') !== '0', min: Math.max(0, +(P.get('pgmin') || 0)) * 1000, freshEarly: P.get('pgfresh') === '1' });
  let hidAt = D.hidden ? performance.now() : 0, hidMs = 0, readyReal = 0, backAt = -1e9, wasHid = false, lit = false, started = false, note = null, css = null, raf = 0, iv = 0;
  const seen = (now) => now - hidMs - (hidAt ? now - hidAt : 0);     // the seen clock
  const onVis = () => { const now = performance.now(); if (D.hidden) { if (!hidAt) hidAt = now; wasHid = true; } else if (hidAt) { hidMs += now - hidAt; hidAt = 0; backAt = now; gate.last = seen(now); if (lit && !started) { if (S.queued) { begun(S.pressedBy); go(); } else try { pb.focus({ preventScroll: true }); } catch (e) {} } } S.hiddenSecs = +((hidMs + (hidAt ? now - hidAt : 0)) / 1000).toFixed(1); };
  const rampState = () => { const ws = warm && warm.S; if (!ws || !ws.ramp) return 'none'; if (!ws.ramping) return 'done'; return ws.ramp.mSteps > 0 ? 'mirror' : 'main'; };
  const look = () => { const ws = warm && warm.S, rs = rampState(), hs = world.heroState;
    return { progs: renderer.info.programs ? renderer.info.programs.length : 0, ramping: !!(ws && ws.ramping), mainIn: rs !== 'main', fresh: !(ws && ws.rampSkipped !== undefined) /* only warmup.js's own finding that the shaders are already built (it then skips its ramp) allows an early PLAY */,
      heroWait: !!(warm && P.get('warmhero') !== '0' && hs && hs.late && !hs.done) }; };

  // part 3: what the lit button looks like
  const style = () => { if (css) return; css = D.createElement('style'); css.textContent = '@keyframes pgpulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,210,122,.6)}50%{transform:scale(1.05);box-shadow:0 0 0 14px rgba(255,210,122,0)}}#playbtn.pglit{animation:pgpulse 1.5s ease-in-out infinite}#playbtn.pglit:focus-visible{outline:2px solid #fff;outline-offset:3px}#pgnote{margin:10px 0 0;min-height:2.9em;font:600 14px/1.45 Helvetica,system-ui,sans-serif;color:#ffd27a}#pgnote small{display:block;font-weight:400;font-size:12px;color:#e8e8e8;opacity:.75}#boot.pgclick{cursor:pointer}#boot.pgclick a,#boot.pgclick details{cursor:auto}#boot.pglift{background:rgba(11,12,14,.3)!important;transition:background .6s}#boot.pglift #startbox>*:not(#playbtn):not(#pgnote){visibility:hidden}#boot.pglift #startbox{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}#boot.pglift #pgnote{text-shadow:0 1px 3px #000,0 0 10px #000}#boot.pglift #lwbg{display:none}@media (prefers-reduced-motion:reduce){#playbtn.pglit{animation:none;box-shadow:0 0 0 3px rgba(255,210,122,.6)}}'; D.head.appendChild(css); };
  const say = (main, small) => { try { style(); if (!note) { note = D.createElement('div'); note.id = 'pgnote'; note.setAttribute('aria-live', 'polite'); pb.insertAdjacentElement('afterend', note); } note.innerHTML = main + (small ? '<small>' + small + '</small>' : ''); } catch (e) {} };
  const clean = () => { cancelAnimationFrame(raf); clearInterval(iv); D.removeEventListener('visibilitychange', onVis); removeEventListener('keydown', onKey, true); try { boot.removeEventListener('click', onPanel); pb.classList.remove('pglit'); if (css) setTimeout(() => { try { css.remove(); } catch (e) {} }, 800); } catch (e) {} };
  const begun = (how) => { if (started) return; started = true; if (!S.pressedAt) { S.pressedAt = sec(); S.pressedBy = how; } clean(); };

  const light = (by) => { if (lit) return; lit = true; const now = performance.now();
    S.litAt = sec(); S.litHidden = D.hidden; S.hiddenSecs = +((hidMs + (hidAt ? now - hidAt : 0)) / 1000).toFixed(1); S.rampAtLit = rampState(); S.frames = gate.n; S.litBy = by === 'cap' ? 'cap' : (D.hidden || (wasHid && now - backAt < 3000)) ? 'return' : by;
    if (!W.__startScreen) arm();     /* main.js's own: Play enabled, __warming off, __startScreen on, the 'warm' mark */
    console.log('[game] playgate: PLAY lit ' + S.litAt + ' s (' + S.litBy + ', ramp ' + S.rampAtLit + ', ' + gate.n + ' frames, hidden ' + S.hiddenSecs + ' s)');
    if (S.queued && !D.hidden) { begun(S.pressedBy); go(); return; }     /* pressed while it was still coming in: start now (in a hidden tab: on the return, see onVis; no game and no sound start behind the player's back) */
    if (!gate.full && !OLDWAY) game.paused = false;     /* lit early: the picture keeps drawing behind the button, so what is left is built now, not in play */ else S.settledAt = S.litAt;
    try { pb.classList.add('pglit'); boot.classList.add('pgclick'); const lw = D.getElementById('loadwrap'); if (lw) lw.style.opacity = 0; if (!D.hidden) pb.focus({ preventScroll: true }); } catch (e) {}
    say('Press ENTER or click PLAY', gate.full || OLDWAY ? '' : 'A few landmark buildings are still coming in.'); };
  const settle = () => { if (S.settledAt != null) return; S.settledAt = sec(); if (W.__startScreen) { game.paused = true; say('Press ENTER or click PLAY', ''); } };

  // a press: the button, Enter or Space, or a click on the screen itself
  const press = (how) => { if (started) return;
    if (lit) { if (!S.pressedAt) { S.pressedAt = sec(); S.pressedBy = how; } go(); begun(how); return; }
    if (!QUEUE || OLDWAY || S.queued || !W.__ready || !W.__warming) return;
    S.queued = true; S.pressedAt = sec(); S.pressedBy = how; try { style(); pb.textContent = 'STARTING…'; pb.style.opacity = 1; boot.classList.add('pglift'); } catch (e) {} say('Starting as soon as the city is in', ''); };
  const onKey = (e) => { if (e.repeat || (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter')) return; if (e.target && e.target.closest && e.target.closest('input,textarea,select,#fbbox,summary,a')) return;
    if (lit || (W.__ready && W.__warming && QUEUE && !OLDWAY)) { e.preventDefault(); e.stopPropagation(); press('key'); } };
  const onPanel = (e) => { const t = e.target; if (t === pb || (pb.contains && pb.contains(t))) { press('button'); return; } if (!lit) return; if (t && t.closest && t.closest('a,button,input,select,textarea,label,details,summary,#fbbox')) return; press('panel'); };
  addEventListener('keydown', onKey, true); boot.addEventListener('click', onPanel); D.addEventListener('visibilitychange', onVis);

  // the timer: what a hidden tab can still do, the old 0.4 s way, a controller's press, and the end
  iv = setInterval(() => { try {
    if (started) return; if (lit && !W.__startScreen) { begun('other'); return; }     /* main.js's own listeners started it (a controller) */
    if (!lit && W.__startScreen) { gate.full = true; light('rule'); return; }     /* ?warm=0: main.js lit it itself */
    if (!lit && D.hidden && gate.t0 != null && gate.blind(gate.t0 + (performance.now() - readyReal), look())) light('early');
  } catch (e) {} }, 250);

  if (OLDWAY) return;     // ?warm=0: main.js's __armPlay stays; the timer above sees the button light
  // parts 1 and 2: this takes the place of main.js's __armPlay (same rule, same line in the console, plus the early gate and the seen clock)
  W.__armPlay = () => { S.readyAt = sec(); readyReal = performance.now(); gate.begin(seen(readyReal));
    if (QUEUE) try { style(); pb.disabled = false; pb.textContent = 'PLAY'; pb.style.opacity = 0.8; say('', 'You can press PLAY now: the game starts the moment the city is in.'); } catch (e) {}
    const tick = (now) => { if (started) return; raf = requestAnimationFrame(tick);
      if (D.hidden) { const p = performance.now(); if (hidAt) { const c = Math.min(p - hidAt, 100); hidMs += p - hidAt - c; hidAt = p; } S.hidFrames++; now = p; }     /* a frame in a hidden tab: something runs them for us (perf lane's src/hidwarm.js does, from a worker's beat). They count as seen frames, each for at most 0.1 s */
      const r = gate.frame(seen(now), look());
      if (!lit) { if (r) { if (r === 'rule' || r === 'cap') console.log('[game] warm-up: ' + gate.n + ' frames in ' + ((seen(now) - gate.t0) / 1000).toFixed(1) + ' s, ' + gate.progN + ' programs'); light(r); if (gate.full) cancelAnimationFrame(raf); } }
      else if (r === 'rule' || r === 'cap') { cancelAnimationFrame(raf); settle(); } };
    raf = requestAnimationFrame(tick); };
}
