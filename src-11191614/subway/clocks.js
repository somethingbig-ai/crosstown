// subway/clocks.js: the countdown clocks over the platforms. A part of the subway lane (CONTRACT.md): install(game, S), nothing else edited.
// A black board hangs from the platform ceiling, two to a platform, read from both ways along it. Each shows the next trains for ITS platform: our route badge, where the
// train is bound (real terminal names), and the time to the game's own next train on that track, taken from the train's real state in subway.js (u.trains): minutes while
// it waits out of sight, "arriving" while it runs in, "boarding" while it stands with its doors open. Nothing here is made up beside the second line on a one-track
// platform (the train after next: the same train's next round, counted from the game's own timetable numbers).
// Cost: per platform ONE 512 x 128 canvas texture shared by its boards, redrawn at most once a second and only when its words change; three small meshes a board.
import { drawBadge, ROUTES } from './look.js';
export const TERMINAL = {      // [uptown / +s bound, downtown / -s bound]: real places, plain words
  1: ['Van Cortlandt Park-242 St', 'South Ferry'], 2: ['Wakefield-241 St', 'Flatbush Av'], 3: ['Harlem-148 St', 'New Lots Av'], 4: ['Woodlawn', 'Crown Hts-Utica Av'], 5: ['Eastchester-Dyre Av', 'Flatbush Av'], 6: ['Pelham Bay Park', 'Brooklyn Bridge'],
  7: ['Flushing-Main St', '34 St-Hudson Yards'], A: ['Inwood-207 St', 'Far Rockaway'], C: ['168 St', 'Euclid Av'], E: ['Jamaica Center', 'World Trade Center'], B: ['Bedford Park Blvd', 'Brighton Beach'], D: ['Norwood-205 St', 'Coney Island'],
  F: ['Jamaica-179 St', 'Coney Island'], M: ['Forest Hills-71 Av', 'Middle Village'], N: ['Astoria-Ditmars Blvd', 'Coney Island'], Q: ['96 St', 'Coney Island'], R: ['Forest Hills-71 Av', 'Bay Ridge-95 St'], W: ['Astoria-Ditmars Blvd', 'Whitehall St'], S: ['Grand Central', 'Times Sq'] };
const W = 512, H = 128, BW = 1.72, BH = 0.43, IN_TIME = 23, ROUND = 105;      // IN_TIME: seconds a train takes from its start in the tunnel to its stop; ROUND: about one whole round of a train (in, stand, out, wait)
// the rows of one platform, from the trains' state. -> [{ route, dest, text, hot }]
let ENDS = null, DIRN = null;      /* set by install: ENDS(train, route) => true when that route has no station beyond this one: the board then says so ("Last stop", "ends here") instead of a place it never goes; DIRN(train, route) => +1 when the route runs its uptown way on this track */
export function rowsFor(trains, plat) { const rows = [];
  for (const t of trains) { if (t.T.plat !== plat) continue; const R = t.T.routes, n = R.length, waiting = t.state === 'wait', cur = t.route || R[(t.routeI + n - 1) % n], next = R[t.routeI % n], gone = t.state === 'out';
    const secs = waiting ? t.t + IN_TIME : gone ? ROUND - 20 : 0, route = waiting || gone ? next : cur;
    const row = (rt, sc, live) => { let ends = false, di = t.T.dir > 0 ? 0 : 1; try { ends = !!(ENDS && ENDS(t, rt)); if (DIRN) di = DIRN(t, rt) > 0 ? 0 : 1; } catch (e) {}
      rows.push({ route: rt, dest: ends ? 'Last stop' : (TERMINAL[rt] || ['Uptown', 'Downtown'])[di], secs: sc, text: live && t.state === 'dwell' ? (ends ? 'ends here' : 'boarding') : live && t.state === 'in' ? 'arriving' : Math.max(1, Math.round(sc / 60)) + ' min', hot: live && (t.state === 'dwell' || t.state === 'in') }); };
    row(route, secs, true); row(R[(Math.max(0, R.indexOf(route)) + 1) % n], secs + ROUND, false); }
  rows.sort((a, b) => a.secs - b.secs); return rows.slice(0, 2); }
export function drawClock(ctx, rows) { ctx.fillStyle = '#050607'; ctx.fillRect(0, 0, W, H); const rh = H / 2;
  rows.forEach((r, i) => { const y = i * rh; if (i) { ctx.fillStyle = '#1c1e21'; ctx.fillRect(10, y - 1, W - 20, 2); }
    drawBadge(ctx, r.route, 12, y + 9, rh - 18); ctx.textBaseline = 'middle'; ctx.fillStyle = r.hot ? '#ffd24a' : '#f4f5f2';
    ctx.font = `700 ${r.hot ? 30 : 34}px "Helvetica Neue", Helvetica, Arial, sans-serif`; ctx.textAlign = 'right'; ctx.fillText(r.text, W - 14, y + rh / 2 + 2); const tw = ctx.measureText(r.text).width;
    ctx.fillStyle = '#f4f5f2'; ctx.textAlign = 'left'; let fs = 30; const room = W - 14 - tw - 16 - (12 + rh - 18 + 12); do { ctx.font = `600 ${fs}px "Helvetica Neue", Helvetica, Arial, sans-serif`; } while (ctx.measureText(r.dest).width > room && --fs > 16); ctx.fillText(r.dest, 12 + rh - 18 + 12, y + rh / 2 + 2); }); }
