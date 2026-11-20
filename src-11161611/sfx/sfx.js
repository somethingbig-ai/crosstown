// sfx.js: the car and street sounds in the game (gameplay lane, players' reports "car and effect sounds are poor"). Everything is made in
// core.js, which runs in ONE AudioWorklet node on the audio thread; this file only tells it, once a drawn frame, what the player's car is
// doing, which cars are passing and how fast he walks, and passes on the blows. Loaded by the lead's audio.js after the first key or click
// (nothing here is part of the first load); ?snd=old keeps the old sounds. If the browser has no audio worklets, start() fails and
// audio.js falls back to the old sounds.
//   nodes: AudioWorkletNode -> GainNode -> game.sound.out
import { I, NP, NV, EV, TYPES } from './core.js';

const _o = {}, clamp = (x, a, b) => (x < a ? a : x > b ? b : x), POLE = /light|tree|signal|hydrant|pole|meter|post|sign/;

export class Sfx {
  constructor(sound) {
    this.s = sound; this.g = sound.g; this.P = new Float32Array(NP); this.sent = new Float32Array(NP).fill(NaN); this.par = null; this.node = null; this.gain = null;
    this.slots = []; for (let k = 0; k < NV; k++) this.slots.push({ car: null, d: 0, vr: 0, hid: 0, hidK: 0, hidT: 0 });
    this.wasWalk = false; this.lastCrash = -1; this.stats = { crash: 0, kerb: 0, scrape: 0, pass: 0, ms: 0, n: 0, err: 0 };
  }
  start() {
    const ac = this.s.ac; if (!ac.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.reject(new Error('no audio worklets in this browser'));
    return ac.audioWorklet.addModule(new URL('./worklet.js', import.meta.url)).then(() => {
      const node = (this.node = new AudioWorkletNode(ac, 'car-dsp', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }));
      this.par = []; for (let i = 0; i < NP; i++) this.par.push(node.parameters.get('p' + i));
      node.onprocessorerror = () => { console.log('[sound] the car sounds stopped (audio worklet error)'); this.dead = true; };
      const g = (this.gain = ac.createGain()); g.gain.value = 1; node.connect(g); g.connect(this.s.out);
      /* the recorded clips come after the game is playable, in the background; until they are in (and for any that are missing) the synthesis plays. ?snd=synth: synthesis only */
      let mode = ''; try { mode = new URLSearchParams(location.search).get('snd') || ''; } catch (e) {}
      if (mode !== 'synth') setTimeout(() => { import('./samples.js').then((m) => m.loadSamples(this, new URL('../../assets/sfx/', import.meta.url))).then((r) => { this.samples = r; if (r.clips) console.log('[sound] ' + r.clips + ' recorded clips in (' + Math.round(r.bytes / 1024) + ' KB, ' + r.ms + ' ms)' + (r.failed.length ? '; not loaded: ' + r.failed.join(', ') : '')); }).catch(() => {}); }, 2500);
      return this;
    });
  }
  ev(kind, force, pan = 0) { if (this.node) this.node.port.postMessage([kind, force, pan]); }
  /* the game's crash(force): what was hit? another car (traffic, a parked or loose one), a pole, or a wall */
  crash(force) {
    const g = this.g, v = g.player && g.player.vehicle, t = performance.now(); if (t - this.lastCrash < 90) return; this.lastCrash = t; this.stats.crash++;
    let kind = EV.WALL;
    try {
      if (v) { const L = v.def.len, reach = (o) => { const d = Math.hypot(o.x - v.x, o.y - v.y); return d < (L + (o.def ? o.def.len : 4.5)) * 0.5 + 0.5; }; let car = false;
        for (const o of (g.traffic && g.traffic.cars) || []) if (Math.abs(o.x - v.x) < 10 && Math.abs(o.y - v.y) < 10 && reach(o)) { car = true; break; }
        if (!car) for (const o of g.vehicles || []) if (o !== v && reach(o)) { car = true; break; }
        if (car) kind = EV.CAR;
        else { const ch = Math.cos(v.h), sh = Math.sin(v.h), r = v.def.wid * 0.5; for (const o of [L * 0.3, 0, -L * 0.3]) if (g.statics.resolve(v.x + ch * o, v.y + sh * o, r + 0.25, _o)) { const tag = _o.tag; if (tag && typeof tag === 'object' && tag.def) { kind = EV.CAR; break; } if (typeof tag === 'string' && POLE.test(tag)) kind = EV.POLE; } }
      }
    } catch (e) { this.stats.err++; }
    this.ev(kind, force, 0);
  }
  thud() { this.ev(EV.BODY, 9, 0); }
  clatter(force) { this.ev(EV.BIKE, force, 0); }      // a struck bicycle (riders.js, ?cychit): force = the closing speed in m/s
  door() { this.ev(EV.DOOR, 1, 0); }
  update(dt) { try { this.frame(dt); } catch (e) { if (!this.stats.err++) console.log('[sound] car sounds, a frame failed: ' + (e && (e.stack || e.message))); } }
  frame(dt) {
    if (!this.par || this.dead) return; const t0 = performance.now(), g = this.g, pl = g.player, P = this.P, v = pl && pl.vehicle && pl.vehicle.spec ? pl.vehicle : null, inp = g.input || {};
    P.fill(0); P[I.BED] = 1; P[I.VENG] = 1; P[I.VAMB] = 1;
    /* the settings menu (progress lane, src/menu/menu.js) puts game.sound.out on its Effects bus and gives Engine and Ambience their own sliders: our one node cannot sit
       on three buses, so the two slider levels go in as numbers (a bus at full is 0.8); and its master is passed through the soft knee audio.js made, once */
    { const s = this.s, b = s.bus; if (b) { if (b.engine) P[I.VENG] = Math.min(1.5, b.engine.gain.value / 0.8); if (b.ambience) P[I.VAMB] = Math.min(1.5, b.ambience.gain.value / 0.8);
        if (s.master && s.knee && !this.kneeOn) { this.kneeOn = true; try { s.master.disconnect(); s.master.connect(s.knee); } catch (e) { try { s.master.connect(s.ac.destination); } catch (e2) {} } } } }
    if (v) {
      const vf = v.vf || 0, thr = inp.throttle || 0, br = inp.brake || 0; let ti = TYPES.indexOf(v.type); if (ti < 0) { const n = String(v.type || '');      /* the street's parked cars carry model names (ox_cab, ox_sprinter, ...): which engine each gets */
        ti = /cab|taxi/.test(n) ? 1 : /sprinter|ducato|gvan|stepvan|boxtruck|van|truck/.test(n) ? 3 : /tucson|q7|duster|suv|pickup/.test(n) ? 2 : /bus/.test(n) || (v.def && v.def.len > 7) ? 5 : /sport/.test(n) ? 4 : 0; }
      P[I.INCAR] = 1; P[I.TYPE] = ti; P[I.SPEED] = vf; P[I.TOP] = v.spec.top || 40;
      P[I.THR] = vf >= -0.5 ? thr : vf <= 0.6 && br > 0 ? br * 0.6 : 0; if (vf <= 0.6 && br > 0 && thr === 0) P[I.THR] = br * 0.6;      // the brake key is the way back: the engine pulls then too
      P[I.BRAKE] = br; P[I.HB] = inp.handbrake ? 1 : 0; P[I.SLIP] = v.slip || 0;
      const walk = (v.z || 0) > 0.075; P[I.WALK] = walk ? 1 : 0; if (walk !== this.wasWalk) { this.wasWalk = walk; if (Math.abs(vf) > 1) { this.ev(EV.KERB, Math.abs(vf), 0); this.stats.kerb++; } }
      // sliding along a wall: is the body against something while it moves along it
      let scr = 0; const sp = Math.hypot(v.vx, v.vy);
      if (sp > 2 && g.statics && g.statics.resolve) { const ch = Math.cos(v.h), sh = Math.sin(v.h), L = v.def.len, r = v.def.wid * 0.5; for (const o of [L * 0.3, -L * 0.3]) if (g.statics.resolve(v.x + ch * o, v.y + sh * o, r + 0.05, _o) && (_o.nx || _o.ny)) scr = Math.max(scr, Math.abs(v.vx * -_o.ny + v.vy * _o.nx)); }
      P[I.SCRAPE] = scr > 1.5 ? scr : 0; if (scr > 1.5) this.stats.scrape++;
    } else { this.wasWalk = false; if (pl) P[I.FOOT] = g.jump && g.jump.phase === 'air' ? 0 : (pl.speed || 0); }
    // passing cars: the nearest few of the traffic, each in a voice of its own until it is far away
    const cam = g.world && g.world.camera, cars = (g.traffic && g.traffic.cars) || [];
    if (cam && dt > 0) {
      const lx = cam.position.x, ly = -cam.position.z, e = cam.matrixWorld.elements, S = this.slots;
      for (const s of S) { const c = s.car; if (!c) continue; const d = Math.hypot(c.x - lx, c.y - ly); if (d > 75 || c.dead || !cars.includes(c)) { s.car = null; continue; }
        const vr = clamp((s.d - d) / dt, -70, 70); s.vr += (vr - s.vr) * Math.min(1, dt * 8); s.d = d;
        s.hidT -= dt; if (s.hidT <= 0) { s.hidT = 0.2 + 0.05 * S.indexOf(s); s.hid = d > 12 && g.statics.raycast(lx, ly, c.x, c.y) < 1 ? 1 : 0; } s.hidK += (s.hid - s.hidK) * Math.min(1, dt * 5); }
      let free = S.find((s) => !s.car);
      if (free) { let best = null, bd = 55; for (const c of cars) { if (c === v || c.dead) continue; const dx = c.x - lx, dy = c.y - ly; if (dx > bd || dx < -bd || dy > bd || dy < -bd) continue; const d = Math.hypot(dx, dy); if (d < bd && !S.some((s) => s.car === c)) { bd = d; best = c; } }
        if (best) { free.car = best; free.d = bd; free.vr = 0; free.hid = 0; free.hidK = 0; free.hidT = 0; this.stats.pass++; } }
      for (let k = 0; k < NV; k++) { const s = S[k], c = s.car, o = I.PASS + 5 * k; if (!c) continue; const dx = c.x - lx, dz = -c.y - cam.position.z;
        P[o] = Math.max(1.5, s.d * (1 + 1.3 * s.hidK)); P[o + 1] = s.vr; P[o + 2] = clamp((dx * e[0] + dz * e[2]) / Math.max(s.d, 4), -0.8, 0.8); P[o + 3] = Math.abs(c.v || 0); P[o + 4] = c.def && c.def.len > 6 ? 1 : 0; }
    }
    const par = this.par, sent = this.sent; for (let i = 0; i < NP; i++) { const x = P[i]; if (x === sent[i] || x !== x || x === Infinity || x === -Infinity) continue; sent[i] = x; par[i].value = x; }
    this.stats.ms += performance.now() - t0; this.stats.n++;
  }
}
export function start(sound) { return new Sfx(sound).start(); }
