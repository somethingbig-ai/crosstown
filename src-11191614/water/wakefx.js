// water/wakefx.js (water lane, Nov 15): the water a moving hull throws. Two draw calls for every boat together:
//   1. the SKIRT: a strip of raised white water round each of the four nearest moving hulls: the bow wave / spray sheet where the stem and the
//      chines meet the surface (rising, leaning out and aft, torn at its edge), the foam at the waterline, the wash over the stern.
//   2. the THROWN water: one pool of instanced, camera-facing quads of three kinds: torn sheet pieces (a noise picture eaten away as they age),
//      droplets drawn as streaks along their own motion, and soft mist. Bow sheets, the propellers' mound, the burst of a landing.
// The churned track behind the boat is fx.js Trail (five columns, a hump behind the propellers, streaks along its length).
//   const fx = new HullFx(scene, world);  each frame after the boats are placed:  fx.update(boats, dt, t, surf, camera)
//   boats: the layer's boat objects (x, y, h, z, vf, vl, vx, vy, wet, sternWet, thr, spec, tune; b.fxSlam = strength of a landing, read and cleared here)
//   surf(x, y): the water's height at a map point (world y). Map frame x east, y north; three.js x, -z.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (u, a, b) => { u = clamp((u - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const rnd = Math.random;

// a picture of cloudy noise that tiles (red and green: two different fields), made here
function noiseTex() {
  const N = 128, d = new Uint8Array(N * N * 4), f = new Float32Array(N * N);
  for (let ch = 0; ch < 2; ch++) {
    f.fill(0); let amp = 0.5, tot = 0;
    for (let per = 4; per <= 32; per *= 2) {
      const L = new Float32Array(per * per); for (let i = 0; i < L.length; i++) L[i] = hash(i * 1.317 + per * 13.1 + ch * 71.3);
      for (let y = 0; y < N; y++) { const fy = y * per / N, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = (y0 % per) * per, yb = ((y0 + 1) % per) * per;
        for (let x = 0; x < N; x++) { const fx = x * per / N, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % per, xb = (x0 + 1) % per;
          const a = L[ya + xa] + (L[ya + xb] - L[ya + xa]) * sx, b = L[yb + xa] + (L[yb + xb] - L[yb + xa]) * sx; f[y * N + x] += (a + (b - a) * sy) * amp; } }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < N * N; i++) d[i * 4 + ch] = Math.round(clamp((f[i] / tot - 0.5) * 2.3 + 0.5, 0, 1) * 255);
  }
  for (let i = 0; i < N * N; i++) { d[i * 4 + 2] = 255 - d[i * 4]; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

const LIGHT = `vec3 lit = uAmb * 0.88 + uSunColor * max(uSunDir.y, 0.0) * 2.2;`;
const M = 44, ROWS = 4, SLOTS = 4, HBN = 33;      // points round a hull, rows across the skirt, hulls drawn, half-beam table

export class HullFx {
  constructor(scene, world, max = 3200) {
    this.scene = scene; this.world = world; this.max = max; this.next = 0; this.live = 0; this.on = true; this.amb = new THREE.Color(0.6, 0.66, 0.78);
    const tex = (this.tex = noiseTex()), sh = world.shared || {};
    const lightU = () => ({ uSunColor: sh.uSunColor || { value: new THREE.Color(1, 1, 1) }, uSunDir: sh.uSunDir || { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uAmb: { value: this.amb }, tN: { value: tex } });
    // ---- thrown water
    const P = (this.P = new Float32Array(max * 3)), V = (this.V = new Float32Array(max * 3)), A = (this.A = new Float32Array(max * 4)), B = (this.B = new Float32Array(max * 4));
    for (let i = 0; i < max; i++) { A[i * 4] = 1; A[i * 4 + 1] = 1; P[i * 3 + 1] = -999; }      // A: age, life, size, seed   B: kind, alpha, growth, floor
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const ia = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', ia(P, 3)); g.setAttribute('iV', ia(V, 3)); g.setAttribute('iA', ia(A, 4)); g.setAttribute('iB', ia(B, 4)); g.instanceCount = max; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.UP = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), lightU(), { uCamV: { value: new THREE.Vector3() } }); this.camLast = new THREE.Vector3(); this.camHas = false;
    const pm = new THREE.ShaderMaterial({ uniforms: this.UP, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      vertexShader: `#include <common>
#include <fog_pars_vertex>
attribute vec3 iP; attribute vec3 iV; attribute vec4 iA; attribute vec4 iB; uniform vec3 uCamV;
varying vec2 vQ; varying vec4 vS;
void main() {
  float k = clamp(iA.x / iA.y, 0.0, 1.0); float kind = iB.x;
  vec4 mvPosition = viewMatrix * vec4(iP, 1.0);
  vec3 vv = (viewMatrix * vec4(iV - uCamV, 0.0)).xyz; float sp = length(vv.xy);
  vec2 ax = vec2(0.0, 1.0); if (sp > 0.05) ax = vv.xy / sp;
  vec2 pr = vec2(-ax.y, ax.x);
  float wid = iA.z * (1.0 + iB.z * k); float len = wid;
  if (kind < 0.5) len = wid * (1.0 + 0.03 * min(sp, 12.0));
  else if (kind < 1.5) len = wid + min(sp, 14.0) * 0.016;
  if (iA.x >= iA.y) { wid = 0.0; len = 0.0; }
  mvPosition.xy += ax * (position.y * len) + pr * (position.x * wid);
  vQ = position.xy; vS = vec4(k, iA.w, kind, iB.y);
  gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: `#include <common>
#include <fog_pars_fragment>
uniform sampler2D tN; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform vec3 uAmb;
varying vec2 vQ; varying vec4 vS;
void main() {
  float k = vS.x; float kind = vS.z; float r = length(vQ); if (r >= 1.0) discard;
  float fall = 1.0 - r; float a = 0.0; float dens = 0.5;
  ${LIGHT}
  if (kind < 0.5) {
    // a piece of the sheet: thick in the middle, torn where the noise is thin, eaten away as it ages
    float t1 = texture2D(tN, vQ * 0.21 + vec2(vS.y, vS.y * 1.7)).r; float t2 = texture2D(tN, vQ * 0.67 + vec2(vS.y * 3.1, vS.y * 0.37)).g;
    float d = t1 * 0.68 + t2 * 0.32 + fall * 0.5 - 0.27; float th = 0.20 + 0.56 * k;
    float body = smoothstep(th, th + 0.24, d); dens = smoothstep(th + 0.1, th + 0.45, d);
    float t3 = texture2D(tN, vQ * 1.7 + vec2(vS.y * 5.3, vS.y * 2.9)).r;      // fine grain: the sheet is drops, not cloth
    float grain = smoothstep(0.30, 0.62, t3 + dens * 0.42);
    a = body * mix(grain, 1.0, dens * 0.55) * smoothstep(0.0, 0.22, fall) * (1.0 - k * k) * smoothstep(0.0, 0.07, k);
    dens = dens * 0.6 + t2 * 0.4;
  } else if (kind < 1.5) {
    float w = 1.0 - abs(vQ.x); float l = 1.0 - vQ.y * vQ.y;
    a = w * w * l * (1.0 - k) * smoothstep(0.0, 0.05, k); dens = 1.0;
  } else {
    float t1 = texture2D(tN, vQ * 0.16 + vec2(vS.y * 2.3, vS.y)).r;
    a = fall * fall * (0.35 + 0.9 * t1) * (1.0 - k) * smoothstep(0.0, 0.18, k); dens = 0.75;
  }
  vec3 c = mix(vec3(0.42, 0.49, 0.49), vec3(0.74, 0.76, 0.76), dens) * lit;
  gl_FragColor = vec4(c, clamp(a * vS.w, 0.0, 1.0));
#include <fog_fragment>
}` });
    this.mesh = new THREE.Mesh(g, pm); this.mesh.name = 'river_thrown'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 44; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false; scene.add(this.mesh);
    // ---- the skirt
    const nv = SLOTS * M * ROWS; this.sp = new Float32Array(nv * 3); this.sd = new Float32Array(nv * 3);      // sd: u (m along, streaming aft), v (0 hull .. 1 edge), strength
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage)); sg.setAttribute('aD', new THREE.BufferAttribute(this.sd, 3).setUsage(THREE.DynamicDrawUsage));
    const I = []; for (let s = 0; s < SLOTS; s++) for (let i = 0; i < M; i++) { const j = (i + 1) % M; for (let r = 0; r + 1 < ROWS; r++) { const a = (s * M + i) * ROWS + r, b = (s * M + j) * ROWS + r; I.push(a, b, a + 1, b, b + 1, a + 1); } }
    sg.setIndex(I); sg.setDrawRange(0, 0); sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); this.perSlot = M * (ROWS - 1) * 6;
    this.US = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), lightU());
    const sm = new THREE.ShaderMaterial({ uniforms: this.US, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      vertexShader: `#include <common>
#include <fog_pars_vertex>
attribute vec3 aD; varying vec3 vD; varying vec2 vW;
void main() {
  vD = aD; vW = position.xz;
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: `#include <common>
#include <fog_pars_fragment>
uniform sampler2D tN; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform vec3 uAmb;
varying vec3 vD; varying vec2 vW;
void main() {
  float v = vD.y;
  float t1 = texture2D(tN, vec2(vD.x * 0.11, v * 0.45 + vD.x * 0.021)).r; float t2 = texture2D(tN, vec2(vD.x * 0.37, v * 1.3) + vW * 0.05).g; float t3 = texture2D(tN, vW * 0.23).b;
  float d = t1 * 0.5 + t2 * 0.3 + t3 * 0.2 + (1.0 - v) * 0.62 - 0.28;
  float th = 0.16 + 0.5 * v;
  float dens = smoothstep(th + 0.1, th + 0.42, d);
  float g3 = texture2D(tN, vec2(vD.x * 1.3, v * 2.1) + vW * 0.4).r;
  float a = smoothstep(th, th + 0.2, d) * mix(smoothstep(0.28, 0.6, g3 + dens * 0.4), 1.0, dens * 0.6) * vD.z * (1.0 - smoothstep(0.82, 1.0, v));
  ${LIGHT}
  vec3 c = mix(vec3(0.30, 0.43, 0.39), vec3(0.72, 0.75, 0.75), dens) * lit * (0.8 + 0.3 * t2);
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0) * 0.92);
#include <fog_fragment>
}` });
    this.skirt = new THREE.Mesh(sg, sm); this.skirt.name = 'river_skirt'; this.skirt.frustumCulled = false; this.skirt.renderOrder = 42; this.skirt.matrixAutoUpdate = false; scene.add(this.skirt);
    this.fy = new Float32Array(M); this.pick = [null, null, null, null]; this.pickD = new Float32Array(SLOTS); this.stats = { live: 0, slots: 0 };
  }
  // kind 0 a piece of sheet, 1 a droplet streak, 2 mist. Place and speed in the three.js frame; floor = the water's height under it
  emit(kind, x, y, z, vx, vy, vz, life, size, alpha, grow, floor) {
    const i = this.next; this.next = (i + 1) % this.max; const P = this.P, V = this.V, A = this.A, B = this.B;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
    A[i * 4] = 0; A[i * 4 + 1] = life; A[i * 4 + 2] = size; A[i * 4 + 3] = rnd(); B[i * 4] = kind; B[i * 4 + 1] = alpha; B[i * 4 + 2] = grow; B[i * 4 + 3] = floor; this.live = Math.max(this.live, life + 0.1);
  }
  // what is kept for one boat: its waterline resampled to M points with the way out from the hull at each, and its half beam along its length
  state(b) {
    if (b._wfx) return b._wfx; const S = b.spec, len = S.len, beam = S.beam; let hp = S.hull;
    if (!hp || hp.length < 4) { hp = []; for (let i = 0; i < 16; i++) { const a = -(i / 16) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); hp.push([x * len / 2, -z * beam / 2 * (x > 0 ? 1 - 0.75 * x * x : 1)]); } }
    const n = hp.length, cum = [0]; let cx = 0, cz = 0; for (let i = 0; i < n; i++) { const p = hp[i], q = hp[(i + 1) % n]; cum.push(cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1])); cx += p[0] / n; cz += p[1] / n; }
    const tot = cum[n], st = { LX: new Float32Array(M), LZ: new Float32Array(M), NX: new Float32Array(M), NZ: new Float32Array(M), HB: new Float32Array(HBN), x0: 0, x1: 0, e: new Float32Array(8), ph: rnd() * 50, slamT: 0 };
    let k = 0; for (let i = 0; i < M; i++) { const d = (i / M) * tot; while (k < n - 1 && cum[k + 1] < d) k++; const p = hp[k], q = hp[(k + 1) % n], sl = cum[k + 1] - cum[k] || 1, f = (d - cum[k]) / sl; st.LX[i] = p[0] + (q[0] - p[0]) * f; st.LZ[i] = p[1] + (q[1] - p[1]) * f; }
    for (let i = 0; i < M; i++) { const a = (i + M - 1) % M, c = (i + 1) % M; let tx = st.LX[c] - st.LX[a], tz = st.LZ[c] - st.LZ[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; let nx = tz, nz = -tx; if (nx * (st.LX[i] - cx) + nz * (st.LZ[i] - cz) < 0) { nx = -nx; nz = -nz; } st.NX[i] = nx; st.NZ[i] = nz; }
    let x0 = 1e9, x1 = -1e9; for (const p of hp) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); } st.x0 = x0; st.x1 = x1;
    for (let j = 0; j < HBN; j++) { const x = x0 + (x1 - x0) * (j / (HBN - 1)); let hb = 0; for (let i = 0; i < n; i++) { const p = hp[i], q = hp[(i + 1) % n]; if ((p[0] - x) * (q[0] - x) > 0 || p[0] === q[0]) continue; const f = (x - p[0]) / (q[0] - p[0]); hb = Math.max(hb, Math.abs(p[1] + (q[1] - p[1]) * f)); } st.HB[j] = hb; }
    b._wfx = st; return st;
  }
  halfBeam(st, x) { const u = clamp((x - st.x0) / (st.x1 - st.x0 || 1), 0, 1) * (HBN - 1), i = Math.min(HBN - 2, Math.floor(u)), f = u - i; return st.HB[i] + (st.HB[i + 1] - st.HB[i]) * f; }
  // how many to throw this frame for a rate a second (kept fractional per boat and channel)
  count(st, ch, rate) { let v = st.e[ch] + rate; const n = Math.floor(v); st.e[ch] = v - n; return Math.min(n, 60); }

  update(boats, dt, t, surf, camera) {
    if (!this.on) { this.mesh.visible = false; this.skirt.visible = false; return; }
    const fog = this.scene.fog; if (fog && fog.color) this.amb.copy(fog.color);
    { const cv = this.UP.uCamV.value, cp = camera.position; if (this.camHas && dt > 1e-4) { const k = 1 / dt, vx = (cp.x - this.camLast.x) * k, vy = (cp.y - this.camLast.y) * k, vz = (cp.z - this.camLast.z) * k; if (vx * vx + vy * vy + vz * vz < 6400) { cv.x += (vx - cv.x) * 0.3; cv.y += (vy - cv.y) * 0.3; cv.z += (vz - cv.z) * 0.3; } else cv.set(0, 0, 0); } this.camLast.copy(cp); this.camHas = true; }      // the camera's own speed: drops blur by how they move in the picture
    dt = Math.min(dt || 0, 0.05); const cx = camera.position.x, cy = -camera.position.z, pick = this.pick, pickD = this.pickD;
    for (let i = 0; i < SLOTS; i++) { pick[i] = null; pickD[i] = 1e9; }
    for (let bi = 0; bi < boats.length; bi++) { const b = boats[bi]; if (!b || !b.spec) continue; const v = Math.abs(b.vf || 0), d = Math.hypot(b.x - cx, b.y - cy) - b.spec.len * 0.5;
      if (b.fxSlam && d < 300) { this.slam(b, surf, b.fxSlam); } b.fxSlam = 0;
      if (v < 0.8 || d > 420) continue;
      if (dt > 0 && d < 260) this.throwFrom(b, dt, surf);
      for (let i = 0; i < SLOTS; i++) if (d < pickD[i]) { for (let j = SLOTS - 1; j > i; j--) { pick[j] = pick[j - 1]; pickD[j] = pickD[j - 1]; } pick[i] = b; pickD[i] = d; break; } }
    let ns = 0; for (let i = 0; i < SLOTS; i++) if (pick[i]) { this.skirtOf(pick[i], ns, dt, surf); ns++; }
    const sg = this.skirt.geometry; sg.setDrawRange(0, ns * this.perSlot); this.skirt.visible = ns > 0; if (ns) { sg.attributes.position.needsUpdate = true; sg.attributes.aD.needsUpdate = true; }
    this.step(dt); this.stats.slots = ns;
  }
  // the pool: gravity, the air's drag, an end at the water
  step(dt) {
    if (this.live <= 0) { this.mesh.visible = false; this.stats.live = 0; return; } this.live -= dt; this.mesh.visible = true;
    const P = this.P, V = this.V, A = this.A, B = this.B, d0 = Math.exp(-dt * 1.5), d1 = Math.exp(-dt * 0.7), d2 = Math.exp(-dt * 2.6); let n = 0;
    for (let i = 0; i < this.max; i++) { const a = A[i * 4]; if (a >= A[i * 4 + 1]) continue; n++; const kind = B[i * 4], dr = kind < 0.5 ? d0 : kind < 1.5 ? d1 : d2, i3 = i * 3;
      V[i3 + 1] -= (kind < 0.5 ? 7.6 : kind < 1.5 ? 9.81 : 0.5) * dt; V[i3] *= dr; V[i3 + 2] *= dr; if (kind > 1.5) V[i3 + 1] *= dr;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt; let na = a + dt;
      if (P[i3 + 1] < B[i * 4 + 3] && V[i3 + 1] < 0) { P[i3 + 1] = B[i * 4 + 3]; V[i3 + 1] = 0; V[i3] *= 0.8; V[i3 + 2] *= 0.8; na += dt * (kind < 1.5 ? 4 : 0); }      // back on the water: it lies there a moment and is gone
      A[i * 4] = na; }
    const g = this.mesh.geometry; g.attributes.iP.needsUpdate = true; g.attributes.iV.needsUpdate = true; g.attributes.iA.needsUpdate = true; g.attributes.iB.needsUpdate = true; this.stats.live = n;
  }
  // one piece thrown from the hull's own point (lx ahead, lz to starboard): fw = share of the boat's own speed it keeps, out along (ox, oz) in the hull's frame, up
  toss(b, kind, lx, lz, fy, fw, ox, oz, out, up, life, size, alpha, grow) {
    const c = Math.cos(b.h), s = Math.sin(b.h), bvx = b.vx === undefined ? c * (b.vf || 0) : b.vx, bvy = b.vy === undefined ? s * (b.vf || 0) : b.vy;
    const mx = b.x + c * lx + s * lz, my = b.y + s * lx - c * lz, vx = bvx * fw + (c * ox + s * oz) * out, vy = bvy * fw + (s * ox - c * oz) * out;
    this.emit(kind, mx, fy + 0.05, -my, vx, up, -vy, life, size, alpha, grow, fy - 0.05);
  }
  throwFrom(b, dt, surf) {
    const st = this.state(b), S = b.spec, len = S.len, beam = S.beam, T = b.tune || {}, top = T.top || 24, plane = T.lift ? 1 : 0, v = Math.abs(b.vf || 0), ahead = (b.vf || 0) > 0;
    const wetK = b.wet === undefined ? 1 : clamp(b.wet * 3, 0, 1), q = clamp((v - top * 0.22) / (top * 0.6), 0, 1) * wetK; if (!ahead) return;
    const fy = surf(b.x, b.y), vl = b.vl || 0, big = Math.sqrt(len / 8.6);
    const bowX = (S.bow ? S.bow[0] : len / 2) - len * (0.08 + 0.22 * q * plane), pS = 0.5 + clamp(vl * 0.09, -0.32, 0.32);
    if (plane) {
      if (q > 0.02) {
        let n = this.count(st, 0, dt * q * 150);
        for (let i = 0; i < n; i++) { const sg = rnd() < pS ? 1 : -1, r = rnd(), a = r * r * 0.42, x = bowX - a * len, hb = this.halfBeam(st, x), sf = 1 + clamp(sg * vl * 0.22, -0.45, 1.1), e = rnd();
          this.toss(b, 0, x, sg * (hb + 0.05), fy, 0.32 + 0.3 * rnd(), 0.22, sg, (1.8 + 3.4 * e) * (0.4 + 0.6 * q) * sf, (1.2 + 2.3 * rnd()) * (0.35 + 0.65 * q) * (1 - a * 1.1) * Math.sqrt(sf), 0.45 + 0.5 * rnd(), 0.13 + 0.20 * rnd(), 0.62, 1.7); }
        n = this.count(st, 1, dt * q * q * 300);
        for (let i = 0; i < n; i++) { const sg = rnd() < pS ? 1 : -1, r = rnd(), a = r * r * 0.42, x = bowX - a * len, hb = this.halfBeam(st, x), sf = 1 + clamp(sg * vl * 0.22, -0.45, 1.1), e = rnd();
          this.toss(b, 1, x, sg * (hb + 0.1), fy, 0.4 + 0.35 * rnd(), 0.3, sg, (2.5 + 5.0 * e) * (0.4 + 0.6 * q) * sf, (1.6 + 3.2 * rnd()) * (0.35 + 0.65 * q) * (1 - a), 0.5 + 0.5 * rnd(), 0.014 + 0.022 * rnd(), 0.8, 0); }
        n = this.count(st, 2, dt * q * 14);
        for (let i = 0; i < n; i++) { const sg = rnd() < pS ? 1 : -1, x = bowX - rnd() * 0.5 * len; this.toss(b, 2, x, sg * (this.halfBeam(st, x) + 0.5), fy + 0.3, 0.12 + 0.15 * rnd(), 0, sg, 1 + 2 * rnd(), 0.4 + 0.8 * rnd(), 1.0 + 0.8 * rnd(), 0.45 + 0.55 * rnd(), 0.075, 1.6); }
      }
      // the propellers: a mound of white water thrown up right behind them, a rooster of drops and mist at speed
      const sw = b.sternWet === undefined ? 1 : b.sternWet, thr = Math.max(0, b.thr || 0), pr = S.props && S.props.length ? S.props : null;
      if (sw > 0.3 && (thr > 0.15 || q > 0.05)) { const k = (0.45 * thr + 0.55 * q) * sw; let n = this.count(st, 3, dt * (40 * thr + 70 * q) * sw);
        for (let i = 0; i < n; i++) { const p = pr ? pr[(rnd() * pr.length) | 0] : null, px = (p ? p[0] : -len / 2) - 0.25 - rnd() * 0.5, pz = (p ? p[2] : 0) + (rnd() - 0.5) * 0.5;
          this.toss(b, 0, px, pz, fy, 0.12 + 0.2 * rnd(), -0.2, rnd() - 0.5, 1.4 * rnd(), (0.8 + 1.7 * rnd()) * (0.4 + 0.6 * k), 0.35 + 0.35 * rnd(), 0.13 + 0.19 * rnd(), 0.66, 1.6); }
        n = this.count(st, 4, dt * 80 * q * sw);
        for (let i = 0; i < n; i++) { const p = pr ? pr[(rnd() * pr.length) | 0] : null, px = (p ? p[0] : -len / 2) - 0.3, pz = (p ? p[2] : 0) + (rnd() - 0.5) * 0.4;
          this.toss(b, 1, px, pz, fy, 0.25 + 0.3 * rnd(), -0.3, rnd() - 0.5, 2.2 * rnd(), (1.4 + 3.0 * rnd()) * (0.4 + 0.6 * q), 0.4 + 0.45 * rnd(), 0.014 + 0.02 * rnd(), 0.8, 0); }
        n = this.count(st, 5, dt * 9 * q * sw);
        for (let i = 0; i < n; i++) this.toss(b, 2, (pr ? pr[0][0] : -len / 2) - 1 - rnd(), (rnd() - 0.5) * beam * 0.6, fy + 0.3, 0.1 + 0.1 * rnd(), 0, rnd() - 0.5, 1, 0.6 + 1.0 * rnd(), 1.0 + 0.8 * rnd(), 0.5 + 0.5 * rnd(), 0.075, 1.7);
      }
    } else if (q > 0.05) {
      // a big hull: a broad low bow wave that breaks and rolls away, and a boil of wash at the stern. No planing sheet.
      let n = this.count(st, 0, dt * q * 46);
      for (let i = 0; i < n; i++) { const sg = rnd() < 0.5 ? 1 : -1, r = rnd(), a = r * r * 0.22, x = bowX - a * len, hb = this.halfBeam(st, x);
        this.toss(b, 0, x, sg * (hb + 0.15), fy, 0.45 + 0.25 * rnd(), 0.35, sg, (1.0 + 2.2 * rnd()) * q, (0.9 + 1.7 * rnd()) * q * (1 - a * 2), 0.8 + 0.7 * rnd(), (0.2 + 0.26 * rnd()) * big, 0.5, 1.7); }
      n = this.count(st, 3, dt * q * 34); const sx = S.props && S.props[0] ? S.props[0][0] : -len / 2;
      for (let i = 0; i < n; i++) this.toss(b, 0, sx - rnd() * 0.06 * len, (rnd() - 0.5) * beam * 0.62, fy, 0.25 + 0.25 * rnd(), -0.4, rnd() - 0.5, 0.8 * rnd(), (0.4 + 0.9 * rnd()) * q, 0.9 + 0.8 * rnd(), (0.22 + 0.28 * rnd()) * big, 0.45, 1.6);
      n = this.count(st, 2, dt * q * 6);
      for (let i = 0; i < n; i++) { const sg = rnd() < 0.5 ? 1 : -1; this.toss(b, 2, bowX - rnd() * 0.1 * len, sg * this.halfBeam(st, bowX - 0.05 * len), fy + 0.3, 0.3, 0.3, sg, 1.2, 0.5 + rnd(), 1.4 + rnd(), 0.6 * big, 0.06, 1.5); }
    }
  }
  // the hull comes down after a jump: a ring of sheets thrown out from all round it, drops above, mist that hangs
  slam(b, surf, k) {
    const st = this.state(b), fy = surf(b.x, b.y), S = b.spec, big = Math.sqrt(S.len / 8.6); k = clamp(k, 0.2, 1);
    for (let i = 0, n = 46 * k + 16; i < n; i++) { const j = (rnd() * M) | 0; this.toss(b, 0, st.LX[j], st.LZ[j], fy, 0.5 + 0.3 * rnd(), st.NX[j], st.NZ[j], (2 + 5 * rnd()) * (0.5 + k), (1.8 + 3.2 * rnd()) * (0.5 + k), 0.6 + 0.5 * rnd(), (0.18 + 0.26 * rnd()) * big, 0.7, 1.9); }
    for (let i = 0, n = 190 * k + 50; i < n; i++) { const j = (rnd() * M) | 0; this.toss(b, 1, st.LX[j], st.LZ[j], fy, 0.55 + 0.3 * rnd(), st.NX[j], st.NZ[j], (3 + 7 * rnd()) * (0.5 + k), (2.5 + 5 * rnd()) * (0.5 + k), 0.6 + 0.6 * rnd(), 0.016 + 0.024 * rnd(), 0.85, 0); }
    for (let i = 0, n = 10 * k + 4; i < n; i++) { const j = (rnd() * M) | 0; this.toss(b, 2, st.LX[j], st.LZ[j], fy + 0.4, 0.3, st.NX[j], st.NZ[j], 2 + 2 * rnd(), 1 + 1.5 * rnd(), 1.2 + rnd(), (0.6 + 0.6 * rnd()) * big, 0.09, 1.6); }
  }
  // the strip of raised white water round one hull, written into slot s
  skirtOf(b, s, dt, surf) {
    const st = this.state(b), S = b.spec, len = S.len, T = b.tune || {}, top = T.top || 24, plane = T.lift ? 1 : 0, v = Math.abs(b.vf || 0), c = Math.cos(b.h), sn = Math.sin(b.h);
    const wetK = b.wet === undefined ? 1 : clamp(b.wet * 3, 0, 1), q = clamp((v - top * 0.22) / (top * 0.6), 0, 1) * wetK, q0 = ss(v, 0.8, plane ? 5 : 3.5) * wetK, vl = b.vl || 0, big = Math.sqrt(len / 8.6);
    const bowX = (S.bow ? S.bow[0] : len / 2) - len * (0.08 + 0.22 * q * plane), hs = plane ? 1 : Math.min(1.3, 0.13 * Math.sqrt(len)), ws = plane ? 1 : big * 0.9, fwd = (b.vf || 0) >= 0 ? 1 : 0.35;
    st.ph = (st.ph + (b.vf || 0) * dt * 0.55) % 1163.6; const pos = this.sp, dat = this.sd; let o = s * M * ROWS * 3;
    const FY = this.fy; for (let i = 0; i < M; i += 2) FY[i] = surf(b.x + c * st.LX[i] + sn * st.LZ[i], b.y + sn * st.LX[i] - c * st.LZ[i]) + 0.03; for (let i = 1; i < M; i += 2) FY[i] = (FY[i - 1] + FY[(i + 1) % M]) * 0.5;      // the water's height at every other point, the rest between
    for (let i = 0; i < M; i++) { const lx = st.LX[i], lz = st.LZ[i], nx = st.NX[i], nz = st.NZ[i], a = (bowX - lx) / len, ap = Math.max(a, 0), sg = lz >= 0 ? 1 : -1, stern = nx < -0.7;
      let H, Wd, A; const sf = 1 + clamp(sg * vl * 0.22, -0.45, 1.0);
      if (stern) { H = (0.07 + 0.10 * q) * q0 * hs; Wd = (0.35 + 0.35 * q) * ws; A = q0 * 0.95; }
      else { const f = ss(a, -0.04, 0.035) * Math.exp(-ap * (plane ? 3.0 : 5.5)); H = fwd * q * (0.07 + (plane ? 0.42 : 0.6) * f) * hs * sf + 0.03 * q0; Wd = (0.2 * q0 + fwd * q * (0.3 + ap * len * (plane ? 0.2 : 0.1)) * Math.sqrt(sf)) * ws; A = Math.max(q0 * 0.6, q) * ss(a, -0.05, 0.015); }
      const fy = FY[i], sweep = stern ? 0 : Wd * 0.3 * q;
      for (let r = 0; r < ROWS; r++) { const out = r === 0 ? -0.07 : r === 1 ? Wd * 0.3 : r === 2 ? Wd * 0.68 : Wd, hy = r === 1 ? H : r === 2 ? H * 0.78 : 0, bk = r === 0 ? 0 : sweep * (r / 3);
        const px = lx + nx * out - bk, pz = lz + nz * out; pos[o] = b.x + c * px + sn * pz; pos[o + 1] = fy + hy; pos[o + 2] = -(b.y + sn * px - c * pz);
        dat[o] = lx + st.ph + (stern ? lz * 0.7 : 0); dat[o + 1] = r / 3; dat[o + 2] = A; o += 3; } }
  }
  dispose() { this.scene.remove(this.mesh); this.scene.remove(this.skirt); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.skirt.geometry.dispose(); this.skirt.material.dispose(); this.tex.dispose(); }
}
