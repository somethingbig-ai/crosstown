// menu/menu.js (progress lane, Nov 14): the pause and settings menu. ?menu=0 leaves it out (P then pauses as before).
//   Esc, P (rebindable) or controller Start: the game stops (game.paused, so no sim step), all sound goes silent, the mouse is freed, the menu opens.
//   Resume (or Esc / P / Start again) closes it and takes the mouse back through look.js (after Chrome's 1.25 s wait when the player left with Esc).
//   Pages: Graphics (Auto / Low / Medium / High), Controls (every key, rebinding, mouse), Controller (drawn pad), Audio, Subtitles; other
//   lanes add theirs with game.menu.addPage / addSetting. Settings: game.settings (settings.js), localStorage 'crosstown.settings'.
// What this file touches outside itself, all through small hooks the game files read (see handover/src.patch):
//   game.qPin (game.js start(): the frame-rate governor runs only when this is false), game.lookS (mouse and stick look scale: game.js, heli.js),
//   game.hud.subs (hud.js: the dispatcher line), game.sound.bus (sirens and horns connect to bus.sirens: heatcar.js, drivers.js).
// Keys: one capture-phase listener rewrites e.code to the logical code (keys.js) before any game listener; typed text is never touched.
import { Settings } from './settings.js';
import { Keys, MOUSE } from './keys.js';
import { padSvg, PAD_MODES, PAD_NAMES, readPad, padStyle } from './pad.js';

