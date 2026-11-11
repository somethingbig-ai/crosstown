// game.js: the game itself. Sim in map metres at a fixed 60 Hz step; three.js draws it.
import * as THREE from 'three';
import { StaticWorld, Roads, clamp, lerp, wrapPi, rng, TAU } from './geo.js';
import { Kit, CarBatch, FigureBatch, bakeFigure, addProps, CAR_TYPES, PAINTS } from './models.js';
import { Traffic, Parked, Peds } from './traffic.js';
import { Hud } from './hud.js';
import { Missions } from './mission.js';
import { Autopilot } from './demo.js';
import { Sound } from './audio.js';
import { Fly } from './fly.js';

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
    const sp = this.spec, c = Math.cos(this.h), s = Math.sin(this.h);
    let vf = this.vx * c + this.vy * s, vs = this.vx * s - this.vy * c;   // forward, rightward
    const maxSteer = lerp(0.62, 0.10, clamp(Math.abs(vf) / 42, 0, 1) ** 0.7);
    this.steer += ((inp.lock !== undefined ? inp.lock : inp.steer * maxSteer) - this.steer) * Math.min(1, dt * (inp.lock !== undefined ? 14 : 7));     // inp.lock: the player's wheel angle in radians (readInput); traffic and the autopilot still give steer -1..1
    let acc = 0;
    if (inp.throttle > 0) acc += vf < -0.5 ? 16 * inp.throttle : inp.throttle * sp.acc * Math.max(0, 1 - (vf / sp.top) ** 2) * (vf < 8 ? 1.15 : 1);
    if (inp.brake > 0) { if (vf > 0.6) acc -= 15 * inp.brake; else acc -= inp.brake * sp.acc * 0.6 * Math.max(0, 1 + vf / 11); }
    acc -= 0.12 * vf + 0.0042 * vf * Math.abs(vf) + (inp.throttle === 0 && inp.brake === 0 ? Math.sign(vf) * 0.5 : 0);
    if (!g.statics.onRoadFast) { /* placeholder for surface */ }
    const onWalk = g.statics.onSidewalk(this.x, this.y);
    if (inp.handbrake) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 5.5);
    vf += acc * dt; this.acc = acc; this.braking = inp.brake > 0.03 || !!inp.handbrake;
    // tyres: sideways speed bleeds off with grip; the handbrake (or too much speed in a turn) lets the tail go
    const latDemand = Math.abs(vf * vf * Math.tan(this.steer) / this.def.wheelbase);
    let grip = sp.grip * (inp.handbrake ? 0.22 : 1); { const lim = inp.latLim || 11; if (latDemand > lim) grip *= clamp(lim / latDemand, 0.45, 1); }
    const vs0 = vs; vs *= Math.exp(-grip * dt); this.slip = Math.abs(vs);
    let yaw = (vf * Math.tan(this.steer)) / this.def.wheelbase; if (inp.handbrake) yaw *= 1.45;
    this.yawV += (yaw - this.yawV) * Math.min(1, dt * 12);
    this.h = wrapPi(this.h + this.yawV * dt);
    this.vx = vf * c + vs * s; this.vy = vf * s - vs * c;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vf = vf; this.vs = vs;
    // body against walls, poles and parked cars: three circles down the length
    const L = this.def.len, r = this.def.wid * 0.5; let hit = 0;
    for (const o of [L * 0.3, 0, -L * 0.3]) {
      const cx = this.x + Math.cos(this.h) * o, cy = this.y + Math.sin(this.h) * o;
      if (g.statics.resolve(cx, cy, r, _o)) {
        const px = _o.x - cx, py = _o.y - cy; this.x += px; this.y += py;
        const vn = this.vx * _o.nx + this.vy * _o.ny;
        if (vn < 0) { this.vx -= vn * 1.25 * _o.nx; this.vy -= vn * 1.25 * _o.ny; const tx = -_o.ny, ty = _o.nx, vt = this.vx * tx + this.vy * ty; this.vx -= vt * 0.12 * tx; this.vy -= vt * 0.12 * ty;
          this.h = wrapPi(this.h + clamp((Math.cos(this.h) * _o.ny - Math.sin(this.h) * _o.nx) * o * vn * 0.012, -0.08, 0.08)); hit = Math.max(hit, -vn); }
      }
    }
    if (hit > 2.5) { this.damage += hit; this.hitT = 0.35; g.onCrash(this, hit); }
    this.hitT = Math.max(0, this.hitT - dt);
    this.spin += (vf * dt) / this.def.radius;
    const tz = onWalk ? 0.15 : 0; this.z += (tz - this.z) * Math.min(1, dt * 14);
    const latA = vf * this.yawV;
    this.roll += (clamp(-latA * 0.0065, -0.07, 0.07) - this.roll) * Math.min(1, dt * 6);
    this.pitch += (clamp(-acc * 0.0042, -0.045, 0.045) - this.pitch) * Math.min(1, dt * 6);
  }
}

