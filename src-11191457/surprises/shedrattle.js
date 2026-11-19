// surprises/shedrattle.js: sidewalk sheds (the scaffolding roofs over New York sidewalks) that rattle when something heavy goes by
// (surprises lane, Nov 15; Matt's list, item 10).
// Under a real shed when a bus or a truck passes: the plank deck slaps on its joists, the pipe frame and its clamps chatter and ring, the whole
// thing shudders a finger's width, and grit sifts down between the planks into the light. A car that hits a post makes it bang. So here:
//   - what shakes it: buses, vans and trucks of the traffic passing within a lane or two at speed (heavier and faster = more), the player's own
//     car at speed, a subway is not counted; a crash against anything within a few metres of the shed is a bang;
//   - the shed's own deck, frame and posts (the dressing layer's instances, found by place) shudder for as long as it rings, a few millimetres at
//     13-17 Hz, and are put back exactly;
//   - sound placed at the shed: plank slap, clamp chatter, pipe ring (made in code), louder underneath;
//   - grit falling from the deck seams, drifting; a touch of camera shake if you stand under it.
//   ?shedrattle=0 off     game.surprises.mods.shedrattle.info()
// Cost: asleep unless a shed is within 32 m of the camera (one grid lookup every 0.3 s). Awake and ringing: instance buffers of the shed
// meshes are re-sent while it shakes (a second or two), one particle draw, two sound voices.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './kit.js';

const REACH = 32, NAMES = ['shed_deck', 'shed_frame', 'shed_post', 'shed_parapet'];

