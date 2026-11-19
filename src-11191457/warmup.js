// warmup.js (light lane, Nov 15): part of a first visit's shader cost taken off the first drawn frames. ?warmup=0 = the old way (this file is never fetched).
// MEASURED (lanes/light/firstload/STATE.md; M2 Max, shader programs the machine had never seen): the compile-ahead step in main.js links the main pass's
// programs as one batch, and the browser builds a batch about seven at once (172 programs in 3 s; one at a time they cost 20 s). But two more sets of
// programs were never in that batch, so each was linked alone, with the page frozen, at its first draw:
//   - the street mirror (world.updateStreet) draws the same materials through cameras on layer 3, where no lamp and no shadow is counted, so three makes
//     a second program for every material it shows: 48 programs, 5.8 s of the frozen fourth frame;
//   - the picture passes (ambient shade, bloom, history, camera pass, exposure meter) are not in the scene the compile-ahead is given: 19 programs
//     linked alone in the first frame.
// WHAT THIS DOES, around main.js's own compile-ahead step and before the first frame: links those programs too, in the same batch (renderer.compile with the
// mirror's own camera, group by group, and with each pass's own quad), and waits for the batch without freezing the page. Nothing is drawn here and no
// program is different: the same ones are built earlier and side by side. Programs for mirrored things not in view at the start are linked as well
// (about 37 more on Nov 15): they were going to be linked, alone, the first time the mirror saw them during play.
// NOT DONE HERE (measured, see STATE.md): building each program's pipeline at its first draw (6 to 7 s of the first frame on a first visit) stays where it
// is. Drawing unseen while game.init() runs did not work: a lamp that joins the scene late in init changes every lit program, so 200 programs linked
// early were thrown away, and the page stood still in the unseen draws instead.
import * as THREE from 'three';

