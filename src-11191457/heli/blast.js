// blast.js: what a helicopter rocket does where it lands (heli lane, Nov 16), and the smoke and fire it is drawn with.
// Puffs: one pool of camera-facing quads drawn in two calls (smoke, then fire added on top); each puff lives on the card: its place, speed,
// birth and size are written once and the vertex shader moves, swells and fades it.
// boomAt(game, heli, puffs, x, y, z, { car }): the fireball, smoke column, sparks and sound at a point of the three.js world, and the harm:
// the game's own car explosion for cars in the middle of it, the game's own gun damage for people and cars further out, street things knocked
// over, the aircraft itself hurt and shaken if it is close, and a crime for the police.
import * as THREE from 'three';

const N = 3000;      // puffs alive at once in each of the two pools (a trail is a puff every metre and a half)
const VERT = /* glsl */`
  attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aLife;      // aLife: birth, life (s), size at birth (m), growth (m/s)
  attribute float aSeed; uniform float uT; uniform float uRise; uniform vec3 uSunW; varying float vA; varying vec2 vUv; varying float vSeed; varying float vAge; varying vec3 vL; varying vec2 vRot;
  void main() {
    float age = uT - aLife.x, u = clamp(age / max(aLife.y, 0.001), 0.0, 1.0);
    float drag = (1.0 - exp(-age * 2.2)) / 2.2;
    vec3 p = aPos + aVel * drag + vec3(0.0, uRise * age * age * 0.5 + uRise * age * 0.6, 0.0);
    float size = (aLife.z + aLife.w * (1.0 - exp(-age * 1.6)) / 1.6) * step(0.0, age) * step(age, aLife.y);
    float sd0 = fract(aSeed); float rot = sd0 * 6.283 + age * (sd0 - 0.5) * 1.4, c = cos(rot), s = sin(rot);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    vec4 mv = viewMatrix * vec4(p, 1.0); mv.xy += q * size;
    gl_Position = projectionMatrix * mv; vUv = uv; vA = u; vSeed = aSeed; vAge = age; vL = normalize(mat3(viewMatrix) * uSunW); vRot = vec2(c, s);
  }`;
// the billow: one read of a small repeating cloud picture (made once, below) instead of value noise worked out in every pixel
// (heli lane, Nov 17: sustained rocket fire cost 8 fps on an M2 Max, CHIEF 04:47; the puffs are big and lie over each other)
const NOISE = /* glsl */`
  uniform sampler2D uN;
  float fbm(vec2 p) { return texture2D(uN, p * 0.25).r; }`;
function cloudTex() {
  const n = 128, d = new Uint8Array(n * n * 4); let s = 12345; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const oct = [4, 8, 16, 32].map((k) => { const g = new Float32Array(k * k); for (let i = 0; i < g.length; i++) g[i] = r(); return { k, g }; });
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0, w = 0.5, t = 0; for (const o of oct) { const fx = x / n * o.k, fy = y / n * o.k, x0 = Math.floor(fx), y0 = Math.floor(fy), ux = fx - x0, uy = fy - y0, sx = ux * ux * (3 - 2 * ux), sy = uy * uy * (3 - 2 * uy), at = (i, j) => o.g[((j % o.k) * o.k) + (i % o.k)];
      v += w * ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy); t += w; w *= 0.5; } const c = Math.round(v / t * 255); d.set([c, c, c, 255], (y * n + x) * 4); }
  const tex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true; return tex;
}
// smoke as a lit billow (second critic, Nov 17: "flat, unlit, uniformly dark and see-through ... a Photoshop airbrush"): each puff is shaded as a lumpy ball
// (a normal made from its own shape and the cloud picture, turned with the puff), lit by the sun on one side and the sky from above, solid in its middle,
// broken at its edge; black-brown when young, grey as it ages; pale for dust and exhaust; glowing underneath for the first moments over the fire
const FRAG_SMOKE = /* glsl */`
  varying float vA; varying vec2 vUv; varying float vSeed; varying float vAge; varying vec3 vL; varying vec2 vRot; uniform vec3 uSun; uniform float uEdge;      // uEdge: how wide the puff's soft rim is (0.2 as before; 0.4 with the helicopter's new effects: 'separate cotton balls')
  ${NOISE}
  void main() {
    float sh = floor(vSeed) / 8.0, sd = fract(vSeed);
    vec2 d = vUv - 0.5; float r = length(d) * 2.0;
    float n = fbm(vUv * 2.6 + sd * 40.0 + vec2(0.0, -vAge * 0.12)), n2 = fbm(vUv * 2.6 + sd * 17.0 + vec2(0.37, vAge * 0.1));
    float shape = 0.86 - r + (n - 0.5) * 0.8;
    float a = smoothstep(0.0, uEdge, shape) * (1.0 - smoothstep(0.62, 1.0, vA)) * smoothstep(0.0, 0.04, vA) * mix(1.0, 0.42, sh) * smoothstep(1.0, 0.8, max(abs(d.x), abs(d.y)) * 2.0);      /* and out before the card's own straight edge */
    if (a < 0.01) discard;
    vec2 q = d * 2.0 + (vec2(n, n2) - 0.5) * 1.3; q = vec2(q.x * vRot.x + q.y * vRot.y, -q.x * vRot.y + q.y * vRot.x);      // back from the puff's own turn to the screen's axes
    vec3 N = normalize(vec3(q, sqrt(max(0.06, 1.0 - min(r * r, 0.94)))));
    float dif = max(dot(N, vL), 0.0), sky = 0.5 + 0.5 * N.y, hollow = smoothstep(0.0, 0.5, shape);
    vec3 young = vec3(0.015, 0.013, 0.012), old = vec3(0.105, 0.1, 0.097), base = mix(mix(young, old, smoothstep(0.1, 0.9, vA) * (0.35 + 0.65 * sd)), vec3(0.46, 0.44, 0.41), sh);
    vec3 col = base * (0.3 + 0.45 * sky + 1.25 * dif) * (0.55 + 0.45 * hollow) * uSun;
    col += vec3(1.0, 0.33, 0.06) * (1.0 - sh) * exp(-vAge * 4.0) * (0.5 - 0.5 * N.y) * 1.6;      // the fire under it
    gl_FragColor = vec4(col, a);
  }`;
