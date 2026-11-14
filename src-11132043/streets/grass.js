// item: grass and lawns (lanes/streets/items/grass). Loads after ground.js, sidewalks.js and plaza.js.
// What it does at load:
//  - hides the lead's flat grass_N meshes (ground.js had given them its FS_GRASS material) and draws one ground mesh per park instead,
//    shaded from a per-park MASK (lawn / path / bed / sand, as signed distances) drawn here from assets/streets/grass/parks.json
//    (park paths and areas from the OpenStreetMap extract; pipeline/grass/layout.py);
//  - lawn albedo, worn grass and soil from CC0 scans (assets/streets/grass/SOURCES.md), toned in the shader (uLawn ...);
//  - real blades near the camera: two instanced rings that follow the camera (positions fixed in the world, wrapped per ring),
//    thinned by the same mask and wear as the ground, swaying a little, lit by the sun, the shadow map and the baked sky light.
// Switches: ?grass=0 leaves the lead's grass as it was (ground.js material); ?grass=flat = ground only, no blades; ?streets=-grass = part off.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const DEFAULT_ON = true;           // v1 (Nov 12 01:1x): ON by default = the flat form in its r13 look (park layout, scanned turf, paths, edging, fence with gate leaves); in-page bench on the M2 Pro +0.35 ms over the lead's grass
                                   // no switch = v1; ?grass=3d = the walked sward (kept look since r22: baked blade heights walked by the view ray, no meshes, no ring); ?grass=1&gcard=1&gnext=1 = + the r13 blades; ?grass=flat = the older flat look; ?grass=0 = the lead's grass
let NXG = false;                   // set by add(): the round's untried look (?gnext=1)
const MASK_D = 8.0;                // metres of signed distance across the 0..1 range of a mask channel
const PATH_W = 4.6, BED_W = 0.55, RIM_W = 1.6;       // park path width, soil strip between a path and its lawn, bed inside the park's outer fence

// ------------------------------------------------------------------ shared GLSL: noise, lawn tint and mask (vertex and fragment agree)
const LAWN_GLSL = /* glsl */`
  uniform sampler2D tGN; uniform sampler2D tMask; uniform vec4 uRect; uniform vec3 uLawn; uniform float uNX;
  vec3 gn(vec2 p) { return textureLod(tGN, p / 16.0, 0.0).rgb; }          // smooth noise, features about one unit of p across
  vec4 lawnMask(vec2 m) { return textureLod(tMask, (m - uRect.xy) / uRect.zw, 0.0); }
  // one field for ground and blades from three noise samples: tint, clover patches, the way the blades are combed
  vec3 lawnField(vec2 m, out float clover, out float comb) {
    vec3 s1 = gn(m / 17.0), s2 = gn(m / 5.3 + 3.7), s3 = gn(m / 1.5 + 9.1);
    float v = 0.5 * s1.r + 0.32 * s2.g + 0.18 * s3.b;
    vec3 t = mix(vec3(0.70, 0.84, 0.86), vec3(1.20, 1.12, 0.98), smoothstep(0.22, 0.78, v));
    float dry = smoothstep(0.58, 0.80, s1.b * 0.6 + s2.r * 0.4);                         // drier, yellower drifts
    t *= mix(vec3(1.0), vec3(1.22, 1.04, 0.74), dry * mix(0.6, 0.45, uNX));
    if (uNX > 0.5) { vec3 s0 = gn(m / 43.0 + 1.7);                                         // at the scale of metres: damp, darker hollows and paler rises; a lawn is never one tone
      t *= mix(0.74, 1.14, smoothstep(0.25, 0.75, s0.g * 0.7 + s2.r * 0.3)) * mix(vec3(1.0), vec3(0.90, 1.0, 0.92), smoothstep(0.55, 0.8, s0.r)); }
    clover = smoothstep(0.60, 0.80, s2.b * 0.7 + s1.g * 0.3);
    comb = s3.r * 9.0 + s2.g * 6.0;
    return t * (1.0 + 0.030 * sin(dot(m, vec2(0.875, -0.487)) * 3.4907));                // faint mowing bands, 1.8 m
  }
`;

// ------------------------------------------------------------------ small helpers
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function noiseTexture() {            // 256 px, tileable, smooth; lattice of 16 (+32 at half weight) per channel
  const N = 256, d = new Uint8Array(N * N * 4), R = rng(4217);
  const lat = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = R(); return a; };
  for (let ch = 0; ch < 3; ch++) {
    const A = lat(16), B = lat(32);
    const smp = (L, n, x, y) => { const fx = x * n / N, fy = y * n / N, ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const i0 = ix % n, i1 = (ix + 1) % n, j0 = iy % n, j1 = (iy + 1) % n; return (L[j0 * n + i0] * (1 - tx) + L[j0 * n + i1] * tx) * (1 - ty) + (L[j1 * n + i0] * (1 - tx) + L[j1 * n + i1] * tx) * ty; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d[(y * N + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(255 * (0.5 + (smp(A, 16, x, y) - 0.5) * 1.25 + (smp(B, 32, x, y) - 0.5) * 0.5))));
  }
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  const sample = (px, py, ch) => { let fx = px * 16 - 0.5, fy = py * 16 - 0.5; const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, i0 = ((ix % N) + N) % N, i1 = (i0 + 1) % N, j0 = ((iy % N) + N) % N, j1 = (j0 + 1) % N;
    return ((d[(j0 * N + i0) * 4 + ch] * (1 - tx) + d[(j0 * N + i1) * 4 + ch] * tx) * (1 - ty) + (d[(j1 * N + i0) * 4 + ch] * (1 - tx) + d[(j1 * N + i1) * 4 + ch] * tx) * ty) / 255; };      // = gn(p)[ch] of the shader
  return { tex: t, sample };
}

// squared euclidean distance transform (Felzenszwalb): for each pixel, distance in pixels to the nearest pixel with on[i] != 0
function edt(on, W, H) {
  const INF = 1e20, n = Math.max(W, H), f = new Float64Array(n), dd = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float32Array(W * H);
  const pass = (len) => { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) { let s; for (;;) { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; } k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; dd[q] = (q - p) * (q - p) + f[p]; } };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = on[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) g[y * W + x] = dd[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; pass(W); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(dd[x]); }
  return g;
}
// signed distance in metres (inside positive), packed to 0..255 around 128
function sdfBytes(alpha, W, H, res, out, ch) {
  const inside = new Uint8Array(W * H), outside = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) { const a = alpha[i * 4] > 127 ? 1 : 0; inside[i] = a; outside[i] = 1 - a; }
  const dOut = edt(outside, W, H), dIn = edt(inside, W, H);          // for inside pixels: distance to the nearest outside pixel, and the reverse
  const d = new Float32Array(W * H), t = new Float32Array(W * H); for (let i = 0; i < W * H; i++) d[i] = (inside[i] ? dOut[i] - 0.5 : -(dIn[i] - 0.5)) * res;
  for (let k = 0; k < 2; k++) {          // soften the pixel staircase of the binary edge: [1 2 1] twice each way
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; t[i] = (d[y * W + Math.max(0, x - 1)] + 2 * d[i] + d[y * W + Math.min(W - 1, x + 1)]) / 4; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; d[i] = (t[Math.max(0, y - 1) * W + x] + 2 * t[i] + t[Math.min(H - 1, y + 1) * W + x]) / 4; } }
  for (let i = 0; i < W * H; i++) out[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(127.5 + d[i] / MASK_D * 255)));
}

function pip(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

// the mask of one park: R = lawn signed distance, G = wear under trees, B = paving signed distance, A = sand
function parkMask(pk, lay, trees, hero, noise) {
  const xs = pk.ext.map((p) => p[0]), ys = pk.ext.map((p) => p[1]), M = 3;
  const x0 = Math.min(...xs) - M, y0 = Math.min(...ys) - M, w = Math.max(...xs) + M - x0, h = Math.max(...ys) + M - y0;
  const res = Math.max(hero ? 0.2 : 0.4, Math.max(w, h) / 1536), W = Math.ceil(w / res), H = Math.ceil(h / res);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.lineJoin = g.lineCap = 'round'; return g; };
  const X = (x) => (x - x0) / res, Y = (y) => (y - y0) / res;
  const ring = (g, pts, close) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); if (close) g.closePath(); };
  const paths = (lay && lay.paths) || [], areas = (lay && lay.areas) || [];
  const big = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
  // paving: the paths, small closed rings (a round plaza), paved areas and an apron round each building
  const gp = mk(); gp.strokeStyle = gp.fillStyle = '#fff';
  for (const p of paths) { ring(gp, p.p, p.c); gp.lineWidth = PATH_W / res; gp.stroke(); if (p.c && big(p.p) < 900) gp.fill(); }
  for (const a of areas) { if (a.k === 'sand' || a.k === 'water') continue; ring(gp, a.p, true); gp.fill(); gp.lineWidth = (a.k === 'building' ? 5.0 : 0.6) / res; gp.stroke(); }
  // sand
  const gs = mk(); gs.fillStyle = gs.strokeStyle = '#fff'; for (const a of areas) if (a.k === 'sand') { ring(gs, a.p, true); gs.fill(); }
  // lawn: the park, less a bed inside its fence, less paving and sand each with a soil strip
  const gl = mk(); gl.fillStyle = '#fff'; ring(gl, pk.ext, true); gl.fill();
  gl.strokeStyle = gl.fillStyle = '#000'; ring(gl, pk.ext, true); gl.lineWidth = 2 * RIM_W / res; gl.stroke();
  for (const p of paths) { ring(gl, p.p, p.c); gl.lineWidth = (PATH_W + 2 * BED_W) / res; gl.stroke(); if (p.c && big(p.p) < 900) gl.fill(); }
  for (const a of areas) { ring(gl, a.p, true); gl.fill(); gl.lineWidth = ((a.k === 'building' ? 5.0 : 0.6) + 2 * BED_W) / res; gl.stroke(); }
  // wear: bare soil round each trunk, wider under some
  const gw = mk(); gw.globalCompositeOperation = 'lighter';
  for (const t of trees) { const r = (NXG ? 2.6 + 5.2 * t.h : 1.6 + 3.8 * t.h) / res, cx = X(t.x), cy = Y(t.y), gr = gw.createRadialGradient(cx, cy, 0, cx, cy, r); const k = Math.round(120 + 135 * t.h2);
    gr.addColorStop(0, `rgb(${k},${k},${k})`); gr.addColorStop(0.35, `rgb(${k >> 1},${k >> 1},${k >> 1})`); gr.addColorStop(1, '#000'); gw.fillStyle = gr; gw.beginPath(); gw.arc(cx, cy, r, 0, 6.2832); gw.fill(); }
  const out = new Uint8Array(W * H * 4), rd = (g) => g.getImageData(0, 0, W, H).data;
  sdfBytes(rd(gl), W, H, res, out, 0); sdfBytes(rd(gp), W, H, res, out, 2);
  // wear (G), on the CPU once: bare rings under trees, a thinned band along every lawn edge, a few bare patches, fine jitter
  const wd = rd(gw), sd = rd(gs), ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }; let lawnPx = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, mx = x0 + (x + 0.5) * res, my = y0 + (y + 0.5) * res, dL = (out[i * 4] - 127.5) / 255 * MASK_D; let wear = 0;
    if (dL > -0.3) {
      const edgeW = 1 - ss(0, 0.12 + 0.5 * noise(mx / 6 + 4, my / 6 + 4, 2), dL);
      const bare = ss(0.80, 0.94, noise(mx / 15 + 5, my / 15 + 5, 1) * 0.7 + noise(mx / 2.3 + 1.3, my / 2.3 + 1.3, 0) * 0.3);
      const jit = (noise(mx / 2.3 + 1.3, my / 2.3 + 1.3, 1) * 0.6 + noise(mx / 0.6 + 7.7, my / 0.6 + 7.7, 0) * 0.4 - 0.5) * 0.3;
      const ring = wd[i * 4] / 255 * (0.25 + 1.5 * noise(mx / 1.3 + 2.2, my / 1.3 + 2.2, 2));          // a ring of bare soil is never a clean disc
      wear = Math.max(0, Math.min(1, Math.max(ring * 1.0, edgeW * 0.85, bare * 0.3) + jit));
    }
    out[i * 4 + 1] = Math.round(wear * 255); out[i * 4 + 3] = sd[i * 4]; if (out[i * 4] > 128) lawnPx++;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  const sdf = (x, y, ch) => { const px = Math.max(0, Math.min(W - 1, Math.floor((x - x0) / res))), py = Math.max(0, Math.min(H - 1, Math.floor((y - y0) / res))), v = out[(py * W + px) * 4 + ch]; return ch === 0 || ch === 2 ? (v - 127.5) / 255 * MASK_D : v / 255; };
  return { tex, rect: new THREE.Vector4(x0, y0, W * res, H * res), res, W, H, lawnM2: lawnPx * res * res, data: out, sdf, hasPaths: paths.length > 0 };
}

