// capture.js: films the game from inside the page. Each frame is one fixed 1/60 s game step drawn by the normal renderer, with the HUD laid
// over it, and encoded to H.264 by the Mac's hardware encoder (WebCodecs). The stream is posted to the local server in pieces.
// A long film is shot in segments: `skip` replays the game (same steps, nothing drawn) up to the segment's first frame, and `resume`
// carries over the one piece of renderer state that has a memory (the eased exposure), so segments join without a seam.
export async function capture(game, { frames = 600, fps = 60, name = 'take.h264', bitrate = 16e6, stills = {}, skip = 0, resume = null, gop = 60 } = {}) {
  const gl = game.world.renderer.domElement, W = gl.width, H = gl.height, w = game.world;
  const comp = new OffscreenCanvas(W, H), ctx = comp.getContext('2d');
  let pending = [], bytes = 0, err = null, chunks = 0, keys = 0;
  const enc = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); pending.push(b); bytes += b.length; chunks++; if (c.type === 'key') keys++; }, error: (e) => { err = e; } });
  // realtime mode keeps the encoder from reordering frames (no B-frames), so the raw stream muxes with plain 1/60 s timestamps
  const cfg = { codec: 'avc1.640034', width: W, height: H, bitrate, framerate: fps, avc: { format: 'annexb' }, hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime', bitrateMode: 'variable' };
  let sup = await VideoEncoder.isConfigSupported(cfg); if (!sup.supported) { cfg.hardwareAcceleration = 'no-preference'; sup = await VideoEncoder.isConfigSupported(cfg); if (!sup.supported) throw new Error('no H.264 encoder for ' + W + 'x' + H); }
  enc.configure(cfg);
  const post = async (path, body) => { const r = await fetch('/upload/' + path, { method: 'POST', body }); if (!r.ok) throw new Error('upload ' + r.status); };
  const flushPending = async () => { if (!pending.length) return; const blob = new Blob(pending); pending = []; await post(name, blob); };
  // replay to the first frame: the game steps exactly as when filmed (visual bookkeeping included), only the GPU frame is not drawn
  const tSkip = performance.now();
  for (let i = 0; i < skip; i++) { game.step(1 / 60); game.syncVisuals(1 / 60); game.hud.draw(); }
  const skipSecs = (performance.now() - tSkip) / 1000;
  if (skip > 0) { w.render(game.t); w.render(game.t); }                          // warm the pipeline on the frame before ours
  if (resume) { w.exposure = resume.exposure; w.meterN = resume.meterN; if (w.film) w.film.uniforms.uExposure.value = resume.exposure; }
  const t0 = performance.now(); const log = []; let slow = 0;
  for (let i = 0; i < frames; i++) {
    const n = skip + i, tf = performance.now();
    game.stepFrame();
    ctx.drawImage(gl, 0, 0); ctx.drawImage(game.hud.canvas, 0, 0, W, H);
    const f = new VideoFrame(comp, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) }); enc.encode(f, { keyFrame: i % gop === 0 }); f.close();
    if (stills[n]) { await post(stills[n], await comp.convertToBlob({ type: 'image/png' })); }
    if (n % 300 === 0) { const v = game.player.vehicle, M = game.missions; log.push([n, M.state, Math.round(game.player.x), Math.round(game.player.y), v ? Math.round(v.vf * 2.237) : -1, M.target ? Math.round(Math.hypot(M.target.x - game.player.x, M.target.y - game.player.y)) : -1]); }
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    if (i % 120 === 119) await flushPending();
    if (err) throw err;
    if (performance.now() - tf > 100) slow++;
  }
  await enc.flush(); await flushPending(); enc.close();
  if (err) throw err;
  return { frames, first: skip, chunks, keys, bytes, secs: (performance.now() - t0) / 1000, skipSecs, slow, w: W, h: H, hw: cfg.hardwareAcceleration, log, cash: game.cash, state: game.missions.state, t: game.t,
    resume: { exposure: w.exposure, meterN: w.meterN } };
}
