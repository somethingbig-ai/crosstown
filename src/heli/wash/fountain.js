// fountain.js: a modest park fountain of our own design (a round granite basin with a low centre bowl and a single jet, on a ring of setts),
// and the water material: any MeshStandardMaterial turned into water that answers the rotor wash (washWater(material, uniforms)).
// Under the rotor the surface is pressed into a shallow dish and roughened white; rings and radial streaks run outward from it.
import * as THREE from 'three';

// uniforms every wash-aware water shares: uWashW = (wash centre x, z; peak outwash speed, m/s; rotor radius), uWashV = (wake lean x, z; time; unused)
export function waterUniforms() { return { uWashW: { value: new THREE.Vector4(0, 0, 0, 5.3) }, uWashV: { value: new THREE.Vector4() } }; }

const WATER_PARS = /* glsl */`
  uniform vec4 uWashW; uniform vec4 uWashV; uniform vec4 uWaterC; varying vec3 vWaP;
  float waH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float waN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(waH(i), waH(i + vec2(1, 0)), f.x), mix(waH(i + vec2(0, 1)), waH(i + vec2(1, 1)), f.x), f.y); }
  // how hard the wash blows on the water at p (0..1.2) and the direction it runs
  float waBlow(vec2 p, out vec2 er, out float d) {
    vec2 r = p - uWashW.xy; d = length(r); er = r / max(d, 0.01); float x = d / uWashW.w;
    return clamp(uWashW.z * (x < 1.0 ? x : exp(-(x - 1.0) / 1.3)) * max(0.15, 1.0 + 1.3 * dot(er, uWashV.xy)) / 15.0, 0.0, 1.2);
  }
  // height of the surface, metres; foam: how broken it is
  float waHeight(vec2 p, out float foam) {
    float t = uWashV.z; vec2 er; float d, s = waBlow(p, er, d);
    float h = 0.0035 * sin(dot(p, vec2(7.1, 5.3)) + t * 2.3) + 0.0025 * sin(dot(p, vec2(-9.7, 12.1)) - t * 3.1) + 0.006 * (waN(p * 4.3 + vec2(t * 0.5, t * 0.3)) - 0.5);
    float rc = length(p - uWaterC.xy); h += 0.006 * sin(rc * 8.0 - t * 5.5) * exp(-rc * 0.45) * uWaterC.w;                   // the jet falling back
    float ang = atan(er.y, er.x), st = waN(vec2(ang * 9.0, d * 0.9 - t * 4.5)), st2 = waN(vec2(ang * 23.0 + 5.0, d * 1.7 - t * 7.0));
    float chop = waN(p * 13.0 - er * t * 3.5) + 0.5 * waN(p * 29.0 - er * t * 6.0);
    h += s * 2.2 * (0.03 * sin(d * 7.0 - t * 10.0) * (0.4 + st) + 0.06 * (st - 0.5) + 0.03 * (st2 - 0.5) + 0.03 * (chop - 0.75));
    h -= 0.05 * s * exp(-d * d / (uWashW.w * uWashW.w * 0.6));
    foam = clamp(s * 1.7, 0.0, 1.0) * smoothstep(0.2, 0.62, st * 0.6 + st2 * 0.3 + chop * 0.25);
    return h;
  }`;

