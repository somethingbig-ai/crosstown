// rockets.js: unguided rockets on the helicopter (heli lane, Nov 16; Matt: "Add missiles to the copter to blow things up").
// Two seven-tube pods hang from stub pylons behind the doors. While you fly: LEFT MOUSE, R or ENTER (pad: A) fires one, alternating pods;
// held, four a second. Fourteen rockets, then the pods take six seconds to reload. A rocket flies where the ring on the screen sits:
// along the nose, tipped a few degrees down so a level hover can reach the street; a car near the ring is taken as the target
// (the ring closes to a diamond) and the rocket leans toward it. What it meets (street, roof, wall, car) it blows up: cars in the blast
// burn or are thrown, people are thrown down, street things are knocked over, and the police take note (blast.js does the damage).
// ?hrockets=0: this file is never fetched and the aircraft is as before.
// heli.js calls: addRockets(heli, ctx) once; step(dt) every fixed step; sync(dt, view) every drawn frame; drawHud(hud).
import * as THREE from 'three';
import { DIMS } from './dims.js';
import { Puffs, boomAt } from './blast.js';

const MAX = 10, CLIP = 14, RELOAD = 6, RATE = 0.25, LIFE = 5, V0 = 45, BURN = 0.85, ACC = 185, DEP = 0.14;      // DEP: the tubes point this far below the nose line (rad)
const POD = { x: -1.0, y: 0.62, z: 1.27, r: 0.17, len: 1.32 };      // behind the pilot's door and clear of the walk to it (was -0.55: he walked through the pylon)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);

function podMesh(model) {
  const g = new THREE.Group(); g.name = 'rocketPods';
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#20283a'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#0a0a0a';
  for (let i = 0; i < 7; i++) { const a = i * Math.PI / 3, r = i === 6 ? 0 : 36; x.beginPath(); x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 14, 0, 7); x.fill(); }
  for (let i = 0; i < 7; i++) { const a = i * Math.PI / 3, r = i === 6 ? 0 : 36, gx = 64 + Math.cos(a) * r, gy = 64 + Math.sin(a) * r, gr = x.createRadialGradient(gx - 2, gy - 2, 1, gx, gy, 9); gr.addColorStop(0, '#74776f'); gr.addColorStop(1, '#2c2e2b'); x.fillStyle = gr; x.beginPath(); x.arc(gx, gy, 9, 0, 7); x.fill(); }     /* the rockets' noses in the tubes */
  x.strokeStyle = '#6b6e66'; x.lineWidth = 3; for (let i = 0; i < 7; i++) { const a = i * Math.PI / 3, r = i === 6 ? 0 : 36; x.beginPath(); x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 15, 0, 7); x.stroke(); }
  const face = new THREE.CanvasTexture(c); face.colorSpace = THREE.SRGBColorSpace;
  const body = new THREE.MeshStandardMaterial({ color: 0x1b2438, roughness: 0.38, metalness: 0.45 }), front = new THREE.MeshStandardMaterial({ map: face, roughness: 0.6, metalness: 0.4 }), dark = new THREE.MeshStandardMaterial({ color: 0x1c1d1c, roughness: 0.5, metalness: 0.7 });
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(POD.r, POD.r, POD.len, 20, 1, true), body); tube.rotation.z = -Math.PI / 2; tube.position.set(POD.x, POD.y, s * POD.z); g.add(tube);
    const f = new THREE.Mesh(new THREE.CircleGeometry(POD.r, 20), front); f.rotation.y = Math.PI / 2; f.position.set(POD.x + POD.len / 2, POD.y, s * POD.z); g.add(f);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(POD.r, POD.r * 0.82, 0.16, 20, 1, true), body); tail.rotation.z = -Math.PI / 2; tail.position.set(POD.x - POD.len / 2 - 0.08, POD.y, s * POD.z); g.add(tail);     /* the rear: a short fairing and the tubes' open ends (a critic read the old cone as a solid nose) */
    const rf = new THREE.Mesh(new THREE.CircleGeometry(POD.r * 0.82, 20), front); rf.rotation.y = -Math.PI / 2; rf.position.set(POD.x - POD.len / 2 - 0.16, POD.y, s * POD.z); g.add(rf);
    for (const dz of [-0.07, 0.07]) { const lug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.03), dark); lug.position.set(POD.x + 0.2 * Math.sign(dz), POD.y + POD.r + 0.02, s * POD.z + dz); g.add(lug); }
    for (const dx of [-0.38, 0.38]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(POD.r + 0.012, POD.r + 0.012, 0.06, 20, 1, true), dark); band.rotation.z = -Math.PI / 2; band.position.set(POD.x + dx, POD.y, s * POD.z); g.add(band); }
    // the pylon: a short stub wing from the belly side out to the pod, and the rack the pod hangs from
    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, POD.z - 0.62), body); stub.position.set(POD.x, POD.y + POD.r + 0.11, s * (0.62 + (POD.z - 0.62) / 2)); g.add(stub);
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.09), dark); rack.position.set(POD.x, POD.y + POD.r + 0.04, s * POD.z); g.add(rack);
  }
  const ref = []; model.root.traverse((o) => { if (o.isMesh && !ref.length) ref.push(o); });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (ref[0]) o.layers.mask = ref[0].layers.mask; } });
  model.root.add(g); return g;
}

