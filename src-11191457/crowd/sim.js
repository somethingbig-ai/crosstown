// crowd/sim.js: the crowd's behaviour. A cheap CPU sim of a few hundred agents on the walking network of nav.js.
//  - walkers keep to the right half of the sidewalk band, pass slower people and stand-still obstacles, and steer with a turn-rate limit
//    (velocity always along the heading, pace = the walk clip's own speed, so feet do not slide and corners are arcs);
//  - at a junction they plan a few ways ahead towards their own direction of travel: go round the corner, or cross on the walk phase
//    of the game's signal (roads.signal) when no car is coming, else wait at the kerb in a loose bunch;
//  - pairs and threes walk abreast; some people stand (by the wall, at the kerb, on the plazas), alone or facing each other;
//  - the population is fixed in the world: each way has its own density; people are added and taken away only where the camera
//    cannot see them (behind it, behind a building, or far off; at distance also at the building line, as from a doorway);
//  - the player's car: people in its path run aside (Jog), one that is struck goes down and is reported to game.onPedHit.
// Public feedback, Nov 11 (people/crowd-fb; each has its own off switch in the address, ?crowdfb=0 turns all of them off):
//   ?crowdcars=0   people no longer keep out of the player's standing or creeping cars (they walk round them, a car that stops on people is left)
//   ?crowdwalls=0  people who run (from a car, from shots) no longer follow walls, and go back to a walk in a straight line through anything
//   ?crowdtwins=0  nobody minds their double: the same body is put within 14 m of itself, the same top colour side by side
// Public feedback, Nov 13-14 (people/crowd-walls; ?crowdkeep=0 turns these off, and ?crowdfb=0 with the rest):
//   THE BODY RULE (keep): after everything that moves someone in a step (walking, crossing, running from a gun or a car, being
//   stepped aside, following, walking to a place to stand) the body is held out of the collision world as it is at that moment: the
//   step may not cross a wall line (building, shop front, fence, tree guard: it is turned along the line, or not taken), the body is
//   kept a half width off lines, out of the game's solid circles (trunks, poles, hydrants), out of the street furniture the game
//   does not collide (tables, chairs, planters, benches: nav.js), out of parked cars and, on the roadway, out of traffic cars.
//   Everywhere on the map, every state but sitting and lying; the world is read through 4 m cells that are rebuilt when it changes.
//   A CAR IN THE WAY (round): a walker whose line ahead is covered by a car that stands (on a crossing: traffic stopped on it; anywhere: a
//   car the player left, a patrol car, a wreck) passes its nearer free end, off the kerb if that is where the room is; with no room he waits, then turns back.
//   PRESSED AND GETTING NOWHERE (unstick): a walker held by a wall or a fence for 1.5 s turns back; again soon after, he looks for
//   another walk he can reach, then stands until he can be taken away unseen.
//   BODIES (lying): nobody walks over someone on the ground: they are passed like a thing in the way, and never stood on.
// No three.js here: render.js reads the agents' public fields (x y z h scale fall char clip ph clipB phB blend tint acc).
import { aboveMeasuredEdge, staticPathBlocked, exitsNearestBoxFace, segmentHitsBox, clamp, wrapPi, rng, TAU } from '../geo.js';
import { bandAt, furnitureCrossing, overlapsVehicleHeight } from './nav.js';
import { plainSlide } from '../move/plainfall.js';

