// park/ground.js (park lane): one chunk's ground. A grid mesh over the chunk's relief (2 m near, 8 m far) shaded from a MASK painted here
// from the chunk's areas and paths:  R = paved (paths, drives, plazas)  G = wood floor (leaf litter)  B = rock  R+G = sand / dirt
// black = lawn, white = outside the park (not drawn). Steep ground turns to rock in the shader whatever the mask says.
// Lawn, litter and dirt are the scans the lawn layer already uses (assets/streets/grass); asphalt is the road's (assets/tex).
import * as THREE from 'three';
import { lit, tex } from './mat.js';
import { CELL, N, STEP } from './terrain.js';

export const BASE = 0.16;      // the park's ground at relief 0 stands this far above the roadway (the lawn layer's parks stood at the model's grass height)
const BED = 0.9;               // metres the ground is sunk under water (the data holds the water's surface there)

let SH = null;
export async function shared(game) {
  if (SH) return SH; const world = game.world, G = 'assets/streets/grass/', T = 'assets/tex/', P = 'assets/park/tex/';
  const [lawn, litter, dirt, worn, asph, rock, means] = await Promise.all([tex(G + 'lawn_a.webp', world), tex(G + 'litter.webp', world), tex(G + 'dirt.webp', world), tex(G + 'worn.webp', world), tex(T + 'asphalt_02_diff.jpg', world), tex(P + 'rock.jpg', world).then((t) => (t.image && t.image.width > 1 ? t : tex(T + 'concrete_wall_008_diff.jpg', world))),
    fetch(G + 'means.json').then((r) => r.json()).catch(() => ({}))]);
  const mean = (k) => new THREE.Vector3(...(means[k] || [0.2, 0.2, 0.2]));
  SH = { tLawn: { value: lawn }, tLitter: { value: litter }, tDirt: { value: dirt }, tWorn: { value: worn }, tAsph: { value: asph }, tRock: { value: rock },
    uMLawn: { value: mean('lawn_a.webp') }, uMLit: { value: mean('litter.webp') }, uMDirt: { value: mean('dirt.webp') }, uMWorn: { value: mean('worn.webp') } };
  return SH;
}

const PARS = /* glsl */`
  uniform sampler2D tMask, tLawn, tLitter, tDirt, tWorn, tAsph, tRock, tParkCut; uniform vec4 uParkBox; uniform vec3 uMLawn, uMLit, uMDirt, uMWorn; uniform vec4 uChunk;
  vec3 tone(vec3 c, vec3 mean, vec3 to) { return to * c / max(mean, vec3(0.01)); }`;
