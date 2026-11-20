// subway/voice.js (subway lane, voice helper, Nov 14): the subway's SOUND. One part of the lane: install(game, S) (see CONTRACT.md); ?subx=voice in tests.
// Matt through CHIEF (Nov 14 19:23Z): "the train announcer etc should sound JUST like the real thing. the whole thing should be freaky real".
//  - ANNOUNCEMENTS (assets/subway/voice/*.mp3: who made them and how is in SOURCES.md there; no recording of the real system is used). WHAT is said is in
//    voice-phrases.js (pure; tested in node): the real wording. Here: WHEN, and how it sounds.
//      the car's speakers (close, lightly band-limited): "This is ..." (+ transfers, + last stop) as the doors open; "Stand clear of the closing doors,
//        please." before they close; "This is a Queens-bound F local train. The next stop is ..." pulling out
//      platform loudspeakers (band-limited, a little distorted, echoing in the hall, muffled): "There is a ... train approaching the station. Please stand
//        away from the platform edge." with a train about a stop away; the edge line alone before a train runs through; now and then a notice
//    ONE announcement at a time, wherever it comes from (a queue): two never talk over each other.
//  - THE TRAINS AND THE STATION, synthesised (WebAudio; no files, nothing copied): rumble, wheel roar and rail joints that grow and fade with the train's
//    distance and come boomy out of the tunnel mouth; the rush of air as the front of a train passes; brake squeal; flange squeal in the tunnel while
//    riding; the motors' whine pulling out and braking; air; the two-tone door chime (a falling pair of bell notes, made here) and the doors' rumble;
//    inside the car a running noise that follows speed and falls quiet at a stop; a room tone (ventilation, a far drip) so it is never dead.
//  - Everything goes into the game's own output (game.sound.out): M mutes it, and nothing is made before the game's sound is unlocked.
//    Nothing is fetched, and no audio node exists, until the player is underground; all of it is torn down when he is back on the street.
// subway.js's crude S.sound is replaced while this part is installed. Test hooks: S.voice.log (what was said), ?voicelog=1 -> S.voice.trace (levels, bands).
import * as PH from './voice-phrases.js';

