// heat.js: the shimmer of hot gas behind the turbine exhaust. A short trail of small camera-facing quads, each showing the picture behind it
// pushed about by a few pixels. The picture it bends is the frame before (the game's own scene buffer, already there: nothing is drawn
// twice and there is no full-screen pass). One draw call, at most 24 quads, drawn only close to the aircraft with the engine alight.
// It needs the scene-referred frame of the last draw, which the game keeps while it runs with multisampling; when live play has
// dropped to FXAA that buffer holds the finished picture instead, and the shimmer is left out.
import * as THREE from 'three';

const N = 24, STRIDE = 8;
export class Heat {
  constructor(world) {
    this.world = world; this.n = 0; this.acc = 0;
    const F = () => new Float32Array(N); this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F(); this.age = F(); this.life = F(); this.seed = F(); this.str = F();
    this.fields = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.seed, this.str];
    // three buffers in turn, as in particles.js (never write the buffer the last frame is still being drawn from)
    const quad = new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3), idx = new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1);
    this.sets = [0, 1, 2].map(() => { const buf = new Float32Array(N * STRIDE), g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', quad); g.setIndex(idx);
      const ib = new THREE.InstancedInterleavedBuffer(buf, STRIDE, 1); ib.setUsage(THREE.StreamDrawUsage);
      g.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 4, 4)); g.instanceCount = 0; return { buf, g, ib }; });
    this.turn = 0; const g = this.sets[0].g;
    this.uniforms = { tPrev: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: world.shared.uTime };
    const m = (this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 aA; attribute vec4 aB; varying vec2 vUv; varying vec3 vB;
        void main() { vec3 c = aA.xyz; vec3 toCam = normalize(cameraPosition - c), r = normalize(cross(vec3(0.0, 1.0, 0.0), toCam)), u = cross(toCam, r);
          vec4 mv = viewMatrix * vec4(c + (r * position.x + u * position.y) * aA.w, 1.0); vUv = position.xy; vB = vec3(aB.x, aB.y, 0.02 * projectionMatrix[1][1] / max(-mv.z, 0.5)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D tPrev; uniform vec2 uRes; uniform float uTime; varying vec2 vUv; varying vec3 vB;
        float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float nn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float m = smoothstep(0.5, 0.12, length(vUv)) * vB.x; if (m < 0.004) discard;
          vec2 q = vUv * 5.0 + vB.y * 31.0, w = vec2(nn(q + vec2(0.0, -uTime * 7.0)) + 0.5 * nn(q * 2.3 + vec2(uTime * 3.0, -uTime * 13.0)), nn(q.yx + vec2(4.0, uTime * 6.0)) + 0.5 * nn(q.yx * 2.1 - vec2(uTime * 11.0, 2.0))) - 0.75;
          vec2 uv = gl_FragCoord.xy / uRes + w * m * vB.z * vec2(uRes.y / uRes.x, 1.0);
          gl_FragColor = vec4(texture2D(tPrev, uv).rgb, min(1.0, m * 2.2) * 0.7);
        }` }));
    const mesh = (this.mesh = new THREE.Mesh(g, m)); mesh.frustumCulled = false; mesh.renderOrder = 60; mesh.visible = false; mesh.matrixAutoUpdate = false; mesh.name = 'heli_wash_heat';
    // only in the game's own scene draw into the composer's buffer: never in the street mirror, the shadow or the screen-space passes
    mesh.onBeforeRender = (r, sc, cam, geo, mat) => { geo.setDrawRange(0, mat === m && this.target && r.getRenderTarget() === this.target ? Infinity : 0); };
  }
  // x, y, z: the exhaust; dx, dy, dz: where the gas goes (m/s); k: how hot (0..1)
  step(dt, x, y, z, dx, dy, dz, k) {
    for (let i = this.n - 1; i >= 0; i--) {
      if ((this.age[i] += dt) >= this.life[i]) { const l = --this.n; if (i !== l) for (const f of this.fields) f[i] = f[l]; continue; }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt; const d = 1 - 2.2 * dt; this.vx[i] *= d; this.vz[i] *= d; this.vy[i] = this.vy[i] * d + 1.6 * dt;
    }
    if (k <= 0.02) return;
    this.acc += dt * 32;
    while (this.acc >= 1) { this.acc -= 1; if (this.n >= N) break; const i = this.n++;
      this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = dx + (Math.random() - 0.5) * 1.5; this.vy[i] = dy + (Math.random() - 0.5) * 1.5; this.vz[i] = dz + (Math.random() - 0.5) * 1.5; this.age[i] = 0; this.life[i] = 0.45 + Math.random() * 0.3; this.seed[i] = Math.random(); this.str[i] = k; }
  }
  fill(show) {
    const w = this.world, n = show ? this.n : 0, comp = w.composer;
    const ok = n > 0 && comp && !(w.fxaa && w.fxaa.enabled); this.mesh.visible = !!ok; if (!ok) { this.target = null; return; }
    const set = this.sets[(this.turn = (this.turn + 1) % 3)], B = set.buf; this.mesh.geometry = set.g; set.g.instanceCount = n;
    for (let i = 0; i < n; i++) { const o = i * STRIDE, u = this.age[i] / this.life[i];
      B[o] = this.px[i]; B[o + 1] = this.py[i]; B[o + 2] = this.pz[i]; B[o + 3] = 0.45 + 1.5 * u; B[o + 4] = this.str[i] * Math.min(1, u * 6) * (1 - u) * (1 - u); B[o + 5] = this.seed[i]; }
    const ib = set.ib; ib.clearUpdateRanges(); ib.addUpdateRange(0, n * STRIDE); ib.needsUpdate = true;
    this.target = comp.readBuffer; this.uniforms.tPrev.value = comp.writeBuffer.texture; this.uniforms.uRes.value.set(comp.writeBuffer.width, comp.writeBuffer.height);
  }
}
