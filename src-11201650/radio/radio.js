// radio/radio.js: the car radio. Five invented stations and Off. All the music is written and played by the game's own code (radio/synth.js, WebAudio
// oscillators and noise): there are no recordings and nothing is downloaded; synth.js itself is only fetched the first time the radio comes on.
//   in a car:  .  next station    ,  previous station    (controller: d-pad right / left)
//   the station's name, the track and the station's line show on the HUD for a few seconds (the line is text only: nobody speaks)
//   inside the car it sounds like a car radio (band-limited, a short cabin echo); get out and it is heard through the body, muffled, fading with
//   distance, and it stops a few metres away
//   volume: with the menu in, the radio plays into game.sound.bus.radio, which already follows the 'audio.radio' slider, the M key and the pause;
//   without it, into game.sound.out at game.settings 'audio.radio' if there are settings, else 0.8. The last station is kept in 'radio.station'.
// ?radio=0: this file is never fetched. ?radio=off: starts on Off whatever is stored. ?radio=on: on when you get in (as DEFAULT_ON = true), for tests.
// Costs one comparison a frame while the radio is off.
export const DEFAULT_ON = !(typeof window !== 'undefined' && window.__CFG && window.__CFG.public);      /* lead, Nov 14 (CHIEF 15:42Z, 16:15Z): On when you get in on Matt's private link so he hears it; Off on the public build until he says. */ //      // the lead's switch. false: a first-time player hears nothing until he picks a station (menu, Audio page, or . in a car). true: the radio is on when he gets in
const NEAR = 14, HOLD = 4.2;