export function addRockets(heli, ctx) {
  const g = heli.g, f = heli.f, W = g.world, H = heli.heights;
  const pods = podMesh(heli.model);
  const FX = !(g.P && g.P.get('helifx') === '0');      /* lead lake-helifire, Nov 18 (Matt on the trailer: "shooting from the helicopter looks awful"): the fireball's new shader, soft smoke, no white-out near the camera, a strike on a wall thrown out from it with a scorch, light at the launch; ?helifx=0 = as before */
  const WALL = { nx: 0, nz: 0, px: 0, pz: 0 };
  const puffs = new Puffs(W.scene, FX); puffs.sunDir(W.sunDir);
  // the rockets in flight: one instanced mesh (a grey tube with a dark nose), and a glow at each tail
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8); geo.rotateZ(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a8d86, roughness: 0.45, metalness: 0.6 }), MAX); mesh.frustumCulled = false; mesh.count = 0; mesh.name = 'heliRockets'; W.scene.add(mesh);
  const live = [], S = { ammo: CLIP, reload: 0, cool: 0, side: 1, held: false, fired: 0, booms: 0, aim: new THREE.Vector3(), aimOk: false, lock: null, t: 0, pods, puffs, live };
  const pressed = new Set();
  const flying = () => (heli.piloted || S.force) && !heli.busy && !g.paused && !(g.fly && g.fly.on);
  addEventListener('keydown', (e) => { if (!flying()) return; if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'NumpadEnter') { pressed.add(e.code); e.preventDefault(); } });
  addEventListener('keyup', (e) => pressed.delete(e.code));
  addEventListener('mousedown', (e) => { if (e.button === 0 && flying() && document.pointerLockElement) pressed.add('m0'); });
  addEventListener('mouseup', (e) => { if (e.button === 0) pressed.delete('m0'); });
  addEventListener('blur', () => pressed.clear());

  // where the tubes point: the nose line tipped DEP down, in the world
  const boreDir = (out) => out.set(Math.cos(DEP), -Math.sin(DEP), 0).applyQuaternion(f.quat).normalize();
  const podPos = (side, out) => out.set(POD.x + POD.len / 2 + 0.1 - DIMS.cg[0], POD.y - DIMS.cg[1], side * POD.z - DIMS.cg[2]).applyQuaternion(f.quat).add(f.pos);
  // the first solid along a ray (the height picture of the city: streets, roofs, walls), marching; null if none in reach
  const march = (o, d, reach, out) => { let t = 6, st = 4; while (t < reach) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (H.top(x, -z, y + 0.5) > y) { let lo = t - st, hi = t; for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (H.top(o.x + d.x * m, -(o.z + d.z * m), o.y + d.y * m + 0.5) > o.y + d.y * m) hi = m; else lo = m; } out.set(o.x + d.x * lo, o.y + d.y * lo, o.z + d.z * lo); return lo; } t += st; st = Math.min(12, st * 1.08); } return null; };
  // every car in the street near a point: traffic and parked (what blast.js also walks)
  const carsNear = (x, y, r, fn) => { const T = g.traffic; if (T && T.cars) for (const v of T.cars) { if (v && !v.dead && Math.abs(v.x - x) < r && Math.abs(v.y - y) < r) fn(v); } const hv = g.combat && g.combat.heat && g.combat.heat.units; if (Array.isArray(hv)) for (const u of hv)     /* Nov 17 hotfix: with the police out, heat.units is not a list: the loop threw ('hv is not iterable'), three throws switched the rockets off for the session */ { const v = u.car || u.v; if (v && Math.abs(v.x - x) < r && Math.abs(v.y - y) < r) fn(v); } };

  function aimUpdate() {
    const d = boreDir(_a); S.aimOk = false; S.lock = null;
    const t = march(f.pos, d, 900, S.aim); if (t === null) { S.aim.copy(f.pos).addScaledVector(d, 600); } S.aimOk = true; S.range = t;
    // a car near the line is the target: the nearest to the ring within a 5 degree cone, in front, within 600 m
    let best = null, bc = Math.cos(0.09);
    const T = g.traffic; if (T && T.cars) for (const v of T.cars) { if (!v || v.dead) continue; _b.set(v.x - f.pos.x, 0.8 - f.pos.y, -v.y - f.pos.z); const L = _b.length(); if (L > 600 || L < 25) continue; const c = _b.dot(d) / L; if (c > bc) { _b.multiplyScalar(1 / L); const t2 = march(f.pos, _b, L - 3, _c); if (t2 !== null) continue;     /* something stands between: not a target */ bc = c; best = v; } }
    if (best) { S.lock = best; S.aim.set(best.x, 0.8, -best.y); }
  }
  function fire() {
    if (S.ammo <= 0 || S.cool > 0 || live.length >= MAX || f.engine === 'off' && f.onGround) return false;
    const r = { p: podPos(S.side, new THREE.Vector3()), v: new THREE.Vector3(), d: boreDir(new THREE.Vector3()), t: 0, tgt: S.lock, seed: Math.random() * 99 };
    r.d.x += (Math.random() - 0.5) * 0.012; r.d.y += (Math.random() - 0.5) * 0.012; r.d.z += (Math.random() - 0.5) * 0.012; r.d.normalize();
    r.v.copy(f.vel).addScaledVector(r.d, V0); live.push(r); S.side = -S.side; S.ammo--; S.cool = RATE; S.fired++; if (S.ammo === 0) S.reload = RELOAD;
    // the launch: a puff of smoke thrown back from the tube, a kick on the camera, the whoosh
    for (let i = 0; i < 6; i++) puffs.add(r.p.x, r.p.y, r.p.z, f.vel.x - r.d.x * (4 + i * 3), f.vel.y - r.d.y * (4 + i * 3) + 0.5, f.vel.z - r.d.z * (4 + i * 3), 0.4, 1.8, 1.4, 0, 0.9); puffs.add(r.p.x, r.p.y, r.p.z, f.vel.x, f.vel.y, f.vel.z, 1.6, 0.08, 6, 1);
    if (FX) { puffs.add(r.p.x, r.p.y, r.p.z, f.vel.x, f.vel.y, f.vel.z, 2.8, 0.1, 5, 1, 0.25); const fx = g.combat && g.combat.fx; if (fx && fx.light && !boomAt.lit && !(fx.lightT > 0.1)) { fx.light.position.copy(r.p); fx.lightI = 36 * (0.25 + 0.75 * (S.day ?? 1)); fx.lightT = 0.12; fx.light.distance = 14; } }      /* the launch: a wider glow for a tenth of a second and the game's flash light on the pod and the cabin side (not while a strike is using that light) */
    heli.cam.shake = Math.min(1, heli.cam.shake + 0.12); boomAt.whoosh(g); return true;
  }
  function explode(r, p, car) {
    S.booms++; (S.last || (S.last = new THREE.Vector3())).copy(p); const top = H.top(p.x, -p.z, p.y + 1.5); let wall = null; if (r.wall && !car) { wall = WALL; wall.nx = r.wnx; wall.nz = r.wnz; wall.px = r.wpx; wall.pz = r.wpz; }
    boomAt(g, heli, puffs, p.x, top > p.y - 2.5 && top <= p.y + 0.3 ? top : p.y, p.z, { car, vx: r.v.x, vz: r.v.z, ground: top > p.y - 2.5 && top <= p.y + 0.3, wall });
  }
  function step(dt) {
    S.t += dt; S.cool = Math.max(0, S.cool - dt);
    { const tod = g.night && typeof g.night.tod === 'number' ? g.night.tod : 12.5, e = Math.cos((tod - 12.5) * Math.PI / 12), u = Math.max(0, Math.min(1, (e + 0.15) / 0.5)), d = 0.07 + 0.93 * u * u * (3 - 2 * u); if (d !== S.day) { S.day = d; puffs.setDay(d); } }     /* by the game's clock (sky/night.js): smoke and trail are lit by the day, dark at night */
    if (S.reload > 0) { S.reload -= dt; if (S.reload <= 0) { S.ammo = CLIP; S.reload = 0; } }
    const fl = flying();
    if (fl) {
      aimUpdate(); let want = pressed.size > 0; if (want && g.combat && g.combat.heliGun && g.combat.heliGun()) want = pressed.has('Enter') || pressed.has('NumpadEnter');      /* gameplay/takeover fire: with a hand gun picked in the seat the mouse and R are the gun's; the rockets stay on Enter (?helifire=0 = as before) */
      const gp = g.padui && g.padui.pad ? g.padui.pad() /* gameplay/pad: the pad in use, not slot 0 only */ : navigator.getGamepads ? navigator.getGamepads()[0] : null; if (gp && gp.buttons[0] && gp.buttons[0].pressed) want = true;
      if (S.shoot) { want = true; S.shoot = false; }
      if (want) fire();
    } else { pressed.clear(); S.aimOk = false; S.lock = null; }
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i]; r.t += dt; let hit = null, car = null;
      // steer: toward the car it was fired at, a little; the motor burns BURN seconds, then it coasts and sinks
      if (r.tgt && !r.tgt.dead && r.t > 0.12) { _b.set(r.tgt.x - r.p.x, 0.8 - r.p.y, -r.tgt.y - r.p.z); const L = _b.length(); if (L > 2) { _b.multiplyScalar(1 / L); const k = Math.min(1, dt * 2.2); r.d.lerp(_b, k).normalize(); const sp = r.v.length(); r.v.lerp(_c.copy(r.d).multiplyScalar(sp), Math.min(1, dt * 4)); } }
      if (r.t < BURN) r.v.addScaledVector(r.d, ACC * dt); else r.v.y -= 6 * dt;
      const n = 3, h = dt / n;
      for (let k = 0; k < n && !hit; k++) {
        r.p.addScaledVector(r.v, h);
        const top = H.top(r.p.x, -r.p.z, r.p.y + 0.5); if (top > r.p.y) { hit = r.p; if (top - r.p.y < 1.5) r.p.y = top; else if (FX && Math.hypot(r.v.x, r.v.z) > 12) {      /* a wall: where the line meets it (halved six times between the last point outside and this one), the way out of it, and the burst set a metre outside */
          let lo = 0, hi = 1; for (let q = 0; q < 6; q++) { const m = (lo + hi) / 2, mx = r.p.x - r.v.x * h * m, my = r.p.y - r.v.y * h * m, mz = r.p.z - r.v.z * h * m; if (H.top(mx, -mz, my + 0.5) > my) lo = m; else hi = m; }
          r.p.addScaledVector(r.v, -h * hi); const hl = Math.hypot(r.v.x, r.v.z); r.wall = true; r.wnx = -r.v.x / hl; r.wnz = -r.v.z / hl; r.wpx = r.p.x; r.wpz = r.p.z; r.p.x += r.wnx * 1.0; r.p.z += r.wnz * 1.0; }
          else r.p.addScaledVector(r.v, -h * 0.7); break; }     // a roof or the street: on it; a wall: just outside it
        if (r.p.y < 3.2 && r.t > 0.08) carsNear(r.p.x, -r.p.z, 3.4, (v) => { if (!hit && Math.hypot(v.x - r.p.x, v.y + r.p.z) < 2.6) { hit = r.p; car = v; } });
      }
      if (r.t < BURN + 0.6 && !(g.P && g.P.get('hrkdbg') === 'nopuff')) { const lp = r.lp || (r.lp = r.p.clone().addScaledVector(r.v, -dt)), L = lp.distanceTo(r.p), n = Math.min(110, Math.ceil(L / 0.5));
        for (let k = 1; k <= n; k++) { const u = k / n; puffs.add(lp.x + (r.p.x - lp.x) * u, lp.y + (r.p.y - lp.y) * u, lp.z + (r.p.z - lp.z) * u, (Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 0.3, 1.3 + Math.random() * 0.7, 0.42, 0, 0.75); } lp.copy(r.p); }     /* a thin grey line, a puff every 0.8 m (the second critic: 'a string of separate cotton balls, far too fat and bright') */
      if (hit) { explode(r, hit, car); live.splice(i, 1); }
      else if (r.t > LIFE || Math.abs(r.p.x) > 6000 || Math.abs(r.p.z) > 6000) { if (r.p.y > 0) explode(r, r.p, null); live.splice(i, 1); }     // spent in the air: it bursts where it is
    }
    puffs.step(dt);
  }
  function sync(dt, view) {
    mesh.count = live.length;
    for (let i = 0; i < live.length; i++) { const r = live[i]; _a.copy(r.v).normalize(); _q.setFromUnitVectors(_b.set(1, 0, 0), _a); mesh.setMatrixAt(i, _m.compose(r.p, _q, _s)); if (r.t < BURN) puffs.flare(r.p.x - _a.x * 0.7, r.p.y - _a.y * 0.7, r.p.z - _a.z * 0.7); }
    if (live.length) mesh.instanceMatrix.needsUpdate = true;
    puffs.sync(view && view.camera || W.camera, dt);
  }
  // the ring: where a rocket fired now would land, projected to the screen (hud space: 1080 high)
  function drawHud(hud) {
    if (!heli.piloted) return; const c = hud.ctx, Wd = hud.w / hud.k, Hh = 1080, cam = W.camera;
    if (S.aimOk) {
      _a.copy(S.aim).project(cam);
      if (_a.z < 1 && Math.abs(_a.x) < 1.05 && Math.abs(_a.y) < 1.05) {
        const x = (_a.x * 0.5 + 0.5) * Wd, y = (-_a.y * 0.5 + 0.5) * Hh, col = S.ammo ? (S.lock ? '#ff5a45' : '#ffb82e') : 'rgba(255,255,255,0.45)';
        c.save(); c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 5; ring(c, x, y, S.lock); c.strokeStyle = col; c.lineWidth = 2.2; ring(c, x, y, S.lock); c.restore();
        if (S.range) hud.text(Math.round(S.lock ? Math.hypot(S.lock.x - f.pos.x, S.lock.y + f.pos.z, f.pos.y) : S.range) + ' m', x + 30, y + 30, 13, col, 'left', 700, 1);
      }
    }
    const x = 36 + 372 + 14, y = Hh - 190; hud.panel(x, y, 150, 104);
    hud.text('ROCKETS', x + 20, y + 30, 12, '#ffb82e', 'left', 700, 2);
    if (S.reload > 0) { hud.text('RELOAD', x + 20, y + 62, 22, '#ff5a45', 'left', 700); c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x + 20, y + 82, 110, 4); c.fillStyle = '#ffb82e'; c.fillRect(x + 20, y + 82, 110 * (1 - S.reload / RELOAD), 4); }
    else { hud.text(String(S.ammo), x + 20, y + 66, 28, '#fff', 'left', 700); for (let i = 0; i < CLIP; i++) { c.fillStyle = i < S.ammo ? '#ffb82e' : 'rgba(255,255,255,0.2)'; c.fillRect(x + 20 + i * 8, y + 80, 5, 8); } }
  }
  function ring(c, x, y, lock) {
    c.beginPath();
    if (lock) { c.moveTo(x, y - 20); c.lineTo(x + 20, y); c.lineTo(x, y + 20); c.lineTo(x - 20, y); c.closePath(); }
    else { c.arc(x, y, 16, 0, Math.PI * 2); }
    c.moveTo(x - 30, y); c.lineTo(x - 21, y); c.moveTo(x + 21, y); c.lineTo(x + 30, y); c.moveTo(x, y - 30); c.lineTo(x, y - 21); c.moveTo(x, y + 21); c.lineTo(x, y + 30); c.stroke();
    c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.stroke();
  }
  S.step = step; S.sync = sync; S.drawHud = drawHud; S.fire = fire; S.shootNow = () => { S.shoot = true; };
  console.log('[hrk] rockets on: ' + CLIP + ' in two pods');
  return S;
}
