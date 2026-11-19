// sky/nightkit.js: what the night needs beyond dimming the sun and sky (night.js). Fetched the first time the light leaves full day; everything here is
// hidden or switched off again by day (apply(0)).
//  1. LAMP AND HEADLIGHT LIGHT, a screen pass after the scene is drawn (one full-screen pass plus an add): for every pixel it finds the point in the world
//     from the depth picture, looks up how much street-lamp light falls there in a top-down "lamp map" drawn once from the real lamp-post positions
//     (2 m a pixel), adds the cones of up to 10 pairs of headlights near the camera, and adds that light times the surface's own colour. The surface
//     colour is ESTIMATED from the pixel as drawn (pixel / night ambient), since this renderer keeps no albedo picture: so the added light also picks up
//     baked shade and contact shadows (dark corners stay darker, which reads as shadow) but NOTHING casts a new shadow from a lamp or a headlight.
//     It lights whatever is on screen: road, sidewalk, cars, people, trees, the lower walls. Not in the wet-road mirror or the glass reflections' cube.
//  2. Glows: a bright head on every street lamp, and head and tail lamps on moving traffic and the player's car (instanced sprites, one draw each).
//  3. Lit windows: the facade shader's own rooms (facade.js roomColor) take a uniform, uNightK: daylight in the rooms goes down, more rooms are "lit" and
//     lit rooms and their blinds glow warm or cool. Needs the three-line facade.js patch and the one-line world.js patch; without them windows stay dark.
//  4. Stars, a moon where the sun was, a glow along the horizon.
import * as THREE from 'three';

const NS = 10;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;

/* merge2 round 23: with the stronger lamp light (T.lamp 1.3) the brightest part of each pool is held back to about what it was (x0.58 at the core), so ground that was already bright does not go to 'near-daylight white'; the gain is in the dim reach of each lamp */
/* merge2 round 24: the street lamps' light on the scene is warmed (x 1.08, 0.94, 0.74): round 23's critic: 'every lamp is the same cold white, so the lit trees and walls look moonlit'. ?warmlamp=0 = as before */
const WARMLAMP = (() => { try { return new URLSearchParams(location.search).get('warmlamp') !== '0'; } catch (e) { return true; } })();
const CITYLAMP = (() => { try { return new URLSearchParams(location.search).get('citylamp') !== '0'; } catch (e) { return true; } })();
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const LIGHT_FS = `
precision highp float; precision highp sampler2D;
uniform sampler2D tDepth, tScene, tLamp; uniform mat4 uInvProj, uCamW; uniform vec4 uMap; uniform vec3 uCamPos; uniform float uLamp, uAmb, uHead, uWet;
uniform vec4 uSpotP[${NS}]; uniform vec4 uSpotD[${NS}]; uniform int uSpotN; varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).x; if (d >= 0.9999995) { gl_FragColor = vec4(0.0); return; }
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; vec3 wp = (uCamW * v).xyz;
  vec3 n = normalize(cross(dFdx(wp), dFdy(wp))); if (dot(n, uCamPos - wp) < 0.0) n = -n;
  vec3 lamp = texture2D(tLamp, (wp.xz - uMap.xy) * uMap.zw).rgb;
  vec3 L = lamp * lamp * uLamp * ${WARMLAMP ? 'vec3(1.08, 0.94, 0.74) * ' : ''}${CITYLAMP ? '(1.0 - 0.42 * smoothstep(0.5, 0.95, max(lamp.r, max(lamp.g, lamp.b)))) * ' : ''}(1.0 - smoothstep(7.5, 12.0, wp.y)) * clamp(0.55 + 0.45 * n.y, 0.1, 1.0);
  for (int i = 0; i < ${NS}; i++) { if (i >= uSpotN) break; vec3 to = wp - uSpotP[i].xyz; float ds = length(to); vec3 l = to / max(ds, 1e-3); float c = dot(l, uSpotD[i].xyz);
    float cone = smoothstep(0.80, 0.975, c) + 0.10 * smoothstep(0.2, 0.8, c); float att = (1.0 - smoothstep(uSpotP[i].w * 0.55, uSpotP[i].w, ds)) / (1.0 + 0.012 * ds * ds);
    L += vec3(1.0, 0.95, 0.86) * (uHead * uSpotD[i].w * cone * att * mix(0.32, 1.0, max(dot(n, -l), 0.0))); }
  L *= 1.0 - 0.6 * uWet * smoothstep(0.7, 0.95, n.y);      /* light, rain 2: wet ground throws lamp and headlight light on, away from the eye (sky/rain.js sets uWet) */
  vec3 alb = clamp(texture2D(tScene, vUv).rgb / uAmb, 0.0, 1.0);
  gl_FragColor = vec4(alb * L, 1.0);
}`;

