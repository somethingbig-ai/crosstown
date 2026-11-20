// perf lane, Nov 15 (?latecabin=0 off: then this file is never fetched). THE BUILT CABIN ARRIVES AFTER READY. assets/heli/cockpit/cabin.glb is 8 MB and is drawn
// only for an eye in the seats or within 3.2 m of the aircraft (cockpit.js update: built.visible = L === 0 && full), and nobody is in a helicopter in the first
// seconds. So set-up builds the cockpit with the code-built cabin (the same one ?cabin=code gives, and what a failed download has always fallen back to), and
// this file, once the game is ready, fetches the built cabin, builds a SECOND cockpit with it through the very same buildCockpit (so what stands at the end is
// what set-up used to make, statement for statement), has its shader programs made off the frame, and swaps the two between frames. A player who is seated
// before it lands sees the code-built cabin until the swap. If the file never arrives the code-built cabin stays, as before.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function lateCabin(heli, ctx) {
  const S = (window.__latecabin = { state: 'waiting for ready', t: {} }), now = () => +(performance.now() / 1000).toFixed(2);
  try {
    const Q = window.__lateq;     /* lateq (src/lateq.js): with the shared queue the cabin asks for its turn and the queue waits for ready; ?lateq=0 = as before */
    if (!Q) { while (!window.__ready) await sleep(100); S.state = 'fetching'; S.t.start = now(); } else S.state = 'waiting for its turn';
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'), url = new URL('../../assets/heli/cockpit/' + (new URLSearchParams(location.search).get('cabinfile') || 'cabin.glb'), import.meta.url).href;
    const hv = new ctx.THREE.Vector3(), hd = () => heli.model.root.getWorldPosition(hv).distanceTo(ctx.world.camera.position); if (Q) Q.heliDist = hd;
    const load = () => new GLTFLoader().loadAsync(url), turn = () => Q.run({ kind: 'cabin', d: hd, name: 'heli/cockpit/cabin.glb' }, (free) => { S.state = 'fetching'; if (!S.t.start) S.t.start = now(); return Q.bytes(url).then((b) => { free(); return new GLTFLoader().parseAsync(b, url.slice(0, url.lastIndexOf('/') + 1)); }); });     /* the line is given back when the bytes are in, before the parse */
    let glb = null; for (let i = 0; !glb; i++) { try { glb = await (Q ? turn() : load()); } catch (e) { if (i >= 2) throw e; await sleep(3000 * (i + 1)); } }
    S.state = 'building'; S.t.fetched = now();
    const old = heli.parts.cockpit; if (!old || !old.lateWait) { S.state = 'not needed'; return; }
    const m = await import('./cockpit.js'), b0 = performance.now(), next = await m.buildCockpit(ctx, heli.model, { glb }); S.buildMs = Math.round(performance.now() - b0);
    if (!next || !next.built) { drop(next, old); S.state = 'kept the code-built cabin (the file was not usable)'; console.log('[heli] cockpit: ' + S.state); return; }
    S.state = 'programs'; S.t.built = now();
    try { const w = ctx.world; if (w && w.renderer && w.renderer.compileAsync) await Promise.race([w.renderer.compileAsync(next.root, w.camera, w.scene), sleep(20000)]); } catch (e) { console.log('[heli] cockpit: programs of the built cabin not made ahead (' + (e && e.message) + ')'); }
    if (heli.parts.cockpit !== old) { drop(next, heli.parts.cockpit); S.state = 'not swapped (the cockpit was replaced meanwhile)'; return; }
    for (const k of ['ambOutside', 'aoRadiusInside', 'keyInside', 'hidden', 'hideShellGlass', 'skipMain']) if (k in old) next[k] = old[k];      // whatever was set on the first one from outside
    const par = old.root.parent || heli.model.root; par.add(next.root); heli.parts.cockpit = next; par.remove(old.root); drop(old, next);
    S.state = 'in'; S.t.in = now(); console.log('[heli] cockpit: built cabin in at ' + S.t.in + ' s (fetched in ' + (S.t.fetched - S.t.start).toFixed(2) + ' s, second build ' + S.buildMs + ' ms)');
  } catch (e) { S.state = 'failed: ' + (e && e.message); console.log('[heli] cockpit: built cabin not used (' + (e && e.message) + '); the code-built cabin stays'); }
}
// frees what only the dropped cockpit holds: its geometries, its materials, its own pictures and its sun map
function drop(a, keep) {
  if (!a || !a.root) return; const kg = new Set(), km = new Set(), kt = new Set();
  if (keep && keep.root) keep.root.traverse((o) => { if (o.geometry) kg.add(o.geometry); for (const m of [].concat(o.material || [])) { km.add(m); if (m.map) kt.add(m.map); } });
  if (keep && keep.textures) for (const k in keep.textures) kt.add(keep.textures[k]);
  try {
    a.root.traverse((o) => { if (o.geometry && !kg.has(o.geometry)) o.geometry.dispose(); for (const m of [].concat(o.material || [])) if (!km.has(m)) m.dispose(); });
    for (const k in a.textures || {}) { const t = a.textures[k]; if (t && !kt.has(t)) t.dispose(); }
    const pm = a.parts && a.parts.panel && a.parts.panel.material && a.parts.panel.material.map; if (pm && !kt.has(pm)) pm.dispose();
    if (a.sun && a.sun.rt) { if (a.sun.rt.depthTexture) a.sun.rt.depthTexture.dispose(); a.sun.rt.dispose(); }
  } catch (e) {}
}
