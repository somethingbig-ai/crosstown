// sky/rain.js: rain. Wet roads and sidewalks that mirror the street (sky/wet.glsl.js, through the patched ground shaders), falling streaks round the
// camera, a rain sound, and (through sky/night.js, when it is there) an overcast light: weaker sun, grey sky, thicker haze.
//   Y            rain on / off (it comes and goes over a few seconds)         ?rain=1 starts raining; ?rain=0.5 a light rain
//   settings     'world.rain' (0..1) when game.settings is there; game.rain.set(0..1), game.rain.info()
//   ?rain=off    this file is never fetched (the game.js line reads ?rain=off)
// Dry, it costs one comparison a frame and one uniform test in the ground shaders; the streak mesh and the sound are made the first time it rains.
// NOT done: wipers, drops on the camera or the windscreen, splashes from tyres, wet car bodies and walls, rain stopping under awnings or bridges.
import * as THREE from 'three';
import { WET_U, WET_NL, RAIN2 } from './wet.glsl.js';
import { install as install1 } from './rain1.js';      /* the rain as it was before light's rain 2 (?rain2=0) */

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const NDROP = 12000, NSPLASH = 1400;

export function install(game) {
  if (game.rain) return game.rain;
  if (!RAIN2) return install1(game);
  const g = game, w = g.world, P = g.P || new URLSearchParams(location.search);
  const get = (k, d) => { try { const s = g.settings; if (s && s.get) { const v = s.get(k, d); return v === undefined || v === null ? d : v; } } catch (e) {} return d; };
  const R = (g.rain = { want: 0, amt: 0, wet: 0, mesh: null, snd: null, patched: !!w.shared.uWetK, fails: 0 });
  const fail = (where, e) => { if (R.fails++ < 4) console.warn('[rain] ' + where + ': ' + String((e && e.stack) || e).slice(0, 300)); };
  { const q = P.get('rain'); if (q !== null && q !== '' && isFinite(+q)) R.want = Math.min(1, Math.max(0, +q)); else if (q === '' ) R.want = 1; else R.want = Math.min(1, Math.max(0, +get('world.rain', 0) || 0)); }
  if (!R.patched) console.log('[rain] ground shader patch not there: roads stay dry');
  R.set = (v) => { R.want = Math.min(1, Math.max(0, +v || 0)); return R.want; };
  R.info = () => ({ want: R.want, falling: +R.amt.toFixed(3), wet: +R.wet.toFixed(3), streaks: !!R.mesh, splashes: !!R.splash, lights: R.lights || 0, low: R.low || 0, sound: !!R.snd, roads: R.patched });
  let chip = null, chipT = 0;
  const say = (txt) => { try { if (!chip) { chip = document.createElement('div'); chip.style.cssText = 'position:fixed;left:50%;top:104px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:6px 14px;border-radius:8px;transition:opacity .5s;opacity:0'; document.body.appendChild(chip); } chip.textContent = txt; chip.style.opacity = 1; clearTimeout(chipT); chipT = setTimeout(() => { chip.style.opacity = 0; }, 2200); } catch (e) {} };
  addEventListener('keydown', (e) => { if (e.code !== 'KeyY' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || R.key === false) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (window.__startScreen) return; R.set(R.want > 0 ? 0 : 1); say(R.want ? 'Rain' : 'Rain stops'); try { const s = g.settings; if (s && s.set) s.set('world.rain', R.want > 0); } catch (e2) {} });
  try { const m = g.menu; if (m && m.addSetting) { m.addSetting('graphics', { key: 'world.rain', label: 'Rain', type: 'toggle', dflt: false }); if (m.addKey) m.addKey({ code: 'KeyY', label: 'Rain on / off', group: 'Camera and system' }); } } catch (e) {}
  try { const s = g.settings; if (s && s.on) s.on('world.rain', (v) => { if (Math.abs((+v || 0) - R.want) > 0.01) R.set(+v || 0); }); } catch (e) {}

  /* light lane, Nov 14 (rain round 2): what falls. From photographs: by day rain is almost invisible except close up and against something dark; at
     night it shows only inside lamp and headlight light. So: three depth layers of short streaks (a shutter's length of fall, slanted by the camera's
     own speed), about a pixel wide with the brightness of a 2 mm drop spread over that pixel (far rain fades into a veil), ADDED to the picture and lit
     by the grey sky, by the night kit's street-lamp map and by the nearest headlight cones. And small splashes where drops land (one more draw). */
  const TU = (R.tune = { day: 0.22, lamp: 0.6, head: 2.2, splash: 0.6, shut: 0.028, lampS: 0.8, headS: 0.9, tailS: 0.38, dark: 0.62, cap: -1, lowN: 3, floorN: 3 }); for (const k in TU) if (P.has('R' + k)) TU[k] = +P.get('R' + k);
  const LIT = `uniform sampler2D tLamp; uniform vec4 uMap; uniform vec3 uAmb; uniform float uLampK, uHeadK; uniform vec4 uSpotP[4]; uniform vec4 uSpotD[4]; uniform float uSpotN;
    vec3 rnLit(vec3 wp, vec3 view){ vec3 L = uAmb;
      if (uLampK > 0.0) { vec3 lm = texture2D(tLamp, (wp.xz - uMap.xy) * uMap.zw).rgb; L += lm * lm * (uLampK * (1.0 - smoothstep(6.0, 10.5, wp.y)) * (0.45 + 0.55 * smoothstep(0.0, 8.0, wp.y))); }
      for (int i = 0; i < 4; i++) { if (float(i) >= uSpotN) break; vec3 to = wp - uSpotP[i].xyz; float ds = length(to); vec3 l = to / max(ds, 1e-3); float c = dot(l, uSpotD[i].xyz);
        float cone = smoothstep(0.84, 0.985, c), att = (1.0 - smoothstep(16.0, 38.0, ds)) / (1.0 + 0.02 * ds * ds), ph = 0.22 + 2.6 * pow(max(dot(view, -l), 0.0), 3.0);
        L += vec3(1.0, 0.95, 0.86) * (uHeadK * cone * att * ph); }
      return L; }`;
  const litU = () => ({ tLamp: { value: null }, uMap: { value: new THREE.Vector4(0, 0, 1, 1) }, uAmb: { value: new THREE.Vector3() }, uLampK: { value: 0 }, uHeadK: { value: 0 }, uSpotP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uSpotD: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 0, 0, 0)) }, uSpotN: { value: 0 }, uT: { value: 0 }, uAmt: { value: 0 }, uPix: { value: 0.0013 } });
  const seeds = (n, s) => { const a = new Float32Array(n * 3); for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; } return a; };
  const inst = (n, seed, w2, h2) => { const base = new THREE.PlaneGeometry(w2, h2), geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, seed), 3)); geo.instanceCount = n; return geo; };
  const mkMesh = () => { const geo = inst(NDROP, 4321, 2, 1);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { ...litU(), uVel: { value: new THREE.Vector3(1.2, -8.6, 0.5) }, uCamV: { value: new THREE.Vector3() }, uShut: { value: TU.shut } },
      vertexShader: `attribute vec3 aSeed; uniform float uT, uAmt, uShut, uPix; uniform vec3 uVel, uCamV; varying vec2 vQ; varying vec3 vL; ${LIT}
        void main(){ float lay = fract(aSeed.y * 31.7 + aSeed.x * 3.1), k = 0.62 + 0.5 * fract(aSeed.x * 91.3 + aSeed.z * 17.7);
          vec3 box = lay < 0.2 ? vec3(9.0, 7.0, 9.0) : (lay < 0.6 ? vec3(22.0, 14.0, 22.0) : vec3(46.0, 24.0, 46.0));
          vec3 rel = mod(aSeed * box + uVel * (uT * k) - cameraPosition, box) - 0.5 * box; vec3 wp = cameraPosition + rel; float dist = length(rel); vec3 view = rel / max(dist, 1e-3);
          vec3 vr = uVel * k - uCamV * 0.3; float sp = length(vr); vec3 fall = vr / sp; vec3 side = normalize(cross(fall, view)); float px = dist * uPix, hw = max(0.0011, 0.62 * px);
          wp += -fall * (position.y + 0.5) * sp * uShut + side * position.x * hw;
          float a = step(fract(aSeed.y * 53.1 + aSeed.x * 7.7), uAmt) * smoothstep(1.0, 2.6, dist) * (1.0 - smoothstep(box.x * 0.38, box.x * 0.5, dist)) * min(1.0, 0.0024 / hw) * (0.55 + 0.9 * fract(aSeed.z * 13.7)) * clamp(9.0 / sp, 0.35, 1.0);      /* a faster streak is longer and so thinner on the eye */
          vQ = vec2(position.x, position.y + 0.5); vL = rnLit(wp, view) * a;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); if (a <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `varying vec2 vQ; varying vec3 vL; void main(){ float a = (1.0 - abs(vQ.x)) * smoothstep(0.0, 0.3, vQ.y) * smoothstep(1.0, 0.45, vQ.y); gl_FragColor = vec4(vL * a, 0.0); }` });
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor;
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 7; m.matrixAutoUpdate = false; m.name = 'rain_streaks'; w.scene.add(m); return m; };
  const mkSplash = () => { const geo = inst(NSPLASH, 99173, 1, 1);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { ...litU(), uGain: { value: 1 } },
      vertexShader: `attribute vec3 aSeed; uniform float uT, uAmt, uPix, uGain; varying vec2 vQ; varying vec3 vL; varying float vU; ${LIT}
        float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
        void main(){ const vec3 box = vec3(34.0, 1.0, 34.0); float per = 0.30 + 0.25 * aSeed.y, tt = uT / per + aSeed.z * 9.0, ci = floor(tt), u = fract(tt) / 0.5;
          vec3 sp = vec3(fract(aSeed.x + h1(ci + aSeed.z * 71.0)), 0.0, fract(aSeed.z + h1(ci * 1.37 + aSeed.x * 53.0)));
          vec3 rel = mod(sp * box - cameraPosition, box) - 0.5 * box; rel.y = (fract(aSeed.y * 17.3) < 0.5 ? 0.012 : 0.165) - cameraPosition.y; vec3 wp = cameraPosition + rel; float dist = length(rel); vec3 view = rel / max(dist, 1e-3);
          float px = dist * uPix, wd = 0.012 + 0.035 * u, ht = 0.012 + 0.05 * sin(min(u, 1.0) * 2.4), k = max(1.0, 1.3 * px / wd);
          vec3 side = normalize(vec3(view.z, 0.0, -view.x)); wp += side * position.x * wd * k + vec3(0.0, (position.y + 0.5) * ht * k, 0.0);
          float a = step(u, 1.0) * step(fract(aSeed.y * 53.1 + aSeed.x * 7.7), uAmt) * (1.0 - u) * (1.0 - smoothstep(11.0, 17.0, dist)) * smoothstep(0.5, 1.5, dist) / (k * k);
          vQ = vec2(position.x * 2.0, position.y + 0.5); vU = u; vL = rnLit(wp + vec3(0.0, 0.3, 0.0), view) * (a * uGain);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); if (a <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `varying vec2 vQ; varying vec3 vL; varying float vU; void main(){ float x = abs(vQ.x), a = (1.0 - x * x) * (1.0 - vQ.y) * smoothstep(0.0, 0.15, vQ.y); gl_FragColor = vec4(vL * a, 0.0); }` });
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor;
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 7; m.matrixAutoUpdate = false; m.name = 'rain_splash'; w.scene.add(m); return m; };
  // the lamps the wet ground draws streaks from (sky/wet.glsl.js WET_U): the nearest street-lamp heads and car lamps in front of the camera
  // lead, Nov 18 (Matt: "Sidewalk is like glitching. It's like flash"; seen on a MacBook at night in rain, lanes/lead/sidewalk-flash): the list below holds the
  // WET_NL best-placed lamps and nothing eased a lamp in or out of it, so each time the order changed (the camera turns or moves, a car passes) one streak on the
  // wet ground went out and another came on at full strength inside one frame. Now each lamp has a place of its own in the list and a strength that moves at most
  // WFADE_K a second of game time: a lamp that drops out of the best keeps its place until it has faded to nothing (about a third of a second), and only then does
  // the lamp that took its rank get the place and fade in. ?wetfade=0 = as before.
  const WFADE = P.get('wetfade') !== '0', WFADE_K = 3, wst = new WeakMap(), wslot = new Array(WET_NL).fill(null); let wT = -1e9;
  const wof = (o, end) => { let s = wst.get(o); if (!s) wst.set(o, (s = [null, null])); return s[end] || (s[end] = { w: 0, t: 0, on: false, q: null }); };
  const cam0 = new THREE.Vector3(), camV = new THREE.Vector3(), fwd = new THREE.Vector3(), near = []; let lampT = -1e9, lampNear = [], camOk = false, lobeF = WET_NL, lobeT = 0;
  const wetLights = (N, now, tg) => { const LP = WET_U.uWetLP.value, LC = WET_U.uWetLC.value, cp = w.camera.position; w.camera.getWorldDirection(fwd); near.length = 0;
    const add = (x, y, z, r, gg, b, rad, wt, st) => { const dx = x - cp.x, dz = z - cp.z, d = Math.hypot(dx, dz); if (d > 150 || d < 0.5) return; const c = (dx * fwd.x + dz * fwd.z) / d; if (!(c >= 0.15)) return; near.push([d * (1 + 2.2 * (1 - c)) * wt, x, y, z, r, gg, b, rad, st]); };
    const kit = N && N.kit, lampOn = N ? N.lampOn || 0 : 0, headOn = N ? N.headOn || 0 : 0;
    if (kit && kit.heads && lampOn > 0.01) { if (now - lampT > 600) { lampT = now; lampNear = kit.heads.filter((h) => Math.abs(h[0] - cp.x) < 170 && Math.abs(-h[1] - cp.z) < 170); }
      const s = TU.lampS * lampOn; for (const h of lampNear) add(h[0], h[2], -h[1], s * h[3], s * 0.9 * h[3], s * 0.74 * h[3], 0.3, 1.25, WFADE ? wof(h, 0) : null); }
    if (headOn > 0.01) try { const one = (c) => { if (c.gone) return; const def = c.def || {}, len = (def.len || 4.6) / 2; let ch = c.h; if (WFADE) { let s = wst.get(c); if (!s) wst.set(c, (s = [null, null])); if (!(tg - s.ht >= 0 && tg - s.ht < 0.5)) s.h = ch; else { let dh = ch - s.h; dh -= Math.round(dh / 6.2831853) * 6.2831853; const m = 1.5 * (tg - s.ht); s.h += Math.max(-m, Math.min(m, dh)); } s.ht = tg; ch = s.h; }      /* a traffic car's heading can snap a radian for a few frames on a short junction curve (traffic.js: the curve's own tangent): the lamps' places follow it at 1.5 rad a second at most, so their streaks do not jump */
        const co = Math.cos(ch), si = Math.sin(ch), dk = 0.3 + 0.7 * (N.n || 0), hs = TU.headS * headOn * dk, ts = TU.tailS * headOn * dk * (c.brake ? 1 : 0.45);      /* by day a lamp's streak is weak beside the sky's */
        add(c.x + co * len, 0.66, -(c.y + si * len), hs, hs * 0.95, hs * 0.86, 0.5, 1, WFADE ? wof(c, 0) : null); add(c.x - co * len, 0.8, -(c.y - si * len), ts, ts * 0.05, ts * 0.03, 0.5, 1, WFADE ? wof(c, 1) : null); };
      for (const c of g.traffic.cars) one(c); if (g.player.vehicle) one(g.player.vehicle); } catch (e) {}
    near.sort((a, b) => a[0] - b[0]); const n = Math.min(WET_NL, near.length);
    if (!WFADE) for (let i = 0; i < n; i++) { const q = near[i]; LP[i * 4] = q[1]; LP[i * 4 + 1] = q[2]; LP[i * 4 + 2] = q[3]; LP[i * 4 + 3] = q[7]; LC[i * 4] = q[4]; LC[i * 4 + 1] = q[5]; LC[i * 4 + 2] = q[6]; }
    /* light, Nov 15 (the weak-GPU check, laptop 3 at 4.67 megapixels where the GPU is the limit: this rain cost 2.8-3.7 ms a frame against about 1 ms
       for the rain before, and the lobes are half of it: 0 lobes 1.6 ms, 1-3 lobes 2.4 ms, 10 lobes 3.5 ms). Once the game's own governor has given up
       picture size or detail to hold the frame rate (world.liveScale under 0.8, or detail under 1: the Safari start too) only the TU.lowN nearest lamps
       draw a streak and the splashes are not drawn; at the governor's floor (detail 0.5 or less: the weak-card start too) TU.floorN lamps do (3; ?RfloorN=0 = none).
       A machine at the full picture keeps all WET_NL. The count moves 6 lamps a second and the last lobe fades by the fraction, so nothing pops.
       ?Rcap=0 never caps, ?Rcap=1 holds the low step, ?Rcap=2 the floor step; ?RlowN=n ?RfloorN=n the counts. */
    const det = w.detail || 1, step = TU.cap === 0 ? 0 : TU.cap === 1 || TU.cap === 2 ? TU.cap : det <= 0.5 ? 2 : ((w.liveScale || 1) < 0.8 || det < 1) ? 1 : 0;
    const want = Math.max(0, Math.min(WET_NL, step === 2 ? TU.floorN : step === 1 ? TU.lowN : WET_NL)), dl = Math.min(0.25, Math.max(0, (now - lobeT) / 1000)) * 6; lobeT = now;
    lobeF += Math.max(-dl, Math.min(dl, want - lobeF)); R.low = step;
    if (WFADE) {      // want = how many lamps the picture tier draws (above); the count itself needs no easing here: each lamp fades
      const el = tg - wT, dw = el > 0 && el < 0.5 ? Math.min(0.1, el) * WFADE_K : 1 /* merge lane, Nov 18: when game time stands still (capture stills, a paused game) or on the first call, strengths go straight to their targets: with a fade measured in game time no lamp ever came up there and the wet ground showed no streaks at all */; wT = tg; let top = 0;
      for (const s of wslot) if (s) s.t = 0;
      for (let i = 0; i < near.length; i++) { const s = near[i][8]; s.q = near[i]; s.t = i < want ? 1 : 0; }
      for (let i = 0; i < WET_NL; i++) { const s = wslot[i]; if (!s) continue; s.w += Math.max(-dw, Math.min(dw, s.t - s.w)); if (s.w <= 0 && s.t <= 0) { s.on = false; wslot[i] = null; } }
      for (let i = 0, f = 0; i < near.length && i < want; i++) { const s = near[i][8]; if (s.on) continue; while (f < WET_NL && wslot[f]) f++; if (f >= WET_NL) break; wslot[f] = s; s.on = true; s.w = 0; }
      for (let i = 0; i < WET_NL; i++) { const s = wslot[i]; if (!s) { LC[i * 4] = LC[i * 4 + 1] = LC[i * 4 + 2] = 0; continue; } const q = s.q, k = s.w; LP[i * 4] = q[1]; LP[i * 4 + 1] = q[2]; LP[i * 4 + 2] = q[3]; LP[i * 4 + 3] = q[7]; LC[i * 4] = q[4] * k; LC[i * 4 + 1] = q[5] * k; LC[i * 4 + 2] = q[6] * k; top = i + 1; }
      WET_U.uWetLN.value = top; R.lights = top; return; }
    const nf = Math.min(n, lobeF); WET_U.uWetLN.value = nf; R.lights = Math.ceil(nf); };
  const lit = (u, N, dt) => { const kit = N && N.kit, n = N ? N.n || 0 : 0, fc = w.scene.fog.color, cv = w.renderer.domElement, cam = w.camera;
    u.uT.value = R.t; u.uAmt.value = R.amt; u.uPix.value = 2 * Math.tan((cam.fov || 50) * Math.PI / 360) / Math.max(200, cv.clientHeight || cv.height);
    u.uAmb.value.set(fc.r, fc.g, fc.b).multiplyScalar(TU.day);      // the fog colour is the overcast sky's grey, already turned down for the night
    const map = kit && kit.map; if (map && u.tLamp.value !== map.tex) { u.tLamp.value = map.tex; u.uMap.value.set(...map.rect); }
    u.uLampK.value = map ? TU.lamp * (N.lampOn || 0) : 0; const pu = kit && kit.pass && kit.pass.u, ns = pu ? Math.min(4, pu.uSpotN.value | 0) : 0;
    for (let i = 0; i < ns; i++) { u.uSpotP.value[i].copy(pu.uSpotP.value[i]); u.uSpotD.value[i].copy(pu.uSpotD.value[i]); } u.uSpotN.value = ns; u.uHeadK.value = TU.head * (N ? N.headOn || 0 : 0); };
  const mkSound = () => { const s = g.sound; if (!s || !s.on || !s.ac || !s.white) return null; const a = s.ac, out = a.createGain(); out.gain.value = 0; out.connect(s.out);
    const src = a.createBufferSource(); src.buffer = s.white; src.loop = true; const hiss = a.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 4200; hiss.Q.value = 0.35; const hg = a.createGain(); hg.gain.value = 0.16; src.connect(hiss); hiss.connect(hg); hg.connect(out);
    const src2 = a.createBufferSource(); src2.buffer = s.white; src2.loop = true; src2.playbackRate.value = 0.61; const low = a.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 520; const lg = a.createGain(); lg.gain.value = 0.2; src2.connect(low); low.connect(lg); lg.connect(out);
    const roof = a.createBiquadFilter(); roof.type = 'bandpass'; roof.frequency.value = 1100; roof.Q.value = 1.4; const rg = a.createGain(); rg.gain.value = 0; src2.connect(roof); roof.connect(rg); rg.connect(out);      // on the roof, heard in a car
    src.start(); src2.start(0, 0.7); return { a, out, hiss, hg, rg }; };

  let last = performance.now(), sndT = 0;
  const tick = (t) => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (R.want === 0 && R.amt === 0 && R.wet === 0) { if (R.told) { R.told = false; const N0 = g.night; if (N0 && N0.setRain) N0.setRain(0); if (R.patched) w.shared.uWetK.value.set(0, 0, 0, 0); if (R.mesh) R.mesh.visible = false; if (R.splash) R.splash.visible = false; WET_U.uWetLN.value = 0; { const k0 = N0 && N0.kit; if (k0 && k0.pass) k0.pass.u.uWet.value = 0; } camOk = false; if (R.snd) R.snd.out.gain.setTargetAtTime(0, R.snd.a.currentTime, 0.2); } return; }      // dry
    R.told = true;
    R.amt += Math.max(-dt / 5, Math.min(dt / 4, R.want - R.amt)); if (Math.abs(R.amt - R.want) < 1e-4) R.amt = R.want;
    R.wet += R.amt > R.wet ? Math.min(dt / 9, R.amt - R.wet) : -Math.min(dt / 40, R.wet - R.amt); if (R.wet < 1e-4 && R.want === 0) R.wet = 0;      // roads wet in seconds, dry slowly
    { const n0 = g.night ? g.night.n || 0 : 0; if (R.patched) w.shared.uWetK.value.set(R.wet, TU.dark, 6.0 - 4.2 * n0, R.amt); }      // z: a cap on what the road may mirror (lamp heads at night would otherwise bloom into sheets)
    const N = g.night; if (N && N.tune && !R.fogSet) { R.fogSet = true; if (!P.has('NrainFog')) N.tune.rainFog = 10; }      /* light, rain 2: more mist in the distance (night.js has 7) */
    if (N && N.setRain) N.setRain(R.amt);
    R.t = t; { const cp = w.camera.position; if (camOk && dt > 0.001) { const vx = (cp.x - cam0.x) / dt, vy = (cp.y - cam0.y) / dt, vz = (cp.z - cam0.z) / dt; if (vx * vx + vy * vy + vz * vz < 70 * 70) { const kk = Math.min(1, dt * 6); camV.x += (vx - camV.x) * kk; camV.y += (vy - camV.y) * kk; camV.z += (vz - camV.z) * kk; } else camV.set(0, 0, 0); } cam0.copy(cp); camOk = true; }
    if (R.patched) try { wetLights(N, now, t); } catch (e) { fail('lights', e); }
    { const k1 = N && N.kit; if (k1 && k1.pass) k1.pass.u.uWet.value = R.wet; }      // the night kit's lamp pass: a wet road throws lamp light on, away from the eye
    if (R.amt > 0) { if (!R.mesh) { R.mesh = mkMesh(); try { R.splash = mkSplash(); } catch (e) { fail('splash', e); } }
      const u = R.mesh.material.uniforms; R.mesh.visible = true; lit(u, N, dt); u.uCamV.value.copy(camV); u.uShut.value = TU.shut;
      if (R.splash) { R.splash.visible = TU.splash > 0 && !R.low; const u2 = R.splash.material.uniforms; lit(u2, N, dt); u2.uGain.value = TU.splash; } }
    else { if (R.mesh) R.mesh.visible = false; if (R.splash) R.splash.visible = false; }
    if (!R.snd && R.amt > 0 && now - sndT > 1000) { sndT = now; try { R.snd = mkSound(); } catch (e) { fail('sound', e); } }
    if (R.snd) { const S = R.snd, tt = S.a.currentTime, car = !!g.player.vehicle, quiet = g.paused || document.hidden; S.out.gain.setTargetAtTime(quiet ? 0 : R.amt * 0.55 * (g.sound.streetK ?? 1), tt, 0.25); /* subway lane, Nov 16: quieter under the street (game.sound.streetK, set by subway/voice.js; unset = 1) */ S.hg.gain.setTargetAtTime(car ? 0.05 : 0.16, tt, 0.2); S.hiss.frequency.setTargetAtTime(car ? 2200 : 4200, tt, 0.2); S.rg.gain.setTargetAtTime(car ? 0.3 : 0, tt, 0.2); }
  };
  const render0 = w.render.bind(w);
  w.render = function (t, focus) { try { tick(t); } catch (e) { fail('tick', e); if (R.fails > 20) w.render = render0; } return render0(t, focus); };
  return R;
}
