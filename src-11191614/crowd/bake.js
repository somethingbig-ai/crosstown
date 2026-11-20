// crowd/bake.js: the crowd's animation texture, as render.js has always made it, moved to a file with no imports so that the same code
// runs on the page (the old way, ?crowdwork=0) and in crowd/castworker.js (people/crowd-perf, Nov 12: off the main thread). three.js is
// handed in. bakeData() returns the half-float pixels and the layout; render.js wraps them in a DataTexture.
const FPS = 10;
// ---------------------------------------------------------------- the animation texture
// Public feedback ("the update interval of objects is too low and the stuttering of animations is distracting"; people/crowd-fb, Nov 11).
// What moved in steps was the cast's clips themselves: they are keyed 10 times a second, joined by straight lines, and 13 of the 27 stop short
// of their own cycle (the export cut each to a whole number of tenths: WalkBrisk has keys to 0.8 s of a 0.867 s stride, Jog to 0.7 of 0.767),
// so the pose at the last key was pulled to the first within one column: a foot 28 cm out of place, every stride. loopTrack() makes a track a
// closed loop of the clip's real cycle (crowd.json's duration) and a smooth curve through its keys (cubic Hermite, slopes from the neighbours'
// real times), sampled at the texture's columns; walking and running clips get 30 columns a second (20 if they are 1.6 s or longer).
// Nothing is added per frame: the same texture reads. ?crowdsmooth=0 bakes as before; ?crowdsmooth=20 keeps short clips at 20 columns a second.
function loopTrack(THREE, t, P, F) {
  const n0 = t.times.length, k = t.getValueSize(), T = t.times, V = t.values; if (n0 < 3 || t.getInterpolation() === THREE.InterpolateDiscrete) return t;
  let n = n0; if (P - T[n0 - 1] < 0.01) { for (let c = 0; c < k; c++) if (Math.abs(V[c] - V[(n0 - 1) * k + c]) > 4e-3 && Math.abs(V[c] + V[(n0 - 1) * k + c]) > 4e-3) return t; n = n0 - 1; }      // closed in the file (last key = first), or not a loop at all
  const times = new Float32Array(F + 1), vals = new Float32Array((F + 1) * k), tm = (j) => T[((j % n) + n) % n] + Math.floor(j / n) * P, P0 = [0, 0, 0, 0], P1 = [0, 0, 0, 0], P2 = [0, 0, 0, 0], P3 = [0, 0, 0, 0];
  const key = (j, o) => { const q = (((j % n) + n) % n) * k; for (let c = 0; c < k; c++) o[c] = V[q + c]; }, same = (Q, R) => { let d = 0; for (let c = 0; c < 4; c++) d += Q[c] * R[c]; if (d < 0) for (let c = 0; c < 4; c++) Q[c] = -Q[c]; };
  for (let f = 0, i = 0; f <= F; f++) {
    const x = f === F ? 0 : (f / F) * P; times[f] = (f / F) * P; if (f === F) i = 0; while (i < n - 1 && T[i + 1] <= x) i++;
    const t0 = tm(i - 1), t1 = tm(i), t2 = tm(i + 1), t3 = tm(i + 2), h = t2 - t1, u = (x - t1) / h, u2 = u * u, u3 = u2 * u; key(i - 1, P0); key(i, P1); key(i + 1, P2); key(i + 2, P3);
    if (k === 4) { same(P0, P1); same(P2, P1); same(P3, P2); }
    let L = 0; for (let c = 0; c < k; c++) { const m1 = ((P2[c] - P0[c]) / (t2 - t0)) * h, m2 = ((P3[c] - P1[c]) / (t3 - t1)) * h, v = (2 * u3 - 3 * u2 + 1) * P1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * P2[c] + (u3 - u2) * m2; vals[f * k + c] = v; L += v * v; }
    if (k === 4) { L = Math.sqrt(L) || 1; for (let c = 0; c < 4; c++) vals[f * k + c] /= L; }
  }
  return new t.constructor(t.name, times, vals);
}
// spare: empty columns left at the right edge (clips added later by someone else are written there: see render.js)
export function bakeData(THREE, cast, clipNames, smooth = 0, spare = 0) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()), chars = cast.chars, accs = cast.accs || [], meta = (cast.sim && cast.sim.clips) || {};
  const NB = Math.max(...chars.map((c) => c.skeleton.bones.length)), ROWS = (NB + accs.length) * 3;
  const clips = clipNames.map((n) => { const c = cast.animations.find((a) => a.name.toLowerCase() === n.toLowerCase()); if (!c) return null; const o = { name: n, clip: c, dur: c.duration, F: Math.max(2, Math.round(c.duration * (c.duration < 1.6 ? 2 * FPS : FPS))) };
    if (smooth) { const m = meta[n] || {}, P = m.duration >= c.duration - 1e-3 && m.duration - c.duration < 0.12 ? m.duration : c.duration, moving = m.speed > 0;
      if (moving || P - c.duration > 0.01) { o.loop = true; o.dur = P; o.F = Math.max(2, Math.round(P * (moving ? (P < 1.6 ? smooth : 2 * FPS) : P < 1.6 ? 2 * FPS : FPS))); } }
    return o; });
  let W = 0; for (const c of clips) if (c) { c.x0 = W; W += c.F + 1; } const used = W; W += spare;
  const first = clips.find((c) => c); for (let i = 0; i < clips.length; i++) if (!clips[i]) clips[i] = Object.assign({}, first, { name: clipNames[i], missing: true });
  const H = chars.length * ROWS, data = new Float32Array(W * H * 4), m = new THREE.Matrix4(), sc = new THREE.Matrix4();
  const put = (x, y, e) => { for (let r = 0; r < 3; r++) { const o = ((y + r) * W + x) * 4; data[o] = e[r]; data[o + 1] = e[4 + r]; data[o + 2] = e[8 + r]; data[o + 3] = e[12 + r]; } };
  chars.forEach((ch, ci) => {
    const root = ch.root, sk = ch.skeleton, bones = sk.bones, inv = sk.boneInverses, bind = ch.bind, y0 = ci * ROWS; ch.rowBase = y0;
    if (root.parent) root.parent.remove(root); root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
    const mixer = new THREE.AnimationMixer(root), pre = [ch.name + '_', ch.name + '.'];
    const ab = accs.map((a) => bones.find((b) => b.name === ch.name + '_' + a.bone) || null); sc.makeScale(ch.height / 1.8, ch.height / 1.8, ch.height / 1.8);
    for (const c of clips) {
      if (c.missing) continue;
      let tracks = c.clip.tracks.filter((t) => t.name.startsWith(pre[0]) || t.name.startsWith(pre[1])); if (!tracks.length) continue;
      if (c.loop) tracks = tracks.map((t) => loopTrack(THREE, t, c.dur, c.F));
      const act = mixer.clipAction(new THREE.AnimationClip(c.name + '_' + ch.name, c.dur, tracks)); act.play();
      for (let f = 0; f < c.F; f++) {
        mixer.setTime((f / c.F) * c.dur); root.updateMatrixWorld(true);
        for (let b = 0; b < bones.length; b++) { m.multiplyMatrices(bones[b].matrixWorld, inv[b]).multiply(bind); put(c.x0 + f, y0 + b * 3, m.elements); }
        for (let k = 0; k < accs.length; k++) if (ab[k]) { m.multiplyMatrices(ab[k].matrixWorld, sc).multiply(accs[k].local); put(c.x0 + f, y0 + (NB + k) * 3, m.elements); }
      }
      act.stop(); mixer.uncacheAction(act.getClip());
      for (let y = y0; y < y0 + ROWS; y++) { const a = (y * W + c.x0) * 4, b = (y * W + c.x0 + c.F) * 4; for (let k = 0; k < 4; k++) data[b + k] = data[a + k]; }
    }
  });
  // float texture with linear filtering where the GPU has it, else half floats (always filterable)
  // half floats: always filterable, half the memory of floats (about 1 mm and 0.0005 of a turn: plenty for a skinning matrix)
  let h; if (typeof Float16Array !== 'undefined') h = new Uint16Array(new Float16Array(data).buffer); else { h = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) h[i] = THREE.DataUtils.toHalfFloat(data[i]); }
  return { data: h, W, H, NB, ROWS, used, clips: clips.map((c) => ({ name: c.name, x0: c.x0, F: c.F, dur: c.dur, loop: !!c.loop, missing: !!c.missing })), rows: chars.map((c) => c.rowBase), ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0), missing: clips.filter((c) => c.missing).map((c) => c.name) };
}
