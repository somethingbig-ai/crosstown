// heli.js: the helicopter in the game. Owns the aircraft (flight.js), where it stands, getting in and out, the controls, both cameras,
// the HUD strip, and the hooks the other parts hang on: model.js (the aircraft you see), cockpit.js (interior and live instruments),
// sound.js (rotor and turbine), wash.js (rotor wash: dust, trees, water). Each of those is optional at load: a part that is missing
// or throws is logged and skipped, and the aircraft still flies (with a plain stand-in body if there is no model).
//
// game.js calls: addHeli(game) once; heli.step(dt, input) every fixed step; heli.tryBoard() on the use key; heli.updateCamera(dt) while
// heli.hasCamera; heli.sync(dt) each drawn frame; heli.drawHud(hud).
// Map coordinates as everywhere in the game: x east, y north (metres); three.js world is (x, height, -y).
import * as THREE from 'three';
import { clamp, lerp, wrapPi, pointInPoly } from '../geo.js';
import { DIMS } from './dims.js';
import { Flight, Wind, SPEC } from './flight.js';

const KT = 1.94384, FT = 3.28084, CEILING = 520;      // metres above the street: clear of the Empire State Building's mast (443 m), below where the edge of the world shows
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();

// Heights of the city under the aircraft: the top of whatever building stands at a point, else the street or sidewalk.
export class Heights {
  constructor(game) {
    this.g = game; this.cell = 24; this.map = new Map(); this.sky = new Map();
    for (const b of game.city.buildings) {
      if (!b.poly || b.poly.length < 3 || !(b.h > 0)) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of b.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      const r = { b, x0, y0, x1, y1, top: b.h, base: b.minh || 0 }, c = this.cell;
      for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) { const k = i * 100003 + j; let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(r); const s = Math.floor(i / 4) * 100003 + Math.floor(j / 4); this.sky.set(s, Math.max(this.sky.get(s) || 0, Math.min(b.h, 120))); }
    }
  }
  // The city as it is DRAWN, seen from straight above: one height per half metre over the middle of the map (hand-built hero buildings,
  // light courts, set-backs, roof tanks and plant included), read back from the GPU once at load. Outside it, the map's footprints.
  bake() {
    const w = this.g.world, r = w.renderer, N = 1024, TILES = 3, SPAN = 512, half = TILES * SPAN / 2, size = N * TILES;
    /* tiles lane: the picture grows north in whole 512 m squares to cover a playable box that reaches past the old 1.5 km square (city.meta.play); the old city gives the same 3 x 3 picture */
    const pbH = this.g.city.meta.play, TY = pbH ? Math.max(TILES, Math.ceil((pbH[3] + 80 + half) / SPAN)) : TILES;
    const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: `varying float vY; void main() {
        #ifdef USE_INSTANCING
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wp = modelMatrix * vec4(position, 1.0);
        #endif
        vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`, fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }' });
    const L = 7, marked = [], mark = (o) => o && o.traverse((q) => { if (q.isMesh) { q.layers.enable(L); marked.push(q); } });
    for (const m of w.buildingMeshes || []) mark(m); mark(w.heroRoot); for (const m of this.g.propMeshes || []) if (['watertower', 'ac'].includes(m.userData.kind)) mark(m);
    const cam = new THREE.OrthographicCamera(-SPAN / 2, SPAN / 2, SPAN / 2, -SPAN / 2, 1, 3000); cam.layers.set(L); cam.up.set(0, 0, -1);
    const hf = new Uint16Array(size * N * TY), buf = new Float32Array(N * N * 4), sc = w.scene, old = { rt: r.getRenderTarget(), om: sc.overrideMaterial, bg: sc.background, cc: r.getClearColor(new THREE.Color()), ca: r.getClearAlpha(), sh: r.shadowMap.autoUpdate };
    sc.overrideMaterial = mat; sc.background = null; r.setClearColor(0x000000, 0); r.shadowMap.autoUpdate = false;
    for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TILES; tx++) {
      const cx = -half + (tx + 0.5) * SPAN, cy = -half + (ty + 0.5) * SPAN;      // map x east, y north
      cam.position.set(cx, 2000, -cy); cam.lookAt(cx, 0, -cy); cam.updateMatrixWorld();
      r.setRenderTarget(rt); r.clear(); r.render(sc, cam); r.readRenderTargetPixels(rt, 0, 0, N, N, buf);
      // image x runs east, image y runs north (the camera's up is north)
      for (let j = 0; j < N; j++) { const row = (ty * N + j) * size + tx * N; for (let i = 0; i < N; i++) hf[row + i] = Math.min(65535, Math.max(0, Math.round(buf[(j * N + i) * 4] * 10))); }
    }
    r.setRenderTarget(old.rt); sc.overrideMaterial = old.om; sc.background = old.bg; r.setClearColor(old.cc, old.ca); r.shadowMap.autoUpdate = old.sh; for (const q of marked) q.layers.disable(L); rt.dispose(); mat.dispose();
    this.hf = hf; this.hfN = size; this.hfHalf = half; this.hfS = size / (2 * half); this.hfY1 = -half + TY * SPAN;
    let n = 0; for (let i = 0; i < hf.length; i += 97) if (hf[i] > 20) n++; if (n < 50) { this.hf = null; throw new Error('height picture came back empty'); }
  }
  // a level patch of roof near (x, y): the centre of the flattest `size` m square within `reach`, at least `minH` up; null if none
  findFlat(x, y, reach, size, minH) {
    if (!this.hf) return null; let best = null; const h2 = size / 2;
    for (let dy = -reach; dy <= reach; dy += 2) for (let dx = -reach; dx <= reach; dx += 2) {
      const cx = x + dx, cy = y + dy, c = this.top(cx, cy, 1e4); if (c < minH) continue; let lo = c, hi = c;
      for (let v = -h2; v <= h2 && hi - lo < 0.5; v += 1.5) for (let u = -h2; u <= h2; u += 1.5) { const t = this.top(cx + u, cy + v, 1e4); if (t < lo) lo = t; if (t > hi) hi = t; }
      if (hi - lo < 0.35) { const d = Math.hypot(dx, dy); if (!best || d < best.d) best = { x: cx, y: cy, z: hi, d }; }
    }
    return best;
  }
  // top of the solid at map (x, y) that a point at height zq is in or above; the street otherwise
  top(x, y, zq) {
    if (this.hf && Math.abs(x) < this.hfHalf - 1 && y > -this.hfHalf + 1 && y < (this.hfY1 || this.hfHalf) - 1) {
      const h = this.hf[Math.floor((y + this.hfHalf) * this.hfS) * this.hfN + Math.floor((x + this.hfHalf) * this.hfS)] * 0.1; this.last = null;
      if (h <= 0.5 && this.solids) for (const o of this.solids) if (Math.abs(x - o.x) < o.radius && Math.abs(y - o.y) < o.radius && Math.hypot(x - o.x, y - o.y) < o.radius) return o.top;     // low things other parts built (the fountain)
      return h > 0.5 ? h : this.street(x, y);
    }
    const a = this.map.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)); let h = -1, hit = null;
    if (a) for (const r of a) { if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1 || r.base > zq || r.top <= h) continue; if (pointInPoly(x, y, r.b.poly)) { let hole = false; if (r.b.holes) for (const q of r.b.holes) if (pointInPoly(x, y, q)) { hole = true; break; } if (!hole) { h = r.top; hit = r; } } }
    this.last = hit;
    if (h >= 0) return h;
    return this.street(x, y);
  }
  // street level: the road at 0, sidewalks 0.15 up, park lawns 0.18 up (as the ground is drawn)
  street(x, y) {
    if (!this.parks) this.parks = (this.g.city.parks || []).map((p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of p.ext) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { ext: p.ext, x0, y0, x1, y1 }; });
    for (const p of this.parks) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1 && pointInPoly(x, y, p.ext)) return 0.18;
    return this.g.statics.onSidewalk(x, y) ? 0.15 : 0;
  }
  skyline(x, y) { return this.sky.get(Math.floor(x / this.cell / 4) * 100003 + Math.floor(y / this.cell / 4)) || 12; }
}

