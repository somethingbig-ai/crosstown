// horn.js: THE HORN (gameplay lane, Nov 18; CHIEF's 22:15 list: "a horn key in any car the player drives, heard, traffic and people ahead react").
// Hook, ONE line in Game.init after the padui.js line:
//     try { (await import('./horn.js')).install(this); } catch (e) { console.log('[horn] not loaded: ' + (e && e.message)); }
// Off: ?horn=0 (nothing is wrapped, no key is read).   ?hornsynth=1: the synthesised horns even when the recorded clips are in.
// KEY G (logical code KeyG: rebindable in the menu; in the helicopter G stays "mouse flies / mouse looks", and the two never meet: the
// horn is only read at the wheel). PAD: L3, the left stick's click, while driving (on foot L3 is still run). Held = the horn sounds until
// let go, a tap = a short beep (0.14 s at least).
// THE SOUND, by what he drives: car / taxi (the traffic's own recorded horn clip when sfx has it, its steady middle looped while held,
// else two saw notes a major third apart as drivers.js makes them), truck and van (the truck clip, or the notes an octave down), bus (an
// air horn: the truck clip slowed, or three low notes), motorcycle (a thin high beep), a taken bicycle or e-bike (a bell: one ding), a police car (a siren yelp). Through the game's
// own audio context and the "Sirens and horns" slider (game.sound.bus.sirens). Nothing is fetched; no new asset.
// WHAT REACTS (once on the press, again every 0.9 s while it is held):
//   traffic   cars of game.traffic going his way, directly ahead (within 2.2 m of his line) and within 25 m, stopped or under 9 m/s:
//             the driver MOVES ASIDE into the next lane if traffic.js's own laneFree rule says it is free (the player's own car behind him
//             is not counted against it), and PULLS FORWARD: his cruising speed c.v0 is raised for six seconds, then put back. Only v0 and
//             the lane are touched, exactly as traffic.js and drivers.js touch them, so every rule of traffic.js still holds: a car at a
//             red light stays at its line, a car that yields at a junction still yields, a car behind another still keeps its gap.
//             Nothing is ever pushed through anything (no ghost). Left alone: a stalled car (stun), a dead driver, a driver drivers.js
//             already holds (gunfire, a siren), and anything that is not game.traffic's (police cars: honking at them does nothing).
//   people    through the world helper's scare.js (game.__world), its public calls only, nothing of the people files is edited:
//             someone ON THE ROADWAY ahead within 15 m and in or near his path hurries clear after a human beat (the crowd: scare's
//             sideStep, a short jog to the side they were already heading for, else the nearer side; the kit pedestrians: scare's
//             level-1 note with the car as its cause); someone on the PAVEMENT near his line glances at most (two in five, scare's
//             level-0 note with a short look). Nobody already afraid, sitting, down or jumping clear is touched. With ?scare=0 people do not react.
// Cost: nothing while not driving; at the wheel one key test a frame and one getGamepads(); a honk looks once at the cars and people near.
const HOLD_EVERY = 0.9, CAR_AHEAD = 25, CAR_SIDE = 2.2, CAR_SLOW = 9, BOOST_T = 6, PED_AHEAD = 15, MIN_BEEP = 0.14;
export function install(game) {
  if (game.__horn) return game.__horn;
  const S = (game.__horn = { on: true, key: 'KeyG', pad: 10, held: false, kind: '', honks: 0, voice: null, err: null, stats: { cars: 0, sped: 0, aside: 0, road: 0, glance: 0, sounds: 0 } });
  const P = game.P; if (P && P.get && P.get('horn') === '0') { S.on = false; return S; }
  const SYNTH = !!(P && P.get && P.get('hornsynth') === '1');
  let seed = 424243, t = 0, reactT = 0, lastFrame = 0, watch = 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const boosts = new Map(), pend = [];
  const fail = (e) => { if (!S.err) { S.err = String((e && (e.stack || e.message)) || e).slice(0, 400); console.log('[horn] ' + S.err); } };

  // ---------------------------------------------------------------- what he is driving
  const kindOf = (v) => { const d = v.def || {}, ty = String(d.type || v.type || ''); if (v.bike) return 'bell';      /* gameplay/takeover bike: a bicycle or e-bike he has taken rings a bell */ if (v.moto || ty === 'moto') return 'moto'; if (v.police || /police|cruiser|patrol/i.test(ty + ' ' + (d.name || ''))) return 'police'; if (ty === 'bus') return 'bus'; if (/truck|van|box|semi/.test(ty) || d.len > 6) return 'truck'; return ty === 'taxi' ? 'taxi' : 'car'; };
  const driving = () => { const g = game, pl = g.player, v = pl && pl.vehicle, h = g.heli; if (!v || !v.def || pl.busy || g.demo || g.paused || (g.fly && g.fly.on) || (h && (h.piloted || h.busy)) || (typeof window !== 'undefined' && window.__startScreen)) return null; return v; };
  const typing = () => { try { const a = document.activeElement; return !!(a && a.closest && a.closest('input,textarea,#fbbox')); } catch (e) { return false; } };
  const padDown = () => { try { const all = navigator.getGamepads ? navigator.getGamepads() : []; let gp = null; for (const q of all) if (q && q.connected && q.axes.length >= 2 && q.buttons.length >= 4 && (!gp || (q.mapping === 'standard' && gp.mapping !== 'standard'))) gp = q; const b = gp && gp.mapping === 'standard' && gp.buttons[S.pad]; return !!(b && (b.pressed || b.value > 0.5)); } catch (e) { return false; } };

  // ---------------------------------------------------------------- the sound: one voice, started on the press, let go on the release
  const VO = { car: { clip: ['horn.long.0', 'horn.car.0'], rate: 1, f: [392, 494], lp: 5200 }, taxi: { clip: ['horn.long.0', 'horn.car.0'], rate: 1.07, f: [430, 542], lp: 5200 },
    truck: { clip: ['horn.truck.0'], alt: 0.72, rate: 1, f: [185, 233], lp: 3600 }, bus: { clip: ['horn.truck.0'], alt: 0.62, rate: 0.84, f: [155, 196, 233], lp: 3000 },
    moto: { clip: ['horn.car.0'], rate: 1.55, f: [560], hp: 800, lp: 6500, vol: 0.7, wave: 'square' }, police: { yelp: true, lp: 4200 }, bell: { bell: true, f: [2093, 3136, 5274], lp: 9000, vol: 1.1 } };
  function start(kind) {
    const s = game.sound; if (!s || !s.on || !s.ac || !s.out || game.capture || s.ac.state !== 'running') return null;
    const a = s.ac, now = a.currentTime, V = VO[kind] || VO.car, out = (s.bus && s.bus.sirens) || s.out, gain = a.createGain(), lp = a.createBiquadFilter(), src = [];
    lp.type = 'lowpass'; lp.frequency.value = V.lp || 5000; let head = lp; if (V.hp) { const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = V.hp; hp.connect(lp); head = hp; }
    const vol = 0.2 * (V.vol || 1); gain.gain.value = 0; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(vol, now + 0.016); lp.connect(gain); gain.connect(out);
    const B = !SYNTH && !V.yelp && !V.bell && s.sfx && s.sfx.buf; let buf = null, rate = V.rate || 1;
    if (B) { for (const n of V.clip) if (B[n]) { buf = B[n]; break; } if (!buf && V.alt && B['horn.car.0']) { buf = B['horn.car.0']; rate = V.alt; } }
    if (V.bell) {      // a bicycle bell: one struck ding (three sine partials dying away over a second); it rings out whether the key is held or tapped
      V.f.forEach((f, i) => { const o = a.createOscillator(), g2 = a.createGain(); o.type = 'sine'; o.frequency.value = f; g2.gain.setValueAtTime([1, 0.5, 0.22][i] || 0.2, now); g2.gain.exponentialRampToValueAtTime(0.001, now + 1.1 - i * 0.25); o.connect(g2); g2.connect(head); o.start(now); o.stop(now + 1.15); src.push(o); });
      src[0].onended = () => { try { gain.disconnect(); } catch (e) {} }; S.stats.sounds++; return { a, gain, src, t0: now, vol, bell: true };
    }
    if (buf && buf.duration >= 0.3) {      // the recorded horn: its attack as recorded, then its steady middle goes round while the button is down
      const b = a.createBufferSource(), g2 = a.createGain(); b.buffer = buf; b.playbackRate.value = rate; b.loop = true; b.loopStart = buf.duration * 0.3; b.loopEnd = buf.duration * 0.7; g2.gain.value = 5; b.connect(g2); g2.connect(head); b.start(now); src.push(b);
    } else if (V.yelp) {      // a siren's yelp: one saw swept up and down three times a second through a horn's body
      const o = a.createOscillator(), l = a.createOscillator(), lg = a.createGain(), pk = a.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 1050; l.type = 'triangle'; l.frequency.value = 3.2; lg.gain.value = 430; l.connect(lg); lg.connect(o.frequency);
      pk.type = 'peaking'; pk.frequency.value = 1500; pk.Q.value = 1.2; pk.gain.value = 9; o.connect(pk); pk.connect(head); o.start(now); l.start(now); src.push(o, l);
    } else {      // the notes of drivers.js's horn: saws through a small horn's body
      const mix = a.createGain(), hp = a.createBiquadFilter(), pk = a.createBiquadFilter(); mix.gain.value = 1 / (V.f.length + 0.4); hp.type = 'highpass'; hp.frequency.value = Math.min(260, V.f[0] * 0.7); pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 1.1; pk.gain.value = 8;
      for (const f of V.f) { const o = a.createOscillator(); o.type = V.wave || 'sawtooth'; o.frequency.value = f; o.connect(mix); o.start(now); src.push(o); } mix.connect(hp); hp.connect(pk); pk.connect(head);
    }
    S.stats.sounds++; return { a, gain, src, t0: now, vol };
  }
  function stop(vc) {
    if (!vc || vc.bell) return; try { const a = vc.a, te = Math.max(a.currentTime, vc.t0 + MIN_BEEP), G = vc.gain.gain; G.cancelScheduledValues(te); G.setValueAtTime(vc.vol, te); G.linearRampToValueAtTime(0, te + 0.045);
      for (const o of vc.src) o.stop(te + 0.08); const last = vc.src[vc.src.length - 1]; if (last) last.onended = () => { try { vc.gain.disconnect(); } catch (e) {} }; } catch (e) { fail(e); }
  }
  const release = () => { if (S.voice) { stop(S.voice); S.voice = null; } S.held = false; if (watch) { clearInterval(watch); watch = 0; } };

  // ---------------------------------------------------------------- traffic: the car ahead moves over and gets on with it
  function cars(v) {
    const T = game.traffic, R = game.roads; if (!T || !T.cars || !R) return; const ux = Math.cos(v.h), uy = Math.sin(v.h), nose = (v.def.len || 4) / 2;
    const W = game.__world, DM = W && W.drivers && W.drivers.M, CM = game.combat && game.combat.cars; let n = 0;
    const near = []; for (const c of T.cars) { if (!c || !c.def || c.dead) continue; const dx = c.x - v.x, dy = c.y - v.y; if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue;
      const f = dx * ux + dy * uy - nose - c.def.len / 2, s = -dx * uy + dy * ux; if (f < -1.5 || f > CAR_AHEAD || Math.abs(s) > CAR_SIDE || Math.cos(c.h - v.h) < 0.5) continue; near.push({ c, f }); }
    near.sort((p, q) => p.f - q.f);
    for (const { c } of near) { if (n >= 3) break; if (c.stun > 0 || c.v > CAR_SLOW || (DM && DM.has(c))) continue; { const cs = CM && CM.get && CM.get(c); if (cs && cs.drvDead) continue; } n++; S.stats.cars++;
      // aside: the lane change traffic.js itself makes round a stopped car, under its own laneFree (the honking car behind is not what keeps the next lane shut)
      if (!c.junction && c.e && Math.abs(c.lo || 0) < 0.1) { const nl = R.laneCount(c.e, c.dir);
        if (nl > 1) { const all = game.vehicles; game.vehicles = all.filter((o) => o !== v); try { for (const l2 of [c.li + 1, c.li - 1]) { if (l2 < 0 || l2 >= nl || !T.laneFree(c, l2)) continue;
              c.lo = c.lo0 = R.laneOffset(c.e, c.dir, c.li) - R.laneOffset(c.e, c.dir, l2); c.li = l2; c.held = 0; c.plan = null; if (c.nx) c.nx = undefined; S.stats.aside++; break; } } finally { game.vehicles = all; } } }
      // forward: a brisker cruising speed for a few seconds (lights, gaps and junction rules are traffic.js's and still hold)
      const b = boosts.get(c); if (b) b.t = BOOST_T; else if (c.v0 > 0.5) { const to = Math.max(9, Math.min(15, c.v0 * 1.4)); if (to > c.v0) { boosts.set(c, { v0: c.v0, to, t: BOOST_T }); c.v0 = to; S.stats.sped++; } }
    }
  }
  function unboost(dt) { for (const [c, b] of boosts) { b.t -= dt; if (b.t > 0 && !c.dead && c.v0 === b.to) continue; if (c.v0 === b.to) c.v0 = b.v0;      /* (a speed someone else has set since is theirs) */ boosts.delete(c); } }

  // ---------------------------------------------------------------- people: out of the road; on the pavement a glance
  function people(v) {
    const W = game.__world, st = game.statics; if (!W || !W.on || !W.note || !st || !st.onSidewalk) return;
    const ux = Math.cos(v.h), uy = Math.sin(v.h), nose = (v.def.len || 4) / 2, hw = (v.def.wid || 1.9) / 2, sim = W.crowd ? W.crowd() : null;
    const see = (p, kind) => { const dx = p.x - v.x, dy = p.y - v.y; if (dx > 30 || dx < -30 || dy > 30 || dy < -30) return; const f = dx * ux + dy * uy - nose, s = -dx * uy + dy * ux, as = Math.abs(s); if (f < 0.3 || f > PED_AHEAD || as > 9 || p.fear || p._re) return;
      if (!st.onSidewalk(p.x, p.y)) { if (as < hw + 2.2) pend.push({ p, kind, at: t + 0.15 + rnd() * 0.3, s }); }
      else if (rnd() < 0.4) { S.stats.glance++; W.note(p, kind, 0, { x: v.x, y: v.y, look: 0.35 + rnd() * 0.4, T: 1.1 }, 0.2 + rnd() * 0.5); } };
    if (game.peds && game.peds.list) for (const p of game.peds.list) if (p.state === 'walk') see(p, 'ped');
    if (sim && sim.agents) { const L = sim.agents; for (let i = 0; i < L.length; i++) { const a = L[i]; if (a && !a.gone && a.state !== 'down' && a.state !== 'sit' && a.state !== 'flee') see(a, 'crowd'); } }
  }
  function clear(q) {
    const W = game.__world, v = game.player && game.player.vehicle, p = q.p; if (!W || !W.on || !v || !p || p.gone || p.fear || p.state === 'down' || p.state === 'flee' || p.state === 'sit') return;
    const ux = Math.cos(v.h), uy = Math.sin(v.h), hw = (v.def.wid || 1.9) / 2; S.stats.road++;
    if (q.kind !== 'crowd' || !W.sideStep || !W.sim) { W.note(p, q.kind, 1, { veh: v, x: v.x, y: v.y, clear: 10, T: 3 }, 0); return; }
    const s = -(p.x - v.x) * uy + (p.y - v.y) * ux, hl = typeof p.th === 'number' ? -Math.cos(p.th) * uy + Math.sin(p.th) * ux : 0, sg = Math.abs(hl) > 0.35 && (p.v || 0) > 0.3 ? Math.sign(hl) : s < 0 ? -1 : 1;      // on the way they were going if they were crossing, else to the nearer side
    const far = Math.max(0.5, hw + 1.6 - sg * s); W.sideStep(p, -uy * sg + ux * 0.15, ux * sg + uy * 0.15, Math.max(0.6, Math.min(1.5, 0.3 + far / 3)));
  }

  // ---------------------------------------------------------------- each step
  function frame(dt) {
    if (!(dt > 0)) dt = 0; t += dt; lastFrame = typeof performance !== 'undefined' ? performance.now() : 0; if (boosts.size) unboost(dt);
    while (pend.length && pend[0].at <= t) { try { clear(pend.shift()); } catch (e) { fail(e); } }
    const v = driving(), want = !!v && !typing() && ((game.keys && game.keys.has(S.key)) || padDown());
    if (want && !S.held) { S.held = true; S.honks++; S.kind = kindOf(v); try { S.voice = start(S.kind); } catch (e) { fail(e); S.voice = null; } reactT = 0;
      if (!watch && typeof setInterval === 'function') watch = setInterval(() => { if (S.held && performance.now() - lastFrame > 350) release(); }, 200); }      // the game stopped stepping (paused, the tab hidden): the horn does not hang
    else if (!want && S.held) release();
    if (S.held && v) { reactT -= dt; if (reactT <= 0) { reactT = HOLD_EVERY; try { cars(v); } catch (e) { fail(e); } try { people(v); } catch (e) { fail(e); } pend.sort((p, q) => p.at - q.at); } }
  }
  const step0 = game.step.bind(game); game.step = function (dt) { step0(dt); try { frame(dt); } catch (e) { fail(e); } };
  if (typeof addEventListener === 'function') addEventListener('blur', release);

  // ---------------------------------------------------------------- the words: the Controls page has its row in menu/keys.js; the start screen's line is given the key here
  const keyName = () => { try { const m = game.menu; if (m && m.keyName) return m.keyName(S.key); } catch (e) {} return 'G'; };
  try { const ps = typeof document !== 'undefined' ? document.querySelectorAll('p') : []; for (const p of ps) { if (p.dataset.horn) continue; for (const n of p.childNodes) { if (n.nodeType !== 3) continue; const i = n.nodeValue.indexOf('F get in or out'); if (i < 0) continue; n.nodeValue = n.nodeValue.slice(0, i + 15) + ' · ' + keyName() + ' horn' + n.nodeValue.slice(i + 15); p.dataset.horn = '1'; break; } } } catch (e) { fail(e); }
  S.react = (v) => { v = v || (game.player && game.player.vehicle); if (v) { cars(v); people(v); } };      // for tests
  S.frame = frame; S.kindOf = kindOf; S.keyName = keyName; S.boosts = boosts;
  console.log('[horn] ready: ' + keyName() + ' or L3 at the wheel');
  return S;
}
