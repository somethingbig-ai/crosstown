// park/transverse.js: the 65th St transverse's retaining walls (park lane, helper transverse 2, Nov 17 2026).
// The sunken road's sides were the park's ground mesh pulled up a 1 : 1.5 bank (grey asphalt and smooth rock on a 2 m grid, a sawtooth where
// it met an arch). Here: along every way named '65th Street Transverse' that is not itself a bridge deck, on each side, where the ground 1..3 m
// behind the wall line stands more than RISE above the road bed, a vertical wall of coursed stone (bridge.js's material, the plain
// grey-buff wall stone of the park's perimeter wall) from below the bed to that ground's height, its top in level steps of 4 m, a
// 0.3 m coping, a stone strip from the coping back to the ground (it covers the bank's stretched face), a return at each open end, a narrow
// raised sidewalk at the foot of the north wall. At an arch that crosses the road (the deck lines of the data's arches `over: transverse`)
// the coped wall stops on the deck's edge and a plain face runs on under the deck up to the soffit, 4.9 m from the centre line as outside
// (the opening stays open); nothing is built on any transverse's roadway. Collision: one segment per wall piece,
// under the chunk's own statics owner, so it goes when the chunk leaves near. Built when a park chunk is near, into the chunk's near group
// (dropped and disposed with it). ?parktransverse=0 = not fetched, the trench as before.
import * as THREE from 'three';
import { material } from './bridge.js';

const NAME = '65th Street Transverse', STEP = 2, GROUP = 4, RISE = 1.2, FACE = 4.9, BACK = 3.0, COPE = 0.3, THICK = 0.5, MAXH = 6.5, WALK = 1.4, FOOT = 0.4;
// vertex colours are bridge.js's marks: g 0.98 = the plain wall stone handoff-9 gave the perimeter wall (no creeper), r 0.98 = the walk's asphalt.
// Hold tv2: the bridge's own stone (b 0.98) drew rust creeper blotches on the faces and a tinted walk drew emerald: face, coping and the strip behind are all the plain wall stone.
const STONE = [1, 0.98, 1], COPING = [1, 0.98, 1], WALKC = [0.98, 1, 1], PLANT = [1, 0.98, 1];

const distLine = (px, py, pts) => { let best = 1e9; for (let k = 0; k + 1 < pts.length; k++) { const ax = pts[k][0], ay = pts[k][1], dx = pts[k + 1][0] - ax, dy = pts[k + 1][1] - ay, l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0, d = Math.hypot(px - ax - dx * u, py - ay - dy * u); if (d < best) best = d; } return best; };

// stations every STEP along a way: { x, y, tx, ty, s }
function stations(pts) {
  const out = []; let s = 0;
  for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const n = Math.max(1, Math.round(L / STEP)), tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
    for (let q = 0; q < n; q++) out.push({ x: a[0] + (b[0] - a[0]) * q / n, y: a[1] + (b[1] - a[1]) * q / n, tx, ty, s: s + L * q / n });
    s += L; if (k + 2 === pts.length) out.push({ x: b[0], y: b[1], tx, ty, s }); }
  // a vertex takes the mean of its two legs' directions, so the wall line does not kink apart at a bend
  for (let k = 1; k + 1 < out.length; k++) { const p = out[k - 1], c = out[k]; if (p.tx !== c.tx || p.ty !== c.ty) { const mx = p.tx + c.tx, my = p.ty + c.ty, l = Math.hypot(mx, my) || 1; c.mx = mx / l; c.my = my / l; } }
  for (const c of out) if (c.mx !== undefined) { c.tx = c.mx; c.ty = c.my; }
  return out;
}

