// crowd/queues.js: LINES OF PEOPLE (people/queues, Nov 15). New Yorkers waiting in line: at a food cart's window, at a bus stop.
// One call after the crowd is built (crowd.js, last line of its try block):   out.queues = addQueues(game, out);
// Nothing of sim.js is edited: a person in a line is one of the crowd's own people in its 'stand' state (as a plaza stander is), whose
// place to stand (tx, ty, th) this file moves. So the crowd's body rule, its reactions to the player's car and to shots (combat/scare.js)
// and its drawing all apply as they are; someone who runs, falls or walks off is simply no longer in the line.
//
// THE HOOK (agreed with streets, INBOX Nov 15): game.queues = [ row, ... ], read again every second, rows may be pushed at any time.
//   row = { id, name, x, y, face, pts, n, gap, keep, leave, kind, serve, dir }       map metres, y north as everywhere in the game
//     x, y    where the person being served stands (at the cart's window)        face   the map heading that person faces
//     pts     [[x,y],...] the line the queue runs back along, from x,y (optional; too short or absent: this file carries on along the
//             kerb side of the same sidewalk and round the block corner, never over a roadway)
//     n       how many people the line wants at its busiest: a number, [min,max], or 'short' | 'medium' | 'long'
//     gap     how loose the line stands: 0.6 = a New York line, people 0.4-0.75 m apart, friends nearer (each has their own); 1.2 = twice that
//     keep    [[s0,s1],...] stretches (metres along the line from the head) to leave empty: a doorway
//     leave   [x,y] the way the served person walks off (default: on along the sidewalk, away from the line, sometimes back past it)
//     kind    'serve' (default: the head is served, then the line moves up) | 'wait' (a bus stop: nobody is served, people give up one by one)
//     serve   [min,max] seconds at the window (default 30-60; lines of 20 and more 18-36: two men serving)
//     dir     [dx,dy] which way the line runs when there is no pts (default: the longer run of sidewalk)
//   game.crowd.queues.add(row) does the push; .report() says what stands where; .path(id) the line's own points.
// Switches:  ?queues=0  none of this (the game as before)     ?queueown=0  only game.queues rows (no bus stops / carts of our own)
//            ?queuestand=1  a stand-in long line on 6th Avenue at W 49th (for looking at, before the streets lane's cart is in)
//            ?queuen=K  every line's size times K        ?queueknot=0  nobody waits aside at the window        ?queuecut=0  no way through left in a long line
import { staticPathBlocked } from '../geo.js';
import { bandAt, furnitureCrossing } from './nav.js';

const STEP = 0.25, R_ON = 190, R_OFF = 222, B = { lo: 0, hi: 0 };
const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
const SIZE = { short: [3, 5], medium: [8, 12], long: [26, 36] };

