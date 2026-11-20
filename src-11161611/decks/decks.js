// decks/decks.js: raised roadways in the game (brooklyn lane, Nov 15). Data: assets/decks/decks.json, shape in lanes/brooklyn/DECKS.md;
// the maths is decks/core.js. The player's car, motorbike and the player on foot ride a deck's surface at its height, rails hold at deck
// height only, and what is under or beside a deck stays on the street. ?decks=0: this file is never fetched. No decks.json (or an empty
// one): one failed fetch at load and nothing is wrapped. ?decks=test loads assets/decks/test-decks.json. ?deckdebug=1 draws grey slabs.
//
// How a height gets into a flat game, with nothing in game.js edited but the one install line:
// - a car: Vehicle.step eases v.z to the kerb height and v.pitch to the squat every step, so the deck's share (v._dk.z, v._dk.p) is taken
//   OFF before the game's step and put back ON after it. Everything that draws from v.z / v.pitch (the car, the driver, the camera) follows.
// - on foot: player.alt, the helicopter lane's roof height (game.js camTarget, heli.sync and jump.js already read it).
// - walls: game.statics.resolve / onSidewalk / raycast are wrapped: a query that belongs to a body up on a deck meets the rails only.
// - traffic and people have no height (they are all on the street): while they step, whoever is more than 2 m up is moved out of their sight.
import { Decks, CLEAR } from './core.js';

const UP = 0.3;       // above this a body is "on a deck": deck rails instead of street walls
const HIGH = 2.0;     // above this it does not touch street-level cars and people at all
const FAR = 1e6;

