// mission.js: the job loop. You drive for a dispatcher: get the car, collect a package, deliver it against the clock, get paid, next job.
import * as THREE from 'three';
import { rng } from './geo.js';

const short = (n) => n.replace('Avenue', 'Ave').replace('Street', 'St').replace('East ', 'E ').replace('West ', 'W ').replace(' South', ' S');
const LINES = {
  start: ['Vee: Car\'s the red coupe by the park. Keys are in it. Don\'t make me regret this.'],
  pickup: ['Vee: Package is waiting at {at}. Pull up and keep the engine running.', 'Vee: Next one\'s at {at}. Quick in, quick out.', 'Vee: Got a pickup at {at}. Go.'],
  deliver: ['Vee: Good. Now {at}. Client pays for speed, not excuses.', 'Vee: Take it to {at}. Clock\'s running.', 'Vee: Drop is {at}. Try to bring the car back in one piece.'],
  done: ['Vee: Paid. Told you this town still tips.', 'Vee: Clean. Stay close, another one\'s coming.', 'Vee: That\'s how it\'s done.'],
  late: ['Vee: Too slow. Client walked. Shake it off.'],
};

// the first job's drop: [avenue, street, {li: lane}]
const FIRST_DROP = ['Madison Ave', '28th', { li: 0 }];   // the left-hand lane: where the turn off 23rd Street leaves the car
export const STOP_R = 9;   // metres from the stop that count as pulled up

