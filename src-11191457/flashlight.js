// flashlight.js (light lane, Nov 15, hand-off 23; Matt's report 171100-a6e3df: "i need a flashlight to go thru dark places like the park at night").
// Z (rebindable: logical code 'KeyZ', menu/keys.js) switches a phone torch on and off while on foot. ?flashlight=0: this file is never fetched.
// How: NOT a three.js light (a new light, or a new shadow-casting light, makes three rebuild every lit material's program: 20-30 s each for the
// building fronts on Windows). It is one screen pass put in world.composer right after the scene passes: it reads the scene's depth picture, rebuilds
// each pixel's place and a face normal from depth, and adds light inside a cone from the player's hand. Shadows: one 512 depth picture drawn from
// the torch with ONE depth material over the shadow-casting meshes within reach (the list is re-walked every 0.4 s), read only by this pass.
// Nothing here exists until the first key press (install() adds a key listener, a Controls row and a Graphics toggle, nothing else); while the
// torch is off, or the player is in a car / helicopter / the fly camera, the pass draws nothing.
// The light is drawn alone into its own colour-only buffer and then added onto the scene buffer in place: the composer does not swap for it, so the
// passes after it (AO, lamp light, TAA) find colour and depth exactly where they did before.
// Switches: ?flshadow=0 no shadows · ?flreach=28 metres · ?flgain=3 brightness · ?flres=512 shadow picture size · ?flscale=0.5 size of the light picture. game.flashlight.info() for tests.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FRAG = `
uniform sampler2D tColor, tDepth, tShadow, tExp; uniform mat4 uProjInv, uSV, uSP; uniform vec3 uLPos, uLDir, uTint; uniform vec4 uCone; uniform vec2 uNF;
uniform float uExpTex, uExposure, uGain, uShadowOn, uTexel; varying vec2 vUv;
float occ(vec2 uv, float z) { float d = texture2D(tShadow, uv).x; float zo = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); return step(z - 0.06 - 0.03 * z, zo); }
void main() {
  vec4 c = texture2D(tColor, vUv); float d = texture2D(tDepth, vUv).x; vec3 add = vec3(0.0);
  if (d < 1.0) {
    vec4 p = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 P = p.xyz / p.w;
    vec3 L = P - uLPos; float dist = length(L); L /= max(dist, 1e-4);
    float ca = dot(L, uLDir), cone = smoothstep(uCone.y, uCone.x, ca);
    if (cone > 0.0 && dist < uCone.z) {
      vec3 cr = cross(dFdx(P), dFdy(P)); float cl = length(cr); vec3 N = cl > 1e-12 ? cr / cl : vec3(0.0, 0.0, 1.0); if (dot(N, P) > 0.0) N = -N;     /* faces the camera; never a 0/0 */
      float ndl = 0.25 + 0.75 * max(dot(N, -L), 0.0);
      float att = 1.0 / (1.0 + dist * dist / (uCone.w * uCone.w)) * smoothstep(uCone.z, uCone.z * 0.55, dist);
      cone *= 0.55 + 0.45 * smoothstep(uCone.x, 1.0, ca);     /* a brighter middle, as a phone LED behind its lens has */
      float sh = 1.0;
      if (uShadowOn > 0.5) {
        vec4 sv = uSV * vec4(P + N * (0.02 + 0.004 * dist), 1.0); vec4 sc = uSP * sv; vec2 uv = sc.xy / sc.w * 0.5 + 0.5; float z = -sv.z;
        if (z > uNF.x && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0)
          sh = 0.25 * (occ(uv + vec2(-uTexel, -uTexel), z) + occ(uv + vec2(uTexel, -uTexel), z) + occ(uv + vec2(-uTexel, uTexel), z) + occ(uv + vec2(uTexel, uTexel), z));
      }
      float ex = max(uExpTex > 0.5 ? texture2D(tExp, vec2(0.5)).r : uExposure, 1e-3);
      /* what the surface is: the night picture as the camera shows it stands in for its colour (flat ambient light), plus a grey floor so
         a surface that is black at night still lights up. The light is given in display terms (divided by the exposure). */
      vec3 alb = 0.05 + 0.95 * clamp(c.rgb * ex * 1.3, 0.0, 0.6);
      add = alb * uTint * (uGain / ex) * att * cone * ndl * sh;
      if (!(add.r >= 0.0 && add.g >= 0.0 && add.b >= 0.0)) add = vec3(0.0);     /* a not-a-number here would spread over the whole frame through TAA and the exposure meter */
      add = min(add, vec3(6.0 / ex));
    }
  }
  gl_FragColor = vec4(add, 1.0);
}`;

class FlashPass extends Pass {
  constructor(game, o) {
    super(); const w = (this.w = game.world); this.g = game; this.o = o; this.needsSwap = false; this.t = 0; this.list = []; this.drawn = 0;
    const half = THREE.MathUtils.degToRad(o.half);
    this.mat = new THREE.ShaderMaterial({ name: 'flashlight', depthTest: false, depthWrite: false, fragmentShader: FRAG,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      uniforms: { tColor: { value: null }, tDepth: { value: null }, tShadow: { value: null }, tExp: { value: null }, uExpTex: { value: 0 }, uExposure: { value: 1 }, uProjInv: { value: new THREE.Matrix4() }, uSV: { value: new THREE.Matrix4() }, uSP: { value: new THREE.Matrix4() },
        uLPos: { value: new THREE.Vector3() }, uLDir: { value: new THREE.Vector3(0, 0, -1) }, uTint: { value: new THREE.Vector3(0.90, 0.95, 1.08) }, uCone: { value: new THREE.Vector4(Math.cos(half * 0.62), Math.cos(half), o.reach, 8) },
        uNF: { value: new THREE.Vector2(0.3, o.reach + 2) }, uGain: { value: o.gain }, uShadowOn: { value: 0 }, uTexel: { value: 0.6 / o.res } } });
    this.fsq = new FullScreenQuad(this.mat);
    this.addMat = new THREE.ShaderMaterial({ name: 'flashlight.add', depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      uniforms: { t: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }' });
    this.fsq2 = new FullScreenQuad(this.addMat);
    this.pos = new THREE.Vector3(); this.dir = new THREE.Vector3(); this._r = new THREE.Vector3(); this._s = new THREE.Sphere(); this._f = new THREE.Frustum(); this._m = new THREE.Matrix4();
    if (o.shadow) {
      const rt = (this.rt = new THREE.WebGLRenderTarget(o.res, o.res, { depthBuffer: true })); rt.texture.name = 'flashlight.shadow';
      rt.depthTexture = new THREE.DepthTexture(o.res, o.res); rt.depthTexture.format = THREE.DepthFormat; rt.depthTexture.type = THREE.UnsignedIntType; rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
      this.sc = new THREE.PerspectiveCamera(o.half * 2 + 4, 1, 0.3, o.reach + 2); this.mat.uniforms.tShadow.value = rt.depthTexture;
      this.dmat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide }); this.dmat.name = 'flashlight.depth'; this.dmat.colorWrite = false;
      // the casters are drawn by hand from inside the draw of one empty mesh (the renderer needs a render in progress for renderBufferDirect):
      // no walk of the whole scene, no second scene graph, none of the game's own materials touched
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      const dm = new THREE.Mesh(dg, this.dmat); dm.frustumCulled = false; this.ds = new THREE.Scene(); this.ds.add(dm); this.ds.matrixWorldAutoUpdate = false;
      dm.onAfterRender = (r) => this.drawCasters(r);
    }
  }
  // the shadow casters within reach of the torch: visible meshes the sun shadow also takes (castShadow), not the player, not cut-out or see-through ones
  walk() {
    const out = [], P = this.pos, R = this.o.reach + 2, mask = this.w.camera.layers, me = this.g.player && this.g.player.vis && this.g.player.vis.object, S = this._s;
    const go = (o) => {
      if (!o.visible || o === me) return;
      if (o.isMesh && o.castShadow && o.geometry && o.layers.test(mask)) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (o.customDepthMaterial || (m && !m.transparent && !(m.alphaTest > 0))) {
          let ok = true; const bs = o.isInstancedMesh ? o.boundingSphere : (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
          if (bs && isFinite(bs.radius)) { S.copy(bs).applyMatrix4(o.matrixWorld); ok = S.center.distanceTo(P) < R + S.radius; }
          if (ok) out.push(o);
        }
      }
      const ch = o.children; for (let i = 0; i < ch.length; i++) go(ch[i]);
    };
    go(this.w.scene); this.list = out;
  }
  drawCasters(r) {
    const sc = this.sc, F = this._f, S = this._s; let n = 0;
    F.setFromProjectionMatrix(this._m.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
    for (const o of this.list) {
      if (!o.visible || !o.parent) continue;
      if (o.frustumCulled) { const bs = o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere; if (bs && isFinite(bs.radius)) { S.copy(bs).applyMatrix4(o.matrixWorld); if (!F.intersectsSphere(S)) continue; } }
      o.modelViewMatrix.multiplyMatrices(sc.matrixWorldInverse, o.matrixWorld);
      r.renderBufferDirect(sc, null, o.geometry, o.customDepthMaterial || this.dmat, o, null); n++;
    }
    this.drawn = n;
  }
  active() { const g = this.g, pl = g.player; return !!(pl && !pl.vehicle && pl.vis && pl.vis.object && pl.vis.object.visible && g.cam && g.cam.mode === 'foot' && !(g.fly && g.fly.on)); }
  render(renderer, writeBuffer, readBuffer) {
    const dep = readBuffer.depthTexture;
    if (!dep || !this.active()) { this.lit = false; return; }
    this.chk(renderer, 'before');
    this.lit = true;
    const w = this.w, cam = w.camera, U = this.mat.uniforms, o = this.g.player.vis.object, f = this.dir, R = this._r;
    cam.getWorldDirection(f); f.y += 0.06; f.normalize(); R.set(-f.z, 0, f.x).normalize();     /* the camera's forward, a touch raised; R = to the player's right */
    this.pos.copy(o.position); this.pos.y += 1.15; this.pos.addScaledVector(R, 0.22); this.pos.x += f.x * 0.3; this.pos.z += f.z * 0.3;
    const old = renderer.getRenderTarget();
    if (this.rt) {
      const now = performance.now(); if (now - this.t > 400 || !this.list.length) { this.t = now; this.walk(); }
      const sc = this.sc; sc.position.copy(this.pos); sc.lookAt(this.pos.x + f.x, this.pos.y + f.y, this.pos.z + f.z); sc.updateMatrixWorld(); sc.matrixWorldInverse.copy(sc.matrixWorld).invert();
      const ac = renderer.autoClear; renderer.autoClear = true; renderer.setRenderTarget(this.rt); renderer.render(this.ds, sc); renderer.autoClear = ac;
      U.uSV.value.multiplyMatrices(sc.matrixWorldInverse, cam.matrixWorld); U.uSP.value.copy(sc.projectionMatrix); U.uShadowOn.value = 1;
    }
    U.tColor.value = readBuffer.texture; U.tDepth.value = dep; U.uProjInv.value.copy(cam.projectionMatrixInverse);
    U.uLPos.value.copy(this.pos).applyMatrix4(cam.matrixWorldInverse); U.uLDir.value.copy(f).transformDirection(cam.matrixWorldInverse);
    const fu = w.film && w.film.uniforms; if (fu) { U.uExposure.value = fu.uExposure.value; U.uExpTex.value = fu.uExpTex ? fu.uExpTex.value : 0; U.tExp.value = fu.tExp ? fu.tExp.value : null; }
    // the light alone goes to the composer's spare buffer, then is added onto the scene where it stands: no swap, so every later pass finds colour and depth where it always did
    const lw = Math.max(2, Math.ceil(readBuffer.width * this.o.scale)), lh = Math.max(2, Math.ceil(readBuffer.height * this.o.scale));     /* the light is smooth: worked out at half size, spread back by the add */
    if (!this.lt) { this.lt = new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, depthBuffer: false }); this.lt.texture.name = 'flashlight.light'; } else if (this.lt.width !== lw || this.lt.height !== lh) this.lt.setSize(lw, lh);
    this.chk(renderer, 'shadow'); const ac2 = renderer.autoClear; renderer.autoClear = false; renderer.setRenderTarget(this.lt); this.fsq.render(renderer); this.chk(renderer, 'light');
    this.addMat.uniforms.t.value = this.lt.texture; renderer.setRenderTarget(readBuffer); this.fsq2.render(renderer); this.chk(renderer, 'add'); renderer.autoClear = ac2; renderer.setRenderTarget(old);
  }
  chk(r, k) { if (!this.o.dbg) return; const e = r.getContext().getError(); if (e) { const d = (this.g.flashlight.dbg = this.g.flashlight.dbg || {}); d[k] = (d[k] || 0) + 1; d[k + 'E'] = e; } }
  dispose() { if (this.lt) this.lt.dispose(); this.mat.dispose(); this.fsq.dispose(); this.addMat.dispose(); this.fsq2.dispose(); if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); this.dmat.dispose(); } }
}

export function install(game) {
  const P = game.P, w = game.world, num = (k, d) => { const v = +P.get(k); return P.has(k) && isFinite(v) && v > 0 ? v : d; };
  const o = { shadow: P.get('flshadow') !== '0', reach: Math.min(60, num('flreach', 28)), gain: num('flgain', 3), res: Math.min(2048, Math.round(num('flres', 512))), half: 27, scale: Math.min(1, Math.max(0.25, num('flscale', 0.5))), dbg: P.get('fldbg') === '1' };
  const F = (game.flashlight = { on: false, pass: null, fails: 0, key: 'KeyZ' });
  let chip = null, chipT = 0;
  const say = (txt) => { try { if (!chip) { chip = document.createElement('div'); chip.style.cssText = 'position:fixed;left:50%;top:104px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:6px 14px;border-radius:8px;transition:opacity .5s;opacity:0'; document.body.appendChild(chip); } chip.textContent = txt; chip.style.opacity = 1; clearTimeout(chipT); chipT = setTimeout(() => { chip.style.opacity = 0; }, 1800); } catch (e) {} };
  F.set = (v) => {
    v = !!v; if (v === F.on) return F.on;
    try {
      if (v && !F.pass) {     // first use: the pass is built and put after the scene passes (before AO, bloom, the lamp-light pass and the film pass)
        const c = w.composer; if (!c || !c.readBuffer.depthTexture) { F.none = true; return false; }     /* the 4x multisampled stills path has no depth picture: no torch there */
        F.pass = new FlashPass(game, o); c.insertPass(F.pass, Math.max(1, c.passes.indexOf(w.nearPass) + 1));
      }
      if (F.pass) F.pass.enabled = v; F.on = v;
    } catch (e) { if (F.fails++ < 4) console.warn('[flashlight] ' + String((e && e.stack) || e).slice(0, 300)); F.on = false; if (F.pass) F.pass.enabled = false; }
    /* the Graphics toggle is an input only: writing the stored setting on every key press cost about 10 frames a second for some seconds (r4-r7) */
    return F.on;
  };
  F.toggle = () => F.set(!F.on);
  F.info = () => ({ on: F.on, built: !!F.pass, lit: !!(F.pass && F.pass.lit && F.pass.enabled), shadow: !!(F.pass && F.pass.rt), casters: F.pass ? F.pass.list.length : 0, drawn: F.pass ? F.pass.drawn : 0, reach: o.reach, none: !!F.none, dbg: F.dbg || null });
  addEventListener('keydown', (e) => {
    if (e.code !== F.key || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (window.__startScreen) return;
    const on = F.toggle(); say(F.none ? 'No flashlight in this picture mode' : on ? (F.pass && !F.pass.active() ? 'Flashlight on (it lights when you are on foot)' : 'Flashlight on') : 'Flashlight off');
  });
  // the stored switch is not carried into a new visit: a visit starts with the torch off, so a load never builds it
  try { const s = game.settings; if (s && s.get && s.get('player.flashlight', false)) s.set('player.flashlight', false); if (s && s.on) s.on('player.flashlight', (v) => { if (!!v !== F.on) F.set(!!v); }); } catch (e) {}
  try { const m = game.menu; if (m && m.addSetting) { m.addSetting('graphics', { key: 'player.flashlight', label: 'Flashlight', type: 'toggle', dflt: false, hint: 'On foot. Lights the way in dark places.' }); if (m.addKey) m.addKey({ code: F.key, label: 'Flashlight on / off', group: 'Move', also: 'on foot' }); } } catch (e) {}
}