export function buildChunk(game, C, mat) {
  const T = game.terrain, sg = game.statics, gr = T.ground || T.h, CELL = 256, x0 = C.i * CELL, y0 = C.j * CELL;
  const all = (C.data.paths || []).filter((p) => p.kind === 'transverse' && p.pts && p.pts.length > 1), ways = all.filter((p) => p.name === NAME && !p.bridge);
  if (!ways.length) return null;
  const decks = []; for (const s of C.data.structures || []) { if ((s.kind !== 'arch' && s.kind !== 'bridge') || s.over !== 'transverse') continue;
    for (const d of s.decks || []) if (d.pts && d.pts.length > 1) decks.push({ pts: d.pts, hw: (d.w || 3) / 2 + (s.carries === 'drive' || s.carries === 'transverse' ? 0.5 : 0.1) + 0.4 }); }
  const archD = (x, y) => { let best = 1e9; for (const d of decks) { const v = distLine(x, y, d.pts) - d.hw; if (v < best) best = v; } return best; };      // < 0 = under an arch, 0 = on its face
  const sofAt = (x, y) => { let z = 1e9; for (const d of decks) { if (distLine(x, y, d.pts) - d.hw >= 0) continue; let bd = 1e9, bz = 0; for (const p of d.pts) { const q = Math.hypot(p[0] - x, p[1] - y); if (q < bd) { bd = q; bz = p[2] || 0; } } z = Math.min(z, bz - 0.65); } return z; };      // the soffit over a point (bridge.js: the ring is 0.7 under the deck)
  const inRoad = (x, y) => { for (const p of all) if (distLine(x, y, p.pts) < FACE - 0.5) return true; return false; };
  const pos = [], col = [], info = { quads: 0, segs: 0, len: 0 };
  const V = (x, y, z) => [x, z, -y];
  const quad = (a, b, c, d, k) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); col.push(k[0], k[1], k[2]); } info.quads++; };
  const tri = (a, b, c, k) => { for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); col.push(k[0], k[1], k[2]); } };
  const own0 = sg.owner; sg.owner = 'park:' + C.id;
  try {
    for (const w of ways) { const Q = stations(w.pts);
      for (const sd of [1, -1]) {
        // per station: the wall line's point, the bed, the ground behind, whether a wall belongs here
        const A = Q.map((q) => { const nx = -q.ty * sd, ny = q.tx * sd, at = (r) => [q.x + nx * (FACE + r), q.y + ny * (FACE + r)], f = at(0), bed = gr(q.x, q.y);
          let top = -1e9; for (const r of [1, 2, BACK]) { const p = at(r); top = Math.max(top, gr(p[0], p[1])); }
          const p1 = at(1.5), d = archD(f[0], f[1]); top = Math.min(top, bed + MAXH);
          return { q, nx, ny, at, f, bed, top, d, ok: top - bed >= RISE && !inRoad(f[0], f[1]) && !inRoad(p1[0], p1[1]), north: ny > 0 }; });
        // the top in level steps: one height per GROUP metres of the way, the highest ground of the group's standing stations, on a 0.25 m course
        const gTop = new Map(); for (const a of A) { if (!a.ok || a.d < 0) continue; const g = Math.floor(a.q.s / GROUP); gTop.set(g, Math.max(gTop.get(g) ?? -1e9, Math.ceil(a.top / 0.25) * 0.25)); }
        // a point of the wall line between two stations, with everything a piece needs (u = 0 at a, 1 at b)
        const mix = (a, b, u) => { const nx = a.nx + (b.nx - a.nx) * u, ny = a.ny + (b.ny - a.ny) * u, l = Math.hypot(nx, ny) || 1, x = a.q.x + (b.q.x - a.q.x) * u, y = a.q.y + (b.q.y - a.q.y) * u, n = [nx / l, ny / l];
          return { x, y, n, bed: a.bed + (b.bed - a.bed) * u, P: (r, z) => V(x + n[0] * (FACE + r), y + n[1] * (FACE + r), z), g: (r) => gr(x + n[0] * (FACE + r), y + n[1] * (FACE + r)), xy: [x + n[0] * FACE, y + n[1] * FACE] }; };
        const face = (a, b) => { let lo = 0, hi = 1; const dAt = (u) => { const m = mix(a, b, u); return archD(m.xy[0], m.xy[1]); }, inA = a.d < 0; for (let i = 0; i < 14; i++) { const u = (lo + hi) / 2; if ((dAt(u) < -0.04) === inA) lo = u; else hi = u; } return (lo + hi) / 2; };
        let prev = null;      // the last piece built: its group, top and end point (for the step and the open-end returns)
        const endRun = () => { if (prev && !prev.atArch) ret(prev.m, prev.top); prev = null; };
        const ret = (m, top) => { quad(m.P(0, m.bed - FOOT), m.P(BACK + 0.3, m.bed - FOOT), m.P(BACK + 0.3, top), m.P(0, top), STONE); quad(m.P(-0.06, top), m.P(THICK, top), m.P(THICK, top + COPE), m.P(-0.06, top + COPE), COPING); };
        for (let k = 0; k + 1 < A.length; k++) { const a = A[k], b = A[k + 1];
          let ua = 0, ub = 1, archA = false, archB = false;
          if (a.d < 0 && b.d < 0) {      // under an arch's deck: the wall runs on as the abutment, up to the soffit, with no coping (it hides the bank's stretched face in the opening)
            prev = null; const sof = Math.min(sofAt(a.f[0], a.f[1]), sofAt(b.f[0], b.f[1])), m0 = mix(a, b, 0), m1 = mix(a, b, 1), ux = (m0.xy[0] + m1.xy[0]) / 2, uy = (m0.xy[1] + m1.xy[1]) / 2;
            if (sof - Math.max(a.bed, b.bed) < 1 || inRoad(a.f[0], a.f[1]) || inRoad(b.f[0], b.f[1]) || ux < x0 || ux >= x0 + CELL || uy < y0 || uy >= y0 + CELL) continue;
            quad(m0.P(0, m0.bed - FOOT), m1.P(0, m1.bed - FOOT), m1.P(0, sof), m0.P(0, sof), STONE); for (const s of [sg.addSeg(m0.xy[0], m0.xy[1], m1.xy[0], m1.xy[1], sof - m0.bed, 'wall'), sg.addSeg(m1.xy[0], m1.xy[1], m0.xy[0], m0.xy[1], sof - m0.bed, 'wall')]) if (T.lower) T.lower(s);      /* handoff-13: a wall of the level under the deck (terrain.js T.lower): it does not stop who crosses on the deck */ info.segs += 2; continue; }
          if (a.d < 0) { if (!b.ok) { endRun(); continue; } ua = face(a, b); archA = true; } else if (b.d < 0) { if (!a.ok) { endRun(); continue; } ub = face(a, b); archB = true; } else if (!a.ok || !b.ok) { endRun(); continue; }
          const ma = mix(a, b, ua), mb = mix(a, b, ub), cx = (ma.xy[0] + mb.xy[0]) / 2, cy = (ma.xy[1] + mb.xy[1]) / 2;
          if (cx < x0 || cx >= x0 + CELL || cy < y0 || cy >= y0 + CELL) { prev = null; continue; }      // the neighbour chunk builds this piece
          const g = Math.floor(((a.q.s + b.q.s) / 2) / GROUP), top = gTop.get(g) ?? gTop.get(Math.floor(a.q.s / GROUP)) ?? gTop.get(Math.floor(b.q.s / GROUP)) ?? Math.ceil(Math.max(a.top, b.top) / 0.25) * 0.25;
          if (!prev && !archA) ret(ma, top);                                                         // an open end: a return into the bank
          if (prev && prev.top !== top) { const lo = Math.min(prev.top, top), hi = Math.max(prev.top, top);      // a step: the coping's end and the strip's side
            quad(ma.P(-0.06, lo), ma.P(THICK, lo), ma.P(THICK, hi + COPE), ma.P(-0.06, hi + COPE), COPING); tri(ma.P(THICK, lo), ma.P(THICK, hi), ma.P(BACK + 0.3, ma.g(BACK + 0.3) + 0.03), STONE); }
          quad(ma.P(0, ma.bed - FOOT), mb.P(0, mb.bed - FOOT), mb.P(0, top), ma.P(0, top), STONE);                                              // the face
          quad(ma.P(-0.06, top), mb.P(-0.06, top), mb.P(-0.06, top + COPE), ma.P(-0.06, top + COPE), COPING);                                   // the coping: front, top, back
          quad(ma.P(-0.06, top + COPE), mb.P(-0.06, top + COPE), mb.P(THICK, top + COPE), ma.P(THICK, top + COPE), COPING);
          quad(ma.P(THICK, top + COPE), mb.P(THICK, top + COPE), mb.P(THICK, top - 0.05), ma.P(THICK, top - 0.05), COPING);
          quad(ma.P(THICK, top + 0.02), mb.P(THICK, top + 0.02), mb.P(BACK + 0.3, mb.g(BACK + 0.3) + 0.03), ma.P(BACK + 0.3, ma.g(BACK + 0.3) + 0.03), PLANT);      // the planted strip over the bank
          if (a.north) { const za = (m, r) => Math.max(m.bed + 0.17, m.g(r) + 0.05);                                                             // the sidewalk at the north wall's foot
            quad(ma.P(-WALK, za(ma, -WALK)), mb.P(-WALK, za(mb, -WALK)), mb.P(0, za(mb, -0.3)), ma.P(0, za(ma, -0.3)), WALKC); quad(ma.P(-WALK, ma.bed - 0.15), mb.P(-WALK, mb.bed - 0.15), mb.P(-WALK, za(mb, -WALK)), ma.P(-WALK, za(ma, -WALK)), COPING); }
          const h = top + COPE - Math.min(ma.bed, mb.bed); sg.addSeg(ma.xy[0], ma.xy[1], mb.xy[0], mb.xy[1], h, 'wall'); sg.addSeg(mb.xy[0], mb.xy[1], ma.xy[0], ma.xy[1], h, 'wall'); info.segs += 2;
          info.len += Math.hypot(mb.xy[0] - ma.xy[0], mb.xy[1] - ma.xy[1]);
          prev = { top, m: mb, atArch: archB }; if (archB) prev = null;
        }
        endRun();
      } }
  } finally { sg.owner = own0; }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'transverse walls ' + C.id; mesh.userData.info = info; return mesh;
}

