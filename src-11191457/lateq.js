// lateq.js (perf lane, Nov 18): ONE QUEUE FOR EVERYTHING THAT COMES DOWN AFTER READY. Seven "late" patches (lateshells, lateasph, lateslabs, latecabin, latetex,
// lateheli, lateground) each fetch their files right after ready. Alone, each is fine; together they put about 55 MB on the line at the same instant in no order,
// so on a slow line the road a player stands on could land last. With this module each patch ASKS FOR A TURN before every download and the turns are given in a
// stated order, at most two downloads at a time:
//   0 road      what is under the feet: asph_col, asph_nrm (lateground), asph_macro4k (lateasph)
//   1 walls     wall relief, then the dressing's relief (latetex)
//   2 near      by metres from the player: the lightmap slabs whose edge is within FAR m (lateslabs: the start's two neighbours), the photographed crossings (lateground)
//   3 heli      the helicopter's skin pictures (lateheli)
//   4 far       the far shells, nearest set first (lateshells): whole buildings 690 m and more away
//   5 later     by metres: the world's own road relief (latetex: drawn only 343 m and more away, where the low file is already exact), lightmap slabs beyond FAR m
//               (those came after ready before the late patches too)
//   6 cabin     the built cockpit (latecabin)
//   heli and cabin jump to just behind the road (0.5) while the player is within NEARH m of the helicopter.
// Inside a rank the smaller distance goes first, then who came first. Each patch keeps ONE LANE here (lane(): its files go one after another, as they did; latetex's lane may have two on the line) or asks
// once (run(): the road scan, the cabin). A lane's kind and distance are FUNCTIONS of the file it would fetch next, read again every time a turn is given: so the
// order follows the player (a slab or a shell set the player has driven toward moves up) with nothing to re-sort. A download already on the line is not stopped.
// A job calls free() the moment its bytes are in, so the line goes to the next download while the file is still being unpacked or sent to the card.
// (Nov 18, after the first browser run: four jobs kept their turn through the picture decode, the KTX2 transcode or the GLB parse, because the loader they used does
// download and unpacking in one call. LQ.img / LQ.ktx / LQ.bytes below fetch the bytes, give the line back, THEN decode.)
// A STALLED PAGE: a turn can only be handed on by the main thread. Where that thread is busy for seconds at a stretch (software graphics: tasks of 4 to 25 s after ready
// on a Dell seat) each hand-over waits for the gap between two long tasks, so two downloads a gap was all the queue moved while the line stood idle. When the
// queue's own 250 ms timer comes more than STALL ms late after ready, the queue runs twice as wide (2 x max) for WIDEMS: same order, more of it on the line. On a
// machine that keeps its frames this never happens. ?lateqwide=0 off. LQ.wide = how many times.
// Nothing is given a turn before window.__ready (and a patch's own ?late...=hold gate); the first two turns are given in the very task that sets ready (main.js
// sends 'nyc-ready'), because the patches come here BEFORE ready and wait.
//   ?lateq=0        this file is never fetched and window.__lateq is not there: every patch fetches on its own, exactly as it does alone.
//   ?lateqn=<n>     downloads at a time (2).   ?lateqfar=<m>  FAR (600).   Each patch's own ?late...=0 still takes that patch out altogether.
// window.__lateq: { max, active, lanes, log: [[name, kind, rank, came s, turn s, line free s, done s]] }.
const RANK = { road: 0, walls: 1, near: 2, heli: 3, far: 4, later: 5, cabin: 6 }, NEARH = 40, HOLDMS = 90000, STALL = 1000, WIDEMS = 5000;
export function installLateQ(P) {
  if (window.__lateq) return window.__lateq;
  const num = (k, d) => { const v = P && P.get(k); return v != null && v !== '' && isFinite(+v) ? +v : d; }, sec = () => +(performance.now() / 1000).toFixed(2);
  const lanes = [], LQ = (window.__lateq = { on: true, max: Math.max(1, Math.min(8, Math.round(num('lateqn', 2)))), FAR: num('lateqfar', 600), active: 0, lanes, log: [], heliDist: null, RANK, wide: 0, wideT: 0 });
  const val = (v) => { try { return typeof v === 'function' ? v() : v; } catch (e) { return undefined; } };
  let iv = 0, lastIv = 0; const wideOn = !(P && P.get('lateqwide') === '0'), cap = () => LQ.max * (performance.now() < LQ.wideT ? 2 : 1);
  const beat = () => { const n = performance.now(); if (wideOn && window.__ready && lastIv && n - lastIv > 250 + STALL) { if (n >= LQ.wideT) LQ.wide++; LQ.wideT = n + WIDEMS; } lastIv = n; pump(); };
  // has this lane something to fetch now? (a lane has one download on the line at a time, or spec.par of them)
  /* lead fast-start, Nov 19: LANDMARKS FIRST. While the landmark models are still coming down (hero.js fetches them itself, one at a time, from just before ready) only the road and the wall relief take turns here; everything of rank 2 and more waits for them, 25 s after ready at most. ?herofirst=0 = as before */
  const HF = !(P && P.get('herofirst') === '0'), heroHold = (w) => { if (!HF) return false; const hs = window.world && window.world.heroState; if (!hs || !hs.late || hs.done) return false; if (performance.now() / 1000 - (window.__readyAt || 1e9) > 25) return false; const k = val(w.spec.kind); return (k in RANK ? RANK[k] : RANK.far) >= 2; };
  const wants = (w) => w.busy < (w.spec.par || 1) && (w.once ? !w.done : !!val(w.spec.more)) && (!w.spec.gate || !!val(w.spec.gate)) && !heroHold(w);
  // the smaller the sooner
  const score = (w) => { const k = val(w.spec.kind), d = +val(w.spec.d); let r = k in RANK ? RANK[k] : RANK.far;
    if ((k === 'cabin' || k === 'heli') && LQ.heliDist) { const h = +val(LQ.heliDist); if (h < NEARH) r = 0.5; }
    w.kind = k; w.rank = r; return r * 1e6 + (d > 0 ? Math.min(d, 999999) : 0); };
  LQ.order = () => lanes.filter(wants).map((w) => [score(w), val(w.spec.name) || '', w.kind]).sort((a, b) => a[0] - b[0]);     // tests: who would go next, in order
  function start(w) {
    LQ.active++; w.busy++; if (w.once) w.done = true; let freed = false; const rec = [val(w.spec.name) || '', w.kind, w.rank, w.t, sec(), null, null]; LQ.log.push(rec);
    // free(): the bytes are in and the line can take the next download. A job calls it as early as it can; it is called for it when the job ends, and after
    // HOLDMS whatever happens, so a download that hangs cannot stop the rest.
    const free = () => { if (freed) return; freed = true; clearTimeout(wd); LQ.active--; w.busy--; rec[5] = sec(); if (w.once) { const i = lanes.indexOf(w); if (i >= 0) lanes.splice(i, 1); } pump(); }, wd = setTimeout(free, HOLDMS);
    free.as = (name) => { rec[0] = name; };
    let p; try { p = Promise.resolve(w.job(free)); } catch (e) { p = Promise.reject(e); }
    p.then((v) => { rec[6] = sec(); free(); if (w.res) w.res(v); }, (e) => { rec[6] = sec(); rec.push('failed: ' + (e && e.message)); free(); if (w.rej) w.rej(e); else console.log('[lateq] ' + rec[0] + ': ' + (e && e.message)); });
  }
  function pump() {
    if (!window.__ready) return;
    while (LQ.active < cap()) {
      let best = null, bs = Infinity;
      for (const w of lanes) { if (!wants(w)) continue; const s = score(w); if (s < bs) { bs = s; best = w; } }     /* lanes are in coming order: the first of equals wins */
      if (!best) break;
      start(best);
    }
  }
  const add = (w) => { w.t = sec(); w.busy = 0; lanes.push(w); if (!iv) iv = setInterval(beat, 250);     /* the net: ready without the event, a hold gate that opened, a lane that has a new file, the player moved toward something */ pump(); };
  // spec: { kind, d, name, gate, more, par }: each a value or a function, read when a turn is given.
  // lane(spec, job): a standing lane. While spec.more() is true it gets turns; at each turn job(free) fetches the lane's next file.
  LQ.lane = (spec, job) => add({ spec, job });
  // run(spec, job): one turn. Resolves with what job(free) returns, or rejects with its error.
  LQ.run = (spec, job) => new Promise((res, rej) => add({ spec, job, res, rej, once: true }));
  LQ.poke = pump;
  // the bytes first, the unpacking outside the turn: a job hands its free() to one of these
  LQ.bytes = async (url, blob) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return blob ? r.blob() : r.arrayBuffer(); };
  // a picture as an <img>, decoded (what `im.src = url; await im.decode()` gives)
  LQ.img = async (url, free) => { const b = await LQ.bytes(url, true); if (free) free(); const u = URL.createObjectURL(b), im = new Image(); try { im.src = u; await im.decode(); } finally { URL.revokeObjectURL(u); } return im; };
  // a KTX2 file through the game's own loader k (what k.loadAsync(url) gives)
  LQ.ktx = async (k, url, free) => { const b = await LQ.bytes(url); if (free) free(); return new Promise((res, rej) => k.parse(b, res, rej)); };
  addEventListener('nyc-ready', pump);
  return LQ;
}
