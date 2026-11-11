// cabin.js: the cabin's solid parts. buildCabin() returns three gathered geometries:
//   fixed    everything that never moves (panel, glareshield, pedestal, overhead, seats, floor, trim, the lived-in things)
//   moving   the flight controls and the pilot's inner door panel, each vertex tied to one bone (see BONES)
//   prints   flat pieces that carry a region of the printed picture (dial faces, the painted panel, legends, placards, the chart)
//   glass    the glass over the dials and screens
//   screens  the pieces that show the lit picture (GPS, radios, caution panel)
// Model space: metres, +X nose, +Y up, +Z right. No DOM in here: it also runs under node for the shading bake and the checks.
import * as THREE from 'three';
import { Builder, M, GRAIN, rbox, warp, lathe, cyl, tube, strap, extrude, rrect, grid, torus, sphere, rng } from './geo.js';
import { PANEL, DIALS, UNITS, SWITCHES, STACK_U, DYN } from './layout.js';

export const BONES = { root: 0, cycR: 1, cycL: 2, col: 3, twR: 4, twL: 5, pedP: 6, pedM: 7, doorR: 8 };
// where the controls pivot (model space), for the bones
export const PIVOT = { cyc: [1.44, 0.75], col: [0.72, 0.86], colZ: -0.275, ped: [2.05, 0.77], door: [1.85, 0.795], seatZ: 0.40 };

// ---- materials (colour as sRGB hex, roughness, metalness, grain, grain repeats per metre, wear, bump)
const MAT = {
  panelBody: { c: 0x17181a, r: 0.6, g: GRAIN.plastic, s: 75, w: 0.35, bump: 0.5 },
  plasticBlack: { c: 0x0d0e0f, r: 0.5, g: GRAIN.plastic, s: 80, w: 0.3, bump: 0.45 },
  plasticGrey: { c: 0x3a3c3f, r: 0.6, g: GRAIN.plastic, s: 70, w: 0.45, bump: 0.6 },
  plasticLight: { c: 0xa3a39d, r: 0.62, g: GRAIN.plastic, s: 70, w: 0.5, bump: 0.6 },
  vinyl: { c: 0x101011, r: 0.6, g: GRAIN.leather, s: 95, w: 0.22, bump: 0.8 },
  leather: { c: 0x26272a, r: 0.5, g: GRAIN.leather, s: 85, w: 0.5, bump: 1.0 },
  fabric: { c: 0x70737a, r: 0.96, g: GRAIN.fabric, s: 42, w: 0.4, bump: 1.0 },
  fabricDark: { c: 0x1e2228, r: 0.96, g: GRAIN.fabric, s: 42, w: 0.4, bump: 1.0 },
  liner: { c: 0x9d9b94, r: 0.95, g: GRAIN.fabric, s: 45, w: 0.35, bump: 0.6 },
  webbing: { c: 0x23272d, r: 0.85, g: GRAIN.fabric, s: 70, w: 0.3, bump: 0.9 },
  floor: { c: 0x3d3e40, r: 0.8, g: GRAIN.plastic, s: 38, w: 0.6, bump: 0.9 },
  rubber: { c: 0x0c0c0d, r: 0.82, g: GRAIN.plastic, s: 70, w: 0.5, bump: 0.5 },
  grip: { c: 0x121213, r: 0.55, g: GRAIN.leather, s: 120, w: 0.9, bump: 0.7 },
  alu: { c: 0xb9bbbe, r: 0.34, m: 1, g: GRAIN.brushed, s: 12, w: 0.6, bump: 0.2 },
  aluDull: { c: 0x8e9195, r: 0.5, m: 1, g: GRAIN.brushed, s: 12, w: 0.7, bump: 0.25 },
  steel: { c: 0x4e5154, r: 0.4, m: 1, g: GRAIN.brushed, s: 16, w: 0.5, bump: 0.2 },
  anod: { c: 0x0e0f11, r: 0.36, m: 0.85, g: GRAIN.brushed, s: 14, w: 0.7, bump: 0.15 },
  screw: { c: 0x8a8b84, r: 0.38, m: 1, g: GRAIN.none, w: 0.2, bump: 0 },
  chrome: { c: 0xd8dadd, r: 0.12, m: 1, g: GRAIN.none, w: 0.2, bump: 0 },
  red: { c: 0xa5140e, r: 0.38, g: GRAIN.none, w: 0.5, bump: 0 },
  redPlastic: { c: 0x93170f, r: 0.45, g: GRAIN.plastic, s: 30, w: 0.5, bump: 0.3 },
  yellow: { c: 0xd3a50c, r: 0.45, g: GRAIN.plastic, s: 30, w: 0.5, bump: 0.3 },
  white: { c: 0xd9d7cf, r: 0.5, g: GRAIN.plastic, s: 30, w: 0.4, bump: 0.3 },
  green: { c: 0x27382a, r: 0.5, g: GRAIN.plastic, s: 26, w: 0.5, bump: 0.5 },
  foam: { c: 0x0b0b0c, r: 1.0, g: GRAIN.fabric, s: 90, w: 0.2, bump: 1.0 },
  paper: { c: 0xd9d4c2, r: 0.9, g: GRAIN.none, w: 0.3, bump: 0 },
  shellSeat: { c: 0x26282b, r: 0.55, g: GRAIN.plastic, s: 70, w: 0.5, bump: 0.6 },
  flange: { c: 0x141516, r: 0.5, g: GRAIN.plastic, s: 90, w: 0.6, bump: 0.4 },
  bezel: { c: 0x222224, r: 0.24, g: GRAIN.none, w: 0.5, bump: 0 },
  slot: { c: 0x050505, r: 0.8, g: GRAIN.none, w: 0, bump: 0 },
  carpet: { c: 0x5e5a52, r: 1.0, g: GRAIN.fabric, s: 110, w: 0.8, bump: 1.0 },
  cable: { c: 0x0a0a0b, r: 0.55, g: GRAIN.none, w: 0.3, bump: 0 },
  knob: { c: 0x0d0d0e, r: 0.42, g: GRAIN.plastic, s: 60, w: 0.8, bump: 0.6 },
};
const UP = M.rx(Math.PI / 2);        // turns a lathe's +Y axis to +Z (out of a face)
const T = M.t, mul = M.mul;

// flat printed pieces: position, normal, uv into the atlas
class Prints {
  constructor(tiles) { this.tiles = tiles; this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.n = 0; }
  // a rectangle w x h in the local XY plane of xf, showing tile `name` (or the part of it given by sub = [x0, y0, x1, y1] as shares, y down)
  quad(name, xf, w, h, nx = 1, ny = 1, sub = null) {
    const t = this.tiles[name], base = this.n, v = new THREE.Vector3(), nrm = new THREE.Vector3(0, 0, 1).transformDirection(xf);
    const s = sub || [0, 0, 1, 1];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const a = i / nx, b = j / ny; v.set((a - 0.5) * w, (b - 0.5) * h, 0).applyMatrix4(xf); this.pos.push(v.x, v.y, v.z); this.nor.push(nrm.x, nrm.y, nrm.z); const su = s[0] + (s[2] - s[0]) * a, sv = s[3] + (s[1] - s[3]) * b; this.uv.push(t.u0 + (t.u1 - t.u0) * su, t.v1 + (t.v0 - t.v1) * sv); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; this.idx.push(a, b, c, b, d, c); }
    this.n += (nx + 1) * (ny + 1); return this;
  }
  disc(name, xf, r, seg = 40) {
    const t = this.tiles[name], base = this.n, v = new THREE.Vector3(), nrm = new THREE.Vector3(0, 0, 1).transformDirection(xf);
    const put = (px, py) => { v.set(px * r, py * r, 0).applyMatrix4(xf); this.pos.push(v.x, v.y, v.z); this.nor.push(nrm.x, nrm.y, nrm.z); this.uv.push(t.u0 + (t.u1 - t.u0) * (px * 0.5 + 0.5), t.v0 + (t.v1 - t.v0) * (py * 0.5 + 0.5)); };
    put(0, 0); for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; put(Math.cos(a), Math.sin(a)); }
    for (let i = 0; i < seg; i++) this.idx.push(base, base + 1 + i, base + 1 + (i + 1) % seg);
    this.n += seg + 1; return this;
  }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); const c = new Float32Array(this.n * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setIndex(this.idx); g.computeBoundingSphere(); return g; }
}

