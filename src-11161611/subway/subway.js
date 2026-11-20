// subway/subway.js (subway lane, Nov 14): the subway. install(game) from one line in game.js; ?subway=0 leaves it out (nothing fetched).
//  - ON THE STREET: every real station entrance inside the map stands where it is today (assets/subway/subway.json: MTA open entrance data and
//    OpenStreetMap, put on our sidewalks by lanes/subway/tools/build_data.py): kerb stones, railings, a sign with the station's name and lines.
//  - UNDERGROUND only exists near the player: a station's stairs, passages, mezzanine, platforms and tracks are built (spread over frames) when he comes
//    within NEAR metres of one of its entrances and thrown away beyond FAR. Stations not built yet have their stairs down to a shut gate.
//  - THE HOLE in the sidewalk costs the street layers nothing: the stair is drawn first, then an unseen "cap" over the opening writes depth only, so
//    the sidewalk drawn afterwards fails the depth test there. No street shader or mesh is touched.
//  - DOWN THERE the player is ours: walk.js says where he can stand (the game's own walking and the jump are held off), the camera stays inside the
//    rooms, and once he has left the stair's landing the city above is not drawn at all (the camera looks at layer 9 only: our meshes and the people).
//  - TRAINS run on every track of a built station while someone is down there: arrive, stop, doors open, doors close, leave.
// The game's code is wrapped, never edited: step, syncVisuals, placeCamera, nearestCar, traffic.pushPlayer.
import * as THREE from 'three';
import { Walk } from './walk.js';
import { buildStation, plainLook, K } from './build.js';

const NEAR = 80, FAR = 170, LAYER = 9 /* (5 and 7 are the helicopter's) */, R_BODY = 0.3;
const ROUTE_COL = { 1: '#d82c2c', 2: '#d82c2c', 3: '#d82c2c', 4: '#1f8a4c', 5: '#1f8a4c', 6: '#1f8a4c', 7: '#a23ea8', A: '#2456b8', C: '#2456b8', E: '#2456b8', B: '#f36a1c', D: '#f36a1c', F: '#f36a1c', M: '#f36a1c', N: '#f2c21a', Q: '#f2c21a', R: '#f2c21a', W: '#f2c21a', S: '#7a7d80' };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const EXTRA = ['riders', 'clocks', 'voice'];      // shipped parts of the lane beside this file: 'riders', 'voice', 'police' as they land

