// bus/bus.js (bus lane, Nov 15): the city buses. install(game) from ONE line in game.js (tools/patch.py puts it before the streets layer is
// built, so the real stops are known when the street furniture is placed); ?bus=0 leaves all of it out (nothing fetched).
//   net.js    the routes of assets/bus/routes.json (open GTFS data: where the buses run and stop) matched to the loaded map's blocks
//   fleet.js  the buses in traffic: timetable, stops, kerb, kneel, doors
//   ride.js   the player: board, sit, ride, ring, get off, take the wheel
//   look.js   everything drawn of a bus (look0.js: a plain stand-in if it is missing)     stops.js / sound.js: poles, shelters, red lanes; engine, doors, chime, voice
// Switches: ?bus=0 off   ?bustime=K timetable K times faster than the real one (default 5)   ?busmax=N buses alive at once (10)
//           ?buslook=0 the stand-in box   ?busstops=0 the street furniture's own rule-placed stops stay   ?bussound=0   ?busdbg=1 (window.__bus)
import { buildNet } from './net.js';
import { Fleet } from './fleet.js';
import { dimsFrom } from './dims.js';

export async function install(game) {
  const g = game, P = g.P, opt = (k, d) => (P && P.get && P.get(k) !== null && P.get(k) !== undefined ? P.get(k) : d), headless = typeof document === 'undefined' || !g.world.renderer || !g.world.renderer.getContext;
  const S = (g.bus = { on: true, fails: {}, err(where, e) { S.fails[where] = (S.fails[where] || 0) + 1; if (S.fails[where] <= 3) console.warn('[bus] ' + where + ': ' + (e && (e.stack || e.message) || e)); } });
  const data = g.busData || await (await fetch('assets/bus/routes.json', { cache: 'no-cache' })).json();
  const t0 = performance.now(), net = (S.net = buildNet(g, data)); S.netMs = performance.now() - t0;
  if (!net.lines.length) { console.log('[bus] no route crosses this map'); S.on = false; return S; }
  // the model (its measures first: seats, doors, aisle)
  let lookMod = null;
  if (!headless) { if (opt('buslook', '1') !== '0') { if (opt('busart', '1') !== '0') try { lookMod = await import('./busart.js'); } catch (e) { S.err('busart.js', e); }      /* busart lane: the Blender-built exterior (assets/bus/XD*.glb) over look.js, which stays the cabin, the doors and the kneel; ?busart=0 = look.js alone, the four models not fetched */
      if (!lookMod) try { lookMod = await import('./look.js'); } catch (e) { S.err('look.js', e); } } if (!lookMod) try { lookMod = await import('./look0.js'); } catch (e) { S.err('look0.js', e); } }
  const D = (S.dims = dimsFrom(lookMod && lookMod.DIMS));
  // every destination sign that can be asked for
  const signs = [], sk = new Map(); for (const L of net.lines) { const k = L.num + '|' + L.sel + '|' + L.head + '|' + L.via; if (!sk.has(k)) { sk.set(k, signs.length); signs.push({ num: L.num, sel: L.sel, ltd: L.ltd, head: L.head, via: L.via }); } L.signI = sk.get(k); }
  S.signs = signs;
  const fleet = (S.fleet = new Fleet(g, net, D));
  S.stops = net.stops.filter((s) => s.kx !== undefined).map((s) => ({ i: s.i, x: s.px, y: s.py, h: s.h, name: s.n, routes: s.routes, sel: !!s.sel, shelter: s.kerb && (s.sel || s.routes.length > 1 || (s.i * 7919) % 10 < 4), kx: s.kx, ky: s.ky, kerb: s.kerb }));
  // the lines of people at the stops (the people lane's queue hook: game.queues rows, kind 'wait')
  if (opt('busqueues', '1') !== '0') { if (!g.queues) g.queues = []; for (const s of S.stops) if (s.kerb) g.queues.push({ id: 'bus:' + s.i, name: s.name, kind: 'wait', x: s.x - Math.sin(s.h) * 0.5 + Math.cos(s.h) * 1.2, y: s.y + Math.cos(s.h) * 0.5 + Math.sin(s.h) * 1.2, face: s.h + Math.PI / 2, n: s.sel || s.routes.length > 2 ? [3, 7] : [1, 4], dir: [-Math.cos(s.h), -Math.sin(s.h)] }); }
  // hints: one chip, the key in amber as the game's own prompts have it
  let chip = null, chipOn = false;
  const ui = (S.ui = {
    err: S.err,
    hint(txt, k) { if (headless) { S.hintText = txt; return; } if (!chip) { chip = document.createElement('div'); chip.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:40;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.74);padding:7px 13px;border-radius:8px;pointer-events:none;display:none;white-space:nowrap'; document.body.appendChild(chip); }
      S.hintText = txt; if (txt) { const h = (k ? '<span style="background:#ffd27a;color:#111;border-radius:4px;padding:1px 7px;margin-right:8px">' + k + '</span>' : '') + txt.replace(/[<&]/g, ''); if (chip._t !== h) { chip._t = h; chip.innerHTML = h; } chip.style.display = ''; chipOn = true; } else if (chipOn) { chip.style.display = 'none'; chipOn = false; } },
    hintOwner: () => chipOn,
  });
  let ride = null; if (!headless || opt('busride', '0') === '1') try { ride = S.ride = (await import('./ride.js')).addRide(g, fleet, ui); } catch (e) { S.err('ride.js', e); }
  if (!headless) {
    try { S.look = await lookMod.makeLook(g, { signs, cap: 12 }); } catch (e) { S.err('makeLook', e); try { S.look = await (await import('./look0.js')).makeLook(g, { signs, cap: 12 }); } catch (e2) { S.err('look0', e2); } }
    if (opt('busstops', '1') !== '0') try { const m = await import('./stops.js'); S.stopLook = await m.makeStops(g, S.stops); g.busStopsOwn = true; if (m.makeLanes && opt('buslanes', '1') !== '0') { const runs = []; for (const L of net.lines) if (L.sel) runs.push({ key: L.key, seq: L.seq }); S.lanes = await m.makeLanes(g, runs); } } catch (e) { if (!/Failed to fetch dynamically|Cannot find module|404/.test(String(e && e.message))) S.err('stops.js', e); }
    if (opt('bussound', '1') !== '0') try { S.sound = (await import('./sound.js')).makeSound(g); ui.sound = S.sound; } catch (e) { if (!/Failed to fetch dynamically|Cannot find module|404/.test(String(e && e.message))) S.err('sound.js', e); }
  }
  // what the rider hears: the chime, the next stop, the doors
  const say = (kind, B, st) => { try { if (S.sound && S.sound.say) S.sound.say(kind, st && st.stop ? { name: st.stop.n, i: st.stop.i } : null, B.line || B.last); } catch (e) { S.err('say', e); } };
  ui.onRing = (B, st) => { try { S.sound && S.sound.chime && S.sound.chime(); } catch (e) {} };
  ui.onBoard = (B) => { const st = fleet.nextStop(B); S.aboard = B; if (B.line) say('route', B, null); if (st && B.state !== 'dwell') S.sayT = 5.5; };
  ui.onLeave = () => { S.aboard = null; };
  fleet.onDepart = (B) => { if (B.aboard) { S.sayT = Math.max(S.sayT || 0, 2.2); } };
  // people getting off and on (the crowd's own people; people.js)
  let people = null; if (opt('buspeople', '1') !== '0') try { people = S.people = (await import('./people.js')).addPeople(g, fleet); fleet.count = people.count; } catch (e) { S.err('people.js', e); }
  fleet.onArrive = (B, st) => { if (people) people.arrive(B, st); if (B.aboard) say(B.ni === B.line.stops.length - 1 ? 'last' : 'this', B, st); };

  // the player's own bus opens its doors: at a stop (the front door within 16 m of a pole) people get off and on, as for any bus
  ui.onPlayerDoors = (B, open) => { try {
    if (!open) { B.riders = Math.max(0, Math.min(60, B.riders - (B.off || 0) + (B.on || 0))); B.on = B.off = 0; return; }
    const d = fleet.door(B, 'front', 0.6); let best = null, bd = 16; for (const s of S.stops) { const q = Math.hypot(s.x - d[0], s.y - d[1]); if (q < bd) { bd = q; best = s; } } if (!best || !people) return;
    B.off = Math.min(B.riders, Math.floor(Math.random() * 4)); B.dwellT = 0; people.arrive(B, { stop: { i: best.i, n: best.name }, px: best.x, py: best.y });
  } catch (e) { S.err('player doors', e); } };
  // aboard: a strip at the top like the bus's own inside sign: the route, the next stop, STOP REQUESTED
  let strip = null, stripT = 0, stripTxt = '';
  const showStrip = (dt) => { if (headless) return; stripT -= dt; if (stripT > 0) return; stripT = 0.25; const B = S.aboard; let txt = '';
    if (B) { const L = B.line || B.last, st = B.state === 'dwell' ? B.stopAt : fleet.nextStop(B); txt = (L ? '<b>' + L.num + (L.sel ? '+' : '') + '</b> ' + (B.line ? L.head : 'Not in service') : '') + (B.line && st ? ' &nbsp;·&nbsp; ' + (B.state === 'dwell' ? '' : 'Next: ') + st.stop.n.replace(/[<&]/g, '') : '') + (B.stopReq ? ' &nbsp;<span style="color:#ff5a45">STOP REQUESTED</span>' : ''); }
    if (txt === stripTxt) return; stripTxt = txt; if (!strip) { strip = document.createElement('div'); strip.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:40;font:600 15px ui-monospace,Menlo,monospace;letter-spacing:.5px;color:#ffb21e;background:rgba(10,10,8,.82);padding:7px 16px;border-radius:6px;pointer-events:none;display:none;white-space:nowrap;text-shadow:0 0 6px rgba(255,150,0,.5)'; document.body.appendChild(strip); }
    strip.innerHTML = txt; strip.style.display = txt ? '' : 'none'; };
  // ------------------------------------------------------------------ the game's loop
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    if (S.on) { try { fleet.update(dt); } catch (e) { S.err('fleet', e); } if (people) people.step(dt); if (ride) try { ride.step(dt); } catch (e) { S.err('ride', e); }
      try { showStrip(dt); } catch (e) { S.err('strip', e); }
      if (S.sayT > 0 && (S.sayT -= dt) <= 0 && S.aboard) { const st = fleet.nextStop(S.aboard); if (st) say('next', S.aboard, st); } }
    return step0(dt);
  };
  if (!headless) {
    const sync0 = g.syncVisuals.bind(g), b = {};
    g.syncVisuals = function (dt) {
      sync0(dt); const L = S.look; if (!L) return;
      try {
        const cam = g.world.camera, cx = cam.position.x, cy = -cam.position.z, N = g.night, night = N && typeof N.n === 'number' ? N.n : N && typeof N.night === 'number' ? N.night : 0; L.begin();
        for (const B of fleet.buses) { if (!B.c && !B.v) continue; const d = Math.hypot(B.x - cx, B.y - cy); if (d > 340) continue;
          b.x = B.x; b.y = B.y; b.z = B.z || 0; b.h = B.h; b.roll = B.roll; b.pitch = B.pitch; b.kneel = B.kneel; b.doorF = B.doorF; b.doorR = B.doorR; b.spin = B.spin; b.steer = B.steer; b.brake = B.brake; b.sign = B.sign; b.stopReq = !!B.stopReq; b.inside = !!B.aboard && !!(ride && (ride.mode === 'stand' || ride.mode === 'sit')); b.riders = clamp01(B.riders / 40); b.night = night; b.d = d; b.blink = B.blink; b.no = B.no; b.id = B.id; b.v = B.v0 || 0; L.add(b);
          if (S.sound && S.sound.bus && d < 90) { b.acc = B.acc; b.state = B.state; S.sound.bus(b, dt); } }
        L.end(); if (S.stopLook && S.stopLook.update) S.stopLook.update(cx, cy); if (S.sound && S.sound.frame) S.sound.frame(dt);
      } catch (e) { S.err('draw', e); }
    };
  }
  S.report = () => Object.assign(fleet.report(), { net: net.rep, netMs: +S.netMs.toFixed(0), fails: S.fails, ride: ride && ride.stats, people: people && people.kn, hint: S.hintText, look: S.look && S.look.stats && S.look.stats() });
  if (opt('busdbg', '0') === '1' && typeof window !== 'undefined') window.__bus = S;
  console.log('[bus] ' + net.lines.length + ' lines on this map (' + (net.rep.m / 1000).toFixed(0) + ' km), ' + S.stops.length + ' stops, matched in ' + S.netMs.toFixed(0) + ' ms' + (lookMod ? '' : '; no look'));
  return S;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
