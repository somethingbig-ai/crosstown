// wash.js: the air the helicopter moves, made visible. Driven by the flight state (flight.js): the downwash at the disc (f.vi) comes down
// the wake (leaning with the disc, trailing behind in forward flight), meets the surface below and spreads along it (wash/field.js).
//   dust              a sheet of dust scoured outward along the ground, rolling up at its rim, with a haze above: thick over gravel roofs, thin over
//                     lawns and clean paving (which is soon swept bare). A volume, not sprites (wash/dustvol.js: one draw call)
//   debris            leaves, litter, clippings and grit skittering and flying away, smeared by their own speed (wash/particles.js: one draw call)
//   trees             crowns near the aircraft lean away, toss and shiver; a gentle sway from the wind everywhere (uniforms of the tree
//                     shader in src/streets/trees.js: TREE_WIND)
//   water             a fountain in the park by the street pad, and any water registered with addWater(): pressed, roughened, streaked,
//                     its spray lifted and blown away (wash/fountain.js)
//   ground            the lawn pressed flat in racing streaks, streamers of dust along paving (wash/ground.js)
//   engine            heat shimmer behind the exhaust, a haze at light-off, smoke when damaged, sparks and a puff on a strike (wash/heat.js)
// Nothing is simulated or drawn when the wake does not reach a surface (above about three rotor diameters) and nothing is left in the air.
import * as THREE from 'three';
import { pointInPoly } from '../geo.js';
import { WashField } from './wash/field.js';
import { Particles, DUST, MIST, SMOKE, LEAF, SPARK, DROP, GRIT } from './wash/particles.js';
import { DustVolume } from './wash/dustvol.js';
import { Heat } from './wash/heat.js';
import { GroundWash } from './wash/ground.js';
import { buildFountain, waterUniforms, washWater } from './wash/fountain.js';

// the turbine's exhaust: not on the lane's measurement sheet (dims.js), so kept here: aft of the engine cowl on top, blowing back and a little up
const EXHAUST = [-3.02, 2.40, 0], EXH_DIR = [-0.985, 0.17, 0];      // where model/shape.js ends its exhaust pipe (used unless the model says: model.exhaust = [x, y, z] in model space)
const PAVED = 0, PARK = 1, ROOF = 2, WATER = 3;
const DUSTY = [0.14, 0.012, 1.0], SUPPLY_MIN = [0.4, 0.5, 0.8], DEPLETE = [0.02, 0.006, 0.004];     // how much loose dust a surface has, how far it can be swept, how fast
const DCOL = [[0.29, 0.28, 0.26], [0.32, 0.27, 0.2], [0.30, 0.29, 0.27]], DALPHA = [0.26, 0.28, 0.36];
const LEAFC = [[0.16, 0.22, 0.07], [0.2, 0.25, 0.08], [0.42, 0.34, 0.09], [0.3, 0.2, 0.09], [0.22, 0.16, 0.09]];      // seen tumbling, a leaf shows its pale side as often as not
const PAPER = [[0.62, 0.62, 0.58], [0.55, 0.53, 0.46], [0.36, 0.28, 0.18], [0.5, 0.12, 0.1], [0.14, 0.26, 0.42], [0.66, 0.62, 0.2]];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), rnd = Math.random;
const _p = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();

