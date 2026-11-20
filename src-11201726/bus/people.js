// bus/people.js (bus lane, Nov 15): people really get off and on. The people are the crowd's own (the people lane's src/crowd/): the line at a stop
// is its queue row 'bus:<n>' (crowd/queues.js, pushed by bus.js), and nothing of the crowd's files is edited: someone boarding is taken out of the
// line the way queues.js itself lets a person go, sent to the open front door as a standing person is sent to a new spot (tx, ty), and retired
// there (sim.remove); someone getting off is one new crowd person (sim.make) set down at the door, who walks on along the sidewalk.
// First off, then on, one at a time, and the doors wait for them. ?buspeople=0 off (the line just stands, nobody is seen getting off).
// people lane: this stands in for the two calls I asked you for on INBOX (queues.board / queues.alight); when you have them, this file calls them.
export function addPeople(game, fleet) {
  const g = game, P = { on: true, kn: { on: 0, off: 0, ran: 0, noway: 0 }, fail: 0 }, pt = [0, 0];
  const crowd = () => g.crowd, Q = () => { const c = crowd(); return c && c.queues && c.queues.on !== false ? c.queues : null; };
  const row = (st) => { const q = Q(); return q && q.list ? q.list.find((o) => o.id === 'bus:' + st.stop.i) || null : null; };
  // how many stand in the line at a stop (-1: no line is kept there)
  P.count = (st) => { try { const q = row(st); return q && q.mem ? q.mem.reduce((k, m) => k + (m.b ? 2 : 1), 0) : -1; } catch (e) { return -1; } };
  P.arrive = (B, st) => {
    B.going = []; B.board = []; B.alight = Math.min(B.off, 4); B.pT = 0.4; if (!P.on) return;
    try { const q = row(st), Qm = Q(); if (!q || !q.mem) return;
      if (Qm.board) { B.board = Qm.board(q.id, 8) || []; }      // the people lane's own call, when it is there
      else for (let k = 0; k < 8 && q.mem.length; k++) { const m = q.mem[0]; q.mem.splice(0, 1); for (const a of [m.a, m.b]) if (a && !a.gone) { a.inLine = null; a.wasIn = g.t; a.qm = 0; if (a.state === 'stand') B.board.push(a); } }
      B.on = B.board.length; B.dwellT = Math.max(B.dwellT, 4 + 1.15 * (B.on + B.alight));
    } catch (e) { fail(e); }
  };
  const fail = (e) => { if (++P.fail <= 3) console.warn('[bus] people: ' + (e && (e.stack || e.message) || e)); if (P.fail > 20) P.on = false; };
  // one new person on the sidewalk at (x, y), walking on
  const setDown = (x, y) => {
    const c = crowd(), sim = c && c.sim, nav = c && c.nav; if (!sim || !nav || !sim.make) return false; const Qm = Q(); if (Qm && Qm.alight) return !!Qm.alight(x, y, 1);
    let best = null, bd = 6; for (const w of nav.near(x, y, 8, [])) { if (w.kind === 'cross') continue; const dx = x - w.ax, dy = y - w.ay, s = dx * w.ux + dy * w.uy, l = dx * w.nx + dy * w.ny, d = Math.max(0, -s, s - w.len) + Math.max(0, -l - 0.5, l - 12) + (w.kind === 'strip' ? 0 : 0.5); if (d < bd) { bd = d; best = { w, s: Math.max(0.5, Math.min(w.len - 0.5, s)), l: Math.max(0.35, l) }; } }
    if (!best) { P.kn.noway++; return false; }
    const a = sim.make(best.w, best.s, best.l, sim.rand() < 0.5 ? 1 : -1); if (!a) return false; a.x = x; a.y = y; a.v = 0.6; P.kn.off++; return true;
  };
  P.step = (dt) => {
    if (!P.on) return; const c = crowd(), sim = c && c.sim;
    for (const B of fleet.buses) {
      if (!B.going) continue; const dwell = B.state === 'dwell' ? !!B.c : B.state === 'player' && !!B.pOpen; if (!dwell) { if (B.state !== 'dwell') { for (const a of B.going.concat(B.board || [])) if (a && !a.gone && a.state === 'stand') { a.standT = 1 + Math.random() * 3; a.t = 0; } B.going = null; B.board = null; B.alight = 0; } continue; }
      if (B.doorF < 0.85) continue;
      try {
        B.pT -= dt; const front = fleet.door(B, 'front', 0.55), rear = B.doorR > 0.85 ? fleet.door(B, 'rear', 0.6) : front;
        if (B.pT <= 0) {
          if (B.alight > 0) { B.alight--; B.pT = 0.85 + Math.random() * 0.5; if (sim) setDown(rear[0], rear[1]); }
          else if (B.board.length) { const a = B.board.shift(); B.pT = 0.9 + Math.random() * 0.5; if (a && !a.gone && a.state === 'stand') { a.t = 0; a.standT = 1e9; B.going.push(a); } }
        }
        for (let i = B.going.length - 1; i >= 0; i--) { const a = B.going[i];
          if (!a || a.gone || a.state !== 'stand') { B.going.splice(i, 1); P.kn.ran++; continue; }      // ran from a car or a shot, went down: no longer boarding
          a.tx = front[0]; a.ty = front[1]; a.th = B.h - Math.PI / 2; if (a.t > 9) a.t = 9;
          if (Math.hypot(a.x - front[0], a.y - front[1]) < 0.55) { sim.remove(a); B.going.splice(i, 1); P.kn.on++; } }
        if (B.going.length || B.board.length || B.alight > 0) B.hold = Math.max(B.hold, 0.7);
      } catch (e) { fail(e); B.going = null; }
    }
  };
  return P;
}
