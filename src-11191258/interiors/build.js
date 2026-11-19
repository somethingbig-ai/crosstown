// interiors/build.js (lanes/shops/interiors): a plan (plan.js) -> merged geometry in the bay frame. Everything static is ONE mesh with one material
// (vertex colours carry the albedo times a light baked from the ceiling fixtures, a little floor shade near walls and under fixtures; one atlas
// texture, art.js). Glass is a second mesh; each door leaf is a mesh of its own (it swings). Local frame: x = u (along the wall), y up from the
// shop floor, z out of the wall (the room is at z < 0); the caller places the meshes at the bay (storefront frame: (d.x, 0.15, -d.y), yaw d.rot).
import * as THREE from 'three';
import { REG, AW, AH } from './art.js';

const lin = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); };
// materials: col = albedo (linear), cell = atlas region, tile = metres per repeat [along, up] or 'fit' (stretched once over the face), em = self-lit
// (absolute, not touched by the bake), side = colour of the other faces when only `face` carries the texture
export const MAT = {
  vinylChecker: { cell: 'checker', tile: [0.6, 0.6] }, vinylWhite: { cell: 'vinyl', tile: [0.6, 0.6] }, tileRed: { cell: 'quarry', tile: [0.6, 0.6] }, marble: { cell: 'marble', tile: [1.0, 1.0] },
  ceilTile: { cell: 'ceil', tile: [1.2, 1.2] }, ceilPlaster: { col: lin('#d8d2c4') },
  wallWhite: { col: lin('#e4e4df') }, wallCream: { col: lin('#d9cfb2') }, wallWarm: { cell: 'tilewall', tile: [0.6, 0.6], col: lin('#f0e6d8') }, panel: { cell: 'woodpanel', tile: [1.2, 1.4] },
  skirt: { col: lin('#2a2a2a') }, skirtDark: { col: lin('#1a120c') }, reveal: { col: lin('#3a3a3a') },
  kick: { col: lin('#2c2d30') }, shelfBack: { col: lin('#d4d4d2') }, shelf: { col: lin('#e2e2e0') },
  goodsDeli: { cell: 'grocery', tile: [1.0, 'fit'], side: lin('#30302e') }, goodsSnack: { cell: 'snacks', tile: [1.0, 'fit'], side: lin('#30302e') }, goodsRx: { cell: 'rx1', tile: [1.0, 'fit'], side: lin('#d8d8d8') }, goodsRx2: { cell: 'rx2', tile: [1.0, 'fit'], side: lin('#d8d8d8') },
  fridgeBody: { col: lin('#c9cccf') }, fridgeFront: { cell: 'fridge', tile: [0.8, 'fit'], em: 0.85 }, fridgeTop: { cell: 'fridgetop', tile: [1.6, 'fit'], em: 0.6, side: lin('#202020') }, chrome: { col: lin('#a9acb0') },
  counterTop: { col: lin('#5a564f') }, counterFront: { cell: 'wood', tile: [1.0, 1.0], side: lin('#3a2a1c') }, counterWhite: { col: lin('#ecebe8') }, counterSteel: { cell: 'steel', tile: [1.0, 1.0] }, counterRed: { col: lin('#8a1a14') },
  register: { cell: 'screen', tile: 'fit', col: [1, 1, 1], side: lin('#18181a') }, lotto: { cell: 'lotto', tile: 'fit', em: 0.55, side: lin('#222') },
  deliCase: { cell: 'delicase', tile: [1.2, 'fit'], em: 0.7, side: lin('#3b3b3b') }, menuDeli: { cell: 'menuDeli', tile: 'fit', em: 0.75, side: lin('#141414') }, menuPizza: { cell: 'menuPizza', tile: 'fit', em: 0.8, side: lin('#3a1210') },
  pies: { cell: 'pies', tile: [0.8, 0.8], em: 0.55 }, ovenFront: { cell: 'ovenmouth', tile: [1.6, 'fit'], side: lin('#8f9497') }, hood: { cell: 'hood', tile: [1.0, 'fit'] }, steelDoors: { cell: 'steel', tile: [0.8, 'fit'] },
  sodaFridge: { cell: 'fridge', tile: [0.95, 'fit'], em: 0.85, side: lin('#b31b17') }, tableTop: { col: lin('#3a2c22') }, chairSeat: { col: lin('#5a1c16') },
  stoneTop: { cell: 'stone', tile: [1.0, 1.0] }, woodDesk: { cell: 'wooddesk', tile: [1.2, 'fit'] }, woodDark: { col: lin('#24160d') }, hotelSign: { cell: 'hotelsign', tile: 'fit', em: 0.5, side: lin('#1a120c') },
  lampShade: { col: lin('#ffe1b0'), em: 2.2 }, rug: { cell: 'rug', tile: 'fit' }, sofa: { cell: 'fabric', tile: [0.8, 0.8] }, planter: { col: lin('#1c1c1c') }, plant: { cell: 'leaves', tile: [0.6, 0.6] },
  artwork: { cell: 'art', tile: 'fit', side: lin('#3a2a10') }, signRx: { cell: 'rxsign', tile: 'fit', em: 1.1, side: lin('#1d4f9c') }, aisleSign: { cell: 'aisle', tile: 'fit', em: 0.9, side: lin('#1f5fb8') },
  backWall: { col: lin('#d9cfb2') }, light: { col: lin('#fffaf0'), em: 5.0 }, lightWarm: { col: lin('#ffd9a0'), em: 3.2 }, cord: { col: lin('#111') }, frame: { col: [0.05, 0.05, 0.05] },
  sneeze: { glass: true }, pizzaCase: { glass: true },
};
const regUV = (name) => { const [x, y, w, h] = REG[name] || REG.white; return [x / AW, 1 - (y + h) / AH, w / AW, h / AH]; };