class Heli {
  constructor(game) {
    this.g = game; this.piloted = false; this.hasCamera = false; this.camMode = 'chase'; this.busy = null; this.director = null;
    this.cam = { yaw: 0, pitch: 0.2, dist: 14, lookT: 9, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 58, headYaw: 0, headPitch: 0, shake: 0, lag: new THREE.Vector3(), init: false };
    this.cmd = { pitch: 0, roll: 0, yaw: 0, lift: 0, engine: false, direct: { lon: 0, lat: 0 } }; this.mouseFly = false; this.hintT = 0; this.parts = {}; this.keysWere = new Set();
    this.listener = { pos: new THREE.Vector3(), inside: false, dist: 0 };
  }
  async init() {
    const g = this.g, H = (this.heights = new Heights(g));
    try { const t0 = performance.now(); H.bake(); console.log('[heli] height picture of the city in ' + Math.round(performance.now() - t0) + ' ms'); } catch (e) { console.log('[heli] no height picture, using the map footprints: ' + (e && e.message)); }
    const env = { ground: (x, z, yq) => H.top(x, -z, yq), skyline: (x, z) => H.skyline(x, -z), wind: (this.wind = new Wind()),
      escape: (px, py, pz, out) => { for (const r of [0.75, 1.5, 3, 5, 8, 12]) { let best = -1; for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r; if (H.top(x, -z, py + 1.2) <= py + 0.3) { best = i; out.set(Math.cos(a) * r, 0, Math.sin(a) * r); break; } } if (best >= 0) return true; } return false; } };
    const f = (this.f = new Flight(env));
    this.root = new THREE.Group(); this.root.name = 'heli'; g.world.scene.add(this.root);
    const ctx = { game: g, heli: this, DIMS, SPEC, THREE, shared: g.world.shared, world: g.world };
    const part = async (name, fn) => { try { const m = await import('./' + name + '.js'); this.parts[name] = await fn(m); console.log('[heli] ' + name + ' loaded'); } catch (e) { const miss = /Failed to fetch dynamically imported module|Cannot find module|error loading dynamically imported module/.test(String(e && e.message)); console.log('[heli] ' + name + (miss ? ' not there yet' : ' FAILED: ' + (e && (e.stack || e.message)))); this.parts[name] = null; } };
    await part('model', (m) => m.buildHeliModel(ctx));
    this.model = this.parts.model || standIn();
    this.root.add(this.model.root);
    await part('cockpit', (m) => m.buildCockpit(ctx, this.model)); if (this.parts.cockpit && this.parts.cockpit.root && !this.parts.cockpit.root.parent) this.model.root.add(this.parts.cockpit.root);
    await part('sound', (m) => new m.HeliSound(ctx));
    await part('wash', (m) => new m.Wash(ctx)); if (this.parts.wash && this.parts.wash.solids) H.solids = this.parts.wash.solids;
    if (g.P.get('hboard') !== '0') try { await (await import('../entry/heliboard.js')).addHeliBoard(this); } catch (e) { console.log('[hboard] not loaded, the old boarding beat stands: ' + (e && (e.stack || e.message))); }     // gameplay lane: getting in and out as a watched beat (walk, door, climb, camera); ?hboard=0 off
    // where it stands: a street-level spot by the player's start, and marked roofs to land on
    this.pads = [this.streetPad()];
    for (const [name, x, y] of [['The Grand Madison', -66.7, -124.3], ['1150 Broadway', -156.0, -62.5], ['Park Avenue South', 107.4, -137.2], ['East 21st', 107.9, -299.2], ['West 22nd', -366.5, -354.6], ['West 25th', -261.5, -180.2]]) { const p = H.findFlat(x, y, 34, 15, 25); if (p) this.pads.push({ name, x: p.x, y: p.y, h: this.pads[0].h, roof: true, z: p.z }); }
    this.padMarks();
    // ?heli=pad:n (parked on pad n) | pad:n,run (rotor turning) | hover:x,y,agl,headingDeg (holds a hover there, for stills) | air:x,y,agl,headingDeg,speed | none (game.js)
    const P = g.P.get('heli') || '';
    const pad = this.pads[P.startsWith('pad:') ? clamp(+P.slice(4) | 0, 0, this.pads.length - 1) : 0];
    f.place(pad.x, pad.y, pad.h); if (/^pad:\d+,run/.test(P)) { f.engine = 'run'; f.nr = 1; f.n1 = 0.82; }
    if (P.startsWith('hover:')) { const a = P.slice(6).split(',').map(Number); this.pose({ x: a[0], y: a[1], agl: a[2] || 30, h: (a[3] || 0) * Math.PI / 180 }); const hx = a[0], hy = a[1], hh = (a[3] || 0) * Math.PI / 180, o = { pitch: 0, roll: 0, yaw: 0, lift: 0 };
      // holds the spot against the wind: leans toward where it was put, nose where it was pointed
      this.director = { cmd: (f) => { const ex = hx - f.pos.x, ey = hy + f.pos.z, c = Math.cos(f.heading), sn = Math.sin(f.heading), vf = f.vel.x * c - f.vel.z * sn, vr = f.vel.x * sn + f.vel.z * c; o.pitch = clamp((ex * c + ey * sn) * 0.25 - vf * 0.3, -1, 1); o.roll = clamp((ex * sn - ey * c) * 0.25 - vr * 0.3, -1, 1); o.yaw = clamp(-wrapPi(hh - f.heading) * 2, -1, 1); return o; } }; }
    if (P.startsWith('air:')) { const a = P.slice(4).split(',').map(Number); this.pose({ x: a[0], y: a[1], agl: a[2] || 60, h: (a[3] || 0) * Math.PI / 180, speed: a[4] || 0 }); }
    if (P.startsWith('demo')) {     // ?heli=demo: it flies itself on a tour of the district and lands on a roof, the chase camera on it (filming and the frame-rate test)
      const { AutoPilot } = await import('./auto.js'), p0 = this.pads[0];
      this.director = new AutoPilot(this, [{ x: p0.x, y: p0.y, alt: 45, speed: 8 }, { x: -215, y: -330, alt: 95, speed: 28 }, { x: -260, y: -430, alt: 110, speed: 30 }, { x: -120, y: -470, alt: 110, speed: 30 }, { x: -20, y: -250, alt: 130, speed: 38 }, { x: -150, y: 60, alt: 150, speed: 42 }, { x: -330, y: -100, alt: 120, speed: 38 }, { land: Math.min(1, this.pads.length - 1) }, { land: 0 }], { cam: P.split(':')[1] || 'chase', loop: true });
    }
    addEventListener('keydown', (e) => { if (e.repeat || !this.piloted) return; if (e.code === 'KeyC') this.nextCamera(); if (e.code === 'KeyE') this.cmd.engine = true; if (e.code === 'KeyT') { f.assist = f.assist === 'easy' ? 'sim' : 'easy'; this.note = { t: 0, text: f.assist === 'sim' ? 'STABILITY OFF: hands and feet, all of it' : 'STABILITY ON' }; } if (e.code === 'KeyG') { this.mouseFly = !this.mouseFly; this.cmd.direct.lon = this.cmd.direct.lat = 0; this.note = { t: 0, text: this.mouseFly ? 'MOUSE FLIES THE CYCLIC' : 'MOUSE LOOKS AROUND' }; } });
    this.sync(0);
    return this;
  }
  // the street-level spot: the nearest open ground in a park to where the player starts, clear of trees, poles and walls
  streetPad() {
    const g = this.g, H = this.heights, sx = -196, sy = -214, h = g.city.meta.grid_deg * Math.PI / 180 + Math.PI / 2, posts = [];
    for (const m of g.propMeshes || []) if (['tree', 'tree2', 'light', 'signal'].includes(m.userData.kind)) for (const p of m.userData.items) posts.push(p);
    let best = null;
    for (const park of g.city.parks || []) for (let dy = -170; dy <= 170; dy += 3) for (let dx = -170; dx <= 170; dx += 3) {
      const x = sx + dx, y = sy + dy, d = Math.hypot(dx, dy); if ((best && d >= best.d) || !pointInPoly(x, y, park.ext)) continue;
      let ok = true; for (const p of posts) if (Math.abs(p[0] - x) < 12.5 && Math.abs(p[1] - y) < 12.5 && Math.hypot(p[0] - x, p[1] - y) < 12.5) { ok = false; break; }
      if (ok) for (let a = 0; a < 8 && ok; a++) for (const r of [4, 8, 14, 20]) if (H.top(x + Math.cos(a * Math.PI / 4) * r, y + Math.sin(a * Math.PI / 4) * r, 1e4) > 0.5 || g.roads.inLane(x + Math.cos(a * Math.PI / 4) * r, y + Math.sin(a * Math.PI / 4) * r, 1)) { ok = false; break; }
      if (ok) best = { name: 'Madison Square Park', x, y, h, d };
    }
    console.log('[heli] street pad: ' + (best ? 'park lawn at ' + best.x + ', ' + best.y + ' (' + posts.length + ' trees and poles checked)' : 'NO open park ground found, falling back to the plaza'));
    return best || { name: 'Madison Square', x: -196, y: -232, h };
  }
  // painted landing marks: a circle and an H on each roof pad and the street spot
  padMarks() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); x.clearRect(0, 0, 512, 512);
    x.strokeStyle = 'rgba(232,226,205,0.92)'; x.lineWidth = 22; x.beginPath(); x.arc(256, 256, 232, 0, 7); x.stroke(); x.lineWidth = 34; x.lineCap = 'butt'; x.beginPath(); x.moveTo(176, 140); x.lineTo(176, 372); x.moveTo(336, 140); x.lineTo(336, 372); x.moveTo(176, 256); x.lineTo(336, 256); x.stroke();
    // wear: scuffs and worn paint so it is not a clean stamp
    x.globalCompositeOperation = 'destination-out'; let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; for (let i = 0; i < 900; i++) { x.globalAlpha = 0.25 + r() * 0.5; const px = r() * 512, py = r() * 512, w = 2 + r() * 16; x.fillRect(px, py, w, 1 + r() * 3); } for (let i = 0; i < 40; i++) { x.globalAlpha = 0.35; x.beginPath(); x.arc(r() * 512, r() * 512, 4 + r() * 22, 0, 7); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.PlaneGeometry(13, 13); geo.rotateX(-Math.PI / 2);
    this.padGroup = new THREE.Group();
    for (const p of this.pads) { if (!p.roof) continue; const m = new THREE.Mesh(geo, mat); m.position.set(p.x, p.z + 0.03, -p.y); m.rotation.y = p.h; m.receiveShadow = true; m.renderOrder = 3; this.padGroup.add(m); }
    this.g.world.scene.add(this.padGroup);
  }
  // put it somewhere at once: { pad: n } or { x, y, agl, h, speed } (in the air, rotor turning) or { x, y, h, ground: true }
  pose(o) {
    const f = this.f;
    if (o.pad !== undefined) { const p = this.pads[o.pad]; f.place(p.x, p.y, o.h ?? p.h); f.engine = o.run ? 'run' : 'off'; f.nr = o.run ? 1 : 0; f.n1 = o.run ? 0.82 : 0; f.collective = 0; }
    else if (o.ground) { f.place(o.x, o.y, o.h || 0); f.engine = o.run ? 'run' : 'off'; f.nr = o.run ? 1 : 0; f.n1 = o.run ? 0.82 : 0; }
    else f.airborne(o.x, o.y, o.h || 0, o.agl ?? 60, o.speed || 0);
    f.damage = 0; this.cam.init = false; this.sync(0);
  }
  // call one part's method; a part that throws is logged and, after three throws, left out: one part's fault must never stop the game's step
  call(name, fn, a, b, c, d) {
    const p = name === 'model' ? this.model : this.parts[name]; if (!p || p.dead || !p[fn]) return;
    try { p[fn](a, b, c, d); } catch (e) { p.errs = (p.errs || 0) + 1; if (p.errs <= 3) console.log('[heli] ' + name + '.' + fn + ' threw: ' + (e && (e.stack || e.message))); if (p.errs >= 3) { p.dead = true; console.log('[heli] ' + name + ' switched off after repeated errors'); if (p.root && name !== 'model') p.root.visible = false; } }
  }
  get mapX() { return this.f.pos.x; } get mapY() { return -this.f.pos.z; }
  // the pilot's door, in map coordinates (the right side of the aircraft), on the surface it stands on
  doorPoint(out = {}) { const f = this.f, d = DIMS.doorR; _v.set((d.x0 + d.x1) / 2 - DIMS.cg[0] - 0.1, 0, DIMS.cabinHalfW + 0.95).applyQuaternion(f.quat); out.x = f.pos.x + _v.x; out.y = -(f.pos.z + _v.z); out.z = f.surface; return out; }
  canBoard() { const pl = this.g.player, f = this.f; if (this.piloted || this.busy || pl.vehicle || pl.busy || !f.onGround) return false; const d = this.doorPoint(); return Math.hypot(pl.x - d.x, pl.y - d.y) < 2.6 && Math.abs((pl.alt || 0) - d.z) < 2.5; }
  tryBoard() {
    if (!this.canBoard()) return false; const pl = this.g.player, d = this.doorPoint();
    this.busy = { kind: 'in', t: 0, dur: 1.5, x0: pl.x, y0: pl.y, h0: pl.h, x: d.x, y: d.y }; this.g.sound.door && this.g.sound.door(); return true;
  }
  board() {     // seated, hands on
    const pl = this.g.player; this.piloted = true; this.hasCamera = true; this.busy = null; this.cam.init = false; this.hintT = 0; pl.roof = null; pl.alt = 0;
    if (this.f.engine === 'off') this.cmd.engine = true;       // getting in starts it (E stops and starts it again)
    this.g.cam.mode = 'heli';
  }
  canLeave() { const f = this.f; return this.piloted && f.onGround && f.vel.length() < 1.2 && f.collective < 0.2; }
  leave() {
    const g = this.g, pl = g.player, f = this.f, d = this.doorPoint(); this.piloted = false; this.hasCamera = false; g.cam.mode = 'foot';
    pl.x = d.x; pl.y = d.y; pl.h = f.heading - Math.PI / 2; pl.alt = d.z > 1 ? d.z : 0; pl.roof = d.z > 1; pl.vis.object.visible = true; this._rx = pl.x; this._ry = pl.y; g.playerAnim('idle');
    if (f.engine !== 'off') f.engine = 'off';
    this.busy = { kind: 'out', t: 0, dur: 0.9 }; g.snapCamera(); g.cam.yaw = f.heading; g.cam.lookT = 0; g.placeCamera(0); g.sound.door && g.sound.door();
  }

  // ------------------------------------------------------------------ every fixed step
  step(dt, I) {
    const g = this.g, f = this.f, pl = g.player, K = g.keys, c = this.cmd;
    if (this.busy) {
      const b = this.busy; b.t += dt; const u = clamp(b.t / b.dur, 0, 1);
      if (b.kind === 'in') { const k = clamp(u / 0.45, 0, 1); pl.x = lerp(b.x0, b.x, k); pl.y = lerp(b.y0, b.y, k); pl.h = b.h0 + wrapPi(f.heading + Math.PI / 2 - b.h0) * k; this.door = clamp(u < 0.5 ? u / 0.3 : (1 - u) / 0.3, 0, 1); if (u >= 0.62) pl.vis.object.visible = false; if (u >= 1) this.board(); }
      else { this.door = clamp(u < 0.5 ? u / 0.3 : (1 - u) / 0.3, 0, 1); if (u >= 1) this.busy = null; }
    } else this.door = 0;
    const dir = this.director; if (dir && dir.cam) this.hasCamera = true;
    if (dir) { const d = dir.cmd ? dir.cmd(f, g.t, dt) : null; c.pitch = d?.pitch || 0; c.roll = d?.roll || 0; c.yaw = d?.yaw || 0; c.lift = d?.lift || 0; c.engine = !!d?.engine; }
    else if (this.piloted) {
      const ax = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0), gp = navigator.getGamepads ? navigator.getGamepads()[0] : null, dz = (v, d = 0.12) => (Math.abs(v) > d ? (v - Math.sign(v) * d) / (1 - d) : 0);
      let pitch = ax('ArrowUp', 'ArrowDown') + ax('KeyI', 'KeyK') + ax('Numpad8', 'Numpad5'), roll = ax('ArrowRight', 'ArrowLeft') + ax('KeyL', 'KeyJ') + ax('Numpad6', 'Numpad4'), yaw = ax('KeyD', 'KeyA'), lift = ax('KeyW', 'KeyS') + ax('Space', 'ShiftLeft');
      if (gp) { pitch -= dz(gp.axes[1]); roll += dz(gp.axes[0]); yaw += (gp.buttons[5]?.value || 0) - (gp.buttons[4]?.value || 0); lift += (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
        const b = (i) => gp.buttons[i]?.pressed, was = this.keysWere; if (b(2) && !was.has(2)) c.engine = true; if (b(11) && !was.has(11)) this.nextCamera(); if (b(3) && !was.has(3)) I.use = true; for (const i of [2, 3, 11]) b(i) ? was.add(i) : was.delete(i);
        this.cam.yaw -= dz(gp.axes[2]) * dt * 2.6; this.cam.pitch = clamp(this.cam.pitch + dz(gp.axes[3]) * dt * 1.6, -0.6, 1.2); if (Math.abs(gp.axes[2]) > 0.12 || Math.abs(gp.axes[3]) > 0.12) this.cam.lookT = 0; }
      // keys are switches; a hand is not: the command eases in and out (quicker to let go than to push)
      const ease = (cur, tgt, up, dn) => cur + clamp(tgt - cur, -dt * (Math.abs(tgt) < Math.abs(cur) ? dn : up), dt * (Math.abs(tgt) < Math.abs(cur) ? dn : up));
      c.pitch = ease(c.pitch, clamp(pitch, -1, 1), 3.2, 5); c.roll = ease(c.roll, clamp(roll, -1, 1), 3.6, 5.5); c.yaw = ease(c.yaw, clamp(yaw, -1, 1), 5, 7); c.lift = ease(c.lift, clamp(lift, -1, 1), 4, 6);
      if (this.mouseFly) { c.direct.lon = clamp(c.direct.lon * (1 - dt * 0.6), -1, 1); c.direct.lat = clamp(c.direct.lat * (1 - dt * 0.6), -1, 1); }
      if (I.use) { I.use = false; if (this.canLeave()) this.leave(); else this.note = { t: 0, text: f.onGround ? 'LOWER THE COLLECTIVE AND LET IT SETTLE' : 'LAND FIRST' }; }
    } else { c.pitch = c.roll = c.yaw = 0; c.lift = -1; }
    const flying = this.piloted || dir;
    if (flying || !f.onGround || f.nr > 0.002 || f.engine !== 'off' || f.vel.lengthSq() > 0.01) { f.step(dt, c); this.asleep = false; } else { this.asleep = true; f.coning = -0.055; f.collective = 0; }     // parked and still: the blades hang
    c.engine = false;
    for (const h of f.hits) { if (h.speed > 2 && this.hasCamera) this.cam.shake = Math.min(1, this.cam.shake + h.speed * 0.08); this.call('sound', 'hit', h); this.call('wash', 'hit', h); }
    // the edge of the world: a wall of air turns it back
    /* h-north, Nov 14: the wall stands round the PLAYABLE BOX (which is no longer centred on the origin), a margin out that keeps the aircraft over the drawn city and on the GPS picture,
       and it is damped, so the aircraft stops against it instead of sailing on and bouncing. Before: 1200 m past the old map's half size, about the origin: flown north it went 570 m past the
       north wall, off the end of the drawn ground and off the GPS picture. ?heliedge=0 = the old wall. */
    const px = f.pos.x, pz = f.pos.z;
    if (g.P.get('heliedge') === '0') { const lim = g.city.meta.hx + 1200; if (Math.abs(px) > lim) f.vel.x -= Math.sign(px) * (Math.abs(px) - lim) * 0.6 * dt; if (Math.abs(pz) > lim) f.vel.z -= Math.sign(pz) * (Math.abs(pz) - lim) * 0.6 * dt; }
    else { const m = g.city.meta, B = g.bounds, k = Math.max(120, Math.min(m.hx - m.px, m.hy - m.py) - 90), py = -pz, ex = px > B.cx + B.x + k ? px - (B.cx + B.x + k) : px < B.cx - B.x - k ? px - (B.cx - B.x - k) : 0, ey = py > B.cy + B.y + k ? py - (B.cy + B.y + k) : py < B.cy - B.y - k ? py - (B.cy - B.y - k) : 0;
      const dk = (e) => Math.min(1.2, Math.abs(e) / 40);     /* the push grows with depth and the brake comes in over the first 40 m: a firm stop, not a slap */
      if (ex) f.vel.x -= (ex * 0.25 + (ex * f.vel.x > 0 ? f.vel.x * dk(ex) : 0)) * dt; if (ey) f.vel.z += (ey * 0.25 + (ey * -f.vel.z > 0 ? -f.vel.z * dk(ey) : 0)) * dt;
      if ((ex || ey) && this.piloted && !this.note) this.note = { t: 0, text: 'END OF THE MAP · TURN BACK' }; }
    if (f.pos.y > CEILING) { f.vel.y -= (f.pos.y - CEILING) * 0.6 * dt; if (f.vel.y > 0) f.vel.y *= 1 - Math.min(1, dt * 1.5); }     // the service ceiling: above it the district is an island in the haze (the world ends 1 km out), so the air goes thin here
    if (this.piloted) { pl.x = clamp(this.mapX, g.bounds.cx - g.bounds.x, g.bounds.cx + g.bounds.x); pl.y = clamp(this.mapY, g.bounds.cy - g.bounds.y, g.bounds.cy + g.bounds.y); pl.h = f.heading; pl.speed = 0; }
    else if (pl.roof && !pl.vehicle) {     // on a roof on foot: the parapet keeps you on it
      const t = this.heights.top(pl.x, pl.y, 1e4); if (Math.abs(t - pl.alt) > 0.7) { pl.x = this._rx; pl.y = this._ry; } else { pl.alt = t; this._rx = pl.x; this._ry = pl.y; }
    }
    if (this.note) { this.note.t += dt; if (this.note.t > 3) this.note = null; }
    if (this.piloted) this.hintT += dt;
    this.call('wash', 'step', f, dt, this);
  }
  // mouse (pointer locked): looks around, or flies the cyclic when G is on
  look(I) {
    if (!I.lookX && !I.lookY) return; const C = this.cam;
    if (this.mouseFly) { this.cmd.direct.lat = clamp(this.cmd.direct.lat + I.lookX * 0.0022, -1, 1); this.cmd.direct.lon = clamp(this.cmd.direct.lon - I.lookY * 0.0022, -1, 1); }
    else if (this.camMode === 'cockpit') { C.headYaw = clamp(C.headYaw - I.lookX * 0.0024, -2.3, 2.3); C.headPitch = clamp(C.headPitch - I.lookY * 0.002, -1.1, 0.9); }
    else { C.yaw -= I.lookX * 0.0028; C.pitch = clamp(C.pitch + I.lookY * 0.002, -0.7, 1.25); C.lookT = 0; }
    I.lookX = I.lookY = 0;
  }
  nextCamera() { const order = ['chase', 'cockpit', 'far']; this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length]; this.cam.init = false; this.cam.headYaw = this.cam.headPitch = 0; }

  // ------------------------------------------------------------------ cameras
  updateCamera(dt) {
    const g = this.g, f = this.f, C = this.cam, cam = g.world.camera, mode = this.director?.cam || this.camMode, H = this.heights;
    const hd = f.heading, sp = f.vel.length();
    C.shake = Math.max(0, C.shake - dt * 1.8);
    const ias = f.ias, etl = Math.max(0, 1 - Math.abs(ias - 9) / 4) * (f.onGround ? 0 : 0.22);
    const buzz = (f.vrs * 0.5 + etl + clamp((f.torque - 0.97) * 6, 0, 0.4) + clamp(f.damage - 0.5, 0, 0.5)) * (f.nr > 0.5 ? 1 : 0);
    let near = 0.25;
    if (mode === 'cockpit') {
      // the pilot's eyes: carried by the airframe, the head a beat behind it (it leans against the accelerations and rides the shudder)
      const e = DIMS.pilotEye, a = _v2.copy(f.acc).applyQuaternion(_q.copy(f.quat).invert());
      C.lag.x += (clamp(-a.x * 0.006, -0.05, 0.05) - C.lag.x) * Math.min(1, dt * 5); C.lag.y += (clamp(-a.y * 0.004, -0.035, 0.035) - C.lag.y) * Math.min(1, dt * 6); C.lag.z += (clamp(-a.z * 0.006, -0.05, 0.05) - C.lag.z) * Math.min(1, dt * 5);
      const vib = f.nr > 0.2 ? 0.0012 + buzz * 0.01 + C.shake * 0.02 : 0, t = g.t;
      _v.set(e[0] - DIMS.cg[0] + C.lag.x + Math.sin(t * 122) * vib * 0.5, e[1] - DIMS.cg[1] + C.lag.y + Math.sin(t * 40.8 * 3 * f.nr) * vib, e[2] - DIMS.cg[2] + C.lag.z + Math.sin(t * 97) * vib * 0.6).applyQuaternion(f.quat).add(f.pos);
      cam.position.copy(_v);
      // looking the way the nose points (-Z of a camera is forward: the airframe's +X), then the head turned on top
      _q.setFromEuler(_e.set(0, -Math.PI / 2, 0)); cam.quaternion.copy(f.quat).multiply(_q); _q.setFromEuler(_e.set(C.headPitch - 0.06, C.headYaw, -C.lag.z * 0.6, 'YXZ')); cam.quaternion.multiply(_q);
      C.fov = 72; near = 0.1;      // 0.06 left too little depth precision for a city seen from high up (far buildings shimmered); nothing in the cabin is nearer the eye than 0.25 m
      C.yaw = hd; C.tgt.copy(f.pos);
    } else {
      const far = mode === 'far';
      // behind and above, swinging round to the heading when the mouse is left alone; the arm stretches with speed and the camera
      // trails the aircraft by a spring, so you see it lean into what it does
      const fast = clamp(sp / 45, 0, 1), want = (far ? 36 : 11.5) + sp * (far ? 0.12 : 0.03);
      C.lookT += dt; if (!C.init) { C.yaw = hd; C.pitch = far ? 0.32 : 0.21; C.dist = want; }
      if (C.lookT > 1.6) { C.yaw += wrapPi(hd - f.w.y * 0.12 - C.yaw) * Math.min(1, dt * (6 + fast * 3)); const low = clamp((30 - f.agl) / 22, 0, 1) * clamp((14 - sp) / 8, 0, 1) * (f.onGround ? 0.25 : 1); C.pitch += ((far ? 0.32 : 0.21) + low * 0.12 + clamp(-f.vel.y * 0.004, -0.03, 0.06) - C.pitch) * Math.min(1, dt * 1.2); }
      C.dist += (want - C.dist) * Math.min(1, dt * 2.5);
      _v.set(-2.2, 0.5, 0).applyQuaternion(_q.setFromAxisAngle(_v2.set(0, 1, 0), hd)).add(f.pos); if (!C.init) C.tgt.copy(_v);     // the middle of the whole aircraft, tail included
      const k = Math.min(1, dt * 16); C.tgt.x += (_v.x - C.tgt.x) * k; C.tgt.z += (_v.z - C.tgt.z) * k; C.tgt.y += (_v.y - C.tgt.y) * Math.min(1, dt * 12);
      let d = C.dist; const cp = Math.cos(C.pitch), bx = -Math.cos(C.yaw) * cp, bz = Math.sin(C.yaw) * cp, by = Math.sin(C.pitch);
      // keep the camera out of walls and off the ground: pull in along the arm
      let ok = d; for (let i = 1; i <= 8; i++) { const r = d * i / 8, x = C.tgt.x + bx * r, y = C.tgt.y + by * r, z = C.tgt.z + bz * r; if (H.top(x, -z, y + 1) > y - 0.6) { ok = Math.max(2.5, d * (i - 1) / 8); break; } }
      C.clip = C.clip === undefined || !C.init ? ok : C.clip + (ok - C.clip) * Math.min(1, dt * (ok < C.clip ? 20 : 2)); d = Math.min(d, C.clip);
      const sh = (C.shake * C.shake * 0.35 + buzz * 0.04), n = g.frame;
      cam.position.set(C.tgt.x + bx * d + Math.sin(n * 1.7) * sh, Math.max(C.tgt.y + by * d + Math.sin(n * 2.3) * sh, 0.6), C.tgt.z + bz * d + Math.cos(n * 1.3) * sh);
      _v.set(C.tgt.x, C.tgt.y + (far ? 0.5 : 0.2), C.tgt.z);     // the aircraft sits just below the middle of the frame, always
      cam.up.set(0, 1, 0); cam.lookAt(_v);
      // a little of the bank reaches the horizon
      C.bank = (C.bank || 0) + (clamp(-f.roll * 0.1 * Math.cos(wrapPi(C.yaw - hd)), -0.07, 0.07) - (C.bank || 0)) * Math.min(1, dt * 2.5); cam.rotateZ(C.bank);
      C.fov += ((far ? 44 : 46) + fast * 8 - C.fov) * Math.min(1, dt * 2.5);
    }
    C.init = true;
    // The near plane. The game's renderer pushes it out with the camera's height (to 6 m from 300 m up, for depth precision over the far city): right for a
    // camera outside, but from the seat it cut the whole cabin away (Matt, Nov 10: "as I got higher up, it got all weird ... I started seeing the world").
    // world.fixedNear pins it; set while the eye is in the cabin, cleared otherwise so the renderer's own rule runs.
    const inCab = mode === 'cockpit'; g.world.fixedNear = 0; g.world.nearObject = inCab ? this.root : null;     /* lead, Nov 10 23:00: pinning the whole frame's near plane at 0.1 m from 250 m up left too little depth for the city (it tore and flickered behind the glass). The aircraft is now drawn in its own pass with a 0.1 m near plane (world.nearObject) and the city keeps the renderer's rule. */
    if (Math.abs(cam.fov - C.fov) > 0.01 || (inCab && cam.near !== near) || (!inCab && this._wasIn)) { cam.fov = C.fov; if (inCab || this._wasIn) cam.near = near; cam.updateProjectionMatrix(); }
    this._wasIn = inCab;
    // what the rest of the game reads: where the action is, and which way the map turns
    g.cam.tx = this.mapX; g.cam.ty = this.mapY; g.cam.yaw = mode === 'cockpit' ? hd + C.headYaw : C.yaw; this.insideView = mode === 'cockpit';
  }
  // the point the sun-shadow box should follow while the helicopter has the camera
  shadowFocus(out) { return out.copy(this.f.pos); }

  // ------------------------------------------------------------------ every drawn frame
  sync(dt) {
    const g = this.g, f = this.f, pl = g.player, cam = g.world.camera;
    // the model's origin is on the ground under the mast; the flight model's is the centre of gravity
    _v.set(-DIMS.cg[0], -DIMS.cg[1], -DIMS.cg[2]).applyQuaternion(f.quat); this.root.position.copy(f.pos).add(_v); this.root.quaternion.copy(f.quat);
    const inside = this.hasCamera && this.insideView && !g.fly.on;
    this.listener.pos.copy(cam.position); this.listener.inside = inside; this.listener.dist = cam.position.distanceTo(f.pos);
    const view = { inside, camera: cam, dist: this.listener.dist, piloted: this.piloted, door: this.door || 0, dt, t: g.t };
    this.call('model', 'update', f, dt, view); this.call('cockpit', 'update', f, dt, view); this.call('wash', 'update', f, dt, view); this.call('sound', 'update', f, dt, this.listener, view);
    // the pilot: seated in the right seat when flying (hidden from the inside view, where you are the eyes)
    if (this.piloted) {
      const o = pl.vis.object, s = DIMS.pilotSeat, show = !inside && !!pl.vis.acts?.drive; o.visible = show;
      if (show) { g.playerAnim('drive'); _v.set(s[0] - 0.12, s[1] + 0.02, s[2]).applyMatrix4(this.root.matrixWorld.compose(this.root.position, this.root.quaternion, this.root.scale)); o.position.copy(_v); o.quaternion.copy(f.quat); if (pl.vis.mixer) { pl.vis.mixer.timeScale = 1; pl.vis.mixer.update(dt); } }
    } else if (pl.alt && !pl.vehicle && !pl.busy) pl.vis.object.position.y = pl.alt;
    if (!this.hasCamera && this._wasIn) { this._wasIn = false; g.world.fixedNear = 0; g.world.nearObject = null; cam.near = 0.25; cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ on screen
  drawHud(hud) {
    const g = this.g, f = this.f, c = hud.ctx, W = hud.w / hud.k, H = 1080, AMBER = '#ffb82e';
    if (!this.piloted) { if (this.canBoard() && !g.demo) { hud.panel(W / 2 - 150, H * 0.62, 300, 44, 22); hud.text('F', W / 2 - 112, H * 0.62 + 30, 20, AMBER, 'center', 800); hud.text('Fly the helicopter', W / 2 + 14, H * 0.62 + 30, 20, '#fff', 'center', 600); } return; }
    if (this.insideView && !g.P.has('helihud')) { /* in the cockpit the panel is the instrument; only warnings and notes are drawn */ }
    else {
      const x = 36, y = H - 190; hud.panel(x, y, 372, 104);
      const cell = (i, label, val, warn) => { hud.text(label, x + 22 + i * 88, y + 30, 12, AMBER, 'left', 700, 2); hud.text(val, x + 22 + i * 88, y + 66, 28, warn ? '#ff5a45' : '#fff', 'left', 700); };
      cell(0, 'KT', String(Math.round(f.ias * KT))); cell(1, 'ALT FT', String(Math.round(Math.max(0, f.agl) * FT / 10) * 10)); cell(2, 'TQ %', String(Math.round(f.torque * 100)), f.torque > 1.0); cell(3, 'ROTOR', String(Math.round(f.nr * 100)), f.nr < 0.9 && f.engine !== 'starting');
      const vs = clamp(f.vs / 10, -1, 1); c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x + 22, y + 82, 328, 4); c.fillStyle = vs < -0.55 ? '#ff5a45' : AMBER; c.fillRect(x + 22 + 164, y + 82, 164 * vs, 4); c.fillStyle = '#fff'; c.fillRect(x + 22 + 163, y + 78, 2, 12);
    }
    let warn = '';
    if (f.engine === 'off' && !f.onGround) warn = 'ENGINE OUT · LOWER COLLECTIVE · FLARE'; else if (f.engine === 'fail') warn = 'ENGINE FAILED'; else if (f.nr < 0.88 && f.engine === 'run') warn = 'LOW ROTOR RPM'; else if (f.vrs > 0.45) warn = 'SINK RATE · FLY FORWARD'; else if (f.engine === 'starting') warn = 'STARTING'; else if (f.pos.y > CEILING - 12) warn = 'SERVICE CEILING';
    if (warn && (Math.floor(g.t * 3) % 2 || f.engine === 'starting')) { hud.panel(W / 2 - 250, 118, 500, 44, 6); hud.text(warn, W / 2, 148, 20, f.engine === 'starting' ? '#fff' : '#ff5a45', 'center', 700, 2); }
    if (this.note) { c.globalAlpha = clamp(3 - this.note.t, 0, 1); hud.panel(W / 2 - 300, 172, 600, 40, 6); hud.text(this.note.text, W / 2, 199, 17, '#fff', 'center', 600, 1.5); c.globalAlpha = 1; }
    if (this.hintT < 16 && !g.capture) { c.globalAlpha = clamp(16 - this.hintT, 0, 1); hud.panel(W / 2 - 620, H - 58, 1240, 40, 6); hud.text('W S  up / down     A D  turn     ARROWS  tilt     C  view     E  engine     G  mouse flies     T  stability     F  get out (landed)', W / 2, H - 32, 15, '#fff', 'center', 600, 1); c.globalAlpha = 1; }
  }
}

