// sound.js: the helicopter's sound in the game. All of it is made in sound/core.js (rotor, tail rotor, turbine, gearbox, wind, the
// path to the listener, the cabin, contacts), which runs in one AudioWorklet node on the audio thread; this file only tells it, once a
// drawn frame, what the aircraft is doing and where the listener is (sound/params.js). Nothing is created until the game's own sound
// is on (the player's first key or click); the node feeds the game's master gain, so the game's mute silences it too.
//   nodes: AudioWorkletNode -> GainNode -> game.sound.out      (the limiter is inside the worklet)
import { HeliDSP } from './sound/core.js';
import { I, NP, STEP, HIT, pack } from './sound/params.js';

const SNAP = [I.DIST, I.GDELAY, I.AZC, I.AZS, I.SINEL, I.SIDE, I.PAN, I.INSIDE];      // on a camera cut these go across at once

export class HeliSound {
  constructor(ctx) {
    this.ctx = ctx; this.P = new Float32Array(NP); this.sent = new Float32Array(NP).fill(NaN); this.st = { jump: 1 };
    this.state = 0; this.node = null; this.par = null; this.dsp = null; this.gain = null; this.pend = [0, 0, 0]; this.cool = [0, 0, 0]; this.level = 1; this.jumpSent = -1;
    this.opts = { rpm: ctx.DIMS.rpm, tailRpm: ctx.DIMS.tailRpm, R: ctx.DIMS.rotorR, tailR: ctx.DIMS.tailRotorR };
  }
  // 0 not started, 1 loading, 2 playing, 3 failed
  start(s) {
    const ac = s.ac; this.state = 1;
    const wire = (node) => { const g = (this.gain = ac.createGain()); g.gain.value = this.level; node.connect(g); g.connect(s.out); this.node = node; this.state = 2; };
    const fallback = (why) => {      // no worklets here: the same code on the main thread
      try {
        console.log('[heli] sound: no audio worklet (' + why + '), using a script node');
        const dsp = (this.dsp = new HeliDSP(ac.sampleRate, this.opts)), sp = ac.createScriptProcessor(1024, 0, 2), l = new Float32Array(128), r = new Float32Array(128);
        sp.onaudioprocess = (e) => { const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1); dsp.T.set(this.P); for (let p = 0; p < L.length; p += 128) { const n = Math.min(128, L.length - p); dsp.process(l, r, n); for (let i = 0; i < n; i++) { L[p + i] = l[i]; R[p + i] = r[i]; } } };
        wire(sp);
      } catch (e) { this.state = 3; console.log('[heli] sound FAILED: ' + (e && e.message)); }
    };
    if (!ac.audioWorklet || typeof AudioWorkletNode === 'undefined') { fallback('not supported'); return; }
    ac.audioWorklet.addModule(new URL('./sound/worklet.js', import.meta.url)).then(() => {
      const node = new AudioWorkletNode(ac, 'heli-dsp', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: this.opts });
      this.par = []; for (let i = 0; i < NP; i++) this.par.push(node.parameters.get('p' + i));
      node.onprocessorerror = () => { console.log('[heli] sound: the audio worklet stopped'); this.state = 3; };
      wire(node);
    }).catch((e) => fallback(e && e.message));
  }
  update(f, dt, listener, view) {
    const s = this.ctx.game.sound; if (!s || !s.on || !s.ac || !s.out) return;
    if (this.state === 0) this.start(s);
    if (this.state !== 2) return;
    const P = pack(this.P, this.st, f, listener, view, this.ctx, dt);
    if (this.par) {
      const now = s.ac.currentTime, sent = this.sent, par = this.par, cut = P[I.JUMP] !== this.jumpSent; this.jumpSent = P[I.JUMP];
      for (let i = 0; i < NP; i++) { const v = P[i]; if (v === sent[i]) continue; sent[i] = v; par[i].setTargetAtTime(v, now, 0.006); }
      for (const i of STEP) par[i].setValueAtTime(P[i], now);
      if (cut) for (const i of SNAP) { par[i].cancelScheduledValues(now); par[i].setValueAtTime(P[i], now); }
    }
    // contacts: the hardest of each kind this frame, not more often than the ear can separate
    for (let k = 0; k < 3; k++) {
      this.cool[k] -= dt; const sp = this.pend[k]; if (sp <= 0) continue; this.pend[k] = 0; if (this.cool[k] > 0) continue; this.cool[k] = 0.07;
      if (this.par) this.node.port.postMessage(k * 1000 + Math.min(sp, 999)); else this.dsp.hit(k, sp);
    }
  }
  hit(h) { const k = HIT[h.kind]; if (k !== undefined && h.speed > this.pend[k]) this.pend[k] = h.speed; }
}