// flame with a body (fourth critic, Nov 17: "a transparent, uniformly orange sprite ... buildings show through fire"): not light added on top but a solid, billowing
// puff whose own colour runs by heat: white-yellow in its middle while young, orange, dull red, then soot-black at its edge and all over as it ages, when it is smoke
const FRAG_FLAME = /* glsl */`
  varying float vA; varying vec2 vUv; varying float vSeed; varying float vAge;
  ${NOISE}
  void main() {
    float sd = fract(vSeed); vec2 d = vUv - 0.5; float r = length(d) * 2.0;
    float n = fbm(vUv * 2.8 + sd * 31.0 + vec2(0.0, -vAge * 0.9)), n2 = fbm(vUv * 5.5 + sd * 11.0 + vec2(vAge * 0.4, -vAge * 1.5));
    float shape = 0.86 - r + (n - 0.5) * 0.8;
    float a = smoothstep(0.0, 0.16, shape) * (1.0 - smoothstep(0.42, 0.8, vA)) * smoothstep(1.0, 0.8, max(abs(d.x), abs(d.y)) * 2.0);
    if (a < 0.01) discard;
    float heat = clamp(shape * 1.5 + (n2 - 0.5) * 0.9, 0.0, 1.0) * clamp(1.2 - vA * 1.7, 0.0, 1.0);
    vec3 col = vec3(0.018, 0.014, 0.012);
    col = mix(col, vec3(0.55, 0.045, 0.0), smoothstep(0.05, 0.3, heat));
    col = mix(col, vec3(3.2, 0.85, 0.08), smoothstep(0.28, 0.6, heat));
    col = mix(col, vec3(9.0, 6.0, 2.6), smoothstep(0.62, 0.95, heat));
    gl_FragColor = vec4(col, a);
  }`;
