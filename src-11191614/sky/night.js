// sky/night.js: the clock and the night. Time of day moves (when the cycle is on) and the light follows it: day, a warm low-light evening, night, dawn.
//   N            steps the clock: noon, golden hour, dusk, night, small hours, dawn (works with the cycle on or off)
//   ?tod=22      start at that hour (0..24)       ?cycle=1 / ?cycle=0   the clock runs / stands (default: DEFAULT_CYCLE below)
//   settings     'world.cycle' (true/false) and 'world.tod' (hour) when game.settings is there; game.night.set(hour), game.night.info()
//   ?night=0     this file is never fetched
// WHAT NIGHT IS HERE, PLAINLY. The city's light is split three ways already (facade.js BAKE_LIGHT_GLSL): the sun is a real light with a shadow map near
// the camera; sky light is the sky picture times a BAKED sky-visibility number; and beyond 110-140 m the sun's shadow, and everywhere the sun's
// first bounce, are BAKED for the one sun direction of the build. So the sun cannot cross the sky: baked far shadows and bounce would be wrong. What CAN
// change honestly is how strong and what colour each of the three is, and that is what the clock drives: the sun dims and warms and goes out, a weak
// blue "moon" takes its place IN THE SAME DIRECTION (so every baked shadow still agrees), the sky light drops to a twentieth, the sky dome dims and
// gets stars. Lamps, headlights, lit windows and the rest are in nightkit.js, fetched the first time the light leaves full day.
// By day (07:30 to 17:30) nothing here touches the picture: every changed number is put back to the exact value it had, the extra pass is off and the
// kit's meshes are hidden. One comparison a frame.
import { LIGHT } from '../world.js';

export const DEFAULT_CYCLE = false;      // the lead's switch: true = the clock runs for every player (a day lasts DAY_MIN minutes)
const DAY_MIN = 48, STEPS = [12, 18.2, 19.3, 22, 2, 6.4];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;
// 0 by day, 1 at night; the evening runs 17:30 to 20:00, the morning 05:00 to 07:30
export const nightOf = (h) => (h >= 20 || h < 5 ? 1 : h >= 17.5 ? sm(17.5, 20, h) : h < 7.5 ? 1 - sm(5, 7.5, h) : 0);