// ------------------------------------------------------------------ lawn edges: contour lines of a mask channel, the stone edging and the low fence
// iso-line of byte channel `ch` of a mask at `level` metres (marching squares on every `step`-th pixel); returns polylines in map metres
function contours(mask, ch, level, step) {
  const { W, H, res, data, rect } = mask, gw = Math.floor((W - 1) / step) + 1, gh = Math.floor((H - 1) / step) + 1;
  const val = (x, y) => (data[(y * step * W + x * step) * 4 + ch] - 127.5) / 255 * MASK_D - level;
  const pts = new Map(), link = new Map();
  const edgePt = (x, y, v) => { const k = (y * gw + x) * 2 + v; if (!pts.has(k)) { const a = val(x, y), b = v ? val(x, y + 1) : val(x + 1, y), t = a / (a - b); pts.set(k, [rect.x + (x + (v ? 0 : t)) * step * res + 0.5 * res, rect.y + (y + (v ? t : 0)) * step * res + 0.5 * res]); } return k; };
  const join = (a, b) => { (link.get(a) || link.set(a, []).get(a)).push(b); (link.get(b) || link.set(b, []).get(b)).push(a); };
  for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
    const c = (val(x, y) > 0 ? 1 : 0) | (val(x + 1, y) > 0 ? 2 : 0) | (val(x + 1, y + 1) > 0 ? 4 : 0) | (val(x, y + 1) > 0 ? 8 : 0); if (c === 0 || c === 15) continue;
    const B = () => edgePt(x, y, 0), Rr = () => edgePt(x + 1, y, 1), T = () => edgePt(x, y + 1, 0), Lf = () => edgePt(x, y, 1);
    switch (c) { case 1: case 14: join(Lf(), B()); break; case 2: case 13: join(B(), Rr()); break; case 3: case 12: join(Lf(), Rr()); break; case 4: case 11: join(Rr(), T()); break;
      case 6: case 9: join(B(), T()); break; case 7: case 8: join(Lf(), T()); break; case 5: join(Lf(), T()); join(B(), Rr()); break; case 10: join(Lf(), B()); join(Rr(), T()); break; }
  }
  const used = new Set(), out = [];
  const walk = (k0) => { const line = [k0]; used.add(k0); let k = k0; for (;;) { const nx = (link.get(k) || []).find((q) => !used.has(q)); if (nx === undefined) break; used.add(nx); line.push(nx); k = nx; } return line; };
  for (const [k, l] of link) if (!used.has(k) && l.length === 1) out.push({ closed: false, p: walk(k).map((q) => pts.get(q)) });       // open lines first, from their ends
  for (const [k] of link) if (!used.has(k)) { const w = walk(k); out.push({ closed: true, p: w.map((q) => pts.get(q)) }); }
  for (const l of out) for (let pass = 0; pass < 3; pass++) { const P = l.p, n = P.length; if (n < 5) break;          // smooth the grid's zigzag out of the line
    l.p = P.map((q, i) => { if (!l.closed && (i === 0 || i === n - 1)) return q; const a = P[(i - 1 + n) % n], b = P[(i + 1) % n]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4]; }); }
  return out;
}
// points every `sp` metres along a polyline (closed ones are divided evenly); each [x, y, tx, ty]
function resample(line, sp) {
  const P = line.closed ? line.p.concat([line.p[0]]) : line.p, cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const Lt = cum[cum.length - 1]; if (Lt < sp * 1.5) return []; const n = Math.max(2, Math.round(Lt / sp)), out = []; let j = 1;
  for (let i = 0; i <= n; i++) { const d = Math.min(Lt - 1e-6, i * Lt / n); while (cum[j] < d) j++; const t = (d - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1]), a = P[j - 1], b = P[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / L, (b[1] - a[1]) / L]); }
  return out;
}
// hexagonal asphalt blocks as a tileable picture (16 blocks x 9 double rows = 3.2 m x 3.118 m): a tone for each block, dark joints; mip-mapped, so it never shimmers
function hexTexture(maxAniso) {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), R = rng(733), CX = 16, CY = 9, sx = N / CX, sy = N / (CY * 1.7320508), rad = 0.5774 - 0.035;
  g.fillStyle = 'rgb(52,50,47)'; g.fillRect(0, 0, N, N);
  const hex = (cx, cy, tone) => { g.fillStyle = `rgb(${tone},${tone},${tone})`; g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3, x = (cx + Math.cos(a) * rad) * sx, y = (cy + Math.sin(a) * rad) * sy; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill(); };
  for (let j = 0; j < CY * 2; j++) for (let i = 0; i < CX; i++) { const cx = i + (j % 2 ? 0.5 : 0), cy = j * 0.8660254, r = R(), tone = Math.round(120 + 50 * R() + (r > 0.95 ? -34 : r < 0.03 ? 26 : 0));
    for (const ox of [-CX, 0, CX]) for (const oy of [-CY * 1.7320508, 0, CY * 1.7320508]) if (cx + ox > -1 && cx + ox < CX + 1 && cy + oy > -1 && cy + oy < CY * 1.7320508 + 1) hex(cx + ox, cy + oy, tone); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, maxAniso); t.colorSpace = THREE.NoColorSpace; return t;
}
function wireTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(0, 0, 5, 64); g.fillRect(0, 0, 64, 4); g.fillRect(31, 0, 2, 64);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
}
function wireTexture2() {          // thin woven wire, cells 5 cm x 10 cm (tile = 0.05 m x 0.10 m), no rails
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(0, 0, 5, 64); g.fillRect(0, 0, 64, 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
}
// stone edging (a raised strip just outside the paving) and the lawn fence (posts, two rails, wire) of one park
function buildEdges(pk, mask, gy, R, NX) {
  const inPark = (x, y) => pip(x, y, pk.ext);
  const K = { pos: [], nrm: [], col: [], idx: [] }, F = { pos: [], nrm: [], idx: [] }, Wm = { pos: [], nrm: [], uv: [], idx: [] };
  const quad = (A, a, b, c, d, n, extra) => { const o = A.pos.length / 3; for (const v of [a, b, c, d]) { A.pos.push(v[0], v[2], -v[1]); A.nrm.push(n[0], n[2], -n[1]); } A.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); if (extra) extra(o); };
  const box = (A, cx, cy, z0, z1, tx, ty, hl, hw, top) => { const nx = -ty, ny = tx, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + tx * hl * u + nx * hw * v, cy + ty * hl * u + ny * hw * v]);
    const side = (i, j, n) => quad(A, [c[i][0], c[i][1], z0], [c[j][0], c[j][1], z0], [c[j][0], c[j][1], z1], [c[i][0], c[i][1], z1], n);
    side(0, 1, [-nx, -ny, 0]); side(1, 2, [tx, ty, 0]); side(2, 3, [nx, ny, 0]); side(3, 0, [-tx, -ty, 0]);
    if (top) quad(A, [c[0][0], c[0][1], z1], [c[1][0], c[1][1], z1], [c[2][0], c[2][1], z1], [c[3][0], c[3][1], z1], [0, 0, 1]); };
  // edging: centre line 0.09 m outside the paving, 0.18 wide, 0.05 high, in stones about 0.9 m long
  const KH = 0.05, KW = 0.09; let kerbM = 0;
  for (const line of contours(mask, 2, -KW, 2)) { const q = resample(line, NX ? 0.45 : 0.9); let left = 0, cc = null, zs = 0, tilt = 0, sunk = 0;
    for (let i = 0; i + 1 < q.length; i++) { const a = q[i], b0 = q[i + 1]; let b, z1a, z1b;
      if (NX) {          // a stone runs over 2 to 6 steps (0.9 to 2.7 m); one tone, one stain, one tilt per stone; a joint only at its end; some have sunk into the soil
        if (left <= 0) { left = 2 + Math.floor(R() * 5); const t = 0.42 + 0.34 * R(), moss = R() < 0.3 ? 0.5 * R() : 0, dirt = R() < 0.35 ? 0.5 * R() : 0; cc = [t * (1 - 0.25 * moss + 0.10 * dirt), t * (1 + 0.04 * moss), t * (0.94 - 0.30 * moss - 0.22 * dirt)]; zs = left; tilt = (R() - 0.5) * 0.022; sunk = R() < 0.25 ? 0.02 * R() : 0.006 * R(); }
        const k0 = zs - left, joint = left === 1 ? 0.016 : 0; left--; b = [b0[0] - b0[2] * joint, b0[1] - b0[3] * joint, b0[2], b0[3]];
        z1a = gy + 0.036 - sunk + tilt * (k0 / zs - 0.5); z1b = gy + 0.036 - sunk + tilt * ((k0 + 1) / zs - 0.5);
      } else { b = [b0[0] - b0[2] * 0.012, b0[1] - b0[3] * 0.012, b0[2], b0[3]]; const t = 0.86 + 0.28 * R(); cc = [t, t * (0.98 + 0.04 * R()), t * (0.95 + 0.05 * R())]; z1a = z1b = gy + KH - 0.012 * R(); }
      if (!inPark(a[0], a[1]) || !inPark(b[0], b[1])) continue; const na = [-a[3], a[2]], nb = [-b[3], b[2]];
      const al = [a[0] + na[0] * KW, a[1] + na[1] * KW], ar = [a[0] - na[0] * KW, a[1] - na[1] * KW], bl = [b[0] + nb[0] * KW, b[1] + nb[1] * KW], br = [b[0] - nb[0] * KW, b[1] - nb[1] * KW], z0 = gy - 0.02, z1 = z1a;
      const paint = () => { for (let k = 0; k < 4; k++) K.col.push(cc[0], cc[1], cc[2]); };
      quad(K, [al[0], al[1], z1a], [ar[0], ar[1], z1a], [br[0], br[1], z1b], [bl[0], bl[1], z1b], [0, 0, 1], paint);
      quad(K, [ar[0], ar[1], z0], [br[0], br[1], z0], [br[0], br[1], z1b], [ar[0], ar[1], z1], [-na[0], -na[1], 0], paint);
      quad(K, [bl[0], bl[1], z0], [al[0], al[1], z0], [al[0], al[1], z1], [bl[0], bl[1], z1b], [na[0], na[1], 0], paint);
      kerbM += Math.hypot(b[0] - a[0], b[1] - a[1]); } }
  // fence: 0.27 m outside the paving; round posts every ~2.4 m, about 1.0 m high and never quite plumb, a ball on top; wire that sags a little between them
  const RB = 0.05; let fenceM = 0, panel = 0; const segs = [];          // segs: the fence as collision segments (map metres); every 11th panel is left out as a gate, in the picture and in the wall
  const post = (x, y, z0, z1, lx, ly, r) => { const n = 7; for (let k = 0; k < n; k++) { const a0 = k / n * 6.2832, a1 = (k + 1) / n * 6.2832, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), am = (a0 + a1) / 2;
      quad(F, [x + c0 * r, y + s0 * r, z0], [x + c1 * r, y + s1 * r, z0], [x + lx + c1 * r, y + ly + s1 * r, z1], [x + lx + c0 * r, y + ly + s0 * r, z1], [Math.cos(am), Math.sin(am), 0]); }
    // finial: a small ball (two cones) on a neck
    const o = F.pos.length / 3, bx = x + lx, by = y + ly, rb = r * 1.55, zc = z1 + rb * 0.9; for (let k = 0; k < n; k++) { const a0 = k / n * 6.2832; F.pos.push(bx + Math.cos(a0) * rb, zc, -(by + Math.sin(a0) * rb)); F.nrm.push(Math.cos(a0), 0, -Math.sin(a0)); }
    F.pos.push(bx, zc + rb * 1.25, -by, bx, zc - rb, -by); F.nrm.push(0, 1, 0, 0, -1, 0); for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; F.idx.push(o + k, o + k1, o + n, o + k1, o + k, o + n + 1); } };
  const FH = NX ? 0.84 : 0.97, FR = NX ? 0.025 : 0.027, TU = 0.05, TV = NX ? 0.10 : 0.15;
  for (const line of contours(mask, 2, -0.27, 2)) { const q = resample(line, NX ? 1.85 : 2.4); let prev = null;
    for (let i = 0; i < q.length; i++) { const a = q[i], ok = inPark(a[0], a[1]) && mask.sdf(a[0], a[1], 3) < 0.5; if (!ok) { prev = null; continue; }
      const last = line.closed && i === q.length - 1, P = last ? q[0].post : { h: FH + 0.06 * R(), lx: (R() - 0.5) * (NX ? 0.06 : 0.035), ly: (R() - 0.5) * (NX ? 0.06 : 0.035) }; a.post = P;
      if (!last) post(a[0], a[1], gy - 0.02, gy + P.h, P.lx, P.ly, FR);
      if (prev && NX && ((panel + 1) % 11) === 5) { for (const g of [prev, a]) post(g[0], g[1], gy - 0.02, gy + g.post.h + 0.04, g.post.lx, g.post.ly, FR * 1.25);
        // the gate itself: a wire leaf on a frame, hinged on the first post and standing open into the lawn, so the gap reads as a gate and not as a lost panel
        const dx = a[0] - prev[0], dy = a[1] - prev[1], L = Math.hypot(dx, dy), tx = dx / L, ty = dy / L; let nx = -ty, ny = tx;
        if (mask.sdf(prev[0] + nx * 0.6, prev[1] + ny * 0.6, 2) > mask.sdf(prev[0] - nx * 0.6, prev[1] - ny * 0.6, 2)) { nx = -nx; ny = -ny; }
        const ang = 1.15 + 0.3 * R(), ex = tx * Math.cos(ang) + nx * Math.sin(ang), ey = ty * Math.cos(ang) + ny * Math.sin(ang), GL = L - 0.08, e = [prev[0] + ex * GL, prev[1] + ey * GL], hh = prev.post.h - 0.06, mx = prev[0] + ex * GL / 2, my = prev[1] + ey * GL / 2;
        post(e[0], e[1], gy + 0.03, gy + hh, 0, 0, FR * 0.75);
        box(F, mx, my, gy + hh - 0.03, gy + hh, ex, ey, GL / 2, 0.011, true); box(F, mx, my, gy + 0.05, gy + 0.075, ex, ey, GL / 2, 0.011, true);
        { const o = Wm.pos.length / 3; for (const [px, py, z, uu, vv] of [[prev[0], prev[1], gy + 0.06, 0, 0], [e[0], e[1], gy + 0.06, GL / TU, 0], [e[0], e[1], gy + hh, GL / TU, (hh - 0.06) / TV], [prev[0], prev[1], gy + hh, 0, (hh - 0.06) / TV]]) { Wm.pos.push(px, z, -py); Wm.nrm.push(-ey, 0, -ex); Wm.uv.push(uu, vv); } Wm.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); } }
      if (prev && (++panel % 11) !== 5) { const dx = a[0] - prev[0], dy = a[1] - prev[1], L = Math.hypot(dx, dy); segs.push([prev[0], prev[1], a[0], a[1]]); const tx = dx / L, ty = dy / L, n = [-ty, tx], NS = 4, sag = 0.008 + 0.02 * R(), Q0 = prev.post;
        for (let k = 0; k < NS; k++) { const u0 = k / NS, u1 = (k + 1) / NS, o = Wm.pos.length / 3;
          const at = (u, top) => { const hh = Q0.h + (P.h - Q0.h) * u - 0.03 - sag * 4 * u * (1 - u), lean = top ? 1 : 0; return [prev[0] + dx * u + (Q0.lx + (P.lx - Q0.lx) * u) * lean, prev[1] + dy * u + (Q0.ly + (P.ly - Q0.ly) * u) * lean, top ? gy + hh : gy + RB, u * L / TU, top ? (hh - RB) / TV : 0]; };
          for (const [px, py, z, uu, vv] of [at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)]) { Wm.pos.push(px, z, -py); Wm.nrm.push(n[0], 0, -n[1]); Wm.uv.push(uu, vv); }
          Wm.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
        fenceM += L; }
      prev = a; } }
  const geo = (A) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nrm, 3)); if (A.col) g.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3)); if (A.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2)); g.setIndex(A.idx); return g; };
  return { kerb: K.idx.length ? geo(K) : null, fence: F.idx.length ? geo(F) : null, wire: Wm.idx.length ? geo(Wm) : null, segs, kerbM, fenceM, tris: (K.idx.length + F.idx.length + Wm.idx.length) / 3 };
}

