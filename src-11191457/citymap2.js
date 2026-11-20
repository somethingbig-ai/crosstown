// citymap2.js (gameplay lane, map helper, Nov 17; Matt: "The map should look way better").
// The city map redrawn as a styled street map, from the same data as citymap.js (city.json: blocks, parks, water, buildings, named road edges):
//   land, park green, water blue, building footprints a shade off the land, avenues and wide cross streets tinted, street names along the
//   streets, landmarks, parks, neighbourhood names, subway stations (when the subway's data is loaded), police, the job, the waypoint,
//   a blue heading arrow, north. A light map by day and a dark one at night (?mapstyle=day | night pins one).
//   MINIMAP: turns with the camera as before. FULL MAP (Tab): north up; wheel zooms about the cursor (smoothly), drag pans, pinch and
//   one-finger drag on a touch screen, + / - zoom, 0 = the whole map. A click (without a drag) sets the waypoint as before (gps.js).
// Cost: the picture is never redrawn per frame. A whole-map picture (at most 2600 px a side) is made once per palette; closer zooms
// come from 512 px tiles made on demand (at most ~4 ms of tile making a frame, kept in a 56-tile cache), so zooming in stays sharp.
// ?map2=0 = the map as it was (citymap.js). The class has the same members hud.js, gps.js, menu.js, combat.js and hints.js use.
import { LANDMARKS, LANDMARKS_SOUTH, LANDMARKS_SOUTH2, LANDMARKS_SOUTH3, short } from './citymap.js';
const AMBER = '#ffb82e', FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif', TILE = 512, LEVELS = [0.5, 1, 2, 3.2], CELL = 250;
// uptown and Brooklyn: typed, then each checked against the map's own data (named buildings, parks, streets, hero rows: within 20 m, or moved onto
// the data's building); names the data carries itself (its named parks) and places the maps do not hold (the bridges' spans, the Navy Yard) are not listed
const LANDMARKS_NORTH = [['Metropolitan Museum', 40.77955, -73.96371], ['Natural History Museum', 40.78103, -73.97429], ['Guggenheim', 40.7830, -73.9590], ['Columbia University', 40.8075, -73.9626], ['Apollo Theater', 40.8100, -73.9500],
  ['St John the Divine', 40.8038, -73.9619], ['Harlem', 40.8120, -73.9440], ['Upper West Side', 40.7890, -73.9780], ['Upper East Side', 40.7736, -73.9566], ['The Dakota', 40.7766, -73.9762], ['Bethesda Terrace', 40.7740, -73.9708],
  ['The Reservoir', 40.7850, -73.9627], ['Great Lawn', 40.7812, -73.9665], ['Belvedere Castle', 40.7794, -73.9690], ['Morningside Park', 40.8058, -73.9585], ['Riverside Park', 40.8010, -73.9720], ['Gracie Mansion', 40.7761, -73.9431],
  ['Central Park Zoo', 40.7678, -73.9718], ['Harlem Meer', 40.7965, -73.9517], ['East Harlem', 40.7957, -73.9389], ['Yorkville', 40.7772, -73.9500], ['Lenox Hill', 40.7662, -73.9602]];
const LANDMARKS_BK = [['DUMBO', 40.7033, -73.9881], ['Brooklyn Heights', 40.6960, -73.9950],
  ['Vinegar Hill', 40.7037, -73.9823], ["Jane's Carousel", 40.7044, -73.9923], ['Downtown Brooklyn', 40.6930, -73.9870], ['Fulton Ferry Landing', 40.7032, -73.9955]];
const AREAS = /Koreatown|District|Murray Hill|Chelsea$|NoMad|Kips Bay|Hudson Yards|Greenwich Village|West Village|Stuyvesant Town|^SoHo$|^NoHo$|East Village|Lower East Side|Nolita|Little Italy|Hudson Square|Alphabet City|Chinatown|Tribeca|Battery Park City|Civic Center|Two Bridges|^Harlem$|Upper West Side|Upper East Side|East Harlem|Yorkville|Lenox Hill|^DUMBO$|Brooklyn Heights|Vinegar Hill|Downtown Brooklyn|Hell's Kitchen/;
const GREEN = /Park$|Great Lawn|Reservoir|Meer|Zoo|High Line|Little Island|Bowling Green/;
const PAL = {
  day: { road: '#ffffff', ave: '#ffe7a0', major: '#fff3cc', land: '#ebe7df', curb: '#d3cdc1', bld: '#dad3c5', bldE: '#c6beae', park: '#bfe2a8', parkE: '#98cc82', water: '#9ccaee', waterE: '#79b0dd', dim: 'rgba(110,116,128,0.22)',
    tSt: '#565b66', tAve: '#23272e', halo: 'rgba(255,255,255,0.94)', tArea: 'rgba(52,60,78,0.62)', tLm: '#1f4f8f', tPark: '#2b6b33', tWater: '#3c78ad', dot: '#2f6fd0', car: 'rgba(60,66,78,0.55)', ring: '#f4f5f7', back: 'rgba(14,16,20,0.93)', edge: 'rgba(70,76,90,0.6)' },
  night: { road: '#485364', ave: '#a08a52', major: '#66728a', land: '#222a36', curb: '#19202a', bld: '#2c3644', bldE: '#394556', park: '#1e4b38', parkE: '#2c6349', water: '#173f6b', waterE: '#2c6396', dim: 'rgba(6,8,12,0.5)',
    tSt: '#bcc5d2', tAve: '#f6e7c1', halo: 'rgba(14,18,24,0.92)', tArea: 'rgba(214,224,240,0.6)', tLm: '#a6d4ff', tPark: '#93dfa0', tWater: '#93c6f0', dot: '#8fc4ff', car: 'rgba(255,255,255,0.3)', ring: '#e8eaee', back: 'rgba(8,9,11,0.93)', edge: 'rgba(255,255,255,0.5)' } };
