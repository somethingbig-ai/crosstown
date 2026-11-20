// worklet.js: runs the car and street sounds (core.js) on the audio thread. One k-rate AudioParam per number in core.js's I;
// one-off events arrive as messages [kind, force, pan].
import { CarDSP, NP, ONE } from './core.js';

const NAMES = []; for (let i = 0; i < NP; i++) NAMES.push('p' + i);

class CarProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return NAMES.map((name, i) => ({ name, defaultValue: ONE.includes(i) ? 1 : 0, automationRate: 'k-rate' })); }
  constructor(o) {
    super(); this.dsp = new CarDSP(sampleRate, (o && o.processorOptions) || {}); this.mono = new Float32Array(128);
    this.port.onmessage = (e) => { const v = e.data; if (v === 'state') this.port.postMessage(this.dsp.state()); else if (v && v.samples) { try { this.dsp.setSamples(v.samples); } catch (err) { this.dsp.setSamples(null); } } else if (Array.isArray(v) && v.length >= 2) this.dsp.ev(+v[0], +v[1] || 0, +v[2] || 0); };
  }
  process(inputs, outputs, params) {
    const o = outputs[0], T = this.dsp.T; if (!o || !o[0]) return true;
    for (let i = 0; i < NP; i++) T[i] = params[NAMES[i]][0];
    const n = o[0].length; if (o[1]) this.dsp.process(o[0], o[1], n); else { if (this.mono.length < n) this.mono = new Float32Array(n); this.dsp.process(o[0], this.mono, n); }
    return true;
  }
}
registerProcessor('car-dsp', CarProcessor);