// ------------------------------------------------------------------ the ground of a park
const FS_PARK = /* glsl */`
  vec4 K = texture2D(tMask, (m - uRect.xy) / uRect.zw);
  float dL = (K.r - 0.5) * ${MASK_D.toFixed(1)}, dP = (K.b - 0.5) * ${MASK_D.toFixed(1)};
  vec3 toCam = cameraPosition - vWPos; float dist = length(toCam), up = clamp(toCam.y / dist, 0.0, 1.0);
  vec2 gx = dFdx(m), gy = dFdy(m);
  vec3 n1 = texture2D(tGN, m / 3.0 / 16.0).rgb, n2 = texture2D(tGN, m / 0.45 / 16.0 + 0.31).rgb;
  // wear: the mask's field, broken up at tuft scale so grass thins out in ragged tufts and never fades like an airbrush
  vec3 cl = gn(m / 0.33 + 5.5); float tfade = uNX * (1.0 - smoothstep(0.008, 0.035, px));          // only while a 0.3 m tuft covers ten pixels or more: further out the field aliased into blotches (r12 first capture)          // the blades' own tuft field: the ground under them clumps the same way
  float wear = clamp(K.g + (n2.r - 0.5) * 0.55 * smoothstep(0.05, 0.3, K.g) + (n1.r - 0.5) * 0.12 + (0.5 - cl.r) * 0.5 * uNX * smoothstep(0.05, 0.3, K.g), 0.0, 1.0);
  vec3 col; float pomSun = 1.0, hh = 1.0;
  #ifdef GOBL
  wear = clamp(wear + 0.0 * smoothstep(0.60, 0.80, texture2D(tGN, m / 7.0 / 16.0 + 0.77).g * 0.7 + n1.g * 0.3), 0.0, 1.0);          // thin, dry places come anywhere on a lawn, not only where the mask has wear
  #endif
  #ifdef GPOM
  wear = clamp(K.g + (n2.r - 0.5) * 0.22 * smoothstep(0.05, 0.3, K.g) + (n1.r - 0.5) * 0.12, 0.0, 1.0);          // the tufts themselves break the edge of a worn patch up: no noise blocks
  #endif
  if (dL > -0.12) {
    float clover, comb; vec3 tint = lawnField(m, clover, comb);
    tint *= 1.0 + (0.015 + mix(0.05, 0.08, uNX) * up * up) * (0.4 + 1.2 * n1.b) * sin(dot(m, vec2(0.875, -0.487)) * (3.2 + 0.5 * texture2D(tGN, m / 40.0 / 16.0).g) + 2.5 * n1.g);        // mowing bands: uneven, read from above, hardly at eye height
    #ifdef GPOM
    // the sward as a height field (blades drawn top-down at load, tallest wins: A height, RGB tone from the scan): the view ray is walked through a slab
    // of uPom.x metres, so blades hide what stands behind them, show their sides at a low angle and shade one another from the sun. The same picture,
    // unwalked, is the far lawn: no ring, no seam.
    {
      const float TILE = 3.2; const float TEXEL = 3.2 / 2048.0;
      vec3 Vw = normalize(vWPos - cameraPosition); vec3 rd = vec3(Vw.x, -Vw.z, Vw.y);
      float pxMin = min(length(gx), length(gy)) + 1e-5, lod0 = max(0.0, log2(pxMin / TEXEL));
      float Hm = uPom.x * (1.0 - smoothstep(uPom.z * 0.6, uPom.z, dist));
      float cut = clamp(wear * 0.9 + (1.0 - smoothstep(0.0, 0.3, dL)) * 0.25 + 0.25 * clover, 0.0, 0.96), hmul = 0.88 + 0.12 * smoothstep(0.25, 0.75, cl.r);
      tint = mix(vec3(dot(tint, vec3(0.3, 0.5, 0.2))), tint, 0.6); float above = smoothstep(8.0, 35.0, cameraPosition.y - vWPos.y); tint = mix(vec3(1.0), tint, mix(1.0, 0.85, above));          // the sward carries its own clumps: the tint field only drifts, more faintly still from above
      { float wob = texture2D(tGN, m / 31.0 / 16.0 + 0.27).b * 1.2 + n1.g * 0.35;          // a mower never drives dead straight or at one width
        float q1 = smoothstep(-0.25, 0.25, sin(dot(m, vec2(0.875, -0.487)) * 3.3 + wob)) - 0.5, q2 = smoothstep(-0.25, 0.25, sin(dot(m, vec2(0.487, 0.875)) * 1.745 + 0.9 + wob * 0.7)) - 0.5;          // mowing: straight stripes 1.8 m wide, crossed by a fainter second pass (seen from above; faint at eye height)
        float sv = 0.35 + 1.3 * texture2D(tGN, m / 23.0 / 16.0 + 0.61).r; tint *= 1.0 + ((0.02 + 0.075 * up * up) * q1 + (0.01 + 0.04 * up * up) * q2) * sv; }          // the stripes fade and return across the lawn
      #define SWH(p, l) max(0.0, (textureLod(tSwH, (p) / TILE, l).r * hmul - cut) / (1.0 - cut))
      vec2 hit = m;
      if (Hm > 0.003) {
        // exact walk over a pyramid of maxima (tSwM: level L holds the tallest blade of each 2^L texel cell): skip a whole cell while the ray is above its
        // tallest blade, go one level down when it is not; ends on a texel of level Lmin (the pixel's own size), so far grass thickens into tufts, never noise
        vec2 dm = rd.xy * (Hm / max(-rd.z, 0.02)); float runL = length(dm), sc = min(1.0, uPom.w / max(runL, 1e-5)); dm *= sc; Hm *= sc;
        const int MAXL = 6; float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));          // the level the walk ends on changes pixel by pixel across a distance, never along a line (r21: a straight band where it stepped)
        int Lmin = int(clamp(floor(lod0 + uPomK2.x + ign - 0.5), 0.0, 6.0)), lev = MAXL;
        vec2 ro = mod(m, TILE) / TEXEL, dv = dm / TEXEL; dv += (1.0 - step(1e-4, abs(dv))) * 1e-4; vec2 sgn = step(0.0, dv), inv = 1.0 / dv;
        float t = 0.0, eps = 0.02 / max(abs(dv.x), abs(dv.y)); bool found = false;
        int NI = int(uPomK2.z); for (int i = 0; i < NI; i++) {
          float cs = exp2(float(lev)); vec2 cell = floor((ro + dv * t) / cs);
          float h = max(0.0, (texelFetch(tSwM, ivec2(cell) & ((2048 >> lev) - 1), lev).r * hmul - cut) / (1.0 - cut)), th = 1.0 - h;
          if (t >= th) { if (lev <= Lmin) { found = true; break; } lev--; continue; }
          vec2 tb = ((cell + sgn) * cs - ro) * inv; float te = min(tb.x, tb.y);
          if (th <= te) { t = th; if (lev <= Lmin) { found = true; break; } lev--; }
          else { t = te + eps; if (t >= 1.0) break; lev = min(lev + 1, MAXL); }
        }
        t = min(t, 1.0); hit = m + dm * t; hh = found ? 1.0 - t : 0.0;
        vec3 Lm = vec3(uSunDir.x, -uSunDir.z, uSunDir.y); vec2 Lxy = Lm.xy / max(Lm.z, 0.2) * Hm; float sh = 1.0, lodS = max(lod0, 1.0);
        for (int k = 1; k <= 4; k++) { float hk = hh + (1.0 - hh) * (float(k) - 0.5) * 0.25; float hq = SWH(hit + Lxy * (hk - hh), lodS + float(k) * 0.5); sh = min(sh, 1.0 - clamp((hq - hk) * uPomK2.y, 0.0, 1.0)); }
        pomSun = mix(1.0, sh, uPomK.y * smoothstep(0.003, 0.02, Hm));
        vec4 s = textureLod(tSw, hit / TILE, max(0.0, lod0 - 0.4 + 2.4 * above));          // from above a lawn is a smooth nap: no blade speckle
        col = s.rgb * 2.0 * mix(uPomK.x, 1.0, smoothstep(0.0, 0.75, hh));
      } else {
        vec4 s = texture2D(tSw, m / TILE); hh = max(0.0, (texture2D(tSwH, m / TILE).r * hmul - cut) / (1.0 - cut));
        col = s.rgb * 2.0 * mix(uPomK.x, 1.0, smoothstep(0.0, 0.75, hh));
      }
      col *= uLawn * tint * uPomK.z * mix(vec3(1.45, 1.34, 1.14), vec3(1.0), above);          // at eye height the sunlit yellow-green that scored in r19; from above the deeper green that scored in r21
    }
    #elif defined(GOBL)
    // the photographed sward: a strip of real lawn photographed from standing height (its blades seen from the side), laid on the ground stretched
    // along the view ray so it shows as it was photographed; see oblique() above. From steep above: the top-down scan, toned down to a nap.
    {
      float above = smoothstep(8.0, 35.0, cameraPosition.y - vWPos.y);
      tint = mix(vec3(dot(tint, vec3(0.3, 0.5, 0.2))), tint, 0.75);
      { vec3 w0 = texture2D(tGN, m / 31.0 / 16.0 + 0.27).rgb, pn = texture2D(tGN, m / 70.0 / 16.0 + 0.53).rgb; float wob = w0.b * 1.2 + n1.g * 0.35;
        // mowing: stripes about 1.9 m wide that wander, in panels worked in two directions, showing only in places (grown out elsewhere)
        float dsel = step(0.5, pn.r); vec2 d1 = mix(vec2(0.875, -0.487), vec2(0.60, 0.80), dsel);
        float q1 = smoothstep(-0.14, 0.14, sin(dot(m, d1) * 3.3 + wob * 2.5 + 6.0 * pn.b) + 0.5 * (w0.g - 0.5)) - 0.5;
        float sv = (0.35 + 0.65 * smoothstep(0.25, 0.60, texture2D(tGN, m / 23.0 / 16.0 + 0.61).r)) * (0.5 + 1.0 * w0.r) * smoothstep(0.0, 0.05, abs(pn.r - 0.5));
        tint *= 1.0 + (0.02 + 0.085 * up * up) * q1 * sv; }
      vec3 Vw = normalize(vWPos - cameraPosition); float se = clamp(-Vw.y, 0.0, 1.0), wTop = smoothstep(uOb2.x, uOb2.y, se);
      vec3 det = vec3(1.0);
      if (wTop < 0.999) det = oblique(m, gx, gy, Vw);
      if (wTop > 0.001) { vec3 top = textureGrad(tLawnA, m / 1.9, gx / 1.9, gy / 1.9).rgb / uMeanA;
        if (above > 0.01) {          // from the air blades do not resolve: what shows is the mottle of tufts and thin places; the scans at a wide scale give it
          vec3 M1 = texture2D(tLawnA, m / 9.0).rgb / uMeanA, M2 = texture2D(tLawnB, vec2(m.y, -m.x) / 23.0 + 0.3).rgb / uMeanB;
          top = mix(top, mix(vec3(1.0), top, 0.6) * mix(vec3(1.0), M1 * mix(vec3(1.0), M2, 0.5), uObA.w), above); }
        det = mix(det, top, wTop); }
      det = mix(det, vec3(1.0), smoothstep(60.0, 220.0, dist) * 0.6);
      { float dl = dot(det, vec3(0.3, 0.55, 0.15)); hh = clamp(dl * 0.45, 0.0, 1.0);
        det *= min(1.0, (1.25 + 0.35 * (dl - 1.25)) / max(dl, 1.25));          // the brightest tips held down: a lawn does not glitter
        det *= mix(vec3(0.84, 1.0, 0.88), vec3(1.07, 1.03, 0.90), smoothstep(0.45, 1.6, dl));          // lit tips a little yellower, the gaps between blades a deeper green
        float eye = 1.0 - above;
        det *= 1.0 - 0.20 * eye * smoothstep(0.55, 0.80, cl.g * 0.5 + n2.r * 0.5);          // darker, denser tufts
        float clv = max(clover, eye * smoothstep(0.60, 0.74, n1.b * 0.65 + n2.g * 0.35));
        if (clv > 0.01) { det = mix(det, mix(det, vec3(dl), 0.5) * vec3(0.74, 0.90, 0.84), clv * 0.75);          // clover: darker, bluer, smoother patches, with a few white heads
          vec2 fc = m * 9.0, fi = floor(fc); vec2 fr = fract(sin(vec2(dot(fi, vec2(127.1, 311.7)), dot(fi, vec2(269.5, 183.3)))) * 43758.5453);
          float fd = length(fc - fi - 0.2 - 0.6 * fr), fw = max(0.11, px * 9.0 * 0.7);
          det = mix(det, vec3(3.2, 3.0, 3.3), (1.0 - smoothstep(fw * 0.6, fw, fd)) * step(0.55, fract(fr.x * 7.3 + fr.y * 3.1)) * smoothstep(0.5, 0.9, clv) * min(1.0, 0.11 / fw) * eye * 0.0); }
        vec2 sdn = normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-5);          // the ground is never a plane: slow rises catch the sun, their far sides lose a little
        float rel = texture2D(tGN, (m + sdn * 0.9) / 3.0 / 16.0).r - n1.r + 0.6 * (texture2D(tGN, (m + sdn * 2.5) / 11.0 / 16.0 + 0.4).g - texture2D(tGN, m / 11.0 / 16.0 + 0.4).g);
        det *= 1.0 + clamp(rel * 1.1, -0.22, 0.22) * eye; }
      col = uLawn * tint * det * uOb.w * mix(uObE, uObA.rgb, above);
    }
    #else
    // lawn: scanned turf at two sizes (the large one takes over with distance so the small one's repeat never shows), toned by the tint field
    #if defined(GCHEAP) || defined(GEXACT)
    #ifdef GEXACT
    float n0 = 5.0, n9 = 30.0;          // ?gcheap=2 (loop 5): exactly the blend's own limits, so the picture is the same to the bit: one scan read beyond 30 m and inside 5 m
    #else
    float n0 = mix(5.0, 12.0, uNX), n9 = mix(30.0, 60.0, uNX);
    #endif
    vec3 A1 = vec3(0.0), A2 = vec3(0.0);          // one scan where one is all that shows: the fine one near, the wide one far
    if (dist < n9) A1 = textureGrad(tLawnA, m / 1.9, gx / 1.9, gy / 1.9).rgb;
    if (dist > n0) A2 = textureGrad(tLawnA, vec2(m.y, -m.x) / 6.7 + 0.37, vec2(gx.y, -gx.x) / 6.7, vec2(gy.y, -gy.x) / 6.7).rgb;
    #else
    vec3 A1 = textureGrad(tLawnA, m / 1.9, gx / 1.9, gy / 1.9).rgb, A2 = textureGrad(tLawnA, vec2(m.y, -m.x) / 6.7 + 0.37, vec2(gx.y, -gx.x) / 6.7, vec2(gy.y, -gy.x) / 6.7).rgb;
    #endif
    vec3 det = mix(A1, A2, smoothstep(5.0, 30.0, dist)) / uMeanA;
    if (clover > 0.01) det = mix(det, textureGrad(tLawnB, m / 3.1, gx / 3.1, gy / 3.1).rgb / uMeanB * vec3(0.80, 0.93, 0.85), clover * 0.7);
    det = mix(det, vec3(1.0), smoothstep(50.0, 200.0, dist) * 0.6);
    det = mix(det, vec3(1.0), 0.7 * uNX * smoothstep(8.0, 35.0, cameraPosition.y - vWPos.y));          // from above the scan's grain reads as a tiled noise: tone only
    col = uLawn * tint * det * mix(uEyeK, vec3(1.0), smoothstep(8.0, 35.0, cameraPosition.y - vWPos.y));          // at eye height the brighter, less saturated green of the park's lawns in photographs (hue 83, saturation 0.56); from the air the deeper green as before
    col *= (1.0 - 0.22 * tfade * smoothstep(0.62, 0.30, cl.r)) * (1.0 + 0.16 * tfade * smoothstep(0.62, 0.85, cl.r));          // dark troughs between tufts, lit tuft tops
    col *= mix(uUnder, 0.80, smoothstep(uNear.x, uNear.y, dist)) * (1.0 + 0.08 * pow(1.0 - up, 3.0));          // the game's depth AO already darkens between near blades       // between near blades: shaded thatch; far off: lit blade tops
    #endif
    #ifdef GOBL
    col *= mix(uSwG.z, 1.0, smoothstep(uSwG.x, uSwG.y, dist));          // under the mesh sward (grass_sward.js): shaded thatch; 1 when it is off
    #endif
    if (wear > 0.12) {
      #if defined(GPOM) || defined(GOBL)
      float wq = wear + (0.30 - hh) * 0.55 - 0.22;          // soil shows between the tufts first, and only where wear is heavy; a standing tuft stays green
      #ifdef GOBL
      col *= mix(vec3(1.0), vec3(1.26, 1.13, 0.84), smoothstep(0.14, 0.30, wear + (n2.r - 0.5) * 0.30 + (cl.r - 0.5) * 0.2) * (0.55 + 0.45 * n2.b));
      #else
      col *= mix(vec3(1.0), vec3(1.42, 1.22, 0.80), smoothstep(0.12, 0.34, wear) * (0.55 + 0.45 * n2.b));
      #endif          // light wear: the sward goes dry and yellow before it goes bare
      #else
      float wq = wear;
      #endif
      vec3 worn = textureGrad(tWorn, m / 2.9, gx / 2.9, gy / 2.9).rgb / uMeanW * uWorn * mix(vec3(1.0), tint, 0.5);
      vec3 dirt = textureGrad(tDirt, m / 2.3, gx / 2.3, gy / 2.3).rgb / uMeanD * uDirt;
      col = mix(col, worn, smoothstep(0.30, 0.42, wq)); col = mix(col, dirt * (0.8 + 0.4 * n2.g), smoothstep(0.62, 0.74, wq));
    }
  }
  if (dL < 0.06) {
    // beds: soil and old litter between a path and its lawn, and inside the outer fence; sand in a dog run
    vec3 dirt = textureGrad(tDirt, m / 2.3, gx / 2.3, gy / 2.3).rgb / uMeanD * uDirt;
    vec3 bed = dirt * mix(0.55, 0.95, n1.g) * mix(vec3(1.0), vec3(0.9, 0.82, 0.7), n2.g);
    if (K.a > 0.02) bed = mix(bed, dirt * vec3(3.3, 3.6, 3.9) * (0.85 + 0.3 * n1.r), smoothstep(0.4, 0.6, K.a));
    col = dL > -0.12 ? mix(bed, col, smoothstep(-0.05 + 0.08 * (n2.b - 0.5), 0.05, dL)) : bed;
  }
  float pm = smoothstep(-0.03, 0.03, dP);
  gRough = 0.92;
  if (dP > -0.6) {
    // paving: hexagonal asphalt blocks, 0.2 m across; and its stone edging as a flat strip under the real one
    float hx = texture2D(tHex, m / vec2(3.2, 3.11769)).r;                        // the block pattern, drawn once at load: 16 x 9 periods of 0.2 m blocks, tone per block, dark joints
    vec3 big = texture2D(tGN, m / 9.0 / 16.0 + 0.17).rgb;
    float grit = textureGrad(tDirt, m / 1.1, gx / 1.1, gy / 1.1).g / uMeanD.g;
    vec3 pav = uPave * hx * 1.75 * (0.72 + 0.56 * big.r) * (0.5 + 0.5 * grit) * mix(vec3(1.0), vec3(1.06, 1.0, 0.92), big.b);
    pav = mix(pav, pav * vec3(0.62, 0.60, 0.58), smoothstep(0.55, 0.8, big.g * 0.6 + n1.b * 0.4));                  // old stains and damp
    pav = mix(pav, uDirt * grit * 0.9, (1.0 - smoothstep(0.0, 0.28 + 0.3 * n1.g, dP)) * (0.35 + 0.65 * smoothstep(0.3, 0.75, n1.b * 0.5 + n2.b * 0.5)) * 0.85);      // soil washed onto the path's edge
    float kb = smoothstep(-0.21, -0.18, dP) * (1.0 - pm) * (1.0 - smoothstep(0.4, 0.6, K.a));
    col = mix(col, uKerb * (0.7 + 0.5 * n1.g) * (0.9 + 0.2 * n2.g), kb);
    col = mix(col, pav, pm); gRough = mix(0.92, 0.84, pm);
  }
  // fallen leaves: thick on the beds, a few on the lawn and the path edges
  {
    float lw = smoothstep(0.35, 0.75, texture2D(tGN, m / 5.0 / 16.0 + 0.43).g) ;
    float drift = 1.0 - smoothstep(0.0, 0.55, abs(dP + 0.15));                   // against the edging and under the fence
    float where = max(mix(mix(0.9, mix(0.16, 0.30, uNX) + 0.75 * smoothstep(0.05, 0.4, K.g), smoothstep(-0.05, 0.3, dL)), 0.16 + 0.5 * (1.0 - smoothstep(0.0, 0.8, dP)), pm), drift);
    float lf = 1.0 - smoothstep(14.0, 32.0, dist);
    #ifdef GCHEAP
    lf *= step(1.0 - where * (0.4 + 0.6 * lw), n1.b * 0.5 + n2.g * 0.5 + 0.1) + step(0.5, max(where * lw, drift * (0.3 + lw))) + step(0.5, where) * uNX;          // read the leaf picture only where a leaf can show
    #endif
    if (lf * where > 0.05) {
      vec4 l1 = textureGrad(tLitter, m / 3.0, gx / 3.0, gy / 3.0);
      vec3 c1 = mix(vec3(dot(l1.rgb, vec3(0.4, 0.45, 0.15))) * vec3(1.0, 0.82, 0.6), l1.rgb, 0.45) * uLeaf * (0.6 + 0.8 * n2.b);
      col = mix(col, c1, l1.a * step(1.0 - where * (0.4 + 0.6 * lw), n1.b * 0.5 + n2.g * 0.5 + 0.1) * lf);
      #ifndef GCHEAP
      if (max(where * lw, drift * (0.3 + lw)) > 0.5) { vec4 l2 = textureGrad(tLitter, vec2(-m.y, m.x) / 2.3 + 0.41, vec2(-gx.y, gx.x) / 2.3, vec2(-gy.y, gy.x) / 2.3);
        col = mix(col, mix(vec3(dot(l2.rgb, vec3(0.4, 0.45, 0.15))) * vec3(1.0, 0.82, 0.6), l2.rgb, 0.45) * uLeaf * (0.5 + 0.8 * n2.r), l2.a * lf);
}
      #endif
      if (uNX > 0.5 && where > 0.5) { vec4 l3 = texture2D(tLitter, vec2(m.x * 0.5 - m.y * 0.866, m.x * 0.866 + m.y * 0.5) / 1.7 + 0.23);          // a third, denser layer where leaves gather: under trees, on beds, against the edging
        col = mix(col, mix(vec3(dot(l3.rgb, vec3(0.4, 0.45, 0.15))) * vec3(1.0, 0.80, 0.55), l3.rgb, 0.5) * uLeaf * (0.55 + 0.7 * n1.r), l3.a * lf * smoothstep(0.5, 0.75, where)); }
    }
  }
  // the lawn fence's shadow: the wire dims the sun a little on a strip beside it
  float fsh = 1.0;
  #ifndef GCHEAP
  if (abs(dP + 0.27) < 1.3) {
    vec2 sd = normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-5) * min(2.0, length(uSunDir.xz) / max(0.2, uSunDir.y));          // a 1 m fence throws this far, towards the sun from here
    float dQ = (texture2D(tMask, (m + sd - uRect.xy) / uRect.zw).b - 0.5) * ${MASK_D.toFixed(1)};
    fsh = 1.0 - 0.30 * step((dP + 0.27) * (dQ + 0.27), 0.0) * uFence;
  }
  {
    float nfade = (1.0 - smoothstep(4.0, 26.0, dist)) * (1.0 - pm) * smoothstep(-0.05, 0.1, dL);
    #if defined(GPOM) || defined(GOBL) || defined(GNONRM)
    nfade = 0.0;
    #endif
    if (nfade > 0.01) { gNrm = textureGrad(tLawnAN, m / 1.9, gx / 1.9, gy / 1.9).xyz * 2.0 - 1.0; gNs = 1.1 * nfade; }
  }
  #endif
  diffuseColor.rgb = col; gSpec = mix(0.3, 0.3 * pm, uNX); gSun = fsh * pomSun;          // next look: no sky sheen on turf and soil (it washed the lawn pale and minty at eye height), only on paving
`;

