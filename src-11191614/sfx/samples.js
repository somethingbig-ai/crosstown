// samples.js: fetches the recorded/generated clips (assets/sfx/sfx.json and its sprite files) AFTER the game is playable, decodes them at a reduced rate, cuts
// them by the index and hands them to the worklet (core.js setSamples). Ogg Opus where the browser plays it, AAC in .m4a where it does not (older Safari).
// Anything that fails here (no files, a decode error) only means that sound keeps its synthesis: nothing is thrown at the game.
export async function loadSamples(sfx, base) {
  const out = { clips: 0, bytes: 0, ms: 0, failed: [] }, t0 = performance.now();
  try {
    const idx = await fetch(new URL('sfx.json', base)).then((r) => (r.ok ? r.json() : null)); if (!idx || !idx.clips) return out;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, probe = document.createElement('audio'), opus = !!(probe.canPlayType && probe.canPlayType('audio/ogg; codecs=opus'));
    const decode = (raw) => new Promise((ok, no) => { try { const c = new OAC(2, 1, idx.decodeRate || 32000), p = c.decodeAudioData(raw, ok, no); if (p && p.catch) p.catch(no); } catch (e) { no(e); } });
    const get = async (name, ext) => { const r = await fetch(new URL(name + '.' + ext, base)); if (!r.ok) throw new Error(name + '.' + ext + ' ' + r.status); const raw = await r.arrayBuffer(); out.bytes += raw.byteLength; return decode(raw); };
    const map = {}, move = [];
    for (const key in idx.files) {
      let buf = null; for (const ext of opus ? ['opus', 'm4a'] : ['m4a', 'opus']) { try { buf = await get(idx.files[key], ext); break; } catch (e) { out.failed.push(idx.files[key] + '.' + ext); } }
      if (!buf) continue; const k = buf.sampleRate / idx.sr, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
      for (const name in idx.clips) { const c = idx.clips[name]; if (c.f !== key) continue; const a = Math.round(c.s * k), b = Math.min(L.length, a + Math.round(c.n * k)); if (b - a < 64) continue;
        if (/^(horn|siren|radio|ped)\./.test(name)) { try { const ab = sfx.s.ac.createBuffer(1, b - a, buf.sampleRate); ab.copyToChannel(L.subarray(a, b), 0); (sfx.buf ||= {})[name] = ab; out.clips++; } catch (e) {} continue; }      // played by the game's own modules (traffic horns, police): kept on this side as AudioBuffers
        const o = { L: L.slice(a, b), R: c.st && R ? R.slice(a, b) : null, sr: buf.sampleRate, loop: !!c.loop, f0: c.f0 || 0 }; map[name] = o; move.push(o.L.buffer); if (o.R) move.push(o.R.buffer); out.clips++; }
      await new Promise((r) => setTimeout(r, 0));      // let a frame through between files
    }
    if (out.clips && sfx.node) sfx.node.port.postMessage({ samples: map }, move);
  } catch (e) { out.error = (e && e.message) || String(e); }
  out.ms = Math.round(performance.now() - t0); return out;
}
