// ground.js: what the wash does to a LAWN, as one thin disc laid on the turf under the rotor that only brightens or darkens what is already
// drawn there (it multiplies the lit ground, so sun, shadow and the turf's own texture stay exactly as they were). Nothing is drawn on paving
// or roofs: a real helicopter leaves no mark on a clean hard surface.
//   mown grass under a rotor is pressed over, pointing away from the aircraft. Laid grass shows the way a mowing stripe does: seen from the
//   side it leans AWAY from, the blades' backs catch the sky and it is paler; seen from the side it leans TOWARD, you look into the stubble
//   and it is darker. So the far half of the disc pales and the near half deepens, whatever the bearing of the camera.
//   it does not lie still: the air comes in gusts a metre or so across that run outward with the flow, and where one passes the grass goes
//   flatter (paler / darker still); between them it half stands again. Up close the laid blades read as short combed strokes along the flow.
// The gust pattern is fixed to the ground and CARRIED by the air (two copies half a period apart, cross-faded, as wash/cloud.js does its grain),
// so what is seen to move outward is the pattern itself. No straight rays: nothing here is a function of bearing alone.
// It follows the point where the wake meets the surface, fades with the speed of the air, and is switched off vertex by vertex where the
// ground is not lawn at that height (a path's kerb, a wall, water), so it never hangs in the air.
import * as THREE from 'three';

