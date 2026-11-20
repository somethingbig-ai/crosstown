// game.js: the game itself. Sim in map metres at a fixed 60 Hz step; three.js draws it.
import * as THREE from 'three';
import { StaticWorld, Roads, clamp, lerp, wrapPi, rng, TAU } from './geo.js';
import { setsOf } from './sets.js';
import { Kit, CarBatch, FigureBatch, bakeFigure, addProps, CAR_TYPES, PAINTS } from './models.js';
import { Traffic, Parked, Peds } from './traffic.js';
import { Hud } from './hud.js';
import { Missions } from './mission.js';
import { Autopilot } from './demo.js';
import { Sound } from './audio.js';
import { Fly } from './fly.js';
import { LookCtl } from './look.js';
import { imp as lrImp } from './loadretry.js';     // progress lane, Nov 15: a code file that failed to download is asked for again (src/loadretry.js; ?loadretry=0 off)
import { waterAt } from './streets/water.js';
import { fcOf, fcDrive, fcDrag, install as fcInstall } from './move/fastcars.js';
import { camPull } from './move/campull.js';     // gameplay lane, Nov 19: the chase camera comes in front of a bus or truck that stands between it and the player's car (public note Nov 18; ?campull=0)
import { kitOrder as pier86Kit } from './pier86.js';     /* merge2 round 32: Pier 86 (src/pier86.js; ?pier86=0) */
// downtown lane, Nov 15 (shore guard): the shore's wall is two thin lines; at the narrow end of a pier (the Skyport pier, x 1,173, y -1,056) a car-size circle gets
// through them (lanes/downtown/tools/shore-flood.mjs). Whatever the walls did, a move of the player or of a car that would END in the water from a place on land is
// not made. One point-in-outline test a step, only on a city that lists water. ?waterguard=0 off.
const WG = new URLSearchParams(location.search).get('waterguard') !== '0';
let wgCity = null, wgSouth = false; const wgOn = (c) => { if (c !== wgCity) { wgCity = c; wgSouth = ((c.meta && c.meta.sets) || []).some((s) => /^d[A-D]-/.test(s.set || '')); } return wgSouth; };     /* helper d15: only on a map with a downtown row (a set named d<row>-<col>); the ordinary map makes no test */
const wetMove = (g, x0, y0, x1, y1) => WG && g.city && g.city.water && wgOn(g.city) && !!waterAt(g.city, x1, y1) && !waterAt(g.city, x0, y0);

const DT = 1 / 60;
const SPEC = {   // per car type: top speed m/s, acceleration m/s2, grip
  sedan: { top: 40, acc: 6.2, grip: 8.5 }, taxi: { top: 39, acc: 6.0, grip: 8.2 }, suv: { top: 38, acc: 5.6, grip: 7.6 }, van: { top: 32, acc: 4.2, grip: 6.8 },
  sport: { top: 56, acc: 9.6, grip: 10.5 }, bus: { top: 24, acc: 2.6, grip: 6.0 },
};
// where the driver sits, per car type: metres ahead of the car's origin, to its left, and the height of the figure's origin (its feet
// when standing; the seated Drive pose drops the hips onto the cushion from there)
const SEAT = { sedan: [-0.05, 0.37, 0.12], taxi: [0.0, 0.37, 0.14], suv: [-0.05, 0.39, 0.28], van: [1.25, 0.5, 0.42], sport: [-0.42, 0.37, 0.02], bus: [4.9, 0.72, 0.5] };
const _o = {};

export class Vehicle {
  constructor(def, x, y, h, color) {
    Object.assign(this, { def, type: def.type, x, y, h, color, vx: 0, vy: 0, steer: 0, spin: 0, roll: 0, pitch: 0, z: 0, damage: 0, vf: 0, vs: 0, slip: 0, hitT: 0, yawV: 0, acc: 0 });
    this.spec = SPEC[def.type] || SPEC.sedan;
  }
  step(dt, inp, g) {
    const wgx = this.x, wgy = this.y, sp = this.spec, c = Math.cos(this.h), s = Math.sin(this.h);
    let vf = this.vx * c + this.vy * s, vs = this.vx * s - this.vy * c;   // forward, rightward
    const maxSteer = lerp(0.62, 0.10, clamp(Math.abs(vf) / 42, 0, 1) ** 0.7);
    this.steer += ((inp.lock !== undefined ? inp.lock : inp.steer * maxSteer) - this.steer) * Math.min(1, dt * (inp.lock !== undefined ? 26 : 7));     // inp.lock: the player's wheel angle in radians (readInput); traffic and the autopilot still give steer -1..1
    let acc = 0; const fc = fcOf(this, inp, g);     /* gameplay lane, Nov 18: quicker cars (move/fastcars.js; ?fastcars=0): fc is null for every car but the player's */
    if (inp.throttle > 0) acc += vf < -0.5 ? 16 * inp.throttle : fc ? fcDrive(fc, this, vf, inp.throttle) : inp.throttle * sp.acc * Math.max(0, 1 - (vf / sp.top) ** 2) * (vf < 8 ? 1.15 : 1);
    if (inp.brake > 0) { if (vf > 0.6) acc -= 15 * inp.brake; else acc -= inp.brake * sp.acc * 0.6 * Math.max(0, 1 + vf / 11); }
    acc -= fc ? fcDrag(fc, vf, inp.throttle, inp.brake) : 0.12 * vf + 0.0042 * vf * Math.abs(vf) + (inp.throttle === 0 && inp.brake === 0 ? Math.sign(vf) * 0.5 : 0);
    if (!g.statics.onRoadFast) { /* placeholder for surface */ }
    const onWalk = g.statics.onSidewalk(this.x, this.y);
    if (inp.handbrake) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 5.5);
    vf += acc * dt; this.acc = acc; this.braking = inp.brake > 0.03 || !!inp.handbrake;
    // tyres: sideways speed bleeds off with grip; the handbrake (or too much speed in a turn) lets the tail go
    const latDemand = Math.abs(vf * vf * Math.tan(this.steer) / this.def.wheelbase);
    let grip = sp.grip * (inp.handbrake ? 0.22 : inp.lock !== undefined ? 1.35 : 1);     /* the player's car holds its line a little harder (first outside feedback, Nov 11: "handling feels a bit floaty") */ { const lim = inp.latLim || 11; if (latDemand > lim) grip *= clamp(lim / latDemand, 0.45, 1); }
    const vs0 = vs; vs *= Math.exp(-grip * dt); this.slip = Math.abs(vs);
    let yaw = (vf * Math.tan(this.steer)) / this.def.wheelbase; if (inp.handbrake) yaw *= 1.45;
    this.yawV += (yaw - this.yawV) * Math.min(1, dt * (inp.lock !== undefined ? 20 : 12));
    const previousX = this.x, previousY = this.y, previousHeading = this.h;
    this.h = wrapPi(this.h + this.yawV * dt);
    this.vx = vf * c + vs * s; this.vy = vf * s - vs * c;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vf = vf; this.vs = vs;
    // body against walls, poles and parked cars: three circles down the length
    const L = this.def.len, r = this.def.wid * 0.5; let hit = 0, parkContact = false;
    for (const o of [L * 0.3, 0, -L * 0.3]) {
      const cx = this.x + Math.cos(this.h) * o, cy = this.y + Math.sin(this.h) * o;
      if (g.statics.resolve(cx, cy, r, _o)) {
        if (_o.parkContact || _o.tag === "tree") parkContact = true;
        const px = _o.x - cx, py = _o.y - cy; this.x += px; this.y += py;
        const vn = this.vx * _o.nx + this.vy * _o.ny;
        if (vn < 0) { this.vx -= vn * 1.25 * _o.nx; this.vy -= vn * 1.25 * _o.ny; const tx = -_o.ny, ty = _o.nx, vt = this.vx * tx + this.vy * ty; this.vx -= vt * 0.12 * tx; this.vy -= vt * 0.12 * ty;
          this.h = wrapPi(this.h + clamp((Math.cos(this.h) * _o.ny - Math.sin(this.h) * _o.nx) * o * vn * 0.012, -0.08, 0.08)); hit = Math.max(hit, -vn); }
      }
    }
    // Contact can rotate the sedan or move a circle that was already resolved.
    if (parkContact && g.P?.get('parkcol') !== '0') {
      let corrected = false;
      for (const o of [L * 0.3, 0, -L * 0.3]) {
        const cx = this.x + Math.cos(this.h) * o, cy = this.y + Math.sin(this.h) * o;
        if (g.statics.resolve(cx, cy, r, _o)) {
          corrected = true;
          this.x += _o.x - cx; this.y += _o.y - cy;
        }
      }
      // A rear correction can push the nose back into an opposing obstacle.
      if (corrected) {
        const overlaps = (x, y, heading) => {
          for (const offset of [L * 0.3, 0, -L * 0.3]) {
            const cx = x + Math.cos(heading) * offset, cy = y + Math.sin(heading) * offset;
            if (g.statics.resolve(cx, cy, r, _o) && _o.depth > 1e-6) return true;
          }
          return false;
        };
        if (overlaps(this.x, this.y, this.h) && !overlaps(previousX, previousY, previousHeading)) {
          this.x = previousX; this.y = previousY; this.h = previousHeading;
        }
      }
    }
    if (wetMove(g, wgx, wgy, this.x, this.y)) { this.x = wgx; this.y = wgy; this.vx = 0; this.vy = 0; g.wetStops = (g.wetStops || 0) + 1; }     // downtown lane: the shore guard (top of this file)
    if (hit > 2.5) { this.damage += hit; this.hitT = 0.35; g.onCrash(this, hit); }
    this.hitT = Math.max(0, this.hitT - dt);
    this.spin += (vf * dt) / this.def.radius;
    const tz = onWalk ? 0.15 : 0; this.z += (tz - this.z) * Math.min(1, dt * 14);
    const latA = vf * this.yawV;
    /* feedback lane, Nov 14 (players cedbe0 "car leans the wrong way during turns", e8e67b "tilts forward when the gas is pressed and backward when braking; it should be the
       other way around. Lateral tilt during turns is also reversed", 46a7a2, 82d27a "feels like a motorbike"): both signs were swapped. In the model's frame (x forward,
       y up, z right; Euler YZX) a positive roll tips the roof to the RIGHT and a positive pitch lifts the NOSE: a left turn (yawV > 0) must roll right, power must lift the nose. */
    this.roll += (clamp(latA * 0.0065, -0.07, 0.07) - this.roll) * Math.min(1, dt * 6);
    this.pitch += (clamp(acc * 0.0042, -0.045, 0.045) - this.pitch) * Math.min(1, dt * 6);
  }
}