const RP = 230, R_NEAR = 45, R_BACK = 95, BACK_F = 0.25, CELL = 2.5, GN = 216, TURN = 2.7, REF_WEIGHT = 2900;
const B = { lo: 0, hi: 0 }, B2 = { lo: 0, hi: 0 }, _o = {};
const srgb = (c) => (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
const NO_TINT = 0xffffff;
const NOV_K = [0.07, 0.07, 0.08], NOV_C = [0.12, 0.12, 0.13], NOV_N = [0.08, 0.1, 0.17], NOV_I = [0.09, 0.12, 0.2];
const NOV_TOP = [NOV_K, NOV_K, NOV_K, NOV_C, NOV_C, NOV_N, NOV_N, [0.2, 0.2, 0.21], [0.33, 0.34, 0.36], [0.17, 0.2, 0.14], [0.24, 0.18, 0.13], [0.3, 0.1, 0.12], [0.42, 0.33, 0.22], [0.13, 0.2, 0.2], [0.5, 0.5, 0.52], [0.14, 0.2, 0.3], [0.5, 0.16, 0.14]];
const NOV_BOTTOM = [NOV_K, NOV_K, NOV_K, NOV_C, NOV_C, NOV_I, NOV_I, NOV_I, [0.2, 0.28, 0.4], [0.2, 0.28, 0.4], [0.2, 0.15, 0.12], [0.16, 0.18, 0.13], [0.3, 0.3, 0.32], [0.45, 0.4, 0.3]];

// Use the full body height as a conservative bound throughout the fall.
function onSeparateLevels(walker, body) {
  if (walker.z == null) return false;
  const fallen = body.p;
  const bottom = fallen?.z ?? body.bottom;
  if (bottom == null) return false;
  const top = fallen ? bottom + 1.78 * (fallen.tall ?? 1) : body.top;
  return walker.z >= top || bottom >= walker.z + 1.78 * (walker.tall ?? 1);
}

function clearsFurniture(walker, obstacle) {
  const bounds = obstacle.seatObstacle;
  if (!bounds) return false;
  const floor = walker.z ?? 0;
  return floor >= bounds.top || floor + 1.78 * (walker.tall ?? 1) <= bounds.base;
}

// Endpoint separation handles landings inside an obstacle. This catches a stride
// that enters and leaves the footprint before reaching its endpoint.
function strideCrosses(x, y, dx, dy, length2, cx, cy, radius) {
  const ex = x - cx, ey = y - cy;
  const back = ex*dx + ey*dy;
  if (back <= 0 || back >= length2) return false;
  const radius2 = radius*radius;
  if (ex*ex + ey*ey < radius2) return false;
  const cross = ex*dy - ey*dx;
  return cross*cross < length2*(radius2 - 1e-10);
}

function clipsWallEnd(edges, floor, x, y, dx, dy, length2, radius) {
  for (const edge of edges) {
    if (aboveMeasuredEdge(edge, floor)) continue;
    if (strideCrosses(x, y, dx, dy, length2, edge[0], edge[1], radius) ||
        strideCrosses(x, y, dx, dy, length2, edge[2], edge[3], radius)) return true;
  }
  return false;
}

function strideObstacle(cell, a, x, y, dx, dy, length2) {
  for (const o of cell.circ) {
    if (o.on && strideCrosses(x, y, dx, dy, length2, o.x, o.y, o.r + 0.2)) return 'round';
  }
  for (const o of cell.soft) {
    if (strideCrosses(x, y, dx, dy, length2, o.x, o.y, o.h + 0.12) && !clearsFurniture(a, o)) return 'soft';
  }
  for (const car of cell.cars) {
    if (!car.gone && strideCrossesCar(a, car, x, y, dx, dy)) return 'car';
  }
  return null;
}

function strideCrossesCar(a, car, x, y, dx, dy) {
  const reach = (car.def.len + car.def.wid)/2 + 0.4;
  if (Math.abs(x-car.x) > reach + Math.abs(dx) || Math.abs(y-car.y) > reach + Math.abs(dy)) return false;
  if (!overlapsVehicleHeight(car, a.z ?? 0, 1.78 * (a.tall ?? 1))) return false;
  const c = Math.cos(car.h), s = Math.sin(car.h);
  const ex = x - car.x, ey = y - car.y;
  const u = ex*c + ey*s, v = ey*c - ex*s;
  const du = dx*c + dy*s, dv = dy*c - dx*s;
  // World-to-car projection loses a few ulps at city coordinates. Treat that
  // narrow band as contact so a tangential stride can follow the bumper.
  const epsilon = 8 * Number.EPSILON * Math.max(1, Math.abs(car.x), Math.abs(car.y), car.def.len, car.def.wid);
  const length = car.def.len/2 + 0.2 - epsilon, width = car.def.wid/2 + 0.2 - epsilon;
  // Leave endpoint penetration to outBox, which chooses the recovery face.
  if (Math.abs(u) < length && Math.abs(v) < width) return false;
  if (Math.abs(u-du) < length && Math.abs(v-dv) < width) return false;
  return segmentHitsBox(u-du/2, v-dv/2, du/2, dv/2, length, width);
}

function buildingOnWalk(nav, a, x, y, fromX = a.x, fromY = a.y) {
  const raised = a.z > 1;
  return nav.inBuilding?.(x, y, raised ? a.z + 1.78 * (a.tall ?? 1) : 2.5,
    a.z ?? -Infinity, fromX, fromY);
}

// The character and its height are chosen after sidewalk spawn clearance.
const sidewalkSpawn = { z: 0.15 };

export class CrowdSim {
  constructor(game, nav, opts = {}) {
    this.g = game; this.nav = nav; this.rand = rng(opts.seed || 90210); this.agents = []; this.road = []; this.frame = 0; this.popT = 0; this.nextId = 1;
    this.setCount(opts.count || 450);
    const cast = opts.cast || { characters: [{ name: 'a', height: 1.75 }], clips: { Walk: { speed: 1.36, duration: 1.1 }, IdleShift: { speed: 0, duration: 6.8 } } };
    this.chars = cast.characters;
    // people/street round 2, NOVEMBER (?crowdnov=0 = the cast's own palettes, as before): everybody's top and trousers are drawn from one dark,
    // muted autumn palette (black, charcoal, navy, olive, brown, burgundy, camel, greys; one muted red), whatever the body's own lists say.
    // The bodies' bare arms and legs are dressed in crowd.js (novDress). Copies: the cast file's own rows are left as they are.
    { const P = opts.P || (game && game.P); this.nov = !(P && P.get && P.get('crowdnov') === '0'); if (this.nov) this.chars = this.chars.map((c) => (c.top && c.bottom ? Object.assign({}, c, { top: NOV_TOP, bottom: NOV_BOTTOM }) : c)); }
    this.clipNames = Object.keys(cast.clips); this.clips = this.clipNames.map((n, i) => Object.assign({ i, name: n }, cast.clips[n]));
    const need = cast.clip_accessory || {}, by = (re) => this.clips.find((c) => re.test(c.name));
    for (const c of this.clips) c.needs = need[c.name] || (/^carrybox/i.test(c.name) ? 'box' : null);
    // plain walks: any looping clip that covers ground at a walking pace and needs nothing in the hands
    this.walks = this.clips.filter((c) => c.speed > 0.4 && c.speed < 2.3 && !c.needs && !/jog|run|carry/i.test(c.name));
    this.idles = this.clips.filter((c) => /^idle/i.test(c.name) && !c.seat); if (!this.idles.length) this.idles = [this.clips[0]];
    this.waitClip = by(/^wait/i); this.talkA = by(/^talka$/i); this.talkB = by(/^talkb$/i);
    this.jog = by(/^jog$/i) || by(/^run$/i) || this.walks.reduce((a, b) => (a.speed > b.speed ? a : b));
    // what a thing in the hand does to the walk and to the standing pose: {phone: {walk, stand}, ...}
    this.held = {}; for (const c of this.clips) if (c.needs && !c.seat) { const h = this.held[c.needs] || (this.held[c.needs] = { stands: [] }); if (c.speed > 0.4) h.walk = c; else { h.stands.push(c); if (/look/i.test(c.name)) h.stands.push(c, c); h.stand = c; } }
    // sitting: single clips, and pairs captured together (partner / partner_at in the cast file)
    this.sits = this.clips.filter((c) => c.seat && !c.partner); this.sitPairs = this.clips.filter((c) => c.seat && c.partner && this.clips.some((d) => d.name === c.partner) && c.name < c.partner).map((c) => [c, this.clips.find((d) => d.name === c.partner)]);
    this.acc = cast.accessories || {}; this.accNames = Object.keys(this.acc);
    // which hand each carried thing is in (from its bone); things on the body go with anything
    this.accHand = this.accNames.map((n) => (/hand_l/i.test(this.acc[n].bone || '') ? 'L' : /hand_r/i.test(this.acc[n].bone || '') ? 'R' : null));
    this.kids = []; this.adults = []; this.chars.forEach((c, i) => ((c.height || 1.75) < 1.45 ? this.kids : this.adults).push(i)); if (!this.adults.length) this.adults = this.chars.map((c, i) => i);
    this.head = new Int16Array(GN * GN); this.nxt = new Int16Array(4096); this.cells = []; this.gx0 = 0; this.gy0 = 0;
    this.cx = 1e9; this.cy = 1e9; this.fx = 1; this.fy = 0; this.cosCone = 0.5; this.cosSee = 0.5; this.waysNear = [];
    { const P = opts.P || (game && game.P), on = (k) => !(P && P.get && (P.get(k) === '0' || P.get('crowdfb') === '0')); this.fbCars = on('crowdcars'); this.fbWalls = on('crowdwalls'); this.fbTwins = on('crowdtwins'); this.fbKeep = on('crowdkeep'); this.dodgeOld = !!(P && P.get && P.get('crowddodge') === '0'); }
    this.seats = []; this.addSeats(opts.seats || []);
    this.kg = new Map(); this.kv = 1; this.tcars = []; this.slowCars = []; this.slowOwn = []; this.lying = []; this.lyT = 0; this.kn = { wall: 0, slide: 0, round: 0, soft: 0, car: 0, detour: 0, held: 0, turned: 0, body: 0, unstuck: 0 };
    // the collision world changes (an area's street layer lands after ready, a set comes or goes, a fence breaks): the cells are read again
    try { const st = game.statics; if (st && !st.__crowdV) { st.__crowdV = 1; for (const k of ['addSeg', 'addPoly', 'addCircle', 'removeSet']) { const f = st[k]; if (typeof f === 'function') st[k] = function () { st.__crowdV++; return f.apply(st, arguments); }; } } } catch (e) {}
    this.still = []; this._stillPool = []; this._nb = []; this.twinI = 0; this.fb = { carPush: 0, carMoved: 0, wallTurn: 0, wallStop: 0, wallHold: 0, lost: 0, recast: 0, twinPick: 0, topPick: 0 };
    this.keepOut = opts.keepOut ?? 6.5; this.nStand = 0; this.spawned = 0; this.retired = 0; this.hits = 0; this.ms = 0;
    for (const w of nav.ways) { w.agents = []; w.pop = 0; w.frac = this.rand(); w.wait = [[], []]; w.clearT = -1; w.clear = true; }
    for (const s of nav.spots) s.who = null;
  }

  // the target count: people alive around the camera at a busy corner. It scales every way's density; quiet streets get fewer.
  setCount(n) { this.count = n; this.k = n / REF_WEIGHT; this.cap = Math.round(n * 1.6) + 40; }
  // ------------------------------------------------------------------ who is where, for the camera
  view() {
    const cam = this.g.world.camera; cam.updateMatrixWorld(); const e = cam.matrixWorld.elements; this.cx = cam.position.x; this.cy = -cam.position.z;
    let fx = -e[8], fy = e[10]; const L = Math.hypot(fx, fy); if (L > 0.05) { this.fx = fx / L; this.fy = fy / L; }
    const hf = Math.atan(Math.tan((cam.fov || 55) * Math.PI / 360) * (cam.aspect || 1.78));
    this.cosCone = Math.cos(Math.min(Math.PI * 0.95, hf + 0.45)); this.cosSee = Math.cos(Math.min(Math.PI * 0.9, hf + 0.1));
  }
  // how much of its density a place gets: all of it near and where the camera looks, part of it behind, none far off
  imp(x, y) {
    const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); if (d > RP) return 0; if (d < R_NEAR) return 1;
    if (dx * this.fx + dy * this.fy > d * this.cosCone) return 1; return d < R_BACK ? BACK_F : 0;
  }
  // the few metres in front of a camera that is standing or moving slowly: crowd members keep out of it (walkers steer round, nobody
  // is put there), so nobody is a head-and-shoulders close-up; a moving camera (driving) has no such zone
  inFront(x, y, r = this.keepOut) { if (!this.slow) return false; const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); return d < r && dx * this.fx + dy * this.fy > d * this.cosSee; }
  // can the camera not see this spot? (outside its cone, far off, or behind a building)
  unseen(x, y) {
    const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy); if (d > 165) return true; if (d < 3) return false;
    if (dx * this.fx + dy * this.fy < d * this.cosSee) return d > 9;
    return d > 22 && this.g.statics.raycast(this.cx, this.cy, x, y) < 0.985;
  }

  // ------------------------------------------------------------------ making and removing people
  make(w, s, l, d, kid, at) {
    const r = this.rand, pool = kid && this.kids.length ? this.kids : this.adults; let ci = pool[Math.floor(r() * pool.length) % pool.length];
    const px = at ? at.x : w.ax + w.ux * s + w.nx * l, py = at ? at.y : w.ay + w.uy * s + w.ny * l; if (this.fbTwins) ci = this.castFor(pool, ci, px, py, null);
    const ch = this.chars[ci], scale = 0.955 + r() * 0.09;
    const a = { id: this.nextId++, char: ci, scale, tall: ((ch.height || 1.75) * scale) / 1.78, x: w.ax + w.ux * s + w.nx * l, y: w.ay + w.uy * s + w.ny * l, z: 0.15, h: Math.atan2(w.uy * d, w.ux * d), v: 0, v0: 1.3, vcap: 9,
      w, d, s, l, lt: l, la: 0, lane: 0.25 + r() * 0.7, state: 'walk', t: 0, clip: 0, ph: r(), clipB: 0, phB: 0, blend: 0, rate: 1, rateB: 1, fall: 0, slowT: 0,
      gx: w.ux * d, gy: w.uy * d, path: null, lead: null, fol: null, off: 0, back: 0, tx: 0, ty: 0, th: 0, standT: 0, trip: 150 + r() * 700, onRoad: false, tint: [NO_TINT, NO_TINT, NO_TINT], acc: 0, accT: new Array(this.accNames.length).fill(NO_TINT), female: !!ch.female, spot: null, vx: 0, vy: 0, tk: Math.floor(r() * 3), wq: null, walkClip: null, door: 0, kc: 0, kh: 0, kq: 0, kx: 0, ky: 0, ku: -1e9, kun: 0, ex: 0, ey: 0, escT: 0, gT: 0, rbT: 0, wnx: undefined, wny: undefined, carT: 0, carL: 0, carRoad: false, stuck: 0, _blk: 9, fbBack: 0, fbT: 0, fbN: 0, fbx: 0, fby: 0, lost: false };
    const pick = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT);
    a.tint = [pick(ch.top), pick(ch.bottom), pick(ch.hair)]; if (this.fbTwins) this.topFor(a, ch, px, py);
    // what they carry (kinds, hands and palettes from the cast file): something on the back or shoulder for a third of them, and one
    // thing at most in each hand
    const q = r(), q2 = r(), q3 = r(), F = a.female;
    if (q < 0.15) this.give(a, 'backpack'); else if (q < 0.34) this.give(a, 'bag_shoulder');
    if (q2 < 0.07) this.give(a, 'tote'); else if (q2 < (F ? 0.21 : 0.09)) this.give(a, 'handbag'); else if (q2 < (F ? 0.27 : 0.16)) this.give(a, 'coffee');
    if (q3 < 0.1) this.give(a, 'phone'); else if (q3 < 0.18) this.give(a, 'shopping');
    this.hands(a);
    { const u = r(); this.pace(a, u < 0.16 ? 0.86 + r() * 0.26 : u < 0.78 ? 1.2 + r() * 0.36 : u < 0.975 ? 1.58 + r() * 0.38 : 2.5 + r() * 0.4); }
    w.agents.push(a); this.agents.push(a); this.spawned++; a.home = w; w.pop++; return a;
  }
  // Public feedback ("you can easily see duplicates"): 25 bodies dress 900 people, so the same body is always somewhere in view; what reads
  // as a clone is the same body twice close together, or two of the same top side by side. Who is within 14 m of a place is listed once
  // (_nb: char, squared distance, top colour); a body already there is passed over for one that is not (or, if every body of the pool is
  // there, the one whose double is farthest off).
  castFor(pool, ci, x, y, self) {
    const N = this._nb; N.length = 0; let hit = false; const W2 = this.fbKeep, R = W2 ? 30 : 14, RB = W2 ? 240 : 196, ring = W2 && (x - this.cx) ** 2 + (y - this.cy) ** 2 < 256;
    // (people/crowd-walls, "too many identical pedestrians": the body's double counts out to 15.5 m, and anywhere in the 16 m round the camera when
    // this place is in it too; everyone within 30 m is listed with top and bottom, for dress())
    for (const o of this.agents) { if (o === self) continue; const dx = o.x - x, dy = o.y - y; if (dx > R || dx < -R || dy > R || dy < -R) continue; let d2 = dx * dx + dy * dy; if (d2 > R * R) continue; if (ring && (o.x - this.cx) ** 2 + (o.y - this.cy) ** 2 < 256) d2 = Math.min(d2, 4); N.push(o.char, d2, o.tint[0], o.tint[1]); if (o.char === ci && d2 <= RB) hit = true; }
    if (!hit) return ci;
    const D = this._cd || (this._cd = new Float32Array(this.chars.length)); D.fill(1e9); for (let k = 0; k < N.length; k += 4) if (N[k + 1] <= RB && N[k + 1] < D[N[k]]) D[N[k]] = N[k + 1];
    let free = 0; for (const c of pool) if (D[c] > 1e8) free++;
    if (free) { let k = Math.floor(this.rand() * free) % free; for (const c of pool) if (D[c] > 1e8 && k-- === 0) { this.fb.twinPick++; return c; } }
    let b = ci; for (const c of pool) if (D[c] > D[b]) b = c; if (b !== ci) this.fb.twinPick++; return b;
  }
  // the top: not the colour of anyone's within 3.5 m, nor of this body's double within 14 m (castFor has just listed who is near)
  topFor(a, ch, x, y) {
    const N = this._nb, p = ch.top; if (!p || p.length < 2 || !N.length) return;
    const cd = (t, u) => Math.abs((t >> 16) - (u >> 16)) + Math.abs(((t >> 8) & 255) - ((u >> 8) & 255)) + Math.abs((t & 255) - (u & 255));
    if (!this.fbKeep) { const clash = (t) => { for (let k = 0; k < N.length; k += 4) { if (N[k + 1] > 12.25 && (N[k] !== a.char || N[k + 1] > 196)) continue; if (cd(t, N[k + 2]) < 56) return true; } return false; };
      for (let k = 0; k < 6 && clash(a.tint[0]); k++) { a.tint[0] = srgb(p[Math.floor(this.rand() * p.length) % p.length]); this.fb.topPick++; } return; }
    // people/crowd-walls: the same body within 30 m never in a top that looks the same: of the body's whole palette, a top well apart (120 of
    // 765) from every double's, at random among those; none that far apart: the one farthest from the nearest. The trousers too when a
    // double's top is still close. And, as before, not the top colour of anyone within 3.5 m.
    const score = (t, j) => { let m = 999; for (let k = 0; k < N.length; k += 4) { if (N[k] === a.char) { const d = cd(t, N[k + j]); if (d < m) m = d; } else if (j === 2 && N[k + 1] <= 12.25 && cd(t, N[k + 2]) < 56) m = Math.min(m, 60); } return m; };
    let sc = score(a.tint[0], 2);
    if (sc < 120) { const ok = []; let best = a.tint[0], bs = sc; for (const q of p) { const t = srgb(q), v = score(t, 2); if (v >= 120) ok.push(t); if (v > bs) { bs = v; best = t; } } a.tint[0] = ok.length ? ok[Math.floor(this.rand() * ok.length) % ok.length] : best; sc = ok.length ? 120 : bs; this.fb.topPick++; }
    const pb = ch.bottom; if (sc < 200 && pb && pb.length > 1 && score(a.tint[1], 3) < 70) { let best = a.tint[1], bs = score(best, 3); for (const q of pb) { const t = srgb(q), v = score(t, 3); if (v > bs) { bs = v; best = t; } } a.tint[1] = best; this.fb.topPick++; }
  }
  // another body for someone the camera cannot see (their double has come within 14 m): body, colours and the walk that fits the new legs
  recast(a, ci, keepColours) {
    const ch = this.chars[ci], r = this.rand, pk = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT);
    a.char = ci; a.female = !!ch.female; a.tall = ((ch.height || 1.75) * a.scale) / 1.78; if (!keepColours) { a.tint = [pk(ch.top), pk(ch.bottom), pk(ch.hair)]; this.topFor(a, ch, a.x, a.y); }
    if (a.walkClip) { const was = a.clip, walking = was === a.walkClip.i; this.pace(a, a.v0); if (!walking) a.clip = was; }
    this.fb.recast++;
  }
  // a walking pace, and the mocap walk whose own speed is nearest it (so the clip plays at close to its captured rate)
  pace(a, want) {
    const r = this.rand; if (want > 2.2 && this.jog && !a.lead) { const nat = this.jog.speed * a.tall; a.walkClip = this.jog; a.v0 = clamp(want, nat * 0.92, nat * 1.08); a.clip = this.jog.i; return; }
    want = clamp(want, 0.8, 2.0); let best = null, bd = 9; const ok = [];
    for (const c of this.walks) { const d = Math.abs(Math.log(want / (c.speed * a.tall))); if (d < 0.12) ok.push(c); if (d < bd) { bd = d; best = c; } }
    let c = ok.length ? ok[Math.floor(r() * ok.length)] : best;
    if (a.hand && a.hand.walk && !a.lead && !a.fol) { c = a.hand.walk; want = c.speed * a.tall * (0.95 + r() * 0.1); }     // phone, coffee, a heavy bag: that clip, at its own pace
    a.walkClip = c; const nat = c.speed * a.tall; a.v0 = clamp(want, nat * 0.9, nat * 1.1); a.clip = c.i;
  }
  // hand someone a thing (its tint from that kind's palette); anything already in the same hand goes
  give(a, name) {
    const N = this.accNames, i = N.indexOf(name); if (i < 0) return false; const h = this.accHand[i];
    if (h) for (let k = 0; k < N.length; k++) if (this.accHand[k] === h) a.acc &= ~(1 << k);
    a.acc |= 1 << i; const p = this.acc[name].tint, r = this.rand; a.accT[i] = p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT; return true;
  }
  // the clips that go with what is in the hands: a phone first, then a coffee, then a heavy bag
  hands(a) {
    a.hand = null; for (const n of ['phone', 'coffee', 'tote']) { const i = this.accNames.indexOf(n); if (i >= 0 && (a.acc & (1 << i)) && this.held[n]) { a.hand = this.held[n]; break; } }
    a.idle = (a.hand && a.hand.stands && a.hand.stands.length ? a.hand.stands[Math.floor(this.rand() * a.hand.stands.length) % a.hand.stands.length] : null) || this.idles[Math.floor(this.rand() * this.idles.length) % this.idles.length];
  }
  hold(a, name) { if (name) this.give(a, name); else for (const n of ['phone', 'coffee']) { const i = this.accNames.indexOf(n); if (i >= 0) a.acc &= ~(1 << i); } this.hands(a); }
  remove(a) {
    const i = this.agents.indexOf(a); if (i >= 0) { this.agents[i] = this.agents[this.agents.length - 1]; this.agents.pop(); }
    if (a.w) { const j = a.w.agents.indexOf(a); if (j >= 0) a.w.agents.splice(j, 1); } if (a.home) { a.home.pop--; a.home = null; }
    if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } if (a.spot) { a.spot.who = null; a.spot = null; }
    if (a.state === 'stand') this.nStand--;
    if (a.lead) { const f = a.lead.fol; if (f) { const k = f.indexOf(a); if (k >= 0) f.splice(k, 1); } a.lead = null; }
    if (a.fol) { for (const f of a.fol) { f.lead = null; f.state = f.state === 'stand' ? 'stand' : 'walk'; } a.fol = null; }
    a.gone = true; this.retired++;
  }
  // one person, a pair or three abreast, appearing at s on way w
  spawnOn(w, s, warm, door, dir) {
    const r = this.rand; bandAt(w, s, B); if (B.hi <= 0) return null; const d = dir || (r() < 0.5 ? 1 : -1), wd = B.hi - B.lo;
    const rightIsHi = (w.uy * d) * w.nx + (-w.ux * d) * w.ny > 0;
    const q = r(), kid = this.kids.length > 0 && r() < 0.045, n = q < 0.06 && wd > 2.3 ? 3 : (q < 0.27 || kid) && wd > 1.5 ? 2 : 1, lane = 0.2 + r() * 0.75;
    const laneL = (u) => { const half = (B.lo + B.hi) / 2; return rightIsHi ? half + (B.hi - half) * u : half - (half - B.lo) * u; };
    let l = laneL(lane * (n > 1 ? 0.6 : 1)); if (n > 1) l = clamp(l, B.lo + 0.4, B.hi - 0.4);
    const x = w.ax + w.ux * s + w.nx * l, y = w.ay + w.uy * s + w.ny * l;
    if (this.crowded(x, y, n > 1 ? 1.2 : 0.8, sidewalkSpawn) || Math.hypot(x - this.cx, y - this.cy) < 2.2 || this.inFront(x, y, this.keepOut + 2.5)) return null;
    const spawnL = door ? B.hi + 0.25 : l;
    if (door) {
      const doorX = x + w.nx * (spawnL - l), doorY = y + w.ny * (spawnL - l);
      if (this.crowded(doorX, doorY, n > 1 ? 1.2 : 0.8, sidewalkSpawn) || this.g.statics.raycast(doorX, doorY, x, y) < 1 ||
          (this.fbWalls && (this.nav.inBuilding?.(x, y, 2.5, sidewalkSpawn.z, doorX, doorY) ||
            this.parkBlocksRejoin(doorX, doorY, x, y, true))) ||
          this.crossesFurniture(doorX, doorY, x, y) || this.vehicleAt(x, y, doorX, doorY, undefined, false, undefined, this.fbWalls ? sidewalkSpawn : undefined, Infinity)) return null;
    }
    const a = this.make(w, s, spawnL, d); a.lt = l; a.lane = lane; if (door) { a.door = 1; a.h = Math.atan2(-w.ny + w.uy * d, -w.nx + w.ux * d); }
    if (warm) a.v = a.v0;
    if (n > 1) {
      for (let k = 1; k < n; k++) {
        const off = (k === 1 ? 1 : -1) * (0.7 + r() * 0.14) * (n === 2 && r() < 0.5 ? -1 : 1);
        const x = a.x + Math.sin(a.h) * off, y = a.y - Math.cos(a.h) * off;
        if (this.crowded(x, y, 0.35, sidewalkSpawn) || (this.fbWalls ? this.approachBlocked(a, x, y) :
            this.g.statics.raycast(a.x, a.y, x, y) < 1)) continue;
        if (!a.fol) { a.fol = []; this.pace(a, kid ? 1.05 : a.v0 * 0.9); }
        const f = this.make(w, s, l, d, kid && k === 1); f.lead = a;
        if (kid && k === 1) f.kid = true;
        f.off = off; f.back = 0.05 + r() * 0.3; f.x = x; f.y = y;
        if (f.char === a.char && this.adults.length > 1 && !kid) { do { f.char = this.adults[Math.floor(r() * this.adults.length) % this.adults.length]; } while (f.char === a.char); const ch = this.chars[f.char]; f.female = !!ch.female; f.tall = ((ch.height || 1.75) * f.scale) / 1.78; const pk = (p) => (p && p.length ? srgb(p[Math.floor(r() * p.length) % p.length]) : NO_TINT); f.tint = [pk(ch.top), pk(ch.bottom), pk(ch.hair)]; }
        this.hold(f, null); this.pace(f, a.v0);
        if (f.walkClip === a.walkClip) { const alt = this.walks.filter((c) => c !== a.walkClip && Math.abs(Math.log(a.v0 / (c.speed * f.tall))) < 0.2); if (alt.length) { f.walkClip = alt[Math.floor(r() * alt.length)]; f.clip = f.walkClip.i; } }
        f.ph = (a.ph + 0.27 + r() * 0.46) % 1; if ((f.acc & a.acc) !== 0) { f.acc &= ~a.acc; this.hands(f); } if (f.kid) { f.acc = 0; this.hands(f); f.off *= 0.72; }
        f.v = a.v; a.fol.push(f); }
    }
    return a;
  }
  crowded(x, y, r, spawn) {
    const bounds = this.fbWalls ? spawn : undefined;
    const floor = bounds?.z ?? -Infinity;
    if (this.fbWalls && this.nav.inBuilding?.(x, y, floor > 1 ? floor + 2.5 : 2.5, floor)) return true;
    for (const q of this.agents) if (Math.abs(q.x - x) < r && Math.abs(q.y - y) < r) return true;
    for (const q of this.still) { if (bounds && q.v && !overlapsVehicleHeight(q.v, bounds.z ?? 0, Infinity)) continue; const dx = x - q.x, dy = y - q.y; if (Math.abs(dx * q.c + dy * q.s) < q.hl + 0.3 && Math.abs(-dx * q.s + dy * q.c) < q.hw + 0.3) return true; }
    return this.vehicleAt(x, y, x, y, undefined, false, undefined, bounds, Infinity) || this.g.statics.resolvePedestrian(x, y, 0.3, _o) > 0 || this.nav.blocked(x, y, 0.35);
  }

  approachBlocked(person, x, y, fromX = person.x, fromY = person.y, vehicles, allowExit = false) {
    return (this.fbWalls && buildingOnWalk(this.nav, person, x, y, fromX, fromY)) ||
      this.staticApproachBlocked(fromX, fromY, x, y, allowExit ? person : undefined, this.fbWalls ? person : undefined) ||
      this.vehicleAt(x, y, fromX, fromY, vehicles, allowExit, person, this.fbWalls ? person : undefined, 1.78 * (person.tall ?? 1));
  }
  staticApproachBlocked(fromX, fromY, x, y, person, actor) {
    return this.g.statics.raycast(fromX, fromY, x, y) < 1 ||
      this.parkBlocksRejoin(fromX, fromY, x, y, true, person) ||
      this.crossesFurniture(fromX, fromY, x, y, person, actor ? actor.z ?? 0 : undefined,
        actor ? 1.78 * (actor.tall ?? 1) : undefined);
  }
  crossesFurniture(px, py, tx, ty, person, floor, height) {
    const nearby = this._pathFurniture || (this._pathFurniture = []);
    return furnitureCrossing(this.nav, nearby, px, py, tx, ty, person, 0.25, floor,
      height === undefined ? floor : floor + height - 0.25);
  }
  vehicleAt(x, y, fromX = x, fromY = y, vehicles, allowExit = false, person, seat, bodyHeight, ignoreCar, allowPartialRetreat = false) {
    const hx = (x - fromX) / 2, hy = (y - fromY) / 2;
    const cx = fromX + hx, cy = fromY + hy;
    const hits = car => {
      if (car === ignoreCar || !car.def) return false;
      const dx = cx - car.x, dy = cy - car.y;
      if (Math.abs(dx) + Math.abs(dy) > car.def.len + car.def.wid + 1 + Math.abs(hx) + Math.abs(hy)) return false;
      if (seat && !overlapsVehicleHeight(car, seat.z ?? 0, bodyHeight)) return false;
      if (!hx && !hy) return this.outBox(car, x, y, 0.3, 0);
      // Segment against the pedestrian-expanded box, projected on both car axes and the segment normal.
      const c = Math.cos(car.h), s = Math.sin(car.h);
      const u = dx*c + dy*s, v = dy*c - dx*s, du = hx*c + hy*s, dv = hy*c - hx*s;
      const length = car.def.len/2 + 0.3, width = car.def.wid/2 + 0.3;
      const epsilon = 8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(car.x), Math.abs(car.y));
      if (allowExit) {
        const startU = u-du, startV = v-dv;
        const gapU = length-Math.abs(startU), gapV = width-Math.abs(startV);
        if (gapU >= 0 && gapV >= 0) {
          // Permit retreat through the nearest face, never across the vehicle.
          // Include contact at the face within world-coordinate roundoff.
          if (person) person.retreatingFromObstacle = true;
          // A capped collision correction may need several frames to exit the nearest face.
          if (allowPartialRetreat &&
              ((gapU <= gapV + epsilon && Math.sign(startU)*du > epsilon) ||
               (gapV <= gapU + epsilon && Math.sign(startV)*dv > epsilon))) return false;
          if (exitsNearestBoxFace(startU, startV, u+du, v+dv, length, width, epsilon)) return false;
        }
      }
      const tolerance = allowPartialRetreat ? epsilon : 0;
      return segmentHitsBox(u, v, du, dv, length-tolerance, width-tolerance);
    };
    if (vehicles ? vehicles.some(hits) : this.g.vehicles?.some(hits) || this.g.traffic?.cars?.some(hits)) return true;
    const parked = this.g.parked;
    if (parked?.bodyReach) {
      const nearby = this._spawnParked || (this._spawnParked = []);
      const reach = parked.bodyReach + 0.3 * Math.SQRT2 + Math.hypot(hx, hy);
      return parked.near(cx, cy, reach, nearby).some(hits);
    }
    return false;
  }
  populate(dt, warm) {
    const near = this.nav.near(this.cx, this.cy, RP + 20, this.waysNear), r = this.rand; let budget = warm ? 1e9 : 24; this.lastWant = this.sumWant || 1e9; this.sumWant = 0; this.homed = 0; for (const a of this.agents) if (a.home) this.homed++;
    for (const w of near) {
      if (w.kind === 'cross' || w.rho <= 0) continue;
      let f = 0; for (const u of [1 / 6, 0.5, 5 / 6]) f += this.imp(w.ax + w.ux * w.len * u, w.ay + w.uy * w.len * u); f /= 3;
      const want = Math.floor(this.k * w.rho * w.len * f + w.frac); w.want = want; const have = w.pop; this.sumWant += want;
      if (have < want && this.agents.length < this.cap && budget > 0 && (warm || this.homed < this.lastWant * 1.12 + 8)) {
        for (let n = 0, tries = 0; n < want - have && tries < (warm ? 40 : 4); tries++) {
          const s = r() * w.len, l0 = 1.5, x = w.ax + w.ux * s + w.nx * l0, y = w.ay + w.uy * s + w.ny * l0, fi = this.imp(x, y);
          if (fi <= 0 || r() > fi) continue; let door = false;
          if (!warm && !this.unseen(x, y)) { const d = Math.hypot(x - this.cx, y - this.cy); bandAt(w, s, B); if (d > 80 && B.hi < 11 && r() < 0.35) door = true; else continue; }
          const a = this.spawnOn(w, s, true, door); if (!a) continue; n += 1 + (a.fol ? a.fol.length : 0); budget--; this.homed += 1 + (a.fol ? a.fol.length : 0);
          if (!door && r() < 0.4) for (let q = 1 + Math.floor(r() * 2.5); q > 0 && n < want - have + 2; q--) { const s2 = s + (r() - 0.5) * (8 + r() * 14); if (s2 < 0.5 || s2 > w.len - 0.5) continue; const b = this.spawnOn(w, s2, true, false, r() < 0.7 ? a.d : -a.d); if (b) { const m = 1 + (b.fol ? b.fol.length : 0); n += m; this.homed += m; if (warm) b.ph = r(); } }
          // some of them are standing about rather than walking
          if (!door && !a.fol && r() < 0.17) this.stand(a, 20 + r() * 80, true); else if (!door && a.fol && !a.fol.some((f) => f.kid) && r() < 0.18) this.stand(a, 25 + r() * 90, true);
          if (warm) a.ph = r();
        }
      } else if (have > want + 1 + want * 0.3) {
        let n = 0; for (let i = w.agents.length - 1; i >= 0 && n < 2; i--) { const a = w.agents[i]; if (!a || a.lead || a.state === 'down' || a.state === 'flee') continue; if (!a.fol && a.trip < 1e8) a.trip = -1; if (this.imp(a.x, a.y) < 1 && this.unseen(a.x, a.y) && (!a.fol || a.fol.every((f) => this.unseen(f.x, f.y)))) { for (const f of (a.fol || []).slice()) this.remove(f); this.remove(a); n++; } }
      }
    }
    // people standing on the plazas
    for (const s of this.nav.spots) {
      const f = this.fbWalls && s.dead ? 0 : this.imp(s.x, s.y);
      if (!s.who) { if (f > 0 && !this.inFront(s.x, s.y, this.keepOut + 1.5) && this.agents.length < this.cap && r() < (warm ? 1 : 0.3) * Math.min(1, this.k * 0.9) * f && (warm || this.unseen(s.x, s.y)) && !this.crowded(s.x, s.y, 0.8, s)) this.plazaStander(s); }
      else if (f <= 0 || (s.who.t > s.who.standT && this.unseen(s.x, s.y))) { const a = s.who; for (const q of (a.fol || []).slice()) this.remove(q); this.remove(a); }
    }
    // people sitting: a fixed share of the chairs and benches (the same seats every time one passes), more in a busier city
    if (this.sits.length) { const share = 0.62, tables = 0.17;      // about a tenth of the seats: one table in six, most of its chairs
      const staticVersion = this.g.statics.__crowdV;
      const refreshSeats = this.fbWalls && (this.seatNavVersion !== this.nav.ver ||
        this.seatStaticVersion !== staticVersion);
      this.seatStaticVersion = staticVersion;
      this.seatNavVersion = this.nav.ver;
      for (const q of this.seats) {
        if (q.who) {
          const a = q.who;
          if (a.gone) { q.who = null; continue; }
          const retire = this.imp(q.x, q.y) <= 0 || (warm && (Math.hypot(q.x - this.cx, q.y - this.cy) < 3.5 || this.inFront(q.x, q.y, this.keepOut + 1)));
          if (retire || (this.fbWalls && (this.seatBlocked(q, a.x, a.y, refreshSeats) ||
            a.fol?.some(f => this.seatBlocked(q, f.x, f.y, refreshSeats) ||
              this.seatPairBlocked(q, a.x, a.y, f.x, f.y, refreshSeats))))) {
            for (const f of (a.fol || []).slice()) this.remove(f);
            this.remove(a); q.who = null;
          }
          continue;
        }
        if (q.ut > tables || q.u > share || this.agents.length >= this.cap || this.imp(q.x, q.y) <= 0 || !(warm || this.unseen(q.x, q.y)) || Math.hypot(q.x - this.cx, q.y - this.cy) < 3.5 || this.inFront(q.x, q.y, this.keepOut + 1)) continue;
        this.sit(q);
      } }
    // anyone left where nothing is kept
    for (let i = this.agents.length - 1; i >= 0; i--) { const a = this.agents[i]; if (!a || a.lead) continue; const d = Math.hypot(a.x - this.cx, a.y - this.cy);
      if (d > RP + 25 || (a.state === 'down' && a.t > 9 && this.unseen(a.x, a.y)) || (a.state === 'down' && a.t > 30) || (a.lost && a.state === 'stand' && a.t > 2 && this.unseen(a.x, a.y))) { for (const f of (a.fol || []).slice()) this.remove(f); this.remove(a); }
      else if (a.lost && a.state === 'stand' && this.g.t >= a.rejoinRetryAt) {
        this.rejoin(a);
        if (a.state === 'walk') this.nStand--;
      }
    }
    // People mix after they are put down. Someone whose double has come within 14 m changes body where that cannot be seen: outside the
    // camera's view or behind a building (new colours too), or in view but past the distance where everyone is drawn with one of the few
    // stand-in bodies (render.js tells the sim which: farOf, farR): there the body changes among those that share the stand-in and the
    // colours stay, so nothing on screen changes. A few people are looked at each time (all of them in about 8 s).
    if (this.fbTwins && !warm) { const A = this.agents; for (let k = Math.min(24, A.length); k > 0; k--) { const a = A[this.twinI++ % A.length]; if (!a || a.gone || a.state === 'sit' || a.state === 'down' || a.state === 'flee' || a.kid || this.kids.includes(a.char)) continue;
      let pool = this.adults, far = false; if (!this.unseen(a.x, a.y)) { if (!this.farOf || Math.hypot(a.x - this.cx, a.y - this.cy) < this.farR + 4) continue; far = true; const F = this._fp || (this._fp = {}), key = this.farOf[a.char]; pool = F[key] || (F[key] = this.adults.filter((c) => this.farOf[c] === key)); if (pool.length < 2) continue; }
      const ci = this.castFor(pool, a.char, a.x, a.y, a); if (ci !== a.char) this.recast(a, ci, far); else if (!far) this.topFor(a, this.chars[a.char], a.x, a.y);      /* unseen: also out of a neighbour's top colour */ } }
  }
  plazaStander(s) {
    const r = this.rand, w = this.nav.ways[0], a = this.make(w, 0, 0, 1, false, s); w.agents.pop(); a.w = null; w.pop--; a.home = null;
    a.x = s.x; a.y = s.y; a.z = s.z; a.h = s.h; a.state = 'stand'; this.nStand++; a.standT = 60 + r() * 240; a.tx = s.x; a.ty = s.y; a.th = s.h; a.spot = s; s.who = a; a.v = 0; { const q = r(); this.hold(a, q < 0.4 ? 'phone' : q < 0.6 ? 'coffee' : null); } this.setClip(a, a.idle, true); a.ph = r();
    if (r() < 0.45) {    // someone to talk to
      const target = this.talkPartner(s.x, s.y, s.h);
      if (this.crowded(target.x, target.y, 0.5, s) || (this.fbWalls ? this.approachBlocked(a, target.x, target.y) :
          this.g.statics.raycast(s.x, s.y, target.x, target.y) < 1)) return;
      const b = this.make(w, 0, 0, 1, false, target); w.agents.pop(); b.w = null; w.pop--; b.home = null; b.z = s.z; b.state = 'stand'; this.nStand++; b.standT = 1e9; b.lead = a; a.fol = [b]; b.v = 0; this.talkPlace(a, b, s.x, s.y, s.h, target); a.x = a.tx; a.y = a.ty; a.h = a.th; b.x = b.tx; b.y = b.ty; b.h = b.th; this.setClip(a, a.talk, true); this.setClip(b, b.talk, true); b.ph = a.ph;
    }
  }
  seated(q, x, y, h, clip) {
    const r = this.rand, w = this.nav.ways[0], a = this.make(w, 0, 0, 1, false, { x, y }); w.agents.pop(); a.w = null; w.pop--; a.home = null;
    // hips on the seat: the clip holds them at its own seat height (scaled with the sitter), the seat is where it is
    a.x = x; a.y = y; a.h = h; { const ch = this.chars[a.char], hip = ch.leg && clip.seat_height_leg ? clip.seat_height_leg * ch.leg * a.scale : (clip.seat_height || 0.52) * a.tall; a.z = q.z + q.seat + 0.085 - hip; } a.state = 'sit'; a.v = 0; a.standT = 1e9; a.seatOf = q;
    const tote = this.accNames.indexOf('tote'), shop = this.accNames.indexOf('shopping'), hb = this.accNames.indexOf('handbag'), bp = this.accNames.indexOf('backpack'); for (const i of [tote, shop, hb, bp]) if (i >= 0) a.acc &= ~(1 << i);
    this.hands(a); a.clip = clip.i; a.blend = 0; a.ph = r(); return a;
  }
  seatBlocked(q, x, y, checkStatics = true, bodyHeight = (q.seat ?? 0.46) + 1, clearance = 0.15, leaving) {
    if (this.vehicleAt(x, y, x, y, undefined, false, undefined, q, bodyHeight)) return true;
    if (leaving && this.vehicleAt(x, y, leaving.x, leaving.y, undefined, true, undefined, q, bodyHeight)) return true;
    if (!checkStatics) return false;
    if (this.seatCircleBlocked(q, x, y)) return true;
    if (this.furnitureAtHeight(leaving?.x ?? x, leaving?.y ?? y, x, y, q.z ?? 0, bodyHeight, clearance)) return true;
    const inside = q.z > 1 ? this.nav.inBuilding(x, y, q.z + bodyHeight, q.z) :
      this.nav.inBuilding(x, y, 2.5, q.z ?? -Infinity);
    return inside || this.g.statics.resolve(x, y, 0.3, _o, true, true) > 0;
  }
  seatCircleBlocked(q, x, y, fromX = x, fromY = y, clearance = 0.3) {
    if ((q.z ?? 0) > 1) return false;
    const st = this.g.statics, dx = x-fromX, dy = y-fromY, length2 = dx*dx + dy*dy;
    const reach = st.maxCircleRadius + clearance;
    for (let i = Math.floor((Math.min(x,fromX)-reach)/st.cell); i <= Math.floor((Math.max(x,fromX)+reach)/st.cell); i++) {
      for (let j = Math.floor((Math.min(y,fromY)-reach)/st.cell); j <= Math.floor((Math.max(y,fromY)+reach)/st.cell); j++) {
        const circles = st.circ.get(st.key(i,j));
        if (!circles) continue;
        for (const o of circles) {
          if (!o.on) continue;
          if (o.parkSolid && o.tag === 'bench') {
            if (q.bench && q.x === o.benchOwner?.x && q.y === o.benchOwner?.y) continue;
          } else if (o.kind === 'bench') {
            // Street benches register two circles half a metre along their long axis.
            const dx = o.x - q.x, dy = o.y - q.y;
            if (q.bench && Math.abs(dx*Math.cos(q.h) + dy*Math.sin(q.h)) < 0.001 &&
                Math.abs(Math.hypot(dx,dy) - 0.5) < 0.001) continue;
          } else if (!(o.tag === 'tree' || o.tag === 'light' || o.tag === 'signal' || o.tag === 'hydrant' || (o.parkSolid && (o.tag === 'furniture' || o.tag === 'rock')))) continue;
          const u = length2 ? clamp(((o.x-fromX)*dx + (o.y-fromY)*dy) / length2, 0, 1) : 0;
          if (Math.hypot(fromX+u*dx-o.x, fromY+u*dy-o.y) < o.r + clearance) return true;
        }
      }
    }
    return false;
  }
  furnitureAtHeight(px, py, x, y, floor, bodyHeight, clearance, allowRetreat = false) {
    const nearby = this._seatFurniture || (this._seatFurniture = []);
    nearby.length = 0;
    const left = Math.min(px, x) - clearance, bottom = Math.min(py, y) - clearance;
    const right = Math.max(px, x) + clearance, top = Math.max(py, y) + clearance;
    this.nav.soft(left, bottom, right, top, nearby);
    if (floor + bodyHeight > 1 && this.nav.hasRaisedTables !== false) this.nav.raisedTablesNear?.(left, bottom, right, top, nearby);
    const dx = x - px, dy = y - py, length2 = dx*dx + dy*dy;
    for (const o of nearby) {
      if (!o.seatObstacle || floor >= o.seatObstacle.top || floor + bodyHeight <= o.seatObstacle.base) continue;
      const radius = o.h + clearance;
      if (allowRetreat && (o.x - px)*dx + (o.y - py)*dy <= 0) continue;
      if (Math.hypot(x - o.x, y - o.y) < radius) return true;
      if (length2) {
        const u = ((o.x - px)*dx + (o.y - py)*dy) / length2;
        if (u > 0 && u < 1 && Math.hypot(px + u*dx - o.x, py + u*dy - o.y) < radius) return true;
      }
    }
    return false;
  }
  seatTaken(q, x, y, leaving, height = (q.seat ?? 0.46) + 1) {
    const floor = q.z ?? 0;
    for (const a of this.agents) {
      if (a === leaving || a.gone) continue;
      const otherFloor = a.seatOf?.z ?? a.z ?? 0;
      const otherHeight = a.seatOf ? (a.seatOf.seat ?? 0.46) + 1 : 1.78 * (a.tall ?? 1);
      if (floor >= otherFloor + otherHeight || otherFloor >= floor + height) continue;
      const dx = a.x - x, dy = a.y - y;
      if (dx * dx + dy * dy < 0.4 * 0.4) return true;
    }
    return false;
  }
  seatPairBlocked(q, ax, ay, bx, by, checkStatics = true) {
    const floor = q.z ?? 0, height = (q.seat ?? 0.46) + 1;
    return this.vehicleAt(bx, by, ax, ay, undefined, false, undefined, q, height) ||
      (checkStatics && (this.g.statics.raycast(ax, ay, bx, by) < 1 ||
        staticPathBlocked(this.g.statics, ax, ay, bx, by, true, undefined, 0.15, 0.15) ||
        this.seatCircleBlocked(q, bx, by, ax, ay, 0.15) ||
        this.nav.inBuilding?.(bx, by, floor + height, floor, ax, ay) ||
        this.furnitureAtHeight(ax, ay, bx, by, floor, height, 0.15)));
  }
  sit(q) {
    const r = this.rand, c = Math.cos(q.h), sn = Math.sin(q.h);
    if (q.bench && this.sitPairs.length && q.u < 0.2) { const P = this.sitPairs[Math.floor(r() * this.sitPairs.length) % this.sitPairs.length], at = P[0].partner_at || [0, -0.45, 0];
      const ax = q.x + sn * at[1] / 2, ay = q.y - c * at[1] / 2;
      const bx = ax + c * at[0] - sn * at[1], by = ay + sn * at[0] + c * at[1];
      if (!this.fbWalls || (!this.seatBlocked(q, ax, ay) && !this.seatBlocked(q, bx, by) &&
          !this.seatTaken(q, ax, ay) && !this.seatTaken(q, bx, by) &&
          !this.seatPairBlocked(q, ax, ay, bx, by))) {
        const a = this.seated(q, ax, ay, q.h, P[0]);
        const b = this.seated(q, bx, by, q.h + at[2] * Math.PI / 180, P[1]);
        b.ph = a.ph; b.lead = a; a.fol = [b]; q.who = a; return;
      }
    }
    if (this.fbWalls && (this.seatBlocked(q, q.x, q.y) || this.seatTaken(q, q.x, q.y))) return;
    const cl = this.sits[Math.floor(r() * this.sits.length) % this.sits.length]; q.who = this.seated(q, q.x, q.y, q.h, cl);
  }
  // stop and stand for a while: alone by the wall or at the kerb, or (a pair) facing each other
  stand(a, secs, now) {
    const w = a.w, r = this.rand; if (!w || w.kind !== 'strip' || w.len < 8 || a.state !== 'walk') return false; bandAt(w, a.s, B); if (B.hi <= 0 || B.hi - B.lo < 2.0) return false;
    const wall = r() < 0.7, l = wall ? B.hi - 0.05 + (B.hi < 11 ? 0.15 : 0) : Math.max(0.55, B.lo - 0.55), s = clamp(a.s + a.d * (now ? 0 : 1.5 + r() * 2), 1, w.len - 1);
    const x = w.ax + w.ux * s + w.nx * l, y = w.ay + w.uy * s + w.ny * l;
    if (this.inFront(x, y, this.keepOut + 1.5) || !this.g.statics.onSidewalk(x, y) || this.nav.blocked(x, y, 0.4) || (a.fol && a.fol.length && this.nav.blocked(x + w.ux * 0.6, y + w.uy * 0.6, 0.4))) return false;
    for (const q of w.agents) if (q !== a && q.lead !== a && q.lead !== a.lead && q.state === 'stand' && Math.hypot(q.tx - x, q.ty - y) < 3.4 + (q.id % 5)) return false;
    const face = Math.atan2(w.ny, w.nx) + (wall ? Math.PI : 0) + (r() - 0.5) * 1.2;   // by the wall: back to it, looking out; at the kerb: looking in
    for (const q of this.agents) if (q.state === 'wait' && q.wq && Math.abs(q.tx - x) < 1.6 && Math.abs(q.ty - y) < 1.6 && q !== a) return false;      /* people/crowd-kerb: not in a kerb bunch */
    const follower = a.fol?.[0], heading = Math.atan2(w.uy, w.ux);
    const leadX = follower ? x - w.ux * 0.5 : x, leadY = follower ? y - w.uy * 0.5 : y;
    const blocked = (person, tx, ty) => this.approachBlocked(person, tx, ty) ||
      this.g.statics.resolvePedestrian(tx, ty, 0.25, _o) || this.nav.blocked(tx, ty, 0.4);
    if (blocked(a, leadX, leadY)) return false;
    const partner = follower && this.talkPartner(leadX, leadY, heading);
    if (partner && blocked(follower, partner.x, partner.y)) return false;
    let third;
    if (a.fol?.[1]) {
      const mx = (leadX + partner.x) / 2, my = (leadY + partner.y) / 2, sd = r() < 0.5 ? 1 : -1, ox = -w.uy * sd, oy = w.ux * sd, dd = 0.85 + r() * 0.3, jx = (r() - 0.5) * 0.4; const gx = mx + ox * dd + w.ux * jx; const gy = my + oy * dd + w.uy * jx; const gh = Math.atan2(my - gy, mx - gx) + (r() - 0.5) * 0.5;
      if (blocked(a.fol[1], gx, gy)) return false;
      third = {x: gx, y: gy, h: gh};
    }
    a.state = 'stand'; this.nStand++; a.t = 0; a.standT = secs; a.tx = x; a.ty = y; a.th = face; a.path = null;
    if (a.fol && a.fol.length) { const f = a.fol[0]; this.talkPlace(a, f, leadX, leadY, heading, partner); f.state = 'stand'; this.nStand++; f.standT = 1e9; f.t = 0; if (now) { f.x = f.tx; f.y = f.ty; f.h = f.th; f.v = 0; this.setClip(f, f.talk, true); }
      const g = a.fol[1]; if (g) { g.tx = third.x; g.ty = third.y; g.th = third.h; g.state = 'stand'; this.nStand++; g.standT = 1e9; g.t = 0; g.talk = null; if (now) { g.x = g.tx; g.y = g.ty; g.h = g.th; g.v = 0; this.setClip(g, g.idle, true); } } }
    if (!a.fol) { const q = r(); this.hold(a, q < 0.4 ? 'phone' : q < 0.6 ? 'coffee' : null); }
    if (now) { a.x = a.tx; a.y = a.ty; a.h = a.th; a.v = 0; this.setClip(a, a.fol ? a.talk : a.idle, true); if (a.fol) a.fol[0].ph = a.ph; }
    return true;
  }

  // two people talking: the pair of clips was captured together, so the second stands where the capture had them and both run on one clock
  talkPartner(x, y, h) {
    const at = this.talkA?.partner_at || [0.95, 0, 180], c = Math.cos(h), sn = Math.sin(h);
    return {x: x + c * at[0] - sn * at[1], y: y + sn * at[0] + c * at[1], h: h + at[2] * Math.PI / 180};
  }
  talkPlace(a, b, x, y, h, target = this.talkPartner(x, y, h)) {
    a.tx = x; a.ty = y; a.th = h; b.tx = target.x; b.ty = target.y; b.th = target.h;
    a.talk = this.talkA || a.idle; b.talk = this.talkB || b.idle;
  }
  // ------------------------------------------------------------------ people/crowd-walls: the body rule
  addSeats(L, refresh = false) {
    const have = this._seatK || (this._seatK = new Set());
    const key = q => Math.round(q.x * 20) + ',' + Math.round(q.y * 20) +
      (this.fbWalls ? ',' + Math.round((q.z ?? 0) * 20) : '') + (q.bench ? 'b' : '');
    if (refresh && this.fbWalls) {
      const listed = new Map();
      for (const q of L) if (!listed.has(key(q))) listed.set(key(q), q);
      this.seats = this.seats.filter(q => {
        const k = key(q), next = listed.get(k);
        if (next && q.x === next.x && q.y === next.y && q.h === next.h && q.z === next.z && q.seat === next.seat) return true;
        if (q.who && !q.who.gone) {
          for (const mate of (q.who.fol || []).slice()) this.remove(mate);
          this.remove(q.who);
        }
        q.who = null;
        have.delete(k);
        return false;
      });
    }
    for (const q0 of L) { const k = key(q0); if (have.has(k)) continue; have.add(k);
      const q = Object.assign({ who: null }, q0); q.u = Math.abs((Math.sin(q.x * 12.9898 + q.y * 78.233) * 43758.5453) % 1); q.ut = Math.abs((Math.sin(Math.round(q.x / 2.8) * 91.7 + Math.round(q.y / 2.8) * 37.3) * 43758.5453) % 1); this.seats.push(q); }
  }
  // what stands within reach of a 4 m cell: wall lines, solid circles, parked cars (as boxes), uncollided furniture. Kept until the
  // collision world or the network's furniture changes, and for 30 s at most (circles are switched on and off in place).
  cellAt(x, y) {
    const i = Math.floor(x / 4), j = Math.floor(y / 4), k = i * 100003 + j, g = this.g, st = g.statics, ver = (st.__crowdV || 0) * 4096 + (this.nav.ver || 0); let c = this.kg.get(k);
    if (c && c.v === ver && g.t - c.t < 30 && g.t >= c.t) return c;
    if (!c) { if (this.kg.size > 24000) this.kg.clear(); c = { segs: [], circ: [], cars: [], soft: [], v: 0, t: 0 }; this.kg.set(k, c); }
    c.v = ver; c.t = g.t; c.segs.length = 0; c.circ.length = 0; c.cars.length = 0; c.soft.length = 0;
    const x0 = i * 4 - 1.3, x1 = i * 4 + 5.3, y0 = j * 4 - 1.3, y1 = j * 4 + 5.3, C = st.cell;
    for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++) for (let b = Math.floor(y0 / C); b <= Math.floor(y1 / C); b++) { const kk = st.key(a, b), S = st.segs.get(kk), Q = st.circ.get(kk);
      if (S) for (const s of S) { if (Math.max(s[0], s[2]) < x0 || Math.min(s[0], s[2]) > x1 || Math.max(s[1], s[3]) < y0 || Math.min(s[1], s[3]) > y1) continue; if (!c.segs.includes(s)) c.segs.push(s); }
      if (Q) for (const o of Q) { const tg = o.tag, car = tg && typeof tg === 'object' && tg.def && typeof tg.h === 'number', r = car ? tg.def.len / 2 + 0.4 : o.r; if (o.x + r < x0 || o.x - r > x1 || o.y + r < y0 || o.y - r > y1) continue; if (car) { if (!c.cars.includes(tg)) c.cars.push(tg); } else if (!o.parkSolid || !c.circ.includes(o)) c.circ.push(o); }
      const edges = st.parkEdges?.get(kk);
      if (edges) for (const o of edges) {
        if (o.x + o.r >= x0 && o.x - o.r <= x1 && o.y + o.r >= y0 && o.y - o.r <= y1 && !c.circ.includes(o)) c.circ.push(o);
      }
    }
    if (this.nav.soft) this.nav.soft(x0, y0, x1, y1, c.soft); return c;
  }
  // does the move a -> b cross one of the lines S? (this._ks: the line)
  crosses(S, ax, ay, bx, by, floor, nearest = false, skip) {
    const rx = bx - ax, ry = by - ay;
    let first = Infinity, shared = false;
    // Each candidate is compared with the same blocked slide direction.
    const px = skip ? skip[2]-skip[0] : 0, py = skip ? skip[3]-skip[1] : 0;
    const skippedSpan = Math.abs(px)+Math.abs(py);
    const tolerance = skip ? 8*Number.EPSILON*Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by)) : 0;
    for (const edge of S) {
      if (edge === skip || aboveMeasuredEdge(edge, floor)) continue;
      const sx = edge[2]-edge[0], sy = edge[3]-edge[1], den = rx*sy - ry*sx;
      if (Math.abs(den) < 1e-12) continue;
      if (skip) {
        const error = tolerance*(Math.abs(sx)+Math.abs(sy)+skippedSpan);
        if (Math.abs(sx*py-sy*px) <= error) continue;
      }
      const ex = edge[0]-ax, ey = edge[1]-ay;
      const t = (ex*sy - ey*sx)/den;
      if (t < 0 || t > 1 || t > first + 1e-12) continue;
      const u = (ex*ry - ey*rx)/den;
      if (u < -1e-6 || u > 1+1e-6) continue;
      if (Math.abs(t-first) <= 1e-12) {
        shared = true;
        // At a shared corner prefer the wall that preserves more of this stride.
        const previous = this._ks;
        const px = previous[2]-previous[0], py = previous[3]-previous[1];
        const projection = (rx*sx + ry*sy)**2 / (sx*sx + sy*sy);
        const prior = (rx*px + ry*py)**2 / (px*px + py*py);
        if (projection < prior) continue;
        if (projection === prior) {
          // Canonical directions make equal slides independent of endpoint order.
          const angle = Math.atan2(sy, sx) % Math.PI;
          const priorAngle = Math.atan2(py, px) % Math.PI;
          if ((angle + Math.PI) % Math.PI >= (priorAngle + Math.PI) % Math.PI) continue;
        }
      }
      else shared = false;
      this._ks = edge;
      if (!nearest) return true;
      first = t;
    }
    if (nearest) { this._wallT = first; this._sharedCorner = shared; }
    return first < Infinity;
  }
  // (x, y) out of car e's box grown by m: _o.x, _o.y; false when it is not inside. A car that moves puts people off to its side.
  outBox(e, x, y, m, sp, ox = x, oy = y) {
    const dx = x - e.x, dy = y - e.y, c = Math.cos(e.h), s = Math.sin(e.h), f = dx * c + dy * s, g = -dx * s + dy * c, pf = e.def.len / 2 + m - Math.abs(f), ps = e.def.wid / 2 + m - Math.abs(g); if (pf <= 0 || ps <= 0) return false;
    if (sp > 0.6) {
      const prior = -(ox - e.x) * s + (oy - e.y) * c;
      const sign = Math.sign(prior) || -Math.sign(g) || 1;
      const k = sign * Math.min(0.075, e.def.wid / 2 + m - sign * g);
      const fw = f > 0 ? Math.min(pf, sp * 0.02) : 0;
      _o.x = x - s * k + c * fw; _o.y = y + c * k + s * fw;
    }
    else {
      // A parked car can load around a stride. Choose the exit face from the approach side.
      const side = ps <= pf;
      const axisX = side ? -s : c, axisY = side ? c : s;
      const prior = (ox - e.x) * axisX + (oy - e.y) * axisY;
      const current = side ? g : f;
      const sign = Math.sign(prior) || -Math.sign(current) || 1;
      const shift = sign * ((side ? e.def.wid : e.def.len) / 2 + m) - current;
      _o.x = x + axisX * shift; _o.y = y + axisY * shift;
    }
    return true;
  }
  // THE BODY RULE: a was at (ox, oy), which was a good place, and is now at (a.x, a.y)
  keep(a, ox, oy) {
    const R = 0.25, N = this.kn; let x = a.x, y = a.y, hit = false; const mx = x - ox, my = y - oy, m2 = mx * mx + my * my, far = m2 >= 2.25;
    if (far) { ox = x; oy = y; a.kc = 0; }      /* put somewhere else (a place at a kerb, a seat left): that place is the start */
    // nothing that stands still was within reach a moment ago and the body has not gone that far since: only what moves is looked at
    // Streaming can put a solid into the space this walker last measured as clear.
    const staticVersion = this.g.statics.__crowdV;
    if (a.clearanceVersion !== staticVersion || a.furnitureVersion !== this.nav.ver) {
      a.kc = 0; a.clearanceVersion = staticVersion; a.furnitureVersion = this.nav.ver;
    }
    let still = true; if (a.kc > 0) { a.kc -= Math.sqrt(m2); if (a.kc > 0) still = false; }
    const floor = this.fbWalls ? a.z : undefined;
    let S = null, c = null, originCell = null, near = 9;
    if (still) {
      c = this.cellAt(x, y); S = c.segs;
      // A stride shorter than the relocation threshold can still exceed the cell padding.
      if (this.fbWalls && !far && (Math.abs(mx) > 1.3 || Math.abs(my) > 1.3)) {
        const origin = this.cellAt(ox, oy);
        if (origin !== c) originCell = origin;
        if (origin !== c && origin.segs.length) S = [...new Set([...origin.segs, ...S])];
      }
      if (S.length) {
        if (!far && m2 > 1e-12 && this.crosses(S, ox, oy, x, y, floor, this.fbWalls)) {      // not through a line: along it, or not at all
          const s = this._ks, sx = s[2] - s[0], sy = s[3] - s[1], L2 = sx * sx + sy * sy || 1e-9, al = (mx * sx + my * sy) / L2, L = Math.sqrt(L2); let nx = -sy / L, ny = sx / L; if ((ox - s[0]) * nx + (oy - s[1]) * ny < 0) { nx = -nx; ny = -ny; }
          // A streamed fence may pass exactly through the old center. Recover on the approach side.
          if (Math.abs((ox - s[0]) * nx + (oy - s[1]) * ny) < 1e-9) {
            if (mx * nx + my * ny > 0) { nx = -nx; ny = -ny; }
            ox += nx * 1e-4; oy += ny * 1e-4;
          }
          const firstT = this._wallT;
          x = ox + sx * al; y = oy + sy * al;
          const height = 1.78 * (a.tall ?? 1);
          const obstacleBlocksSlide = (tx, ty, sharedCorner) => {
            if (this.fallenBodyBlocks(a, ox, oy, tx, ty)) return true;
            if (!sharedCorner) return false;
            const dx = tx - ox, dy = ty - oy, length2 = dx*dx + dy*dy;
            return clipsWallEnd(S, floor, tx, ty, dx, dy, length2, R) ||
              strideObstacle(c, a, tx, ty, dx, dy, length2) ||
              (originCell && strideObstacle(originCell, a, tx, ty, dx, dy, length2)) ||
              buildingOnWalk(this.nav, a, tx, ty, ox, oy) ||
              this.crossesFurniture(ox, oy, tx, ty, undefined, a.z ?? 0, height) ||
              this.vehicleAt(tx, ty, ox, oy, undefined, true, undefined, a, height, undefined, true);
          };
          if (this.crosses(S, ox, oy, x, y, floor) ||
              (this.fbWalls && obstacleBlocksSlide(x, y, this._sharedCorner))) {
            x = ox; y = oy;
            // Try remaining walls at this intersection in projected-stride order.
            let candidates = S;
            while (this.fbWalls && this.crosses(candidates, ox, oy, a.x, a.y, floor, true, s) &&
                Math.abs(this._wallT - firstT) <= 1e-12) {
              const hasAnother = this._sharedCorner;
              const other = this._ks, ex = other[2]-other[0], ey = other[3]-other[1];
              const along = (mx*ex + my*ey)/(ex*ex + ey*ey);
              const tx = ox + along*ex, ty = oy + along*ey;
              if ((tx !== ox || ty !== oy) && !this.crosses(S, ox, oy, tx, ty, floor) && !obstacleBlocksSlide(tx, ty, true)) {
                x = tx; y = ty; N.slide++;
                const length = Math.hypot(ex,ey);
                nx = -ey/length; ny = ex/length;
                if ((ox-other[0])*nx + (oy-other[1])*ny < 0) { nx = -nx; ny = -ny; }
                break;
              }
              if (!hasAnother) break;
              // Preserve tie order and keep the shared geometry list intact.
              const remaining = this._retryEdges ||= [];
              let count = 0;
              for (const edge of candidates) if (edge !== other) remaining[count++] = edge;
              remaining.length = count;
              candidates = remaining;
            }
            if (candidates !== S) candidates.length = 0;
          } else if (x !== ox || y !== oy) N.slide++;
          a.wnx = nx; a.wny = ny; hit = true; N.wall++; }
        // The centerline can miss a wall end while the walker's shoulder clips it.
        if (this.fbWalls && !far && (x !== ox || y !== oy)) {
          const dx = x-ox, dy = y-oy, length2 = dx*dx + dy*dy;
          if (clipsWallEnd(S, floor, x, y, dx, dy, length2, R)) {
            x = ox; y = oy; hit = true; near = 0; N.wall++;
          }
        }
        const px = x, py = y; let n = 0;
        for (let it = 0; it < 2; it++) for (const s of S) { const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1e-9, t = clamp(((x - s[0]) * dx + (y - s[1]) * dy) / L2, 0, 1); let ex = x - (s[0] + dx * t), ey = y - (s[1] + dy * t); const d = Math.hypot(ex, ey); if (d < near) near = d; if (aboveMeasuredEdge(s, floor)) continue; if (d < R && d > 1e-6) { ex /= d; ey /= d; x += ex * (R - d); y += ey * (R - d); a.wnx = ex; a.wny = ey; n++; } }
        if (n) { hit = true; if (this.crosses(S, ox, oy, x, y, floor)) { x = px; y = py; if (this.crosses(S, ox, oy, x, y, floor)) { x = ox; y = oy; } } }
      }
    }
    // round things, people on the ground and cars: out of them, no faster than a body can be moved (so nobody jumps), never over a line
    // Check where the fence pushes the walker before resolving nearby objects.
    if (hit && this.fbWalls && (x !== a.x || y !== a.y) &&
        (buildingOnWalk(this.nav, a, x, y, ox, oy) ||
         this.crossesFurniture(ox, oy, x, y, undefined, a.z ?? 0, 1.78 * (a.tall ?? 1)) ||
         this.vehicleAt(x, y, ox, oy, undefined, true, undefined, a, 1.78 * (a.tall ?? 1), undefined, true))) {
      x = ox; y = oy;
    }
    if (still && this.fbWalls && !far && m2 > 0) {
      const dx = x - ox, dy = y - oy, length2 = dx*dx + dy*dy;
      const obstacle = strideObstacle(c, a, x, y, dx, dy, length2) ||
        (originCell && strideObstacle(originCell, a, x, y, dx, dy, length2));
      if (obstacle) {
        x = ox; y = oy; hit = true; near = 0; N[obstacle]++;
      }
    }
    if (this.fbWalls && !far && this.lying.length && (x !== ox || y !== oy)) {
      const dx = x-ox, dy = y-oy, length2 = dx*dx + dy*dy;
      for (const body of this.lying) {
        if (body.p === a || body.p?.gone || onSeparateLevels(a, body)) continue;
        const ex = x-body.x, ey = y-body.y;
        // Resolving an inside landing radially would push across the body if
        // the stride reached its center or landed on the opposite side.
        const crossedCenter = (ox !== body.x || oy !== body.y) && ex*ex + ey*ey < 0.55**2 &&
          (ox-body.x)*ex + (oy-body.y)*ey <= 0;
        if (crossedCenter || strideCrosses(x, y, dx, dy, length2, body.x, body.y, 0.55)) {
          x = ox; y = oy; hit = true; near = 0; N.body++; break;
        }
      }
    }
    if (this.fbWalls && !far && (x !== ox || y !== oy)) {
      if (this.trafficStrideBlocked(a, ox, oy, x, y)) {
        x = ox; y = oy; hit = true; near = 0; N.car++;
      }
    }
    const qx = x, qy = y; let cars = false;
    if (still) {
      for (const o of c.circ) { if (!o.on) continue; const ex = x - o.x, ey = y - o.y, RR = o.r + 0.2, d2 = ex * ex + ey * ey; if (d2 < RR * RR) { const d = Math.sqrt(d2);
          let nx = d ? ex/d : 1, ny = d ? ey/d : 0;
          const oldX = ox-o.x, oldY = oy-o.y;
          if (!far && m2 > 0 && oldX*ex + oldY*ey <= 0) {
            const prior = Math.hypot(oldX,oldY);
            nx = prior ? oldX/prior : -mx/Math.sqrt(m2);
            ny = prior ? oldY/prior : -my/Math.sqrt(m2);
          }
          // The scallops between bench circles trap broad-side approaches. Slide along
          // their common outer tangent until the normal round-end response takes over.
          if (o.benchDX !== undefined && a.state === 'walk' && !far && m2 > 0) {
            const ux = o.benchDX, uy = o.benchDY;
            const across = -mx * uy + my * ux, normal = -ex * uy + ey * ux;
            if (normal * across < 0 && Math.abs(across) > 0.8 * Math.sqrt(m2) &&
                Math.abs(ex * ux + ey * uy) < RR * 0.6 && Math.abs(normal - across) >= RR - 2 * Math.sqrt(m2)) {
              // Prefer the nearer end. Break a centered approach by walker ID.
              const offset = o.benchAlong + ex * ux + ey * uy;
              const direction = Math.abs(offset) > 0.05 ? Math.sign(offset) : Math.sign(across) * (a.id & 1 ? 1 : -1);
              // Count attempted travel while contact stays in a small neighborhood.
              // Keep the retry direction across the four circles of this bench.
              let slide = a.benchSlide;
              if (!slide || slide.owner !== o.benchOwner || this.g.t - slide.last > 1) {
                slide = a.benchSlide = { owner:o.benchOwner, x:ox, y:oy, effort:0, retry:0 };
              }
              slide.last = this.g.t;
              if (Math.hypot(ox - slide.x, oy - slide.y) > 0.25) {
                slide.x = ox; slide.y = oy; slide.effort = 0;
              }
              slide.effort += Math.sqrt(m2);
              if (slide.effort > 0.8) {
                slide.retry = -(slide.retry || direction);
                slide.effort = 0;
              }
              const stride = Math.sqrt(m2) * (slide.retry || direction);
              const along = (ox - o.x) * ux + (oy - o.y) * uy + stride;
              const out = Math.sign(normal) * RR;
              x = o.x + ux * along - uy * out;
              y = o.y + uy * along + ux * out;
              N.round++; near = 0; continue;
            }
          }
          // A centered stride into a round obstacle has no tangent, so repeated pushes pin the walker.
          if (a.state === 'walk' && !far && m2 > 0 &&
              mx * nx + my * ny < 0 && Math.abs(mx * ny - my * nx) < 0.02 * Math.sqrt(m2)) {
            const turn = (a.id & 1 ? 1 : -1) * Math.min(0.04, Math.sqrt(m2) / RR);
            const scale = 1 / Math.hypot(1, turn);
            const tx = (nx - turn * ny) * scale;
            ny = (ny + turn * nx) * scale;
            nx = tx;
          }
          x = o.x + nx * RR; y = o.y + ny * RR;
        N.round++; near = 0; } else if (d2 < 4 || (o.parkSolid && d2 < (RR + 1.3) ** 2)) near = Math.min(near, Math.sqrt(d2) - RR + 0.25); }
      for (const o of c.soft) { const ex = x - o.x, ey = y - o.y, RR = o.h + 0.12, d2 = ex * ex + ey * ey; if (d2 < RR * RR) {
          // A height change can bring this nearby display into contact on the next frame.
          if (this.fbWalls && clearsFurniture(a, o)) { near = 0; continue; }
          let dx = ex, dy = ey, distance = Math.sqrt(d2);
          const oldX = ox - o.x, oldY = oy - o.y;
          // A newly loaded table may straddle this stride. Recover on the approach side.
          if (ex * oldX + ey * oldY <= 0) {
            dx = oldX; dy = oldY; distance = Math.hypot(dx, dy);
            if (!distance && m2 > 0) { dx = -mx; dy = -my; distance = Math.sqrt(m2); }
          }
          x = o.x + (distance ? dx / distance : 1) * RR;
          y = o.y + (distance ? dy / distance : 0) * RR;
          N.soft++; near = 0; } else if (d2 < 4 || (o.parkSolid && d2 < (RR + 1.3) ** 2)) near = Math.min(near, Math.sqrt(d2) - RR + 0.25); }
    }
    for (const b of this.lying) { if (b.p === a || (this.fbWalls && b.p?.gone)) continue; const ex = x - b.x, ey = y - b.y, d2 = ex * ex + ey * ey; if (d2 < 0.3025 && !(this.fbWalls && onSeparateLevels(a, b))) { const d = Math.sqrt(d2); if (d > 1e-6) { x += (ex / d) * (0.55 - d); y += (ey / d) * (0.55 - d); N.body++; } } }
    if (x !== qx || y !== qy) { const lim = Math.max(0.05, Math.sqrt(m2) * 1.6), dl = Math.hypot(x - qx, y - qy); if (dl > lim) { x = qx + (x - qx) * lim / dl; y = qy + (y - qy) * lim / dl; } }
    const bodyHeight = 1.78 * (a.tall ?? 1);
    // A push away from a tree, furniture or a fallen body can enter a car's footprint.
    if (this.fbWalls && (x !== qx || y !== qy) &&
        this.vehicleAt(x, y, qx, qy, undefined, true, undefined, a, bodyHeight, undefined, true)) {
      x = qx; y = qy; a.kc = 0;
    }
    if (still) for (const e of c.cars) {
      if (e.gone) continue;
      if (this.outBox(e, x, y, 0.2, 0, ox, oy)) {
        near = 0;
        if (this.fbWalls && !overlapsVehicleHeight(e, a.z ?? 0, bodyHeight)) continue;
        const nextX = _o.x, nextY = _o.y;
        if (this.fbWalls && this.carPushBlocked(a, x, y, nextX, nextY, bodyHeight, e)) continue;
        x = nextX; y = nextY; cars = true;
      } else near = Math.min(near, Math.hypot(x - e.x, y - e.y) - e.def.len / 2 - 0.2);
    }
    for (const e of this.tcars) {
      const dx = x - e.x, dy = y - e.y, rr = e.def.len / 2 + 1;
      if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
      if (this.fbWalls && !overlapsVehicleHeight(e, a.z ?? 0, bodyHeight)) continue;
      if (this.outBox(e, x, y, 0.2, Math.abs(e.v || 0), ox, oy)) {
        const nextX = _o.x, nextY = _o.y;
        if (this.fbWalls && this.carPushBlocked(a, x, y, nextX, nextY, bodyHeight, e)) continue;
        x = nextX; y = nextY; cars = true;
      }
    }
    if (cars) N.car++;
    if (x !== qx || y !== qy) { hit = true; if (!S) S = this.cellAt(qx, qy).segs; if (S.length && this.crosses(S, qx, qy, x, y, floor)) { x = qx; y = qy; } a.kc = 0; }
    else if (still && near > 0.5) a.kc = Math.min(near - 0.4, 0.85);      /* (a cell reaches 1.3 m past its edge) */
    // Resolving a neighboring obstacle can push a walker back inside a park prop.
    if (hit && !far && a.state === 'walk' && c?.circ.some(o => o.on && o.parkSolid)) {
      const overlaps = (px, py) => {
        for (const o of c.circ) {
          if (o.on && Math.hypot(px - o.x, py - o.y) < o.r + 0.2 - 1e-8) return true;
        }
        for (const edge of c.segs) {
          if (aboveMeasuredEdge(edge, floor)) continue;
          const [ax, ay, bx, by] = edge;
          const dx = bx - ax, dy = by - ay;
          const u = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          if (Math.hypot(px - ax - u * dx, py - ay - u * dy) < R - 1e-8) return true;
        }
        return false;
      };
      if (overlaps(x, y) && !overlaps(ox, oy)) { x = ox; y = oy; a.kc = 0; }
    }
    if ((x !== qx || y !== qy) && this.fbWalls &&
        (buildingOnWalk(this.nav, a, x, y, qx, qy) ||
         this.crossesFurniture(qx, qy, x, y, undefined, a.z ?? 0, bodyHeight))) {
      x = qx; y = qy; a.kc = 0;
    }
    a.x = x; a.y = y; if (hit) a.kh = (a.kh || 0) + 1;
  }
  trafficStrideBlocked(a, ox, oy, x, y) {
    const cars = this.tcars, dx = x-ox, dy = y-oy;
    if (cars.length < 12) {
      for (const car of cars) if (strideCrossesCar(a, car, x, y, dx, dy)) return true;
      return false;
    }
    // The traffic list is rebuilt each crowd frame. Index vehicle bounds once
    // so walkers only test cars in the rows touched by their stride.
    const rows = this.trafficRows ??= new Map();
    if (this.trafficRowsFrame !== this.frame || !rows.size) {
      rows.clear();
      for (const car of cars) {
        const reach = (car.def.len + car.def.wid)/2 + 0.4;
        for (let row = Math.floor((car.y-reach)/8); row <= Math.floor((car.y+reach)/8); row++) {
          if (!rows.has(row)) rows.set(row, []);
          rows.get(row).push(car);
        }
      }
      this.trafficRowsFrame = this.frame;
    }
    for (let row = Math.floor(Math.min(oy,y)/8); row <= Math.floor(Math.max(oy,y)/8); row++) {
      const nearby = rows.get(row);
      if (!nearby) continue;
      for (const car of nearby) if (strideCrossesCar(a, car, x, y, dx, dy)) return true;
    }
    return false;
  }
  fallenBodyBlocks(a, x, y, nextX, nextY) {
    if (!this.lying?.length) return false;
    const dx = nextX - x, dy = nextY - y, length2 = dx*dx + dy*dy;
    for (const body of this.lying) {
      if (body.p === a || body.p?.gone || onSeparateLevels(a, body)) continue;
      const bx = body.x - x, by = body.y - y;
      const toward = bx*dx + by*dy;
      if (toward <= 0) continue; // A push out of existing contact can proceed.
      const t = Math.min(1, toward / length2);
      if ((bx - t*dx)**2 + (by - t*dy)**2 < 0.55**2 - 1e-10) return true;
    }
    return false;
  }
  carPushBlocked(a, x, y, nextX, nextY, height, car, radius = 0.2, partialRetreat = true) {
    if (this.fallenBodyBlocks(a, x, y, nextX, nextY)) return true;
    return staticPathBlocked(this.g.statics, x, y, nextX, nextY, true, undefined, undefined, radius, a.z ?? 0) ||
      this.vehicleAt(nextX, nextY, x, y, undefined, true, undefined, a, height, car, partialRetreat);
  }
  // the cars that stand or creep near the camera, each as a box in a way's own axes (s along, l across), once a frame per way that asks
  wayBoxes(w) {
    if (w.bxT === this.frame) return w.bx; w.bxT = this.frame; const L = w.bx || (w.bx = []); L.length = 0;
    for (const q of (w.kind === 'cross' ? this.slowCars : this.slowOwn)) { const dx = q.x - w.ax, dy = q.y - w.ay, s = dx * w.ux + dy * w.uy; if (s < -5 || s > w.len + 5) continue; const l = dx * w.nx + dy * w.ny; if (l < -9 || l > 17) continue;
      const cu = Math.abs(q.c * w.ux + q.s * w.uy), su = Math.abs(q.c * w.nx + q.s * w.ny), es = q.hl * cu + q.hw * su, el = q.hl * su + q.hw * cu; L.push({ vehicle: q.vehicle, s0: s - es, s1: s + es, l0: l - el, l1: l + el }); }
    return L;
  }
  // A CAR IN THE WAY: pass its nearer free end (the line is kept until past: carT, carL in walkOn); no room: wait, then turn back
  round(a, w, band, cross) {
    const L = this.wayBoxes(w); if (!L.length) { a.rbT = 0; return; } const d = a.d, lt = a.carT > 0 ? a.carL : clamp(a.lt + a.la, band.lo, Math.max(band.lo, band.hi)); let hit = null, hd = 1e9;
    const floor = a.z ?? 0, height = 1.78 * (a.tall ?? 1);
    const overlaps = b => !this.fbWalls || !b.vehicle || overlapsVehicleHeight(b.vehicle, floor, height);
    for (const b of L) { const ahead = d > 0 ? b.s0 - a.s : a.s - b.s1; if (ahead > 4.5 || (d > 0 ? a.s > b.s1 : a.s < b.s0)) continue; if ((lt < b.l0 || lt > b.l1) && (a.l < b.l0 || a.l > b.l1)) continue; if (ahead < hd && overlaps(b)) { hd = ahead; hit = b; } }
    if (!hit) { a.rbT = 0; return; }
    const st = this.g.statics, sm = (hit.s0 + hit.s1) / 2, minL = cross ? -7 : -1.6, maxL = cross ? 7 : band.hi + 0.1;
    const free = (l) => { if (l < minL || l > maxL) return false; for (const b of L) if (b !== hit && l > b.l0 && l < b.l1 && sm > b.s0 - 0.3 && sm < b.s1 + 0.3 && overlaps(b)) return false; const px = w.ax + w.ux * sm + w.nx * l, py = w.ay + w.uy * sm + w.ny * l; if (cross) return st.resolve(px, py, 0.3, _o, true) === 0; return st.resolve(px, py, 0.3, _o, false) === 0 && !this.nav.blocked(px, py, 0.3); };
    const lo = hit.l0 - 0.05, hi = hit.l1 + 0.05, okLo = free(lo), okHi = free(hi); let pick = null;
    if (okLo && okHi) pick = Math.abs(a.l - lo) < Math.abs(a.l - hi) ? lo : hi; else if (okLo) pick = lo; else if (okHi) pick = hi;
    if (pick !== null) { if (!(a.carT > 0)) this.kn.detour++; a.carT = 0.6; a.carL = pick; a.rbT = 0; if (hd < 1.2 && Math.abs(a.l - pick) > 0.5) a.vcap = Math.min(a.vcap, 0.7); return; }
    a.vcap = Math.min(a.vcap, hd < 1.3 ? 0 : 0.6); a.rbT = (a.rbT || 0) + 0.05; this.kn.held++;
    if (a.rbT > 4 + (a.id % 5) * 0.7 && !(a.fol && a.fol.length && cross)) { a.rbT = 0; this.turnBack(a, band); }
  }
  turnBack(a, band) { a.d = -a.d; a.gx = -a.gx; a.gy = -a.gy; a.path = null; a.noPlan = null; a.lt = clamp(band.lo + band.hi - a.lt, band.lo, Math.max(band.lo, band.hi)); a.la = 0; a.carT = 0; this.kn.turned++; }
  // is (x, y) a place a body can be, coming from (fx, fy)? (lines, solid circles, furniture, parked cars)
  freeAt(x, y, fx, fy, walker) {
    if (this.fbWalls && (walker ? buildingOnWalk(this.nav, walker, x, y, fx, fy) :
        this.nav.inBuilding?.(x, y, 2.5, -Infinity, fx, fy))) return false;
    const c = this.cellAt(x, y); if (c.segs.length && this.crosses(c.segs, fx, fy, x, y)) return false;
    for (const s of c.segs) { const dx = s[2] - s[0], dy = s[3] - s[1], t = clamp(((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy || 1e-9), 0, 1); if (Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) < 0.27) return false; }
    for (const o of c.circ) if (o.on && (x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + 0.24) ** 2) return false;
    for (const o of c.soft) if ((x - o.x) ** 2 + (y - o.y) ** 2 < (o.h + 0.16) ** 2 &&
        !(this.fbWalls && walker && clearsFurniture(walker, o))) return false;
    for (const e of c.cars) if (!e.gone && this.outBox(e, x, y, 0.22, 0) &&
        (!this.fbWalls || !walker || overlapsVehicleHeight(e, walker.z ?? 0, 1.78 * (walker.tall ?? 1)))) return false;
    return true;
  }
  // the freest way out of a pocket (between tables, behind a planter): of 16 headings, the one that can be walked furthest and ends
  // nearest the walk; it is walked for up to 3 s (ex, ey, escT in walkOn)
  wayOut(a) {
    const w = a.w; if (!w) return false; bandAt(w, clamp(a.s, 0, w.len), B); const s2 = clamp(a.s + a.d * 2, 0, w.len), l2 = clamp(a.lt, B.lo, Math.max(B.lo, B.hi)), tx = w.ax + w.ux * s2 + w.nx * l2, ty = w.ay + w.uy * s2 + w.ny * l2; let best = -1e9, bx = 0, by = 0;
    const walker = this.fbWalls ? a : undefined, height = 1.78 * (a.tall ?? 1);
    for (let k = 0; k < 16; k++) {
      const h = k * 0.3927 + (a.id % 7) * 0.05, dx = Math.cos(h) * 0.33, dy = Math.sin(h) * 0.33;
      let px = a.x, py = a.y, n = 0;
      for (; n < 12; n++) {
        if (!this.freeAt(px + dx, py + dy, px, py, a)) break;
        px += dx; py += dy;
      }
      if (n >= 3 && this.vehicleAt(px, py, a.x, a.y, undefined, true, undefined, walker, height)) {
        // Only a heading that meets a vehicle needs a search for the last clear step.
        const limit = n;
        px = a.x; py = a.y;
        for (n = 0; n < limit; n++) {
          if (this.vehicleAt(px + dx, py + dy, px, py, undefined, true, undefined, walker, height)) break;
          px += dx; py += dy;
        }
      }
      if (n < 3) continue; const sc = n * 0.33 - 0.8 * Math.hypot(px - tx, py - ty); if (sc > best) { best = sc; bx = px; by = py; } }
    if (best < -1e8) return false; a.ex = bx; a.ey = by; a.escT = 3; a.escapeHeld = false; return true;
  }
  // PRESSED AND GETTING NOWHERE, in turn: turn back; the freest way out; another walk that can be reached; stand until one can be
  // taken away unseen. The count starts again after 25 s without trouble.
  unstick(a) {
    const t = this.g.t; if (!(t - a.ku < 25 && t >= a.ku)) a.kun = 0; a.ku = t; a.kun++; this.kn.unstuck++;
    // Try a local detour before abandoning the route at a streamed park prop.
    let searched = false;
    if (a.kun === 1 && a.w) {
      const nearProp = this.cellAt(a.x, a.y).circ.some(o => o.on && o.parkSolid && Math.hypot(a.x - o.x, a.y - o.y) < o.r + 0.3);
      if (nearProp) {
        if (this.wayOut(a)) return;
        searched = true;
      }
      bandAt(a.w, clamp(a.s, 0, a.w.len), B);
      if (a.l > B.lo - 0.3 && a.l < B.hi + 0.3) { this.turnBack(a, B); return; }
      a.kun = 2;
    }
    if (a.kun <= 3 && !searched && this.wayOut(a)) return;
    if (a.kun <= 4) { a.kun = 4; this.rejoin(a); a.fbBack = 0; return; }
    this.leaveGroup(a); this.strand(a);
  }
  // who lies on the ground near the camera (twice a second): the crowd's own, the ragdolls of people a car struck (pedhit.js) and of
  // people who were shot (combat/people.js). Read from where those keep them; nothing of theirs is changed.
  findLying() {
    const L = this.lying, g = this.g; L.length = 0; const add = (x, y, p, bottom, top) => { if (isFinite(x) && isFinite(y) && Math.abs(x - this.cx) < 120 && Math.abs(y - this.cy) < 120 && L.length < 40) {
      if (this.fbWalls && p) {
        // The agent keeps sliding between samples. Its prone offset stays fixed.
        const dx = x - p.x, dy = y - p.y;
        L.push({ get x() { return p.x + dx; }, get y() { return p.y + dy; }, p, bottom, top });
      } else L.push({ x, y, p, bottom, top });
    } };
    for (const a of this.agents) if (a.state === 'down' && !a.gone && a.fall > 0.5) add(a.x + Math.cos(a.h) * 0.6, a.y + Math.sin(a.h) * 0.6, a);
    // (a struck person's agent leaves the crowd when pedhit.js takes the body, and combat/scare.js then forgets the place: it is told of the
    // ragdoll once it lies, through its own down(), so people stop, look and turn back there as they do at a shot body)
    try { const PH = g.__pedhit, Wd = g.__world; if (PH && PH.list) for (const r of PH.list) { const h = r.P && r.P.hips && r.P.hips.p; if (!h) continue;
      const support = this.fbWalls ? r.P.hips.supportHeight ?? 0 : 0;
      if (h.y < support + 0.9) {
        let bottom = Infinity, top = -Infinity;
        for (const joint of Object.values(r.P)) {
          bottom = Math.min(bottom, joint.p.y - joint.r);
          top = Math.max(top, joint.p.y + joint.r);
        }
        add(h.x, -h.z, null, bottom, top);
      }
      if (h.y < 0.9 && r.t > 1.2 && Wd && typeof Wd.down === 'function') { const K = this._said || (this._said = new WeakSet()); if (!K.has(r)) { K.add(r); Wd.down({ gone: false, state: 'lying', x: h.x, y: -h.z }, 'lying'); } } } } catch (e) {}
    try { const Bd = g.combat && g.combat.bodies; if (Bd && Bd.live) for (const b of Bd.live) { const dl = b.doll; if (dl && dl.p && dl.p[37] < (this.fbWalls ? dl.gc?.[12] ?? 0 : 0) + 0.9) {
      let bottom, top;
      if (this.fbWalls && dl.r?.length) {
        bottom = Infinity; top = -Infinity;
        for (let i = 0; i < dl.r.length; i++) {
          const height = dl.p[i * 3 + 1];
          bottom = Math.min(bottom, height - dl.r[i]);
          top = Math.max(top, height + dl.r[i]);
        }
      }
      add(dl.p[36], -dl.p[38], null, bottom, top);
    } } } catch (e) {}
  }

  // ------------------------------------------------------------------ animation
  setClip(a, c, snap) {
    if (a.clip === c.i) return; if (snap) { a.clip = c.i; a.blend = 0; a.ph = c.speed > 0 ? a.ph : this.rand(); return; }
    a.clipB = a.clip; a.phB = a.ph; a.rateB = a.rate; a.blend = 1; a.clip = c.i; if (!(c.speed > 0)) a.ph = this.rand(); else if (!(this.clips[a.clipB].speed > 0)) a.ph = this.rand() < 0.5 ? 0.02 : 0.52;
  }
  animate(a, dt) {
    const c = this.clips[a.clip]; a.rate = c.speed > 0 ? clamp(a.v / (c.speed * a.tall), 0, 1.6) : 1;
    a.ph += (dt * a.rate) / c.duration; if (a.ph >= 1) a.ph -= Math.floor(a.ph);
    if (a.blend > 0) { const cb = this.clips[a.clipB]; a.phB += (dt * (cb.speed > 0 ? Math.min(a.rateB, a.rate + 0.3) : 1)) / cb.duration; if (a.phB >= 1) a.phB -= Math.floor(a.phB); a.blend = Math.max(0, a.blend - dt / 0.32); }
  }
  // walking clip while moving, the standing clip once stopped for a moment
  gait(a, dt, idle) {
    if (a.v < 0.12) { a.slowT += dt; if (a.slowT > 0.3) this.setClip(a, idle || a.idle); } else { a.slowT = 0; if (a.v > 0.22) {
      if (!this.fbKeep) { this.setClip(a, a.walkClip); return; }
      // people/crowd-walls ("npcs are walking in slow motion"): someone held to another pace than their own (behind slower people, a jogger in a
      // bunch, a run that is over) kept their own clip and played it slowed down, a jog at walking speed. The clip now follows the speed:
      // their own while it fits, else the walk whose own pace is nearest (after 0.3 s, so a start or a stop changes nothing)
      const cur = this.clips[a.clip], own = a.walkClip, ro = a.v / (own.speed * a.tall);
      if (!(cur.speed > 0)) { this.setClip(a, ro > 0.55 ? own : this.fit(a)); a.gT = 0; }
      else if (cur !== own && ro > 0.8 && ro < 1.3) { this.setClip(a, own); a.gT = 0; }
      else { const r = a.v / (cur.speed * a.tall); if (r < 0.72 || r > 1.42) { if ((a.gT = (a.gT || 0) + dt) > 0.3) { this.setClip(a, this.fit(a)); a.gT = 0; } } else a.gT = 0; } } }
  }

  // the walk (or the jog) whose own pace is nearest the speed someone is moving at; among near-equals each person has their own
  fit(a) {
    const F = this._fits || (this._fits = this.walks.concat(this.jog && !this.walks.includes(this.jog) ? [this.jog] : [])); let best = a.walkClip, bd = Math.abs(Math.log(a.v / (best.speed * a.tall))) - 0.04;
    for (const c of F) { const d = Math.abs(Math.log(a.v / (c.speed * a.tall))) + ((a.id * 7 + c.i * 13) % 10) * 0.006; if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // ------------------------------------------------------------------ the neighbour grid
  grid() {
    const H = this.head; H.fill(-1); this.gx0 = this.cx - GN * CELL / 2; this.gy0 = this.cy - GN * CELL / 2; const C = this.cells; C.length = 0;
    const put = (q) => { const i = Math.floor((q.x - this.gx0) / CELL), j = Math.floor((q.y - this.gy0) / CELL); if (i < 0 || j < 0 || i >= GN || j >= GN || C.length >= 4096) return; const k = j * GN + i; this.nxt[C.length] = H[k]; H[k] = C.length; C.push(q); };
    for (const a of this.agents) put(a);
    this.gridAgentCount = C.length;
    // the game's own pedestrians and the player on foot are in the way too
    const g = this.g; if (g.peds) for (const p of g.peds.list) { if (p.state === 'down') continue; p.v = p.speed || 1.3; put(p); }
    // nobody walks through the camera either (a free or a fixed camera at eye height stands in the street like a person)
    const cam = g.world.camera; if (cam.position.y < 3) { this._cam = this._cam || { ext: true, h: 0, v: 0 }; this._cam.x = this.cx; this._cam.y = this.cy; put(this._cam); }
    const pl = g.player; if (pl && !pl.vehicle) { this._pl = this._pl || { ext: true }; Object.assign(this._pl, { x: pl.x, y: pl.y, h: pl.h, v: pl.speed || 0 }); put(this._pl); }
  }

  kerbInBounds(x0, y0, x1, y1, margin) {
    const out = this._kerbCandidates || (this._kerbCandidates = []);
    out.length = 0;
    if (!this.gridAgentCount) return out;
    const left = Math.max(0, Math.floor((x0-margin-this.gx0)/CELL));
    const right = Math.min(GN-1, Math.floor((x1+margin-this.gx0)/CELL));
    const bottom = Math.max(0, Math.floor((y0-margin-this.gy0)/CELL));
    const top = Math.min(GN-1, Math.floor((y1+margin-this.gy0)/CELL));
    for (let j=bottom; j<=top; j++) for (let i=left; i<=right; i++) {
      for (let k=this.head[j*GN+i]; k>=0; k=this.nxt[k]) {
        const a=this.cells[k];
        if (k<this.gridAgentCount && !a.onRoad && !a.gone && a.state!=='sit' && a.state!=='down') out.push(a);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ steering round people and things
  avoid(a, w, band, formationSlot) {
    const hx = Math.cos(a.h), hy = Math.sin(a.h), C = this.cells, H = this.head; let sR = 0, sL = 0, cap = 9;
    const see = (qx, qy, qf, need, soft) => {
      const dx = qx - a.x, dy = qy - a.y, f = dx * hx + dy * hy; if (f < -0.35 || f > 3.6) return; const gg = -dx * hy + dy * hx, ag = Math.abs(gg); if (ag > need + 0.25) return;
      const closing = a.v0 - qf; if (closing < 0.12 && f > 0.75) return;
      // right behind someone going the same way: their pace. Someone standing there: slow, and weave past
      if (f < 0.8 && ag < 0.42 && f > 0.05 && qf > -0.1) cap = Math.min(cap, qf > 0.15 ? qf : 0.5);
      const over = need - ag; if (over <= 0) return; const urg = clamp(1.5 - f / 2.4, 0.25, 1.2) * over;
      let right = gg >= 0; if (ag < 0.12) right = qf < -0.2 ? true : (a.id & 1) === 0;
      if (right) sR = Math.max(sR, urg); else sL = Math.max(sL, urg);
      if (f < 2.2 && closing > 0.1 && qf > -0.1) a._blk = Math.min(a._blk, qf > 0.15 ? qf : 0.5);
    };
    a._blk = 9;
    const ci = Math.floor((a.x + hx * 1.2 - this.gx0) / CELL), cj = Math.floor((a.y + hy * 1.2 - this.gy0) / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
      for (let k = H[j * GN + i]; k >= 0; k = this.nxt[k]) { const q = C[k]; if (q === a || q.lead === a || (a.lead && (q === a.lead || q.lead === a.lead))) continue; if (q.state === 'down') continue;
        if (this.fbWalls) {
          const floor = a.z ?? 0, otherFloor = q.seatOf?.z ?? q.z ?? 0;
          if (otherFloor > floor && otherFloor >= floor + 1.78 * (a.tall ?? 1)) continue;
          if (floor > otherFloor) {
            const height = q.seatOf ? (q.seatOf.seat ?? 0.46) + 1 : 1.78 * (q.tall ?? 1);
            if (floor >= otherFloor + height) continue;
          }
        }
        see(q.x, q.y, (q.v || 0) * (Math.cos(q.h) * hx + Math.sin(q.h) * hy), 0.74, false); }
    }
    if (this.slow && w) {       // round the space in front of the camera: a big thing to pass on the side one is already on
      const dx = this.zx - a.x, dy = this.zy - a.y, f = dx * hx + dy * hy, gg = -dx * hy + dy * hx, R = 3.6;
      if (f > -R && f < R + 7 && Math.abs(gg) < R) { const urg = (1 - Math.abs(gg) / R) * 1.6 + 0.3; if (gg >= 0) sR = Math.max(sR, urg); else sL = Math.max(sL, urg); }
    }
    let obstacles = w?.obs;
    // Crossings have no carved obstacle list.
    if (w?.kind === 'cross' || w?.refreshingObstacles) {
      obstacles = this._refreshObstacles || (this._refreshObstacles = []);
      obstacles.length = 0;
      this.nav.obstaclesNear(a.x, a.y, 4, obstacles);
    }
    if (obstacles?.length) {
      const st = this.g.statics;
      const cell = st.cell;
      const wallI = Math.floor(a.x/cell), wallJ = Math.floor(a.y/cell);
      let clearCell;
      for (const o of obstacles) {
        if (Math.abs(o.x - a.x) > 4 || Math.abs(o.y - a.y) > 4) continue;
        if (this.fbWalls && clearsFurniture(a, o)) continue;
        const dx = o.x-a.x, dy = o.y-a.y;
        const forward = dx*hx + dy*hy, lateral = -dx*hy + dy*hx;
        if (forward < -0.35 || forward > 3.6 || Math.abs(lateral) > o.r+0.70) continue;
        // The segment stays in its starting cell when both endpoints lie in it.
        const sameCell = Math.floor(o.x/cell) === wallI && Math.floor(o.y/cell) === wallJ;
        if (sameCell && clearCell === undefined) {
          const walls = st.segs.get(st.key(wallI,wallJ));
          // Every center ray below lies inside the walker's four-metre search box.
          clearCell = !walls?.some(([ax,ay,bx,by]) =>
            Math.max(ax,bx) >= a.x-4 && Math.min(ax,bx) <= a.x+4 &&
            Math.max(ay,by) >= a.y-4 && Math.min(ay,by) <= a.y+4);
        }
        const centerHit = sameCell && clearCell ? 1 : st.raycast(a.x, a.y, o.x, o.y);
        if (centerHit < 1) {
          // A wall can hide the center while the rim still reaches the walking line.
          const towardPath = clamp(lateral, -o.h, o.h);
          const rimX = o.x + hy*towardPath, rimY = o.y - hx*towardPath;
          if ((rimX === o.x && rimY === o.y) || st.raycast(a.x, a.y, rimX, rimY) < 1) {
            // A transverse fence can leave the face nearest the walker exposed.
            const distance = Math.hypot(dx, dy);
            // The near face lies on the center ray, one radius before its end.
            if ((1 - centerHit) * distance > o.h) continue;
          }
        }
        see(o.x, o.y, 0, o.r + 0.45, false);
      }
    }
    for (const b of this.lying) { const dx = b.x - a.x, dy = b.y - a.y; if (dx > 5 || dx < -5 || dy > 5 || dy < -5 || b.p === a || (this.fbWalls && (b.p?.gone || onSeparateLevels(a, b)))) continue; see(b.x, b.y, 0, 1.0, false); }      /* people/crowd-walls: nobody walks over someone on the ground */
    // the player's standing cars: three circles along the body, passed like street furniture
    for (const q of this.still) { const dx = q.x - a.x, dy = q.y - a.y; if (dx > 8 || dx < -8 || dy > 8 || dy < -8) continue;
      if (this.fbWalls && q.v && !overlapsVehicleHeight(q.v, a.z ?? 0, 1.78 * (a.tall ?? 1))) continue;
      const e = q.hl - q.hw, n = q.hw + 0.3; see(q.x, q.y, 0, n, false); if (e > 0.3) { see(q.x + q.c * e, q.y + q.s * e, 0, n, false); see(q.x - q.c * e, q.y - q.s * e, 0, n, false); } }
    if (w && band) {
      const rn = hy * w.nx - hx * w.ny, room = band.hi - band.lo; let sh = (sR - sL) * 0.55;
      if (sR > 0 && sL > 0) cap = Math.min(cap, a._blk);     // someone on either side: fall in behind
      const inFormation = formationSlot !== undefined;
      const laneTarget = inFormation ? formationSlot : a.lt;
      let la = (inFormation ? (a.formationOffset || 0) : a.la) + sh * rn; const tgt = laneTarget + la, cl = clamp(tgt, band.lo, band.hi);
      if (cl !== tgt) { la = cl - laneTarget; if (sh !== 0 && room < 1.6) cap = Math.min(cap, a._blk); }
      if (sh === 0) la *= 0.93;
      if (inFormation) a.formationOffset = clamp(la, -3, 3);
      else a.la = clamp(la, -3, 3);
    }
    // held up for a while (a narrow walk, someone standing in it): shuffle past rather than queue for ever
    if (cap < 0.3 && a.state === 'walk') { a.stuck = (a.stuck || 0) + 0.05; if (a.stuck > 2.2) cap = 0.7; if (a.stuck > 4.5) a.stuck = 0; } else if (a.stuck > 0) a.stuck = Math.max(0, a.stuck - 0.02);
    a.vcap = cap;
  }

  // ------------------------------------------------------------------ the way ahead at a junction
  plan(a) {
    const w = a.w, v = a.d > 0 ? w.b : w.a, r = this.rand; let best = null; const opts = [];
    const walk = (vert, from, depth, len, first, path) => {
      for (const inc of vert.inc) {
        const w2 = inc.w; if (w2 === from || path.some((p) => p.w === w2)) continue; const d2 = inc.end === 0 ? 1 : -1, far = d2 > 0 ? w2.b : w2.a;
        bandAt(w2, d2 > 0 ? 0 : w2.len, B2); if (w2.kind !== 'cross' && B2.hi <= 0) continue;
        const p2 = path.concat([{ w: w2, d: d2 }]), L = len + w2.len;
        if (depth >= 4 || (w2.kind === 'strip' && w2.len > 9) || L > 45 || far.inc.length < 2) {
          const ex = far.x - v.x, ey = far.y - v.y, el = Math.hypot(ex, ey) || 1; let sc = (ex * a.gx + ey * a.gy) / Math.max(el, L * 0.8) ;
          for (const p of p2) if (p.w.kind === 'cross') sc -= 0.12 + (this.canWalk(p.w, a, 0) ? 0 : 0.22);
          if (this.fbTwins) { const c0 = p2.find((p) => p.w.kind === 'cross'); if (c0) for (const q of c0.w.agents) if (q.char === a.char && q !== a && q.lead !== a) { sc -= 0.45; break; } }      /* people/crowd-fb: their double is already at that crossing (waiting or on it): rather another way */
          if (far.inc.length < 2) sc -= 0.8;
          if (w2.kind !== 'cross') { sc += 0.22 * clamp(Math.log((w2.rho + 0.05) / (w.rho + 0.05)), -1.5, 1.5); if (w2.pop > w2.want * 1.5 + 4) sc -= 0.3; }
          opts.push({ path: p2, sc });
        } else walk(far, w2, depth + 1, L, first, p2);
      }
    };
    walk(v, w, 0, 0, null, []);
    if (!opts.length) { a.path = null; return; }
    let tot = 0; for (const o of opts) { o.wt = Math.exp(3.2 * o.sc); tot += o.wt; }
    let x = r() * tot; for (const o of opts) { x -= o.wt; if (x <= 0) { best = o; break; } } best = best || opts[0];
    a.path = best.path;
    // a turn taken is the new way to go
    const last = best.path[best.path.length - 1], lx = last.w.ux * last.d, ly = last.w.uy * last.d; if (lx * a.gx + ly * a.gy < 0.5 && last.w.kind === 'strip') { a.gx = lx; a.gy = ly; }
    this.laneFor(a, a.path[0]);
  }
  // where across the next way this walker will go: the right-hand side of its band, as far over as is their habit
  laneFor(a, p) {
    const w = p.w; bandAt(w, p.d > 0 ? Math.min(2, w.len) : Math.max(0, w.len - 2), B2); const rightIsHi = (w.uy * p.d) * w.nx + (-w.ux * p.d) * w.ny > 0, half = (B2.lo + B2.hi) / 2;
    let lane = a.lane; if (a.fol && a.fol.length) lane *= 0.55;
    p.lt = rightIsHi ? half + (B2.hi - half) * lane : half - (half - B2.lo) * lane; if (a.fol && a.fol.length) p.lt = clamp(p.lt, B2.lo + 0.45, Math.max(B2.lo + 0.45, B2.hi - 0.45));
  }
  enter(a, p) {
    const w0 = a.w, j = w0.agents.indexOf(a); if (j >= 0) w0.agents.splice(j, 1); p.w.agents.push(a);
    a.w = p.w; a.d = p.d; a.lt = p.lt; a.la = 0; a.path.shift(); if (p.w.kind !== 'cross') for (const q of a.fol ? [a, ...a.fol] : [a]) { if (q.home) q.home.pop--; q.home = p.w; p.w.pop++; } if (a.path.length) this.laneFor(a, a.path[0]); else a.path = null;
    if (a.fol) for (const f of a.fol) { const k = w0.agents.indexOf(f); if (k >= 0) w0.agents.splice(k, 1); p.w.agents.push(f); f.w = p.w; f.d = p.d; }
    if (p.w.kind === 'cross') {
      const end = p.d > 0 ? 0 : 1; a.state = 'wait'; a.t = 0; { const S = p.w.wait[end]; let k = 0; while (k < S.length && S[k]) k++; S[k] = 1; a.wq = { w: p.w, end, n: k, go: -1 }; }
      this.kerbPlace(a, p.w, p.d);
    }
  }
  // A place in the bunch at the kerb (people/crowd-kerb, Nov 13; public report 20261113170558-cd8f8f "npc that stand around ammased", and
  // the critics' "about eight people are squeezed into a block"). It was a grid of places 0.86 m apart filled in order; a place of the grid
  // that fell off the walk (at most corners one side of the crossing's mouth is the other roadway) went to ONE point 0.7 m back, so people
  // stood inside each other there, and the company of a pair or three stood beside its leader on the next places of the grid. Now each
  // arrival looks at who already has a place within reach (waiting for this crossing or the one round the corner, their company, people
  // standing about, sitters) and takes, of a handful of places tried on the walk behind the kerb, the one with room: a body's width and
  // shoulder room from everyone (0.75 m centre to centre at the least, about 1.1 m when there is space), near the kerb and the crossing's
  // mouth before further back or to the side. The company's places beside the leader are kept free too. Most look across the road, some
  // up the street, a few take their phone out.
  kerbPlace(a, w, d) {
    const r = this.rand, st = this.g.statics, base = Math.atan2(w.uy * d, w.ux * d), bx = Math.cos(base), by = Math.sin(base), kx = d > 0 ? w.ax : w.ax + w.ux * w.len, ky = d > 0 ? w.ay : w.ay + w.uy * w.len;
    const N = this._kp || (this._kp = []); N.length = 0; let near = 0;
    for (const o of this.agents) { if (o === a || o.lead === a) continue; let x, y; const L = o.lead;
      if (L && L.state === 'wait' && L.wq) { const c = Math.cos(L.th), sn = Math.sin(L.th); x = L.tx + sn * o.off - c * o.back; y = L.ty - c * o.off - sn * o.back; }
      else if (o.state === 'stand' || (o.state === 'wait' && o.wq)) { x = o.tx; y = o.ty; } else if (o.state === 'sit') { x = o.x; y = o.y; } else continue;
      const dx = x - kx, dy = y - ky; if (dx > 9 || dx < -9 || dy > 9 || dy < -9) continue; N.push(x, y); if (dx * dx + dy * dy < 20) near++; }
    const F = a.fol && a.fol.length ? a.fol : null, R = 2.1 + Math.min(1.1, near * 0.09), D = 1.3 + Math.min(4.2, near * 0.3), th = base + (r() - 0.5) * (F ? 0.16 : 0.36);
    const hx = Math.cos(th), hy = Math.sin(th); let best = -1e9, bX = 0, bY = 0, bB = 0.7, bD = 0, any = false;
    for (let k = 0; k < 40; k++) {      /* 18 places tried; when none of them has room (a narrow walk, a full kerb), 22 more over a wider and deeper stretch */
      if (k === 18 && bD >= 0.75) break; const wide = k >= 18;
      const back = 0.62 + (wide ? r() * (D + 2.5) : r() * r() * D), lat = (r() * 2 - 1) * (wide ? R + 1.3 : R), x0 = kx - bx * back + w.nx * lat, y0 = ky - by * back + w.ny * lat; st.resolve(x0, y0, 0.38, _o); const x = _o.x, y = _o.y;
      if (Math.hypot(x - x0, y - y0) > 0.8 || !st.onSidewalk(x, y) || this.nav.blocked(x, y, 0.3)) continue;
      let dm = 9, ok = true;
      for (let m = F ? F.length : 0; m >= 0 && ok; m--) { let mx = x, my = y; if (m > 0) { const f = F[m - 1]; mx = x + hy * f.off - hx * f.back; my = y - hx * f.off - hy * f.back; if (!st.onSidewalk(mx, my) || this.nav.blocked(mx, my, 0.25)) ok = false; }
        const person = m ? F[m - 1] : a;
        if (this.approachBlocked(person, mx, my) || st.resolvePedestrian(mx, my, 0.25, _o)) { ok = false; break; }
        for (let i = 0; i < N.length; i += 2) { const ex = N[i] - mx, ey = N[i + 1] - my; if (ex > 1.3 || ex < -1.3 || ey > 1.3 || ey < -1.3) continue; const e = Math.hypot(ex, ey); if (e < dm) dm = e; } }
      if (!ok) continue;
      const sc = (dm < 0.75 ? dm * 4 - 6 : Math.min(dm, 1.15)) - 0.16 * back - 0.05 * Math.abs(lat) + r() * 0.06;
      if (sc > best) { best = sc; bX = x; bY = y; bB = back; bD = dm; any = true; }
    }
    if (!any) { bX = a.x; bY = a.y; }
    a.wq.holdPosition = !any;
    a.tx = bX; a.ty = bY; a.th = th; a.wq.bk = bB; a.wq.clip = null;
    if (!F && !a.lead) { const u = r();
      if (u < 0.24) a.th = base + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.8);      /* looking up the street, at the traffic, at who is beside them */
      if (!a.hand && u > 0.86) { this.hold(a, 'phone'); a.th = base + (r() - 0.5) * 0.9; }
      if (!(a.hand && a.hand.stand) && this.waitClip && r() < 0.38) a.wq.clip = a.idle; }
  }
  // may one start over this crossing now? The walk phase is the red of the road being crossed, with time left to get over, and no car coming.
  canWalk(w, a, margin = 1) {
    const g = this.g, R = g.roads, nd = R.nodes[w.node];
    if (nd.sig) { if (R.signal(w.node, w.e, g.t) !== 'r') return false; const left = R.toGreen(w.node, w.e, g.t); if (left < w.len / ((a ? a.v0 : 1.3) * (a && a.fol ? 0.95 : 1.1)) + margin + 1.5) return false; }
    const checkHeight = this.fbWalls && a;
    const floor = checkHeight ? a.z ?? 0 : -Infinity;
    const ceiling = checkHeight ? floor + 1.78 * (a.tall ?? 1) : Infinity;
    const mixedLevels = checkHeight && a.fol?.some(f =>
      (f.z ?? 0) !== floor || (f.tall ?? 1) !== (a.tall ?? 1));
    if (mixedLevels || w.clearT !== this.frame || w.clearFloor !== floor || w.clearCeiling !== ceiling) {
      w.clearFloor = floor; w.clearCeiling = ceiling;
      // A group spanning levels needs its own result even when the leader's height matches.
      w.clearT = mixedLevels ? -1 : this.frame; w.clear = true;
      const test = (x, y, vx, vy) => {
        const along = (x-w.ax)*w.ux + (y-w.ay)*w.uy;
        const across = (x-w.ax)*w.nx + (y-w.ay)*w.ny;
        const ds = vx*w.ux + vy*w.uy, dl = vx*w.nx + vy*w.ny;
        // Intersect the times spent inside each axis of the crossing.
        let enter = 0, leave = 3.6;
        if (Math.abs(ds) < 1e-9) {
          if (along <= -1 || along >= w.len+1) return;
        } else {
          const a = (-1-along)/ds, b = (w.len+1-along)/ds;
          enter = Math.max(enter, Math.min(a,b)); leave = Math.min(leave, Math.max(a,b));
        }
        if (Math.abs(dl) < 1e-9) {
          if (Math.abs(across) >= 3.4) return;
        } else {
          const a = (-3.4-across)/dl, b = (3.4-across)/dl;
          enter = Math.max(enter, Math.min(a,b)); leave = Math.min(leave, Math.max(a,b));
        }
        if (enter < leave) w.clear = false;
      };
      const testVehicle = (car, vx, vy) => {
        if (!vx && !vy) return;
        if (car.def && ((car.z ?? 0) >= ceiling || (car.z ?? 0) + (car.def.hgt || 1.45) <= floor) &&
            !(mixedLevels && a.fol.some(f => overlapsVehicleHeight(car, f.z ?? 0, 1.78 * (f.tall ?? 1))))) return;
        test(car.x, car.y, vx, vy);
        if (!w.clear || !car.def) return;
        const half = car.def.len / 2;
        const dx = Math.cos(car.h)*half, dy = Math.sin(car.h)*half;
        test(car.x + dx, car.y + dy, vx, vy);
        if (w.clear) test(car.x - dx, car.y - dy, vx, vy);
      };
      for (const c of g.traffic.cars) {
        if (!w.clear) break;
        const speed = c.rev > 0 ? -c.rev : c.v;
        testVehicle(c, Math.cos(c.h)*speed, Math.sin(c.h)*speed);
      }
      for (const c of g.vehicles) { if (!w.clear) break; testVehicle(c, c.vx, c.vy); }
    }
    // The signal and traffic gap are shared, but each waiting group has its own approach.
    if (w.clear && a?.wq?.w === w) {
      const end = a.wq.end ? w.len : 0;
      const mx = w.ax + end*w.ux, my = w.ay + end*w.uy;
      const leaderLane = clamp((a.x - mx)*w.nx + (a.y - my)*w.ny, -1.8, 1.8);
      const right = (a.wq.end ? -1 : 1) * (w.uy*w.nx - w.ux*w.ny);
      // Bound both kerbs and every approach before testing individual paths.
      const fx = w.ax + w.len*w.ux, fy = w.ay + w.len*w.uy;
      let left = Math.min(w.ax, fx, a.x), rightX = Math.max(w.ax, fx, a.x);
      let bottom = Math.min(w.ay, fy, a.y), top = Math.max(w.ay, fy, a.y);
      let spread = Math.abs(leaderLane);
      for (const f of a.fol || []) {
        left = Math.min(left, f.x); rightX = Math.max(rightX, f.x);
        bottom = Math.min(bottom, f.y); top = Math.max(top, f.y);
        spread = Math.max(spread, Math.abs(leaderLane + f.off*right));
      }
      const vehicles = this._crossVehicles || (this._crossVehicles = []);
      vehicles.length = 0;
      const collect = car => {
        if (!car.def) return;
        const pad = spread + (car.def.len + car.def.wid)/2 + 0.6;
        if (car.x >= left-pad && car.x <= rightX+pad && car.y >= bottom-pad && car.y <= top+pad) vehicles.push(car);
      };
      g.vehicles.forEach(collect);
      g.traffic.cars.forEach(collect);
      const blocked = person => {
        const lateral = leaderLane + (person === a ? 0 : person.off * right);
        const x = mx + lateral*w.nx, y = my + lateral*w.ny;
        const distance = a.wq.end ? -w.len : w.len;
        return this.approachBlocked(person, x, y, person.x, person.y, vehicles) ||
          this.approachBlocked(person, x + distance*w.ux, y + distance*w.uy, x, y, vehicles);
      };
      if (blocked(a) || a.fol?.some(blocked)) return false;
    }
    return w.clear;
  }

  // ------------------------------------------------------------------ one agent, one step
  steer(a, tx, ty, dt, want, turnInPlace = false, alignFirst = a.retreatingFromObstacle) {
    const dh = wrapPi(Math.atan2(ty - a.y, tx - a.x) - a.h), ad = Math.abs(dh); a.h += clamp(dh, -TURN * dt, TURN * dt);
    if (turnInPlace && ad > TURN * dt && (ad - TURN * dt >= Math.PI/2 || alignFirst)) {
      a.v = 0;
      return;
    }
    let tgt = Math.min(want, a.vcap) * (ad > 1.3 ? 0.45 : ad > 0.7 ? 0.75 : 1); if (this.fbKeep && tgt > 0) { if (a.fear && a.fear.run && want > 0.9) { if (tgt < 0.9) tgt = 0.9; }      /* someone getting away is not held to a shuffle behind others (combat/scare.js turns anyone round who makes under 0.3 m in half a second, again and again) */ else if (tgt < 0.54 * a.tall) tgt = tgt < 0.3 ? 0 : 0.54 * a.tall; }      /* nobody creeps: under the slowest walk's pace one waits a moment, then steps */
    a.v += clamp(tgt - a.v, -3.2 * dt, 1.6 * dt); if (a.v < 0.02 && tgt <= 0) a.v = 0;
    const x = a.x + Math.cos(a.h) * a.v * dt;
    const y = a.y + Math.sin(a.h) * a.v * dt;
    const turningApproach = turnInPlace && ad > TURN * dt;
    if (a.v && this.fbWalls && (buildingOnWalk(this.nav, a, x, y) ||
        this.crossesFurniture(a.x, a.y, x, y, undefined, a.z ?? 0, 1.78 * (a.tall ?? 1)) ||
        (turningApproach && (this.staticApproachBlocked(a.x, a.y, x, y, undefined, a) ||
          this.vehicleAt(x, y, a.x, a.y, undefined, true, undefined, a, 1.78 * (a.tall ?? 1), undefined, true))))) {
      a.v = 0;
      return;
    }
    a.x = x; a.y = y;
  }
  walkOn(a, dt, think) {
    const target = a.rejoinTarget;
    if (target) {
      const remaining = Math.hypot(target.x - a.x, target.y - a.y);
      if (remaining > 0) {
        const blocked = this.vehicleAt(target.x, target.y, a.x, a.y, undefined, true, undefined, this.fbWalls ? a : undefined, 1.78 * (a.tall ?? 1)) ||
          this.staticApproachBlocked(a.x, a.y, target.x, target.y, undefined, this.fbWalls ? a : undefined) ||
          (this.fbWalls && buildingOnWalk(this.nav, a, target.x, target.y));
        if (blocked) {
          a.v = 0;
          if (think) this.rejoin(a);
        } else {
          this.steer(a, target.x, target.y, dt, a.v0, true, true);
          if (a.v * dt >= remaining) { a.x = target.x; a.y = target.y; }
          this.gait(a, dt);
        }
        return;
      }
      a.rejoinTarget = null;
    }
    const w = a.w, dx = a.x - w.ax, dy = a.y - w.ay; a.s = dx * w.ux + dy * w.uy; a.l = dx * w.nx + dy * w.ny;
    const prog = a.d > 0 ? a.s : w.len - a.s, remain = w.len - prog, cross = w.kind === 'cross';
    if (!a.path && remain < 7 && a.noPlan !== w) { this.plan(a); if (!a.path) a.noPlan = w; }
    bandAt(w, clamp(a.s + a.d * 1.5, 0, w.len), B);
    if (think) { this.avoid(a, w, B); if (this.fbKeep && (cross ? this.slowCars.length : this.slowOwn.length)) this.round(a, w, B, cross); }
    // about to walk into the close-up space of a camera that stands still, and no room to go round: turn back before it
    if (think && this.slow && !cross && !a.lead && a.state === 'walk' && !this.inFront(a.x, a.y) && (this.inFront(a.x + Math.cos(a.h) * 2.2, a.y + Math.sin(a.h) * 2.2) || this.inFront(a.x + w.ux * a.d * 3.5, a.y + w.uy * a.d * 3.5, this.keepOut - 1))) {
      a.d = -a.d; a.gx = -a.gx; a.gy = -a.gy; a.path = null; a.noPlan = null; a.lt = clamp(B.lo + B.hi - a.lt, B.lo, B.hi); a.la = 0; }
    if (a.path) {
      const p = a.path[0], w2 = p.w, u1x = w.ux * a.d, u1y = w.uy * a.d, u2x = w2.ux * p.d, u2y = w2.uy * p.d, det = u1x * u2y - u1y * u2x;
      let go = remain <= 0.05;
      if (Math.abs(det) > 0.25 && remain < 9) { const rx = w2.ax + w2.nx * p.lt - a.x, ry = w2.ay + w2.ny * p.lt - a.y, t = (rx * u2y - ry * u2x) / det; if (t < 0.4 + a.v * 0.15) go = true; }
      if (go) { this.enter(a, p); return; }
    } else if (remain <= 0.4) {     // the end of the walkable way: turn back (or leave, if no one is looking)
      if (this.unseen(a.x, a.y) && !a.fol) { this.remove(a); return; }
      a.d = -a.d; a.gx = -a.gx; a.gy = -a.gy; a.lt = clamp(B.lo + B.hi - a.lt, B.lo, B.hi); a.la = 0; a.noPlan = null;
    }
    const look = 1.3 + a.v * 0.7, s2 = a.s + a.d * look; let lt = clamp(a.lt + a.la, B.lo, Math.max(B.lo, B.hi));
    if (a.door) { if (a.l < B.hi - 0.2) a.door = 0; }
    // Traffic can enter an escape route during its three-second lifetime.
    if (a.escT > 0) {
      if (a.escapeHeld) a.escapeRetry -= dt;
      if (think) {
        const blocked = this.vehicleAt(a.ex, a.ey, a.x, a.y, undefined, true);
        if (!blocked) a.escapeHeld = false;
        else if (!a.escapeHeld || a.escapeRetry <= 0) {
          a.escapeHeld = !this.wayOut(a);
          if (a.escapeHeld) a.escapeRetry = 1;
        }
      }
      if (a.escapeHeld) { a.v = 0; this.gait(a, dt); return; }
    }
    if (a.escT > 0) { a.escT -= dt; const ed = Math.hypot(a.ex - a.x, a.ey - a.y); if (ed < 0.35) a.escT = 0; else { a.vcap = Math.max(a.vcap, 0.8); this.steer(a, a.ex, a.ey, dt, Math.min(a.v0, 1.3), true, true); a.onRoad = false; this.gait(a, dt); return; } }
    if (a.carT > 0) { a.carT -= dt; lt = a.carL; if (!cross && !this.g.statics.onSidewalk(a.x, a.y)) a.carRoad = true; else a.carRoad = false; } else if (a.carRoad) a.carRoad = false;
    if (a.fbBack > 0 && a.s > 0.2 && a.s < w.len - 0.2 && a.l > B.lo - 0.2 && a.l < B.hi + 0.2) a.fbBack = 0;      /* back on the walk itself (not merely level with it past its end) */
    if (cross && a.crossYield === w) a.vcap = 0;
    let hurry = cross ? 1.1 : 1;
    if (cross && a.onRoad) { const nd = this.g.roads.nodes[w.node]; if (nd.sig) { const left = this.g.roads.signal(w.node, w.e, this.g.t) === 'r' ? this.g.roads.toGreen(w.node, w.e, this.g.t) : 0; if (left < remain / a.v0 + 1.5) hurry = 1.5; } }     // the light is about to change: step out
    this.steer(a, w.ax + w.ux * s2 + w.nx * lt, w.ay + w.uy * s2 + w.ny * lt, dt, a.v0 * hurry);
    if (cross) { a.onRoad = prog > 0.2 && remain > 0.2; a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12); } else { a.onRoad = !!a.carRoad; const up = !a.carRoad && (a.l > 0.45 || this.g.statics.onSidewalk(a.x, a.y)); a.z += ((up ? 0.15 : 0) - a.z) * Math.min(1, dt * 12); }
    this.gait(a, dt);
    a.trip -= a.v * dt;
  }
  follow(a, dt, think) {
    const L = a.lead;
    if (L.state === 'wait' && L.wq && L.wq.bk !== undefined) {      /* people/crowd-kerb: at the kerb each of the company stands on the place kept beside the leader (kerbPlace), turned a little towards them */
      const c = Math.cos(L.th), sn = Math.sin(L.th), px = L.tx + sn * a.off - c * a.back, py = L.ty - c * a.off - sn * a.back, d = Math.hypot(px - a.x, py - a.y);
      const approaching = !L.wq.holdPosition && d > 0.2 && L.t < 14;
      if (approaching && this.standingPathClear(a, L.wq, px, py, think)) { a.vcap = 9; this.steer(a, px, py, dt, Math.min(a.v0 * 1.1, 0.5 + d * 1.2), true); } else { a.v = Math.max(0, a.v - 4 * dt); a.h += clamp(wrapPi(L.th + (a.off > 0 ? 0.3 : -0.3) - a.h), -2.2 * dt, 2.2 * dt); }
      a.onRoad = false; a.z += (0.15 - a.z) * Math.min(1, dt * 12); a.s = L.s; a.l = L.l; this.gait(a, dt); return; }
    const hx = Math.cos(L.h), hy = Math.sin(L.h); let off = a.off, back = a.back; const w = L.w;
    if (w && w.kind !== 'cross') { bandAt(w, clamp(L.s, 0, w.len), B); const rn = hy * w.nx - hx * w.ny, l = L.l + off * rn; if (l < B.lo - 0.1 || l > B.hi + 0.25) { off *= 0.25; back += 0.85; } }
    const sx = L.x + hy * off - hx * back, sy = L.y - hx * off - hy * back, ex = sx - a.x, ey = sy - a.y, fe = ex * hx + ey * hy;
    // The offset is measured along this route's normal.
    if (a.formationWay !== w) {
      a.formationWay = w;
      a.formationOffset = 0;
    }
    let shift = 0;
    if (w) {
      if (w.kind === 'cross') {
        // A crossing has a constant walking band from curb to curb.
        B.lo = w.lo[0]; B.hi = w.hi[0];
      } else if (w.np > 1) {
        const along = (sx-w.ax)*w.ux + (sy-w.ay)*w.uy;
        bandAt(w, clamp(along, 0, w.len), B);
      }
      const slot = (sx-w.ax)*w.nx + (sy-w.ay)*w.ny;
      if (think) this.avoid(a, w, B, slot);
      shift = clamp(slot + (a.formationOffset || 0), B.lo, Math.max(B.lo, B.hi)) - slot;
      if (w.kind !== 'cross' && w.np > 1) {
        const tx = sx + hx*1.4 - w.ax, ty = sy + hy*1.4 - w.ay;
        bandAt(w, clamp(tx*w.ux + ty*w.uy, 0, w.len), B);
      }
      const lateral = slot + 1.4*(hx*w.nx + hy*w.ny);
      shift = clamp(lateral + shift, B.lo, Math.max(B.lo, B.hi)) - lateral;
    } else if (think) this.avoid(a, null, null);
    if (L.state === 'cross' && L.crossYield === w && fe > 0) a.vcap = 0;
    if (L.v < 0.08 && Math.hypot(ex, ey) < 0.35) { a.v = Math.max(0, a.v - 3 * dt); a.h += clamp(wrapPi(L.h - a.h), -TURN * dt, TURN * dt); }
    else this.steer(a, sx + hx * 1.4 + (w ? w.nx * shift : 0), sy + hy * 1.4 + (w ? w.ny * shift : 0), dt, clamp(L.v + fe * 1.6, 0, a.v0 * 1.25));
    a.onRoad = L.onRoad; a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12); a.s = L.s; a.l = L.l;
    this.gait(a, dt);
  }
  standingPathClear(a, reservation, x, y, think) {
    const staticVersion = this.g.statics.__crowdV;
    const walker = this.fbWalls ? a : undefined;
    if (think || a.approachStaticVersion !== staticVersion || a.approachNavVersion !== this.nav.ver ||
        a.approachFloor !== walker?.z || a.approachScale !== walker?.tall ||
        a.approachReservation !== reservation || a.approachX !== x || a.approachY !== y) {
      a.approachX = x; a.approachY = y;
      a.approachFloor = walker?.z; a.approachScale = walker?.tall;
      a.approachReservation = reservation;
      a.approachNavVersion = this.nav.ver;
      a.approachStaticVersion = staticVersion;
      a.retreatingFromObstacle = false;
      a.standingPathBlocked = this.staticApproachBlocked(a.x, a.y, x, y, a, walker) ||
        (this.fbWalls && buildingOnWalk(this.nav, a, x, y));
      a.retreatingFromStatic = a.retreatingFromObstacle;
    }
    a.retreatingFromObstacle = a.retreatingFromStatic;
    return !a.standingPathBlocked && !this.vehicleAt(x, y, a.x, a.y, undefined, true, a, walker, 1.78 * (a.tall ?? 1));
  }
  standStill(a, dt, clip, think) {
    const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
    if (d > 0.22 && a.t < 12 && this.standingPathClear(a, a.wq, a.tx, a.ty, think)) { a.vcap = 9; this.steer(a, a.tx, a.ty, dt, Math.min(a.v0, 0.5 + d * 1.2), true); this.gait(a, dt, clip); return false; }
    a.v = Math.max(0, a.v - 4 * dt); a.h += clamp(wrapPi(a.th - a.h), -2.2 * dt, 2.2 * dt); a.slowT += dt; if (a.v < 0.1) this.setClip(a, clip); return true;
  }
  // the player's cars: run from one bearing down, go down if struck (as the game's own pedestrians do)
  cars(a, dt) {
    const g = this.g;
    for (const v of g.vehicles) {
      const dx = a.x - v.x, dy = a.y - v.y; if (Math.abs(dx) > 24 || Math.abs(dy) > 24) continue; const sp = Math.hypot(v.vx, v.vy);
      if (!(sp > 2.2)) continue;
      if (this.fbWalls) {
        const floor = a.seatOf?.z ?? a.z ?? 0;
        const height = a.seatOf ? (a.seatOf.seat ?? 0.46) + 1 : 1.78 * (a.tall ?? 1);
        if (!overlapsVehicleHeight(v, floor, height)) continue;
      }
      const fx = Math.cos(v.h), fy = Math.sin(v.h), f = dx * fx + dy * fy, s = -dx * fy + dy * fx;
        if (Math.abs(f) < v.def.len / 2 + 0.3 && Math.abs(s) < v.def.wid / 2 + 0.25) { if (g.P.get('ragdoll2') !== '0') a.beforeHit = {x: Math.cos(a.h) * a.v, y: Math.sin(a.h) * a.v};
          this.leaveGroup(a); if (a.state === 'stand') this.nStand--; if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } a.state = 'down'; a.t = 0; a.vx = v.vx * 0.9 - fy * Math.sign(s || 1) * 2; a.vy = v.vy * 0.9 + fx * Math.sign(s || 1) * 2; a.v = 0; this.hits++; try { g.onPedHit(a, v); } catch (e) {} finally { delete a.beforeHit; } return true; }
      if (sp > 3 && a.state === 'flee' && a.dg && !a.dg.urg) { const f = (dx * v.vx + dy * v.vy) / sp, sd = (dx * -v.vy + dy * v.vx) / sp;      /* lead: the car is nearly on them and they are still in its path: the last-moment leap, at the old full pace, straight out to the nearer side */
        if (f > -1 && f < 2.5 + sp * 0.6 && Math.abs(sd) < v.def.wid / 2 + 0.6) { const sg = sd > 0 ? 1 : -1, D = a.dg; D.urg = true; D.top = 4.2; if (a.t < D.d) { D.d = a.t; } a.vx = (-v.vy / sp) * sg; a.vy = (v.vx / sp) * sg; } }
      if (sp > 3 && a.state !== 'flee') { const dd = Math.hypot(dx, dy); if (dd > (this.dodgeOld ? 14 : 22)) continue;      /* lead: they notice the car about half a second sooner, which pays for the reaction time */ const f = (dx * v.vx + dy * v.vy) / sp, side = Math.abs(dx * v.vy - dy * v.vx) / sp;
        if (f > -1 && f < 5 + sp * (this.dodgeOld ? 1.1 : 1.6) && side < v.def.wid / 2 + 0.75) { const sg = (dx * -v.vy + dy * v.vx) > 0 ? 1 : -1; this.leaveGroup(a); if (a.state === 'stand') this.nStand--; if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; } a.v0 = a.v || 0; a.state = 'flee'; a.t = 0; a.vx = (-v.vy / sp) * sg; a.vy = (v.vx / sp) * sg; if (this.dodgeOld) { a.dg = null; this.setClip(a, this.jog); } else a.dg = { d: 0.16 + ((a.id * 37) % 100) * 0.0026, top: Math.min(clamp(1.9 + sp * 0.1, 2.1, 3.3), this.jog.speed * a.tall * 1.1), on: false };      /* lead, Nov 15 (Matt's report 204836-6d34a5, 'people run away from a coming car unnaturally quickly'): a person in a car's path used to snap round and sprint at up to 4.2 m/s in the same frame. Now: a reaction time of 0.16-0.42 s (by who they are) in which they only slow, then a quick step or a short run that builds up over about half a second to a pace set by the car's speed (2.1 m/s for a slow car, 3.3 at most and never more than 1.1 x the jog clip's own pace, so the legs are not sped up), turning at a human rate. ?crowddodge=0 = before. A run from gunfire is unchanged. */ } }
    }
    return false;
  }
  leaveGroup(a) { if (a.lead) { const f = a.lead.fol; if (f) { const k = f.indexOf(a); if (k >= 0) f.splice(k, 1); if (!f.length) a.lead.fol = null; } a.lead = null; } if (a.fol) { for (const f of a.fol) f.lead = null; a.fol = null; } if (a.spot) { a.spot.who = null; a.spot = null; } }
  giveWayToPlayer(a, player) {
    const dx = a.x - player.x, dy = a.y - player.y, distance = Math.hypot(dx, dy);
    if (distance >= 0.7 || distance <= 1e-3) return;
    if (this.fbWalls) {
      const playerFloor = player.alt || (this.g.statics.onSidewalk(player.x, player.y) ? 0.15 : 0);
      const floor = a.z ?? 0;
      if (floor >= playerFloor + 1.78 || playerFloor >= floor + 1.78 * (a.tall ?? 1)) return;
    }
    const x = a.x + dx / distance * (0.7 - distance);
    const y = a.y + dy / distance * (0.7 - distance);
    this.moveIfClear(a, x, y);
  }
  cameraNearFloor(a, cameraY) {
    if (!this.fbWalls) return cameraY < 3;
    const terrain = this.g.terrain;
    const ground = terrain?.inBox(a.x, a.y) ? terrain.h(a.x, a.y) : 0;
    const aboveFeet = cameraY - (ground + (a.z ?? 0));
    return aboveFeet >= 0 && aboveFeet < 3;
  }
  moveIfClear(a, x, y, pushingCar) {
    const raised = a.z > 1, height = 1.78 * (a.tall ?? 1);
    if (this.fbWalls && (buildingOnWalk(this.nav, a, x, y) ||
        this.fallenBodyBlocks(a, a.x, a.y, x, y) ||
        staticPathBlocked(this.g.statics, a.x, a.y, x, y, true, undefined, raised ? 0.25 : undefined, 0.25, a.z ?? 0) ||
        (raised ? this.furnitureAtHeight(a.x, a.y, x, y, a.z, height, 0.25, true) :
          this.crossesFurniture(a.x, a.y, x, y, undefined, a.z ?? 0, height)) ||
        this.vehicleAt(x, y, a.x, a.y, undefined, true, undefined, a, height, pushingCar, true))) return;
    a.x = x;
    a.y = y;
  }
  // Public feedback ("the pedestrians clip through the car if the car is on the sidewalk"): the player's cars that stand or creep
  // (this.still, listed each step; cars() has the ones that move). Nobody stands or walks inside one: a place to stand that a car now
  // covers moves to beside it, a body inside is moved out at a walking pace (faster as the car creeps), sideways unless a bumper is
  // much nearer or a wall is hard against that side; a walker then keeps the line it was put on until it is past (carT, carL in walkOn).
  offCars(a, dt, think) {
    for (const q of this.still) {
      const dx = a.x - q.x, dy = a.y - q.y; if (dx > q.R || dx < -q.R || dy > q.R || dy < -q.R) continue;
      if (this.fbWalls && q.v && !overlapsVehicleHeight(q.v, a.z ?? 0, 1.78 * (a.tall ?? 1))) continue;
      const height = 1.78 * (a.tall ?? 1);
      const blockedPush = (ex, ey, relocating = false) => {
        if (buildingOnWalk(this.nav, a, ex, ey)) return true;
        // A relocated destination must fully exit the car covering the old spot.
        return this.carPushBlocked(a, a.x, a.y, ex, ey, height, relocating ? undefined : q.v, 0.25, !relocating) ||
          this.crossesFurniture(a.x, a.y, ex, ey, undefined, a.z ?? 0, height);
      };
      if (think && (a.state === 'stand' || a.state === 'wait')) { const ux = a.tx - q.x, uy = a.ty - q.y, f = ux * q.c + uy * q.s, s = -ux * q.s + uy * q.c;
        if (Math.abs(f) < q.hl + 0.12 && Math.abs(s) < q.hw + 0.12) { let sd = s >= 0 ? 1 : -1; if (sd > 0 ? !q.okL && q.okR : !q.okR && q.okL) sd = -sd; const pf = q.hl - Math.abs(f), ps = q.hw - s * sd;
          let tx = a.tx, ty = a.ty;
          if (q.sp < 0.3 && pf < ps * 0.7) { const m = (pf + 0.3) * (f >= 0 ? 1 : -1); tx += q.c * m; ty += q.s * m; }
          else { const m = (ps + 0.3) * sd; tx -= q.s * m; ty += q.c * m; }
          let reachable = !this.fbWalls || !blockedPush(tx, ty, true);
          const walkerSide = -dx * q.s + dy * q.c;
          if (!reachable && Math.abs(walkerSide) > q.hw && (walkerSide > 0 ? q.okL : q.okR)) {
            const offset = Math.sign(walkerSide) * (q.hw + 0.3);
            tx = q.x + q.c * f - q.s * offset;
            ty = q.y + q.s * f + q.c * offset;
            reachable = !blockedPush(tx, ty, true);
          }
          const walkerAlong = dx * q.c + dy * q.s;
          if (!reachable && q.sp < 0.3 && Math.abs(walkerAlong) > q.hl) {
            const end = Math.sign(walkerAlong) * (q.hl + 0.3);
            tx = q.x + q.c * end - q.s * s;
            ty = q.y + q.s * end + q.c * s;
            reachable = !blockedPush(tx, ty, true);
          }
          if (reachable) {
            a.tx = tx; a.ty = ty;
            if (a.t > 8) { const k = a.t - 8; a.t = 8; if (a.standT < 1e8) a.standT -= k; if (a.wq && a.wq.go >= 0) a.wq.go -= k; }
            this.fb.carMoved++;
          }
        }
      }
      const f = dx * q.c + dy * q.s, s = -dx * q.s + dy * q.c, pf = q.hl - Math.abs(f), ps0 = q.hw - Math.abs(s); if (pf <= 0 || ps0 <= 0) continue;
      let sd = s >= 0 ? 1 : -1; if (Math.abs(s) < 0.12) sd = a.id & 1 ? 1 : -1; if (sd > 0 ? !q.okL && q.okR : !q.okR && q.okL) sd = -sd;
      const rate = (1.5 + q.sp * 1.6 + (a.v || 0)) * dt, ps = q.hw - s * sd, walker = (a.state === 'walk' || a.state === 'cross') && !a.lead && a.w; let px = 0, py = 0;
      if (q.sp < 0.3 && pf < ps * 0.7) { const sg = f >= 0 ? 1 : -1, m = Math.min(pf, rate); px = q.c * sg * m; py = q.s * sg * m;
        // walking on into a bumper: step across towards the nearer side as well, until past the corner
        if (walker && (Math.cos(a.h) * q.c + Math.sin(a.h) * q.s) * sg < -0.2) { const m2 = Math.min(ps, 1.2 * dt); px += -q.s * sd * m2; py += q.c * sd * m2; } }
      else { const m = Math.min(ps, rate); px = -q.s * sd * m; py = q.c * sd * m; }
      if (this.fbWalls && blockedPush(a.x + px, a.y + py)) {
        if (q.sp >= 0.3) continue;
        const nearer = f >= 0 ? 1 : -1;
        let step = 0;
        for (const sign of [nearer, -nearer]) {
          const distance = q.hl - sign * f;
          const ex = a.x + q.c * sign * distance, ey = a.y + q.s * sign * distance;
          if (blockedPush(ex, ey)) continue;
          step = sign * Math.min(rate, distance);
          break;
        }
        if (!step) continue;
        px = q.c * step; py = q.s * step;
      }
      a.x += px; a.y += py; this.fb.carPush++;
      if (walker) { const w = a.w, pn = px * w.nx + py * w.ny; a.carT = 0.45; a.carL = (a.x - w.ax) * w.nx + (a.y - w.ay) * w.ny + (pn > 1e-4 ? 0.15 : pn < -1e-4 ? -0.15 : 0); }
    }
  }
  // A seated person gets up (public feedback: "people sitting down dont run"). Nothing in the crowd calls this: it is for whoever frightens
  // them (combat.js leaves sitters alone today, because until now they could not stand up). With a direction they run that way like anyone
  // set running; with none they walk off to the nearest way. The seat is given back (a bench partner keeps it).
  rise(a, vx, vy) {
    if (!a || a.gone || a.state !== 'sit') return false; const q = a.seatOf, mate = a.lead || (a.fol && a.fol[0]);
    if (q) {
      const x = a.x + Math.cos(a.h) * 0.35, y = a.y + Math.sin(a.h) * 0.35;
      const height = 1.78 * (a.tall ?? 1);
      if (!this.fbWalls || (this.g.statics.raycast(a.x, a.y, x, y) === 1 &&
          !staticPathBlocked(this.g.statics, a.x, a.y, x, y, true, undefined, 0.3) &&
          !this.nav.inBuilding(x, y, q.z > 1 ? q.z + height : 2.5, q.z ?? -Infinity, a.x, a.y) &&
          !this.seatBlocked(q, x, y, true, height, 0.3, a) && !this.seatTaken(q, x, y, a, height))) {
        a.x = x; a.y = y;
      } else if (this.seatBlocked(q, a.x, a.y, true, height, 0.3) || this.seatTaken(q, a.x, a.y, a, height)) {
        return false;
      }
      if (q.who === a) q.who = mate && !mate.gone && mate.state === 'sit' ? mate : null;
      a.z = q.z;
    }
    this.leaveGroup(a);
    a.seatOf = null; a.t = 0; a.standT = 0;
    if (vx !== undefined) { const L = Math.hypot(vx, vy) || 1; a.dg = null; a.state = 'flee'; a.vx = vx / L; a.vy = vy / L; this.setClip(a, this.jog); } else { a.state = 'walk'; this.rejoin(a); }
    return true;
  }
  // nowhere to walk to from here without a wall between: stay, standing, until the camera cannot see (populate then takes them away)
  strand(a) {
    if (this.unseen(a.x, a.y)) { this.remove(a); return; } if (a.wq) { a.wq.w.wait[a.wq.end][a.wq.n] = 0; a.wq = null; }
    if (this.fbWalls) { a.rejoinTarget = null; a.rejoinRetryAt = this.g.t + 2; }
    if (a.state !== 'stand') this.nStand++; a.state = 'stand'; a.t = 0; a.standT = 1e9; a.tx = a.x; a.ty = a.y; a.th = a.h; a.v = 0; a.lost = true; a.talk = null; a.fbBack = 0; this.fb.lost++;
  }
  parkBlocksRejoin(x, y, px, py, allObstacles = false, person) {
    return staticPathBlocked(this.g.statics, x, y, px, py, allObstacles, person);
  }
  // back onto the network after running or being let go: the nearest way (with ?crowdwalls on: the nearest that can be walked to without
  // a wall between; with none in reach they stay where they are, standing, and are taken away once the camera cannot see them)
  rejoin(a) {
    const W = this.fbWalls;
    a.rejoinTarget = null;
    let best = null, bd = 1e9, bestX, bestY;
    for (const w of this.nav.near(a.x, a.y, 30, [])) {
      if (w.kind === 'cross') continue;
      const dx = a.x - w.ax, dy = a.y - w.ay;
      const s = clamp(dx * w.ux + dy * w.uy, 0, w.len);
      bandAt(w, s, B);
      if (B.hi <= 0) continue;
      const l = clamp(dx * w.nx + dy * w.ny, B.lo, B.hi);
      const px = w.ax + w.ux * s + w.nx * l, py = w.ay + w.uy * s + w.ny * l;
      const d = Math.hypot(a.x - px, a.y - py);
      if (!(d < bd)) continue;
      if (W && (!this.g.statics.onSidewalk(px, py) || !this.freeAt(px, py, px, py, a))) continue;
      if (W && (buildingOnWalk(this.nav, a, px, py) ||
          (d > 0 && this.staticApproachBlocked(a.x, a.y, px, py, undefined, a)))) continue;
      if (W && this.vehicleAt(px, py, a.x, a.y, undefined, true, undefined, a, 1.78 * (a.tall ?? 1))) continue;
      best = w; bd = d; bestX = px; bestY = py;
    }
    if (!best && W) {
      if (!a.lost || a.state !== 'stand') this.strand(a);
      else a.rejoinRetryAt = this.g.t + 2;
      return;
    }
    if (!best) { this.remove(a); return; }
    if (W && bd > 0) a.rejoinTarget = {x:bestX, y:bestY};
    if (W) { a.rejoinRetryAt = undefined; a.lost = false; a.fbBack = 40; a.fbT = 0; a.fbN = 0; a.fbx = a.x; a.fby = a.y; }
    if (a.w) { const j = a.w.agents.indexOf(a); if (j >= 0) a.w.agents.splice(j, 1); } best.agents.push(a); a.w = best; if (a.home) a.home.pop--; a.home = best; best.pop++; a.d = (best.ux * a.gx + best.uy * a.gy) >= 0 ? 1 : -1; a.path = null; a.state = 'walk'; a.la = 0; bandAt(best, clamp((a.x - best.ax) * best.ux + (a.y - best.ay) * best.uy, 0, best.len), B); a.lt = (B.lo + B.hi) / 2; this.setClip(a, a.walkClip);
  }

  step(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0, g = this.g; this.frame++;
    const ox = this.cx, oy = this.cy; this.view(); { const sp = Math.hypot(this.cx - ox, this.cy - oy) / Math.max(dt, 1e-3); this.camV = sp > 50 ? 0 : (this.camV || 0) + (sp - (this.camV || 0)) * 0.05; this.slow = this.keepOut > 0 && this.camV < 0.35 && this.g.world.camera.position.y < 3; this.zx = this.cx + this.fx * 3.4; this.zy = this.cy + this.fy * 3.4; }
    const jump = Math.hypot(this.cx - ox, this.cy - oy) > 60;
    if (jump) { this.populate(dt, true); this.popT = 0.2; } else { this.popT -= dt; if (this.popT <= 0) { this.popT = 0.2; this.populate(dt, false); } }
    this.grid(); this.road.length = 0;
    const A = this.agents, pl = g.player, st0 = g.statics, SC = this.still; SC.length = 0;
    // the player's cars that stand or creep; a side with a wall hard against it is no way out (probed when the car has moved)
    if (this.fbCars) for (const v of g.vehicles) { const sp = Math.hypot(v.vx || 0, v.vy || 0); if (sp > 2.2 || !v.def || Math.abs(v.x - this.cx) > 130 || Math.abs(v.y - this.cy) > 130) continue;
      const q = this._stillPool[SC.length] || (this._stillPool[SC.length] = {}); q.x = v.x; q.y = v.y; q.c = Math.cos(v.h); q.s = Math.sin(v.h); q.hl = v.def.len / 2 + 0.27; q.hw = v.def.wid / 2 + 0.27; q.sp = sp; q.R = q.hl + 0.75;
      if (q.v !== v || q.px !== v.x || q.py !== v.y || q.ph !== v.h) { q.v = v; q.px = v.x; q.py = v.y; q.ph = v.h; q.okL = q.okR = true; for (const sd of [1, -1]) for (const u of [-0.6, 0, 0.6]) { if (st0.resolve(v.x + q.c * q.hl * u - q.s * (q.hw + 0.25) * sd, v.y + q.s * q.hl * u + q.c * (q.hw + 0.25) * sd, 0.24, _o, true) > 0) { if (sd > 0) q.okL = false; else q.okR = false; } } }
      SC.push(q); }
    // people/crowd-walls: traffic near the camera (for bodies on the roadway), the cars that stand or creep (to walk round), who lies on the ground
    const KEEP = this.fbKeep, TC = this.tcars, SL = this.slowCars, SO = this.slowOwn; TC.length = 0; SL.length = 0; SO.length = 0;
    if (KEEP) { let n = 0; const slow = (e, sp) => { const q = this._slowPool || (this._slowPool = []), o = q[n] || (q[n] = {}); n++; o.vehicle = e; o.x = e.x; o.y = e.y; o.c = Math.cos(e.h); o.s = Math.sin(e.h); o.hl = e.def.len / 2 + 0.45; o.hw = e.def.wid / 2 + 0.45; SL.push(o); return o; };
      for (const e of g.traffic.cars) { if (!e.def || Math.abs(e.x - this.cx) > 150 || Math.abs(e.y - this.cy) > 150) continue; TC.push(e); if (Math.abs(e.v || 0) < 1.2) slow(e); }
      for (const v of g.vehicles) { if (!v.def || Math.abs(v.x - this.cx) > 150 || Math.abs(v.y - this.cy) > 150) continue; if (Math.hypot(v.vx || 0, v.vy || 0) < 2.2) SO.push(slow(v)); }
      if ((this.lyT -= dt) <= 0) { this.lyT = 0.5; this.findLying(); } }
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i]; if (!a || a.gone) continue; a.t += dt; const think = (this.frame + a.tk) % 3 === 0, ox = a.x, oy = a.y; if (this.timed) { a.tt = (a.tt || 0) + dt; if (think) { this.kq = Math.min(8, a.tt / 0.05); a.tt = 0; } } else this.kq = 1;      /* people/crowd-perf: per-think chances by time (one step a drawn frame, crowd.js) */
      if (a.state !== 'down' && g.vehicles.length && this.cars(a, dt)) { /* struck */ }
      switch (a.state) {
        case 'walk':
          if (a.lead) { if (a.lead.gone) { a.lead = null; break; } this.follow(a, dt, think); break; }
          this.walkOn(a, dt, think);
          if (a.rejoinTarget) break; // Finish returning to the sidewalk before stopping or entering a doorway.
          if (think && !a.gone && a.state === 'walk' && a.w.kind === 'strip' && !a.path) {
            // now and then someone stops for a while; a trip that is over ends at a doorway when no one is near to watch
            const q = this.rand();
            if (q < 0.0004 * this.kq && this.nStand < this.agents.length * 0.2 && (!a.fol || !a.fol.some((f) => f.kid))) this.stand(a, 15 + this.rand() * 70, false);
            else if (q < 0.0009 * this.kq && !a.fol && !this.inFront(a.x, a.y, this.keepOut + 1.5)) { if (this.rand() < 0.5) this.hold(a, 'phone'); a.state = 'stand'; this.nStand++; a.t = 0; a.standT = 3 + this.rand() * 8; a.tx = a.x; a.ty = a.y; a.th = a.h + (this.rand() - 0.5) * 1.4; }
            else if (a.trip < 0 && !a.fol && a.w.pop > a.w.want && Math.hypot(a.x - this.cx, a.y - this.cy) > 80) { bandAt(a.w, a.s, B); if (B.hi < 11) { a.lt = B.hi + 0.5; a.door = 2; } a.trip = 1e9; }
          }
          if (a.door === 2 && !a.gone) { bandAt(a.w, clamp(a.s, 0, a.w.len), B); a.la = 0; if (a.l > B.hi - 0.15) { if (Math.hypot(a.x - this.cx, a.y - this.cy) > 70 || this.unseen(a.x, a.y)) this.remove(a); else { a.door = 0; a.lt = (B.lo + B.hi) / 2; a.trip = 200; } } }
          break;
        case 'wait': {
          const w = a.w, q = a.wq; if (a.lead) { this.follow(a, dt, think); a.state = a.lead.state === 'wait' ? 'wait' : a.lead.state === 'cross' ? 'cross' : 'walk'; break; }
          this.standStill(a, dt, (a.hand && a.hand.stand ? a.idle : q.clip) || this.waitClip || a.idle, think);
          if (q.go < 0) { if (think && this.canWalk(w, a)) q.go = a.t + 0.15 + this.rand() * 1.1 + (q.bk === undefined ? q.n * 0.12 : Math.min(3, (q.bk - 0.6) * 0.62) + Math.min(0.5, q.n * 0.03)); else if (a.t > 75 && think) { /* stuck at a crossing that never clears: give it up */ w.wait[q.end][q.n] = 0; a.wq = null; a.d = -a.d; this.rejoin(a); } }
          else if (a.t >= q.go) { if (this.canWalk(w, a, 0)) { w.wait[q.end][q.n] = 0; a.wq = null; a.state = 'cross'; a.lt = clamp((a.x - w.ax) * w.nx + (a.y - w.ay) * w.ny, -1.8, 1.8); a.la = 0; if (a.fol) for (const f of a.fol) f.state = 'cross'; } else q.go = -1; }
          break; }
        case 'cross': {
          if (a.lead) { this.follow(a, dt, think); if (a.lead.state !== 'cross' && a.lead.state !== 'wait') a.state = 'walk'; break; }
          const w = a.w; this.walkOn(a, dt, think); if (a.gone) break;
          if (a.w !== w || a.w.kind !== 'cross') { if (a.state === 'cross') a.state = 'walk'; if (a.fol) for (const f of a.fol) if (f.state === 'cross') f.state = 'walk'; }
          else if (think) {     // traffic that is moving on the crossing: do not step in front of it, get clear of it
            a.crossYield = null;
            if (w.carsT !== this.frame) {
              w.carsT = this.frame;
              const cars = w.cars || (w.cars = []);
              cars.length = 0;
              const mx = w.ax + w.ux*w.len/2, my = w.ay + w.uy*w.len/2;
              const collect = (c, speed, reachSpeed = Math.abs(speed)) => {
                const reach = w.len/2 + 3.4 + (c.def.len+c.def.wid)/2 + 1.5 + reachSpeed*1.3;
                if (Math.abs(c.x-mx) <= reach && Math.abs(c.y-my) <= reach) cars.push(c, speed);
              };
              for (const c of g.traffic.cars) collect(c, c.rev > 0 ? -c.rev : c.v);
              w.trafficEnd = cars.length;
              for (const c of g.vehicles) {
                const speed = c.vx*Math.cos(c.h) + c.vy*Math.sin(c.h);
                if (c.vx || c.vy) collect(c, speed, Math.hypot(c.vx,c.vy));
              }
            }
            for (let i = 0; i < w.cars.length; i += 2) {
              const c = w.cars[i], longitudinal = w.cars[i+1];
              if (this.fbWalls && !overlapsVehicleHeight(c, a.z ?? 0, 1.78 * (a.tall ?? 1))) continue;
              const dx = a.x-c.x, dy = a.y-c.y, fx = Math.cos(c.h), fy = Math.sin(c.h);
              const f = dx*fx + dy*fy, s = -dx*fy + dy*fx, hw = c.def.wid/2;
              if (i < w.trafficEnd && Math.abs(f) < c.def.len / 2 + 0.4 && Math.abs(s) < hw + 0.4) {
                const push = (hw + 0.4 - Math.abs(s)) * 0.5 * Math.sign(s || 1);
                this.moveIfClear(a, a.x - fy * push, a.y + fx * push, c);
                a.vcap = Math.min(a.vcap, 0.6);
              }
              else {
                if (i >= w.trafficEnd) {
                  const lateral = -c.vx*fy + c.vy*fx;
                  const distance = s*Math.sign(lateral);
                  if (distance > 0 && distance < hw + 1.5 + Math.abs(lateral)*1.3) {
                    const next = f + (Math.cos(a.h)*fx + Math.sin(a.h)*fy)*a.v0*1.2;
                    const half = c.def.len/2;
                    if (Math.abs(f) > half + 0.5 && Math.abs(next) < half + 0.6) {
                      a.crossYield = w; a.vcap = 0;
                    }
                  }
                }
                const reversing = longitudinal < 0, speed = Math.abs(longitudinal);
                const ahead = reversing ? -f : f;
                if (speed > 0 && ahead > 0 && ahead < c.def.len / 2 + 1.5 + speed * 1.3) {
                  const ns = s + (-Math.cos(a.h) * fy + Math.sin(a.h) * fx) * a.v0 * 1.2;
                  if (Math.abs(s) > hw + 0.5 && Math.abs(ns) < hw + 0.6) { a.crossYield = w; a.vcap = 0; }
                }
              }
            }
          }
          break; }
        case 'stand': {
          this.standStill(a, dt, a.talk && (a.fol || a.lead) ? a.talk : a.idle, think); a.onRoad = false; if (a.lead && a.talk && a.clip === a.talk.i && a.lead.clip === a.lead.talk.i) a.ph = a.lead.ph;
          if (a.t > a.standT && !a.lead && a.w) { a.state = 'walk'; this.nStand--; a.path = null; bandAt(a.w, clamp(a.s, 0, a.w.len), B); a.lt = clamp((B.lo + B.hi) / 2 + (this.rand() - 0.5), B.lo, B.hi); a.la = 0; if (a.fol) for (const f of a.fol) { f.state = 'walk'; this.nStand--; f.talk = null; } a.talk = null; }
          break; }
        case 'flee': {
          let sp = Math.min(4.2, this.jog.speed * a.tall * 1.25); const D = a.dg;
          if (D) { if (a.t < D.d) sp = (a.v0 || 0) * 0.5 * (1 - a.t / D.d); else { if (!D.on) { D.on = true; a.v = D.top; this.setClip(a, D.top < 2.6 ? this.walks.reduce((x, y) => (x.speed > y.speed ? x : y)) : this.jog); } sp = Math.min(sp, D.top, 0.8 + (a.t - D.d) * 6); } }
          a.v = sp;
          if (!this.fbWalls) { g.statics.resolve(a.x + a.vx * sp * dt, a.y + a.vy * sp * dt, 0.3, _o, true); a.x = _o.x; a.y = _o.y; }
          else {
            // Public feedback ("when I shoot at people sometimes they walk through buildings"): a run used to keep ONE direction for its whole
            // length, pressed into whatever wall was there. Now a wall met turns the run along it (the way they were leaning; head-on, to one
            // side by who they are), a step that would cross a wall is not taken, and a run that gets nowhere (a corner) turns away from the wall.
            if (st0.resolve(a.x + a.vx * sp * dt, a.y + a.vy * sp * dt, 0.3, _o, true)) {
              const nx = _o.nx, ny = _o.ny, tx = -ny, ty = nx, along = tx * a.vx + ty * a.vy; a.wnx = nx; a.wny = ny;
              if (a.vx * nx + a.vy * ny < -0.05) { const sg = Math.abs(along) > 0.15 ? Math.sign(along) : a.id & 1 ? 1 : -1, k = Math.min(1, dt * 8); a.vx += (tx * sg - a.vx) * k; a.vy += (ty * sg - a.vy) * k; const L = Math.hypot(a.vx, a.vy) || 1; a.vx /= L; a.vy /= L; this.fb.wallTurn++; }
              if (st0.raycast(a.x, a.y, _o.x, _o.y) < 1) { _o.x = a.x; _o.y = a.y; a.vx = -a.vx; a.vy = -a.vy; this.fb.wallStop++; }
            }
            const nextX = _o.x, nextY = _o.y;
            const bodyHeight = 1.78 * (a.tall ?? 1);
            const raised = a.z > 1;
            if (buildingOnWalk(this.nav, a, nextX, nextY) ||
                staticPathBlocked(st0, a.x, a.y, nextX, nextY, true, undefined, 0.3) ||
                (raised ? this.furnitureAtHeight(a.x, a.y, nextX, nextY, a.z, bodyHeight, 0.25, true) :
                  this.crossesFurniture(a.x, a.y, nextX, nextY, undefined, a.z ?? 0, bodyHeight)) ||
                this.vehicleAt(nextX, nextY, a.x, a.y, undefined, true, undefined, a, bodyHeight)) {
              // Body and footprint obstacles may have no collision segment. Turn and try the next stride.
              const side = a.id & 1 ? 1 : -1, vx = a.vx;
              a.vx = -side * a.vy; a.vy = side * vx; a.v = 0;
            } else { a.x = nextX; a.y = nextY; }
            a.fq = (a.fq || 0) + dt; if (a.fq > 0.7 || a.fpx === undefined) { if (a.fpx !== undefined && a.fq < 2 && Math.hypot(a.x - a.fpx, a.y - a.fpy) < 1.1 && a.wnx !== undefined) { const u = (a.id & 1 ? 0.6 : -0.6), L = Math.hypot(a.wnx - a.wny * u, a.wny + a.wnx * u) || 1; a.vx = (a.wnx - a.wny * u) / L; a.vy = (a.wny + a.wnx * u) / L; } a.fq = 0; a.fpx = a.x; a.fpy = a.y; }
          }
          { const tr = !D ? 9 : a.t < D.d ? 0 : 5.5; a.h += clamp(wrapPi(Math.atan2(a.vy, a.vx) - a.h), -tr * dt, tr * dt); }
          a.onRoad = !g.statics.onSidewalk(a.x, a.y); a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12);
          if (a.t > 1.6) { let threat = false; for (const v of g.vehicles) if (Math.hypot(v.vx, v.vy) > 3 && Math.hypot(a.x - v.x, a.y - v.y) < 9) threat = true; if (!threat) this.rejoin(a); }
          break; }
        case 'sit': a.onRoad = false; if (a.lead && !a.lead.gone) a.ph = a.lead.ph; break;
        case 'down':
          plainSlide(g, a, dt, this.fbWalls, this.nav); { const k = Math.exp(-3.5 * dt); a.vx *= k; a.vy *= k; } a.fall = Math.min(1, a.fall + dt * 4); a.onRoad = !g.statics.onSidewalk(a.x, a.y); a.z = (a.onRoad ? 0 : 0.15) + 0.12 * a.fall; a.rate = 0; continue;
      }
      if (a.gone) continue;
      if (pl && !pl.vehicle && a.state !== 'sit') this.giveWayToPlayer(a, pl);
      if (this._cam && a.state !== 'sit') { const dx = a.x - this.cx, dy = a.y - this.cy, dd = dx * dx + dy * dy; if (dd < 3.2 && dd > 1e-4 && this.cameraNearFloor(a, g.world.camera.position.y)) { const d = Math.sqrt(dd); const push = (1.8 - d) * 0.12; this.moveIfClear(a, a.x + dx / d * push, a.y + dy / d * push); } }
      if (SC.length && a.state !== 'sit') this.offCars(a, dt, think);
      // on the way back to a walk after a run: not through a wall; pressed against one and getting nowhere, look again for a way, then give up and stand
      if (a.fbBack > 0) { a.fbBack -= dt; if (st0.resolve(a.x, a.y, 0.3, _o, true)) { a.x = _o.x; a.y = _o.y; }
        if ((a.fbT += dt) > 1.2) { if (a.state === 'walk' && !a.lead && a.vcap > 0.4 && Math.hypot(a.x - a.fbx, a.y - a.fby) < 0.35) { const n = a.fbN || 0; if (n > 0) { this.leaveGroup(a); this.strand(a); } else { this.rejoin(a); a.fbN = n + 1; } } a.fbT = 0; a.fbx = a.x; a.fby = a.y; } }
      // and within 70 m of the camera nobody on the move passes through a wall at all (the bands are sampled every 2.5 m and cut a building's corner here
      // and there: without a shot fired, 87 of 3000 people were more than 0.6 m inside a building at some moment of a minute): looked at on think steps
      else if (!KEEP && this.fbWalls && think && a.v > 0.05 && a.state !== 'flee' && a.state !== 'cross') { const dx = a.x - this.cx, dy = a.y - this.cy; if (dx * dx + dy * dy < 4900 && st0.resolve(a.x, a.y, 0.26, _o, true)) { a.x = _o.x; a.y = _o.y; this.fb.wallHold++; } }
      if (a.gone) continue;
      if (KEEP && a.state !== 'sit') { this.keep(a, ox, oy);
        if (!a.lead && (a.state === 'walk' || a.state === 'cross')) { if ((a.kq = (a.kq || 0) + dt) > 1.5) { if (a.kh > 30 && Math.hypot(a.x - (a.kx || 0), a.y - (a.ky || 0)) < 0.4) this.unstick(a); a.kq = 0; a.kh = 0; a.kx = a.x; a.ky = a.y; } }
        if (a.gone) continue; }
      if (this.fbWalls && ((a.rejoinTarget && a.state === 'walk') || (a.lost && a.state === 'stand'))) {
        a.onRoad = !st0.onSidewalk(a.x, a.y);
        a.z += ((a.onRoad ? 0 : 0.15) - a.z) * Math.min(1, dt * 12);
      }
      if (a.onRoad) this.road.push(a);
      this.animate(a, dt);
    }
    if (t0) this.ms += (performance.now() - t0 - this.ms) * 0.05;
  }
  stats() {
    const s = { n: this.agents.length, walk: 0, stand: 0, sit: 0, wait: 0, cross: 0, flee: 0, down: 0, groups: 0, road: this.road.length, spawned: this.spawned, retired: this.retired, want: this.sumWant, ms: +this.ms.toFixed(3) };
    for (const a of this.agents) { s[a.state]++; if (a.fol && a.fol.length) s.groups++; } return s;
  }
}