// ---------------------------------------------------------------------------------------------------------------------------- the builder
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.cell = []; this.base = []; this.em = []; this.idx = []; }
  // a quad: origin o, edge vectors a (along s) and b (along t), normal nrm; s0/t0 = metres of o along the texture axes; split into cells of at most `sub` m
  quad(o, a, b, nrm, m, opts = {}) {
    const la = Math.hypot(...a), lb = Math.hypot(...b); if (la < 1e-4 || lb < 1e-4) return;
    const M = MAT[m] || MAT.wallWhite, textured = !!M.cell && opts.tex !== false, cell = regUV(textured ? M.cell : 'white');
    const col = textured ? (M.col || [1, 1, 1]) : (opts.tex === false && M.side ? M.side : (M.col || [0.8, 0.8, 0.8]));
    const em = textured || !M.side ? (M.em || 0) : 0, sub = opts.sub || 1.0, na = Math.max(1, Math.ceil(la / sub)), nb = Math.max(1, Math.ceil(lb / sub));
    const tile = M.tile || [1, 1], fit = tile === 'fit', tu = fit ? 'fit' : tile[0], tv = fit ? 'fit' : tile[1], s0 = opts.s0 || 0, t0 = opts.t0 || 0;
    const v0 = this.p.length / 3;
    for (let j = 0; j <= nb; j++) for (let i = 0; i <= na; i++) {
      const fa = i / na, fb = j / nb; this.p.push(o[0] + a[0] * fa + b[0] * fb, o[1] + a[1] * fa + b[1] * fb, o[2] + a[2] * fa + b[2] * fb); this.n.push(nrm[0], nrm[1], nrm[2]);
      const s = s0 + la * fa, t = t0 + lb * fb; this.uv.push(tu === 'fit' ? fa : s / tu, tv === 'fit' ? fb : t / tv); this.cell.push(cell[0], cell[1], cell[2], cell[3]); this.base.push(col[0], col[1], col[2]); this.em.push(em);
    }
    for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const q = v0 + j * (na + 1) + i; this.idx.push(q, q + 1, q + na + 2, q, q + na + 2, q + na + 1); }
  }
  // an axis-aligned box: faces facing the viewer the right way round (s runs to the viewer's right, t up); skip = set of faces left out
  box(b, m, opts = {}) {
    const [u0, u1, y0, y1, z0, z1] = b, F = opts.face, skip = opts.skip || '', sub = opts.sub || 1.0;
    const tex = (f) => (F ? f === F : true);
    if (!skip.includes('z+')) this.quad([u0, y0, z1], [u1 - u0, 0, 0], [0, y1 - y0, 0], [0, 0, 1], m, { tex: tex('z+'), sub, s0: u0, t0: y0 });
    if (!skip.includes('z-')) this.quad([u1, y0, z0], [u0 - u1, 0, 0], [0, y1 - y0, 0], [0, 0, -1], m, { tex: tex('z-'), sub, s0: -u1, t0: y0 });
    if (!skip.includes('u+')) this.quad([u1, y0, z1], [0, 0, z0 - z1], [0, y1 - y0, 0], [1, 0, 0], m, { tex: tex('u+'), sub, s0: -z1, t0: y0 });
    if (!skip.includes('u-')) this.quad([u0, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0], [-1, 0, 0], m, { tex: tex('u-'), sub, s0: z0, t0: y0 });
    if (!skip.includes('y+')) this.quad([u0, y1, z1], [u1 - u0, 0, 0], [0, 0, z0 - z1], [0, 1, 0], m, { tex: tex('y+'), sub, s0: u0, t0: -z1 });
    if (!skip.includes('y-') && y0 > 0.02) this.quad([u0, y0, z0], [u1 - u0, 0, 0], [0, 0, z1 - z0], [0, -1, 0], m, { tex: tex('y-'), sub, s0: u0, t0: z0 });
  }
  geometry(colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cell, 4));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1)); g.computeBoundingSphere(); return g;
  }
}