function groundMaterial(shared, U, cheap, pom, obl) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }); if (cheap) m.defines = { ...(m.defines || {}), ...(cheap === 2 ? { GEXACT: 1 } : { GCHEAP: 1 }) }; if (pom) m.defines = { ...(m.defines || {}), GPOM: 1 }; if (obl) m.defines = { ...(m.defines || {}), GOBL: 1 };
  if (U.noNrm) m.defines = { ...(m.defines || {}), GNONRM: 1 };          // ?gnn=0: no relief from the scan's normal map (cost tests)
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
        uniform sampler2D tLawnA; uniform sampler2D tLawnAN; uniform sampler2D tLawnB; uniform sampler2D tWorn; uniform sampler2D tDirt;
        uniform vec3 uMeanA; uniform vec3 uMeanB; uniform vec3 uMeanW; uniform vec3 uMeanD; uniform vec3 uWorn; uniform vec3 uDirt; uniform vec3 uPave; uniform vec3 uKerb; uniform vec3 uLeaf; uniform float uUnder; uniform vec2 uNear; uniform vec3 uEyeK; uniform float uFence; uniform sampler2D tLitter; uniform sampler2D tHex; uniform sampler2D tSw; uniform sampler2D tSwH; uniform highp sampler2D tSwM; uniform vec3 uPomK2; uniform vec4 uPom; uniform vec3 uPomK;
        vec3 bakeV; vec3 bakeN; float gRough; float gSpec; vec3 gNrm; float gNs; float gSun;
        ${LAWN_GLSL}
        #ifdef GOBL
        uniform sampler2D tOb; uniform vec3 uMeanO; uniform vec4 uSwG; uniform vec4 uOb; uniform vec4 uOb2; uniform vec3 uObE; uniform vec4 uObA;
        // one tap of the oblique photograph: level k is laid out for a view 30 / 2^k degrees above the ground (stretched 2^k along the view), sector s
        // of N0 * 2^k fixes the direction the strip was "photographed" from; every tap is fixed in the world, only the weights follow the camera
        vec3 obTap(vec2 m, vec2 gx, vec2 gy, float k, float s) {
          float N = uOb2.z * exp2(k), th = s * 6.2831853 / N; vec2 d = vec2(cos(th), sin(th)), r = vec2(d.y, -d.x);
          float U = uOb.x * exp2(uOb.y * k), V = U * 0.3828 * exp2(k), sm = mod(s, N), flip = mod(sm, 2.0) < 0.5 ? 1.0 : -1.0;          // every other sector mirrored: the blades' lean is not one way everywhere
          vec2 o = fract(sin(vec2(sm * 12.9898 + k * 78.233, sm * 39.346 + k * 11.135)) * 43758.5453);
          float b = exp2(uOb.z);
          return textureGrad(tOb, vec2(flip * dot(m, r) / U, dot(m, d) / V) + o, vec2(flip * dot(gx, r) / U, dot(gx, d) / V) * b, vec2(flip * dot(gy, r) / U, dot(gy, d) / V) * b).rgb;
        }
        vec3 oblique(vec2 m, vec2 gx, vec2 gy, vec3 Vw) {
          float se = clamp(-Vw.y, 0.01, 1.0), az = atan(-Vw.z, Vw.x);
          float kf = clamp(log2(0.5 / se), 0.0, 3.0), k0 = floor(kf), fk = kf - k0;
          vec3 acc = vec3(0.0); float ws = 0.0, ml = dot(uMeanO, vec3(0.3, 0.55, 0.15));
          for (int i = 0; i < 2; i++) {
            float k = k0 + float(i), wl = i == 0 ? 1.0 - fk : fk; if (wl < 0.004) continue;
            float a = az / 6.2831853 * uOb2.z * exp2(k), s0 = floor(a), f = smoothstep(0.2, 0.8, a - s0), wa = wl * (1.0 - f), wb = wl * f;
            if (wa > 0.002) { vec3 t = obTap(m, gx, gy, k, s0); float w = pow(wa * (0.35 + dot(t, vec3(0.3, 0.55, 0.15)) / ml), uOb2.w); acc += t * w; ws += w; }
            if (wb > 0.002) { vec3 t = obTap(m, gx, gy, k, s0 + 1.0); float w = pow(wb * (0.35 + dot(t, vec3(0.3, 0.55, 0.15)) / ml), uOb2.w); acc += t * w; ws += w; }
          }
          return acc / max(ws, 1e-9) / uMeanO;          // where taps meet, the one with the brighter blade wins: blades stay whole, no cross-faded smear
        }
        #endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 m = vec2(vWPos.x, -vWPos.z);
          bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);
          gRough = 0.92; gSpec = 1.0; gNrm = vec3(0.0, 0.0, 1.0); gNs = 0.0; gSun = 1.0;
          float px = max(length(dFdx(m)), length(dFdy(m))) + 1e-5;
          ${FS_PARK}
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gNs > 0.0) { vec3 nw = normalize(vec3(gNrm.x * gNs, gNrm.z, -gNrm.y * gNs)); normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = clamp(gRough, 0.08, 1.0);')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + '\n reflectedLight.directSpecular *= gSpec * gSun; reflectedLight.indirectSpecular *= gSpec; reflectedLight.directDiffuse *= gSun;');
  };
  m.customProgramCacheKey = () => 'stgrass-ground-27' + (cheap ? 'c' + cheap : '') + (pom ? 'p' : '') + (obl ? 'o' : '') + (m.defines && m.defines.GNONRM ? 'n' : '');
  return m;
}

