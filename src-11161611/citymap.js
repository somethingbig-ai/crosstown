// citymap.js (tiles lane, Nov 14; Matt: "the mini map needs to be better, I'd like to see more of a map of where I am in the city").
// A real map of the playable city, drawn from the game's own street data (city.json: blocks, parks, buildings, the named road edges):
//   - the MINIMAP (bottom right): turns with the camera as before, but shows several blocks (about 300 m to each side, a little more at
//     speed), with the names of the streets and avenues in view, parks, landmarks, the route to the job, traffic dots, a heading arrow, N;
//   - the FULL MAP (Tab opens and closes it; Esc closes): north up, the whole playable map, every street and avenue named, landmarks,
//     the route, the job marker, "you are here" with heading. Mouse wheel or + / - zooms about the player; 0 shows the whole map again.
// hud.js keeps its old drawMap as the fallback until this module is in (and for ?citymap=0).
const AMBER = '#ffb82e';
// places a player would know, by latitude and longitude (projected with the city's own lat0 / lon0); parks' names come from the data
const LANDMARKS = [['Empire State Building', 40.74844, -73.98566], ['Flatiron Building', 40.74106, -73.98970], ['Times Square', 40.75800, -73.98550], ['Public Library', 40.75318, -73.98225],
  ['Herald Square', 40.74985, -73.98780], ['Grand Central', 40.75273, -73.97723], ['Penn Station', 40.75058, -73.99350], ['Rockefeller Center', 40.75874, -73.97870], ['Union Square', 40.73590, -73.99060],
  ['Koreatown', 40.74770, -73.98670], ['Garment District', 40.75370, -73.98990], ['Diamond District', 40.75690, -73.98030], ['Murray Hill', 40.74800, -73.97830], ['Chelsea', 40.74500, -73.99700], ['NoMad', 40.74480, -73.98850],
  ['Carnegie Hall', 40.76513, -73.97992], ['Radio City', 40.75998, -73.97998], ['Columbus Circle', 40.76806, -73.98190], ['Central Park', 40.76900, -73.97750], ['The Plaza', 40.76447, -73.97446], ['MoMA', 40.76143, -73.97762],
  ["St Patrick's", 40.75847, -73.97600], ["Hell's Kitchen", 40.76380, -73.99200], ['Theater District', 40.76000, -73.98500], ['Lincoln Center', 40.77250, -73.98350],
  ['Chrysler Building', 40.75161, -73.97537], ['Morgan Library', 40.74922, -73.98140], ['Seagram Building', 40.75844, -73.97215], ['Kips Bay', 40.74230, -73.97800],
  ['Hudson Yards', 40.75400, -74.00200], ['Javits Center', 40.75780, -74.00260], ['Chelsea Piers', 40.74660, -74.00830], ['Intrepid', 40.76450, -73.99960], ['Little Island', 40.74200, -74.01020],
  ['Chelsea Market', 40.74240, -74.00610], ['Lincoln Tunnel', 40.75850, -74.00100], ['Meatpacking District', 40.74090, -74.00790], ['High Line', 40.74800, -74.00480]];     /* tiles lane, Nov 15: the west column */     /* tiles lane, Nov 15: the east column (Grand Central, Rockefeller Center, MoMA and St Patrick's were here already) */
const AREAS = /Koreatown|District|Murray Hill|Chelsea$|NoMad|Kips Bay|Hudson Yards|Greenwich Village|West Village|Stuyvesant Town|^SoHo$|^NoHo$|East Village|Lower East Side|Nolita|Little Italy|Hudson Square|Alphabet City/;
// downtown lane, Nov 15: row A (south of the old south edge). Listed apart and taken only by a map whose play box reaches south of y -600: Union Square and Gramercy Park
// lie inside the nine-area map's picture margin and would otherwise appear on its Tab map.
const LANDMARKS_SOUTH = [['Washington Square Park', 40.73080, -73.99730], ['Union Square', 40.73590, -73.99060], ['Stuyvesant Town', 40.73170, -73.97780], ['Greenwich Village', 40.73360, -74.00030],
  ['Sheridan Square', 40.73340, -74.00250], ['Jefferson Market', 40.73470, -73.99900], ['Gramercy Park', 40.73790, -73.98600], ['Whitney Museum', 40.73960, -74.00890], ['West Village', 40.73500, -74.00550]];