export class Missions {
  constructor(game) {
    this.g = game; this.rand = rng(4242); this.state = 'start'; this.t = 0; this.timer = 0; this.target = null; this.route = null; this.routeT = 0; this.jobN = 0; this.msg = null; this.banner = null; this.hold = 0; this.penalty = 0; this.routeId = 0; this.offT = 0;
    const R = game.roads, b = game.bounds;
    this.corners = [];
    R.nodes.forEach((n, i) => {
      if (!n.sig || !b.in(n.p[0], n.p[1], -60)) return;
      const names = [...new Set(n.e.map((k) => R.edges[k].name).filter(Boolean))]; if (names.length < 2) return;
      const ave = names.find((x) => /Avenue|Broadway/.test(x)), st = names.find((x) => /Street/.test(x)); if (!ave || !st) return;
      this.corners.push({ node: i, x: n.p[0], y: n.p[1], name: short(ave) + ' & ' + short(st) });
    });
    this.byName = (a, s) => this.corners.find((c) => c.name.includes(a) && c.name.includes(s));
    this.home = (this.byName('Madison Ave', 'E 26th') || this.corners[0]).node;     // a corner in the middle of the map: every stop must have a way back to it
    // the car for the job: the parked car nearest a spot on 5th Avenue beside Madison Square Park, repainted
    const want = { x: -165, y: -222 }; let best = null, bd = 1e9;
    for (const s of game.parked.slots) { const d = Math.hypot(s.x - want.x, s.y - want.y); if (d < bd) { bd = d; best = s; } }
    const sport = game.kit.cars.sport || best.def; best.type = sport.type; best.def = sport; best.color = 0x8c1010; best.mission = true; this.car = best;
    // the player starts on the pavement a few steps behind it
    const fx = Math.cos(best.h), fy = Math.sin(best.h); let side = 1; if (!game.statics.onSidewalk(best.x + fy * 3.2, best.y - fx * 3.2)) side = -1;
    // (close to the kerb: on the park side the streets layer puts benches about 3.4 m in from it)
    game.player.x = best.x + fy * 1.72 * side - fx * 7; game.player.y = best.y - fx * 1.72 * side - fy * 7; game.player.h = best.h;
    // world markers
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.28, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.2), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 16, 1, true)     /* lead, Nov 10: was a 90 m beam: from the air it read as a yellow line up past the roofs (CHIEF on build 2136) */, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.25), transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    beam.position.y = 3.5; this.marker = new THREE.Group(); this.marker.add(ring, beam); this.marker.visible = false; game.world.scene.add(this.marker); this.ring = ring;
    this.say('start'); this.setTarget({ x: best.x, y: best.y, name: 'the car', car: true });
  }
  say(kind, at) { const a = LINES[kind]; this.msg = { text: a[this.jobN % a.length].replace('{at}', at || ''), t: 0 }; }
  setTarget(t) { this.target = t; this.route = null; this.routeT = 0; this.offT = 0; }

  // A job stop is a place to pull up at a corner, not the middle of the junction: a point in a travel lane on the block that leads into
  // the corner, a few car lengths short of the stop line. `opts.li` picks the lane (default: the kerb lane on the right).
  planStop(c, opts = {}) {
    const g = this.g, R = g.roads, v = g.player.vehicle; if (!v) return null;
    const at = R.locate(v.x, v.y, v.h); if (!at) return null;
    const r = R.route(at.e, at.dir, c.node); if (!r || !r.length) return null;
    const last = r[r.length - 1], e = last.e, dir = last.dir, n = R.laneCount(e, dir); if (!n || e.len < 30) return null;
    const s = Math.max(Math.min(e.len * 0.5, 12), R.stopS(e, dir) - 17), li = Math.min(n - 1, opts.li !== undefined ? opts.li : n - 1), p = R.lanePos(e, dir, li, s, {});
    if (r.length === 1 && at.s > s - 4) return null;     // already past it on the same block
    if (c.node !== this.home && !R.route(e, dir, this.home)) return null;      // a stop one can only leave by driving off the map is no stop
    let len = -at.s; for (const sg of r) len += sg.e.len; len -= e.len - s;
    return { x: p.x, y: p.y, name: c.name, node: c.node, e, dir, s, li, corner: c, len };
  }
  // the drive from where the car is to the stop: [{e, dir}...], ending on the stop's own block
  findRoute() {
    const g = this.g, R = g.roads, v = g.player.vehicle, T = this.target; const at = R.locate(v.x, v.y, v.h); if (!at) return null;
    let segs;
    if (at.e === T.e && at.dir === T.dir && at.s < T.s + 6) segs = [{ e: at.e, dir: at.dir }];
    else { segs = R.route(at.e, at.dir, R.startNode(T.e, T.dir)); if (!segs) return null; if (segs[segs.length - 1].e !== T.e) segs.push({ e: T.e, dir: T.dir }); }
    let len = -at.s; for (const sg of segs) len += sg.e.len; len -= T.e.len - T.s;
    return { segs, s0: at.s, end: { s: T.s, li: T.li }, id: ++this.routeId, len };
  }
  // keep the route current: drop the blocks already driven; plan again only when the car has really left it
  trackRoute(dt) {
    const g = this.g, v = g.player.vehicle, T = this.target, r = this.route;
    if (!r) { this.route = this.findRoute(); return; }
    const pr = (sg) => (sg.dir > 0 ? sg.e.line : sg.e.rev).project(v.x, v.y);
    const a = pr(r.segs[0]), b = r.segs[1] ? pr(r.segs[1]) : null;
    if (b && (b.d < a.d - 0.5 || a.s >= r.segs[0].e.len - 0.5) && b.s > 0.5) { r.segs.shift(); r.s0 = b.s; }
    else { r.s0 = Math.max(r.s0, a.s); }
    const d = Math.min(a.d, b ? b.d : 1e9), wide = r.segs[0].e.width / 2 + 6;
    const wrongWay = r.segs.length === 1 && a.s > T.s + 12;
    if (d > wide || wrongWay) { this.offT += dt * 5; if (this.offT > 1 || wrongWay) { this.offT = 0; this.route = this.findRoute() || this.route; } } else this.offT = 0;
  }
  nextCorner(minD, maxD, from) {
    // a corner the right distance away whose drive is not a tour of the one-way system (the first tries insist on a fairly direct one)
    for (let k = 0, got = 0; k < 400 && got < 14; k++) { const c = this.corners[Math.floor(this.rand() * this.corners.length)]; const d = Math.hypot(c.x - from.x, c.y - from.y); if (d > minD && d < maxD) { const t = this.planStop(c); got++; if (t && (t.len < d * (got < 9 ? 1.9 : 3) + 80)) return t; } }
    for (const c of this.corners) { const t = this.planStop(c); if (t) return t; }
    return null;
  }
  first(ave, st, opts) { const c = this.byName(ave, st); return c ? this.planStop(c, opts) : null; }
  startPickup() {
    const g = this.g, pl = g.player; let t = null;
    // job 1: the package waits where Broadway meets 23rd Street, under the prow of the Flatiron Building
    if (this.jobN === 0) t = this.first('Broadway', 'E 23rd', { li: 0 });
    t = t || this.nextCorner(180, 420, pl); if (!t) return;
    this.state = 'pickup'; this.setTarget(t); this.say('pickup', t.name);
  }
  startDeliver() {
    const g = this.g, pl = g.player; let t = null;
    if (this.jobN === 0) t = this.first(...FIRST_DROP);
    t = t || this.nextCorner(420, 900, pl); if (!t) return;
    this.state = 'deliver'; this.setTarget(t); this.say('deliver', t.name); this.penalty = 0;
    this.route = this.findRoute(); const len = this.route ? this.route.len : Math.hypot(t.x - pl.x, t.y - pl.y) * 1.4;
    // the clock: the drive at a fair pace, plus a light's worth for every signal met off the avenue's green wave (coming up a side
    // street, or straight after a turn); the first job is tighter
    let lights = 0; if (this.route) this.route.segs.forEach((sg, k) => { const nd = g.roads.nodes[g.roads.endNode(sg.e, sg.dir)], pv = this.route.segs[k - 1]; if (nd.sig && nd.e.length >= 3 && k < this.route.segs.length - 1 && (!sg.e.ave || (pv && !pv.e.ave))) lights++; });
    this.timer = Math.round(this.jobN === 0 ? 30 + len / 9 : 30 + len / 7 + lights * 24); this.timer0 = this.timer;
  }
  onEnter(v) { if (this.state === 'start') { this.jobN = 0; this.startPickup(); } }
  onExit() {}
  onCrash(f) { if (this.state === 'deliver') this.penalty += Math.round(f * 4); }
  onPedHit() { if (this.state === 'deliver') this.penalty += 60; }

  step(dt) {
    const g = this.g, pl = g.player, T = this.target; this.t += dt;
    if (this.msg) { this.msg.t += dt; if (this.msg.t > 7) this.msg = null; }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 4.5) this.banner = null; }
    if (this.state === 'wait') { this.hold -= dt; if (this.hold <= 0) { this.hold = 0; if (pl.vehicle) { this.startPickup(); if (this.state === 'wait') this.hold = 1; } else { this.state = 'start'; const c = g.vehicles.find((v) => v.mission) || g.vehicles[0] || this.car; this.setTarget({ x: c.x, y: c.y, name: 'the car', car: true }); } } return; }
    if (!T) return;
    const d = Math.hypot(T.x - pl.x, T.y - pl.y); this.dist = d;
    // keep a driving route to the stop for the map and the autopilot
    this.routeT -= dt;
    if (pl.vehicle && T.e && this.routeT <= 0) { this.routeT = 0.2; this.trackRoute(0.2); }
    if (this.state === 'deliver') {
      this.timer -= dt;
      if (this.timer <= 0) { this.banner = { title: 'JOB FAILED', sub: 'The client walked', t: 0, bad: true }; this.say('late'); g.sound.fail(); this.jobN++; this.state = 'wait'; this.hold = 4; this.target = null; this.route = null; return; }
    }
    if ((this.state === 'pickup' || this.state === 'deliver') && pl.vehicle && d < STOP_R && Math.hypot(pl.vehicle.vx, pl.vehicle.vy) < 1.2) {
      this.hold += dt;
      if (this.hold > 1.1) {
        this.hold = 0;
        if (this.state === 'pickup') { g.sound.blip(); this.startDeliver(); }
        else { const pay = Math.max(60, Math.round((240 + this.timer * 9 - this.penalty) / 5) * 5); g.cash += pay; this.banner = { title: 'JOB DONE', sub: '+$' + pay.toLocaleString('en-US'), t: 0 }; this.say('done'); g.sound.win(); this.jobN++; this.state = 'wait'; this.hold = 3; this.target = null; this.route = null; }
      }
    } else this.hold = Math.max(0, this.hold - dt);
    if (this.state === 'start' && T.car) { const c = g.vehicles.find((v) => v.mission) || this.car; T.x = c.x; T.y = c.y; }
  }
  draw() {
    const T = this.target, m = this.marker; m.visible = !!T; if (!T) return;
    // the beam: tall enough to find the target from the street ("collect the package objective unclear", "there is no package": at 7 m nobody saw it),
    // short when the camera is high (from the air a tall beam read as a yellow line up past the roofs)
    { const cy = this.g.world.camera.position.y, hgt = cy > 45 ? 7 : cy > 20 ? 7 + (45 - cy) * 1.3 : 40, b = m.children[1]; if (b) { b.scale.y = hgt / 7; b.position.y = hgt / 2; } }
    m.position.set(T.x, T.car ? 1.8 : 0.3, -T.y); const s = T.car ? 0.25 : 1.3; this.ring.scale.set(s, 1, s); this.ring.material.opacity = 0.4 + 0.2 * Math.sin(this.t * 4);
  }
}
