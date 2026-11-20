import * as THREE from 'three';      /* park lane, Nov 16: the instanced-mesh lift below */
// park/terrain.js (park lane, Nov 15): the ONE idea of ground height for the game.
//   game.terrain = { h(x, y), n(x, y, out) }   h = metres above the flat street level at map (x, y); 0 everywhere outside Central Park.
// Heights come from the park's data chunks (SCHEMA.md: Int16 cm, 129 x 129 samples every 2 m per 256 m chunk); a chunk whose heights are not
// loaded answers 0. Bridges register DECKS (bridge.js): on a deck the answer is the deck's own profile, not the ground under it.
// The sim stays flat (x, y; z = height above the ground where it stands). hook(game) lifts what is DRAWN: car batches (with pitch and roll from
// the slope), seated drivers, the player on foot, the lead's pedestrians, the chase camera. The crowd reads game.terrain in crowd/render.js.
export const CELL = 256, N = 129, STEP = 2;

export function makeTerrain(outline) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of outline) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const H = new Map(), decks = [], key = (i, j) => i * 4096 + j;
  const T = { box: [x0, y0, x1, y1], chunks: H, decks, base: 0.16 };
  T.inBox = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // point in the park's outline (the whole park; a few hundred edges): used at load time, not per frame
  T.owns = (x, y) => { if (!T.inBox(x, y)) return false; let c = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  T.set = (i, j, cm) => { H.set(key(i, j), cm); }; T.drop = (i, j) => { H.delete(key(i, j)); };
  T.get = (i, j) => H.get(key(i, j));
  // the ground alone (no decks)
  T.ground = (x, y) => { if (x < x0 || x > x1 || y < y0 || y > y1) return 0; const i = Math.floor(x / CELL), j = Math.floor(y / CELL), a = H.get(key(i, j)); if (!a) return 0;
    const u = (x - i * CELL) / STEP, v = (y - j * CELL) / STEP, iu = Math.min(N - 2, u | 0), iv = Math.min(N - 2, v | 0), fu = u - iu, fv = v - iv, o = iv * N + iu;
    return ((a[o] * (1 - fu) + a[o + 1] * fu) * (1 - fv) + (a[o + N] * (1 - fu) + a[o + N + 1] * fu) * fv) * 0.01; };
  // a deck: { pts: [[x, y, h] ...] (the way's line with the deck's height in the relief frame), hw (half width) }. On its corridor the answer is the
  // deck where that is higher than the ground (the data's height grid holds the LOWER way under a bridge or arch).
  T.addDeck = (d) => { let a = 1e9, b = 1e9, c = -1e9, e = -1e9; for (const p of d.pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); e = Math.max(e, p[1]); } d.bb = [a - d.hw, b - d.hw, c + d.hw, e + d.hw]; decks.push(d);
    if (d.dn) { d.lv = 1; d.zm = 1e9; for (const p of d.pts) d.zm = Math.min(d.zm, p[2]); for (let i = pend.length - 1; i >= 0; i--) { const s = pend[i], mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; if (mx >= d.bb[0] && my >= d.bb[1] && mx <= d.bb[2] && my <= d.bb[3]) { d.dn.push(s); pend.splice(i, 1); } } for (const s of d.dn) park(s); } return d; };
  // TWO LEVELS (handoff-13, ?parkunder=0 = off): a deck may carry d.up (the collision segments of its own level: the parapets) and d.dn (those of the
  // level under it: the faces beside the opening, the opening's jambs, a wall that runs on under it). One set stands at a time: T.level(d, 1) = the
  // deck's level (as before), T.level(d, -1) = the level under it. A segment that is off is parked far away (its cells keep it; s.o = its real ends).
  const pend = [], park = (s) => { if (!s.o) { s.o = [s[0], s[1], s[2], s[3]]; s[0] = s[1] = s[2] = s[3] = 1e7; } }, unpark = (s) => { if (s.o) { s[0] = s.o[0]; s[1] = s.o[1]; s[2] = s.o[2]; s[3] = s.o[3]; s.o = null; } };
  T.level = (d, lv) => { if (!d.dn || d.lv === lv) return; d.lv = lv; if (d.up) for (const s of d.up) (lv > 0 ? unpark : park)(s); for (const s of d.dn) (lv > 0 ? park : unpark)(s); };
  // a segment of the lower level made by someone else (transverse.js: the wall under an arch): it joins the deck over its middle, now or when that deck comes
  T.lower = (s) => { const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; for (const d of decks) if (d.dn && mx >= d.bb[0] && my >= d.bb[1] && mx <= d.bb[2] && my <= d.bb[3]) { d.dn.push(s); if (d.lv > 0) park(s); return; } pend.push(s); if (pend.length > 400) pend.shift(); };
  T.removeDeck = (d) => { T.level(d, 1); const k = decks.indexOf(d); if (k >= 0) decks.splice(k, 1); };
  const deckAt = (x, y) => { let best = null, bo = 1e9; for (let q = 0; q < decks.length; q++) { const d = decks[q], bb = d.bb; if (x < bb[0] || y < bb[1] || x > bb[2] || y > bb[3]) continue; const P = d.pts;
      for (let k = 0; k + 1 < P.length; k++) { const ax = P[k][0], ay = P[k][1], dx = P[k + 1][0] - ax, dy = P[k + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))), o = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (o <= d.hw && o < bo) { bo = o; best = P[k][2] + (P[k + 1][2] - P[k][2]) * t; } } } return best; };
  // zp (handoff-13, optional): the height the asker stood at a moment ago. Where a deck stands 1.9 m or more over the ground, an asker who was nearer
  // the ground than the deck stays on the ground under it; one who came along the deck stays on the deck. No zp: the deck, as before.
  T.h = (x, y, zp) => { if (x < x0 || x > x1 || y < y0 || y > y1) return 0; const g = T.ground(x, y); if (decks.length) { const z = deckAt(x, y); if (z !== null && z > g) return zp !== undefined && z - g >= 1.9 && zp < (z + g) * 0.5 ? g : z; } return g; };
  T.deckZ = deckAt;
  // unit normal in MAP axes (east, north, up)
  T.n = (x, y, out = {}) => { const e = 1, gx = (T.h(x + e, y) - T.h(x - e, y)) / (2 * e), gy = (T.h(x, y + e) - T.h(x, y - e)) / (2 * e), l = Math.hypot(gx, gy, 1); out.x = -gx / l; out.y = -gy / l; out.z = 1 / l; return out; };
  return T;
}

