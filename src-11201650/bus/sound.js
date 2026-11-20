// bus/sound.js (bus lane, stops+sound helper, Nov 15): what the buses sound like, and the bus's voice. makeSound(game) -> A (CONTRACT.md).
//   nodes: AudioWorkletNode (sound_worklet.js running sound_core.js) -> GainNode -> game.sound.out     so M mutes it and the game's own ceiling holds
//   the engine, whine, road, air brake, doors, kneeling beeper and the stop-requested chime are all made in sound_core.js (nothing recorded);
//   the nearest three buses are heard, placed by distance and by the side of the camera they are on; aboard, the same bus from inside.
//   THE VOICE: assets/bus/voice/voice.mp3 + voice.json, a free voice rendered on our own machine (SOURCES.md beside them), played through a small
//   "ceiling speaker" chain; one announcement at a time. The words are always shown as a caption at the foot of the screen, with or without sound.
// Nothing is fetched and no audio node exists until the game's sound is on AND a bus is within earshot (or something is said).
// Off: ?bussound=0 (bus.js). ?busvoice=0: captions only, the voice file is never fetched. ?buscap=0: no captions. Test hooks: A.log (what was said), A.stats.
import { NV, PV, NP, I, EV } from './sound_core.js';
import { phrase } from './voice_text.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const VOICE = new URL('../../assets/bus/voice/', import.meta.url).href;