// lead lake-helifire, Nov 18 (Matt on the trailer: "shooting from the helicopter looks awful"; its frames from 10 m: "three or four hard-edged patches of plain
// yellow, orange and red", square-ish): the same solid flame, but its heat now falls away from the middle of each puff and is broken by the cloud picture read
// twice, the second time turned 37 degrees (two readings of one picture along the same axes showed its grid as squares), the colour runs through the heat
// without flat bands, the top of the range is a yellow that keeps its orange (9 / 6 / 2.6 burnt out to cream), and the edge is soft. ?helifx=0 = FRAG_FLAME.
const FRAG_FLAME2 = /* glsl */`
  varying float vA; varying vec2 vUv; varying float vSeed; varying float vAge;
  ${NOISE}
  void main() {
    float sd = fract(vSeed); vec2 d = vUv - 0.5; float r = length(d) * 2.0;
    vec2 u2 = vec2(d.x * 0.7986 - d.y * 0.6018, d.x * 0.6018 + d.y * 0.7986);
    float n = fbm(vUv * 2.8 + sd * 31.0 + vec2(0.0, -vAge * 0.9)), n2 = fbm(u2 * 6.3 + sd * 11.0 + vec2(vAge * 0.4, -vAge * 1.5)), n3 = fbm(u2.yx * 13.0 + sd * 5.0 + vec2(-vAge * 0.7, vAge * 0.3));
    float shape = 0.86 - r + (n - 0.5) * 0.8 + (n3 - 0.5) * 0.22;
    float a = smoothstep(0.0, 0.34, shape) * (1.0 - smoothstep(0.42, 0.8, vA)) * smoothstep(1.0, 0.8, max(abs(d.x), abs(d.y)) * 2.0);
    if (a < 0.01) discard;
    float heat = clamp((shape * 1.05 + (n2 - 0.5) * 1.1 + (n3 - 0.5) * 0.5) * (1.0 - 0.35 * r), 0.0, 1.0) * clamp(1.2 - vA * 1.7, 0.0, 1.0);
    vec3 col = vec3(0.018, 0.014, 0.012);
    col = mix(col, vec3(0.42, 0.03, 0.0), smoothstep(0.04, 0.34, heat));
    col = mix(col, vec3(2.3, 0.5, 0.04), smoothstep(0.22, 0.66, heat));
    col = mix(col, vec3(5.2, 2.5, 0.55), smoothstep(0.5, 0.92, heat));
    col = mix(col, vec3(7.5, 5.2, 2.2), smoothstep(0.86, 1.0, heat) * clamp(1.0 - vA * 3.0, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }`;
const FRAG_FIRE = /* glsl */`
  varying float vA; varying vec2 vUv; varying float vSeed; varying float vAge; uniform float uSq; uniform float uGain;
  ${NOISE}
  void main() {
    vec2 d = vUv - 0.5; float r = length(d) * 2.0; float n = fbm(vUv * 4.0 + fract(vSeed) * 30.0 + vec2(0.0, -vAge * 1.2));
    float core = smoothstep(1.0, 0.0, r + (n - 0.5) * 1.1) * mix(1.0, smoothstep(1.0, 0.7, max(abs(d.x), abs(d.y)) * 2.0), uSq); float k = 1.0 - vA;      // uSq 1 (the helicopter's new effects): the glow is out before the card's straight edge (at night the launch glow was a lit square)
    float a = uGain * core * k * k / (1.0 + floor(vSeed) * 3.0); if (a < 0.002) discard;      // uGain: 1 by day; with the new effects less at night, when the eye is open wide (the launch and the strike washed the picture white)      // the whole part of the seed dims it: the wide glow that stands in for light on the walls
    vec3 col = mix(mix(vec3(0.55, 0.05, 0.0), vec3(1.0, 0.3, 0.04), k), vec3(1.0, 0.86, 0.6), core * k * k) * (1.2 + 9.0 * k * k * k * core);
    gl_FragColor = vec4(col * a, 1.0);
  }`;