export function install(game) {
  if (game.night) return game.night;
  const g = game, w = g.world, P = g.P || new URLSearchParams(location.search);
  const get = (k, d) => { try { const s = g.settings; if (s && s.get) { const v = s.get(k, d); return v === undefined || v === null ? d : v; } } catch (e) {} return d; };
  const N = (g.night = { tod: 12, n: 0, cycle: DEFAULT_CYCLE, kit: null, loading: null, active: false, fails: 0, nightOf, saved: null, lampOn: 0, headOn: 0, rain: 0 });
  if (P.has('cycle')) N.cycle = P.get('cycle') !== '0'; else N.cycle = !!get('world.cycle', DEFAULT_CYCLE);
  if (P.has('tod') && isFinite(+P.get('tod'))) N.tod = ((+P.get('tod') % 24) + 24) % 24; else { const t0 = +get('world.tod', 12); if (isFinite(t0)) N.tod = ((t0 % 24) + 24) % 24; }
  const fail = (where, e) => { if (N.fails++ < 4) console.warn('[night] ' + where + ': ' + String((e && e.stack) || e).slice(0, 400)); };

  // ---------------------------------------------------------------- what the clock changes, and the exact day values to put back
  const save = () => { const s = (N.saved = {}); s.I = w.sun.intensity; s.col = w.sun.color.clone(); s.uSun = w.shared.uSunColor.value.clone(); s.env = w.scene.environmentIntensity; s.fog = w.scene.fog.color.clone(); s.fogD = w.scene.fog.density;
    s.gain = w.skyMesh.material.uniforms.uGain.value; s.key = LIGHT.key; s.ltmH = LIGHT.ltmH; s.pk = w.expMat.uniforms.uPk.value; s.expMax = LIGHT.expMax;
    if (w.bloom) { s.bS = w.bloom.strength; s.bT = w.bloom.threshold; s.bR = w.bloom.radius; } };
  const restore = () => { const s = N.saved; if (!s) return; w.sun.intensity = s.I; w.sun.color.copy(s.col); w.shared.uSunColor.value.copy(s.uSun); w.scene.environmentIntensity = s.env; w.scene.fog.color.copy(s.fog); w.scene.fog.density = s.fogD;
    w.skyMesh.material.uniforms.uGain.value = s.gain; LIGHT.key = s.key; LIGHT.ltmH = s.ltmH; LIGHT.expMax = s.expMax; w.expMat.uniforms.uPk.value = s.pk; if (w.setLtm) w.setLtm();
    if (w.bloom) { w.bloom.strength = s.bS; w.bloom.threshold = s.bT; w.bloom.radius = s.bR; }
    N.lampOn = 0; N.headOn = 0; N.n = 0; if (N.kit) N.kit.apply(0, N); N.saved = null; N.active = false; };
  const T = (N.tune = { moon: 0.016, env: 0.045, sky: 0.016, key: 0.105, expMax: 3.2, bloomS: 0.42, bloomT: 0.55, fog: 0.022, rainFog: 7 });
  for (const k in T) if (P.has('N' + k)) T[k] = +P.get('N' + k);      // ?Nmoon=0.03 and so on, for tests
  const _c = { r: 0, g: 0, b: 0 };
  const apply = (n) => { if (!N.saved) save(); const s = N.saved, r = N.rain; N.active = true; N.n = n;
    const sunK = 1 - sm(0.0, 0.55, n), moonK = sm(0.6, 1, n), warm = sm(0.0, 0.3, n) * sunK;      // the sun is gone a little past half way; the moon comes up after
    const I = s.I * (sunK * (1 - 0.55 * sm(0, 0.5, n)) + moonK * T.moon) * (1 - 0.93 * r);      // rain: an overcast sky lets little of the sun through (its shadows nearly go)
    _c.r = s.col.r * (sunK * 1.0 + moonK * 0.62); _c.g = s.col.g * (sunK * mix(1, 0.62, warm) + moonK * 0.76); _c.b = s.col.b * (sunK * mix(1, 0.34, warm) + moonK * 1.0); const mx = Math.max(_c.r, _c.g, _c.b, 1e-4);
    w.sun.color.setRGB(_c.r / mx, _c.g / mx, _c.b / mx); w.sun.intensity = Math.max(I, 1e-4); w.shared.uSunColor.value.copy(w.sun.color).multiplyScalar(w.sun.intensity / Math.PI);
    const e = sm(0, 1, n); w.scene.environmentIntensity = s.env * mix(1, T.env, e) * (1 - 0.3 * r);
    w.skyMesh.material.uniforms.uGain.value = s.gain * mix(1, T.sky, Math.pow(n, 0.8)) * (1 - 0.4 * r);
    const fk = mix(1, T.fog, e) * (1 - 0.25 * r), gy = (s.fog.r + s.fog.g + s.fog.b) / 3; w.scene.fog.color.setRGB(mix(s.fog.r, gy, 0.8 * r) * fk * mix(1, 1.25, warm), mix(s.fog.g, gy, 0.8 * r) * fk, mix(s.fog.b, gy * 1.04, 0.8 * r) * fk * mix(1, 0.9, warm)); w.scene.fog.density = s.fogD * (1 + T.rainFog * r);
    LIGHT.key = mix(s.key, T.key, e) * (1 - 0.1 * r); LIGHT.expMax = mix(s.expMax, T.expMax, e); LIGHT.ltmH = s.ltmH * (1 - e); w.expMat.uniforms.uPk.value = n > 0.5 ? 0 : s.pk; if (w.setLtm) w.setLtm();
    if (w.bloom) { w.bloom.strength = mix(s.bS, T.bloomS, e); w.bloom.threshold = mix(s.bT, T.bloomT, e); }
    N.lampOn = sm(0.22, 0.5, n); N.headOn = Math.max(N.lampOn, Math.min(1, r * 1.5));      // street lamps and headlights come on as the evening goes
    if (N.kit) N.kit.apply(n, N);
    else if (!N.loading) N.loading = import('./nightkit.js').then((m) => m.makeKit(g, N)).then((k) => { N.kit = k; }).catch((e2) => { fail('kit', e2); }); };

  // ---------------------------------------------------------------- the clock
  let chip = null, chipT = 0;
  const say = (txt) => { try { if (!chip) { chip = document.createElement('div'); chip.id = 'todchip'; chip.style.cssText = 'position:fixed;left:50%;top:104px;transform:translateX(-50%);z-index:54;pointer-events:none;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:6px 14px;border-radius:8px;transition:opacity .5s;opacity:0'; document.body.appendChild(chip); } chip.textContent = txt; chip.style.opacity = 1; clearTimeout(chipT); chipT = setTimeout(() => { chip.style.opacity = 0; }, 2200); } catch (e) {} };
  const hhmm = (h) => { const m = Math.floor(h * 60 + 0.5) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  N.set = (h) => { N.tod = ((+h % 24) + 24) % 24; N.dirty = true; return N.tod; };
  N.setCycle = (on) => { N.cycle = !!on; };
  N.setRain = (r) => { r = Math.min(1, Math.max(0, +r || 0)); if (r !== N.rain) { N.rain = r; N.dirty = true; } };      // sky/rain.js: how hard it rains; the light goes overcast with it
  N.info = () => ({ tod: +N.tod.toFixed(2), clock: hhmm(N.tod), night: +N.n.toFixed(3), cycle: N.cycle, active: N.active, kit: !!N.kit, lampOn: +N.lampOn.toFixed(2), kitInfo: N.kit && N.kit.info ? N.kit.info() : null });
  addEventListener('keydown', (e) => { if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (window.__startScreen) return;
    N.stepI = ((N.stepI || 0) + 1) % STEPS.length;
    N.set(STEPS[N.stepI]); say('Time ' + hhmm(N.tod)); try { const s = g.settings; if (s && s.set) s.set('world.tod', N.tod); } catch (e2) {} });
  try { const m = g.menu; if (m && m.addSetting) { m.addSetting('graphics', { key: 'world.cycle', label: 'Day and night', type: 'toggle', dflt: DEFAULT_CYCLE, hint: 'The clock runs: a day lasts ' + DAY_MIN + ' minutes' }); m.addSetting('graphics', { key: 'world.tod', label: 'Time of day', type: 'slider', min: 0, max: 23.5, step: 0.5, dflt: 12, fmt: (v) => hhmm(+v) }); if (m.addKey) m.addKey({ code: 'KeyN', label: 'Time of day: next', group: 'Camera and system' }); } } catch (e) {}
  try { const s = g.settings; if (s && s.on) { s.on('world.cycle', (v) => N.setCycle(v)); s.on('world.tod', (v) => { if (isFinite(+v) && Math.abs(+v - N.tod) > 0.01) N.set(+v); }); } } catch (e) {}

  let last = performance.now(), lastN = -1;
  const tick = () => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (N.cycle && !g.paused) N.tod = (N.tod + dt * 24 / (DAY_MIN * 60)) % 24;
    const n = nightOf(N.tod); if (n <= 0 && N.rain <= 0) { if (N.active) { restore(); lastN = -1; } return; }
    if (n !== lastN || N.dirty || (N.kit && !N.kitApplied)) { N.dirty = false; apply(n); N.kitApplied = !!N.kit; lastN = n; }
    if (N.kit) N.kit.frame(n, N); };
  const render0 = w.render.bind(w);
  w.render = function (t, focus) { try { tick(); } catch (e) { fail('tick', e); if (N.fails > 20) { try { restore(); } catch (e2) {} w.render = render0; } } return render0(t, focus); };
  return N;
}
