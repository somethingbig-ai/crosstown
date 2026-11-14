// look.js (gameplay lane, input; player report 20261113205635-1de458: "the mouse is on the screen while I control the camera; I can't keep
// turning because it hits the screen edge", 19 uncaught 'UnknownError' rejections of requestPointerLock).
//
// One place asks the browser to capture the mouse. It never throws and never leaves a rejected promise uncaught, it does not ask again while a
// request is out or, once Chrome has said "just exited" (it refuses for 1.25 s after the player's Esc), until that time has passed, and when the browser
// refuses for good it says so and gives the player other ways to turn the camera:
//   - the game already turns the camera with the free mouse (game.js, Matt Nov 10); that stays;
//   - the arrow keys turn the camera (they stop driving; WASD drives);                                  } only while the capture is REFUSED,
//   - the mouse resting at the left or right edge of the picture keeps turning (?edge=0 off);           } never for a player whose capture works
//   - a small "Click to look" line is up whenever the mouse is not captured during play (?hint=0 off).
// The request: the plain one the game always made comes first, so nothing changes for a player whose capture works. If the browser refuses it
// with anything but "not now", the same request is made with unadjustedMovement: true (the raw-input road), and whichever one worked is asked
// first from then on. ?rawmouse=1 turns the order round (raw first, plain second).
// Test switches (no effect unless in the address): ?locktest=refuse every request is refused as on the reporter's machine; ?locktest=raw only
// the raw request is refused; ?locktest=plain only the plain one.
const EXIT_WAIT = 1300;                    // ms; Chrome: "Pointer lock cannot be acquired immediately after the user has exited the lock" for 1250 ms
const PLAIN = null, RAW = { unadjustedMovement: true };
const YAW_KEYS = 620, PITCH_KEYS = 380, YAW_EDGE = 520, EDGE_PX = 10;      // look units a second (game.js: one unit is 0.0028 rad of yaw, 0.002 of pitch)

export class LookCtl {
  constructor(game, canvas, env) {
    const E = env || {}; this.g = game; this.c = canvas; this.doc = E.document || document; this.win = E.window || window;
    this.now = E.now || (() => performance.now()); const P = game.P || { get: () => null };
    this.order = P.get('rawmouse') === '1' ? [RAW, PLAIN] : [PLAIN, RAW]; this.test = P.get('locktest') || ''; this.edge = P.get('edge') !== '0'; this.hintOn = P.get('hint') !== '0';
    this.busy = false;        // a request is out
    this.pending = false;     // the last ask could not be made or was turned down with "not now": the next click or key asks again
    this.refused = false;     // the browser will not capture the mouse here: the other ways to look are on
    this.coolUntil = 0; this.hard = 0; this.soft = 0; this.was = false; this.everHeld = false; this.arrows = false;
    this.asked = 0; this.failed = 0;      // counts, for the tests and for the one console line
    this.keys = new Set(); this.mx = -1; this.onCanvas = false; this.el = null; this.shown = '';
    const d = this.doc, w = this.win;
    d.addEventListener('pointerlockchange', () => this._change());
    d.addEventListener('pointerlockerror', () => { if (this.busy && !this._prom) this._fail({ name: 'pointerlockerror', message: '' }, this._i); });
    w.addEventListener('mousemove', (e) => { this.mx = e.clientX; this.onCanvas = e.target === this.c; });
    w.addEventListener('keyup', (e) => this.keys.delete(e.code)); w.addEventListener('blur', () => { this.keys.clear(); this.onCanvas = false; });
    if (d.documentElement && d.documentElement.addEventListener) d.documentElement.addEventListener('mouseleave', () => { this.onCanvas = false; });
    if (this.hintOn && w.setInterval) w.setInterval(() => this._hint(), 250);
  }
  held() { return this.doc.pointerLockElement === this.c; }
  // play is live: not the start screen, not the demo (unless flying it), not a capture run, not while the feedback form is open
  live() { const g = this.g, fb = this.doc.getElementById && this.doc.getElementById('fbbox'); return !this.win.__startScreen && (!g.demo || !!(g.fly && g.fly.on)) && !g.capture && !(fb && fb.style.display !== 'none'); }
  // true while the game's own mouse handlers should treat the free mouse as the captured one (fire, aim)
  free() { return this.refused && !this.held() && this.live(); }

