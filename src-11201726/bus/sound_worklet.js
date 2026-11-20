// bus/sound_worklet.js: runs the bus's sound (sound_core.js) on the audio thread. One k-rate AudioParam per number; one-shots arrive as
// messages [type, voice, level].
import { BusDSP, NP } from './sound_core.js';
const NAMES = []; for (let i = 0; i < NP; i++) NAMES.push('p' + i);
class BusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return NAMES.map((name) => ({ name, defaultValue: 0, automationRate: 'k-rate' })); }
  constructor() { super(); this.dsp = new BusDSP(sampleRate); this.mono = new Float32Array(128); this.port.onmessage = (e) => { const v = e.data; if (v && v.length) this.dsp.event(v[0], v[1], v[2]); }; }
  process(inputs, outputs, params) {
    const o = outputs[0], T = this.dsp.T; if (!o || !o[0]) return true;
    for (let i = 0; i < NP; i++) T[i] = params[NAMES[i]][0];
    const n = o[0].length; if (o[1]) this.dsp.process(o[0], o[1], n); else { if (this.mono.length < n) this.mono = new Float32Array(n); this.dsp.process(o[0], this.mono, n); }
    return true;
  }
}
registerProcessor('bus-dsp', BusProcessor);
