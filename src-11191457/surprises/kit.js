// surprises/kit.js: what every surprise shares (surprises lane, Nov 15). Nothing here runs unless a surprise asks for it.
//   kit.onStep(fn(dt))            after each world step (game.step wrapped once)
//   kit.onFrame(fn(dt, t))        before each drawn frame (world.render wrapped once); dt = real seconds since the last frame, 0 while paused
//   kit.particles(opts)           one instanced draw of soft sprites, simulated here (water, steam, crumbs)
//   kit.voice(opts)               a gain + panner fed from the camera: .at(x, y, h) places it, .gain / .lp are the nodes to drive
//   kit.prompt(text) / kit.use()  "E  pet the cat" chip for this frame; use() is true once per press of E (on foot)
//   kit.cam() kit.rng(seed) kit.say(text)
// Coordinates: the game's map metres (x east, y north, h up). three.js is (x, h, -y).
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;
export const rng = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------------------------------------ particles
// kind 'puff': a soft round wisp with its own noise (steam, mist). kind 'drop': a streak along its own velocity (water), brighter at the head.
// Colours are linear, premultiplied in the shader; blending 'add' for light-catching spray against dark, 'mix' for everything else.
const PVERT = `attribute vec4 aPos; attribute vec4 aCol; attribute vec4 aVel; uniform float uStretch; varying vec2 vQ; varying vec4 vC; varying float vSeed;
  void main(){ vQ = position.xy * 2.0; vC = aCol; vSeed = aVel.w; vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0); float s = aPos.w;
    #ifdef DROP
      vec3 vv = (viewMatrix * vec4(aVel.xyz, 0.0)).xyz; float sp = length(vv.xy); vec2 d = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0); float len = s + sp * uStretch;
      mv.xy += d * position.y * len + vec2(-d.y, d.x) * position.x * s;
    #else
      float a = aVel.w * 6.2831853 + aVel.x; float c = cos(a), sn = sin(a); mv.xy += vec2(c * position.x - sn * position.y, sn * position.x + c * position.y) * s;
    #endif
    gl_Position = projectionMatrix * mv; if (aCol.a <= 0.0 || s <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const PFRAG = `varying vec2 vQ; varying vec4 vC; varying float vSeed; uniform vec3 uFogC; uniform float uFogD;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){ float r = length(vQ); if (r >= 1.0) discard;
    #ifdef DROP
      float a = (1.0 - smoothstep(0.35, 1.0, abs(vQ.x))) * (1.0 - smoothstep(0.6, 1.0, abs(vQ.y)));
    #else
      float n = vn(vQ * 1.3 + vSeed * 37.0) * 0.65 + vn(vQ * 2.9 - vSeed * 11.0) * 0.35; float e = 1.0 - r; float a = e * e * (3.0 - 2.0 * e) * (0.12 + 0.88 * smoothstep(0.3, 0.72, n + e * 0.3));      /* a soft wisp: no hard edge anywhere, thinner where its own noise is low */
    #endif
    a *= vC.a; if (a < 0.004) discard;
    #ifdef ADD
      gl_FragColor = vec4(vC.rgb * a, 0.0);
    #else
      gl_FragColor = vec4(vC.rgb * a, a);
    #endif
  }`;

export class Particles {
  constructor(scene, { max = 512, kind = 'puff', blending = 'mix', stretch = 0.02, order = 6, name = 'sur_particles' } = {}) {
    this.max = max; this.n = 0; this.kind = kind;
    // simulation state (map metres): position, velocity, age, life, size from / to, colour, alpha, drag, gravity
    const F = (k) => new Float32Array(max * k);
    this.p = F(3); this.v = F(3); this.age = F(1); this.life = F(1); this.s0 = F(1); this.s1 = F(1); this.c = F(4); this.drag = F(1); this.grav = F(1); this.seed = F(1); this.fin = F(1); this.floor = F(1);
    const base = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(F(4), 4); this.aCol = new THREE.InstancedBufferAttribute(F(4), 4); this.aVel = new THREE.InstancedBufferAttribute(F(4), 4);
    for (const a of [this.aPos, this.aCol, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos); geo.setAttribute('aCol', this.aCol); geo.setAttribute('aVel', this.aVel); geo.instanceCount = 0;
    const defines = {}; if (kind === 'drop') defines.DROP = 1; if (blending === 'add') defines.ADD = 1;
    const mat = new THREE.ShaderMaterial({ defines, uniforms: { uStretch: { value: stretch }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0 } }, vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: blending === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor });
    const m = (this.mesh = new THREE.Mesh(geo, mat)); m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false; m.name = name; m.visible = false; scene.add(m);
    this.onLand = null;      // (i, x, y) when a particle with a floor reaches it
  }
  // o: { life, s0, s1, r, g, b, a, drag, grav, fin (fade-in share of life), floor (height it dies at; -1e9 = none) }
  emit(x, y, h, vx, vy, vh, o) {
    if (this.n >= this.max) return -1; const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = h; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vh;
    this.age[i] = 0; this.life[i] = o.life || 1; this.s0[i] = o.s0 || 0.1; this.s1[i] = o.s1 === undefined ? this.s0[i] : o.s1;
    this.c[i * 4] = o.r === undefined ? 1 : o.r; this.c[i * 4 + 1] = o.g === undefined ? 1 : o.g; this.c[i * 4 + 2] = o.b === undefined ? 1 : o.b; this.c[i * 4 + 3] = o.a === undefined ? 1 : o.a;
    this.drag[i] = o.drag || 0; this.grav[i] = o.grav === undefined ? 0 : o.grav; this.seed[i] = Math.random(); this.fin[i] = o.fin === undefined ? 0.12 : o.fin; this.floor[i] = o.floor === undefined ? -1e9 : o.floor;
    return i;
  }
  kill(i) { const j = --this.n; if (i === j) return; const cp = (a, k) => { for (let q = 0; q < k; q++) a[i * k + q] = a[j * k + q]; };
    cp(this.p, 3); cp(this.v, 3); cp(this.age, 1); cp(this.life, 1); cp(this.s0, 1); cp(this.s1, 1); cp(this.c, 4); cp(this.drag, 1); cp(this.grav, 1); cp(this.seed, 1); cp(this.fin, 1); cp(this.floor, 1); }
  // field(i, p, v, dt): optional, bends velocities (wind, a body to flow round)
  step(dt, field) {
    const { p, v, age, life, drag, grav } = this;
    for (let i = this.n - 1; i >= 0; i--) {
      age[i] += dt; if (age[i] >= life[i]) { this.kill(i); continue; }
      if (field) field(i, p, v, dt);
      const k = Math.max(0, 1 - drag[i] * dt), o = i * 3; v[o] *= k; v[o + 1] *= k; v[o + 2] = v[o + 2] * k - grav[i] * dt;
      p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
      if (p[o + 2] < this.floor[i]) { if (this.onLand) this.onLand(i, p[o], p[o + 1], v[o], v[o + 1], v[o + 2]); this.kill(i); }
    }
  }
  // fill the buffers for drawing; light = [r, g, b] multiplied into every colour (the day's light on white water or steam)
  draw(light) {
    const n = this.n, P = this.aPos.array, C = this.aCol.array, V = this.aVel.array, { p, v, age, life, s0, s1, c, seed, fin } = this, lr = light ? light[0] : 1, lg = light ? light[1] : 1, lb = light ? light[2] : 1;
    for (let i = 0; i < n; i++) { const u = age[i] / life[i], f = fin[i] > 0 ? Math.min(1, u / fin[i]) : 1, out = 1 - smooth(0.55, 1, u);
      P[i * 4] = p[i * 3]; P[i * 4 + 1] = p[i * 3 + 2]; P[i * 4 + 2] = -p[i * 3 + 1]; P[i * 4 + 3] = lerp(s0[i], s1[i], this.kind === 'drop' ? u : Math.sqrt(u));
      C[i * 4] = c[i * 4] * lr; C[i * 4 + 1] = c[i * 4 + 1] * lg; C[i * 4 + 2] = c[i * 4 + 2] * lb; C[i * 4 + 3] = c[i * 4 + 3] * f * out;
      V[i * 4] = v[i * 3]; V[i * 4 + 1] = v[i * 3 + 2]; V[i * 4 + 2] = -v[i * 3 + 1]; V[i * 4 + 3] = seed[i]; }
    this.mesh.geometry.instanceCount = n; this.mesh.visible = n > 0;
    if (n) { for (const a of [this.aPos, this.aCol, this.aVel]) { a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, n * 4); a.needsUpdate = true; } }
  }
  dispose() { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ------------------------------------------------------------------------------------------------ the kit
export function makeKit(game) {
  if (game.__surKit) return game.__surKit;
  const g = game, w = g.world, K = (g.__surKit = { steps: [], frames: [], fails: {}, THREE });
  const fail = (who, e) => { const n = (K.fails[who] = (K.fails[who] || 0) + 1); if (n <= 3) console.warn('[surprises] ' + who + ': ' + String((e && e.stack) || e).slice(0, 400)); };
  K.fail = fail;
  const step0 = g.step.bind(g);
  g.step = function (dt) { const r = step0(dt); for (const s of K.steps) { if (s.dead) continue; try { s.fn(dt); } catch (e) { fail(s.who, e); if (K.fails[s.who] > 30) s.dead = true; } } return r; };
  let last = 0;
  if (w && w.render) { const render0 = w.render.bind(w);
    w.render = function (t, focus) { const now = performance.now(), dt = g.paused || !last ? 0 : Math.min(0.1, (now - last) / 1000); last = now; K.t = t; K.promptNow = null;
      for (const s of K.frames) { if (s.dead) continue; try { s.fn(K.fixedDt || dt, t); } catch (e) { fail(s.who, e); if (K.fails[s.who] > 30) s.dead = true; } }
      showPrompt(); K.usePressed = false; return render0(t, focus); }; }
  K.onStep = (fn, who = 'step') => { K.steps.push({ fn, who }); };
  K.onFrame = (fn, who = 'frame') => { K.frames.push({ fn, who }); };
  K.particles = (o) => new Particles(w.scene, o);
  K.rng = rng;
  // the camera in map metres, and which way it looks
  const _d = new THREE.Vector3();
  K.cam = () => { const c = w.camera; c.getWorldDirection(_d); return { x: c.position.x, y: -c.position.z, h: c.position.y, dx: _d.x, dy: -_d.z, dh: _d.y }; };
  K.onFoot = () => { const pl = g.player; return !pl.vehicle && !pl.busy && !(g.heli && (g.heli.piloted || g.heli.busy)) && !(g.fly && g.fly.on); };
  // daylight on something white: the fog colour is the sky's own grey-blue, already dimmed for night and rain by the night kit
  K.light = (k = 1, out = [0, 0, 0]) => { const f = w.scene && w.scene.fog ? w.scene.fog.color : { r: 0.62, g: 0.68, b: 0.8 }, n = g.night ? g.night.n || 0 : 0, s = (1 - n) * 0.35;
    out[0] = (f.r + s) * k; out[1] = (f.g + s * 0.97) * k; out[2] = (f.b + s * 0.9) * k; return out; };

  // the city's baked light (sky seen from the street, the sun's shade beyond the shadow map, bounce) on one of our own MeshStandardMaterials, the way the
  // crowd and the cars take it (facade.js BAKE_LIGHT_GLSL through the ground lightmap). worldPos: GLSL for the vertex's world position (default: three's own).
  K.bakeLit = (mat, worldPos) => { const sh0 = w.shared; if (!sh0 || !sh0.tLight || !sh0.tLight.value || !K.BAKE || mat.userData.surBake) return mat; mat.userData.surBake = true;      /* (once per material: two meshes may share one) */ const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); Object.assign(sh.uniforms, { tLight: sh0.tLight, uHalf: sh0.uHalf, uSunColor: sh0.uSunColor, uShadowFar: sh0.uShadowFar, uShadowCenter: sh0.uShadowCenter });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vSurW;').replace('#include <project_vertex>', '#include <project_vertex>\n vSurW = ' + (worldPos || '(modelMatrix * vec4(transformed, 1.0)).xyz') + ';');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vSurW; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; vec3 bakeV; vec3 bakeN;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n bakeV = texture2D(tLight, vec2(vSurW.x / (2.0 * uHalf.x) + 0.5, -vSurW.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);\n' + K.BAKE.replace(/vWPos/g, 'vSurW')); };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : ''; mat.customProgramCacheKey = () => key + '|surbake'; mat.needsUpdate = true; return mat; };
  import('../facade.js').then((m) => { K.BAKE = m.BAKE_LIGHT_GLSL; }).catch(() => {});

  // ---- E to use, and the chip that says so
  let chip = null, shown = '';
  try { addEventListener('keydown', (e) => { if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (window.__startScreen || !K.onFoot()) return; K.usePressed = true; K.useT = performance.now(); }); } catch (e) {}
  K.prompt = (text) => { K.promptNow = text; };
  K.use = () => { if (K.usePressed) { K.usePressed = false; return true; } return false; };
  function showPrompt() { const want = K.promptNow || ''; if (want === shown) return; shown = want;
    try { if (!chip) { if (!want) return; chip = document.createElement('div'); chip.id = 'surprompt'; chip.style.cssText = 'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:7px 15px;border-radius:9px;transition:opacity .25s;opacity:0'; document.body.appendChild(chip); }
      if (want) { chip.innerHTML = '<span style="display:inline-block;border:1.5px solid #fff;border-radius:5px;padding:0 6px;margin-right:9px;font-size:13px">E</span>'; chip.appendChild(document.createTextNode(want)); chip.style.opacity = 1; } else chip.style.opacity = 0; } catch (e) {} }
  let sayEl = null, sayT = 0;
  K.say = (txt, ms = 2600) => { try { if (!sayEl) { sayEl = document.createElement('div'); sayEl.style.cssText = 'position:fixed;left:50%;top:136px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:6px 14px;border-radius:8px;transition:opacity .5s;opacity:0'; document.body.appendChild(sayEl); } sayEl.textContent = txt; sayEl.style.opacity = 1; clearTimeout(sayT); sayT = setTimeout(() => { sayEl.style.opacity = 0; }, ms); } catch (e) {} };

  // ---- sound: a voice somewhere in the street. Its level falls with distance (ref = the distance at which the gain is `level`), it pans with
  // the camera, and with `wall` it is muffled (low-pass) while a building stands between it and the camera.
  K.audio = () => { const s = g.sound; return s && s.on && s.ac && s.out ? s : null; };
  K.voice = ({ ref = 6, max = 120, level = 1, wall = false, roll = 1 } = {}) => { const s = K.audio(); if (!s) return null; const a = s.ac;
    const inp = a.createGain(), lp = a.createBiquadFilter(), gn = a.createGain(), pan = a.createStereoPanner ? a.createStereoPanner() : a.createGain(); lp.type = 'lowpass'; lp.frequency.value = 18000; gn.gain.value = 0;
    inp.connect(lp); lp.connect(gn); gn.connect(pan); pan.connect(s.out);
    const V = { a, in: inp, lp, gain: gn, pan, d: 1e9, hid: 0, hidT: 0, level,
      at(x, y, h = 1.5, dt = 0.016) { const c = w.camera, cx = c.position.x, cy = -c.position.z, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy, h - c.position.y); V.d = d; const t = a.currentTime, e = c.matrixWorld.elements;
        if (wall) { V.hidT -= dt; if (V.hidT <= 0) { V.hidT = 0.25; V.want = d > 10 && g.statics.raycast(cx, cy, x, y) < 1 ? 1 : 0; } V.hid += ((V.want || 0) - V.hid) * Math.min(1, dt * 4); lp.frequency.setTargetAtTime(lerp(16000, 1100, V.hid) / (1 + d / 260), t, 0.08); }
        const quiet = g.paused || (typeof document !== 'undefined' && document.hidden), k = d >= max ? 0 : Math.min(1.6, Math.pow(ref / Math.max(ref * 0.5, d), roll)) * (1 - smooth(max * 0.7, max, d)) * (1 - 0.45 * V.hid);
        gn.gain.setTargetAtTime(quiet ? 0 : V.level * k, t, 0.06); if (pan.pan) pan.pan.setTargetAtTime(clamp((dx * e[0] + -dy * e[2]) / Math.max(d, 3), -0.85, 0.85), t, 0.06); return k; },
      off() { gn.gain.setTargetAtTime(0, a.currentTime, 0.05); }, stop() { try { pan.disconnect(); } catch (e) {} } };
    return V; };
  // a short burst of filtered noise through a voice (splash, flap, rattle): type/freq/q of the filter, attack and decay in seconds
  K.burst = (voice, { type = 'bandpass', freq = 1200, q = 0.7, gain = 0.5, att = 0.004, dec = 0.18, rate = 1, at = 0 } = {}) => { const s = K.audio(); if (!s || !voice || !s.white) return; const a = s.ac, t = a.currentTime + at;
    const src = a.createBufferSource(); src.buffer = s.white; src.playbackRate.value = rate; const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const e = a.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(gain, t + att); e.gain.exponentialRampToValueAtTime(0.0008, t + att + dec);
    src.connect(f); f.connect(e); e.connect(voice.in); src.start(t, Math.random() * 1.5); src.stop(t + att + dec + 0.05); };
  return K;
}
