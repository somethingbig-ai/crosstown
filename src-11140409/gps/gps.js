// gps/gps.js (progress lane, item 3; players: "add a way to open a larger map", "the GPS isn't accurate: I can't see the exact path on the roads.
// It's only a direct line to the destination"). The player sets a waypoint on the full-screen map and is led there along the roads:
//   game.gps.set({ x, y, name? }, by)   map metres; the waypoint goes to the nearest point of a drivable road; returns the target, or null
//   game.gps.clear(by)   .target { x, y, name, by }   .route (same shape as missions.route)   .dist (metres to go)   .trace(c, P)   .color
// The route follows the one-way streets (gps/route.js: the job loop's road rules, searched with a heap), from the car's lane or, on foot or in
// the air, from the nearest road; it is kept current every frame (blocks driven are dropped), planned again the moment the player leaves it,
// and cleared on arrival with a two-note sound and a line on the HUD. It is drawn on the road (gps/line.js), on the round map and on the full map.
// THE JOB AND THE WAYPOINT: the job loop (mission.js) is not touched and keeps its own route, card, marker and timer. While the player has a
// waypoint, the maps draw HIS line and not the job's (two lines crossing on one small map cannot be read, and he asked for this one); the job's
// amber marker stays, and the job's line is back the moment the waypoint is reached or cleared. The line on the road is the waypoint's only.
// THE MAP: the tiles lane's city map (citymap.js, game.hud.cmap) is the map. This module handles the mouse on it (lanes/progress/gps/FOR-TILES.md).
// Only while hud.cmap does not exist it brings a plain full-screen map of its own on Tab (the old round map's picture, north up).
// ?gps=0 off (nothing fetched).  ?gpsline=0 no line on the road.  ?gpsk=<n> the road line's brightness.
import { Router, routeLeft } from './route.js';
import { WorldLine } from './line.js';

const COLOR = '#5cc8ff', INK = 'rgba(12,13,15,0.78)';
const short = (n) => n.replace(/^West /, 'W ').replace(/^East /, 'E ').replace(/ Street$/, ' St').replace('Avenue of the Americas', '6th Ave').replace(/ Avenue$/, ' Ave').replace(/ Place$/, ' Pl').replace(/ Square$/, ' Sq');

