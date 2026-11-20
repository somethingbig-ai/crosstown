// water/install.js (water lane, Nov 15; Matt: "add like the rivers ... an amazing, amazing boat ... make the water physics amazing").
//   One call at the END of Game.init:  import('./water/install.js').then((m) => m.install(game))        ?water=0: nothing of this is fetched.
// What is where:
//   waves.js     the wave function (CPU and shader text): the river's chop and the boats' wakes
//   river.js     the surface: where the water is (a distance-to-shore picture from city.water and the far banks), the grid, the shader
//   boatphys.js  a hull floating on the wave function (runs in node: lanes/water/tools/sim.mjs)
//   boats.js     the models, made in code (speedboat, ferry, tug, tour boat)
//   fx.js        the churned track, spray, the engine's sound
//   this file    the game's side: boats moored at the piers, F to take one and to step off, the helm, the camera, the other boats on their routes.
// The game's own code is wrapped from here, never edited: tryEnter, stepBusy, step, syncVisuals, camTarget, hud.draw. The tiles lane's streets/water.js
// keeps the shore, the sea wall and the solid edge; its flat surface meshes are hidden while this is on.
// QA (URL): boatat=x,y,h (a speedboat there)  aboard=1 (start at its helm)  sea=<0..2>  waterwire=1  boats=0 (no other boats)
import * as THREE from 'three';
import * as WV from './waves.js';
import { buildRiver } from './river.js';
import { buildField, readBankRings, shoreDist, RANGE } from './field.js';
import { placesOn, riverLines, fairwayOn } from './places.js';
import { initBoat, stepBoat, TUNES } from './boatphys.js';
import { Trail, Spray, BoatSound } from './fx.js';
import { HullFx } from './wakefx.js';
import { waterOf, waterAt } from '../streets/water.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const ss = (u, a, b) => { u = clamp((u - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const slug = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const AMBER = '#ffb52e', KN = 1.94384;
// where boats lie for the taking: places.js (name, lat, lon, kind), for every map; each is put alongside the nearest wall the player can stand at

// a boat with no model yet (boats.js missing or broken): a plain hull, so the rest can be played
function plainBoat(kind) {
  const S = { speedboat: [8.6, 2.6, 0.45, 0.85, 2600], ferry: [64, 14, 3.2, 3.0, 1.5e6], tug: [26, 8, 2.6, 1.6, 2.5e5], tour: [40, 9, 1.8, 2.0, 1.8e5] }[kind] || [8.6, 2.6, 0.45, 0.85, 2600], [len, beam, draft, fb, mass] = S;
  const sh = new THREE.Shape(), hull = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); hull.push([x * len / 2, z * beam / 2 * (x > 0 ? 1 - 0.75 * x * x : 1)]); }
  hull.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: draft + fb, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, fb, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: kind === 'ferry' ? 0xd9661a : kind === 'tug' ? 0x202226 : 0xd8dadb, roughness: 0.35 })); m.castShadow = true; const o = new THREE.Group(); o.add(m);
  if (kind !== 'speedboat') { const c = new THREE.Mesh(new THREE.BoxGeometry(len * 0.6, fb * 1.6, beam * 0.7), new THREE.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.6 })); c.position.y = fb * 1.8; o.add(c); }
  return { object: o, spec: { kind, name: '', len, beam, draft, freeboard: fb, mass, hull, float: null, helm: [-len * 0.08, fb * 0.35, 0], helmPose: 'stand', eye: [-len * 0.08, fb * 0.35 + 1.6, 0], props: [[-len / 2, -draft * 0.6, 0]], bow: [len / 2, 0, 0], board: [[0, fb, -beam / 2], [0, fb, beam / 2]], decks: [] }, parts: { engines: [], wheel: null, lights: {} } };
}

