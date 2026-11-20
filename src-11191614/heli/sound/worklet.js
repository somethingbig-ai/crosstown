// worklet.js: runs the helicopter's sound (core.js) on the audio thread. One k-rate AudioParam per number in params.js;
// contacts arrive as messages (a number: kind * 1000 + speed).
import { HeliDSP } from './core.js';
import { NP } from './params.js';

const NAMES = []; for (let i = 0; i < NP; i++) NAMES.push('p' + i);

class HeliProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return NAMES.map((name) => ({ name, defaultValue: 0, automationRate: 'k-rate' })); }
  constructor(o) {
    super(); this.dsp = new HeliDSP(sampleRate, (o && o.processorOptions) || {}); this.mono = new Float32Array(128);
    this.port.onmessage = (e) => { const v = e.data; if (typeof v === 'number') this.dsp.hit(Math.floor(v / 1000), v % 1000); };
  }
  process(inputs, outputs, params) {
    const o = outputs[0], T = this.dsp.T; if (!o || !o[0]) return true;
    for (let i = 0; i < NP; i++) T[i] = params[NAMES[i]][0];
    const n = o[0].length; if (o[1]) this.dsp.process(o[0], o[1], n); else { if (this.mono.length < n) this.mono = new Float32Array(n); this.dsp.process(o[0], this.mono, n); }
    return true;
  }
}
registerProcessor('heli-dsp', HeliProcessor);