// the baked light: the ceiling fixtures (Lambert emitters facing down, a wrapped Lambert receiver), a floor of ambient, darker by walls and under things
function bake(G, P) {
  const n = G.p.length / 3, out = new Float32Array(n * 3), H = P.H, L = P.lights, K = 2.6, amb = 0.16, tint = P.warm ? [1.0, 0.82, 0.6] : [1.0, 0.985, 0.95], br = P.bright || 1;
  const feet = P.items.filter((it) => it.solid && it.box[2] < 0.05).map((it) => it.box);
  for (let i = 0; i < n; i++) {
    const px = G.p[i * 3], py = G.p[i * 3 + 1], pz = G.p[i * 3 + 2], nx = G.n[i * 3], ny = G.n[i * 3 + 1], nz = G.n[i * 3 + 2], em = G.em[i];
    if (em > 0) { for (let c = 0; c < 3; c++) out[i * 3 + c] = G.base[i * 3 + c] * em; continue; }
    let s = 0;
    for (const l of L) { const vx = l[0] - px, vy = H - 0.05 - py, vz = l[1] - pz, d2 = vx * vx + vy * vy + vz * vz + 1e-4, d = Math.sqrt(d2); const e = Math.max(0, vy / d), c = Math.max(0, (nx * vx + ny * vy + nz * vz) / d * 0.8 + 0.2); s += l[2] * K * e * c / (d2 + 0.6); }
    if (ny < -0.5) s = s * 0.15 + 0.12;     // the ceiling sees the fixtures edge-on: lit by what bounces off the floor
    let ao = 1;
    const dw = Math.min(px - P.ua, P.ub - px, pz - P.zb, P.zf - pz);
    if (ny > 0.5 && py < 0.05) { ao *= 1 - 0.42 * Math.exp(-Math.max(0, dw) / 0.3); for (const b of feet) { const ex = Math.max(b[0] - px, 0, px - b[1]), ez = Math.max(b[4] - pz, 0, pz - b[5]), dd = Math.hypot(ex, ez); if (dd < 0.35) ao *= 0.45 + 0.55 * (dd / 0.35); } }
    else if (Math.abs(ny) < 0.5) { ao *= 0.55 + 0.45 * Math.min(1, py / 0.7); if (dw < 0.05) ao *= 1 - 0.22 * Math.exp(-(H - py) / 0.25); }
    const v = (amb + s) * ao * br; for (let c = 0; c < 3; c++) out[i * 3 + c] = G.base[i * 3 + c] * v * tint[c];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------- one shop
export function buildShop(d, P) {
  const FL = 0.015, S = new Geo(), Gl = [], { ua, ub, zb, zf, H } = P, x0 = d.x0, x1 = d.x1, dl = d.dl, dr = d.dr, bk = d.bk, top = d.sLo, zF = d.zF;
  // shell: floor, ceiling, back and side walls (inner faces), the front wall with its openings, reveals, a threshold in the door
  S.quad([ua, FL, zf], [ub - ua, 0, 0], [0, 0, zb - zf], [0, 1, 0], P.floor, { sub: 0.5, s0: ua, t0: -zf });     // FL: 1.5 cm over the sidewalk mesh, which runs on under the building (it z-fought)
  S.quad([ua, H, zb], [ub - ua, 0, 0], [0, 0, zf - zb], [0, -1, 0], P.ceil, { sub: 0.8, s0: ua, t0: zb });
  S.quad([ua, 0, zb], [ub - ua, 0, 0], [0, H, 0], [0, 0, 1], P.wall, { sub: 0.8, s0: ua });
  S.quad([ua, 0, zf], [0, 0, zb - zf], [0, H, 0], [1, 0, 0], P.wall, { sub: 0.8, s0: -zf });
  S.quad([ub, 0, zb], [0, 0, zf - zb], [0, H, 0], [-1, 0, 0], P.wall, { sub: 0.8, s0: zb });
  const xs = [...new Set([ua, ub, x0, x1, dl, dr].map((v) => Math.max(ua, Math.min(ub, v))))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) { const a = xs[i], b = xs[i + 1]; if (b - a < 1e-3) continue; const m = (a + b) / 2, open = m > dl && m < dr ? [0, top] : m > x0 && m < x1 ? [bk, top] : null;
    const spans = open ? [[0, open[0]], [open[1], H]] : [[0, H]];
    for (const [y0, y1] of spans) if (y1 - y0 > 1e-3) S.quad([b, y0, zf], [a - b, 0, 0], [0, y1 - y0, 0], [0, 0, -1], P.wall, { sub: 0.8, s0: -b, t0: y0 }); }
  // reveals: the depth of the front between the room's wall and the storefront's glass line
  const zr = 0.0, rv = (o, a, b, nrm) => S.quad(o, a, b, nrm, 'reveal', { sub: 2 });
  rv([x0, bk, zr], [0, 0, zf - zr], [0, top - bk, 0], [1, 0, 0]); rv([x1, bk, zf], [0, 0, zr - zf], [0, top - bk, 0], [-1, 0, 0]);
  rv([x0, top, zf], [x1 - x0, 0, 0], [0, 0, zr - zf], [0, -1, 0]);
  for (const [a, b] of [[x0, dl], [dr, x1]]) if (b - a > 0.02) rv([a, bk, zr], [b - a, 0, 0], [0, 0, zf - zr], [0, 1, 0]);
  if (dl > x0 + 0.01) rv([dl, 0, zr], [0, 0, zf - zr], [0, bk, 0], [1, 0, 0]); if (dr < x1 - 0.01) rv([dr, 0, zf], [0, 0, zr - zf], [0, bk, 0], [-1, 0, 0]);
  S.quad([dl, d.st, zF + 0.02], [dr - dl, 0, 0], [0, 0, zf - 0.02 - zF - 0.02], [0, 1, 0], 'counterTop', { sub: 2 });     // the threshold, from the storefront's step to the room
  if (d.st > 0.03) S.quad([dr, 0, zf - 0.02], [dl - dr, 0, 0], [0, d.st, 0], [0, 0, -1], 'counterTop', { sub: 2 });
  // skirting along the walls (not across the door)
  const sk = P.base, kh = 0.1, kd = 0.015;
  S.box([ua, ub, 0, kh, zb, zb + kd], sk, { skip: 'z-' }); S.box([ua, ua + kd, 0, kh, zb, zf], sk, { skip: 'u-' }); S.box([ub - kd, ub, 0, kh, zb, zf], sk, { skip: 'u+' });
  for (const [a, b] of [[ua, Math.min(x0, dl)], [Math.max(x1, dr), ub]]) if (b - a > 0.05) S.box([a, b, 0, kh, zf - kd, zf], sk, { skip: 'z+' });
  // the door frame (the storefront's own frame is hidden with its door while the shop is open)
  const fm = 'frame'; MAT.frame.col = d.frame || [0.05, 0.05, 0.05]; const zd = d.zd, dh = 2.15 + d.st;
  S.box([dl, dl + 0.06, 0, top, zd - 0.04, zd + 0.07], fm); S.box([dr - 0.06, dr, 0, top, zd - 0.04, zd + 0.07], fm); S.box([dl, dr, dh, dh + 0.07, zd - 0.04, zd + 0.07], fm); S.box([dl, dr, top - 0.05, top, zd - 0.04, zd + 0.07], fm);
  // glass: the shop windows, the transom over the door
  for (const [a, b] of [[x0, dl], [dr, x1]]) if (b - a > 0.12) Gl.push({ c: [(a + b) / 2, (bk + top) / 2, zF], w: b - a, h: top - bk });
  Gl.push({ c: [(dl + dr) / 2, (dh + 0.07 + top - 0.05) / 2, zd], w: dr - dl - 0.12, h: top - 0.05 - dh - 0.07 });
  // the plan's things
  for (const it of P.items) { const M = MAT[it.m]; if (M && M.glass) { const b = it.box; Gl.push({ box: b }); continue; } S.box(it.box, it.m, { face: it.face, sub: 1.2 }); }
  // the light fittings
  for (const l of P.lights) {
    if (P.warm) { S.box([l[0] - 0.18, l[0] + 0.18, H - 0.75, H - 0.5, l[1] - 0.18, l[1] + 0.18], 'lightWarm'); S.box([l[0] - 0.01, l[0] + 0.01, H - 0.5, H, l[1] - 0.01, l[1] + 0.01], 'cord'); }
    else if (P.floor === 'tileRed') S.box([l[0] - 0.3, l[0] + 0.3, H - 0.03, H - 0.005, l[1] - 0.3, l[1] + 0.3], 'light', { skip: 'y+' });
    else S.box([l[0] - 0.6, l[0] + 0.6, H - 0.04, H - 0.005, l[1] - 0.15, l[1] + 0.15], 'light', { skip: 'y+' });
  }
  const geo = S.geometry(bake(S, P));
  // glass: one quad per pane (or the faces of a glass box), in the same frame
  const gp = [], gi = [], pane = (cx, cy, cz, w, h, nrmAxis) => { const v0 = gp.length / 3; if (nrmAxis === 'z') gp.push(cx - w / 2, cy - h / 2, cz, cx + w / 2, cy - h / 2, cz, cx + w / 2, cy + h / 2, cz, cx - w / 2, cy + h / 2, cz); else gp.push(cx, cy - h / 2, cz - w / 2, cx, cy - h / 2, cz + w / 2, cx, cy + h / 2, cz + w / 2, cx, cy + h / 2, cz - w / 2); gi.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); };
  for (const q of Gl) { if (q.box) { const [u0, u1, y0, y1, z0, z1] = q.box; pane((u0 + u1) / 2, (y0 + y1) / 2, z1, u1 - u0, y1 - y0, 'z'); pane(u0, (y0 + y1) / 2, (z0 + z1) / 2, z1 - z0, y1 - y0, 'u'); pane(u1, (y0 + y1) / 2, (z0 + z1) / 2, z1 - z0, y1 - y0, 'u'); const v0 = gp.length / 3; gp.push(u0, y1, z0, u1, y1, z0, u1, y1, z1, u0, y1, z1); gi.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); }
    else if (q.w > 0.05 && q.h > 0.05) pane(q.c[0], q.c[1], q.c[2], q.w, q.h, 'z'); }
  const glass = new THREE.BufferGeometry(); glass.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); glass.setIndex(gi); glass.computeVertexNormals(); glass.computeBoundingSphere();
  // door leaves: hinge, width, which way it opens; each leaf's geometry is in its own frame (x from the hinge along the closed leaf, z = 0 at its face)
  const leaves = [], lw = (a, b, side) => leaves.push({ hinge: side > 0 ? [a, zd] : [b, zd], len: b - a, side });
  if (d.dbl) { lw(dl + 0.06, (dl + dr) / 2, 1); lw((dl + dr) / 2, dr - 0.06, -1); } else lw(dl + 0.06, dr - 0.06, ((d.bid * 31 + 7) % 2) ? 1 : -1);
  for (const L of leaves) {
    const G = new Geo(), len = L.len, st = d.st, top2 = dh, k = L.side, X = (a, b) => (k > 0 ? [a, b] : [-b, -a]);
    const [a1, b1] = X(0, 0.075), [a2, b2] = X(len - 0.075, len), [a3, b3] = X(0, len);
    G.box([a1, b1, st + 0.01, top2, -0.02, 0.035], fm); G.box([a2, b2, st + 0.01, top2, -0.02, 0.035], fm); G.box([a3, b3, top2 - 0.1, top2, -0.02, 0.035], fm);
    G.box([a3, b3, st + 0.01, st + 0.27, -0.02, 0.04], d.brass ? 'lampShade' : 'chrome'); if (d.brass) { /* a brass kick plate reads as warm metal, not a lamp */ }
    const [ph0, ph1] = X(len - 0.16, len - 0.13); G.box([ph0, ph1, st + 0.85, st + 1.35, 0.045, 0.075], 'chrome'); G.box([ph0, ph1, st + 0.85, st + 1.35, -0.06, -0.03], 'chrome');
    const cols = new Float32Array(G.p.length); for (let i = 0; i < G.p.length / 3; i++) { const e = G.em[i]; for (let c = 0; c < 3; c++) cols[i * 3 + c] = G.base[i * 3 + c] * (e > 0 ? 0.55 : 0.5); }
    if (d.brass) for (let i = 0; i < G.p.length / 3; i++) if (G.em[i] > 0) { cols[i * 3] = 0.42; cols[i * 3 + 1] = 0.3; cols[i * 3 + 2] = 0.11; }
    L.geo = G.geometry(cols);
    const gx = (k > 0 ? 0.075 : -len + 0.075), gw = len - 0.15, gy = st + 0.27, gh = top2 - 0.1 - st - 0.27, lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([gx, gy, 0.01, gx + gw, gy, 0.01, gx + gw, gy + gh, 0.01, gx, gy + gh, 0.01], 3)); lg.setIndex([0, 1, 2, 0, 2, 3]); lg.computeVertexNormals(); L.glass = lg;
  }
  // collision: the room's walls (front with the door gap) and every solid thing, as segments in the bay frame
  const segs = [[ua, zf, ua, zb], [ua, zb, ub, zb], [ub, zb, ub, zf], [ua, zf, dl, zf], [dr, zf, ub, zf]];
  for (const it of P.items) if (it.solid) { const [u0, u1, , , z0, z1] = it.box; segs.push([u0, z0, u1, z0], [u1, z0, u1, z1], [u1, z1, u0, z1], [u0, z1, u0, z0]); }
  return { geo, glass, leaves, segs, tris: geo.index.count / 3 + gi.length / 3 };
}

// one material for every interior's static mesh: atlas x baked vertex colour (unlit), a global brightness
export function shopMaterial(tex, uBright) {
  return new THREE.ShaderMaterial({
    uniforms: { tAtlas: { value: tex }, uBright },
    vertexShader: `attribute vec3 color; attribute vec2 aUV; attribute vec4 aCell; varying vec3 vCol; varying vec2 vUV; varying vec4 vCell;
      void main() { vCol = color; vUV = aUV; vCell = aCell; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tAtlas; uniform float uBright; varying vec3 vCol; varying vec2 vUV; varying vec4 vCell;
      void main() { vec2 e = vec2(1.5 / ${AW}.0, 1.5 / ${AH}.0), f = fract(vUV), uv = vCell.xy + e + f * (vCell.zw - 2.0 * e);
        vec3 t = textureGrad(tAtlas, uv, dFdx(vUV) * vCell.zw, dFdy(vUV) * vCell.zw).rgb; gl_FragColor = vec4(t * vCol * uBright, 1.0); }`,
  });
}