const SAND8 = typeof location === 'undefined' || new URLSearchParams(location.search).get('parksand') !== '0';      // handoff-8: sand without a tile pattern and with a soft worn margin; `?parksand=0` = as before
const BODY = /* glsl */`
  vec2 m = vec2(w.x, -w.y);
  vec3 mk = texture2D(tMask, (m - uChunk.xy) / uChunk.z).rgb;
  if (min(mk.r, min(mk.g, mk.b)) > 0.6) discard;
  if (texture2D(tParkCut, (m - uParkBox.xy) / uParkBox.zw).r <= 0.5) discard;      // the street's own sidewalk is drawn there (cut.js)
  float big = fbm(m * 0.045), mid = fbm(m * 0.33 + 9.0), fine = vnoise(m * 6.0);
  float rag = (mid - 0.5) * 0.5 + (fine - 0.5) * 0.25;
  float sand = min(mk.r, mk.g), paved = smoothstep(0.38, 0.62, mk.r - sand + rag * 0.6), wood = smoothstep(0.30, 0.70, mk.g - sand + rag), rock = smoothstep(0.35, 0.65, mk.b + rag * 0.5);
  ${SAND8 ? `// handoff-8 (critic r3: "a hard straight edge" where sand meets lawn): the mask's own edge is one texel wide and the noise could not move it. The sand's share is read
  // again 1.3 m to four sides: its mean falls off over the margin, the edge is ragged inside it and the lawn beside it is worn (sandM, below)
  vec2 mu = (m - uChunk.xy) / uChunk.z, me = vec2(1.3 / uChunk.z, 0.0); vec3 s1 = texture2D(tMask, mu + me.xy).rgb, s2 = texture2D(tMask, mu - me.xy).rgb, s3 = texture2D(tMask, mu + me.yx).rgb, s4 = texture2D(tMask, mu - me.yx).rgb;
  float sandV = 0.4 * sand + 0.15 * (min(s1.r, s1.g) + min(s2.r, s2.g) + min(s3.r, s3.g) + min(s4.r, s4.g)), sandM = smoothstep(0.04, 0.40, sandV + rag * 0.3);
  sand = smoothstep(0.38, 0.62, sandV + rag * 1.1);` : `float sandM = 0.0;
  sand = smoothstep(0.35, 0.65, sand + rag * 0.6);`}
  float steep = (1.0 - smoothstep(0.66, 0.80, bakeN.y + rag * 0.12)) * (1.0 - paved);
  rock = max(rock, steep);
  // lawn in November: still green, drier drifts, fallen leaves gathering in patches and more under the woods' edge
  vec3 lawn = tone(texture2D(tLawn, m / 3.3).rgb, uMLawn, vec3(0.033, 0.036, 0.016)) * mix(vec3(0.70, 0.80, 0.78), vec3(1.25, 1.08, 0.80), smoothstep(0.25, 0.75, big));
  vec3 wornC = tone(texture2D(tWorn, m / 2.7).rgb, uMWorn, vec3(0.040, 0.038, 0.020));
  lawn = mix(lawn, wornC, smoothstep(0.50, 0.68, fbm(m * 0.11 + 3.0)) * 0.8);      // look pass k1: worn patches were rare (0.55 .. 0.8, 0.7)
  vec3 lit_ = tone(texture2D(tLitter, m / 2.1).rgb, uMLit, vec3(0.060, 0.038, 0.018));
  vec3 lit2 = tone(texture2D(tLitter, m.yx / 3.7 + 0.4).rgb, uMLit, vec3(0.075, 0.050, 0.020));
  vec3 litter = mix(lit_, lit2, smoothstep(0.35, 0.65, mid));
  ${SAND8 ? `// handoff-8 (critic r3: "a visible checker tile on the sand"): one picture laid square every 2.9 m repeated across a playground; now two layers of it, turned
  // and at other sizes, each showing where a slow noise picks it, so no tile comes round
  vec3 dirt = tone(mix(texture2D(tDirt, (m * mat2(0.8, -0.6, 0.6, 0.8)) / 3.7).rgb, texture2D(tDirt, m.yx / 6.1 + 0.37).rgb, smoothstep(0.30, 0.70, fbm(m * 0.23 + 17.0))), uMDirt, vec3(0.062, 0.049, 0.032)) * (0.8 + 0.4 * big);`
  : `vec3 dirt = tone(texture2D(tDirt, m / 2.9).rgb, uMDirt, vec3(0.062, 0.049, 0.032)) * (0.8 + 0.4 * big);`}
  vec3 a1 = texture2D(tAsph, (m * mat2(0.8, -0.6, 0.6, 0.8)) / 6.7).rgb, a2 = texture2D(tAsph, m.yx / 11.3 + 0.31).rgb;      // look pass k1: the first layer lay square at 4 m and its cracks repeated; the paving stood white beside the rock (0.46 -> 0.34)
  vec3 asph = mix(a1, a2, 0.5); asph = mix(vec3(dot(asph, vec3(0.333))), asph, 0.5) * 0.34 + 0.005;      /* Nov 16: was * 1.25 + 0.012: the drives and paths drew near white in sun (stills r1, s1); park asphalt is a worn mid grey */ asph *= 0.78 + 0.45 * big;
  asph *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.02, abs(fbm(m * 0.7 + 40.0) - 0.5) - 0.004)) * step(0.5, big);
  // Manhattan schist: grey, banded along the strike (north-east), glinting; darker in the joints
  vec2 sr = m * mat2(0.819, -0.574, 0.574, 0.819);
  // look pass k1 (critic r1: "pale smooth cream hump with stretched marble veins"): the rock's albedo is on the lawn's scale now (0.36 -> 0.12:
  // the lawn is 0.035), the picture is laid at 2 m and 1.3 m in two directions (was one 5 x 3 m stretch), slabs step in tone along the strike,
  // and soil, moss and grass sit in the cracks
  vec3 rk = mix(texture2D(tRock, sr / vec2(2.1, 1.5)).rgb, texture2D(tRock, sr.yx / vec2(1.3, 1.9) + 0.37).rgb, 0.45); rk = mix(vec3(dot(rk, vec3(0.333))), rk, 0.35);
  float band = fbm(vec2(sr.x * 0.25, sr.y * 3.2) + big * 2.0), joint = (1.0 - smoothstep(0.0, 0.03, abs(fbm(sr * vec2(0.9, 0.35) + 7.0) - 0.5) - 0.006));
  float slab = hash21(vec2(floor(sr.y * 0.9 + fbm(sr * vec2(0.12, 0.5)) * 3.0), 5.0)), crack = 1.0 - smoothstep(0.0, 0.07, abs(fbm(sr * vec2(0.45, 0.16) + 31.0) - 0.5) - 0.012);
  vec3 rockC = rk * vec3(0.076, 0.075, 0.074) *      /* look pass k2: 0.12 still drew pale grey against the sun (still k2a c) */ (0.50 + 0.75 * band) * (0.72 + 0.5 * slab) * (1.0 - 0.6 * joint) + vec3(0.008) * step(0.93, fine);
  rockC = mix(rockC, rockC * vec3(0.55, 0.66, 0.40), smoothstep(0.58, 0.82, fbm(m * 0.21 + 21.0)) * 0.7);      // lichen and moss in the damp parts
  rockC = mix(rockC, mix(dirt * 0.5, mix(dirt, lawn, 0.3) * 0.75, smoothstep(0.4, 0.6, mid)), crack * crack * 0.5 * smoothstep(0.75, 0.9, bakeN.y));      /* lead's read of k2 c: the grass in the cracks drew neon lime (was lawn * 1.1 at 0.85): dull olive-brown and thinner now; NOT seen in a still */      // soil and grass in the cracks of the flatter rock
  float leaves = smoothstep(0.40, 0.70, fbm(m * 0.16 + 11.0) * 0.7 + mid * 0.3);
  vec3 col = mix(lawn, litter, leaves * 0.75);
  col = mix(col, litter, wood);
  col = mix(col, mix(wornC, dirt, 0.4), sandM * 0.75);      // handoff-8: the worn margin of thin grass and trodden soil round a sand patch (0 with ?parksand=0)
  col = mix(col, dirt, sand);
  col = mix(col, mix(asph, litter, leaves * 0.30 * smoothstep(0.4, 0.7, fine)), paved);
  col = mix(col, rockC, rock);
  diffuseColor.rgb = col;
  pkRough = mix(0.97, 0.86, paved);
  pkNight = mix(mix(1.0, 1.36, paved), 4.5, rock);      /* handoff-9: at night the colour goes back up by what the look pass took off (asphalt 0.46 -> 0.34, rock 0.36 -> 0.076; the lawn was not changed): mat.js */
  pkSpec = mix(mix(0.12, 0.22, paved), 0.08, rock);`;      /* look pass k2: grass, litter and weathered schist throw no sheet of glare back at a low sun (mat.js) */

