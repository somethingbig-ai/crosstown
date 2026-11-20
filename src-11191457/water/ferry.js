// water/ferry.js (water lane, Nov 15; Matt: "The ferry"): the orange harbour ferry the player can ride and drive, with its slip.
//   The slip is found on the Hudson shore near Pier 79 (W 39th St, where the real Midtown ferries land): a wall with 160 m of clear water square off it.
//   There stand a gantry with the ferry's (parody) name, a ramp to the bow, and two racks of piles the ferry lies between.
//   The ferry keeps a timetable by itself: 50 s at the slip, the horn, astern out of the slip, a loop on the river, back in bow first.
//   The player: F at the ramp while she is in = walk aboard. On the car deck you walk freely (W A S D, Shift) and ride. F on the deck = take the helm
//   (she is then driven like any boat, with a ferry's weight); F at the helm = back to the deck (she takes up her round again).
//   F at the bow end while she is in the slip = step ashore.
// Hooks used from install.js: boat.onBoard / canBoard / auto / label, busy.custom / cam / hud.  ?ferry=0 off.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k, wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const AMBER = '#ffb52e', KN = 1.94384, STAY = 50;

export function installFerry(g, W, api) {
  const { addBoat, stepOne, rideHull, effects, sd, grad, afloat, surf, play, st, city, toMap, NOIN } = api, pl = g.player, world = g.world, P = g.P;
  const _g = { x: 0, y: 0 }, _o = { x: 0, y: 0 };
  // ---- the slip
  function findSlip(x, y, len, beam, range = 320) {
    let best = null;
    for (let dy = -range; dy <= range; dy += 4) for (let dx = -range; dx <= range; dx += 4) { const px = x + dx, py = y + dy, d = sd(px, py); if (d < 0.5 || d > 3.5 || !afloat(px, py)) continue; grad(px, py, _g); const nx = _g.x, ny = _g.y, wx = px - nx * d, wy = py - ny * d;
      let ok = true; for (let r = 5; r <= 170 && ok; r += 7) for (const l of [-beam * 0.75, 0, beam * 0.75]) { const ex = wx + nx * r - ny * l, ey = wy + ny * r + nx * l; if (!afloat(ex, ey) || sd(ex, ey) < Math.min(r * 0.6, 5)) { ok = false; break; } }
      if (!ok) continue; const lx = wx - nx * 3.2, ly = wy - ny * 3.2; if (lx < play[0] + 4 || lx > play[2] - 4 || ly < play[1] + 4 || ly > play[3] - 4 || sd(lx, ly) > -1.5) continue;
      if (st) { st.resolve(lx, ly, 0.34, _o); if (Math.hypot(_o.x - lx, _o.y - ly) > 0.6) continue; }
      // the wall must be straight across the bow: the shore 8 m to either side lies on the same line
      if (Math.abs(sd(wx - ny * 8 + nx * 1.5, wy + nx * 8 + ny * 1.5) - 1.5) > 1.6 || Math.abs(sd(wx + ny * 8 + nx * 1.5, wy - nx * 8 + ny * 1.5) - 1.5) > 1.6) continue;
      const sc = Math.hypot(dx, dy); if (!best || sc < best.sc) best = { sc, wx, wy, nx, ny, lx, ly }; }
    return best;
  }
  const probe = addBoat('ferry', 0, 0, 0), S = probe.spec, T = P.get('ferryat') ? P.get('ferryat').split(',').map(Number) : toMap(40.7603, -74.0036), slip = findSlip(T[0], T[1], S.len, S.beam);
  const b = probe; if (!slip) { world.scene.remove(b.o); world.scene.remove(b.trail.mesh); W.boats.splice(W.boats.indexOf(b), 1); throw new Error('no slip for the ferry near ' + T.map(Math.round)); }
  const n = { x: slip.nx, y: slip.ny }, t = { x: -slip.ny, y: slip.nx }, D = { x: slip.wx + n.x * (S.len / 2 + 0.9), y: slip.wy + n.y * (S.len / 2 + 0.9), h: Math.atan2(-n.y, -n.x) };
  b.x = b.mx = D.x; b.y = b.my = D.y; b.h = b.mh = D.h; b.z = surf(D.x, D.y); b.moored = false; b.label = 'Board the ferry'; b.docked = true; b.driven = false; W.ferry = { b, slip, D };
  // ---- her round: astern to O, a loop on the river, in again
  const O = { x: slip.wx + n.x * 190, y: slip.wy + n.y * 190 }; let loop = null;
  // every leg of the round lies in open water (a pier stands 105 m north of this slip, 240 m long: the round used to be laid straight through it)
  const legsClear = (pts) => { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], q = pts[i], L = Math.hypot(q.x - a.x, q.y - a.y), m = Math.max(1, Math.ceil(L / 12)); for (let j = 0; j <= m; j++) { const x = a.x + (q.x - a.x) * j / m, y = a.y + (q.y - a.y) * j / m; if (!afloat(x, y) || sd(x, y) < 22) return false; } } return true; };
  for (const sgn of [1, -1]) for (const k of [1, 0.7, 0.45]) { if (loop) break; const c = [[450, 240], [700, 520], [300, 760], [-150, 560], [-40, 330]].map(([a, r]) => ({ x: slip.wx + t.x * a * k * sgn + n.x * (120 + r * k), y: slip.wy + t.y * a * k * sgn + n.y * (120 + r * k) })); if (c.every((q) => afloat(q.x, q.y) && sd(q.x, q.y) > 30) && legsClear([O, ...c, { x: slip.wx + n.x * 230, y: slip.wy + n.y * 230 }])) loop = c; }
  if (!loop) loop = []; loop.push({ x: slip.wx + n.x * 230, y: slip.wy + n.y * 230 });
  const A = (b.ferry = { state: 'dock', t: STAY * 0.4, i: 0, horn: false });
  const horn = () => { try { const s = g.sound; if (s && s.on && Math.hypot(b.x - pl.x, b.y - pl.y) < 900) { s.shot(146, 1.7, 'sawtooth', 0.16, 0); s.shot(110, 1.7, 'sawtooth', 0.14, 0); } } catch (e) {} };
  const sail = (tx, ty, sp, dt, rev) => { const want = Math.atan2(ty - b.y, tx - b.x) + (rev ? Math.PI : 0), T = b.tune, v = Math.abs(b.vf); b.wh += (clamp(wrapPi(want - b.h) * 0.5, -T.turn, T.turn) * Math.min(1, v / 2.5) - b.wh) * Math.min(1, dt * 1.0); b.h += b.wh * dt; b.vf += clamp((rev ? -sp : sp) - b.vf, -0.45 * dt, 0.35 * dt); b.vx = Math.cos(b.h) * b.vf; b.vy = Math.sin(b.h) * b.vf; b.x += b.vx * dt; b.y += b.vy * dt; b.thr = rev ? -0.4 : 0.5; b.rud = clamp(b.wh / T.turn, -1, 1); };
  b.auto = (dt) => {
    const dD = Math.hypot(D.x - b.x, D.y - b.y);
    if (A.state === 'dock') { A.t += dt; b.docked = true; b.vf *= Math.max(0, 1 - dt * 2); b.vx = b.vy = 0; b.x += (D.x - b.x) * Math.min(1, dt * 0.8); b.y += (D.y - b.y) * Math.min(1, dt * 0.8); b.h += wrapPi(D.h - b.h) * Math.min(1, dt * 0.8); b.wh = 0; b.thr = 0;
      if (A.t > STAY - 4 && !A.horn) { A.horn = true; horn(); } if (A.t > STAY) { A.state = 'astern'; A.horn = false; b.docked = false; } }
    else if (A.state === 'astern') { b.docked = false; sail(O.x, O.y, 3.6, dt, true); if (Math.hypot(O.x - b.x, O.y - b.y) < 40 || !afloat(b.x - Math.cos(b.h) * S.len * 0.7, b.y - Math.sin(b.h) * S.len * 0.7)) { if (A.again) { A.state = 'in'; A.again = false; } else { A.state = 'run'; A.i = 0; } } }
    else if (A.state === 'run') { const q = loop[A.i];
      // the shore ahead (the player left her nosed at a bank): astern towards the mark for a while, then ahead again
      if (!afloat(b.x + Math.cos(b.h) * S.len * 0.85, b.y + Math.sin(b.h) * S.len * 0.85)) A.back = 7; if (A.back > 0) { A.back -= dt; if (b.vf > 0) b.vf -= Math.min(b.vf, 1.6 * dt); if (!afloat(b.x - Math.cos(b.h) * S.len * 0.8, b.y - Math.sin(b.h) * S.len * 0.8)) A.back = 0; sail(2 * b.x - q.x, 2 * b.y - q.y, 3, dt, true); }      /* astern, swinging the bow to the mark */ else
      sail(q.x, q.y, A.i === loop.length - 1 ? 5 : b.tune.top * 0.9, dt, false); if (Math.hypot(q.x - b.x, q.y - b.y) < 45) { A.i++; if (A.i >= loop.length) { if (Math.abs(wrapPi(D.h - b.h)) < 1.05 || loop.length < 2 || (A.round = (A.round || 0) + 1) > 2) { A.state = 'in'; A.round = 0; A.tries = 0; } else A.i = loop.length - 2; } } }      /* at the mark off the slip but not pointing in: out to the mark before it and back */
    else { // in: bow first, slower and slower, onto the line of the slip
      const along = (b.x - slip.wx) * n.x + (b.y - slip.wy) * n.y - S.len / 2, aim = Math.max(0, along * 0.45), tx = D.x - n.x * (S.len / 2) + n.x * aim, ty = D.y - n.y * (S.len / 2) + n.y * aim; sail(tx, ty, clamp(along * 0.07 + 0.25, 0.25, 5), dt, false);
      // between the pile racks she must be on the line: if she is not, astern out and in again (twice at most)
      const offL = (b.x - slip.wx) * t.x + (b.y - slip.wy) * t.y; if (along < 42 && along > 6 && (Math.abs(offL) > 1.6 || Math.abs(wrapPi(D.h - b.h)) > 0.2) && (A.tries || 0) < 2) { A.tries = (A.tries || 0) + 1; A.state = 'astern'; A.again = true; }
      else if (along < 1.2 || dD < 1.5) { A.state = 'dock'; A.t = 0; A.tries = 0; b.docked = true; horn(); } }
    rideHull(b, dt); effects(b, dt);
  };
  b.canBoard = () => b.docked && A.state === 'dock' && A.t < STAY - 1;
  // ---- the slip's furniture: gantry, name board, ramp, pile racks
  try { const grp = new THREE.Group(); grp.name = 'ferry_slip'; const V = (x, y, h) => new THREE.Vector3(x, h, -y), steel = new THREE.MeshStandardMaterial({ color: 0x3c4a43, roughness: 0.6, metalness: 0.3 }), yaw = Math.atan2(-t.y, t.x) * -1;
    const box = (w, h, d, x, y, z, mat, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(V(x, y, z)); m.rotation.y = ry === undefined ? Math.atan2(t.y, t.x) : ry; m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
    const half = S.beam / 2 + 2.2, bx = slip.wx - n.x * 1.6, by = slip.wy - n.y * 1.6;
    for (const sg of [-1, 1]) { box(1.1, 13, 1.1, bx + t.x * half * sg, by + t.y * half * sg, 6.5, steel); box(0.5, 0.5, 9, bx + t.x * half * sg + n.x * 2, by + t.y * half * sg + n.y * 2, 11.2, steel, Math.atan2(n.y, n.x) + Math.PI / 2); }
    box(half * 2 + 1.1, 1.0, 1.0, bx, by, 12.6, steel);
    // the name board, readable from the street and from the water
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const c = cv.getContext('2d'); c.fillStyle = '#d8641c'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#f4efe2'; c.font = '700 78px "Helvetica Neue", Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(S.name || 'FERRY').toUpperCase(), 512, 68, 980);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; const sm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    for (const sg of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 0.4, (half * 2 - 0.4) / 8), sm); m.position.copy(V(bx + n.x * 0.56 * sg, by + n.y * 0.56 * sg, 10.6)); m.lookAt(V(bx + n.x * 50 * sg, by + n.y * 50 * sg, 10.6)); grp.add(m); }
    // the ramp from the street to the bow's apron
    { const deckY = W.level + (S.decks && S.decks[0] ? S.decks[0].y : 2.4), L = 7.5, m = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.22, L), new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.85 })); const cx = slip.wx - n.x * (L / 2 - 2.2), cy = slip.wy - n.y * (L / 2 - 2.2); m.position.copy(V(cx, cy, (0.16 + deckY) / 2)); m.lookAt(V(cx + n.x * 10, cy + n.y * 10, (0.16 + deckY) / 2 + (deckY - 0.16) * 10 / L)); m.receiveShadow = true; grp.add(m); }
    // racks of piles either side
    { const pg = new THREE.CylinderGeometry(0.24, 0.27, 6.4, 8), pm = new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 0.95 }), N = 2 * 17, im = new THREE.InstancedMesh(pg, pm, N), M = new THREE.Matrix4(); let k = 0;
      for (const sg of [-1, 1]) for (let j = 0; j < 17; j++) { const r = 3 + j * 2.6, l = (S.beam / 2 + 1.5 + Math.max(0, j - 11) * 0.7) * sg; M.makeTranslation(slip.wx + n.x * r + t.x * l, W.level + 0.5 + ((j * 7 + (sg > 0 ? 3 : 0)) % 5) * 0.09, -(slip.wy + n.y * r + t.y * l)); im.setMatrixAt(k++, M); if (W.solids) { W.solids.push({ x: slip.wx + n.x * r + t.x * l, y: slip.wy + n.y * r + t.y * l, r: 0.32, pile: true });
          /* and the rack between this pile and the next is closed (a boat's bow is narrower than the 2.6 m between two piles and went through) */ if (j < 16) { const r2 = r + 2.6, l2 = (S.beam / 2 + 1.5 + Math.max(0, j + 1 - 11) * 0.7) * sg; for (const u of [0.25, 0.5, 0.75]) W.solids.push({ x: slip.wx + n.x * (r + (r2 - r) * u) + t.x * (l + (l2 - l) * u), y: slip.wy + n.y * (r + (r2 - r) * u) + t.y * (l + (l2 - l) * u), r: 0.3 }); } } } im.castShadow = true; im.name = 'ferry_piles'; grp.add(im); }
    world.scene.add(grp); W.ferry.group = grp; } catch (e) { W.err('ferry slip', e); }

  // ---- the player aboard
  const decks = (S.decks || []).filter((d) => Math.abs(d.y - (S.decks[0] ? S.decks[0].y : 2.4)) < 0.05), blocks = S.blocks || [], deckY = S.decks && S.decks[0] ? S.decks[0].y : 2.4;
  // on the deck: the point and four points 0.35 m round it lie on some deck rectangle (each rectangle shrunk by itself left a strip between the bow apron and the car deck that nobody could cross)
  const inDeck = (x, z) => decks.some((d) => x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1);
  const onDeck = (x, z) => inDeck(x, z) && inDeck(x + 0.35, z) && inDeck(x - 0.35, z) && inDeck(x, z + 0.35) && inDeck(x, z - 0.35) && !blocks.some((k) => x > k.x0 - 0.4 && x < k.x1 + 0.4 && z > k.z0 - 0.4 && z < k.z1 + 0.4);
  const local = (B) => { const c = Math.cos(b.h), s = Math.sin(b.h); pl.x = b.x + c * B.lx + s * B.lz; pl.y = b.y + s * B.lx - c * B.lz; B.z = b.z + deckY + B.lx * Math.sin(b.pitch) - B.lz * Math.sin(b.roll); };
  const bowEnd = Math.max(...decks.map((d) => d.x1)) - 0.5;
  function custom(dt, B) {
    const I = g.input; B.t += dt;
    if (B.kind === 'hop') { const k = Math.min(1, B.t / B.dur), e = k * k * (3 - 2 * k), c = Math.cos(b.h), s = Math.sin(b.h), tx = b.x + c * B.lx + s * B.lz, ty = b.y + s * B.lx - c * B.lz; pl.x = lerp(B.x0, tx, e); pl.y = lerp(B.y0, ty, e); B.z = lerp(B.z0, b.z + deckY, e); pl.h += wrapPi(b.h + Math.PI - pl.h) * Math.min(1, dt * 6); g.playerAnim('walk'); if (k >= 1) B.kind = 'deck'; return; }
    if (B.kind === 'off') { const k = Math.min(1, B.t / B.dur), e = k * k * (3 - 2 * k); pl.x = lerp(B.x0, slip.lx, e); pl.y = lerp(B.y0, slip.ly, e); B.z = lerp(B.z0, 0, e); g.playerAnim('walk'); if (k >= 1) { pl.busy = null; W.mine = null; W.on = false; g.cam.mode = 'foot'; g.playerAnim('idle'); if (st) { st.resolve(pl.x, pl.y, 0.34, _o); pl.x = _o.x; pl.y = _o.y; } } return; }
    if (B.kind === 'helm') { stepOne(b, dt, I); pl.x = b.x; pl.y = b.y; pl.h = b.h; B.z = b.z + b.spec.helm[1]; W.hintT += dt;
      if (I.use) { I.use = false; b.driven = false; B.kind = 'deck'; B.lx = Math.min(bowEnd - 6, 14); B.lz = 4; { const al = (b.x - slip.wx) * n.x + (b.y - slip.wy) * n.y - S.len / 2, la = Math.abs((b.x - slip.wx) * t.x + (b.y - slip.wy) * t.y); const fair = la < Math.max(6, al * 0.4) && Math.abs(wrapPi(D.h - b.h)) < 0.9; A.state = fair && al > 30 ? 'in' : fair ? 'astern' : 'run'; A.i = loop.length - 1; A.back = 0; }      /* lying off the slip and pointing in: straight in; anywhere else: to the mark off the slip first */ g.playerAnim('idle'); } return; }
    // on the deck: walk as on the street, in the ferry's own frame
    const m = Math.hypot(I.mx, I.my); let sp = 0;
    if (m > 0.1) { const a = g.cam.yaw + Math.atan2(I.mx, I.my); sp = (I.run ? 5.4 : 1.9) * Math.min(1, m); pl.h += wrapPi(a - pl.h) * Math.min(1, dt * 10); const dx = Math.cos(pl.h - b.h) * sp * dt, dz = -Math.sin(pl.h - b.h) * sp * dt;
      if (onDeck(B.lx + dx, B.lz + dz)) { B.lx += dx; B.lz += dz; } else if (onDeck(B.lx + dx, B.lz)) B.lx += dx; else if (onDeck(B.lx, B.lz + dz)) B.lz += dz; }
    else pl.h += b.wh * dt;
    const vis = pl.vis, wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0] || { name: 'walk', speed: 1.45 }; pl.speed = sp; g.playerAnim(sp > 3 ? 'run' : sp > 0.2 ? wk.name : 'idle'); if (vis.mixer) vis.mixer.timeScale = sp > 3 ? sp / (vis.runSpeed || 5.0) : sp > 0.2 ? sp / wk.speed : 1;
    local(B);
    if (I.use) { I.use = false; if (b.docked && B.lx > bowEnd - 7) { W.stats.offs++; B.kind = 'off'; B.t = 0; B.dur = 1.1; B.x0 = pl.x; B.y0 = pl.y; B.z0 = B.z; } else { B.kind = 'helm'; b.driven = true; b.docked = false; b.fresh = true; b.vz = 0; b.wp = b.wr = 0; W.hintT = 0; g.playerAnim('idle'); } }
  }
  const cam = () => { const B = pl.busy; if (B.kind === 'helm') { const sp = Math.hypot(b.vx, b.vy); return { x: b.x, y: b.y, z: b.z + 9, dist: 62 + sp * 1.2, height: 13, fov: 56, yaw: b.h - b.wh * 0.6, auto: 1.6 }; } return { x: pl.x, y: pl.y, z: B.z + 1.5, dist: 3.6, height: 0.35, fov: 54, yaw: pl.h, auto: pl.speed > 0.3 ? 1.2 : 0 }; };
  const hud = (H) => { const B = pl.busy, Wd = H.w / (H.k || 1), Hh = 1080, key = g.menu ? g.menu.keyName('KeyF') : 'F'; if (B.kind === 'helm') { H.panel(Wd / 2 - 330, Hh - 106, 660, 40, 6); H.text(S.name + '   ·   ' + key + '  leave the helm', Wd / 2, Hh - 79, 15, '#fff', 'center', 600, 1); return true; }
    if (B.kind !== 'deck') return false; const off = b.docked && B.lx > bowEnd - 7; H.panel(Wd / 2 - 150, Hh * 0.62, 300, 44, 22); H.text(key, Wd / 2 - 116, Hh * 0.62 + 30, 20, AMBER, 'center', 800); H.text(off ? 'Step ashore' : 'Take the helm', Wd / 2 + 14, Hh * 0.62 + 29, 17, '#fff', 'center', 600);
    const msg = A.state === 'dock' ? 'Leaving in ' + Math.max(0, Math.ceil(STAY - A.t)) + ' s' : A.state === 'in' ? 'Coming in to the slip' : S.name + '  ·  ' + Math.round(Math.abs(b.vf) * KN) + ' knots'; H.panel(36, Hh - 126, 232, 44); /* above the game's street box, which names the river out here */ H.text(msg.toUpperCase(), 58, Hh - 98, 13, 'rgba(255,255,255,0.85)', 'left', 600, 1.5); return false; };
  b.onBoard = () => { W.mine = b; W.on = true; W.stats.boards++; const side = ((pl.x - b.x) * Math.sin(b.h) - (pl.y - b.y) * Math.cos(b.h)) > 0 ? 1 : -1;
    pl.busy = { boat: true, ferry: true, kind: 'hop', t: 0, dur: 1.2, b, custom, cam, hud, x0: pl.x, y0: pl.y, h0: pl.h, z0: st && st.onSidewalk(pl.x, pl.y) ? 0.15 : 0, z: 0, lx: bowEnd - 2.5, lz: clamp(side * 1.5, -2.5, 2.5) }; g.cam.mode = 'boat'; };
  if (P.get('aboard') === 'ferry') { pl.x = slip.lx; pl.y = slip.ly; A.t = 0; b.onBoard(); }
  console.log('[water] ferry "' + S.name + '" at its slip ' + Math.round(slip.wx) + ', ' + Math.round(slip.wy) + ' (' + Math.round(slip.sc) + ' m from the asked place), round of ' + loop.length + ' marks');
  W.ferry.loop = loop; W.ferry.custom = custom;      // for the tools (tools/fin-ferrysim.mjs gives the helm back through custom)
  return W.ferry;
}