export async function install(game) {
  if (game.subway) return game.subway;
  const g = game, w = g.world, pl = g.player, P = g.P;
  // the map with the east column (city.json's set 'east') has its own data set, assets/subway/east/ (entrances placed against THAT map's streets, and the east stations);
  // every other map keeps assets/subway/ untouched. ?subeast=0, or the folder missing, falls back to it (the play-area filter below then drops what lies outside).
  let DIR = 'assets/subway/', data = null; const cm = (g.city && g.city.meta) || (w.city && w.city.meta) || {};
  // (handover-18: the map with the west column, set 'west', = nine areas, has assets/subway/west/, which holds the east stations too; ?subwest=0 falls back to east/)
  for (const n of ['west', 'east']) { if (data || !(cm.sets || []).some((q) => q && q.set === n) || P.get('sub' + n) === '0') continue; try { const r = await fetch(DIR + n + '/subway.json'); if (r.ok) { data = await r.json(); DIR += n + '/'; } else console.log('[subway] no ' + n + ' data (' + r.status + '): a smaller set is used'); } catch (e) { data = null; } }
  if (!data) data = await (await fetch(DIR + 'subway.json')).json(); const meta = data.meta, EN = data.entrances; console.log('[subway] data: ' + DIR);
  const S = (g.subway = { data, units: new Map(), own: false, deep: false, z: 0, floor: null, unit: null, fails: 0, stats: { built: 0, dropped: 0, buildMs: 0 }, K });
  // other parts of the lane (riders, voice, police) listen here: S.on(name, fn). Names: unit (u), drop (u), enter (u, entrance), leave, deep (on), board (t), alight (t), hop (from unit, to unit, t),
  // train (kind 'arrive' | 'stop' | 'doors-open' | 'doors-close' | 'leave' | 'gone', t, u), step (dt, u) every game step while the player is underground
  const subs = {}; S.on = (n, f) => { (subs[n] ||= []).push(f); return S; }; const emit = (n, a, b, c) => { const L = subs[n]; if (L) for (const f of L) { try { f(a, b, c); } catch (e) { fail('listener ' + n, e); } } };
  const fail = (where, e) => { if (S.fails++ < 6) console.warn('[subway] ' + where + ': ' + String((e && e.stack) || e).slice(0, 500)); };
  for (const e of EN) { e.ca = Math.cos(e.h); e.sa = Math.sin(e.h); }
  const stOf = new Map(data.stations.map((s) => [s.id, s]));
  // The data is made for the largest map; the map loaded now may be smaller (the public build can name its own). An entrance outside this map's play area is off
  // (no kit, no gate, no way out up its stair), a station left with no entrance is not there at all and no train runs to it.
  try { const pa = (g.city && g.city.meta && g.city.meta.play) || (w.city && w.city.meta && w.city.meta.play); if (pa && P.get('subplay') !== '0') { let off = 0; const gone = [];
      for (const e of EN) if (!(e.x > pa[0] + 1 && e.x < pa[2] - 1 && e.y > pa[1] + 1 && e.y < pa[3] - 1)) { e.off = true; e.open = false; off++; }
      for (const st of data.stations) { st.ent = st.ent.filter((i) => !EN[i].off); if (!st.ent.length) gone.push(st.id); }
      for (const L of data.lines || []) L.stations = L.stations.filter((id) => !gone.includes(id));
      if (off) console.log('[subway] this map: ' + off + ' entrances outside it are off' + (gone.length ? '; stations not in it: ' + gone.join(' ') : '')); } } catch (e) { fail('play area', e); }

  // ---------------------------------------------------------------- the street: kerb stones, railings and the sign at every entrance
  const lO = meta.lOpen, W2 = meta.wStair / 2, zW = meta.zWalk, CW = 0.2;
  const kit = (() => { // one entrance in its own frame: X = the way down, Y up, Z = -across; merged, coloured per vertex
    const parts = [], add = (x0, x1, y0, y1, z0, z1, col) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); const c = new Float32Array(b.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; } b.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(b); };
    const stone = [0.42, 0.41, 0.39], green = [0.035, 0.11, 0.07], y0 = zW - 0.02, y1 = zW + 0.14;
    for (const s of [-1, 1]) add(-0.05, lO + CW, y0, y1, s > 0 ? W2 : -W2 - CW, s > 0 ? W2 + CW : -W2, stone); add(lO, lO + CW, y0, y1, -W2, W2, stone);
    const zr = W2 + CW / 2, posts = []; for (let i = 0; i <= 3; i++) posts.push([0.03 + (lO + CW / 2 - 0.03) * i / 3, zr], [0.03 + (lO + CW / 2 - 0.03) * i / 3, -zr]);
    for (const [x, z] of posts) add(x - 0.03, x + 0.03, y1, zW + 1.12, z - 0.03, z + 0.03, green);
    for (const h of [0.5, 0.8, 1.1]) { for (const s of [-1, 1]) add(0, lO + CW / 2 + 0.03, zW + h - 0.025, zW + h + 0.025, s * zr - 0.025, s * zr + 0.025, green); add(lO + CW / 2 - 0.025, lO + CW / 2 + 0.025, zW + h - 0.025, zW + h + 0.025, -zr, zr, green); }
    // the sign's frame over the far end: two posts with a lamp globe each
    for (const s of [-1, 1]) { add(lO + CW / 2 - 0.04, lO + CW / 2 + 0.04, zW + 1.12, zW + 2.75, s * zr - 0.04, s * zr + 0.04, green); const gl = new THREE.SphereGeometry(0.15, 12, 8); gl.translate(lO + CW / 2, zW + 2.9, s * zr); const c = new Float32Array(gl.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { const up = gl.attributes.position.getY(i / 3) > zW + 2.9; c[i] = up ? 0.10 : 0.85; c[i + 1] = up ? 0.55 : 0.85; c[i + 2] = up ? 0.22 : 0.8; } gl.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(gl.toNonIndexed ? gl : gl); }
    return mergeGeos(parts); })();
  const kitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.1 });
  const boardGeo = new THREE.PlaneGeometry(1, 1), streetGroup = new THREE.Group(); streetGroup.name = 'dressing_subway';      /* the name puts it under the game's draw budget (budget.js: small street things lose their sun shadow past 55 m and are not drawn past 280 m) */
  const signTex = (st) => { const c = document.createElement('canvas'); c.width = 512; c.height = 128; const q = c.getContext('2d'); q.scale(0.5, 0.5);      /* 18 signs: half size keeps them under 6 MB of texture in all */ q.fillStyle = '#0d0f10'; q.fillRect(0, 0, 1024, 256); q.fillStyle = '#f3f1ea'; q.textBaseline = 'middle';
    let fs = 84; q.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; while (q.measureText(st.name).width > 960 && fs > 40) { fs -= 4; q.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; } q.fillText(st.name, 32, 80);
    const R = (st.signRoutes || st.routes).slice(0, 12), sz = Math.min(96, (960 - (R.length - 1) * 10) / R.length); let x = 32; for (const r of R) { q.fillStyle = ROUTE_COL[r] || '#666'; rr(q, x, 150, sz, Math.min(sz, 92), 14); q.fill(); q.fillStyle = /[NQRW]/.test(r) ? '#111' : '#fff'; q.font = '800 ' + Math.round(sz * 0.68) + 'px Helvetica, Arial, sans-serif'; q.textAlign = 'center'; q.fillText(r, x + sz / 2, 150 + Math.min(sz, 92) / 2 + 3); q.textAlign = 'left'; x += sz + 10; }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  for (const st of data.stations) { const es = st.ent.map((i) => EN[i]); if (!es.length) continue;
    const im = new THREE.InstancedMesh(kit, kitMat, es.length), bm = new THREE.MeshStandardMaterial({ map: signTex(st), roughness: 0.55, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.06 }); bm.emissiveMap = bm.map;
    const bd = new THREE.InstancedMesh(boardGeo, bm, es.length);
    es.forEach((e, i) => { q4.setFromAxisAngle(UP, e.h); m4.compose(p4.set(e.x, 0, -e.y), q4, s4); im.setMatrixAt(i, m4);
      const bx = e.x + e.ca * (lO + CW / 2 - 0.05), by = e.y + e.sa * (lO + CW / 2 - 0.05); q4.setFromAxisAngle(UP, e.h - Math.PI / 2); m4.compose(p4.set(bx, zW + 2.42, -by), q4, s4.set(meta.wStair + CW + 0.1, 0.5, 1)); bd.setMatrixAt(i, m4); s4.set(1, 1, 1); });
    for (const o of [im, bd]) { o.instanceMatrix.needsUpdate = true; o.castShadow = o === im; o.receiveShadow = true; o.computeBoundingSphere(); streetGroup.add(o); }
    let cx = 0, cy = 0; for (const e of es) { cx += e.x; cy += e.y; } st.cx = cx / es.length; st.cy = cy / es.length; st.rad = Math.max(...es.map((e) => Math.hypot(e.x - st.cx, e.y - st.cy))); }
  // a CLOSED entrance (its station's hall is out of reach, or not built) is shut at the street: a folding gate across the top of the stair, solid; the steps show going down behind it
  { const closed = EN.filter((e) => !e.open && !e.off), parts = [], bar = (x0, x1, y0, y1, z0, z1) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); const c = new Float32Array(b.attributes.position.count * 3).fill(0.09); b.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(b); };
    const zr = W2 + CW / 2; for (const yy of [zW + 0.06, zW + 0.62, zW + 1.16]) bar(-0.03, 0.03, yy - 0.03, yy + 0.03, -zr, zr); for (let k = 0; k <= 12; k++) { const z = -zr + 2 * zr * k / 12; bar(-0.012, 0.012, zW + 0.03, zW + 1.19, z - 0.012, z + 0.012); }
    bar(-0.035, 0.035, zW + 0.72, zW + 0.92, -0.16, 0.16);      // the lock box
    if (closed.length) { const gm = new THREE.InstancedMesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), closed.length); closed.forEach((e, i) => { q4.setFromAxisAngle(UP, e.h); m4.compose(p4.set(e.x - e.ca * 0.02, 0, -(e.y - e.sa * 0.02)), q4, s4.set(1, 1, 1)); gm.setMatrixAt(i, m4); }); gm.instanceMatrix.needsUpdate = true; gm.castShadow = true; gm.computeBoundingSphere(); gm.name = 'subway_gates'; streetGroup.add(gm); }
    try { const st = g.statics, old = st.owner; st.owner = 'subway'; for (const e of closed) { const c = (u, v) => [e.x + e.ca * u - e.sa * v, e.y + e.sa * u + e.ca * v], a = c(-0.05, W2 + CW / 2), b = c(-0.05, -W2 - CW / 2); st.addSeg(a[0], a[1], b[0], b[1]); } st.owner = old; } catch (e) { fail('gates', e); } }
  w.scene.add(streetGroup);
  // the kerb stones and railings are solid to cars and people on the street (three sides; the top of the stair is the way in)
  try { const st = g.statics, old = st.owner; st.owner = 'subway'; for (const e of EN) { if (e.off) continue; const c = (u, v) => [e.x + e.ca * u - e.sa * v, e.y + e.sa * u + e.ca * v], a = c(-0.05, W2 + CW / 2), b = c(lO + CW / 2, W2 + CW / 2), d = c(lO + CW / 2, -W2 - CW / 2), f = c(-0.05, -W2 - CW / 2); st.addSeg(a[0], a[1], b[0], b[1]); st.addSeg(b[0], b[1], d[0], d[1]); st.addSeg(d[0], d[1], f[0], f[1]); } st.owner = old; } catch (e) { fail('statics', e); }

  // ---------------------------------------------------------------- a station's underground: built near, dropped far
  let look = null, lookP = null; const getLook = () => (lookP ||= getLook1()); const getLook1 = async () => { try { if (P.get('sublook') === 'plain') throw new Error('plain asked'); look = (await import('./look.js')).makeLook(THREE); const need = ['tile', 'tileDark', 'floor', 'platform', 'edge', 'stair', 'ceiling', 'concrete', 'trackbed', 'steel', 'metal', 'rail', 'black', 'glowWhite']; for (const k of need) if (!look.mat || !look.mat[k]) throw new Error('look.mat.' + k + ' missing'); }
    catch (e) { console.log('[subway] plain look (' + (e && e.message) + ')'); look = plainLook(THREE); }
    // (look.js makes each texture on first use: one a frame here, so nothing stalls play)
    for (const k of Object.keys(look.mat)) { const m = look.mat[k]; if (m) { m.side = THREE.DoubleSide; m.fog = false; } if (!look.plain) await new Promise((r) => setTimeout(r, 0)); }
    return look; };
  // (DoubleSide: until Nov 14 the cap's triangles faced DOWN and were culled from above, so the sidewalk was never opened: Matt's "there are no stairs". The offsets are a margin over the street layers' own.)
  const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 2.25, 2.7), fog: false, toneMapped: false, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }); glowMat.name = 'railglow';
  const unitOf = (st) => { let u = S.units.get(st.id); if (!u) S.units.set(st.id, (u = { st, state: 'none', gen: null, res: null, group: null, trains: [] })); return u; };
  const startUnit = async (u) => { u.state = 'look'; try { if (!u.st.floors) { const r = await fetch(DIR + 'st/' + u.st.id + '.json'); if (!r.ok) throw new Error('station file ' + r.status); Object.assign(u.st, await r.json()); }      /* a station's underground is its own small file, fetched when he first comes near */
      const L = await getLook(); u.gen = buildStation(THREE, u.st, meta, L, { glowMat, turnstile: P.get("turnstile") !== "0" }); u.state = 'building'; u.t0 = performance.now(); u.ms = 0; } catch (e) { fail('start ' + u.st.id, e); u.state = 'failed'; } };
  const finishUnit = (u, res) => { u.res = res; u.walk = res.walk; u.group = res.group; u.gen = null;
    // caps over the stair openings (depth only) and, for the view from below once the city is not drawn, a bright card of sky in each opening
    const cp = [], ci = [], sp = []; let n = 0;
    for (const i of u.st.ent) { const e = EN[i], c = (a, b, y) => [e.x + e.ca * a - e.sa * b, y, -(e.y + e.sa * a + e.ca * b)]; for (const [arr, y] of [[cp, zW + 0.02], [sp, zW + 0.01]]) arr.push(...c(0, -W2, y), ...c(lO, -W2, y), ...c(lO, W2, y), ...c(0, W2, y)); ci.push(n, n + 2, n + 1, n, n + 3, n + 2); n += 4; }
    const mk = (pos, mat, name) => { const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ge.setIndex(ci); ge.computeBoundingSphere(); const m = new THREE.Mesh(ge, mat); m.name = name; m.matrixAutoUpdate = false; m.frustumCulled = false; return m; };
    u.cap = mk(cp, capMat, 'sub_cap'); u.cap.renderOrder = -10; u.sky = mk(sp, skyMat, 'sub_sky'); u.sky.layers.set(LAYER); u.sky.visible = false;      /* (the game's camera sees every layer, so the card is switched by hand) */
    u.group.traverse((o) => { if (o.isMesh) o.layers.enable(LAYER); }); u.group.add(u.cap, u.sky); res.core.visible = false; if (S.own && S.unit && S.unit !== u) { res.well.visible = false; u.cap.visible = false; }
    w.scene.add(u.group); u.state = 'ready'; S.stats.built++; emit('unit', u); S.stats.buildMs = Math.round(u.ms);
    console.log('[subway] ' + u.st.name + ' underground built: ' + res.tris + ' triangles, ' + res.group.children.reduce((s, c) => s + c.children.length, 0) + ' meshes, ' + res.lamps + ' lamps, ' + Math.round(u.ms) + ' ms of work over ' + ((performance.now() - u.t0) / 1000).toFixed(1) + ' s');
    if (u === S.unit || u === S.keep) ensureTrains(u); };      // trains are only made for the station he is in or riding to (at Times Sq five stations load at once)
  const ensureTrains = (u) => { if (u._tr || !u.st.built || !u.st.tracks || u.state !== 'ready') return; u._tr = startTrains(u).catch((e) => fail('trains', e)); };
  const dropUnit = (u) => { emit('drop', u); if (u.group) { w.scene.remove(u.group); u.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); } for (const t of u.trains) { try { t.train.dispose(); } catch (e) {} } u.trains = []; u._tr = null; u.group = u.res = u.walk = u.gen = null; u.state = 'none'; S.stats.dropped++; };
  let scanT = 0;
  const manage = (dt) => { scanT -= dt; const px = pl.x, py = pl.y;
    if (scanT <= 0) { scanT = 0.4; for (const st of data.stations) { if (st.cx === undefined) continue; const d = Math.hypot(px - st.cx, py - st.cy) - st.rad, u = S.units.get(st.id);
        if (d < NEAR && (!u || u.state === 'none')) { let near = false; for (const i of st.ent) if (Math.hypot(px - EN[i].x, py - EN[i].y) < NEAR) { near = true; break; } if (near) startUnit(unitOf(st)); }
        else if (u && u.state === 'ready' && u !== S.unit && u !== S.keep && d > FAR) dropUnit(u); } }
    for (const u of S.units.values()) if (u.state === 'building') { const t0 = performance.now(), budget = S.own || window.__subFast ? 30 : 3.5; try { let r; do { r = u.gen.next(); } while (!r.done && performance.now() - t0 < budget); u.ms += performance.now() - t0; if (r.done) finishUnit(u, r.value); } catch (e) { fail('build ' + u.st.id, e); u.state = 'failed'; } break; } };

  // ---------------------------------------------------------------- trains
  // TRAINS AS LONG AS THEIR PLATFORMS (handover-19; ?subcars=8 = eight cars everywhere, as before): as many cars as fit the shortest platform of the station's line
  // (15.6 m cars on the numbered lines, 18.4 m on the lettered: ten on the Lexington Av line, eleven on the 7, nine or ten elsewhere); eight cars left 20 to 30 m of
  // platform with no car at each end. A count other than 8 written in the data (the shuttle's five) stands.
  const carsOf = (st) => { const fx = +P.get('subcars'); if (fx >= 2 && fx <= 11) return fx; if (st.cars && st.cars !== 8) return st.cars; const L = (data.lines || []).find((l) => l.id === st.line); let m = st.plen || 150;
    // (handover-21) lines joined by a route that leaves its line (data.branches: the E, B, D, F, M tie the 8 Av, 6 Av, 53 St and 57 St lines) take ONE length, or a rider
    // in an end car arrives standing beyond the end of a shorter train (seen: Columbus Circle, ten cars -> 7 Av, nine)
    const ids = new Set(L ? L.stations : [st.id]); for (let grew = true; grew;) { grew = false; for (const b of BR) if (b.stops.some((q) => ids.has(q[0]))) for (const q of b.stops) { const l2 = (data.lines || []).find((l) => l.id === (stOf.get(q[0]) || {}).line); for (const id of l2 ? l2.stations : [q[0]]) if (!ids.has(id)) { ids.add(id); grew = true; } } }
    for (const id of ids) { const q = stOf.get(id); if (q && q.plen && (q.div || 'B') === (st.div || 'B') && !(q.cars && q.cars !== 8)) m = Math.min(m, q.plen); } return clamp(Math.floor(m / ((st.div || 'B') === 'A' ? 15.6 : 18.4)), 5, 11); };
  const startTrains = async (u) => { let mod; try { mod = await import('./train.js'); } catch (e) { console.log('[subway] no train.js: ' + (e && e.message)); return; } if (u.state !== 'ready') return;
    const st = u.st; let k = 0;
    for (const T of st.tracks) { const route = T.routes[k % T.routes.length], tr = mod.buildTrain(THREE, { cars: carsOf(st), div: st.div || 'B', route: { label: route, color: ROUTE_COL[route] || '#888' }, seed: 7 + T.id });
      tr.group.traverse((o) => { o.layers.enable(LAYER); if (o.isMesh) { o.frustumCulled = false; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && !m.userData.subK) { m.userData.subK = 1; m.fog = false; } } }); tr.group.visible = false; u.res.core.add(tr.group);
      const dx = T.b[0] - T.a[0], dy = T.b[1] - T.a[1], L = Math.hypot(dx, dy), ux = dx / L * T.dir, uy = dy / L * T.dir;
      const far = st.plen / 2 + st.tun - tr.length / 2 - 3;
      u.trains.push({ T, train: tr, ux, uy, mx: (T.a[0] + T.b[0]) / 2, my: (T.a[1] + T.b[1]) / 2, far, c: -far, v: 0, state: 'wait', t: 6 + k * 13 + (T.kind === 'express' ? 9 : 0), doors: 0, side: T.dir > 0 ? -T.side : T.side /* train +X is the left of its travel on the map; the platform is at -T.side across the track */, routeI: k % T.routes.length, u });
      tr.group.rotation.y = Math.atan2(ux, -uy); k++; }
    S.trainK = (v) => { for (const t of u.trains) scaleTrain(t.train, v); }; };
  // sound through the game's own little synth (audio.js): a rumble coming in and going out, brakes, a two-note door chime; quieter with distance along the platform
  S.sound = (kind, t) => { try { const sn = g.sound; if (!sn || !sn.on || !S.own) return; const d = Math.hypot(t.mx + t.ux * t.c - pl.x, t.my + t.uy * t.c - pl.y), near = Math.hypot(t.mx - pl.x, t.my - pl.y), v = clamp(1.2 - near / 140, 0.15, 1);
      if (kind === 'arrive') { for (let i = 0; i < 7; i++) setTimeout(() => S.own && sn.burst(2.6, (0.05 + 0.035 * i) * v, 140 + i * 22), i * 2200); setTimeout(() => S.own && sn.shot(2300, 2.4, 'sawtooth', 0.012 * v, -900), 15500); }
      else if (kind === 'doors') { sn.shot(784, 0.22, 'sine', 0.10 * v); setTimeout(() => sn.shot(622, 0.3, 'sine', 0.10 * v), 240); sn.burst(0.5, 0.08 * v, 1800); }
      else if (kind === 'leave') { for (let i = 0; i < 6; i++) setTimeout(() => S.own && sn.burst(2.6, (0.24 - 0.035 * i) * v, 120 + i * 30), i * 2000); sn.shot(180, 5, 'sawtooth', 0.02 * v, 260); } } catch (e) {} };
  const scaleTrain = (tr, amb) => { try { tr.setAmbient(amb * K); } catch (e) {} };
  const VMAX = 15, DEC = 1.05, ACC = 0.95;
  const stepTrains = (u, dt) => { for (const t of u.trains) { const tr = t.train;
      if (t.state === 'wait') { t.t -= dt; if (t.t <= 0) { t.state = t.T.plat < 0 ? 'thru' : 'in'; t.c = -t.far; t.v = VMAX; tr.group.visible = true; try { tr.setDoors(0, 0); tr.setLights({ front: 1, interior: K * 1.15 }); const r = t.T.routes[t.routeI++ % t.T.routes.length]; t.route = r; tr.setRoute({ label: r, color: ROUTE_COL[r] || '#888', dest: destOf(t.T, r) }); } catch (e) { fail('train', e); } S.sound && S.sound('arrive', t); emit('train', 'arrive', t, u); } }
      else if (t.state === 'thru') { t.v = VMAX + 3; t.c += t.v * dt; if (t.c > t.far) { t.state = 'wait'; t.t = 35 + ((t.T.id * 53 + Math.floor(g.t)) % 40); tr.group.visible = false; emit('train', 'gone', t, u); } }      // a track with no platform here: the express runs through
      else if (t.state === 'in') { const stop = Math.sqrt(Math.max(0, 2 * DEC * -t.c)); t.v = Math.min(VMAX, Math.max(0.35, stop)); t.c += t.v * dt; if (t.c >= 0) { t.c = 0; t.v = 0; t.state = 'dwell'; t.t = 0; emit('train', 'stop', t, u); } }
      else if (t.state === 'dwell') { t.t += dt; const f = t.t < 1.2 ? 0 : t.t < 2.8 ? (t.t - 1.2) / 1.6 : t.t < 13.5 ? 1 : t.t < 15.1 ? 1 - (t.t - 13.5) / 1.6 : 0; if (f !== t.doors) { if ((t.doors === 0 && f > 0) || (t.doors === 1 && f < 1)) { S.sound && S.sound('doors', t); emit('train', t.doors === 0 ? 'doors-open' : 'doors-close', t, u); } t.doors = f; try { tr.setDoors(t.side, f * f * (3 - 2 * f)); } catch (e) { fail('doors', e); } } if (S.ride && S.ride.t === t && !nextStation(u.st, t.T.dir, t.T.key, t.route) && t.t > 4) t.t = Math.min(t.t, 12);      /* last stop in our map: the doors stay open until he gets off */
        if (t.t > 16.6) { t.state = 'out'; S.sound && S.sound('leave', t); emit('train', 'leave', t, u); if (S.ride && S.ride.t === t) { const N = nextStation(u.st, t.T.dir, t.T.key, t.route); if (N) { const nu = unitOf(N); S.keep = nu; if (nu.state === 'none') startUnit(nu); else ensureTrains(nu); } } } }
      else if (t.state === 'out') { t.v = Math.min(VMAX + 2, t.v + ACC * dt); t.c += t.v * dt; if (S.ride && S.ride.t === t && t.c > Math.min(t.far - 12, u.st.plen / 2 + tr.length / 2 + 30)) { if (hop(u, t)) return; t.c = Math.min(t.c, t.far - 2); }      /* the whole train is in the dark of the tunnel: change stations */
        if (t.c > t.far) { t.state = 'wait'; t.t = 28 + ((t.T.id * 37 + S.stats.built * 11 + Math.floor(g.t)) % 30); tr.group.visible = false; emit('train', 'gone', t, u); } }
      if (tr.group.visible) { const inSt = clamp(1 - (Math.abs(t.c) - (u.st.plen / 2 - tr.length / 2)) / tr.length, 0, 1), sw = rideMotion(t); tr.group.position.set(t.mx + t.ux * t.c, t.T.z + sw.bob, -(t.my + t.uy * t.c)); tr.group.rotation.z = sw.roll; scaleTrain(tr, 0.07 + 0.93 * inSt);
        if (tr.setStation) { const R = S.ride; tr.setStation(R && R.t === t ? clamp((u.st.plen / 2 + 7 - Math.abs(t.c + R.lz)) / 14, 0, 1) : inSt); }      /* the car brightens as HIS car comes into the station (train.js lifts the inside by a fifth) */
        tr.group.updateMatrixWorld(true); } } };
  // THE RIDE (car look, Nov 14; ?subsway=0 leaves it out): with speed the train rolls a little from side to side and bounces, with a knock at every rail joint (11.9 m); the camera
  // takes 0.6 of it (placeCam), so both the car and the tunnel move against the eye. Small on purpose (the roll is under one degree): the player and the riders stand where the still car has them, never more than about 2 cm off.
  const SWAY = P.get('subsway') !== '0', sway0 = { roll: 0, bob: 0 };
  const rideMotion = (t) => { if (!SWAY || t.v < 0.05) { t.sway = sway0; return sway0; } const k = clamp(t.v / VMAX, 0, 1.15), tt = g.t || 0, jt = (((t.c % 11.9) + 11.9) % 11.9) / Math.max(2, t.v), kn = Math.exp(-jt * 9) * Math.sin(jt * 46), sw = t.sway && t.sway !== sway0 ? t.sway : (t.sway = { roll: 0, bob: 0 });
    sw.roll = k * (0.0075 * Math.sin(tt * 1.7) + 0.0045 * Math.sin(tt * 3.1 + 1.3) + 0.003 * Math.sin(tt * 0.63 + 0.5)); sw.bob = k * (0.006 * Math.sin(tt * 5.3) + 0.004 * Math.sin(tt * 8.9 + 2) + 0.008 * kn); return sw; };
  // the motors' whine while he is aboard (WebAudio through the game's own output and mute switch): two saws an octave apart through a low-pass, the pitch rising with speed,
  // louder while the train pulls or brakes than while it coasts, over a low rumble that grows with speed. Fades out when he steps off. (Announcements and chimes are voice.js's.)
  // aboard, the game's ambient-occlusion pass is turned down to a third: at the street's radius it draws dark smudges round the car's thin rails and poles (?subao=1 leaves it alone)
  let ao0 = null; const rideAO = (on) => { const ao = w.gtao; if (!ao || P.get('subao') === '1' || on === (ao0 !== null)) return; if (on) { ao0 = ao.blendIntensity; ao.blendIntensity = ao0 * 0.3; } else { ao.blendIntensity = ao0; ao0 = null; } };
  let wh = null;
  const whine = (t, dt) => { const sn = g.sound, ac = sn && sn.on && sn.ac;
    if (!t || !ac || ac.state !== 'running' || !sn.out || P.get('subwhine') === '0') { if (wh) { try { const n = wh.ac.currentTime; wh.g.gain.setTargetAtTime(0, n, 0.12); wh.ng.gain.setTargetAtTime(0, n, 0.12); } catch (e) {} if (++wh.idle > 240) { try { wh.o1.stop(); wh.o2.stop(); wh.n.stop(); wh.g.disconnect(); wh.ng.disconnect(); } catch (e) {} wh = null; } } return; }
    if (!wh) { try { const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o2g = ac.createGain(), f = ac.createBiquadFilter(), gn = ac.createGain(), n = ac.createBufferSource(), nf = ac.createBiquadFilter(), ng = ac.createGain(); o1.type = 'sawtooth'; o2.type = 'sawtooth'; o2g.gain.value = 0.45; f.type = 'lowpass'; f.Q.value = 3; gn.gain.value = 0; o1.connect(f); o2.connect(o2g); o2g.connect(f); f.connect(gn); gn.connect(sn.out);
        n.buffer = sn.white; n.loop = true; nf.type = 'lowpass'; nf.frequency.value = 170; ng.gain.value = 0; n.connect(nf); nf.connect(ng); ng.connect(sn.out); o1.start(); o2.start(); n.start(); wh = { ac, o1, o2, n, f, g: gn, ng, v0: t.v, a: 0, idle: 0 }; } catch (e) { fail('whine', e); return; } }
    wh.idle = 0; const v = t.v, acc = dt > 0 ? (v - wh.v0) / dt : 0; wh.v0 = v; wh.a += (clamp(Math.abs(acc) / 0.9, 0, 1) - wh.a) * Math.min(1, dt * 2.5); const now = ac.currentTime, fr = 110 + v * 33;
    wh.o1.frequency.setTargetAtTime(fr, now, 0.06); wh.o2.frequency.setTargetAtTime(fr * 2.02, now, 0.06); wh.f.frequency.setTargetAtTime(420 + v * 95, now, 0.1);
    wh.g.gain.setTargetAtTime((0.010 + 0.034 * wh.a) * clamp(v / 2.5, 0, 1), now, 0.1); wh.ng.gain.setTargetAtTime(0.11 * clamp(v / VMAX, 0, 1.15), now, 0.25); };
  S.whine = () => wh && { f: +wh.o1.frequency.value.toFixed(1), g: +wh.g.gain.value.toFixed(4), n: +wh.ng.gain.value.toFixed(4) };

  // ---------------------------------------------------------------- the player underground
  const pos = { x: 0, y: 0, z: 0 }; let visZ = 0, jumpWas = true, saved = null, dropV = -1; const DROP = P.get('stairdrop') !== '0';      /* gameplay/jump handover-3: a jump that comes down inside the open top of a street stair falls onto the steps under it (?stairdrop=0: he stands on air over the well, as before) */
  const free = () => { const h = g.heli; return !pl.vehicle && !pl.busy && !(h && (h.piloted || h.busy || h.hasCamera)) && !(g.fly && g.fly.on) && !(g.jump && g.jump.core && g.jump.core.own) && !(g.combat && g.combat.dead); };
  const figureLayers = () => { try { pl.vis.object.traverse((o) => o.layers.enable(LAYER)); } catch (e) {} };
  const setOrder = (v) => { if (S._ord === v) return; S._ord = v; try { pl.vis.object.traverse((o) => { if (o.isMesh) o.renderOrder = v; }); } catch (e) {} };
  const hemi = new THREE.HemisphereLight(0xfff3dc, 0x7d776c, 0.75 * K / 0.3), key = new THREE.DirectionalLight(0xfff6e6, 0.5 * K / 0.3); hemi.layers.set(LAYER); key.layers.set(LAYER); key.position.set(0.3, 1, 0.2); w.scene.add(hemi, key, key.target);
  const setDeep = (on) => { if (S.deep === on) return; S.deep = on; emit('deep', on); try { const c = w.cam; if (c && c.taa && P.get('subtaa') !== '0') c.taa.valid = false; } catch (e) {}      /* the picture changes whole at this step (street off, or back on): the camera lane's frame blending carried the old picture over the new for about 0.3 s, a white veil over the far end of the hall (out/v7b-burst-rock/sheet.jpg); its history is dropped, so the next frame stands alone */ for (const u of S.units.values()) if (u.sky) u.sky.visible = on && u === S.unit;      /* only the sky up HIS station's stairs: a crossing station's card stood in the hall as a white shaft (Herald Sq N Q R W, out/all-heraldq/07-down-hall.jpg) */
    if (on) { saved = { mask: w.camera.layers.mask, env: w.scene.environmentIntensity, off: w.streetOff, bg: w.scene.background }; w.camera.layers.set(LAYER); w.scene.environmentIntensity = 0.03; w.streetOff = true; figureLayers(); }
    else if (saved) { w.camera.layers.mask = saved.mask; w.scene.environmentIntensity = saved.env; w.streetOff = saved.off; saved = null; } };
  const enter = (u, e) => { S.entry = e; S.own = true; S.unit = u; pos.x = pl.x; pos.y = pl.y; const f = u.st.floors.find((q) => q.k === 'street' && q.ent === e.id), uu = clamp(Walk.u(f, pl.x, pl.y), -f.l / 2 + 0.06, f.l / 2), vv = clamp(Walk.v(f, pl.x, pl.y), -f.w / 2 + R_BODY + 0.02, f.w / 2 - R_BODY - 0.02);
    pos.x = f.x + f.ca * uu - f.sa * vv; pos.y = f.y + f.sa * uu + f.ca * vv; pos.z = Walk.zAt(f, uu); visZ = zW; dropV = DROP && zW - pos.z > 0.9 ? 0 : -1; S.floor = f; pl.roof = null; if (g.jump) { jumpWas = g.jump.on; g.jump.on = false; } u.res.core.visible = true; showWells(u); ensureTrains(u); figureLayers(); if (window.__mark) window.__mark('subway-in'); emit('enter', u, e); };
  // underground, only the station he is in is drawn: two stations of one complex cross each other in plan (Times Sq, Herald Sq), and their stairs and passages would stand in each other's halls
  const showWells = (only) => { for (const q of S.units.values()) if (q.res) { q.res.well.visible = !only || q === only; if (q.cap) q.cap.visible = !only || q === only; } };
  const leave = (x, y) => { if (paid?.turning) finishTurn(paid); else clearFare(); jumpTime = 0; emit('leave', S.unit); S.entry = null; S.own = false; S.ride = null; S.sit = null; S.keep = null; if (chip) hint(null); setDeep(false); setOrder(0); pl.x = x; pl.y = y; pl.alt = 0; if (g.jump) g.jump.on = jumpWas; if (S.unit) S.unit.res.core.visible = false; showWells(null); S.unit = null; S.floor = null; if (window.__mark) window.__mark('subway-out'); };
  S.leave = () => { if (S.own) leave(pl.x, pl.y); };
  const stairZ = (f, x, y) => { const u = Walk.u(f, x, y), n = f.n || 1, dn = f.z0 > f.z1 ? 1 : -1, d = clamp(dn * u + f.l / 2, 0, f.l - 1e-6), i = Math.floor(d / (f.l / n)); return Math.max(f.z0, f.z1) - (i + 1) * meta.rise; };

  // ---------------------------------------------------------------- riding (v2): step in through an open door, ride to the next station of the line, step out
  // the next station up or down the line; with a track key (the train's), the next one where THAT track has a platform (an express skips the local stops)
  const nextLine = (st, dir, key) => { const L = (data.lines || []).find((l) => l.id === st.line); if (!L) return null; let i = L.stations.indexOf(st.id); if (i < 0) return null; for (;;) { i += dir > 0 ? 1 : -1; const id = L.stations[i]; if (!id) return null; const N = stOf.get(id); if (!key || (N.tracks || []).some((q) => q.key === key && q.plat >= 0)) return N; } };
  // WHERE A ROUTE LEAVES ITS LINE (data.branches; handover-15): the train's route is asked first (the E turns off the 8 Av line after 50 St and runs under 53rd St, the B and D go on
  // from 7 Av to Columbus Circle, the F runs under 53rd St, the M to 57 St), then the station's line as before. A stop = [station, the track key going on, the key coming back].
  // Data without branches (the three-area set) behaves as it always did. ?subbranch=0 off.
  const BR = P.get('subbranch') === '0' ? [] : (data.branches || []).map((b) => ({ routes: b.routes, stops: b.stops.filter((q) => { const t = stOf.get(q[0]); return t && t.built && t.ent.length; }) }));
  const brAt = (st, key, route) => { if (key && route) for (const b of BR) { if (!b.routes.includes(route)) continue; const i = b.stops.findIndex((q) => q[0] === st.id); if (i < 0) continue; const d = key === b.stops[i][1] ? 1 : key === b.stops[i][2] ? -1 : 0; if (d) return { b, i, d }; } return null; };
  const nextHop = (st, dir, key, route) => { const a = brAt(st, key, route), n = a && a.b.stops[a.i + a.d]; if (n) return { N: stOf.get(n[0]), key: a.d > 0 ? n[1] : n[2] }; const N = nextLine(st, dir, key); return N ? { N, key } : null; };
  const nextStation = (st, dir, key, route) => { const h = nextHop(st, dir, key, route); return h ? h.N : null; };
  S.dirOf = (t, route) => { const a = t && t.u && brAt(t.u.st, t.T.key, route || t.route); return a ? a.d : t.T.dir; };      // +1 = the route's uptown way (at 7 Av the E runs against the track's own sense)
  const EXPR = new Set((data.lines || []).flatMap((l) => l.express || [])), destOf = (T, r) => (r === 'S' ? 'SHUTTLE' : T.kind === 'express' && EXPR.has(r) ? 'EXPRESS' : 'LOCAL');      // (the E on 7 Av's tracks is a local)
  const tLocal = (t, x, y) => { const dx = x - (t.mx + t.ux * t.c), dy = y - (t.my + t.uy * t.c); return [-dx * t.uy + dy * t.ux, dx * t.ux + dy * t.uy]; };      // [across (train +X), along]
  const tMap = (t, lx, lz) => [t.mx + t.ux * t.c + t.ux * lz - t.uy * lx, t.my + t.uy * t.c + t.uy * lz + t.ux * lx];
  const inCar = (t, lx, lz, open) => { const tr = t.train, m = 0.22; for (const w of tr.walk) if (lx >= w.x0 + m && lx <= w.x1 - m && lz >= w.z0 + m && lz <= w.z1 - m) return true;
    for (const d of tr.doorways || []) { if (lz < d.z0 + m || lz > d.z1 - m) continue; if (lx >= Math.min(d.x0, d.x1) - m && lx <= Math.max(d.x0, d.x1) + (0)) return true; if (open && d.side === t.side && lx * d.side > 0 && Math.abs(lx) < tr.width / 2 + 0.75) return true; } return false; };
  const tryBoard = (u, dx, dy) => { for (const t of u.trains) { if (t.state !== 'dwell' || t.doors < 0.85) continue; const [lx, lz] = tLocal(t, pos.x + dx, pos.y + dy), [lx0] = tLocal(t, pos.x, pos.y), tr = t.train; if (lx0 * t.side < tr.width / 2 || Math.abs(lx) > tr.width / 2 + 0.6) continue;
      for (const d of tr.doors) { if (d.side !== t.side || Math.abs(lz - d.z) > d.w / 2 - 0.2) continue; S.ride = { t, lx: t.side * (tr.width / 2 + 0.05), lz: clamp(lz, d.z - d.w / 2 + 0.3, d.z + d.w / 2 - 0.3) }; if (window.__mark) window.__mark('subway-board'); emit('board', t); return true; } } return false; };
  // SITTING (Matt, Nov 14: "i should be able to sit there lol ... like in the car"): F by a seat sits him down on it, F again stands him up; he rides seated, the camera a little lower
  let chip = null; const hint = (txt, plain) => { if (!chip) { chip = document.createElement('div'); chip.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:40;font:600 13px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.72);padding:6px 12px;border-radius:7px;pointer-events:none;display:none'; document.body.appendChild(chip); } if (txt) { if (chip._t !== txt) { chip._t = txt; chip.innerHTML = (plain ? '' : '<span style="background:#ffd27a;color:#111;border-radius:4px;padding:1px 6px;margin-right:7px">F</span>') + txt; } chip.style.display = ''; } else chip.style.display = 'none'; };
  const seatNear = (R) => { let b = null, bd = 1.25; for (const q of R.t.train.seats || []) { const d = Math.hypot(q.x - R.lx, q.z - R.lz); if (d < bd && !(S.seatTaken && S.seatTaken(R.t, q))) { bd = d; b = q; } } return b; };
  const gunAway = () => { try { const c = g.combat; if (c && c.slot && c.slot !== 'unarmed' && c.equip) { if (S.sit && !S.sit.gun) S.sit.gun = c.slot; c.swap = null; c.equip('unarmed', true); } } catch (e) { fail('gun away', e); } };
  const sitDown = (R, q) => { S.sit = { seat: q, lx0: R.lx, lz0: R.lz }; gunAway(); R.lx = q.x; R.lz = q.z; emit('sit', R.t, q); if (window.__mark) window.__mark('subway-sit'); };
  const standUp = (R) => { try { const c = g.combat, k = S.sit.gun; if (k && c && c.equip && c.slot === 'unarmed') c.equip(k); } catch (e) { fail('gun back', e); } const q = S.sit.seat, w = R.t.train.walk.find((k) => q.z >= k.z0 - 0.5 && q.z <= k.z1 + 0.5) || R.t.train.walk[0]; R.lx = clamp(q.x + q.face * 0.55, w.x0 + 0.24, w.x1 - 0.24); R.lz = clamp(q.z, w.z0 + 0.24, w.z1 - 0.24); S.sit = null; emit('stand', R.t, q); };
  const lastStop = (t) => t.state === 'dwell' && !nextStation(t.u.st, t.T.dir, t.T.key, t.route);
  const rideStep = (dt, I, m, use) => {
    if (S.sit) { const R = S.ride, t = R.t, q = S.sit.seat; if (use) standUp(R); else { gunAway(); const [x, y] = tMap(t, q.x, q.z); pos.x = x; pos.y = y; pos.z = t.T.z + t.train.floorY; pl.h = Math.atan2(t.ux * q.face, -t.uy * q.face); pl.speed = 0; hint(lastStop(t) ? 'Stand up: last stop' : 'Stand up'); return; } }
    else { const q = seatNear(S.ride); if (q && use) { sitDown(S.ride, q); return; } if (q) hint(lastStop(S.ride.t) ? 'Sit (last stop: this train goes no further)' : 'Sit'); else if (lastStop(S.ride.t)) hint('Last stop: this train goes no further', true); else hint(null); } const R = S.ride, t = R.t, tr = t.train, open = t.state === 'dwell' && t.doors > 0.85;
    if (!open && Math.abs(R.lx) > tr.width / 2 - 0.5) R.lx = Math.sign(R.lx) * (tr.width / 2 - 0.5);      // the doors are closing: he is inside
    if (m > 0.1) { const sp = (I.run ? 3.2 : 1.7) * Math.min(1, m), dx = Math.cos(pl.h) * sp * dt, dy = Math.sin(pl.h) * sp * dt, dlx = -dx * t.uy + dy * t.ux, dlz = dx * t.ux + dy * t.uy;
      for (const [a, b] of [[dlx, dlz], [dlx, 0], [0, dlz]]) { if (!a && !b) continue; const nx = R.lx + a, nz = R.lz + b;
        if (open && nx * t.side > tr.width / 2 + 0.42) { const [x, y] = tMap(t, t.side * (tr.width / 2 + 0.5), nz), uu = t.u, f = uu.walk.free(x, y, meta.zP, R_BODY); if (f) { pos.x = x; pos.y = y; pos.z = meta.zP; S.floor = f; S.ride = null; if (window.__mark) window.__mark('subway-alight'); emit('alight', t); return; } continue; }      // out through the open door
        if (inCar(t, nx, nz, open)) { R.lx = nx; R.lz = nz; break; } } }
    const [x, y] = tMap(t, R.lx, R.lz); pos.x = x; pos.y = y; pos.z = t.T.z + tr.floorY; };
  // deep in the dark of the tunnel the ride changes stations: the same train, now coming in to the next station of the line (its neighbourhood is built while the train pulls out)
  const hop = (u, t) => { const H = nextHop(u.st, t.T.dir, t.T.key, t.route), N = H && H.N; if (!N) return false; const nu = unitOf(N); S.keep = nu; if (nu.state !== 'ready' || !nu.trains.length) { if (nu.state === 'none') startUnit(nu); else ensureTrains(nu); return false; }
    const nt = nu.trains.find((q) => q.T.key === H.key) || nu.trains.find((q) => q.T.dir === t.T.dir && q.T.plat >= 0); if (!nt) return false; const R = S.ride, tr = nt.train;
    if (S.sit) {
      // Each station builds its own train and seat objects.
      const old = S.sit.seat;
      const seat = tr.seats.find(q => q.car === old.car && q.face === old.face &&
        Math.abs(q.x - old.x) < 0.01 && Math.abs(q.z - old.z) < 0.01);
      if (seat && !S.seatTaken?.(nt, seat)) {
        S.sit.seat = seat;
        R.lx = seat.x;
        R.lz = seat.z;
      } else {
        standUp(R);
        hint(null);
      }
    }
    const z0 = Math.min(...tr.walk.map(q => q.z0)) + 0.3, z1 = Math.max(...tr.walk.map(q => q.z1)) - 0.3;
    R.lz = clamp(R.lz, z0, z1);
    const c1 = -Math.min(nt.far, N.plen / 2 + tr.length / 2 + 25);      // it comes in from the dark, the whole train still in the tunnel
    nt.state = 'in'; nt.c = c1; nt.v = t.v; S.keep = null; nt.doors = 0; nt.t = 0; tr.group.visible = true; try { tr.setDoors(0, 0); tr.setLights({ front: 1, interior: K * 1.15 }); const r = t.route || t.T.routes[(t.routeI + t.T.routes.length - 1) % t.T.routes.length]; nt.route = r; tr.setRoute({ label: r, color: ROUTE_COL[r] || '#888', dest: destOf(nt.T, r) }); } catch (e) {}
    t.state = 'wait'; t.t = 40; t.train.group.visible = false; const da = Math.atan2(nt.uy, nt.ux) - Math.atan2(t.uy, t.ux); pl.h += da; g.cam.yaw += da;
    R.t = nt; u.res.core.visible = false; nu.res.core.visible = true; if (u.sky) u.sky.visible = false; if (nu.sky) nu.sky.visible = !!S.deep; S.unit = nu; showWells(nu); const [x, y] = tMap(nt, R.lx, R.lz); pos.x = x; pos.y = y; pl.x = x; pl.y = y; g.cam.tx = x; g.cam.ty = y; S._clip = undefined; S.stats.hops = (S.stats.hops || 0) + 1; if (window.__mark) window.__mark('subway-hop'); emit('hop', u, nu, nt);
    console.log('[subway] riding ' + u.st.name + ' -> ' + N.name); return true; };
  let paid = null, exitTurn = null, jumpTime = 0, jumpHeld = false, fareReported = false;
  function clearFare() {
    if (paid && paid.screen) paid.screen.visible = false;
    paid = null;
  }
  // Last instant at bar height on the 7*t*(0.8-t) jump arc, at running speed.
  const jumpReach = 5.2 * (0.4 + Math.sqrt(0.4 ** 2 - 0.8 / 7));
  function fareInput(gates, use, jump, dt) {
    jumpTime = Math.max(0, jumpTime - dt);
    let near = null;
    for (const gate of gates) {
      const x = pos.x - gate.x, y = pos.y - gate.y;
      if (Math.abs(pos.z - gate.z) > 0.35 || Math.abs(-x * gate.sa + y * gate.ca) > gate.width / 2) continue;
      const u = gate.pd * (x * gate.ca + y * gate.sa);
      // A runner can take off before reaching the reader and still clear the bar.
      if (jump && !jumpHeld && !jumpTime && Math.abs(u) <= jumpReach) {
        jumpTime = 0.8; fareReported = false;
      }
      if (Math.abs(u) > 1.35) continue;
      near = gate;
      if (u < 0 && paid !== gate && !paid?.turning) {
        hint('Tap or swipe');
        if (use) {
          // A new entry payment starts a fresh cycle after a partial outward crossing.
          if (exitTurn === gate) finishTurn(gate);
          clearFare(); paid = gate; if (gate.screen) gate.screen.visible = true; g.sound.shot(1046, 0.09); }
      }
      break;
    }
    if (paid !== near && !paid?.turning) clearFare();
    if (paid?.turning && paid !== near) finishTurn(paid);
    if (exitTurn && exitTurn !== near) finishTurn(exitTurn);
    jumpHeld = jump;
  }
  const thirdTurn = 2 * Math.PI / 3;
  function finishTurn(gate) {
    gate.angle = gate.turnBase + thirdTurn;
    gate.arm.setRotationFromAxisAngle(gate.axis, gate.angle);
    gate.turning = false;
    if (exitTurn === gate) exitTurn = null;
    if (paid === gate) clearFare();
  }
  function fareMove(walk, gates, dx, dy, radius) {
    // Recover a body overlapping a cabinet into the adjacent lane without
    // changing its distance along the lane or crossing the fare boundary.
    for (const gate of gates) {
      const x = pos.x - gate.x, y = pos.y - gate.y;
      const lateral = -x * gate.sa + y * gate.ca;
      if (Math.abs(pos.z - gate.z) > 0.35 || Math.abs(x * gate.ca + y * gate.sa) > 1 ||
          Math.abs(lateral) > gate.width / 2 + radius) continue;
      const exiting = gate.pd * (dx * gate.ca + dy * gate.sa) < 0;
      if (!walk.free(pos.x, pos.y, pos.z, radius) ||
          (exiting && !walk.free(pos.x + dx, pos.y + dy, pos.z, radius))) {
        const cx = pos.x + lateral * gate.sa, cy = pos.y - lateral * gate.ca;
        if (walk.free(cx, cy, pos.z, radius)) { pos.x = cx; pos.y = cy; }
      }
      break;
    }
    const old = { ...pos }, floor = walk.move(pos, dx, dy, radius);
    for (const gate of gates) {
      const along = p => ((p.x-gate.x)*gate.ca + (p.y-gate.y)*gate.sa)*gate.pd;
      const before = along(old), after = along(pos);
      if (Math.abs(pos.z-gate.z)>0.35 || Math.abs(-(pos.x-gate.x)*gate.sa+(pos.y-gate.y)*gate.ca)>gate.width/2+radius) continue;
      const forward = after > before, air = jumpTime*(0.8-jumpTime)*7;
      // Only entry requires payment. The station side must always allow egress.
      if (air < 0.8 && forward && before < 0 && after > -radius && paid !== gate) {
        Object.assign(pos, old); return S.floor;
      }
      const entering = paid === gate && forward && after > -radius;
      const exiting = after < before && air < 0.8 &&
        ((before >= 0 && after < 0) || exitTurn === gate);
      if (entering || exiting) {
        if (!gate.turning) { gate.turnBase = gate.angle || 0; gate.turning = true; }
        if (exiting) exitTurn = gate;
        const progress = exiting ? -after / radius : (after + radius) / (2 * radius);
        gate.angle = Math.max(gate.angle || 0, gate.turnBase + thirdTurn * Math.min(1, progress));
        gate.arm.setRotationFromAxisAngle(gate.axis, gate.angle);
        if (progress >= 1) finishTurn(gate);
      } else if ((before < 0) !== (after < 0)) {
        if (forward && air >= 0.8 && !fareReported) {
          fareReported = true;
          const heat = g.combat?.heat;
          const entry = S.entry && S.entry.st === S.unit?.st?.id ? S.entry : null;
          if (heat) Promise.resolve(heat.start ? heat.start('fare') : heat).then(h => h?.crime('fare', old.x, old.y, 1, entry));
        }
      }
    }
    return floor;
  }
  let step0 = null;      // the game's step with everyone else's wrappers on it (taken on the first drawn frame, so that ours is the outermost)
  const myStep = function (dt) {
    if (!S.own) { step0(dt); if (wh) whine(null, dt); if (ao0 !== null) rideAO(false); try { manage(dt);
        if (free()) for (const u of S.units.values()) { if (u.state !== 'ready') continue; for (const i of u.st.ent) { const e = EN[i], dx = pl.x - e.x, dy = pl.y - e.y; if (Math.abs(dx) > (DROP ? lO + 1 : 3) || Math.abs(dy) > (DROP ? lO + 1 : 3)) continue; const uu = dx * e.ca + dy * e.sa, vv = -dx * e.sa + dy * e.ca; if (e.open && uu > 0.04 && uu < (DROP ? lO + CW / 2 : 1.3) && Math.abs(vv) < W2 + 0.1) { enter(u, e); break; } } if (S.own) break; } } catch (e) { fail('street step', e); } return; }
    // underground: the game's own step runs (input, the turn of the body, animation, everything else in the city), then its move is undone and ours made
    const I = g.input, keyUse = I.use, padWasDown = g._gpUse; I.use = false; pl.x = pos.x; pl.y = pos.y; pl.alt = visZ || -0.001;
    if (S.sit) { const pa = g.playerAnim; g.playerAnim = () => {}; try { step0(dt); } finally { g.playerAnim = pa; } }      /* seated: the game's on-foot step asked for 'idle' every frame and ours for 'drive' after it, each restarting the other's fade, so he stood (seen on out/v6c-tsq/13) */
    else step0(dt);
    // Game.readInput polls the pad during step0 and Game.step consumes I.use.
    const use = keyUse || (!padWasDown && g._gpUse);
    try { if (!free()) { leave(pl.x, pl.y); return; }
      let u = S.unit; const wk = u.walk, m = Math.hypot(I.mx, I.my); let f = S.floor;
      if (!S.ride && chip) hint(null);
      const gates = u.res.gates;
      if (!S.ride && gates.length) {
        fareInput(gates, use, I.handbrake, dt);

      }
      if (S.ride) rideStep(dt, I, m, use);
      else if (m > 0.1) { const sp = (I.run ? 5.2 : 1.9) * Math.min(1, m) * (f && f.stair ? (I.run ? 0.62 : 0.8) : 1), dx = Math.cos(pl.h) * sp * dt, dy = Math.sin(pl.h) * sp * dt;
        if (f && f.k === 'street' && !(EN[f.ent] && EN[f.ent].off)) { const dn = f.z0 > f.z1 ? 1 : -1, d = dn * Walk.u(f, pos.x + dx, pos.y + dy) + f.l / 2; if (d < 0.02 && Math.abs(Walk.v(f, pos.x + dx, pos.y + dy)) < f.w / 2) { leave(pos.x + dx * 2, pos.y + dy * 2); return; } }      // up the last step: back on the street
        const nf = gates.length ? fareMove(wk, gates, dx, dy, R_BODY) : wk.move(pos, dx, dy, R_BODY); if (nf) f = S.floor = nf; if (f && f.k === 'platform') tryBoard(u, Math.cos(pl.h) * 0.5, Math.sin(pl.h) * 0.5); }
      if (!S.ride && f !== S.floor) f = S.floor;
      const zt = !S.ride && f && f.stair ? stairZ(f, pos.x, pos.y) : pos.z; if (dropV >= 0 && !S.ride && visZ > zt + 0.02) { dropV += 18 * dt; visZ = Math.max(zt, visZ - dropV * dt); } else { dropV = -1; visZ += (zt - visZ) * Math.min(1, dt * 16); if (Math.abs(zt - visZ) > 0.6 || S.ride) visZ = zt; }
      if (S.sit && S.ride) { const hips = (g.kit.driveHips && g.kit.driveHips.player) || 0.3; visZ = pos.z + 0.45 + 0.1 - hips; if (pl.vis.acts && pl.vis.acts.drive) { g.playerAnim('drive'); if (pl.vis.mixer) pl.vis.mixer.timeScale = 1; } }
      pl.x = pos.x; pl.y = pos.y; pl.alt = visZ || -0.001; pl.speed = m > 0.1 && !S.sit ? pl.speed : 0;
      const shallow = !S.ride && (!f || f.k === 'street' || f.k === 'landing'); setDeep(!shallow); setOrder(f && f.k === 'street' ? -15 : 0);
      manage(dt); stepTrains(u, dt); u = S.unit; whine(S.ride ? S.ride.t : null, dt); rideAO(!!S.ride || !!S.deep) /* and all the time he is down in a station: at street radius the AO lays soot round turnstiles, rails and fences (station look, round 2) */; emit('step', dt, u);
      if (S.ride) { const [x, y] = tMap(S.ride.t, S.ride.lx, S.ride.lz); pos.x = pl.x = x; pos.y = pl.y = y; g.cam.tx = x; g.cam.ty = y; }      // carried by the train this step
      g.updateCamera(0);
    } catch (e) { fail('step', e); }
  };
  const sync0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) { sync0(dt); if (!step0) { step0 = g.step.bind(g); g.step = myStep; const r0 = w.render.bind(w); w.render = function (t, focus) { try { placeCam(); } catch (e) { fail('camera', e); } if (S.sit && S.ride && !S.camFree && P.get('seatcam') !== '0') {
          const body = pl.vis.object, visible = body.visible;
          const previousNear = w.fixedNear;
          body.visible = false;
          w.fixedNear = Math.min(previousNear || w.camera.near, 0.05);
          try { return r0(t, focus); } finally {
            w.fixedNear = previousNear;
            body.visible = visible;
          }
        }
        return r0(t, focus); }; }
    if (S.own && !pl.vehicle) { const o = pl.vis.object; o.position.set(pl.x, visZ + jumpTime*(0.8-jumpTime)*7, -pl.y); if (S.sit && S.ride) { try { sitHands(o); } catch (e) { fail('sit hands', e); } } } };
  // seated in the train he plays the game's car-driving clip, whose hands hold a wheel: lay them on his thighs instead (the entry lane's rig, bone names only; ?subhands=0 off)
  let hrig = null, hrigP = null; const hv = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
  const sitHands = (o) => { if (P.get('subhands') === '0') return; if (!hrigP) hrigP = import('../entry/rig.js').then((m) => { const r = new m.EntryRig(pl.vis, 'player'); if (r.ok) hrig = r; else console.log('[subway] sit hands: no rig'); }).catch((e) => console.log('[subway] sit hands: ' + (e && e.message)));
    if (!hrig) return; o.updateMatrixWorld(true); const [T, Kn, tg, pole, fw, lf] = hv; fw.set(Math.cos(pl.h), 0, -Math.sin(pl.h)); lf.set(-Math.sin(pl.h), 0, -Math.cos(pl.h));
    for (const s of ['L', 'R']) { const sg = s === 'L' ? 1 : -1; hrig.pos('thigh_' + s, T); hrig.pos('shin_' + s, Kn); tg.copy(T).lerp(Kn, 0.62); tg.y += 0.1; tg.addScaledVector(lf, -0.02 * sg);
      hrig.arm(s, tg, pole.set(0, -1, 0).addScaledVector(lf, 0.7 * sg).addScaledVector(fw, -0.3), 1); hrig.handDir(s, Kn.sub(T).normalize(), pole.set(0, s === 'R' ? 1 : -1, 0), 1); } };
  // camera: inside the rooms, never through a wall or the ground
  // Ours is set last, just before the frame is drawn (world.render is wrapped on the first frame): the guns module and the game place the camera by the
  // street's rules (never below 0.4 m, walls from the street's collision), which put it above the station's ceiling in the first live run.
  const tgt = [0, 0, 0], want = [0, 0, 0]; let camT = 0;
  const placeCam = function () { if (!S.own || S.camFree || !S.unit || !S.unit.walk) return; const now = performance.now(), dt = Math.min(0.1, (now - camT) / 1000) || 0.016; camT = now;
    const C = g.cam, cam = w.camera, pitch = clamp(C.pitch, -0.7, 1.0), d0 = Math.min(C.dist, 3.1), bx = -Math.cos(C.yaw), by = -Math.sin(C.yaw);
    if (S.sit && S.ride && P.get('seatcam') !== '0') {
      const ride = S.ride, seat = S.sit.seat, t = ride.t;
      // Anchor the eye to the rendered bench, including the carriage roll and bounce.
      cam.position.set(seat.x + seat.face * 0.18, t.train.floorY + 1.22, ride.lz);
      t.train.group.localToWorld(cam.position);
      const tilt = clamp(C.pitch * (C.pitch > 0 ? 1.42 : 1), -Math.PI/2 + 0.01, Math.PI/2 - 0.01);
      const horizontal = Math.cos(tilt);
      cam.lookAt(cam.position.x + Math.cos(C.yaw)*horizontal, cam.position.y - Math.sin(tilt), cam.position.z - Math.sin(C.yaw)*horizontal);
      if (cam.fov !== C.fov) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      return;
    }
    tgt[0] = C.tx; tgt[1] = C.ty; tgt[2] = S.sit ? (S.ride.t.T.z + S.ride.t.train.floorY + 1.22) : C.tz; want[0] = C.tx + bx * d0 * Math.cos(pitch); want[1] = C.ty + by * d0 * Math.cos(pitch); want[2] = C.tz + (C.h || 0.35) + d0 * Math.sin(pitch);
    let f; if (S.ride) { // inside the car: the camera is kept inside the car's box (clamped, not pulled into his head)
      const t = S.ride.t, tr = t.train, y0 = t.T.z + tr.floorY, w = tr.walk.find((q) => S.ride.lz >= q.z0 - 0.3 && S.ride.lz <= q.z1 + 0.3) || tr.walk[0], hx = tr.width / 2 - 0.3, top = y0 + (S.sit ? 1.62 : (tr.ceilingY ? tr.ceilingY - tr.floorY : 2.05) - 0.15);      /* seated: below the cove with the ad cards and the light strip (the eye sat in the strip: a white wedge across the view) */
      let [bx2, bz2] = tLocal(t, want[0], want[1]); bx2 = clamp(bx2, -hx, hx); bz2 = clamp(bz2, w.z0 + 0.15, w.z1 - 0.15); const m = tMap(t, bx2, bz2); want[0] = m[0]; want[1] = m[1]; want[2] = clamp(want[2], y0 + 0.5, top); tgt[2] = Math.min(tgt[2], top - 0.1); f = 1; S._clip = 1; }
    else f = S.unit.walk.sight(tgt, want); const k = Math.max(0.12, f - 0.2 / Math.max(d0, 0.5)); let cl = S._clip === undefined ? k : S._clip + (k - S._clip) * Math.min(1, (dt || 1) * (k < S._clip ? 30 : 3)); S._clip = cl = Math.min(cl, k + 0.001);
    cam.position.set(tgt[0] + (want[0] - tgt[0]) * cl, tgt[2] + (want[2] - tgt[2]) * cl, -(tgt[1] + (want[1] - tgt[1]) * cl));
    const la = Math.max(0.6, 2.2 * cl); cam.lookAt(C.tx + Math.cos(C.yaw) * la, C.tz + 0.1 - Math.sin(Math.min(pitch, 0)) * 2.0, -(C.ty + Math.sin(C.yaw) * la));
    if (S.ride && S.ride.t.sway && S.ride.t.sway.roll) { const t = S.ride.t, sw = t.sway, a = 0.6 * sw.roll, hgt = cam.position.y - t.T.z; swAx.set(t.ux, 0, -t.uy); swQ.setFromAxisAngle(swAx, a); cam.quaternion.premultiply(swQ); cam.position.x += t.uy * a * hgt; cam.position.z += t.ux * a * hgt; cam.position.y += 0.6 * sw.bob; }      /* the eye goes with the car, most of the way (rideMotion) */
    if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(); };
  const swAx = new THREE.Vector3(), swQ = new THREE.Quaternion();
  const near0 = g.nearestCar.bind(g); g.nearestCar = function (d) { return S.own ? null : near0(d); };
  if (g.traffic && g.traffic.pushPlayer) { const pp0 = g.traffic.pushPlayer.bind(g.traffic); g.traffic.pushPlayer = function (p) { if (S.own) return; return pp0(p); }; }
  console.log('[subway] ' + data.stations.length + ' stations, ' + EN.length + ' entrances on the street (' + data.stations.filter((s) => s.built).map((s) => s.name).join(', ') + ' built underground)');
  // test hooks for the lane's own tools
  S.goto = (i, d = 0.4) => { const e = EN[i]; pl.x = e.x - e.ca * d; pl.y = e.y - e.sa * d; pl.h = e.h; g.cam.yaw = e.h; };
  S.tMap = tMap; S.tLocal = tLocal; S.THREE = THREE; S.LAYER = LAYER; S.meta = meta; S.entrances = EN; S.stationOf = (id) => stOf.get(id); S.nextStation = nextStation; S.nextHop = nextHop; S.ROUTE_COL = ROUTE_COL; S.Walk = Walk;
  // the lane's other parts, each its own file with install(game, S). Shipped ones are listed in EXTRA; ?subx=a,b loads others for a test (nothing else is ever fetched)
  for (const n of [...new Set(EXTRA.concat((P.get('subx') || '').split(',').filter((q) => /^[a-z]+$/.test(q))))]) { if (P.get('sub' + n) === '0') continue; try { const m = await import('./' + n + '.js'); await m.install(g, S); } catch (e) { fail('part ' + n, e); } }
  S.pos = pos; S.walkOf = () => S.unit && S.unit.walk; S.look = () => look;
  return S;

  function mergeGeos(list) { let n = 0, ni = 0; for (const b of list) { n += b.attributes.position.count; ni += b.index.count; } const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), c = new Float32Array(n * 3), ix = new Uint32Array(ni); let o = 0, oi = 0;
    for (const b of list) { p.set(b.attributes.position.array, o * 3); nr.set(b.attributes.normal.array, o * 3); c.set(b.attributes.color.array, o * 3); for (let i = 0; i < b.index.count; i++) ix[oi + i] = b.index.array[i] + o; o += b.attributes.position.count; oi += b.index.count; b.dispose(); }
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(p, 3)); ge.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); ge.setAttribute('color', new THREE.BufferAttribute(c, 3)); ge.setIndex(new THREE.BufferAttribute(ix, 1)); return ge; }
  function rr(q, x, y, wd, h, r) { q.beginPath(); q.moveTo(x + r, y); q.arcTo(x + wd, y, x + wd, y + h, r); q.arcTo(x + wd, y + h, x, y + h, r); q.arcTo(x, y + h, x, y, r); q.arcTo(x, y, x + wd, y, r); q.closePath(); }
}