export function washWater(m, U, centre, opts = {}) {
  const uC = { value: new THREE.Vector4(centre.x, centre.z, centre.radius, opts.jet ? 1 : 0) }, depth = (opts.depth || 0.3).toFixed(3);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uWaterC: uC });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vWaP; uniform vec4 uWashW; uniform vec4 uWaterC;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWaP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        {   // the wash leans on the water: it is pushed down on the near side and piled against the far rim
          vec2 wr = uWaterC.xy - uWashW.xy; float wd = length(wr), wx = wd / uWashW.w, ws = clamp(uWashW.z * (wx < 1.0 ? wx : exp(-(wx - 1.0) / 1.3)) / 15.0, 0.0, 1.2);
          transformed.y += 0.07 * ws * dot(vWaP.xz - uWaterC.xy, wr / max(wd, 0.01)) / max(uWaterC.z, 0.5);
        }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WATER_PARS + '\n float waFoam;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWaP.xz; float f0, f1, e = 0.035, h0 = waHeight(p, waFoam), hx = waHeight(p + vec2(e, 0.0), f0), hz = waHeight(p + vec2(0.0, e), f1);
          float dv = length(cameraPosition - vWaP), soft = 1.0 / (1.0 + dv * 0.02);                                              // far off the ripples are smaller than a pixel: flatten, do not sparkle
          vec3 nW = normalize(vec3(-(hx - h0) / e * soft, 1.0, -(hz - h0) / e * soft));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          // what lies under the water: the basin floor, seen bent by the surface, greener and darker with depth
          vec3 Vw = normalize(vWaP - cameraPosition), rf = refract(Vw, nW, 0.75);
          vec2 fp = p + rf.xz / max(-rf.y, 0.2) * ${depth};
          float path = ${depth} / max(-rf.y, 0.2);
          vec2 tile = fp * 2.2; float tv = waH(floor(tile)), gr = waN(fp * 9.0) * 0.5 + waN(fp * 31.0) * 0.5;
          vec3 floorC = vec3(0.26, 0.26, 0.24) * (0.75 + 0.3 * tv) * (0.7 + 0.5 * gr) * mix(1.0, 0.55, smoothstep(0.5, 0.75, waN(fp * 1.7 + 3.0)));   // silt and algae in patches
          float ca = waN(fp * 6.0 + nW.xz * 9.0 + uWashV.z * 0.4), caus = 1.0 + 0.5 * smoothstep(0.42, 0.5, ca) * smoothstep(0.58, 0.5, ca);
          diffuseColor.rgb = floorC * caus * exp(-path * vec3(1.9, 0.75, 0.95));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.66), clamp(waFoam, 0.0, 1.0) * 0.75);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = 0.06;')
      .replace('#include <lights_physical_fragment>', 'roughnessFactor = mix(0.07, 0.62, clamp(waFoam, 0.0, 1.0));\n#include <lights_physical_fragment>');
  };
  m.customProgramCacheKey = () => 'heliWashWater4_' + depth;
  return m;
}

