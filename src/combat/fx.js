// combat/fx.js: everything a gunshot draws that is not the gun or a body: muzzle flash and its light, tracers, impact dust, sparks,
// chips, glass, blood mist, bullet-hole decals (on the world and riding on cars), ejected casings, dropped magazines, fire, smoke and
// explosions. One pool of camera-facing / velocity-aligned quads in two draws (alpha and additive), three decal draws, one casing draw
// per calibre. All positions here are three.js world space (x east, y up, z = -north).
import * as THREE from 'three';

const N = 1800, CELLS = 4;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
let seed = 1234567; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, rs = (a = 1) => (rnd() * 2 - 1) * a, rr = (a, b) => a + rnd() * (b - a);

// ---- textures (all drawn here: nothing is fetched)
function atlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S * CELLS; const x = c.getContext('2d'); if (!x || !x.createRadialGradient) return null;
  const cell = (i, fn) => { x.save(); x.translate((i % CELLS) * S, Math.floor(i / CELLS) * S); x.beginPath(); x.rect(0, 0, S, S); x.clip(); fn(); x.restore(); };
  const blob = (px, py, r, a) => { const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r); };
  for (let i = 0; i < 4; i++) cell(i, () => { for (let k = 0; k < 46; k++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 66, r = rr(22, 58) * (1 - d / 150); blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, rr(0.10, 0.26)); } });
  for (let i = 4; i < 6; i++) cell(i, () => {      // muzzle flash seen end-on: a hot core and uneven spikes
    x.filter = 'blur(3px)'; x.fillStyle = 'rgba(255,255,255,0.9)'; const n = 5 + Math.floor(rnd() * 3), a0 = rnd() * 6.283;
    for (let k = 0; k < n; k++) { const a = a0 + (k / n) * 6.283 + rs(0.3), L = rr(60, 118), w = rr(0.10, 0.24); x.beginPath(); x.moveTo(128 + Math.cos(a - w) * 16, 128 + Math.sin(a - w) * 16); x.lineTo(128 + Math.cos(a) * L, 128 + Math.sin(a) * L); x.lineTo(128 + Math.cos(a + w) * 16, 128 + Math.sin(a + w) * 16); x.fill(); }
    x.filter = 'none'; blob(128, 128, 62, 1); blob(128, 128, 34, 1);
  });
  cell(6, () => { x.filter = 'blur(4px)'; x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.moveTo(128, 250); x.bezierCurveTo(60, 190, 92, 60, 128, 8); x.bezierCurveTo(164, 60, 196, 190, 128, 250); x.fill(); x.filter = 'none'; blob(128, 196, 56, 0.9); });      // flash from the side: a teardrop, base at the bottom
  cell(7, () => { blob(128, 128, 126, 1); });
  cell(8, () => { const g = x.createLinearGradient(96, 0, 160, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(96, 0, 64, 256); const h = x.createLinearGradient(0, 0, 0, 256); x.globalCompositeOperation = 'destination-in'; h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.25, 'rgba(0,0,0,1)'); h.addColorStop(0.9, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = h; x.fillRect(0, 0, 256, 256); x.globalCompositeOperation = 'source-over'; });
  for (let i = 9; i < 11; i++) cell(i, () => { x.fillStyle = '#fff'; x.beginPath(); const n = 5 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) { const a = (k / n) * 6.283, r = rr(50, 112); x[k ? 'lineTo' : 'moveTo'](128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } x.closePath(); x.fill(); });
  cell(11, () => { x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.moveTo(40, 220); x.lineTo(128, 20); x.lineTo(210, 190); x.closePath(); x.fill(); });
  for (let i = 12; i < 14; i++) cell(i, () => { for (let k = 0; k < 60; k++) { const a = rnd() * 6.283, d = rnd() * rnd() * 110; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr(3, 16), rr(0.4, 0.95)); } blob(128, 128, 60, 0.35); });
  cell(14, () => { x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 10; x.filter = 'blur(5px)'; x.beginPath(); x.arc(128, 128, 104, 0, 7); x.stroke(); x.filter = 'none'; });
  cell(15, () => { for (let k = 0; k < 30; k++) blob(128 + rs(30), rr(30, 226), rr(14, 34), rr(0.08, 0.2)); });
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.NoColorSpace; return t;
}
function decalTex(kind) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'); if (!x || !x.createRadialGradient) return null;
  const jag = (r0, r1, n) => { x.beginPath(); for (let k = 0; k < n; k++) { const a = (k / n) * 6.283, r = rr(r0, r1); x[k ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } x.closePath(); };
  if (kind === 'concrete') {
    x.filter = 'blur(1.2px)'; x.fillStyle = 'rgba(128,122,114,0.9)'; jag(26, 46, 13); x.fill(); x.fillStyle = 'rgba(92,87,81,0.92)'; jag(16, 30, 11); x.fill();
    x.filter = 'blur(0.6px)'; x.fillStyle = 'rgba(18,16,15,0.97)'; jag(9, 16, 9); x.fill(); x.filter = 'none';
    x.strokeStyle = 'rgba(30,28,26,0.55)'; x.lineWidth = 1; for (let k = 0; k < 4; k++) { const a = rnd() * 6.283; x.beginPath(); x.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); x.lineTo(64 + Math.cos(a + rs(0.2)) * rr(34, 58), 64 + Math.sin(a + rs(0.2)) * rr(34, 58)); x.stroke(); }
  } else if (kind === 'metal') {
    x.filter = 'blur(1px)'; x.fillStyle = 'rgba(30,30,32,0.7)'; jag(24, 36, 14); x.fill(); x.fillStyle = 'rgba(214,216,220,0.96)'; jag(13, 19, 14); x.fill();
    x.filter = 'blur(0.5px)'; x.fillStyle = 'rgba(8,8,9,0.98)'; jag(7, 10, 12); x.fill(); x.filter = 'none';
  } else {      // glass: a small hole, a crushed white ring, radial and ring cracks
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 24); g.addColorStop(0, 'rgba(235,240,244,0.55)'); g.addColorStop(0.4, 'rgba(225,232,238,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(225,232,238,0.7)'; x.lineWidth = 1.2; const n = 11 + Math.floor(rnd() * 5), A = []; for (let k = 0; k < n; k++) { const a = (k / n) * 6.283 + rs(0.2), L = rr(30, 62); A.push([a, L]); x.beginPath(); x.moveTo(64 + Math.cos(a) * 5, 64 + Math.sin(a) * 5); x.lineTo(64 + Math.cos(a + rs(0.08)) * L, 64 + Math.sin(a + rs(0.08)) * L); x.stroke(); }
    x.lineWidth = 0.9; for (const r of [9, 15, 27, 41]) for (let k = 0; k < n; k++) { if (rnd() < 0.35) continue; const a = A[k], b = A[(k + 1) % n]; if (a[1] < r || b[1] < r) continue; x.beginPath(); x.moveTo(64 + Math.cos(a[0]) * r, 64 + Math.sin(a[0]) * r); x.lineTo(64 + Math.cos(b[0]) * r * rr(0.92, 1.08), 64 + Math.sin(b[0]) * r * rr(0.92, 1.08)); x.stroke(); }
    x.fillStyle = 'rgba(5,6,8,0.97)'; jag(5, 8.5, 9); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const VS = `
attribute vec3 iPos; attribute vec3 iAxis; attribute vec2 iSR; attribute vec4 iCol; attribute float iFrame;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0); vec2 p = position.xy;
  if (dot(iAxis, iAxis) > 0.0) { vec3 ax = (viewMatrix * vec4(iAxis, 0.0)).xyz; vec3 side = cross(normalize(ax), normalize(mv.xyz)); float sl = length(side); side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0); mv.xyz += ax * (p.y * 2.0) + side * (p.x * iSR.x); }
  else { float c = cos(iSR.y), s = sin(iSR.y); mv.xy += vec2(p.x * c - p.y * s, p.x * s + p.y * c) * iSR.x; }
  float f = floor(iFrame + 0.5); vUv = (vec2(mod(f, ${CELLS}.0), floor(f / ${CELLS}.0)) + vec2(position.x + 0.5, 0.5 - position.y)) / ${CELLS}.0; vUv.y = 1.0 - vUv.y;
  vCol = iCol; gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D tAtlas; varying vec2 vUv; varying vec4 vCol;
void main() { float m = texture2D(tAtlas, vUv).a; float a = m * vCol.a; if (a < 0.004) discard; gl_FragColor = vec4(vCol.rgb, a); }`;

class Quads {
  constructor(tex, additive) {
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n, name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.pos = mk(3, 'iPos'); this.axis = mk(3, 'iAxis'); this.sr = mk(2, 'iSR'); this.col = mk(4, 'iCol'); this.frame = mk(1, 'iFrame'); g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { tAtlas: { value: tex } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 21 : 20; this.g = g; this.n = 0;
  }
  begin() { this.n = 0; }
  put(p, ax, ay, az) { const i = this.n++; this.pos.setXYZ(i, p.x, p.y, p.z); this.axis.setXYZ(i, ax, ay, az); this.sr.setXY(i, p.size, p.rot); this.col.setXYZW(i, p.cr, p.cg, p.cb, p.ca); this.frame.setX(i, p.frame); }
  end() { this.g.instanceCount = this.n; for (const a of [this.pos, this.axis, this.sr, this.col, this.frame]) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); a.needsUpdate = true; } }
}