const BASE = new URL('../../assets/subway/voice/', import.meta.url).href;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export async function install(game, S) {
  const g = game, pl = g.player, data = S.data;
  const V = (S.voice = { log: [], trace: [], failed: [], loaded: 0, bytes: 0, fetched: [], on: false, phrases: PH, version: 1 });
  const TRACE = g.P && g.P.get('voicelog') === '1';
  const texts = {}; for (const st of data.stations) texts[PH.stClip(st)] = PH.spokenName(st.name) + '.';
  const warn = (where, e) => { if ((V.fails = (V.fails || 0) + 1) <= 5) console.warn('[subway] voice ' + where + ': ' + String((e && e.stack) || e).slice(0, 300)); };

  // ------------------------------------------------------------------ clips: ONE MIXED file (announcer.mp3: every part one after another, each lying on
  // OUR OWN station bed, which runs unbroken through the whole file; the parts a platform announcement can begin with have OUR call tone in the "pre"
  // seconds before them; voice.json says where each lies). Fetched and decoded the first time anything is to be said underground. A part is cut WITH its
  // bed and a margin of bed alone each side (never trimmed to bare speech: licence, see SOURCES.md); the margins fade so joined parts cross over evenly.
  const clips = new Map();      // id -> { buf, lead (the same with the call tone before it), M, bad, p }
  let spriteP = null, SP = null;
  const fx = async (name) => { V.fetched.push(name); const r = await fetch(BASE + name); if (!r.ok) throw new Error(name + ': http ' + r.status); return r; };
  const sprite = (ac) => (spriteP ||= (async () => { const m = await (await fx('voice.json')).json(), ab = await (await fx(m.file || 'announcer.mp3')).arrayBuffer(); V.bytes += ab.byteLength; const b = await ac.decodeAudioData(ab); V.secs = +b.duration.toFixed(1); SP = { m, b, fill: new Map() }; return SP; })());
  // a stretch of the file as its own buffer: gain gn, and a quarter-sine fade over M seconds at each end (two such ends laid over each other keep the bed's level)
  const cut = (ac, b, t0, t1, M, gn) => { const sr = b.sampleRate, all = b.getChannelData(0), a0 = Math.max(0, Math.round(t0 * sr)), a1 = Math.min(all.length, Math.round(t1 * sr)), o = ac.createBuffer(1, Math.max(2, a1 - a0), sr), od = o.getChannelData(0); od.set(all.subarray(a0, a1));
    const n = Math.min(od.length >> 1, Math.max(1, Math.round(M * sr))); for (let i = 0; i < od.length; i++) od[i] *= gn; for (let i = 0; i < n; i++) { const w = Math.sin((Math.PI / 2) * (i / n)); od[i] *= w; od[od.length - 1 - i] *= w; } return o; };
  const load = (id, ac) => { let c = clips.get(id); if (c) return c.p; c = { buf: null, lead: null, M: 0.045, bad: false }; clips.set(id, c);
    c.p = sprite(ac).then(({ m, b }) => { const e = m.clips[id]; if (!e) throw new Error('not in voice.json'); const sr = b.sampleRate, all = b.getChannelData(0), M = (c.M = m.margin || 0.045), od = all.subarray(Math.max(0, Math.round(e.start * sr)), Math.min(all.length, Math.round((e.start + e.dur) * sr))); let gn = 1;
        // every part to one speech level (-20 dBFS over its loud frames, peaks held under 0.7), whoever made the file
        { const n = Math.max(64, Math.round(sr * 0.02)); let mx = 0; const fr = []; for (let i = 0; i + n <= od.length; i += n) { let en = 0; for (let j = i; j < i + n; j++) en += od[j] * od[j]; en /= n; fr.push(en); if (en > mx) mx = en; } let se = 0, k = 0, pk = 0; for (const en of fr) if (en > mx * 0.01) { se += en; k++; } for (let i = 0; i < od.length; i++) { const v = Math.abs(od[i]); if (v > pk) pk = v; }
          if (k && se > 0) gn = Math.min(0.1 / Math.sqrt(se / k), 0.7 / (pk || 1), 8); }
        c.buf = cut(ac, b, e.start - M, e.start + e.dur + M, M, gn); if (e.pre > 0) c.lead = cut(ac, b, e.start - e.pre - M, e.start + e.dur + M, M, gn); V.loaded++; })
      .catch((e) => { c.bad = true; const w = id + ': ' + ((e && e.message) || e); if (V.failed.length < 40) V.failed.push(w); }); return c.p; };
  const have = (seq) => seq.every((q) => typeof q === 'number' || (clips.get(q) && clips.get(q).buf));
  const want = (seq, ac) => { for (const q of seq) if (typeof q !== 'number') load(q, ac); };

  // ------------------------------------------------------------------ the audio graph (made on the first step underground with the sound on)
  let A = null, irBuf = null, brownBuf = null;
  const make = () => { const sn = g.sound, ac = sn.ac, t0 = ac.currentTime, nodes = [], srcs = [];
    const N = (n) => { nodes.push(n); return n; }, gain = (v) => { const x = N(ac.createGain()); x.gain.value = v; return x; }, biq = (type, f, q, db) => { const x = N(ac.createBiquadFilter()); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; if (db) x.gain.value = db; return x; };
    const chain = (...a) => { for (let i = 0; i < a.length - 1; i++) a[i].connect(a[i + 1]); return a[a.length - 1]; };
    const loop = (buf, rate = 1, off = 0) => { const s = N(ac.createBufferSource()); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, off); srcs.push(s); return s; };
    const osc = (type, f) => { const o = N(ac.createOscillator()); o.type = type; o.frequency.value = f; o.start(); srcs.push(o); return o; };
    const master = gain(0); master.connect(sn.out);
    if (!brownBuf) brownBuf = sn._noise ? sn._noise(4, true) : sn.white;
    if (!irBuf) { const n = Math.round(ac.sampleRate * 1.9); irBuf = ac.createBuffer(2, n, ac.sampleRate); let s = 99991; for (let c = 0; c < 2; c++) { const d = irBuf.getChannelData(c); let lp = 0, e2 = 0; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; const w = s / 2147483648 - 1; lp += 0.32 * (w - lp); const e = Math.exp(-i / (0.33 * ac.sampleRate)) * (i < 400 ? i / 400 : 1); d[i] = lp * e; e2 += d[i] * d[i]; } const k = 1 / Math.sqrt(e2); for (let i = 0; i < n; i++) d[i] *= k; } }
    const rev = N(ac.createConvolver()); rev.normalize = false; rev.buffer = irBuf; const revOut = gain(0.9); chain(rev, revOut, master); const revIn = gain(1); revIn.connect(rev);
    // -- the platform loudspeakers: band 380..3100 Hz, soft clipping, two echoes down the hall, the room
    const shape = (drive) => { const w = N(ac.createWaveShaper()), n = 1025, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / drive * Math.min(drive, 1.6); } w.curve = c; return w; };
    const paIn = gain(1), paOut = gain(0), paPost = chain(paIn, biq('highpass', 380, 0.7), biq('lowpass', 3100, 0.7), shape(3.2));
    paPost.connect(paOut); for (const [dl, gg] of [[0.115, 0.30], [0.205, 0.20], [0.33, 0.11]]) { const d = N(ac.createDelay(0.5)); d.delayTime.value = dl; chain(paPost, d, biq('lowpass', 2200), gain(gg), paOut); }
    paOut.connect(master); chain(paOut, gain(0.16), rev);      // the room: through the hall's reverb
    // -- the car's speakers: close, clear, a small metal box
    const carIn = gain(1), carLp = biq('lowpass', 5200, 0.6), carOut = gain(0); chain(carIn, biq('highpass', 190, 0.7), biq('peaking', 2400, 0.9, 3), shape(1.4), carLp, carOut, master);
    { const d = N(ac.createDelay(0.1)); d.delayTime.value = 0.021; chain(carLp, d, gain(0.22), carOut); }
    // -- shared noise for the trains, the room and the one-shots
    const white = loop(sn.white), brown = loop(brownBuf), brown2 = loop(brownBuf, 0.83, 1.7);
    const sfx = gain(1); sfx.connect(master); const sfxRev = gain(0.25); sfx.connect(sfxRev); sfxRev.connect(revIn);
    // -- room tone: ventilation (low noise, slowly breathing), a faint mains hum; the drip is a one-shot
    const room = gain(0); chain(brown2, biq('lowpass', 230, 0.5), room, master); const roomHi = gain(0.035); chain(white, biq('bandpass', 950, 0.4), roomHi, room);
    const hum = gain(0.05); chain(osc('sine', 120), hum, room); const hum2 = gain(0.018); chain(osc('sine', 180.4), hum2, room);
    const lfo = osc('sine', 0.13), lfoG = gain(0.012); chain(lfo, lfoG); lfoG.connect(room.gain);
    // -- one voice per train: rumble, wheel roar, motor whine, brake squeal, each with its own gain, then a pan
    const trainVoice = () => { const pan = N(ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain()), out = gain(1); chain(out, pan, sfx);
      const rumF = biq('lowpass', 200, 0.9), rum = gain(0); chain(brown, rumF, rum, out); const roarF = biq('bandpass', 850, 0.6), roar = gain(0); chain(white, roarF, roar, out);
      const wo = osc('sawtooth', 100), wo2 = osc('square', 151), w2g = gain(0.3), whF = biq('lowpass', 1500, 2), wh = gain(0); wo.connect(whF); chain(wo2, w2g, whF); chain(whF, wh, out);
      const so = osc('triangle', 2800), so2 = osc('sine', 3460), s2g = gain(0.5), sq = gain(0), sqF = biq('bandpass', 3000, 3); so.connect(sqF); chain(so2, s2g, sqF); chain(sqF, sq, out);
      const rush = gain(0); chain(white, biq('bandpass', 620, 0.35), rush, out);      // the air a train pushes ahead of it
      return { pan, out, rumF, rum, roarF, roar, wo, wo2, whF, wh, so, so2, sq, rush, joint: 0, ph: Math.random() * 6, curve: 0, curveT: 4 + Math.random() * 6 }; };
    const cabin = gain(0); chain(white, biq('bandpass', 420, 0.5), cabin, master);      // the car's own fans, heard inside
    let aM = null, aS = null, aO = null, buf = null;
    if (TRACE) { const an = () => { const x = N(ac.createAnalyser()); x.fftSize = 2048; return x; }; aM = an(); master.connect(aM); aS = an(); paOut.connect(aS); carOut.connect(aS); aO = an(); sn.out.connect(aO); buf = new Float32Array(2048); }
    const set = (p, v, tc = 0.08) => { if (Number.isFinite(v)) p.setTargetAtTime(v, ac.currentTime, tc); };
    // one-shots -------------------------------------------------------------------------------------------------
    const env = (dst, peak, t, a, d) => { const x = ac.createGain(); x.gain.setValueAtTime(0.0001, t); x.gain.linearRampToValueAtTime(peak, t + a); x.gain.exponentialRampToValueAtTime(0.0001, t + a + d); x.connect(dst); setTimeout(() => { try { x.disconnect(); } catch (e) {} }, (t - ac.currentTime + a + d + 0.5) * 1000); return x; };
    const tone = (dst, f, t, a, d, peak, type = 'sine', slide = 0) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + a + d); o.connect(env(dst, peak, t, a, d)); o.start(t); o.stop(t + a + d + 0.05); };
    const hiss = (dst, t, a, d, peak, type, f, q = 0.7, src = white) => { const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; src.connect(fl); fl.connect(env(dst, peak, t, a, d)); setTimeout(() => { try { src.disconnect(fl); fl.disconnect(); } catch (e) {} }, (t - ac.currentTime + a + d + 0.5) * 1000); };
    const panTo = (p) => { const x = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain(); if (x.pan) x.pan.value = clamp(p, -0.9, 0.9); x.connect(sfx); setTimeout(() => { try { x.disconnect(); } catch (e) {} }, 5000); return x; };
    return { ac, sn, master, paIn, paOut, carIn, carOut, carLp, room, cabin, sfx, revIn, white, brown, voices: new Map(), trainVoice, set, tone, hiss, panTo, aM, aS, aO, buf, t0,
      stop() { try { master.gain.cancelScheduledValues(ac.currentTime); master.gain.setTargetAtTime(0, ac.currentTime, 0.12); } catch (e) {} setTimeout(() => { for (const s of srcs) { try { s.stop(); } catch (e) {} } for (const n of nodes) { try { n.disconnect(); } catch (e) {} } }, 700); } };
  };

  // ------------------------------------------------------------------ the announcer: one queue, one voice at a time
  let Q = [], cur = null, busyUntil = 0, clock = 0, noticeT = 55 + Math.random() * 30, noticeI = Math.floor(Math.random() * 3), rideRoute = null, lastT = 0;
  const say = (place, seq, o = {}) => { if (!seq || !seq.length) return; if (o.key) Q = Q.filter((q) => q.key !== o.key); Q.push({ place, seq, t: o.t || null, key: o.key || null, prio: o.prio || 1, from: clock + (o.delay || 0), until: clock + (o.delay || 0) + (o.ttl || 8), text: PH.text(seq, texts) }); if (A) want(seq, A.ac); };
  const riding = (t) => !!(S.ride && (!t || S.ride.t === t));
  // where the player is with respect to train t: the nearest point of the part of the train that is in the station (or the tunnel mouth it is behind)
  const R = { dist: 0, mouth: 0, inF: 0, depth: 0, sx: 0, sy: 0 };
  const rel = (t, u) => { const L = t.train.length, h = u.st.plen / 2, [lx, lz] = S.tLocal(t, pl.x, pl.y), pz = lz + t.c, a = Math.max(t.c - L / 2, -h), b = Math.min(t.c + L / 2, h), sg = t.c < 0 ? -1 : 1;
    R.inF = clamp((b - a) / L, 0, 1); R.depth = Math.max(0, Math.abs(t.c) - L / 2 - h); const nz = b > a ? clamp(pz, a, b) : sg * h; R.dist = Math.hypot(lx, pz - nz, 1.2); R.mouth = Math.hypot(lx, pz - sg * h, 1.2); R.sx = t.mx + t.ux * nz; R.sy = t.my + t.uy * nz; return R; };
  const panOf = (sx, sy) => { const dx = sx - pl.x, dy = sy - pl.y, d = Math.hypot(dx, dy) || 1, yaw = g.cam.yaw; return clamp(((dx * Math.sin(yaw) - dy * Math.cos(yaw)) / d) * Math.min(1, d / 4), -0.8, 0.8); };
  const prox = (d, r = 10) => 1 / (1 + Math.pow(d / r, 1.6));
  const platOf = (u) => { const f = S.floor; if (!f || f.k !== 'platform' || !u.st.tc) return -1; const F = u.st.frame, tt = -(pl.x - F.x) * Math.sin(F.a) + (pl.y - F.y) * Math.cos(F.a); let b = 0; for (let i = 1; i < u.st.tc.length; i++) if (Math.abs(tt - u.st.tc[i]) < Math.abs(tt - u.st.tc[b])) b = i; return b; };
  // can he hear this train's own speakers: 1 aboard, less through its open doors from the platform beside it, 0 otherwise
  const carHear = (t, u) => { if (riding(t)) return 1; if (S.ride || !t || t.state !== 'dwell' || t.u !== u) return 0; const d = rel(t, u).dist; return d < 14 ? 0.5 * prox(d, 7) : 0; };
  const routeNow = (t) => { if (riding(t) && rideRoute) return rideRoute; if (t.route) return t.route; const n = t.T.routes.length; return t.T.routes[(((t.routeI || 0) - 1) % n + n) % n]; };
  const routeNext = (t) => t.T.routes[(t.routeI || 0) % t.T.routes.length];
  const start = (it, u) => { const ac = A.ac; let at = ac.currentTime + 0.06; const dst = it.place === 'pa' ? A.paIn : A.carIn, t0 = at;
    // a platform announcement opens with our call tone: it is IN the file before the parts that can open one (c.lead). Parts overlap by their margins of
    // bed, and a pause is filled with a stretch of the same bed from the head of the file, so the bed neither stops nor swells between the parts.
    const play = (b, t) => { const s = ac.createBufferSource(); s.buffer = b; s.connect(dst); s.start(t); s.onended = () => { try { s.disconnect(); } catch (e) {} }; };
    const fill = (q, M) => { const bd = SP && SP.m.bed; if (!bd || q > bd[1]) return null; const k = Math.round(q * 1000); let f = SP.fill.get(k); if (!f) { const o = bd[0] + Math.random() * (bd[1] - q); f = cut(ac, SP.b, o, o + q, M, 1); SP.fill.set(k, f); } return f; };
    let first = true, pause = 0; for (const q of it.seq) { if (typeof q === 'number') { pause += q; continue; } const c = clips.get(q), M = c.M, b = first && it.place === 'pa' && c.lead ? c.lead : c.buf;
      if (first && it.place === 'pa' && !c.lead) { A.tone(A.paIn, 523.25, at, 0.012, 0.75, 0.16); A.tone(A.paIn, 783.99, at + 0.02, 0.012, 0.7, 0.11); at += 0.72; }      /* only for a file made without the tone */
      if (!first) { if (pause > 2 * M) { const f = fill(pause, M); if (f) play(f, at - M); at += pause - 2 * M; } else at += pause - M; }
      play(b, at); at += b.duration; first = false; pause = 0; }
    busyUntil = at + (it.place === 'pa' ? 1.6 : 0.5); cur = { place: it.place, t: it.t, end: at };
    const rec = { n: V.log.length + 1, place: it.place, text: it.text, start: +t0.toFixed(2), end: +at.toFixed(2), at: u.st.id, heard: it.place === 'car' ? (riding(it.t) ? 'aboard' : 'through the doors') : 'platform', level: 0 }; cur.rec = rec; V.log.push(rec); if (V.log.length > 400) V.log.shift();
    if (TRACE) console.log('[subway] voice ' + rec.place + ' @' + rec.start + 's (' + rec.heard + ', ' + rec.at + '): ' + rec.text); };
  const pump = (u) => { const ac = A.ac; if (cur && ac.currentTime >= cur.end) cur = null; if (ac.currentTime < busyUntil || ac.state !== 'running') return; if (!Q.length) return;
    Q = Q.filter((q) => q.until > clock); let best = null; for (const q of Q) { if (q.from > clock) continue; const ok = q.place === 'pa' ? !S.ride : carHear(q.t, u) > 0.02; if (!ok) continue; if (!best || q.prio > best.prio) best = q; }
    if (!best) return; if (!have(best.seq)) { want(best.seq, ac); return; } Q.splice(Q.indexOf(best), 1); start(best, u); };

  // ------------------------------------------------------------------ what happens -> what is said
  // which stations are one complex (transfers): the index's st.cx. subway.js writes the middle of a station's entrances over that same field when it
  // installs, so the index is read once more (from the browser's cache) the first time he is underground; until it has come, no transfer line is said.
  let xdata = null, xmap = null, xP = null;
  const loadX = () => (xP ||= fetch(new URL('../subway.json', BASE)).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.stations) { xdata = { stations: j.stations.map((q) => ({ id: q.id, name: q.name, routes: q.routes, cx: q.cx })) }; xmap = new Map(xdata.stations.map((q) => [q.id, q])); } }).catch((e) => warn('index', e)));
  const xst = (st) => (xmap && xmap.get(st.id)) || { id: st.id, name: st.name, routes: st.routes, cx: typeof st.cx === 'string' ? st.cx : null };
  const xd = () => xdata || { stations: [] };
  const nextOf = (u, t) => S.nextStation(u.st, t.T.dir, t.T.key, routeNow(t)), dirOf = (t, r) => (S.dirOf ? S.dirOf(t, r) : t.T.dir);      /* (the route: where it leaves its line, handover-15) */      // (the track key: an express skips the stations where it has no platform; older data has no keys)
  const preload = (u) => { if (!A || !u) return; const nx = [S.nextStation(u.st, 1), S.nextStation(u.st, -1)]; for (const T of u.st.tracks || []) if (!(T.plat < 0)) { nx.push(S.nextStation(u.st, T.dir, T.key)); for (const r of T.routes || []) nx.push(S.nextStation(u.st, T.dir, T.key, r)); } const go = () => { if (A) for (const id of PH.clipsFor(xst(u.st), xd(), nx)) load(id, A.ac); }; go(); if (!xdata) loadX().then(go); };
  const announceArrival = (t, u, ttl) => { if (t._va || S.ride) { t._va = 1; return; } t._va = 1; const p = platOf(u);
    if (t.T.plat < 0) { if (p >= 0) say('pa', PH.passing(), { ttl: 5, prio: 2, key: 'thru' }); return; }      /* a track with no platform here: the train runs through */ if (p >= 0 && t.T.plat !== p) return;      /* on a platform: only that platform's two tracks; in the halls: all of them */
    say('pa', PH.arrival(dirOf(t, t.state === 'wait' ? routeNext(t) : routeNow(t)), t.state === 'wait' ? routeNext(t) : routeNow(t)), { ttl, prio: 2, key: 'arr' + t.T.id }); };
  S.on('train', (kind, t, u) => { try { if (!A || u !== S.unit) { if (kind === 'gone') t._va = 0; return; }
      if (kind === 'arrive') announceArrival(t, u, 9);
      else if (kind === 'stop') { const r = rel(t, u), k = riding(t) ? 0.5 : prox(r.dist, 12); if (k > 0.02) A.hiss(A.panTo(riding(t) ? 0 : panOf(r.sx, r.sy)), A.ac.currentTime + 0.25, 0.04, 0.9, 0.11 * k, 'highpass', 2600); }
      else if (kind === 'doors-open') { t._vw = 0; if (carHear(t, u) > 0.02) say('car', PH.thisIs(xst(u.st), routeNow(t), !nextOf(u, t), xd()), { t, ttl: 5, prio: 3, key: 'car' }); if (riding(t)) lastT = clock; }
      else if (kind === 'leave') { if (riding(t)) { const n = nextOf(u, t); if (n) { say('car', PH.nextStop(n, routeNow(t), dirOf(t, routeNow(t))), { t, delay: 3.2, ttl: 14, prio: 3, key: 'car' }); load(PH.stClip(n), A.ac); } } }
      else if (kind === 'gone') t._va = 0; } catch (e) { warn('train event', e); } });
  S.on('board', (t) => { try { const n = t.T.routes.length; rideRoute = t.route || t.T.routes[(((t.routeI || 0) - 1) % n + n) % n]; Q = Q.filter((q) => q.place !== 'pa'); const u = S.unit; lastT = clock;
      if (A && u && t.state === 'dwell' && !nextOf(u, t)) say('car', PH.lastStop(), { t, delay: 1.2, ttl: 9, prio: 2, key: 'car' }); } catch (e) { warn('board', e); } });
  S.on('alight', () => { rideRoute = null; Q = Q.filter((q) => q.place !== 'car'); });
  S.on('hop', (from, to, nt) => { try { nt._va = 1; nt._vw = 0; for (const t of from.trains) t._va = 0; if (A) { for (const v of A.voices.values()) v.dead = true; preload(to); } } catch (e) { warn('hop', e); } });
  S.on('enter', (u) => { noticeT = 40 + Math.random() * 40; });
  S.on('leave', () => { Q = []; cur = null; rideRoute = null; if (A) { A.stop(); A = null; V.on = false; } });
  S.on('drop', (u) => { if (A) for (const t of u.trains) { const v = A.voices.get(t); if (v) { v.dead = true; } } });

  // the door sounds (called by subway.js where its own crude sounds were): the doors' rumble and thump; closing: the two-tone chime first
  const crude = S.sound;
  S.sound = (kind, t) => { try { if (!A || !S.own || !g.sound.on || kind !== 'doors') return; const u = t.u, r = rel(t, u), inside = riding(t), k = inside ? 0.9 : prox(r.dist, 9); if (k < 0.02) return;
      const ac = A.ac, now = ac.currentTime + 0.02, dst = A.panTo(inside ? 0 : panOf(r.sx, r.sy)), closing = t.doors > 0.5;
      if (closing) [[830.6, 0], [659.3, 0.42]].forEach(([f, o]) => { A.tone(dst, f, now + o, 0.004, 0.75, 0.1 * k); A.tone(dst, f * 2.0, now + o, 0.003, 0.4, 0.035 * k); A.tone(dst, f * 3.01, now + o, 0.002, 0.18, 0.018 * k); A.tone(dst, f * 4.2, now + o, 0.002, 0.07, 0.012 * k); });      // the two-tone chime: a falling pair of bell notes (a fundamental and three quick-dying partials each), made here
      else A.hiss(dst, now, 0.05, 0.5, 0.05 * k, 'highpass', 3000);      // opening: a breath of air
      const t1 = now + (closing ? 0.85 : 0.05); A.hiss(dst, t1, 0.25, 1.35, 0.15 * k, 'lowpass', 420, 0.8, A.brown); A.hiss(dst, t1 + 0.1, 0.3, 1.2, 0.03 * k, 'bandpass', 1900, 2);
      A.tone(dst, 86, t1 + 1.55, 0.004, 0.16, 0.2 * k, 'triangle', -30); A.hiss(dst, t1 + 1.55, 0.003, 0.09, 0.1 * k, 'lowpass', 900); } catch (e) { warn('doors', e); } };

  // ------------------------------------------------------------------ every step underground
  let lastStep = 0, dripT = 4, sec = -1, acc = null;
  const VMAX = 15, JOINT = 11.9, MASTER = 0.45;      // (MASTER: measured on the mock page, Nov 14: at 1 our peaks reached 1.4 of full scale; 0.45 keeps the game's output under its limiter's knee)
  const trains = (dt, u) => { const ac = A.ac, now = ac.currentTime, set = A.set;
    for (const [t, v] of A.voices) if (v.dead || t.u !== u) { v.out.gain.setTargetAtTime(0, now, 0.05); A.voices.delete(t); const o = v.out; setTimeout(() => { try { for (const x of [v.wo, v.wo2, v.so, v.so2]) x.stop(); o.disconnect(); v.pan.disconnect(); } catch (e) {} }, 400); }
    let inside = 0;
    for (const t of u.trains) { let v = A.voices.get(t); const moving = t.state === 'in' || t.state === 'out' || t.state === 'thru';
      if (!moving && !(v && v.live)) continue; if (!v) A.voices.set(t, (v = A.trainVoice()));
      const sp = moving ? Math.abs(t.v) : 0, sv = clamp(sp / VMAX, 0, 1.15), me = riding(t), r = rel(t, u), lxz = S.tLocal(t, pl.x, pl.y);
      let lev, cut, mouthy = 0;
      if (me) { lev = 0.85; cut = 150 + 170 * sv; inside = 1; }
      else { const pIn = r.inF * prox(r.dist), pMouth = (1 - r.inF) * 1.5 * prox(r.mouth, 16) * Math.exp(-r.depth / 95); lev = (pIn + pMouth) * (S.ride ? 0.3 : 1); mouthy = pMouth / (pIn + pMouth + 1e-6); cut = (330 - 215 * mouthy) * (0.6 + 0.5 * sv); }
      v.live = moving && lev > 0.004;
      set(v.rum.gain, (me ? 0.42 : 0.62) * Math.pow(sv, 1.2) * lev, 0.12); set(v.rumF.frequency, cut, 0.2); v.rumF.Q.value = 0.9 + 2.2 * mouthy;
      set(v.roar.gain, (me ? 0.045 : 0.11) * sv * sv * lev * (1 - 0.8 * mouthy), 0.12); set(v.roarF.frequency, 500 + 600 * sv, 0.2);
      // the motors: a rising whine pulling out (strongest under power), a falling one braking
      const pw = t.state === 'out' ? (sp < VMAX + 1.5 ? 1 : 0.35) : t.state === 'in' ? 0.4 : t.state === 'thru' ? 0.3 : 0, f = 95 + sp * 44; set(v.wo.frequency, f, 0.1); set(v.wo2.frequency, f * 1.503, 0.1); set(v.whF.frequency, 500 + sp * 90, 0.1);
      set(v.wh.gain, 0.05 * pw * clamp(sp / 2, 0, 1) * lev * (1 - 0.6 * mouthy) * (me ? 0.8 : 1), 0.15);
      // the brakes: a squeal in the last metres, wavering
      const sq = t.state === 'in' ? clamp((7 - sp) / 3, 0, 1) * clamp((sp - 0.36) / 1.1, 0, 1) : 0; v.ph += dt * (5 + sp); set(v.so.frequency, 2750 + 140 * Math.sin(v.ph) + 25 * (t.T.id || 0), 0.05); set(v.so2.frequency, 3420 + 190 * Math.sin(v.ph * 0.7 + 1), 0.05);
      // wheel flanges on a curve of the tunnel: aboard, at speed between stations, a few seconds of a thinner, wandering squeal now and then
      let cv = 0; if (me && sp > 9 && r.inF < 0.05) { v.curveT -= dt; if (v.curveT <= 0) { v.curve = 2.2 + Math.random() * 2.5; v.curveT = v.curve + 5 + Math.random() * 9; } } if (v.curve > 0) { v.curve -= dt; cv = me ? Math.min(1, v.curve, sp / 12) : 0; }
      if (cv > 0) { set(v.so.frequency, 3300 + 420 * Math.sin(v.ph * 0.31) + 130 * Math.sin(v.ph * 2.3), 0.08); set(v.so2.frequency, 4150 + 380 * Math.sin(v.ph * 0.23 + 2), 0.08); }
      set(v.sq.gain, Math.max(0.034 * sq * (me ? 0.35 : r.inF * prox(r.dist, 14)), 0.013 * cv), 0.25);
      // the rush of air as its front comes past him on the platform
      { const hd = Math.hypot(lxz[0], lxz[1] - t.train.length / 2); set(v.rush.gain, !me && !S.ride && (t.state === 'in' || t.state === 'thru') ? 0.2 * sv * sv * prox(hd, 13) : 0, 0.25); }
      if (v.pan.pan) set(v.pan.pan, me ? 0 : panOf(r.sx, r.sy), 0.15);
      // rail joints: two knocks (the two axles of a truck) every rail length run
      v.joint += sp * dt; if (v.joint >= JOINT) { v.joint -= JOINT; const k = (me ? 0.5 : lev * 0.55) * clamp(sp / 5, 0.25, 1); if (k > 0.012) { const gap = clamp(2.0 / Math.max(sp, 1), 0.07, 0.4), at = now + 0.01; for (const [o, m] of [[0, 1], [gap, 0.8]]) { A.hiss(v.out, at + o, 0.003, 0.085, 0.34 * k * m, 'bandpass', me ? 190 : 240, 1.4, A.brown); A.hiss(v.out, at + o, 0.002, 0.03, 0.05 * k * m, 'bandpass', 1500, 1.2); } } }
    }
    // inside the car: its fans; the station's room is shut out
    set(A.cabin.gain, S.ride ? 0.02 : 0, 0.3); return inside; };
  S.on('step', (dt, u) => { try { const sn = g.sound; if (!sn || !sn.on || !sn.ac || !sn.out || !u) return;
      if (!A) { A = make(); V.on = true; preload(u); }
      const ac = A.ac, now = ac.currentTime; clock += dt; lastStep = performance.now();
      A.set(A.master.gain, MASTER, 0.15);
      // the trains of this station; the room; the drip
      trains(dt, u);
      A.set(A.room.gain, S.ride ? 0.02 : S.deep ? 0.075 : 0.03, 0.4);
      dripT -= dt; if (dripT <= 0) { dripT = 3.5 + Math.random() * 8; if (S.deep && !S.ride) { const f = 1300 + Math.random() * 1100, d = A.panTo(Math.random() * 1.6 - 0.8), k = 0.012 + Math.random() * 0.02, at = now + 0.02; A.tone(d, f, at, 0.002, 0.11, k, 'sine', f * 0.35); A.tone(A.revIn, f, at, 0.002, 0.14, k * 1.8, 'sine', f * 0.35); if (Math.random() < 0.5) A.tone(A.revIn, f * 0.74, at + 0.09 + Math.random() * 0.08, 0.002, 0.1, k, 'sine', f * 0.2); } }
      // ---- announcements
      for (const t of u.trains) {
        if (t.state === 'wait') { if (t.t <= (t.T.plat < 0 ? 6 : 8.5) && t.t > 0 && !t._va) announceArrival(t, u, 12); }
        else if (t.state === 'dwell') { const last = !nextOf(u, t);
          if (!t._vw && t.t >= 10.5 && t.doors > 0.9 && !(last && riding(t))) { t._vw = 1; if (carHear(t, u) > 0.02) say('car', PH.doorWarn(), { t, ttl: 2.2, prio: 4, key: 'car' }); }
          if (last && riding(t) && t.doors > 0.9 && clock - lastT > 24) { lastT = clock; say('car', PH.lastStop(), { t, ttl: 6, prio: 2, key: 'car' }); } } }
      if (!S.ride && S.deep) { noticeT -= dt; if (noticeT <= 0) { noticeT = 75 + Math.random() * 60; let soon = false; for (const t of u.trains) if ((t.state === 'wait' && t.t < 14) || ((t.state === 'in' || t.state === 'thru') && t.c < -60)) soon = true; if (soon || Q.length || cur) noticeT = 12; else say('pa', PH.notice(noticeI++), { ttl: 6, prio: 1, key: 'notice' }); } }
      pump(u);
      // where the voice is heard from: the hall's loudspeakers fall away on the stairs and inside a car; the car's are full aboard, faint through its doors
      A.set(A.paOut.gain, S.ride ? 0.1 : platOf(u) >= 0 ? 0.95 : S.deep ? 0.7 : 0.35, 0.25);
      const ch = cur && cur.place === 'car' ? carHear(cur.t, u) : 0; A.set(A.carOut.gain, ch >= 1 ? 1.0 : ch * 0.8, 0.12); A.set(A.carLp.frequency, ch >= 1 ? 5200 : 1700, 0.1);
      if (TRACE) meter(now);
    } catch (e) { warn('step', e); if (V.fails > 30 && A) { A.stop(); A = null; S.sound = crude; } } });
  // the game paused, or the page not stepping: no loop is left droning (the step sets the level back)
  setInterval(() => { if (A && performance.now() - lastStep > 350) { try { A.master.gain.setTargetAtTime(0, A.ac.currentTime, 0.1); } catch (e) {} } }, 250);

  // ?voicelog=1: levels per second (peak and RMS, of full scale): ours alone, the announcer alone, and the game's whole output before its limiter
  // (bands: our output's power in dB per second in <120, 120-500, 500-2k, 2k-6k, >6k Hz: the spectrum over time)
  const bandAcc = [0, 0, 0, 0, 0], EDGES = [120, 500, 2000, 6000]; let bandN = 0, fbuf = null;
  const meter = (now) => { const s = Math.floor(now); if (s !== sec) { if (acc) { const r = (k) => [+acc[k][0].toFixed(3), +Math.sqrt(acc[k][1] / Math.max(1, acc[k][2])).toFixed(4)]; const row = { s: sec, ours: r(0), voice: r(1), out: r(2), bands: bandAcc.map((x) => +(10 * Math.log10(x / Math.max(1, bandN) + 1e-12)).toFixed(1)), where: S.ride ? 'car' : S.floor ? S.floor.k : '?' }; bandAcc.fill(0); bandN = 0; V.trace.push(row); if (cur && cur.rec) cur.rec.level = Math.max(cur.rec.level, row.voice[0]); } sec = s; acc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; }
    [A.aM, A.aS, A.aO].forEach((an, k) => { an.getFloatTimeDomainData(A.buf); let p = 0, e = 0; for (let i = 0; i < A.buf.length; i += 2) { const x = A.buf[i]; if (x > p) p = x; else if (-x > p) p = -x; e += x * x; } if (p > acc[k][0]) acc[k][0] = p; acc[k][1] += e; acc[k][2] += A.buf.length / 2; }); if (cur && cur.rec && acc[1][0] > cur.rec.level) cur.rec.level = +acc[1][0].toFixed(3);
    { const an = A.aM; if (!fbuf) fbuf = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(fbuf); const hz = A.ac.sampleRate / an.fftSize; for (let i = 1; i < fbuf.length; i++) { const f = i * hz, b = f < EDGES[0] ? 0 : f < EDGES[1] ? 1 : f < EDGES[2] ? 2 : f < EDGES[3] ? 3 : 4, d = fbuf[i]; if (d > -200) bandAcc[b] += Math.pow(10, d / 10); } bandN++; } };
  V.say = say; V.queue = () => Q.map((q) => q.place + ': ' + q.text);
  console.log('[subway] voice: announcements and train sounds ready (nothing fetched until underground)');
}
