// finds.js: THINGS TO FIND ON THE MAP (gameplay lane, Nov 18; player feedback Matt forwarded: "Hidden things to find on the map (helicopters,
// special cars, weapons), marked for discovery", "no way to get ammo back once it's spent", "the helicopter ... no clear way to reach it").
// Hook: ONE line at the end of Game.init (game.js) and two lines in citymap2.js (the map pins). Off: ?finds=0 (this file is not fetched).
// The places are data: finds-data.js, per map (made and checked by lanes/gameplay/finds/tools/place.mjs). What there is:
//   ammo   an olive crate with a soft amber ring and a faint beam. WALK OVER it on foot: the gun in hand is filled (magazine and spare rounds),
//          every other gun gets two magazines of spare rounds (never above its starting load), "+N CARBINE" and the reload click. The place
//          refills after REFILL seconds. A crate that could give nothing (everything full) is left where it is.
//   gun    a dark gun case (SMG or pump shotgun): that gun is filled and put in his hand. (All four guns are carried from the start, so a case
//          gives rounds and the draw, not a new gun.)
//   rifle  the sniper rifle cases that heli/perch.js already puts on the marked roofs: listed and pinned here, nothing new is built for them.
//   car    a special vehicle at the kerb, taken with F as any parked car: an EXISTING kerb parking place near the listed point is re-cast
//          (the nearest within 45 m: the running game lays the kerb places out by its own rules; so it stands where a car can stand); for the bus and the fire engine the places on either side are emptied.
//   heli   the helicopter, which heli.js has always parked on the park lawn by the start: pinned on both maps from the first second, wherever it
//          stands (the pin follows it after a flight; held on the minimap's rim when out of view).
// DISCOVERY: a find is unknown until he comes within SEE metres (on foot, at the wheel or in the air); then a toast, a note in the sound, and its
// icon on the minimap and the Tab map; "FOUND n / N" in the Tab map's legend. Kept per map in localStorage ('crosstown.finds.<map>', the pattern
// of menu/settings.js); ?findsave=0 keeps nothing, ?findsreset=1 forgets. AFTER A DEATH: every gun is given a full magazine and at least half
// its starting spare rounds (combat's respawn itself takes and gives nothing).
// Cost: one distance pass over the list four times a second; only crates within SHOW metres are in the scene (three small meshes each).
import * as THREE from 'three';
import { WEAPONS } from './combat/combat.js';
import { FINDS } from './finds-data.js';
const SEE = 60, SHOW = 170, REACH = 1.25, COL = { ammo: '#8fe05a', gun: '#ffd84a', rifle: '#ffd84a', car: '#ff8fd8', heli: '#ffffff' };
const LABEL = { ammo: 'AMMO BOX', gun: 'GUN CASE', rifle: 'SNIPER RIFLE', car: 'SPECIAL VEHICLE', heli: 'HELICOPTER' };
export function install(g) {
  if (g.__finds) return g.__finds;
  const P = g.P, city = (P && P.get('city')) || (window.__CFG && window.__CFG.city) || 'city.json';
  const REFILL = +(P && P.get('findsrefill')) || 180;     // ?findsrefill=N: seconds until a taken crate is back (for tests)
  const map = /(^|\/)city\.json$/.test(city) ? 'default' : (/city-([a-z0-9]+)\.json/.exec(city) || [0, city])[1], KEY = 'crosstown.finds.' + map, save = !(P && P.get('findsave') === '0');
  const S = (g.__finds = { on: true, map, list: [], found: new Set(), toast: null, gain: null, stats: { picked: 0, restock: 0, cast: 0 }, t: 0 });
  for (const r of FINDS[map] || []) S.list.push(Object.assign({ z: 0.15, known: false, takenT: -1e9 }, r));
  S.list.push({ id: 'heli', k: 'heli', x: 0, y: 0, z: 0, n: 'the helicopter', known: false, live: true });
  if (P && P.get('findsreset') === '1') try { localStorage.removeItem(KEY); } catch (e) {}
  if (save) try { for (const id of JSON.parse(localStorage.getItem(KEY) || '[]')) S.found.add(id); } catch (e) {}
  const store = () => { if (save) try { localStorage.setItem(KEY, JSON.stringify([...S.found])); } catch (e) {} };
  const count = () => { let n = 0, N = 0; for (const f of S.list) if (!f.off) { N++; if (f.known) n++; } return [n, N]; };
  S.count = count;
  // ---- the crates
  const lam = (c, e = 0.1) => new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(e) }), glowM = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const GEO = { box: new THREE.BoxGeometry(1, 1, 1), ring: new THREE.RingGeometry(0.62, 0.86, 40), beam: new THREE.CylinderGeometry(0.035, 0.11, 3.4, 10, 1, true) }; GEO.ring.rotateX(-Math.PI / 2);
  const MAT = { olive: lam(0x56633a), dark: lam(0x2c3038), lid: lam(0x414c2b), band: lam(0xe8c33a, 0.35), steel: lam(0x8c9198), ringA: glowM(0xffb347, 0.5), beamA: glowM(0xffc56b, 0.16), ringG: glowM(0x9fd8ff, 0.5), beamG: glowM(0xbfe4ff, 0.16) };
  const part = (grp, m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); grp.add(o); return o; };
  function build(f) {
    const G = new THREE.Group(), gun = f.k === 'gun', B = new THREE.Group(); G.add(B);
    if (gun) { part(B, MAT.dark, 1.02, 0.2, 0.36, 0, 0.1, 0); part(B, MAT.band, 1.03, 0.035, 0.37, 0, 0.13, 0); for (const s of [-0.3, 0.3]) part(B, MAT.steel, 0.07, 0.05, 0.03, s, 0.1, 0.19); part(B, MAT.steel, 0.2, 0.03, 0.05, 0, 0.215, 0); }
    else { part(B, MAT.olive, 0.62, 0.3, 0.4, 0, 0.15, 0); part(B, MAT.lid, 0.64, 0.06, 0.42, 0, 0.33, 0); for (const s of [-0.19, 0.19]) part(B, MAT.band, 0.05, 0.305, 0.405, s, 0.15, 0); part(B, MAT.steel, 0.22, 0.03, 0.05, 0, 0.375, 0); for (const s of [-0.32, 0.32]) part(B, MAT.steel, 0.02, 0.05, 0.16, s, 0.24, 0); }
    B.rotation.y = ((f.x * 7 + f.y * 13) % 6.283); f.ring = new THREE.Mesh(GEO.ring, gun ? MAT.ringG : MAT.ringA); f.ring.position.y = 0.03; G.add(f.ring);
    f.beam = new THREE.Mesh(GEO.beam, gun ? MAT.beamG : MAT.beamA); f.beam.position.y = 2.0; G.add(f.beam);
    G.position.set(f.x, f.z, -f.y); G.visible = false; (g.world.scene || g.scene).add(G); f.G = G; f.B = B;
  }
  // the helicopter's marker: a tall faint beam and a ring on the lawn until he has flown it once, and "HELICOPTER 140 m" for the first minute of a load
  let HM = null; const heliMark = (hl, d) => { const want = !S.found.has('_flown') && !hl.piloted && d < 420; if (want && !HM) { HM = new THREE.Group(); const r = new THREE.Mesh(GEO.ring, MAT.ringG); r.scale.setScalar(7); r.position.y = 0.06; const b = new THREE.Mesh(GEO.beam, MAT.beamG); b.scale.set(5, 9, 5); b.position.y = 20; HM.add(r, b); (g.world.scene || g.scene).add(HM); } if (HM) { HM.visible = want; if (want) HM.position.set(hl.f.pos.x, Math.max(0, hl.f.pos.y - 1.2), hl.f.pos.z); } };
  const ground = (x, y) => { try { const H = g.heli && g.heli.heights; if (H) { const z = H.top(x, y, 1.2); if (z >= -0.5 && z < 0.6) return z; } } catch (e) {} return 0.15; };
  // ---- the specials: an existing kerb place re-cast
  function cast(f) {
    const PK = g.parked, kit = g.kit && g.kit.cars; if (!PK || !kit) return false;
    if (f.t === 'moto' && !g.moto) { if (S.t > 20) f.off = true; return false; }
    const def = f.t === 'moto' ? null : kit[f.t]; if (f.t !== 'moto' && !def) { f.off = true; console.log('[finds] no model for ' + f.t + ': ' + f.id + ' left out'); return true; }
    let s = null, bd = 45; for (const q of PK.slots) { if (q.gone || q.type === 'moto' || q.__find) continue; const d = Math.hypot(q.x - f.x, q.y - f.y); if (d < bd) { bd = d; s = q; } }
    if (!s) { f.off = true; console.log('[finds] no kerb place at ' + f.x + ',' + f.y + ': ' + f.id + ' left out'); return true; }
    const ch = Math.cos(s.h), sh = Math.sin(s.h), len = def ? def.len : 2.2, wid = def ? def.wid : 0.8;
    if (len > 5.6) for (const q of PK.slots) { if (q === s || q.gone) continue; const dx = q.x - s.x, dy = q.y - s.y; if (Math.abs(dx * ch + dy * sh) < len / 2 + (q.def ? q.def.len : 4.6) / 2 + 0.5 && Math.abs(dy * ch - dx * sh) < wid / 2 + 1.2) PK.take(q); }
    if (f.t === 'moto') { PK.take(s); f.slot = g.moto.spawn(s.x, s.y, s.h, f.c || 0x1c1c1c); }
    else { s.type = def.type || f.t; s.def = def; if (f.c) s.color = f.c; s._vv = null; s.__find = f.id; f.slot = s;
      if (len > 5.6 && g.statics && g.statics.addCircle) for (const o of [-(len / 2 - wid / 2), len / 2 - wid / 2]) s.circles.push(g.statics.addCircle(s.x + ch * o, s.y + sh * o, wid / 2, s)); }
    f.x = s.x; f.y = s.y; f.cast = true; S.stats.cast++; return true;
  }
  // ---- rounds
  const C = () => g.combat, fill = (k) => { const am = C().ammo[k], W = WEAPONS[k]; if (!am || !W) return 0; const n = W.mag - am.mag + Math.max(0, W.reserve - am.reserve); am.mag = W.mag; am.reserve = Math.max(am.reserve, W.reserve); return n; };
  function give(f) {
    const c = C(); if (!c || !c.ammo) return false; let n = 0, name = 'ROUNDS';
    if (f.k === 'gun') { n = fill(f.t); name = WEAPONS[f.t].name; if (c.slot !== f.t) { try { c.equip(f.t); } catch (e) {} n = Math.max(n, 1); } }
    else { const cur = WEAPONS[c.slot] ? c.slot : null; let rest = 0; if (cur) { n = fill(cur); name = WEAPONS[cur].name; }
      for (const k in c.ammo) { const W = WEAPONS[k], am = c.ammo[k]; if (k === cur || !W || !am || !W.reserve) continue; const add = Math.min(2 * W.mag, Math.max(0, W.reserve - am.reserve)); am.reserve += add; rest += add; }
      if (!cur) { n = rest; name = 'ROUNDS'; } else if (!n && rest) { n = rest; name = 'SPARE ROUNDS'; } }
    if (n <= 0) return false;
    f.takenT = S.t; S.gain = { text: '+' + n + ' ' + name, t: 0 }; S.stats.picked++; S.last = { id: f.id, n, name };
    try { if (c.snd && WEAPONS[c.slot]) c.snd('reload', c.slot, 'in'); } catch (e) {} try { g.sound.shot(988, 0.07); g.sound.shot(1318, 0.1, 'sine', 0.16); } catch (e) {}
    return true;
  }
  function restock() { const c = C(); if (!c || !c.ammo) return; for (const k in c.ammo) { const W = WEAPONS[k], am = c.ammo[k]; if (!W || !am) continue; am.mag = W.mag; am.reserve = Math.max(am.reserve, Math.floor(W.reserve / 2)); } S.stats.restock++; S.toast = { text: 'RESTOCKED', sub: 'Full magazines, half the spare rounds', t: 0, col: COL.ammo }; }
  // ---- the step
  let tick = 0, roofs = false, wasDead = false;
  function slow() {
    const pl = g.player, hl = g.heli;
    if (!roofs && hl && hl.perch && hl.pads && hl.pads.length > 1) { roofs = true; hl.pads.forEach((p, i) => { if (p.roof && !p.esb) S.list.push({ id: 'r' + i, k: 'rifle', x: p.x, y: p.y, z: p.z || 0, n: 'on the roof of ' + p.name, known: S.found.has('r' + i) }); }); }
    for (const f of S.list) {
      if (f.off) continue;
      if (f.k === 'heli') { if (!hl || !hl.f) { f.off = true; continue; } f.x = hl.f.pos.x; f.y = -hl.f.pos.z; f.hide = !!hl.piloted; f.d = Math.hypot(f.x - pl.x, f.y - pl.y); f.alt = hl.f.pos.y; if (hl.piloted && !S.found.has('_flown')) { S.found.add('_flown'); store(); } heliMark(hl, f.d); }
      const d = Math.hypot(f.x - pl.x, f.y - pl.y);
      if (f.k === 'car') { if (!f.cast && d < 220) cast(f); if (f.cast) f.hide = !!(f.slot && f.slot.gone); }
      if (!f.known && S.found.has(f.id)) f.known = true;
      if (!f.known && d < SEE && !(f.k === 'car' && !f.cast) && !f.off) { f.known = true; S.found.add(f.id); store(); const [n, N] = count(); S.toast = { text: 'FOUND: ' + LABEL[f.k], sub: (f.n ? f.n.charAt(0).toUpperCase() + f.n.slice(1) + '  ·  ' : '') + n + ' of ' + N + ' found', t: 0, col: COL[f.k] }; try { g.sound.blip(); } catch (e) {} }
      if (f.k === 'ammo' || f.k === 'gun') { const want = d < SHOW && S.t - f.takenT > REFILL; if (want && !f.G) { f.z = ground(f.x, f.y); build(f); } if (f.G) f.G.visible = want; f.d = d; }
    }
  }
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    step0(dt); if (g.paused) return; S.t += dt;
    try {
      if ((tick -= dt) <= 0) { tick = 0.25; slow(); }
      const pl = g.player, c = C(), foot = !pl.vehicle && !pl.busy && !(g.heli && g.heli.piloted) && !((pl.alt || 0) > 1.6);
      for (const f of S.list) { if (!f.G || !f.G.visible) continue; const d = Math.hypot(f.x - pl.x, f.y - pl.y);
        const pu = 0.5 + 0.5 * Math.sin(S.t * 2.6 + f.x); f.ring.scale.setScalar(0.9 + 0.16 * pu);
        if (foot && d < REACH && !(c && c.dead) && give(f)) f.G.visible = false; }
      if (c) { const dead = !!c.dead; if (wasDead && !dead) restock(); wasDead = dead; }
      if (S.toast && (S.toast.t += dt) > 4) S.toast = null; if (S.gain && (S.gain.t += dt) > 1.8) S.gain = null;
      const cm = g.hud && g.hud.cmap; if (cm && !cm.finds) cm.finds = MAPS;
    } catch (e) { if (!S.err) { S.err = String(e && (e.stack || e.message)); console.log('[finds] step: ' + S.err); } }
  };
  // ---- the HUD: the toast, the "+N" line, a name over a near crate
  const _v = new THREE.Vector3();
  if (g.hud && g.hud.draw) { const draw0 = g.hud.draw.bind(g.hud); g.hud.draw = function () { draw0(); try { hudDraw(this); } catch (e) { if (!S.herr) { S.herr = String(e && e.message); console.log('[finds] hud: ' + S.herr); } } }; }
  function hudDraw(hud) {
    const c = hud.ctx, k = hud.k, W = hud.w / k, H = 1080; if (g.demo || (hud.cmap && hud.cmap.full)) return;
    c.save(); c.setTransform(k, 0, 0, k, 0, 0);
    for (const f of S.list) { if (!f.G || !f.G.visible || !(f.d > 3 && f.d < 32)) continue; _v.set(f.x, f.z + 1.15, -f.y).project(g.world.camera); if (_v.z >= 1 || Math.abs(_v.x) > 0.96 || Math.abs(_v.y) > 0.9) continue;
      const sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H; c.globalAlpha = Math.min(1, (32 - f.d) / 6); hud.text((f.k === 'gun' ? WEAPONS[f.t].name : 'AMMO') + '  ' + Math.round(f.d) + ' m', sx, sy, 16, COL[f.k], 'center', 800, 1); c.globalAlpha = 1; }
    if (S.gain) { const t = S.gain.t; c.globalAlpha = Math.min(1, (1.8 - t) * 2.5); hud.text(S.gain.text, W / 2, H * 0.56 - t * 26, 30, COL.ammo, 'center', 800, 2); c.globalAlpha = 1; }
    const hf = S.list.find((q) => q.k === 'heli'); if (hf && !hf.off && !hf.hide && !S.found.has('_flown') && S.t < 75 && hf.d > 12 && !S.toast && !g.player.vehicle) { const a = Math.min(1, S.t * 2, (75 - S.t) / 3), tx = 'HELICOPTER  ' + Math.round(hf.d) + ' m'; c.globalAlpha = a;
      _v.set(hf.x, (hf.alt || 0) + 4.5, -hf.y).project(g.world.camera); const on = _v.z < 1 && Math.abs(_v.x) < 0.9 && Math.abs(_v.y) < 0.82;
      if (on) { const sx = (_v.x * 0.5 + 0.5) * W, sy = (-_v.y * 0.5 + 0.5) * H; icon(c, sx, sy - 26, 13, 'heli'); hud.text(tx, sx, sy, 15, COL.heli, 'center', 800, 1.5); }
      else { hud.panel(W / 2 - 190, 128, 380, 46, 10); icon(c, W / 2 - 160, 151, 13, 'heli'); hud.text(tx + '  ·  on your map', W / 2 - 134, 157, 16, COL.heli, 'left', 800, 1.5); } c.globalAlpha = 1; }
    if (S.toast) { const T = S.toast, a = Math.max(0, Math.min(1, T.t * 5, (4 - T.t) * 2)); c.globalAlpha = a; hud.panel(W / 2 - 250, 128, 500, 66, 10); icon(c, W / 2 - 214, 161, 15, T.col === COL.heli ? 'heli' : T.col === COL.car ? 'car' : T.col === COL.gun ? 'gun' : 'ammo'); hud.text(T.text, W / 2 - 184, 156, 19, T.col, 'left', 800, 2); hud.text(T.sub, W / 2 - 184, 179, 14, 'rgba(255,255,255,0.85)', 'left', 600, 0.5); c.globalAlpha = 1; }
    c.restore();
  }
  // ---- the maps (citymap2.js calls these from drawMini and drawFull)
  function icon(c, x, y, r, kind) {
    const col = COL[kind] || '#fff', u = r / 9; c.save(); c.translate(x, y); c.fillStyle = '#14161a'; c.strokeStyle = col; c.lineWidth = 1.8 * u; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.stroke(); c.fillStyle = col; c.lineCap = 'round';
    if (kind === 'ammo') for (const dx of [-3.4, 0, 3.4]) { c.beginPath(); c.arc(dx * u, -2.2 * u, 1.25 * u, Math.PI, 0); c.lineTo((dx + 1.25) * u, 4.4 * u); c.lineTo((dx - 1.25) * u, 4.4 * u); c.closePath(); c.fill(); }
    else if (kind === 'heli') { c.lineWidth = 1.5 * u; c.beginPath(); c.moveTo(-6 * u, -3.6 * u); c.lineTo(6 * u, -3.6 * u); c.moveTo(0, -3.6 * u); c.lineTo(0, -1.5 * u); c.stroke(); c.beginPath(); c.ellipse(-0.8 * u, 1.2 * u, 3.6 * u, 2.5 * u, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(2 * u, 0.6 * u); c.lineTo(6.2 * u, -0.6 * u); c.lineTo(6.2 * u, 0.8 * u); c.lineTo(2 * u, 2.2 * u); c.closePath(); c.fill(); }
    else if (kind === 'car') { c.beginPath(); c.roundRect ? c.roundRect(-5.6 * u, -0.6 * u, 11.2 * u, 3.4 * u, 1.2 * u) : c.rect(-5.6 * u, -0.6 * u, 11.2 * u, 3.4 * u); c.fill(); c.beginPath(); c.moveTo(-3.4 * u, -0.4 * u); c.lineTo(-1.8 * u, -3.6 * u); c.lineTo(2.2 * u, -3.6 * u); c.lineTo(3.8 * u, -0.4 * u); c.closePath(); c.fill(); c.fillStyle = '#14161a'; for (const dx of [-3.2, 3.2]) { c.beginPath(); c.arc(dx * u, 2.9 * u, 1.5 * u, 0, 7); c.fill(); } }
    else { c.lineWidth = 1.5 * u; c.beginPath(); c.arc(0, 0, 3.6 * u, 0, 7); c.moveTo(-6 * u, 0); c.lineTo(-1.6 * u, 0); c.moveTo(1.6 * u, 0); c.lineTo(6 * u, 0); c.moveTo(0, -6 * u); c.lineTo(0, -1.6 * u); c.moveTo(0, 1.6 * u); c.lineTo(0, 6 * u); c.stroke(); }
    c.restore();
  }
  const shown = (f) => !f.off && !f.hide && (f.known || f.k === 'heli'), kind = (f) => (f.k === 'rifle' ? 'gun' : f.k);
  const MAPS = {
    mini(c, scr, cx, cy, R) { for (const f of S.list) { if (!shown(f)) continue; let [mx, my] = scr(f.x, f.y); mx -= cx; my -= cy; const d = Math.hypot(mx, my); if (d > R - 12) { if (f.k !== 'heli') continue; mx *= (R - 12) / d; my *= (R - 12) / d; } c.globalAlpha = (f.k === 'ammo' || f.k === 'gun') && S.t - f.takenT <= REFILL ? 0.4 : 1; icon(c, cx + mx, cy + my, d > R - 12 ? 6 : 7.5, kind(f)); c.globalAlpha = 1; } },
    full(c, scr, z, hud, o) {
      const r = Math.max(7, Math.min(11, 6 + z * 6)); for (const f of S.list) { if (!shown(f)) continue; const q = scr(f.x, f.y); icon(c, q[0], q[1], f.k === 'heli' ? r + 2 : r, kind(f)); }
      // the counter and the four kinds, in the map frame's top left corner (this call runs inside the frame's clip)
      const lx = o.x0 + 14, ly = o.y0 + 14, [n, N] = count(); c.globalAlpha = 0.92; hud.panel(lx, ly, 214, 168, 10); c.globalAlpha = 1; hud.text('FOUND ' + n + ' / ' + N, lx + 18, ly + 30, 14, '#fff', 'left', 800, 3);
      [['ammo', 'Ammo box'], ['gun', 'Gun case / rifle'], ['car', 'Special vehicle'], ['heli', 'Helicopter']].forEach(([kd, t], i) => { icon(c, lx + 28, ly + 58 + i * 28, 9, kd); hud.text(t, lx + 50, ly + 63 + i * 28, 14, 'rgba(255,255,255,0.9)', 'left', 600, 0.5); });
    },
  };
  S.icon = icon; S.give = give; S.restock = restock; S.cast = cast; S.maps = MAPS;
  console.log('[finds] ' + S.list.length + ' things to find on map "' + map + '", ' + S.found.size + ' known from before');
  return S;
}
