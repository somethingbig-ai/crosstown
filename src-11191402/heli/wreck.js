// wreck.js (gameplay lane, Nov 14 2026): what becomes of the man in a helicopter that has been written off (flight.js: damage 1, engine failed).
// Before this file nothing did: he stayed "piloting" the wreck. Upright on its skids he could press F and get out; on its side or its back the game
// answered LAND FIRST for ever; and when the wreck fell through the world (flight.js, fixed in the same hand-over) he went with it.
//
// The rule, once the wreck has come to rest (or lies nearly still for 0.6 s on a surface, or has ground its way down something for 8 s):
//   on the STREET, inside the playable box, with open ground beside it: he is THROWN CLEAR onto that ground, on foot, hurt by the speed of the hardest hit
//     ((v - 4) x 5 points of his 100: 14 m/s costs half, 24 m/s and up kills him there, by the game's own death);
//   on a ROOF, outside the playable box, or with no open ground within 11 m: LIGHTS OUT in the wreck whatever the speed (he could never walk away from
//     there: the roof's edge holds a man on foot, and the streets outside the box are not played). The camera stays on the wreck, the screen goes dark
//     and he wakes at the nearest clinic as after any death. No body is shown.
// Also: a wreck cannot be boarded, and once he is 250 m from it (and the wreck has lain 20 s) a fresh helicopter stands on the street pad again.
// Loaded by one line in heli.js; ?hwreck=0 leaves it out (and turns the flight.js floor rule and guard off too: the game as it was).
// Console lines start '[hwreck]'. Nothing here runs unless the aircraft is a wreck, except three comparisons a step.
export function addWreck(heli) {
  const g = heli.g, f = heli.f, H = heli.heights, st = (heli.wreck = { crashV: 0, still: 0, touch: 0, age: 0, kill: null, thrown: 0, lights: 0, fresh: 0, errs: 0, wait: null }), o = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), say = (s) => console.log('[hwreck] ' + s);
  // the police module's body (combat.heat once heatcore.js runs: it owns the player's death). Until the first crime combat.heat is a small stand-in that fetches the body when asked (start).
  const heat = () => { const c = g.combat, h = c && c.heat; return h && typeof h.stepDead === 'function' && 'dead' in h ? h : null; };
  const dark = (h) => { const c = g.combat, pl = g.player; c.health = 0; c.dead = true; if (h.stats) h.stats.deaths++; return (h.dead = { t: 0, cam: false, x: pl.x, y: pl.y, yaw: g.cam.yaw, p: null, hips: null, level: h.level, arrest: false }); };     // the game's own death without a body: the shape heatcore's arrest() uses, as a death (dark at 2 s, awake at the clinic at 3.1 s)
  const step0 = heli.step.bind(heli), board0 = heli.tryBoard.bind(heli), can0 = heli.canBoard.bind(heli);
  heli.tryBoard = function () { return f.damage >= 1 ? false : board0(); };
  heli.canBoard = function () { return f.damage >= 1 ? false : can0(); };
  heli.step = function (dt, I) { const v0 = f.vel.length(); step0(dt, I); try { after(dt, v0); } catch (e) { if (++st.errs <= 3) say('threw: ' + (e && (e.stack || e.message))); } };

  // open ground beside the wreck at street level: the pilot's side first, then round it, nearest first
  function spot(cx, cy) {
    const B = g.bounds, S = g.statics, a0 = f.heading - Math.PI / 2;
    for (const r of [3.4, 4.6, 6, 8, 11]) for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
      const a = a0 + k * Math.PI / 6, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!B.in(x, y, -3) || H.top(x, y, 1e4) > 0.5) continue;
      if (S.resolve && S.resolve(x, y, 0.6, o) > 0) continue;
      if (S.raycast && S.raycast(cx, cy, x, y) < 1) continue;
      return { x, y, a };
    }
    return null;
  }
  function lightsOut(why, v) {
    const pl = g.player, c = g.combat, h = heat(), B = g.bounds;
    heli.piloted = false; heli.insideView = false; if (heli.camMode === 'cockpit') { heli.camMode = 'chase'; heli.cam.init = false; }     // the outside camera stays on the wreck
    pl.vis.object.visible = false; pl.x = clamp(heli.mapX, B.cx - B.x, B.cx + B.x); pl.y = clamp(heli.mapY, B.cy - B.y, B.cy + B.y); pl.speed = 0; pl.alt = 0; pl.roof = null;
    const stub = c && c.heat && !h && typeof c.heat.start === 'function' && !c.heat.failed;
    if (h && !h.god && !h.dead) st.wait = dark(h);
    else if (stub) { try { c.heat.start('wreck'); } catch (e) {} st.wait = { t: 0, pend: true }; }     // the body is fetched now; the dark begins when it is in (after())
    else st.wait = { t: 0, own: true };     // no police module (or its god switch): a moment on the wreck, then on foot by the street pad
    st.lights++; say('lights out in the wreck (' + why + ') at ' + heli.mapX.toFixed(0) + ', ' + heli.mapY.toFixed(0) + ', height ' + f.pos.y.toFixed(1) + '; hardest hit ' + v.toFixed(1) + ' m/s');
  }
  function onFoot() {     // after lights out: the camera and the figure go back to the man on foot, wherever the wake-up put him
    const pl = g.player; heli.hasCamera = false; g.cam.mode = 'foot'; pl.vis.object.visible = true; pl.alt = 0; pl.roof = null; pl.speed = 0; st.wait = null;
    try { g.playerAnim('idle'); g.snapCamera(); } catch (e) {}
  }
  function thrown(p, cx, cy, v) {
    const pl = g.player, c = g.combat;
    heli.piloted = false; heli.hasCamera = false; heli.insideView = false; g.cam.mode = 'foot';
    pl.x = p.x; pl.y = p.y; pl.h = p.a; pl.alt = 0; pl.roof = null; pl.speed = 0; heli._rx = pl.x; heli._ry = pl.y; pl.vis.object.visible = true;
    try { g.playerAnim('idle'); g.snapCamera(); g.cam.yaw = Math.atan2(cy - pl.y, cx - pl.x); g.cam.lookT = 0; g.placeCamera(0); } catch (e) {}
    let n = Math.max(0, (v - 4) * 5); if (c && typeof c.hurt === 'function' && n > 0) { if (!c.heat || c.heat.failed) n = Math.min(n, Math.max(0, c.health - 5));     /* with no police module nothing handles a death: he keeps a sliver */ c.hurt(n);
      /* a hurt that kills, while the police module is still its small stand-in: the stand-in fetches the body on this hurt, but his health was climbing back before the body's first look at it
         (laptops 1 and 3, Nov 14: 52 m/s, hurt 242, alive). Held at nothing until the body is in and has taken the death (after()). */
      if (c.health <= 0 && !heat() && c.heat && !c.heat.failed) st.kill = { t: 0, seen: 0 }; }
    st.thrown++; say('thrown clear at ' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + '; hardest hit ' + v.toFixed(1) + ' m/s, hurt ' + n.toFixed(0));
  }
  function after(dt, v0) {
    const pl = g.player;
    if (st.kill) { const K = st.kill, c = g.combat, h = heat(); K.t += dt; if (h) { if (h.dead || h.god || (K.seen += dt) > 1) st.kill = null; else { c.health = 0; if (!K.hit) { K.hit = true; c.hurt(1); } } }     /* the body is in: one more hurt THROUGH it, so that it dates the hurt (its own health-comes-back rule runs before its death check) */ else if (K.t > 6 || !c.heat || c.heat.failed) st.kill = null; else c.health = 0; }
    if (st.wait) {
      let D = st.wait; const h = heat();
      if (D.pend) { D.t += dt; if (h && !h.dead && !h.god) D = st.wait = dark(h); else if (D.t > 5 || (h && h.god) || (g.combat.heat && g.combat.heat.failed)) { D.pend = false; D.own = true; D.t = 0; } return; }
      if (D.own) D.t += dt;
      if (D.own ? D.t > 3 : (!h || h.dead !== D || D.woke)) { if (D.own) { const p = heli.pads[0]; pl.x = p.x + 9; pl.y = p.y; } onFoot(); }
      return;
    }
    if (f.damage < 1) { st.crashV = 0; st.still = 0; st.touch = 0; st.age = 0; return; }
    st.age += dt;
    if (!heli.piloted) {     // an empty wreck far behind him: a fresh aircraft on the street pad
      if (st.age > 20 && !heli.busy && !heli.director && (f.wreckRest || f.contactN > 0)) { const p = heli.pads[0]; if (Math.hypot(pl.x - heli.mapX, pl.y - heli.mapY) > 250 && Math.hypot(pl.x - p.x, pl.y - p.y) > 150) { heli.pose({ pad: 0 }); st.crashV = 0; st.age = 0; st.fresh++; say('a fresh helicopter stands on the street pad'); } }
      return;
    }
    if (heli.busy) return;
    if (f.hits.length && v0 > st.crashV) st.crashV = v0;     // the speed it had going into the hardest hit
    st.still = (f.contactN > 0 || f.wreckRest) && f.vel.lengthSq() < 9 ? st.still + dt : 0; if (f.contactN > 0 || f.hits.length) st.touch += dt;
    if (!f.wreckRest && st.still < 0.6 && st.touch < 8) return;     // at rest, or nearly still on a surface for 0.6 s, or eight seconds of grinding down something: he is not kept in it longer
    const cx = heli.mapX, cy = heli.mapY, under = H.top(cx, cy, f.pos.y + 1.2), v = st.crashV;
    if (under > 0.5 || f.pos.y > 9) return lightsOut(under > 0.5 ? 'on a roof at ' + under.toFixed(0) + ' m' : 'hung up above the street', v);
    if (!g.bounds.in(cx, cy, -3)) return lightsOut('outside the playable box', v);
    const p = spot(cx, cy); if (!p) return lightsOut('no open ground beside it', v);
    thrown(p, cx, cy, v);
  }
  return st;
}