// ------------------------------------------------------------------ blades: lit per vertex (sun, one shadow lookup per blade, sky light, the bake), so a pixel costs next to nothing
function bladeMaterial(shared, U, world) {
  const env = world.scene.environment, eh = env && env.image && env.image.height ? env.image.height : 256, maxMip = Math.log2(eh) - 2;
  // depthWrite off (and drawn last among the opaque things): the game's depth AO would otherwise darken every blade into pepper; blades still hide behind trunks, posts and cars
  const m = new THREE.ShaderMaterial({ lights: true, fog: true, side: THREE.DoubleSide, depthWrite: !(U.noDepth), uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]),
    vertexShader: /* glsl */`
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      #define ENVMAP_TYPE_CUBE_UV
      #define CUBEUV_TEXEL_WIDTH ${(1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))).toFixed(8)}
      #define CUBEUV_TEXEL_HEIGHT ${(1 / eh).toFixed(8)}
      #define CUBEUV_MAX_MIP ${maxMip.toFixed(1)}
      #include <cube_uv_reflection_fragment>
      attribute vec4 aO; attribute vec2 aV;
      uniform vec4 uPatch; uniform vec2 uFadeC; uniform vec4 uBlade; uniform float uTime; uniform float uGroundY; uniform vec4 uShade; uniform float uPxK; uniform float uPomB;
      uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
      uniform sampler2D uEnv; uniform float uEnvI; uniform vec3 uSky;
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ]; uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
      #endif
      varying vec3 vCol;
      ${LAWN_GLSL}
      struct GRL { vec3 directDiffuse; vec3 directSpecular; vec3 indirectDiffuse; vec3 indirectSpecular; };
      struct GMT { vec3 diffuseColor; };
      void main() {
        float S = uPatch.z;
        vec2 rel = (fract(aO.xy - uPatch.xy / S) - 0.5) * S;
        vec2 root = uPatch.xy + rel;                                   // world x, z: fixed in the world, wrapped round the patch centre
        vec2 m = vec2(root.x, -root.y);
        vec2 tdir = vec2(1.0, 0.0), th = vec2(0.5);
        if (uNX > 0.5) {          // tufts: each blade is pulled toward the centre of its 12 cm cell and splays away from it; a tuft has one height and one tone
          vec2 cell = floor(m / 0.12); th = fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
          vec2 ctr = (cell + 0.25 + 0.5 * th) * 0.12, off = m - ctr; tdir = normalize(vec2(off.x, -off.y) + 1e-5);
          m = ctr + off * 0.42; root = vec2(m.x, -m.y);
        }
        vec4 K = lawnMask(m); float dL = (K.r - 0.5) * ${MASK_D.toFixed(1)}, wear = K.g;
        float r1 = fract(aO.z * 7.31 + aO.w * 3.17), r2 = fract(aO.z * 3.71 + aO.w * 9.13);
        float dc = length(vec3(root.x, uGroundY, root.y) - cameraPosition);
        float keep = 1.0 - smoothstep(0.30, 0.80, length(root - uFadeC) / (0.5 * S));
        float kill = step(keep, aO.z) + step(dL, 0.02 + 0.12 * aO.w) + step(1.0 - wear * 1.25, r2);
        float clover, fa; vec3 fieldTint = lawnField(m, clover, fa);
        fieldTint = mix(fieldTint, mix(vec3(1.0), mix(vec3(dot(fieldTint, vec3(0.3, 0.5, 0.2))), fieldTint, 0.6), 0.5), uPomB);          // over the walked sward: its calmer tint
        vec3 clump = gn(m / 0.33 + 5.5);                                  // tufts: height and tone drift together over a hand's width
        float tuft = smoothstep(0.62, 0.85, clump.r);
        float H = uBlade.x * (0.6 + 0.8 * aO.w) * (0.70 + 0.45 * clump.r + 0.55 * tuft) * (1.0 - 0.35 * clover) * (1.0 - 0.5 * wear) * (0.65 + 0.35 * smoothstep(0.0, 0.5, dL)) * (1.0 + 0.9 * (1.0 - smoothstep(0.08, 0.45, dL)) * step(0.35, clump.b));
        H *= mix(1.0, 0.62 + 0.76 * th.x, uNX) * mix(1.0, 1.0 - 0.6 * smoothstep(0.35, 0.80, length(root - uFadeC) / (0.5 * S)), uPomB);          // over the walked sward the stragglers shorten to nothing toward the ring's edge
        float ang = aO.z * 81.68;                                         // blades lean with their neighbours (mower, wind, feet), not each its own way
        vec2 dir = normalize(mix(vec2(cos(ang), sin(ang)), vec2(cos(fa), sin(fa)), mix(0.62, 0.05, uNX)));
        dir = normalize(mix(dir, tdir, 0.55 * uNX));
        vec2 toC = normalize(cameraPosition.xz - root + 1e-4), camSide = vec2(-toC.y, toC.x);
        vec2 side = vec2(-dir.y, dir.x); side = normalize(mix(side, camSide * (dot(side, camSide) < 0.0 ? -1.0 : 1.0), 0.6));
        float t = aV.y;
        float lean = mix(0.25, 0.22, uNX) + mix(0.80, 0.75, uNX) * r1 + uNX * 0.55 * step(0.72, r2);          // next look: mown blades stand, they do not curl over like commas
        float gust = sin(uTime * 1.3 + root.x * 0.35 + root.y * 0.27) * 0.5 + sin(uTime * 2.9 + root.x * 1.7 - root.y * 1.3 + aO.w * 6.0) * 0.5;
        vec2 bend = dir * lean * H + vec2(0.8, 0.6) * gust * uBlade.w * H;
        float halfW = max(uBlade.y * (0.6 + 0.8 * r2), uPxK * dc);       // never thinner than about a pixel and a half: no shimmer
        vec3 pos = vec3(root.x, uGroundY, root.y);
        pos.xz += bend * t * t + side * aV.x * halfW;
        pos.y += H * t * (1.0 - 0.35 * t * lean);
        vec3 N = normalize(vec3(dir.x * 0.45, 1.0, dir.y * 0.45) + vec3(bend.x, 0.0, bend.y) * (t * 0.6 / max(H, 1e-3)));
        float nearV = 1.0 - smoothstep(3.0, 16.0, dc);                      // blade-to-blade differences fade with distance: far grass is tone, not speckle
        vec3 albedo = uLawn * fieldTint * mix(vec3(1.0), mix(vec3(0.80, 0.88, 0.80), vec3(1.20, 1.13, 1.04), r1) * mix(vec3(1.0), vec3(1.45, 1.22, 0.78), step(mix(0.93, 0.95, uNX), r2) * 0.8), 0.35 + 0.65 * nearV)
          * mix(1.0, 0.80 + 0.40 * th.y, uNX) * (0.86 + mix(0.28, 0.50, uNX) * clump.g - 0.08 * tuft) * mix(vec3(1.0), mix(vec3(0.92, 1.0, 0.96), vec3(1.12, 1.06, 0.82), clump.b), uNX) * mix(vec3(1.0), vec3(0.80, 0.93, 0.85), clover * 0.7) * mix(mix(1.0, uShade.x, 0.4 + 0.6 * nearV), uShade.y, t);
        // light
        vec3 vWPos = pos; vec3 bakeN = vec3(0.0, 1.0, 0.0);
        vec3 bakeV = texture2D(tLight, vec2(pos.x / (2.0 * uHalf.x) + 0.5, -pos.z / (2.0 * uHalf.y) + 0.5)).rgb;
        float sh = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        { vec4 sc = directionalShadowMatrix[ 0 ] * vec4(root.x, uGroundY + 0.05, root.y, 1.0); sc.xyz /= sc.w;
          if (sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) { float a = aO.w * 6.2831853; vec2 o = vec2(cos(a), sin(a)) * 0.0005 * (0.3 + aO.z);
            sh = step(sc.z - 0.0004, unpackRGBAToDepth(texture2D(directionalShadowMap[ 0 ], sc.xy + o))); } }
        #endif
        GRL reflectedLight; GMT material; material.diffuseColor = albedo;
        reflectedLight.directDiffuse = albedo * uSunColor * clamp(dot(N, uSunDir), 0.0, 1.0) * sh;
        #ifdef SKY_UNIFORM
        reflectedLight.indirectDiffuse = albedo * uSky * uEnvI;
        #else
        reflectedLight.indirectDiffuse = albedo * textureCubeUV(uEnv, vec3(0.0, 1.0, 0.0), 1.0).rgb * uEnvI;
        #endif
        reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
        ${BAKE_LIGHT_GLSL}
        float ao = mix(uShade.z, 1.0, smoothstep(0.0, 0.75, t));
        float back = pow(clamp(dot(normalize(pos - cameraPosition), uSunDir), 0.0, 1.0), 3.0);
        vCol = reflectedLight.indirectDiffuse * ao + reflectedLight.directDiffuse * mix(0.55, 1.0, t) * (1.0 + uShade.w * back * t);
        vec4 mvPosition = viewMatrix * vec4(pos, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        if (kill > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      varying vec3 vCol;
      void main() {
        gl_FragColor = vec4(vCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  if (U.uSky && U.uSky.ok) m.defines = { SKY_UNIFORM: 1 };
  Object.assign(m.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uSunDir: shared.uSunDir, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, uTime: shared.uTime }, U);
  return m;
}

// ------------------------------------------------------------------ tuft cards (?gcard=1): upright cards that turn most of the way to the camera, each showing a length of
// the sward atlas (scanned blades and tufts planted side by side: pipeline/grass/prep_sward.py). Four vertices a card instead of five a blade and thirty times
// fewer of them; lit per vertex like the blades; blended, no depth written (the depth AO must not see them), cells drawn far to near.
function cardMaterial(shared, U, world) {
  const m = new THREE.ShaderMaterial({ lights: true, fog: true, side: THREE.DoubleSide, transparent: true, depthWrite: false, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]),
    vertexShader: /* glsl */`
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      attribute vec4 aO; attribute vec2 aV;
      uniform vec4 uPatch; uniform vec2 uFadeC; uniform vec4 uBlade; uniform float uTime; uniform float uGroundY; uniform vec4 uShade; uniform vec4 uCard;
      uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
      uniform float uEnvI; uniform vec3 uSky;
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ]; uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
      #endif
      varying vec3 vCol; varying vec2 vUv; varying float vA;
      ${LAWN_GLSL}
      struct GRL { vec3 directDiffuse; vec3 directSpecular; vec3 indirectDiffuse; vec3 indirectSpecular; };
      struct GMT { vec3 diffuseColor; };
      void main() {
        float S = uPatch.z;
        vec2 rel = (fract(aO.xy - uPatch.xy / S) - 0.5) * S;
        vec2 root = uPatch.xy + rel;                                   // world x, z: fixed in the world, wrapped round the patch centre
        vec2 m = vec2(root.x, -root.y);
        vec4 K = lawnMask(m); float dL = (K.r - 0.5) * ${MASK_D.toFixed(1)}, wear = K.g;
        float r1 = aO.z, r2 = aO.w, r3 = fract(r1 * 7.31 + r2 * 3.17), r4 = fract(r1 * 3.71 + r2 * 9.13);
        vA = 1.0 - smoothstep(0.55, 0.80, length(root - uFadeC) / (0.5 * S));
        { float a0 = aO.z * 6.2831853; vec2 d0 = vec2(cos(a0), sin(a0)), v0 = normalize(cameraPosition.xz - root + 1e-4); vA *= mix(1.0, smoothstep(0.10, 0.45, abs(d0.x * v0.y - d0.y * v0.x)), uNX); }
        float kill = step(vA, 0.004) + step(dL, 0.03 + 0.10 * r3) + step(1.0 - wear * 1.15, r4);
        float clover, fa; vec3 fieldTint = lawnField(m, clover, fa);
        vec3 clump = gn(m / 0.9 + 5.5);
        float fringe = (1.0 - smoothstep(0.08, 0.45, dL)) * step(0.35, clump.b);                         // the unmown strip a mower leaves along an edge
        float H = uBlade.x * (0.72 + 0.5 * r3) * (0.78 + 0.44 * clump.r) * (1.0 - 0.3 * clover) * (1.0 - 0.45 * wear) * (0.7 + 0.3 * smoothstep(0.0, 0.5, dL)) * (1.0 + 0.9 * fringe);
        float strip = fringe > 0.5 ? 3.0 : (wear + 0.25 * (r3 - 0.5) > 0.30 ? 2.0 : step(0.5, r1));
        float ang = r1 * 6.2831853; vec2 dir = vec2(cos(ang), sin(ang));
        vec2 toC = normalize(cameraPosition.xz - root + 1e-4), camSide = vec2(-toC.y, toC.x);
        vec2 side = normalize(mix(dir, camSide * (dot(dir, camSide) < 0.0 ? -1.0 : 1.0), uCard.x));
        float t = aV.y, halfW = uBlade.y * (0.8 + 0.4 * r4);
        float gust = sin(uTime * 1.3 + root.x * 0.35 + root.y * 0.27) * 0.5 + sin(uTime * 2.9 + root.x * 1.7 - root.y * 1.3 + r2 * 6.0) * 0.5;
        vec2 lean = vec2(-side.y, side.x) * (r3 - 0.5) * 0.9 * H + vec2(cos(fa), sin(fa)) * 0.22 * H + vec2(0.8, 0.6) * gust * uBlade.w * H;
        vec3 pos = vec3(root.x, uGroundY - 0.004, root.y);
        pos.xz += side * aV.x * halfW + lean * t; pos.y += H * t;
        vUv = vec2(r2 * 7.0 + (aV.x * 0.5 + 0.5) * (2.0 * halfW / uCard.y), 1.0 - (strip + 1.0 - 0.012 - t * 0.976) * 0.25);
        float dc = length(pos - cameraPosition), nearV = 1.0 - smoothstep(3.0, 16.0, dc);
        vec3 albedo = uLawn * fieldTint * (0.90 + 0.22 * clump.g) * mix(1.0, 0.82 + 0.36 * r4, 0.4 + 0.6 * nearV) * mix(vec3(1.0), vec3(0.80, 0.93, 0.85), clover * 0.7) * mix(uShade.x * 0.4 + 0.56, uShade.y * 0.4 + 0.62, t);
        // light
        vec3 vWPos = pos; vec3 bakeN = vec3(0.0, 1.0, 0.0);
        vec3 bakeV = texture2D(tLight, vec2(pos.x / (2.0 * uHalf.x) + 0.5, -pos.z / (2.0 * uHalf.y) + 0.5)).rgb;
        float sh = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        { vec4 sc = directionalShadowMatrix[ 0 ] * vec4(pos.x, uGroundY + 0.05, pos.z, 1.0); sc.xyz /= sc.w;
          if (sc.x > 0.002 && sc.x < 0.998 && sc.y > 0.002 && sc.y < 0.998 && sc.z < 1.0) sh = step(sc.z - 0.0004, unpackRGBAToDepth(texture2D(directionalShadowMap[ 0 ], sc.xy))); }
        #endif
        vec3 N = normalize(vec3(lean.x, H * 2.2, lean.y));
        GRL reflectedLight; GMT material; material.diffuseColor = albedo;
        reflectedLight.directDiffuse = albedo * uSunColor * clamp(dot(N, uSunDir), 0.0, 1.0) * sh;
        reflectedLight.indirectDiffuse = albedo * uSky * uEnvI;
        reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);
        ${BAKE_LIGHT_GLSL}
        float back = pow(clamp(dot(normalize(pos - cameraPosition), uSunDir), 0.0, 1.0), 3.0);
        vCol = (reflectedLight.indirectDiffuse * mix(uShade.z, 1.0, t) + reflectedLight.directDiffuse * (1.0 + uShade.w * back * t)) * uCard.z;
        vec4 mvPosition = viewMatrix * vec4(pos, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        if (kill > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D tSward; uniform vec3 uSwardK; uniform vec4 uCard;
      varying vec3 vCol; varying vec2 vUv; varying float vA;
      void main() {
        vec4 s = texture2D(tSward, vUv, uCard.w);
        float a = s.a * vA; if (a < 0.02) discard;
        gl_FragColor = vec4(vCol * s.rgb * uSwardK, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  Object.assign(m.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uSunDir: shared.uSunDir, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, uTime: shared.uTime }, U);
  return m;
}

// the sky's light on an upward face, read back once from the environment map (so 400k blade vertices do not each look it up); null if it cannot be read
function skyUp(renderer, env) {
  try {
    const eh = env.image.height, maxMip = Math.log2(eh) - 2, rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({ uniforms: { uEnv: { value: env } }, depthTest: false, depthWrite: false, vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: ['#include <common>', '#define ENVMAP_TYPE_CUBE_UV', '#define CUBEUV_TEXEL_WIDTH ' + (1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))).toFixed(8), '#define CUBEUV_TEXEL_HEIGHT ' + (1 / eh).toFixed(8), '#define CUBEUV_MAX_MIP ' + maxMip.toFixed(1),
        '#include <cube_uv_reflection_fragment>', 'uniform sampler2D uEnv;', 'void main() { gl_FragColor = vec4(textureCubeUV(uEnv, vec3(0.0, 1.0, 0.0), 1.0).rgb, 1.0); }'].join('\n') });
    const sc = new THREE.Scene(), q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; sc.add(q);
    const prev = renderer.getRenderTarget(), buf = new Float32Array(4); renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf); renderer.setRenderTarget(prev);
    rt.dispose(); mat.dispose(); q.geometry.dispose();
    return Number.isFinite(buf[0] + buf[1] + buf[2]) && buf[0] + buf[1] + buf[2] > 1e-4 && buf[0] + buf[1] + buf[2] < 300 ? new THREE.Vector3(buf[0], buf[1], buf[2]) : null;
  } catch (e) { return null; }
}