const LANDMARKS_SOUTH2 = [['SoHo', 40.72330, -74.00200], ['NoHo', 40.72790, -73.99300], ['East Village', 40.72850, -73.98600], ['Lower East Side', 40.72080, -73.98500], ['Nolita', 40.72250, -73.99520], ['Little Italy', 40.71990, -73.99760],
  ['Hudson Square', 40.72600, -74.00750], ['Alphabet City', 40.72400, -73.97900], ['Cooper Union', 40.72930, -73.99050], ['Bowery', 40.72370, -73.99270]];     /* helper game B: row B (a play box that reaches south of y -1,800); typed from memory, as the list above */
const short = (n) => n.replace(/^West /, 'W ').replace(/^East /, 'E ').replace(/ Street$/, ' St').replace(/Avenue of the Americas/, '6th Av').replace(/ Avenue$/, ' Av').replace(/ Place$/, ' Pl').replace(/ Square$/, ' Sq');

export class CityMap {
  constructor(game, hud) {
    this.g = game; this.hud = hud; this.full = false; this.zoomF = 0; this.miniZ = 0.42; this.n = 0; this.miniLabels = [];
    const city = game.city, M0 = city.meta, pb = M0.play || [-M0.px, -M0.py, M0.px, M0.py], mgx = M0.hx - M0.px, mgy = M0.hy - M0.py;
    this.box = [pb[0] - mgx, pb[1] - mgy, pb[2] + mgx, pb[3] + mgy]; this.play = pb; const S = (this.S = 1.0), B = this.box;
    const m = (this.pic = document.createElement('canvas')); m.width = Math.ceil((B[2] - B[0]) * S); m.height = Math.ceil((B[3] - B[1]) * S); const x = m.getContext('2d');
    const P = (p) => [(p[0] - B[0]) * S, (B[3] - p[1]) * S], poly = (pts) => { pts.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.closePath(); };
    x.fillStyle = '#4b5058'; x.fillRect(0, 0, m.width, m.height);                                     // roadway: whatever no block covers
    x.fillStyle = '#1d2024'; for (const b of city.blocks) { x.beginPath(); for (const ring of [b.ext, ...(b.holes || [])]) poly(ring); x.fill('evenodd'); }      // blocks (sidewalk and lots)
    x.fillStyle = '#2a4a31'; for (const b of city.parks) { x.beginPath(); poly(b.ext); x.fill(); }                  // parks
    if (city.water && !(game.P && game.P.get('water') === '0')) { x.fillStyle = '#1c3d55'; for (const w of city.water) { x.beginPath(); poly(w.poly); x.fill(); } }      // tiles lane: water (city.water: the East River on the six-area map)
    x.fillStyle = '#2c3037'; for (const b of city.buildings) { if (b.minh > 0) continue; x.beginPath(); poly(b.poly); x.fill(); }      // buildings
    // avenues read a touch lighter than cross streets: a thin lighter line down each avenue's middle
    x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = 'rgba(255,255,255,0.10)';
    for (const e of city.edges) { if (!e.ave) continue; x.lineWidth = Math.max(2, (e.width || 12) * 0.45) * S; x.beginPath(); e.pts.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.stroke(); }
    // outside the playable box: dimmed, with the box's edge drawn
    x.fillStyle = 'rgba(10,11,13,0.55)'; const a = P([pb[0], pb[3]]), c = P([pb[2], pb[1]]);
    x.fillRect(0, 0, m.width, a[1]); x.fillRect(0, c[1], m.width, m.height - c[1]); x.fillRect(0, a[1], a[0], c[1] - a[1]); x.fillRect(c[0], a[1], m.width - c[0], c[1] - a[1]);
    x.strokeStyle = 'rgba(255,184,46,0.5)'; x.lineWidth = 2; x.setLineDash([10, 8]); x.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]); x.setLineDash([]);
    // street-name candidates: one per named edge of some length, at its middle, with the street's direction there
    this.names = [];
    for (const e of city.edges) { if (!e.name || e.len < 50) continue; const p = e.pts; let half = e.len / 2, i = 1, acc = 0; for (; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (acc + l >= half) break; acc += l; } i = Math.min(i, p.length - 1);
      const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1, t = (half - acc) / l; this.names.push({ t: short(e.name), ave: !!e.ave || /Broadway/.test(e.name), x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, a: Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), len: e.len }); }
    // landmarks: the list above, where it falls inside the picture, and every named park
    const KX = Math.cos(M0.lat0 * Math.PI / 180) * 111320, KY = 110574; this.marks = [];
    for (const [n, la, lo] of (pb[1] < -1800 ? LANDMARKS.concat(LANDMARKS_SOUTH, LANDMARKS_SOUTH2) : pb[1] < -600 ? LANDMARKS.concat(LANDMARKS_SOUTH) : LANDMARKS)) { const X = (lo - M0.lon0) * KX, Y = (la - M0.lat0) * KY; if (X > B[0] + 20 && X < B[2] - 20 && Y > B[1] + 20 && Y < B[3] - 20) this.marks.push({ t: n, x: X, y: Y, area: AREAS.test(n), inPlay: X > pb[0] && X < pb[2] && Y > pb[1] && Y < pb[3] }); }
    const seen = new Set(this.marks.map((k) => k.t)), KEEP = /^(Bryant Park|Madison Square Park|Greeley Square Park|Gramercy Park)$/;     /* parks: the big ones and the ones people know; pocket plazas would bury the map in names */
    for (const pk of city.parks) { if (!pk.name || seen.has(pk.name)) continue; let X = 0, Y = 0, A2 = 0; pk.ext.forEach((p, i) => { const q = pk.ext[(i + 1) % pk.ext.length]; X += p[0]; Y += p[1]; A2 += p[0] * q[1] - q[0] * p[1]; }); X /= pk.ext.length; Y /= pk.ext.length; if (X < B[0] || X > B[2] || Y < B[1] || Y > B[3] || (Math.abs(A2) / 2 < 4000 && !KEEP.test(pk.name))) continue; seen.add(pk.name); this.marks.push({ t: pk.name, x: X, y: Y, park: true, inPlay: X > pb[0] && X < pb[2] && Y > pb[1] && Y < pb[3] }); }
    addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) { this.full = !this.full; this.zoomF = 0; } } else if (this.full) { if (e.code === 'Escape') this.full = false; else if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1.3); else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(1 / 1.3); else if (e.code === 'Digit0') this.zoomF = 0; } }, true);
    addEventListener('wheel', (e) => { if (this.full) this.zoomBy(Math.pow(1.0016, -e.deltaY)); }, { passive: true });
  }
  // gps (progress lane): a point of the full map in HUD units -> map metres (null when the map is shut or the point is off it). gps.js handles the mouse.
  toMap(X, Y) { const v = this.view; return this.full && v && X >= v.x0 && X <= v.x1 && Y >= v.y0 && Y <= v.y1 ? [v.mx + (X - v.ox) / v.z, v.my - (Y - v.oy) / v.z] : null; }
  zoomBy(k) { const fit = this.fitZoom || 0.3; this.zoomF = Math.min(3, Math.max(fit, (this.zoomF || fit) * k)); if (this.zoomF <= fit * 1.02) this.zoomF = 0; }
  label(c, s, x, y, size, color, ang = 0, weight = 700, track = 0.5) { c.save(); c.translate(x, y); if (ang) c.rotate(ang); c.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; if ('letterSpacing' in c) c.letterSpacing = track + 'px'; c.lineWidth = Math.max(2.5, size * 0.28); c.strokeStyle = 'rgba(12,13,15,0.85)'; c.lineJoin = 'round'; c.strokeText(s, 0, 0); c.fillStyle = color; c.fillText(s, 0, 0); c.restore(); }
  arrow(c, x, y, rot, k = 1) { c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -12 * k); c.lineTo(8 * k, 9 * k); c.lineTo(0, 4.5 * k); c.lineTo(-8 * k, 9 * k); c.closePath(); c.fill(); c.stroke(); c.restore(); }
  route(c, P) { const G = this.g.gps; if (G && G.target) { if (G.trace(c, P)) { c.strokeStyle = G.color; c.stroke(); } return; }     /* gps (progress lane): the player's waypoint line instead of the job's while one is set */
    const M = this.g.missions, pl = this.g.player; if (!(M.route && M.target)) return; const r = M.route, last = r.segs.length - 1, q0 = P(pl.x, pl.y); c.beginPath(); c.moveTo(q0[0], q0[1]);
    r.segs.forEach((sg, i) => { const ln = sg.dir > 0 ? sg.e.line : sg.e.rev, from = i === 0 ? r.s0 : 0, to = i === last && r.end ? r.end.s : ln.len;
      for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 1 || ln.cum[j] >= to) continue; const q = P(ln.p[j][0], ln.p[j][1]); c.lineTo(q[0], q[1]); }
      if (i === last) { const e = ln.at(to, {}), q = P(e.x, e.y); c.lineTo(q[0], q[1]); } });
    const qt = P(M.target.x, M.target.y); c.lineTo(qt[0], qt[1]); c.stroke(); }

  // ---- the round map, bottom right. (cx, cy) its centre in HUD units; it turns with the camera
  drawMini(cx, cy) {
    const hud = this.hud, c = hud.ctx, g = this.g, R = hud.mapR, pl = g.player, yaw = g.cam.yaw, M = g.missions, B = this.box, S = this.S;
    const sp = pl.vehicle ? Math.hypot(pl.vehicle.vx, pl.vehicle.vy) : 0, want = 0.42 - 0.14 * Math.min(1, sp / 30); this.miniZ += (want - this.miniZ) * 0.04; const z = this.miniZ, rot = yaw - Math.PI / 2;
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = '#16181b'; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.translate(cx, cy); c.rotate(rot); c.scale(z / S, z / S); c.translate(-(pl.x - B[0]) * S, -(B[3] - pl.y) * S); c.imageSmoothingEnabled = true; c.drawImage(this.pic, 0, 0);
    const P = (x, y) => [(x - B[0]) * S, (B[3] - y) * S];
    c.strokeStyle = AMBER; c.lineWidth = 7 * S / z * 0.5; c.lineJoin = 'round'; c.lineCap = 'round'; this.route(c, P);
    c.fillStyle = 'rgba(255,255,255,0.45)'; for (const t of g.traffic.cars) { const q = P(t.x, t.y); c.fillRect(q[0] - 2.2, q[1] - 2.2, 4.4, 4.4); }
    c.restore();
    // names, upright, in HUD space: a map point -> screen
    const cs = Math.cos(rot), sn = Math.sin(rot), scr = (x, y) => { const dx = (x - pl.x) * z, dy = -(y - pl.y) * z; return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs]; };
    if (this.n++ % 12 === 0) { const reach = (R - 14) / z, got = new Map();     // the nearest label of each street in view
      for (const L of this.names) { const d = Math.hypot(L.x - pl.x, L.y - pl.y); if (d > reach || d < 30 / z) continue;     /* not under the arrow */ const o = got.get(L.t); if (!o || d < o.d) got.set(L.t, { L, d }); }
      this.miniLabels = [...got.values()].sort((a, b) => (b.L.ave - a.L.ave) || (a.d - b.d)).slice(0, 9).map((o) => o.L); }
    c.save(); c.beginPath(); c.arc(cx, cy, R - 2, 0, 7); c.clip();
    for (const L of this.miniLabels) { const q = scr(L.x, L.y); if (Math.hypot(q[0] - cx, q[1] - cy) > R - 20) continue; let a = -L.a + rot; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI; this.label(c, L.t, q[0], q[1], L.ave ? 12.5 : 11, L.ave ? '#ffffff' : 'rgba(255,255,255,0.82)', a, L.ave ? 800 : 600); }
    for (const k of this.marks) { if (k.area) continue; const q = scr(k.x, k.y); if (Math.hypot(q[0] - cx, q[1] - cy) > R - 24) continue; c.fillStyle = k.park ? '#7fd08a' : '#8fd3ff'; c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 7); c.fill(); this.label(c, k.t, q[0], q[1] - 12, 11.5, k.park ? '#b9f0c0' : '#cfeaff', 0, 700); }
    c.restore();
    // job marker, held on the rim when it is out of view
    if (M.target) { let [mx, my] = scr(M.target.x, M.target.y); mx -= cx; my -= cy; const d = Math.hypot(mx, my); if (d > R - 10) { mx *= (R - 10) / d; my *= (R - 10) / d; } c.fillStyle = AMBER; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(cx + mx, cy + my, 7, 0, 7); c.fill(); c.stroke(); }
    { const T = g.gps && g.gps.target; if (T) { let [mx, my] = scr(T.x, T.y); mx -= cx; my -= cy; const d = Math.hypot(mx, my); if (d > R - 10) { mx *= (R - 10) / d; my *= (R - 10) / d; } c.fillStyle = g.gps.color; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(cx + mx, cy + my, 7, 0, 7); c.fill(); c.stroke(); } }     // gps: the waypoint, held on the rim like the job's
    this.arrow(c, cx, cy, -(pl.h - yaw));
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    const nx = cx + Math.sin(rot) * R, ny = cy - Math.cos(rot) * R; c.fillStyle = '#16181b'; c.beginPath(); c.arc(nx, ny, 11, 0, 7); c.fill(); hud.text('N', nx, ny + 5, 13, '#fff', 'center', 800);
    hud.text('TAB  map', cx - R + 6, cy - R + 4, 12, 'rgba(255,255,255,0.75)', 'right', 700, 1.5);
  }

  // ---- the full-screen map: north up. W x H in HUD units (H = 1080)
  drawFull(W, H) {
    const hud = this.hud, c = hud.ctx, g = this.g, pl = g.player, M = g.missions, B = this.box, S = this.S, pb = this.play;
    c.save(); c.shadowBlur = 0; c.fillStyle = 'rgba(8,9,11,0.90)'; c.fillRect(0, 0, W, H);
    const top = 84, bot = 56, side = 60, fit = Math.min((W - 2 * side) / (pb[2] - pb[0] + 160), (H - top - bot) / (pb[3] - pb[1] + 160)); this.fitZoom = fit; const z = this.zoomF || fit, whole = !this.zoomF;
    const mx = whole ? (pb[0] + pb[2]) / 2 : pl.x, my = whole ? (pb[1] + pb[3]) / 2 : pl.y, ox = W / 2, oy = top + (H - top - bot) / 2, scr = (x, y) => [ox + (x - mx) * z, oy - (y - my) * z];
    this.view = { ox, oy, mx, my, z, x0: side / 2, y0: top - 10, x1: W - side / 2, y1: H - bot + 10 };     // gps: what toMap() needs
    c.beginPath(); c.rect(side / 2, top - 10, W - side, H - top - bot + 20); c.clip();
    const q0 = scr(B[0], B[3]); c.imageSmoothingEnabled = true; c.drawImage(this.pic, q0[0], q0[1], this.pic.width * z / S, this.pic.height * z / S);
    c.strokeStyle = AMBER; c.lineWidth = 5; c.lineJoin = 'round'; c.lineCap = 'round'; this.route(c, scr);
    // street names: avenues first, each street's labels kept apart, no two labels on top of each other
    const key = z.toFixed(3) + '|' + Math.round(mx / 40) + '|' + Math.round(my / 40) + '|' + Math.round(W);
    if (key !== this.fullKey) { this.fullKey = key; const out = [], taken = [], gap = whole ? 230 : 300, hit = (x, y, w) => taken.some((t) => Math.abs(t[0] - x) < (t[2] + w) / 2 + 6 && Math.abs(t[1] - y) < 16);
      const cand = this.names.slice().sort((a, b) => (b.ave - a.ave) || (b.len - a.len));
      for (const L of cand) { const q = scr(L.x, L.y); if (q[0] < side || q[0] > W - side || q[1] < top || q[1] > H - bot) continue; const size = L.ave ? 14 : 12, w = L.t.length * size * 0.6; if (!L.ave && L.len * z < w * 0.7) continue; if (whole && (L.x < pb[0] - 40 || L.x > pb[2] + 40 || L.y < pb[1] - 40 || L.y > pb[3] + 40)) continue;     /* the whole-map view names the playable streets only */
        if (out.some((o) => o.L.t === L.t && Math.hypot(o.q[0] - q[0], o.q[1] - q[1]) < gap) || hit(q[0], q[1], w)) continue; out.push({ L, q, size }); taken.push([q[0], q[1], w]); }
      this.fullLabels = out; }
    for (const o of this.fullLabels) { const q = scr(o.L.x, o.L.y); let a = -o.L.a; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI; this.label(c, o.L.t, q[0], q[1], o.size, o.L.ave ? '#ffffff' : 'rgba(255,255,255,0.85)', a, o.L.ave ? 800 : 600); }
    for (const k of this.marks) { const q = scr(k.x, k.y); if (q[0] < side || q[0] > W - side || q[1] < top || q[1] > H - bot) continue;
      if (k.area) { this.label(c, k.t.toUpperCase(), q[0], q[1], 13, 'rgba(255,255,255,0.42)', 0, 800, 3); continue; }
      c.globalAlpha = k.inPlay ? 1 : 0.6; c.fillStyle = k.park ? '#7fd08a' : '#8fd3ff'; c.strokeStyle = '#111'; c.lineWidth = 1.5; c.beginPath(); c.arc(q[0], q[1], 5, 0, 7); c.fill(); c.stroke(); this.label(c, k.t, q[0], q[1] - 15, k.inPlay ? 15 : 13, k.park ? '#b9f0c0' : '#cfeaff', 0, 800); c.globalAlpha = 1; }
    if (M.target) { const q = scr(M.target.x, M.target.y); c.fillStyle = AMBER; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 9, 0, 7); c.fill(); c.stroke(); this.label(c, 'JOB', q[0], q[1] - 20, 13, AMBER, 0, 800, 2); }
    { const T = g.gps && g.gps.target; if (T) { const q = scr(T.x, T.y); c.fillStyle = g.gps.color; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 9, 0, 7); c.fill(); c.stroke(); this.label(c, T.name.toUpperCase(), q[0], q[1] - 20, 13, g.gps.color, 0, 800, 1.5); } }     // gps: the waypoint
    { const q = scr(pl.x, pl.y); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 20 + 4 * Math.sin(performance.now() / 300), 0, 7); c.stroke(); this.arrow(c, q[0], q[1], Math.PI / 2 - pl.h, 1.35); this.label(c, 'YOU', q[0], q[1] + 30, 13, '#fff', 0, 800, 2); }
    c.restore(); c.save(); c.shadowBlur = 0;
    hud.text('CITY MAP', side, 52, 30, '#fff', 'left', 800, 6); hud.text(g.hud && g.hud.street ? String(g.hud.street).toUpperCase() : '', side + 240, 51, 18, AMBER, 'left', 700, 2);
    hud.text('CLICK  set waypoint      RIGHT-CLICK  clear      TAB  close      SCROLL or + / -  zoom      0  whole map', W - side, 51, 14, 'rgba(255,255,255,0.75)', 'right', 700, 1.5);
    const nx = W - side - 22, ny = top + 34; c.fillStyle = 'rgba(12,13,15,0.78)'; c.beginPath(); c.arc(nx, ny, 22, 0, 7); c.fill(); hud.text('N', nx, ny + 15, 13, '#fff', 'center', 800); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(nx, ny - 16); c.lineTo(nx + 6, ny - 2); c.lineTo(nx - 6, ny - 2); c.closePath(); c.fill();
    const bar = 200, px = bar * z; c.fillStyle = '#fff'; c.fillRect(side, H - 30, px, 3); hud.text('200 m', side + px + 10, H - 24, 13, 'rgba(255,255,255,0.8)', 'left', 700);
    c.restore();
  }
}
