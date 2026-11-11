// cockpit.js: everything inside the cabin. buildCockpit(ctx, model) -> { root, update(f, dt, view) }.
// Seven draws close up: the fixed cabin, the flight controls (one skinned mesh), the printed faces, the moving instrument parts (one
// instanced mesh: needles, compass card, attitude ball, slip ball), the lit screens, the glass over them, and (only until model.js
// exists) a plain cabin frame. Past 60 m a few boxes stand in; past 250 m nothing is drawn.
// Helpers live in ./cockpit/: geo.js (modelling kit), cabin.js (the solid parts), faces.js (everything printed), displays.js (the
// screens), scales.js + layout.js (what each dial means and where it sits), standin.js (the temporary frame).
import * as THREE from 'three';
import { buildCabin, BONES, PIVOT } from './cockpit/cabin.js';
import { buildAtlas, buildPanelPicture, buildGrain, buildDust, AI_WIN } from './cockpit/faces.js';
import { Displays } from './cockpit/displays.js';
import { SCALES, angleOf, KT, AI_SPAN, compassDeg, altFt } from './cockpit/scales.js';
import { dial } from './cockpit/layout.js';
import { buildStandinShell } from './cockpit/standin.js';
import { Builder, M, GRAIN, rbox, setQuality } from './cockpit/geo.js';
import { CabinSun } from './cockpit/sunshadow.js';
import { buildLiner } from './cockpit/liner.js';
import { LIGHT } from '../world.js';

const D2R = Math.PI / 180;
const AO = { floor: 0.13, local: 0.35, gain: 1.25, gam: 1.2, print: 0.95, printAdd: 0.012, plate: 0.3 };      // how the two baked terms become shading: the cabin is lit by its windows and little else, as a camera exposed for the day outside sees it
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// the one material of all solid parts: colour, roughness and metalness ride on the vertices; a small tiling picture gives each surface
// its grain (plastic stipple, weave, leather, brushed metal) by projection, so nothing needs unwrapping; baked sky visibility shades it.
const uCabAmb = { value: 1 };      // the cabin's window light as shaded: 1 for an eye inside (exposed for the day outside), lifted for a camera outside looking in
function solidMaterial(grain, sun, cut = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }); if (cut) m.defines = { CABIN_CUT: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tGrain = { value: grain }; sh.uniforms.uCabAmb = uCabAmb;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aMat; attribute vec3 aAO; varying vec4 vMat; varying vec3 vAO; varying vec3 vOP; varying vec3 vON;\n#ifdef CABIN_CUT\nattribute vec2 aCut; varying vec2 vCut;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vAO = aAO; vOP = position; vON = normal;\n#ifdef CABIN_CUT\nvCut = aCut;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tGrain; uniform float uCabAmb; varying vec4 vMat; varying vec3 vAO; varying vec3 vOP; varying vec3 vON; float hGrain; float sealK = 0.0; float fastK = 0.0;\nfloat vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y); }\n#ifdef CABIN_CUT\nvarying vec2 vCut;\n#endif')
      .replace('#include <roughnessmap_fragment>', `
        #ifdef CABIN_CUT
          if (vCut.x > 0.006 || vCut.y < 0.0) discard;
          sealK = smoothstep(-0.009, -0.0075, vCut.x);
          { // built, not a skin: joints between the trim panels (two frames, the belt line, the roof panel's edges) and a row of screws beside each
            float jx = min(abs(vOP.x - 0.20), abs(vOP.x - 1.03)), jy = abs(vOP.y - 1.165), jz = vOP.y > 1.95 ? abs(abs(vOP.z) - 0.36) : 9.0, sd = min(min(jx, jy), jz);
            float seamK = 1.0 - smoothstep(0.0007, 0.002, sd); diffuseColor.rgb *= 1.0 - 0.8 * seamK;
            float f1 = length(vec2((fract(vOP.x / 0.11) - 0.5) * 0.11, jy - 0.02)), f2 = length(vec2(jx - 0.02, (fract(vOP.y / 0.11) - 0.5) * 0.11)), f3 = length(vec2((fract(vOP.x / 0.11) - 0.5) * 0.11, jz - 0.02)), fd = min(min(f1, f2), f3);
            fastK = (1.0 - smoothstep(0.0036, 0.0046, fd)) * step(0.72, vOP.y); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.34, 0.33) * (0.6 + 0.4 * smoothstep(0.0, 0.004, fd)), fastK);
            fastK *= 1.0 - smoothstep(0.0008, 0.0036, fd) * 0.0; }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.02, 0.021), sealK);
        #endif
        vec3 bw = abs(normalize(vON)); bw = bw * bw; bw = bw * bw; bw /= (bw.x + bw.y + bw.z);
        vec4 gr = texture2D(tGrain, vOP.yz * vMat.w) * bw.x + texture2D(tGrain, vOP.xz * vMat.w) * bw.y + texture2D(tGrain, vOP.xy * vMat.w) * bw.z;
        float ty = vMat.z; hGrain = ty < 0.5 ? 0.5 : ty < 1.5 ? gr.r : ty < 2.5 ? gr.g : ty < 3.5 ? gr.b : gr.a;
        float dirt = vnoise(vOP.xz * 23.0 + vOP.y * 17.0) * 0.6 + vnoise(vOP.zx * 71.0 + vOP.y * 47.0) * 0.4;      // smooth: the grain picture magnified this far showed its texels as camouflage blocks
        float wearK = vAO.y * smoothstep(0.5, 0.8, dirt);
        #ifdef CABIN_CUT
          { // used, not new: slow blotches over the trim, grime gathered toward every window seal, boot scuffs low on the walls
            float big = vnoise(vOP.xy * 3.0 + vOP.z * 1.7) * 0.6 + vnoise(vOP.zy * 7.0 + vOP.x * 2.3) * 0.4, edgeG = smoothstep(-0.075, -0.009, vCut.x) * (1.0 - sealK);
            diffuseColor.rgb *= (0.95 + 0.08 * big) * (1.0 - 0.3 * edgeG * (0.35 + 0.65 * dirt));
            float scuff = smoothstep(0.66, 0.9, vnoise(vec2((vOP.x + vOP.z * 0.6) * 13.0, vOP.y * 240.0))) * smoothstep(0.4, 0.7, vnoise(vOP.xy * 9.0 + 3.7)) * (1.0 - smoothstep(0.78, 1.2, vOP.y)) * (1.0 - sealK);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.034, 0.033), scuff * 0.5); }
        #endif
        diffuseColor.rgb *= 0.91 + 0.18 * hGrain;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8 + vec3(0.03, 0.028, 0.025), wearK * 0.5);
        float roughnessFactor = clamp(vMat.x + (hGrain - 0.5) * 0.22 + wearK * 0.25 - vAO.y * (1.0 - dirt) * 0.08, 0.05, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.46, sealK);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vMat.y, 0.9, fastK * (1.0 - sealK)); roughnessFactor = mix(roughnessFactor, 0.35, fastK * (1.0 - sealK));')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float hB = hGrain * vAO.z * 0.012 / max(vMat.w, 8.0);
          #ifdef CABIN_CUT
            hB = hB * (1.0 - sealK) + sealK * sin(3.14159 * clamp((vCut.x + 0.009) / 0.015, 0.0, 1.0)) * 0.003;
          #endif
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); float hx = dFdx(hB), hy = dFdy(hB);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1) * faceDirection; vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad); }`)
      .replace('#include <aomap_fragment>', `
        { float aoB = vAO.x, sunVis = cabSun();
          float lum = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
          reflectedLight.indirectDiffuse = mix(vec3(lum) * vec3(1.06, 1.0, 0.93), reflectedLight.indirectDiffuse, 0.35) * aoB * uCabAmb; reflectedLight.indirectSpecular *= aoB * aoB;
          reflectedLight.directDiffuse *= sunVis; reflectedLight.directSpecular *= sunVis; }`);
  };
  return sun.patch(m);
}

