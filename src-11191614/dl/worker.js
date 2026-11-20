// worker.js (perf lane, download size): unpacks .dz.bin files off the main thread, so a building tile that arrives during play costs the frame nothing.
// The zstd decoder is the one three.js ships (the KTX2 loader already uses it); the path is relative because import maps do not reach workers.
import { unpack } from './unpack.js';
import { ZSTDDecoder } from '../../node_modules/three/examples/jsm/libs/zstddec.module.js';
const z = new ZSTDDecoder(), ready = z.init();
self.onmessage = async (e) => { let { id, buf, url } = e.data;
  try { await ready; if (url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); buf = await r.arrayBuffer(); }     /* after the page is ready the worker downloads the file itself: one hand-over to the page, not three */
    const out = unpack(new Uint8Array(buf), z); self.postMessage({ id, buf: out.buffer }, [out.buffer]); }
  catch (err) { self.postMessage({ id, err: String((err && err.message) || err) }); } };