export function material(game, S, tMask, i, j) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  m.userData.own = { tMask };
  return lit(m, game.world.shared, { key: 'ground', pars: PARS, body: BODY, uniforms: { ...S, tMask: { value: tMask }, uChunk: { value: new THREE.Vector4(i * CELL, j * CELL, CELL, 0) } } });
}

const COL = { lawn: '#000', wood: '#0f0', bed: '#0f0', rock: '#00f', sand: '#ff0', water: '#ff0', paving: '#f00', building: '#f00', ice: '#f00', playground: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('parkplay') === '0') ? '#f00' : '#ff0' };      /* critic r2 (Nov 17): the Heckscher playground lay as one sheet of pale paving ("flat white, reads like snow"); a playground's ground is sand and safety surface: the sand / dirt look. ?parkplay=0 = paving as before */
// paint the mask (S px across the chunk) and return the canvas
export function paintMask(S, i, j, data, outline) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), k = S / CELL, X = (x) => (x - i * CELL) * k, Y = (y) => S - (y - j * CELL) * k;
  const ring = (r) => { g.moveTo(X(r[0][0]), Y(r[0][1])); for (let q = 1; q < r.length; q++) g.lineTo(X(r[q][0]), Y(r[q][1])); g.closePath(); };
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#000'; g.beginPath(); ring(outline); g.fill();
  const order = ['wood', 'bed', 'lawn', 'sand', 'rock', 'paving', 'playground', 'water', 'ice', 'building'];
  for (const kind of order) for (const a of data.areas || []) { if (a.kind !== kind || !a.ring || a.ring.length < 3) continue; g.fillStyle = COL[kind] || '#000'; g.beginPath(); ring(a.ring); for (const h of a.holes || []) ring(h); g.fill('evenodd'); }
  // fallen leaves lie under the trees: a soft green (= litter) disc under each crown, adding up in a grove
  g.globalCompositeOperation = 'lighter'; for (const t of data.__trees || []) { const r = Math.max(2.5, t.r * 1.2) * k, x = X(t.x), y = Y(t.y), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,255,0,0.42)'); gr.addColorStop(0.6, 'rgba(0,255,0,0.26)'); gr.addColorStop(1, 'rgba(0,255,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  g.globalCompositeOperation = 'source-over';
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const a of data.areas || []) if (a.kind === 'water' && a.ring && a.ring.length > 2) { for (const [w, col, al] of [[7, '#0f0', 0.5], [3.2, '#ff0', 0.9]]) { g.globalAlpha = al; g.strokeStyle = col; g.lineWidth = w * k; g.beginPath(); ring(a.ring); g.stroke(); } g.setLineDash([1.5 * k, 4 * k]); g.globalAlpha = 0.9; g.strokeStyle = '#00f'; g.lineWidth = 1.6 * k; g.beginPath(); ring(a.ring); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }      // the shore: leaf litter, then mud, with stones along the water's edge
  const line = (p, w, col, a) => { g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = Math.max(1, w * k); g.beginPath(); g.moveTo(X(p.pts[0][0]), Y(p.pts[0][1])); for (let q = 1; q < p.pts.length; q++) g.lineTo(X(p.pts[q][0]), Y(p.pts[q][1])); g.stroke(); g.globalAlpha = 1; };
  const ps = (data.paths || []).filter((p) => p.pts && p.pts.length > 1 && !p.tunnel);
  for (const p of ps) if (p.kind !== 'bridle' && p.kind !== 'transverse') line(p, (p.w || 3) + 1.6, '#ff0', 0.45);      // the worn, dirty margin of a path
  for (const p of ps) if (p.kind === 'bridle') line(p, p.w || 4, '#ff0', 1);
  for (const p of ps) if (p.kind !== 'bridle') line(p, p.w || 3, '#f00', 1);
  return c;
}
// flags per height sample from a small painting: outside the park, under water (0..1)
function flags(i, j, data, outline) {
  const S = N, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true }), k = (S - 1) / CELL, X = (x) => (x - i * CELL) * k + 0.5, Y = (y) => (y - j * CELL) * k + 0.5;
  const ring = (r) => { g.moveTo(X(r[0][0]), Y(r[0][1])); for (let q = 1; q < r.length; q++) g.lineTo(X(r[q][0]), Y(r[q][1])); g.closePath(); };
  g.fillStyle = '#f00'; g.fillRect(0, 0, S, S); g.fillStyle = '#000'; g.beginPath(); ring(outline); g.fill();
  g.fillStyle = '#0f0'; for (const a of data.areas || []) if (a.kind === 'water' && a.ring && a.ring.length > 2) { g.beginPath(); ring(a.ring); for (const h of a.holes || []) ring(h); g.fill('evenodd'); }
  return g.getImageData(0, 0, S, S).data;
}
// heights outside the park's outline are set to 0 in place (the terrain hook answers 0 there); returns the flags
export function prepHeights(cm, i, j, data, outline, inset = 0) { const F = flags(i, j, data, outline); for (let q = 0; q < N * N; q++) if (F[q * 4] > 200) cm[q] = 0;
  // towards the outline the relief fades to the street's level: 0 up to `inset` metres inside (where the street's sidewalk is still drawn), whole from inset + 3 m
  if (inset > 0) { const R = inset + 3, x0 = i * CELL, y0 = j * CELL, E = []; for (let a = 0, b = outline.length - 1; a < outline.length; b = a++) { const p = outline[a], q = outline[b]; if (Math.max(p[0], q[0]) < x0 - R || Math.min(p[0], q[0]) > x0 + CELL + R || Math.max(p[1], q[1]) < y0 - R || Math.min(p[1], q[1]) > y0 + CELL + R) continue; E.push([p[0], p[1], q[0] - p[0], q[1] - p[1]]); }
    if (E.length) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const o = r * N + c; if (cm[o] === 0) continue; const x = x0 + c * STEP, y = y0 + r * STEP; let d = R;
      for (const e of E) { const t = Math.max(0, Math.min(1, ((x - e[0]) * e[2] + (y - e[1]) * e[3]) / (e[2] * e[2] + e[3] * e[3] || 1))), dd = Math.hypot(x - e[0] - e[2] * t, y - e[1] - e[3] * t); if (dd < d) d = dd; }
      if (d < R) { const k = Math.max(0, (d - inset) / 3); cm[o] = Math.round(cm[o] * k * k * (3 - 2 * k)); } } }
  return F; }

