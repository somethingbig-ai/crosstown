// bodyglass.js (ragdoll lane, Nov 16; Matt: "When someone hits the windshield, I wanna hear the crack of the glass").
// When a struck body (pedhit.js) lands on a car's windscreen: a sharp crack of laminated glass, louder the harder the hit, and a spiderweb
// crack left on that car's windscreen at the place of the hit. The mark is laid on the car's REAL glass where the gun code has read that
// kind of car's surface (combat.carMesh / meshRay); until then on the car's side outline (carshape.js), a few centimetres off at most.
// No assets: the sound is made from the game's own noise buffer, the crack picture is drawn here. ?bodyglass=0 off.
//   install(game) -> { strike(e, S, F, Y, s, nf, ny, speed, part), update() }
//     e: the car (x, y, h, def), S: its carshape, (F, Y, s): the contact in the car's frame (metres ahead of its centre, above the road,
//     to its right), (nf, ny): the outline's outward normal there, speed: closing speed m/s, part: the body point's name.
import * as THREE from 'three';

const MAXC = 10, MINV = 2.6, WEIGHT = { head: 1.15, chest: 1.1, hips: 1, shL: 0.9, shR: 0.9, hpL: 0.8, hpR: 0.8, elL: 0.6, elR: 0.6, knL: 0.6, knR: 0.6 };
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// the windscreen piece of a car's side outline: the first rising piece behind the bonnet (cached on the shape); null if the outline has none
function screenOf(S) {
  if (S._ws !== undefined) return S._ws; let ws = null;
  for (let i = 1; i < S.n - 2; i++) { const dx = S.x[i + 1] - S.x[i], dy = S.y[i + 1] - S.y[i]; if (dx < -0.05 && dy > 0.22 && S.y[i] >= 0.8 && dy / -dx > 0.25 && dy / -dx < 4.5) { ws = { x0: S.x[i], y0: S.y[i], x1: S.x[i + 1], y1: S.y[i + 1] }; break; } }
  return (S._ws = ws);
}