const ROUTE = { 1: '#ee352e', 2: '#ee352e', 3: '#ee352e', 4: '#00933c', 5: '#00933c', 6: '#00933c', 7: '#b933ad', A: '#0039a6', C: '#0039a6', E: '#0039a6', B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319', N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a', L: '#a7a9ac', S: '#808183', G: '#6cbe45', J: '#996633', Z: '#996633' };
const ring = (x, p) => { x.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]); x.closePath(); };
const line = (x, p) => { x.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export class CityMap {
  constructor(game, hud) {
    this.g = game; this.hud = hud; this.full = false; this.zoomF = 0; this.miniZ = 0.42; this.n = 0; this.miniLabels = []; this.miniMarks = []; this.takesHeat = true; this.heat = null; this.pan2 = true; this.moved = false; this.spr = new Map(); this.layN = 0; this.N2 = !(game.P && game.P.get('mapnames') === '0');     // handover-3: the minimap's naming rule (own street + cross street first); ?mapnames=0 = the rule before it
    const city = game.city, M0 = city.meta, pb = M0.play || [-M0.px, -M0.py, M0.px, M0.py], mgx = M0.hx - M0.px, mgy = M0.hy - M0.py, P = game.P;
    const B = (this.box = [pb[0] - mgx, pb[1] - mgy, pb[2] + mgx, pb[3] + mgy]); this.play = pb; this.S = 1;
    { const fx = Math.min(mgx, 0.15 * (pb[2] - pb[0]) + 80), fy = Math.min(mgy, 0.15 * (pb[3] - pb[1]) + 80); this.fr = [pb[0] - fx, pb[1] - fy, pb[2] + fx, pb[3] + fy]; }     // what the full map's frame shows: on a small map with a wide margin (Brooklyn) the frame hugs the map
    this.style = P && /^(day|night)$/.test(P.get('mapstyle') || '') ? P.get('mapstyle') : null;
    // everything the picture is made of, with its bounds, in a grid of 250 m cells. k is the drawing order.
    this.grid = new Map(); this.stamp = 0; let id = 0;
    const add = (k, o, pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const pad = k === 1 ? (o.width || 12) : 2, it = { k, o, s: 0, id: id++ };
      for (let i = Math.floor((x0 - pad) / CELL); i <= Math.floor((x1 + pad) / CELL); i++) for (let j = Math.floor((y0 - pad) / CELL); j <= Math.floor((y1 + pad) / CELL); j++) { const key = i + ',' + j; let a = this.grid.get(key); if (!a) this.grid.set(key, (a = [])); a.push(it); } };
    if (city.water && !(P && P.get('water') === '0')) for (const w of city.water) if (w.poly && w.poly.length > 2) add(4, w, w.poly);
    const aveN = new Set(); for (const e of city.edges) if (e.ave && e.name) aveN.add(e.name);     // an avenue is an avenue along its whole length (one area's data flags it, the next area's may not)
    for (const e of city.edges) if (e.pts && e.pts.length > 1) { e._c = e.ave || aveN.has(e.name) || /Broadway|Bowery/.test(e.name || '') ? 2 : (e.width || 0) >= 17 ? 1 : 0; add(1, e, e.pts); }
    for (const b of city.blocks) add(2, b, b.ext);
    for (const w of city.waterPiers || []) if (w.poly && w.poly.length > 2) add(5, { ext: w.poly }, w.poly);
    for (const b of city.parks) add(3, b, b.ext);
    for (const b of city.buildings) if (!(b.minh > 0) && b.poly && b.poly.length > 2) add(6, b, b.poly);
    this.S0 = Math.min(0.5, 2600 / Math.max(B[2] - B[0], B[3] - B[1])); this.bases = {}; this.tiles = new Map(); this.pool = []; this.tB = 0; this.tMs = 0; this.made = 0;
    this.base(this.pal());
    // street-name candidates: one per named edge of some length, at its middle, with the street's direction there (as citymap.js)
    this.names = [];
    for (const e of city.edges) { if (!e.name || e.len < 50) continue; const p = e.pts; let half = e.len / 2, i = 1, acc = 0; for (; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (acc + l >= half) break; acc += l; } i = Math.min(i, p.length - 1);
      const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1, t = (half - acc) / l; this.names.push({ t: short(e.name), c: e._c, ave: e._c === 2, x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, y: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, a: Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), len: e.len }); }
    // landmarks: the lists, where they fall inside the picture, the named parks of some size, and the rivers
    const KX = Math.cos(M0.lat0 * Math.PI / 180) * 111320, KY = 110574; this.marks = [];
    const L = LANDMARKS.concat(LANDMARKS_NORTH, LANDMARKS_BK, pb[1] < -600 ? LANDMARKS_SOUTH : [], pb[1] < -1800 ? LANDMARKS_SOUTH2 : [], pb[1] < -3000 ? LANDMARKS_SOUTH3 : []), seen = new Set(), inP = (X, Y) => X > pb[0] && X < pb[2] && Y > pb[1] && Y < pb[3];
    for (const [n, la, lo] of L) { const X = (lo - M0.lon0) * KX, Y = (la - M0.lat0) * KY; if (seen.has(n) || !(X > B[0] + 20 && X < B[2] - 20 && Y > B[1] + 20 && Y < B[3] - 20)) continue; seen.add(n); this.marks.push({ t: n, x: X, y: Y, area: AREAS.test(n), park: GREEN.test(n), inPlay: inP(X, Y) }); }
    const KEEP = /^(Bryant Park|Madison Square Park|Greeley Square Park|Gramercy Park)$/, big = new Map();
    for (const pk of city.parks) { if (!pk.name || /Public Space|Plaza$|&/.test(pk.name)) continue; let X = 0, Y = 0, A2 = 0; pk.ext.forEach((p, i) => { const q = pk.ext[(i + 1) % pk.ext.length]; X += p[0]; Y += p[1]; A2 += p[0] * q[1] - q[0] * p[1]; }); X /= pk.ext.length; Y /= pk.ext.length; const A = Math.abs(A2) / 2;
      if (X < B[0] || X > B[2] || Y < B[1] || Y > B[3] || (A < 4000 && !KEEP.test(pk.name))) continue; const o = big.get(pk.name), T = (o ? o.T : 0) + A, sx = (o ? o.sx : 0) + X * A, sy = (o ? o.sy : 0) + Y * A; big.set(pk.name, !o || A > o.A ? { A, X, Y, T, sx, sy } : Object.assign(o, { T, sx, sy })); }     // a park in several pieces is named once, on its largest piece
    for (const [n, o] of big) { const bg = o.T > 400000, X = bg ? o.sx / o.T : o.X, Y = bg ? o.sy / o.T : o.Y; const old = seen.has(n) && this.marks.find((m) => m.t === n); if (old) { if (bg) Object.assign(old, { x: X, y: Y, park: true, big: true, inPlay: inP(X, Y) }); } else if (!seen.has(n)) this.marks.push({ t: n, x: X, y: Y, park: true, big: bg, inPlay: inP(X, Y) }); }     // a great park (Central Park: 23 pieces) is named once, in large letters, at the middle of all its pieces
    // rivers: a name goes only where its whole box lies on water that is drawn. A coarse picture (16 m cells) of each named water, less the piers and the buildings
    // painted over it, as a summed table; layout() looks for a place in the view (river()). No place, no name.
    this.wm = null; { const names = [...new Set((city.water || []).filter((w) => w.name && w.poly && w.poly.length > 2).map((w) => w.name))].slice(0, 6);     // the picture is made at the first whole-map view (mkWater()), so the load does not pay for it
      if (names.length && !(P && P.get('water') === '0')) { this.wm = undefined; this.wn = names; names.forEach((t, n) => this.marks.push({ t, x: 0, y: 0, water: true, inPlay: true, wi: n })); } }
    // as citymap.js since fac078f (downtown lane, d19e): on a map whose areas do not fill its box (the Battery map, rows C / D) a landmark or park name is kept only inside an area,
    // and the whole-map view names only the streets inside one. ?mapclip=0 = as before. Any other map: nothing changes.
    { const SS = (M0.sets || []).filter((s) => s.play); this.inAreas = SS.some((s) => /^d[CD]-/.test(s.set || '')) && !(P && P.get('mapclip') === '0') ? (x, y, m = 0) => SS.some((s) => x > s.play[0] - m && x < s.play[2] + m && y > s.play[1] - m && y < s.play[3] + m) : null; if (this.inAreas) this.marks = this.marks.filter((m) => m.water || this.inAreas(m.x, m.y)); }
    this.zc = 0; this.zt = 0; this.cx = this.tx = (pb[0] + pb[2]) / 2; this.cy = this.ty = (pb[1] + pb[3]) / 2; this.wasFull = false;
    addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) { this.full = !this.full; this.zoomF = 0; } } else if (this.full) { if (e.code === 'Escape') this.full = false; else if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1.5); else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(1 / 1.5); else if (e.code === 'Digit0') this.whole(); } }, true);
    const XY = (e) => { const c = hud.canvas, r = c.getBoundingClientRect(), k = hud.k || 1; return [((e.clientX - r.left) * (c.width / (r.width || 1))) / k, ((e.clientY - r.top) * (c.height / (r.height || 1))) / k]; };
    addEventListener('wheel', (e) => { if (this.full) { const q = XY(e); this.zoomBy(Math.pow(1.0022, -e.deltaY), q[0], q[1]); } }, { passive: true });
    // drag to pan (mouse), one finger to pan and two to pinch (touch). gps.js sets the waypoint on mouse-up when this.moved is false.
    let last = null; const pts = new Map(); let pinch = 0;
    addEventListener('mousedown', (e) => { if (!this.full || e.button !== 0) return; this.moved = false; last = XY(e); this.d0 = last; }, true);
    addEventListener('mousemove', (e) => { if (!this.full || !last || !(e.buttons & 1)) { last = null; return; } const q = XY(e); if (!this.moved && Math.hypot(q[0] - this.d0[0], q[1] - this.d0[1]) < 6) return; this.moved = true; this.panBy(q[0] - last[0], q[1] - last[1]); last = q; }, true);
    addEventListener('mouseup', () => { last = null; }, true);
    addEventListener('pointerdown', (e) => { if (this.full && e.pointerType === 'touch') { pts.set(e.pointerId, XY(e)); pinch = 0; } }, true);
    addEventListener('pointermove', (e) => { if (!this.full || e.pointerType !== 'touch' || !pts.has(e.pointerId)) return; const q = XY(e), o = pts.get(e.pointerId); pts.set(e.pointerId, q);
      if (pts.size === 1) this.panBy(q[0] - o[0], q[1] - o[1]); else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch > 0 && d > 0) this.zoomBy(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = d; } }, true);
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => { pts.delete(e.pointerId); pinch = 0; }, true);
  }
  pal() { if (this.style) return this.style; const N = this.g.night; return N && N.active && N.n > 0.5 ? 'night' : 'day'; }
  // ---- the picture
  query(x0, y0, x1, y1) { const out = [], s = ++this.stamp; for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) { const a = this.grid.get(i + ',' + j); if (a) for (const it of a) if (it.s !== s) { it.s = s; out.push(it); } }
    return out.sort((a, b) => (a.k - b.k) || (a.id - b.id)); }
  // paints the map of one palette into a canvas: (wx0, wy1) = the world point of its top left corner, S = pixels per metre
  paint(cv, wx0, wy1, S, pal) {
    const x = cv.getContext('2d'), w = cv.width, h = cv.height, p = PAL[pal], pb = this.play, items = this.query(wx0 - 4, wy1 - h / S - 4, wx0 + w / S + 4, wy1 + 4), px = 1 / S;
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = p.land; x.fillRect(0, 0, w, h); x.setTransform(S, 0, 0, -S, -wx0 * S, wy1 * S); x.lineJoin = 'round'; x.lineCap = 'round';
    let i = 0; const n = items.length;
    const e0 = i; let e1 = i; while (e1 < n && items[e1].k === 1) e1++;
    // roadway: a casing, then the road, then the tint of avenues and wide streets; the blocks painted after trim them to the kerbs
    x.strokeStyle = p.curb; for (i = e0; i < e1; i++) { const e = items[i].o; x.lineWidth = (e.width || 12) + 7 + 2 * px; x.beginPath(); line(x, e.pts); x.stroke(); }
    x.strokeStyle = p.road; for (i = e0; i < e1; i++) { const e = items[i].o; x.lineWidth = (e.width || 12) + 7; x.beginPath(); line(x, e.pts); x.stroke(); }
    for (const c of [1, 2]) { x.strokeStyle = c === 2 ? p.ave : p.major; for (i = e0; i < e1; i++) { const e = items[i].o; if (e._c !== c) continue; x.lineWidth = (e.width || 12) + 7; x.beginPath(); line(x, e.pts); x.stroke(); } }
    x.fillStyle = p.land; x.strokeStyle = p.curb; x.lineWidth = Math.max(0.8, px); for (i = e1; i < n && items[i].k === 2; i++) { const b = items[i].o; x.beginPath(); ring(x, b.ext); for (const hh of b.holes || []) ring(x, hh); x.fill('evenodd'); x.stroke(); }
    x.fillStyle = p.park; x.strokeStyle = p.parkE; x.lineWidth = Math.max(1, px); for (; i < n && items[i].k === 3; i++) { const b = items[i].o; x.beginPath(); ring(x, b.ext); for (const hh of b.holes || []) ring(x, hh); x.fill('evenodd'); x.stroke(); }
    // water after the blocks and parks, as citymap.js paints it (the river-side areas' blocks reach over the river), then the piers
    x.fillStyle = p.water; x.strokeStyle = p.waterE; x.lineWidth = Math.max(1.5, 2 * px); for (; i < n && items[i].k === 4; i++) { x.beginPath(); ring(x, items[i].o.poly); x.fill(); x.stroke(); }
    x.fillStyle = p.land; x.strokeStyle = p.curb; x.lineWidth = Math.max(0.8, px); for (; i < n && items[i].k === 5; i++) { x.beginPath(); ring(x, items[i].o.ext); x.fill(); x.stroke(); }
    x.fillStyle = p.bld; x.strokeStyle = p.bldE; x.lineWidth = Math.max(0.5, px * 0.9); const edge = S >= 0.9; for (; i < n; i++) { x.beginPath(); ring(x, items[i].o.poly); x.fill(); if (edge) x.stroke(); }
    // outside the playable box: dimmed, with the box's edge dashed
    x.fillStyle = p.dim; const X0 = wx0 - 9, X1 = wx0 + w / S + 9, Y0 = wy1 - h / S - 9, Y1 = wy1 + 9; x.fillRect(X0, pb[3], X1 - X0, Y1 - pb[3]); x.fillRect(X0, Y0, X1 - X0, pb[1] - Y0); x.fillRect(X0, pb[1], pb[0] - X0, pb[3] - pb[1]); x.fillRect(pb[2], pb[1], X1 - pb[2], pb[3] - pb[1]);
    x.strokeStyle = p.edge; x.lineWidth = Math.max(1.5, 2 * px); x.lineCap = 'butt'; x.strokeRect(pb[0], pb[1], pb[2] - pb[0], pb[3] - pb[1]);
  }
  base(pal) { let b = this.bases[pal]; if (!b) { const B = this.box, S = this.S0; b = this.bases[pal] = { cv: mk(Math.ceil((B[2] - B[0]) * S), Math.ceil((B[3] - B[1]) * S)), S }; this.paint(b.cv, B[0], B[3], S, pal); } return b; }
  // draws the map into a context whose unit is 1 m, x east, y SOUTH, origin at the world's origin. (x0, y0, x1, y1): the world box in view; need: device pixels per metre
  blit(c, x0, y0, x1, y1, need) {
    const pal = this.pal(), b = this.base(pal), B = this.box; c.imageSmoothingEnabled = true; x0 = Math.max(x0, B[0]); y0 = Math.max(y0, B[1]); x1 = Math.min(x1, B[2]); y1 = Math.min(y1, B[3]); if (x1 <= x0 || y1 <= y0) return;
    const drawBase = () => { const sx = Math.max(0, Math.floor((x0 - B[0]) * b.S) - 2), sy = Math.max(0, Math.floor((B[3] - y1) * b.S) - 2), sw = Math.min(b.cv.width - sx, Math.ceil((x1 - x0) * b.S) + 4), sh = Math.min(b.cv.height - sy, Math.ceil((y1 - y0) * b.S) + 4); if (sw > 0 && sh > 0) c.drawImage(b.cv, sx, sy, sw, sh, B[0] + sx / b.S, -B[3] + sy / b.S, sw / b.S, sh / b.S); };     // the part in view only
    if (need <= b.S * 1.2) { drawBase(); return; }
    const Lv = LEVELS.find((l) => l >= need * 0.7) || LEVELS[LEVELS.length - 1], span = TILE / Lv, i0 = Math.floor(x0 / span), i1 = Math.floor(x1 / span), j0 = Math.floor(y0 / span), j1 = Math.floor(y1 / span), got = []; let miss = false;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = pal + Lv + ':' + i + ':' + j; let t = this.tiles.get(key);
      if (t) { this.tiles.delete(key); this.tiles.set(key, t); } else if (!this.made || this.tMs < 4) { const t0 = performance.now(); t = this.pool.pop() || mk(TILE, TILE); this.paint(t, i * span, (j + 1) * span, Lv, pal); this.tiles.set(key, t); this.made++; this.tMs += performance.now() - t0;
        if (this.tiles.size > 56) { const k0 = this.tiles.keys().next().value; this.pool.push(this.tiles.get(k0)); this.tiles.delete(k0); } }
      if (t) got.push(t, i, j); else miss = true; }
    if (miss) drawBase(); const ov = 0.6 / need;
    for (let k = 0; k < got.length; k += 3) c.drawImage(got[k], got[k + 1] * span, -(got[k + 2] + 1) * span, span + ov, span + ov);
  }
  // ---- the full map's view
  toMap(X, Y) { const v = this.view; return this.full && v && X >= v.x0 && X <= v.x1 && Y >= v.y0 && Y <= v.y1 ? [v.mx + (X - v.ox) / v.z, v.my - (Y - v.oy) / v.z] : null; }
  whole() { const pb = this.play; this.zt = 0; this.tx = (pb[0] + pb[2]) / 2; this.ty = (pb[1] + pb[3]) / 2; }
  clampT() { const B = this.box; this.tx = Math.min(B[2], Math.max(B[0], this.tx)); this.ty = Math.min(B[3], Math.max(B[1], this.ty)); }
  // k: factor. (sx, sy): the HUD point that stays put (the cursor); without one, a zoom in from the whole map goes to the player
  zoomBy(k, sx, sy) { const fit = this.fitZoom || 0.3, v = this.view, z0 = this.zt || fit, z1 = Math.min(3.2, Math.max(fit, z0 * k)); if (z1 === z0) return;
    if (sx !== undefined && v) { const wx = this.tx + (sx - v.ox) / z0, wy = this.ty - (sy - v.oy) / z0; this.tx = wx - (sx - v.ox) / z1; this.ty = wy + (sy - v.oy) / z1; } else if (!this.zt && k > 1) { this.tx = this.g.player.x; this.ty = this.g.player.y; }
    this.zt = z1; if (z1 <= fit * 1.02) this.whole(); else this.clampT(); }
  panBy(dx, dy) { const z = this.zc || this.fitZoom || 0.3; if (!this.zt) this.zt = z; this.tx -= dx / z; this.ty += dy / z; this.cx -= dx / z; this.cy += dy / z; this.clampT(); this.cx = Math.min(this.box[2], Math.max(this.box[0], this.cx)); this.cy = Math.min(this.box[3], Math.max(this.box[1], this.cy)); }
  text0(c, s, size, color, weight, track, halo) { c.font = `${weight} ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; if ('letterSpacing' in c) c.letterSpacing = track + 'px'; c.lineWidth = Math.max(3, size * 0.3); c.strokeStyle = halo || PAL[this.pal()].halo; c.lineJoin = 'round'; c.strokeText(s, 0, 0); c.fillStyle = color; c.fillText(s, 0, 0); }
  label(c, s, x, y, size, color, ang = 0, weight = 700, track = 0.5, halo = null) { c.save(); c.translate(x, y); if (ang) c.rotate(ang); this.text0(c, s, size, color, weight, track, halo); c.restore(); }
  // the same name from a small picture made once (the round map's names turn every frame: a picture is far cheaper than stroked text)
  labelS(c, s, x, y, size, color, ang = 0, weight = 700, track = 0.5) { const k = this.hud.k || 1, key = this.pal() + '|' + s + '|' + size + '|' + color + '|' + weight + '|' + k; let t = this.spr.get(key);
    if (!t) { if (this.spr.size > 240) this.spr.clear(); c.save(); c.font = `${weight} ${size}px ${FONT}`; if ('letterSpacing' in c) c.letterSpacing = track + 'px'; const w = Math.ceil(c.measureText(s).width + size + 10), h = Math.ceil(size * 1.5 + 8); c.restore();
      const cv = mk(Math.ceil(w * k), Math.ceil(h * k)), x2 = cv.getContext('2d'); x2.scale(k, k); x2.translate(w / 2, h / 2); this.text0(x2, s, size, color, weight, track, null); t = { cv, w, h }; this.spr.set(key, t); }
    c.save(); c.translate(x, y); if (ang) c.rotate(ang); c.drawImage(t.cv, -t.w / 2, -t.h / 2, t.w, t.h); c.restore(); }
  // the player: a blue chevron with a white edge on a soft disc, pointing along the heading
  arrow(c, x, y, rot, k = 1) { c.save(); c.translate(x, y); c.fillStyle = 'rgba(47,125,246,0.22)'; c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 17 * k, 0, 7); c.fill(); c.stroke(); c.rotate(rot); c.lineJoin = 'round';
    c.beginPath(); c.moveTo(0, -13 * k); c.lineTo(9 * k, 9.5 * k); c.lineTo(0, 4.5 * k); c.lineTo(-9 * k, 9.5 * k); c.closePath(); c.strokeStyle = 'rgba(10,20,40,0.55)'; c.lineWidth = 6.5; c.stroke(); c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.stroke(); c.fillStyle = '#1f6fee'; c.fill(); c.restore(); }
  // a map pin: the job (amber) and the waypoint (gps's colour)
  pin(c, x, y, col, k = 1) { c.save(); c.translate(x, y); c.scale(k, k); c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-3, -7, -9, -10, -9, -17); c.arc(0, -17, 9, Math.PI, 0); c.bezierCurveTo(9, -10, 3, -7, 0, 0); c.closePath(); c.fillStyle = col; c.strokeStyle = '#14161a'; c.lineWidth = 2.2; c.lineJoin = 'round'; c.stroke(); c.fill(); c.fillStyle = '#14161a'; c.beginPath(); c.arc(0, -17, 3.4, 0, 7); c.fill(); c.restore(); }
  station(c, x, y, r) { c.fillStyle = '#ffffff'; c.strokeStyle = '#14161a'; c.lineWidth = r * 0.55; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); }
  stations() { if (this.st) return this.st; const d = this.g.subway && this.g.subway.data; if (!d || !d.stations) return []; const B = this.box, st = d.stations.filter((s) => typeof s.cx === 'number' && typeof s.cy === 'number' && s.cx > B[0] && s.cx < B[2] && s.cy > B[1] && s.cy < B[3]); if (st.length) this.st = st; return st; }
  // P: world -> the context's coordinates. Draws the route's line (the waypoint's when one is set, else the job's): a dark casing under a bright line
  route(c, P, w) { const G = this.g.gps; let col = AMBER;
    if (G && G.target) { if (!G.trace(c, P)) return; col = G.color; }
    else { const M = this.g.missions, pl = this.g.player; if (!(M.route && M.target)) return; const r = M.route, last = r.segs.length - 1, q0 = P(pl.x, pl.y); c.beginPath(); c.moveTo(q0[0], q0[1]);
      r.segs.forEach((sg, i) => { const ln = sg.dir > 0 ? sg.e.line : sg.e.rev, from = i === 0 ? r.s0 : 0, to = i === last && r.end ? r.end.s : ln.len;
        for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 1 || ln.cum[j] >= to) continue; const q = P(ln.p[j][0], ln.p[j][1]); c.lineTo(q[0], q[1]); }
        if (i === last) { const e = ln.at(to, {}), q = P(e.x, e.y); c.lineTo(q[0], q[1]); } });
      const qt = P(M.target.x, M.target.y); c.lineTo(qt[0], qt[1]); }
    c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = 'rgba(16,18,22,0.85)'; c.lineWidth = w * 1.55; c.stroke(); c.strokeStyle = col; c.lineWidth = w; c.stroke(); }
  // police, in a context whose unit is 1 m (y south): the search area, cars, officers. u = metres per HUD unit there (marker sizes stay constant on screen)
  police(c, u) { const H = this.heat; if (!H || (!H.level && !(H.cops && H.cops.length) && !(H.cars && H.cars.length))) return;
    if (H.level > 0 && H.lkp && this.heatR) { const seen = H.seen; c.fillStyle = seen ? 'rgba(255,60,44,0.16)' : 'rgba(255,170,30,0.16)'; c.beginPath(); c.arc(H.lkp.x, -H.lkp.y, this.heatR, 0, 7); c.fill(); c.strokeStyle = seen ? 'rgba(235,50,36,0.95)' : 'rgba(240,150,20,0.95)'; c.lineWidth = 2 * u; c.setLineDash(seen ? [] : [6 * u, 5 * u]); c.stroke(); c.setLineDash([]); }
    const bl = Math.floor((H.t || 0) * 3) % 2 === 0;
    for (const v of H.cars || []) { if (v.wreck || v.left) continue; c.save(); c.translate(v.x, -v.y); c.rotate(-v.h); c.scale(u, u); c.fillStyle = '#0b0c0e'; c.fillRect(-7, -4.5, 14, 9); c.fillStyle = H.level && bl ? '#ff4a3a' : '#3f8cff'; c.fillRect(-5.4, -3, 10.8, 6); c.fillStyle = '#fff'; c.fillRect(-1, -3, 2, 6); c.restore(); }
    for (const k of H.cops || []) { if (k.hp <= 0) continue; c.fillStyle = '#0b0c0e'; c.beginPath(); c.arc(k.x, -k.y, 5 * u, 0, 7); c.fill(); c.fillStyle = k.see ? '#ff5a48' : '#4f96ff'; c.beginPath(); c.arc(k.x, -k.y, 3.6 * u, 0, 7); c.fill(); } }

  // ---- the round map, bottom right. (cx, cy) its centre in HUD units; it turns with the camera
  drawMini(cx, cy) {
    const hud = this.hud, c = hud.ctx, g = this.g, R = hud.mapR, pl = g.player, yaw = g.cam.yaw, M = g.missions, p = PAL[this.pal()], k = hud.k || 1;
    if (!this.full) this.wasFull = false;
    { const H = g.__horn; if (H && typeof H.pad === 'number') { const sw = this.full && !(g.P && g.P.get('padmap') === '0'); if (sw && H.pad >= 0) { this.hornPad = H.pad; H.pad = -1; } else if (!sw && H.pad < 0 && this.hornPad >= 0) H.pad = this.hornPad; } }     // handover-3: with this map open the pad is the map's, so horn.js (if it is in) is given no pad button to read (L3 does not honk); put back as the map shuts. The G key is untouched
    this.made = 0; this.tMs = 0;     // a new frame: the tile budget starts again (the full map draws after this one)
    const sp = pl.vehicle ? Math.hypot(pl.vehicle.vx, pl.vehicle.vy) : 0, want = 0.42 - 0.14 * Math.min(1, sp / 30); this.miniZ += (want - this.miniZ) * 0.04; const z = this.miniZ, rot = yaw - Math.PI / 2, rw = R / z;
    c.save(); c.shadowBlur = 0; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = p.land; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.translate(cx, cy); c.rotate(rot); c.scale(z, z); c.translate(-pl.x, pl.y);
    this.blit(c, pl.x - rw, pl.y - rw, pl.x + rw, pl.y + rw, z * k);
    const P = (x, y) => [x, -y]; this.route(c, P, 5.5 / z);
    c.fillStyle = p.car; const cs2 = 1.5 / z; for (const t of g.traffic.cars) c.fillRect(t.x - cs2, -t.y - cs2, 2 * cs2, 2 * cs2);
    for (const s of this.stations()) if (Math.hypot(s.cx - pl.x, s.cy - pl.y) < rw) this.station(c, s.cx, -s.cy, 4.2 / z);
    this.police(c, 1 / z);
    c.restore();
    // names, upright, in HUD space: a map point -> screen
    const cs = Math.cos(rot), sn = Math.sin(rot), scr = (x, y) => { const dx = (x - pl.x) * z, dy = -(y - pl.y) * z; return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs]; };
    // a street's name as a segment in map pixels about the player (the map turns about him, so this does not change as the camera turns): its ends' and nearest point's distance from the centre
    const seg = (L) => { const hw = (L.t.length * (L.ave ? 7.4 : 6.3) + 8) / 2, dx = (L.x - pl.x) * z, dy = (L.y - pl.y) * z, ux = Math.cos(L.a), uy = Math.sin(L.a), t = Math.max(-hw, Math.min(hw, -(dx * ux + dy * uy)));
      return { L, dx, dy, ux, uy, hw, gap: Math.hypot(Math.max(0, Math.abs(dx * ux + dy * uy) - hw), Math.max(0, Math.abs(dx * uy - dy * ux) - 6.5)), d: Math.hypot(dx, dy), near: Math.hypot(dx + ux * t, dy + uy * t), far: Math.max(Math.hypot(dx + ux * hw, dy + uy * hw), Math.hypot(dx - ux * hw, dy - uy * hw)) }; };
    if (this.n++ % 12 === 0) { const reach = (R - 22) / z, got = new Map();     // the main tree's rule: the nearest label of each street in view, few of them, avenues first;
      // of a street's labels one that lies whole inside the rim and clear of the arrow is taken before one that does not (fit), so a name is cut only when the street has no label that fits
      for (const L of this.names) { const d = Math.hypot(L.x - pl.x, L.y - pl.y); if (d > reach || d < 52 / z) continue; const s = seg(L), fit = s.far <= R - 3 && s.near >= 18 ? 1 : 0, o = got.get(L.t); if (!o || fit > o.fit || (fit === o.fit && d < o.d)) got.set(L.t, { L, d, fit }); }
      this.miniLabels = [...got.values()].sort((a, b) => (b.L.c - a.L.c) || (a.d - b.d)).slice(0, this.pal() === 'night' ? 4 : 5).map((o) => o.L);
      this.miniMarks = this.marks.filter((m) => { const d = Math.hypot(m.x - pl.x, m.y - pl.y); return !m.area && !m.water && !m.big && d < reach && d > 44 / z; }).sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y)).slice(0, 2);
      if (this.N2) { const got = new Map(), prev = this.miniPrev;
      // THE RULE (handover-3): the street the player is on and the nearest street across it are always named; avenues are placed first and the two forced names push out what lies
      // in their way; then the nearest streets, up to 8 (7 at night). A name lies whole inside the rim, its box clear of the arrow's ring, of the job / waypoint pins, of other names
      // and of a landmark's name. A street's name is tried where it was (so it does not hop), at its blocks' middles, then slid along the street; the player's own street, if too
      // long for that, rides beside the arrow.
      let mks = []; for (const m of this.miniMarks) { const q = scr(m.x, m.y), x = q[0] - cx, y = q[1] - cy - (m.park ? 0 : 12); if (Math.hypot(x, q[1] - cy) > R - 26 || (Math.abs(x) < m.t.length * 3.4 + 20 && Math.abs(y) < 26)) continue; mks.push({ m, x, y: y + (m.park ? 0 : 5), w: m.t.length * 3.4 + 9, h: m.park ? 11 : 16 }); }
      const pins = []; for (const T of [M.target, g.gps && g.gps.target]) if (T) { const q = scr(T.x, T.y), x = q[0] - cx, y = q[1] - cy, d = Math.hypot(x, y); if (d > R - 12) pins.push({ x: x * (R - 12) / d, y: y * (R - 12) / d, w: 8, h: 8 }); else pins.push({ x, y: y - 10, w: 9, h: 13 }); }
      for (const L of this.names) { const lim = R / z + L.len / 2; if (Math.abs(L.x - pl.x) > lim || Math.abs(L.y - pl.y) > lim) continue; const o = seg(L); o.hl = L.len / 2 * z; o.st = Math.max(-o.hl, Math.min(o.hl, -(o.dx * o.ux + o.dy * o.uy))); o.sd = Math.hypot(o.dx + o.ux * o.st, o.dy + o.uy * o.st); if (o.sd > R - 20) continue;
        const G = got.get(L.t); if (G) { G.a.push(o); if (o.sd < G.n.sd) G.n = o; } else got.set(L.t, { t: L.t, a: [o], n: o }); }
      const out = [], pts = (o) => { const a = [], k = Math.ceil(o.hw / 6); for (let i = -k; i <= k; i++) a.push(o.dx + o.ux * o.hw * i / k, o.dy + o.uy * o.hw * i / k); return a; };
      const hitM = (P, m) => { for (let i = 0; i < P.length; i += 2) if (Math.abs(P[i] * cs + P[i + 1] * sn - m.x) < m.w + 5 && Math.abs(P[i] * sn - P[i + 1] * cs - m.y) < m.h + 5) return true; return false; };
      const clash = (P, Q) => { for (let i = 0; i < P.length; i += 2) for (let j = 0; j < Q.length; j += 2) if (Math.abs(P[i] - Q[j]) < 15 && Math.abs(P[i + 1] - Q[j + 1]) < 15 && Math.hypot(P[i] - Q[j], P[i + 1] - Q[j + 1]) < 15) return true; return false; };
      const free = (P, useM) => { for (const m of pins) if (hitM(P, m)) return false; if (useM) for (const m of mks) if (hitM(P, m)) return false; for (const Q of out) if (clash(P, Q.p)) return false; return true; };
      const onSt = (G, x, y) => { for (const o of G.a) if (Math.abs((x - o.dx) * o.ux + (y - o.dy) * o.uy) <= o.hl + 30 * z && Math.abs((x - o.dx) * o.uy - (y - o.dy) * o.ux) <= 12 * z) return true; return false; };
      const fit = (o, useM) => { if (o.far > R - 7 || o.gap < 21) return null; const P = pts(o); return free(P, useM) ? { L: o.L, p: P } : null; };
      const mkL = (G, x, y, rel) => { const n = G.n.L, L = { t: n.t, c: n.c, ave: n.ave, a: n.a, len: n.len, x: pl.x + x / z, y: pl.y + y / z }; if (rel) { L.rx = x / z; L.ry = y / z; } return seg(L); };
      const place = (G, useM) => { let r; const n = G.n, pv = prev && prev.get(G.t);
        if (pv && pv.rx === undefined && (r = fit(seg(pv), useM))) return r;
        for (const o of G.a.slice().sort((p, q) => p.d - q.d).slice(0, 3)) if ((r = fit(o, useM))) return r;
        const qx = n.dx + n.ux * n.st, qy = n.dy + n.uy * n.st;
        const hwN = (G.t.length * (n.L.ave ? 7.4 : 6.3) + 8) / 2, S = n.sd < 20 ? [hwN + 22, -hwN - 22] : []; for (let i = 0; i <= 14; i++) S.push((i + 1 >> 1) * 16 * (i & 1 ? 1 : -1));
        for (const s of S) { const x = qx + n.ux * s, y = qy + n.uy * s; if (Math.hypot(x, y) > R - 7 || !onSt(G, x, y)) continue; const o = mkL(G, x, y); if (!onSt(G, x + n.ux * o.hw, y + n.uy * o.hw) || !onSt(G, x - n.ux * o.hw, y - n.uy * o.hw)) continue; if ((r = fit(o, useM))) return r; }
        return null; };
      const put = (G, r) => { if (r) { r.G = G; out.push(r); } return r; }, has = (G) => out.some((Q) => Q.G === G);
      // the player's street: the nearest stretch within 30 m (at a corner, the one he faces along); the street across: the nearest that is not parallel to it
      let own = null, cross = null; { let b = 1e9; for (const G of got.values()) { const v = G.n.sd - 5 * z * Math.abs(Math.cos(G.n.L.a - pl.h)); if (G.n.sd < 30 * z && v < b) { b = v; own = G; } } }
      const byC = [...got.values()].sort((a, b) => (b.n.L.c - a.n.L.c) || (a.n.sd - b.n.sd)), back = [];
      for (const G of byC) if (G.n.L.ave && G !== own && out.length < 4) put(G, place(G, true));     // avenues first
      // a forced name: where it is free; else where it would lie with only `keep` in its way, and whatever it then lies across goes (names: tried again after; a landmark's name: dropped)
      const force = (G, keep) => { let r = place(G, true); if (!r) { const all = out.splice(0); if (keep) out.push(keep); r = place(G, true) || place(G, false); const gone = r ? all.filter((Q) => Q !== keep && clash(r.p, Q.p)) : []; out.length = 0; out.push(...all.filter((Q) => !gone.includes(Q)));
          if (r) { for (const Q of gone) back.push(Q.G); const hit = mks.filter((m) => hitM(r.p, m)); mks = mks.filter((m) => !hit.includes(m)); this.miniMarks = this.miniMarks.filter((m) => !hit.some((h) => h.m === m)); } } return put(G, r); };
      let late = null; if (own) { const ro = force(own, null); if (!ro) late = own; for (const G of [...got.values()].filter((G) => G !== own && Math.abs(Math.sin(G.n.L.a - own.n.L.a)) > 0.42).sort((a, b) => a.n.sd - b.n.sd).slice(0, 8)) if (has(G) || force(G, ro)) { cross = G; break; } }
      for (const G of back) if (!has(G)) put(G, place(G, true));
      const max = this.pal() === 'night' ? 7 : 8;
      for (const G of byC) { if (out.length >= max) break; if (G === late || has(G)) continue; put(G, place(G, true)); }
      // the player's street with a name too long to lie on it clear of the arrow: beside the arrow, along the street, on the side that is free; if neither is, the names in its way go (not the cross street's)
      if (late) { const n = late.n, qx = n.dx + n.ux * n.st, qy = n.dy + n.uy * n.st, C = []; for (const sd of [1, -1]) for (const s of [0, 16, -16, 32, -32]) { const o = mkL(late, qx + n.ux * s - n.uy * sd * 26, qy + n.uy * s + n.ux * sd * 26, 1); if (o.far <= R - 7 && o.gap >= 19) C.push({ L: o.L, p: pts(o) }); }
        let r = C.find((c) => free(c.p, true)) || C.find((c) => free(c.p, false)); if (!r && C.length) { const keep = out.filter((Q) => cross && Q.L.t === cross.t); r = C.find((c) => { const all = out.splice(0, out.length, ...keep), ok = free(c.p, false); out.splice(0, out.length, ...all); return ok; }) || C[0]; const P = r.p, all = out.splice(0, out.length); for (const Q of all) { out.length = 0; out.push(Q); if (free(P, false) || (cross && Q.L.t === cross.t)) keep.includes(Q) || keep.push(Q); } out.length = 0; out.push(...keep); }
        if (r) { const hit = mks.filter((m) => hitM(r.p, m)); this.miniMarks = this.miniMarks.filter((m) => !hit.some((h) => h.m === m)); out.unshift(r); } }
      this.miniLabels = out.map((o) => o.L); this.miniPrev = new Map(out.map((o) => [o.L.t, o.L])); this.miniOwn = own && own.t; this.miniCross = cross && cross.t; } }
    c.save(); c.shadowBlur = 0; c.beginPath(); c.arc(cx, cy, R - 2, 0, 7); c.clip();
    for (const L of this.miniLabels) { if (L.rx !== undefined) { L.x = pl.x + L.rx; L.y = pl.y + L.ry; } const q = scr(L.x, L.y); if (this.N2) { const o = seg(L); if (o.far > R - 3 || o.gap < 18) continue; } else if (Math.hypot(q[0] - cx, q[1] - cy) > R - 22) continue; let a = -L.a + rot; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI; this.labelS(c, L.t, q[0], q[1], L.ave ? 12.5 : 11, L.ave ? p.tAve : p.tSt, a, L.ave ? 800 : 600); }
    for (const m of this.miniMarks) { const q = scr(m.x, m.y); if (Math.hypot(q[0] - cx, q[1] - cy) > R - 26 || (Math.abs(q[0] - cx) < m.t.length * 3.4 + 20 && Math.abs(q[1] - (m.park ? 0 : 12) - cy) < 26)) continue; if (!m.park) { c.fillStyle = p.dot; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(q[0], q[1], 3.6, 0, 7); c.fill(); c.stroke(); } this.labelS(c, m.t, q[0], q[1] - (m.park ? 0 : 12), 11.5, m.park ? p.tPark : p.tLm, 0, 700); }
    // soft shade at the rim, so the circle reads as a lens
    if (!this.rim || this.rim.R !== R || this.rim.k !== k) { const cv = mk(Math.ceil(2 * R * k), Math.ceil(2 * R * k)), x2 = cv.getContext('2d'); x2.scale(k, k); const gr = x2.createRadialGradient(R, R, R * 0.72, R, R, R); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)'); x2.fillStyle = gr; x2.fillRect(0, 0, 2 * R, 2 * R); this.rim = { cv, R, k }; }
    c.drawImage(this.rim.cv, cx - R, cy - R, 2 * R, 2 * R);
    c.restore(); c.save(); c.shadowBlur = 0;
    // the job and the waypoint, held on the rim when out of view
    const rim = (x, y, col) => { let [mx, my] = scr(x, y); mx -= cx; my -= cy; const d = Math.hypot(mx, my), out = d > R - 12; if (out) { mx *= (R - 12) / d; my *= (R - 12) / d; c.fillStyle = col; c.strokeStyle = '#14161a'; c.lineWidth = 2; c.beginPath(); c.arc(cx + mx, cy + my, 7, 0, 7); c.fill(); c.stroke(); } else this.pin(c, cx + mx, cy + my, col, 0.85); };
    if (M.target) rim(M.target.x, M.target.y, AMBER);
    { const T = g.gps && g.gps.target; if (T) rim(T.x, T.y, g.gps.color); }
    if (this.finds) this.finds.mini(c, scr, cx, cy, R);     // gameplay lane, finds.js: the icons of the things he has found (and the helicopter)
    this.arrow(c, cx, cy, -(pl.h - yaw));
    c.strokeStyle = 'rgba(12,14,18,0.9)'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, R + 0.5, 0, 7); c.stroke(); c.strokeStyle = p.ring; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    const nx = cx + Math.sin(rot) * R, ny = cy - Math.cos(rot) * R; c.fillStyle = '#14161a'; c.strokeStyle = p.ring; c.lineWidth = 1.5; c.beginPath(); c.arc(nx, ny, 11.5, 0, 7); c.fill(); c.stroke(); hud.text('N', nx, ny + 5, 13, '#ff5a45', 'center', 800);
    hud.text('TAB  map', cx - R + 6, cy - R + 4, 12, 'rgba(255,255,255,0.75)', 'right', 700, 1.5);
    c.restore();
  }

  // ---- the full-screen map: north up. W x H in HUD units (H = 1080)
  drawFull(W, H) {
    const hud = this.hud, c = hud.ctx, g = this.g, pl = g.player, M = g.missions, pb = this.play, p = PAL[this.pal()], k = hud.k || 1;
    const top = 84, bot = 56, side = 60, fit = Math.min((W - 2 * side) / (pb[2] - pb[0] + 160), (H - top - bot) / (pb[3] - pb[1] + 160)); this.fitZoom = fit;
    if (!this.wasFull || (!this.zoomF && this.zoomSeen)) { this.whole(); this.zc = fit; this.cx = this.tx; this.cy = this.ty; this.fullKey = ''; } this.wasFull = true; this.zoomF = this.zt; this.zoomSeen = this.zt;     // opened (or reset from outside by zoomF = 0): the whole map
    // a controller, picked as padui.js picks it: the right stick moves the map, R1 / L1 zoom (the triggers are the car's pedals)
    let gp = null; try { for (const q of navigator.getGamepads ? navigator.getGamepads() : []) if (q && q.connected && q.axes.length >= 4 && q.buttons.length >= 6 && (!gp || (q.mapping === 'standard' && gp.mapping !== 'standard'))) gp = q; } catch (e) { gp = null; }
    if (gp && !(g.P && g.P.get('padmap') === '0')) { const std = gp.mapping === 'standard' || gp.buttons.length >= 16, ax = (std ? gp.axes[2] : gp.axes[3]) || 0, ay = (std ? gp.axes[3] : gp.axes[4]) || 0, fl = !!(g.heli && (g.heli.piloted || g.heli.hasCamera)); if (Math.hypot(ax, ay) > 0.2) this.panBy(-ax * 16, -ay * 16);
      if (!fl) { if (gp.buttons[5].pressed) this.zoomBy(1.03); else if (gp.buttons[4].pressed) this.zoomBy(1 / 1.03); } gp = fl ? 1 : 2; } else gp = null;     // in the helicopter R1 / L1 turn it, so there they do not zoom; on foot combat.js leaves the guns alone while this map is open
    const zt = this.zt || fit; this.zc += (zt - this.zc) * 0.22; if (Math.abs(this.zc - zt) < zt * 0.002) this.zc = zt; this.cx += (this.tx - this.cx) * 0.22; this.cy += (this.ty - this.cy) * 0.22;
    const z = this.zc, mx = this.cx, my = this.cy, ox = W / 2, oy = top + (H - top - bot) / 2, scr = (x, y) => [ox + (x - mx) * z, oy - (y - my) * z];
    const B = this.fr, x0 = Math.max(side / 2, ox + (B[0] - mx) * z), y0 = Math.max(top - 10, oy - (B[3] - my) * z), x1 = Math.min(W - side / 2, ox + (B[2] - mx) * z), y1 = Math.min(H - bot + 10, oy - (B[1] - my) * z);     // the frame hugs the map's picture: no blank margins on the whole-map view
    this.view = { ox, oy, mx, my, z, x0, y0, x1, y1 };     // gps: what toMap() needs
    c.save(); c.shadowBlur = 0; c.fillStyle = p.back; c.fillRect(0, 0, W, H);
    c.beginPath(); c.roundRect ? c.roundRect(x0, y0, x1 - x0, y1 - y0, 10) : c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); c.fillStyle = p.land; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.save(); c.translate(ox, oy); c.scale(z, z); c.translate(-mx, my);
    this.blit(c, mx - (ox - x0) / z, my - (y1 - oy) / z, mx + (x1 - ox) / z, my + (oy - y0) / z, z * k);
    this.route(c, (x, y) => [x, -y], 5 / z); this.police(c, 1.5 / z);
    c.restore();
    // names: laid out again only when the view has moved (and at most every 5th frame while it is moving)
    const key = z.toFixed(3) + '|' + Math.round(mx * z / 24) + '|' + Math.round(my * z / 24) + '|' + Math.round(W) + '|' + this.marks.length + '|' + this.stations().length;
    if (key !== this.fullKey && (!this.fullLabels || this.n % 5 === 0 || z === zt)) { this.fullKey = key; this.layout(scr, z, x0, y0, x1, y1, c); }
    const fl = this.fullLabels || { st: [], mk: [], sub: [] };
    const names = (c) => {
    for (const s of fl.sub) { const q = scr(s.cx, s.cy); this.station(c, q[0], q[1], z > 0.7 ? 6 : 4.2); if (s._lab) { this.label(c, s.name, q[0], q[1] + 17, 11.5, p.tAve, 0, 700); const rs = s.signRoutes || s.routes || []; let bx = q[0] - (rs.length - 1) * 7.5; for (const r of rs.slice(0, 8)) { c.fillStyle = ROUTE[r] || '#666'; c.beginPath(); c.arc(bx, q[1] + 33, 6.5, 0, 7); c.fill(); c.font = `800 9px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = /[NQRW]/.test(r) ? '#111' : '#fff'; c.fillText(r, bx, q[1] + 33.5); bx += 15; } } }
    for (const o of fl.st) { const q = scr(o.L.x, o.L.y); this.label(c, o.L.t, q[0], q[1], o.size, o.L.ave ? p.tAve : p.tSt, o.a, o.L.c ? 800 : 600); }
    for (const m of fl.mk) { const q = scr(m.x, m.y);
      if (m.area) this.label(c, m.t.toUpperCase(), q[0] + (m.sx || 0), q[1], 13, p.tArea, 0, 800, 3.5);
      else if (m.water) { c.save(); c.font = `italic 600 15px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; if ('letterSpacing' in c) c.letterSpacing = '3px'; c.fillStyle = p.tWater; c.translate(q[0], q[1]); if (m.v) c.rotate(-Math.PI / 2); c.fillText(m.t, 0, 0); c.restore(); }
      else if (m.park) this.label(c, m.t, q[0] + (m.sx || 0), q[1] + (m.big ? m.dy || 0 : 0), m.big ? 17 : m.inPlay ? 13.5 : 12, p.tPark, 0, m.big ? 800 : 700, m.big ? 2.5 : 0.5);
      else { c.globalAlpha = m.inPlay ? 1 : 0.7; c.fillStyle = p.dot; c.strokeStyle = '#fff'; c.lineWidth = 1.8; c.beginPath(); c.arc(q[0], q[1], 4.6, 0, 7); c.fill(); c.stroke(); this.label(c, m.t, q[0], q[1] - 14, m.inPlay ? 14 : 12.5, p.tLm, 0, 800); c.globalAlpha = 1; } } };
    // the names stand in one layer while the view stands still (stroked text for some hundreds of names every frame was most of the map's cost)
    const lk = [z, mx, my, W, H, k, this.pal(), this.layN, fl.sub.length].join('|');
    if (lk === this.layKey && this.lay) c.drawImage(this.lay, 0, 0, W, H);
    else if (lk === this.lastKey) { const lw = Math.ceil(W * k), lh = Math.ceil(H * k); if (!this.lay || this.lay.width !== lw || this.lay.height !== lh) this.lay = mk(lw, lh); const L = this.lay.getContext('2d'); L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, lw, lh); L.scale(k, k); names(L); this.layKey = lk; c.drawImage(this.lay, 0, 0, W, H); }
    else names(c);
    this.lastKey = lk;
    if (M.target) { const q = scr(M.target.x, M.target.y); this.pin(c, q[0], q[1], AMBER, 1.15); this.label(c, 'JOB', q[0], q[1] - 42, 13, AMBER, 0, 800, 2, 'rgba(14,16,20,0.92)'); }
    { const T = g.gps && g.gps.target; if (T) { const q = scr(T.x, T.y); this.pin(c, q[0], q[1], g.gps.color, 1.15); this.label(c, T.name.toUpperCase(), q[0], q[1] - 42, 13, g.gps.color, 0, 800, 1.5, 'rgba(14,16,20,0.92)'); } }     // gps: the waypoint
    if (this.finds) this.finds.full(c, scr, z, hud, { side, x0, y0 });     // gameplay lane, finds.js: found things' icons, the FOUND n / N line and its legend rows
    { const q = scr(pl.x, pl.y); c.strokeStyle = 'rgba(31,111,238,0.55)'; c.lineWidth = 2; c.beginPath(); c.arc(q[0], q[1], 22 + 4 * Math.sin(performance.now() / 300), 0, 7); c.stroke(); this.arrow(c, q[0], q[1], Math.PI / 2 - pl.h, 1.3); this.label(c, 'YOU', q[0], q[1] + 32, 12.5, '#fff', 0, 800, 2, 'rgba(14,16,20,0.92)'); }
    c.restore(); c.save(); c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1.5; c.beginPath(); c.roundRect ? c.roundRect(x0, y0, x1 - x0, y1 - y0, 10) : c.rect(x0, y0, x1 - x0, y1 - y0); c.stroke();
    hud.text('CITY MAP', side, 52, 30, '#fff', 'left', 800, 6); hud.text(g.hud && g.hud.street ? String(g.hud.street).toUpperCase() : '', side + 240, 51, 18, AMBER, 'left', 700, 2);
    hud.text((gp ? 'R STICK  move      ' + (gp === 2 ? 'R1 / L1  zoom      ' : '') : '') + 'CLICK  set waypoint      RIGHT-CLICK  clear      ' + (gp ? '' : 'DRAG  move      SCROLL or + / -  zoom      ') + '0  whole map      TAB  close', W - side, 51, 14, 'rgba(255,255,255,0.75)', 'right', 700, 1.5);
    if (x0 > 300) { const lx = Math.max(side, x0 - 268), ly = y0 + 14, row = (i) => ly + 58 + i * 34, G = g.gps; c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.roundRect ? c.roundRect(lx, ly, 236, 292, 10) : c.rect(lx, ly, 236, 292); c.fill();
      hud.text('LEGEND', lx + 20, ly + 30, 13, 'rgba(255,255,255,0.6)', 'left', 800, 3); const T = (i, s) => hud.text(s, lx + 56, row(i) + 5, 15, 'rgba(255,255,255,0.9)', 'left', 600, 0.5);
      this.arrow(c, lx + 30, row(0), 0, 0.62); T(0, 'You'); this.pin(c, lx + 30, row(1) + 10, AMBER, 0.75); T(1, 'Job'); this.pin(c, lx + 30, row(2) + 10, (G && G.color) || '#5cd6ff', 0.75); T(2, 'Waypoint (click)');
      c.fillStyle = p.dot; c.strokeStyle = '#fff'; c.lineWidth = 1.8; c.beginPath(); c.arc(lx + 30, row(3), 4.6, 0, 7); c.fill(); c.stroke(); T(3, 'Landmark'); this.station(c, lx + 30, row(4), 5); T(4, 'Subway station');
      c.fillStyle = '#0b0c0e'; c.fillRect(lx + 20, row(5) - 6.5, 20, 13); c.fillStyle = '#3f8cff'; c.fillRect(lx + 22.5, row(5) - 4, 15, 8); c.fillStyle = '#fff'; c.fillRect(lx + 28.5, row(5) - 4, 3, 8); T(5, 'Police');
      c.fillStyle = PAL[this.pal()].land; c.fillRect(lx + 20, row(6) - 7, 20, 14); c.fillStyle = p.dim; c.fillRect(lx + 20, row(6) - 7, 20, 14); c.strokeStyle = p.edge; c.lineWidth = 1.5; c.strokeRect(lx + 20, row(6) - 7, 20, 14); T(6, 'Beyond the map'); }
    // compass and scale, on their own plates
    const nx = x1 - 40, ny = y0 + 44; c.fillStyle = 'rgba(14,16,20,0.82)'; c.beginPath(); c.arc(nx, ny, 24, 0, 7); c.fill(); c.fillStyle = '#ff5a45'; c.beginPath(); c.moveTo(nx, ny - 19); c.lineTo(nx + 6, ny - 3); c.lineTo(nx - 6, ny - 3); c.closePath(); c.fill(); hud.text('N', nx, ny + 15, 13, '#fff', 'center', 800);
    const bar = [50, 100, 200, 500, 1000].find((b) => b * z >= 70) || 1000, px = bar * z; c.fillStyle = 'rgba(14,16,20,0.82)'; c.beginPath(); c.roundRect ? c.roundRect(x0 + 14, y1 - 44, px + 92, 30, 6) : c.rect(x0 + 14, y1 - 44, px + 92, 30); c.fill();
    c.fillStyle = '#fff'; c.fillRect(x0 + 26, y1 - 30, px, 3); c.fillRect(x0 + 26, y1 - 35, 2, 12); c.fillRect(x0 + 24 + px, y1 - 35, 2, 12); hud.text(bar >= 1000 ? '1 km' : bar + ' m', x0 + 38 + px, y1 - 23, 13, '#fff', 'left', 700);
    c.restore();
  }
  mkWater() { const t0 = performance.now(), city = this.g.city, B = this.box, names = this.wn, ws = (city.water || []).filter((w) => w.name && w.poly && w.poly.length > 2); this.wm = null;
    try { const C = 16, w = Math.ceil((B[2] - B[0]) / C), h = Math.ceil((B[3] - B[1]) / C), x = mk(w, h).getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.setTransform(1 / C, 0, 0, -1 / C, -B[0] / C, B[3] / C);
        for (const o of ws) { const i = names.indexOf(o.name); if (i < 0) continue; x.fillStyle = `rgb(${(i + 1) * 40},0,0)`; x.beginPath(); ring(x, o.poly); x.fill(); }
        x.fillStyle = x.strokeStyle = '#000'; x.lineWidth = C; for (const o of city.waterPiers || []) if (o.poly && o.poly.length > 2) { x.beginPath(); ring(x, o.poly); x.fill(); x.stroke(); }
        for (const o of city.buildings) if (!(o.minh > 0) && o.poly && o.poly.length > 2) { x.beginPath(); ring(x, o.poly); x.fill(); }     // one small path each: one path of them all took seconds
        const d = x.getImageData(0, 0, w, h).data, sat = names.map(() => new Int32Array((w + 1) * (h + 1)));
        for (let n = 0; n < names.length; n++) { const t = sat[n], v = (n + 1) * 40; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = (j + 1) * (w + 1) + i + 1; t[q] = (d[(j * w + i) * 4] === v ? 1 : 0) + t[q - 1] + t[q - w - 1] - t[q - w - 2]; } }
        this.wm = { C, w, h, sat }; this.wmMs = performance.now() - t0; } catch (e) { this.wm = null; } }
  // a place for a river's name (tw x th HUD px) in the frame (x0..y1, HUD px): a box of the water's picture that is all water, roomy if one can be had, upright or turned
  // along a north-south river; of the places that fit, the middle one. Returns [x, y, turned] in metres, or null.
  river(n, tw, th, z, x0, y0, x1, y1) { if (this.wm === undefined) this.mkWater(); const W = this.wm, v = this.view, B = this.box; if (!W || !v) return null; const s = W.sat[n], w1 = W.w + 1, cz = W.C * z;
    const i0 = Math.max(0, Math.ceil((v.mx + (x0 + 6 - v.ox) / z - B[0]) / W.C)), i1 = Math.min(W.w, Math.floor((v.mx + (x1 - 6 - v.ox) / z - B[0]) / W.C)), j0 = Math.max(0, Math.ceil((B[3] - v.my + (y0 + 6 - v.oy) / z) / W.C)), j1 = Math.min(W.h, Math.floor((B[3] - v.my + (y1 - 6 - v.oy) / z) / W.C));
    for (const pad of [30, 16, 7]) for (const turn of [0, 1]) { const bw = Math.ceil(((turn ? th : tw) + 2 * pad) / cz), bh = Math.ceil(((turn ? tw : th) + 2 * pad) / cz), st = Math.max(1, Math.round(Math.min(bw, bh) / 6)), fit = []; let sx = 0, sy = 0;
      for (let j = j0; j + bh <= j1; j += st) for (let i = i0; i + bw <= i1; i += st) if (s[(j + bh) * w1 + i + bw] - s[j * w1 + i + bw] - s[(j + bh) * w1 + i] + s[j * w1 + i] === bw * bh) { fit.push(i, j); sx += i; sy += j; }
      if (!fit.length) continue; sx /= fit.length / 2; sy /= fit.length / 2; let b = 0, bd = 1e18; for (let k = 0; k < fit.length; k += 2) { const d = (fit[k] - sx) ** 2 + (fit[k + 1] - sy) ** 2; if (d < bd) { bd = d; b = k; } }
      return [B[0] + (fit[b] + bw / 2) * W.C, B[3] - (fit[b + 1] + bh / 2) * W.C, turn]; }
    return null; }
  // which names the full map shows at this view: landmarks first, then stations, then streets (avenues first); none on top of another
  layout(scr, z, x0, y0, x1, y1, c) {
    const taken = [], hit = (x, y, w, h) => taken.some((t) => Math.abs(t[0] - x) < (t[2] + w) / 2 + 5 && Math.abs(t[1] - y) < (t[3] + h) / 2 + 3), take = (x, y, w, h) => taken.push([x, y, w, h]);
    const inV = (q, m = 30) => q[0] > x0 + m && q[0] < x1 - m && q[1] > y0 + m && q[1] < y1 - m, mk = [], st = [], sub = [];
    { const q = scr(this.g.player.x, this.g.player.y); take(q[0], q[1] + 6, 60, 80); }
    const shift = (x, w) => (w > x1 - x0 - 16 ? 0 : Math.max(x0 + 8 + w / 2, Math.min(x1 - 8 - w / 2, x)) - x);     // a name with no dot is kept whole inside the frame
    const order = (m) => (m.water ? 0 : m.big ? 1.5 : m.area ? 2 : m.park ? 3 : 1);     // rivers, then the landmarks in their list's order, then neighbourhoods, then parks
    for (const m of this.marks.slice().sort((a, b) => (b.inPlay - a.inPlay) || (order(a) - order(b)))) {
      if (m.water) { const tw = m.t.length * 11.6 + 8, o = this.river(m.wi, tw, 20, z, x0, y0, x1, y1); if (!o) continue; m.x = o[0]; m.y = o[1]; m.v = o[2]; const q = scr(m.x, m.y), bw = o[2] ? 24 : tw, bh = o[2] ? tw : 24; if (hit(q[0], q[1], bw, bh)) continue; take(q[0], q[1], bw, bh); mk.push(m); continue; }
      const q = scr(m.x, m.y); if (!inV(q, 40)) continue; if (z < 0.2 && !m.area && !m.water && !m.inPlay && !m.big) continue;
      if (m.big) { const w = m.t.length * 13.5 + 14, sx = shift(q[0], w); for (const dy of [0, -34, 34, -68, 68, -102, 102, -140, 140]) if (inV([q[0], q[1] + dy], 40) && !hit(q[0] + sx, q[1] + dy, w, 24)) { m.dy = dy; m.sx = sx; take(q[0] + sx, q[1] + dy, w, 24); mk.push(m); break; } continue; }
      const size = m.area ? 13 : 14, w = m.t.length * size * (m.area ? 0.95 : 0.62) + 10, yy = m.area || m.park || m.water ? q[1] : q[1] - 9, hh = m.area || m.park || m.water ? 18 : 32, sx = m.area || m.park ? shift(q[0], w) : 0; if (hit(q[0] + sx, yy, w, hh)) continue; m.sx = sx; take(q[0] + sx, yy, w, hh); mk.push(m); }
    for (const s of this.stations()) { const q = scr(s.cx, s.cy); if (!inV(q, 12) || z < 0.3) continue; s._lab = false; if (z >= 0.75) { const w = Math.max(String(s.name).length * 7.5, (s.signRoutes || s.routes || []).length * 15) + 8; if (!hit(q[0], q[1] + 16, w, 52)) { take(q[0], q[1] + 16, w, 52); s._lab = true; } } if (!s._lab) take(q[0], q[1], 12, 12); sub.push(s); }
    const cand = this.names.filter((L) => { const q = scr(L.x, L.y); return inV(q, 26); }).sort((a, b) => (b.c - a.c) || (b.len - a.len)), gap = z < 0.4 ? 210 : 300, minC = z < 0.17 ? 2 : z < 0.24 ? 1 : 0, byName = new Map();
    const pb = this.play, wholeV = z <= (this.fitZoom || 0) * 1.05;
    for (const L of cand) { if (L.c < minC || (wholeV && (this.inAreas ? !this.inAreas(L.x, L.y, 40) : (L.x < pb[0] - 40 || L.x > pb[2] + 40 || L.y < pb[1] - 40 || L.y > pb[3] + 40)))) continue;     /* the whole-map view names the playable streets only, as before */ const q = scr(L.x, L.y), size = L.c === 2 ? 14 : L.c === 1 ? 12.5 : 11.5, w = L.t.length * size * 0.6; if (L.c < 2 && L.len * z < w * 0.62) continue;
      let a = -L.a; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI; const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a)), bw = ca * w + sa * size, bh = sa * w + ca * size;
      const same = byName.get(L.t); if (same && same.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < gap)) continue; if (hit(q[0], q[1], bw, bh)) continue; take(q[0], q[1], bw, bh); if (same) same.push(q); else byName.set(L.t, [q]); st.push({ L, size, a }); if (st.length > 420) break; }
    this.fullLabels = { st, mk, sub }; this.layN++;
  }
}