// ---- stone
function canvasTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rx || 1, ry || 1); return t;
}
function speckle(x, w, h, base, amp, seed) {
  const im = x.getImageData(0, 0, w, h), d = im.data; let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < d.length; i += 4) { const k = 1 + (r() - 0.5) * amp + (r() < 0.06 ? -amp * 0.9 : 0) + (r() < 0.05 ? amp * 0.7 : 0); d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
  x.putImageData(im, 0, 0);
}
// granite in long blocks (u along the rim, v across): joints, a little colour from block to block, streaks of weather running down
function granite() {
  return canvasTex(1024, 256, (x, w, h) => {
    let s = 77; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let b = 0; b < 4; b++) { const g = 148 + Math.round((r() - 0.5) * 26), wm = Math.round(r() * 8); x.fillStyle = `rgb(${g + wm},${g + wm * 0.5},${g - 2})`; x.fillRect(b * w / 4, 0, w / 4, h); }
    for (let i = 0; i < 260; i++) { x.globalAlpha = 0.05 + r() * 0.08; x.fillStyle = r() < 0.6 ? '#3a3a36' : '#e8e6de'; const px = r() * w, len = 20 + r() * 120; x.fillRect(px, r() * h, 1 + r() * 3, len); }
    for (let i = 0; i < 70; i++) { x.globalAlpha = 0.06 + r() * 0.07; x.fillStyle = r() < 0.5 ? '#4a4c3c' : '#2c2b28'; x.beginPath(); x.ellipse(r() * w, r() * h, 8 + r() * 46, 5 + r() * 22, r() * 3, 0, 7); x.fill(); }
    x.globalAlpha = 1; speckle(x, w, h, 0, 0.34, 9);
    x.globalAlpha = 0.75; x.fillStyle = '#2a2927'; for (let b = 0; b < 4; b++) x.fillRect(b * w / 4 - 1.5 + (b === 0 ? 1.5 : 0), 0, 3, h); x.globalAlpha = 1;
  });
}
// setts laid in rings (u round the ring, v outward)
function setts() {
  return canvasTex(512, 512, (x, w, h) => {
    let s = 191; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    x.fillStyle = '#34322e'; x.fillRect(0, 0, w, h);
    const rows = 8; for (let j = 0; j < rows; j++) { let px = (j % 2) * 30 - 40; while (px < w) { const sw = 44 + r() * 30, g = 118 + Math.round((r() - 0.5) * 50), wm = Math.round(r() * 14);
      x.fillStyle = `rgb(${g + wm},${g + wm * 0.6},${g - 4})`; const y0 = j * h / rows + 3 + r() * 2, hh = h / rows - 6 - r() * 2; x.beginPath(); x.roundRect(px + 3, y0, sw - 6, hh, 5); x.fill();
      if (px + sw > w) { x.beginPath(); x.roundRect(px + 3 - w, y0, sw - 6, hh, 5); x.fill(); } px += sw; } }
    for (let i = 0; i < 90; i++) { x.globalAlpha = 0.07 + r() * 0.1; x.fillStyle = r() < 0.5 ? '#23221f' : '#5b5a48'; x.beginPath(); x.ellipse(r() * w, r() * h, 10 + r() * 50, 8 + r() * 30, r() * 3, 0, 7); x.fill(); }
    x.globalAlpha = 1; speckle(x, w, h, 0, 0.3, 5);
  });
}
// a surface of revolution with hard edges: bands = [[r0, y0, r1, y1, texture v0, v1, shade0, shade1], ...], walked from the outside inward
function revolve(bands, segs, uRep) {
  const P = [], Nn = [], UV = [], C = [], I = [];
  for (const [r0, y0, r1, y1, v0, v1, c0, c1] of bands) {
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1, nr = dy / l, ny = -dr / l, o = P.length / 3;
    for (let i = 0; i <= segs; i++) { const a = i / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), u = i / segs * uRep;
      P.push(c * r0, y0, s * r0, c * r1, y1, s * r1); Nn.push(c * nr, ny, s * nr, c * nr, ny, s * nr); UV.push(u, v0, u, v1); C.push(c0, c0, c0, c1, c1, c1); }
    for (let i = 0; i < segs; i++) { const a = o + i * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  return g;
}
function disc(r0, r1, y, rings, segs) {
  const P = [], I = [];
  for (let j = 0; j <= rings; j++) { const r = r0 + (r1 - r0) * j / rings; for (let i = 0; i <= segs; i++) { const a = i / segs * Math.PI * 2; P.push(Math.cos(a) * r, y, Math.sin(a) * r); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = j * (segs + 1) + i, b = a + segs + 1; I.push(a, a + 1, b + 1, a, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}

export const FOUNTAIN = { basinR: 3.6, apronR: 5.7, rimH: 0.52, waterY: 0.38, bowlR: 0.95, bowlY: 1.1, nozzleY: 1.22 };
// x, z, y: three.js world position of its centre on the ground. Returns { group, water: { x, y(north), z(level), radius }, bowl: {...}, nozzle: Vector3 }
export function buildFountain(world, U, x, y, z) {
  const F = FOUNTAIN, group = new THREE.Group(); group.name = 'heli_fountain'; group.position.set(x, y, z);
  const stone = new THREE.MeshStandardMaterial({ map: granite(), roughness: 0.82, metalness: 0, vertexColors: true });
  const sett = new THREE.MeshStandardMaterial({ map: setts(), roughness: 0.9, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const R = F.basinR, H = F.rimH, W = 0.46, wet = 0.5;
  const apron = revolve([[F.apronR, 0.035, R - 0.02, 0.045, 0, 2, 0.8, 0.9]], 96, 28); const am = new THREE.Mesh(apron, sett); am.receiveShadow = true; group.add(am);
  const basin = revolve([
    [R + 0.03, -0.1, R + 0.03, 0.09, 0.0, 0.2, 0.55, 0.8],                     // plinth
    [R + 0.03, 0.09, R - 0.02, 0.11, 0.2, 0.24, 0.9, 0.9],
    [R - 0.02, 0.11, R - 0.05, H - 0.11, 0.24, 0.66, 0.85, 1.0],               // outer wall, a slight batter
    [R - 0.05, H - 0.11, R + 0.03, H - 0.07, 0.66, 0.7, 0.7, 0.9],             // the coping oversails
    [R + 0.03, H - 0.07, R + 0.03, H - 0.015, 0.7, 0.76, 1.0, 1.0],
    [R + 0.03, H - 0.015, R + 0.015, H, 0.76, 0.78, 1.0, 1.0],
    [R + 0.015, H, R - W + 0.015, H, 0.02, 0.5, 1.0, 1.0],                     // coping top
    [R - W + 0.015, H, R - W, H - 0.015, 0.5, 0.52, 1.0, 1.0],
    [R - W, H - 0.015, R - W, F.waterY + 0.05, 0.52, 0.6, 0.95, 0.8],          // inner face: dry, then stained to the water line
    [R - W, F.waterY + 0.05, R - W, 0.06, 0.6, 0.95, wet, wet * 0.8],
    [R - W, 0.06, 0.62, 0.06, 0.1, 0.9, wet * 0.8, wet * 0.8],                 // floor
    [0.62, 0.06, 0.62, F.waterY + 0.04, 0.3, 0.6, wet, wet],                   // pedestal
    [0.62, F.waterY + 0.04, 0.58, 0.5, 0.6, 0.7, 0.8, 0.95],
    [0.58, 0.5, 0.36, 0.56, 0.7, 0.8, 1.0, 1.0],
    [0.36, 0.56, 0.3, 0.9, 0.2, 0.55, 0.9, 0.8],
    [0.3, 0.9, 0.8, 1.02, 0.55, 0.9, 0.6, 0.75],                               // the bowl's underside
    [0.8, 1.02, F.bowlR + 0.03, F.bowlY + 0.03, 0.1, 0.3, 0.8, 1.0],
    [F.bowlR + 0.03, F.bowlY + 0.03, F.bowlR + 0.03, F.bowlY + 0.075, 0.3, 0.36, 1.0, 1.0],
    [F.bowlR + 0.03, F.bowlY + 0.075, F.bowlR - 0.07, F.bowlY + 0.075, 0.36, 0.46, 1.0, 1.0],
    [F.bowlR - 0.07, F.bowlY + 0.075, 0.25, F.bowlY - 0.06, 0.46, 0.9, wet, wet * 0.8],
    [0.07, F.bowlY - 0.06, 0.05, F.nozzleY, 0.1, 0.3, 0.35, 0.4], [0.05, F.nozzleY, 0.0, F.nozzleY, 0.3, 0.32, 0.3, 0.3],   // the nozzle
  ], 96, 6);
  const bm = new THREE.Mesh(basin, stone); bm.castShadow = true; bm.receiveShadow = true; group.add(bm);
  const wMat = (depth, jet) => washWater(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, envMapIntensity: 1.0 }), U, { x, z, radius: R }, { depth, jet });
  const w1 = new THREE.Mesh(disc(0.6, R - W + 0.01, F.waterY, 14, 72), wMat(0.3, true)); w1.receiveShadow = true; group.add(w1);
  const w2 = new THREE.Mesh(disc(0.04, F.bowlR - 0.05, F.bowlY + 0.03, 4, 40), wMat(0.1, true)); w2.receiveShadow = true; group.add(w2);
  group.traverse((o) => { o.matrixAutoUpdate = false; }); group.updateMatrix(); group.updateMatrixWorld(true);
  world.scene.add(group);
  return { group, x, z, level: y + F.waterY, radius: R - W, nozzle: new THREE.Vector3(x, y + F.nozzleY, z), bowlY: y + F.bowlY + 0.03, groundY: y };
}