// the spiderweb: a crushed white middle, long radial cracks, rings of short straight cracks between them (laminated glass holds together)
function webTexture(seed) {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const C = N / 2, R = N / 2 - 6, K = 17 + Math.floor(r() * 6), rad = [];
  { const g = x.createRadialGradient(C, C, 0, C, C, R * 0.5); g.addColorStop(0, 'rgba(235,240,242,0.5)'); g.addColorStop(0.22, 'rgba(225,232,235,0.2)'); g.addColorStop(1, 'rgba(225,232,235,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N); }
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (let k = 0; k < K; k++) { const a0 = (k + (r() - 0.5) * 0.7) / K * Math.PI * 2, len = R * (0.55 + 0.45 * r()), pts = []; let a = a0;
    for (let d = R * 0.03; d <= len; d += R * 0.06) { a += (r() - 0.5) * 0.11; pts.push([C + Math.cos(a) * d, C + Math.sin(a) * d, d]); } rad.push({ pts, len });
    for (const [w, al] of [[2.6, 0.22], [1.15, 0.95]]) { for (let i = 1; i < pts.length; i++) { const t = pts[i][2] / len; x.strokeStyle = `rgba(245,248,250,${(al * (1 - 0.75 * t * t)).toFixed(3)})`; x.lineWidth = w * (1 - 0.55 * t); x.beginPath(); x.moveTo(pts[i - 1][0], pts[i - 1][1]); x.lineTo(pts[i][0], pts[i][1]); x.stroke(); } }
    if (r() < 0.45) { const i = 3 + Math.floor(r() * Math.max(1, pts.length - 5)), b = pts[Math.min(i, pts.length - 1)], ba = a0 + (r() < 0.5 ? 1 : -1) * (0.35 + r() * 0.3), bl = R * (0.1 + 0.2 * r()); x.strokeStyle = 'rgba(245,248,250,0.6)'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(b[0] + Math.cos(ba) * bl, b[1] + Math.sin(ba) * bl); x.stroke(); } }
  const at = (q, d) => { const P = q.pts; if (d > q.len) return null; for (let i = 1; i < P.length; i++) if (P[i][2] >= d) { const t = (d - P[i - 1][2]) / (P[i][2] - P[i - 1][2] || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; } return null; };
  for (const [f, pr, al] of [[0.07, 1, 0.95], [0.12, 0.95, 0.9], [0.18, 0.9, 0.85], [0.26, 0.8, 0.75], [0.35, 0.68, 0.65], [0.46, 0.52, 0.55], [0.6, 0.36, 0.45], [0.76, 0.22, 0.35]]) for (let k = 0; k < K; k++) { if (r() > pr) continue; const a = at(rad[k], R * f * (0.9 + 0.2 * r())), b = at(rad[(k + 1) % K], R * f * (0.9 + 0.2 * r())); if (!a || !b) continue; x.strokeStyle = `rgba(245,248,250,${al})`; x.lineWidth = f < 0.2 ? 1.3 : 0.95; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); }
  // the crushed middle: white grit
  for (let i = 0; i < 520; i++) { const d = R * 0.13 * Math.sqrt(r()) * (0.4 + r()), a = r() * 6.283; x.fillStyle = `rgba(250,252,253,${(0.35 + 0.6 * r()).toFixed(2)})`; x.fillRect(C + Math.cos(a) * d, C + Math.sin(a) * d, 1 + r() * 2.2, 1 + r() * 2.2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function install(game) {
  const off = game.P && game.P.get && ['0', 'off'].includes(game.P.get('bodyglass'));
  const G = { on: !off, cracks: [], pending: [], n: 0, sounds: 0, last: null }; if (off) { G.strike = () => false; G.panel = () => false; G.update = () => {}; return G; }
  const scene = game.world.scene; let mats = null;
  const material = () => { if (!mats) mats = [11, 4242, 977].map((sd) => { const t = webTexture(sd); return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color(0.34, 0.36, 0.37), emissiveMap: t, transparent: true, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }); }); return mats[G.n % mats.length]; };
  const alive = (e) => game.vehicles.includes(e) || (game.traffic && game.traffic.cars.includes(e)) || (!!e.def && e.v === undefined && e.vx === undefined);      // a parked slot stays
  const place = (e, out) => { _e.set(e.roll || 0, e.h, e.pitch || 0, 'YZX'); return out.compose(_p.set(e.x, e.z || 0, -e.y), _q.setFromEuler(_e), _one); };

  // ---- the sound: a sharp snap, the crack's body, the crunch of the laminate giving (a run of small ticks), a dull knock of the pane
  const busOf = (a, s) => { if (G._ac !== a) { G._ac = a; const sh = a.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let q = 0; q < n; q++) { const x = (q / (n - 1)) * 2 - 1; c[q] = 0.85 * Math.tanh(1.6 * x) / Math.tanh(1.6); } sh.curve = c; const inb = a.createGain(); inb.gain.value = 0.62; inb.connect(sh); sh.connect(s.out); G._bus = inb; } return G._bus; };
  // ---- a body coming down on steel (ragdoll lane, Nov 17): on an SUV or a van the body lands on the tall bonnet and never reaches the glass, and on any car a body
  // can land on the roof or the boot: until now that made no sound at all after the first thud. A dull, short knock of sheet metal: a low tone that drops, a band of
  // noise round 700 Hz, a faint ring; louder with the speed of the landing, through the same ceiling as the crack. ?bodyglass=0 switches it off with the crack.
  function thunk(k, dist) {
    const s = game.sound; if (!s || !s.on || !s.ac || !s.white) return false; const a = s.ac, t = a.currentTime + 0.004, far = 1 / (1 + dist * dist / 500), v = Math.min(1.1, k) * far; if (v < 0.01) return false; const bus = busOf(a, s);
    const tone = (f0, f1, dur, vol, type) => { const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02); };
    tone(150, 70, 0.13, 0.8 * v, 'sine'); tone(310, 255, 0.07, 0.22 * v, 'triangle'); tone(520 + Math.random() * 90, 470, 0.11, 0.07 * v, 'sine');
    { const n = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(); n.buffer = s.white; fl.type = 'bandpass'; fl.frequency.value = 700; fl.Q.value = 0.9; g.gain.setValueAtTime(0.55 * v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05); n.connect(fl); fl.connect(g); g.connect(bus); n.start(t, Math.random() * 0.5); n.stop(t + 0.07); }
    G.thunks = (G.thunks || 0) + 1; return true;
  }
  // a body point has come down on the top of a car that is not its windscreen (bonnet, roof, boot): the knock, three a car at most in any second and a half
  G.panel = (e, speed, part) => { const wgt = WEIGHT[part]; if (!wgt || speed < 2.2) return false; const now = game.t || 0, st = e._bp || (e._bp = { t: -9, n: 0, t0: -9 }); if (now - st.t < 0.22) return false; if (now - st.t0 > 1.5) { st.t0 = now; st.n = 0; } if (st.n >= 3) return false; st.t = now; st.n++;
    const cam = game.world.camera.position; return thunk(Math.min(1.1, 0.25 + (speed * wgt) / 9), Math.hypot(cam.x - e.x, cam.z + e.y)); };
  function crack(k, dist) {
    const s = game.sound; if (!s || !s.on || !s.ac || !s.white) return false; const a = s.ac, t = a.currentTime + 0.004, far = 1 / (1 + dist * dist / 500), v = Math.min(1.25, k) * far * 0.75; if (v < 0.0075) return false;      /* x 0.75 (Nov 17): rendered to a file, a hard hit beside the camera peaked at 1.26 of full scale and clipped; the game's sound bus has no limiter. Now 0.94 */
    // its own soft ceiling: the layers are noise and their peaks add up differently every time (rendered to a file, one hard hit peaked at 1.26 of full scale, the next at 1.5);
    // the game's sound bus has no limiter, so everything of the crack goes through a rounded clip that never lets more than 0.85 out
    const bus = busOf(a, s);
    const noise = (t0, dur, vol, type, f, q = 0.8) => { const n = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(); n.buffer = s.white; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.setValueAtTime(vol, t + t0); g.gain.exponentialRampToValueAtTime(0.0008, t + t0 + dur); n.connect(fl); fl.connect(g); g.connect(bus); n.start(t + t0, Math.random() * 0.5); n.stop(t + t0 + dur + 0.02); };
    const ping = (t0, f, dur, vol) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, t + t0); o.frequency.exponentialRampToValueAtTime(f * 0.94, t + t0 + dur); g.gain.setValueAtTime(vol, t + t0); g.gain.exponentialRampToValueAtTime(0.0008, t + t0 + dur); o.connect(g); g.connect(bus); o.start(t + t0); o.stop(t + t0 + dur + 0.02); };
    noise(0, 0.012, 1.5 * v, 'highpass', 3200);                                   // the snap
    noise(0, 0.085, 0.95 * v, 'bandpass', 2100, 0.7); noise(0.002, 0.05, 0.6 * v, 'bandpass', 5200, 1.2);      // the crack itself
    { const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.09); g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.11); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.13); }      // the pane knocks
    const ticks = 5 + Math.round(9 * Math.min(1, k)); let tt = 0.018; for (let i = 0; i < ticks; i++) { tt += 0.006 + Math.random() * 0.03 * (1 + i * 0.12); noise(tt, 0.006 + Math.random() * 0.012, (0.5 + Math.random() * 0.4) * v * (1 - i / (ticks + 3)), 'bandpass', 3400 + Math.random() * 4200, 2.5); }      // the crunch
    if (k > 0.55) for (let i = 0; i < 3 + Math.round(4 * Math.min(1, k)); i++) ping(0.03 + Math.random() * 0.28, 4200 + Math.random() * 5200, 0.05 + Math.random() * 0.09, 0.07 * v);      // loose grit
    G.sounds++; return true;
  }

  // ---- the mark: a small sheet laid on the glass, each corner dropped onto the car's real surface where it is known
  function build(P) {
    const e = P.e, cb = game.combat, half = P.size / 2, N = 8; let M = null;
    try { if (cb && cb.carMesh && (!game.P || game.P.get('gcm') !== '0')) M = cb.carMesh(e.def, e); } catch (err) { M = null; }
    if (!M && P.tries++ < 90) return false;      // the surface of this kind of car is being read (a few idle moments): wait up to a second and a half
    // the pane's frame at the hit: n outward, u level (across the car), w up the glass
    let n = new THREE.Vector3(P.nf, P.ny, 0).normalize(), c = new THREE.Vector3(P.F, P.Y - (e.z || 0), P.s), pane = -2;
    const ray = (o, d, tmax) => { const i = cb.meshRay(M, o.x, o.y, o.z, d.x, d.y, d.z, 0, tmax, null); return i < 0 ? null : { i, t: M.t, pane: M.pane[i] }; };
    if (M) { const d = n.clone().negate(), o = c.clone().addScaledVector(n, 0.45); let h = ray(o, d, 1.1); if (!h || h.pane < 0) { /* the outline is a few cm off the model: look a little up and down the glass */ for (const k of [0.12, -0.12, 0.25, -0.25]) { const o2 = o.clone().add(new THREE.Vector3(-n.y, n.x, 0).multiplyScalar(k)); h = ray(o2, d, 1.1); if (h && h.pane >= 0) { o.copy(o2); break; } } }
      if (!h || h.pane < 0) return 'steel';      // what stands there on the drawn car is not glass (a pillar, the roof's edge): no mark
      pane = h.pane; c.copy(o).addScaledVector(d, h.t); const Q = M.panes[pane]; if (Q) { const qn = new THREE.Vector3(Q.n[0], Q.n[1], Q.n[2]); if (qn.dot(n) > 0.5) n.copy(qn); } }
    const u = new THREE.Vector3(0, 0, 1), w = new THREE.Vector3().crossVectors(n, u).normalize(); u.crossVectors(w, n).normalize(); const rot = Math.random() * 6.283, cr = Math.cos(rot), sr = Math.sin(rot);
    const V = (N + 1) * (N + 1), pos = new Float32Array(V * 3), uv = new Float32Array(V * 2), col = new Float32Array(V * 4), ok = new Uint8Array(V), idx = [], d = n.clone().negate(), o = new THREE.Vector3(); let hits = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = j * (N + 1) + i, a = (i / N * 2 - 1) * half, b = (j / N * 2 - 1) * half; o.copy(c).addScaledVector(u, a).addScaledVector(w, b); let lift = 0.005, good = !M;
      if (M) { o.addScaledVector(n, 0.3); const h = ray(o, d, 0.6); if (h && h.pane === pane) { o.addScaledVector(d, h.t); good = true; } else o.addScaledVector(n, -0.3); }
      if (good) hits++; ok[k] = good ? 1 : 0; pos[k * 3] = o.x + n.x * lift; pos[k * 3 + 1] = o.y + n.y * lift; pos[k * 3 + 2] = o.z + n.z * lift;
      const ua = (i / N - 0.5), ub = (j / N - 0.5); uv[k * 2] = 0.5 + ua * cr - ub * sr; uv[k * 2 + 1] = 0.5 + ua * sr + ub * cr; col[k * 4] = col[k * 4 + 1] = col[k * 4 + 2] = 1; col[k * 4 + 3] = good ? 1 : 0; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c2 = a + N + 1, d2 = c2 + 1; if (ok[a] + ok[b] + ok[c2] + ok[d2] >= 3) idx.push(a, c2, b, b, c2, d2); }
    if (!idx.length) return 'steel';
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
    const me = new THREE.Mesh(g, material()); me.matrixAutoUpdate = false; me.frustumCulled = false; me.renderOrder = 4; place(e, me.matrix); me.matrixWorld.copy(me.matrix); scene.add(me);
    G.cracks.push({ me, e, t: game.t || 0, real: !!M, size: P.size, at: [c.x, c.y, c.z] }); G.n++; G.last = { real: !!M, size: +P.size.toFixed(2), type: e.def && e.def.type, at: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], cells: idx.length / 6, speed: +P.speed.toFixed(1), part: P.part };
    while (G.cracks.length > MAXC) drop(G.cracks.shift());
    return true;
  }
  const drop = (c) => { scene.remove(c.me); c.me.geometry.dispose(); };

  // a body point has come down on a car's outline. Returns true when it was the windscreen and hard enough to crack it.
  G.strike = (e, S, F, Y, s, nf, ny, speed, part) => {
    const wgt = WEIGHT[part]; if (!wgt || speed < MINV) return false; const ws = screenOf(S); if (!ws) return false;
    if (F > ws.x0 + 0.06 || F < ws.x1 - 0.06 || Y < ws.y0 - 0.04 || Math.abs(s) > S.W - 0.12 || nf < 0.08) return false;      // on the glass's own piece of the outline, not past the pillars
    const now = game.t || 0, st = e._bg || (e._bg = { t: -9, n: 0 }); if (now - st.t < 0.35 || st.n >= 4) return false; st.t = now; st.n++;
    const k = Math.min(1.25, (speed * wgt - MINV * 0.6) / 9 + 0.3), cam = game.world.camera.position, dist = Math.hypot(cam.x - e.x, cam.z + e.y);
    crack(k, dist);
    G.pending.push({ e, F, Y, s, nf, ny, speed, part, size: Math.min(1.05, 0.42 + 0.5 * k + Math.random() * 0.12), tries: 0 });
    return true;
  };
  G.update = () => {
    for (let i = G.pending.length - 1; i >= 0; i--) { let r = true; try { r = build(G.pending[i]); } catch (err) { if (!G.err) { G.err = String(err && (err.stack || err)); console.log('[bodyglass] ' + G.err); } } if (r) G.pending.splice(i, 1); }
    if (!G.cracks.length) return; const now = game.t || 0, check = ((G.f = (G.f || 0) + 1) & 31) === 0;
    for (let i = G.cracks.length - 1; i >= 0; i--) { const c = G.cracks[i]; if (check && (now - c.t > 240 || !alive(c.e))) { drop(c); G.cracks.splice(i, 1); continue; } place(c.e, c.me.matrix); c.me.matrixWorld.copy(c.me.matrix); }
  };
  return G;
}
