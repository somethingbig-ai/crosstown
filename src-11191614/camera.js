// camera.js: the CAMERA lane (lanes/camera). Whole-frame rules only: temporal anti-aliasing, and the camera's picture processing.
// Hook: one line at the end of World.setupPost():  installCamera(this, Q, LIGHT);   Off switch: ?cam=0 (the old chain, nothing here runs).
// Parts: ?taa=0 keeps FXAA; ?grade=0 keeps the light lane's film pass as it was.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// Temporal anti-aliasing. The camera is nudged by a fraction of a pixel each frame (16-step Halton), and each frame is blended into a
// history picture that is carried along with the camera (re-projected through the depth buffer). The history is clipped to the colours
// found around the pixel this frame, so moving cars and swaying leaves do not trail. Runs in scene-referred light, before bloom and the camera.
class TAAPass extends Pass {
  constructor(world) {
    super(); this.world = world; this.needsSwap = true; this.frame = 0; this.valid = false; this.i = 0; this.up = false; this.out = null; this.low = [4, 4]; this.jsign = 1;
    const o = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.hist = [new THREE.WebGLRenderTarget(4, 4, o), new THREE.WebGLRenderTarget(4, 4, o)];
    this.reproj = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4(); this.curVP = new THREE.Matrix4(); this.tmp = new THREE.Matrix4();
    this.mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
      uniforms: { uCab: { value: 0 }, tCur: { value: null }, tDepth: { value: null }, tHist: { value: null }, uReproj: { value: this.reproj }, uRes: { value: new THREE.Vector2(4, 4) }, uAlpha: { value: 0.1 }, uValid: { value: 0 }, uGamma: { value: 1.2 }, uLow: { value: new THREE.Vector2(4, 4) }, uJit: { value: new THREE.Vector2() }, uUp: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tCur, tDepth, tHist; uniform mat4 uReproj; uniform vec2 uRes, uLow, uJit; uniform float uAlpha, uValid, uGamma, uUp, uCab; varying vec2 vUv;
        vec3 tm(vec3 c){ return c / (1.0 + max(c.r, max(c.g, c.b))); }
        vec3 itm(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
        vec3 histCR(vec2 uv){     // Catmull-Rom in five reads: keeps the history from going soft as it is re-sampled every frame
          vec2 sp = uv * uRes, tc = floor(sp - 0.5) + 0.5, f = sp - tc;
          vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
          vec2 w12 = w1 + w2, t0 = (tc - 1.0) / uRes, t3 = (tc + 2.0) / uRes, t12 = (tc + w2 / w12) / uRes;
          vec4 c = vec4(tm(texture2D(tHist, vec2(t12.x, t0.y)).rgb), 1.0) * (w12.x * w0.y) + vec4(tm(texture2D(tHist, vec2(t0.x, t12.y)).rgb), 1.0) * (w0.x * w12.y)
                 + vec4(tm(texture2D(tHist, t12).rgb), 1.0) * (w12.x * w12.y) + vec4(tm(texture2D(tHist, vec2(t3.x, t12.y)).rgb), 1.0) * (w3.x * w12.y)
                 + vec4(tm(texture2D(tHist, vec2(t12.x, t3.y)).rgb), 1.0) * (w12.x * w3.y);
          return max(c.rgb / c.a, 0.0);
        }
        void main(){
          // uLow = the size the scene was drawn at, uRes = the size of the history and of the finished picture (larger when the picture is
          // rebuilt from a smaller scene: uUp 1). This frame's scene is read where the nudge put this pixel (uJit, in uv).
          vec2 px = 1.0 / uLow, cu = vUv + uJit * uUp;
          vec2 lp = cu * uLow, tc = floor(lp) + 0.5, dd = (tc - lp) * (uRes / uLow); float near = exp(-1.4 * dot(dd, dd));   // how close this frame's nearest scene sample lies to this pixel (in finished pixels)
          vec2 su = mix(vUv, tc / uLow, uUp);
          vec3 c = tm(texture2D(tCur, su).rgb), m1 = c, m2 = c * c, s;
          s = tm(texture2D(tCur, su + vec2(-px.x, 0.0)).rgb); m1 += s; m2 += s * s;  s = tm(texture2D(tCur, su + vec2(px.x, 0.0)).rgb); m1 += s; m2 += s * s;
          s = tm(texture2D(tCur, su + vec2(0.0, -px.y)).rgb); m1 += s; m2 += s * s;  s = tm(texture2D(tCur, su + vec2(0.0, px.y)).rgb); m1 += s; m2 += s * s;
          s = tm(texture2D(tCur, su + vec2(-px.x, -px.y)).rgb); m1 += s; m2 += s * s;  s = tm(texture2D(tCur, su + vec2(px.x, -px.y)).rgb); m1 += s; m2 += s * s;
          s = tm(texture2D(tCur, su + vec2(-px.x, px.y)).rgb); m1 += s; m2 += s * s;  s = tm(texture2D(tCur, su + px).rgb); m1 += s; m2 += s * s;
          m1 /= 9.0; vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
          // the nearest surface around the pixel carries the edge along with the object in front
          float d = texture2D(tDepth, su).x;
          d = min(d, min(min(texture2D(tDepth, su + vec2(-px.x, -px.y)).x, texture2D(tDepth, su + vec2(px.x, -px.y)).x), min(texture2D(tDepth, su + vec2(-px.x, px.y)).x, texture2D(tDepth, su + px).x)));
          vec4 p = uReproj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec2 huv = p.xy / p.w * 0.5 + 0.5;
          if (uCab > 0.5 && d < 0.9999999) huv = vUv;     // seated in the helicopter: the cabin is drawn over a cleared depth buffer and rides with the eye, so its history is where it was on screen (the city behind it is carried as if far away)
          float a = uAlpha * mix(1.0, 0.25 + 1.5 * near, uUp); if (uValid < 0.5 || p.w <= 0.0 || huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) { a = 1.0; c = tm(texture2D(tCur, cu).rgb); }
          vec3 h = a < 1.0 ? histCR(huv) : c;
          vec3 dl = h - m1, k3 = abs(dl) / max(uGamma * mix(1.0, 1.25, uUp) * sd, vec3(1e-4)); float k = max(k3.x, max(k3.y, k3.z)); if (k > 1.0) h = m1 + dl / k;
          gl_FragColor = vec4(itm(mix(h, c, a)), 1.0);
        }` });
    this.copy = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { t: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }' });
    this.quad = new FullScreenQuad(this.mat);
  }
  // the composer calls setSize with the scene's size; setOut gives the finished picture's size when that is larger (the picture rebuilt from a smaller scene)
  setSize(w, h) { this.low = [w, h]; this.mat.uniforms.uLow.value.set(w, h); this.fitHist(); }
  setOut(w, h) { this.out = w ? [w, h] : null; this.fitHist(); }
  fitHist() { const [w, h] = this.up && this.out ? this.out : this.low || [4, 4]; if (this.hist[0].width !== w || this.hist[0].height !== h) { for (const r of this.hist) r.setSize(w, h); this.valid = false; } this.mat.uniforms.uRes.value.set(w, h); this.mat.uniforms.uUp.value = this.up && this.out ? 1 : 0; this.needsSwap = !(this.up && this.out); }
  // called once a frame before the scene is drawn: the sub-pixel nudge, and the matrix that carries last frame's picture to this frame's camera
  begin(cam, nearCam) {
    const [w, h] = this.low; this.frame++;
    cam.updateMatrixWorld(); this.tmp.copy(cam.matrixWorld).invert(); this.curVP.multiplyMatrices(cam.projectionMatrix, this.tmp);
    this.reproj.copy(this.curVP).invert().premultiply(this.prevVP); this.prevVP.copy(this.curVP);
    const k = this.frame % 16 + 1, jx = halton(k, 2) - 0.5, jy = halton(k, 3) - 0.5;
    cam.setViewOffset(w, h, jx, jy, w, h); if (nearCam) nearCam.setViewOffset(w, h, jx, jy, w, h);
    this.mat.uniforms.uJit.value.set(-jx / w * this.jsign, jy / h * this.jsign);     // moving the view window right and down moves the picture left and up
  }
  end(cam, nearCam) { cam.clearViewOffset(); if (nearCam) nearCam.clearViewOffset(); }
  render(renderer, writeBuffer, readBuffer) {
    const w = this.world, u = this.mat.uniforms, dst = this.hist[this.i ^= 1], src = this.hist[this.i ^ 1];
    // the scene's depth sits in the buffer the scene was drawn into: the AO pass, when it runs, has swapped that one to the write side
    const depth = (w.gtao && w.gtao.enabled ? writeBuffer : readBuffer).depthTexture || readBuffer.depthTexture || writeBuffer.depthTexture;
    this.depth = depth; if (this.cab === undefined) this.cab = true; u.uCab.value = this.cab && w.nearPass && w.nearPass.enabled ? 1 : 0; u.tCur.value = readBuffer.texture; u.tDepth.value = depth; u.tHist.value = src.texture; u.uValid.value = this.valid && depth ? 1 : 0;
    this.quad.material = this.mat; renderer.setRenderTarget(dst); this.quad.render(renderer);
    this.result = dst.texture;
    if (this.needsSwap) { this.copy.uniforms.t.value = dst.texture; this.quad.material = this.copy; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer); }     // when the picture is rebuilt larger the camera pass reads this.result itself
    this.valid = true;
  }
  dispose() { for (const r of this.hist) r.dispose(); this.mat.dispose(); this.copy.dispose(); this.quad.dispose(); }
}

export function installCamera(world, Q, LIGHT) {
  if (/^(0|off|none)$/.test(Q.get('cam') || '')) return null;
  const comp = world.composer, cam = { taa: null };
  // --- anti-aliasing: needs the scene's depth texture (the live path since Nov 10); the multisampled path keeps its own smoothing
  if (world.aoDepth && Q.get('taa') !== '0') {
    const taa = new TAAPass(world), at = comp.passes.indexOf(world.film);
    comp.insertPass(taa, at); cam.taa = taa;
    { const s = world.renderer.getDrawingBufferSize(new THREE.Vector2()); taa.setSize(s.x, s.y); }
    if (Q.has('Talpha')) taa.mat.uniforms.uAlpha.value = +Q.get('Talpha'); if (Q.has('Tgamma')) taa.mat.uniforms.uGamma.value = +Q.get('Tgamma');
    const render0 = comp.render.bind(comp);
    comp.render = (dt) => {
      const on = taa.enabled; world.fxaa.enabled = !on && world.liveAA === 'fxaa';
      if (!on) { taa.valid = false; if (world.sun) world.sun.shadow.radius = 0; return render0(dt); }
      const nc = world.nearPass && world.nearPass.enabled ? world.nearCam : null;
      // the sun shadow's per-pixel sample pattern turns with the frame, so the history averages its grain away (world.js reads shadow.radius as that turn)
      if (world.sun) world.sun.shadow.radius = (taa.frame * 0.618034) % 1;
      taa.begin(world.camera, nc); try { return render0(dt); } finally { taa.end(world.camera, nc); }
    };
    const aa0 = world.setLiveAA.bind(world);
    world.setLiveAA = (msaa) => { aa0(msaa); if (msaa) { taa.enabled = false; } else if (taa.enabled) { world.fxaa.enabled = false; world.liveAA = 'fxaa'; } };
    world.fxaa.enabled = false;
    // --- the finished picture rebuilt at full size from a smaller scene (?taau=1; cam.up(true)). The game lowers the scene's size to hold its frame
    // rate (world.liveScale, and a 2.4 megapixel cap); with this on only the scene, AO and bloom are drawn at that size: the history, the camera
    // pass and the canvas stay at the size the cap alone gives (never above 1.5x, never above cam.outPx pixels).
    cam.outPx = +Q.get('Tout') || 3.2e6; taa.jsign = Q.get('Tjs') === '-1' ? -1 : 1;
    const resize0 = world.resize.bind(world), film = world.film, fr0 = film.render.bind(film);
    film.render = (r, wb, rb, dt, mk) => { if (taa.enabled && taa.up && taa.out && taa.result) { film.textureID = 'tNone'; film.uniforms.tDiffuse.value = taa.result; } else film.textureID = 'tDiffuse'; return fr0(r, wb, rb, dt, mk); };
    world.resize = (w, h, pr) => {
      const want = taa.up && taa.enabled && !Q.has('w') && !Q.has('capture') && !Q.has('shot');
      const full = Math.max(pr, Math.min(self.devicePixelRatio || 1, 1.5, Math.sqrt(cam.outPx / (w * h))));
      if (!want || full <= pr * 1.02) { taa.setOut(0); cam._rs = [w, h, pr]; return resize0(w, h, pr); }
      resize0(w, h, pr);     // sizes the scene targets, AO, bloom (and, wrongly for now, the canvas)
      world.renderer.setPixelRatio(full); world.renderer.setSize(w, h, false);     // the canvas at full size; the composer keeps its own (smaller) pixel ratio
      const W = Math.floor(w * full), H = Math.floor(h * full); taa.setOut(W, H); film.uniforms.uRes.value.set(W, H); cam._rs = [w, h, pr];
    };
    cam.up = (on) => { taa.up = !!on; taa.fitHist(); if (cam._rs) world.resize(...cam._rs); else if (self.__fit) self.__fit(); };
    if (Q.get('taau') !== '0') taa.up = true;     // rounds 6 and 8: on by default (12 of 12 spots closer than the old chain at the live scale, twice); ?taau=0 off
  }
  // --- the camera's picture processing: the light lane's film pass, rewritten in place (same pass object and uniform names, so ?FSat=.. and the
  // gun-recoil pulses on uCA / uDist / uSat keep working). Changes: 11 texture reads instead of 27 (the colour fringe is taken from two single reads,
  // not two more whole lens kernels); a tone curve with a real toe (contrast about mid-grey in log light, uGam) ahead of the shoulder; a fine
  // sharpening term beside the wide one; a 3x3 colour matrix (uM0..2, the global colour correction). With uGam 1, uSharpF 0 and the identity
  // matrix the picture is the old one.
  if (Q.get('grade') !== '0' && world.film) {
    const f = world.film, u = f.uniforms;
    const frag0 = f.material.fragmentShader; let frag1;
    Object.assign(u, { uGam: { value: 1.0 }, uPiv: { value: 0.18 }, uSharpF: { value: 0.0 }, uGrainC: { value: 0.55 }, uM0: { value: new THREE.Vector3(1, 0, 0) }, uM1: { value: new THREE.Vector3(0, 1, 0) }, uM2: { value: new THREE.Vector3(0, 0, 1) }, tLum: { value: null }, uLtmH: { value: 0.0 }, uLtmS: { value: 0.0 }, uLtmT: { value: 1.0 }, uLtmSky: { value: 0.0 }, uHasDep: { value: 0.0 }, tDep: { value: null } });
    f.material.fragmentShader = `uniform sampler2D tDiffuse; uniform sampler2D tExp; uniform float uExpTex; uniform float uExposure, uTime, uGrain, uGrainC, uVig, uSoft, uSharp, uSharpF, uDist, uCA, uSat, uCon, uKnee, uBlack, uGam, uPiv, uLtmH, uLtmS, uLtmT, uLtmSky, uHasDep; uniform sampler2D tLum, tDep; uniform vec3 uWB, uM0, uM1, uM2; uniform vec2 uRes; varying vec2 vUv;
      float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec3 h3(vec2 p){ return vec3(h(p), h(p + 17.13), h(p + 41.71)); }
      vec3 curve(vec3 x){ vec3 t = max(x - uKnee, 0.0) / (1.0 - uKnee); vec3 hi = uKnee + (1.0 - uKnee) * mix(1.0 - exp(-t), t / (1.0 + t), 0.35); return mix(x, hi, step(uKnee, x)); }
      void main(){
        vec2 d = vUv - 0.5; vec2 da = d * vec2(uRes.x / uRes.y, 1.0); float rc = 0.25 * (uRes.x * uRes.x) / (uRes.y * uRes.y) + 0.25; float r2 = dot(da, da) / rc;   // 0 centre, 1 corner
        vec2 uv = 0.5 + d * (1.0 + uDist * (r2 - 1.0)), px = 1.0 / uRes;
        float spot = uSoft * (1.0 + 1.3 * r2);
        vec3 c0 = texture2D(tDiffuse, uv).rgb;
        vec3 n = texture2D(tDiffuse, uv + vec2( spot,  spot * 0.4) * px).rgb + texture2D(tDiffuse, uv + vec2(-spot * 0.4,  spot) * px).rgb
               + texture2D(tDiffuse, uv + vec2(-spot, -spot * 0.4) * px).rgb + texture2D(tDiffuse, uv + vec2( spot * 0.4, -spot) * px).rgb;
        vec3 wide = (texture2D(tDiffuse, uv + vec2(2.2, 0.9) * px).rgb + texture2D(tDiffuse, uv + vec2(-0.9, 2.2) * px).rgb
                   + texture2D(tDiffuse, uv + vec2(-2.2, -0.9) * px).rgb + texture2D(tDiffuse, uv + vec2(0.9, -2.2) * px).rgb) * 0.25;
        vec3 col = c0 * 0.36 + n * 0.16;
        // colour fringe: red and blue are read a little further out / in than green
        col.r += texture2D(tDiffuse, 0.5 + (uv - 0.5) * (1.0 + uCA * r2)).r - c0.r; col.b += texture2D(tDiffuse, 0.5 + (uv - 0.5) * (1.0 - uCA * r2)).b - c0.b;
        float ex = uExpTex > 0.5 ? texture2D(tExp, vec2(0.5)).r : uExposure;
        // local tone, as a phone camera's HDR does it: the brightness of the neighbourhood (a wide blur of log light) is pulled toward mid-grey,
        // the pixel keeps its difference from it, so sunlit ground comes down with its texture and shade comes up without a grey veil.
        // The neighbourhood never counts as more than uLtmT stops from the pixel itself: that bounds the halo at sky / wall edges.
        if (uLtmH + uLtmS > 0.0) { vec2 o = vec2(1.0 / 64.0, 1.0 / 36.0);
          float lb = 0.3 * (textureLod(tLum, vUv + o * vec2(1.0, 0.4), 3.0).r + textureLod(tLum, vUv + o * vec2(-0.4, 1.0), 3.0).r + textureLod(tLum, vUv + o * vec2(-1.0, -0.4), 3.0).r + textureLod(tLum, vUv + o * vec2(0.4, -1.0), 3.0).r) * 0.25
                   + 0.7 * (textureLod(tLum, vUv + o * vec2(2.0, 0.8), 4.0).r + textureLod(tLum, vUv + o * vec2(-0.8, 2.0), 4.0).r + textureLod(tLum, vUv + o * vec2(-2.0, -0.8), 4.0).r + textureLod(tLum, vUv + o * vec2(0.8, -2.0), 4.0).r) * 0.25;
          float lp = log2(max(dot(c0, vec3(0.2126, 0.7152, 0.0722)), 1e-4)); float dl = lb - lp; lb = lp + uLtmT * dl / (uLtmT + abs(dl));
          float e = clamp(lb + log2(ex / 0.18), -4.0, 4.0), hk = uLtmH;
          // the sky keeps its brightness (uLtmSky 0): a phone holds the ground and lets a clear sky run pale. Sky = nothing drawn into the depth buffer.
          if (uHasDep > 0.5) { float sk = 0.25 * (step(0.999999, texture2D(tDep, uv + vec2(0.7, 0.7) * px).x) + step(0.999999, texture2D(tDep, uv + vec2(-0.7, 0.7) * px).x) + step(0.999999, texture2D(tDep, uv + vec2(0.7, -0.7) * px).x) + step(0.999999, texture2D(tDep, uv - vec2(0.7, 0.7) * px).x)); hk *= mix(1.0, uLtmSky, sk); }
          ex *= exp2(-e * (e > 0.0 ? hk : uLtmS)); }
        col *= uWB * ex * (1.0 - uVig * r2 * r2 * 0.6 - uVig * r2 * 0.4); wide *= uWB * ex;
        col = max(col, 0.0);
        vec2 fc = gl_FragCoord.xy; float tt = fract(uTime) * 311.0;
        vec3 n1 = h3(fc + tt) + h3(fc * 1.37 + tt + 5.0) - 1.0, n2 = h3(floor(fc / 2.0) + tt + 91.0) + h3(floor(fc / 2.0 + 0.5) * 1.91 + tt) - 1.0;
        vec3 nz = mix(vec3(dot(n1, vec3(0.333))), n1, uGrainC) + 0.22 * mix(vec3(dot(n2, vec3(0.333))), n2, 0.7);
        col = max(col - uBlack, 0.0);
        // sharpening as the camera does it, on the luminance: a fine term against the near ring and a wide one that leaves the faint halo
        float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722)), lw = dot(wide, vec3(0.2126, 0.7152, 0.0722)), ln = dot(n * 0.25 * uWB * ex, vec3(0.2126, 0.7152, 0.0722)), lc = dot(c0 * uWB * ex, vec3(0.2126, 0.7152, 0.0722));
        col *= clamp(1.0 + (uSharp * (l0 - lw) + uSharpF * (lc - ln)) / max(l0, 0.02), 0.5, 1.8);
        col += nz * uGrain * sqrt(max(col, 0.0) + 0.004) / (1.0 + 2.5 * max(col, 0.0));
        col = max(vec3(dot(col, uM0), dot(col, uM1), dot(col, uM2)), 0.0);
        col = uPiv * pow(col / uPiv, vec3(uGam));
        col = curve(col);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
        col = mix(col, col * col * (3.0 - 2.0 * col), uCon);
        gl_FragColor = vec4(col, 1.0);
      }`;
    frag1 = f.material.fragmentShader; f.material.needsUpdate = true;
    // cam.old(true): the chain as it was before this lane (old film shader, FXAA), switchable while running, for like-for-like captures
    cam.old = (on) => { f.material.fragmentShader = on ? frag0 : frag1; f.material.needsUpdate = true; if (cam.taa) { cam.taa.enabled = !on; if (cam._rs) world.resize(...cam._rs); } cam.isOld = !!on; };
    cam.set = (o) => { for (const k in o) { if (u[k] && typeof u[k].value === 'number') u[k].value = o[k]; else if (u[k] && u[k].value.fromArray) u[k].value.fromArray(o[k]); else if (k in LIGHT) LIGHT[k] = o[k]; else if (k === 'taa' && cam.taa) cam.taa.enabled = !!o[k]; } cam.remeter(); };
    // cam.light({ env, sun }): sky fill and sun strength as multiples of the light lane's numbers (whole-frame rules, for trials); the meter jumps to the new exposure
    cam.light = (o) => { const b = cam._l0 || (cam._l0 = { sun: world.sun.intensity, col: world.shared.uSunColor.value.clone() }); const e = o.env == null ? 1 : o.env, k = o.sun == null ? 1 : o.sun;
      world.scene.environmentIntensity = LIGHT.envI * e; if (world.skyMesh) world.skyMesh.material.uniforms.uGain.value = o.sky == null ? 1 : o.sky; world.sun.intensity = b.sun * k; world.shared.uSunColor.value.copy(b.col).multiplyScalar(k); cam.remeter(); };
    cam.remeter = () => { if (world.expMat) world.expMat.uniforms.uFirst.value = 1; world.meterDone = false; world.meterN = 0; };
    // round 4 (kept, 24 blind judges, street frozen): highlights roll off sooner and the meter holds bright frames lower, half the sharpening halo, less grain.
    // cam.defaults = this lane's numbers; cam.base = the light lane's, for like-for-like captures.
    cam.base = { uKnee: u.uKnee.value, uSharp: u.uSharp.value, uGrain: u.uGrain.value, hi: LIGHT.hi };
    cam.defaults = { uKnee: 0.26, uSharp: 0.2, uGrain: 0.08, hi: Q.has('Lhi') ? LIGHT.hi : 0.58 };
    u.uKnee.value = cam.defaults.uKnee; u.uSharp.value = cam.defaults.uSharp; u.uGrain.value = cam.defaults.uGrain; LIGHT.hi = cam.defaults.hi;
    for (const [k, v] of Q) if (k[0] === 'F' && u['u' + k.slice(1)] && typeof u['u' + k.slice(1)].value === 'number') u['u' + k.slice(1)].value = +v;
    // the neighbourhood brightness for the local tone step: log light of the picture the camera pass is about to read, at 256 px wide with its mip chain
    { const lumRT = new THREE.WebGLRenderTarget(256, 144, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      const lumMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D t; varying vec2 v; float L(vec2 o){ return dot(texture2D(t, v + o).rgb, vec3(0.2126, 0.7152, 0.0722)); } void main(){ vec2 o = vec2(1.0 / 1024.0, 1.0 / 576.0); gl_FragColor = vec4(log2(max(0.25 * (L(o) + L(-o) + L(vec2(o.x, -o.y)) + L(vec2(-o.x, o.y))), 1e-4)), 0.0, 0.0, 1.0); }' });
      const lumQuad = new FullScreenQuad(lumMat), fr1 = f.render.bind(f); u.tLum.value = lumRT.texture;
      f.render = (r, wb, rb, dt, mk) => {
        if (!cam.isOld && u.uLtmH.value + u.uLtmS.value > 0) { const src = cam.taa && cam.taa.enabled && cam.taa.up && cam.taa.out && cam.taa.result ? cam.taa.result : rb.texture, old = r.getRenderTarget();
          { const dp = cam.taa && cam.taa.enabled ? cam.taa.depth : null; u.tDep.value = dp || null; u.uHasDep.value = dp ? 1 : 0; } lumMat.uniforms.t.value = src; r.setRenderTarget(lumRT); lumQuad.render(r); r.setRenderTarget(old); }
        return fr1(r, wb, rb, dt, mk); }; }
    cam.film = f;
  }
  // --- global albedo ceiling (trial, off at 1): real street surfaces seldom reflect more than about 40% (concrete 0.3-0.4, limestone 0.4-0.5); ours
  // reach 0.6-0.8 and blow out in sun. Every lit material's base colour above 0.30 is compressed by cam.albedo(k) (k = 1 off; 0.5 = halve the excess).
  // The switch rides on renderer.toneMappingExposure, which three sets on every program and nothing here uses (tone mapping is done by the camera pass).
  if (Q.has('alb') && Q.get('alb') !== '0' && world.renderer.toneMapping === THREE.NoToneMapping && !THREE.ShaderChunk.__camAlb) { THREE.ShaderChunk.__camAlb = true;
    THREE.ShaderChunk.common += '\n#if !defined( TONE_MAPPING ) && !defined( CAM_ALB )\n#define CAM_ALB\nuniform float toneMappingExposure;\n#endif\n';
    const fix = '\n#ifdef CAM_ALB\n{ float aL = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)); if (aL > 0.30 && toneMappingExposure < 0.999) diffuseColor.rgb *= (0.30 + (aL - 0.30) * toneMappingExposure) / aL; }\n#endif\n';
    for (const c of ['lights_physical_fragment', 'lights_phong_fragment', 'lights_lambert_fragment']) THREE.ShaderChunk[c] = fix + THREE.ShaderChunk[c];
    world.renderer.toneMappingExposure = +Q.get('alb') || 1;
    cam.albedo = (k) => { world.renderer.toneMappingExposure = k; if (cam.remeter) cam.remeter(); }; }
  world.cam = cam;
  return cam;
}