export class Fx {
  // opts.ground(x, z) -> ground height there; opts.casing(kind) -> {geometry, material}
  constructor(scene, opts = {}) {
    this.scene = scene; this.ground = opts.ground || (() => 0); this.casingOf = opts.casing || (() => null); this.day = opts.day ?? 1.0;
    this.group = new THREE.Group(); this.group.name = 'combat_fx'; scene.add(this.group);
    let tex = null; try { tex = atlas(); if (tex) decalTex('metal'); } catch (e) { tex = null; } this.ok = !!tex; this.p = []; for (let i = 0; i < N; i++) this.p.push({ on: false }); this.cursor = 0; this.live = 0;
    if (this.ok) { this.alpha = new Quads(tex, false); this.add = new Quads(tex, true); this.group.add(this.alpha.mesh, this.add.mesh); }
    // decals
    this.decals = {}; const geo = new THREE.PlaneGeometry(1, 1);
    if (this.ok) for (const [k, cap] of [['concrete', 180], ['metal', 120], ['glass', 60]]) {
      const mat = new THREE.MeshStandardMaterial({ map: decalTex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: k === 'concrete' ? 1 : 0.45, metalness: k === 'metal' ? 0.6 : 0 });
      const im = new THREE.InstancedMesh(geo, mat, cap); im.frustumCulled = false; im.count = cap; im.renderOrder = 4; im.receiveShadow = true; _m.makeScale(0, 0, 0); for (let i = 0; i < cap; i++) im.setMatrixAt(i, _m);
      this.group.add(im); this.decals[k] = { im, cap, i: 0, rec: new Array(cap).fill(null) };
    }
    this.riding = [];      // decals attached to something that moves
    this.cas = {}; this.loose = [];      // casings per kind; loose objects (magazines)
    this.light = new THREE.PointLight(0xffc27a, 0, 16, 2); this.light.castShadow = false; if (opts.light !== false) scene.add(this.light); this.lightT = 0; this.lightI = 0;
    this.emit = [];
  }
  spawn(o) {
    let p = null; for (let k = 0; k < 24; k++) { const q = this.p[this.cursor]; this.cursor = (this.cursor + 1) % N; if (!q.on) { p = q; break; } } if (!p) { p = this.p[this.cursor]; this.cursor = (this.cursor + 1) % N; }
    p.on = true; p.add = !!o.add; p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.age = 0; p.life = o.life || 1; p.s0 = o.s0 ?? 0.1; p.s1 = o.s1 ?? p.s0; p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1; p.a0 = o.a ?? 1;
    p.frame = o.frame || 0; p.rot = o.rot ?? rnd() * 6.283; p.rotv = o.rotv || 0; p.grav = o.grav || 0; p.drag = o.drag || 0; p.stretch = o.stretch || 0; p.len = o.len || 0; p.fade = o.fade ?? 1; p.fin = o.fin || 0; p.bounce = o.bounce || 0; p.r1 = o.r1 ?? p.r; p.g1 = o.g1 ?? p.g; p.b1 = o.b1 ?? p.b; p.ax = o.ax || 0; p.ay = o.ay || 0; p.az = o.az || 0; p.delay = o.delay || 0; p.up = o.up || 0;
    return p;
  }