class LightPass {
  constructor(world) { this.w = world; this.enabled = false; this.needsSwap = false; this.clear = false; this.renderToScreen = false;
    const c = world.composer, W = c.renderTarget1.width, H = c.renderTarget1.height;
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.u = { tDepth: { value: null }, tScene: { value: null }, tLamp: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uMap: { value: new THREE.Vector4(0, 0, 1, 1) }, uLamp: { value: 0 }, uAmb: { value: 0.05 }, uHead: { value: 0 }, uWet: { value: 0 },
      uSpotP: { value: Array.from({ length: NS }, () => new THREE.Vector4()) }, uSpotD: { value: Array.from({ length: NS }, () => new THREE.Vector4()) }, uSpotN: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: QUAD_VS, fragmentShader: LIGHT_FS, depthTest: false, depthWrite: false });
    this.addMat = new THREE.ShaderMaterial({ uniforms: { t: { value: this.rt.texture } }, vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 0.0); }', depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    const geo = new THREE.PlaneGeometry(2, 2); this.s1 = new THREE.Scene(); this.s1.add(new THREE.Mesh(geo, this.mat)); this.s2 = new THREE.Scene(); this.s2.add(new THREE.Mesh(geo, this.addMat)); this.s1.children[0].frustumCulled = this.s2.children[0].frustumCulled = false; this.drawn = 0; }
  setSize(w, h) { this.rt.setSize(w, h); }
  dispose() { this.rt.dispose(); this.mat.dispose(); this.addMat.dispose(); }
  render(r, wb, rb) { const w = this.w, g = w.gtao, ps = w.composer.passes, aoRan = g && g.enabled && ps.indexOf(g) >= 0 && ps.indexOf(g) < ps.indexOf(this), src = aoRan ? wb : rb, dep = src.depthTexture; if (!dep) return;      // (4x multisampled stills have no depth picture: no lamp light there)
    const u = this.u, cam = w.camera; u.tDepth.value = dep; u.tScene.value = src.texture; u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uCamW.value.copy(cam.matrixWorld); u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    const old = r.getRenderTarget(), ac = r.autoClear; r.autoClear = false; r.setRenderTarget(this.rt); r.render(this.s1, this.cam); r.setRenderTarget(rb); r.render(this.s2, this.cam); r.setRenderTarget(old); r.autoClear = ac; this.drawn++; }
}