export class Game {
  constructor(world, params) {
    this.world = world; this.P = params; this.city = world.city; this.t = 0; this.frame = 0;
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: false, mx: 0, my: 0, run: false, use: false, lookX: 0, lookY: 0 };
    this.keys = new Set(); this.vehicles = []; this.focus = { x: 0, y: 0 };
    this.bounds = { x: this.city.meta.px - 6, y: this.city.meta.py - 6 };
    this.cam = { yaw: 0, pitch: 0.18, dist: 5, x: 0, y: 0, z: 2, fov: 55, shake: 0, mode: 'foot', lookT: 9 };
    this.demo = params.has('demo'); this.capture = params.has('capture'); this.cash = 0; this.paused = false;
  }

  async init() {
    const city = this.city, w = this.world;
    this.kit = new Kit(); await this.kit.load();
    this.roads = new Roads(city);
    // blocks that run along or beyond the edge of the playable map (there is an invisible wall there) are not for routes
    for (const e of this.roads.edges) e.out = e.pts.some((p) => Math.abs(p[0]) > this.bounds.x - 9 || Math.abs(p[1]) > this.bounds.y - 9);
    const st = (this.statics = new StaticWorld(16));
    for (const b of city.buildings) if (b.minh < 2.5) { st.addPoly(b.poly); for (const h of b.holes || []) st.addPoly(h); }
    for (const b of city.blocks) st.addBlock(b);
    // the edge of the map: an invisible wall
    const bx = this.bounds.x + 6, by = this.bounds.y + 6; st.addPoly([[-bx, -by], [bx, -by], [bx, by], [-bx, by]]);
    // rooftop kit: water tanks and plant on mid-rise roofs
    const r = rng(5), extra = { watertower: [], ac: [] };
    for (const b of city.buildings) {
      if (b.part || b.minh > 0 || b.area < 180) continue; const cx = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length, cy = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length;
      if (b.h > 22 && b.h < 95 && b.style !== 2 && r() < 0.55) extra.watertower.push([cx + (r() - 0.5) * 3, cy + (r() - 0.5) * 3, r() * TAU, 0.9 + r() * 0.3, b.h]);
      const n = b.area > 600 ? 3 : 1; for (let i = 0; i < n; i++) if (r() < 0.7) extra.ac.push([cx + (r() - 0.5) * Math.sqrt(b.area) * 0.5, cy + (r() - 0.5) * Math.sqrt(b.area) * 0.5, city.meta.grid_deg * Math.PI / 180 + Math.PI / 2, 1 + r(), b.h]);
    }
    extra.tree2 = []; city.props.tree = city.props.tree.filter((p) => { if (p[3] > 1.3) { extra.tree2.push([p[0], p[1], p[2], p[3] * 0.7]); return false; } return true; });
    for (const p of city.props.signal) { p[6] = Math.PI; }
    // a street light planted within a stride of a signal pole reads as a doubled pole: the signal keeps the corner
    if (city.props.light && city.props.signal) city.props.light = city.props.light.filter((l) => !city.props.signal.some((p) => Math.abs(p[0] - l[0]) < 3 && Math.abs(p[1] - l[1]) < 3 && Math.hypot(p[0] - l[0], p[1] - l[1]) < 3));
    // street furniture that the map data left standing in a travel lane (medians and forks confuse the placement) is taken away:
    // a pole in the lane is a wall for the player and nothing the traffic knows about
    this.propsDropped = 0; for (const k of ['light', 'tree', 'signal', 'hydrant', 'bin', 'meter', 'newsbox']) if (city.props[k]) city.props[k] = city.props[k].filter((p) => { if (this.roads.inLane(p[0], p[1], 0.45)) { this.propsDropped++; return false; } return true; });
    for (const k of ['light', 'tree', 'signal', 'hydrant']) for (const p of city.props[k] || []) st.addCircle(p[0], p[1], k === 'tree' ? 0.22 : k === 'hydrant' ? 0.2 : 0.14, k);
    this.propMeshes = addProps(w.scene, this.kit, city, extra);
    this.setupSignals();
    this.dressing = await (await import('./dressing.js')).addDressing(this);   // street dressing layer (pipeline/dressing)
    this.batches = {}; for (const t of CAR_TYPES) if (this.kit.cars[t]) this.batches[t] = new CarBatch(w.scene, this.kit.cars[t], t === 'bus' ? 16 : 340);
    this.parked = new Parked(this); this.traffic = new Traffic(this); this.peds = new Peds(this);
    // someone at the wheel of every car in traffic near the camera: seated figures baked from the Drive pose
    this.drivers = [];
    if (!this.P.has('nodrivers') && this.kit.person && this.kit.pedKinds) for (const k of this.kit.pedKinds().slice(0, 3)) { let parts = null; try { parts = bakeFigure(this.kit, k, 'drive'); } catch (e) { console.log('[game] no driver figure from ' + k + ': ' + e.message); } if (parts) { const fb = new FigureBatch(w.scene, parts, this.kit.peopleExport ? 8 : 36); fb.who = k; this.drivers.push(fb); } }
    this.hud = new Hud(this); this.sound = new Sound(this);
    this.player = { x: -196, y: -214, h: 2.0, vehicle: null, speed: 0, vis: null, animT: 0, enterT: 0 };
    this.missions = new Missions(this);
    this.setupPlayer();
    this.autopilot = new Autopilot(this);
    this.focus.x = this.player.x; this.focus.y = this.player.y;
    this.traffic.populate(this.player.x, this.player.y);
    for (let i = 0; i < 44; i++) this.peds.spawn(this.player.x, this.player.y, true);
    this.cam.yaw = this.player.h; this.snapCamera();
    this.bindInput();
    this.fly = new Fly(this);
    this.streets = this.P.get('streets') === 'none' ? null : await (await import('./streets.js')).addStreets(this);
    // the people lane's crowd (hundreds of GPU-instanced walkers); with it on, the game's own heavy skinned pedestrians (about 0.3 ms each on the M2 Pro) drop to a handful near the player
    this.crowd = this.P.get('crowd') === 'none' ? null : await (await import('./crowd.js')).addCrowd(this).catch((e) => { console.log('[crowd] not loaded: ' + (e && e.message)); return null; });
    if (this.crowd && !this.P.has('peds')) { this.peds.target = 14; while (this.peds.list.length > 14) { const q = this.peds.list.pop(); q.vis.used = false; q.vis.object.visible = false; } }
    if (this.P.has('peds')) { this.peds.target = +this.P.get('peds'); while (this.peds.list.length > this.peds.target) { const q = this.peds.list.pop(); q.vis.used = false; q.vis.object.visible = false; } }     // ?peds=0: nobody, from the first frame (the scene gauntlet's no-people captures)
    this.budget = new (await import('./budget.js')).Budget(this);     // the streets lane's layer (ground, trees, furniture, storefronts, vehicles)
    // heli lane: the helicopter (src/heli/). ?heli=none leaves it out.
    this.heli = this.P.get('heli') === 'none' ? null : await (await import('./heli/heli.js')).addHeli(this).catch((e) => { console.log('[heli] not loaded: ' + (e && (e.stack || e.message))); return null; });
    try { (await import('./pedhit.js')).install(this); } catch (e) { console.log('[game] pedhit not loaded: ' + (e && e.message)); }     // item 14: pedestrian hits (ragdoll) from nyc-breakable; ?pedhit=0 off
    try { await (await import('./entry/entry.js')).addEntry(this); } catch (e) { console.log('[entry] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: real car entry and exit (door, seat, camera); ?entry=0 off
    try { (await import('./feedback.js')).install(this); } catch (e) { console.log('[game] feedback not loaded: ' + (e && e.message)); }     // lead: Feedback link + session trace (src/feedback.js)
    if (!/^(0|none|off)$/.test(this.P.get('guns') || '')) try { this.combat = await (await import('./combat/combat.js')).addCombat(this); } catch (e) { console.log('[guns] not loaded: ' + (e && (e.stack || e.message))); }     // gameplay lane: guns v1 (src/combat/, pistol and rifle); ?guns=0 off (nothing fetched)
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
    addEventListener('keydown', (e) => { if (e.repeat) return; K.add(e.code); if (e.code === 'KeyF' || e.code === 'Enter') this.input.use = true; if (e.code === 'KeyP') this.paused = !this.paused; if (e.code === 'KeyM') this.sound.toggle(); this.sound.unlock(); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => K.delete(e.code));
    const c = this.world.renderer.domElement;
    c.addEventListener('click', () => { this.sound.unlock(); if ((!this.demo || this.fly.on) && document.pointerLockElement !== c) c.requestPointerLock?.(); });
    // Matt 18:10: the mouse must be clearly free to look. It looks around whether or not the pointer is captured, and the first movement key
    // captures it (before, only a click on the picture did, so with no click the mouse did nothing).
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === c || (!this.demo && document.hasFocus())) { this.input.lookX += e.movementX; this.input.lookY += e.movementY; } });
    addEventListener('keydown', (e) => { if (!e.repeat && /^(Key[WASD]|Arrow)/.test(e.code) && !this.demo && document.pointerLockElement !== c) { try { const pr = c.requestPointerLock?.(); if (pr && pr.catch) pr.catch(() => {}); } catch (err) {} } });
    addEventListener('blur', () => K.clear());
  }
  readInput() {
    const K = this.keys, I = this.input; const ax = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0);
    const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    I.steer = clamp(ax('KeyA', 'KeyD') + ax('ArrowLeft', 'ArrowRight') - (gp ? (Math.abs(gp.axes[0]) > 0.12 ? gp.axes[0] : 0) : 0), -1, 1);
    I.throttle = clamp((K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) + (gp ? gp.buttons[7].value : 0), 0, 1); I.brake = clamp((K.has('KeyS') || K.has('ArrowDown') ? 1 : 0) + (gp ? gp.buttons[6].value : 0), 0, 1);
    I.handbrake = K.has('Space') || !!(gp && gp.buttons[0].pressed); I.run = K.has('ShiftLeft') || K.has('ShiftRight');
    I.mx = I.steer; I.my = ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown');
    if (gp) { if (Math.abs(gp.axes[1]) > 0.15) I.my = clamp(I.my - gp.axes[1], -1, 1); if (Math.abs(gp.axes[2]) > 0.12) I.lookX += gp.axes[2] * 14; if (gp.buttons[3].pressed && !this._gpUse) I.use = true; this._gpUse = gp.buttons[3].pressed; }
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
      const want = clamp(I.steer, -1, 1), rate = Math.abs(want) < Math.abs(sm) || want * sm < 0 ? 18 : 12; sm += clamp(want - sm, -rate * dt, rate * dt);
      const vf = Math.abs(v.vf || 0), wb = v.def.wheelbase || 2.7, aLat = vf < 9 ? 20 : vf > 20 ? 10.5 : 20 - 9.5 * (vf - 9) / 11;
      I.lock = sm * Math.min(0.70, Math.atan(aLat * wb / Math.max(vf * vf, 6))) * (I.handbrake ? 1.5 : 1); I.latLim = aLat + 1.5; this._sSteer = sm;
    } else { this._sSteer = 0; I.lock = undefined; I.latLim = 0; }
  }

  // ------------------------------------------------------------------ the fixed step
  step(dt) {
    const pl = this.player, I = this.input;
    this.t += dt; this.frame++;
    if (this.demo) this.autopilot.drive(dt, I); else this.readInput();
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
      if (I.use && Math.hypot(v.vx, v.vy) < 3) this.exitVehicle();
    } else if (pl.busy) { this.stepBusy(dt); }
    else {
      // on foot: move relative to the camera
      const mx = I.mx, my = I.my, m = Math.hypot(mx, my);
      let sp = 0;
      if (m > 0.1) {
        const a = this.cam.yaw + Math.atan2(mx, my);    // forward = camera yaw; A (mx=+1) is left
        sp = (I.run ? 5.4 : 1.9) * Math.min(1, m); pl.h += wrapPi(a - pl.h) * Math.min(1, dt * 10);
        const nx = pl.x + Math.cos(pl.h) * sp * dt, ny = pl.y + Math.sin(pl.h) * sp * dt; this.statics.resolve(nx, ny, 0.34, _o); pl.x = _o.x; pl.y = _o.y;
        for (const c of this.traffic.cars) { const dx = pl.x - c.x, dy = pl.y - c.y, d = Math.hypot(dx, dy), R = 1.4; if (d < R && d > 1e-3) { pl.x += (dx / d) * (R - d); pl.y += (dy / d) * (R - d); } }
        for (const c of this.vehicles) { const dx = pl.x - c.x, dy = pl.y - c.y, d = Math.hypot(dx, dy), R = 1.3; if (d < R && d > 1e-3) { pl.x += (dx / d) * (R - d); pl.y += (dy / d) * (R - d); } }
      }
      const vis = pl.vis, wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 };   // the player walks briskly
      pl.speed = sp; this.playerAnim(sp > 3 ? 'run' : sp > 0.2 ? wk.name : 'idle');
      if (vis.mixer) vis.mixer.timeScale = sp > 3 ? sp / (vis.runSpeed || 5.0) : sp > 0.2 ? sp / wk.speed : 1;
      if (I.use && !(heli && heli.tryBoard())) this.tryEnter();
    }
    I.use = false;
    for (const v of this.vehicles) if (v !== pl.vehicle) { v.step(dt, { steer: 0, throttle: 0, brake: 0, handbrake: true }, this); }     // a car nobody is driving stands on its handbrake (the brake pedal is reverse at a standstill)
    this.focus.x = pl.x; this.focus.y = pl.y;
    if (this.fly.on) { this.focus.x = clamp(this.fly.x, -this.bounds.x, this.bounds.x); this.focus.y = clamp(this.fly.y, -this.bounds.y, this.bounds.y); }     // the street life follows the eye
    this.traffic.step(dt, this.t); this.peds.step(dt); this.missions.step(dt);
    this.sigT -= dt; if (this.sigT <= 0) { this.sigT = 0.2; this.updateSignals(); }
    this.updateCamera(dt);
    this.sound.update(dt);
  }

  collideCars(v) {
    // the player's car against moving traffic and other loose cars: push apart, bleed speed, stun the other driver
    const L = v.def.len, r = v.def.wid * 0.5;
    const hitOne = (o, movable) => {
      const oL = o.def.len, orr = o.def.wid * 0.5;
      for (const a of [L * 0.3, -L * 0.3]) for (const b of [oL * 0.28, -oL * 0.28]) {
        const ax = v.x + Math.cos(v.h) * a, ay = v.y + Math.sin(v.h) * a, bx = o.x + Math.cos(o.h) * b, by = o.y + Math.sin(o.h) * b;
        let dx = ax - bx, dy = ay - by; const d = Math.hypot(dx, dy), R = r + orr;
        if (d < R && d > 1e-4) {
          dx /= d; dy /= d; const pen = R - d; v.x += dx * pen; v.y += dy * pen;
          const ovx = movable ? o.vx : Math.cos(o.h) * o.v, ovy = movable ? o.vy : Math.sin(o.h) * o.v; const vn = (v.vx - ovx) * dx + (v.vy - ovy) * dy;
          if (vn < 0) { v.vx -= vn * 1.1 * dx; v.vy -= vn * 1.1 * dy; if (movable) { o.vx += vn * 0.8 * dx; o.vy += vn * 0.8 * dy; } else { o.stun = 1.6; o.v *= 0.4; }
            if (-vn > 2.5) { v.damage += -vn; v.hitT = 0.35; this.onCrash(v, -vn); } }
        }
      }
    };
    for (const c of this.traffic.cars) { if (Math.abs(c.x - v.x) > 12 || Math.abs(c.y - v.y) > 12) continue; hitOne(c, false); }
    for (const c of this.vehicles) if (c !== v && Math.abs(c.x - v.x) < 12 && Math.abs(c.y - v.y) < 12) hitOne(c, true);
  }
  onCrash(v, force) { if (v === this.player.vehicle) { this.cam.shake = Math.min(1, this.cam.shake + force * 0.06); this.sound.crash(force); this.missions.onCrash(force); } }
  onPedHit(p, v) { if (v === this.player.vehicle) { this.sound.thud(); this.missions.onPedHit(); } }

  nearestCar(maxD = 3.6) {
    const pl = this.player; let best = null, bd = maxD;
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
      return { x: v.x, y: v.y, z: v.z + 1.15 * big, dist: (5.6 + sp * 0.045) * big, height: 1.25 * big, fov: 56 + clamp(sp / 45, 0, 1) * 16, yaw: v.h - (Math.abs(v.vf) > 1.5 && v.vf < 0 ? Math.PI : 0) - v.yawV * 0.12, auto: 3.2 + sp * 0.12 }; }
    return { x: pl.x, y: pl.y, z: (pl.alt || (this.statics.onSidewalk(pl.x, pl.y) ? 0.15 : 0)) + 1.5, dist: 3.4, height: 0.35, fov: 52, yaw: pl.h, auto: pl.speed > 0.3 ? 1.2 : 0 };
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
    let cx = C.tx + bx * d * Math.cos(pitch), cy = C.ty + by * d * Math.cos(pitch), cz = C.tz + C.h + d * Math.sin(pitch);
    if (cz < 0.4) cz = 0.4;
    const sh = C.shake * C.shake * 0.25, n = this.frame;
    cam.position.set(cx + Math.sin(n * 1.7) * sh, cz + Math.sin(n * 2.3) * sh, -cy + Math.cos(n * 1.3) * sh);
    const ahead = this.player.vehicle ? 2.2 : 0;
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
      let el = Math.min(0.1, (now - last) / 1000); last = now; ft += el; fc++; if (ft > 0.5) { this.fps = fc / ft; fc = 0; ft = 0;
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
            if (sc < (this._ceil || 1) - 0.01) { this._upFrom = sc; W0.liveScale = Math.min(this._ceil || 1, sc / 0.87); this._upAt = this._govT; this._upBad = 0; this._upKind = 'scale'; window.__fit(); console.log('[game] render scale up to ' + W0.liveScale.toFixed(2)); }
            else if (gg && !gg.enabled && !this._aoCeil && !this.P.has('ao')) { gg.enabled = true; this._upAt = this._govT; this._upBad = 0; this._upKind = 'ao'; this._slow = 0; console.log('[game] ambient occlusion back on'); } } }
        const g = this.world.gtao; if (g && g.enabled && !this.P.has('ao') && !(this.world.aoDepth && (this.world.liveScale || 1) > 0.8 && !this.P.has('px') && window.__fit && !(this.fly && this.fly.on))) {     /* with the cheap depth AO (audit item 2) the picture first gives up a little size, and AO only goes below 0.8 */ this._slow = this.fps < 48 ? (this._slow || 0) + 1 : 0; if (this._slow >= 4) { g.enabled = false; console.log('[game] ambient occlusion pass off to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } } 
        else if (!this.capture && !this.P.has('aa') && this.world.liveAA !== 'fxaa' && !(this.fly && this.fly.on)) { this._slowA = this.fps < 54 ? (this._slowA || 0) + 1 : 0; if (this._slowA >= 4) { this.world.setLiveAA(false); console.log('[game] multisampling off, FXAA on to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } }
        else if (!this.capture && !this.P.has('px') && window.__fit && !(this.fly && this.fly.on)) { const w = this.world; this._slow2 = this.fps < 54 ? (this._slow2 || 0) + 1 : 0; if (this._slow2 >= 5 && (w.liveScale || 1) > 0.64) { w.liveScale = (w.liveScale || 1) * 0.87; this._slow2 = 0; window.__fit(); console.log('[game] render scale ' + w.liveScale.toFixed(2) + ' to hold frame rate (' + this.fps.toFixed(0) + ' fps)'); } } }
      if (this.paused) { this.hud.draw(); return; }
      acc += el; let n = 0; while (acc >= DT && n < 4) { this.step(DT); acc -= DT; n++; } if (n === 4) acc = 0;
      this.renderFrame(el);
      this.jsMs = (this.jsMs || 0) * 0.95 + (performance.now() - now0) * 0.05;     // main-thread time of a live frame (the rest of the frame interval is the GPU's)
    };
    requestAnimationFrame(loop);
  }
}