export function install(game) {
  if (game.gps) return game.gps; if ((game.P && game.P.get('gps') === '0') || !game.roads || !game.hud || !game.world) return null;
  const g = game, R = g.roads, hud = g.hud, P = g.P, router = new Router(R), num = (k, d) => (P && P.has(k) && isFinite(+P.get(k)) ? +P.get(k) : d);
  const G = (g.gps = { target: null, route: null, dist: 0, color: COLOR, router, note: null, stats: { set: 0, plans: 0, replans: 0, arrived: 0, frames: 0, ms: 0, worstFrame: 0 } });
  let line = null; if (!(P && P.get('gpsline') === '0') && !g.capture) try { line = new WorldLine(g, { color: COLOR, k: num('gpsk', 1.15), opacity: num('gpsa', 0.8) }); } catch (e) { console.log('[gps] no road line: ' + (e && e.message)); }
  G.line = line;
  const say = (text, sub = '', t = 3.5, kind = '') => { G.note = { text, sub, t: 0, life: t, kind }; };
  const beep = (...notes) => { try { notes.forEach(([f, at, len], i) => setTimeout(() => g.sound.shot(f, len || 0.14, 'sine', 0.16), at)); } catch (e) {} };

  // ---- where the player is, and what kind of start that makes
  const where = () => { const pl = g.player, v = pl.vehicle; if (v) return { x: v.x, y: v.y, h: v.h, car: v }; if (g.heli && g.heli.piloted && g.focus) return { x: g.focus.x, y: g.focus.y, h: 0, air: true }; return { x: pl.x, y: pl.y, h: pl.h, car: null }; };
  const startOf = (pos) => {
    if (pos.car) { const at = R.locate(pos.x, pos.y, pos.h, 30); if (at && at.e.start && (at.dir > 0 ? router.core[at.e.b] : router.core[at.e.a])) return { e: at.e, t: at.dir > 0 ? at.s : at.e.len - at.s, dir: at.dir }; }
    const n = router.nearest(pos.x, pos.y, 500, 1, 'start')[0] || router.nearest(pos.x, pos.y, 1e7, 1, 'start')[0]; return n ? { e: n.e, t: n.t, dir: 0 } : null;
  };
  const nameAt = (c) => { const e = c.e, own = e.name ? short(e.name) : ''; let best = null;
    for (const ni of [e.a, e.b]) { const n = R.nodes[ni], d = Math.hypot(n.p[0] - c.x, n.p[1] - c.y); if (d > 60 || (best && d > best.d)) continue; const other = n.e.map((k) => R.edges[k].name).filter((x) => x && x !== e.name)[0]; if (other) best = { d, name: short(other) }; }
    return own && best ? own + ' & ' + best.name : own || (best && best.name) || 'Waypoint'; };
  let mode = '', lastPlan = 0;
  const modeOf = (pos) => (pos.car ? 'car' : pos.air ? 'air' : 'foot');
  const plan = (pos) => { const T = G.target, from = startOf(pos); if (!T || !from) return null; const r = router.planAny(from, T.goal); G.stats.plans++; lastPlan = g.t; mode = modeOf(pos); if (r) { r.id = ++G.routeId; r.foot = !pos.car; } return r; };
  G.routeId = 0;

  G.set = (t, by = 'player') => {
    if (!t || !isFinite(t.x) || !isFinite(t.y)) return null; const pos = where(), from = startOf(pos); if (!from) return null;
    const cands = router.nearest(t.x, t.y, 600, 4, 'goal'); if (!cands.length) cands.push(...router.nearest(t.x, t.y, 1e7, 1, 'goal'));
    for (const c of cands) { const goal = { e: c.e, t: c.t, x: c.x, y: c.y }, r = router.planAny(from, goal); G.stats.plans++; if (!r) continue;
      r.id = ++G.routeId; r.foot = !pos.car; mode = modeOf(pos); lastPlan = g.t;
      G.target = { x: c.x, y: c.y, rx: c.x, ry: c.y, px: t.x, py: t.y, name: t.name || nameAt(c), by, goal }; G.route = r; G.dist = routeLeft(r); G.stats.set++; G.note = null; beep([620, 0, 0.07]); return G.target; }
    say('No road leads there', '', 2.5, 'bad'); return null;
  };
  G.clear = (by = 'player') => { if (!G.target) return false; G.target = null; G.route = null; G.dist = 0; if (line) line.hide(); if (by !== 'arrive') beep([420, 0, 0.07]); return true; };
  // the drive still to do as a canvas path, through the caller's P(x, y) -> [px, py]; the caller strokes it
  G.trace = (c, Pf) => {
    const r = G.route, T = G.target; if (!r || !T) return false; const pos = where(), last = r.segs.length - 1, q0 = Pf(pos.x, pos.y), tmp = {}; c.beginPath(); c.moveTo(q0[0], q0[1]);
    r.segs.forEach((sg, i) => { const ln = sg.dir > 0 ? sg.e.line : sg.e.rev, from = i === 0 ? r.s0 : 0, to = i === last ? r.end.s : ln.len;
      if (i === 0) { ln.at(from, tmp); const q = Pf(tmp.x, tmp.y); c.lineTo(q[0], q[1]); }
      for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 1 || ln.cum[j] >= to) continue; const q = Pf(ln.p[j][0], ln.p[j][1]); c.lineTo(q[0], q[1]); }
      if (i === last) { ln.at(to, tmp); const q = Pf(tmp.x, tmp.y); c.lineTo(q[0], q[1]); } });
    return true;
  };

  // ---- every frame while a waypoint is set: arrival, progress along the route, leaving it
  let offT = 0;
  const track = (dt) => {
    const T = G.target; if (!T) return; const pos = where(), E = T.goal.e;
    if (Math.hypot(T.x - pos.x, T.y - pos.y) < (pos.air ? 30 : Math.max(14, (E.width || 10) / 2 + 7))) { G.stats.arrived++; const name = T.name; G.clear('arrive'); say('You have arrived', name, 4, 'ok'); beep([660, 0, 0.13], [990, 120, 0.2]); return; }
    let r = G.route; if (!r || modeOf(pos) !== mode) { r = G.route = plan(pos) || r; if (!r) return; }
    const pr = (sg) => (sg.dir > 0 ? sg.e.line : sg.e.rev).project(pos.x, pos.y);
    let a = pr(r.segs[0]), b = r.segs[1] ? pr(r.segs[1]) : null;
    if (b && (b.d < a.d - 0.5 || a.s >= r.segs[0].e.len - 0.5) && b.s > 0.5 && (r.segs.length > 2 || b.s < r.end.s + 12)) { r.segs.shift(); r.s0 = b.s; a = b; b = null; }
    else if (a.s > r.s0) r.s0 = a.s;
    const e0 = r.segs[0].e, d = Math.min(a.d, b ? b.d : 1e9), wide = e0.width / 2 + (pos.car ? 6 : pos.air ? 60 : 18);
    const back = a.s < r.s0 - (pos.car ? 14 : 20), past = r.segs.length === 1 && a.s > r.end.s + 14;
    let wrong = false; if (pos.car && !e0.oneway && !b) { const ln = r.segs[0].dir > 0 ? e0.line : e0.rev, tg = ln.at(a.s, {}); wrong = Math.cos(pos.h) * tg.tx + Math.sin(pos.h) * tg.ty < -0.5 && Math.abs(pos.car.vf || 0) > 3; }      // turned round on a two-way street
    if (d > wide || back || past || wrong) { offT += dt; if (offT > 0.25 && g.t - lastPlan > 0.3) { offT = 0; const nr = plan(pos); if (nr) { G.route = r = nr; G.stats.replans++; G.rerouteT = 1.6; } } } else offT = 0;
    if (r.segs.length === 1 && r.s0 > r.end.s) r.s0 = r.end.s;
    G.dist = routeLeft(r) + Math.min(a.d, 400);
  };
  const step0 = g.step.bind(g); g.step = (dt) => { step0(dt); if (G.target) { const t0 = performance.now(); try { track(dt); } catch (e) { if (!G.err) { G.err = String(e && (e.stack || e)); console.log('[gps] track: ' + G.err); } } G._ms = performance.now() - t0; } if (G.note) { G.note.t += dt; if (G.note.t > G.note.life) G.note = null; } if (G.rerouteT > 0) G.rerouteT -= dt; };

  // ---- the full-screen map: the tiles lane's when it is there, a plain one of this module's until then
  const fb = { full: false, view: null, mine: true,
    toMap(X, Y) { const v = this.view; return this.full && v && X >= v.x0 && X <= v.x1 && Y >= v.y0 && Y <= v.y1 ? [v.mx + (X - v.ox) / v.z, v.my - (Y - v.oy) / v.z] : null; } };
  G.fallbackMap = fb;
  const openMap = () => { const m = hud.cmap; if (m) return m.full && typeof m.toMap === 'function' ? m : null; return fb.full ? fb : null; };
  G.mapOpen = () => !!openMap();
  addEventListener('keydown', (e) => { if (hud.cmap) { fb.full = false; return; } if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat && !window.__startScreen && !g.demo) fb.full = !fb.full; } else if (fb.full && e.code === 'Escape') fb.full = false; }, true);
  const hudXY = (e) => { const c = hud.canvas, r = c.getBoundingClientRect(), k = hud.k || 1; return [((e.clientX - r.left) * (c.width / (r.width || 1))) / k, ((e.clientY - r.top) * (c.height / (r.height || 1))) / k]; };
  const ui = (e) => !!(e.target && e.target.closest && e.target.closest('#fbbox, a, button, input, textarea, select, [data-ui]'));
  const onMouse = (e) => {
    const m = openMap(); if (!m || ui(e)) return; e.stopPropagation(); if (e.type === 'contextmenu') { e.preventDefault(); return; } if (e.type !== 'mousedown') return;
    if (e.button === 2) { G.clear('map'); return; } if (e.button !== 0) return;
    const [X, Y] = hudXY(e), p = m.toMap(X, Y); if (!p) return; const q = m.toMap(X + 14, Y), near = q ? Math.max(12, Math.hypot(q[0] - p[0], q[1] - p[1])) : 30;
    if (G.target && Math.hypot(G.target.x - p[0], G.target.y - p[1]) < near) G.clear('map'); else G.set({ x: p[0], y: p[1] }, 'map');
  };
  for (const t of ['mousedown', 'mouseup', 'click', 'contextmenu', 'mousemove', 'dblclick']) addEventListener(t, onMouse, true);
  // the mouse is free while the map is open, and goes back to the game when it closes
  let wasOpen = false, hadLock = false; const cvs = g.world.renderer.domElement;
  try { const st = document.createElement('style'); st.textContent = 'body.gpsmap #lookhint{visibility:hidden}'; document.head.appendChild(st); } catch (e) {}
  const mouseState = () => { const open = !!openMap(); if (open === wasOpen) return; wasOpen = open;
    try { if (document.body.classList) document.body.classList.toggle('gpsmap', open);      /* the "Click to look" line (look.js) is hidden while the map is up: the click sets a waypoint there */
      if (open) { hadLock = document.pointerLockElement === cvs; if (document.pointerLockElement) document.exitPointerLock(); cvs.style.cursor = 'crosshair'; document.body.style.cursor = 'crosshair'; }
      else { cvs.style.cursor = ''; document.body.style.cursor = ''; if (hadLock && g.look) g.look.ask('click'); } } catch (e) {} };

  // ---- HUD: drawn after everything else the HUD draws
  const dtext = (m) => (m < 950 ? Math.max(5, Math.round(m / 5) * 5) + ' m' : (m / 1000).toFixed(1) + ' km');
  const drawFallback = (W, H) => {
    const c = hud.ctx, S = hud.mapS, pic = hud.map, pl = g.player, bx0 = -hud.hx, by1 = hud.hy, mw = pic.width / S, mh = pic.height / S, top = 84, bot = 40, side = 60;
    c.save(); c.shadowBlur = 0; c.fillStyle = 'rgba(8,9,11,0.90)'; c.fillRect(0, 0, W, H);
    const z = Math.min((W - 2 * side) / mw, (H - top - bot) / mh), ox = W / 2, oy = top + (H - top - bot) / 2, mx = bx0 + mw / 2, my = by1 - mh / 2, scr = (x, y) => [ox + (x - mx) * z, oy - (y - my) * z];
    const q0 = scr(bx0, by1); fb.view = { ox, oy, mx, my, z, x0: q0[0], y0: q0[1], x1: q0[0] + mw * z, y1: q0[1] + mh * z };
    c.imageSmoothingEnabled = true; c.drawImage(pic, q0[0], q0[1], mw * z, mh * z); c.lineJoin = 'round'; c.lineCap = 'round';
    const M = g.missions;
    if (G.target) { if (G.trace(c, scr)) { c.strokeStyle = COLOR; c.lineWidth = 4; c.stroke(); } }
    else if (M && M.route && M.target) { const r = M.route, last = r.segs.length - 1, a = scr(pl.x, pl.y); c.strokeStyle = '#ffb82e'; c.lineWidth = 4; c.beginPath(); c.moveTo(a[0], a[1]);     // the job's line, as the round map draws it
      r.segs.forEach((sg, i) => { const ln = sg.dir > 0 ? sg.e.line : sg.e.rev, from = i === 0 ? r.s0 : 0, to = i === last && r.end ? r.end.s : ln.len; for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 1 || ln.cum[j] >= to) continue; const q = scr(ln.p[j][0], ln.p[j][1]); c.lineTo(q[0], q[1]); } if (i === last) { const e = ln.at(to, {}), q = scr(e.x, e.y); c.lineTo(q[0], q[1]); } });
      const qt = scr(M.target.x, M.target.y); c.lineTo(qt[0], qt[1]); c.stroke(); }
    const dot = (x, y, col, r, label) => { const q = scr(x, y); c.fillStyle = col; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], r, 0, 7); c.fill(); c.stroke(); if (label) hud.text(label, q[0], q[1] - r - 7, 13, col, 'center', 800, 1.5); };
    if (M && M.target) dot(M.target.x, M.target.y, '#ffb82e', 8, 'JOB');
    if (G.target) dot(G.target.x, G.target.y, COLOR, 8, G.target.name.toUpperCase());
    { const q = scr(pl.x, pl.y); c.save(); c.translate(q[0], q[1]); c.rotate(Math.PI / 2 - pl.h); c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    hud.text('CITY MAP', side, 52, 30, '#fff', 'left', 800, 6);
    hud.text('CLICK  set waypoint      RIGHT-CLICK  clear      TAB  close', W - side, 51, 14, 'rgba(255,255,255,0.75)', 'right', 700, 1.5);
    hud.text('N', q0[0] + mw * z + 26, q0[1] + 30, 14, '#fff', 'center', 800); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(q0[0] + mw * z + 26, q0[1] - 2); c.lineTo(q0[0] + mw * z + 32, q0[1] + 12); c.lineTo(q0[0] + mw * z + 20, q0[1] + 12); c.closePath(); c.fill();
    c.restore();
  };
  const overlay = () => {
    const c = hud.ctx, k = hud.k, W = hud.w / k, H = 1080, T = G.target, N = G.note, mapUp = !!(hud.cmap ? hud.cmap.full : fb.full);
    if (!hud.cmap && fb.full) drawFallback(W, H);
    c.save(); c.shadowBlur = 0;
    // waypoint card, under the job card: name and metres to go; or the last note (arrived, no road)
    if (T || N) { const y = 136, a = N && !T ? Math.max(0, Math.min(1, N.t * 4, (N.life - N.t) * 2)) : 1; c.globalAlpha = a;
      c.fillStyle = INK; c.beginPath(); c.roundRect(36, y, 430, 50, 8); c.fill(); c.fillStyle = N && !T && N.kind === 'bad' ? '#ff5a45' : COLOR; c.fillRect(36, y, 5, 50);
      if (T) { hud.text(G.rerouteT > 0 ? 'NEW ROUTE' : 'WAYPOINT', 58, y + 21, 12, COLOR, 'left', 700, 2.5); hud.text(T.name, 58, y + 41, 17, '#fff', 'left', 600); hud.text(dtext(G.dist), 448, y + 34, 22, '#fff', 'right', 700); }
      else { hud.text(N.text.toUpperCase(), 58, y + 21, 12, N.kind === 'bad' ? '#ff5a45' : COLOR, 'left', 700, 2.5); hud.text(N.sub || '', 58, y + 41, 17, '#fff', 'left', 600); }
      c.globalAlpha = 1; }
    // until the city map is in: how to open the map, said by the round map
    if (!hud.cmap && !mapUp && !g.capture && !g.demo) hud.text('TAB  map', W - 36 - hud.mapR, H - 36 - 2 * hud.mapR - 12, 12, 'rgba(255,255,255,0.7)', 'center', 700, 1.5);
    c.restore();
  };
  const draw0 = hud.draw.bind(hud);
  hud.draw = function () {
    draw0(); const t0 = performance.now();
    try { mouseState(); if (line) { if (G.target) line.update(G.route, G.target, where().car ? 5 : 1.5, g.t); else if (line.mesh.visible || line.marker.visible) line.hide(); } overlay(); } catch (e) { if (!G.err) { G.err = String(e && (e.stack || e)); console.log('[gps] draw: ' + G.err); } }
    const ms = performance.now() - t0 + (G._ms || 0); G._ms = 0; G.stats.frames++; G.stats.ms += ms; if (ms > G.stats.worstFrame) G.stats.worstFrame = ms;
  };
  // the round map (hud.js drawMap, one line there): the waypoint's line instead of the job's while one is set, and its marker on the rim
  G.drawMini = (c, Pf, w) => { if (!G.target) return false; if (G.trace(c, Pf)) { c.strokeStyle = COLOR; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); } return true; };
  G.miniMarker = (c, cx, cy, R0, zoom, yaw) => { const T = G.target; if (!T) return; const pl = g.player, dx = T.x - pl.x, dy = T.y - pl.y, a = yaw - Math.PI / 2; let mx = (dx * Math.cos(a) + dy * Math.sin(a)) * zoom, my = (dx * Math.sin(a) - dy * Math.cos(a)) * zoom; const d = Math.hypot(mx, my); if (d > R0 - 10) { mx *= (R0 - 10) / d; my *= (R0 - 10) / d; }
    c.fillStyle = COLOR; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(cx + mx, cy + my, 7, 0, 7); c.fill(); c.stroke(); };
  // warm the planner while the game is still loading (the first calls of any function are the slow ones): 60 plans between far blocks, then the counters start clean
  try { const es = R.edges.filter((e) => e.goal && e.start); for (let i = 0; i < 60 && es.length > 1; i++) { const a = es[(i * 37) % es.length], b = es[(i * 101 + 13) % es.length]; router.plan({ e: a, t: a.len / 2, dir: 0 }, { e: b, t: b.len / 2, x: b.pts[0][0], y: b.pts[0][1] }); } router.plans = 0; router.ms = 0; router.worst = 0; } catch (e) {}
  console.log('[gps] on: ' + R.nodes.length + ' junctions, ' + R.edges.length + ' blocks');
  return G;
}
