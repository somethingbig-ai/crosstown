// surprises/jingle.js: the ice-cream truck you hear before you see it (surprises lane, Nov 15; Matt's list, item 8).
// A soft-serve truck (MISTER DRIPPEE: our own name, our own tune, our own art) works the streets round the player. Its music-box jingle comes
// through a tinny roof horn, so it carries: faint and muffled from blocks away behind the buildings, clearer as it nears, then the truck
// turns the corner. As with the real ones:
//   - the tune loops with a breath between rounds, a little too bright and slightly out of true, with the horn's own nasal colour;
//   - buildings in the way take the top off it, distance thins it, and it bends a little in pitch as the truck comes at you and goes away;
//   - the truck is one of the traffic's own step vans in ice-cream dress: white with a blue skirt, the name and a menu of treats down both
//     sides, a serving window on the kerb side, a giant cone and the horn on the roof, a "SLOW  children" board on the back;
//   - get in and drive it off and the jingle comes with you.
// No vehicle is added to the traffic: one that is already there, far off and out of sight, is given the dress.
//   ?jingle=0 off     ?jinglefirst=20 seconds before the first truck (default 75-150)     game.surprises.mods.jingle.info()
// Cost: asleep except for one check a second. With a truck out: its dress is 5 draws near (under 2,500 triangles), one sound voice.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './kit.js';

export const NAME = 'MISTER DRIPPEE';
// ---- the tune (ours: written for this game). 6/8, in C; [midi note, length in eighths]; 0 = rest. A A' B A', then a breath.
const A1 = [[76, 1], [79, 1], [84, 1], [83, 1], [81, 1], [79, 1], [81, 1], [77, 1], [74, 1], [79, 3], [76, 1], [79, 1], [84, 1], [86, 1], [84, 1], [83, 1], [84, 3], [79, 3]];
const A2 = [[76, 1], [79, 1], [84, 1], [83, 1], [81, 1], [79, 1], [81, 1], [77, 1], [74, 1], [79, 3], [77, 1], [81, 1], [84, 1], [83, 1], [79, 1], [74, 1], [72, 3], [0, 3]];
const B1 = [[81, 1], [84, 1], [81, 1], [79, 1], [76, 1], [79, 1], [77, 1], [81, 1], [77, 1], [76, 3], [74, 1], [76, 1], [77, 1], [79, 1], [81, 1], [83, 1], [84, 3], [86, 3]];
const BASS = { A: [48, 55, 53, 55, 48, 55, 55, 48], A2: [48, 55, 53, 55, 53, 55, 48, 48], B: [53, 48, 53, 48, 50, 55, 48, 55] };      // one note per half bar
export function renderJingle(sr) {
  const E = 0.212, seq = [[A1, BASS.A], [A2, BASS.A2], [B1, BASS.B], [A2, BASS.A2]], bars = 4 * seq.length, len = Math.floor((bars * 6 * E + 2.6) * sr), d = new Float32Array(len), hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // a music-box comb: the fundamental, a soft octave, the bar's own untuned overtone, a tick as the pin lets go
  const note = (t0, m, eighths, lvl) => { const f = hz(m) * 1.004, n0 = Math.floor(t0 * sr), dec = (0.26 + 0.1 * eighths) * (m < 60 ? 1.5 : 1), N = Math.floor(Math.min(dec * 5, 1.8) * sr), w = TAU * f / sr;
    for (let i = 0; i < N && n0 + i < len; i++) { const t = i / sr, e = Math.exp(-t / dec); d[n0 + i] += lvl * (Math.sin(w * i) * e + 0.32 * Math.sin(2 * w * i) * Math.exp(-t / (dec * 0.6)) + 0.16 * Math.sin(5.4 * w * i) * Math.exp(-t / 0.035) + (i < 60 ? 0.25 * (1 - i / 60) * (((i * 7919) % 13) / 6.5 - 1) : 0)); } };
  let t = 0.05; for (const [mel, bass] of seq) { let u = t; for (const [m, e] of mel) { if (m) note(u, m, e, 0.2); u += e * E; } for (let k = 0; k < 8; k++) { note(t + k * 3 * E, bass[k], 3, 0.13); note(t + k * 3 * E + E, bass[k] + 16, 1, 0.045); note(t + k * 3 * E + 2 * E, bass[k] + 19, 1, 0.045); } t += 24 * E; }
  let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i])); const k = 0.8 / (pk || 1); for (let i = 0; i < len; i++) d[i] *= k;
  return d;
}

