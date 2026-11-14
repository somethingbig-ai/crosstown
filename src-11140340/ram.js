// ram.js: a car that is rammed is THROWN. (nyc-breakable, Nov 14; players' most-sent report: "hit cars stand like rock", "glued to the asphalt",
// "both cars just stop", "the lightest vehicle should be moved the most".)
// Hook, ONE line at the end of Game.init, after the crash.js line (it has to wrap collideCars outside motion's unstick):
//     try { (await import('./ram.js')).install(this); } catch (e) { console.log('[game] ram not loaded: ' + (e && e.message)); }
// Off: ?ram=0. Needs only the game object. Costs nothing until a car is hit at speed.
// What it does, when the player's car meets another car at RAM (5 m/s = 18 km/h) or more of closing speed:
//  - a TRAFFIC car leaves its lane and becomes a loose car (as it does when the player takes it), a PARKED car comes loose (as motion's unstick does it);
//  - the two cars trade speed by their masses (a bus barely moves, a coupe is flung), the struck car spins from where it was caught, slides on its
//    tyres (sideways hard, lengthways easier), hits walls, posts and props, and comes to rest; a thrown car that meets another car passes the blow on;
//  - game.onCrash is called as before, so crash.js dents both and the camera, sound and damage are the game's own.
// Below that speed nothing changes: traffic gives way at walking pace and parked cars are shoved, as today.
const RAM = 5, MAXLOOSE = 8, FAR = 90, LOOK = 2 / 60, K3 = [0.3, 0, -0.3];
export function install(game) {
  if (game.__ram) return game.__ram;
  const S = (game.__ram = { on: true, rams: 0, converted: 0, loosened: 0, thrown: 0, passed: 0, removed: 0, made: [] });
  if (game.P && game.P.get('ram') === '0') { S.on = false; return S; }
  const st = game.statics, _o = {}, N = { x: 0, y: 0, px: 0, py: 0 }, near = [];
  const mass = (d) => 1500 * (d.len * d.wid) / 8.1 * (d.type === 'bus' ? 2.2 : /van|truck/.test(d.type) ? 1.4 : d.type === 'suv' ? 1.15 : 1);
  const velOf = (o) => (o.vx !== undefined ? [o.vx, o.vy] : [Math.cos(o.h) * (o.v - (o.rev || 0)), Math.sin(o.h) * (o.v - (o.rev || 0))]);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  // deepest overlap of two cars (three circles each, a long one five): N = the way from a to b and the point between them; returns the depth
  function pen(a, b) { let best = -9; const ra = a.def.wid * 0.5, rb = b.def.wid * 0.5, ca = Math.cos(a.h), sa = Math.sin(a.h), cb = Math.cos(b.h), sb = Math.sin(b.h), ea = Math.max(a.def.len * 0.3, a.def.len / 2 - ra), eb = Math.max(b.def.len * 0.3, b.def.len / 2 - rb);
    const KA = ea > 1.8 * ra ? [1, 0.5, 0, -0.5, -1] : [1, 0, -1], KB = eb > 1.8 * rb ? [1, 0.5, 0, -0.5, -1] : [1, 0, -1];
    for (const i of KA) for (const j of KB) { const ax = a.x + ca * ea * i, ay = a.y + sa * ea * i, bx = b.x + cb * eb * j, by = b.y + sb * eb * j, dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), p = ra + rb - d;
      if (p > best && d > 1e-4) { best = p; N.x = dx / d; N.y = dy / d; N.px = ax + dx / d * ra; N.py = ay + dy / d * ra; } } return best; }
  // ------------------------------------------------------------ a thrown car: it slides on its tyres until it stands
  function slide(dt, inp, g) {
    if (this === g.player.vehicle) { if (this.ram.loosed) this.loosed = this.ram.loosed; this.ram = null; delete this.step; this.yawV = 0; return this.step(dt, inp, g); }      // the player took it: theirs to drive
    const R = this.ram, c = Math.cos(this.h), s = Math.sin(this.h); let vf = this.vx * c + this.vy * s, vs = this.vx * s - this.vy * c;
    const df = (R.brake ? 6.5 : 3.2) * dt, ds = 8.2 * dt; vf -= Math.sign(vf) * Math.min(Math.abs(vf), df); vs -= Math.sign(vs) * Math.min(Math.abs(vs), ds);      // tyres: sideways they scrub hard, lengthways they roll against the brake
    R.w -= Math.sign(R.w) * Math.min(Math.abs(R.w), (1.6 + Math.abs(R.w) * 1.5) * dt);      // four tyres scrubbing round stop a spin quickly: a quarter hit at 45 km/h turns the car about a quarter turn
    this.h = wrap(this.h + R.w * dt); const c2 = Math.cos(this.h), s2 = Math.sin(this.h);
    this.vx = vf * c + vs * s; this.vy = vf * s - vs * c; this.x += this.vx * dt; this.y += this.vy * dt; this.vf = this.vx * c2 + this.vy * s2; this.vs = this.vx * s2 - this.vy * c2; this.slip = Math.abs(this.vs);
    const L = this.def.len, r = this.def.wid * 0.5; let hit = 0;
    for (const o of [L * 0.3, 0, -L * 0.3]) { const cx = this.x + c2 * o, cy = this.y + s2 * o;
      if (st.resolve(cx, cy, r, _o)) { this.x += _o.x - cx; this.y += _o.y - cy; const vn = this.vx * _o.nx + this.vy * _o.ny;
        if (vn < 0) { this.vx -= vn * 1.2 * _o.nx; this.vy -= vn * 1.2 * _o.ny; const tx = -_o.ny, ty = _o.nx, vt = this.vx * tx + this.vy * ty; this.vx -= vt * 0.2 * tx; this.vy -= vt * 0.2 * ty;
          R.w += Math.max(-1.2, Math.min(1.2, (c2 * _o.ny - s2 * _o.nx) * o * vn * 0.25)); R.w *= 0.7; hit = Math.max(hit, -vn); } } }
    if (hit > 2.5) { this.damage += hit; this.hitT = 0.35; try { g.onCrash(this, hit); } catch (e) {} }
    this.hitT = Math.max(0, this.hitT - dt); this.spin += (this.vf * dt) / this.def.radius; this.braking = !!R.brake; this.yawV = R.w; this.acc = 0;
    const tz = st.onSidewalk(this.x, this.y) ? 0.15 : 0; this.z += (tz - this.z) * Math.min(1, dt * 14);
    this.roll += (Math.max(-0.085, Math.min(0.085, this.vs * 0.016)) - this.roll) * Math.min(1, dt * 7); this.pitch += (0 - this.pitch) * Math.min(1, dt * 6);
    R.t += dt; const sp = Math.hypot(this.vx, this.vy); R.still = sp < 0.3 && Math.abs(R.w) < 0.1 ? R.still + dt : 0;
    if (R.still > 0.25 || R.t > 14) { this.vx = this.vy = 0; this.vf = this.vs = 0; this.yawV = 0; if (R.loosed) this.loosed = R.loosed; this.ram = null; delete this.step; }
  }
  function throwCar(o, brake) { if (o === game.player.vehicle) return; if (!o.ram) { o.ram = { w: 0, t: 0, still: 0, brake: !!brake, loosed: o.loosed || null }; o.loosed = null; o.step = slide; }      /* (while it flies it is not motion's to shove: unstick stops a loosed car it finds touching) */ else { o.ram.t = 0; o.ram.still = 0; } }
  // a traffic car leaves its lane (as when the player takes one: game.js enterVehicle)
  function convert(c) { const v = velOf(c), mk = game.combat && game.combat.mkVehicle ? (q) => game.combat.mkVehicle(q) : (q) => new game.player.vehicle.constructor(q.def, q.x, q.y, q.h, q.color);
    let n; try { n = mk(c); } catch (e) { n = new (S.V)(c.def, c.x, c.y, c.h, c.color); } game.traffic.remove(c); n.vx = v[0]; n.vy = v[1]; n.spin = c.spin || 0; n.rammed = game.t || 0; game.vehicles.push(n); S.converted++; S.made.push(n); throwCar(n, true); tidy(); return n; }
  function tidy() { const pl = game.player; for (let i = S.made.length - 1; i >= 0; i--) { const o = S.made[i], j = game.vehicles.indexOf(o); if (j < 0 || o === pl.vehicle) { S.made.splice(i, 1); continue; } if (!o.ram && Math.hypot(o.x - pl.x, o.y - pl.y) > FAR) { S.made.splice(i, 1); game.vehicles.splice(j, 1); S.removed++; } }      /* a wreck far behind the player is cleared away */
    while (S.made.length > MAXLOOSE) { let k = -1, bd = -1; for (let i = 0; i < S.made.length; i++) { const o = S.made[i]; if (o === pl.vehicle || o.ram) continue; const d = Math.hypot(o.x - pl.x, o.y - pl.y); if (d > bd) { bd = d; k = i; } } if (k < 0) break; const o = S.made[k]; S.made.splice(k, 1); const j = game.vehicles.indexOf(o); if (j >= 0) { game.vehicles.splice(j, 1); S.removed++; } } }
  // the blow between two loose cars: speed traded by mass, a spin on b (and on a if it is thrown too) from where it was caught
  function blow(a, b, depth, closing, playerIsA) {
    const nx = N.x, ny = N.y, px = N.px, py = N.py, ma = mass(a.def), mb = mass(b.def), e = 0.18, j = (1 + e) * closing / (1 / ma + 1 / mb);
    a.vx -= j / ma * nx; a.vy -= j / ma * ny; b.vx += j / mb * nx; b.vy += j / mb * ny;
    const sa = mb / (ma + mb), sb = ma / (ma + mb); depth += 0.04; a.x -= nx * depth * sa; a.y -= ny * depth * sa; b.x += nx * depth * sb; b.y += ny * depth * sb;
    throwCar(b, b.ram ? b.ram.brake : false);
    if (b.ram) { const rx = px - b.x, ry = py - b.y, Ib = mb * (b.def.len * b.def.len + b.def.wid * b.def.wid) / 12; b.ram.w = Math.max(-3.6, Math.min(3.6, b.ram.w + 0.6 * (rx * ny - ry * nx) * j / Ib)); }
    { const rx = px - a.x, ry = py - a.y, Ia = ma * (a.def.len * a.def.len + a.def.wid * a.def.wid) / 12, dw = -(rx * ny - ry * nx) * j / Ia; if (a.ram) a.ram.w = Math.max(-5, Math.min(5, a.ram.w + dw)); else if (playerIsA) a.h = wrap(a.h + Math.max(-0.1, Math.min(0.1, dw * 0.03))); }
    S.rams++;
  }
  const dent = (o, px, py, dx, dy, f) => { const C = game.__crash; if (!C || !C.hit) return; try { if (!S.V3) S.V3 = Object.getPrototypeOf(game.world.camera.position).constructor; C.hit(o, new S.V3(px, (o.z || 0) + 0.5, -py), new S.V3(dx, 0, -dy), f); } catch (e) {} };
  // ------------------------------------------------------------ the player's car against the others
  const cc = game.collideCars.bind(game);
  game.collideCars = (v, dt) => {
    if (!S.on || v !== game.player.vehicle) return cc(v, dt);
    try { S.V = v.constructor; const sp = Math.hypot(v.vx, v.vy);
      if (sp >= RAM * 0.8) {
        // traffic in the way at speed: it comes off its lane first
        for (const c of game.traffic.cars.slice()) { if (Math.abs(c.x - v.x) > 14 || Math.abs(c.y - v.y) > 14) continue; const d = pen(v, c); if (d <= 0) continue; const ov = velOf(c), cl = (v.vx - ov[0]) * N.x + (v.vy - ov[1]) * N.y; if (cl >= RAM) convert(c); }
        // a parked car the car will reach within the next two steps comes loose NOW: left for the touch itself, the car's own step meets it as a wall first, bounces off it and the parked car never learns of the blow (that is the 'rock')
        const U = game.unstick; if (U && game.parked.near) { const r = v.def.wid * 0.5, ch = Math.cos(v.h), sh = Math.sin(v.h);
          for (const s of game.parked.near(v.x, v.y, 9, near)) { if (s.gone || U.loosed >= U.max) continue; let hit = false, toward = 0; for (const k of K3) for (const q of s.circles || []) { const ex = q.x - (v.x + ch * v.def.len * k + v.vx * LOOK), ey = q.y - (v.y + sh * v.def.len * k + v.vy * LOOK), el = Math.hypot(ex, ey); if (el < r + q.r + 0.05) { hit = true; toward = Math.max(toward, (ex * v.vx + ey * v.vy) / (el || 1)); } }
            if (!hit || toward < RAM) continue; game.parked.take(s); const o = new v.constructor(s.def, s.x, s.y, s.h, s.color); o.mission = s.mission; o.loosed = s; game.vehicles.push(o); U.loosed++; S.loosened++; } }
      }
      for (const o of game.vehicles) { if (o === v || Math.abs(o.x - v.x) > 14 || Math.abs(o.y - v.y) > 14) continue; const d = pen(v, o); if (d <= 0) continue; const cl = (v.vx - o.vx) * N.x + (v.vy - o.vy) * N.y;
        if (cl >= RAM || (o.ram && cl > 0.4)) { const keep = { x: N.x, y: N.y, px: N.px, py: N.py }; if (cl > 2.5) { v.damage += cl; v.hitT = 0.35; try { game.onCrash(v, cl); } catch (e) {} } Object.assign(N, keep); blow(v, o, d, cl, true); } }
    } catch (e) { if (!S.err) { S.err = String((e && e.stack) || e).slice(0, 400); console.log('[ram] ' + S.err); } }
    return cc(v, dt);
  };
  // ------------------------------------------------------------ thrown cars against the other cars
  const gstep = game.step.bind(game);
  let tick = 0; game.step = (dt) => { gstep(dt); if (!S.on) return; if (S.made.length && tick++ % 120 === 0) tidy();
    try { const pv = game.player.vehicle;
      for (const o of game.vehicles) { if (!o.ram) continue; const sp = Math.hypot(o.vx, o.vy);
        for (const c of game.traffic.cars.slice()) { if (Math.abs(c.x - o.x) > 12 || Math.abs(c.y - o.y) > 12) continue; const d = pen(o, c); if (d <= 0) continue; const ov = velOf(c), cl = (o.vx - ov[0]) * N.x + (o.vy - ov[1]) * N.y, k = { x: N.x, y: N.y, px: N.px, py: N.py };
          if (cl >= RAM && S.made.length < MAXLOOSE + 4) { const n = convert(c); Object.assign(N, k); dent(o, k.px, k.py, -k.x, -k.y, cl * 0.8); dent(n, k.px, k.py, k.x, k.y, cl * 0.8); blow(o, n, d, cl, false); S.passed++; }
          else { o.x -= k.x * d; o.y -= k.y * d; if (cl > 0) { o.vx -= cl * 1.15 * k.x; o.vy -= cl * 1.15 * k.y; c.stun = Math.max(c.stun || 0, 1.6); c.v *= 0.4; if (cl > 2.5) { dent(o, k.px, k.py, -k.x, -k.y, cl * 0.8); dent(c, k.px, k.py, k.x, k.y, cl * 0.8); } } } }
        if (sp < 0.3) continue;
        for (const u of game.vehicles) { if (u === o || u === pv || (u.ram && u.ram.t < o.ram.t) || Math.abs(u.x - o.x) > 12 || Math.abs(u.y - o.y) > 12) continue; const d = pen(o, u); if (d <= 0) continue; const cl = (o.vx - u.vx) * N.x + (o.vy - u.vy) * N.y;
          if (cl > 0.4) { const k = { x: N.x, y: N.y, px: N.px, py: N.py }; if (cl > 2.5) { dent(o, k.px, k.py, -k.x, -k.y, cl * 0.8); dent(u, k.px, k.py, k.x, k.y, cl * 0.8); Object.assign(N, k); } blow(o, u, d, cl, false); S.passed++; } else { o.x -= N.x * d * 0.5; o.y -= N.y * d * 0.5; u.x += N.x * d * 0.5; u.y += N.y * d * 0.5; } } }
    } catch (e) { if (!S.err) { S.err = String((e && e.stack) || e).slice(0, 400); console.log('[ram] ' + S.err); } } };
  S.stats = () => ({ rams: S.rams, converted: S.converted, loosened: S.loosened, thrown: game.vehicles.filter((q) => q.ram).length, passed: S.passed, removed: S.removed, loose: S.made.length, err: S.err || null });
  return S;
}
