// sky/rain.js: rain. Wet roads and sidewalks that mirror the street (sky/wet.glsl.js, through the patched ground shaders), falling streaks round the
// camera, a rain sound, and (through sky/night.js, when it is there) an overcast light: weaker sun, grey sky, thicker haze.
//   Y            rain on / off (it comes and goes over a few seconds)         ?rain=1 starts raining; ?rain=0.5 a light rain
//   settings     'world.rain' (0..1) when game.settings is there; game.rain.set(0..1), game.rain.info()
//   ?rain=off    this file is never fetched (the game.js line reads ?rain=off)
// Dry, it costs one comparison a frame and one uniform test in the ground shaders; the streak mesh and the sound are made the first time it rains.
// NOT done: wipers, drops on the camera or the windscreen, splashes from tyres, wet car bodies and walls, rain stopping under awnings or bridges.
import * as THREE from 'three';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const NDROP = 7000, BOX = [34, 22, 34];

export function install(game) {
  if (game.rain) return game.rain;
  const g = game, w = g.world, P = g.P || new URLSearchParams(location.search);
  const get = (k, d) => { try { const s = g.settings; if (s && s.get) { const v = s.get(k, d); return v === undefined || v === null ? d : v; } } catch (e) {} return d; };
  const R = (g.rain = { want: 0, amt: 0, wet: 0, mesh: null, snd: null, patched: !!w.shared.uWetK, fails: 0 });
  const fail = (where, e) => { if (R.fails++ < 4) console.warn('[rain] ' + where + ': ' + String((e && e.stack) || e).slice(0, 300)); };
  { const q = P.get('rain'); if (q !== null && q !== '' && isFinite(+q)) R.want = Math.min(1, Math.max(0, +q)); else if (q === '' ) R.want = 1; else R.want = Math.min(1, Math.max(0, +get('world.rain', 0) || 0)); }
  if (!R.patched) console.log('[rain] ground shader patch not there: roads stay dry');
  R.set = (v) => { R.want = Math.min(1, Math.max(0, +v || 0)); return R.want; };
  R.info = () => ({ want: R.want, falling: +R.amt.toFixed(3), wet: +R.wet.toFixed(3), streaks: !!R.mesh, sound: !!R.snd, roads: R.patched });
  let chip = null, chipT = 0;
  const say = (txt) => { try { if (!chip) { chip = document.createElement('div'); chip.style.cssText = 'position:fixed;left:50%;top:104px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:6px 14px;border-radius:8px;transition:opacity .5s;opacity:0'; document.body.appendChild(chip); } chip.textContent = txt; chip.style.opacity = 1; clearTimeout(chipT); chipT = setTimeout(() => { chip.style.opacity = 0; }, 2200); } catch (e) {} };
  addEventListener('keydown', (e) => { if (e.code !== 'KeyY' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || R.key === false) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (window.__startScreen) return; R.set(R.want > 0 ? 0 : 1); say(R.want ? 'Rain' : 'Rain stops'); try { const s = g.settings; if (s && s.set) s.set('world.rain', R.want > 0); } catch (e2) {} });
  try { const m = g.menu; if (m && m.addSetting) { m.addSetting('graphics', { key: 'world.rain', label: 'Rain', type: 'toggle', dflt: false }); if (m.addKey) m.addKey({ code: 'KeyY', label: 'Rain on / off', group: 'Camera and system' }); } } catch (e) {}
  try { const s = g.settings; if (s && s.on) s.on('world.rain', (v) => { if (Math.abs((+v || 0) - R.want) > 0.01) R.set(+v || 0); }); } catch (e) {}

  const mkMesh = () => { const base = new THREE.PlaneGeometry(2, 1), geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position);
    const seed = new Float32Array(NDROP * 3); let s = 4321; for (let i = 0; i < seed.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; seed[i] = s / 4294967296; } geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3)); geo.instanceCount = NDROP;
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uBox: { value: new THREE.Vector3(...BOX) }, uVel: { value: new THREE.Vector3(1.6, -11, 0.7) }, uAmt: { value: 0 }, uLum: { value: 1 }, uLen: { value: 0.55 } },
      vertexShader: `attribute vec3 aSeed; uniform float uT, uAmt, uLen; uniform vec3 uBox, uVel; varying vec2 vQ; varying float vA;
        void main(){ float k = 0.8 + 0.4 * fract(aSeed.x * 91.3 + aSeed.z * 17.7); vec3 rel = mod(aSeed * uBox + uVel * (uT * k) - cameraPosition, uBox) - 0.5 * uBox; vec3 wp = cameraPosition + rel;
          vec3 fall = normalize(uVel); vec3 view = normalize(rel); vec3 side = normalize(cross(fall, view)); float dist = length(rel);
          wp += -fall * (position.y + 0.5) * uLen * k + side * position.x * (0.004 + dist * 0.0009);
          vQ = vec2(position.x, position.y + 0.5); vA = step(fract(aSeed.y * 53.1 + aSeed.x * 7.7), uAmt) * smoothstep(0.6, 2.0, dist) * (1.0 - smoothstep(uBox.x * 0.36, uBox.x * 0.5, dist));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `uniform float uLum; varying vec2 vQ; varying float vA; void main(){ float a = (1.0 - abs(vQ.x)) * smoothstep(0.0, 0.25, vQ.y) * smoothstep(1.0, 0.6, vQ.y) * vA * 0.34; gl_FragColor = vec4(vec3(0.78, 0.82, 0.88) * uLum, a); }` });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 7; m.matrixAutoUpdate = false; m.name = 'rain_streaks'; w.scene.add(m); return m; };
  const mkSound = () => { const s = g.sound; if (!s || !s.on || !s.ac || !s.white) return null; const a = s.ac, out = a.createGain(); out.gain.value = 0; out.connect(s.out);
    const src = a.createBufferSource(); src.buffer = s.white; src.loop = true; const hiss = a.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 4200; hiss.Q.value = 0.35; const hg = a.createGain(); hg.gain.value = 0.16; src.connect(hiss); hiss.connect(hg); hg.connect(out);
    const src2 = a.createBufferSource(); src2.buffer = s.white; src2.loop = true; src2.playbackRate.value = 0.61; const low = a.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 520; const lg = a.createGain(); lg.gain.value = 0.2; src2.connect(low); low.connect(lg); lg.connect(out);
    const roof = a.createBiquadFilter(); roof.type = 'bandpass'; roof.frequency.value = 1100; roof.Q.value = 1.4; const rg = a.createGain(); rg.gain.value = 0; src2.connect(roof); roof.connect(rg); rg.connect(out);      // on the roof, heard in a car
    src.start(); src2.start(0, 0.7); return { a, out, hiss, hg, rg }; };

  let last = performance.now(), sndT = 0;
  const tick = (t) => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (R.want === 0 && R.amt === 0 && R.wet === 0) { if (R.told) { R.told = false; const N0 = g.night; if (N0 && N0.setRain) N0.setRain(0); if (R.patched) w.shared.uWetK.value.set(0, 0, 0, 0); if (R.mesh) R.mesh.visible = false; if (R.snd) R.snd.out.gain.setTargetAtTime(0, R.snd.a.currentTime, 0.2); } return; }      // dry
    R.told = true;
    R.amt += Math.max(-dt / 5, Math.min(dt / 4, R.want - R.amt)); if (Math.abs(R.amt - R.want) < 1e-4) R.amt = R.want;
    R.wet += R.amt > R.wet ? Math.min(dt / 9, R.amt - R.wet) : -Math.min(dt / 40, R.wet - R.amt); if (R.wet < 1e-4 && R.want === 0) R.wet = 0;      // roads wet in seconds, dry slowly
    { const n0 = g.night ? g.night.n || 0 : 0; if (R.patched) w.shared.uWetK.value.set(R.wet, 0.42, 6.0 - 4.2 * n0, R.amt); }      // z: a cap on what the road may mirror (lamp heads at night would otherwise bloom into sheets)
    const N = g.night; if (N && N.setRain) N.setRain(R.amt);
    if (R.amt > 0) { if (!R.mesh) R.mesh = mkMesh(); const u = R.mesh.material.uniforms; R.mesh.visible = true; u.uT.value = t; u.uAmt.value = R.amt;
      const n = N ? N.n || 0 : 0; u.uLum.value = 0.05 + 0.85 * (1 - n) * (1 - 0.45 * R.amt); }
    else if (R.mesh) R.mesh.visible = false;
    if (!R.snd && R.amt > 0 && now - sndT > 1000) { sndT = now; try { R.snd = mkSound(); } catch (e) { fail('sound', e); } }
    if (R.snd) { const S = R.snd, tt = S.a.currentTime, car = !!g.player.vehicle, quiet = g.paused || document.hidden; S.out.gain.setTargetAtTime(quiet ? 0 : R.amt * 0.55 * (g.sound.streetK ?? 1), tt, 0.25); /* subway lane, Nov 16: quieter under the street (game.sound.streetK, set by subway/voice.js; unset = 1) */ S.hg.gain.setTargetAtTime(car ? 0.05 : 0.16, tt, 0.2); S.hiss.frequency.setTargetAtTime(car ? 2200 : 4200, tt, 0.2); S.rg.gain.setTargetAtTime(car ? 0.3 : 0, tt, 0.2); }
  };
  const render0 = w.render.bind(w);
  w.render = function (t, focus) { try { tick(t); } catch (e) { fail('tick', e); if (R.fails > 20) w.render = render0; } return render0(t, focus); };
  return R;
}