export function makeSound(game) {
  const g = game, P = g.P, opt = (k, d) => (P && P.get && P.get(k) !== null && P.get(k) !== undefined ? P.get(k) : d);
  const A = { log: [], stats: { events: 0, said: 0, heard: 0, voice: 'not asked for', worklet: 'not started' }, level: 1 };
  const seen = new Map(), slots = []; for (let k = 0; k < NV; k++) slots.push(null);
  const T = new Float32Array(NP), sent = new Float32Array(NP).fill(NaN);
  let node = null, par = null, gain = null, state = 0, frameNo = 0;      // state 0 nothing, 1 loading, 2 running, -1 failed
  const snd = () => { const s = g.sound; return s && s.on && s.ac && s.out ? s : null; };
  const warn = (where, e) => { if ((A.stats.fails = (A.stats.fails || 0) + 1) <= 3) console.warn('[bus] sound ' + where + ': ' + String((e && e.message) || e).slice(0, 200)); };
  function start() {
    const s = snd(); if (!s || state) return; const ac = s.ac; state = 1;
    if (!ac.audioWorklet || typeof AudioWorkletNode === 'undefined') { state = -1; A.stats.worklet = 'no audio worklets in this browser: the buses are silent'; console.log('[bus] ' + A.stats.worklet); return; }
    ac.audioWorklet.addModule(new URL('./sound_worklet.js', import.meta.url)).then(() => {
      node = new AudioWorkletNode(ac, 'bus-dsp', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); par = []; for (let i = 0; i < NP; i++) par.push(node.parameters.get('p' + i));
      node.onprocessorerror = () => { state = -1; A.stats.worklet = 'stopped (audio worklet error)'; console.log('[bus] the bus sounds stopped (audio worklet error)'); };
      gain = ac.createGain(); gain.gain.value = A.level; node.connect(gain); gain.connect(s.out); state = 2; A.stats.worklet = 'running';
    }).catch((e) => { state = -1; A.stats.worklet = 'failed: ' + ((e && e.message) || e); warn('worklet', e); });
  }
  const ev = (type, vo, lvl = 1) => { A.stats.events++; if (node) node.port.postMessage([type, vo, lvl]); };

  // ------------------------------------------------------------------ the buses
  A.bus = (b, dt) => {
    let r = seen.get(b.id); if (!r) { r = { id: b.id, slot: -1, doorF: b.doorF || 0, doorR: b.doorR || 0, kneel: b.kneel || 0, v: Math.abs(b.v || 0), kn: 0, sighT: 0, moved: 0 }; seen.set(b.id, r); }
    r.x = b.x; r.y = b.y; r.d = b.d; r.acc = b.acc || 0; r.state = b.state; r.inside = !!b.inside; r.frame = frameNo;
    const v = Math.abs(b.v || 0), dF = b.doorF || 0, dR = b.doorR || 0, kneel = b.kneel || 0, any0 = Math.max(r.doorF, r.doorR), any1 = Math.max(dF, dR);
    if (r.slot >= 0) {
      if (any0 <= 0.001 && any1 > 0.001) ev(EV.DOPEN, r.slot); else if (any0 > 0.001 && any1 <= 0.001) ev(EV.DSHUT, r.slot);
      else if (any1 < any0 - 1e-4 && !r.closing && any0 > 0.9) { r.closing = true; ev(EV.DCLOSE, r.slot); }
      if (any1 >= any0) r.closing = false;
      if (v > 2.5) r.moved = 1; r.sighT -= dt; if (r.moved && r.v >= 0.25 && v < 0.25 && r.sighT <= 0) { ev(EV.SIGH, r.slot); r.moved = 0; r.sighT = 4; }      // the brake's sigh as it comes to rest
    }
    r.kn = Math.abs(kneel - r.kneel) > 1e-4 ? 0.25 : Math.max(0, r.kn - dt);      // the beeper while the body moves, and a moment after
    r.doorF = dF; r.doorR = dR; r.kneel = kneel; r.v = v;
  };
  const near = [];
  A.frame = (dt) => {
    if (gain) { const s0 = snd(), k = A.level * ((s0 && s0.streetK) ?? 1); if (k !== A._k) { A._k = k; gain.gain.setTargetAtTime(k, gain.context.currentTime, 0.15); } }      /* subway lane, Nov 16: quieter under the street (game.sound.streetK, set by subway/voice.js; unset = 1) */
    frameNo++; near.length = 0;
    for (const r of seen.values()) { if (r.frame !== frameNo - 1) { if (r.slot >= 0) slots[r.slot] = null; seen.delete(r.id); continue; } near.push(r); }
    if (!near.length) { if (state === 2 && A.stats.heard) { A.stats.heard = 0; for (let k = 0; k < NV; k++) T[k * PV + I.ON] = 0; push(); } return; }
    if (!state) { start(); return; } if (state !== 2) return;
    const s = snd(); if (!s) return;
    // the nearest NV are heard; one that is heard keeps its voice while it stays among them
    near.sort((a, b) => (a.inside ? -1 : a.d) - (b.inside ? -1 : b.d));
    for (let k = 0; k < NV; k++) { const r = slots[k]; if (r && near.indexOf(r) >= NV) { r.slot = -1; slots[k] = null; } }
    for (let i = 0; i < Math.min(NV, near.length); i++) { const r = near[i]; if (r.slot < 0) { const k = slots.indexOf(null); if (k >= 0) { slots[k] = r; r.slot = k; } } }
    // which side of the camera: the camera's right-hand direction on the map
    const cam = g.world.camera, m = cam.matrixWorld.elements, rx = m[0], ry = -m[2], rl = Math.hypot(rx, ry) || 1, cx = cam.position.x, cy = -cam.position.z;
    let heard = 0;
    for (let k = 0; k < NV; k++) {
      const r = slots[k], b = k * PV; if (!r) { T[b + I.ON] = 0; continue; } heard++;
      const d = Math.max(0, r.d), ins = r.inside ? 1 : r.state === 'player' && d < 9 ? 0.6 : 0, fade = 1 - clamp((d - 70) / 20, 0, 1), gd = (6 / (Math.max(d, 3) + 3)) * fade;
      const pan = clamp((((r.x - cx) * rx + (r.y - cy) * ry) / rl) / Math.max(d, 4), -1, 1) * 0.8 * (1 - ins), gl = Math.cos((pan + 1) * Math.PI / 4) * 1.414, gr = Math.sin((pan + 1) * Math.PI / 4) * 1.414, gg = gd + (1 - gd) * ins;
      T[b + I.ON] = 1; T[b + I.GL] = gg * gl; T[b + I.GR] = gg * gr; T[b + I.V] = r.v; T[b + I.ACC] = clamp(r.acc, -4, 4); T[b + I.INS] = ins; T[b + I.DIST] = d * (1 - ins); T[b + I.KNEEL] = r.kn > 0 ? 1 : 0;
    }
    T[I.MASTER] = s.muted ? 0 : 1; A.stats.heard = heard; push();
  };
  function push() { if (!par) return; for (let i = 0; i < NP; i++) { const v = Number.isFinite(T[i]) ? T[i] : 0; if (v !== sent[i]) { sent[i] = v; par[i].value = v; } } }
  A.chime = () => { A.log.push({ t: Date.now(), kind: 'chime' }); if (!state) start(); if (state === 2) { T[I.MASTER] = snd() && snd().muted ? 0 : 1; push(); ev(EV.CHIME, -1, 1); } else if (snd()) setTimeout(() => { if (state === 2) { T[I.MASTER] = 1; push(); ev(EV.CHIME, -1, 1); } }, 400); };

  // ------------------------------------------------------------------ the voice
  const CAP = opt('buscap', '1') !== '0', VOICE_ON = opt('busvoice', '1') !== '0';
  let cap = null, capT = 0, vj = null, vbuf = null, vload = null, chain = null, busyUntil = 0; const queue = [];
  function caption(text, secs) {
    if (!CAP || typeof document === 'undefined') return;
    try { if (!cap) { cap = document.createElement('div'); cap.id = 'buscap'; cap.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:39;max-width:86vw;text-align:center;font:500 16px system-ui,sans-serif;color:#fff;background:rgba(10,12,16,.66);padding:6px 14px;border-radius:6px;pointer-events:none;display:none;text-shadow:0 1px 2px rgba(0,0,0,.6)'; document.body.appendChild(cap); }
      cap.textContent = text; cap.style.display = ''; clearTimeout(capT); capT = setTimeout(() => { cap.style.display = 'none'; }, Math.max(2500, secs * 1000 + 1200)); } catch (e) {}
  }
  function loadVoice() {
    if (vload) return vload; const s = snd(); if (!s || !VOICE_ON) return Promise.resolve(false); A.stats.voice = 'loading';
    vload = fetch(VOICE + 'voice.json').then((r) => { if (!r.ok) throw new Error('voice.json ' + r.status); return r.json(); }).then((j) => { vj = j; return fetch(VOICE + j.file); }).then((r) => { if (!r.ok) throw new Error('voice file ' + r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((ok, no) => { const p = s.ac.decodeAudioData(ab, ok, no); if (p && p.then) p.then(ok, no); })).then((buf) => { vbuf = buf; A.stats.voice = 'loaded (' + Object.keys(vj.clips).length + ' clips)'; return true; })
      .catch((e) => { A.stats.voice = 'not loaded: ' + ((e && e.message) || e) + ' (captions only)'; console.log('[bus] the voice is ' + A.stats.voice); vj = null; return false; });
    return vload;
  }
  function speaker(s) {      // a small ceiling speaker: no lows, a nasal peak, no top, a little grit
    if (chain) return chain; const ac = s.ac, hp = ac.createBiquadFilter(), pk = ac.createBiquadFilter(), lp = ac.createBiquadFilter(), ws = ac.createWaveShaper(), out = ac.createGain();
    hp.type = 'highpass'; hp.frequency.value = 340; hp.Q.value = 0.7; pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 1.1; pk.gain.value = 5; lp.type = 'lowpass'; lp.frequency.value = 4300; lp.Q.value = 0.8;
    const c = new Float32Array(513); for (let i = 0; i < 513; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); } ws.curve = c; out.gain.value = 0.62;
    hp.connect(pk); pk.connect(lp); lp.connect(ws); ws.connect(out); out.connect(s.out); chain = hp; return chain;
  }
  // the pause after each clip (s): "Next stop:" breathes, halves of a name run on
  const gapAfter = (id) => (id === 'p-next' ? 0.14 : id.charAt(0) === 's' ? 0.3 : id === 'p-busto' || id.charAt(0) === 'r' ? 0.02 : 0.04);
  function play(ph) {
    const s = snd(); let secs = 0; const ids = ph.clips.filter((id) => vj && vj.clips[id]);
    if (s && vbuf && ids.length === ph.clips.length && !s.muted) {
      const ac = s.ac, dst = speaker(s); let t = Math.max(ac.currentTime + 0.06, busyUntil + 0.25); const t0 = t;
      for (const id of ids) { const c = vj.clips[id], src = ac.createBufferSource(); src.buffer = vbuf; src.connect(dst); src.start(t, Math.max(0, c[0] - 0.01), c[1] + 0.02); t += c[1] + gapAfter(id); }
      busyUntil = t; secs = t - ac.currentTime; A.stats.said++; setTimeout(() => caption(ph.text, t - t0), Math.max(0, (t0 - ac.currentTime) * 1000)); return secs;
    }
    if (vj && ids.length !== ph.clips.length) A.stats.missing = (A.stats.missing || 0) + 1;
    caption(ph.text, 2.5 + ph.text.length * 0.03); return 0;
  }
  A.say = (kind, stop, line) => {
    const ph = phrase(kind, stop, line); if (!ph) return null; A.log.push({ t: Date.now(), kind, text: ph.text, clips: ph.clips }); if (A.log.length > 60) A.log.shift();
    if (!VOICE_ON || !snd()) { caption(ph.text, 2.5 + ph.text.length * 0.03); return ph; }
    if (vbuf || (vload && !vj && A.stats.voice.indexOf('not loaded') === 0)) play(ph); else { queue.push(ph); if (queue.length > 2) queue.shift(); loadVoice().then(() => { while (queue.length) play(queue.shift()); }); }
    return ph;
  };
  A.phrase = phrase; A.tap = () => ({ gain, voice: chain, state });      // test hook: our own output node (tools/stoplap.mjs measures it)
  return A;
}