  // ---- what a shot makes
  muzzle(pos, dir, kind, camPos) {
    const big = kind === 'shotgun' ? 1.55 : kind === 'rifle' ? 1.25 : kind === 'smg' ? 0.9 : 0.8, s = big * rr(0.85, 1.15);
    const C = [9.0, 5.2, 1.9];
    // a shaped flash: a short tongue out of the bore, a small star at its root, a faint glow; it lasts three frames and shrinks
    const L = 0.085;
    this.spawn({ add: true, x: pos.x + dir.x * 0.03, y: pos.y + dir.y * 0.03, z: pos.z + dir.z * 0.03, life: L, s0: (kind === 'pistol' ? 0.36 : 0.24) * s, s1: 0.08 * s, r: C[0], g: C[1], b: C[2], r1: 5, g1: 1.6, b1: 0.3, a: 1, frame: 4 + (rnd() < 0.5 ? 1 : 0), fade: 0.7 });
    this.spawn({ add: true, x: pos.x + dir.x * 0.2 * s, y: pos.y + dir.y * 0.2 * s, z: pos.z + dir.z * 0.2 * s, life: L, s0: 0.17 * s, s1: 0.07 * s, r: C[0], g: C[1], b: C[2], r1: 5, g1: 1.6, b1: 0.3, a: 1, frame: 6, ax: dir.x * 0.16 * s, ay: dir.y * 0.16 * s, az: dir.z * 0.16 * s, fade: 0.7 });
    this.spawn({ x: pos.x + dir.x * 0.12 * s, y: pos.y + dir.y * 0.12 * s, z: pos.z + dir.z * 0.12 * s, life: L, s0: 0.12 * s, s1: 0.05 * s, r: 1.9, g: 1.15, b: 0.3, r1: 1.5, g1: 0.5, b1: 0.1, a: 0.9, frame: 6, ax: dir.x * 0.13 * s, ay: dir.y * 0.13 * s, az: dir.z * 0.13 * s, fade: 0.6 });
    this.spawn({ x: pos.x + dir.x * 0.03, y: pos.y + dir.y * 0.03, z: pos.z + dir.z * 0.03, life: L, s0: 0.16 * s, s1: 0.06 * s, r: 1.9, g: 1.2, b: 0.35, r1: 1.5, g1: 0.5, b1: 0.1, a: 0.9, frame: 4, fade: 0.6 });
    this.spawn({ add: true, x: pos.x + dir.x * 0.06, y: pos.y + dir.y * 0.06, z: pos.z + dir.z * 0.06, life: L, s0: 0.42 * s, s1: 0.3 * s, r: 1.7, g: 0.85, b: 0.3, a: 0.26, frame: 7, fade: 1 });
    for (let i = 0; i < (kind === 'shotgun' ? 7 : 3); i++) { const sp = rr(6, 22); this.spawn({ add: true, x: pos.x, y: pos.y, z: pos.z, vx: dir.x * sp + rs(3), vy: dir.y * sp + rs(3), vz: dir.z * sp + rs(3), life: rr(0.05, 0.14), s0: 0.012, r: 8, g: 4, b: 1.2, frame: 8, stretch: 0.012, drag: 6 }); }
    // powder smoke: a quick jet out of the muzzle, then a pale cloud that hangs and drifts for a couple of seconds
    /* powder smoke: thin grey veils that leave the muzzle along the barrel line, swell to half a metre and drift up for three or four seconds (small bright puffs read as 'white cotton balls hanging at the muzzle': round 11) */
    const d = this.day; for (let i = 0; i < (kind === 'shotgun' ? 8 : kind === 'pistol' ? 5 : 2); i++) { const sp = rr(0.4, 3.2); this.spawn({ delay: i * 0.025, x: pos.x + dir.x * 0.1, y: pos.y + dir.y * 0.1, z: pos.z + dir.z * 0.1, vx: dir.x * sp + rs(0.35) + 0.12, vy: dir.y * sp + 0.28 + rs(0.25), vz: dir.z * sp + rs(0.35), life: rr(2.4, 4.2), s0: 0.1 * big, s1: rr(0.7, 1.25) * big, r: 0.2 * d, g: 0.2 * d, b: 0.215 * d, a: kind === 'pistol' || kind === 'shotgun' ? 0.12 : 0.06, frame: (i + this.cursor) % 4, drag: 3.4, rotv: rs(0.7), fin: 0.08 }); }
    /* the flash's light: at the muzzle with a short reach, so it falls on the gun, the hands and the face and dies before the jacket or anyone down the street (a long-reach light gave yellow patches on the jacket and tinted the victim) */ this.light.position.set(pos.x + dir.x * 0.1, pos.y + dir.y * 0.1 + 0.04, pos.z + dir.z * 0.1); this.lightI = 3.0 * big * (this.lightK ?? 1); this.lightT = 0.09; this.light.distance = this.lightR || 2.4;
  }
  tracer(from, to, speed = 420) {
    _v.subVectors(to, from); const L = _v.length(); if (L < 4) return; _v.multiplyScalar(1 / L); const len = Math.min(9, L * 0.45), start = 1.2;
    this.spawn({ add: true, x: from.x + _v.x * start, y: from.y + _v.y * start, z: from.z + _v.z * start, vx: _v.x * speed, vy: _v.y * speed, vz: _v.z * speed, life: Math.max(0.017, (L - start - len) / speed), s0: 0.022, r: 5.5, g: 4.2, b: 2.2, a: 0.55, frame: 8, len, fade: 0 });
    // the wake of the bullet: a thin grey thread that hangs a moment
    if (L > 6 && rnd() < 0.6) this.spawn({ x: from.x + _v.x * L * 0.5, y: from.y + _v.y * L * 0.5, z: from.z + _v.z * L * 0.5, life: 0.22, s0: 0.016, s1: 0.03, r: 0.8, g: 0.8, b: 0.82, a: 0.10, frame: 8, ax: _v.x * (L - 2) * 0.25, ay: _v.y * (L - 2) * 0.25, az: _v.z * (L - 2) * 0.25, fin: 0.03 });
  }
  // material: concrete | asphalt | metal | glass | flesh | wood | tyre
  impact(pos, n, material, o = {}) {
    const d = this.day, x = pos.x + n.x * 0.02, y = pos.y + n.y * 0.02, z = pos.z + n.z * 0.02, pw = o.power || 1;
    const puff = (k, c, a, s, sp, life) => { for (let i = 0; i < k; i++) this.spawn({ x, y, z, vx: n.x * rr(0.4, sp) + rs(sp * 0.3), vy: n.y * rr(0.4, sp) + rs(sp * 0.3) + 0.2, vz: n.z * rr(0.4, sp) + rs(sp * 0.3), life: rr(life * 0.6, life), s0: s * 0.25, s1: s * rr(0.8, 1.3), r: c[0] * d, g: c[1] * d, b: c[2] * d, a, frame: i % 4, drag: 3.6, rotv: rs(1.5), fin: 0.04 }); };
    const chips = (k, c, sp, size) => { for (let i = 0; i < k; i++) this.spawn({ x, y, z, vx: n.x * rr(1, sp) + rs(sp * 0.55), vy: n.y * rr(1, sp) + rs(sp * 0.55) + 1.2, vz: n.z * rr(1, sp) + rs(sp * 0.55), life: rr(0.5, 1.1), s0: rr(0.4, 1) * size, r: c[0] * d * rr(0.7, 1.1), g: c[1] * d * rr(0.7, 1.1), b: c[2] * d * rr(0.7, 1.1), a: 1, frame: 9 + (i & 1), grav: 9.8, rotv: rs(18), bounce: 0.3, fade: 0.25 }); };
    const sparks = (k, sp) => { for (let i = 0; i < k; i++) this.spawn({ add: true, x, y, z, vx: n.x * rr(2, sp) + rs(sp * 0.6), vy: n.y * rr(2, sp) + rs(sp * 0.6) + 1, vz: n.z * rr(2, sp) + rs(sp * 0.6), life: rr(0.1, 0.3), s0: 0.007, r: 9, g: 5.2, b: 1.6, r1: 5, g1: 1.2, b1: 0.2, frame: 8, stretch: 0.02, grav: 9.8, drag: 1.2, bounce: 0.4 }); };
    if (material === 'concrete' || material === 'asphalt' || material === 'wood') {
      const c = material === 'asphalt' ? [0.34, 0.33, 0.32] : material === 'wood' ? [0.5, 0.4, 0.28] : [0.66, 0.63, 0.58];
      puff(4, c, 0.34, 0.5 * pw, 2.6, 1.0); puff(2, c, 0.5, 0.2 * pw, 5, 0.3); chips(material === 'wood' ? 5 : 7, material === 'asphalt' ? [0.2, 0.2, 0.2] : c, 5, 0.03);
      if (rnd() < 0.3) sparks(3, 7);
      this.spawn({ add: true, x, y, z, life: 0.03, s0: 0.14, r: 3, g: 2.2, b: 1.2, a: 0.6, frame: 7, fade: 0 });
    } else if (material === 'metal') { sparks(7, 8); puff(2, [0.5, 0.5, 0.5], 0.2, 0.22, 2, 0.4); this.spawn({ add: true, x, y, z, life: 0.035, s0: 0.3, r: 8, g: 5.5, b: 2.4, a: 1, frame: 5, fade: 0 }); chips(2, [0.12, 0.12, 0.13], 4, 0.016); }
    else if (material === 'glass') { for (let i = 0; i < 16; i++) this.spawn({ x, y, z, vx: n.x * rr(0.5, 4) + rs(2.4), vy: n.y * rr(0.5, 4) + rs(2.4) + 1, vz: n.z * rr(0.5, 4) + rs(2.4), life: rr(0.4, 0.8), s0: rr(0.006, 0.016), r: 0.8 * d, g: 0.9 * d, b: 0.95 * d, a: 0.7, frame: 11, grav: 9.8, rotv: rs(20), bounce: 0.25, fade: 0.2 }); puff(2, [0.9, 0.95, 1], 0.14, 0.25, 2, 0.35); sparks(2, 5); }
    else if (material === 'tyre') { puff(4, [0.16, 0.16, 0.16], 0.4, 0.45, 3, 0.7); chips(4, [0.04, 0.04, 0.04], 4, 0.02); }
    else if (material === 'flesh') { this.blood(pos, n, pw); }
  }
  blood(pos, n, pw = 1) {
    /* a dark mist at the wound that hangs a moment, and a few fine dark streaks: round saturated drops read as 'bright-red dots and petal confetti' (rounds 6-8) */
    const d = this.day;
    for (let i = 0; i < 4; i++) this.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * rr(0.4, 2.2) + rs(0.5), vy: n.y * rr(0.4, 2.2) + rs(0.5) + 0.25, vz: n.z * rr(0.4, 2.2) + rs(0.5), life: rr(0.35, 0.7), s0: 0.05 * pw, s1: rr(0.26, 0.4) * pw, r: 0.13 * d, g: 0.016 * d, b: 0.014 * d, a: 0.5, frame: i % 4, drag: 5, grav: 1.5, rotv: rs(1.2), fin: 0.02 });
    for (let i = 0; i < 4; i++) this.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * rr(1.5, 5) + rs(1.2), vy: n.y * rr(1.5, 5) + rs(1.2) + 0.6, vz: n.z * rr(1.5, 5) + rs(1.2), life: rr(0.18, 0.4), s0: rr(0.004, 0.008), r: 0.09 * d, g: 0.008 * d, b: 0.008 * d, a: 0.85, frame: 8, grav: 9.8, stretch: 0.03, fade: 0.5 });
  }
  // a hole in a surface. attach: null, or {matrix(out Matrix4)} whose matrix carries local -> world each frame (pos/normal are then local)
  decal(kind, pos, n, size, attach = null) {
    const D = this.decals[kind]; if (!D) return; const i = D.i; D.i = (D.i + 1) % D.cap;
    _q.setFromUnitVectors(Z, _v.copy(n).normalize()); _q2.setFromAxisAngle(Z, rnd() * 6.283); _q.multiply(_q2);
    const old = D.rec[i]; if (old && old.attach) { const k = this.riding.indexOf(old); if (k >= 0) this.riding.splice(k, 1); }
    const rec = { D, i, attach, local: new THREE.Matrix4().compose(_v2.copy(pos).addScaledVector(n, 0.004), _q, _s.set(size, size, size)) }; D.rec[i] = rec;
    if (attach) this.riding.push(rec); else { D.im.setMatrixAt(i, rec.local); D.im.instanceMatrix.needsUpdate = true; }
  }
  dropDecals(attach) { for (let k = this.riding.length - 1; k >= 0; k--) { const r = this.riding[k]; if (r.attach === attach) { _m.makeScale(0, 0, 0); r.D.im.setMatrixAt(r.i, _m); r.D.im.instanceMatrix.needsUpdate = true; r.D.rec[r.i] = null; this.riding.splice(k, 1); } } }
  casing(kind, pos, vel) {
    let C = this.cas[kind]; if (C === undefined) { const g = this.casingOf(kind); if (!g) { this.cas[kind] = null; return; } let cm = g.material; try { cm = g.material.clone(); if (cm.color) cm.color.multiplyScalar(0.32); if (cm.roughness !== undefined) cm.roughness = Math.max(cm.roughness, 0.5); if (cm.emissiveIntensity !== undefined) cm.emissiveIntensity *= 0.3; } catch (e) { cm = g.material; }      /* brass, not yellow bars: the models' casing material is kept, ours is a darker copy */
    const im = new THREE.InstancedMesh(g.geometry, cm, 56); im.frustumCulled = false; im.castShadow = true; _m.makeScale(0, 0, 0); for (let i = 0; i < 56; i++) im.setMatrixAt(i, _m); this.group.add(im); C = this.cas[kind] = { im, i: 0, list: [] }; }
    if (!C) return; const i = C.i; C.i = (C.i + 1) % 56; C.list = C.list.filter((c) => c.i !== i);
    C.list.push({ i, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, q: new THREE.Quaternion().setFromEuler(_e.set(rs(3), rs(3), rs(3))), wx: rs(1), wy: rs(1), wz: rs(1), w: rr(18, 40), age: 0, rest: false, hit: 0 });
  }
  // a loose rigid thing (a dropped magazine): falls, bounces once or twice, lies there
  loosen(obj, vel) { this.group.add(obj); this.loose.push({ o: obj, vx: vel.x, vy: vel.y, vz: vel.z, wx: rs(1), wz: rs(1), w: rr(4, 9), age: 0, rest: false }); if (this.loose.length > 10) { const d = this.loose.shift(); this.group.remove(d.o); } }
  explosion(pos) {
    const d = this.day, x = pos.x, y = pos.y, z = pos.z;
    this.spawn({ add: true, x, y: y + 0.6, z, life: 0.09, s0: 4, s1: 9, r: 7, g: 4, b: 1.5, a: 0.9, frame: 7, fade: 1 });
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, e = rnd() * 1.3, sp = rr(3, 13); this.spawn({ add: true, x: x + rs(0.8), y: y + rr(0.2, 1.2), z: z + rs(0.8), vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp, life: rr(0.35, 0.8), s0: rr(0.8, 1.6), s1: rr(2.4, 4.2), r: 4.6, g: 1.8, b: 0.35, r1: 1.0, g1: 0.16, b1: 0.02, a: 0.8, frame: i % 4, drag: 3.0, rotv: rs(2), fin: 0.02 }); }
    for (let i = 0; i < 22; i++) { const a = rnd() * 6.283, sp = rr(1, 7); this.spawn({ x: x + rs(1), y: y + rr(0.3, 1.5), z: z + rs(1), vx: Math.cos(a) * sp, vy: rr(2, 7), vz: Math.sin(a) * sp, life: rr(1.6, 3.6), s0: rr(1, 2), s1: rr(4, 7.5), r: 0.07 * d, g: 0.065 * d, b: 0.06 * d, a: 0.72, frame: i % 4, drag: 1.6, rotv: rs(0.8), fin: 0.12, delay: rr(0.04, 0.3) }); }
    for (let i = 0; i < 60; i++) { const a = rnd() * 6.283, e = rnd() * 1.4, sp = rr(6, 30); this.spawn({ add: true, x, y: y + 0.6, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, life: rr(0.4, 1.3), s0: 0.03, r: 10, g: 5, b: 1.4, r1: 4, g1: 0.8, b1: 0.1, frame: 8, stretch: 0.022, grav: 9.8, drag: 0.8, bounce: 0.35 }); }
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, sp = rr(3, 15); this.spawn({ x, y: y + 0.5, z, vx: Math.cos(a) * sp, vy: rr(3, 13), vz: Math.sin(a) * sp, life: rr(1, 2.2), s0: rr(0.04, 0.16), r: 0.05, g: 0.05, b: 0.05, a: 1, frame: 9 + (i & 1), grav: 9.8, rotv: rs(14), bounce: 0.3, fade: 0.15 }); }
    this.spawn({ x, y: y + 0.08, z, life: 0.5, s0: 2, s1: 17, r: 0.75 * d, g: 0.72 * d, b: 0.68 * d, a: 0.3, frame: 14, flat: true });
    this.light.position.set(x, y + 1.5, z); this.light.distance = 45; this.lightI = 220; this.lightT = 0.3; this.light.intensity = 220;
  }
  // something that keeps giving off smoke or fire: {pos: Vector3 | () => Vector3, kind: 'smoke' | 'fire' | 'steam', life}
  emitter(e) { e.t = 0; e.acc = 0; this.emit.push(e); return e; }

  update(dt, cam) {
    if (!this.ok) return; const d = this.day;
    for (let k = this.emit.length - 1; k >= 0; k--) {
      const e = this.emit[k]; e.t += dt; if (e.t > e.life || e.dead) { this.emit.splice(k, 1); continue; } const p = typeof e.pos === 'function' ? e.pos(_v3) : e.pos; if (!p) continue;
      e.acc += dt * (e.kind === 'fire' ? 60 : e.kind === 'steam' ? 9 : 12) * (e.rate || 1); const fadeOut = Math.min(1, (e.life - e.t) / 3);
      while (e.acc >= 1) { e.acc -= 1;
        if (e.kind === 'fire') { const w = e.wide || 0.55; this.spawn({ add: true, x: p.x + rs(w), y: p.y + rr(-0.1, 0.25), z: p.z + rs(w), vx: rs(0.35), vy: rr(1.2, 3.0), vz: rs(0.35), life: rr(0.3, 0.7), s0: rr(0.38, 0.62), s1: rr(0.1, 0.2), r: 3.0, g: 1.15, b: 0.2, r1: 1.4, g1: 0.16, b1: 0.02, a: 0.5 * fadeOut, frame: 6, up: rr(0.5, 0.85), drag: 0.5, fin: 0.05, rot: 0 });
          if (rnd() < 0.5) this.spawn({ add: true, x: p.x + rs(w), y: p.y + rr(0, 0.5), z: p.z + rs(w), vx: rs(0.5), vy: rr(1.5, 3.4), vz: rs(0.5), life: rr(0.3, 0.6), s0: rr(0.3, 0.55), s1: 0.1, r: 2.2, g: 0.7, b: 0.1, r1: 0.9, g1: 0.1, b1: 0.01, a: 0.45 * fadeOut, frame: this.cursor % 4, drag: 0.6, rotv: rs(3), fin: 0.05 });
          if (rnd() < 0.12) this.spawn({ add: true, x: p.x, y: p.y + 0.3, z: p.z, life: 0.12, s0: 2.4, s1: 2.8, r: 1.3, g: 0.5, b: 0.1, a: 0.22 * fadeOut, frame: 7, fin: 0.04 });
          if (rnd() < 0.1) this.spawn({ add: true, x: p.x + rs(w), y: p.y + 0.5, z: p.z + rs(w), vx: rs(1.5), vy: rr(2, 5), vz: rs(1.5), life: rr(0.5, 1.2), s0: 0.012, r: 8, g: 3.5, b: 0.8, frame: 8, stretch: 0.03, drag: 0.5 });
          if (rnd() < 0.3) this.spawn({ x: p.x + rs(0.4), y: p.y + 0.9, z: p.z + rs(0.4), vx: rs(0.5) + 0.5, vy: rr(2, 3.6), vz: rs(0.5), life: rr(2.4, 4.6), s0: 0.8, s1: rr(3, 5.5), r: 0.06 * d, g: 0.055 * d, b: 0.05 * d, a: 0.6 * fadeOut, frame: this.cursor % 4, drag: 0.35, rotv: rs(0.6), fin: 0.15 }); }
        else { const c = e.kind === 'steam' ? 0.5 : 0.16; this.spawn({ x: p.x + rs(0.25), y: p.y, z: p.z + rs(0.25), vx: rs(0.3) + 0.35, vy: rr(1.0, 2.2), vz: rs(0.3), life: rr(1.6, 3.4), s0: 0.3, s1: rr(1.6, 3.2) * (e.kind === 'steam' ? 0.55 : 1), r: c * d, g: c * d, b: c * d, a: (e.kind === 'steam' ? 0.1 : 0.5) * fadeOut, frame: this.cursor % 4, drag: 0.4, rotv: rs(0.7), fin: 0.2 }); }
      }
    }
    this.alpha.begin(); this.add.begin(); let live = 0;
    for (const p of this.p) {
      if (!p.on) continue; if (p.delay > 0) { p.delay -= dt; live++; continue; }
      p.age += dt; if (p.age >= p.life) { p.on = false; continue; } live++;
      const u = p.age / p.life;
      if (p.grav) p.vy -= p.grav * dt; if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.rotv * dt;
      if (p.bounce) { const gy = this.ground(p.x, p.z) + 0.01; if (p.y < gy) { p.y = gy; if (p.vy < -0.6) { p.vy = -p.vy * p.bounce; p.vx *= 0.6; p.vz *= 0.6; p.rotv *= 0.5; } else { p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; p.rotv = 0; p.grav = 0; } } }
      p.size = p.s0 + (p.s1 - p.s0) * (1 - (1 - u) * (1 - u));
      let a = p.a0; if (p.fade) a *= Math.min(1, (1 - u) / p.fade); if (p.fin) a *= Math.min(1, p.age / p.fin);
      p.cr = p.r + (p.r1 - p.r) * u; p.cg = p.g + (p.g1 - p.g) * u; p.cb = p.b + (p.b1 - p.b) * u; p.ca = a;
      const Q = p.add ? this.add : this.alpha;
      if (p.len) Q.put(p, (p.vx || 0) === 0 && !p.vy && !p.vz ? 0 : p.vx / Math.hypot(p.vx, p.vy, p.vz) * p.len * 0.5, p.vy / (Math.hypot(p.vx, p.vy, p.vz) || 1) * p.len * 0.5, p.vz / (Math.hypot(p.vx, p.vy, p.vz) || 1) * p.len * 0.5);
      else if (p.stretch) { const sp = Math.hypot(p.vx, p.vy, p.vz), L = Math.max(p.s0, sp * p.stretch) * 0.5 / (sp || 1); Q.put(p, p.vx * L, p.vy * L, p.vz * L); }
      else if (p.up) Q.put(p, 0, p.size * p.up, 0);
      else Q.put(p, p.ax, p.ay, p.az);
    }
    this.live = live; this.alpha.end(); this.add.end();
    if (this.lightT > 0 || this.light.intensity > 0) { this.lightT -= dt; this.light.intensity = this.lightT > 0 ? this.lightI * Math.min(1, this.lightT / 0.05) : 0; }
    // casings: ballistic, a couple of ringing bounces, then they lie on their side
    for (const k in this.cas) { const C = this.cas[k]; if (!C || !C.list.length) continue; let dirty = false;
      for (const c of C.list) { if (c.rest) continue; dirty = true; c.age += dt; c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        _q2.setFromAxisAngle(_v.set(c.wx, c.wy, c.wz).normalize(), c.w * dt); c.q.premultiply(_q2);
        const gy = this.ground(c.x, c.z) + 0.006; if (c.y < gy) { c.y = gy; c.hit++; if (c.hit === 1 && this.onCasing) this.onCasing(k, c); if (Math.abs(c.vy) < 0.9 || c.hit > 3) { c.rest = true; c.q.setFromEuler(_e.set(0, rnd() * 6.283, 0)); } else { c.vy = -c.vy * 0.42; c.vx = c.vx * 0.55 + rs(0.5); c.vz = c.vz * 0.55 + rs(0.5); c.w *= 0.6; } }
        _m.compose(_v.set(c.x, c.y, c.z), c.q, _s.set(0.9, 0.9, 0.9)); C.im.setMatrixAt(c.i, _m); }
      if (dirty) C.im.instanceMatrix.needsUpdate = true; }
    for (const L of this.loose) { if (L.rest) continue; L.age += dt; L.vy -= 9.8 * dt; const o = L.o; o.position.x += L.vx * dt; o.position.y += L.vy * dt; o.position.z += L.vz * dt; o.rotateOnWorldAxis(_v.set(L.wx, 0, L.wz).normalize(), L.w * dt);
      const gy = this.ground(o.position.x, o.position.z) + 0.012; if (o.position.y < gy) { o.position.y = gy; if (Math.abs(L.vy) < 1.2) { L.rest = true; o.rotation.set(Math.PI / 2, 0, rnd() * 6.283); if (this.onMag) this.onMag(L); } else { L.vy = -L.vy * 0.3; L.vx *= 0.5; L.vz *= 0.5; L.w *= 0.5; if (this.onMag) this.onMag(L); } } }
    // decals that ride on cars
    if (this.riding.length) { const touched = new Set(); for (const r of this.riding) { if (!r.attach.matrix(_m)) { _m.makeScale(0, 0, 0); r.D.im.setMatrixAt(r.i, _m); } else { _m.multiply(r.local); r.D.im.setMatrixAt(r.i, _m); } touched.add(r.D); } for (const D of touched) D.im.instanceMatrix.needsUpdate = true; }
  }
}