export class Puffs {
  constructor(scene, fx = false) {
    this.fx = !!fx; this.uSunW = { value: new THREE.Vector3(0.45, 0.75, 0.48).normalize() }; this.src = []; this.scene = scene; this.t = 0; this.heads = [0, 0, 0]; this.sets = []; const uN = { value: cloudTex() };
    for (let kind = 0; kind < 3; kind++) {
      const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1); g.index = q.index; g.setAttribute('position', q.getAttribute('position')); g.setAttribute('uv', q.getAttribute('uv'));
      const A = { pos: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3), vel: new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3), life: new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4), seed: new THREE.InstancedBufferAttribute(new Float32Array(N), 1) };
      for (let i = 0; i < N; i++) A.life.array[i * 4] = -1e6;
      for (const a of Object.values(A)) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aPos', A.pos); g.setAttribute('aVel', A.vel); g.setAttribute('aLife', A.life); g.setAttribute('aSeed', A.seed); g.instanceCount = N;
      const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: kind === 1 ? FRAG_FIRE : kind === 2 ? (fx ? FRAG_FLAME2 : FRAG_FLAME) : FRAG_SMOKE, uniforms: { uN, uEdge: { value: fx ? 0.4 : 0.2 }, uSq: { value: fx ? 1 : 0 }, uGain: { value: 1 }, uSunW: this.uSunW, uT: { value: 0 }, uRise: { value: kind === 1 ? 0.6 : kind === 2 ? 1.6 : 1.1 }, uSun: { value: new THREE.Vector3(1, 1, 1) } }, transparent: true, depthWrite: false,
        blending: kind === 1 ? THREE.CustomBlending : THREE.NormalBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = kind === 1 ? 9 : kind === 2 ? 8.5 : 8; mesh.name = kind === 1 ? 'heliFire' : kind === 2 ? 'heliFlame' : 'heliSmoke'; mesh.visible = false; scene.add(mesh);
      this.sets.push({ A, m, mesh, dirty: false, last: -1e6 });
    }
    this.fl = [];
  }
  // one puff: place, speed (m/s, slowed by drag), size at birth, life, growth (m/s), kind 0 smoke / 1 fire
  add(x, y, z, vx, vy, vz, size, life, grow, kind, shade = 0) {
    const S = this.sets[kind], i = this.heads[kind]; this.heads[kind] = (i + 1) % N; const A = S.A;
    A.pos.array[i * 3] = x; A.pos.array[i * 3 + 1] = y; A.pos.array[i * 3 + 2] = z; A.vel.array[i * 3] = vx; A.vel.array[i * 3 + 1] = vy; A.vel.array[i * 3 + 2] = vz;
    A.life.array[i * 4] = this.t; A.life.array[i * 4 + 1] = life; A.life.array[i * 4 + 2] = size; A.life.array[i * 4 + 3] = grow; A.seed.array[i] = Math.random() * 0.999 + Math.round(shade * 8);
    S.dirty = true; S.last = Math.max(S.last, this.t + life);
  }
  flare(x, y, z) { this.add(x, y, z, 0, 0, 0, 1.5, 0.05, 0, 1); }      // the motor's glow, a frame long
  // a column: smoke fed from a spot on the ground for `secs`, so it stands on the street and climbs (not one cloud let go at once)
  column(x, y, z, secs) { this.src.push({ x, y, z, until: this.t + secs, next: this.t, k: 0 }); if (this.src.length > 6) this.src.shift(); }
  // a scorch mark: a flat dark disc on the surface (a pool of 24, the oldest taken again)
  scorch(x, y, z, nx = 0, ny = 1, nz = 0, size = 0) {      /* lead lake-helifire: with a normal the mark lies on a wall (nx, ny, nz: away from the surface) */
    if (!this.sc) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'), gr = c.createRadialGradient(64, 64, 3, 64, 64, 64); gr.addColorStop(0, 'rgba(6,5,5,0.94)'); gr.addColorStop(0.4, 'rgba(9,8,7,0.8)'); gr.addColorStop(0.75, 'rgba(14,12,10,0.34)'); gr.addColorStop(1, 'rgba(14,12,10,0)'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283 + Math.random() * 0.3, r0 = 40 + Math.random() * 14; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(64 + Math.cos(a - 0.05) * r0, 64 + Math.sin(a - 0.05) * r0); c.lineTo(64 + Math.cos(a) * 66, 64 + Math.sin(a) * 66); c.lineTo(64 + Math.cos(a + 0.09) * r0, 64 + Math.sin(a + 0.09) * r0); c.fill(); }
      const t = new THREE.CanvasTexture(cv), geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      this.sc = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), 24); this.sc.count = 0; this.sc.frustumCulled = false; this.sc.renderOrder = 2; this.sc.name = 'heliScorch'; this.scN = 0; this.scene.add(this.sc); }
    if (this.fx && this.sc.material.color.r !== (this.scK ?? 1)) this.sc.material.color.setScalar(this.scK ?? 1);
    if (this.fx && ny < 0.5) {      /* helifire-2: a mark on a WALL. The first patch laid it on the wall the height picture knows, which can lie inside the facade that is drawn, and its test case never struck a wall at all (the rockets fell on a roof in front of it): no mark was ever seen. It has its own batch now (twelve, the oldest taken again) whose depth is worked out as if it stood 4 m nearer the eye (its place on the screen is unchanged), so it shows on whatever the facade's drawn face is; 5 m across with a second, smaller one over its middle for a black heart. */
      if (!this.scW) { const m = this.sc.material.clone(); m.polygonOffset = false; m.side = THREE.DoubleSide; m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  { vec4 mvb = mvPosition; mvb.xyz *= max(0.2, 1.0 - 4.0 / max(length(mvb.xyz), 0.001)); vec4 pb = projectionMatrix * mvb; gl_Position.z = pb.z / pb.w * gl_Position.w; }'); };
        this.scW = new THREE.InstancedMesh(this.sc.geometry, m, 12); this.scW.count = 0; this.scW.frustumCulled = false; this.scW.renderOrder = 2; this.scW.name = 'heliScorchWall'; this.scWN = 0; this.scene.add(this.scW); }
      this.scW.material.color.setScalar(0.2 * (this.scK ?? 1));      /* a fifth of the picture's own grey: on a wall in shade its rim stood PALER than the brick (hold 23) */
      for (const sw of [size || 5, (size || 5) * 0.45]) { const j = this.scWN++ % 12; _sq.setFromUnitVectors(_sv.set(0, 1, 0), _sn.set(nx, ny, nz).normalize()).multiply(_sq2.setFromAxisAngle(_sv, Math.random() * 6.283)); this.scW.setMatrixAt(j, _sm.compose(_sv.set(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05), _sq, _ss.set(sw, 1, sw))); }
      this.scW.count = Math.min(12, this.scWN); this.scW.instanceMatrix.needsUpdate = true; return; }
    const i = this.scN++ % 24, sz = size || 9 + Math.random() * 4; _sq.setFromUnitVectors(_sv.set(0, 1, 0), _sn.set(nx, ny, nz).normalize()).multiply(_sq2.setFromAxisAngle(_sv, Math.random() * 6.283)); this.sc.setMatrixAt(i, _sm.compose(_sv.set(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05), _sq, _ss.set(sz, 1, sz))); this.sc.count = Math.min(24, this.scN); this.sc.instanceMatrix.needsUpdate = true;
  }
  step(dt) { this.t += dt; { const L = boomAt.lit; if (L) { L.t += dt; const k = Math.max(0, 1 - L.t / 0.55); L.fx.lightI = L.I * k * k; if (k <= 0) boomAt.lit = null; } }     /* the strike's light dies away over half a second (the game's own rule holds it level, then cuts it) */
    for (let i = this.src.length - 1; i >= 0; i--) { const q = this.src[i]; if (this.t > q.until) { this.src.splice(i, 1); continue; }
      while (q.next <= this.t) { q.next += 0.11; const R = () => Math.random() - 0.5, w = 1 - (q.until - this.t) / 3.2; this.add(q.x + R() * 2.2, q.y + 0.8 + Math.random(), q.z + R() * 2.2, R() * 2.5, 7 + Math.random() * 4, R() * 2.5, 2.4 + Math.random() * 1.2, 5.5 + Math.random() * 2.5, 2.8, 0, Math.max(0, w) * 0.25); } } }
  sync(cam, dt) {
    for (const S of this.sets) {
      S.mesh.visible = this.t < S.last + 0.1; if (!S.mesh.visible) continue; S.m.uniforms.uT.value = this.t;
      if (S.dirty) { S.A.pos.needsUpdate = S.A.vel.needsUpdate = S.A.life.needsUpdate = S.A.seed.needsUpdate = true; S.dirty = false; }
    }
  }
  sun(r, g, b) { this.sets[0].m.uniforms.uSun.value.set(r, g, b); }
  // how much daylight there is (1 noon, 0.07 deep night): the smoke takes the sky's light, so at night it is dark, and the strike's own light is eased (a dark street needs less)
  setDay(d) { this.day = d; this.sets[0].m.uniforms.uSun.value.set(d, d, d * (1 + 0.25 * (1 - d))); if (this.fx) { this.sets[1].m.uniforms.uGain.value = 0.65 + 0.35 * d; this.scK = 0.12 + 0.88 * d; if (this.scW) this.scW.material.color.setScalar(0.2 * this.scK); if (this.sc) this.sc.material.color.setScalar(this.scK); } }      /* helifire-2: the scorch marks are unlit; at night they stood paler than the dark wall round them (fifth blind critic: 'a lit fog patch, not a burn'), so they take the day's measure */
  sunDir(v) { if (v && v.isVector3) this.uSunW.value.copy(v).normalize(); }
}