const NR = 14, NS = 56;
export class GroundWash {
  constructor(world) {
    const P = [], I = [];
    for (let j = 0; j <= NR; j++) for (let i = 0; i < NS; i++) { const a = i / NS * Math.PI * 2; P.push(Math.cos(a), Math.sin(a), j / NR); }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NS; i++) { const a = j * NS + i, b = j * NS + (i + 1) % NS, c = a + NS, d = b + NS; I.push(a, c, d, a, d, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    this.on = new Float32Array((NR + 1) * NS); this.aOn = new THREE.BufferAttribute(this.on, 1); this.aOn.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aOn', this.aOn);
    // uC: centre x, y, z; outwash speed. uQ: rotor radius; time; strength of the whole effect (0..1.5); unused. uL: the wake's lean x, z
    this.uniforms = { uC: { value: new THREE.Vector4() }, uQ: { value: new THREE.Vector4(5.3, 0, 1, 0) }, uL: { value: new THREE.Vector2() } };
    let gain = 1; try { const q = new URLSearchParams(location.search).get('wg'); if (q !== null && isFinite(+q)) gain = +q; } catch (e) { /* no page address */ }
    this.gain = gain;
    const m = (this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: `attribute float aOn; uniform vec4 uC; uniform vec4 uQ; varying vec3 vL; varying float vOn; varying vec3 vW;
        void main() { float r = uQ.x * (0.05 + 4.35 * position.z); vL = vec3(position.xy * r, position.z); vOn = aOn; vW = vec3(uC.x + vL.x, uC.y + 0.03, uC.z + vL.y); gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: `uniform vec4 uC; uniform vec4 uQ; uniform vec2 uL; varying vec3 vL; varying float vOn; varying vec3 vW;
        float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float nn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
        // short combed strokes lying along direction e (unit), in world metres: about 3 cm across, 14 cm long
        float comb(vec2 w, vec2 e) { vec2 q = vec2(dot(w, e) * 7.0, dot(w, vec2(-e.y, e.x)) * 30.0); return nn(q) * 0.65 + nn(q * 2.3 + 7.1) * 0.35; }
        void main() {
          float d = length(vL.xy), x = d / uQ.x, t = uQ.y; vec2 er = vL.xy / max(d, 0.01);
          float prof = x < 1.0 ? x * (0.35 + 0.65 * x) : exp(-(x - 1.0) / 1.3);                      // little wind right under the hub
          float u = uC.w * prof * max(0.15, 1.0 + 1.3 * dot(er, uL));                                  // m/s along the grass here
          float edge = smoothstep(0.0, 0.08, vOn) * smoothstep(1.0, 0.8, vL.z);
          float s = smoothstep(3.0, 13.0, u) * edge * uQ.z;                                            // mown grass hardly stirs below a few metres a second
          if (s < 0.004) discard;
          // the gusts: a pattern on the ground carried outward by the air, two copies half a period apart
          const float TT = 0.7; float f1 = fract(t / TT), f2 = fract(t / TT + 0.5), w1 = 1.0 - abs(2.0 * f1 - 1.0), cu = 0.32 * u;
          vec2 p1 = vW.xz - er * (cu * (f1 - 0.5) * TT), p2 = vW.xz - er * (cu * (f2 - 0.5) * TT) + 17.3;
          float g1 = nn(p1 * 0.75) * 0.6 + nn(p1 * 1.9 + 3.1) * 0.4, g2 = nn(p2 * 0.75) * 0.6 + nn(p2 * 1.9 + 3.1) * 0.4;
          float gust = smoothstep(0.34, 0.72, mix(g2, g1, w1));
          float rip = mix(nn(p2 * vec2(5.5, 5.5)), nn(p1 * vec2(5.5, 5.5)), w1);                       // the shiver inside a gust, a hand's width across
          // the combed strokes, along the flow: two fixed frames either side of this bearing, blended (a frame that turned with the bearing would draw rays)
          float a = atan(er.y, er.x) * 2.5464790895, a0 = floor(a), af = a - a0; af = af * af * (3.0 - 2.0 * af);
          float b0 = a0 * 0.3926990817, b1 = (a0 + 1.0) * 0.3926990817;
          float fine = mix(comb(vW.xz, vec2(cos(b0), sin(b0))), comb(vW.xz, vec2(cos(b1), sin(b1))), af);
          float dv = length(cameraPosition - vW); fine = mix(0.5, fine, 1.0 / (1.0 + dv * dv * 0.004));    // far off the strokes are smaller than a pixel
          float lay = s * (0.22 + 0.78 * gust) * (0.8 + 0.4 * rip);                                  // how flat the grass lies here, 0..1
          // seen from the side it leans away from it pales, from the side it leans toward it darkens (and steeply seen it does neither much)
          vec3 V = cameraPosition - vW; float vh = length(V.xz); vec2 vd = V.xz / max(vh, 0.01);
          float away = -dot(er, vd), graze = vh / max(length(V), 0.01);
          float pale = lay * (0.10 + 0.30 * max(away, 0.0) * graze) * (0.8 + 0.4 * fine);
          float dark = lay * (0.05 + 0.20 * max(-away, 0.0) * graze) * (1.15 - 0.3 * fine);
          gl_FragColor = vec4(vec3(1.0, 1.03, 0.80) * pale, 1.0 - dark);
        }` }));
    const mesh = (this.mesh = new THREE.Mesh(g, m)); mesh.frustumCulled = false; mesh.renderOrder = 8; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.name = 'heli_wash_ground';
    mesh.onBeforeRender = (r, sc, cam, geo, mat) => { geo.setDrawRange(0, mat === m && cam === world.camera ? Infinity : 0); };
    this.lx = 1e9; this.lz = 1e9; this.n = 0;
  }
  // U: outwash speed (already eased); kind: 1 lawn, anything else draws nothing; flat(x, z): is the ground lawn at the wash's height there
  update(fl, U, t, kind, dusty, flat, lift = 0) {
    const show = U > 3 && kind === 1 && this.gain > 0; this.mesh.visible = show; if (!show) return;
    const Q = this.uniforms; Q.uC.value.set(fl.cx, fl.cy + lift, fl.cz, U); Q.uQ.value.set(fl.R, t, this.gain, 0); Q.uL.value.set(fl.lx, fl.lz);
    if (Math.abs(fl.cx - this.lx) + Math.abs(fl.cz - this.lz) > 0.4 || (this.n++ & 31) === 0) {
      this.lx = fl.cx; this.lz = fl.cz; const on = this.on;
      for (let j = 0; j <= NR; j++) { const r = fl.R * (0.05 + 4.35 * j / NR); for (let i = 0; i < NS; i++) { const a = i / NS * Math.PI * 2; on[j * NS + i] = flat(fl.cx + Math.cos(a) * r, fl.cz + Math.sin(a) * r) ? 1 : 0; } }
      this.aOn.needsUpdate = true;
    }
  }
}