export function buildCabin(DIMS, tiles, opts = {}) {
  // opts.sideZ(x, y): where the shell's inner trim stands on the right side at (x, y); the door fittings sit on it
  const sideZ = opts.sideZ || (() => DIMS.cabinHalfW);
  const B = new Builder(), C = new Builder(true), P = new Prints(tiles), PP = new Prints({ panel: { u0: 0, u1: 1, v0: 0, v1: 1 } }), G = new Prints({ g: { u0: 0, u1: 1, v0: 0, v1: 1 } }), S = new Prints({ s: { u0: 0, u1: 1, v0: 0, v1: 1 } });
  const pn = DIMS.panel, st = Math.sin(pn.tilt), ct = Math.cos(pn.tilt), FY = DIMS.floorY, R = rng(2026);
  // the panel's frame: x = right (+Z), y = up the leaning face, z = out of the face toward the crew
  const PM = M.frame([pn.x, pn.y, 0], [0, 0, 1], [st, ct, 0]);
  const pan = (u, v, w, ...ms) => mul(PM, T(u, v, w), ...ms);
  const info = { PM, dials: {}, tris: {} };

  // ================================================================= instrument panel
  const upC = (PANEL.top + PANEL.waist) / 2, upH = PANEL.top - PANEL.waist, loC = (PANEL.waist + PANEL.bot) / 2, loH = PANEL.waist - PANEL.bot;
  B.add(rbox(PANEL.w + 0.014, upH + 0.014, 0.014, 0.005, 2, 6, 2, 0), MAT.panelBody, pan(0, upC, -0.0072));
  B.add(rbox(PANEL.stackHalf * 2 + 0.014, loH + 0.02, 0.014, 0.005, 2, 2, 2, 0), MAT.panelBody, pan(0, loC - 0.003, -0.0072));
  // the housing behind (what you see through the windscreen from outside)
  B.add(rbox(PANEL.w - 0.03, upH - 0.02, 0.24, 0.03, 3, 4, 1, 1), MAT.plasticBlack, pan(0, upC - 0.004, -0.128));
  B.add(rbox(PANEL.stackHalf * 2 - 0.02, loH + 0.02, 0.22, 0.02, 2, 1, 1, 1), MAT.plasticBlack, pan(0, loC, -0.12));
  PP.quad('panel', pan(0, upC, 0.0002), PANEL.w, upH, 26, 7, [0, 0, 1, upH / PANEL.h]);
  PP.quad('panel', pan(0, loC, 0.0002), PANEL.stackHalf * 2, loH, 6, 5, [0.5 - PANEL.stackHalf / PANEL.w, upH / PANEL.h, 0.5 + PANEL.stackHalf / PANEL.w, 1]);
  const sub = (u, v, w, h) => [(u - w / 2 + PANEL.w / 2) / PANEL.w, (PANEL.top - v - h / 2) / PANEL.h, (u + w / 2 + PANEL.w / 2) / PANEL.w, (PANEL.top - v + h / 2) / PANEL.h];

  // dials: a raised bezel ring, four mounting screws, the printed face, the glass
  for (const d of DIALS) {
    // the case stands proud of the panel: a satin ring with the face sunk 7 mm down its well, glass a little under the rim
    const r = d.r, H = d.big ? 0.014 : 0.012, bz = [[r + 0.0086, 0], [r + 0.0086, H - 0.002], [r + 0.0068, H], [r + 0.0028, H], [r + 0.0012, H - 0.0012], [r + 0.0004, H - 0.0034], [r - 0.0002, 0.0014]];
    if (['ai', 'hsi', 'alt', 'clock', 'tot', 'volt'].includes(d.id)) B.add(rbox(2 * r + 0.0185, 2 * r + 0.0185, 0.0014, 0.0006, 1), MAT.flange, pan(d.u, d.v, 0.0001));
    B.add(lathe(bz, d.big ? 48 : 36), MAT.bezel, pan(d.u, d.v, 0, UP));
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2, q = r + 0.0118, knob = (d.id === 'alt' || d.id === 'hsi' || d.id === 'ai' || d.id === 'clock') && k === 2, knob2 = d.id === 'hsi' && k === 3, at = pan(d.u + Math.cos(a) * q, d.v + Math.sin(a) * q, 0);
      if (knob || knob2) { B.add(lathe([[0.0066, 0], [0.0066, 0.0015], [0.0052, 0.002], [0.0056, 0.0125], [0.0048, 0.0138], [0, 0.0138]], 16), MAT.knob, mul(at, UP)); for (let j = 0; j < 8; j++) B.add(rbox(0.0011, 0.0011, 0.009, 0.0003, 1), MAT.knob, mul(at, M.rz(j * Math.PI / 4), T(0.0056, 0, 0.0075))); continue; }
      B.add(lathe([[0.0029, 0], [0.0029, 0.0006], [0.0021, 0.0014], [0, 0.0016]], 10), MAT.screw, mul(at, UP)); B.add(rbox(0.0046, 0.0007, 0.0006, 0.0002, 1), MAT.slot, mul(at, M.rz(R() * 3.14), T(0, 0, 0.0015))); }
    if (d.id !== 'ai') P.disc(d.id, pan(d.u, d.v, 0.0010), r + 0.0003);
    G.disc('g', pan(d.u, d.v, H - 0.0034), r + 0.0006, 32);
    info.dials[d.id] = d;
  }
  P.disc('aiOver', pan(DIALS[1].u, DIALS[1].v, 0.0032), DIALS[1].r + 0.0003);
  P.disc('hsiOver', pan(DIALS[4].u, DIALS[4].v, 0.0030), DIALS[4].r * 0.86);

  // radio stack: each unit stands a little proud of the panel, its faceplate is its own part of the painted picture
  const unit = (g, proud = 0.007) => { B.add(rbox(g.w, g.h, proud + 0.006, 0.0025, 2), MAT.plasticBlack, pan(g.u, g.v, (proud - 0.006) / 2)); for (const sx of [-1, 1]) for (const sy of [-1, 1]) B.add(lathe([[0.0019, 0], [0.0019, 0.0004], [0.0013, 0.001], [0, 0.0011]], 8), MAT.screw, pan(g.u + sx * (g.w / 2 - 0.0045), g.v + sy * (g.h / 2 - 0.0045), proud, UP)); PP.quad('panel', pan(g.u, g.v, proud + 0.0003), g.w - 0.004, g.h - 0.004, 1, 1, sub(g.u, g.v, g.w - 0.004, g.h - 0.004)); return proud; };
  const scr = (g, key, proud) => { const r = DYN[key]; S.quad('s', pan(g.screen.u, g.screen.v, proud + 0.0008), g.screen.w, g.screen.h, 1, 1, [r[0] / DYN.W, r[1] / DYN.H, (r[0] + r[2]) / DYN.W, (r[1] + r[3]) / DYN.H]); G.quad('g', pan(g.screen.u, g.screen.v, proud + 0.0018), g.screen.w + 0.002, g.screen.h + 0.002); };
  const knob = (u, v, w, r, h, m = MAT.knob) => B.add(lathe([[r * 1.06, 0], [r * 1.06, h * 0.12], [r * 0.94, h * 0.2], [r, h * 0.9], [r * 0.86, h], [0, h]], 16), m, pan(u, v, w, UP));
  { let p = unit(UNITS.gps); scr(UNITS.gps, 'gps', p); const g = UNITS.gps; knob(g.u + 0.076, g.v - 0.030, p, 0.0095, 0.008); knob(g.u + 0.076, g.v - 0.030, p + 0.008, 0.0062, 0.008); knob(g.u - 0.098, g.v + 0.040, p, 0.0048, 0.009); knob(g.u - 0.098, g.v - 0.040, p, 0.0048, 0.009);
    p = unit(UNITS.com); scr(UNITS.com, 'com', p); const c = UNITS.com; knob(c.u + 0.088, c.v + 0.004, p, 0.0085, 0.007); knob(c.u + 0.088, c.v + 0.004, p + 0.007, 0.0055, 0.008); knob(c.u + 0.060, c.v + 0.002, p, 0.0055, 0.010);
    p = unit(UNITS.xpdr); scr(UNITS.xpdr, 'xpdr', p); const x = UNITS.xpdr; knob(x.u - 0.088, x.v + 0.001, p, 0.0075, 0.011);
    p = unit(UNITS.audio, 0.005); const a = UNITS.audio; knob(a.u + 0.094, a.v + 0.002, p, 0.005, 0.009); knob(a.u - 0.096, a.v - 0.006, p, 0.0042, 0.008); }
  // caution / warning panel: a framed block that lights
  { const g = UNITS.cwp, p = 0.006; B.add(rbox(g.w + 0.010, g.h + 0.010, p + 0.006, 0.003, 2), MAT.plasticBlack, pan(g.u, g.v, (p - 0.006) / 2)); const r = DYN.cwp; S.quad('s', pan(g.u, g.v, p + 0.0005), g.w, g.h, 1, 1, [r[0] / DYN.W, r[1] / DYN.H, (r[0] + r[2]) / DYN.W, (r[1] + r[3]) / DYN.H]); G.quad('g', pan(g.u, g.v, p + 0.0014), g.w + 0.002, g.h + 0.002);
    for (const s of [-1, 1]) B.add(lathe([[0.0029, 0], [0.0029, 0.0006], [0.0021, 0.0014], [0, 0.0016]], 10), MAT.screw, pan(g.u + s * (g.w / 2 + 0.0105), g.v, 0, UP)); }
  // toggle switches: a hex nut, a collar and a bat lever thrown up or down; red guards on a few
  for (const s of SWITCHES) {
    B.add(lathe([[0.0052, 0], [0.0052, 0.0022], [0.0034, 0.0024], [0.0034, 0.0046], [0, 0.0046]], 6), MAT.chrome, pan(s.u, s.v, 0, UP));
    const a = (s.up ? 1 : -1) * 0.42; B.add(tube([[0, 0, 0.003], [0, Math.sin(a) * 0.006, 0.003 + Math.cos(a) * 0.006], [0, Math.sin(a) * 0.016, 0.003 + Math.cos(a) * 0.016]], (t) => 0.0014 + t * 0.0012, 7, 4, false), MAT.chrome, pan(s.u, s.v, 0));
    if (s.guard) B.add(rbox(0.011, 0.020, 0.012, 0.002, 2), MAT.redPlastic, pan(s.u, s.v + 0.012, 0.012, M.rx(-0.9)));
  }
  // a few lamps and push-buttons under the pilot's dials
  for (let i = 0; i < 4; i++) B.add(lathe([[0.0046, 0], [0.0046, 0.003], [0.0036, 0.0042], [0, 0.0046]], 12), [MAT.redPlastic, MAT.yellow, MAT.white, MAT.green][i], pan(0.246 + i * 0.022, -0.026, 0, UP));

  // ================================================================= glareshield (a padded hood over the panel) and standby compass
  { const Z0 = 0.494, RB = 0.07, QA = RB * Math.PI / 2;
    const g = warp(rbox(0.46, 0.05, 1.70, 0.023, 4, 8, 0, 72), (v) => {
      const az = Math.abs(v.z), sg = Math.sign(v.z), k = Math.max(0, 1 - (az / 0.5) ** 2), t = v.y;
      if (v.x < 0) v.x -= 0.035 * k * (-v.x / 0.23);
      let cy = 0.012 * k - 0.02 * Math.max(0, v.x / 0.23) ** 2 + 0.0016 * Math.sin(v.z * 31 + v.x * 17) * Math.sin(v.x * 43), cz = az, uy = 1, uz = 0;
      if (az > Z0) { const d = az - Z0; if (d < QA) { const a = d / RB; cz = Z0 + RB * Math.sin(a); cy -= RB * (1 - Math.cos(a)); uy = Math.cos(a); uz = Math.sin(a); } else { cz = Z0 + RB; cy -= RB + (d - QA); uy = 0; uz = 1; if (v.x < 0) v.x += Math.min(0.06, (d - QA) * 0.3) * (-v.x / 0.23); } }
      v.y = cy + t * uy; v.z = sg * (cz + t * uz); });
    B.add(g, MAT.vinyl, mul(T(2.092, 1.452, 0), M.rz(-0.05)));
    // stitched seam along the lip
    for (const dy of [0.0105, -0.0105]) B.add(tube([[1.874, 1.45 + dy, -0.47], [1.851, 1.461 + dy, -0.26], [1.8405, 1.4655 + dy, 0], [1.851, 1.461 + dy, 0.26], [1.874, 1.45 + dy, 0.47]], 0.0017, 5, 40), MAT.leather);
    // a checklist card tucked under the hood's right end, a pair of sunglasses left on top
    B.add(rbox(0.12, 0.003, 0.085, 0.001, 1), MAT.paper, mul(T(2.10, 1.484, 0.33), M.ry(0.3), M.rz(-0.06)));
    for (const s of [-1, 1]) { B.add(rbox(0.006, 0.036, 0.05, 0.012, 3), { c: 0x141210, r: 0.12, g: GRAIN.none, w: 0.3, bump: 0 }, mul(T(2.02, 1.492, -0.30 + s * 0.031), M.rz(-0.9))); B.add(tube([[2.02, 1.497, -0.30 + s * 0.058], [2.08, 1.486, -0.30 + s * 0.064], [2.14, 1.478, -0.30 + s * 0.05]], 0.002, 5, 6), MAT.plasticBlack); }
    // compass: a squat housing on the hood's centre, its card in a window
    B.add(rbox(0.062, 0.05, 0.07, 0.016, 3), MAT.plasticBlack, T(1.93, 1.497, 0)); B.add(lathe([[0.012, 0], [0.012, 0.004], [0.009, 0.006], [0, 0.006]], 12), MAT.knob, mul(T(1.898, 1.482, 0.022), M.rz(Math.PI / 2)));
    info.compass = mul(T(1.8985, 1.502, 0), M.ry(-Math.PI / 2)); G.quad('g', mul(T(1.8975, 1.502, 0), M.ry(-Math.PI / 2)), 0.052, 0.024); }

  // looms from the back of the panel down into the column, tied here and there
  for (const [z0, z1, dx] of [[-0.30, -0.10, 0], [0.33, 0.11, 0.01], [0.22, 0.08, -0.015]]) { B.add(tube([[1.955, 1.155, z0], [1.98, 1.09, z0 * 0.8 + z1 * 0.2], [1.99 + dx, 1.04, z1 * 1.4], [1.985, 0.99, z1 * 1.1]], 0.007, 7, 16), MAT.cable); B.add(rbox(0.004, 0.018, 0.018, 0.001, 1), MAT.white, T(1.981, 1.088, z0 * 0.8 + z1 * 0.2)); }

  // ================================================================= pedestal column and the console between the seats
  { const prof = [[1.80, FY], [2.10, FY], [2.12, 1.03], [1.93, 1.07], [1.845, 1.012]];
    B.add(extrude(prof, 0.25, 0.008, 2), MAT.panelBody, T(0, 0, -0.125));
    B.add(rbox(0.96, 0.27, 0.20, 0.014, 3, 8, 2, 1), MAT.panelBody, T(1.34, FY + 0.135, 0));
    const top = M.frame([1.33, FY + 0.2705, 0], [0, 0, 1], [1, 0, 0]);
    P.quad('pedestal', top, 0.18, 0.54, 3, 8);
    // three levers in their slots: rotor brake (red), fuel flow (yellow), shut-off (red, guarded)
    const lev = (z, x, lean, m, shape) => { const bx = Math.sin(lean), by = Math.cos(lean), y0 = FY + 0.262;
      B.add(rbox(0.004, 0.105, 0.012, 0.0015, 1), MAT.steel, mul(T(x + bx * 0.05, y0 + by * 0.05, z), M.rz(-lean)));       // a flat blade
      const hx = x + bx * 0.108, hy = y0 + by * 0.108;
      if (shape === 'tee') B.add(tube([[hx, hy, z - 0.02], [hx, hy, z + 0.02]], 0.0085, 10, 1, false), m);
      else if (shape === 'twist') { B.add(tube([[hx - bx * 0.012, hy - by * 0.012, z], [hx + bx * 0.03, hy + by * 0.03, z]], (t) => 0.0115 + 0.0008 * Math.sin(t * 40), 12, 20, false), m); }
      else { B.add(rbox(0.016, 0.034, 0.022, 0.006, 3), m, mul(T(hx, hy, z), M.rz(-lean))); B.add(rbox(0.004, 0.05, 0.03, 0.0015, 1), { c: 0x93170f, r: 0.4, m: 0.2, g: GRAIN.none, w: 0.5, bump: 0 }, mul(T(x - 0.022, y0 + 0.022, z), M.rz(0.5))); } };
    lev(-0.0504, 1.50, -0.5, MAT.redPlastic, 'tee'); lev(0, 1.47, 0.45, MAT.yellow, 'twist'); lev(0.0504, 1.50, -0.5, MAT.redPlastic, 'guard');
    // trim hat and four switches aft
    for (const [dx, dz] of [[-0.118, -0.054], [-0.118, 0.054], [-0.172, -0.054], [-0.172, 0.054]]) { const a = R() < 0.5 ? 0.4 : -0.4; B.add(lathe([[0.005, 0], [0.005, 0.002], [0.0033, 0.0024], [0.0033, 0.0044], [0, 0.0044]], 6), MAT.chrome, T(1.33 + dx, FY + 0.2705, dz)); B.add(tube([[0, 0.003, 0], [Math.sin(a) * 0.006, 0.003 + Math.cos(a) * 0.006, 0], [Math.sin(a) * 0.016, 0.003 + Math.cos(a) * 0.016, 0]], (t) => 0.0014 + t * 0.0012, 7, 4, false), MAT.chrome, T(1.33 + dx, FY + 0.2705, dz)); }
    B.add(lathe([[0.012, 0], [0.012, 0.004], [0.006, 0.008], [0.009, 0.015], [0, 0.017]], 12), MAT.knob, T(1.33 - 0.035, FY + 0.2705, 0));
    // a torch in a clip on the console's left flank, a pen tucked by the levers
    B.add(cyl(0.014, 0.15, 14, 0.002), MAT.anod, mul(T(1.20, FY + 0.19, -0.116), M.rz(Math.PI / 2))); B.add(rbox(0.02, 0.034, 0.008, 0.003, 2), MAT.steel, T(1.20, FY + 0.19, -0.104));
  }
  // fire extinguisher on the console's left flank by the co-pilot's legs
  { const x = 1.56, z = -0.158, y = FY + 0.012; B.add(lathe([[0, 0], [0.04, 0], [0.045, 0.006], [0.045, 0.21], [0.036, 0.245], [0.016, 0.262], [0.016, 0.285], [0, 0.285]], 20), MAT.red, T(x, y, z));
    B.add(rbox(0.03, 0.03, 0.035, 0.006, 2), MAT.steel, T(x, y + 0.297, z)); B.add(tube([[x, y + 0.305, z], [x - 0.03, y + 0.325, z], [x - 0.085, y + 0.318, z]], 0.006, 8, 6), MAT.plasticBlack); B.add(tube([[x + 0.012, y + 0.30, z], [x + 0.04, y + 0.29, z], [x + 0.05, y + 0.25, z]], 0.007, 8, 6), MAT.rubber);
    B.add(torus(0.0465, 0.004, 20, 6), MAT.steel, mul(T(x, y + 0.07, z), M.rx(Math.PI / 2))); B.add(torus(0.0465, 0.004, 20, 6), MAT.steel, mul(T(x, y + 0.17, z), M.rx(Math.PI / 2)));
    P.quad('ext', mul(T(x - 0.0456, y + 0.12, z), M.ry(-Math.PI / 2)), 0.05, 0.05);
    B.add(rbox(0.012, 0.26, 0.06, 0.003, 1), MAT.aluDull, T(x + 0.01, y + 0.125, z + 0.048)); B.add(rbox(0.11, 0.008, 0.10, 0.003, 1), MAT.aluDull, T(x, y - 0.004, z + 0.005));
    for (const dy of [0.07, 0.17]) { B.add(rbox(0.016, 0.022, 0.012, 0.003, 1), MAT.chrome, T(x - 0.048, y + dy, z - 0.004)); }
    B.add(tube([[x + 0.005, y + 0.312, z + 0.012], [x + 0.03, y + 0.33, z + 0.012], [x + 0.06, y + 0.318, z + 0.012]], 0.0035, 6, 6), MAT.chrome); B.add(torus(0.007, 0.0012, 12, 5), MAT.chrome, T(x - 0.012, y + 0.305, z + 0.019)); }

  // ================================================================= overhead panel
  { const cx = 1.42, y = DIMS.ceilY - 0.045, L = 0.56, W = 0.30;
    B.add(rbox(L + 0.03, 0.09, W + 0.03, 0.02, 3, 3, 0, 2), MAT.panelBody, T(cx, y, 0));
    const under = M.frame([cx, y - 0.0452, 0], [0, 0, 1], [-1, 0, 0]);       // looked up at: the top of the lettering is aft
    P.quad('overhead', under, W, L, 3, 5);
    // breakers: 6 across, 8 rows on the aft part; switches on the forward part (the same grid the legend is printed on)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) { const u = (0.115 + c * 0.154 - 0.5) * W, v = (0.5 - (0.075 + r * 0.073)) * L, out = R() < 0.06 ? 0.008 : 0.0045; B.add(lathe([[0.0056, 0], [0.0056, 0.0012], [0.004, 0.0016], [0.004, out], [0.0034, out + 0.0008], [0, out + 0.0008]], 10), out > 0.006 ? MAT.white : MAT.knob, mul(under, T(u, v, 0), UP)); }
    for (let i = 0; i < 10; i++) { const u = (0.14 + (i % 5) * 0.18 - 0.5) * W, v = (0.5 - (0.74 + Math.floor(i / 5) * 0.13)) * L, a = (R() < 0.6 ? 1 : -1) * 0.42; B.add(lathe([[0.0052, 0], [0.0052, 0.0022], [0.0034, 0.0024], [0.0034, 0.0046], [0, 0.0046]], 6), MAT.chrome, mul(under, T(u, v, 0), UP)); B.add(tube([[0, 0, 0.003], [0, Math.sin(a) * 0.006, 0.003 + Math.cos(a) * 0.006], [0, Math.sin(a) * 0.016, 0.003 + Math.cos(a) * 0.016]], (t) => 0.0014 + t * 0.0012, 7, 4, false), MAT.chrome, mul(under, T(u, v, 0))); }
  }

  // ================================================================= seats
  const seat = (sx, sz, fab) => {
    const at = (...ms) => mul(T(sx, FY, sz), ...ms), lean = 0.21;
    // base: two floor rails, four legs, a pan
    for (const s of [-1, 1]) { B.add(rbox(0.62, 0.014, 0.036, 0.004, 2), MAT.aluDull, at(T(0.0, 0.008, s * 0.17))); B.add(tube([[0.19, 0.016, s * 0.17], [0.17, 0.14, s * 0.185], [0.15, 0.26, s * 0.20]], 0.011, 8, 6), MAT.anod, at()); B.add(tube([[-0.19, 0.016, s * 0.17], [-0.18, 0.14, s * 0.185], [-0.17, 0.26, s * 0.20]], 0.011, 8, 6), MAT.anod, at()); }
    B.add(tube([[0.165, 0.17, -0.19], [0.165, 0.17, 0.19]], 0.009, 8, 1, false), MAT.anod, at()); B.add(tube([[-0.178, 0.17, -0.19], [-0.178, 0.17, 0.19]], 0.009, 8, 1, false), MAT.anod, at());
    B.add(rbox(0.47, 0.03, 0.47, 0.012, 2, 2, 0, 2), MAT.shellSeat, at(T(0.02, 0.27, 0), M.rz(0.06)));
    // cushion: leather with a pleated fabric insert, crowned, the front rolled
    const cush = warp(rbox(0.46, 0.105, 0.46, 0.04, 3, 6, 0, 6), (v) => { const kx = 1 - (v.x / 0.23) ** 2, kz = 1 - (v.z / 0.23) ** 2; if (v.y > 0) v.y += 0.012 * kx * kz + 0.006 * Math.max(0, Math.abs(v.z) / 0.23 - 0.6) / 0.4; });
    B.add(cush, MAT.leather, at(T(0.02, 0.33, 0), M.rz(0.06)));
    const ins = warp(rbox(0.36, 0.03, 0.30, 0.012, 2, 20, 0, 4), (v) => { if (v.y > 0) v.y += 0.004 * Math.abs(Math.sin((v.x + 0.18) / 0.36 * Math.PI * 5)) + 0.008 * (1 - (v.z / 0.15) ** 2); });
    B.add(ins, fab, at(T(0.02, 0.385, 0), M.rz(0.06)));
    for (const s of [-1, 1]) { B.add(warp(rbox(0.40, 0.06, 0.075, 0.03, 3, 6, 0, 0), (v) => { v.y -= 0.02 * (v.x / 0.2) ** 2; }), MAT.leather, at(T(0.03, 0.392, s * 0.195), M.rz(0.06))); B.add(tube([[-0.16, 0.392, s * 0.152], [0.02, 0.406, s * 0.153], [0.2, 0.413, s * 0.152]], 0.0035, 6, 10), MAT.leather, at()); }
    B.add(tube([[0.205, 0.412, -0.15], [0.209, 0.414, 0], [0.205, 0.412, 0.15]], 0.0035, 6, 8), MAT.leather, at());
    // back: shell, cushion with bolsters, pleated insert, headrest
    const back = (...ms) => at(T(-0.185, 0.36, 0), M.rz(lean), ...ms);      // origin at the hinge line, +Y up the back
    B.add(warp(rbox(0.03, 0.70, 0.475, 0.014, 2, 0, 6, 6), (v) => { if (v.x < 0) v.x -= 0.018 * (1 - (v.z / 0.2375) ** 2) * (1 - ((v.y) / 0.35) ** 2); }), MAT.shellSeat, back(T(-0.062, 0.33, 0)));
    B.add(rbox(0.016, 0.24, 0.36, 0.006, 2, 0, 2, 2), MAT.fabricDark, back(T(-0.094, 0.20, 0))); B.add(rbox(0.008, 0.20, 0.13, 0.002, 1), MAT.paper, back(T(-0.102, 0.27, 0.06), M.rx(0.05)));
    const bc = warp(rbox(0.10, 0.64, 0.45, 0.04, 3, 0, 8, 6), (v) => { if (v.x > 0) v.x += 0.022 * Math.max(0, Math.abs(v.z) / 0.225 - 0.5) / 0.5 + 0.01 * Math.exp(-(((v.y + 0.18) / 0.12) ** 2)); });
    B.add(bc, MAT.leather, back(T(0, 0.33, 0)));
    const bi = warp(rbox(0.03, 0.48, 0.27, 0.012, 2, 0, 22, 4), (v) => { if (v.x > 0) v.x += 0.004 * Math.abs(Math.sin((v.y + 0.24) / 0.48 * Math.PI * 6)) + 0.006 * (1 - (v.z / 0.135) ** 2); });
    B.add(bi, fab, back(T(0.052, 0.30, 0)));
    B.add(warp(rbox(0.095, 0.17, 0.25, 0.04, 3, 0, 2, 3), (v) => { if (v.x > 0) v.x += 0.008 * (1 - (v.z / 0.125) ** 2); }), MAT.leather, back(T(0.012, 0.745, 0)));
    for (const s of [-1, 1]) B.add(tube([[-0.02, 0.63, s * 0.06], [-0.02, 0.70, s * 0.06]], 0.006, 6, 1, false), MAT.chrome, back());
    // harness: lap straps lying across the cushion to a rotary buckle, shoulder straps down the back to it
    const web = MAT.webbing, by = 0.398;
    for (const s of [-1, 1]) {
      B.add(strap([[-0.15, 0.27, s * 0.245], [-0.12, 0.36, s * 0.238], [-0.06, 0.398, s * 0.19], [0.0, 0.402, s * 0.10], [0.03, by + 0.004, s * 0.035]], 0.046, 0.0022, [1, 0.1, 0], 24), web, at());
      B.add(rbox(0.05, 0.006, 0.03, 0.002, 1), MAT.steel, at(T(0.032, by + 0.006, s * 0.045)));
      const xf = (y) => -0.185 - (y - 0.36) * Math.tan(lean) + 0.076;
      B.add(strap([[xf(1.06) - 0.07, 1.075, s * 0.085], [xf(1.05) - 0.01, 1.07, s * 0.085], [xf(0.98) + 0.004, 0.98, s * 0.088], [xf(0.75) + 0.004, 0.75, s * 0.08], [xf(0.52) + 0.012, 0.52, s * 0.06], [0.0, 0.43, s * 0.03], [0.03, by + 0.008, s * 0.012]], 0.044, 0.0022, [0, 0, 1], 30), web, at());
      B.add(rbox(0.012, 0.03, 0.052, 0.003, 1), MAT.steel, at(T(xf(0.80) + 0.008, 0.80, s * 0.081), M.rz(lean)));
    }
    B.add(lathe([[0.029, 0], [0.031, 0.003], [0.031, 0.012], [0.026, 0.016], [0.012, 0.017], [0.012, 0.021], [0, 0.021]], 18), MAT.aluDull, at(T(0.034, by + 0.002, 0), M.rz(0.06)));
    B.add(rbox(0.012, 0.006, 0.03, 0.002, 1), MAT.anod, at(T(0.034, by + 0.024, 0)));
  };
  seat(DIMS.pilotSeat[0], DIMS.pilotSeat[2], MAT.fabric); seat(DIMS.copilotSeat[0], DIMS.copilotSeat[2], MAT.fabric);
  // rear bench: one long cushion and back with four places
  { const at = (...ms) => mul(T(-0.18, FY, 0), ...ms);
    B.add(rbox(0.50, 0.26, 1.50, 0.02, 2, 2, 1, 6), MAT.plasticGrey, at(T(-0.02, 0.13, 0)));
    B.add(warp(rbox(0.48, 0.10, 1.50, 0.04, 3, 4, 0, 16), (v) => { if (v.y > 0) v.y += 0.008 * Math.abs(Math.cos(v.z / 0.375 * Math.PI)) ** 0.5 * (1 - (v.x / 0.24) ** 2); }), MAT.leather, at(T(0, 0.31, 0), M.rz(0.05)));
    B.add(warp(rbox(0.10, 0.66, 1.50, 0.04, 3, 0, 6, 16), (v) => { if (v.x > 0) v.x += 0.01 * Math.abs(Math.cos(v.z / 0.375 * Math.PI)) ** 0.5; }), MAT.leather, at(T(-0.285, 0.36, 0), M.rz(0.16), T(0, 0.33, 0)));
    for (let i = 0; i < 4; i++) { const z = -0.5625 + i * 0.375;
      B.add(warp(rbox(0.36, 0.03, 0.27, 0.012, 2, 16, 0, 3), (v) => { if (v.y > 0) v.y += 0.004 * Math.abs(Math.sin((v.x + 0.18) / 0.36 * Math.PI * 5)); }), MAT.fabric, at(T(0, 0.362, z), M.rz(0.05)));
      B.add(warp(rbox(0.03, 0.50, 0.27, 0.012, 2, 0, 18, 3), (v) => { if (v.x > 0) v.x += 0.004 * Math.abs(Math.sin((v.y + 0.25) / 0.5 * Math.PI * 6)); }), MAT.fabric, at(T(-0.285, 0.36, z), M.rz(0.16), T(0.05, 0.32, 0)));
      for (const s of [-1, 1]) B.add(strap([[-0.21, 0.30, z + s * 0.165], [-0.17, 0.372, z + s * 0.15], [-0.08, 0.378, z + s * 0.09], [-0.02, 0.38, z + s * 0.03]], 0.044, 0.0022, [1, 0, 0], 14), MAT.webbing, at());
      B.add(rbox(0.05, 0.012, 0.045, 0.004, 2), MAT.aluDull, at(T(-0.02, 0.386, z))); }
  }

  // ================================================================= floor, sills, liners
  { const x0 = DIMS.cabinRearX - 0.07, x1 = opts.sideZ ? 2.9 : DIMS.cabinFrontX, cx = (x0 + x1) / 2;        // the floor runs out to the shell's own walls and into the nose
    B.add(warp(grid(x1 - x0, 2, 52, 24), (v) => { v.y *= Math.max(0.05, sideZ(Math.min(2.95, cx + v.x), FY + 0.012) + 0.012); }), MAT.carpet, mul(T(cx, FY + 0.001, 0), M.rx(-Math.PI / 2))); }
  for (const s of [-1, 1]) {
    B.add(rbox(1.56, 0.012, 0.09, 0.004, 2, 6, 0, 0), MAT.alu, T(1.05, FY + 0.006, s * 0.79));                       // sill tread plate
    for (let i = 0; i < 9; i++) B.add(rbox(0.012, 0.004, 0.05, 0.0015, 1), MAT.rubber, T(0.42 + i * 0.158, FY + 0.013, s * 0.79));
    // the fixed lower wall beside the rear bench
    // floor rails for cargo rings
    B.add(rbox(1.30, 0.006, 0.03, 0.002, 1, 6, 0, 0), MAT.aluDull, T(0.30, FY + 0.004, s * 0.50));
  }
  // the left (co-pilot's) inner door panel, fixed; the pilot's is on a bone so it swings with the door
  const doorPanel = (Bx, s, bone) => { const d = DIMS.doorR, cx = (d.x0 + d.x1) / 2, zAt = (x, y) => s * (sideZ(x, y) - 0.004);
    let z = zAt(cx - 0.25, FY + 0.20);
    Bx.add(rbox(0.46, 0.16, 0.04, 0.014, 2, 2, 1, 0), MAT.plasticLight, T(cx - 0.25, FY + 0.20, z - s * 0.016), bone);                     // map pocket
    Bx.add(rbox(0.21, 0.13, 0.008, 0.002, 1), MAT.paper, mul(T(cx - 0.30, FY + 0.275, z - s * 0.02), M.rz(0.08)), bone);               // a folded chart in it
    Bx.add(lathe([[0, 0], [0.03, 0], [0.032, 0.01], [0.032, 0.13], [0.014, 0.165], [0.014, 0.18], [0, 0.18]], 12), { c: 0x9fb3bf, r: 0.15, g: GRAIN.none, w: 0.2, bump: 0 }, T(cx - 0.10, FY + 0.155, z - s * 0.034), bone);
    Bx.add(cyl(0.016, 0.02, 12), { c: 0x1d4fa0, r: 0.4, g: GRAIN.none, w: 0.2, bump: 0 }, T(cx - 0.10, FY + 0.343, z - s * 0.034), bone);
    z = zAt(cx + 0.42, FY + 0.43);
    Bx.add(rbox(0.19, 0.07, 0.014, 0.005, 2), MAT.plasticGrey, T(cx + 0.42, FY + 0.43, z - s * 0.005), bone);                               // latch plate and handle
    Bx.add(rbox(0.13, 0.03, 0.022, 0.008, 2), MAT.anod, T(cx + 0.42, FY + 0.43, z - s * 0.018), bone);
    z = zAt(cx + 0.10, FY + 0.39);
    Bx.add(tube([[cx - 0.02, FY + 0.38, z - s * 0.004], [cx + 0.02, FY + 0.39, z - s * 0.045], [cx + 0.18, FY + 0.39, z - s * 0.045], [cx + 0.22, FY + 0.38, z - s * 0.004]], 0.011, 8, 12), MAT.grip, null, bone);   // pull handle
  };
  doorPanel(B, -1, 0); doorPanel(C, 1, BONES.doorR);
  P.quad('door', T(1.47, FY + 0.50, -(sideZ(1.47, FY + 0.50) - 0.002)), 0.14, 0.033);

  // ================================================================= the lived-in things
  const headset = (xf) => {
    B.add(torus(0.085, 0.007, 22, 6, Math.PI * 1.05), MAT.anod, mul(xf, M.rz(-0.025 * Math.PI)));
    B.add(warp(rbox(0.11, 0.026, 0.03, 0.01, 2, 4, 0, 0), (v) => { v.y -= 0.03 * (v.x / 0.055) ** 2; }), MAT.leather, mul(xf, T(0, 0.086, 0)));
    for (const s of [-1, 1]) { const cup = mul(xf, T(s * 0.082, -0.03, 0), M.ry(s * Math.PI / 2));
      B.add(rbox(0.078, 0.098, 0.04, 0.018, 3), MAT.green, cup); B.add(torus(0.034, 0.012, 16, 8), MAT.leather, mul(cup, T(0, 0, -0.024), M.s(1, 1.25, 1)));
      B.add(tube([[s * 0.09, 0.0, 0], [s * 0.094, 0.02, 0], [s * 0.089, 0.045, 0]], 0.003, 6, 5), MAT.steel, xf); }
    B.add(tube([[-0.088, -0.045, 0.012], [-0.08, -0.085, 0.05], [-0.05, -0.10, 0.085], [-0.015, -0.10, 0.10]], 0.0032, 6, 12), MAT.anod, xf); B.add(sphere(0.012, 10, 8), MAT.foam, mul(xf, T(-0.008, -0.10, 0.101), M.s(1.3, 1, 1)));
    // the lead: a few coils, then straight
    const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([0.085 + Math.sin(t * 34) * 0.008, -0.08 - t * 0.22, Math.cos(t * 34) * 0.008]); } B.add(tube(pts, 0.0026, 4, 70), MAT.rubber, xf);
  };
  // one hung on a hook behind the front seats, one left on the co-pilot's seat with the kneeboard
  B.add(tube([[0.42, DIMS.ceilY - 0.02, 0.30], [0.42, DIMS.ceilY - 0.08, 0.30], [0.435, DIMS.ceilY - 0.095, 0.30], [0.45, DIMS.ceilY - 0.08, 0.30]], 0.004, 6, 8), MAT.steel);
  headset(mul(T(0.435, DIMS.ceilY - 0.176, 0.30), M.ry(0.3)));
  headset(mul(T(0.99, FY + 0.46, -0.50), M.rz(0.06), M.rx(-Math.PI / 2 + 0.25), M.ry(0.5)));
  { const kb = mul(T(1.07, FY + 0.412, -0.36), M.rz(0.06), M.ry(0.35), M.rx(-Math.PI / 2));     // kneeboard: flat on the cushion, its top toward the nose
    B.add(rbox(0.165, 0.235, 0.006, 0.003, 2), MAT.plasticBlack, kb); B.add(rbox(0.09, 0.022, 0.012, 0.003, 2), MAT.chrome, mul(kb, T(0, 0.108, 0.008)));
    P.quad('chart', mul(kb, T(0, -0.008, 0.0036)), 0.15, 0.204, 2, 2);
    B.add(cyl(0.004, 0.14, 8, 0.001), { c: 0x1b3a8a, r: 0.35, g: GRAIN.none, w: 0.3, bump: 0 }, mul(kb, T(0.062, 0.01, 0.009), M.rz(0.1))); }
  P.quad('exit', mul(T(DIMS.cabinRearX - 0.062, 1.80, 0), M.ry(Math.PI / 2)), 0.19, 0.05);
  P.quad('belt', mul(T(DIMS.cabinRearX - 0.062, 1.62, 0.5), M.ry(Math.PI / 2)), 0.10, 0.035);
  // pedal cross-tubes and their floor brackets (the pedals themselves move), a ribbed heel plate under each pair
  for (const sz of [PIVOT.seatZ, -PIVOT.seatZ]) { B.add(rbox(0.16, 0.004, 0.30, 0.0015, 1, 2, 0, 4), MAT.aluDull, T(1.80, FY + 0.003, sz)); B.add(tube([[PIVOT.ped[0], PIVOT.ped[1], sz - 0.17], [PIVOT.ped[0], PIVOT.ped[1], sz + 0.17]], 0.012, 8, 1, false), MAT.anod); for (const s of [-1, 1]) B.add(rbox(0.05, 0.06, 0.012, 0.004, 1), MAT.aluDull, T(PIVOT.ped[0], FY + 0.03, sz + s * 0.165)); }
  // cyclic boots on the floor, collective boots by the seats
  for (const sz of [PIVOT.seatZ, -PIVOT.seatZ]) {
    B.add(lathe([[0.075, 0], [0.075, 0.003], [0.066, 0.004], [0.062, 0.012], [0.05, 0.017], [0.058, 0.03], [0.042, 0.04], [0.05, 0.053], [0.033, 0.063], [0.04, 0.075], [0.024, 0.086], [0.028, 0.096], [0.0135, 0.104]], 24), MAT.rubber, T(PIVOT.cyc[0], FY + 0.001, sz)); B.add(lathe([[0.084, 0], [0.084, 0.0035], [0.074, 0.0045], [0.066, 0.0045]], 24), MAT.aluDull, T(PIVOT.cyc[0], FY + 0.001, sz)); for (let k = 0; k < 6; k++) B.add(lathe([[0.0032, 0], [0.0032, 0.0008], [0, 0.0016]], 8), MAT.screw, T(PIVOT.cyc[0] + Math.cos(k * 1.047) * 0.079, FY + 0.0055, sz + Math.sin(k * 1.047) * 0.079));
    B.add(rbox(0.10, 0.07, 0.05, 0.015, 2), MAT.rubber, T(PIVOT.col[0] + 0.01, PIVOT.col[1] - 0.045, sz + PIVOT.colZ)); B.add(rbox(0.09, 0.10, 0.04, 0.008, 2), MAT.aluDull, T(PIVOT.col[0] + 0.01, FY + 0.05, sz + PIVOT.colZ));
  }
  // ---- fittings on the cabin trim (they stand on the shell's inner skin; opts.skin gives the skin point and its outward normal)
  if (opts.skin && opts.doorFront) {
    const inn = (x, y, sg, t) => { const q = opts.skin(x, y, sg); return [q.p[0] - q.n[0] * t, q.p[1] - q.n[1] * t, q.p[2] - q.n[2] * t]; };
    const onWall = (x, y, sg, t) => { const q = opts.skin(x, y, sg), n = new THREE.Vector3(-q.n[0], -q.n[1], -q.n[2]), m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)); m.setPosition(q.p[0] + n.x * t, q.p[1] + n.y * t, q.p[2] + n.z * t); return m; };
    const face = (x, y, sg, t) => { const q = opts.skin(x, y, sg), up = [0, q.n[2] * sg, -q.n[1] * sg], o = [q.p[0] - q.n[0] * t, q.p[1] - q.n[1] * t, q.p[2] - q.n[2] * t]; return M.frame(o, [-sg, 0, 0], up); };
    for (const sg of [-1, 1]) {
      // grab handle on the windscreen post, an eyeball vent under it
      const xa = opts.doorFront(1.50) + 0.034, xb = opts.doorFront(1.76) + 0.034;
      B.add(tube([inn(xa, 1.50, sg, 0.038), inn(xa, 1.52, sg, 0.085), inn((xa + xb) / 2, 1.63, sg, 0.092), inn(xb, 1.74, sg, 0.085), inn(xb, 1.76, sg, 0.038)], 0.0085, 10, 16), MAT.grip);
      for (const [x, y] of [[xa, 1.50], [xb, 1.76]]) B.add(lathe([[0.016, 0], [0.016, 0.004], [0.011, 0.008]], 12), MAT.plasticGrey, onWall(x, y, sg, 0.037));
      const xv = opts.doorFront(1.08) + 0.075; B.add(lathe([[0.034, 0], [0.034, 0.006], [0.028, 0.011], [0.024, 0.008], [0.022, 0.002]], 20), MAT.plasticBlack, onWall(xv, 1.08, sg, 0.037)); B.add(sphere(0.021, 14, 10), MAT.plasticGrey, onWall(xv, 1.08, sg, 0.036)); B.add(cyl(0.012, 0.012, 12), MAT.slot, mul(onWall(xv, 1.08, sg, 0.047), M.rx(0.35)));
      // sliding vent pane in the door window: a framed rectangle with a knob (the pilot's rides the door)
      const Bx = sg > 0 ? C : B, bone = sg > 0 ? BONES.doorR : 0, x0 = 1.16, x1 = 1.56, y0 = 1.245, y1 = 1.50, T0 = 0.018;
      const edge = (ax, ay, bx, by) => { const pts = []; for (let i = 0; i <= 5; i++) pts.push(inn(ax + (bx - ax) * i / 5, ay + (by - ay) * i / 5, sg, T0)); Bx.add(tube(pts, 0.0045, 6, 10), MAT.plasticBlack, null, bone); };
      edge(x0, y0, x1, y0); edge(x1, y0, x1, y1); edge(x1, y1, x0, y1); edge(x0, y1, x0, y0); edge(x0 - 0.2, y0, x0, y0); edge(x0 - 0.2, y1, x0, y1);
      Bx.add(lathe([[0.009, 0], [0.009, 0.004], [0.006, 0.006], [0.0075, 0.016], [0, 0.018]], 12), MAT.knob, onWall(x0 + 0.03, (y0 + y1) / 2, sg, T0 + 0.003), bone);
      // placards that can be read: the exit over the door window, the door's own under it
      P.quad('exit', face(1.02, 1.972, sg, 0.039), 0.27, 0.072);
    }
  }
  info.tris.fixed = B.tris;

  // ================================================================= the moving parts (bind pose: controls centred, collective level along +X)
  for (const [sz, bone] of [[PIVOT.seatZ, BONES.cycR], [-PIVOT.seatZ, BONES.cycL]]) {
    const [px, py] = PIVOT.cyc;
    C.add(tube([[px, py, sz], [px + 0.012, py + 0.17, sz], [px - 0.012, py + 0.32, sz], [px - 0.075, py + 0.405, sz], [px - 0.10, py + 0.43, sz]], 0.011, 10, 26), MAT.anod, null, bone);
    // grip: a moulded handle swelling to the palm, a head carrying the trim hat, two small buttons and a trigger, a coiled lead to the floor
    C.add(tube([[px - 0.095, py + 0.42, sz], [px - 0.105, py + 0.46, sz], [px - 0.116, py + 0.52, sz], [px - 0.123, py + 0.575, sz]], (t) => 0.0165 + 0.0055 * Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.7 + (t > 0.86 ? (t - 0.86) * 0.05 : 0), 18, 30), MAT.grip, null, bone);
    C.add(lathe([[0.019, 0], [0.021, 0.004], [0.019, 0.008], [0.0125, 0.012]], 16), MAT.plasticBlack, mul(T(px - 0.0935, py + 0.412, sz), M.rz(0.24)), bone);
    const head = mul(T(px - 0.128, py + 0.598, sz), M.rz(0.25));
    C.add(rbox(0.046, 0.04, 0.05, 0.014, 4), MAT.grip, head, bone);
    C.add(lathe([[0.0055, 0], [0.0055, 0.003], [0.0028, 0.006], [0.0048, 0.0098], [0, 0.0104]], 12), MAT.plasticGrey, mul(head, T(-0.004, 0.02, 0.006)), bone);
    C.add(lathe([[0.0034, 0], [0.0034, 0.0028], [0, 0.0034]], 10), MAT.redPlastic, mul(head, T(-0.008, 0.02, -0.014)), bone);
    C.add(lathe([[0.003, 0], [0.003, 0.0022], [0, 0.0028]], 10), MAT.plasticGrey, mul(head, T(0.011, 0.02, -0.011)), bone);
    C.add(rbox(0.006, 0.026, 0.01, 0.0025, 2), MAT.plasticBlack, mul(head, T(0.027, -0.012, 0), M.rz(-0.3)), bone);
    { const pts = [], a0 = [px - 0.10, py + 0.415, sz + 0.012], a1 = [px + 0.02, py + 0.20, sz + 0.05], a2 = [px + 0.05, py + 0.03, sz + 0.07]; for (let i = 0; i <= 110; i++) { const t = i / 110, u = 1 - t, cx = u * u * a0[0] + 2 * u * t * a1[0] + t * t * a2[0], cy = u * u * a0[1] + 2 * u * t * a1[1] + t * t * a2[1], cz = u * u * a0[2] + 2 * u * t * a1[2] + t * t * a2[2], k = t < 0.08 || t > 0.92 ? 0 : 1, ph = t * 120; pts.push([cx + Math.cos(ph) * 0.006 * k, cy + Math.sin(ph * 0.5) * 0.001, cz + Math.sin(ph) * 0.006 * k]); } C.add(tube(pts, 0.0019, 4, 200), MAT.cable, null, bone); }
  }
  for (const [sz, tw] of [[PIVOT.seatZ, BONES.twR], [-PIVOT.seatZ, BONES.twL]]) {
    const [px, py] = PIVOT.col, z = sz + PIVOT.colZ;
    C.add(tube([[px - 0.03, py, z], [px + 0.36, py, z]], 0.0135, 10, 1, false), MAT.anod, null, BONES.col);
    C.add(lathe([[0.019, 0], [0.019, 0.004], [0.0155, 0.006], [0.0155, 0.02]], 12), MAT.aluDull, mul(T(px + 0.335, py, z), M.rz(-Math.PI / 2)), BONES.col);
    // twist grip: ribbed rubber, turning about the lever
    C.add(tube([[px + 0.36, py, z], [px + 0.475, py, z]], (t) => 0.0195 + 0.0012 * Math.sin(t * Math.PI * 22), 12, 44, false), MAT.grip, null, tw);
    C.add(rbox(0.004, 0.004, 0.012, 0.001, 1), MAT.white, T(px + 0.37, py + 0.0195, z), tw);
    // the head: a box of switches
    const head = T(px + 0.515, py + 0.004, z);
    C.add(rbox(0.075, 0.05, 0.058, 0.01, 3), MAT.plasticBlack, head, BONES.col);
    C.add(rbox(0.012, 0.018, 0.02, 0.003, 2), MAT.redPlastic, mul(head, T(0.012, 0.03, -0.012), M.rz(0.5)), BONES.col);
    for (const [dx, dz, a] of [[-0.018, 0.012, 0.4], [0.014, 0.014, -0.4], [-0.018, -0.014, 0.0]]) C.add(tube([[dx, 0.025, dz], [dx + Math.sin(a) * 0.006, 0.033, dz], [dx + Math.sin(a) * 0.012, 0.041, dz]], (t) => 0.0014 + t * 0.001, 6, 3, false), MAT.chrome, head, BONES.col);
    C.add(lathe([[0.005, 0], [0.005, 0.003], [0, 0.004]], 10), MAT.yellow, mul(head, T(0.039, 0.0, 0.0), M.rz(-Math.PI / 2)), BONES.col);
  }
  for (const sz of [PIVOT.seatZ, -PIVOT.seatZ]) for (const [dz, bone] of [[0.105, BONES.pedP], [-0.105, BONES.pedM]]) {
    const [px, py] = PIVOT.ped, z = sz + dz;
    for (const dzz of [-0.028, 0.028]) C.add(tube([[px, py, z + dzz], [px - 0.05, py + 0.10, z + dzz], [px - 0.13, py + 0.19, z + dzz]], 0.0075, 8, 10), MAT.anod, null, bone); C.add(tube([[px - 0.06, py + 0.115, z - 0.03], [px - 0.06, py + 0.115, z + 0.03]], 0.005, 6, 1, false), MAT.steel, null, bone); C.add(lathe([[0.009, 0], [0.009, 0.012], [0, 0.013]], 10), MAT.knob, mul(T(px - 0.135, py + 0.165, z + 0.05), M.rx(Math.PI / 2)), bone);
    const pad = mul(T(px - 0.14, py + 0.215, z), M.rz(0.5));
    C.add(rbox(0.014, 0.105, 0.088, 0.005, 2), MAT.aluDull, pad, bone);
    for (let i = 0; i < 5; i++) C.add(rbox(0.006, 0.008, 0.08, 0.002, 1), MAT.rubber, mul(pad, T(-0.008, -0.04 + i * 0.02, 0)), bone);
  }
  info.tris.moving = C.tris;

  return { fixed: B.build(), moving: C.build(), prints: P.build(), panel: PP.build(), glass: G.build(), screens: S.build(), info, MAT };
}
