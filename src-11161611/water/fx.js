// water/fx.js (water lane, Nov 15): what a moving boat does to the water that the wave function does not: the white churned track behind it
// (a ribbon laid on the surface, fading with age), spray thrown from the bow and the stern, the splash of a landing. And its sound.
import * as THREE from 'three';

const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
// ---- the track: the last N places of the stern, each with a width; a strip five columns wide that rides the waves, humped where the propellers
// throw the water up right behind the boat, joined to the stern itself (wakefx round, Nov 15: structure along its length, no uniform stripe)
export class Trail {
  constructor(scene, world, n = 110) {
    this.n = n; this.pts = []; this.head = 0; this.last = null; this.cur = null; this.world = world; this.life = 7.5; const C = (this.C = 5), R = n + 1;
    const g = new THREE.BufferGeometry(); this.pos = new Float32Array(R * C * 3); this.dat = new Float32Array(R * C * 4);      // dat: side (-1..1), age 0..1, strength, metres along the track
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aDat', new THREE.BufferAttribute(this.dat, 4).setUsage(THREE.DynamicDrawUsage));
    const I = []; for (let i = 0; i + 1 < R; i++) for (let c = 0; c + 1 < C; c++) { const a = i * C + c, d = a + C; I.push(a, a + 1, d, a + 1, d + 1, d); } g.setIndex(I); g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.U = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uT: { value: 0 }, uLife: { value: this.life }, uSunColor: world.shared.uSunColor, uSunDir: world.shared.uSunDir, uAmb: { value: new THREE.Color(0.6, 0.66, 0.78) } });
    const m = new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      vertexShader: `#include <common>\n#include <fog_pars_vertex>\n attribute vec4 aDat; varying vec4 vDat; varying vec2 vW; void main(){ vDat = aDat; vW = position.xz; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n }`,
      fragmentShader: `#include <common>\n#include <fog_pars_fragment>\n uniform float uT; uniform float uLife; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform vec3 uAmb; varying vec4 vDat; varying vec2 vW;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main(){ float age = vDat.y; float side = abs(vDat.x); float ageS = age * uLife; float young = exp(-ageS * 1.3);
          float n = ns(vW * 2.3 + uT * 0.15) * 0.55 + ns(vW * 7.0 - uT * 0.2) * 0.3 + ns(vW * 0.7) * 0.35;
          float n4 = ns(vW * vec2(5.3, 4.7) + uT * 0.4);
          // streaks along the track: what the propellers and the hull's edges drew out; they widen with the track and blur as it ages
          float wm = 1.0 + ageS * 0.8; float al = mod(vDat.w, 2048.0);
          float st = ns(vec2(vDat.x * 2.4 * wm, al * 0.085)) * 0.6 + ns(vec2(vDat.x * 6.5 * wm + 9.0, al * 0.29)) * 0.4;
          float body = n * 0.62 + n4 * 0.30 + (st - 0.5) * (0.22 + 0.55 * young);
          // fresh: solid white water with a sharp ragged edge; older: it breaks into streaks and patches from the edges in, then is gone
          float edge = 1.0 - smoothstep(0.62 - age * 0.35, 1.0, side + (n - 0.6) * 0.42 + (st - 0.5) * 0.30);
          float th = 0.12 + age * 0.84 + side * side * 0.20 - young * 0.26; float soft = 0.08 + 0.30 * (1.0 - young);
          float a = edge * vDat.z * (0.10 + 0.90 * pow(1.0 - age, 1.5)) * smoothstep(th, th + soft, body) * (1.0 - smoothstep(0.8, 1.0, age));
          float core = smoothstep(th + 0.12, th + 0.46, body) * (1.0 - 0.55 * smoothstep(0.35, 1.0, side));      // white where it is thick and in the middle, aerated green water round it
          vec3 c = mix(vec3(0.33, 0.50, 0.45), vec3(0.86, 0.90, 0.90), core) * (uAmb * 0.85 + uSunColor * max(uSunDir.y, 0.0) * 2.2) * (0.70 + 0.42 * n4 * n + 0.14 * young);
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0) * 0.88);\n#include <fog_fragment>\n }` });
    this.mesh = new THREE.Mesh(g, m); this.mesh.name = 'river_trail'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 41; this.mesh.matrixAutoUpdate = false; scene.add(this.mesh);
  }
  // one call a step for the boat that owns it: stern place (map), the way it heads, speed, half width, how hard it churns (0..1)
  feed(x, y, h, speed, half, k, t) {
    const L = this.last, C = this.cur || (this.cur = { x: 0, y: 0, nx: 0, ny: 1, w: 1, k: 0, t: 0, sp: 0, s: 0 }), d = L ? Math.hypot(x - L.x, y - L.y) : 0;
    C.x = x; C.y = y; C.nx = -Math.sin(h); C.ny = Math.cos(h); C.w = half; C.k = k; C.t = t; C.sp = speed; C.s = L ? L.s + d : 0;
    if (L && d < Math.max(0.6, Math.abs(speed) * 0.07)) { L.k = Math.max(L.k, k); return; }      // a point every 0.6 m, further apart at speed: the track then lasts its seven seconds
    if (k < 0.02 && (!L || L.k < 0.02)) return;
    const p = { x, y, nx: C.nx, ny: C.ny, w: half, k, t, sp: speed, s: C.s }; this.pts.push(p); if (this.pts.length > this.n) this.pts.shift(); this.last = p;
  }
  update(t, surf, amb) {
    const P = this.pts, pos = this.pos, dat = this.dat, life = this.life, C = this.C, cur = this.cur; while (P.length && t - P[0].t > life) P.shift();
    const n = P.length, head = n && cur && t - cur.t < 0.3 && cur.k > 0.02 ? 1 : 0, rings = n + head;      // the last ring is the stern itself, now
    for (let i = 0; i < rings; i++) { const p = i < n ? P[i] : cur, ageS = Math.max(0, t - p.t), age = Math.min(1, ageS / life), w = p.w * (0.5 + 1.3 * (1 - Math.exp(-ageS * 2.2))) + ageS * 0.42, k = p.k * Math.min(1, i / 3);
      // the mound the propellers throw up: low at the transom, highest a boat length astern, gone in two seconds
      const xh = ageS * 5, hh = Math.min(0.55, 0.38 * Math.sqrt(p.w)) * p.k * (0.3 + 0.9 * xh * Math.exp(1 - xh)) * Math.exp(-ageS * 1.1);
      const xl = p.x - p.nx * w, yl = p.y - p.ny * w, xr = p.x + p.nx * w, yr = p.y + p.ny * w, hl = surf(xl, yl) + 0.035, hr = surf(xr, yr) + 0.035;
      for (let c = 0; c < C; c++) { const f = c / (C - 1), sd = f * 2 - 1, e = 1 - sd * sd, o3 = (i * C + c) * 3, o4 = (i * C + c) * 4;
        pos[o3] = xl + (xr - xl) * f; pos[o3 + 1] = hl + (hr - hl) * f + hh * e * e; pos[o3 + 2] = -(yl + (yr - yl) * f); dat[o4] = sd; dat[o4 + 1] = age; dat[o4 + 2] = k; dat[o4 + 3] = p.s; } }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.aDat.needsUpdate = true; g.setDrawRange(0, Math.max(0, (rings - 1) * (C - 1) * 6)); this.U.uT.value = t; if (amb) this.U.uAmb.value.copy(amb);
  }
}
// ---- spray: a pool of soft white points thrown on arcs
export class Spray {
  constructor(scene, world, max = 1400) {
    this.max = max; this.n = 0; this.next = 0; this.P = new Float32Array(max * 3); this.V = new Float32Array(max * 3); this.D = new Float32Array(max * 3); this.K = new Float32Array(max);      // D: age, life, size; K: how solid (mist 0.35, a drop 1.6)
    for (let i = 0; i < max; i++) { this.D[i * 3] = 1; this.D[i * 3 + 1] = 1; this.P[i * 3 + 1] = -999; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aD', new THREE.BufferAttribute(this.D, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aK', new THREE.BufferAttribute(this.K, 1).setUsage(THREE.DynamicDrawUsage)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.U = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uSunColor: world.shared.uSunColor, uSunDir: world.shared.uSunDir, uAmb: { value: new THREE.Color(0.6, 0.66, 0.78) }, uPx: { value: 900 } });
    const m = new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthWrite: false, fog: true,
      vertexShader: `#include <common>\n#include <fog_pars_vertex>\n attribute vec3 aD; attribute float aK; uniform float uPx; varying float vA; void main(){ float k = clamp(aD.x / aD.y, 0.0, 1.0); vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, k) * aK; vec4 mvPosition = viewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = clamp(aD.z * (1.0 + (aK < 1.0 ? 2.6 : 0.3) * k) * uPx / max(0.5, -mvPosition.z), 1.5, 220.0);\n#include <fog_vertex>\n }`,
      fragmentShader: `#include <common>\n#include <fog_pars_fragment>\n uniform vec3 uSunColor, uSunDir, uAmb; varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0; if (r > 1.0) discard; float a = min(1.0, (1.0 - r) * (1.0 - r) * vA * 0.34); vec3 c = vec3(0.86, 0.89, 0.9) * (uAmb * 0.9 + uSunColor * max(uSunDir.y, 0.0) * 2.0); gl_FragColor = vec4(c, a);\n#include <fog_fragment>\n }` });
    this.mesh = new THREE.Points(g, m); this.mesh.name = 'river_spray'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 42; this.mesh.matrixAutoUpdate = false; scene.add(this.mesh); this.live = 0;
  }
  // world place (three.js frame) and speed, life in seconds, size in metres
  emit(x, y, z, vx, vy, vz, life, size, solid = 1) { const i = this.next; this.K[i] = solid; this.next = (i + 1) % this.max; this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z; this.V[i * 3] = vx; this.V[i * 3 + 1] = vy; this.V[i * 3 + 2] = vz; this.D[i * 3] = 0; this.D[i * 3 + 1] = life; this.D[i * 3 + 2] = size; this.live = Math.max(this.live, life); }
  update(dt, amb, cam, vh) {
    if (this.live <= 0) { if (this.mesh.visible) this.mesh.visible = false; return; } this.mesh.visible = true; this.live -= dt;
    const P = this.P, V = this.V, D = this.D, drag = Math.exp(-dt * 1.3);
    for (let i = 0; i < this.max; i++) { const a = D[i * 3]; if (a >= D[i * 3 + 1]) continue; D[i * 3] = a + dt; V[i * 3 + 1] -= 9.81 * dt; V[i * 3] *= drag; V[i * 3 + 2] *= drag; P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt; if (D[i * 3] >= D[i * 3 + 1]) P[i * 3 + 1] = -999; }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.aD.needsUpdate = true; g.attributes.aK.needsUpdate = true; if (amb) this.U.uAmb.value.copy(amb);
    if (cam && vh) this.U.uPx.value = vh / (2 * Math.tan(cam.fov * Math.PI / 360));
  }
}
// ---- the sound of an outboard boat: a rough engine note that climbs with the throttle, the hiss of the hull through water, a thump on landing
export class BoatSound {
  constructor(sound) { this.s = sound; this.ok = false; this.k = 0; }
  start() {
    const S = this.s; if (this.ok || !S || !S.on || !S.ac || !S.out) return this.ok; const a = S.ac;
    const out = (this.g = a.createGain()); out.gain.value = 0; out.connect(S.out);
    const lp = (this.lp = a.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1.4; lp.connect(out);
    this.o = [['sawtooth', 1, 0.5], ['square', 0.5, 0.32], ['sawtooth', 1.505, 0.2], ['triangle', 2.01, 0.18]].map(([type, mul, vol]) => { const o = a.createOscillator(), g = a.createGain(); o.type = type; g.gain.value = vol; o.connect(g); g.connect(lp); o.start(); return { o, mul }; });
    // the uneven beat of an engine at idle: the level wobbles at the firing rate
    const lfo = (this.lfo = a.createOscillator()), lg = (this.lg = a.createGain()); lfo.type = 'sine'; lfo.frequency.value = 11; lg.gain.value = 0.25; lfo.connect(lg); lg.connect(out.gain); lfo.start();
    const ws = a.createBufferSource(); ws.buffer = S.white; ws.loop = true; const bp = (this.bp = a.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6; const wg = (this.wg = a.createGain()); wg.gain.value = 0; ws.connect(bp); bp.connect(wg); wg.connect(S.out); ws.start();
    this.ok = true; return true;
  }
  // on = someone is at the helm; thr -1..1; speed m/s; wet 0..1 (the note races when the propeller leaves the water)
  update(dt, on, thr, speed, wet, top) {
    if (!this.start()) return; const a = this.s.ac, t = a.currentTime, load = Math.abs(thr), q = Math.min(1, Math.abs(speed) / top);
    this.k += ((on ? 1 : 0) - this.k) * Math.min(1, dt * 3);
    const rpm = 0.16 + 0.5 * load + 0.34 * q + (wet < 0.3 && load > 0.2 ? 0.25 : 0), f = 38 + rpm * 150;
    for (const x of this.o) x.o.frequency.setTargetAtTime(f * x.mul, t, 0.07);
    this.lp.frequency.setTargetAtTime(320 + rpm * 2300, t, 0.08); this.lfo.frequency.setTargetAtTime(9 + rpm * 30, t, 0.1); this.lg.gain.setTargetAtTime(0.10 * this.k * (1 - rpm * 0.7), t, 0.1);
    this.g.gain.setTargetAtTime(this.k * (0.10 + 0.16 * load + 0.06 * q), t, 0.08);
    this.wg.gain.setTargetAtTime(this.k * 0.22 * q * q * wet + 0.012 * this.k, t, 0.12); this.bp.frequency.setTargetAtTime(700 + q * 1500, t, 0.1);
  }
  slam(k) { const S = this.s; if (!S || !S.on) return; try { S.burst(0.5 + k * 0.4, 0.25 + 0.4 * k, 700 + 900 * k); S.shot(70, 0.25, 'sine', 0.25 * k, -35); } catch (e) {} }
  bump(k) { const S = this.s; if (!S || !S.on) return; try { S.shot(95, 0.18, 'triangle', 0.3 * k, -50); S.burst(0.15, 0.2 * k, 400); } catch (e) {} }
}
export { hash };
