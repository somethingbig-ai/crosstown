// move/mbtrans.js (motionbricks lane, Nov 20; only with ?mbricks=1): the player on foot starts, stops and turns with NVIDIA
// MotionBricks transitions instead of switching loops. Today the player goes from standing to a full walk in 0.15 s, stops dead,
// and turns by spinning the whole body while the legs keep their cycle. Here, when one of those happens, a generated transition
// clip plays (assets/people/mbtrans.json: MbStart, MbStop, MbTurnL, MbTurnR, MbTurnBack, cut by lanes/motionbricks/tools/cut_trans.py)
// and the player is moved along the clip's own path (its speed ramps, the turn's plant and pivot), then hands back to the walk
// loop at the matching step or to the idle. Walls and cars still hold him out. Not while aiming, running, in a car or busy.
// ?mbtrans=0 with ?mbricks=1: the MotionBricks loops without the transitions.
import * as THREE from 'three';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _o = {};
export async function addMbTrans(g) {
  if (g.P.get('mbtrans') === '0') return null;
  const data = await (await fetch('assets/people/mbtrans.json')).json(), T = THREE;
  const st = { on: true, cur: null, plays: {}, data };
  const clipsFor = (vis) => {      // the clips as actions on this figure's mixer (made once per figure)
    if (vis._mbt) return vis._mbt; const out = {}, pre = vis.name || 'player';
    for (const [name, c] of Object.entries(data.clips)) {
      const F = c.frames, times = new Float32Array(F); for (let i = 0; i < F; i++) times[i] = i / data.fps;
      const tracks = [];
      data.bones.forEach((b, j) => { const v = new Float32Array(F * 4); for (let i = 0; i < F; i++) v.set(c.q[i][j], i * 4); tracks.push(new T.QuaternionKeyframeTrack(pre + '_' + b + '.quaternion', times, v)); });
      const hv = new Float32Array(F * 3); for (let i = 0; i < F; i++) hv.set(c.hips[i], i * 3); tracks.push(new T.VectorKeyframeTrack(pre + '_' + data.bones[0] + '.position', times, hv));
      const a = vis.mixer.clipAction(new T.AnimationClip(name + '_' + pre, c.dur, tracks)); a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; out[name] = a;
    }
    return (vis._mbt = out);
  };
  const rootAt = (c, t) => { const x = Math.min(c.frames - 1, Math.max(0, t * data.fps)), i = Math.floor(x), j = Math.min(c.frames - 1, i + 1), u = x - i, a = c.root[i], b = c.root[j]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; };
  const pa0 = g.playerAnim.bind(g); g.playerAnim = (name) => { if (st.cur) return; pa0(name); };
  const begin = (name, pl, x0, y0, h0) => {
    const vis = pl.vis, acts = clipsFor(vis), a = acts[name]; if (!a) return;
    if (vis.cur && vis.acts[vis.cur]) vis.acts[vis.cur].fadeOut(0.12);
    a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.12).play(); vis.cur = null;
    st.cur = { name, c: data.clips[name], a, t: 0, x0, y0, h0 }; st.plays[name] = (st.plays[name] || 0) + 1;
  };
  const finish = (pl, how) => {
    const S = st.cur; st.cur = null; const vis = pl.vis; S.a.fadeOut(0.18);
    if (how === 'walk') { const wk = (vis.walks || []).find((w) => w.name === 'walkbrisk') || (vis.walks || [])[0]; const n = wk ? wk.name : 'walk', b = vis.acts[n];
      if (b) { b.reset().fadeIn(0.18).play(); b.time = S.c.phase || 0; vis.cur = n; } }
    else if (vis.acts.idle) { vis.acts.idle.reset().fadeIn(0.25).play(); vis.cur = 'idle'; }
  };
  const step0 = g.step.bind(g);
  g.step = function (dt) {
    const pl = g.player, pre = { x: pl.x, y: pl.y, h: pl.h, sp: pl.speed || 0 };
    step0(dt);
    const vis = pl.vis, cb = g.combat;
    const free = st.on && vis && vis.mixer && !pl.vehicle && !pl.busy && !(cb && cb.stance) && !g.paused;
    if (!free) { if (st.cur) finish(pl, 'none'); return; }
    const I = g.input || {}, m = Math.hypot(I.mx || 0, I.my || 0), want = m > 0.1, run = !!I.run, aim = g.cam.yaw + Math.atan2(I.mx || 0, I.my || 0);
    let S = st.cur;
    if (S) {
      const k = S.name;
      if ((k === 'MbStop' && want) || (k !== 'MbStop' && (!want || run))) { finish(pl, want && !run ? 'walk' : 'none'); return; }      // the player changed his mind: back to the game's own
      S.t += dt;
      if (S.t >= S.c.dur) { const r = rootAt(S.c, S.c.dur); pl.h = S.h0 + r[2]; finish(pl, S.c.then); return; }
      const r = rootAt(S.c, S.t), c = Math.cos(S.h0), s = Math.sin(S.h0);
      const nx = S.x0 + r[0] * c - r[1] * s, ny = S.y0 + r[0] * s + r[1] * c;
      _o.x = nx; _o.y = ny; const hit = g.statics.resolve(nx, ny, 0.34, _o), ox = hit ? _o.x : nx, oy = hit ? _o.y : ny;
      if (Math.hypot(ox - nx, oy - ny) > 0.01) { S.x0 += ox - nx; S.y0 += oy - ny; }      // a wall: slide the path along it
      pl.x = ox; pl.y = oy; pl.h = S.h0 + r[2]; const sp = S.c.speed[Math.min(S.c.frames - 1, Math.floor(S.t * data.fps))]; pl.speed = sp;
      vis.mixer.timeScale = 1; return;
    }
    const walking = pre.sp > 0.2 && pre.sp < 2.6;
    if (pre.sp < 0.2 && want && !run && Math.abs(wrap(aim - pre.h)) < 0.6) { pl.x = pre.x; pl.y = pre.y; pl.h = pre.h; begin('MbStart', pl, pre.x, pre.y, pre.h); vis.mixer.timeScale = 1; }
    else if (walking && !want) { pl.x = pre.x; pl.y = pre.y; pl.h = pre.h; begin('MbStop', pl, pre.x, pre.y, pre.h); vis.mixer.timeScale = 1; }
    else if (walking && want && !run) { const d = wrap(aim - pre.h);
      if (Math.abs(d) > 2.4 || d > 1.1 || d < -1.1) { pl.x = pre.x; pl.y = pre.y; pl.h = pre.h; begin(Math.abs(d) > 2.4 ? 'MbTurnBack' : d > 0 ? 'MbTurnL' : 'MbTurnR', pl, pre.x, pre.y, pre.h); vis.mixer.timeScale = 1; } }
  };
  console.log('[mbricks] transitions on: ' + Object.keys(data.clips).join(', '));
  return st;
}
