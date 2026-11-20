// dl.js (perf lane, download size): smaller downloads with the same bytes at the end. assets/dl.json lists the game's files that also exist packed
// harder than gzip, as <file>.dz.bin (lanes/perf/dl/README.md; made and checked by lanes/perf/dl/tools/pack.mjs). For each of them the page fetches
// the packed file and a worker rebuilds the ORIGINAL file, byte for byte (unpack.js), so every loader gets exactly what it got before:
//   - loaders that ask for the plain file (people.glb, the helicopter, models.glb ...) are served through fetch() and are not changed at all;
//   - loaders that used to ask for <file>.gz and gunzip it (tiles.js, world.js, hero.js, crowd.js) ask window.__dl first: has(path), get(path).
// ?dl=0: nothing of this is installed and every loader takes its old path. A packed file that is missing or will not unpack falls back to the old
// path too, with one console line. The packed bytes go through the page's own fetch, so the loading bar counts them.
export async function installDL() {
  if (new URLSearchParams(location.search).get('dl') === '0') return null;
  const inner = window.fetch.bind(window); let files = null;
  try { const r = await inner('assets/dl.json'); if (r.ok) files = (await r.json()).files; } catch (e) {}
  if (!files) { console.log('[dl] no assets/dl.json: plain downloads'); return null; }
  // downtown lane: a map named ?city=city-<n>.json has its own list beside this one (assets/dl-<n>.json: its tile folder's packed files). The ordinary map never asks for it.
  { const cn = /^city-(\d+)\.json$/.exec(new URLSearchParams(location.search).get('city') || ''); if (cn) try { const r = await inner('assets/dl-' + cn[1] + '.json'); if (r.ok) Object.assign(files, (await r.json()).files); } catch (e) {} }
  const base = new URL('.', location.href), key = (u) => { try { const x = new URL(u, location.href); if (x.origin !== base.origin || !x.pathname.startsWith(base.pathname)) return ''; return decodeURIComponent(x.pathname.slice(base.pathname.length)); } catch (e) { return ''; } };
  const stats = { files: 0, packed: 0, raw: 0, ms: 0, failed: 0, main: 0, twice: 0, viaWorker: 0, dup: 0, dupBytes: 0 }, seen = new Map(), dupOn = new URLSearchParams(location.search).get('dldup') !== '0';
  // workers: up to two while the game loads (each holds about three times the file it is unpacking), one once it is ready (tiles keep arriving during play)
  const pool = [], jobs = new Map(); let seq = 0, dead = false, local = null;
  const MAX = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 1));
  const onMain = async (buf) => { if (!local) local = Promise.all([import('./unpack.js'), import('three/addons/libs/zstddec.module.js')]).then(async ([u, z]) => { const d = new z.ZSTDDecoder(); await d.init(); return (b) => u.unpack(new Uint8Array(b), d).buffer; }); stats.main++; return (await local)(buf); };
  const spawn = () => { const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); w.busy = 0;
    w.onmessage = (e) => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); w.busy--; if (e.data.err) j.rej(new Error(e.data.err)); else j.res(e.data.buf); trim(); };
    w.onerror = (e) => { dead = true; console.log('[dl] worker failed, unpacking on the main thread: ' + ((e && e.message) || '')); for (const [id, j] of jobs) if (j.w === w) { jobs.delete(id); j.rej(new Error('worker')); } const i = pool.indexOf(w); if (i >= 0) pool.splice(i, 1); try { w.terminate(); } catch (x) {} };
    pool.push(w); return w; };
  const trim = () => { if (!window.__ready) return; for (let i = pool.length - 1; i >= 1; i--) if (!pool[i].busy) { pool[i].terminate(); pool.splice(i, 1); } };
  const inWorker = (buf) => new Promise((res, rej) => { let w = pool.find((x) => !x.busy); try { if (!w) w = pool.length < (window.__ready ? 1 : MAX) ? spawn() : pool.reduce((a, b) => (b.busy < a.busy ? b : a)); } catch (e) { dead = true; rej(e); return; } const id = ++seq; jobs.set(id, { res, rej, w }); w.busy++; if (typeof buf === 'string') w.postMessage({ id, url: buf }); else w.postMessage({ id, buf }, [buf]); });
  // a small file asked for twice within half a minute (dressing.bin is: dressing.js and streets/furniture.js) is downloaded once: its packed bytes are kept that long
  const memo = new Map(), packedOf = (k) => { const small = files[k][0] < 3e6; if (small && memo.has(k)) { stats.twice++; return memo.get(k).then((b) => b.slice(0)); }
    const p = inner(k + '.dz.bin').then((r) => { if (!r.ok) throw new Error(k + '.dz.bin ' + r.status); return r.arrayBuffer(); });
    if (small) { const keep = p.then((b) => b.slice(0)); keep.catch(() => memo.delete(k)); memo.set(k, keep); setTimeout(() => memo.delete(k), 30000); } return p; };
  // once the page is ready (building tiles arriving during play) the worker fetches the packed file itself, so a tile reaches the game as soon as before; while the
  // game loads, the page fetches it, so the loading bar counts the bytes. ?dlw=0 = the page always fetches.
  const wf = new URLSearchParams(location.search).get('dlw') !== '0';
  const get = async (k) => {
    if (wf && window.__ready && !dead && typeof Worker === 'function') { try { const t0 = performance.now(), out = await inWorker(new URL(k + '.dz.bin', base).href); stats.files++; stats.viaWorker++; stats.packed += files[k][0]; stats.raw += out.byteLength; stats.ms += performance.now() - t0; return out; } catch (e) { if (!dead) throw e; } }
    const buf = await packedOf(k), n = buf.byteLength, t0 = performance.now(); let out;
    if (!dead && typeof Worker === 'function') { try { out = await inWorker(buf); } catch (e) { if (!dead) throw e; const r2 = await inner(k + '.dz.bin'); if (!r2.ok) throw e; out = await onMain(await r2.arrayBuffer()); } }     /* the buffer went to the worker: a failed worker costs one more fetch */
    else out = await onMain(buf);
    stats.files++; stats.packed += n; stats.raw += out.byteLength; stats.ms += performance.now() - t0; return out; };
  const D = (window.__dl = { files, stats, has: (k) => !!files[k], size: (k) => (files[k] ? files[k][0] : 0), key,
    get: (k) => get(k).catch((e) => { stats.failed++; console.log('[dl] ' + k + ' not unpacked, taking the plain file: ' + (e && e.message)); throw e; }) });
  window.fetch = async (u, o) => {
    if (!(o && o.method && o.method !== 'GET')) { const url = typeof u === 'string' ? u : u instanceof URL ? u.href : typeof Request !== 'undefined' && u instanceof Request && u.method === 'GET' ? u.url : '', k = url && !/^(data|blob):/.test(url) ? key(url) : '';
      if (k && files[k]) { try { const buf = await D.get(k); return new Response(buf, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) } }); } catch (e) {} }
      // the same file asked for again while the game loads (plazas.json five times, dressing.json, the ground's texture packs once per map area ...): one download, the
      // same bytes to every asker. Files under 3 MB, until the page is ready; never a fetch that says no-store. ?dldup=0 = every ask is its own download, as before.
      else if (dupOn && k && !window.__ready && !/^api\/|build\.txt|loadtotal/.test(k) && ((o && o.cache) || (typeof u === 'object' && u.cache) || '') !== 'no-store') {
        const m = seen.get(k); if (m) { try { const e = await m; if (e.buf) { stats.dup++; stats.dupBytes += e.buf.byteLength; return new Response(e.buf.slice(0), { status: 200, headers: e.h }); } } catch (e) {} return inner(u, o); }
        const job = (async () => { const r = await inner(u, o), len = +r.headers.get('content-length'); if (!r.ok || r.status !== 200 || !(len > 0) || len > 3e6) return { r };
          const buf = await r.arrayBuffer(); return { buf, h: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'content-length': String(buf.byteLength) } }; })();
        seen.set(k, job); job.catch(() => seen.delete(k)); const e = await job; return e.r || new Response(e.buf.slice(0), { status: 200, headers: e.h }); } }
    return inner(u, o); };
  { const iv = setInterval(() => { if (window.__ready || window.__error) { seen.clear(); clearInterval(iv); } }, 3000); }
  console.log('[dl] ' + Object.keys(files).length + ' files come packed (?dl=0 = plain)');
  return D;
}
