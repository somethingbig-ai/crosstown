// crowd/castworker.js (people/crowd-perf, Nov 12): the crowd's clips, read and baked OFF the main thread.
// A module worker. It fetches assets/crowd/crowd-anim.glb.gz (skeletons and the 27 clips: 9 MB of glTF JSON, 44,550 channels), parses it with
// three's own GLTFLoader, runs the very bake of crowd/bake.js and hands the page the finished half-float texture; then, clip by clip, the raw
// keys (for the few places on the page that pose a skinned copy of a crowd member: a struck or a shot person). Before this the page itself
// spent that time inside Game.init, before Play.
// A worker has no import map, so three and its loader are fetched as text and their "from 'three'" lines pointed at the file.
import { bakeData } from './bake.js';
const post = (m, tr) => self.postMessage(m, tr || []);
self.onmessage = async (ev) => {
  const o = ev.data; if (!o || o.cmd !== 'bake') return; const t0 = performance.now(), T = {};
  try {
    const three = new URL(o.three, self.location.href).href, THREE = await import(three);
    const mod = async (url, map) => { let s = await (await fetch(url)).text(); s = s.replace(/from\s+'three'/g, "from '" + three + "'"); for (const k in map || {}) s = s.split("'" + k + "'").join("'" + map[k] + "'"); return URL.createObjectURL(new Blob([s], { type: 'text/javascript' })); };
    const jsm = three.replace(/build\/[^/]*$/, 'examples/jsm/'), bgu = await mod(jsm + 'utils/BufferGeometryUtils.js'), { GLTFLoader } = await import(await mod(jsm + 'loaders/GLTFLoader.js', { '../utils/BufferGeometryUtils.js': bgu }));
    T.modules = performance.now() - t0;
    if (o.wait) await new Promise((res) => { self.addEventListener('message', (e) => { if (e.data && e.data.cmd === 'go') res(); }); });      // the page says when the download may start
    const t1 = performance.now(), r = await fetch(o.url); if (!r.ok) throw new Error(o.url + ' ' + r.status);
    const buf = /\.gz$/.test(o.url) ? await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : await r.arrayBuffer(); T.fetch = performance.now() - t1; T.bytes = buf.byteLength;
    const t2 = performance.now(), gltf = await new GLTFLoader().parseAsync(buf, ''); gltf.scene.updateMatrixWorld(true); T.parse = performance.now() - t2;
    // the cast as src/crowd.js loadCast() makes it, from the nodes alone (the meshes are in the other file; mkassets.mjs left a note on each node that had one)
    const meta = o.meta, chars = [], accs = [], accNodes = []; gltf.scene.traverse((n) => { if (/^acc_/.test(n.name) && n.userData && n.userData.crowdAcc) accNodes.push(n); });
    for (const name of Object.keys(meta.accessories || {})) { const n = accNodes.find((q) => q.name === 'acc_' + name); if (!n) continue; const bone = (n.parent && n.parent.name.replace(/^c\d+_/, '')) || meta.accessories[name].bone; n.updateMatrix(); accs.push({ name, bone, local: n.matrix.clone() }); }
    for (const n of accNodes) if (n.parent) n.parent.remove(n);
    for (const c of meta.characters) { const root = gltf.scene.getObjectByName(c.name); if (!root) continue; let skin; root.traverse((n) => { if (skin === undefined && n.userData && n.userData.crowdSkin !== undefined) skin = n.userData.crowdSkin; }); if (skin === undefined) continue;
      chars.push({ name: c.name, root, height: c.height || 1.75, skeleton: await gltf.parser.getDependency('skin', skin), bind: new THREE.Matrix4() }); }      // GLTFLoader binds every skinned mesh with the identity
    if (!chars.length) throw new Error('no characters in ' + o.url);
    const names = new Set(gltf.animations.map((a) => a.name)), clips = {}; for (const k in meta.clips) if (names.has(k)) clips[k] = meta.clips[k];
    const B = bakeData(THREE, { chars, accs, animations: gltf.animations, sim: { clips: meta.clips } }, o.clipNames || Object.keys(clips), o.smooth, o.spare || 0);      /* the page's own list and order of clips (one that is not in the file is marked missing, as on the page) */ T.bake = B.ms; T.total = performance.now() - t0;
    post({ type: 'bake', data: B.data, W: B.W, H: B.H, NB: B.NB, ROWS: B.ROWS, used: B.used, clips: B.clips, chars: chars.map((c, i) => ({ name: c.name, row: B.rows[i], bones: c.skeleton.bones.length })), accs: accs.map((a) => a.name), missing: B.missing, T }, [B.data.buffer]);
    // the keys of every clip, packed: one Float32Array a clip and a table of [name index, kind (0 vector, 1 quaternion, 2 number), keys, time offset, value offset, interpolation]
    const tn = new Map(), tnames = []; const out = [], tr = [];
    for (const a of gltf.animations) { let n = 0; for (const t of a.tracks) n += t.times.length + t.values.length; const F = new Float32Array(n), D = new Uint32Array(a.tracks.length * 6); let off = 0;
      a.tracks.forEach((t, i) => { let k = tn.get(t.name); if (k === undefined) { k = tnames.length; tn.set(t.name, k); tnames.push(t.name); } const kind = t.ValueTypeName === 'quaternion' ? 1 : t.ValueTypeName === 'vector' ? 0 : 2; D[i * 6] = k; D[i * 6 + 1] = kind; D[i * 6 + 2] = t.times.length; D[i * 6 + 3] = off; F.set(t.times, off); off += t.times.length; D[i * 6 + 4] = off; F.set(t.values, off); off += t.values.length; D[i * 6 + 5] = t.getInterpolation(); });
      out.push({ name: a.name, duration: a.duration, F, D }); tr.push(F.buffer, D.buffer); }
    post({ type: 'tracks', names: tnames, clips: out }, tr);
  } catch (e) { post({ type: 'error', message: String((e && (e.stack || e.message)) || e).slice(0, 500) }); }
};
