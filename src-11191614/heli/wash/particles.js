// particles.js: everything the wash throws about, in ONE draw call: dust and smoke and water mist (soft lit puffs), leaves, litter and grit
// (small tumbling flat scraps), sparks and water drops (short streaks). Simulated in typed arrays (no allocation per frame), sorted far to
// near by a counting sort, drawn as instanced quads. Lit like the scene: the game's sun colour and direction, the sun's shadow map read at
// each puff's corners, the sky's light scaled by the city's baked sky visibility, the scene's haze. Puffs fade out toward the surface they
// lie on (their own ground height travels with them), so no card cuts the ground with a hard line.
import * as THREE from 'three';

export const DUST = 0, MIST = 1, SMOKE = 2, LEAF = 3, SPARK = 4, DROP = 5, GRIT = 6, PAPER = 7, CHAFF = 8;
const CLS = [0, 0, 0, 1, 2, 2, 1, 1, 1];              // drawn as: 0 puff, 1 flat scrap, 2 streak
const SHAPE = [0, 0, 0, 0, 0, 0, 0.3, 0.1, 0.2];      // a scrap's outline: leaf, paper, a sliver of dry grass, a crumb of grit (rides in the fraction of the class)
const RESP = [2.6, 3.2, 2.0, 0, 0, 0, 0, 0, 0];       // how fast a puff takes up the speed of the air around it, 1/s
const BUOY = [-0.12, -0.5, 1.3, 0, 0, 0, 0, 0, 0];    // rise (+) or settle (-), m/s2
const STRIDE = 16;