// one platform's boards. -> { group, update(trains), dispose() }
export function makeClocks(THREE, st, meta, plat, layer) { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'), map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const face = new THREE.MeshBasicMaterial({ map, fog: false, toneMapped: false }), dark = new THREE.MeshBasicMaterial({ color: 0x030303, fog: false }), group = new THREE.Group(), F = st.frame, ca = Math.cos(F.a), sa = Math.sin(F.a);
  const zTop = meta.zP + meta.hP, zMid = meta.zP + 2.78 + BH / 2, tt = st.tc[plat], stairs = st.floors.filter((f) => f.k === 'pstair'), geos = [];
  const signs = []; for (const t of st.things || []) if (t.k === 'psign') { if (t.xy) for (let i = 0; i < t.xy.length; i += 2) signs.push([t.xy[i], t.xy[i + 1]]); else signs.push([t.x, t.y]); }      // the platform's own hanging signs: a clock keeps 7 m from them
  const clear = (s) => { const x = F.x + ca * s - sa * tt, y = F.y + sa * s + ca * tt; for (const q of signs) if (Math.hypot(q[0] - x, q[1] - y) < 7) return false; for (const f of stairs) { const c = Math.cos(f.a), sn = Math.sin(f.a), u = (x - f.x) * c + (y - f.y) * sn, v = -(x - f.x) * sn + (y - f.y) * c; if (Math.abs(u) < f.l / 2 + 2.5 && Math.abs(v) < f.w / 2 + 1.2) return false; } return true; };
  for (const s0 of [-st.plen * 0.24, st.plen * 0.24]) { let s = null; for (let k = 0; k < 40 && s === null; k++) { const c = s0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2; if (clear(c)) s = c; } if (s === null) continue;
    const b = new THREE.Group(); b.position.set(F.x + ca * s - sa * tt, zMid, -(F.y + sa * s + ca * tt)); b.rotation.y = F.a;      // local +X runs up the platform, +Z across it
    const box = new THREE.BoxGeometry(0.1, BH + 0.07, BW + 0.07), rod = new THREE.BoxGeometry(0.035, zTop - zMid - BH / 2, 0.035); geos.push(box, rod);
    b.add(new THREE.Mesh(box, dark)); for (const z of [-BW * 0.36, BW * 0.36]) { const r = new THREE.Mesh(rod, dark); r.position.set(0, (zTop - zMid + BH / 2) / 2, z); b.add(r); }
    for (const sd of [-1, 1]) { const g = new THREE.PlaneGeometry(BW, BH); geos.push(g); const m = new THREE.Mesh(g, face); m.rotation.y = sd * Math.PI / 2; m.position.x = sd * 0.052; b.add(m); }
    group.add(b); }
  group.traverse((o) => { o.layers.enable(layer); }); let last = '';
  const update = (trains) => { const rows = rowsFor(trains, plat), key = rows.map((r) => r.route + r.dest + r.text).join('|'); if (key === last) return false; last = key; drawClock(ctx, rows); map.needsUpdate = true; return true; };
  return { group, update, rows: () => last, dispose() { map.dispose(); face.dispose(); dark.dispose(); for (const g of geos) g.dispose(); } }; }
export async function install(game, S) { if (S.clocks) return S.clocks; ENDS = (t, r) => !!(S.nextStation && t.u && t.u.st && !S.nextStation(t.u.st, t.T.dir, t.T.key, r)); DIRN = (t, r) => (S.dirOf ? S.dirOf(t, r) : t.T.dir); const THREE = S.THREE, all = new Map(); let acc = 1;
  const add = (u) => { try { if (all.has(u) || !u.res || !u.st.tc) return; const list = u.st.tc.map((_, i) => makeClocks(THREE, u.st, S.meta, i, S.LAYER)); for (const c of list) { u.res.core.add(c.group); c.update(u.trains); } all.set(u, list); } catch (e) { console.log('[subway] clocks: ' + (e && e.message)); } };
  const drop = (u) => { const list = all.get(u); if (!list) return; for (const c of list) { c.group.removeFromParent(); c.dispose(); } all.delete(u); };
  S.on('unit', add); S.on('drop', drop); S.on('step', (dt) => { acc += dt; if (acc < 1) return; acc = 0; for (const [u, list] of all) for (const c of list) c.update(u.trains); });
  for (const u of S.units.values()) if (u.state === 'ready') add(u);
  S.clocks = { all, TERMINAL, ROUTES, rows: (u, plat) => rowsFor(u.trains, plat).map((r) => r.route + ' ' + r.dest + ' ' + r.text) }; return S.clocks; }
