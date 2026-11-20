// menu/keys.js (progress lane, Nov 14): every key the game reads, and the rebinding table.
// The game's files test KeyboardEvent.code against fixed codes ('KeyW', 'KeyF', ...: game.js, combat/combat.js, heli/heli.js, move/jump.js, fly.js,
// look.js, feedback.js, index.html). Those fixed codes are the LOGICAL codes: one per row below. A binding gives a logical code another PHYSICAL
// key; menu.js rewrites e.code on keydown / keyup in the capture phase, before any game listener runs, so no game file changes.
// One physical key gives exactly one logical code. A key whose own row was moved elsewhere gives 'Unbound' (nothing reads that).
export const GROUPS = ['Move', 'Weapons', 'Helicopter', 'Camera and system'];
export const ACTIONS = [
  { code: 'KeyW', group: 'Move', label: 'Forward / accelerate', also: 'helicopter: climb · fly camera: forward' },
  { code: 'KeyS', group: 'Move', label: 'Back / brake and reverse', also: 'helicopter: descend · fly camera: back' },
  { code: 'KeyA', group: 'Move', label: 'Left / steer left', also: 'helicopter: turn left' },
  { code: 'KeyD', group: 'Move', label: 'Right / steer right', also: 'helicopter: turn right' },
  { code: 'ShiftLeft', group: 'Move', label: 'Run', also: 'hold while walking · helicopter: descend · fly camera: down' },
  { code: 'ShiftRight', group: 'Move', label: 'Run (second key)', also: 'fly camera: down' },
  { code: 'Space', group: 'Move', label: 'Jump on foot / handbrake in a car', also: 'helicopter: climb · fly camera: up' },
  { code: 'KeyF', group: 'Move', label: 'Get in or out', also: 'car and helicopter' },
  { code: 'Enter', group: 'Move', label: 'Get in or out (second key)' },
  { code: 'ArrowUp', group: 'Move', label: 'Forward (second key)', also: 'helicopter: nose down · fly camera: look up' },
  { code: 'ArrowDown', group: 'Move', label: 'Back (second key)', also: 'helicopter: nose up · fly camera: look down' },
  { code: 'ArrowLeft', group: 'Move', label: 'Left (second key)', also: 'helicopter: bank left · fly camera: look left' },
  { code: 'ArrowRight', group: 'Move', label: 'Right (second key)', also: 'helicopter: bank right · fly camera: look right' },
  { code: 'KeyQ', group: 'Weapons', label: 'Put the gun away / take it out' },
  { code: 'KeyR', group: 'Weapons', label: 'Reload' },
  { code: 'Digit2', group: 'Weapons', label: 'Pistol' },
  { code: 'Digit3', group: 'Weapons', label: 'SMG' },
  { code: 'Digit4', group: 'Weapons', label: 'Shotgun' },
  { code: 'Digit5', group: 'Weapons', label: 'Carbine' },
  { code: 'KeyE', group: 'Helicopter', label: 'Start the engine' },
  { code: 'KeyC', group: 'Helicopter', label: 'Next camera' },
  { code: 'KeyT', group: 'Helicopter', label: 'Stability help on / off' },
  { code: 'KeyG', group: 'Helicopter', label: 'Mouse flies / mouse looks' },
  { code: 'KeyI', group: 'Helicopter', label: 'Nose down (second key)' },
  { code: 'KeyK', group: 'Helicopter', label: 'Nose up (second key)' },
  { code: 'KeyJ', group: 'Helicopter', label: 'Bank left (second key)' },
  { code: 'KeyL', group: 'Helicopter', label: 'Bank right (second key)' },
  { code: 'Numpad8', group: 'Helicopter', label: 'Nose down (number pad)' },
  { code: 'Numpad5', group: 'Helicopter', label: 'Nose up (number pad)' },
  { code: 'Numpad4', group: 'Helicopter', label: 'Bank left (number pad)' },
  { code: 'Numpad6', group: 'Helicopter', label: 'Bank right (number pad)' },
  { code: 'KeyP', group: 'Camera and system', label: 'Pause and menu', also: 'Esc always opens it too' },
  { code: 'KeyV', group: 'Camera and system', label: 'Fly camera on / off' },
  { code: 'BracketRight', group: 'Camera and system', label: 'Fly camera faster' },
  { code: 'BracketLeft', group: 'Camera and system', label: 'Fly camera slower' },
  { code: 'Equal', group: 'Camera and system', label: 'Fly camera faster (second key)' },
  { code: 'Minus', group: 'Camera and system', label: 'Fly camera slower (second key)' },
  { code: 'KeyM', group: 'Camera and system', label: 'Sound on / off' },
  { code: 'KeyB', group: 'Camera and system', label: 'Feedback form' },
  { code: 'Digit0', group: 'Camera and system', label: 'Frame-rate counter' },
  { code: 'Backslash', group: 'Camera and system', label: 'Full screen' },
];
// read from the mouse, not rebindable (combat/combat.js, game.js, fly.js)
export const MOUSE = [['Mouse', 'Look around'], ['Left button', 'Fire'], ['Right button', 'Aim'], ['Wheel', 'Next / previous weapon · fly camera speed']];
const NO_BIND = /^(Escape|MetaLeft|MetaRight|OSLeft|OSRight|ContextMenu|Unidentified|)$/;
const NAMES = { Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
  NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down' };

export class Keys {
  constructor(settings) {
    this.S = settings; this.actions = ACTIONS.map((a) => ({ ...a })); this.groups = GROUPS.slice(); this.layout = null; this.load();
    settings.on('keys', () => this.load());
    // the letters as printed on this player's keyboard (AZERTY, QWERTZ, Dvorak ...), where the browser tells us
    try { if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then((m) => { this.layout = m; if (this.onLayout) this.onLayout(); }, () => {}); } catch (e) {}
  }
  load() {
    const b = this.S.get('keys', {}); this.bind = {}; this.is = new Set(this.actions.map((a) => a.code));
    if (b && typeof b === 'object') for (const k in b) if (this.is.has(k) && typeof b[k] === 'string' && b[k] !== k) this.bind[k] = b[k];
    const m = (this.p2l = new Map()); for (const a of this.actions) { const p = this.phys(a.code); if (p && !m.has(p)) m.set(p, a.code); }
    this.changed = Object.keys(this.bind).length > 0;
  }
  add(a) { if (!a || !a.code || this.is.has(a.code)) return; this.actions.push({ code: a.code, label: a.label || a.code, group: a.group || 'Camera and system', also: a.also }); if (!this.groups.includes(a.group || 'Camera and system')) this.groups.push(a.group); this.load(); }
  // the physical key now on a logical code ('' when it has none)
  phys(code) { const b = this.bind[code]; return b === undefined ? code : b; }
  // the logical code a physical key gives
  translate(p) { const l = this.p2l.get(p); return l !== undefined ? l : this.is.has(p) ? 'Unbound' : p; }
  owner(p) { const l = this.p2l.get(p); return l === undefined ? null : this.actions.find((a) => a.code === l); }
  canBind(p) { return !NO_BIND.test(p || ''); }
  // give `code` the physical key p; the action that had p takes the key `code` had (a swap), so nothing is left without a key
  assign(code, p) {
    const had = this.phys(code), o = this.owner(p), b = { ...this.bind };
    if (o && o.code !== code) b[o.code] = had;
    b[code] = p; for (const k in b) if (b[k] === k) delete b[k];
    this.S.set('keys', b);
  }
  resetAll() { this.S.set('keys', {}); }
  name(p) {
    if (!p) return 'no key'; if (NAMES[p]) return NAMES[p];
    let m; if ((m = /^Numpad(\d)$/.exec(p))) return 'Num ' + m[1]; if ((m = /^Digit(\d)$/.exec(p))) return m[1]; if ((m = /^F(\d+)$/.exec(p))) return p;
    if (/^Key[A-Z]$/.test(p)) { try { const c = this.layout && this.layout.get(p); if (c && c.length === 1) return c.toUpperCase(); } catch (e) {} return p.slice(3); }
    try { const c = this.layout && this.layout.get(p); if (c) return c.toUpperCase(); } catch (e) {}
    return p.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  keyName(code) { return this.name(this.phys(code)); }
}