// lift what is drawn. Every wrapper leaves the call exactly as it was outside the park's box.
export function hook(game) {
  const T = game.terrain, g = game; if (!T || T.hooked) return; T.hooked = true;
  // handoff-13, two levels: the ONE mover whose height is remembered here is the player (on foot or his vehicle): PM.z = the height he stands at, kept
  // from step to step (a jump of 6 m or more forgets it). Everything drawn within PM.r of him (his figure, his car or motorbike, the rider, the camera's
  // target) asks T.h with that height; the game's other people keep their own last lift (lift(), below); everything else asks as before.
  const UNDER = !(g.P && g.P.get('parkunder') === '0'), PM = { x: 1e9, y: 1e9, z: 0, ok: false, r: 1.5 };
  const pz = () => { if (!UNDER) return undefined; const pl = g.player, b = pl && (pl.vehicle || pl); if (!b || !T.inBox(b.x, b.y)) { PM.ok = false; return undefined; }
    if (!(PM.ok && b.x === PM.x && b.y === PM.y)) { PM.z = T.h(b.x, b.y, PM.ok && Math.abs(b.x - PM.x) < 6 && Math.abs(b.y - PM.y) < 6 ? PM.z : undefined); PM.x = b.x; PM.y = b.y; PM.ok = true; PM.r = pl.vehicle ? ((pl.vehicle.def && pl.vehicle.def.len) || 4.5) * 0.5 + 1.6 : 1.5; } return PM.z; };
  const zn = (x, y) => (PM.ok && Math.abs(x - PM.x) < PM.r && Math.abs(y - PM.y) < PM.r ? PM.z : undefined);
  T.playerZ = pz;
  // the walls of the two levels: a query that belongs to the player (within his body's reach) while he stands 1.5 m or more under a deck's lowest point
  // meets the lower level's segments near that deck, not its parapets; every other query meets the parapets, as before.
  if (UNDER && g.statics && g.statics.resolve) { const sg = g.statics, r0 = sg.resolve; sg.resolve = function (x, y, r, out, sk, pe) {
    if (T.decks.length && T.inBox(x, y)) { const pl = g.player, b = pl && (pl.vehicle || pl); let z; if (b) { const R = pl.vehicle ? ((pl.vehicle.def && pl.vehicle.def.len) || 4.5) * 0.5 + 1.6 : 1.5; if (Math.abs(x - b.x) < R && Math.abs(y - b.y) < R) z = pz(); }
      for (let q = 0; q < T.decks.length; q++) { const d = T.decks[q], bb = d.bb; if (!d.dn || x < bb[0] - 8 || y < bb[1] - 8 || x > bb[2] + 8 || y > bb[3] + 8) continue; T.level(d, z !== undefined && d.zm - z > 1.5 ? -1 : 1); } }
    return r0.call(this, x, y, r, out, sk, pe); }; }
  const slope = (x, y, h, len, wid, out) => { const c = Math.cos(h), s = Math.sin(h), a = len * 0.36, b = wid * 0.4, zp = zn(x, y);
    const f = T.h(x + c * a, y + s * a, zp), r = T.h(x - c * a, y - s * a, zp), R = T.h(x + s * b, y - c * b, zp), L = T.h(x - s * b, y + c * b, zp);
    out.z = (f + r + R + L) * 0.25; out.pitch = Math.atan2(f - r, 2 * a); out.roll = Math.atan2(L - R, 2 * b); return out; };
  const _s = {};
  // 1. cars: every batch's add(x, y, z, h, roll, pitch, ...)
  const wrapAll = () => { for (const k in g.batches) { const B = g.batches[k]; if (!B || B.__park) continue; B.__park = true; const add0 = B.add.bind(B), len = (B.def && B.def.len) || 4.5, wid = (B.def && B.def.wid) || 1.8;
    B.add = function (x, y, z, h, roll, pitch, ...rest) { if (T.inBox(x, y)) { slope(x, y, h, len, wid, _s); const own = T.owns(x, y); if (own || _s.z !== 0 || _s.pitch !== 0 || _s.roll !== 0) return add0(x, y, (own ? Math.max(z || 0, T.base) : (z || 0)) + _s.z, h, (roll || 0) + _s.roll, (pitch || 0) + _s.pitch, ...rest); }      /* in the park a car stands on the park's ground, drawn T.base above the roadway */ return add0(x, y, z, h, roll, pitch, ...rest); }; }
  // 2. drivers seen through the glass of traffic cars: add(x, y, z, h)
  for (const d of g.drivers || []) { if (d.__park) continue; d.__park = true; const add0 = d.add.bind(d); d.add = (x, y, z, h) => add0(x, y, T.inBox(x, y) ? z + T.h(x, y) : z, h); } };
  // merge lane, batch 6: the same lift for the streets layer's car drawing (streets/vehicles_next.js draw(): it replaces game.batches with a stub, so wrapAll() above finds nothing to wrap
  // in the ordinary game and every car in the park was drawn at street level over or under the park's ground). ?parkcars=0: off, the hand-over as it came.
  const _c = {}; if (!(g.P && g.P.get('parkcars') === '0')) T.car = (x, y, h, len, wid, z) => { slope(x, y, h, len || 4.5, wid || 1.8, _c); _c.z = (T.owns(x, y) ? Math.max(z || 0, T.base) : (z || 0)) + _c.z; return _c; };
  if (!(g.P && g.P.get('parkcam') === '0')) T.camFloor = (x, y) => (T.inBox(x, y) ? T.h(x, y) : 0);      /* merge lane, batch 6: read by the guns' own camera (combat/combat.js placeCamera), which the wrappers below never see while a gun is in the hand */
  wrapAll();      /* and again before every sync: batches made or replaced after the park started (a car type loaded later) are wrapped too */
  // 3. the chase camera: its target rides the ground, and the camera itself never goes under it
  const ct0 = g.camTarget.bind(g); g.camTarget = function () { const t = ct0(); if (T.inBox(t.x, t.y)) t.z += T.h(t.x, t.y, zn(t.x, t.y)); return t; };
  // (handoff-13: while the player is under a deck the camera's floor is the ground under it too, and the camera stays under the deck's soffit)
  const pc0 = g.placeCamera.bind(g); g.placeCamera = function (dt) { pc0(dt); const p = g.world.camera.position; if (T.inBox(p.x, -p.z)) { const zp = PM.ok ? PM.z : undefined, f = T.h(p.x, -p.z, zp) + 0.4; if (p.y < f) p.y = f;
    if (zp !== undefined) { const dz = T.deckZ(p.x, -p.z); if (dz !== null && f < dz && p.y > dz - 1.0) p.y = Math.max(f, dz - 1.0); } } };
  // 4. things drawn as objects set afresh each frame (the player, the lead's pedestrians): lifted after the game has placed them.
  // The object remembers what was added, so a frame in which nobody re-placed it is not lifted twice.
  const lift = (o, x, y, tilt) => { if (!o) return; const u = o.userData, base = (u.__py !== undefined && o.position.y === u.__py) ? u.__py - u.__ph : o.position.y, zq = zn(x, y), h = T.inBox(x, y) ? T.h(x, y, zq !== undefined ? zq : (UNDER && u.__ph !== undefined && Math.abs(x - u.__lx) < 3 && Math.abs(y - u.__ly) < 3 ? u.__ph : undefined)) : 0; o.position.y = base + h; u.__py = o.position.y; u.__ph = h; u.__lx = x; u.__ly = y; };
  // 5. (Nov 16) things drawn as instanced meshes with a matrix per instance: the motorbike (g.moto.model: body, fork, wheels, stand), the riders on
  // traffic motorbikes ('moto_rider') and the delivery riders and their bikes ('rider'). Their setMatrixAt is wrapped: the matrix's height takes the
  // ground under it. No pitch from the slope. Meshes made later are picked up by the scan (every 120 syncs).
  const _m = new THREE.Matrix4(), liftIM = (im) => { if (!im || im.__park || !im.setMatrixAt) return; im.__park = true; const set0 = im.setMatrixAt.bind(im);
    im.setMatrixAt = (i, m) => { const e = m.elements, x = e[12], y = -e[14]; if (T.inBox(x, y)) { const h = T.h(x, y, zn(x, y)); if (h !== 0) { _m.copy(m); _m.elements[13] += h; return set0(i, _m); } } return set0(i, m); }; };
  let scanN = 0; const scanIM = () => { if (scanN++ % 120) return; const D = g.moto && g.moto.model; if (D) for (const k of ['body', 'fork', 'wheel', 'stand']) liftIM(D[k]); for (const o of g.world.scene.children) if (o.isInstancedMesh && (o.name === 'rider' || o.name === 'moto_rider')) liftIM(o); };
  const liftPlayer = () => { const pl = g.player; if (pl && pl.vis && pl.vis.object) { const v = pl.vehicle; if (v) { if (T.inBox(v.x, v.y) || pl.vis.object.userData.__ph) { const o = pl.vis.object; lift(o, o.position.x, -o.position.z); } } else lift(pl.vis.object, pl.x, pl.y); } };
  // (Nov 16) and once more as the frame is drawn: the motorbike places its rider in a sync hook of its own that runs after this one, so the rider sat
  // at street level over a bike that stood on the park's ground (pod still p2). lift() remembers what it added, so the second call adds nothing twice.
  { const w = g.world, r0 = w.render.bind(w); w.render = function (t, focus) { try { liftPlayer(); } catch (e) {} return r0(t, focus); }; }
  const sv0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) { wrapAll(); pz(); try { scanIM(); } catch (e) {} sv0(dt); const pl = g.player;
    liftPlayer();
    const L = g.peds && g.peds.list; if (L) for (let i = 0; i < L.length; i++) { const p = L[i]; if (p.vis && p.vis.object && (T.inBox(p.x, p.y) || p.vis.object.userData.__ph)) lift(p.vis.object, p.x, p.y); } };
}
