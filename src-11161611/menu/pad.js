// menu/pad.js (progress lane, Nov 14): the controller screen (a drawn pad with every control labelled) and the pad reader the menu uses.
// What each control does is copied from what the game reads today (Nov 14):
//   game.js readInput: left stick steer / walk, right stick look, RT (7) gas, LT (6) brake, A (0) handbrake, L3 (10) run, Y (3) get in or out
//   move/jump.js: A (0) jump on foot          main.js: A or Start presses Play          menu.js: Start (9) opens the menu
//   combat/combat.js padRead (on foot only): LT aim, RT fire, X (2) reload, RB (5) next / LB (4) previous weapon, B (1) gun away / out
//   heli/heli.js: left stick tilt, LB / RB turn, RT up / LT down, X (2) engine, R3 (11) camera, Y (3) get out, right stick look
// If one of those files changes its buttons, change the table here.
export const PAD_NAMES = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', ls: 'Left stick', rs: 'Right stick', l3: 'press', r3: 'press', dpad: 'D-pad', back: 'View', start: 'Menu' },
  ps: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', ls: 'Left stick', rs: 'Right stick', l3: 'L3', r3: 'R3', dpad: 'D-pad', back: 'Create', start: 'Options' },
};
export const PAD_MODES = [['foot', 'On foot'], ['car', 'Driving'], ['heli', 'Helicopter'], ['menu', 'In this menu']];
export const PAD_MAP = {
  foot: { ls: 'Walk', l3: 'Run (hold)', rs: 'Look around', a: 'Jump', y: 'Get in a car or the helicopter', lt: 'Aim', rt: 'Fire', x: 'Reload', rb: 'Next weapon', lb: 'Previous weapon', b: 'Gun away / out', start: 'Pause and menu' },
  car: { ls: 'Steer', rs: 'Look around', rt: 'Accelerate', lt: 'Brake and reverse', a: 'Handbrake', y: 'Get out (when stopped)', start: 'Pause and menu' },
  heli: { ls: 'Tilt: nose down / up, bank', rs: 'Look around', r3: 'Next camera', rt: 'Climb', lt: 'Descend', rb: 'Turn right', lb: 'Turn left', x: 'Start the engine', y: 'Get out (landed)', start: 'Pause and menu' },
  menu: { ls: 'Move', dpad: 'Move, change a value', a: 'Select', b: 'Back', lb: 'Page before', rb: 'Next page', start: 'Resume' },
};
const AMBER = '#ffb82e';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// the drawing: 1000 x 400 units; labels down both sides, a line from each to its control
const AT = { lt: [350, 56], lb: [350, 92], ls: [370, 180], dpad: [430, 255], back: [462, 176], start: [538, 176], rt: [650, 56], rb: [650, 92], y: [630, 150], b: [662, 180], a: [630, 210], x: [598, 180], rs: [570, 255] };
const LEFT = [['lt', 60], ['lb', 96], ['ls', 160], ['dpad', 262], ['back', 322]], RIGHT = [['rt', 60], ['rb', 96], ['y', 138], ['b', 170], ['a', 202], ['x', 234], ['rs', 276], ['start', 336]];
export function padSvg(mode, style) {
  const N = PAD_NAMES[style] || PAD_NAMES.xbox, M = PAD_MAP[mode] || {}, o = [];
  const used = (k) => !!M[k] || (k === 'ls' && !!M.l3) || (k === 'rs' && !!M.r3), col = (k) => (used(k) ? AMBER : 'rgba(255,255,255,.34)');
  o.push('<svg viewBox="0 0 1000 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Controller layout" style="width:100%;height:auto;display:block;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif">');
  // leader lines first, so they pass behind the pad
  const line = (k, x, y) => { const p = AT[k]; o.push(`<path d="M${x} ${y - 5}L${p[0]} ${p[1]}" stroke="${used(k) ? 'rgba(255,184,46,.55)' : 'rgba(255,255,255,.16)'}" stroke-width="1.5" fill="none"/>`); };
  for (const [k, y] of LEFT) line(k, 262, y); for (const [k, y] of RIGHT) line(k, 738, y);
  // triggers and bumpers (seen from the front, above the body)
  for (const k of ['lt', 'rt']) { const p = AT[k]; o.push(`<rect x="${p[0] - 38}" y="${p[1] - 16}" width="76" height="30" rx="10" fill="#1a1c20" stroke="${col(k)}" stroke-width="2"/>`); }
  for (const k of ['lb', 'rb']) { const p = AT[k]; o.push(`<rect x="${p[0] - 50}" y="${p[1] - 9}" width="100" height="20" rx="8" fill="#1a1c20" stroke="${col(k)}" stroke-width="2"/>`); }
  // body
  o.push('<path d="M320 106 H680 Q722 106 734 150 L770 300 Q782 356 742 362 Q710 366 688 334 L660 296 Q650 284 632 284 H368 Q350 284 340 296 L312 334 Q290 366 258 362 Q218 356 230 300 L266 150 Q278 106 320 106 Z" fill="#16181b" stroke="rgba(255,255,255,.5)" stroke-width="2"/>');
  // sticks
  for (const k of ['ls', 'rs']) { const p = AT[k]; o.push(`<circle cx="${p[0]}" cy="${p[1]}" r="33" fill="#0e0f11" stroke="${col(k)}" stroke-width="2"/><circle cx="${p[0]}" cy="${p[1]}" r="20" fill="#24272c" stroke="${col(k)}" stroke-width="1.5"/>`); }
  // d-pad
  { const p = AT.dpad, c = col('dpad'); o.push(`<path d="M${p[0] - 10} ${p[1] - 28}h20v18h18v20h-18v18h-20v-18h-18v-20h18z" fill="#24272c" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`); }
  // small middle buttons
  for (const k of ['back', 'start']) { const p = AT[k]; o.push(`<rect x="${p[0] - 13}" y="${p[1] - 7}" width="26" height="14" rx="7" fill="#24272c" stroke="${col(k)}" stroke-width="2"/>`); }
  // face buttons, with their own letter or shape
  for (const k of ['a', 'b', 'x', 'y']) { const p = AT[k]; o.push(`<circle cx="${p[0]}" cy="${p[1]}" r="14" fill="#24272c" stroke="${col(k)}" stroke-width="2"/><text x="${p[0]}" y="${p[1] + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="${used(k) ? '#fff' : 'rgba(255,255,255,.45)'}">${esc(N[k])}</text>`); }
  // labels
  const label = (k, x, y, anchor) => {
    const name = N[k], what = M[k], press = k === 'ls' ? M.l3 : k === 'rs' ? M.r3 : null, pn = k === 'ls' ? N.l3 : N.r3;
    o.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="15"><tspan font-weight="700" ${name.length === 1 && name.charCodeAt(0) > 255 ? 'font-size="20"' : ''} fill="${used(k) ? AMBER : 'rgba(255,255,255,.4)'}">${esc(name)}</tspan><tspan dx="9" fill="${what ? '#fff' : 'rgba(255,255,255,.4)'}">${esc(what || 'not used')}</tspan></text>`);
    if (press) o.push(`<text x="${x}" y="${y + 19}" text-anchor="${anchor}" font-size="14"><tspan font-weight="700" fill="${AMBER}">${esc(pn === 'press' ? 'press it' : pn)}</tspan><tspan dx="9" fill="#fff">${esc(press)}</tspan></text>`);
  };
  for (const [k, y] of LEFT) label(k, 252, y, 'end'); for (const [k, y] of RIGHT) label(k, 748, y, 'start');
  o.push('</svg>'); return o.join('');
}
// the pad the game itself would pick (game.js readInput: the first connected one with sticks, the standard layout if there is one)
export function readPad() {
  let gp = null; try { const all = navigator.getGamepads ? navigator.getGamepads() : []; for (const q of all) if (q && q.connected && q.axes.length >= 2 && q.buttons.length >= 4 && (!gp || (q.mapping === 'standard' && gp.mapping !== 'standard'))) gp = q; } catch (e) { gp = null; }
  return gp;
}
export function padStyle(gp) { return gp && /dualsense|dualshock|playstation|sony|054c|wireless controller/i.test(gp.id || '') ? 'ps' : 'xbox'; }