  // Ask for the mouse. why: 'click' | 'key' | 'play'. Safe to call from any handler, any number of times.
  ask(why) {
    try {
      if (this.busy || this.held() || !this.c.requestPointerLock) return false;
      if (this.refused && why === 'key') return false;                         // after a refusal only a click asks again (a key press every time would be a request a second)
      if (this.now() < this.coolUntil) { this.pending = true; this._hint(); return false; }
      this._req(0); return true;
    } catch (e) { this.busy = false; return false; }
  }
  _native(o) {
    const t = this.test; if (t === 'refuse' || (t === 'raw' && o) || (t === 'plain' && !o)) return Promise.reject(Object.assign(new Error('refused by the ?locktest switch'), { name: 'UnknownError' }));
    return o ? this.c.requestPointerLock(o) : this.c.requestPointerLock();
  }
  _req(i) {
    this.busy = true; this._i = i; this._prom = false; this.asked++; let p;
    try { p = this._native(this.order[i]); } catch (e) { this._fail(e, i); return; }
    if (p && typeof p.then === 'function') { this._prom = true; p.then(() => this._ok(i), (e) => this._fail(e, i)); }
    else { const n = this.asked; this.win.setTimeout(() => { if (this.busy && this.asked === n) { if (this.held()) this._ok(i); else this._fail({ name: 'timeout', message: '' }, i); } }, 1500); }     // a browser with no promise answers by event; if neither event comes, stop waiting
  }
  _ok(i) {
    if (i === 1) { this.order.reverse(); try { console.log('[look] mouse captured by the ' + (this.order[0] ? 'raw' : 'plain') + ' request after the other was refused'); } catch (e) {} }
    this.busy = false; this.pending = false; this.refused = false; this.hard = this.soft = 0; this.was = true; this.everHeld = true; this.keys.clear(); this._hint();
  }
  _fail(e, i) {
    this.failed++; const name = (e && e.name) || '', msg = (e && e.message) || '';
    const exited = name === 'SecurityError' || /exited the lock|immediately after/i.test(msg);
    const notNow = exited || name === 'NotAllowedError' || name === 'WrongDocumentError' || name === 'InvalidStateError' || name === 'InUseAttributeError' || name === 'pointerlockerror' || name === 'timeout';
    if (!notNow && i === 0 && this.order.length > 1) { this._req(1); return; }                              // refused outright: the other kind of request, once
    this.busy = false; const t = this.now();
    if (notNow) {
      this.soft++; this.pending = true; this.coolUntil = Math.max(this.coolUntil, exited ? Math.max(t + 250, (this.exitAt === undefined ? t : this.exitAt) + EXIT_WAIT) : t + 1000);     // "just exited": no further request until 1.3 s after the exit
      if (this.soft >= 4) this._refuse(name, msg, t);                                                         // "not now" four times running with no capture between: treat it as a refusal so the player is not left without a way to look
    } else this._refuse(name, msg, t);
    this._hint();
  }
  _refuse(name, msg, t) {
    this.hard++; this.coolUntil = Math.max(this.coolUntil, t + Math.min(30000, 1000 * 2 ** (this.hard - 1)));     // 1, 2, 4 ... 30 s between retries
    if (!this.refused) { this.refused = true; try { console.log('[look] the browser will not capture the mouse (' + name + (msg ? ': ' + String(msg).slice(0, 80) : '') + '); arrow keys and the free mouse turn the camera'); } catch (e) {} }
  }
  _change() {
    const h = this.held();
    if (h) { if (this.busy && !this._prom) this._ok(this._i); else { this.was = true; this.everHeld = true; this.pending = false; this.refused = false; this.hard = this.soft = 0; this.keys.clear(); } }
    else if (this.was) { this.was = false; this.exitAt = this.now(); }      // no wait is set here: the game's own exits (the feedback key) may be followed by a capture at once; only the player's Esc makes Chrome refuse, and that refusal is caught below
    this._hint();
  }

  // game.js keydown: true when this arrow key turns the camera and must not reach the driving keys
  key(e) {
    if (!/^Arrow/.test(e.code) || !this._turnKeys()) return false; this.keys.add(e.code); return true;
  }
  _turnKeys() { const g = this.g; return this.refused && !this.held() && this.live() && !g.demo && !(g.fly && g.fly.on) && !(g.heli && g.heli.piloted); }
  // game.js step, after readInput: adds the arrow keys' and the picture edge's turning to the look input
  update(dt, I) {
    this.arrows = true;
    if (!this._turnKeys()) { if (this.keys.size) this.keys.clear(); return; }
    const K = this.keys;
    if (K.size) { I.lookX += ((K.has('ArrowRight') ? 1 : 0) - (K.has('ArrowLeft') ? 1 : 0)) * YAW_KEYS * dt; I.lookY += ((K.has('ArrowDown') ? 1 : 0) - (K.has('ArrowUp') ? 1 : 0)) * PITCH_KEYS * dt; }
    if (this.edge && this.onCanvas && this.mx >= 0 && (!this.doc.hasFocus || this.doc.hasFocus())) { const w = this.win.innerWidth || 0; if (this.mx < EDGE_PX) I.lookX -= YAW_EDGE * dt; else if (w && this.mx >= w - EDGE_PX) I.lookX += YAW_EDGE * dt; }
  }

  // the small line at the top of the picture
  text() {
    if (!this.hintOn || this.held() || !this.live()) return '';
    if (this.refused) return this.arrows ? 'Mouse not captured by the browser · move it or use the arrow keys to look · click to try again' : 'Mouse not captured by the browser · click to try again';
    if (this.g._padSeen && !this.everHeld) return '';                                                        // a controller player never needed the mouse
    return 'Click to look';
  }
  _hint() {
    try {
      const s = this.text(); if (s === this.shown) return; this.shown = s;
      if (!this.el) { if (!s || !this.doc.createElement || !this.doc.body) return; const d = (this.el = this.doc.createElement('div')); d.id = 'lookhint';
        d.style.cssText = 'position:fixed;left:50%;top:52px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 13px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.72);border:1px solid rgba(255,255,255,.22);padding:6px 13px;border-radius:8px;white-space:nowrap;max-width:94vw;overflow:hidden;text-overflow:ellipsis'; this.doc.body.appendChild(d); }
      this.el.textContent = s; this.el.style.display = s ? '' : 'none';
    } catch (e) {}
  }
}
