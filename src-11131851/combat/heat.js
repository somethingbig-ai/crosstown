// combat/heat.js: the police and the wanted level ("heat"), the part that is there from the start. It is small on purpose.
//   Until the player does something the law cares about, the game pays for this file and nothing else: no work per frame, nothing
//   drawn, nothing more fetched. It listens at six places the game already calls (a shot, the player being hurt, a person run over,
//   a driver's car taken, a crash, a car blown up) and on the first of them fetches the body of the feature (heatcore.js, which
//   fetches heatcar.js) and hands it what happened. From then on heatcore.js does everything and these listeners only pass through.
//   Some seconds after the game is playable the two files are also fetched in an idle moment (not started), so that the first shot
//   does not wait for the network.
//   ?heat=0 (or none)  off        ?heatnow=1  start the body at once (tests)        ?heatlog=1  numbers in the console
// Combat.init's one line calls addHeat(game, combat) and keeps what it returns as combat.heat; once the body runs, combat.heat is the body.
export async function addHeat(game, combat) {
  const P = game.P, sw = P.get('heat'); if (sw === '0' || sw === 'none') return null;
  const g = game, c = combat, S = { level: 0, pts: 0, seen: false, cops: [], cars: [], core: null, lite: true, loading: null, queue: [], stats: null };
  const start = (why) => S.loading || (S.loading = (async () => {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const H = await (await import('./heatcore.js')).addHeat(g, c); if (!H) return null;
    S.core = H; c.heat = H; for (const q of S.queue) { try { if (q[0] === 'crash') H.onCrash(q[1], q[2]); else H.crime(q[0], q[1], q[2]); } catch (e) {} } S.queue.length = 0;
    if (P.has('heatlog')) console.log('[heat] body started on ' + why + ' in ' + Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0) + ' ms');
    return H;
  })().catch((e) => { console.log('[heat] not loaded: ' + (e && e.message)); S.failed = true; return null; }));
  S.start = start;
  const need = (kind, a, b) => { if (S.core || S.failed) return; if (kind && S.queue.length < 8) S.queue.push([kind, a, b]); start(kind || 'hurt'); };
  if (P.has('heatnow') || P.has('heatqa') || P.has('script') || P.has('heatlog')) { await start('asked'); return S.core || S; }
  const pl = () => g.player;
  const shoot0 = c.shoot.bind(c); c.shoot = function (W, am) { const r = shoot0(W, am); if (!S.core) need('shots', pl().x, pl().y); return r; };
  const hurt0 = c.hurt.bind(c); c.hurt = function (n) { const r = hurt0(n); if (!S.core) need(null); return r; };
  const ex0 = c.explode.bind(c); c.explode = function (v, X) { const r = ex0(v, X); if (!S.core) need(null); return r; };
  const ph0 = g.onPedHit.bind(g); g.onPedHit = function (p, v) { const r = ph0(p, v); if (!S.core && v === pl().vehicle && !v.bullet) need('runover', p.x, p.y); return r; };
  const te0 = g.tryEnter.bind(g); g.tryEnter = function () { if (S.core) return te0(); let n = null; try { n = g.nearestCar(); } catch (e) {} const ok = te0(); if (ok && n && n.kind === 'traffic') need('jack', pl().x, pl().y); return ok; };
  if (typeof g.onCrash === 'function') { const cr0 = g.onCrash.bind(g); g.onCrash = function (v, f) { const r = cr0(v, f); if (!S.core && v === pl().vehicle && f > 7.5) need('crash', v, f); return r; }; }
  /* the two files, fetched (not started) in an idle moment once the game has been playable for a while */
  if (typeof window !== 'undefined' && typeof setTimeout === 'function' && typeof document !== 'undefined' && document.visibilityState !== undefined) {
    let n = 0; const tick = () => { if (S.core || S.loading || S.failed) return; if (!(window.__ready && !window.__warming) || ++n < 4) { setTimeout(tick, 5000); return; }
      const go = () => { import('./heatcore.js').catch(() => {}); import('./heatcar.js').catch(() => {}); }; if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else go(); };
    setTimeout(tick, 5000);
  }
  return S;
}
