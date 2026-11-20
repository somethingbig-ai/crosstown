// perch.js: the top of the Empire State Building as a place to land, and a rifle with a scope on any high roof (heli lane, Nov 16;
// Matt: "take a helicopter up to the top of the Empire State building and play sniper").
// 1. Landing marks on the Empire State Building as the game draws it: the 86th-floor terrace (about 323 m) and, where it is wide enough, the roof
//    above it (about 331 m). They are found in the helicopter's height picture of the city (the widest level patch at each level), so they sit on the
//    building as drawn. Both are ordinary pads: land, lower the collective, F to get out.
// 2. On foot on a roof more than 15 m up the guns work (before: none above 2 m, combat.js canCarry). Bullets are cast against the city as
//    it stands (the height picture: roofs have tops, the street is below) and then, for the last metres above the street, by the game's own
//    ray for people, cars and street things. A rifle reaches 900 m from a roof.
// 3. The scope: on such a roof, aiming a rifle (right mouse / left trigger) looks through a telescopic sight: 6x, the wheel changes it
//    (3x, 6x, 12x), the look slows with the power, one round at a time, heavy.
// 4. From up there the street is alive where you look: cars, walkers and the crowd are put round the place in the street the eye rests on.
// 5. Over the mark, the last 14 m down are helped onto it (?perchassist=0 = hands only).
// 6. On each marked roof a sniper rifle lies in an open case to be picked up (?perchpick=0 = none).
// ?perch=0: this file is never fetched: no marks, no guns on roofs. heli.js calls step(dt), sync(dt), drawHud(hud).
import * as THREE from 'three';
import { WEAPONS } from '../combat/combat.js';