export function addQueues(game, crowd) {
  const P = game.P, off = P && P.get && P.get('queues') === '0', sim = crowd.sim, nav = crowd.nav, st = game.statics;
  const Q = { on: !off, list: [], kn: { made: 0, joined: 0, served: 0, left: 0, scared: 0 } };
  if (!game.queues) game.queues = [];
  Q.add = (row) => { game.queues.push(row); return row; };
  if (off || !sim || !nav) return Q;
  const rand = sim.rand, K = P && P.get && +P.get('queuen') > 0 ? +P.get('queuen') : 1;
  const hour = () => { const N = game.night; return N && isFinite(N.tod) ? N.tod : 13; };
  // how busy by the hour: a halal cart at lunch and late at night, a bus stop at the rush hours
  const busy = (kind, h) => kind === 'wait' ? (h >= 7 && h < 10) || (h >= 16 && h < 19.5) ? 1 : h >= 23 || h < 5.5 ? 0.3 : 0.65
    : (h >= 11.5 && h < 14.5) || h >= 21.5 || h < 3 ? 1 : h >= 17 && h < 21.5 ? 0.75 : h >= 5 && h < 10 ? 0.25 : 0.5;

  // ------------------------------------------------------------------ where a line can stand
  // the crossing mouths (where people wait for the light and step off the kerb): a line leaves them open
  const mouths = (x, y) => { const out = []; for (const w of nav.near(x, y, 70, [])) if (w.kind === 'cross') out.push(w); return out; };
  const inMouth = (M, x, y) => { for (const w of M) { const dx = x - w.ax, dy = y - w.ay, s = dx * w.ux + dy * w.uy, l = dx * w.nx + dy * w.ny; if (Math.abs(l) < 2.5 && ((s > -3.4 && s < 0.6) || (s > w.len - 0.6 && s < w.len + 3.4))) return true; } return false; };
  const wayAt = (x, y, R = 12) => { let best = null, bd = 1e9; for (const w of nav.near(x, y, R, [])) { if (w.kind === 'cross') continue; const dx = x - w.ax, dy = y - w.ay, s = dx * w.ux + dy * w.uy, l = dx * w.nx + dy * w.ny, sc = Math.max(0, Math.min(w.len, s));
    const d = Math.abs(s - sc) + (l < -0.3 ? -0.3 - l : l > 13 ? l - 13 : 0) + (w.kind === 'strip' ? 0 : 0.5); if (d < bd) { bd = d; best = w; } } return bd < R ? best : null; };
  const lineL = (w, s) => { bandAt(w, Math.max(0, Math.min(w.len, s)), B); return B.hi > 0 ? Math.min(B.lo + 0.3, B.hi - 0.2) : 1.9; };
  const nearbyFurniture = [];
  const free = (x, y, fromX = x, fromY = y) => st.onSidewalk(x, y) && sim.freeAt(x, y, fromX, fromY) &&
    !furnitureCrossing(nav, nearbyFurniture, fromX, fromY, x, y) && !nav.blocked(x, y, 0.3) && !(st.resolve(x, y, 0.28, {}) > 0);
  // CrowdSim.freeAt checks fence crossings in the destination cell and its 1.3 m margin.
  const clearMove = (a, x, y) => free(x, y, a.x, a.y) &&
    ((Math.abs(a.x - x) <= 1.3 && Math.abs(a.y - y) <= 1.3) || st.raycast(a.x, a.y, x, y) >= 1) &&
    ((a.x === x && a.y === y) || !staticPathBlocked(st, a.x, a.y, x, y, true)) &&
    (!(game.traffic || game.vehicles || game.parked) || !sim.vehicleAt(x, y, a.x, a.y, undefined, true));
  // the points of a line: the row's own pts, then along the kerb side of the sidewalk, way after way round the block (no crossing is taken)
  function buildPath(row, need) {
    const raw = [[row.x, row.y]]; if (row.pts) for (const p of row.pts) { const q = raw[raw.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) raw.push([p[0], p[1]]); }
    let have = 0; for (let i = 1; i < raw.length; i++) have += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
    if (have < need) {
      const e = raw[raw.length - 1]; let w = wayAt(e[0], e[1]);
      if (w) {
        let hx = 0, hy = 0; if (raw.length > 1) { const p = raw[raw.length - 2]; hx = e[0] - p[0]; hy = e[1] - p[1]; } else if (row.dir) { hx = row.dir[0]; hy = row.dir[1]; }
        const s0 = (e[0] - w.ax) * w.ux + (e[1] - w.ay) * w.uy; let d = hx * w.ux + hy * w.uy; d = Math.abs(d) > 1e-3 ? Math.sign(d) : s0 < w.len / 2 ? 1 : -1;
        let l = Math.max(0.4, (e[0] - w.ax) * w.nx + (e[1] - w.ay) * w.ny), s = Math.max(0, Math.min(w.len, s0)), prev = null, l0 = l; const seen = new Set(), M = mouths(row.x, row.y);
        for (let guard = 0; guard < 12 && have < need + 6 && w; guard++) {
          seen.add(w); const seg = [];
          // round a block corner the two runs overlap (each is measured from its own kerb): the end of the first that lies kerb-side of the second goes
          if (prev && Math.abs(prev.w.ux * w.ux + prev.w.uy * w.uy) < 0.8) { while (raw.length > prev.from + 1 && ((raw[raw.length - 1][0] - w.ax) * w.nx + (raw[raw.length - 1][1] - w.ay) * w.ny) < l0 - 0.05) raw.pop(); }
          if (prev) { const q = raw[raw.length - 1]; s = Math.max(0, Math.min(w.len, (q[0] - w.ax) * w.ux + (q[1] - w.ay) * w.uy)); l = Math.max(0.4, (q[0] - w.ax) * w.nx + (q[1] - w.ay) * w.ny); }
          for (;;) { s += d * STEP; if (s < 0 || s > w.len) break; let lt = lineL(w, s); const deep = Math.max(lt, Math.min(B.hi - 0.5, 4.2));
            for (const look of [0, 2.5, 5]) { const ss = s + d * look, mx = w.ax + w.ux * ss + w.nx * lt, my = w.ay + w.uy * ss + w.ny * lt; if (inMouth(M, mx, my)) { lt = deep; break; } }
            l += Math.max(-0.11, Math.min(0.11, lt - l)); seg.push([w.ax + w.ux * s + w.nx * l, w.ay + w.uy * s + w.ny * l]); }
          const from = raw.length; for (const p of seg) { const q = raw[raw.length - 1]; have += Math.hypot(p[0] - q[0], p[1] - q[1]); raw.push(p); }
          const v = d > 0 ? w.b : w.a; let nx = null, ns = -9; for (const c of v.inc) { if (c.w === w || c.w.kind === 'cross' || seen.has(c.w)) continue; const d2 = c.end === 0 ? 1 : -1, sc = (c.w.ux * d2) * (w.ux * d) + (c.w.uy * d2) * (w.uy * d) + 0.6 * ((c.w.ux * d2) * w.nx + (c.w.uy * d2) * w.ny); if (sc > ns) { ns = sc; nx = c; } }
          // (the two stubs of a block corner end at the corner without sharing a vertex)
          if (!nx) { let bd = 1.8; for (const o of nav.near(v.x, v.y, 6, [])) { if (o === w || o.kind === 'cross' || seen.has(o)) continue; for (const end of [0, 1]) { const vv = end ? o.b : o.a, dd = Math.hypot(vv.x - v.x, vv.y - v.y); if (dd < bd) { bd = dd; nx = { w: o, end }; } } } }
          prev = { w, from }; l0 = l; if (!nx) break; w = nx.w; d = nx.end === 0 ? 1 : -1;
        }
      }
    }
    // even steps along it, corners rounded (the first metre stays as given: the window)
    const pts = [raw[0]]; { let acc = 0; for (let i = 1; i < raw.length; i++) { const a = raw[i - 1], b = raw[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; let t = STEP - acc; while (t <= L) { pts.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += STEP; } acc = (acc + L) % STEP; } }
    for (let pass = 0; pass < 2; pass++) { const c = pts.map((p) => [p[0], p[1]]); for (let i = 4; i < pts.length - 1; i++) { let x = 0, y = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(pts.length - 1, i + 3); k++) { x += c[k][0]; y += c[k][1]; n++; } pts[i][0] = x / n; pts[i][1] = y / n; } }
    const n = pts.length, ok = new Uint8Array(n), M = mouths(row.x, row.y).concat(mouths(pts[n - 1][0], pts[n - 1][1])), bad = new Uint8Array(n);
    for (let i = 0; i < n; i++) bad[i] = i > 2 && (!free(pts[i][0], pts[i][1]) || inMouth(M, pts[i][0], pts[i][1])) ? 1 : 0;
    if (row.keep) for (const k of row.keep) for (let i = Math.max(3, Math.floor(k[0] / STEP)); i <= Math.min(n - 1, Math.ceil(k[1] / STEP)); i++) bad[i] = 1;
    for (let i = 0; i < n; i++) ok[i] = !(bad[i] || (i > 3 && bad[i - 1]) || (i + 1 < n && bad[i + 1])) ? 1 : 0;
    // it ends where the way on is shut for good (14 m and more of it: a crossing mouth on a narrow walk is jumped)
    let end = n; for (let i = 0, run = 0; i < n; i++) { run = ok[i] ? 0 : run + 1; if (run * STEP >= 14) { end = i - run + 1; break; } }
    return { pts, ok, n: end, len: (end - 1) * STEP };
  }
  const at = (q, s, o) => { const p = q.path.pts, f = Math.max(0, Math.min(q.path.n - 1.001, s / STEP)), i = Math.floor(f), t = f - i, a = p[i], b = p[Math.min(q.path.n - 1, i + 1)], j = Math.min(q.path.n - 1, i + 3), k = Math.max(0, i - 1);
    o.x = a[0] + (b[0] - a[0]) * t; o.y = a[1] + (b[1] - a[1]) * t; o.h = Math.atan2(p[k][1] - p[j][1], p[k][0] - p[j][0]); return o; };      // h: towards the head
  // the next free place at or after s
  const place = (q, s) => { const ok = q.path.ok, n = q.path.n, f = Math.floor(s / STEP + 1e-6); if (f + 1 < n && ok[f] && ok[f + 1]) return s; let i = Math.ceil(s / STEP - 1e-6); while (i < n && !ok[i]) i++; return i < n ? Math.max(s, i * STEP) : -1; };

  // ------------------------------------------------------------------ people
  // What makes it read as a line (the blind judge of people/out/round-2, pair h6, did not read v1 as one): one file, 0.4-0.75 m apart (friends
  // nearer), nearly everybody turned to the head; friends side by side or one turned round to the next; phones; nobody in a walking stride
  // for a half-metre move up (shuffle below); a knot at the window (one ordering, one or two aside waiting for their food).
  const _p = { x: 0, y: 0, h: 0 }, _p2 = { x: 0, y: 0, h: 0 }, PI = Math.PI, pm = () => (rand() < 0.5 ? 1 : -1);
  const KNOT = !(P && P.get && P.get('queueknot') === '0'), CUT = !(P && P.get && P.get('queuecut') === '0');
  const each = (m) => (m.b ? [m.a, m.b] : [m.a]);
  function dress(q, m) {      // what they do while they wait: a phone for half of them, a coffee, hands down, weight on one leg
    const a = m.a; m.arm = false;
    if (m.b) { sim.hold(a, null); sim.hold(m.b, !a.talk && rand() < 0.45 ? 'phone' : null); return; }
    if (m.back || m.chat) { sim.hold(a, null); const c = m.back ? sim.talkA : sim.talkB; if (c) a.idle = c; return; }
    const u = rand(), ph = q.kind === 'wait' ? 0.4 : 0.6; sim.hold(a, u < ph ? 'phone' : u < ph + 0.06 ? 'coffee' : null); m.arm = u < ph + 0.06; if (!m.arm && sim.waitClip && rand() < 0.4) a.idle = sim.waitClip;
  }
  // A place given to a body. Far from it, the crowd's own walk takes them there (its stand state walks to tx, ty). The last 0.24 m, and every
  // move of under 0.85 m (moving up one place, leaning out), is a shuffle done in slide(): the body is moved slowly in its standing pose, and
  // tx, ty are kept on the body so the crowd's walk (a full stride) does not start.   a.qm: 0 there, 1 shuffling, 2 walking up
  function put(a, x, y, th, snap) {
    a.qx = x; a.qy = y; a.th = th;
    if (snap && joinLeg(a, x, y)) { a.x = a.tx = x; a.y = a.ty = y; a.h = th; a.qm = 0; return; }
    const d = Math.hypot(x - a.x, y - a.y);
    if (a.qm === 2 || d > 0.85) { if (a.qm !== 2) a.t = 0; a.qm = 2; a.tx = x; a.ty = y; } else if (d > 0.012) a.qm = 1;
  }
  function slide(a, dt) {
    if (!a.qm || a.state !== 'stand' || a.fear) return; const dx = a.qx - a.x, dy = a.qy - a.y, d = Math.hypot(dx, dy);
    if (a.qm === 2) { if (d < 0.24) { a.qm = 1; a.tx = a.x; a.ty = a.y; } return; }
    if (d < 0.012) { a.qm = 0; a.tx = a.x; a.ty = a.y; return; }
    if (d > 1.1) { a.qm = 2; a.tx = a.qx; a.ty = a.qy; a.t = 0; return; }      /* shoved off their place (a car's bumper): walk back */
    const k = Math.min(1, Math.min(0.45, 0.1 + d * 1.2) * dt / d); const x = a.x + dx * k, y = a.y + dy * k;
    a.shuffleBlocked = !clearMove(a, x, y);
    if (!a.shuffleBlocked) { a.x = x; a.y = y; }
    a.tx = a.x; a.ty = a.y;
  }
  function target(q, m, snap, spawning = false) {      // put m's place to stand (and its friend's) at its distance m.s along the line
    const a = m.a, b = m.b, kerb = q.kind === 'wait', head = !kerb && m === q.mem[0] && m.s < 0.3 && isFinite(q.row.face);
    at(q, m.s, _p); const h = _p.h, fx = Math.cos(h), fy = Math.sin(h), nx = -fy, ny = fx, lat = m.lat + m.lean, px = _p.x, py = _p.y;
    let x = px + nx * lat, y = py + ny * lat, th = kerb ? h + m.face * 2 + m.look + m.turn : h + m.face + m.look + (m.back ? PI : 0) - m.lean * 0.5;
    if (head) { x = px; y = py; th = q.row.face + m.look * 0.15; }
    // The slot center can be clear while the standing offset reaches a post.
    if (snap && (x !== px || y !== py) && !free(x, y) && free(px, py)) { x = px; y = py; }
    if (m.via) { put(a, m.via[0], m.via[1], th, false); if (b) put(b, m.viaB[0], m.viaB[1], th, false); return; }
    if (b) { let bx = 0, by = 0, bth = h, ok = false; m.deep = 0;
      const fitsCompanion = (bx, by) => joinLeg(b, bx, by);
      if (head) { const c = Math.cos(q.row.face), s = Math.sin(q.row.face); for (const [u, v] of [[0.55, 0], [0.3, 0.5], [-0.3, 0.55]]) { bx = x + fx * u - c * v; by = y + fy * u - s * v; if (fitsCompanion(bx, by)) { ok = true; break; } } bth = Math.atan2(y + s * 0.8 - by, x + c * 0.8 - bx); }
      else for (const sd of [m.sd, -m.sd]) { bx = x + nx * 0.5 * sd + fx * m.stag; by = y + ny * 0.5 * sd + fy * m.stag; if (fitsCompanion(bx, by)) { ok = true; th = h + sd * m.pair + m.look * 0.3; bth = h - sd * m.pair; break; } }
      if (!ok) { bx = x - fx * 0.46; by = y - fy * 0.46; bth = h + 0.1; if (!head) th = h + PI - 0.25; m.deep = 0.46; }      /* no room beside: one behind the other, the front one turned round */
      if (!ok && !fitsCompanion(bx, by)) {
        m.deep = 0;
        if (spawning) {
          sim.remove(b); m.b = null; a.fol = null; a.talk = null;
          dress(q, m);
        } else {
          b.qx = b.tx = b.x; b.qy = b.ty = b.y; b.qm = 0;
          m.retryCompanionAt = game.t + 1;
        }
      } else { m.retryCompanionAt = 0; put(b, bx, by, bth, snap); } }
    put(a, x, y, th, snap);
  }
  const member = (q, a, b) => { const k = ((q.row.gap || 0.6) / 0.6) * (q.kind === 'wait' ? 1.5 : 1), r = rand(), last = q.mem[q.mem.length - 1];
    const m = { a, b: b || null, s: 1e9, gap: 0.5, g0: (0.38 + rand() * rand() * 0.3 + (b ? 0.08 : 0)) * k, arm: false, lat: (rand() - 0.5) * 0.2, lean: 0, leanT: 0, face: (rand() + rand() - 1) * 0.2, look: 0, turn: pm() * (0.6 + rand() * 0.9) * (rand() < 0.55 ? 1 : 0), sd: pm(), pair: 0.3 + rand() * 0.45, stag: (rand() - 0.5) * 0.2, back: false, chat: false, heard: false, deep: 0, via: null, slow: r < 0.25 ? 0.6 + rand() * 1.2 : 0.05 + rand() * 0.3, at: 0, walkT: 0, out: q.kind === 'wait' ? 50 + rand() * 260 : 0, habit: 8 + rand() * 40 };
    // friends one behind the other: the front one turned round to the next (who then stands a talking distance off)
    if (q.kind !== 'wait') { if (last && last.back && !last.heard) { last.heard = true; m.g0 = 0.58 * k; if (!b) m.chat = true; } else if (!b && rand() < 0.13) m.back = true; }
    a.inLine = q.id; a.qm = 0; if (b) { b.inLine = q.id; b.qm = 0; } dress(q, m); m.gap = m.g0 + (m.arm ? 0.08 : 0); return m; };
  const still = (a, x, y) => { if (a.w) { const j = a.w.agents.indexOf(a); if (j >= 0) a.w.agents.splice(j, 1); } if (a.home) { a.home.pop--; a.home = null; } a.w = null; a.path = null; a.door = 0; if (a.state !== 'stand') sim.nStand++; a.state = 'stand'; a.standT = 1e9; a.t = 0; a.lost = false; a.talk = null; a.onRoad = false; a.carT = 0; };
  function spawn(q, s) {      // someone already standing in the line (only where the camera cannot see, or before it looks)
    if (sim.agents.length >= sim.cap + 70) return null; at(q, s, _p2);
    if (!free(_p2.x, _p2.y) || sim.vehicleAt(_p2.x, _p2.y)) return null;
    const w0 = nav.ways[0], mk = () => { const a = sim.make(w0, 0, 0, 1, false, { x: _p2.x, y: _p2.y }); w0.agents.pop(); w0.pop--; a.home = null; a.w = null; a.z = 0.15; a.v = 0; a.state = 'stand'; sim.nStand++; a.standT = 1e9; a.t = 20; return a; };
    const other = (p, ch) => { if (sim.adults.length > 2) for (let k = 0; k < 4 && ch.includes(p.char); k++) sim.recast(p, sim.adults[Math.floor(rand() * sim.adults.length) % sim.adults.length]); };
    const last = q.mem[q.mem.length - 1], near = last ? each(last).map((p) => p.char) : [];
    const a = mk(); other(a, near); let b = null; if (rand() < 0.2 && s > 0.5 && q.kind !== 'wait') { b = mk(); other(b, near.concat([a.char])); pairUp(a, b); }
    const m = member(q, a, b); m.s = s; q.mem.push(m); target(q, m, true, true); for (const p of each(m)) { sim.setClip(p, p.talk || p.idle, true); p.ph = rand(); } if (m.b) m.b.ph = a.ph; Q.kn.made += m.b ? 2 : 1; return m;
  }
  function pairUp(a, b) { a.fol = [b]; b.lead = a; b.fol = null; if (rand() < 0.6 && sim.talkA && sim.talkB) { a.talk = sim.talkA; b.talk = sim.talkB; } else { a.talk = null; b.talk = null; } }
  // a passer-by to join the end of the line (fled: one of those who ran from it, coming back); never someone whose straight way there leaves the sidewalk
  function sidewalkLeg(x0, y0, x1, y1) {
    for (let k = 1; k < 6; k++) {
      if (!st.onSidewalk(x0 + (x1-x0)*k/6, y0 + (y1-y0)*k/6)) return false;
    }
    return true;
  }
  function joinLeg(person, x, y) {
    return clearMove(person, x, y) && sidewalkLeg(person.x, person.y, x, y);
  }
  function pick(q, s, R, fled) {
    at(q, s, _p2); let best = null, bd = R * R; const now = game.t, tx = _p2.x, ty = _p2.y;
    for (const a of fled ? q.fled : sim.agents) { const dx = a.x - tx, dy = a.y - ty, d2 = dx * dx + dy * dy; if (d2 > bd || a.state !== 'walk' || a.lead || a.fear || a.door || a.inLine || !a.w || a.w.kind === 'cross' || a.gone || a.kid || q.retryAfter?.get(a) > now || (!fled && a.wasIn > now - 150 && a.wasIn <= now)) continue;
      if (a.fol && a.fol.length && (a.fol.length !== 1 || a.fol[0].kid || a.fol[0].state !== 'walk' || a.fol[0].fear)) continue; if (st.raycast(a.x, a.y, tx, ty) < 1) continue;
      if (!sidewalkLeg(tx, ty, a.x, a.y)) continue; bd = d2; best = a; }
    return best;
  }
  // nobody of the line (standing place or body) within r of the straight walk from x0,y0 to x1,y1 (the crowd's walk to a place is straight)
  function clear(q, x0, y0, x1, y1, r, a, b) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9, r2 = r * r, near = (px, py) => { const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)), ex = x0 + dx * t - px, ey = y0 + dy * t - py; return ex * ex + ey * ey < r2; };
    const hit = (p) => p && p !== a && p !== b && (near(p.x, p.y) || (p.qm && near(p.qx, p.qy)));
    for (const m of q.mem) if (hit(m.a) || hit(m.b)) return false; for (const o of q.knot) if (hit(o.m.a) || hit(o.m.b)) return false; return true;
  }
  function join(q, a, s) {
    const b = a.fol && a.fol.length === 1 ? a.fol[0] : null;
    // the way in is not through the people already standing: straight to the end only when that walk is clear of them all, else first to a point
    // out beside the end (a friend to a point further out and back from it); with no clear way at all this one is left to walk on
    at(q, s, _p2); const ex = _p2.x, ey = _p2.y, fx = Math.cos(_p2.h), fy = Math.sin(_p2.h), u = (a.x - ex) * fx + (a.y - ey) * fy, l = -(a.x - ex) * fy + (a.y - ey) * fx, sd = l >= 0 ? 1 : -1;
    const detourFits = (person, x, y) => joinLeg(person, x, y) &&
      clear(q, person.x, person.y, x, y, 0.55, a, b) &&
      joinLeg({x, y}, ex, ey) && clear(q, x, y, ex, ey, 0.55, a, b);
    let via = null, viaB = null, vk = 0, ok = (!q.mem.length || u <= 0.4) &&
      clearMove(a, ex, ey) && clear(q, a.x, a.y, ex, ey, 0.55, a, b) &&
      (!b || (joinLeg(b, ex, ey) && clear(q, b.x, b.y, ex, ey, 0.55, a, b)));
    if (!ok) for (const [k, lat, back] of [[sd, 0.95, 0.3], [sd, 1.5, 0.5], [sd, 1.2, 1.3], [-sd, 0.95, 0.3], [-sd, 1.5, 0.5], [-sd, 1.2, 1.3]]) { const vx = ex - fy * lat * k - fx * back, vy = ey + fx * lat * k - fy * back; if (!detourFits(a, vx, vy)) continue;
      if (b) { let w = null; for (const [o, bk] of [[0.5, 0.55], [0, 0.75], [0.3, 1.1]]) { const wx = vx - fy * o * k - fx * bk, wy = vy + fx * o * k - fy * bk; if (detourFits(b, wx, wy)) { w = [wx, wy]; break; } } if (!w) continue; viaB = w; }
      via = [vx, vy]; vk = k; ok = true; break; }
    if (!ok) { (q.retryAfter ||= new WeakMap()).set(a, game.t + 12); Q.kn.noway = (Q.kn.noway || 0) + 1; return null; }
    still(a); if (b) { still(b); pairUp(a, b); }
    const m = member(q, a, b); m.s = s; if (via) { m.via = via; m.viaB = viaB; m.sd = vk; }
    q.mem.push(m); target(q, m, false); Q.kn.joined += b ? 2 : 1; return m;
  }
  // out of the line and on their way (the served one with a bag in the hand)
  function walkOff(q, m, bag) {
    for (const a of each(m)) { if (!a || a.gone) continue; a.inLine = null; a.qm = 0; a.wasIn = game.t; if (a.state !== 'stand') continue;
      if (a.lead || a.fol) sim.leaveGroup(a); a.talk = null; if (bag && rand() < 0.8) { sim.give(a, 'shopping'); sim.hands(a); }
      at(q, 0.5, _p); let gx = -Math.cos(_p.h), gy = -Math.sin(_p.h); if (q.row.leave) { gx = q.row.leave[0] - a.x; gy = q.row.leave[1] - a.y; } else if (rand() < 0.6) { gx = -gx; gy = -gy; } const L = Math.hypot(gx, gy) || 1; a.gx = gx / L; a.gy = gy / L;
      sim.nStand--; a.state = 'walk'; a.standT = 0; sim.rejoin(a); }
    Q.kn.left++;
  }
  const drop = (q, i) => { const m = q.mem[i]; q.mem.splice(i, 1); for (const a of each(m)) { a.inLine = null; a.wasIn = game.t; } return m; };
  // the knot at the window: where someone who has ordered stands aside to wait for the food (k = 0, 1): past the window along the cart, or back from it
  function spotK(q, k, member) {
    const walker = member.a;
    at(q, 0, _p); const fx = Math.cos(_p.h), fy = Math.sin(_p.h), f = q.row.face, c = Math.cos(f), s = Math.sin(f), hx = _p.x, hy = _p.y;
    for (const [u, v] of k ? [[1.75, 0.2], [1.2, 0.95], [0.3, 1.3], [2.4, 0.3]] : [[1.0, 0.05], [0.75, 0.85], [-0.35, 1.25], [1.7, 0.4]]) { const x = hx + fx * u - c * v, y = hy + fy * u - s * v; if (!joinLeg(walker, x, y) || !clear(q, walker.x, walker.y, x, y, 0.55, walker, member.b)) continue;
      let ok = true; for (const o of q.knot) for (const p of each(o.m)) if (Math.hypot(p.qx - x, p.qy - y) < 0.55) ok = false; for (const m of q.mem) if (m.s < 3 && Math.hypot(m.a.qx - x, m.a.qy - y) < 0.55) ok = false;
      if (ok) return { x, y, th: Math.atan2(hy + s * 1.0 + fy * 0.3 - y, hx + c * 1.0 + fx * 0.3 - x) }; }
    return null;
  }

  // ------------------------------------------------------------------ one line, ten times a second
  function open(q) {
    const row = q.row, nn = typeof row.n === 'string' ? SIZE[row.n] || SIZE.short : Array.isArray(row.n) ? row.n : [row.n || 0, row.n || 0];
    q.kind = row.kind === 'wait' ? 'wait' : 'serve'; q.max = Math.round(nn[1] * K); q.min = Math.round(nn[0] * K); q.u = rand(); q.knot = []; q.fled = []; q.re = 0;
    const pitch = 0.56 * ((row.gap || 0.6) / 0.6) * (q.kind === 'wait' ? 1.5 : 1);
    q.path = buildPath(row, q.max * pitch * 1.25 + 5); q.sv = row.serve || (q.max >= 20 ? [18, 36] : [30, 60]); q.serve = q.sv[0] * rand(); q.join = 0; q.cool = 0; q.cap = 0;
    // a long line leaves one way through for the people on the sidewalk (as it would at a doorway)
    if (CUT && q.kind === 'serve' && q.max >= 20 && !row.keep) { const i0 = Math.round((q.max * pitch * (0.5 + rand() * 0.2)) / STEP); for (let i = i0; i < Math.min(q.path.n, i0 + 5); i++) q.path.ok[i] = 0; }
    { let s = 0, n = 0; for (; n < 90; n++) { s = place(q, n ? s + pitch : 0); if (s < 0) break; } q.cap = n; }
  }
  const want = (q) => Math.min(q.cap, Math.round((q.min + (q.max - q.min) * q.u) * busy(q.kind, hour())));
  function tick(q, dt, warm) {
    const M = q.mem, now = game.t; let scared = 0; const ran = (a) => { if (a.gone) return; if (a.state === 'flee' || a.state === 'down' || a.fear) { scared++; if (a.state !== 'down') { a.qf = now; q.fled.push(a); } } };
    for (let i = M.length - 1; i >= 0; i--) { const m = M[i], a = m.a, b = m.b;
      if (b && (b.gone || b.state !== 'stand' || b.lead !== a)) { ran(b); b.inLine = null; b.qm = 0; m.b = null; m.deep = 0; a.fol = null; a.talk = null; }
      if (a.gone || a.state !== 'stand') { ran(a); { const k = 'out_' + (a.gone ? 'gone' : a.state) + (a.fear ? '_fear' : ''); Q.kn[k] = (Q.kn[k] || 0) + 1; } const mm = drop(q, i); a.qm = 0; if (mm.b && !mm.b.gone && mm.b.state === 'stand') { mm.b.lead = null; walkOff(q, { a: mm.b }, false); } } }
    // those who ordered and wait aside: the bag comes, they go
    for (let i = q.knot.length - 1; i >= 0; i--) { const o = q.knot[i], m = o.m, a = m.a; if (m.b && (m.b.gone || m.b.state !== 'stand')) { ran(m.b); m.b.inLine = null; m.b.qm = 0; m.b = null; }
      if (a.gone || a.state !== 'stand') { ran(a); q.knot.splice(i, 1); a.inLine = null; a.qm = 0; a.wasIn = now; if (m.b) walkOff(q, { a: m.b }, false); continue; }
      if (a.qm === 2 && a.t > 9 && o.t > 0) a.t = 0; if (!a.fear && (o.t -= dt) <= 0) { q.knot.splice(i, 1); walkOff(q, m, true); } }
    if (scared) { q.cool = 6 + rand() * 4; q.re = now + 80; Q.kn.scared += scared; }
    if (q.fled.length) { let fear = false; for (let i = q.fled.length - 1; i >= 0; i--) { const a = q.fled[i]; if (a.gone || a.state === 'down' || now - a.qf > 150 || a.inLine) q.fled.splice(i, 1); else if (a.fear || a.state === 'flee') fear = true; } if (fear && q.cool < 3) q.cool = 3; }
    if (q.cool > 0) q.cool -= dt;
    // the head orders, then steps aside to wait (two at most wait: with both places taken the next order waits); at a bus stop people give up one by one
    if (q.kind === 'serve' && M.length && !M[0].a.fear) { const hd = M[0]; if (hd.s < 0.3 && !hd.via && !hd.a.qm) { q.serve -= dt;
      if (q.serve <= 0 && q.knot.length < 2) { const k = q.knot.some((o) => o.k === 0) ? 1 : 0, sp = KNOT && isFinite(q.row.face) ? spotK(q, k, hd) : null, m = drop(q, 0);
        if (sp) { m.a.inLine = q.id; put(m.a, sp.x, sp.y, sp.th + (rand() - 0.5) * 0.5, false);
          if (m.b) { const c = Math.cos(q.row.face), s = Math.sin(q.row.face), bx = sp.x - c * 0.52, by = sp.y - s * 0.52; if (joinLeg(m.b, bx, by) && clear(q, m.b.x, m.b.y, bx, by, 0.55, m.a, m.b)) { m.b.inLine = q.id; put(m.b, bx, by, sp.th, false); } else { const b = m.b; m.b = null; walkOff(q, { a: b }, false); m.a.talk = null; } }
          q.knot.push({ m, k, t: q.sv[0] * 0.6 + rand() * q.sv[1] * 0.6 }); }
        else walkOff(q, m, true);
        q.serve = (q.sv[0] + rand() * (q.sv[1] - q.sv[0])) * (sp ? 0.85 : 1); Q.kn.served++; } } }
    if (q.kind === 'wait') for (let i = M.length - 1; i >= 0; i--) { const m = M[i]; if ((m.out -= dt) <= 0 && !m.a.fear && !warm) walkOff(q, drop(q, i), false); }
    // everyone's place: behind the one in front by their own gap; they move up one after another (the one in front first), each in their own time
    let s = 0, prevSet = true;
    for (let i = 0; i < M.length; i++) { const m = M[i], a = m.a; s = place(q, i ? s + m.gap + (M[i - 1].deep || 0) : 0); if (s < 0) { for (let k = M.length - 1; k >= i; k--) { walkOff(q, drop(q, k), false); Q.kn.out_full = (Q.kn.out_full || 0) + 1; } break; }
      if (a.fear || (m.b && m.b.fear)) { prevSet = false; continue; }
      if (m.b && m.retryCompanionAt && now >= m.retryCompanionAt) target(q, m, false);
      if (m.chat && !(i && M[i - 1].back)) { m.chat = false; dress(q, m); }
      if (m.via && (warm || ((a.qm !== 2 || Math.hypot(a.x - m.via[0], a.y - m.via[1]) < 0.45) && (!m.b || m.b.qm !== 2 || Math.hypot(m.b.x - m.viaB[0], m.b.y - m.viaB[1]) < 0.6)))) {
        at(q, s, _p2);
        const endX = _p2.x, endY = _p2.y;
        const canFinish = p => joinLeg(p, endX, endY) && clear(q, p.x, p.y, endX, endY, 0.55, a, m.b);
        if (canFinish(a) && (!m.b || canFinish(m.b))) { m.s = s; m.at = 0; m.via = null; target(q, m, warm); }
      }
      if (m.s > s + 0.1) { if (warm) { m.s = s; target(q, m, true); } else if (prevSet) { if (!m.at) m.at = now + m.slow * (0.5 + rand()) * (m.s - s > 1.6 ? 0.4 : 1); else if (now >= m.at) { m.s = s; m.at = 0; target(q, m, false); } } prevSet = false; }
      else { if (m.s < s - 0.1) { m.s = s; target(q, m, warm); }
        prevSet = warm || a.qm !== 2;      /* the next one may start once this one has (each a moment later, at the same pace: nobody runs into a back) */
        // small things while standing: a look to the side or back down the line, a lean out to see how long it is, the phone out or away
        if (rand() < dt / 12) { const u = rand(); m.look = u < 0.7 ? 0 : u < 0.94 ? pm() * (0.3 + rand() * 0.5) : pm() * (2.3 + rand() * 0.6); target(q, m, false); }
        if (m.lean) { if (now > m.leanT) { m.lean = 0; target(q, m, false); } }
        else if (!m.b && !m.back && !m.via && i > 1 && q.kind === 'serve' && !a.qm && rand() < dt / 100) { at(q, m.s, _p); const nx = -Math.sin(_p.h), ny = Math.cos(_p.h), sd = pm(); for (const k of [sd, -sd]) if (free(_p.x + nx * 0.36 * k, _p.y + ny * 0.36 * k) && free(_p.x + nx * 0.95 * k, _p.y + ny * 0.95 * k)) { m.lean = 0.36 * k; m.leanT = now + 4 + rand() * 7; m.look = 0; target(q, m, false); break; } }
        if ((m.habit -= dt) <= 0 && !m.b) { m.habit = 25 + rand() * 70; dress(q, m); } }
      // still walking up to the line from where they were: keep walking (the crowd's stand state gives up after 12 s); after 40 s they give it up
      if (m.via || a.qm === 2 || (a.qm === 1 && a.shuffleBlocked)) { if (!m.walkT) m.walkT = now; if (now - m.walkT > 40 && !warm) { walkOff(q, drop(q, i), false); Q.kn.out_far = (Q.kn.out_far || 0) + 1; i--; continue; } if (a.t > 9) a.t = 0; } else m.walkT = 0;
      if (m.b && m.b.qm === 2 && m.b.t > 9) m.b.t = 0; }
    // new people at the end (after a scare: those who ran come back first, and passers-by fill it quickly)
    const n = M.reduce((k, m) => k + (m.b ? 2 : 1), 0), W = want(q);
    if (n < W && q.cool <= 0) { const last = M[M.length - 1], ts = place(q, last ? last.s + last.gap + (last.deep || 0) + 0.12 : 0);
      if (ts >= 0 && ts < q.path.len - 1.3) { at(q, ts, _p2); const hidden = warm || sim.unseen(_p2.x, _p2.y);
        if (hidden) { for (let k = warm ? 70 : 2, s2 = ts, cnt = n; k > 0 && cnt < W && s2 >= 0; k--) { const m = spawn(q, s2); if (!m) break; cnt += m.b ? 2 : 1; s2 = place(q, s2 + (m.deep || 0) + 0.42 + rand() * 0.25); } }
        else if ((q.join -= dt) <= 0) { const back = now < q.re, a = (q.fled.length ? pick(q, ts, 45, true) : null) || pick(q, ts, back ? 26 : 15, false), m = a ? join(q, a, ts) : null;
          q.join = m ? (back ? 0.25 + rand() * 0.6 : n < W * 0.5 ? 1.5 + rand() * 4 : (3 + rand() * 12) * (n > W * 0.8 ? 2.2 : 1)) : back ? 0.4 : 1.5; } } }
  }

  // ------------------------------------------------------------------ the rows: game.queues, and our own (bus stops, the carts that stand there already)
  const byRow = new Map(); let ownDone = false, rowsT = 0, acc = 0, lastX = 1e9, lastY = 1e9;
  function own() {
    ownDone = true; if (P && P.get && P.get('queueown') === '0') return; const F = game.streets && game.streets.parts && game.streets.parts.furniture, Kd = F && F.kinds; if (!Kd) return;
    const h01 = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
    const mine = (id, x, y, r) => game.queues.some((o) => !o.own && Math.hypot(o.x - x, o.y - y) < r);
    if (Kd.busstop) for (const it of Kd.busstop.list) { const w = wayAt(it[0], it[1], 6); if (!w || h01(it[0], it[1]) > 0.75 || mine(0, it[0], it[1], 8)) continue; const s = (it[0] - w.ax) * w.ux + (it[1] - w.ay) * w.uy, l = (it[0] - w.ax) * w.nx + (it[1] - w.ay) * w.ny, l2 = Math.max(l + 0.75, 1.15);
      game.queues.push({ own: true, id: 'bus' + game.queues.length, name: 'bus stop', kind: 'wait', x: w.ax + w.ux * s + w.nx * l2, y: w.ay + w.uy * s + w.ny * l2, face: Math.atan2(-w.ny, -w.nx), n: [2, 7], gap: 0.72 }); }
    if (Kd.cart && !game.carts) for (const it of Kd.cart.list) { const w = wayAt(it[0], it[1], 6); if (!w || mine(0, it[0], it[1], 6)) continue; const s = (it[0] - w.ax) * w.ux + (it[1] - w.ay) * w.uy, l = (it[0] - w.ax) * w.nx + (it[1] - w.ay) * w.ny, sd = l < 2.4 ? 1 : -1, l2 = l + sd * 1.15;
      game.queues.push({ own: true, id: 'cart' + game.queues.length, name: 'cart', x: w.ax + w.ux * s + w.nx * l2, y: w.ay + w.uy * s + w.ny * l2, face: Math.atan2(-w.ny * sd, -w.nx * sd), n: [1, 2 + Math.floor(h01(it[1], it[0]) * 4)], serve: [25, 55] }); }
  }
  function standIn() {      // 6th Avenue at W 49th: the window 9 m short of the corner, the line runs to the corner and round it into W 49th
    const cx = 494.83, cy = 1606.02; let best = null, bd = 1e9; for (const w of nav.near(cx, cy, 60, [])) { if (w.kind !== 'strip' || !w.e || !/6th Avenue/.test(w.e.name || '') || w.len < 30) continue; const end = Math.hypot(w.ax - cx, w.ay - cy) < Math.hypot(w.ax + w.ux * w.len - cx, w.ay + w.uy * w.len - cy) ? 0 : 1, d = Math.hypot(w.ax + w.ux * (end ? w.len : 0) - cx, w.ay + w.uy * (end ? w.len : 0) - cy) + (w.nx < 0 ? 0 : 0.5); if (d < bd) { bd = d; best = { w, end }; } }
    if (!best) return; const w = best.w, s = best.end ? w.len - 9 : 9, l = lineL(w, s), dd = best.end ? 1 : -1;
    game.queues.push({ id: 'standin', name: 'stand-in', x: w.ax + w.ux * s + w.nx * l, y: w.ay + w.uy * s + w.ny * l, face: Math.atan2(-w.ny, -w.nx), dir: [w.ux * dd, w.uy * dd], n: [28, 36] });
  }
  if (P && P.get && P.get('queuestand') === '1') try { standIn(); } catch (e) { console.log('[queues] no stand-in: ' + e.message); }

  Q.step = (dt) => {
    if ((rowsT -= dt) <= 0) { rowsT = 1;
      if (!ownDone && (!game.streets || !game.streets.parts || game.streets.parts.furniture)) try { own(); } catch (e) { ownDone = true; console.log('[queues] own lines not placed: ' + e.message); }
      for (const row of game.queues) { if (!row || byRow.has(row) || !isFinite(row.x) || !isFinite(row.y)) continue; const q = { id: row.id || 'q' + byRow.size, row, mem: [], knot: [], fled: [], live: false, path: null }; byRow.set(row, q); Q.list.push(q); } }
    for (const q of Q.list) if (q.live) { for (const m of q.mem) { slide(m.a, dt); if (m.b) slide(m.b, dt); } for (const o of q.knot) { slide(o.m.a, dt); if (o.m.b) slide(o.m.b, dt); } }
    // someone walking up to their place is never inside someone who stands (a lean-out begun after the walk was chosen, a late move up): pushed out to 0.38 m
    for (const q of Q.list) if (q.live) { const M = q.mem; for (let i = M.length - 1; i >= 0; i--) for (const w of each(M[i])) { if (w.qm !== 2 || w.state !== 'stand' || w.fear) continue;
      for (let j = 0; j < M.length; j++) { if (j === i) continue; for (const o of each(M[j])) { if (o.qm === 2 && j > i) continue; const dx = w.x - o.x, dy = w.y - o.y, d = Math.hypot(dx, dy); if (d >= 0.38 || d < 1e-4) continue; const k = (0.38 - d) / d, x = w.x + dx * k, y = w.y + dy * k; if (joinLeg(w, x, y)) { w.x = x; w.y = y; } } } } }
    acc += dt; if (acc < 0.1) return; const d = Math.min(acc, 0.5); acc = 0;
    const jump = Math.hypot(sim.cx - lastX, sim.cy - lastY) > 60; lastX = sim.cx; lastY = sim.cy;
    for (const q of Q.list) { const dist = Math.hypot(q.row.x - sim.cx, q.row.y - sim.cy);
      if (!q.live) { if (dist > R_ON) continue; try { if (!q.path) open(q); } catch (e) { q.dead = String(e.message); q.path = { pts: [[q.row.x, q.row.y]], ok: new Uint8Array(1), n: 0, len: 0 }; q.cap = 0; q.max = q.min = 0; } q.live = true; if (!q.dead) tick(q, d, true); continue; }
      if (dist > R_OFF) { for (const m of q.mem.splice(0).concat(q.knot.splice(0).map((o) => o.m))) for (const a of [m.a, m.b]) if (a && !a.gone) { a.inLine = null; a.qm = 0; if (a.lead || a.fol) sim.leaveGroup(a); sim.remove(a); } q.live = false; continue; }
      if (!q.dead) tick(q, d, jump); }
  };
  Q.report = () => Q.list.map((q) => ({ id: q.id, name: q.row.name, live: q.live, n: q.mem.reduce((k, m) => k + (m.b ? 2 : 1), 0), aside: q.knot.length, want: q.path && !q.dead ? want(q) : 0, cap: q.cap, len: q.path ? +q.path.len.toFixed(1) : 0, dead: q.dead }));
  Q.path = (id) => { const q = Q.list.find((o) => o.id === id); return q && q.path ? q.path.pts.slice(0, q.path.n) : null; };
  Q.members = (id) => { const q = Q.list.find((o) => o.id === id); return q ? q.mem : []; };
  const step0 = sim.step.bind(sim); sim.step = function (dt) { step0(dt); try { Q.step(dt); } catch (e) { if (!Q.err) { Q.err = String((e && e.stack) || e).slice(0, 500); console.log('[queues] stopped: ' + Q.err); } Q.on = false; sim.step = step0; } };
  console.log('[queues] on: ' + game.queues.length + ' rows at start');
  return Q;
}
