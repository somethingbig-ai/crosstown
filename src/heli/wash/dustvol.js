// dustvol.js: the dust (or water spray) a rotor's wash lifts, as a VOLUME rather than sprites. The density is a function of place and time
// built on the air model (wash/field.js): a thin fast sheet scoured out along the ground from under the rotor edge, thickening as it runs out;
// the roll-up ring where the outwash slows, turning over; a thin haze recirculating above. Its grain is a small 3D noise read in polar
// coordinates that slide OUTWARD with the flow (faster near the ground, so the sheet shears as the real one does): every lobe and streak
// travels. It is drawn as a short stack of camera-facing slabs between the camera and the far side of the cloud; each pixel of a slab
// integrates the density along its own stretch of the view ray (in closed form through the height falloff, clipped at the ground), so the
// result is one continuous graded veil with no card outlines, cut correctly by the aircraft, walls and trunks standing in it. Lit by the
// game's sun through the sun's shadow map (shade falls through it in shafts), darker where it is thick, bright toward the sun.
// One draw call, three small 3D-texture reads and one shadow read a pixel per slab, three slabs by default (this.slabs; measured cost on an M1 Pro is about 0.3 ms a slab over a dusty roof); nothing is drawn when there is no dust.
import * as THREE from 'three';

const KMAX = 14;

function noise3D() {
  const N = 48, data = new Uint8Array(N * N * N * 4);
  let seed = 1234567; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const CH = [[3, 6, 12], [6, 12, 24], [4, 8, 16], [8, 16, 24]], WT = [0.5, 0.3, 0.2], tmp = new Float32Array(N * N * N);
  for (let c = 0; c < 4; c++) {
    tmp.fill(0);
    for (let o = 0; o < 3; o++) {
      const p = CH[c][o], lat = new Float32Array(p * p * p); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      const sc = p / N, w = WT[o], ix0 = new Int32Array(N), ix1 = new Int32Array(N), fr = new Float32Array(N);
      for (let i = 0; i < N; i++) { const x = (i + 0.5) * sc, xi = Math.floor(x); let f = x - xi; f = f * f * (3 - 2 * f); ix0[i] = xi % p; ix1[i] = (xi + 1) % p; fr[i] = f; }
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
        const a0 = (ix0[z] * p + ix0[y]) * p, a1 = (ix0[z] * p + ix1[y]) * p, a2 = (ix1[z] * p + ix0[y]) * p, a3 = (ix1[z] * p + ix1[y]) * p, fy = fr[y], fz = fr[z]; let k = (z * N + y) * N;
        for (let x = 0; x < N; x++, k++) { const i0 = ix0[x], i1 = ix1[x], fx = fr[x];
          const b0 = lat[a0 + i0] + (lat[a0 + i1] - lat[a0 + i0]) * fx, b1 = lat[a1 + i0] + (lat[a1 + i1] - lat[a1 + i0]) * fx, b2 = lat[a2 + i0] + (lat[a2 + i1] - lat[a2 + i0]) * fx, b3 = lat[a3 + i0] + (lat[a3 + i1] - lat[a3 + i0]) * fx;
          const c0 = b0 + (b1 - b0) * fy, c1 = b2 + (b3 - b2) * fy; tmp[k] += w * (c0 + (c1 - c0) * fz); }
      }
    }
    for (let k = 0; k < tmp.length; k++) data[k * 4 + c] = Math.max(0, Math.min(255, Math.round(((tmp[k] - 0.5) * 2.1 + 0.5) * 255)));
  }
  const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
let NOISE = null;