export function install(game, park) {
  const Q = game.P || new URLSearchParams(location.search); if (Q.get('parktransverse') === '0' || park.transverse) return park.transverse || null;
  const R = (park.transverse = { chunks: 0, quads: 0, segs: 0, len: 0, err: null });
  // the stone is bridge.js's one material (its night gain with it). It needs the park's shared textures, which only park.js holds: it exists once the
  // first bridge of the park is built (every chunk the transverse crosses has an arch), so a chunk waits a tick for it.
  const stone = () => { try { return material(game, null); } catch (e) { return null; } };
  const tick = () => { if (!park.chunks) return;
    for (const C of park.chunks.values()) { if (C.state !== 2 || !C.nearG || !C.data || C.nearG.userData.transverse) continue;
      const mat = stone(); if (!mat) return;
      C.nearG.userData.transverse = true;
      try { const m = buildChunk(game, C, mat); if (m) { C.nearG.add(m); const i = m.userData.info; R.chunks++; R.quads += i.quads; R.segs += i.segs; R.len += i.len; console.log('[game] park: transverse walls ' + C.id + ' ' + JSON.stringify({ quads: i.quads, segs: i.segs, len: +i.len.toFixed(1) })); } }
      catch (e) { R.err = String(e && e.message); console.log('[game] park: transverse walls not built in ' + C.id + ': ' + R.err); } } };
  R.timer = setInterval(tick, 400); tick(); return R;
}