export async function install(game) {
  const g = game, P = g.P; if (g.decks || (P && P.get('decks') === '0')) return g.decks || null;
  let data = null;
  try { const r = await fetch('assets/decks/' + (P && P.get('decks') === 'test' ? 'test-decks.json' : 'decks.json')); if (r.ok) data = await r.json(); } catch (e) {}
  if (!data || !Array.isArray(data.decks) || !data.decks.length) return null;
  const D = new Decks(data.decks); if (!D.list.length) return null;
  const pl = g.player, st = g.statics, _o = {}, _ax = [0, 0];
  const S = (g.decks = { D, on: true, up: [], pb: { z: 0, vz: 0, air: false, deck: null }, altMine: false, jumpOff: false, inStep: false, stats: { falls: 0, lands: 0 }, group: null });
  const kindOf = (v) => 'car';      // every vehicle the player can take is a road vehicle (the motorbike too); 'walk' decks are for people
  const dk = (v) => v._dk || (v._dk = { z: 0, vz: 0, air: false, deck: null, p: 0 });
  const upNear = (x, y) => { for (const v of S.up) { const R = v.def.len * 0.5 + 1.6; if (Math.abs(x - v.x) < R && Math.abs(y - v.y) < R) return v; } return null; };
  const plZ = () => (pl.vehicle ? (pl.vehicle._dk ? pl.vehicle._dk.z : 0) : S.pb.z);

  // ---------------------------------------------------------------- walls
  const res0 = st.resolve;
  st.resolve = function (x, y, r, out, skip) {
    if (S.on) {
      if (S.up.length) { const v = upNear(x, y); if (v) return D.rails(x, y, r, v._dk.z, out, kindOf(v)); }
      const n = res0.call(this, x, y, r, out, skip);
      return D.near(out.x, out.y) ? n + D.block(out.x, out.y, r, 0, CLEAR, out, r > 0.5 ? 'car' : 'walk') : n;
    }
    return res0.call(this, x, y, r, out, skip);
  };
  const side0 = st.onSidewalk;
  st.onSidewalk = function (x, y) { if (S.on && S.up.length && upNear(x, y)) return false; return side0.call(this, x, y); };
  const ray0 = st.raycast;      // the camera's wall test (and anything else that looks from the player): up on a deck the street's walls are below
  st.raycast = function (ax, ay, bx, by) { if (S.on && plZ() > HIGH && Math.abs(ax - pl.x) < 4 && Math.abs(ay - pl.y) < 4) return 1; return ray0.call(this, ax, ay, bx, by); };

  // ---------------------------------------------------------------- the street's own life does not see what is up on a deck
  const hidden = [];
  const hide = () => { for (const v of S.up) if (v._dk.z > HIGH) { hidden.push(v, v.x); v.x += FAR; } if (plZ() > HIGH) { hidden.push(pl, pl.x); pl.x += FAR; } };
  const show = () => { for (let i = 0; i < hidden.length; i += 2) hidden[i].x = hidden[i + 1]; hidden.length = 0; };
  const blind = (obj, name) => { const f0 = obj && obj[name]; if (typeof f0 !== 'function') return; obj[name] = function (...a) { if (!S.on || (!S.up.length && !(S.pb.z > HIGH))) return f0.apply(this, a); hide(); try { return f0.apply(this, a); } finally { show(); } }; };
  blind(g.traffic, 'step'); blind(g.traffic, 'pushPlayer'); blind(g.peds, 'step');
  // the player's car against other cars: only those on its own level
  const col0 = g.collideCars;
  g.collideCars = function (v, dt) {
    const z = v._dk ? v._dk.z : 0; if (!S.on || (z <= HIGH && !S.up.some((o) => o !== v && o._dk.z > HIGH))) return dt === undefined ? col0.call(this, v) : col0.call(this, v, dt);
    const T = this.traffic, cars = T.cars, vehs = this.vehicles;
    if (z > HIGH) T.cars = [];      // (no traffic drives on a deck yet)
    this.vehicles = vehs.filter((o) => o === v || Math.abs((o._dk ? o._dk.z : 0) - z) < HIGH);
    try { return dt === undefined ? col0.call(this, v) : col0.call(this, v, dt); } finally { T.cars = cars; this.vehicles = vehs; }
  };

  // ---------------------------------------------------------------- the step
  const stepVehicle = (v, dt) => {
    const k = dk(v); if (!k.z && !k.air && !D.near(v.x, v.y)) { k.p = 0; k.deck = null; return; }
    const hitV = D.stepBody(k, v.x, v.y, dt, kindOf(v));
    if (hitV > 0) { S.stats.lands++; if (hitV > 4) { v.damage = (v.damage || 0) + hitV; v.hitT = 0.35; try { g.onCrash(v, hitV); } catch (e) {} } }
    if (k.deck && !k.air) { D.axles(k.deck, v.x, v.y, v.h, (v.def && v.def.wheelbase) || 2.7, _ax); k.z = Math.max(0, _ax[0]); k.p = _ax[1]; }
    else if (k.air) k.p += (Math.max(-0.5, k.vz * 0.04) - k.p) * Math.min(1, dt * 3);      // in the air the nose drops
    else k.p = 0;
    if (k.z > UP) S.up.push(v);
  };
  const stepFoot = (x0, y0, dt) => {
    const b = S.pb;
    if (b.z > UP) {      // up on a deck the street's walls, cars and people are not his: his step is redone from where he stood, against the rails and the cars up here
      const sp = pl.speed || 0; let nx = x0 + Math.cos(pl.h) * sp * dt, ny = y0 + Math.sin(pl.h) * sp * dt;
      D.rails(nx, ny, 0.34, b.z, _o, 'walk'); nx = _o.x; ny = _o.y;
      for (const c of S.up) { if (Math.abs(c._dk.z - b.z) > 1.6) continue; const dx = nx - c.x, dy = ny - c.y, d = Math.hypot(dx, dy), R = 1.3; if (d < R && d > 1e-3) { nx += (dx / d) * (R - d); ny += (dy / d) * (R - d); } }
      pl.x = nx; pl.y = ny;
    }
    if (b.z || b.air || D.near(pl.x, pl.y)) { const was = b.air; D.stepBody(b, pl.x, pl.y, dt, 'walk'); if (b.air && !was) S.stats.falls++; }
  };
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    if (!S.on) return step0(dt);
    for (const v of this.vehicles) { const k = v._dk; if (k && (k.z || k.p)) { v.z -= k.z; v.pitch -= k.p; } }
    const x0 = pl.x, y0 = pl.y, h = this.heli, foot0 = !pl.vehicle && !pl.busy;
    S.inStep = true;
    try { step0(dt); } finally {
      S.inStep = false; S.up.length = 0; const d = dt > 0 ? dt : 0;
      for (const v of this.vehicles) { stepVehicle(v, d); const k = v._dk; if (k.z || k.p) { v.z += k.z; v.pitch += k.p; } }
      const b = S.pb, other = pl.roof || pl.alt < 0 || (h && (h.piloted || h.busy)) || (this.fly && this.fly.on);      // a roof, the subway, the helicopter: theirs
      if (other) { b.z = 0; b.vz = 0; b.air = false; S.altMine = false; }
      else if (pl.vehicle) { const k = dk(pl.vehicle); b.z = k.z; b.vz = k.vz; b.air = k.air; }
      else if (pl.busy) { const v = pl.busy.v; if (v && v._dk) b.z = v._dk.z; }      // getting in or out: at the car's level
      else if (foot0) stepFoot(x0, y0, d);
      else if (D.near(pl.x, pl.y) || b.z) D.stepBody(b, pl.x, pl.y, d, 'walk');
      if (!other) {
        const z = pl.vehicle ? 0 : b.z;      // (in a car the car carries him; alt is the height of his own feet)
        if (z > 1e-3) { pl.alt = z; S.altMine = true; } else if (S.altMine) { pl.alt = 0; S.altMine = false; }
        const J = this.jump;      // jumping knows the street's walls and cars only: off while he is up, as in the subway
        if (J) { if (z > UP && J.on && !(J.core && J.core.own)) { J.on = false; S.jumpOff = true; } else if (z <= UP && S.jumpOff) { J.on = true; S.jumpOff = false; } }
      }
    }
  };
  // the camera is placed inside the game's step, when the car's height is off it
  const tgt0 = g.camTarget.bind(g);
  g.camTarget = function () { const t = tgt0(); if (S.on && S.inStep && pl.vehicle && pl.vehicle._dk) t.z += pl.vehicle._dk.z; return t; };
  const sync0 = g.syncVisuals.bind(g);
  g.syncVisuals = function (dt) {
    sync0(dt); if (!S.on || pl.vehicle) return; const b = S.pb, o = pl.vis && pl.vis.object; if (!o || !(b.z > 1e-3) || pl.roof || pl.alt < 0) return;
    if (pl.busy) o.position.y = (pl.busy.z || 0) + b.z; else if (!(this.heli && (this.heli.piloted || this.heli.busy)) && o.position.y < b.z - 0.01) o.position.y = b.z;
  };

  if (P && P.get('deckdebug') === '1') try { S.group = await debugSlabs(g, D); } catch (e) { console.log('[decks] debug slabs: ' + (e && e.message)); }
  console.log('[decks] ' + D.list.length + ' decks: ' + D.list.map((d) => d.id).join(' '));
  return S;
}

