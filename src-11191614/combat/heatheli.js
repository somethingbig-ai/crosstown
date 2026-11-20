// combat/heatheli.js (gameplay lane, Nov 15 2026): the police against a player who is FLYING the helicopter. Matt, report 172742-a9a254:
// "do the cops not shoot me in the air?" Before this file heatcore.js said: above 22 m nobody on the street has him (sight()), so the wanted level
// cooled as if he had hidden; below 22 m they fired at a man standing on the street under the aircraft.
// Fetched by heatcore.js the first time a WANTED player is in the air (airOn()); a player who never does that never pays for it.
// ?heliheat=0 = the game as it was (heatcore.js then never asks for this file).   THE POLICE HELICOPTER IS OFF BY DEFAULT (stage 2, Nov 15: its logic ran in real Chrome, nobody has SEEN it): ?helicop=1 on at step 3, ?helicop=<2..5> on at that step.
//   on the street: officers and cars with a clear line over the roofs (the helicopter lane's own heights) see him (officers to 200 m on the map, a patrol car's crew to 110 m); from step 2
//     they fire up at the hull: pistols to 90 m of slant, carbines to 120 m, shotguns to 60 m. Nobody fires with a person or an officer in the low
//     part of the line (below 2.6 m). A round that hits adds to the aircraft's OWN damage (flight.js damage 0..1: smoke from 0.6 (wash.js), engine
//     out at 1, then it autorotates and wreck.js takes over). Damage is paid from a budget that fills at RATE per second: never an instant kill.
//   from step 3 while he flies: ONE police helicopter comes in from behind his flight (hovering: from behind the camera), 430 m out, holds 55 m off his side at his height, fires five
//     rounds every 3 to 4.5 s inside 110 m (only while he is 12 m or more above what is under him: its misses go into the sky, not the street), keeps
//     him in sight to 320 m, can be shot down (the player's own rounds, 13 carbine hits) or outrun (top speed 38 m/s; 420 m away for 10 s and it
//     gives up), and leaves when the wanted level ends or he has been out of the aircraft for 20 s. It is DRAWN AS A STAND-IN built here in code
//     (navy hull, white band, POLICE on the sides, strobes, rotor disc): the player's own model is NOT reused yet (see HANDOVER.md).
import * as THREE from 'three';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
export function addHeliHeat(H, K) {
  const g = H.g, c = H.c, P = g.P, hl = g.heli, f = hl.f, st = H.stats, num = (k, d) => (P.has(k) && P.get(k) !== '' && isFinite(+P.get(k)) ? +P.get(k) : d);
  const FIRE_R = num('helifr', 120), SEE_R = 200, CAR_R = 110, HULL = 1.7, UNIT_L = num('helicop', 3) >= 2 ? clamp(num('helicop', 3), 2, 5) : 3, UNIT_ON = P.has('helicop') && P.get('helicop') !== '0' /* OFF unless asked for (stage 2, Nov 15: nobody has seen it drawn) */, VMAX = 38, ACC = 9, DK = num('helidm', 1);
  const RATE = [0, 0, 0.010, 0.014, 0.018, 0.022], HIT = { pistol: 0.006, shotgun: 0.003, rifle: 0.008 }, REACH = { pistol: 0.75, shotgun: 0.5, rifle: 1 };
  Object.assign(st, { heliShots: 0, heliHits: 0, heliDmg: 0, heliHeld: 0, heliSmokeT: null, heliDownT: null, unitN: 0, unitShots: 0, unitHits: 0, unitDown: 0, unitLeft: 0 });
  const A = { unit: null, bucket: 0, bT: H.t, airT: -99, nextAt: 0, wantT: undefined, vis: null, noteT: -99 };
  const top = (x, y) => { try { return hl.heights.top(x, y, 1e4) || 0; } catch (e) { return 0; } };
  /* a clear line over the roofs between two points (map x, y, height): the height picture every 5 m; the first 2 m and the last 6 m are the two ends themselves */
  A.los = (ox, oy, oz, tx, ty, tz) => { const d = Math.hypot(tx - ox, ty - oy), n = Math.min(60, Math.ceil(d / 5)); for (let i = 1; i < n; i++) { const u = i / n; if (u * d < 2 || (1 - u) * d < 6) continue; if (top(ox + (tx - ox) * u, oy + (ty - oy) * u) > oz + (tz - oz) * u + 0.5) return false; } return true; };
  A.sees = (k, d) => { const ez = (k.z || 0) + 1.6; k.airSl = Math.hypot(d, f.pos.y - ez); return d < SEE_R && A.los(k.x, k.y, ez, f.pos.x, -f.pos.z, f.pos.y); };
  A.carSees = (v) => !!v.drive && !v.away && !v.wreck && Math.hypot(v.x - f.pos.x, v.y + f.pos.z) < CAR_R && A.los(v.x, v.y, 1.3, f.pos.x, -f.pos.z, f.pos.y);
  A.eye = () => { const U = A.unit; return !!U && U.mode === 'on' && U.dist < 320 && U.los; };
  A.canFire = (k) => H.level >= 2 && k.airSl <= FIRE_R * (REACH[k.gunK] || 1);
  /* people and officers in the LOW part of the line (the round is below 2.6 m): the same cone as heatcore's inLine */
  A.inLine = (k, ox, oy, oz, ex, ey, ez) => { if (P.get('heatline') === '0') return 0; const d = Math.hypot(ex, ey) || 1, ux = ex / d, uy = ey / d, cut = (ez > 0.05 ? clamp((2.6 - oz) / ez, 0, 1) : 1) * d + 1;
    const near = (p, w0, wk) => { const px = p.x - ox, py = p.y - oy, fw = px * ux + py * uy; return fw > 0.7 && fw < cut && Math.abs(px * uy - py * ux) < w0 + wk * fw; };
    for (const q of H.cops) if (q !== k && q.hp > 0 && near(q, 0.42, 0.02)) return 2;
    for (const p of g.peds.list) { if (p.state === 'down' || p.isPlayer || p.hp <= 0 || p.gone || H.cops.includes(p)) continue; if (near(p, 0.5, 0.055)) return 1; }
    const cs = g.crowd && g.crowd.on && g.crowd.sim; if (cs && cs.agents) for (const a of cs.agents) { if (a.gone || a.state === 'down') continue; if (near(a, 0.5, 0.055)) return 1; }
    return 0; };
  /* damage to the aircraft, from the budget */
  A.hurt = (d) => { const R = (RATE[H.level] || RATE[2]) * DK; A.bucket = Math.min(4 * R, A.bucket + Math.max(0, H.t - A.bT) * R); A.bT = H.t; d = Math.min(d * DK, A.bucket); if (!(d > 0) || f.damage >= 1) return 0; A.bucket -= d;
    const was = f.damage; f.damage = Math.min(1, was + d); st.heliDmg += d; if (hl.hasCamera && hl.cam) hl.cam.shake = Math.min(1, (hl.cam.shake || 0) + 0.12);
    if (was < 0.6 && f.damage >= 0.6) { st.heliSmokeT = H.t; H.note = { title: 'ENGINE HIT', sub: 'It is smoking. Lose them or put it down', t: 1.2 }; H.say('helicopter smoking'); }
    else if (f.damage >= 1) { st.heliDownT = H.t; H.note = { title: 'ENGINE OUT', sub: 'Nose down, then flare at the street', t: 1.2 }; H.say('helicopter engine out'); }
    else if (H.t - A.noteT > 40 && !H.note) { A.noteT = H.t; H.note = { title: 'TAKING FIRE', sub: 'They are shooting at the helicopter', t: 2 }; }
    return d; };
  /* one round from (ox, oy, oz) at the hull: true when it strikes. mz: where its tracer starts (three.js) */
  A.round = (ox, oy, oz, sig, range, dmg, mz, draw) => { const tx = f.pos.x - ox, ty = -f.pos.z - oy, tz = f.pos.y - oz, L = Math.hypot(tx, ty, tz) || 1;
    const a = Math.atan2(ty, tx) + H.gauss() * sig, e = Math.asin(clamp(tz / L, -1, 1)) + H.gauss() * sig, dx = Math.cos(a) * Math.cos(e), dy = Math.sin(a) * Math.cos(e), dz = Math.sin(e);
    const B = tx * dx + ty * dy + tz * dz, disc = B * B - (L * L - HULL * HULL), hit = disc >= 0 && B > 0 && B - Math.sqrt(disc) <= range, t = hit ? B - Math.sqrt(disc) : Math.min(range, L + 70);
    try { _a.set(ox + dx * t, oz + dz * t, -(oy + dy * t)); if (draw) H.copTracer(mz, _a); if (hit) { c.fx.impact(_a, _n.set(-dx, -dz, dy), 'metal', { power: 0.9 }); c.snd('impact', 'metal', { dist: 3, pan: 0 }); } } catch (e2) {}
    if (hit) A.hurt(dmg); return hit; };
  /* an officer fires up at him (heatcore's copShoot hands over while he flies) */
  A.copShoot = (k) => { const G = k.G, pl = g.player, mz = H.muzzleOf(k, new THREE.Vector3()), ox = mz.x, oy = -mz.z, oz = mz.y, ex = f.pos.x - ox, ey = -f.pos.z - oy, ez = f.pos.y - oz, L = Math.hypot(ex, ey, ez) || 1;
    if (!A.los(ox, oy, oz, f.pos.x, -f.pos.z, f.pos.y)) { k.burst = 0; k.fireCd = H.rr(0.5, 1.0); k.blockedT = H.t; st.blocked++; return false; }
    { const hb = A.inLine(k, ox, oy, oz, ex, ey, ez); if (hb) { k.burst = 0; k.fireCd = H.rr(0.45, 0.9); k.heldT = H.t; st.held = (st.held || 0) + 1; st.heliHeld++; if (H.t - (H.heldSay || -9) > 4.5) { H.heldSay = H.t; H.shout(H.pick(hb === 2 ? ['Check your fire! Officer in the line!'] : ['Hold your fire! Civilians!', 'No shot! People in the way!']), 1); } return false; } }
    const sp = f.vel.length(), sig = G.sig * K.WIDE[H.level] * 0.8 * (1 + 1.9 * Math.exp(-k.onT / 1.7)) * (sp > 15 ? 2.2 : sp > 5 ? 1.5 : 1) * (k.supp > 0 ? 1.6 : 1) * K.D2R, n = G.pellets || 1; let hits = 0;
    st.copShots++; st.heliShots++; k.blockN = 0; for (let i = 0; i < n; i++) if (A.round(ox, oy, oz, sig, FIRE_R + 30, HIT[k.gunK] || 0.006, mz, i < 3)) hits++;
    const pan = clamp(Math.sin(wrapPi(Math.atan2(k.y - pl.y, k.x - pl.x) - g.cam.yaw)) * -0.8, -1, 1);
    H._copShot = true; try { c.fx.muzzle(mz, _b.set(ex / L, ez / L, -ey / L), k.gunK, g.world.camera.position); } catch (e2) {} H._copShot = false;
    try { c.snd('shot', k.gunK, { dist: L, pan }); } catch (e2) {} k.back = 1; k.rise = 1; (H.marks ||= []).push([H._drawN || 0, 'shot', k.n, hits > 0 ? 1 : 0]); if (H.t - (H.scareT || -9) > 0.7) { H.scareT = H.t; try { c.scare(k.x, k.y, 45, 2); } catch (e2) {} }
    if (hits) { st.copHits++; st.heliHits++; } };

  // ------------------------------------------------------------------ the police helicopter
  A.spawn = () => { /* from where he is not looking: behind his flight when he is moving, else behind the camera as it points now */ const px = f.pos.x, py = -f.pos.z; let a0; if (Math.hypot(f.vel.x, f.vel.z) > 8) a0 = Math.atan2(f.vel.z, -f.vel.x); else { try { g.world.camera.getWorldDirection(_a); a0 = Math.atan2(_a.z, -_a.x); } catch (e) { a0 = f.heading + Math.PI; } } const a = a0 + H.rr(-0.7, 0.7), U = (A.unit = { x: px + Math.cos(a) * 430, y: py + Math.sin(a) * 430, z: Math.max(f.pos.y + 20, 90), h: a + Math.PI, vx: 0, vy: 0, vz: 0, hp: 100, mode: 'on', side: H.rnd() < 0.5 ? -1 : 1, cd: 2.5, burst: 0, t: 0, dist: 430, los: false, losT: 0, farT: 0, rot: 0 });
    U.vx = -Math.cos(a) * 30; U.vy = -Math.sin(a) * 30; st.unitN++; H.shout(H.pick(['Aviation is overhead!', 'Air unit has him!']), 2); H.say('police helicopter sent from ' + U.x.toFixed(0) + ',' + U.y.toFixed(0)); return U; };
  A.remove = (why) => { H.say('police helicopter ' + why); A.unit = null; A.wantT = undefined; if (A.vis) A.vis.root.visible = false; };
  A.step = (dt) => { const U = A.unit, air = hl.piloted && !f.onGround, L = H.level; if (air) A.airT = H.t;
    if (!U) { if (UNIT_ON && air && L >= UNIT_L && !H.dead) { if (A.wantT === undefined) A.wantT = H.t + 8; if (H.t >= A.wantT && H.t >= A.nextAt) A.spawn(); } else A.wantT = undefined; return; }
    U.t += dt; U.rot += dt * 38; const px = f.pos.x, py = -f.pos.z, pz = f.pos.y;
    if (U.mode === 'down') { U.vz -= 9.8 * dt; U.x += U.vx * dt; U.y += U.vy * dt; U.z += U.vz * dt; U.h += dt * 2.6; if (U.z <= top(U.x, U.y) + 1.2 || U.t > U.downAt + 14) { try { c.fx.impact(_a.set(U.x, U.z, -U.y), _n.set(0, 1, 0), 'metal', { power: 3 }); c.scare(U.x, U.y, 60, 2); } catch (e) {} A.remove('down at ' + U.x.toFixed(0) + ',' + U.y.toFixed(0)); } return; }
    if (U.mode === 'on' && (L === 0 || H.dead || H.t - A.airT > 20)) { U.mode = 'leave'; U.la = Math.atan2(U.y - py, U.x - px); U.leaveAt = U.t; st.unitLeft++; H.say('police helicopter leaves (' + (L === 0 ? 'no wanted level' : H.dead ? 'he is down' : 'he is on the ground') + ')'); }
    let gx, gy, gz, lead = 1;
    if (U.mode === 'leave') { gx = U.x + Math.cos(U.la) * 300; gy = U.y + Math.sin(U.la) * 300; gz = U.z + 25; lead = 0; if (Math.hypot(U.x - px, U.y - py) > 520 || U.t - U.leaveAt > 30) { A.remove('gone'); return; } }
    else { const ph = f.heading + U.side * 1.75; gx = px + Math.cos(ph) * 55; gy = py + Math.sin(ph) * 55; gz = pz; }
    gz = Math.max(gz, Math.max(top(U.x, U.y), top(U.x + U.vx * 1.5, U.y + U.vy * 1.5), top(U.x + U.vx * 3, U.y + U.vy * 3)) + 14);
    let wx = (gx - U.x) * 0.7 + lead * f.vel.x, wy = (gy - U.y) * 0.7 - lead * f.vel.z; const wl = Math.hypot(wx, wy); if (wl > VMAX) { wx *= VMAX / wl; wy *= VMAX / wl; }
    const ax = wx - U.vx, ay = wy - U.vy, al = Math.hypot(ax, ay), am = Math.min(al, ACC * dt) / (al || 1); U.vx += ax * am; U.vy += ay * am; U.vz += clamp(clamp((gz - U.z) * 0.8, -8, 10) - U.vz, -6 * dt, 6 * dt);
    U.x += U.vx * dt; U.y += U.vy * dt; U.z += U.vz * dt; U.dist = Math.hypot(px - U.x, py - U.y, pz - U.z);
    const wantH = U.mode === 'on' && U.dist < 160 ? Math.atan2(py - U.y, px - U.x) : Math.hypot(U.vx, U.vy) > 3 ? Math.atan2(U.vy, U.vx) : U.h; U.h += clamp(wrapPi(wantH - U.h), -1.4 * dt, 1.4 * dt);
    U.losT -= dt; if (U.losT <= 0) { U.losT = 0.2; U.los = A.los(U.x, U.y, U.z - 0.8, px, py, pz); }
    if (U.mode !== 'on') return;
    if (U.dist > 420) { U.farT += dt; if (U.farT > 10) { U.mode = 'leave'; U.la = Math.atan2(U.y - py, U.x - px); U.leaveAt = U.t; st.unitLeft++; A.nextAt = H.t + 45; H.say('police helicopter outrun'); H.shout('Air unit has lost him!', 1); return; } } else U.farT = 0;
    if (air && L >= UNIT_L && U.los && U.dist < 110 && f.agl > 12 && H.t >= (H.holdFire || 0) && f.damage < 1) { U.cd -= dt; if (U.cd <= 0) { if (U.burst <= 0) U.burst = 5; const sp = f.vel.length(), nx = Math.cos(U.h), ny = Math.sin(U.h), ox = U.x + nx * 1.6, oy = U.y + ny * 1.6, oz = U.z - 0.9;
        st.unitShots++; if (A.round(ox, oy, oz, 1.5 * (sp > 15 ? 2 : sp > 5 ? 1.4 : 1) * K.D2R, 150, 0.008, _b.set(ox, oz, -oy), true)) st.unitHits++;
        try { c.snd('shot', 'rifle', { dist: U.dist, pan: 0 }); if (c.fx.spawn) c.fx.spawn({ x: ox, y: oz, z: -oy, life: 0.07, s0: 0.5, s1: 0.2, r: 1, g: 0.8, b: 0.4, a: 0.95, add: true, fade: 1 }); } catch (e) {}
        U.burst--; U.cd = U.burst > 0 ? 0.11 : H.rr(3, 4.5); } } };
  /* the player's own rounds against it: found by every cast (heatcore's castCops), paid for in hit() only */
  A.cast = (Hh, ox, oy, oz, dx, dy, dz, tmin) => { const U = A.unit; if (!U || U.mode === 'down') return; const rx = U.x - ox, ry = U.y - oy, rz = U.z - oz, B = rx * dx + ry * dy + rz * dz, disc = B * B - (rx * rx + ry * ry + rz * rz - 2.3 * 2.3); if (disc < 0) return; const t = B - Math.sqrt(disc); if (t < tmin || t >= Hh.t) return;
    Hh.t = t; Hh.kind = 'pheli'; Hh.x = ox + dx * t; Hh.y = oy + dy * t; Hh.z = oz + dz * t; Hh.nx = -dx; Hh.ny = -dy; Hh.nz = -dz; Hh.obj = U; Hh.part = 'body'; };
  { const hit0 = c.hit.bind(c); c.hit = function (h, W, first) { if (!h || h.kind !== 'pheli') return hit0(h, W, first); const U = h.obj; if (U !== A.unit || U.mode === 'down') return null;
      try { c.fx.impact(_a.set(h.x, h.z, -h.y), _n.set(h.nx, h.nz, -h.ny), 'metal', { power: 1 }); if (first) c.snd('impact', 'metal', { dist: U.dist, pan: 0 }); } catch (e) {}
      U.hp -= (W.dmg || 20) * 0.2; if (U.hp <= 0) { U.mode = 'down'; U.downAt = U.t; st.unitDown++; A.nextAt = H.t + 75; H.say('police helicopter shot down'); H.shout('Air unit is hit! Going down!', 2); try { H.crime('copKill', U.x, U.y); } catch (e) {} } return null; }; }

  // ------------------------------------------------------------------ what is drawn of it (a stand-in, built on its first frame)
  A.build = () => { const R = new THREE.Group(); R.name = 'police-heli'; const M = (col, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: col, roughness: 0.55, metalness: 0.2 }, o)), navy = M(0x13233f), white = M(0xe9ecef), dark = M(0x15171a);
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; R.add(m); return m; };
    const sph = new THREE.SphereGeometry(1, 18, 12), cyl = new THREE.CylinderGeometry(1, 1, 1, 10), box = new THREE.BoxGeometry(1, 1, 1);
    add(sph, navy, 0.2, 1.55, 0, 2.3, 1.0, 0.95); add(sph, white, 0.2, 1.2, 0, 2.2, 0.62, 0.97); add(sph, dark, 1.35, 1.75, 0, 1.0, 0.66, 0.86);        /* cabin, belly band, glass */
    const boom = add(cyl, navy, -3.6, 1.85, 0, 0.2, 5.2, 0.2); boom.rotation.z = Math.PI / 2; add(box, navy, -6.0, 2.4, 0, 0.9, 1.5, 0.07); add(box, white, -5.4, 1.9, 0, 0.5, 0.05, 1.5);     /* boom, fin, tailplane */
    for (const s of [-1, 1]) { const sk = add(cyl, dark, 0.2, 0.08, s * 1.05, 0.05, 3.4, 0.05); sk.rotation.z = Math.PI / 2; add(box, dark, 0.9, 0.5, s * 0.9, 0.05, 0.9, 0.05); add(box, dark, -0.5, 0.5, s * 0.9, 0.05, 0.9, 0.05); }
    add(cyl, dark, 0, 2.75, 0, 0.09, 0.6, 0.09); const disc = new THREE.Mesh(new THREE.CircleGeometry(5.3, 28), new THREE.MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.set(0, 3.05, 0); R.add(disc);
    const blades = new THREE.Group(); blades.position.set(0, 3.06, 0); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(box, dark); b.scale.set(5.3, 0.03, 0.22); b.position.set(Math.cos(i * 2.094) * 2.65, 0, Math.sin(i * 2.094) * 2.65); b.rotation.y = -i * 2.094; blades.add(b); } R.add(blades);
    const tail = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), disc.material); tail.position.set(-6.0, 2.0, 0.16); R.add(tail);
    const lamp = (col, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: col })); m.position.set(-0.2, 0.62, z); R.add(m); return m; }, red = lamp(0xff2020, -0.5), blue = lamp(0x2050ff, 0.5);
    try { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const x = cv.getContext('2d'); x.clearRect(0, 0, 512, 128); x.fillStyle = '#ffffff'; x.font = '800 96px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('POLICE', 256, 68);
      const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; const pm = new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), pm); p.position.set(-0.35, 1.72, s * 0.9); p.rotation.y = s > 0 ? 0 : Math.PI; R.add(p); const q = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), pm); q.position.set(-3.3, 1.86, s * 0.21); q.rotation.y = s > 0 ? 0 : Math.PI; R.add(q); } } catch (e) {}
    R.rotation.order = 'YZX'; g.world.scene.add(R); return { root: R, blades, red, blue }; };
  A.draw = (dt) => { const U = A.unit; if (!U) { if (A.vis && A.vis.root.visible) A.vis.root.visible = false; return; } if (A.vis === null) { try { A.vis = A.build(); } catch (e) { A.vis = false; H.oops('pheli', e); } } const V = A.vis; if (!V) return;
    const fw = U.vx * Math.cos(U.h) + U.vy * Math.sin(U.h), sd = -U.vx * Math.sin(U.h) + U.vy * Math.cos(U.h); V.root.visible = true; V.root.position.set(U.x, U.z - 1.6, -U.y); V.root.rotation.set(U.mode === 'down' ? U.t * 1.3 : clamp(-sd * 0.012, -0.35, 0.35), U.h, clamp(-fw * 0.006, -0.22, 0.22));
    V.blades.rotation.y = -U.rot; const ph = Math.floor(U.t * 6) % 4; V.red.visible = ph === 0; V.blue.visible = ph === 2; };
  return A;
}