// ---------------------------------------------------------------- sound: made here, from noise (no file)
let AC = null, noiseBuf = null;
function audio(g) {
  if (AC) return AC; const s = g.sound; AC = (s && (s.ctx || s.ac || s.audio || (s.core && s.core.ctx))) || null;
  if (!AC || !AC.createBufferSource) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return AC;
}
function noise(g, { f0, f1, dur, gain, q = 0.7, type = 'lowpass', delay = 0 }) {
  const ac = audio(g); if (!ac || ac.state !== 'running') return; const t = ac.currentTime + delay;
  const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const gn = ac.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl); fl.connect(gn); gn.connect(ac.destination); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function thump(g, gain, delay) {
  const ac = audio(g); if (!ac || ac.state !== 'running') return; const t = ac.currentTime + delay, o = ac.createOscillator(), gn = ac.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + 1);
}

const _v = new THREE.Vector3(), _sv = new THREE.Vector3(), _sn = new THREE.Vector3(), _ss = new THREE.Vector3(), _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _sm = new THREE.Matrix4();
// lead lake-helifire: a strike on a wall. The burst is thrown out from the wall: every puff's place and speed is folded to the wall's outer side (the trailer's
// frames: half the fireball was inside the building, behind its balconies). WN is set by boomAt for one call.
const WN = { on: false, x: 0, z: 0, nx: 0, nz: 0 };
function padd(puffs, px, py, pz, vx, vy, vz, size, life, grow, kind, shade) {
  if (WN.on) { let d = (px - WN.x) * WN.nx + (pz - WN.z) * WN.nz; if (d < 0) { px -= 2 * d * WN.nx; pz -= 2 * d * WN.nz; } d = vx * WN.nx + vz * WN.nz; if (d < 0) { vx -= 2 * d * WN.nx; vz -= 2 * d * WN.nz; } vx += WN.nx * 3; vz += WN.nz * 3; }
  puffs.add(px, py, pz, vx, vy, vz, size, life, grow, kind, shade);
}
export function boomAt(g, heli, puffs, x, y, z, o = {}) {
  const DBG = g.P && g.P.get('hrkdbg') || '';      // measuring only: nopuff | nogame | noharm
  boomAt.day = puffs.day ?? 1; boomAt.fx = !!puffs.fx; const cam = g.world.camera, dist = cam.position.distanceTo(_v.set(x, y, z)), R = () => Math.random() - 0.5;
  // ---- seen: a flash, a ball of fire that rolls up into smoke, a low ring of dust, sparks thrown out
  // lead lake-helifire (puffs.fx; ?helifx=0 = as before): seen from close the wide glow quads covered half the screen in plain cream (the trailer, 10 m from the
  // strike): within 70 m they shrink with the distance (the strike's real light, set in harm(), stays); a strike on a wall is thrown out from the wall and marks it
  const nearK = puffs.fx ? Math.max(0.22, Math.min(1, dist / 70)) : 1; WN.on = !!(puffs.fx && o.wall); if (WN.on) { WN.x = x; WN.z = z; WN.nx = o.wall.nx; WN.nz = o.wall.nz; }
  if (DBG !== 'nopuff') {
  // (critic, Nov 17: "a few metres across ... no light on the surroundings ... pale, flat smoke ... no aftermath". So: a strike the width of the street.)
  // the flash and its glow on everything near (two frames of white, then a wide soft orange that stands in for light on the walls and the road)
  padd(puffs, x, y + 1.5, z, 0, 0, 0, 16 * nearK, 0.09, 60 * nearK, 1); padd(puffs, x, y + 2, z, 0, 0, 0, 34 * nearK, 0.32, 20 * nearK, 1, 0.5); padd(puffs, x, y + 0.6, z, 0, 0, 0, 22 * nearK, 0.6, 6 * nearK, 1, 1);
  // the ball: flame with a body, seated on the ground, rolling up and out and going to soot as it cools (and a little light added over its heart)
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.283, e = 0.15 + Math.random() * 1.25, sp = 5 + Math.random() * 11; padd(puffs, x + R() * 2.5, y + 0.8 + Math.random() * 1.5, z + R() * 2.5, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 4, Math.sin(a) * Math.cos(e) * sp, 3.8 + Math.random() * 2.6, 1.1 + Math.random() * 0.7, 5.2, 2);
    if (i % 2 === 0) padd(puffs, x + R() * 2.5, y + 1.5 + Math.random() * 2, z + R() * 2.5, Math.cos(a) * Math.cos(e) * sp * 0.8, Math.sin(e) * sp + 5, Math.sin(a) * Math.cos(e) * sp * 0.8, 3.4 + Math.random() * 2, 4 + Math.random() * 2.5, 3.6, 0, 0);     /* lit smoke rolling out with it */ }
  for (let i = 0; i < 4; i++) padd(puffs, x + R() * 2, y + 1.5 + Math.random() * 1.5, z + R() * 2, R() * 6, 5 + Math.random() * 4, R() * 6, 4.5, 0.35 + Math.random() * 0.2, 6, 1, 0.25);
  // the black smoke it turns into, rising in a column past the fourth floor and hanging there
  for (let i = 0; i < 9; i++) { const a = Math.random() * 6.283, e = 0.5 + Math.random() * 0.9, sp = 3 + Math.random() * 6; padd(puffs, x + R() * 3, y + 1.2 + Math.random() * 2.5, z + R() * 3, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 5 + i * 0.5, Math.sin(a) * Math.cos(e) * sp, 3.6 + Math.random() * 2.6, 4.5 + Math.random() * 3.0, 3.6, 0, 0); }
  puffs.column(x, y, z, 3.2); if (o.ground) puffs.scorch(x, y, z); else if (WN.on) puffs.scorch(o.wall.px, y, o.wall.pz, o.wall.nx, 0, o.wall.nz, 4.5 + Math.random() * 1.5);
  // the skirt: pale dust thrown out along the ground
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283 + Math.random() * 0.4, sp = 16 + Math.random() * 9; padd(puffs, x, y + 0.7, z, Math.cos(a) * sp, 0.5, Math.sin(a) * sp, 2.2, 1.6 + Math.random() * 0.9, 4.2, 0, 0.8); }
  // sparks and burning bits thrown high
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.283, e = 0.25 + Math.random() * 1.2, sp = 26 + Math.random() * 34; padd(puffs, x, y + 0.6, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.3, 0.6 + Math.random() * 0.7, 0, 1); }
  // what is left: the game's own fire and smoke burning on the spot for a while
  { const fx = g.combat && g.combat.fx, now = puffs.t, L = boomAt.left || (boomAt.left = []); while (L.length && L[0] < now) L.shift();      /* at most three such fires burning at once: under sustained fire they were the new cost (31.8 fps against 35 before them, laptop 2) */
    if (fx && fx.emitter && y < 6 && L.length < 3) { L.push(now + 8); try { const P3 = new THREE.Vector3(x, y + 0.2, z); fx.emitter({ pos: P3, kind: 'fire', life: 7 + Math.random() * 4 }); fx.emitter({ pos: P3.clone().setY(y + 0.8), kind: 'smoke', life: 12 + Math.random() * 5 }); } catch (e) {} } }
  }
  WN.on = false;
  // ---- heard: the crack and the rumble, later and duller with distance (340 m/s)
  const dl = Math.min(2.5, dist / 340), near = Math.max(0.06, Math.min(1, 40 / Math.max(dist, 20)));
  if (g.combat && g.combat.snd && g.combat.audio) g.combat.snd('explosion', { dist }); else { noise(g, { f0: 5200 * near + 500, f1: 180, dur: 0.35, gain: 0.9 * near, delay: dl }); noise(g, { f0: 520, f1: 45, dur: 2.2, gain: 0.8 * Math.sqrt(near), delay: dl }); }
  thump(g, 0.6 * Math.sqrt(near), dl);
  // ---- felt: the camera, and the aircraft if it is close
  const f = heli.f, dh = f.pos.distanceTo(_v);
  if (heli.hasCamera) heli.cam.shake = Math.min(1, heli.cam.shake + Math.min(0.8, 14 / Math.max(dist, 6)));
  if (dh < 16 && !f.onGround) { const k = 1 - dh / 16; f.vel.addScaledVector(_v.subVectors(f.pos, _v.set(x, y, z)).normalize(), 7 * k); f.damage = Math.min(1, f.damage + 0.3 * k * k); }
  // ---- done to the street (only near street level: a burst on a roof or in the air harms nothing below)
  o.dbg = DBG; try { harm(g, x, -z, y, o); } catch (e) { if (!boomAt.err) { boomAt.err = 1; console.log('[hrk] harm threw: ' + (e && (e.stack || e.message))); } }
}
boomAt.whoosh = (g) => { noise(g, { f0: 900, f1: 3800, dur: 0.5, gain: 0.32, type: 'bandpass', q: 0.9 }); noise(g, { f0: 300, f1: 90, dur: 0.6, gain: 0.3 }); };