// plain grey slabs, 0.5 m thick, with the rails as low walls: only for ?deckdebug=1 (the bridge model draws the real thing)
async function debugSlabs(g, D) {
  const THREE = await import('three'), group = new THREE.Group(); group.name = 'decks:debug';
  const pos = [], idx = [], quad = (a, b, c, d) => { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
  const P3 = (x, y, z) => [x, z, -y];
  for (const d of D.list) for (const s of d.segs) {
    const lx = -s.ty * d.hw, ly = s.tx * d.hw, bx = s.ax + s.tx * s.L, by = s.ay + s.ty * s.L, T = 0.5;
    const aL = [s.ax + lx, s.ay + ly], aR = [s.ax - lx, s.ay - ly], bL = [bx + lx, by + ly], bR = [bx - lx, by - ly];
    quad(P3(...aL, s.z0), P3(...aR, s.z0), P3(...bR, s.z1), P3(...bL, s.z1));
    quad(P3(...aL, s.z0 - T), P3(...aR, s.z0 - T), P3(...bR, s.z1 - T), P3(...bL, s.z1 - T));
    quad(P3(...aL, s.z0 - T), P3(...aL, s.z0), P3(...bL, s.z1), P3(...bL, s.z1 - T)); quad(P3(...aR, s.z0 - T), P3(...aR, s.z0), P3(...bR, s.z1), P3(...bR, s.z1 - T));
    if (d.rail[0]) quad(P3(...aL, s.z0), P3(...aL, s.z0 + 1.1), P3(...bL, s.z1 + 1.1), P3(...bL, s.z1));
    if (d.rail[1]) quad(P3(...aR, s.z0), P3(...aR, s.z0 + 1.1), P3(...bR, s.z1 + 1.1), P3(...bR, s.z1));
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a8d90, side: THREE.DoubleSide })); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  g.world.scene.add(group); return group;
}
