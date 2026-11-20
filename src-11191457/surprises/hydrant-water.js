// surprises/hydrant-water.js: water lying on the roadway, shared by the open hydrant (hydrant.js) and the rain puddles (splash.js).
//   makeSheet(game, kit, max)   one instanced draw of flat patches 12 mm over the asphalt. A patch is a bent capsule p0 -> p1 -> p2 (map
//                               metres) with radius r0 at p0 and r1 from p1 on: a pool that runs to the gutter and along it, or (p0 = p1 = p2
//                               apart by a few metres) a kerb puddle. Inside: standing water that mirrors the game's street cube (the same
//                               cube the light lane's wet road reads), sun glints, flow ripples or rain rings, foam where a jet lands; round
//                               it a damp dark rim. The sidewalk (15 cm up) hides what lies under it, so the kerb cuts the water by itself.
//   sheet.wetAt(x, y)           0..1: how deep the water is there (the same shape, without the edge noise)
//   aquaplane(v, wetL, wetR, dt, S)   what a car's tyres do in standing water: see below
import * as THREE from 'three';
import { clamp, lerp, smooth } from './kit.js';

const VERT = `attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD; varying vec3 vW; varying vec4 vA; varying vec4 vB; varying vec4 vC;
  void main(){ vA = aA; vB = aB; vC = aC; vW = vec3(aD.x + position.x * aD.z, 0.012, aD.y + position.z * aD.w); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); if (aC.x <= 0.0 && aC.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const FRAG = `varying vec3 vW; varying vec4 vA; varying vec4 vB; varying vec4 vC; uniform samplerCube tStreet; uniform float uTime, uRain, uMaxR; uniform vec3 uSunDir, uSunCol, uLight;
  float h1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), f.x), f.y); }
  vec2 g2(vec2 p){ return vec2(n2(p + vec2(0.31, 0.0)) - n2(p - vec2(0.31, 0.0)), n2(p + vec2(0.0, 0.31)) - n2(p - vec2(0.0, 0.31))); }
  float seg(vec2 p, vec2 a, vec2 b, out float h){ vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0); return length(pa - ba * h); }
  vec2 rings(vec2 p, float t){ vec2 g = vec2(0.0); for (int k = 0; k < 2; k++) { vec2 q = p * (k == 0 ? 2.3 : 3.7) + float(k) * 17.0; vec2 c = floor(q); float h = h1(c + 3.0), ph = fract(t * (0.9 + 0.5 * h) + h * 7.0); vec2 o = (vec2(h1(c), h1(c + 11.0)) - 0.5) * 0.5; vec2 d = fract(q) - 0.5 - o; float r = length(d);
      float w = sin((r - ph * 0.45) * 55.0) * smoothstep(0.07, 0.0, abs(r - ph * 0.45)) * (1.0 - ph); g += (d / max(r, 1e-3)) * w; } return g; }
  void main(){ vec2 p = vW.xz; float ha, hb; float d1 = seg(p, vA.xy, vA.zw, ha) - mix(vB.z, vB.w, ha), d2 = seg(p, vA.zw, vB.xy, hb) - vB.w, sd = min(d1, d2);
    float seed = vC.w, flow = vC.z, lvl = vC.x;
    float en = (n2(p * 0.55 + seed * 31.0) - 0.5) * 1.5 + (n2(p * 1.9 + seed * 7.0) - 0.5) * 0.5 + (n2(p * 6.3) - 0.5) * 0.14; sd += en * min(1.0, vB.w * 1.4);
    float shrink = (1.0 - lvl) * (vB.w * 1.5 + 0.35);
    float wat = (1.0 - smoothstep(-0.16, 0.0, sd + shrink)) * step(0.001, lvl);
    float damp = (1.0 - smoothstep(0.05, 0.75 + 0.5 * vB.w, sd + (1.0 - vC.y) * (vB.w * 1.6 + 1.6))) * smoothstep(0.0, 0.25, vC.y);
    float a0 = max(wat, damp); if (a0 < 0.004) discard;
    vec3 to = cameraPosition - vW; float dist = length(to); vec3 V = to / max(dist, 1e-3);
    // the surface: slow swell everywhere, ripples running with the flow where it flows, rain rings where it rains
    vec2 fd = normalize(vB.xy - vA.zw + vec2(1e-4, 0.0)); float tt = uTime;
    vec2 q = p - fd * tt * 0.9 * flow; vec2 gr = g2(q * 2.6) * 0.5 + g2(q * 6.1 + 4.0) * 0.28;
    float near0 = exp(-length(p - vA.xy) / max(vB.z * 0.5, 0.3));
    vec2 tilt = gr * (0.02 + flow * (0.10 + 0.22 * near0)) + rings(p, tt) * uRain * 0.06;
    vec3 N = normalize(vec3(tilt.x, 1.0, tilt.y)); vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02;
    vec3 env = min(textureLod(tStreet, (vW - cameraPosition) + R * 70.0, 0.0).rgb, vec3(min(uMaxR, 1.0))) * 0.75;
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0);
    vec3 spec = env * F * wat;
    float sg = pow(max(dot(normalize(R), uSunDir), 0.0), 900.0); spec += uSunCol * sg * 6.0 * wat * flow;
    // foam where the jet lands and on the first metres of the run: torn white streaks carried along
    float fz = min(flow * near0 * 1.4, 1.0); vec2 fq = p - fd * tt * 1.6 * flow; float fn = n2(fq * 1.5 + seed) * 0.55 + n2(fq * 4.3) * 0.3 + n2(fq * 13.0 - tt) * 0.15;
    float foam = smoothstep(0.6 - 0.36 * fz, 0.74 - 0.3 * fz, fn) * min(1.0, fz * 1.6) * wat * (0.22 + 0.4 * near0);
    vec3 col = spec * (1.0 - foam) + uLight * 0.9 * foam;
    float a = max(max(damp * 0.45, wat * 0.7), foam);
    a *= 1.0 - smoothstep(140.0, 190.0, dist); col *= 1.0 - smoothstep(140.0, 190.0, dist);
    gl_FragColor = vec4(col, a); }`;

export function makeSheet(game, kit, max = 4) {
  const w = game.world, sh = w.shared || {}, F = (k) => new Float32Array(max * k);
  const base = new THREE.PlaneGeometry(1, 1); base.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position);
  const at = {}; for (const k of ['aA', 'aB', 'aC', 'aD']) { at[k] = new THREE.InstancedBufferAttribute(F(4), 4); at[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, at[k]); } geo.instanceCount = 0;
  const U = { tStreet: sh.tStreet || { value: null }, uTime: sh.uTime || { value: 0 }, uRain: { value: 0 }, uMaxR: { value: 4 }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uLight: { value: new THREE.Vector3(1, 1, 1) } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 2; mesh.name = 'sur_water_sheet'; mesh.visible = false; w.scene.add(mesh);
  const S = { mesh, max, n: 0, P: [], U, _l: [0, 0, 0] };
  // a patch: p0 p1 p2 = [x, y] map metres; r0, r1 radii; level 0..1 (water), damp 0..1 (the dark rim), flow 0..1, seed
  S.add = (o) => { if (S.P.length >= max) return null; const p = Object.assign({ r0: 1, r1: 0.6, level: 1, damp: 1, flow: 0, seed: Math.random() }, o); S.P.push(p); return p; };
  S.remove = (p) => { const i = S.P.indexOf(p); if (i >= 0) S.P.splice(i, 1); };
  const sdSeg = (x, y, ax, ay, bx, by, o) => { const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay, h = clamp((pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-4), 0, 1); o.h = h; return Math.hypot(pax - bax * h, pay - bay * h); };
  const _h = { h: 0 };
  S.wetAt = (x, y) => { let best = 0; for (const p of S.P) { if (p.level <= 0.02) continue; if (x < p.bx0 || x > p.bx1 || y < p.by0 || y > p.by1) continue;
      const d1 = sdSeg(x, y, p.p0[0], p.p0[1], p.p1[0], p.p1[1], _h) - lerp(p.r0, p.r1, _h.h), d2 = sdSeg(x, y, p.p1[0], p.p1[1], p.p2[0], p.p2[1], _h) - p.r1, sd = Math.min(d1, d2) + (1 - p.level) * (p.r1 * 1.5 + 0.35);
      if (sd < 0) best = Math.max(best, clamp(-sd / 0.35, 0, 1) * (0.4 + 0.6 * p.level)); } return best; };
  // fill the instance buffers; call once a frame while anything lies on the road
  S.draw = () => { const P = S.P, n = P.length; geo.instanceCount = n; mesh.visible = n > 0; if (!n) return;
    const A = at.aA.array, B = at.aB.array, C = at.aC.array, D = at.aD.array;
    for (let i = 0; i < n; i++) { const p = P[i], m = Math.max(p.r0, p.r1) * 1.6 + 2.8, o = i * 4;
      p.bx0 = Math.min(p.p0[0], p.p1[0], p.p2[0]) - m; p.bx1 = Math.max(p.p0[0], p.p1[0], p.p2[0]) + m; p.by0 = Math.min(p.p0[1], p.p1[1], p.p2[1]) - m; p.by1 = Math.max(p.p0[1], p.p1[1], p.p2[1]) + m;
      A[o] = p.p0[0]; A[o + 1] = -p.p0[1]; A[o + 2] = p.p1[0]; A[o + 3] = -p.p1[1]; B[o] = p.p2[0]; B[o + 1] = -p.p2[1]; B[o + 2] = p.r0; B[o + 3] = p.r1;
      C[o] = p.level; C[o + 1] = p.damp; C[o + 2] = p.flow; C[o + 3] = p.seed; D[o] = (p.bx0 + p.bx1) / 2; D[o + 1] = -(p.by0 + p.by1) / 2; D[o + 2] = p.bx1 - p.bx0; D[o + 3] = p.by1 - p.by0; }
    for (const k in at) { const a = at[k]; a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    if (sh.uSunDir) U.uSunDir.value.copy(sh.uSunDir.value).normalize(); if (sh.uSunColor) U.uSunCol.value.copy(sh.uSunColor.value);
    const L = kit.light(1, S._l); U.uLight.value.set(L[0], L[1], L[2]); const wk = sh.uWetK && sh.uWetK.value; U.uMaxR.value = wk && wk.z > 0 ? wk.z : 4; U.uRain.value = game.rain ? game.rain.amt || 0 : 0; };
  S.dispose = () => { w.scene.remove(mesh); geo.dispose(); mat.dispose(); };
  return S;
}

// AQUAPLANING. A tyre in standing water rides up on it above a certain speed: the fronts stop steering (the wheel goes light), the car carries on the
// way it was going, the water drags at it, and a car with only one side in the water is tugged toward that side. Done on the car's own state after
// its step (game.js Vehicle.step is not touched): k = how much of the tyres' hold is gone (0..0.7, from depth and speed);
//   - the velocity keeps k of the direction it had a step ago (momentum), so turning the wheel yaws the car but does not turn its path: a slip
//     angle builds, and when the water ends the car's own tyre model takes the slide up (its exp(-grip dt) on sideways speed);
//   - the heading takes only (1 - 0.6 k) of the yaw the wheel asked for; the deeper side's drag yaws the car toward it;
//   - water drag takes speed off (up to about 2.2 m/s2 at full depth).
// wetL / wetR: depth 0..1 under the left and right front wheel. S: a small state object kept by the caller per car. Returns k.
export function aquaplane(v, wetL, wetR, dt, S) {
  const sp = Math.hypot(v.vx, v.vy), wet = Math.max(wetL, wetR), want = sp > 1 ? wet * smooth(8.5, 19, sp) * 0.7 : 0;
  S.k = (S.k || 0) + (want - (S.k || 0)) * Math.min(1, dt * (want > (S.k || 0) ? 14 : 3.5)); const k = S.k;
  if (wet > 0.02 && sp > 1) { const drag = (0.8 + 1.4 * smooth(6, 20, sp)) * wet * dt, f = Math.max(0, 1 - drag / sp); v.vx *= f; v.vy *= f;
    v.h += (wetL - wetR) * 0.5 * smooth(3, 14, sp) * dt * (1 - 0.5 * k) * Math.sign(v.vf || 1); }
  if (k > 0.01 && S.has && sp > 1) { const psp = Math.hypot(S.pvx, S.pvy) || 1, s2 = Math.hypot(v.vx, v.vy), kk = k * 0.9;
    const nx = lerp(v.vx, (S.pvx / psp) * s2, kk), ny = lerp(v.vy, (S.pvy / psp) * s2, kk), nl = Math.hypot(nx, ny) || 1; v.vx = (nx / nl) * s2; v.vy = (ny / nl) * s2;
    v.h -= (v.yawV || 0) * dt * 0.6 * k; }
  if (v.h > Math.PI) v.h -= 2 * Math.PI; else if (v.h < -Math.PI) v.h += 2 * Math.PI;
  S.pvx = v.vx; S.pvy = v.vy; S.has = true; return k;
}

// WATER IN THE AIR. waterLook(particles, opts) gives a kit Particles object (the simulation and its buffers stay the kit's) a material of our own,
// because the kit's sprites are soft wisps (right for steam, wrong for water). Two kinds:
//   clump (kit kind 'puff'): a piece of the white body of a jet. The quad lies along its own velocity; inside, noise stretched along the flow is cut
//     with a HARD threshold, so the edge is torn into fingers and beads; the particle's alpha is not opacity but DENSITY: as it runs out the piece
//     does not fade, it breaks up into ropes and then single beads. Thin parts are grey-blue, thick parts white with a fine grain.
//     A particle whose seed is 2 or more (hydrant.js adds 2 after emit) is drawn as the old soft wisp: the faint mist round the water.
//   bead (kit kind 'drop'): one hard-edged drop, a little longer along its flight, never smaller than about a pixel.
const WVERT = `attribute vec4 aPos; attribute vec4 aCol; attribute vec4 aVel; uniform float uStretch, uPx, uMinPx; varying vec2 vQ; varying vec4 vC; varying float vSeed; varying float vAsp; varying float vMist;
  void main(){ vQ = position.xy * 2.0; vC = aCol; vSeed = fract(aVel.w); vMist = step(1.5, aVel.w); vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0); float s = aPos.w;
    float mn = -mv.z * uPx * uMinPx; if (s < mn) { vC.a *= max(s / mn, 0.4); s = mn; }
    vec3 vv = (viewMatrix * vec4(aVel.xyz, 0.0)).xyz; float sp = length(vv.xy); vec2 d = sp > 1e-3 ? vv.xy / sp : vec2(0.0, 1.0); float len = s + sp * uStretch * (1.0 - vMist); vAsp = len / max(s, 1e-4);
    mv.xy += d * position.y * len + vec2(-d.y, d.x) * position.x * s;
    gl_Position = projectionMatrix * mv; if (aCol.a <= 0.0 || aPos.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const WFRAG = `varying vec2 vQ; varying vec4 vC; varying float vSeed; varying float vAsp; varying float vMist;
  float h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){ float r = length(vQ); if (r >= 1.0) discard; float e = 1.0 - r, sd = vSeed * 61.0; float a; vec3 col = vC.rgb;
    #ifdef BEAD
      float val = e - 0.1 - step(0.5, vSeed) * 0.9 * (1.0 - smoothstep(0.0, 0.22, abs(vQ.y - (vSeed - 0.75) * 1.6)));      /* half of them are two beads on one flight */
      a = smoothstep(0.0, max(fwidth(val), 0.02) * 1.3, val) * vC.a; col *= 0.8 + 0.2 * smoothstep(0.25, 0.6, e + vQ.x * 0.3);
    #else
      if (vMist > 0.5) { float n = vn(vQ * 1.3 + sd) * 0.65 + vn(vQ * 2.9 - sd) * 0.35; a = e * e * (3.0 - 2.0 * e) * (0.35 + 0.65 * smoothstep(0.2, 0.75, n + e * 0.35)) * vC.a; }
      else { vec2 q = vec2(vQ.x, vQ.y * vAsp);
        float streak = vn(vec2(q.x * 5.5 + sd, q.y * 0.45 + sd * 1.7)), fine = vn(vec2(q.x * 15.0 - sd, q.y * 1.5 + sd)), bead = vn(q * 9.0 + sd * 3.1);
        float body = e * 0.85 + ((streak - 0.5) * 1.25 + (fine - 0.5) * 0.7 + (bead - 0.5) * 0.5) * smoothstep(0.0, 0.3, e);
        float val = body - mix(1.8, 0.48, clamp(vC.a, 0.0, 1.0));
        a = smoothstep(0.0, max(fwidth(val), 0.015) * 1.2, val); float thick = smoothstep(0.0, 0.32, val);
        col *= mix(vec3(0.5, 0.62, 0.78), vec3(1.0), thick) * (0.66 + 0.34 * smoothstep(0.3, 0.7, fine * 0.6 + streak * 0.4)); a *= mix(0.45, 0.9, thick); }
    #endif
    if (a < 0.01) discard; gl_FragColor = vec4(col * a, a); }`;
export function waterLook(P, { bead = false, stretch = 0.03, minPx = 0 } = {}) {
  const U = { uStretch: { value: stretch }, uPx: { value: 0.001 }, uMinPx: { value: minPx } }, old = P.mesh.material;
  const mat = new THREE.ShaderMaterial({ defines: bead ? { BEAD: 1 } : {}, uniforms: U, vertexShader: WVERT, fragmentShader: WFRAG, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  P.mesh.material = mat; try { old.dispose(); } catch (e) {}
  P.mesh.onBeforeRender = (renderer, scene, camera) => { const h = renderer.domElement ? renderer.domElement.height : 900; U.uPx.value = camera.isPerspectiveCamera ? (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(h, 1) : 0.001; };
  return mat;
}