export function startWarmup(world, renderer, P) {
  const r = renderer, S = { mirror: 0, quads: 0, errors: 0 }; let lastErr = '';
  const fail = (where, e) => { S.errors++; lastErr = where + ': ' + (e && e.message); if (S.errors <= 3) console.warn('[game] warm-up ahead, ' + lastErr); };
  // what the street mirror draws: the same test world.updateStreet uses to put groups on layer 3
  const mirrored = (top) => top === world.skyMesh || top.userData.streetCube || (P.get('scars') === '0' ? /^(streets_ground|streets_trees)/ : /^(streets_ground|streets_trees|streets_vehicles|st_furniture)/).test(top.name || '');
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  let t0 = 0, n0 = 0;
  // early (handoff15, ?warmearly=1 to try; off unless asked): while game.init() runs (9 s of page work on an M2 Max, and the downloads on a real visit) the
  // graphics process has nothing to do. Every 2.5 s or so, whatever is in the scene by then is LINKED (not drawn): the main pass's programs and the
  // mirror's. The one lamp that joins at the very end of init (combat/fx.js: the muzzle flash, a PointLight without shadow) is stood in for during each
  // call, because one more lamp changes every lit program; if the lamps ever change, the early programs are simply not the ones used, and the line
  // printed by finish() says how many the compile-ahead step still had to add.
  const E = (S.early = { passes: 0, added: 0, ms: 0, on: false, arm: 0 }); let earlyT = 0;
  // handoff17 (light, Nov 15): THE WINDOWS TRIAL. Telemetry (lanes/light/win/): on Direct3D the batch takes a median 30 to 60 s where a Mac takes 6, while the
  // 30 s of game.init() before it leave the graphics process idle. So for a share of Windows page loads (window.__CFG.warmearly, 0..1, set by the public
  // build; unset = none = today) the early linking is on, and E.arm says which side a load was on so telemetry can compare: 0 not in the trial, 1 forced by
  // ?warmearly=1, 2 trial with early linking, 3 trial without (the comparison side). ?warmearly=0 = never.
  { const q = P.get('warmearly'), share = +(window.__CFG && window.__CFG.warmearly) || 0;
    E.arm = q === '1' ? 1 : q === '0' || !(share > 0) || !/Windows/.test(navigator.userAgent) ? 0 : Math.random() < share ? 2 : 3; }
  // ms a program of an early pass (only where the browser can be asked without waiting, KHR_parallel_shader_compile), so that a REPEAT visit (the machine's
  // shader cache knows them) can still be told by ramp() below although the batch at the end is small after early linking. game.init() holds the page's
  // thread for seconds at a time, so "when were they all ready" cannot be watched from a timer (measured Nov 15 on an M2 Max, repeat visit: all 115 of the
  // first pass were ready within the pass's own 250 ms or just after, and the first timer got to look 570 ms later: 7.8 ms a program, ramp run for
  // nothing). So each pass is looked at the moment it ends, and then from a timer: when k of its programs are ready after T ms the graphics process has
  // provably made k in T, T / k ms each; E.per is the least seen, counted only from a quarter of the pass (8 at least), so a few that were known already
  // cannot speak for the rest. Measured: repeat 3.6 (69 of 115 ready at the pass's end), first visit 22 to 37 (1 of 64 at the pass's end).
  const watches = [];
  const perWatch = (t, n) => { let par = null; try { par = r.getContext().getExtension('KHR_parallel_shader_compile'); } catch (e) {} const ps = (r.info.programs || []).slice(n), need = Math.max(8, ps.length / 4); if (!par || ps.length < 8) return;
    let timer = 0, done = false;
    const look = () => { if (done) return; clearTimeout(timer); let k = 0; try { for (const p of ps) if (!p.usedTimes || p.isReady()) k++; } catch (e) { done = true; return; }
      const T = performance.now() - t; if (k >= need) { const v = +(T / k).toFixed(1); if (E.per === undefined || v < E.per) E.per = v; }
      if (k >= ps.length || T > 120000) done = true; else timer = setTimeout(look, 50); };
    watches.push(look); look(); };
  // handoff18 (light, Nov 15): THE SHOP-OPENING COPY OF THE BUILDING FRONT, EARLY. Measured on a Windows machine (lanes/light/win/WINBOX.md): Direct3D takes 30 to
  // 50 s of one core for each of the three building-front programs; two are on the tiles and are linked by the first early pass, the third (interiors.js's
  // copy that cuts the shop openings) was only made at the very end of game.init(), so the step after init waited about 34 s for it alone. With early
  // linking on, the copy and its tiny warm-up mesh are now made here, before game.init() (interiors/hole.js earlyHole), the next early pass links it, and
  // interiors.js takes that same material and mesh (world.__shopHole). If interiors.js never takes it, begin() removes it again. Only with early linking;
  // ?holeearly=0 = the copy is made by interiors.js as before. Not made when the address rules the shops or the cut out (?interiors=0, ?ihole=0).
  let HM = null; const holeTry = () => { if (!HM || !E.on || world.__shopHole) return; try { if (HM.earlyHole(world)) E.hole = E.passes + 1; } catch (e) { fail('early hole', e); } };
  // handoff19 (light, Nov 15): THE SHOP-OPENING COPY'S STREET-MIRROR PROGRAM. When a shop comes within range the tiles around it wear the copy, and the street
  // mirror then draws them through its own cameras (no lamp, no shadow): a FOURTH building-front program, which nothing linked ahead. Measured on the
  // Windows machine (lanes/light/handoff19/TESTED.md): the page stood still 26 to 28 s at the first shop, in one call (three asks a program's link result at
  // its first draw, and Direct3D was still compiling it). So wherever the mirror's variants are linked (the early passes, begin()), the copy's tiny
  // warm-up mesh is linked through the mirror's camera too. One more program, none at the shop. ?holemirror=0 = as before.
  // WHEN: linked beside the other three during game set-up it made "ready" 9 s later on that machine (four 40 s compiles next to the page's own work), so
  // by default it is linked right AFTER the wait in finish(): nobody waits for it, it is built behind the start screen and the first minute of play, and
  // late() below does not count it. ?holemirror=1 = with the mirror's other variants, inside the batch (the measured, dearer way).
  const HMQ = P.get('holemirror'), bg = new Set();
  const holeMirror = (fc, after) => { if (HMQ === '0' || (HMQ === '1') === !!after) return; let n = 0; const n1 = r.info.programs ? r.info.programs.length : 0;
    for (const top of world.scene.children) if (/^interiors_warm/.test(top.name || '')) for (const o of top.children) if (o.material && o.material.userData && o.material.userData.shopHole) { try { r.compile(o, fc, world.scene); n++; } catch (e) { fail('hole mirror', e); } }
    if (n) S.holeMirror = n; if (after) for (const p of (r.info.programs || []).slice(n1)) bg.add(p); };
  // handoff22 (light, Nov 15): THE CAP, ON BY DEFAULT WITH EARLY LINKING. Measured on the Windows machine (lanes/light/win/H22.md, H24.md): an early pass that
  // hands Direct3D's compiler every program of the scene at once takes 6 to 7 of 8 cores for seconds, and game set-up beside it is 15 to 20 s slower. So an
  // early pass (0.2 s apart while there is work, else 1 s) hands over the building fronts first and all at once (the 20 to 40 s programs), then other
  // things' materials only while fewer than N programs are still building. N = half the logical cores, 2 at least; ?earlycap=N sets it, ?earlycap=0 = the
  // all-at-once passes of before, statement for statement. capGo hands the compiler up to `room` things whose materials it has not been handed yet (a bag:
  // a plain container listing them, their parents untouched; three's compile only walks .children); capFill repeats that until `lim` programs are
  // building, nothing new is left, or `ms` of page time are gone.
  // A REPEAT VISIT (CH, "the chain"): there is nothing to protect, programs come from the machine's shader cache in a few ms each. While EVERYTHING handed
  // over so far was ready by the next look (the pass's own end, 60 ms later, the next pass), the next pass may hand over four times as much (N, 4N, 16N,
  // 64N things, page time 40, 160, 400 ms), and a batch of 8 programs or more that was all ready T ms after its pass began feeds E.per = T / k as perWatch
  // does. Under 8 ms (ramp()'s own line) the visit is a repeat one: E.fast, and from then on the passes are the all-at-once ones, perWatch and all. On a
  // first visit the building fronts are not ready by the second pass, the chain ends there and the cap holds for good.
  // ROUNDS: a material is handed over once, but its program changes when the lamps in the scene change (and a second kind of mesh can wear it), so when
  // the scene's lamps change, and every 10 s once nothing new is found, the "handed over" marks are dropped and everything is walked again under the
  // same cap (what is built already costs page time only: 40 ms a pass at most). ?earlyround=0 = handed over once, as the H22 trial did.
  const capQ = P.get('earlycap'), CAP = capQ === '-1' ? Math.max(2, Math.round((+navigator.hardwareConcurrency || 8) / 2)) : capQ !== null && capQ !== '' && +capQ >= 0 ? Math.floor(+capQ) : 0;     /* handoff22b (light, Nov 15): the cap is OFF unless ?earlycap=N: players' Windows loads did not show the box's gain (step longer, ready no sooner); ?earlycap=-1 = half the cores as handoff22 had it */
  let capA = new WeakSet(), capM = new WeakSet(), capSig = null, capT = 0, capIdle = false; E.cap = CAP; E.capMax = 0; E.rounds = 0; const ROUND = P.get('earlyround') !== '0';
  const CH = { on: CAP > 0, grow: 1, ps: null, t: 0 }; let capPar = null;
  const chainLook = () => { if (!CH.on || !CH.ps) return; let k = 0; try { for (const p of CH.ps) if (!p.usedTimes || p.isReady()) k++; } catch (e) { CH.on = false; return; } if (k < CH.ps.length) return;
    const T = performance.now() - CH.t; if (k >= 8) { const v = +(T / k).toFixed(1); if (E.per === undefined || v < E.per) E.per = v; if (v < 8) { E.fast = E.passes; CH.on = false; } } CH.ps = null; CH.grow = Math.min(64, CH.grow * 4); };
  const capGo = (seen, cam, tops, room, only) => { const bag = new THREE.Object3D(); for (const top of tops) top.traverse((o) => { if (bag.children.length >= room || !(o.isMesh || o.isPoints || o.isLine) || !o.material || (only && !only(o))) return; const ms = [].concat(o.material); if (ms.every((m) => !m || seen.has(m))) return; for (const m of ms) if (m) seen.add(m); bag.children.push(o); }); if (bag.children.length) r.compile(bag, cam, world.scene); return bag.children.length; };
  const capFill = (seen, cam, tops, b, lim, ms) => { let size = Math.max(1, lim - b), k = 1; const t1 = performance.now(); while (b < lim && k && performance.now() - t1 < ms) { const n1 = r.info.programs.length; k = capGo(seen, cam, tops, size); const got = r.info.programs.length - n1; b += got; size = got ? Math.max(1, lim - b) : Math.min(32, size * 2); } return [b, k]; };
  const earlyPass = () => { if (!E.on) return; holeTry(); const t = performance.now(), n = r.info.programs ? r.info.programs.length : 0, old = r.getRenderTarget(); let lamp = null, more = false;
    if (capPar === null) { try { capPar = !!r.getContext().getExtension('KHR_parallel_shader_compile'); } catch (e) { capPar = false; } if (!capPar) { CH.on = false; E.cap = 0; } }     /* a browser that cannot be asked "is it built yet" without waiting: no count, so no cap */
    if (CAP && capPar && !E.fast) { chainLook(); if (CH.on && CH.ps) CH.on = false; }     /* the last batch is still building at this pass: a first visit, the cap holds from here on */
    const capped = CAP && capPar && !E.fast;
    try { let has = false; const sig = []; world.scene.traverse((o) => { if (o.isPointLight) has = true; if (o.isLight) sig.push(o.type + (o.castShadow ? 1 : 0) + (o.visible ? 1 : 0)); });
      if (!has) sig.push('PointLight01');
      if (!has) { lamp = new THREE.PointLight(0xffc27a, 0, 16, 2); lamp.castShadow = false; world.scene.add(lamp); }
      const fc = !world.streetOff && !world.streetFull && world.streetCam && world.streetRT ? world.streetCam.children[0] : null;
      if (capped) {     /* never more than N programs building at once, so the graphics process does not take every core in bursts */
        const lim = CH.on ? CAP * CH.grow : CAP, ms = CH.on ? Math.min(400, 40 * CH.grow) : 40, sg = sig.sort().join(' ');
        if (capSig === null) { capSig = sg; capT = t; } else if (ROUND && (sg !== capSig || (capIdle && t - capT > 10000))) { capA = new WeakSet(); capM = new WeakSet(); capSig = sg; capT = t; capIdle = false; E.rounds++; }
        // the building fronts first and all at once (three or four programs, the longest by far: 20 to 40 s each), whatever the cap says
        const isTile = (o) => !!(o.userData && o.userData.tile), isHeavy = (o) => isTile(o) || !!(o.material.userData && o.material.userData.shopHole);
        r.setRenderTarget(world.composer.readBuffer); capGo(capA, world.camera, [world.scene], 99, isHeavy);
        if (fc) { const m0 = fc.layers.mask; fc.layers.set(3); r.setRenderTarget(world.streetRT, 0); try { capGo(capM, fc, world.scene.children.filter(mirrored), 99, isTile); } catch (e) { fail('early mirror', e); } fc.layers.mask = m0; }
        let b = 0; for (const p of r.info.programs || []) if (!p.isReady()) b++; if (b > E.capMax) E.capMax = b;
        if (b < lim) { r.setRenderTarget(world.composer.readBuffer); let k; [b, k] = capFill(capA, world.camera, [world.scene], b, lim, ms); if (k) more = true; }
        if (fc && b < lim) { const m0 = fc.layers.mask; fc.layers.set(3); r.setRenderTarget(world.streetRT, 0); let k; try { [b, k] = capFill(capM, fc, world.scene.children.filter(mirrored), b, lim, ms); if (k) more = true; } catch (e) { fail('early mirror', e); } if (!more) holeMirror(fc); fc.layers.mask = m0; }
        if (!more) capIdle = true; if (b >= lim) more = true; if (b > E.capMax) E.capMax = b;
        if (CH.on) { const ps = (r.info.programs || []).slice(n); CH.ps = ps.length ? ps : null; CH.t = t; }
      } else {
      r.setRenderTarget(world.composer.readBuffer); r.compile(world.scene, world.camera);
      if (fc) { const m0 = fc.layers.mask; fc.layers.set(3); r.setRenderTarget(world.streetRT, 0); for (const top of world.scene.children) if (mirrored(top)) { try { r.compile(top, fc, world.scene); } catch (e) { fail('early mirror', e); } } holeMirror(fc); fc.layers.mask = m0; } }
    } catch (e) { fail('early', e); } finally { if (lamp) world.scene.remove(lamp); r.setRenderTarget(old); }
    const dt = performance.now() - t, got = (r.info.programs ? r.info.programs.length : 0) - n; E.passes++; E.added += got; E.ms += dt; if (!capped) perWatch(t, n); else if (CH.on && CH.ps) { chainLook(); setTimeout(chainLook, 60); } if (E.on) earlyT = setTimeout(earlyPass, capped && !E.fast ? (more ? 200 : 1000) : Math.max(2500, dt * 10)); };
  if ((E.arm === 1 || E.arm === 2) && world.composer) { E.on = true; earlyT = setTimeout(earlyPass, 2500);
    if (P.get('holeearly') !== '0' && P.get('ihole') !== '0' && P.get('interiors') !== '0') import('./interiors/hole.js').then((m) => { HM = m; holeTry(); }, (e) => fail('early hole file', e)); }
  // begin(): called just BEFORE main.js's compile-ahead step, so the two batches are one and are built side by side. Links only; waits for nothing.
  const begin = () => { if (E.on) { E.on = false; clearTimeout(earlyT); E.ms = Math.round(E.ms); } if (HM && E.hole) { const H = world.__shopHole; try { if (H && H.taken) E.holeTaken = 1; else if (HM.dropEarlyHole(world)) E.holeTaken = 0; } catch (e) { fail('early hole drop', e); } }     /* handoff18: an early shop-opening copy nobody took leaves the scene before the compile-ahead */ t0 = performance.now(); n0 = r.info.programs ? r.info.programs.length : 0; const old = r.getRenderTarget();
    try {
      // 1. the street mirror's variants
      const fc = !world.streetOff && !world.streetFull && world.streetCam && world.streetRT ? world.streetCam.children[0] : null;
      if (fc) { fc.layers.set(3); r.setRenderTarget(world.streetRT, 0);
        for (const top of world.scene.children) if (mirrored(top)) { try { r.compile(top, fc, world.scene); S.mirror++; } catch (e) { fail('mirror', e); } } holeMirror(fc); }
      // 2. the picture passes' own quads (enabled passes only), and the exposure meter's two
      if (P.get('warmup') !== 'm' && world.composer) { const mats = new Set(), add = (m, mesh) => { if (m && m.isShaderMaterial && !mats.has(m)) { mats.add(m); try { r.compile(mesh || new THREE.Mesh(geo, m), cam); S.quads++; } catch (e) { fail('quad', e); } } };
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
        const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); r.setRenderTarget(world.composer.readBuffer);
        for (const p of world.composer.passes) { if (!p || p.enabled === false) continue;
          for (const k of Object.keys(p)) { const v = p[k]; if (!v || typeof v !== 'object') continue;
            if (v.isMaterial) add(v); else if (Array.isArray(v)) { for (const x of v) if (x && x.isMaterial) add(x); } else if (v._mesh && v._mesh.material) add(v._mesh.material, v._mesh); } }
        add(world.meterMat); add(world.expMat); geo.dispose(); }
    } catch (e) { fail('begin', e); } finally { r.setRenderTarget(old); }
    S.added = (r.info.programs ? r.info.programs.length : 0) - n0; S.linkMs = Math.round(performance.now() - t0); };
  // finish(): called just AFTER the compile-ahead step: waits for whatever of the batch is still building (the browser links it off the page's thread); never longer than a minute
  const finish = async () => { if (!t0) begin(); const t1 = performance.now();
    try { const ready = () => { for (const p of r.info.programs || []) if (!p.isReady()) return false; return true; };
      for (let i = 0; i < 6000 && !ready() && performance.now() - t1 < 60000; i++) await sleep(10); } catch (e) { fail('wait', e); }
    { const fc = !world.streetOff && !world.streetFull && world.streetCam && world.streetRT ? world.streetCam.children[0] : null;     /* handoff19: the shop-opening copy's mirror program starts building now, unwaited */
      if (fc) { const old = r.getRenderTarget(), m0 = fc.layers.mask; try { fc.layers.set(3); r.setRenderTarget(world.streetRT, 0); holeMirror(fc, true); } catch (e) { fail('hole mirror', e); } finally { fc.layers.mask = m0; r.setRenderTarget(old); } } }
    S.waitMs = Math.round(performance.now() - t1); for (const w of watches) w();     /* the early passes' watchers get their last look now that everything is ready */
    S.perProg = E.passes ? (E.per !== undefined ? E.per : 99) : (performance.now() - t0) / Math.max(1, (r.info.programs ? r.info.programs.length : 0) - n0);     /* ms per program of the whole batch: about 15 on an M2 Max that has never seen them, 2 to 3 when the machine's shader cache has them (ramp() reads it) */
    console.log('[game] warm-up ahead: ' + (E.passes ? 'linked early while the game was set up: ' + E.added + ' programs in ' + E.passes + ' passes (page time ' + E.ms + ' ms), ' + ((r.info.programs ? r.info.programs.length : 0) - E.added) + ' more by the end; ' + (E.hole ? 'the shop-opening copy of the building front was made before pass ' + E.hole + (E.holeTaken ? ' and taken by interiors.js; ' : ' and NOT taken (removed); ') : '') : '') + S.added + ' more programs in the batch (page time ' + S.linkMs + ' ms, waited ' + S.waitMs + ' ms more after the compile-ahead; street mirror: ' + S.mirror + ' groups' + (S.holeMirror && HMQ === '1' ? ' and the shop-opening copy' : '') + '; picture passes: ' + S.quads + ' quads' + (S.holeMirror && HMQ !== '1' ? '; the shop-opening copy\'s mirror program linked after the wait, unwaited' : '') + ')' + (S.errors ? ', errors ' + S.errors + ' (' + lastErr + ')' : '')); };
  // a group that joins the scene later (the landmark buildings, hero.js): its mirror variants as one batch, before it is added
  const late = async (obj) => { const fc = !(S.ramping ? S.rampOff0 : world.streetOff) && !world.streetFull && world.streetCam && world.streetRT ? world.streetCam.children[0] : null; if (!fc || !obj) return; const old = r.getRenderTarget(), t0 = performance.now();
    try { fc.layers.set(3); r.setRenderTarget(world.streetRT, 0); r.compile(obj, fc, world.scene); S.late = (S.late || 0) + 1; } catch (e) { fail('late', e); } finally { r.setRenderTarget(old); }
    try { const ready = () => { for (const p of r.info.programs || []) if (!bg.has(p) && !p.isReady()) return false; return true; }; for (let i = 0; i < 2000 && !ready() && performance.now() - t0 < 15000; i++) await sleep(10); } catch (e) { fail('late wait', e); } };
  // ramp(first): light lane handoff15, Nov 15. MEASURED (firstload/STATE.md, every draw fenced by a round trip): on a first visit the first drawn frame stood
  // 9.4 s, and 6.5 s of it was the FIRST DRAW of each of 141 programs that were already fully linked (COMPLETION_STATUS true on all of them): the graphics
  // process builds a program's pipeline when it is first drawn, a median 36 ms each, one after another; 1.4 s more was texture upload. The street mirror's
  // first face did the same for its 48 programs (2.8 s). That work cannot be linked away, but it need not be ONE frozen frame: for the first frames
  // behind the start screen the scene's drawn things are let into the picture a few programs at a time, and the next few only when the graphics process
  // has finished the last (a fence, polled, never waited for), so the page keeps running (the loading line moves, the landmark files are parsed
  // meanwhile). Then the same for the street mirror. Lamps are never touched, so every program is the one the full picture uses. main.js holds Play
  // until S.ramping is false. ?warmramp=0 = off (the first frame draws everything at once, as before). Never runs for tools that skip the start screen.
  const ramp = (first) => {
    if (P.get('warmramp') === '0' || S.ramping || world.nearObject) return false;
    // a repeat visit (the batch above came back from the machine's shader cache: under 5 ms a program, page time included) has nothing to spread, and a
    // slow run of frames would only hold the landmark buildings back (they load one texture a frame): everything is drawn at once, as before. ?warmramp=1 forces the ramp.
    if (P.get('warmramp') !== '1' && S.perProg !== undefined && S.perProg < (E.passes ? 8 : 5)) {     /* after early linking the figure is an early pass's own (perWatch above: 3.6 against 22 to 37), taken while game.init() works beside it: under 8 */ S.rampSkipped = +S.perProg.toFixed(1); console.log('[game] warm-up ramp: not needed (the batch took ' + S.rampSkipped + ' ms a program: shader cache warm)'); return false; }
    const gl = r.getContext(), now = () => performance.now(), T0 = now(), R = (S.ramp = { log: [], tex: 0, frames: 0, idle: 0, steps: 0, objs: 0, progs: 0, mObjs: 0, mSteps: 0, maxStep: 0, hid: 0 });
    const isDrawn = (o) => o.isMesh || o.isLine || o.isPoints || o.isSprite; const RW = P.get('rampwait') === '1';
    const unitsOf = (o) => { const out = []; for (const m of [].concat(o.material || [])) { const mp = m && r.properties.has(m) ? r.properties.get(m) : null; if (mp && mp.programs && mp.programs.size) { for (const p of mp.programs.values()) out.push(p); } else if (m) out.push(m); } return out; };
    // phase 1: every drawn thing is held (no camera sees it) and let go batch by batch.
    // HELD (Nov 15, after the first handoff15 undid budget.js's hiding): while a thing waits its turn its .layers is a stand-in that answers every camera
    // "not on your layers" (three asks only through layers.test) and passes every other question and every change through to the thing's OWN Layers
    // object, which is never altered here. So whoever takes a waiting thing off a layer or puts it back (budget.js: far small street things and far people
    // off layer 0, every 8th frame from the first frame on, and back again) changes the real layers, and when the thing's turn comes it is exactly as they
    // left it. (Before: the mask was saved and set to 0, so budget's disable(0) did nothing while budget counted the thing hidden, and the saved mask then
    // put layer 0 back: 7,492 things budget meant hidden were drawn after the ramp.) A thing that is on no layer when its turn comes is let go without
    // being counted into a batch: nothing draws it, as today, where budget hides it before the first frame.
    const HP = { test() { return false; }, isEnabled(c) { return this.real.isEnabled(c); }, enable(c) { this.real.enable(c); }, disable(c) { this.real.disable(c); }, toggle(c) { this.real.toggle(c); }, set(c) { this.real.set(c); }, enableAll() { this.real.enableAll(); }, disableAll() { this.real.disableAll(); } };
    Object.defineProperty(HP, 'mask', { get() { return this.real.mask; }, set(v) { this.real.mask = v; } });
    const main = { list: [], i: 0, seen: new Set(), size: 4, must: 0 }, mirror = { list: [], i: 0, seen: new Set(), size: 8, must: 0 };
    const firstSet = new Set(); for (const f of first || []) f.traverse((o) => { if (isDrawn(o)) firstSet.add(o); });     /* the struck-person figures: main.js hides them again after 0.9 s, so they go in with the first batch */
    for (const o of firstSet) main.list.push(o); main.must = main.list.length;
    world.scene.traverse((o) => { if (isDrawn(o) && !firstSet.has(o)) main.list.push(o); });
    for (const o of main.list) { const h = Object.create(HP); h.real = o.layers; o.layers = h; }
    const giveMain = (o) => { const h = o.layers; if (h && HP.isPrototypeOf(h)) o.layers = h.real; }, giveMirror = (o) => o.layers.enable(3);
    const off0 = (S.rampOff0 = world.streetOff), doMirror = !world.streetOff && !world.streetFull && !!world.streetCam; world.streetOff = true;
    const texSeen = new WeakSet(), tex = (t) => { if (texSeen.has(t)) return; texSeen.add(t); if (t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || !t.image || !(t.version > 0)) return; const tp = r.properties.has(t) ? r.properties.get(t) : null; if (tp && tp.__webglTexture && tp.__version === t.version) return; try { r.initTexture(t); R.tex++; } catch (e) {} };
    const release = (ph, give) => { let n = 0, k = 0; const fresh = [], mats = new Set(), tr = now();
      while (ph.i < ph.list.length) { const o = ph.list[ph.i]; if (ph === main && o.layers.mask === 0) { give(o); ph.i++; R.hid++; continue; }     /* on no layer (budget hid it while it waited): nothing draws it, so it costs no place in a batch */
        const u = unitsOf(o).filter((x) => !ph.seen.has(x)), nu = new Set(u).size; if (k && n + nu > ph.size && ph.i >= ph.must) break;
        for (const x of u) { if (!ph.seen.has(x)) { ph.seen.add(x); if (x.getUniforms) fresh.push(x); } } n += nu; k++; for (const m of [].concat(o.material || [])) if (m) mats.add(m); give(o); ph.i++; }
      // three's first-use questions for these programs are asked now, while the graphics process has nothing queued, so they do not wait behind the draws below
      // handoff21 (light, Nov 15): ... but never of a program that is still being built: three's questions WAIT for the build, with the page frozen. Since handoff19
      // the shop-opening copy's street-mirror program is linked right after the wait in finish(), unwaited (20 to 50 s of Direct3D), and it hangs on the same
      // material as the copy's main program, so unitsOf() handed it to this loop: players on Windows with early linking stood 21, 27 and 51 s between
      // "ready" and Play (public build 12:36 Nov 15). A program not ready yet is left alone; three asks at its first draw, as it always did. ?rampwait=1 = as before.
      for (const p of fresh) { try { if (RW || !p.isReady || p.isReady()) p.getUniforms(); else R.unready = (R.unready || 0) + 1; } catch (e) {} }
      // ... and their textures go up now for the same reason (an upload queued behind the draws waits for every pipeline before it)
      for (const m of mats) { for (const key in m) { const t = m[key]; if (t && t.isTexture) tex(t); } if (m.uniforms) for (const key in m.uniforms) { const u = m.uniforms[key], t = u && u.value; if (t && t.isTexture) tex(t); } }
      if (R.log.length < 80) R.log.push([Math.round(now() - T0), ph === main ? 'm' : 's', k, n, R.tex, Math.round(now() - tr)]);
      return [k, n]; };
    let fence = null, fenceT = 0, state = 'main', done = false; const render0 = world.render, own = Object.prototype.hasOwnProperty.call(world, 'render');
    const busy = () => { if (!fence) return false; let st = 0; try { st = gl.clientWaitSync(fence, 0, 0); } catch (e) {} if (st === gl.TIMEOUT_EXPIRED && now() - fenceT < 5000) return true; try { gl.deleteSync(fence); } catch (e) {} fence = null; return false; };
    const mark = () => { try { if (fence) gl.deleteSync(fence); fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); } catch (e) { fence = null; } fenceT = now(); };
    const end = (why) => { if (done) return; done = true;
      try { for (; main.i < main.list.length; main.i++) giveMain(main.list[main.i]); for (; mirror.i < mirror.list.length; mirror.i++) giveMirror(mirror.list[mirror.i]); } catch (e) { fail('ramp end', e); }
      world.streetOff = off0; if (world.render === wrap) { if (own) world.render = render0; else delete world.render; } else R.wrapped = 1;     /* someone wrapped the picture call after this: the wrapper stays, as a plain pass-through */
      try { if (fence) gl.deleteSync(fence); } catch (e) {} fence = null; S.ramping = false; R.ms = Math.round(now() - T0); R.why = why || 'done';
      console.log('[game] warm-up ramp: ' + R.objs + ' things (' + R.progs + ' programs) let in over ' + R.steps + ' steps' + (R.hid ? ' (' + R.hid + ' more were on no layer, hidden by the draw budget, and went back undrawn)' : '') + ', the street mirror ' + R.mObjs + ' over ' + R.mSteps + '; ' + R.frames + ' frames, ' + R.idle + ' of them waiting for the graphics process, ' + R.ms + ' ms, longest step ' + R.maxStep + ' ms' + (why ? ' (' + why + ')' : '')); };
    const wrap = function (t, focus) {
      if (done) return render0.call(world, t, focus);
      let drew = false, face = false;
      try { R.frames++;
        if (now() - T0 > 90000 || (r.getContext().isContextLost && gl.isContextLost())) end('stopped early');
        else if (busy()) R.idle++;
        else { const dt = fenceT ? now() - fenceT : 0; if (dt > R.maxStep) R.maxStep = Math.round(dt);
          if (state === 'main') {
            if (fenceT) main.size = dt < 100 ? main.size * 2 : dt > 350 ? Math.max(1, main.size >> 1) : main.size;
            if (main.i < main.list.length) { const [k, n] = release(main, giveMain); R.objs += k; R.progs += n; R.steps++; drew = true; }
            else if (!doMirror) end(); else { world.streetOff = off0; state = 'tag'; } }
          else if (state === 'mirror') { const n = world.streetN, ev = world.streetEvery || 3; face = n >= 2 && n % ev === 0;     /* the test updateStreet makes: this frame draws one face of the mirror */
            if (face) { if (mirror.i < mirror.list.length) { const [k] = release(mirror, giveMirror); R.mObjs += k; R.mSteps++; drew = true; } else end(); } } }
      } catch (e) { fail('ramp', e); end('error'); }
      const out = render0.call(world, t, focus);
      try { if (!done) { if (state === 'tag') {     /* the mirror has just tagged what it draws (layer 3): take the tags off again and give them back batch by batch, on the frames that draw a face */
            world.scene.traverse((o) => { if (isDrawn(o) && o.layers.isEnabled(3)) { o.layers.disable(3); mirror.list.push(o); } }); const all = new Set(); for (const o of mirror.list) for (const x of unitsOf(o)) all.add(x); mirror.size = Math.max(4, Math.ceil(all.size / 10)); state = 'mirror'; }
          if (drew) mark(); } } catch (e) { fail('ramp', e); end('error'); }
      return out; };
    world.render = wrap; S.ramping = true; return true; };
  return (world.warmup = { S, begin, finish, late, ramp });
}