export class Game {
  constructor(world, params) {
    /* ragdoll lane, handoff 320 (CHIEF 22:30 Nov 16: 'decide whether revised bodies go on after throw strength and prop contact are fixed'): the revised bodies are ON by default now (the merge lane's one line that set ragdoll2 to 0 stood here). A blind critic preferred them in 7 of 10 pairs after the fixes (lanes/ragdoll/handoff-320/README.md). ?ragdoll2=0 = the bodies as before */
    this.world = world; this.P = params; this.city = world.city; this.t = 0; this.frame = 0;
    /* gameplay/runmount, Nov 17 (Matt: "running should be faster"): the sprint is 7.0 m/s (was 5.4; a fit adult sprints 7-8). The run clip's rate follows the speed as before, so the feet hold the ground. ?runfast=0 = 5.4.
       Matt: "why do I mosey onto the motorcycle so slowly even though the cops are shooting at me": game.hot (wanted, or shot at / hurt in the last 4 s: pressed() below) hurries getting onto a bike (moto.js) and into a car (entry.rush, set in init). ?fastmount=0 = both as before */
    this.runSp = params && params.get && params.get('runfast') === '0' ? 5.4 : 7.0; this.fastMount = !(params && params.get && params.get('fastmount') === '0'); this.hot = false;
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: false, mx: 0, my: 0, run: false, use: false, lookX: 0, lookY: 0 };
    this.keys = new Set(); this.vehicles = []; this.focus = { x: 0, y: 0 };
    // tiles lane: the playable box need not sit round the origin once the map has more than one area (city.meta.play = [x0, y0, x1, y1]).
    // bounds.x / .y stay the half sizes, .cx / .cy the centre; bounds.in(x, y, m) = inside the box grown by m metres (m < 0 shrinks it).
    { const m = this.city.meta, pl = m.play || [-m.px, -m.py, m.px, m.py], b = { x: (pl[2] - pl[0]) / 2 - 6, y: (pl[3] - pl[1]) / 2 - 6, cx: (pl[0] + pl[2]) / 2, cy: (pl[1] + pl[3]) / 2 }; b.in = (x, y, k = 0) => Math.abs(x - b.cx) <= b.x + k && Math.abs(y - b.cy) <= b.y + k; this.bounds = b;
      /* downtown lane (helper game19): a downtown map whose areas do not fill its box (nineteen areas: rows C and D reach 600 m further west than the rows north of them, row D has
         no centre or east area). The parts of the box that belong to no area are HOLES: bounds.in() is false in them (grown as the box is shrunk) and each gets the same invisible
         wall as the map's edge (below). Everything that only wants the map's extent keeps the one box. A map whose areas fill the box (nine, fifteen) gets no holes; a map with
         no set named d<row>-<col> does not run this at all. ?holes=0 off. */
      const SS = (m.sets || []).filter((s) => s.play); if (SS.some((s) => /^d[A-D]-/.test(s.set || '') || (/^u\d/.test(s.set || '') && params.get('uholes') !== '0') /* lead, uptown-join (Nov 19): the uptown map's box has parts that are no area of its own too (Midtown's W 59th - 65th St corner south of its line, strips at its east and west sides): the same walls there, so nobody walks off the built map; ?uholes=0 = open as before */) && params.get('holes') !== '0') { const holes = [], uniq = (a) => { a.sort((p, q) => p - q); const o = []; for (const v of a) if (!o.length || v - o[o.length - 1] > 1) o.push(v); return o; };
        const X = uniq([pl[0], pl[2]].concat(...SS.map((s) => [s.play[0], s.play[2]]))), Y = uniq([pl[1], pl[3]].concat(...SS.map((s) => [s.play[1], s.play[3]])));
        for (let i = 0; i + 1 < X.length; i++) { let run = null; for (let j = 0; j + 1 < Y.length; j++) { const hx = (X[i] + X[i + 1]) / 2, hy = (Y[j] + Y[j + 1]) / 2;
            if (SS.some((s) => hx > s.play[0] && hx < s.play[2] && hy > s.play[1] && hy < s.play[3])) run = null; else if (run) run[3] = Y[j + 1]; else holes.push((run = [X[i], Y[j], X[i + 1], Y[j + 1]])); } }
        if (holes.length) { const in0 = b.in; b.holes = holes; b.in = (x, y, k = 0) => in0(x, y, k) && !holes.some((h) => x > h[0] - 6 + k && x < h[2] + 6 - k && y > h[1] - 6 + k && y < h[3] + 6 - k); } } }
    this.cam = { yaw: 0, pitch: 0.18, dist: 5, x: 0, y: 0, z: 2, fov: 55, shake: 0, mode: 'foot', lookT: 9 };
    this.demo = params.has('demo'); this.capture = params.has('capture'); this.cash = 0; this.paused = false;
  }

  async init() {
    const city = this.city, w = this.world;
    this.kit = new Kit(); await this.kit.load();
    this.roads = new Roads(city);
    // blocks that run along or beyond the edge of the playable map (there is an invisible wall there) are not for routes
    for (const e of this.roads.edges) e.out = e.pts.some((p) => !this.bounds.in(p[0], p[1], -9));
    const st = (this.statics = new StaticWorld(16));
    { const i = city.buildings.findIndex((b) => b.id === 100079 && b.kind === 'train_station'); if (i >= 0) city.buildings.splice(i, 1); }      /* gameplay/north, Nov 14, stop-gap: the outline of the underground Times Square subway station came in as an 80 m building across 7th Ave, 8th Ave, Broadway and W 40th-42nd St (lanes/gameplay/north-state/STATE.md); tiles to take it out of the data */
    for (const b of city.buildings) if (b.minh < 2.5) { st.addPoly(b.poly, 0, 'building'); for (const h of b.holes || []) st.addPoly(h, 0, 'building'); }
    // streets handoff-paved2 (with handoff-paved in streets/ground.js): a sidewalk polygon over 250,000 m2 is an area's fill, not a block. It counts as sidewalk only inside
    // its own area's region and off every street of the data (kerb to kerb), the way ground.js now draws it. ?pavedfix=0 = as before.
    { const pvOn = !(this.P && this.P.get('pavedfix') === '0'), sets = pvOn && city.meta && city.meta.sets && !(this.P && this.P.get('persets') === '0') ? setsOf(city) : null; let G = null;
      const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; };
      const grid = () => { if (G) return G; G = new Map(); for (const e of city.edges) { const h = (e.width || 9.6) / 2 - 0.05; for (let i = 1; i < e.pts.length; i++) { const A = e.pts[i - 1], B = e.pts[i], s = [A[0], A[1], B[0] - A[0], B[1] - A[1], h * h];
        for (let cx = Math.floor((Math.min(A[0], B[0]) - h) / 64); cx <= Math.floor((Math.max(A[0], B[0]) + h) / 64); cx++) for (let cy = Math.floor((Math.min(A[1], B[1]) - h) / 64); cy <= Math.floor((Math.max(A[1], B[1]) + h) / 64); cy++) { const k = cx * 100003 + cy; let a = G.get(k); if (!a) G.set(k, (a = [])); a.push(s); } } } return G; };
      let nBig = 0;
      for (const b of city.blocks) { let pv = null;
        if (pvOn && b.ext && b.ext.length > 2 && area(b.ext) > 2.5e5) { const S = sets && sets.find((q) => q.city.blocks.includes(b)), R = S ? S.region : null, g = grid(); nBig++;
          pv = (x, y) => { if (R && (x < R[0] || x > R[2] || y < R[1] || y > R[3])) return false; const a = g.get(Math.floor(x / 64) * 100003 + Math.floor(y / 64));
            if (a) for (const s of a) { const dx = x - s[0], dy = y - s[1], t = Math.max(0, Math.min(1, (dx * s[2] + dy * s[3]) / (s[2] * s[2] + s[3] * s[3] || 1e-9))), ex = dx - s[2] * t, ey = dy - s[3] * t; if (ex * ex + ey * ey < s[4]) return false; } return true; }; }
        st.addBlock(b, pv); }
      this.pavedStatics = { on: pvOn, big: nBig }; }
    // the edge of the map: an invisible wall
    const bx = this.bounds.x + 6, by = this.bounds.y + 6, ox = this.bounds.cx, oy = this.bounds.cy; st.addPoly([[ox - bx, oy - by], [ox + bx, oy - by], [ox + bx, oy + by], [ox - bx, oy + by]], 0, 'edge'); for (const h of this.bounds.holes || []) st.addPoly([[h[0], h[1]], [h[2], h[1]], [h[2], h[3]], [h[0], h[3]]], 0, 'edge');     /* downtown lane (helper game19): and round each part of the box that is no area's (above) */     /* 'edge': never low, the map edge stays closed (tags: geo.js addSeg) */
    // rooftop kit: water tanks and plant on mid-rise roofs
    const r = rng(5), extra = { watertower: [], ac: [] }, kitB = new Map();     /* facades lane: kitB = each roof unit's own building, for roofkit.js */
    for (const b of pier86Kit(city)) {     /* merge2 round 32: city.buildings, with the records pier86.js dropped back in their places for the random draws only (marked nokit) */
      if (b.part || b.minh > 0 || b.area < 180) continue; const nkW = extra.watertower.length, nkA = extra.ac.length;     /* uptown: a building a hand-built one replaces (city data key nokit) gets no roof tank or plant: they hung in the air over the lower model; the random draws are still made, so every other roof is as before */
      const cx = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length, cy = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length;
      if (b.h > 22 && b.h < 95 && b.style !== 2 && r() < 0.55) { extra.watertower.push([cx + (r() - 0.5) * 3, cy + (r() - 0.5) * 3, r() * TAU, 0.9 + r() * 0.3, b.h]); kitB.set(extra.watertower[extra.watertower.length - 1], b); }
      const n = b.area > 600 ? 3 : 1; for (let i = 0; i < n; i++) if (r() < 0.7) { extra.ac.push([cx + (r() - 0.5) * Math.sqrt(b.area) * 0.5, cy + (r() - 0.5) * Math.sqrt(b.area) * 0.5, city.meta.grid_deg * Math.PI / 180 + Math.PI / 2, 1 + r(), b.h]); kitB.set(extra.ac[extra.ac.length - 1], b); } if (b.nokit) { extra.watertower.length = nkW; extra.ac.length = nkA; }
    }
    extra.tree2 = []; city.props.tree = city.props.tree.filter((p) => { if (p[3] > 1.3) { extra.tree2.push([p[0], p[1], p[2], p[3] * 0.7]); return false; } return true; });
    for (const p of city.props.signal) { p[6] = Math.PI; }
    // a street light planted within a stride of a signal pole reads as a doubled pole: the signal keeps the corner
    /* tiles lane (helper cost 2), Nov 15: the signals near a light come from an 8 m grid (the nine cells round the light hold every signal within 3 m) instead of every signal of the city for every light: the same lights dropped. ?lightgrid=0 = every signal. */
    if (city.props.light && city.props.signal) { const SG = this.P && this.P.get('lightgrid') === '0' ? null : new Map(); if (SG) for (const p of city.props.signal) { const k = Math.floor(p[0] / 8) * 65536 + Math.floor(p[1] / 8); let a = SG.get(k); if (!a) SG.set(k, (a = [])); a.push(p); }
      const nearSig = (l) => { if (!SG) return city.props.signal.some((p) => Math.abs(p[0] - l[0]) < 3 && Math.abs(p[1] - l[1]) < 3 && Math.hypot(p[0] - l[0], p[1] - l[1]) < 3); const ci = Math.floor(l[0] / 8), cj = Math.floor(l[1] / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = SG.get(i * 65536 + j); if (a) for (const p of a) if (Math.abs(p[0] - l[0]) < 3 && Math.abs(p[1] - l[1]) < 3 && Math.hypot(p[0] - l[0], p[1] - l[1]) < 3) return true; } return false; };
      city.props.light = city.props.light.filter((l) => !nearSig(l)); }
    // street furniture that the map data left standing in a travel lane (medians and forks confuse the placement) is taken away:
    // a pole in the lane is a wall for the player and nothing the traffic knows about
    this.propsDropped = 0; for (const k of ['light', 'tree', 'signal', 'hydrant', 'bin', 'meter', 'newsbox']) if (city.props[k]) city.props[k] = city.props[k].filter((p) => { if (this.roads.inLane(p[0], p[1], 0.45)) { this.propsDropped++; return false; } return true; });
    for (const k of ['light', 'tree', 'signal', 'hydrant']) for (const p of city.props[k] || []) st.addCircle(p[0], p[1], k === 'tree' ? 0.22 : k === 'hydrant' ? 0.2 : 0.14, k);
    this.propMeshes = addProps(w.scene, this.kit, city, extra);
    /* facades lane, Nov 16 (Matt: 'a lot of radiators just like standing in the air'): roof plant and water tanks sit on the roof that is drawn under them, or are not drawn (src/roofkit.js). ?roofkit=0 = before */
    if (this.P.get('roofkit') !== '0') try { this.roofkit = (await import('./roofkit.js')).roofKit(this, kitB); } catch (e) { console.warn('[roofkit] not loaded: ' + (e && e.message)); }
    this.setupSignals();
    this.dressing = await (await lrImp(() => import('./dressing.js'), new URL('./dressing.js', import.meta.url))).addDressing(this);   // street dressing layer (pipeline/dressing)
    this.batches = {}; for (const t of CAR_TYPES) if (this.kit.cars[t]) this.batches[t] = new CarBatch(w.scene, this.kit.cars[t], t === 'bus' ? 16 : 340);
    this.parked = new Parked(this); this.traffic = new Traffic(this); this.peds = new Peds(this);
    // someone at the wheel of every car in traffic near the camera: seated figures baked from the Drive pose
    this.drivers = [];
    if (!this.P.has('nodrivers') && this.kit.person && this.kit.pedKinds) for (const k of this.kit.pedKinds().slice(0, 3)) { let parts = null; try { parts = bakeFigure(this.kit, k, 'drive'); } catch (e) { console.log('[game] no driver figure from ' + k + ': ' + e.message); } if (parts) { const fb = new FigureBatch(w.scene, parts, this.kit.peopleExport ? 8 : 36); fb.who = k; this.drivers.push(fb); } }
    this.hud = new Hud(this); this.sound = new Sound(this);
    const _sp = (this.P.get('spawn') || '').split(',').map(Number), _sx = _sp.length === 2 && isFinite(_sp[0]) && isFinite(_sp[1]) ? _sp : (w.startAt || [-196, -214]);     /* uptown: a map that names its own start (city.meta.spawn, read in world.js) starts there when the address gives none */     /* brooklyn lane: ?spawn=x,y (map metres) starts the player elsewhere: a set that does not touch the core yet */
    this.player = { x: _sx[0], y: _sx[1], h: 2.0, vehicle: null, speed: 0, vis: null, animT: 0, enterT: 0 };
    this.missions = new Missions(this);
    if (this.P.get('pedlooks') !== '0') try { (await import('./pedlooks.js')).install(this); } catch (e) { console.log('[pedlooks] not loaded: ' + (e && e.message)); }     // people lane: each close pedestrian body gets its own clothing colour, hair and skin tone (no more clones); ?pedlooks=0 = as before
    this.setupPlayer();
    this.autopilot = new Autopilot(this);
    this.focus.x = this.player.x; this.focus.y = this.player.y;
    this.traffic.populate(this.player.x, this.player.y);
    for (let i = 0; i < 44; i++) this.peds.spawn(this.player.x, this.player.y, true);
    this.cam.yaw = this.player.h; this.snapCamera();
    this.bindInput();
    this.fly = new Fly(this);
    if (this.P.get('menu') !== '0') try { (await import('./menu/menu.js')).install(this); } catch (e) { console.log('[menu] not loaded: ' + (e && (e.stack || e.message))); }     // progress lane: pause and settings menu (src/menu/: Esc / P / Start; game.settings, game.menu); ?menu=0 off (nothing fetched, P pauses as before)
    if (this.P.get('bus') !== '0') try { await (await import('./bus/bus.js')).install(this); } catch (e) { console.log('[bus] not loaded: ' + (e && (e.stack || e.message))); }     /* bus lane: the city buses (src/bus/): real routes and stops, ride and drive; ?bus=0 off (nothing fetched); merge2: Matt's link only, the public build has no buses unless ?bus=1 */
    if (this.P.get('park') !== '0' && (this.P.get('park') === '1' || this.P.get('parkdata') === 'test' || ((this.city && this.city.parks) || []).some((p) => p.name === 'Central Park'))) try { await (await import('./park/park.js')).init(this); } catch (e) { console.log('[game] park not loaded: ' + (e && (e.stack || e.message))); }     /* park lane: Central Park as its own layer (src/park/park.js): game.park, game.terrain; ?park=0 off */
    if (this.P.get('join') === '1') try { await (await import('./join.js')).cut(this); } catch (e) { console.log('[join] ring not cut: ' + (e && e.message)); }     /* lead, uptown-join (Nov 19): with ?join=1 the default map's streets layer does not build its far ring north of W 65th St (the joined areas bring their own ground: src/join.js cut()); nothing is fetched or changed without the switch */
    this.streets = this.P.get('streets') === 'none' ? null : await (await lrImp(() => import('./streets.js'), new URL('./streets.js', import.meta.url))).addStreets(this);
    // the people lane's crowd (hundreds of GPU-instanced walkers); with it on, the game's own heavy skinned pedestrians (about 0.3 ms each on the M2 Pro) drop to a handful near the player
    this.crowd = this.P.get('crowd') === 'none' ? null : await lrImp(() => import('./crowd.js'), new URL('./crowd.js', import.meta.url), { optional: true }).then((m) => m.addCrowd(this)).catch((e) => { console.log('[crowd] not loaded: ' + (e && e.message)); return null; });
    // people/near: standing scans of real people (assets/near). MATT'S PRIVATE LINK ONLY: never on the public build (window.__CFG.public, set by tools/public_build.sh, which also leaves near.js and assets/near out of the site). ?near=none off
    this.near = null; if (!(window.__CFG && window.__CFG.public) && this.P.get('near') !== 'none') try { this.near = await (await import('./near.js')).addNear(this); } catch (e) { console.log('[near] not loaded: ' + (e && (e.stack || e.message))); }
    if (this.crowd && !this.P.has('peds')) { this.peds.target = 14; while (this.peds.list.length > 14) { const q = this.peds.list.pop(); q.vis.used = false; q.vis.object.visible = false; } }
    if (this.P.has('peds')) { this.peds.target = +this.P.get('peds'); while (this.peds.list.length > this.peds.target) { const q = this.peds.list.pop(); q.vis.used = false; q.vis.object.visible = false; } }     // ?peds=0: nobody, from the first frame (the scene gauntlet's no-people captures)
    this.budget = new (await lrImp(() => import('./budget.js'), new URL('./budget.js', import.meta.url))).Budget(this);     // the streets lane's layer (ground, trees, furniture, storefronts, vehicles)
    // heli lane: the helicopter (src/heli/). ?heli=none leaves it out.
    this.heli = this.P.get('heli') === 'none' ? null : await (await import('./heli/heli.js')).addHeli(this).catch((e) => { console.log('[heli] not loaded: ' + (e && (e.stack || e.message))); return null; });
    try { (await import('./pedhit.js')).install(this); } catch (e) { console.log('[game] pedhit not loaded: ' + (e && e.message)); }     // item 14: pedestrian hits (ragdoll) from nyc-breakable; ?pedhit=0 off
    try { (await import('./props.js')).install(this); } catch (e) { console.log('[game] props not loaded: ' + (e && e.message)); }     // loose street props from nyc-breakable; ?props=0 off
    if (this.P.get('unstick') !== '0') try { (await import('./motion/unstick.js')).install(this); } catch (e) { console.warn('[motion] unstick not loaded', e); }     /* motion lane, Nov 12: a parked car the player's car touches comes loose and can be pushed (public report: stuck across a one-lane street) */
    try { (await import('./crash.js')).install(this); } catch (e) { console.log('[game] crash not loaded: ' + (e && e.message)); }     // car crash deformation v2 from nyc-breakable (crash.js 4d945bfd); ?crash=0 off
    try { (await import('./ram.js')).install(this); } catch (e) { console.log('[game] ram not loaded: ' + (e && e.message)); }     // rammed cars are thrown (breakable ram.js; ?ram=0)
    if (this.P.get('overhead') !== '0') try { (await import('./overhead.js')).install(this); } catch (e) { console.log('[overhead] not loaded: ' + (e && e.message)); }     /* lead/h-jump, Nov 14: game.statics.overhead, the list of what is over the sidewalk with underside heights (built on first use); ?overhead=0 off */
    if (this.P.get('handling') !== '0') try { (await import('./move/handling.js')).install(this, Vehicle); } catch (e) { console.log('[handling] not loaded: ' + (e && (e.stack || e.message))); }     /* gameplay lane, Nov 15 (19 player reports on car handling): the steering and grip of the car the player drives (src/move/handling.js). It must stay ABOVE the cars.js line: it wraps Vehicle.step first, cars.js wraps it. ?handling=0 off (nothing fetched; the car is the live one) */
    if (this.P.get('drift') !== '0') try { (await import('./move/drift.js')).install(this, Vehicle); } catch (e) { console.log('[drift] not loaded: ' + (e && (e.stack || e.message))); }     /* driving lane, Nov 16 (Matt, #nyc: 'It's hard to drift. Drifting should be satisfying and doable'): handbrake slides for the car the player drives, with smoke, skid marks and a camera swing (src/move/drift.js, driftfx.js). It must stay BELOW the handling.js line and ABOVE the cars.js line: it wraps handling's step, cars.js wraps it. ?drift=0 off (nothing fetched; the car is as before); ?driftfx=0 = no smoke, marks or camera swing */
    if (this.P.get('weight') !== '0') try { (await import('./move/weight.js')).install(this, Vehicle); } catch (e) { console.log('[weight] not loaded: ' + (e && (e.stack || e.message))); }     /* driving lane, Nov 17 (CHIEF 15:10; players: 'driving feels too floaty, no weight', 'car fishtails in back while turning'): the ordinary car's grip brought to a real car's (about 0.9 g for the sedan, was 2 g in town), front tyres that scrub speed when asked for more, the limit heard and seen, a calmer tail on the sports car (src/move/weight.js). It must stay BELOW the drift.js line and ABOVE the cars.js line. ?weight=0 off (nothing fetched; every car as before) */
    try { (await import('./move/footout.js')).install(this); } catch (e) { console.log('[footout] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane, Nov 19 (a public player: 'i climbed up a ladder into a building now i cant get out'): a player on foot who is walled in is offered 'F climb out' (move/footout.js; ?footout=0 = no prompt)
    if (this.P.get('footround') !== '0') try { (await import('./move/footround.js')).install(this); } catch (e) { console.log('[footround] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane, Nov 18 (Matt's trailer at 1:08, 'the player walks into a pole'): on foot he side-steps poles, hydrants, trunks and bins and is held out of benches, shelters and kiosks (src/move/footround.js; ?footround=0 = as before)
    if (this.P.get('jump') !== '0') try { (await import('./move/jump.js')).install(this); } catch (e) { console.log('[jump] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: jump on foot, Space / controller A (src/move/jump.js, jumpcore.js); ?jump=0 off (nothing fetched)
    if (this.P.get('grapple') !== '0') /* merge2 batch 34 (CHIEF 22:08 Nov 17): on by default on Matt's link too, as the public site has had it since Nov 16; ?grapple=0 off */ try { (await import('./move/grapple.js')).install(this); } catch (e) { console.log('[grapple] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: grappling hook, X on foot (src/move/grapple.js); default OFF, ?grapple=1 on (without it nothing is fetched)
    if (this.P.get('swing') === '1') try { (await import('./move/swing.js')).install(this); } catch (e) { console.log('[swing] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane, Nov 18: the swing line (move/swing.js); nothing is fetched without ?swing=1
    if (this.P.get('entry') !== '0') try { await (await import('./entry/entry.js')).addEntry(this); } catch (e) { console.log('[entry] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: real car entry and exit (door, seat, camera); ?entry=0 off
    if (this.fastMount && this.entry && this.P.get('efast') === null) this.entry.rush = () => (this.hot ? 2.5 : 2);     // gameplay/runmount: into a car at a run, the car his as he sits (entry.js's own fast path, which only police near or shooting used to set off): F to driving about 1 s from the door's side, was 2.5-3; under pressure a little quicker still. ?fastmount=0 or any ?efast= leaves entry.js to itself
    if (this.P.get('unwedge') !== '0') try { (await import('./combat/unwedge.js')).install(this); } catch (e) { console.log('[unwedge] not loaded: ' + (e && e.message)); }     /* gameplay lane, Nov 13 (public report 1b7ddd, car held by the invisible wall at the map's edge): the edge says so and turns the car round; a wedged car is set on the nearest clear lane; ?unwedge=0 off */
    if (this.P.get('edgeclose') !== '0') try { (await import('./edgeclose.js')).install(this); } catch (e) { console.log('[edgeclose] not loaded: ' + (e && e.message)); }     /* lead, Nov 13 (CHIEF 23:3xZ): road-closed barricades where roads meet the invisible wall at the map's edge; ?edgeclose=0 off */
    if (this.P.get('join') === '1') try { (await import('./join.js')).install(this); } catch (e) { console.log('[join] not loaded: ' + (e && e.message)); }     /* lead, uptown-join (Nov 19): ?join=1 = uptown's first row (to about W 82nd St) joins the default map when the player nears W 65th St: roads, walls, traffic and buildings, fetched then and not before; without the switch nothing is loaded or changed */
    if (this.P.get('rain') !== 'off') try { (await import('./sky/rain.js')).install(this); } catch (e) { console.log('[rain] not loaded: ' + (e && e.message)); }     // progress lane: rain and wet roads (src/sky/rain.js); Y or ?rain=1 rains; ?rain=off never fetched
    if (this.P.get('flashlight') !== '0') try { (await import('./flashlight.js')).install(this); } catch (e) { console.log('[flashlight] not loaded: ' + (e && e.message)); }     /* light lane hand-off 25 (23 re-cut): a phone torch on foot, Z (src/flashlight.js); nothing is built before the first press; ?flashlight=0 never fetched */
    if (this.P.get('tier') !== 'off') try { (await import('./lowtier.js')).install(this); } catch (e) { console.log('[tier] not loaded: ' + (e && e.message)); }     /* light lane, Nov 17 (CHIEF 06:34): a tier below the governor's floor for machines still under 30 fps there (src/lowtier.js); ?tier=low forces it, ?tier=high pins full quality, ?tier=off = this file never fetched */
    if (this.P.get('carrierlights') !== '0' && this.P.get('lm') !== '0') try { (await import('./sky/carrierlights.js')).install(this); } catch (e) { console.log('[game] carrier lights not loaded: ' + (e && e.message)); }     /* light lane, Nov 17 (CHIEF 06:34): deck and island lights on the aircraft carrier at Pier 86 at night (src/sky/carrierlights.js); ?carrierlights=0 never fetched */
    if (this.P.get('night') !== '0') try { (await import('./sky/night.js')).install(this); } catch (e) { console.log('[night] not loaded: ' + (e && e.message)); }     // progress lane: time of day and night (src/sky/); N steps the clock, ?tod=22 sets it; ?night=0 off
    if (this.P.get('radio') !== '0') try { (await import('./radio/radio.js')).install(this); } catch (e) { console.log('[radio] not loaded: ' + (e && e.message)); }     // progress lane: car radio, invented stations, music made by code (src/radio/); . and , change station in a car; ?radio=0 off
    if (this.park) try { await (await import('./park/park.js')).start(this); } catch (e) { console.log('[game] park not started: ' + (e && (e.stack || e.message))); }     /* park lane: relief hook and chunk loader */
    if (this.P.get('subway') !== '0') try { await (await import('./subway/subway.js')).install(this); } catch (e) { console.log('[subway] not loaded: ' + (e && (e.stack || e.message))); }     /* subway lane: entrances, stations and trains (src/subway/); ?subway=0 off (nothing fetched) */
    if (this.P.get('surprises') !== '0') try { await (await import('./surprises/index.js')).install(this); } catch (e) { console.log('[surprises] not loaded: ' + (e && (e.stack || e.message))); }     // surprises lane: hidden New York moments (src/surprises/; ?surprises=0 off)
    try { (await import('./feedback.js')).install(this); } catch (e) { console.log('[game] feedback not loaded: ' + (e && e.message)); }     // lead: Feedback link + session trace (src/feedback.js)
    if (this.P.get('cars') !== '0') try { (await import('./cars/cars.js')).install(this); } catch (e) { console.log('[cars] not loaded: ' + (e && (e.stack || e.message))); }     /* progress lane, Nov 14: each kind of car drives differently; damage carries through to a burnt wreck (src/cars/cars.js); ?cars=0 off */
    try { fcInstall(this, Vehicle); } catch (e) { console.log('[fastcars] not loaded: ' + (e && e.message)); }     /* gameplay lane, Nov 18: quicker cars with real top speeds (src/move/fastcars.js: the pull and drag asked for in Vehicle.step above, and a fast car stepped in pieces); ?fastcars=0 off */
    try { (await import('./padui.js')).install(this); } catch (e) { console.log('[padui] not loaded: ' + (e && e.message)); }     /* gameplay lane, Nov 17 (Matt: "If I'm using a controller, show the controller controls"): prompts follow the last input (keys or the pad's own button names), pad buttons for the hook, flashlight, map and full screen, and a corner full-screen button (src/padui.js); ?padui=0 = prompts as before, ?padbtn=0 = no new pad buttons, ?fsbtn=0 = no corner button */
    try { (await import('./horn.js')).install(this); } catch (e) { console.log('[horn] not loaded: ' + (e && e.message)); }     /* gameplay lane, Nov 18 (CHIEF's list): the horn at the wheel, G or L3; traffic ahead moves over, people in the road clear; ?horn=0 */
    if (this.P.get('runhint') !== '0') try { (await import('./runhint.js')).install(this); } catch (e) { console.log('[runhint] not loaded: ' + (e && e.message)); }     /* progress lane, Nov 15: says "Hold SHIFT to run" in play to a player who has walked 8 s and never run (three players never found it); ?runhint=0 off */
    /* facades lane, Nov 17: the far skyline beyond this map's own box (src/skyline.js), built after the game is ready so the load does not pay for it. ?skyline=0 = off */
    if (this.P.get('skyline') !== '0') { const go = () => { if (!window.__ready && !window.__error) { setTimeout(go, 500); return; } import('./skyline.js').then((m) => m.addSkyline(this)).then((S) => { this.skyline = S; }).catch((e) => console.log('[skyline] not loaded: ' + (e && e.message))); }; setTimeout(go, 1500); }
    if (this.P.get('hints') !== '0') try { (await import('./hints.js')).install(this); } catch (e) { console.log('[hints] not loaded: ' + (e && e.message)); }     /* progress lane, Nov 15: one line in play for what a new player must find (get in a car, the helicopter, the subway stairs, the menu, the map, feedback), each when the need is seen, twice at most, never after he has done it; shares runhint's place, never with it; ?hints=0 off */
    if (!/^(0|none|off)$/.test(this.P.get('guns') || '')) try { this.combat = await (await import('./combat/combat.js')).addCombat(this); } catch (e) { console.log('[guns] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: guns v1 (src/combat/, pistol and rifle); ?guns=0 off (nothing fetched)
    if (this.P.get('mbricks') !== '0') try { this.mbtrans = await (await import('./move/mbtrans.js')).addMbTrans(this); } catch (e) { console.log('[mbricks] transitions not loaded: ' + (e && e.message)); }     /* motionbricks lane: MotionBricks starts, stops and turns for the player (?mbtrans=0 = loops only) */
    if (this.P.get('ems') !== '0') try { (await import('./ems/ems.js')).install(this); } catch (e) { console.log('[ems] not loaded: ' + (e && (e.stack || e.message))); }     /* gameplay lane (built by the progress lane): an ambulance or a fire truck after a person is struck, a car fire or a wreck (src/ems/ems.js); ?ems=0 off (nothing fetched, nothing wrapped) */
    if (this.P.get('moto') !== '0') import('./moto/moto.js').then((m) => m.install(this)).catch((e) => console.log('[moto] not loaded: ' + (e && (e.stack || e.message))));     // gameplay lane: the motorcycle (src/moto/: moto.js, motophys.js, motomodel.js); ?moto=0 off (nothing fetched)
    if (this.P.get('riders') !== '0') import('./riders/riders.js').then((m) => m.install(this)).catch((e) => console.log('[riders] not loaded: ' + (e && (e.stack || e.message))));     // people lane: delivery riders on e-bikes (src/riders/); ?riders=0 off
    if (this.P.get('water') !== '0') import('./water/install.js').then((m) => m.install(this)).catch((e) => console.log('[water] not loaded: ' + (e && (e.stack || e.message))));     // water lane: the rivers' waves, boats to take at the piers, other boats on routes (src/water/); ?water=0 off (nothing fetched, the tiles lane's water as before)
    const _bk = ((this.city.meta && this.city.meta.sets) || []).some((s) => s.set === 'dumbo'), _pub = !!(window.__CFG && window.__CFG.public), _bkOn = (k) => (this.P.get(k) === '1' || (_bk && this.P.get(k) !== '0'));     /* merge lane, Nov 16: brooklyn's hand-over is for Matt's link only: the public build fetches none of its modules (the cola sign there only with ?colasign=1) */     // brooklyn lane: the two bridges and the raised decks are on by default only on a map that holds the 'dumbo' set (the ordinary map: nothing built, nothing fetched); ?bbridge=1 / ?mbridge=1 / ?decks=1 force them on any map
    if (this.P.get('tsq') !== '0' && this.P.get('lm') !== '0') import('./hero/timessquare.js').then((m) => m.install(this)).catch((e) => console.log('[tsq] not loaded: ' + (e && (e.stack || e.message))));     // landmarks lane: Times Square's lit signs (src/hero/timessquare.js; nothing built on a map without One Times Square; ?tsq=0 off, ?lm=0 off)
    if (this.P.get('farhole') !== '0' && this.P.get('lm') !== '0') import('./hero/farhole.js').then((m) => m.install(this)).catch((e) => console.log('[farhole] not loaded: ' + (e && (e.stack || e.message))));     // landmarks lane: the far city's coarse block is taken out where a landmark model stands (src/hero/farhole.js; ?farhole=0 off, ?lm=0 off)
    if (this.P.get('lmnight') !== '0' && this.P.get('lm') !== '0') import('./hero/lmnight.js').then((m) => m.install(this)).catch((e) => console.log('[lmnight] not loaded: ' + (e && (e.stack || e.message))));     // landmarks lane: the landmark models' windows and stone glow as night comes on (src/hero/lmnight.js: St Patrick's and the stair tower; ?lmnight=0 off, ?lm=0 off)
    if (this.P.get('colasign') !== '0') import('./hero/colasign.js').then((m) => m.install(this)).catch((e) => console.log('[colasign] not loaded: ' + (e && e.message)));     // brooklyn lane: the fake-brand cola sign on the LIC waterfront (nothing on a map without an 'East River' water entry; ?colasign=0 off)
    if (!_pub && this.P.get('setts') !== '0') import('./hero/setts.js').then((m) => m.install(this)).catch((e) => console.log('[setts] not loaded: ' + (e && (e.stack || e.message))));     // brooklyn lane: DUMBO's Belgian-block streets (src/hero/setts.js; nothing built or fetched on a map without those streets; ?setts=0 off)
    if (_bkOn('bbridge')) import('./hero/brooklynbridge.js').then((m) => m.install(this)).catch((e) => console.log('[bbridge] not loaded: ' + (e && (e.stack || e.message))));     // brooklyn lane: the Brooklyn Bridge (src/hero/brooklynbridge.js; built when the camera is within 4 km of it; ?bbridge=0 off)
    if (_bkOn('mbridge')) import('./hero/manhattanbridge.js').then((m) => m.install(this)).catch((e) => console.log('[mbridge] not loaded: ' + (e && (e.stack || e.message))));     // brooklyn lane: the Manhattan Bridge (src/hero/manhattanbridge.js; built when the camera is within 4 km of it; ?mbridge=0 off)
    if (!_pub && this.P.get('lofts') !== '0') import('./hero/dumbolofts.js').then((m) => m.install(this)).catch((e) => console.log('[lofts] not loaded: ' + (e && (e.stack || e.message))));     // brooklyn lane: the Washington St lofts and brick warehouses in DUMBO by hand (src/hero/dumbolofts.js; nothing built on a map without those building ids; ?lofts=0 off)
    if (!_pub && this.P.get('carousel') !== '0') import('./hero/carousel.js').then((m) => m.install(this)).catch((e) => console.log('[carousel] not loaded: ' + (e && (e.stack || e.message))));     // brooklyn lane: the glass carousel pavilion on the DUMBO waterfront and the park round it (src/hero/carousel.js; nothing built on a map without building 2000059; ?carousel=0 off)
    if (this.P.get('gps') !== '0') try { (await import('./gps/gps.js')).install(this); } catch (e) { console.log('[gps] not loaded: ' + (e && (e.stack || e.message))); }     // progress lane: GPS (src/gps/: waypoint from the full-screen map, route line on the road and the maps); ?gps=0 off (nothing fetched)
    if (this.P.get('finds') !== '0') import('./finds.js').then((m) => m.install(this)).catch((e) => console.log('[finds] not loaded: ' + (e && (e.stack || e.message))));     // gameplay lane, Nov 18: things to find on the map (src/finds.js + finds-data.js: ammo boxes, gun cases, special vehicles, the helicopter's pin; found state per map in localStorage); ?finds=0 off (nothing fetched)
    if (!((!_pub && this.P.get('decks') === 'test') || _bkOn('decks')) && this.P.get('decks') !== '0' && this.P.get('pfsteps') !== '0' && this.P.get('penn') !== '0' && this.P.get('hero') !== '0') try { await (await import('./decks/decks.js')).install(this, (this.P.get('lm') === '0' || this.P.get('board') === '0') ? 'decks-penn.json' : ['decks-penn.json', 'decks-carrier.json'] /* landmarks lane, Nov 18: the carrier at Pier 86 can be boarded (assets/decks/decks-carrier.json: a gangway and the flight deck; ?board=0 or ?lm=0 = as before) */); } catch (e) { console.log('[decks] penn steps not loaded: ' + (e && (e.stack || e.message))); }     /* penn lane, Nov 17: the post office steps on 8th Avenue can be climbed (two walk decks, assets/decks/decks-penn.json; ?pfsteps=0 off) */
    if ((!_pub && this.P.get('decks') === 'test') || _bkOn('decks')) try { await (await import('./decks/decks.js')).install(this); } catch (e) { console.log('[decks] not loaded: ' + (e && (e.stack || e.message))); }     // brooklyn lane: raised roadways (src/decks/; assets/decks/decks.json; ?decks=0 off, ?deckdebug=1 grey slabs)
  }

  setupSignals() {
    // The lit lamp of every signal head: a bright disc just proud of the lens, with a soft halo so it reads as lit from down the
    // block, one per head (the prop has three heads: two on the mast arm, one on the pole). Lens centres measured from prop_signal in
    // models.glb: x 0.129 (lenses face +X), z 5.6 / 2.6 / -0.32, red at y 5.965 on the arm and 3.945 on the pole, yellow 0.345 below
    // red, green 0.69 below. The unlit lenses are darkened in models.js so that only the lit one looks lit.
    const HEADS = [[5.6, 5.965], [2.6, 5.965], [-0.32, 3.945]], DROP = { r: 0, y: 0.345, g: 0.69 }, COL = { r: [1.75, 0.10, 0.05], y: [1.7, 0.95, 0.06], g: [0.06, 1.45, 0.62] };   // in daylight a lit lens is a bright colour, not a light source: kept under the bloom threshold (2.5) so it has no halo
    const geo = new THREE.CircleGeometry(0.128, 18); geo.rotateY(Math.PI / 2);
    const glow = new THREE.CircleGeometry(0.3, 18); glow.rotateY(Math.PI / 2);
    const list = this.city.props.signal || [], n = Math.max(1, list.length * 3);
    const L = (this.sigLamps = { list, state: new Array(list.length).fill(''), base: { r: [], y: [], g: [] }, halo: {} });
    for (const k of ['r', 'y', 'g']) {
      const c = new THREE.Color(...COL[k]);
      L[k] = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }), n);
      L.halo[k] = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.05), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), n);
    }
    const M = new THREE.Matrix4(), T = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), hide = new THREE.Matrix4().makeScale(0, 0, 0);
    list.forEach((p, i) => {
      e.set(0, p[2] + (p[6] || 0), 0); q.setFromEuler(e); v.set(p[0], p[7] || 0.15, -p[1]); sc.setScalar(p[3] || 1); M.compose(v, q, sc);   // as addProps places the prop
      for (const k of ['r', 'y', 'g']) HEADS.forEach((h, j) => { T.makeTranslation(0.129 + 0.014, h[1] - DROP[k], h[0]); L.base[k][i * 3 + j] = new THREE.Matrix4().multiplyMatrices(M, T); L[k].setMatrixAt(i * 3 + j, hide); L.halo[k].setMatrixAt(i * 3 + j, hide); });
    });
    for (const k of ['r', 'y', 'g']) for (const im of [L[k], L.halo[k]]) { im.frustumCulled = false; im.matrixAutoUpdate = false; this.world.scene.add(im); }
    this.sigHide = hide; this.sigT = 0;
  }
  updateSignals() {
    const L = this.sigLamps; let dirty = false;
    L.list.forEach((p, i) => {
      const st = this.roads.signal(p[4], { ave: p[5] === 1 }, this.t); if (st === L.state[i]) return; L.state[i] = st; dirty = true;
      for (const k of ['r', 'y', 'g']) for (let j = 0; j < 3; j++) { const m = k === st ? L.base[k][i * 3 + j] : this.sigHide; L[k].setMatrixAt(i * 3 + j, m); L.halo[k].setMatrixAt(i * 3 + j, m); }
    });
    if (dirty) for (const k of ['r', 'y', 'g']) { L[k].instanceMatrix.needsUpdate = true; L.halo[k].instanceMatrix.needsUpdate = true; }
  }

  setupPlayer() {
    const p = this.kit.person('player');
    if (p) { this.player.vis = p; this.world.scene.add(p.object); }
    else { const o = new THREE.Group(); const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.85 })); b.position.y = 1.08; b.castShadow = true;
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.62, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1c2533, roughness: 0.9 })); l.position.y = 0.46; l.castShadow = true;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0xb98f72, roughness: 0.7 })); h.position.y = 1.72; h.castShadow = true; o.add(b, l, h);
      this.player.vis = { object: o, mixer: null, acts: {} }; this.world.scene.add(o); }
  }
  playerAnim(name) { const v = this.player.vis; if (!v.mixer || v.cur === name || !v.acts[name]) return; if (v.cur) v.acts[v.cur].fadeOut(0.15); v.acts[name].reset().fadeIn(0.15).play(); v.cur = name; }

  bindInput() {
    const K = this.keys;
    addEventListener('keydown', (e) => { if (e.repeat) return; if (!this.look || !this.look.key(e)) K.add(e.code);     /* input, Nov 13: while the browser refuses to capture the mouse the arrow keys turn the camera (look.js) */ if (e.code === 'KeyF' || e.code === 'Enter') this.input.use = true; if (e.code === 'KeyP') this.paused = !this.paused; if (e.code === 'KeyM') this.sound.toggle(); this.sound.unlock(); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => K.delete(e.code));
    const c = this.world.renderer.domElement;
    /* input, Nov 13 (player report 1de458: 19 uncaught 'UnknownError' rejections, the mouse never captured): every request for the mouse goes through look.js, which catches each refusal, tries the other kind of request, waits out Chrome's 1.25 s after an exit, and puts up "Click to look" while the mouse is not captured */
    this.look = new LookCtl(this, c);
    c.addEventListener('click', () => { this.sound.unlock(); if (!this.demo || this.fly.on) this.look.ask('click'); });
    // Matt 18:10: the mouse must be clearly free to look. It looks around whether or not the pointer is captured, and the first movement key
    // captures it (before, only a click on the picture did, so with no click the mouse did nothing).
    addEventListener('mousemove', (e) => { const ui = document.getElementById('fbbox'); if (document.pointerLockElement === c || (!this.demo && document.hasFocus() && !(ui && ui.style.display !== 'none') && !window.__startScreen)) {     /* not while the feedback form is open: moving to Send turned the camera (public note, Nov 11) */ const s = this.lookS;     /* progress lane: mouse sensitivity and invert (src/menu/) */ this.input.lookX += e.movementX * (s ? s.x : 1); this.input.lookY += e.movementY * (s ? s.y : 1); } });
    addEventListener('keydown', (e) => { if (!e.repeat && /^(Key[WASD]|Arrow)/.test(e.code) && !this.demo && document.pointerLockElement !== c && !(e.target && e.target.closest && e.target.closest('#fbbox')) && !(this.gps && this.gps.mapOpen && this.gps.mapOpen() && !(this.P && this.P.get('mapwalk') === '0'))) this.look.ask('key'); });     /* gameplay/input i3: not while the full map is up (the cursor is the map's: a walk key took it away until the map was reopened). ?mapwalk=0 = before */
    addEventListener('blur', () => K.clear());
  }
  readInput() {
    const K = this.keys, I = this.input; const ax = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0);
    // Controller (public feedback Nov 11, Xbox pad on Ubuntu: "the controller is not responding"): the game only ever looked at pad slot 0, which is
    // empty on many machines (Linux and Windows hand out other slots), and read buttons that some pads do not have. It now takes the first
    // connected pad that has sticks and triggers (the "standard" layout if there is one) and reads every button safely.
    let gp = null; try { const all = navigator.getGamepads ? navigator.getGamepads() : []; for (const q of all) if (q && q.connected && q.axes.length >= 2 && q.buttons.length >= 4 && (!gp || (q.mapping === 'standard' && gp.mapping !== 'standard'))) gp = q; } catch (e) {}
    const farePadIndex = gp ? gp.index : null;
    if (gp) { const bt = gp.buttons, B = (i) => (bt[i] ? (typeof bt[i].value === 'number' ? Math.max(bt[i].value, bt[i].pressed ? 1 : 0) : bt[i].pressed ? 1 : 0) : 0), std = gp.mapping === 'standard' || bt.length >= 16;
      gp = { axes: [gp.axes[0] || 0, gp.axes[1] || 0, std ? gp.axes[2] || 0 : gp.axes[3] || 0, std ? gp.axes[3] || 0 : gp.axes[4] || 0], buttons: Array.from({ length: 17 }, (_, i) => ({ value: std ? B(i) : i === 7 ? Math.max(B(7), ((gp.axes[5] ?? -1) + 1) / 2) : i === 6 ? Math.max(B(6), ((gp.axes[2] ?? -1) + 1) / 2) : B(i), pressed: B(i) > 0.5 })) };
      if (!this._padSeen) { this._padSeen = 1; try { const d = document.createElement('div'); d.textContent = 'Controller on: left stick steer and walk · right stick look · RT gas · LT brake · A jump on foot, handbrake in a car · Y get in or out'; d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:55;font:13px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.8);padding:7px 14px;border-radius:8px;transition:opacity 1s'; document.body.appendChild(d); setTimeout(() => { d.style.opacity = 0; }, 7000); setTimeout(() => d.remove(), 8200); } catch (e) {} } }
    // A reader may accept a newly connected pad without triggering vehicle use.
    I.fareReconnect = !!(gp && this._farePadIndex !== farePadIndex && gp.buttons[3].pressed);
    this._farePadIndex = farePadIndex;
    I.steer = clamp(ax('KeyA', 'KeyD') + ax('ArrowLeft', 'ArrowRight') - (gp ? (Math.abs(gp.axes[0]) > 0.12 ? gp.axes[0] : 0) : 0), -1, 1);
    I.throttle = clamp((K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) + (gp ? gp.buttons[7].value : 0), 0, 1); I.brake = clamp((K.has('KeyS') || K.has('ArrowDown') ? 1 : 0) + (gp ? gp.buttons[6].value : 0), 0, 1);
    I.handbrake = K.has('Space') || !!(gp && gp.buttons[0].pressed); I.run = K.has('ShiftLeft') || K.has('ShiftRight');
    I.mx = I.steer; I.my = ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown');
    if (gp) { if (Math.abs(gp.axes[1]) > 0.15) I.my = clamp(I.my - gp.axes[1], -1, 1); if (Math.abs(gp.axes[2]) > 0.12) I.lookX += gp.axes[2] * 14 * (this.lookS ? this.lookS.px : 1); if (Math.abs(gp.axes[3]) > 0.15) I.lookY += gp.axes[3] * 9 * (this.lookS ? this.lookS.py : 1); I.run = I.run || gp.buttons[10].pressed; if (gp.buttons[3].pressed && !this._gpUse) I.use = true; this._gpUse = gp.buttons[3].pressed; }
    // Steering (Matt, Nov 10: "steering the car is so hard"; fix from nyc-breakable). A held key asked for a lock that at 70 km/h meant several g
    // sideways, so the tyres let go and the car spun. Now the lock a full press may ask for is what the tyres hold at that speed (about 0.6 g; x1.6 with
    // the handbrake), it comes on smoothly and centres quickly, and with the mouse captured the mouse steers too (the camera follows the car by itself).
    const v = this.player.vehicle;
    if (v && !(this.fly && this.fly.on) && !this.P.has('oldsteer') && !this.demo) {
      // Matt, Nov 10 17:50: "turning is so slow, and i can't look around while driving anymore". The mouse no longer steers: it looks around, and the
      // camera eases back behind the car 1.5 s after the mouse stops (updateCamera). Keys turn the wheel to an angle set by speed: full lock (0.70 rad)
      // in town, and above that as much as the tyres hold: 20 m/s2 sideways up to 32 km/h (a 90 degree corner in one short press), easing to
      // 10.5 m/s2 above 72 km/h (steady in a weave). The car's own grip limit is raised to match (latLim), so the tight turn does not slide.
      const dt = DT; let sm = this._sSteer || 0;
      const want = clamp(I.steer, -1, 1), rate = Math.abs(want) < Math.abs(sm) || want * sm < 0 ? 30 : 20;     /* Nov 11: the key reaches full lock in 50 ms (was 83), the wheel and the car's turn follow about twice as fast: three smoothing stages added up to about a quarter second of "input delay" */ sm += clamp(want - sm, -rate * dt, rate * dt);
      const vf = Math.abs(v.vf || 0), wb = v.def.wheelbase || 2.7, aLat = vf < 9 ? 20 : vf > 20 ? 10.5 : 20 - 9.5 * (vf - 9) / 11;
      I.lock = sm * Math.min(0.70, Math.atan(aLat * wb / Math.max(vf * vf, 6))) * (I.handbrake ? 1.5 : 1); I.latLim = aLat + 1.5; this._sSteer = sm;
    } else { this._sSteer = 0; I.lock = undefined; I.latLim = 0; }
  }

  // ------------------------------------------------------------------ the fixed step
  step(dt) {
    const pl = this.player, I = this.input;
    this.t += dt; this.frame++; if (this.fastMount) this.hot = this.pressed();
    if (this.demo) this.autopilot.drive(dt, I); else { this.readInput(); this.look.update(dt, I); }
    if (this.fly.on) {   // flying: the look goes to the fly camera; a human player's character stands still (the autopilot keeps playing)
      this.fly.look(I.lookX, I.lookY); I.lookX = I.lookY = 0;
      if (!this.demo) { I.lock = undefined; I.steer = 0; I.throttle = 0; I.brake = pl.vehicle ? 1 : 0; I.handbrake = false; I.mx = 0; I.my = 0; I.run = false; I.use = false; }
    }
    const heli = this.heli; if (heli && heli.hasCamera && !this.fly.on) heli.look(I);     // heli lane: the mouse belongs to the helicopter while you fly it
    if (I.lookX || I.lookY) { this.cam.yaw -= I.lookX * 0.0028; this.cam.pitch = clamp(this.cam.pitch + I.lookY * 0.002, -0.25 - 1.42, 1.1);   /* Matt, Nov 10: "i can't look up lol it stops me". Past the orbit's low stop (-0.25) the view itself tilts up, to about +80 degrees (placeCamera); fix from nyc-breakable */ this.cam.lookT = 0; I.lookX = I.lookY = 0; }
    this.cam.lookT += dt;

    if (heli) { try { heli.step(dt, I); } catch (e) { if (!this._heliErr) { this._heliErr = 1; console.warn('[heli] step: ' + (e && e.stack || e)); } } }     // lead: a fault in the helicopter must not stop the rest of the game step
    if (heli && (heli.piloted || heli.busy)) { /* heli lane: flying, or climbing in or out: the helicopter moves the player */ }
    else if (pl.vehicle) {
      const v = pl.vehicle; v.step(dt, I, this);
      this.collideCars(v);
      pl.x = v.x; pl.y = v.y; pl.h = v.h;
      if (I.use && Math.hypot(v.vx, v.vy) < 3) this.exitVehicle(); else if (I.use && this.entry && this.entry.bail) this.entry.bail(v);      /* board/car: F at speed = bail out of the moving car (entry.js; ?ebail=0) */
    } else if (pl.busy) { this.stepBusy(dt); }
    else {
      // on foot: move relative to the camera
      const mx = I.mx, my = I.my, m = Math.hypot(mx, my);
      let sp = 0;
      if (m > 0.1) {
        sp = (I.run ? this.runSp : 1.9) * Math.min(1, m); const fr = this.footround;
        const a = fr ? fr.steer(pl, this.cam.yaw + Math.atan2(mx, my), sp, dt) : this.cam.yaw + Math.atan2(mx, my);    // forward = camera yaw; A (mx=+1) is left   (gameplay footround: the heading asked for, turned a little to pass a pole, a hydrant, a trunk or a bin on his course; move/footround.js)
        pl.h += wrapPi(a - pl.h) * Math.min(1, dt * 10);
        const nx = pl.x + Math.cos(pl.h) * sp * dt, ny = pl.y + Math.sin(pl.h) * sp * dt; this.statics.resolve(nx, ny, 0.34, _o); if (fr) fr.push(pl, _o);     /* gameplay footround: benches, shelters, kiosks, planters and the rest of the street layer's furniture hold him out */ if (wetMove(this, pl.x, pl.y, _o.x, _o.y)) this.wetStops = (this.wetStops || 0) + 1;     /* downtown lane: the shore guard */ else { pl.x = _o.x; pl.y = _o.y; }
        for (const c of this.traffic.cars) { const dx = pl.x - c.x, dy = pl.y - c.y, d = Math.hypot(dx, dy), R = 1.4; if (d < R && d > 1e-3) { pl.x += (dx / d) * (R - d); pl.y += (dy / d) * (R - d); } }
        for (const c of this.vehicles) { const dx = pl.x - c.x, dy = pl.y - c.y, d = Math.hypot(dx, dy), R = 1.3; if (d < R && d > 1e-3) { pl.x += (dx / d) * (R - d); pl.y += (dy / d) * (R - d); } }
      }
      const vis = pl.vis, wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 };   // the player walks briskly
      pl.speed = sp; this.playerAnim(sp > 3 ? 'run' : sp > 0.2 ? wk.name : 'idle');
      if (vis.mixer) vis.mixer.timeScale = sp > 3 ? sp / (vis.runSpeed || 5.0) : sp > 0.2 ? sp / wk.speed : 1;
      if (this._take) this.stepTake(dt);
      if (I.use && !(heli && heli.tryBoard()) && !this.takeRolling()) this.tryEnter();
    }
    I.use = false;
    for (const v of this.vehicles) if (v !== pl.vehicle) { v.step(dt, { steer: 0, throttle: 0, brake: 0, handbrake: true }, this); }     // a car nobody is driving stands on its handbrake (the brake pedal is reverse at a standstill)
    this.focus.x = pl.x; this.focus.y = pl.y;
    if (this.fly.on) { this.focus.x = clamp(this.fly.x, this.bounds.cx - this.bounds.x, this.bounds.cx + this.bounds.x); this.focus.y = clamp(this.fly.y, this.bounds.cy - this.bounds.y, this.bounds.cy + this.bounds.y); }     // the street life follows the eye
    this.traffic.step(dt, this.t); if (!pl.vehicle && !pl.busy && !(this.heli && (this.heli.piloted || this.heli.busy)) && !(this.fly && this.fly.on)) this.traffic.pushPlayer(pl); this.peds.step(dt); this.missions.step(dt);
    this.sigT -= dt; if (this.sigT <= 0) { this.sigT = 0.2; this.updateSignals(); }
    this.updateCamera(dt);
    this.sound.update(dt);
  }

  // gameplay/runmount: is he under pressure? Wanted (any step), or police rounds fired / his health going down in the last 4 s of game time. Read from game.combat as it stands, each step (three compares)
  pressed() { const c = this.combat, q = (this._prs ||= { hp: null, cs: -1, last: -99 }); try { if (c) { if (typeof c.health === 'number') { if (q.hp !== null && c.health < q.hp - 0.01) q.last = this.t; q.hp = c.health; } const H = c.heat, cs = H && H.stats ? H.stats.copShots || 0 : -1; if (cs >= 0) { if (q.cs >= 0 && cs > q.cs) q.last = this.t; q.cs = cs; } if (H && H.level >= 1) return true; } } catch (e) {} return this.t - q.last < 4; }
  collideCars(v, dt = DT) {
    // the player's car against moving traffic and other loose cars: push apart, bleed speed, stun the other driver.
    // Traffic (public report 20261112132507, "got stuck and glitched"): a traffic car runs on its lane like a tram and was a wall to the player's car, so
    // a player between a queue and the parked row could not move. Touched at under 3.2 m/s it now gives way at walking pace (traffic.shove: along its
    // lane and a little sideways, never into another car, a parked car or a wall) and the player's car keeps pushing instead of bouncing off; what it
    // cannot give, the player's car still takes. Faster than that is a crash, as before. Against traffic each car is three circles (were two: the middle was open), a traffic car's reaching its ends (a van's and a bus's stopped short), five for a long one.
    const L = v.def.len, r = v.def.wid * 0.5, T = this.traffic, K2 = [1, -1], K3 = [1, 0, -1], K5 = [1, 0.5, 0, -0.5, -1];
    const hitOne = (o, movable) => {
      const oL = o.def.len, orr = o.def.wid * 0.5, K = movable ? K2 : K3, oe = movable ? oL * 0.28 : Math.max(oL * 0.28, oL / 2 - orr), KB = movable ? K2 : oe > 1.8 * orr ? K5 : K3;
      for (const ka of K) for (const kb of KB) {
        const a = L * 0.3 * ka, b = oe * kb;
        const ax = v.x + Math.cos(v.h) * a, ay = v.y + Math.sin(v.h) * a, bx = o.x + Math.cos(o.h) * b, by = o.y + Math.sin(o.h) * b;
        let dx = ax - bx, dy = ay - by; const d = Math.hypot(dx, dy), R = r + orr;
        if (d < R && d > 1e-4) {
          dx /= d; dy /= d; const pen = R - d;
          const ov = movable ? 0 : o.v - (o.rev || 0), ovx = movable ? o.vx : Math.cos(o.h) * ov, ovy = movable ? o.vy : Math.sin(o.h) * ov; const vn = (v.vx - ovx) * dx + (v.vy - ovy) * dy;
          if (!movable && vn > -3.2 && T.shove) {
            const cap = 1.5 * Math.min(1, 4.8 / oL) * dt, gave = vn < -0.02 ? T.shove(o, -dx, -dy, pen, cap) : 0;
            v.x += dx * (pen - gave); v.y += dy * (pen - gave);
            if (vn < 0) { const keep = gave > 1e-5 ? Math.max(vn, -cap / dt) : 0; v.vx += (keep - vn) * dx; v.vy += (keep - vn) * dy;
              if (o.v > 1) { o.stun = Math.max(o.stun, 1.6); o.v *= 0.4; } else { o.stun = Math.max(o.stun, 0.8); o.v = 0; }
              if (-vn > 2.5) { v.damage += -vn; v.hitT = 0.35; this.onCrash(v, -vn); } }
            continue;
          }
          v.x += dx * pen; v.y += dy * pen;
          if (vn < 0) { v.vx -= vn * 1.1 * dx; v.vy -= vn * 1.1 * dy; if (movable) { o.vx += vn * 0.8 * dx; o.vy += vn * 0.8 * dy; } else { o.stun = 1.6; o.v *= 0.4; }
            if (-vn > 2.5) { v.damage += -vn; v.hitT = 0.35; this.onCrash(v, -vn); } }
        }
      }
    };
    // what the circles leave open (a corner in the hollow between two circles, up to half a metre): the two bodies as boxes, parted along the
    // shallowest of their four axes; a slow touch shoves the traffic car as above, the rest moves the player's car. No bounce.
    const box = (o) => {
      const ax = Math.cos(v.h), ay = Math.sin(v.h), bx = Math.cos(o.h), by = Math.sin(o.h), dx = o.x - v.x, dy = o.y - v.y, al = L / 2 - 0.04, aw = r - 0.04, bl = o.def.len / 2 - 0.04, bw = o.def.wid / 2 - 0.04;
      if (dx * dx + dy * dy > (al + aw + bl + bw) ** 2) return;
      const c = Math.abs(ax * bx + ay * by), s = Math.abs(ax * by - ay * bx); let best = 1e9, nx = 0, ny = 0;
      let p = dx * ax + dy * ay, d = al + bl * c + bw * s - Math.abs(p); if (d <= 0) return; best = d; nx = p > 0 ? -ax : ax; ny = p > 0 ? -ay : ay;
      p = -dx * ay + dy * ax; d = aw + bl * s + bw * c - Math.abs(p); if (d <= 0) return; if (d < best) { best = d; nx = p > 0 ? ay : -ay; ny = p > 0 ? -ax : ax; }
      p = dx * bx + dy * by; d = bl + al * c + aw * s - Math.abs(p); if (d <= 0) return; if (d < best) { best = d; nx = p > 0 ? -bx : bx; ny = p > 0 ? -by : by; }
      p = -dx * by + dy * bx; d = bw + al * s + aw * c - Math.abs(p); if (d <= 0) return; if (d < best) { best = d; nx = p > 0 ? by : -by; ny = p > 0 ? -bx : bx; }
      const ov = o.v - (o.rev || 0), vn = (v.vx - Math.cos(o.h) * ov) * nx + (v.vy - Math.sin(o.h) * ov) * ny, cap = 1.5 * Math.min(1, 4.8 / o.def.len) * dt;
      best = Math.min(best, 0.6);     // (two cars deep in each other, as after a hand-placed test start, part over a few steps, not in one throw)
      const gave = vn < -0.02 && vn > -3.2 && T.shove ? T.shove(o, -nx, -ny, best, cap) : 0;
      v.x += nx * (best - gave); v.y += ny * (best - gave);
      if (vn < 0) { const keep = gave > 1e-5 ? Math.max(vn, -cap / dt) : 0; v.vx += (keep - vn) * nx; v.vy += (keep - vn) * ny; }
    };
    for (const c of this.traffic.cars) { if (Math.abs(c.x - v.x) > 12 || Math.abs(c.y - v.y) > 12) continue; hitOne(c, false); box(c); }
    for (const c of this.vehicles) if (c !== v && Math.abs(c.x - v.x) < 12 && Math.abs(c.y - v.y) < 12) hitOne(c, true);
  }
  onCrash(v, force) { if (v === this.player.vehicle) { this.cam.shake = Math.min(1, this.cam.shake + force * 0.06); this.sound.crash(force); this.missions.onCrash(force); } }
  // how much is drawn (1 = everything): budget distances, crowd size, how often the street mirror is redrawn
  setDetail(d) { const w = this.world, b = this.budget; w.detail = d; w.streetEvery = d >= 1 ? 3 : d > 0.7 ? 4 : 6;
    if (b) { if (!b._base) b._base = { HIDE_SMALL: b.HIDE_SMALL, SHADOW_SMALL: b.SHADOW_SMALL, SHADOW_BIG: b.SHADOW_BIG, HIDE_PEOPLE: b.HIDE_PEOPLE, SHADOW_PEOPLE: b.SHADOW_PEOPLE }; for (const k in b._base) b[k] = b._base[k] * (k === 'SHADOW_BIG' ? Math.max(0.6, d) : d); }
    try { if (this.crowd && this.crowd.setCount) { if (!this._crowd0) this._crowd0 = (this.crowd.sim && this.crowd.sim.count) || 0; if (this._crowd0) this.crowd.setCount(Math.round(this._crowd0 * (d >= 1 ? 1 : d * 0.9))); } } catch (e) {} }
  onPedHit(p, v) { if (v === this.player.vehicle) { this.sound.thud(); this.missions.onPedHit(); } }

  nearestCar(maxD = 3.6) {
    const pl = this.player; let best = null, bd = maxD;
    if (this.takeBody === undefined) { const P = this.P; this.takeBody = !(P && P.get && P.get('takebody') === '0'); this.takeMove = !(P && P.get && P.get('takemove') === '0'); }
    if (this.takeBody || this.takeMove) {
      /* gameplay/takeover, Nov 17 (Matt: "I should be able to shoot anywhere and take anything over"). (a) ?takebody=0 off: the test is against the nearest point of
         the vehicle's BODY (its len x wid box) as well as its middle: within maxD - 2 m (1.6 m) of the body anywhere round it counts, so a truck or a bus is taken
         from its cab door (the tiller's door is 7.4 m from its middle, the rear-loader's 4.3 m, the pumper's 4.0 m: all outside 3.6 m). A small car is offered where
         it was before (the middle rule stands), and the nearer middle still wins between two cars. (b) ?takemove=0 off: a car in traffic that is ROLLING (under 5.5 m/s,
         20 km/h: a speed at which a man can get a hand on the door; faster ones are not offered) is taken too when he is within that 1.6 m of its body. F first makes
         its driver brake hard (takeRolling: the traffic's own stop, 12 m/s2, about a metre from 5 m/s, and the cars behind see it as traffic does); once it stands, the
         take goes on by itself (stepTake) and entry.js pulls its driver out as it does from a stopped one. */
      const B = this.takeBody, MV = this.takeMove, R = Math.max(0, maxD - 2), px = pl.x, py = pl.y;
      if (this._takeGo) { const c = this._takeGo; if (this.traffic.cars.includes(c)) return { kind: 'traffic', c }; }      /* the rolling car he grabbed has stopped: that one, wherever its metre of braking left it */
      const body = (o) => { const f = o.def; if (!f || !(f.len > 0) || !(f.wid > 0)) return 1e9; const dx = px - o.x, dy = py - o.y, c = Math.cos(o.h), s = Math.sin(o.h); return Math.hypot(Math.max(0, Math.abs(dx * c + dy * s) - f.len / 2), Math.max(0, Math.abs(dy * c - dx * s) - f.wid / 2)); };
      for (const v of this.vehicles) { let d = Math.hypot(v.x - px, v.y - py); if (B && d >= bd && d < 16) d = Math.min(d, body(v) + 2); if (d < bd) { bd = d; best = { kind: 'veh', v }; } }
      for (const s of this.parked.near(px, py, B ? 12 : 8)) { let d = Math.hypot(s.x - px, s.y - py); if (B && d >= bd) d = Math.min(d, body(s) + 2); if (d < bd) { bd = d; best = { kind: 'slot', s }; } }
      for (const c of this.traffic.cars) { const d0 = Math.hypot(c.x - px, c.y - py); if (d0 > 16 || (c.type === 'bus' && !B)) continue; const slow = c.v < 2.5; if (!slow && !(MV && c.v < 5.5)) continue;
        const db = B || !slow ? body(c) : 1e9; let d = slow && c.type !== 'bus' ? d0 : 1e9; if (slow ? B && db < R : db < R) d = Math.min(d, db + 2); if (d < bd) { bd = d; best = { kind: 'traffic', c }; } }
      return best;
    }
    for (const v of this.vehicles) { const d = Math.hypot(v.x - pl.x, v.y - pl.y); if (d < bd) { bd = d; best = { kind: 'veh', v }; } }
    for (const s of this.parked.near(pl.x, pl.y, 8)) { const d = Math.hypot(s.x - pl.x, s.y - pl.y); if (d < bd) { bd = d; best = { kind: 'slot', s }; } }
    for (const c of this.traffic.cars) { if (c.type === 'bus') continue; const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (d < bd && c.v < 2.5) { bd = d; best = { kind: 'traffic', c }; } }
    return best;
  }
  // the driver's seat for a figure: [ahead, left, height of the figure's origin] so that its hips in the Drive pose rest on the cushion
  seatOf(v, name) { const st = this.kit.seats?.[v.type] || SEAT[v.type] || SEAT.sedan, hips = this.kit.driveHips && this.kit.driveHips[name]; return hips === undefined ? st : [st[0], st[1], st[2] + 0.22 - hips]; }
  // where the driver stands to get in or out: beside the driver's door, facing the way the clip was captured (people.json: door)
  doorPose(v) {
    const st = this.kit.seats?.[v.type] || SEAT[v.type] || SEAT.sedan, D = (this.kit.peopleMeta && this.kit.peopleMeta.door) || {}, c = Math.cos(v.h), sn = Math.sin(v.h);
    const out = v.def.wid / 2 + (D.out ?? 0.55), fwd = st[0] + (D.fwd ?? 0);
    return { x: v.x + c * fwd - sn * out, y: v.y + sn * fwd + c * out, h: v.h + (D.yaw ?? 0) };
  }
  tryEnter() {
    const n = this.nearestCar(); if (!n || this.player.busy) return false; let v;
    if (n.kind === 'veh') v = n.v;
    else if (n.kind === 'slot') { this.parked.take(n.s); v = new Vehicle(n.s.def, n.s.x, n.s.y, n.s.h, n.s.color); v.mission = n.s.mission; this.vehicles.push(v); }
    else { const c = n.c; this.traffic.remove(c); v = new Vehicle(c.def, c.x, c.y, c.h, c.color); this.vehicles.push(v); }
    const pl = this.player, vis = pl.vis;
    if (vis.acts.getin && !this.P.has('noanim')) {     // walk the last step to the door and play the motion-captured get-in before the car is ours
      const d = this.doorPose(v); pl.busy = { kind: 'in', t: 0, dur: vis.dur.getin, v, x0: pl.x, y0: pl.y, h0: pl.h, x: d.x, y: d.y, h: d.h, z: 0 }; this.playerAnim('getin'); if (vis.mixer) vis.mixer.timeScale = 1; this.sound.door();
    } else this.finishEnter(v);
    return true;
  }
  /* gameplay/takeover 2: F on a car rolling in traffic (2.5 to 5.5 m/s). It is not frozen where it is: its driver stands on the brake (traffic.js's stun: 12 m/s2) and it
     stays a car of the traffic while it stops, so what follows it brakes for it or goes round. When it stands (0.2 to 0.45 s, 0.3 to 1.0 m on) the ordinary tryEnter
     runs on that car with every lane's wrap: he steps to the door, the driver is hauled out. Called off after 1.5 s, or if he has gone more than 4.5 m from its body. */
  takeRolling() {
    if (!this.takeMove) return false; if (this._take) return true; let n = null; try { n = this.nearestCar(); } catch (e) {} const c = n && n.kind === 'traffic' ? n.c : null; if (!c || !(c.v >= 2.5)) return false;
    c.stun = Math.max(c.stun || 0, 0.7); this._take = { c, t: 0, v0: c.v, x0: c.x, y0: c.y }; return true;
  }
  stepTake(dt) {
    const T = this._take, c = T.c, pl = this.player; T.t += dt;
    if (pl.busy || pl.vehicle || T.t > 1.5 || !this.traffic.cars.includes(c)) { this._take = null; return; }
    c.stun = Math.max(c.stun || 0, 0.4); if (c.v > 0.4) return;
    this._take = null; const log = (this.takeLog = { v0: T.v0, t: T.t, d: Math.hypot(c.x - T.x0, c.y - T.y0), ok: false }); if (Math.hypot(c.x - pl.x, c.y - pl.y) > c.def.len / 2 + 4.5) return;
    this._takeGo = c; try { log.ok = !!this.tryEnter(); } finally { this._takeGo = null; }
  }
  finishEnter(v) {
    this.player.busy = null; this.player.vehicle = v; this.player.vis.object.visible = !!this.player.vis.acts.drive; this.playerAnim('drive'); this.cam.mode = 'car'; if (!this.player.vis.acts.getin) this.sound.door(); this.missions.onEnter(v);
  }
  exitVehicle() {
    const pl = this.player, v = pl.vehicle, vis = pl.vis; const lx = -Math.sin(v.h), ly = Math.cos(v.h);    // left of the car
    pl.vehicle = null; vis.object.visible = true; this.cam.mode = 'foot'; v.vx = v.vy = 0; this.sound.door(); this.missions.onExit(v);
    if (vis.acts.getout && !this.P.has('noanim')) { const d = this.doorPose(v); pl.x = d.x; pl.y = d.y; pl.h = d.h; pl.busy = { kind: 'out', t: 0, dur: vis.dur.getout, v, x0: d.x, y0: d.y, h0: d.h, x: d.x, y: d.y, h: d.h, z: 0 }; this.playerAnim('getout'); if (vis.mixer) vis.mixer.timeScale = 1; }
    else { const x = v.x + lx * (v.def.wid / 2 + 0.6), y = v.y + ly * (v.def.wid / 2 + 0.6); this.statics.resolve(x, y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; }
    while (this.vehicles.length > 6) { const i = this.vehicles.findIndex((q) => q !== v && !q.mission); if (i < 0) break; this.vehicles.splice(i, 1); }
  }
  // getting in or out: the figure is placed at the door and the clip plays through; nothing else moves the player meanwhile
  stepBusy(dt) {
    // The mocap sits down (or stands up) on the spot, so the figure is carried between the door and the seat while it does: a step to
    // the door, then across into the seat as the body folds (and the reverse getting out).
    const pl = this.player, b = pl.busy, v = b.v; b.t += dt; const st = this.seatOf(v, 'player'), c = Math.cos(v.h), sn = Math.sin(v.h), sx = v.x + c * st[0] - sn * st[1], sy = v.y + sn * st[0] + c * st[1];
    const sm = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }, f = b.t / Math.max(b.dur, 0.01);
    if (b.kind === 'in') { const k = sm(b.t / 0.3), m = sm((f - 0.3) / 0.55); pl.x = lerp(lerp(b.x0, b.x, k), sx, m); pl.y = lerp(lerp(b.y0, b.y, k), sy, m); pl.h = b.h0 + wrapPi(b.h - b.h0) * k; b.z = lerp(0, v.z + st[2], m); }
    else { const m = sm((f - 0.1) / 0.6); pl.x = lerp(sx, b.x, m); pl.y = lerp(sy, b.y, m); pl.h = b.h; b.z = lerp(v.z + st[2], 0, m); }
    pl.speed = 0;
    if (b.t >= b.dur) { if (b.kind === 'in') this.finishEnter(b.v); else { pl.busy = null; this.statics.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } }
  }

  // ------------------------------------------------------------------ camera
  camTarget() {
    const pl = this.player, C = this.cam;
    if (pl.vehicle) { const v = pl.vehicle, sp = Math.hypot(v.vx, v.vy); const big = v.def.len > 7 ? 1.9 : v.def.hgt > 2 ? 1.3 : 1;
      return { x: v.x, y: v.y, z: v.z + 1.15 * big, dist: (5.6 + sp * 0.045) * big, height: 1.25 * big, fov: 56 + clamp(sp / 45, 0, 1) * 16, yaw: v.h - v.yawV * 0.12,     /* public feedback Nov 11: "Reversing my car should not change the camera angle": the view no longer swings round to face backwards in reverse (look back with the mouse) */ auto: 3.2 + sp * 0.12 }; }
    return { x: pl.x, y: pl.y, z: (pl.alt || (this.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0)) + 1.5, dist: 3.4, height: 0.35, fov: 52, yaw: this.footround && this.footround.camT === this.t ? this.footround.camH : pl.h     /* gameplay footround: the view follows his course, not the side-step round a pole */, auto: pl.speed > 0.3 ? 1.2 : 0 };
  }
  snapCamera() { const t = this.camTarget(), C = this.cam; C.yaw = t.yaw; C.tx = t.x; C.ty = t.y; C.tz = t.z; C.dist = t.dist; C.fov = t.fov; C.h = t.height; C.clip = undefined; this.placeCamera(0); }
  updateCamera(dt) {
    if (this.heli && this.heli.hasCamera && !this.fly.on) return this.heli.updateCamera(dt);     // heli lane: chase and cockpit cameras
    const t = this.camTarget(), C = this.cam;
    if (C.lookT > (this.player.vehicle ? 1.5 : 1.2) && t.auto) C.yaw += wrapPi(t.yaw - C.yaw) * Math.min(1, dt * t.auto);
    const k = Math.min(1, dt * 14); C.tx += (t.x - C.tx) * k; C.ty += (t.y - C.ty) * k; C.tz += (t.z - C.tz) * Math.min(1, dt * 8);
    C.dist += (t.dist - C.dist) * Math.min(1, dt * 3); C.fov += (t.fov - C.fov) * Math.min(1, dt * 3); C.h += (t.height - C.h) * Math.min(1, dt * 3);
    C.shake = Math.max(0, C.shake - dt * 2.2);
    this.placeCamera(dt);
  }
  placeCamera(dt) {
    const C = this.cam, cam = this.world.camera; const pitch = this.player.vehicle ? clamp(C.pitch, 0.04, 0.9) : Math.max(-0.25, C.pitch);
    let d = C.dist; const bx = -Math.cos(C.yaw), by = -Math.sin(C.yaw);
    // a wall between the player and the camera pulls the camera in front of it: in quickly, back out gently, so it neither clips nor snaps
    const hd = d * Math.cos(pitch); let hit = 1; for (const sd of [0, 0.45, -0.45]) hit = Math.min(hit, this.statics.raycast(C.tx, C.ty, C.tx + bx * (hd + 0.6) - by * sd, C.ty + by * (hd + 0.6) + bx * sd));
    if (this.player.alt > 2) hit = 1;     // heli lane: on a roof the street-level walls are below you
    const want = hit < 1 ? Math.max(0.9, d * hit - 0.35) : d; if (!dt || C.clip === undefined) C.clip = want; else C.clip += (want - C.clip) * Math.min(1, dt * (want < C.clip ? 22 : 2.2)); d = Math.min(d, C.clip);
    const vp = this.player.vehicle && this.P.get('campull') !== '0' ? camPull(this, C, bx, by, d, pitch, dt) : null; if (vp) d = vp.d;     // gameplay campull: a vehicle in the way (null, and nothing changed, when none is)
    let cx = C.tx + bx * d * Math.cos(pitch), cy = C.ty + by * d * Math.cos(pitch), cz = C.tz + C.h + d * Math.sin(pitch); if (vp) cz += vp.up;
    if (cz < 0.4) cz = 0.4;
    const sh = C.shake * C.shake * 0.25, n = this.frame;
    cam.position.set(cx + Math.sin(n * 1.7) * sh, cz + Math.sin(n * 2.3) * sh, -cy + Math.cos(n * 1.3) * sh);
    const ahead = this.player.vehicle ? (vp ? vp.ahead : 2.2) : 0;     // (pulled in, the view keeps about the chase view's angle: the horizon stays in the picture)
    cam.lookAt(C.tx + Math.cos(C.yaw) * ahead, C.tz + (this.player.vehicle ? 0.1 : 0.15), -(C.ty + Math.sin(C.yaw) * ahead));
    // looking up: the camera orbits the player and looks at them, so its lowest orbit was also the highest the view could tilt (14 degrees below the horizon)
    { const extra = -0.25 - C.pitch; if (extra > 0) { const d = cam.getWorldDirection(this._vd || (this._vd = new THREE.Vector3())), hl = Math.hypot(d.x, d.z) || 1, e = Math.min(1.4, Math.asin(clamp(d.y, -1, 1)) + extra);
      cam.lookAt(cam.position.x + d.x / hl * Math.cos(e) * 10, cam.position.y + Math.sin(e) * 10, cam.position.z + d.z / hl * Math.cos(e) * 10); } }
    if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ drawing
  syncVisuals(dt) {
    for (const k in this.batches) this.batches[k].begin();
    const fx = this.focus.x, fy = this.focus.y;
    // only cars the camera can see are submitted (each is ~20k triangles and is drawn in three passes): inside the view cone, or close by so their shadows and reflections stay
    const cam = this.world.camera, cx = cam.position.x, cy = -cam.position.z, _d = cam.getWorldDirection(this._cd ||= new THREE.Vector3()), dl = Math.hypot(_d.x, _d.z) || 1, dx = _d.x / dl, dy = -_d.z / dl, cosH = Math.cos(((cam.fov * cam.aspect) / 2 + 12) * Math.PI / 180);
    const seen = (x, y, far) => { const ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey); return d < 22 || (d < far && (ex * dx + ey * dy) > d * Math.max(0.2, cosH)); };
    for (const c of this.traffic.cars) if (seen(c.x, c.y, 320)) this.batches[c.type].add(c.x, c.y, 0, c.h, 0, 0, c.color, c.spin, c.steer, c.brake);
    for (const v of this.vehicles) this.batches[v.type].add(v.x, v.y, v.z, v.h, v.roll, v.pitch, v.color, v.spin, v.steer, v.braking);
    // parked cars last: if a batch ever runs out of room it is a far parked car that goes undrawn, never one that is driving
    for (const s of this.parked.near(cx, cy, 260, (this._near ||= []))) if (seen(s.x, s.y, 260)) this.batches[s.type].add(s.x, s.y, 0, s.h, 0, 0, s.color, 0, 0);
    for (const k in this.batches) this.batches[k].end();
    if (this.drivers.length) {
      for (const d of this.drivers) d.begin();
      const R = this.kit.peopleExport ? 45 : 75; for (const c of this.traffic.cars) { if (Math.abs(c.x - fx) > R || Math.abs(c.y - fy) > R) continue; const d = this.drivers[c.id % this.drivers.length], st = this.seatOf(c, d.who), cs = Math.cos(c.h), sn = Math.sin(c.h); d.add(c.x + cs * st[0] - sn * st[1], c.y + sn * st[0] + cs * st[1], st[2], c.h); }
      for (const d of this.drivers) d.end();
    }
    const pl = this.player, o = pl.vis.object;
    if (!pl.vehicle) { o.position.set(pl.x, pl.busy ? pl.busy.z : this.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0, -pl.y); o.rotation.set(0, pl.h, 0); if (pl.vis.mixer) pl.vis.mixer.update(dt); }
    else if (o.visible) {   // at the wheel: carried by the car, seated
      const v = pl.vehicle, st = this.seatOf(v, 'player'), c = Math.cos(v.h), sn = Math.sin(v.h);
      o.position.set(v.x + c * st[0] - sn * st[1], v.z + st[2], -(v.y + sn * st[0] + c * st[1])); o.rotation.set(v.roll, v.h, v.pitch, 'YZX'); if (pl.vis.mixer) { pl.vis.mixer.timeScale = 1; pl.vis.mixer.update(dt); }
    }
    this.missions.draw(dt);
    if (this.heli) this.heli.sync(dt);     // heli lane
  }
  renderFrame(dt) {
    const flyFocus = this.fly.on ? this.fly.update(dt) : null;
    if (this.budget) this.budget.update();
    this.syncVisuals(dt);
    const C = this.cam; this.world.render(this.t, flyFocus || (this.heli && this.heli.hasCamera ? this.heli.shadowFocus(this._hf ||= new THREE.Vector3()) : new THREE.Vector3(C.tx + Math.cos(C.yaw) * 40, 0, -(C.ty + Math.sin(C.yaw) * 40))));
    this.hud.draw();
  }
  // one whole frame at a fixed step (used by capture)
  stepFrame() { this.step(DT); this.renderFrame(DT); }

  start() {
    if (this.capture) return;      // the capture driver calls stepFrame itself
    let last = performance.now(), acc = 0; this.fps = 60; let fc = 0, ft = 0;
    const loop = (now) => {
      requestAnimationFrame(loop); const now0 = performance.now();
      let el = Math.max(0, Math.min(0.1, (now - last) / 1000));
      { const wc = this.world && this.world.cam; if (wc && wc.taa) { const h = this.cam.mode === 'heli'; if (h !== !!wc._heli) { wc._heli = h; wc.taa.enabled = !h && !wc.isOld && !wc.userSharp     /* lead smallfix, Nov 18: the menu's 'Sharper motion' keeps it off */; if (wc._rs) this.world.resize(...wc._rs); } } }     /* lead, Nov 12: the camera lane's anti-aliasing history smears the cockpit (it moves with the camera), so in the helicopter the picture goes back to FXAA */ last = now; ft += el; fc++; if (ft > 0.5) { this.fps = fc / ft; fc = 0; ft = 0;
        if (!this.qPin) {     /* progress lane: a fixed Quality preset (Low / Medium / High in the menu, src/menu/menu.js) pins picture size, AO and detail; everything the governor does, down to the closing brace marked qPin, runs only on Auto */
        // live play keeps its frame rate first: screen-space ambient occlusion (a second full geometry pass) steps down when the machine can't hold ~50 fps
        // audit item 12: the governor used to count the slow first seconds (shaders compiling, textures going up) and could only step down, so
        // every machine ended at the smallest picture with AO off. It now waits 10 s, and steps back up when there is room: picture size first, then
        // AO back on; a step up that does not hold is undone and that size becomes the ceiling for the session.
        this._govT = (this._govT || 0) + 0.5; const W0 = this.world, live = !this.capture && !(this.fly && this.fly.on) && !this.paused;
        if (this._govT < 10) { this._slow = this._slowA = this._slow2 = 0; }
        else if (live && !this.P.has('px') && window.__fit && W0.aoDepth) { const sc = W0.liveScale || 1, gg = W0.gtao;
          if (this._upAt && this._govT - this._upAt < 6 && this.fps < 52) { if (++this._upBad >= 3) { if (this._upKind === 'ao') { gg.enabled = false; this._aoCeil = 1; } else { W0.liveScale = this._upFrom; this._ceil = this._upFrom; window.__fit(); } this._upAt = 0; console.log('[game] step up did not hold (' + this.fps.toFixed(0) + ' fps), undone'); } }
          this._fast = this.fps >= 58.5 ? (this._fast || 0) + 1 : 0;
          if (this._fast >= 8 && !(this._upAt && this._govT - this._upAt < 8)) { this._fast = 0;
            const aoOn = !gg || gg.enabled || this._aoCeil || this.P.has('ao'), top = Math.min(this._ceil || 1.3, sc < 0.99 || !aoOn ? 1 : 1.3);     /* public feedback Nov 11 ("running well at 60 fps but the resolution is very low", M4 Pro): once the full picture and AO both hold 58 fps, the picture may grow past the old cap, to 1.3 times (never past the screen's own pixels) */
            if (sc < top - 0.01) { this._upFrom = sc; W0.liveScale = Math.min(top, sc / 0.87); this._upAt = this._govT; this._upBad = 0; this._upKind = 'scale'; window.__fit(); console.log('[game] render scale up to ' + W0.liveScale.toFixed(2)); }
            else if (gg && !gg.enabled && !this._aoCeil && !this.P.has('ao')) { gg.enabled = true; this._upAt = this._govT; this._upBad = 0; this._upKind = 'ao'; this._slow = 0; console.log('[game] ambient occlusion back on'); } } }
        const g = this.world.gtao; if (g && g.enabled && !this.P.has('ao') && !(this.world.aoDepth && (this.world.liveScale || 1) > 0.8 && !this.P.has('px') && window.__fit && !(this.fly && this.fly.on))) {     /* with the cheap depth AO (audit item 2) the picture first gives up a little size, and AO only goes below 0.8 */ this._slow = this.fps < 48 ? (this._slow || 0) + 1 : 0; if (this._slow >= 4) { g.enabled = false; console.log('[game] ambient occlusion pass off to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } } 
        else if (!this.capture && !this.P.has('aa') && this.world.liveAA !== 'fxaa' && !(this.fly && this.fly.on)) { this._slowA = this.fps < 54 ? (this._slowA || 0) + 1 : 0; if (this._slowA >= 4) { this.world.setLiveAA(false); console.log('[game] multisampling off, FXAA on to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } }
        else if (!this.capture && !this.P.has('px') && window.__fit && !(this.fly && this.fly.on)) { const w = this.world; this._slow2 = this.fps < 54 ? (this._slow2 || 0) + 1 : 0; if (this._slow2 >= 5 && (w.liveScale || 1) > 0.64) { w.liveScale = (w.liveScale || 1) * 0.87; this._slow2 = 0; window.__fit(); console.log('[game] render scale ' + w.liveScale.toFixed(2) + ' to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } } } }     /* qPin */
      if (!this.qPin) {     /* progress lane: as above, for the detail steps and the weak-card and Safari starts */
        // Nov 11, first outside report (M4 laptop, 25-30 fps while driving at the smallest picture with AO off): such a machine is held back by how much
        // is drawn, not by pixels. Below 42 fps at the floor, the game now also draws less: small street things and shadows come in nearer, the crowd
        // thins, the street mirror refreshes half as often. Steps 0.8 -> 0.64 -> 0.5; steps back up one at a time when 58 fps holds. ?detail=1 pins it.
        if (this.P.has('detail') && !this._detSet && this._govT >= 2) { this._detSet = 1; this.setDetail(+this.P.get('detail') || 1); }
        // Public reports Nov 12 (Linux, Intel integrated graphics: 10 fps for the first 35 s of play while the governor walked down, then 12-25 fps at
        // its floor): a weak integrated or software GPU now STARTS at the floor (small picture, no AO, FXAA, detail 0.5) and steps up if it holds
        // 58 fps; ?weak=0 switches this off, ?weak=1 forces it on any machine.
        if (!this._weakChk && this._govT >= 2) { this._weakChk = 1; let gs = ''; try { const gl = this.world.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); gs = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) {}
          const weak = this.P.get('weak') === '1' || this.P.get('tier') === 'low' || (this.P.get('weak') !== '0' && this.P.get('tier') !== 'high' && ((/Intel/i.test(gs) && !/Arc/i.test(gs)) || /llvmpipe|SwiftShader|softpipe|Mali|Adreno|PowerVR/i.test(gs)));
          if (weak && !this.capture && !this.P.has('px') && !this.P.has('detail') && window.__fit) { this.world.liveScale = 0.57; window.__fit(); if (this.world.gtao && !this.P.has('ao')) this.world.gtao.enabled = false; if (!this.P.has('aa') && this.world.liveAA !== 'fxaa' && this.world.setLiveAA) this.world.setLiveAA(false); this._detSet = 1; this.setDetail(0.5); this.weakGpu = true; try { if (this.world.cam && this.world.cam.old && this.P.get('cam') !== '1') this.world.cam.old(true); } catch (e) {}     /* the camera module's full-size rebuild is not for weak cards (merge 18:30 Nov 12: 57 against 66 fps at the weak start) */ console.log('[game] weak graphics card (' + gs.slice(0, 60) + '): starting at the smallest picture and detail 0.5'); } }
        if (window.__safari && !this.P.has('detail') && !this._detSet && this._govT >= 2) { this._detSet = 1; this.setDetail(0.64); console.log('[game] Safari: starting at detail 0.64 and a smaller picture'); }
        /* lead gov-step, Nov 19. The detail steps below were counted once per FRAME against a frame rate that is renewed every half second, so "6 slow readings" was a tenth to a
           quarter of a second and ONE slow half second (a subway station being built as he drove past: 13 fps for a moment) took the detail 1 -> 0.8 -> 0.64 -> 0.5 -> 0.35 inside
           one second (MacBook M1 Pro, lanes/lead/chase-jitter base1: 7.45 s to 8.24 s into the drive). Now: one reading per half second, and the reading is the half second's
           MEDIAN frame, so a hitch or a burst of long frames (a load spike is not a slow machine) does not count; a step down needs four slow readings in a row (2 s), two when
           the machine is far below the mark (under 30 fps: 1 s), and the readings start again after every step, so each step is judged on the frame rate it gave; the last step
           (0.35) needs 2 s under 28 fps; a step up needs 4 s at 58 fps (was 16 frames). A truly slow machine is at detail 0.5 three seconds after the governor starts on it
           (was under one second). ?govstep=0 = as before. */
        if (this.P.get('govstep') !== '0') { const G = (this._gd ||= { f: new Float32Array(240), n: 0, last: 0, T: -1, r: 60, log: [] }); if (G.last && G.n < 240) G.f[G.n++] = now - G.last; G.last = now;
          if (this._govT !== G.T) { G.T = this._govT; let r = this.fps; if (G.n >= 3) { const a = Array.from(G.f.subarray(0, G.n)).sort((x, y) => x - y); r = 1000 / Math.max(1, a[a.length >> 1]); } G.n = 0; G.r = r;
            if (this._govT >= 10 && !this.capture && !this.P.has('detail') && !(this.fly && this.fly.on) && !this.paused && (this.world.liveScale || 1) <= 0.66) { const w = this.world, d = w.detail || 1, say = (t) => { if (G.log.length < 40) G.log.push([+(performance.now() / 1000).toFixed(1), w.detail, Math.round(r), Math.round(this.fps)]); console.log(t); };
              this._slowD = r < 42 ? (this._slowD || 0) + 1 : 0; this._fastD = r >= 58 ? (this._fastD || 0) + 1 : 0; this._slowE = r < 28 ? (this._slowE || 0) + 1 : 0;
              if (this._slowD >= (r < 30 ? 2 : 4) && d > 0.51) { this.setDetail(d > 0.81 ? 0.8 : d > 0.65 ? 0.64 : 0.5); this._slowD = this._slowE = this._fastD = 0; say('[game] detail ' + w.detail + ' to hold frame rate (' + r.toFixed(0) + ' fps)'); }
              else if (d <= 0.51 && d > 0.36 && this._slowE >= 4) { this._slowD = this._slowE = this._fastD = 0; this.setDetail(0.35); if ((w.liveScale || 1) > 0.5 && !this.P.has('px') && window.__fit) { w.liveScale = 0.5; window.__fit(); } say('[game] detail 0.35 and render scale ' + (w.liveScale || 1).toFixed(2) + ' to hold frame rate (' + r.toFixed(0) + ' fps)'); }
              else if (this._fastD >= 8 && d < 1) { this.setDetail(d < 0.36 ? 0.5 : d < 0.51 ? 0.64 : d < 0.65 ? 0.8 : 1); this._slowD = this._slowE = this._fastD = 0; say('[game] detail back up to ' + w.detail); } }
            else this._slowD = this._slowE = this._fastD = 0; } }
        else
        if (this._govT >= 10 && !this.capture && !this.P.has('detail') && !(this.fly && this.fly.on) && !this.paused && (this.world.liveScale || 1) <= 0.66) { const w = this.world, d = w.detail || 1;
          this._slowD = this.fps < 42 ? (this._slowD || 0) + 1 : 0; this._fastD = this.fps >= 58 ? (this._fastD || 0) + 1 : 0;
          if (this._slowD >= 6 && d > 0.51) { this.setDetail(d > 0.81 ? 0.8 : d > 0.65 ? 0.64 : 0.5); this._slowD = 0; console.log('[game] detail ' + w.detail + ' to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); }
          else if (d <= 0.51 && d > 0.36 && (this._slowE = this.fps < 28 ? (this._slowE || 0) + 1 : 0) >= 8) { this._slowE = 0; this.setDetail(0.35); if ((w.liveScale || 1) > 0.5 && !this.P.has('px') && window.__fit) { w.liveScale = 0.5; window.__fit(); } console.log('[game] detail 0.35 and render scale ' + (w.liveScale || 1).toFixed(2) + ' to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); }     /* Nov 12: one more step for machines still under 28 fps at the old floor */
          else if (this._fastD >= 16 && d < 1) { this.setDetail(d < 0.36 ? 0.5 : d < 0.51 ? 0.64 : d < 0.65 ? 0.8 : 1); this._fastD = 0; console.log('[game] detail back up to ' + w.detail); } } }     /* qPin */
      if (this.paused) { this.hud.draw(); return; }
      // Public feedback Nov 11 ("the update interval of objects is too low and the stuttering of animations is distracting"): the world used to
      // advance in whole 1/60 s steps, so at 28 fps one frame moved everything 2 steps and the next 3: cars and people juddered. Each frame now
      // advances the world by exactly the time that passed, in equal steps no longer than 1/60 s (at most 4), so motion is even at any frame rate.
      { const n = Math.min(4, Math.max(1, Math.ceil(el / DT - 0.02))), h = Math.min(el, 4 * DT) / n; for (let i = 0; i < n; i++) this.step(h); acc = 0; }
      this.renderFrame(el);
      this.jsMs = (this.jsMs || 0) * 0.95 + (performance.now() - now0) * 0.05;     // main-thread time of a live frame (the rest of the frame interval is the GPU's)
    };
    requestAnimationFrame(loop);
  }
}
