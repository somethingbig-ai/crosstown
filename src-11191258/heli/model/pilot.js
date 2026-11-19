// pilot.js: a seated figure for the right front seat, seen only from outside through the glass (model.js shows it when the aircraft is
// running with nobody the game has put in the seat). Not a character: a helmet with a dark visor, a jaw, a torso in a flight suit, arms
// to the cyclic and the collective, legs to the pedals. Built to dims.js (pilotSeat, pilotEye). Pure maths (meshkit).
import { Soup, S, AO, mat, tube, lathe, smoothPath, I3, rotZ, rotX, mul3 } from './meshkit.js';

const PM = {
  suit: mat(0x27324a, 0.85, 0, 0, 0), vest: mat(0x3d4034, 0.9, 0, 0, 0), helmet: mat(0xdcdad2, 0.32, 0, 0.8, 0), visor: mat(0x08090b, 0.12, 0, 1, 0),
  skin: mat(0xb48468, 0.6, 0, 0, 0), glove: mat(0x1b1c1d, 0.8, 0, 0, 0), boot: mat(0x141414, 0.7, 0, 0, 0), strap: mat(0x1a1b1d, 0.7, 0, 0, 0), mic: mat(0x0d0d0e, 0.6, 0, 0, 0),
};
function ball(s, c, r, m, seg = 12, sy = 1, R = I3) { const prof = [], n = 8; for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI; prof.push([Math.cos(a) * r, Math.sin(a) * r * sy]); } const k = s.nv; lathe(s, prof, seg, m); s.place(k, R, c); return k; }
// a limb: a tube through points with radii, round ends
const limb = (s, pts, rr, m, seg = 8) => tube(s, smoothPath(pts, 3), (i) => { const t = i / ((pts.length - 1) * 3); return rr[0] + (rr[1] - rr[0]) * t; }, seg, m, { caps: 1 });