// The harm, by the game's own combat code (combat.js explode() is the model: it needs a car, so its rules are said again here for a point).
// x, y map metres; z metres above the street. Only a burst near street level harms what is in the street.
const _p = new THREE.Vector3();
function harm(g, x, y, z, o) {
  const C = g.combat, PR = g.__props;
  if (o.dbg !== 'nogame' && C && C.fx && C.fx.explosion) { try { C.fx.explosion(_p.set(x, z + 0.4, -y)); const fx = C.fx; if (fx.light && fx.lightT !== undefined && o.dbg !== 'nolight') { fx.light.position.set(x, z + 5, -y); const I0 = 1200 * (boomAt.fx ? 0.4 + 0.6 * (boomAt.day ?? 1) : 0.1 + 0.9 * (boomAt.day ?? 1));      /* lead lake-helifire: at night the strike's light on the walls was a tenth of the day's and the wide glow did the lighting; with the glow held back near the camera the light itself is 0.4 (two blind critics gave the night wall strike to the old build for its light) */ fx.light.distance = 65; fx.lightI = I0; fx.lightT = 0.55; boomAt.lit = { fx, t: 0, I: I0 }; } } catch (e) {} }      // the game's own flash, light, debris and scorch ring, under our fire and smoke
  if (z > 4.5 || o.dbg === 'noharm') return;
  if (o.dbg !== 'noprop' && PR && PR.blast) { try { PR.blast(_p.set(x, 0.5, -y), 2, 11); } catch (e) {} }
  if (!C) return;
  const NOW = 5.5, FAR = 12, CARS = 2, PEOPLE = 6;      // a car this near goes up at once (the CARS nearest, the one hit first; the others near are damaged like the far ones); out to FAR it is damaged (and may burn, and blow later); the PEOPLE nearest are thrown, the others run
  let blown = 0;
  const car = (v, kind) => { if (!v) return; const d = Math.hypot(v.x - x, v.y - y); if (d > FAR && v !== o.car) return; const S = C.carState(v, kind); if (!S || S.wrecked || S.dead) return;
    if ((d < NOW && blown < CARS) || v === o.car) { blown++; if (g.player.vehicle === v) { S.hp = 0; C.carHurt(v, S, null); } else C.explode(v, S); } else { S.hp -= 800 * (1 - Math.min(d, FAR) / (FAR + 2)); C.carHurt(v, S, null); } };
  if (o.dbg !== 'nocar') {
  if (o.car) car(o.car, g.traffic && g.traffic.cars && g.traffic.cars.includes(o.car) ? 'traffic' : (g.vehicles || []).includes(o.car) ? 'veh' : 'parked');
  const byD = (l) => l.filter((v) => v && v !== o.car).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  for (const v of byD((g.traffic && g.traffic.cars || []).filter((v) => Math.abs(v.x - x) < FAR && Math.abs(v.y - y) < FAR))) car(v, 'traffic');
  for (const v of byD((g.vehicles || []).slice())) car(v, 'veh');
  if (g.parked && g.parked.near) for (const v of byD(g.parked.near(x, y, FAR, []).slice())) car(v, 'parked');
  }
  if (o.dbg === 'noped') return;
  const near = []; if (g.peds && g.peds.list) for (const p of g.peds.list) if (p.state !== 'down') { const d = Math.hypot(p.x - x, p.y - y); if (d < 9) near.push({ p, kind: 'ped', d }); }
  const ag = g.crowd && g.crowd.sim && g.crowd.sim.agents; if (ag) for (const a of ag) if (!a.gone && !a.down) { const d = Math.hypot(a.x - x, a.y - y); if (d < 9) near.push({ p: a, kind: 'crowd', d }); }
  near.sort((a, b) => a.d - b.d); for (const q of near.slice(0, PEOPLE)) { const p = q.p, d = q.d; C.kill(p, q.kind, { x: p.x, y: p.y, z: 1, dx: (p.x - x) / (d || 1), dy: (p.y - y) / (d || 1), dz: 0.7, part: 'body', ...(g.P && g.P.get('blastfall') === '0' ? {} : { cx: x, cy: y }) }, 6); }      /* ragdoll lane, Nov 17 (handoff 322, second cut): the body is told where the blast was (cx, cy), so it tumbles and falls off with distance as it does beside a blown-up car; merge lane: not with ?blastfall=0 */
  const H = C.heat; if (H && H.cops && H.hitCop) for (const k of H.cops.slice()) { const d = Math.hypot(k.x - x, k.y - y); if (d < 8 && k.hp > 0) { try { H.hitCop({ kind: 'cop', obj: k, x: k.x, y: k.y, z: 1, nx: 0, ny: 0, nz: 1, dx: (k.x - x) / (d || 1), dy: (k.y - y) / (d || 1), dz: 0.5, part: 'body', t: d }, { dmg: 400, force: 6, name: 'ROCKET' }, true); } catch (e) {} } }
  if (C.scare) C.scare(x, y, 70, 2);
  if (H && H.crime) { try { H.crime('blast', x, y); } catch (e) {} }
  const pl = g.player, dp = Math.hypot(pl.x - x, pl.y - y); if (dp < 8 && !pl.vehicle && !(pl.alt > 3) && !(g.heli && g.heli.piloted)) C.hurt(90 * (1 - dp / 10));
}