const PRESET = { low: { scale: 0.57, ao: false, detail: 0.5 }, medium: { scale: 0.8, ao: true, detail: 0.8 }, high: { scale: 1.3, ao: true, detail: 1 } };
const QNAME = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
const BUS = { engine: 0.8, effects: 1, sirens: 0.8, heli: 0.8, ambience: 0.8, radio: 1 };      // what each bus plays at with its slider at 100% (0.8: what game.sound.out gave before)
const PASS = new Set(['KeyM', 'Digit0', 'Backslash', 'KeyB']);      // keys that still reach the game while the menu is open: sound, frame-rate counter, full screen, feedback
const DEFAULTS = { quality: 'auto', 'hud.fps': false, 'look.sens': 1, 'look.invertY': false, 'pad.sens': 1, 'pad.style': 'auto', 'audio.master': 1, 'audio.engine': 1, 'audio.effects': 1, 'audio.sirens': 1, 'audio.heli': 1, 'audio.ambience': 1, 'audio.radio': 0.8, 'subs.on': true, 'subs.size': 1, keys: {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STYLE = `
#ctmenu{position:fixed;inset:0;z-index:65;display:none;align-items:center;justify-content:center;background:rgba(8,9,10,.62);font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#fff;-webkit-user-select:none;user-select:none}
#ctmenu.open{display:flex}
#ctmenu *{box-sizing:border-box}
#ctmenu .box{display:flex;width:min(1080px,95vw);height:min(680px,92vh);background:rgba(12,13,15,.93);border-radius:10px;overflow:hidden;box-shadow:0 14px 70px rgba(0,0,0,.6)}
#ctmenu .nav{width:232px;flex:none;display:flex;flex-direction:column;padding:26px 0 14px;background:rgba(255,255,255,.03);border-right:1px solid rgba(255,255,255,.08);overflow-y:auto}
#ctmenu .brand{padding:0 26px 18px}
#ctmenu .brand b{display:block;font-size:12px;font-weight:700;letter-spacing:.24em;color:#ffb82e}
#ctmenu .brand span{display:block;margin-top:5px;font-size:25px;font-weight:800;letter-spacing:.04em}
#ctmenu .nbtn{display:block;width:100%;text-align:left;border:0;background:none;color:rgba(255,255,255,.78);font:600 16px "Helvetica Neue",Helvetica,Arial,sans-serif;padding:11px 26px 11px 22px;border-left:4px solid transparent;cursor:pointer;outline:none}
#ctmenu .nbtn:hover{color:#fff;background:rgba(255,255,255,.05)}
#ctmenu .nbtn.sel{color:#fff;border-left-color:#ffb82e;background:rgba(255,184,46,.09)}
#ctmenu .nbtn:focus-visible,#ctmenu .nbtn.kf:focus{background:rgba(255,184,46,.2);color:#fff}
#ctmenu .nbtn.go{color:#111;background:#ffb82e;margin:0 22px 14px;width:auto;border-radius:7px;border-left:0;padding:11px 18px;font-weight:700;letter-spacing:.06em}
#ctmenu .nbtn.go:focus{box-shadow:0 0 0 3px rgba(255,255,255,.85)}
#ctmenu .nbtn.low{font-size:14px;font-weight:500;color:rgba(255,255,255,.62);padding-top:8px;padding-bottom:8px}
#ctmenu .grow{flex:1;min-height:10px}
#ctmenu .main{flex:1;min-width:0;display:flex;flex-direction:column}
#ctmenu .head{padding:26px 34px 10px;font-size:25px;font-weight:700}
#ctmenu .page{flex:1;overflow-y:auto;padding:4px 34px 18px;scrollbar-color:rgba(255,255,255,.3) transparent}
#ctmenu .foot{padding:11px 34px;font-size:12.5px;letter-spacing:.04em;color:rgba(255,255,255,.6);border-top:1px solid rgba(255,255,255,.08);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ctmenu .foot b{color:#ffb82e;font-weight:700;margin:0 5px 0 12px}
#ctmenu .foot b:first-child{margin-left:0}
#ctmenu h3{margin:20px 0 6px;font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#ffb82e}
#ctmenu h3:first-child{margin-top:6px}
#ctmenu p.note{margin:8px 0;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.68)}
#ctmenu p.warn{margin:8px 0;padding:9px 12px;border-radius:6px;font-size:14px;line-height:1.45;color:#fff;background:rgba(255,90,69,.2);border:1px solid rgba(255,90,69,.65)}
#ctmenu p.good{margin:8px 0;padding:9px 12px;border-radius:6px;font-size:14px;color:#fff;background:rgba(255,184,46,.12);border:1px solid rgba(255,184,46,.4)}
#ctmenu .mrow{display:flex;align-items:center;gap:16px;min-height:46px;padding:5px 12px;margin:0 -12px;border-radius:7px;outline:none}
#ctmenu .mrow:focus{background:rgba(255,184,46,.13);box-shadow:inset 0 0 0 1.5px rgba(255,184,46,.75)}
#ctmenu .mrow.fixed{opacity:.8}
#ctmenu .lab{flex:1;min-width:0;font-size:16px;font-weight:500}
#ctmenu .lab small{display:block;margin-top:2px;font-size:12.5px;font-weight:400;color:rgba(255,255,255,.55)}
#ctmenu .ctl{flex:none;display:flex;align-items:center;gap:10px}
#ctmenu input[type=range]{width:230px;accent-color:#ffb82e;cursor:pointer;outline:none}
#ctmenu .val{width:54px;text-align:right;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
#ctmenu .seg{display:flex;border-radius:7px;overflow:hidden;border:1px solid rgba(255,255,255,.22)}
#ctmenu .seg button{border:0;background:none;color:rgba(255,255,255,.8);font:600 14px "Helvetica Neue",Helvetica,Arial,sans-serif;padding:8px 15px;cursor:pointer;outline:none;border-left:1px solid rgba(255,255,255,.14)}
#ctmenu .seg button:first-child{border-left:0}
#ctmenu .seg button:hover{background:rgba(255,255,255,.08)}
#ctmenu .seg button.on{background:#ffb82e;color:#111}
#ctmenu .seg button small{display:block;font-size:11px;font-weight:500;opacity:.75;margin-top:1px}
#ctmenu .mbtn{border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.05);color:#fff;font:600 14px "Helvetica Neue",Helvetica,Arial,sans-serif;padding:9px 16px;border-radius:7px;cursor:pointer;outline:none;margin:6px 10px 6px 0}
#ctmenu .mbtn:hover{background:rgba(255,255,255,.12)}
#ctmenu .mbtn:focus{border-color:#ffb82e;background:rgba(255,184,46,.2)}
#ctmenu .mbtn:disabled{opacity:.4;cursor:default}
#ctmenu .kcap{display:inline-block;min-width:44px;text-align:center;padding:6px 11px;border-radius:6px;background:#24272c;border:1px solid rgba(255,255,255,.28);border-bottom-width:3px;font-size:14px;font-weight:700;cursor:pointer}
#ctmenu .kcap.chg{border-color:#ffb82e;color:#ffb82e}
#ctmenu .kcap.none{color:#ff8a78;border-color:rgba(255,90,69,.7)}
#ctmenu .kcap.wait{background:#ffb82e;color:#111;border-color:#ffb82e}
#ctmenu .krow{min-height:40px}
#ctmenu .krow .lab{font-size:15px}
#ctmenu .padbox{margin:6px 0 2px;padding:8px 4px;border-radius:8px;background:rgba(255,255,255,.03)}
#ctmenu .subprev{margin:14px 0;padding:14px;border-radius:6px;background:rgba(12,13,15,.78);text-align:center;font-weight:500;min-height:30px;border:1px dashed rgba(255,255,255,.18)}
#ctfps{position:fixed;right:14px;top:6px;z-index:56;pointer-events:none;font:600 12px "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.06em;color:#fff;text-shadow:0 1px 3px #000;display:none}
#ctfps b{color:#ffb82e}
@media (max-width:760px){#ctmenu .nav{width:170px}#ctmenu input[type=range]{width:130px}#ctmenu .head,#ctmenu .page,#ctmenu .foot{padding-left:18px;padding-right:18px}}
`;
function h(tag, props, ...kids) { const e = document.createElement(tag); if (props) for (const k in props) { if (k === 'style') e.style.cssText = props[k]; else if (k.startsWith('data-')) e.setAttribute(k, props[k]); else e[k] = props[k]; } for (const c of kids) if (c != null) e.append(c); return e; }

export function install(g) {
  if (g.menu || g.capture || typeof document === 'undefined') return;
  const S = (g.settings = g.settings || new Settings()); for (const k in DEFAULTS) S.def(k, DEFAULTS[k]);
  const K = new Keys(S), P = g.P || { has: () => false, get: () => null };
  const st = { open: false, page: 'graphics', rows: [], capture: null, keyMsg: null, closing: false, padUsed: false, padMode: 'foot', lockHeld: false, selfExit: false, escAt: -1e9, resetArm: 0, fpsBy: {}, fpsS: [], liveAt: performance.now(), hintWas: null, applied: false };
  const pages = [], extra = {};

  // ------------------------------------------------------------------ what the settings drive
  // Quality. Auto is the game's own governor (game.js start(): picture size, ambient occlusion and detail follow the frame rate). A fixed preset
  // sets game.qPin, which stops the governor, and pins all three. ?px= ?ao= ?detail= in the address still win over a preset, as they do over the governor.
  const redraw = () => { if (g.paused) requestAnimationFrame(() => { try { g.world.render(g.t || 0); g.hud.draw(); } catch (e) {} }); };      // paused: nothing draws, and a resize clears the picture
  const pin = (scale, ao, detail) => { const w = g.world; try { if (!P.has('px') && window.__fit) { w.liveScale = scale; window.__fit(); } if (w.gtao && !P.has('ao')) w.gtao.enabled = ao; if (!P.has('detail')) g.setDetail(detail); } catch (e) { console.log('[menu] quality: ' + (e && e.message)); } redraw(); };
  const applyQuality = (first) => {
    const q = S.get('quality'), p = PRESET[q]; st.fpsS.length = 0; st.liveAt = performance.now();
    if (p) { g.qPin = true; pin(p.scale, p.ao, p.detail); return; }
    g.qPin = false; if (first) return;      // Auto from the start: nothing is touched, the game behaves as it always has
    // back to Auto from a fixed preset: start again from the full picture (a weak graphics card: from its floor) and let the governor move it
    g._ceil = 0; g._aoCeil = 0; g._upAt = 0; g._slow = g._slow2 = g._slowD = g._fast = g._fastD = 0; g._govT = Math.min(g._govT || 0, 4);
    if (g.weakGpu) pin(0.57, false, 0.5); else pin(1, true, 1);
  };
  const applyLook = () => { const s = clamp(+S.get('look.sens') || 1, 0.1, 4), ps = clamp(+S.get('pad.sens') || 1, 0.1, 4), inv = S.get('look.invertY') ? -1 : 1, fly = !!(g.heli && g.heli.piloted && g.heli.mouseFly);      /* while the mouse flies the helicopter (G) its up/down is the stick, not the view: never inverted */
    const L = g.lookS || (g.lookS = {}); L.x = s; L.y = s * (fly ? 1 : inv); L.px = ps; L.py = ps * inv; st.flyWas = fly; };
  const applySubs = () => { if (g.hud) g.hud.subs = { on: S.get('subs.on') !== false, k: clamp(+S.get('subs.size') || 1, 0.6, 2) }; };
  // Sound: game.sound.out -> destination becomes  [engine | out (effects) | sirens | heli | ambience | radio] -> master -> destination.
  const applyAudio = () => { const s = g.sound; if (!s || !s.bus || !s.ac) return; try { const t = s.ac.currentTime; for (const k in BUS) s.bus[k].gain.setTargetAtTime(BUS[k] * clamp(+S.get('audio.' + k), 0, 1), t, 0.02); s.master.gain.setTargetAtTime(st.open || s.muted ? 0 : clamp(+S.get('audio.master'), 0, 1), t, 0.025); } catch (e) {} };
  const setupAudio = () => {
    const s = g.sound; if (!s || !s.on || !s.ac || !s.out || s.bus) return; const ac = s.ac;
    try {
      const master = ac.createGain(), bus = {}; master.connect(ac.destination); for (const k in BUS) { bus[k] = ac.createGain(); bus[k].connect(master); }
      try { s.out.disconnect(); s.out.connect(bus.effects); } catch (e) { s.out.connect(ac.destination); throw e; }
      for (const [n, b] of [['eg', 'engine'], ['tg', 'engine'], ['rg', 'engine'], ['cg', 'ambience']]) { try { if (s[n]) { s[n].disconnect(); s[n].connect(bus[b]); } } catch (e) { try { s[n].connect(s.out); } catch (e2) {} } }
      s.master = master; s.bus = bus; applyAudio();
    } catch (e) { console.log('[menu] sound buses not set up: ' + (e && e.message)); }
  };
  const heliAudio = () => { const s = g.sound, hs = g.heli && g.heli.parts && g.heli.parts.sound; if (!s || !s.bus || !hs || !hs.gain || hs.gain === st.heliNode) return; try { hs.gain.disconnect(); hs.gain.connect(s.bus.heli); st.heliNode = hs.gain; } catch (e) { st.heliNode = hs.gain; } };
  // a short tone at the level just set, so a slider can be heard while the game is silent behind the menu
  const blip = (k) => { const s = g.sound; try { if (!s || !s.on || !s.ac || s.muted || s.ac.state !== 'running') return; const ac = s.ac, t = ac.currentTime; if (t - (st.blipT || 0) < 0.11) return; st.blipT = t; const lvl = clamp(+S.get('audio.master'), 0, 1) * (k === 'master' ? 1 : clamp(+S.get('audio.' + k), 0, 1)); if (lvl < 0.002) return;
    const o = ac.createOscillator(), gn = ac.createGain(); o.type = 'triangle'; o.frequency.value = 660; gn.gain.setValueAtTime(0.1 * lvl, t); gn.gain.exponentialRampToValueAtTime(0.0006, t + 0.16); o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + 0.18); } catch (e) {} };
  if (g.sound) { const s = g.sound, un0 = s.unlock.bind(s), tg0 = s.toggle.bind(s); s.unlock = function () { un0(); if (!s.bus) setupAudio(); }; s.toggle = function () { tg0(); applyAudio(); if (st.open && st.page === 'audio') showPage('audio', true); }; }
  const applyAll = () => { applyLook(); applySubs(); applyAudio(); fpsChip(); };
  S.on('quality', () => applyQuality(false)); for (const k of ['look.sens', 'look.invertY', 'pad.sens']) S.on(k, applyLook); for (const k of ['subs.on', 'subs.size']) S.on(k, applySubs); for (const k in BUS) S.on('audio.' + k, applyAudio); S.on('audio.master', applyAudio);

  // ------------------------------------------------------------------ the frame-rate readout
  const chip = h('div', { id: 'ctfps' }); let chipTxt = '';
  function fpsChip() { const on = !!S.get('hud.fps') && !st.open && !window.__startScreen && !g.paused; const s = on ? Math.round(g.fps || 0) + ' fps · ' + QNAME[S.get('quality')] : ''; if (s === chipTxt) return; chipTxt = s; chip.style.display = s ? 'block' : 'none'; if (s) chip.innerHTML = '<b>' + Math.round(g.fps || 0) + '</b> fps · ' + QNAME[S.get('quality')]; }
  S.on('hud.fps', fpsChip);
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const nowLine = () => { const w = g.world || {}; return 'picture size ' + (w.liveScale || 1).toFixed(2) + ' · shading (AO) ' + (w.gtao && w.gtao.enabled ? 'on' : 'off') + ' · detail ' + (w.detail || 1); };
  setInterval(() => {
    try {
      if (!st.applied && window.__ready) { st.applied = true; applyQuality(true); applyAll(); }
      if (!st.open && !g.paused && !document.hidden && window.__ready && !window.__startScreen) { if (performance.now() - st.liveAt > 3000 && g.fps > 0) { st.fpsS.push(g.fps); if (st.fpsS.length > 16) st.fpsS.shift(); if (st.fpsS.length >= 3) st.fpsBy[S.get('quality')] = Math.round(median(st.fpsS)); } }
      fpsChip(); heliAudio(); if (g.sound && g.sound.on && !g.sound.bus) setupAudio();
      if (!!(g.heli && g.heli.piloted && g.heli.mouseFly) !== !!st.flyWas) applyLook();
    } catch (e) {}
  }, 500);

  // ------------------------------------------------------------------ the menu's DOM
  document.head.appendChild(h('style', { textContent: STYLE })); document.body.appendChild(chip);
  const el = h('div', { id: 'ctmenu' }), nav = h('div', { className: 'nav' }), head = h('div', { className: 'head' }), page = h('div', { className: 'page' }), foot = h('div', { className: 'foot' }), navPages = h('div');
  const resumeBtn = h('button', { className: 'nbtn go', textContent: 'RESUME' }), fbBtn = h('button', { className: 'nbtn low', textContent: 'Feedback' }), resetBtn = h('button', { className: 'nbtn low', textContent: 'Reset settings' });
  nav.append(h('div', { className: 'brand' }, h('b', { textContent: 'PAUSED' }), h('span', { textContent: 'CROSSTOWN' })), resumeBtn, navPages, h('div', { className: 'grow' }), fbBtn, resetBtn);
  el.append(h('div', { className: 'box' }, nav, h('div', { className: 'main' }, head, page, foot))); document.body.appendChild(el);
  for (const ev of ['mousedown', 'mouseup', 'click', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(ev, (e) => e.stopPropagation());      // clicks in the menu are not clicks on the game
  el.addEventListener('mousemove', (e) => e.stopPropagation(), true);
  el.addEventListener('mousedown', () => { wakeSound(); st.padUsed = false; footer(); if (st.capture) endCapture(); }, true);
  resumeBtn.addEventListener('click', () => close('click'));
  fbBtn.addEventListener('click', () => { const l = document.getElementById('fblink'); if (l) l.click(); });
  resetBtn.addEventListener('click', () => { const t = performance.now(); if (t - st.resetArm < 4000) { st.resetArm = 0; resetBtn.textContent = 'Reset settings'; S.reset(); st.keyMsg = null; applyAll(); showPage(st.page, true); } else { st.resetArm = t; resetBtn.textContent = 'Press again: all settings to default'; setTimeout(() => { if (st.resetArm === t) { st.resetArm = 0; resetBtn.textContent = 'Reset settings'; } }, 4000); } });
  const navBtn = (id) => navPages.querySelector('[data-page="' + id + '"]');
  const buildNav = () => { pages.sort((a, b) => (a.order || 0) - (b.order || 0)); navPages.textContent = ''; for (const p of pages) { const b = h('button', { className: 'nbtn' + (p.id === st.page ? ' sel' : ''), textContent: p.title, 'data-page': p.id }); b.addEventListener('click', () => showPage(p.id)); b.addEventListener('focus', () => { if (st.page !== p.id) showPage(p.id); }); navPages.appendChild(b); } };
  const padName = () => { const v = S.get('pad.style'); return v === 'xbox' || v === 'ps' ? v : padStyle(readPad()); };
  function footer() { const N = PAD_NAMES[padName()], it = st.capture ? [['Esc', 'cancel']] : st.padUsed ? [['D-pad', 'move, change'], [N.a, 'select'], [N.b, 'back'], [N.lb + ' ' + N.rb, 'page'], [N.start, 'resume']] : [['↑ ↓', 'move'], ['← →', 'change, open'], ['Enter', 'select'], ['[ ]', 'page'], ['Esc', 'resume'], ['0', 'frame rate'], ['\\', 'full screen'], ['M', 'sound']];
    foot.textContent = ''; for (const [k, t] of it) foot.append(h('b', { textContent: k }), t); }
  function showPage(id, keep) {
    const p = pages.find((q) => q.id === id) || pages[0]; if (!p) return; const top = keep ? page.scrollTop : 0, was = keep ? cur() : null, wk = was && (was.getAttribute('data-k') || '');
    st.page = p.id; st.rows = []; if (!keep) { st.capture = null; st.keyMsg = null; } for (const b of navPages.children) b.classList.toggle('sel', b.getAttribute('data-page') === p.id);
    head.textContent = p.title; page.textContent = '';
    try { p.build(page); for (const sp of extra[p.id] || []) row(page, sp); } catch (e) { page.append(h('p', { className: 'warn', textContent: 'This page could not be shown: ' + (e && e.message) })); try { console.log('[menu] page ' + p.id + ': ' + (e && (e.stack || e.message))); } catch (e2) {} }
    page.scrollTop = top; if (wk) { const n = page.querySelector('[data-k="' + (window.CSS && CSS.escape ? CSS.escape(wk) : wk) + '"]'); if (n) n.focus({ preventScroll: true }); }
    footer();
  }

  // rows: a label and one control, steered by mouse, keys and controller alike
  function row(parent, sp) {
    if (sp.key !== undefined && sp.dflt !== undefined) S.def(sp.key, sp.dflt);
    const r = h('div', { className: 'mrow', tabIndex: 0, 'data-k': sp.key || sp.label || '' }), lab = h('div', { className: 'lab', textContent: sp.label || '' }), ctl = h('div', { className: 'ctl' }); if (sp.hint) lab.append(h('small', { textContent: sp.hint })); r.append(lab, ctl);
    const get = sp.get || (() => S.get(sp.key, sp.dflt)), set = (v) => { if (sp.set) sp.set(v); else S.set(sp.key, v); if (sp.onChange) { try { sp.onChange(v); } catch (e) {} } r._sync(); };
    if (sp.type === 'slider') {
      const min = sp.min ?? 0, max = sp.max ?? 1, step = sp.step ?? 0.05, fmt = sp.fmt || ((v) => Math.round(v * 100) + '%'), inp = h('input', { type: 'range', min, max, step, tabIndex: -1 }), val = h('span', { className: 'val' });
      inp.addEventListener('input', () => set(+inp.value)); ctl.append(inp, val);
      r._sync = () => { const v = clamp(+get() || 0, min, max); inp.value = v; val.textContent = fmt(v); };
      r._adj = (d) => set(clamp(+(Math.round((clamp(+get() || 0, min, max) + d * step) / step) * step).toFixed(4), min, max));
    } else {
      const opts = sp.type === 'toggle' ? [[false, 'Off'], [true, 'On']] : sp.options || [], seg = h('div', { className: 'seg' }), bs = opts.map(([v, t, sub]) => { const b = h('button', { tabIndex: -1, textContent: t }); if (sub) b.append(h('small', { textContent: sub })); b.addEventListener('click', () => { set(v); r.focus({ preventScroll: true }); }); seg.append(b); return b; });
      ctl.append(seg); const idx = () => { const v = sp.type === 'toggle' ? !!get() : get(); return Math.max(0, opts.findIndex((o) => o[0] === v)); };
      r._sync = () => { const i = idx(); bs.forEach((b, j) => b.classList.toggle('on', i === j)); if (sp.subs) { const t = sp.subs(); bs.forEach((b, j) => { const s = b.querySelector('small'); if (s) s.textContent = t[j] || ''; }); } };
      r._adj = (d) => { const i = clamp(idx() + d, 0, opts.length - 1); if (i !== idx()) set(opts[i][0]); };
      r._act = () => set(opts[(idx() + 1) % opts.length][0]);
    }
    r._sync(); parent.appendChild(r); st.rows.push(r); return r;
  }
  function button(parent, label, fn) { const b = h('button', { className: 'mbtn', textContent: label }); b.addEventListener('click', (e) => { try { fn(e); } catch (err) { console.log('[menu] ' + label + ': ' + (err && err.message)); } }); parent.appendChild(b); return b; }
  S.on('*', () => { if (st.open) for (const r of st.rows) if (r._sync) r._sync(); });

  // ------------------------------------------------------------------ the built-in pages
  const fpsSubs = () => ['auto', 'low', 'medium', 'high'].map((q) => (st.fpsBy[q] ? st.fpsBy[q] + ' fps' : '–'));
  pages.push({ id: 'graphics', title: 'Graphics', order: 10, build(p) {
    const q = S.get('quality'), last = st.fpsBy[q];
    p.append(h('p', { className: 'good', id: 'ctq-now', textContent: (last ? 'Frame rate just before you paused: ' + last + ' fps on ' + QNAME[q] + '. ' : 'Frame rate: not measured yet on ' + QNAME[q] + ' (play a few seconds). ') + 'Now: ' + nowLine() + '.' }));
    row(p, { key: 'quality', label: 'Quality', hint: 'Under each choice: the frame rate measured on it in this session', type: 'choice', options: [['auto', 'Auto', '–'], ['low', 'Low', '–'], ['medium', 'Medium', '–'], ['high', 'High', '–']], subs: fpsSubs, onChange: () => setTimeout(() => { const n = document.getElementById('ctq-now'); if (n) n.textContent = 'Now: ' + nowLine() + '. Resume and play a few seconds to see its frame rate here.'; }, 60) });
    p.append(h('p', { className: 'note', textContent: 'Auto: the game changes picture size, shading and detail by itself to hold about 60 frames a second. Low: fastest (small picture, no shading, fewer small things and people). Medium: in between. High: sharpest (full picture size, everything drawn); it stays there even if the frame rate drops.' }));
    row(p, { key: 'hud.fps', label: 'Show the frame rate while playing', hint: 'Top right, with the quality in use', type: 'toggle' });
    button(p, 'Full screen on / off', () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} });
  } });
  const keyRow = (p, a) => {
    const ph = K.phys(a.code), r = h('div', { className: 'mrow krow', tabIndex: 0, 'data-k': 'key:' + a.code }), lab = h('div', { className: 'lab', textContent: a.label }), cap = h('span', { className: 'kcap' + (!ph ? ' none' : ph !== a.code ? ' chg' : ''), textContent: K.name(ph) }); if (a.also) lab.append(h('small', { textContent: a.also }));
    const c = st.capture && st.capture.code === a.code; if (c) { cap.className = 'kcap wait'; cap.textContent = st.capture.pending ? 'Press ' + K.name(st.capture.pending) + ' again to swap' : 'Press a key…'; }
    r.append(lab, h('div', { className: 'ctl' }, cap)); r._act = () => { st.capture = { code: a.code, pending: null }; st.keyMsg = null; showPage('controls', true); }; cap.addEventListener('click', (e) => { e.stopPropagation(); r.focus({ preventScroll: true }); r._act(); }); p.append(r); st.rows.push(r);
  };
  pages.push({ id: 'controls', title: 'Controls', order: 20, build(p) {
    p.append(h('h3', { textContent: 'Mouse' }));
    row(p, { key: 'look.sens', label: 'Mouse sensitivity', type: 'slider', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' });
    row(p, { key: 'look.invertY', label: 'Invert up / down', hint: 'Mouse and the controller’s right stick', type: 'toggle' });
    for (const [k, t] of MOUSE) p.append(h('div', { className: 'mrow krow fixed' }, h('div', { className: 'lab', textContent: t }), h('div', { className: 'ctl' }, h('span', { className: 'kcap', style: 'cursor:default;border-bottom-width:1px', textContent: k }))));
    p.append(h('h3', { textContent: 'Keys' }), h('p', { className: 'note', textContent: 'Every key the game uses. To change one: select it (click it, or Enter), then press the new key. Esc always opens this menu and cannot be given away.' }));
    if (st.keyMsg) p.append(h('p', { className: st.keyMsg[0], id: 'ctkeymsg', textContent: st.keyMsg[1] }));
    const rb = button(p, 'Reset all keys to defaults', () => { K.resetAll(); st.capture = null; st.keyMsg = ['good', 'All keys are back to their defaults.']; showPage('controls', true); }); rb.disabled = !K.changed; rb.setAttribute('data-k', 'keyreset');
    for (const gname of K.groups) { const list = K.actions.filter((a) => a.group === gname); if (!list.length) continue; p.append(h('h3', { textContent: gname })); for (const a of list) keyRow(p, a); }
  } });
  pages.push({ id: 'pad', title: 'Controller', order: 30, build(p) {
    const gp = readPad(), style = padName();
    p.append(h('p', { className: 'note', textContent: gp ? 'Controller found: ' + String(gp.id || 'unnamed').slice(0, 70) : 'No controller found yet. Plug it in and press any button on it to wake it.' }));
    row(p, { label: 'Show the layout for', type: 'choice', options: PAD_MODES.map(([v, t]) => [v, t]), get: () => st.padMode, set: (v) => { st.padMode = v; draw(); } });
    const box = h('div', { className: 'padbox' }); p.append(box); const draw = () => { box.innerHTML = padSvg(st.padMode, padName()); }; draw();
    row(p, { key: 'pad.style', label: 'Button names', hint: 'Auto: from the controller that is plugged in (now ' + (style === 'ps' ? 'PlayStation' : 'Xbox') + ')', type: 'choice', options: [['auto', 'Auto'], ['xbox', 'Xbox'], ['ps', 'PlayStation']], onChange: () => { draw(); footer(); } });
    row(p, { key: 'pad.sens', label: 'Right stick look speed', type: 'slider', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' });
    p.append(h('p', { className: 'note', textContent: 'The controller’s buttons are fixed for now; keyboard keys can be changed on the Controls page. "Invert up / down" there also turns the right stick round.' }));
  } });
  pages.push({ id: 'audio', title: 'Audio', order: 40, build(p) {
    const s = g.sound; if (s && s.muted) { p.append(h('p', { className: 'warn', textContent: 'Sound is switched off (the ' + K.keyName('KeyM') + ' key).' })); button(p, 'Switch sound on', () => { s.toggle(); }); }
    else if (s && !s.on) p.append(h('p', { className: 'note', textContent: 'Sound starts with your first key or click in the game.' }));
    const sl = (k, label, hint) => row(p, { key: 'audio.' + k, label, hint, type: 'slider', min: 0, max: 1, step: 0.05, onChange: () => blip(k) });
    sl('master', 'Master volume', 'Everything');
    p.append(h('h3', { textContent: 'Mix' }));
    sl('engine', 'Engine and tyres', 'Your car'); sl('effects', 'Effects', 'Guns, crashes, doors, people'); sl('sirens', 'Sirens and horns'); sl('heli', 'Helicopter'); sl('ambience', 'City', 'The low rumble of the streets'); sl('radio', 'Radio', g.radio ? undefined : 'The car radio is not in the game yet; this is kept for it');
    p.append(h('p', { className: 'note', textContent: 'The game is silent while this menu is open; each slider plays a short tone at its new level.' }));
  } });
  pages.push({ id: 'subs', title: 'Subtitles', order: 50, build(p) {
    const prev = h('div', { className: 'subprev' }), draw = () => { const on = S.get('subs.on') !== false, k = clamp(+S.get('subs.size') || 1, 0.6, 2); prev.textContent = on ? 'Dispatcher: this is how spoken lines look at this size.' : '(subtitles are off: spoken lines are not written out)'; prev.style.fontSize = Math.round(22 * k * Math.max(0.6, innerHeight / 1080)) + 'px'; prev.style.opacity = on ? 1 : 0.5; };
    row(p, { key: 'subs.on', label: 'Subtitles', hint: 'The dispatcher’s lines at the bottom of the screen (and the radio, when it comes)', type: 'toggle', onChange: draw });
    row(p, { key: 'subs.size', label: 'Text size', type: 'slider', min: 0.8, max: 1.6, step: 0.1, onChange: draw });
    p.append(prev); draw();
  } });

  // ------------------------------------------------------------------ steering the menu (keys and controller share these)
  const cur = () => { const a = document.activeElement; return a && el.contains(a) ? a.closest('.mrow') || a.closest('button') || a : null; };
  const inNav = (x) => !!(x && nav.contains(x));
  const list = (col) => [...col.querySelectorAll('.mrow:not(.fixed), button.mbtn, button.nbtn')].filter((x) => x.offsetParent !== null && !x.disabled);
  const focus = (n) => { if (!n) return; try { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); } catch (e) {} };
  const move = (d) => { const c = cur(), L = list(!c || inNav(c) ? nav : page), i = L.indexOf(c); focus(L[i < 0 ? 0 : clamp(i + d, 0, L.length - 1)]); };
  const back = () => { const c = cur(); if (c && !inNav(c)) focus(navBtn(st.page) || resumeBtn); else close(st.padUsed ? 'pad' : 'key'); };
  const adjust = (d) => { const c = cur(); if (!c || inNav(c)) { if (d > 0) focus(list(page)[0]); return; } if (c._adj) c._adj(d); else if (d < 0) focus(navBtn(st.page) || resumeBtn); };
  const activate = () => { const c = cur(); if (!c) { focus(resumeBtn); return; } if (c._act) c._act(); else if (c.tagName === 'BUTTON') c.click(); };
  const turnPage = (d) => { const i = pages.findIndex((p) => p.id === st.page), p = pages[(i + d + pages.length) % pages.length]; showPage(p.id); focus(navBtn(p.id)); };
  const endCapture = () => { if (!st.capture) return; st.capture = null; showPage('controls', true); };
  const captureKey = (pc) => {
    const c = st.capture, a = K.actions.find((x) => x.code === c.code); if (pc === 'Escape') { st.keyMsg = null; endCapture(); return; }
    if (!K.canBind(pc)) { st.keyMsg = ['warn', 'That key cannot be used. Press another, or Esc to cancel.']; showPage('controls', true); return; }
    const o = K.owner(pc);
    if (o && o.code !== c.code && c.pending !== pc) { c.pending = pc; st.keyMsg = ['warn', K.name(pc) + ' is already the key for "' + o.label + '". Press ' + K.name(pc) + ' again to swap the two keys, press another key, or Esc to cancel.']; showPage('controls', true); const m = document.getElementById('ctkeymsg'); if (m) m.scrollIntoView({ block: 'nearest' }); return; }
    const had = K.phys(c.code); K.assign(c.code, pc); st.capture = null;
    st.keyMsg = o && o.code !== c.code ? ['good', '"' + a.label + '" is now ' + K.name(pc) + ', and "' + o.label + '" took ' + K.name(had) + '.'] : ['good', '"' + a.label + '" is now ' + K.name(pc) + '.'];
    showPage('controls', true);
  };
  K.onLayout = () => { if (st.open && st.page === 'controls') showPage('controls', true); };

  // ------------------------------------------------------------------ open and close
  const canvas = g.world && g.world.renderer && g.world.renderer.domElement;
  const fbOpen = () => { const b = document.getElementById('fbbox'); return !!(b && b.style.display !== 'none'); };
  const canOpen = () => !st.open && !!window.__ready && !window.__startScreen && !window.__warming;
  const dropInput = () => { try { g.keys.clear(); if (g.look && g.look.keys) g.look.keys.clear(); const I = g.input; I.lookX = I.lookY = 0; I.use = false; const ci = g.combat && g.combat.inp; if (ci) ci.fire = ci.aim = ci.mfire = ci.maim = false; } catch (e) {} };
  function open(id, how) {
    if (!canOpen()) return false; st.open = true; st.openAt = performance.now(); st.closing = false; st.padUsed = how === 'pad'; st.wasPaused = !!g.paused; g.paused = true; dropInput();
    try { if (document.pointerLockElement) { st.selfExit = true; document.exitPointerLock(); } } catch (e) {}
    try { if (g.look) { st.hintWas = g.look.hintOn; g.look.hintOn = false; g.look._hint(); } } catch (e) {}
    fbBtn.style.display = document.getElementById('fblink') ? '' : 'none'; buildNav(); el.classList.add('open'); showPage(id || st.page); focus(how === 'pad' || id ? navBtn(st.page) || resumeBtn : resumeBtn);
    applyAudio(); fpsChip(); try { g.hud.draw(); } catch (e) {}
    return true;
  }
  function doClose(how) {
    if (!st.open) return; st.open = false; st.closing = false; st.capture = null; st.keyMsg = null; el.classList.remove('open'); try { if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur(); } catch (e) {}
    dropInput(); g.paused = false; st.liveAt = performance.now(); st.fpsS.length = 0; applyAudio();
    try { if (g.look && st.hintWas !== null) { g.look.hintOn = st.hintWas; st.hintWas = null; g.look._hint(); } } catch (e) {}
    // the mouse again, for a player who had it: Chrome refuses a capture for 1.25 s after the player's own Esc, so the request waits that out (look.js then asks)
    if (how !== 'pad' && g.look && g.look.everHeld && !g.demo && !fbOpen()) { const wait = Math.max(0, st.escAt + 1320 - performance.now()), ask = () => { try { if (!st.open && !document.pointerLockElement && !fbOpen()) g.look.ask('play'); } catch (e) {} }; if (wait > 0) setTimeout(ask, wait); else ask(); }
  }
  function close(how) { if (!st.open) return; if (how === 'pad') { st.closing = true; return; } doClose(how); }      // a controller press closes on release, so the game does not also see the button (A jumps)
  document.addEventListener('pointerlockchange', () => {
    const held = !!document.pointerLockElement;
    if (st.lockHeld && !held) { if (st.selfExit) st.selfExit = false; else { st.escAt = performance.now(); if (canOpen() && !fbOpen()) open(); } }      // the player's Esc (the browser keeps that key press to itself), or the window lost focus: pause
    if (held) st.selfExit = false; st.lockHeld = held;
  });

  // ------------------------------------------------------------------ keys: translation, and the menu's own keys
  const typing = (t) => { try { if (!t || !t.closest) return false; if (t.closest('#fbbox')) return true; if (t.closest('#ctmenu')) return false; return !!(t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit)$/.test(t.type))); } catch (e) { return false; } };
  const setCode = (e, lc) => {
    try { Object.defineProperty(e, 'code', { value: lc, configurable: true }); } catch (err) {}
    if (e.code === lc) return;
    // a browser that will not let the event be rewritten: the game gets a copy with the logical code instead
    e.stopImmediatePropagation(); try { const c = new KeyboardEvent(e.type, { code: lc, key: e.key, bubbles: true, cancelable: true, repeat: e.repeat, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }); c.__ct = true; (e.target || window).dispatchEvent(c); if (c.defaultPrevented) e.preventDefault(); } catch (err) {}
  };
  const wakeSound = () => { try { if (g.sound && !g.sound.on) g.sound.unlock(); } catch (e) {} };      // a player who opens the menu before anything else: the sound is made here, so the sliders can be heard
  const menuKey = (e, pc, lc) => {
    wakeSound();
    if (st.padUsed) { st.padUsed = false; footer(); }
    if (st.capture) { e.preventDefault(); if (!e.repeat) captureKey(pc); return; }
    if (pc === 'Escape' || lc === 'KeyP') { e.preventDefault(); if (!e.repeat && performance.now() - st.openAt > 250) close('key'); return; }      /* (250 ms: the same Esc that opened it by freeing the mouse must not also close it) */
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (pc) {
      case 'ArrowUp': move(-1); break; case 'ArrowDown': move(1); break; case 'ArrowLeft': adjust(-1); break; case 'ArrowRight': adjust(1); break;
      case 'Enter': case 'NumpadEnter': case 'Space': if (!e.repeat) activate(); break;
      case 'PageUp': case 'BracketLeft': if (!e.repeat) turnPage(-1); break; case 'PageDown': case 'BracketRight': if (!e.repeat) turnPage(1); break;
      case 'Backspace': back(); break; default: return;
    }
    e.preventDefault();
  };
  const onKey = (e) => {
    if (e.__ct || typing(e.target)) return;
    const down = e.type === 'keydown', pc = e.code, lc = K.translate(pc);
    if (st.open) {
      if (down) { const cap = !!st.capture; menuKey(e, pc, lc); if (cap || !PASS.has(lc) || e.metaKey || e.ctrlKey) { e.stopImmediatePropagation(); return; } }
    } else if (down && (pc === 'Escape' || lc === 'KeyP') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (pc === 'Escape' && fbOpen()) { /* the feedback form is up: Esc is its own */ }
      else { if (!e.repeat && open()) e.preventDefault(); if (lc === 'KeyP' || st.open) { e.stopImmediatePropagation(); return; } }      // P never reaches game.js's own pause switch
    }
    if (lc !== pc) setCode(e, lc);
  };
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);

  // ------------------------------------------------------------------ controller: Start opens, and it steers the menu
  let prev = {}; const rep = { dir: '', t: 0 };
  setInterval(() => {
    const gp = readPad(); if (!gp) { prev = {}; rep.dir = ''; return; }
    try {
      const bt = gp.buttons, B = (i) => !!(bt[i] && (bt[i].pressed || bt[i].value > 0.5)), now = {}; let any = false; for (const i of [0, 1, 4, 5, 9, 12, 13, 14, 15]) { now[i] = B(i); any = any || now[i]; }
      const edge = (i) => now[i] && !prev[i];
      if (!st.open) { if (edge(9) && canOpen()) open(undefined, 'pad'); }
      else if (st.closing) { if (!any) doClose('pad'); }
      else {
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0; let dir = now[12] ? 'u' : now[13] ? 'd' : now[14] ? 'l' : now[15] ? 'r' : '';
        if (!dir) dir = Math.abs(ay) > 0.55 && Math.abs(ay) >= Math.abs(ax) ? (ay > 0 ? 'd' : 'u') : Math.abs(ax) > 0.55 ? (ax > 0 ? 'r' : 'l') : '';
        const t = performance.now(); let go = false; if (dir !== rep.dir) { rep.dir = dir; rep.t = t + 380; go = !!dir; } else if (dir && t >= rep.t) { rep.t = t + (dir === 'l' || dir === 'r' ? 60 : 130); go = true; }
        const used = go || edge(0) || edge(1) || edge(4) || edge(5) || edge(9); if (used && !st.padUsed) { st.padUsed = true; footer(); }
        if (st.capture) { if (edge(1)) { st.keyMsg = null; endCapture(); } }
        else { if (go) { if (dir === 'u') move(-1); else if (dir === 'd') move(1); else adjust(dir === 'l' ? -1 : 1); } if (edge(0)) activate(); if (edge(1)) back(); if (edge(4)) turnPage(-1); if (edge(5)) turnPage(1); if (edge(9)) close('pad'); }
      }
      prev = now;
    } catch (e) {}
  }, 50);

  // ------------------------------------------------------------------ what the other lanes call
  g.menu = {
    get isOpen() { return st.open; },
    open: (id) => open(id), close: () => doClose('api'), toggle: () => (st.open ? doClose('api') : open()),
    addPage(p) { if (!p || !p.id || typeof p.build !== 'function') return; const i = pages.findIndex((q) => q.id === p.id); const q = { id: p.id, title: p.title || p.id, order: p.order ?? 60, build: p.build }; if (i >= 0) pages[i] = q; else pages.push(q); if (st.open) buildNav(); },
    addSetting(pageId, sp) { if (!sp) return; if (sp.key !== undefined && sp.dflt !== undefined) S.def(sp.key, sp.dflt); (extra[pageId] ||= []).push(sp); if (st.open && st.page === pageId) showPage(pageId, true); },
    row, button, addKey: (a) => K.add(a), keyName: (code) => K.keyName(code), keys: K, pages, state: st,
  };
  applyLook(); applySubs();
  try { console.log('[menu] pause and settings menu on (settings ' + (S.stored ? 'kept in this browser' : 'not kept: storage is blocked') + ', quality ' + S.get('quality') + ')'); } catch (e) {}
}
