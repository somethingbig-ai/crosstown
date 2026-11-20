// layout.js: where everything sits on the instrument panel, in the panel's own flat coordinates (metres): u to the pilot's right
// (+Z of the aircraft), v up along the leaning face, from the panel centre DIMS.panel gives. Shared by the printed panel picture
// (faces.js), the 3D bezels and knobs (cabin.js) and the live parts (cockpit.js).
export const PANEL = { w: 1.04, h: 0.42, top: 0.21, bot: -0.21, waist: -0.035, stackHalf: 0.125 };     // full width above the waist; only the centre stack below it
const B = 0.040, S = 0.030, T = 0.027;
export const DIALS = [
  // the pilot's six (right side)
  { id: 'asi', u: 0.215, v: 0.152, r: B, big: true }, { id: 'ai', u: 0.315, v: 0.152, r: B, big: true }, { id: 'alt', u: 0.415, v: 0.152, r: B, big: true },
  { id: 'tach', u: 0.215, v: 0.052, r: B, big: true }, { id: 'hsi', u: 0.315, v: 0.052, r: B, big: true }, { id: 'vsi', u: 0.415, v: 0.052, r: B, big: true },
  { id: 'clock', u: 0.487, v: 0.150, r: T }, { id: 'oat', u: 0.487, v: 0.060, r: T },
  // engine and systems (left of the centre stack)
  { id: 'tq', u: -0.218, v: 0.158, r: S }, { id: 'tot', u: -0.298, v: 0.158, r: S }, { id: 'fuel', u: -0.378, v: 0.158, r: S },
  { id: 'oilp', u: -0.218, v: 0.078, r: S }, { id: 'oilt', u: -0.298, v: 0.078, r: S }, { id: 'volt', u: -0.378, v: 0.078, r: S },
];
export const dial = (id) => DIALS.find((d) => d.id === id);
export const STACK_U = -0.005;
export const UNITS = {
  cwp: { u: 0.0, v: 0.178, w: 0.262, h: 0.046 },                    // caution / warning panel (all of it lights)
  gps: { u: STACK_U, v: 0.090, w: 0.212, h: 0.104, screen: { u: STACK_U - 0.036, v: 0.090, w: 0.118, h: 0.086 } },
  com: { u: STACK_U, v: 0.008, w: 0.212, h: 0.044, screen: { u: STACK_U - 0.022, v: 0.010, w: 0.118, h: 0.024 } },
  xpdr: { u: STACK_U, v: -0.041, w: 0.212, h: 0.044, screen: { u: STACK_U - 0.030, v: -0.039, w: 0.086, h: 0.024 } },
  audio: { u: STACK_U, v: -0.085, w: 0.212, h: 0.034 },
  sw: { u: STACK_U, v: -0.150, w: 0.212, h: 0.080 },                // lower switch plate
};
// rows of toggle switches printed and built on the panel: [u, v, label, up?]
export const SWITCHES = [];
{ const L = ['BATT', 'GEN', 'FUEL P', 'PITOT', 'HORN', 'INST LT', 'NAV LT', 'A-COL', 'LDG LT']; L.forEach((s, i) => SWITCHES.push({ u: -0.485 + i * 0.039, v: 0.008, label: s, up: i !== 5 && i !== 8, guard: i < 2 })); }
{ const L = ['AVIONICS', 'HYD TEST', 'SERVO', 'FLOATS', 'CARGO']; L.forEach((s, i) => SWITCHES.push({ u: STACK_U - 0.078 + i * 0.039, v: -0.150, label: s, up: i === 0, guard: i === 3 })); }
export const CWP_CELLS = [
  ['ENG OUT', 'r'], ['ENG FAIL', 'r'], ['LOW NR', 'r'], ['ENG FIRE', 'r'], ['MGB P', 'r'], ['ENG P', 'r'], ['BATT T', 'r'], ['HYD', 'r'],
  ['GEN', 'a'], ['FUEL', 'a'], ['FUEL P', 'a'], ['FUEL FILT', 'a'], ['ENG CHIP', 'a'], ['MGB CHIP', 'a'], ['TGB CHIP', 'a'], ['MGB T', 'a'],
  ['PITOT', 'a'], ['DOOR', 'a'], ['HORN', 'a'], ['GOV', 'a'], ['BATT', 'a'], ['INV', 'a'], ['STARTER', 'g'], ['LDG LT', 'g'],
];
// the dynamic picture (screens that light): pixel rectangles in a 1024 x 512 canvas
export const DYN = { W: 1024, H: 512, gps: [0, 0, 528, 384], cwp: [0, 392, 1024, 120], com: [536, 0, 480, 96], xpdr: [536, 104, 352, 96] };