// four puffs of billowing density with a normal for each, drawn once at load: R, G = normal x, y; B = density; A = fine grain
function puffAtlas() {
  const T = 256, N = T * 2, data = new Uint8Array(N * N * 4);
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  const fbm = (x, y, s, o) => { let a = 0.5, v = 0; for (let i = 0; i < o; i++) { v += a * vn(x, y, s + i * 17); x = x * 2.03 + 11.3; y = y * 2.03 + 7.7; a *= 0.5; } return v; };
  const den = new Float32Array(T * T);
  for (let tile = 0; tile < 4; tile++) {
    const s = 31 + tile * 101, ox = (tile & 1) * T, oy = (tile >> 1) * T;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const u = (i + 0.5) / T * 2 - 1, v = (j + 0.5) / T * 2 - 1;
      // a few lobes, their edges eaten by noise: a billow, not a disc
      const wx = u + (fbm(u * 1.6 + 5, v * 1.6, s, 3) - 0.5) * 0.7, wy = v + (fbm(u * 1.6, v * 1.6 + 9, s + 7, 3) - 0.5) * 0.7, r = Math.sqrt(wx * wx + wy * wy);
      const body = Math.max(0, 1 - r * r * 1.2), bill = fbm(u * 2.6 + 3, v * 2.6 + 1, s + 3, 5), fine = fbm(u * 9 + 1, v * 9 + 4, s + 5, 3);
      // thin everywhere, thicker in a few wisps; it fades out long before the card's edge
      const d = Math.pow(body, 1.4) * (0.45 + 0.75 * bill + 0.3 * (fine - 0.5)) * 1.05 * Math.max(0, Math.min(1, (0.98 - Math.sqrt(u * u + v * v)) * 3.5));
      den[j * T + i] = Math.max(0, Math.min(1, d));
    }
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const g = (a, b) => den[Math.max(0, Math.min(T - 1, b)) * T + Math.max(0, Math.min(T - 1, a))];
      // the normal of the puff's bulk: slope of its density over a few texels (wide, so the lumps read as rounded forms)
      const dx = (g(i + 5, j) - g(i - 5, j)) + 0.5 * (g(i + 2, j) - g(i - 2, j)), dy = (g(i, j + 5) - g(i, j - 5)) + 0.5 * (g(i, j + 2) - g(i, j - 2));
      const k = ((oy + j) * N + ox + i) * 4, u = (i + 0.5) / T, v = (j + 0.5) / T;
      data[k] = Math.max(0, Math.min(255, Math.round((0.5 - dx * 1.1) * 255))); data[k + 1] = Math.max(0, Math.min(255, Math.round((0.5 - dy * 1.1) * 255)));
      data[k + 2] = Math.round(den[j * T + i] * 255); data[k + 3] = Math.round(fbm(u * 24, v * 24, s + 9, 3) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */`
  #include <common>
  attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD;
  uniform vec3 uSunDir; uniform sampler2D tLight; uniform vec2 uHalf;
  varying vec2 vUv; varying vec4 vCol; varying vec4 vP; varying vec3 vW; varying vec2 vLit; varying vec3 vR; varying vec3 vU; varying vec2 vS;
  void main() {
    vec3 c = aA.xyz; float s = aA.w, cls = aC.x; vec2 q = position.xy;
    vec3 toCam = cameraPosition - c; float dist = length(toCam); toCam /= max(dist, 1e-3);
    vec3 rt, up, stretch = vec3(0.0); float near = 1.0;
    if (cls < 0.5) {
      vec3 r0 = normalize(cross(vec3(0.0, 1.0, 0.0), toCam)), u0 = cross(toCam, r0); float cr = cos(aD.w), sr = sin(aD.w);
      rt = r0 * cr + u0 * sr; up = u0 * cr - r0 * sr;
      float sx = dot(aD.xyz, r0), sy = dot(aD.xyz, u0); stretch = (r0 * sx + u0 * sy);                // drawn out along the way it is being blown
      near = smoothstep(0.8, 2.4, dist / max(s, 0.05));                    // a puff the camera is inside of thins out instead of slapping the lens
    } else if (cls < 1.5) {
      float tl = aD.w, az = aC.w; vec3 n = vec3(sin(tl) * cos(az), cos(tl), sin(tl) * sin(az));
      vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(n, t1); float cr = cos(aC.y * 40.0), sr = sin(aC.y * 40.0);
      rt = t1 * cr + t2 * sr; up = t2 * cr - t1 * sr;
      s = max(s, dist * 0.0011);                                          // never thinner than about a pixel: it would sparkle
    } else {
      float l = length(aD.xyz); up = aD.xyz / max(s, 1e-4); rt = normalize(cross(aD.xyz / max(l, 1e-4), toCam)) * max(1.0, dist * 0.0011 / max(s, 1e-4));
    }
    vec3 off = (rt * q.x + up * q.y) * s; off += stretch * dot(off, stretch) / max(dot(stretch, stretch), 1e-4) * length(stretch);
    if (cls > 0.5 && cls < 1.5) {      // a scrap is smeared along the way it flies for as long as the shutter is open, and thinner for it
      float bl = length(aD.xyz), bmin = dist * 0.0011;
      if (bl > bmin) { off += aD.xyz * (dot(off, aD.xyz) > 0.0 ? 0.5 : -0.5); near = s / (s + bl); }
    }
    vec3 wp = c + off;
    vUv = q; vCol = aB; vP = aC; vW = wp; vR = normalize(rt); vU = normalize(up); vS = vec2(s, near);
    vLit.x = s;
    vLit.y = clamp(textureLod(tLight, vec2(c.x / (2.0 * uHalf.x) + 0.5, -c.z / (2.0 * uHalf.y) + 0.5), 0.0).r, 0.0, 1.15);
    gl_Position = near * aB.a < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);      // nothing to show: no pixels to fill
  }`;

const FRAG = /* glsl */`
  #include <packing>
  uniform mat4 uShadowM; uniform sampler2D tShadow; uniform float uShadowOn;
  float sunVis(vec3 p) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 sc = uShadowM * vec4(p, 1.0); sc.xyz /= sc.w;
    if (sc.x < 0.002 || sc.x > 0.998 || sc.y < 0.002 || sc.y > 0.998 || sc.z > 1.0) return 1.0;
    // four reads a few texels apart: dust is a volume, the edge of a shadow in it is soft
    const float E = 0.0009; float z = sc.z - 0.0011, v = 0.0;
    v += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(E, E * 0.4)))); v += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(-E * 0.4, E))));
    v += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(-E, -E * 0.4)))); v += step(z, unpackRGBAToDepth(texture2D(tShadow, sc.xy + vec2(E * 0.4, -E))));
    return v * 0.25;
  }
  uniform sampler2D tPuff; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmb; uniform vec3 uFogColor; uniform float uFogDensity;
  varying vec2 vUv; varying vec4 vCol; varying vec4 vP; varying vec3 vW; varying vec2 vLit; varying vec3 vR; varying vec3 vU; varying vec2 vS;
  void main() {
    float cls = vP.x; vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
    vec3 amb = uAmb * vLit.y; vec4 o;
    // sun or shade, per pixel, at the card and a little toward the sun from it (so tree shade falls through the dust in shafts)
    float sun = sunVis(vW + uSunDir * (0.2 * vLit.x)); if (cls < 0.5) sun = 0.35 + 0.65 * sun;      // light scattered inside the dust reaches into the shade
    if (cls < 0.5) {
      float var = floor(fract(vP.y * 7.31) * 4.0); vec2 cell = vec2(mod(var, 2.0), floor(var * 0.5));
      vec2 tuv = clamp(vUv + 0.5, 0.004, 0.996);
      vec4 t = texture2D(tPuff, (tuv + cell) * 0.5);
      // as a puff ages it is eaten from its thin parts inward: wisps, not a fading disc
      float er = vP.w * vP.w * 0.5, dens = clamp((t.b - er * (0.3 + 0.9 * t.a)) / (1.0 - er * 0.7), 0.0, 1.0) * (0.7 + 0.6 * t.a);
      vec3 n = vec3(t.rg * 2.0 - 1.0, 0.0); n.z = sqrt(max(0.2, 1.0 - dot(n.xy, n.xy)));
      vec3 N = normalize(vR * n.x + vU * n.y + V * n.z);
      float ndl = dot(N, uSunDir), wrap = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
      float through = pow(max(dot(-V, uSunDir), 0.0), 5.0) * (1.0 - dens) * 1.4;            // thin edges light up with the sun behind them
      // dust is thin: the sun goes through most of it, so it is lit nearly evenly, a little brighter on the sun's side and darker where it is thick
      vec3 col = vCol.rgb * (uSunColor * sun * (0.34 + 0.66 * wrap + through) * mix(1.0, 0.72, dens * (1.0 - wrap)) + amb * (0.8 + 0.2 * N.y));
      float a = dens * vCol.a * vS.y * smoothstep(0.0, 1.0, (vW.y - vP.z) / (0.28 * vS.x + 0.04));
      o = vec4(col * a, a);
    } else if (cls < 1.5) {
      // a flat scrap seen as what it is: p.x runs along it (stalk to tip), p.y across
      vec2 p = vUv * 2.0; float sh = fract(vP.y * 3.7), shp = floor(fract(cls) * 10.0 + 0.5), a, rib = 0.0, curl = 0.0;
      if (shp < 0.5) {            // a leaf: a pointed oval, widest behind the middle, toothed or lobed, a midrib; no two alike
        float w = (0.40 + 0.34 * sh) * sqrt(max(1.0 - p.x * p.x, 0.0)) * (1.0 - 0.38 * p.x);
        w *= 1.0 + (0.06 + 0.22 * step(0.55, sh)) * sin(p.x * (5.0 + floor(sh * 5.0) * 2.0) + vP.y * 40.0);
        a = smoothstep(w, w - 0.07, abs(p.y)); rib = smoothstep(0.07, 0.0, abs(p.y)) * 0.3; curl = p.y * (sh - 0.4) * 1.6;
      } else if (shp < 1.5) {     // paper, a wrapper, a bag: a creased rectangle with a corner gone
        float w = 0.5 + 0.38 * sh, cut = p.x * (sh - 0.5) * 0.5; a = smoothstep(0.96, 0.9, abs(p.x)) * smoothstep(w, w - 0.06, abs(p.y + cut)) * smoothstep(-1.75, -1.6, -(abs(p.x) + abs(p.y)) * (0.9 + 0.2 * sh));
        curl = 0.7 * sin(p.x * (3.0 + 4.0 * sh) + vP.y * 31.0) + 0.4 * sin(p.y * 5.0 + vP.y * 17.0);
      } else if (shp < 2.5) {     // a sliver of dry grass
        a = smoothstep(1.0, 0.85, abs(p.x)) * smoothstep(0.2, 0.1, abs(p.y + 0.12 * sin(p.x * 2.0 + vP.y * 9.0)));
      } else {                    // grit: a crumb
        a = smoothstep(0.95, 0.7, length(p * vec2(1.0, 1.1 + 0.5 * sh)) + 0.18 * sin(atan(p.y, p.x) * 3.0 + vP.y * 40.0));
      }
      a *= vCol.a * vS.y;
      vec3 N = normalize(cross(vR, vU) + vU * curl * 0.5); float ndl = dot(N, uSunDir), face = dot(N, V), same = ndl * face > 0.0 ? 1.0 : 0.0;
      // lit on the side the sun is on; seen from the other side a leaf glows with the light that comes through it, paper a little, grit not at all
      float thru = shp < 0.5 ? 0.62 : shp < 2.5 ? 0.4 : 0.0;
      vec3 tint = same > 0.5 ? vec3(1.0) : (shp < 0.5 ? vec3(1.12, 1.1, 0.5) : vec3(1.0, 0.97, 0.9));
      float lit = abs(ndl) * mix(thru, 1.0, same);
      vec3 col = vCol.rgb * tint * (uSunColor * sun * (0.08 + 0.92 * lit) + amb * (0.75 + 0.25 * abs(N.y))) * (1.0 - rib);
      o = vec4(col * a, a);
    } else {
      float a = smoothstep(0.5, 0.05, abs(vUv.x)) * smoothstep(0.5, 0.15, abs(vUv.y)) * vCol.a, em = step(2.5, cls);
      vec3 lit = vCol.rgb * (uSunColor * sun * 1.3 + amb * 1.2);
      o = em > 0.5 ? vec4(vCol.rgb * a, 0.0) : vec4(lit * a, a);
    }
    float fog = 1.0 - exp(-uFogDensity * dist);
    o.rgb = mix(o.rgb, uFogColor * o.a, fog);
    gl_FragColor = o;
  }`;

export class Particles {
  constructor(world, cap = 4096) {
    this.cap = cap; this.n = 0; this.world = world; this.frame = 0; this.t = 0;
    const F = () => new Float32Array(cap);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F(); this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F();
    this.cr = F(); this.cg = F(); this.cb = F(); this.al = F(); this.seed = F(); this.gnd = F(); this.spin = F(); this.rest = F(); this.kind = new Uint8Array(cap);
    this.fields = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.cr, this.cg, this.cb, this.al, this.seed, this.gnd, this.spin, this.rest];
    this.key = F(); this.order = new Uint16Array(cap); this.count = new Uint16Array(257);
    // Three instance buffers taken in turn: writing into a buffer the GPU is still drawing the last frame from makes the driver wait for it
    // (measured on the M1 Pro: about 5 ms a frame, whatever the particle count); a buffer last used three frames ago is free.
    const quad = new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3), idx = new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1);
    this.sets = [0, 1, 2].map(() => { const buf = new Float32Array(cap * STRIDE), g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', quad); g.setIndex(idx);
      const ib = new THREE.InstancedInterleavedBuffer(buf, STRIDE, 1); ib.setUsage(THREE.StreamDrawUsage);
      g.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
      g.setAttribute('aC', new THREE.InterleavedBufferAttribute(ib, 4, 8)); g.setAttribute('aD', new THREE.InterleavedBufferAttribute(ib, 4, 12)); g.instanceCount = 0; return { buf, g, ib }; });
    this.turn = 0; this.buf = this.sets[0].buf; const g = this.sets[0].g;
    const sh = world.shared, fog = world.scene.fog;
    this.uniforms = {
      tPuff: { value: puffAtlas() }, uSunDir: sh.uSunDir, uSunColor: sh.uSunColor, tLight: sh.tLight, uHalf: sh.uHalf,
      uAmb: { value: new THREE.Vector3(0.50, 0.58, 0.72) }, uFogColor: { value: fog ? fog.color : new THREE.Color(0.6, 0.7, 0.8) }, uFogDensity: { value: fog ? fog.density : 0 },
      tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
    };
    const m = (this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }));
    const mesh = (this.mesh = new THREE.Mesh(g, m)); mesh.frustumCulled = false; mesh.renderOrder = 50; mesh.visible = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.name = 'heli_wash_particles';
    // only our own material draws these: the screen-space passes that redraw the scene with one material of their own must not see them
    // ... and only the game's own camera: the street mirror's six faces do not need them
    mesh.onBeforeRender = (r, sc, cam, geo, mat) => { geo.setDrawRange(0, mat === m && cam === world.camera ? Infinity : 0); };
    this._a = { x: 0, y: 0, z: 0 };
  }
  spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, gnd) {
    if (this.n >= this.cap) return -1; const i = this.n++;
    this.kind[i] = kind; this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.al[i] = a; this.seed[i] = Math.random(); this.gnd[i] = gnd; this.spin[i] = Math.random() * 6.283; this.rest[i] = 0;
    return i;
  }
  kill(i) { const l = --this.n; if (i !== l) { for (const f of this.fields) f[i] = f[l]; this.kind[i] = this.kind[l]; } }
  // field: the wash (may be off); wx, wy, wz: the wind near the ground; groundAt(x, z, yProbe)
  step(dt, field, wx, wy, wz, groundAt) {
    const a = this._a, on = field.on, fr = this.frame++; this.t += dt; const t = this.t;
    for (let i = this.n - 1; i >= 0; i--) {
      const age = (this.age[i] += dt); if (age >= this.life[i]) { this.kill(i); continue; }
      const k = this.kind[i], x = this.px[i], y = this.py[i], z = this.pz[i], g = this.gnd[i], sd = this.seed[i];
      if (on) field.vel(x, y, z, a); else a.x = a.y = a.z = 0;
      const sh = Math.min(1, 0.35 + Math.max(0, y - g) / 12);                 // the wind is slower close to the ground
      let ax = a.x + wx * sh, ay = a.y + wy * sh, az = a.z + wz * sh;
      if (CLS[k] === 0) {
        const sp = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z), tu = 0.35 + 0.22 * sp, p1 = sd * 91.7 + t * (1.3 + sd), p2 = sd * 57.1 - t * (1.7 - sd * 0.6);
        ax += Math.sin(p1 + z * 0.41) * tu; ay += Math.sin(p2 + x * 0.37) * tu * 0.7 + (k === SMOKE ? 0 : 0.12 * sp); az += Math.cos(p1 * 0.83 + x * 0.33 + y * 0.5) * tu;
        const r = Math.min(1, RESP[k] * dt);
        this.vx[i] += (ax - this.vx[i]) * r; this.vy[i] += (ay - this.vy[i]) * r + BUOY[k] * dt; this.vz[i] += (az - this.vz[i]) * r;
        const s = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(age / this.life[i]);
        let ny = y + this.vy[i] * dt; const lo = g + 0.22 * s; if (ny < lo) { ny = lo; if (this.vy[i] < 0) this.vy[i] = 0; }
        this.px[i] = x + this.vx[i] * dt; this.py[i] = ny; this.pz[i] = z + this.vz[i] * dt;
        if (((i + fr) & 15) === 0) {      // now and then: what is under it now? off a roof's edge the ground falls away; a wall stops it
          const g2 = groundAt(this.px[i], this.pz[i], ny + 1);
          if (g2 > ny + 1.5) { this.vx[i] *= -0.25; this.vz[i] *= -0.25; this.vy[i] += 1.2; this.px[i] = x; this.pz[i] = z; } else if (g2 < g - 0.3 || g2 > g + 0.05) this.gnd[i] = g2;
        }
      } else if (CLS[k] === 1) {
        let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
        const rx = ax - vx, ry = ay - vy, rz = az - vz, rl = Math.sqrt(rx * rx + ry * ry + rz * rz), heavy = k === GRIT ? 0.35 : 1;
        if (y <= g + 0.035) {
          const rh = Math.sqrt(rx * rx + rz * rz), need = (k === GRIT ? 7 : 2.2) + sd * 3.5;
          if (rh > need) {      // it skitters: dragged along, catching and letting go, hopping when a gust gets under it
            const kk = 1.5 * heavy * dt; vx += rx * kk; vz += rz * kk; vx *= 1 - 1.2 * dt; vz *= 1 - 1.2 * dt;
            if (Math.random() < dt * (rh - need) * 0.5) vy = (0.4 + Math.random() * rh * 0.16 * heavy) * (k !== GRIT && sd > 0.72 ? 3.2 : 1);      // (grass_01) some leaves are caught and go up well above the rotor
            this.rest[i] = 0;
          } else { vx *= 1 - Math.min(1, 7 * dt); vz *= 1 - Math.min(1, 7 * dt); this.rest[i] += dt; if (this.rest[i] > 1.2 && this.life[i] > age + 1.2) this.life[i] = age + 1.2; }
          if (vy < 0) vy = 0; this.py[i] = g + 0.02 + (vy > 0 ? vy * dt : 0);
        } else {
          const kd = (k === GRIT ? 0.12 : 0.42) * rl * dt; vx += rx * kd; vy += ry * kd - 9.81 * dt; vz += rz * kd;
          const fl = (k === GRIT ? 0 : 1.6) * dt; vx += Math.sin(t * 9 + sd * 50) * fl; vz += Math.cos(t * 8 + sd * 70) * fl;
          let ny = y + vy * dt; if (ny <= g + 0.02) { ny = g + 0.02; vy = vy < -2.5 ? -vy * 0.2 : 0; vx *= 0.7; vz *= 0.7; }
          this.py[i] = ny; this.rest[i] = 0;
        }
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.px[i] = x + vx * dt; this.pz[i] = z + vz * dt;
        this.spin[i] += (0.6 + sd * 1.4) * Math.min(Math.sqrt(vx * vx + vy * vy + vz * vz), 12) * dt * 2.2;
        if (((i + fr) & 31) === 0) { const g2 = groundAt(this.px[i], this.pz[i], this.py[i] + 0.6); if (g2 > this.py[i] + 1) { this.vx[i] *= -0.3; this.vz[i] *= -0.3; this.px[i] = x; this.pz[i] = z; } else this.gnd[i] = g2; }
      } else {
        let vx = this.vx[i], vy = this.vy[i] - 9.81 * dt, vz = this.vz[i];
        if (k === DROP) { const r = Math.min(1, 3.0 * dt); vx += (ax - vx) * r; vy += (ay - vy) * r * 0.6; vz += (az - vz) * r; } else { const d = 1 - 0.9 * dt; vx *= d; vy *= d; vz *= d; }
        let ny = y + vy * dt;
        if (ny < g) { if (k === DROP) { this.kill(i); continue; } ny = g; vy = -vy * 0.3; vx *= 0.55; vz *= 0.55; this.life[i] = Math.min(this.life[i], age + 0.25); }
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz; this.px[i] = x + vx * dt; this.py[i] = ny; this.pz[i] = z + vz * dt;
      }
    }
  }
  // once per drawn frame: sort far to near and write the instance buffer
  fill(cam) {
    const n = this.n, mesh = this.mesh; mesh.visible = n > 0; if (!n) return;
    const set = this.sets[(this.turn = (this.turn + 1) % 3)]; mesh.geometry = set.g; set.g.instanceCount = n; this.buf = set.buf;
    const e = cam.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10], cx = cam.position.x, cy = cam.position.y, cz = cam.position.z, key = this.key, cnt = this.count, ord = this.order;
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < n; i++) { const d = (this.px[i] - cx) * fx + (this.py[i] - cy) * fy + (this.pz[i] - cz) * fz; key[i] = d; if (d < lo) lo = d; if (d > hi) hi = d; }
    const sc = 255.99 / Math.max(hi - lo, 1e-3); cnt.fill(0);
    for (let i = 0; i < n; i++) cnt[256 - ((key[i] - lo) * sc | 0)]++;             // bucket 0 = farthest
    for (let b = 1; b <= 256; b++) cnt[b] += cnt[b - 1];
    for (let i = 0; i < n; i++) { const b = 255 - ((key[i] - lo) * sc | 0); ord[cnt[b]++] = i; }
    const B = this.buf;
    for (let j = 0; j < n; j++) {
      const i = ord[j], o = j * STRIDE, k = this.kind[i], cls = CLS[k], u = this.age[i] / this.life[i], sd = this.seed[i];
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(u);
      let a = this.al[i];
      B[o] = this.px[i]; B[o + 1] = this.py[i]; B[o + 2] = this.pz[i]; B[o + 3] = s;
      B[o + 4] = this.cr[i]; B[o + 5] = this.cg[i]; B[o + 6] = this.cb[i];
      B[o + 8] = cls + SHAPE[k]; B[o + 9] = sd; B[o + 10] = this.gnd[i]; B[o + 11] = u;
      if (cls === 0) {
        a *= Math.min(1, u * 9 + 0.05) * (1 - u) * (1 - u * u) * 1.6;
        const sk = 0.16 * (1 - u); B[o + 12] = this.vx[i] * sk; B[o + 13] = this.vy[i] * sk; B[o + 14] = this.vz[i] * sk; B[o + 15] = sd * 6.283 + u * (sd - 0.5) * 1.6;
      } else if (cls === 1) {
        a *= Math.min(1, this.age[i] * 8) * Math.min(1, (this.life[i] - this.age[i]) * 1.2);
        const fly = Math.min(1, Math.max(0, (this.py[i] - this.gnd[i] - 0.03) * 8) + Math.sqrt(this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i]) * 0.12), tl = this.spin[i] * fly + (1 - fly) * 0.08 * Math.sin(sd * 40), az = sd * 6.283 + this.spin[i] * 0.37 * fly;
        B[o + 12] = this.vx[i] * 0.012; B[o + 13] = this.vy[i] * 0.012; B[o + 14] = this.vz[i] * 0.012; B[o + 15] = tl; B[o + 11] = az;      // the blur of a 1/80 s exposure
      } else {
        a *= Math.min(1, (1 - u) * 3);
        const st = k === SPARK ? 0.028 : 0.012;                       // the length a bright thing streaks in one exposure
        const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i], l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1, len = Math.max(s, l * st);
        B[o + 12] = vx / l * len; B[o + 13] = vy / l * len; B[o + 14] = vz / l * len; B[o + 15] = 0; B[o + 8] = k === SPARK ? 3 : 2;
      }
      B[o + 7] = a;
    }
    const ib = set.ib; ib.clearUpdateRanges(); ib.addUpdateRange(0, n * STRIDE); ib.needsUpdate = true;
    const sun = this.world.sun, U = this.uniforms;
    if (sun && sun.shadow && sun.shadow.map) { U.tShadow.value = sun.shadow.map.texture; U.uShadowM.value.copy(sun.shadow.matrix); U.uShadowOn.value = 1; } else U.uShadowOn.value = 0;
  }
}