const HIGH = 8, REACH = 900, ZOOMS = [15, 7.5, 3.75], LONG = ['rifle', 'sniper'];      // ZOOMS: fields of view (degrees): 3x, 6x, 12x of the rifle's own 47
const SNIPE = { auto: false, rpm: 46, dmg: 600, spread: 0, hip: 0, bloom: 0, bloomMax: 0, force: 3 };
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export function addPerch(heli, ctx) {
  const g = heli.g, H = heli.heights, W = g.world, pl = g.player;
  const S = { pads: [], on: false, scoped: false, zoom: 1, u: 0, hintT: 99, wrapped: false, eye: new THREE.Vector3(), dir: new THREE.Vector3(), yaw0: 0, pitch0: 0, saved: null, tries: 0, shots: 0 };

  // ---------------------------------------------------------------- 1. the landing marks
  const esb = (g.city.buildings || []).filter((b) => b.name === 'Empire State Building' && b.poly);
  let ex = 0, ey = 0, en = 0; for (const b of esb) if (b.h > 300) for (const p of b.poly) { ex += p[0]; ey += p[1]; en++; }
  if (en) { ex /= en; ey /= en; S.esb = { x: ex, y: ey }; }
  const sq = (x, y) => (H.hf && x > H.hfX0 + 1 && x < H.hfX1 - 1 && y > H.hfY0 + 1 && y < H.hfY1 - 1 ? Math.floor((y - H.hfY0) / H.hfSq) * H.hfTX + Math.floor((x - H.hfX0) / H.hfSq) : -1);
  // the level most of the building's top stands at between two heights, then the roomiest level square at it
  function level(lo, hi) { const n = new Map(); for (let dy = -34; dy <= 34; dy += 2) for (let dx = -34; dx <= 34; dx += 2) { const t = H.top(ex + dx, ey + dy, 1e4); if (t > lo && t < hi) { const k = Math.round(t * 2) / 2; n.set(k, (n.get(k) || 0) + 1); } } let best = null, bn = 0; for (const [k, c] of n) if (c > bn) { bn = c; best = k; } return bn >= 12 ? best : null; }
  // the best place to put an aircraft down at level z: the mast 5.6 m or more from anything higher (the disc is 5.35 m) if the level allows,
  // the skids 2.2 m or more in from the drop; among equals, the one furthest along `want`. Its heading lies along the wall.
  function patch(z, want) {
    let best = null; const lv = (x, y) => { const t = H.top(x, y, 1e4); return t > z + 1 ? 1 : t < z - 1 ? -1 : 0; };
    for (let dy = -36; dy <= 36; dy += 1) for (let dx = -36; dx <= 36; dx += 1) { const cx = ex + dx, cy = ey + dy; if (lv(cx, cy) !== 0) continue; let wall = 12, edge = 12, wa = 0;
      for (let r = 0.5; r <= 11 && (r < wall || r < edge); r += 0.5) for (let i = 0, n = Math.max(12, Math.round(r * 6)); i < n; i++) { const a = i / n * 6.2832, q = lv(cx + Math.cos(a) * r, cy + Math.sin(a) * r); if (q > 0 && r < wall) { wall = r; wa = a; } if (q < 0 && r < edge) edge = r; }
      if (edge < 2.2 || wall < 3.5) continue; const sc = Math.min(Math.min(wall, 8) - 5.6, (Math.min(edge, 4) - 2.2) * 1.5) + (dx * want[0] + dy * want[1]) * 0.004;
      if (!best || sc > best.sc) best = { x: cx, y: cy, z: H.top(cx, cy, 1e4), sc, wall, edge, wa, size: Math.max(5, Math.min(13, 2 * Math.min(wall, edge + 1.5))) }; }
    return best;
  }
  function marks() {
    const zD = level(315, 327.5), zR = level(327.5, 345), gh = g.city.meta.grid_deg * Math.PI / 180 + Math.PI / 2, out = [];
    // the terrace mark on the side toward Madison Square (south-west on the map: where the player comes from), the roof mark wherever the roof is widest
    const d = zD !== null ? patch(zD, [-0.5, -0.87]) : null; if (d) out.push({ name: 'Empire State Building · 86th floor terrace', x: d.x, y: d.y, z: d.z, h: d.wall < 11 ? d.wa + Math.PI / 2 : gh, roof: true, esb: true, size: d.size, wall: d.wall, edge: d.edge, wa: d.wa });
    const r = zR !== null ? patch(zR, [0.5, 0.87]) : null; if (r) out.push({ name: 'Empire State Building · roof', x: r.x, y: r.y, z: r.z, h: r.wall < 11 ? r.wa + Math.PI / 2 : gh, roof: true, esb: true, size: r.size, wall: r.wall, edge: r.edge });
    if (!out.length) return false;
    if (d && DECK) { try { helideck(out[0]); } catch (e) { console.log('[perch] helideck not built: ' + (e && (e.stack || e.message))); } }
    const old = heli.padGroup && heli.padGroup.children[0];
    for (const p of out) { heli.pads.push(p); S.pads.push(p);
      if (old) { const s = p.size / 13, m = new THREE.Mesh(old.geometry, old.material); m.position.set(p.x, p.z + 0.04, -p.y); m.rotation.y = p.h; m.scale.set(s, 1, s); m.receiveShadow = true; m.renderOrder = 3; heli.padGroup.add(m); } }
    console.log('[perch] Empire State Building marks: ' + out.map((p) => p.name.split('· ')[1] + ' at ' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ', ' + p.z.toFixed(1) + ' m (mark ' + p.size.toFixed(0) + ' m, wall ' + p.wall + ' m, drop ' + p.edge + ' m)').join('; '));
    return true;
  }
  // ---------------------------------------------------------------- 1b. a helideck (Matt, Nov 17 12:47: "Couldn't land on the ESB, so difficult")
  // The terrace is 8 m wide under a 10.7 m rotor. So a steel deck 13 m square is hung off it at terrace level, reaching 10 m out over the drop: the mark moves to its
  // middle (9 m clear of the tower wall), the height picture answers the deck's level inside its square (flight, the walk on foot and the cameras all read that),
  // and on the deck the street's wall lines (the building's own edge runs under it) do not stop his feet. ?perchdeck=0 = the bare terrace as before.
  const DECK = g.P.get('perchdeck') !== '0';
  function helideck(p) {
    const ux = -Math.cos(p.wa), uy = -Math.sin(p.wa), HALF = 6.5, cx = p.x + ux * 3.5, cy = p.y + uy * 3.5, z = p.z + 0.25;      // u: away from the tower wall
    const inD = (x, y) => { const dx = x - cx, dy = y - cy; return Math.abs(dx * ux + dy * uy) <= HALF && Math.abs(-dx * uy + dy * ux) <= HALF; };
    const top0 = H.top; H.top = function (x, y, zq) { const t = top0.call(this, x, y, zq); return inD(x, y) && zq > z - 1.5 && t < z ? z : t; };
    const st = g.statics, res0 = st.resolve; st.resolve = function (x, y, r, out, skip) { if (pl.roof && Math.abs((pl.alt || 0) - z) < 1.2 && r < 0.6 && inD(x, y) && Math.abs(x - pl.x) + Math.abs(y - pl.y) < 4) { out.x = x; out.y = y; return 0; } return res0.call(this, x, y, r, out, skip); };
    S.deck = { cx, cy, z, ux, uy, half: HALF, inD }; p.x = cx; p.y = cy; p.z = z; p.size = 11; p.wall = (p.wall || 5) + 3.5; p.edge = HALF; p.name = 'Empire State Building · helideck';
    // the deck as built: plate, a yellow edge line, beams under it, struts back to the wall, green edge lights
    const G = new THREE.Group(); G.name = 'esbHelideck'; G.position.set(cx, z, -cy); G.rotation.y = Math.atan2(uy, ux);
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d'); c.fillStyle = '#3b3f43'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) { c.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '20,22,24' : '110,114,118') + ',' + (0.05 + Math.random() * 0.1) + ')'; c.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 5, 1 + Math.random() * 2); }
    c.strokeStyle = 'rgba(20,22,24,0.55)'; c.lineWidth = 2; for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, 512); c.stroke(); }      // plate joints
    c.strokeStyle = '#e2b521'; c.lineWidth = 12; c.strokeRect(14, 14, 484, 484);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.7, metalness: 0.5 }), plate = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.25 });
    const add = (geo, mat, x, y, zz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, zz); m.castShadow = true; m.receiveShadow = true; G.add(m); return m; };
    add(new THREE.BoxGeometry(HALF * 2, 0.06, HALF * 2), plate, 0, -0.03, 0); add(new THREE.BoxGeometry(HALF * 2, 0.24, HALF * 2), steel, 0, -0.18, 0);
    for (const zz of [-5, -1.7, 1.7, 5]) add(new THREE.BoxGeometry(HALF * 2, 0.5, 0.28), steel, 0, -0.55, zz);
    for (const zz of [-5, 5]) { const L = Math.hypot(8.5, 7), strut = add(new THREE.CylinderGeometry(0.16, 0.16, L, 10), steel, 1.25, -0.8 - 3.5, zz); strut.rotation.z = -Math.atan2(8.5, 7); }      // from the outer beam down and back to the tower's face below the terrace
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 3.2, 1.1) }), lg = new THREE.SphereGeometry(0.09, 8, 6);
    for (let i = -3; i <= 3; i++) for (const e of [-1, 1]) { add(lg, lamp, i * 2.1, 0.09, e * (HALF - 0.15)).castShadow = false; add(lg, lamp, e * (HALF - 0.15), 0.09, i * 2.1).castShadow = false; }
    // the beacon: a column of amber light over the deck, shown to the pilot only, so the place can be found from across the map
    const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 70, 20, 1, true), bm); beam.position.set(0, 36, 0); beam.renderOrder = 7; beam.visible = false; G.add(beam); S.beam = beam;
    W.scene.add(G); S.deckGroup = G;
    console.log('[perch] helideck 13 m square at ' + cx.toFixed(0) + ', ' + cy.toFixed(0) + ', ' + z.toFixed(1) + ' m, 10 m out over the drop');
  }
  function tryMarks() {
    if (S.pads.length || !S.esb || S.tries > 40) return; const k = sq(ex, ey); if (k < 0) { S.tries = 99; return; }
    if (!H.hfDone[k]) return;      // that square of the height picture is not taken yet (it comes from the queue a few seconds after the load)
    S.tries++; if (H.top(ex, ey, 1e4) < 300) return;      // the area's buildings are not drawn yet: the square is taken again when its set arrives
    if (!marks()) { S.tries += 9; console.log('[perch] no level place found on the Empire State Building yet (deck ' + level(315, 327.5) + ', roof ' + level(327.5, 345) + ')'); }
  }

  // ---------------------------------------------------------------- 2. guns on a roof
  const roofNow = () => !!pl.roof && pl.alt > HIGH && !pl.vehicle && !pl.busy && !heli.piloted && !heli.busy && !heli.hasCamera && !(g.fly && g.fly.on);
  function wrap(C) {
    S.wrapped = true; S.C = C;
    const carry0 = C.canCarry.bind(C); C.canCarry = function () { return S.on ? true : carry0(); };
    const cast0 = C.cast;
    C.cast = function (ox, oy, oz, dx, dy, dz, tmin, tmax) {
      if (!S.on || !(oz > HIGH - 4)) return cast0.call(this, ox, oy, oz, dx, dy, dz, tmin, tmax);
      let through = false; if (S.scoped) { const e = S.eye, q = S.dir; if (dx * q.x - dy * q.z + dz * q.y > 0.9986 && Math.abs(ox - e.x) + Math.abs(oy + e.z) + Math.abs(oz - e.y) < 12) { ox = e.x; oy = -e.z; oz = e.y; dx = q.x; dy = -q.z; dz = q.y; tmin = 6; through = true; } }      /* through the scope the round goes where the scope looks, whichever camera the frame left behind; and it starts 6 m out, where the picture starts (the renderer's near plane up there): he leans over the edge, and what the eye does not see of his own roof does not stop the round */
      const far = Math.max(tmax, LONG.includes(this.slot) ? REACH : 0);
      // the first solid on the way, by the height picture
      let t = Math.max(tmin, 0.3), st = 1.5, ts = -1;
      while (t < far) { const z = oz + dz * t; if (z < -2) { ts = t; break; } const inS = H.top(ox + dx * t, oy + dy * t, z + 0.5) > z; if (through) { if (inS) { t += st; continue; } through = false;     /* the scope's picture starts 6 m out, inside the roof he stands on when he looks down across it: the eye sees the street through it, and so does the round, until it is out in the air */ } if (inS) { let lo = Math.max(tmin, t - st), hi = t; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2, zm = oz + dz * m; if (H.top(ox + dx * m, oy + dy * m, zm + 0.5) > zm) hi = m; else lo = m; } ts = hi; break; } t += st; st = Math.min(9, st * 1.07); }
      const none = { kind: 'none', t: far, x: ox + dx * far, y: oy + dy * far, z: oz + dz * far, nx: -dx, ny: -dy, nz: -dz };
      if (ts < 0) return none;
      const hz = oz + dz * ts, solid = { kind: hz < 0.6 ? 'ground' : 'wall', t: ts, x: ox + dx * ts, y: oy + dy * ts, z: Math.max(hz, 0), nx: hz < 0.6 || dz < -0.5 ? 0 : -dx, ny: hz < 0.6 || dz < -0.5 ? 0 : -dy, nz: hz < 0.6 || dz < -0.5 ? 1 : 0 };
      if (hz > 7 || dz > -0.02) return solid;      // it ends on a roof or a high wall: nobody there
      // the last metres above the street: the game's own ray (people, cars, street things, shop fronts), started where the round comes down to 9 m
      const tS = Math.max(tmin, ts - 9 / -dz), h = cast0.call(this, ox + dx * tS, oy + dy * tS, oz + dz * tS, dx, dy, dz, 0, ts - tS + 1.5);
      if (h && h.kind !== 'none') { h.t += tS; return h; }
      return solid;
    };
    console.log('[perch] guns work on roofs above ' + HIGH + ' m; a rifle reaches ' + REACH + ' m and has a scope there');
  }
  const longGun = () => S.C && LONG.includes(S.C.slot);
  function scope(on) {
    if (on === S.scoped) return; S.scoped = on; const R = WEAPONS.rifle;
    if (on) { if (S.C.slot === 'rifle' && R && !S.saved) { S.saved = {}; for (const k in SNIPE) { S.saved[k] = R[k]; R[k] = SNIPE[k]; } } }
    else { if (S.saved && R) { for (const k in S.saved) R[k] = S.saved[k]; S.saved = null; } pl.vis.object.visible = true; }
  }
  addEventListener('wheel', (e) => { if (!S.scoped) return; S.zoom = Math.max(0, Math.min(ZOOMS.length - 1, S.zoom + (e.deltaY < 0 ? 1 : -1))); e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, passive: false });

  // ---------------------------------------------------------------- 4. the street below is alive where you look
  // The game puts cars and people round the player's own spot (game.focus) and the crowd round the camera: from 320 m up that is the foot of
  // the tower, out of sight. On a high roof the street life is put round the WATCH POINT instead: the place in the street the eye rests on
  // (at most 235 m out, so the cars there are still inside the game's own drawing distance). It moves only when the look has moved well away
  // from it, and then the crowd there is run forward a few seconds so the street is already going about its day.
  const WP = { x: 0, y: 0, lx: 0, ly: 0, set: false, moves: 0 };
  { const F = g.focus; let fx = F.x, fy = F.y; Object.defineProperty(F, 'x', { get: () => (S.on && WP.set ? WP.x : fx), set: (v) => { fx = v; }, configurable: true }); Object.defineProperty(F, 'y', { get: () => (S.on && WP.set ? WP.y : fy), set: (v) => { fy = v; }, configurable: true }); }
  function crowdWrap() {
    const cr = g.crowd; if (S.crowd || !cr || !cr.on || !cr.sim || !cr.render) return; S.crowd = cr;
    const view0 = cr.sim.view; cr.sim.view = function () { view0.call(this); if (S.on && WP.set) { this.cx = WP.x; this.cy = WP.y; this.cosCone = -1; this.cosSee = -1; } };
    const upd0 = cr.render.update; cr.render.update = function () { if (!(S.on && WP.set)) return upd0.call(this);
      // drawn as from a wide eye standing in the street at the place looked at (the figures there get their near bodies), then the real camera is put back
      const cam = W.camera, px = cam.position.x, py = cam.position.y, pz = cam.position.z, fov = cam.fov; cam.position.set(WP.lx - S.hx * 8, 2.5, -(WP.ly - S.hy * 8)); cam.fov = 150; cam.updateMatrixWorld(true);
      try { upd0.call(this); } finally { cam.position.set(px, py, pz); cam.fov = fov; cam.updateMatrixWorld(true); } };
  }
  function watch(dt) {
    const c = g.cam, cp = Math.cos(c.pitch), dx = Math.cos(c.yaw) * cp, dy = Math.sin(c.yaw) * cp, dz = -Math.sin(c.pitch), hl = Math.hypot(dx, dy) || 1; S.hx = dx / hl; S.hy = dy / hl;
    const ox = pl.x, oy = pl.y, oz = pl.alt + 1.58; let gx = null, gy = null;
    if (dz < -0.08) { let t = 6, st = 3; while (t < 700) { const z = oz + dz * t; if (z < 0.3 || H.top(ox + dx * t, oy + dy * t, z + 0.5) > z) { if (z < 12) { gx = ox + dx * t; gy = oy + dy * t; break; } if (t > 30) break;     /* his own roof under the line, in the first metres: looked past */ } t += st; st = Math.min(10, st * 1.08); } }
    if (gx === null) { if (WP.set) return; gx = ox + S.hx * 180; gy = oy + S.hy * 180; }      // looking at the sky or a roof: the street life stays where it was
    const d = Math.hypot(gx - ox, gy - oy); if (d > 235) { gx = ox + (gx - ox) / d * 235; gy = oy + (gy - oy) / d * 235; }
    WP.lx = gx; WP.ly = gy;
    if (!WP.set || Math.hypot(gx - WP.x, gy - WP.y) > (S.scoped ? 70 : 130)) { WP.x = gx; WP.y = gy; WP.set = true; WP.moves++; crowdWrap(); S.extra = g.P.get('perchsettle') === '1' ? 0 : 60; if (S.crowd && S.crowd.settle && !S.extra) { try { S.crowd.settle(3); } catch (e) {} } }
    // the crowd at a new watch point is put there by the sim itself (its centre has jumped: it fills the streets at once); then it is run forward a second, two steps a frame,
    // so they are spread along their ways. Before (handoff-1, -2): three seconds run in one frame, a 0.24 s pause on each big swing of the look (?perchsettle=1 = that).
    if (S.extra > 0 && S.crowd && S.crowd.sim) { try { S.crowd.sim.step(1 / 60); S.crowd.sim.step(1 / 60); } catch (e) {} S.extra -= 2; }
  }

  // ---------------------------------------------------------------- 5. the last metres onto the mark
  // The terrace is 8 m wide: flown by keys from 14 m up, a start 1 m off the mark ended over the drop or against the tower (lanes/heli/gates/h3/land.out).
  // So within 10 m of the mark and less than 14 m above it the controls are helped: the cyclic leans toward the mark and brakes the drift, the pedals turn the
  // aircraft along the wall (the same rule the game's own hover holder uses), more firmly the nearer and lower it is, never more than 85 per cent: the hands still fly it.
  const ASSIST = g.P.get('perchassist') !== '0', cl = (v) => Math.max(-1, Math.min(1, v)), wp = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function assist(c, dt) {
    S.helping = 0; if (!ASSIST) return; const f = heli.f; if (f.onGround || f.engine !== 'run') return;
    for (const p of S.pads) { const ex = p.x - f.pos.x, ey = p.y + f.pos.z, d = Math.hypot(ex, ey), h = f.pos.y - 1.25 - p.z, sp = Math.hypot(f.vel.x, f.vel.z); if (d > 70 || h < -1.5 || h > 55) continue;
      // Matt, Nov 17 12:47 ("so difficult", with the 10 m help already live): the help now reaches 70 m out and 55 m up, takes nearly all of the cyclic and pedals once he is
      // within 14 m and slow, and holds him up while he is low beside the deck, so "come near it and hold S" is the whole landing
      const far = Math.max(0, Math.min(1, (70 - d) / 30)) * Math.max(0, Math.min(1, (40 - sp) / 12)), k = Math.min(0.97, d < 14 ? Math.max(far * 0.9, 0.97 - d * 0.012) : far * 0.9);
      const cs = Math.cos(f.heading), sn = Math.sin(f.heading), vf = f.vel.x * cs - f.vel.z * sn, vr = f.vel.x * sn + f.vel.z * cs, a0 = wp(p.h - f.heading), hh = Math.abs(a0) < Math.PI / 2 ? p.h : p.h + Math.PI;
      /* it is flown toward the deck at a speed that falls with the distance (9 m/s at most, a walk at the end), not leaned at it as hard as the distance is long: from 46 m that built 20 m/s and went straight past (the landing clip, fix1 and fix2) */
      const vd = Math.min(9, d * 0.35), ux = ex / (d || 1), uy = ey / (d || 1); c.pitch = c.pitch * (1 - k) + cl(((ux * cs + uy * sn) * vd - vf) * 0.33) * k; c.roll = c.roll * (1 - k) + cl(((ux * sn - uy * cs) * vd - vr) * 0.33) * k; if (d < 25) c.yaw = c.yaw * (1 - k) + cl(-wp(hh - f.heading) * 2) * k;
      /* Not over the deck yet: it may come down gently to 9 m above the deck's level and no lower, however hard S is held; over the deck S takes it down. (The whole trip by real keys, Nov 17:
         flown from the park, S held from 55 m out as the line on the screen says: it sank at 8 m/s and went down beside the tower, 6.7 m short and 17 m under the deck: lanes/heli/bugs/trip1.) */
      if (d > 4.5 && k > 0.3) { const vdv = h > 11 ? -3 : (9 - h) * 0.6; c.lift = Math.max(c.lift, cl((vdv - f.vs) * 0.45)); }
      S.helping = k; if (k > 0.25 && !S.told) { S.told = true; heli.note = { t: 0, text: 'EMPIRE STATE HELIDECK · HOLD S TO SET IT DOWN' }; } return; }
    S.told = false;
  }

  function step(dt) {
    tryMarks();
    if (PICK && !S.picksMade && S.pads.length && g.combat) mkPicks();      // the cases stand on the roofs from the start, to be seen from the air
    { const f = heli.f; let free = false; if (!f.onGround || heli.piloted) for (const p of S.pads) if (Math.abs(f.pos.x - p.x) < 22 && Math.abs(f.pos.z + p.y) < 22 && f.pos.y < p.z + 14 && f.pos.y > p.z - 2) free = true; f.rotorFree = free || (f.onGround && S.pads.some((p) => Math.abs(f.pos.x - p.x) < 22 && Math.abs(f.pos.z + p.y) < 22 && Math.abs(f.pos.y - p.z) < 4)); if (S.beam) { const p0 = S.pads[0], dd = p0 ? Math.hypot(f.pos.x - p0.x, f.pos.z + p0.y) : 0, day = heli.rockets && typeof heli.rockets.day === 'number' ? heli.rockets.day : 1; S.beam.visible = heli.piloted && !f.onGround && f.agl > 1.5 && dd > 28;     /* off within 28 m of the deck (the marker and the deck's lamps take over there; close up it stood across the picture) and a quarter as strong by night */
      if (S.beam.visible) S.beam.material.opacity = (0.16 + 0.1 * Math.sin(g.t * 3.2)) * Math.max(0, Math.min(1, (dd - 28) / 50)) * (0.25 + 0.75 * day); } }
    const C = g.combat; if (C && !S.wrapped && C.cast && C.canCarry) wrap(C);
    const on = roofNow();
    if (on !== S.on) {
      S.on = on;
      if (on) { S.hintT = 0; S.banner = 5; placeCase(); if (WEAPONS.rifle && !S.nameWas) { S.nameWas = WEAPONS.rifle.name; WEAPONS.rifle.name = 'SNIPER RIFLE'; } if (S.C && S.C.slot !== 'rifle' && WEAPONS.rifle && !LONG.includes(S.C.slot)) { try { S.C.equip('rifle'); } catch (e) {} } }
      else { scope(false); if (S.nameWas && WEAPONS.rifle) { WEAPONS.rifle.name = S.nameWas; S.nameWas = null; } }
    }
    if (!on) { WP.set = false; return; } S.hintT += dt; S.banner = Math.max(0, (S.banner || 0) - dt); watch(dt); glass(); picks(dt);
    const K = S.C && S.C.inp, aim = !!(S.C && K && K.aim && longGun() && S.C.armedFoot() && (S.C.zoomT || 0) > 0.5);
    const cam = g.cam;
    if (aim && !S.scoped) { scope(true); S.yaw0 = cam.yaw; S.pitch0 = cam.pitch; S.fov = 0; }
    else if (!aim && S.scoped) scope(false);
    if (S.scoped) {
      // the look slows with the power: what the game turned this step is cut to the scope's share of it
      const k = ZOOMS[S.zoom] / 47 / 0.55; let dy = cam.yaw - S.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      cam.yaw = S.yaw0 + dy * k; cam.pitch = Math.max(-1.2, Math.min(1.35, S.pitch0 + (cam.pitch - S.pitch0) * k)); S.yaw0 = cam.yaw; S.pitch0 = cam.pitch;
      if (S.C.shots !== S._shots) { if (S._shots !== undefined) { S.kick = 1; S.shots++; } S._shots = S.C.shots; }
    } else S._shots = S.C ? S.C.shots : undefined;
    S.u += ((S.scoped ? 1 : 0) - S.u) * Math.min(1, dt * 14); S.kick = Math.max(0, (S.kick || 0) - dt * 3.5);
  }
  // through the scope the camera is the eye at the rifle: set last, just before the frame is drawn
  function sync(dt) {
    // THE NEAR PLANE (Matt, Nov 17 12:47: "landed the heli on a rooftop, got out, and the heli kept disappearing"). The renderer pushes the near plane out with the camera's
    // height (2.4 m on an 81 m roof, 6 m on the Empire State Building): right for a camera in the air, but on foot up there it cuts away the aircraft he stands beside, the
    // roof under him and his own body. It was pinned at 0.5 m here before, but ONCE, in the step, and the helicopter's own camera code wrote it back to the renderer's rule
    // the same moment he got out: seen on a MacBook on the live build (near 2.38 m and 6 m all the time he walked round the aircraft; lanes/heli/bugs/r1-live). Now it is
    // written every drawn frame, last, while he is on foot more than 8 m up or climbing in or out there; through the scope the renderer's own rule stands.
    { const want = !S.scoped && !heli.piloted && !pl.vehicle && (pl.alt || 0) > HIGH && !(g.fly && g.fly.on) ? 0.5 : 0, cam = W.camera;
      if (want) { W.fixedNear = want; if (cam.near !== want) { cam.near = want; cam.updateProjectionMatrix(); } S.near = want; } else if (S.near) { W.fixedNear = 0; S.near = 0; } }
    if (!S.on || !S.scoped) return; const cam = W.camera, c = g.cam, cp = Math.cos(c.pitch), kick = (S.kick || 0) * (S.kick || 0) * 0.012;
    S.dir.set(Math.cos(c.yaw) * cp, -Math.sin(c.pitch) + kick, -Math.sin(c.yaw) * cp).normalize();
    S.eye.set(pl.x, pl.alt + 1.58, -pl.y).addScaledVector(_v.set(S.dir.x, 0, S.dir.z).normalize(), 0.35);
    cam.position.copy(S.eye); cam.up.set(0, 1, 0); cam.lookAt(_d.copy(S.eye).add(S.dir));
    S.fov = S.fov ? S.fov + (ZOOMS[S.zoom] - S.fov) * Math.min(1, (dt || 0.016) * 16) : 30; if (Math.abs(cam.fov - S.fov) > 0.005) { cam.fov = S.fov; cam.updateProjectionMatrix(); }      /* the game's own camera code sets its field of view every frame: ours is kept here and put on last */
    cam.updateMatrixWorld(); pl.vis.object.visible = false;
  }
  // the rifle wears a telescopic sight while he is on a roof: a tube over the receiver, set the first time the rifle is held level (its own axes are read off it then)
  // a telescopic sight for a rifle built by combat/models.js, in the gun's own frame (metres, +X along the barrel, +Y up; userData.muzzle and userData.sightY are its own measures)
  function mkScope(gun) {
    const mx = gun.userData.muzzle.x, sy = (gun.userData.sightY || 0.14) + 0.034, x0 = mx * 0.16, G = new THREE.Group(); G.name = 'roofScope';
    const black = new THREE.MeshStandardMaterial({ color: 0x0d0e0f, roughness: 0.38, metalness: 0.8 }), lens = new THREE.MeshStandardMaterial({ color: 0x20324e, roughness: 0.06, metalness: 1 });
    const tube = (r0, r1, L, x, m) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, 16), m || black); o.rotation.z = -Math.PI / 2; o.position.set(x0 + x, sy, 0); o.castShadow = true; o.frustumCulled = false; G.add(o); return o; };
    tube(0.0135, 0.0135, 0.25, 0); tube(0.0135, 0.024, 0.06, 0.155); tube(0.024, 0.024, 0.055, 0.2125); tube(0.0135, 0.019, 0.03, -0.14); tube(0.019, 0.019, 0.05, -0.18); tube(0.0228, 0.0228, 0.003, 0.2405, lens); tube(0.018, 0.018, 0.003, -0.2055, lens);
    const knob = (ax) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.022, 12), black); if (ax) o.rotation.x = Math.PI / 2; o.position.set(x0 + 0.01, sy + (ax ? 0 : 0.022), ax ? 0.022 : 0); G.add(o); }; knob(0); knob(1);
    for (const x of [-0.065, 0.085]) { const ring = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.066, 0.03), black); ring.position.set(x0 + x, sy - 0.026, 0); ring.castShadow = true; G.add(ring); }
    return G;
  }
  function glass() {
    const C = S.C; if (!C || !C.guns) return; const gun = C.guns.rifle; if (S.glass) { S.glass.visible = S.on && !S.scoped; return; } if (!gun || !gun.userData || !gun.userData.muzzle) return;
    try { const G = mkScope(gun); G.traverse((o) => { o.layers.mask = gun.layers.mask; }); gun.add(G); S.glass = G; G.visible = S.on && !S.scoped; console.log('[perch] telescopic sight on the rifle'); } catch (e) { S.glass = new THREE.Group(); console.log('[perch] sight not set: ' + (e && e.message)); }
  }

  // ---------------------------------------------------------------- 6. a sniper rifle to pick up on the roofs (CHIEF 22:15 Nov 17, from Matt's list: "a sniper rifle pickup on rooftops")
  // On every marked roof (the six roof pads and the Empire State helideck) a rifle with its scope lies on an open case a few steps from the H, under a slow amber ring so it is seen
  // from the door of the aircraft. Walk to it: it is in his hands, full of rounds, the banner says so; the case stands empty for a minute, then there is a rifle in it again.
  // He is still handed the rifle on stepping out (Matt: "I didn't see a sniper"): the pickup is the thing to see and the rounds. ?perchpick=0 = no cases.
  const PICK = g.P.get('perchpick') !== '0'; S.picks = [];
  async function mkPicks() {
    if (!PICK || S.picksMade) return; S.picksMade = true; let build = null; try { build = (await import('../combat/models.js')).buildWeapon; } catch (e) { console.log('[perch] no weapon builder for the roof cases: ' + (e && e.message)); return; }
    const caseM = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.62, metalness: 0.35 }), foam = new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.95 }), latch = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9 });
    const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.05, 0.18), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    for (const p of heli.pads) { if (!p.roof) continue; let spot = null;
      for (const r of [5.2, 4.4, 6.2, 3.6]) { for (let i = 0; i < 12 && !spot; i++) { const a = (p.h || 0) + Math.PI / 2 + i * Math.PI / 6 * (i % 2 ? 1 : -1), x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r; let ok = true; for (const [dx, dy] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) if (Math.abs(H.top(x + dx, y + dy, 1e4) - p.z) > 0.25) { ok = false; break; } if (ok) spot = { x, y, a }; } if (spot) break; }
      if (!spot) continue;
      const G = new THREE.Group(); G.position.set(spot.x, p.z, -spot.y); G.rotation.y = spot.a + 0.4;
      const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; G.add(o); return o; };
      add(new THREE.BoxGeometry(1.18, 0.13, 0.42), caseM, 0, 0.065, 0); add(new THREE.BoxGeometry(1.1, 0.02, 0.36), foam, 0, 0.135, 0);
      const lid = add(new THREE.BoxGeometry(1.18, 0.07, 0.42), caseM, 0, 0.3, -0.27); lid.rotation.x = -1.75; for (const x of [-0.4, 0.4]) add(new THREE.BoxGeometry(0.07, 0.035, 0.02), latch, x, 0.09, 0.215);
      let gun = null; try { gun = build('rifle'); gun.add(mkScope(gun)); gun.rotation.x = Math.PI / 2; gun.position.set(-0.16, 0.175, 0.02); gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); G.add(gun); } catch (e) { console.log('[perch] roof case without a rifle: ' + (e && e.message)); }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.8, 40), ringM); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 4; G.add(ring);
      W.scene.add(G); S.picks.push({ x: spot.x, y: spot.y, z: p.z, G, gun, ring, back: 0, pad: p.name });
    }
    console.log('[perch] sniper rifle cases on ' + S.picks.length + ' roofs');
  }
  // as he steps out, this roof's case is set three steps in front of him, on the side away from the aircraft (the first cut stood them at a fixed place by the H: on the
  // helideck that was behind the helicopter from the door, seen on a MacBook)
  function placeCase() {
    let k = null, bd = 45; for (const q of S.picks) { const d = Math.hypot(pl.x - q.x, pl.y - q.y); if (q.back <= 0 && Math.abs((pl.alt || 0) - q.z) < 1.5 && d < bd) { bd = d; k = q; } } if (!k) return;
    const f = heli.f, ax = pl.x - f.pos.x, ay = pl.y + f.pos.z, L = Math.hypot(ax, ay) || 1, a0 = Math.atan2(ay / L, ax / L);
    for (const r of [3.2, 2.6, 4.0]) for (const da of [0, 0.5, -0.5, 1.0, -1.0]) { const x = pl.x + Math.cos(a0 + da) * r, y = pl.y + Math.sin(a0 + da) * r; let ok = true; for (const [dx, dy] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) if (Math.abs(H.top(x + dx, y + dy, 1e4) - k.z) > 0.25) { ok = false; break; }
      if (ok) { k.x = x; k.y = y; k.G.position.set(x, k.z, -y); k.G.rotation.y = a0 + da - Math.PI / 2; return; } }     /* the open lid on the far side from him, the rifle toward him */
  }
  function picks(dt) {
    if (!PICK) return; if (!S.picksMade && S.pads.length && S.C) mkPicks();
    S.pickNear = null; for (const k of S.picks) { if (k.back > 0) { k.back -= dt; if (k.back <= 0 && k.gun) k.gun.visible = true; } k.ring.scale.setScalar(1 + 0.12 * Math.sin(g.t * 2.6)); k.ring.visible = k.back <= 0;
      if (!S.on || k.back > 0 || Math.abs((pl.alt || 0) - k.z) > 1.5) continue; const d = Math.hypot(pl.x - k.x, pl.y - k.y); if (d < 60 && (!S.pickNear || d < S.pickNear.d)) S.pickNear = { k, d };
      if (d < 1.25 && S.C && !S.scoped) { k.back = 60; if (k.gun) k.gun.visible = false; S.pickNear = null; S.taken = (S.taken || 0) + 1; const am = S.C.ammo && S.C.ammo.rifle, Wp = WEAPONS.rifle; if (am && Wp) { am.mag = Wp.mag; am.reserve = Math.max(am.reserve, Wp.reserve); }
        try { if (S.C.slot !== 'rifle') S.C.equip('rifle'); } catch (e) {} S.banner = 4; S.bannerPick = 4; try { g.sound.door && g.sound.door(); } catch (e) {} } }
    if (S.bannerPick > 0) S.bannerPick -= dt;
  }
  function drawHud(hud) {
    { const c = hud.ctx, Wd = hud.w / hud.k, Hh = 1080, p = S.pads[0], f = heli.f;      // the helideck's marker for the pilot: where it is on the screen and how far
      if (p && heli.piloted && !f.onGround && !g.capture) { const d = Math.hypot(p.x - f.pos.x, p.y + f.pos.z, p.z - f.pos.y); if (d < 1500 && d > 12) { _v.set(p.x, p.z + 4, -p.y).project(W.camera); let x = _v.x, y = _v.y; const behind = _v.z > 1; if (behind) { x = -x; y = -y; } const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86; if (off) { const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86) || 1; x /= m; y /= m; }
          const sx = (x * 0.5 + 0.5) * Wd, sy = (-y * 0.5 + 0.5) * Hh; c.save(); c.translate(sx, sy); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 6; c.beginPath(); c.moveTo(0, -15); c.lineTo(15, 0); c.lineTo(0, 15); c.lineTo(-15, 0); c.closePath(); c.stroke(); c.strokeStyle = '#ffb82e'; c.lineWidth = 3; c.stroke(); c.restore();
          hud.text('H', sx, sy + 6, 15, '#ffb82e', 'center', 800); hud.text('EMPIRE STATE HELIDECK  ' + Math.round(d) + ' m', sx, sy + 36, 14, '#fff', 'center', 700, 1); } } }
    if (!S.on) return; const c = hud.ctx, Wd = hud.w / hud.k, Hh = 1080, cx = Wd / 2, cy = Hh / 2;
    if (S.scoped) {
      const R = Hh * 0.46; c.save();
      c.fillStyle = '#000'; c.beginPath(); c.rect(0, 0, Wd, Hh); c.arc(cx, cy, R, 0, Math.PI * 2, true); c.fill('evenodd');
      const gr = c.createRadialGradient(cx, cy, R * 0.72, cx, cy, R); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)'); c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.92)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - 14, cy); c.moveTo(cx + 14, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy - 14); c.moveTo(cx, cy + 14); c.lineTo(cx, cy + R); c.stroke();
      c.lineWidth = 5; c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - R * 0.42, cy); c.moveTo(cx + R * 0.42, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy + R * 0.42); c.lineTo(cx, cy + R); c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.92)'; for (let i = 1; i <= 4; i++) for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * i * R * 0.085, cy, 2.2, 0, 7); c.fill(); c.beginPath(); c.arc(cx, cy + s * i * R * 0.085, 2.2, 0, 7); c.fill(); }
      c.fillStyle = '#d8281e'; c.beginPath(); c.arc(cx, cy, 1.8, 0, 7); c.fill(); c.restore();
      const A = S.C && S.C.aim, am = S.C && S.C.ammo && S.C.ammo[S.C.slot];
      hud.text([3, 6, 12][S.zoom] + 'x', cx + R * 0.5, cy + R * 0.62, 20, '#fff', 'left', 700, 1);
      if (S.C && S.C.snipHud) S.C.snipHud(hud, cx, cy, R);      /* gameplay/sniphit: the hit mark, drawn after the mask */
      if (A && A.ok && A.kind !== 'none') hud.text(Math.round(A.t) + ' m', cx + R * 0.5, cy + R * 0.62 + 26, 16, A.ped ? '#ff5a45' : '#ffb82e', 'left', 700, 1);
      if (am) hud.text(am.mag + ' / ' + am.reserve, cx - R * 0.5, cy + R * 0.62, 20, am.mag ? '#fff' : '#ff5a45', 'right', 700, 1);
    } else if (!g.capture && S.C) {
      // said plainly and kept on the screen (Matt, Nov 17 12:47: "I didn't see a sniper"): what he holds and how to look through it
      const long = LONG.includes(S.C.slot);
      if (S.banner > 0) { c.globalAlpha = Math.min(1, S.banner); hud.panel(Wd / 2 - 360, 250, 720, 86, 8); hud.text('SNIPER RIFLE', Wd / 2, 290, 30, '#ffb82e', 'center', 800, 3); hud.text(S.bannerPick > 0 ? 'PICKED UP · FULL OF ROUNDS · HOLD RIGHT MOUSE FOR THE SCOPE' : 'HOLD RIGHT MOUSE TO LOOK THROUGH THE SCOPE', Wd / 2, 320, 16, '#fff', 'center', 600, 1.5); c.globalAlpha = 1; }
      if (S.pickNear && S.pickNear.d > 1.5) { const k = S.pickNear.k; _v.set(k.x, k.z + 1.1, -k.y).project(W.camera); if (_v.z < 1 && Math.abs(_v.x) < 0.96 && Math.abs(_v.y) < 0.9) { const sx = (_v.x * 0.5 + 0.5) * Wd, sy = (-_v.y * 0.5 + 0.5) * Hh; hud.text('SNIPER RIFLE  ' + Math.round(S.pickNear.d) + ' m', sx, sy - 10, 14, '#ffb82e', 'center', 800, 1); c.fillStyle = '#ffb82e'; c.beginPath(); c.moveTo(sx, sy + 6); c.lineTo(sx - 7, sy - 4); c.lineTo(sx + 7, sy - 4); c.closePath(); c.fill(); } }
      hud.panel(Wd / 2 - 250, Hh - 150, 500, 44, 22);
      if (long) { hud.text('RMB', Wd / 2 - 196, Hh - 120, 18, '#ffb82e', 'center', 800); hud.text('scope', Wd / 2 - 138, Hh - 120, 17, '#fff', 'center', 600); hud.text('WHEEL', Wd / 2 - 44, Hh - 120, 18, '#ffb82e', 'center', 800); hud.text('3x 6x 12x', Wd / 2 + 44, Hh - 120, 17, '#fff', 'center', 600); hud.text('LMB', Wd / 2 + 134, Hh - 120, 18, '#ffb82e', 'center', 800); hud.text('fire', Wd / 2 + 186, Hh - 120, 17, '#fff', 'center', 600); }
      else { hud.text('2', Wd / 2 - 150, Hh - 120, 18, '#ffb82e', 'center', 800); hud.text('take the SNIPER RIFLE (it has the scope)', Wd / 2 + 20, Hh - 120, 17, '#fff', 'center', 600); }
    }
  }
  S.step = step; S.sync = sync; S.drawHud = drawHud; S.marks = marks; S.assist = assist;
  return S;
}