const VERT = /* glsl */`
  uniform vec4 uC; uniform vec4 uS; uniform vec3 uFw; uniform vec3 uRt; uniform vec3 uUp; uniform vec4 uD; uniform sampler2D tLight; uniform vec2 uHalf;
  varying vec3 vW; varying float vSky;
  void main() {
    float d = uD.x + (uD.w - 1.0 - position.z) * uD.y;                       // slab 0 is the farthest: drawn first
    vec3 C = vec3(uC.x, uC.y + 0.5 * uS.y, uC.z), rel = C - cameraPosition;
    vec3 Pc = cameraPosition + uFw * d + uRt * dot(rel, uRt) + uUp * dot(rel, uUp);
    float vlo = -uD.z, vhi = uD.z;
    if (uUp.y > 0.25) { vlo = max(vlo, (uC.y - 0.4 - Pc.y) / uUp.y); vhi = min(vhi, (uC.y + uS.y + 2.5 - Pc.y) / uUp.y); }      // only the band of the slab that lies in the cloud's height
    vhi = max(vhi, vlo);
    vec3 wp = Pc + uRt * (position.x * uD.z) + uUp * mix(vlo, vhi, position.y * 0.5 + 0.5);
    vW = wp; vSky = clamp(textureLod(tLight, vec2(uC.x / (2.0 * uHalf.x) + 0.5, -uC.z / (2.0 * uHalf.y) + 0.5), 0.0).r, 0.0, 1.15);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const FRAG = /* glsl */`
  #include <packing>
  uniform highp sampler3D tN; uniform sampler2D tShadow; uniform mat4 uShadowM; uniform float uShadowOn;
  uniform vec4 uC;       // centre of the wash on the surface: x, surface height, z; rotor radius
  uniform vec4 uS;       // slab thickness along the view axis; height of the cloud's top above the surface; time; strength 0..1
  uniform vec3 uFw; uniform vec4 uP;       // camera forward; (how far the front has run, in rotor radii; 1 = water spray; how much of a hover ring; unused)
  uniform vec4 uWat; uniform vec2 uLean; uniform vec3 uCol;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmb; uniform vec3 uFogColor; uniform float uFogDensity; uniform float uAmp[16]; uniform float uEdge[16];
  varying vec3 vW; varying float vSky;
  float sunVis(vec3 p) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 sc = uShadowM * vec4(p, 1.0); sc.xyz /= sc.w;
    if (sc.x < 0.002 || sc.x > 0.998 || sc.y < 0.002 || sc.y > 0.998 || sc.z > 1.0) return 1.0;
    float z = sc.z - 0.0011;
    return step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy)));
  }
  // the mean of exp(-h / d) along a stretch that runs from height h0 to h1
  float mexp(float h0, float h1, float d) { float a = min(h0, h1), b = max(h0, h1); return b - a < 0.03 ? exp(-a / d) : d * (exp(-a / d) - exp(-b / d)) / (b - a); }
  void main() {
    vec3 rd = normalize(vW - cameraPosition);
    float L = uS.x / max(dot(rd, uFw), 0.25), y0 = vW.y - uC.y, ta = 0.0, tb = L;
    if (abs(rd.y) > 1e-4) { float t0 = -y0 / rd.y, t1 = (uS.y - y0) / rd.y; ta = max(ta, min(t0, t1)); tb = min(tb, max(t0, t1)); } else if (y0 < 0.0 || y0 > uS.y) discard;
    if (tb <= ta) discard;
    float Ls = tb - ta, h0 = y0 + rd.y * ta, h1 = y0 + rd.y * tb, R = uC.w, t = uS.z, mist = uP.y;
    // two points on this stretch: one low (where the sheet is: at 0.45 m, or the nearest the stretch comes to it), one at its middle (ring and haze)
    float hs = clamp(0.45, min(h0, h1), max(h0, h1)), ts = abs(rd.y) > 1e-3 ? clamp(ta + (hs - h0) / rd.y, ta, tb) : 0.5 * (ta + tb);
    vec3 p = vW + rd * ts, pm = vW + rd * (0.5 * (ta + tb));
    vec2 q = p.xz - uC.xz, qm = pm.xz - uC.xz; float r = length(q), x = r / R, rm = length(qm), xm = rm / R;
    if (min(x, xm) > 4.85) discard;
    vec2 e = q / max(r, 0.01), em = qm / max(rm, 0.01); float h = max(p.y - uC.y, 0.0), hm = max(pm.y - uC.y, 0.0), A = atan(e.y, e.x) / 6.2831853, Am = atan(em.y, em.x) / 6.2831853;
    float amp, ampM;
    if (mist > 0.5) {      // spray: born on the water, carried on outward from it
      float wfar = length(uWat.xy - uC.xz);
      amp = exp(-max(length(p.xz - uWat.xy) - uWat.z, 0.0) / (0.6 * R)) * smoothstep(-uWat.z, 0.4 * uWat.z, r - wfar) * step(0.5, uWat.w);
      ampM = exp(-max(length(pm.xz - uWat.xy) - uWat.z, 0.0) / (0.6 * R)) * smoothstep(-uWat.z, 0.4 * uWat.z, rm - wfar) * step(0.5, uWat.w);
    } else {               // dust: as much as lies loose that way, and only as far as the surface goes (a roof's edge, a wall)
      float fa = fract(A + 1.0) * 16.0, fm = fract(Am + 1.0) * 16.0; int i0 = int(fa) & 15, i1 = (i0 + 1) & 15, j0 = int(fm) & 15, j1 = (j0 + 1) & 15;
      amp = mix(uAmp[i0], uAmp[i1], fract(fa)) * smoothstep(0.45, -0.05, x - mix(uEdge[i0], uEdge[i1], fract(fa)));
      ampM = mix(uAmp[j0], uAmp[j1], fract(fm)) * smoothstep(0.45, -0.05, xm - mix(uEdge[j0], uEdge[j1], fract(fm)));
    }
    amp *= uS.w * max(0.15, 1.0 + 1.3 * dot(e, uLean)); ampM *= uS.w * max(0.15, 1.0 + 1.3 * dot(em, uLean));
    if (amp + ampM < 0.004) discard;
    // the sheet along the ground: its grain is read in polar coordinates that slide outward, so every streak and surge in it travels
    vec4 ns = texture(tN, vec3(A * 7.0 + 0.31, (r - 9.0 * t) / 42.0, h / 2.6 - t * 0.09));
    float surge = smoothstep(0.22, 0.72, ns.b), streak = ns.g * ns.g * 2.2;
    float dS = (mist > 0.5 ? 0.08 + 0.05 * r : 0.16 + 0.085 * r);
    float rhoS = smoothstep(0.3, 1.0, x) * exp(-max(x - 1.3, 0.0) / 1.5) * smoothstep(uP.x, uP.x - 0.9, x) * (0.1 + 1.7 * surge) * (0.25 + streak) * (mist > 0.5 ? 0.2 : 0.3) * amp;
    // the cloud: where the outwash slows it lifts the dust into billows that are carried out and up. Round lumps of a grain fixed in space, carried along by
    // the air for a couple of seconds and then begun again a little way back (two such fields, out of step, cross-faded: the motion never stops and the lumps
    // are never drawn out into bands). The same grain read a little way toward the sun says how much dust lies in the way: each billow has a lit and a dark side.
    float frontM = smoothstep(uP.x + 0.3, uP.x - 0.6, xm), Ht = R * (0.22 + 0.55 * smoothstep(1.0, 2.8, xm));
    float env = (smoothstep(0.75, 1.5, xm) * exp(-max(xm - 2.5, 0.0) / 0.8) * exp(-(hm * hm) / (Ht * Ht)) * (0.35 + 0.65 * uP.z) + 0.12 * smoothstep(0.5, 2.0, xm) * exp(-max(xm - 2.8, 0.0) / 0.9) * exp(-hm / (0.8 * R))) * frontM;
    env *= smoothstep(uS.y, 0.55 * uS.y, hm);      // nothing reaches the top of the slabs: no cut line in the sky
    float kC = (mist > 0.5 ? 0.09 : 0.7) * ampM, rhoC = 0.0, sunC = 1.0;
    if (env * kC > 0.003) {
      const float T = 2.6; float f1 = fract(t / T), f2 = fract(t / T + 0.5), w1 = 1.0 - abs(2.0 * f1 - 1.0);
      vec3 vel = vec3(em.x, 0.0, em.y) * (5.0 * exp(-hm / 3.0) + 1.0) + vec3(0.0, 1.5 * smoothstep(1.3, 2.6, xm), 0.0), q0 = (pm - vec3(uC.x, uC.y, uC.z)) / 19.0;
      vec3 qa = q0 - vel * ((f1 - 0.5) * T / 19.0), qb = q0 - vel * ((f2 - 0.5) * T / 19.0) + vec3(0.37, 0.11, 0.53);
      vec4 a0 = texture(tN, qa), b0 = texture(tN, qb);
      float n0 = mix(0.6 * b0.r + 0.4 * b0.g, 0.6 * a0.r + 0.4 * a0.g, w1) - 0.14 * (mix(b0.a, a0.a, w1) - 0.5), th = 0.56 - 0.2 * env;
      rhoC = env * smoothstep(th - 0.045, th + 0.045, n0) * kC;
      sunC = (0.5 + 0.5 * smoothstep(th + 0.12, th - 0.04, n0)) * (0.72 + 0.28 * smoothstep(0.0, Ht, hm));      // a lump's middle is darker than its skin, its foot darker than its top
    }
    // fine grain, pixel by pixel: dust is particles
    float gr = fract(sin(dot(gl_FragCoord.xy + 17.0 * fract(t), vec2(12.9898, 78.233))) * 43758.5453);
    float tau = Ls * (rhoS * mexp(h0, h1, dS) + rhoC) * (0.85 + 0.3 * ns.a) * (0.82 + 0.36 * gr);
    if (tau < 0.002) discard;
    // light: the sun through what lies above and toward it (thick dust shades itself), shade from the scene, a glow looking toward the sun
    float lS = rhoS * exp(-h / dS), wS = lS * dS / max(lS * dS + rhoC * 2.0, 1e-5);
    float sunT = exp(-1.3 * lS * dS / max(uSunDir.y, 0.25)) * mix(sunC, 1.0, wS);
    float vis = 0.3 + 0.7 * sunVis(mix(pm, p, wS) + uSunDir * 0.3), cs = dot(rd, uSunDir);
    float phase = 0.82 + 0.9 * pow(max(cs, 0.0), 6.0) + 0.12 * max(-cs, 0.0);
    vec3 col = uCol * (uSunColor * vis * sunT * phase + uAmb * vSky * (0.5 + 0.5 * sunT));
    float al = 1.0 - exp(-tau), dist = length(pm - cameraPosition), fog = 1.0 - exp(-uFogDensity * dist);
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col * al, al);
  }`;

export class DustVolume {
  constructor(world, mist = false) {
    this.world = world; this.mist = mist; this.s = 0; this.front = 0.4; this.cx = 0; this.cy = 0; this.cz = 0; this.H = mist ? 5 : 8; this.K = 6; this.slabs = mist ? 2 : 3; this.amp = new Float32Array(16); this.edge = new Float32Array(16).fill(5);
    // slabs: how many layers are drawn close to (the cost is this many times the pixels the cloud covers); 0 = off
    const P = [], I = [];
    for (let k = 0; k < KMAX; k++) { P.push(-1, -1, k, 1, -1, k, 1, 1, k, -1, 1, k); const a = k * 4; I.push(a, a + 1, a + 2, a, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    const sh = world.shared, fog = world.scene.fog;
    this.uniforms = {
      tN: { value: NOISE || (NOISE = noise3D()) }, tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, tLight: sh.tLight, uHalf: sh.uHalf,
      uC: { value: new THREE.Vector4(0, 0, 0, 5.3) }, uS: { value: new THREE.Vector4(3, this.H, 0, 0) }, uD: { value: new THREE.Vector4(1, 3, 26, KMAX) }, uP: { value: new THREE.Vector4(0.4, mist ? 1 : 0, 1, 0) },
      uFw: { value: new THREE.Vector3(0, 0, -1) }, uRt: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uWat: { value: new THREE.Vector4() }, uLean: { value: new THREE.Vector2() },
      uCol: { value: new THREE.Vector3(0.4, 0.38, 0.34) }, uSunDir: sh.uSunDir, uSunColor: sh.uSunColor, uAmb: { value: new THREE.Vector3(0.50, 0.58, 0.72) },
      uFogColor: { value: fog ? fog.color : new THREE.Color(0.6, 0.7, 0.8) }, uFogDensity: { value: fog ? fog.density : 0 }, uAmp: { value: this.amp }, uEdge: { value: this.edge },
    };
    const m = (this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }));
    const mesh = (this.mesh = new THREE.Mesh(g, m)); mesh.frustumCulled = false; mesh.renderOrder = mist ? 47 : 46; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.name = mist ? 'heli_wash_spray' : 'heli_wash_dust';
    mesh.onBeforeRender = (r, sc, cam, geo, mat) => { geo.setDrawRange(0, mat === m && cam === world.camera ? this.K * 6 : 0); };
  }
  // every fixed step. fl: the wash field; strength 0..1 (0 = let it thin away where it is); amps: 16 numbers round the compass (how much loose dust lies that
  // way), or null; col: [r, g, b]; water: { x, zt, radius } for spray
  step(dt, fl, strength, amps, col, water, edges) {
    const U = this.uniforms, on = fl.on && strength > 0; this.R = fl.R;
    if (on) {
      const far = Math.abs(fl.cx - this.cx) + Math.abs(fl.cz - this.cz) > 40 || this.s < 0.012;
      if (this.s < 0.012) this.front = 0.4;
      const k = far ? 1 : Math.min(1, dt * 3); this.cx += (fl.cx - this.cx) * k; this.cz += (fl.cz - this.cz) * k; this.cy = far ? fl.cy : this.cy + (fl.cy - this.cy) * Math.min(1, dt * 6);
      this.front = Math.min(5.2, this.front + dt * 0.85); U.uLean.value.set(fl.lx, fl.lz); U.uP.value.z = fl.hov;
      if (amps) for (let i = 0; i < 16; i++) { this.amp[i] += (amps[i] - this.amp[i]) * (far ? 1 : Math.min(1, dt * 1.5)); if (edges) this.edge[i] += (edges[i] - this.edge[i]) * (far ? 1 : Math.min(1, dt * 4)); }
      if (col) { const c = U.uCol.value, kc = far ? 1 : Math.min(1, dt * 1.5); c.x += (col[0] - c.x) * kc; c.y += (col[1] - c.y) * kc; c.z += (col[2] - c.z) * kc; }
      if (water) U.uWat.value.set(water.x, water.zt, water.radius, 1);
    } else this.front = Math.min(6, this.front + dt * 0.35);
    const tgt = on ? strength : 0; this.s += (tgt - this.s) * Math.min(1, dt * (tgt > this.s ? 1.4 : 0.28));
  }
  // once per drawn frame
  update(cam, t) {
    const U = this.uniforms, R = this.R || 5.3, mesh = this.mesh; if (this.s < 0.012 || this.slabs < 1) { mesh.visible = false; return; }
    const e = cam.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10], H = this.H, Rv = 4.95 * R;
    const rx = this.cx - cam.position.x, ry = this.cy + 0.5 * H - cam.position.y, rz = this.cz - cam.position.z, dc = rx * fx + ry * fy + rz * fz, dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const ext = Rv * Math.sqrt(Math.max(0, 1 - fy * fy)) + (0.5 * H + 1) * Math.abs(fy), dFar = dc + ext;
    if (dFar < 0.8 || dist > 700) { mesh.visible = false; return; }
    const d0 = Math.max(0.4, dc - ext), K = (this.K = Math.min(KMAX, dist > 120 ? Math.min(4, this.slabs) : this.slabs)), dl = (dFar - d0) / K;
    mesh.visible = true;
    U.uC.value.set(this.cx, this.cy, this.cz, R); U.uS.value.set(dl, H, t, this.s); U.uD.value.set(d0, dl, Rv, K); U.uP.value.x = this.front;
    U.uFw.value.set(fx, fy, fz); U.uRt.value.set(e[0], e[1], e[2]); U.uUp.value.set(e[4], e[5], e[6]);
    const sun = this.world.sun;
    if (sun && sun.shadow && sun.shadow.map) { U.tShadow.value = sun.shadow.map.texture; U.uShadowM.value.copy(sun.shadow.matrix); U.uShadowOn.value = 1; } else U.uShadowOn.value = 0;
  }
}