export class Wash {
  constructor(ctx) {
    this.ctx = ctx; const g = (this.g = ctx.game), world = (this.world = ctx.world);
    this.field = new WashField(ctx.DIMS.rotorR, ctx.SPEC.hubY);
    this.P = new Particles(world, 4096); world.scene.add(this.P.mesh);
    this.vol = new DustVolume(world, false); world.scene.add(this.vol.mesh); this.spray = new DustVolume(world, true); world.scene.add(this.spray.mesh);
    this.amps = new Float32Array(16); this.edges = new Float32Array(16).fill(5); this.dcol = [0.4, 0.38, 0.34]; this.dustS = 0; this.sprayS = 0; this.sprayW = null; this.sec = 0;
    this.solids = [];                   // for the flight model: things of ours an aircraft should not pass through, [{ x, y, radius, top }] in map metres (filled when the fountain is placed)
    this.heat = new Heat(world); world.scene.add(this.heat.mesh);
    this.ground = new GroundWash(world); world.scene.add(this.ground.mesh); this.gKind = 0;
    this.flat = (x, z) => { const k = this.surface(x, z); return k >= 0 && k !== WATER && Math.abs(this.sy - this.field.cy) < 0.3; };
    this.waterU = waterUniforms(); this.washWater = washWater; this.waters = []; this.fountain = null; this.fountainTried = false;
    this.parks = (g.city.parks || []).filter((p) => p.ext).map((p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.ext) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { ext: p.ext, x0, y0, x1, y1 }; });
    this.sup = new Float32Array(4096).fill(1); this.supId = new Int32Array(4096); this.supN = 0;
    this.accD = 0; this.accA = 0; this.accC = 0; this.accL = 0; this.accW = 0; this.accS = 0; this.accJ = 0; this.accK = 0; this.lobe = 0; this.lastHit = -1; this.sy = 0; this.lawnY = 0; this.viewDist = 1e9; this.camFountain = 1e9; this.near = false;
    this.wx = 0; this.wy = 0; this.wz = 0; this.tw = new THREE.Vector2(1.6, 0.7); this.uS = 0; this.treeWind = null; this.groundAt = null;
    // the tree shader's wind uniforms (our small addition to the streets lane's trees.js); without it the trees simply stand still
    import('../streets/trees.js').then((m) => { this.treeWind = m.TREE_WIND || null; if (!this.treeWind) console.log('[heli] wash: this trees.js has no TREE_WIND, trees stay still'); }).catch(() => {});
  }

  // Register a water surface: a disc at map (x east, y north), surface level z (metres up), of a radius. The wash lifts spray from it.
  // For the surface itself to answer (dish, streaks, foam), give its material to wash.washWater(material, wash.waterU, { x, z: -y, radius }).
  addWater(w) { const o = { x: w.x, zt: -w.y, level: w.z, radius: w.radius, hole: w.hole || 0 }; this.waters.push(o); return o; }

  inPark(x, y) { for (const p of this.parks) if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && pointInPoly(x, y, p.ext)) return true; return false; }
  // what lies at a point near the wash: PAVED, PARK, ROOF or WATER, its height in this.sy; -1 for a wall or a drop
  surface(x, z) {
    const fl = this.field;
    for (const w of this.waters) { const d = Math.hypot(x - w.x, z - w.zt); if (d < w.radius + 0.5) { this.sy = w.level; return Math.abs(w.level - fl.cy) < 2.5 ? WATER : -1; } }
    const top = this.groundAt(x, z, fl.hy);
    if (top > 0.5 ? Math.abs(top - fl.cy) > 1.2 : fl.cy > 1.5) return -1;
    this.sy = top > 0.5 ? top : fl.cy;
    if (top > 2.5) return ROOF;
    if (this.inPark(x, -z)) { if (this.lawnY > this.sy) this.sy = this.lawnY; return PARK; }      // the lawn is drawn a little above the ground the flight model knows
    return PAVED;
  }
  // loose dust left on a 3 m patch of the surface (1 = untouched), taking a little
  take(x, z, kind) {
    const ix = Math.floor(x / 3), iz = Math.floor(z / 3), i = ((ix & 63) << 6) | (iz & 63), id = (ix * 73856093) ^ (iz * 19349663);
    if (this.supId[i] !== id) { this.supId[i] = id; this.sup[i] = 1; }
    const s = this.sup[i]; this.sup[i] = Math.max(SUPPLY_MIN[kind], s - DEPLETE[kind]); return s;
  }

  placeFountain(heli) {
    this.fountainTried = true;
    try {
      const g = this.g, pad = heli.pads[0], H = heli.heights, trunks = [];
      const st = g.streets && g.streets.parts && g.streets.parts.trees && g.streets.parts.trees.trees;
      if (st) { for (const t of st) if (!t.skip) trunks.push(t.x, t.y); } else for (const m of g.propMeshes || []) if (['tree', 'tree2'].includes(m.userData.kind)) for (const q of m.userData.items) trunks.push(q[0], q[1]);
      for (const m of g.propMeshes || []) if (['light', 'signal'].includes(m.userData.kind)) for (const q of m.userData.items) trunks.push(q[0], q[1]);
      let best = null;
      for (let d = 17; d <= 220 && !best; d += 1.5) for (let a = 0; a < 48 && !best; a++) {
        const an = pad.h + Math.PI + a * Math.PI / 24, x = pad.x + Math.cos(an) * d, y = pad.y + Math.sin(an) * d; let ok = this.inPark(x, y) && H.top(x, y, 1e4) < 0.5;
        for (let k = 0; k < 8 && ok; k++) { const px = x + Math.cos(k * Math.PI / 4) * 6.2, py = y + Math.sin(k * Math.PI / 4) * 6.2; ok = this.inPark(px, py) && H.top(px, py, 1e4) < 0.5 && !(g.roads && g.roads.inLane && g.roads.inLane(px, py, 1)); }
        for (let k = 0; k < trunks.length && ok; k += 2) if (Math.abs(trunks[k] - x) < 9.5 && Math.abs(trunks[k + 1] - y) < 9.5 && Math.hypot(trunks[k] - x, trunks[k + 1] - y) < 8.5) ok = false;
        if (ok) best = { x, y, d };
      }
      if (!best) { console.log('[heli] wash: no clear spot for the fountain near the street pad'); return; }
      // the lawn's own height there
      let gy = H.top(best.x, best.y, 2); const grass = [];
      if (this.world.cityRoot) this.world.cityRoot.traverse((o) => { if (o.isMesh && /^grass/.test(o.name)) grass.push(o); });
      if (grass.length) { const rc = new THREE.Raycaster(new THREE.Vector3(best.x, 40, -best.y), new THREE.Vector3(0, -1, 0)), hit = rc.intersectObjects(grass, false); if (hit.length) gy = hit[0].point.y; }
      this.lawnY = gy;                    // the lawns are drawn a little above the height the flight model lands on
      const F = (this.fountain = buildFountain(this.world, this.waterU, best.x, gy, -best.y)); F.mapX = best.x; F.mapY = best.y; F.fromPad = best.d;
      if (g.statics && g.statics.addCircle) g.statics.addCircle(best.x, best.y, 3.75, 'fountain');
      this.addWater({ x: best.x, y: best.y, z: F.level, radius: F.radius, hole: 0.7 });
      this.solids.push({ x: best.x, y: best.y, radius: 1.0, top: gy + 1.22 }, { x: best.x, y: best.y, radius: 3.65, top: gy + 0.52 });      // the centre bowl and its nozzle; the basin to its rim
      this.lawnFlight = H.top(best.x + 9, best.y, 2);
      console.log('[heli] wash: fountain at map ' + best.x.toFixed(1) + ', ' + best.y.toFixed(1) + ' (' + best.d.toFixed(0) + ' m from the street pad), ground ' + gy.toFixed(2));
    } catch (e) { console.log('[heli] wash: fountain not built: ' + (e && (e.stack || e.message))); }
  }

  // ------------------------------------------------------------------ every fixed step
  step(f, dt, heli) {
    if (!this.groundAt) { const H = heli.heights, Wt = this.waters;      // the ground as the wash meets it: over a basin of ours that is the water, not the stone the flight model lands on
      this.groundAt = (x, z, yq) => { for (let i = 0; i < Wt.length; i++) { const w = Wt[i], dx = x - w.x, dz = z - w.zt; if (dx * dx + dz * dz < (w.radius + 0.6) * (w.radius + 0.6)) return w.level; } return H.top(x, -z, yq); }; }
    if (!this.fountainTried && heli.pads) this.placeFountain(heli);
    this.live = 4; this.uS += ((this.field.on ? this.field.U : 0) - this.uS) * Math.min(1, dt * 2.5); if (this.uS < 0.05) this.uS = 0;      // (fl.on is last step's here: near enough)
    const fl = this.field, P = this.P; fl.update(f, this.groundAt);
    this.dustS = fl.on ? clamp((fl.U - 4) / 9, 0, 1) : 0; if (!fl.on) this.sprayW = null;
    if (this.dustS > 0 || this.vol.s > 0) this.vol.step(dt, fl, this.dustS, this.amps, this.dcol, null, this.edges);
    if (this.sprayW || this.spray.s > 0) this.spray.step(dt, fl, this.sprayW ? this.dustS : 0, null, SPRAYC, this.sprayW);
    const busy = fl.on || P.n > 0 || this.heat.n > 0 || f.n1 > 0.02 || f.damage > 0.6 || (this.fountain && this.camFountain < 70);
    if (!busy) return;
    const w = heli.wind.at(_p.set(f.pos.x, f.surface + 2, f.pos.z), f.t, 2, heli.heights.skyline(f.pos.x, -f.pos.z)); this.wx = w.x; this.wy = w.y * 0.3; this.wz = w.z;
    if ((this.supN++ & 31) === 0) { const s = this.sup; for (let i = 0; i < 4096; i++) s[i] += (1 - s[i]) * 0.012; }      // dust settles back over half a minute
    if (fl.on && fl.U > 4) { this.emit(f, dt); if ((this.sec++ & 7) === 0) this.sectors(); }
    this.engine(f, dt);
    if (f.onGround && f.nr > 0.2) this.scrape(f, dt);
    if (this.fountain && this.camFountain < 70) this.jet(dt);
    if (P.n) P.step(dt, fl.U > 0 ? fl : OFF, this.wx, this.wy, this.wz, this.groundAt);
  }

  emit(f, dt) {
    const fl = this.field, P = this.P, R = fl.R, tt = P.t, e0 = Math.min(1, (fl.U - 4) / 12) * (0.7 + 0.45 * Math.sin(tt * 1.9 + 2 * Math.sin(tt * 0.7)));      // it comes in surges, as the air does
    this.lobe += dt * 0.7;
    // billows inside the dust volume: where the outwash slows and rolls up, a few lit lumps that tumble and thin (the volume gives the continuous veil, these its relief)
    this.accD += 60 * dt * e0;
    while (this.accD >= 1) {
      this.accD -= 1;
      const th = rnd() * 6.2832, r = R * (1.3 + 1.6 * rnd()), c = Math.cos(th), s = Math.sin(th), x = fl.cx + c * r, z = fl.cz + s * r, kind = this.surface(x, z);
      if (kind < 0 || kind === WATER) continue;
      const u = fl.speedAt(x, z); if (u < 3) continue;
      const col = this.dcol, k = 0.85 + 0.3 * rnd(), D = Math.pow(DUSTY[kind] * this.take(x, z, kind), 0.7); if (D < 0.1) continue;
      P.spawn(DUST, x, this.sy + 0.5, z, c * u * 0.4 + (rnd() - 0.5) * 1.5, 0.8 + rnd() * 1.6, s * u * 0.4 + (rnd() - 0.5) * 1.5, 2.2 + rnd() * 2, 1.2 + rnd() * 0.6, 3.0 + rnd() * 2, col[0] * k, col[1] * k, col[2] * k, 0.42 * D * (0.7 + 0.6 * rnd()), this.sy);
    }
    // on a lawn: clippings and chaff, small and many, whipped out from under the rotor
    if (this.gKind === PARK) { this.accC += 260 * dt * e0;
      while (this.accC >= 1) { this.accC -= 1; if (P.n > P.cap - 300) break;
        const th = rnd() * 6.2832, r = R * (0.3 + 2.0 * rnd()), c = Math.cos(th), s = Math.sin(th), x = fl.cx + c * r, z = fl.cz + s * r, u = fl.speedAt(x, z); if (u < 5 || this.surface(x, z) !== PARK) continue;
        const k = 0.6 + 0.8 * rnd(), sz = 0.018 + 0.03 * rnd(), y = rnd() < 0.5;
        P.spawn(LEAF, x, this.sy + 0.05, z, c * u * 0.5, 0.8 + rnd() * 2.6, s * u * 0.5, 1.0 + rnd() * 1.2, sz, sz, (y ? 0.3 : 0.1) * k, (y ? 0.27 : 0.16) * k, (y ? 0.1 : 0.05) * k, 1, this.sy); } }
    // leaves, litter, grit: lying there until the air gets under them
    this.accL += (this.gKind === PARK ? 160 : this.gKind === ROOF ? 170 : 60) * dt * e0;
    while (this.accL >= 1) {
      this.accL -= 1; if (P.n > P.cap - 500) break;
      const th = rnd() * 6.2832, r = R * (0.5 + 2.4 * rnd()), x = fl.cx + Math.cos(th) * r, z = fl.cz + Math.sin(th) * r, kind = this.surface(x, z);
      if (kind < 0 || kind === WATER || fl.speedAt(x, z) < 4.5) continue;
      const q = rnd(), y = this.sy + 0.02;
      if (kind === PARK ? q < 0.9 : kind === PAVED ? q < 0.3 : q < 0.12) { const c = LEAFC[(rnd() * LEAFC.length) | 0], k = 0.7 + 0.6 * rnd(), s = 0.04 + 0.05 * rnd(); P.spawn(LEAF, x, y, z, 0, 0, 0, 2.5 + rnd() * 2.5, s, s, c[0] * k, c[1] * k, c[2] * k, 1, this.sy); }
      else if (kind === PAVED && q < 0.62) { const c = PAPER[(rnd() * rnd() * PAPER.length) | 0], k = 0.75 + 0.4 * rnd(), s = 0.09 + 0.16 * rnd() * rnd(); P.spawn(LEAF, x, y, z, 0, 0, 0, 3.5 + rnd() * 3, s, s, c[0] * k, c[1] * k, c[2] * k, 1, this.sy); }
      else if (kind === ROOF && q > 0.9) { const c = PAPER[(rnd() * rnd() * 3) | 0], k = 0.6 + 0.4 * rnd(), s = 0.05 + 0.08 * rnd() * rnd(); P.spawn(LEAF, x, y, z, 0, 0, 0, 3 + rnd() * 3, s, s, c[0] * k, c[1] * k, c[2] * k, 1, this.sy); }
      else if (kind === ROOF && q < 0.8) { const k = 0.05 + 0.1 * rnd(), s = 0.03 + 0.03 * rnd(); P.spawn(GRIT, x, y, z, 0, 0, 0, 3 + rnd() * 3, s, s, k * 1.05, k, k * 0.92, 1, this.sy); }
    }
    // spray off any water the wash reaches
    for (const w of this.waters) {
      if (Math.hypot(w.x - fl.cx, w.zt - fl.cz) > w.radius + 4 * R || Math.abs(w.level - fl.cy) > 2.5) continue;
      this.accW += 420 * dt * e0 * Math.min(1, w.radius * w.radius / 12);
      while (this.accW >= 1) {
        this.accW -= 1;
        const a = rnd() * 6.2832, rr = w.radius * Math.sqrt(rnd()); if (rr < w.hole) continue;
        const x = w.x + Math.cos(a) * rr, z = w.zt + Math.sin(a) * rr, u = fl.speedAt(x, z); if (u < 4.5) continue;
        const e = Math.min(1, (u - 4.5) / 8); if (rnd() > e * e) continue;
        const dx = x - fl.cx, dz = z - fl.cz, dl = Math.hypot(dx, dz) || 1, ex = dx / dl, ez = dz / dl, k = 0.9 + 0.2 * rnd();
        P.spawn(DROP, x, w.level + 0.03, z, ex * u * 0.5 + (rnd() - 0.5) * 3, 1.0 + rnd() * 2.2, ez * u * 0.5 + (rnd() - 0.5) * 3, 0.3 + rnd() * 0.4, 0.008 + 0.01 * rnd(), 0.012, 0.62 * k, 0.66 * k, 0.68 * k, 0.2, w.level);
      }
    }
  }

  // how much loose dust lies each way round the compass (and its colour), for the dust volume; and whether there is water to lift spray from
  sectors() {
    const fl = this.field, R = fl.R, A = this.amps, C = this.dcol; let cr = 0, cg = 0, cb = 0, cw = 0;
    for (let i = 0; i < 16; i++) { const th = i * Math.PI / 8, c = Math.cos(th), s = Math.sin(th); let a = 0, edge = 5;
      for (let j = 0; j < 6; j++) { const r = R * (0.5 + 0.75 * j), x = fl.cx + c * r, z = fl.cz + s * r, kind = this.surface(x, z); if (kind < 0) { edge = 0.5 + 0.75 * j - 0.4; break; }
        if (kind === WATER || j < 1 || j > 2) continue;
        const d = 0.5 * Math.pow(DUSTY[kind] * this.take(x, z, kind), 0.7), col = DCOL[kind]; a += d; cr += col[0] * d; cg += col[1] * d; cb += col[2] * d; cw += d; }
      A[i] = a; this.edges[i] = edge; }
    if (cw > 0) { C[0] = cr / cw; C[1] = cg / cw; C[2] = cb / cw; }
    this.sprayW = null; for (const w of this.waters) if (Math.hypot(w.x - fl.cx, w.zt - fl.cz) < w.radius + 3 * R && Math.abs(w.level - fl.cy) < 2.5) { this.sprayW = w; break; }
  }

  // exhaust: shimmer, the haze of a start, smoke from a damaged engine
  engine(f, dt) {
    const near = (this.near = this.viewDist < 400), P = this.P;
    if (f.n1 < 0.02 && f.damage <= 0.6) { if (this.heat.n) this.heat.step(dt, 0, 0, 0, 0, 0, 0, 0); return; }
    const mx = this.ctx.heli.model && this.ctx.heli.model.exhaust, X = mx && mx.length === 3 ? mx : EXHAUST;
    _e.set(X[0] - this.ctx.DIMS.cg[0], X[1] - this.ctx.DIMS.cg[1], X[2] - this.ctx.DIMS.cg[2]).applyQuaternion(f.quat).add(f.pos);
    _d.set(EXH_DIR[0], EXH_DIR[1], EXH_DIR[2]).applyQuaternion(f.quat); _u.set(0, 1, 0).applyQuaternion(f.quat);
    const lit = f.engine === 'run' || f.engine === 'starting', hot = lit ? clamp((f.n1 - 0.12) / 0.5, 0, 1) : clamp(f.n1 * 1.5 - 0.25, 0, 0.5), gas = 5 + 15 * f.n1, dw = f.nr > 0.3 ? f.vi * 0.7 : 0;
    const vx = f.vel.x + _d.x * gas - _u.x * dw, vy = f.vel.y + _d.y * gas - _u.y * dw, vz = f.vel.z + _d.z * gas - _u.z * dw;
    this.heat.step(dt, _e.x, _e.y, _e.z, vx, vy, vz, this.viewDist < 40 ? hot : 0);
    if (!near) return;
    if (f.engine === 'starting' && f.startT > 0.8 && f.startT < 5.5) {
      this.accS += 26 * dt;
      while (this.accS >= 1) { this.accS -= 1; const k = 0.9 + 0.2 * rnd(); P.spawn(SMOKE, _e.x, _e.y, _e.z, vx * 0.22 + (rnd() - 0.5), vy * 0.22 + 0.4, vz * 0.22 + (rnd() - 0.5), 1.2 + rnd() * 1.3, 0.25, 1.1 + rnd() * 0.9, 0.62 * k, 0.64 * k, 0.69 * k, 0.07 + 0.05 * rnd(), f.surface); }
    }
    if (f.damage > 0.6) {
      this.accK += (lit ? 40 + 110 * (f.damage - 0.6) / 0.4 : 24) * dt;
      while (this.accK >= 1) { this.accK -= 1; const k = 0.025 + 0.04 * rnd();
        P.spawn(SMOKE, _e.x + (rnd() - 0.5) * 0.4, _e.y - 0.1, _e.z + (rnd() - 0.5) * 0.4, vx * 0.25 + (rnd() - 0.5) * 1.5, vy * 0.25 + 0.6, vz * 0.25 + (rnd() - 0.5) * 1.5, 2.6 + rnd() * 2.2, 0.4, 2.6 + rnd() * 2.4, k, k, k * 1.08, 0.42 + 0.25 * rnd(), f.surface); }
    }
  }

  // skids dragged along the ground: sparks off paving and roofs, dirt off the lawn
  scrape(f, dt) {
    const v = Math.hypot(f.vel.x, f.vel.z); if (v < 1.2 || this.viewDist > 300) return;
    const P = this.P, n = Math.min(4, v * 22 * dt + rnd()) | 0, C = this.ctx.DIMS.contacts, cg = this.ctx.DIMS.cg;
    for (let i = 0; i < n; i++) {
      const c = C[(rnd() * C.length) | 0]; _p.set(c[0] - cg[0] + (rnd() - 0.5) * 1.5, c[1] - cg[1], c[2] - cg[2]).applyQuaternion(f.quat).add(f.pos);
      const soft = f.surface < 2.5 && this.inPark(_p.x, -_p.z);
      if (soft) { if (rnd() < 0.3) P.spawn(DUST, _p.x, f.surface + 0.15, _p.z, f.vel.x * 0.4, 0.5, f.vel.z * 0.4, 1 + rnd(), 0.3, 1.2 + rnd(), 0.2, 0.16, 0.11, 0.35, f.surface); }
      else this.spark(_p.x, f.surface + 0.03, _p.z, f.vel.x * 0.7, 0.3, f.vel.z * 0.7, 1.5 + v * 0.35, f.surface);
    }
  }
  spark(x, y, z, vx, vy, vz, sp, gnd) {
    const a = rnd() * 6.2832, el = rnd() * 1.3, s = sp * (0.3 + rnd()), k = 0.5 + rnd();
    this.P.spawn(SPARK, x, y, z, vx + Math.cos(a) * Math.cos(el) * s, vy + Math.sin(el) * s, vz + Math.sin(a) * Math.cos(el) * s, 0.2 + rnd() * rnd() * 0.9, 0.022 + 0.02 * rnd(), 0.02, 22 * k, (8 + 6 * rnd()) * k, 1.6 * k, 1, gnd);
  }
  // a strike from the flight model: { x, y, z, speed, kind: 'skid' | 'hull' | 'rotor' }
  hit(h) {
    const P = this.P, t = P.t; if (t - this.lastHit < 0.03 || this.viewDist > 600) return; this.lastHit = t;
    const f = this.ctx.heli.f, sp = Math.min(h.speed, 12), gnd = Math.min(h.y, f.surface + 0.05), soft = h.kind === 'skid' && f.surface < 2.5 && this.inPark(h.x, -h.z);
    const nS = soft ? 0 : h.kind === 'rotor' ? 16 + sp * 3 : h.kind === 'hull' ? 6 + sp * 2 : sp > 2.6 ? 3 + sp * 2 : 0, nP = h.kind === 'rotor' ? 3 : 2 + sp * 0.6;
    for (let i = 0; i < nS; i++) this.spark(h.x, h.y + 0.03, h.z, f.vel.x * 0.4, 0.5, f.vel.z * 0.4, 3 + sp * 0.8, gnd);
    for (let i = 0; i < nP; i++) { const k = soft ? 0.2 : 0.3, a = rnd() * 6.2832, s = 0.6 + rnd() * sp * 0.35;
      P.spawn(DUST, h.x, h.y + 0.15, h.z, Math.cos(a) * s, 0.4 + rnd() * 0.8, Math.sin(a) * s, 1 + rnd() * 1.2, 0.3, 1.2 + rnd() * 1.2, k * 1.05, k, k * 0.9, 0.3 + 0.2 * rnd(), gnd); }
    if (h.kind === 'rotor') for (let i = 0; i < 8; i++) { const a = rnd() * 6.2832, s = 3 + rnd() * 9, k = 0.05 + 0.1 * rnd(); P.spawn(GRIT, h.x, h.y, h.z, Math.cos(a) * s, 1 + rnd() * 5, Math.sin(a) * s, 2 + rnd() * 2, 0.04 + 0.05 * rnd(), 0.05, k, k, k, 1, gnd); }
  }
  // the fountain's own jet: water thrown up from the nozzle, falling back into the bowl; the wash bends it and tears it away like any other drop
  jet(dt) {
    const F = this.fountain, P = this.P, fl = this.field; let jx = 0, jz = 0, ju = 0;
    if (fl.on) { const dx = F.nozzle.x - fl.cx, dz = F.nozzle.z - fl.cz, dl = Math.hypot(dx, dz) || 1; ju = fl.speedAt(F.nozzle.x, F.nozzle.z); jx = dx / dl * ju * 0.6; jz = dz / dl * ju * 0.6; }
    const torn = clamp((ju - 3) / 7, 0, 1), sp = 0.45 + 2.2 * torn; this.accJ += (110 + 260 * torn) * dt;      // blown, the column breaks into a fan of finer drops
    while (this.accJ >= 1) { this.accJ -= 1; const k = 0.9 + 0.1 * rnd();
      P.spawn(DROP, F.nozzle.x, F.nozzle.y, F.nozzle.z, jx * (0.4 + 1.2 * rnd()) + (rnd() - 0.5) * sp, Math.max(1.2, 5.0 - ju * 0.3) * (1 - 0.5 * torn * rnd()) + rnd() * 0.7, jz * (0.4 + 1.2 * rnd()) + (rnd() - 0.5) * sp, 1.4, (0.06 + 0.04 * rnd()) * (1 - 0.6 * torn), 0.08, 0.86 * k, 0.9 * k, 0.93 * k, 0.6 - 0.25 * torn, F.bowlY); }
  }

  // ------------------------------------------------------------------ every drawn frame
  update(f, dt, view) {
    const fl = this.field, cam = view.camera, heli = this.ctx.heli, R = fl.R;
    if (this.live > 0) this.live--; else { if (fl.on) { fl.on = false; fl.U = 0; this.dustS = 0; } if (this.vol.s > 0) this.vol.step(dt, fl, 0); if (this.spray.s > 0) this.spray.step(dt, fl, 0); this.uS *= Math.max(0, 1 - dt * 2.5); if (this.uS < 0.05) this.uS = 0; }      // a parked aircraft is not stepped: its wash has stopped
    this.viewDist = view.dist; if (this.fountain) this.camFountain = Math.hypot(cam.position.x - this.fountain.x, cam.position.y - this.fountain.groundY, cam.position.z - this.fountain.z);
    this.P.fill(cam); this.heat.fill(view.dist < 40);
    this.vol.update(cam, view.t); this.spray.update(cam, view.t);
    if (this.fountain) this.fountain.group.visible = this.camFountain < 260;
    const tw = this.treeWind;
    if (tw) {
      // the wind at tree-top height near the camera, its quick turbulence smoothed away (every tree shares it; the shader gives each its own phase)
      const w = heli.wind.at(_p.set(cam.position.x, 12, cam.position.z), view.t, 6, heli.heights.skyline(cam.position.x, -cam.position.z)), k = Math.min(1, dt * 0.5);
      this.tw.x += (w.x - this.tw.x) * k; this.tw.y += (w.z - this.tw.y) * k;
      tw.uWind.value.set(this.tw.x, this.tw.y, view.t, 0);
      if (fl.on) tw.uWashA.value.set(fl.cx, fl.cy, fl.cz, this.uS); else tw.uWashA.value.w = this.uS;
      tw.uWashB.value.set(R, fl.on ? fl.h : tw.uWashB.value.y, 0, 0);
    }
    if (this.groundAt) { if (fl.on) this.gKind = this.surface(fl.cx, fl.cz); const k = this.gKind; this.ground.update(fl, k >= 0 && k !== WATER ? this.uS : 0, view.t, k === PARK ? 1 : 0, k >= 0 && k < 3 ? DUSTY[k] : 0, this.flat, k === PARK ? Math.max(0, (this.lawnY || 0) - fl.cy) : 0); }
    const W = this.waterU; if (fl.on) W.uWashW.value.set(fl.cx, fl.cz, this.uS, R); else W.uWashW.value.z = this.uS;
    W.uWashV.value.set(fl.lx, fl.lz, view.t, 0);
  }
}
const SPRAYC = [0.6, 0.63, 0.65];
const OFF = { on: false, vel(x, y, z, o) { o.x = o.y = o.z = 0; } };