export function install(game) {
  if (game.radio) return game.radio;
  const g = game, P = g.P || new URLSearchParams(location.search), S = () => g.settings || null;
  const get = (k, d) => { try { const s = S(); if (s && s.get) { const v = s.get(k, d); return v === undefined || v === null ? d : v; } } catch (e) {} return d; };
  const set = (k, v) => { try { const s = S(); if (s && s.set) s.set(k, v); } catch (e) {} };
  const R = (g.radio = { on: true, station: -1, want: -1, auto: (DEFAULT_ON || P.get('radio') === 'on') && P.get('radio') !== 'off', hinted: false, tuner: null, loading: null, car: null, inCar: false, vol: 0.8, level: 0, chain: null, names: ['Curbside 88.2', 'Night Bus 96.6', 'Uptown After Hours 91.4', 'The Stoop 104.4', 'Reservoir 99.0'], chosen: false, fails: 0 });
  const fail = (w, e) => { if (R.fails++ < 4) console.warn('[radio] ' + w + ': ' + String((e && e.stack) || e).slice(0, 300)); };
  const valid = (w) => typeof w === 'number' && w >= -1 && w < R.names.length && Math.floor(w) === w;
  { const w = get('radio.station', null); if (valid(w) && P.get('radio') !== 'off' && P.get('radio') !== 'on') { R.want = w; R.chosen = true; } }      // the player's own choice, once made, is kept
  const dest = () => { const s = g.sound; return (s.bus && s.bus.radio) || s.out; };
  const volNow = () => (g.sound.bus && g.sound.bus.radio ? 1 : Math.max(0, Math.min(1, +get('audio.radio', 0.8))));      // the bus already carries the slider: never applied twice
  R.vol = 0.8;

  // ---------------------------------------------------------------- the HUD chip
  let chip = null, chipT = 0;
  const show = (l1, l2, l3) => { try {
    if (!chip) { chip = document.createElement('div'); chip.id = 'radiochip'; chip.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:54;pointer-events:none;text-align:center;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:8px 18px 9px;border-radius:9px;border-left:3px solid #ffd27a;transition:opacity .5s;opacity:0;max-width:80vw;text-shadow:0 1px 2px #000'; document.body.appendChild(chip); }
    chip.textContent = ''; const a = document.createElement('div'); a.textContent = '♪ ' + l1; chip.appendChild(a);
    if (l2) { const b = document.createElement('div'); b.style.cssText = 'font:400 13px system-ui,sans-serif;opacity:.88;margin-top:2px'; b.textContent = l2; chip.appendChild(b); }
    if (l3 && get('subs.on', true) !== false) { const c = document.createElement('div'); c.style.cssText = 'font:italic 400 12px system-ui,sans-serif;opacity:.7;margin-top:3px'; c.textContent = l3; chip.appendChild(c); }
    chip.style.opacity = 1; chipT = performance.now() + HOLD * 1000; } catch (e) {} };
  const hideLater = () => { if (chip && chipT && performance.now() > chipT) { chip.style.opacity = 0; chipT = 0; } };

  // ---------------------------------------------------------------- the sound path: tuner -> car cabin -> volume -> the game's output
  const build = () => { const s = g.sound, a = s.ac; if (R.chain && R.chain.ac === a) return R.chain;
    const inp = a.createGain(), hp = a.createBiquadFilter(), lp = a.createBiquadFilter(), body = a.createBiquadFilter(), out = a.createGain(), cab = a.createConvolver(), cg = a.createGain();
    hp.type = 'highpass'; hp.frequency.value = 70; lp.type = 'lowpass'; lp.frequency.value = 7200; lp.Q.value = 0.5; body.type = 'peaking'; body.frequency.value = 170; body.Q.value = 0.9; body.gain.value = 3.5;      // small speakers in a closed box: a bump low down, no deep bass, no air on top
    const ir = a.createBuffer(2, Math.floor(a.sampleRate * 0.09), a.sampleRate); let q = 9001; for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) { q = (q * 1664525 + 1013904223) >>> 0; d[i] = (q / 2147483648 - 1) * Math.exp(-i / (a.sampleRate * 0.016)); } }
    cab.buffer = ir; cg.gain.value = 0.2; out.gain.value = 0;
    inp.connect(hp); hp.connect(body); body.connect(lp); lp.connect(out); lp.connect(cab); cab.connect(cg); cg.connect(out); const to = dest(); out.connect(to);
    return (R.chain = { ac: a, inp, lp, body, out, cg, to }); };
  const rewire = () => { const c = R.chain, to = dest(); if (c && c.to !== to) { try { c.out.disconnect(); } catch (e) {} c.out.connect(to); c.to = to; } };      // the buses appear when the menu's sound hook runs, which may be after the radio first played
  const setLevel = (inside, k) => { const c = R.chain; if (!c) return; const t = c.ac.currentTime, v = R.vol * (inside ? 0.9 : 0.4 * k); R.level = v;
    c.out.gain.setTargetAtTime(v, t, 0.07); c.lp.frequency.setTargetAtTime(inside ? 7200 : 420, t, 0.06); c.cg.gain.setTargetAtTime(inside ? 0.2 : 0.0, t, 0.06); c.body.gain.setTargetAtTime(inside ? 3.5 : 7, t, 0.06); };

  const play = async (i, quiet) => {
    R.want = i; const s = g.sound; if (!s || !s.on || !s.ac) return false;
    if (i < 0) { if (R.tuner) { R.tuner.stop(); if (!quiet) R.tuner.static_(0.12 * R.vol); } R.station = -1; if (!quiet) show('Radio off'); return true; }
    if (!R.tuner) { if (!R.loading) R.loading = import('./synth.js').then((m) => { const c = build(); R.tuner = m.makeTuner(c.ac, c.inp); R.names = R.tuner.stations.map((x) => x.name); }).catch((e) => { fail('load', e); R.on = false; });
      await R.loading; if (!R.tuner) return false; if (R.want !== i) return false; }
    build(); if (!quiet) R.tuner.static_(0.16 * R.vol);
    const def = R.tuner.stations[i]; let first = true;
    R.tuner.tune(i, (st) => { if (R.station !== i && !first) return; const line = def.lines[(st.trackN + i) % def.lines.length]; if (first) { first = false; if (!quiet) show(def.name, '“' + st.nowTitle + '” · ' + st.nowAct, def.tag); } else if (R.inCar) show(def.name, '“' + st.nowTitle + '” · ' + st.nowAct, line); });
    R.station = i; return true; };
  const stopNow = () => { if (R.tuner) R.tuner.stop(); R.station = -1; if (R.chain) R.chain.out.gain.setTargetAtTime(0, R.chain.ac.currentTime, 0.05); };
  const step = (d) => { if (!R.on || !R.inCar) return; const n = R.names.length; let i = R.want + d; if (i >= n) i = -1; if (i < -1) i = n - 1; R.chosen = true; R.want = i; set('radio.station', i); if (!R.busy) { R.busy = true; play(i).catch((e) => fail('play', e)).finally(() => { R.busy = false; }); } };
  R.next = () => step(1); R.prev = () => step(-1); R.set = (i) => { R.chosen = true; return play(i); }; R.setVolume = () => { R.vol = volNow(); };
  R.info = () => ({ on: R.on, inCar: R.inCar, station: R.station, want: R.want, name: R.station >= 0 ? R.names[R.station] : 'Off', level: +R.level.toFixed(3), vol: R.vol, into: R.chain ? (g.sound.bus && R.chain.to === g.sound.bus.radio ? 'bus.radio' : 'sound.out') : null, loaded: !!R.tuner, now: R.tuner ? R.tuner.now() : null });

  const ok = () => !g.paused && !window.__startScreen && !(g.fly && g.fly.on) && !g.demo;
  addEventListener('keydown', (e) => { if (e.repeat || !R.on || !R.inCar || !ok()) return; if (e.target && e.target.closest && e.target.closest('input,textarea,#fbbox')) return; if (e.code === 'Period') step(1); else if (e.code === 'Comma') step(-1); });
  try { const m = g.menu; if (m && m.addKey) { m.addKey({ code: 'Period', label: 'Radio: next station', group: 'Radio' }); m.addKey({ code: 'Comma', label: 'Radio: previous station', group: 'Radio' }); }
    // the menu's Audio page: Off or one of the stations. Chosen while paused, it is taken up on the first frame after (upd below: the station follows R.want)
    if (m && m.addSetting) m.addSetting('audio', { key: 'radio.station', label: 'Car radio', type: 'choice', options: [[-1, 'Off']].concat(R.names.map((n, i) => [i, n.replace(/ [\d.]+$/, '').replace(' After Hours', '')])), dflt: -1, hint: 'Plays in a car. In the car: . next station, , previous' });
    const st = S(); if (st && st.on) st.on('radio.station', (v) => { if (v === undefined || v === null) v = -1; v = +v; if (!valid(v)) return; R.want = v; R.chosen = true; }); } catch (e) { fail('menu', e); }

  // ---------------------------------------------------------------- once a frame (inside the game's own sound update)
  let padL = false, padR = false, pauseT = null, lastSet = 0;
  const upd = (dt) => { const pl = g.player, v = pl.vehicle || null, s = g.sound;
    if (!s.on) return;
    if (v && !R.inCar) { R.inCar = true; R.car = v; if (!R.chosen && R.auto) { let h = 7; for (const ch of String(v.color) + (v.type || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; R.want = h % R.names.length; }      // (radio on by default) a car nobody has tuned yet is on whatever its last driver left on
      if (R.want < 0 && !R.hinted && !g.demo) { R.hinted = true; show('Radio off', 'Press ' + (g.menu && g.menu.keyName ? g.menu.keyName('Period') : '.') + ' to turn it on'); }      // said once a session
      else if (R.station >= 0 && R.station === R.want) show(R.names[R.station]); }
    else if (!v && R.inCar) R.inCar = false;
    if (v && R.station !== R.want && !R.busy) { R.busy = true; play(R.want, R.want < 0).catch((e) => fail('play', e)).finally(() => { R.busy = false; }); }      // the station follows what is wanted: the keys, the menu row, getting in
    if (R.station < 0 && !chipT) return;
    hideLater(); if (R.station < 0) return;
    if (v) { const now = performance.now(); if (now - lastSet > 200) { lastSet = now; rewire(); R.vol = volNow(); setLevel(true, 1); }
      let l = false, r = false; try { const all = navigator.getGamepads ? navigator.getGamepads() : []; for (const q of all) if (q && q.connected && q.buttons) { if (q.buttons[14] && q.buttons[14].pressed) l = true; if (q.buttons[15] && q.buttons[15].pressed) r = true; } } catch (e) {}
      if (r && !padR && ok()) step(1); if (l && !padL && ok()) step(-1); padL = l; padR = r; }
    else { const c = R.car, d = c && !c.gone ? Math.hypot(c.x - pl.x, c.y - pl.y) : 99; if (d > NEAR) { stopNow(); return; } const k = 1 - d / NEAR; setLevel(false, k * k); }
    if (!pauseT) pauseT = setInterval(() => { if (R.station < 0) { clearInterval(pauseT); pauseT = null; return; } const c = R.chain; if (c && (g.paused || document.hidden)) c.out.gain.setTargetAtTime(0, c.ac.currentTime, 0.05); else if (c && g.player.vehicle) lastSet = 0; }, 300);
  };
  const up0 = g.sound.update.bind(g.sound);
  g.sound.update = function (dt) { up0(dt); if (R.on) try { upd(dt); } catch (e) { fail('update', e); if (R.fails > 20) R.on = false; } };

  return R;
}
