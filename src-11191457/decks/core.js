// decks/core.js: the maths of raised roadways ("decks"; data shape in lanes/brooklyn/DECKS.md). No three.js, no game: node can test it.
// Frame: map metres (x east, y north), z = metres above the street. A deck is a ribbon w wide along a centre line pts [[x, y, z], ...].
// The one rule that makes levels work without any body carrying a "which deck am I on" flag: a body at height z is carried by the HIGHEST
// surface under its point that is not more than STEP above it (the street, z 0, is always one of them). So a car at z 0 under a 27 m deck
// stays on the street, a car on that deck stays on it, and a ramp that starts at z 0 is climbed a few centimetres per step.
export const STEP = 0.5;        // the most a body steps up in one go (a kerb is 0.15)
export const CLEAR = 3.2;       // a deck lower than this over the street is solid underneath (the low end of a ramp is an embankment)
export const G = 9.81;

export class Decks {
  constructor(list, cell = 32) {
    this.cell = cell; this.grid = new Map(); this.list = []; this.byId = new Map();
    this.areas = []; this.agrid = new Map();     /* landmarks lane, Nov 18: AREA decks (a row with "poly"): one flat walkable surface, an outline with holes, at height z (the carrier's flight deck). Ribbons are untouched. */
    for (const src of list || []) {
      if (Array.isArray(src.poly) && src.poly.length > 2) { this.addArea(src); continue; }
      const pts = (src.pts || []).map((p) => [+p[0], +p[1], +p[2] || 0]); if (pts.length < 2 || !(src.w > 0)) continue;
      const d = { id: src.id, name: src.name || src.id, kind: src.kind === 'walk' ? 'walk' : 'road', pts, w: +src.w, hw: src.w / 2, lanes: src.lanes || 1, oneway: !!src.oneway,
        rail: [!!(src.rail && src.rail[0]), !!(src.rail && src.rail[1])], join: [(src.join && src.join[0]) ?? null, (src.join && src.join[1]) ?? null], s: [0], segs: [], len: 0 };
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-6) { d.s.push(d.len); d.segs.push(null); continue; }
        d.segs.push({ i, ax: a[0], ay: a[1], tx: dx / L, ty: dy / L, L, s0: d.len, z0: a[2], z1: b[2] }); d.len += L; d.s.push(d.len);
      }
      d.segs = d.segs.filter(Boolean); if (!d.segs.length) continue;
      // an end that meets another deck reaches a little past its last point, so a hair's gap between the two is not a hole; an end in the air or on the street stops dead
      d.ext = [typeof d.join[0] === 'string' && d.join[0] !== 'street' ? 0.6 : 0, typeof d.join[1] === 'string' && d.join[1] !== 'street' ? 0.6 : 0];
      d.zmax = Math.max(...pts.map((p) => p[2]));
      this.list.push(d); this.byId.set(d.id, d);
      const m = d.hw + 3;
      for (const g of d.segs) {
        const bx = g.ax + g.tx * g.L, by = g.ay + g.ty * g.L;
        const i0 = Math.floor((Math.min(g.ax, bx) - m) / cell), i1 = Math.floor((Math.max(g.ax, bx) + m) / cell), j0 = Math.floor((Math.min(g.ay, by) - m) / cell), j1 = Math.floor((Math.max(g.ay, by) + m) / cell);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100003 + j; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); if (a.indexOf(d) < 0) a.push(d); }
      }
    }
    this.hit = null; this._l = { s: 0, off: 0, z: 0, px: 0, py: 0, tx: 1, ty: 0, slope: 0, d: 0, inside: false };
  }
  // an area deck: { id, kind: 'walk', poly: [[x, y], ...], holes: [[[x, y], ...], ...], z }. A body's centre is carried anywhere inside the outline and
  // outside every hole; its circle is kept r inside every edge (rails all round), except where a ribbon carries on at that height (the gangway).
  addArea(src) {
    const loops = [src.poly].concat(src.holes || []).map((Q) => Q.map((p) => [+p[0], +p[1]])), o = loops[0]; let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    for (const p of o) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const A = { id: src.id, name: src.name || src.id, kind: 'walk', area: true, loops, z: +src.z || 0, box: [x0, y0, x1, y1], rail: [true, true], zmax: +src.z || 0 }; this.areas.push(A); this.byId.set(A.id, A);
    const c = this.cell; for (let i = Math.floor((x0 - 3) / c); i <= Math.floor((x1 + 3) / c); i++) for (let j = Math.floor((y0 - 3) / c); j <= Math.floor((y1 + 3) / c); j++) { const k = i * 100003 + j;
      if (!this.grid.get(k)) this.grid.set(k, []); let a = this.agrid.get(k); if (!a) this.agrid.set(k, (a = [])); a.push(A); }
  }
  static inLoop(Q, x, y) { let c = false; for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const a = Q[i], b = Q[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  onArea(A, x, y) { const b = A.box; if (x < b[0] || x > b[2] || y < b[1] || y > b[3] || !Decks.inLoop(A.loops[0], x, y)) return false; for (let i = 1; i < A.loops.length; i++) if (Decks.inLoop(A.loops[i], x, y)) return false; return true; }
  // the decks that may be over or under (x, y): undefined almost everywhere (one map lookup)
  near(x, y) { return this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)); }
  // height of deck d's surface at distance s along it (held flat past either end)
  zAt(d, s) {
    if (s <= 0) return d.pts[0][2]; if (s >= d.len) return d.pts[d.pts.length - 1][2];
    for (const g of d.segs) if (s <= g.s0 + g.L) return g.z0 + (g.z1 - g.z0) * ((s - g.s0) / g.L);
    return d.pts[d.pts.length - 1][2];
  }
  // where (x, y) is against deck d: s along, off = metres LEFT of the centre line (seen along pts), the surface height there, the nearest
  // centre-line point and the direction of travel. inside = within the ribbon's ends (not its sides: test |off| against d.hw for that).
  locate(d, x, y, out = this._l) {
    let best = 1e18, bg = null, bt = 0;
    for (const g of d.segs) { const rx = x - g.ax, ry = y - g.ay, t = Math.max(0, Math.min(g.L, rx * g.tx + ry * g.ty)), ex = rx - g.tx * t, ey = ry - g.ty * t, q = ex * ex + ey * ey; if (q < best) { best = q; bg = g; bt = t; } }
    const g = bg, rx = x - g.ax, ry = y - g.ay, raw = rx * g.tx + ry * g.ty;
    out.s = g.s0 + bt; out.px = g.ax + g.tx * bt; out.py = g.ay + g.ty * bt; out.tx = g.tx; out.ty = g.ty; out.d = Math.sqrt(best);
    out.off = g.tx * ry - g.ty * rx; out.z = g.z0 + (g.z1 - g.z0) * (bt / g.L); out.slope = (g.z1 - g.z0) / g.L;
    const first = g === d.segs[0], last = g === d.segs[d.segs.length - 1];
    out.inside = !((first && raw < -d.ext[0]) || (last && raw > g.L + d.ext[1]));
    if (bt > 0 && bt < g.L) out.d = Math.abs(out.off); else if (out.inside && ((first && raw < 0) || (last && raw > g.L))) out.d = Math.abs(out.off);     // on the short reach past a joined end the side distance counts, not the distance to the end point
    return out;
  }
  // the height that carries a body at (x, y) whose own height is z. kind 'car' cannot use a 'walk' deck. this.hit = the deck (null = the street).
  support(x, y, z, kind) {
    this.hit = null; const a = this.near(x, y); if (!a) return 0; let top = 0; const lim = z + STEP;
    for (const d of a) {
      if (kind === 'car' && d.kind === 'walk') continue;
      const l = this.locate(d, x, y); if (!l.inside || l.d > d.hw) continue;
      if (l.z <= lim && l.z > top) { top = l.z; this.hit = d; }
    }
    if (kind !== 'car' && this.areas.length) { const B = this.agrid.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)); if (B) for (const A of B) if (A.z <= lim && A.z > top && this.onArea(A, x, y)) { top = A.z; this.hit = A; } }
    return top;
  }
  // rails: a circle (x, y, r) of a body riding at height z is kept inside the railed sides of its deck. Fills out like StaticWorld.resolve
  // (x, y pushed; nx, ny the normal of the last contact, pointing back onto the deck) and returns the number of contacts.
  rails(x, y, r, z, out, kind) {
    out.x = x; out.y = y; out.nx = 0; out.ny = 0; out.depth = 0; out.tag = null;
    const a = this.near(x, y); if (!a) return 0; let n = 0;
    for (const d of a) {
      if (kind === 'car' && d.kind === 'walk') continue;
      const l = this.locate(d, out.x, out.y); if (!l.inside || l.d > d.hw + r + 0.3 || Math.abs(l.z - z) > 1) continue;
      const side = l.off > 0 ? 0 : 1; if (!d.rail[side]) continue;
      const over = Math.abs(l.off) - Math.max(0, d.hw - r); if (over <= 0) continue;
      const sg = l.off > 0 ? 1 : -1, nx = sg * l.ty, ny = -sg * l.tx;      // left of travel is (-ty, tx); the way back from the left is (ty, -tx)
      // no rail where another deck carries on at this height (two decks side by side, or one running into the next): the circle's far edge is on it
      const qx = out.x - nx * r, qy = out.y - ny * r, px = out.x, py = out.y; let open = false;
      for (const e of a) { if (e === d || (kind === 'car' && e.kind === 'walk')) continue; const m = this.locate(e, qx, qy, this._m ||= {}); if (m.inside && m.d <= e.hw && Math.abs(m.z - z) <= 1) { open = true; break; } }
      if (open) continue;
      out.x = px + nx * over; out.y = py + ny * over; out.nx = nx; out.ny = ny; out.depth = Math.max(out.depth, over); out.tag = 'rail'; n++;
    }
    if (kind !== 'car' && this.areas.length) { const B = this.agrid.get(Math.floor(out.x / this.cell) * 100003 + Math.floor(out.y / this.cell));
      if (B) for (const A of B) { if (Math.abs(A.z - z) > 1) continue;
        for (let pass = 0; pass < 3; pass++) { if (!this.onArea(A, out.x, out.y)) break;      // off the area (on the gangway, or in the air): nothing to hold
          let best = r, bx = 0, by = 0;      // the nearest edge point within r, over the outline and the holes
          for (const Q of A.loops) for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const p = Q[j], q = Q[i], dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((out.x - p[0]) * dx + (out.y - p[1]) * dy) / l2)), ex = p[0] + dx * t, ey = p[1] + dy * t, dd = Math.hypot(out.x - ex, out.y - ey); if (dd < best) { best = dd; bx = ex; by = ey; } }
          if (best >= r) break; const dd = best || 1e-6, nx = (out.x - bx) / dd, ny = (out.y - by) / dd, qx = bx - nx * 0.3, qy = by - ny * 0.3; let open = false;      // a ribbon carrying on just past the edge at this height: no rail there
          if (a) for (const e of a) { const m = this.locate(e, qx, qy, this._m ||= {}); if (m.inside && m.d <= e.hw && Math.abs(m.z - z) <= 1) { open = true; break; } }
          if (open) break; out.x = bx + nx * r; out.y = by + ny * r; out.nx = nx; out.ny = ny; out.depth = Math.max(out.depth, r - best); out.tag = 'rail'; n++; } } }
    return n;
  }
  // the solid low part of a deck, for a body on the street (height z): where the surface is more than STEP above it and lower than
  // `clear`, the circle is pushed out through the nearer side (or the end, when it met the ribbon end-on). A car is also kept off the
  // whole of a 'walk' deck that is lower than `clear`. Returns contacts; out as resolve (out.x / out.y must hold the circle on entry).
  block(x, y, r, z, clear, out, kind) {
    const a = this.near(x, y); if (!a) return 0; let n = 0;
    for (const d of a) {
      const l = this.locate(d, out.x, out.y); if (!l.inside || l.d >= d.hw + r) continue;
      const walkOnly = kind === 'car' && d.kind === 'walk';
      if (l.z >= clear + z || (!walkOnly && l.z <= z + STEP)) continue;
      const sg = l.off >= 0 ? 1 : -1; let push = d.hw + r - Math.abs(l.off), nx = -sg * l.ty, ny = sg * l.tx;      // out through the side it is nearer...
      // ...unless it came in end-on or lengthwise under the ramp: then back along the deck to where there is head room, or out past the end
      let along = 1e9, dir = 0;
      if (l.slope !== 0 && !(walkOnly && l.z <= z + STEP)) { along = (clear + z - l.z) / Math.abs(l.slope); dir = l.slope > 0 ? 1 : -1; }
      if (l.s + r < along) { along = l.s + r; dir = -1; }
      if (d.len - l.s + r < along) { along = d.len - l.s + r; dir = 1; }
      if (along < push) { push = along; nx = dir * l.tx; ny = dir * l.ty; }
      out.x += nx * push; out.y += ny * push; out.nx = nx; out.ny = ny; out.depth = Math.max(out.depth || 0, push); out.tag = 'deck'; n++;
    }
    return n;
  }
  // one step of a body's height. b = { z, vz, air }; returns the landing speed (m/s, > 0) on the step it comes down, else 0. b.deck = what carries it.
  stepBody(b, x, y, dt, kind) {
    const sup = this.support(x, y, b.z, kind), deck = this.hit;
    if (b.z > sup + 1e-4 && (b.air || b.z - sup > STEP)) {
      b.vz -= G * dt; b.z += b.vz * dt; b.air = true; b.deck = null;
      if (b.z <= sup) { const hitV = -b.vz; b.z = sup; b.vz = 0; b.air = false; b.deck = deck; return Math.max(hitV, 1e-3); }
      return 0;
    }
    b.z = sup; b.vz = 0; b.air = false; b.deck = deck; return 0;
  }
  // a car's two axles on deck d: the heights under the front and rear wheels (x, y its middle, h its heading, wb its wheelbase).
  // Returns [z of the middle, pitch in radians (positive = nose up)].
  axles(d, x, y, h, wb, out = [0, 0]) {
    const l = this.locate(d, x, y), c = Math.cos(h) * l.tx + Math.sin(h) * l.ty, half = wb / 2;
    const zf = this.zAt(d, l.s + c * half), zr = this.zAt(d, l.s - c * half);
    out[0] = (zf + zr) / 2; out[1] = Math.atan2(zf - zr, wb); return out;
  }
}
