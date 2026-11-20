// move/driftfx.js: what a slide looks like (driving lane, Nov 16): tyre smoke and skid marks from the car the player drives, both scaled by how
// hard the tyres are sliding, and a light rumble in a controller. Loaded by move/drift.js after the game is up; ?driftfx=0 = not fetched.
// The squeal is the game's own (sfx/ follows v.slip, which drift.js sets); the camera swing is in drift.js.
// COST: asleep unless the player's car is sliding or smoke is still in the air. Awake: two draws (one ribbon mesh of at most 1,600 quads for the
// marks, one instanced batch of at most 420 soft sprites for the smoke), a few hundred float writes a frame.
import * as THREE from 'three';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;

const MAXQ = 1600, MAXP = 900, MARK_Y = 0.024, HALF_W = 0.13;
// the smoke sprite: a soft round wisp with its own noise (the surprises kit's steam sprite, so smoke and steam sit in the picture the same way)
const PVERT = `attribute vec4 aPos; attribute vec4 aCol; attribute float aSeed; varying vec2 vQ; varying vec4 vC; varying float vSeed; varying vec2 vRot;
  void main(){ vQ = position.xy * 2.0; vC = aCol; vSeed = aSeed; vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0); float s = aPos.w;
    vC.a *= smoothstep(1.5, 5.0, -mv.z);      /* thin close to the camera: the chase camera sits in the car's own trail, and smoke there would be a white sheet over the picture */
    float a = aSeed * 6.2831853; float c = cos(a), sn = sin(a); vRot = vec2(c, sn); mv.xy += vec2(c * position.x - sn * position.y, sn * position.x + c * position.y) * s;
    gl_Position = projectionMatrix * mv; if (aCol.a <= 0.0 || s <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const PFRAG = `varying vec2 vQ; varying vec4 vC; varying float vSeed; varying vec2 vRot;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){ float r = length(vQ); if (r >= 1.0) discard;
    float n = vn(vQ * 1.3 + vSeed * 37.0) * 0.65 + vn(vQ * 2.9 - vSeed * 11.0) * 0.35; float e = 1.0 - r; float a = e * e * (3.0 - 2.0 * e) * (0.25 + 0.75 * smoothstep(0.25, 0.7, n + e * 0.3));
    float up = vRot.y * vQ.x + vRot.x * vQ.y;      /* how far up the screen this bit of the puff is, -1..1 */
    float lit = (0.66 + 0.4 * smoothstep(-0.7, 0.75, up + (n - 0.5) * 0.9)) * (0.9 + 0.2 * n);      /* the day's light falls from above: tops bright, undersides in their own shade, lumps catching it */
    a *= vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb * lit * a, a); }`;

export function install(g, D) {
  const w = g.world, scene = w.scene, F = (n) => new Float32Array(n);
  const X = { on: true, marks: 0, puffs: 0, live: 0, k: 0, fails: 0, ms: 0 };
  // ---- skid marks: one ribbon mesh, written round and round (the oldest marks are the ones replaced)
  const mPos = new THREE.BufferAttribute(F(MAXQ * 12), 3), mCol = new THREE.BufferAttribute(F(MAXQ * 16), 4); mPos.setUsage(THREE.DynamicDrawUsage); mCol.setUsage(THREE.DynamicDrawUsage);
  const idx = new Uint16Array(MAXQ * 6); for (let i = 0; i < MAXQ; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  const mGeo = new THREE.BufferGeometry(); mGeo.setAttribute('position', mPos); mGeo.setAttribute('color', mCol); mGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  // the marks DARKEN the road under them (what is there times 1 - alpha) instead of painting a colour over it: a painted black picked up the night's and the
  // rain's haze and stood out as pale bands on a dark wet road (seen Nov 17, tod 22 + rain); darkening is right in any light
  const mMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const marks = new THREE.Mesh(mGeo, mMat); marks.frustumCulled = false; marks.matrixAutoUpdate = false; marks.renderOrder = 3; marks.name = 'drift_marks'; marks.visible = false; scene.add(marks);
  let q = 0, used = 0;
  const range = (a, start, count) => { if (a.addUpdateRange) a.addUpdateRange(start, count); a.needsUpdate = true; };
  function quad(ax, ay, bx, by, cx, cy, dx, dy, z, a0, a1) {     // a, b: the last pair of edge points; c, d: the new pair (c beside b)
    const P = mPos.array, C = mCol.array, o = q * 12, k = q * 16;
    P[o] = ax; P[o + 1] = z; P[o + 2] = -ay; P[o + 3] = bx; P[o + 4] = z; P[o + 5] = -by; P[o + 6] = cx; P[o + 7] = z; P[o + 8] = -cy; P[o + 9] = dx; P[o + 10] = z; P[o + 11] = -dy;
    for (let i = 0; i < 4; i++) { C[k + i * 4] = 0.02; C[k + i * 4 + 1] = 0.02; C[k + i * 4 + 2] = 0.022; C[k + i * 4 + 3] = i < 2 ? a0 : a1; }
    range(mPos, o, 12); range(mCol, k, 16); q = (q + 1) % MAXQ; used = Math.min(MAXQ, used + 1); mGeo.setDrawRange(0, used * 6); marks.visible = true; X.marks++;
  }
  // ---- smoke
  const base = new THREE.PlaneGeometry(1, 1), pGeo = new THREE.InstancedBufferGeometry(); pGeo.index = base.index; pGeo.setAttribute('position', base.attributes.position);
  const aPos = new THREE.InstancedBufferAttribute(F(MAXP * 4), 4), aCol = new THREE.InstancedBufferAttribute(F(MAXP * 4), 4), aSeed = new THREE.InstancedBufferAttribute(F(MAXP), 1);
  for (const a of [aPos, aCol, aSeed]) a.setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aPos', aPos); pGeo.setAttribute('aCol', aCol); pGeo.setAttribute('aSeed', aSeed); pGeo.instanceCount = 0;
  const pMat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const smoke = new THREE.Mesh(pGeo, pMat); smoke.frustumCulled = false; smoke.matrixAutoUpdate = false; smoke.renderOrder = 6; smoke.name = 'drift_smoke'; smoke.visible = false; scene.add(smoke);
  const pp = F(MAXP * 3), pv = F(MAXP * 3), age = F(MAXP), life = F(MAXP), s0 = F(MAXP), s1 = F(MAXP), al = F(MAXP), sd = F(MAXP), sh = F(MAXP); let n = 0;
  function puff(x, y, h, vx, vy, vh, o) { if (n >= MAXP) return; const i = n++; pp[i * 3] = x; pp[i * 3 + 1] = y; pp[i * 3 + 2] = h; pv[i * 3] = vx; pv[i * 3 + 1] = vy; pv[i * 3 + 2] = vh; age[i] = 0; life[i] = o.life; s0[i] = o.s0; s1[i] = o.s1; al[i] = o.a; sd[i] = Math.random(); sh[i] = o.sh; X.puffs++; }
  function kill(i) { const j = --n; if (i === j) return; for (let k = 0; k < 3; k++) { pp[i * 3 + k] = pp[j * 3 + k]; pv[i * 3 + k] = pv[j * 3 + k]; } age[i] = age[j]; life[i] = life[j]; s0[i] = s0[j]; s1[i] = s1[j]; al[i] = al[j]; sd[i] = sd[j]; sh[i] = sh[j]; }
  const light = [1, 1, 1];
  function drawSmoke(dt) {
    for (let i = n - 1; i >= 0; i--) { age[i] += dt; if (age[i] >= life[i]) { kill(i); continue; } const o = i * 3, k = Math.max(0, 1 - 1.6 * dt); pv[o] *= k; pv[o + 1] *= k; pv[o + 2] = pv[o + 2] * Math.max(0, 1 - 0.6 * dt) + 1.15 * dt; pp[o] += pv[o] * dt; pp[o + 1] += pv[o + 1] * dt; pp[o + 2] += pv[o + 2] * dt; }
    { const f = scene.fog ? scene.fog.color : { r: 0.62, g: 0.68, b: 0.8 }, nn = g.night ? g.night.n || 0 : 0, s = (1 - nn) * 0.35; light[0] = f.r + s; light[1] = f.g + s * 0.97; light[2] = f.b + s * 0.9; }
    const P = aPos.array, C = aCol.array, S = aSeed.array;
    for (let i = 0; i < n; i++) { const u = age[i] / life[i], fin = Math.min(1, u / 0.08), out = 1 - clamp((u - 0.45) / 0.55, 0, 1); const sz = lerp(s0[i], s1[i], Math.sqrt(u)); P[i * 4] = pp[i * 3]; P[i * 4 + 1] = Math.max(pp[i * 3 + 2], sz * 0.4); P[i * 4 + 2] = -pp[i * 3 + 1]; P[i * 4 + 3] = sz;
      C[i * 4] = sh[i] * light[0]; C[i * 4 + 1] = sh[i] * light[1]; C[i * 4 + 2] = sh[i] * light[2]; C[i * 4 + 3] = al[i] * fin * out; S[i] = sd[i]; }
    pGeo.instanceCount = n; smoke.visible = n > 0; X.live = n;
    if (n) { for (const a of [aPos, aCol]) { a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, n * 4); a.needsUpdate = true; } aSeed.clearUpdateRanges && aSeed.clearUpdateRanges(); aSeed.addUpdateRange && aSeed.addUpdateRange(0, n); aSeed.needsUpdate = true; }
  }
  // ---- the wheels of the player's car: where each touches the road, and what its last mark point was
  const W = [0, 1, 2, 3].map(() => ({ has: false, lx: 0, ly: 0, rx: 0, ry: 0, a: 0, px: 0, py: 0, acc: 0 })); let car = null, rumT = 0;
  const wheelsOf = (v) => { if (v._dfxW) return v._dfxW; const d = v.def, ws = d.wheels && d.wheels.length === 4 && d.wheels.every((q) => q && q.pos) ? d.wheels.map((q) => ({ f: q.pos.x, r: q.pos.z, front: q.pos.x > 0 })) : null, wb = d.wheelbase || 2.7, tr = (d.wid || 1.9) * 0.4;
    return (v._dfxW = ws || [{ f: wb / 2, r: -tr, front: true }, { f: wb / 2, r: tr, front: true }, { f: -wb / 2, r: -tr, front: false }, { f: -wb / 2, r: tr, front: false }]); };
  function frame(dt) {
    const pl = g.player, v = pl && pl.vehicle && !pl.vehicle.moto && D.on && X.on ? pl.vehicle : null;
    if (v !== car) { car = v; for (const s of W) s.has = false; }
    let k = 0, sig = 0, sliding = false, noSmoke = false; const wet = g.rain && g.rain.wet > 0 ? Math.min(1, g.rain.wet) : 0, dryK = 1 - 0.75 * wet;     // on a wet road tyres make little smoke and leave faint marks
    if (v && dt > 0) { const S = v._dr, sp = Math.hypot(v.vx, v.vy), hb = !!(g.input && g.input.handbrake);
      sliding = !!(S && S.on); sig = sliding ? S.sig : 0; const wSq = !sliding && v._wtQ > 0 ? v._wtQ : 0;     /* weight.js's own share of v.slip: tyres squealing in an ordinary corner. That is a sound, not smoke: here it leaves only a faint scuff when the fronts scrub hard */
      k = clamp(((wSq ? 0 : (v.slip || 0)) - 1.7) / 4.3, 0, 1); if (wSq > 4.2) k = Math.max(k, 0.07 + 0.1 * clamp((wSq - 4.2) / 1.6, 0, 1)); noSmoke = wSq > 0; if (hb && sp > 3) k = Math.max(k, 0.45); if (sp < 1.2) k = 0;
      if (k > 0.04 || W.some((s) => s.has)) { const c = Math.cos(v.h), s = Math.sin(v.h), ws = wheelsOf(v), z = (v.z || 0) + MARK_Y, ux = sp > 0.5 ? v.vx / sp : c, uy = sp > 0.5 ? v.vy / sp : s;
        for (let i = 0; i < 4; i++) { const wq = ws[i], st = W[i], x = v.x + c * wq.f + s * wq.r, y = v.y + s * wq.f - c * wq.r;
          // the rears mark whenever they slide; the fronts only in a real four-wheel slide, and fainter
          const a = (wq.front ? (sliding && Math.abs(sig) > 0.3 ? 0.55 * clamp((Math.abs(sig) - 0.3) / 0.3, 0, 1) : 0) : 1) * (k < 0.06 ? 0 : 0.52 + 0.43 * k) * (1 - 0.65 * wet);
          const lx = x - uy * HALF_W, ly = y + ux * HALF_W, rx = x + uy * HALF_W, ry = y - ux * HALF_W;
          if (!st.has) { if (a > 0) { st.has = true; st.lx = lx; st.ly = ly; st.rx = rx; st.ry = ry; st.a = 0; st.px = x; st.py = y; } }
          else { const d = Math.hypot(x - st.px, y - st.py); if (d > 3) st.has = false; else if (d > 0.16 || a <= 0) { quad(st.lx, st.ly, st.rx, st.ry, rx, ry, lx, ly, z, st.a, a); st.lx = lx; st.ly = ly; st.rx = rx; st.ry = ry; st.a = a; st.px = x; st.py = y; if (a <= 0) st.has = false; } }
          // smoke from the rears (and a little from the fronts in a big slide), more of it the harder they slide; none in the rain's spray
          if (!noSmoke && (!wq.front || (sliding && Math.abs(sig) > 0.5))) { st.acc += (wq.front ? 14 : 46) * dryK * k * k * dt * clamp(sp / 9, 0.35, 1.2); let cap = 4;
            while (st.acc >= 1 && cap-- > 0) { st.acc -= 1; const sp2 = 0.5 + Math.random() * 0.9, an = Math.random() * 6.283, big = 0.75 + 0.6 * Math.random();
              puff(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, (v.z || 0) + 0.12, v.vx * 0.17 + Math.cos(an) * sp2, v.vy * 0.17 + Math.sin(an) * sp2, 0.9 + Math.random() * 1.1,
                { life: 2.1 + 1.6 * Math.random(), s0: 0.32 * big, s1: (1.7 + 1.2 * k) * big, a: (0.085 + 0.115 * k) * (0.7 + 0.5 * Math.random()), sh: 0.62 + 0.2 * Math.random() }); } if (st.acc > 4) st.acc = 4; } } }
      // a controller hums with the slide
      if (k > 0.2 && (rumT -= dt) <= 0) { rumT = 0.09; try { const pads = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of pads) if (p && p.connected && p.vibrationActuator && p.vibrationActuator.playEffect) { p.vibrationActuator.playEffect('dual-rumble', { duration: 110, weakMagnitude: 0.15 + 0.45 * k, strongMagnitude: 0.25 * k }); break; } } catch (e) {} }
    }
    X.k = k;
    if (n || k > 0) drawSmoke(dt); else if (smoke.visible) { smoke.visible = false; pGeo.instanceCount = 0; }
  }
  // told once a visit, the first time the player is rolling in a car: how to slide (keys, or the pad's buttons if the last input was a pad). ?drifthint=0 = never
  let told = !!(g.P && g.P.get('drifthint') === '0') || !!g.demo || !!g.capture, tellT = 0;
  function tell(dt) { if (told) return; const v = g.player && g.player.vehicle; if (!v || v.moto || !D.on || Math.hypot(v.vx, v.vy) < 7) { tellT = 0; return; } if ((tellT += dt) < 1.2) return; told = true;
    try { let pad = false; try { for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) if (p && p.connected && (p.buttons.some((b) => b && b.pressed) || p.axes.some((a) => Math.abs(a) > 0.3))) pad = true; } catch (e) {}
      const d = document.createElement('div'); d.id = 'drifthint'; d.textContent = pad ? 'DRIFT: hold A and steer to kick the tail out, then keep the stick in and the gas on' : 'DRIFT: hold SPACE and turn to kick the tail out, then keep turning with the gas on';
      d.style.cssText = 'position:fixed;left:50%;bottom:17%;transform:translateX(-50%);z-index:55;pointer-events:none;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(14,16,20,.78);padding:8px 16px;border-radius:8px;border-left:4px solid #ffb82e;transition:opacity 1s';
      document.body.appendChild(d); setTimeout(() => { d.style.opacity = 0; }, 6500); setTimeout(() => d.remove(), 7700); } catch (e) {} }
  // before each drawn frame (the world's render wrapped once, as the surprises kit does)
  let last = 0; const render0 = w.render.bind(w);
  w.render = function (t, focus) { const now = performance.now(), dt = g.paused || !last ? 0 : Math.min(0.1, (now - last) / 1000); last = now;
    if (X.fails < 20) { try { frame(dt); tell(dt); } catch (e) { if (++X.fails <= 3) console.warn('[drift] effects: ' + String((e && e.stack) || e).slice(0, 400)); } }
    X.ms = performance.now() - now; return render0(t, focus); };
  X.marksMesh = marks; X.smokeMesh = smoke;
  X.clear = () => { used = 0; q = 0; mGeo.setDrawRange(0, 0); marks.visible = false; n = 0; for (const s of W) s.has = false; };
  X.info = () => ({ marks: X.marks, markQuads: used, puffs: X.puffs, live: n, k: +X.k.toFixed(2), fails: X.fails, ms: +X.ms.toFixed(3) });
  return X;
}
