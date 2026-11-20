// padui.js (gameplay lane, Nov 17; Matt: "If I'm using a controller, show the controller controls", "How do I do a grappling hook on a
// controller?", full screen in one press). One small module, so the files of other lanes stay as they are:
//  1. WHO IS PLAYING: the last input decides. A pad button or stick = controller; a key, a mouse button, the wheel or a real mouse move =
//     keyboard. game.padui.on says which. Names follow the pad: a DualSense / DualShock gets Cross Circle Square Triangle, L1 R1 L2 R2,
//     Create, Options; any other pad gets A B X Y, LB RB LT RT, View, Menu (the menu's "Button names" setting wins over both).
//  2. THE PROMPTS (?padui=0 = as before): while the controller is in use every prompt that names a key names the pad's button instead:
//     the menu's keyName() (what "F Get in", the bus, boat, ferry, radio and hint chips ask), the HUD's own hint lines (first seconds on
//     foot and in the helicopter, the hook's line, the scope's), and one strip of buttons for what you are doing now (on foot, armed, in a
//     car, flying, scoped, on a bus). combat.js's older strip stands down while ours is up. Back to keys on keyboard or mouse input.
//  3. BUTTONS THE GAME DID NOT HAVE (?padbtn=0 = none of them). They are sent as the key the game already reads, so each file's own guards hold:
//       d-pad up     the grappling hook (X); on a bus: take the wheel (X); flying: stability help (T); in the scope: zoom in
//       d-pad down   the flashlight (Z); on a bus: ring for the stop (H); in the scope: zoom out
//       Create/View  the city map (Tab)
//       touchpad click (DualSense, button 17)   full screen.  A pad without one: press the right stick (not while flying, where it is the view)
//  4. FULL SCREEN in one press: the \ key (index.html, as before), the pad button above, and a small button at the bottom right beside Feedback
//     (?fsbtn=0 = no corner button). Nothing is reloaded or reset; the first seconds' key line now names the key.
// Cost: one getGamepads() a drawn frame, no allocation in the steady state; the strip's DOM is rewritten only when its words change.
const PS = { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', l3: 'L3', r3: 'R3', back: 'CREATE', start: 'OPTIONS', ls: 'L STICK', rs: 'R STICK', du: 'D-PAD ↑', dd: 'D-PAD ↓', dl: 'D-PAD ←', dr: 'D-PAD →', dud: 'D-PAD ↑ ↓', dlr: 'D-PAD ← →' };
const XB = { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', l3: 'L3', r3: 'R3', back: 'VIEW', start: 'MENU', ls: 'L STICK', rs: 'R STICK', du: 'D-PAD ↑', dd: 'D-PAD ↓', dl: 'D-PAD ←', dr: 'D-PAD →', dud: 'D-PAD ↑ ↓', dlr: 'D-PAD ← →' };
// the key a prompt asks for -> the pad control that does the same thing
const KEY2PAD = { KeyF: 'y', Enter: 'y', Space: 'a', ShiftLeft: 'l3', ShiftRight: 'l3', KeyX: 'du', KeyT: 'du', KeyZ: 'dd', KeyH: 'dd', Tab: 'back', Backslash: 'fs', KeyP: 'start', KeyQ: 'b', KeyR: 'x', KeyE: 'x', KeyC: 'r3', Period: 'dr', Comma: 'dl' };
const ROUND = { a: 1, b: 1, x: 1, y: 1 };
export const isPS = (id) => !/xbox|xinput|045e/i.test(id || '') && /dualsense|dualshock|playstation|sony|054c|wireless controller/i.test(id || '');
export function install(game) {
  if (game.padui || typeof document === 'undefined') return null;
  const q = (k) => { try { return game.P && game.P.get ? game.P.get(k) : null; } catch (e) { return null; } };
  const quiet = !!(game.demo || game.capture), prompts = q('padui') !== '0' && !quiet, extra = q('padbtn') !== '0', corner = q('fsbtn') !== '0' && !quiet;
  const now = () => performance.now();
  let padT = -1e9, kbT = -1e9, ps = false, has17 = false, seen = false, mine = false, mouseAcc = 0, bar = null, barKey = '', ctx = '', ctxT = 0, btn = null, btnKey = '', btnN = 0, toastEl = null, hudDone = false, menuDone = false;
  const was = new Uint8Array(20), fired = { hook: 0, light: 0, map: 0, full: 0, zoom: 0, stab: 0, ring: 0 }, fsLog = { asked: 0, ok: 0, refused: 0 };
  const style = () => { let v = null; try { v = game.settings && game.settings.get ? game.settings.get('pad.style') : null; } catch (e) {} return v === 'ps' || v === 'xbox' ? v : ps ? 'ps' : 'xbox'; };
  const N = () => (style() === 'ps' ? PS : XB);
  const fsName = () => (has17 ? 'TOUCHPAD' : N().r3);
  const padName = (k) => (k === 'fs' ? fsName() : N()[k]);
  const on = () => padT > kbT;
  const live = () => prompts && on();

  // ---- the pad (the one game.js readInput takes: the first connected with sticks, the standard layout if there is one)
  const pick = () => { let gp = null; try { const all = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of all) if (p && p.connected && p.axes.length >= 2 && p.buttons.length >= 4 && (!gp || (p.mapping === 'standard' && gp.mapping !== 'standard'))) gp = p; } catch (e) { gp = null; } return gp; };
  const down = (gp, i) => { const b = gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); };

  // ---- keys sent for the pad's extra buttons (the physical key the player has bound: menu.js turns it back into the game's own code)
  const phys = (code) => { try { const K = game.menu && game.menu.keys; if (K && K.phys) return K.phys(code) || code; } catch (e) {} return code; };
  const tap = (code) => { const c = phys(code); mine = true; try { dispatchEvent(new KeyboardEvent('keydown', { code: c, key: '', bubbles: true, cancelable: true })); } catch (e) {} mine = false;
    setTimeout(() => { mine = true; try { dispatchEvent(new KeyboardEvent('keyup', { code: c, key: '', bubbles: true, cancelable: true })); } catch (e) {} mine = false; }, 140); };
  const wheel = (dy) => { mine = true; try { dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })); } catch (e) {} mine = false; };

  // ---- full screen (one function for the corner button and the pad; the \ key keeps index.html's own)
  const toast = (text, ms) => { try { if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'paduitoast'; toastEl.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:55;pointer-events:none;font:13px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.8);padding:7px 14px;border-radius:8px;transition:opacity .6s;opacity:0;max-width:92vw;text-align:center'; document.body.appendChild(toastEl); }
      toastEl.textContent = text; toastEl.style.opacity = 1; clearTimeout(toastEl._t); toastEl._t = setTimeout(() => { toastEl.style.opacity = 0; }, ms || 6000); } catch (e) {} };
  const kbName = (code) => { try { const K = game.menu && game.menu.keys; if (K && K.name && K.phys) return K.name(K.phys(code)); } catch (e) {} return code === 'Backslash' ? '\\' : code.replace('Key', ''); };
  const full = (from) => { fsLog.asked++; try { const d = document, p = d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen();
      if (p && p.then) p.then(() => { fsLog.ok++; }, () => { fsLog.refused++; if (from === 'pad') toast('The browser wants a key or a click for full screen: press ' + kbName('Backslash') + ' or click the corner button'); }); } catch (e) { fsLog.refused++; } };

  // ---- what the player is doing now
  const mapUp = () => { try { const g = game; return !!(g.gps && g.gps.mapOpen ? g.gps.mapOpen() : g.hud && g.hud.cmap && g.hud.cmap.full); } catch (e) { return false; } };
  const formUp = () => { try { const b = document.getElementById('fbbox'); return !!(b && b.style.display === 'block'); } catch (e) { return false; } };
  const menuUp = () => { try { const m = game.menu; return !!(m && m.state && m.state.open); } catch (e) { return false; } };
  const scoped = () => { try { const h = game.heli; return !!(h && h.perch && h.perch.scoped); } catch (e) { return false; } };
  const flying = () => { const h = game.heli; return !!(h && (h.piloted || h.hasCamera)); };
  const where = () => { const pl = game.player, c = game.combat;
    if (window.__startScreen || !pl || game.paused || menuUp() || formUp() || (game.fly && game.fly.on)) return '';
    if (mapUp()) return 'map'; if (flying()) return 'heli'; if (pl.vehicle) return 'car'; if (scoped()) return 'scope'; if (pl.busy) return 'busy';
    let armed = false; try { armed = !!(c && c.slot && c.slot !== 'unarmed' && (!c.armedFoot || c.armedFoot())); } catch (e) {}
    return armed ? 'armed' : 'foot'; };
  const hook = () => !!(game.grapple && game.grapple.on);
  const ROWS = {
    foot: () => [['ls', 'Walk'], ['l3', 'Run'], game.melee && game.melee.on && ['rt', 'Punch'],      /* gameplay/melee */ ['a', 'Jump'], ['y', game.footout && game.footout.on && game.footout.prompt ? 'Climb out' : 'Get in'     /* gameplay footout: the walled-in prompt's own name */], ['b', 'Gun'], hook() && ['du', 'Hook'], ['dd', 'Light'], ['back', 'Map'], ['start', 'Menu']],
    armed: () => [['lt', 'Aim'], ['rt', 'Fire'], game.melee && game.melee.on && ['r3', 'Strike'],      /* gameplay/melee */ ['x', 'Reload'], ['lb rb', 'Weapon'], ['b', 'Put away'], ['a', 'Jump'], ['y', game.footout && game.footout.on && game.footout.prompt ? 'Climb out' : 'Get in'     /* gameplay footout: the walled-in prompt's own name */], hook() && ['du', 'Hook'], ['back', 'Map']],
    scope: () => [['lt', 'Scope'], ['rt', 'Fire'], ['dud', 'Zoom'], ['x', 'Reload']],
    car: () => [['rt', 'Gas'], ['lt', 'Brake'], ['ls', 'Steer'], game.combat && game.combat.DRIVEFIRE && game.combat.DRIVEPAD && ['rb', 'Fire'],      /* gameplay/takeover 3 */ ['a', 'Handbrake'], game.__horn && game.__horn.on && ['l3', 'Horn'],      /* gameplay/horn */ ['y', 'Get out'], ['dlr', 'Radio'], ['back', 'Map']],
    heli: () => [['ls', 'Tilt'], ['lb rb', 'Turn'], ['rt', 'Up'], ['lt', 'Down'], ['x', 'Engine'], game.heli && game.heli.rockets && !game.heli.rockets.dead && ['a', 'Rocket'], ['r3', 'View'], ['du', 'Stability'], ['y', 'Get out'], ['back', 'Map']],
    busy: () => [['ls', 'Move'], ['y', 'Use'], ['back', 'Map']],
  };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const chip = (k) => k.split(' ').map((p) => '<span style="display:inline-block;min-width:' + (ROUND[p] ? '20px' : '0') + ';height:20px;line-height:20px;padding:0 ' + (ROUND[p] ? '0' : '7px') + ';margin-right:3px;border-radius:' + (ROUND[p] ? '10px' : '5px') + ';background:#ffb82e;color:#14161a;font-weight:800;text-align:center">' + esc(padName(p)) + '</span>').join('');
  const hintUp = () => { for (const id of ['hintchip', 'runhint']) { const e = document.getElementById(id); if (e && +e.style.opacity === 1) return true; } return false; };
  const drawBar = () => {
    const w = live() ? where() : '', hl = w === 'heli' && game.heli && game.heli.hintT < 16 /* heli.js's own key line is up (reworded below): one line, not two */, rows = w && ROWS[w] && !hl ? ROWS[w]().filter(Boolean) : null, t = now();
    if (w !== ctx) { ctx = w; ctxT = t; }
    const dim = t - ctxT > 12000, key = rows ? style() + has17 + '|' + rows.map((r) => r[0] + r[1]).join(',') : '';
    if (!rows || hintUp()) { if (bar && bar.style.opacity !== '0') bar.style.opacity = '0'; return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'padbar'; bar.style.cssText = 'position:fixed;left:50%;bottom:max(17%,172px);transform:translateX(-50%);z-index:54;pointer-events:none;font:700 13px "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.03em;color:rgba(255,255,255,.92);background:rgba(12,13,15,.72);padding:7px 14px;border-radius:6px;opacity:0;transition:opacity .4s;white-space:nowrap;max-width:98vw;overflow:hidden'; document.body.appendChild(bar); }
    if (key !== barKey) { barKey = key; bar.innerHTML = rows.map((r) => '<span style="margin:0 9px;display:inline-block">' + chip(r[0]) + ' ' + esc(r[1].toUpperCase()) + '</span>').join(''); }
    const o = dim ? '0.62' : '1'; if (bar.style.opacity !== o) bar.style.opacity = o;
  };

  // ---- the prompts other files draw
  const pn = (code) => { if (!live()) return null; const k = KEY2PAD[code]; return k ? padName(k) : null; };
  const wrapMenu = () => { const m = game.menu; if (!m) return; menuDone = true; if (!prompts) return;
    try { const K = m.keys; if (K && K.keyName && !K.__padui) { const k1 = K.keyName.bind(K); K.keyName = (c) => pn(c) || k1(c); K.__padui = 1; }
      if (m.keyName && !m.__padui) { const k0 = m.keyName; m.keyName = (c) => pn(c) || k0(c); m.__padui = 1; } } catch (e) {} };
  const EXACT = {
    'X  HOOK': (n) => n.du + '  HOOK', 'X  HOOK · LOOK DOWN: DOWN': (n) => n.du + '  HOOK · LOOK DOWN: DOWN',
    'HOLD RIGHT MOUSE TO LOOK THROUGH THE SCOPE': (n) => 'HOLD ' + n.lt + ' TO LOOK THROUGH THE SCOPE', RMB: (n) => n.lt, LMB: (n) => n.rt, WHEEL: (n) => n.dud, 'TAB  map': (n) => n.back + '  map',
    'CLICK  set waypoint      RIGHT-CLICK  clear      TAB  close      SCROLL or + / -  zoom      0  whole map': (n) => n.back + '  close      CLICK  set waypoint      RIGHT-CLICK  clear      SCROLL or + / -  zoom      0  whole map',
    'LT AIM    RT FIRE    X RELOAD    RB / LB SWITCH    B PUT AWAY': (n) => n.lt + ' AIM    ' + n.rt + ' FIRE    ' + n.x + ' RELOAD    ' + n.rb + ' / ' + n.lb + ' SWITCH    ' + n.b + ' PUT AWAY',
  };
  const tr = (s, a) => {
    if (typeof s !== 'string') return s; const c = s.charCodeAt(0);
    if (c === 87 && s.startsWith('WASD  drive / walk')) {                       // hud.js: the first seconds' key line
      if (!live()) return s + '     ' + kbName('Backslash') + '  full screen';
      return '';                                                            // the strip above it says the same with the pad's buttons: one line, not two
    }
    if (!live()) return s;
    if (c === 87 && s.startsWith('W S  up / down')) { const n = N(); return n.ls + '  tilt     ' + n.lb + ' ' + n.rb + '  turn     ' + n.rt + ' ' + n.lt + '  up / down     ' + n.r3 + '  view     ' + n.x + '  engine     ' + n.du + '  stability     ' + (s.includes('rockets') ? n.a + '  rockets     ' : '') + n.y + '  get out (landed)'; }
    if (s === 'F' && a[2] === 20 && a[5] === 800) return N().y;                  // heli.js "F  Fly the helicopter" (hud.js's own asks keyName)
    const f = EXACT[s]; return f ? f(N()) : s;
  };
  const wrapHud = () => { const h = game.hud; if (!h || typeof h.text !== 'function') return; hudDone = true; const t0 = h.text; h.text = function (s, ...a) { return t0.call(this, tr(s, a), ...a); }; };

  // ---- the corner button
  const drawBtn = () => {
    if (!corner) return;
    if (!btn) { btn = document.createElement('button'); btn.id = 'fsbtn'; btn.type = 'button'; btn.tabIndex = -1; btn.setAttribute('aria-label', 'Full screen');
      btn.style.cssText = 'position:fixed;right:12px;bottom:10px;z-index:58;font:600 13px system-ui,sans-serif;line-height:normal;white-space:nowrap;color:#fff;background:rgba(14,16,20,.72);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:6px 10px;margin:0;cursor:pointer';     /* bottom right, left of the Feedback chip and drawn like it (it stood top right at first, over the money figure) */
      for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) btn.addEventListener(ev, (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); full('button'); try { btn.blur(); } catch (err) {} });
      document.body.appendChild(btn); }
    const fsOn = !!document.fullscreenElement, kn = live() ? fsName() : kbName('Backslash'), k = (fsOn ? 1 : 0) + '|' + kn;
    if (k !== btnKey) { btnKey = k; btnN = 0; btn.innerHTML = '<b style="background:#ffd27a;color:#111;border-radius:4px;padding:1px 6px;margin-right:6px">' + esc(kn) + '</b>' + (fsOn ? 'Exit full screen' : 'Full screen'); }
    if (btnN-- <= 0) { btnN = 45; let r = 12, b = 10; try { const f = document.getElementById('fblink'), q = f ? f.getBoundingClientRect() : null; if (q && q.width > 0) { r = Math.round(innerWidth - q.left + 8); b = Math.round(innerHeight - q.bottom); } } catch (e) {} const rs = r + 'px', bs = b + 'px'; if (btn.style.right !== rs) btn.style.right = rs; if (btn.style.bottom !== bs) btn.style.bottom = bs; }
  };

  // ---- last input: the keyboard and the mouse
  addEventListener('keydown', () => { if (!mine) kbT = now(); }, true);
  addEventListener('mousedown', () => { if (!mine) kbT = now(); }, true);
  addEventListener('wheel', () => { if (!mine) kbT = now(); }, { capture: true, passive: true });
  addEventListener('mousemove', (e) => { mouseAcc += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (mouseAcc > 40) { mouseAcc = 0; kbT = now(); } }, true);
  setInterval(() => { mouseAcc = 0; }, 500);                                    // a resting mouse that trembles is not "the mouse is in use"

  // ---- once a drawn frame
  const frame = () => {
    requestAnimationFrame(frame);
    try {
      if (!hudDone && prompts) wrapHud(); if (!menuDone) wrapMenu();
      const gp = pick();
      if (gp) {
        const std = gp.mapping === 'standard' || gp.buttons.length >= 16, nb = Math.min(gp.buttons.length, 20); let any = false;
        for (let i = 0; i < nb && !any; i++) { const b = gp.buttons[i]; if (b && (b.pressed || b.value > 0.3)) any = true; }
        for (let i = 0, na = std ? 4 : 2; i < na && !any; i++) if (Math.abs(gp.axes[i] || 0) > 0.35) any = true;
        if (any) { padT = now(); ps = isPS(gp.id); has17 = gp.buttons.length >= 18;
          if (!seen) { seen = true; if (prompts) { const n = N(); toast('Controller on: the prompts now show its buttons  ·  ' + n.start + ': all the controls  ·  ' + fsName() + ': full screen', 8000); } } }
        // the extra buttons, on the press
        const idle = window.__startScreen || menuUp() || formUp() || quiet || !extra, pl = game.player;
        for (const i of [8, 11, 12, 13, 17]) { const d = down(gp, i), e = d && !was[i]; was[i] = d ? 1 : 0; if (!e || idle || !std) continue;
          if (i === 8) { if (!game.paused || mapUp()) { fired.map++; tap('Tab'); } continue; }
          if (i === 11 && game.melee && game.melee.on && !game.paused && where() === 'armed') { tap('KeyE'); continue; }      /* gameplay/melee: R3 with a gun out on foot is the blow with the gun (full screen stays on R3 everywhere else) */
          if (i === 17 || (i === 11 && !has17 && !flying())) { fired.full++; full('pad'); continue; }
          if (i === 11 || game.paused || mapUp() || !pl) continue;
          if (scoped()) { fired.zoom++; wheel(i === 12 ? -100 : 100); continue; }
          if (i === 12) { if (flying()) { fired.stab++; tap('KeyT'); } else if (!pl.vehicle) { fired.hook++; tap('KeyX'); } }
          else if (!flying() && !pl.vehicle) { if (pl.busy) { fired.ring++; tap('KeyH'); } else { fired.light++; tap('KeyZ'); } }
        }
      }
      if (prompts) drawBar(); drawBtn();
    } catch (e) { if (!frame.err) { frame.err = 1; console.log('[padui] ' + (e && (e.stack || e.message))); } }
  };
  if (prompts) game._padSeen = 1;                                               // game.js's own "Controller on" line (Xbox names only) stands down for ours
  requestAnimationFrame(frame);
  game.padui = { prompts, extra, fired, fs: fsLog, full, pad: pick, get on() { return on(); }, get bar() { return live() && !!ROWS[ctx] && ctx !== ''; }, get ctx() { return ctx; }, get style() { return style(); }, get names() { return N(); }, name: padName, keyFor: pn, get text() { return bar && bar.style.opacity !== '0' ? bar.textContent : ''; } };
  return game.padui;
}