// the instrument parts that move: one quad per part, each with its own corner of the printed picture; the attitude ball is drawn by
// turning and sliding the picture inside a round window (mode 1), everything else by turning or sliding the quad itself
function movingMaterial(atlas, sun) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.7, metalness: 0, alphaTest: 0.08, alphaToCoverage: true, envMapIntensity: 0.22 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aUvR; attribute vec4 aFx; varying vec4 vUvR; varying vec4 vFx; varying vec2 vQ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvR = aUvR; vFx = aFx; vQ = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vUvR; varying vec4 vFx; varying vec2 vQ;')
      .replace('#include <map_fragment>', `
        vec2 tq = vQ;
        if (vFx.x > 1.5 && vFx.x < 2.5) tq = vec2(fract(vFx.y + (vQ.x - 0.5) * 0.2), vQ.y);
        else if (vFx.x > 0.5) { vec2 q = vQ * 2.0 - 1.0; if (dot(q, q) > 1.0) discard; float c = cos(vFx.y), s = sin(vFx.y); tq = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * 0.2 + vec2(0.5, 0.5 + vFx.z); }
        vec4 sampledDiffuseColor = texture2D(map, mix(vUvR.xy, vUvR.zw, tq));
        diffuseColor *= sampledDiffuseColor; diffuseColor.rgb *= vFx.w;
        if (vFx.x > 2.5) { diffuseColor.rgb = vec3(0.0); diffuseColor.a *= 0.5; }`);
  };
  return sun.patch(m);
}

// a second-order needle: follows its target like a sprung, damped pointer
class Needle { constructor(w = 14, z = 0.8) { this.x = 0; this.v = 0; this.w = w; this.z = z; this.init = false; }
  step(target, dt) { if (!this.init) { this.x = target; this.init = true; return this.x; } const n = dt > 0.02 ? 2 : 1, h = dt / n; for (let i = 0; i < n; i++) { this.v += (this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v) * h; this.x += this.v * h; } return this.x; } }