// one instanced geometry per cell of the ring's tile (G x G cells), so the cells outside the view are not drawn at all
function bladeCells(n, seed, tri, G, card) {
  const nv = card ? 4 : tri ? 3 : 5, pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);                   // all zero: any other material (a depth or normal pass) draws nothing
  const aV = new THREE.BufferAttribute(new Float32Array(card ? [-1, 0, 1, 0, 1, 1, -1, 1] : tri ? [-1, 0, 1, 0, 0, 1] : [-1, 0, 1, 0, -0.72, 0.45, 0.72, 0.45, 0, 1]), 2), index = card ? [0, 1, 2, 0, 2, 3] : tri ? [0, 1, 2] : [0, 1, 2, 1, 3, 2, 2, 3, 4];
  const R = rng(seed), per = Math.max(1, Math.round(n / (G * G))), out = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', pos); g.setAttribute('aV', aV); g.setIndex(index);
    const a = new Float32Array(per * 4); for (let k = 0; k < per; k++) { a[k * 4] = (i + R()) / G; a[k * 4 + 1] = (j + R()) / G; a[k * 4 + 2] = R(); a[k * 4 + 3] = R(); }
    g.setAttribute('aO', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = per; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    out.push({ geo: g, u: (i + 0.5) / G, v: (j + 0.5) / G, n: per });
  }
  return out;
}

