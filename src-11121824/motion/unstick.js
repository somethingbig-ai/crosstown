// motion/unstick.js (motion lane, CHIEF's order Nov 12, public report 20261112132507-7e132b "got stuck and glitched"): a car that ends up ACROSS a
// one-lane street stands between the two parked rows with about a metre to spare at nose and tail. Parked cars were fixed obstacles, so every
// touch was a crash against a wall and the car could neither turn nor leave. Now:
//  1. a parked car the player's car touches comes loose: it becomes an ordinary empty car (what already happens when the player gets into one);
//  2. the player's car shoves a loosed car out of its way, slowly (it settles near walking pace and costs no damage; hit it fast and it is a crash as before);
//  3. a shoved car shoves the next one and loosens the parked car it is pushed into, and no two of them are left overlapping;
//  4. loosed cars go back to their places once the player is far away, so a street is never left blocked for traffic.
// ?unstick=0 = off (parked cars are walls again). ?unstickv=3 fastest shove in m/s, ?unstickmax=40 most cars loose at once.
export function install(game) {
  if (game.P.get('unstick') === '0' || !game.parked || !game.parked.near) return null;
  const cc = game.collideCars.bind(game), near = [], U = (game.unstick = { loosed: 0, max: +(game.P.get('unstickmax') || 40), v: +(game.P.get('unstickv') || 3), n: 0 }), K = [0.3, 0, -0.3], L = [];
  // deepest overlap of two cars' bodies (three circles each): fills N with the way from a to b, returns the depth (0 or less = apart)
  const N = { x: 0, y: 0 }, pen = (a, b) => { let best = -9; const ra = a.def.wid * 0.5, rb = b.def.wid * 0.5, ca = Math.cos(a.h), sa = Math.sin(a.h), cb = Math.cos(b.h), sb = Math.sin(b.h);
    for (const i of K) for (const j of K) { const dx = b.x + cb * b.def.len * j - a.x - ca * a.def.len * i, dy = b.y + sb * b.def.len * j - a.y - sa * a.def.len * i, d = Math.hypot(dx, dy), p = ra + rb - d; if (p > best && d > 1e-4) { best = p; N.x = dx / d; N.y = dy / d; } } return best; };
  const loosen = (by, reach = 0.1) => { if (U.loosed >= U.max) return; const r = by.def.wid * 0.5, ch = Math.cos(by.h), sh = Math.sin(by.h);
    for (const s of game.parked.near(by.x, by.y, 9, near)) { let hit = false; for (const k of K) for (const c of s.circles) if (Math.hypot(by.x + ch * by.def.len * k - c.x, by.y + sh * by.def.len * k - c.y) < r + c.r + reach) hit = true;
      if (!hit || U.loosed >= U.max) continue; game.parked.take(s); const o = new by.constructor(s.def, s.x, s.y, s.h, s.color); o.mission = s.mission; o.loosed = s; game.vehicles.push(o); U.loosed++; } };
  game.collideCars = (v) => {
    if (v !== game.player.vehicle) return cc(v);
    if (v.loosed) { v.loosed = null; U.loosed--; }      // the player took it: an ordinary car of the player's from now on
    { const sp = Math.hypot(v.vx, v.vy); loosen(v, sp < 6 ? 0.25 + sp * 0.12 : 0.1); }      // at manoeuvring speed a parked car is let go just BEFORE the touch (a frame or two of travel), so the first touch is already a push and not a crash against a fixed thing; at speed it is a crash as before
    L.length = 0; for (const o of game.vehicles) if (o.loosed && Math.abs(o.x - v.x) < 16 && Math.abs(o.y - v.y) < 16) { o.dv = Math.hypot(o.x - v.x, o.y - v.y); L.push(o); }
    if (L.length) { const step = U.v / 60; L.sort((a, b) => a.dv - b.dv);
      for (const o of L) { const p = pen(v, o); if (p > 0) { const m = Math.min(p, step); o.x += N.x * m; o.y += N.y * m; o.vx = o.vy = 0; o.moved = true;
        const vn = v.vx * N.x + v.vy * N.y; if (vn > 0 && vn < U.v * 1.5) { const k = 1 - Math.pow(0.0018, 1 / 60); v.vx -= vn * N.x * k; v.vy -= vn * N.y * k; } } }      // leaning on a car is heavy work, not a crash: the push settles at about walking pace and costs no damage; a real hit (faster than 1.5x the shove speed) is still a hit
      for (let it = 0; it < 2; it++) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const p = pen(L[i], L[j]); if (p > 0) { const m = Math.min(p, step * 1.5), kf = it ? 0.5 : 1; L[j].x += N.x * m * kf; L[j].y += N.y * m * kf; L[j].vx = L[j].vy = 0; L[j].moved = true; if (it) { L[i].x -= N.x * m * 0.5; L[i].y -= N.y * m * 0.5; L[i].vx = L[i].vy = 0; } } }      // the nearer car pushes the farther one; what is left (the far one stands against a wall) is shared, so the push comes back to the player's car
      for (const o of L) if (o.moved) { o.moved = false; loosen(o); } }
    // far behind the player the street tidies itself: loosed cars stand in their places again
    if (U.n++ % 120 === 0) for (const o of game.vehicles) if (o.loosed && Math.hypot(o.x - v.x, o.y - v.y) > 110) { const s = o.loosed; o.x = s.x; o.y = s.y; o.h = s.h; o.vx = o.vy = 0; o.vf = 0; o.yawV = 0; }
    return cc(v);
  };
  return U;
}
