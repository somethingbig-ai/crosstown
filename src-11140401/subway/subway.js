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

export async function install(game) {
  if (game.subway) return game.subway;
  const g = game, w = g.world, pl = g.player, P = g.P;
  const data = await (await fetch('assets/subway/subway.json')).json(), meta = data.meta, EN = data.entrances;
  const S = (g.subway = { data, units: new Map(), own: false, deep: false, z: 0, floor: null, unit: null, fails: 0, stats: { built: 0, dropped: 0, buildMs: 0 }, K });
  const fail = (where, e) => { if (S.fails++ < 6) console.warn('[subway] ' + where + ': ' + String((e && e.stack) || e).slice(0, 500)); };
  for (const e of EN) { e.ca = Math.cos(e.h); e.sa = Math.sin(e.h); }
  const stOf = new Map(data.stations.map((s) => [s.id, s]));

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
  const boardGeo = new THREE.PlaneGeometry(1, 1), streetGroup = new THREE.Group(); streetGroup.name = 'subway_street';
  const signTex = (st) => { const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const q = c.getContext('2d'); q.fillStyle = '#0d0f10'; q.fillRect(0, 0, 1024, 256); q.fillStyle = '#f3f1ea'; q.textBaseline = 'middle';
    let fs = 84; q.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; while (q.measureText(st.name).width > 960 && fs > 40) { fs -= 4; q.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; } q.fillText(st.name, 32, 80);
    const R = st.routes.slice(0, 12), sz = Math.min(96, (960 - (R.length - 1) * 10) / R.length); let x = 32; for (const r of R) { q.fillStyle = ROUTE_COL[r] || '#666'; rr(q, x, 150, sz, Math.min(sz, 92), 14); q.fill(); q.fillStyle = /[NQRW]/.test(r) ? '#111' : '#fff'; q.font = '800 ' + Math.round(sz * 0.68) + 'px Helvetica, Arial, sans-serif'; q.textAlign = 'center'; q.fillText(r, x + sz / 2, 150 + Math.min(sz, 92) / 2 + 3); q.textAlign = 'left'; x += sz + 10; }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  for (const st of data.stations) { const es = st.ent.map((i) => EN[i]); if (!es.length) continue;
    const im = new THREE.InstancedMesh(kit, kitMat, es.length), bm = new THREE.MeshStandardMaterial({ map: signTex(st), roughness: 0.55, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.06 }); bm.emissiveMap = bm.map;
    const bd = new THREE.InstancedMesh(boardGeo, bm, es.length);
    es.forEach((e, i) => { q4.setFromAxisAngle(UP, e.h); m4.compose(p4.set(e.x, 0, -e.y), q4, s4); im.setMatrixAt(i, m4);
      const bx = e.x + e.ca * (lO + CW / 2 - 0.05), by = e.y + e.sa * (lO + CW / 2 - 0.05); q4.setFromAxisAngle(UP, e.h - Math.PI / 2); m4.compose(p4.set(bx, zW + 2.42, -by), q4, s4.set(meta.wStair + CW + 0.1, 0.5, 1)); bd.setMatrixAt(i, m4); s4.set(1, 1, 1); });
    for (const o of [im, bd]) { o.instanceMatrix.needsUpdate = true; o.castShadow = o === im; o.receiveShadow = true; o.computeBoundingSphere(); streetGroup.add(o); }
    let cx = 0, cy = 0; for (const e of es) { cx += e.x; cy += e.y; } st.cx = cx / es.length; st.cy = cy / es.length; st.rad = Math.max(...es.map((e) => Math.hypot(e.x - st.cx, e.y - st.cy))); }
  w.scene.add(streetGroup);
  // the kerb stones and railings are solid to cars and people on the street (three sides; the top of the stair is the way in)
  try { const st = g.statics, old = st.owner; st.owner = 'subway'; for (const e of EN) { const c = (u, v) => [e.x + e.ca * u - e.sa * v, e.y + e.sa * u + e.ca * v], a = c(-0.05, W2 + CW / 2), b = c(lO + CW / 2, W2 + CW / 2), d = c(lO + CW / 2, -W2 - CW / 2), f = c(-0.05, -W2 - CW / 2); st.addSeg(a[0], a[1], b[0], b[1]); st.addSeg(b[0], b[1], d[0], d[1]); st.addSeg(d[0], d[1], f[0], f[1]); } st.owner = old; } catch (e) { fail('statics', e); }

  // ---------------------------------------------------------------- a station's underground: built near, dropped far
  let look = null, lookP = null; const getLook = () => (lookP ||= getLook1()); const getLook1 = async () => { try { if (P.get('sublook') === 'plain') throw new Error('plain asked'); look = (await import('./look.js')).makeLook(THREE); const need = ['tile', 'tileDark', 'floor', 'platform', 'edge', 'stair', 'ceiling', 'concrete', 'trackbed', 'steel', 'metal', 'rail', 'black', 'glowWhite']; for (const k of need) if (!look.mat || !look.mat[k]) throw new Error('look.mat.' + k + ' missing'); }
    catch (e) { console.log('[subway] plain look (' + (e && e.message) + ')'); look = plainLook(THREE); }
    // (look.js makes each texture on first use: one a frame here, so nothing stalls play)
    for (const k of Object.keys(look.mat)) { const m = look.mat[k]; if (m) { m.side = THREE.DoubleSide; m.fog = false; } if (!look.plain) await new Promise((r) => setTimeout(r, 0)); }
    return look; };
  const capMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 2.25, 2.7), fog: false, toneMapped: false, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }); glowMat.name = 'railglow';
  const unitOf = (st) => { let u = S.units.get(st.id); if (!u) S.units.set(st.id, (u = { st, state: 'none', gen: null, res: null, group: null, trains: [] })); return u; };
  const startUnit = async (u) => { u.state = 'look'; try { const L = await getLook(); u.gen = buildStation(THREE, u.st, meta, L, { glowMat }); u.state = 'building'; u.t0 = performance.now(); u.ms = 0; } catch (e) { fail('start ' + u.st.id, e); u.state = 'failed'; } };
  const finishUnit = (u, res) => { u.res = res; u.walk = res.walk; u.group = res.group; u.gen = null;
    // caps over the stair openings (depth only) and, for the view from below once the city is not drawn, a bright card of sky in each opening
    const cp = [], ci = [], sp = []; let n = 0;
    for (const i of u.st.ent) { const e = EN[i], c = (a, b, y) => [e.x + e.ca * a - e.sa * b, y, -(e.y + e.sa * a + e.ca * b)]; for (const [arr, y] of [[cp, zW + 0.02], [sp, zW + 0.01]]) arr.push(...c(0, -W2, y), ...c(lO, -W2, y), ...c(lO, W2, y), ...c(0, W2, y)); ci.push(n, n + 2, n + 1, n, n + 3, n + 2); n += 4; }
    const mk = (pos, mat, name) => { const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ge.setIndex(ci); ge.computeBoundingSphere(); const m = new THREE.Mesh(ge, mat); m.name = name; m.matrixAutoUpdate = false; m.frustumCulled = false; return m; };
    u.cap = mk(cp, capMat, 'sub_cap'); u.cap.renderOrder = -10; u.sky = mk(sp, skyMat, 'sub_sky'); u.sky.layers.set(LAYER); u.sky.visible = false;      /* (the game's camera sees every layer, so the card is switched by hand) */
    u.group.traverse((o) => { if (o.isMesh) o.layers.enable(LAYER); }); u.group.add(u.cap, u.sky); res.core.visible = false;
    w.scene.add(u.group); u.state = 'ready'; S.stats.built++; S.stats.buildMs = Math.round(u.ms);
    console.log('[subway] ' + u.st.name + ' underground built: ' + res.tris + ' triangles, ' + res.group.children.reduce((s, c) => s + c.children.length, 0) + ' meshes, ' + res.lamps + ' lamps, ' + Math.round(u.ms) + ' ms of work over ' + ((performance.now() - u.t0) / 1000).toFixed(1) + ' s');
    if (u.st.built && u.st.tracks) startTrains(u).catch((e) => fail('trains', e)); };
  const dropUnit = (u) => { if (u.group) { w.scene.remove(u.group); u.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); } for (const t of u.trains) { try { t.train.dispose(); } catch (e) {} } u.trains = []; u.group = u.res = u.walk = u.gen = null; u.state = 'none'; S.stats.dropped++; };
  let scanT = 0;
  const manage = (dt) => { scanT -= dt; const px = pl.x, py = pl.y;
    if (scanT <= 0) { scanT = 0.4; for (const st of data.stations) { if (st.cx === undefined) continue; const d = Math.hypot(px - st.cx, py - st.cy) - st.rad, u = S.units.get(st.id);
        if (d < NEAR && (!u || u.state === 'none')) { let near = false; for (const i of st.ent) if (Math.hypot(px - EN[i].x, py - EN[i].y) < NEAR) { near = true; break; } if (near) startUnit(unitOf(st)); }
        else if (u && u.state === 'ready' && u !== S.unit && d > FAR) dropUnit(u); } }
    for (const u of S.units.values()) if (u.state === 'building') { const t0 = performance.now(), budget = S.own || window.__subFast ? 30 : 3.5; try { let r; do { r = u.gen.next(); } while (!r.done && performance.now() - t0 < budget); u.ms += performance.now() - t0; if (r.done) finishUnit(u, r.value); } catch (e) { fail('build ' + u.st.id, e); u.state = 'failed'; } break; } };

  // ---------------------------------------------------------------- trains
  const startTrains = async (u) => { let mod; try { mod = await import('./train.js'); } catch (e) { console.log('[subway] no train.js: ' + (e && e.message)); return; } if (u.state !== 'ready') return;
    const st = u.st; let k = 0;
    for (const T of st.tracks) { const route = T.routes[k % T.routes.length], tr = mod.buildTrain(THREE, { cars: 8, div: st.div || 'B', route: { label: route, color: ROUTE_COL[route] || '#888' }, seed: 7 + T.id });
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
      if (t.state === 'wait') { t.t -= dt; if (t.t <= 0) { t.state = 'in'; t.c = -t.far; t.v = VMAX; tr.group.visible = true; try { tr.setDoors(0, 0); tr.setLights({ front: 1, interior: K * 1.15 }); const r = t.T.routes[t.routeI++ % t.T.routes.length]; tr.setRoute({ label: r, color: ROUTE_COL[r] || '#888' }); } catch (e) { fail('train', e); } S.sound && S.sound('arrive', t); } }
      else if (t.state === 'in') { const stop = Math.sqrt(Math.max(0, 2 * DEC * -t.c)); t.v = Math.min(VMAX, Math.max(0.35, stop)); t.c += t.v * dt; if (t.c >= 0) { t.c = 0; t.v = 0; t.state = 'dwell'; t.t = 0; } }
      else if (t.state === 'dwell') { t.t += dt; const f = t.t < 1.2 ? 0 : t.t < 2.8 ? (t.t - 1.2) / 1.6 : t.t < 13.5 ? 1 : t.t < 15.1 ? 1 - (t.t - 13.5) / 1.6 : 0; if (f !== t.doors) { if ((t.doors === 0 && f > 0) || (t.doors === 1 && f < 1)) S.sound && S.sound('doors', t); t.doors = f; try { tr.setDoors(t.side, f * f * (3 - 2 * f)); } catch (e) { fail('doors', e); } } if (S.ride && S.ride.t === t && !nextStation(u.st, t.T.dir) && t.t > 4) t.t = Math.min(t.t, 12);      /* last stop in our map: the doors stay open until he gets off */
        if (t.t > 16.6) { t.state = 'out'; S.sound && S.sound('leave', t); if (S.ride && S.ride.t === t) { const N = nextStation(u.st, t.T.dir); if (N) { const nu = unitOf(N); if (nu.state === 'none') startUnit(nu); } } } }
      else if (t.state === 'out') { t.v = Math.min(VMAX + 2, t.v + ACC * dt); t.c += t.v * dt; if (S.ride && S.ride.t === t && t.c > u.st.plen / 2 + tr.length / 2 + 45) { if (hop(u, t)) return; t.c = Math.min(t.c, t.far - 2); }
        if (t.c > t.far) { t.state = 'wait'; t.t = 28 + ((t.T.id * 37 + S.stats.built * 11 + Math.floor(g.t)) % 30); tr.group.visible = false; } }
      if (tr.group.visible) { tr.group.position.set(t.mx + t.ux * t.c, t.T.z, -(t.my + t.uy * t.c)); const inSt = clamp(1 - (Math.abs(t.c) - (u.st.plen / 2 - tr.length / 2)) / tr.length, 0, 1); scaleTrain(tr, 0.07 + 0.93 * inSt); tr.group.updateMatrixWorld(true); } } };

  // ---------------------------------------------------------------- the player underground
  const pos = { x: 0, y: 0, z: 0 }; let visZ = 0, jumpWas = true, saved = null;
  const free = () => { const h = g.heli; return !pl.vehicle && !pl.busy && !(h && (h.piloted || h.busy || h.hasCamera)) && !(g.fly && g.fly.on) && !(g.jump && g.jump.core && g.jump.core.own) && !(g.combat && g.combat.dead); };
  const figureLayers = () => { try { pl.vis.object.traverse((o) => o.layers.enable(LAYER)); } catch (e) {} };
  const setOrder = (v) => { if (S._ord === v) return; S._ord = v; try { pl.vis.object.traverse((o) => { if (o.isMesh) o.renderOrder = v; }); } catch (e) {} };
  const hemi = new THREE.HemisphereLight(0xfff3dc, 0x7d776c, 0.75 * K / 0.3), key = new THREE.DirectionalLight(0xfff6e6, 0.5 * K / 0.3); hemi.layers.set(LAYER); key.layers.set(LAYER); key.position.set(0.3, 1, 0.2); w.scene.add(hemi, key, key.target);
  const setDeep = (on) => { if (S.deep === on) return; S.deep = on; for (const u of S.units.values()) if (u.sky) u.sky.visible = on;
    if (on) { saved = { mask: w.camera.layers.mask, env: w.scene.environmentIntensity, off: w.streetOff, bg: w.scene.background }; w.camera.layers.set(LAYER); w.scene.environmentIntensity = 0.03; w.streetOff = true; figureLayers(); }
    else if (saved) { w.camera.layers.mask = saved.mask; w.scene.environmentIntensity = saved.env; w.streetOff = saved.off; saved = null; } };
  const enter = (u, e) => { S.own = true; S.unit = u; pos.x = pl.x; pos.y = pl.y; const f = u.st.floors.find((q) => q.k === 'street' && q.ent === e.id), uu = clamp(Walk.u(f, pl.x, pl.y), -f.l / 2 + 0.06, f.l / 2), vv = clamp(Walk.v(f, pl.x, pl.y), -f.w / 2 + R_BODY + 0.02, f.w / 2 - R_BODY - 0.02);
    pos.x = f.x + f.ca * uu - f.sa * vv; pos.y = f.y + f.sa * uu + f.ca * vv; pos.z = Walk.zAt(f, uu); visZ = zW; S.floor = f; pl.roof = null; if (g.jump) { jumpWas = g.jump.on; g.jump.on = false; } u.res.core.visible = true; figureLayers(); if (window.__mark) window.__mark('subway-in'); };
  const leave = (x, y) => { S.own = false; setDeep(false); setOrder(0); pl.x = x; pl.y = y; pl.alt = 0; if (g.jump) g.jump.on = jumpWas; if (S.unit) S.unit.res.core.visible = false; S.unit = null; S.floor = null; if (window.__mark) window.__mark('subway-out'); };
  S.leave = () => { if (S.own) leave(pl.x, pl.y); };
  const stairZ = (f, x, y) => { const u = Walk.u(f, x, y), n = f.n || 1, dn = f.z0 > f.z1 ? 1 : -1, d = clamp(dn * u + f.l / 2, 0, f.l - 1e-6), i = Math.floor(d / (f.l / n)); return Math.max(f.z0, f.z1) - (i + 1) * meta.rise; };

  // ---------------------------------------------------------------- riding (v2): step in through an open door, ride to the next station of the line, step out
  const nextStation = (st, dir) => { const L = (data.lines || []).find((l) => l.id === st.line); if (!L) return null; const i = L.stations.indexOf(st.id), id = L.stations[i + (dir > 0 ? 1 : -1)]; return id ? stOf.get(id) : null; };
  const tLocal = (t, x, y) => { const dx = x - (t.mx + t.ux * t.c), dy = y - (t.my + t.uy * t.c); return [-dx * t.uy + dy * t.ux, dx * t.ux + dy * t.uy]; };      // [across (train +X), along]
  const tMap = (t, lx, lz) => [t.mx + t.ux * t.c + t.ux * lz - t.uy * lx, t.my + t.uy * t.c + t.uy * lz + t.ux * lx];
  const inCar = (t, lx, lz, open) => { const tr = t.train, m = 0.22; for (const w of tr.walk) if (lx >= w.x0 + m && lx <= w.x1 - m && lz >= w.z0 + m && lz <= w.z1 - m) return true;
    for (const d of tr.doorways || []) { if (lz < d.z0 + m || lz > d.z1 - m) continue; if (lx >= Math.min(d.x0, d.x1) - m && lx <= Math.max(d.x0, d.x1) + (0)) return true; if (open && d.side === t.side && lx * d.side > 0 && Math.abs(lx) < tr.width / 2 + 0.75) return true; } return false; };
  const tryBoard = (u, dx, dy) => { for (const t of u.trains) { if (t.state !== 'dwell' || t.doors < 0.85) continue; const [lx, lz] = tLocal(t, pos.x + dx, pos.y + dy), [lx0] = tLocal(t, pos.x, pos.y), tr = t.train; if (lx0 * t.side < tr.width / 2 || Math.abs(lx) > tr.width / 2 + 0.6) continue;
      for (const d of tr.doors) { if (d.side !== t.side || Math.abs(lz - d.z) > d.w / 2 - 0.2) continue; S.ride = { t, lx: t.side * (tr.width / 2 + 0.05), lz: clamp(lz, d.z - d.w / 2 + 0.3, d.z + d.w / 2 - 0.3) }; if (window.__mark) window.__mark('subway-board'); return true; } } return false; };
  const rideStep = (dt, I, m) => { const R = S.ride, t = R.t, tr = t.train, open = t.state === 'dwell' && t.doors > 0.85;
    if (!open && Math.abs(R.lx) > tr.width / 2 - 0.5) R.lx = Math.sign(R.lx) * (tr.width / 2 - 0.5);      // the doors are closing: he is inside
    if (m > 0.1) { const sp = (I.run ? 3.2 : 1.7) * Math.min(1, m), dx = Math.cos(pl.h) * sp * dt, dy = Math.sin(pl.h) * sp * dt, dlx = -dx * t.uy + dy * t.ux, dlz = dx * t.ux + dy * t.uy;
      for (const [a, b] of [[dlx, dlz], [dlx, 0], [0, dlz]]) { if (!a && !b) continue; const nx = R.lx + a, nz = R.lz + b;
        if (open && nx * t.side > tr.width / 2 + 0.42) { const [x, y] = tMap(t, t.side * (tr.width / 2 + 0.5), nz), uu = t.u, f = uu.walk.free(x, y, meta.zP, R_BODY); if (f) { pos.x = x; pos.y = y; pos.z = meta.zP; S.floor = f; S.ride = null; if (window.__mark) window.__mark('subway-alight'); return; } continue; }      // out through the open door
        if (inCar(t, nx, nz, open)) { R.lx = nx; R.lz = nz; break; } } }
    const [x, y] = tMap(t, R.lx, R.lz); pos.x = x; pos.y = y; pos.z = t.T.z + tr.floorY; };
  // deep in the dark of the tunnel the ride changes stations: the same train, now coming in to the next station of the line (its neighbourhood is built while the train pulls out)
  const hop = (u, t) => { const N = nextStation(u.st, t.T.dir); if (!N) return false; const nu = unitOf(N); if (nu.state !== 'ready' || !nu.trains.length) { if (nu.state === 'none') startUnit(nu); return false; }
    const nt = nu.trains.find((q) => q.T.id === t.T.id); if (!nt) return false; const R = S.ride, tr = nt.train;
    const lead = Math.max(125, Math.min(nt.far - 2, t.far - t.c + 70)), ph = (v) => ((v % 4.6) + 4.6) % 4.6; let c1 = -lead; c1 -= ph(c1 - nt.far) - ph(t.c - t.far) > 0 ? ph(c1 - nt.far) - ph(t.c - t.far) : ph(c1 - nt.far) - ph(t.c - t.far) + 4.6;      // keep the columns' beat past the windows
    nt.state = 'in'; nt.c = Math.max(-nt.far, c1); nt.v = t.v; nt.doors = 0; nt.t = 0; tr.group.visible = true; try { tr.setDoors(0, 0); tr.setLights({ front: 1, interior: K * 1.15 }); const r = t.T.routes[(t.routeI + t.T.routes.length - 1) % t.T.routes.length]; tr.setRoute({ label: r, color: ROUTE_COL[r] || '#888' }); } catch (e) {}
    t.state = 'wait'; t.t = 40; t.train.group.visible = false; const da = Math.atan2(nt.uy, nt.ux) - Math.atan2(t.uy, t.ux); pl.h += da; g.cam.yaw += da;
    R.t = nt; u.res.core.visible = false; nu.res.core.visible = true; S.unit = nu; const [x, y] = tMap(nt, R.lx, R.lz); pos.x = x; pos.y = y; pl.x = x; pl.y = y; g.cam.tx = x; g.cam.ty = y; S._clip = undefined; S.stats.hops = (S.stats.hops || 0) + 1; if (window.__mark) window.__mark('subway-hop');
    console.log('[subway] riding ' + u.st.name + ' -> ' + N.name); return true; };
  let step0 = null;      // the game's step with everyone else's wrappers on it (taken on the first drawn frame, so that ours is the outermost)
  const myStep = function (dt) {
    if (!S.own) { step0(dt); try { manage(dt);
        if (free()) for (const u of S.units.values()) { if (u.state !== 'ready') continue; for (const i of u.st.ent) { const e = EN[i], dx = pl.x - e.x, dy = pl.y - e.y; if (Math.abs(dx) > 3 || Math.abs(dy) > 3) continue; const uu = dx * e.ca + dy * e.sa, vv = -dx * e.sa + dy * e.ca; if (uu > 0.04 && uu < 1.3 && Math.abs(vv) < W2 + 0.1) { enter(u, e); break; } } if (S.own) break; } } catch (e) { fail('street step', e); } return; }
    // underground: the game's own step runs (input, the turn of the body, animation, everything else in the city), then its move is undone and ours made
    const I = g.input, use = I.use; I.use = false; pl.x = pos.x; pl.y = pos.y; pl.alt = visZ || -0.001;
    step0(dt);
    try { if (!free()) { leave(pl.x, pl.y); return; }
      let u = S.unit; const wk = u.walk, m = Math.hypot(I.mx, I.my); let f = S.floor;
      if (S.ride) rideStep(dt, I, m);
      else if (m > 0.1) { const sp = (I.run ? 5.2 : 1.9) * Math.min(1, m) * (f && f.stair ? (I.run ? 0.62 : 0.8) : 1), dx = Math.cos(pl.h) * sp * dt, dy = Math.sin(pl.h) * sp * dt;
        if (f && f.k === 'street') { const dn = f.z0 > f.z1 ? 1 : -1, d = dn * Walk.u(f, pos.x + dx, pos.y + dy) + f.l / 2; if (d < 0.02 && Math.abs(Walk.v(f, pos.x + dx, pos.y + dy)) < f.w / 2) { leave(pos.x + dx * 2, pos.y + dy * 2); return; } }      // up the last step: back on the street
        const nf = wk.move(pos, dx, dy, R_BODY); if (nf) f = S.floor = nf; if (f && f.k === 'platform') tryBoard(u, Math.cos(pl.h) * 0.5, Math.sin(pl.h) * 0.5); }
      if (!S.ride && f !== S.floor) f = S.floor;
      const zt = !S.ride && f && f.stair ? stairZ(f, pos.x, pos.y) : pos.z; visZ += (zt - visZ) * Math.min(1, dt * 16); if (Math.abs(zt - visZ) > 0.6 || S.ride) visZ = zt;
      pl.x = pos.x; pl.y = pos.y; pl.alt = visZ || -0.001; pl.speed = m > 0.1 ? pl.speed : 0;
      const shallow = !S.ride && (!f || f.k === 'street' || f.k === 'landing'); setDeep(!shallow); setOrder(f && f.k === 'street' ? -15 : 0);
      manage(dt); stepTrains(u, dt); u = S.unit;
      if (S.ride) { const [x, y] = tMap(S.ride.t, S.ride.lx, S.ride.lz); pos.x = pl.x = x; pos.y = pl.y = y; g.cam.tx = x; g.cam.ty = y; }      // carried by the train this step
      g.updateCamera(0);
    } catch (e) { fail('step', e); }
  };
  const sync0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) { sync0(dt); if (!step0) { step0 = g.step.bind(g); g.step = myStep; const r0 = w.render.bind(w); w.render = function (t, focus) { try { placeCam(); } catch (e) { fail('camera', e); } return r0(t, focus); }; }
    if (S.own && !pl.vehicle) { const o = pl.vis.object; o.position.set(pl.x, visZ, -pl.y); } };
  // camera: inside the rooms, never through a wall or the ground
  // Ours is set last, just before the frame is drawn (world.render is wrapped on the first frame): the guns module and the game place the camera by the
  // street's rules (never below 0.4 m, walls from the street's collision), which put it above the station's ceiling in the first live run.
  const tgt = [0, 0, 0], want = [0, 0, 0]; let camT = 0;
  const placeCam = function () { if (!S.own || S.camFree || !S.unit || !S.unit.walk) return; const now = performance.now(), dt = Math.min(0.1, (now - camT) / 1000) || 0.016; camT = now;
    const C = g.cam, cam = w.camera, pitch = clamp(C.pitch, -0.7, 1.0), d0 = Math.min(C.dist, 3.1), bx = -Math.cos(C.yaw), by = -Math.sin(C.yaw);
    tgt[0] = C.tx; tgt[1] = C.ty; tgt[2] = C.tz; want[0] = C.tx + bx * d0 * Math.cos(pitch); want[1] = C.ty + by * d0 * Math.cos(pitch); want[2] = C.tz + (C.h || 0.35) + d0 * Math.sin(pitch);
    let f; if (S.ride) { const t = S.ride.t, tr = t.train, [ax, az] = tLocal(t, tgt[0], tgt[1]), [bx2, bz2] = tLocal(t, want[0], want[1]), y0 = t.T.z + tr.floorY, w = tr.walk.find((q) => S.ride.lz >= q.z0 - 0.3 && S.ride.lz <= q.z1 + 0.3) || tr.walk[0], hx = tr.width / 2 - 0.32; f = 0;
      for (let i = 1; i <= 24; i++) { const q = i / 24, x = ax + (bx2 - ax) * q, z = az + (bz2 - az) * q, y = tgt[2] + (want[2] - tgt[2]) * q; if (Math.abs(x) > hx || z < w.z0 - 0.1 || z > w.z1 + 0.1 || y < y0 + 0.25 || y > y0 + (tr.ceilingY ? tr.ceilingY - tr.floorY : 2.05) - 0.12) break; f = q; } }
    else f = S.unit.walk.sight(tgt, want); const k = Math.max(0.12, f - 0.2 / Math.max(d0, 0.5)); let cl = S._clip === undefined ? k : S._clip + (k - S._clip) * Math.min(1, (dt || 1) * (k < S._clip ? 30 : 3)); S._clip = cl = Math.min(cl, k + 0.001);
    cam.position.set(tgt[0] + (want[0] - tgt[0]) * cl, tgt[2] + (want[2] - tgt[2]) * cl, -(tgt[1] + (want[1] - tgt[1]) * cl));
    const la = Math.max(0.6, 2.2 * cl); cam.lookAt(C.tx + Math.cos(C.yaw) * la, C.tz + 0.1 - Math.sin(Math.min(pitch, 0)) * 2.0, -(C.ty + Math.sin(C.yaw) * la));
    if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(); };
  const near0 = g.nearestCar.bind(g); g.nearestCar = function (d) { return S.own ? null : near0(d); };
  if (g.traffic && g.traffic.pushPlayer) { const pp0 = g.traffic.pushPlayer.bind(g.traffic); g.traffic.pushPlayer = function (p) { if (S.own) return; return pp0(p); }; }
  console.log('[subway] ' + data.stations.length + ' stations, ' + EN.length + ' entrances on the street (' + data.stations.filter((s) => s.built).map((s) => s.name).join(', ') + ' built underground)');
  // test hooks for the lane's own tools
  S.goto = (i, d = 0.4) => { const e = EN[i]; pl.x = e.x - e.ca * d; pl.y = e.y - e.sa * d; pl.h = e.h; g.cam.yaw = e.h; };
  S.tMap = tMap; S.tLocal = tLocal;
  S.pos = pos; S.walkOf = () => S.unit && S.unit.walk; S.look = () => look;
  return S;

  function mergeGeos(list) { let n = 0, ni = 0; for (const b of list) { n += b.attributes.position.count; ni += b.index.count; } const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), c = new Float32Array(n * 3), ix = new Uint32Array(ni); let o = 0, oi = 0;
    for (const b of list) { p.set(b.attributes.position.array, o * 3); nr.set(b.attributes.normal.array, o * 3); c.set(b.attributes.color.array, o * 3); for (let i = 0; i < b.index.count; i++) ix[oi + i] = b.index.array[i] + o; o += b.attributes.position.count; oi += b.index.count; b.dispose(); }
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.BufferAttribute(p, 3)); ge.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); ge.setAttribute('color', new THREE.BufferAttribute(c, 3)); ge.setIndex(new THREE.BufferAttribute(ix, 1)); return ge; }
  function rr(q, x, y, wd, h, r) { q.beginPath(); q.moveTo(x + r, y); q.arcTo(x + wd, y, x + wd, y + h, r); q.arcTo(x + wd, y + h, x, y + h, r); q.arcTo(x, y + h, x, y, r); q.arcTo(x, y, x + wd, y, r); q.closePath(); }
}