// the mesh: step = samples skipped (1 = 2 m, 4 = 8 m)
export function build(game, S, i, j, cm, F, data, outline, far) {
  const step = far ? 4 : 1, n = (N - 1) / step + 1, pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3), x0 = i * CELL, y0 = j * CELL;
  const H = (c, r) => cm[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))] * 0.01, W = (c, r) => F[(r * N + c) * 4 + 1] / 255, out = (c, r) => F[(r * N + c) * 4] > 127;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const C = c * step, R = r * step, o = (r * n + c) * 3, e = step;
    pos[o] = x0 + C * STEP; pos[o + 1] = BASE + H(C, R) - BED * W(C, R) - (far ? 0.06 : 0); pos[o + 2] = -(y0 + R * STEP);
    const gx = (H(C + e, R) - H(C - e, R)) / (2 * e * STEP), gy = (H(C, R + e) - H(C, R - e)) / (2 * e * STEP), l = Math.hypot(gx, gy, 1); nrm[o] = -gx / l; nrm[o + 1] = 1 / l; nrm[o + 2] = gy / l; }
  const idx = []; for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { let all = true; for (let b = 0; b <= step && all; b += step) for (let a = 0; a <= step; a += step) if (!out(c * step + a, r * step + b)) { all = false; break; } if (all) continue;
    const a = r * n + c; idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); geo.setIndex(n * n > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  const mask = new THREE.CanvasTexture(paintMask(far ? 128 : 1024, i, j, data, outline)); mask.colorSpace = THREE.NoColorSpace; mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping; mask.anisotropy = far ? 1 : 4; mask.generateMipmaps = true; mask.minFilter = THREE.LinearMipmapLinearFilter;
  const mesh = new THREE.Mesh(geo, material(game, S, mask, i, j)); mesh.name = 'park_ground'; mesh.receiveShadow = true; mesh.castShadow = false;
  return mesh;
}