export function buildPilot(D, q = 0) {
  const s = new Soup(), [sx, sy, sz] = D.pilotSeat, e = D.pilotEye, seg = q ? 6 : 10;
  const hipY = sy + 0.46, hx = sx - 0.06, shY = e[1] - 0.19, shX = e[0] - 0.13;
  // torso: a flattened barrel from the hips to the shoulders, leaning back a little with the seat
  { const k = s.nv; tube(s, smoothPath([[hx, hipY - 0.06, sz], [hx - 0.02, hipY + 0.12, sz], [shX - 0.01, shY - 0.14, sz], [shX, shY, sz], [shX + 0.02, shY + 0.05, sz]], 3), (i) => [0.145, 0.15, 0.152, 0.156, 0.16, 0.165, 0.168, 0.168, 0.165, 0.16, 0.14, 0.11, 0.07][i] || 0.07, seg + 4, PM.suit, { caps: 1 });
    for (let v = k * S; v < s.v.length; v += S) { s.v[v + 2] = sz + (s.v[v + 2] - sz) * 1.28; s.v[v] = hx + (s.v[v] - hx) * 0.82; } }
  // a survival vest over the chest, and the harness
  { const k = s.nv; tube(s, [[shX + 0.035, shY - 0.30, sz], [shX + 0.04, shY - 0.06, sz]], 0.158, seg + 4, PM.vest); for (let v = k * S; v < s.v.length; v += S) { s.v[v + 2] = sz + (s.v[v + 2] - sz) * 1.3; s.v[v] = shX + 0.03 + (s.v[v] - shX - 0.03) * 0.86; } }
  for (const sg of [-1, 1]) limb(s, [[shX + 0.14, hipY + 0.05, sz + sg * 0.05], [shX + 0.165, shY - 0.15, sz + sg * 0.09], [shX + 0.06, shY + 0.045, sz + sg * 0.11], [shX - 0.1, shY + 0.01, sz + sg * 0.11]], [0.022, 0.022], PM.strap, 5);
  // neck, head (only the jaw shows under the visor), helmet with its visor and a boom microphone
  limb(s, [[shX + 0.03, shY + 0.02, sz], [e[0] - 0.07, e[1] - 0.09, sz]], [0.058, 0.052], PM.skin, seg);
  ball(s, [e[0] - 0.045, e[1] - 0.035, sz], 0.098, PM.skin, seg + 2, 1.18);
  ball(s, [e[0] - 0.075, e[1] + 0.012, sz], 0.128, PM.helmet, seg + 4, 1.0);
  { const k = s.nv, n = 8, prof = []; for (let i = 0; i <= n; i++) { const a = -0.62 + (i / n) * 1.0; prof.push([Math.cos(a) * 0.125, Math.sin(a) * 0.125]); } lathe(s, prof, seg + 4, PM.visor);      // a band of dark visor round the front
    for (let v = k * S; v < s.v.length; v += S) if (s.v[v] < -0.02) { s.v[v + 8] = PM.helmet.c[0]; s.v[v + 9] = PM.helmet.c[1]; s.v[v + 10] = PM.helmet.c[2]; s.v[v + 11] = PM.helmet.r; }
    s.place(k, I3, [e[0] - 0.04, e[1] + 0.012, sz]); }
  for (const sg of [-1, 1]) ball(s, [e[0] - 0.085, e[1] - 0.03, sz + sg * 0.118], 0.05, PM.helmet, 8, 1.25, rotX(sg * 0.2));      // ear cups
  limb(s, [[e[0] - 0.06, e[1] - 0.06, sz - 0.125], [e[0] + 0.02, e[1] - 0.105, sz - 0.1], [e[0] + 0.055, e[1] - 0.1, sz - 0.03]], [0.006, 0.006], PM.mic, 5);
  ball(s, [e[0] + 0.058, e[1] - 0.1, sz - 0.02], 0.014, PM.mic, 6);
  // arms: the right hand on the cyclic between the knees, the left on the collective beside the seat
  const cyc = [sx + 0.36, sy + 0.60, sz], col = [sx + 0.10, sy + 0.42, sz - 0.27];
  for (const [sg, hand, elbow] of [[1, cyc, [sx + 0.13, sy + 0.66, sz + 0.27]], [-1, col, [sx - 0.04, sy + 0.62, sz - 0.30]]]) {
    const sh = [shX + 0.015, shY - 0.02, sz + sg * 0.205];
    limb(s, [sh, [(sh[0] + elbow[0]) / 2, (sh[1] + elbow[1]) / 2, (sh[2] + elbow[2]) / 2 + sg * 0.015], elbow], [0.058, 0.048], PM.suit, seg);
    limb(s, [elbow, [(elbow[0] + hand[0]) / 2, (elbow[1] + hand[1]) / 2 - 0.01, (elbow[2] + hand[2]) / 2], hand], [0.046, 0.036], PM.suit, seg);
    ball(s, hand, 0.046, PM.glove, 8, 1.1); ball(s, sh, 0.066, PM.suit, 8);
  }
  // the sticks the hands hold (the cockpit draws its own inside; these are what shows from outside)
  limb(s, [[cyc[0] + 0.03, sy + 0.05, sz], [cyc[0] + 0.02, cyc[1] - 0.12, sz], [cyc[0], cyc[1] + 0.03, sz]], [0.014, 0.017], PM.strap, 6);
  limb(s, [[col[0] - 0.42, sy + 0.16, col[2] + 0.02], [col[0] + 0.03, col[1] - 0.01, col[2]]], [0.015, 0.02], PM.strap, 6);
  // legs: thighs along the cushion, shins down to the pedals
  for (const sg of [-1, 1]) {
    const hip = [hx + 0.03, hipY - 0.03, sz + sg * 0.095], knee = [sx + 0.43, hipY + 0.085, sz + sg * 0.16], foot = [sx + 0.80, sy + 0.14, sz + sg * 0.17];
    limb(s, [hip, [(hip[0] + knee[0]) / 2, (hip[1] + knee[1]) / 2 + 0.02, (hip[2] + knee[2]) / 2], knee], [0.088, 0.068], PM.suit, seg);
    limb(s, [knee, [(knee[0] + foot[0]) / 2 + 0.03, (knee[1] + foot[1]) / 2 + 0.01, (knee[2] + foot[2]) / 2], foot], [0.062, 0.048], PM.suit, seg);
    ball(s, knee, 0.07, PM.suit, 8);
    limb(s, [[foot[0] - 0.05, foot[1] - 0.03, foot[2]], [foot[0] + 0.14, foot[1] + 0.05, foot[2]]], [0.05, 0.042], PM.boot, 6);
  }
  // inside a cabin the sky reaches a figure through the windows only: a flat share of it, more on the head and shoulders by the glass
  for (let v = 0; v < s.v.length; v += S) { const y = s.v[v + 1]; s.v[v + AO] = 0.34 + 0.3 * Math.min(1, Math.max(0, (y - (sy + 0.5)) / 0.5)); }
  void rotZ; void mul3;
  return s;
}