export function install(game, kit) {
  const g = game, P = g.P, st = g.statics;
  const S = { sheds: [], rings: 0, bangs: 0, ms: 0, shaken: 0, tune: { gain: P.has('shedgain') ? +P.get('shedgain') : 1, shake: 0.006, dust: 1 } };
  const state = new Map();      // per shed rectangle (the overhead list's own arrays): { e: energy 0..1, ph, inst: [[mesh, index, base matrix]] }
  let scanT = 0, ps = null; const L3 = [0, 0, 0], M = new THREE.Matrix4();
  const OV = () => (st && st.overhead && typeof st.overhead.near === 'function' ? st.overhead : null);
  const inRect = (r, x, y, pad) => { const dx = x - r[0], dy = y - r[1]; return Math.abs(dx * r[2] + dy * r[3]) <= r[4] + pad && Math.abs(-dx * r[3] + dy * r[2]) <= r[5] + pad; };
  const distRect = (r, x, y) => { const dx = x - r[0], dy = y - r[1], a = Math.max(0, Math.abs(dx * r[2] + dy * r[3]) - r[4]), b = Math.max(0, Math.abs(-dx * r[3] + dy * r[2]) - r[5]); return Math.hypot(a, b); };
  // the shed's own pieces: every instance of the dressing layer's shed meshes that stands inside its rectangle
  function pieces(r) { const out = [], D = g.dressing; if (!D || !D.meshes) return out;
    for (const m of D.meshes) { if (!m.isInstancedMesh || !NAMES.includes(m.name)) continue; const a = m.instanceMatrix.array; for (let i = 0; i < m.count; i++) { const o = i * 16; if (a[o] === 0 && a[o + 1] === 0 && a[o + 2] === 0) continue; if (inRect(r, a[o + 12], -a[o + 14], 0.9)) out.push([m, i, a.slice(o, o + 16), Math.random() * TAU]); } }
    return out; }
  const sOf = (r) => { let s = state.get(r); if (!s) { s = { r, e: 0, ph: Math.random() * 10, inst: null, hot: false, dustAcc: 0, bang: 0 }; state.set(r, s); } return s; };
  function excite(r, amount, bang) { const s = sOf(r); if (amount > 0.05 && s.e < 0.05) S.rings++; s.e = Math.min(1, s.e + amount); if (bang) { s.bang = Math.max(s.bang, bang); S.bangs++; } }

  // ---- sound: one looping "rattle" bed rendered once (hundreds of small hits on a few resonances: plank, pipe, clamp), and a one-shot bang
  let bed = null, voices = [];
  function mkBed(a) { const sr = a.sampleRate, n = Math.floor(sr * 3.2), buf = a.createBuffer(1, n, sr), d = buf.getChannelData(0); let sd = 24680; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    const MODES = [[92, 0.05, 0.9], [138, 0.045, 0.8], [215, 0.04, 0.6], [520, 0.07, 0.34], [790, 0.06, 0.3], [1180, 0.09, 0.26], [1630, 0.05, 0.2], [2650, 0.03, 0.2], [3900, 0.02, 0.14]];
    for (let h = 0; h < 520; h++) { const at = Math.floor(rnd() * (n - 1)), md = MODES[Math.floor(rnd() * rnd() * MODES.length * 0.999 + (rnd() < 0.35 ? 3 : 0)) % MODES.length], f = md[0] * (0.94 + rnd() * 0.12), dec = md[1] * (0.6 + rnd() * 0.9) * sr, lvl = md[2] * (0.25 + rnd() * rnd()), len = Math.floor(dec * 5), w = TAU * f / sr, ph = rnd() * TAU; let lp = 0;
      for (let i = 0; i < len; i++) { const k = (at + i) % n, e = Math.exp(-i / dec), x = rnd() * 2 - 1; lp += (x - lp) * 0.3; d[k] += (Math.sin(w * i + ph) * 0.8 + lp * (f > 1000 ? 0.9 : 0.35) * Math.exp(-i / (dec * 0.25))) * e * lvl * 0.3; } }
    return buf; }
  function voiceFor(s) { let v = voices.find((q) => q.s === s); if (v) return v; const au = kit.audio(); if (!au) return null; if (!bed) bed = mkBed(au.ac);
    v = voices.find((q) => !q.s || q.s.e < 0.02); if (!v) { if (voices.length >= 2) return null; const vo = kit.voice({ ref: 5, max: 70, level: 1, roll: 1.2 }); if (!vo) return null; const a = au.ac, src = a.createBufferSource(); src.buffer = bed; src.loop = true; const gn = a.createGain(); gn.gain.value = 0; src.connect(gn); gn.connect(vo.in); src.start(0, Math.random() * 3); v = { vo, src, gn, s: null }; voices.push(v); }
    v.s = s; v.src.playbackRate.value = 0.92 + Math.random() * 0.16; return v; }
  function bangSound(s, k) { const au = kit.audio(); if (!au) return; const v = voiceFor(s); if (!v) return; const a = au.ac, t = a.currentTime, o = a.createOscillator(), e = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(58, t + 0.16); e.gain.setValueAtTime(0.9 * k, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(e); e.connect(v.vo.in); o.start(t); o.stop(t + 0.32);
    kit.burst(v.vo, { type: 'bandpass', freq: 900, q: 0.5, gain: 0.8 * k, att: 0.001, dec: 0.09 }); kit.burst(v.vo, { type: 'bandpass', freq: 2800, q: 1.5, gain: 0.35 * k, att: 0.001, dec: 0.2, at: 0.012 }); }

  // a crash near a shed: the bang
  if (typeof g.onCrash === 'function') { const oc = g.onCrash.bind(g); g.onCrash = (v, force) => { try { const ov = OV(); if (ov && v) for (const r of ov.near(v.x, v.y, 14)) if (r[7] === 'shed' && distRect(r, v.x, v.y) < 3.2) excite(r, clamp(force / 9, 0.3, 1), clamp(force / 8, 0.4, 1.2)); } catch (e) {} return oc(v, force); }; }

  const LIGHT = g.P && g.P.has('shedlight') ? +g.P.get('shedlight') : 0.22;
  const heavy = (c) => { const len = c.def && c.def.len ? c.def.len : 4.6, t = String(c.type || ''); return len > 5.6 || /bus|van|truck|sprinter|ducato/.test(t) ? clamp((len - 3.5) / 5, 0.45, 1.3) : LIGHT; };      /* Nov 16: an ordinary car at speed gives a faint rattle too (two streets, 130 s on a real page: no bus, van or truck ever passed close and fast enough, so it was never heard); ?shedlight=0 = heavy vehicles only */
  kit.onFrame((dt, t) => {
    const t0 = performance.now(), ov = OV(); if (!ov) return; const c = kit.cam();
    scanT -= dt; if (scanT <= 0) { scanT = 0.3; S.sheds = ov.near(c.x, c.y, REACH).filter((r) => r[7] === 'shed'); for (const [r, s] of state) if (s.e <= 0 && !S.sheds.includes(r)) state.delete(r); }
    if (!S.sheds.length && !state.size) return;
    if (dt > 0) {
      // what is going by
      const pass = (x, y, sp, w) => { if (sp < 3 || w <= 0) return; for (const r of S.sheds) { const d = distRect(r, x, y); if (d > 8.5) continue; excite(r, w * smooth(3, 13, sp) * (1 - smooth(2.5, 8.5, d)) * dt * 2.6, 0); } };
      for (const q of g.traffic.cars) { if (Math.abs(q.x - c.x) > 50 || Math.abs(q.y - c.y) > 50) continue; pass(q.x, q.y, Math.abs(q.v || 0), heavy(q)); }
      const pv = g.player.vehicle; if (pv) pass(pv.x, pv.y, Math.hypot(pv.vx, pv.vy), Math.max(0.5, heavy(pv)));
      const pl = g.player;
      for (const [r, s] of state) {
        if (s.e <= 0) { if (s.hot) rest(s); continue; }
        s.ph += dt; const e = s.e; s.e = Math.max(0, s.e - dt * (0.55 + 0.9 * s.e)); if (s.e < 0.004) s.e = 0;
        // the shudder: each piece on its own phase, mostly up and down, a little along the kerb
        if (!s.inst) s.inst = pieces(r); if (s.inst.length) { s.hot = true; const amp = S.tune.shake * Math.sqrt(e), touched = new Set();
          for (const q of s.inst) { const [m, i, base, ph] = q, a = m.instanceMatrix.array, o = i * 16, w1 = Math.sin(s.ph * TAU * 14.5 + ph) * (0.6 + 0.4 * Math.sin(s.ph * 61 + ph * 3)), w2 = Math.sin(s.ph * TAU * 16.3 + ph * 1.7);
            a[o + 12] = base[12] + r[2] * w2 * amp * 0.45; a[o + 13] = base[13] + w1 * amp * (m.name === 'shed_post' ? 0.35 : 1); a[o + 14] = base[14] - r[3] * w2 * amp * 0.45; touched.add(m); }
          for (const m of touched) m.instanceMatrix.needsUpdate = true; S.shaken = s.inst.length; if (s.e === 0) rest(s); }
        // grit from the seams
        if (e > 0.12 && Math.hypot(r[0] - c.x, r[1] - c.y) < 26) { if (!ps) ps = S.ps = kit.particles({ max: 420, kind: 'puff', blending: 'mix', order: 6, name: 'sur_shed_grit' }); s.dustAcc += e * 60 * S.tune.dust * dt;
          while (s.dustAcc >= 1) { s.dustAcc -= 1; const u = (Math.random() * 2 - 1) * r[4], v = (Math.random() * 2 - 1) * r[5] * 0.9, x = r[0] + r[2] * u - r[3] * v, y = r[1] + r[3] * u + r[2] * v;
            ps.emit(x, y, r[6] - 0.02, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, -0.25 - Math.random() * 0.3, { life: 2.2 + Math.random() * 1.6, s0: 0.012, s1: 0.04 + Math.random() * 0.05, r: 0.5, g: 0.45, b: 0.37, a: 0.16 + Math.random() * 0.12, drag: 0.9, grav: 0.55, fin: 0.1, floor: 0.02 }      /* fine grit, not flakes */); } }
        // sound
        const v = voiceFor(s); if (v) { const under = inRect(r, c.x, c.y, 0.5) ? 1.35 : 1; v.gn.gain.setTargetAtTime(Math.pow(e, 0.7) * 0.9 * S.tune.gain * under, v.vo.a.currentTime, 0.04); v.vo.at(r[0] + r[2] * clamp((c.x - r[0]) * r[2] + (c.y - r[1]) * r[3], -r[4], r[4]), r[1] + r[3] * clamp((c.x - r[0]) * r[2] + (c.y - r[1]) * r[3], -r[4], r[4]), r[6], dt); }
        if (s.bang > 0) { bangSound(s, s.bang * S.tune.gain); s.bang = 0; }
        if (!pl.vehicle && inRect(r, pl.x, pl.y, 0.3) && e > 0.2 && g.cam) g.cam.shake = Math.max(g.cam.shake, Math.min(0.22, e * 0.2));
      }
      for (const v of voices) if (v.s && v.s.e <= 0) { v.gn.gain.setTargetAtTime(0, v.vo.a.currentTime, 0.08); v.s = null; }
      if (ps && ps.n) ps.step(dt, (i, p, vv, d2) => { vv[i * 3] += Math.sin(p[i * 3 + 2] * 3 + t * 1.3 + i) * d2 * 0.25; });
    }
    if (ps) { kit.light(0.9, L3); ps.draw(L3); }
    S.ms = S.ms * 0.95 + (performance.now() - t0) * 0.05;
  }, 'shedrattle');
  function rest(s) { if (s.inst) { const touched = new Set(); for (const [m, i, base] of s.inst) { m.instanceMatrix.array.set(base, i * 16); touched.add(m); } for (const m of touched) m.instanceMatrix.needsUpdate = true; } s.hot = false; s.inst = null; }

  S.info = () => ({ sheds: S.sheds.length, ringing: [...state.values()].filter((s) => s.e > 0).map((s) => +s.e.toFixed(2)), rings: S.rings, bangs: S.bangs, pieces: S.shaken, grit: ps ? ps.n : 0, voices: voices.length, ms: +S.ms.toFixed(3) });
  S.excite = excite; S.near = (x, y, r = 300) => { const ov = OV(); if (!ov) return null; let best = null, bd = 1e9; for (const q of ov.near(x, y, r)) { if (q[7] !== 'shed') continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } } return best; };
  return S;
}

// stand the player under the nearest shed and give it a truck's worth of shaking
export function show(game, kit, S) {
  const pl = game.player, r = S.near(pl.x, pl.y); if (!r) return false; const o = {};
  game.statics.resolve(r[0] - r[2] * Math.min(r[4] - 1, 3), r[1] - r[3] * Math.min(r[4] - 1, 3), 0.34, o); pl.x = o.x; pl.y = o.y; pl.h = Math.atan2(r[3], r[2]);
  if (pl.vehicle) { pl.vehicle = null; pl.vis.object.visible = true; game.cam.mode = 'foot'; } game.focus.x = pl.x; game.focus.y = pl.y; game.cam.yaw = pl.h; game.snapCamera();
  S.sheds = [r]; S.excite(r, 1, 0.8); return r;
}