export async function install(game) {
  const g = game, P = g.P, world = g.world, city = g.city, waters = waterOf(city);
  if (g.water || (P && P.get('water') === '0') || !waters) return g.water || null;
  const W = (g.water = { on: false, boats: [], others: [], mine: null, errs: {}, stats: { boards: 0, offs: 0, slams: 0, bumps: 0 }, note: null, hintT: 0 });
  W.err = (k, e) => { if (W.errs[k]) return; W.errs[k] = String(e && (e.stack || e.message) || e); console.log('[water] ' + k + ': ' + W.errs[k]); };
  // ---- wait for the tiles lane's water (the ground of the first area builds it), then draw ours in its place
  for (let i = 0; i < 600 && !world.__water; i++) await new Promise((r) => setTimeout(r, 100));
  const A = (P && P.get('bankdir')) || 'assets/bank/', rings = [];
  if (!(P && P.get('bank') === '0')) for (const w of waters) { try { const r = await fetch(A + slug(w.name) + '.bin'); if (r.ok) rings.push(...readBankRings(await r.arrayBuffer())); } catch (e) { W.err('bank ' + w.name, e); } }
  for (const p of city.waterPiers || []) { const q = p.poly || p; if (q && q.length > 2) rings.push(q); }      // things standing in the water (bridge towers): city.waterPiers = [{ name, poly }] in map metres; boats and swimmers are kept off them, foam laps round them
  // the distance-to-shore picture: in a worker (one to two seconds of arithmetic), on the page itself if a worker cannot be had
  const job = { waters: waters.map((w) => ({ poly: w.poly })), rings }; let F = null;
  try { F = await new Promise((ok, no) => { const wk = new Worker(new URL('./field.js', import.meta.url), { type: 'module' }); const to = setTimeout(() => { wk.terminate(); no(new Error('no answer in 40 s')); }, 40000); wk.onmessage = (ev) => { clearTimeout(to); wk.terminate(); ok(ev.data); }; wk.onerror = (e) => { clearTimeout(to); wk.terminate(); no(new Error(e.message || 'worker fault')); }; wk.postMessage(job); }); } catch (e) { W.err('field worker', e); }
  if (!F) { const t0 = performance.now(); F = buildField(job.waters, rings); F.ms = Math.round(performance.now() - t0); F.onPage = true; }
  W.field = F; W.fieldMs = F.ms;
  const level = (W.level = waters[0].level === undefined ? -1.6 : waters[0].level);
  const R = (W.river = buildRiver(g, F));
  const old = world.scene.getObjectByName('streets_ground_water'); if (old) old.traverse((o) => { if (o.name === 'water') o.visible = false; });
  if (world.farRoot) world.farRoot.userData.streetCube = true; { const bk = world.scene.getObjectByName('streets_ground_bank'); if (bk) bk.userData.streetCube = true; }      // the skyline and the far bank join the mirror picture the water reflects
  if (P.has('sea')) WV.state.sea = clamp(+P.get('sea') || 0, 0, 2.5);
  // ---- the water as the boats feel it (the shader's own numbers)
  const sd = (x, y) => shoreDist(F, x, y), calm = (d) => 0.35 + 0.65 * ss(d, 0, 26);
  const surf = (W.surf = (x, y) => level + WV.heightAt(x, y) * calm(sd(x, y)));
  const _sl = { sx: 0, sy: 0, h: 0 }, env = { surf, slope: (x, y, o) => { WV.sample(x, y, WV.state.t, _sl); const k = calm(sd(x, y)); o.sx = _sl.sx * k; o.sy = _sl.sy * k; return o; } };
  // is a point afloat? (exact against Manhattan's wall: the polygons; the far banks and everything else: the field)
  const afloat = (x, y) => !!waterAt(city, x, y) && sd(x, y) > -1.0;
  const grad = (x, y, o) => { const e = 3; o.x = sd(x + e, y) - sd(x - e, y); o.y = sd(x, y + e) - sd(x, y - e); const l = Math.hypot(o.x, o.y) || 1; o.x /= l; o.y /= l; return o; };      // points to open water
  W.afloat = afloat; W.shoreDist = sd;
  const amb = new THREE.Color(), spray = (W.spray = new Spray(world.scene, world, 5000)), snd = (W.snd = new BoatSound(g.sound));
  if (P.get('wakefx') !== '0') try { W.hullfx = new HullFx(world.scene, world); } catch (e) { W.err('wakefx', e); }      // bow wave, waterline foam, thrown sheets and drops (wakefx.js; ?wakefx=0 = the plain point spray)
  let models = null; try { models = await import('./boats.js'); } catch (e) { W.err('boats.js', e); }
  const make = (kind) => { let m = null; try { if (models) m = models.makeBoat(kind); } catch (e) { W.err('model ' + kind, e); } return m || plainBoat(kind); };

  // ------------------------------------------------------------------------------------------------ a boat in the game
  const _o = { x: 0, y: 0 }, _g = { x: 0, y: 0 }, _v = new THREE.Vector3();
  function addBoat(kind, x, y, h, ai) {
    const M = make(kind), b = initBoat({}, M.spec, x, y, h); b.kind = kind; b.M = M; b.o = M.object; b.ai = ai || null; b.z = surf(x, y); b.moored = !ai; b.mx = x; b.my = y; b.mh = h; b.sprayT = 0; b.bumpT = 0;
    b.o.name = 'boat_' + kind; b.o.rotation.order = 'YZX'; world.scene.add(b.o); b.trail = new Trail(world.scene, world, kind === 'speedboat' ? 110 : 150);
    // a lid over the inside of the hull, drawn into depth only before the water: the surface (which is drawn last, over everything behind it) cannot show inside the boat
    try { const hp = M.spec.hull; if (hp && hp.length > 3) { const sh = new THREE.Shape(); hp.forEach((p, i) => (i ? sh.lineTo(p[0] * 0.96, p[1] * 0.9) : sh.moveTo(p[0] * 0.96, p[1] * 0.9))); const lg = new THREE.ShapeGeometry(sh); lg.rotateX(Math.PI / 2); lg.translate(0, Math.min(M.spec.freeboard * 0.78, 0.6 + M.spec.freeboard * 0.3), 0);
        const lid = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); lid.name = 'boat_lid'; lid.renderOrder = 39; b.o.add(lid); } } catch (e) { W.err('lid', e); }
    (ai ? W.others : W.boats).push(b); return b;
  }
  // a model-frame point (x ahead, y up, z starboard) in the world, three.js frame
  const toWorld = (b, p, out) => { const c = Math.cos(b.h), s = Math.sin(b.h), sp = Math.sin(b.pitch), sr = Math.sin(b.roll); out.set(b.x + c * p[0] + s * p[2], b.z + p[1] + p[0] * sp - p[2] * sr, -(b.y + s * p[0] - c * p[2])); return out; };
  const place = (b) => { b.o.position.set(b.x, b.z, -b.y); b.o.rotation.set(b.roll, b.h, b.pitch, 'YZX'); for (const e of b.M.parts.engines || []) e.rotation.y = -b.rud * 0.45; if (b.M.parts.wheel) b.M.parts.wheel.rotation.z = b.rud * 2.4; };
  // the hull against the shore and the other boats: points of its outline that are not afloat are pushed back to the water
  function shoreHit(b) {
    const hp = b.spec.hull || [[b.spec.len / 2, 0], [0, b.spec.beam / 2], [-b.spec.len / 2, 0], [0, -b.spec.beam / 2]], c = Math.cos(b.h), s = Math.sin(b.h); let hit = 0;
    for (let i = 0; i < hp.length; i += hp.length > 10 ? 2 : 1) { const p = hp[i], x = b.x + c * p[0] + s * p[1], y = b.y + s * p[0] - c * p[1]; if (afloat(x, y)) continue;
      grad(x, y, _g); if (!waterAt(city, x, y) && sd(x, y) > 6) { _g.x = b.mx - x; _g.y = b.my - y; const l = Math.hypot(_g.x, _g.y) || 1; _g.x /= l; _g.y /= l; }      // the river's open end: back the way it came
      const vn = b.vx * _g.x + b.vy * _g.y; if (vn < 0) { b.vx -= _g.x * vn * 1.25; b.vy -= _g.y * vn * 1.25; hit = Math.max(hit, -vn); } b.x += _g.x * 0.12; b.y += _g.y * 0.12;
      const arm = (x - b.x) * _g.y - (y - b.y) * _g.x; b.wh += clamp(arm * 0.02 * Math.min(4, Math.abs(vn) + 0.5), -0.6, 0.6) * (vn < 0 ? 1 : 0.2); }
    if (hit > 0.8 && b.bumpT <= 0) { b.bumpT = 0.4; W.stats.bumps++; if (b === W.mine) { snd.bump(Math.min(1, hit / 6)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + hit * 0.08); } }
    return hit;
  }
  // things standing in the water that are found after the shore picture is made (the ferry slip's piles): W.solids = [{ x, y, r }], solid to hulls here and to swimmers (swim.js)
  W.solids = [];
  function solidHit(b) {
    const L = b.spec.len / 2, hb = b.spec.beam / 2, c = Math.cos(b.h), s = Math.sin(b.h); let hit = 0;
    for (const o of W.solids) { const dx = o.x - b.x, dy = o.y - b.y; if (Math.abs(dx) > L + 2 || Math.abs(dy) > L + 2) continue;
      const fa = dx * c + dy * s, f = clamp(fa, -L + hb, L - hb), px = b.x + c * f, py = b.y + s * f, ex = px - o.x, ey = py - o.y, d = Math.hypot(ex, ey) || 0.01, r = hb * (fa > L - hb ? 0.7 : 0.92) + o.r; if (d >= r) continue;
      const nx = ex / d, ny = ey / d, vn = b.vx * nx + b.vy * ny; b.x += nx * (r - d); b.y += ny * (r - d); if (vn < 0) { b.vx -= nx * vn * 1.25; b.vy -= ny * vn * 1.25; hit = Math.max(hit, -vn); b.wh += clamp(-(f * (c * ny - s * nx)) * 0.02 * Math.min(4, -vn + 0.5), -0.5, 0.5); } }
    if (hit > 0.8 && b.bumpT <= 0) { b.bumpT = 0.4; W.stats.bumps++; if (b === W.mine) { snd.bump(Math.min(1, hit / 6)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + hit * 0.08); } }
    return hit;
  }
  function boatHit(b) {
    for (const o of W.others.concat(W.boats)) { if (o === b) continue; const dx = b.x - o.x, dy = b.y - o.y, R = o.spec.len / 2 + b.spec.len / 2; if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const c = Math.cos(o.h), s = Math.sin(o.h), f = clamp(dx * c + dy * s, -o.spec.len / 2 + o.spec.beam / 2, o.spec.len / 2 - o.spec.beam / 2), px = o.x + c * f, py = o.y + s * f, ex = b.x - px, ey = b.y - py, d = Math.hypot(ex, ey) || 1e-3, r = o.spec.beam / 2 + b.spec.beam * 0.6;
      if (d >= r) continue; const nx = ex / d, ny = ey / d, vn = (b.vx - (o.vx || 0)) * nx + (b.vy - (o.vy || 0)) * ny; b.x += nx * (r - d) * 0.6; b.y += ny * (r - d) * 0.6; if (vn < 0) { b.vx -= nx * vn * 1.3; b.vy -= ny * vn * 1.3; if (-vn > 1 && b.bumpT <= 0) { b.bumpT = 0.4; W.stats.bumps++; if (b === W.mine) { snd.bump(Math.min(1, -vn / 6)); g.cam.shake = Math.min(1, (g.cam.shake || 0) + -vn * 0.1); } } } }
  }
  // spray and the track from what the hull is doing
  function effects(b, dt) {
    const S = b.spec, v = Math.abs(b.vf), big = S.len / 8.6, c = Math.cos(b.h), s = Math.sin(b.h), top = b.tune.top;
    const stern = S.props && S.props[0] ? S.props[0][0] : -S.len / 2, sx = b.x + c * stern, sy = b.y + s * stern;
    b.trail.feed(sx, sy, b.h, b.vf, S.beam * 0.36, clamp((v - 1) / (top * 0.35), 0, 1) * (b.sternWet === undefined ? 1 : 0.3 + 0.7 * b.sternWet) + Math.abs(b.thr || 0) * 0.25, WV.state.t);
    if (W.hullfx && W.hullfx.on) { if (b.ev && b.ev.slam) { const k = b.ev.slam; W.stats.slams++; b.fxSlam = Math.max(b.fxSlam || 0, k); if (b === W.mine) { snd.slam(k); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.35 * k); } } return; }      // wakefx.js throws the water (bow sheets, prop wash, the landing's burst); what follows is the old point spray, kept for when it is off
    if (b.ai && Math.hypot(b.x - g.focus.x, b.y - g.focus.y) > 500) return;
    // bow wave: two sheets thrown out and back from where the stem cuts the water
    const q = clamp((v - top * 0.22) / (top * 0.6), 0, 1); b.sprayT += dt * (q * 520 * Math.min(2.5, big));
    const bowX = (S.bow ? S.bow[0] : S.len / 2) - S.len * (0.08 + 0.22 * q * (b.tune.lift ? 1 : 0));      // a planing hull meets the water further aft
    while (b.sprayT > 1 && q > 0) { b.sprayT -= 1; const sg = Math.random() < 0.5 ? -1 : 1, bx = bowX - Math.random() * S.len * 0.18, bz = sg * S.beam * (0.16 + 0.2 * Math.random()); toWorld(b, [bx, 0.05, bz], _v);
      if (_v.y - surf(_v.x, -_v.z) > 0.5) continue; const out = (1.6 + 2.6 * Math.random()) * (0.5 + q) * Math.sqrt(big), up = (1.4 + 2.2 * Math.random()) * (0.4 + q) * Math.sqrt(big), fw = b.vf * (0.55 + 0.25 * Math.random());
      // a sheet: one soft puff of mist and a handful of hard small drops thrown a little further
      spray.emit(_v.x, _v.y, _v.z, c * fw + s * sg * out, up, -(s * fw - c * sg * out), 0.45 + 0.5 * Math.random(), (0.10 + 0.16 * Math.random()) * Math.sqrt(big), 0.35);
      for (let d = 0; d < 4; d++) { const j = 0.8 + 0.7 * Math.random(), k2 = 0.85 + 0.5 * Math.random(); spray.emit(_v.x + (Math.random() - 0.5) * 0.4, _v.y + Math.random() * 0.15, _v.z + (Math.random() - 0.5) * 0.4, c * fw + s * sg * out * j, up * k2 * 1.15, -(s * fw - c * sg * out * j), 0.5 + 0.6 * Math.random(), 0.018 + 0.03 * Math.random(), 1.6); } }
    // the propeller's wash at the stern
    if ((b.thr || 0) > 0.3 && (b.sternWet === undefined || b.sternWet > 0.4) && Math.random() < dt * 60 * b.thr) { toWorld(b, [stern - 0.3, 0.05, (Math.random() - 0.5) * S.beam * 0.5], _v); const bk = -(2 + 3 * Math.random()) * (1 - q * 0.6);
      spray.emit(_v.x, _v.y, _v.z, c * (b.vf * 0.6 + bk), 1.2 + 2.4 * Math.random() * (0.4 + q), -(s * (b.vf * 0.6 + bk)), 0.4 + 0.4 * Math.random(), 0.12 + 0.14 * Math.random()); }
    if (b.ev && b.ev.slam) { const k = b.ev.slam; W.stats.slams++; for (let i = 0; i < 90 * k + 20; i++) { const a = Math.random() * 6.283, r = 0.3 + Math.random(), sp = (2 + 5 * Math.random()) * (0.5 + k); toWorld(b, [(Math.random() - 0.3) * S.len * 0.5, 0, (Math.random() - 0.5) * S.beam], _v);
        spray.emit(_v.x, _v.y, _v.z, c * b.vf * 0.7 + Math.cos(a) * sp * r, (2.5 + 4 * Math.random()) * (0.5 + k), -(s * b.vf * 0.7) + Math.sin(a) * sp * r, 0.7 + 0.6 * Math.random(), 0.16 + 0.26 * Math.random()); }
      if (b === W.mine) { snd.slam(k); g.cam.shake = Math.min(1, (g.cam.shake || 0) + 0.35 * k); } }
  }
  const NOIN = { steer: 0, throttle: 0, brake: 0 };
  function stepOne(b, dt, inp) {
    b.bumpT -= dt;
    if (b.moored && b !== W.mine) {      // on its lines: held to its berth by soft springs, free to bob
      b.vx += ((b.mx - b.x) * 2.2 - b.vx * 2.0) * dt; b.vy += ((b.my - b.y) * 2.2 - b.vy * 2.0) * dt; b.wh += (wrapPi(b.mh - b.h) * 1.6 - b.wh * 2.2) * dt; }
    stepBoat(b, dt, inp || NOIN, env); shoreHit(b); if (W.solids.length) solidHit(b); boatHit(b); effects(b, dt);
  }

  // ------------------------------------------------------------------------------------------------ berths
  const lat0 = city.meta.lat0, lon0 = city.meta.lon0, toMap = (la, lo) => [(lo - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), (la - lat0) * 110574];
  const play = city.meta.play || [-600, -600, 600, 600], st = g.statics;
  // alongside the wall nearest (x, y): the hull 0.9 m off it, a place to stand 2.6 m inland that the player can reach
  function berth(x, y, spec, range = 150) {
    let best = null; const half = spec.beam / 2 + 0.9;
    for (let dy = -range; dy <= range; dy += 3) for (let dx = -range; dx <= range; dx += 3) { const px = x + dx, py = y + dy, d = sd(px, py); if (d < half - 1.2 || d > half + 1.2) continue; grad(px, py, _g);
      const qx = px + _g.x * (half - d), qy = py + _g.y * (half - d), lx = qx - _g.x * (half + 2.6), ly = qy - _g.y * (half + 2.6); if (lx < play[0] + 4 || lx > play[2] - 4 || ly < play[1] + 4 || ly > play[3] - 4) continue;
      if (waterAt(city, lx, ly) || sd(lx, ly) > -1.2) continue; const hx = -_g.y, hy = _g.x; let ok = true; for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) for (const w of [-1, 1]) { const ex = qx + hx * spec.len * k + _g.x * w * spec.beam * 0.5, ey = qy + hy * spec.len * k + _g.y * w * spec.beam * 0.5; if (!afloat(ex, ey) || sd(ex, ey) < 0.3) ok = false; }
      if (!ok) continue;
      // open water ahead of the bow (or astern: then she lies the other way round), so the first press of the throttle goes somewhere
      let hh = Math.atan2(hy, hx); const clear = (ux, uy) => { for (let d = 8; d <= 90; d += 6) { const ex = qx + ux * d + _g.x * Math.min(d * 0.25, 12), ey = qy + uy * d + _g.y * Math.min(d * 0.25, 12); if (!afloat(ex, ey) || sd(ex, ey) < 2.5) return false; } return true; };
      if (!clear(hx, hy)) { if (clear(-hx, -hy)) hh += Math.PI; else continue; }
      if (st) { st.resolve(lx, ly, 0.34, _o); if (Math.hypot(_o.x - lx, _o.y - ly) > 0.6) continue; }
      const sc = Math.hypot(dx, dy); if (!best || sc < best.sc) best = { sc, x: qx, y: qy, h: hh, lx, ly }; }
    return best;
  }
  W.berths = [];
  try { const spec0 = make('speedboat'); world.scene.remove(spec0.object); const at = P.get('boatat');
    if (at) { const a = at.split(',').map(Number); addBoat('speedboat', a[0], a[1], a[2] || 0).keepHere = true; }
    for (const pc of placesOn(city.meta)) { if (pc.kind !== 'speedboat') continue; const q = berth(pc.x, pc.y, spec0.spec); if (!q || W.berths.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 40)) continue; q.name = pc.name; W.berths.push(q); const b = addBoat('speedboat', q.x, q.y, q.h); b.berth = q; }
  } catch (e) { W.err('berths', e); }
  // moored sailboats (helper maps, Nov 16; scenery, places.js kind 'moorings': the W 79th St Boat Basin): one InstancedMesh a field = one draw call, floated on
  // the surface while the camera is within 1.8 km; nobody boards them and nothing collides with them. ?moorings=0 off.
  try { for (const pc of placesOn(city.meta)) { if (pc.kind !== 'moorings' || !models || !models.mooredSailboat || P.get('moorings') === '0') continue;
      const spots = []; let h0 = Math.PI / 2, dmin = 1e9; for (let r = 0; r <= 150; r += 30) for (let a = r * 0.37; a < r * 0.37 + 6.2 && (r || a === 0); a += r ? 34 / r : 7) { const x = pc.x + Math.cos(a) * r, y = pc.y + Math.sin(a) * r, d = sd(x, y); if (d < 18 || !afloat(x, y) || W.berths.some((o) => Math.hypot(o.x - x, o.y - y) < 35)) continue; spots.push([x, y]); if (d < dmin && d < RANGE - 6) { dmin = d; grad(x, y, _g); h0 = Math.atan2(_g.x, -_g.y); } }
      const n = Math.min(pc.n, spots.length); if (!n) continue; const M = models.mooredSailboat(), im = new THREE.InstancedMesh(M.geometry, M.material, n), list = [], tint = new THREE.Color(); im.name = 'water_moorings'; im.frustumCulled = false;
      for (let i = 0; i < n; i++) { const sp = spots[Math.floor((i + 0.5) * spots.length / n)]; list.push({ x: sp[0], y: sp[1], h: h0 + (((i * 7) % 5) - 2) * 0.05, ph: i * 1.7 }); im.setColorAt(i, tint.set([0xffffff, 0xf3ecdc, 0xdde6ee, 0xffffff, 0xe9e9e4][i % 5])); }
      world.scene.add(im); (W.moorings = W.moorings || { count: 0, sets: [] }).sets.push({ im, list, x: pc.x, y: pc.y, name: pc.name }); W.moorings.count += n; }
    if (W.moorings) { const dm = new THREE.Object3D(); dm.rotation.order = 'YZX'; const svM = g.syncVisuals.bind(g);
      g.syncVisuals = function (dt) { svM(dt); try { const cam = world.camera, t = WV.state.t; for (const S of W.moorings.sets) { const near = Math.hypot(S.x - cam.position.x, S.y + cam.position.z) < 1800; S.im.visible = near; if (!near) continue;
            for (let i = 0; i < S.list.length; i++) { const m = S.list[i]; dm.position.set(m.x, surf(m.x, m.y) - 0.04, -m.y); dm.rotation.set(Math.sin(t * 0.9 + m.ph) * 0.035, m.h + Math.sin(t * 0.13 + m.ph) * 0.05, Math.sin(t * 0.7 + m.ph * 2) * 0.02, 'YZX'); dm.updateMatrix(); S.im.setMatrixAt(i, dm.matrix); }
            S.im.instanceMatrix.needsUpdate = true; } } catch (e) { W.err('moorings', e); } }; }
  } catch (e) { W.err('moorings', e); }

  // ------------------------------------------------------------------------------------------------ the other boats: a ferry, a tug, a tour boat on the Hudson; a ferry on the East River
  // the line a river's boats follow (places.js riverLines: the middle of the water the length of the map, or mark to mark where places.js has fairway marks); each point also gets the unit normal to the line's right
  function channel(w) { const L = riverLines(w, (x, y) => waterAt(city, x, y) === w, sd, RANGE, play, fairwayOn(city.meta, w.name))[0] || [];
    for (let i = 0; i < L.length; i++) { const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; L[i][3] = (b[1] - a[1]) / l; L[i][4] = -(b[0] - a[0]) / l; } return L; }
  function addRoute(kind, line, lane, speed, s0, dir = 1) { if (line.length < 4) return; const i = Math.max(1, Math.min(line.length - 2, Math.floor(s0 * (line.length - 1)))), pt = line[i], nx = line[i + dir], b = addBoat(kind, pt[0], pt[1], Math.atan2(nx[1] - pt[1], nx[0] - pt[0]), { line, lane, speed, i, dir }); b.vf = speed; return b; }
  function rideHull(b, dt) {
    // a big hull does not follow the chop: it takes the mean of the water under its length and width, slowly
    const c = Math.cos(b.h), s = Math.sin(b.h), S = b.spec, hb = surf(b.x + c * S.len * 0.4, b.y + s * S.len * 0.4), hs = surf(b.x - c * S.len * 0.4, b.y - s * S.len * 0.4), hl = surf(b.x - s * S.beam * 0.4, b.y + c * S.beam * 0.4), hr = surf(b.x + s * S.beam * 0.4, b.y - c * S.beam * 0.4), k = Math.min(1, dt * 0.9);
    b.z += ((hb + hs + hl + hr) / 4 - b.z) * k; b.pitch += (Math.atan2(hb - hs, S.len * 0.8) * 0.6 - b.pitch) * k; b.roll += (Math.atan2(hl - hr, S.beam * 0.8) * 0.35 - b.wh * 0.25 - b.roll) * k;
  }
  function stepAI(b, dt) {
    const A = b.ai, L = A.line; let tgt = L[A.i]; const off = (p) => { const o = Math.sign(A.lane) * Math.min(p[2] * 0.55, Math.abs(A.lane)) * A.dir; return [p[0] + (p[3] === undefined ? 1 : p[3]) * o, p[1] + (p[4] || 0) * o]; }; let q = off(tgt);      /* the lane: to the right of the line by `lane` metres (never more than 0.55 of the water there), on the other side coming back */
    if (Math.hypot(q[0] - b.x, q[1] - b.y) < 90) { A.i += A.dir; if (A.i >= L.length || A.i < 0) { A.dir = -A.dir; A.i += A.dir * 2; } q = off(L[A.i]); }
    // the player's boat ahead: ease off and sound nothing; the player gets out of the way or bounces off
    let sp = A.speed; for (const o of W.boats) { const dx = o.x - b.x, dy = o.y - b.y, f = dx * Math.cos(b.h) + dy * Math.sin(b.h), l = Math.abs(-dx * Math.sin(b.h) + dy * Math.cos(b.h)); if (f > 0 && f < b.spec.len * 2.5 && l < b.spec.beam) sp = Math.min(sp, A.speed * f / (b.spec.len * 2.5)); }
    const want = Math.atan2(q[1] - b.y, q[0] - b.x), T = b.tune; b.wh += (clamp(wrapPi(want - b.h) * 0.6, -T.turn, T.turn) * Math.min(1, b.vf / 3) - b.wh) * Math.min(1, dt * 1.2); b.h += b.wh * dt; b.vf += clamp(sp - b.vf, -0.4 * dt, 0.35 * dt);
    b.vx = Math.cos(b.h) * b.vf; b.vy = Math.sin(b.h) * b.vf; b.x += b.vx * dt; b.y += b.vy * dt; b.thr = 0.5; b.rud = clamp(b.wh / T.turn, -1, 1);
    rideHull(b, dt); boatHitAI(b); effects(b, dt);
  }
  function boatHitAI(b) { for (const o of W.others) { if (o === b) continue; const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy), r = (b.spec.len + o.spec.len) * 0.45; if (d < r && d > 1) { b.x += dx / d * (r - d) * 0.05; b.y += dy / d * (r - d) * 0.05; } } }
  // the boats of a river: as on the nine-area map (the Hudson a tug and a tour boat, the East River a ferry), and on a longer line more of them, the extra ones started the other way so they meet and pass (helper maps, Nov 16)
  if (P.get('boats') !== '0') try { for (const w of waters) { const line = channel(w); W['line_' + slug(w.name)] = line; let len = 0; for (let i = 0; i + 1 < line.length; i++) len += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]); line.len = len;
      const hud = /hudson/i.test(w.name), kinds = hud ? ['tug', 'tour'] : ['ferry'], at = hud ? [0.6, 0.3, 0.88, 0.1] : [0.5, 0.14, 0.86]; if (len > 6000) kinds.push('tug'); if (len > 8200) kinds.push(hud ? 'tour' : 'ferry');
      kinds.forEach((k, i) => addRoute(k, line, k === 'tug' ? -170 : k === 'tour' ? 60 : 80, TUNES[k].top * (k === 'tour' ? 0.85 : 0.8), at[i], i < (hud ? 2 : 1) ? 1 : -1)); } } catch (e) { W.err('routes', e); }

  // ------------------------------------------------------------------------------------------------ on and off
  const pl = g.player;
  const nearBoat = () => { if (pl.vehicle || pl.busy || (g.heli && (g.heli.piloted || g.heli.busy)) || (g.fly && g.fly.on)) return null; let best = null, bd = 7.5; for (const b of W.boats) { if (b.canBoard && !b.canBoard()) continue; const d = Math.hypot(b.x - pl.x, b.y - pl.y); if (d < bd + b.spec.len * 0.5 + 1 && Math.abs(b.vf) < 2.5) { const c = Math.cos(b.h), s = Math.sin(b.h), f = clamp((pl.x - b.x) * c + (pl.y - b.y) * s, -b.spec.len / 2, b.spec.len / 2), e = Math.hypot(pl.x - b.x - c * f, pl.y - b.y - s * f); if (e < bd) { bd = e; best = b; } } } return best; };
  const helmMap = (b, out) => { const p = b.spec.helm, c = Math.cos(b.h), s = Math.sin(b.h); out.x = b.x + c * p[0] + s * p[2]; out.y = b.y + s * p[0] - c * p[2]; return out; };
  function board(b) { if (b.onBoard) return b.onBoard(); W.mine = b; W.on = true; b.moored = false; W.stats.boards++; W.hintT = 0; pl.busy = { boat: true, kind: 'hop', t: 0, dur: 0.55, b, x0: pl.x, y0: pl.y, h0: pl.h, z0: st && st.onSidewalk(pl.x, pl.y) ? 0.15 : 0, z: 0 }; g.cam.mode = 'boat'; try { g.sound.door(); } catch (e) {} }
  // a place on land beside the boat to step off to
  function landing(b) { let best = null; for (let a = 0; a < 6.283; a += 0.2618) for (const r of [b.spec.beam / 2 + 1.6, b.spec.beam / 2 + 2.6, b.spec.beam / 2 + 3.8]) for (const f of [0, -0.25, 0.25]) { const c = Math.cos(b.h), s = Math.sin(b.h), x = b.x + c * b.spec.len * f + Math.cos(a) * r, y = b.y + s * b.spec.len * f + Math.sin(a) * r;
      if (waterAt(city, x, y) || sd(x, y) > -1.3 || x < play[0] + 3 || x > play[2] - 3 || y < play[1] + 3 || y > play[3] - 3) continue; if (st) { st.resolve(x, y, 0.34, _o); if (Math.hypot(_o.x - x, _o.y - y) > 0.5) continue; } const d = Math.hypot(x - pl.x, y - pl.y); if (!best || d < best.d) best = { d, x, y }; } return best; }
  function leave(b) { const L = landing(b); if (!L) { W.note = { text: 'Bring her alongside a pier to step off', t: 0 }; return false; } W.stats.offs++; b.moored = true; b.mx = b.x; b.my = b.y; b.mh = b.h; b.thr = 0;
    pl.busy = { boat: true, kind: 'off', t: 0, dur: 0.55, b, x0: pl.x, y0: pl.y, h0: pl.h, z0: pl.busy ? pl.busy.z : 0, x1: L.x, y1: L.y, z: pl.busy ? pl.busy.z : 0 }; return true; }
  function aboard(dt, B) {
    if (B.custom) return B.custom(dt, B);
    const b = B.b, I = g.input; B.t += dt;
    if (B.kind === 'hop') { const k = Math.min(1, B.t / B.dur), e = k * k * (3 - 2 * k); helmMap(b, _o); pl.x = lerp(B.x0, _o.x, e); pl.y = lerp(B.y0, _o.y, e); B.z = lerp(B.z0, b.z + b.spec.helm[1], e) + Math.sin(k * Math.PI) * 0.45; pl.h += wrapPi(b.h - pl.h) * Math.min(1, dt * 8); stepOne(b, dt, NOIN); if (k >= 1) { B.kind = 'helm'; g.playerAnim(b.spec.helmPose === 'sit' ? 'drive' : 'idle'); } return; }
    if (B.kind === 'off') { const k = Math.min(1, B.t / B.dur), e = k * k * (3 - 2 * k); pl.x = lerp(B.x0, B.x1, e); pl.y = lerp(B.y0, B.y1, e); B.z = lerp(B.z0, st && st.onSidewalk(B.x1, B.y1) ? 0.15 : 0, e) + Math.sin(k * Math.PI) * 0.4; if (k >= 1) { pl.busy = null; W.mine = null; W.on = false; g.cam.mode = 'foot'; g.playerAnim('idle'); if (st) { st.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } } return; }
    stepOne(b, dt, I); helmMap(b, _o); pl.x = _o.x; pl.y = _o.y; pl.h = b.h; B.z = b.z + b.spec.helm[1]; pl.speed = 0; W.hintT += dt;
    if (I.use) { I.use = false; if (Math.abs(b.vf) < 3) leave(b); else W.note = { text: 'Slow down to step off', t: 0 }; }
  }
  const te0 = g.tryEnter.bind(g); g.tryEnter = function () { try { const b = nearBoat(); if (b) { board(b); return true; } } catch (e) { W.err('board', e); } return te0(); };
  const sb0 = g.stepBusy.bind(g); g.stepBusy = function (dt) { const B = pl.busy; if (B && B.boat) { try { aboard(dt, B); } catch (e) { W.err('aboard', e); pl.busy = null; W.mine = null; W.on = false; } } else sb0(dt); };
  const step0 = g.step.bind(g); g.step = function (dt) {
    WV.state.t = g.t + dt;
    // wakes the surface carries: the player's boat, then the three nearest others
    try { const m = W.mine || W.boats.find((b) => Math.abs(b.vf) > 1.5); if (m) WV.setWake(0, m.x + Math.cos(m.h) * m.spec.len * (m.tune.lift ? 0.12 : 0.42), m.y + Math.sin(m.h) * m.spec.len * (m.tune.lift ? 0.12 : 0.42), m.h, m.vf * (m.wet === undefined ? 1 : Math.min(1, m.wet * 3)), clamp(m.spec.len / 20, 1, 3.3)); else WV.clearWake(0);
      const near = W.others.slice().sort((a, b) => Math.hypot(a.x - g.focus.x, a.y - g.focus.y) - Math.hypot(b.x - g.focus.x, b.y - g.focus.y)); for (let i = 0; i < 3; i++) { const o = near[i]; if (o) WV.setWake(i + 1, o.x + Math.cos(o.h) * o.spec.len * 0.4, o.y + Math.sin(o.h) * o.spec.len * 0.4, o.h, o.vf * 1.6, o.spec.len / 20); else WV.clearWake(i + 1); } } catch (e) { W.err('wake', e); }
    step0(dt);
    try { for (const b of W.boats) { if (b.auto && !b.driven) b.auto(dt); else if (b !== W.mine) stepOne(b, dt, NOIN); } for (const b of W.others) stepAI(b, dt); if (W.note && (W.note.t += dt) > 3) W.note = null; } catch (e) { W.err('step', e); }
  };
  const sv0 = g.syncVisuals.bind(g); g.syncVisuals = function (dt) {
    sv0(dt);
    try { for (const b of W.boats) place(b); for (const b of W.others) place(b);
      const fog = world.scene.fog; if (fog) amb.copy(fog.color); const cam = world.camera;
      for (const b of W.boats.concat(W.others)) b.trail.update(WV.state.t, surf, amb); if (W.hullfx) W.hullfx.update(W.boats.concat(W.others), dt, WV.state.t, surf, cam); spray.update(dt, amb, cam, world.renderer.domElement.height);
      const B = pl.busy; if (B && B.boat && B.kind === 'helm') { const b = B.b, o = pl.vis.object; toWorld(b, b.spec.helm, _v); o.position.copy(_v); o.rotation.set(b.roll, b.h, b.pitch, 'YZX'); }
      { const all = W.boats.concat(W.others).sort((a, b) => Math.hypot(a.x - cam.position.x, a.y + cam.position.z) - Math.hypot(b.x - cam.position.x, b.y + cam.position.z)), HU = R.U.uRvHull.value, HH = R.U.uRvHullH.value; for (let k = 0; k < 4; k++) { const b = all[k]; if (b && b.x === b.x && b.y === b.y && b.h === b.h) { HU[k * 4] = b.x; HU[k * 4 + 1] = -b.y; HU[k * 4 + 2] = b.spec.len / 2; HU[k * 4 + 3] = b.spec.beam / 2; HH[k * 2] = Math.cos(b.h); HH[k * 2 + 1] = -Math.sin(b.h); } else HU[k * 4 + 2] = 0; } }
      const m = W.mine; snd.update(dt, !!m && pl.busy && pl.busy.kind === 'helm', m ? m.thr : 0, m ? m.vf : 0, m ? (m.sternWet === undefined ? 1 : m.sternWet) : 1, m ? m.tune.top : 24);
    } catch (e) { W.err('sync', e); }
  };
  const ct0 = g.camTarget.bind(g); g.camTarget = function () {
    const B = pl.busy; if (!(B && B.boat) || !B.b) return ct0(); if (B.cam) return B.cam(); const b = B.b, sp = Math.hypot(b.vx, b.vy), big = Math.max(1, b.spec.len / 8.6);
    // behind and above the boat; it rides up and down with the hull (the swell lifts the view), pulls back and widens with speed
    return { x: b.x, y: b.y, z: b.z + 1.25 + 0.5 * (big - 1), dist: (8.2 + sp * 0.11) * Math.sqrt(big) * (big > 2 ? 1.5 : 1), height: 1.55 * Math.sqrt(big), fov: 56 + clamp(sp / 26, 0, 1) * 14, yaw: b.h - b.wh * 0.22, auto: 2.4 + sp * 0.1 };
  };
  if (g.hud && typeof g.hud.draw === 'function') { const hd0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { try { const rn = riverName(); if (rn) { this.street = rn; this.streetT = 3; } } catch (e) { W.err('hudname', e); } hd0(); try { drawHud(this); } catch (e) { W.err('hud', e); } }; }
  // on the river (at a helm, on the ferry's deck, swimming) the HUD's street box names the river: the game's own box, its text set just before it draws
  let lastRiver = '';
  function riverName() { const B = pl.busy; if (pl.vehicle || !B || !(B.boat || B.swim) || B.kind === 'off') return ''; const q = B.boat && B.b ? B.b : pl; if (B.b && B.b.docked) return ''; const w = waterAt(city, q.x, q.y); if (w && w.name) lastRiver = w.name; else if (!lastRiver) { let bd = 1e9; for (const o of waters) for (let i = 0; i < o.poly.length; i += 8) { const d = Math.hypot(o.poly[i][0] - q.x, o.poly[i][1] - q.y); if (d < bd) { bd = d; lastRiver = o.name || ''; } } } return lastRiver; }
  function drawHud(hud) {
    const c = hud.ctx, Wd = hud.w / (hud.k || 1), H = 1080; if (g.demo || g.capture || !hud.w) return;      /* the HUD draws in units of a 1080-high screen */ const B = pl.busy;
    if (!(B && B.boat)) { const b = nearBoat(); if (b) { hud.panel(Wd / 2 - 130, H * 0.62, 260, 44, 22); hud.text(g.menu ? g.menu.keyName('KeyF') : 'F', Wd / 2 - 96, H * 0.62 + 30, 20, AMBER, 'center', 800); hud.text(b.label || 'Take the boat', Wd / 2 + 14, H * 0.62 + 29, 17, '#fff', 'center', 600); } return; }
    if (B.hud && B.hud(hud) === false) return;
    const b = B.b; hud.panel(36, H - 152, 232, 70); hud.text(String(Math.round(Math.abs(b.vf) * KN)), 150, H - 98, 46, '#fff', 'right', 700); hud.text('KNOTS', 160, H - 98, 15, AMBER, 'left', 700, 2);
    if (W.note) { c.globalAlpha = clamp(3 - W.note.t, 0, 1); hud.panel(Wd / 2 - 230, 172, 460, 40, 6); hud.text(W.note.text, Wd / 2, 199, 17, '#fff', 'center', 600, 1); c.globalAlpha = 1; }
    if (W.hintT < 12) { c.globalAlpha = clamp(12 - W.hintT, 0, 1); hud.panel(Wd / 2 - 330, H - 58, 660, 40, 6); hud.text('W  throttle     S  slow / reverse     A D  steer     ' + (g.menu ? g.menu.keyName('KeyF') : 'F') + '  step off at a pier', Wd / 2, H - 31, 15, '#fff', 'center', 600, 1); c.globalAlpha = 1; }
  }
  // QA
  if (P.get('aboard') === '1' && W.boats[0]) { const b = W.boats[0]; helmMap(b, _o); pl.x = _o.x; pl.y = _o.y; board(b); pl.busy.t = pl.busy.dur; }
  W.board = board; W.leave = leave; W.nearBoat = nearBoat;
  W.api = { addBoat, stepOne, rideHull, effects, sd, grad, afloat, surf, play, st, city, toMap, toWorld, NOIN, snd };
  const ferryHere = (() => { if (P.get('ferryat')) return true; const m = toMap(40.7603, -74.0036); return m[0] > play[0] - 300 && m[0] < play[2] + 300 && m[1] > play[1] - 300 && m[1] < play[3] + 300; })();      /* (helper maps) the ride ferry's slip is by Pier 79: on a map without that shore (uptown, DUMBO) ferry.js is not fetched */
  if (P.get('ferry') !== '0' && ferryHere) try { (await import('./ferry.js')).installFerry(g, W, W.api); } catch (e) { W.err('ferry', e); }     // the ferry to ride and drive, its slip and gantry (ferry.js; ?ferry=0 off)
  if (P.get('navlights') !== '0') try { (await import('./navlights.js')).installNav(g, W, W.api); } catch (e) { W.err('navlights', e); }     // the boats' lights after dark (red, green, white)
  if (P.get('swim') !== '0') import('./swim.js').then((m) => m.install(g, W)).catch((e) => console.log('[water] swimming not loaded: ' + (e && e.message)));     // swimming, ladders, cars that go in (swim.js; ?swim=0 off)
  W.ready = true; window.__water = W;
  console.log('[water] rivers on: field ' + F.n + ' px (' + F.cell.toFixed(1) + ' m a cell) in ' + W.fieldMs + ' ms, ' + W.boats.length + ' boats at ' + W.berths.map((q) => q.name).join(', ') + '; ' + W.others.length + ' on routes' + (Object.keys(W.errs).length ? '; faults: ' + Object.keys(W.errs).join(', ') : ''));
  return W;
}
