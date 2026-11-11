// ground.js: what the wash does to the surface itself, as one thin disc laid on the ground under the rotor that only brightens or darkens
// what is already drawn there (it multiplies the lit ground, so sun and shadow stay exactly as they were):
//   on a lawn    the grass pressed flat shows its paler side in streaks that race outward from under the rotor
//   on paving    thin streamers of dust and grit snaking outward along the ground
// It follows the point where the wake meets the surface, fades with the speed of the air, and is switched off vertex by vertex where the
// ground is not at that height (a roof's edge, a wall, water), so it never hangs in the air.
import * as THREE from 'three';

const NR = 12, NS = 48;
export class GroundWash {
  constructor(world) {
    const P = [], I = [];
    for (let j = 0; j <= NR; j++) for (let i = 0; i < NS; i++) { const a = i / NS * Math.PI * 2; P.push(Math.cos(a), Math.sin(a), j / NR); }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NS; i++) { const a = j * NS + i, b = j * NS + (i + 1) % NS, c = a + NS, d = b + NS; I.push(a, c, d, a, d, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    this.on = new Float32Array((NR + 1) * NS); this.aOn = new THREE.BufferAttribute(this.on, 1); this.aOn.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aOn', this.aOn);
    this.uniforms = { uC: { value: new THREE.Vector4() }, uQ: { value: new THREE.Vector4(5.3, 0, 0, 0) }, uL: { value: new THREE.Vector2() } };
    const m = (this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: `attribute float aOn; uniform vec4 uC; uniform vec4 uQ; varying vec3 vL; varying float vOn;
        void main() { float r = uQ.x * (0.2 + 4.2 * position.z); vL = vec3(position.xy * r, position.z); vOn = aOn; gl_Position = projectionMatrix * viewMatrix * vec4(uC.x + vL.x, uC.y + 0.03, uC.z + vL.y, 1.0); }`,
      fragmentShader: `uniform vec4 uC; uniform vec4 uQ; uniform vec2 uL; varying vec3 vL; varying float vOn;
        float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float nn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float d = length(vL.xy), x = d / uQ.x, t = uQ.y; vec2 er = vL.xy / max(d, 0.01);
          vec2 e0 = er;
          float s = clamp(uC.w * (x < 1.0 ? x : exp(-(x - 1.0) / 1.3)) * max(0.15, 1.0 + 1.3 * dot(e0, uL)) / 15.0, 0.0, 1.2) * smoothstep(0.0, 0.08, vOn) * smoothstep(1.0, 0.8, vL.z) * smoothstep(0.2, 0.9, x);
          if (s < 0.01 && (uQ.z > 0.5 || x > 4.3)) discard;
          // streaks that keep their bearing and wander slowly; pulses that run out along them
          float a1 = nn(er * 13.0 + vec2(t * 0.11, -t * 0.07)), a2 = nn(er * 41.0 + 3.0 + vec2(-t * 0.19, t * 0.13)), a3 = nn(er * 110.0 + 9.0);
          float p1 = nn(vec2(d * 0.55 - t * 5.5, a1 * 5.0)), p2 = nn(vec2(d * 1.7 - t * 9.0, a2 * 9.0 + 4.0)), fine = nn(vL.xy * 14.0 - er * t * 6.0);
          float k, base;
          if (uQ.z > 0.5) {      // lawn
            // soft streaks that lie along the flow and drift outward, turning a little with distance so no ray is ruler-straight
            float n1 = nn(e0 * 16.0 + (d * 0.22 - t * 2.6) * vec2(0.8, -0.6)), n2 = nn(e0 * 47.0 + 3.0 + (d * 0.5 - t * 5.5) * vec2(-0.5, 0.85));
            float st = smoothstep(0.35, 0.8, n1 * 0.6 + n2 * 0.4) * (0.55 + 0.45 * fine);
            k = s * (0.16 + 0.85 * st); base = 1.0 - 0.16 * s * (1.0 - st);          // the whole pressed disc is paler; the streaks paler still
            gl_FragColor = vec4(vec3(1.0, 1.06, 0.86) * k, base);
          } else {               // paving, roof
            float st = smoothstep(0.5, 0.85, a2 * 0.5 + a3 * 0.3 + a1 * 0.2) * smoothstep(0.35, 0.7, p2) + 0.5 * smoothstep(0.6, 0.9, a3) * p1;
            k = s * (0.3 + 0.7 * uQ.w) * (0.7 * st * (0.6 + 0.8 * fine));
            base = 1.0 - 0.05 * s - 0.2 * uQ.w * min(1.0, uC.w / 12.0) * smoothstep(0.9, 1.7, x) * smoothstep(4.3, 2.6, x) * smoothstep(0.0, 0.08, vOn) * (0.6 + 0.6 * a1);   // the dust ring's own shade on the ground
            gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * k, base);
          }
        }` }));
    const mesh = (this.mesh = new THREE.Mesh(g, m)); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.name = 'heli_wash_ground';
    mesh.onBeforeRender = (r, sc, cam, geo, mat) => { geo.setDrawRange(0, mat === m && cam === world.camera ? Infinity : 0); };
    this.lx = 1e9; this.lz = 1e9; this.n = 0;
  }
  // U: outwash speed (already eased); kind: 1 lawn, 0 paving or roof; dusty: how much loose dust (0..1); flat(x, z): is the ground at the wash's height there
  update(fl, U, t, kind, dusty, flat, lift = 0) {
    const show = U > 2; this.mesh.visible = show; if (!show) return;
    const Q = this.uniforms; Q.uC.value.set(fl.cx, fl.cy + lift, fl.cz, U); Q.uQ.value.set(fl.R, t, kind, dusty); Q.uL.value.set(fl.lx, fl.lz);
    if (Math.abs(fl.cx - this.lx) + Math.abs(fl.cz - this.lz) > 0.4 || (this.n++ & 31) === 0) {
      this.lx = fl.cx; this.lz = fl.cz; const on = this.on;
      for (let j = 0; j <= NR; j++) { const r = fl.R * (0.2 + 4.2 * j / NR); for (let i = 0; i < NS; i++) { const a = i / NS * Math.PI * 2; on[j * NS + i] = flat(fl.cx + Math.cos(a) * r, fl.cz + Math.sin(a) * r) ? 1 : 0; } }
      this.aOn.needsUpdate = true;
    }
  }
}