// ---- the dress: drawn once on canvases
function sideArt(kerb) {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = '#f6f5ef'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1f55b5'; g.beginPath(); g.moveTo(0, H); g.lineTo(0, 400); for (let x = 0; x <= W; x += 16) g.lineTo(x, 400 + Math.sin(x / 58) * 14); g.lineTo(W, H); g.fill();      // the blue skirt with a scalloped top
  g.fillStyle = '#e9423a'; for (let x = 0; x <= W; x += 16) { g.beginPath(); g.arc(x, 392 + Math.sin(x / 58) * 14, 3.2, 0, TAU); g.fill(); }
  const cone = (x, y, s, top) => { g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#d9a25a'; g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.lineTo(0, 78); g.fill(); g.strokeStyle = '#a8712f'; g.lineWidth = 2; for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(k * 8 - 14, 0); g.lineTo(k * 8 + 8, 60); g.stroke(); g.beginPath(); g.moveTo(k * 8 + 14, 0); g.lineTo(k * 8 - 8, 60); g.stroke(); }
    g.fillStyle = top; for (const [r, yy] of [[27, -8], [22, -30], [16, -50], [9, -66]]) { g.beginPath(); g.ellipse(0, yy, r, 15, 0, 0, TAU); g.fill(); } g.beginPath(); g.moveTo(-5, -74); g.quadraticCurveTo(4, -96, 10, -82); g.lineTo(4, -70); g.fill(); g.restore(); };
  const tx = kerb ? 40 : 300;      // on the kerb side the serving window takes the rear half
  g.fillStyle = '#1f55b5'; g.font = '900 ' + (kerb ? 62 : 88) + 'px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'alphabetic'; { const m = g.measureText('Mister '), w1 = (m && m.width) || (kerb ? 215 : 305); g.save(); g.translate(tx + 6, 150); g.transform(1, 0, -0.18, 1, 0, 0); g.fillText('Mister', 0, 0); g.fillStyle = '#e9423a'; g.fillText('Drippee', w1, 0); g.restore(); }
  g.fillStyle = '#1f55b5'; g.font = '700 ' + (kerb ? 21 : 30) + 'px Arial, sans-serif'; g.fillText('SOFT SERVE  ·  SHAKES  ·  SUNDAES', tx + 10, 204);
  g.font = 'italic 700 ' + (kerb ? 22 : 26) + 'px Georgia, serif'; g.fillStyle = '#e9423a'; g.fillText('“It was whole when you paid.”', tx + 12, 244);
  if (!kerb) { cone(tx + 668, 120, 1.25, '#fffdf6'); cone(tx + 716, 150, 0.8, '#f4b6c8'); }
  // the menu of treats: a strip of stickers
  const SW = 74, sy = 276, n = kerb ? 5 : 9, sx = kerb ? 48 : 60; for (let k = 0; k < n; k++) { const x = sx + k * (SW + 14); g.fillStyle = ['#fff3c9', '#ffe0ea', '#dff1ff', '#e6f7d9'][k % 4]; g.strokeStyle = '#1f55b5'; g.lineWidth = 3; g.beginPath(); g.roundRect(x, sy, SW, 96, 9); g.fill(); g.stroke();
    if (k % 3 === 0) cone(x + SW / 2, sy + 44, 0.42, ['#fffdf6', '#7b4a2b', '#f4b6c8'][k % 3]); else if (k % 3 === 1) { g.fillStyle = ['#e9423a', '#f29a2e', '#7b4a2b'][k % 3]; g.beginPath(); g.roundRect(x + 24, sy + 12, 26, 50, 10); g.fill(); g.fillStyle = '#d9a25a'; g.fillRect(x + 34, sy + 62, 6, 20); } else { g.fillStyle = '#fffdf6'; g.beginPath(); g.moveTo(x + 18, sy + 30); g.lineTo(x + 56, sy + 30); g.lineTo(x + 50, sy + 78); g.lineTo(x + 24, sy + 78); g.fill(); g.strokeStyle = '#e9423a'; g.beginPath(); g.moveTo(x + 44, sy + 30); g.lineTo(x + 54, sy + 10); g.stroke(); g.fillStyle = '#f4b6c8'; g.beginPath(); g.ellipse(x + 37, sy + 28, 19, 9, 0, 0, TAU); g.fill(); }
    g.fillStyle = '#1f55b5'; g.font = '700 11px Arial, sans-serif'; g.fillText(['CONE', 'POP', 'SHAKE', 'DIP', 'BAR', 'FLOAT', 'TWIST', 'ICE', 'CUP'][k], x + 8, sy + 91); }
  if (kerb) { // the serving window: dark inside, a steel sill, a sliding pane half open, a hand-lettered price card
    const x0 = 560, y0 = 96, w = 400, h = 250; g.fillStyle = '#c9ccd0'; g.fillRect(x0 - 10, y0 - 10, w + 20, h + 22); g.fillStyle = '#15171a'; g.fillRect(x0, y0, w, h); const gr = g.createLinearGradient(0, y0, 0, y0 + h); if (gr) { gr.addColorStop(0, 'rgba(255,240,200,0.28)'); gr.addColorStop(1, 'rgba(255,240,200,0.02)'); g.fillStyle = gr; g.fillRect(x0, y0, w, h); }
    g.fillStyle = 'rgba(170,200,225,0.33)'; g.fillRect(x0 + w * 0.5, y0, w * 0.5, h); g.strokeStyle = '#8a8f96'; g.lineWidth = 5; g.strokeRect(x0 + w * 0.5, y0 + 2, w * 0.5 - 2, h - 4); g.fillStyle = '#a9adb3'; g.fillRect(x0 - 22, y0 + h + 6, w + 44, 14);
    g.fillStyle = '#9aa0a6'; g.fillRect(x0 + 40, y0 + 120, 46, 130); g.fillRect(x0 + 110, y0 + 150, 60, 100); g.fillStyle = '#fffdf6'; g.fillRect(x0 + 212, y0 + 20, 150, 92); g.fillStyle = '#1f55b5'; g.font = '700 20px Arial, sans-serif'; g.fillText('CONE   small', x0 + 222, y0 + 46); g.fillText('CONE   large', x0 + 222, y0 + 72); g.fillStyle = '#e9423a'; g.fillText('SPRINKLES +', x0 + 222, y0 + 98); }
  return cv;
}
function rearArt() { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const g = cv.getContext('2d'); g.fillStyle = '#f6f5ef'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#1f55b5'; g.fillRect(0, 400, 512, 112);
  g.fillStyle = '#e9423a'; g.font = '900 104px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('SLOW', 256, 150); g.fillStyle = '#1f55b5'; g.font = '800 54px Arial, sans-serif'; g.fillText('CHILDREN', 256, 232); g.font = '700 30px Arial, sans-serif'; g.fillText('and melting', 256, 280); g.fillStyle = '#fffdf6'; g.font = '800 38px "Arial Rounded MT Bold", Arial, sans-serif'; g.fillText('MISTER DRIPPEE', 256, 470); return cv; }

export function install(game, kit) {
  const g = game, P = g.P, st = g.statics;
  const S = { state: 'wait', car: null, t: 0, next: P.has('jinglefirst') ? +P.get('jinglefirst') : 75 + Math.random() * 75, shows: 0, stolen: 0, ms: 0,
    // the dress on a step van, in the van's own frame (x ahead, y up, z to its right), as fractions of its length / width / height; set from a look at the model
    fit: { x0: -0.47, x1: 0.2, y0: 0.2, y1: 0.93, out: 0.012, roofX: -0.05, hornX: 0.27 }, tune: { level: 0.9, ref: 16, max: 430 } };
  for (const k in S.fit) if (P.has('jf_' + k)) S.fit[k] = +P.get('jf_' + k);
  let dress = null, voice = null, src = null, buf = null, mus = null;
  const WHITE = 0xf2f1ea;
  function mkDress(def) { const L = def.len, Wd = def.wid, Hh = def.hgt, F = S.fit, G = new THREE.Group(); G.name = 'sur_icecream_truck'; const x0 = F.x0 * L, x1 = F.x1 * L, y0 = F.y0 * Hh, y1 = F.y1 * Hh, zz = Wd / 2 + F.out;
    const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }, mat = (cv) => new THREE.MeshStandardMaterial({ map: tex(cv), roughness: 0.42, metalness: 0.0 });
    const panel = (cv, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(cv));
    const r = panel(sideArt(false), x1 - x0, y1 - y0); r.position.set((x0 + x1) / 2, (y0 + y1) / 2, zz); G.add(r);      // kerb side (the van's right): faces +z
    const l = panel(sideArt(true), x1 - x0, y1 - y0);      /* the serving window faces the kerb: on a page the van's kerb side is -z here (seen in the stills of look 4) */ l.position.set((x0 + x1) / 2, (y0 + y1) / 2, -zz); l.rotation.y = Math.PI; G.add(l);
    const b = panel(rearArt(), Wd * 0.86, (y1 - y0) * 0.9); b.position.set(-L / 2 - F.out - 0.02, (y0 + y1) / 2, 0); b.rotation.y = -Math.PI / 2; G.add(b);
    // on the roof: the giant cone (wafer, three turns of soft serve, the curl) and the horn
    const roof = new THREE.Group(); roof.position.set(F.roofX * L, Hh, 0); const wafer = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.72, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8924d, roughness: 0.8, side: THREE.DoubleSide })); wafer.rotation.x = Math.PI; wafer.position.y = 0.4; roof.add(wafer);
    const pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40, turns = 3.2, bulge = Math.abs(Math.sin(u * Math.PI * turns)); pts.push(new THREE.Vector2(Math.max(0.004, (0.34 - 0.3 * u) * (0.78 + 0.22 * bulge)), 0.76 + u * 0.62)); }
    const swirl = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: 0xfbf7ee, roughness: 0.55 })); roof.add(swirl); const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x1f55b5, roughness: 0.5 })); base.position.y = 0.03; roof.add(base); G.add(roof);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide })); horn.rotation.z = Math.PI / 2; horn.position.set(F.hornX * L, Hh + 0.2, 0.3); G.add(horn);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), horn.material); post.position.set(F.hornX * L - 0.1, Hh + 0.1, 0.3); G.add(post);
    G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (kit.bakeLit) kit.bakeLit(o.material); } }); G.userData.tris = 0; G.traverse((o) => { if (o.isMesh) G.userData.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return G; }

  function startSound() { const au = kit.audio(); if (!au || voice) return; voice = kit.voice({ ref: S.tune.ref, max: S.tune.max, level: S.tune.level, wall: true, roll: 0.8 }); if (!voice) return; const a = au.ac;
    if (!buf) { const d = renderJingle(a.sampleRate); buf = a.createBuffer(1, d.length, a.sampleRate); buf.getChannelData(0).set(d); }
    src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    // the roof horn: a narrow, nasal band and a little grit, and the tape's slow wow
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 520; const pk = a.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1900; pk.Q.value = 1.1; pk.gain.value = 9; const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4300;
    const ws = a.createWaveShaper(), N = 1025, cu = new Float32Array(N); for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; cu[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); } ws.curve = cu;
    const wow = a.createOscillator(), wg = a.createGain(); wow.frequency.value = 0.42; wg.gain.value = 5; wow.connect(wg); wg.connect(src.detune); wow.start();
    src.connect(hp); hp.connect(pk); pk.connect(ws); ws.connect(lp); lp.connect(voice.in); src.start(); mus = { src, wow }; }
  function stopSound() { if (mus) { try { mus.src.stop(); mus.wow.stop(); } catch (e) {} mus = null; } if (voice) { voice.off(); voice.stop(); voice = null; } }

  const hidden = (c, pl) => st.raycast(pl.x, pl.y, c.x, c.y) < 1;
  function pick() { const pl = g.player; let best = null, bs = -1; for (const c of g.traffic.cars) { if (c.dead || c.dbl || c.sur) continue; const t = String(c.type); if (t !== 'stepvan' && !(S.anyVan && /van|truck/.test(t))) continue; const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (d < 110 || d > 340) continue; const s = (hidden(c, pl) ? 2 : 0) + (1 - Math.abs(d - 200) / 200) + (t === 'stepvan' ? 1 : 0); if (s > bs) { bs = s; best = c; } } return best; }
  function begin(c) { S.car = c; S.state = 'out'; S.shows++; c.sur = 'icecream'; S.color0 = c.color; c.color = WHITE; c._vv = null; if (!dress || dress.userData.type !== c.type) { if (dress) g.world.scene.remove(dress); dress = mkDress(c.def); dress.userData.type = c.type; g.world.scene.add(dress); } dress.visible = true; S.t = 0; S.d0 = -1; }
  function end() { if (S.car && S.car.sur) { S.car.sur = null; } S.car = null; S.state = 'wait'; S.next = 240 + Math.random() * 200; if (dress) dress.visible = false; stopSound(); }

  let chk = 0;
  kit.onFrame((dt, t) => {
    const t0 = performance.now(), pl = g.player;
    if (S.state === 'wait') { if (dt <= 0) return; S.next -= dt; chk -= dt; if (S.next > 0 || chk > 0) return; chk = 1; const n = g.night ? g.night.n || 0 : 0; if (n > 0.6) return; const c = pick(); if (c) begin(c); else if (S.next < -40) S.anyVan = true; return; }
    // the truck: still in the traffic, or driven off by the player
    let c = S.car; const inTraffic = c.spec ? g.vehicles.includes(c) : g.traffic.cars.includes(c);
    if (!inTraffic) { const v = !c.spec && g.vehicles.find((q) => q.def === c.def && Math.hypot(q.x - c.x, q.y - c.y) < 3);      /* taken by the player: the traffic's car has become one of the game's loose vehicles at the same spot */ if (v) { v.sur = 'icecream'; v.color = WHITE; S.car = c = v; S.stolen++; } else { end(); return; } }
    S.t += dt; const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (!c.spec && c.color !== WHITE) c.color = WHITE;
    // dress follows the van
    const z = c.z || 0; dress.position.set(c.x, z, -c.y); dress.rotation.set(c.roll || 0, c.h, c.pitch || 0, 'YZX'); dress.visible = d < 260;
    // the jingle: from the horn, bent by the truck's speed toward or away from the ear
    if (!voice && kit.audio()) startSound();
    if (voice && dt > 0) { const cam = kit.cam(), hx = c.x + Math.cos(c.h) * S.fit.hornX * c.def.len, hy = c.y + Math.sin(c.h) * S.fit.hornX * c.def.len, dd = Math.hypot(hx - cam.x, hy - cam.y); voice.at(hx, hy, c.def.hgt + 0.2, dt);
      if (S.d0 >= 0) { const vr = clamp((S.d0 - dd) / dt, -30, 30); S.vr = (S.vr || 0) + (vr - (S.vr || 0)) * Math.min(1, dt * 3); mus.src.playbackRate.setTargetAtTime(1 + S.vr / 343, voice.a.currentTime, 0.1); } S.d0 = dd;
      const inside = c.spec && pl.vehicle === c; voice.level = S.tune.level * (inside ? 0.55 : 1); }
    if (c.spec && pl.vehicle !== c && d > 300) end();
    S.ms = S.ms * 0.95 + (performance.now() - t0) * 0.05;
  }, 'jingle');

  S.info = () => ({ state: S.state, next: Math.round(S.next), shows: S.shows, stolen: S.stolen, dist: S.car ? Math.round(Math.hypot(S.car.x - g.player.x, S.car.y - g.player.y)) : -1, type: S.car ? S.car.type : null, sound: !!voice, heard: voice ? +voice.gain.gain.value.toFixed(3) : 0, muffled: voice ? +voice.hid.toFixed(2) : 0, tris: dress ? dress.userData.tris : 0, ms: +S.ms.toFixed(3) });
  S.render = renderJingle; S.begin = begin; S.end = end; S.pick = pick; S.dressOf = () => dress;
  return S;
}

// send a truck now: the nearest step van of the traffic (any van if there is none) becomes the ice-cream truck
export function show(game, kit, S) {
  const pl = game.player; let best = null, bd = 1e9; for (const pass of [0, 1]) { for (const c of game.traffic.cars) { if (c.dead || c.dbl) continue; const t = String(c.type); if (pass === 0 ? t !== 'stepvan' : !/van|truck/.test(t)) continue; const d = Math.hypot(c.x - pl.x, c.y - pl.y); if (d < bd) { bd = d; best = c; } } if (best) break; }
  if (!best) return false; if (S.car) S.end(); S.begin(best); return best;
}