// A plain stand-in body, used only until model.js exists: same size, same moving parts by name.
function standIn() {
  const root = new THREE.Group(), M = (c, r = 0.5, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const add = (geo, mat, x, y, z, par = root) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
  const body = add(new THREE.CapsuleGeometry(0.95, 2.4, 8, 16), M(0x1d3557, 0.35, 0.3), 1.0, 1.45, 0); body.rotation.z = Math.PI / 2;
  const boom = add(new THREE.CylinderGeometry(0.16, 0.34, 6.2, 12), M(0x1d3557, 0.35, 0.3), -4.0, 1.95, 0); boom.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.9, 1.5, 0.08), M(0x1d3557, 0.35, 0.3), -7.0, 2.3, 0);
  for (const s of [-1, 1]) { const sk = add(new THREE.CylinderGeometry(0.045, 0.045, 3.2, 8), M(0x222222), 0.05, 0.045, s * DIMS.skidZ); sk.rotation.z = Math.PI / 2; }
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10), M(0x333333, 0.4, 0.8), 0, 2.8, 0);
  const rotor = new THREE.Group(); rotor.position.set(0, DIMS.rotorY, 0); root.add(rotor);
  for (let i = 0; i < 3; i++) { const b = add(new THREE.BoxGeometry(DIMS.rotorR, 0.03, DIMS.chord), M(0x15171a, 0.6), 0, 0, 0, rotor); b.geometry.translate(DIMS.rotorR / 2, 0, 0); b.rotation.y = i * Math.PI * 2 / 3; }
  const tail = new THREE.Group(); tail.position.set(...DIMS.tailRotor); root.add(tail);
  add(new THREE.BoxGeometry(0.16, DIMS.tailRotorR * 2, 0.02), M(0x15171a, 0.6), 0, 0, 0, tail);
  return { root, standIn: true, update(f, dt, view) { rotor.rotation.y = -f.rotorAngle; tail.rotation.z = f.tailAngle; body.visible = !view.inside; } };
}

export async function addHeli(game) { const h = new Heli(game); await h.init(); return h; }