export async function buildCockpit(ctx, model) {
  const { DIMS, game, heli } = ctx, world = ctx.world, maxAniso = world && world.renderer ? world.renderer.capabilities.getMaxAnisotropy() : 8;
  const root = new THREE.Group(); root.name = 'cockpit';

  // ---- pictures
  const atlas = buildAtlas(mk), tiles = atlas.tiles;
  const tAtlas = new THREE.CanvasTexture(atlas.canvas); tAtlas.colorSpace = THREE.SRGBColorSpace; tAtlas.anisotropy = Math.min(16, maxAniso); tAtlas.minFilter = THREE.LinearMipmapLinearFilter; tAtlas.generateMipmaps = true;
  const gd = buildGrain(256), tGrain = new THREE.DataTexture(gd.data, gd.size, gd.size, THREE.RGBAFormat); tGrain.wrapS = tGrain.wrapT = THREE.RepeatWrapping; tGrain.colorSpace = THREE.NoColorSpace; tGrain.minFilter = THREE.LinearMipmapLinearFilter; tGrain.magFilter = THREE.LinearFilter; tGrain.generateMipmaps = true; tGrain.anisotropy = 4; tGrain.needsUpdate = true;
  const tDust = new THREE.CanvasTexture(buildDust(mk)); tDust.wrapS = tDust.wrapT = THREE.RepeatWrapping; tDust.colorSpace = THREE.SRGBColorSpace; tDust.anisotropy = 4;
  const tPanel = new THREE.CanvasTexture(buildPanelPicture(mk)); tPanel.colorSpace = THREE.SRGBColorSpace; tPanel.anisotropy = Math.min(16, maxAniso); tPanel.minFilter = THREE.LinearMipmapLinearFilter; tPanel.generateMipmaps = true;
  const disp = new Displays(mk, game, heli);
  const tDyn = new THREE.CanvasTexture(disp.cv); tDyn.colorSpace = THREE.SRGBColorSpace; tDyn.anisotropy = Math.min(8, maxAniso); tDyn.generateMipmaps = true; tDyn.minFilter = THREE.LinearMipmapLinearFilter;

  // ---- geometry
  let sideZ = null, skin = null, doorFront = null; try { if (model && !model.standIn) { const sh = await import('./model/shape.js'); sideZ = (x, y) => sh.podAt(x, y, 1).p[2] - 0.03; sideZ(1, 1); skin = (x, y, sg) => sh.podAt(x, y, sg); doorFront = sh.doorFront; } } catch (e) { sideZ = null; skin = null; }
  const cab = buildCabin(DIMS, tiles, { sideZ, skin, doorFront }), PM = cab.info.PM;
  // the coarse cabin: what is drawn when the camera is outside (same parts, fewer spans, nothing under 7 cm)
  setQuality(0.4); const low = buildCabin(DIMS, tiles, { sideZ, skin, doorFront }); setQuality(1);
  const shellGeo = model && model.standIn ? buildStandinShell(DIMS) : null;
  // ---- what covers the shell from the seat: trim skin and the glass's inner face, lofted just inside the shell's own surface
  let lin = null; try { if (model && !model.standIn) { const sh = await import('./model/shape.js'), kit = await import('./model/meshkit.js'); lin = buildLiner(DIMS, sh, kit, BONES.doorR); } } catch (e) { console.log('[heli] cockpit: no trim skin (the shell\'s shape could not be read: ' + (e && e.message) + ')'); }
  cab.lin = lin;
  // baked sky visibility: one byte per vertex for fixed, moving, prints, and the stand-in frame, in that order (items/cockpit/bake_ao.mjs)
  try {
    const r = await fetch(new URL('../../assets/heli/cockpit/ao.bin', import.meta.url)); if (!r.ok) throw new Error('no file');
    const ao = new Uint8Array(await r.arrayBuffer()), nF = cab.fixed.attributes.position.count, nM = cab.moving.attributes.position.count, nP = cab.prints.attributes.position.count, nPP = cab.panel.attributes.position.count, nS = shellGeo ? shellGeo.attributes.position.count : 0, NT = ao.length / 2;
    if (NT < nF + nM + nP + nPP) throw new Error('bake is for another build (' + NT + ' vs ' + (nF + nM + nP + nPP) + ' vertices): run items/cockpit/bake_ao.mjs');
    // two bytes a vertex: how much open sky it sees through the windows, and how open its near surroundings are (creases, contact)
    const hoodK = []; for (const g of [cab.prints, cab.panel]) { const p = g.attributes.position, k = new Float32Array(p.count); for (let i = 0; i < p.count; i++) k[i] = (p.getX(i) < 1.84 || p.getX(i) > 2.02 || p.getY(i) < 1.2) ? 1 : 0.45 + 0.55 * Math.min(1, Math.max(0, (1.432 - p.getY(i)) / 0.075)); hoodK.push(k); }
    const sB0 = buildStandinShell(DIMS), nS0 = sB0.attributes.position.count; sB0.dispose();
    // two bytes a vertex: how much open sky it sees through the windows, and how open its near surroundings are (creases, contact)
    cab.shade = (A) => {
      const vis = (i) => (A.floor + (1 - A.floor) * Math.pow(ao[i] / 255, A.gam)) * (A.local + (1 - A.local) * ao[NT + i] / 255) * A.gain;
      const put = (g, o) => { const a = g.attributes.aAO; for (let i = 0; i < a.count; i++) a.setX(i, vis(o + i)); a.needsUpdate = true; };
      put(cab.fixed, 0); put(cab.moving, nF);
      const tint = (g, o, hk, m = 1) => { const c = g.attributes.color; for (let i = 0; i < c.count; i++) { const v = Math.min(1, A.print * vis(o + i) + A.printAdd) * hk[i] * m; c.setXYZ(i, v, v, v); } c.needsUpdate = true; };
      tint(cab.prints, nF + nM, hoodK[0]); tint(cab.panel, nF + nM + nP, hoodK[1], A.plate);
      if (shellGeo && NT >= nF + nM + nP + nPP + nS) put(shellGeo, nF + nM + nP + nPP);
      { const o = nF + nM + nP + nPP + nS0, nLF = low.fixed.attributes.position.count; if (NT >= o + nLF + low.moving.attributes.position.count) { put(low.fixed, o); put(low.moving, o + nLF); } const oL = o + nLF + low.moving.attributes.position.count; if (cab.lin && NT >= oL + cab.lin.liner.attributes.position.count) put(cab.lin.liner, oL); }
    };
    cab.shade(AO);
    cab.aoLoaded = ao;
  } catch (e) { console.log('[heli] cockpit shading bake not used: ' + (e && e.message)); }

  // ---- meshes
  const sun = new CabinSun(2048, 2.3), solid = solidMaterial(tGrain, sun); if (world && world.renderer) sun.prime(world.renderer);
  const fixed = new THREE.Mesh(cab.fixed, solid); fixed.receiveShadow = false; fixed.castShadow = false; root.add(fixed);
  let shell = null; if (shellGeo) { shell = new THREE.Mesh(shellGeo, solid); shell.castShadow = true; shell.receiveShadow = true; shell.name = 'cockpit-standin-frame'; root.add(shell); }

  // controls: a skinned mesh, one bone per moving thing
  const bones = []; const bone = (name, x, y, z, parent) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); (parent || bones[0]).add(b); bones.push(b); return b; };
  { const r = new THREE.Bone(); r.name = 'root'; bones.push(r); }
  const bCycR = bone('cycR', PIVOT.cyc[0], PIVOT.cyc[1], PIVOT.seatZ), bCycL = bone('cycL', PIVOT.cyc[0], PIVOT.cyc[1], -PIVOT.seatZ), bCol = bone('col', PIVOT.col[0], PIVOT.col[1], 0);
  const bTwR = bone('twR', 0.36, 0, PIVOT.seatZ + PIVOT.colZ, bCol), bTwL = bone('twL', 0.36, 0, -PIVOT.seatZ + PIVOT.colZ, bCol);
  const bPedP = bone('pedP', PIVOT.ped[0], PIVOT.ped[1], 0), bPedM = bone('pedM', PIVOT.ped[0], PIVOT.ped[1], 0), bDoor = bone('doorR', PIVOT.door[0], 0, PIVOT.door[1]);
  const moving = new THREE.SkinnedMesh(cab.moving, solid); moving.add(bones[0]); moving.updateMatrixWorld(true); const skel = new THREE.Skeleton(bones); moving.bind(skel); moving.frustumCulled = false; moving.receiveShadow = false; root.add(moving);
  const fixedLo = new THREE.Mesh(low.fixed, solid); fixedLo.receiveShadow = true; fixedLo.visible = false; root.add(fixedLo);
  const movingLo = new THREE.SkinnedMesh(low.moving, solid); movingLo.bind(skel, new THREE.Matrix4()); movingLo.frustumCulled = false; movingLo.receiveShadow = true; movingLo.visible = false; root.add(movingLo);

  let liner = null, wglass = null; const uSunObj = { value: new THREE.Vector3(0, 1, 0) }, uHaze = { value: new THREE.Vector4(0.1, 0.03, 0.1, 0.7) }, uGl = { value: new THREE.Vector4(0.1, 0, 0, 0) };      // glass film: lit by the sun, lit by the sky, how much it veils, the hood's mirror
  if (lin) {
    liner = new THREE.SkinnedMesh(lin.liner, solidMaterial(tGrain, sun, true)); liner.bind(skel, new THREE.Matrix4()); liner.frustumCulled = false; liner.receiveShadow = false; liner.visible = false; root.add(liner);
    // the glass from inside: a little tint, a film of dust and fine scratches that light up in the sun (most of all looking toward it),
    // and a faint mirror of the cabin (the glareshield's top in the windscreen)
    const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, map: tDust, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, side: THREE.FrontSide });
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uSunObj = uSunObj; sh.uniforms.uHaze = uHaze;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCut; varying vec2 vCut; varying vec3 vVO; varying vec3 vNO; varying vec3 vPO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = aCut; vPO = position; vNO = normal; vVO = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunObj; uniform vec4 uHaze; varying vec2 vCut; varying vec3 vVO; varying vec3 vNO; varying vec3 vPO;')
        .replace('#include <map_fragment>', '')
        .replace('#include <envmap_fragment>', `
          if (vCut.x < -0.006 || vCut.y < 0.0) discard;
          vec3 Vo = normalize(vVO), No = normalize(vNO), Ro = reflect(-Vo, No); float ndv = clamp(dot(Vo, No), 0.0, 1.0), fr = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          float du = texture2D(map, vec2(vPO.z * 1.9 + vPO.y * 0.7, vPO.x * 1.3 + vPO.y * 1.6)).r * 0.6 + texture2D(map, vec2(vPO.x * 4.3 - vPO.z * 2.1, vPO.y * 5.1 + vPO.z * 3.3)).r * 0.4;
          float film = 0.03 + du * 1.4;
          if (vPO.x > 1.85 && vPO.y > 1.12) { // the wipers' sweep on the windscreen: cleaner inside the arcs, a line of dirt along their edges
            vec2 wq = vec2(abs(vPO.z) - 0.2, (vPO.y - 1.16) * 1.5); float wr = length(wq), wa = atan(wq.x, wq.y);
            float swept = smoothstep(0.10, 0.13, wr) * (1.0 - smoothstep(0.60, 0.63, wr)) * (1.0 - smoothstep(0.95, 1.05, abs(wa)));
            film = film * (1.0 - 0.6 * swept) + 0.10 * (1.0 - smoothstep(0.0, 0.012, abs(wr - 0.62))) * (1.0 - smoothstep(0.95, 1.05, abs(wa))) + 0.04 * (1.0 - swept); }
          float edge = 1.0 - smoothstep(0.0, 0.035, vCut.x);
          float lit = cabSun1() * step(0.0, dot(-No, uSunObj)), fwd = pow(max(dot(-Vo, uSunObj), 0.0), 5.0);
          vec3 c = vec3(1.0, 0.97, 0.9) * film * lit * (0.5 + 3.5 * fwd) * uHaze.x + vec3(0.8, 0.9, 1.0) * film * uHaze.y;
          // mirror: the hood's top where the mirrored ray lands on it, dim cabin otherwise
          float hood = 0.0; if (Ro.y < -0.05) { float t = (1.475 - vPO.y) / Ro.y; vec3 H = vPO + Ro * t; hood = step(0.0, t) * smoothstep(1.82, 1.9, H.x) * (1.0 - smoothstep(2.28, 2.36, H.x)) * (1.0 - smoothstep(0.5, 0.6, abs(H.z))); }
          c += min(fr, 0.6) * (0.02 + uHaze.w * hood * (0.06 + 0.94 * lit) + 0.05 * smoothstep(0.0, 0.5, Ro.y));
          outgoingLight = c; diffuseColor.a = clamp(0.05 + film * uHaze.z + fr * 0.35 + edge * 0.3, 0.0, 0.9);`);
    };
    sun.patch(gm);
    wglass = new THREE.SkinnedMesh(lin.glass, gm); wglass.bind(skel, new THREE.Matrix4()); wglass.frustumCulled = false; wglass.renderOrder = 3; wglass.visible = false; root.add(wglass);
  }
  // printed pieces: the open sky's mirror picture reaches them only as far as the baked sky term says (the renderer's own would veil every black face grey-blue)
  const shaded = (m) => { m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectSpecular *= 0.3 * vColor.r * vColor.r;'); }; return m; };
  const prints = new THREE.Mesh(cab.prints, sun.patch(shaded(new THREE.MeshStandardMaterial({ map: tAtlas, vertexColors: true, roughness: 0.78, metalness: 0, alphaTest: 0.5, envMapIntensity: 0.22 })))); prints.receiveShadow = false; root.add(prints);
  const panel = new THREE.Mesh(cab.panel, sun.patch(shaded(new THREE.MeshStandardMaterial({ map: tPanel, vertexColors: true, roughness: 0.72, metalness: 0, envMapIntensity: 0.22 })))); panel.receiveShadow = false; root.add(panel);
  const screens = new THREE.Mesh(cab.screens, sun.patch(new THREE.MeshLambertMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: tDyn, emissiveIntensity: 0.38 }))); root.add(screens);
  { const g = cab.glass, p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) * 2.3 + p.getY(i) * 0.9, p.getY(i) * 2.9 + p.getX(i) * 1.3); }
  // glass over the dials and screens: added light only (dust lit by the sun, and what the glass mirrors). The game's sky cannot be its
  // mirror picture (the roof and the cabin stand between the glass and most of the sky), so it mirrors a small model of the cabin
  // instead: the bright side windows and windscreen, the dim roof, the dark cabin behind.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, map: tDust, roughness: 0.1, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 0 });
  glassMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVO; varying vec3 vNO; varying vec3 vPG;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvVO = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position; vNO = normal; vPG = position;');
    sh.uniforms.uGl = uGl; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uGl; varying vec3 vVO; varying vec3 vNO; varying vec3 vPG;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 Vo = normalize(vVO), No = normalize(vNO), Ro = reflect(-Vo, No), Pg = vPG; float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(Vo, No), 0.0, 1.0), 5.0), win = 0.0;
          // the mirrored ray is followed to the cabin's walls: where it leaves through a window the glass shows sky
          if (abs(Ro.z) > 0.04) { float t = (sign(Ro.z) * 0.9 - Pg.z) / Ro.z; vec3 H = Pg + Ro * t; float band = smoothstep(1.17, 1.24, H.y) * (1.0 - smoothstep(1.87, 1.94, H.y));
            win = max(win, band * max(smoothstep(0.32, 0.40, H.x) * (1.0 - smoothstep(1.55, 1.72, H.x)), smoothstep(-0.45, -0.38, H.x) * (1.0 - smoothstep(0.04, 0.11, H.x)))); }
          if (Ro.y > 0.04) { float t = (2.12 - Pg.y) / Ro.y; vec3 H = Pg + Ro * t; win = max(win, smoothstep(0.80, 0.87, H.x) * (1.0 - smoothstep(1.50, 1.57, H.x)) * smoothstep(0.08, 0.13, abs(H.z)) * (1.0 - smoothstep(0.56, 0.62, abs(H.z)))); }
          win = max(win, smoothstep(0.45, 0.9, Ro.x) * smoothstep(-0.3, 0.1, Ro.y));
          float smear = 0.75 + 0.5 * sampledDiffuseColor.r * 8.0;
          totalEmissiveRadiance += min(fr, 0.4) * (0.008 + uGl.x * win) * vec3(0.92, 0.97, 1.05) * smear; }`)
      .replace('#include <aomap_fragment>', '{ float cs = cabSun(); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= 0.02 * cs; reflectedLight.indirectSpecular *= 0.0; reflectedLight.indirectDiffuse *= 0.15; }');
  };
  sun.patch(glassMat);
  const glass = new THREE.Mesh(cab.glass, glassMat); glass.renderOrder = 4; glass.receiveShadow = false; root.add(glass);

  // the moving instrument parts
  // needles stand 3 to 5 mm off their faces and each drops a soft shadow on the face below it
  const PARTS = [], part = (tile, id, size, w, mode = 0) => { const d = dial(id), needle = tile.startsWith('n_') && tile !== 'n_ball' && tile !== 'n_roll'; let sh;
    if (needle) { PARTS.push({ tile, d, size: size * d.r * 2, w: 0.0013 + PARTS.length * 1e-5, mode: 3, off: [0.0016, -0.002] }); sh = PARTS.length - 1; w += 0.002; }
    PARTS.push({ tile, d, size: size * d.r * 2, w, mode, sh }); return PARTS.length - 1; };
  const I = { asi: part('n_long', 'asi', 1, 0.0022), alt10k: part('n_alt10k', 'alt', 1, 0.0016), alt1k: part('n_alt1k', 'alt', 1, 0.0021), alt100: part('n_alt100', 'alt', 1, 0.0026), vsi: part('n_long', 'vsi', 1, 0.0022),
    tachT: part('n_tachT', 'tach', 1, 0.0018), tachR: part('n_tachR', 'tach', 1, 0.0024), card: part('hsiCard', 'hsi', 0.86, 0.0020), ball: part('aiBall', 'ai', AI_WIN, 0.0016, 1), rollP: part('n_roll', 'ai', AI_WIN, 0.0024), slip: part('n_ball', 'ai', 0.066, 0.0038),
    tq: part('n_small', 'tq', 1, 0.0022), tot: part('n_small', 'tot', 1, 0.0022), fuel: part('n_small', 'fuel', 1, 0.0022), oilp: part('n_small', 'oilp', 1, 0.0022), oilt: part('n_small', 'oilt', 1, 0.0022), volt: part('n_small', 'volt', 1, 0.0022), oat: part('n_small', 'oat', 1, 0.0022),
    clkH: part('n_clockH', 'clock', 1, 0.0016), clkM: part('n_clockM', 'clock', 1, 0.0021), clkS: part('n_clockS', 'clock', 1, 0.0026) };
  const iComp = PARTS.length; PARTS.push({ tile: 'compass', d: { id: 'compass', u: 0, v: 0, r: 0 }, size: 1, w: 0, mode: 2, custom: cab.info.compass });
  const NP = PARTS.length, inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), movingMaterial(tAtlas, sun), NP); inst.frustumCulled = false; inst.receiveShadow = false;
  const aUvR = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4), aFx = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); aFx.setUsage(THREE.DynamicDrawUsage);
  // each part is shaded like the face under it: the baked sky visibility at that dial (the prints carry it as their colour)
  const shadeAt = (d) => { const p = cab.prints.attributes.position, c = cab.prints.attributes.color, q = new THREE.Vector3(d.u, d.v, 0.001).applyMatrix4(PM); let best = 1e9, v = 1; for (let i = 0; i < p.count; i++) { const dd = (p.getX(i) - q.x) ** 2 + (p.getY(i) - q.y) ** 2 + (p.getZ(i) - q.z) ** 2; if (dd < best) { best = dd; v = c.getX(i); } } return v; };
  const shadeBy = new Map();
  PARTS.forEach((p, i) => { const t = tiles[p.tile]; aUvR.setXYZW(i, t.u0, t.v0, t.u1, t.v1); if (!shadeBy.has(p.d.id)) shadeBy.set(p.d.id, p.custom ? 0.8 : shadeAt(p.d)); aFx.setXYZW(i, p.mode, 0, 0, shadeBy.get(p.d.id)); p.base = p.custom ? p.custom.clone() : new THREE.Matrix4().multiplyMatrices(PM, new THREE.Matrix4().makeTranslation(p.d.u + (p.off ? p.off[0] : 0), p.d.v + (p.off ? p.off[1] : 0), p.w)); p.ang = 1e9; });
  inst.geometry.setAttribute('aUvR', aUvR); inst.geometry.setAttribute('aFx', aFx); inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(inst);
  const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Vector3();
  let instDirty = true;
  // turn part i to `deg` clockwise (and optionally slide it du, dv on the panel)
  const place = (p, i, deg, du, dv) => { _r.makeRotationZ(-deg * D2R); _r.elements[12] = du; _r.elements[13] = dv; _m.multiplyMatrices(p.base, _r); _m.scale(_s.set(p.size, p.size, 1)); inst.setMatrixAt(i, _m); };
  const setPart = (i, deg, du = 0, dv = 0) => { const p = PARTS[i]; if (Math.abs(deg - p.ang) < 0.02 && !du && !dv && p.du === du) return; p.ang = deg; p.du = du; place(p, i, deg, du, dv); if (p.sh !== undefined) place(PARTS[p.sh], p.sh, deg, du, dv); instDirty = true; };
  for (let i = 0; i < NP; i++) setPart(i, 0);
  inst.setMatrixAt(iComp, _m.copy(PARTS[iComp].base).scale(_s.set(0.05, 0.022, 1)));

  // far stand-in: a few boxes (seats, panel) between 60 and 250 m
  const far = (() => { const B = new Builder(), T = M.t; const dark = { c: 0x17181a, r: 0.6, g: GRAIN.none, w: 0, bump: 0 };
    for (const s of [DIMS.pilotSeat, DIMS.copilotSeat]) { B.add(rbox(0.46, 0.12, 0.46, 0.03, 1), dark, T(s[0] + 0.02, s[1] + 0.33, s[2])); B.add(rbox(0.11, 0.78, 0.45, 0.03, 1), dark, M.mul(T(s[0] - 0.26, s[1] + 0.74, s[2]), M.rz(0.2))); }
    B.add(rbox(0.48, 0.12, 1.5, 0.03, 1), dark, T(-0.18, DIMS.floorY + 0.31, 0)); B.add(rbox(0.11, 0.66, 1.5, 0.03, 1), dark, T(-0.50, DIMS.floorY + 0.68, 0));
    B.add(rbox(0.28, 0.44, 1.06, 0.03, 1), dark, M.mul(T(DIMS.panel.x + 0.1, DIMS.panel.y, 0), M.rz(-DIMS.panel.tilt))); B.add(rbox(0.9, 0.27, 0.2, 0.02, 1), dark, T(1.34, DIMS.floorY + 0.135, 0));
    const m = new THREE.Mesh(B.build(), solid); m.visible = false; return m; })();
  root.add(far);

  // ---- instrument state
  const N = { asi: new Needle(11, 0.75), alt: new Needle(16, 0.9), vsi: new Needle(9, 0.85), nr: new Needle(13, 0.8), n1: new Needle(13, 0.8), tq: new Needle(10, 0.7), tot: new Needle(7, 0.9), fuel: new Needle(3, 1), oilp: new Needle(6, 0.9), oilt: new Needle(3, 1), volt: new Needle(8, 0.8), ball: new Needle(9, 0.45), pitch: new Needle(30, 1), roll: new Needle(30, 1) };
  const eng = { tot: 20, oilT: 20, oilP: 0, fuel: 71, volt: 24.6, vsLag: 0, thr: 0, started: false, lastSec: -1 };
  const lit = {}; let tDisp = 0, clockT = 1e9;
  const read = {};      // what each instrument shows right now (for checking against the flight state: game.heli.parts.cockpit.read)

  function instruments(f, dt, view) {
    const P = ctx.SPEC ? ctx.SPEC.powerMax : 590e3, pw = Math.max(0, f.power) / P, run = f.engine === 'run', starting = f.engine === 'starting';
    // engine and systems, as the airframe's sensors would give them
    if (!eng.started) { eng.started = true; if (run) { eng.tot = 430 + 360 * pw; eng.oilT = 78; eng.oilP = 4.4; eng.volt = 28.2; eng.thr = 1; } }
    const totT = run ? 420 + 370 * Math.min(1.1, pw) : starting ? 380 + 420 * Math.min(1, f.n1 / 0.55) * (f.n1 < 0.7 ? 1 : 0.75) : 20 + (eng.tot - 20) * 0.0;
    eng.tot += (totT - eng.tot) * Math.min(1, dt / (run || starting ? 1.4 : 22));
    eng.oilP += ((f.n1 > 0.02 ? 5.6 * Math.min(1, f.n1 / 0.6) ** 0.7 - 0.012 * Math.max(0, eng.oilT - 40) : 0) - eng.oilP) * Math.min(1, dt / 0.8);
    eng.oilT += (((run || starting) ? 62 + 30 * pw : 20) - eng.oilT) * Math.min(1, dt / (run || starting ? 95 : 600));
    eng.volt += ((starting && f.n1 < 0.45 ? 21.5 : f.n1 > 0.55 ? 28.2 : 24.6) - eng.volt) * Math.min(1, dt / 0.5);
    eng.fuel = Math.max(26, eng.fuel - dt * (run ? 0.0035 + 0.011 * pw : 0));        // burns down slowly, never to the low-fuel light
    eng.vsLag += (f.vs * 196.85 - eng.vsLag) * Math.min(1, dt / 0.7);                 // the capsule's lag
    const kt = f.ias * KT, ft = altFt(f.pos.y);
    read.asi = N.asi.step(kt < 8 ? 0 : kt, dt); read.alt = N.alt.step(ft, dt); read.vsi = N.vsi.step(eng.vsLag, dt); read.nr = N.nr.step(f.nr * 100, dt); read.n1 = N.n1.step(f.n1 * 100, dt);
    read.tq = N.tq.step(Math.max(0, f.torque) * 100, dt); read.tot = N.tot.step(eng.tot, dt); read.fuel = N.fuel.step(eng.fuel, dt); read.oilp = N.oilp.step(eng.oilP, dt); read.oilt = N.oilt.step(eng.oilT, dt); read.volt = N.volt.step(eng.volt, dt);
    read.hdg = compassDeg(f.heading); read.pitch = N.pitch.step(f.pitch / D2R, dt); read.roll = N.roll.step(f.roll / D2R, dt); read.ball = N.ball.step(f.ball, dt);
    setPart(I.asi, angleOf(SCALES.asi, read.asi)); setPart(I.vsi, angleOf(SCALES.vsi, read.vsi));
    setPart(I.alt100, (read.alt / 1000) * 360 % 360); setPart(I.alt1k, (read.alt / 10000) * 360 % 360); setPart(I.alt10k, (read.alt / 100000) * 360 % 360);
    setPart(I.tachR, angleOf(SCALES.tach, read.nr)); setPart(I.tachT, angleOf(SCALES.tach, read.n1));
    setPart(I.tq, angleOf(SCALES.tq, read.tq)); setPart(I.tot, angleOf(SCALES.tot, read.tot / 100)); setPart(I.fuel, angleOf(SCALES.fuel, read.fuel)); setPart(I.oilp, angleOf(SCALES.oilp, read.oilp)); setPart(I.oilt, angleOf(SCALES.oilt, read.oilt)); setPart(I.volt, angleOf(SCALES.volt, read.volt)); setPart(I.oat, angleOf(SCALES.oat, 18));
    setPart(I.card, -read.hdg); setPart(I.rollP, -read.roll);
    { const d = dial('ai'), a = (180 - Math.max(-1, Math.min(1, read.ball)) * 21) * D2R, rr = 0.855 * d.r; setPart(I.slip, 0, Math.sin(a) * rr, Math.cos(a) * rr); }
    // attitude ball: the picture turns by the bank and slides by the pitch
    { const sh = Math.max(-0.3, Math.min(0.3, read.pitch * 0.4 / AI_SPAN)), th = -read.roll * D2R; if (Math.abs(aFx.getY(I.ball) - th) > 2e-4 || Math.abs(aFx.getZ(I.ball) - sh) > 1e-4) { aFx.setY(I.ball, th); aFx.setZ(I.ball, sh); aFx.needsUpdate = true; } }
    { const c = 1 - read.hdg / 360 - 1 / 144; if (Math.abs(aFx.getY(iComp) - c) > 2e-4) { aFx.setY(iComp, c); aFx.needsUpdate = true; } }      // the standby compass card slides with the heading
    // clock: the hands step once a second
    clockT += dt; if (clockT > 0.2) { clockT = 0; const d = new Date(), s = d.getSeconds(); if (s !== eng.lastSec) { eng.lastSec = s; const mn = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + mn / 60; setPart(I.clkS, s * 6); setPart(I.clkM, mn * 6); setPart(I.clkH, hr * 30); read.clock = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(s).padStart(2, '0'); } }
    if (instDirty) { inst.instanceMatrix.needsUpdate = true; instDirty = false; }
    // caution / warning lights
    const air = !f.onGround, out = f.engine === 'off' || f.engine === 'fail';
    lit['ENG OUT'] = out && air ? 'flash' : false; lit['ENG FAIL'] = f.engine === 'fail' ? 'flash' : false; lit['LOW NR'] = f.nr < 0.9 && air ? 'flash' : false;
    lit['MGB P'] = f.nr < 0.3; lit['ENG P'] = eng.oilP < 1.3; lit.HYD = f.nr < 0.45; lit.GEN = f.n1 < 0.55; lit['FUEL P'] = f.n1 < 0.2; lit.FUEL = false; lit.PITOT = f.engine === 'off' && f.onGround; lit.DOOR = view.door > 0.05; lit.STARTER = starting && f.n1 < 0.5;
    read.lit = lit;
    if (disp.update(f, dt, lit, view.t || 0)) tDyn.needsUpdate = true;
  }

  // the pilot's door: the shell (model.js) hinges it on a leaning axis; the inner trim panel swings on the same one
  let doorAxis = null, doorMax = 1.22; const _dq = new THREE.Quaternion();
  try { if (model && !model.standIn) { const sh = await import('./model/shape.js'), a = sh.podAt(sh.doorFront(0.95), 0.95, 1).p, b = sh.podAt(sh.doorFront(1.72), 1.72, 1).p; doorAxis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); const inv = new THREE.Matrix4().copy(bDoor.matrixWorld).invert(), bi = moving.skeleton.bones.indexOf(bDoor); bDoor.position.set(a[0], a[1], a[2]); bDoor.updateMatrixWorld(true); moving.skeleton.boneInverses[bi].copy(bDoor.matrixWorld).invert(); } } catch (e) { console.log('[heli] cockpit: door hinge from the shell not found, using its own (' + (e && e.message) + ')'); }
  // does the city stand between the sun and the aircraft? Three rays from the cabin toward the sun against the height field, eased
  let sceneSun = 1, sceneT = 0; const _sp = new THREE.Vector3();
  const sceneSunNow = (f, sd) => { const H = heli.heights; if (!H || !H.top || sd.y < 0.03) return 1; let lit = 0;
    for (let k = -1; k <= 1; k++) { let open = 1; _sp.set(-sd.z, 0, sd.x).normalize().multiplyScalar(k * 1.3).add(f.pos);
      for (let i = 0, d = 5; i < 26 && open; i++, d *= 1.2) { const x = _sp.x + sd.x * d, y = _sp.y + sd.y * d, z = _sp.z + sd.z * d; if (y > 460) break; if (H.top(x, -z, y) > y + 0.3) open = 0; }
      lit += open; }
    return lit / 3; };
  const api = { sceneSunTarget: 1 };
  // the cabin goes on the aircraft's own layer (model.js puts the shell on it so the game's mirror cube never draws the aircraft): the
  // capture's full mirror cube would otherwise draw the whole cabin into six faces every sixth frame
  { let mask = 0; if (model && model.root) model.root.traverse((o) => { if (!mask && o.isMesh && !o.layers.isEnabled(0)) mask = o.layers.mask; });
    if (mask) { root.traverse((o) => { o.layers.mask = mask; }); api.layerMask = mask; } }
  // Glass stays out of every pass that draws the scene with one material for all (the game's ambient-occlusion pass draws depth and
  // normals that way): a pane half a metre from the eye over half the frame made that pass take the glass for a wall, shading the
  // view through it and, with its metre-wide search so near the eye, costing about 3 ms a frame on the M1 Pro.
  const ownPassOnly = (mesh) => { if (mesh) mesh.onBeforeRender = (r, sc, c, geo, mat) => { geo.setDrawRange(0, mat === mesh.material ? Infinity : 0); }; };
  ownPassOnly(wglass); ownPassOnly(glass);
  // the same pass searches 0.8 m round every point: right for streets, far too wide inside a cabin 1.6 m across (everything shades
  // everything, and near the eye the search spans the frame, which is what it costs). From the seat it searches a hand's width.
  const gt = world && world.gtao, gtU = gt && gt.gtaoMaterial && gt.gtaoMaterial.uniforms.radius, AO_R0 = gtU ? gtU.value : 0; api.aoRadiusInside = 0.16; let aoIn = false;
  const setAO = (inside) => { if (!gtU) return; if (inside) gtU.value = api.aoRadiusInside; else if (aoIn) gtU.value = AO_R0; aoIn = inside; };
  // exposure: a camera in the seat is exposed for the bright day outside and lets the cabin fall dark; the game's meter averages the
  // frame, sees mostly dark cabin and lifts everything (outside blown out, the black panel grey). While the eye is inside, its mid-grey
  // key is lowered; restored as soon as the eye leaves.
  const KEY0 = LIGHT.key; api.keyInside = 0.5; api.ambOutside = 2.2; let keyOn = false;
  const setKey = (inside) => { if (inside !== keyOn) { keyOn = inside; LIGHT.key = inside ? KEY0 * api.keyInside : KEY0; } else if (inside) LIGHT.key = KEY0 * api.keyInside; };
  let lod = -1; const sunSkip = [inst, far, fixedLo, movingLo]; if (liner) sunSkip.push(liner);
  function update(f, dt, view) {
    { let eyeIn = !!view.inside; if (!eyeIn && view.camera && view.dist < 3) { root.worldToLocal(_sp.copy(view.camera.position)); eyeIn = _sp.x > -0.5 && _sp.x < 2.3 && Math.abs(_sp.z) < 0.74 && _sp.y > 0.75 && _sp.y < 2.0; } setKey(eyeIn); setAO(eyeIn); uCabAmb.value = eyeIn ? 1 : api.ambOutside; }      // any eye within the cabin, the pilot's or a free camera's
    const d = view.inside ? 0 : view.dist, L = d < 60 ? 0 : d < 250 ? 1 : 2, full = view.inside || d < 3.2;      // full detail from the seats and from a head in the doorway
    if (L !== lod) { lod = L; root.visible = L < 2; prints.visible = panel.visible = L === 0; if (shell) shell.visible = L === 0; far.visible = L === 1; }
    fixed.visible = moving.visible = glass.visible = L === 0 && full;
    // the trim skin and the glass's inner face are for eyes inside the cabin; outside, the shell shows its own inner side
    const within = view.inside || d < 1.55; if (liner) { liner.visible = wglass.visible = L === 0 && within; if (model && model.innerTrim) model.innerTrim.visible = !view.inside; } fixedLo.visible = movingLo.visible = L === 0 && !full;
    const close = d < 22; inst.visible = L === 0 && d < 25; screens.visible = L === 0 && d < 40;
    if (L > 0) { sun.off(); return; }
    // controls (cheap: eight bones)
    eng.thr += ((f.engine === 'run' || f.engine === 'starting' ? 1 : 0) - eng.thr) * Math.min(1, dt * 1.5);
    bCycR.rotation.set(f.cyc.lat * 0.13, 0, -f.cyc.lon * 0.13); bCycL.rotation.copy(bCycR.rotation);
    bCol.rotation.z = 0.20 + 0.36 * f.collective; bTwR.rotation.x = bTwL.rotation.x = eng.thr * 1.3;
    bPedP.rotation.z = -0.2 * f.pedal; bPedM.rotation.z = 0.2 * f.pedal;
    if (doorAxis) bDoor.quaternion.copy(_dq.setFromAxisAngle(doorAxis, (view.door || 0) * doorMax)); else bDoor.rotation.y = (view.door || 0) * 1.15;
    if (close) instruments(f, dt || 0, view);
    // the cabin's own sun shadow, while the camera is in or near the cabin
    if (liner && heli.root) { _dq.copy(heli.root.quaternion).invert(); uSunObj.value.copy(ctx.shared.uSunDir.value).applyQuaternion(_dq); }
    if (ctx.shared && ctx.shared.uSunDir) { sceneT -= dt || 0; if (sceneT <= 0) { sceneT = 0.05; api.sceneSunTarget = sceneSunNow(f, ctx.shared.uSunDir.value); } sceneSun += (api.sceneSunTarget - sceneSun) * Math.min(1, (dt || 0.016) * 9); sun.u.uCabScene.value = sceneSun; }
    if (full && world && world.renderer && heli.root) sun.render(world.renderer, heli.root, f.pos, ctx.shared.uSunDir.value, sunSkip); else sun.off();
  }
  Object.assign(api, { root, update, read, AO, shade: (A) => cab.shade && cab.shade(Object.assign(AO, A)), uHaze, uGl, sceneSunAt: (pos) => sceneSunNow({ pos }, ctx.shared.uSunDir.value), parts: { liner, wglass, fixed, moving, fixedLo, movingLo, prints, panel, screens, glass, inst, far, shell }, tris: cab.info.tris, textures: { tAtlas, tDyn, tGrain, tDust }, displays: disp, sun }); return api;
}