// ------------------------------------------------------------------ the part
export async function add(game, ctx) {
  if (!ctx.gNext && game.P && game.P.get('gx') === '1') { ctx.gNext = 1; return (await import('./grass_next.js')).add(game, ctx); }          // ?gx=1: the round's trial copy, so this file is never half-edited while a laptop hold reads it
  const Q = game.P, sw = Q ? Q.get('grass') : null;
  if (sw === '0' || (!DEFAULT_ON && !sw)) return { report: { off: 1 } };
  const world = game.world, city = game.city || ctx.city, shared = world.shared, A = ctx.A + 'grass/';
  const group = new THREE.Group(); group.name = 'streets_grass';
  const AN = Q && Q.has('gan') ? +Q.get('gan') : 8;          // ?gan=N: anisotropy of the lawn scans (cost tests)
  const L = new THREE.TextureLoader(), maxAniso = world.renderer.capabilities.getMaxAnisotropy();
  const load = (f, srgb) => new Promise((res, rej) => L.load(A + f, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(AN, maxAniso); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t); }, undefined, () => rej(new Error('grass texture ' + f))));
  const [tLawnA, tLawnAN, tLawnB, tWorn, tDirt, tLitter, lay, means] = await Promise.all([load('lawn_a.webp', true), load('lawn_a_n.webp', false), load('lawn_b.webp', true), load('worn.webp', true), load('dirt.webp', true), load('litter.webp', true),
    fetch(A + 'parks.json').then((r) => r.json()), fetch(A + 'means.json').then((r) => r.json())]);
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const cardsOn = !!(Q && Q.get('gcard') === '1') && !!means['sward.webp'];
  const tSward = cardsOn ? await load('sward.webp', true) : null; if (tSward) tSward.wrapT = THREE.ClampToEdgeWrapping;
  const num = (k, d) => (Q && Q.has(k) ? +Q.get(k) : d), vec = (k, d) => (Q && Q.has(k) ? V3(Q.get(k).split(',').map(Number)) : V3(d));

  // the lead's grass meshes: read their height, then hide them
  let gy = 0.18; const hidden = [];
  world.cityRoot.updateMatrixWorld(true);
  world.cityRoot.traverse((o) => { if (o.isMesh && /^grass(_\d+)?$/.test(o.name)) { const p = o.geometry.attributes.position; if (p && p.count) gy = new THREE.Vector3().fromBufferAttribute(p, 0).applyMatrix4(o.matrixWorld).y; o.visible = false; hidden.push(o.name); } });

  const OBL = sw === '3d' && !(Q && Q.get('gob') === '0');          // ?grass=3d (trial, r25): the photographed sward (&gob=0: the walked sward of r24)
  const POM = (sw === '3d' && !OBL) || !!(Q && Q.get('gpom') === '1');          // ?grass=3d: the flat form with the walked sward (no blade meshes)
  const NX = !!(Q && Q.get('gnext') === '1') || POM || OBL || (!sw && DEFAULT_ON); NXG = NX;          // the round's untried look: judged behind this switch, then promoted
  const GN = noiseTexture(), tGN = GN.tex;
  const common = { tGN: { value: tGN }, uNX: { value: NX ? 1 : 0 }, uLawn: { value: vec('glawn', (POM || OBL) ? [0.031, 0.042, 0.0165] : NX ? [0.036, 0.045, 0.0150] : [0.031, 0.044, 0.014]) } };
  // the sward tile (items/grass/tools/mksward.mjs): tone as it is, height as a one-channel texture (the walk reads only this one)
  const swT0 = performance.now(); let tSw = null, tSwH = null, tSwM = null;
  if (POM) { tSw = await load('sward4_c.webp', false); const hi = (await load('sward4_h.webp', false)).image, c = document.createElement('canvas'); c.width = hi.width; c.height = hi.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(hi, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data, r = new Uint8Array(c.width * c.height); for (let i = 0; i < r.length; i++) r[i] = px[i * 4];
    tSwH = new THREE.DataTexture(r, c.width, c.height, THREE.RedFormat, THREE.UnsignedByteType); tSwH.wrapS = tSwH.wrapT = THREE.RepeatWrapping; tSwH.minFilter = THREE.LinearMipmapLinearFilter; tSwH.magFilter = THREE.LinearFilter; tSwH.generateMipmaps = true; tSwH.colorSpace = THREE.NoColorSpace; tSwH.needsUpdate = true;
    const mips = [{ data: r, width: c.width, height: c.height }]; for (let w = c.width >> 1, pw = c.width, pv = r; w >= 1; pw = w, w >>= 1) { const q = new Uint8Array(w * w); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const i = (2 * y) * pw + 2 * x; q[y * w + x] = Math.max(pv[i], pv[i + 1], pv[i + pw], pv[i + pw + 1]); } mips.push({ data: q, width: w, height: w }); pv = q; }
    tSwM = new THREE.DataTexture(r, c.width, c.height, THREE.RedFormat, THREE.UnsignedByteType); tSwM.mipmaps = mips; tSwM.generateMipmaps = false; tSwM.wrapS = tSwM.wrapT = THREE.RepeatWrapping; tSwM.minFilter = THREE.NearestMipmapNearestFilter; tSwM.magFilter = THREE.NearestFilter; tSwM.colorSpace = THREE.NoColorSpace; tSwM.needsUpdate = true; }
  const swMs = Math.round(performance.now() - swT0);
  const tOb = OBL ? await load('oblique_b.webp', true) : null; if (tOb) tOb.anisotropy = Math.min(Q && Q.has('goan') ? +Q.get('goan') : 2, maxAniso);          // laid out so its footprint on screen is near square: little anisotropy needed
  const gU = { tLawnA: { value: tLawnA }, tLawnAN: { value: tLawnAN }, tLawnB: { value: tLawnB }, tWorn: { value: tWorn }, tDirt: { value: tDirt },
    uMeanA: { value: V3(means['lawn_a.webp']) }, uMeanB: { value: V3(means['lawn_b.webp']) }, uMeanW: { value: V3(means['worn.webp']) }, uMeanD: { value: V3(means['dirt.webp']) },
    uWorn: { value: vec('gworn', NX ? [0.030, 0.031, 0.017] : [0.055, 0.058, 0.030]) }, uDirt: { value: vec('gdirt', NX ? [0.036, 0.029, 0.020] : [0.048, 0.039, 0.027]) }, uPave: { value: vec('gpave', NX ? [0.055, 0.054, 0.055] : [0.075, 0.075, 0.078]) }, uKerb: { value: vec('gkerb', NX ? [0.05, 0.048, 0.043] : [0.085, 0.083, 0.078]) }, uLeaf: { value: vec('gleaf', [0.36, 0.34, 0.32]) }, uFence: { value: (Q && Q.get('gfence') === '0') ? 0 : 1 }, tHex: { value: hexTexture(maxAniso) }, tLitter: { value: tLitter },
    uSwG: { value: new THREE.Vector4(1, 2, 1, 0) }, tOb: { value: tOb }, uMeanO: { value: V3(means['oblique_b.webp'] || [0.2, 0.2, 0.1]) }, uOb: { value: new THREE.Vector4(num('gou', 1.85), num('gog', 0.0), num('gobias', -0.3), num('gok', 1.4)) }, uOb2: { value: new THREE.Vector4(num('got0', 0.55), num('got1', 0.85), num('gon', 12), num('goc', 6.0)) }, uObE: { value: vec('goe', [1.33, 1.35, 1.40]) }, uObA: { value: new THREE.Vector4(...(Q && Q.has('goa') ? Q.get('goa').split(',').map(Number) : [0.70, 0.69, 0.74]), num('gomot', 0.35)) },
    tSw: { value: tSw }, tSwH: { value: tSwH }, tSwM: { value: tSwM }, uPom: { value: new THREE.Vector4(num('gph', 0.065), 1, num('gpd', 55), num('gprun', 1.2)) }, uPomK: { value: new THREE.Vector3(num('gpao', 0.30), num('gpsh', 0.85), num('gpk', 1.4)) }, uPomK2: { value: new THREE.Vector3(num('gplod', 0), num('gpss', 5), num('gpit', 20)) },
    uEyeK: { value: vec('geye', (!sw && DEFAULT_ON) ? [1.36, 1.38, 1.53] : [1, 1, 1]) },
    uUnder: { value: num('gunder', NX ? 0.72 : 0.80) }, uNear: { value: new THREE.Vector2(num('gn0', 3), num('gn1', 22)) } };

  // per park: mask, ground mesh
  const trees = ((city.props && city.props.tree) || []).map((t, i) => { const R = rng(977 + i * 131); return { x: t[0], y: t[1], h: R(), h2: R() }; });
  const hero = (pk) => pk.name === 'Madison Square Park';
  const parks = [], fenceSegs = []; let tris = 0, lawnM2 = 0, fenceM = 0, kerbM = 0; const edgesOn = !(Q && Q.get('gfence') === '0');
  const kerbMat = new THREE.MeshStandardMaterial({ color: NX ? new THREE.Color(0.060, 0.057, 0.050) : new THREE.Color(0.085, 0.083, 0.078), roughness: 0.88, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  const fenceMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.009, 0.0095, 0.01), roughness: 0.36, metalness: 0.45, side: THREE.DoubleSide });
  // the wire: unlit and single pass. As a lit, double-sided, blended material it was drawn twice with full shading over a third of the screen (r3: -11 fps beside a fence)
  const wireMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tWire: { value: null }, uCol: { value: new THREE.Color(0.012, 0.013, 0.014) } }]),
    vertexShader: ['#include <common>', '#include <fog_pars_vertex>', 'varying vec2 vUv;', 'void main() {', '  vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;', '  #include <fog_vertex>', '}'].join('\n'),
    fragmentShader: ['#include <common>', '#include <fog_pars_fragment>', 'uniform sampler2D tWire; uniform vec3 uCol; varying vec2 vUv;', 'void main() {', '  float a = texture2D(tWire, vUv).g; if (a < 0.03) discard;', '  gl_FragColor = vec4(uCol, a);', '  #include <fog_fragment>', '}'].join('\n') });
  wireMat.uniforms.tWire.value = NX ? wireTexture2() : wireTexture();
  (city.parks || []).forEach((pk, i) => {
    if (!pk.ext || pk.ext.length < 3) return;
    const xs = pk.ext.map((p) => p[0]), ys = pk.ext.map((p) => p[1]), bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const mine = trees.filter((t) => t.x > bb[0] && t.x < bb[2] && t.y > bb[1] && t.y < bb[3] && pip(t.x, t.y, pk.ext));
    const mask = parkMask(pk, lay.parks && lay.parks[i], mine, hero(pk), GN.sample);
    const U = { ...common, ...gU, tMask: { value: mask.tex }, uRect: { value: mask.rect } }; if (Q && Q.get('gnn') === '0') Object.defineProperty(U, 'noNrm', { value: true, enumerable: false });
    const contour = pk.ext.map((p) => new THREE.Vector2(p[0], p[1])), holes = (pk.holes || []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse(); for (const h of holes) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes), all = contour.concat(...holes);
    const pos = new Float32Array(all.length * 3), nrm = new Float32Array(all.length * 3); all.forEach((p, k) => { pos[k * 3] = p.x; pos[k * 3 + 1] = gy; pos[k * 3 + 2] = -p.y; nrm[k * 3 + 1] = 1; });
    const idx = []; for (const f of faces) idx.push(f[0], f[1], f[2]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setIndex(idx);
    const mesh = new THREE.Mesh(g, groundMaterial(shared, U, (Q && Q.get('gcheap') === '1') ? 1 : (Q && Q.get('gcheap') === '0') ? 0 : 2, POM, OBL)          /* loop 5: the exact one-read cut is the default (gcheap=0 = both reads everywhere, as before) */); mesh.name = 'park_ground_' + i; mesh.receiveShadow = true; mesh.material.side = THREE.DoubleSide; group.add(mesh);
    tris += faces.length; lawnM2 += mask.lawnM2;
    if (mask.hasPaths && edgesOn) { const E = buildEdges(pk, mask, gy, rng(5000 + i), NX);
      if (E.kerb) { const k = new THREE.Mesh(E.kerb, kerbMat); k.receiveShadow = true; k.name = 'park_kerb_' + i; group.add(k); }
      if (E.fence && !(Q && Q.get('gposts') === '0')) { const f = new THREE.Mesh(E.fence, fenceMat); f.receiveShadow = true; f.name = 'park_fence_' + i; group.add(f); }
      if (E.wire && !(Q && Q.get('gwire') === '0')) { const w = new THREE.Mesh(E.wire, wireMat); w.name = 'park_wire_' + i; w.renderOrder = 4; group.add(w); }
      tris += E.tris; fenceM += E.fenceM; kerbM += E.kerbM; for (const q of E.segs) fenceSegs.push(q); }
    parks.push({ i, bb, mask, mesh });
  });

  // blades: two rings round the camera
  const flat = sw === 'flat' || OBL || (POM && !(Q && Q.get('gblades') === '1')) || !sw; const rings = [];
  if (!flat && parks.length) {
    const sky0 = world.scene.environment ? skyUp(world.renderer, world.scene.environment) : null, uSky = { value: sky0 || new THREE.Vector3(1, 1, 1), ok: !!sky0, env: world.scene.environment };
    if (sky0) setInterval(() => { const e = world.scene.environment; if (e && e !== uSky.env) { const v = skyUp(world.renderer, e); if (v) { uSky.value.copy(v); uSky.env = e; } } }, 4000);
    const frustum = new THREE.Frustum(), pm4 = new THREE.Matrix4(), sph = new THREE.Sphere(), fwd = new THREE.Vector3(), cp = new THREE.Vector3(), sz = new THREE.Vector2();
    const mk = (n, S, H, Wd, sway, ahead, maxY, seed, tri, card) => {
      const G = 6, cell = S / G, U = { ...common, tMask: { value: parks[0].mask.tex }, uRect: { value: parks[0].mask.rect }, uPatch: { value: new THREE.Vector4(0, 0, S, 0) }, uFadeC: { value: new THREE.Vector2() }, uBlade: { value: new THREE.Vector4(H, Wd, 0, sway) }, uGroundY: { value: gy }, uPxK: { value: 0.001 }, uPomB: { value: 0 },
        tSward: { value: tSward }, uSwardK: { value: card ? V3(means['sward.webp']).set(1 / means['sward.webp'][0], 1 / means['sward.webp'][1], 1 / means['sward.webp'][2]) : new THREE.Vector3(1, 1, 1) },
        uCard: { value: new THREE.Vector4(num('gface', NX ? 0.12 : 0.5), 0.36, num('gcgain', 1.0), num('gbias', -0.5)) },
        noDepth: !(Q && Q.get('gdepth') === '1'), uEnv: { value: world.scene.environment }, uEnvI: { value: 1 }, uSky, uShade: { value: new THREE.Vector4(num('gb0', 0.55), num('gb1', 1.22), num('gbao', 0.65), num('gback', 0.25)) } };
      const mat = card ? cardMaterial(shared, U, world) : bladeMaterial(shared, U, world); if (!card && S < 8) mat.transparent = true;          // the small ring of real blades draws after the cards
      const cells = bladeCells(n, seed, tri, G, card), ring = { n, S, U, cells, drawn: 0, stamp: -1, on: false, cx: 0, cz: 0, fx: 0, fz: 0 };
      // once per camera per frame: which park, where the tile sits (snapped to whole cells so no cell straddles the wrap), where the fade is centred
      const frame = (r, s, cam) => {
        const st = r.info.render.frame * 16 + (cam.id % 16); if (ring.stamp === st) return; ring.stamp = st; ring.drawn = 0;
        cp.setFromMatrixPosition(cam.matrixWorld); cam.getWorldDirection(fwd);
        let best = null; const mx = cp.x, my = -cp.z; for (const p of parks) if (mx > p.bb[0] - S && mx < p.bb[2] + S && my > p.bb[1] - S && my < p.bb[3] + S) { best = p; break; }
        const cube = cam.fov === 90 && Math.abs(cam.aspect - 1) < 1e-6;          // a face of the street reflection cube: blades would cost a second pass and never show in it
        ring.on = !ring.mute && !cube && !!best && cp.y - gy <= maxY && !!s.environment; if (!ring.on) return;
        U.tMask.value = best.mask.tex; U.uRect.value = best.mask.rect; U.uEnv.value = s.environment; U.uEnvI.value = s.environmentIntensity === undefined ? 1 : s.environmentIntensity;
        ring.fx = cp.x + fwd.x * S * ahead; ring.fz = cp.z + fwd.z * S * ahead; ring.cx = Math.round(ring.fx / cell) * cell; ring.cz = Math.round(ring.fz / cell) * cell;
        U.uPatch.value.set(ring.cx, ring.cz, S, 0); U.uFadeC.value.set(ring.fx, ring.fz);
        r.getDrawingBufferSize(sz); U.uPxK.value = pxw * Math.tan((cam.fov || 50) * Math.PI / 360) / Math.max(1, sz.y);       // half width = pxw/2 pixels at any distance
        frustum.setFromProjectionMatrix(pm4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      };
      const fr = (x) => x - Math.floor(x);
      for (const c of cells) {
        const mesh = new THREE.Mesh(c.geo, mat); mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'grass_blades_' + S; mesh.renderOrder = S < 8 ? 9 : S < 20 ? 7 : 6;
        mesh.onBeforeRender = (r, s, cam) => {
          frame(r, s, cam); if (!ring.on) { c.geo.instanceCount = 0; return; }
          const x = ring.cx + (fr(c.u - ring.cx / S) - 0.5) * S, z = ring.cz + (fr(c.v - ring.cz / S) - 0.5) * S, rc = cell * 0.7072;
          sph.center.set(x, gy + 0.05, z); sph.radius = rc + 0.15;
          const vis = Math.hypot(x - ring.fx, z - ring.fz) - rc < 0.80 * 0.5 * S && frustum.intersectsSphere(sph);
          c.geo.instanceCount = vis ? c.n : 0; if (vis) ring.drawn++;
          if (card) mesh.position.set(x, gy, z);                 // blended: three.js sorts the cells far to near by this (the shader never reads it)
        };
        group.add(mesh);
      }
      rings.push(ring);
    };
    const pxw = num('gpx', 1.5), dn = num('gn', 1);
    if (POM) {          // over the walked sward: a small ring of real blades standing on its top (the stragglers a mower leaves), same tone as the sward's tips, no dark feet
      mk(Math.round(dn * 30000 * Math.pow(num('gring', 5) / 5, 2)), num('gring', 5), num('gh', 0.05), 0.0028, 0.10, 0.34, 6, 37, false);
      const U = rings[0].U; U.uPomB.value = 1; U.uLawn = { value: common.uLawn.value.clone().multiplyScalar(num('gbk', 1.6)) }; U.uShade.value.set(num('gb0', 0.95), num('gb1', 1.15), num('gbao', 0.92), num('gback', 0.25));
      rings[0].cells.forEach(() => 0); group.traverse((o) => { if (/^grass_blades_/.test(o.name)) { o.material.uniforms.uLawn = U.uLawn; o.material.uniforms.uPomB.value = 1; } });
    } else if (cardsOn && sky0) {
      if (num('gc0', NX ? 0 : 1) > 0) mk(Math.round(dn * num('gc0', 1) * (NX ? 22000 : 16000)), 10.8, num('gh', 0.088), 0.11, 0.10, 0.34, 12, 11, false, true);
      if (num('gc1', NX ? 0 : 1) > 0) mk(Math.round(dn * num('gc1', 1) * (NX ? 13000 : 9000)), 36, num('gh', 0.088), 0.34, 0.08, 0.36, 40, 23, false, true);
      if (num('gnear', 1) > 0) mk(Math.round(dn * num('gnear', 1) * (NX ? 42000 : 46000) * Math.pow(num('gring', NX ? 9 : 6) / 6, 2)), num('gring', NX ? 9 : 6), NX ? num('gh', 0.078) : num('gh', 0.085), NX ? 0.0030 : 0.0026, 0.10, 0.34, 6, 37, false);       // real blades only where they resolve: within about 4 m
      group.traverse((o) => { if (/^park_wire_/.test(o.name)) o.renderOrder = 10; });          // the wire is blended too and stands in front of the grass more often than behind it
    } else {
    mk(Math.round(dn * num('gl0', 1) * 150000), 10.8, num('gh', 0.085), 0.0026, 0.10, 0.34, 12, 11, false);
    mk(Math.round(dn * num('gl1', 1) * 140000), 36, num('gh', 0.085), 0.0080, 0.08, 0.36, 40, 23, true);
    }
  }
  // the mesh sward (loop 5): ?grass=3d&gsw=1
  if (OBL && parks.length && Q && Q.get('gsw') === '1') rings.unshift((await import('./grass_sward.js')).addSward({ world, shared, common, parks, gy, group, num, Q, rng, skyUp, gU, LAWN_GLSL, BAKE_LIGHT_GLSL, MASK_D }));
  world.scene.add(group);
  // compile now and read the link status: a shader that fails would otherwise draw nothing, silently, with the lead's grass already hidden
  { const r = world.renderer, prev = r.debug.onShaderError, errs = [], log = (s) => { const m = /ERROR[^\n]*/.exec(s || ''); return m ? m[0] : ''; };
    r.debug.onShaderError = (gl, prog, vs, fs) => { errs.push((log(gl.getShaderInfoLog(vs)) + ' ' + log(gl.getShaderInfoLog(fs)) + ' ' + (gl.getProgramInfoLog(prog) || '')).trim().slice(0, 140)); };
    try { r.compile(group, world.camera, world.scene); group.traverse((o) => { if (o.isMesh) { const pr = r.properties.get(o.material).currentProgram; if (pr) pr.getUniforms(); } }); } catch (e) { errs.push('compile threw: ' + e.message); }
    r.debug.onShaderError = prev;
    if (errs.length || (Q && Q.has('grassdbg'))) { world.scene.remove(group); world.cityRoot.traverse((o) => { if (o.isMesh && /^grass(_\d+)?$/.test(o.name)) o.visible = true; });
      throw new Error(errs.length ? 'shader: ' + errs[0] : 'dbg y=' + gy.toFixed(3) + ' parks=' + parks.length + ' hid=' + hidden.length + ' m0=' + JSON.stringify(parks[0] && [parks[0].mask.W, parks[0].mask.H, Math.round(parks[0].mask.lawnM2)])); } }
  // ?gbench[=x,eye,y,tx,th,ty]: time the part on this machine's GPU (gl.finish per frame, so vsync and the frame-rate steps play no part), then leave
  // the game as it was and report through the part's failure line: the lead's grass, my ground and edges, plus the near ring, plus the far ring
  if (Q && Q.has('gbench')) {
    const r = world.renderer, gl = r.getContext(), cam = world.camera, sp = cam.position.clone(), sq = cam.quaternion.clone(), c = (Q.get('gbench') || '').split(',').map(Number), v = c.length >= 6 && c.every(Number.isFinite) ? c : [-112, 1.5, -272, -100, 0.9, -300];
    cam.position.set(v[0], v[1], -v[2]); cam.lookAt(v[3], v[4], -v[5]); cam.updateMatrixWorld(true);
    const lead = []; world.cityRoot.traverse((o) => { if (o.isMesh && /^grass(_\d+)?$/.test(o.name)) lead.push(o); });
    const edges = group.children.filter((o) => /^park_(kerb|fence|wire)_/.test(o.name));
    const set = (mine, ed, l0, l1, cap) => { if (cap !== undefined) gU.uPomK2.value.z = cap; group.visible = mine; for (const o of lead) o.visible = !mine; for (const o of edges) o.visible = !!ed; if (rings[0]) rings[0].mute = !l0; if (rings[1]) rings[1].mute = !l1; };
    // the four states interleaved over many short runs, median of the frame times: drift of the machine (3 to 8 ms within one load) cancels
    const V = POM ? [[false, 0, 0, 0, 36], [true, 1, 0, 0, 36], [true, 1, 0, 0, 20], [true, 1, 0, 0, 12], [true, 1, 0, 0, 0]] : [[false, 0, 0, 0], [true, 0, 0, 0], [true, 1, 0, 0], [true, 1, 1, 0], [true, 1, 1, 1]], T = V.map(() => []);          // walked sward: the lead's grass, then mine with the walk capped at 36, 20, 12 and 0 steps
    for (let cyc = 0; cyc < 30; cyc++) for (let k = 0; k < V.length; k++) { set(...V[k]); r.render(world.scene, cam); r.render(world.scene, cam); gl.finish();
      for (let i = 0; i < 6; i++) { const t = performance.now(); r.render(world.scene, cam); gl.finish(); T[k].push(performance.now() - t); } }
    const med = (a) => { a.sort((x, y) => x - y); return (a.reduce((p, q) => p + q, 0) / a.length).toFixed(2) + 'mean ' + a[a.length >> 1].toFixed(2) + '(' + a[a.length >> 2].toFixed(1) + '-' + a[(a.length * 3) >> 2].toFixed(1) + ')'; }, out = T.map(med); for (const o of edges) o.visible = true;
    const cells = rings.map((q) => q.drawn).join('/'), sz = r.getDrawingBufferSize(new THREE.Vector2());
    cam.position.copy(sp); cam.quaternion.copy(sq); cam.updateMatrixWorld(true); world.scene.remove(group); for (const o of lead) o.visible = true;
    throw new Error('bench med(q1-q3): lead ' + out[0] + ' gnd ' + out[1] + ' +edge ' + out[2] + ' +near ' + out[3] + ' +far ' + out[4] + ' c' + cells);
  }
  // the lawn fence is solid (players reported walking through fences); gates stay open; the 4 cm edging is stepped over
  if (game.statics && game.statics.addSeg && !(Q && Q.get('gsolid') === '0')) for (const q of fenceSegs) game.statics.addSeg(q[0], q[1], q[2], q[3]);
  return { group, parks, rings, fenceSegs, paths: lay.parks, uniforms: { common, gU },
    report: { sward_ms: swMs, parks: parks.length, lawn_m2: Math.round(lawnM2), fence_m: Math.round(fenceM), kerb_m: Math.round(kerbM), ktris: Math.round(tris / 1000), sky: rings.length ? (rings[0].U.uSky.ok ? rings[0].U.uSky.value.toArray().map((v) => +v.toFixed(3)).join('/') : 'in shader') : '-', blade_ktris_max: Math.round(rings.reduce((a, r) => a + r.n * (r.S < 20 ? 3 : 1), 0) / 1000), blades: rings.reduce((a, r) => a + r.n, 0), hid: hidden.length, y: +gy.toFixed(3) } };
}