const GLOW_VS = `attribute vec3 aPos; attribute vec4 aCol; attribute vec4 aDir; uniform float uOn, uMinAng; varying vec2 vQ; varying vec3 vC;
  void main(){ vQ = position.xy; vec4 mv = viewMatrix * vec4(aPos, 1.0); float dist = -mv.z; float sz = max(aCol.w, dist * uMinAng);
    float face = aDir.w > 0.5 ? smoothstep(-0.15, 0.45, dot(aDir.xyz, normalize(cameraPosition - aPos))) : 1.0;
    vC = aCol.rgb * uOn * face * min(1.0, aCol.w / max(sz, 1e-4) * 1.6); mv.xy += position.xy * sz; gl_Position = projectionMatrix * mv; if (uOn * face <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const GLOW_FS = `varying vec2 vQ; varying vec3 vC; void main(){ float r = length(vQ); if (r > 1.0) discard; float core = smoothstep(0.20, 0.07, r), halo = exp(-r * r * 7.0) * (1.0 - r); gl_FragColor = vec4(vC * (core * 7.0 + halo * 0.55), 1.0); }`;
function glowMesh(cap, minAng) { const base = new THREE.PlaneGeometry(2, 2), geo = new THREE.InstancedBufferGeometry(); geo.index = base.index; geo.setAttribute('position', base.attributes.position);
  const P = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3), C = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), D = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  geo.setAttribute('aPos', P); geo.setAttribute('aCol', C); geo.setAttribute('aDir', D); geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({ uniforms: { uOn: { value: 0 }, uMinAng: { value: minAng } }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 6; m.visible = false; m.matrixAutoUpdate = false; m.name = 'night_glow'; m.layers.enable(3);
  return { m, P, C, D, mat, geo, cap, n: 0, put(i, x, y, z, r, g, b, size, dx, dy, dz, directional) { P.setXYZ(i, x, y, z); C.setXYZW(i, r, g, b, size); D.setXYZW(i, dx || 0, dy || 0, dz || 0, directional ? 1 : 0); } }; }

/* merge2 round 20 (Nov 18): a city sky at night: a fifth of the stars at a third of the brightness, and twice the glow on the horizon haze (critic, round 19: 'large hard white stars' over Manhattan; real: 'no stars, or two or three', a dull orange-grey sky brightest at the horizon). ?citysky=0 = as before */
/* merge2 round 30 (Nov 19): a quarter of the stars that were left, each under half the size ('too big, pure white, all one size'; real: 'one or two faint points at most'). ?fewstars=0 = as before */
const FEWSTARS = (() => { try { return new URLSearchParams(location.search).get('fewstars') !== '0'; } catch (e) { return true; } })();
const CITYSKY = (() => { try { return new URLSearchParams(location.search).get('citysky') !== '0'; } catch (e) { return true; } })();
const SKY_FS = `uniform vec3 uMoon; uniform float uN, uDusk, uCloud; uniform vec3 uCloudCol; varying vec3 vDir;
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main(){ vec3 d = normalize(vDir); vec3 c = vec3(0.0);
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 90.0; vec2 ci = floor(sp), cf = fract(sp) - 0.5; float h = h21(ci);
    float star = step(${CITYSKY ? (FEWSTARS ? '0.9993' : '0.997') : '0.985'}, h) * smoothstep(${CITYSKY && FEWSTARS ? '0.07' : '0.16'}, 0.0, length(cf - (vec2(h21(ci + 7.0), h21(ci + 13.0)) - 0.5) * 0.6)) * (0.25 + 2.5 * fract(h * 91.7)) * smoothstep(0.03, 0.3, d.y);
    c += vec3(0.8, 0.9, 1.0) * star * ${CITYSKY ? '0.16' : '0.5'} * uN * uN;
    float md = acos(clamp(dot(d, uMoon), -1.0, 1.0)); float disc = smoothstep(0.0135, 0.0115, md); float mare = 0.8 + 0.2 * h21(floor(d.xy * 260.0));
    c += vec3(0.95, 0.97, 1.0) * (disc * 2.2 * mare + 0.035 * exp(-md * 16.0) + 0.012 * exp(-md * 3.5)) * smoothstep(0.6, 1.0, uN);
    float hz = exp(-max(d.y, 0.0) * ${CITYSKY ? '5.0' : '7.0'}); c += vec3(0.055, 0.036, 0.022) * ${CITYSKY ? '1.45' : '1.0'} * hz * uN;                       // the city's own glow on the haze
    c += vec3(0.9, 0.36, 0.12) * uDusk * exp(-max(d.y, 0.0) * 4.5) * (0.35 + 0.65 * pow(max(dot(normalize(d.xz), normalize(uMoon.xz)), 0.0), 2.0));
    // rain: a grey deck over everything (stars, moon and the blue sky behind it go)
    float cn = h21(floor(d.xz / max(d.y + 0.25, 0.05) * 3.0)); float a = uCloud * 0.94; vec3 cc = uCloudCol * (0.82 + 0.18 * cn) * mix(1.0, 0.72, smoothstep(0.0, 0.7, d.y));
    c = c * (1.0 - a) + cc * a + vec3(0.055, 0.036, 0.022) * hz * uN * a;
    float m = smoothstep(-0.03, 0.02, d.y); gl_FragColor = vec4(c * m, a * m); }`;

export async function makeKit(game, N) {
  const g = game, w = g.world, P = g.P || new URLSearchParams(location.search), T = N.tune;
  const K = { pass: null, lamps: null, cars: null, sky: null, lampN: 0, spots: 0, carN: 0, patched: !!w.shared.uNightK, map: null };
  /* merge2 round 23 (Nov 18): more street-lamp light on what stands round the lamps and more, brighter lit windows (lamp 0.75 -> 1.3, win 0.55 -> 0.8, winFrac 0.36 -> 0.5; round 19 audit: lamps were 'dots with no pools of light'). ?citylamp=0 = as before */
  Object.assign(T, P.get('citylamp') === '0' ? { lamp: 0.75, head: 2.2, amb: 1.0, win: 0.55, winFrac: 0.36, glow: 1.0, fx: 4.5 } : { lamp: 1.3, head: 2.2, amb: 1.0, win: 0.8, winFrac: P.get('morewin') === '0' ? 0.5 : 0.72 /* merge2 round 27 (Nov 18): more windows lit at night, 0.5 -> 0.72 ('the street wall reads lived-in rather than half-vacant'); ?morewin=0 = as before */, glow: 1.0, fx: 4.5 }, Object.fromEntries(['lamp', 'head', 'amb', 'win', 'winFrac', 'glow', 'fx'].filter((k) => P.has('N' + k)).map((k) => [k, +P.get('N' + k)])));
  if (!K.patched) console.log('[night] facade.js / world.js patch not there: windows stay dark');
  // light, Nov 15 (the white patch by the plaza lamps at night): the combat effects' smoke, steam, dust and mist (combat/fx.js) are unlit quads whose colours
  // are fixed DAY numbers times fx.day, and fx.day was 1.0 at all hours: steam off a damaged car's hood is .5 in scene light, a wreck's smoke .16, powder
  // smoke .2, while the night street around is about .006 and the night exposure 3.2: the cloud drew near white, and the lamp pass above then read it as
  // a white surface (pixel / night ambient clamps to 1) and added the full lamp light of whatever stood behind it. They are things with their daylight
  // painted in, like the hero walls below, so fx.day now follows the same number (dimK) times T.fx (?Nfx=). At 2.45 fx.day would be the kit's own night
  // ambient (uAmb, .052 at 22:00) and a particle's colour number its albedo in the lamp pass. Seen on laptop 2 at 22:00: at 1.5 and 2.45 steam and smoke
  // cannot be made out at all; at 3.5 and 4.5 there is no white patch under the plaza lamps and a faint grey column on a dark road, a little plainer at
  // 4.5 (steam then reads as albedo .92, a wreck's smoke .29): 4.5 it is. Higher was not tried: steam would pass albedo 1, the old fault's own mechanism.
  // 1 by day. ?nightfx=0 = as before (fx.day never touched).
  const NFX = P.get('nightfx') !== '0'; K.fxDay = 1;
  const setFx = () => { if (!NFX) return; const fx = g.combat && g.combat.fx; if (fx && fx.day !== K.fxDay) fx.day = K.fxDay; };

  // ---------------------------------------------------------------- street lamps: where they are (the streets layer's own list), their map, their glows
  const heads = [];
  try { const F = g.streets && g.streets.parts && g.streets.parts.furniture, kinds = F && F.kinds;
    const L = kinds && kinds.lampLod && kinds.lampLod.list; if (L) for (const it of L) { const s = (it[4] && typeof it[4].s === 'number' ? it[4].s : 1), h = it[3] || 0; heads.push([it[0] + Math.cos(h) * 2.8 * s, it[1] + Math.sin(h) * 2.8 * s, (8.4 + 1.25) * s + (it[2] || 0), 1]); }
    const Tw = kinds && kinds.twin && kinds.twin.list; if (Tw) for (const it of Tw) heads.push([it[0], it[1], 4.2 + (it[2] || 0), 0.6]);
  } catch (e) { console.warn('[night] lamp list: ' + e.message); }
  K.lampN = heads.length; K.heads = heads;      /* light, rain 2: sky/rain.js reads the lamp heads */
  if (heads.length) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const h of heads) { x0 = Math.min(x0, h[0]); x1 = Math.max(x1, h[0]); y0 = Math.min(y0, h[1]); y1 = Math.max(y1, h[1]); } x0 -= 40; x1 += 40; y0 -= 40; y1 += 40;
    const S = Math.min(0.5, 2048 / Math.max(x1 - x0, y1 - y0)), cw = Math.ceil((x1 - x0) * S), ch = Math.ceil((y1 - y0) * S), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch); c.globalCompositeOperation = 'lighter';
    for (const h of heads) { const px = (h[0] - x0) * S, py = (y1 - h[1]) * S, R = 21 * S * (0.6 + 0.4 * h[3]), gr = c.createRadialGradient(px, py, 0, px, py, R), k = h[3];      // the map stores the square root of the light (8 bits hold the dim skirts better)
      for (const [t, v] of [[0, 0.80], [0.18, 0.70], [0.38, 0.50], [0.6, 0.30], [0.8, 0.13], [1, 0]]) gr.addColorStop(t, `rgb(${Math.round(255 * v * k)},${Math.round(232 * v * k)},${Math.round(196 * v * k)})`);
      c.fillStyle = gr; c.fillRect(px - R, py - R, 2 * R, 2 * R); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    K.map = { tex, rect: [x0, -y1, 1 / (x1 - x0), 1 / (y1 - y0)], size: [cw, ch] };      // three z = -map y: v = (z - (-y1)) / height, row 0 = north
    const G = (K.lamps = glowMesh(heads.length, 0.0016)); heads.forEach((h, i) => G.put(i, h[0], h[2], -h[1], 1.0 * h[3], 0.9 * h[3], 0.74 * h[3], 0.55)); G.geo.instanceCount = heads.length; G.P.needsUpdate = G.C.needsUpdate = G.D.needsUpdate = true; w.scene.add(G.m);
  }

  // ---------------------------------------------------------------- the screen pass
  try { const comp = w.composer, ps = comp.passes, at = w.gtao && ps.indexOf(w.gtao) >= 0 ? ps.indexOf(w.gtao) + 1 : Math.max(1, ps.indexOf(w.nearPass) + 1); const pass = new LightPass(w); comp.insertPass(pass, at); K.pass = pass;
    if (K.map) { pass.u.tLamp.value = K.map.tex; pass.u.uMap.value.set(...K.map.rect); } else pass.u.tLamp.value = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); if (!K.map) pass.u.tLamp.value.needsUpdate = true;
  } catch (e) { console.warn('[night] light pass: ' + (e && e.message)); }

  // ---------------------------------------------------------------- car lamps (moving traffic and the player's car)
  const C = (K.cars = glowMesh(4 * 96, 0.0011)); w.scene.add(C.m);
  const LAMP_H = { bus: 0.95, van: 0.82, suv: 0.8, truck: 0.95 };
  const cand = [];
  const carLights = () => { const cam = w.camera.position, cx = cam.x, cy = -cam.z; let n = 0; cand.length = 0; const pv = g.player.vehicle;
    const one = (c, mine) => { const dx = c.x - cx, dy = c.y - cy, d2 = dx * dx + dy * dy; if (d2 > 260 * 260 || c.gone) return; const def = c.def || {}, len = def.len || 4.6, wid = def.wid || 1.85, co = Math.cos(c.h), si = Math.sin(c.h), hz = (LAMP_H[c.type] || 0.66) + (c.z || 0), fx = len / 2 - 0.06, ly = wid / 2 - 0.27;
      if (n + 4 > C.cap) return;
      // The RAV4's rear clusters are inset from the bumper and higher than its headlights.
      const rav4 = c.type === 'au_rav4';
      const rearOffset = rav4 ? 2.12 : fx;
      const rearHeight = rav4 ? (c.z || 0) + 1.15 : hz + 0.12;
      for (const s of [-1, 1]) { C.put(n++, c.x + co * fx - si * ly * s, hz, -(c.y + si * fx + co * ly * s), 1.0, 0.96, 0.86, 0.26, co, -0.05, -si, true);
        const br = c.brake || (mine && g.input && g.input.brake > 0.1) ? 1 : 0.34; C.put(n++, c.x - co * rearOffset - si * ly * s, rearHeight, -(c.y - si * rearOffset + co * ly * s), 1.0 * br, 0.05 * br, 0.03 * br, 0.2, -co, 0, si, true); }
      cand.push([mine ? -1 : d2, c.x + co * (fx + 0.15), hz, -(c.y + si * (fx + 0.15)), co, -si]); };
    try { for (const c of g.traffic.cars) one(c, false); if (pv) one(pv, true); } catch (e) {}
    C.geo.instanceCount = n; C.P.needsUpdate = C.C.needsUpdate = C.D.needsUpdate = true; K.carN = n / 4;
    if (K.pass) { cand.sort((a, b) => a[0] - b[0]); const u = K.pass.u, m = Math.min(NS, cand.length); for (let i = 0; i < m; i++) { const q = cand[i]; u.uSpotP.value[i].set(q[1], q[2], q[3], 46); const il = Math.hypot(q[4], q[5], 0.075); u.uSpotD.value[i].set(q[4] / il, -0.075 / il, q[5] / il, 1); } u.uSpotN.value = m; K.spots = m; } };

  // ---------------------------------------------------------------- stars, moon, horizon glow
  { const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, fog: false, toneMapped: false, uniforms: { uMoon: { value: w.sunDir.clone() }, uN: { value: 0 }, uDusk: { value: 0 }, uCloud: { value: 0 }, uCloudCol: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 0.0); gl_Position = projectionMatrix * vec4(p.xyz, 1.0); gl_Position.z = gl_Position.w * 0.9999999; }', fragmentShader: SKY_FS });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat); m.scale.setScalar(4900); m.frustumCulled = false; m.renderOrder = -9; m.visible = false; m.name = 'night_sky'; m.layers.enable(3); m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); m.updateMatrixWorld(); }; w.scene.add(m); K.sky = m; }

  // ---------------------------------------------------------------- things drawn with their daylight painted in (no lights reach them)
  // The hand-built hero buildings are BAKED: their walls are unlit pictures with the day's sun and shade in them, their glass an emissive picture of
  // the room. At night the walls are scaled down with the light (their painted sun side stays the brighter side: it reads as moonlight) and the
  // glass is left a quarter lit, which gives those buildings lit windows. The mission marker is dimmed so it does not bloom into a white column.
  const dim = { list: new Map(), t: 0, k: 1 };
  const collect = () => { const see = (root, kind) => { if (root) root.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material || [])) { if (dim.list.has(m)) continue;
        if (m.isMeshBasicMaterial && m.color) dim.list.set(m, { kind, c: m.color.clone() }); else if (m.emissive && (m.emissiveMap || m.emissive.r + m.emissive.g + m.emissive.b > 0.2) && kind === 'hero') dim.list.set(m, { kind: 'glass', e: m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity }); } }); };
    see(w.heroRoot, 'hero'); see(g.missions && g.missions.marker, 'mark'); };
  const dimApply = (k, e) => { dim.k = k; for (const [m, d] of dim.list) { if (d.kind === 'glass') m.emissiveIntensity = d.e * mix(1, 0.22, e); else m.color.copy(d.c).multiplyScalar(d.kind === 'mark' ? mix(1, 0.2, e) : k); } };
  K.apply = (n, N2) => { const rain = N2.rain || 0, on = n > 0 || rain > 0, e = sm(0, 1, n), lamp = N2.lampOn, head = N2.headOn || 0;
    if (K.pass) { K.pass.enabled = on && (lamp > 0.001 || head > 0.001); const u = K.pass.u; u.uLamp.value = T.lamp * lamp; u.uHead.value = T.head * head;
      const s = N2.saved; u.uAmb.value = Math.max(0.01, T.amb * (0.45 * (s ? w.scene.environmentIntensity / s.env : 1) + 2.0 * (s ? w.sun.intensity / s.I : 1))); }
    if (K.lamps) { K.lamps.m.visible = on && lamp > 0.001; K.lamps.mat.uniforms.uOn.value = lamp * T.glow; } if (K.more) for (const G of K.more) { G.m.visible = on && lamp > 0.001; G.mat.uniforms.uOn.value = lamp * T.glow; }     /* park lane: the park's posts (addLamps below) */
    C.m.visible = on && head > 0.001; C.mat.uniforms.uOn.value = head * T.glow;
    if (K.sky) { K.sky.visible = on; K.sky.material.uniforms.uN.value = n; K.sky.material.uniforms.uDusk.value = sm(0.05, 0.45, n) * (1 - sm(0.5, 0.95, n)) * 0.5 * (1 - rain); K.sky.material.uniforms.uCloud.value = rain; const lv = mix(1.5, 0.035, Math.pow(e, 0.7)); K.sky.material.uniforms.uCloudCol.value.set(lv * 0.93, lv * 0.96, lv * 1.0); }
    { const s = N2.saved, k = on && s ? Math.min(1, (0.45 * w.scene.environmentIntensity / s.env + 2.0 * w.sun.intensity / s.I) / 2.45) : 1; if (on) collect(); dimApply(on ? k : 1, on ? e : 0); K.dimK = k; K.fxDay = on ? Math.min(1, k * T.fx) : 1; setFx(); }
    if (K.patched) { const win = sm(0.25, 0.65, n), late = N2.tod > 0.5 && N2.tod < 5.2 ? 0.45 : 1; w.shared.uNightK.value.set(on ? mix(1, 0.05, e) : 1, on ? T.win * win : 0, on ? T.winFrac * win * late : 0); } };
  K.frame = (n, N2) => { if (performance.now() - dim.t > 3000) { dim.t = performance.now(); const had = dim.list.size; collect(); if (dim.list.size !== had) dimApply(dim.k, sm(0, 1, n)); }      // hero buildings arrive late
    if (C.m.visible) carLights(); else if (K.pass) K.pass.u.uSpotN.value = 0; setFx(); };      /* (each frame: the guns may load after the kit) */
  // park lane, Nov 16: more lamp heads after the kit is made ([x, y, head height, strength] as above; the park's posts, src/park/night.js): their pools are
  // added to the lamp map where it reaches and they get a glow mesh of their own, switched with the street lamps' (K.more, in apply above).
  K.addLamps = (hs) => { if (!hs || !hs.length) return null;
    if (K.map) { const cv = K.map.tex.image, c = cv.getContext('2d'), x0 = K.map.rect[0], y1 = -K.map.rect[1], S = cv.width * K.map.rect[2]; c.globalCompositeOperation = 'lighter';
      for (const h of hs) { const px = (h[0] - x0) * S, py = (y1 - h[1]) * S, R = 21 * S * (0.6 + 0.4 * h[3]), k = h[3]; if (px < -R || py < -R || px > cv.width + R || py > cv.height + R) continue; const gr = c.createRadialGradient(px, py, 0, px, py, R);
        for (const [t, v] of [[0, 0.80], [0.18, 0.70], [0.38, 0.50], [0.6, 0.30], [0.8, 0.13], [1, 0]]) gr.addColorStop(t, `rgb(${Math.round(255 * v * k)},${Math.round(232 * v * k)},${Math.round(196 * v * k)})`);
        c.fillStyle = gr; c.fillRect(px - R, py - R, 2 * R, 2 * R); }
      K.map.tex.needsUpdate = true; }
    const G = glowMesh(hs.length, 0.0016); hs.forEach((h, i) => G.put(i, h[0], h[2], -h[1], 1.0 * h[3], 0.9 * h[3], 0.74 * h[3], 0.55)); G.geo.instanceCount = hs.length; G.P.needsUpdate = G.C.needsUpdate = G.D.needsUpdate = true; w.scene.add(G.m);
    if (K.lamps) { G.m.visible = K.lamps.m.visible; G.mat.uniforms.uOn.value = K.lamps.mat.uniforms.uOn.value; } else { const on = (N.n > 0 || (N.rain || 0) > 0) && N.lampOn > 0.001; G.m.visible = on; G.mat.uniforms.uOn.value = N.lampOn * T.glow; }
    (K.more = K.more || []).push(G); K.lampN += hs.length; return G; };
  K.info = () => ({ lamps: K.lampN, map: K.map && K.map.size, pass: !!K.pass, passOn: !!(K.pass && K.pass.enabled), passDrawn: K.pass ? K.pass.drawn : 0, cars: K.carN, spots: K.spots, windows: K.patched, baked: dim.list.size, bakedK: +(K.dimK || 1).toFixed(3), fxDay: NFX ? +K.fxDay.toFixed(4) : 'off' });
  return K;
}
